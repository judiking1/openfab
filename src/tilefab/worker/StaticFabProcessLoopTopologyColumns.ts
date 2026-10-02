import { ADVANCED_SWITCH_MAX_ID, validateAdvancedSwitchTopology } from "../core/AdvancedSwitch";
import { type CooperativeTask, createCooperativeTask } from "../core/CooperativeTask";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isSupportedRailCoordinate } from "../core/RailCoordinateDomain";
import { directionBetween, oppositeDirection } from "../core/railShape";
import {
	compareDirectedRailEdges,
	STATIC_FAB_ORGANIZATION_MAX_MEMBERSHIP_REFERENCES,
} from "../core/StaticFabOrganization";
import {
	type StaticFabProcessLoopRailCandidate,
	type StaticFabProcessLoopRailCandidateSource,
	staticFabProcessLoopRailCandidateMatchesSource,
} from "../core/StaticFabProcessLoopRailCandidate";
import { cellKey, TileMap } from "../core/TileMap";
import {
	type AdvancedSwitchRecordFieldsSoA,
	createAdvancedSwitchRecordFields,
	readAdvancedSwitchRecord,
	validateAdvancedSwitchRecordFieldLengths,
	writeAdvancedSwitchRecord,
} from "./AdvancedSwitchSoA";

export const STATIC_FAB_PROCESS_LOOP_TOPOLOGY_COLUMNS_VERSION = 1 as const;

/** Owned selected-union columns only. This is neither a project snapshot nor mutation authority. */
export interface StaticFabProcessLoopTopologyColumns {
	readonly version: typeof STATIC_FAB_PROCESS_LOOP_TOPOLOGY_COLUMNS_VERSION;
	readonly revision: number;
	readonly patchSequence: number;
	readonly nextAdvancedSwitchId: number;
	readonly edgeCells: Int32Array;
	readonly switchIds: Int32Array;
	readonly switchRecords: AdvancedSwitchRecordFieldsSoA;
}

export interface PackedStaticFabProcessLoopTopology {
	readonly columns: StaticFabProcessLoopTopologyColumns;
	readonly fingerprint: string;
}

export interface StaticFabProcessLoopTopologyPacking
	extends CooperativeTask<PackedStaticFabProcessLoopTopology> {
	cancel(): void;
}

/** Main-thread packing/hash work yields per reference; no full map or organization traversal. */
export function createStaticFabProcessLoopTopologyPacking(
	source: StaticFabProcessLoopRailCandidateSource,
	candidate: StaticFabProcessLoopRailCandidate,
	isCurrent: () => boolean,
): StaticFabProcessLoopTopologyPacking {
	let failure: Error | null = null;
	const steps = packSteps(source, candidate);
	let task: CooperativeTask<PackedStaticFabProcessLoopTopology> | null =
		createCooperativeTask(steps);
	const discard = (message: string): void => {
		if (failure) return;
		failure = new Error(message);
		task = null;
		steps.return(undefined as never);
	};
	const guard = (): void => {
		if (failure) return;
		if (!isCurrent() || !staticFabProcessLoopRailCandidateMatchesSource(candidate, source))
			discard("Process Loop topology packing source is no longer current.");
	};
	return {
		get done() {
			guard();
			return failure !== null || task === null || task.done;
		},
		step(operationBudget = 128) {
			if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0)
				throw new Error("Process Loop packing budget must be a positive safe integer.");
			guard();
			if (failure) throw failure;
			if (!task) throw new Error("Process Loop packing was discarded.");
			const operations = task.step(operationBudget);
			guard();
			if (failure) throw failure;
			return operations;
		},
		finish() {
			guard();
			if (failure) throw failure;
			if (!task) throw new Error("Process Loop packing was discarded.");
			return task.finish();
		},
		cancel() {
			discard("Process Loop topology packing was cancelled.");
		},
	};
}

function* packSteps(
	source: StaticFabProcessLoopRailCandidateSource,
	candidate: StaticFabProcessLoopRailCandidate,
): Generator<void, PackedStaticFabProcessLoopTopology> {
	const membership = candidate.topologyMembership;
	if (
		membership.railEdges.length + membership.advancedSwitchIds.length >
		STATIC_FAB_ORGANIZATION_MAX_MEMBERSHIP_REFERENCES
	)
		throw new Error("Process Loop topology candidate exceeds reference bounds.");
	yield;
	const edgeCells = new Int32Array(membership.railEdges.length * 4);
	for (let row = 0; row < membership.railEdges.length; row++) {
		const edge = membership.railEdges[row];
		if (!edge) throw new Error("Process Loop candidate is missing an edge.");
		edgeCells[row * 4] = edge.from.x;
		edgeCells[row * 4 + 1] = edge.from.y;
		edgeCells[row * 4 + 2] = edge.to.x;
		edgeCells[row * 4 + 3] = edge.to.y;
		yield;
	}
	const switchIds = new Int32Array(membership.advancedSwitchIds.length);
	const switchRecords = createAdvancedSwitchRecordFields(switchIds.length);
	for (let row = 0; row < switchIds.length; row++) {
		const id = membership.advancedSwitchIds[row] as number;
		const record = source.map.getAdvancedSwitch(id);
		if (!record) throw new Error("Process Loop candidate switch is missing.");
		switchIds[row] = id;
		writeAdvancedSwitchRecord(switchRecords, row, record);
		yield;
	}
	const columns: StaticFabProcessLoopTopologyColumns = Object.freeze({
		version: STATIC_FAB_PROCESS_LOOP_TOPOLOGY_COLUMNS_VERSION,
		revision: candidate.baseRevision,
		patchSequence: candidate.basePatchSequence,
		nextAdvancedSwitchId: source.map.getAdvancedSwitchIdCursor(),
		edgeCells,
		switchIds,
		switchRecords: Object.freeze(switchRecords),
	});
	const fingerprint = yield* staticFabProcessLoopTopologyFingerprintSteps(columns);
	return Object.freeze({ columns, fingerprint });
}

/** Same scalar/column contract in the main packer and isolated Worker; independent of JSON order. */
export function* staticFabProcessLoopTopologyFingerprintSteps(
	columns: StaticFabProcessLoopTopologyColumns,
): Generator<void, string> {
	assertStaticFabProcessLoopTopologyColumns(columns);
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		columns.version,
		columns.revision,
		columns.patchSequence,
		columns.nextAdvancedSwitchId,
	]);
	for (const column of topologyColumns(columns))
		yield* checksum.addNumberSequenceSteps(column.length, (index) => column[index] as number);
	return checksum.digest();
}

/** This synchronous hydration is isolated Worker work, never a main-thread scheduling step. */
export function hydrateStaticFabProcessLoopTopologyColumns(
	columns: StaticFabProcessLoopTopologyColumns,
): TileMap {
	assertStaticFabProcessLoopTopologyColumns(columns);
	const cells = new Map<string, { x: number; y: number; encoded: number }>();
	let previous: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
	const add = (x: number, y: number, encoded: number): void => {
		const key = cellKey(x, y);
		const existing = cells.get(key);
		if (existing) existing.encoded |= encoded;
		else cells.set(key, { x, y, encoded });
	};
	for (let offset = 0; offset < columns.edgeCells.length; offset += 4) {
		const edge = {
			from: { x: columns.edgeCells[offset] as number, y: columns.edgeCells[offset + 1] as number },
			to: {
				x: columns.edgeCells[offset + 2] as number,
				y: columns.edgeCells[offset + 3] as number,
			},
		};
		if (
			!isSupportedRailCoordinate(edge.from.x, edge.from.y) ||
			!isSupportedRailCoordinate(edge.to.x, edge.to.y)
		)
			throw new Error("Process Loop topology column coordinates are unsupported.");
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null || (previous && compareDirectedRailEdges(previous, edge) >= 0))
			throw new Error("Process Loop topology column edges must be adjacent, unique and canonical.");
		add(edge.from.x, edge.from.y, direction << 4);
		add(edge.to.x, edge.to.y, oppositeDirection(direction));
		previous = edge;
	}
	const hydrator = TileMap.createHydrator();
	for (const cell of cells.values()) hydrator.addEncodedCell(cell.x, cell.y, cell.encoded);
	let previousId = 0;
	for (let row = 0; row < columns.switchIds.length; row++) {
		const id = columns.switchIds[row] as number;
		if (id <= previousId || id > ADVANCED_SWITCH_MAX_ID || id >= columns.nextAdvancedSwitchId)
			throw new Error("Process Loop topology switch IDs or cursor are invalid.");
		hydrator.addAdvancedSwitch(
			readAdvancedSwitchRecord(columns.switchRecords, row, id, "Process Loop candidate"),
		);
		previousId = id;
	}
	const map = hydrator.finish(columns.revision, columns.nextAdvancedSwitchId);
	map.forEachAdvancedSwitch((record) => {
		if (validateAdvancedSwitchTopology((x, y) => map.getEncoded(x, y), record).length > 0)
			throw new Error("Process Loop topology candidate omits its switch footprint.");
	});
	return map;
}

export function staticFabProcessLoopTopologyTransfers(
	columns: StaticFabProcessLoopTopologyColumns,
): ArrayBuffer[] {
	assertStaticFabProcessLoopTopologyColumns(columns);
	return topologyColumns(columns).map((column) => column.buffer as ArrayBuffer);
}

export function assertStaticFabProcessLoopTopologyColumns(
	columns: StaticFabProcessLoopTopologyColumns,
): void {
	if (
		!columns ||
		columns.version !== STATIC_FAB_PROCESS_LOOP_TOPOLOGY_COLUMNS_VERSION ||
		!Number.isSafeInteger(columns.revision) ||
		columns.revision < 0 ||
		!Number.isSafeInteger(columns.patchSequence) ||
		columns.patchSequence < 0 ||
		!Number.isSafeInteger(columns.nextAdvancedSwitchId) ||
		columns.nextAdvancedSwitchId < 1 ||
		columns.nextAdvancedSwitchId > ADVANCED_SWITCH_MAX_ID + 1
	)
		throw new Error("Process Loop topology column header is invalid.");
	if (
		!(columns.edgeCells instanceof Int32Array) ||
		columns.edgeCells.length % 4 !== 0 ||
		!(columns.switchIds instanceof Int32Array) ||
		columns.edgeCells.length / 4 + columns.switchIds.length >
			STATIC_FAB_ORGANIZATION_MAX_MEMBERSHIP_REFERENCES
	)
		throw new Error("Process Loop topology columns exceed typed reference bounds.");
	validateAdvancedSwitchRecordFieldLengths(
		columns.switchRecords,
		columns.switchIds.length,
		"Process Loop topology",
	);
	const buffers = new Set<ArrayBuffer>();
	for (const column of topologyColumns(columns)) {
		if (
			!(column.buffer instanceof ArrayBuffer) ||
			column.byteOffset !== 0 ||
			column.byteLength !== column.buffer.byteLength ||
			buffers.has(column.buffer)
		)
			throw new Error(
				"Process Loop topology columns must have distinct whole transferable buffers.",
			);
		buffers.add(column.buffer);
	}
}

function topologyColumns(
	columns: StaticFabProcessLoopTopologyColumns,
): readonly (Int32Array | Uint8Array)[] {
	return [
		columns.edgeCells,
		columns.switchIds,
		columns.switchRecords.profileClasses,
		columns.switchRecords.origins,
		columns.switchRecords.forwardDirections,
		columns.switchRecords.lateralDirections,
		columns.switchRecords.movementMasks,
	];
}
