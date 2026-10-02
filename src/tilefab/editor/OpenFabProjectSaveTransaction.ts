import type {
	OpenFabProjectFileReference,
	OpenFabProjectWriteCapability,
} from "../project/OpenFabProjectPorts";
import { RailStartupCancelledError } from "./RailStartupBridge";

export interface PreparedOpenFabProjectSave {
	readonly json: string;
}

export type OpenFabProjectSaveTransactionResult<T extends PreparedOpenFabProjectSave> =
	| Readonly<{ status: "cancelled" }>
	| Readonly<{ status: "written"; reference: OpenFabProjectFileReference; prepared: T }>;

/** Acquire user-action authority before any asynchronous project preparation. */
export async function saveOpenFabProject<T extends PreparedOpenFabProjectSave>(options: {
	readonly acquireWrite: () => Promise<OpenFabProjectWriteCapability | null>;
	readonly prepare: () => Promise<T>;
	readonly assertCurrent: () => void;
}): Promise<OpenFabProjectSaveTransactionResult<T>> {
	const destination = await options.acquireWrite();
	if (!destination) return Object.freeze({ status: "cancelled" });
	options.assertCurrent();
	const prepared = await options.prepare();
	options.assertCurrent();
	const reference = await destination.commit(prepared.json);
	// close() may already have committed the bytes. The caller must retain this receipt even
	// when the operation or source changed during close, rather than report cancellation.
	return Object.freeze({ status: "written", reference, prepared });
}

/** Metadata may finish in the adapter, but an aborted save must stop waiting and release its UI. */
export function awaitOpenFabProjectSaveMetadata<T>(
	operation: () => Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) return Promise.reject(new RailStartupCancelledError());
	return new Promise<T>((resolve, reject) => {
		const abort = (): void => {
			cleanup();
			reject(new RailStartupCancelledError());
		};
		const cleanup = (): void => signal.removeEventListener("abort", abort);
		signal.addEventListener("abort", abort, { once: true });
		try {
			operation().then(
				(value) => {
					cleanup();
					resolve(value);
				},
				(error: unknown) => {
					cleanup();
					reject(error);
				},
			);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}
