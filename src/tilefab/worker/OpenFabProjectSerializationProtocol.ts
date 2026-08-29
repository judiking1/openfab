import type { OperationalConfigurationState } from "../core/OperationalConfiguration";
import type { OpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import type { OpenFabProjectManifest, OpenFabProjectView } from "../project/OpenFabProject";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export interface OpenFabProjectSerializationRequest {
	readonly type: "SERIALIZE_OPENFAB_PROJECT";
	readonly requestId: number;
	readonly manifest: OpenFabProjectManifest;
	readonly view: OpenFabProjectView | null;
	readonly blueprints: OpenFabProjectBlueprintSection;
	readonly operations: OperationalConfigurationState;
	readonly snapshot: RailMirrorSnapshot;
}

export type OpenFabProjectSerializationResponse =
	| {
			readonly type: "OPENFAB_PROJECT_SERIALIZED";
			readonly requestId: number;
			readonly json: string;
			readonly authoredChecksum: string;
			readonly characterCount: number;
			readonly elapsedMilliseconds: number;
	  }
	| {
			readonly type: "OPENFAB_PROJECT_SERIALIZATION_ERROR";
			readonly requestId: number;
			readonly message: string;
	  };
