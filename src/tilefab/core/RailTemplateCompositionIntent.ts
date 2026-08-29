import {
	planRailTemplate,
	type RailTemplateParameters,
	type RailTemplatePose,
} from "./RailTemplateCatalog";
import {
	deriveRailTemplateCompositionGuideFromTargetIndex,
	deriveRailTemplateCompositionTargetIndex,
	type RailTemplateCompositionGuide,
	type RailTemplateCompositionGuideMap,
	type RailTemplateCompositionId,
	type RailTemplateCompositionResolution,
	resolveRailTemplateCompositionSnaps,
} from "./RailTemplateCompositionGuide";
import {
	AUTO_RAIL_TEMPLATE_POSE_LOCK,
	type RailTemplatePoseLock,
	rankedRailTemplatePoses,
} from "./RailTemplatePoseSearch";

export interface RailTemplateCompositionFocus {
	readonly x: number;
	readonly y: number;
}

export interface ResolvedRailTemplateCompositionIntent {
	readonly status: "resolved";
	readonly baseRevision: number;
	readonly pose: RailTemplatePose;
	readonly guide: RailTemplateCompositionGuide;
	readonly focusSnap: RailTemplateCompositionResolution | null;
}

export interface UnavailableRailTemplateCompositionIntent {
	readonly status: "unavailable";
	readonly baseRevision: number;
	readonly pose: null;
	readonly guide: null;
	readonly focusSnap: null;
}

export type RailTemplateCompositionIntent =
	| ResolvedRailTemplateCompositionIntent
	| UnavailableRailTemplateCompositionIntent;

export interface RailTemplateCompositionIntentIndexEntry {
	readonly pose: RailTemplatePose;
	readonly guide: RailTemplateCompositionGuide;
	readonly mutationCount: number;
	readonly tier: number;
	readonly order: number;
}

export interface RailTemplateCompositionIntentIndex {
	readonly baseRevision: number;
	readonly templateId: RailTemplateCompositionId;
	readonly preferredPose: RailTemplatePose;
	readonly lock: RailTemplatePoseLock;
	readonly parameters: RailTemplateParameters;
	readonly entries: readonly RailTemplateCompositionIntentIndexEntry[];
	readonly scannedRailCellCount: number;
}

interface EvaluatedFocus extends RailTemplateCompositionIntentIndexEntry {
	readonly focusSnap: RailTemplateCompositionResolution;
}

const FARTHEST_FINITE_DISTANCE_METERS = Number.MAX_VALUE;

/** Build all allowed composition poses over one immutable scan of the authored map. */
export function deriveRailTemplateCompositionIntentIndex(
	map: RailTemplateCompositionGuideMap,
	templateId: RailTemplateCompositionId,
	preferredPose: RailTemplatePose,
	parameters: RailTemplateParameters,
	lock: RailTemplatePoseLock = AUTO_RAIL_TEMPLATE_POSE_LOCK,
): RailTemplateCompositionIntentIndex {
	const targets = deriveRailTemplateCompositionTargetIndex(map);
	const entries = rankedRailTemplatePoses(preferredPose, lock).map((candidate) => {
		const guide = deriveRailTemplateCompositionGuideFromTargetIndex(
			map,
			targets,
			templateId,
			candidate.pose,
			parameters,
		);
		return Object.freeze({ ...candidate, pose: guide.pose, guide });
	});
	if (map.getRevision() !== targets.baseRevision) {
		throw new Error("Rail map revision changed while deriving composition intent.");
	}
	return Object.freeze({
		baseRevision: targets.baseRevision,
		templateId,
		preferredPose: Object.freeze({ ...preferredPose }),
		lock: Object.freeze({ ...lock }),
		parameters: Object.freeze({ ...parameters }),
		entries: Object.freeze(entries),
		scannedRailCellCount: targets.scannedRailCellCount,
	});
}

export function resolveRailTemplateCompositionIntentFromIndex(
	map: RailTemplateCompositionGuideMap,
	index: RailTemplateCompositionIntentIndex,
	focus?: RailTemplateCompositionFocus,
): RailTemplateCompositionIntent {
	assertFiniteFocus(focus);
	if (map.getRevision() !== index.baseRevision) return unavailableIntent(index.baseRevision);
	if (focus) {
		return (
			resolveRailTemplateCompositionFocus(map, index, focus, FARTHEST_FINITE_DISTANCE_METERS) ??
			unavailableIntent(index.baseRevision)
		);
	}
	const compatible = index.entries.filter((entry) => entry.guide.candidateAnchorCount > 0);
	if (compatible.length === 0) return unavailableIntent(index.baseRevision);
	const firstTier = Math.min(...compatible.map((entry) => entry.tier));
	const preferred = compatible
		.filter((entry) => entry.tier === firstTier)
		.sort(compareIndexedPoses)[0];
	if (!preferred) throw new Error("Composition intent index lost its preferred pose.");
	return resolvedIntent(index.baseRevision, preferred, null);
}

export function resolveRailTemplateCompositionFocus(
	map: RailTemplateCompositionGuideMap,
	index: RailTemplateCompositionIntentIndex,
	focus: RailTemplateCompositionFocus,
	maximumDistanceMeters: number,
): ResolvedRailTemplateCompositionIntent | null {
	assertFiniteFocus(focus);
	if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters < 0) return null;
	if (map.getRevision() !== index.baseRevision) return null;
	const focused: EvaluatedFocus[] = [];
	for (const entry of index.entries) {
		if (entry.guide.candidateAnchorCount === 0) continue;
		const focusSnaps = resolveRailTemplateCompositionSnaps(
			entry.guide,
			focus,
			maximumDistanceMeters,
		);
		for (const focusSnap of focusSnaps) {
			focused.push(Object.freeze({ ...entry, focusSnap }));
		}
	}
	if (focused.length === 0) return null;
	focused.sort(compareFocusedPoses);
	for (const candidate of focused) {
		const plan = planRailTemplate(
			map,
			index.templateId,
			candidate.focusSnap.anchor,
			candidate.pose,
			index.parameters,
		);
		if (plan.valid && plan.newEdges > 0) {
			return resolvedIntent(index.baseRevision, candidate, candidate.focusSnap);
		}
	}
	return null;
}

export function railTemplateCompositionGuideFromIndex(
	index: RailTemplateCompositionIntentIndex,
	pose: RailTemplatePose,
): RailTemplateCompositionGuide | null {
	return (
		index.entries.find(
			(entry) =>
				entry.pose.forward === pose.forward &&
				entry.pose.side === pose.side &&
				(entry.pose.flow ?? "forward") === (pose.flow ?? "forward"),
		)?.guide ?? null
	);
}

export function isRailTemplateCompositionIntentIndexCurrent(
	map: Pick<RailTemplateCompositionGuideMap, "getRevision">,
	index: RailTemplateCompositionIntentIndex,
): boolean {
	return map.getRevision() === index.baseRevision;
}

function compareIndexedPoses(
	left: RailTemplateCompositionIntentIndexEntry,
	right: RailTemplateCompositionIntentIndexEntry,
): number {
	return (
		left.mutationCount - right.mutationCount ||
		right.guide.candidateAnchorCount - left.guide.candidateAnchorCount ||
		left.order - right.order
	);
}

function compareFocusedPoses(left: EvaluatedFocus, right: EvaluatedFocus): number {
	return (
		left.focusSnap.distanceMeters - right.focusSnap.distanceMeters ||
		left.tier - right.tier ||
		(left.focusSnap.mode === right.focusSnap.mode
			? 0
			: left.focusSnap.mode === "route-reuse"
				? -1
				: 1) ||
		compareIndexedPoses(left, right)
	);
}

function resolvedIntent(
	baseRevision: number,
	entry: RailTemplateCompositionIntentIndexEntry,
	focusSnap: RailTemplateCompositionResolution | null,
): ResolvedRailTemplateCompositionIntent {
	return Object.freeze({
		status: "resolved",
		baseRevision,
		pose: entry.pose,
		guide: entry.guide,
		focusSnap,
	});
}

function unavailableIntent(baseRevision: number): UnavailableRailTemplateCompositionIntent {
	return Object.freeze({
		status: "unavailable",
		baseRevision,
		pose: null,
		guide: null,
		focusSnap: null,
	});
}

function assertFiniteFocus(focus: RailTemplateCompositionFocus | undefined): void {
	if (focus && (!Number.isFinite(focus.x) || !Number.isFinite(focus.y))) {
		throw new RangeError("Rail template composition focus must use finite world coordinates.");
	}
}
