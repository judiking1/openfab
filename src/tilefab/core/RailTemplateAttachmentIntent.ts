import {
	deriveRailTemplateAttachmentGuideFromTargetIndex,
	deriveRailTemplateAttachmentTargetIndex,
	type RailTemplateAttachmentGuide,
	type RailTemplateAttachmentGuideMap,
	type RailTemplateAttachmentId,
	type RailTemplateAttachmentParameters,
	type RailTemplateAttachmentSnap,
	resolveRailTemplateAttachmentSnaps,
} from "./RailTemplateAttachmentGuide";
import type { RailTemplatePose } from "./RailTemplateCatalog";
import {
	AUTO_RAIL_TEMPLATE_POSE_LOCK,
	type RailTemplatePoseLock,
	rankedRailTemplatePoses,
} from "./RailTemplatePoseSearch";

export interface RailTemplateAttachmentFocus {
	readonly x: number;
	readonly y: number;
}

export interface ResolvedRailTemplateAttachmentIntent {
	readonly status: "resolved";
	readonly baseRevision: number;
	readonly pose: RailTemplatePose;
	readonly guide: RailTemplateAttachmentGuide;
	readonly focusSnap: RailTemplateAttachmentSnap | null;
}

export interface UnavailableRailTemplateAttachmentIntent {
	readonly status: "unavailable";
	readonly baseRevision: number;
	readonly pose: null;
	readonly guide: null;
	readonly focusSnap: null;
}

export type RailTemplateAttachmentIntent =
	| ResolvedRailTemplateAttachmentIntent
	| UnavailableRailTemplateAttachmentIntent;

export interface RailTemplateAttachmentIntentIndexEntry {
	readonly pose: RailTemplatePose;
	readonly guide: RailTemplateAttachmentGuide;
	readonly mutationCount: number;
	readonly tier: number;
	readonly order: number;
}

export interface RailTemplateAttachmentIntentIndex {
	readonly baseRevision: number;
	readonly templateId: RailTemplateAttachmentId;
	readonly preferredPose: RailTemplatePose;
	readonly lock: RailTemplatePoseLock;
	readonly parameters: RailTemplateAttachmentParameters;
	readonly entries: readonly RailTemplateAttachmentIntentIndexEntry[];
}

interface EvaluatedFocus extends RailTemplateAttachmentIntentIndexEntry {
	readonly focusSnap: RailTemplateAttachmentSnap;
}

export type RailTemplateAttachmentCandidateAcceptance = (
	candidate: ResolvedRailTemplateAttachmentIntent,
) => boolean;

const FARTHEST_FINITE_DISTANCE_METERS = Number.MAX_VALUE;

/**
 * Resolve a discoverable attachment pose without invoking the physical draft evaluator.
 *
 * Compatibility is indexed once per map revision/template/parameter set. Pointer frames resolve
 * only against the immutable interval guides and never rescan authored rail cells. Final placement
 * must still pass the ordinary planner and physical gate.
 */
export function resolveRailTemplateAttachmentIntent(
	map: RailTemplateAttachmentGuideMap,
	templateId: RailTemplateAttachmentId,
	preferredPose: RailTemplatePose,
	parameters: RailTemplateAttachmentParameters,
	focus?: RailTemplateAttachmentFocus,
	lock: RailTemplatePoseLock = AUTO_RAIL_TEMPLATE_POSE_LOCK,
): RailTemplateAttachmentIntent {
	const index = deriveRailTemplateAttachmentIntentIndex(
		map,
		templateId,
		preferredPose,
		parameters,
		lock,
	);
	return resolveRailTemplateAttachmentIntentFromIndex(index, focus);
}

export function deriveRailTemplateAttachmentIntentIndex(
	map: RailTemplateAttachmentGuideMap,
	templateId: RailTemplateAttachmentId,
	preferredPose: RailTemplatePose,
	parameters: RailTemplateAttachmentParameters,
	lock: RailTemplatePoseLock = AUTO_RAIL_TEMPLATE_POSE_LOCK,
): RailTemplateAttachmentIntentIndex {
	const baseRevision = map.getRevision();
	const targets = deriveRailTemplateAttachmentTargetIndex(map);
	const entries: RailTemplateAttachmentIntentIndexEntry[] = [];
	for (const candidate of rankedRailTemplatePoses(preferredPose, lock)) {
		assertStableRevision(map, baseRevision);
		const guide = deriveRailTemplateAttachmentGuideFromTargetIndex(
			map,
			targets,
			templateId,
			candidate.pose,
			parameters,
		);
		assertStableRevision(map, baseRevision);
		if (guide.baseRevision !== baseRevision) {
			throw new Error("Attachment guide revision does not match the intent index revision.");
		}
		entries.push(Object.freeze({ ...candidate, pose: guide.pose, guide }));
	}

	assertStableRevision(map, baseRevision);
	return Object.freeze({
		baseRevision,
		templateId,
		preferredPose: Object.freeze({ ...preferredPose }),
		lock: Object.freeze({ ...lock }),
		parameters: Object.freeze({ ...parameters }),
		entries: Object.freeze(entries),
	});
}

export function resolveRailTemplateAttachmentIntentFromIndex(
	index: RailTemplateAttachmentIntentIndex,
	focus?: RailTemplateAttachmentFocus,
	accept?: RailTemplateAttachmentCandidateAcceptance,
): RailTemplateAttachmentIntent {
	assertFiniteFocus(focus);
	if (focus) {
		const focused = resolveRailTemplateAttachmentFocus(
			index,
			focus,
			FARTHEST_FINITE_DISTANCE_METERS,
			accept,
		);
		return focused ?? unavailableIntent(index.baseRevision);
	}

	const compatible = index.entries.filter((entry) => entry.guide.compatibleAnchorCount > 0);
	if (compatible.length === 0) return unavailableIntent(index.baseRevision);
	const firstTier = Math.min(...compatible.map((entry) => entry.tier));
	const preferred = compatible
		.filter((entry) => entry.tier === firstTier)
		.sort(compareIndexedPoses)[0];
	if (!preferred) throw new Error("Attachment intent index lost its preferred pose.");
	return resolvedIntent(index.baseRevision, preferred, null);
}

export function resolveRailTemplateAttachmentFocus(
	index: RailTemplateAttachmentIntentIndex,
	focus: RailTemplateAttachmentFocus,
	maximumDistanceMeters: number,
	accept?: RailTemplateAttachmentCandidateAcceptance,
): ResolvedRailTemplateAttachmentIntent | null {
	assertFiniteFocus(focus);
	if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters < 0) return null;
	const focused: EvaluatedFocus[] = [];
	for (const entry of index.entries) {
		if (entry.guide.compatibleAnchorCount === 0) continue;
		const focusSnaps = resolveRailTemplateAttachmentSnaps(
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
		const resolved = resolvedIntent(index.baseRevision, candidate, candidate.focusSnap);
		if (!accept || accept(resolved)) return resolved;
	}
	return null;
}

export function railTemplateAttachmentGuideFromIndex(
	index: RailTemplateAttachmentIntentIndex,
	pose: RailTemplatePose,
): RailTemplateAttachmentGuide | null {
	return (
		index.entries.find(
			(entry) =>
				entry.pose.forward === pose.forward &&
				entry.pose.side === pose.side &&
				(entry.pose.flow ?? "forward") === (pose.flow ?? "forward"),
		)?.guide ?? null
	);
}

export function isRailTemplateAttachmentIntentIndexCurrent(
	map: Pick<RailTemplateAttachmentGuideMap, "getRevision">,
	index: RailTemplateAttachmentIntentIndex,
): boolean {
	return map.getRevision() === index.baseRevision;
}

function compareIndexedPoses(
	left: RailTemplateAttachmentIntentIndexEntry,
	right: RailTemplateAttachmentIntentIndexEntry,
): number {
	return (
		left.mutationCount - right.mutationCount ||
		right.guide.compatibleAnchorCount - left.guide.compatibleAnchorCount ||
		left.order - right.order
	);
}

function compareFocusedPoses(left: EvaluatedFocus, right: EvaluatedFocus): number {
	return (
		left.focusSnap.distanceMeters - right.focusSnap.distanceMeters ||
		left.tier - right.tier ||
		compareIndexedPoses(left, right)
	);
}

function resolvedIntent(
	baseRevision: number,
	entry: RailTemplateAttachmentIntentIndexEntry,
	focusSnap: RailTemplateAttachmentSnap | null,
): ResolvedRailTemplateAttachmentIntent {
	return Object.freeze({
		status: "resolved",
		baseRevision,
		pose: entry.pose,
		guide: entry.guide,
		focusSnap,
	});
}

function unavailableIntent(baseRevision: number): UnavailableRailTemplateAttachmentIntent {
	return Object.freeze({
		status: "unavailable",
		baseRevision,
		pose: null,
		guide: null,
		focusSnap: null,
	});
}

function assertFiniteFocus(focus: RailTemplateAttachmentFocus | undefined): void {
	if (focus && (!Number.isFinite(focus.x) || !Number.isFinite(focus.y))) {
		throw new RangeError("Rail template attachment focus must use finite world coordinates.");
	}
}

function assertStableRevision(map: RailTemplateAttachmentGuideMap, baseRevision: number): void {
	if (map.getRevision() !== baseRevision) {
		throw new Error("Rail map revision changed while resolving attachment intent.");
	}
}
