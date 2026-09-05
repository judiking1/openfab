import {
	copyStaticFabAssemblyRelationshipState,
	emptyStaticFabAssemblyRelationshipState,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
} from "../core/StaticFabAssemblyRelationship";

export const OPENFAB_RELATIONSHIP_SECTION_SCHEMA_VERSION = 1 as const;

/** Native-project envelope for the canonical authored assembly-relationship V1 state. */
export interface OpenFabProjectRelationshipSection {
	readonly schemaVersion: typeof OPENFAB_RELATIONSHIP_SECTION_SCHEMA_VERSION;
	readonly nextRelationshipId: number;
	readonly records: readonly StaticFabAssemblyRelationshipRecordV1[];
}

export function createEmptyOpenFabProjectRelationshipSection(): OpenFabProjectRelationshipSection {
	return Object.freeze({
		schemaVersion: OPENFAB_RELATIONSHIP_SECTION_SCHEMA_VERSION,
		nextRelationshipId: 1,
		records: Object.freeze([]),
	});
}

export function captureOpenFabProjectRelationshipSection(
	state: StaticFabAssemblyRelationshipStateV1,
): OpenFabProjectRelationshipSection {
	const canonical = copyStaticFabAssemblyRelationshipState(state);
	return Object.freeze({
		schemaVersion: OPENFAB_RELATIONSHIP_SECTION_SCHEMA_VERSION,
		nextRelationshipId: canonical.nextRelationshipId,
		records: canonical.records,
	});
}

export function createStaticFabAssemblyRelationshipStateFromOpenFabProjectSection(
	section: OpenFabProjectRelationshipSection,
): StaticFabAssemblyRelationshipStateV1 {
	if (section.records.length === 0 && section.nextRelationshipId === 1) {
		return emptyStaticFabAssemblyRelationshipState();
	}
	return copyStaticFabAssemblyRelationshipState({
		nextRelationshipId: section.nextRelationshipId,
		records: section.records,
	});
}
