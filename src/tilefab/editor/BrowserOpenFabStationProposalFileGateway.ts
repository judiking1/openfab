import {
	OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES,
	type OpenFabStationProposalFileGateway,
	type OpenFabStationProposalFileRead,
} from "../project/OpenFabStationProposalPorts";

const STATION_PROPOSAL_FILE_TYPES = Object.freeze([
	Object.freeze({
		description: "OpenFab station proposal",
		accept: Object.freeze({
			"text/csv": Object.freeze([".csv"]),
			"text/plain": Object.freeze([".map", ".txt"]),
		}),
	}),
]);

const STATION_PROPOSAL_INPUT_ACCEPT = ".csv,.map,.txt,text/csv,text/plain";

interface BrowserStationProposalFileHandle {
	readonly kind: "file";
	readonly name: string;
	getFile(): Promise<File>;
}

type BrowserStationProposalOpenPicker = (options: {
	readonly multiple: false;
	readonly types: typeof STATION_PROPOSAL_FILE_TYPES;
}) => Promise<readonly BrowserStationProposalFileHandle[]>;

export interface BrowserOpenFabStationProposalFileGatewayOptions {
	readonly forceFileInputFallback?: boolean;
}

export class BrowserOpenFabStationProposalFileGateway implements OpenFabStationProposalFileGateway {
	private readonly forceFileInputFallback: boolean;

	constructor(options: BrowserOpenFabStationProposalFileGatewayOptions = {}) {
		this.forceFileInputFallback = options.forceFileInputFallback ?? false;
	}

	async chooseOpen(signal?: AbortSignal): Promise<OpenFabStationProposalFileRead | null> {
		throwIfAborted(signal);
		const picker = this.forceFileInputFallback
			? null
			: browserFunction<BrowserStationProposalOpenPicker>("showOpenFilePicker");
		if (!picker) return chooseStationProposalWithInput(signal);

		let handles: readonly BrowserStationProposalFileHandle[];
		try {
			// Invoke the picker synchronously so the browser still associates it with the user's
			// activation, then race only the returned promise against cancellation.
			handles = await awaitWithAbort(
				picker({ multiple: false, types: STATION_PROPOSAL_FILE_TYPES }),
				signal,
			);
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
		return readStationProposalFile(file, signal);
	}
}

async function chooseStationProposalWithInput(
	signal?: AbortSignal,
): Promise<OpenFabStationProposalFileRead | null> {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = STATION_PROPOSAL_INPUT_ACCEPT;
		input.hidden = true;
		let settled = false;

		const cleanup = (): void => {
			input.removeEventListener("change", change);
			input.removeEventListener("cancel", cancel);
			signal?.removeEventListener("abort", abort);
			input.remove();
		};
		const resolveOnce = (result: OpenFabStationProposalFileRead | null): void => {
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
				const result = await readStationProposalFile(file, signal);
				resolveOnce(result);
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

async function readStationProposalFile(
	file: File,
	signal?: AbortSignal,
): Promise<OpenFabStationProposalFileRead> {
	assertStationProposalByteCount(file.size);
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
				throw new TypeError("Station proposal stream must contain byte chunks.");
			}

			const nextByteCount = byteCount + chunk.value.byteLength;
			assertStationProposalByteCount(nextByteCount);
			if (nextByteCount > file.size) {
				throw new Error("Station proposal stream exceeds its declared file size.");
			}
			bytes.set(chunk.value, byteCount);
			byteCount = nextByteCount;
		}

		if (byteCount !== file.size) {
			throw new Error("Station proposal stream does not match its declared file size.");
		}
		throwIfAborted(signal);
		return Object.freeze({ displayName: file.name, bytes: bytes.buffer });
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		signal?.removeEventListener("abort", abort);
		reader.releaseLock();
	}
}

function assertStationProposalByteCount(bytes: number): void {
	if (!Number.isSafeInteger(bytes) || bytes < 0) {
		throw new TypeError("Station proposal file size must be a non-negative safe integer.");
	}
	if (bytes > OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES) {
		throw new RangeError("Station proposal file exceeds the 16 MiB byte budget.");
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
	return new DOMException("Station proposal file selection was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
