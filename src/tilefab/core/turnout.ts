import {
	type AdvancedSwitchGeometry,
	type AdvancedSwitchRecord,
	advancedSwitchRecordError,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { stableSortSteps, synchronousSortSteps } from "./CooperativeSort";
import { completeCooperativeSteps } from "./CooperativeTask";
import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	findDirectedThroughRoute,
	isTangentJunction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, type RailCell, type TileMap } from "./TileMap";

export const TURNOUT_KIND = {
	BRANCH: 0,
	MERGE: 1,
} as const;

export type TurnoutKind = (typeof TURNOUT_KIND)[keyof typeof TURNOUT_KIND];

export const STANDARD_TURNOUT_RADIUS_METERS = 0.5;

export interface TurnoutProfile {
	id: string;
	leadInMeters: number;
	leadOutMeters: number;
	radiusMeters: number;
}

export const STANDARD_BRANCH_TURNOUT_PROFILE: TurnoutProfile = {
	id: "OPENFAB_BRANCH_L400_R500_L400_V1",
	leadInMeters: 0.4,
	leadOutMeters: 0.4,
	radiusMeters: STANDARD_TURNOUT_RADIUS_METERS,
};

export const STANDARD_MERGE_TURNOUT_PROFILE: TurnoutProfile = {
	id: "OPENFAB_MERGE_L400_R500_L400_V1",
	leadInMeters: 0.4,
	leadOutMeters: 0.4,
	radiusMeters: STANDARD_TURNOUT_RADIUS_METERS,
};

export interface TurnoutPathTrim {
	cell: Cell;
	from: Direction;
	to: Direction;
	startInsetMeters: number;
	endInsetMeters: number;
}

export interface TurnoutFootprint {
	id: string;
	kind: TurnoutKind;
	cell: Cell;
	through: { incoming: Direction; outgoing: Direction };
	divergingSide: Direction;
	curveFrom: Direction;
	curveTo: Direction;
	profileId: string;
	leadInMeters: number;
	leadOutMeters: number;
	radiusMeters: number;
	reservedCells: readonly Cell[];
	trims: readonly TurnoutPathTrim[];
}

export interface TurnoutValidationIssue {
	code: "MISSING_STRAIGHT_LEAD" | "OVERLAPPING_FOOTPRINT";
	message: string;
	cells: readonly Cell[];
}

export type RailReader = (x: number, y: number) => RailCell;

/** Derive the complete three-cell physical footprint of one tangent branch or merge. */
export function turnoutFootprintAt(
	cell: Cell,
	rail: RailCell,
	profileOverride?: TurnoutProfile,
): TurnoutFootprint | null {
	if (!isTangentJunction(rail.incoming, rail.outgoing)) return null;
	const through = findDirectedThroughRoute(rail.incoming, rail.outgoing);
	if (!through) return null;
	const branch = bitCount(rail.incoming) === 1;
	const throughMask = through.incoming | through.outgoing;
	const divergingSide = singleDirection((rail.incoming | rail.outgoing) & ~throughMask);
	if (!divergingSide) return null;

	if (branch) {
		const profile = profileOverride ?? STANDARD_BRANCH_TURNOUT_PROFILE;
		const incomingLeadCell = moveCell(cell, through.incoming);
		const divergingLeadCell = moveCell(cell, divergingSide);
		return {
			id: `BRANCH:${cellKey(cell.x, cell.y)}`,
			kind: TURNOUT_KIND.BRANCH,
			cell,
			through,
			divergingSide,
			curveFrom: through.incoming,
			curveTo: divergingSide,
			profileId: profile.id,
			leadInMeters: profile.leadInMeters,
			leadOutMeters: profile.leadOutMeters,
			radiusMeters: profile.radiusMeters,
			reservedCells: [incomingLeadCell, cell, divergingLeadCell],
			trims: [
				{
					cell: incomingLeadCell,
					from: through.incoming,
					to: through.outgoing,
					startInsetMeters: 0,
					endInsetMeters: profile.leadInMeters,
				},
				{
					cell: divergingLeadCell,
					from: oppositeDirection(divergingSide),
					to: divergingSide,
					startInsetMeters: profile.leadOutMeters,
					endInsetMeters: 0,
				},
			],
		};
	}

	const profile = profileOverride ?? STANDARD_MERGE_TURNOUT_PROFILE;
	const divergingLeadCell = moveCell(cell, divergingSide);
	const outgoingLeadCell = moveCell(cell, through.outgoing);
	return {
		id: `MERGE:${cellKey(cell.x, cell.y)}`,
		kind: TURNOUT_KIND.MERGE,
		cell,
		through,
		divergingSide,
		curveFrom: divergingSide,
		curveTo: through.outgoing,
		profileId: profile.id,
		leadInMeters: profile.leadInMeters,
		leadOutMeters: profile.leadOutMeters,
		radiusMeters: profile.radiusMeters,
		reservedCells: [divergingLeadCell, cell, outgoingLeadCell],
		trims: [
			{
				cell: divergingLeadCell,
				from: divergingSide,
				to: oppositeDirection(divergingSide),
				startInsetMeters: 0,
				endInsetMeters: profile.leadInMeters,
			},
			{
				cell: outgoingLeadCell,
				from: through.incoming,
				to: through.outgoing,
				startInsetMeters: profile.leadOutMeters,
				endInsetMeters: 0,
			},
		],
	};
}

export function collectTurnoutFootprints(map: TileMap): TurnoutFootprint[] {
	return completeCooperativeSteps(collectTurnoutFootprintSteps(map, false));
}

/** Scan sparse rail storage and order authored turnouts without a whole-input blocking step. */
export function* collectTurnoutFootprintSteps(
	map: TileMap,
	cooperative = true,
): Generator<void, TurnoutFootprint[]> {
	const sort = cooperative ? stableSortSteps : synchronousSortSteps;
	const footprints: TurnoutFootprint[] = [];
	const visit = (x: number, y: number, rail: RailCell): void => {
		const footprint = turnoutFootprintAt({ x, y }, rail);
		if (footprint) footprints.push(footprint);
	};
	if (cooperative) yield* map.railTraversalSteps(visit);
	else map.forEachRail(visit);
	yield* sort(footprints, compareFootprints);
	return footprints;
}

/** Collect only turnouts close enough to be affected by a pending local edit. */
export function collectAffectedTurnoutFootprints(
	read: RailReader,
	changedCells: readonly Cell[],
): TurnoutFootprint[] {
	const anchors = new Map<string, TurnoutFootprint>();
	const visited = new Set<string>();
	for (const changed of changedCells) {
		for (let dy = -2; dy <= 2; dy++) {
			for (let dx = -2; dx <= 2; dx++) {
				const cell = { x: changed.x + dx, y: changed.y + dy };
				const key = cellKey(cell.x, cell.y);
				if (visited.has(key)) continue;
				visited.add(key);
				const footprint = turnoutFootprintAt(cell, read(cell.x, cell.y));
				if (footprint) anchors.set(key, footprint);
			}
		}
	}
	return [...anchors.values()].sort(compareFootprints);
}

export function validateTurnoutFootprints(
	read: RailReader,
	footprints: readonly TurnoutFootprint[],
	advancedSwitches: readonly AdvancedSwitchRecord[] = [],
): TurnoutValidationIssue[] {
	const issues: TurnoutValidationIssue[] = [];
	for (const footprint of footprints) {
		for (const trim of footprint.trims) {
			const support = read(trim.cell.x, trim.cell.y);
			if (!isExactStraightRoute(support, trim.from, trim.to)) {
				issues.push({
					code: "MISSING_STRAIGHT_LEAD",
					message: "turnout의 400 mm 대칭 리드를 확보하려면 앞뒤에 직선 레일 한 칸이 필요합니다",
					cells: [footprint.cell, trim.cell],
				});
			}
		}
	}

	const ownersByCell = new Map<string, TurnoutFootprint[]>();
	const overlaps = new Map<
		string,
		{ left: TurnoutFootprint; right: TurnoutFootprint; cells: Cell[] }
	>();
	for (const footprint of footprints) {
		for (const cell of footprint.reservedCells) {
			const key = cellKey(cell.x, cell.y);
			const owners = ownersByCell.get(key) ?? [];
			for (const owner of owners) {
				const pairKey = `${owner.id}|${footprint.id}`;
				const overlap = overlaps.get(pairKey) ?? { left: owner, right: footprint, cells: [] };
				overlap.cells.push(cell);
				overlaps.set(pairKey, overlap);
			}
			owners.push(footprint);
			ownersByCell.set(key, owners);
		}
	}
	// Derive each switch once; only a matching merge anchor can own an overlap.
	const switchesByMergeAnchor = new Map<
		string,
		{
			record: AdvancedSwitchRecord;
			anchors: AdvancedSwitchTurnoutAnchors;
		}[]
	>();
	if (overlaps.size > 0) {
		for (const record of advancedSwitches) {
			if (advancedSwitchRecordError(record)) continue;
			const { mergeAnchor, branchAnchor, sharedTrunkSupport } =
				deriveAdvancedSwitchGeometry(record);
			const key = cellKey(mergeAnchor.x, mergeAnchor.y);
			const candidates = switchesByMergeAnchor.get(key) ?? [];
			candidates.push({ record, anchors: { mergeAnchor, branchAnchor, sharedTrunkSupport } });
			switchesByMergeAnchor.set(key, candidates);
		}
	}
	for (const overlap of overlaps.values()) {
		const merge = overlap.left.kind === TURNOUT_KIND.MERGE ? overlap.left : overlap.right;
		const candidates = switchesByMergeAnchor.get(cellKey(merge.cell.x, merge.cell.y)) ?? [];
		if (
			candidates.some(({ record, anchors }) =>
				isAuthorizedTurnoutOverlap(record, anchors, overlap.left, overlap.right, overlap.cells),
			)
		)
			continue;
		issues.push({
			code: "OVERLAPPING_FOOTPRINT",
			message: "두 turnout의 물리 footprint가 겹칩니다. junction 사이 간격을 늘리세요",
			cells: [overlap.left.cell, overlap.right.cell, ...overlap.cells],
		});
	}
	return issues;
}

/** Authorize only the merge/branch pair and one shared support owned by this compound switch. */
export function isAuthorizedAdvancedSwitchTurnoutOverlap(
	switchRecord: AdvancedSwitchRecord,
	left: TurnoutFootprint,
	right: TurnoutFootprint,
	overlapCells: readonly Cell[],
): boolean {
	if (advancedSwitchRecordError(switchRecord)) return false;
	return isAuthorizedTurnoutOverlap(
		switchRecord,
		deriveAdvancedSwitchGeometry(switchRecord),
		left,
		right,
		overlapCells,
	);
}

type AdvancedSwitchTurnoutAnchors = Pick<
	AdvancedSwitchGeometry,
	"mergeAnchor" | "branchAnchor" | "sharedTrunkSupport"
>;

function isAuthorizedTurnoutOverlap(
	switchRecord: AdvancedSwitchRecord,
	geometry: AdvancedSwitchTurnoutAnchors,
	left: TurnoutFootprint,
	right: TurnoutFootprint,
	overlapCells: readonly Cell[],
): boolean {
	const merge =
		left.kind === TURNOUT_KIND.MERGE ? left : right.kind === TURNOUT_KIND.MERGE ? right : null;
	const branch =
		left.kind === TURNOUT_KIND.BRANCH ? left : right.kind === TURNOUT_KIND.BRANCH ? right : null;
	if (!merge || !branch || merge === branch) return false;
	if (
		!sameCell(merge.cell, geometry.mergeAnchor) ||
		!sameCell(branch.cell, geometry.branchAnchor)
	) {
		return false;
	}
	if (
		merge.through.incoming !== oppositeDirection(switchRecord.forward) ||
		merge.through.outgoing !== switchRecord.forward ||
		branch.through.incoming !== oppositeDirection(switchRecord.forward) ||
		branch.through.outgoing !== switchRecord.forward ||
		merge.divergingSide !== switchRecord.lateral ||
		branch.divergingSide !== switchRecord.lateral
	) {
		return false;
	}

	const actualIntersection = merge.reservedCells.filter((mergeCell) =>
		branch.reservedCells.some((branchCell) => sameCell(mergeCell, branchCell)),
	);
	return (
		actualIntersection.length === 1 &&
		sameCell(actualIntersection[0] as Cell, geometry.sharedTrunkSupport) &&
		overlapCells.length === 1 &&
		sameCell(overlapCells[0] as Cell, geometry.sharedTrunkSupport)
	);
}

export function turnoutTrimKey(cell: Cell, from: Direction, to: Direction): string {
	return `${cellKey(cell.x, cell.y)}:${from}>${to}`;
}

function isExactStraightRoute(rail: RailCell, from: Direction, to: Direction): boolean {
	return (
		bitCount(rail.incoming) === 1 &&
		bitCount(rail.outgoing) === 1 &&
		rail.incoming === from &&
		rail.outgoing === to &&
		to === oppositeDirection(from)
	);
}

function singleDirection(mask: number): Direction | null {
	if (bitCount(mask) !== 1) return null;
	return ALL_DIRECTIONS.find((direction) => (mask & direction) !== 0) ?? null;
}

function compareFootprints(left: TurnoutFootprint, right: TurnoutFootprint): number {
	return left.cell.y - right.cell.y || left.cell.x - right.cell.x || left.kind - right.kind;
}

function sameCell(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}
