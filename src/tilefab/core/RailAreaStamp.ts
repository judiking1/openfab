import {
	type RailConstructionIssueCode,
	type RailConstructionPlan,
	type RailMapReader,
	type RailMutation,
	railMutationTopologyError,
} from "./paint";
import type { RailAreaSelection } from "./RailAreaSelection";
import { classifyRailCell } from "./RailCellClassification";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, TileMap } from "./TileMap";

export type RailAreaStampQuarterTurns = 0 | 1 | 2 | 3;

export interface RailAreaStampOffset {
	readonly x: number;
	readonly y: number;
}

export interface RailAreaStampEdge {
	readonly from: RailAreaStampOffset;
	readonly to: RailAreaStampOffset;
}

/** Transient exact rail geometry captured from a revision-bound semantic area selection. */
export interface RailAreaStampTemplate {
	readonly sourceRevision: number;
	readonly sourceModuleKeys: readonly string[];
	readonly sourceModuleCount: number;
	readonly sourceEdgeCount: number;
	readonly sourceWidthMeters: number;
	readonly sourceHeightMeters: number;
	readonly edges: readonly RailAreaStampEdge[];
}

export interface RailAreaStampPose {
	readonly quarterTurns: RailAreaStampQuarterTurns;
	readonly reverseFlow: boolean;
}

export interface RailAreaStampPoseBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface RailAreaStampMetadata {
	readonly sourceModuleCount: number;
	readonly sourceEdgeCount: number;
	readonly planningLevel: "exact" | "coarse-preview";
	readonly quarterTurns: RailAreaStampQuarterTurns;
	readonly reverseFlow: boolean;
	readonly anchor: Cell;
	readonly bounds: Readonly<{
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}>;
	readonly widthMeters: number;
	readonly heightMeters: number;
}

export interface RailAreaStampAttachmentIntent {
	readonly anchor: Cell;
	readonly connectionCell: Cell;
	readonly pose: RailAreaStampPose;
	readonly distanceMeters: number;
}

export type RailAreaStampAttachmentPlanningLevel = "exact" | "coarse-preview";

export class RailAreaStampAttachmentIndex {
	readonly baseRevision: number;
	readonly terminalCount: number;
	readonly bucketCount: number;

	private readonly source: readonly Cell[] | Int32Array;
	private readonly buckets: ReadonlyMap<string, readonly Cell[]>;

	constructor(map: RailMapReader, openTerminalCells: readonly Cell[] | Int32Array) {
		this.baseRevision = map.getRevision();
		this.source = openTerminalCells;
		const mutableBuckets = new Map<string, Cell[]>();
		let terminalCount = 0;
		forEachTerminalCell(openTerminalCells, (cell) => {
			const bucketKey = attachmentBucketKey(cell.x, cell.y);
			let bucket = mutableBuckets.get(bucketKey);
			if (!bucket) {
				bucket = [];
				mutableBuckets.set(bucketKey, bucket);
			}
			bucket.push(freezeCell(cell));
			terminalCount++;
		});
		this.buckets = new Map(
			[...mutableBuckets.entries()].map(([key, cells]) => [
				key,
				Object.freeze(cells.sort(compareCells)),
			]),
		);
		this.terminalCount = terminalCount;
		this.bucketCount = this.buckets.size;
		Object.freeze(this);
	}

	matches(
		map: RailMapReader,
		openTerminalCells: readonly Cell[] | Int32Array = this.source,
	): boolean {
		return this.baseRevision === map.getRevision() && this.source === openTerminalCells;
	}

	nearby(
		focus: Readonly<{ x: number; y: number }>,
		maximumDistanceMeters: number,
	): readonly Readonly<{ cell: Cell; distanceMeters: number }>[] {
		const bucketSize = RAIL_AREA_STAMP_ATTACHMENT_BUCKET_SIZE_METERS;
		const minimumBucketX = Math.floor((focus.x - maximumDistanceMeters - 1) / bucketSize);
		const maximumBucketX = Math.floor((focus.x + maximumDistanceMeters + 1) / bucketSize);
		const minimumBucketY = Math.floor((focus.y - maximumDistanceMeters - 1) / bucketSize);
		const maximumBucketY = Math.floor((focus.y + maximumDistanceMeters + 1) / bucketSize);
		const nearbyTargets: Array<Readonly<{ cell: Cell; distanceMeters: number }>> = [];
		for (let bucketY = minimumBucketY; bucketY <= maximumBucketY; bucketY++) {
			for (let bucketX = minimumBucketX; bucketX <= maximumBucketX; bucketX++) {
				const bucket = this.buckets.get(`${bucketX}:${bucketY}`);
				if (!bucket) continue;
				for (const cell of bucket) {
					const distanceMeters = Math.hypot(focus.x - (cell.x + 0.5), focus.y - (cell.y + 0.5));
					if (distanceMeters <= maximumDistanceMeters) {
						nearbyTargets.push(Object.freeze({ cell, distanceMeters }));
					}
				}
			}
		}
		return Object.freeze(
			nearbyTargets.sort(
				(left, right) =>
					left.distanceMeters - right.distanceMeters || compareCells(left.cell, right.cell),
			),
		);
	}
}

export type RailAreaStampPlan = RailConstructionPlan & {
	readonly areaStamp: RailAreaStampMetadata;
};

export const RAIL_AREA_STAMP_MAX_EDGES = 20_000;
export const RAIL_AREA_STAMP_PREVIEW_MAX_CELLS = 512;
const RAIL_AREA_STAMP_ATTACHMENT_CANDIDATE_LIMIT = 24;
const RAIL_AREA_STAMP_ATTACHMENT_BUCKET_SIZE_METERS = 8;
const RAIL_AREA_STAMP_SEAM_SEARCH_RADIUS_LIMIT_METERS = 4;
const RAIL_AREA_STAMP_SEAM_TARGET_LIMIT = 24;
const RAIL_AREA_STAMP_SEAM_SAMPLES_PER_DIRECTION = 8;
const RAIL_AREA_STAMP_SEAM_PLAN_CANDIDATE_LIMIT = 8;
const TERMINAL_STATES_BY_TEMPLATE = new WeakMap<
	RailAreaStampTemplate,
	readonly Readonly<{ offset: Cell; encoded: number }>[]
>();
const SOURCE_STATES_BY_TEMPLATE = new WeakMap<RailAreaStampTemplate, ReadonlyMap<string, number>>();
interface DirectedLinearSeam {
	readonly from: Cell;
	readonly to: Cell;
	readonly direction: Direction;
}

const SEAM_SAMPLES_BY_TEMPLATE = new WeakMap<
	RailAreaStampTemplate,
	readonly DirectedLinearSeam[]
>();
const TRANSFORMED_SEAM_SAMPLES_BY_TEMPLATE = new WeakMap<
	RailAreaStampTemplate,
	Array<readonly DirectedLinearSeam[] | undefined>
>();
interface CompiledRailAreaStampPose {
	readonly edges: readonly RailAreaStampEdge[];
	readonly cells: readonly Cell[];
	readonly states: readonly Readonly<{ offset: Cell; encoded: number }>[];
	readonly bounds: Readonly<{
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}>;
	readonly widthMeters: number;
	readonly heightMeters: number;
	readonly turns: number;
	readonly firstDirection: Direction;
}

const COMPILED_POSES_BY_TEMPLATE = new WeakMap<
	RailAreaStampTemplate,
	Array<CompiledRailAreaStampPose | undefined>
>();

export function createRailAreaStampTemplate(selection: RailAreaSelection): RailAreaStampTemplate {
	return captureRailAreaStampTemplate(selection, true);
}

/**
 * Capture a selection that has just passed railAreaSelectionStaleReason against the active map and
 * ownership index. Authored ownership is already canonical, so repeating whole-graph validation
 * here would only add pointer-blocking work for large selections.
 */
export function createRailAreaStampTemplateFromValidatedSelection(
	selection: RailAreaSelection,
): RailAreaStampTemplate {
	return captureRailAreaStampTemplate(selection, false);
}

function captureRailAreaStampTemplate(
	selection: RailAreaSelection,
	validatePortableTopology: boolean,
): RailAreaStampTemplate {
	if (selection.ownerships.length === 0) {
		throw new Error("복제할 레일 모듈이 선택되지 않았습니다");
	}
	const moduleKeys = new Set<string>();
	const edges = new Map<string, DirectedRailEdge>();
	for (const ownership of selection.ownerships) {
		if (ownership.revision !== selection.revision) {
			throw new Error(`선택한 모듈 ${ownership.key}의 revision이 만료되었습니다`);
		}
		if (moduleKeys.has(ownership.key)) {
			throw new Error(`선택 영역에 중복된 모듈 ${ownership.key}가 있습니다`);
		}
		if (ownership.advancedSwitchId !== null || ownership.kind === "advanced-switch") {
			throw new Error("고급 스위치가 포함된 영역은 아직 복제할 수 없습니다");
		}
		moduleKeys.add(ownership.key);
		for (const edge of ownership.eraseEdges) {
			edges.set(directedEdgeKey(edge), edge);
			if (edges.size > RAIL_AREA_STAMP_MAX_EDGES) {
				throw new Error(
					`영역 복제는 한 조립 단위당 ${RAIL_AREA_STAMP_MAX_EDGES.toLocaleString()} edge 이하만 지원합니다`,
				);
			}
		}
	}
	if (edges.size === 0) throw new Error("선택한 모듈에 복제할 directed edge가 없습니다");

	const orderedEdges = [...edges.values()].sort(compareEdges);
	const sourceCells = uniqueEdgeCells(orderedEdges);
	const sourceBounds = cellBounds(sourceCells);
	const normalizedEdges = orderedEdges.map((edge) =>
		freezeEdge({
			from: { x: edge.from.x - sourceBounds.minX, y: edge.from.y - sourceBounds.minY },
			to: { x: edge.to.x - sourceBounds.minX, y: edge.to.y - sourceBounds.minY },
		}),
	);
	if (validatePortableTopology) assertPortableStampGeometry(normalizedEdges);

	return Object.freeze({
		sourceRevision: selection.revision,
		sourceModuleKeys: Object.freeze([...moduleKeys].sort()),
		sourceModuleCount: moduleKeys.size,
		sourceEdgeCount: normalizedEdges.length,
		sourceWidthMeters: sourceBounds.maxX - sourceBounds.minX,
		sourceHeightMeters: sourceBounds.maxY - sourceBounds.minY,
		edges: Object.freeze(normalizedEdges),
	});
}

export function initialRailAreaStampPose(): RailAreaStampPose {
	return Object.freeze({ quarterTurns: 0, reverseFlow: false });
}

export function rotateRailAreaStampPose(
	pose: RailAreaStampPose,
	quarterTurns: -1 | 1,
): RailAreaStampPose {
	assertQuarterTurns(pose.quarterTurns);
	return Object.freeze({
		quarterTurns: ((pose.quarterTurns + quarterTurns + 4) % 4) as RailAreaStampQuarterTurns,
		reverseFlow: pose.reverseFlow,
	});
}

export function reverseRailAreaStampFlow(pose: RailAreaStampPose): RailAreaStampPose {
	assertQuarterTurns(pose.quarterTurns);
	return Object.freeze({
		quarterTurns: pose.quarterTurns,
		reverseFlow: !pose.reverseFlow,
	});
}

export function railAreaStampPoseBounds(
	template: RailAreaStampTemplate,
	pose: RailAreaStampPose,
): RailAreaStampPoseBounds {
	const bounds = compiledRailAreaStampPose(template, pose).bounds;
	return Object.freeze({
		minX: bounds.minX,
		minY: bounds.minY,
		maxX: bounds.maxX,
		maxY: bounds.maxY,
	});
}

/**
 * Bake a held placement pose into a new origin-normalized portable template. The returned graph
 * contains no world anchor, so saving a rotated or reverse-flow ghost cannot leak transient editor
 * state into the project or user blueprint library.
 */
export function transformRailAreaStampTemplate(
	template: RailAreaStampTemplate,
	pose: RailAreaStampPose,
): RailAreaStampTemplate {
	assertQuarterTurns(pose.quarterTurns);
	const compiled = compiledRailAreaStampPose(template, pose);
	const edges = Object.freeze(
		compiled.edges
			.map((edge) =>
				freezeEdge({
					from: {
						x: edge.from.x - compiled.bounds.minX,
						y: edge.from.y - compiled.bounds.minY,
					},
					to: {
						x: edge.to.x - compiled.bounds.minX,
						y: edge.to.y - compiled.bounds.minY,
					},
				}),
			)
			.sort(compareEdges),
	);
	assertPortableStampGeometry(edges);
	return Object.freeze({
		sourceRevision: template.sourceRevision,
		sourceModuleKeys: Object.freeze([...template.sourceModuleKeys]),
		sourceModuleCount: template.sourceModuleCount,
		sourceEdgeCount: edges.length,
		sourceWidthMeters: compiled.widthMeters,
		sourceHeightMeters: compiled.heightMeters,
		edges,
	});
}

/** Build immutable template artifacts before the first pointer-move preview. */
export function prepareRailAreaStampPointerPlanning(
	template: RailAreaStampTemplate,
	preferredPose: RailAreaStampPose,
): void {
	assertQuarterTurns(preferredPose.quarterTurns);
	const terminals = terminalStatesForTemplate(template);
	compiledRailAreaStampPose(template, preferredPose);
	if (terminals.length === 0) seamSamplesForTemplate(template);
}

/**
 * Snap one portable blueprint boundary to a nearby authored open terminal. Exact candidates are
 * validated against the complete blueprint. Factory-scale callers may keep pointer work bounded
 * with coarse-preview and perform the mandatory exact validation on commit.
 */
export function resolveRailAreaStampAttachmentIntent(
	map: RailMapReader,
	openTerminalCells: readonly Cell[] | Int32Array | RailAreaStampAttachmentIndex,
	template: RailAreaStampTemplate,
	preferredPose: RailAreaStampPose,
	focus: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
	automaticPose = true,
	planningLevel: RailAreaStampAttachmentPlanningLevel = "exact",
): RailAreaStampAttachmentIntent | null {
	assertQuarterTurns(preferredPose.quarterTurns);
	if (
		!Number.isFinite(focus.x) ||
		!Number.isFinite(focus.y) ||
		!Number.isFinite(maximumDistanceMeters) ||
		maximumDistanceMeters < 0
	) {
		return null;
	}
	const terminals = terminalStatesForTemplate(template);
	if (terminals.length === 0) {
		return resolveClosedRailAreaStampSeamIntent(
			map,
			template,
			preferredPose,
			focus,
			maximumDistanceMeters,
			automaticPose,
			planningLevel,
		);
	}
	const attachmentIndex =
		openTerminalCells instanceof RailAreaStampAttachmentIndex
			? openTerminalCells
			: new RailAreaStampAttachmentIndex(map, openTerminalCells);
	if (attachmentIndex.terminalCount === 0) return null;
	const nearbyTargets = attachmentIndex.nearby(focus, maximumDistanceMeters);
	if (nearbyTargets.length === 0) return null;

	const candidates = new Map<
		string,
		Readonly<{
			anchor: Cell;
			connectionCell: Cell;
			pose: RailAreaStampPose;
			distanceMeters: number;
			connectionRank: number;
			poseRank: number;
		}>
	>();
	const poses = automaticPose
		? rankedAreaStampPoses(preferredPose)
		: Object.freeze([
				Object.freeze({
					quarterTurns: preferredPose.quarterTurns,
					reverseFlow: preferredPose.reverseFlow,
				}),
			]);
	for (const [poseRank, pose] of poses.entries()) {
		for (const target of nearbyTargets) {
			const targetRail = map.getRail(target.cell.x, target.cell.y);
			for (const terminal of terminals) {
				const transformedState = transformTerminalState(terminal.encoded, pose);
				const addition = decodeRailCell(transformedState);
				const merged = encodeRailCell({
					incoming: targetRail.incoming | addition.incoming,
					outgoing: targetRail.outgoing | addition.outgoing,
				});
				if (
					merged === map.getEncoded(target.cell.x, target.cell.y) ||
					classifyRailCell(decodeRailCell(merged)) === "INVALID"
				) {
					continue;
				}
				const offset = rotateOffset(terminal.offset, pose.quarterTurns);
				const anchor = freezeCell({
					x: target.cell.x - offset.x,
					y: target.cell.y - offset.y,
				});
				const key = `${pose.quarterTurns}:${pose.reverseFlow ? 1 : 0}:${anchor.x}:${anchor.y}`;
				const candidate = Object.freeze({
					anchor,
					connectionCell: freezeCell(target.cell),
					pose,
					distanceMeters: target.distanceMeters,
					connectionRank: attachmentConnectionRank(classifyRailCell(decodeRailCell(merged))),
					poseRank,
				});
				const existing = candidates.get(key);
				if (
					!existing ||
					candidate.distanceMeters < existing.distanceMeters ||
					(candidate.distanceMeters === existing.distanceMeters &&
						compareCells(candidate.connectionCell, existing.connectionCell) < 0)
				) {
					candidates.set(key, candidate);
				}
			}
		}
	}

	const ordered = [...candidates.values()]
		.sort(
			(left, right) =>
				left.distanceMeters - right.distanceMeters ||
				left.connectionRank - right.connectionRank ||
				left.poseRank - right.poseRank ||
				compareCells(left.anchor, right.anchor),
		)
		.slice(0, RAIL_AREA_STAMP_ATTACHMENT_CANDIDATE_LIMIT);
	for (const candidate of ordered) {
		if (planningLevel === "exact") {
			const plan = planRailAreaStamp(map, template, candidate.anchor, candidate.pose);
			if (!plan.valid) continue;
		}
		return Object.freeze({
			anchor: candidate.anchor,
			connectionCell: candidate.connectionCell,
			pose: candidate.pose,
			distanceMeters: candidate.distanceMeters,
		});
	}
	return null;
}

/**
 * Closed stamps have no terminal handle. Their magnetic handle is a bounded sample of ordinary
 * directed linear edges. The target probe is spatially bounded around the pointer and only a fixed
 * number of anchor candidates reach the exact planner, regardless of blueprint edge count.
 */
function resolveClosedRailAreaStampSeamIntent(
	map: RailMapReader,
	template: RailAreaStampTemplate,
	preferredPose: RailAreaStampPose,
	focus: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
	automaticPose: boolean,
	planningLevel: RailAreaStampAttachmentPlanningLevel,
): RailAreaStampAttachmentIntent | null {
	const targetSeams = nearbyDirectedLinearSeams(map, focus, maximumDistanceMeters);
	if (targetSeams.length === 0) return null;
	const poses = automaticPose
		? rankedAreaStampPoses(preferredPose)
		: Object.freeze([
				Object.freeze({
					quarterTurns: preferredPose.quarterTurns,
					reverseFlow: preferredPose.reverseFlow,
				}),
			]);
	const candidates = new Map<
		string,
		Readonly<{
			anchor: Cell;
			connectionCell: Cell;
			pose: RailAreaStampPose;
			distanceMeters: number;
			poseRank: number;
			seamRank: number;
		}>
	>();
	for (const [poseRank, pose] of poses.entries()) {
		const stampSeams = transformedSeamSamplesForTemplate(template, pose);
		for (const target of targetSeams) {
			for (const [seamRank, stampSeam] of stampSeams.entries()) {
				if (stampSeam.direction !== target.seam.direction) continue;
				const anchor = freezeCell({
					x: target.seam.from.x - stampSeam.from.x,
					y: target.seam.from.y - stampSeam.from.y,
				});
				const key = `${pose.quarterTurns}:${pose.reverseFlow ? 1 : 0}:${anchor.x}:${anchor.y}`;
				const candidate = Object.freeze({
					anchor,
					connectionCell: nearestSeamCell(target.seam, focus),
					pose,
					distanceMeters: target.distanceMeters,
					poseRank,
					seamRank,
				});
				const existing = candidates.get(key);
				if (!existing || compareSeamAttachmentCandidates(candidate, existing) < 0) {
					candidates.set(key, candidate);
				}
			}
		}
	}

	const ordered = [...candidates.values()]
		.sort(compareSeamAttachmentCandidates)
		.slice(0, RAIL_AREA_STAMP_SEAM_PLAN_CANDIDATE_LIMIT);
	for (const candidate of ordered) {
		if (planningLevel === "exact") {
			const plan = planRailAreaStamp(map, template, candidate.anchor, candidate.pose);
			if (!plan.valid || plan.newEdges >= template.sourceEdgeCount) continue;
		}
		return Object.freeze({
			anchor: candidate.anchor,
			connectionCell: candidate.connectionCell,
			pose: candidate.pose,
			distanceMeters: candidate.distanceMeters,
		});
	}
	return null;
}

function compareSeamAttachmentCandidates(
	left: Readonly<{
		anchor: Cell;
		connectionCell: Cell;
		distanceMeters: number;
		poseRank: number;
		seamRank: number;
	}>,
	right: Readonly<{
		anchor: Cell;
		connectionCell: Cell;
		distanceMeters: number;
		poseRank: number;
		seamRank: number;
	}>,
): number {
	return (
		left.distanceMeters - right.distanceMeters ||
		left.poseRank - right.poseRank ||
		left.seamRank - right.seamRank ||
		compareCells(left.anchor, right.anchor) ||
		compareCells(left.connectionCell, right.connectionCell)
	);
}

function attachmentConnectionRank(kind: ReturnType<typeof classifyRailCell>): number {
	if (kind === "LINEAR") return 0;
	if (kind === "LEFT_CURVE" || kind === "RIGHT_CURVE") return 1;
	return 2;
}

export function planRailAreaStamp(
	map: RailMapReader,
	template: RailAreaStampTemplate,
	anchor: Cell,
	pose: RailAreaStampPose,
): RailAreaStampPlan {
	assertIntegerCell(anchor);
	assertQuarterTurns(pose.quarterTurns);
	const compiledPose = compiledRailAreaStampPose(template, pose);
	const cells = compiledPose.cells.map((offset) => freezeCell(worldCell(anchor, offset)));
	const mutations = Object.freeze(
		compiledPose.states
			.map(({ offset, encoded: addition }) => {
				const cell = worldCell(anchor, offset);
				const before = map.getEncoded(cell.x, cell.y);
				const current = decodeRailCell(before);
				const added = decodeRailCell(addition);
				const after = encodeRailCell({
					incoming: current.incoming | added.incoming,
					outgoing: current.outgoing | added.outgoing,
				});
				return Object.freeze({ x: cell.x, y: cell.y, before, after });
			})
			.filter((mutation) => mutation.before !== mutation.after)
			.sort(compareMutations),
	);
	const switchConflicts = cells.filter((cell) => map.getAdvancedSwitchOwningCell(cell.x, cell.y));
	const metadata = freezeMetadata({
		sourceModuleCount: template.sourceModuleCount,
		sourceEdgeCount: template.sourceEdgeCount,
		planningLevel: "exact",
		quarterTurns: pose.quarterTurns,
		reverseFlow: pose.reverseFlow,
		anchor,
		bounds: Object.freeze({
			minX: anchor.x + compiledPose.bounds.minX,
			minY: anchor.y + compiledPose.bounds.minY,
			maxX: anchor.x + compiledPose.bounds.maxX,
			maxY: anchor.y + compiledPose.bounds.maxY,
		}),
		widthMeters: compiledPose.widthMeters,
		heightMeters: compiledPose.heightMeters,
	});
	if (switchConflicts.length > 0) {
		return invalidAreaStamp(
			map,
			cells,
			switchConflicts,
			mutations,
			metadata,
			"청사진은 고급 스위치가 점유한 셀과 겹칠 수 없습니다",
			"reserved-footprint",
		);
	}
	if (mutations.length === 0) {
		return invalidAreaStamp(
			map,
			cells,
			cells,
			mutations,
			metadata,
			"같은 방향의 청사진이 이미 설치되어 있습니다",
			"duplicate",
		);
	}

	const topologyError = railMutationTopologyError(map, mutations);
	if (topologyError) {
		return invalidAreaStamp(
			map,
			cells,
			cells,
			mutations,
			metadata,
			topologyError.replace(/^철거 후 /, "청사진 병합 후 "),
			"topology",
		);
	}

	let existingEdgeCount = 0;
	for (const edge of compiledPose.edges) {
		if (
			hasDirectedEdge(map, {
				from: worldCell(anchor, edge.from),
				to: worldCell(anchor, edge.to),
			})
		) {
			existingEdgeCount++;
		}
	}
	const newEdgeCount = compiledPose.edges.length - existingEdgeCount;
	const sharedCellCount = cells.filter((cell) => map.hasRail(cell.x, cell.y)).length;
	return Object.freeze({
		kind: "build",
		baseRevision: map.getRevision(),
		cells: Object.freeze(cells.map(freezeCell)),
		mutations,
		valid: true,
		reason:
			sharedCellCount > 0
				? existingEdgeCount > 0
					? `청사진 연결 가능 · 기존 레일 ${existingEdgeCount} m 공유`
					: "청사진 열린 끝 연결 가능"
				: `선택 영역 ${template.sourceModuleCount}개 모듈 배치 가능`,
		issueCode: null,
		conflicts: Object.freeze([]),
		newEdges: newEdgeCount,
		lengthMeters: newEdgeCount,
		turns: compiledPose.turns,
		bend:
			compiledPose.firstDirection === DIR_E || compiledPose.firstDirection === DIR_W
				? "horizontal-first"
				: "vertical-first",
		areaStamp: metadata,
	});
}

/**
 * Bounded pointer-move plan for factory-scale blueprints. It preserves the exact transformed
 * footprint while sampling rail states for the overview ghost. This plan is never commit-ready;
 * callers must rebuild it with planRailAreaStamp before applying the authored mutation.
 */
export function planRailAreaStampPreview(
	map: RailMapReader,
	template: RailAreaStampTemplate,
	anchor: Cell,
	pose: RailAreaStampPose,
): RailAreaStampPlan {
	assertIntegerCell(anchor);
	assertQuarterTurns(pose.quarterTurns);
	const compiledPose = compiledRailAreaStampPose(template, pose);
	const sampleStride = Math.max(
		1,
		Math.ceil(compiledPose.states.length / RAIL_AREA_STAMP_PREVIEW_MAX_CELLS),
	);
	const mutations: RailMutation[] = [];
	const cells: Cell[] = [];
	for (let index = 0; index < compiledPose.states.length; index += sampleStride) {
		const state = compiledPose.states[index];
		if (!state) continue;
		const cell = freezeCell(worldCell(anchor, state.offset));
		const before = map.getEncoded(cell.x, cell.y);
		const current = decodeRailCell(before);
		const added = decodeRailCell(state.encoded);
		const after = encodeRailCell({
			incoming: current.incoming | added.incoming,
			outgoing: current.outgoing | added.outgoing,
		});
		cells.push(cell);
		mutations.push(Object.freeze({ x: cell.x, y: cell.y, before, after }));
	}
	const metadata = freezeMetadata({
		sourceModuleCount: template.sourceModuleCount,
		sourceEdgeCount: template.sourceEdgeCount,
		planningLevel: "coarse-preview",
		quarterTurns: pose.quarterTurns,
		reverseFlow: pose.reverseFlow,
		anchor,
		bounds: Object.freeze({
			minX: anchor.x + compiledPose.bounds.minX,
			minY: anchor.y + compiledPose.bounds.minY,
			maxX: anchor.x + compiledPose.bounds.maxX,
			maxY: anchor.y + compiledPose.bounds.maxY,
		}),
		widthMeters: compiledPose.widthMeters,
		heightMeters: compiledPose.heightMeters,
	});
	return Object.freeze({
		kind: "build",
		baseRevision: map.getRevision(),
		cells: Object.freeze(cells),
		mutations: Object.freeze(mutations),
		valid: true,
		reason: "대규모 청사진 배치 후보 · 클릭 시 전체 위상과 간섭을 검사합니다",
		issueCode: null,
		conflicts: Object.freeze([]),
		newEdges: template.sourceEdgeCount,
		lengthMeters: template.sourceEdgeCount,
		turns: compiledPose.turns,
		bend:
			compiledPose.firstDirection === DIR_E || compiledPose.firstDirection === DIR_W
				? "horizontal-first"
				: "vertical-first",
		areaStamp: metadata,
	});
}

export function isRailAreaStampPlan(plan: unknown): plan is RailAreaStampPlan {
	return typeof plan === "object" && plan !== null && "areaStamp" in plan;
}

export function isRailAreaStampPreviewPlan(plan: unknown): plan is RailAreaStampPlan {
	return isRailAreaStampPlan(plan) && plan.areaStamp.planningLevel === "coarse-preview";
}

function assertPortableStampGeometry(edges: readonly RailAreaStampEdge[]): void {
	const map = new TileMap();
	const encodedByCell = encodedStatesForEdges(
		edges.map((edge) => ({ from: edge.from, to: edge.to })),
	);
	const mutations = [...encodedByCell.entries()].map(([key, after]) => {
		const cell = cellFromKey(key);
		return { x: cell.x, y: cell.y, before: 0, after };
	});
	const topologyError = railMutationTopologyError(map, mutations);
	if (topologyError) throw new Error(topologyError.replace(/^철거 후 /, "선택 영역의 "));
}

function encodedStatesForEdges(
	edges: readonly Readonly<{ from: Cell; to: Cell }>[],
): ReadonlyMap<string, number> {
	const states = new Map<string, number>();
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) throw new Error("영역 복제 edge는 인접한 직교 셀이어야 합니다");
		const opposite = oppositeDirection(direction);
		const fromKey = cellKey(edge.from.x, edge.from.y);
		const toKey = cellKey(edge.to.x, edge.to.y);
		const from = decodeRailCell(states.get(fromKey) ?? 0);
		const to = decodeRailCell(states.get(toKey) ?? 0);
		states.set(fromKey, encodeRailCell({ ...from, outgoing: from.outgoing | direction }));
		states.set(toKey, encodeRailCell({ ...to, incoming: to.incoming | opposite }));
	}
	return states;
}

function terminalStatesForTemplate(
	template: RailAreaStampTemplate,
): readonly Readonly<{ offset: Cell; encoded: number }>[] {
	const cached = TERMINAL_STATES_BY_TEMPLATE.get(template);
	if (cached) return cached;
	const states = sourceStatesForTemplate(template);
	const terminals = Object.freeze(
		[...states.entries()]
			.filter(([, encoded]) => classifyRailCell(decodeRailCell(encoded)) === "TERMINAL")
			.map(([key, encoded]) =>
				Object.freeze({
					offset: freezeCell(cellFromKey(key)),
					encoded,
				}),
			)
			.sort((left, right) => compareCells(left.offset, right.offset)),
	);
	TERMINAL_STATES_BY_TEMPLATE.set(template, terminals);
	return terminals;
}

function sourceStatesForTemplate(template: RailAreaStampTemplate): ReadonlyMap<string, number> {
	const cached = SOURCE_STATES_BY_TEMPLATE.get(template);
	if (cached) return cached;
	const states = encodedStatesForEdges(template.edges);
	SOURCE_STATES_BY_TEMPLATE.set(template, states);
	return states;
}

function seamSamplesForTemplate(template: RailAreaStampTemplate): readonly DirectedLinearSeam[] {
	const cached = SEAM_SAMPLES_BY_TEMPLATE.get(template);
	if (cached) return cached;
	const states = sourceStatesForTemplate(template);
	const byDirection = new Map<Direction, DirectedLinearSeam[]>(
		ALL_DIRECTIONS.map((direction) => [direction, []]),
	);
	for (const edge of template.edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) continue;
		const fromEncoded = states.get(cellKey(edge.from.x, edge.from.y));
		const toEncoded = states.get(cellKey(edge.to.x, edge.to.y));
		if (fromEncoded === undefined || toEncoded === undefined) continue;
		const fromRail = decodeRailCell(fromEncoded);
		const toRail = decodeRailCell(toEncoded);
		if (
			classifyRailCell(fromRail) !== "LINEAR" ||
			classifyRailCell(toRail) !== "LINEAR" ||
			fromRail.incoming !== oppositeDirection(direction) ||
			fromRail.outgoing !== direction ||
			toRail.incoming !== oppositeDirection(direction) ||
			toRail.outgoing !== direction
		) {
			continue;
		}
		byDirection
			.get(direction)
			?.push(Object.freeze({ from: freezeCell(edge.from), to: freezeCell(edge.to), direction }));
	}

	const samples: DirectedLinearSeam[] = [];
	for (const direction of ALL_DIRECTIONS) {
		const directed = byDirection.get(direction);
		if (!directed || directed.length === 0) continue;
		directed.sort((left, right) => compareEdges(left, right));
		samples.push(...evenlySpacedSeamSamples(directed));
	}
	samples.sort(compareTemplateSeamPriority);
	const frozen = Object.freeze(samples);
	SEAM_SAMPLES_BY_TEMPLATE.set(template, frozen);
	return frozen;
}

function evenlySpacedSeamSamples(
	seams: readonly DirectedLinearSeam[],
): readonly DirectedLinearSeam[] {
	if (seams.length <= RAIL_AREA_STAMP_SEAM_SAMPLES_PER_DIRECTION) return seams;
	const samples: DirectedLinearSeam[] = [];
	for (let index = 0; index < RAIL_AREA_STAMP_SEAM_SAMPLES_PER_DIRECTION; index++) {
		const sourceIndex = Math.round(
			(index * (seams.length - 1)) / (RAIL_AREA_STAMP_SEAM_SAMPLES_PER_DIRECTION - 1),
		);
		const seam = seams[sourceIndex];
		if (seam) samples.push(seam);
	}
	return samples;
}

function transformedSeamSamplesForTemplate(
	template: RailAreaStampTemplate,
	pose: RailAreaStampPose,
): readonly DirectedLinearSeam[] {
	let poses = TRANSFORMED_SEAM_SAMPLES_BY_TEMPLATE.get(template);
	if (!poses) {
		poses = Array.from({ length: 8 });
		TRANSFORMED_SEAM_SAMPLES_BY_TEMPLATE.set(template, poses);
	}
	const poseIndex = pose.quarterTurns + (pose.reverseFlow ? 4 : 0);
	const cached = poses[poseIndex];
	if (cached) return cached;
	const transformed = Object.freeze(
		seamSamplesForTemplate(template).map((seam) => {
			const rotatedFrom = rotateOffset(seam.from, pose.quarterTurns);
			const rotatedTo = rotateOffset(seam.to, pose.quarterTurns);
			const from = pose.reverseFlow ? rotatedTo : rotatedFrom;
			const to = pose.reverseFlow ? rotatedFrom : rotatedTo;
			const direction = directionBetween(from, to);
			if (direction === null) throw new Error("청사진 seam은 인접한 직교 edge여야 합니다");
			return Object.freeze({ from: freezeCell(from), to: freezeCell(to), direction });
		}),
	);
	poses[poseIndex] = transformed;
	return transformed;
}

function nearbyDirectedLinearSeams(
	map: RailMapReader,
	focus: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
): readonly Readonly<{ seam: DirectedLinearSeam; distanceMeters: number }>[] {
	const searchDistance = Math.min(
		maximumDistanceMeters,
		RAIL_AREA_STAMP_SEAM_SEARCH_RADIUS_LIMIT_METERS,
	);
	const minimumX = Math.floor(focus.x - searchDistance - 1);
	const maximumX = Math.floor(focus.x + searchDistance + 1);
	const minimumY = Math.floor(focus.y - searchDistance - 1);
	const maximumY = Math.floor(focus.y + searchDistance + 1);
	const nearby: Array<Readonly<{ seam: DirectedLinearSeam; distanceMeters: number }>> = [];
	for (let y = minimumY; y <= maximumY; y++) {
		for (let x = minimumX; x <= maximumX; x++) {
			const rail = map.getRail(x, y);
			if (classifyRailCell(rail) !== "LINEAR") continue;
			const direction = singleDirection(rail.outgoing);
			if (
				direction === null ||
				rail.incoming !== oppositeDirection(direction) ||
				map.getAdvancedSwitchOwningCell(x, y)
			) {
				continue;
			}
			const from = { x, y };
			const to = moveCell(from, direction);
			const toRail = map.getRail(to.x, to.y);
			if (
				classifyRailCell(toRail) !== "LINEAR" ||
				toRail.incoming !== oppositeDirection(direction) ||
				toRail.outgoing !== direction ||
				map.getAdvancedSwitchOwningCell(to.x, to.y)
			) {
				continue;
			}
			const seam = Object.freeze({
				from: freezeCell(from),
				to: freezeCell(to),
				direction,
			});
			const distanceMeters = pointToSeamDistance(focus, seam);
			if (distanceMeters > searchDistance) continue;
			insertBoundedNearbySeam(
				nearby,
				Object.freeze({ seam, distanceMeters }),
				RAIL_AREA_STAMP_SEAM_TARGET_LIMIT,
			);
		}
	}
	return Object.freeze(nearby);
}

function insertBoundedNearbySeam(
	target: Array<Readonly<{ seam: DirectedLinearSeam; distanceMeters: number }>>,
	candidate: Readonly<{ seam: DirectedLinearSeam; distanceMeters: number }>,
	limit: number,
): void {
	target.push(candidate);
	target.sort(compareNearbySeams);
	if (target.length > limit) target.pop();
}

function compareNearbySeams(
	left: Readonly<{ seam: DirectedLinearSeam; distanceMeters: number }>,
	right: Readonly<{ seam: DirectedLinearSeam; distanceMeters: number }>,
): number {
	return left.distanceMeters - right.distanceMeters || compareEdges(left.seam, right.seam);
}

function compareTemplateSeamPriority(left: DirectedLinearSeam, right: DirectedLinearSeam): number {
	const leftDistance =
		(left.from.x + left.to.x) * (left.from.x + left.to.x) +
		(left.from.y + left.to.y) * (left.from.y + left.to.y);
	const rightDistance =
		(right.from.x + right.to.x) * (right.from.x + right.to.x) +
		(right.from.y + right.to.y) * (right.from.y + right.to.y);
	return leftDistance - rightDistance || compareEdges(left, right);
}

function pointToSeamDistance(
	focus: Readonly<{ x: number; y: number }>,
	seam: DirectedLinearSeam,
): number {
	const fromX = seam.from.x + 0.5;
	const fromY = seam.from.y + 0.5;
	const deltaX = seam.to.x - seam.from.x;
	const deltaY = seam.to.y - seam.from.y;
	const projection = Math.max(
		0,
		Math.min(1, (focus.x - fromX) * deltaX + (focus.y - fromY) * deltaY),
	);
	return Math.hypot(
		focus.x - (fromX + deltaX * projection),
		focus.y - (fromY + deltaY * projection),
	);
}

function nearestSeamCell(
	seam: DirectedLinearSeam,
	focus: Readonly<{ x: number; y: number }>,
): Cell {
	const fromDistance = Math.hypot(focus.x - (seam.from.x + 0.5), focus.y - (seam.from.y + 0.5));
	const toDistance = Math.hypot(focus.x - (seam.to.x + 0.5), focus.y - (seam.to.y + 0.5));
	return freezeCell(fromDistance <= toDistance ? seam.from : seam.to);
}

function singleDirection(mask: number): Direction | null {
	let result: Direction | null = null;
	for (const direction of ALL_DIRECTIONS) {
		if ((mask & direction) === 0) continue;
		if (result !== null) return null;
		result = direction;
	}
	return result;
}

function compiledRailAreaStampPose(
	template: RailAreaStampTemplate,
	pose: RailAreaStampPose,
): CompiledRailAreaStampPose {
	let poses = COMPILED_POSES_BY_TEMPLATE.get(template);
	if (!poses) {
		poses = Array.from({ length: 8 });
		COMPILED_POSES_BY_TEMPLATE.set(template, poses);
	}
	const poseIndex = pose.quarterTurns + (pose.reverseFlow ? 4 : 0);
	const cached = poses[poseIndex];
	if (cached) return cached;

	const edges = Object.freeze(
		template.edges.map((edge) => {
			const from = rotateOffset(edge.from, pose.quarterTurns);
			const to = rotateOffset(edge.to, pose.quarterTurns);
			return freezeEdge(pose.reverseFlow ? { from: to, to: from } : { from, to });
		}),
	);
	// Pose edges already own frozen endpoints. Reuse those cells across the footprint and states
	// instead of retaining two more coordinate objects per cell in the clipboard's pose cache.
	const cells = Object.freeze(uniqueEdgeCells(edges));
	const encodedByCell = encodedStatesForEdges(edges);
	const states = Object.freeze(
		cells.map((offset) =>
			Object.freeze({
				offset,
				encoded: encodedByCell.get(cellKey(offset.x, offset.y)) as number,
			}),
		),
	);
	const bounds = cellBounds(cells);
	const firstEdge = edges[0];
	const firstDirection = firstEdge ? directionBetween(firstEdge.from, firstEdge.to) : null;
	if (firstDirection === null) throw new Error("영역 복제 포즈에 유효한 directed edge가 없습니다");
	const compiled = Object.freeze({
		edges,
		cells,
		states,
		bounds: Object.freeze(bounds),
		widthMeters: bounds.maxX - bounds.minX,
		heightMeters: bounds.maxY - bounds.minY,
		turns: countTurnCells(encodedByCell),
		firstDirection,
	});
	poses[poseIndex] = compiled;
	return compiled;
}

function rankedAreaStampPoses(preferred: RailAreaStampPose): readonly RailAreaStampPose[] {
	const poses: RailAreaStampPose[] = [];
	for (const reverseFlow of [preferred.reverseFlow, !preferred.reverseFlow]) {
		for (const delta of [0, 1, 3, 2] as const) {
			poses.push(
				Object.freeze({
					quarterTurns: ((preferred.quarterTurns + delta) % 4) as RailAreaStampQuarterTurns,
					reverseFlow,
				}),
			);
		}
	}
	return Object.freeze(poses);
}

function transformTerminalState(encoded: number, pose: RailAreaStampPose): number {
	const source = decodeRailCell(encoded);
	const incoming = rotateDirectionMask(
		pose.reverseFlow ? source.outgoing : source.incoming,
		pose.quarterTurns,
	);
	const outgoing = rotateDirectionMask(
		pose.reverseFlow ? source.incoming : source.outgoing,
		pose.quarterTurns,
	);
	return encodeRailCell({ incoming, outgoing });
}

function rotateDirectionMask(mask: number, quarterTurns: RailAreaStampQuarterTurns): number {
	let result = 0;
	for (const direction of ALL_DIRECTIONS) {
		if ((mask & direction) === 0) continue;
		result |= rotateDirectionQuarterTurns(direction, quarterTurns);
	}
	return result;
}

function rotateDirectionQuarterTurns(
	direction: Direction,
	quarterTurns: RailAreaStampQuarterTurns,
): Direction {
	let rotated = direction;
	for (let turn = 0; turn < quarterTurns; turn++) {
		rotated =
			rotated === DIR_N ? DIR_E : rotated === DIR_E ? DIR_S : rotated === DIR_S ? DIR_W : DIR_N;
	}
	return rotated;
}

function invalidAreaStamp(
	map: RailMapReader,
	cells: readonly Cell[],
	conflicts: readonly Cell[],
	mutations: readonly RailMutation[],
	metadata: RailAreaStampMetadata,
	reason: string,
	issueCode: RailConstructionIssueCode,
): RailAreaStampPlan {
	return Object.freeze({
		kind: "build",
		baseRevision: map.getRevision(),
		cells: Object.freeze(cells.map(freezeCell)),
		mutations,
		valid: false,
		reason,
		issueCode,
		conflicts: Object.freeze(conflicts.map(freezeCell)),
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
		areaStamp: metadata,
	});
}

function rotateOffset(offset: RailAreaStampOffset, quarterTurns: RailAreaStampQuarterTurns): Cell {
	if (quarterTurns === 0) return { x: offset.x, y: offset.y };
	if (quarterTurns === 1) return { x: -offset.y, y: offset.x };
	if (quarterTurns === 2) return { x: -offset.x, y: -offset.y };
	return { x: offset.y, y: -offset.x };
}

function worldCell(anchor: Cell, offset: Cell): Cell {
	const cell = { x: anchor.x + offset.x, y: anchor.y + offset.y };
	assertIntegerCell(cell);
	return cell;
}

function cellBounds(cells: readonly Cell[]): {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
} {
	const first = cells[0];
	if (!first) throw new Error("영역 복제에 셀이 없습니다");
	let minX = first.x;
	let minY = first.y;
	let maxX = first.x;
	let maxY = first.y;
	for (let index = 1; index < cells.length; index++) {
		const cell = cells[index];
		if (!cell) continue;
		minX = Math.min(minX, cell.x);
		minY = Math.min(minY, cell.y);
		maxX = Math.max(maxX, cell.x);
		maxY = Math.max(maxY, cell.y);
	}
	return { minX, minY, maxX, maxY };
}

function countTurnCells(encodedByCell: ReadonlyMap<string, number>): number {
	let turns = 0;
	for (const encoded of encodedByCell.values()) {
		const kind = classifyRailCell(decodeRailCell(encoded));
		if (kind === "LEFT_CURVE" || kind === "RIGHT_CURVE") turns++;
	}
	return turns;
}

function uniqueEdgeCells(edges: readonly Readonly<{ from: Cell; to: Cell }>[]): Cell[] {
	const cells = new Map<string, Cell>();
	for (const edge of edges) {
		cells.set(cellKey(edge.from.x, edge.from.y), edge.from);
		cells.set(cellKey(edge.to.x, edge.to.y), edge.to);
	}
	return [...cells.values()].sort(compareCells);
}

function directedEdgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function hasDirectedEdge(map: RailMapReader, edge: DirectedRailEdge): boolean {
	const direction = directionBetween(edge.from, edge.to);
	if (direction === null) return false;
	const reciprocal = oppositeDirection(direction);
	return (
		(map.getRail(edge.from.x, edge.from.y).outgoing & direction) !== 0 &&
		(map.getRail(edge.to.x, edge.to.y).incoming & reciprocal) !== 0
	);
}

function compareEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return compareCells(left.from, right.from) || compareCells(left.to, right.to);
}

function forEachTerminalCell(
	openTerminalCells: readonly Cell[] | Int32Array,
	visit: (cell: Cell) => void,
): void {
	if (openTerminalCells instanceof Int32Array) {
		for (let index = 0; index + 1 < openTerminalCells.length; index += 2) {
			visit({
				x: openTerminalCells[index] as number,
				y: openTerminalCells[index + 1] as number,
			});
		}
		return;
	}
	for (const cell of openTerminalCells) visit(cell);
}

function attachmentBucketKey(x: number, y: number): string {
	return `${Math.floor(x / RAIL_AREA_STAMP_ATTACHMENT_BUCKET_SIZE_METERS)}:${Math.floor(y / RAIL_AREA_STAMP_ATTACHMENT_BUCKET_SIZE_METERS)}`;
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function compareMutations(left: RailMutation, right: RailMutation): number {
	return left.y - right.y || left.x - right.x;
}

function cellFromKey(key: string): Cell {
	const separator = key.indexOf(",");
	return { x: Number(key.slice(0, separator)), y: Number(key.slice(separator + 1)) };
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}

function freezeEdge(edge: RailAreaStampEdge): RailAreaStampEdge {
	return Object.freeze({ from: freezeCell(edge.from), to: freezeCell(edge.to) });
}

function freezeMetadata(metadata: RailAreaStampMetadata): RailAreaStampMetadata {
	return Object.freeze({
		...metadata,
		anchor: freezeCell(metadata.anchor),
		bounds: Object.freeze({ ...metadata.bounds }),
	});
}

function assertIntegerCell(cell: Cell): void {
	if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) {
		throw new RangeError("영역 복제 앵커는 정수 그리드 셀이어야 합니다");
	}
}

function assertQuarterTurns(value: number): asserts value is RailAreaStampQuarterTurns {
	if (!Number.isInteger(value) || value < 0 || value > 3) {
		throw new RangeError("영역 복제 회전은 0, 90, 180, 270도만 지원합니다");
	}
}
