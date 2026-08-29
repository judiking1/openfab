import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSimulationScenarioEditorFileGateway } from "./BrowserSimulationScenarioEditorFileGateway";
import { SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES } from "./SimulationScenarioEditorRunAssetFile";

interface TestByteReader {
	read(): Promise<ReadableStreamReadResult<Uint8Array>>;
	cancel(reason?: unknown): Promise<void>;
	releaseLock(): void;
}

describe("BrowserSimulationScenarioEditorFileGateway", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("returns only the parsed public draft and discards local file identity", async () => {
		const bytes = new TextEncoder().encode(JSON.stringify(planEnvelope()));
		const selected = createTestFile("private-customer-export.json", bytes.length, [bytes]);
		installNativePicker(selected.file);

		const result = await new BrowserSimulationScenarioEditorFileGateway().chooseOpen(
			"TRANSFER_PLAN",
		);

		expect(result).not.toBeNull();
		if (!result) throw new Error("Expected a scenario draft.");
		expect(Object.keys(result)).toEqual([
			"schemaVersion",
			"source",
			"serviceTimingInput",
			"resourceRunInput",
		]);
		expect(JSON.stringify(result)).not.toContain("private-customer-export");
		expect(result.source.sourceKind).toBe("TRANSFER_PLAN");
		expect(selected.reader.releaseLock).toHaveBeenCalledOnce();
	});

	it("rejects a source selected through the wrong workflow", async () => {
		const bytes = new TextEncoder().encode(JSON.stringify(planEnvelope()));
		const selected = createTestFile("scenario.json", bytes.length, [bytes]);
		installNativePicker(selected.file);

		await expect(
			new BrowserSimulationScenarioEditorFileGateway().chooseOpen("REPLAY_HISTORY"),
		).rejects.toThrow(/Replay History workflow/);
		expect(selected.reader.cancel).toHaveBeenCalledOnce();
		expect(selected.reader.releaseLock).toHaveBeenCalledOnce();
	});

	it("rejects declared overflow before allocating or reading a stream", async () => {
		const selected = createTestFile(
			"oversized.json",
			SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES + 1,
			[],
		);
		installNativePicker(selected.file);

		await expect(
			new BrowserSimulationScenarioEditorFileGateway().chooseOpen("TRANSFER_PLAN"),
		).rejects.toThrow(/16 MiB/);
		expect(selected.stream).not.toHaveBeenCalled();
	});

	it("cancels an active read without publishing a late draft", async () => {
		let resolveRead: ((value: ReadableStreamReadResult<Uint8Array>) => void) | undefined;
		const reader: TestByteReader = {
			read: vi.fn(
				() =>
					new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
						resolveRead = resolve;
					}),
			),
			cancel: vi.fn(async () => resolveRead?.({ done: true, value: undefined })),
			releaseLock: vi.fn(),
		};
		const selected = createTestFileWithReader("pending.json", 1, reader);
		installNativePicker(selected.file);
		const abortController = new AbortController();
		const pending = new BrowserSimulationScenarioEditorFileGateway().chooseOpen(
			"TRANSFER_PLAN",
			abortController.signal,
		);
		await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce());
		abortController.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(reader.cancel).toHaveBeenCalled();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it("supports the fallback input and removes its listeners after selection", async () => {
		const input = new TestFileInput();
		const append = vi.fn();
		vi.stubGlobal("document", {
			createElement: vi.fn(() => input),
			body: { append },
		});
		const bytes = new TextEncoder().encode(JSON.stringify(planEnvelope()));
		const selected = createTestFile("local-only.json", bytes.length, [bytes]);
		const pending = new BrowserSimulationScenarioEditorFileGateway({
			forceFileInputFallback: true,
		}).chooseOpen("TRANSFER_PLAN");

		input.files = [selected.file] as unknown as FileList;
		input.dispatch("change");

		await expect(pending).resolves.toMatchObject({
			schemaVersion: 1,
			source: { sourceKind: "TRANSFER_PLAN", manifestId: "PLAN-PUBLIC-1" },
		});
		expect(input.removed).toBe(true);
		expect(input.listenerCount()).toBe(0);
		expect(append).toHaveBeenCalledOnce();
	});
});

function installNativePicker(file: File): void {
	vi.stubGlobal("window", {
		showOpenFilePicker: vi.fn(async () => [{ kind: "file" as const, getFile: async () => file }]),
	});
}

function createTestFile(name: string, size: number, chunks: readonly Uint8Array[]) {
	let index = 0;
	const reader: TestByteReader = {
		read: vi.fn(async () => {
			const value = chunks[index++];
			return value
				? ({ done: false, value } satisfies ReadableStreamReadValueResult<Uint8Array>)
				: ({ done: true, value: undefined } satisfies ReadableStreamReadDoneResult<Uint8Array>);
		}),
		cancel: vi.fn(async () => undefined),
		releaseLock: vi.fn(),
	};
	return { ...createTestFileWithReader(name, size, reader), reader };
}

function createTestFileWithReader(name: string, size: number, reader: TestByteReader) {
	const stream = vi.fn(() => ({ getReader: () => reader }));
	return {
		file: { name, size, stream } as unknown as File,
		stream,
	};
}

function planEnvelope() {
	return {
		schemaVersion: 1,
		source: {
			sourceKind: "TRANSFER_PLAN",
			manifestId: "PLAN-PUBLIC-1",
			mappingVersion: 1,
			records: [
				{
					transferId: "TRANSFER-1",
					releaseTimeMicroseconds: 0,
					loadId: "LOAD-1",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		},
		serviceTimingInput: {
			eqProcessTimings: [
				{
					sourceOrdinal: 0,
					capabilityId: 1,
					processingDurationMicroseconds: 1_000_000,
				},
			],
		},
		resourceRunInput: {
			eqResources: [
				{
					equipmentGroupId: 1,
					concurrentCapacity: 1,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [],
		},
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
