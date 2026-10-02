import type { RailDocument } from "../core/RailDocument";
import type { OpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import type { OpenFabProjectManifest } from "../project/OpenFabProject";
import type { RailWorkerBridgeHandle } from "../worker/RailWorkerBridge";

export interface OpenFabProjectSaveContext {
	readonly manifest: OpenFabProjectManifest;
	readonly blueprints: OpenFabProjectBlueprintSection;
	readonly blueprintGeneration: number;
	readonly projectGeneration: number;
}

/** A source receipt survives the end of a save operation, but never another authored generation. */
export function captureOpenFabProjectSaveSource(
	document: RailDocument,
	mirror: Pick<RailWorkerBridgeHandle, "getState">,
	context: OpenFabProjectSaveContext,
	currentContext: () => OpenFabProjectSaveContext,
	ownsDocument: () => boolean,
) {
	const map = document.map;
	const generation = map.getMutationGeneration();
	const sequence = document.getPatchSequence();
	const revision = map.getRevision();
	const cursor = map.getAdvancedSwitchIdCursor();
	const ports = document.portEquipment;
	const organizations = document.organizations;
	const relationships = document.relationships;
	const operations = document.operationalConfiguration;
	const initialMirror = mirror.getState();
	const epoch = initialMirror.epoch;
	const checksum = initialMirror.targetChecksum;
	const isProjectCurrent = (): boolean => {
		const current = currentContext();
		return (
			ownsDocument() &&
			document.map === map &&
			current.projectGeneration === context.projectGeneration &&
			current.manifest.id === context.manifest.id &&
			current.manifest.name === context.manifest.name &&
			current.manifest.createdAt === context.manifest.createdAt
		);
	};
	const isCurrent = (): boolean => {
		const current = currentContext();
		return (
			isProjectCurrent() &&
			map.getMutationGeneration() === generation &&
			document.getPatchSequence() === sequence &&
			map.getRevision() === revision &&
			map.getAdvancedSwitchIdCursor() === cursor &&
			document.portEquipment === ports &&
			document.organizations === organizations &&
			document.relationships === relationships &&
			document.operationalConfiguration === operations &&
			current.blueprints === context.blueprints &&
			current.blueprintGeneration === context.blueprintGeneration
		);
	};
	const isMirrorCurrent = (): boolean => {
		const state = mirror.getState();
		return (
			state.epoch === epoch &&
			state.targetSequence === sequence &&
			state.targetRevision === revision &&
			state.targetChecksum === checksum
		);
	};
	return Object.freeze({ isProjectCurrent, isCurrent, isMirrorCurrent });
}
