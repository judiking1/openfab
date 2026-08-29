import {
	copyStaticFabOrganizationState,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationColor,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "../core/StaticFabOrganization";

export const OPENFAB_ORGANIZATION_SECTION_SCHEMA_VERSION = 2 as const;
export const OPENFAB_PROJECT_MAX_ORGANIZATIONS = 100_000;
export const OPENFAB_PROJECT_MAX_ORGANIZATION_EDGES = 5_000_000;

export type OpenFabOrganizationRailEdgeTuple = readonly [
	fromX: number,
	fromZ: number,
	toX: number,
	toZ: number,
];

export interface OpenFabProjectOrganizationMembership {
	readonly railEdges: readonly OpenFabOrganizationRailEdgeTuple[];
	readonly advancedSwitchIds: readonly number[];
	readonly equipmentGroupIds: readonly number[];
}

export interface OpenFabProjectOrganizationRecord {
	readonly id: number;
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	readonly parentOrganizationIds: readonly number[];
	readonly properties: OpenFabProjectOrganizationProperties;
	readonly membership: OpenFabProjectOrganizationMembership;
}

export interface OpenFabProjectOrganizationProperties {
	readonly description: string;
	readonly color: StaticFabOrganizationColor;
}

export interface OpenFabProjectOrganizationSection {
	readonly schemaVersion: typeof OPENFAB_ORGANIZATION_SECTION_SCHEMA_VERSION;
	readonly nextOrganizationId: number;
	readonly records: readonly OpenFabProjectOrganizationRecord[];
}

export function createEmptyOpenFabProjectOrganizationSection(): OpenFabProjectOrganizationSection {
	return Object.freeze({
		schemaVersion: OPENFAB_ORGANIZATION_SECTION_SCHEMA_VERSION,
		nextOrganizationId: 1,
		records: Object.freeze([]),
	});
}

export function captureOpenFabProjectOrganizationSection(
	state: StaticFabOrganizationState,
): OpenFabProjectOrganizationSection {
	const canonical = copyStaticFabOrganizationState(state);
	return Object.freeze({
		schemaVersion: OPENFAB_ORGANIZATION_SECTION_SCHEMA_VERSION,
		nextOrganizationId: canonical.nextOrganizationId,
		records: Object.freeze(
			canonical.records.map((record) =>
				Object.freeze({
					id: record.id,
					kind: record.kind,
					name: record.name,
					parentOrganizationIds: Object.freeze([...staticFabOrganizationParentIds(record)]),
					properties: Object.freeze({ ...staticFabOrganizationProperties(record) }),
					membership: Object.freeze({
						railEdges: Object.freeze(
							record.membership.railEdges.map((edge) =>
								Object.freeze([edge.from.x, edge.from.y, edge.to.x, edge.to.y] as const),
							),
						),
						advancedSwitchIds: Object.freeze([...record.membership.advancedSwitchIds]),
						equipmentGroupIds: Object.freeze([...record.membership.equipmentGroupIds]),
					}),
				}),
			),
		),
	});
}

export function createStaticFabOrganizationStateFromOpenFabProjectSection(
	section: OpenFabProjectOrganizationSection,
): StaticFabOrganizationState {
	if (section.records.length === 0 && section.nextOrganizationId === 1) {
		return emptyStaticFabOrganizationState();
	}
	return copyStaticFabOrganizationState({
		nextOrganizationId: section.nextOrganizationId,
		records: section.records.map((record) => ({
			id: record.id,
			kind: record.kind,
			name: record.name,
			parentOrganizationIds: record.parentOrganizationIds,
			properties: record.properties,
			membership: {
				railEdges: record.membership.railEdges.map(([fromX, fromZ, toX, toZ]) => ({
					from: { x: fromX, y: fromZ },
					to: { x: toX, y: toZ },
				})),
				advancedSwitchIds: record.membership.advancedSwitchIds,
				equipmentGroupIds: record.membership.equipmentGroupIds,
			},
		})),
	});
}
