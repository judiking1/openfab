import {
	emptyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import type { OpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import {
	captureOpenFabProjectFromRailSnapshot,
	type OpenFabProjectManifest,
	type OpenFabProjectView,
} from "../project/OpenFabProject";
import { serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

export interface SerializedOpenFabProject {
	readonly json: string;
	readonly authoredChecksum: string;
	readonly characterCount: number;
	readonly elapsedMilliseconds: number;
}

export function serializeOpenFabProjectSnapshot(
	snapshot: RailMirrorSnapshot,
	manifest: OpenFabProjectManifest,
	view: OpenFabProjectView | null,
	blueprints: OpenFabProjectBlueprintSection,
	operations: OperationalConfigurationState = emptyOperationalConfigurationState(),
	now: () => number = () => performance.now(),
): SerializedOpenFabProject {
	const startedAt = now();
	const project = captureOpenFabProjectFromRailSnapshot(snapshot, {
		manifest,
		view,
		blueprints,
		operations,
	});
	const json = serializeOpenFabProject(project);
	return Object.freeze({
		json,
		authoredChecksum: snapshot.checksum,
		characterCount: json.length,
		elapsedMilliseconds: Math.max(0, now() - startedAt),
	});
}
