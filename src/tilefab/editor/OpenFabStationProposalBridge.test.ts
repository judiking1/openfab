import { describe, expect, it, vi } from "vitest";
import {
	OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
} from "../compile/OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "../compile/OpenFabStationProposalCsvReader";
import {
	OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalWorkerRequest,
	type OpenFabStationProposalWorkerResponse,
	openFabStationProposalWorkerErrorMessage,
} from "../worker/OpenFabStationProposalProtocol";
import {
	collectOpenFabStationProposalResponseTransfers,
	runOpenFabStationProposalWorkerRequest,
} from "../worker/OpenFabStationProposalRuntime";
import {
	OpenFabStationProposalBridge,
	OpenFabStationProposalCancelledError,
	type OpenFabStationProposalWorkerPort,
} from "./OpenFabStationProposalBridge";

class RuntimeWorker implements OpenFabStationProposalWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	requestTransferCount = 0;
	requestTransferBytes = 0;
	requestSourceDetached = false;
	responseTransferCount = 0;
	responseTransferBytes = 0;
	responseSnapshotDetached = false;

	postMessage(message: OpenFabStationProposalWorkerRequest, transfer: Transferable[] = []): void {
		this.requestTransferCount = transfer.length;
		this.requestTransferBytes = transferByteLength(transfer);
		const delivered = structuredClone(message, { transfer });
		this.requestSourceDetached = message.source.byteLength === 0;
		queueMicrotask(() => {
			if (this.terminated) return;
			const response = runOpenFabStationProposalWorkerRequest(delivered);
			const responseTransfers = collectOpenFabStationProposalResponseTransfers(response);
			this.responseTransferCount = responseTransfers.length;
			this.responseTransferBytes = transferByteLength(responseTransfers);
			const deliveredResponse = structuredClone(response, { transfer: responseTransfers });
			this.responseSnapshotDetached = responseTransfers.every((buffer) => buffer.byteLength === 0);
			this.onmessage?.({ data: deliveredResponse } as MessageEvent<unknown>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class ControlledWorker implements OpenFabStationProposalWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	request: OpenFabStationProposalWorkerRequest | null = null;

	postMessage(message: OpenFabStationProposalWorkerRequest, transfer: Transferable[] = []): void {
		this.request = structuredClone(message, { transfer });
	}

	runtimeResponse(): OpenFabStationProposalWorkerResponse {
		if (!this.request) throw new Error("Expected a posted station proposal request.");
		return runOpenFabStationProposalWorkerRequest(this.request);
	}

	emit(value: unknown): void {
		this.onmessage?.({ data: value } as MessageEvent<unknown>);
	}

	emitError(): void {
		this.onerror?.({ message: "TOP_SECRET_NATIVE_ERROR" } as ErrorEvent);
	}

	emitMessageError(): void {
		this.onmessageerror?.({ data: "TOP_SECRET_DECODE_ERROR" } as MessageEvent<unknown>);
	}

	terminate(): void {
		this.terminated = true;
	}
}

class PostFailureWorker extends ControlledWorker {
	override postMessage(
		message: OpenFabStationProposalWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		super.postMessage(message, transfer);
		throw new Error("TOP_SECRET_POST_ERROR");
	}
}

class FirstHydrationCheckpointGate {
	private markEntered!: () => void;
	private releaseFirst: (() => void) | null = null;
	readonly entered = new Promise<void>((resolve) => {
		this.markEntered = resolve;
	});
	callCount = 0;

	checkpoint = (): Promise<void> => {
		this.callCount++;
		if (this.callCount !== 1) return Promise.resolve();
		this.markEntered();
		return new Promise<void>((resolve) => {
			this.releaseFirst = resolve;
		});
	};

	release(): void {
		this.releaseFirst?.();
		this.releaseFirst = null;
	}
}

describe("OpenFabStationProposalBridge", () => {
	it("consumes one owned source and adopts a transferred snapshot behind a facade", async () => {
		const source = headerOnlySource();
		const sourceByteLength = source.byteLength;
		const worker = new RuntimeWorker();
		const bridge = new OpenFabStationProposalBridge(() => worker);

		const pending = bridge.read(source, 11);
		expect(source.byteLength).toBe(0);
		const result = await pending;

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact).toMatchObject({
			kind: "hydrated-openfab-station-proposal-artifact",
			schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
			schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
			sourceByteLength,
			rowCount: 0,
		});
		expect(Object.keys(result.artifact)).not.toContain("stringBytes");
		expect(worker.requestTransferCount).toBe(1);
		expect(worker.requestTransferBytes).toBe(sourceByteLength);
		expect(worker.requestSourceDetached).toBe(true);
		expect(worker.responseTransferCount).toBeGreaterThan(0);
		expect(worker.responseTransferBytes).toBeGreaterThan(0);
		expect(worker.responseSnapshotDetached).toBe(true);
		expect(worker.terminated).toBe(true);
		expect(worker.onmessage).toBeNull();
	});

	it("time-budgets core checkpoints instead of scheduling one task per validation chunk", async () => {
		const worker = new RuntimeWorker();
		let tick = -1;
		const yieldedAt: number[] = [];
		const now = (): number => ++tick;
		const bridge = new OpenFabStationProposalBridge(
			() => worker,
			30_000,
			() => {
				yieldedAt.push(tick);
				return Promise.resolve();
			},
			now,
			3,
		);

		const result = await bridge.read(syntheticRowsSource(512), 12);

		expect(result.ok).toBe(true);
		expect(yieldedAt.length).toBeGreaterThan(2);
		expect(yieldedAt[0]).toBe(3);
		for (let index = 1; index < yieldedAt.length; index++) {
			expect((yieldedAt[index] as number) - (yieldedAt[index - 1] as number)).toBeLessThanOrEqual(
				4,
			);
		}
		const coreCheckpointCount = tick + 1 - 1 - yieldedAt.length;
		expect(yieldedAt.length).toBeLessThan(coreCheckpointCount);
	});

	it("cooperatively adopts a representative fixture within a broad budget", async () => {
		const rowCount = 2_048;
		const worker = new RuntimeWorker();
		const bridge = new OpenFabStationProposalBridge(() => worker);
		const startedAt = performance.now();

		const result = await bridge.read(syntheticRowsSource(rowCount), 14);
		const elapsedMilliseconds = performance.now() - startedAt;

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact.rowCount).toBe(rowCount);
		expect(elapsedMilliseconds).toBeLessThan(5_000);
	});

	it("resolves an expected untrusted-source rejection without exposing source text", async () => {
		const source = new TextEncoder().encode('"TOP_SECRET_UNCLOSED').buffer;
		const worker = new RuntimeWorker();
		const result = await new OpenFabStationProposalBridge(() => worker).read(source, 13);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.kind).toBe("hydrated-openfab-station-proposal-read-failure");
		expect(result.failure.code).toBe("MALFORMED_CSV");
		expect(Object.keys(result.failure)).not.toContain("issueCounts");
		expect(JSON.stringify(result)).not.toContain("TOP_SECRET_UNCLOSED");
		expect(worker.responseTransferCount).toBe(1);
		expect(worker.terminated).toBe(true);
	});

	it("does not create a Worker or detach bytes for a pre-aborted read", async () => {
		const source = headerOnlySource();
		const sourceByteLength = source.byteLength;
		const controller = new AbortController();
		controller.abort();
		let workerCreations = 0;
		const bridge = new OpenFabStationProposalBridge(() => {
			workerCreations++;
			return new ControlledWorker();
		});

		await expect(bridge.read(source, 1, controller.signal)).rejects.toBeInstanceOf(
			OpenFabStationProposalCancelledError,
		);
		expect(workerCreations).toBe(0);
		expect(source.byteLength).toBe(sourceByteLength);
	});

	it("rejects an already-detached source before creating a Worker", async () => {
		const source = headerOnlySource();
		structuredClone(source, { transfer: [source] });
		let workerCreations = 0;
		const bridge = new OpenFabStationProposalBridge(() => {
			workerCreations++;
			return new ControlledWorker();
		});

		await expect(bridge.read(source, 2)).rejects.toThrow(/source buffer is detached/i);
		expect(workerCreations).toBe(0);
	});

	it("terminates an in-flight read when its AbortSignal fires", async () => {
		const source = headerOnlySource();
		const worker = new ControlledWorker();
		const controller = new AbortController();
		const pending = new OpenFabStationProposalBridge(() => worker).read(
			source,
			2,
			controller.signal,
		);
		expect(source.byteLength).toBe(0);

		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(OpenFabStationProposalCancelledError);
		expect(worker.terminated).toBe(true);
		expect(worker.onmessage).toBeNull();
	});

	it("aborts while cooperative main-thread adoption is at a bounded checkpoint", async () => {
		const worker = new ControlledWorker();
		const gate = new FirstHydrationCheckpointGate();
		const controller = new AbortController();
		const bridge = new OpenFabStationProposalBridge(
			() => worker,
			30_000,
			gate.checkpoint,
			steppingClock(),
			1,
		);
		const pending = bridge.read(headerOnlySource(), 5, controller.signal);
		const response = worker.runtimeResponse();
		worker.emit(response);
		await gate.entered;
		if (response.type !== "OPENFAB_STATION_PROPOSAL_READ") {
			throw new Error("Expected a successful synthetic station proposal response.");
		}
		expect(response.artifact.stringOffsets.byteLength).toBe(0);

		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(OpenFabStationProposalCancelledError);
		expect(worker.terminated).toBe(true);
		gate.release();
		await Promise.resolve();
	});

	it("suppresses a late adopted artifact after a newer generation has completed", async () => {
		const firstWorker = new ControlledWorker();
		const secondWorker = new RuntimeWorker();
		const gate = new FirstHydrationCheckpointGate();
		let workerIndex = 0;
		const bridge = new OpenFabStationProposalBridge(
			() => [firstWorker, secondWorker][workerIndex++] as OpenFabStationProposalWorkerPort,
			30_000,
			gate.checkpoint,
			steppingClock(),
			1,
		);
		const first = bridge.read(headerOnlySource(), 6);
		firstWorker.emit(firstWorker.runtimeResponse());
		await gate.entered;

		const second = bridge.read(headerOnlySource(), 7);

		await expect(first).rejects.toBeInstanceOf(OpenFabStationProposalCancelledError);
		await expect(second).resolves.toMatchObject({
			ok: true,
			artifact: { kind: "hydrated-openfab-station-proposal-artifact" },
		});
		gate.release();
		await Promise.resolve();
		await Promise.resolve();
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it("disposes the active Worker and refuses to consume later sources", async () => {
		const worker = new ControlledWorker();
		const bridge = new OpenFabStationProposalBridge(() => worker);
		const activeSource = headerOnlySource();
		const pending = bridge.read(activeSource, 3);
		expect(activeSource.byteLength).toBe(0);

		bridge.dispose();

		await expect(pending).rejects.toBeInstanceOf(OpenFabStationProposalCancelledError);
		expect(worker.terminated).toBe(true);
		const laterSource = headerOnlySource();
		const laterByteLength = laterSource.byteLength;
		await expect(bridge.read(laterSource, 4)).rejects.toBeInstanceOf(
			OpenFabStationProposalCancelledError,
		);
		expect(laterSource.byteLength).toBe(laterByteLength);
	});

	it("cancels the old generation and resolves only the newest request", async () => {
		const firstWorker = new ControlledWorker();
		const secondWorker = new RuntimeWorker();
		let workerIndex = 0;
		const bridge = new OpenFabStationProposalBridge(
			() => [firstWorker, secondWorker][workerIndex++] as OpenFabStationProposalWorkerPort,
		);
		const firstSource = headerOnlySource();
		const secondSource = headerOnlySource();
		const first = bridge.read(firstSource, 20);
		const staleHandler = firstWorker.onmessage;
		const staleResponse = firstWorker.runtimeResponse();
		const second = bridge.read(secondSource, 21);
		staleHandler?.({ data: staleResponse } as MessageEvent<unknown>);

		await expect(first).rejects.toBeInstanceOf(OpenFabStationProposalCancelledError);
		await expect(second).resolves.toMatchObject({
			ok: true,
			artifact: { kind: "hydrated-openfab-station-proposal-artifact" },
		});
		expect(firstSource.byteLength).toBe(0);
		expect(secondSource.byteLength).toBe(0);
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it("rejects stale or malformed correlation echoes", async () => {
		for (const mutation of [
			(value: Record<string, unknown>) => ({ ...value, requestId: 999 }),
			(value: Record<string, unknown>) => ({ ...value, generation: 999 }),
			(value: Record<string, unknown>) => ({ ...value, byteLength: 999 }),
			(value: Record<string, unknown>) => ({ ...value, protocolVersion: 999 }),
			(value: Record<string, unknown>) => ({ ...value, schemaId: "foreign/schema" }),
			(value: Record<string, unknown>) => ({ ...value, schemaVersion: 999 }),
			(value: Record<string, unknown>) => ({ ...value, extra: true }),
		]) {
			const worker = new ControlledWorker();
			const pending = new OpenFabStationProposalBridge(() => worker).read(headerOnlySource(), 30);
			const response = worker.runtimeResponse();
			worker.emit(mutation(response as unknown as Record<string, unknown>));

			await expect(pending).rejects.toThrow(/stale|correlation|fields/i);
			expect(worker.terminated).toBe(true);
		}
	});

	it("rejects a tampered snapshot instead of reparsing its detached source", async () => {
		const worker = new ControlledWorker();
		const source = headerOnlySource();
		const pending = new OpenFabStationProposalBridge(() => worker).read(source, 41);
		const response = worker.runtimeResponse();
		if (response.type !== "OPENFAB_STATION_PROPOSAL_READ") {
			throw new Error("Expected a successful synthetic station proposal response.");
		}
		worker.emit({
			...response,
			artifact: {
				...response.artifact,
				snapshotFingerprint: "tampered-snapshot",
			},
		});

		await expect(pending).rejects.toThrow("SNAPSHOT_FINGERPRINT_MISMATCH");
		expect(source.byteLength).toBe(0);
		expect(worker.terminated).toBe(true);
	});

	it("rejects tampered rejection evidence before exposing its diagnostic facade", async () => {
		const worker = new ControlledWorker();
		const pending = new OpenFabStationProposalBridge(() => worker).read(new ArrayBuffer(0), 42);
		const response = worker.runtimeResponse();
		if (response.type !== "OPENFAB_STATION_PROPOSAL_REJECTED") {
			throw new Error("Expected an empty-source station proposal rejection.");
		}
		worker.emit({
			...response,
			failure: {
				...response.failure,
				snapshotFingerprint: "tampered-rejection",
			},
		});

		await expect(pending).rejects.toThrow("SNAPSHOT_FINGERPRINT_MISMATCH");
		expect(worker.terminated).toBe(true);
	});

	it("rejects a second response while the first snapshot is being adopted", async () => {
		const worker = new ControlledWorker();
		const pending = new OpenFabStationProposalBridge(() => worker).read(headerOnlySource(), 43);
		const handler = worker.onmessage;
		const readResponse = worker.runtimeResponse();
		worker.emit(readResponse);
		const request = requiredRequest(worker);
		const rejected = parseOpenFabStationProposalCsv(
			malformedSourceWithByteLength(request.byteLength),
		);
		if (rejected.ok) throw new Error("Expected synthetic malformed source rejection.");
		handler?.({
			data: {
				type: "OPENFAB_STATION_PROPOSAL_REJECTED",
				protocolVersion: OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
				schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
				schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
				requestId: request.requestId,
				generation: request.generation,
				byteLength: request.byteLength,
				failure: rejected.failure,
			},
		} as MessageEvent<unknown>);

		await expect(pending).rejects.toThrow(/more than one response/i);
		expect(worker.terminated).toBe(true);
	});

	it("accepts only the fixed error dictionary and never surfaces injected text", async () => {
		const malformedWorker = new ControlledWorker();
		const malformedPending = new OpenFabStationProposalBridge(() => malformedWorker).read(
			headerOnlySource(),
			50,
		);
		const malformedRequest = requiredRequest(malformedWorker);
		malformedWorker.emit({
			...fixedErrorResponse(malformedRequest),
			message: "TOP_SECRET_WORKER_MESSAGE",
		});
		const malformedError = await malformedPending.catch((error: unknown) => error);
		expect(malformedError).toBeInstanceOf(Error);
		expect((malformedError as Error).message).toMatch(/error response is malformed/i);
		expect((malformedError as Error).message).not.toContain("TOP_SECRET");
		expect(malformedWorker.terminated).toBe(true);

		const fixedWorker = new ControlledWorker();
		const fixedPending = new OpenFabStationProposalBridge(() => fixedWorker).read(
			headerOnlySource(),
			51,
		);
		fixedWorker.emit(fixedErrorResponse(requiredRequest(fixedWorker)));
		await expect(fixedPending).rejects.toThrow(
			openFabStationProposalWorkerErrorMessage("READ_FAILED"),
		);
		expect(fixedWorker.terminated).toBe(true);
	});

	it("terminates on post, native, decode, and timeout failures", async () => {
		const postWorker = new PostFailureWorker();
		const postSource = headerOnlySource();
		await expect(
			new OpenFabStationProposalBridge(() => postWorker).read(postSource, 60),
		).rejects.toThrow(/could not be posted/i);
		expect(postSource.byteLength).toBe(0);
		expect(postWorker.terminated).toBe(true);

		const nativeWorker = new ControlledWorker();
		const nativePending = new OpenFabStationProposalBridge(() => nativeWorker).read(
			headerOnlySource(),
			61,
		);
		nativeWorker.emitError();
		const nativeError = await nativePending.catch((error: unknown) => error);
		expect((nativeError as Error).message).toBe("Station proposal Worker failed.");
		expect(nativeWorker.terminated).toBe(true);

		const decodeWorker = new ControlledWorker();
		const decodePending = new OpenFabStationProposalBridge(() => decodeWorker).read(
			headerOnlySource(),
			62,
		);
		decodeWorker.emitMessageError();
		const decodeError = await decodePending.catch((error: unknown) => error);
		expect((decodeError as Error).message).toMatch(/could not be decoded/i);
		expect((decodeError as Error).message).not.toContain("TOP_SECRET");
		expect(decodeWorker.terminated).toBe(true);

		vi.useFakeTimers();
		try {
			const timeoutWorker = new ControlledWorker();
			const timed = new OpenFabStationProposalBridge(() => timeoutWorker, 25).read(
				headerOnlySource(),
				63,
			);
			const expectation = expect(timed).rejects.toThrow(/timed out after 25 ms/i);
			await vi.advanceTimersByTimeAsync(25);
			await expectation;
			expect(timeoutWorker.terminated).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps bytes attached when Worker construction fails", async () => {
		const source = headerOnlySource();
		const sourceByteLength = source.byteLength;
		const bridge = new OpenFabStationProposalBridge(() => {
			throw new Error("TOP_SECRET_CREATE_ERROR");
		});

		const error = await bridge.read(source, 70).catch((failure: unknown) => failure);
		expect((error as Error).message).toBe("Station proposal Worker could not be created.");
		expect(source.byteLength).toBe(sourceByteLength);
	});
});

function headerOnlySource(): ArrayBuffer {
	return new TextEncoder().encode(`${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n`).buffer;
}

function syntheticRowsSource(rowCount: number): ArrayBuffer {
	const rows = Array.from({ length: rowCount }, (_, row) =>
		OPENFAB_STATION_PROPOSAL_V1_HEADERS.map((header) => {
			switch (header) {
				case "identity_scope":
					return "synthetic-scope";
				case "port_key":
					return `PORT-${row}`;
				case "attachment_scope":
					return "rail-scope";
				case "attachment_alias":
					return "RAIL-A";
				case "station_mm":
					return String(1_000 + row);
				case "side":
					return "LEFT";
				case "lateral_offset_mm":
					return "700";
				case "direction":
					return "WITH_TRAVEL";
				case "direction_evidence":
					return "DECLARED";
				case "port_type":
					return "EQ";
				default:
					return "";
			}
		}).join(","),
	);
	return new TextEncoder().encode(
		`${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n${rows.join("\n")}\n`,
	).buffer;
}

function malformedSourceWithByteLength(byteLength: number): Uint8Array {
	const source = new Uint8Array(byteLength);
	source.fill("A".charCodeAt(0));
	if (source.length > 0) source[0] = '"'.charCodeAt(0);
	return source;
}

function requiredRequest(worker: ControlledWorker): OpenFabStationProposalWorkerRequest {
	if (!worker.request) throw new Error("Expected a posted station proposal request.");
	return worker.request;
}

function fixedErrorResponse(
	request: OpenFabStationProposalWorkerRequest,
): OpenFabStationProposalWorkerResponse {
	return {
		type: "OPENFAB_STATION_PROPOSAL_ERROR",
		protocolVersion: OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
		schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
		schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
		requestId: request.requestId,
		generation: request.generation,
		byteLength: request.byteLength,
		code: "READ_FAILED",
		message: openFabStationProposalWorkerErrorMessage("READ_FAILED"),
	};
}

function transferByteLength(transfers: readonly Transferable[]): number {
	return transfers.reduce<number>(
		(total, item) => total + (item instanceof ArrayBuffer ? item.byteLength : 0),
		0,
	);
}

function steppingClock(): () => number {
	let now = 0;
	return () => now++;
}
