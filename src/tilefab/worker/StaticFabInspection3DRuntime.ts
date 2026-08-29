import {
	compileStaticFabInspection3DChunkedArtifact,
	type StaticFabInspection3DChunkedArtifact,
	type StaticFabInspection3DSourceSnapshot,
} from "../render/StaticFabInspection3DArtifact";

export interface StaticFabInspection3DWorkerRequest {
	readonly type: "COMPILE_STATIC_FAB_INSPECTION_3D";
	readonly requestId: number;
	readonly snapshot: StaticFabInspection3DSourceSnapshot;
}

export type StaticFabInspection3DWorkerResponse =
	| {
			readonly type: "STATIC_FAB_INSPECTION_3D_COMPILED";
			readonly requestId: number;
			readonly artifact: StaticFabInspection3DChunkedArtifact;
	  }
	| {
			readonly type: "STATIC_FAB_INSPECTION_3D_ERROR";
			readonly requestId: number;
			readonly message: string;
	  };

export function compileStaticFabInspection3DWorkerRequest(
	request: StaticFabInspection3DWorkerRequest,
): StaticFabInspection3DChunkedArtifact {
	if (request.type !== "COMPILE_STATIC_FAB_INSPECTION_3D") {
		throw new TypeError("3D inspection Worker request type is invalid.");
	}
	if (!Number.isSafeInteger(request.requestId) || request.requestId <= 0) {
		throw new RangeError("3D inspection Worker request id is invalid.");
	}
	return compileStaticFabInspection3DChunkedArtifact(request.snapshot);
}
