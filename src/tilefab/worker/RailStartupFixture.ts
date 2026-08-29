import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import {
	planEqRowPlacement,
	planOhbPlacement,
	planStkPlacement,
} from "../compile/PortPlacementPlanner";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
} from "../compile/PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "../compile/PortSlotPreparedArtifacts";
import {
	certifyProductionBayModuleCatalogRequest,
	defaultProductionBayModuleCatalogRequest,
} from "../compile/ProductionBayModuleCatalog";
import {
	applyPortEquipmentMutations,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import { assertPortEquipmentLayout, portRouteExists } from "../core/PortEquipmentLayoutValidator";
import type { PortEquipmentMutationPlan } from "../core/PortEquipmentPlan";
import { planClosedRailPathComponent, planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { type Direction, moveCell } from "../core/railShape";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
	replaceStaticFabOrganizationRecordMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationMembershipSupportsPortRoute,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import { planStaticFabOrganizationBundlePlacementWithProspectiveState } from "../core/StaticFabOrganizationBundlePlacement";
import { type Cell, TileMap } from "../core/TileMap";
import {
	RAIL_ASSEMBLY_CONNECTOR_SCALE_PROBE_CELLS,
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_CELLS,
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA,
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_ROOT_COUNT,
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_TARGET_BAY_ID,
	RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_CELLS,
} from "./RailStartupProtocol";

const RAIL_SEMANTIC_BAY_DELETE_FILLER_CELLS = 99_810;
const RAIL_SEMANTIC_BAY_DELETE_COMPONENT_CELLS =
	RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_CELLS - RAIL_SEMANTIC_BAY_DELETE_FILLER_CELLS;
const RAIL_BAY_FLOW_EDIT_COMPONENT_CELLS = 292;
const RAIL_BAY_FLOW_EDIT_COMPONENT_EDGES = 296;
const RAIL_BAY_FLOW_EDIT_COMPONENT_PHYSICAL_PATHS = 300;
const RAIL_BAY_FLOW_EDIT_FILLER_CELLS =
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_CELLS - RAIL_BAY_FLOW_EDIT_COMPONENT_CELLS;

/** Build one deterministic public-safe scale source inside the isolated startup Worker. */
export function createRailScaleProbeDocument(
	cellCount: number,
	rootCount: 1 | 2 | 3 | 4 = 1,
): RailDocument {
	if (rootCount === 2 && cellCount === RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_CELLS) {
		return createSemanticBayDeleteScaleProbeDocument(RAIL_SEMANTIC_BAY_DELETE_FILLER_CELLS);
	}
	if (
		rootCount === RAIL_BAY_FLOW_EDIT_SCALE_PROBE_ROOT_COUNT &&
		cellCount === RAIL_BAY_FLOW_EDIT_SCALE_PROBE_CELLS
	) {
		return createBayFlowEditScaleProbeDocument(RAIL_BAY_FLOW_EDIT_FILLER_CELLS);
	}
	if (rootCount === 4) return createAssemblyConnectorScaleProbeDocument(cellCount);
	if (!Number.isSafeInteger(cellCount) || cellCount < 2 || cellCount > 50_000) {
		throw new RangeError("Scale probe cell count must be an integer between 2 and 50,000");
	}
	if (rootCount === 2) return createTwoRootScaleProbeDocument(cellCount);
	if (rootCount === 3) return createArrangementScaleProbeDocument(cellCount);
	const document = new RailDocument();
	// Keep the forward construction endpoint at world origin so the real draft path is testable.
	const plan = planRailConstruction(document.map, { x: cellCount - 1, y: 0 }, { x: 0, y: 0 });
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Unable to build scale probe: ${plan.reason}`);
	}
	return document;
}

/**
 * Add one valid single-port OHB group to every cell of the public straight scale route.
 * This remains synthetic acceptance data and exercises canonical startup/adoption without a second
 * renderer-only equipment model.
 */
export function createRailEquipmentScaleProbeDocument(portCount: number): RailDocument {
	if (!Number.isSafeInteger(portCount) || portCount < 2 || portCount > 50_000) {
		throw new RangeError(
			"Equipment scale probe port count must be an integer between 2 and 50,000",
		);
	}
	const source = createRailScaleProbeDocument(portCount);
	const ports: Array<PortEquipmentState["ports"][number]> = [];
	const equipmentGroups: Array<PortEquipmentState["equipmentGroups"][number]> = [];
	for (let index = 0; index < portCount; index++) {
		const id = index + 1;
		const rail = source.map.getRail(index, 0);
		ports.push({
			id,
			equipmentGroupId: id,
			route: {
				kind: "CARDINAL_CELL",
				x: index,
				z: 0,
				from: rail.incoming as 0 | Direction,
				to: rail.outgoing as 0 | Direction,
			},
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "OHB",
			barcode: null,
		});
		equipmentGroups.push({ id, kind: "OHB", template: "SINGLE", portIds: [id] });
	}
	return RailDocument.fromLoadedMap(source.map, source.getPatchSequence(), {
		nextPortId: portCount + 1,
		nextEquipmentGroupId: portCount + 1,
		ports,
		equipmentGroups,
	});
}

/**
 * Build the exact semantic-Bay deletion scale shape, or a smaller topology-isomorphic fixture for
 * compiler tests. The Bay is always sourced from the public certified module catalog; only the
 * remote synthetic loop perimeter is variable.
 */
export function createSemanticBayDeleteScaleProbeDocument(fillerCellCount: number): RailDocument {
	if (!Number.isSafeInteger(fillerCellCount) || fillerCellCount < 16 || fillerCellCount % 2 !== 0) {
		throw new RangeError("Semantic Bay Delete filler must be an even integer of at least 16 cells");
	}
	const artifact = certifyProductionBayModuleCatalogRequest(
		defaultProductionBayModuleCatalogRequest("single-production-bay"),
	);
	if (artifact.topology.cells !== RAIL_SEMANTIC_BAY_DELETE_COMPONENT_CELLS) {
		throw new Error(
			`Certified single Production Bay contains ${artifact.topology.cells} cells; expected ${RAIL_SEMANTIC_BAY_DELETE_COMPONENT_CELLS}.`,
		);
	}
	const sourceMap = new TileMap();
	const sourceEquipment = emptyPortEquipmentState();
	const placement = planStaticFabOrganizationBundlePlacementWithProspectiveState(
		sourceMap,
		sourceEquipment,
		0,
		emptyStaticFabOrganizationState(),
		artifact.organizationBundle,
		{ x: 0, y: 0 },
		0,
		null,
	);
	if (!placement.plan.valid || !placement.prospectiveState) {
		throw new Error(`Unable to materialize certified semantic Bay: ${placement.plan.reason}`);
	}
	const {
		map,
		portEquipment: emptyEquipment,
		organizations: emptyEquipmentOrganizations,
	} = placement.prospectiveState;
	if (map.size !== artifact.topology.cells || emptyEquipmentOrganizations.records.length !== 2) {
		throw new Error(
			`Certified semantic Bay materialization mismatch: ${map.size} cells and ${emptyEquipmentOrganizations.records.length} organizations.`,
		);
	}
	const equippedBay = createSemanticBayDeleteEquipment(
		map,
		emptyEquipment,
		emptyEquipmentOrganizations,
	);

	const halfPerimeter = fillerCellCount / 2;
	const fillerWidth = Math.floor(halfPerimeter / 2);
	const fillerDepth = halfPerimeter - fillerWidth;
	const fillerRoute = rectangleRoute({ x: 100_000, y: 100_000 }, fillerWidth, fillerDepth);
	applyScaleProbePlan(
		map,
		planClosedRailPathComponent(map, fillerRoute),
		"filler loop",
		"Semantic Bay Delete",
	);
	const expectedCellCount = artifact.topology.cells + fillerCellCount;
	if (map.size !== expectedCellCount) {
		throw new Error(
			`Semantic Bay Delete scale probe built ${map.size} of ${expectedCellCount} cells.`,
		);
	}
	const portEquipment = addRetainedSemanticBayDeleteOhb(
		map,
		equippedBay.portEquipment,
		fillerRoute,
	);
	assertPortEquipmentLayout(map, portEquipment);
	const organizationError = staticFabOrganizationStateError(
		map,
		portEquipment,
		equippedBay.organizations,
	);
	if (organizationError) {
		throw new Error(`Semantic Bay Delete equipment ownership is invalid: ${organizationError}`);
	}
	return RailDocument.fromLoadedMap(map, 1, portEquipment, equippedBay.organizations);
}

interface EquippedSemanticBayDeleteSource {
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

/** Author the dependency fixture through the same public-safe port planners used by the editor. */
function createSemanticBayDeleteEquipment(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): EquippedSemanticBayDeleteSource {
	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const bay = organizations.records.find((record) => roles.get(record.id) === "BAY");
	const processLoop = organizations.records.find(
		(record) => roles.get(record.id) === "PROCESS_LOOP",
	);
	if (!bay || !processLoop) {
		throw new Error("Semantic Bay Delete dependency fixture requires one Bay and Process Loop.");
	}
	const bayMembership = Object.freeze({
		edges: new Set(bay.membership.railEdges.map(staticFabOrganizationEdgeKey)),
		switches: new Set(bay.membership.advancedSwitchIds),
	});
	const processLoopMembership = Object.freeze({
		edges: new Set(processLoop.membership.railEdges.map(staticFabOrganizationEdgeKey)),
		switches: new Set(processLoop.membership.advancedSwitchIds),
	});
	const physical = compilePhysicalRail(map);
	const slots = compilePortSlotPreparedArtifactCatalog(physical);
	let nextEquipment = portEquipment;

	const eqPlan = firstValidScaleProbeEqPlan(
		slots.EQ.slots,
		physical,
		nextEquipment,
		map.getRevision(),
		processLoopMembership,
	);
	nextEquipment = applyScaleProbeEquipmentPlan(nextEquipment, eqPlan, "EQ");

	const ohbPlan = firstValidScaleProbeSinglePlan(
		slots.OHB.slots,
		physical,
		nextEquipment,
		map.getRevision(),
		"OHB",
		bayMembership,
	);
	nextEquipment = applyScaleProbeEquipmentPlan(nextEquipment, ohbPlan, "OHB");

	const stkPlan = firstValidScaleProbeSinglePlan(
		slots.STK.slots,
		physical,
		nextEquipment,
		map.getRevision(),
		"STK",
		processLoopMembership,
	);
	nextEquipment = applyScaleProbeEquipmentPlan(nextEquipment, stkPlan, "STK");
	assertPortEquipmentLayout(map, nextEquipment);

	const groupByKind = new Map(nextEquipment.equipmentGroups.map((group) => [group.kind, group]));
	const eqGroup = groupByKind.get("EQ");
	const ohbGroup = groupByKind.get("OHB");
	const stkGroup = groupByKind.get("STK");
	if (!eqGroup || !ohbGroup || !stkGroup || nextEquipment.equipmentGroups.length !== 3) {
		throw new Error("Semantic Bay Delete dependency fixture requires one EQ, OHB, and STK group.");
	}
	const ownedOrganizations = Object.freeze({
		nextOrganizationId: organizations.nextOrganizationId,
		records: Object.freeze(
			organizations.records.map((record) => {
				const addedGroupIds =
					record.id === bay.id
						? [ohbGroup.id]
						: record.id === processLoop.id
							? [eqGroup.id, stkGroup.id]
							: [];
				if (addedGroupIds.length === 0) return record;
				return replaceStaticFabOrganizationRecordMembership(
					record,
					Object.freeze({
						railEdges: record.membership.railEdges,
						advancedSwitchIds: record.membership.advancedSwitchIds,
						equipmentGroupIds: Object.freeze(
							[...record.membership.equipmentGroupIds, ...addedGroupIds].sort(
								(left, right) => left - right,
							),
						),
					}),
				);
			}),
		),
	}) satisfies StaticFabOrganizationState;
	const organizationError = staticFabOrganizationStateError(map, nextEquipment, ownedOrganizations);
	if (organizationError) {
		throw new Error(`Semantic Bay Delete dependency ownership is invalid: ${organizationError}`);
	}
	return Object.freeze({ portEquipment: nextEquipment, organizations: ownedOrganizations });
}

interface ScaleProbeOrganizationMembershipIndex {
	readonly edges: ReadonlySet<string>;
	readonly switches: ReadonlySet<number>;
}

function firstValidScaleProbeEqPlan(
	slots: CompiledPortSlots,
	physical: ReturnType<typeof compilePhysicalRail>,
	portEquipment: PortEquipmentState,
	baseRevision: number,
	membership: ScaleProbeOrganizationMembershipIndex,
): PortEquipmentMutationPlan {
	const rowByRoute = new Map<string, number>();
	for (let row = 0; row < slots.count; row += 1) {
		if (
			(slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL ||
			!scaleProbeSlotSupportedByMembership(slots, row, membership)
		) {
			continue;
		}
		rowByRoute.set(scaleProbeSlotRouteKey(slots, row), row);
	}
	const availability = new PortSlotAvailabilityIndex(physical, portEquipment, "EQ");
	for (let row = 0; row < slots.count; row += 1) {
		if (
			(slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL ||
			!scaleProbeSlotSupportedByMembership(slots, row, membership)
		) {
			continue;
		}
		const to = slots.routeToDirections[row] as Direction;
		const next = moveCell({ x: slots.routeXs[row] as number, y: slots.routeZs[row] as number }, to);
		const nextRow = rowByRoute.get(
			`${next.x}:${next.y}:${slots.routeFromDirections[row] as number}:${to}`,
		);
		if (nextRow === undefined) continue;
		const plan = planEqRowPlacement(
			slots,
			[row, nextRow],
			availability,
			portEquipment,
			1_000,
			"SYNTHETIC-SCALE-EQ",
			baseRevision,
			0,
			[row, nextRow],
		);
		if (plan.valid) return plan;
	}
	throw new Error("Unable to find two contiguous legal EQ ports in the semantic Bay fixture.");
}

function firstValidScaleProbeSinglePlan(
	slots: CompiledPortSlots,
	physical: ReturnType<typeof compilePhysicalRail>,
	portEquipment: PortEquipmentState,
	baseRevision: number,
	kind: "OHB" | "STK",
	membership: ScaleProbeOrganizationMembershipIndex,
): PortEquipmentMutationPlan {
	const availability = new PortSlotAvailabilityIndex(physical, portEquipment, kind);
	for (let row = 0; row < slots.count; row += 1) {
		if (
			(slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL ||
			!scaleProbeSlotSupportedByMembership(slots, row, membership)
		) {
			continue;
		}
		const plan =
			kind === "OHB"
				? planOhbPlacement(slots, row, availability, portEquipment, baseRevision, 0)
				: planStkPlacement(slots, [row], availability, portEquipment, "FLEX", baseRevision, 0);
		if (plan.valid) return plan;
	}
	throw new Error(`Unable to find one legal ${kind} port in the semantic Bay fixture.`);
}

function scaleProbeSlotRouteKey(slots: CompiledPortSlots, row: number): string {
	return `${slots.routeXs[row] as number}:${slots.routeZs[row] as number}:${slots.routeFromDirections[row] as number}:${slots.routeToDirections[row] as number}`;
}

function scaleProbeSlotSupportedByMembership(
	slots: CompiledPortSlots,
	row: number,
	membership: ScaleProbeOrganizationMembershipIndex,
): boolean {
	return staticFabOrganizationMembershipSupportsPortRoute(
		Object.freeze({
			kind: "CARDINAL_CELL",
			x: slots.routeXs[row] as number,
			z: slots.routeZs[row] as number,
			from: slots.routeFromDirections[row] as Direction,
			to: slots.routeToDirections[row] as Direction,
		}),
		membership.edges,
		membership.switches,
	);
}

function applyScaleProbeEquipmentPlan(
	portEquipment: PortEquipmentState,
	plan: PortEquipmentMutationPlan,
	label: string,
): PortEquipmentState {
	if (!plan.valid) throw new Error(`Unable to author ${label} scale equipment: ${plan.reason}`);
	return applyPortEquipmentMutations(
		portEquipment,
		plan.portMutations,
		plan.equipmentGroupMutations,
	);
}

/** Retain one explicit opposite-facing control port on the independent filler component. */
function addRetainedSemanticBayDeleteOhb(
	map: TileMap,
	portEquipment: PortEquipmentState,
	fillerRoute: readonly Cell[],
): PortEquipmentState {
	const origin = fillerRoute[0];
	if (!origin) {
		throw new Error("Semantic Bay Delete filler cannot host the retained OHB control.");
	}
	const prototypeMap = new TileMap();
	const prototypeRoute = rectangleRoute(origin, 4, 4);
	applyScaleProbePlan(
		prototypeMap,
		planClosedRailPathComponent(prototypeMap, prototypeRoute),
		"retained OHB prototype loop",
		"Semantic Bay Delete",
	);
	const physical = compilePhysicalRail(prototypeMap);
	const slots = compilePortSlotPreparedArtifactCatalog(physical).OHB.slots;
	const cursorState = Object.freeze({
		nextPortId: portEquipment.nextPortId,
		nextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
		ports: Object.freeze([]),
		equipmentGroups: Object.freeze([]),
	}) satisfies PortEquipmentState;
	const availability = new PortSlotAvailabilityIndex(physical, cursorState, "OHB");
	let plan: PortEquipmentMutationPlan | null = null;
	for (let row = 0; row < slots.count; row += 1) {
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) continue;
		const candidate = planOhbPlacement(
			slots,
			row,
			availability,
			cursorState,
			prototypeMap.getRevision(),
			0,
		);
		const route = candidate.portMutations[0]?.after?.route;
		if (candidate.valid && route && portRouteExists(map, route)) {
			plan = candidate;
			break;
		}
	}
	if (!plan?.valid) {
		throw new Error("Unable to author the retained OHB on a planner-verified filler route.");
	}
	const plannedPort = plan.portMutations[0]?.after;
	if (!plannedPort) throw new Error("Retained OHB planner returned no port record.");
	const oppositeFacingPort = Object.freeze({
		...plannedPort,
		direction: "AGAINST_TRAVEL" as const,
	});
	return applyPortEquipmentMutations(
		portEquipment,
		[Object.freeze({ id: oppositeFacingPort.id, before: null, after: oppositeFacingPort })],
		plan.equipmentGroupMutations,
	);
}

/**
 * Build one exact detached Twin Production Bay plus one remote synthetic filler loop. The Bay is
 * sourced from the certified public module catalog and starts in the explicit alternating pattern;
 * no reference FAB layout or operational data is involved.
 */
export function createBayFlowEditScaleProbeDocument(fillerCellCount: number): RailDocument {
	if (!Number.isSafeInteger(fillerCellCount) || fillerCellCount < 4 || fillerCellCount % 2 !== 0) {
		throw new RangeError("Bay Flow Edit filler must be an even integer of at least 4 cells");
	}
	const request = defaultProductionBayModuleCatalogRequest("twin-production-bay");
	if (
		request.internalFlowPattern !==
		RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA.sourceInternalFlowPattern
	) {
		throw new Error(
			"Certified Twin Production Bay default flow no longer matches the scale contract.",
		);
	}
	const artifact = certifyProductionBayModuleCatalogRequest(request);
	if (
		artifact.topology.cells !== RAIL_BAY_FLOW_EDIT_COMPONENT_CELLS ||
		artifact.topology.edges !== RAIL_BAY_FLOW_EDIT_COMPONENT_EDGES ||
		artifact.physical.pathCount !== RAIL_BAY_FLOW_EDIT_COMPONENT_PHYSICAL_PATHS
	) {
		throw new Error(
			`Certified Twin Production Bay contains ${artifact.topology.cells} cells, ${artifact.topology.edges} edges, and ${artifact.physical.pathCount} physical paths; expected ${RAIL_BAY_FLOW_EDIT_COMPONENT_CELLS}, ${RAIL_BAY_FLOW_EDIT_COMPONENT_EDGES}, and ${RAIL_BAY_FLOW_EDIT_COMPONENT_PHYSICAL_PATHS}.`,
		);
	}

	const placement = planStaticFabOrganizationBundlePlacementWithProspectiveState(
		new TileMap(),
		emptyPortEquipmentState(),
		0,
		emptyStaticFabOrganizationState(),
		artifact.organizationBundle,
		{ x: 0, y: 0 },
		0,
		null,
	);
	if (!placement.plan.valid || !placement.prospectiveState) {
		throw new Error(
			`Unable to materialize certified Twin Production Bay: ${placement.plan.reason}`,
		);
	}
	const { map, portEquipment, organizations } = placement.prospectiveState;
	const targetBay = organizations.records.find(
		(record) => record.id === RAIL_BAY_FLOW_EDIT_SCALE_PROBE_TARGET_BAY_ID,
	);
	if (
		map.size !== RAIL_BAY_FLOW_EDIT_COMPONENT_CELLS ||
		organizations.records.length !== RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA.organizationCount ||
		targetBay?.kind !== "BAY" ||
		(targetBay.parentOrganizationIds?.length ?? 0) !== 0
	) {
		throw new Error(
			`Certified Twin Production Bay scale identity mismatch: ${map.size} cells, ${organizations.records.length} organizations, target ${targetBay?.id ?? "missing"}.`,
		);
	}

	const halfPerimeter = fillerCellCount / 2;
	const fillerWidth = Math.floor(halfPerimeter / 2);
	const fillerDepth = halfPerimeter - fillerWidth;
	const fillerRoute = rectangleRoute({ x: 200_000, y: 200_000 }, fillerWidth, fillerDepth);
	applyScaleProbePlan(
		map,
		planClosedRailPathComponent(map, fillerRoute),
		"filler loop",
		"Bay Flow Edit",
	);
	const expectedCellCount = RAIL_BAY_FLOW_EDIT_COMPONENT_CELLS + fillerCellCount;
	const expectedEdgeCount = RAIL_BAY_FLOW_EDIT_COMPONENT_EDGES + fillerCellCount;
	if (map.size !== expectedCellCount || map.edgeCount !== expectedEdgeCount) {
		throw new Error(
			`Bay Flow Edit scale probe built ${map.size} cells and ${map.edgeCount} edges; expected ${expectedCellCount} and ${expectedEdgeCount}.`,
		);
	}
	return RailDocument.fromLoadedMap(map, 1, portEquipment, organizations);
}

function createAssemblyConnectorScaleProbeDocument(cellCount: number): RailDocument {
	if (cellCount !== RAIL_ASSEMBLY_CONNECTOR_SCALE_PROBE_CELLS) {
		throw new RangeError(
			`Assembly Connector scale probe must contain exactly ${RAIL_ASSEMBLY_CONNECTOR_SCALE_PROBE_CELLS.toLocaleString("en-US")} cells`,
		);
	}
	const outerRoutes = [
		rectangleRoute({ x: 0, y: 0 }, 36, 56),
		rectangleRoute({ x: 60, y: 0 }, 36, 56),
	] as const;
	const processRoutes = [
		rectangleRoute({ x: 8, y: 8 }, 20, 40),
		rectangleRoute({ x: 68, y: 8 }, 20, 40),
	] as const;
	const authoredBayCells = [...outerRoutes, ...processRoutes].reduce(
		(total, route) => total + route.length - 1,
		0,
	);
	const fillerCellCount = cellCount - authoredBayCells;
	const map = new TileMap();
	applyScaleProbePlan(
		map,
		planRailConstruction(map, { x: fillerCellCount - 1, y: 1_000 }, { x: 0, y: 1_000 }),
		"filler route",
	);
	for (const [index, route] of [...outerRoutes, ...processRoutes].entries()) {
		applyScaleProbePlan(
			map,
			planClosedRailPathComponent(map, route),
			`Production Bay loop ${index + 1}`,
		);
	}
	if (map.size !== cellCount) {
		throw new Error(`Assembly Connector scale probe built ${map.size} of ${cellCount} cells.`);
	}

	const records: StaticFabOrganizationRecord[] = [];
	for (let index = 0; index < outerRoutes.length; index++) {
		const bayId = index * 2 + 1;
		const processLoopId = bayId + 1;
		records.push(
			copyStaticFabOrganizationRecord({
				id: bayId,
				kind: "BAY",
				name: `Scale Production Bay ${index + 1}`,
				properties: {
					description: "Public-safe Assembly Connector scale fixture",
					color: "CYAN",
				},
				membership: routeMembership(outerRoutes[index] as readonly Cell[]),
			}),
			copyStaticFabOrganizationRecord({
				id: processLoopId,
				kind: "AISLE",
				name: `Scale Process Loop ${index + 1}`,
				parentOrganizationIds: [bayId],
				properties: {
					description: "Public-safe Process Loop scale fixture",
					color: "TEAL",
				},
				membership: routeMembership(processRoutes[index] as readonly Cell[]),
			}),
		);
	}
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: records.length + 1,
		records: Object.freeze(records),
	});
	return RailDocument.fromLoadedMap(map, 1, emptyPortEquipmentState(), organizations);
}

function applyScaleProbePlan(
	map: TileMap,
	plan: ReturnType<typeof planRailConstruction>,
	label: string,
	fixtureName = "Assembly Connector",
): void {
	if (!plan.valid || !map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? [])) {
		throw new Error(`Unable to build ${fixtureName} ${label}: ${plan.reason}`);
	}
}

function rectangleRoute(origin: Cell, width: number, depth: number): readonly Cell[] {
	const cells: Cell[] = [];
	for (let x = 0; x < width; x++) cells.push({ x: origin.x + x, y: origin.y });
	for (let y = 0; y < depth; y++) cells.push({ x: origin.x + width, y: origin.y + y });
	for (let x = width; x > 0; x--) cells.push({ x: origin.x + x, y: origin.y + depth });
	for (let y = depth; y > 0; y--) cells.push({ x: origin.x, y: origin.y + y });
	cells.push({ ...origin });
	return Object.freeze(cells.map((cell) => Object.freeze(cell)));
}

function routeMembership(route: readonly Cell[]): StaticFabOrganizationRecord["membership"] {
	return Object.freeze({
		railEdges: Object.freeze(
			route
				.slice(0, -1)
				.map((from, index) => Object.freeze({ from, to: route[index + 1] as Cell }))
				.sort(compareDirectedRailEdges),
		),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([]),
	});
}

function createArrangementScaleProbeDocument(cellCount: number): RailDocument {
	if (cellCount < 14) {
		throw new RangeError("An arrangement scale probe requires at least 14 cells");
	}
	const plans = [
		planRailConstruction(new TileMap(), { x: cellCount - 11, y: 20 }, { x: 0, y: 20 }),
		planRailConstruction(new TileMap(), { x: 4, y: 0 }, { x: 0, y: 0 }),
		planRailConstruction(new TileMap(), { x: 6, y: 4 }, { x: 2, y: 4 }),
	];
	if (plans.some((plan) => !plan.valid)) {
		throw new Error(
			`Unable to build arrangement scale probe: ${plans.map((plan) => plan.reason).join(" / ")}`,
		);
	}
	const map = new TileMap();
	if (
		!map.applyAtomicMutations(
			plans.flatMap((plan) => plan.mutations),
			plans.flatMap((plan) => plan.switchMutations ?? []),
		)
	) {
		throw new Error("Unable to commit the arrangement scale probe atomically");
	}
	return RailDocument.fromLoadedMap(map, 1);
}

function createTwoRootScaleProbeDocument(cellCount: number): RailDocument {
	if (cellCount < 4) {
		throw new RangeError("A two-root scale probe requires at least 4 cells");
	}
	const firstCellCount = Math.floor(cellCount / 2);
	const secondCellCount = cellCount - firstCellCount;
	const first = planRailConstruction(
		new TileMap(),
		{ x: firstCellCount - 1, y: 0 },
		{ x: 0, y: 0 },
	);
	const second = planRailConstruction(
		new TileMap(),
		{ x: secondCellCount - 1, y: 10 },
		{ x: 0, y: 10 },
	);
	if (!first.valid || !second.valid) {
		throw new Error(`Unable to build two-root scale probe: ${first.reason} / ${second.reason}`);
	}
	const map = new TileMap();
	if (
		!map.applyAtomicMutations(
			[...first.mutations, ...second.mutations],
			[...(first.switchMutations ?? []), ...(second.switchMutations ?? [])],
		)
	) {
		throw new Error("Unable to commit the two-root scale probe atomically");
	}
	return RailDocument.fromLoadedMap(map, 1);
}
