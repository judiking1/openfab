import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
} from "../compile/OpenFabFabComposer";
import {
	createOpenFabFabPreparedProjectAttestation,
	createOpenFabFabPreparedProjectIdentity,
	OPENFAB_FAB_PREPARED_PROJECT_KIND,
	OPENFAB_FAB_PREPARED_PROJECT_VERSION,
	type OpenFabFabPreparedProjectIdentity,
	openFabFabPreparedProjectIdentityFingerprint,
	openFabFabPreparedProjectRequestFingerprint,
	type TransferableOpenFabFabPreparedProject,
} from "../compile/OpenFabFabPreparedProject";
import {
	OPENFAB_FAB_PROFILE_V1_POLICIES,
	type OpenFabFabProfile,
} from "../compile/OpenFabFabProfile";
import {
	OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
	type OpenFabFabPreparedProjectWorkerRequest,
} from "../worker/OpenFabFabPreparedProjectProtocol";
import {
	collectOpenFabFabPreparedProjectResponseTransfers,
	runOpenFabFabPreparedProjectRequest,
} from "../worker/OpenFabFabPreparedProjectRuntime";
import {
	bindOpenFabFabPreparedProjectVerification,
	consumeOpenFabFabPreparedProject,
	discardOpenFabFabPreparedProject,
	type OpenFabFabPreparedProject,
	openFabFabPreparedProjectIsLive,
	openFabFabPreparedProjectTransferStats,
	rebindTransferableOpenFabFabPreparedProject,
} from "./OpenFabFabPreparedProjectArtifact";
import {
	OpenFabFabPreparedProjectBridge,
	OpenFabFabPreparedProjectCancelledError,
	type OpenFabFabPreparedProjectWorkerPort,
} from "./OpenFabFabPreparedProjectBridge";

const PROFILE = Object.freeze({
	kind: "openfab-fab-profile",
	version: 1,
	layoutBlockCount: 1,
	bankRepetitionAxis: "EAST_WEST",
	banksPerLayoutBlock: 1,
	processLoopsPerBank: 12,
	bayPackingPolicy: "TWIN",
	processLoopLongAxisMeters: 36,
	processLoopCenterPitchMeters: 12,
	...OPENFAB_FAB_PROFILE_V1_POLICIES,
}) satisfies OpenFabFabProfile;

const MANIFEST = Object.freeze({
	id: "new-fab-1",
	name: "New Fab",
	createdAt: "2026-08-16T00:00:00.000Z",
	updatedAt: "2026-08-16T00:00:00.000Z",
});

let certificate: CertifiedOpenFabFabComposition;

beforeAll(() => {
	certificate = composeOpenFabFab(PROFILE);
}, 120_000);

describe("OpenFabFabPreparedProjectArtifact", () => {
	it("rebinds a manifest-neutral source while hiding its transferable snapshot", () => {
		const fixture = transferableFixture();
		const prepared = rebindTransferableOpenFabFabPreparedProject(
			fixture.prepared,
			fixture.attestation,
			PROFILE,
		);

		expect(openFabFabPreparedProjectIsLive(prepared)).toBe(true);
		expect(Object.keys(prepared).sort()).toEqual(["identity", "kind", "profile"]);
		expect("snapshot" in prepared).toBe(false);
		expect("manifest" in prepared).toBe(false);
		expect("placementBundle" in prepared).toBe(false);
	});

	it("requires independent identity evidence and consumes the actual manifest exactly once", () => {
		const fixture = transferableFixture();
		const prepared = rebindTransferableOpenFabFabPreparedProject(
			fixture.prepared,
			fixture.attestation,
			PROFILE,
		);
		const evidence = bindOpenFabFabPreparedProjectVerification(
			prepared,
			structuredClone(fixture.prepared.identity),
		);

		expect(() =>
			consumeOpenFabFabPreparedProject(prepared, evidence, { ...MANIFEST, extra: true }),
		).toThrow(/manifest/i);
		expect(openFabFabPreparedProjectIsLive(prepared)).toBe(true);
		const consumed = consumeOpenFabFabPreparedProject(prepared, evidence, MANIFEST);
		expect(consumed.manifest).toEqual(MANIFEST);
		expect(consumed.snapshot.checksum).toBe(certificate.authored.checksum);
		expect(Object.keys(consumed).sort()).toEqual([
			"creationFingerprint",
			"identity",
			"manifest",
			"snapshot",
		]);
		expect(() => consumeOpenFabFabPreparedProject(prepared, evidence, MANIFEST)).toThrow(
			/already consumed|absent/i,
		);
	});

	it("explicitly revokes an abandoned prepared source", () => {
		const fixture = transferableFixture();
		const prepared = rebindTransferableOpenFabFabPreparedProject(
			fixture.prepared,
			fixture.attestation,
			PROFILE,
		);
		const evidence = bindOpenFabFabPreparedProjectVerification(
			prepared,
			structuredClone(fixture.prepared.identity),
		);

		expect(discardOpenFabFabPreparedProject(prepared, evidence)).toBe(true);
		expect(openFabFabPreparedProjectIsLive(prepared)).toBe(false);
		expect(discardOpenFabFabPreparedProject(prepared, evidence)).toBe(false);
		expect(() => consumeOpenFabFabPreparedProject(prepared, evidence, MANIFEST)).toThrow(
			/absent|consumed/i,
		);
	});

	it("rejects malformed envelopes and a profile/source mismatch", () => {
		const fixture = transferableFixture();
		expect(() =>
			rebindTransferableOpenFabFabPreparedProject(
				{ ...fixture.prepared, extra: true },
				fixture.attestation,
				PROFILE,
			),
		).toThrow(/fields/i);
		expect(() =>
			rebindTransferableOpenFabFabPreparedProject(fixture.prepared, fixture.attestation, {
				...PROFILE,
				bankRepetitionAxis: "NORTH_SOUTH",
			}),
		).toThrow(/profile/i);
	});

	it.each([
		"alias",
		"partial-view",
		"shared",
	] as const)("rejects %s typed-buffer ownership", (mode) => {
		const fixture = transferableFixture();
		const mutableSnapshot = fixture.prepared.snapshot as unknown as {
			xs: Int32Array;
			ys: Int32Array;
		};
		if (mode === "alias") {
			mutableSnapshot.ys = new Int32Array(mutableSnapshot.xs.buffer);
		} else if (mode === "partial-view") {
			const backing = new ArrayBuffer(
				(mutableSnapshot.ys.length + 1) * Int32Array.BYTES_PER_ELEMENT,
			);
			mutableSnapshot.ys = new Int32Array(
				backing,
				Int32Array.BYTES_PER_ELEMENT,
				mutableSnapshot.ys.length,
			);
		} else {
			mutableSnapshot.ys = new Int32Array(new SharedArrayBuffer(mutableSnapshot.ys.byteLength));
		}
		expect(() =>
			rebindTransferableOpenFabFabPreparedProject(fixture.prepared, fixture.attestation, PROFILE),
		).toThrow(/aliases|full ArrayBuffer|SharedArrayBuffer/i);
	});

	it("rejects source/verifier identity disagreement even when both identities self-validate", () => {
		const fixture = transferableFixture();
		const prepared = rebindTransferableOpenFabFabPreparedProject(
			fixture.prepared,
			fixture.attestation,
			PROFILE,
		);
		expect(() =>
			bindOpenFabFabPreparedProjectVerification(
				prepared,
				changeIdentity(fixture.prepared.identity, {
					compositionFingerprint: "foreign-composition",
				}),
			),
		).toThrow(/do not match/i);
	});
});

describe("OpenFabFabPreparedProjectRuntime", () => {
	it("rejects a malformed request without invoking composition", () => {
		const response = runOpenFabFabPreparedProjectRequest({
			type: "VERIFY_OPENFAB_FAB_PROJECT_MATERIALIZATION",
			protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
			requestId: 1,
			requestFingerprint: "wrong",
			profile: PROFILE,
			extra: true,
		});
		expect(response).toMatchObject({
			type: "OPENFAB_FAB_PREPARED_PROJECT_ERROR",
			code: "MALFORMED_REQUEST",
		});
	});

	it("preserves recognizable SOURCE correlation on malformed and mismatched requests", () => {
		const requestFingerprint = openFabFabPreparedProjectRequestFingerprint(PROFILE);
		const malformed = runOpenFabFabPreparedProjectRequest({
			type: "PREPARE_OPENFAB_FAB_PROJECT_SOURCE",
			protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
			requestId: 17,
			requestFingerprint,
			profile: PROFILE,
			extra: true,
		});
		expect(malformed).toMatchObject({
			type: "OPENFAB_FAB_PREPARED_PROJECT_ERROR",
			operation: "SOURCE",
			requestId: 17,
			requestFingerprint,
			code: "MALFORMED_REQUEST",
		});

		const mismatched = runOpenFabFabPreparedProjectRequest({
			type: "PREPARE_OPENFAB_FAB_PROJECT_SOURCE",
			protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
			requestId: 18,
			requestFingerprint: "foreign-request",
			profile: PROFILE,
		});
		expect(mismatched).toMatchObject({
			type: "OPENFAB_FAB_PREPARED_PROJECT_ERROR",
			operation: "SOURCE",
			requestId: 18,
			requestFingerprint: "foreign-request",
			code: "REQUEST_MISMATCH",
		});
	});

	it("materializes a manifest-neutral source and publishes its exact transfer list", () => {
		const requestFingerprint = openFabFabPreparedProjectRequestFingerprint(PROFILE);
		const response = runOpenFabFabPreparedProjectRequest({
			type: "PREPARE_OPENFAB_FAB_PROJECT_SOURCE",
			protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
			requestId: 7,
			requestFingerprint,
			profile: PROFILE,
		});
		expect(response.type).toBe("OPENFAB_FAB_PROJECT_SOURCE_PREPARED");
		if (response.type !== "OPENFAB_FAB_PROJECT_SOURCE_PREPARED") return;
		const transfers = collectOpenFabFabPreparedProjectResponseTransfers(response);
		expect(transfers).toHaveLength(response.attestation.transferableBufferCount);
		let transferableByteLength = 0;
		for (const transfer of transfers) {
			transferableByteLength += (transfer as ArrayBuffer).byteLength;
		}
		expect(transferableByteLength).toBe(response.attestation.transferableByteLength);
		expect("manifest" in response.prepared).toBe(false);
		expect("placementBundle" in response.prepared).toBe(false);

		const received = structuredClone(response, { transfer: [...transfers] });
		for (const transfer of transfers) {
			expect((transfer as ArrayBuffer).byteLength).toBe(0);
		}
		expect(received.type).toBe("OPENFAB_FAB_PROJECT_SOURCE_PREPARED");
		if (received.type !== "OPENFAB_FAB_PROJECT_SOURCE_PREPARED") return;
		expect(openFabFabPreparedProjectTransferStats(received.prepared.snapshot)).toEqual({
			bufferCount: received.attestation.transferableBufferCount,
			byteLength: received.attestation.transferableByteLength,
		});
		const prepared = rebindTransferableOpenFabFabPreparedProject(
			received.prepared,
			received.attestation,
			PROFILE,
		);
		expect(openFabFabPreparedProjectIsLive(prepared)).toBe(true);
		expect(discardOpenFabFabPreparedProject(prepared)).toBe(true);
	}, 120_000);
});

describe("OpenFabFabPreparedProjectBridge", () => {
	it("rejects an exact-envelope violation and terminates both disposable Workers", async () => {
		const harness = workerHarness();
		const bridge = new OpenFabFabPreparedProjectBridge(harness.create, 10_000);
		const pending = bridge.prepare(PROFILE);
		const [verifier, source] = harness.workers;
		verifier?.emit({ ...verifiedResponse(verifier.request()), extra: true });

		await expect(pending).rejects.toThrow(/fields/i);
		expect(verifier?.terminated).toBe(true);
		expect(source?.terminated).toBe(true);
	});

	it("ignores a stale generation after latest-wins cancellation", async () => {
		const harness = workerHarness();
		const bridge = new OpenFabFabPreparedProjectBridge(harness.create, 10_000);
		const first = bridge.prepare(PROFILE);
		const oldVerifier = harness.workers[0] as FakeWorker;
		const oldSource = harness.workers[1] as FakeWorker;
		const staleHandler = oldVerifier.onmessage;
		oldSource.emit(sourceResponse(oldSource.request()));
		const abandonedPrepared = bridgePreparedSource(bridge);
		expect(openFabFabPreparedProjectIsLive(abandonedPrepared)).toBe(true);
		const second = bridge.prepare(PROFILE);
		await expect(first).rejects.toBeInstanceOf(OpenFabFabPreparedProjectCancelledError);
		expect(openFabFabPreparedProjectIsLive(abandonedPrepared)).toBe(false);

		staleHandler?.({ data: verifiedResponse(oldVerifier.request()) } as MessageEvent<unknown>);
		const verifier = harness.workers[2] as FakeWorker;
		const source = harness.workers[3] as FakeWorker;
		verifier.emit(verifiedResponse(verifier.request()));
		source.emit(sourceResponse(source.request()));
		await expect(second).resolves.toMatchObject({
			prepared: { kind: "openfab-fab-prepared-project-artifact" },
		});
		expect(harness.workers.every((worker) => worker.terminated)).toBe(true);
	});

	it("rejects a source/verifier mismatch and cleans up both Workers", async () => {
		const harness = workerHarness();
		const bridge = new OpenFabFabPreparedProjectBridge(harness.create, 10_000);
		const pending = bridge.prepare(PROFILE);
		const [verifier, source] = harness.workers as [FakeWorker, FakeWorker];
		verifier.emit({
			...verifiedResponse(verifier.request()),
			identity: changeIdentity(createOpenFabFabPreparedProjectIdentity(certificate), {
				compositionFingerprint: "foreign-composition",
			}),
		});
		source.emit(sourceResponse(source.request()));

		await expect(pending).rejects.toThrow(/do not match/i);
		expect(verifier.terminated && source.terminated).toBe(true);
	});

	it("aborts both independent materializations", async () => {
		const harness = workerHarness();
		const bridge = new OpenFabFabPreparedProjectBridge(harness.create, 10_000);
		const controller = new AbortController();
		const pending = bridge.prepare(PROFILE, controller.signal);
		controller.abort();

		await expect(pending).rejects.toBeInstanceOf(OpenFabFabPreparedProjectCancelledError);
		expect(harness.workers.every((worker) => worker.terminated)).toBe(true);
	});

	it("revokes a source-first artifact when preparation is aborted", async () => {
		const harness = workerHarness();
		const bridge = new OpenFabFabPreparedProjectBridge(harness.create, 10_000);
		const controller = new AbortController();
		const pending = bridge.prepare(PROFILE, controller.signal);
		const source = harness.workers[1] as FakeWorker;
		source.emit(sourceResponse(source.request()));
		const abandonedPrepared = bridgePreparedSource(bridge);
		expect(openFabFabPreparedProjectIsLive(abandonedPrepared)).toBe(true);

		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(OpenFabFabPreparedProjectCancelledError);
		expect(openFabFabPreparedProjectIsLive(abandonedPrepared)).toBe(false);
	});

	it("fails and cleans up on timeout, Worker error, and messageerror", async () => {
		vi.useFakeTimers();
		try {
			const timeoutHarness = workerHarness();
			const timed = new OpenFabFabPreparedProjectBridge(timeoutHarness.create, 25).prepare(PROFILE);
			const timedExpectation = expect(timed).rejects.toThrow(/timed out/i);
			await vi.advanceTimersByTimeAsync(25);
			await timedExpectation;
			expect(timeoutHarness.workers.every((worker) => worker.terminated)).toBe(true);

			for (const mode of ["error", "messageerror"] as const) {
				const harness = workerHarness();
				const pending = new OpenFabFabPreparedProjectBridge(harness.create, 25).prepare(PROFILE);
				const verifier = harness.workers[0] as FakeWorker;
				if (mode === "error") verifier.fail("boom");
				else verifier.unreadable();
				await expect(pending).rejects.toThrow(mode === "error" ? /boom/ : /unreadable/i);
				expect(harness.workers.every((worker) => worker.terminated)).toBe(true);
			}
		} finally {
			vi.useRealTimers();
		}
	});
});

function transferableFixture(): {
	readonly prepared: TransferableOpenFabFabPreparedProject;
	readonly attestation: ReturnType<typeof createOpenFabFabPreparedProjectAttestation>;
} {
	const snapshot = structuredClone(certificate.roundTrippedSnapshot);
	const identity = createOpenFabFabPreparedProjectIdentity(certificate);
	const requestFingerprint = openFabFabPreparedProjectRequestFingerprint(PROFILE);
	const prepared: TransferableOpenFabFabPreparedProject = {
		kind: OPENFAB_FAB_PREPARED_PROJECT_KIND,
		version: OPENFAB_FAB_PREPARED_PROJECT_VERSION,
		requestFingerprint,
		profile: structuredClone(PROFILE),
		identity: structuredClone(identity),
		snapshot,
	};
	const stats = openFabFabPreparedProjectTransferStats(snapshot);
	return {
		prepared,
		attestation: createOpenFabFabPreparedProjectAttestation({
			requestFingerprint,
			materializationFingerprint: identity.fingerprint,
			snapshotChecksum: snapshot.checksum,
			transferableBufferCount: stats.bufferCount,
			transferableByteLength: stats.byteLength,
		}),
	};
}

function bridgePreparedSource(bridge: OpenFabFabPreparedProjectBridge): OpenFabFabPreparedProject {
	const prepared = (
		bridge as unknown as {
			active: { prepared: OpenFabFabPreparedProject | null } | null;
		}
	).active?.prepared;
	if (!prepared) throw new Error("Expected a source-first prepared artifact.");
	return prepared;
}

function changeIdentity(
	identity: OpenFabFabPreparedProjectIdentity,
	changes: Partial<Omit<OpenFabFabPreparedProjectIdentity, "fingerprint">>,
): OpenFabFabPreparedProjectIdentity {
	const changed = { ...structuredClone(identity), ...changes };
	return {
		...changed,
		fingerprint: openFabFabPreparedProjectIdentityFingerprint(changed),
	};
}

class FakeWorker implements OpenFabFabPreparedProjectWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	posted: OpenFabFabPreparedProjectWorkerRequest[] = [];
	terminated = false;

	postMessage(message: OpenFabFabPreparedProjectWorkerRequest): void {
		this.posted.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	request(): OpenFabFabPreparedProjectWorkerRequest {
		const request = this.posted[0];
		if (!request) throw new Error("Worker request was not posted.");
		return request;
	}

	emit(value: unknown): void {
		this.onmessage?.({ data: value } as MessageEvent<unknown>);
	}

	fail(message: string): void {
		this.onerror?.({ message } as ErrorEvent);
	}

	unreadable(): void {
		this.onmessageerror?.({ data: null } as MessageEvent<unknown>);
	}
}

function workerHarness(): {
	readonly workers: FakeWorker[];
	readonly create: () => FakeWorker;
} {
	const workers: FakeWorker[] = [];
	return {
		workers,
		create: () => {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
	};
}

function verifiedResponse(
	request: OpenFabFabPreparedProjectWorkerRequest,
): Record<string, unknown> {
	return {
		type: "OPENFAB_FAB_PROJECT_MATERIALIZATION_VERIFIED",
		protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
		requestId: request.requestId,
		requestFingerprint: request.requestFingerprint,
		identity: createOpenFabFabPreparedProjectIdentity(certificate),
	};
}

function sourceResponse(request: OpenFabFabPreparedProjectWorkerRequest): Record<string, unknown> {
	const fixture = transferableFixture();
	return {
		type: "OPENFAB_FAB_PROJECT_SOURCE_PREPARED",
		protocolVersion: OPENFAB_FAB_PREPARED_PROJECT_PROTOCOL_VERSION,
		requestId: request.requestId,
		requestFingerprint: request.requestFingerprint,
		prepared: fixture.prepared,
		attestation: fixture.attestation,
	};
}
