import type { OperationalConfigurationState } from "./OperationalConfiguration";
import { ALL_DIRECTIONS, moveCell } from "./railShape";
import type { StaticFabAssemblyRelationshipRecordV1 } from "./StaticFabAssemblyRelationship";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import type { TileMap } from "./TileMap";
export const STATIC_FAB_SEMANTIC_DELETE_ID_SAMPLE_LIMIT = 8;
export interface StaticFabSemanticDeleteImpactSample {
	readonly count: number;
	readonly idSample: readonly (number | string)[];
	readonly omittedCount: number;
}
export const STATIC_FAB_SEMANTIC_DELETE_IMPACT_KEYS = [
	"organizations",
	"bays",
	"loops",
	"banks",
	"fabs",
	"railModules",
	"advancedSwitches",
	"equipmentGroups",
	"ports",
	"relationships",
	"corridors",
	"directedEdges",
] as const;
export type StaticFabSemanticDeleteImpact = Readonly<
	Record<
		(typeof STATIC_FAB_SEMANTIC_DELETE_IMPACT_KEYS)[number],
		StaticFabSemanticDeleteImpactSample
	>
>;
export function assertNoOperationalReferences(
	state: OperationalConfigurationState,
	groups: ReadonlySet<number>,
	ports: ReadonlySet<number>,
	targetLabel = "Bank",
): void {
	const port =
		state.stationCapabilities.find((row) => ports.has(row.portId))?.portId ??
		state.eqPortQualificationOverrides.find((row) => ports.has(row.portId))?.portId ??
		state.residentHomeSlots.find((row) => ports.has(row.anchorPortId))?.anchorPortId;
	if (port !== undefined)
		failStaticFabSemanticDelete(
			"EXTERNAL_OPERATIONAL_REFERENCE",
			`PORT-${port}를 참조하는 운영 설정이 있어 ${targetLabel}를 삭제할 수 없습니다`,
		);
	const group =
		state.eqGroupQualifications.find((row) => groups.has(row.equipmentGroupId))?.equipmentGroupId ??
		state.storageGroups.find((row) => groups.has(row.equipmentGroupId))?.equipmentGroupId;
	if (group !== undefined)
		failStaticFabSemanticDelete(
			"EXTERNAL_OPERATIONAL_REFERENCE",
			`장비 ${group}를 참조하는 운영 설정이 있어 ${targetLabel}를 삭제할 수 없습니다`,
		);
}
export function relationshipOrganizationIds(row: StaticFabAssemblyRelationshipRecordV1): number[] {
	const result = [
		row.parentOrganizationId,
		...row.participantOrganizationIds,
		...row.managedChildOrganizationIds,
	];
	for (const group of row.connectionGroups)
		for (const leg of group.legs)
			for (const edge of [
				...leg.exclusiveCutEdges,
				...leg.endpointSupports.map((support) => support.support),
				...leg.seamContacts.flatMap((contact) =>
					contact.incidences.flatMap((incidence) =>
						incidence.binding.kind === "WITNESS" ? [incidence.binding.scopedEdge] : [],
					),
				),
			])
				if (edge.scope.kind !== "PARENT_DIRECT")
					result.push(...edge.scope.directOwnerOrganizationIds);
	return result;
}
function sample(
	ids: readonly (number | string)[],
	count = ids.length,
): StaticFabSemanticDeleteImpactSample {
	const sorted = [...ids].sort((a, b) =>
		typeof a === "number" && typeof b === "number"
			? a - b
			: String(a) < String(b)
				? -1
				: String(a) > String(b)
					? 1
					: 0,
	);
	const idSample = Object.freeze(sorted.slice(0, STATIC_FAB_SEMANTIC_DELETE_ID_SAMPLE_LIMIT));
	return Object.freeze({ count, idSample, omittedCount: count - idSample.length });
}
export function createStaticFabSemanticDeleteImpact(
	state: StaticFabOrganizationState,
	rows: StaticFabOrganizationState["records"],
	moduleKeys: readonly string[],
	switchIds: readonly number[],
	groups: readonly number[],
	ports: readonly number[],
	relationships: readonly StaticFabAssemblyRelationshipRecordV1[],
	edgeCount: number,
	edgeIds: readonly string[],
): StaticFabSemanticDeleteImpact {
	const roles = deriveStaticFabOrganizationSemanticRoles(state);
	const roleIds = (role: string) =>
		rows.filter((row) => roles.get(row.id) === role).map((row) => row.id);
	return Object.freeze({
		organizations: sample(rows.map((row) => row.id)),
		bays: sample(roleIds("BAY")),
		loops: sample(roleIds("PROCESS_LOOP")),
		banks: sample(roleIds("BAY_BANK")),
		fabs: sample(roleIds("FAB")),
		railModules: sample(moduleKeys),
		advancedSwitches: sample(switchIds),
		equipmentGroups: sample(groups),
		ports: sample(ports),
		relationships: sample(relationships.map((row) => row.id)),
		corridors: sample(
			relationships.flatMap((row) =>
				row.connectionGroups.flatMap((group, gi) =>
					group.legs.map((_leg, li) => `${row.id}:${gi}:${li}`),
				),
			),
		),
		directedEdges: sample(edgeIds, edgeCount),
	});
}
export class StaticFabSemanticDeleteFailure extends Error {
	readonly code: string;
	constructor(code: string, reason: string) {
		super(reason);
		this.code = code;
	}
}
export function failStaticFabSemanticDelete(code: string, reason: string): never {
	throw new StaticFabSemanticDeleteFailure(code, reason);
}
export function staticFabSemanticDeleteErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "삭제 범위를 검토할 수 없습니다";
}

export function staticFabSemanticDeleteDirectedEdgeSample(
	map: TileMap,
	retained?: TileMap,
): readonly string[] {
	const result: string[] = [];
	map.forEachRail((x, y, rail) => {
		for (const direction of ALL_DIRECTIONS) {
			if (!(rail.outgoing & direction) || (retained && retained.getRail(x, y).outgoing & direction))
				continue;
			result.push(
				staticFabOrganizationEdgeKey({ from: { x, y }, to: moveCell({ x, y }, direction) }),
			);
			result.sort();
			if (result.length > STATIC_FAB_SEMANTIC_DELETE_ID_SAMPLE_LIMIT) result.pop();
		}
	});
	return result;
}
