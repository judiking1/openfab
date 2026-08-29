/// <reference lib="webworker" />

import { collectStaticFabInspection3DChunkedArtifactTransferBuffers } from "../render/StaticFabInspection3DArtifact";
import {
	compileStaticFabInspection3DWorkerRequest,
	type StaticFabInspection3DWorkerRequest,
	type StaticFabInspection3DWorkerResponse,
} from "./StaticFabInspection3DRuntime";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<StaticFabInspection3DWorkerRequest>): void => {
	const request = event.data;
	const requestId = Number.isSafeInteger(request?.requestId) ? request.requestId : 0;
	try {
		const artifact = compileStaticFabInspection3DWorkerRequest(request);
		const response: StaticFabInspection3DWorkerResponse = {
			type: "STATIC_FAB_INSPECTION_3D_COMPILED",
			requestId,
			artifact,
		};
		self.postMessage(response, {
			transfer: collectStaticFabInspection3DChunkedArtifactTransferBuffers(artifact),
		});
	} catch (error) {
		const response: StaticFabInspection3DWorkerResponse = {
			type: "STATIC_FAB_INSPECTION_3D_ERROR",
			requestId,
			message:
				error instanceof Error ? error.message : "Unknown 3D inspection compilation failure.",
		};
		self.postMessage(response);
	}
};
