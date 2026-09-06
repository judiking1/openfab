import { analyzeRailNetwork, type RailNetworkAnalysis } from "../core/network";
import {
	materializeClosedPairedRailCorridorRoute,
	planPairedRailCorridor,
} from "../core/PairedRailCorridorPlanner";
import {
	materializePairedRailPerimeterTurnbackRoute,
	type PairedRailPerimeterTurnbackDescriptor,
} from "../core/PairedRailPerimeterPlanner";
import type { RailMutation } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import {
	createRailNetworkLinkAnchorContext,
	planRailNetworkLink,
	type RailNetworkLinkMetadata,
	type RailNetworkLinkPlan,
} from "../core/RailNetworkLinkPlanner";
import {
	type InterbaySpineTemplateParameters,
	type LongBayTemplateParameters,
	type NestedBayTemplateParameters,
	type OuterbayLinkTemplateParameters,
	type OuterLoopTemplateParameters,
	type PairedBayTemplateParameters,
	planRailRouteBatch,
	planRailTemplate,
	type RailTemplateId,
	type RailTemplateParameters,
	type RailTemplatePose,
	type ShiftBayTemplateParameters,
} from "../core/RailTemplateCatalog";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	moveCell,
} from "../core/railShape";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	type StaticFabOrganizationColor,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import { type Cell, decodeRailCell } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import {
	CENTRAL_SPINE_FAB_ASSEMBLY_PLAN_VERSION,
	CENTRAL_SPINE_FAB_MAXIMUM_BAYS,
	CENTRAL_SPINE_FAB_MAXIMUM_DEPTH_METERS,
	CENTRAL_SPINE_FAB_MAXIMUM_FRONTAGE_METERS,
	CENTRAL_SPINE_FAB_MAXIMUM_PITCH_METERS,
	CENTRAL_SPINE_FAB_MINIMUM_BAYS,
	CENTRAL_SPINE_FAB_MINIMUM_DEPTH_METERS,
	CENTRAL_SPINE_FAB_MINIMUM_FRONTAGE_METERS,
	CENTRAL_SPINE_FAB_MINIMUM_PITCH_METERS,
	type CentralSpineFabAssemblyPlan,
	type CentralSpineFabBayPlacement,
	centralSpineFabMinimumPitchMeters,
	createCentralSpineFabAssemblyPlan,
} from "./CentralSpineFabAssemblyPlan";
import {
	createFullFabAssemblyPlan,
	FULL_FAB_ASSEMBLY_PLAN_VERSION,
	FULL_FAB_MAXIMUM_BAYS,
	FULL_FAB_MAXIMUM_DEPTH_METERS,
	FULL_FAB_MAXIMUM_FRONTAGE_METERS,
	FULL_FAB_MAXIMUM_PITCH_METERS,
	FULL_FAB_MINIMUM_BAYS,
	FULL_FAB_MINIMUM_DEPTH_METERS,
	FULL_FAB_MINIMUM_FRONTAGE_METERS,
	FULL_FAB_MINIMUM_PITCH_METERS,
	type FullFabAssemblyPlan,
	type FullFabBayPlacement,
	fullFabMinimumPitchMeters,
} from "./FullFabAssemblyPlan";
import {
	createPairedCirculationFabAssemblyPlan,
	PAIRED_CIRCULATION_FAB_ASSEMBLY_PLAN_VERSION,
	PAIRED_CIRCULATION_FAB_MAXIMUM_BAYS,
	PAIRED_CIRCULATION_FAB_MAXIMUM_DEPTH_METERS,
	PAIRED_CIRCULATION_FAB_MAXIMUM_FRONTAGE_METERS,
	PAIRED_CIRCULATION_FAB_MAXIMUM_PITCH_METERS,
	PAIRED_CIRCULATION_FAB_MINIMUM_BAYS,
	PAIRED_CIRCULATION_FAB_MINIMUM_DEPTH_METERS,
	PAIRED_CIRCULATION_FAB_MINIMUM_FRONTAGE_METERS,
	PAIRED_CIRCULATION_FAB_MINIMUM_PITCH_METERS,
	type PairedCirculationBayPlacement,
	type PairedCirculationCorridorPlan,
	type PairedCirculationFabAssemblyPlan,
	pairedCirculationFabMinimumPitchMeters,
} from "./PairedCirculationFabAssemblyPlan";
import {
	createParallelHallFabAssemblyPlan,
	PARALLEL_HALL_FAB_ASSEMBLY_PLAN_VERSION,
	PARALLEL_HALL_FAB_MAXIMUM_BAYS,
	PARALLEL_HALL_FAB_MAXIMUM_DEPTH_METERS,
	PARALLEL_HALL_FAB_MAXIMUM_FRONTAGE_METERS,
	PARALLEL_HALL_FAB_MAXIMUM_PITCH_METERS,
	PARALLEL_HALL_FAB_MINIMUM_BAYS,
	PARALLEL_HALL_FAB_MINIMUM_DEPTH_METERS,
	PARALLEL_HALL_FAB_MINIMUM_FRONTAGE_METERS,
	PARALLEL_HALL_FAB_MINIMUM_PITCH_METERS,
	type ParallelHallFabAssemblyPlan,
	type ParallelHallFabBayPlacement,
	parallelHallFabMinimumPitchMeters,
} from "./ParallelHallFabAssemblyPlan";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { type CompiledPhysicalLayout, compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	createProductionFabAssemblyPlan,
	PRODUCTION_FAB_ASSEMBLY_PLAN_VERSION,
	PRODUCTION_FAB_MAXIMUM_BANKS,
	PRODUCTION_FAB_MAXIMUM_BAY_PITCH_METERS,
	PRODUCTION_FAB_MAXIMUM_BAYS,
	PRODUCTION_FAB_MINIMUM_BANKS,
	PRODUCTION_FAB_MINIMUM_BAY_PITCH_METERS,
	PRODUCTION_FAB_MINIMUM_BAYS,
	type ProductionFabAssemblyPlan,
	type ProductionFabProcessLoopPlacement,
	productionFabMaximumBayPitchMeters,
} from "./ProductionFabAssemblyPlan";
import { createTopologyOnlyRailDraftPreview, RailDraftEvaluator } from "./RailDraftEvaluator";
import {
	createSyntheticFabAssemblyPlan,
	SYNTHETIC_FAB_ASSEMBLY_PLAN_VERSION,
	type SyntheticFabAssemblyJunctionContract,
	type SyntheticFabAssemblyLinkOperation,
	type SyntheticFabAssemblyPlan,
	type SyntheticFabAssemblyProcessTrunkOperation,
	type SyntheticFabAssemblyRunContract,
} from "./SyntheticFabAssemblyPlan";
import {
	LARGE_FAB_60_TOPOLOGY_SPEC,
	SYNTHETIC_FAB_MAXIMUM_PROCESS_BLOCKS,
	SYNTHETIC_FAB_MINIMUM_PROCESS_BLOCKS,
	syntheticFabTopologyBayCount,
} from "./SyntheticFabTopologySpec";

export const SYNTHETIC_FAB_STARTER_VERSION = 2 as const;
export const SYNTHETIC_FAB_STARTER_IDS = [
	"blank",
	"bay-assembly",
	"bay-bank",
	"paired-circulation-fab-52",
	"full-fab-52",
	"central-spine-fab-24",
	"parallel-hall-fab-12",
	"production-fab-60",
	"single-loop",
	"dual-loop",
	"nested-bay",
	"shift-bay",
	"duplicate-bays",
	"interbay-row",
	"fab-block",
	"complete-fab",
	"large-fab-60",
] as const;

export type SyntheticFabStarterId = (typeof SYNTHETIC_FAB_STARTER_IDS)[number];
export type SyntheticFabStarterParameterKey =
	| "aisleLengthMeters"
	| "laneSpacingMeters"
	| "bayCount"
	| "bayPitchMeters"
	| "outerbayDepthMeters"
	| "processBlockCount";

export interface SyntheticFabStarterParameters {
	readonly aisleLengthMeters: number;
	readonly laneSpacingMeters: number;
	readonly bayCount: number;
	readonly bayPitchMeters: number;
	readonly outerbayDepthMeters: number;
	readonly processBlockCount: number;
}

export interface SyntheticFabStarterRequest {
	readonly version: typeof SYNTHETIC_FAB_STARTER_VERSION;
	readonly id: SyntheticFabStarterId;
	readonly parameters: SyntheticFabStarterParameters;
}

export interface SyntheticFabStarterParameterDescriptor {
	readonly key: SyntheticFabStarterParameterKey;
	readonly label: string;
	readonly unit: "m" | "loop" | "bay" | "bank" | "block";
	readonly minimum: number;
	readonly maximum: number;
	readonly step: number;
}

export interface SyntheticFabStarterCatalogItem {
	readonly id: SyntheticFabStarterId;
	readonly label: string;
	readonly stage: string;
	readonly title: string;
	readonly defaultProjectName: string;
	readonly parameters: readonly SyntheticFabStarterParameterDescriptor[];
	readonly expectedTopology: "empty" | "single-closed-scc" | "separate-closed-sccs";
}

export interface SyntheticFabStarterBuildStep {
	readonly ordinal: number;
	readonly kind: "template" | "paired-corridor" | "paired-turnback" | "network-link";
	readonly templateId: RailTemplateId | "paired-corridor" | "paired-turnback" | "network-link";
	readonly hierarchyRole:
		| "assembly"
		| "process-loop"
		| "process-bay"
		| "bay-bank"
		| "process-wing"
		| "interbay-spine"
		| "wall-circuit"
		| "outer-circulation"
		| "network-link";
	readonly entityId: string | null;
	readonly connectionId: string | null;
	readonly connectionRole: "process-row" | "spine-wall" | "wall-outer" | "outer-turnback" | null;
	readonly bayCount: number;
	readonly bayIds: readonly string[];
	readonly label: string;
	readonly anchor: Cell;
	readonly targetAnchor: Cell | null;
	readonly junctions: SyntheticFabAssemblyJunctionContract | null;
	readonly pose: RailTemplatePose | null;
	readonly addedEdges: number;
	readonly outboundTurns: number | null;
	readonly returnTurns: number | null;
}

interface SyntheticFabTemplateStepMetadata {
	readonly hierarchyRole?: SyntheticFabStarterBuildStep["hierarchyRole"];
	readonly entityId?: string;
	readonly bayCount?: number;
	readonly bayIds?: readonly string[];
	readonly validationMode?: "exact" | "deferred-final";
	readonly organization?: SyntheticFabOrganizationSeedDescriptor;
}

interface SyntheticFabOrganizationSeedDescriptor {
	readonly key: string;
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	readonly parentKeys: readonly string[];
	readonly description: string;
	readonly color: StaticFabOrganizationColor;
}

interface MutableSyntheticFabOrganizationSeed extends SyntheticFabOrganizationSeedDescriptor {
	readonly railEdges: Map<string, DirectedRailEdge>;
}

interface SyntheticFabNetworkLinkStepMetadata {
	readonly connectionId?: string;
	readonly connectionRole?: NonNullable<SyntheticFabStarterBuildStep["connectionRole"]>;
	readonly allowSameComponent?: boolean;
	readonly maximumGapMeters?: number;
	readonly hierarchyRole?: SyntheticFabStarterBuildStep["hierarchyRole"];
	readonly entityId?: string;
	readonly bayCount?: number;
	readonly bayIds?: readonly string[];
	readonly validationMode?: "exact" | "deferred-final";
	readonly organization?: SyntheticFabOrganizationSeedDescriptor;
}

interface SyntheticFabNetworkLinkContract
	extends Pick<SyntheticFabAssemblyLinkOperation, "sourceRun" | "targetRun" | "corridor"> {
	readonly exactJunctions?: SyntheticFabAssemblyJunctionContract;
	readonly expectedOutboundTurns?: number | null;
	readonly expectedReturnTurns?: number | null;
}

export interface SyntheticFabStarterBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly widthMeters: number;
	readonly heightMeters: number;
}

export interface SyntheticFabStarterSummary {
	readonly zoneCount: number;
	readonly bayCount: number;
	readonly railCells: number;
	readonly directedEdges: number;
	readonly physicalPaths: number;
	readonly totalLengthMeters: number;
	readonly junctions: number;
	readonly openTerminals: number;
	readonly strongComponents: number;
	readonly bounds: SyntheticFabStarterBounds | null;
}

export interface SyntheticFabStarterBuild {
	readonly request: SyntheticFabStarterRequest;
	readonly item: SyntheticFabStarterCatalogItem;
	readonly document: RailDocument;
	readonly analysis: RailNetworkAnalysis;
	readonly physical: CompiledPhysicalLayout;
	readonly steps: readonly SyntheticFabStarterBuildStep[];
	readonly summary: SyntheticFabStarterSummary;
	readonly planFingerprint: string | null;
	readonly authoredChecksum: string;
	readonly physicalFingerprint: string;
}

const DEFAULT_PARAMETERS: SyntheticFabStarterParameters = Object.freeze({
	aisleLengthMeters: 48,
	laneSpacingMeters: 10,
	bayCount: 4,
	bayPitchMeters: 20,
	outerbayDepthMeters: 30,
	processBlockCount: 3,
});

const AISLE_LENGTH = parameter("aisleLengthMeters", "BAY LENGTH", 24, 120, 4);
const LANE_SPACING = parameter("laneSpacingMeters", "RAIL SPACING", 6, 24, 1);
const BAY_ASSEMBLY_LENGTH = parameter("aisleLengthMeters", "BAY LENGTH", 64, 240, 4);
const BAY_ASSEMBLY_DEPTH = parameter("laneSpacingMeters", "BAY DEPTH", 24, 60, 2);
const BAY_BANK_COUNT = parameter("bayCount", "BAY COUNT", 2, 8, 1, "bay");
const BAY_BANK_BAY_LENGTH = parameter("aisleLengthMeters", "BAY LENGTH", 64, 224, 4);
const BAY_BANK_PITCH = parameter("bayPitchMeters", "BAY PITCH", 80, 244, 4);
const CENTRAL_SPINE_FAB_TOTAL_BAYS = parameter(
	"bayCount",
	"TOTAL BAYS",
	CENTRAL_SPINE_FAB_MINIMUM_BAYS,
	CENTRAL_SPINE_FAB_MAXIMUM_BAYS,
	1,
	"bay",
);
const CENTRAL_SPINE_FAB_BAY_DEPTH = parameter(
	"aisleLengthMeters",
	"BAY DEPTH",
	CENTRAL_SPINE_FAB_MINIMUM_DEPTH_METERS,
	CENTRAL_SPINE_FAB_MAXIMUM_DEPTH_METERS,
	4,
);
const CENTRAL_SPINE_FAB_BAY_FRONTAGE = parameter(
	"laneSpacingMeters",
	"BAY FRONTAGE",
	CENTRAL_SPINE_FAB_MINIMUM_FRONTAGE_METERS,
	CENTRAL_SPINE_FAB_MAXIMUM_FRONTAGE_METERS,
	4,
);
const CENTRAL_SPINE_FAB_BAY_PITCH = parameter(
	"bayPitchMeters",
	"BAY PITCH",
	CENTRAL_SPINE_FAB_MINIMUM_PITCH_METERS,
	CENTRAL_SPINE_FAB_MAXIMUM_PITCH_METERS,
	4,
);
const PARALLEL_HALL_FAB_TOTAL_BAYS = parameter(
	"bayCount",
	"TOTAL BAYS",
	PARALLEL_HALL_FAB_MINIMUM_BAYS,
	PARALLEL_HALL_FAB_MAXIMUM_BAYS,
	2,
	"bay",
);
const PARALLEL_HALL_FAB_BAY_DEPTH = parameter(
	"aisleLengthMeters",
	"BAY DEPTH",
	PARALLEL_HALL_FAB_MINIMUM_DEPTH_METERS,
	PARALLEL_HALL_FAB_MAXIMUM_DEPTH_METERS,
	4,
);
const PARALLEL_HALL_FAB_BAY_FRONTAGE = parameter(
	"laneSpacingMeters",
	"BAY FRONTAGE",
	PARALLEL_HALL_FAB_MINIMUM_FRONTAGE_METERS,
	PARALLEL_HALL_FAB_MAXIMUM_FRONTAGE_METERS,
	4,
);
const PARALLEL_HALL_FAB_BAY_PITCH = parameter(
	"bayPitchMeters",
	"BAY PITCH",
	PARALLEL_HALL_FAB_MINIMUM_PITCH_METERS,
	PARALLEL_HALL_FAB_MAXIMUM_PITCH_METERS,
	4,
);
const FULL_FAB_TOTAL_BAYS = parameter(
	"bayCount",
	"TOTAL BAYS",
	FULL_FAB_MINIMUM_BAYS,
	FULL_FAB_MAXIMUM_BAYS,
	4,
	"bay",
);
const FULL_FAB_BAY_DEPTH = parameter(
	"aisleLengthMeters",
	"BAY DEPTH",
	FULL_FAB_MINIMUM_DEPTH_METERS,
	FULL_FAB_MAXIMUM_DEPTH_METERS,
	4,
);
const FULL_FAB_BAY_FRONTAGE = parameter(
	"laneSpacingMeters",
	"BAY FRONTAGE",
	FULL_FAB_MINIMUM_FRONTAGE_METERS,
	FULL_FAB_MAXIMUM_FRONTAGE_METERS,
	4,
);
const FULL_FAB_BAY_PITCH = parameter(
	"bayPitchMeters",
	"BAY PITCH",
	FULL_FAB_MINIMUM_PITCH_METERS,
	FULL_FAB_MAXIMUM_PITCH_METERS,
	4,
);
const PAIRED_CIRCULATION_FAB_TOTAL_BAYS = parameter(
	"bayCount",
	"TOTAL BAYS",
	PAIRED_CIRCULATION_FAB_MINIMUM_BAYS,
	PAIRED_CIRCULATION_FAB_MAXIMUM_BAYS,
	4,
	"bay",
);
const PAIRED_CIRCULATION_FAB_BAY_DEPTH = parameter(
	"aisleLengthMeters",
	"BAY DEPTH",
	PAIRED_CIRCULATION_FAB_MINIMUM_DEPTH_METERS,
	PAIRED_CIRCULATION_FAB_MAXIMUM_DEPTH_METERS,
	4,
);
const PAIRED_CIRCULATION_FAB_BAY_FRONTAGE = parameter(
	"laneSpacingMeters",
	"BAY FRONTAGE",
	PAIRED_CIRCULATION_FAB_MINIMUM_FRONTAGE_METERS,
	PAIRED_CIRCULATION_FAB_MAXIMUM_FRONTAGE_METERS,
	4,
);
const PAIRED_CIRCULATION_FAB_BAY_PITCH = parameter(
	"bayPitchMeters",
	"BAY PITCH",
	PAIRED_CIRCULATION_FAB_MINIMUM_PITCH_METERS,
	PAIRED_CIRCULATION_FAB_MAXIMUM_PITCH_METERS,
	4,
);
const PRODUCTION_FAB_TOTAL_BAYS = parameter(
	"bayCount",
	"TOTAL BAYS",
	PRODUCTION_FAB_MINIMUM_BAYS,
	PRODUCTION_FAB_MAXIMUM_BAYS,
	1,
	"bay",
);
const PRODUCTION_FAB_BANKS = parameter(
	"processBlockCount",
	"BAY BANKS",
	PRODUCTION_FAB_MINIMUM_BANKS,
	PRODUCTION_FAB_MAXIMUM_BANKS,
	1,
	"bank",
);
const PRODUCTION_FAB_BAY_PITCH = parameter(
	"bayPitchMeters",
	"BAY PITCH",
	PRODUCTION_FAB_MINIMUM_BAY_PITCH_METERS,
	PRODUCTION_FAB_MAXIMUM_BAY_PITCH_METERS,
	4,
);
const NESTED_LANE_SPACING = parameter("laneSpacingMeters", "OUTER LOOP DEPTH", 8, 24, 1);
const BAY_COUNT = parameter("bayCount", "LOOP COUNT", 2, 6, 1, "loop");
const BAY_PITCH = parameter("bayPitchMeters", "BAY PITCH", 16, 24, 1);
const OUTERBAY_DEPTH = parameter("outerbayDepthMeters", "OUTER LOOP DEPTH", 18, 60, 2);
const COMPLETE_FAB_LANE_SPACING = parameter("laneSpacingMeters", "ZONE DEPTH", 12, 24, 2);
const LARGE_FAB_TOTAL_BAYS = parameter("bayCount", "TOTAL BAYS", 50, 100, 1, "bay");
const LARGE_FAB_BAY_PITCH = parameter("bayPitchMeters", "BAY PITCH", 20, 24, 2);
const LARGE_FAB_PROCESS_BLOCKS = parameter(
	"processBlockCount",
	"PROCESS BLOCKS",
	SYNTHETIC_FAB_MINIMUM_PROCESS_BLOCKS,
	SYNTHETIC_FAB_MAXIMUM_PROCESS_BLOCKS,
	1,
	"block",
);
export const LARGE_FAB_PRESET_WING_BAY_COUNTS = Object.freeze(
	LARGE_FAB_60_TOPOLOGY_SPEC.wings.map((wing) => wing.bayCount),
);
export const LARGE_FAB_PRESET_BAY_COUNT = syntheticFabTopologyBayCount(LARGE_FAB_60_TOPOLOGY_SPEC);

const CATALOG: readonly SyntheticFabStarterCatalogItem[] = Object.freeze([
	starterItem({
		id: "blank",
		label: "EMPTY GRID",
		stage: "START 00",
		title: "빈 1 m 격자에서 직접 시작",
		defaultProjectName: "Untitled FAB",
		parameters: [],
		expectedTopology: "empty",
	}),
	starterItem({
		id: "bay-assembly",
		label: "BAY ASSEMBLY",
		stage: "ASSEMBLY 01",
		title: "큰 외곽 순환 안에 두 개의 긴 Process Loop가 결합된 생산 Bay",
		defaultProjectName: "OpenFab Process Bay",
		parameters: [BAY_ASSEMBLY_LENGTH, BAY_ASSEMBLY_DEPTH],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "bay-bank",
		label: "BAY BANK",
		stage: "ASSEMBLY 02",
		title: "공유 interbay collector에 여러 생산 Bay를 반복 결합한 확장 단위",
		defaultProjectName: "OpenFab Bay Bank",
		parameters: [BAY_BANK_COUNT, BAY_BANK_BAY_LENGTH, BAY_ASSEMBLY_DEPTH, BAY_BANK_PITCH],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "paired-circulation-fab-52",
		label: "52-BAY PAIRED-CIRCULATION FAB",
		stage: "DEFAULT PRODUCTION FAB",
		title:
			"반대 방향 outer lane pair, 2개 paired interbay hall, 4개 Bank, 대형 Single/Twin-loop Bay 52개를 분리된 branch/merge로 조립",
		defaultProjectName: "OpenFab Paired-Circulation FAB",
		parameters: [
			PAIRED_CIRCULATION_FAB_TOTAL_BAYS,
			PAIRED_CIRCULATION_FAB_BAY_DEPTH,
			PAIRED_CIRCULATION_FAB_BAY_FRONTAGE,
			PAIRED_CIRCULATION_FAB_BAY_PITCH,
		],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "full-fab-52",
		label: "52-BAY FULL PRODUCTION FAB",
		stage: "RESEARCH VARIANT 01",
		title:
			"기존 단일 outer circulation 조립을 보존한 비교용 연구 변형: 2개 process hall, 4개 Bank, 52개 Bay",
		defaultProjectName: "OpenFab Full Production FAB",
		parameters: [
			FULL_FAB_TOTAL_BAYS,
			FULL_FAB_BAY_DEPTH,
			FULL_FAB_BAY_FRONTAGE,
			FULL_FAB_BAY_PITCH,
		],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "parallel-hall-fab-12",
		label: "12-BAY PARALLEL PROCESS HALL",
		stage: "PROCESS HALL VARIANT 01",
		title:
			"Full FAB에 반복 배치할 수 있는 단일 공정 홀 연구형: outer, interbay, 북/남 collector와 긴 Process Bay 조립",
		defaultProjectName: "OpenFab Parallel Process Hall",
		parameters: [
			PARALLEL_HALL_FAB_TOTAL_BAYS,
			PARALLEL_HALL_FAB_BAY_DEPTH,
			PARALLEL_HALL_FAB_BAY_FRONTAGE,
			PARALLEL_HALL_FAB_BAY_PITCH,
		],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "central-spine-fab-24",
		label: "24-BAY DENSE CENTRAL-SPINE FAB",
		stage: "DENSE HALL VARIANT 02",
		title: "중앙 interbay spine 양쪽에 Bay와 Process Loop를 밀집 배치한 대안 공정 홀 토폴로지",
		defaultProjectName: "OpenFab Central-Spine Rail Foundation",
		parameters: [
			CENTRAL_SPINE_FAB_TOTAL_BAYS,
			CENTRAL_SPINE_FAB_BAY_DEPTH,
			CENTRAL_SPINE_FAB_BAY_FRONTAGE,
			CENTRAL_SPINE_FAB_BAY_PITCH,
		],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "production-fab-60",
		label: "60-BAY SYNTHETIC STRESS FAB",
		stage: "SCALE STRESS VARIANT 03",
		title:
			"대형 outer circulation과 interbay spine 안에 합성 Bay 50-100개를 조립한 확장·성능 검증용 정적 레일 기반",
		defaultProjectName: "OpenFab 60-Bay Rail Foundation",
		parameters: [PRODUCTION_FAB_TOTAL_BAYS, PRODUCTION_FAB_BANKS, PRODUCTION_FAB_BAY_PITCH],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "single-loop",
		label: "SINGLE PROCESS LOOP",
		stage: "START 01",
		title: "하나의 폐쇄 단방향 Process Loop",
		defaultProjectName: "Synthetic Process Loop",
		parameters: [AISLE_LENGTH, LANE_SPACING],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "dual-loop",
		label: "DUAL PROCESS LOOP",
		stage: "START 02",
		title: "공통 본선을 공유하는 두 Process Loop",
		defaultProjectName: "Synthetic Dual Process Loop",
		parameters: [AISLE_LENGTH, LANE_SPACING],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "nested-bay",
		label: "NESTED PROCESS LOOP",
		stage: "START 03",
		title: "대형 Process Loop 안에 접선형 내부 루프가 결합된 구조",
		defaultProjectName: "Synthetic Nested Process Loop",
		parameters: [AISLE_LENGTH, NESTED_LANE_SPACING],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "shift-bay",
		label: "OFFSET PROCESS LOOP",
		stage: "START 04",
		title: "평행 이동 레일 구간을 포함한 폐쇄 Process Loop",
		defaultProjectName: "Synthetic Offset Process Loop",
		parameters: [AISLE_LENGTH, LANE_SPACING],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "duplicate-bays",
		label: "SEPARATE PROCESS LOOPS",
		stage: "START 05",
		title: "연결 전 두 개의 독립 폐쇄 Process Loop",
		defaultProjectName: "Synthetic Separate Process Loops",
		parameters: [AISLE_LENGTH, LANE_SPACING, BAY_PITCH],
		expectedTopology: "separate-closed-sccs",
	}),
	starterItem({
		id: "interbay-row",
		label: "PROCESS LOOP ROW",
		stage: "START 06",
		title: "반복 Process Loop와 공통 collector",
		defaultProjectName: "Synthetic Process Loop Row",
		parameters: [BAY_COUNT, BAY_PITCH, LANE_SPACING],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "fab-block",
		label: "LEGACY TOPOLOGY BLOCK",
		stage: "START 07",
		title: "호환성 검증용 반복 루프와 공용 순환 합성 토폴로지",
		defaultProjectName: "Synthetic Topology Block",
		parameters: [BAY_COUNT, BAY_PITCH, LANE_SPACING, OUTERBAY_DEPTH],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "complete-fab",
		label: "3-ZONE TOPOLOGY",
		stage: "START 08",
		title: "세 개의 반복 Bay zone 연결을 검증하는 중형 토폴로지 데모",
		defaultProjectName: "Synthetic 3-Zone Topology",
		parameters: [BAY_COUNT, BAY_PITCH, COMPLETE_FAB_LANE_SPACING, OUTERBAY_DEPTH],
		expectedTopology: "single-closed-scc",
	}),
	starterItem({
		id: "large-fab-60",
		label: "LARGE FAB",
		stage: "FAB PRESET 01",
		title:
			"외곽 순환, 중앙 interbay spine, 모든 Bay를 감싸는 단일 공용 내벽 회로와 4방향 gateway로 구성된 50-100 Bay 폐쇄 FAB",
		defaultProjectName: "OpenFab Large FAB",
		parameters: [LARGE_FAB_TOTAL_BAYS, LARGE_FAB_BAY_PITCH, LARGE_FAB_PROCESS_BLOCKS],
		expectedTopology: "single-closed-scc",
	}),
]);

const CATALOG_BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

export const SYNTHETIC_FAB_STARTER_CATALOG = Object.freeze(
	CATALOG.filter(
		(item) =>
			item.id !== "large-fab-60" &&
			item.id !== "paired-circulation-fab-52" &&
			item.id !== "full-fab-52" &&
			item.id !== "parallel-hall-fab-12" &&
			item.id !== "central-spine-fab-24" &&
			item.id !== "production-fab-60",
	),
);
export const SYNTHETIC_FAB_PROJECT_CATALOG = Object.freeze(
	CATALOG.filter(
		(item) => item.id === "blank" || item.id === "bay-assembly" || item.id === "bay-bank",
	),
);
export const SYNTHETIC_FAB_PRESET_CATALOG = Object.freeze(
	CATALOG.filter(
		(item) =>
			item.id === "paired-circulation-fab-52" ||
			item.id === "full-fab-52" ||
			item.id === "parallel-hall-fab-12" ||
			item.id === "central-spine-fab-24" ||
			item.id === "production-fab-60",
	),
);

export function syntheticFabStarterCatalogItem(
	id: SyntheticFabStarterId,
): SyntheticFabStarterCatalogItem {
	const item = CATALOG_BY_ID.get(id);
	if (!item) throw new RangeError(`Unknown synthetic FAB starter id: ${id}`);
	return item;
}

/** Name newly created source from its normalized settings without materializing geometry. */
export function defaultSyntheticFabStarterProjectName(request: SyntheticFabStarterRequest): string {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	return normalized.id === "production-fab-60"
		? `OpenFab ${normalized.parameters.bayCount}-Bay Rail Foundation`
		: syntheticFabStarterCatalogItem(normalized.id).defaultProjectName;
}

export function defaultSyntheticFabStarterRequest(
	id: SyntheticFabStarterId,
): SyntheticFabStarterRequest {
	return Object.freeze({
		version: SYNTHETIC_FAB_STARTER_VERSION,
		id,
		parameters: Object.freeze({
			...DEFAULT_PARAMETERS,
			aisleLengthMeters:
				id === "paired-circulation-fab-52"
					? 104
					: id === "full-fab-52"
						? 104
						: id === "parallel-hall-fab-12"
							? 104
							: id === "central-spine-fab-24"
								? 72
								: id === "bay-assembly" || id === "bay-bank"
									? 96
									: DEFAULT_PARAMETERS.aisleLengthMeters,
			laneSpacingMeters:
				id === "paired-circulation-fab-52"
					? 40
					: id === "full-fab-52"
						? 40
						: id === "parallel-hall-fab-12"
							? 40
							: id === "central-spine-fab-24"
								? 48
								: id === "bay-assembly" || id === "bay-bank"
									? 32
									: id === "complete-fab" || id === "large-fab-60"
										? 16
										: DEFAULT_PARAMETERS.laneSpacingMeters,
			bayCount:
				id === "paired-circulation-fab-52"
					? 52
					: id === "full-fab-52"
						? 52
						: id === "parallel-hall-fab-12"
							? 12
							: id === "central-spine-fab-24"
								? 24
								: id === "production-fab-60"
									? 60
									: id === "large-fab-60"
										? LARGE_FAB_PRESET_BAY_COUNT
										: id === "bay-bank"
											? 4
											: DEFAULT_PARAMETERS.bayCount,
			bayPitchMeters:
				id === "paired-circulation-fab-52"
					? 48
					: id === "full-fab-52"
						? 44
						: id === "parallel-hall-fab-12"
							? 44
							: id === "central-spine-fab-24"
								? 52
								: id === "bay-bank" || id === "production-fab-60"
									? 112
									: DEFAULT_PARAMETERS.bayPitchMeters,
			processBlockCount: id === "production-fab-60" ? 3 : DEFAULT_PARAMETERS.processBlockCount,
		}),
	});
}

export function setSyntheticFabStarterParameter(
	request: SyntheticFabStarterRequest,
	key: SyntheticFabStarterParameterKey,
	value: number,
): SyntheticFabStarterRequest {
	const descriptor = syntheticFabStarterCatalogItem(request.id).parameters.find(
		(candidate) => candidate.key === key,
	);
	if (!descriptor) throw new RangeError(`${key} is not configurable for ${request.id}.`);
	if (!Number.isFinite(value))
		throw new RangeError("Synthetic FAB starter parameters must be finite.");
	const normalized = Math.min(
		descriptor.maximum,
		Math.max(descriptor.minimum, Math.round(value / descriptor.step) * descriptor.step),
	);
	let parameters = Object.freeze({ ...request.parameters, [key]: normalized });
	if (request.id === "bay-bank") {
		const minimumPitch = parameters.aisleLengthMeters + 12;
		parameters = Object.freeze({
			...parameters,
			bayPitchMeters: Math.max(parameters.bayPitchMeters, minimumPitch),
		});
	}
	if (request.id === "production-fab-60") {
		parameters = Object.freeze({
			...parameters,
			bayPitchMeters: Math.min(
				parameters.bayPitchMeters,
				productionFabMaximumBayPitchMeters(parameters.bayCount, parameters.processBlockCount),
			),
		});
	}
	if (request.id === "central-spine-fab-24") {
		parameters = Object.freeze({
			...parameters,
			bayPitchMeters: Math.max(
				parameters.bayPitchMeters,
				centralSpineFabMinimumPitchMeters(parameters.laneSpacingMeters),
			),
		});
	}
	if (request.id === "parallel-hall-fab-12") {
		parameters = Object.freeze({
			...parameters,
			bayPitchMeters: Math.max(
				parameters.bayPitchMeters,
				parallelHallFabMinimumPitchMeters(parameters.laneSpacingMeters),
			),
		});
	}
	if (request.id === "full-fab-52") {
		parameters = Object.freeze({
			...parameters,
			bayPitchMeters: Math.max(
				parameters.bayPitchMeters,
				fullFabMinimumPitchMeters(parameters.laneSpacingMeters),
			),
		});
	}
	if (request.id === "paired-circulation-fab-52") {
		parameters = Object.freeze({
			...parameters,
			bayPitchMeters: Math.max(
				parameters.bayPitchMeters,
				pairedCirculationFabMinimumPitchMeters(parameters.laneSpacingMeters),
			),
		});
	}
	return Object.freeze({
		...request,
		parameters,
	});
}

export function syntheticFabStarterRequestFingerprint(request: SyntheticFabStarterRequest): string {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	const parameters = normalized.parameters;
	return [
		normalized.version,
		normalized.id === "paired-circulation-fab-52"
			? PAIRED_CIRCULATION_FAB_ASSEMBLY_PLAN_VERSION
			: 0,
		normalized.id === "full-fab-52" ? FULL_FAB_ASSEMBLY_PLAN_VERSION : 0,
		normalized.id === "parallel-hall-fab-12" ? PARALLEL_HALL_FAB_ASSEMBLY_PLAN_VERSION : 0,
		normalized.id === "central-spine-fab-24" ? CENTRAL_SPINE_FAB_ASSEMBLY_PLAN_VERSION : 0,
		normalized.id === "production-fab-60" ? PRODUCTION_FAB_ASSEMBLY_PLAN_VERSION : 0,
		normalized.id === "large-fab-60" ? SYNTHETIC_FAB_ASSEMBLY_PLAN_VERSION : 0,
		normalized.id === "large-fab-60" ? LARGE_FAB_60_TOPOLOGY_SPEC.version : 0,
		normalized.id,
		parameters.aisleLengthMeters,
		parameters.laneSpacingMeters,
		parameters.bayCount,
		parameters.bayPitchMeters,
		parameters.outerbayDepthMeters,
		parameters.processBlockCount,
	].join(":");
}

export function syntheticFabStarterAssemblyFingerprint(
	request: SyntheticFabStarterRequest,
): string | null {
	return (
		syntheticFabStarterPairedCirculationAssemblyPlan(request)?.planFingerprint ??
		syntheticFabStarterFullFabAssemblyPlan(request)?.planFingerprint ??
		syntheticFabStarterParallelHallAssemblyPlan(request)?.planFingerprint ??
		syntheticFabStarterCentralSpineAssemblyPlan(request)?.planFingerprint ??
		syntheticFabStarterProductionAssemblyPlan(request)?.planFingerprint ??
		syntheticFabStarterAssemblyPlan(request)?.planFingerprint ??
		null
	);
}

export function syntheticFabStarterPairedCirculationAssemblyPlan(
	request: SyntheticFabStarterRequest,
): PairedCirculationFabAssemblyPlan | null {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	if (normalized.id !== "paired-circulation-fab-52") return null;
	return createPairedCirculationFabAssemblyPlan({
		bayCount: normalized.parameters.bayCount,
		bayDepthMeters: normalized.parameters.aisleLengthMeters,
		bayFrontageMeters: normalized.parameters.laneSpacingMeters,
		bayPitchMeters: normalized.parameters.bayPitchMeters,
	});
}

export function syntheticFabStarterFullFabAssemblyPlan(
	request: SyntheticFabStarterRequest,
): FullFabAssemblyPlan | null {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	if (normalized.id !== "full-fab-52") return null;
	return createFullFabAssemblyPlan({
		bayCount: normalized.parameters.bayCount,
		bayDepthMeters: normalized.parameters.aisleLengthMeters,
		bayFrontageMeters: normalized.parameters.laneSpacingMeters,
		bayPitchMeters: normalized.parameters.bayPitchMeters,
	});
}

export function syntheticFabStarterParallelHallAssemblyPlan(
	request: SyntheticFabStarterRequest,
): ParallelHallFabAssemblyPlan | null {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	if (normalized.id !== "parallel-hall-fab-12") return null;
	return createParallelHallFabAssemblyPlan({
		bayCount: normalized.parameters.bayCount,
		bayDepthMeters: normalized.parameters.aisleLengthMeters,
		bayFrontageMeters: normalized.parameters.laneSpacingMeters,
		bayPitchMeters: normalized.parameters.bayPitchMeters,
	});
}

export function syntheticFabStarterCentralSpineAssemblyPlan(
	request: SyntheticFabStarterRequest,
): CentralSpineFabAssemblyPlan | null {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	if (normalized.id !== "central-spine-fab-24") return null;
	return createCentralSpineFabAssemblyPlan({
		bayCount: normalized.parameters.bayCount,
		bayDepthMeters: normalized.parameters.aisleLengthMeters,
		bayFrontageMeters: normalized.parameters.laneSpacingMeters,
		bayPitchMeters: normalized.parameters.bayPitchMeters,
	});
}

export function syntheticFabStarterProductionAssemblyPlan(
	request: SyntheticFabStarterRequest,
): ProductionFabAssemblyPlan | null {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	if (normalized.id !== "production-fab-60") return null;
	return createProductionFabAssemblyPlan({
		bayCount: normalized.parameters.bayCount,
		bankCount: normalized.parameters.processBlockCount,
		bayPitchMeters: normalized.parameters.bayPitchMeters,
	});
}

export function syntheticFabStarterAssemblyPlan(
	request: SyntheticFabStarterRequest,
): SyntheticFabAssemblyPlan | null {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	if (normalized.id !== "large-fab-60") return null;
	return createSyntheticFabAssemblyPlan(
		{
			processBlockCount: normalized.parameters.processBlockCount,
			totalBayCount: normalized.parameters.bayCount,
		},
		normalized.parameters.bayPitchMeters,
	);
}

/**
 * Build a starter only through the public cardinal template grammar and the ordinary physical gate.
 * The request is runtime input; the resulting document contains no template or starter provenance.
 */
export function buildSyntheticFabStarter(
	request: SyntheticFabStarterRequest,
): SyntheticFabStarterBuild {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	const item = syntheticFabStarterCatalogItem(normalized.id);
	let document = new RailDocument();
	const evaluator = new RailDraftEvaluator();
	const steps: SyntheticFabStarterBuildStep[] = [];
	const organizationSeeds: MutableSyntheticFabOrganizationSeed[] = [];
	let planFingerprint: string | null = null;

	if (normalized.id === "bay-assembly") {
		commitBayAssembly(
			document,
			evaluator,
			steps,
			normalized.parameters,
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right", flow: "forward" },
			"BAY-01",
			"exact",
			organizationSeeds,
		);
	} else if (normalized.id === "bay-bank") {
		commitBayBank(document, evaluator, steps, normalized.parameters, organizationSeeds);
	} else if (normalized.id === "paired-circulation-fab-52") {
		const assembly = createPairedCirculationFabAssemblyPlan({
			bayCount: normalized.parameters.bayCount,
			bayDepthMeters: normalized.parameters.aisleLengthMeters,
			bayFrontageMeters: normalized.parameters.laneSpacingMeters,
			bayPitchMeters: normalized.parameters.bayPitchMeters,
		});
		planFingerprint = assembly.planFingerprint;
		commitPairedCirculationFab(document, evaluator, steps, assembly, organizationSeeds);
	} else if (normalized.id === "full-fab-52") {
		const assembly = createFullFabAssemblyPlan({
			bayCount: normalized.parameters.bayCount,
			bayDepthMeters: normalized.parameters.aisleLengthMeters,
			bayFrontageMeters: normalized.parameters.laneSpacingMeters,
			bayPitchMeters: normalized.parameters.bayPitchMeters,
		});
		planFingerprint = assembly.planFingerprint;
		commitFullFab(document, evaluator, steps, assembly, organizationSeeds);
	} else if (normalized.id === "parallel-hall-fab-12") {
		const assembly = createParallelHallFabAssemblyPlan({
			bayCount: normalized.parameters.bayCount,
			bayDepthMeters: normalized.parameters.aisleLengthMeters,
			bayFrontageMeters: normalized.parameters.laneSpacingMeters,
			bayPitchMeters: normalized.parameters.bayPitchMeters,
		});
		planFingerprint = assembly.planFingerprint;
		commitParallelHallFab(document, evaluator, steps, assembly, organizationSeeds);
	} else if (normalized.id === "central-spine-fab-24") {
		const assembly = createCentralSpineFabAssemblyPlan({
			bayCount: normalized.parameters.bayCount,
			bayDepthMeters: normalized.parameters.aisleLengthMeters,
			bayFrontageMeters: normalized.parameters.laneSpacingMeters,
			bayPitchMeters: normalized.parameters.bayPitchMeters,
		});
		planFingerprint = assembly.planFingerprint;
		commitCentralSpineFab(document, evaluator, steps, assembly, organizationSeeds);
	} else if (normalized.id === "production-fab-60") {
		const assembly = createProductionFabAssemblyPlan({
			bayCount: normalized.parameters.bayCount,
			bankCount: normalized.parameters.processBlockCount,
			bayPitchMeters: normalized.parameters.bayPitchMeters,
		});
		planFingerprint = assembly.planFingerprint;
		commitProductionFab(document, evaluator, steps, assembly, organizationSeeds);
	} else if (normalized.id === "single-loop") {
		commitTemplate(
			document,
			evaluator,
			steps,
			"long-bay",
			"Single closed Bay loop",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right", flow: "forward" },
			longBayParameters(normalized.parameters),
		);
	} else if (normalized.id === "dual-loop") {
		commitTemplate(
			document,
			evaluator,
			steps,
			"paired-bay",
			"Shared-trunk dual Bay",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right", flow: "forward" },
			pairedBayParameters(normalized.parameters),
		);
	} else if (normalized.id === "nested-bay") {
		commitTemplate(
			document,
			evaluator,
			steps,
			"nested-bay",
			"Nested inner-loop Bay",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right", flow: "forward" },
			nestedBayParameters(normalized.parameters),
		);
	} else if (normalized.id === "shift-bay") {
		commitTemplate(
			document,
			evaluator,
			steps,
			"shift-bay",
			"Offset Shift Bay",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right", flow: "forward" },
			shiftBayParameters(normalized.parameters),
		);
	} else if (normalized.id === "duplicate-bays") {
		commitTemplate(
			document,
			evaluator,
			steps,
			"long-bay",
			"First closed Bay loop",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right", flow: "forward" },
			longBayParameters(normalized.parameters),
		);
		commitTemplate(
			document,
			evaluator,
			steps,
			"long-bay",
			"Duplicated closed Bay loop",
			{
				x: 0,
				y: normalized.parameters.laneSpacingMeters + normalized.parameters.bayPitchMeters,
			},
			{ forward: DIR_E, side: "right", flow: "forward" },
			longBayParameters(normalized.parameters),
		);
	} else if (normalized.id === "interbay-row" || normalized.id === "fab-block") {
		const spine = interbayParameters(normalized.parameters);
		commitTemplate(
			document,
			evaluator,
			steps,
			"interbay-spine",
			"Repeated Bay interbay spine",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right", flow: "forward" },
			spine,
		);
		if (normalized.id === "fab-block") {
			const spineLengthMeters = spine.bayCount * spine.bayPitchMeters + 4;
			commitTemplate(
				document,
				evaluator,
				steps,
				"outerbay-link",
				"Outerbay circulation link",
				{ x: spineLengthMeters - 2, y: spine.laneSpacingMeters },
				{ forward: DIR_W, side: "left", flow: "forward" },
				outerbayParameters(normalized.parameters, spineLengthMeters - 4),
			);
		}
	} else if (normalized.id === "complete-fab") {
		const spine = interbayParameters(normalized.parameters);
		const spineLengthMeters = spine.bayCount * spine.bayPitchMeters + 4;
		const zoneGapMeters = 36;
		const zoneOrigins = [
			0,
			spineLengthMeters + zoneGapMeters,
			(spineLengthMeters + zoneGapMeters) * 2,
		];
		for (const [zoneIndex, x] of zoneOrigins.entries()) {
			commitTemplate(
				document,
				evaluator,
				steps,
				"interbay-spine",
				`Bay zone ${zoneIndex + 1} interbay spine`,
				{ x, y: 0 },
				{ forward: DIR_E, side: "right", flow: "forward" },
				spine,
			);
		}
		for (const [zoneIndex, x] of zoneOrigins.entries()) {
			commitTemplate(
				document,
				evaluator,
				steps,
				"outerbay-link",
				`Bay zone ${zoneIndex + 1} outerbay circulation`,
				{
					x: x + spineLengthMeters - 2,
					y: spine.laneSpacingMeters,
				},
				{ forward: DIR_W, side: "left", flow: "forward" },
				outerbayParameters(normalized.parameters, spineLengthMeters - 4),
			);
		}
		const linkAnchorY = Math.floor(spine.laneSpacingMeters / 2);
		for (let zoneIndex = 0; zoneIndex < zoneOrigins.length - 1; zoneIndex++) {
			const source = {
				x: (zoneOrigins[zoneIndex] as number) + spineLengthMeters,
				y: linkAnchorY,
			};
			const target = {
				x: zoneOrigins[zoneIndex + 1] as number,
				y: linkAnchorY,
			};
			commitNetworkLink(
				document,
				evaluator,
				steps,
				`Zone ${zoneIndex + 1}-${zoneIndex + 2} OUTBOUND/RETURN interbay`,
				source,
				target,
			);
		}
	} else if (normalized.id === "large-fab-60") {
		const assembly = createSyntheticFabAssemblyPlan(
			{
				processBlockCount: normalized.parameters.processBlockCount,
				totalBayCount: normalized.parameters.bayCount,
			},
			normalized.parameters.bayPitchMeters,
		);
		planFingerprint = assembly.planFingerprint;
		for (const operation of assembly.operations) {
			if (operation.kind === "circuit") {
				commitTemplate(
					document,
					evaluator,
					steps,
					"outer-loop",
					operation.label,
					operation.loop.origin,
					{ forward: DIR_E, side: "right", flow: operation.loop.flow },
					outerLoopParameters(operation.loop.lengthMeters, operation.loop.depthMeters),
					{
						hierarchyRole: operation.role,
						entityId: operation.id,
						validationMode: "deferred-final",
					},
				);
				continue;
			}
			if (operation.kind === "process-trunk") {
				commitNetworkLink(
					document,
					evaluator,
					steps,
					operation.label,
					operation.sourceRun.anchor,
					operation.targetRun.anchor,
					operation,
					{
						connectionId: operation.id,
						connectionRole: "process-row",
						allowSameComponent: true,
						maximumGapMeters: 512,
						hierarchyRole: "process-wing",
						entityId: operation.wingId,
						bayCount: operation.wing.profile.bayCount,
						bayIds: operation.wing.profile.bays.map((bay) => bay.id),
						validationMode: "deferred-final",
					},
				);
				commitProcessWingBays(document, evaluator, steps, operation);
				continue;
			}

			commitNetworkLink(
				document,
				evaluator,
				steps,
				operation.label,
				operation.sourceRun.anchor,
				operation.targetRun.anchor,
				operation,
				{
					connectionId: operation.id,
					connectionRole: operation.role,
					allowSameComponent: true,
					validationMode: "deferred-final",
				},
			);
		}
	}

	if (organizationSeeds.length > 0) {
		document = RailDocument.fromLoadedMap(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			organizationStateFromSeeds(organizationSeeds),
		);
	}

	const analysis = analyzeRailNetwork(document.map);
	const physical = compilePhysicalRail(document.map);
	const physicalTopology = analyzePhysicalPathTopology(physical.paths);
	assertExpectedTopology(item, analysis, physical, physicalTopology);
	const authoredChecksum = checksumRailMap(
		document.map,
		document.portEquipment,
		document.organizations,
	);
	const physicalFingerprint = checksumRailPhysicalLayout(physical);
	const bounds = document.map.bounds();
	const processWingSteps = steps.filter((step) => step.hierarchyRole === "process-wing");
	const scale =
		normalized.id === "production-fab-60"
			? Object.freeze({
					zoneCount: normalized.parameters.processBlockCount,
					bayCount: normalized.parameters.bayCount,
				})
			: normalized.id === "large-fab-60"
				? Object.freeze({
						zoneCount: processWingSteps.length,
						bayCount: processWingSteps.reduce((total, step) => total + step.bayCount, 0),
					})
				: starterScale(normalized);
	if (
		normalized.id === "large-fab-60" &&
		(scale.zoneCount !== normalized.parameters.processBlockCount * 4 ||
			scale.bayCount !== normalized.parameters.bayCount)
	) {
		throw new Error(`LARGE FAB topology emitted ${scale.zoneCount} Wings / ${scale.bayCount} Bays`);
	}
	if (
		normalized.id === "production-fab-60" &&
		(scale.zoneCount !== normalized.parameters.processBlockCount ||
			scale.bayCount !== normalized.parameters.bayCount)
	) {
		throw new Error(`PRODUCTION FAB emitted ${scale.zoneCount} Bay Banks / ${scale.bayCount} Bays`);
	}
	const summary = Object.freeze({
		zoneCount: scale.zoneCount,
		bayCount: scale.bayCount,
		railCells: analysis.cells,
		directedEdges: analysis.edges,
		physicalPaths: physical.paths.pathCount,
		totalLengthMeters: physical.paths.totalLengthMeters,
		junctions: analysis.junctions,
		openTerminals: analysis.openEnds,
		strongComponents: analysis.strongComponents,
		bounds: bounds
			? Object.freeze({
					...bounds,
					widthMeters: bounds.maxX - bounds.minX,
					heightMeters: bounds.maxY - bounds.minY,
				})
			: null,
	}) satisfies SyntheticFabStarterSummary;

	return Object.freeze({
		request: normalized,
		item,
		document,
		analysis,
		physical,
		steps: Object.freeze(steps),
		summary,
		planFingerprint,
		authoredChecksum,
		physicalFingerprint,
	});
}

export function normalizeSyntheticFabStarterRequest(
	request: SyntheticFabStarterRequest,
): SyntheticFabStarterRequest {
	if (request.version !== SYNTHETIC_FAB_STARTER_VERSION) {
		throw new RangeError("Unsupported synthetic FAB starter version.");
	}
	let normalized = defaultSyntheticFabStarterRequest(request.id);
	for (const descriptor of syntheticFabStarterCatalogItem(request.id).parameters) {
		normalized = setSyntheticFabStarterParameter(
			normalized,
			descriptor.key,
			request.parameters[descriptor.key],
		);
	}
	return normalized;
}

function commitPairedCorridor(
	document: RailDocument,
	steps: SyntheticFabStarterBuildStep[],
	corridor: PairedCirculationCorridorPlan,
	label: string,
	organization: SyntheticFabOrganizationSeedDescriptor,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const geometry = planPairedRailCorridor({
		anchor: corridor.origin,
		lengthMeters: corridor.lengthMeters,
		laneSpacingMeters: corridor.laneSpacingMeters,
		pose: corridor.pose,
	});
	const route = materializeClosedPairedRailCorridorRoute(geometry);
	const plan = planRailRouteBatch(document.map, [route], "free-closed-primary");
	if (!plan.valid) throw new Error(`${label} planning failed: ${plan.reason}`);
	const evaluation = createTopologyOnlyRailDraftPreview(document.map, plan);
	if (!evaluation.valid) {
		throw new Error(`${label} physical evaluation failed: ${evaluation.reason}`);
	}
	if (!document.commit(evaluation.plan)) {
		throw new Error(`${label} could not be committed atomically.`);
	}
	appendOrganizationSeed(
		organizationSeeds,
		organization,
		directedRailEdgesAddedByMutations(plan.mutations),
	);
	steps.push(
		Object.freeze({
			ordinal: steps.length + 1,
			kind: "paired-corridor",
			templateId: "paired-corridor",
			hierarchyRole: "interbay-spine",
			entityId: corridor.id,
			connectionId: null,
			connectionRole: null,
			bayCount: 0,
			bayIds: Object.freeze([]),
			label,
			anchor: Object.freeze({ ...corridor.origin }),
			targetAnchor: null,
			junctions: null,
			pose: Object.freeze({ ...corridor.pose }),
			addedEdges: plan.newEdges,
			outboundTurns: 2,
			returnTurns: 2,
		}),
	);
}

function commitPairedPerimeterTurnback(
	document: RailDocument,
	steps: SyntheticFabStarterBuildStep[],
	turnback: PairedRailPerimeterTurnbackDescriptor,
	organization: SyntheticFabOrganizationSeedDescriptor,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const route = materializePairedRailPerimeterTurnbackRoute(turnback);
	const plan = planRailRouteBatch(document.map, [route]);
	if (!plan.valid) {
		throw new Error(`Outer ${turnback.id} turnback planning failed: ${plan.reason}`);
	}
	const evaluation = createTopologyOnlyRailDraftPreview(document.map, plan);
	if (!evaluation.valid) {
		throw new Error(`Outer ${turnback.id} turnback evaluation failed: ${evaluation.reason}`);
	}
	if (!document.commit(evaluation.plan)) {
		throw new Error(`Outer ${turnback.id} turnback could not be committed atomically.`);
	}
	appendOrganizationSeed(
		organizationSeeds,
		organization,
		directedRailEdgesAddedByMutations(plan.mutations),
	);
	const entityId = `FAB-OUTER-${turnback.id.toUpperCase()}-TURNBACK`;
	steps.push(
		Object.freeze({
			ordinal: steps.length + 1,
			kind: "paired-turnback",
			templateId: "paired-turnback",
			hierarchyRole: "outer-circulation",
			entityId,
			connectionId: turnback.id,
			connectionRole: "outer-turnback",
			bayCount: 0,
			bayIds: Object.freeze([]),
			label: `${turnback.end} outer lane transfer`,
			anchor: Object.freeze({ ...turnback.departure.cell }),
			targetAnchor: Object.freeze({ ...turnback.arrival.cell }),
			junctions: null,
			pose: null,
			addedEdges: plan.newEdges,
			outboundTurns: 0,
			returnTurns: null,
		}),
	);
}

function commitTemplate(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	templateId: RailTemplateId,
	label: string,
	anchor: Cell,
	pose: RailTemplatePose,
	parameters: RailTemplateParameters,
	metadata: SyntheticFabTemplateStepMetadata = {},
	organizationSeeds: MutableSyntheticFabOrganizationSeed[] | null = null,
): void {
	const plan = planRailTemplate(document.map, templateId, anchor, pose, parameters);
	if (!plan.valid) {
		const conflict = plan.conflicts[0];
		throw new Error(
			`${label} planning failed [${plan.template.placementCode}]${conflict ? ` at ${conflict.x},${conflict.y}` : ""}: ${plan.reason}`,
		);
	}
	const evaluation =
		metadata.validationMode === "deferred-final"
			? createTopologyOnlyRailDraftPreview(document.map, plan)
			: evaluator.evaluate(document.map, compilePhysicalRail(document.map), plan);
	if (!evaluation.valid)
		throw new Error(`${label} physical evaluation failed: ${evaluation.reason}`);
	if (!document.commit(evaluation.plan))
		throw new Error(`${label} could not be committed atomically.`);
	if (metadata.organization && organizationSeeds) {
		appendOrganizationSeed(
			organizationSeeds,
			metadata.organization,
			directedRailEdgesAddedByMutations(plan.mutations),
		);
	}
	steps.push(
		Object.freeze({
			ordinal: steps.length + 1,
			kind: "template",
			templateId,
			hierarchyRole: metadata.hierarchyRole ?? "assembly",
			entityId: metadata.entityId ?? null,
			connectionId: null,
			connectionRole: null,
			bayCount: metadata.bayCount ?? 0,
			bayIds: Object.freeze([...(metadata.bayIds ?? [])]),
			label,
			anchor: Object.freeze({ ...anchor }),
			targetAnchor: null,
			junctions: null,
			pose: Object.freeze({ ...pose }),
			addedEdges: plan.newEdges,
			outboundTurns: null,
			returnTurns: null,
		}),
	);
}

function commitNetworkLink(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	label: string,
	sourceAnchor: Cell,
	targetAnchor: Cell,
	contract: SyntheticFabNetworkLinkContract | null = null,
	metadata: SyntheticFabNetworkLinkStepMetadata = {},
	organizationSeeds: MutableSyntheticFabOrganizationSeed[] | null = null,
): RailNetworkLinkPlan {
	const physical =
		metadata.validationMode === "deferred-final" ? null : compilePhysicalRail(document.map);
	const context = createRailNetworkLinkAnchorContext(
		document.map,
		sourceAnchor,
		(candidate) =>
			physical
				? evaluator.evaluate(document.map, physical, candidate).valid
				: createTopologyOnlyRailDraftPreview(document.map, candidate).valid,
		contract ? (candidate) => networkLinkMatchesContract(candidate.networkLink, contract) : null,
		{
			allowSameComponent: metadata.allowSameComponent === true,
			maximumGapMeters: metadata.maximumGapMeters,
		},
	);
	const plan = planRailNetworkLink(document.map, context, targetAnchor);
	if (!plan.valid) {
		const conflict = plan.conflicts[0];
		throw new Error(
			`${label} planning failed [${plan.networkLink.placementCode}]${conflict ? ` at ${conflict.x},${conflict.y}` : ""}: ${plan.reason}`,
		);
	}
	if (contract) assertNetworkLinkContract(label, plan.networkLink, contract);
	const evaluation = physical
		? evaluator.evaluate(document.map, physical, plan)
		: createTopologyOnlyRailDraftPreview(document.map, plan);
	if (!evaluation.valid)
		throw new Error(`${label} physical evaluation failed: ${evaluation.reason}`);
	if (!document.commit(evaluation.plan))
		throw new Error(`${label} could not be committed atomically.`);
	if (metadata.organization && organizationSeeds) {
		appendOrganizationSeed(
			organizationSeeds,
			metadata.organization,
			directedRailEdgesAddedByMutations(plan.mutations),
		);
	}
	const junctions = freezeNetworkLinkJunctions(plan.networkLink);
	steps.push(
		Object.freeze({
			ordinal: steps.length + 1,
			kind: "network-link",
			templateId: "network-link",
			hierarchyRole: metadata.hierarchyRole ?? "network-link",
			entityId: metadata.entityId ?? null,
			connectionId: metadata.connectionId ?? null,
			connectionRole: metadata.connectionRole ?? null,
			bayCount: metadata.bayCount ?? 0,
			bayIds: Object.freeze([...(metadata.bayIds ?? [])]),
			label,
			anchor: Object.freeze({ ...sourceAnchor }),
			targetAnchor: Object.freeze({ ...targetAnchor }),
			junctions,
			pose: null,
			addedEdges: plan.newEdges,
			outboundTurns: cardinalPathTurnCount(plan.networkLink.outboundCells),
			returnTurns: cardinalPathTurnCount(plan.networkLink.returnCells),
		}),
	);
	return plan;
}

function freezeNetworkLinkJunctions(
	link: RailNetworkLinkMetadata,
): SyntheticFabAssemblyJunctionContract {
	if (
		!link.sourceDeparture ||
		!link.sourceArrival ||
		!link.targetArrival ||
		!link.targetDeparture
	) {
		throw new Error("A valid synthetic FAB network link must expose four junction cells.");
	}
	return Object.freeze({
		sourceDeparture: Object.freeze({ ...link.sourceDeparture }),
		sourceArrival: Object.freeze({ ...link.sourceArrival }),
		targetArrival: Object.freeze({ ...link.targetArrival }),
		targetDeparture: Object.freeze({ ...link.targetDeparture }),
	});
}

function commitProcessWingBays(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	operation: SyntheticFabAssemblyProcessTrunkOperation,
): void {
	if (operation.bayPlacements.length !== operation.wing.profile.bays.length) {
		throw new Error(`${operation.label} Bay placement contract is incomplete.`);
	}
	for (const [bayIndex, placement] of operation.bayPlacements.entries()) {
		const bay = operation.wing.profile.bays[bayIndex];
		if (!bay || bay.id !== placement.id) {
			throw new Error(`${operation.label} Bay placement order does not match its topology.`);
		}
		commitTemplate(
			document,
			evaluator,
			steps,
			"branch-bypass",
			`${placement.label} tangent process loop`,
			placement.anchor,
			placement.pose,
			placement.parameters,
			{
				hierarchyRole: "process-bay",
				entityId: bay.id,
				bayCount: 1,
				bayIds: [bay.id],
				validationMode: "deferred-final",
			},
		);
	}
}

function assertNetworkLinkContract(
	label: string,
	link: RailNetworkLinkMetadata,
	contract: SyntheticFabNetworkLinkContract,
): void {
	if (!networkLinkMatchesContract(link, contract)) {
		throw new Error(`${label} connected outside its declared run contract`);
	}
}

function networkLinkMatchesContract(
	link: RailNetworkLinkMetadata,
	contract: SyntheticFabNetworkLinkContract,
): boolean {
	const checks: readonly Readonly<{
		name: string;
		cell: Cell | null;
		run: SyntheticFabAssemblyRunContract;
	}>[] = [
		{
			name: "source departure",
			cell: link.sourceDeparture,
			run: contract.sourceRun,
		},
		{
			name: "source arrival",
			cell: link.sourceArrival,
			run: contract.sourceRun,
		},
		{
			name: "target arrival",
			cell: link.targetArrival,
			run: contract.targetRun,
		},
		{
			name: "target departure",
			cell: link.targetDeparture,
			run: contract.targetRun,
		},
	];
	for (const check of checks) {
		if (!check.cell || !runContractContains(check.run, check.cell)) {
			return false;
		}
	}
	for (const cell of [...link.outboundCells, ...link.returnCells]) {
		if (!corridorContains(contract.corridor, cell)) return false;
	}
	if (
		contract.exactJunctions &&
		(!sameCell(link.sourceDeparture, contract.exactJunctions.sourceDeparture) ||
			!sameCell(link.sourceArrival, contract.exactJunctions.sourceArrival) ||
			!sameCell(link.targetArrival, contract.exactJunctions.targetArrival) ||
			!sameCell(link.targetDeparture, contract.exactJunctions.targetDeparture))
	) {
		return false;
	}
	return (
		link.sourceForward === contract.sourceRun.flowDirection &&
		link.targetForward === contract.targetRun.flowDirection &&
		(contract.expectedOutboundTurns === null ||
			cardinalPathTurnCount(link.outboundCells) === (contract.expectedOutboundTurns ?? 0)) &&
		(contract.expectedReturnTurns === null ||
			cardinalPathTurnCount(link.returnCells) === (contract.expectedReturnTurns ?? 0))
	);
}

function sameCell(actual: Cell | null, expected: Cell): boolean {
	return actual?.x === expected.x && actual.y === expected.y;
}

function cardinalPathTurnCount(cells: readonly Cell[]): number {
	let previousDirection: Direction | null = null;
	let turns = 0;
	for (let index = 1; index < cells.length; index++) {
		const previous = cells[index - 1] as Cell;
		const current = cells[index] as Cell;
		const direction = directionBetween(previous, current);
		if (direction === null) return Number.POSITIVE_INFINITY;
		if (previousDirection !== null && direction !== previousDirection) turns += 1;
		previousDirection = direction;
	}
	return turns;
}

function corridorContains(
	corridor: SyntheticFabNetworkLinkContract["corridor"],
	cell: Cell,
): boolean {
	return (
		cell.x >= corridor.minX &&
		cell.x <= corridor.maxX &&
		cell.y >= corridor.minY &&
		cell.y <= corridor.maxY
	);
}

function runContractContains(contract: SyntheticFabAssemblyRunContract, cell: Cell): boolean {
	const variable = contract.axis === "x" ? cell.x : cell.y;
	const fixed = contract.axis === "x" ? cell.y : cell.x;
	return (
		fixed === contract.fixedCoordinate &&
		variable >= contract.minimum &&
		variable <= contract.maximum
	);
}

function assertExpectedTopology(
	item: SyntheticFabStarterCatalogItem,
	analysis: RailNetworkAnalysis,
	physical: CompiledPhysicalLayout,
	physicalTopology: ReturnType<typeof analyzePhysicalPathTopology>,
): void {
	if (item.expectedTopology === "empty") {
		if (analysis.cells !== 0 || physical.paths.pathCount !== 0 || physicalTopology.paths !== 0) {
			throw new Error("Blank starter must not contain authored or physical rail.");
		}
		return;
	}
	if (item.expectedTopology === "separate-closed-sccs") {
		if (
			analysis.components !== 2 ||
			analysis.strongComponents !== 2 ||
			analysis.openEnds !== 0 ||
			analysis.unsafeJunctions !== 0 ||
			physical.paths.pathCount === 0 ||
			physicalTopology.strongComponents !== 2 ||
			physicalTopology.openPaths !== 0 ||
			physicalTopology.invalidPaths !== 0 ||
			physical.clearance.issues.count !== 0 ||
			!physical.valid ||
			physical.diagnostics.length !== 0
		) {
			throw new Error(
				`${item.label} did not produce two separate physically valid closed networks.`,
			);
		}
		return;
	}
	if (
		analysis.status !== "closed" ||
		!analysis.stronglyConnected ||
		analysis.components !== 1 ||
		analysis.strongComponents !== 1 ||
		analysis.openEnds !== 0 ||
		analysis.unsafeJunctions !== 0 ||
		physical.paths.pathCount === 0 ||
		physicalTopology.strongComponents !== 1 ||
		!physicalTopology.stronglyConnected ||
		physicalTopology.openPaths !== 0 ||
		physicalTopology.invalidPaths !== 0 ||
		physical.clearance.issues.count !== 0 ||
		!physical.valid ||
		physical.diagnostics.length !== 0
	) {
		throw new Error(`${item.label} did not produce one physically valid closed directed network.`);
	}
}

function longBayParameters(parameters: SyntheticFabStarterParameters): LongBayTemplateParameters {
	return Object.freeze({
		templateId: "long-bay",
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
		aisleLengthMeters: parameters.aisleLengthMeters,
		laneSpacingMeters: parameters.laneSpacingMeters,
	});
}

function pairedBayParameters(
	parameters: SyntheticFabStarterParameters,
): PairedBayTemplateParameters {
	return Object.freeze({
		templateId: "paired-bay",
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
		aisleLengthMeters: parameters.aisleLengthMeters,
		laneSpacingMeters: parameters.laneSpacingMeters,
	});
}

function nestedBayParameters(
	parameters: SyntheticFabStarterParameters,
): NestedBayTemplateParameters {
	return Object.freeze({
		templateId: "nested-bay",
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
		aisleLengthMeters: parameters.aisleLengthMeters,
		laneSpacingMeters: parameters.laneSpacingMeters,
		offsetMeters: Math.max(3, Math.min(24, Math.floor(parameters.laneSpacingMeters / 2))),
	});
}

function shiftBayParameters(parameters: SyntheticFabStarterParameters): ShiftBayTemplateParameters {
	return Object.freeze({
		templateId: "shift-bay",
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
		aisleLengthMeters: parameters.aisleLengthMeters,
		laneSpacingMeters: parameters.laneSpacingMeters,
		offsetMeters: Math.max(2, Math.min(10, Math.floor(parameters.laneSpacingMeters / 3))),
	});
}

function interbayParameters(
	parameters: SyntheticFabStarterParameters,
	aisleLengthMeters = parameters.bayCount * parameters.bayPitchMeters + 4,
): InterbaySpineTemplateParameters {
	return Object.freeze({
		templateId: "interbay-spine",
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
		bayCount: parameters.bayCount,
		bayPitchMeters: parameters.bayPitchMeters,
		laneSpacingMeters: parameters.laneSpacingMeters,
		aisleLengthMeters,
	});
}

function outerbayParameters(
	parameters: SyntheticFabStarterParameters,
	trunkSpanMeters: number,
): OuterbayLinkTemplateParameters {
	return Object.freeze({
		templateId: "outerbay-link",
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
		trunkSpanMeters,
		offsetMeters: parameters.outerbayDepthMeters,
	});
}

function outerLoopParameters(
	lengthMeters: number,
	depthMeters: number,
): OuterLoopTemplateParameters {
	return Object.freeze({
		templateId: "outer-loop",
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
		aisleLengthMeters: lengthMeters,
		laneSpacingMeters: depthMeters,
	});
}

function commitBayAssembly(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	parameters: SyntheticFabStarterParameters,
	anchor: Cell,
	pose: RailTemplatePose,
	entityId: string,
	validationMode: SyntheticFabTemplateStepMetadata["validationMode"] = "exact",
	organizationSeeds: MutableSyntheticFabOrganizationSeed[] | null = null,
	parentOrganizationKey: string | null = null,
	plannedProcessLoops: readonly ProductionFabProcessLoopPlacement[] | null = null,
): void {
	const lengthMeters = parameters.aisleLengthMeters;
	const depthMeters = parameters.laneSpacingMeters;
	const endMarginMeters = 6;
	const loopGapMeters = 8;
	const availableSpanMeters = lengthMeters - endMarginMeters * 2 - loopGapMeters;
	const firstSpanMeters = Math.floor(availableSpanMeters / 2);
	const secondSpanMeters = availableSpanMeters - firstSpanMeters;
	const innerDepthMeters = depthMeters - 6;
	if (firstSpanMeters < 12 || secondSpanMeters < 12 || innerDepthMeters < 12) {
		throw new Error("Bay Assembly needs room for two long internal Process Loops.");
	}

	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"Bay circulation envelope",
		anchor,
		pose,
		outerLoopParameters(lengthMeters, depthMeters),
		{
			hierarchyRole: "process-bay",
			entityId,
			bayCount: 1,
			bayIds: [entityId],
			validationMode,
			organization: organizationSeedDescriptor({
				key: entityId,
				kind: "BAY",
				name: entityId,
				parentKeys: parentOrganizationKey ? [parentOrganizationKey] : [],
				description: "Large Bay circulation enclosing two internal Process Loops.",
				color: "TEAL",
			}),
		},
		organizationSeeds,
	);

	const processLoops =
		plannedProcessLoops ??
		Object.freeze([
			Object.freeze({
				id: `${entityId}-PROCESS-LOOP-01`,
				anchor: moveAlongPose(anchor, pose.forward, endMarginMeters),
				pose: Object.freeze({ ...pose, flow: pose.flow ?? "forward" }),
				spanMeters: firstSpanMeters,
				depthMeters: innerDepthMeters,
			}),
			Object.freeze({
				id: `${entityId}-PROCESS-LOOP-02`,
				anchor: moveAlongPose(
					anchor,
					pose.forward,
					endMarginMeters + firstSpanMeters + loopGapMeters,
				),
				pose: Object.freeze({ ...pose, flow: pose.flow ?? "forward" }),
				spanMeters: secondSpanMeters,
				depthMeters: innerDepthMeters,
			}),
		]);
	if (processLoops.length !== 2) {
		throw new Error("Bay Assembly requires exactly two planned Process Loops.");
	}
	for (const [index, loop] of processLoops.entries()) {
		commitTemplate(
			document,
			evaluator,
			steps,
			"outerbay-link",
			`${entityId} Process Loop ${index + 1}`,
			loop.anchor,
			loop.pose,
			Object.freeze({
				templateId: "outerbay-link",
				clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
				trunkSpanMeters: loop.spanMeters,
				offsetMeters: loop.depthMeters,
			}) satisfies OuterbayLinkTemplateParameters,
			{
				hierarchyRole: "process-loop",
				entityId: loop.id,
				bayCount: 1,
				bayIds: [entityId],
				validationMode,
				organization: organizationSeedDescriptor({
					key: loop.id,
					kind: "AISLE",
					name: loop.id,
					parentKeys: [entityId],
					description: `Internal directed Process Loop ${index + 1} of ${entityId}.`,
					color: "AMBER",
				}),
			},
			organizationSeeds,
		);
	}
}

function commitPairedCirculationFab(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	assembly: PairedCirculationFabAssemblyPlan,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const fabOrganization = organizationSeedDescriptor({
		key: "PAIRED-CIRCULATION-FAB",
		kind: "AREA",
		name: "Paired-Circulation Production FAB",
		parentKeys: [],
		description: "Opposed outer lanes serving two paired interbay halls and four Bay Banks.",
		color: "BLUE",
	});
	for (const lane of [assembly.outer.laneA, assembly.outer.laneB]) {
		commitTemplate(
			document,
			evaluator,
			steps,
			"outer-loop",
			lane.id,
			lane.origin,
			lane.pose,
			outerLoopParameters(lane.lengthMeters, lane.depthMeters),
			{
				hierarchyRole: "outer-circulation",
				entityId: lane.id,
				validationMode: "deferred-final",
				organization: fabOrganization,
			},
			organizationSeeds,
		);
	}
	for (const turnback of assembly.outer.turnbacks) {
		commitPairedPerimeterTurnback(document, steps, turnback, fabOrganization, organizationSeeds);
	}
	for (const hall of assembly.halls) {
		commitPairedCorridor(
			document,
			steps,
			hall.interbay,
			`${hall.id} paired interbay`,
			fabOrganization,
			organizationSeeds,
		);
	}

	for (const bank of assembly.banks) {
		appendOrganizationSeed(
			organizationSeeds,
			organizationSeedDescriptor({
				key: bank.id,
				kind: "AREA",
				name: bank.id,
				parentKeys: [fabOrganization.key],
				description: `${bank.side} Bay Bank attached to paired interbay circulation.`,
				color: "CYAN",
			}),
			[],
		);
	}
	for (const gateway of assembly.gateways) {
		commitNetworkLink(
			document,
			evaluator,
			steps,
			gateway.id,
			gateway.sourceAnchor,
			gateway.targetAnchor,
			gateway,
			{
				connectionId: gateway.id,
				connectionRole: "wall-outer",
				allowSameComponent: gateway.allowSameComponent,
				maximumGapMeters: 64,
				hierarchyRole: "network-link",
				entityId: gateway.id,
				validationMode: "deferred-final",
				organization: fabOrganization,
			},
			organizationSeeds,
		);
	}
	for (const bank of assembly.banks) {
		for (const bay of bank.bays) {
			commitPairedCirculationBay(document, evaluator, steps, bay, organizationSeeds);
		}
	}
}

function commitPairedCirculationBay(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	bay: PairedCirculationBayPlacement,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const bayOrganization = organizationSeedDescriptor({
		key: bay.id,
		kind: "BAY",
		name: bay.id,
		parentKeys: [bay.bankId],
		description:
			bay.variant === "single-loop"
				? "Large Bay circulation shell with one full-depth internal Process Loop."
				: "Large Bay circulation shell with two full-depth internal Process Loops.",
		color: "TEAL",
	});
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		`${bay.id} circulation shell`,
		bay.shellAnchor,
		bay.shellPose,
		outerLoopParameters(bay.depthMeters, bay.frontageMeters),
		{
			hierarchyRole: "process-bay",
			entityId: bay.id,
			bayCount: 1,
			bayIds: [bay.id],
			validationMode: "deferred-final",
			organization: bayOrganization,
		},
		organizationSeeds,
	);
	const baySeed = organizationSeeds.find((seed) => seed.key === bay.id);
	if (!baySeed) throw new Error(`${bay.id} organization seed was not created.`);
	appendOrganizationSeed(
		organizationSeeds,
		organizationSeedDescriptor({
			key: bay.bankId,
			kind: "AREA",
			name: bay.bankId,
			parentKeys: ["PAIRED-CIRCULATION-FAB"],
			description: `${bay.side} Bay Bank attached to paired interbay circulation.`,
			color: "CYAN",
		}),
		[...baySeed.railEdges.values()],
	);
	for (const [index, loop] of bay.processLoops.entries()) {
		commitTemplate(
			document,
			evaluator,
			steps,
			"outerbay-link",
			`${bay.id} Process Loop ${index + 1}`,
			loop.anchor,
			loop.pose,
			Object.freeze({
				templateId: "outerbay-link",
				clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
				trunkSpanMeters: loop.spanMeters,
				offsetMeters: loop.depthMeters,
			}) satisfies OuterbayLinkTemplateParameters,
			{
				hierarchyRole: "process-loop",
				entityId: loop.id,
				bayCount: 1,
				bayIds: [bay.id],
				validationMode: "deferred-final",
				organization: organizationSeedDescriptor({
					key: loop.id,
					kind: "AISLE",
					name: loop.id,
					parentKeys: [bay.id],
					description: `Shell-owned internal Process Loop ${index + 1} of ${bay.id}.`,
					color: "AMBER",
				}),
			},
			organizationSeeds,
		);
	}
	commitNetworkLink(
		document,
		evaluator,
		steps,
		bay.gateway.id,
		bay.gateway.sourceAnchor,
		bay.gateway.targetAnchor,
		bay.gateway,
		{
			connectionId: bay.gateway.id,
			connectionRole: "process-row",
			allowSameComponent: false,
			maximumGapMeters: 16,
			hierarchyRole: "network-link",
			entityId: bay.gateway.id,
			validationMode: "deferred-final",
			organization: bayOrganization,
		},
		organizationSeeds,
	);
}

function commitFullFab(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	assembly: FullFabAssemblyPlan,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const fabOrganization = organizationSeedDescriptor({
		key: "FULL-FAB",
		kind: "AREA",
		name: "Full Production FAB",
		parentKeys: [],
		description: "Factory perimeter serving two process halls and four Bay Banks.",
		color: "BLUE",
	});
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"Full FAB outer circulation",
		assembly.outer.origin,
		assembly.outer.pose,
		outerLoopParameters(assembly.outer.lengthMeters, assembly.outer.depthMeters),
		{
			hierarchyRole: "outer-circulation",
			entityId: assembly.outer.id,
			validationMode: "deferred-final",
			organization: fabOrganization,
		},
		organizationSeeds,
	);
	for (const hall of assembly.halls) {
		commitTemplate(
			document,
			evaluator,
			steps,
			"outer-loop",
			`${hall.id} interbay circulation`,
			hall.interbaySpine.origin,
			hall.interbaySpine.pose,
			outerLoopParameters(hall.interbaySpine.lengthMeters, hall.interbaySpine.depthMeters),
			{
				hierarchyRole: "interbay-spine",
				entityId: hall.interbaySpine.id,
				validationMode: "deferred-final",
				organization: fabOrganization,
			},
			organizationSeeds,
		);
	}

	const bankOrganizations = new Map<string, SyntheticFabOrganizationSeedDescriptor>();
	for (const bank of assembly.banks) {
		const bankOrganization = organizationSeedDescriptor({
			key: bank.id,
			kind: "AREA",
			name: bank.id,
			parentKeys: [fabOrganization.key],
			description: `Process Hall ${bank.hallIndex + 1} ${bank.side} Bank collector and Bays.`,
			color: "CYAN",
		});
		bankOrganizations.set(bank.id, bankOrganization);
		commitTemplate(
			document,
			evaluator,
			steps,
			"outer-loop",
			`${bank.id} collector`,
			bank.collector.origin,
			bank.collector.pose,
			outerLoopParameters(bank.collector.lengthMeters, bank.collector.depthMeters),
			{
				hierarchyRole: "bay-bank",
				entityId: bank.id,
				bayCount: bank.bays.length,
				bayIds: bank.bays.map((bay) => bay.id),
				validationMode: "deferred-final",
				organization: bankOrganization,
			},
			organizationSeeds,
		);
	}

	for (const gateway of assembly.gateways) {
		const organization =
			gateway.ownerId === fabOrganization.key
				? fabOrganization
				: bankOrganizations.get(gateway.ownerId);
		if (!organization) throw new Error(`Gateway owner '${gateway.ownerId}' is unavailable.`);
		commitNetworkLink(
			document,
			evaluator,
			steps,
			gateway.id,
			gateway.sourceAnchor,
			gateway.targetAnchor,
			null,
			{
				connectionId: gateway.id,
				connectionRole: gateway.ownerId === fabOrganization.key ? "wall-outer" : "spine-wall",
				allowSameComponent: gateway.allowSameComponent,
				maximumGapMeters: 64,
				hierarchyRole: "network-link",
				entityId: gateway.id,
				validationMode: "deferred-final",
				organization,
			},
			organizationSeeds,
		);
	}

	for (const bank of assembly.banks) {
		for (const bay of bank.bays) {
			commitParallelHallBay(document, evaluator, steps, bay, organizationSeeds, bank.id);
		}
	}
}

function commitParallelHallFab(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	assembly: ParallelHallFabAssemblyPlan,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const fabOrganization = organizationSeedDescriptor({
		key: "PARALLEL-HALL-FAB",
		kind: "AREA",
		name: "Parallel Process Hall",
		parentKeys: [],
		description: "Factory perimeter and central interbay circulation.",
		color: "BLUE",
	});
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"FAB outer circulation",
		assembly.outer.origin,
		assembly.outer.pose,
		outerLoopParameters(assembly.outer.lengthMeters, assembly.outer.depthMeters),
		{
			hierarchyRole: "outer-circulation",
			entityId: assembly.outer.id,
			validationMode: "deferred-final",
			organization: fabOrganization,
		},
		organizationSeeds,
	);
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"Central interbay circulation",
		assembly.interbaySpine.origin,
		assembly.interbaySpine.pose,
		outerLoopParameters(assembly.interbaySpine.lengthMeters, assembly.interbaySpine.depthMeters),
		{
			hierarchyRole: "interbay-spine",
			entityId: assembly.interbaySpine.id,
			validationMode: "deferred-final",
			organization: fabOrganization,
		},
		organizationSeeds,
	);

	const bankOrganizations = new Map<string, SyntheticFabOrganizationSeedDescriptor>();
	for (const bank of assembly.banks) {
		const bankOrganization = organizationSeedDescriptor({
			key: bank.id,
			kind: "AREA",
			name: bank.id,
			parentKeys: [fabOrganization.key],
			description: `${bank.side} production Bank collector and attached Bays.`,
			color: "CYAN",
		});
		bankOrganizations.set(bank.id, bankOrganization);
		commitTemplate(
			document,
			evaluator,
			steps,
			"outer-loop",
			`${bank.id} collector`,
			bank.collector.origin,
			bank.collector.pose,
			outerLoopParameters(bank.collector.lengthMeters, bank.collector.depthMeters),
			{
				hierarchyRole: "bay-bank",
				entityId: bank.id,
				bayCount: bank.bays.length,
				bayIds: bank.bays.map((bay) => bay.id),
				validationMode: "deferred-final",
				organization: bankOrganization,
			},
			organizationSeeds,
		);
	}

	for (const gateway of assembly.gateways) {
		const organization =
			gateway.ownerId === fabOrganization.key
				? fabOrganization
				: bankOrganizations.get(gateway.ownerId);
		if (!organization) throw new Error(`Gateway owner '${gateway.ownerId}' is unavailable.`);
		commitNetworkLink(
			document,
			evaluator,
			steps,
			gateway.id,
			gateway.sourceAnchor,
			gateway.targetAnchor,
			null,
			{
				connectionId: gateway.id,
				connectionRole: gateway.ownerId === fabOrganization.key ? "wall-outer" : "spine-wall",
				allowSameComponent: gateway.id === "EAST-OUTER-GATEWAY",
				maximumGapMeters: 64,
				hierarchyRole: "network-link",
				entityId: gateway.id,
				validationMode: "deferred-final",
				organization,
			},
			organizationSeeds,
		);
	}

	for (const bank of assembly.banks) {
		for (const bay of bank.bays) {
			commitParallelHallBay(document, evaluator, steps, bay, organizationSeeds, bank.id);
		}
	}
}

function commitParallelHallBay(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	bay: ParallelHallFabBayPlacement | FullFabBayPlacement,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
	parentOrganizationKey: string,
): void {
	const bayOrganization = organizationSeedDescriptor({
		key: bay.id,
		kind: "BAY",
		name: bay.id,
		parentKeys: [parentOrganizationKey],
		description: "Production Bay circulation enclosing parallel Process Loops.",
		color: "TEAL",
	});
	commitTemplate(
		document,
		evaluator,
		steps,
		"outerbay-link",
		`${bay.id} circulation loop`,
		bay.anchor,
		bay.pose,
		Object.freeze({
			templateId: "outerbay-link",
			clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
			trunkSpanMeters: bay.frontageMeters,
			offsetMeters: bay.depthMeters,
		}) satisfies OuterbayLinkTemplateParameters,
		{
			hierarchyRole: "process-bay",
			entityId: bay.id,
			bayCount: 1,
			bayIds: [bay.id],
			validationMode: "deferred-final",
			organization: bayOrganization,
		},
		organizationSeeds,
	);
	for (const [index, loop] of bay.processLoops.entries()) {
		commitTemplate(
			document,
			evaluator,
			steps,
			"outerbay-link",
			`${bay.id} Process Loop ${index + 1}`,
			loop.anchor,
			loop.pose,
			Object.freeze({
				templateId: "outerbay-link",
				clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
				trunkSpanMeters: loop.frontageMeters,
				offsetMeters: loop.depthMeters,
			}) satisfies OuterbayLinkTemplateParameters,
			{
				hierarchyRole: "process-loop",
				entityId: loop.id,
				bayCount: 1,
				bayIds: [bay.id],
				validationMode: "deferred-final",
				organization: organizationSeedDescriptor({
					key: loop.id,
					kind: "AISLE",
					name: loop.id,
					parentKeys: [bay.id],
					description: `Slender full-depth Process Loop ${index + 1} of ${bay.id}.`,
					color: "AMBER",
				}),
			},
			organizationSeeds,
		);
	}
}

function commitCentralSpineFab(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	assembly: CentralSpineFabAssemblyPlan,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const fabOrganizationKey = "CENTRAL-SPINE-FAB";
	const fabOrganization = organizationSeedDescriptor({
		key: fabOrganizationKey,
		kind: "AREA",
		name: "Central-Spine FAB",
		parentKeys: [],
		description: "Factory-wide outer circulation and central interbay transport spine.",
		color: "BLUE",
	});
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"FAB outer circulation",
		assembly.outer.origin,
		assembly.outer.pose,
		outerLoopParameters(assembly.outer.lengthMeters, assembly.outer.depthMeters),
		{
			hierarchyRole: "outer-circulation",
			entityId: assembly.outer.id,
			validationMode: "deferred-final",
			organization: fabOrganization,
		},
		organizationSeeds,
	);
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"Central interbay spine",
		assembly.interbaySpine.origin,
		assembly.interbaySpine.pose,
		outerLoopParameters(assembly.interbaySpine.lengthMeters, assembly.interbaySpine.depthMeters),
		{
			hierarchyRole: "interbay-spine",
			entityId: assembly.interbaySpine.id,
			validationMode: "deferred-final",
			organization: fabOrganization,
		},
		organizationSeeds,
	);

	for (const bank of assembly.banks) {
		for (const bay of bank.bays) {
			commitCentralSpineBay(document, evaluator, steps, bay, organizationSeeds, fabOrganizationKey);
		}
	}
}

function commitCentralSpineBay(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	bay: CentralSpineFabBayPlacement,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
	parentOrganizationKey: string,
): void {
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		`${bay.id} circulation envelope`,
		bay.anchor,
		bay.pose,
		outerLoopParameters(bay.frontageMeters, bay.depthMeters),
		{
			hierarchyRole: "process-bay",
			entityId: bay.id,
			bayCount: 1,
			bayIds: [bay.id],
			validationMode: "deferred-final",
			organization: organizationSeedDescriptor({
				key: bay.id,
				kind: "BAY",
				name: bay.id,
				parentKeys: [parentOrganizationKey],
				description: "Deep production Bay enclosing two parallel full-depth Process Loops.",
				color: "TEAL",
			}),
		},
		organizationSeeds,
	);
	for (const [index, loop] of bay.processLoops.entries()) {
		commitTemplate(
			document,
			evaluator,
			steps,
			"outerbay-link",
			`${bay.id} parallel Process Loop ${index + 1}`,
			loop.anchor,
			loop.pose,
			Object.freeze({
				templateId: "outerbay-link",
				clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
				trunkSpanMeters: loop.frontageMeters,
				offsetMeters: loop.depthMeters,
			}) satisfies OuterbayLinkTemplateParameters,
			{
				hierarchyRole: "process-loop",
				entityId: loop.id,
				bayCount: 1,
				bayIds: [bay.id],
				validationMode: "deferred-final",
				organization: organizationSeedDescriptor({
					key: loop.id,
					kind: "AISLE",
					name: loop.id,
					parentKeys: [bay.id],
					description: `Parallel directed Process Loop ${index + 1} of ${bay.id}.`,
					color: "AMBER",
				}),
			},
			organizationSeeds,
		);
	}
}

function commitProductionFab(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	assembly: ProductionFabAssemblyPlan,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const fabOrganizationKey = "PRODUCTION-FAB";
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"FAB outer circulation",
		assembly.outer.origin,
		assembly.outer.pose,
		outerLoopParameters(assembly.outer.lengthMeters, assembly.outer.depthMeters),
		{
			hierarchyRole: "outer-circulation",
			entityId: assembly.outer.id,
			validationMode: "deferred-final",
			organization: organizationSeedDescriptor({
				key: fabOrganizationKey,
				kind: "AREA",
				name: "Production FAB",
				parentKeys: [],
				description: "Factory-wide outer circulation and shared interbay spine.",
				color: "BLUE",
			}),
		},
		organizationSeeds,
	);
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"FAB interbay spine",
		assembly.interbaySpine.origin,
		assembly.interbaySpine.pose,
		outerLoopParameters(assembly.interbaySpine.lengthMeters, assembly.interbaySpine.depthMeters),
		{
			hierarchyRole: "interbay-spine",
			entityId: assembly.interbaySpine.id,
			validationMode: "deferred-final",
			organization: organizationSeedDescriptor({
				key: fabOrganizationKey,
				kind: "AREA",
				name: "Production FAB",
				parentKeys: [],
				description: "Factory-wide outer circulation and shared interbay spine.",
				color: "BLUE",
			}),
		},
		organizationSeeds,
	);

	for (const bank of assembly.banks) {
		commitTemplate(
			document,
			evaluator,
			steps,
			"outer-loop",
			`${bank.id} collector`,
			bank.collector.origin,
			bank.collector.pose,
			outerLoopParameters(bank.collector.lengthMeters, bank.collector.depthMeters),
			{
				hierarchyRole: "bay-bank",
				entityId: bank.id,
				bayCount: bank.bayCount,
				bayIds: bank.bays.map((bay) => bay.id),
				validationMode: "deferred-final",
				organization: organizationSeedDescriptor({
					key: bank.id,
					kind: "AREA",
					name: bank.id,
					parentKeys: [fabOrganizationKey],
					description: `Shared collector and ${bank.bayCount} production Bays.`,
					color: "CYAN",
				}),
			},
			organizationSeeds,
		);
		for (const bay of bank.bays) {
			commitBayAssembly(
				document,
				evaluator,
				steps,
				{
					aisleLengthMeters: bay.lengthMeters,
					laneSpacingMeters: bay.depthMeters,
					bayCount: 1,
					bayPitchMeters: assembly.profile.bayPitchMeters,
					outerbayDepthMeters: bay.depthMeters,
					processBlockCount: 1,
				},
				bay.anchor,
				bay.pose,
				bay.id,
				"deferred-final",
				organizationSeeds,
				bank.id,
				bay.processLoops,
			);
		}
	}
}

function commitBayBank(
	document: RailDocument,
	evaluator: RailDraftEvaluator,
	steps: SyntheticFabStarterBuildStep[],
	parameters: SyntheticFabStarterParameters,
	organizationSeeds: MutableSyntheticFabOrganizationSeed[],
): void {
	const endMarginMeters = 8;
	const bankOrganizationKey = "BAY-BANK-01";
	const collectorLengthMeters =
		endMarginMeters * 2 +
		(parameters.bayCount - 1) * parameters.bayPitchMeters +
		parameters.aisleLengthMeters;
	commitTemplate(
		document,
		evaluator,
		steps,
		"outer-loop",
		"Shared interbay collector",
		{ x: 0, y: 0 },
		{ forward: DIR_E, side: "right", flow: "forward" },
		outerLoopParameters(collectorLengthMeters, 16),
		{
			hierarchyRole: "interbay-spine",
			entityId: "BANK-COLLECTOR-01",
			bayCount: parameters.bayCount,
			organization: organizationSeedDescriptor({
				key: bankOrganizationKey,
				kind: "AREA",
				name: "Bay Bank 01",
				parentKeys: [],
				description: `Shared collector and ${parameters.bayCount} production Bays.`,
				color: "CYAN",
			}),
		},
		organizationSeeds,
	);
	for (let index = 0; index < parameters.bayCount; index++) {
		commitBayAssembly(
			document,
			evaluator,
			steps,
			parameters,
			{ x: endMarginMeters + index * parameters.bayPitchMeters, y: 0 },
			{ forward: DIR_E, side: "left", flow: "forward" },
			`BAY-${String(index + 1).padStart(2, "0")}`,
			"exact",
			organizationSeeds,
			bankOrganizationKey,
		);
	}
}

function moveAlongPose(anchor: Cell, forward: Direction, distance: number): Cell {
	if (forward === DIR_N) return Object.freeze({ x: anchor.x, y: anchor.y - distance });
	if (forward === DIR_E) return Object.freeze({ x: anchor.x + distance, y: anchor.y });
	if (forward === DIR_S) return Object.freeze({ x: anchor.x, y: anchor.y + distance });
	return Object.freeze({ x: anchor.x - distance, y: anchor.y });
}

function organizationSeedDescriptor(
	descriptor: SyntheticFabOrganizationSeedDescriptor,
): SyntheticFabOrganizationSeedDescriptor {
	return Object.freeze({
		...descriptor,
		parentKeys: Object.freeze([...descriptor.parentKeys]),
	});
}

function directedRailEdgesAddedByMutations(
	mutations: readonly RailMutation[],
): readonly DirectedRailEdge[] {
	const edges = new Map<string, DirectedRailEdge>();
	for (const mutation of mutations) {
		const before = decodeRailCell(mutation.before);
		const after = decodeRailCell(mutation.after);
		const addedOutgoing = after.outgoing & ~before.outgoing;
		for (const direction of ALL_DIRECTIONS) {
			if ((addedOutgoing & direction) === 0) continue;
			const edge = Object.freeze({
				from: Object.freeze({ x: mutation.x, y: mutation.y }),
				to: Object.freeze(moveCell({ x: mutation.x, y: mutation.y }, direction)),
			}) satisfies DirectedRailEdge;
			edges.set(staticFabOrganizationEdgeKey(edge), edge);
		}
	}
	return Object.freeze([...edges.values()].sort(compareDirectedRailEdges));
}

function appendOrganizationSeed(
	seeds: MutableSyntheticFabOrganizationSeed[],
	descriptor: SyntheticFabOrganizationSeedDescriptor,
	edges: readonly DirectedRailEdge[],
): void {
	let seed = seeds.find((candidate) => candidate.key === descriptor.key);
	if (!seed) {
		seed = {
			...descriptor,
			parentKeys: Object.freeze([...descriptor.parentKeys]),
			railEdges: new Map<string, DirectedRailEdge>(),
		};
		seeds.push(seed);
	} else if (
		seed.kind !== descriptor.kind ||
		seed.name !== descriptor.name ||
		seed.description !== descriptor.description ||
		seed.color !== descriptor.color ||
		seed.parentKeys.join("\0") !== descriptor.parentKeys.join("\0")
	) {
		throw new Error(`Organization seed '${descriptor.key}' has conflicting metadata.`);
	}
	for (const edge of edges) seed.railEdges.set(staticFabOrganizationEdgeKey(edge), edge);
}

function organizationStateFromSeeds(
	seeds: readonly MutableSyntheticFabOrganizationSeed[],
): StaticFabOrganizationState {
	const idByKey = new Map(seeds.map((seed, index) => [seed.key, index + 1]));
	const records = seeds.map((seed, index) => {
		const parentOrganizationIds = seed.parentKeys.map((key) => {
			const id = idByKey.get(key);
			if (id === undefined) throw new Error(`Organization parent '${key}' is not defined.`);
			return id;
		});
		return Object.freeze({
			id: index + 1,
			kind: seed.kind,
			name: seed.name,
			parentOrganizationIds: Object.freeze(
				parentOrganizationIds.sort((left, right) => left - right),
			),
			properties: Object.freeze({
				description: seed.description,
				color: seed.color,
			}),
			membership: Object.freeze({
				railEdges: Object.freeze([...seed.railEdges.values()].sort(compareDirectedRailEdges)),
				advancedSwitchIds: Object.freeze([]),
				equipmentGroupIds: Object.freeze([]),
			}),
		});
	});
	return copyStaticFabOrganizationState({
		nextOrganizationId: records.length + 1,
		records: Object.freeze(records),
	});
}

function starterScale(
	request: SyntheticFabStarterRequest,
): Readonly<{ zoneCount: number; bayCount: number }> {
	switch (request.id) {
		case "blank":
			return Object.freeze({ zoneCount: 0, bayCount: 0 });
		case "bay-assembly":
			return Object.freeze({ zoneCount: 1, bayCount: 1 });
		case "bay-bank":
			return Object.freeze({
				zoneCount: 1,
				bayCount: request.parameters.bayCount,
			});
		case "full-fab-52":
		case "paired-circulation-fab-52":
			return Object.freeze({
				zoneCount: 4,
				bayCount: request.parameters.bayCount,
			});
		case "parallel-hall-fab-12":
			return Object.freeze({
				zoneCount: 2,
				bayCount: request.parameters.bayCount,
			});
		case "central-spine-fab-24":
			return Object.freeze({
				zoneCount: 2,
				bayCount: request.parameters.bayCount,
			});
		case "production-fab-60":
			return Object.freeze({
				zoneCount: request.parameters.processBlockCount,
				bayCount: request.parameters.bayCount,
			});
		case "dual-loop":
		case "nested-bay":
			return Object.freeze({ zoneCount: 1, bayCount: 2 });
		case "duplicate-bays":
			return Object.freeze({ zoneCount: 2, bayCount: 2 });
		case "interbay-row":
		case "fab-block":
			return Object.freeze({
				zoneCount: 1,
				bayCount: request.parameters.bayCount,
			});
		case "complete-fab":
			return Object.freeze({
				zoneCount: 3,
				bayCount: request.parameters.bayCount * 3,
			});
		case "large-fab-60":
			return Object.freeze({
				zoneCount: request.parameters.processBlockCount * 4,
				bayCount: request.parameters.bayCount,
			});
		default:
			return Object.freeze({ zoneCount: 1, bayCount: 1 });
	}
}

function starterItem(item: SyntheticFabStarterCatalogItem): SyntheticFabStarterCatalogItem {
	return Object.freeze({
		...item,
		parameters: Object.freeze([...item.parameters]),
	});
}

function parameter(
	key: SyntheticFabStarterParameterKey,
	label: string,
	minimum: number,
	maximum: number,
	step: number,
	unit: "m" | "loop" | "bay" | "bank" | "block" = "m",
): SyntheticFabStarterParameterDescriptor {
	return Object.freeze({ key, label, unit, minimum, maximum, step });
}
