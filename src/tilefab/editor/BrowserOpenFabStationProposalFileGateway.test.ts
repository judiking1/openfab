import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES } from "../project/OpenFabStationProposalPorts";
import { BrowserOpenFabStationProposalFileGateway } from "./BrowserOpenFabStationProposalFileGateway";

interface TestByteReader {
	read(): Promise<ReadableStreamReadResult<Uint8Array>>;
	cancel(reason?: unknown): Promise<void>;
	releaseLock(): void;
}

describe("BrowserOpenFabStationProposalFileGateway", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("returns local display metadata and a fresh exact-length byte buffer", async () => {
		const first = Uint8Array.of(0x23, 0x20, 0x73);
		const second = Uint8Array.of(0x79, 0x6e, 0x74, 0x68, 0x65, 0x74, 0x69, 0x63);
		const reader = createSequenceReader([first, second]);
		const selected = createTestFile("synthetic-stations.csv", first.length + second.length, reader);
		const picker = installNativePicker(selected.file);
		const gateway = new BrowserOpenFabStationProposalFileGateway();

		const result = await gateway.chooseOpen();

		expect(result).not.toBeNull();
		if (!result) throw new Error("Expected a selected station proposal.");
		expect(Object.keys(result)).toEqual(["displayName", "bytes"]);
		expect(result.displayName).toBe("synthetic-stations.csv");
		expect([...new Uint8Array(result.bytes)]).toEqual([...first, ...second]);
		expect(result.bytes).not.toBe(first.buffer);
		expect(Object.isFrozen(result)).toBe(true);
		first[0] = 0xff;
		expect(new Uint8Array(result.bytes)[0]).toBe(0x23);
		expect(selected.text).not.toHaveBeenCalled();
		expect(selected.arrayBuffer).not.toHaveBeenCalled();
		expect(picker).toHaveBeenCalledWith(
			expect.objectContaining({ multiple: false, types: expect.any(Array) }),
		);
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it("rejects a declared overflow before opening the file stream", async () => {
		const reader = createSequenceReader([]);
		const selected = createTestFile(
			"oversized-stations.csv",
			OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES + 1,
			reader,
		);
		installNativePicker(selected.file);
		const gateway = new BrowserOpenFabStationProposalFileGateway();

		await expect(gateway.chooseOpen()).rejects.toThrow("16 MiB");
		expect(selected.stream).not.toHaveBeenCalled();
		expect(selected.text).not.toHaveBeenCalled();
		expect(selected.arrayBuffer).not.toHaveBeenCalled();
	});

	it("enforces the cumulative stream bound when declared metadata is inaccurate", async () => {
		const oversizedChunk = new Uint8Array(OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES + 1);
		const reader = createSequenceReader([oversizedChunk]);
		const selected = createTestFile(
			"inaccurate-size.csv",
			OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES,
			reader,
		);
		installNativePicker(selected.file);
		const gateway = new BrowserOpenFabStationProposalFileGateway();

		await expect(gateway.chooseOpen()).rejects.toThrow("16 MiB");
		expect(reader.cancel).toHaveBeenCalledOnce();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it("cancels an active stream and rejects with AbortError", async () => {
		let resolveRead: ((value: ReadableStreamReadResult<Uint8Array>) => void) | undefined;
		const read = vi.fn(
			() =>
				new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
					resolveRead = resolve;
				}),
		);
		const reader: TestByteReader = {
			read,
			cancel: vi.fn(async () => {
				resolveRead?.({ done: true, value: undefined });
			}),
			releaseLock: vi.fn(),
		};
		const selected = createTestFile("abortable.csv", 1, reader);
		installNativePicker(selected.file);
		const gateway = new BrowserOpenFabStationProposalFileGateway();
		const controller = new AbortController();

		const pending = gateway.chooseOpen(controller.signal);
		await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(reader.cancel).toHaveBeenCalled();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it("treats native picker cancellation as no selection", async () => {
		vi.stubGlobal("window", {
			showOpenFilePicker: vi.fn(async () => {
				throw new DOMException("Cancelled by user", "AbortError");
			}),
		});
		const gateway = new BrowserOpenFabStationProposalFileGateway();

		await expect(gateway.chooseOpen()).resolves.toBeNull();
	});

	it("aborts promptly while native picker or file materialization remains pending", async () => {
		let resolvePicker:
			| ((
					handles: readonly {
						readonly kind: "file";
						readonly name: string;
						getFile(): Promise<File>;
					}[],
			  ) => void)
			| undefined;
		const picker = vi.fn(
			() =>
				new Promise<
					readonly {
						readonly kind: "file";
						readonly name: string;
						getFile(): Promise<File>;
					}[]
				>((resolve) => {
					resolvePicker = resolve;
				}),
		);
		vi.stubGlobal("window", { showOpenFilePicker: picker });
		const pickerController = new AbortController();
		const pickerPending = new BrowserOpenFabStationProposalFileGateway().chooseOpen(
			pickerController.signal,
		);
		pickerController.abort();
		await expect(pickerPending).rejects.toMatchObject({ name: "AbortError" });
		expect(picker).toHaveBeenCalledOnce();

		let resolveFile: ((file: File) => void) | undefined;
		const getFile = vi.fn(
			() =>
				new Promise<File>((resolve) => {
					resolveFile = resolve;
				}),
		);
		vi.stubGlobal("window", {
			showOpenFilePicker: vi.fn(async () => [
				{ kind: "file" as const, name: "pending.csv", getFile },
			]),
		});
		const fileController = new AbortController();
		const filePending = new BrowserOpenFabStationProposalFileGateway().chooseOpen(
			fileController.signal,
		);
		await vi.waitFor(() => expect(getFile).toHaveBeenCalledOnce());
		fileController.abort();
		await expect(filePending).rejects.toMatchObject({ name: "AbortError" });

		// Settle both abandoned browser promises to prove their late values are observed and ignored.
		resolvePicker?.([]);
		const late = createTestFile("late.csv", 0, createSequenceReader([]));
		resolveFile?.(late.file);
		await Promise.resolve();
		expect(late.stream).not.toHaveBeenCalled();
	});

	it("removes fallback input state after success and external abort", async () => {
		const successfulInput = new TestFileInput();
		const abortedInput = new TestFileInput();
		const inputs = [successfulInput, abortedInput];
		const append = vi.fn();
		vi.stubGlobal("document", {
			createElement: vi.fn(() => inputs.shift()),
			body: { append },
		});
		const gateway = new BrowserOpenFabStationProposalFileGateway({
			forceFileInputFallback: true,
		});
		const selected = createTestFile("fallback.csv", 2, createSequenceReader([Uint8Array.of(7, 9)]));

		const successful = gateway.chooseOpen();
		successfulInput.files = [selected.file] as unknown as FileList;
		successfulInput.dispatch("change");
		await expect(successful).resolves.toMatchObject({ displayName: "fallback.csv" });
		expect(successfulInput.removed).toBe(true);
		expect(successfulInput.listenerCount()).toBe(0);

		const controller = new AbortController();
		const aborted = gateway.chooseOpen(controller.signal);
		controller.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		expect(abortedInput.removed).toBe(true);
		expect(abortedInput.listenerCount()).toBe(0);
		expect(append).toHaveBeenCalledTimes(2);
	});
});

function installNativePicker(file: File) {
	const picker = vi.fn(async () => [
		{
			kind: "file" as const,
			name: file.name,
			getFile: async () => file,
		},
	]);
	vi.stubGlobal("window", { showOpenFilePicker: picker });
	return picker;
}

function createTestFile(name: string, size: number, reader: TestByteReader) {
	const stream = vi.fn(() => ({ getReader: () => reader }));
	const text = vi.fn(async () => "not used");
	const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
	const file = {
		name,
		size,
		stream,
		text,
		arrayBuffer,
	} as unknown as File;
	return { file, stream, text, arrayBuffer };
}

function createSequenceReader(chunks: readonly Uint8Array[]): TestByteReader {
	let index = 0;
	return {
		read: vi.fn(async () => {
			const value = chunks[index];
			index += 1;
			return value
				? ({ done: false, value } satisfies ReadableStreamReadValueResult<Uint8Array>)
				: ({ done: true, value: undefined } satisfies ReadableStreamReadDoneResult<Uint8Array>);
		}),
		cancel: vi.fn(async () => undefined),
		releaseLock: vi.fn(),
	};
}

class TestFileInput {
	type = "";
	accept = "";
	hidden = false;
	files: FileList | null = null;
	removed = false;
	readonly click = vi.fn();
	private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

	addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
		const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
		this.listeners.get(type)?.delete(listener);
	}

	remove(): void {
		this.removed = true;
	}

	dispatch(type: string): void {
		const event = { type } as Event;
		for (const listener of this.listeners.get(type) ?? []) {
			if (typeof listener === "function") listener(event);
			else listener.handleEvent(event);
		}
	}

	listenerCount(): number {
		let count = 0;
		for (const listeners of this.listeners.values()) count += listeners.size;
		return count;
	}
}
