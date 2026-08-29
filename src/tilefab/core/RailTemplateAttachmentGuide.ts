import type { RailMapReader } from "./paint";
import { classifyRailCell } from "./RailCellClassification";
import {
	type AttachedReturnTemplateParameters,
	type BranchBypassTemplateParameters,
	instantiateRailTemplate,
	type OuterbayLinkTemplateParameters,
	type RailTemplateId,
	type RailTemplatePose,
	railTemplateTravelDirection,
	type TransformedRailTemplateBlueprint,
	transformRailTemplateBlueprint,
} from "./RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction, oppositeDirection } from "./railShape";
import { type Cell, cellKey, type RailCell } from "./TileMap";

export const RAIL_TEMPLATE_ATTACHMENT_IDS = Object.freeze([
	"attached-return",
	"branch-bypass",
	"outerbay-link",
] as const);

export type RailTemplateAttachmentId = (typeof RAIL_TEMPLATE_ATTACHMENT_IDS)[number];
export type RailTemplateAttachmentParameters =
	| AttachedReturnTemplateParameters
	| BranchBypassTemplateParameters
	| OuterbayLinkTemplateParameters;
export type RailTemplateAttachmentGuideStatus = "compatible" | "blocked";
export type RailTemplateAttachmentBlockReason =
	| "wrong-direction"
	| "insufficient-support"
	| "advanced-switch"
	| "overlap"
	| "topology";

export interface RailTemplateAttachmentGuideMap extends RailMapReader {
	forEachRail(visit: (x: number, y: number, rail: RailCell, encoded: number) => void): void;
}

interface RailTemplateAttachmentTarget {
	readonly cell: Cell;
	readonly incoming: number;
	readonly outgoing: number;
}

export interface RailTemplateAttachmentTargetIndex {
	readonly baseRevision: number;
	readonly targets: readonly RailTemplateAttachmentTarget[];
	readonly scannedRailCellCount: number;
}

export interface RailTemplateAttachmentGuideInterval {
	/** First candidate anchor in the active template's forward direction. */
	readonly startAnchor: Cell;
	/** Last candidate anchor in the active template's forward direction. */
	readonly endAnchor: Cell;
	readonly anchorCount: number;
	readonly trunkDirection: Direction;
	readonly status: RailTemplateAttachmentGuideStatus;
	readonly reasonCode: RailTemplateAttachmentBlockReason | null;
	readonly reason: string;
}

export interface RailTemplateAttachmentGuide {
	readonly baseRevision: number;
	readonly templateId: RailTemplateAttachmentId;
	readonly templateDefinitionFingerprint: string;
	readonly pose: RailTemplatePose;
	readonly parameters: RailTemplateAttachmentParameters;
	readonly intervals: readonly RailTemplateAttachmentGuideInterval[];
	readonly scannedRailCellCount: number;
	readonly candidateAnchorCount: number;
	readonly compatibleAnchorCount: number;
	readonly blockedAnchorCount: number;
}

export interface RailTemplateAttachmentGuideSummary {
	readonly readyAnchorCount: number;
	readonly blockedAnchorCount: number;
	readonly blockedByReason: Readonly<Record<RailTemplateAttachmentBlockReason, number>>;
	readonly dominantBlockReason: RailTemplateAttachmentBlockReason | null;
}

export interface RailTemplateAttachmentSnap {
	readonly anchor: Cell;
	readonly focusCell: Cell;
	readonly handleRole: "branch" | "merge";
	readonly distanceMeters: number;
}

interface CandidateClassification {
	readonly status: RailTemplateAttachmentGuideStatus;
	readonly reasonCode: RailTemplateAttachmentBlockReason | null;
	readonly reason: string;
}

interface AttachmentCandidate extends CandidateClassification {
	readonly cell: Cell;
	readonly lane: number;
	readonly station: number;
	readonly trunkDirection: Direction;
}

const COMPATIBLE: CandidateClassification = Object.freeze({
	status: "compatible",
	reasonCode: null,
	reason: "배치 가능",
});

const BLOCK_REASONS: Readonly<Record<RailTemplateAttachmentBlockReason, string>> = Object.freeze({
	"wrong-direction": "진행 방향 불일치",
	"insufficient-support": "직선 본선 지지 길이 부족",
	"advanced-switch": "고급 스위치 점유 구간",
	overlap: "패턴 경로와 기존 레일 중첩",
	topology: "접선 분기·합류 불가",
});

const BLOCK_REASON_PRIORITY = Object.freeze([
	"wrong-direction",
	"insufficient-support",
	"overlap",
	"advanced-switch",
	"topology",
] as const satisfies readonly RailTemplateAttachmentBlockReason[]);

/**
 * Derive renderer-independent attachment intervals by visiting only authored rail cells.
 * The result is immutable and may be consumed only while `baseRevision` remains current.
 */
export function deriveRailTemplateAttachmentGuide(
	map: RailTemplateAttachmentGuideMap,
	templateId: RailTemplateAttachmentId,
	pose: RailTemplatePose,
	parameters: RailTemplateAttachmentParameters,
): RailTemplateAttachmentGuide {
	return deriveRailTemplateAttachmentGuideFromTargetIndex(
		map,
		deriveRailTemplateAttachmentTargetIndex(map),
		templateId,
		pose,
		parameters,
	);
}

/** Reduce compressed intervals into user-facing counts without expanding every candidate anchor. */
export function summarizeRailTemplateAttachmentGuide(
	guide: RailTemplateAttachmentGuide,
): RailTemplateAttachmentGuideSummary {
	const blockedByReason: Record<RailTemplateAttachmentBlockReason, number> = {
		"wrong-direction": 0,
		"insufficient-support": 0,
		"advanced-switch": 0,
		overlap: 0,
		topology: 0,
	};
	for (const interval of guide.intervals) {
		if (interval.status !== "blocked" || interval.reasonCode === null) continue;
		blockedByReason[interval.reasonCode] += interval.anchorCount;
	}
	let dominantBlockReason: RailTemplateAttachmentBlockReason | null = null;
	for (const reason of BLOCK_REASON_PRIORITY) {
		if (blockedByReason[reason] === 0) continue;
		if (
			dominantBlockReason === null ||
			blockedByReason[reason] > blockedByReason[dominantBlockReason]
		) {
			dominantBlockReason = reason;
		}
	}
	return Object.freeze({
		readyAnchorCount: guide.compatibleAnchorCount,
		blockedAnchorCount: guide.blockedAnchorCount,
		blockedByReason: Object.freeze(blockedByReason),
		dominantBlockReason,
	});
}

/** Capture reusable linear-trunk targets with one immutable authored-map scan. */
export function deriveRailTemplateAttachmentTargetIndex(
	map: RailTemplateAttachmentGuideMap,
): RailTemplateAttachmentTargetIndex {
	const baseRevision = map.getRevision();
	const targets: RailTemplateAttachmentTarget[] = [];
	let scannedRailCellCount = 0;
	map.forEachRail((x, y, rail) => {
		scannedRailCellCount++;
		if (classifyRailCell(rail) !== "LINEAR") return;
		targets.push(
			Object.freeze({
				cell: freezeCell({ x, y }),
				incoming: rail.incoming,
				outgoing: rail.outgoing,
			}),
		);
	});
	if (map.getRevision() !== baseRevision) {
		throw new Error("Rail map revision changed while deriving attachment targets.");
	}
	return Object.freeze({
		baseRevision,
		targets: Object.freeze(targets),
		scannedRailCellCount,
	});
}

export function deriveRailTemplateAttachmentGuideFromTargetIndex(
	map: RailTemplateAttachmentGuideMap,
	index: RailTemplateAttachmentTargetIndex,
	templateId: RailTemplateAttachmentId,
	pose: RailTemplatePose,
	parameters: RailTemplateAttachmentParameters,
): RailTemplateAttachmentGuide {
	if (!isRailTemplateAttachmentId(templateId)) {
		throw new RangeError(
			`Rail template ${templateId as string} does not attach to a straight trunk.`,
		);
	}
	if (parameters.templateId !== templateId) {
		throw new RangeError("Rail attachment guide parameters do not match the template id.");
	}
	if (pose.side !== "left" && pose.side !== "right") {
		throw new RangeError("Rail attachment guide side must be left or right.");
	}

	if (map.getRevision() !== index.baseRevision) {
		throw new Error("Rail attachment target index is stale.");
	}
	const baseRevision = index.baseRevision;
	const blueprint = instantiateRailTemplate(templateId, parameters);
	// Compile pose-relative offsets once; candidate anchors only translate this immutable geometry.
	const transformed = transformRailTemplateBlueprint(blueprint, { x: 0, y: 0 }, pose);
	const trunkSupportIndexes = blueprint.hardReservedCells.flatMap((cell, index) =>
		cell.y === 0 ? [index] : [],
	);
	const terminalKeys = new Set(
		transformed.terminals
			.filter((terminal) => terminal.attachment === "straight-trunk")
			.map((terminal) => cellKey(terminal.cell.x, terminal.cell.y)),
	);
	const axisMask = pose.forward | oppositeDirection(pose.forward);
	const candidates: AttachmentCandidate[] = [];

	for (const target of index.targets) {
		if ((target.incoming | target.outgoing) !== axisMask) continue;
		const trunkDirection = singleDirection(target.outgoing);
		if (!trunkDirection) continue;
		const cell = target.cell;
		const classification = classifyCandidate(
			map,
			pose,
			transformed,
			trunkSupportIndexes,
			terminalKeys,
			cell,
			trunkDirection,
		);
		candidates.push(
			Object.freeze({
				cell,
				lane: laneOf(cell, pose.forward),
				station: stationOf(cell, pose.forward),
				trunkDirection,
				...classification,
			}),
		);
	}

	if (map.getRevision() !== baseRevision) {
		throw new Error("Rail map revision changed while deriving attachment guides.");
	}

	candidates.sort(compareCandidates);
	const intervals = coalesceCandidates(candidates);
	let compatibleAnchorCount = 0;
	for (const interval of intervals) {
		if (interval.status === "compatible") compatibleAnchorCount += interval.anchorCount;
	}
	const candidateAnchorCount = candidates.length;

	return Object.freeze({
		baseRevision,
		templateId,
		templateDefinitionFingerprint: blueprint.definitionFingerprint,
		pose: Object.freeze({ ...pose }),
		parameters: Object.freeze({ ...parameters }),
		intervals: Object.freeze(intervals),
		scannedRailCellCount: index.scannedRailCellCount,
		candidateAnchorCount,
		compatibleAnchorCount,
		blockedAnchorCount: candidateAnchorCount - compatibleAnchorCount,
	});
}

export function isRailTemplateAttachmentGuideCurrent(
	map: Pick<RailMapReader, "getRevision">,
	guide: RailTemplateAttachmentGuide,
): boolean {
	return map.getRevision() === guide.baseRevision;
}

/** Resolve one compatible interval without expanding long guides into per-cell objects. */
export function resolveRailTemplateAttachmentSnap(
	guide: RailTemplateAttachmentGuide,
	world: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
): RailTemplateAttachmentSnap | null {
	return resolveRailTemplateAttachmentSnaps(guide, world, maximumDistanceMeters)[0] ?? null;
}

const MAX_NEAREST_ATTACHMENT_SNAPS_PER_INTERVAL = 9;

/**
 * Resolve a bounded nearest-first candidate set so physical validation can skip a blocked nearest
 * placement without abandoning another legal anchor under the same pointer focus.
 */
export function resolveRailTemplateAttachmentSnaps(
	guide: RailTemplateAttachmentGuide,
	world: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
): readonly RailTemplateAttachmentSnap[] {
	if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters < 0)
		return Object.freeze([]);
	const snaps: RailTemplateAttachmentSnap[] = [];
	const spanMeters = attachmentTrunkSpanMeters(guide.parameters);
	const mergeOffset = moveRepeated({ x: 0, y: 0 }, guide.pose.forward, spanMeters);
	const handles = [
		{ role: "branch" as const, offset: { x: 0, y: 0 } },
		{ role: "merge" as const, offset: mergeOffset },
	];
	for (const interval of guide.intervals) {
		if (interval.status !== "compatible") continue;
		for (const handle of handles) {
			const anchorFocus = {
				x: world.x - handle.offset.x,
				y: world.y - handle.offset.y,
			};
			for (const anchor of nearestCellsOnInterval(interval, anchorFocus, maximumDistanceMeters)) {
				const focusCell = freezeCell({
					x: anchor.x + handle.offset.x,
					y: anchor.y + handle.offset.y,
				});
				const distanceMeters = Math.hypot(
					world.x - (focusCell.x + 0.5),
					world.y - (focusCell.y + 0.5),
				);
				snaps.push(
					Object.freeze({
						anchor,
						focusCell,
						handleRole:
							guide.pose.flow === "reverse"
								? handle.role === "branch"
									? "merge"
									: "branch"
								: handle.role,
						distanceMeters,
					}),
				);
			}
		}
	}
	snaps.sort(compareAttachmentSnaps);
	return Object.freeze(snaps);
}

export function isRailTemplateAttachmentId(
	id: RailTemplateId | string,
): id is RailTemplateAttachmentId {
	return id === "attached-return" || id === "branch-bypass" || id === "outerbay-link";
}

function classifyCandidate(
	map: RailTemplateAttachmentGuideMap,
	pose: RailTemplatePose,
	transformed: TransformedRailTemplateBlueprint,
	trunkSupportIndexes: readonly number[],
	terminalKeys: ReadonlySet<string>,
	anchor: Cell,
	trunkDirection: Direction,
): CandidateClassification {
	if (map.getAdvancedSwitchOwningCell(anchor.x, anchor.y)) {
		return blocked("advanced-switch");
	}
	const travelDirection = railTemplateTravelDirection(pose);
	if (trunkDirection !== travelDirection) return blocked("wrong-direction");

	for (const offset of transformed.hardReservedCells) {
		const cell = translateCell(offset, anchor);
		if (map.getAdvancedSwitchOwningCell(cell.x, cell.y)) {
			return blocked("advanced-switch");
		}
	}

	const expectedIncoming = oppositeDirection(travelDirection);
	for (const index of trunkSupportIndexes) {
		const supportOffset = transformed.hardReservedCells[index];
		if (!supportOffset) return blocked("insufficient-support");
		const support = translateCell(supportOffset, anchor);
		const rail = map.getRail(support.x, support.y);
		if (
			classifyRailCell(rail) !== "LINEAR" ||
			rail.incoming !== expectedIncoming ||
			rail.outgoing !== travelDirection
		) {
			return blocked("insufficient-support");
		}
	}

	for (const offset of transformed.occupiedCells) {
		const offsetKey = cellKey(offset.x, offset.y);
		const cell = translateCell(offset, anchor);
		if (!terminalKeys.has(offsetKey) && map.hasRail(cell.x, cell.y)) {
			return blocked("overlap");
		}
	}
	return COMPATIBLE;
}

function nearestCellOnInterval(
	interval: RailTemplateAttachmentGuideInterval,
	world: Readonly<{ x: number; y: number }>,
): Cell {
	if (interval.startAnchor.x === interval.endAnchor.x) {
		return {
			x: interval.startAnchor.x,
			y: clampInteger(Math.round(world.y - 0.5), interval.startAnchor.y, interval.endAnchor.y),
		};
	}
	return {
		x: clampInteger(Math.round(world.x - 0.5), interval.startAnchor.x, interval.endAnchor.x),
		y: interval.startAnchor.y,
	};
}

function nearestCellsOnInterval(
	interval: RailTemplateAttachmentGuideInterval,
	world: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
): readonly Cell[] {
	const nearest = nearestCellOnInterval(interval, world);
	const vertical = interval.startAnchor.x === interval.endAnchor.x;
	const firstCoordinate = vertical ? interval.startAnchor.y : interval.startAnchor.x;
	const lastCoordinate = vertical ? interval.endAnchor.y : interval.endAnchor.x;
	const minimumCoordinate = Math.min(firstCoordinate, lastCoordinate);
	const maximumCoordinate = Math.max(firstCoordinate, lastCoordinate);
	const nearestCoordinate = vertical ? nearest.y : nearest.x;
	const cells: Cell[] = [];
	for (let offset = 0; cells.length < MAX_NEAREST_ATTACHMENT_SNAPS_PER_INTERVAL; offset++) {
		const coordinates =
			offset === 0 ? [nearestCoordinate] : [nearestCoordinate - offset, nearestCoordinate + offset];
		let foundInRange = false;
		for (const coordinate of coordinates) {
			if (coordinate < minimumCoordinate || coordinate > maximumCoordinate) continue;
			foundInRange = true;
			const cell = freezeCell(
				vertical
					? { x: interval.startAnchor.x, y: coordinate }
					: { x: coordinate, y: interval.startAnchor.y },
			);
			const distanceMeters = Math.hypot(world.x - (cell.x + 0.5), world.y - (cell.y + 0.5));
			if (distanceMeters <= maximumDistanceMeters) cells.push(cell);
			if (cells.length >= MAX_NEAREST_ATTACHMENT_SNAPS_PER_INTERVAL) break;
		}
		if (
			!foundInRange &&
			nearestCoordinate - offset < minimumCoordinate &&
			nearestCoordinate + offset > maximumCoordinate
		) {
			break;
		}
		if (Math.max(0, offset - 0.5) > maximumDistanceMeters) break;
	}
	return cells;
}

function compareAttachmentSnaps(
	left: RailTemplateAttachmentSnap,
	right: RailTemplateAttachmentSnap,
): number {
	return (
		left.distanceMeters - right.distanceMeters ||
		Number(left.handleRole === "merge") - Number(right.handleRole === "merge") ||
		compareCells(left.anchor, right.anchor)
	);
}

function clampInteger(value: number, first: number, second: number): number {
	return Math.max(Math.min(first, second), Math.min(Math.max(first, second), value));
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function translateCell(offset: Cell, anchor: Cell): Cell {
	return { x: offset.x + anchor.x, y: offset.y + anchor.y };
}

function attachmentTrunkSpanMeters(parameters: RailTemplateAttachmentParameters): number {
	return parameters.templateId === "attached-return"
		? parameters.laneSpacingMeters
		: parameters.trunkSpanMeters;
}

function moveRepeated(cell: Cell, direction: Direction, distance: number): Cell {
	let result = cell;
	for (let step = 0; step < distance; step++) {
		result =
			direction === DIR_N
				? { x: result.x, y: result.y - 1 }
				: direction === DIR_E
					? { x: result.x + 1, y: result.y }
					: direction === DIR_S
						? { x: result.x, y: result.y + 1 }
						: { x: result.x - 1, y: result.y };
	}
	return result;
}

function blocked(reasonCode: RailTemplateAttachmentBlockReason): CandidateClassification {
	return Object.freeze({
		status: "blocked",
		reasonCode,
		reason: BLOCK_REASONS[reasonCode],
	});
}

function coalesceCandidates(
	candidates: readonly AttachmentCandidate[],
): RailTemplateAttachmentGuideInterval[] {
	const intervals: RailTemplateAttachmentGuideInterval[] = [];
	let previousCandidate: AttachmentCandidate | undefined;
	for (const candidate of candidates) {
		const previous = intervals.at(-1);
		if (
			previous &&
			previousCandidate &&
			previousCandidate.lane === candidate.lane &&
			previousCandidate.station + 1 === candidate.station &&
			previous.trunkDirection === candidate.trunkDirection &&
			previous.status === candidate.status &&
			previous.reasonCode === candidate.reasonCode
		) {
			intervals[intervals.length - 1] = freezeInterval(
				previous.startAnchor,
				candidate.cell,
				previous.anchorCount + 1,
				candidate,
			);
			previousCandidate = candidate;
			continue;
		}
		intervals.push(freezeInterval(candidate.cell, candidate.cell, 1, candidate));
		previousCandidate = candidate;
	}
	return intervals;
}

function freezeInterval(
	startAnchor: Cell,
	endAnchor: Cell,
	anchorCount: number,
	classification: AttachmentCandidate,
): RailTemplateAttachmentGuideInterval {
	return Object.freeze({
		startAnchor: freezeCell(startAnchor),
		endAnchor: freezeCell(endAnchor),
		anchorCount,
		trunkDirection: classification.trunkDirection,
		status: classification.status,
		reasonCode: classification.reasonCode,
		reason: classification.reason,
	});
}

function compareCandidates(left: AttachmentCandidate, right: AttachmentCandidate): number {
	return (
		left.lane - right.lane ||
		left.station - right.station ||
		left.cell.x - right.cell.x ||
		left.cell.y - right.cell.y
	);
}

function laneOf(cell: Cell, forward: Direction): number {
	return forward === DIR_E || forward === DIR_W ? cell.y : cell.x;
}

function stationOf(cell: Cell, forward: Direction): number {
	if (forward === DIR_E) return cell.x;
	if (forward === DIR_W) return -cell.x;
	if (forward === DIR_S) return cell.y;
	return -cell.y;
}

function singleDirection(mask: number): Direction | null {
	if (mask === DIR_N || mask === DIR_E || mask === DIR_S || mask === DIR_W) return mask;
	return null;
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
