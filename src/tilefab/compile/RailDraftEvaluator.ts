import {
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import type {
	AdvancedSwitchPlan,
	AdvancedSwitchReplacementPlan,
} from "../core/AdvancedSwitchPlanner";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { RailReplacementPlan } from "../core/edit";
import type { RailConstructionPlan } from "../core/paint";
import { railPatchInvalidatedPorts } from "../core/RailDocument";
import { moveCell } from "../core/railShape";
import { type Cell, cellKey, decodeRailCell, TileMap } from "../core/TileMap";
import { collectAffectedTurnoutFootprints } from "../core/turnout";
import { type CompiledPhysicalPaths, PATH_KIND } from "./PhysicalPathCompiler";
import {
	authoredPhysicalPathContinuation,
	buildPhysicalPathAdjacency,
	type PhysicalPathAdjacency,
	reversePhysicalPathAdjacency,
} from "./PhysicalPathFlow";
import {
	PhysicalPathCellIndex,
	type PhysicalPathCellLookup,
	PhysicalPathIdentityIndex,
	PhysicalPathSwitchIndex,
} from "./PhysicalPathLookup";
import {
	type CompiledPhysicalLayout,
	compiledPhysicalLayoutHasDifferentSource,
	compilePhysicalRail,
} from "./PhysicalRailCompiler";
import { type CompiledRailEnvelopes, RailEnvelopeSpatialIndex } from "./RailClearanceCompiler";
import {
	closestLineSegments,
	RAIL_CLEARANCE_ISSUE_CODE,
	type RailClearanceIssueCode,
	railClearanceIssueMessage,
	railClearancePathIdentity,
} from "./RailClearanceValidator";
import {
	type RailDraftPreparedArtifacts,
	railDraftPreparedArtifactsReadyForAdoption,
} from "./RailDraftPreparedArtifacts";

export type RailDraftPlan =
	| RailConstructionPlan
	| RailReplacementPlan
	| AdvancedSwitchPlan
	| AdvancedSwitchReplacementPlan;

export interface RailDraftClearanceIssue {
	readonly source: "draft" | "committed";
	readonly code: RailClearanceIssueCode;
	readonly message: string;
	readonly draftPathIndex: number;
	readonly draftEnvelopeIndex: number;
	readonly draftStation: number;
	readonly draftIdentity: Int32Array;
	readonly otherPathIndex: number;
	readonly otherEnvelopeIndex: number;
	readonly otherStation: number;
	readonly otherIdentity: Int32Array;
	readonly draftCell: Cell;
	readonly otherCell: Cell;
	readonly contactPoint: Readonly<{ x: number; y: number }>;
	readonly centerlineDistance: number;
	readonly requiredClearance: number;
	readonly penetrationDepth: number;
}

export interface RailDraftEvaluation {
	readonly plan: RailDraftPlan;
	readonly baseRevision: number;
	readonly committedRevision: number;
	readonly validationLevel: "exact" | "topology-only";
	readonly stale: boolean;
	readonly failureCode: "stale" | "compile" | null;
	readonly topologyValid: boolean;
	readonly valid: boolean;
	readonly reason: string;
	readonly paths: CompiledPhysicalPaths | null;
	readonly envelopes: CompiledRailEnvelopes | null;
	readonly conflictCells: readonly Cell[];
	readonly issues: readonly RailDraftClearanceIssue[];
	readonly invalidatedPortIds: readonly number[];
	readonly candidateCommittedEnvelopePairs: number;
	readonly testedCommittedEnvelopePairs: number;
}

/**
 * Lightweight topology-only feedback for pointer previews and isolated macro assembly.
 *
 * Never use this result to commit into the active authored project. A macro builder may stage it in
 * a private document only when the complete staged document is physically compiled and validated
 * before it is exposed to the caller.
 */
export function createTopologyOnlyRailDraftPreview(
	map: TileMap,
	plan: RailDraftPlan,
): RailDraftEvaluation {
	const committedRevision = map.getRevision();
	const stale = plan.baseRevision !== committedRevision;
	const valid = plan.valid && !stale;
	return Object.freeze({
		plan,
		baseRevision: plan.baseRevision,
		committedRevision,
		validationLevel: "topology-only",
		stale,
		failureCode: stale ? "stale" : null,
		topologyValid: valid,
		valid,
		reason: stale
			? "레일 맵이 변경되어 드래프트가 만료되었습니다. 다시 배치해 주세요"
			: plan.valid
				? `${plan.reason} · 클릭 시 물리 간섭 최종 검사`
				: plan.reason,
		paths: null,
		envelopes: null,
		conflictCells: Object.freeze([...plan.conflicts]),
		issues: Object.freeze([]),
		invalidatedPortIds: Object.freeze([]),
		candidateCommittedEnvelopePairs: 0,
		testedCommittedEnvelopePairs: 0,
	});
}

export interface RailDraftEvaluatorStats {
	readonly evaluations: number;
	readonly draftCacheHits: number;
	readonly staleRejects: number;
	readonly draftCompiles: number;
	readonly committedBindings: number;
	readonly committedIndexBuilds: number;
	readonly committedPreparedBindings: number;
	readonly committedAdjacencyBuilds: number;
	readonly committedRevision: number;
	readonly committedEnvelopeCount: number;
	readonly candidateCommittedEnvelopePairs: number;
	readonly testedCommittedEnvelopePairs: number;
}

interface CrossIssueCandidate extends RailDraftClearanceIssue {
	readonly key: string;
}

interface CommittedDraftCoverage {
	readonly paths: CompiledPhysicalPaths;
	readonly pathIndicesByCell: PhysicalPathCellLookup;
	readonly forwardAdjacency: PhysicalPathAdjacency;
	readonly reverseAdjacency: PhysicalPathAdjacency;
	readonly continuationWindowMeters: number;
}

const STATION_TOLERANCE_METERS = 0.002;
const DISTANCE_EPSILON = 1e-8;

/**
 * Revision-bound, platform-independent construction gate. The committed broad phase is built once;
 * pointer movement compiles and tests only the local future-state draft.
 */
export class RailDraftEvaluator {
	private committedLayout: CompiledPhysicalLayout | null = null;
	private committedIndex: RailEnvelopeSpatialIndex | null = null;
	private committedPathIndicesByCell: PhysicalPathCellLookup = new Map();
	private committedPathIndicesBySwitch: { get(id: number): Uint32Array | undefined } = new Map();
	private committedPathIndicesByIdentity: {
		get(identity: ArrayLike<number>): Uint32Array | undefined;
	} = { get: () => undefined };
	private committedForwardAdjacency: PhysicalPathAdjacency | null = null;
	private committedReverseAdjacency: PhysicalPathAdjacency | null = null;
	private committedContinuationWindowMeters = 0;
	private cachedPlan: RailDraftPlan | null = null;
	private cachedMap: TileMap | null = null;
	private cachedCommittedLayout: CompiledPhysicalLayout | null = null;
	private cachedRevision = -1;
	private cachedPortEquipment: PortEquipmentState | null = null;
	private cachedEvaluation: RailDraftEvaluation | null = null;
	private evaluations = 0;
	private draftCacheHits = 0;
	private staleRejects = 0;
	private draftCompiles = 0;
	private committedBindings = 0;
	private committedIndexBuilds = 0;
	private committedPreparedBindings = 0;
	private committedAdjacencyBuilds = 0;
	private candidateCommittedEnvelopePairs = 0;
	private testedCommittedEnvelopePairs = 0;

	/** Prepare revision-bound broad-phase indexes outside the first pointer interaction. */
	prepare(committedLayout: CompiledPhysicalLayout, artifacts?: RailDraftPreparedArtifacts): void {
		this.bindCommittedLayout(committedLayout, artifacts);
	}

	evaluate(
		map: TileMap,
		committedLayout: CompiledPhysicalLayout,
		plan: RailDraftPlan,
		portEquipment: PortEquipmentState | null = null,
	): RailDraftEvaluation {
		this.evaluations++;
		const committedRevision = map.getRevision();
		this.candidateCommittedEnvelopePairs = 0;
		this.testedCommittedEnvelopePairs = 0;
		if (
			this.cachedPlan === plan &&
			this.cachedMap === map &&
			this.cachedCommittedLayout === committedLayout &&
			this.cachedRevision === committedRevision &&
			this.cachedPortEquipment === portEquipment &&
			this.cachedEvaluation
		) {
			this.draftCacheHits++;
			this.candidateCommittedEnvelopePairs = this.cachedEvaluation.candidateCommittedEnvelopePairs;
			this.testedCommittedEnvelopePairs = this.cachedEvaluation.testedCommittedEnvelopePairs;
			return this.cachedEvaluation;
		}
		if (plan.baseRevision !== committedRevision) {
			this.staleRejects++;
			return this.cacheEvaluation(
				map,
				plan,
				committedLayout,
				committedRevision,
				portEquipment,
				emptyEvaluation(
					plan,
					committedRevision,
					"레일 맵이 변경되어 드래프트가 만료되었습니다. 다시 그려 주세요",
					"stale",
				),
			);
		}
		if (compiledPhysicalLayoutHasDifferentSource(committedLayout, map)) {
			this.staleRejects++;
			return this.cacheEvaluation(
				map,
				plan,
				committedLayout,
				committedRevision,
				portEquipment,
				emptyEvaluation(
					plan,
					committedRevision,
					"커밋 물리 레이아웃이 현재 레일 맵에서 컴파일되지 않았습니다",
					"stale",
				),
			);
		}
		if (
			committedLayout.revision !== committedRevision ||
			committedLayout.paths.revision !== committedRevision
		) {
			this.staleRejects++;
			return this.cacheEvaluation(
				map,
				plan,
				committedLayout,
				committedRevision,
				portEquipment,
				emptyEvaluation(
					plan,
					committedRevision,
					"커밋 물리 레이아웃이 현재 레일 맵과 동기화되지 않았습니다",
					"stale",
				),
			);
		}

		this.bindCommittedLayout(committedLayout);
		let draftLayout: CompiledPhysicalLayout | null = null;
		let compileError: string | null = null;
		try {
			if (!this.committedForwardAdjacency || !this.committedReverseAdjacency) {
				throw new Error("Committed physical adjacency is not prepared.");
			}
			draftLayout = compileRailDraftLayout(map, plan, {
				paths: committedLayout.paths,
				pathIndicesByCell: this.committedPathIndicesByCell,
				forwardAdjacency: this.committedForwardAdjacency,
				reverseAdjacency: this.committedReverseAdjacency,
				continuationWindowMeters: this.committedContinuationWindowMeters,
			});
			if (draftLayout) this.draftCompiles++;
		} catch (error) {
			compileError = error instanceof Error ? error.message : "unknown draft compiler error";
		}
		if (!draftLayout) {
			return this.cacheEvaluation(
				map,
				plan,
				committedLayout,
				committedRevision,
				portEquipment,
				emptyEvaluation(
					plan,
					committedRevision,
					compileError ? `드래프트 물리 경로를 컴파일할 수 없습니다: ${compileError}` : plan.reason,
					compileError ? "compile" : null,
				),
			);
		}

		const issues = [
			...internalDraftIssues(draftLayout),
			...this.evaluateAgainstCommitted(map, plan, draftLayout),
		];
		const conflictCells = uniqueCells([
			...plan.conflicts,
			...issues.flatMap((issue) => [issue.draftCell, issue.otherCell]),
		]);
		const invalidatedPorts = portEquipment
			? railPatchInvalidatedPorts(map, plan.mutations, switchMutations(plan), portEquipment)
			: [];
		const portConflictCells = invalidatedPorts.flatMap((port) => {
			if (port.route.kind === "CARDINAL_CELL") {
				return [{ x: port.route.x, y: port.route.z }];
			}
			const switchRecord = map.getAdvancedSwitch(port.route.switchId);
			return switchRecord ? [switchRecord.origin] : [];
		});
		const allConflictCells = uniqueCells([...conflictCells, ...portConflictCells]);
		const clearanceReason = issues[0]?.message;
		const valid = plan.valid && issues.length === 0 && invalidatedPorts.length === 0;
		const portReason = invalidatedPorts[0]
			? `PORT-${invalidatedPorts[0].id}의 레일 연결을 끊는 편집입니다`
			: null;
		const invalidatedPortIds = Object.freeze(
			invalidatedPorts.map((port) => port.id).sort((left, right) => left - right),
		);
		return this.cacheEvaluation(
			map,
			plan,
			committedLayout,
			committedRevision,
			portEquipment,
			Object.freeze({
				plan,
				baseRevision: plan.baseRevision,
				committedRevision,
				validationLevel: "exact",
				stale: false,
				failureCode: null,
				topologyValid: plan.valid && invalidatedPorts.length === 0,
				valid,
				reason: plan.valid ? (portReason ?? clearanceReason ?? plan.reason) : plan.reason,
				paths: draftLayout.paths,
				envelopes: draftLayout.clearance.envelopes,
				conflictCells: allConflictCells,
				issues: Object.freeze(issues),
				invalidatedPortIds,
				candidateCommittedEnvelopePairs: this.candidateCommittedEnvelopePairs,
				testedCommittedEnvelopePairs: this.testedCommittedEnvelopePairs,
			}),
		);
	}

	getStats(): RailDraftEvaluatorStats {
		return Object.freeze({
			evaluations: this.evaluations,
			draftCacheHits: this.draftCacheHits,
			staleRejects: this.staleRejects,
			draftCompiles: this.draftCompiles,
			committedBindings: this.committedBindings,
			committedIndexBuilds: this.committedIndexBuilds,
			committedPreparedBindings: this.committedPreparedBindings,
			committedAdjacencyBuilds: this.committedAdjacencyBuilds,
			committedRevision: this.committedLayout?.revision ?? -1,
			committedEnvelopeCount: this.committedLayout?.clearance.envelopes.count ?? 0,
			candidateCommittedEnvelopePairs: this.candidateCommittedEnvelopePairs,
			testedCommittedEnvelopePairs: this.testedCommittedEnvelopePairs,
		});
	}

	private bindCommittedLayout(
		layout: CompiledPhysicalLayout,
		artifacts?: RailDraftPreparedArtifacts,
	): void {
		if (this.committedLayout === layout) return;
		this.committedLayout = layout;
		if (artifacts && railDraftPreparedArtifactsReadyForAdoption(layout, artifacts)) {
			this.committedPreparedBindings++;
			this.committedIndex = RailEnvelopeSpatialIndex.fromSnapshot(
				layout.clearance.envelopes,
				artifacts.envelopeSpatialIndex,
			);
			this.committedPathIndicesByCell = new PhysicalPathCellIndex(artifacts.pathCellIndex);
			this.committedPathIndicesBySwitch = new PhysicalPathSwitchIndex(artifacts.pathSwitchIndex);
			this.committedPathIndicesByIdentity = new PhysicalPathIdentityIndex(
				artifacts.pathIdentityIndex,
			);
			this.committedForwardAdjacency = artifacts.forwardAdjacency;
			this.committedReverseAdjacency = artifacts.reverseAdjacency;
		} else {
			this.committedIndex = new RailEnvelopeSpatialIndex(layout.clearance.envelopes);
			this.committedPathIndicesByCell = PhysicalPathCellIndex.compile(layout.paths);
			this.committedPathIndicesBySwitch = PhysicalPathSwitchIndex.compile(layout.paths);
			this.committedPathIndicesByIdentity = PhysicalPathIdentityIndex.compile(layout.paths);
			this.committedForwardAdjacency = buildPhysicalPathAdjacency(layout.paths);
			this.committedReverseAdjacency = reversePhysicalPathAdjacency(
				this.committedForwardAdjacency,
				layout.paths.pathCount,
			);
			this.committedAdjacencyBuilds++;
		}
		this.committedContinuationWindowMeters = maximumPairwiseInstallationClearanceMeters(
			layout.clearance.envelopes,
		);
		this.committedBindings++;
		this.committedIndexBuilds++;
	}

	private evaluateAgainstCommitted(
		map: TileMap,
		plan: RailDraftPlan,
		draftLayout: CompiledPhysicalLayout,
	): RailDraftClearanceIssue[] {
		const committedLayout = this.committedLayout;
		const committedIndex = this.committedIndex;
		if (!committedLayout || !committedIndex) return [];
		const affectedPaths = this.affectedCommittedPaths(map, plan, draftLayout.paths);
		const draftEnvelopes = draftLayout.clearance.envelopes;
		const committedEnvelopes = committedLayout.clearance.envelopes;
		const candidates: number[] = [];
		const deepestByRegion = new Map<string, CrossIssueCandidate>();
		const draftAdjacency = buildPhysicalPathAdjacency(draftLayout.paths);
		let candidatePairs = 0;
		let testedPairs = 0;

		for (
			let draftEnvelopeIndex = 0;
			draftEnvelopeIndex < draftEnvelopes.count;
			draftEnvelopeIndex++
		) {
			const boundsOffset = draftEnvelopeIndex * 4;
			committedIndex.query(
				{
					minX: draftEnvelopes.bounds[boundsOffset] as number,
					minY: draftEnvelopes.bounds[boundsOffset + 1] as number,
					maxX: draftEnvelopes.bounds[boundsOffset + 2] as number,
					maxY: draftEnvelopes.bounds[boundsOffset + 3] as number,
				},
				candidates,
			);
			for (const committedEnvelopeIndex of candidates) {
				candidatePairs++;
				const committedPathIndex = committedEnvelopes.pathIndices[committedEnvelopeIndex] as number;
				if (affectedPaths.has(committedPathIndex)) continue;
				const closest = closestCrossEnvelopeSegments(
					draftEnvelopes,
					draftEnvelopeIndex,
					committedEnvelopes,
					committedEnvelopeIndex,
				);
				testedPairs++;
				const tolerance =
					((draftEnvelopes.approximationToleranceMillimeters[draftEnvelopeIndex] as number) +
						(committedEnvelopes.approximationToleranceMillimeters[
							committedEnvelopeIndex
						] as number)) /
					1_000;
				const installationClearance =
					((draftEnvelopes.installationRadiusMillimeters[draftEnvelopeIndex] as number) +
						(committedEnvelopes.installationRadiusMillimeters[committedEnvelopeIndex] as number)) /
						1_000 +
					tolerance;
				if (closest.distance + DISTANCE_EPSILON >= installationClearance) continue;

				const draftPathIndex = draftEnvelopes.pathIndices[draftEnvelopeIndex] as number;
				const draftStation = interpolate(
					draftEnvelopes.stationStarts[draftEnvelopeIndex] as number,
					draftEnvelopes.stationEnds[draftEnvelopeIndex] as number,
					closest.firstAmount,
				);
				const committedStation = interpolate(
					committedEnvelopes.stationStarts[committedEnvelopeIndex] as number,
					committedEnvelopes.stationEnds[committedEnvelopeIndex] as number,
					closest.secondAmount,
				);
				if (
					isCrossLayoutTurnoutModule(
						draftLayout,
						draftPathIndex,
						draftStation,
						committedLayout.paths,
						committedPathIndex,
						committedStation,
					) ||
					isCrossLayoutContinuation(
						draftLayout.paths,
						draftPathIndex,
						draftStation,
						committedLayout.paths,
						committedPathIndex,
						committedStation,
						installationClearance,
						draftAdjacency,
					)
				) {
					continue;
				}

				const beamClearance =
					((draftEnvelopes.beamRadiusMillimeters[draftEnvelopeIndex] as number) +
						(committedEnvelopes.beamRadiusMillimeters[committedEnvelopeIndex] as number)) /
						1_000 +
					tolerance;
				const ohtClearance =
					((draftEnvelopes.ohtSweepRadiusMillimeters[draftEnvelopeIndex] as number) +
						(committedEnvelopes.ohtSweepRadiusMillimeters[committedEnvelopeIndex] as number)) /
						1_000 +
					tolerance;
				const code =
					closest.distance < beamClearance
						? RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION
						: closest.distance < ohtClearance
							? RAIL_CLEARANCE_ISSUE_CODE.OHT_SWEEP_INTRUSION
							: RAIL_CLEARANCE_ISSUE_CODE.INSTALLATION_CLEARANCE;
				const requiredClearance =
					code === RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION
						? beamClearance
						: code === RAIL_CLEARANCE_ISSUE_CODE.OHT_SWEEP_INTRUSION
							? ohtClearance
							: installationClearance;
				const draftCell = referenceCell(closest.firstX, closest.firstY);
				const otherCell = referenceCell(closest.secondX, closest.secondY);
				const issue: CrossIssueCandidate = Object.freeze({
					key: `${draftPathIndex}:${committedPathIndex}:${cellKey(draftCell.x, draftCell.y)}:${cellKey(otherCell.x, otherCell.y)}`,
					source: "committed",
					code,
					message: railClearanceIssueMessage(code),
					draftPathIndex,
					draftEnvelopeIndex,
					draftStation,
					draftIdentity: railClearancePathIdentity(draftLayout.paths, draftPathIndex),
					otherPathIndex: committedPathIndex,
					otherEnvelopeIndex: committedEnvelopeIndex,
					otherStation: committedStation,
					otherIdentity: railClearancePathIdentity(committedLayout.paths, committedPathIndex),
					draftCell,
					otherCell,
					contactPoint: Object.freeze({
						x: (closest.firstX + closest.secondX) / 2,
						y: (closest.firstY + closest.secondY) / 2,
					}),
					centerlineDistance: closest.distance,
					requiredClearance,
					penetrationDepth: requiredClearance - closest.distance,
				});
				const previous = deepestByRegion.get(issue.key);
				if (!previous || issue.penetrationDepth > previous.penetrationDepth) {
					deepestByRegion.set(issue.key, issue);
				}
			}
		}
		this.candidateCommittedEnvelopePairs = candidatePairs;
		this.testedCommittedEnvelopePairs = testedPairs;
		return [...deepestByRegion.values()].sort(compareDraftIssues);
	}

	private affectedCommittedPaths(
		map: TileMap,
		plan: RailDraftPlan,
		draftPaths: CompiledPhysicalPaths,
	): Set<number> {
		const affected = new Set<number>();
		const switchIds = new Set<number>();
		for (const mutation of plan.mutations) {
			for (const pathIndex of this.committedPathIndicesByCell.get(
				cellKey(mutation.x, mutation.y),
			) ?? []) {
				affected.add(pathIndex);
			}
			const owner = map.getAdvancedSwitchOwningCell(mutation.x, mutation.y);
			if (owner) switchIds.add(owner.id);
		}
		for (const mutation of switchMutations(plan)) {
			switchIds.add(mutation.id);
			for (const record of [mutation.before, mutation.after]) {
				if (!record) continue;
				for (const cell of deriveAdvancedSwitchGeometry(record).claimedCells) {
					for (const pathIndex of this.committedPathIndicesByCell.get(cellKey(cell.x, cell.y)) ??
						[]) {
						affected.add(pathIndex);
					}
				}
			}
		}
		for (const switchId of switchIds) {
			for (const pathIndex of this.committedPathIndicesBySwitch.get(switchId) ?? []) {
				affected.add(pathIndex);
			}
		}
		for (let pathIndex = 0; pathIndex < draftPaths.pathCount; pathIndex++) {
			const identity = railClearancePathIdentity(draftPaths, pathIndex);
			for (const committedPathIndex of this.committedPathIndicesByIdentity.get(identity) ?? []) {
				affected.add(committedPathIndex);
			}
		}
		return affected;
	}

	private cacheEvaluation(
		map: TileMap,
		plan: RailDraftPlan,
		committedLayout: CompiledPhysicalLayout,
		revision: number,
		portEquipment: PortEquipmentState | null,
		evaluation: RailDraftEvaluation,
	): RailDraftEvaluation {
		this.cachedMap = map;
		this.cachedPlan = plan;
		this.cachedCommittedLayout = committedLayout;
		this.cachedRevision = revision;
		this.cachedPortEquipment = portEquipment;
		this.cachedEvaluation = evaluation;
		return evaluation;
	}
}

/** Compile the plan's future-state footprint only; the authored map remains untouched. */
export function compileRailDraftLayout(
	map: TileMap,
	plan: RailDraftPlan,
	committedCoverage?: CommittedDraftCoverage,
): CompiledPhysicalLayout | null {
	if (plan.mutations.length === 0 && switchMutations(plan).length === 0) return null;
	const afterByCell = new Map(
		plan.mutations.map((mutation) => [cellKey(mutation.x, mutation.y), mutation.after]),
	);
	const readEncoded = (x: number, y: number): number =>
		afterByCell.get(cellKey(x, y)) ?? map.getEncoded(x, y);
	const candidates = new Map<string, Cell>();
	const addCell = (cell: Cell): void => {
		candidates.set(cellKey(cell.x, cell.y), cell);
	};
	for (const cell of plan.cells) addCell(cell);
	for (const mutation of plan.mutations) addCell(mutation);

	const changedSwitches = new Map(switchMutations(plan).map((mutation) => [mutation.id, mutation]));
	const localSwitches = new Map<number, AdvancedSwitchRecord>();
	const addSwitch = (record: AdvancedSwitchRecord): void => {
		const changed = changedSwitches.get(record.id);
		const effective = changed ? changed.after : record;
		if (!effective) return;
		localSwitches.set(effective.id, effective);
		for (const state of deriveAdvancedSwitchGeometry(effective).cellStates) addCell(state);
	};
	for (const mutation of switchMutations(plan)) {
		if (mutation.after) addSwitch(mutation.after);
		if (mutation.before) {
			for (const cell of deriveAdvancedSwitchGeometry(mutation.before).claimedCells) addCell(cell);
		}
	}
	for (const cell of [...candidates.values()]) {
		const owner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
		if (owner) addSwitch(owner);
	}

	const footprints = collectAffectedTurnoutFootprints(
		(x, y) => decodeRailCell(readEncoded(x, y)),
		[...candidates.values()],
	);
	for (const footprint of footprints) {
		addCell(footprint.cell);
		for (const cell of footprint.reservedCells) addCell(cell);
		for (const direction of [
			footprint.through.incoming,
			footprint.through.outgoing,
			footprint.divergingSide,
		]) {
			addCell(moveCell(footprint.cell, direction));
		}
	}
	if (committedCoverage) {
		includeIntersectingCompoundCoverage(candidates, committedCoverage);
		includeCommittedContinuationHalo(candidates, committedCoverage);
		includeIntersectingCompoundCoverage(candidates, committedCoverage);
		for (const cell of [...candidates.values()]) {
			const owner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
			if (owner) addSwitch(owner);
		}
	}

	const localMap = new TileMap();
	for (const cell of candidates.values()) {
		const encoded = readEncoded(cell.x, cell.y);
		if (encoded !== 0) localMap.setEncoded(cell.x, cell.y, encoded);
	}
	for (const record of localSwitches.values()) localMap.setAdvancedSwitch(record);
	return compilePhysicalRail(localMap, plan.baseRevision);
}

function includeIntersectingCompoundCoverage(
	candidates: Map<string, Cell>,
	committed: CommittedDraftCoverage,
): void {
	const intersectingPaths = new Set<number>();
	for (const key of [...candidates.keys()]) {
		for (const pathIndex of committed.pathIndicesByCell.get(key) ?? []) {
			if (isOrdinaryCompoundPath(committed.paths.kinds[pathIndex] as number)) {
				intersectingPaths.add(pathIndex);
			}
		}
	}
	for (const pathIndex of intersectingPaths) {
		const start = committed.paths.coverageOffsets[pathIndex] as number;
		const end = committed.paths.coverageOffsets[pathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const cell = Object.freeze({
				x: committed.paths.coverageCells[row * 2] as number,
				y: committed.paths.coverageCells[row * 2 + 1] as number,
			});
			candidates.set(cellKey(cell.x, cell.y), cell);
		}
	}
}

/**
 * Bring only short committed bridge paths into the local future-state graph. This lets the shared
 * clearance validator classify a continuation that crosses committed geometry before re-entering
 * the draft, without compiling or scanning the full authored map on pointer movement.
 */
function includeCommittedContinuationHalo(
	candidates: Map<string, Cell>,
	committed: CommittedDraftCoverage,
): void {
	const windowMeters = committed.continuationWindowMeters;
	if (!Number.isFinite(windowMeters) || windowMeters <= 0) return;

	const seedPathIndices = new Set<number>();
	for (const key of [...candidates.keys()]) {
		for (const pathIndex of committed.pathIndicesByCell.get(key) ?? []) {
			if (pathIndex < committed.paths.pathCount) seedPathIndices.add(pathIndex);
		}
	}
	if (seedPathIndices.size === 0) return;

	const haloPathIndices = new Set<number>();
	collectDirectedContinuationHalo(
		committed.paths,
		committed.forwardAdjacency,
		seedPathIndices,
		windowMeters,
		haloPathIndices,
	);
	collectDirectedContinuationHalo(
		committed.paths,
		committed.reverseAdjacency,
		seedPathIndices,
		windowMeters,
		haloPathIndices,
	);

	for (const pathIndex of haloPathIndices) {
		const start = committed.paths.coverageOffsets[pathIndex] as number;
		const end = committed.paths.coverageOffsets[pathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const cell = Object.freeze({
				x: committed.paths.coverageCells[row * 2] as number,
				y: committed.paths.coverageCells[row * 2 + 1] as number,
			});
			candidates.set(cellKey(cell.x, cell.y), cell);
		}
	}
}

function collectDirectedContinuationHalo(
	paths: CompiledPhysicalPaths,
	adjacency: PhysicalPathAdjacency,
	seedPathIndices: ReadonlySet<number>,
	windowMeters: number,
	target: Set<number>,
): void {
	const bestDistance = new Map<number, number>();
	const queue: Array<{ pathIndex: number; distanceMeters: number }> = [];
	const enqueueTargets = (pathIndex: number, distanceMeters: number): void => {
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		for (let row = start; row < end; row++) {
			const targetPathIndex = adjacency.targets[row] as number;
			if (seedPathIndices.has(targetPathIndex)) continue;
			const targetLength = paths.lengths[targetPathIndex] as number;
			if (!Number.isFinite(targetLength) || targetLength < 0) continue;
			const nextDistance = distanceMeters + targetLength;
			if (nextDistance > windowMeters + STATION_TOLERANCE_METERS) continue;
			const previous = bestDistance.get(targetPathIndex);
			if (previous !== undefined && previous <= nextDistance) continue;
			bestDistance.set(targetPathIndex, nextDistance);
			queue.push({ pathIndex: targetPathIndex, distanceMeters: nextDistance });
		}
	};

	for (const pathIndex of seedPathIndices) enqueueTargets(pathIndex, 0);
	while (queue.length > 0) {
		let nearestIndex = 0;
		for (let index = 1; index < queue.length; index++) {
			if (
				(queue[index] as { distanceMeters: number }).distanceMeters <
				(queue[nearestIndex] as { distanceMeters: number }).distanceMeters
			) {
				nearestIndex = index;
			}
		}
		const current = queue.splice(nearestIndex, 1)[0] as {
			pathIndex: number;
			distanceMeters: number;
		};
		if (bestDistance.get(current.pathIndex) !== current.distanceMeters) continue;
		target.add(current.pathIndex);
		enqueueTargets(current.pathIndex, current.distanceMeters);
	}
}

function maximumPairwiseInstallationClearanceMeters(envelopes: CompiledRailEnvelopes): number {
	let maximumRadiusAndToleranceMillimeters = 0;
	for (let envelopeIndex = 0; envelopeIndex < envelopes.count; envelopeIndex++) {
		const radiusAndTolerance =
			(envelopes.installationRadiusMillimeters[envelopeIndex] as number) +
			(envelopes.approximationToleranceMillimeters[envelopeIndex] as number);
		if (Number.isFinite(radiusAndTolerance)) {
			maximumRadiusAndToleranceMillimeters = Math.max(
				maximumRadiusAndToleranceMillimeters,
				radiusAndTolerance,
			);
		}
	}
	return (maximumRadiusAndToleranceMillimeters * 2) / 1_000;
}

function isOrdinaryCompoundPath(kind: number): boolean {
	return (
		kind === PATH_KIND.COMPOUND_CCW ||
		kind === PATH_KIND.COMPOUND_S ||
		kind === PATH_KIND.COMPOUND_CSC_HOMO ||
		kind === PATH_KIND.COMPOUND_CSC_HETE ||
		kind === PATH_KIND.COMPOUND_RIGHT
	);
}

/** Compatibility surface for renderer/tests; the implementation remains in the domain compiler. */
export function compileAdvancedSwitchPreviewLayout(
	plan: AdvancedSwitchPlan | AdvancedSwitchReplacementPlan,
	sourceMap = new TileMap(),
): CompiledPhysicalLayout | null {
	return compileRailDraftLayout(sourceMap, plan);
}

function switchMutations(plan: RailDraftPlan): readonly AdvancedSwitchMutation[] {
	return "switchMutations" in plan ? (plan.switchMutations ?? []) : [];
}

function internalDraftIssues(layout: CompiledPhysicalLayout): RailDraftClearanceIssue[] {
	const source = layout.clearance.issues;
	const result: RailDraftClearanceIssue[] = [];
	for (let row = 0; row < source.count; row++) {
		const code = source.codes[row] as RailClearanceIssueCode;
		const draftPathIndex = source.firstPathIndices[row] as number;
		const otherPathIndex = source.secondPathIndices[row] as number;
		result.push(
			Object.freeze({
				source: "draft",
				code,
				message: railClearanceIssueMessage(code),
				draftPathIndex,
				draftEnvelopeIndex: source.firstEnvelopeIndices[row] as number,
				draftStation: source.firstStations[row] as number,
				draftIdentity: railClearancePathIdentity(layout.paths, draftPathIndex),
				otherPathIndex,
				otherEnvelopeIndex: source.secondEnvelopeIndices[row] as number,
				otherStation: source.secondStations[row] as number,
				otherIdentity: railClearancePathIdentity(layout.paths, otherPathIndex),
				draftCell: Object.freeze({
					x: source.cells[row * 4] as number,
					y: source.cells[row * 4 + 1] as number,
				}),
				otherCell: Object.freeze({
					x: source.cells[row * 4 + 2] as number,
					y: source.cells[row * 4 + 3] as number,
				}),
				contactPoint: Object.freeze({
					x: source.contactPoints[row * 2] as number,
					y: source.contactPoints[row * 2 + 1] as number,
				}),
				centerlineDistance: source.centerlineDistances[row] as number,
				requiredClearance: source.requiredClearances[row] as number,
				penetrationDepth: source.penetrationDepths[row] as number,
			}),
		);
	}
	return result;
}

function emptyEvaluation(
	plan: RailDraftPlan,
	committedRevision: number,
	reason: string,
	failureCode: RailDraftEvaluation["failureCode"] = null,
): RailDraftEvaluation {
	return Object.freeze({
		plan,
		baseRevision: plan.baseRevision,
		committedRevision,
		validationLevel: "exact",
		stale: failureCode === "stale",
		failureCode,
		topologyValid: plan.valid,
		valid: false,
		reason,
		paths: null,
		envelopes: null,
		conflictCells: Object.freeze([...plan.conflicts]),
		issues: Object.freeze([]),
		invalidatedPortIds: Object.freeze([]),
		candidateCommittedEnvelopePairs: 0,
		testedCommittedEnvelopePairs: 0,
	});
}

function closestCrossEnvelopeSegments(
	first: CompiledRailEnvelopes,
	firstIndex: number,
	second: CompiledRailEnvelopes,
	secondIndex: number,
): ReturnType<typeof closestLineSegments> {
	return closestLineSegments(
		first.startPoints[firstIndex * 2] as number,
		first.startPoints[firstIndex * 2 + 1] as number,
		first.endPoints[firstIndex * 2] as number,
		first.endPoints[firstIndex * 2 + 1] as number,
		second.startPoints[secondIndex * 2] as number,
		second.startPoints[secondIndex * 2 + 1] as number,
		second.endPoints[secondIndex * 2] as number,
		second.endPoints[secondIndex * 2 + 1] as number,
	);
}

function isCrossLayoutContinuation(
	first: CompiledPhysicalPaths,
	firstPathIndex: number,
	firstStation: number,
	second: CompiledPhysicalPaths,
	secondPathIndex: number,
	secondStation: number,
	maxRouteDistanceMeters: number,
	firstAdjacency: PhysicalPathAdjacency,
): boolean {
	return (
		draftToCommittedRouteFits(
			first,
			firstAdjacency,
			firstPathIndex,
			firstStation,
			second,
			secondPathIndex,
			secondStation,
			maxRouteDistanceMeters,
		) ||
		committedToDraftRouteFits(
			second,
			secondPathIndex,
			secondStation,
			first,
			firstAdjacency,
			firstPathIndex,
			firstStation,
			maxRouteDistanceMeters,
		)
	);
}

function isCrossLayoutTurnoutModule(
	draftLayout: CompiledPhysicalLayout,
	draftPathIndex: number,
	draftStation: number,
	committedPaths: CompiledPhysicalPaths,
	committedPathIndex: number,
	committedStation: number,
): boolean {
	const turnouts = draftLayout.turnoutFootprints;
	for (let turnoutIndex = 0; turnoutIndex < turnouts.count; turnoutIndex++) {
		const clearanceStart = turnouts.clearancePathOffsets[turnoutIndex] as number;
		const clearanceEnd = turnouts.clearancePathOffsets[turnoutIndex + 1] as number;
		let ownsDraftStation = false;
		for (let row = clearanceStart; row < clearanceEnd; row++) {
			if (
				(turnouts.clearancePathIndices[row] as number) === draftPathIndex &&
				draftStation >= (turnouts.clearancePathStarts[row] as number) - STATION_TOLERANCE_METERS &&
				draftStation <= (turnouts.clearancePathEnds[row] as number) + STATION_TOLERANCE_METERS
			) {
				ownsDraftStation = true;
				break;
			}
		}
		if (!ownsDraftStation) continue;

		const pathStart = turnouts.pathOffsets[turnoutIndex] as number;
		const pathEnd = turnouts.pathOffsets[turnoutIndex + 1] as number;
		for (let row = pathStart; row < pathEnd; row++) {
			const corePathIndex = turnouts.pathIndices[row] as number;
			if (
				committedStation >=
					(committedPaths.lengths[committedPathIndex] as number) - STATION_TOLERANCE_METERS &&
				authoredPhysicalPathContinuation(
					committedPaths,
					committedPathIndex,
					draftLayout.paths,
					corePathIndex,
				)
			) {
				return true;
			}
			if (
				committedStation <= STATION_TOLERANCE_METERS &&
				authoredPhysicalPathContinuation(
					draftLayout.paths,
					corePathIndex,
					committedPaths,
					committedPathIndex,
				)
			) {
				return true;
			}
		}
	}
	return false;
}

function draftToCommittedRouteFits(
	draft: CompiledPhysicalPaths,
	adjacency: PhysicalPathAdjacency,
	startPathIndex: number,
	startStation: number,
	committed: CompiledPhysicalPaths,
	committedPathIndex: number,
	committedStation: number,
	maxDistanceMeters: number,
): boolean {
	const limit = maxDistanceMeters + STATION_TOLERANCE_METERS;
	const queue: Array<{ pathIndex: number; distanceToStart: number }> = [
		{ pathIndex: startPathIndex, distanceToStart: -Math.max(0, startStation) },
	];
	const best = new Map<number, number>([[startPathIndex, -Math.max(0, startStation)]]);
	while (queue.length > 0) {
		queue.sort((left, right) => left.distanceToStart - right.distanceToStart);
		const current = queue.shift() as { pathIndex: number; distanceToStart: number };
		const distanceToEnd = current.distanceToStart + (draft.lengths[current.pathIndex] as number);
		if (distanceToEnd > limit) continue;
		if (
			endpointsMatch(draft, current.pathIndex, "end", committed, committedPathIndex, "start") &&
			distanceToEnd + Math.max(0, committedStation) <= limit
		) {
			return true;
		}
		for (const target of adjacencyTargets(adjacency, current.pathIndex)) {
			if (!endpointsMatch(draft, current.pathIndex, "end", draft, target, "start")) continue;
			const previous = best.get(target);
			if (previous !== undefined && previous <= distanceToEnd) continue;
			best.set(target, distanceToEnd);
			queue.push({ pathIndex: target, distanceToStart: distanceToEnd });
		}
	}
	return false;
}

function committedToDraftRouteFits(
	committed: CompiledPhysicalPaths,
	committedPathIndex: number,
	committedStation: number,
	draft: CompiledPhysicalPaths,
	adjacency: PhysicalPathAdjacency,
	targetPathIndex: number,
	targetStation: number,
	maxDistanceMeters: number,
): boolean {
	const limit = maxDistanceMeters + STATION_TOLERANCE_METERS;
	const committedRemainder = Math.max(
		0,
		(committed.lengths[committedPathIndex] as number) - committedStation,
	);
	if (committedRemainder > limit) return false;
	const queue: Array<{ pathIndex: number; distanceToStart: number }> = [];
	const best = new Map<number, number>();
	for (let pathIndex = 0; pathIndex < draft.pathCount; pathIndex++) {
		if (!endpointsMatch(committed, committedPathIndex, "end", draft, pathIndex, "start")) continue;
		best.set(pathIndex, committedRemainder);
		queue.push({ pathIndex, distanceToStart: committedRemainder });
	}
	while (queue.length > 0) {
		queue.sort((left, right) => left.distanceToStart - right.distanceToStart);
		const current = queue.shift() as { pathIndex: number; distanceToStart: number };
		if (
			current.pathIndex === targetPathIndex &&
			current.distanceToStart + Math.max(0, targetStation) <= limit
		) {
			return true;
		}
		const distanceToEnd = current.distanceToStart + (draft.lengths[current.pathIndex] as number);
		if (distanceToEnd > limit) continue;
		for (const target of adjacencyTargets(adjacency, current.pathIndex)) {
			if (!endpointsMatch(draft, current.pathIndex, "end", draft, target, "start")) continue;
			const previous = best.get(target);
			if (previous !== undefined && previous <= distanceToEnd) continue;
			best.set(target, distanceToEnd);
			queue.push({ pathIndex: target, distanceToStart: distanceToEnd });
		}
	}
	return false;
}

function adjacencyTargets(adjacency: PhysicalPathAdjacency, pathIndex: number): number[] {
	const targets: number[] = [];
	const start = adjacency.offsets[pathIndex] as number;
	const end = adjacency.offsets[pathIndex + 1] as number;
	for (let row = start; row < end; row++) targets.push(adjacency.targets[row] as number);
	return targets;
}

function endpointsMatch(
	first: CompiledPhysicalPaths,
	firstPathIndex: number,
	firstEdge: "start" | "end",
	second: CompiledPhysicalPaths,
	secondPathIndex: number,
	secondEdge: "start" | "end",
): boolean {
	if (
		firstEdge !== "end" ||
		secondEdge !== "start" ||
		!authoredPhysicalPathContinuation(first, firstPathIndex, second, secondPathIndex)
	) {
		return false;
	}
	const firstPoint = pathEndpointIndex(first, firstPathIndex, firstEdge);
	const secondPoint = pathEndpointIndex(second, secondPathIndex, secondEdge);
	if (firstPoint < 0 || secondPoint < 0) return false;
	const distance = Math.hypot(
		(first.positions[firstPoint * 2] as number) - (second.positions[secondPoint * 2] as number),
		(first.positions[firstPoint * 2 + 1] as number) -
			(second.positions[secondPoint * 2 + 1] as number),
	);
	if (!Number.isFinite(distance) || distance > STATION_TOLERANCE_METERS) return false;
	const firstTangentX = first.tangents[firstPoint * 2] as number;
	const firstTangentY = first.tangents[firstPoint * 2 + 1] as number;
	const secondTangentX = second.tangents[secondPoint * 2] as number;
	const secondTangentY = second.tangents[secondPoint * 2 + 1] as number;
	const firstLength = Math.hypot(firstTangentX, firstTangentY);
	const secondLength = Math.hypot(secondTangentX, secondTangentY);
	if (firstLength <= DISTANCE_EPSILON || secondLength <= DISTANCE_EPSILON) return false;
	const dot =
		(firstTangentX * secondTangentX + firstTangentY * secondTangentY) /
		(firstLength * secondLength);
	return Number.isFinite(dot) && dot >= 1 - 1e-5;
}

function pathEndpointIndex(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	edge: "start" | "end",
): number {
	const start = paths.offsets[pathIndex] as number;
	const end = paths.offsets[pathIndex + 1] as number;
	if (start >= end) return -1;
	return edge === "start" ? start : end - 1;
}

function referenceCell(x: number, y: number): Cell {
	return Object.freeze({ x: Math.floor(x), y: Math.floor(y) });
}

function uniqueCells(cells: readonly Cell[]): readonly Cell[] {
	const unique = new Map<string, Cell>();
	for (const cell of cells) unique.set(cellKey(cell.x, cell.y), Object.freeze({ ...cell }));
	return Object.freeze(
		[...unique.values()].sort((left, right) => left.y - right.y || left.x - right.x),
	);
}

function compareDraftIssues(left: RailDraftClearanceIssue, right: RailDraftClearanceIssue): number {
	return (
		left.draftPathIndex - right.draftPathIndex ||
		left.otherPathIndex - right.otherPathIndex ||
		left.draftStation - right.draftStation ||
		left.otherStation - right.otherStation ||
		left.code - right.code
	);
}

function interpolate(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}
