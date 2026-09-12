import type { AdvancedSwitchRecord } from "../core/AdvancedSwitch";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { PortRecord } from "../core/PortRecord";
import { DIR_E, DIR_N } from "../core/railShape";
import { staticFabArrangementPlanFingerprint } from "../core/StaticFabArrangementCertification";
import type { StaticFabArrangementPlan } from "../core/StaticFabArrangementPlan";
import {
	copyStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyScopedEdgeV1,
} from "../core/StaticFabAssemblyRelationship";
import type { StaticFabOrganizationRecord } from "../core/StaticFabOrganization";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot, checksumRailMap } from "./RailMirrorChecksum";
import type { PreparedStaticFabArrangement } from "./StaticFabArrangementProtocol";

/** Shape-valid transport fixture; live source authority is tested through the runtime and bridge. */
export function validPreparedArrangement(): PreparedStaticFabArrangement {
	const railChecksums = actualRailChecksums();
	const sourceRailStart = encodeRailCell({ incoming: 0, outgoing: DIR_E });
	const sourceRailEnd = encodeRailCell({ incoming: 8, outgoing: 0 });
	const beforeSwitch: AdvancedSwitchRecord = {
		id: 1,
		profileClass: "A",
		origin: { x: 20, y: 10 },
		forward: DIR_E,
		lateral: DIR_N,
		movementMask: 0b1111,
	};
	const afterSwitch: AdvancedSwitchRecord = {
		...beforeSwitch,
		origin: { x: 20, y: 0 },
	};
	const beforePort: PortRecord = {
		id: 1,
		equipmentGroupId: 1,
		route: { kind: "CARDINAL_CELL", x: 10, z: 10, from: 0, to: DIR_E },
		stationMillimeters: 0,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "OHB",
		barcode: "PORT-1",
	};
	const afterPort: PortRecord = {
		...beforePort,
		route: { kind: "CARDINAL_CELL", x: 10, z: 0, from: 0, to: DIR_E },
	};
	const beforeOrganization: StaticFabOrganizationRecord = {
		id: 1,
		kind: "BAY",
		name: "Bay One",
		parentOrganizationIds: [],
		properties: { description: "", color: "CYAN" },
		membership: {
			railEdges: [{ from: { x: 10, y: 10 }, to: { x: 11, y: 10 } }],
			advancedSwitchIds: [1],
			equipmentGroupIds: [1],
		},
	};
	const afterOrganization: StaticFabOrganizationRecord = {
		...beforeOrganization,
		membership: {
			...beforeOrganization.membership,
			railEdges: [{ from: { x: 10, y: 0 }, to: { x: 11, y: 0 } }],
		},
	};
	const plan: StaticFabArrangementPlan = {
		kind: "arrange-static-fab",
		baseRevision: 3,
		basePatchSequence: 7,
		valid: true,
		reason: "2 roots arranged",
		issueCode: null,
		cells: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 10, y: 0 },
			{ x: 11, y: 0 },
			{ x: 20, y: 0 },
			{ x: 10, y: 10 },
			{ x: 11, y: 10 },
			{ x: 20, y: 10 },
		],
		conflicts: [],
		mutations: [
			{ x: 10, y: 0, before: 0, after: sourceRailStart },
			{ x: 11, y: 0, before: 0, after: sourceRailEnd },
			{ x: 10, y: 10, before: sourceRailStart, after: 0 },
			{ x: 11, y: 10, before: sourceRailEnd, after: 0 },
		],
		switchMutations: [{ id: 1, before: beforeSwitch, after: afterSwitch }],
		portMutations: [{ id: 1, before: beforePort, after: afterPort }],
		equipmentGroupMutations: [],
		organizationMutations: [{ id: 1, before: beforeOrganization, after: afterOrganization }],
		organizationImpactAuthorizations: [1],
		relationshipMutations: Object.freeze([]),
		nextRelationshipIdBefore: 1,
		nextRelationshipIdAfter: 1,
		nextOrganizationIdBefore: 2,
		nextOrganizationIdAfter: 2,
		arrangement: {
			version: 2,
			axis: "Z",
			mode: "ALIGN_MIN",
			translations: [
				{
					key: "root-a",
					deltaX: 0,
					deltaZ: 0,
					before: { minX: 0, minZ: 0, maxXExclusive: 2, maxZExclusive: 1 },
					after: { minX: 0, minZ: 0, maxXExclusive: 2, maxZExclusive: 1 },
				},
				{
					key: "root-b",
					deltaX: 0,
					deltaZ: -10,
					before: { minX: 10, minZ: 10, maxXExclusive: 22, maxZExclusive: 11 },
					after: { minX: 10, minZ: 0, maxXExclusive: 22, maxZExclusive: 1 },
				},
			],
			maximumSnapErrorMeters: 0,
			rootCount: 2,
			moduleCount: 2,
			railEdgeCount: 2,
			advancedSwitchCount: 1,
			portCount: 1,
			equipmentGroupCount: 1,
			affectedOrganizationIds: [1],
		},
	};
	return {
		plan,
		ticket: {
			ticketId: 41,
			validationLevel: "exact",
			sourceRevision: plan.baseRevision,
			sourcePatchSequence: plan.basePatchSequence,
			sourceChecksum: railChecksums.source,
			sourceNextAdvancedSwitchId: 2,
			sourceNextPortId: 2,
			sourceNextEquipmentGroupId: 2,
			sourceNextOrganizationId: 2,
			sourceNextRelationshipId: 1,
			intentFingerprint: checksum("intent"),
			planFingerprint: staticFabArrangementPlanFingerprint(plan),
			prospectiveChecksum: railChecksums.prospective,
			prospectiveNextAdvancedSwitchId: 2,
			prospectiveNextPortId: 2,
			prospectiveNextEquipmentGroupId: 2,
			prospectiveNextOrganizationId: 2,
			prospectiveNextRelationshipId: 1,
		},
		valid: true,
		failureCode: null,
		reason: plan.reason,
		conflictCells: [],
		conflictCount: 0,
		planningMilliseconds: 1,
		validationMilliseconds: 2,
	};
}

function actualRailChecksums(): { readonly source: string; readonly prospective: string } {
	const source = new TileMap();
	const prospective = source.clone();
	prospective.applyAtomicMutations(
		[
			{
				x: 0,
				y: 0,
				before: 0,
				after: encodeRailCell({ incoming: 0, outgoing: DIR_E }),
			},
			{
				x: 1,
				y: 0,
				before: 0,
				after: encodeRailCell({ incoming: 8, outgoing: 0 }),
			},
		],
		[],
	);
	return {
		source: captureRailMirrorSnapshot(source, 0).snapshot.checksum,
		prospective: checksumRailMap(prospective),
	};
}

function checksum(label: string): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([label]);
	return checksum.digest();
}
export function arrangementRelationshipTestRecord(
	count: number,
	owners: readonly number[] = [2],
): StaticFabAssemblyRelationshipRecordV1 {
	const parent = (x: number): StaticFabAssemblyScopedEdgeV1 => ({
		edge: { from: { x, y: 0 }, to: { x: x + 1, y: 0 } },
		scope: { kind: "PARENT_DIRECT" },
	});
	const cuts = Array.from(
		{ length: count },
		(_, x): StaticFabAssemblyScopedEdgeV1 => ({
			edge: { from: { x, y: 0 }, to: { x: x + 1, y: 0 } },
			scope: {
				kind: "PARTICIPANT_EFFECTIVE",
				participantIndex: 0,
				directOwnerOrganizationIds: owners,
			},
		}),
	);
	return copyStaticFabAssemblyRelationshipRecord({
		id: 1,
		hierarchyRole: "BAY_TO_BANK",
		purpose: "HIERARCHY_LINK",
		parentOrganizationId: 1,
		participantOrganizationIds: [2],
		managedChildOrganizationIds: [2],
		reviewPolicy: "REVIEW_REQUIRED",
		connectionGroups: [
			{
				ordinal: 0,
				legs: [
					{
						ordinal: 0,
						directionRole: "ATTACHMENT",
						exclusiveCutEdges: cuts,
						endpointSupports: [
							{ support: parent(-1), adjacentExclusiveCutEdgeIndex: 0, position: "PREDECESSOR" },
							{
								support: parent(count),
								adjacentExclusiveCutEdgeIndex: count - 1,
								position: "SUCCESSOR",
							},
						],
						seamContacts: [
							{
								role: "CONTACT",
								incidences: [
									{ incidence: "INCOMING", binding: { kind: "WITNESS", scopedEdge: parent(-1) } },
									{
										incidence: "OUTGOING",
										binding: { kind: "EXCLUSIVE_CUT_EDGE", exclusiveCutEdgeIndex: 0 },
									},
								],
							},
							{
								role: "CONTACT",
								incidences: [
									{
										incidence: "INCOMING",
										binding: { kind: "EXCLUSIVE_CUT_EDGE", exclusiveCutEdgeIndex: count - 1 },
									},
									{
										incidence: "OUTGOING",
										binding: { kind: "WITNESS", scopedEdge: parent(count) },
									},
								],
							},
						],
					},
				],
			},
		],
	});
}
