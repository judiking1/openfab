import { type CooperativeTask, createCooperativeTask } from "../core/CooperativeTask";
import {
	STATIC_FAB_ORGANIZATION_KINDS,
	STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
	STATIC_FAB_ORGANIZATION_MAX_PARENTS,
} from "../core/StaticFabOrganization";
import {
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS as MAX_GROUPS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS as MAX_ORGANIZATIONS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS as MAX_PORTS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES as MAX_RAIL_EDGES,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES as MAX_SWITCHES,
} from "../core/StaticFabOrganizationBundle";
import {
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_EDGE_REFERENCES as MAX_RELATIONSHIP_EDGES,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_GROUPS as MAX_RELATIONSHIP_GROUPS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_LEGS as MAX_RELATIONSHIP_LEGS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIP_OWNER_IDS as MAX_RELATIONSHIP_OWNERS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RELATIONSHIPS as MAX_RELATIONSHIPS,
} from "../core/StaticFabOrganizationBundleRelationships";
import type { AdvancedSwitchRecordFieldsSoA } from "./AdvancedSwitchSoA";
import {
	type EquipmentGroupFieldsSoA,
	PORT_EQUIPMENT_SNAPSHOT_SCHEMA_VERSION,
	type PortRecordFieldsSoA,
} from "./PortEquipmentSoA";
import {
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION,
	type StaticFabAssemblyRelationshipRecordFieldsSoA,
	type StaticFabAssemblyRelationshipScopedEdgeFieldsSoA,
} from "./StaticFabAssemblyRelationshipSoA";
import { STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS } from "./StaticFabOrganizationBundlePlacementResponseValidator";
import type { StaticFabOrganizationBundlePlacementAdditions } from "./StaticFabOrganizationBundlePlacementTransport";
import {
	STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION,
	type StaticFabOrganizationRecordFieldsSoA,
} from "./StaticFabOrganizationSoA";

import {
	TransferColumnCapture as ColumnCapture,
	transferDataObject as object,
	transferColumnRow as row,
} from "./TransferColumnCapture";

/**
 * Captures the finite column references and resource bounds synchronously, before returning a task.
 * The task owns copies only; it does not certify offsets, records, tickets or placement authority.
 */
export function createStaticFabOrganizationBundlePlacementCapture(
	input: unknown,
): CooperativeTask<StaticFabOrganizationBundlePlacementAdditions> {
	const source = object(input, "placement additions", [
		"xs",
		"ys",
		"encoded",
		"switchIds",
		"switches",
		"portEquipment",
		"organizations",
		"relationships",
	]);
	const capture = new ColumnCapture();
	const xs = capture.numeric(
		source.xs,
		Int32Array,
		STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS,
		"rail x",
	);
	const ys = capture.numeric(source.ys, Int32Array, xs.length, "rail y", xs.length);
	const encoded = capture.numeric(source.encoded, Uint8Array, xs.length, "rail bytes", xs.length);
	if (xs.length === 0) throw new Error("Placement additions cannot have an empty rail column.");
	const switchIds = capture.numeric(source.switchIds, Int32Array, MAX_SWITCHES, "switch ids");
	const switchCount = switchIds.length;
	const switches = capture.fields<AdvancedSwitchRecordFieldsSoA>(
		source.switches,
		{
			profileClasses: row(Uint8Array, switchCount),
			origins: row(Int32Array, switchCount * 2),
			forwardDirections: row(Uint8Array, switchCount),
			lateralDirections: row(Uint8Array, switchCount),
			movementMasks: row(Uint8Array, switchCount),
		},
		"switches",
	);

	const portInput = object(source.portEquipment, "port equipment", [
		"schemaVersion",
		"nextPortId",
		"nextEquipmentGroupId",
		"portIds",
		"ports",
		"equipmentGroupIds",
		"equipmentGroups",
	]);
	assertVersion(portInput.schemaVersion, PORT_EQUIPMENT_SNAPSHOT_SCHEMA_VERSION, "port equipment");
	const nextPortId = cursor(portInput.nextPortId, "port");
	const nextEquipmentGroupId = cursor(portInput.nextEquipmentGroupId, "equipment group");
	const portIds = capture.numeric(portInput.portIds, Int32Array, MAX_PORTS, "port ids");
	const equipmentGroupIds = capture.numeric(
		portInput.equipmentGroupIds,
		Int32Array,
		MAX_GROUPS,
		"group ids",
	);
	const portCount = portIds.length;
	const groupCount = equipmentGroupIds.length;
	const ports = capture.fields<PortRecordFieldsSoA>(
		portInput.ports,
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
	const equipmentGroups = capture.fields<EquipmentGroupFieldsSoA>(
		portInput.equipmentGroups,
		{
			kinds: row(Uint8Array, groupCount),
			portOffsets: row(Uint32Array, groupCount + 1),
			portIds: { type: Int32Array, maximum: MAX_PORTS },
			templates: row(Uint8Array, groupCount),
			pitchMillimeters: row(Uint32Array, groupCount),
			recipes: { type: "text", count: groupCount, length: 120, nullable: true },
		},
		"equipment groups",
	);

	const organizationInput = object(source.organizations, "organizations", [
		"schemaVersion",
		"nextOrganizationId",
		"organizationIds",
		"records",
	]);
	assertVersion(
		organizationInput.schemaVersion,
		STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION,
		"organizations",
	);
	const nextOrganizationId = cursor(
		organizationInput.nextOrganizationId,
		"organization",
		0x7fff_ffff,
	);
	const organizationIds = capture.numeric(
		organizationInput.organizationIds,
		Int32Array,
		MAX_ORGANIZATIONS,
		"organization ids",
	);
	const organizationCount = organizationIds.length;
	if (organizationCount === 0)
		throw new Error("Placement additions cannot have empty organizations.");
	const organizationKinds = STATIC_FAB_ORGANIZATION_KINDS.length;
	const organizationRecords = capture.fields<StaticFabOrganizationRecordFieldsSoA>(
		organizationInput.records,
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
			railEdgeCoordinates: { type: Int32Array, maximum: 4 * MAX_RAIL_EDGES * organizationKinds },
			advancedSwitchOffsets: row(Uint32Array, organizationCount + 1),
			advancedSwitchIds: { type: Int32Array, maximum: MAX_SWITCHES * organizationKinds },
			equipmentGroupOffsets: row(Uint32Array, organizationCount + 1),
			equipmentGroupIds: { type: Int32Array, maximum: MAX_GROUPS * organizationKinds },
		},
		"organization records",
	);

	const relationshipInput = object(source.relationships, "relationships", [
		"schemaVersion",
		"nextRelationshipId",
		"relationshipIds",
		"records",
	]);
	assertVersion(
		relationshipInput.schemaVersion,
		STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION,
		"relationships",
	);
	const nextRelationshipId = cursor(
		relationshipInput.nextRelationshipId,
		"relationship",
		0x7fff_ffff,
	);
	const relationshipIds = capture.numeric(
		relationshipInput.relationshipIds,
		Int32Array,
		MAX_RELATIONSHIPS,
		"relationship ids",
	);
	const relationshipCount = relationshipIds.length;
	const relationshipFields = object(relationshipInput.records, "relationship records", [
		"scopedEdges",
	]);
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

	return createCooperativeTask(
		(function* () {
			yield* capture.steps();
			return Object.freeze({
				xs: xs.read(),
				ys: ys.read(),
				encoded: encoded.read(),
				switchIds: switchIds.read(),
				switches: switches(),
				portEquipment: Object.freeze({
					schemaVersion: PORT_EQUIPMENT_SNAPSHOT_SCHEMA_VERSION,
					nextPortId,
					nextEquipmentGroupId,
					portIds: portIds.read(),
					ports: ports(),
					equipmentGroupIds: equipmentGroupIds.read(),
					equipmentGroups: equipmentGroups(),
				}),
				organizations: Object.freeze({
					schemaVersion: STATIC_FAB_ORGANIZATION_SNAPSHOT_SCHEMA_VERSION,
					nextOrganizationId,
					organizationIds: organizationIds.read(),
					records: organizationRecords(),
				}),
				relationships: Object.freeze({
					schemaVersion: STATIC_FAB_ASSEMBLY_RELATIONSHIP_SNAPSHOT_SCHEMA_VERSION,
					nextRelationshipId,
					relationshipIds: relationshipIds.read(),
					records: Object.freeze({ ...relationshipRecords(), scopedEdges: scopedEdges() }),
				}),
			});
		})(),
	);
}

function cursor(value: unknown, label: string, maximum = 0x8000_0000): number {
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum)
		throw new Error(`${label} cursor is invalid.`);
	return value as number;
}

function assertVersion(value: unknown, expected: number, label: string): void {
	if (value !== expected) throw new Error(`${label} snapshot version is unsupported.`);
}
