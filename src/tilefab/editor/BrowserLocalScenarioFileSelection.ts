export interface BrowserLocalScenarioFileType {
	readonly description: string;
	readonly accept: Readonly<Record<string, readonly string[]>>;
}

export interface BrowserLocalScenarioFileSelectionOptions<Result> {
	readonly fileTypes: readonly BrowserLocalScenarioFileType[];
	readonly inputAccept: string;
	readonly maximumByteLength: number;
	readonly byteBudgetLabel: string;
	readonly decode: (bytes: ArrayBuffer) => Result;
	readonly forceFileInputFallback?: boolean;
}

interface BrowserLocalScenarioFileHandle {
	readonly kind: "file";
	getFile(): Promise<File>;
}

type BrowserLocalScenarioOpenPicker = (options: {
	readonly multiple: false;
	readonly types: readonly BrowserLocalScenarioFileType[];
}) => Promise<readonly BrowserLocalScenarioFileHandle[]>;

/** Shared browser transport for bounded local scenario envelopes. No local identity escapes it. */
export async function chooseBrowserLocalScenarioFile<Result>(
	options: BrowserLocalScenarioFileSelectionOptions<Result>,
	signal?: AbortSignal,
): Promise<Result | null> {
	assertOptions(options);
	throwIfAborted(signal);
	const picker = options.forceFileInputFallback
		? null
		: browserFunction<BrowserLocalScenarioOpenPicker>("showOpenFilePicker");
	if (!picker) return chooseWithInput(options, signal);

	let handles: readonly BrowserLocalScenarioFileHandle[];
	try {
		handles = await awaitWithAbort(picker({ multiple: false, types: options.fileTypes }), signal);
	} catch (error) {
		if (signal?.aborted) throw createAbortError();
		if (isAbortError(error)) return null;
		throw error;
	}
	throwIfAborted(signal);
	const handle = handles[0];
	if (!handle) return null;
	const file = await awaitWithAbort(handle.getFile(), signal);
	throwIfAborted(signal);
	return readFile(file, options, signal);
}

function chooseWithInput<Result>(
	options: BrowserLocalScenarioFileSelectionOptions<Result>,
	signal?: AbortSignal,
): Promise<Result | null> {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = options.inputAccept;
		input.hidden = true;
		let settled = false;

		const cleanup = (): void => {
			input.removeEventListener("change", change);
			input.removeEventListener("cancel", cancel);
			signal?.removeEventListener("abort", abort);
			input.remove();
		};
		const resolveOnce = (result: Result | null): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(result);
		};
		const rejectOnce = (error: unknown): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const cancel = (): void => resolveOnce(null);
		const abort = (): void => rejectOnce(createAbortError());
		const change = (): void => {
			void (async () => {
				const file = input.files?.[0];
				if (!file) return resolveOnce(null);
				resolveOnce(await readFile(file, options, signal));
			})().catch(rejectOnce);
		};

		input.addEventListener("change", change);
		input.addEventListener("cancel", cancel);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) return abort();
		try {
			document.body.append(input);
			input.click();
		} catch (error) {
			rejectOnce(error);
		}
	});
}

async function readFile<Result>(
	file: File,
	options: BrowserLocalScenarioFileSelectionOptions<Result>,
	signal?: AbortSignal,
): Promise<Result> {
	assertByteCount(file.size, options);
	throwIfAborted(signal);
	const bytes = new Uint8Array(file.size);
	const reader = file.stream().getReader();
	let byteCount = 0;
	const abort = (): void => {
		void reader.cancel(createAbortError()).catch(() => undefined);
	};
	signal?.addEventListener("abort", abort, { once: true });
	try {
		while (true) {
			throwIfAborted(signal);
			const chunk = await reader.read();
			throwIfAborted(signal);
			if (chunk.done) break;
			if (!(chunk.value instanceof Uint8Array)) {
				throw new TypeError("Scenario file stream must contain byte chunks.");
			}
			const nextByteCount = byteCount + chunk.value.byteLength;
			assertByteCount(nextByteCount, options);
			if (nextByteCount > file.size) {
				throw new Error("Scenario file stream exceeds its declared file size.");
			}
			bytes.set(chunk.value, byteCount);
			byteCount = nextByteCount;
		}
		if (byteCount !== file.size) {
			throw new Error("Scenario file stream does not match its declared file size.");
		}
		throwIfAborted(signal);
		return options.decode(bytes.buffer);
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		signal?.removeEventListener("abort", abort);
		reader.releaseLock();
	}
}

function assertOptions<Result>(options: BrowserLocalScenarioFileSelectionOptions<Result>): void {
	if (!Array.isArray(options.fileTypes) || options.fileTypes.length === 0) {
		throw new TypeError("Scenario file picker types are invalid.");
	}
	if (typeof options.inputAccept !== "string" || options.inputAccept.length === 0) {
		throw new TypeError("Scenario file input accept policy is invalid.");
	}
	if (
		!Number.isSafeInteger(options.maximumByteLength) ||
		options.maximumByteLength <= 0 ||
		typeof options.byteBudgetLabel !== "string" ||
		options.byteBudgetLabel.length === 0 ||
		typeof options.decode !== "function"
	) {
		throw new TypeError("Scenario file byte/decode policy is invalid.");
	}
}

function assertByteCount<Result>(
	bytes: number,
	options: BrowserLocalScenarioFileSelectionOptions<Result>,
): void {
	if (!Number.isSafeInteger(bytes) || bytes < 0) {
		throw new TypeError("Scenario file size must be a non-negative safe integer.");
	}
	if (bytes > options.maximumByteLength) {
		throw new RangeError(`Scenario file exceeds the ${options.byteBudgetLabel} byte budget.`);
	}
}

function browserFunction<FunctionType>(name: string): FunctionType | null {
	if (typeof window === "undefined") return null;
	const value = Reflect.get(window, name) as unknown;
	return typeof value === "function" ? (value.bind(window) as FunctionType) : null;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw createAbortError();
}

function awaitWithAbort<Value>(promise: Promise<Value>, signal?: AbortSignal): Promise<Value> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(createAbortError());
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = (): void => signal.removeEventListener("abort", abort);
		const abort = (): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(createAbortError());
		};
		signal.addEventListener("abort", abort, { once: true });
		promise.then(
			(value) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(value);
			},
			(error: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			},
		);
	});
}

function createAbortError(): DOMException {
	return new DOMException("Scenario file selection was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
