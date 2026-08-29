import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
	RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS,
} from "../core/RailNetworkLinkPlanner";
import type { BranchBypassTemplateParameters, RailTemplatePose } from "../core/RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction, oppositeDirection } from "../core/railShape";
import type { Cell } from "../core/TileMap";
import {
	deriveSyntheticFabLayoutPlan,
	type SyntheticFabLayoutGateway,
	type SyntheticFabLayoutLoop,
	type SyntheticFabLayoutPlan,
	type SyntheticFabLayoutWing,
} from "./SyntheticFabLayoutPlan";
import {
	createSyntheticFabTopologySpec,
	type SyntheticFabCardinalSide,
	type SyntheticFabTopologyProfile,
	type SyntheticFabTopologySpec,
} from "./SyntheticFabTopologySpec";

export const SYNTHETIC_FAB_ASSEMBLY_PLAN_VERSION = 4 as const;

export type SyntheticFabAssemblyCircuitRole =
	| "outer-circulation"
	| "wall-circuit"
	| "interbay-spine";

export type SyntheticFabAssemblyConnectionRole = "process-row" | "spine-wall" | "wall-outer";

export interface SyntheticFabAssemblyCircuitOperation {
	readonly kind: "circuit";
	readonly id: string;
	readonly label: string;
	readonly role: SyntheticFabAssemblyCircuitRole;
	readonly loop: SyntheticFabLayoutLoop;
}

export interface SyntheticFabAssemblyProcessTrunkOperation {
	readonly kind: "process-trunk";
	readonly id: string;
	readonly label: string;
	readonly role: "process-trunk";
	readonly rowId: string;
	readonly wingId: string;
	readonly column: 0 | 1;
	readonly wing: SyntheticFabLayoutWing;
	readonly sourceId: string;
	readonly targetId: string;
	readonly sourceSide: "east" | "west";
	readonly targetSide: "east" | "west";
	readonly row: number;
	readonly center: number;
	readonly sourceRun: SyntheticFabAssemblyRunContract;
	readonly targetRun: SyntheticFabAssemblyRunContract;
	readonly corridor: SyntheticFabAssemblyLinkCorridor;
	readonly exactJunctions: SyntheticFabAssemblyJunctionContract;
	readonly bayPlacements: readonly SyntheticFabAssemblyBayPlacement[];
}

export interface SyntheticFabAssemblyBayPlacement {
	readonly id: string;
	readonly label: string;
	readonly anchor: Cell;
	readonly pose: RailTemplatePose;
	readonly parameters: BranchBypassTemplateParameters;
}

export interface SyntheticFabAssemblyJunctionContract {
	readonly sourceDeparture: Cell;
	readonly sourceArrival: Cell;
	readonly targetArrival: Cell;
	readonly targetDeparture: Cell;
}

export interface SyntheticFabAssemblyRunContract {
	readonly id: string;
	readonly ownerId: string;
	readonly side: SyntheticFabCardinalSide;
	readonly anchor: Cell;
	readonly axis: "x" | "y";
	readonly fixedCoordinate: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly flowDirection: Direction;
}

export interface SyntheticFabAssemblyLinkCorridor {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface SyntheticFabAssemblyLinkOperation {
	readonly kind: "link";
	readonly id: string;
	readonly label: string;
	readonly role: SyntheticFabAssemblyConnectionRole;
	readonly sourceId: string;
	readonly targetId: string;
	readonly sourceSide: SyntheticFabCardinalSide;
	readonly targetSide: SyntheticFabCardinalSide;
	readonly row: number | null;
	readonly center: number;
	readonly sourceRun: SyntheticFabAssemblyRunContract;
	readonly targetRun: SyntheticFabAssemblyRunContract;
	readonly corridor: SyntheticFabAssemblyLinkCorridor;
}

export type SyntheticFabAssemblyOperation =
	| SyntheticFabAssemblyCircuitOperation
	| SyntheticFabAssemblyProcessTrunkOperation
	| SyntheticFabAssemblyLinkOperation;

export interface SyntheticFabAssemblyPlan {
	readonly version: typeof SYNTHETIC_FAB_ASSEMBLY_PLAN_VERSION;
	readonly topology: SyntheticFabTopologySpec;
	readonly layout: SyntheticFabLayoutPlan;
	readonly operations: readonly SyntheticFabAssemblyOperation[];
	readonly planFingerprint: string;
}

export function createSyntheticFabAssemblyPlan(
	profile: SyntheticFabTopologyProfile,
	bayPitchMeters: number,
): SyntheticFabAssemblyPlan {
	const topology = createSyntheticFabTopologySpec(profile);
	const layout = deriveSyntheticFabLayoutPlan(topology, bayPitchMeters);
	const operations = createAssemblyOperations(topology, layout);
	const planFingerprint = fingerprintSyntheticFabAssemblyPlan({ topology, layout, operations });
	return Object.freeze({
		version: SYNTHETIC_FAB_ASSEMBLY_PLAN_VERSION,
		topology,
		layout,
		operations,
		planFingerprint,
	});
}

function createAssemblyOperations(
	topology: SyntheticFabTopologySpec,
	layout: SyntheticFabLayoutPlan,
): readonly SyntheticFabAssemblyOperation[] {
	const operations: SyntheticFabAssemblyOperation[] = [
		circuitOperation(
			layout.outer.id,
			"FAB-wide outer circulation",
			"outer-circulation",
			layout.outer,
		),
		circuitOperation(
			layout.wallCircuit.id,
			layout.wallCircuit.profile.label,
			"wall-circuit",
			layout.wallCircuit,
		),
		circuitOperation(
			layout.spine.id,
			"Central interbay circulation spine",
			"interbay-spine",
			layout.spine,
		),
	];
	for (const row of layout.rows) {
		for (const wing of [row.leftWing, row.rightWing]) {
			const center = row.corridor.centerY;
			const column = wing.profile.column;
			if (column !== 0 && column !== 1) {
				throw new Error(`Synthetic FAB Wing ${wing.id} has an invalid process column.`);
			}
			const west = column === 0;
			const sourceLoop = west ? layout.wallCircuit : layout.spine;
			const targetLoop = west ? layout.spine : layout.wallCircuit;
			const sourceSide = west ? "west" : "east";
			const targetSide = west ? "west" : "east";
			const sourceRun = rectangularLoopWindowRun(
				sourceLoop,
				sourceSide,
				center,
				topology.rowLinkWindowMeters,
			);
			const targetRun = rectangularLoopWindowRun(
				targetLoop,
				targetSide,
				center,
				topology.rowLinkWindowMeters,
			);
			const exactJunctions = processTrunkJunctionContract(wing, sourceRun, targetRun);
			operations.push(
				Object.freeze({
					kind: "process-trunk",
					id: `process-trunk:${row.id}:${wing.id}`,
					label: `${wing.profile.label} · ${wing.profile.bayCount} Bay process row`,
					role: "process-trunk",
					rowId: row.id,
					wingId: wing.id,
					column,
					wing,
					sourceId: sourceLoop.id,
					targetId: targetLoop.id,
					sourceSide,
					targetSide,
					row: wing.profile.row,
					center,
					sourceRun,
					targetRun,
					corridor: networkLinkCorridor(sourceRun, targetRun, 4),
					exactJunctions,
					bayPlacements: processWingBayPlacements(wing, exactJunctions),
				}),
			);
		}
	}
	const spineWallGateways = new Map(
		layout.spineWallGateways.map((gateway) => [gateway.id, gateway]),
	);
	for (const link of topology.spineWallLinks) {
		const gateway = requiredGateway(spineWallGateways, link.id);
		operations.push(
			gatewayOperation(
				gateway,
				link.label,
				"spine-wall",
				layout.spine,
				layout.wallCircuit,
				topology.rowLinkWindowMeters,
			),
		);
	}
	const wallOuterGateways = new Map(
		layout.wallOuterGateways.map((gateway) => [gateway.id, gateway]),
	);
	for (const link of topology.wallOuterLinks) {
		const gateway = requiredGateway(wallOuterGateways, link.id);
		operations.push(
			gatewayOperation(
				gateway,
				link.label,
				"wall-outer",
				layout.wallCircuit,
				layout.outer,
				topology.rowLinkWindowMeters,
			),
		);
	}
	assertAssemblyOperationCoverage(topology, layout, operations);
	return Object.freeze(operations);
}

function processTrunkJunctionContract(
	wing: SyntheticFabLayoutWing,
	sourceRun: SyntheticFabAssemblyRunContract,
	targetRun: SyntheticFabAssemblyRunContract,
): SyntheticFabAssemblyJunctionContract {
	if (sourceRun.axis !== "y" || targetRun.axis !== "y") {
		throw new Error(`Synthetic FAB Wing ${wing.id} requires parallel vertical attachment runs.`);
	}
	const junctionMinimum =
		Math.max(sourceRun.minimum, targetRun.minimum) + RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS;
	const junctionMaximum =
		Math.min(sourceRun.maximum, targetRun.maximum) - RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS;
	if (junctionMaximum - junctionMinimum < RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS) {
		throw new Error(`Synthetic FAB Wing ${wing.id} has no supported paired row junction.`);
	}
	const preferred = Math.round((sourceRun.anchor.y + targetRun.anchor.y) / 2);
	const sourceSign = verticalDirectionSign(sourceRun.flowDirection);
	const departureCoordinate =
		sourceSign > 0
			? clamp(
					preferred,
					junctionMinimum,
					junctionMaximum - RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
				)
			: clamp(
					preferred,
					junctionMinimum + RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
					junctionMaximum,
				);
	const returnCoordinate =
		departureCoordinate + sourceSign * RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS;
	return Object.freeze({
		sourceDeparture: Object.freeze({ x: sourceRun.fixedCoordinate, y: departureCoordinate }),
		sourceArrival: Object.freeze({ x: sourceRun.fixedCoordinate, y: returnCoordinate }),
		targetArrival: Object.freeze({ x: targetRun.fixedCoordinate, y: departureCoordinate }),
		targetDeparture: Object.freeze({ x: targetRun.fixedCoordinate, y: returnCoordinate }),
	});
}

function processWingBayPlacements(
	wing: SyntheticFabLayoutWing,
	exactJunctions: SyntheticFabAssemblyJunctionContract,
): readonly SyntheticFabAssemblyBayPlacement[] {
	const lowerRouteIsOutbound = exactJunctions.sourceDeparture.y < exactJunctions.sourceArrival.y;
	const startX = lowerRouteIsOutbound
		? exactJunctions.sourceDeparture.x
		: exactJunctions.targetDeparture.x;
	const endX = lowerRouteIsOutbound
		? exactJunctions.targetArrival.x
		: exactJunctions.sourceArrival.x;
	const forward = endX > startX ? DIR_E : DIR_W;
	const side = forward === DIR_E ? "left" : "right";
	const trunkY = Math.min(exactJunctions.sourceDeparture.y, exactJunctions.sourceArrival.y);
	const trunkSpanMeters = Math.max(8, Math.min(16, wing.bayPitchMeters - 8));
	const offsetMeters = Math.max(4, Math.min(8, wing.depthMeters - 4));
	const requiredSpanMeters =
		Math.max(0, wing.profile.bays.length - 1) * wing.bayPitchMeters + trunkSpanMeters;
	const availableSpanMeters = Math.abs(endX - startX);
	const supportMarginMeters = 2;
	if (requiredSpanMeters + supportMarginMeters * 2 > availableSpanMeters) {
		throw new Error(
			`Synthetic FAB Wing ${wing.id} needs ${requiredSpanMeters + supportMarginMeters * 2} m of supported Bay trunk but has ${availableSpanMeters} m.`,
		);
	}
	const firstAnchorOffset = Math.max(
		supportMarginMeters,
		Math.floor((availableSpanMeters - requiredSpanMeters) / 2),
	);
	const forwardSign = forward === DIR_E ? 1 : -1;
	return Object.freeze(
		wing.profile.bays.map((bay) =>
			Object.freeze({
				id: bay.id,
				label: bay.label,
				anchor: Object.freeze({
					x: startX + forwardSign * (firstAnchorOffset + bay.index * wing.bayPitchMeters),
					y: trunkY,
				}),
				pose: Object.freeze({ forward, side, flow: "forward" }),
				parameters: Object.freeze({
					templateId: "branch-bypass",
					clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
					trunkSpanMeters,
					offsetMeters,
				}),
			}),
		),
	);
}

function verticalDirectionSign(direction: Direction): 1 | -1 {
	if (direction === DIR_S) return 1;
	if (direction === DIR_N) return -1;
	throw new Error("Synthetic FAB vertical run has a non-vertical flow direction.");
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function assertAssemblyOperationCoverage(
	topology: SyntheticFabTopologySpec,
	layout: SyntheticFabLayoutPlan,
	operations: readonly SyntheticFabAssemblyOperation[],
): void {
	const ids = operations.map((operation) => operation.id);
	if (new Set(ids).size !== ids.length) {
		throw new Error("Synthetic FAB assembly operation ids must be globally unique.");
	}
	const wings = operations.filter(
		(operation): operation is SyntheticFabAssemblyProcessTrunkOperation =>
			operation.kind === "process-trunk",
	);
	if (wings.length !== topology.wings.length || wings.length !== layout.wings.length) {
		throw new Error("Synthetic FAB assembly must cover every process Wing exactly once.");
	}
	for (const row of layout.rows) {
		const rowTrunks = wings.filter((operation) => operation.rowId === row.id);
		if (
			rowTrunks.length !== 2 ||
			!rowTrunks.some(
				(operation) => operation.wingId === row.leftWing.id && operation.column === 0,
			) ||
			!rowTrunks.some(
				(operation) => operation.wingId === row.rightWing.id && operation.column === 1,
			)
		) {
			throw new Error(`Synthetic FAB Row ${row.id} must own its exact left/right process trunks.`);
		}
	}
	const coveredBayIds = wings.flatMap((operation) =>
		operation.bayPlacements.map((placement) => placement.id),
	);
	const expectedBayIds = topology.wings.flatMap((wing) => wing.bays.map((bay) => bay.id));
	if (
		coveredBayIds.length !== expectedBayIds.length ||
		new Set(coveredBayIds).size !== coveredBayIds.length ||
		expectedBayIds.some((id) => !coveredBayIds.includes(id))
	) {
		throw new Error(
			"Synthetic FAB assembly Bay placements do not cover the topology exactly once.",
		);
	}
}

function circuitOperation(
	id: string,
	label: string,
	role: SyntheticFabAssemblyCircuitRole,
	loop: SyntheticFabLayoutLoop,
): SyntheticFabAssemblyCircuitOperation {
	return Object.freeze({ kind: "circuit", id, label, role, loop });
}

function linkOperation(
	id: string,
	label: string,
	role: SyntheticFabAssemblyConnectionRole,
	sourceId: string,
	targetId: string,
	sourceSide: SyntheticFabCardinalSide,
	targetSide: SyntheticFabCardinalSide,
	row: number | null,
	center: number,
	sourceRun: SyntheticFabAssemblyRunContract,
	targetRun: SyntheticFabAssemblyRunContract,
): SyntheticFabAssemblyLinkOperation {
	return Object.freeze({
		kind: "link",
		id,
		label,
		role,
		sourceId,
		targetId,
		sourceSide,
		targetSide,
		row,
		center,
		sourceRun,
		targetRun,
		corridor: networkLinkCorridor(sourceRun, targetRun, 4),
	});
}

function gatewayOperation(
	gateway: SyntheticFabLayoutGateway,
	label: string,
	role: "spine-wall" | "wall-outer",
	sourceLoop: SyntheticFabLayoutLoop,
	targetLoop: SyntheticFabLayoutLoop,
	windowMeters: number,
): SyntheticFabAssemblyLinkOperation {
	return linkOperation(
		gateway.id,
		label,
		role,
		gateway.sourceId,
		gateway.targetId,
		gateway.sourceSide,
		gateway.targetSide,
		null,
		gateway.center,
		rectangularLoopWindowRun(sourceLoop, gateway.sourceSide, gateway.center, windowMeters),
		rectangularLoopWindowRun(targetLoop, gateway.targetSide, gateway.center, windowMeters),
	);
}

function rectangularLoopWindowRun(
	loop: SyntheticFabLayoutLoop,
	side: SyntheticFabCardinalSide,
	center: number,
	windowMeters: number,
): SyntheticFabAssemblyRunContract {
	const halfBefore = Math.floor(windowMeters / 2);
	const halfAfter = windowMeters - halfBefore;
	const horizontal = side === "north" || side === "south";
	const straightMinimum = (horizontal ? loop.origin.x : loop.origin.y) + 2;
	const straightMaximum =
		(horizontal ? loop.origin.x + loop.lengthMeters : loop.origin.y + loop.depthMeters) - 2;
	if (center - halfBefore < straightMinimum || center + halfAfter > straightMaximum) {
		throw new Error(`Synthetic FAB run window does not fit ${loop.id}:${side}.`);
	}
	const range = Object.freeze({
		minimum: center - halfBefore,
		maximum: center + halfAfter,
	});
	return rectangularLoopRangeRun(loop, side, range, range);
}

function rectangularLoopRangeRun(
	loop: SyntheticFabLayoutLoop,
	side: SyntheticFabCardinalSide,
	xRange: Readonly<{ minimum: number; maximum: number }>,
	yRange: Readonly<{ minimum: number; maximum: number }>,
): SyntheticFabAssemblyRunContract {
	const { origin, lengthMeters, depthMeters } = loop;
	switch (side) {
		case "north":
			return xRunContract(
				loop.id,
				side,
				origin.y,
				xRange.minimum,
				xRange.maximum,
				flowDirection(loop.flow, DIR_E),
			);
		case "east":
			return yRunContract(
				loop.id,
				side,
				origin.x + lengthMeters,
				yRange.minimum,
				yRange.maximum,
				flowDirection(loop.flow, DIR_S),
			);
		case "south":
			return xRunContract(
				loop.id,
				side,
				origin.y + depthMeters,
				xRange.minimum,
				xRange.maximum,
				flowDirection(loop.flow, DIR_W),
			);
		case "west":
			return yRunContract(
				loop.id,
				side,
				origin.x,
				yRange.minimum,
				yRange.maximum,
				flowDirection(loop.flow, DIR_N),
			);
	}
}

function xRunContract(
	ownerId: string,
	side: SyntheticFabCardinalSide,
	fixedY: number,
	minimumX: number,
	maximumX: number,
	flow: Direction,
): SyntheticFabAssemblyRunContract {
	return assemblyRunContract(ownerId, side, "x", fixedY, minimumX, maximumX, flow);
}

function yRunContract(
	ownerId: string,
	side: SyntheticFabCardinalSide,
	fixedX: number,
	minimumY: number,
	maximumY: number,
	flow: Direction,
): SyntheticFabAssemblyRunContract {
	return assemblyRunContract(ownerId, side, "y", fixedX, minimumY, maximumY, flow);
}

function assemblyRunContract(
	ownerId: string,
	side: SyntheticFabCardinalSide,
	axis: "x" | "y",
	fixedCoordinate: number,
	minimum: number,
	maximum: number,
	flowDirection: Direction,
): SyntheticFabAssemblyRunContract {
	const anchor =
		axis === "x"
			? Object.freeze({ x: Math.floor((minimum + maximum) / 2), y: fixedCoordinate })
			: Object.freeze({ x: fixedCoordinate, y: Math.floor((minimum + maximum) / 2) });
	return Object.freeze({
		id: `${ownerId}:${side}:${axis}:${fixedCoordinate}:${minimum}:${maximum}`,
		ownerId,
		side,
		anchor,
		axis,
		fixedCoordinate,
		minimum,
		maximum,
		flowDirection,
	});
}

function flowDirection(flow: SyntheticFabLayoutLoop["flow"], forward: Direction): Direction {
	return flow === "forward" ? forward : oppositeDirection(forward);
}

function networkLinkCorridor(
	source: SyntheticFabAssemblyRunContract,
	target: SyntheticFabAssemblyRunContract,
	marginMeters: number,
): SyntheticFabAssemblyLinkCorridor {
	const sourceBounds = runContractBounds(source);
	const targetBounds = runContractBounds(target);
	return Object.freeze({
		minX: Math.min(sourceBounds.minX, targetBounds.minX) - marginMeters,
		minY: Math.min(sourceBounds.minY, targetBounds.minY) - marginMeters,
		maxX: Math.max(sourceBounds.maxX, targetBounds.maxX) + marginMeters,
		maxY: Math.max(sourceBounds.maxY, targetBounds.maxY) + marginMeters,
	});
}

function runContractBounds(
	contract: SyntheticFabAssemblyRunContract,
): SyntheticFabAssemblyLinkCorridor {
	return contract.axis === "x"
		? Object.freeze({
				minX: contract.minimum,
				minY: contract.fixedCoordinate,
				maxX: contract.maximum,
				maxY: contract.fixedCoordinate,
			})
		: Object.freeze({
				minX: contract.fixedCoordinate,
				minY: contract.minimum,
				maxX: contract.fixedCoordinate,
				maxY: contract.maximum,
			});
}

function requiredGateway(
	gateways: ReadonlyMap<string, SyntheticFabLayoutGateway>,
	id: string,
): SyntheticFabLayoutGateway {
	const gateway = gateways.get(id);
	if (!gateway) throw new Error(`Synthetic FAB assembly gateway ${id} is missing.`);
	return gateway;
}

export function fingerprintSyntheticFabAssemblyPlan(
	plan: Pick<SyntheticFabAssemblyPlan, "topology" | "layout" | "operations">,
): string {
	const { topology, layout, operations } = plan;
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["synthetic-fab-assembly-plan", topology.id, topology.spineId]);
	checksum.addNumbers([
		SYNTHETIC_FAB_ASSEMBLY_PLAN_VERSION,
		topology.version,
		layout.version,
		layout.topologyVersion,
		topology.blocks,
		topology.rows,
		topology.columns,
		topology.spineWidthMeters,
		topology.spineGapMeters,
		topology.spineEndMarginMeters,
		topology.rowLinkWindowMeters,
		topology.withinBlockRowPitchMeters,
		topology.processBlockPitchMeters,
		topology.wallCircuitWingGapMeters,
		topology.wallCircuitSpineEndGapMeters,
		topology.outerMarginMeters,
	]);
	fingerprintSyntheticFabTopology(checksum, topology);
	fingerprintSyntheticFabLayout(checksum, layout);
	fingerprintAssemblyOperations(checksum, operations);
	return checksum.digest();
}

function fingerprintSyntheticFabTopology(
	checksum: OrderedTypedChecksum,
	topology: SyntheticFabTopologySpec,
): void {
	checksum.addStrings([
		"topology-wall-circuit",
		topology.wallCircuit.id,
		topology.wallCircuit.label,
	]);

	const wings = canonicalById(topology.wings);
	checksum.addStrings(["topology-wings"]);
	checksum.addNumbers([wings.length]);
	for (const wing of wings) {
		checksum.addStrings([wing.id, wing.label]);
		checksum.addNumbers([wing.row, wing.column, wing.bayCount, wing.laneSpacingMeters]);
		const bays = canonicalById(wing.bays);
		checksum.addNumbers([bays.length]);
		for (const bay of bays) {
			checksum.addStrings([bay.id, bay.label]);
			checksum.addNumbers([bay.index]);
		}
	}

	const processRows = canonicalById(topology.processRows);
	checksum.addStrings(["topology-process-rows"]);
	checksum.addNumbers([processRows.length]);
	for (const row of processRows) {
		checksum.addStrings([row.id, row.label, row.leftWingId, row.rightWingId]);
		checksum.addNumbers([row.row]);
	}

	const processBanks = canonicalById(topology.processBanks);
	checksum.addStrings(["topology-process-banks"]);
	checksum.addNumbers([processBanks.length]);
	for (const bank of processBanks) {
		checksum.addStrings([bank.id, bank.label, bank.upperWingId, bank.lowerWingId]);
		checksum.addNumbers([bank.block, bank.column]);
	}

	const processBlocks = canonicalById(topology.processBlocks);
	checksum.addStrings(["topology-process-blocks"]);
	checksum.addNumbers([processBlocks.length]);
	for (const block of processBlocks) {
		checksum.addStrings([block.id, block.label, block.leftBankId, block.rightBankId]);
		checksum.addNumbers([block.block, block.upperRow, block.lowerRow]);
	}

	const spineWallLinks = canonicalById(topology.spineWallLinks);
	checksum.addStrings(["topology-spine-wall-links"]);
	checksum.addNumbers([spineWallLinks.length]);
	for (const link of spineWallLinks) {
		checksum.addStrings([
			link.id,
			link.label,
			link.sourceSpineId,
			link.sourceSide,
			link.targetWallCircuitId,
			link.targetSide,
		]);
	}

	const wallOuterLinks = canonicalById(topology.wallOuterLinks);
	checksum.addStrings(["topology-wall-outer-links"]);
	checksum.addNumbers([wallOuterLinks.length]);
	for (const link of wallOuterLinks) {
		checksum.addStrings([
			link.id,
			link.label,
			link.sourceWallCircuitId,
			link.sourceSide,
			link.outerSide,
			link.placement.kind,
		]);
		checksum.addNumbers([
			link.placement.kind === "CENTER_OFFSET"
				? link.placement.offsetMeters
				: link.placement.gapAfterBlock,
		]);
	}
}

function fingerprintSyntheticFabLayout(
	checksum: OrderedTypedChecksum,
	layout: SyntheticFabLayoutPlan,
): void {
	checksum.addStrings(["layout-loops"]);
	fingerprintLayoutLoop(checksum, layout.outer);
	fingerprintLayoutLoop(checksum, layout.wallCircuit);
	checksum.addStrings([
		layout.wallCircuit.role,
		layout.wallCircuit.profile.id,
		layout.wallCircuit.profile.label,
	]);
	fingerprintLayoutLoop(checksum, layout.spine);

	const wings = canonicalById(layout.wings);
	checksum.addStrings(["layout-wings"]);
	checksum.addNumbers([wings.length]);
	for (const wing of wings) {
		checksum.addStrings([wing.id, wing.role, wing.profile.id, wing.profile.label]);
		checksum.addNumbers([
			wing.origin.x,
			wing.origin.y,
			wing.lengthMeters,
			wing.depthMeters,
			wing.profile.row,
			wing.profile.column,
			wing.profile.bayCount,
			wing.profile.laneSpacingMeters,
			wing.bayPitchMeters,
			wing.bayStartOffsetMeters,
		]);
		const profileBays = canonicalById(wing.profile.bays);
		checksum.addNumbers([profileBays.length]);
		for (const bay of profileBays) {
			checksum.addStrings([bay.id, bay.label]);
			checksum.addNumbers([bay.index]);
		}
		const layoutBays = canonicalById(wing.bays);
		checksum.addNumbers([layoutBays.length]);
		for (const bay of layoutBays) {
			checksum.addStrings([bay.id, bay.label, bay.wingId]);
			checksum.addNumbers([bay.index]);
		}
	}

	const rows = canonicalById(layout.rows);
	checksum.addStrings(["layout-rows"]);
	checksum.addNumbers([rows.length]);
	for (const row of rows) {
		checksum.addStrings([row.id, row.label, row.leftWing.id, row.rightWing.id]);
		checksum.addNumbers([
			row.row,
			row.leftLinkCenterY,
			row.rightLinkCenterY,
			row.corridor.centerY,
			row.corridor.windowMinY,
			row.corridor.windowMaxY,
			row.corridor.westOuterX,
			row.corridor.westWallX,
			row.corridor.westWingOuterX,
			row.corridor.westWingInnerX,
			row.corridor.spineWestX,
			row.corridor.spineEastX,
			row.corridor.eastWingInnerX,
			row.corridor.eastWingOuterX,
			row.corridor.eastWallX,
			row.corridor.eastOuterX,
		]);
	}

	const banks = canonicalById(layout.banks);
	checksum.addStrings(["layout-banks"]);
	checksum.addNumbers([banks.length]);
	for (const bank of banks) {
		checksum.addStrings([
			bank.id,
			bank.label,
			bank.profile.id,
			bank.profile.label,
			bank.profile.upperWingId,
			bank.profile.lowerWingId,
			bank.upperWing.id,
			bank.lowerWing.id,
		]);
		checksum.addNumbers([bank.block, bank.column, bank.profile.block, bank.profile.column]);
	}

	const blocks = canonicalById(layout.blocks);
	checksum.addStrings(["layout-blocks"]);
	checksum.addNumbers([blocks.length]);
	for (const block of blocks) {
		checksum.addStrings([
			block.id,
			block.label,
			block.profile.id,
			block.profile.label,
			block.profile.leftBankId,
			block.profile.rightBankId,
			block.upperRow.id,
			block.lowerRow.id,
			block.leftBank.id,
			block.rightBank.id,
		]);
		checksum.addNumbers([
			block.block,
			block.profile.block,
			block.profile.upperRow,
			block.profile.lowerRow,
		]);
	}

	fingerprintLayoutGateways(checksum, "layout-spine-wall-gateways", layout.spineWallGateways);
	fingerprintLayoutGateways(checksum, "layout-wall-outer-gateways", layout.wallOuterGateways);
}

function fingerprintLayoutLoop(checksum: OrderedTypedChecksum, loop: SyntheticFabLayoutLoop): void {
	checksum.addStrings([loop.id, loop.flow]);
	checksum.addNumbers([loop.origin.x, loop.origin.y, loop.lengthMeters, loop.depthMeters]);
}

function fingerprintLayoutGateways(
	checksum: OrderedTypedChecksum,
	section: string,
	gateways: readonly SyntheticFabLayoutGateway[],
): void {
	const canonicalGateways = canonicalById(gateways);
	checksum.addStrings([section]);
	checksum.addNumbers([canonicalGateways.length]);
	for (const gateway of canonicalGateways) {
		checksum.addStrings([
			gateway.id,
			gateway.kind,
			gateway.sourceId,
			gateway.targetId,
			gateway.sourceSide,
			gateway.targetSide,
		]);
		checksum.addNumbers([gateway.center]);
	}
}

function fingerprintAssemblyOperations(
	checksum: OrderedTypedChecksum,
	operations: readonly SyntheticFabAssemblyOperation[],
): void {
	checksum.addStrings(["assembly-operations"]);
	checksum.addNumbers([operations.length]);
	for (const operation of operations) {
		checksum.addStrings([operation.kind, operation.id, operation.label, operation.role]);
		if (operation.kind === "circuit") {
			checksum.addNumbers([
				operation.loop.origin.x,
				operation.loop.origin.y,
				operation.loop.lengthMeters,
				operation.loop.depthMeters,
			]);
			checksum.addStrings([operation.loop.flow]);
		} else if (operation.kind === "process-trunk") {
			checksum.addStrings([
				operation.rowId,
				operation.wingId,
				operation.sourceId,
				operation.targetId,
				operation.sourceSide,
				operation.targetSide,
			]);
			checksum.addNumbers([
				operation.column,
				operation.row,
				operation.center,
				operation.wing.origin.x,
				operation.wing.origin.y,
				operation.wing.lengthMeters,
				operation.wing.depthMeters,
				operation.wing.bayPitchMeters,
				operation.wing.bayStartOffsetMeters,
				operation.wing.bays.length,
			]);
			checksum.addStrings([
				operation.wing.profile.id,
				operation.wing.profile.label,
				...operation.wing.bays.flatMap((bay) => [bay.id, bay.label, bay.wingId, `${bay.index}`]),
			]);
			checksum.addNumbers([
				operation.exactJunctions.sourceDeparture.x,
				operation.exactJunctions.sourceDeparture.y,
				operation.exactJunctions.sourceArrival.x,
				operation.exactJunctions.sourceArrival.y,
				operation.exactJunctions.targetArrival.x,
				operation.exactJunctions.targetArrival.y,
				operation.exactJunctions.targetDeparture.x,
				operation.exactJunctions.targetDeparture.y,
			]);
			checksum.addNumbers([operation.bayPlacements.length]);
			for (const placement of operation.bayPlacements) {
				checksum.addStrings([
					placement.id,
					placement.label,
					placement.pose.side,
					placement.pose.flow ?? "forward",
					placement.parameters.templateId,
					placement.parameters.clearanceProfileId,
				]);
				checksum.addNumbers([
					placement.anchor.x,
					placement.anchor.y,
					placement.pose.forward,
					placement.parameters.trunkSpanMeters,
					placement.parameters.offsetMeters,
				]);
			}
			fingerprintAssemblyRun(checksum, operation.sourceRun);
			fingerprintAssemblyRun(checksum, operation.targetRun);
			checksum.addNumbers([
				operation.corridor.minX,
				operation.corridor.minY,
				operation.corridor.maxX,
				operation.corridor.maxY,
			]);
		} else {
			checksum.addStrings([
				operation.sourceId,
				operation.targetId,
				operation.sourceSide,
				operation.targetSide,
			]);
			checksum.addNumbers([operation.row ?? -1, operation.center]);
			fingerprintAssemblyRun(checksum, operation.sourceRun);
			fingerprintAssemblyRun(checksum, operation.targetRun);
			checksum.addNumbers([
				operation.corridor.minX,
				operation.corridor.minY,
				operation.corridor.maxX,
				operation.corridor.maxY,
			]);
		}
	}
}

function fingerprintAssemblyRun(
	checksum: OrderedTypedChecksum,
	run: SyntheticFabAssemblyRunContract,
): void {
	checksum.addStrings([run.id, run.ownerId, run.side, run.axis]);
	checksum.addNumbers([
		run.anchor.x,
		run.anchor.y,
		run.fixedCoordinate,
		run.minimum,
		run.maximum,
		run.flowDirection,
	]);
}

function canonicalById<T extends Readonly<{ id: string }>>(records: readonly T[]): readonly T[] {
	return [...records].sort((left, right) => compareCanonicalString(left.id, right.id));
}

function compareCanonicalString(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
