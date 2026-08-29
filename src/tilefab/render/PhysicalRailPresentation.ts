import {
	type CompiledPhysicalPaths,
	PATH_KIND,
	samplePhysicalPath,
} from "../compile/PhysicalPathCompiler";
import { buildPhysicalPathAdjacency } from "../compile/PhysicalPathFlow";
import {
	comparePhysicalPathIdentity,
	PHYSICAL_PATH_IDENTITY_WIDTH,
	physicalPathIdentityField,
} from "../compile/PhysicalPathIdentity";

export const RAIL_DECORATION_KIND = {
	METRIC_JOINT: 0,
	PROFILE_JOINT: 1,
	SWITCH_JOINT: 2,
	SUPPORT: 3,
	FLOW: 4,
	/** Reduced single-chevron cue for a run too short to satisfy normal hardware exclusion. */
	FLOW_COMPACT: 5,
} as const;

export type RailDecorationKind = (typeof RAIL_DECORATION_KIND)[keyof typeof RAIL_DECORATION_KIND];

export const RAIL_DECORATION_PRIORITY = {
	OVERVIEW: 0,
	CONSTRUCTION: 1,
	DETAIL: 2,
} as const;

export interface RailPresentationProfile {
	readonly id: string;
	readonly version: number;
	/** Visual construction profile only; not a certified structural-installation specification. */
	readonly engineeringStatus: "visual-construction-profile";
	readonly constructionShadowWidthMeters: number;
	readonly bedWidthMeters: number;
	readonly beamCenterOffsetMeters: number;
	readonly beamWidthMeters: number;
	readonly beamHighlightWidthMeters: number;
	readonly slotWidthMeters: number;
	readonly jointIntervalMeters: number;
	readonly jointHalfSpanMeters: number;
	readonly supportIntervalMeters: number;
	readonly supportHalfSpanMeters: number;
	readonly supportJointExclusionMeters: number;
	readonly supportCurvatureProbeMeters: number;
	readonly supportMinimumTangentDot: number;
	readonly flowIntervalMeters: number;
	readonly flowHardwareExclusionMeters: number;
}

export const OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE: RailPresentationProfile = Object.freeze({
	id: "openfab-construction-v1",
	version: 1,
	engineeringStatus: "visual-construction-profile",
	constructionShadowWidthMeters: 0.44,
	bedWidthMeters: 0.23,
	beamCenterOffsetMeters: 0.058,
	beamWidthMeters: 0.052,
	beamHighlightWidthMeters: 0.012,
	slotWidthMeters: 0.026,
	jointIntervalMeters: 5,
	jointHalfSpanMeters: 0.135,
	supportIntervalMeters: 1.5,
	supportHalfSpanMeters: 0.26,
	supportJointExclusionMeters: 0.34,
	supportCurvatureProbeMeters: 0.15,
	supportMinimumTangentDot: 0.94,
	flowIntervalMeters: 4.5,
	flowHardwareExclusionMeters: 0.22,
});

export interface PhysicalRailRuns {
	readonly count: number;
	readonly offsets: Uint32Array;
	readonly pathIndices: Uint32Array;
	readonly pathStarts: Float32Array;
	readonly lengths: Float32Array;
	readonly closed: Uint8Array;
	readonly pathRunIndices: Uint32Array;
	readonly pathRunStarts: Float32Array;
}

export interface PhysicalRailDecorations {
	readonly count: number;
	readonly pathOffsets: Uint32Array;
	readonly ownerPathIndices: Uint32Array;
	readonly runIndices: Uint32Array;
	readonly pathStations: Float32Array;
	readonly runStations: Float32Array;
	readonly positions: Float32Array;
	readonly tangents: Float32Array;
	readonly kinds: Uint8Array;
	readonly priorities: Uint8Array;
	/** Two uint32 words per decoration; stable across redraws of the same physical source identity. */
	readonly stableIds: Uint32Array;
}

export interface CompiledRailPresentation {
	readonly source: CompiledPhysicalPaths;
	readonly profile: RailPresentationProfile;
	readonly pointNormals: Float32Array;
	readonly runs: PhysicalRailRuns;
	readonly decorations: PhysicalRailDecorations;
	readonly maxLateralExtentMeters: number;
}

const NO_RUN = 0xffff_ffff;
const POSITION_QUANTIZATION = 10_000;
const SEAM_POSITION_TOLERANCE_METERS = 0.002;
const SEAM_MINIMUM_TANGENT_DOT = 0.999;
const STATION_EPSILON = 0.0001;
const MIN_DECORATION_INTERVAL_METERS = 0.01;
// A 100,001-cell straight scale source has a conservative pre-deduplication budget of
// roughly 109k joints, supports, and flow cues. Keep the guard finite while allowing that
// repository-owned acceptance source with bounded typed-output headroom.
const MAX_DECORATIONS_PER_RUN = 125_000;

interface MutableRun {
	readonly paths: number[];
	readonly starts: number[];
	length: number;
	closed: boolean;
}

interface DecorationCandidate {
	pathIndex: number;
	runIndex: number;
	pathStation: number;
	runStation: number;
	x: number;
	y: number;
	tangentX: number;
	tangentY: number;
	kind: RailDecorationKind;
	priority: number;
}

export function compilePhysicalRailPresentation(
	paths: CompiledPhysicalPaths,
	profile: RailPresentationProfile = OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE,
): CompiledRailPresentation {
	const normalizedProfile = normalizePresentationProfile(profile);
	const pointNormals = compilePointNormals(paths);
	const runs = compilePhysicalRailRuns(paths);
	const decorations = compileDecorations(paths, runs, normalizedProfile);
	return Object.freeze({
		source: paths,
		profile: normalizedProfile,
		pointNormals,
		runs,
		decorations,
		maxLateralExtentMeters: Math.max(
			normalizedProfile.constructionShadowWidthMeters / 2,
			normalizedProfile.supportHalfSpanMeters,
		),
	});
}

/** Compile only the ordered metric runs needed by lightweight overview renderers. */
export function compilePhysicalRailRuns(paths: CompiledPhysicalPaths): PhysicalRailRuns {
	return compileMetricRuns(paths);
}

function normalizePresentationProfile(profile: RailPresentationProfile): RailPresentationProfile {
	if (profile.id.trim().length === 0)
		throw new RangeError("Rail presentation profile id is empty.");
	if (!Number.isSafeInteger(profile.version) || profile.version <= 0) {
		throw new RangeError("Rail presentation profile version must be a positive safe integer.");
	}
	if (profile.engineeringStatus !== "visual-construction-profile") {
		throw new RangeError("Rail presentation profile engineering status is unsupported.");
	}
	for (const field of POSITIVE_PROFILE_FIELDS) {
		assertFiniteProfileNumber(profile[field], field, false);
	}
	for (const field of NON_NEGATIVE_PROFILE_FIELDS) {
		assertFiniteProfileNumber(profile[field], field, true);
	}
	for (const field of INTERVAL_PROFILE_FIELDS) {
		if (profile[field] < MIN_DECORATION_INTERVAL_METERS) {
			throw new RangeError(
				`Rail presentation profile ${field} must be at least ${MIN_DECORATION_INTERVAL_METERS} meters.`,
			);
		}
	}
	if (
		!Number.isFinite(profile.supportMinimumTangentDot) ||
		profile.supportMinimumTangentDot < -1 ||
		profile.supportMinimumTangentDot > 1
	) {
		throw new RangeError("Rail presentation profile supportMinimumTangentDot must be in [-1, 1].");
	}
	return Object.freeze({ ...profile });
}

const POSITIVE_PROFILE_FIELDS = [
	"constructionShadowWidthMeters",
	"bedWidthMeters",
	"beamCenterOffsetMeters",
	"beamWidthMeters",
	"beamHighlightWidthMeters",
	"slotWidthMeters",
	"jointIntervalMeters",
	"jointHalfSpanMeters",
	"supportIntervalMeters",
	"supportHalfSpanMeters",
	"supportCurvatureProbeMeters",
	"flowIntervalMeters",
] as const satisfies readonly (keyof RailPresentationProfile)[];

const NON_NEGATIVE_PROFILE_FIELDS = [
	"supportJointExclusionMeters",
	"flowHardwareExclusionMeters",
] as const satisfies readonly (keyof RailPresentationProfile)[];

const INTERVAL_PROFILE_FIELDS = [
	"jointIntervalMeters",
	"supportIntervalMeters",
	"flowIntervalMeters",
] as const satisfies readonly (keyof RailPresentationProfile)[];

function assertFiniteProfileNumber(value: number, field: string, allowZero: boolean): void {
	if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
		throw new RangeError(
			`Rail presentation profile ${field} must be finite and ${allowZero ? "non-negative" : "positive"}.`,
		);
	}
}

function compilePointNormals(paths: CompiledPhysicalPaths): Float32Array {
	const normals = new Float32Array(paths.pointCount * 2);
	for (let pointIndex = 0; pointIndex < paths.pointCount; pointIndex++) {
		const offset = pointIndex * 2;
		const tangentX = paths.tangents[offset] as number;
		const tangentY = paths.tangents[offset + 1] as number;
		const magnitude = Math.hypot(tangentX, tangentY) || 1;
		normals[offset] = -tangentY / magnitude;
		normals[offset + 1] = tangentX / magnitude;
	}
	return normals;
}

function compileMetricRuns(paths: CompiledPhysicalPaths): PhysicalRailRuns {
	const adjacency = buildPhysicalPathAdjacency(paths);
	const incomingCounts = new Uint32Array(paths.pathCount);
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		for (let edgeIndex = start; edgeIndex < end; edgeIndex++) {
			incomingCounts[adjacency.targets[edgeIndex] as number]++;
		}
	}

	const next = new Int32Array(paths.pathCount).fill(-1);
	const previous = new Int32Array(paths.pathCount).fill(-1);
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if (!isValidPath(paths, pathIndex) || isSwitchBoundaryPath(paths, pathIndex)) continue;
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		if (end - start !== 1) continue;
		const target = adjacency.targets[start] as number;
		if (
			(incomingCounts[target] as number) !== 1 ||
			isSwitchBoundaryPath(paths, target) ||
			!pathsJoinTangentially(paths, pathIndex, target)
		) {
			continue;
		}
		next[pathIndex] = target;
		previous[target] = pathIndex;
	}

	const starts: number[] = [];
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if (isValidPath(paths, pathIndex) && previous[pathIndex] < 0) starts.push(pathIndex);
	}
	starts.sort((left, right) => comparePhysicalPathIdentity(paths, left, right));

	const visited = new Uint8Array(paths.pathCount);
	const mutableRuns: MutableRun[] = [];
	for (const start of starts) {
		if (visited[start] !== 0) continue;
		mutableRuns.push(walkRun(paths, start, next, visited));
	}
	const remainingPaths: number[] = [];
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if (isValidPath(paths, pathIndex) && visited[pathIndex] === 0) remainingPaths.push(pathIndex);
	}
	remainingPaths.sort((left, right) => comparePhysicalPathIdentity(paths, left, right));
	for (const cycleStart of remainingPaths) {
		if (visited[cycleStart] !== 0) continue;
		mutableRuns.push(walkRun(paths, cycleStart, next, visited));
	}

	const runOffsets = new Uint32Array(mutableRuns.length + 1);
	const runLengths = new Float32Array(mutableRuns.length);
	const runClosed = new Uint8Array(mutableRuns.length);
	const pathRunIndices = new Uint32Array(paths.pathCount).fill(NO_RUN);
	const pathRunStarts = new Float32Array(paths.pathCount);
	const flatPaths: number[] = [];
	const flatStarts: number[] = [];
	for (let runIndex = 0; runIndex < mutableRuns.length; runIndex++) {
		const run = mutableRuns[runIndex] as MutableRun;
		runOffsets[runIndex] = flatPaths.length;
		runLengths[runIndex] = run.length;
		runClosed[runIndex] = run.closed ? 1 : 0;
		for (let index = 0; index < run.paths.length; index++) {
			const pathIndex = run.paths[index] as number;
			const start = run.starts[index] as number;
			flatPaths.push(pathIndex);
			flatStarts.push(start);
			pathRunIndices[pathIndex] = runIndex;
			pathRunStarts[pathIndex] = start;
		}
	}
	runOffsets[mutableRuns.length] = flatPaths.length;
	return Object.freeze({
		count: mutableRuns.length,
		offsets: runOffsets,
		pathIndices: Uint32Array.from(flatPaths),
		pathStarts: Float32Array.from(flatStarts),
		lengths: runLengths,
		closed: runClosed,
		pathRunIndices,
		pathRunStarts,
	});
}

function walkRun(
	paths: CompiledPhysicalPaths,
	start: number,
	next: Int32Array,
	visited: Uint8Array,
): MutableRun {
	const run: MutableRun = { paths: [], starts: [], length: 0, closed: false };
	let current = start;
	while (current >= 0 && visited[current] === 0 && isValidPath(paths, current)) {
		visited[current] = 1;
		run.paths.push(current);
		run.starts.push(run.length);
		run.length += paths.lengths[current] as number;
		const target = next[current] as number;
		if (target === start) {
			run.closed = true;
			break;
		}
		current = target;
	}
	return run;
}

function compileDecorations(
	paths: CompiledPhysicalPaths,
	runs: PhysicalRailRuns,
	profile: RailPresentationProfile,
): PhysicalRailDecorations {
	validateDecorationBudgets(paths, runs, profile);
	const candidates: DecorationCandidate[] = [];
	const deduplicated = new Map<string, number>();
	const sharedOwners = canonicalSharedOwners(paths);
	const jointStationsByRun: number[][] = Array.from({ length: runs.count }, () => []);
	const supportStationsByRun: number[][] = Array.from({ length: runs.count }, () => []);

	for (let runIndex = 0; runIndex < runs.count; runIndex++) {
		const runLength = runs.lengths[runIndex] as number;
		const runPathStart = runs.offsets[runIndex] as number;
		const runPathEnd = runs.offsets[runIndex + 1] as number;
		if (runPathStart === runPathEnd || runLength <= STATION_EPSILON) continue;

		for (let offset = runPathStart; offset < runPathEnd; offset++) {
			const pathIndex = runs.pathIndices[offset] as number;
			const runStation = runs.pathStarts[offset] as number;
			const previousPath =
				offset > runPathStart
					? (runs.pathIndices[offset - 1] as number)
					: (runs.closed[runIndex] as number) !== 0
						? (runs.pathIndices[runPathEnd - 1] as number)
						: -1;
			const kind = jointKind(paths, previousPath, pathIndex);
			if (offset > runPathStart && kind === RAIL_DECORATION_KIND.METRIC_JOINT) continue;
			addRunDecoration(
				paths,
				runs,
				candidates,
				deduplicated,
				sharedOwners,
				runIndex,
				runStation,
				kind,
				RAIL_DECORATION_PRIORITY.CONSTRUCTION,
			);
			jointStationsByRun[runIndex]?.push(runStation);
		}
		if ((runs.closed[runIndex] as number) === 0) {
			addRunDecoration(
				paths,
				runs,
				candidates,
				deduplicated,
				sharedOwners,
				runIndex,
				runLength,
				jointKind(paths, runs.pathIndices[runPathEnd - 1] as number, -1),
				RAIL_DECORATION_PRIORITY.CONSTRUCTION,
			);
			jointStationsByRun[runIndex]?.push(runLength);
		}
		const jointCount = repeatedDecorationCount(
			profile.jointIntervalMeters,
			profile.jointIntervalMeters,
			runLength - STATION_EPSILON,
			"joint",
		);
		for (let jointIndex = 0; jointIndex < jointCount; jointIndex++) {
			const station = profile.jointIntervalMeters * (jointIndex + 1);
			addRunDecoration(
				paths,
				runs,
				candidates,
				deduplicated,
				sharedOwners,
				runIndex,
				station,
				RAIL_DECORATION_KIND.METRIC_JOINT,
				RAIL_DECORATION_PRIORITY.CONSTRUCTION,
			);
			jointStationsByRun[runIndex]?.push(station);
		}
	}
	for (const stations of jointStationsByRun) stations.sort((left, right) => left - right);

	for (let runIndex = 0; runIndex < runs.count; runIndex++) {
		const runLength = runs.lengths[runIndex] as number;
		const closed = (runs.closed[runIndex] as number) !== 0;
		const firstSupportStation = profile.supportIntervalMeters / 2;
		const supportCount = repeatedDecorationCount(
			firstSupportStation,
			profile.supportIntervalMeters,
			runLength - STATION_EPSILON,
			"support",
		);
		for (let supportIndex = 0; supportIndex < supportCount; supportIndex++) {
			const station = firstSupportStation + supportIndex * profile.supportIntervalMeters;
			if (
				nearestRunDistance(station, jointStationsByRun[runIndex] ?? [], runLength, closed) <
				profile.supportJointExclusionMeters
			) {
				continue;
			}
			const location = locateRunStation(paths, runs, runIndex, station);
			if (!location || !supportsAllowedOnPath(paths, location.pathIndex)) continue;
			if (!isLowCurvature(paths, location.pathIndex, location.pathStation, profile)) continue;
			const added = addDecorationCandidate(
				paths,
				candidates,
				deduplicated,
				sharedOwners,
				location,
				runIndex,
				station,
				RAIL_DECORATION_KIND.SUPPORT,
				RAIL_DECORATION_PRIORITY.DETAIL,
			);
			if (added) supportStationsByRun[runIndex]?.push(station);
		}
	}

	for (let runIndex = 0; runIndex < runs.count; runIndex++) {
		const runLength = runs.lengths[runIndex] as number;
		if (runLength <= STATION_EPSILON) continue;
		const closed = (runs.closed[runIndex] as number) !== 0;
		const jointStations = jointStationsByRun[runIndex] ?? [];
		const supportStations = supportStationsByRun[runIndex] ?? [];
		const markerCount = assertDecorationCount(
			Math.max(1, Math.floor(runLength / profile.flowIntervalMeters)),
			"flow",
		);
		const markerSpan = (markerCount - 1) * profile.flowIntervalMeters;
		const first = (runLength - markerSpan) / 2;
		let flowAdded = false;
		for (let marker = 0; marker < markerCount; marker++) {
			const intendedStation = first + marker * profile.flowIntervalMeters;
			const station = findAvailableFlowStation(
				intendedStation,
				runLength,
				closed,
				jointStations,
				supportStations,
				profile,
			);
			if (station === null) continue;
			flowAdded =
				addRunDecoration(
					paths,
					runs,
					candidates,
					deduplicated,
					sharedOwners,
					runIndex,
					station,
					RAIL_DECORATION_KIND.FLOW,
					RAIL_DECORATION_PRIORITY.OVERVIEW,
				) || flowAdded;
		}
		if (!flowAdded) {
			const fallback = bestFallbackFlowStation(runLength, closed, jointStations, supportStations);
			addRunDecoration(
				paths,
				runs,
				candidates,
				deduplicated,
				sharedOwners,
				runIndex,
				fallback.station,
				fallback.clearance >= profile.flowHardwareExclusionMeters
					? RAIL_DECORATION_KIND.FLOW
					: RAIL_DECORATION_KIND.FLOW_COMPACT,
				RAIL_DECORATION_PRIORITY.OVERVIEW,
			);
		}
	}

	return freezeDecorations(paths, candidates);
}

function validateDecorationBudgets(
	paths: CompiledPhysicalPaths,
	runs: PhysicalRailRuns,
	profile: RailPresentationProfile,
): void {
	for (let runIndex = 0; runIndex < runs.count; runIndex++) {
		const runLength = runs.lengths[runIndex] as number;
		const runPathStart = runs.offsets[runIndex] as number;
		const runPathEnd = runs.offsets[runIndex + 1] as number;
		if (runPathStart === runPathEnd || runLength <= STATION_EPSILON) continue;

		let boundaryJointCount = 0;
		for (let offset = runPathStart; offset < runPathEnd; offset++) {
			const pathIndex = runs.pathIndices[offset] as number;
			const previousPath =
				offset > runPathStart
					? (runs.pathIndices[offset - 1] as number)
					: (runs.closed[runIndex] as number) !== 0
						? (runs.pathIndices[runPathEnd - 1] as number)
						: -1;
			if (
				offset === runPathStart ||
				jointKind(paths, previousPath, pathIndex) !== RAIL_DECORATION_KIND.METRIC_JOINT
			) {
				boundaryJointCount++;
			}
		}
		if ((runs.closed[runIndex] as number) === 0) boundaryJointCount++;

		const metricJointCount = repeatedDecorationCount(
			profile.jointIntervalMeters,
			profile.jointIntervalMeters,
			runLength - STATION_EPSILON,
			"joint",
		);
		const supportCount = repeatedDecorationCount(
			profile.supportIntervalMeters / 2,
			profile.supportIntervalMeters,
			runLength - STATION_EPSILON,
			"support",
		);
		const flowCount = assertDecorationCount(
			Math.max(1, Math.floor(runLength / profile.flowIntervalMeters)),
			"flow",
		);
		const total = boundaryJointCount + metricJointCount + supportCount + flowCount;
		if (!Number.isSafeInteger(total) || total > MAX_DECORATIONS_PER_RUN) {
			throw new RangeError(
				`Rail presentation total decoration count exceeds ${MAX_DECORATIONS_PER_RUN} per run.`,
			);
		}
	}
}

function addRunDecoration(
	paths: CompiledPhysicalPaths,
	runs: PhysicalRailRuns,
	candidates: DecorationCandidate[],
	deduplicated: Map<string, number>,
	sharedOwners: ReadonlyMap<number, number>,
	runIndex: number,
	runStation: number,
	kind: RailDecorationKind,
	priority: number,
): boolean {
	const location = locateRunStation(paths, runs, runIndex, runStation);
	if (!location) return false;
	return addDecorationCandidate(
		paths,
		candidates,
		deduplicated,
		sharedOwners,
		location,
		runIndex,
		runStation,
		kind,
		priority,
	);
}

function addDecorationCandidate(
	paths: CompiledPhysicalPaths,
	candidates: DecorationCandidate[],
	deduplicated: Map<string, number>,
	sharedOwners: ReadonlyMap<number, number>,
	location: { pathIndex: number; pathStation: number },
	runIndex: number,
	runStation: number,
	kind: RailDecorationKind,
	priority: number,
): boolean {
	if (!isCanonicalSharedOwner(paths, location.pathIndex, location.pathStation, sharedOwners))
		return false;
	const sample = samplePhysicalPath(paths, location.pathIndex, location.pathStation);
	if (!sample) return false;
	const flow = isFlowDecoration(kind);
	const family = kind <= RAIL_DECORATION_KIND.SWITCH_JOINT ? "joint" : flow ? "flow" : String(kind);
	const directionKey = flow ? `:${quantize(sample.tangentX)}:${quantize(sample.tangentY)}` : "";
	const key = `${family}:${quantize(sample.x)}:${quantize(sample.y)}${directionKey}`;
	const existingIndex = deduplicated.get(key);
	if (existingIndex !== undefined) {
		const existing = candidates[existingIndex] as DecorationCandidate;
		if (kind <= RAIL_DECORATION_KIND.SWITCH_JOINT && kind > existing.kind) {
			existing.kind = kind;
		}
		return true;
	}
	deduplicated.set(key, candidates.length);
	candidates.push({
		pathIndex: location.pathIndex,
		runIndex,
		pathStation: location.pathStation,
		runStation,
		x: sample.x,
		y: sample.y,
		tangentX: sample.tangentX,
		tangentY: sample.tangentY,
		kind,
		priority,
	});
	return true;
}

function freezeDecorations(
	paths: CompiledPhysicalPaths,
	candidates: readonly DecorationCandidate[],
): PhysicalRailDecorations {
	const grouped: DecorationCandidate[][] = Array.from({ length: paths.pathCount }, () => []);
	for (const candidate of candidates) grouped[candidate.pathIndex]?.push(candidate);
	for (const group of grouped) {
		group.sort((left, right) => left.pathStation - right.pathStation || left.kind - right.kind);
	}
	const pathOffsets = new Uint32Array(paths.pathCount + 1);
	const ordered: DecorationCandidate[] = [];
	for (let pathIndex = 0; pathIndex < grouped.length; pathIndex++) {
		pathOffsets[pathIndex] = ordered.length;
		ordered.push(...(grouped[pathIndex] ?? []));
	}
	pathOffsets[paths.pathCount] = ordered.length;
	const ownerPathIndices = new Uint32Array(ordered.length);
	const runIndices = new Uint32Array(ordered.length);
	const pathStations = new Float32Array(ordered.length);
	const runStations = new Float32Array(ordered.length);
	const positions = new Float32Array(ordered.length * 2);
	const tangents = new Float32Array(ordered.length * 2);
	const kinds = new Uint8Array(ordered.length);
	const priorities = new Uint8Array(ordered.length);
	const stableIds = new Uint32Array(ordered.length * 2);
	for (let index = 0; index < ordered.length; index++) {
		const candidate = ordered[index] as DecorationCandidate;
		ownerPathIndices[index] = candidate.pathIndex;
		runIndices[index] = candidate.runIndex;
		pathStations[index] = candidate.pathStation;
		runStations[index] = candidate.runStation;
		positions[index * 2] = candidate.x;
		positions[index * 2 + 1] = candidate.y;
		tangents[index * 2] = candidate.tangentX;
		tangents[index * 2 + 1] = candidate.tangentY;
		kinds[index] = candidate.kind;
		priorities[index] = candidate.priority;
		const [high, low] = decorationStableId(paths, candidate);
		stableIds[index * 2] = high;
		stableIds[index * 2 + 1] = low;
	}
	return Object.freeze({
		count: ordered.length,
		pathOffsets,
		ownerPathIndices,
		runIndices,
		pathStations,
		runStations,
		positions,
		tangents,
		kinds,
		priorities,
		stableIds,
	});
}

function locateRunStation(
	paths: CompiledPhysicalPaths,
	runs: PhysicalRailRuns,
	runIndex: number,
	runStation: number,
): { pathIndex: number; pathStation: number } | null {
	const start = runs.offsets[runIndex] as number;
	const end = runs.offsets[runIndex + 1] as number;
	if (start >= end) return null;
	const length = runs.lengths[runIndex] as number;
	const clamped = Math.max(0, Math.min(runStation, length));
	let low = start;
	let high = end;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((runs.pathStarts[middle] as number) <= clamped + STATION_EPSILON) low = middle + 1;
		else high = middle;
	}
	const offset = Math.max(start, low - 1);
	const pathIndex = runs.pathIndices[offset] as number;
	const pathStart = runs.pathStarts[offset] as number;
	const pathLength = paths.lengths[pathIndex] as number;
	return { pathIndex, pathStation: Math.max(0, Math.min(pathLength, clamped - pathStart)) };
}

function canonicalSharedOwners(paths: CompiledPhysicalPaths): Map<number, number> {
	const owners = new Map<number, number>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const start = paths.sharedSegmentOffsets[pathIndex] as number;
		const end = paths.sharedSegmentOffsets[pathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const id = paths.sharedSegmentIds[row] as number;
			const owner = owners.get(id);
			if (owner === undefined || comparePhysicalPathIdentity(paths, pathIndex, owner) < 0) {
				owners.set(id, pathIndex);
			}
		}
	}
	return owners;
}

function isCanonicalSharedOwner(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	station: number,
	owners: ReadonlyMap<number, number>,
): boolean {
	const start = paths.sharedSegmentOffsets[pathIndex] as number;
	const end = paths.sharedSegmentOffsets[pathIndex + 1] as number;
	for (let row = start; row < end; row++) {
		const sharedStart = paths.sharedSegmentStarts[row] as number;
		const sharedEnd = paths.sharedSegmentEnds[row] as number;
		if (station < sharedStart - STATION_EPSILON || station > sharedEnd + STATION_EPSILON) continue;
		if (owners.get(paths.sharedSegmentIds[row] as number) !== pathIndex) return false;
	}
	return true;
}

function supportsAllowedOnPath(paths: CompiledPhysicalPaths, pathIndex: number): boolean {
	const kind = paths.kinds[pathIndex] as number;
	return (
		kind !== PATH_KIND.INVALID &&
		kind !== PATH_KIND.TERMINAL &&
		kind !== PATH_KIND.TURNOUT_TRUNK &&
		kind !== PATH_KIND.TURNOUT_DIVERGE &&
		kind !== PATH_KIND.ADVANCED_SWITCH_SEGMENT
	);
}

function isLowCurvature(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	station: number,
	profile: RailPresentationProfile,
): boolean {
	const length = paths.lengths[pathIndex] as number;
	const before = samplePhysicalPath(
		paths,
		pathIndex,
		Math.max(0, station - profile.supportCurvatureProbeMeters),
	);
	const after = samplePhysicalPath(
		paths,
		pathIndex,
		Math.min(length, station + profile.supportCurvatureProbeMeters),
	);
	if (!before || !after) return false;
	return (
		before.tangentX * after.tangentX + before.tangentY * after.tangentY >=
		profile.supportMinimumTangentDot
	);
}

function jointKind(
	paths: CompiledPhysicalPaths,
	previousPathIndex: number,
	nextPathIndex: number,
): RailDecorationKind {
	const previousKind = previousPathIndex >= 0 ? (paths.kinds[previousPathIndex] as number) : -1;
	const nextKind = nextPathIndex >= 0 ? (paths.kinds[nextPathIndex] as number) : -1;
	if (isSwitchKind(previousKind) || isSwitchKind(nextKind)) {
		return RAIL_DECORATION_KIND.SWITCH_JOINT;
	}
	if (previousKind !== nextKind || (previousKind >= 0 && previousKind !== PATH_KIND.LINEAR)) {
		return RAIL_DECORATION_KIND.PROFILE_JOINT;
	}
	return RAIL_DECORATION_KIND.METRIC_JOINT;
}

function pathsJoinTangentially(
	paths: CompiledPhysicalPaths,
	fromPathIndex: number,
	toPathIndex: number,
): boolean {
	const from = samplePhysicalPath(paths, fromPathIndex, paths.lengths[fromPathIndex] as number);
	const to = samplePhysicalPath(paths, toPathIndex, 0);
	if (!from || !to) return false;
	return (
		Math.hypot(from.x - to.x, from.y - to.y) <= SEAM_POSITION_TOLERANCE_METERS &&
		from.tangentX * to.tangentX + from.tangentY * to.tangentY >= SEAM_MINIMUM_TANGENT_DOT
	);
}

function isValidPath(paths: CompiledPhysicalPaths, pathIndex: number): boolean {
	return (
		(paths.kinds[pathIndex] as number) !== PATH_KIND.INVALID &&
		(paths.lengths[pathIndex] as number) > STATION_EPSILON
	);
}

function isSwitchBoundaryPath(paths: CompiledPhysicalPaths, pathIndex: number): boolean {
	return isSwitchKind(paths.kinds[pathIndex] as number);
}

function isSwitchKind(kind: number): boolean {
	return (
		kind === PATH_KIND.TURNOUT_TRUNK ||
		kind === PATH_KIND.TURNOUT_DIVERGE ||
		kind === PATH_KIND.ADVANCED_SWITCH_SEGMENT
	);
}

function findAvailableFlowStation(
	intendedStation: number,
	runLength: number,
	closed: boolean,
	jointStations: readonly number[],
	supportStations: readonly number[],
	profile: RailPresentationProfile,
): number | null {
	const maxShift = Math.min(profile.flowIntervalMeters * 0.45, runLength / 2);
	const step = Math.min(0.1, Math.max(0.02, maxShift / 6));
	const steps = Math.max(0, Math.ceil(maxShift / step));
	const visited = new Set<number>();
	for (let index = 0; index <= steps; index++) {
		for (const sign of index === 0 ? [0] : [1, -1]) {
			const station = normalizeRunStation(intendedStation + sign * index * step, runLength, closed);
			if (station === null) continue;
			const key = quantize(station);
			if (visited.has(key)) continue;
			visited.add(key);
			if (
				nearestRunDistance(station, jointStations, runLength, closed) >=
					profile.flowHardwareExclusionMeters &&
				nearestRunDistance(station, supportStations, runLength, closed) >=
					profile.flowHardwareExclusionMeters
			) {
				return station;
			}
		}
	}
	return null;
}

function bestFallbackFlowStation(
	runLength: number,
	closed: boolean,
	jointStations: readonly number[],
	supportStations: readonly number[],
): { station: number; clearance: number } {
	const probeCount = Math.max(8, Math.min(64, Math.ceil(runLength / 0.1)));
	let bestStation = runLength / 2;
	let bestClearance = -1;
	for (let index = 0; index < probeCount; index++) {
		const station = closed
			? (index / probeCount) * runLength
			: ((index + 0.5) / probeCount) * runLength;
		const clearance = Math.min(
			nearestRunDistance(station, jointStations, runLength, closed),
			nearestRunDistance(station, supportStations, runLength, closed),
		);
		if (clearance > bestClearance) {
			bestStation = station;
			bestClearance = clearance;
		}
	}
	return { station: bestStation, clearance: bestClearance };
}

function repeatedDecorationCount(
	firstStation: number,
	interval: number,
	exclusiveEnd: number,
	label: string,
): number {
	if (firstStation >= exclusiveEnd) return 0;
	return assertDecorationCount(Math.ceil((exclusiveEnd - firstStation) / interval), label);
}

function assertDecorationCount(count: number, label: string): number {
	if (!Number.isSafeInteger(count) || count < 0 || count > MAX_DECORATIONS_PER_RUN) {
		throw new RangeError(
			`Rail presentation ${label} decoration count exceeds ${MAX_DECORATIONS_PER_RUN} per run.`,
		);
	}
	return count;
}

function isFlowDecoration(kind: RailDecorationKind): boolean {
	return kind === RAIL_DECORATION_KIND.FLOW || kind === RAIL_DECORATION_KIND.FLOW_COMPACT;
}

function normalizeRunStation(station: number, runLength: number, closed: boolean): number | null {
	if (closed) return ((station % runLength) + runLength) % runLength;
	if (station <= STATION_EPSILON || station >= runLength - STATION_EPSILON) return null;
	return station;
}

function nearestRunDistance(
	station: number,
	others: readonly number[],
	runLength: number,
	closed: boolean,
): number {
	const direct = nearestSortedDistance(station, others);
	if (!closed || others.length === 0) return direct;
	const first = others[0] as number;
	const last = others[others.length - 1] as number;
	return Math.min(
		direct,
		Math.abs(station + runLength - last),
		Math.abs(first + runLength - station),
	);
}

function nearestSortedDistance(station: number, others: readonly number[]): number {
	if (others.length === 0) return Number.POSITIVE_INFINITY;
	let low = 0;
	let high = others.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((others[middle] as number) < station) low = middle + 1;
		else high = middle;
	}
	const before =
		low > 0 ? Math.abs(station - (others[low - 1] as number)) : Number.POSITIVE_INFINITY;
	const after =
		low < others.length ? Math.abs((others[low] as number) - station) : Number.POSITIVE_INFINITY;
	return Math.min(before, after);
}

function decorationStableId(
	paths: CompiledPhysicalPaths,
	candidate: DecorationCandidate,
): readonly [number, number] {
	let high = 0x811c9dc5;
	let low = 0x9e3779b9;
	for (let field = 0; field < PHYSICAL_PATH_IDENTITY_WIDTH; field++) {
		const value = physicalPathIdentityField(paths, candidate.pathIndex, field);
		high = hashWord(high, value);
		low = hashWord(low, Math.imul(value ^ field, 0x45d9f3b));
	}
	high = hashWord(high, candidate.kind);
	high = hashWord(high, quantize(candidate.x));
	low = hashWord(low, quantize(candidate.y));
	low = hashWord(low, quantize(candidate.runStation));
	return [high >>> 0, low >>> 0];
}

function hashWord(hash: number, value: number): number {
	return Math.imul(hash ^ value, 0x01000193) >>> 0;
}

function quantize(value: number): number {
	return Math.round(value * POSITION_QUANTIZATION);
}
