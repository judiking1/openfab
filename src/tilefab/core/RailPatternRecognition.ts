import { type RailAreaSelection, railAreaSelectionStaleReason } from "./RailAreaSelection";
import { createRailAreaStampTemplate } from "./RailAreaStamp";
import {
	attachedPatternMatchesMap,
	attachedSelectionContextMatchesTrunk,
	extractAttachedPatternSelection,
} from "./RailAttachedPatternRecognition";
import type { DirectedRailEdge, RailModuleOwnershipIndex } from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	instantiateRailTemplate,
	RAIL_TEMPLATE_CATALOG,
	type RailTemplateId,
	type RailTemplateParameterKey,
	type RailTemplateParameters,
	type RailTemplatePose,
	railTemplateCatalogItem,
	railTemplateParameterValue,
	railTemplateTravelDirection,
	setRailTemplateParameter,
	transformRailTemplateBlueprint,
} from "./RailTemplateCatalog";
import { ALL_DIRECTIONS, DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "./railShape";
import type { Cell, TileMap } from "./TileMap";

const CLOSED_RECOGNIZABLE_TEMPLATE_IDS = Object.freeze(
	RAIL_TEMPLATE_CATALOG.filter((item) => item.anchorRequirement === "free-closed").map(
		(item) => item.id,
	),
);
const ATTACHED_RECOGNIZABLE_TEMPLATE_IDS = Object.freeze(
	RAIL_TEMPLATE_CATALOG.filter((item) => item.anchorRequirement === "directed-straight-trunk").map(
		(item) => item.id,
	),
);

export type RailPatternRecognitionState = "recognized" | "ambiguous" | "unsupported" | "stale";
export type RailPatternScope = "closed-assembly" | "attached-delta";

/** Runtime-only interpretation of an exact selected graph. Never persisted with project data. */
export interface RailPatternCandidate {
	readonly scope: RailPatternScope;
	readonly sourceRevision: number;
	readonly templateId: RailTemplateId;
	readonly templateVersion: number;
	readonly parameters: RailTemplateParameters;
	readonly pose: RailTemplatePose;
	readonly anchor: Cell;
	readonly edgeCount: number;
	readonly widthMeters: number;
	readonly heightMeters: number;
	readonly deltaEdgeCount: number;
	readonly selectedContextEdgeCount: number;
}

export interface RailPatternRecognition {
	readonly state: RailPatternRecognitionState;
	readonly revision: number;
	readonly candidates: readonly RailPatternCandidate[];
	readonly reason: string;
}

/**
 * Match a complete directed selection against the versioned catalog by exact edge identity.
 * Integer parameter candidates are derived from the selected bounds before any blueprint is built,
 * keeping work local and bounded instead of enumerating the full parameter product.
 *
 * A map reader additionally enables recognition of attached patterns. Their selected edges are the
 * authored branch-route delta, while the parent trunk remains outside the selection and is proven
 * independently from current TileMap truth. No catalog provenance is persisted.
 */
export function recognizeRailPattern(
	selection: RailAreaSelection,
	map?: TileMap,
	ownershipIndex?: RailModuleOwnershipIndex,
): RailPatternRecognition {
	if (map && ownershipIndex) {
		const staleReason = railAreaSelectionStaleReason(map, ownershipIndex, selection);
		if (staleReason) return staleRecognition(selection.revision, staleReason);
	} else if (map && selection.revision !== map.getRevision()) {
		return staleRecognition(
			selection.revision,
			"선택 영역이 오래되어 현재 레일에서 패턴을 다시 선택해야 합니다",
		);
	}

	const sourceEdges = selectedDirectedEdges(selection);
	if (sourceEdges.length === 0) {
		return unsupportedRecognition(selection.revision, "선택 영역에 분석할 레일 edge가 없습니다");
	}
	const sourceBounds = edgeBounds(sourceEdges);
	const sourceKeys = normalizedEdgeKeys(sourceEdges);
	const sourceHasOpenEnds = selectedEdgesHaveOpenEnds(sourceEdges);
	const candidates = new Map<string, RailPatternCandidate>();
	let closedSelectionError: string | null = null;

	try {
		const stamp = createRailAreaStampTemplate(selection);
		collectPatternCandidates(
			CLOSED_RECOGNIZABLE_TEMPLATE_IDS,
			stamp.sourceWidthMeters,
			stamp.sourceHeightMeters,
			stamp.sourceEdgeCount,
			sourceBounds,
			sourceKeys,
			candidates,
			"closed-assembly",
			selection.revision,
		);
	} catch (error) {
		closedSelectionError =
			error instanceof Error ? error.message : "선택 영역을 폐합 패턴으로 분석할 수 없습니다";
	}

	const attachedSelection = map ? extractAttachedPatternSelection(selection, map) : null;
	if (map && attachedSelection) {
		const deltaBounds = edgeBounds(attachedSelection.deltaEdges);
		const deltaKeys = normalizedEdgeKeys(attachedSelection.deltaEdges);
		const deltaAbsoluteKeys = absoluteEdgeKeys(attachedSelection.deltaEdges);
		collectPatternCandidates(
			ATTACHED_RECOGNIZABLE_TEMPLATE_IDS,
			deltaBounds.maxX - deltaBounds.minX,
			deltaBounds.maxY - deltaBounds.minY,
			attachedSelection.deltaEdges.length,
			deltaBounds,
			deltaKeys,
			candidates,
			"attached-delta",
			selection.revision,
			(transformed) =>
				sameStrings(deltaAbsoluteKeys, absoluteRouteEdgeKeys(transformed.buildRoutes)) &&
				attachedSelectionContextMatchesTrunk(
					map,
					attachedSelection.contextEdges,
					transformed.compositionConnectors,
				) &&
				attachedPatternMatchesMap(map, transformed.buildRoutes, transformed.compositionConnectors),
			attachedSelection.contextEdges.length,
		);
	}

	const ordered = Object.freeze([...candidates.values()].sort(compareCandidates));
	if (ordered.length === 0) {
		return unsupportedRecognition(
			selection.revision,
			map
				? "선택 영역이 완전한 폐합 FAB 패턴 또는 하나의 접선 결합 Bay와 정확히 일치하지 않습니다"
				: (closedSelectionError ??
						(sourceHasOpenEnds
							? "FAB 패턴 인식은 열린 조각이 아닌 완전한 폐합 유향 패턴을 선택해야 합니다"
							: "완전한 폐합 레일이지만 현재 FAB 패턴 카탈로그의 규격과 정확히 일치하지 않습니다")),
		);
	}
	if (ordered.length === 1) {
		const candidate = ordered[0] as RailPatternCandidate;
		const item = railTemplateCatalogItem(candidate.templateId);
		const attachment =
			item.anchorRequirement === "directed-straight-trunk"
				? `본선 ${travelDirectionLabel(railTemplateTravelDirection(candidate.pose))} · ${candidate.pose.side.toUpperCase()} 결합 · `
				: "";
		return Object.freeze({
			state: "recognized",
			revision: selection.revision,
			candidates: ordered,
			reason: `${item.label} · ${attachment}${patternDimensionSummary(candidate)}`,
		});
	}
	return Object.freeze({
		state: "ambiguous",
		revision: selection.revision,
		candidates: ordered,
		reason: `${ordered.length}개 카탈로그 패턴과 일치합니다. 다시 사용할 패턴 종류를 선택하세요`,
	});
}

function collectPatternCandidates(
	templateIds: readonly RailTemplateId[],
	widthMeters: number,
	heightMeters: number,
	edgeCount: number,
	sourceBounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
	sourceKeys: readonly string[],
	candidates: Map<string, RailPatternCandidate>,
	scope: RailPatternScope,
	sourceRevision: number,
	additionalMatch:
		| ((transformed: ReturnType<typeof transformRailTemplateBlueprint>) => boolean)
		| null = null,
	selectedContextEdgeCount = 0,
): void {
	for (const templateId of templateIds) {
		for (const forward of ALL_DIRECTIONS) {
			const forwardExtent = forward === DIR_E || forward === DIR_W ? widthMeters : heightMeters;
			const lateralExtent = forward === DIR_E || forward === DIR_W ? heightMeters : widthMeters;
			for (const parameters of deriveParameterCandidates(
				templateId,
				forwardExtent,
				lateralExtent,
			)) {
				let blueprint: ReturnType<typeof instantiateRailTemplate>;
				try {
					blueprint = instantiateRailTemplate(templateId, parameters);
				} catch {
					continue;
				}
				for (const side of ["right", "left"] as const) {
					for (const flow of ["forward", "reverse"] as const) {
						const pose = Object.freeze({ forward, side, flow }) satisfies RailTemplatePose;
						const transformed = transformRailTemplateBlueprint(blueprint, { x: 0, y: 0 }, pose);
						if (!sameStrings(sourceKeys, normalizedRouteEdgeKeys(transformed.buildRoutes)))
							continue;
						const transformedBounds = cellBounds(transformed.occupiedCells);
						const anchor = Object.freeze({
							x: sourceBounds.minX - transformedBounds.minX,
							y: sourceBounds.minY - transformedBounds.minY,
						});
						const anchored = transformRailTemplateBlueprint(blueprint, anchor, pose);
						if (additionalMatch && !additionalMatch(anchored)) continue;

						const item = railTemplateCatalogItem(templateId);
						const candidate = Object.freeze({
							scope,
							sourceRevision,
							templateId,
							templateVersion: item.version,
							parameters,
							pose,
							anchor,
							edgeCount,
							widthMeters,
							heightMeters,
							deltaEdgeCount: edgeCount,
							selectedContextEdgeCount,
						}) satisfies RailPatternCandidate;
						const identity = railPatternCandidateIdentity(candidate);
						if (!candidates.has(identity)) candidates.set(identity, candidate);
					}
				}
			}
		}
	}
}

export function patternDimensionSummary(candidate: RailPatternCandidate): string {
	const item = railTemplateCatalogItem(candidate.templateId);
	return item.parameters
		.map(
			(descriptor) =>
				`${descriptor.label} ${railTemplateParameterValue(candidate.parameters, descriptor.key)} ${descriptor.unit}`,
		)
		.join(" · ");
}

export function railPatternCandidateIdentity(candidate: RailPatternCandidate): string {
	const item = railTemplateCatalogItem(candidate.templateId);
	return [
		candidate.scope,
		candidate.templateId,
		candidate.templateVersion,
		...item.parameters.map((descriptor) =>
			railTemplateParameterValue(candidate.parameters, descriptor.key),
		),
	].join(":");
}

function deriveParameterCandidates(
	templateId: RailTemplateId,
	forwardExtent: number,
	lateralExtent: number,
): readonly RailTemplateParameters[] {
	const values: Array<Readonly<Record<RailTemplateParameterKey, number>>> = [];
	if (templateId === "long-bay" || templateId === "outer-loop") {
		// A rectangle rotated by 90 degrees is the same authored graph. Keep its long axis as the
		// semantic aisle/length so the catalog never exposes duplicate poses with swapped dimensions.
		if (forwardExtent < lateralExtent) return Object.freeze([]);
		values.push(
			parameterValues({ aisleLengthMeters: forwardExtent, laneSpacingMeters: lateralExtent }),
		);
	} else if (templateId === "paired-bay") {
		if (lateralExtent % 2 === 0) {
			values.push(
				parameterValues({
					aisleLengthMeters: forwardExtent,
					laneSpacingMeters: lateralExtent / 2,
				}),
			);
		}
	} else if (templateId === "nested-bay") {
		for (let offsetMeters = 3; offsetMeters <= 24; offsetMeters++) {
			values.push(
				parameterValues({
					aisleLengthMeters: forwardExtent,
					laneSpacingMeters: lateralExtent,
					offsetMeters,
				}),
			);
		}
	} else if (templateId === "shift-bay") {
		for (let offsetMeters = 2; offsetMeters <= 10; offsetMeters++) {
			values.push(
				parameterValues({
					aisleLengthMeters: forwardExtent,
					laneSpacingMeters: lateralExtent - offsetMeters,
					offsetMeters,
				}),
			);
		}
	} else if (templateId === "interbay-spine" && lateralExtent % 2 === 0) {
		const descriptors = railTemplateCatalogItem(templateId).parameters;
		const bayCountDescriptor = descriptors.find((descriptor) => descriptor.key === "bayCount");
		const bayPitchDescriptor = descriptors.find(
			(descriptor) => descriptor.key === "bayPitchMeters",
		);
		if (!bayCountDescriptor || !bayPitchDescriptor) return Object.freeze([]);
		for (
			let bayCount = bayCountDescriptor.minimum;
			bayCount <= bayCountDescriptor.maximum;
			bayCount += bayCountDescriptor.step
		) {
			for (
				let bayPitchMeters = bayPitchDescriptor.minimum;
				bayPitchMeters <= bayPitchDescriptor.maximum;
				bayPitchMeters += bayPitchDescriptor.step
			) {
				if (bayCount * bayPitchMeters + 4 > forwardExtent) continue;
				values.push(
					parameterValues({
						bayCount,
						bayPitchMeters,
						laneSpacingMeters: lateralExtent / 2,
						aisleLengthMeters: forwardExtent,
					}),
				);
			}
		}
	} else if (templateId === "attached-return") {
		values.push(
			parameterValues({
				runLengthMeters: lateralExtent,
				laneSpacingMeters: forwardExtent,
			}),
		);
	} else if (templateId === "branch-bypass" || templateId === "outerbay-link") {
		values.push(
			parameterValues({
				trunkSpanMeters: forwardExtent,
				offsetMeters: lateralExtent,
			}),
		);
	}

	const candidates: RailTemplateParameters[] = [];
	for (const candidateValues of values) {
		let parameters = defaultRailTemplateParameters(templateId);
		let valid = true;
		for (const descriptor of railTemplateCatalogItem(templateId).parameters) {
			const value = candidateValues[descriptor.key];
			if (
				!Number.isSafeInteger(value) ||
				value < descriptor.minimum ||
				value > descriptor.maximum ||
				value % descriptor.step !== 0
			) {
				valid = false;
				break;
			}
			parameters = setRailTemplateParameter(templateId, parameters, descriptor.key, value);
		}
		if (!valid) continue;
		try {
			instantiateRailTemplate(templateId, parameters);
			candidates.push(parameters);
		} catch {
			// Relationship validation intentionally removes impossible integer combinations.
		}
	}
	return Object.freeze(candidates);
}

function parameterValues(
	values: Partial<Record<RailTemplateParameterKey, number>>,
): Readonly<Record<RailTemplateParameterKey, number>> {
	return values as Readonly<Record<RailTemplateParameterKey, number>>;
}

function selectedDirectedEdges(selection: RailAreaSelection): readonly DirectedRailEdge[] {
	const edges = new Map<string, DirectedRailEdge>();
	for (const ownership of selection.ownerships) {
		for (const edge of ownership.eraseEdges) edges.set(edgeKey(edge), edge);
	}
	return Object.freeze([...edges.values()].sort(compareEdges));
}

function selectedEdgesHaveOpenEnds(edges: readonly DirectedRailEdge[]): boolean {
	const degrees = new Map<string, { incoming: number; outgoing: number }>();
	for (const edge of edges) {
		const fromKey = `${edge.from.x}:${edge.from.y}`;
		const toKey = `${edge.to.x}:${edge.to.y}`;
		const from = degrees.get(fromKey) ?? { incoming: 0, outgoing: 0 };
		const to = degrees.get(toKey) ?? { incoming: 0, outgoing: 0 };
		from.outgoing++;
		to.incoming++;
		degrees.set(fromKey, from);
		degrees.set(toKey, to);
	}
	for (const degree of degrees.values()) {
		if (degree.incoming === 0 || degree.outgoing === 0) return true;
	}
	return false;
}

function normalizedRouteEdgeKeys(routes: readonly (readonly Cell[])[]): readonly string[] {
	const edges: DirectedRailEdge[] = [];
	for (const route of routes) {
		for (let index = 0; index < route.length - 1; index++) {
			const from = route[index];
			const to = route[index + 1];
			if (from && to) edges.push({ from, to });
		}
	}
	return normalizedEdgeKeys(edges);
}

function absoluteRouteEdgeKeys(routes: readonly (readonly Cell[])[]): readonly string[] {
	const edges: DirectedRailEdge[] = [];
	for (const route of routes) {
		for (let index = 0; index < route.length - 1; index++) {
			const from = route[index];
			const to = route[index + 1];
			if (from && to) edges.push({ from, to });
		}
	}
	return absoluteEdgeKeys(edges);
}

function absoluteEdgeKeys(edges: readonly DirectedRailEdge[]): readonly string[] {
	return Object.freeze([...new Set(edges.map(edgeKey))].sort());
}

function travelDirectionLabel(direction: Direction): string {
	if (direction === DIR_E) return "X+";
	if (direction === DIR_W) return "X-";
	if (direction === DIR_S) return "Z+";
	if (direction === DIR_N) return "Z-";
	return "?";
}

function normalizedEdgeKeys(edges: readonly DirectedRailEdge[]): readonly string[] {
	if (edges.length === 0) return Object.freeze([]);
	const bounds = edgeBounds(edges);
	return Object.freeze(
		[...new Set(edges.map((edge) => normalizedEdgeKey(edge, bounds.minX, bounds.minY)))].sort(),
	);
}

function normalizedEdgeKey(edge: DirectedRailEdge, minX: number, minY: number): string {
	return `${edge.from.x - minX}:${edge.from.y - minY}>${edge.to.x - minX}:${edge.to.y - minY}`;
}

function edgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`;
}

function compareCandidates(left: RailPatternCandidate, right: RailPatternCandidate): number {
	const id = left.templateId.localeCompare(right.templateId);
	if (id !== 0) return id;
	return railPatternCandidateIdentity(left).localeCompare(railPatternCandidateIdentity(right));
}

function compareEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return (
		left.from.y - right.from.y ||
		left.from.x - right.from.x ||
		left.to.y - right.to.y ||
		left.to.x - right.to.x
	);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function edgeBounds(edges: readonly DirectedRailEdge[]): Readonly<{
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}> {
	return cellBounds(edges.flatMap((edge) => [edge.from, edge.to]));
}

function cellBounds(cells: readonly Cell[]): Readonly<{
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}> {
	const first = cells[0];
	if (!first) return Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
	let minX = first.x;
	let minY = first.y;
	let maxX = first.x;
	let maxY = first.y;
	for (const cell of cells.slice(1)) {
		minX = Math.min(minX, cell.x);
		minY = Math.min(minY, cell.y);
		maxX = Math.max(maxX, cell.x);
		maxY = Math.max(maxY, cell.y);
	}
	return Object.freeze({ minX, minY, maxX, maxY });
}

function unsupportedRecognition(revision: number, reason: string): RailPatternRecognition {
	return Object.freeze({
		state: "unsupported",
		revision,
		candidates: Object.freeze([]),
		reason,
	});
}

function staleRecognition(revision: number, reason: string): RailPatternRecognition {
	return Object.freeze({
		state: "stale",
		revision,
		candidates: Object.freeze([]),
		reason,
	});
}
