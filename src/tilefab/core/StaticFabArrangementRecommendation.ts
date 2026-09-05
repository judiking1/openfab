import {
	STATIC_FAB_ARRANGEMENT_VERSION,
	type StaticFabArrangementAxis,
	type StaticFabArrangementMode,
	type StaticFabArrangementRoot,
	solveStaticFabArrangement,
} from "./StaticFabArrangement";

export type StaticFabArrangementRecommendation = Readonly<
	| {
			valid: true;
			code: null;
			axis: StaticFabArrangementAxis;
			mode: StaticFabArrangementMode;
			reason: string;
	  }
	| {
			valid: false;
			code: "ALREADY_ARRANGED" | "NO_RECOMMENDATION";
			axis: null;
			mode: null;
			reason: string;
	  }
>;

const ALIGNMENT_MODES = Object.freeze([
	"ALIGN_CENTER",
	"ALIGN_MIN",
	"ALIGN_MAX",
] as const satisfies readonly StaticFabArrangementMode[]);
const DISTRIBUTION_MODES = Object.freeze([
	"DISTRIBUTE_CENTERS",
	"DISTRIBUTE_GAPS",
] as const satisfies readonly StaticFabArrangementMode[]);

/**
 * Choose the first bounds-safe arrangement worth sending to the exact Worker planner.
 *
 * Alignment across the shorter center spread comes first. If that axis is already aligned, three
 * or more roots next try distribution along their longer spread. Target bounds are conservative:
 * initially disjoint roots never receive an overlapping default, while already-overlapping sparse
 * bounds retain one Worker-reviewed fallback so this heuristic cannot remove an exact-cell feature.
 */
export function recommendStaticFabArrangement(
	roots: readonly StaticFabArrangementRoot[],
): StaticFabArrangementRecommendation {
	if (roots.length < 2) {
		return unavailable(
			"NO_RECOMMENDATION",
			"정렬하려면 서로 독립적인 FAB 루트가 2개 이상 필요합니다",
		);
	}
	const alignmentAxis = preferredAlignmentAxis(roots);
	const spreadAxis = alignmentAxis === "X" ? "Z" : "X";
	const candidates: ReadonlyArray<readonly [StaticFabArrangementAxis, StaticFabArrangementMode]> = [
		...ALIGNMENT_MODES.map((mode) => [alignmentAxis, mode] as const),
		...(roots.length >= 3 ? DISTRIBUTION_MODES.map((mode) => [spreadAxis, mode] as const) : []),
		...ALIGNMENT_MODES.map((mode) => [spreadAxis, mode] as const),
		...(roots.length >= 3 ? DISTRIBUTION_MODES.map((mode) => [alignmentAxis, mode] as const) : []),
	];
	let sawNoChange = false;
	let sawOverlappingTarget = false;
	let overlappingFallback:
		| Readonly<{ axis: StaticFabArrangementAxis; mode: StaticFabArrangementMode }>
		| undefined;
	for (const [axis, mode] of candidates) {
		const solved = solveStaticFabArrangement({
			version: STATIC_FAB_ARRANGEMENT_VERSION,
			axis,
			mode,
			roots,
		});
		if (!solved.valid) {
			sawNoChange ||= solved.code === "NO_CHANGE";
			continue;
		}
		if (translatedBoundsOverlap(solved.translations.map((translation) => translation.after))) {
			sawOverlappingTarget = true;
			overlappingFallback ??= Object.freeze({ axis, mode });
			continue;
		}
		return Object.freeze({
			valid: true,
			code: null,
			axis,
			mode,
			reason: `${axis}축 ${modeLabel(mode)}을 첫 비충돌 배치로 추천합니다`,
		});
	}
	if (overlappingFallback && translatedBoundsOverlap(roots.map((root) => root.bounds))) {
		return Object.freeze({
			valid: true,
			code: null,
			axis: overlappingFallback.axis,
			mode: overlappingFallback.mode,
			reason: "현재 루트 경계가 이미 겹쳐 있어 첫 변경 후보를 exact Worker 검증으로 보냅니다",
		});
	}
	return sawNoChange && sawOverlappingTarget
		? unavailable(
				"ALREADY_ARRANGED",
				"선택한 FAB 루트는 이미 한 축에 맞춰져 있고, 다른 정렬은 루트 경계를 서로 겹칩니다",
			)
		: unavailable(
				"NO_RECOMMENDATION",
				"현재 루트 경계에서 겹치지 않는 정렬 또는 분배 변경을 찾지 못했습니다",
			);
}

function preferredAlignmentAxis(
	roots: readonly StaticFabArrangementRoot[],
): StaticFabArrangementAxis {
	let minimumCenterX = Number.POSITIVE_INFINITY;
	let maximumCenterX = Number.NEGATIVE_INFINITY;
	let minimumCenterZ = Number.POSITIVE_INFINITY;
	let maximumCenterZ = Number.NEGATIVE_INFINITY;
	for (const root of roots) {
		const centerX = root.bounds.minX + root.bounds.maxXExclusive;
		const centerZ = root.bounds.minZ + root.bounds.maxZExclusive;
		minimumCenterX = Math.min(minimumCenterX, centerX);
		maximumCenterX = Math.max(maximumCenterX, centerX);
		minimumCenterZ = Math.min(minimumCenterZ, centerZ);
		maximumCenterZ = Math.max(maximumCenterZ, centerZ);
	}
	// A horizontal row normally needs Z alignment, while a vertical column needs X alignment.
	return maximumCenterX - minimumCenterX >= maximumCenterZ - minimumCenterZ ? "Z" : "X";
}

function translatedBoundsOverlap(bounds: readonly StaticFabArrangementRoot["bounds"][]): boolean {
	for (let leftIndex = 0; leftIndex < bounds.length; leftIndex++) {
		const left = bounds[leftIndex];
		if (!left) continue;
		for (let rightIndex = leftIndex + 1; rightIndex < bounds.length; rightIndex++) {
			const right = bounds[rightIndex];
			if (
				right &&
				left.minX < right.maxXExclusive &&
				right.minX < left.maxXExclusive &&
				left.minZ < right.maxZExclusive &&
				right.minZ < left.maxZExclusive
			) {
				return true;
			}
		}
	}
	return false;
}

function modeLabel(mode: StaticFabArrangementMode): string {
	switch (mode) {
		case "ALIGN_MIN":
			return "최소 경계 정렬";
		case "ALIGN_CENTER":
			return "중심 정렬";
		case "ALIGN_MAX":
			return "최대 경계 정렬";
		case "DISTRIBUTE_CENTERS":
			return "중심 균등 분배";
		case "DISTRIBUTE_GAPS":
			return "간격 균등 분배";
	}
}

function unavailable(
	code: "ALREADY_ARRANGED" | "NO_RECOMMENDATION",
	reason: string,
): StaticFabArrangementRecommendation {
	return Object.freeze({ valid: false, code, axis: null, mode: null, reason });
}
