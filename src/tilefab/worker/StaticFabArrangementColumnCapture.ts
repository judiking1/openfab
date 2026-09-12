import { STATIC_FAB_ARRANGEMENT_MAX_PORTS as MAX_PORTS } from "../compile/StaticFabArrangementPlanner";
import { type CooperativeTask, createCooperativeTask } from "../core/CooperativeTask";
import {
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_DOCUMENT as MAX_RELATIONSHIP_EDGES,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_GROUPS_PER_DOCUMENT as MAX_RELATIONSHIP_GROUPS,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_LEGS_PER_DOCUMENT as MAX_RELATIONSHIP_LEGS,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_DOCUMENT as MAX_RELATIONSHIP_OWNERS,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS as MAX_RELATIONSHIPS,
} from "../core/StaticFabAssemblyRelationship";
import {
	STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
	STATIC_FAB_ORGANIZATION_MAX_PARENTS,
} from "../core/StaticFabOrganization";
import type { AdvancedSwitchRecordFieldsSoA } from "./AdvancedSwitchSoA";
import type { PortRecordFieldsSoA } from "./PortEquipmentSoA";
import {
	STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS as MAX_CELLS,
	MAX_ORGANIZATION_GROUP_REFERENCES,
	MAX_ORGANIZATION_RAIL_EDGE_REFERENCES,
	MAX_ORGANIZATION_SWITCH_REFERENCES,
	STATIC_FAB_ARRANGEMENT_MAX_ORGANIZATIONS as MAX_ORGANIZATIONS,
	STATIC_FAB_ARRANGEMENT_MAX_ADVANCED_SWITCHES as MAX_SWITCHES,
} from "./StaticFabArrangementResponseValidator";
import type {
	StaticFabAssemblyRelationshipRecordFieldsSoA,
	StaticFabAssemblyRelationshipScopedEdgeFieldsSoA,
} from "./StaticFabAssemblyRelationshipSoA";
import type { StaticFabOrganizationRecordFieldsSoA } from "./StaticFabOrganizationSoA";
import {
	transferDataObject as object,
	transferColumnRow as row,
	TransferColumnCapture,
} from "./TransferColumnCapture";

export interface StaticFabArrangementRecordColumns<T> {
	readonly ids: Int32Array;
	readonly before: T;
	readonly after: T;
}

/** Existing IDs have both records; rail bytes alone may express absent cells. */
export interface StaticFabArrangementColumns {
	readonly cells: { readonly xs: Int32Array; readonly ys: Int32Array };
	readonly rail: {
		readonly xs: Int32Array;
		readonly ys: Int32Array;
		readonly before: Uint8Array;
		readonly after: Uint8Array;
	};
	readonly switches: StaticFabArrangementRecordColumns<AdvancedSwitchRecordFieldsSoA>;
	readonly ports: StaticFabArrangementRecordColumns<PortRecordFieldsSoA>;
	readonly organizations: StaticFabArrangementRecordColumns<StaticFabOrganizationRecordFieldsSoA>;
	readonly relationships: StaticFabArrangementRecordColumns<StaticFabAssemblyRelationshipRecordFieldsSoA>;
}

/** Capture finite schema references before yielding; full record/plan validation follows ownership. */
export function createStaticFabArrangementColumnCapture(
	input: unknown,
): CooperativeTask<StaticFabArrangementColumns> {
	const source = object(input, "arrangement columns", [
		"cells",
		"rail",
		"switches",
		"ports",
		"organizations",
		"relationships",
	]);
	const capture = new TransferColumnCapture();
	const cellInput = object(source.cells, "arrangement cells", ["xs", "ys"]);
	const cellXs = capture.numeric(cellInput.xs, Int32Array, MAX_CELLS, "arrangement cell x");
	if (cellXs.length === 0) throw new Error("Arrangement cells cannot be empty.");
	const cellYs = capture.numeric(
		cellInput.ys,
		Int32Array,
		cellXs.length,
		"arrangement cell y",
		cellXs.length,
	);
	const railInput = object(source.rail, "arrangement rail", ["xs", "ys", "before", "after"]);
	const railXs = capture.numeric(railInput.xs, Int32Array, MAX_CELLS, "arrangement rail x");
	const railYs = capture.numeric(
		railInput.ys,
		Int32Array,
		railXs.length,
		"arrangement rail y",
		railXs.length,
	);
	const railBefore = capture.numeric(
		railInput.before,
		Uint8Array,
		railXs.length,
		"arrangement rail before",
		railXs.length,
	);
	const railAfter = capture.numeric(
		railInput.after,
		Uint8Array,
		railXs.length,
		"arrangement rail after",
		railXs.length,
	);
	const switches = capturePair(
		capture,
		source.switches,
		MAX_SWITCHES,
		"switch",
		captureSwitchFields,
	);
	const ports = capturePair(capture, source.ports, MAX_PORTS, "port", capturePortFields);
	const organizations = capturePair(
		capture,
		source.organizations,
		MAX_ORGANIZATIONS,
		"organization",
		captureOrganizationFields,
	);
	const relationships = capturePair(
		capture,
		source.relationships,
		MAX_RELATIONSHIPS,
		"relationship",
		captureRelationshipFields,
	);
	return createCooperativeTask(
		(function* () {
			yield* capture.steps();
			return Object.freeze({
				cells: Object.freeze({ xs: cellXs.read(), ys: cellYs.read() }),
				rail: Object.freeze({
					xs: railXs.read(),
					ys: railYs.read(),
					before: railBefore.read(),
					after: railAfter.read(),
				}),
				switches: switches(),
				ports: ports(),
				organizations: organizations(),
				relationships: relationships(),
			});
		})(),
	);
}

function capturePair<T>(
	capture: TransferColumnCapture,
	input: unknown,
	maximum: number,
	label: string,
	captureFields: (capture: TransferColumnCapture, input: unknown, count: number) => () => T,
): () => StaticFabArrangementRecordColumns<T> {
	const source = object(input, label, ["ids", "before", "after"]);
	const ids = capture.numeric(source.ids, Int32Array, maximum, `${label} ids`);
	const before = captureFields(capture, source.before, ids.length);
	const after = captureFields(capture, source.after, ids.length);
	return () => Object.freeze({ ids: ids.read(), before: before(), after: after() });
}

function captureSwitchFields(
	capture: TransferColumnCapture,
	input: unknown,
	count: number,
): () => AdvancedSwitchRecordFieldsSoA {
	return capture.fields<AdvancedSwitchRecordFieldsSoA>(
		input,
		{
			profileClasses: row(Uint8Array, count),
			origins: row(Int32Array, count * 2),
			forwardDirections: row(Uint8Array, count),
			lateralDirections: row(Uint8Array, count),
			movementMasks: row(Uint8Array, count),
		},
		"arrangement switch records",
	);
}

function capturePortFields(
	capture: TransferColumnCapture,
	input: unknown,
	portCount: number,
): () => PortRecordFieldsSoA {
	return capture.fields<PortRecordFieldsSoA>(
		input,
		{
			equipmentGroupIds: row(Int32Array, portCount),
			routeKinds: row(Uint8Array, portCount),
			routeXs: row(Int32Array, portCount),
			routeZs: row(Int32Array, portCount),
			routeFromDirections: row(Uint8Array, portCount),
			routeToDirections: row(Uint8Array, portCount),
			routeSwitchIds: row(Int32Array, portCount),
			routeProfileClasses: row(Uint8Array, portCount),
			routeRoles: row(Uint8Array, portCount),
			routePortIndices: row(Int8Array, portCount),
			routeSegmentOrdinals: row(Uint16Array, portCount),
			stationMillimeters: row(Int32Array, portCount),
			sides: row(Uint8Array, portCount),
			lateralOffsetMillimeters: row(Uint32Array, portCount),
			directions: row(Uint8Array, portCount),
			portTypes: row(Uint8Array, portCount),
			barcodes: { type: "text", count: portCount, length: 128, nullable: true },
		},
		"ports",
	);
}

function captureOrganizationFields(
	capture: TransferColumnCapture,
	input: unknown,
	organizationCount: number,
): () => StaticFabOrganizationRecordFieldsSoA {
	return capture.fields<StaticFabOrganizationRecordFieldsSoA>(
		input,
		{
			kinds: row(Uint8Array, organizationCount),
			names: { type: "text", count: organizationCount, length: 120 },
			parentOrganizationOffsets: row(Uint32Array, organizationCount + 1),
			parentOrganizationIds: {
				type: Int32Array,
				maximum: organizationCount * STATIC_FAB_ORGANIZATION_MAX_PARENTS,
			},
			descriptions: {
				type: "text",
				count: organizationCount,
				length: STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
			},
			colors: row(Uint8Array, organizationCount),
			railEdgeOffsets: row(Uint32Array, organizationCount + 1),
			railEdgeCoordinates: { type: Int32Array, maximum: 4 * MAX_ORGANIZATION_RAIL_EDGE_REFERENCES },
			advancedSwitchOffsets: row(Uint32Array, organizationCount + 1),
			advancedSwitchIds: { type: Int32Array, maximum: MAX_ORGANIZATION_SWITCH_REFERENCES },
			equipmentGroupOffsets: row(Uint32Array, organizationCount + 1),
			equipmentGroupIds: { type: Int32Array, maximum: MAX_ORGANIZATION_GROUP_REFERENCES },
		},
		"organization records",
	);
}

function captureRelationshipFields(
	capture: TransferColumnCapture,
	input: unknown,
	relationshipCount: number,
): () => StaticFabAssemblyRelationshipRecordFieldsSoA {
	const relationshipFields = object(input, "relationship records", ["scopedEdges"]);
	const relationshipRecords = capture.fields<
		Omit<StaticFabAssemblyRelationshipRecordFieldsSoA, "scopedEdges">
	>(
		relationshipFields,
		{
			hierarchyRoles: row(Uint8Array, relationshipCount),
			purposes: row(Uint8Array, relationshipCount),
			parentOrganizationIds: row(Int32Array, relationshipCount),
			reviewPolicies: row(Uint8Array, relationshipCount),
			participantOffsets: row(Uint32Array, relationshipCount + 1),
			participantOrganizationIds: { type: Int32Array, maximum: relationshipCount * 2 },
			managedChildOffsets: row(Uint32Array, relationshipCount + 1),
			managedChildOrganizationIds: { type: Int32Array, maximum: relationshipCount * 2 },
			connectionGroupOffsets: row(Uint32Array, relationshipCount + 1),
			groupLegOffsets: { type: Uint32Array, maximum: MAX_RELATIONSHIP_GROUPS + 1 },
			legDirectionRoles: { type: Uint8Array, maximum: MAX_RELATIONSHIP_LEGS },
			legExclusiveCutEdgeOffsets: { type: Uint32Array, maximum: MAX_RELATIONSHIP_LEGS + 1 },
			exclusiveCutEdgeScopedIndexes: { type: Uint32Array, maximum: MAX_RELATIONSHIP_EDGES },
			legEndpointSupportOffsets: { type: Uint32Array, maximum: MAX_RELATIONSHIP_LEGS + 1 },
			endpointSupportScopedIndexes: { type: Uint32Array, maximum: MAX_RELATIONSHIP_EDGES },
			endpointAdjacentExclusiveCutEdgeIndexes: {
				type: Uint32Array,
				maximum: MAX_RELATIONSHIP_EDGES,
			},
			endpointPositions: { type: Uint8Array, maximum: MAX_RELATIONSHIP_EDGES },
			legSeamContactOffsets: { type: Uint32Array, maximum: MAX_RELATIONSHIP_LEGS + 1 },
			seamRoles: { type: Uint8Array, maximum: MAX_RELATIONSHIP_EDGES },
			seamIncidenceOffsets: { type: Uint32Array, maximum: MAX_RELATIONSHIP_EDGES + 1 },
			incidenceDirections: { type: Uint8Array, maximum: MAX_RELATIONSHIP_EDGES },
			incidenceBindingKinds: { type: Uint8Array, maximum: MAX_RELATIONSHIP_EDGES },
			incidenceExclusiveCutEdgeIndexes: { type: Uint32Array, maximum: MAX_RELATIONSHIP_EDGES },
			incidenceWitnessScopedEdgeIndexes: { type: Uint32Array, maximum: MAX_RELATIONSHIP_EDGES },
			edgeCoordinates: { type: Int32Array, maximum: MAX_RELATIONSHIP_EDGES * 4 },
		},
		"relationship records",
	);
	const scopedEdges = capture.fields<StaticFabAssemblyRelationshipScopedEdgeFieldsSoA>(
		relationshipFields.scopedEdges,
		{
			edgeIndexes: { type: Uint32Array, maximum: MAX_RELATIONSHIP_EDGES },
			scopeKinds: { type: Uint8Array, maximum: MAX_RELATIONSHIP_EDGES },
			participantIndexes: { type: Int8Array, maximum: MAX_RELATIONSHIP_EDGES },
			directOwnerOffsets: { type: Uint32Array, maximum: MAX_RELATIONSHIP_EDGES + 1 },
			directOwnerOrganizationIds: { type: Int32Array, maximum: MAX_RELATIONSHIP_OWNERS },
		},
		"relationship scoped edges",
	);
	return () => Object.freeze({ ...relationshipRecords(), scopedEdges: scopedEdges() });
}
