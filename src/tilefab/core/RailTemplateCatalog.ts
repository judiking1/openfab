import { analyzeRailNetwork } from "./network";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	planClosedRailPathComponent,
	planRailPath,
	type RailConstructionIssueCode,
	type RailConstructionPlan,
	type RailMapReader,
	railMutationTopologyError,
} from "./paint";
import type { RailModuleSide } from "./RailModulePlanner";
import { terminalForwardDirection } from "./RailModulePlanner";
import { MutationRailMap } from "./RailMutationMap";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, TileMap } from "./TileMap";

export const RAIL_TEMPLATE_IDS = [
	"return-loop",
	"attached-return",
	"branch-bypass",
	"long-bay",
	"paired-bay",
	"nested-bay",
	"shift-bay",
	"interbay-spine",
	"outer-loop",
	"outerbay-link",
] as const;
export const RAIL_TEMPLATE_CATEGORIES = ["bay", "interbay", "outerbay", "connector"] as const;
export const OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID = "OPENFAB_COMPACT_AMHS_CLEARANCE_V1" as const;

export type RailTemplateId = (typeof RAIL_TEMPLATE_IDS)[number];
export type RailTemplateIcon = "return-loop" | "bypass" | "bay";
export type RailTemplateCategory = (typeof RAIL_TEMPLATE_CATEGORIES)[number];
export type RailTemplateParameterKey =
	| "runLengthMeters"
	| "laneSpacingMeters"
	| "trunkSpanMeters"
	| "offsetMeters"
	| "aisleLengthMeters"
	| "bayCount"
	| "bayPitchMeters";
export type RailTemplateClearanceProfileId = typeof OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID;
export type RailTemplateAnchorRequirement =
	| "empty-or-open-terminal"
	| "directed-straight-trunk"
	| "free-closed";
export type RailTemplatePlacementCode =
	| "valid"
	| "invalid-parameters"
	| "starter-only"
	| "terminal-only"
	| "wrong-direction"
	| "insufficient-support"
	| "overlap"
	| "topology";
export type RailTemplateNetworkPostcondition =
	| "open-return-hairpin"
	| "tangent-branch-bypass-merge"
	| "closed-strongly-connected-starter"
	| "closed-strongly-connected-pattern";

interface RailTemplateParameterBase {
	readonly templateId: RailTemplateId;
	readonly clearanceProfileId: RailTemplateClearanceProfileId;
}

export interface ReturnLoopTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "return-loop";
	readonly runLengthMeters: number;
	readonly laneSpacingMeters: number;
}

export interface AttachedReturnTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "attached-return";
	readonly runLengthMeters: number;
	readonly laneSpacingMeters: number;
}

export interface BranchBypassTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "branch-bypass";
	readonly trunkSpanMeters: number;
	readonly offsetMeters: number;
}

export interface LongBayTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "long-bay";
	readonly aisleLengthMeters: number;
	readonly laneSpacingMeters: number;
}

export interface PairedBayTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "paired-bay";
	readonly aisleLengthMeters: number;
	readonly laneSpacingMeters: number;
}

export interface NestedBayTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "nested-bay";
	readonly aisleLengthMeters: number;
	readonly laneSpacingMeters: number;
	readonly offsetMeters: number;
}

export interface ShiftBayTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "shift-bay";
	readonly aisleLengthMeters: number;
	readonly laneSpacingMeters: number;
	readonly offsetMeters: number;
}

export interface InterbaySpineTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "interbay-spine";
	readonly bayCount: number;
	readonly bayPitchMeters: number;
	readonly laneSpacingMeters: number;
	readonly aisleLengthMeters: number;
}

export interface OuterLoopTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "outer-loop";
	readonly aisleLengthMeters: number;
	readonly laneSpacingMeters: number;
}

export interface OuterbayLinkTemplateParameters extends RailTemplateParameterBase {
	readonly templateId: "outerbay-link";
	readonly trunkSpanMeters: number;
	readonly offsetMeters: number;
}

export type RailTemplateParameters =
	| ReturnLoopTemplateParameters
	| AttachedReturnTemplateParameters
	| BranchBypassTemplateParameters
	| LongBayTemplateParameters
	| PairedBayTemplateParameters
	| NestedBayTemplateParameters
	| ShiftBayTemplateParameters
	| InterbaySpineTemplateParameters
	| OuterLoopTemplateParameters
	| OuterbayLinkTemplateParameters;

type RailTemplateAttachedBypassParameters =
	| AttachedReturnTemplateParameters
	| BranchBypassTemplateParameters
	| OuterbayLinkTemplateParameters;

export interface RailTemplateParameterDescriptor {
	readonly key: RailTemplateParameterKey;
	readonly label: string;
	readonly unit: "m" | "loop";
	readonly minimum: number;
	readonly maximum: number;
	readonly step: number;
	readonly defaultValue: number;
}

export interface RailTemplateCatalogItem {
	readonly id: RailTemplateId;
	readonly version: number;
	readonly label: string;
	readonly statusLabel: string;
	readonly title: string;
	readonly engineeringSpec: string;
	readonly icon: RailTemplateIcon;
	readonly category: RailTemplateCategory;
	readonly anchorRequirement: RailTemplateAnchorRequirement;
	readonly networkPostcondition: RailTemplateNetworkPostcondition;
	readonly controls: readonly ("rotation" | "flow" | "side" | RailTemplateParameterKey)[];
	readonly parameters: readonly RailTemplateParameterDescriptor[];
	readonly supportedClearanceProfileIds: readonly RailTemplateClearanceProfileId[];
	readonly constituentGrammar: readonly (
		| "straight-1-5m"
		| "r500-turn"
		| "directed-branch"
		| "directed-merge"
	)[];
	readonly repeatPolicy: "single" | "free-anchor" | "compatible-trunk";
}

export interface RailTemplatePose {
	readonly forward: Direction;
	readonly side: RailModuleSide;
	/** Reverse authored travel without rotating or mirroring the footprint. */
	readonly flow?: "forward" | "reverse";
}

export interface RailTemplateTerminal {
	readonly role: "entry" | "exit" | "branch" | "merge" | "starter-origin";
	readonly cell: Cell;
	readonly travelDirection: Direction;
	readonly attachment: "open-terminal" | "straight-trunk" | "free-closed";
}

/** Runtime-only exact route match used to add child routes onto an existing parent motif. */
export interface RailTemplateRouteReuseConnector {
	readonly kind: "route-reuse";
	readonly id: string;
	readonly routeIndex: number;
	readonly handleCell: Cell;
	readonly routeLengthMeters: number;
}

/** Runtime-only tangent span used to compose a catalog motif with an authored trunk. */
export interface RailTemplateSharedTrunkConnector {
	readonly kind: "shared-trunk";
	readonly id: string;
	readonly routeIndex: number | null;
	readonly startCell: Cell;
	readonly endCell: Cell;
	readonly geometricDirection: Direction;
	readonly travelDirection: Direction;
	readonly spanMeters: number;
	readonly minimumOverlapMeters: number;
	readonly supportBeforeMeters: number;
	readonly supportAfterMeters: number;
}

export type RailTemplateCompositionConnector =
	| RailTemplateRouteReuseConnector
	| RailTemplateSharedTrunkConnector;

export interface RailTemplateBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/** Canonical local blueprint: +x is travel-forward and +y is right-hand lateral. */
export interface RailTemplateBlueprint {
	readonly id: RailTemplateId;
	readonly version: number;
	readonly parameters: RailTemplateParameters;
	readonly buildRoutes: readonly (readonly Cell[])[];
	readonly occupiedCells: readonly Cell[];
	readonly hardReservedCells: readonly Cell[];
	readonly displayBounds: RailTemplateBounds;
	readonly terminals: readonly RailTemplateTerminal[];
	readonly compositionConnectors: readonly RailTemplateCompositionConnector[];
	readonly networkPostcondition: RailTemplateNetworkPostcondition;
	readonly constituentGrammar: RailTemplateCatalogItem["constituentGrammar"];
	readonly definitionFingerprint: string;
}

export interface TransformedRailTemplateBlueprint {
	readonly buildRoutes: readonly (readonly Cell[])[];
	readonly occupiedCells: readonly Cell[];
	readonly hardReservedCells: readonly Cell[];
	readonly displayBounds: RailTemplateBounds;
	readonly terminals: readonly RailTemplateTerminal[];
	readonly compositionConnectors: readonly RailTemplateCompositionConnector[];
	readonly geometryFingerprint: string;
}

export interface RailTemplatePlanMetadata {
	readonly id: RailTemplateId;
	readonly version: number;
	readonly label: string;
	readonly pose: RailTemplatePose;
	readonly parameters: RailTemplateParameters;
	readonly anchor: Cell;
	readonly entry: Cell;
	readonly exit: Cell;
	readonly buildRoutes: readonly (readonly Cell[])[];
	readonly occupiedCells: readonly Cell[];
	readonly hardReservedCells: readonly Cell[];
	readonly displayBounds: RailTemplateBounds;
	readonly terminals: readonly RailTemplateTerminal[];
	readonly compositionConnectors: readonly RailTemplateCompositionConnector[];
	readonly constituentGrammar: RailTemplateCatalogItem["constituentGrammar"];
	readonly networkPostcondition: RailTemplateNetworkPostcondition;
	readonly repeatPolicy: RailTemplateCatalogItem["repeatPolicy"];
	readonly placementCode: RailTemplatePlacementCode;
	readonly topologyFingerprint: string;
	readonly geometryFingerprint: string;
	readonly mutationFingerprint: string;
}

export type RailTemplatePlan = RailConstructionPlan & {
	readonly template: RailTemplatePlanMetadata;
};

const CATALOG: readonly RailTemplateCatalogItem[] = Object.freeze([
	templateItem({
		id: "return-loop",
		version: 1,
		label: "TERMINAL U-TURN",
		statusLabel: "열린 끝점 U턴",
		title: "빈 맵 또는 열린 끝점에서 평행 복귀 레인을 갖는 반환 경로를 배치",
		engineeringSpec: "OPEN I/O · 2×R500",
		icon: "return-loop",
		category: "connector",
		anchorRequirement: "empty-or-open-terminal",
		networkPostcondition: "open-return-hairpin",
		controls: ["rotation", "flow", "side", "runLengthMeters", "laneSpacingMeters"],
		parameters: [
			parameter("runLengthMeters", "RUN", 4, 60, 1, 10),
			parameter("laneSpacingMeters", "LANE", 2, 12, 1, 4),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["straight-1-5m", "r500-turn"],
		repeatPolicy: "free-anchor",
	}),
	templateItem({
		id: "attached-return",
		version: 1,
		label: "ATTACHED RETURN LOOP",
		statusLabel: "접선 결합 Return Loop",
		title: "기존 폐쇄 본선에서 분기해 깊게 왕복한 뒤 같은 방향으로 다시 합류",
		engineeringSpec: "B→2×R500→M",
		icon: "return-loop",
		category: "bay",
		anchorRequirement: "directed-straight-trunk",
		networkPostcondition: "tangent-branch-bypass-merge",
		controls: ["rotation", "flow", "side", "runLengthMeters", "laneSpacingMeters"],
		parameters: [
			parameter("runLengthMeters", "RUN", 4, 60, 1, 10),
			parameter("laneSpacingMeters", "MERGE", 4, 12, 1, 4),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["directed-branch", "straight-1-5m", "r500-turn", "directed-merge"],
		repeatPolicy: "compatible-trunk",
	}),
	templateItem({
		id: "branch-bypass",
		version: 1,
		label: "PROCESS BYPASS",
		statusLabel: "접선 결합 Process Bypass",
		title: "기존 단방향 본선에 곡선 분기·합류로 결합하는 공정 우회 루프",
		engineeringSpec: "B→2×R500→M",
		icon: "bypass",
		category: "bay",
		anchorRequirement: "directed-straight-trunk",
		networkPostcondition: "tangent-branch-bypass-merge",
		controls: ["rotation", "flow", "side", "trunkSpanMeters", "offsetMeters"],
		parameters: [
			parameter("trunkSpanMeters", "SPAN", 8, 80, 1, 12),
			parameter("offsetMeters", "OFFSET", 3, 12, 1, 4),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["directed-branch", "straight-1-5m", "r500-turn", "directed-merge"],
		repeatPolicy: "compatible-trunk",
	}),
	templateItem({
		id: "long-bay",
		version: 1,
		label: "PROCESS LOOP",
		statusLabel: "장거리 Process Loop",
		title: "빈 맵에서 시작하는 매개변수형 폐합 단방향 공정 루프",
		engineeringSpec: "CLOSED SCC · 4×R500",
		icon: "bay",
		category: "bay",
		anchorRequirement: "free-closed",
		networkPostcondition: "closed-strongly-connected-starter",
		controls: ["rotation", "flow", "side", "aisleLengthMeters", "laneSpacingMeters"],
		parameters: [
			parameter("aisleLengthMeters", "AISLE", 12, 120, 1, 24),
			parameter("laneSpacingMeters", "LANE", 4, 24, 1, 6),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["straight-1-5m", "r500-turn"],
		repeatPolicy: "free-anchor",
	}),
	templateItem({
		id: "paired-bay",
		version: 1,
		label: "DUAL PROCESS LOOP",
		statusLabel: "결합 Process Loop",
		title: "공통 단방향 본선을 사이에 둔 두 개의 폐합 공정 루프",
		engineeringSpec: "2 LOOPS · 2×B/M",
		icon: "bay",
		category: "bay",
		anchorRequirement: "free-closed",
		networkPostcondition: "closed-strongly-connected-pattern",
		controls: ["rotation", "flow", "side", "aisleLengthMeters", "laneSpacingMeters"],
		parameters: [
			parameter("aisleLengthMeters", "AISLE", 12, 120, 1, 28),
			parameter("laneSpacingMeters", "DEPTH", 4, 24, 1, 8),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["straight-1-5m", "r500-turn", "directed-branch", "directed-merge"],
		repeatPolicy: "free-anchor",
	}),
	templateItem({
		id: "nested-bay",
		version: 1,
		label: "NESTED PROCESS LOOP",
		statusLabel: "내부 Process Loop",
		title: "큰 폐합 루프 내부에 접선 분기·합류 소형 루프를 결합",
		engineeringSpec: "OUTER + INNER SCC",
		icon: "bay",
		category: "bay",
		anchorRequirement: "free-closed",
		networkPostcondition: "closed-strongly-connected-pattern",
		controls: [
			"rotation",
			"flow",
			"side",
			"aisleLengthMeters",
			"laneSpacingMeters",
			"offsetMeters",
		],
		parameters: [
			parameter("aisleLengthMeters", "AISLE", 14, 120, 1, 30),
			parameter("laneSpacingMeters", "OUTER", 8, 30, 1, 14),
			parameter("offsetMeters", "INNER", 3, 24, 1, 6),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["straight-1-5m", "r500-turn", "directed-branch", "directed-merge"],
		repeatPolicy: "free-anchor",
	}),
	templateItem({
		id: "shift-bay",
		version: 1,
		label: "OFFSET PROCESS LOOP",
		statusLabel: "Offset Process Loop",
		title: "왕복 aisle 양쪽에 규격 평행 이동을 포함한 폐합 공정 루프",
		engineeringSpec: "CLOSED · 2×SHIFT",
		icon: "bay",
		category: "bay",
		anchorRequirement: "free-closed",
		networkPostcondition: "closed-strongly-connected-pattern",
		controls: [
			"rotation",
			"flow",
			"side",
			"aisleLengthMeters",
			"laneSpacingMeters",
			"offsetMeters",
		],
		parameters: [
			parameter("aisleLengthMeters", "AISLE", 14, 120, 1, 30),
			parameter("laneSpacingMeters", "LANE", 5, 30, 1, 10),
			parameter("offsetMeters", "SHIFT", 2, 10, 1, 3),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["straight-1-5m", "r500-turn"],
		repeatPolicy: "free-anchor",
	}),
	templateItem({
		id: "interbay-spine",
		version: 2,
		label: "PROCESS LOOP BANK",
		statusLabel: "Process Loop collector",
		title: "공유 collector에 여러 Process Loop를 접선으로 결합",
		engineeringSpec: "N LOOPS · SHARED COLLECTOR",
		icon: "bay",
		category: "interbay",
		anchorRequirement: "free-closed",
		networkPostcondition: "closed-strongly-connected-pattern",
		controls: [
			"rotation",
			"flow",
			"side",
			"bayCount",
			"bayPitchMeters",
			"laneSpacingMeters",
			"aisleLengthMeters",
		],
		parameters: [
			parameter("bayCount", "LOOPS", 2, 10, 1, 3, "loop"),
			parameter("bayPitchMeters", "PITCH", 12, 30, 1, 16),
			parameter("laneSpacingMeters", "DEPTH", 4, 24, 1, 8),
			parameter("aisleLengthMeters", "CORRIDOR", 28, 320, 1, 52),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["straight-1-5m", "r500-turn", "directed-branch", "directed-merge"],
		repeatPolicy: "free-anchor",
	}),
	templateItem({
		id: "outer-loop",
		version: 1,
		label: "OUTER LOOP",
		statusLabel: "Outerbay loop",
		title: "Bay와 interbay를 감싸는 대형 폐합 외곽 순환 루프",
		engineeringSpec: "OUTERBAY · CLOSED SCC",
		icon: "bay",
		category: "outerbay",
		anchorRequirement: "free-closed",
		networkPostcondition: "closed-strongly-connected-pattern",
		controls: ["rotation", "flow", "side", "aisleLengthMeters", "laneSpacingMeters"],
		parameters: [
			parameter("aisleLengthMeters", "LENGTH", 24, 2_000, 1, 80),
			parameter("laneSpacingMeters", "WIDTH", 12, 2_000, 1, 24),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["straight-1-5m", "r500-turn"],
		repeatPolicy: "free-anchor",
	}),
	templateItem({
		id: "outerbay-link",
		version: 1,
		label: "OUTERBAY ATTACH",
		statusLabel: "접선 결합 Outerbay",
		title: "기존 단방향 본선에서 크게 우회해 다시 합류하는 조절형 외곽 순환 루프",
		engineeringSpec: "LARGE B/M LOOP",
		icon: "bypass",
		category: "outerbay",
		anchorRequirement: "directed-straight-trunk",
		networkPostcondition: "tangent-branch-bypass-merge",
		controls: ["rotation", "flow", "side", "trunkSpanMeters", "offsetMeters"],
		parameters: [
			parameter("trunkSpanMeters", "SPAN", 12, 160, 1, 18),
			parameter("offsetMeters", "DEPTH", 12, 120, 1, 24),
		],
		supportedClearanceProfileIds: [OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID],
		constituentGrammar: ["directed-branch", "straight-1-5m", "r500-turn", "directed-merge"],
		repeatPolicy: "compatible-trunk",
	}),
]);

const CATALOG_BY_ID = new Map(CATALOG.map((item) => [item.id, item]));
const RAIL_TEMPLATE_BLUEPRINT_CACHE_LIMIT = 64;
const RAIL_TEMPLATE_BLUEPRINT_CACHE = new Map<string, RailTemplateBlueprint>();

export const RAIL_TEMPLATE_CATALOG = CATALOG;

export function railTemplateCatalogItem(id: RailTemplateId): RailTemplateCatalogItem {
	const item = CATALOG_BY_ID.get(id);
	if (!item) throw new RangeError(`Unknown rail template id: ${id}`);
	return item;
}

export function defaultRailTemplateParameters(id: RailTemplateId): RailTemplateParameters {
	const common = { clearanceProfileId: OPENFAB_TEMPLATE_CLEARANCE_PROFILE_ID } as const;
	if (id === "return-loop" || id === "attached-return") {
		return Object.freeze({
			...common,
			templateId: id,
			runLengthMeters: defaultParameter(id, "runLengthMeters"),
			laneSpacingMeters: defaultParameter(id, "laneSpacingMeters"),
		});
	}
	if (id === "branch-bypass" || id === "outerbay-link") {
		return Object.freeze({
			...common,
			templateId: id,
			trunkSpanMeters: defaultParameter(id, "trunkSpanMeters"),
			offsetMeters: defaultParameter(id, "offsetMeters"),
		});
	}
	if (id === "interbay-spine") {
		return Object.freeze({
			...common,
			templateId: id,
			bayCount: defaultParameter(id, "bayCount"),
			bayPitchMeters: defaultParameter(id, "bayPitchMeters"),
			laneSpacingMeters: defaultParameter(id, "laneSpacingMeters"),
			aisleLengthMeters: defaultParameter(id, "aisleLengthMeters"),
		});
	}
	if (id === "nested-bay" || id === "shift-bay") {
		return Object.freeze({
			...common,
			templateId: id,
			aisleLengthMeters: defaultParameter(id, "aisleLengthMeters"),
			laneSpacingMeters: defaultParameter(id, "laneSpacingMeters"),
			offsetMeters: defaultParameter(id, "offsetMeters"),
		});
	}
	return Object.freeze({
		...common,
		templateId: id,
		aisleLengthMeters: defaultParameter(id, "aisleLengthMeters"),
		laneSpacingMeters: defaultParameter(id, "laneSpacingMeters"),
	});
}

export function initialRailTemplatePose(): RailTemplatePose {
	return Object.freeze({ forward: DIR_E, side: "right", flow: "forward" });
}

export function rotateRailTemplatePose(
	pose: RailTemplatePose,
	quarterTurns: -1 | 1,
): RailTemplatePose {
	return Object.freeze({ ...pose, forward: rotateDirection(pose.forward, quarterTurns) });
}

export function setRailTemplateSide(
	pose: RailTemplatePose,
	side: RailModuleSide,
): RailTemplatePose {
	return Object.freeze({ ...pose, side });
}

export function reverseRailTemplateFlow(pose: RailTemplatePose): RailTemplatePose {
	return Object.freeze({
		...pose,
		flow: pose.flow === "reverse" ? "forward" : "reverse",
	});
}

export function railTemplateTravelDirection(pose: RailTemplatePose): Direction {
	return pose.flow === "reverse" ? oppositeDirection(pose.forward) : pose.forward;
}

export function setRailTemplateParameter(
	id: RailTemplateId,
	parameters: RailTemplateParameters,
	key: RailTemplateParameterKey,
	value: number,
): RailTemplateParameters {
	if (parameters.templateId !== id)
		throw new Error("Rail template parameters do not match the id.");
	if (!Number.isFinite(value)) throw new RangeError("Rail template parameter must be finite.");
	const descriptor = parameterByKey(railTemplateCatalogItem(id), key);
	const normalized = Math.min(
		descriptor.maximum,
		Math.max(descriptor.minimum, Math.round(value / descriptor.step) * descriptor.step),
	);
	const next = { ...parameters, [key]: normalized } as RailTemplateParameters;
	if (next.templateId === "interbay-spine") {
		const minimumCorridor = next.bayCount * next.bayPitchMeters + 4;
		return Object.freeze({
			...next,
			aisleLengthMeters: Math.max(next.aisleLengthMeters, minimumCorridor),
		});
	}
	return Object.freeze(next);
}

export function instantiateRailTemplate(
	id: RailTemplateId,
	parameters: RailTemplateParameters,
): RailTemplateBlueprint {
	const item = railTemplateCatalogItem(id);
	const error = validateParameters(item, parameters);
	if (error) throw new RangeError(error);
	return cachedRailTemplateBlueprint(item, parameters);
}

function cachedRailTemplateBlueprint(
	item: RailTemplateCatalogItem,
	parameters: RailTemplateParameters,
): RailTemplateBlueprint {
	const key = [
		item.id,
		parameters.clearanceProfileId,
		...item.parameters.map((descriptor) => railTemplateParameterValue(parameters, descriptor.key)),
	].join(":");
	const cached = RAIL_TEMPLATE_BLUEPRINT_CACHE.get(key);
	if (cached) {
		RAIL_TEMPLATE_BLUEPRINT_CACHE.delete(key);
		RAIL_TEMPLATE_BLUEPRINT_CACHE.set(key, cached);
		return cached;
	}
	const blueprint = buildRailTemplateBlueprint(item, parameters);
	RAIL_TEMPLATE_BLUEPRINT_CACHE.set(key, blueprint);
	if (RAIL_TEMPLATE_BLUEPRINT_CACHE.size > RAIL_TEMPLATE_BLUEPRINT_CACHE_LIMIT) {
		const oldest = RAIL_TEMPLATE_BLUEPRINT_CACHE.keys().next().value;
		if (oldest !== undefined) RAIL_TEMPLATE_BLUEPRINT_CACHE.delete(oldest);
	}
	return blueprint;
}

function buildRailTemplateBlueprint(
	item: RailTemplateCatalogItem,
	parameters: RailTemplateParameters,
): RailTemplateBlueprint {
	const id = item.id;
	const routeWaypoints = canonicalRouteWaypoints(parameters);
	const buildRoutes = Object.freeze(
		routeWaypoints.map((route) => Object.freeze(pathFromWaypoints(route))),
	);
	const occupiedCells = Object.freeze(uniqueCells(buildRoutes.flat()).map(freezeCell));
	const hardReservedCells = Object.freeze(
		uniqueCells([
			...occupiedCells,
			...(isAttachedBypassParameters(parameters)
				? canonicalBypassTrunkCells(attachedTrunkSpanMeters(parameters))
				: []),
		]).map(freezeCell),
	);
	const terminals = Object.freeze(canonicalTerminals(parameters).map(freezeTerminal));
	const compositionConnectors = Object.freeze(
		canonicalCompositionConnectors(item, parameters, buildRoutes).map(freezeCompositionConnector),
	);
	const blueprintWithoutFingerprint = {
		id,
		version: item.version,
		parameters: Object.freeze({ ...parameters }),
		buildRoutes,
		occupiedCells,
		hardReservedCells,
		displayBounds: boundsOf(occupiedCells),
		terminals,
		compositionConnectors,
		networkPostcondition: item.networkPostcondition,
		constituentGrammar: item.constituentGrammar,
	};
	const definitionFingerprint = checksumTemplateDefinition(blueprintWithoutFingerprint);
	return Object.freeze({ ...blueprintWithoutFingerprint, definitionFingerprint });
}

export function transformRailTemplateBlueprint(
	blueprint: RailTemplateBlueprint,
	anchor: Cell,
	pose: RailTemplatePose,
): TransformedRailTemplateBlueprint {
	assertDirection(pose.forward);
	assertInt32Cell(anchor, "template anchor");
	const transformCell = (cell: Cell): Cell => transformLocalCell(anchor, pose, cell);
	const buildRoutes = Object.freeze(
		blueprint.buildRoutes.map((route) => {
			const transformedRoute = route.map(transformCell);
			if (pose.flow === "reverse") transformedRoute.reverse();
			return Object.freeze(transformedRoute);
		}),
	);
	const occupiedCells = Object.freeze(blueprint.occupiedCells.map(transformCell));
	const hardReservedCells = Object.freeze(blueprint.hardReservedCells.map(transformCell));
	const transformedTerminals = blueprint.terminals.map((terminal) => {
		const transformedDirection = transformLocalDirection(pose, terminal.travelDirection);
		return Object.freeze({
			...terminal,
			role: pose.flow === "reverse" ? reverseTerminalRole(terminal.role) : terminal.role,
			cell: transformCell(terminal.cell),
			travelDirection:
				pose.flow === "reverse" ? oppositeDirection(transformedDirection) : transformedDirection,
		});
	});
	if (pose.flow === "reverse") transformedTerminals.reverse();
	const terminals = Object.freeze(transformedTerminals);
	const compositionConnectors = Object.freeze(
		blueprint.compositionConnectors.map((connector) => {
			if (connector.kind === "route-reuse") {
				const route = buildRoutes[connector.routeIndex];
				return freezeCompositionConnector({
					...connector,
					handleCell: route?.[0] ?? transformCell(connector.handleCell),
				});
			}
			const transformedTravelDirection = transformLocalDirection(pose, connector.travelDirection);
			return freezeCompositionConnector({
				...connector,
				startCell: transformCell(connector.startCell),
				endCell: transformCell(connector.endCell),
				geometricDirection: transformLocalDirection(pose, connector.geometricDirection),
				travelDirection:
					pose.flow === "reverse"
						? oppositeDirection(transformedTravelDirection)
						: transformedTravelDirection,
			});
		}),
	);
	const displayCorners = [
		{ x: blueprint.displayBounds.minX, y: blueprint.displayBounds.minY },
		{ x: blueprint.displayBounds.maxX, y: blueprint.displayBounds.minY },
		{ x: blueprint.displayBounds.maxX, y: blueprint.displayBounds.maxY },
		{ x: blueprint.displayBounds.minX, y: blueprint.displayBounds.maxY },
	].map(transformCell);
	const geometryFingerprint = checksumTransformedGeometry(
		blueprint.definitionFingerprint,
		buildRoutes,
		terminals,
		compositionConnectors,
	);
	return Object.freeze({
		buildRoutes,
		occupiedCells,
		hardReservedCells,
		displayBounds: boundsOf(displayCorners),
		terminals,
		compositionConnectors,
		geometryFingerprint,
	});
}

/** Compose route proposals against a sparse overlay and emit unique, stable mutations. */
export function planRailRouteBatch(
	map: RailMapReader,
	routes: readonly (readonly Cell[])[],
	placement: "connected" | "free-closed-primary" = "connected",
): RailConstructionPlan {
	if (routes.length === 0) {
		return invalidConstruction(map, [], "템플릿에 건설 경로가 없습니다", [], "insufficient-path");
	}
	if (routes.length === 1) {
		return placement === "free-closed-primary"
			? planClosedRailPathComponent(map, routes[0] as readonly Cell[])
			: planRailPath(map, routes[0] as readonly Cell[]);
	}

	const overlay = new MutationRailMap(map);
	const cells = routes.flat();
	const conflicts: Cell[] = [];
	let valid = true;
	let reason = "배치 가능";
	let issueCode: RailConstructionIssueCode | null = null;
	let newEdges = 0;
	let lengthMeters = 0;
	let turns = 0;
	let bend: RailConstructionPlan["bend"] = "horizontal-first";
	for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
		const route = routes[routeIndex] as readonly Cell[];
		const routePlan =
			routeIndex === 0 && placement === "free-closed-primary"
				? planClosedRailPathComponent(overlay, route)
				: planRailPath(overlay, route);
		if (routeIndex === 0) bend = routePlan.bend;
		if (!routePlan.valid && routeAlreadyExists(overlay, route)) continue;
		newEdges += routePlan.newEdges;
		lengthMeters += routePlan.lengthMeters;
		turns += routePlan.turns;
		if (!routePlan.valid) {
			valid = false;
			reason = routePlan.reason;
			issueCode = routePlan.issueCode ?? "topology";
			conflicts.push(...routePlan.conflicts);
			break;
		}
		overlay.apply(routePlan.mutations);
	}
	const mutations = overlay.mutations();
	if (valid && newEdges === 0) {
		valid = false;
		reason = "이미 같은 방향으로 설치된 FAB 패턴입니다";
		issueCode = "duplicate";
	}
	const topologyError = valid ? railMutationTopologyError(map, mutations) : null;
	if (topologyError) {
		valid = false;
		reason = topologyError;
		issueCode = "topology";
	}
	return Object.freeze({
		kind: "build",
		baseRevision: map.getRevision(),
		cells: Object.freeze(cells.map(freezeCell)),
		mutations,
		valid,
		reason,
		issueCode: valid ? null : issueCode,
		conflicts: Object.freeze(uniqueCells(conflicts).map(freezeCell)),
		newEdges,
		lengthMeters,
		turns,
		bend,
	});
}

function routeAlreadyExists(map: RailMapReader, route: readonly Cell[]): boolean {
	if (route.length < 2) return false;
	for (let index = 0; index < route.length - 1; index++) {
		const from = route[index];
		const to = route[index + 1];
		if (!from || !to) return false;
		const direction = directionBetween(from, to);
		if (!direction) return false;
		const fromRail = map.getRail(from.x, from.y);
		const toRail = map.getRail(to.x, to.y);
		if (
			(fromRail.outgoing & direction) === 0 ||
			(toRail.incoming & oppositeDirection(direction)) === 0
		) {
			return false;
		}
	}
	return true;
}

const CLOSED_MOTIF_PROOF_CACHE = new Map<string, string | null>();

/** Prove a free-placement template is a self-contained directed SCC before using the exception. */
function closedMotifProofError(blueprint: RailTemplateBlueprint): string | null {
	const cached = CLOSED_MOTIF_PROOF_CACHE.get(blueprint.definitionFingerprint);
	if (cached !== undefined || CLOSED_MOTIF_PROOF_CACHE.has(blueprint.definitionFingerprint)) {
		return cached ?? null;
	}

	const proofMap = new TileMap();
	const proofPlan = planRailRouteBatch(proofMap, blueprint.buildRoutes, "free-closed-primary");
	let error: string | null = null;
	if (!proofPlan.valid) {
		error = `FAB 패턴 자체 폐합 검증 실패: ${proofPlan.reason}`;
	} else {
		for (const mutation of proofPlan.mutations) {
			proofMap.setEncoded(mutation.x, mutation.y, mutation.after);
		}
		const analysis = analyzeRailNetwork(proofMap);
		if (
			analysis.status !== "closed" ||
			analysis.components !== 1 ||
			analysis.strongComponents !== 1 ||
			analysis.openEnds !== 0 ||
			analysis.unsafeJunctions !== 0
		) {
			error = "FAB 패턴은 단일 방향 폐곡선 네트워크로 자체 완결되어야 합니다";
		}
	}
	CLOSED_MOTIF_PROOF_CACHE.set(blueprint.definitionFingerprint, error);
	return error;
}

/** Build one project-owned motif through ordinary topology and physical-draft validators. */
export function planRailTemplate(
	map: RailMapReader,
	id: RailTemplateId,
	anchor: Cell,
	pose: RailTemplatePose,
	parameters: RailTemplateParameters,
): RailTemplatePlan {
	const item = railTemplateCatalogItem(id);
	const shapeReason = validateParameterShape(item, parameters);
	if (shapeReason) {
		return invalidTemplatePlan(
			map,
			item,
			anchor,
			pose,
			parameters,
			[anchor],
			shapeReason,
			"invalid-parameters",
		);
	}
	let blueprint: RailTemplateBlueprint;
	let transformed: TransformedRailTemplateBlueprint;
	try {
		blueprint = cachedRailTemplateBlueprint(item, parameters);
		transformed = transformRailTemplateBlueprint(blueprint, anchor, pose);
	} catch (error) {
		const reason = error instanceof Error ? error.message : "템플릿 좌표를 만들 수 없습니다";
		return invalidTemplatePlan(
			map,
			item,
			anchor,
			pose,
			parameters,
			[anchor],
			reason,
			"invalid-parameters",
		);
	}

	const construction = planRailRouteBatch(
		map,
		transformed.buildRoutes,
		item.anchorRequirement === "free-closed" ? "free-closed-primary" : "connected",
	);
	let plan = construction;
	const conflicts: Cell[] = [];
	let placementCode = construction.valid
		? ("valid" as const)
		: placementCodeForConstructionIssue(construction.issueCode);
	let templateReason = validateParameterRelationships(parameters);
	if (templateReason) placementCode = "invalid-parameters";
	if (!templateReason && item.anchorRequirement === "free-closed") {
		templateReason = closedMotifProofError(blueprint);
		if (templateReason) placementCode = "topology";
	}
	if (templateReason) conflicts.push(...transformed.hardReservedCells);
	if (
		!templateReason &&
		item.anchorRequirement === "empty-or-open-terminal" &&
		map.edgeCount !== 0
	) {
		const anchorDirection = terminalForwardDirection(map, anchor);
		if (anchorDirection === null) {
			templateReason = "TERMINAL U-TURN은 빈 맵 또는 호환되는 열린 끝점에서만 시작합니다";
			placementCode = "terminal-only";
			conflicts.push(anchor);
		} else if (anchorDirection !== railTemplateTravelDirection(pose)) {
			templateReason = "열린 끝점의 진행 방향에 맞추거나 FLOW를 반전하세요";
			placementCode = "wrong-direction";
			conflicts.push(anchor);
		}
	} else if (!templateReason && isAttachedBypassParameters(parameters)) {
		const trunkConflict = firstInvalidBypassTrunk(
			map,
			anchor,
			pose,
			attachedTrunkSpanMeters(parameters),
		);
		if (trunkConflict) {
			templateReason = "우회 템플릿은 전후 지지 셀을 포함한 단방향 직선 본선에 배치해야 합니다";
			placementCode = trunkConflict.code;
			conflicts.push(trunkConflict.cell);
		}
	}

	const contractError = construction.valid
		? templatePostconditionError(map, blueprint, transformed, construction)
		: null;
	if (!templateReason && contractError) {
		templateReason = contractError;
		placementCode = "topology";
	}
	if (templateReason) {
		plan = invalidateConstruction(construction, templateReason, conflicts, placementCode);
	} else if (construction.valid) {
		plan = Object.freeze({ ...construction, reason: `${item.statusLabel} 배치 가능` });
	}
	return attachTemplateMetadata(
		plan,
		item,
		anchor,
		pose,
		parameters,
		blueprint,
		transformed,
		placementCode,
	);
}

export function isRailTemplatePlan(plan: unknown): plan is RailTemplatePlan {
	return typeof plan === "object" && plan !== null && "template" in plan;
}

function canonicalRouteWaypoints(parameters: RailTemplateParameters): readonly (readonly Cell[])[] {
	if (parameters.templateId === "return-loop") {
		return [
			[
				{ x: 0, y: 0 },
				{ x: parameters.runLengthMeters, y: 0 },
				{ x: parameters.runLengthMeters, y: parameters.laneSpacingMeters },
				{ x: 0, y: parameters.laneSpacingMeters },
			],
		];
	}
	if (parameters.templateId === "attached-return") {
		return [
			[
				{ x: 0, y: 0 },
				{ x: 0, y: parameters.runLengthMeters },
				{ x: parameters.laneSpacingMeters, y: parameters.runLengthMeters },
				{ x: parameters.laneSpacingMeters, y: 0 },
			],
		];
	}
	if (parameters.templateId === "branch-bypass" || parameters.templateId === "outerbay-link") {
		return [
			[
				{ x: 0, y: 0 },
				{ x: 0, y: parameters.offsetMeters },
				{ x: parameters.trunkSpanMeters, y: parameters.offsetMeters },
				{ x: parameters.trunkSpanMeters, y: 0 },
			],
		];
	}
	if (parameters.templateId === "paired-bay") {
		const end = parameters.aisleLengthMeters - 2;
		return [
			closedLoopWaypoints(parameters.aisleLengthMeters, parameters.laneSpacingMeters),
			[
				{ x: 2, y: 0 },
				{ x: 2, y: -parameters.laneSpacingMeters },
				{ x: end, y: -parameters.laneSpacingMeters },
				{ x: end, y: 0 },
			],
		];
	}
	if (parameters.templateId === "nested-bay") {
		const end = parameters.aisleLengthMeters - 2;
		return [
			closedLoopWaypoints(parameters.aisleLengthMeters, parameters.laneSpacingMeters),
			[
				{ x: 2, y: 0 },
				{ x: 2, y: parameters.offsetMeters },
				{ x: end, y: parameters.offsetMeters },
				{ x: end, y: 0 },
			],
		];
	}
	if (parameters.templateId === "shift-bay") {
		const shiftStart = Math.max(3, Math.floor(parameters.aisleLengthMeters / 3));
		return [
			[
				{ x: 0, y: 0 },
				{ x: shiftStart, y: 0 },
				{ x: shiftStart, y: parameters.offsetMeters },
				{ x: parameters.aisleLengthMeters, y: parameters.offsetMeters },
				{
					x: parameters.aisleLengthMeters,
					y: parameters.laneSpacingMeters + parameters.offsetMeters,
				},
				{
					x: shiftStart,
					y: parameters.laneSpacingMeters + parameters.offsetMeters,
				},
				{ x: shiftStart, y: parameters.laneSpacingMeters },
				{ x: 0, y: parameters.laneSpacingMeters },
				{ x: 0, y: 0 },
			],
		];
	}
	if (parameters.templateId === "interbay-spine") {
		const minimumLength = parameters.bayCount * parameters.bayPitchMeters + 4;
		const length = parameters.aisleLengthMeters;
		const bayOffsetMeters = Math.floor((length - minimumLength) / 2);
		const routes: Cell[][] = [closedLoopWaypoints(length, parameters.laneSpacingMeters)];
		for (let bay = 0; bay < parameters.bayCount; bay++) {
			const start = bayOffsetMeters + 2 + bay * parameters.bayPitchMeters;
			const end = start + parameters.bayPitchMeters - 4;
			routes.push([
				{ x: start, y: 0 },
				{ x: start, y: -parameters.laneSpacingMeters },
				{ x: end, y: -parameters.laneSpacingMeters },
				{ x: end, y: 0 },
			]);
		}
		return routes;
	}
	return [closedLoopWaypoints(parameters.aisleLengthMeters, parameters.laneSpacingMeters)];
}

function closedLoopWaypoints(lengthMeters: number, depthMeters: number): Cell[] {
	return [
		{ x: 0, y: 0 },
		{ x: lengthMeters, y: 0 },
		{ x: lengthMeters, y: depthMeters },
		{ x: 0, y: depthMeters },
		{ x: 0, y: 0 },
	];
}

function canonicalTerminals(parameters: RailTemplateParameters): readonly RailTemplateTerminal[] {
	if (parameters.templateId === "return-loop") {
		return [
			{
				role: "entry",
				cell: { x: 0, y: 0 },
				travelDirection: DIR_E,
				attachment: "open-terminal",
			},
			{
				role: "exit",
				cell: { x: 0, y: parameters.laneSpacingMeters },
				travelDirection: DIR_W,
				attachment: "open-terminal",
			},
		];
	}
	if (isAttachedBypassParameters(parameters)) {
		const trunkSpanMeters = attachedTrunkSpanMeters(parameters);
		return [
			{
				role: "branch",
				cell: { x: 0, y: 0 },
				travelDirection: DIR_E,
				attachment: "straight-trunk",
			},
			{
				role: "merge",
				cell: { x: trunkSpanMeters, y: 0 },
				travelDirection: DIR_E,
				attachment: "straight-trunk",
			},
		];
	}
	return [
		{
			role: "starter-origin",
			cell: { x: 0, y: 0 },
			travelDirection: DIR_E,
			attachment: "free-closed",
		},
	];
}

function canonicalCompositionConnectors(
	item: RailTemplateCatalogItem,
	parameters: RailTemplateParameters,
	buildRoutes: readonly (readonly Cell[])[],
): readonly RailTemplateCompositionConnector[] {
	if (item.anchorRequirement === "empty-or-open-terminal") return [];
	if (isAttachedBypassParameters(parameters)) {
		const trunkSpanMeters = attachedTrunkSpanMeters(parameters);
		return [
			{
				kind: "shared-trunk",
				id: "primary-trunk",
				routeIndex: null,
				startCell: { x: 0, y: 0 },
				endCell: { x: trunkSpanMeters, y: 0 },
				geometricDirection: DIR_E,
				travelDirection: DIR_E,
				spanMeters: trunkSpanMeters,
				minimumOverlapMeters: trunkSpanMeters,
				supportBeforeMeters: 2,
				supportAfterMeters: 2,
			},
		];
	}

	const connectors: RailTemplateCompositionConnector[] = [];
	for (let routeIndex = 0; routeIndex < buildRoutes.length; routeIndex++) {
		const route = buildRoutes[routeIndex];
		if (!route || route.length < 2) continue;
		const first = route[0] as Cell;
		const last = route.at(-1) as Cell;
		if (sameCell(first, last)) {
			connectors.push({
				kind: "route-reuse",
				id: `route-${routeIndex}-reuse`,
				routeIndex,
				handleCell: first,
				routeLengthMeters: route.length - 1,
			});
		}
		for (const run of maximalStraightRuns(route)) {
			if (run.spanMeters < 4) continue;
			connectors.push({
				kind: "shared-trunk",
				id: `route-${routeIndex}-run-${run.runIndex}`,
				routeIndex,
				startCell: run.startCell,
				endCell: run.endCell,
				geometricDirection: run.direction,
				travelDirection: run.direction,
				spanMeters: run.spanMeters,
				minimumOverlapMeters: Math.min(4, run.spanMeters),
				supportBeforeMeters: 0,
				supportAfterMeters: 0,
			});
		}
	}
	return connectors;
}

interface CanonicalStraightRun {
	readonly runIndex: number;
	readonly startCell: Cell;
	readonly endCell: Cell;
	readonly direction: Direction;
	readonly spanMeters: number;
}

function maximalStraightRuns(route: readonly Cell[]): CanonicalStraightRun[] {
	const runs: CanonicalStraightRun[] = [];
	let edgeIndex = 0;
	while (edgeIndex < route.length - 1) {
		const startCell = route[edgeIndex] as Cell;
		const firstTarget = route[edgeIndex + 1] as Cell;
		const direction = directionBetween(startCell, firstTarget);
		if (!direction) {
			edgeIndex++;
			continue;
		}
		let endEdgeIndex = edgeIndex + 1;
		while (
			endEdgeIndex < route.length - 1 &&
			directionBetween(route[endEdgeIndex] as Cell, route[endEdgeIndex + 1] as Cell) === direction
		) {
			endEdgeIndex++;
		}
		runs.push(
			Object.freeze({
				runIndex: runs.length,
				startCell,
				endCell: route[endEdgeIndex] as Cell,
				direction,
				spanMeters: endEdgeIndex - edgeIndex,
			}),
		);
		edgeIndex = endEdgeIndex;
	}
	return runs;
}

function canonicalBypassTrunkCells(lengthMeters: number): Cell[] {
	const cells: Cell[] = [];
	for (let x = -1; x <= lengthMeters + 1; x++) cells.push({ x, y: 0 });
	return cells;
}

function isAttachedBypassParameters(
	parameters: RailTemplateParameters,
): parameters is RailTemplateAttachedBypassParameters {
	return (
		parameters.templateId === "attached-return" ||
		parameters.templateId === "branch-bypass" ||
		parameters.templateId === "outerbay-link"
	);
}

function attachedTrunkSpanMeters(parameters: RailTemplateAttachedBypassParameters): number {
	return parameters.templateId === "attached-return"
		? parameters.laneSpacingMeters
		: parameters.trunkSpanMeters;
}

interface BypassTrunkConflict {
	readonly cell: Cell;
	readonly code: "wrong-direction" | "insufficient-support" | "overlap";
}

function firstInvalidBypassTrunk(
	map: RailMapReader,
	anchor: Cell,
	pose: RailTemplatePose,
	lengthMeters: number,
): BypassTrunkConflict | null {
	const travelDirection = railTemplateTravelDirection(pose);
	let overlap: BypassTrunkConflict | null = null;
	let wrongDirection: BypassTrunkConflict | null = null;
	let insufficientSupport: BypassTrunkConflict | null = null;
	for (let distance = -1; distance <= lengthMeters + 1; distance++) {
		const cell = transformLocalCell(anchor, pose, { x: distance, y: 0 });
		const rail = map.getRail(cell.x, cell.y);
		if (
			rail.incoming === oppositeDirection(travelDirection) &&
			rail.outgoing === travelDirection &&
			!map.getAdvancedSwitchOwningCell(cell.x, cell.y)
		) {
			continue;
		}
		if (map.getAdvancedSwitchOwningCell(cell.x, cell.y)) {
			overlap ??= Object.freeze({ cell, code: "overlap" });
			continue;
		}
		if (rail.incoming === travelDirection && rail.outgoing === oppositeDirection(travelDirection)) {
			wrongDirection ??= Object.freeze({ cell, code: "wrong-direction" });
			continue;
		}
		if (rail.incoming === 0 || rail.outgoing === 0) {
			insufficientSupport ??= Object.freeze({ cell, code: "insufficient-support" });
			continue;
		}
		overlap ??= Object.freeze({ cell, code: "overlap" });
	}
	return overlap ?? wrongDirection ?? insufficientSupport;
}

function placementCodeForConstructionIssue(
	issueCode: RailConstructionIssueCode | null | undefined,
): RailTemplatePlacementCode {
	if (issueCode === "duplicate" || issueCode === "reverse-overlap") return "overlap";
	if (issueCode === "reserved-footprint") return "overlap";
	if (issueCode === "disconnected") return "starter-only";
	if (issueCode === "insufficient-path" || issueCode === "non-cardinal") {
		return "invalid-parameters";
	}
	return "topology";
}

function templatePostconditionError(
	map: RailMapReader,
	blueprint: RailTemplateBlueprint,
	transformed: TransformedRailTemplateBlueprint,
	plan: RailConstructionPlan,
): string | null {
	const route = transformed.buildRoutes[0];
	if (!route || route.length < 2) return "템플릿 경로가 비어 있습니다";
	if (blueprint.networkPostcondition === "open-return-hairpin") {
		if (sameCell(route[0] as Cell, route.at(-1) as Cell) || plan.turns !== 2) {
			return "반환 헤어핀은 두 개의 열린 터미널과 두 개의 R500 전환을 가져야 합니다";
		}
	} else if (blueprint.networkPostcondition === "tangent-branch-bypass-merge") {
		if (transformed.terminals.map((terminal) => terminal.role).join(",") !== "branch,merge") {
			return "우회 템플릿은 하나의 곡선 분기와 하나의 곡선 합류를 가져야 합니다";
		}
		const branch = transformed.terminals[0]?.cell;
		const merge = transformed.terminals[1]?.cell;
		const branchRoute = transformed.buildRoutes[0];
		if (!branch || !merge || !branchRoute || branchRoute.length < 3) {
			return "우회 템플릿의 분기·합류 터미널을 계산할 수 없습니다";
		}
		const future = new MutationRailMap(map);
		future.apply(plan.mutations);
		const branchLateral = directionBetween(branchRoute[0] as Cell, branchRoute[1] as Cell);
		const mergeApproach = directionBetween(branchRoute.at(-2) as Cell, branchRoute.at(-1) as Cell);
		const forward = transformed.terminals[0]?.travelDirection;
		if (!branchLateral || !mergeApproach || !forward) {
			return "우회 템플릿의 단방향 진행 방향을 계산할 수 없습니다";
		}
		const branchRail = future.getRail(branch.x, branch.y);
		const mergeRail = future.getRail(merge.x, merge.y);
		if (
			branchRail.incoming !== oppositeDirection(forward) ||
			branchRail.outgoing !== (forward | branchLateral) ||
			mergeRail.incoming !== (oppositeDirection(forward) | oppositeDirection(mergeApproach)) ||
			mergeRail.outgoing !== forward
		) {
			return "우회 템플릿은 접선 분기와 동일 방향 합류 토폴로지를 유지해야 합니다";
		}
	} else if (blueprint.networkPostcondition === "closed-strongly-connected-starter") {
		if (!sameCell(route[0] as Cell, route.at(-1) as Cell) || plan.turns !== 4) {
			return "장거리 Bay 시작 템플릿은 네 개의 R500 전환으로 폐합되어야 합니다";
		}
	} else {
		if (!sameCell(route[0] as Cell, route.at(-1) as Cell)) {
			return "FAB 패턴의 기준 순환로가 폐합되지 않았습니다";
		}
		const parentCells = new Set(route.map((cell) => cellKey(cell.x, cell.y)));
		for (const child of transformed.buildRoutes.slice(1)) {
			const first = child[0];
			const last = child.at(-1);
			if (
				!first ||
				!last ||
				sameCell(first, last) ||
				!parentCells.has(cellKey(first.x, first.y)) ||
				!parentCells.has(cellKey(last.x, last.y))
			) {
				return "추가 Bay 루프는 기준 순환로의 서로 다른 접선 분기·합류점에 연결되어야 합니다";
			}
		}
	}
	return null;
}

function attachTemplateMetadata(
	plan: RailConstructionPlan,
	item: RailTemplateCatalogItem,
	anchor: Cell,
	pose: RailTemplatePose,
	parameters: RailTemplateParameters,
	blueprint: RailTemplateBlueprint,
	transformed: TransformedRailTemplateBlueprint,
	placementCode: RailTemplatePlacementCode,
): RailTemplatePlan {
	const entry = transformed.terminals[0]?.cell ?? transformed.occupiedCells[0] ?? anchor;
	const exit = transformed.terminals.at(-1)?.cell ?? transformed.occupiedCells.at(-1) ?? anchor;
	return Object.freeze({
		...plan,
		template: Object.freeze({
			id: item.id,
			version: item.version,
			label: item.label,
			pose: Object.freeze({ ...pose }),
			parameters: Object.freeze({ ...parameters }),
			anchor: freezeCell(anchor),
			entry: freezeCell(entry),
			exit: freezeCell(exit),
			buildRoutes: transformed.buildRoutes,
			occupiedCells: transformed.occupiedCells,
			hardReservedCells: transformed.hardReservedCells,
			displayBounds: transformed.displayBounds,
			terminals: transformed.terminals,
			compositionConnectors: transformed.compositionConnectors,
			constituentGrammar: item.constituentGrammar,
			networkPostcondition: item.networkPostcondition,
			repeatPolicy: item.repeatPolicy,
			placementCode,
			topologyFingerprint: blueprint.definitionFingerprint,
			geometryFingerprint: transformed.geometryFingerprint,
			mutationFingerprint: checksumMutations(plan),
		}),
	});
}

function invalidTemplatePlan(
	map: RailMapReader,
	item: RailTemplateCatalogItem,
	anchor: Cell,
	pose: RailTemplatePose,
	parameters: RailTemplateParameters,
	conflicts: readonly Cell[],
	reason: string,
	placementCode: RailTemplatePlacementCode,
): RailTemplatePlan {
	const cell = isInt32Cell(anchor) ? freezeCell(anchor) : { x: 0, y: 0 };
	const safeConflicts = conflicts.filter(isInt32Cell);
	const emptyBlueprint: RailTemplateBlueprint = Object.freeze({
		id: item.id,
		version: item.version,
		parameters: Object.freeze({ ...parameters }),
		buildRoutes: Object.freeze([Object.freeze([cell])]),
		occupiedCells: Object.freeze([cell]),
		hardReservedCells: Object.freeze([cell]),
		displayBounds: Object.freeze({ minX: cell.x, minY: cell.y, maxX: cell.x, maxY: cell.y }),
		terminals: Object.freeze([]),
		compositionConnectors: Object.freeze([]),
		networkPostcondition: item.networkPostcondition,
		constituentGrammar: item.constituentGrammar,
		definitionFingerprint: checksumInvalidDefinition(item, parameters),
	});
	const transformed: TransformedRailTemplateBlueprint = Object.freeze({
		buildRoutes: emptyBlueprint.buildRoutes,
		occupiedCells: emptyBlueprint.occupiedCells,
		hardReservedCells: emptyBlueprint.hardReservedCells,
		displayBounds: emptyBlueprint.displayBounds,
		terminals: emptyBlueprint.terminals,
		compositionConnectors: emptyBlueprint.compositionConnectors,
		geometryFingerprint: emptyBlueprint.definitionFingerprint,
	});
	return attachTemplateMetadata(
		invalidConstruction(
			map,
			[cell],
			reason,
			safeConflicts.length > 0 ? safeConflicts : [cell],
			constructionIssueForPlacementCode(placementCode) ?? "topology",
		),
		item,
		cell,
		pose,
		parameters,
		emptyBlueprint,
		transformed,
		placementCode,
	);
}

function invalidConstruction(
	map: RailMapReader,
	cells: readonly Cell[],
	reason: string,
	conflicts: readonly Cell[],
	issueCode: RailConstructionIssueCode = "topology",
): RailConstructionPlan {
	return Object.freeze({
		kind: "build",
		baseRevision: map.getRevision(),
		cells: Object.freeze(cells.map(freezeCell)),
		mutations: Object.freeze([]),
		valid: false,
		reason,
		issueCode,
		conflicts: Object.freeze(conflicts.map(freezeCell)),
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
	});
}

function invalidateConstruction(
	plan: RailConstructionPlan,
	reason: string,
	conflicts: readonly Cell[],
	placementCode: RailTemplatePlacementCode,
): RailConstructionPlan {
	return Object.freeze({
		...plan,
		valid: false,
		reason,
		issueCode: constructionIssueForPlacementCode(placementCode),
		conflicts: Object.freeze(uniqueCells([...plan.conflicts, ...conflicts]).map(freezeCell)),
	});
}

function constructionIssueForPlacementCode(
	placementCode: RailTemplatePlacementCode,
): RailConstructionIssueCode | null {
	if (placementCode === "valid") return null;
	if (placementCode === "invalid-parameters") return "insufficient-path";
	if (
		placementCode === "starter-only" ||
		placementCode === "terminal-only" ||
		placementCode === "insufficient-support"
	) {
		return "disconnected";
	}
	if (placementCode === "wrong-direction") return "reverse-overlap";
	if (placementCode === "overlap") return "reserved-footprint";
	return "topology";
}

function transformLocalCell(origin: Cell, pose: RailTemplatePose, local: Cell): Cell {
	const forwardVector = directionVector(pose.forward);
	const rightVector = directionVector(rotateDirection(pose.forward, 1));
	const sideSign = pose.side === "right" ? 1 : -1;
	const cell = {
		x: origin.x + forwardVector.x * local.x + rightVector.x * local.y * sideSign,
		y: origin.y + forwardVector.y * local.x + rightVector.y * local.y * sideSign,
	};
	assertInt32Cell(cell, "transformed template cell");
	return Object.freeze(cell);
}

function transformLocalDirection(pose: RailTemplatePose, direction: Direction): Direction {
	const vector = directionVector(direction);
	const origin = transformLocalCell({ x: 0, y: 0 }, pose, { x: 0, y: 0 });
	const target = transformLocalCell({ x: 0, y: 0 }, pose, vector);
	const transformed = directionBetween(origin, target);
	if (!transformed) throw new Error("Template direction transform is not cardinal.");
	return transformed;
}

function reverseTerminalRole(role: RailTemplateTerminal["role"]): RailTemplateTerminal["role"] {
	if (role === "entry") return "exit";
	if (role === "exit") return "entry";
	if (role === "branch") return "merge";
	if (role === "merge") return "branch";
	return role;
}

function pathFromWaypoints(waypoints: readonly Cell[]): Cell[] {
	const path: Cell[] = [];
	for (let waypointIndex = 0; waypointIndex < waypoints.length - 1; waypointIndex++) {
		const start = waypoints[waypointIndex] as Cell;
		const end = waypoints[waypointIndex + 1] as Cell;
		const deltaX = end.x - start.x;
		const deltaY = end.y - start.y;
		if (deltaX !== 0 && deltaY !== 0) throw new Error("Template waypoints must be cardinal.");
		const steps = Math.abs(deltaX) + Math.abs(deltaY);
		const stepX = Math.sign(deltaX);
		const stepY = Math.sign(deltaY);
		for (let step = waypointIndex === 0 ? 0 : 1; step <= steps; step++) {
			path.push(Object.freeze({ x: start.x + stepX * step, y: start.y + stepY * step }));
		}
	}
	return path;
}

function validateParameters(
	item: RailTemplateCatalogItem,
	parameters: RailTemplateParameters,
): string | null {
	return validateParameterShape(item, parameters) ?? validateParameterRelationships(parameters);
}

function validateParameterShape(
	item: RailTemplateCatalogItem,
	parameters: RailTemplateParameters,
): string | null {
	if (parameters.templateId !== item.id) return "템플릿 ID와 치수 종류가 일치하지 않습니다";
	if (!item.supportedClearanceProfileIds.includes(parameters.clearanceProfileId)) {
		return "지원되지 않는 OpenFab 레일 여유 프로파일입니다";
	}
	for (const descriptor of item.parameters) {
		const value = railTemplateParameterValue(parameters, descriptor.key);
		if (!Number.isSafeInteger(value)) return `${descriptor.label} 치수는 1 m 정수여야 합니다`;
		if (value < descriptor.minimum || value > descriptor.maximum) {
			return `${descriptor.label} 치수는 ${descriptor.minimum}-${descriptor.maximum} ${descriptor.unit} 범위여야 합니다`;
		}
	}
	return null;
}

function validateParameterRelationships(parameters: RailTemplateParameters): string | null {
	if (
		parameters.templateId === "nested-bay" &&
		parameters.offsetMeters > parameters.laneSpacingMeters - 3
	) {
		return "INNER 치수는 OUTER 레인보다 최소 3 m 안쪽이어야 합니다";
	}
	if (
		parameters.templateId === "shift-bay" &&
		parameters.offsetMeters > parameters.laneSpacingMeters - 2
	) {
		return "SHIFT 치수는 왕복 레인 간격보다 최소 2 m 작아야 합니다";
	}
	if (
		parameters.templateId === "interbay-spine" &&
		parameters.aisleLengthMeters < parameters.bayCount * parameters.bayPitchMeters + 4
	) {
		return "CORRIDOR 길이는 모든 Bay slot과 양끝 여유를 포함해야 합니다";
	}
	return null;
}

export function railTemplateParameterValue(
	parameters: RailTemplateParameters,
	key: RailTemplateParameterKey,
): number {
	const value = (parameters as unknown as Record<string, unknown>)[key];
	return typeof value === "number" ? value : Number.NaN;
}

function checksumTemplateDefinition(
	blueprint: Omit<RailTemplateBlueprint, "definitionFingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		blueprint.id,
		blueprint.parameters.clearanceProfileId,
		blueprint.networkPostcondition,
		...blueprint.constituentGrammar,
		...blueprint.terminals.flatMap((terminal) => [terminal.role, terminal.attachment]),
		...blueprint.compositionConnectors.flatMap((connector) => [connector.kind, connector.id]),
	]);
	checksum.addNumbers([
		blueprint.version,
		...railTemplateCatalogItem(blueprint.id).parameters.map((descriptor) =>
			railTemplateParameterValue(blueprint.parameters, descriptor.key),
		),
		...blueprint.buildRoutes.flatMap((route) => [route.length, ...route.flatMap(cellNumbers)]),
		...blueprint.hardReservedCells.flatMap(cellNumbers),
		...blueprint.terminals.flatMap((terminal) => [
			terminal.cell.x,
			terminal.cell.y,
			terminal.travelDirection,
		]),
		...blueprint.compositionConnectors.flatMap(compositionConnectorNumbers),
	]);
	return checksum.digest();
}

function checksumTransformedGeometry(
	definitionFingerprint: string,
	routes: readonly (readonly Cell[])[],
	terminals: readonly RailTemplateTerminal[],
	compositionConnectors: readonly RailTemplateCompositionConnector[],
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([definitionFingerprint]);
	checksum.addNumbers([
		...routes.flatMap((route) => [route.length, ...route.flatMap(cellNumbers)]),
		...terminals.flatMap((terminal) => [
			terminal.cell.x,
			terminal.cell.y,
			terminal.travelDirection,
		]),
		...compositionConnectors.flatMap(compositionConnectorNumbers),
	]);
	return checksum.digest();
}

function checksumMutations(plan: RailConstructionPlan): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		plan.newEdges,
		plan.turns,
		...plan.mutations.flatMap((mutation) => [
			mutation.x,
			mutation.y,
			mutation.before,
			mutation.after,
		]),
	]);
	return checksum.digest();
}

function checksumInvalidDefinition(
	item: RailTemplateCatalogItem,
	parameters: RailTemplateParameters,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([item.id, "INVALID", parameters.clearanceProfileId]);
	checksum.addNumbers([item.version]);
	return checksum.digest();
}

function templateItem(item: RailTemplateCatalogItem): RailTemplateCatalogItem {
	return Object.freeze({
		...item,
		controls: Object.freeze([...item.controls]),
		parameters: Object.freeze(
			item.parameters.map((descriptor) => Object.freeze({ ...descriptor })),
		),
		supportedClearanceProfileIds: Object.freeze([...item.supportedClearanceProfileIds]),
		constituentGrammar: Object.freeze([...item.constituentGrammar]),
	});
}

function parameter(
	key: RailTemplateParameterKey,
	label: string,
	minimum: number,
	maximum: number,
	step: number,
	defaultValue: number,
	unit: RailTemplateParameterDescriptor["unit"] = "m",
): RailTemplateParameterDescriptor {
	return Object.freeze({ key, label, unit, minimum, maximum, step, defaultValue });
}

function defaultParameter(id: RailTemplateId, key: RailTemplateParameterKey): number {
	return parameterByKey(railTemplateCatalogItem(id), key).defaultValue;
}

function parameterByKey(
	item: RailTemplateCatalogItem,
	key: RailTemplateParameterKey,
): RailTemplateParameterDescriptor {
	const descriptor = item.parameters.find((candidate) => candidate.key === key);
	if (!descriptor) throw new Error(`Rail template ${item.id} does not use parameter ${key}.`);
	return descriptor;
}

function boundsOf(cells: readonly Cell[]): RailTemplateBounds {
	if (cells.length === 0) return Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const cell of cells) {
		minX = Math.min(minX, cell.x);
		minY = Math.min(minY, cell.y);
		maxX = Math.max(maxX, cell.x);
		maxY = Math.max(maxY, cell.y);
	}
	return Object.freeze({ minX, minY, maxX, maxY });
}

function uniqueCells(cells: readonly Cell[]): Cell[] {
	const byKey = new Map<string, Cell>();
	for (const cell of cells) byKey.set(cellKey(cell.x, cell.y), cell);
	return [...byKey.values()];
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}

function freezeTerminal(terminal: RailTemplateTerminal): RailTemplateTerminal {
	return Object.freeze({ ...terminal, cell: freezeCell(terminal.cell) });
}

function freezeCompositionConnector(
	connector: RailTemplateCompositionConnector,
): RailTemplateCompositionConnector {
	if (connector.kind === "route-reuse") {
		return Object.freeze({ ...connector, handleCell: freezeCell(connector.handleCell) });
	}
	return Object.freeze({
		...connector,
		startCell: freezeCell(connector.startCell),
		endCell: freezeCell(connector.endCell),
	});
}

function compositionConnectorNumbers(connector: RailTemplateCompositionConnector): number[] {
	if (connector.kind === "route-reuse") {
		return [
			connector.routeIndex,
			connector.handleCell.x,
			connector.handleCell.y,
			connector.routeLengthMeters,
		];
	}
	return [
		connector.routeIndex ?? -1,
		connector.startCell.x,
		connector.startCell.y,
		connector.endCell.x,
		connector.endCell.y,
		connector.geometricDirection,
		connector.travelDirection,
		connector.spanMeters,
		connector.minimumOverlapMeters,
		connector.supportBeforeMeters,
		connector.supportAfterMeters,
	];
}

function cellNumbers(cell: Cell): number[] {
	return [cell.x, cell.y];
}

function sameCell(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}

function assertInt32Cell(cell: Cell, label: string): void {
	if (!isInt32Cell(cell)) {
		throw new RangeError(`${label} must use signed 32-bit integer coordinates.`);
	}
}

function isInt32Cell(cell: Cell): boolean {
	return (
		Number.isInteger(cell.x) &&
		Number.isInteger(cell.y) &&
		cell.x >= -2_147_483_648 &&
		cell.x <= 2_147_483_647 &&
		cell.y >= -2_147_483_648 &&
		cell.y <= 2_147_483_647
	);
}

function rotateDirection(direction: Direction, quarterTurns: -1 | 1): Direction {
	const directions = [DIR_N, DIR_E, DIR_S, DIR_W] as const;
	const index = directions.indexOf(direction);
	if (index < 0) throw new RangeError(`Invalid cardinal direction ${direction}.`);
	return directions[(index + quarterTurns + directions.length) % directions.length] as Direction;
}

function directionVector(direction: Direction): Cell {
	if (direction === DIR_N) return { x: 0, y: -1 };
	if (direction === DIR_E) return { x: 1, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function assertDirection(direction: Direction): void {
	if (!ALL_DIRECTIONS.includes(direction)) throw new RangeError(`Invalid direction ${direction}.`);
}
