import type {
	OpenFabUserBlueprintLibraryRestoreWorkerRequest,
	OpenFabUserBlueprintLibraryRestoreWorkerResponse,
} from "./OpenFabUserBlueprintLibraryRestoreProtocol";
import { OpenFabUserBlueprintLibraryRestoreRuntime } from "./OpenFabUserBlueprintLibraryRestoreRuntime";

const runtime = new OpenFabUserBlueprintLibraryRestoreRuntime();

self.onmessage = (event: MessageEvent<OpenFabUserBlueprintLibraryRestoreWorkerRequest>): void => {
	const response: OpenFabUserBlueprintLibraryRestoreWorkerResponse = runtime.handle(event.data);
	self.postMessage(response);
};
