import { certifyProductionBayModule } from "../compile/ProductionBayModuleCompiler";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { lShapedPath, planRailPath } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { DIR_E, DIR_S, DIR_W } from "../core/railShape";
import type { StaticFabAisleIntegrationIntent } from "../core/StaticFabAisleIntegration";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import { reconstructPortableBundleMap } from "../core/StaticFabOrganizationBundle";
import { TileMap } from "../core/TileMap";

/** Independently generated Production Bay and one detached straight AISLE; no external data. */
export function aisleIntegrationFixture(withEquipment = true) {
	const artifact = certifyProductionBayModule({
		anchor: { x: 0, y: 0 },
		outerLengthMeters: 40,
		outerDepthMeters: 16,
		shellMarginMeters: 3,
		processLoopGapMeters: 4,
		gatewayLengthMeters: 6,
		processLoopCount: 1,
		pose: { forward: DIR_E, side: "right", flow: "forward" },
	});
	const bundle = artifact.organizationBundle;
	const portableMap = reconstructPortableBundleMap(bundle);
	if (typeof portableMap === "string") throw new Error(portableMap);
	const dx = Math.min(...artifact.plan.occupiedCells.map((cell) => cell.x));
	const dy = Math.min(...artifact.plan.occupiedCells.map((cell) => cell.y));
	const map = new TileMap();
	portableMap.forEachRail((x, y, _rail, encoded) => map.setEncoded(x + dx, y + dy, encoded));
	const records: StaticFabOrganizationRecord[] = bundle.organizations.map((record, index) => ({
		id: index + 1,
		kind: record.kind,
		declaredSemanticRole: record.declaredSemanticRole,
		name: record.name,
		properties: record.properties,
		parentOrganizationIds: record.parentOrganizationIndices.map((id) => id + 1),
		membership: {
			railEdges: record.membership.railEdgeIndices.map((index) => ({
				from: { x: bundle.railEdges[index]!.from.x + dx, y: bundle.railEdges[index]!.from.y + dy },
				to: { x: bundle.railEdges[index]!.to.x + dx, y: bundle.railEdges[index]!.to.y + dy },
			})),
			advancedSwitchIds: [],
			equipmentGroupIds: [],
		},
	}));
	const cells = lShapedPath({ x: 16, y: -10 }, { x: 26, y: -10 }, true);
	const draft = planRailPath(map, cells);
	if (!draft.valid) throw new Error(draft.reason);
	map.applyAtomicMutations(draft.mutations, []);
	const aisleId = records.length + 1;
	records.push({
		id: aisleId,
		kind: "AISLE",
		declaredSemanticRole: null,
		name: "Detached aisle",
		properties: { description: "Synthetic test aisle", color: "TEAL" },
		parentOrganizationIds: [],
		membership: {
			railEdges: cells.slice(1).map((to, index) => ({ from: cells[index]!, to })),
			advancedSwitchIds: [],
			equipmentGroupIds: [],
		},
	});
	const equipment: PortEquipmentState = withEquipment
		? {
				nextPortId: 2,
				nextEquipmentGroupId: 2,
				ports: [
					{
						id: 1,
						equipmentGroupId: 1,
						route: { kind: "CARDINAL_CELL", x: 21, z: -10, from: DIR_W, to: DIR_E },
						stationMillimeters: 500,
						side: "LEFT",
						lateralOffsetMillimeters: 700,
						direction: "WITH_TRAVEL",
						portType: "OHB",
						barcode: "SYNTHETIC-OHB-1",
					},
				],
				equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
			}
		: emptyPortEquipmentState();
	if (withEquipment)
		records[records.length - 1] = {
			...records[records.length - 1]!,
			membership: { ...records[records.length - 1]!.membership, equipmentGroupIds: [1] },
		};
	const organizations = copyStaticFabOrganizationState({
		records,
		nextOrganizationId: aisleId + 1,
	});
	const document = RailDocument.fromLoadedMap(map, 0, equipment, organizations);
	const intent: StaticFabAisleIntegrationIntent = {
		version: 1,
		aisleOrganizationId: aisleId,
		bayOrganizationId: 1,
		entryGateway: { x: 15, y: 0 },
		exitGateway: { x: 27, y: 0 },
	};
	return { document, intent, scope: { projectId: "synthetic-aisle-test", projectGeneration: 1 } };
}

/** The target Production Bay owns a real four-movement switch and a second return loop. */
export function aisleIntegrationSwitchFixture(closedReturn = true) {
	const fixture = aisleIntegrationFixture();
	const map = fixture.document.map.clone();
	const switchRecord: AdvancedSwitchRecord = {
		id: 1,
		profileClass: "B",
		origin: { x: 30, y: 16 },
		forward: DIR_W,
		lateral: DIR_S,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
	const geometry = deriveAdvancedSwitchGeometry(switchRecord);
	map.applyAtomicMutations(
		geometry.cellStates
			.map((cell) => ({
				x: cell.x,
				y: cell.y,
				before: map.getEncoded(cell.x, cell.y),
				after: map.getEncoded(cell.x, cell.y) | cell.encoded,
			}))
			.filter((cell) => cell.before !== cell.after),
		[{ id: switchRecord.id, before: null, after: switchRecord }],
	);
	const corners = [
		{ x: 24, y: 18 },
		{ x: 18, y: 18 },
		{ x: 18, y: 26 },
		{ x: 36, y: 26 },
		{ x: 36, y: 18 },
		{ x: closedReturn ? 30 : 31, y: 18 },
	];
	const cells = corners
		.slice(1)
		.flatMap((to, index) => lShapedPath(corners[index]!, to).slice(index === 0 ? 0 : 1));
	const draft = planRailPath(map, cells);
	if (!draft.valid) throw new Error(draft.reason);
	map.applyAtomicMutations(draft.mutations, []);
	const bay = fixture.document.organizations.records[0]!;
	const otherEdges = new Set(
		fixture.document.organizations.records
			.filter((record) => record.id !== bay.id)
			.flatMap((record) => record.membership.railEdges.map(staticFabOrganizationEdgeKey)),
	);
	const modules = buildRailModuleOwnershipIndex(map).modules.filter(
		(module) =>
			!module.eraseEdges.some((edge) => otherEdges.has(staticFabOrganizationEdgeKey(edge))),
	);
	const edges = new Map(
		modules
			.flatMap((module) => module.eraseEdges)
			.map((edge) => [staticFabOrganizationEdgeKey(edge), edge]),
	);
	const organizations = copyStaticFabOrganizationState({
		...fixture.document.organizations,
		records: fixture.document.organizations.records.map((record) =>
			record.id === bay.id
				? {
						...record,
						membership: {
							...record.membership,
							railEdges: [...edges.values()].sort(compareDirectedRailEdges),
							advancedSwitchIds: [switchRecord.id],
						},
					}
				: record,
		),
	});
	return {
		...fixture,
		switchRecord,
		document: RailDocument.fromLoadedMap(map, 0, fixture.document.portEquipment, organizations),
	};
}
