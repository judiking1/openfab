import {
	createRailAreaSelection,
	createRailAreaSelectionFromOwnerships,
	type RailAreaSelection,
	type RailAreaSelectionBounds,
} from "../core/RailAreaSelection";
import type {
	DirectedRailEdge,
	RailModuleOwnership,
	RailModuleOwnershipIndex,
} from "../core/RailModuleOwnership";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	moveCell,
	oppositeDirection,
} from "../core/railShape";
import { cellKey, type TileMap } from "../core/TileMap";

export type StaticFabHierarchyScope =
	| "wing"
	| "process-row"
	| "process-bank"
	| "process-block"
	| "factory";

export interface StaticFabHierarchyNode {
	readonly scope: StaticFabHierarchyScope;
	readonly key: string;
	readonly selection: RailAreaSelection;
	readonly directedEdgeCount: number;
}

export type StaticFabHierarchyResolution =
	| {
			readonly state: "resolved";
			readonly node: StaticFabHierarchyNode;
			readonly reason: string;
	  }
	| {
			readonly state: "ambiguous";
			readonly candidates: readonly StaticFabHierarchyNode[];
			readonly reason: string;
	  }
	| {
			readonly state: "none";
			readonly reason: string;
	  };

export interface StaticFabHierarchy {
	readonly revision: number;
	readonly wing: StaticFabHierarchyResolution;
	readonly processRow: StaticFabHierarchyResolution;
	readonly processRowPairing: StaticFabProcessRowPairingResolution;
	readonly processBank: StaticFabHierarchyResolution;
	readonly processBlock: StaticFabHierarchyResolution;
	readonly factory: StaticFabHierarchyResolution;
}

export interface StaticFabHierarchyBranch {
	readonly factory: StaticFabHierarchyNode;
	readonly wings: readonly StaticFabHierarchyNode[];
	readonly processRows: readonly StaticFabHierarchyNode[];
	readonly processRowPairing: StaticFabProcessRowPairingResolution;
	readonly processBanks: readonly StaticFabHierarchyNode[];
	readonly processBlocks: readonly StaticFabHierarchyNode[];
}

/** Revision-bound transient hierarchy suggestions. This index is never persisted in a project. */
export interface StaticFabHierarchyIndex {
	readonly revision: number;
	readonly branches: readonly StaticFabHierarchyBranch[];
}

export interface StaticFabHierarchyCandidateOwnershipIndex {
	readonly candidates: readonly StaticFabHierarchyNode[];
	resolve(ownershipKey: string): StaticFabHierarchyNode | null;
}

const MAXIMUM_ROW_INTERNAL_GAP_METERS = 24;
const MAXIMUM_DENSE_RUN_BRIDGE_METERS = 2;
const MINIMUM_DENSE_RUN_METERS = 8;
const HIERARCHY_BOUNDS_PADDING_METERS = 2;
const MINIMUM_FACTORY_PROCESS_ROWS = 4;
const MINIMUM_OUTER_COVERAGE_RATIO = 0.55;
const MINIMUM_SPINE_COVERAGE_RATIO = 0.45;
const MINIMUM_SPINE_HALF_WIDTH_METERS = 12;
const PROCESS_ROW_TOPOLOGY_HOP_PADDING = 16;

export type StaticFabHierarchyAxis = "horizontal" | "vertical";
type HierarchyAxis = StaticFabHierarchyAxis;

interface AxisEdgeSample {
	readonly along: number;
	readonly across: number;
}

interface AxisBand {
	readonly minAcross: number;
	readonly maxAcross: number;
	readonly samples: readonly AxisEdgeSample[];
}

interface AxisRun {
	readonly minAlong: number;
	readonly maxAlong: number;
}

interface DerivedHierarchyScopes {
	readonly wings: readonly StaticFabHierarchyNode[];
	readonly processRows: readonly StaticFabHierarchyNode[];
	readonly processRowPairing: StaticFabProcessRowPairingResolution;
	readonly processBanks: readonly StaticFabHierarchyNode[];
	readonly processBlocks: readonly StaticFabHierarchyNode[];
}

export interface StaticFabHierarchyAxisEvidence {
	readonly processRowPairingState: StaticFabProcessRowPairingResolution["state"];
	readonly wingCount: number;
	readonly processRowCount: number;
}

type ProcessRowPair = readonly [StaticFabHierarchyNode, StaticFabHierarchyNode];
export type StaticFabProcessRowIndexPair = readonly [number, number];

export interface StaticFabProcessRowTopologyEvidence {
	readonly rows: StaticFabProcessRowIndexPair;
	readonly sameSideHopCounts: readonly [number, number];
}

export interface StaticFabProcessRowPairingAlternative {
	readonly pairs: readonly StaticFabProcessRowIndexPair[];
	readonly totalHopCount: number;
}

export type StaticFabProcessRowPairingResolution =
	| {
			readonly state: "resolved";
			readonly pairs: readonly StaticFabProcessRowIndexPair[];
			readonly totalHopCount: number;
			readonly reason: string;
	  }
	| {
			readonly state: "ambiguous";
			/**
			 * Evidence transport may retain candidate pairs, but canonical Bank/Block materialization
			 * must ignore them until one mutually exclusive alternative is chosen.
			 */
			readonly pairs: readonly StaticFabProcessRowIndexPair[];
			readonly alternatives: readonly StaticFabProcessRowPairingAlternative[];
			readonly reason: string;
	  }
	| {
			readonly state: "none";
			readonly pairs: readonly [];
			readonly reason: string;
	  };

interface ProcessRowWingPair {
	readonly row: StaticFabHierarchyNode;
	readonly wings: readonly [StaticFabHierarchyNode, StaticFabHierarchyNode];
}

interface ProcessRowNodePairing {
	readonly resolution: StaticFabProcessRowPairingResolution;
	readonly pairs: readonly ProcessRowPair[];
}

/**
 * Compile transient hierarchy suggestions once for one authored revision.
 *
 * No node identity is persisted. A disconnected rail component defines factory scope, horizontal
 * density defines Wing candidates, and large vertical gaps define process-row candidates. Any
 * geometry-equivalent result remains explicit ambiguity instead of being guessed from proximity.
 */
export function compileStaticFabHierarchyIndex(
	map: TileMap,
	index: RailModuleOwnershipIndex,
): StaticFabHierarchyIndex {
	if (map.getRevision() !== index.revision) {
		throw new Error("레일 맵과 정적 FAB 계층 인덱스의 revision이 일치하지 않습니다");
	}
	const factories = factoryNodes(map, index);
	const branches = factories.map((factory) => {
		const factoryModules = factory.selection.ownerships;
		const factoryBounds = factory.selection.bounds;
		const horizontal = deriveHierarchyScopes(
			index,
			factory,
			factoryModules,
			factoryBounds,
			"horizontal",
		);
		const vertical = deriveHierarchyScopes(
			index,
			factory,
			factoryModules,
			factoryBounds,
			"vertical",
		);
		const hierarchy =
			selectStaticFabHierarchyAxis(
				hierarchyAxisEvidence(horizontal),
				hierarchyAxisEvidence(vertical),
			) === "vertical"
				? vertical
				: horizontal;
		return Object.freeze({
			factory,
			wings: hierarchy.wings,
			processRows: hierarchy.processRows,
			processRowPairing: hierarchy.processRowPairing,
			processBanks: hierarchy.processBanks,
			processBlocks: hierarchy.processBlocks,
		});
	});
	return Object.freeze({ revision: index.revision, branches: Object.freeze(branches) });
}

/**
 * Materialize one user-selected pairing alternative for the current revision.
 *
 * The choice is transient UI state. It never mutates or persists the Worker-derived hierarchy
 * evidence, and callers must discard the returned index as soon as authored ownership changes.
 */
export function applyStaticFabProcessRowPairingAlternative(
	hierarchy: StaticFabHierarchyIndex,
	ownershipIndex: RailModuleOwnershipIndex,
	factoryKey: string,
	alternativeIndex: number,
): StaticFabHierarchyIndex {
	if (hierarchy.revision !== ownershipIndex.revision) {
		throw new Error("정적 FAB 계층과 레일 소유권 인덱스의 revision이 일치하지 않습니다");
	}
	if (!Number.isSafeInteger(alternativeIndex) || alternativeIndex < 0) {
		throw new RangeError("Process row pairing 대안 번호가 올바르지 않습니다");
	}
	const branchIndex = hierarchy.branches.findIndex(
		(candidate) => candidate.factory.key === factoryKey,
	);
	const branch = hierarchy.branches[branchIndex];
	if (!branch) throw new Error("Process row pairing을 적용할 Factory를 찾을 수 없습니다");
	if (branch.processRowPairing.state !== "ambiguous") {
		throw new Error("명시적 선택은 ambiguous Process row pairing에만 적용할 수 있습니다");
	}
	const alternative = branch.processRowPairing.alternatives[alternativeIndex];
	if (!alternative) throw new RangeError("선택한 Process row pairing 대안을 찾을 수 없습니다");
	const rowPairs = materializeProcessRowPairs(branch.processRows, alternative.pairs);
	const processBanks = pairedProcessBankNodes(ownershipIndex, branch.wings, rowPairs);
	const processBlocks = pairedProcessBlockNodes(ownershipIndex, rowPairs);
	if (
		processBanks.length !== alternative.pairs.length * 2 ||
		processBlocks.length !== alternative.pairs.length
	) {
		throw new Error("선택한 Process row pairing으로 완전한 Bank/Block을 만들 수 없습니다");
	}
	const selectedPairing = Object.freeze({
		state: "resolved" as const,
		pairs: alternative.pairs,
		totalHopCount: alternative.totalHopCount,
		reason: `User selected topology pairing alternative ${alternativeIndex + 1}`,
	});
	const selectedBranch = Object.freeze({
		...branch,
		processRowPairing: selectedPairing,
		processBanks,
		processBlocks,
	});
	return Object.freeze({
		revision: hierarchy.revision,
		branches: Object.freeze(
			hierarchy.branches.map((candidate, index) =>
				index === branchIndex ? selectedBranch : candidate,
			),
		),
	});
}

/**
 * Select one Factory orientation without allowing a larger geometry-only candidate to outrank
 * stronger topology evidence. Exact ties intentionally resolve to horizontal for stable keys.
 */
export function selectStaticFabHierarchyAxis(
	horizontal: StaticFabHierarchyAxisEvidence,
	vertical: StaticFabHierarchyAxisEvidence,
): StaticFabHierarchyAxis {
	const topologyDifference =
		processRowPairingConfidence(vertical.processRowPairingState) -
		processRowPairingConfidence(horizontal.processRowPairingState);
	if (topologyDifference !== 0) return topologyDifference > 0 ? "vertical" : "horizontal";
	if (vertical.wingCount !== horizontal.wingCount) {
		return vertical.wingCount > horizontal.wingCount ? "vertical" : "horizontal";
	}
	if (vertical.processRowCount !== horizontal.processRowCount) {
		return vertical.processRowCount > horizontal.processRowCount ? "vertical" : "horizontal";
	}
	return "horizontal";
}

function hierarchyAxisEvidence(hierarchy: DerivedHierarchyScopes): StaticFabHierarchyAxisEvidence {
	return Object.freeze({
		processRowPairingState: hierarchy.processRowPairing.state,
		wingCount: hierarchy.wings.length,
		processRowCount: hierarchy.processRows.length,
	});
}

function processRowPairingConfidence(state: StaticFabProcessRowPairingResolution["state"]): number {
	switch (state) {
		case "resolved":
			return 2;
		case "ambiguous":
			return 1;
		case "none":
			return 0;
	}
}

function deriveHierarchyScopes(
	index: RailModuleOwnershipIndex,
	factory: StaticFabHierarchyNode,
	factoryModules: readonly RailModuleOwnership[],
	factoryBounds: RailAreaSelectionBounds,
	axis: HierarchyAxis,
): DerivedHierarchyScopes {
	const bands = axisBands(factoryModules, axis);
	const processAxisModules = factoryModules.filter(
		(ownership) => !isPerpendicularInfrastructureTurnout(ownership, axis),
	);
	const processRows: StaticFabHierarchyNode[] = [];
	const wings: StaticFabHierarchyNode[] = [];
	for (const [bandIndex, band] of bands.entries()) {
		const denseRuns = splitRunsAtFactoryCenter(
			axisDenseRuns(band, factoryBounds, axis),
			factoryBounds,
			axis,
		);
		const processRuns = denseRuns.filter(
			(run) => run.maxAlong - run.minAlong + 1 >= minimumProcessRunWidth(factoryBounds, axis),
		);
		if (processRuns.length === 0) continue;
		const acrossBounds = paddedAcrossBounds(band, factoryBounds, axis);
		const rowWings: RailAreaSelection[] = [];
		for (const run of processRuns) {
			const minimumAlong = Math.max(
				axisMinimum(factoryBounds, axis, "along"),
				run.minAlong - HIERARCHY_BOUNDS_PADDING_METERS,
			);
			const maximumAlong = Math.min(
				axisMaximum(factoryBounds, axis, "along"),
				run.maxAlong + HIERARCHY_BOUNDS_PADDING_METERS,
			);
			const wingSelection = exactSelectionWithinBounds(
				index,
				processAxisModules.filter(
					(ownership) =>
						!isPerpendicularBoundaryStraight(ownership, axis, minimumAlong, maximumAlong),
				),
				axisSelectionBounds(
					axis,
					minimumAlong,
					maximumAlong,
					acrossBounds.minAcross,
					acrossBounds.maxAcross,
				),
			);
			if (wingSelection) {
				rowWings.push(wingSelection);
			}
		}
		if (rowWings.length !== 2) continue;
		const rowKey = `${factory.key}-ROW-${bandIndex + 1}`;
		wings.push(
			...rowWings.map((selection, wingIndex) =>
				node("wing", `${rowKey}-WING-${wingIndex + 1}`, selection),
			),
		);
		const rowOwnerships = uniqueOwnerships(rowWings.flatMap((selection) => selection.ownerships));
		const rowSelection = createRailAreaSelectionFromOwnerships(
			index,
			rowOwnerships,
			"fully-contained",
		);
		processRows.push(node("process-row", rowKey, rowSelection));
	}
	if (
		processRows.length < MINIMUM_FACTORY_PROCESS_ROWS ||
		!hasFactoryCirculationGrammar(factoryModules, factoryBounds, axis)
	) {
		return Object.freeze({
			wings: Object.freeze([]),
			processRows: Object.freeze([]),
			processRowPairing: noProcessRowPairing(
				"Factory circulation grammar did not produce enough complete Rows",
			),
			processBanks: Object.freeze([]),
			processBlocks: Object.freeze([]),
		});
	}
	const rowPairing = processRowPairs(factoryModules, processRows, wings, axis);
	const processBanks =
		rowPairing.pairs.length > 0
			? pairedProcessBankNodes(index, wings, rowPairing.pairs)
			: Object.freeze([]);
	const processBlocks =
		rowPairing.pairs.length > 0
			? pairedProcessBlockNodes(index, rowPairing.pairs)
			: Object.freeze([]);
	return Object.freeze({
		wings: Object.freeze(wings),
		processRows: Object.freeze(processRows),
		processRowPairing: rowPairing.resolution,
		processBanks,
		processBlocks,
	});
}

function isPerpendicularInfrastructureTurnout(
	ownership: RailModuleOwnership,
	axis: HierarchyAxis,
): boolean {
	if (ownership.kind !== "turnout") return false;
	const forward = ownership.construction.forward;
	const horizontal = forward === DIR_E || forward === DIR_W;
	const vertical = forward === DIR_N || forward === DIR_S;
	return axis === "horizontal" ? vertical : horizontal;
}

function isPerpendicularBoundaryStraight(
	ownership: RailModuleOwnership,
	axis: HierarchyAxis,
	minimumAlong: number,
	maximumAlong: number,
): boolean {
	if (ownership.kind !== "straight") return false;
	const forward = ownership.construction.forward;
	const horizontal = forward === DIR_E || forward === DIR_W;
	const vertical = forward === DIR_N || forward === DIR_S;
	if (axis === "horizontal" ? horizontal : vertical) return false;
	const primary = ownership.primaryCells[0];
	if (!primary) return false;
	const along = axis === "horizontal" ? primary.x : primary.y;
	return (
		Math.abs(along - minimumAlong) <= HIERARCHY_BOUNDS_PADDING_METERS ||
		Math.abs(along - maximumAlong) <= HIERARCHY_BOUNDS_PADDING_METERS
	);
}

/** Resolve one current selection against an already compiled revision-bound hierarchy index. */
export function resolveStaticFabHierarchy(
	index: StaticFabHierarchyIndex,
	focus: RailAreaSelection,
): StaticFabHierarchy {
	if (focus.revision !== index.revision) {
		throw new Error("선택 영역과 정적 FAB 계층 인덱스의 revision이 일치하지 않습니다");
	}
	if (focus.ownerships.length === 0 || index.branches.length === 0) {
		return Object.freeze({
			revision: index.revision,
			wing: none("Wing을 찾으려면 레일 모듈을 먼저 선택하세요"),
			processRow: none("공정 Row를 찾으려면 레일 모듈을 먼저 선택하세요"),
			processRowPairing: noProcessRowPairing(
				"Process row pairing을 계산하려면 레일 모듈을 먼저 선택하세요",
			),
			processBank: none("Process bank를 찾으려면 레일 모듈을 먼저 선택하세요"),
			processBlock: none("Process block을 찾으려면 레일 모듈을 먼저 선택하세요"),
			factory: none("Factory를 찾으려면 레일 모듈을 먼저 선택하세요"),
		});
	}
	const factory = resolveNodes(
		"Factory",
		index.branches.map((branch) => branch.factory),
		focus,
	);
	if (factory.state !== "resolved") {
		return Object.freeze({
			revision: index.revision,
			wing: none("하나의 Factory 안에서 선택해야 Wing을 계산할 수 있습니다"),
			processRow: none("하나의 Factory 안에서 선택해야 공정 Row를 계산할 수 있습니다"),
			processRowPairing: noProcessRowPairing(
				"하나의 Factory 안에서 선택해야 Process row pairing을 계산할 수 있습니다",
			),
			processBank: none("하나의 Factory 안에서 선택해야 Process bank를 계산할 수 있습니다"),
			processBlock: none("하나의 Factory 안에서 선택해야 Process block을 계산할 수 있습니다"),
			factory,
		});
	}
	const branch = index.branches.find((candidate) => candidate.factory.key === factory.node.key);
	if (!branch) throw new Error("선택한 Factory의 계층 branch를 찾을 수 없습니다");
	return Object.freeze({
		revision: index.revision,
		wing: resolveNodes("Wing", branch.wings, focus),
		processRow: resolveNodes("공정 Row", branch.processRows, focus),
		processRowPairing: branch.processRowPairing,
		processBank: resolveNodes("Process bank", branch.processBanks, focus),
		processBlock: resolveNodes("Process block", branch.processBlocks, focus),
		factory,
	});
}

function pairedProcessBankNodes(
	index: RailModuleOwnershipIndex,
	wings: readonly StaticFabHierarchyNode[],
	rowPairs: readonly ProcessRowPair[],
): readonly StaticFabHierarchyNode[] {
	// BANK/BLOCK scopes are reusable process content. Shared spine, wall, and outer circulation
	// remain Factory-owned so copying adjacent scopes cannot duplicate global infrastructure.
	const banks: StaticFabHierarchyNode[] = [];
	for (const [blockIndex, [upper, lower]] of rowPairs.entries()) {
		const upperWings = wings.filter((wing) => wing.key.startsWith(`${upper.key}-WING-`));
		const lowerWings = wings.filter((wing) => wing.key.startsWith(`${lower.key}-WING-`));
		if (upperWings.length !== 2 || lowerWings.length !== 2) return Object.freeze([]);
		for (let column = 0; column < 2; column++) {
			const upperWing = upperWings[column];
			const lowerWing = lowerWings[column];
			if (!upperWing || !lowerWing) return Object.freeze([]);
			const ownerships = uniqueOwnerships([
				...upperWing.selection.ownerships,
				...lowerWing.selection.ownerships,
			]);
			const selection = createRailAreaSelectionFromOwnerships(index, ownerships, "fully-contained");
			banks.push(
				node(
					"process-bank",
					`${upper.key.replace(/-ROW-\d+$/, "")}-BLOCK-${blockIndex + 1}-BANK-${column + 1}`,
					selection,
				),
			);
		}
	}
	return Object.freeze(banks);
}

function pairedProcessBlockNodes(
	index: RailModuleOwnershipIndex,
	rowPairs: readonly ProcessRowPair[],
): readonly StaticFabHierarchyNode[] {
	const blocks: StaticFabHierarchyNode[] = [];
	for (const [blockIndex, [upper, lower]] of rowPairs.entries()) {
		const ownerships = uniqueOwnerships([
			...upper.selection.ownerships,
			...lower.selection.ownerships,
		]);
		const selection = createRailAreaSelectionFromOwnerships(index, ownerships, "fully-contained");
		blocks.push(
			node(
				"process-block",
				`${upper.key.replace(/-ROW-\d+$/, "")}-BLOCK-${blockIndex + 1}`,
				selection,
			),
		);
	}
	return Object.freeze(blocks);
}

function processRowPairs(
	factoryModules: readonly RailModuleOwnership[],
	processRows: readonly StaticFabHierarchyNode[],
	wings: readonly StaticFabHierarchyNode[],
	axis: HierarchyAxis,
): ProcessRowNodePairing {
	const rowsWithWings = processRowWingPairs(processRows, wings, axis);
	if (!rowsWithWings) {
		return Object.freeze({
			resolution: noProcessRowPairing(
				"Each Process row must own exactly two disjoint Wing children",
			),
			pairs: Object.freeze([]),
		});
	}
	const evidence = processRowTopologyEvidence(factoryModules, rowsWithWings, axis);
	const resolution = resolveStaticFabProcessRowPairing(processRows.length, evidence);
	return Object.freeze({
		resolution,
		pairs:
			resolution.state === "resolved"
				? materializeProcessRowPairs(processRows, resolution.pairs)
				: Object.freeze([]),
	});
}

function materializeProcessRowPairs(
	processRows: readonly StaticFabHierarchyNode[],
	indexPairs: readonly StaticFabProcessRowIndexPair[],
): readonly ProcessRowPair[] {
	const seen = new Set<number>();
	const pairs = indexPairs.map(([firstIndex, secondIndex]) => {
		if (
			!Number.isSafeInteger(firstIndex) ||
			!Number.isSafeInteger(secondIndex) ||
			firstIndex < 0 ||
			secondIndex < 0 ||
			firstIndex >= processRows.length ||
			secondIndex >= processRows.length ||
			firstIndex === secondIndex ||
			seen.has(firstIndex) ||
			seen.has(secondIndex)
		) {
			throw new Error("Process row topology pair is not a perfect Row matching");
		}
		seen.add(firstIndex);
		seen.add(secondIndex);
		const first = processRows[firstIndex];
		const second = processRows[secondIndex];
		if (!first || !second) throw new Error("Process row topology pair index is out of bounds");
		return Object.freeze([first, second] as const);
	});
	if (seen.size !== processRows.length) {
		throw new Error("Process row topology pair is not a perfect Row matching");
	}
	return Object.freeze(pairs);
}

/**
 * Resolve the two legal wall-adjacent Row pairing phases from topology evidence.
 *
 * Geometry only establishes transverse Row order. Pair identity comes from same-side Wing
 * circulation hops. Multiple complete phases remain ambiguous; incomplete evidence creates no
 * BANK/BLOCK hierarchy.
 */
export function resolveStaticFabProcessRowPairing(
	rowCount: number,
	evidence: readonly StaticFabProcessRowTopologyEvidence[],
): StaticFabProcessRowPairingResolution {
	if (!Number.isSafeInteger(rowCount) || rowCount < 2 || rowCount % 2 !== 0) {
		return noProcessRowPairing("Process row pairing requires a positive even Row count");
	}
	const evidenceByPair = new Map<string, StaticFabProcessRowTopologyEvidence>();
	for (const candidate of evidence) {
		const pair = normalizeProcessRowIndexPair(candidate.rows);
		if (
			pair[0] < 0 ||
			pair[1] >= rowCount ||
			pair[0] === pair[1] ||
			candidate.sameSideHopCounts.some((hops) => !Number.isSafeInteger(hops) || hops < 0)
		) {
			throw new RangeError("Process row topology evidence is outside the Row index");
		}
		const key = processRowIndexPairKey(pair);
		const current = evidenceByPair.get(key);
		if (
			current &&
			(current.sameSideHopCounts[0] !== candidate.sameSideHopCounts[0] ||
				current.sameSideHopCounts[1] !== candidate.sameSideHopCounts[1])
		) {
			throw new Error(`Conflicting Process row topology evidence for ${key}`);
		}
		evidenceByPair.set(
			key,
			Object.freeze({
				rows: pair,
				sameSideHopCounts: Object.freeze([...candidate.sameSideHopCounts]) as readonly [
					number,
					number,
				],
			}),
		);
	}

	const completePhases = staticFabProcessRowPairingPhases(rowCount)
		.map((pairs) => {
			let totalHopCount = 0;
			for (const pair of pairs) {
				const candidate = evidenceByPair.get(processRowIndexPairKey(pair));
				if (!candidate) return null;
				totalHopCount += candidate.sameSideHopCounts[0] + candidate.sameSideHopCounts[1];
			}
			return Object.freeze({ pairs, totalHopCount });
		})
		.filter(
			(
				phase,
			): phase is Readonly<{
				pairs: readonly StaticFabProcessRowIndexPair[];
				totalHopCount: number;
			}> => phase !== null,
		);
	if (completePhases.length === 0) {
		return noProcessRowPairing("No complete same-side circulation pairing exists");
	}
	if (completePhases.length === 1) {
		const phase = completePhases[0] as (typeof completePhases)[number];
		return Object.freeze({
			state: "resolved",
			pairs: phase.pairs,
			totalHopCount: phase.totalHopCount,
			reason: "Exactly one complete same-side circulation pairing exists",
		});
	}
	return Object.freeze({
		state: "ambiguous",
		pairs: Object.freeze([]),
		alternatives: Object.freeze(completePhases),
		reason: `${completePhases.length} complete Row pairing phases have topology evidence`,
	});
}

function processRowWingPairs(
	processRows: readonly StaticFabHierarchyNode[],
	wings: readonly StaticFabHierarchyNode[],
	axis: HierarchyAxis,
): readonly ProcessRowWingPair[] | null {
	const pairs: ProcessRowWingPair[] = [];
	for (const row of processRows) {
		const rowOwnershipKeys = new Set(row.selection.ownerships.map((ownership) => ownership.key));
		const children = wings
			.filter(
				(wing) =>
					wing.selection.ownerships.length > 0 &&
					wing.selection.ownerships.every((ownership) => rowOwnershipKeys.has(ownership.key)),
			)
			.sort((left, right) => compareWingAlongAxis(left, right, axis));
		if (children.length !== 2) return null;
		const childOwnershipKeys = new Set(
			children.flatMap((wing) => wing.selection.ownerships.map((ownership) => ownership.key)),
		);
		if (
			childOwnershipKeys.size !== rowOwnershipKeys.size ||
			[...rowOwnershipKeys].some((key) => !childOwnershipKeys.has(key))
		) {
			return null;
		}
		pairs.push(
			Object.freeze({
				row,
				wings: Object.freeze([
					children[0] as StaticFabHierarchyNode,
					children[1] as StaticFabHierarchyNode,
				] as const),
			}),
		);
	}
	return Object.freeze(pairs);
}

function processRowTopologyEvidence(
	factoryModules: readonly RailModuleOwnership[],
	rows: readonly ProcessRowWingPair[],
	axis: HierarchyAxis,
): readonly StaticFabProcessRowTopologyEvidence[] {
	const rowWings = rows.flatMap((row) => row.wings);
	const wingPhysicalEdges = new Set(
		rowWings.flatMap((wing) =>
			wing.selection.ownerships.flatMap((ownership) => ownership.eraseEdges.map(undirectedEdgeKey)),
		),
	);
	const infrastructure = new Map<string, Set<string>>();
	for (const ownership of factoryModules) {
		for (const edge of ownership.eraseEdges) {
			if (wingPhysicalEdges.has(undirectedEdgeKey(edge))) continue;
			const from = cellKey(edge.from.x, edge.from.y);
			const to = cellKey(edge.to.x, edge.to.y);
			addTopologyNeighbor(infrastructure, from, to);
			if (!infrastructure.has(to)) infrastructure.set(to, new Set<string>());
		}
	}
	const boundaryNodes = new Map<string, ReadonlySet<string>>();
	for (const wing of rowWings) {
		const nodes = new Set<string>();
		for (const ownership of wing.selection.ownerships) {
			for (const edge of ownership.eraseEdges) {
				for (const endpoint of [edge.from, edge.to]) {
					const key = cellKey(endpoint.x, endpoint.y);
					if (infrastructure.has(key)) nodes.add(key);
				}
			}
		}
		boundaryNodes.set(wing.key, nodes);
	}

	const evidence: StaticFabProcessRowTopologyEvidence[] = [];
	const candidatePairs = uniqueProcessRowIndexPairs(
		staticFabProcessRowPairingPhases(rows.length).flat(),
	);
	const maximumTopologyHops = staticFabProcessRowTopologyHopLimit(
		rows.map(({ row }) => row.selection.bounds),
		axis,
	);
	for (const pair of candidatePairs) {
		const first = rows[pair[0]];
		const second = rows[pair[1]];
		if (!first || !second) continue;
		const sameSideHopCounts = first.wings.map((wing, side) => {
			const targetWing = second.wings[side];
			if (!targetWing) return null;
			return shortestLocalDirectedTopologyHopCount(
				infrastructure,
				boundaryNodes.get(wing.key) ?? new Set<string>(),
				boundaryNodes.get(targetWing.key) ?? new Set<string>(),
				maximumTopologyHops,
			);
		});
		if (
			sameSideHopCounts.length !== 2 ||
			sameSideHopCounts[0] === null ||
			sameSideHopCounts[1] === null
		) {
			continue;
		}
		evidence.push(
			Object.freeze({
				rows: pair,
				sameSideHopCounts: Object.freeze([sameSideHopCounts[0], sameSideHopCounts[1]] as const),
			}),
		);
	}
	return Object.freeze(evidence);
}

/**
 * Bound local pairing traversal from the authored Row pitch instead of a factory-independent
 * constant. Two adjacent pitches plus a small connector allowance admit long real Bays while
 * rejecting a remote route that wraps around the Factory outer circulation.
 */
export function staticFabProcessRowTopologyHopLimit(
	rowBounds: readonly RailAreaSelectionBounds[],
	axis: StaticFabHierarchyAxis,
): number {
	if (rowBounds.length < 2) return 0;
	const centers = rowBounds
		.map((bounds) =>
			axis === "horizontal" ? (bounds.minY + bounds.maxY) / 2 : (bounds.minX + bounds.maxX) / 2,
		)
		.sort((left, right) => left - right);
	let maximumAdjacentPitch = 0;
	for (let index = 1; index < centers.length; index++) {
		maximumAdjacentPitch = Math.max(
			maximumAdjacentPitch,
			(centers[index] as number) - (centers[index - 1] as number),
		);
	}
	return Math.max(
		PROCESS_ROW_TOPOLOGY_HOP_PADDING,
		Math.ceil(maximumAdjacentPitch * 2 + PROCESS_ROW_TOPOLOGY_HOP_PADDING),
	);
}

/** Return the only two wall-adjacent perfect matchings allowed by the ordered Row grammar. */
export function staticFabProcessRowPairingPhases(
	rowCount: number,
): readonly (readonly StaticFabProcessRowIndexPair[])[] {
	const phases: StaticFabProcessRowIndexPair[][] = [];
	const direct: StaticFabProcessRowIndexPair[] = [];
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 2) {
		direct.push(Object.freeze([rowIndex, rowIndex + 1]));
	}
	phases.push(direct);
	if (rowCount > 2) {
		const shifted: StaticFabProcessRowIndexPair[] = [];
		for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 2) {
			shifted.push(normalizeProcessRowIndexPair([rowIndex, (rowIndex + 1) % rowCount]));
		}
		phases.push(shifted);
	}
	return Object.freeze(
		phases.map((phase) => Object.freeze([...phase].sort(compareProcessRowIndexPairs))),
	);
}

function uniqueProcessRowIndexPairs(
	pairs: readonly StaticFabProcessRowIndexPair[],
): readonly StaticFabProcessRowIndexPair[] {
	const pairByKey = new Map<string, StaticFabProcessRowIndexPair>();
	for (const pair of pairs) {
		const normalized = normalizeProcessRowIndexPair(pair);
		pairByKey.set(processRowIndexPairKey(normalized), normalized);
	}
	return Object.freeze([...pairByKey.values()].sort(compareProcessRowIndexPairs));
}

function normalizeProcessRowIndexPair(
	pair: StaticFabProcessRowIndexPair,
): StaticFabProcessRowIndexPair {
	return pair[0] <= pair[1] ? Object.freeze([pair[0], pair[1]]) : Object.freeze([pair[1], pair[0]]);
}

function processRowIndexPairKey(pair: StaticFabProcessRowIndexPair): string {
	return `${pair[0]}:${pair[1]}`;
}

function compareProcessRowIndexPairs(
	left: StaticFabProcessRowIndexPair,
	right: StaticFabProcessRowIndexPair,
): number {
	return left[0] - right[0] || left[1] - right[1];
}

function compareWingAlongAxis(
	left: StaticFabHierarchyNode,
	right: StaticFabHierarchyNode,
	axis: HierarchyAxis,
): number {
	const leftBounds = left.selection.bounds;
	const rightBounds = right.selection.bounds;
	const leftMinimum = axis === "horizontal" ? leftBounds.minX : leftBounds.minY;
	const rightMinimum = axis === "horizontal" ? rightBounds.minX : rightBounds.minY;
	const leftMaximum = axis === "horizontal" ? leftBounds.maxX : leftBounds.maxY;
	const rightMaximum = axis === "horizontal" ? rightBounds.maxX : rightBounds.maxY;
	return (
		leftMinimum - rightMinimum || leftMaximum - rightMaximum || left.key.localeCompare(right.key)
	);
}

function addTopologyNeighbor(adjacency: Map<string, Set<string>>, from: string, to: string): void {
	const neighbors = adjacency.get(from) ?? new Set<string>();
	neighbors.add(to);
	adjacency.set(from, neighbors);
}

function shortestLocalDirectedTopologyHopCount(
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
	first: ReadonlySet<string>,
	second: ReadonlySet<string>,
	maximumHops: number,
): number | null {
	const forward = shortestDirectedTopologyHopCount(adjacency, first, second, maximumHops);
	const reverse = shortestDirectedTopologyHopCount(adjacency, second, first, maximumHops);
	if (forward === null) return reverse;
	if (reverse === null) return forward;
	return Math.min(forward, reverse);
}

function shortestDirectedTopologyHopCount(
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
	sources: ReadonlySet<string>,
	targets: ReadonlySet<string>,
	maximumHops: number,
): number | null {
	if (sources.size === 0 || targets.size === 0) return null;
	const queue = [...sources];
	const hopCountByCell = new Map(queue.map((key) => [key, 0]));
	for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
		const key = queue[queueIndex] as string;
		const hopCount = hopCountByCell.get(key) as number;
		if (targets.has(key)) return hopCount;
		if (hopCount >= maximumHops) continue;
		for (const neighbor of adjacency.get(key) ?? []) {
			if (hopCountByCell.has(neighbor)) continue;
			hopCountByCell.set(neighbor, hopCount + 1);
			queue.push(neighbor);
		}
	}
	return null;
}

/** Convenience boundary for callers that do not retain a revision-bound hierarchy index. */
export function deriveStaticFabHierarchy(
	map: TileMap,
	index: RailModuleOwnershipIndex,
	focus: RailAreaSelection,
): StaticFabHierarchy {
	return resolveStaticFabHierarchy(compileStaticFabHierarchyIndex(map, index), focus);
}

/** Compile one transient ownership lookup for direct Canvas candidate selection. */
export function compileStaticFabHierarchyCandidateOwnershipIndex(
	candidates: readonly StaticFabHierarchyNode[],
): StaticFabHierarchyCandidateOwnershipIndex {
	const candidateByOwnershipKey = new Map<string, StaticFabHierarchyNode | null>();
	for (const candidate of candidates) {
		for (const ownership of candidate.selection.ownerships) {
			const current = candidateByOwnershipKey.get(ownership.key);
			if (current === undefined) {
				candidateByOwnershipKey.set(ownership.key, candidate);
			} else if (current !== null && current.key !== candidate.key) {
				candidateByOwnershipKey.set(ownership.key, null);
			}
		}
	}
	return Object.freeze({
		candidates,
		resolve(ownershipKey: string): StaticFabHierarchyNode | null {
			return candidateByOwnershipKey.get(ownershipKey) ?? null;
		},
	});
}

function factoryNodes(
	map: TileMap,
	index: RailModuleOwnershipIndex,
): readonly StaticFabHierarchyNode[] {
	const modules = index.modules;
	const railCells: Array<Readonly<{ x: number; y: number; outgoing: number }>> = [];
	const cellIndexByKey = new Map<string, number>();
	map.forEachRail((x, y, rail) => {
		cellIndexByKey.set(cellKey(x, y), railCells.length);
		railCells.push(Object.freeze({ x, y, outgoing: rail.outgoing }));
	});
	const parent = new Int32Array(railCells.length);
	for (let cellIndex = 0; cellIndex < parent.length; cellIndex++) parent[cellIndex] = cellIndex;
	for (const [cellIndex, rail] of railCells.entries()) {
		for (const direction of ALL_DIRECTIONS) {
			if ((rail.outgoing & direction) === 0) continue;
			const target = moveCell(rail, direction);
			const targetIndex = cellIndexByKey.get(cellKey(target.x, target.y));
			if (targetIndex === undefined) continue;
			const targetRail = map.getRail(target.x, target.y);
			if ((targetRail.incoming & oppositeDirection(direction)) === 0) continue;
			union(parent, cellIndex, targetIndex);
		}
	}
	const components = new Map<number, RailModuleOwnership[]>();
	for (const ownership of modules) {
		const memberCell = ownership.footprintCells.find((cell) =>
			cellIndexByKey.has(cellKey(cell.x, cell.y)),
		);
		if (!memberCell) continue;
		const cellIndex = cellIndexByKey.get(cellKey(memberCell.x, memberCell.y)) as number;
		const root = find(parent, cellIndex);
		const component = components.get(root) ?? [];
		component.push(ownership);
		components.set(root, component);
	}
	return Object.freeze(
		[...components.values()]
			.map((component) => createRailAreaSelectionFromOwnerships(index, component))
			.sort(compareSelections)
			.map((selection, componentIndex) =>
				node("factory", `FACTORY-${componentIndex + 1}`, selection),
			),
	);
}

function splitRunsAtFactoryCenter(
	runs: readonly AxisRun[],
	bounds: RailAreaSelectionBounds,
	axis: HierarchyAxis,
): readonly AxisRun[] {
	const minimum = axisMinimum(bounds, axis, "along");
	const maximum = axisMaximum(bounds, axis, "along");
	const center = (minimum + maximum) / 2;
	const exclusion = Math.max(2, Math.floor((maximum - minimum + 1) * 0.015));
	const lowerLimit = Math.floor(center - exclusion);
	const upperLimit = Math.ceil(center + exclusion);
	const split: AxisRun[] = [];
	for (const run of runs) {
		if (run.minAlong < lowerLimit) {
			split.push(
				Object.freeze({
					minAlong: run.minAlong,
					maxAlong: Math.min(run.maxAlong, lowerLimit),
				}),
			);
		}
		if (run.maxAlong > upperLimit) {
			split.push(
				Object.freeze({
					minAlong: Math.max(run.minAlong, upperLimit),
					maxAlong: run.maxAlong,
				}),
			);
		}
	}
	return Object.freeze(
		split.filter((run) => run.maxAlong - run.minAlong + 1 >= minimumProcessRunWidth(bounds, axis)),
	);
}

function exactSelectionWithinBounds(
	index: RailModuleOwnershipIndex,
	allowed: readonly RailModuleOwnership[],
	bounds: RailAreaSelectionBounds,
): RailAreaSelection | null {
	const rectangular = createRailAreaSelection(
		index,
		{ x: bounds.minX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.maxY },
		"fully-contained",
	);
	const allowedKeys = new Set(allowed.map((ownership) => ownership.key));
	const ownerships = rectangular.ownerships.filter((ownership) => allowedKeys.has(ownership.key));
	return ownerships.length > 0
		? createRailAreaSelectionFromOwnerships(index, ownerships, "fully-contained")
		: null;
}

function resolveNodes(
	label: string,
	nodes: readonly StaticFabHierarchyNode[],
	focus: RailAreaSelection,
): StaticFabHierarchyResolution {
	const focusKeys = new Set(focus.ownerships.map((ownership) => ownership.key));
	const matches = nodes.filter((candidate) =>
		candidate.selection.ownerships.some((ownership) => focusKeys.has(ownership.key)),
	);
	if (matches.length === 0) return none(`${label} 경계 안의 레일을 선택하지 않았습니다`);
	if (matches.length === 1) {
		return Object.freeze({
			state: "resolved",
			node: matches[0] as StaticFabHierarchyNode,
			reason: `${label} 범위를 레일 형상에서 확인했습니다`,
		});
	}
	const containing = matches.filter((candidate) =>
		focus.ownerships.every((ownership) =>
			candidate.selection.ownerships.some((member) => member.key === ownership.key),
		),
	);
	if (containing.length === 1) {
		return Object.freeze({
			state: "resolved",
			node: containing[0] as StaticFabHierarchyNode,
			reason: `${label} 범위를 레일 형상에서 확인했습니다`,
		});
	}
	return Object.freeze({
		state: "ambiguous",
		candidates: Object.freeze(matches),
		reason: `선택이 ${matches.length}개 ${label} 경계에 걸쳐 있습니다`,
	});
}

function axisBands(
	ownerships: readonly RailModuleOwnership[],
	axis: HierarchyAxis,
): readonly AxisBand[] {
	const sampleByKey = new Map<string, AxisEdgeSample>();
	for (const ownership of ownerships) {
		for (const edge of ownership.eraseEdges) {
			const parallel =
				axis === "horizontal" ? edge.from.y === edge.to.y : edge.from.x === edge.to.x;
			if (!parallel) continue;
			const along =
				axis === "horizontal" ? Math.min(edge.from.x, edge.to.x) : Math.min(edge.from.y, edge.to.y);
			const across = axis === "horizontal" ? edge.from.y : edge.from.x;
			sampleByKey.set(`${along}:${across}`, Object.freeze({ along, across }));
		}
	}
	const samples = [...sampleByKey.values()].sort(
		(left, right) => left.across - right.across || left.along - right.along,
	);
	if (samples.length === 0) return Object.freeze([]);
	const byAcross = new Map<number, AxisEdgeSample[]>();
	for (const sample of samples) {
		const row = byAcross.get(sample.across) ?? [];
		row.push(sample);
		byAcross.set(sample.across, row);
	}
	const acrossCoordinates = [...byAcross.keys()].sort((left, right) => left - right);
	const bands: AxisBand[] = [];
	let currentAcross: number[] = [];
	const flush = (): void => {
		if (currentAcross.length === 0) return;
		bands.push(
			Object.freeze({
				minAcross: currentAcross[0] as number,
				maxAcross: currentAcross.at(-1) as number,
				samples: Object.freeze(
					currentAcross.flatMap((coordinate) => byAcross.get(coordinate) ?? []),
				),
			}),
		);
		currentAcross = [];
	};
	for (const coordinate of acrossCoordinates) {
		const previous = currentAcross.at(-1);
		if (previous !== undefined && coordinate - previous > MAXIMUM_ROW_INTERNAL_GAP_METERS) {
			flush();
		}
		currentAcross.push(coordinate);
	}
	flush();
	return Object.freeze(bands);
}

function axisDenseRuns(
	band: AxisBand,
	factoryBounds: RailAreaSelectionBounds,
	axis: HierarchyAxis,
): readonly AxisRun[] {
	const supportByAlong = new Map<number, number>();
	for (const sample of band.samples) {
		supportByAlong.set(sample.along, (supportByAlong.get(sample.along) ?? 0) + 1);
	}
	const denseAlong = [...supportByAlong]
		.filter(([, support]) => support >= 2)
		.map(([coordinate]) => coordinate)
		.sort((left, right) => left - right);
	if (denseAlong.length === 0) return Object.freeze([]);
	const runs: AxisRun[] = [];
	let start = denseAlong[0] as number;
	let end = start;
	for (const coordinate of denseAlong.slice(1)) {
		if (coordinate - end <= MAXIMUM_DENSE_RUN_BRIDGE_METERS + 1) {
			end = coordinate;
			continue;
		}
		runs.push(Object.freeze({ minAlong: start, maxAlong: end + 1 }));
		start = coordinate;
		end = coordinate;
	}
	runs.push(Object.freeze({ minAlong: start, maxAlong: end + 1 }));
	const boundsMinimum = axisMinimum(factoryBounds, axis, "along");
	const boundsMaximum = axisMaximum(factoryBounds, axis, "along");
	return Object.freeze(
		runs.filter(
			(run) =>
				run.maxAlong >= boundsMinimum &&
				run.minAlong <= boundsMaximum &&
				run.maxAlong - run.minAlong + 1 >= MINIMUM_DENSE_RUN_METERS,
		),
	);
}

function node(
	scope: StaticFabHierarchyScope,
	key: string,
	selection: RailAreaSelection,
): StaticFabHierarchyNode {
	return Object.freeze({
		scope,
		key,
		selection,
		directedEdgeCount: directedEdgeCount(selection),
	});
}

function directedEdgeCount(selection: RailAreaSelection): number {
	const edgeKeys = new Set<string>();
	for (const ownership of selection.ownerships) {
		for (const edge of ownership.eraseEdges) edgeKeys.add(edgeKey(edge));
	}
	return edgeKeys.size;
}

function paddedAcrossBounds(
	band: AxisBand,
	factoryBounds: RailAreaSelectionBounds,
	axis: HierarchyAxis,
): Readonly<{ minAcross: number; maxAcross: number }> {
	return Object.freeze({
		minAcross: Math.max(
			axisMinimum(factoryBounds, axis, "across"),
			band.minAcross - HIERARCHY_BOUNDS_PADDING_METERS,
		),
		maxAcross: Math.min(
			axisMaximum(factoryBounds, axis, "across"),
			band.maxAcross + HIERARCHY_BOUNDS_PADDING_METERS,
		),
	});
}

function minimumProcessRunWidth(bounds: RailAreaSelectionBounds, axis: HierarchyAxis): number {
	const span = axisMaximum(bounds, axis, "along") - axisMinimum(bounds, axis, "along") + 1;
	return Math.max(MINIMUM_DENSE_RUN_METERS, Math.floor(span * 0.08));
}

function uniqueOwnerships(
	ownerships: readonly RailModuleOwnership[],
): readonly RailModuleOwnership[] {
	const byKey = new Map<string, RailModuleOwnership>();
	for (const ownership of ownerships) byKey.set(ownership.key, ownership);
	return Object.freeze([...byKey.values()]);
}

function hasFactoryCirculationGrammar(
	ownerships: readonly RailModuleOwnership[],
	bounds: RailAreaSelectionBounds,
	axis: HierarchyAxis,
): boolean {
	const minAlong = axisMinimum(bounds, axis, "along");
	const maxAlong = axisMaximum(bounds, axis, "along");
	const minAcross = axisMinimum(bounds, axis, "across");
	const maxAcross = axisMaximum(bounds, axis, "across");
	const alongSpan = maxAlong - minAlong;
	const acrossSpan = maxAcross - minAcross;
	if (alongSpan < 32 || acrossSpan < 48) return false;

	const outerTolerance = Math.max(2, Math.floor(Math.min(alongSpan, acrossSpan) * 0.01));
	// A compact factory can be much narrower than it is tall. Keep the canonical 24 m
	// interbay spine discoverable without making its two directed wall rails depend on
	// the factory aspect ratio.
	const spineTolerance = Math.max(MINIMUM_SPINE_HALF_WIDTH_METERS, Math.floor(alongSpan * 0.04));
	const centerAlong = (minAlong + maxAlong) / 2;
	const lowerOuter = new Set<number>();
	const upperOuter = new Set<number>();
	const leadingOuter = new Set<number>();
	const trailingOuter = new Set<number>();
	const spine = new Set<number>();

	for (const ownership of ownerships) {
		for (const edge of ownership.eraseEdges) {
			const parallel =
				axis === "horizontal" ? edge.from.y === edge.to.y : edge.from.x === edge.to.x;
			const perpendicular =
				axis === "horizontal" ? edge.from.x === edge.to.x : edge.from.y === edge.to.y;
			if (parallel) {
				const fixedAcross = axis === "horizontal" ? edge.from.y : edge.from.x;
				const fromAlong = axis === "horizontal" ? edge.from.x : edge.from.y;
				const toAlong = axis === "horizontal" ? edge.to.x : edge.to.y;
				if (Math.abs(fixedAcross - minAcross) <= outerTolerance) {
					addCoveredUnitCoordinates(lowerOuter, fromAlong, toAlong);
				}
				if (Math.abs(fixedAcross - maxAcross) <= outerTolerance) {
					addCoveredUnitCoordinates(upperOuter, fromAlong, toAlong);
				}
			}
			if (perpendicular) {
				const fixedAlong = axis === "horizontal" ? edge.from.x : edge.from.y;
				const fromAcross = axis === "horizontal" ? edge.from.y : edge.from.x;
				const toAcross = axis === "horizontal" ? edge.to.y : edge.to.x;
				if (Math.abs(fixedAlong - minAlong) <= outerTolerance) {
					addCoveredUnitCoordinates(leadingOuter, fromAcross, toAcross);
				}
				if (Math.abs(fixedAlong - maxAlong) <= outerTolerance) {
					addCoveredUnitCoordinates(trailingOuter, fromAcross, toAcross);
				}
				if (Math.abs(fixedAlong - centerAlong) <= spineTolerance) {
					addCoveredUnitCoordinates(spine, fromAcross, toAcross);
				}
			}
		}
	}

	return (
		lowerOuter.size / alongSpan >= MINIMUM_OUTER_COVERAGE_RATIO &&
		upperOuter.size / alongSpan >= MINIMUM_OUTER_COVERAGE_RATIO &&
		leadingOuter.size / acrossSpan >= MINIMUM_OUTER_COVERAGE_RATIO &&
		trailingOuter.size / acrossSpan >= MINIMUM_OUTER_COVERAGE_RATIO &&
		spine.size / acrossSpan >= MINIMUM_SPINE_COVERAGE_RATIO
	);
}

function addCoveredUnitCoordinates(target: Set<number>, from: number, to: number): void {
	const minimum = Math.min(from, to);
	const maximum = Math.max(from, to);
	for (let coordinate = minimum; coordinate < maximum; coordinate++) target.add(coordinate);
}

function axisSelectionBounds(
	axis: HierarchyAxis,
	minAlong: number,
	maxAlong: number,
	minAcross: number,
	maxAcross: number,
): RailAreaSelectionBounds {
	return axis === "horizontal"
		? Object.freeze({ minX: minAlong, maxX: maxAlong, minY: minAcross, maxY: maxAcross })
		: Object.freeze({ minX: minAcross, maxX: maxAcross, minY: minAlong, maxY: maxAlong });
}

function axisMinimum(
	bounds: RailAreaSelectionBounds,
	axis: HierarchyAxis,
	dimension: "along" | "across",
): number {
	const useX = (axis === "horizontal") === (dimension === "along");
	return useX ? bounds.minX : bounds.minY;
}

function axisMaximum(
	bounds: RailAreaSelectionBounds,
	axis: HierarchyAxis,
	dimension: "along" | "across",
): number {
	const useX = (axis === "horizontal") === (dimension === "along");
	return useX ? bounds.maxX : bounds.maxY;
}

function none(reason: string): StaticFabHierarchyResolution {
	return Object.freeze({ state: "none", reason });
}

function noProcessRowPairing(reason: string): StaticFabProcessRowPairingResolution {
	return Object.freeze({ state: "none", pairs: Object.freeze([] as const), reason });
}

function compareSelections(left: RailAreaSelection, right: RailAreaSelection): number {
	return (
		left.bounds.minY - right.bounds.minY ||
		left.bounds.minX - right.bounds.minX ||
		left.bounds.maxY - right.bounds.maxY ||
		left.bounds.maxX - right.bounds.maxX
	);
}

function find(parent: Int32Array, value: number): number {
	let root = value;
	while ((parent[root] as number) !== root) root = parent[root] as number;
	while ((parent[value] as number) !== value) {
		const next = parent[value] as number;
		parent[value] = root;
		value = next;
	}
	return root;
}

function union(parent: Int32Array, left: number, right: number): void {
	const leftRoot = find(parent, left);
	const rightRoot = find(parent, right);
	if (leftRoot === rightRoot) return;
	parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

function edgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`;
}

function undirectedEdgeKey(edge: DirectedRailEdge): string {
	const from = cellKey(edge.from.x, edge.from.y);
	const to = cellKey(edge.to.x, edge.to.y);
	return from < to ? `${from}|${to}` : `${to}|${from}`;
}
