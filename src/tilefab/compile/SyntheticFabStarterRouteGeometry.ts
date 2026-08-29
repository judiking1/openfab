import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { type CompiledPhysicalPaths, PATH_KIND, samplePhysicalPath } from "./PhysicalPathCompiler";

export const SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION = 2 as const;
export const SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_MAX_BYTES = 512 * 1024;
const MAXIMUM_DIRECTION_MARKERS = 28;

export interface SyntheticFabStarterRouteGeometry {
	readonly schemaVersion: typeof SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION;
	readonly sourcePhysicalFingerprint: string;
	readonly bounds: Readonly<{
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}>;
	readonly positions: Float32Array;
	readonly offsets: Uint32Array;
	readonly kinds: Uint8Array;
	/** Physical path indices grouped in tangential drawing order. */
	readonly runOffsets: Uint32Array;
	readonly runPathIndices: Uint32Array;
	readonly runClosed: Uint8Array;
	/** Packed x, y, angleRadians triples. */
	readonly markers: Float32Array;
	readonly markerScale: number;
	readonly pathCount: number;
	readonly pointCount: number;
	readonly runCount: number;
	readonly byteLength: number;
	readonly fingerprint: string;
}

export interface SyntheticFabStarterRouteRuns {
	readonly count: number;
	readonly offsets: Uint32Array;
	readonly pathIndices: Uint32Array;
	readonly closed: Uint8Array;
}

/**
 * Capture a compact, renderer-neutral copy of the exact compiled physical routes.
 * The artifact is transferable and deliberately excludes authored/editor state.
 */
export function captureSyntheticFabStarterRouteGeometry(
	paths: CompiledPhysicalPaths,
	sourcePhysicalFingerprint: string,
	runs: SyntheticFabStarterRouteRuns,
): SyntheticFabStarterRouteGeometry {
	if (paths.pathCount <= 0 || paths.pointCount <= 0) {
		throw new Error("Starter route geometry requires at least one physical path.");
	}
	const positions = new Float32Array(paths.positions);
	const offsets = new Uint32Array(paths.offsets);
	const kinds = new Uint8Array(paths.kinds);
	assertCompletePhysicalRuns(paths, runs);
	const runOffsets = new Uint32Array(runs.offsets);
	const runPathIndices = new Uint32Array(runs.pathIndices);
	const runClosed = new Uint8Array(runs.closed);
	const bounds = routeGeometryBounds(positions);
	const markers = captureDirectionMarkers(paths);
	const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
	const markerScale = Math.max(3.2, Math.min(8, extent * 0.018));
	const byteLength =
		positions.byteLength +
		offsets.byteLength +
		kinds.byteLength +
		runOffsets.byteLength +
		runPathIndices.byteLength +
		runClosed.byteLength +
		markers.byteLength;
	if (byteLength > SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_MAX_BYTES) {
		throw new Error(
			`Starter route geometry exceeds ${SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_MAX_BYTES} bytes.`,
		);
	}
	const base = {
		schemaVersion: SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION,
		sourcePhysicalFingerprint,
		bounds,
		positions,
		offsets,
		kinds,
		runOffsets,
		runPathIndices,
		runClosed,
		markers,
		markerScale,
		pathCount: paths.pathCount,
		pointCount: paths.pointCount,
		runCount: runs.count,
		byteLength,
	} as const;
	return Object.freeze({
		...base,
		fingerprint: checksumSyntheticFabStarterRouteGeometry(base),
	});
}

export function isSyntheticFabStarterRouteGeometry(
	value: unknown,
	expectedPhysicalFingerprint?: string,
): value is SyntheticFabStarterRouteGeometry {
	if (
		!isRecord(value) ||
		value.schemaVersion !== SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_SCHEMA_VERSION
	) {
		return false;
	}
	if (
		typeof value.sourcePhysicalFingerprint !== "string" ||
		(expectedPhysicalFingerprint !== undefined &&
			value.sourcePhysicalFingerprint !== expectedPhysicalFingerprint) ||
		!(value.positions instanceof Float32Array) ||
		!(value.offsets instanceof Uint32Array) ||
		!(value.kinds instanceof Uint8Array) ||
		!(value.runOffsets instanceof Uint32Array) ||
		!(value.runPathIndices instanceof Uint32Array) ||
		!(value.runClosed instanceof Uint8Array) ||
		!(value.markers instanceof Float32Array) ||
		!isPositiveSafeInteger(value.pathCount) ||
		value.pathCount <= 0 ||
		!isPositiveSafeInteger(value.pointCount) ||
		value.pointCount <= 0 ||
		!isPositiveSafeInteger(value.runCount) ||
		value.runCount <= 0 ||
		!isPositiveSafeInteger(value.byteLength) ||
		value.byteLength <= 0 ||
		value.byteLength > SYNTHETIC_FAB_STARTER_ROUTE_GEOMETRY_MAX_BYTES ||
		typeof value.markerScale !== "number" ||
		!Number.isFinite(value.markerScale) ||
		value.markerScale <= 0 ||
		typeof value.fingerprint !== "string" ||
		!isRouteGeometryBounds(value.bounds)
	) {
		return false;
	}
	const geometry = value as unknown as SyntheticFabStarterRouteGeometry;
	if (
		geometry.positions.length !== geometry.pointCount * 2 ||
		geometry.offsets.length !== geometry.pathCount + 1 ||
		geometry.kinds.length !== geometry.pathCount ||
		geometry.runOffsets.length !== geometry.runCount + 1 ||
		geometry.runPathIndices.length !== geometry.pathCount ||
		geometry.runClosed.length !== geometry.runCount ||
		geometry.markers.length % 3 !== 0 ||
		geometry.markers.length / 3 > MAXIMUM_DIRECTION_MARKERS ||
		!ownsBackingBuffer(geometry.positions) ||
		!ownsBackingBuffer(geometry.offsets) ||
		!ownsBackingBuffer(geometry.kinds) ||
		!ownsBackingBuffer(geometry.runOffsets) ||
		!ownsBackingBuffer(geometry.runPathIndices) ||
		!ownsBackingBuffer(geometry.runClosed) ||
		!ownsBackingBuffer(geometry.markers) ||
		geometry.byteLength !==
			geometry.positions.buffer.byteLength +
				geometry.offsets.buffer.byteLength +
				geometry.kinds.buffer.byteLength +
				geometry.runOffsets.buffer.byteLength +
				geometry.runPathIndices.buffer.byteLength +
				geometry.runClosed.buffer.byteLength +
				geometry.markers.buffer.byteLength ||
		geometry.offsets[0] !== 0 ||
		geometry.offsets[geometry.pathCount] !== geometry.pointCount ||
		!hasCompletePhysicalRuns(geometry)
	) {
		return false;
	}
	let previousOffset = 0;
	for (const offset of geometry.offsets) {
		if (offset < previousOffset || offset > geometry.pointCount) return false;
		previousOffset = offset;
	}
	if (!allFinite(geometry.positions) || !allFinite(geometry.markers)) return false;
	const derivedBounds = routeGeometryBounds(geometry.positions);
	if (!sameBounds(geometry.bounds, derivedBounds)) return false;
	return geometry.fingerprint === checksumSyntheticFabStarterRouteGeometry(geometry);
}

function checksumSyntheticFabStarterRouteGeometry(
	geometry: Omit<SyntheticFabStarterRouteGeometry, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["synthetic-fab-starter-route-geometry", geometry.sourcePhysicalFingerprint]);
	checksum.addNumbers([
		geometry.schemaVersion,
		geometry.bounds.minX,
		geometry.bounds.minY,
		geometry.bounds.maxX,
		geometry.bounds.maxY,
		geometry.markerScale,
		geometry.pathCount,
		geometry.pointCount,
		geometry.runCount,
		geometry.byteLength,
	]);
	checksum.addViews([
		geometry.positions,
		geometry.offsets,
		geometry.kinds,
		geometry.runOffsets,
		geometry.runPathIndices,
		geometry.runClosed,
		geometry.markers,
	]);
	return checksum.digest();
}

function assertCompletePhysicalRuns(
	paths: CompiledPhysicalPaths,
	runs: SyntheticFabStarterRouteRuns,
): void {
	const candidate = {
		pathCount: paths.pathCount,
		runCount: runs.count,
		runOffsets: runs.offsets,
		runPathIndices: runs.pathIndices,
		runClosed: runs.closed,
	};
	if (!hasCompletePhysicalRuns(candidate)) {
		throw new Error("Starter route runs must cover every physical path exactly once.");
	}
}

function hasCompletePhysicalRuns(
	value: Readonly<{
		pathCount: number;
		runCount: number;
		runOffsets: Uint32Array;
		runPathIndices: Uint32Array;
		runClosed: Uint8Array;
	}>,
): boolean {
	if (
		!Number.isSafeInteger(value.runCount) ||
		value.runCount <= 0 ||
		value.runOffsets.length !== value.runCount + 1 ||
		value.runPathIndices.length !== value.pathCount ||
		value.runClosed.length !== value.runCount ||
		value.runOffsets[0] !== 0 ||
		value.runOffsets[value.runCount] !== value.pathCount
	) {
		return false;
	}
	let previousOffset = 0;
	for (let index = 0; index < value.runOffsets.length; index++) {
		const offset = value.runOffsets[index] as number;
		if (offset < previousOffset || offset > value.pathCount) return false;
		if (index > 0 && offset === previousOffset) return false;
		previousOffset = offset;
	}
	for (const closed of value.runClosed) {
		if (closed !== 0 && closed !== 1) return false;
	}
	const seen = new Uint8Array(value.pathCount);
	for (const pathIndex of value.runPathIndices) {
		if (pathIndex >= value.pathCount || seen[pathIndex] !== 0) return false;
		seen[pathIndex] = 1;
	}
	return true;
}

function captureDirectionMarkers(paths: CompiledPhysicalPaths): Float32Array {
	const eligible: number[] = [];
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const kind = paths.kinds[pathIndex] as number;
		if (kind === PATH_KIND.INVALID || kind === PATH_KIND.TERMINAL) continue;
		if ((paths.lengths[pathIndex] as number) <= 0.001) continue;
		eligible.push(pathIndex);
	}
	if (eligible.length === 0) return new Float32Array();
	const markerCount = Math.min(MAXIMUM_DIRECTION_MARKERS, eligible.length);
	const packed: number[] = [];
	for (let markerIndex = 0; markerIndex < markerCount; markerIndex++) {
		const candidateIndex = Math.min(
			eligible.length - 1,
			Math.floor(((markerIndex + 0.5) * eligible.length) / markerCount),
		);
		const pathIndex = eligible[candidateIndex] as number;
		const sample = samplePhysicalPath(paths, pathIndex, (paths.lengths[pathIndex] as number) / 2);
		if (!sample) continue;
		packed.push(sample.x, sample.y, Math.atan2(sample.tangentY, sample.tangentX));
	}
	return new Float32Array(packed);
}

function routeGeometryBounds(positions: Float32Array): SyntheticFabStarterRouteGeometry["bounds"] {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < positions.length; index += 2) {
		const x = positions[index] as number;
		const y = positions[index + 1] as number;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	return Object.freeze({ minX, minY, maxX, maxY });
}

function isRouteGeometryBounds(
	value: unknown,
): value is SyntheticFabStarterRouteGeometry["bounds"] {
	return (
		isRecord(value) &&
		[value.minX, value.minY, value.maxX, value.maxY].every(
			(candidate) => typeof candidate === "number" && Number.isFinite(candidate),
		) &&
		(value.minX as number) <= (value.maxX as number) &&
		(value.minY as number) <= (value.maxY as number)
	);
}

function sameBounds(
	left: SyntheticFabStarterRouteGeometry["bounds"],
	right: SyntheticFabStarterRouteGeometry["bounds"],
): boolean {
	return (
		left.minX === right.minX &&
		left.minY === right.minY &&
		left.maxX === right.maxX &&
		left.maxY === right.maxY
	);
}

function allFinite(values: Float32Array): boolean {
	for (const value of values) {
		if (!Number.isFinite(value)) return false;
	}
	return true;
}

function ownsBackingBuffer(view: ArrayBufferView): boolean {
	return (
		view.buffer instanceof ArrayBuffer &&
		view.byteOffset === 0 &&
		view.byteLength === view.buffer.byteLength
	);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
