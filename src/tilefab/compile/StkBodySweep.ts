import type { PortEquipmentState } from "../core/EquipmentGroup";
import { type CardinalPortRoute, type PortRecord, portRouteIdentityKey } from "../core/PortRecord";
import { type Direction, moveCell, oppositeDirection } from "../core/railShape";
import { type CompiledPathIntervalRemap, PATH_SOURCE_IDENTITY_KIND } from "./CompoundPhysicalPath";
import { PATH_KIND } from "./PhysicalPathCompiler";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";

export const STK_BODY_HALF_WIDTH_METERS = 0.42;
const STK_BODY_END_MARGIN_METERS = 0.5;
const SWEEP_OVERLAP_EPSILON_METERS = 1e-6;

export interface StkBodySweepPort {
	readonly route: CardinalPortRoute;
	readonly stationMillimeters: number;
}

/** One connected straight-run reservation derived from a committed STK port group. */
export interface StkBodySweep {
	readonly equipmentGroupId: number;
	readonly runId: number;
	readonly centerX: number;
	readonly centerZ: number;
	readonly tangentX: number;
	readonly tangentZ: number;
	readonly halfLength: number;
	readonly halfWidth: number;
	readonly minAlong: number;
	readonly maxAlong: number;
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

interface RailRun {
	readonly id: number;
	readonly axis: "X" | "Z";
	readonly tangentX: number;
	readonly tangentZ: number;
}

const EMPTY_RAIL_RUNS: ReadonlyMap<string, RailRun> = new Map();
const EMPTY_STK_BODY_SWEEPS: readonly StkBodySweep[] = Object.freeze([]);
const EMPTY_SWEEP_INTERVALS_BY_RUN: ReadonlyMap<number, SweepRunIntervalIndex> = new Map();
const EMPTY_EXISTING_PORT_STATIONS_BY_RUN: ReadonlyMap<number, readonly ExistingPortStation[]> =
	new Map();
const RAIL_RUNS_BY_LAYOUT = new WeakMap<CompiledPhysicalLayout, ReadonlyMap<string, RailRun>>();

interface MutableSweepExtent {
	readonly equipmentGroupId: number;
	readonly run: RailRun;
	minAlong: number;
	maxAlong: number;
	cross: number;
}

interface ExistingPortStation {
	readonly equipmentGroupId: number;
	readonly runId: number;
	readonly along: number;
}

interface SweepRunIntervalIndex {
	readonly sweepsByMinimum: readonly StkBodySweep[];
	readonly maximumTree: Float64Array;
	readonly leafBase: number;
}

/**
 * Revision-local STK occupancy. Authored ports remain the source of truth; sweeps are derived and
 * may be rebuilt by Canvas, WebGL, validation, or a worker without introducing a second map model.
 */
export class StkBodySweepIndex {
	readonly revision: number;
	readonly sweeps: readonly StkBodySweep[];
	private readonly runByRouteKey: ReadonlyMap<string, RailRun>;
	private readonly equipmentGroupByPortId: ReadonlyMap<number, number>;
	private readonly sweepIntervalsByRun: ReadonlyMap<number, SweepRunIntervalIndex>;
	private readonly existingPortStationsByRun: ReadonlyMap<number, readonly ExistingPortStation[]>;

	constructor(
		layout: CompiledPhysicalLayout,
		state: PortEquipmentState,
		includeExistingPortStations = true,
	) {
		this.revision = layout.revision;
		const stkGroups = state.equipmentGroups.filter((group) => group.kind === "STK");
		if (stkGroups.length === 0 && !includeExistingPortStations) {
			this.equipmentGroupByPortId = new Map();
			this.runByRouteKey = EMPTY_RAIL_RUNS;
			this.sweepIntervalsByRun = EMPTY_SWEEP_INTERVALS_BY_RUN;
			this.existingPortStationsByRun = EMPTY_EXISTING_PORT_STATIONS_BY_RUN;
			this.sweeps = EMPTY_STK_BODY_SWEEPS;
			return;
		}
		const stkGroupIds = new Set(stkGroups.map((group) => group.id));
		this.equipmentGroupByPortId = new Map(
			state.ports
				.filter((port) => stkGroupIds.has(port.equipmentGroupId))
				.map((port) => [port.id, port.equipmentGroupId] as const),
		);
		if (stkGroups.length === 0 && (!includeExistingPortStations || state.ports.length === 0)) {
			this.runByRouteKey = EMPTY_RAIL_RUNS;
			this.sweepIntervalsByRun = EMPTY_SWEEP_INTERVALS_BY_RUN;
			this.existingPortStationsByRun = EMPTY_EXISTING_PORT_STATIONS_BY_RUN;
			this.sweeps = EMPTY_STK_BODY_SWEEPS;
			return;
		}
		this.runByRouteKey = railRunsForLayout(layout);
		this.existingPortStationsByRun = includeExistingPortStations
			? indexExistingPortStationsByRun(this.runByRouteKey, state.ports)
			: EMPTY_EXISTING_PORT_STATIONS_BY_RUN;
		const portsById = new Map(state.ports.map((port) => [port.id, port] as const));
		const sweeps: StkBodySweep[] = [];
		for (const group of stkGroups) {
			const ports = group.portIds.map((portId) => {
				const port = portsById.get(portId);
				if (!port) throw new Error(`STK group ${group.id} references missing port ${portId}.`);
				return port;
			});
			sweeps.push(...this.compileSweeps(group.id, ports));
		}
		this.sweeps = Object.freeze(
			sweeps.sort(
				(left, right) =>
					left.equipmentGroupId - right.equipmentGroupId ||
					left.runId - right.runId ||
					left.minAlong - right.minAlong,
			),
		);
		this.sweepIntervalsByRun = indexSweepsByRun(this.sweeps);
	}

	conflictingGroupForPort(port: StkBodySweepPort, ignoredEquipmentGroupId = 0): number {
		const run = this.runByRouteKey.get(portRouteIdentityKey(port.route));
		if (!run) return 0;
		const along = portAlongPosition(port, run.axis);
		return conflictingSweepGroup(
			this.sweepIntervalsByRun.get(run.id),
			along,
			along,
			ignoredEquipmentGroupId,
		);
	}

	conflictingGroupForSpan(ports: readonly StkBodySweepPort[], ignoredEquipmentGroupId = 0): number {
		for (const candidate of this.compileSweeps(0, ports)) {
			const sweepConflict = conflictingSweepGroup(
				this.sweepIntervalsByRun.get(candidate.runId),
				candidate.minAlong,
				candidate.maxAlong,
				ignoredEquipmentGroupId,
			);
			if (sweepConflict !== 0) return sweepConflict;
			const stationConflict = conflictingExistingPortGroup(
				this.existingPortStationsByRun.get(candidate.runId),
				candidate.minAlong,
				candidate.maxAlong,
				ignoredEquipmentGroupId,
			);
			if (stationConflict !== 0) return stationConflict;
		}
		return 0;
	}

	equipmentGroupForPort(portId: number): number {
		return this.equipmentGroupByPortId.get(portId) ?? 0;
	}

	/** Exact connected straight-run identity used by renderer-neutral STK derivatives. */
	runIdForPort(port: StkBodySweepPort): number | null {
		return this.runByRouteKey.get(portRouteIdentityKey(port.route))?.id ?? null;
	}

	private compileSweeps(
		equipmentGroupId: number,
		ports: readonly (PortRecord | StkBodySweepPort)[],
	): StkBodySweep[] {
		const extents = new Map<number, MutableSweepExtent>();
		for (const port of ports) {
			if (port.route.kind !== "CARDINAL_CELL") continue;
			const run = this.runByRouteKey.get(portRouteIdentityKey(port.route));
			if (!run) continue;
			const sweepPort: StkBodySweepPort = {
				route: port.route,
				stationMillimeters: port.stationMillimeters,
			};
			const along = portAlongPosition(sweepPort, run.axis);
			const cross = portCrossPosition(sweepPort, run.axis);
			const existing = extents.get(run.id);
			if (existing) {
				existing.minAlong = Math.min(existing.minAlong, along);
				existing.maxAlong = Math.max(existing.maxAlong, along);
			} else {
				extents.set(run.id, {
					equipmentGroupId,
					run,
					minAlong: along,
					maxAlong: along,
					cross,
				});
			}
		}
		return [...extents.values()].map(freezeSweep);
	}
}

function indexSweepsByRun(
	sweeps: readonly StkBodySweep[],
): ReadonlyMap<number, SweepRunIntervalIndex> {
	if (sweeps.length === 0) return EMPTY_SWEEP_INTERVALS_BY_RUN;
	const mutableByRun = new Map<number, StkBodySweep[]>();
	for (const sweep of sweeps) {
		const existing = mutableByRun.get(sweep.runId);
		if (existing) existing.push(sweep);
		else mutableByRun.set(sweep.runId, [sweep]);
	}
	const indexedByRun = new Map<number, SweepRunIntervalIndex>();
	for (const [runId, runSweeps] of mutableByRun) {
		runSweeps.sort(
			(left, right) =>
				left.minAlong - right.minAlong ||
				left.maxAlong - right.maxAlong ||
				left.equipmentGroupId - right.equipmentGroupId,
		);
		let leafBase = 1;
		while (leafBase < runSweeps.length) leafBase *= 2;
		const maximumTree = new Float64Array(leafBase * 2);
		maximumTree.fill(Number.NEGATIVE_INFINITY);
		for (let index = 0; index < runSweeps.length; index++) {
			maximumTree[leafBase + index] = (runSweeps[index] as StkBodySweep).maxAlong;
		}
		for (let node = leafBase - 1; node > 0; node--) {
			maximumTree[node] = Math.max(
				maximumTree[node * 2] as number,
				maximumTree[node * 2 + 1] as number,
			);
		}
		indexedByRun.set(
			runId,
			Object.freeze({
				sweepsByMinimum: Object.freeze(runSweeps),
				maximumTree,
				leafBase,
			}),
		);
	}
	return indexedByRun;
}

function conflictingSweepGroup(
	index: SweepRunIntervalIndex | undefined,
	minimumAlong: number,
	maximumAlong: number,
	ignoredEquipmentGroupId: number,
): number {
	if (!index) return 0;
	const queryMinimum = minimumAlong - SWEEP_OVERLAP_EPSILON_METERS;
	const queryMaximum = maximumAlong + SWEEP_OVERLAP_EPSILON_METERS;
	const searchEnd = upperBoundSweepMinimum(index.sweepsByMinimum, queryMaximum);
	return minimumConflictingSweepGroup(
		index,
		1,
		0,
		index.leafBase,
		searchEnd,
		queryMinimum,
		ignoredEquipmentGroupId,
		0,
	);
}

function minimumConflictingSweepGroup(
	index: SweepRunIntervalIndex,
	node: number,
	start: number,
	end: number,
	searchEnd: number,
	queryMinimum: number,
	ignoredEquipmentGroupId: number,
	bestGroupId: number,
): number {
	if (
		start >= searchEnd ||
		(index.maximumTree[node] as number) < queryMinimum ||
		bestGroupId === 1
	) {
		return bestGroupId;
	}
	if (end - start === 1) {
		const sweep = index.sweepsByMinimum[start];
		if (
			sweep === undefined ||
			sweep.maxAlong < queryMinimum ||
			sweep.equipmentGroupId === ignoredEquipmentGroupId
		) {
			return bestGroupId;
		}
		return bestGroupId === 0
			? sweep.equipmentGroupId
			: Math.min(bestGroupId, sweep.equipmentGroupId);
	}
	const middle = start + (end - start) / 2;
	const leftBest = minimumConflictingSweepGroup(
		index,
		node * 2,
		start,
		middle,
		searchEnd,
		queryMinimum,
		ignoredEquipmentGroupId,
		bestGroupId,
	);
	return minimumConflictingSweepGroup(
		index,
		node * 2 + 1,
		middle,
		end,
		searchEnd,
		queryMinimum,
		ignoredEquipmentGroupId,
		leftBest,
	);
}

function upperBoundSweepMinimum(sweeps: readonly StkBodySweep[], value: number): number {
	let low = 0;
	let high = sweeps.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if ((sweeps[middle] as StkBodySweep).minAlong <= value) low = middle + 1;
		else high = middle;
	}
	return low;
}

function indexExistingPortStationsByRun(
	runByRouteKey: ReadonlyMap<string, RailRun>,
	ports: readonly PortRecord[],
): ReadonlyMap<number, readonly ExistingPortStation[]> {
	const mutableByRun = new Map<number, ExistingPortStation[]>();
	for (const port of ports) {
		if (port.route.kind !== "CARDINAL_CELL") continue;
		const run = runByRouteKey.get(portRouteIdentityKey(port.route));
		if (!run) continue;
		const station = Object.freeze({
			equipmentGroupId: port.equipmentGroupId,
			runId: run.id,
			along: portAlongPosition(
				{ route: port.route, stationMillimeters: port.stationMillimeters },
				run.axis,
			),
		});
		const existing = mutableByRun.get(run.id);
		if (existing) existing.push(station);
		else mutableByRun.set(run.id, [station]);
	}
	if (mutableByRun.size === 0) return EMPTY_EXISTING_PORT_STATIONS_BY_RUN;
	const indexedByRun = new Map<number, readonly ExistingPortStation[]>();
	for (const [runId, stations] of mutableByRun) {
		stations.sort(
			(left, right) => left.along - right.along || left.equipmentGroupId - right.equipmentGroupId,
		);
		indexedByRun.set(runId, Object.freeze(stations));
	}
	return indexedByRun;
}

function conflictingExistingPortGroup(
	stations: readonly ExistingPortStation[] | undefined,
	minimumAlong: number,
	maximumAlong: number,
	ignoredEquipmentGroupId: number,
): number {
	if (!stations) return 0;
	const queryMinimum = minimumAlong - SWEEP_OVERLAP_EPSILON_METERS;
	const queryMaximum = maximumAlong + SWEEP_OVERLAP_EPSILON_METERS;
	let row = lowerBoundExistingPortStation(stations, queryMinimum);
	let bestGroupId = 0;
	while (row < stations.length) {
		const station = stations[row] as ExistingPortStation;
		if (station.along > queryMaximum) break;
		if (station.equipmentGroupId !== ignoredEquipmentGroupId) {
			bestGroupId =
				bestGroupId === 0
					? station.equipmentGroupId
					: Math.min(bestGroupId, station.equipmentGroupId);
			if (bestGroupId === 1) break;
		}
		row++;
	}
	return bestGroupId;
}

function lowerBoundExistingPortStation(
	stations: readonly ExistingPortStation[],
	value: number,
): number {
	let low = 0;
	let high = stations.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if ((stations[middle] as ExistingPortStation).along < value) low = middle + 1;
		else high = middle;
	}
	return low;
}

function railRunsForLayout(layout: CompiledPhysicalLayout): ReadonlyMap<string, RailRun> {
	const cached = RAIL_RUNS_BY_LAYOUT.get(layout);
	if (cached) return cached;
	const compiled = compileRailRuns(layout.pathIntervalRemap);
	RAIL_RUNS_BY_LAYOUT.set(layout, compiled);
	return compiled;
}

function freezeSweep(extent: MutableSweepExtent): StkBodySweep {
	const centerAlong = (extent.minAlong + extent.maxAlong) * 0.5;
	const halfLength = (extent.maxAlong - extent.minAlong) * 0.5 + STK_BODY_END_MARGIN_METERS;
	const centerX = extent.run.axis === "X" ? centerAlong : extent.cross;
	const centerZ = extent.run.axis === "Z" ? centerAlong : extent.cross;
	const extentX = extent.run.axis === "X" ? halfLength : STK_BODY_HALF_WIDTH_METERS;
	const extentZ = extent.run.axis === "Z" ? halfLength : STK_BODY_HALF_WIDTH_METERS;
	return Object.freeze({
		equipmentGroupId: extent.equipmentGroupId,
		runId: extent.run.id,
		centerX,
		centerZ,
		tangentX: extent.run.tangentX,
		tangentZ: extent.run.tangentZ,
		halfLength,
		halfWidth: STK_BODY_HALF_WIDTH_METERS,
		minAlong: extent.minAlong,
		maxAlong: extent.maxAlong,
		minX: centerX - extentX,
		minZ: centerZ - extentZ,
		maxX: centerX + extentX,
		maxZ: centerZ + extentZ,
	});
}

function compileRailRuns(remap: CompiledPathIntervalRemap): ReadonlyMap<string, RailRun> {
	const routeRows: CardinalPortRoute[] = [];
	const rowByRouteKey = new Map<string, number>();
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		if (!isStraightCardinalSource(remap, sourcePathIndex)) continue;
		const route: CardinalPortRoute = {
			kind: "CARDINAL_CELL",
			x: remap.sourcePathCells[sourcePathIndex * 2] as number,
			z: remap.sourcePathCells[sourcePathIndex * 2 + 1] as number,
			from: remap.sourcePathFromDirections[sourcePathIndex] as Direction,
			to: remap.sourcePathToDirections[sourcePathIndex] as Direction,
		};
		const key = portRouteIdentityKey(route);
		if (rowByRouteKey.has(key)) continue;
		rowByRouteKey.set(key, routeRows.length);
		routeRows.push(route);
	}
	const parents = Int32Array.from({ length: routeRows.length }, (_, index) => index);
	for (let row = 0; row < routeRows.length; row++) {
		const route = routeRows[row] as CardinalPortRoute;
		const nextCell = moveCell({ x: route.x, y: route.z }, route.to as Direction);
		const nextRow = rowByRouteKey.get(
			portRouteIdentityKey({ ...route, x: nextCell.x, z: nextCell.y }),
		);
		if (nextRow !== undefined) union(parents, row, nextRow);
	}
	const runIdByRoot = new Map<number, number>();
	const runByRouteKey = new Map<string, RailRun>();
	for (let row = 0; row < routeRows.length; row++) {
		const route = routeRows[row] as CardinalPortRoute;
		const root = find(parents, row);
		let runId = runIdByRoot.get(root);
		if (runId === undefined) {
			runId = runIdByRoot.size;
			runIdByRoot.set(root, runId);
		}
		const tangent = moveCell({ x: 0, y: 0 }, route.to as Direction);
		runByRouteKey.set(
			portRouteIdentityKey(route),
			Object.freeze({
				id: runId,
				axis: tangent.x === 0 ? "Z" : "X",
				tangentX: tangent.x,
				tangentZ: tangent.y,
			}),
		);
	}
	return runByRouteKey;
}

function isStraightCardinalSource(remap: CompiledPathIntervalRemap, index: number): boolean {
	const from = remap.sourcePathFromDirections[index] as Direction | 0;
	const to = remap.sourcePathToDirections[index] as Direction | 0;
	return (
		(remap.sourceIdentityKinds[index] as number) === PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL &&
		(remap.sourcePathKinds[index] as number) === PATH_KIND.LINEAR &&
		from !== 0 &&
		to !== 0 &&
		to === oppositeDirection(from)
	);
}

function portAlongPosition(port: StkBodySweepPort, axis: "X" | "Z"): number {
	const world = portRailPosition(port);
	return axis === "X" ? world.x : world.z;
}

function portCrossPosition(port: StkBodySweepPort, axis: "X" | "Z"): number {
	const world = portRailPosition(port);
	return axis === "X" ? world.z : world.x;
}

function portRailPosition(port: StkBodySweepPort): { readonly x: number; readonly z: number } {
	const travel = moveCell({ x: 0, y: 0 }, port.route.to as Direction);
	const stationOffset = port.stationMillimeters / 1_000 - 0.5;
	return {
		x: port.route.x + 0.5 + travel.x * stationOffset,
		z: port.route.z + 0.5 + travel.y * stationOffset,
	};
}

function find(parents: Int32Array, row: number): number {
	let root = row;
	while ((parents[root] as number) !== root) root = parents[root] as number;
	while ((parents[row] as number) !== row) {
		const next = parents[row] as number;
		parents[row] = root;
		row = next;
	}
	return root;
}

function union(parents: Int32Array, left: number, right: number): void {
	const leftRoot = find(parents, left);
	const rightRoot = find(parents, right);
	if (leftRoot === rightRoot) return;
	parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}
