import type { RailConstructionIssueCode, RailConstructionPlan, RailMapReader } from "./paint";
import type { RailModuleSide } from "./RailModulePlanner";
import { planRailRouteBatch } from "./RailTemplateCatalog";
import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey } from "./TileMap";

export const RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS = 8;
export const RAIL_NETWORK_LINK_MINIMUM_GAP_METERS = 3;
export const RAIL_NETWORK_LINK_MAXIMUM_GAP_METERS = 120;
export const RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS = 2;
const RAIL_NETWORK_LINK_MAXIMUM_AUTO_RUNS = 24;
const RAIL_NETWORK_LINK_MAXIMUM_AUTO_PLANS = 48;
const RAIL_NETWORK_LINK_MAXIMUM_PLANS_PER_RUN_PAIR = 8;
const RAIL_NETWORK_LINK_MAXIMUM_PHYSICAL_PLANS = 8;
const RAIL_NETWORK_LINK_MAXIMUM_DESCRIPTOR_SCANS_PER_RUN_PAIR = 16;
const RAIL_NETWORK_LINK_MAXIMUM_JUNCTION_PAIRS = 6;
const RAIL_NETWORK_LINK_JUNCTION_OFFSETS = Object.freeze([0, -1, 1, -2, 2, -4, 4]);
const RAIL_NETWORK_LINK_TRUSTED_MAXIMUM_GAP_METERS = 512;

function normalizeMaximumGapMeters(value: number | undefined): number {
	if (value === undefined) return RAIL_NETWORK_LINK_MAXIMUM_GAP_METERS;
	if (
		!Number.isSafeInteger(value) ||
		value < RAIL_NETWORK_LINK_MINIMUM_GAP_METERS ||
		value > RAIL_NETWORK_LINK_TRUSTED_MAXIMUM_GAP_METERS
	) {
		throw new RangeError(
			`Network-link maximum gap must be a ${RAIL_NETWORK_LINK_MINIMUM_GAP_METERS}-${RAIL_NETWORK_LINK_TRUSTED_MAXIMUM_GAP_METERS} m integer.`,
		);
	}
	return value;
}

export type RailNetworkLinkCandidateAcceptance = (plan: RailNetworkLinkPlan) => boolean;
export type RailNetworkLinkCandidateFilter = (plan: RailNetworkLinkPlan) => boolean;

export interface RailNetworkLinkAnchorOptions {
	/**
	 * Keeps ordinary Smart Route behavior conservative while allowing trusted macro builders to
	 * close an additional circulation cycle between two runs that are already in the same SCC.
	 */
	readonly allowSameComponent?: boolean;
	/**
	 * Trusted macro builders may span a longer, predeclared corridor than the interactive tool.
	 * Ordinary editor callers keep the conservative public construction limit.
	 */
	readonly maximumGapMeters?: number;
	/**
	 * Assembly connectors select one explicit source/target gateway band. Ordinary Network Link keeps
	 * its forgiving whole-component fallback, while this mode refuses to move to another straight run.
	 */
	readonly restrictToSelectedRuns?: boolean;
}

export type RailNetworkLinkPlacementCode =
	| "valid"
	| "stale"
	| "source-not-rail"
	| "source-not-straight"
	| "source-not-closed"
	| "target-not-rail"
	| "same-component"
	| "target-not-straight"
	| "target-not-closed"
	| "non-parallel"
	| "wrong-side"
	| "insufficient-gap"
	| "excessive-gap"
	| "insufficient-support"
	| "physical"
	| "topology";

export interface RailNetworkLinkMetadata {
	readonly version: 1;
	readonly placementCode: RailNetworkLinkPlacementCode;
	readonly sourceAnchor: Cell;
	readonly targetAnchor: Cell;
	readonly sourceForward: Direction | null;
	readonly targetForward: Direction | null;
	readonly side: RailModuleSide | null;
	readonly junctionSpacingMeters: number;
	readonly sourceComponentCellCount: number;
	readonly targetComponentCellCount: number;
	readonly sourceDeparture: Cell | null;
	readonly sourceArrival: Cell | null;
	readonly targetArrival: Cell | null;
	readonly targetDeparture: Cell | null;
	readonly outboundCells: readonly Cell[];
	readonly returnCells: readonly Cell[];
}

export interface RailNetworkLinkPlan extends RailConstructionPlan {
	readonly networkLink: RailNetworkLinkMetadata;
}

interface RailComponent {
	readonly keys: ReadonlySet<string>;
	readonly cells: readonly Cell[];
	readonly closed: boolean;
	readonly stronglyConnected: boolean;
}

interface StraightRun {
	readonly forward: Direction;
	readonly axis: "x" | "y";
	readonly fixedCoordinate: number;
	readonly minimum: number;
	readonly maximum: number;
}

interface JunctionPair {
	readonly departureCoordinate: number;
	readonly returnCoordinate: number;
}

interface ScoredNetworkLinkPlan {
	readonly plan: RailNetworkLinkPlan;
	readonly score: number;
	readonly familyKey: string;
}

interface RankedRunPair {
	readonly sourceRun: StraightRun;
	readonly targetRun: StraightRun;
	readonly score: number;
}

interface ParallelCorridorPair {
	readonly outboundCoordinate: number;
	readonly returnCoordinate: number;
}

interface CardinalRouteMetrics {
	readonly departureDirection: Direction;
	readonly maximumLeg: number;
	readonly stepCount: number;
}

interface ParallelDoglegDescriptor {
	readonly sourceDeparture: Cell;
	readonly sourceArrival: Cell;
	readonly targetArrival: Cell;
	readonly targetDeparture: Cell;
	readonly outboundCorridor: number;
	readonly returnCorridor: number;
	readonly outboundMetrics: CardinalRouteMetrics;
	readonly returnMetrics: CardinalRouteMetrics;
	readonly side: RailModuleSide;
	readonly score: number;
	readonly familyKey: string;
}

interface PerpendicularLinkDescriptor {
	readonly sourceDeparture: Cell;
	readonly sourceArrival: Cell;
	readonly targetArrival: Cell;
	readonly targetDeparture: Cell;
	readonly outboundMetrics: CardinalRouteMetrics;
	readonly returnMetrics: CardinalRouteMetrics;
	readonly side: RailModuleSide;
	readonly score: number;
	readonly familyKey: string;
}

/**
 * Revision-bound source analysis for the two-way component linker. Component and run discovery is
 * intentionally paid once at anchor selection; pointer previews reuse the cached source and each
 * target component is traversed at most once.
 */
export class RailNetworkLinkAnchorContext {
	readonly baseRevision: number;
	readonly sourceAnchor: Cell;
	readonly valid: boolean;
	readonly reason: string;
	readonly placementCode: RailNetworkLinkPlacementCode;
	readonly sourceForward: Direction | null;
	readonly sourceComponentCellCount: number;

	private readonly sourceMap: RailMapReader;
	private readonly acceptCandidate: RailNetworkLinkCandidateAcceptance | null;
	private readonly filterCandidate: RailNetworkLinkCandidateFilter | null;
	private readonly allowSameComponent: boolean;
	private readonly restrictToSelectedRuns: boolean;
	readonly maximumGapMeters: number;
	private readonly sourceComponent: RailComponent | null;
	private readonly sourceRun: StraightRun | null;
	private readonly sourceRuns: readonly StraightRun[];
	private readonly targetComponentsByCell = new Map<string, RailComponent>();
	private readonly targetRunsByCell = new Map<string, StraightRun>();
	private readonly targetRunsByComponent = new Map<RailComponent, readonly StraightRun[]>();

	constructor(
		map: RailMapReader,
		sourceAnchor: Cell,
		acceptCandidate: RailNetworkLinkCandidateAcceptance | null = null,
		filterCandidate: RailNetworkLinkCandidateFilter | null = null,
		options: RailNetworkLinkAnchorOptions = {},
	) {
		this.sourceMap = map;
		this.acceptCandidate = acceptCandidate;
		this.filterCandidate = filterCandidate;
		this.allowSameComponent = options.allowSameComponent === true;
		this.restrictToSelectedRuns = options.restrictToSelectedRuns === true;
		this.maximumGapMeters = normalizeMaximumGapMeters(options.maximumGapMeters);
		this.baseRevision = map.getRevision();
		this.sourceAnchor = freezeCell(sourceAnchor);
		if (!map.hasRail(sourceAnchor.x, sourceAnchor.y)) {
			this.sourceForward = null;
			this.valid = false;
			this.reason = "첫 번째 앵커는 기존 레일 위에서 선택하세요";
			this.placementCode = "source-not-rail";
			this.sourceComponent = null;
			this.sourceRun = null;
			this.sourceRuns = Object.freeze([]);
			this.sourceComponentCellCount = 0;
			return;
		}
		const component = collectComponent(map, sourceAnchor);
		const clickedForward = straightTravelDirection(map, sourceAnchor);
		const clickedRun = clickedForward
			? collectStraightRun(map, sourceAnchor, clickedForward)
			: null;
		const supportedRuns = collectComponentStraightRuns(map, component)
			.filter(runHasJunctionSupport)
			.sort((left, right) => compareRunsNearCell(left, right, sourceAnchor))
			.slice(0, RAIL_NETWORK_LINK_MAXIMUM_AUTO_RUNS);
		const sourceRuns = this.restrictToSelectedRuns
			? clickedRun && runHasJunctionSupport(clickedRun)
				? [clickedRun]
				: []
			: clickedRun && runHasJunctionSupport(clickedRun)
				? [clickedRun, ...supportedRuns.filter((candidate) => !sameRun(candidate, clickedRun))]
				: supportedRuns;
		const run = sourceRuns[0] ?? null;
		this.sourceForward = run?.forward ?? null;
		this.sourceComponent = component;
		this.sourceRun = run;
		this.sourceRuns = Object.freeze(sourceRuns);
		this.sourceComponentCellCount = component.cells.length;
		if (!component.closed || !component.stronglyConnected) {
			this.valid = false;
			this.reason = "첫 번째 앵커가 속한 레일을 먼저 하나의 폐쇄 단방향 루프로 완성하세요";
			this.placementCode = "source-not-closed";
			return;
		}
		if (!run) {
			this.valid = false;
			this.reason = `이 루프에는 왕복 분기 사이 ${RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS} m와 양끝 지지를 확보할 직선이 없습니다`;
			this.placementCode = clickedForward === null ? "source-not-straight" : "insufficient-support";
			return;
		}
		this.valid = true;
		this.reason = "연결할 다른 폐쇄 루프의 아무 레일이나 선택하세요";
		this.placementCode = "valid";
	}

	matches(map: RailMapReader): boolean {
		return this.sourceMap === map && this.baseRevision === map.getRevision();
	}

	matchesAnchor(map: RailMapReader, anchor: Cell): boolean {
		return (
			this.matches(map) && this.sourceAnchor.x === anchor.x && this.sourceAnchor.y === anchor.y
		);
	}

	containsSourceCell(cell: Cell): boolean {
		return this.sourceComponent?.keys.has(cellKey(cell.x, cell.y)) ?? false;
	}

	allowsSameComponentTarget(): boolean {
		return this.allowSameComponent;
	}

	restrictsToSelectedRuns(): boolean {
		return this.restrictToSelectedRuns;
	}

	isDistinctClosedTarget(map: RailMapReader, target: Cell): boolean {
		if (
			!this.matches(map) ||
			!this.sourceComponent?.closed ||
			!this.sourceComponent.stronglyConnected ||
			this.containsSourceCell(target)
		) {
			return false;
		}
		const targetComponent = this.getTargetComponent(map, target);
		return targetComponent?.closed === true && targetComponent.stronglyConnected;
	}

	getSourceRun(): StraightRun | null {
		return this.sourceRun;
	}

	getSourceRuns(): readonly StraightRun[] {
		return this.sourceRuns;
	}

	acceptsCandidate(plan: RailNetworkLinkPlan): boolean {
		return this.acceptCandidate?.(plan) ?? true;
	}

	hasCandidateAcceptance(): boolean {
		return this.acceptCandidate !== null;
	}

	isCandidateEligible(plan: RailNetworkLinkPlan): boolean {
		return this.filterCandidate?.(plan) ?? true;
	}

	hasCandidateFilter(): boolean {
		return this.filterCandidate !== null;
	}

	getTargetComponent(map: RailMapReader, target: Cell): RailComponent | null {
		if (!this.matches(map) || !map.hasRail(target.x, target.y)) return null;
		const key = cellKey(target.x, target.y);
		const cached = this.targetComponentsByCell.get(key);
		if (cached) return cached;
		const component = collectComponent(map, target);
		for (const componentKey of component.keys) {
			this.targetComponentsByCell.set(componentKey, component);
		}
		return component;
	}

	getTargetRun(map: RailMapReader, target: Cell, forward: Direction): StraightRun | null {
		if (!this.matches(map)) return null;
		const key = cellKey(target.x, target.y);
		const cached = this.targetRunsByCell.get(key);
		if (cached?.forward === forward) return cached;
		const run = collectStraightRun(map, target, forward);
		for (let coordinate = run.minimum; coordinate <= run.maximum; coordinate++) {
			const cell = cellOnRun(run, coordinate);
			this.targetRunsByCell.set(cellKey(cell.x, cell.y), run);
		}
		return run;
	}

	getTargetRuns(map: RailMapReader, target: Cell): readonly StraightRun[] {
		if (this.restrictToSelectedRuns) {
			const forward = straightTravelDirection(map, target);
			if (forward === null) return Object.freeze([]);
			const run = this.getTargetRun(map, target, forward);
			return run !== null && runHasJunctionSupport(run) ? Object.freeze([run]) : Object.freeze([]);
		}
		const component = this.getTargetComponent(map, target);
		if (!component) return Object.freeze([]);
		let runs = this.targetRunsByComponent.get(component);
		if (!runs) {
			runs = Object.freeze(
				collectComponentStraightRuns(map, component).filter(runHasJunctionSupport),
			);
			this.targetRunsByComponent.set(component, runs);
		}
		return Object.freeze(
			[...runs]
				.sort((left, right) => compareRunsNearCell(left, right, target))
				.slice(0, RAIL_NETWORK_LINK_MAXIMUM_AUTO_RUNS),
		);
	}
}

export function createRailNetworkLinkAnchorContext(
	map: RailMapReader,
	sourceAnchor: Cell,
	acceptCandidate: RailNetworkLinkCandidateAcceptance | null = null,
	filterCandidate: RailNetworkLinkCandidateFilter | null = null,
	options: RailNetworkLinkAnchorOptions = {},
): RailNetworkLinkAnchorContext {
	return new RailNetworkLinkAnchorContext(
		map,
		sourceAnchor,
		acceptCandidate,
		filterCandidate,
		options,
	);
}

export function planRailNetworkLink(
	map: RailMapReader,
	context: RailNetworkLinkAnchorContext,
	targetAnchor: Cell,
	explicitSide: RailModuleSide | null = null,
): RailNetworkLinkPlan {
	const sourceAnchor = context.sourceAnchor;
	const sourceRun = context.getSourceRun();
	const baseMetadata = metadata({
		placementCode: context.valid ? "target-not-rail" : context.placementCode,
		sourceAnchor,
		targetAnchor,
		sourceForward: context.sourceForward,
		targetForward: straightTravelDirection(map, targetAnchor),
		side: null,
		sourceComponentCellCount: context.sourceComponentCellCount,
		targetComponentCellCount: 0,
	});
	if (!context.matches(map)) {
		return invalidPlan(
			map,
			baseMetadata,
			"레일이 변경되었습니다. 첫 번째 연결 앵커를 다시 선택하세요",
			"stale",
			[sourceAnchor],
		);
	}
	if (!context.valid || !sourceRun || context.sourceForward === null) {
		return invalidPlan(map, baseMetadata, context.reason, context.placementCode, [sourceAnchor]);
	}
	if (!map.hasRail(targetAnchor.x, targetAnchor.y)) {
		return invalidPlan(
			map,
			baseMetadata,
			"두 번째 앵커는 연결할 다른 폐쇄 루프의 레일 위에서 선택하세요",
			"target-not-rail",
			[targetAnchor],
		);
	}
	if (context.containsSourceCell(targetAnchor) && !context.allowsSameComponentTarget()) {
		return invalidPlan(
			map,
			baseMetadata,
			"폐쇄 루프 연결은 서로 다른 두 루프 사이에서만 만들 수 있습니다",
			"same-component",
			[targetAnchor],
		);
	}

	const targetComponent = context.getTargetComponent(map, targetAnchor);
	if (!targetComponent?.closed || !targetComponent.stronglyConnected) {
		return invalidPlan(
			map,
			metadata({
				...baseMetadata,
				targetComponentCellCount: targetComponent?.cells.length ?? 0,
			}),
			"두 번째 앵커가 속한 레일도 먼저 하나의 폐쇄 단방향 루프로 완성하세요",
			"target-not-closed",
			[targetAnchor],
		);
	}

	const sourceRuns = context.getSourceRuns();
	const targetRuns = context.getTargetRuns(map, targetAnchor);
	if (targetRuns.length === 0) {
		return invalidPlan(
			map,
			metadata({
				...baseMetadata,
				targetComponentCellCount: targetComponent.cells.length,
			}),
			`두 번째 루프에는 왕복 분기 사이 ${RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS} m와 양끝 지지를 확보할 직선이 없습니다`,
			"target-not-straight",
			[targetAnchor],
		);
	}

	const directForward = straightTravelDirection(map, targetAnchor);
	const directRun = directForward ? context.getTargetRun(map, targetAnchor, directForward) : null;
	const rankedRuns = directRun
		? [directRun, ...targetRuns.filter((run) => !sameRun(run, directRun))]
		: targetRuns;
	const runPairs = sourceRuns
		.flatMap((candidateSourceRun) =>
			rankedRuns.map(
				(targetRun): RankedRunPair => ({
					sourceRun: candidateSourceRun,
					targetRun,
					score:
						distanceToRun(candidateSourceRun, sourceAnchor) * 1_000 +
						distanceToRun(targetRun, targetAnchor) * 1_000,
				}),
			),
		)
		.sort(compareRankedRunPairs)
		.slice(0, RAIL_NETWORK_LINK_MAXIMUM_AUTO_PLANS);
	const candidates: ScoredNetworkLinkPlan[] = [];
	for (const { sourceRun: candidateSourceRun, targetRun } of runPairs) {
		const remaining = RAIL_NETWORK_LINK_MAXIMUM_AUTO_PLANS - candidates.length;
		if (remaining <= 0) break;
		const pairBudget = Math.min(remaining, RAIL_NETWORK_LINK_MAXIMUM_PLANS_PER_RUN_PAIR);
		candidates.push(
			...plansBetweenRuns(
				map,
				context,
				candidateSourceRun,
				targetRun,
				targetComponent,
				targetAnchor,
				explicitSide,
				pairBudget,
			),
		);
	}
	candidates.sort(compareScoredNetworkLinkPlans);
	const topologyValid = candidates.filter((candidate) => candidate.plan.valid);
	const eligibleTopology = context.hasCandidateFilter()
		? topologyValid.filter((candidate) => context.isCandidateEligible(candidate.plan))
		: topologyValid;
	const physicalCandidates = physicalCandidateShortlist(
		eligibleTopology,
		RAIL_NETWORK_LINK_MAXIMUM_PHYSICAL_PLANS,
	);
	const accepted = physicalCandidates.find((candidate) => context.acceptsCandidate(candidate.plan));
	if (accepted) return accepted.plan;
	if (eligibleTopology[0]) {
		return context.hasCandidateAcceptance()
			? physicallyRejectedPlan(eligibleTopology[0].plan)
			: eligibleTopology[0].plan;
	}
	if (topologyValid[0] && context.hasCandidateFilter()) {
		return physicallyRejectedPlan(topologyValid[0].plan);
	}
	const nearestFailure = candidates.sort(compareScoredNetworkLinkPlans)[0];
	if (nearestFailure) return nearestFailure.plan;
	return invalidPlan(
		map,
		metadata({
			...baseMetadata,
			targetComponentCellCount: targetComponent.cells.length,
		}),
		"두 폐쇄 루프 사이에서 교차 없이 접선으로 연결할 OUTBOUND와 RETURN 경로를 찾지 못했습니다",
		"topology",
		[sourceAnchor, targetAnchor],
	);
}

export function isRailNetworkLinkPlan(plan: unknown): plan is RailNetworkLinkPlan {
	return typeof plan === "object" && plan !== null && "networkLink" in plan;
}

function plansBetweenRuns(
	map: RailMapReader,
	context: RailNetworkLinkAnchorContext,
	sourceRun: StraightRun,
	targetRun: StraightRun,
	targetComponent: RailComponent,
	targetSelection: Cell,
	explicitSide: RailModuleSide | null,
	maximumCandidates: number,
): readonly ScoredNetworkLinkPlan[] {
	return sourceRun.axis === targetRun.axis
		? planParallelRuns(
				map,
				context,
				sourceRun,
				targetRun,
				targetComponent,
				targetSelection,
				explicitSide,
				maximumCandidates,
			)
		: planPerpendicularRuns(
				map,
				context,
				sourceRun,
				targetRun,
				targetComponent,
				targetSelection,
				explicitSide,
				maximumCandidates,
			);
}

function planParallelRuns(
	map: RailMapReader,
	context: RailNetworkLinkAnchorContext,
	sourceRun: StraightRun,
	targetRun: StraightRun,
	targetComponent: RailComponent,
	targetSelection: Cell,
	explicitSide: RailModuleSide | null,
	maximumCandidates: number,
): readonly ScoredNetworkLinkPlan[] {
	const sourceAnchor = nearestCellOnRun(sourceRun, context.sourceAnchor);
	const targetAnchor = nearestCellOnRun(targetRun, targetSelection);
	const lateralDirection = directionAcrossRuns(sourceRun, targetRun);
	const distanceScore =
		(distanceToRun(sourceRun, context.sourceAnchor) + distanceToRun(targetRun, targetSelection)) *
		1_000;
	const lateralSide =
		lateralDirection === null
			? null
			: lateralDirection === leftDirection(sourceRun.forward)
				? "left"
				: "right";
	if (explicitSide !== null && lateralSide !== null && explicitSide !== lateralSide) {
		return [
			scoredInvalid(
				map,
				context,
				targetComponent,
				sourceAnchor,
				targetAnchor,
				targetRun,
				lateralSide,
				`도착 루프는 출발 흐름의 ${lateralSide === "left" ? "왼쪽" : "오른쪽"}에 있습니다`,
				"wrong-side",
				distanceScore,
			),
		];
	}
	const gap = Math.abs(targetRun.fixedCoordinate - sourceRun.fixedCoordinate);
	if (lateralSide !== null && gap < RAIL_NETWORK_LINK_MINIMUM_GAP_METERS) {
		return [
			scoredInvalid(
				map,
				context,
				targetComponent,
				sourceAnchor,
				targetAnchor,
				targetRun,
				lateralSide,
				`두 평행 레인은 최소 ${RAIL_NETWORK_LINK_MINIMUM_GAP_METERS} m 떨어져 있어야 합니다`,
				"insufficient-gap",
				distanceScore,
			),
		];
	}
	if (lateralSide !== null && gap > context.maximumGapMeters) {
		return [
			scoredInvalid(
				map,
				context,
				targetComponent,
				sourceAnchor,
				targetAnchor,
				targetRun,
				lateralSide,
				`한 번의 폐쇄 루프 연결은 최대 ${context.maximumGapMeters} m까지 만들 수 있습니다`,
				"excessive-gap",
				distanceScore,
			),
		];
	}
	const candidates: ScoredNetworkLinkPlan[] = [];
	let nearestFailure: ScoredNetworkLinkPlan | null = null;
	const pairKey = networkLinkRunPairKey(sourceRun, targetRun);
	const directPairs = chooseJunctionPairs(sourceRun, targetRun, sourceAnchor, targetAnchor);
	for (const pair of directPairs) {
		if (lateralSide === null) break;
		const sourceDeparture = cellOnRun(sourceRun, pair.departureCoordinate);
		const targetArrival = cellOnRun(targetRun, pair.departureCoordinate);
		const targetDeparture = cellOnRun(targetRun, pair.returnCoordinate);
		const sourceArrival = cellOnRun(sourceRun, pair.returnCoordinate);
		const outboundCells = cardinalLine(sourceDeparture, targetArrival);
		const returnCells = cardinalLine(targetDeparture, sourceArrival);
		const junctionScore =
			(Math.abs(pair.departureCoordinate - axisCoordinate(sourceAnchor, sourceRun.forward)) +
				Math.abs(pair.departureCoordinate - axisCoordinate(targetAnchor, targetRun.forward))) *
				10 +
			(junctionPairDirection(pair) === directionSign(sourceRun.forward) ? 0 : 1);
		const candidate = scoreBuiltNetworkLink(
			map,
			context,
			targetComponent,
			sourceAnchor,
			targetAnchor,
			targetRun,
			lateralSide,
			sourceDeparture,
			sourceArrival,
			targetArrival,
			targetDeparture,
			outboundCells,
			returnCells,
			distanceScore + junctionScore + outboundCells.length + returnCells.length,
			`${pairKey}:direct:${junctionPairDirection(pair)}`,
		);
		if (candidate.plan.valid) candidates.push(candidate);
		else nearestFailure = nearerFailure(nearestFailure, candidate);
		if (candidates.length >= maximumCandidates) {
			return candidates.sort(compareScoredNetworkLinkPlans);
		}
	}

	const sourcePairs = junctionPairOptions(
		sourceRun,
		axisCoordinate(sourceAnchor, sourceRun.forward),
	);
	const targetPairs = junctionPairOptions(
		targetRun,
		axisCoordinate(targetAnchor, targetRun.forward),
	);
	const corridorPairs = parallelCorridorPairs(sourceRun, targetRun);
	const doglegDescriptors: ParallelDoglegDescriptor[] = [];
	for (const sourcePair of sourcePairs) {
		for (const targetPair of targetPairs) {
			for (const corridorPair of corridorPairs) {
				const sourceDeparture = cellOnRun(sourceRun, sourcePair.departureCoordinate);
				const sourceArrival = cellOnRun(sourceRun, sourcePair.returnCoordinate);
				const targetArrival = cellOnRun(targetRun, targetPair.departureCoordinate);
				const targetDeparture = cellOnRun(targetRun, targetPair.returnCoordinate);
				const outboundControlPoints = parallelDoglegControlPoints(
					sourceDeparture,
					targetArrival,
					sourceRun.axis,
					corridorPair.outboundCoordinate,
				);
				const returnControlPoints = parallelDoglegControlPoints(
					targetDeparture,
					sourceArrival,
					targetRun.axis,
					corridorPair.returnCoordinate,
				);
				if (
					cardinalPolylineSelfIntersects(outboundControlPoints) ||
					cardinalPolylineSelfIntersects(returnControlPoints) ||
					cardinalPolylinesIntersect(outboundControlPoints, returnControlPoints)
				) {
					continue;
				}
				const outboundMetrics = parallelDoglegMetrics(
					sourceDeparture,
					targetArrival,
					sourceRun.axis,
					corridorPair.outboundCoordinate,
				);
				const returnMetrics = parallelDoglegMetrics(
					targetDeparture,
					sourceArrival,
					targetRun.axis,
					corridorPair.returnCoordinate,
				);
				const side =
					outboundMetrics.departureDirection === leftDirection(sourceRun.forward)
						? "left"
						: ("right" as const);
				const score =
					distanceScore +
					100 +
					Math.abs(
						sourcePair.departureCoordinate - axisCoordinate(sourceAnchor, sourceRun.forward),
					) *
						10 +
					Math.abs(
						targetPair.departureCoordinate - axisCoordinate(targetAnchor, targetRun.forward),
					) *
						10 +
					outboundMetrics.stepCount +
					returnMetrics.stepCount +
					2;
				const familyKey = `${pairKey}:dogleg:${corridorPair.outboundCoordinate}:${corridorPair.returnCoordinate}:${junctionPairDirection(sourcePair)}:${junctionPairDirection(targetPair)}`;
				doglegDescriptors.push(
					Object.freeze({
						sourceDeparture,
						sourceArrival,
						targetArrival,
						targetDeparture,
						outboundCorridor: corridorPair.outboundCoordinate,
						returnCorridor: corridorPair.returnCoordinate,
						outboundMetrics,
						returnMetrics,
						side,
						score,
						familyKey,
					}),
				);
			}
		}
	}
	doglegDescriptors.sort(compareLinkCandidateDescriptors);
	for (const descriptor of roundRobinDescriptorsByFamily(
		doglegDescriptors,
		RAIL_NETWORK_LINK_MAXIMUM_DESCRIPTOR_SCANS_PER_RUN_PAIR,
	)) {
		if (candidates.length >= maximumCandidates) break;
		if (explicitSide !== null && explicitSide !== descriptor.side) {
			nearestFailure = nearerFailure(
				nearestFailure,
				scoredInvalid(
					map,
					context,
					targetComponent,
					sourceAnchor,
					targetAnchor,
					targetRun,
					descriptor.side,
					`도착 루프는 출발 흐름의 ${descriptor.side === "left" ? "왼쪽" : "오른쪽"}에 있습니다`,
					"wrong-side",
					descriptor.score,
					descriptor.familyKey,
				),
			);
			continue;
		}
		if (
			descriptor.outboundMetrics.maximumLeg > context.maximumGapMeters ||
			descriptor.returnMetrics.maximumLeg > context.maximumGapMeters
		) {
			nearestFailure = nearerFailure(
				nearestFailure,
				scoredInvalid(
					map,
					context,
					targetComponent,
					sourceAnchor,
					targetAnchor,
					targetRun,
					descriptor.side,
					`폐쇄 루프 연결의 각 직선 구간은 최대 ${context.maximumGapMeters} m입니다`,
					"excessive-gap",
					descriptor.score,
					descriptor.familyKey,
				),
			);
			continue;
		}
		const outboundCells = parallelDoglegRoute(
			descriptor.sourceDeparture,
			descriptor.targetArrival,
			sourceRun.axis,
			descriptor.outboundCorridor,
		);
		const returnCells = parallelDoglegRoute(
			descriptor.targetDeparture,
			descriptor.sourceArrival,
			targetRun.axis,
			descriptor.returnCorridor,
		);
		const candidate = scoreBuiltNetworkLink(
			map,
			context,
			targetComponent,
			sourceAnchor,
			targetAnchor,
			targetRun,
			descriptor.side,
			descriptor.sourceDeparture,
			descriptor.sourceArrival,
			descriptor.targetArrival,
			descriptor.targetDeparture,
			outboundCells,
			returnCells,
			descriptor.score,
			descriptor.familyKey,
		);
		if (candidate.plan.valid) candidates.push(candidate);
		else nearestFailure = nearerFailure(nearestFailure, candidate);
	}
	if (candidates.length > 0) return candidates.sort(compareScoredNetworkLinkPlans);
	if (nearestFailure) return [nearestFailure];
	return [
		scoredInvalid(
			map,
			context,
			targetComponent,
			sourceAnchor,
			targetAnchor,
			targetRun,
			lateralSide,
			`두 레일에 ${RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS} m 간격의 분기 지지가 필요합니다`,
			"insufficient-support",
			distanceScore,
		),
	];
}

function planPerpendicularRuns(
	map: RailMapReader,
	context: RailNetworkLinkAnchorContext,
	sourceRun: StraightRun,
	targetRun: StraightRun,
	targetComponent: RailComponent,
	targetSelection: Cell,
	explicitSide: RailModuleSide | null,
	maximumCandidates: number,
): readonly ScoredNetworkLinkPlan[] {
	const sourceAnchor = nearestCellOnRun(sourceRun, context.sourceAnchor);
	const targetAnchor = nearestCellOnRun(targetRun, targetSelection);
	const sourcePairs = junctionPairOptions(
		sourceRun,
		axisCoordinate(sourceAnchor, sourceRun.forward),
	);
	const targetPairs = junctionPairOptions(
		targetRun,
		axisCoordinate(targetAnchor, targetRun.forward),
	);
	const pairKey = networkLinkRunPairKey(sourceRun, targetRun);
	const descriptors: PerpendicularLinkDescriptor[] = [];
	for (const sourcePair of sourcePairs) {
		for (const targetPair of targetPairs) {
			const sourceDeparture = cellOnRun(sourceRun, sourcePair.departureCoordinate);
			const sourceArrival = cellOnRun(sourceRun, sourcePair.returnCoordinate);
			const targetArrival = cellOnRun(targetRun, targetPair.departureCoordinate);
			const targetDeparture = cellOnRun(targetRun, targetPair.returnCoordinate);
			const outboundControlPoints = tangentCardinalControlPoints(
				sourceDeparture,
				targetArrival,
				sourceRun.axis,
			);
			const returnControlPoints = tangentCardinalControlPoints(
				targetDeparture,
				sourceArrival,
				targetRun.axis,
			);
			if (
				cardinalPolylineSelfIntersects(outboundControlPoints) ||
				cardinalPolylineSelfIntersects(returnControlPoints) ||
				cardinalPolylinesIntersect(outboundControlPoints, returnControlPoints)
			) {
				continue;
			}
			const outboundMetrics = tangentCardinalMetrics(
				sourceDeparture,
				targetArrival,
				sourceRun.axis,
			);
			const returnMetrics = tangentCardinalMetrics(targetDeparture, sourceArrival, targetRun.axis);
			const side =
				outboundMetrics.departureDirection === leftDirection(sourceRun.forward)
					? "left"
					: ("right" as const);
			const score =
				(distanceToRun(sourceRun, context.sourceAnchor) +
					distanceToRun(targetRun, targetSelection)) *
					1_000 +
				Math.abs(sourcePair.departureCoordinate - axisCoordinate(sourceAnchor, sourceRun.forward)) *
					10 +
				Math.abs(targetPair.departureCoordinate - axisCoordinate(targetAnchor, targetRun.forward)) *
					10 +
				outboundMetrics.stepCount +
				returnMetrics.stepCount +
				2;
			const familyKey = `${pairKey}:perpendicular:${junctionPairDirection(sourcePair)}:${junctionPairDirection(targetPair)}`;
			descriptors.push(
				Object.freeze({
					sourceDeparture,
					sourceArrival,
					targetArrival,
					targetDeparture,
					outboundMetrics,
					returnMetrics,
					side,
					score,
					familyKey,
				}),
			);
		}
	}
	descriptors.sort(compareLinkCandidateDescriptors);
	const candidates: ScoredNetworkLinkPlan[] = [];
	let nearestFailure: ScoredNetworkLinkPlan | null = null;
	for (const descriptor of roundRobinDescriptorsByFamily(
		descriptors,
		RAIL_NETWORK_LINK_MAXIMUM_DESCRIPTOR_SCANS_PER_RUN_PAIR,
	)) {
		if (candidates.length >= maximumCandidates) break;
		if (explicitSide !== null && explicitSide !== descriptor.side) {
			nearestFailure = nearerFailure(
				nearestFailure,
				scoredInvalid(
					map,
					context,
					targetComponent,
					sourceAnchor,
					targetAnchor,
					targetRun,
					descriptor.side,
					`도착 루프는 출발 흐름의 ${descriptor.side === "left" ? "왼쪽" : "오른쪽"}에 있습니다`,
					"wrong-side",
					descriptor.score,
					descriptor.familyKey,
				),
			);
			continue;
		}
		if (
			descriptor.outboundMetrics.maximumLeg > context.maximumGapMeters ||
			descriptor.returnMetrics.maximumLeg > context.maximumGapMeters
		) {
			nearestFailure = nearerFailure(
				nearestFailure,
				scoredInvalid(
					map,
					context,
					targetComponent,
					sourceAnchor,
					targetAnchor,
					targetRun,
					descriptor.side,
					`폐쇄 루프 연결의 각 직선 구간은 최대 ${context.maximumGapMeters} m입니다`,
					"excessive-gap",
					descriptor.score,
					descriptor.familyKey,
				),
			);
			continue;
		}
		const outboundCells = tangentCardinalRoute(
			descriptor.sourceDeparture,
			descriptor.targetArrival,
			sourceRun.axis,
		);
		const returnCells = tangentCardinalRoute(
			descriptor.targetDeparture,
			descriptor.sourceArrival,
			targetRun.axis,
		);
		const candidate = scoreBuiltNetworkLink(
			map,
			context,
			targetComponent,
			sourceAnchor,
			targetAnchor,
			targetRun,
			descriptor.side,
			descriptor.sourceDeparture,
			descriptor.sourceArrival,
			descriptor.targetArrival,
			descriptor.targetDeparture,
			outboundCells,
			returnCells,
			descriptor.score,
			descriptor.familyKey,
		);
		if (candidate.plan.valid) candidates.push(candidate);
		else nearestFailure = nearerFailure(nearestFailure, candidate);
	}
	if (candidates.length > 0) return candidates.sort(compareScoredNetworkLinkPlans);
	return nearestFailure ? [nearestFailure] : Object.freeze([]);
}

function scoreBuiltNetworkLink(
	map: RailMapReader,
	context: RailNetworkLinkAnchorContext,
	targetComponent: RailComponent,
	sourceAnchor: Cell,
	targetAnchor: Cell,
	targetRun: StraightRun,
	side: RailModuleSide,
	sourceDeparture: Cell,
	sourceArrival: Cell,
	targetArrival: Cell,
	targetDeparture: Cell,
	outboundCells: readonly Cell[],
	returnCells: readonly Cell[],
	score: number,
	familyKey: string,
): ScoredNetworkLinkPlan {
	const linkMetadata = metadata({
		placementCode: "valid",
		sourceAnchor,
		targetAnchor,
		sourceForward: straightTravelDirection(map, sourceAnchor),
		targetForward: targetRun.forward,
		side,
		sourceComponentCellCount: context.sourceComponentCellCount,
		targetComponentCellCount: targetComponent.cells.length,
		sourceDeparture,
		sourceArrival,
		targetArrival,
		targetDeparture,
		outboundCells,
		returnCells,
	});
	const construction = planRailRouteBatch(map, [outboundCells, returnCells]);
	const plan = construction.valid
		? Object.freeze({
				...construction,
				reason: "두 폐쇄 루프를 OUTBOUND와 RETURN 경로로 연결할 수 있습니다",
				networkLink: linkMetadata,
			})
		: Object.freeze({
				...construction,
				networkLink: metadata({ ...linkMetadata, placementCode: "topology" }),
			});
	return Object.freeze({ plan, score, familyKey });
}

function scoredInvalid(
	map: RailMapReader,
	context: RailNetworkLinkAnchorContext,
	targetComponent: RailComponent,
	sourceAnchor: Cell,
	targetAnchor: Cell,
	targetRun: StraightRun,
	side: RailModuleSide | null,
	reason: string,
	placementCode: RailNetworkLinkPlacementCode,
	score: number,
	familyKey = `invalid:${placementCode}`,
): ScoredNetworkLinkPlan {
	return Object.freeze({
		plan: invalidPlan(
			map,
			metadata({
				placementCode,
				sourceAnchor,
				targetAnchor,
				sourceForward: straightTravelDirection(map, sourceAnchor),
				targetForward: targetRun.forward,
				side,
				sourceComponentCellCount: context.sourceComponentCellCount,
				targetComponentCellCount: targetComponent.cells.length,
			}),
			reason,
			placementCode,
			[sourceAnchor, targetAnchor],
		),
		score,
		familyKey,
	});
}

function physicallyRejectedPlan(plan: RailNetworkLinkPlan): RailNetworkLinkPlan {
	return Object.freeze({
		...plan,
		valid: false,
		reason:
			"OUTBOUND/RETURN 후보가 물리 간격 또는 포트 안전 검사를 통과하지 못했습니다 · 다른 루프 구간을 선택하세요",
		issueCode: "topology",
		networkLink: metadata({ ...plan.networkLink, placementCode: "physical" }),
	});
}

function compareScoredNetworkLinkPlans(
	left: ScoredNetworkLinkPlan,
	right: ScoredNetworkLinkPlan,
): number {
	const leftLink = left.plan.networkLink;
	const rightLink = right.plan.networkLink;
	return (
		left.score - right.score ||
		compareCells(leftLink.sourceAnchor, rightLink.sourceAnchor) ||
		compareCells(leftLink.targetAnchor, rightLink.targetAnchor) ||
		compareNullableCells(leftLink.sourceDeparture, rightLink.sourceDeparture) ||
		compareNullableCells(leftLink.sourceArrival, rightLink.sourceArrival) ||
		compareNullableCells(leftLink.targetArrival, rightLink.targetArrival) ||
		compareNullableCells(leftLink.targetDeparture, rightLink.targetDeparture) ||
		compareStableKeys(left.familyKey, right.familyKey)
	);
}

function compareLinkCandidateDescriptors(
	left: Pick<
		ParallelDoglegDescriptor,
		| "score"
		| "sourceDeparture"
		| "sourceArrival"
		| "targetArrival"
		| "targetDeparture"
		| "familyKey"
	>,
	right: Pick<
		ParallelDoglegDescriptor,
		| "score"
		| "sourceDeparture"
		| "sourceArrival"
		| "targetArrival"
		| "targetDeparture"
		| "familyKey"
	>,
): number {
	return (
		left.score - right.score ||
		compareCells(left.sourceDeparture, right.sourceDeparture) ||
		compareCells(left.sourceArrival, right.sourceArrival) ||
		compareCells(left.targetArrival, right.targetArrival) ||
		compareCells(left.targetDeparture, right.targetDeparture) ||
		compareStableKeys(left.familyKey, right.familyKey)
	);
}

function compareStableKeys(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function roundRobinDescriptorsByFamily<Descriptor extends { readonly familyKey: string }>(
	descriptors: readonly Descriptor[],
	limit: number,
): readonly Descriptor[] {
	if (limit <= 0) return Object.freeze([]);
	const groups = new Map<string, Descriptor[]>();
	for (const descriptor of descriptors) {
		const group = groups.get(descriptor.familyKey);
		if (group) group.push(descriptor);
		else groups.set(descriptor.familyKey, [descriptor]);
	}
	return Object.freeze(roundRobinGroups([...groups.values()], limit));
}

function roundRobinGroups<Value>(groups: readonly (readonly Value[])[], limit: number): Value[] {
	const result: Value[] = [];
	for (let depth = 0; result.length < limit; depth++) {
		let added = false;
		for (const group of groups.values()) {
			const descriptor = group[depth];
			if (!descriptor) continue;
			result.push(descriptor);
			added = true;
			if (result.length >= limit) break;
		}
		if (!added) break;
	}
	return result;
}

function nearerFailure(
	current: ScoredNetworkLinkPlan | null,
	candidate: ScoredNetworkLinkPlan,
): ScoredNetworkLinkPlan {
	return !current || compareScoredNetworkLinkPlans(candidate, current) < 0 ? candidate : current;
}

function compareRankedRunPairs(left: RankedRunPair, right: RankedRunPair): number {
	return (
		left.score - right.score ||
		compareRuns(left.sourceRun, right.sourceRun) ||
		compareRuns(left.targetRun, right.targetRun)
	);
}

function physicalCandidateShortlist(
	candidates: readonly ScoredNetworkLinkPlan[],
	limit: number,
): readonly ScoredNetworkLinkPlan[] {
	if (limit <= 0 || candidates.length === 0) return Object.freeze([]);
	const ranked = [...candidates].sort(compareScoredNetworkLinkPlans);
	const preferredSource = networkLinkSourceKey(ranked[0] as ScoredNetworkLinkPlan);
	const preferredSourceFamilies = roundRobinDescriptorsByFamily(
		ranked.filter((candidate) => networkLinkSourceKey(candidate) === preferredSource),
		ranked.length,
	);
	const queues = [
		preferredSourceFamilies,
		firstCandidatesByKey(ranked, networkLinkSourceKey),
		firstCandidatesByKey(ranked, networkLinkRunPairCandidateKey),
		firstCandidatesByKey(ranked, (candidate) => candidate.familyKey),
		ranked,
	];
	return Object.freeze(roundRobinUniqueCandidates(queues, limit));
}

function networkLinkSourceKey(candidate: ScoredNetworkLinkPlan): string {
	const link = candidate.plan.networkLink;
	return `${cellKey(link.sourceAnchor.x, link.sourceAnchor.y)}:${link.sourceForward ?? 0}`;
}

function networkLinkRunPairCandidateKey(candidate: ScoredNetworkLinkPlan): string {
	const link = candidate.plan.networkLink;
	return `${networkLinkSourceKey(candidate)}>${cellKey(link.targetAnchor.x, link.targetAnchor.y)}:${link.targetForward ?? 0}`;
}

function firstCandidatesByKey(
	candidates: readonly ScoredNetworkLinkPlan[],
	keyOf: (candidate: ScoredNetworkLinkPlan) => string,
): readonly ScoredNetworkLinkPlan[] {
	const seen = new Set<string>();
	return Object.freeze(
		candidates.filter((candidate) => {
			const key = keyOf(candidate);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}),
	);
}

function roundRobinUniqueCandidates(
	queues: readonly (readonly ScoredNetworkLinkPlan[])[],
	limit: number,
): ScoredNetworkLinkPlan[] {
	const result: ScoredNetworkLinkPlan[] = [];
	const selected = new Set<ScoredNetworkLinkPlan>();
	const cursors = queues.map(() => 0);
	while (result.length < limit) {
		let added = false;
		for (let queueIndex = 0; queueIndex < queues.length; queueIndex++) {
			const queue = queues[queueIndex] as readonly ScoredNetworkLinkPlan[];
			let cursor = cursors[queueIndex] as number;
			while (cursor < queue.length && selected.has(queue[cursor] as ScoredNetworkLinkPlan))
				cursor++;
			cursors[queueIndex] = cursor + 1;
			const candidate = queue[cursor];
			if (!candidate) continue;
			selected.add(candidate);
			result.push(candidate);
			added = true;
			if (result.length >= limit) break;
		}
		if (!added) break;
	}
	return result.sort(compareScoredNetworkLinkPlans);
}

function collectComponent(map: RailMapReader, start: Cell): RailComponent {
	const cells: Cell[] = [];
	const keys = new Set<string>();
	const stack = [start];
	while (stack.length > 0) {
		const current = stack.pop() as Cell;
		const key = cellKey(current.x, current.y);
		if (keys.has(key) || !map.hasRail(current.x, current.y)) continue;
		keys.add(key);
		cells.push(freezeCell(current));
		const rail = map.getRail(current.x, current.y);
		for (const direction of ALL_DIRECTIONS) {
			const next = moveCell(current, direction);
			const nextRail = map.getRail(next.x, next.y);
			const reciprocal = oppositeDirection(direction);
			const hasForwardEdge =
				(rail.outgoing & direction) !== 0 && (nextRail.incoming & reciprocal) !== 0;
			const hasReverseEdge =
				(rail.incoming & direction) !== 0 && (nextRail.outgoing & reciprocal) !== 0;
			if (hasForwardEdge || hasReverseEdge) stack.push(next);
		}
	}
	const closed = cells.every((cell) => cellHasReciprocalPorts(map, cell));
	const stronglyConnected =
		closed &&
		directedReachCount(map, start, keys, false) === keys.size &&
		directedReachCount(map, start, keys, true) === keys.size;
	return Object.freeze({
		keys,
		cells: Object.freeze(cells),
		closed,
		stronglyConnected,
	});
}

function collectComponentStraightRuns(map: RailMapReader, component: RailComponent): StraightRun[] {
	const runs = new Map<string, StraightRun>();
	const visitedStraightCells = new Set<string>();
	for (const cell of component.cells) {
		if (visitedStraightCells.has(cellKey(cell.x, cell.y))) continue;
		const forward = straightTravelDirection(map, cell);
		if (forward === null) continue;
		const run = collectStraightRun(map, cell, forward);
		const key = `${run.axis}:${run.fixedCoordinate}:${run.minimum}:${run.maximum}:${run.forward}`;
		runs.set(key, run);
		for (let coordinate = run.minimum; coordinate <= run.maximum; coordinate++) {
			const runCell = cellOnRun(run, coordinate);
			visitedStraightCells.add(cellKey(runCell.x, runCell.y));
		}
	}
	return [...runs.values()].sort(compareRuns);
}

function runHasJunctionSupport(run: StraightRun): boolean {
	return (
		run.maximum - run.minimum >=
		RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS + RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS * 2
	);
}

function compareRunsNearCell(left: StraightRun, right: StraightRun, cell: Cell): number {
	return distanceToRun(left, cell) - distanceToRun(right, cell) || compareRuns(left, right);
}

function compareRuns(left: StraightRun, right: StraightRun): number {
	return (
		(left.axis === right.axis ? 0 : left.axis === "x" ? -1 : 1) ||
		left.fixedCoordinate - right.fixedCoordinate ||
		left.minimum - right.minimum ||
		left.maximum - right.maximum ||
		left.forward - right.forward
	);
}

function networkLinkRunPairKey(source: StraightRun, target: StraightRun): string {
	return `${networkLinkRunKey(source)}>${networkLinkRunKey(target)}`;
}

function networkLinkRunKey(run: StraightRun): string {
	return `${run.axis}:${run.fixedCoordinate}:${run.minimum}:${run.maximum}:${run.forward}`;
}

function distanceToRun(run: StraightRun, cell: Cell): number {
	const coordinate = run.axis === "x" ? cell.x : cell.y;
	const cross = run.axis === "x" ? cell.y : cell.x;
	const along =
		coordinate < run.minimum
			? run.minimum - coordinate
			: coordinate > run.maximum
				? coordinate - run.maximum
				: 0;
	return Math.abs(cross - run.fixedCoordinate) + along;
}

function nearestCellOnRun(run: StraightRun, cell: Cell): Cell {
	const coordinate = run.axis === "x" ? cell.x : cell.y;
	return cellOnRun(run, Math.max(run.minimum, Math.min(run.maximum, coordinate)));
}

function sameRun(left: StraightRun, right: StraightRun): boolean {
	return (
		left.forward === right.forward &&
		left.axis === right.axis &&
		left.fixedCoordinate === right.fixedCoordinate &&
		left.minimum === right.minimum &&
		left.maximum === right.maximum
	);
}

function cellHasReciprocalPorts(map: RailMapReader, cell: Cell): boolean {
	const rail = map.getRail(cell.x, cell.y);
	if (rail.incoming === 0 || rail.outgoing === 0) return false;
	for (const direction of ALL_DIRECTIONS) {
		const next = moveCell(cell, direction);
		const nextRail = map.getRail(next.x, next.y);
		const reciprocal = oppositeDirection(direction);
		if ((rail.outgoing & direction) !== 0 && (nextRail.incoming & reciprocal) === 0) return false;
		if ((rail.incoming & direction) !== 0 && (nextRail.outgoing & reciprocal) === 0) return false;
	}
	return true;
}

function directedReachCount(
	map: RailMapReader,
	start: Cell,
	componentKeys: ReadonlySet<string>,
	reverse: boolean,
): number {
	const visited = new Set<string>();
	const stack = [start];
	while (stack.length > 0) {
		const current = stack.pop() as Cell;
		const key = cellKey(current.x, current.y);
		if (visited.has(key) || !componentKeys.has(key)) continue;
		visited.add(key);
		const rail = map.getRail(current.x, current.y);
		const mask = reverse ? rail.incoming : rail.outgoing;
		for (const direction of ALL_DIRECTIONS) {
			if ((mask & direction) === 0) continue;
			const next = moveCell(current, direction);
			const nextKey = cellKey(next.x, next.y);
			if (!componentKeys.has(nextKey)) continue;
			const nextRail = map.getRail(next.x, next.y);
			const reciprocalMask = reverse ? nextRail.outgoing : nextRail.incoming;
			if ((reciprocalMask & oppositeDirection(direction)) !== 0) stack.push(next);
		}
	}
	return visited.size;
}

function straightTravelDirection(map: RailMapReader, cell: Cell): Direction | null {
	if (map.getAdvancedSwitchOwningCell(cell.x, cell.y)) return null;
	const rail = map.getRail(cell.x, cell.y);
	if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) return null;
	const incoming = ALL_DIRECTIONS.find((direction) => (rail.incoming & direction) !== 0) ?? null;
	const outgoing = ALL_DIRECTIONS.find((direction) => (rail.outgoing & direction) !== 0) ?? null;
	return incoming !== null && outgoing !== null && incoming === oppositeDirection(outgoing)
		? outgoing
		: null;
}

function collectStraightRun(map: RailMapReader, anchor: Cell, forward: Direction): StraightRun {
	let minimum = axisCoordinate(anchor, forward);
	let maximum = minimum;
	for (const scanDirection of [forward, oppositeDirection(forward)] as const) {
		let current = anchor;
		while (true) {
			const next = moveCell(current, scanDirection);
			if (straightTravelDirection(map, next) !== forward) break;
			const coordinate = axisCoordinate(next, forward);
			minimum = Math.min(minimum, coordinate);
			maximum = Math.max(maximum, coordinate);
			current = next;
		}
	}
	return Object.freeze({
		forward,
		axis: forward === DIR_E || forward === DIR_W ? "x" : "y",
		fixedCoordinate: forward === DIR_E || forward === DIR_W ? anchor.y : anchor.x,
		minimum,
		maximum,
	});
}

function chooseJunctionPairs(
	source: StraightRun,
	target: StraightRun,
	sourceAnchor: Cell,
	targetAnchor: Cell,
): readonly JunctionPair[] {
	const minimum =
		Math.max(source.minimum, target.minimum) + RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS;
	const maximum =
		Math.min(source.maximum, target.maximum) - RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS;
	const spacing = RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS;
	if (maximum - minimum < spacing) return Object.freeze([]);
	const preferred = Math.round(
		(axisCoordinate(sourceAnchor, source.forward) + axisCoordinate(targetAnchor, target.forward)) /
			2,
	);
	const sourceSign = directionSign(source.forward);
	const candidates = new Map<string, JunctionPair & { score: number }>();
	for (const returnSign of [sourceSign, -sourceSign] as const) {
		const lower = returnSign > 0 ? minimum : minimum + spacing;
		const upper = returnSign > 0 ? maximum - spacing : maximum;
		if (lower > upper) continue;
		for (const offset of RAIL_NETWORK_LINK_JUNCTION_OFFSETS) {
			const departureCoordinate = Math.max(lower, Math.min(upper, preferred + offset));
			const returnCoordinate = departureCoordinate + returnSign * spacing;
			const key = `${departureCoordinate}:${returnCoordinate}`;
			candidates.set(key, {
				departureCoordinate,
				returnCoordinate,
				score:
					Math.abs(departureCoordinate - axisCoordinate(sourceAnchor, source.forward)) +
					Math.abs(departureCoordinate - axisCoordinate(targetAnchor, target.forward)) +
					(returnSign === sourceSign ? 0 : 0.25),
			});
		}
	}
	return freezeRankedJunctionPairs(candidates.values());
}

function junctionPairOptions(run: StraightRun, preferred: number): readonly JunctionPair[] {
	const minimum = run.minimum + RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS;
	const maximum = run.maximum - RAIL_NETWORK_LINK_RUN_END_SUPPORT_METERS;
	const spacing = RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS;
	if (maximum - minimum < spacing) return Object.freeze([]);
	const runSign = directionSign(run.forward);
	const pairs = new Map<string, JunctionPair & { score: number }>();
	for (const returnSign of [runSign, -runSign] as const) {
		const lower = returnSign > 0 ? minimum : minimum + spacing;
		const upper = returnSign > 0 ? maximum - spacing : maximum;
		if (lower > upper) continue;
		for (const offset of RAIL_NETWORK_LINK_JUNCTION_OFFSETS) {
			const departureCoordinate = Math.max(lower, Math.min(upper, preferred + offset));
			const returnCoordinate = departureCoordinate + returnSign * spacing;
			const key = `${departureCoordinate}:${returnCoordinate}`;
			pairs.set(key, {
				departureCoordinate,
				returnCoordinate,
				score: Math.abs(departureCoordinate - preferred) + (returnSign === runSign ? 0 : 0.25),
			});
		}
	}
	return freezeRankedJunctionPairs(pairs.values());
}

function freezeRankedJunctionPairs(
	pairs: Iterable<JunctionPair & { readonly score: number }>,
): readonly JunctionPair[] {
	const ranked = [...pairs].sort(
		(left, right) =>
			left.score - right.score ||
			left.departureCoordinate - right.departureCoordinate ||
			left.returnCoordinate - right.returnCoordinate,
	);
	const byDirection = new Map<1 | -1, typeof ranked>();
	for (const pair of ranked) {
		const direction = junctionPairDirection(pair);
		const group = byDirection.get(direction);
		if (group) group.push(pair);
		else byDirection.set(direction, [pair]);
	}
	return Object.freeze(
		roundRobinGroups([...byDirection.values()], RAIL_NETWORK_LINK_MAXIMUM_JUNCTION_PAIRS).map(
			({ departureCoordinate, returnCoordinate }) =>
				Object.freeze({ departureCoordinate, returnCoordinate }),
		),
	);
}

function junctionPairDirection(pair: JunctionPair): 1 | -1 {
	return pair.returnCoordinate > pair.departureCoordinate ? 1 : -1;
}

function directionAcrossRuns(source: StraightRun, target: StraightRun): Direction | null {
	if (source.fixedCoordinate === target.fixedCoordinate) return null;
	if (source.axis === "x") {
		return target.fixedCoordinate > source.fixedCoordinate ? DIR_S : DIR_N;
	}
	return target.fixedCoordinate > source.fixedCoordinate ? DIR_E : DIR_W;
}

function cellOnRun(run: StraightRun, coordinate: number): Cell {
	return run.axis === "x"
		? Object.freeze({ x: coordinate, y: run.fixedCoordinate })
		: Object.freeze({ x: run.fixedCoordinate, y: coordinate });
}

function cardinalLine(start: Cell, end: Cell): readonly Cell[] {
	const direction =
		start.x === end.x ? (end.y > start.y ? DIR_S : DIR_N) : end.x > start.x ? DIR_E : DIR_W;
	const cells: Cell[] = [freezeCell(start)];
	let current = start;
	while (current.x !== end.x || current.y !== end.y) {
		current = moveCell(current, direction);
		cells.push(freezeCell(current));
	}
	return Object.freeze(cells);
}

function tangentCardinalRoute(
	start: Cell,
	end: Cell,
	startRunAxis: StraightRun["axis"],
): readonly Cell[] {
	return materializeCardinalPolyline(tangentCardinalControlPoints(start, end, startRunAxis));
}

function tangentCardinalControlPoints(
	start: Cell,
	end: Cell,
	startRunAxis: StraightRun["axis"],
): readonly Cell[] {
	const elbow =
		startRunAxis === "x"
			? Object.freeze({ x: start.x, y: end.y })
			: Object.freeze({ x: end.x, y: start.y });
	return Object.freeze([freezeCell(start), elbow, freezeCell(end)]);
}

function tangentCardinalMetrics(
	start: Cell,
	end: Cell,
	startRunAxis: StraightRun["axis"],
): CardinalRouteMetrics {
	const firstDelta = startRunAxis === "x" ? end.y - start.y : end.x - start.x;
	const secondDelta = startRunAxis === "x" ? end.x - start.x : end.y - start.y;
	const firstAxis = startRunAxis === "x" ? "y" : "x";
	return Object.freeze({
		departureDirection:
			firstDelta !== 0
				? cardinalDirection(firstAxis, firstDelta)
				: cardinalDirection(startRunAxis, secondDelta),
		maximumLeg: Math.max(Math.abs(firstDelta), Math.abs(secondDelta)),
		stepCount: Math.abs(firstDelta) + Math.abs(secondDelta),
	});
}

function parallelCorridorPairs(
	sourceRun: StraightRun,
	targetRun: StraightRun,
): readonly ParallelCorridorPair[] {
	const delta = targetRun.fixedCoordinate - sourceRun.fixedCoordinate;
	const gap = Math.abs(delta);
	const pairs: ParallelCorridorPair[] = [];
	const keys = new Set<string>();
	const addPair = (outboundCoordinate: number, returnCoordinate: number): void => {
		if (outboundCoordinate === returnCoordinate) return;
		const key = `${outboundCoordinate}:${returnCoordinate}`;
		if (keys.has(key)) return;
		keys.add(key);
		pairs.push(Object.freeze({ outboundCoordinate, returnCoordinate }));
	};
	if (gap >= RAIL_NETWORK_LINK_MINIMUM_GAP_METERS) {
		const sign = delta > 0 ? 1 : -1;
		const inset = Math.max(1, Math.floor(gap / 3));
		const nearSource = sourceRun.fixedCoordinate + sign * inset;
		const nearTarget = targetRun.fixedCoordinate - sign * inset;
		addPair(nearSource, nearTarget);
		addPair(nearTarget, nearSource);
	}
	const minimum = Math.min(sourceRun.fixedCoordinate, targetRun.fixedCoordinate);
	const maximum = Math.max(sourceRun.fixedCoordinate, targetRun.fixedCoordinate);
	const externalInset = RAIL_NETWORK_LINK_MINIMUM_GAP_METERS;
	addPair(minimum - externalInset, minimum - externalInset * 2);
	addPair(minimum - externalInset * 2, minimum - externalInset);
	addPair(maximum + externalInset, maximum + externalInset * 2);
	addPair(maximum + externalInset * 2, maximum + externalInset);
	return Object.freeze(pairs);
}

function parallelDoglegRoute(
	start: Cell,
	end: Cell,
	runAxis: StraightRun["axis"],
	corridorCoordinate: number,
): readonly Cell[] {
	return materializeCardinalPolyline(
		parallelDoglegControlPoints(start, end, runAxis, corridorCoordinate),
	);
}

function parallelDoglegControlPoints(
	start: Cell,
	end: Cell,
	runAxis: StraightRun["axis"],
	corridorCoordinate: number,
): readonly Cell[] {
	const firstElbow =
		runAxis === "x"
			? Object.freeze({ x: start.x, y: corridorCoordinate })
			: Object.freeze({ x: corridorCoordinate, y: start.y });
	const secondElbow =
		runAxis === "x"
			? Object.freeze({ x: end.x, y: corridorCoordinate })
			: Object.freeze({ x: corridorCoordinate, y: end.y });
	return Object.freeze([freezeCell(start), firstElbow, secondElbow, freezeCell(end)]);
}

function materializeCardinalPolyline(points: readonly Cell[]): readonly Cell[] {
	const cells: Cell[] = [];
	for (let index = 1; index < points.length; index++) {
		const segment = cardinalLine(points[index - 1] as Cell, points[index] as Cell);
		cells.push(...(cells.length === 0 ? segment : segment.slice(1)));
	}
	return Object.freeze(cells);
}

export function cardinalPolylineSelfIntersects(points: readonly Cell[]): boolean {
	const segments = cardinalPolylineSegments(points);
	for (let leftIndex = 0; leftIndex < segments.length; leftIndex++) {
		for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex++) {
			const left = segments[leftIndex] as readonly [Cell, Cell];
			const right = segments[rightIndex] as readonly [Cell, Cell];
			if (rightIndex === leftIndex + 1) {
				if (cardinalSegmentsBacktrack(left[0], left[1], right[0], right[1])) return true;
				continue;
			}
			if (cardinalSegmentsIntersect(left[0], left[1], right[0], right[1])) return true;
		}
	}
	return false;
}

function cardinalSegmentsBacktrack(
	leftStart: Cell,
	leftEnd: Cell,
	rightStart: Cell,
	rightEnd: Cell,
): boolean {
	if (!sameCell(leftEnd, rightStart)) return true;
	const leftDelta = leftStart.x === leftEnd.x ? leftEnd.y - leftStart.y : leftEnd.x - leftStart.x;
	const rightDelta =
		rightStart.x === rightEnd.x ? rightEnd.y - rightStart.y : rightEnd.x - rightStart.x;
	const sameAxis = (leftStart.x === leftEnd.x) === (rightStart.x === rightEnd.x);
	return sameAxis && leftDelta * rightDelta < 0;
}

function cardinalPolylinesIntersect(left: readonly Cell[], right: readonly Cell[]): boolean {
	const leftSegments = cardinalPolylineSegments(left);
	const rightSegments = cardinalPolylineSegments(right);
	for (const leftSegment of leftSegments) {
		for (const rightSegment of rightSegments) {
			if (
				cardinalSegmentsIntersect(leftSegment[0], leftSegment[1], rightSegment[0], rightSegment[1])
			) {
				return true;
			}
		}
	}
	return false;
}

function cardinalPolylineSegments(points: readonly Cell[]): readonly (readonly [Cell, Cell])[] {
	const segments: Array<readonly [Cell, Cell]> = [];
	for (let index = 1; index < points.length; index++) {
		const start = points[index - 1] as Cell;
		const end = points[index] as Cell;
		if (!sameCell(start, end)) segments.push(Object.freeze([start, end]));
	}
	return segments;
}

function cardinalSegmentsIntersect(
	leftStart: Cell,
	leftEnd: Cell,
	rightStart: Cell,
	rightEnd: Cell,
): boolean {
	const leftVertical = leftStart.x === leftEnd.x;
	const rightVertical = rightStart.x === rightEnd.x;
	if (leftVertical && rightVertical) {
		return (
			leftStart.x === rightStart.x &&
			rangesOverlap(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y)
		);
	}
	if (!leftVertical && !rightVertical) {
		return (
			leftStart.y === rightStart.y &&
			rangesOverlap(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x)
		);
	}
	const verticalStart = leftVertical ? leftStart : rightStart;
	const verticalEnd = leftVertical ? leftEnd : rightEnd;
	const horizontalStart = leftVertical ? rightStart : leftStart;
	const horizontalEnd = leftVertical ? rightEnd : leftEnd;
	return (
		isWithin(verticalStart.x, horizontalStart.x, horizontalEnd.x) &&
		isWithin(horizontalStart.y, verticalStart.y, verticalEnd.y)
	);
}

function rangesOverlap(
	leftStart: number,
	leftEnd: number,
	rightStart: number,
	rightEnd: number,
): boolean {
	return (
		Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd)) <=
		Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd))
	);
}

function isWithin(value: number, start: number, end: number): boolean {
	return value >= Math.min(start, end) && value <= Math.max(start, end);
}

function sameCell(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}

function parallelDoglegMetrics(
	start: Cell,
	end: Cell,
	runAxis: StraightRun["axis"],
	corridorCoordinate: number,
): CardinalRouteMetrics {
	const firstDelta = runAxis === "x" ? corridorCoordinate - start.y : corridorCoordinate - start.x;
	const secondDelta = runAxis === "x" ? end.x - start.x : end.y - start.y;
	const thirdDelta = runAxis === "x" ? end.y - corridorCoordinate : end.x - corridorCoordinate;
	const crossAxis = runAxis === "x" ? "y" : "x";
	return Object.freeze({
		departureDirection:
			firstDelta !== 0
				? cardinalDirection(crossAxis, firstDelta)
				: secondDelta !== 0
					? cardinalDirection(runAxis, secondDelta)
					: cardinalDirection(crossAxis, thirdDelta),
		maximumLeg: Math.max(Math.abs(firstDelta), Math.abs(secondDelta), Math.abs(thirdDelta)),
		stepCount: Math.abs(firstDelta) + Math.abs(secondDelta) + Math.abs(thirdDelta),
	});
}

function cardinalDirection(axis: StraightRun["axis"], delta: number): Direction {
	if (axis === "x") return delta < 0 ? DIR_W : DIR_E;
	return delta < 0 ? DIR_N : DIR_S;
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function compareNullableCells(left: Cell | null, right: Cell | null): number {
	if (left === null) return right === null ? 0 : -1;
	if (right === null) return 1;
	return compareCells(left, right);
}

function invalidPlan(
	map: RailMapReader,
	baseMetadata: RailNetworkLinkMetadata,
	reason: string,
	placementCode: RailNetworkLinkPlacementCode,
	conflicts: readonly Cell[],
): RailNetworkLinkPlan {
	return Object.freeze({
		kind: "build",
		baseRevision: map.getRevision(),
		cells: Object.freeze([baseMetadata.sourceAnchor, baseMetadata.targetAnchor]),
		mutations: Object.freeze([]),
		valid: false,
		reason,
		issueCode: issueCodeForPlacement(placementCode),
		conflicts: Object.freeze(conflicts.map(freezeCell)),
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
		networkLink: metadata({ ...baseMetadata, placementCode }),
	});
}

function metadata(
	value: Partial<RailNetworkLinkMetadata> &
		Pick<
			RailNetworkLinkMetadata,
			| "placementCode"
			| "sourceAnchor"
			| "targetAnchor"
			| "sourceForward"
			| "targetForward"
			| "side"
			| "sourceComponentCellCount"
			| "targetComponentCellCount"
		>,
): RailNetworkLinkMetadata {
	return Object.freeze({
		version: 1,
		placementCode: value.placementCode,
		sourceAnchor: freezeCell(value.sourceAnchor),
		targetAnchor: freezeCell(value.targetAnchor),
		sourceForward: value.sourceForward,
		targetForward: value.targetForward,
		side: value.side,
		junctionSpacingMeters: RAIL_NETWORK_LINK_JUNCTION_SPACING_METERS,
		sourceComponentCellCount: value.sourceComponentCellCount,
		targetComponentCellCount: value.targetComponentCellCount,
		sourceDeparture: value.sourceDeparture ? freezeCell(value.sourceDeparture) : null,
		sourceArrival: value.sourceArrival ? freezeCell(value.sourceArrival) : null,
		targetArrival: value.targetArrival ? freezeCell(value.targetArrival) : null,
		targetDeparture: value.targetDeparture ? freezeCell(value.targetDeparture) : null,
		outboundCells: Object.freeze((value.outboundCells ?? []).map(freezeCell)),
		returnCells: Object.freeze((value.returnCells ?? []).map(freezeCell)),
	});
}

function issueCodeForPlacement(
	placementCode: RailNetworkLinkPlacementCode,
): RailConstructionIssueCode {
	if (placementCode === "source-not-rail" || placementCode === "target-not-rail") {
		return "disconnected";
	}
	if (
		placementCode === "source-not-straight" ||
		placementCode === "target-not-straight" ||
		placementCode === "non-parallel" ||
		placementCode === "wrong-side" ||
		placementCode === "insufficient-gap" ||
		placementCode === "excessive-gap" ||
		placementCode === "insufficient-support"
	) {
		return "insufficient-path";
	}
	return "topology";
}

function axisCoordinate(cell: Cell, direction: Direction): number {
	return direction === DIR_E || direction === DIR_W ? cell.x : cell.y;
}

function directionSign(direction: Direction): 1 | -1 {
	return direction === DIR_E || direction === DIR_S ? 1 : -1;
}

function leftDirection(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_W;
	if (direction === DIR_E) return DIR_N;
	if (direction === DIR_S) return DIR_E;
	return DIR_S;
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
