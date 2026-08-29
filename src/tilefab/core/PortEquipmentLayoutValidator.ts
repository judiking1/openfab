import {
	type EqEquipmentGroup,
	type EquipmentGroupRecord,
	equipmentGroupError,
	type PortEquipmentState,
	portEquipmentStateError,
	type StkEquipmentGroup,
} from "./EquipmentGroup";
import {
	type CardinalPortRoute,
	OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
	type PortRecord,
	type PortRouteIdentity,
	portRecordError,
	portRouteIdentityKey,
} from "./PortRecord";
import { type Direction, moveCell, oppositeDirection } from "./railShape";
import { analyzeStkPortLayout } from "./StkPortLayout";
import { decodeRailCell, type TileMap } from "./TileMap";

export const PORT_EQUIPMENT_LAYOUT_ISSUE_CODES = [
	"PORT_ROUTE_MISSING",
	"EQ_FIRST_PORT_MISSING",
	"EQ_PORT_MISSING",
	"EQ_ROUTE_NOT_THROUGH",
	"EQ_ROUTE_NOT_STRAIGHT",
	"EQ_PORT_SIDE_OFFSET",
	"EQ_PORT_DIRECTION",
	"EQ_PORT_LANE",
	"EQ_PORT_RAIL_DISCONTINUITY",
	"EQ_PORT_PITCH_ORDER",
	"EQ_PORT_PITCH_DISCONTINUITY",
	"STK_PORT_MISSING",
	"STK_PORT_ROUTE_NOT_CARDINAL",
	"STK_LAYOUT_GRAMMAR",
	"STK_PORT_ORDER",
	"STK_PORT_RAIL_DISCONTINUITY",
	"STK_PORT_STATION",
	"STK_PORT_APPROACH",
	"PORT_STATION_OCCUPIED",
	"PORT_SPACING",
	"EQ_STK_BODY_OVERLAP",
	"STK_RESERVATION_OVERLAP",
	"STK_RESERVATION_CROSSES_EQUIPMENT",
] as const;

export type PortEquipmentLayoutIssueCode = (typeof PORT_EQUIPMENT_LAYOUT_ISSUE_CODES)[number];

export type PortEquipmentLayoutMeasurementUnit = "MILLIMETERS" | "METERS";
export type PortEquipmentLayoutMeasurementRelation = "MINIMUM" | "MAXIMUM" | "EXACT" | "OVERLAP";

export interface PortEquipmentLayoutMeasurement {
	readonly measured: number;
	readonly required: number;
	readonly unit: PortEquipmentLayoutMeasurementUnit;
	readonly relation: PortEquipmentLayoutMeasurementRelation;
}

export interface PortEquipmentLayoutCell {
	readonly x: number;
	readonly z: number;
}

/**
 * One independently actionable authored-layout problem.
 *
 * Entity arrays preserve conflicts without encoding IDs in display text. Routes and cells are
 * snapshots of the authored context, while measurements retain machine-readable engineering
 * values for Worker/UI consumers.
 */
export interface PortEquipmentLayoutIssue {
	readonly code: PortEquipmentLayoutIssueCode;
	readonly message: string;
	readonly portIds: readonly number[];
	readonly equipmentGroupIds: readonly number[];
	readonly routes: readonly PortRouteIdentity[];
	readonly cells: readonly PortEquipmentLayoutCell[];
	readonly measurement: PortEquipmentLayoutMeasurement | null;
}

interface MutableLayoutIssue {
	readonly code: PortEquipmentLayoutIssueCode;
	readonly message: string;
	readonly portIds?: readonly number[];
	readonly equipmentGroupIds?: readonly number[];
	readonly routes?: readonly PortRouteIdentity[];
	readonly cells?: readonly PortEquipmentLayoutCell[];
	readonly measurement?: PortEquipmentLayoutMeasurement | null;
}

/**
 * Validate authored equipment against the directed 1 m TileMap grammar.
 * This core guard intentionally does not depend on compiled render/physical buffers.
 */
export function portEquipmentLayoutError(map: TileMap, state: PortEquipmentState): string | null {
	const stateError = portEquipmentStateError(state);
	if (stateError) return stateError;
	const portsById = new Map(state.ports.map((port) => [port.id, port] as const));
	for (const port of state.ports) {
		if (!portRouteExists(map, port.route)) {
			return `port ${port.id} route does not exist in the authored rail map`;
		}
	}
	for (const group of state.equipmentGroups) {
		const error =
			group.kind === "EQ"
				? eqEquipmentLayoutError(map, group, portsById)
				: group.kind === "STK"
					? stkEquipmentLayoutError(map, group, portsById)
					: null;
		if (error) return equipmentGroupMessage(group.id, error);
	}
	const spacingError = portEquipmentSpacingError(state);
	if (spacingError) return spacingError;
	return portEquipmentBodyOverlapError(map, state);
}

/**
 * Collect every independently actionable spatial/layout issue in deterministic validation order.
 * Integrity-invalid states are intentionally left to the integrity collector and produce no
 * layout issues, keeping this function non-throwing on forged or partially hydrated input.
 */
export function collectPortEquipmentLayoutIssues(
	map: TileMap,
	state: PortEquipmentState,
): readonly PortEquipmentLayoutIssue[] {
	if (portEquipmentStateError(state)) return Object.freeze([]);
	return collectPortEquipmentLayoutIssuesFromIntegrityValidState(map, state);
}

/** Same collector for a caller that already validated this exact immutable state generation. */
export function collectPortEquipmentLayoutIssuesFromIntegrityValidState(
	map: TileMap,
	state: PortEquipmentState,
): readonly PortEquipmentLayoutIssue[] {
	const issues: PortEquipmentLayoutIssue[] = [];
	const portsById = new Map(state.ports.map((port) => [port.id, port] as const));
	for (const port of state.ports) {
		if (portRouteExists(map, port.route)) continue;
		issues.push(
			createLayoutIssue({
				code: "PORT_ROUTE_MISSING",
				message: `port ${port.id} route does not exist in the authored rail map`,
				portIds: [port.id],
				equipmentGroupIds: [port.equipmentGroupId],
				routes: [port.route],
			}),
		);
	}
	for (const group of state.equipmentGroups) {
		if (group.kind === "EQ") {
			issues.push(...collectEqEquipmentLayoutIssues(map, group, portsById));
		} else if (group.kind === "STK") {
			issues.push(...collectStkEquipmentLayoutIssues(map, group, portsById));
		}
	}
	issues.push(...collectPortEquipmentSpacingIssues(state));
	issues.push(...collectPortEquipmentBodyOverlapIssues(map, state));
	return Object.freeze(issues);
}

/** Enforce authored station occupancy independently of any prepared preview catalog. */
export function portEquipmentSpacingError(state: PortEquipmentState): string | null {
	const minimumSpacingMeters = OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS / 1_000;
	const bucketSize = minimumSpacingMeters;
	const buckets = new Map<string, PortWorldPoint[]>();
	const exactSlots = new Map<string, number>();
	for (const port of state.ports) {
		const exactKey = `${portRouteIdentityKey(port.route)}:${port.stationMillimeters}:${port.side}`;
		const existingPortId = exactSlots.get(exactKey);
		if (existingPortId !== undefined) {
			return `ports ${existingPortId} and ${port.id} occupy the same authored station`;
		}
		exactSlots.set(exactKey, port.id);
		const world = portWorldPosition(port);
		if (!world) continue;
		const bucketX = Math.floor(world.x / bucketSize);
		const bucketZ = Math.floor(world.z / bucketSize);
		for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
			for (let deltaX = -1; deltaX <= 1; deltaX++) {
				const bucket = buckets.get(`${bucketX + deltaX}:${bucketZ + deltaZ}`);
				if (!bucket) continue;
				for (const existing of bucket) {
					if (
						Math.hypot(existing.x - world.x, existing.z - world.z) <
						minimumSpacingMeters - BODY_OVERLAP_EPSILON
					) {
						return `ports ${existing.port.id} and ${port.id} are closer than ${OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS} mm`;
					}
				}
			}
		}
		const key = `${bucketX}:${bucketZ}`;
		const bucket = buckets.get(key);
		const point = { port, x: world.x, z: world.z };
		if (bucket) bucket.push(point);
		else buckets.set(key, [point]);
	}
	return null;
}

function collectPortEquipmentSpacingIssues(
	state: PortEquipmentState,
): readonly PortEquipmentLayoutIssue[] {
	const minimumSpacingMeters = OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS / 1_000;
	const bucketSize = minimumSpacingMeters;
	const buckets = new Map<string, PortWorldPoint[]>();
	const exactSlots = new Map<string, PortRecord>();
	const issues: PortEquipmentLayoutIssue[] = [];
	for (const port of state.ports) {
		const exactKey = `${portRouteIdentityKey(port.route)}:${port.stationMillimeters}:${port.side}`;
		const exactConflict = exactSlots.get(exactKey);
		if (exactConflict) {
			issues.push(
				createLayoutIssue({
					code: "PORT_STATION_OCCUPIED",
					message: `ports ${exactConflict.id} and ${port.id} occupy the same authored station`,
					portIds: [exactConflict.id, port.id],
					equipmentGroupIds: [exactConflict.equipmentGroupId, port.equipmentGroupId],
					routes: [exactConflict.route, port.route],
					measurement: {
						measured: 0,
						required: OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
						unit: "MILLIMETERS",
						relation: "MINIMUM",
					},
				}),
			);
		} else {
			exactSlots.set(exactKey, port);
		}
		const world = portWorldPosition(port);
		if (!world) continue;
		const bucketX = Math.floor(world.x / bucketSize);
		const bucketZ = Math.floor(world.z / bucketSize);
		if (!exactConflict) {
			let proximityConflict: PortWorldPoint | null = null;
			for (let deltaZ = -1; deltaZ <= 1 && !proximityConflict; deltaZ++) {
				for (let deltaX = -1; deltaX <= 1 && !proximityConflict; deltaX++) {
					const bucket = buckets.get(`${bucketX + deltaX}:${bucketZ + deltaZ}`);
					if (!bucket) continue;
					for (const existing of bucket) {
						if (
							Math.hypot(existing.x - world.x, existing.z - world.z) <
							minimumSpacingMeters - BODY_OVERLAP_EPSILON
						) {
							proximityConflict = existing;
							break;
						}
					}
				}
			}
			if (proximityConflict) {
				const measuredMillimeters =
					Math.hypot(proximityConflict.x - world.x, proximityConflict.z - world.z) * 1_000;
				issues.push(
					createLayoutIssue({
						code: "PORT_SPACING",
						message: `ports ${proximityConflict.port.id} and ${port.id} are closer than ${OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS} mm`,
						portIds: [proximityConflict.port.id, port.id],
						equipmentGroupIds: [proximityConflict.port.equipmentGroupId, port.equipmentGroupId],
						routes: [proximityConflict.port.route, port.route],
						measurement: {
							measured: measuredMillimeters,
							required: OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
							unit: "MILLIMETERS",
							relation: "MINIMUM",
						},
					}),
				);
			}
		}
		const key = `${bucketX}:${bucketZ}`;
		const bucket = buckets.get(key);
		const point = { port, x: world.x, z: world.z };
		if (bucket) bucket.push(point);
		else buckets.set(key, [point]);
	}
	return Object.freeze(issues);
}

interface PortWorldPoint {
	readonly port: PortRecord;
	readonly x: number;
	readonly z: number;
}

/** Validate derived STK run reservations without depending on compiled rendering geometry. */
export function portEquipmentBodyOverlapError(
	map: TileMap,
	state: PortEquipmentState,
): string | null {
	const stkGroups = state.equipmentGroups.filter((group) => group.kind === "STK");
	if (stkGroups.length === 0) return null;
	const runByRouteKey = compileStraightRailRuns(map);
	const portsById = new Map(state.ports.map((port) => [port.id, port] as const));
	const pointsByRun = new Map<number, BodyPoint[]>();
	for (const port of state.ports) {
		if (port.portType !== "OHB" || port.route.kind !== "CARDINAL_CELL") continue;
		const run = runByRouteKey.get(portRouteIdentityKey(port.route));
		if (!run) continue;
		const point = {
			equipmentGroupId: port.equipmentGroupId,
			port,
			along: corePortAlongPosition(port, run.axis),
		};
		const points = pointsByRun.get(run.id);
		if (points) points.push(point);
		else pointsByRun.set(run.id, [point]);
	}
	const spansByRun = new Map<number, BodySpan[]>();
	for (const group of stkGroups) {
		const extents = new Map<number, MutableBodyExtent>();
		for (const portId of group.portIds) {
			const port = portsById.get(portId);
			if (!port || port.route.kind !== "CARDINAL_CELL") continue;
			const run = runByRouteKey.get(portRouteIdentityKey(port.route));
			if (!run) continue;
			const along = corePortAlongPosition(port, run.axis);
			const extent = extents.get(run.id);
			if (extent) {
				extent.min = Math.min(extent.min, along);
				extent.max = Math.max(extent.max, along);
				extent.portIds.push(port.id);
				extent.routes.push(port.route);
			} else {
				extents.set(run.id, {
					min: along,
					max: along,
					portIds: [port.id],
					routes: [port.route],
				});
			}
		}
		for (const [runId, extent] of extents) {
			const spans = spansByRun.get(runId);
			const span: BodySpan = {
				equipmentGroupId: group.id,
				min: extent.min,
				max: extent.max,
				portIds: extent.portIds,
				routes: extent.routes,
			};
			if (spans) spans.push(span);
			else spansByRun.set(runId, [span]);
		}
	}
	const spanIndexByRun = new Map<number, BodySpanIntervalIndex>();
	for (const [runId, spans] of spansByRun) {
		spanIndexByRun.set(runId, buildBodySpanIntervalIndex(spans));
	}
	for (const group of state.equipmentGroups) {
		if (group.kind !== "EQ") continue;
		const extents = equipmentBodyExtentsByRun(group, portsById, runByRouteKey);
		for (const [runId, extent] of extents) {
			const stkSpan = findOverlappingBodySpan(spanIndexByRun.get(runId), extent);
			if (stkSpan) {
				return `EQ group ${group.id} body crosses STK group ${stkSpan.equipmentGroupId} reservation`;
			}
		}
	}
	for (const [runId, spanIndex] of spanIndexByRun) {
		const spans = spanIndex.spans;
		let furthest: BodySpan | null = null;
		for (const span of spans) {
			if (
				furthest &&
				furthest.equipmentGroupId !== span.equipmentGroupId &&
				span.min <= furthest.max + BODY_OVERLAP_EPSILON
			) {
				return `STK group ${span.equipmentGroupId} reservation overlaps equipment group ${furthest.equipmentGroupId}`;
			}
			if (!furthest || span.max > furthest.max) furthest = span;
		}
		const points = pointsByRun.get(runId) ?? [];
		points.sort((left, right) => left.along - right.along);
		for (const span of spans) {
			let index = lowerBoundBodyPoint(points, span.min - BODY_OVERLAP_EPSILON);
			while (
				index < points.length &&
				(points[index]?.along ?? Infinity) <= span.max + BODY_OVERLAP_EPSILON
			) {
				const point = points[index] as BodyPoint;
				if (point.equipmentGroupId !== span.equipmentGroupId) {
					return `STK group ${span.equipmentGroupId} reservation crosses equipment group ${point.equipmentGroupId}`;
				}
				index++;
			}
		}
	}
	return null;
}

function collectPortEquipmentBodyOverlapIssues(
	map: TileMap,
	state: PortEquipmentState,
): readonly PortEquipmentLayoutIssue[] {
	const stkGroups = state.equipmentGroups.filter((group) => group.kind === "STK");
	if (stkGroups.length === 0) return Object.freeze([]);
	const issues: PortEquipmentLayoutIssue[] = [];
	const runByRouteKey = compileStraightRailRuns(map);
	const portsById = new Map(state.ports.map((port) => [port.id, port] as const));
	const pointsByRun = new Map<number, BodyPoint[]>();
	for (const port of state.ports) {
		if (port.portType !== "OHB" || port.route.kind !== "CARDINAL_CELL") continue;
		const run = runByRouteKey.get(portRouteIdentityKey(port.route));
		if (!run) continue;
		const point = {
			equipmentGroupId: port.equipmentGroupId,
			port,
			along: corePortAlongPosition(port, run.axis),
		};
		const points = pointsByRun.get(run.id);
		if (points) points.push(point);
		else pointsByRun.set(run.id, [point]);
	}
	const spansByRun = new Map<number, BodySpan[]>();
	for (const group of stkGroups) {
		const extents = equipmentBodyExtentsByRun(group, portsById, runByRouteKey);
		for (const [runId, extent] of extents) {
			const spans = spansByRun.get(runId);
			const span = {
				equipmentGroupId: group.id,
				min: extent.min,
				max: extent.max,
				portIds: Object.freeze([...extent.portIds]),
				routes: Object.freeze([...extent.routes]),
			};
			if (spans) spans.push(span);
			else spansByRun.set(runId, [span]);
		}
	}
	const spanIndexByRun = new Map<number, BodySpanIntervalIndex>();
	for (const [runId, spans] of spansByRun) {
		spanIndexByRun.set(runId, buildBodySpanIntervalIndex(spans));
	}
	const eqSpansByRun = new Map<number, BodySpan[]>();
	const eqSpansInSourceOrder: { readonly runId: number; readonly span: BodySpan }[] = [];
	for (const group of state.equipmentGroups) {
		if (group.kind !== "EQ") continue;
		const extents = equipmentBodyExtentsByRun(group, portsById, runByRouteKey);
		for (const [runId, extent] of extents) {
			const span: BodySpan = {
				equipmentGroupId: group.id,
				min: extent.min,
				max: extent.max,
				portIds: Object.freeze([...extent.portIds]),
				routes: Object.freeze([...extent.routes]),
			};
			const spans = eqSpansByRun.get(runId);
			if (spans) spans.push(span);
			else eqSpansByRun.set(runId, [span]);
			eqSpansInSourceOrder.push(Object.freeze({ runId, span }));
		}
	}
	const eqSpanIndexByRun = new Map<number, BodySpanIntervalIndex>();
	for (const [runId, spans] of eqSpansByRun) {
		eqSpanIndexByRun.set(runId, buildBodySpanIntervalIndex(spans));
	}
	const reportedRunPairs = new Set<string>();
	const reportEqStkOverlap = (runId: number, eqSpan: BodySpan, stkSpan: BodySpan): void => {
		const pairKey = bodyRunPairKey(runId, eqSpan.equipmentGroupId, stkSpan.equipmentGroupId);
		if (reportedRunPairs.has(pairKey)) return;
		reportedRunPairs.add(pairKey);
		const overlap = Math.min(eqSpan.max, stkSpan.max) - Math.max(eqSpan.min, stkSpan.min);
		issues.push(
			createLayoutIssue({
				code: "EQ_STK_BODY_OVERLAP",
				message: `EQ group ${eqSpan.equipmentGroupId} body crosses STK group ${stkSpan.equipmentGroupId} reservation`,
				portIds: [...eqSpan.portIds, ...stkSpan.portIds],
				equipmentGroupIds: [eqSpan.equipmentGroupId, stkSpan.equipmentGroupId],
				routes: [...eqSpan.routes, ...stkSpan.routes],
				measurement: {
					measured: Math.max(0, overlap),
					required: 0,
					unit: "METERS",
					relation: "OVERLAP",
				},
			}),
		);
	};
	for (const { runId, span: eqSpan } of eqSpansInSourceOrder) {
		const stkSpan = findOverlappingBodySpan(spanIndexByRun.get(runId), eqSpan);
		if (stkSpan) reportEqStkOverlap(runId, eqSpan, stkSpan);
	}
	for (const [runId, stkIndex] of spanIndexByRun) {
		const eqIndex = eqSpanIndexByRun.get(runId);
		for (const stkSpan of stkIndex.spans) {
			const eqSpan = findOverlappingBodySpan(eqIndex, stkSpan);
			if (eqSpan) reportEqStkOverlap(runId, eqSpan, stkSpan);
		}
	}
	const reportStkPointOverlap = (runId: number, span: BodySpan, point: BodyPoint): void => {
		if (point.equipmentGroupId === span.equipmentGroupId) return;
		const pairKey = bodyRunPairKey(runId, span.equipmentGroupId, point.equipmentGroupId);
		if (reportedRunPairs.has(pairKey)) return;
		reportedRunPairs.add(pairKey);
		issues.push(
			createLayoutIssue({
				code: "STK_RESERVATION_CROSSES_EQUIPMENT",
				message: `STK group ${span.equipmentGroupId} reservation crosses equipment group ${point.equipmentGroupId}`,
				portIds: [...span.portIds, point.port.id],
				equipmentGroupIds: [span.equipmentGroupId, point.equipmentGroupId],
				routes: [...span.routes, point.port.route],
			}),
		);
	};
	for (const [runId, spans] of spansByRun) {
		const orderedSpans = spanIndexByRun.get(runId)?.spans ?? spans;
		let furthest: BodySpan | null = null;
		for (const span of orderedSpans) {
			if (
				furthest &&
				furthest.equipmentGroupId !== span.equipmentGroupId &&
				span.min <= furthest.max + BODY_OVERLAP_EPSILON
			) {
				const pairKey = bodyRunPairKey(runId, span.equipmentGroupId, furthest.equipmentGroupId);
				if (!reportedRunPairs.has(pairKey)) {
					reportedRunPairs.add(pairKey);
					issues.push(
						createLayoutIssue({
							code: "STK_RESERVATION_OVERLAP",
							message: `STK group ${span.equipmentGroupId} reservation overlaps equipment group ${furthest.equipmentGroupId}`,
							portIds: [...span.portIds, ...furthest.portIds],
							equipmentGroupIds: [span.equipmentGroupId, furthest.equipmentGroupId],
							routes: [...span.routes, ...furthest.routes],
							measurement: {
								measured: Math.max(
									0,
									Math.min(span.max, furthest.max) - Math.max(span.min, furthest.min),
								),
								required: 0,
								unit: "METERS",
								relation: "OVERLAP",
							},
						}),
					);
				}
			}
			if (!furthest || span.max > furthest.max) furthest = span;
		}
		const points = pointsByRun.get(runId) ?? [];
		points.sort((left, right) => left.along - right.along);
		for (const span of orderedSpans) {
			let index = lowerBoundBodyPoint(points, span.min - BODY_OVERLAP_EPSILON);
			while (
				index < points.length &&
				(points[index]?.along ?? Infinity) <= span.max + BODY_OVERLAP_EPSILON
			) {
				const point = points[index] as BodyPoint;
				if (point.equipmentGroupId !== span.equipmentGroupId) {
					reportStkPointOverlap(runId, span, point);
					break;
				}
				index++;
			}
		}
		for (const point of points) {
			const span = findOverlappingBodySpan(spanIndexByRun.get(runId), {
				min: point.along,
				max: point.along,
			});
			if (span) reportStkPointOverlap(runId, span, point);
		}
	}
	return Object.freeze(issues);
}

interface CoreRailRun {
	readonly id: number;
	readonly axis: "X" | "Z";
}

interface BodyPoint {
	readonly equipmentGroupId: number;
	readonly port: PortRecord;
	readonly along: number;
}

interface BodySpan {
	readonly equipmentGroupId: number;
	readonly min: number;
	readonly max: number;
	readonly portIds: readonly number[];
	readonly routes: readonly PortRouteIdentity[];
}

interface MutableBodyExtent {
	min: number;
	max: number;
	readonly portIds: number[];
	readonly routes: PortRouteIdentity[];
}

interface BodySpanIntervalIndex {
	readonly spans: readonly BodySpan[];
	readonly prefixMaxSpanIndexes: Int32Array;
}

function equipmentBodyExtentsByRun(
	group: EquipmentGroupRecord,
	portsById: ReadonlyMap<number, PortRecord>,
	runByRouteKey: ReadonlyMap<string, CoreRailRun>,
): ReadonlyMap<number, MutableBodyExtent> {
	const extents = new Map<number, MutableBodyExtent>();
	for (const portId of group.portIds) {
		const port = portsById.get(portId);
		if (!port || port.route.kind !== "CARDINAL_CELL") continue;
		const run = runByRouteKey.get(portRouteIdentityKey(port.route));
		if (!run) continue;
		const along = corePortAlongPosition(port, run.axis);
		const extent = extents.get(run.id);
		if (extent) {
			extent.min = Math.min(extent.min, along);
			extent.max = Math.max(extent.max, along);
			extent.portIds.push(port.id);
			extent.routes.push(port.route);
		} else {
			extents.set(run.id, {
				min: along,
				max: along,
				portIds: [port.id],
				routes: [port.route],
			});
		}
	}
	return extents;
}

function buildBodySpanIntervalIndex(source: readonly BodySpan[]): BodySpanIntervalIndex {
	const spans = [...source].sort(
		(left, right) =>
			left.min - right.min ||
			left.max - right.max ||
			left.equipmentGroupId - right.equipmentGroupId,
	);
	const prefixMaxSpanIndexes = new Int32Array(spans.length);
	let maximumIndex = 0;
	for (let index = 0; index < spans.length; index++) {
		if ((spans[index]?.max ?? -Infinity) > (spans[maximumIndex]?.max ?? -Infinity)) {
			maximumIndex = index;
		}
		prefixMaxSpanIndexes[index] = maximumIndex;
	}
	return Object.freeze({ spans: Object.freeze(spans), prefixMaxSpanIndexes });
}

function findOverlappingBodySpan(
	index: BodySpanIntervalIndex | undefined,
	extent: Pick<MutableBodyExtent, "min" | "max">,
): BodySpan | null {
	if (!index || index.spans.length === 0) return null;
	let low = 0;
	let high = index.spans.length;
	const maximumStart = extent.max + BODY_OVERLAP_EPSILON;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((index.spans[middle]?.min ?? Infinity) <= maximumStart) low = middle + 1;
		else high = middle;
	}
	if (low === 0) return null;
	const candidate = index.spans[index.prefixMaxSpanIndexes[low - 1] as number];
	return candidate && candidate.max >= extent.min - BODY_OVERLAP_EPSILON ? candidate : null;
}

function compileStraightRailRuns(map: TileMap): ReadonlyMap<string, CoreRailRun> {
	const routes: CardinalPortRoute[] = [];
	const rowByKey = new Map<string, number>();
	map.forEachRail((x, z, rail) => {
		if (
			rail.incoming === 0 ||
			rail.outgoing === 0 ||
			(rail.incoming & (rail.incoming - 1)) !== 0 ||
			(rail.outgoing & (rail.outgoing - 1)) !== 0 ||
			rail.outgoing !== oppositeDirection(rail.incoming as Direction)
		) {
			return;
		}
		const route: CardinalPortRoute = {
			kind: "CARDINAL_CELL",
			x,
			z,
			from: rail.incoming as Direction,
			to: rail.outgoing as Direction,
		};
		rowByKey.set(portRouteIdentityKey(route), routes.length);
		routes.push(route);
	});
	const parents = Int32Array.from({ length: routes.length }, (_, index) => index);
	for (let row = 0; row < routes.length; row++) {
		const route = routes[row] as CardinalPortRoute;
		const next = moveCell({ x: route.x, y: route.z }, route.to as Direction);
		const nextRow = rowByKey.get(portRouteIdentityKey({ ...route, x: next.x, z: next.y }));
		if (nextRow !== undefined) unionBodyRun(parents, row, nextRow);
	}
	const runIdByRoot = new Map<number, number>();
	const runByRouteKey = new Map<string, CoreRailRun>();
	for (let row = 0; row < routes.length; row++) {
		const route = routes[row] as CardinalPortRoute;
		const root = findBodyRun(parents, row);
		let runId = runIdByRoot.get(root);
		if (runId === undefined) {
			runId = runIdByRoot.size;
			runIdByRoot.set(root, runId);
		}
		const travel = moveCell({ x: 0, y: 0 }, route.to as Direction);
		runByRouteKey.set(
			portRouteIdentityKey(route),
			Object.freeze({ id: runId, axis: travel.x === 0 ? "Z" : "X" }),
		);
	}
	return runByRouteKey;
}

function corePortAlongPosition(port: PortRecord, axis: "X" | "Z"): number {
	if (port.route.kind !== "CARDINAL_CELL") return 0;
	const travel = moveCell({ x: 0, y: 0 }, port.route.to as Direction);
	const stationOffset = port.stationMillimeters / 1_000 - 0.5;
	const x = port.route.x + 0.5 + travel.x * stationOffset;
	const z = port.route.z + 0.5 + travel.y * stationOffset;
	return axis === "X" ? x : z;
}

function lowerBoundBodyPoint(points: readonly BodyPoint[], value: number): number {
	let low = 0;
	let high = points.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((points[middle]?.along ?? Infinity) < value) low = middle + 1;
		else high = middle;
	}
	return low;
}

function findBodyRun(parents: Int32Array, row: number): number {
	let root = row;
	while ((parents[root] as number) !== root) root = parents[root] as number;
	while ((parents[row] as number) !== row) {
		const next = parents[row] as number;
		parents[row] = root;
		row = next;
	}
	return root;
}

function unionBodyRun(parents: Int32Array, left: number, right: number): void {
	const leftRoot = findBodyRun(parents, left);
	const rightRoot = findBodyRun(parents, right);
	if (leftRoot === rightRoot) return;
	parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

export interface EquipmentBodyBounds {
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

const BODY_OVERLAP_EPSILON = 1e-6;

export function equipmentGroupBodyBounds(
	group: EquipmentGroupRecord,
	portsById: ReadonlyMap<number, PortRecord>,
): EquipmentBodyBounds | null {
	const ports = group.portIds
		.map((portId) => portsById.get(portId))
		.filter(Boolean) as PortRecord[];
	return equipmentPortsBodyBounds(ports);
}

export function equipmentPortsBodyBounds(ports: readonly PortRecord[]): EquipmentBodyBounds | null {
	const first = ports[0];
	if (!first || first.route.kind !== "CARDINAL_CELL" || first.route.to === 0) return null;
	const tangent = moveCell({ x: 0, y: 0 }, first.route.to);
	const normal = { x: -tangent.y, y: tangent.x };
	const origin = portWorldPosition(first);
	if (!origin) return null;
	let minAlong = Number.POSITIVE_INFINITY;
	let maxAlong = Number.NEGATIVE_INFINITY;
	let minAcross = Number.POSITIVE_INFINITY;
	let maxAcross = Number.NEGATIVE_INFINITY;
	for (const port of ports) {
		const world = portWorldPosition(port);
		if (!world) return null;
		const deltaX = world.x - origin.x;
		const deltaZ = world.z - origin.z;
		const along = deltaX * tangent.x + deltaZ * tangent.y;
		const across = deltaX * normal.x + deltaZ * normal.y;
		minAlong = Math.min(minAlong, along);
		maxAlong = Math.max(maxAlong, along);
		minAcross = Math.min(minAcross, across);
		maxAcross = Math.max(maxAcross, across);
	}
	const centerAlong = (minAlong + maxAlong) * 0.5;
	const centerAcross = (minAcross + maxAcross) * 0.5;
	const centerX = origin.x + tangent.x * centerAlong + normal.x * centerAcross;
	const centerZ = origin.z + tangent.y * centerAlong + normal.y * centerAcross;
	const halfLength = Math.max(0.34, (maxAlong - minAlong) * 0.5 + 0.5);
	const halfWidth = Math.max(0.28, (maxAcross - minAcross) * 0.5 + 0.45);
	const extentX = Math.abs(tangent.x) * halfLength + Math.abs(normal.x) * halfWidth;
	const extentZ = Math.abs(tangent.y) * halfLength + Math.abs(normal.y) * halfWidth;
	return {
		minX: centerX - extentX,
		minZ: centerZ - extentZ,
		maxX: centerX + extentX,
		maxZ: centerZ + extentZ,
	};
}

export function equipmentBodyBoundsOverlap(
	left: EquipmentBodyBounds,
	right: EquipmentBodyBounds,
): boolean {
	return (
		Math.max(left.minX, right.minX) < Math.min(left.maxX, right.maxX) - BODY_OVERLAP_EPSILON &&
		Math.max(left.minZ, right.minZ) < Math.min(left.maxZ, right.maxZ) - BODY_OVERLAP_EPSILON
	);
}

function portWorldPosition(port: PortRecord): { readonly x: number; readonly z: number } | null {
	const route = port.route;
	if (route.kind !== "CARDINAL_CELL" || route.to === 0) return null;
	const tangent = moveCell({ x: 0, y: 0 }, route.to);
	const normal = { x: -tangent.y, y: tangent.x };
	const sideSign = port.side === "LEFT" ? 1 : port.side === "RIGHT" ? -1 : 0;
	const stationOffset = port.stationMillimeters / 1_000 - 0.5;
	const lateralOffset = (port.lateralOffsetMillimeters / 1_000) * sideSign;
	return {
		x: route.x + 0.5 + tangent.x * stationOffset + normal.x * lateralOffset,
		z: route.z + 0.5 + tangent.y * stationOffset + normal.y * lateralOffset,
	};
}

function collectStkEquipmentLayoutIssues(
	map: TileMap,
	group: StkEquipmentGroup,
	portsById: ReadonlyMap<number, PortRecord>,
): readonly PortEquipmentLayoutIssue[] {
	const issues: PortEquipmentLayoutIssue[] = [];
	const ports: PortRecord[] = [];
	for (const portId of group.portIds) {
		const port = portsById.get(portId);
		if (!port) {
			issues.push(
				createLayoutIssue({
					code: "STK_PORT_MISSING",
					message: equipmentGroupMessage(group.id, `STK port ${portId} is missing`),
					portIds: [portId],
					equipmentGroupIds: [group.id],
				}),
			);
			continue;
		}
		if (port.route.kind !== "CARDINAL_CELL") {
			issues.push(
				createLayoutIssue({
					code: "STK_PORT_ROUTE_NOT_CARDINAL",
					message: equipmentGroupMessage(
						group.id,
						`STK port ${port.id} must attach to a cardinal rail cell`,
					),
					portIds: [port.id],
					equipmentGroupIds: [group.id],
					routes: [port.route],
				}),
			);
			continue;
		}
		ports.push(port);
	}
	if (ports.length === group.portIds.length) {
		const analysis = analyzeStkPortLayout(
			ports.map((port) => {
				const route = port.route as CardinalPortRoute;
				return {
					id: port.id,
					x: route.x,
					z: route.z,
					from: route.from,
					to: route.to,
					side: port.side,
					lateralOffsetMillimeters: port.lateralOffsetMillimeters,
					direction: port.direction,
				};
			}),
			group.template,
		);
		if (!analysis.valid) {
			issues.push(
				createLayoutIssue({
					code: "STK_LAYOUT_GRAMMAR",
					message: equipmentGroupMessage(group.id, analysis.reason),
					portIds: ports.map((port) => port.id),
					equipmentGroupIds: [group.id],
					routes: ports.map((port) => port.route),
				}),
			);
		} else if (
			analysis.orderedIds.length !== group.portIds.length ||
			analysis.orderedIds.some((portId, index) => portId !== group.portIds[index])
		) {
			issues.push(
				createLayoutIssue({
					code: "STK_PORT_ORDER",
					message: equipmentGroupMessage(
						group.id,
						"STK port IDs are not in canonical lane and travel order",
					),
					portIds: [...group.portIds],
					equipmentGroupIds: [group.id],
					routes: ports.map((port) => port.route),
				}),
			);
		}
	}
	for (const port of ports) {
		const route = port.route as CardinalPortRoute;
		if (
			route.from === 0 ||
			route.to === 0 ||
			!isExactDirectedCell(map, route.x, route.z, route.from, route.to)
		) {
			if (portRouteExists(map, port.route)) {
				issues.push(
					createLayoutIssue({
						code: "STK_PORT_RAIL_DISCONTINUITY",
						message: equipmentGroupMessage(
							group.id,
							`STK port ${port.id} is not on an uninterrupted straight rail cell`,
						),
						portIds: [port.id],
						equipmentGroupIds: [group.id],
						routes: [port.route],
					}),
				);
			}
		}
		if (group.template === "FLEX") {
			if (port.stationMillimeters !== 500) {
				issues.push(
					createLayoutIssue({
						code: "STK_PORT_STATION",
						message: equipmentGroupMessage(
							group.id,
							`FLEX STK port ${port.id} must use the 500 mm cell-center station`,
						),
						portIds: [port.id],
						equipmentGroupIds: [group.id],
						routes: [port.route],
						measurement: {
							measured: port.stationMillimeters,
							required: 500,
							unit: "MILLIMETERS",
							relation: "EXACT",
						},
					}),
				);
			}
			if (route.from === 0 || route.to === 0) continue;
			const entry = moveCell({ x: route.x, y: route.z }, route.from as Direction);
			const exit = moveCell({ x: route.x, y: route.z }, route.to as Direction);
			if (
				!isExactDirectedCell(map, entry.x, entry.y, route.from, route.to) ||
				!isExactDirectedCell(map, exit.x, exit.y, route.from, route.to)
			) {
				issues.push(
					createLayoutIssue({
						code: "STK_PORT_APPROACH",
						message: equipmentGroupMessage(
							group.id,
							`FLEX STK port ${port.id} requires one safe straight approach cell on both sides`,
						),
						portIds: [port.id],
						equipmentGroupIds: [group.id],
						routes: [port.route],
						cells: [
							{ x: entry.x, z: entry.y },
							{ x: exit.x, z: exit.y },
						],
					}),
				);
			}
		}
	}
	return Object.freeze(issues);
}

export function assertPortEquipmentLayout(map: TileMap, state: PortEquipmentState): void {
	const error = portEquipmentLayoutError(map, state);
	if (error) throw new Error(`Port equipment layout is invalid: ${error}.`);
}

type PortEquipmentValidationOperation = () => Promise<void>;

/**
 * Validate one exact port/equipment generation without monopolizing the caller's event loop.
 *
 * Unlike the diagnostic collectors, this activation guard is fail-fast and performs the complete
 * reciprocal-record, directed-route, group grammar, spacing, and body-reservation contract. Large
 * straight-run discovery and interval sorting are split into caller-controlled operation slices.
 */
export async function assertPortEquipmentLayoutCooperatively(
	map: TileMap,
	state: PortEquipmentState,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<void> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Port equipment validation operation budget must be positive.");
	}
	const mapRevision = map.getRevision();
	const mapMutationGeneration = map.getMutationGeneration();
	let operations = 0;
	const consumeOperation: PortEquipmentValidationOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
		assertStablePortEquipmentMapRevision(map, mapRevision, mapMutationGeneration);
	};
	const portsById = await validatePortEquipmentIntegrityCooperatively(state, consumeOperation);

	for (const port of state.ports) {
		if (!portRouteExists(map, port.route)) {
			throwInvalidPortEquipmentLayout(
				`port ${port.id} route does not exist in the authored rail map`,
			);
		}
		await consumeOperation();
	}
	for (const group of state.equipmentGroups) {
		const error =
			group.kind === "EQ"
				? await eqEquipmentLayoutErrorCooperatively(map, group, portsById, consumeOperation)
				: group.kind === "STK"
					? await stkEquipmentLayoutErrorCooperatively(map, group, portsById, consumeOperation)
					: null;
		if (error) throwInvalidPortEquipmentLayout(equipmentGroupMessage(group.id, error));
		await consumeOperation();
	}
	const spacingError = await portEquipmentSpacingErrorCooperatively(state, consumeOperation);
	if (spacingError) throwInvalidPortEquipmentLayout(spacingError);
	const bodyError = await portEquipmentBodyOverlapErrorCooperatively(
		map,
		state,
		portsById,
		consumeOperation,
	);
	if (bodyError) throwInvalidPortEquipmentLayout(bodyError);

	await checkpoint();
	assertStablePortEquipmentMapRevision(map, mapRevision, mapMutationGeneration);
}

async function validatePortEquipmentIntegrityCooperatively(
	state: PortEquipmentState,
	consumeOperation: PortEquipmentValidationOperation,
): Promise<ReadonlyMap<number, PortRecord>> {
	if (!isValidPortEquipmentCursor(state.nextPortId)) {
		throwInvalidPortEquipmentLayout("next port id cursor is outside the signed-int32 range");
	}
	if (!isValidPortEquipmentCursor(state.nextEquipmentGroupId)) {
		throwInvalidPortEquipmentLayout(
			"next equipment group id cursor is outside the signed-int32 range",
		);
	}
	const portsById = new Map<number, PortRecord>();
	const portIdByBarcode = new Map<string, number>();
	let previousPortId = 0;
	for (const port of state.ports) {
		const error = portRecordError(port);
		if (error) throwInvalidPortEquipmentLayout(`port ${port.id}: ${error}`);
		if (port.id <= previousPortId) {
			throwInvalidPortEquipmentLayout(
				"ports must be stored once each in strictly increasing ID order",
			);
		}
		if (port.barcode !== null) {
			const existingPortId = portIdByBarcode.get(port.barcode);
			if (existingPortId !== undefined) {
				throwInvalidPortEquipmentLayout(
					`duplicate port barcode ${port.barcode} on ports ${existingPortId} and ${port.id}`,
				);
			}
			portIdByBarcode.set(port.barcode, port.id);
		}
		portsById.set(port.id, port);
		previousPortId = port.id;
		await consumeOperation();
	}
	if (state.nextPortId <= previousPortId) {
		throwInvalidPortEquipmentLayout("next port id cursor must exceed every port id");
	}

	const groupsById = new Map<number, EquipmentGroupRecord>();
	const claimedPorts = new Set<number>();
	let previousGroupId = 0;
	for (const group of state.equipmentGroups) {
		const error = equipmentGroupError(group);
		if (error) throwInvalidPortEquipmentLayout(`equipment group ${group.id}: ${error}`);
		if (group.id <= previousGroupId) {
			throwInvalidPortEquipmentLayout(
				"equipment groups must be stored once each in strictly increasing ID order",
			);
		}
		groupsById.set(group.id, group);
		previousGroupId = group.id;
		for (const portId of group.portIds) {
			const port = portsById.get(portId);
			if (!port) {
				throwInvalidPortEquipmentLayout(
					`equipment group ${group.id} references missing port ${portId}`,
				);
			}
			if (claimedPorts.has(portId)) {
				throwInvalidPortEquipmentLayout(`port ${portId} belongs to more than one equipment group`);
			}
			if (port.equipmentGroupId !== group.id) {
				throwInvalidPortEquipmentLayout(
					`port ${portId} does not point back to equipment group ${group.id}`,
				);
			}
			if (port.portType !== group.kind) {
				throwInvalidPortEquipmentLayout(
					`port ${portId} type does not match equipment group ${group.id}`,
				);
			}
			claimedPorts.add(portId);
			await consumeOperation();
		}
		await consumeOperation();
	}
	if (state.nextEquipmentGroupId <= previousGroupId) {
		throwInvalidPortEquipmentLayout(
			"next equipment group id cursor must exceed every equipment group id",
		);
	}
	for (const port of state.ports) {
		if (!groupsById.has(port.equipmentGroupId)) {
			throwInvalidPortEquipmentLayout(
				`port ${port.id} references missing equipment group ${port.equipmentGroupId}`,
			);
		}
		if (!claimedPorts.has(port.id)) {
			throwInvalidPortEquipmentLayout(`port ${port.id} is not owned by its equipment group`);
		}
		await consumeOperation();
	}
	return portsById;
}

async function eqEquipmentLayoutErrorCooperatively(
	map: TileMap,
	group: EqEquipmentGroup,
	portsById: ReadonlyMap<number, PortRecord>,
	consumeOperation: PortEquipmentValidationOperation,
): Promise<string | null> {
	const first = portsById.get(group.portIds[0] as number);
	if (!first) return "first EQ port is missing";
	const firstRoute = first.route;
	if (firstRoute.kind !== "CARDINAL_CELL" || firstRoute.from === 0 || firstRoute.to === 0) {
		return "EQ ports must attach to cardinal through routes";
	}
	if (firstRoute.to !== oppositeDirection(firstRoute.from)) {
		return "EQ ports must attach to straight cardinal routes";
	}
	const travel = moveCell({ x: 0, y: 0 }, firstRoute.to as Direction);
	const pitchCells = group.pitchMillimeters / 1_000;
	const equipmentDirection = first.direction;
	let previousX = firstRoute.x;
	let previousZ = firstRoute.z;
	for (let index = 0; index < group.portIds.length; index++) {
		const port = portsById.get(group.portIds[index] as number);
		if (!port) return `EQ port ${group.portIds[index]} is missing`;
		if (port.side !== "CENTER" || port.lateralOffsetMillimeters !== 0) {
			return `EQ port ${port.id} must be a zero-offset CENTER port`;
		}
		if (port.direction !== equipmentDirection) {
			return `EQ port ${port.id} must preserve one equipment-facing direction`;
		}
		const route = port.route;
		if (
			route.kind !== "CARDINAL_CELL" ||
			route.from !== firstRoute.from ||
			route.to !== firstRoute.to ||
			(travel.x !== 0 ? route.z !== firstRoute.z : route.x !== firstRoute.x)
		) {
			return `EQ port ${port.id} must share one directed cardinal lane`;
		}
		if (!isExactDirectedCell(map, route.x, route.z, firstRoute.from, firstRoute.to)) {
			return `EQ port ${port.id} is not on an uninterrupted straight rail cell`;
		}
		await consumeOperation();
		if (index === 0) continue;
		const expectedX = previousX + travel.x * pitchCells;
		const expectedZ = previousZ + travel.y * pitchCells;
		if (route.x !== expectedX || route.z !== expectedZ) {
			return `EQ ports must be ordered at the configured ${pitchCells} m pitch`;
		}
		for (let step = 1; step < pitchCells; step++) {
			const x = previousX + travel.x * step;
			const z = previousZ + travel.y * step;
			if (!isExactDirectedCell(map, x, z, firstRoute.from, firstRoute.to)) {
				return `EQ pitch crosses a gap, curve, endpoint, or junction at ${x},${z}`;
			}
			await consumeOperation();
		}
		previousX = route.x;
		previousZ = route.z;
	}
	return null;
}

async function stkEquipmentLayoutErrorCooperatively(
	map: TileMap,
	group: StkEquipmentGroup,
	portsById: ReadonlyMap<number, PortRecord>,
	consumeOperation: PortEquipmentValidationOperation,
): Promise<string | null> {
	const ports: PortRecord[] = [];
	for (const portId of group.portIds) {
		const port = portsById.get(portId);
		if (!port) return `STK port ${portId} is missing`;
		if (port.route.kind !== "CARDINAL_CELL") {
			return `STK port ${port.id} must attach to a cardinal rail cell`;
		}
		ports.push(port);
		await consumeOperation();
	}
	const analysis = analyzeStkPortLayout(
		ports.map((port) => {
			const route = port.route;
			if (route.kind !== "CARDINAL_CELL") throw new Error("STK route narrowed above.");
			return {
				id: port.id,
				x: route.x,
				z: route.z,
				from: route.from,
				to: route.to,
				side: port.side,
				lateralOffsetMillimeters: port.lateralOffsetMillimeters,
				direction: port.direction,
			};
		}),
		group.template,
	);
	if (!analysis.valid) return analysis.reason;
	if (
		analysis.orderedIds.length !== group.portIds.length ||
		analysis.orderedIds.some((portId, index) => portId !== group.portIds[index])
	) {
		return "STK port IDs are not in canonical lane and travel order";
	}
	for (const port of ports) {
		const route = port.route;
		if (
			route.kind !== "CARDINAL_CELL" ||
			route.from === 0 ||
			route.to === 0 ||
			!isExactDirectedCell(map, route.x, route.z, route.from, route.to)
		) {
			return `STK port ${port.id} is not on an uninterrupted straight rail cell`;
		}
		if (group.template === "FLEX") {
			if (port.stationMillimeters !== 500) {
				return `FLEX STK port ${port.id} must use the 500 mm cell-center station`;
			}
			const entry = moveCell({ x: route.x, y: route.z }, route.from as Direction);
			const exit = moveCell({ x: route.x, y: route.z }, route.to as Direction);
			if (
				!isExactDirectedCell(map, entry.x, entry.y, route.from, route.to) ||
				!isExactDirectedCell(map, exit.x, exit.y, route.from, route.to)
			) {
				return `FLEX STK port ${port.id} requires one safe straight approach cell on both sides`;
			}
		}
		await consumeOperation();
	}
	return null;
}

async function portEquipmentSpacingErrorCooperatively(
	state: PortEquipmentState,
	consumeOperation: PortEquipmentValidationOperation,
): Promise<string | null> {
	const minimumSpacingMeters = OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS / 1_000;
	const buckets = new Map<string, PortWorldPoint[]>();
	const exactSlots = new Map<string, number>();
	for (const port of state.ports) {
		const exactKey = `${portRouteIdentityKey(port.route)}:${port.stationMillimeters}:${port.side}`;
		const existingPortId = exactSlots.get(exactKey);
		if (existingPortId !== undefined) {
			return `ports ${existingPortId} and ${port.id} occupy the same authored station`;
		}
		exactSlots.set(exactKey, port.id);
		const world = portWorldPosition(port);
		if (world) {
			const bucketX = Math.floor(world.x / minimumSpacingMeters);
			const bucketZ = Math.floor(world.z / minimumSpacingMeters);
			for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
				for (let deltaX = -1; deltaX <= 1; deltaX++) {
					const bucket = buckets.get(`${bucketX + deltaX}:${bucketZ + deltaZ}`);
					if (!bucket) continue;
					for (const existing of bucket) {
						if (
							Math.hypot(existing.x - world.x, existing.z - world.z) <
							minimumSpacingMeters - BODY_OVERLAP_EPSILON
						) {
							return `ports ${existing.port.id} and ${port.id} are closer than ${OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS} mm`;
						}
						await consumeOperation();
					}
				}
			}
			const key = `${bucketX}:${bucketZ}`;
			const bucket = buckets.get(key);
			const point = { port, x: world.x, z: world.z };
			if (bucket) bucket.push(point);
			else buckets.set(key, [point]);
		}
		await consumeOperation();
	}
	return null;
}

async function portEquipmentBodyOverlapErrorCooperatively(
	map: TileMap,
	state: PortEquipmentState,
	portsById: ReadonlyMap<number, PortRecord>,
	consumeOperation: PortEquipmentValidationOperation,
): Promise<string | null> {
	let hasStk = false;
	for (const group of state.equipmentGroups) {
		if (group.kind === "STK") {
			hasStk = true;
			break;
		}
		await consumeOperation();
	}
	if (!hasStk) return null;

	const runByRouteKey = await compileRelevantStraightRailRunsCooperatively(
		map,
		state,
		consumeOperation,
	);
	const pointsByRun = new Map<number, BodyPoint[]>();
	for (const port of state.ports) {
		if (port.portType === "OHB" && port.route.kind === "CARDINAL_CELL") {
			const run = runByRouteKey.get(portRouteIdentityKey(port.route));
			if (run) {
				const point = {
					equipmentGroupId: port.equipmentGroupId,
					port,
					along: corePortAlongPosition(port, run.axis),
				};
				const points = pointsByRun.get(run.id);
				if (points) points.push(point);
				else pointsByRun.set(run.id, [point]);
			}
		}
		await consumeOperation();
	}

	const spansByRun = new Map<number, BodySpan[]>();
	for (const group of state.equipmentGroups) {
		if (group.kind !== "STK") {
			await consumeOperation();
			continue;
		}
		const extents = await equipmentBodyExtentsByRunCooperatively(
			group,
			portsById,
			runByRouteKey,
			consumeOperation,
		);
		for (const [runId, extent] of extents) {
			const span: BodySpan = {
				equipmentGroupId: group.id,
				min: extent.min,
				max: extent.max,
				portIds: extent.portIds,
				routes: extent.routes,
			};
			const spans = spansByRun.get(runId);
			if (spans) spans.push(span);
			else spansByRun.set(runId, [span]);
			await consumeOperation();
		}
	}
	const spanIndexByRun = new Map<number, BodySpanIntervalIndex>();
	for (const [runId, spans] of spansByRun) {
		spanIndexByRun.set(
			runId,
			await buildBodySpanIntervalIndexCooperatively(spans, consumeOperation),
		);
		await consumeOperation();
	}

	for (const group of state.equipmentGroups) {
		if (group.kind !== "EQ") {
			await consumeOperation();
			continue;
		}
		const extents = await equipmentBodyExtentsByRunCooperatively(
			group,
			portsById,
			runByRouteKey,
			consumeOperation,
		);
		for (const [runId, extent] of extents) {
			const stkSpan = findOverlappingBodySpan(spanIndexByRun.get(runId), extent);
			if (stkSpan) {
				return `EQ group ${group.id} body crosses STK group ${stkSpan.equipmentGroupId} reservation`;
			}
			await consumeOperation();
		}
	}

	for (const [runId, spanIndex] of spanIndexByRun) {
		const spans = spanIndex.spans;
		let furthest: BodySpan | null = null;
		for (const span of spans) {
			if (
				furthest &&
				furthest.equipmentGroupId !== span.equipmentGroupId &&
				span.min <= furthest.max + BODY_OVERLAP_EPSILON
			) {
				return `STK group ${span.equipmentGroupId} reservation overlaps equipment group ${furthest.equipmentGroupId}`;
			}
			if (!furthest || span.max > furthest.max) furthest = span;
			await consumeOperation();
		}
		const points = await stableSortCooperatively(
			pointsByRun.get(runId) ?? [],
			(left, right) => left.along - right.along,
			consumeOperation,
		);
		for (const span of spans) {
			let index = lowerBoundBodyPoint(points, span.min - BODY_OVERLAP_EPSILON);
			while (
				index < points.length &&
				(points[index]?.along ?? Infinity) <= span.max + BODY_OVERLAP_EPSILON
			) {
				const point = points[index] as BodyPoint;
				if (point.equipmentGroupId !== span.equipmentGroupId) {
					return `STK group ${span.equipmentGroupId} reservation crosses equipment group ${point.equipmentGroupId}`;
				}
				index++;
				await consumeOperation();
			}
		}
	}
	return null;
}

async function compileRelevantStraightRailRunsCooperatively(
	map: TileMap,
	state: PortEquipmentState,
	consumeOperation: PortEquipmentValidationOperation,
): Promise<ReadonlyMap<string, CoreRailRun>> {
	const relevantRouteKeys = new Set<string>();
	for (const port of state.ports) {
		if (port.route.kind === "CARDINAL_CELL") {
			relevantRouteKeys.add(portRouteIdentityKey(port.route));
		}
		await consumeOperation();
	}
	const runByRouteKey = new Map<string, CoreRailRun>();
	let nextRunId = 0;
	for (const port of state.ports) {
		const route = port.route;
		if (
			route.kind !== "CARDINAL_CELL" ||
			route.from === 0 ||
			route.to === 0 ||
			route.to !== oppositeDirection(route.from) ||
			runByRouteKey.has(portRouteIdentityKey(route)) ||
			!isExactDirectedCell(map, route.x, route.z, route.from, route.to)
		) {
			await consumeOperation();
			continue;
		}
		let startX = route.x;
		let startZ = route.z;
		while (true) {
			const previous = moveCell({ x: startX, y: startZ }, route.from);
			await consumeOperation();
			if (!isExactDirectedCell(map, previous.x, previous.y, route.from, route.to)) break;
			startX = previous.x;
			startZ = previous.y;
		}
		const travel = moveCell({ x: 0, y: 0 }, route.to);
		const run = Object.freeze({
			id: nextRunId++,
			axis: travel.x === 0 ? ("Z" as const) : ("X" as const),
		});
		let x = startX;
		let z = startZ;
		while (isExactDirectedCell(map, x, z, route.from, route.to)) {
			const key = portRouteIdentityKey({
				kind: "CARDINAL_CELL",
				x,
				z,
				from: route.from,
				to: route.to,
			});
			if (relevantRouteKeys.has(key)) runByRouteKey.set(key, run);
			x += travel.x;
			z += travel.y;
			await consumeOperation();
		}
	}
	return runByRouteKey;
}

async function equipmentBodyExtentsByRunCooperatively(
	group: EquipmentGroupRecord,
	portsById: ReadonlyMap<number, PortRecord>,
	runByRouteKey: ReadonlyMap<string, CoreRailRun>,
	consumeOperation: PortEquipmentValidationOperation,
): Promise<ReadonlyMap<number, MutableBodyExtent>> {
	const extents = new Map<number, MutableBodyExtent>();
	for (const portId of group.portIds) {
		const port = portsById.get(portId);
		if (port?.route.kind === "CARDINAL_CELL") {
			const run = runByRouteKey.get(portRouteIdentityKey(port.route));
			if (run) {
				const along = corePortAlongPosition(port, run.axis);
				const extent = extents.get(run.id);
				if (extent) {
					extent.min = Math.min(extent.min, along);
					extent.max = Math.max(extent.max, along);
					extent.portIds.push(port.id);
					extent.routes.push(port.route);
				} else {
					extents.set(run.id, {
						min: along,
						max: along,
						portIds: [port.id],
						routes: [port.route],
					});
				}
			}
		}
		await consumeOperation();
	}
	return extents;
}

async function buildBodySpanIntervalIndexCooperatively(
	source: readonly BodySpan[],
	consumeOperation: PortEquipmentValidationOperation,
): Promise<BodySpanIntervalIndex> {
	const spans = await stableSortCooperatively(
		source,
		(left, right) =>
			left.min - right.min ||
			left.max - right.max ||
			left.equipmentGroupId - right.equipmentGroupId,
		consumeOperation,
	);
	const prefixMaxSpanIndexes = new Int32Array(spans.length);
	let maximumIndex = 0;
	for (let index = 0; index < spans.length; index++) {
		if ((spans[index]?.max ?? -Infinity) > (spans[maximumIndex]?.max ?? -Infinity)) {
			maximumIndex = index;
		}
		prefixMaxSpanIndexes[index] = maximumIndex;
		await consumeOperation();
	}
	return Object.freeze({ spans: Object.freeze(spans), prefixMaxSpanIndexes });
}

async function stableSortCooperatively<T>(
	source: readonly T[],
	compare: (left: T, right: T) => number,
	consumeOperation: PortEquipmentValidationOperation,
): Promise<T[]> {
	const length = source.length;
	let input = new Array<T>(length);
	let output = new Array<T>(length);
	for (let index = 0; index < length; index++) {
		input[index] = source[index] as T;
		await consumeOperation();
	}
	for (let width = 1; width < length; width *= 2) {
		for (let start = 0; start < length; start += width * 2) {
			const middle = Math.min(start + width, length);
			const end = Math.min(start + width * 2, length);
			let left = start;
			let right = middle;
			let target = start;
			while (left < middle || right < end) {
				if (right >= end || (left < middle && compare(input[left] as T, input[right] as T) <= 0)) {
					output[target++] = input[left++] as T;
				} else {
					output[target++] = input[right++] as T;
				}
				await consumeOperation();
			}
		}
		[input, output] = [output, input];
	}
	return input;
}

function throwInvalidPortEquipmentLayout(error: string): never {
	throw new Error(`Port equipment layout is invalid: ${error}.`);
}

function assertStablePortEquipmentMapRevision(
	map: TileMap,
	expectedRevision: number,
	expectedMutationGeneration: number,
): void {
	if (
		map.getRevision() !== expectedRevision ||
		map.getMutationGeneration() !== expectedMutationGeneration
	) {
		throw new Error("Port equipment activation map changed during cooperative validation.");
	}
}

function isValidPortEquipmentCursor(value: number): boolean {
	return Number.isInteger(value) && value >= 1 && value <= 0x8000_0000;
}

export function portRouteExists(map: TileMap, route: PortRouteIdentity): boolean {
	if (route.kind === "ADVANCED_SWITCH_SEGMENT") {
		const record = map.getAdvancedSwitch(route.switchId);
		return record !== undefined && record.profileClass === route.profileClass;
	}
	const rail = decodeRailCell(map.getEncoded(route.x, route.z));
	if (route.from === 0) return rail.incoming === 0 && rail.outgoing === route.to;
	if (route.to === 0) return rail.outgoing === 0 && rail.incoming === route.from;
	return (rail.incoming & route.from) !== 0 && (rail.outgoing & route.to) !== 0;
}

function eqEquipmentLayoutError(
	map: TileMap,
	group: EqEquipmentGroup,
	portsById: ReadonlyMap<number, PortRecord>,
): string | null {
	const first = portsById.get(group.portIds[0] as number);
	if (!first) return "first EQ port is missing";
	const firstRoute = first.route;
	if (firstRoute.kind !== "CARDINAL_CELL" || firstRoute.from === 0 || firstRoute.to === 0) {
		return "EQ ports must attach to cardinal through routes";
	}
	if (firstRoute.to !== oppositeDirection(firstRoute.from)) {
		return "EQ ports must attach to straight cardinal routes";
	}
	const travel = moveCell({ x: 0, y: 0 }, firstRoute.to as Direction);
	const pitchCells = group.pitchMillimeters / 1_000;
	const equipmentDirection = first.direction;
	let previousX = firstRoute.x;
	let previousZ = firstRoute.z;
	for (let index = 0; index < group.portIds.length; index++) {
		const port = portsById.get(group.portIds[index] as number);
		if (!port) return `EQ port ${group.portIds[index]} is missing`;
		if (port.side !== "CENTER" || port.lateralOffsetMillimeters !== 0) {
			return `EQ port ${port.id} must be a zero-offset CENTER port`;
		}
		if (port.direction !== equipmentDirection) {
			return `EQ port ${port.id} must preserve one equipment-facing direction`;
		}
		const route = port.route;
		if (
			route.kind !== "CARDINAL_CELL" ||
			route.from !== firstRoute.from ||
			route.to !== firstRoute.to ||
			(travel.x !== 0 ? route.z !== firstRoute.z : route.x !== firstRoute.x)
		) {
			return `EQ port ${port.id} must share one directed cardinal lane`;
		}
		if (!isExactDirectedCell(map, route.x, route.z, firstRoute.from, firstRoute.to)) {
			return `EQ port ${port.id} is not on an uninterrupted straight rail cell`;
		}
		if (index === 0) continue;
		const expectedX = previousX + travel.x * pitchCells;
		const expectedZ = previousZ + travel.y * pitchCells;
		if (route.x !== expectedX || route.z !== expectedZ) {
			return `EQ ports must be ordered at the configured ${pitchCells} m pitch`;
		}
		for (let step = 1; step < pitchCells; step++) {
			const x = previousX + travel.x * step;
			const z = previousZ + travel.y * step;
			if (!isExactDirectedCell(map, x, z, firstRoute.from, firstRoute.to)) {
				return `EQ pitch crosses a gap, curve, endpoint, or junction at ${x},${z}`;
			}
		}
		previousX = route.x;
		previousZ = route.z;
	}
	return null;
}

function stkEquipmentLayoutError(
	map: TileMap,
	group: StkEquipmentGroup,
	portsById: ReadonlyMap<number, PortRecord>,
): string | null {
	const ports: PortRecord[] = [];
	for (const portId of group.portIds) {
		const port = portsById.get(portId);
		if (!port) return `STK port ${portId} is missing`;
		if (port.route.kind !== "CARDINAL_CELL") {
			return `STK port ${port.id} must attach to a cardinal rail cell`;
		}
		ports.push(port);
	}
	const analysis = analyzeStkPortLayout(
		ports.map((port) => {
			const route = port.route;
			if (route.kind !== "CARDINAL_CELL") throw new Error("STK route narrowed above.");
			return {
				id: port.id,
				x: route.x,
				z: route.z,
				from: route.from,
				to: route.to,
				side: port.side,
				lateralOffsetMillimeters: port.lateralOffsetMillimeters,
				direction: port.direction,
			};
		}),
		group.template,
	);
	if (!analysis.valid) return analysis.reason;
	if (
		analysis.orderedIds.length !== group.portIds.length ||
		analysis.orderedIds.some((portId, index) => portId !== group.portIds[index])
	) {
		return "STK port IDs are not in canonical lane and travel order";
	}
	for (const port of ports) {
		const route = port.route;
		if (
			route.kind !== "CARDINAL_CELL" ||
			route.from === 0 ||
			route.to === 0 ||
			!isExactDirectedCell(map, route.x, route.z, route.from, route.to)
		) {
			return `STK port ${port.id} is not on an uninterrupted straight rail cell`;
		}
		if (group.template === "FLEX") {
			if (port.stationMillimeters !== 500) {
				return `FLEX STK port ${port.id} must use the 500 mm cell-center station`;
			}
			const entry = moveCell({ x: route.x, y: route.z }, route.from as Direction);
			const exit = moveCell({ x: route.x, y: route.z }, route.to as Direction);
			if (
				!isExactDirectedCell(map, entry.x, entry.y, route.from, route.to) ||
				!isExactDirectedCell(map, exit.x, exit.y, route.from, route.to)
			) {
				return `FLEX STK port ${port.id} requires one safe straight approach cell on both sides`;
			}
		}
	}
	return null;
}

function collectEqEquipmentLayoutIssues(
	map: TileMap,
	group: EqEquipmentGroup,
	portsById: ReadonlyMap<number, PortRecord>,
): readonly PortEquipmentLayoutIssue[] {
	const issues: PortEquipmentLayoutIssue[] = [];
	const first = portsById.get(group.portIds[0] as number);
	if (!first) {
		issues.push(
			createLayoutIssue({
				code: "EQ_FIRST_PORT_MISSING",
				message: equipmentGroupMessage(group.id, "first EQ port is missing"),
				portIds: [group.portIds[0] as number],
				equipmentGroupIds: [group.id],
			}),
		);
		for (let index = 1; index < group.portIds.length; index++) {
			const portId = group.portIds[index] as number;
			if (portsById.has(portId)) continue;
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_MISSING",
					message: equipmentGroupMessage(group.id, `EQ port ${portId} is missing`),
					portIds: [portId],
					equipmentGroupIds: [group.id],
				}),
			);
		}
		return Object.freeze(issues);
	}
	const firstRoute = first.route;
	if (firstRoute.kind !== "CARDINAL_CELL" || firstRoute.from === 0 || firstRoute.to === 0) {
		issues.push(
			createLayoutIssue({
				code: "EQ_ROUTE_NOT_THROUGH",
				message: equipmentGroupMessage(group.id, "EQ ports must attach to cardinal through routes"),
				portIds: [first.id],
				equipmentGroupIds: [group.id],
				routes: [first.route],
			}),
		);
		collectEqBasicPortIssues(group, portsById, first.direction, issues);
		return Object.freeze(issues);
	}
	if (firstRoute.to !== oppositeDirection(firstRoute.from)) {
		issues.push(
			createLayoutIssue({
				code: "EQ_ROUTE_NOT_STRAIGHT",
				message: equipmentGroupMessage(
					group.id,
					"EQ ports must attach to straight cardinal routes",
				),
				portIds: [first.id],
				equipmentGroupIds: [group.id],
				routes: [first.route],
			}),
		);
		collectEqBasicPortIssues(group, portsById, first.direction, issues);
		return Object.freeze(issues);
	}
	const travel = moveCell({ x: 0, y: 0 }, firstRoute.to as Direction);
	const pitchCells = group.pitchMillimeters / 1_000;
	const equipmentDirection = first.direction;
	let previousX = firstRoute.x;
	let previousZ = firstRoute.z;
	let previousPortId = first.id;
	let pitchComparisonReady = true;
	for (let index = 0; index < group.portIds.length; index++) {
		const portId = group.portIds[index] as number;
		const port = portsById.get(portId);
		if (!port) {
			pitchComparisonReady = false;
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_MISSING",
					message: equipmentGroupMessage(group.id, `EQ port ${portId} is missing`),
					portIds: [portId],
					equipmentGroupIds: [group.id],
				}),
			);
			continue;
		}
		if (port.side !== "CENTER" || port.lateralOffsetMillimeters !== 0) {
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_SIDE_OFFSET",
					message: equipmentGroupMessage(
						group.id,
						`EQ port ${port.id} must be a zero-offset CENTER port`,
					),
					portIds: [port.id],
					equipmentGroupIds: [group.id],
					routes: [port.route],
					measurement: {
						measured: port.lateralOffsetMillimeters,
						required: 0,
						unit: "MILLIMETERS",
						relation: "EXACT",
					},
				}),
			);
		}
		if (port.direction !== equipmentDirection) {
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_DIRECTION",
					message: equipmentGroupMessage(
						group.id,
						`EQ port ${port.id} must preserve one equipment-facing direction`,
					),
					portIds: [first.id, port.id],
					equipmentGroupIds: [group.id],
					routes: [first.route, port.route],
				}),
			);
		}
		const route = port.route;
		if (
			route.kind !== "CARDINAL_CELL" ||
			route.from !== firstRoute.from ||
			route.to !== firstRoute.to ||
			(travel.x !== 0 ? route.z !== firstRoute.z : route.x !== firstRoute.x)
		) {
			pitchComparisonReady = false;
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_LANE",
					message: equipmentGroupMessage(
						group.id,
						`EQ port ${port.id} must share one directed cardinal lane`,
					),
					portIds: [first.id, port.id],
					equipmentGroupIds: [group.id],
					routes: [first.route, port.route],
				}),
			);
			continue;
		}
		if (!isExactDirectedCell(map, route.x, route.z, firstRoute.from, firstRoute.to)) {
			if (portRouteExists(map, port.route)) {
				issues.push(
					createLayoutIssue({
						code: "EQ_PORT_RAIL_DISCONTINUITY",
						message: equipmentGroupMessage(
							group.id,
							`EQ port ${port.id} is not on an uninterrupted straight rail cell`,
						),
						portIds: [port.id],
						equipmentGroupIds: [group.id],
						routes: [port.route],
					}),
				);
			}
		}
		if (index === 0) {
			previousX = route.x;
			previousZ = route.z;
			previousPortId = port.id;
			pitchComparisonReady = true;
			continue;
		}
		if (!pitchComparisonReady) {
			previousX = route.x;
			previousZ = route.z;
			previousPortId = port.id;
			pitchComparisonReady = true;
			continue;
		}
		const expectedX = previousX + travel.x * pitchCells;
		const expectedZ = previousZ + travel.y * pitchCells;
		if (route.x !== expectedX || route.z !== expectedZ) {
			const actualPitchMeters = (route.x - previousX) * travel.x + (route.z - previousZ) * travel.y;
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_PITCH_ORDER",
					message: equipmentGroupMessage(
						group.id,
						`EQ ports must be ordered at the configured ${pitchCells} m pitch`,
					),
					portIds: [previousPortId, port.id],
					equipmentGroupIds: [group.id],
					routes: [portsById.get(previousPortId)?.route, port.route].filter(
						(route): route is PortRouteIdentity => route !== undefined,
					),
					cells: [{ x: expectedX, z: expectedZ }],
					measurement: {
						measured: actualPitchMeters,
						required: pitchCells,
						unit: "METERS",
						relation: "EXACT",
					},
				}),
			);
		}
		for (let step = 1; step < pitchCells; step++) {
			const x = previousX + travel.x * step;
			const z = previousZ + travel.y * step;
			if (!isExactDirectedCell(map, x, z, firstRoute.from, firstRoute.to)) {
				issues.push(
					createLayoutIssue({
						code: "EQ_PORT_PITCH_DISCONTINUITY",
						message: equipmentGroupMessage(
							group.id,
							`EQ pitch crosses a gap, curve, endpoint, or junction at ${x},${z}`,
						),
						portIds: [previousPortId, port.id],
						equipmentGroupIds: [group.id],
						routes: [portsById.get(previousPortId)?.route, port.route].filter(
							(route): route is PortRouteIdentity => route !== undefined,
						),
						cells: [{ x, z }],
					}),
				);
			}
		}
		previousX = route.x;
		previousZ = route.z;
		previousPortId = port.id;
	}
	return Object.freeze(issues);
}

function collectEqBasicPortIssues(
	group: EqEquipmentGroup,
	portsById: ReadonlyMap<number, PortRecord>,
	equipmentDirection: PortRecord["direction"],
	issues: PortEquipmentLayoutIssue[],
): void {
	for (const portId of group.portIds) {
		const port = portsById.get(portId);
		if (!port) {
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_MISSING",
					message: equipmentGroupMessage(group.id, `EQ port ${portId} is missing`),
					portIds: [portId],
					equipmentGroupIds: [group.id],
				}),
			);
			continue;
		}
		if (port.side !== "CENTER" || port.lateralOffsetMillimeters !== 0) {
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_SIDE_OFFSET",
					message: equipmentGroupMessage(
						group.id,
						`EQ port ${port.id} must be a zero-offset CENTER port`,
					),
					portIds: [port.id],
					equipmentGroupIds: [group.id],
					routes: [port.route],
					measurement: {
						measured: port.lateralOffsetMillimeters,
						required: 0,
						unit: "MILLIMETERS",
						relation: "EXACT",
					},
				}),
			);
		}
		if (port.direction !== equipmentDirection) {
			issues.push(
				createLayoutIssue({
					code: "EQ_PORT_DIRECTION",
					message: equipmentGroupMessage(
						group.id,
						`EQ port ${port.id} must preserve one equipment-facing direction`,
					),
					portIds: [port.id],
					equipmentGroupIds: [group.id],
					routes: [port.route],
				}),
			);
		}
	}
}

function createLayoutIssue(issue: MutableLayoutIssue): PortEquipmentLayoutIssue {
	const portIds = uniqueNumbers(issue.portIds ?? []);
	const equipmentGroupIds = uniqueNumbers(issue.equipmentGroupIds ?? []);
	const routes: PortRouteIdentity[] = [];
	const routeKeys = new Set<string>();
	for (const route of issue.routes ?? []) {
		const key = portRouteIdentityKey(route);
		if (routeKeys.has(key)) continue;
		routeKeys.add(key);
		routes.push(Object.freeze({ ...route }));
	}
	const cells: PortEquipmentLayoutCell[] = [];
	const cellKeys = new Set<string>();
	const addCell = (x: number, z: number): void => {
		const key = `${x}:${z}`;
		if (cellKeys.has(key)) return;
		cellKeys.add(key);
		cells.push(Object.freeze({ x, z }));
	};
	for (const route of routes) {
		if (route.kind === "CARDINAL_CELL") addCell(route.x, route.z);
	}
	for (const cell of issue.cells ?? []) addCell(cell.x, cell.z);
	return Object.freeze({
		code: issue.code,
		message: issue.message,
		portIds,
		equipmentGroupIds,
		routes: Object.freeze(routes),
		cells: Object.freeze(cells),
		measurement: issue.measurement ? Object.freeze({ ...issue.measurement }) : null,
	});
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
	return Object.freeze([...new Set(values)]);
}

function equipmentGroupMessage(equipmentGroupId: number, detail: string): string {
	return `equipment group ${equipmentGroupId}: ${detail}`;
}

function bodyRunPairKey(runId: number, leftGroupId: number, rightGroupId: number): string {
	return `${runId}:${Math.min(leftGroupId, rightGroupId)}:${Math.max(leftGroupId, rightGroupId)}`;
}

function isExactDirectedCell(
	map: TileMap,
	x: number,
	z: number,
	from: Direction,
	to: Direction,
): boolean {
	const rail = map.getRail(x, z);
	return rail.incoming === from && rail.outgoing === to;
}
