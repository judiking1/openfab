import { isCanonicalPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import {
	type CardinalPortRoute,
	OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
	PORT_DIRECTIONS,
	PORT_SIDES,
	PORT_TYPES,
	type PortRecord,
	type PortSide,
	type PortType,
} from "../core/PortRecord";
import { type Direction, moveCell, oppositeDirection } from "../core/railShape";
import { cellKey } from "../core/TileMap";
import { type CompiledPathIntervalRemap, PATH_SOURCE_IDENTITY_KIND } from "./CompoundPhysicalPath";
import { PATH_KIND } from "./PhysicalPathCompiler";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";
import {
	metersToMillimeters,
	type ResolvedPortAttachment,
	resolvePortAttachmentAtSourcePath,
} from "./PortAttachmentResolver";
import {
	bindPortEquipmentResolvedPositionIndex,
	compilePortEquipmentResolvedPositionCapability,
	type PortEquipmentResolvedPositionCapability,
	type PortEquipmentResolvedPositionIndex,
} from "./PortEquipmentResolvedPositions";
import {
	DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
	RailEnvelopeSpatialIndex,
	type RailEnvelopeSpatialIndexSnapshot,
} from "./RailClearanceCompiler";
import { StkBodySweepIndex } from "./StkBodySweep";

export const PORT_SLOT_STATUS = {
	LEGAL: 0,
	LAYOUT_INVALID: 1,
	UNSAFE_APPROACH: 2,
	ATTACHMENT_INVALID: 3,
	RAIL_CLEARANCE_CONFLICT: 4,
	PORT_OCCUPIED: 5,
	PORT_CLEARANCE_CONFLICT: 6,
	EQUIPMENT_BODY_CONFLICT: 7,
} as const;

export type PortSlotStatus = (typeof PORT_SLOT_STATUS)[keyof typeof PORT_SLOT_STATUS];

export interface PortSlotPolicy {
	readonly portType: PortType;
	readonly sides: readonly PortSide[];
	readonly lateralOffsetMillimeters: number;
	readonly footprintRadiusMillimeters: number;
	readonly minimumPortSpacingMillimeters: number;
}

export const OPENFAB_PORT_SLOT_POLICIES: Readonly<Record<PortType, PortSlotPolicy>> = Object.freeze(
	{
		OHB: Object.freeze({
			portType: "OHB",
			sides: Object.freeze(["LEFT", "RIGHT"] as const),
			lateralOffsetMillimeters: 700,
			footprintRadiusMillimeters: 150,
			minimumPortSpacingMillimeters: OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
		}),
		EQ: Object.freeze({
			portType: "EQ",
			sides: Object.freeze(["CENTER"] as const),
			lateralOffsetMillimeters: 0,
			footprintRadiusMillimeters: 150,
			minimumPortSpacingMillimeters: OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
		}),
		STK: Object.freeze({
			portType: "STK",
			sides: Object.freeze(["CENTER"] as const),
			lateralOffsetMillimeters: 0,
			footprintRadiusMillimeters: 180,
			minimumPortSpacingMillimeters: OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
		}),
	},
);

export interface CompiledPortSlots {
	readonly revision: number;
	readonly portType: PortType;
	readonly count: number;
	readonly legalCount: number;
	readonly sourcePathOffsets: Uint32Array;
	readonly sourcePathIndices: Uint32Array;
	readonly finalPathIndices: Uint32Array;
	readonly routeXs: Int32Array;
	readonly routeZs: Int32Array;
	readonly routeFromDirections: Uint8Array;
	readonly routeToDirections: Uint8Array;
	readonly stationMillimeters: Int32Array;
	readonly sides: Uint8Array;
	readonly lateralOffsetMillimeters: Uint16Array;
	readonly directions: Uint8Array;
	readonly portTypes: Uint8Array;
	readonly railPositions: Float32Array;
	readonly worldPositions: Float32Array;
	readonly tangents: Float32Array;
	readonly yawRadians: Float32Array;
	readonly statuses: Uint8Array;
	readonly conflictingPortIds: Int32Array;
	readonly conflictingRailPathIndices: Int32Array;
}

export interface PortSlotSpatialIndexSnapshot {
	readonly slotCount: number;
	readonly chunkSizeMeters: number;
	readonly chunkCoordinates: Int32Array;
	readonly chunkOffsets: Uint32Array;
	readonly slotIndices: Uint32Array;
}

/** Already-resolved immutable positions that can seed live occupancy without resolving ports twice. */
export interface PortSlotBounds {
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

const VALIDATED_PORT_SLOT_SPATIAL_INDEX = Object.freeze({
	kind: "validated-port-slot-spatial-index",
});
const preparedPortSlotSpatialIndexes = new WeakMap<
	CompiledPortSlots,
	{
		readonly snapshot: PortSlotSpatialIndexSnapshot;
		readonly index: PortSlotSpatialIndex;
	}
>();

export class PortSlotSpatialIndex {
	private readonly slotCount: number;
	private readonly worldPositions: Float32Array;
	private readonly chunkSizeMeters: number;
	private readonly chunkCoordinates: Int32Array;
	private readonly chunkOffsets: Uint32Array;
	private readonly slotIndices: Uint32Array;
	private readonly stamps: Uint32Array;
	private queryStamp = 0;
	readonly snapshot: PortSlotSpatialIndexSnapshot;

	constructor(
		slots: CompiledPortSlots,
		snapshot: PortSlotSpatialIndexSnapshot = compilePortSlotSpatialIndex(slots),
		validationProof?: typeof VALIDATED_PORT_SLOT_SPATIAL_INDEX,
	) {
		if (validationProof !== VALIDATED_PORT_SLOT_SPATIAL_INDEX) {
			validatePortSlotSpatialIndex(slots, snapshot);
		}
		this.slotCount = slots.count;
		this.worldPositions = slots.worldPositions.slice();
		this.chunkSizeMeters = snapshot.chunkSizeMeters;
		this.snapshot = snapshot;
		this.stamps = new Uint32Array(slots.count);
		this.chunkCoordinates = snapshot.chunkCoordinates.slice();
		this.chunkOffsets = snapshot.chunkOffsets.slice();
		this.slotIndices = snapshot.slotIndices.slice();
	}

	/** Reuse the private copy prepared during cooperative catalog activation when available. */
	static fromPreparedSnapshot(
		slots: CompiledPortSlots,
		snapshot: PortSlotSpatialIndexSnapshot,
	): PortSlotSpatialIndex {
		const prepared = preparedPortSlotSpatialIndexes.get(slots);
		return prepared?.snapshot === snapshot
			? prepared.index
			: new PortSlotSpatialIndex(slots, snapshot);
	}

	query(bounds: PortSlotBounds, target: number[] = []): number[] {
		target.length = 0;
		if (this.slotCount === 0) return target;
		this.queryStamp++;
		if (this.queryStamp === 0xffff_ffff) {
			this.stamps.fill(0);
			this.queryStamp = 1;
		}
		const size = this.chunkSizeMeters;
		for (let z = Math.floor(bounds.minZ / size); z <= Math.floor(bounds.maxZ / size); z++) {
			for (let x = Math.floor(bounds.minX / size); x <= Math.floor(bounds.maxX / size); x++) {
				const chunk = findPortSlotSpatialChunk(this.chunkCoordinates, x, z);
				if (chunk < 0) continue;
				const start = this.chunkOffsets[chunk] as number;
				const end = this.chunkOffsets[chunk + 1] as number;
				for (let index = start; index < end; index++) {
					const row = this.slotIndices[index] as number;
					if ((this.stamps[row] as number) === this.queryStamp) continue;
					this.stamps[row] = this.queryStamp;
					const worldX = this.worldPositions[row * 2] as number;
					const worldZ = this.worldPositions[row * 2 + 1] as number;
					if (
						worldX >= bounds.minX &&
						worldX <= bounds.maxX &&
						worldZ >= bounds.minZ &&
						worldZ <= bounds.maxZ
					) {
						target.push(row);
					}
				}
			}
		}
		return target;
	}

	nearest(
		worldX: number,
		worldZ: number,
		radiusMeters: number,
		target: number[] = [],
	): number | null {
		this.query(
			{
				minX: worldX - radiusMeters,
				minZ: worldZ - radiusMeters,
				maxX: worldX + radiusMeters,
				maxZ: worldZ + radiusMeters,
			},
			target,
		);
		let nearest: number | null = null;
		let nearestDistance = radiusMeters;
		for (const row of target) {
			const distance = Math.hypot(
				(this.worldPositions[row * 2] as number) - worldX,
				(this.worldPositions[row * 2 + 1] as number) - worldZ,
			);
			if (distance <= nearestDistance) {
				nearest = row;
				nearestDistance = distance;
			}
		}
		return nearest;
	}
}

/**
 * Validate and privately copy one transferred spatial index before the catalog becomes observable.
 * The renderer can then switch equipment tools without repeating an O(slot count) validation task.
 */
export async function preparePortSlotSpatialIndexCooperatively(
	slots: CompiledPortSlots,
	snapshot: PortSlotSpatialIndexSnapshot,
	checkpoint: () => Promise<void>,
): Promise<PortSlotSpatialIndex> {
	let steps = 0;
	for (const _step of portSlotSpatialIndexValidationSteps(slots, snapshot)) {
		void _step;
		steps++;
		if ((steps & 15) === 0) await checkpoint();
	}
	await checkpoint();
	const index = new PortSlotSpatialIndex(slots, snapshot, VALIDATED_PORT_SLOT_SPATIAL_INDEX);
	preparedPortSlotSpatialIndexes.set(slots, { snapshot, index });
	await checkpoint();
	return index;
}

function findPortSlotSpatialChunk(coordinates: Int32Array, x: number, z: number): number {
	let low = 0;
	let high = coordinates.length / 2 - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const offset = middle * 2;
		const middleX = coordinates[offset] as number;
		const middleZ = coordinates[offset + 1] as number;
		if (middleZ === z && middleX === x) return middle;
		if (middleZ < z || (middleZ === z && middleX < x)) low = middle + 1;
		else high = middle - 1;
	}
	return -1;
}

export interface PortSlotAvailabilityResult {
	readonly status: PortSlotStatus;
	readonly conflictingPortId: number;
	readonly conflictingEquipmentGroupId: number;
}

/** Shared deterministic rail-envelope broad phase for compile and transferred-catalog validation. */
export class PortSlotRailClearanceIndex {
	private readonly layout: CompiledPhysicalLayout;
	private readonly index: RailEnvelopeSpatialIndex;
	private readonly candidates: number[] = [];

	constructor(layout: CompiledPhysicalLayout, preparedIndex?: RailEnvelopeSpatialIndex) {
		this.layout = layout;
		this.index = preparedIndex ?? new RailEnvelopeSpatialIndex(layout.clearance.envelopes);
	}

	static async fromSnapshotCooperatively(
		layout: CompiledPhysicalLayout,
		snapshot: RailEnvelopeSpatialIndexSnapshot,
		checkpoint: () => Promise<void>,
	): Promise<PortSlotRailClearanceIndex> {
		if (snapshot.chunkSizeMeters !== DEFAULT_ENVELOPE_CHUNK_SIZE_METERS) {
			throw new Error("Prepared rail envelope spatial chunk size is not canonical.");
		}
		const index = await RailEnvelopeSpatialIndex.fromSnapshotCooperatively(
			layout.clearance.envelopes,
			snapshot,
			checkpoint,
		);
		return new PortSlotRailClearanceIndex(layout, index);
	}

	conflictingPathIndex(
		resolution: ResolvedPortAttachment,
		side: PortSide,
		footprintRadiusMillimeters: number,
	): number {
		return findRailConflict(
			this.layout,
			this.index,
			this.candidates,
			resolution,
			side,
			footprintRadiusMillimeters,
		);
	}
}

// Preserve the certified 100k-linear-path boundary plus bounded headroom for one maximum-gap
// Bay-to-Bay Connector. This remains a hard allocation ceiling rather than scaling with input size.
export const PORT_SLOT_MAX_ROWS = 204_096;
export const PORT_SLOT_SPATIAL_CHUNK_METERS = 32;
const LOCAL_OWNING_RAIL_WINDOW_METERS = 0.75;
const DISTANCE_EPSILON_METERS = 1e-6;

/** Dynamic port conflicts stay separate from the physical slot catalog. */
export class PortSlotAvailabilityIndex {
	private readonly existingPortIndex: PortEquipmentResolvedPositionIndex;
	private readonly indexedPorts: readonly PortRecord[];
	private readonly stkBodySweeps: StkBodySweepIndex;
	private readonly sourceLayout: CompiledPhysicalLayout;
	private readonly sourceState: PortEquipmentState;
	readonly revision: number;
	readonly portType: PortType;
	readonly portCount: number;

	constructor(
		layout: CompiledPhysicalLayout,
		state: PortEquipmentState,
		portType: PortType = "OHB",
		resolvedPositions?: PortEquipmentResolvedPositionCapability,
	) {
		this.sourceLayout = layout;
		this.revision = layout.revision;
		this.portType = portType;
		this.sourceState = state;
		this.portCount = state.ports.length;
		this.indexedPorts = isCanonicalPortEquipmentState(state) ? state.ports : state.ports.slice();
		this.existingPortIndex = bindPortEquipmentResolvedPositionIndex(
			resolvedPositions ?? compilePortEquipmentResolvedPositionCapability(layout, state),
			layout,
			state,
		);
		this.stkBodySweeps = new StkBodySweepIndex(layout, state, portType === "STK");
	}

	matchesState(state: PortEquipmentState): boolean {
		return this.sourceState === state;
	}

	matchesLayout(layout: CompiledPhysicalLayout): boolean {
		return this.sourceLayout === layout;
	}

	/**
	 * Skip definitely occupied physical candidates without allocating a route/result per row.
	 * A returned row is only a possibility: clearance, body exclusion, and prepared-slot proof
	 * still belong to statusFor/the final selector. A bucket-boundary miss is also only a possibility.
	 */
	nextPotentiallyAvailableRowForAdvisoryDiscovery(
		slots: CompiledPortSlots,
		startRow: number,
	): number {
		if (slots.revision !== this.revision || slots.portType !== this.portType) {
			throw new Error("Port slot availability is stale for the compiled slot catalog.");
		}
		if (!Number.isInteger(startRow) || startRow < 0 || startRow > slots.count) {
			throw new RangeError(`Port slot row ${startRow} is outside the compiled slot buffer.`);
		}
		const index = this.existingPortIndex;
		const ports = this.indexedPorts;
		for (let row = startRow; row < slots.count; row++) {
			if (slots.statuses[row] !== PORT_SLOT_STATUS.LEGAL) continue;
			const bucketX = Math.floor(slots.worldPositions[row * 2] as number);
			const bucketZ = Math.floor(slots.worldPositions[row * 2 + 1] as number);
			let occupied = false;
			for (
				let existing = index.firstRow(bucketX, bucketZ);
				existing >= 0;
				existing = index.nextRow(existing)
			) {
				if (
					sameCardinalSlot(
						ports[existing] as PortRecord,
						slots.routeXs[row] as number,
						slots.routeZs[row] as number,
						slots.routeFromDirections[row] as Direction,
						slots.routeToDirections[row] as Direction,
						slots.stationMillimeters[row] as number,
						PORT_SIDES[slots.sides[row] as number] as PortSide,
					)
				) {
					occupied = true;
					break;
				}
			}
			if (!occupied) return row;
		}
		return -1;
	}

	statusFor(
		slots: CompiledPortSlots,
		row: number,
		ignoredPortId = 0,
		ignoredEquipmentGroupId = 0,
	): PortSlotAvailabilityResult {
		return this.statusForAdvisoryDiscovery(slots, row, ignoredPortId, ignoredEquipmentGroupId);
	}

	/**
	 * Fast dynamic-only probe for optional UI discovery. A prepared subclass deliberately bypasses
	 * its per-row tamper proof here; any candidate must still pass statusFor through the canonical
	 * selector before the UI may advertise it as actionable.
	 */
	statusForAdvisoryDiscovery(
		slots: CompiledPortSlots,
		row: number,
		ignoredPortId = 0,
		ignoredEquipmentGroupId = 0,
	): PortSlotAvailabilityResult {
		if (slots.revision !== this.revision || slots.portType !== this.portType) {
			throw new Error("Port slot availability is stale for the compiled slot catalog.");
		}
		if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
			throw new RangeError(`Port slot row ${row} is outside the compiled slot buffer.`);
		}
		const baseStatus = slots.statuses[row] as PortSlotStatus;
		if (baseStatus !== PORT_SLOT_STATUS.LEGAL) {
			return {
				status: baseStatus,
				conflictingPortId: slots.conflictingPortIds[row] as number,
				conflictingEquipmentGroupId: 0,
			};
		}
		const route: CardinalPortRoute = {
			kind: "CARDINAL_CELL",
			x: slots.routeXs[row] as number,
			z: slots.routeZs[row] as number,
			from: slots.routeFromDirections[row] as Direction,
			to: slots.routeToDirections[row] as Direction,
		};
		const conflict = findPortConflict(
			this.existingPortIndex,
			this.indexedPorts,
			route,
			slots.stationMillimeters[row] as number,
			PORT_SIDES[slots.sides[row] as number] as PortSide,
			slots.worldPositions[row * 2] as number,
			slots.worldPositions[row * 2 + 1] as number,
			OPENFAB_PORT_SLOT_POLICIES[this.portType].minimumPortSpacingMillimeters,
			ignoredPortId,
			ignoredEquipmentGroupId,
		);
		if (conflict) {
			return {
				status: conflict.occupied
					? PORT_SLOT_STATUS.PORT_OCCUPIED
					: PORT_SLOT_STATUS.PORT_CLEARANCE_CONFLICT,
				conflictingPortId: conflict.port.id,
				conflictingEquipmentGroupId: this.stkBodySweeps.equipmentGroupForPort(conflict.port.id),
			};
		}
		const bodyExclusion =
			ignoredEquipmentGroupId !== 0
				? ignoredEquipmentGroupId
				: ignoredPortId === 0
					? 0
					: this.stkBodySweeps.equipmentGroupForPort(ignoredPortId);
		const conflictingEquipmentGroupId = this.stkBodySweeps.conflictingGroupForPort(
			{ route, stationMillimeters: slots.stationMillimeters[row] as number },
			bodyExclusion,
		);
		if (conflictingEquipmentGroupId !== 0) {
			return {
				status: PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT,
				conflictingPortId: 0,
				conflictingEquipmentGroupId,
			};
		}
		return {
			status: PORT_SLOT_STATUS.LEGAL,
			conflictingPortId: 0,
			conflictingEquipmentGroupId: 0,
		};
	}

	statusForEquipmentGroup(
		slots: CompiledPortSlots,
		row: number,
		ignoredEquipmentGroupId: number,
	): PortSlotAvailabilityResult {
		if (!Number.isInteger(ignoredEquipmentGroupId) || ignoredEquipmentGroupId <= 0) {
			throw new RangeError("Ignored equipment group ID must be a positive integer.");
		}
		return this.statusFor(slots, row, 0, ignoredEquipmentGroupId);
	}

	/** Reject a new sparse STK group whose derived run interval crosses an existing STK body. */
	conflictingEquipmentGroupForStkRows(
		slots: CompiledPortSlots,
		rows: readonly number[],
		ignoredEquipmentGroupId = 0,
	): number {
		if (slots.revision !== this.revision || slots.portType !== "STK" || this.portType !== "STK") {
			throw new Error("STK body availability is stale for the compiled slot catalog.");
		}
		return this.stkBodySweeps.conflictingGroupForSpan(
			rows.map((row) => {
				if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
					throw new RangeError(`Port slot row ${row} is outside the compiled slot buffer.`);
				}
				return {
					route: {
						kind: "CARDINAL_CELL" as const,
						x: slots.routeXs[row] as number,
						z: slots.routeZs[row] as number,
						from: slots.routeFromDirections[row] as Direction,
						to: slots.routeToDirections[row] as Direction,
					},
					stationMillimeters: slots.stationMillimeters[row] as number,
				};
			}),
			ignoredEquipmentGroupId,
		);
	}
}

/**
 * Compile deterministic rail-relative station candidates. The output is revision-scoped derived
 * data; authored records copy only raw route identity and integer-mm station fields from a row.
 */
export function compilePortSlots(
	layout: CompiledPhysicalLayout,
	portEquipment: PortEquipmentState,
	portType: PortType = "OHB",
): CompiledPortSlots {
	const base = compileBasePortSlots(layout, portType);
	if (portEquipment.ports.length === 0) return base;
	const availability = new PortSlotAvailabilityIndex(layout, portEquipment, portType);
	const statuses = base.statuses.slice();
	const conflictingPortIds = base.conflictingPortIds.slice();
	let legalCount = 0;
	for (let row = 0; row < base.count; row++) {
		const result = availability.statusFor(base, row);
		statuses[row] = result.status;
		conflictingPortIds[row] = result.conflictingPortId;
		if (result.status === PORT_SLOT_STATUS.LEGAL) legalCount++;
	}
	return Object.freeze({ ...base, legalCount, statuses, conflictingPortIds });
}

/** Compile the immutable physical slot catalog once; current port occupancy is queried separately. */
export function compileBasePortSlots(
	layout: CompiledPhysicalLayout,
	portType: PortType = "OHB",
): CompiledPortSlots {
	const policy = OPENFAB_PORT_SLOT_POLICIES[portType];
	const remap = layout.pathIntervalRemap;
	const exclusionMask = compilePortSlotExclusionMask(layout);
	let linearSourceCount = 0;
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		if (isCardinalLinearSource(remap, sourcePathIndex)) linearSourceCount++;
	}
	const count = linearSourceCount * policy.sides.length;
	if (count > PORT_SLOT_MAX_ROWS) {
		throw new Error(
			`Port slot budget exceeded: ${count} rows is greater than ${PORT_SLOT_MAX_ROWS}.`,
		);
	}

	const sourcePathOffsets = new Uint32Array(remap.sourcePathCount + 1);
	const sourcePathIndices = new Uint32Array(count);
	const finalPathIndices = new Uint32Array(count);
	const routeXs = new Int32Array(count);
	const routeZs = new Int32Array(count);
	const routeFromDirections = new Uint8Array(count);
	const routeToDirections = new Uint8Array(count);
	const stationMillimeters = new Int32Array(count);
	const sides = new Uint8Array(count);
	const lateralOffsetMillimeters = new Uint16Array(count);
	const directions = new Uint8Array(count);
	const portTypes = new Uint8Array(count);
	const railPositions = new Float32Array(count * 2);
	const worldPositions = new Float32Array(count * 2);
	const tangents = new Float32Array(count * 2);
	const yawRadians = new Float32Array(count);
	const statuses = new Uint8Array(count);
	const conflictingPortIds = new Int32Array(count);
	const conflictingRailPathIndices = new Int32Array(count).fill(-1);
	const railClearance = new PortSlotRailClearanceIndex(layout);
	let writeIndex = 0;
	let legalCount = 0;

	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		sourcePathOffsets[sourcePathIndex] = writeIndex;
		if (!isCardinalLinearSource(remap, sourcePathIndex)) continue;
		const route = readCardinalRoute(remap, sourcePathIndex);
		const station = sourceMidpointMillimeters(remap, sourcePathIndex);
		for (const side of policy.sides) {
			const candidate = {
				route,
				stationMillimeters: station,
				side,
				lateralOffsetMillimeters: side === "CENTER" ? 0 : policy.lateralOffsetMillimeters,
				direction: "WITH_TRAVEL" as const,
			};
			const resolution = resolvePortAttachmentAtSourcePath(layout, candidate, sourcePathIndex);
			sourcePathIndices[writeIndex] = sourcePathIndex;
			routeXs[writeIndex] = route.x;
			routeZs[writeIndex] = route.z;
			routeFromDirections[writeIndex] = route.from;
			routeToDirections[writeIndex] = route.to;
			stationMillimeters[writeIndex] = station;
			sides[writeIndex] = PORT_SIDES.indexOf(side);
			lateralOffsetMillimeters[writeIndex] = candidate.lateralOffsetMillimeters;
			directions[writeIndex] = PORT_DIRECTIONS.indexOf(candidate.direction);
			portTypes[writeIndex] = PORT_TYPES.indexOf(portType);

			let status: PortSlotStatus = PORT_SLOT_STATUS.LEGAL;
			if (!layout.valid) status = PORT_SLOT_STATUS.LAYOUT_INVALID;
			else if ((exclusionMask[sourcePathIndex] as number) !== 0) {
				status = PORT_SLOT_STATUS.UNSAFE_APPROACH;
			} else if (!resolution.ok) status = PORT_SLOT_STATUS.ATTACHMENT_INVALID;
			if (resolution.ok) {
				finalPathIndices[writeIndex] = resolution.finalPathIndex;
				writeResolution(
					writeIndex,
					resolution,
					railPositions,
					worldPositions,
					tangents,
					yawRadians,
				);
				if (status === PORT_SLOT_STATUS.LEGAL) {
					const railConflict = railClearance.conflictingPathIndex(
						resolution,
						side,
						policy.footprintRadiusMillimeters,
					);
					if (railConflict !== -1) {
						status = PORT_SLOT_STATUS.RAIL_CLEARANCE_CONFLICT;
						conflictingRailPathIndices[writeIndex] = railConflict;
					}
				}
			}
			statuses[writeIndex] = status;
			if (status === PORT_SLOT_STATUS.LEGAL) legalCount++;
			writeIndex++;
		}
	}
	sourcePathOffsets[remap.sourcePathCount] = writeIndex;
	if (writeIndex !== count) throw new Error("Port slot compiler row count diverged.");

	return Object.freeze({
		revision: layout.revision,
		portType,
		count,
		legalCount,
		sourcePathOffsets,
		sourcePathIndices,
		finalPathIndices,
		routeXs,
		routeZs,
		routeFromDirections,
		routeToDirections,
		stationMillimeters,
		sides,
		lateralOffsetMillimeters,
		directions,
		portTypes,
		railPositions,
		worldPositions,
		tangents,
		yawRadians,
		statuses,
		conflictingPortIds,
		conflictingRailPathIndices,
	});
}

/** Source rows marked here still render as invalid candidate slots for explicit feedback. */
export function compilePortSlotExclusionMask(layout: CompiledPhysicalLayout): Uint8Array {
	const remap = layout.pathIntervalRemap;
	const unsafeCells = collectUnsafeCells(layout);
	const mask = new Uint8Array(remap.sourcePathCount);
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		if (!isCardinalLinearSource(remap, sourcePathIndex)) continue;
		const route = readCardinalRoute(remap, sourcePathIndex);
		if (unsafeCells.has(cellKey(route.x, route.z))) {
			mask[sourcePathIndex] = 1;
			continue;
		}
		const entry = moveCell({ x: route.x, y: route.z }, route.from as Direction);
		const exit = moveCell({ x: route.x, y: route.z }, route.to as Direction);
		if (unsafeCells.has(cellKey(entry.x, entry.y)) || unsafeCells.has(cellKey(exit.x, exit.y))) {
			mask[sourcePathIndex] = 1;
		}
	}
	return mask;
}

/** Main-thread validation variant that preserves the same mask while yielding between bounded chunks. */
export async function compilePortSlotExclusionMaskCooperatively(
	layout: CompiledPhysicalLayout,
	checkpoint: () => Promise<void>,
): Promise<Uint8Array> {
	const remap = layout.pathIntervalRemap;
	const unsafeCells = new Set<string>();
	let work = 0;
	const checkpointWork = async (): Promise<void> => {
		work++;
		if ((work & 255) === 0) await checkpoint();
	};

	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		if ((remap.sourcePathKinds[sourcePathIndex] as number) !== PATH_KIND.LINEAR) {
			unsafeCells.add(
				cellKey(
					remap.sourcePathCells[sourcePathIndex * 2] as number,
					remap.sourcePathCells[sourcePathIndex * 2 + 1] as number,
				),
			);
		}
		await checkpointWork();
	}
	for (const terminal of layout.terminals) {
		unsafeCells.add(cellKey(terminal.x, terminal.y));
		await checkpointWork();
	}
	for (const junction of layout.junctions) {
		unsafeCells.add(cellKey(junction.cell.x, junction.cell.y));
		await checkpointWork();
		for (const cell of junction.footprintCells) {
			unsafeCells.add(cellKey(cell.x, cell.y));
			await checkpointWork();
		}
	}
	await appendCsrCellsCooperatively(
		unsafeCells,
		layout.turnoutFootprints.reservedOffsets,
		layout.turnoutFootprints.reservedCells,
		checkpointWork,
	);
	await appendCsrCellsCooperatively(
		unsafeCells,
		layout.advancedSwitches.claimedOffsets,
		layout.advancedSwitches.claimedCells,
		checkpointWork,
	);
	await appendCsrCellsCooperatively(
		unsafeCells,
		layout.advancedSwitches.reservedOffsets,
		layout.advancedSwitches.reservedCells,
		checkpointWork,
	);
	await checkpoint();

	const mask = new Uint8Array(remap.sourcePathCount);
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		if (isCardinalLinearSource(remap, sourcePathIndex)) {
			const route = readCardinalRoute(remap, sourcePathIndex);
			if (unsafeCells.has(cellKey(route.x, route.z))) {
				mask[sourcePathIndex] = 1;
			} else {
				const entry = moveCell({ x: route.x, y: route.z }, route.from as Direction);
				const exit = moveCell({ x: route.x, y: route.z }, route.to as Direction);
				if (
					unsafeCells.has(cellKey(entry.x, entry.y)) ||
					unsafeCells.has(cellKey(exit.x, exit.y))
				) {
					mask[sourcePathIndex] = 1;
				}
			}
		}
		await checkpointWork();
	}
	await checkpoint();
	return mask;
}

export function portSlotRecord(
	slots: CompiledPortSlots,
	row: number,
	id: number,
	equipmentGroupId: number,
	barcode: string | null = null,
): PortRecord {
	if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
		throw new RangeError(`Port slot row ${row} is outside the compiled slot buffer.`);
	}
	if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
		throw new Error(`Port slot row ${row} is not legal.`);
	}
	return {
		id,
		equipmentGroupId,
		route: {
			kind: "CARDINAL_CELL",
			x: slots.routeXs[row] as number,
			z: slots.routeZs[row] as number,
			from: slots.routeFromDirections[row] as Direction,
			to: slots.routeToDirections[row] as Direction,
		},
		stationMillimeters: slots.stationMillimeters[row] as number,
		side: PORT_SIDES[slots.sides[row] as number] as PortSide,
		lateralOffsetMillimeters: slots.lateralOffsetMillimeters[row] as number,
		direction: PORT_DIRECTIONS[slots.directions[row] as number] as "WITH_TRAVEL",
		portType: slots.portType,
		barcode,
	};
}

export function compilePortSlotSpatialIndex(
	slots: CompiledPortSlots,
	chunkSizeMeters = PORT_SLOT_SPATIAL_CHUNK_METERS,
): PortSlotSpatialIndexSnapshot {
	if (!Number.isSafeInteger(chunkSizeMeters) || chunkSizeMeters <= 0) {
		throw new Error("Port slot spatial chunk size must be a positive integer.");
	}
	const mutable = new Map<string, { readonly x: number; readonly z: number; rows: number[] }>();
	for (let row = 0; row < slots.count; row++) {
		const x = Math.floor((slots.worldPositions[row * 2] as number) / chunkSizeMeters);
		const z = Math.floor((slots.worldPositions[row * 2 + 1] as number) / chunkSizeMeters);
		const key = `${x}:${z}`;
		const chunk = mutable.get(key);
		if (chunk) chunk.rows.push(row);
		else mutable.set(key, { x, z, rows: [row] });
	}
	const chunks = [...mutable.values()].sort((left, right) => left.z - right.z || left.x - right.x);
	const chunkCoordinates = new Int32Array(chunks.length * 2);
	const chunkOffsets = new Uint32Array(chunks.length + 1);
	const slotIndices = new Uint32Array(slots.count);
	let write = 0;
	for (let index = 0; index < chunks.length; index++) {
		const chunk = chunks[index] as (typeof chunks)[number];
		chunkCoordinates[index * 2] = chunk.x;
		chunkCoordinates[index * 2 + 1] = chunk.z;
		chunkOffsets[index] = write;
		for (const row of chunk.rows) slotIndices[write++] = row;
	}
	chunkOffsets[chunks.length] = write;
	return Object.freeze({
		slotCount: slots.count,
		chunkSizeMeters,
		chunkCoordinates,
		chunkOffsets,
		slotIndices,
	});
}

export function validatePortSlotSpatialIndex(
	slots: CompiledPortSlots,
	snapshot: PortSlotSpatialIndexSnapshot,
): void {
	const chunks = snapshot.chunkOffsets.length - 1;
	assertPortSlotSpatialIndexShape(slots, snapshot, chunks);
	const seen = new Uint8Array(slots.count);
	let previous = 0;
	for (const offset of snapshot.chunkOffsets) {
		if (offset < previous || offset > slots.count) {
			throw new Error("Port slot spatial offsets are invalid.");
		}
		previous = offset;
	}
	let previousChunkX = 0;
	let previousChunkZ = 0;
	for (let chunk = 0; chunk < chunks; chunk++) {
		const chunkX = snapshot.chunkCoordinates[chunk * 2] as number;
		const chunkZ = snapshot.chunkCoordinates[chunk * 2 + 1] as number;
		if (
			chunk > 0 &&
			(chunkZ < previousChunkZ || (chunkZ === previousChunkZ && chunkX <= previousChunkX))
		) {
			throw new Error("Port slot spatial chunk coordinates are not canonical.");
		}
		previousChunkX = chunkX;
		previousChunkZ = chunkZ;
		let previousRow = -1;
		const start = snapshot.chunkOffsets[chunk] as number;
		const end = snapshot.chunkOffsets[chunk + 1] as number;
		for (let position = start; position < end; position++) {
			const row = snapshot.slotIndices[position] as number;
			if (row >= slots.count || seen[row] !== 0 || row <= previousRow) {
				throw new Error("Port slot spatial rows are invalid.");
			}
			const expectedChunkX = Math.floor(
				(slots.worldPositions[row * 2] as number) / snapshot.chunkSizeMeters,
			);
			const expectedChunkZ = Math.floor(
				(slots.worldPositions[row * 2 + 1] as number) / snapshot.chunkSizeMeters,
			);
			if (chunkX !== expectedChunkX || chunkZ !== expectedChunkZ) {
				throw new Error(`Port slot spatial row ${row} belongs to a different chunk.`);
			}
			previousRow = row;
			seen[row] = 1;
		}
	}
}

/** Canonical chunk ordering/membership validation, exposed as steps for main-thread cooperation. */
export function* portSlotSpatialIndexValidationSteps(
	slots: CompiledPortSlots,
	snapshot: PortSlotSpatialIndexSnapshot,
): Generator<void> {
	const chunks = snapshot.chunkOffsets.length - 1;
	assertPortSlotSpatialIndexShape(slots, snapshot, chunks);
	const seen = new Uint8Array(slots.count);
	let previous = 0;
	for (const offset of snapshot.chunkOffsets) {
		if (offset < previous || offset > slots.count) {
			throw new Error("Port slot spatial offsets are invalid.");
		}
		previous = offset;
		yield;
	}
	let previousChunkX = 0;
	let previousChunkZ = 0;
	for (let chunk = 0; chunk < chunks; chunk++) {
		const chunkX = snapshot.chunkCoordinates[chunk * 2] as number;
		const chunkZ = snapshot.chunkCoordinates[chunk * 2 + 1] as number;
		if (
			chunk > 0 &&
			(chunkZ < previousChunkZ || (chunkZ === previousChunkZ && chunkX <= previousChunkX))
		) {
			throw new Error("Port slot spatial chunk coordinates are not canonical.");
		}
		previousChunkX = chunkX;
		previousChunkZ = chunkZ;
		let previousRow = -1;
		const start = snapshot.chunkOffsets[chunk] as number;
		const end = snapshot.chunkOffsets[chunk + 1] as number;
		for (let position = start; position < end; position++) {
			const row = snapshot.slotIndices[position] as number;
			if (row >= slots.count || seen[row] !== 0 || row <= previousRow) {
				throw new Error("Port slot spatial rows are invalid.");
			}
			const expectedChunkX = Math.floor(
				(slots.worldPositions[row * 2] as number) / snapshot.chunkSizeMeters,
			);
			const expectedChunkZ = Math.floor(
				(slots.worldPositions[row * 2 + 1] as number) / snapshot.chunkSizeMeters,
			);
			if (chunkX !== expectedChunkX || chunkZ !== expectedChunkZ) {
				throw new Error(`Port slot spatial row ${row} belongs to a different chunk.`);
			}
			previousRow = row;
			seen[row] = 1;
			yield;
		}
	}
}

function assertPortSlotSpatialIndexShape(
	slots: CompiledPortSlots,
	snapshot: PortSlotSpatialIndexSnapshot,
	chunks: number,
): void {
	if (
		snapshot.slotCount !== slots.count ||
		!Number.isSafeInteger(snapshot.chunkSizeMeters) ||
		snapshot.chunkSizeMeters <= 0 ||
		snapshot.chunkCoordinates.length !== chunks * 2 ||
		snapshot.slotIndices.length !== slots.count ||
		(snapshot.chunkOffsets[0] as number) !== 0 ||
		(snapshot.chunkOffsets[chunks] as number) !== slots.count
	) {
		throw new Error("Port slot spatial index shape is invalid.");
	}
}

function collectUnsafeCells(layout: CompiledPhysicalLayout): Set<string> {
	const unsafe = new Set<string>();
	const remap = layout.pathIntervalRemap;
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		if ((remap.sourcePathKinds[sourcePathIndex] as number) === PATH_KIND.LINEAR) continue;
		unsafe.add(
			cellKey(
				remap.sourcePathCells[sourcePathIndex * 2] as number,
				remap.sourcePathCells[sourcePathIndex * 2 + 1] as number,
			),
		);
	}
	for (const terminal of layout.terminals) unsafe.add(cellKey(terminal.x, terminal.y));
	for (const junction of layout.junctions) {
		unsafe.add(cellKey(junction.cell.x, junction.cell.y));
		for (const cell of junction.footprintCells) unsafe.add(cellKey(cell.x, cell.y));
	}
	appendCsrCells(
		unsafe,
		layout.turnoutFootprints.reservedOffsets,
		layout.turnoutFootprints.reservedCells,
	);
	appendCsrCells(
		unsafe,
		layout.advancedSwitches.claimedOffsets,
		layout.advancedSwitches.claimedCells,
	);
	appendCsrCells(
		unsafe,
		layout.advancedSwitches.reservedOffsets,
		layout.advancedSwitches.reservedCells,
	);
	return unsafe;
}

function appendCsrCells(target: Set<string>, offsets: Uint32Array, cells: Int32Array): void {
	const count = Math.max(0, offsets.length - 1);
	for (let owner = 0; owner < count; owner++) {
		for (let row = offsets[owner] as number; row < (offsets[owner + 1] as number); row++) {
			target.add(cellKey(cells[row * 2] as number, cells[row * 2 + 1] as number));
		}
	}
}

async function appendCsrCellsCooperatively(
	target: Set<string>,
	offsets: Uint32Array,
	cells: Int32Array,
	checkpointWork: () => Promise<void>,
): Promise<void> {
	const count = Math.max(0, offsets.length - 1);
	for (let owner = 0; owner < count; owner++) {
		for (let row = offsets[owner] as number; row < (offsets[owner + 1] as number); row++) {
			target.add(cellKey(cells[row * 2] as number, cells[row * 2 + 1] as number));
			await checkpointWork();
		}
		await checkpointWork();
	}
}

function isCardinalLinearSource(remap: CompiledPathIntervalRemap, index: number): boolean {
	return (
		(remap.sourceIdentityKinds[index] as number) === PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL &&
		(remap.sourcePathKinds[index] as number) === PATH_KIND.LINEAR &&
		(remap.sourcePathFromDirections[index] as number) !== 0 &&
		(remap.sourcePathToDirections[index] as number) !== 0
	);
}

function readCardinalRoute(remap: CompiledPathIntervalRemap, index: number): CardinalPortRoute {
	return {
		kind: "CARDINAL_CELL",
		x: remap.sourcePathCells[index * 2] as number,
		z: remap.sourcePathCells[index * 2 + 1] as number,
		from: remap.sourcePathFromDirections[index] as Direction,
		to: remap.sourcePathToDirections[index] as Direction,
	};
}

function sourceMidpointMillimeters(remap: CompiledPathIntervalRemap, index: number): number {
	return metersToMillimeters(
		(remap.sourcePathCanonicalStarts[index] as number) +
			(remap.sourcePathLengths[index] as number) * 0.5,
	);
}

function writeResolution(
	row: number,
	resolution: ResolvedPortAttachment,
	railPositions: Float32Array,
	worldPositions: Float32Array,
	tangents: Float32Array,
	yawRadians: Float32Array,
): void {
	railPositions[row * 2] = resolution.railXMeters;
	railPositions[row * 2 + 1] = resolution.railZMeters;
	worldPositions[row * 2] = resolution.worldXMeters;
	worldPositions[row * 2 + 1] = resolution.worldZMeters;
	tangents[row * 2] = resolution.tangentX;
	tangents[row * 2 + 1] = resolution.tangentZ;
	yawRadians[row] = resolution.yawRadians;
}

function findPortConflict(
	index: PortEquipmentResolvedPositionIndex,
	ports: readonly PortRecord[],
	route: CardinalPortRoute,
	stationMillimeters: number,
	side: PortSide,
	worldXMeters: number,
	worldZMeters: number,
	minimumSpacingMillimeters: number,
	ignoredPortId: number,
	ignoredEquipmentGroupId: number,
): { readonly port: PortRecord; readonly occupied: boolean } | null {
	const bucketX = Math.floor(worldXMeters);
	const bucketZ = Math.floor(worldZMeters);
	const minimumSpacingMeters = minimumSpacingMillimeters / 1_000;
	// An exact authored slot is authoritative over a merely nearby clearance conflict. Checking the
	// owning bucket first also avoids eight irrelevant neighbor probes for dense imported rows.
	for (let row = index.firstRow(bucketX, bucketZ); row >= 0; row = index.nextRow(row)) {
		const port = ports[row] as PortRecord;
		if (port.id === ignoredPortId || port.equipmentGroupId === ignoredEquipmentGroupId) continue;
		if (sameCardinalSlot(port, route.x, route.z, route.from, route.to, stationMillimeters, side))
			return { port, occupied: true };
	}
	for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
		for (let deltaX = -1; deltaX <= 1; deltaX++) {
			for (
				let row = index.firstRow(bucketX + deltaX, bucketZ + deltaZ);
				row >= 0;
				row = index.nextRow(row)
			) {
				const port = ports[row] as PortRecord;
				if (port.id === ignoredPortId || port.equipmentGroupId === ignoredEquipmentGroupId)
					continue;
				const sameSlot = sameCardinalSlot(
					port,
					route.x,
					route.z,
					route.from,
					route.to,
					stationMillimeters,
					side,
				);
				const distance = Math.hypot(
					index.worldX(row) - worldXMeters,
					index.worldZ(row) - worldZMeters,
				);
				if (sameSlot || distance < minimumSpacingMeters - DISTANCE_EPSILON_METERS) {
					return { port, occupied: sameSlot };
				}
			}
		}
	}
	return null;
}

function findRailConflict(
	layout: CompiledPhysicalLayout,
	index: RailEnvelopeSpatialIndex,
	target: number[],
	resolution: ResolvedPortAttachment,
	side: PortSide,
	footprintRadiusMillimeters: number,
): number {
	const radiusMeters = footprintRadiusMillimeters / 1_000;
	index.query(
		{
			minX: resolution.worldXMeters - radiusMeters,
			minY: resolution.worldZMeters - radiusMeters,
			maxX: resolution.worldXMeters + radiusMeters,
			maxY: resolution.worldZMeters + radiusMeters,
		},
		target,
	);
	const envelopes = layout.clearance.envelopes;
	for (const envelopeIndex of target) {
		const pathIndex = envelopes.pathIndices[envelopeIndex] as number;
		if (
			(pathIndex === resolution.finalPathIndex &&
				resolution.finalPathStationMeters >=
					(envelopes.stationStarts[envelopeIndex] as number) - LOCAL_OWNING_RAIL_WINDOW_METERS &&
				resolution.finalPathStationMeters <=
					(envelopes.stationEnds[envelopeIndex] as number) + LOCAL_OWNING_RAIL_WINDOW_METERS) ||
			(side === "CENTER" && isDirectedOwningRailContinuation(layout, resolution, pathIndex))
		) {
			continue;
		}
		const distance = pointSegmentDistance(
			resolution.worldXMeters,
			resolution.worldZMeters,
			envelopes.startPoints[envelopeIndex * 2] as number,
			envelopes.startPoints[envelopeIndex * 2 + 1] as number,
			envelopes.endPoints[envelopeIndex * 2] as number,
			envelopes.endPoints[envelopeIndex * 2 + 1] as number,
		);
		const required =
			((envelopes.installationRadiusMillimeters[envelopeIndex] as number) +
				(envelopes.approximationToleranceMillimeters[envelopeIndex] as number) +
				footprintRadiusMillimeters) /
			1_000;
		if (distance < required - DISTANCE_EPSILON_METERS) return pathIndex;
	}
	return -1;
}

/** CENTER ports sit below rail, so the exact predecessor/successor at a path seam is also owned. */
function isDirectedOwningRailContinuation(
	layout: CompiledPhysicalLayout,
	resolution: ResolvedPortAttachment,
	candidatePathIndex: number,
): boolean {
	const paths = layout.paths;
	const ownerPathIndex = resolution.finalPathIndex;
	if (
		candidatePathIndex < 0 ||
		candidatePathIndex >= paths.pathCount ||
		ownerPathIndex < 0 ||
		ownerPathIndex >= paths.pathCount ||
		candidatePathIndex === ownerPathIndex
	) {
		return false;
	}
	return (
		(paths.kinds[ownerPathIndex] as number) === PATH_KIND.LINEAR &&
		(paths.kinds[candidatePathIndex] as number) === PATH_KIND.LINEAR &&
		(paths.fromDirections[ownerPathIndex] as number) ===
			(paths.fromDirections[candidatePathIndex] as number) &&
		(paths.toDirections[ownerPathIndex] as number) ===
			(paths.toDirections[candidatePathIndex] as number) &&
		(pathsAreDirectedNeighbors(paths, candidatePathIndex, ownerPathIndex) ||
			pathsAreDirectedNeighbors(paths, ownerPathIndex, candidatePathIndex))
	);
}

function pathsAreDirectedNeighbors(
	paths: CompiledPhysicalLayout["paths"],
	fromPathIndex: number,
	toPathIndex: number,
): boolean {
	const exitX = paths.exitCells[fromPathIndex * 2] as number;
	const exitZ = paths.exitCells[fromPathIndex * 2 + 1] as number;
	const toDirection = paths.toDirections[fromPathIndex] as Direction | 0;
	const fromDirection = paths.fromDirections[toPathIndex] as Direction | 0;
	if (
		toDirection === 0 ||
		fromDirection === 0 ||
		fromDirection !== oppositeDirection(toDirection)
	) {
		return false;
	}
	const next = moveCell({ x: exitX, y: exitZ }, toDirection);
	return (
		next.x === (paths.cells[toPathIndex * 2] as number) &&
		next.y === (paths.cells[toPathIndex * 2 + 1] as number)
	);
}

function pointSegmentDistance(
	px: number,
	py: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): number {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const denominator = dx * dx + dy * dy;
	const amount =
		denominator === 0 ? 0 : clamp(((px - x0) * dx + (py - y0) * dy) / denominator, 0, 1);
	return Math.hypot(px - (x0 + dx * amount), py - (y0 + dy * amount));
}

function sameCardinalSlot(
	port: PortRecord,
	x: number,
	z: number,
	from: CardinalPortRoute["from"],
	to: CardinalPortRoute["to"],
	stationMillimeters: number,
	side: PortSide,
): boolean {
	const existing = port.route;
	return (
		existing.kind === "CARDINAL_CELL" &&
		existing.x === x &&
		existing.z === z &&
		existing.from === from &&
		existing.to === to &&
		port.stationMillimeters === stationMillimeters &&
		port.side === side
	);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
