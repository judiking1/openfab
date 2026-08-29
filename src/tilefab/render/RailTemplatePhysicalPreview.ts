import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { PATH_KIND, samplePhysicalPath } from "../compile/PhysicalPathCompiler";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	instantiateRailTemplate,
	planRailTemplate,
	railTemplateCatalogItem,
	railTemplateParameterValue,
	transformRailTemplateBlueprint,
	type RailTemplateId,
	type RailTemplateParameters,
	type RailTemplatePose,
} from "../core/RailTemplateCatalog";
import { moveCell, oppositeDirection, type Direction } from "../core/railShape";
import type { Cell } from "../core/TileMap";
import {
	compilePhysicalRailPresentation,
	type CompiledRailPresentation,
} from "./PhysicalRailPresentation";

const PREVIEW_CACHE_ENTRY_LIMIT = 64;
const PREVIEW_CACHE_TYPED_ARRAY_BYTE_LIMIT = 8 * 1024 * 1024;

interface RailTemplatePhysicalPreviewCacheEntry {
	readonly preview: RailTemplatePhysicalPreview;
	readonly retainedTypedArrayBytes: number;
}

const previewCache = new Map<string, RailTemplatePhysicalPreviewCacheEntry>();
let previewCacheTypedArrayBytes = 0;

export interface RailTemplatePreviewBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface RailTemplatePreviewConnector {
	readonly start: Cell;
	readonly end: Cell;
	readonly travelDirection: Direction;
	readonly spanMeters: number;
	readonly supportBeforeMeters: number;
	readonly supportAfterMeters: number;
}

export interface RailTemplatePhysicalPreviewCacheStats {
	readonly entryCount: number;
	readonly retainedTypedArrayBytes: number;
	readonly entryLimit: number;
	readonly typedArrayByteLimit: number;
}

export interface RailTemplatePreviewFlowMarker {
	readonly x: number;
	readonly y: number;
	readonly tangentX: number;
	readonly tangentY: number;
	readonly pathKind: number;
}

/** Renderer-independent physical result used by cards, configurators, and future 3D inspectors. */
export interface RailTemplatePhysicalPreview {
	readonly key: string;
	readonly presentation: CompiledRailPresentation;
	readonly bounds: RailTemplatePreviewBounds;
	readonly connectors: readonly RailTemplatePreviewConnector[];
	readonly flowMarkers: readonly RailTemplatePreviewFlowMarker[];
	readonly buildLengthMeters: number;
	readonly totalLengthMeters: number;
	readonly curvePathCount: number;
	readonly turnoutPathCount: number;
}

/**
 * Build a catalog motif through the ordinary authored grammar and physical compiler. Attached motifs
 * receive only the minimum directed support trunk required by their public connector contract.
 */
export function compileRailTemplatePhysicalPreview(
	id: RailTemplateId,
	parameters: RailTemplateParameters,
	pose: RailTemplatePose,
): RailTemplatePhysicalPreview {
	const item = railTemplateCatalogItem(id);
	const blueprint = instantiateRailTemplate(id, parameters);
	const key = [
		id,
		item.version,
		blueprint.definitionFingerprint,
		pose.forward,
		pose.side,
		pose.flow ?? "forward",
		...item.parameters.map(
			(descriptor) => `${descriptor.key}=${railTemplateParameterValue(parameters, descriptor.key)}`,
		),
	].join(":");
	const cachedEntry = previewCache.get(key);
	if (cachedEntry) {
		previewCache.delete(key);
		previewCache.set(key, cachedEntry);
		return cachedEntry.preview;
	}
	const transformed = transformRailTemplateBlueprint(blueprint, { x: 0, y: 0 }, pose);

	const document = new RailDocument();
	for (const connector of transformed.compositionConnectors) {
		if (item.anchorRequirement !== "directed-straight-trunk") break;
		if (connector.kind !== "shared-trunk") continue;
		const before = moveRepeated(
			connector.startCell,
			oppositeDirection(connector.geometricDirection),
			connector.supportBeforeMeters + 1,
		);
		const after = moveRepeated(
			connector.endCell,
			connector.geometricDirection,
			connector.supportAfterMeters + 1,
		);
		const trunkPlan = planRailConstruction(
			document.map,
			connector.travelDirection === connector.geometricDirection ? before : after,
			connector.travelDirection === connector.geometricDirection ? after : before,
		);
		if (!trunkPlan.valid || !document.commit(trunkPlan)) {
			throw new Error(`Cannot build ${id} preview trunk: ${trunkPlan.reason}`);
		}
	}

	const plan = planRailTemplate(document.map, id, { x: 0, y: 0 }, pose, parameters);
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Cannot build ${id} physical preview: ${plan.reason}`);
	}
	const presentation = compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
	const preview = Object.freeze({
		key,
		presentation,
		bounds: physicalBounds(presentation),
		connectors: Object.freeze(
			transformed.compositionConnectors.flatMap((connector) =>
				item.anchorRequirement === "directed-straight-trunk" &&
				connector.kind === "shared-trunk"
					? [
							Object.freeze({
								start: Object.freeze({ ...connector.startCell }),
								end: Object.freeze({ ...connector.endCell }),
									travelDirection: connector.travelDirection,
									spanMeters: connector.spanMeters,
									supportBeforeMeters: connector.supportBeforeMeters,
									supportAfterMeters: connector.supportAfterMeters,
								}),
						]
					: [],
			),
		),
		flowMarkers: compileStableFlowMarkers(presentation, 12),
		buildLengthMeters: plan.lengthMeters,
		totalLengthMeters: presentation.source.totalLengthMeters,
		curvePathCount: countKinds(presentation, [
			PATH_KIND.CURVE,
			PATH_KIND.COMPOUND_CCW,
			PATH_KIND.COMPOUND_S,
			PATH_KIND.COMPOUND_CSC_HOMO,
			PATH_KIND.COMPOUND_CSC_HETE,
			PATH_KIND.COMPOUND_RIGHT,
		]),
		turnoutPathCount: countKinds(presentation, [PATH_KIND.TURNOUT_DIVERGE]),
	}) satisfies RailTemplatePhysicalPreview;
	const retainedTypedArrayBytes = estimateRetainedTypedArrayBytes(preview.presentation);
	previewCache.set(key, Object.freeze({ preview, retainedTypedArrayBytes }));
	previewCacheTypedArrayBytes += retainedTypedArrayBytes;
	const evictionCount = railTemplatePhysicalPreviewCacheEvictionCount(
		[...previewCache.values()].map((entry) => entry.retainedTypedArrayBytes),
	);
	for (let index = 0; index < evictionCount; index++) {
		const oldest = previewCache.keys().next().value as string | undefined;
		if (oldest === undefined) break;
		const removed = previewCache.get(oldest);
		previewCache.delete(oldest);
		previewCacheTypedArrayBytes -= removed?.retainedTypedArrayBytes ?? 0;
	}
	return preview;
}

export function railTemplatePhysicalPreviewCacheStats(): RailTemplatePhysicalPreviewCacheStats {
	return Object.freeze({
		entryCount: previewCache.size,
		retainedTypedArrayBytes: previewCacheTypedArrayBytes,
		entryLimit: PREVIEW_CACHE_ENTRY_LIMIT,
		typedArrayByteLimit: PREVIEW_CACHE_TYPED_ARRAY_BYTE_LIMIT,
	});
}

export function railTemplatePhysicalPreviewCacheEvictionCount(
	retainedByteSizes: readonly number[],
	entryLimit = PREVIEW_CACHE_ENTRY_LIMIT,
	typedArrayByteLimit = PREVIEW_CACHE_TYPED_ARRAY_BYTE_LIMIT,
): number {
	if (!Number.isInteger(entryLimit) || entryLimit < 0) {
		throw new RangeError("Preview cache entry limit must be a non-negative integer.");
	}
	if (!Number.isSafeInteger(typedArrayByteLimit) || typedArrayByteLimit < 0) {
		throw new RangeError("Preview cache byte limit must be a non-negative safe integer.");
	}
	let retainedBytes = 0;
	for (const byteSize of retainedByteSizes) {
		if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
			throw new RangeError("Preview cache retained byte sizes must be non-negative safe integers.");
		}
		retainedBytes += byteSize;
	}
	let evictionCount = 0;
	while (
		evictionCount < retainedByteSizes.length &&
		(retainedByteSizes.length - evictionCount > entryLimit ||
			retainedBytes > typedArrayByteLimit)
	) {
		retainedBytes -= retainedByteSizes[evictionCount] ?? 0;
		evictionCount++;
	}
	return evictionCount;
}

export function tryCompileRailTemplatePhysicalPreview(
	id: RailTemplateId,
	parameters: RailTemplateParameters,
	pose: RailTemplatePose,
): RailTemplatePhysicalPreview | null {
	try {
		return compileRailTemplatePhysicalPreview(id, parameters, pose);
	} catch {
		return null;
	}
}

function compileStableFlowMarkers(
	presentation: CompiledRailPresentation,
	maximum: number,
): readonly RailTemplatePreviewFlowMarker[] {
	const priority: MarkerCandidate[] = [];
	const regular: MarkerCandidate[] = [];
	const paths = presentation.source;
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const kind = paths.kinds[pathIndex] as number;
		const length = paths.lengths[pathIndex] as number;
		if (kind === PATH_KIND.INVALID || kind === PATH_KIND.TERMINAL || length <= 0.001) continue;
		const sample = samplePhysicalPath(paths, pathIndex, length / 2);
		if (sample === null) continue;
		const candidate = Object.freeze({
			key: markerLocationKey(sample.x, sample.y, kind),
			x: sample.x,
			y: sample.y,
			tangentX: sample.tangentX,
			tangentY: sample.tangentY,
			pathKind: kind,
		}) satisfies MarkerCandidate;
		if (kind === PATH_KIND.TURNOUT_DIVERGE) priority.push(candidate);
		else if (kind !== PATH_KIND.TURNOUT_TRUNK) regular.push(candidate);
	}

	const selectedPriority = spatiallySelectMarkers(priority, maximum, []);
	const selectedRegular = spatiallySelectMarkers(
		regular,
		Math.max(0, maximum - selectedPriority.length),
		selectedPriority,
	);
	const selected = [...selectedPriority, ...selectedRegular];
	return Object.freeze(
		selected
			.sort(compareMarkerCandidates)
			.map(({ x, y, tangentX, tangentY, pathKind }) =>
				Object.freeze({ x, y, tangentX, tangentY, pathKind }),
			),
	);
}

interface MarkerCandidate extends RailTemplatePreviewFlowMarker {
	readonly key: string;
}

function markerLocationKey(x: number, y: number, kind: number): string {
	return `${Math.round(x * 10_000)}:${Math.round(y * 10_000)}:${kind}`;
}

function compareMarkerCandidates(left: MarkerCandidate, right: MarkerCandidate): number {
	return left.key.localeCompare(right.key);
}

function squaredDistance(left: MarkerCandidate, right: MarkerCandidate): number {
	const dx = left.x - right.x;
	const dy = left.y - right.y;
	return dx * dx + dy * dy;
}

function spatiallySelectMarkers(
	candidates: readonly MarkerCandidate[],
	maximum: number,
	seeds: readonly MarkerCandidate[],
): readonly MarkerCandidate[] {
	if (maximum <= 0 || candidates.length === 0) return Object.freeze([]);
	const remaining = deduplicateMarkers(candidates).sort(compareMarkerCandidates);
	const selected: MarkerCandidate[] = [];
	while (selected.length < maximum && remaining.length > 0) {
		const anchors = [...seeds, ...selected];
		let bestIndex = 0;
		let bestDistance = Number.NEGATIVE_INFINITY;
		for (let index = 0; index < remaining.length; index++) {
			const candidate = remaining[index] as MarkerCandidate;
			const distance =
				anchors.length === 0
					? Number.POSITIVE_INFINITY
					: Math.min(...anchors.map((anchor) => squaredDistance(candidate, anchor)));
			if (
				distance > bestDistance ||
				(distance === bestDistance &&
					compareMarkerCandidates(candidate, remaining[bestIndex] as MarkerCandidate) < 0)
			) {
				bestIndex = index;
				bestDistance = distance;
			}
		}
		selected.push(remaining.splice(bestIndex, 1)[0] as MarkerCandidate);
	}
	return Object.freeze(selected);
}

function deduplicateMarkers(candidates: readonly MarkerCandidate[]): MarkerCandidate[] {
	const markers = new Map<string, MarkerCandidate>();
	for (const candidate of candidates) {
		const positionKey = `${Math.round(candidate.x * 10_000)}:${Math.round(candidate.y * 10_000)}`;
		if (!markers.has(positionKey)) markers.set(positionKey, candidate);
	}
	return [...markers.values()];
}

function physicalBounds(presentation: CompiledRailPresentation): RailTemplatePreviewBounds {
	const positions = presentation.source.positions;
	if (positions.length < 2) throw new Error("Physical template preview has no sampled positions.");
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let offset = 0; offset < positions.length; offset += 2) {
		const x = positions[offset] as number;
		const y = positions[offset + 1] as number;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	const margin = presentation.maxLateralExtentMeters + 0.45;
	return Object.freeze({
		minX: minX - margin,
		minY: minY - margin,
		maxX: maxX + margin,
		maxY: maxY + margin,
	});
}

function countKinds(
	presentation: CompiledRailPresentation,
	kinds: readonly number[],
): number {
	const accepted = new Set(kinds);
	let count = 0;
	for (const kind of presentation.source.kinds) if (accepted.has(kind)) count++;
	return count;
}

function moveRepeated(origin: Cell, direction: Direction, count: number): Cell {
	let current = origin;
	for (let index = 0; index < count; index++) current = moveCell(current, direction);
	return current;
}

function estimateRetainedTypedArrayBytes(root: object): number {
	const objects = new Set<object>();
	const buffers = new Set<ArrayBufferLike>();
	const pending: unknown[] = [root];
	while (pending.length > 0) {
		const value = pending.pop();
		if (typeof value !== "object" || value === null || objects.has(value)) continue;
		objects.add(value);
		if (ArrayBuffer.isView(value)) {
			buffers.add(value.buffer);
			continue;
		}
		for (const child of Object.values(value)) pending.push(child);
	}
	let bytes = 0;
	for (const buffer of buffers) bytes += buffer.byteLength;
	return bytes;
}
