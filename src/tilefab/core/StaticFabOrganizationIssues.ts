import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import type { EquipmentGroupRecord, PortEquipmentState } from "./EquipmentGroup";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "./RailModuleOwnership";
import { directionBetween, oppositeDirection } from "./railShape";
import {
	normalizeStaticFabOrganizationName,
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_KINDS,
	STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
	STATIC_FAB_ORGANIZATION_MAX_PARENTS,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationMembershipSupportsPortRoute,
} from "./StaticFabOrganization";
import { decodeRailCell, type TileMap } from "./TileMap";

export const STATIC_FAB_ORGANIZATION_ISSUE_CODES = [
	"NEXT_ORGANIZATION_ID_CURSOR_INVALID",
	"NEXT_ORGANIZATION_ID_CURSOR_STALE",
	"ORGANIZATION_RECORD_INVALID",
	"ORGANIZATION_RECORD_ORDER_NONCANONICAL",
	"ORGANIZATION_ID_DUPLICATE",
	"ORGANIZATION_NAME_DUPLICATE",
	"ORGANIZATION_METADATA_INVALID",
	"ORGANIZATION_PARENT_REFERENCE_INVALID",
	"ORGANIZATION_PARENT_MISSING",
	"ORGANIZATION_RELATIONSHIP_ORPHAN",
	"ORGANIZATION_RELATIONSHIP_CYCLE",
	"ORGANIZATION_MEMBERSHIP_EMPTY",
	"ORGANIZATION_MEMBERSHIP_TOKEN_INVALID",
	"ORGANIZATION_MEMBERSHIP_TOKEN_DUPLICATE",
	"ORGANIZATION_MEMBERSHIP_ORDER_NONCANONICAL",
	"ORGANIZATION_RAIL_MEMBER_MISSING",
	"ORGANIZATION_SWITCH_MEMBER_MISSING",
	"ORGANIZATION_EQUIPMENT_MEMBER_MISSING",
	"ORGANIZATION_EQUIPMENT_PORT_MISSING",
	"ORGANIZATION_PORT_ROUTE_UNSUPPORTED",
	"ORGANIZATION_SAME_KIND_OWNERSHIP_CONFLICT",
	"ORGANIZATION_MODULE_PARTIAL",
	"ORGANIZATION_MEMBERSHIP_MODULE_UNRESOLVED",
] as const;

export const STATIC_FAB_ORGANIZATION_ISSUE_TOKEN_KINDS = [
	"cursor",
	"record",
	"metadata",
	"parent",
	"rail",
	"switch",
	"equipment",
	"port",
	"module",
] as const;

export type StaticFabOrganizationIssueCode = (typeof STATIC_FAB_ORGANIZATION_ISSUE_CODES)[number];
export type StaticFabOrganizationIssueTokenKind =
	(typeof STATIC_FAB_ORGANIZATION_ISSUE_TOKEN_KINDS)[number];

export interface StaticFabOrganizationIssueBounds {
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

/** One exact, independently navigable witness for an organization issue. */
export interface StaticFabOrganizationIssueLocation {
	readonly organizationId: number;
	readonly organizationRecordIndex: number;
	readonly relatedKind: "organization" | "switch" | "equipment" | "port" | null;
	readonly relatedEntityId: number;
	readonly relatedOrganizationRecordIndex: number;
	readonly tokenKind: StaticFabOrganizationIssueTokenKind;
	readonly token: string;
	readonly bounds: StaticFabOrganizationIssueBounds;
}

/**
 * One independently discoverable organization integrity fault.
 *
 * IDs never identify malformed duplicate records on their own, so record indexes and exact tokens
 * are retained beside them. Consumers must not recover relationships by parsing `message`.
 */
export interface StaticFabOrganizationIssue {
	readonly code: StaticFabOrganizationIssueCode;
	readonly message: string;
	readonly organizationIds: readonly number[];
	readonly organizationRecordIndexes: readonly number[];
	readonly parentOrganizationIds: readonly number[];
	readonly membershipTokens: readonly string[];
	readonly locations: readonly StaticFabOrganizationIssueLocation[];
}

/** Raw semantic rows admitted only after their transferable structure and checksum are verified. */
export interface StaticFabOrganizationDiagnosticRecord {
	readonly id: number;
	readonly kind: string;
	readonly name: string;
	readonly parentOrganizationIds: readonly number[];
	readonly properties: Readonly<{ description: string; color: string }>;
	readonly membership: StaticFabOrganizationMembership;
}

/** This broader record type is intentionally not assignable to the editable organization state. */
export interface StaticFabOrganizationDiagnosticState {
	readonly nextOrganizationId: number;
	readonly records: readonly StaticFabOrganizationDiagnosticRecord[];
}

export type StaticFabOrganizationIssueSourceState =
	| StaticFabOrganizationState
	| StaticFabOrganizationDiagnosticState;
type StaticFabOrganizationIssueSourceRecord =
	| StaticFabOrganizationRecord
	| StaticFabOrganizationDiagnosticRecord;

interface OrganizationRecordInfo {
	readonly record: StaticFabOrganizationIssueSourceRecord;
	readonly index: number;
	readonly id: number;
	readonly kind: StaticFabOrganizationKind | null;
	readonly name: string;
	readonly parentIds: readonly number[];
	readonly railEdges: readonly DirectedRailEdge[];
	readonly advancedSwitchIds: readonly number[];
	readonly equipmentGroupIds: readonly number[];
	readonly bounds: StaticFabOrganizationIssueBounds;
}

interface IssueLocationInput {
	readonly info: OrganizationRecordInfo | null;
	readonly relatedKind?: StaticFabOrganizationIssueLocation["relatedKind"];
	readonly relatedEntityId?: number;
	readonly relatedOrganizationRecordIndex?: number;
	readonly tokenKind: StaticFabOrganizationIssueTokenKind;
	readonly token: string;
	readonly bounds?: StaticFabOrganizationIssueBounds;
}

const ZERO_BOUNDS = Object.freeze({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 });

/** Collect every safely discoverable organization ownership and relationship fault. */
export function collectStaticFabOrganizationIssues(
	map: TileMap,
	portEquipment: PortEquipmentState,
	state: StaticFabOrganizationIssueSourceState,
): readonly StaticFabOrganizationIssue[] {
	const issues: StaticFabOrganizationIssue[] = [];
	const projectBounds = staticFabProjectBounds(map);
	const rawRecords = Array.isArray(state.records) ? state.records : [];
	const recordInfos: OrganizationRecordInfo[] = [];
	const groupsById = new Map<number, EquipmentGroupRecord>();
	for (const group of portEquipment.equipmentGroups) {
		if (!groupsById.has(group.id)) groupsById.set(group.id, group);
	}
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port] as const));
	const switchBoundsById = new Map<number, StaticFabOrganizationIssueBounds>();
	map.forEachAdvancedSwitch((record) => {
		switchBoundsById.set(record.id, cellsBounds(deriveAdvancedSwitchGeometry(record).claimedCells));
	});
	const addIssue = (
		code: StaticFabOrganizationIssueCode,
		message: string,
		locations: readonly IssueLocationInput[],
		parentOrganizationIds: readonly number[] = [],
	): void => {
		const frozenLocations = Object.freeze(
			locations.map((location) =>
				Object.freeze({
					organizationId: location.info?.id ?? 0,
					organizationRecordIndex: location.info?.index ?? -1,
					relatedKind: location.relatedKind ?? null,
					relatedEntityId: location.relatedEntityId ?? 0,
					relatedOrganizationRecordIndex: location.relatedOrganizationRecordIndex ?? -1,
					tokenKind: location.tokenKind,
					token: location.token,
					bounds: freezeBounds(location.bounds ?? location.info?.bounds ?? projectBounds),
				}),
			),
		);
		issues.push(
			Object.freeze({
				code,
				message,
				organizationIds: Object.freeze(
					canonicalNumbers(
						locations
							.map((location) => location.info?.id)
							.filter((id): id is number => id !== undefined),
					),
				),
				organizationRecordIndexes: Object.freeze(
					canonicalNumbers(
						locations
							.map((location) => location.info?.index)
							.filter((index): index is number => index !== undefined && index >= 0),
					),
				),
				parentOrganizationIds: Object.freeze(canonicalNumbers(parentOrganizationIds)),
				membershipTokens: Object.freeze(
					canonicalStrings(
						locations
							.filter((location) => isMembershipTokenKind(location.tokenKind))
							.map((location) => location.token),
					),
				),
				locations: frozenLocations,
			}),
		);
	};

	const cursor = state.nextOrganizationId;
	const cursorValid = isPositiveInt32(cursor);
	if (!cursorValid) {
		addIssue(
			"NEXT_ORGANIZATION_ID_CURSOR_INVALID",
			`organization id cursor ${String(cursor)} is outside the positive signed-int32 range`,
			[{ info: null, tokenKind: "cursor", token: `cursor:${String(cursor)}` }],
		);
	}

	for (let index = 0; index < rawRecords.length; index += 1) {
		const raw = rawRecords[index] as StaticFabOrganizationIssueSourceRecord | null | undefined;
		if (!raw || typeof raw !== "object") {
			addIssue("ORGANIZATION_RECORD_INVALID", `organization record ${index + 1} is not an object`, [
				{ info: null, tokenKind: "record", token: `record:${index}` },
			]);
			continue;
		}
		const info = organizationRecordInfo(
			raw,
			index,
			projectBounds,
			groupsById,
			portsById,
			switchBoundsById,
		);
		recordInfos.push(info);
		collectRecordShapeIssues(info, raw, addIssue);
	}

	const firstById = new Map<number, OrganizationRecordInfo>();
	const recordsById = new Map<number, OrganizationRecordInfo[]>();
	let maximumId = 0;
	let previousId = 0;
	let previousInfo: OrganizationRecordInfo | null = null;
	for (const info of recordInfos) {
		if (!isPositiveInt32(info.id)) continue;
		maximumId = Math.max(maximumId, info.id);
		const sameIdRecords = recordsById.get(info.id);
		if (sameIdRecords) sameIdRecords.push(info);
		else recordsById.set(info.id, [info]);
		const first = firstById.get(info.id);
		if (first) {
			addIssue(
				"ORGANIZATION_ID_DUPLICATE",
				`organization id ${info.id} is used by records ${first.index + 1} and ${info.index + 1}`,
				[
					organizationLocation(
						first,
						"record",
						`record:${first.index}`,
						info.id,
						undefined,
						info.index,
					),
					organizationLocation(
						info,
						"record",
						`record:${info.index}`,
						first.id,
						undefined,
						first.index,
					),
				],
			);
		} else firstById.set(info.id, info);
		if (previousInfo && info.id < previousId) {
			addIssue(
				"ORGANIZATION_RECORD_ORDER_NONCANONICAL",
				`organization record ${info.index + 1} is out of canonical id order`,
				[
					organizationLocation(
						info,
						"record",
						`record-order:${info.id}`,
						previousInfo.id,
						undefined,
						previousInfo.index,
					),
					organizationLocation(
						previousInfo,
						"record",
						`record-order:${previousInfo.id}`,
						info.id,
						undefined,
						info.index,
					),
				],
			);
		}
		previousId = info.id;
		previousInfo = info;
	}
	if (cursorValid && cursor <= maximumId) {
		addIssue(
			"NEXT_ORGANIZATION_ID_CURSOR_STALE",
			`organization id cursor ${cursor} must exceed maximum organization id ${maximumId}`,
			[{ info: null, tokenKind: "cursor", token: `cursor:${cursor}` }],
		);
	}

	const firstNameByKind = new Map<string, OrganizationRecordInfo>();
	for (const info of recordInfos) {
		if (!info.kind || !validOrganizationName(info.name)) continue;
		const normalized = normalizeStaticFabOrganizationName(info.name);
		const key = `${info.kind}:${normalized}`;
		const first = firstNameByKind.get(key);
		if (first) {
			addIssue(
				"ORGANIZATION_NAME_DUPLICATE",
				`${info.kind} organization name '${info.name}' duplicates record ${first.index + 1}`,
				[
					organizationLocation(
						first,
						"metadata",
						`name:${normalized}`,
						info.id,
						undefined,
						info.index,
					),
					organizationLocation(
						info,
						"metadata",
						`name:${normalized}`,
						first.id,
						undefined,
						first.index,
					),
				],
			);
		} else firstNameByKind.set(key, info);
	}

	collectRelationshipIssues(recordInfos, recordsById, addIssue);
	collectMembershipIssues(map, recordInfos, groupsById, portsById, addIssue);

	return Object.freeze(issues.sort(compareOrganizationIssues));
}

function collectRecordShapeIssues(
	info: OrganizationRecordInfo,
	record: StaticFabOrganizationIssueSourceRecord,
	addIssue: (
		code: StaticFabOrganizationIssueCode,
		message: string,
		locations: readonly IssueLocationInput[],
		parentOrganizationIds?: readonly number[],
	) => void,
): void {
	const invalid = (message: string, token: string): void =>
		addIssue("ORGANIZATION_RECORD_INVALID", message, [
			organizationLocation(info, "metadata", token),
		]);
	const metadataInvalid = (message: string, token: string): void =>
		addIssue("ORGANIZATION_METADATA_INVALID", message, [
			organizationLocation(info, "metadata", token),
		]);
	if (!isPositiveInt32(info.id))
		invalid(`organization record ${info.index + 1} has invalid id`, "id");
	if (!info.kind) invalid(`organization ${info.id} has an unknown kind`, "kind");
	if (!validOrganizationName(info.name)) {
		metadataInvalid(
			`organization ${info.id} name must be a trimmed portable 1-120 character label`,
			"name",
		);
	}
	const properties = record.properties;
	if (properties !== undefined) {
		if (!properties || typeof properties !== "object") {
			metadataInvalid(`organization ${info.id} properties are malformed`, "properties");
		} else {
			if (!validOrganizationDescription(properties.description)) {
				metadataInvalid(`organization ${info.id} description is malformed`, "description");
			}
			if (!STATIC_FAB_ORGANIZATION_COLORS.some((color) => color === properties.color)) {
				metadataInvalid(`organization ${info.id} color is invalid`, "color");
			}
		}
	}
	if (!record.membership || typeof record.membership !== "object") {
		addIssue(
			"ORGANIZATION_MEMBERSHIP_TOKEN_INVALID",
			`organization ${info.id} membership is malformed`,
			[organizationLocation(info, "record", `record:${info.index}`)],
		);
		return;
	}
	if (info.railEdges.length + info.advancedSwitchIds.length + info.equipmentGroupIds.length === 0) {
		addIssue(
			"ORGANIZATION_MEMBERSHIP_EMPTY",
			`organization ${info.id} must contain at least one rail, switch, or equipment member`,
			[organizationLocation(info, "record", `record:${info.index}`)],
		);
	}
}

function collectRelationshipIssues(
	recordInfos: readonly OrganizationRecordInfo[],
	recordsById: ReadonlyMap<number, readonly OrganizationRecordInfo[]>,
	addIssue: (
		code: StaticFabOrganizationIssueCode,
		message: string,
		locations: readonly IssueLocationInput[],
		parentOrganizationIds?: readonly number[],
	) => void,
): void {
	const graph = new Map<number, number[]>();
	for (const info of recordInfos) {
		if (info.parentIds.length > STATIC_FAB_ORGANIZATION_MAX_PARENTS) {
			addIssue(
				"ORGANIZATION_METADATA_INVALID",
				`organization ${info.id} exceeds the ${STATIC_FAB_ORGANIZATION_MAX_PARENTS} parent limit`,
				[organizationLocation(info, "parent", `parents:${info.parentIds.length}`)],
				info.parentIds,
			);
		}
		let previous = 0;
		const seen = new Set<number>();
		for (const parentId of info.parentIds) {
			const token = `parent:${String(parentId)}`;
			if (!isPositiveInt32(parentId)) {
				addIssue(
					"ORGANIZATION_PARENT_REFERENCE_INVALID",
					`organization ${info.id} has invalid parent id ${String(parentId)}`,
					[organizationLocation(info, "parent", token)],
					[parentId],
				);
				continue;
			}
			if (seen.has(parentId) || parentId <= previous) {
				addIssue(
					"ORGANIZATION_PARENT_REFERENCE_INVALID",
					`organization ${info.id} parent ids are not canonical at ${parentId}`,
					[organizationLocation(info, "parent", token, parentId)],
					[parentId],
				);
			}
			seen.add(parentId);
			previous = parentId;
			if (parentId === info.id) {
				addIssue(
					"ORGANIZATION_PARENT_REFERENCE_INVALID",
					`organization ${info.id} cannot parent itself`,
					[organizationLocation(info, "parent", token, parentId)],
					[parentId],
				);
				continue;
			}
			const parents = recordsById.get(parentId);
			if (!parents || parents.length === 0) {
				addIssue(
					"ORGANIZATION_PARENT_MISSING",
					`organization ${info.id} references missing parent organization ${parentId}`,
					[organizationLocation(info, "parent", token, parentId)],
					[parentId],
				);
				continue;
			}
			if (parents.length > 1) {
				addIssue(
					"ORGANIZATION_RELATIONSHIP_ORPHAN",
					`organization ${info.id} parent ${parentId} resolves to duplicate records`,
					[
						organizationLocation(info, "parent", token, parentId, undefined, parents[0]?.index),
						...parents
							.slice(0, 2)
							.map((parent) =>
								organizationLocation(
									parent,
									"record",
									`record:${parent.index}`,
									info.id,
									undefined,
									info.index,
								),
							),
					],
					[parentId],
				);
				continue;
			}
			if ((recordsById.get(info.id)?.length ?? 0) === 1) {
				const parentsForChild = graph.get(info.id);
				if (parentsForChild) parentsForChild.push(parentId);
				else graph.set(info.id, [parentId]);
			}
		}
	}

	for (const component of cyclicRelationshipComponents(graph)) {
		const componentSet = new Set(component);
		const locations = component.map((organizationId) => {
			const info = recordsById.get(organizationId)?.[0] ?? null;
			const parentId = (graph.get(organizationId) ?? []).find((candidate) =>
				componentSet.has(candidate),
			);
			const parentInfo = parentId === undefined ? null : (recordsById.get(parentId)?.[0] ?? null);
			return {
				...organizationLocation(
					info,
					"parent",
					`parent:${String(parentId ?? 0)}`,
					parentId,
					undefined,
					parentInfo?.index,
				),
			};
		});
		addIssue(
			"ORGANIZATION_RELATIONSHIP_CYCLE",
			`organization relationship cycle contains ${component.join(", ")}`,
			locations,
			component,
		);
	}
}

function collectMembershipIssues(
	map: TileMap,
	recordInfos: readonly OrganizationRecordInfo[],
	groupsById: ReadonlyMap<number, EquipmentGroupRecord>,
	portsById: ReadonlyMap<number, PortEquipmentState["ports"][number]>,
	addIssue: (
		code: StaticFabOrganizationIssueCode,
		message: string,
		locations: readonly IssueLocationInput[],
		parentOrganizationIds?: readonly number[],
	) => void,
): void {
	const claims = new Map<StaticFabOrganizationKind, Map<string, OrganizationRecordInfo>>();
	let modules: readonly RailModuleOwnership[] = [];
	try {
		modules = buildRailModuleOwnershipIndex(map).modules;
	} catch {
		modules = [];
	}
	const moduleByEdge = new Map<string, RailModuleOwnership>();
	const moduleBySwitch = new Map<number, RailModuleOwnership>();
	for (const module of modules) {
		for (const edge of module.eraseEdges)
			moduleByEdge.set(staticFabOrganizationEdgeKey(edge), module);
		if (module.advancedSwitchId !== null) moduleBySwitch.set(module.advancedSwitchId, module);
	}

	for (const info of recordInfos) {
		const selectedEdges = new Set<string>();
		const selectedSwitches = new Set<number>();
		const touchedModules = new Map<string, RailModuleOwnership>();
		let previousEdge: DirectedRailEdge | null = null;
		for (const edge of info.railEdges) {
			const token = `rail:${safeEdgeToken(edge)}`;
			const edgeValid = validDirectedRailEdge(edge);
			if (!edgeValid) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_TOKEN_INVALID",
					`organization ${info.id} contains an invalid directed rail member`,
					[organizationLocation(info, "rail", token, undefined, edgeBounds(edge))],
				);
				continue;
			}
			const key = staticFabOrganizationEdgeKey(edge);
			if (selectedEdges.has(key)) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_TOKEN_DUPLICATE",
					`organization ${info.id} repeats rail membership ${key}`,
					[organizationLocation(info, "rail", token, undefined, edgeBounds(edge))],
				);
			} else if (previousEdge && compareEdges(previousEdge, edge) >= 0) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_ORDER_NONCANONICAL",
					`organization ${info.id} rail membership is out of canonical order at ${key}`,
					[organizationLocation(info, "rail", token, undefined, edgeBounds(edge))],
				);
			}
			selectedEdges.add(key);
			previousEdge = edge;
			claimSameKind(info, token, claims, addIssue, edgeBounds(edge));
			if (!directedRailEdgeExists(map, edge)) {
				addIssue(
					"ORGANIZATION_RAIL_MEMBER_MISSING",
					`organization ${info.id} rail member ${key} does not exist in the current map`,
					[organizationLocation(info, "rail", token, undefined, edgeBounds(edge))],
				);
				continue;
			}
			const module = moduleByEdge.get(key);
			if (module) touchedModules.set(module.key, module);
			else {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_MODULE_UNRESOLVED",
					`organization ${info.id} rail member ${key} cannot be resolved to a semantic module`,
					[organizationLocation(info, "rail", token, undefined, edgeBounds(edge))],
				);
			}
		}

		let previousSwitch = 0;
		const seenSwitches = new Set<number>();
		for (const switchId of info.advancedSwitchIds) {
			const token = `switch:${String(switchId)}`;
			if (!isPositiveInt32(switchId)) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_TOKEN_INVALID",
					`organization ${info.id} switch membership is invalid at ${String(switchId)}`,
					[organizationLocation(info, "switch", token, switchId, undefined, -1, "switch")],
				);
				continue;
			}
			if (seenSwitches.has(switchId)) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_TOKEN_DUPLICATE",
					`organization ${info.id} repeats switch membership ${switchId}`,
					[organizationLocation(info, "switch", token, switchId, undefined, -1, "switch")],
				);
				continue;
			}
			if (switchId <= previousSwitch) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_ORDER_NONCANONICAL",
					`organization ${info.id} switch membership is out of canonical order at ${switchId}`,
					[organizationLocation(info, "switch", token, switchId, undefined, -1, "switch")],
				);
			}
			seenSwitches.add(switchId);
			selectedSwitches.add(switchId);
			previousSwitch = switchId;
			claimSameKind(info, token, claims, addIssue);
			if (!map.getAdvancedSwitch(switchId)) {
				addIssue(
					"ORGANIZATION_SWITCH_MEMBER_MISSING",
					`organization ${info.id} advanced switch ${switchId} does not exist`,
					[organizationLocation(info, "switch", token, switchId, undefined, -1, "switch")],
				);
				continue;
			}
			const module = moduleBySwitch.get(switchId);
			if (module) touchedModules.set(module.key, module);
			else {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_MODULE_UNRESOLVED",
					`organization ${info.id} switch ${switchId} cannot be resolved to a semantic module`,
					[organizationLocation(info, "switch", token, switchId, undefined, -1, "switch")],
				);
			}
		}

		let previousEquipment = 0;
		const seenEquipment = new Set<number>();
		for (const groupId of info.equipmentGroupIds) {
			const token = `equipment:${String(groupId)}`;
			if (!isPositiveInt32(groupId)) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_TOKEN_INVALID",
					`organization ${info.id} equipment membership is invalid at ${String(groupId)}`,
					[organizationLocation(info, "equipment", token, groupId, undefined, -1, "equipment")],
				);
				continue;
			}
			if (seenEquipment.has(groupId)) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_TOKEN_DUPLICATE",
					`organization ${info.id} repeats equipment membership ${groupId}`,
					[organizationLocation(info, "equipment", token, groupId, undefined, -1, "equipment")],
				);
				continue;
			}
			if (groupId <= previousEquipment) {
				addIssue(
					"ORGANIZATION_MEMBERSHIP_ORDER_NONCANONICAL",
					`organization ${info.id} equipment membership is out of canonical order at ${groupId}`,
					[organizationLocation(info, "equipment", token, groupId, undefined, -1, "equipment")],
				);
			}
			seenEquipment.add(groupId);
			previousEquipment = groupId;
			claimSameKind(info, token, claims, addIssue);
			const group = groupsById.get(groupId);
			if (!group) {
				addIssue(
					"ORGANIZATION_EQUIPMENT_MEMBER_MISSING",
					`organization ${info.id} equipment group ${groupId} does not exist`,
					[organizationLocation(info, "equipment", token, groupId, undefined, -1, "equipment")],
				);
				continue;
			}
			for (const portId of group.portIds) {
				const port = portsById.get(portId);
				if (!port) {
					addIssue(
						"ORGANIZATION_EQUIPMENT_PORT_MISSING",
						`organization ${info.id} equipment ${groupId} references missing port ${portId}`,
						[organizationLocation(info, "port", `port:${portId}`, portId, undefined, -1, "port")],
					);
					continue;
				}
				if (
					!staticFabOrganizationMembershipSupportsPortRoute(
						port.route,
						selectedEdges,
						selectedSwitches,
					)
				) {
					addIssue(
						"ORGANIZATION_PORT_ROUTE_UNSUPPORTED",
						`organization ${info.id} port ${portId} route is outside its direct rail membership`,
						[organizationLocation(info, "port", `port:${portId}`, portId, undefined, -1, "port")],
					);
				}
			}
		}

		for (const module of touchedModules.values()) {
			const missingEdge = module.eraseEdges.find(
				(edge) => !selectedEdges.has(staticFabOrganizationEdgeKey(edge)),
			);
			const missingSwitch =
				module.advancedSwitchId !== null && !selectedSwitches.has(module.advancedSwitchId)
					? module.advancedSwitchId
					: null;
			if (!missingEdge && missingSwitch === null) continue;
			const token = `module:${module.key}`;
			addIssue(
				"ORGANIZATION_MODULE_PARTIAL",
				`organization ${info.id} must own the complete semantic rail module ${module.key}`,
				[organizationLocation(info, "module", token, undefined, moduleBounds(module))],
			);
		}
	}
}

function claimSameKind(
	info: OrganizationRecordInfo,
	token: string,
	claims: Map<StaticFabOrganizationKind, Map<string, OrganizationRecordInfo>>,
	addIssue: (
		code: StaticFabOrganizationIssueCode,
		message: string,
		locations: readonly IssueLocationInput[],
	) => void,
	bounds?: StaticFabOrganizationIssueBounds,
): void {
	if (!info.kind) return;
	const owners = claims.get(info.kind) ?? new Map<string, OrganizationRecordInfo>();
	const first = owners.get(token);
	if (first && first.index !== info.index) {
		const tokenKind = tokenKindFromToken(token);
		addIssue(
			"ORGANIZATION_SAME_KIND_OWNERSHIP_CONFLICT",
			`${info.kind} organizations ${first.id} and ${info.id} both own ${token}`,
			[
				organizationLocation(first, tokenKind, token, info.id, bounds, info.index),
				organizationLocation(info, tokenKind, token, first.id, bounds, first.index),
			],
		);
	} else if (!first) owners.set(token, info);
	claims.set(info.kind, owners);
}

function organizationRecordInfo(
	record: StaticFabOrganizationIssueSourceRecord,
	index: number,
	projectBounds: StaticFabOrganizationIssueBounds,
	groupsById: ReadonlyMap<number, EquipmentGroupRecord>,
	portsById: ReadonlyMap<number, PortEquipmentState["ports"][number]>,
	switchBoundsById: ReadonlyMap<number, StaticFabOrganizationIssueBounds>,
): OrganizationRecordInfo {
	const raw = record as unknown as Record<string, unknown>;
	const membership =
		raw.membership && typeof raw.membership === "object"
			? (raw.membership as Record<string, unknown>)
			: {};
	const railEdges = Array.isArray(membership.railEdges)
		? (membership.railEdges as readonly DirectedRailEdge[])
		: [];
	const advancedSwitchIds = Array.isArray(membership.advancedSwitchIds)
		? (membership.advancedSwitchIds as readonly number[])
		: [];
	const equipmentGroupIds = Array.isArray(membership.equipmentGroupIds)
		? (membership.equipmentGroupIds as readonly number[])
		: [];
	const parentIds =
		raw.parentOrganizationIds === undefined
			? []
			: Array.isArray(raw.parentOrganizationIds)
				? (raw.parentOrganizationIds as readonly number[])
				: [];
	const partial: OrganizationRecordInfo = {
		record,
		index,
		id: typeof raw.id === "number" ? raw.id : 0,
		kind: STATIC_FAB_ORGANIZATION_KINDS.includes(raw.kind as StaticFabOrganizationKind)
			? (raw.kind as StaticFabOrganizationKind)
			: null,
		name: typeof raw.name === "string" ? raw.name : "",
		parentIds,
		railEdges,
		advancedSwitchIds,
		equipmentGroupIds,
		bounds: projectBounds,
	};
	return Object.freeze({
		...partial,
		bounds: organizationRecordBounds(
			partial,
			groupsById,
			portsById,
			switchBoundsById,
			projectBounds,
		),
	});
}

function organizationRecordBounds(
	info: OrganizationRecordInfo,
	groupsById: ReadonlyMap<number, EquipmentGroupRecord>,
	portsById: ReadonlyMap<number, PortEquipmentState["ports"][number]>,
	switchBoundsById: ReadonlyMap<number, StaticFabOrganizationIssueBounds>,
	fallback: StaticFabOrganizationIssueBounds,
): StaticFabOrganizationIssueBounds {
	const bounds: StaticFabOrganizationIssueBounds[] = [];
	for (const edge of info.railEdges) bounds.push(edgeBounds(edge));
	for (const switchId of info.advancedSwitchIds) {
		const switchBounds = switchBoundsById.get(switchId);
		if (switchBounds) bounds.push(switchBounds);
	}
	for (const groupId of info.equipmentGroupIds) {
		const group = groupsById.get(groupId);
		if (!group) continue;
		for (const portId of group.portIds) {
			const port = portsById.get(portId);
			if (!port) continue;
			if (port.route.kind === "CARDINAL_CELL") {
				bounds.push({
					minX: port.route.x,
					minZ: port.route.z,
					maxX: port.route.x + 1,
					maxZ: port.route.z + 1,
				});
			} else {
				const switchBounds = switchBoundsById.get(port.route.switchId);
				if (switchBounds) bounds.push(switchBounds);
			}
		}
	}
	return bounds.length > 0 ? unionBounds(bounds) : fallback;
}

function organizationLocation(
	info: OrganizationRecordInfo | null,
	tokenKind: StaticFabOrganizationIssueTokenKind,
	token: string,
	relatedOrganizationId?: number,
	bounds?: StaticFabOrganizationIssueBounds,
	relatedOrganizationRecordIndex = -1,
	relatedKind: StaticFabOrganizationIssueLocation["relatedKind"] = relatedOrganizationId ===
	undefined
		? null
		: "organization",
): IssueLocationInput {
	return {
		info,
		relatedKind,
		relatedEntityId: relatedOrganizationId ?? 0,
		relatedOrganizationRecordIndex,
		tokenKind,
		token,
		bounds,
	};
}

function cyclicRelationshipComponents(graph: ReadonlyMap<number, readonly number[]>): number[][] {
	const nodes = new Set<number>();
	for (const [node, targets] of graph) {
		nodes.add(node);
		for (const target of targets) nodes.add(target);
	}
	const adjacency = new Map<number, number[]>();
	const reverse = new Map<number, number[]>();
	for (const node of nodes) {
		adjacency.set(node, []);
		reverse.set(node, []);
	}
	for (const [node, targets] of graph) {
		for (const target of targets) {
			adjacency.get(node)?.push(target);
			reverse.get(target)?.push(node);
		}
	}
	const visited = new Set<number>();
	const order: number[] = [];
	for (const start of [...nodes].sort((a, b) => a - b)) {
		if (visited.has(start)) continue;
		const stack: Array<{ node: number; expanded: boolean }> = [{ node: start, expanded: false }];
		while (stack.length > 0) {
			const frame = stack.pop() as { node: number; expanded: boolean };
			if (frame.expanded) {
				order.push(frame.node);
				continue;
			}
			if (visited.has(frame.node)) continue;
			visited.add(frame.node);
			stack.push({ node: frame.node, expanded: true });
			const targets = adjacency.get(frame.node) ?? [];
			for (let index = targets.length - 1; index >= 0; index -= 1) {
				const target = targets[index] as number;
				if (!visited.has(target)) stack.push({ node: target, expanded: false });
			}
		}
	}
	const assigned = new Set<number>();
	const cyclic: number[][] = [];
	for (let index = order.length - 1; index >= 0; index -= 1) {
		const start = order[index] as number;
		if (assigned.has(start)) continue;
		const component: number[] = [];
		const stack = [start];
		assigned.add(start);
		while (stack.length > 0) {
			const node = stack.pop() as number;
			component.push(node);
			for (const target of reverse.get(node) ?? []) {
				if (assigned.has(target)) continue;
				assigned.add(target);
				stack.push(target);
			}
		}
		component.sort((a, b) => a - b);
		if (component.length > 1) cyclic.push(component);
	}
	return cyclic;
}

function directedRailEdgeExists(map: TileMap, edge: DirectedRailEdge): boolean {
	const direction = directionBetween(edge.from, edge.to);
	if (direction === null) return false;
	const source = decodeRailCell(map.getEncoded(edge.from.x, edge.from.y));
	const target = decodeRailCell(map.getEncoded(edge.to.x, edge.to.y));
	return (
		(source.outgoing & direction) !== 0 && (target.incoming & oppositeDirection(direction)) !== 0
	);
}

function validDirectedRailEdge(edge: DirectedRailEdge): boolean {
	return (
		edge !== null &&
		typeof edge === "object" &&
		edge.from !== null &&
		typeof edge.from === "object" &&
		edge.to !== null &&
		typeof edge.to === "object" &&
		isInt32(edge.from.x) &&
		isInt32(edge.from.y) &&
		isInt32(edge.to.x) &&
		isInt32(edge.to.y) &&
		directionBetween(edge.from, edge.to) !== null
	);
}

function compareEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return (
		left.from.x - right.from.x ||
		left.from.y - right.from.y ||
		left.to.x - right.to.x ||
		left.to.y - right.to.y
	);
}

function safeEdgeToken(edge: DirectedRailEdge): string {
	try {
		return `${String(edge.from?.x)}:${String(edge.from?.y)}>${String(edge.to?.x)}:${String(edge.to?.y)}`;
	} catch {
		return "malformed";
	}
}

function edgeBounds(edge: DirectedRailEdge): StaticFabOrganizationIssueBounds {
	const values = [edge?.from?.x, edge?.from?.y, edge?.to?.x, edge?.to?.y];
	if (!values.every(Number.isFinite)) return ZERO_BOUNDS;
	return freezeBounds({
		minX: Math.min(edge.from.x, edge.to.x),
		minZ: Math.min(edge.from.y, edge.to.y),
		maxX: Math.max(edge.from.x, edge.to.x) + 1,
		maxZ: Math.max(edge.from.y, edge.to.y) + 1,
	});
}

function moduleBounds(module: RailModuleOwnership): StaticFabOrganizationIssueBounds {
	return module.footprintCells.length > 0 ? cellsBounds(module.footprintCells) : ZERO_BOUNDS;
}

function cellsBounds(
	cells: readonly { readonly x: number; readonly y: number }[],
): StaticFabOrganizationIssueBounds {
	if (cells.length === 0) return ZERO_BOUNDS;
	let minX = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const cell of cells) {
		minX = Math.min(minX, cell.x);
		minZ = Math.min(minZ, cell.y);
		maxX = Math.max(maxX, cell.x + 1);
		maxZ = Math.max(maxZ, cell.y + 1);
	}
	return freezeBounds({ minX, minZ, maxX, maxZ });
}

function staticFabProjectBounds(map: TileMap): StaticFabOrganizationIssueBounds {
	const bounds = map.bounds();
	return bounds
		? freezeBounds({
				minX: bounds.minX,
				minZ: bounds.minY,
				maxX: bounds.maxX + 1,
				maxZ: bounds.maxY + 1,
			})
		: ZERO_BOUNDS;
}

function unionBounds(
	bounds: readonly StaticFabOrganizationIssueBounds[],
): StaticFabOrganizationIssueBounds {
	let minX = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const item of bounds) {
		if (!validBounds(item)) continue;
		minX = Math.min(minX, item.minX);
		minZ = Math.min(minZ, item.minZ);
		maxX = Math.max(maxX, item.maxX);
		maxZ = Math.max(maxZ, item.maxZ);
	}
	return Number.isFinite(minX) ? freezeBounds({ minX, minZ, maxX, maxZ }) : ZERO_BOUNDS;
}

function freezeBounds(bounds: StaticFabOrganizationIssueBounds): StaticFabOrganizationIssueBounds {
	return Object.freeze(validBounds(bounds) ? { ...bounds } : { ...ZERO_BOUNDS });
}

function validBounds(bounds: StaticFabOrganizationIssueBounds): boolean {
	return (
		Number.isFinite(bounds.minX) &&
		Number.isFinite(bounds.minZ) &&
		Number.isFinite(bounds.maxX) &&
		Number.isFinite(bounds.maxZ) &&
		bounds.maxX >= bounds.minX &&
		bounds.maxZ >= bounds.minZ
	);
}

function validOrganizationName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length >= 1 &&
		value.length <= 120 &&
		value === value.trim() &&
		!hasAsciiControlCharacter(value)
	);
}

function validOrganizationDescription(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH &&
		value === value.trim() &&
		!hasDisallowedTextControlCharacter(value)
	);
}

function hasAsciiControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function hasDisallowedTextControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if ((code <= 0x1f && code !== 0x09 && code !== 0x0a) || code === 0x7f) return true;
	}
	return false;
}

function isMembershipTokenKind(kind: StaticFabOrganizationIssueTokenKind): boolean {
	return (
		kind === "rail" ||
		kind === "switch" ||
		kind === "equipment" ||
		kind === "port" ||
		kind === "module"
	);
}

function tokenKindFromToken(token: string): StaticFabOrganizationIssueTokenKind {
	if (token.startsWith("switch:")) return "switch";
	if (token.startsWith("equipment:")) return "equipment";
	if (token.startsWith("port:")) return "port";
	if (token.startsWith("module:")) return "module";
	return "rail";
}

function canonicalNumbers(values: readonly number[]): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en-US"));
}

function compareOrganizationIssues(
	left: StaticFabOrganizationIssue,
	right: StaticFabOrganizationIssue,
): number {
	return (
		STATIC_FAB_ORGANIZATION_ISSUE_CODES.indexOf(left.code) -
			STATIC_FAB_ORGANIZATION_ISSUE_CODES.indexOf(right.code) ||
		(left.organizationRecordIndexes[0] ?? -1) - (right.organizationRecordIndexes[0] ?? -1) ||
		(left.membershipTokens[0] ?? "").localeCompare(right.membershipTokens[0] ?? "", "en-US") ||
		left.message.localeCompare(right.message, "en-US")
	);
}

function isPositiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function isInt32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= -0x8000_0000 && (value as number) <= 0x7fff_ffff
	);
}
