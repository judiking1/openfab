import type { EqRowDraftSelection } from "../compile/EqRowDraftSelector";
import type { OhbRowDragSelection } from "../compile/OhbRowDragSelector";
import {
	type CompiledPhysicalPaths,
	PATH_KIND,
	samplePhysicalPath,
} from "../compile/PhysicalPathCompiler";
import {
	buildPhysicalPathAdjacency,
	hitTestPhysicalPaths,
	type PhysicalFlowTraceEntry,
	type PhysicalPathAdjacency,
	type PhysicalPathHit,
	tracePhysicalPathFlow,
} from "../compile/PhysicalPathFlow";
import {
	type Int32CsrIndexSnapshot,
	PhysicalPathCellIndex,
	type PhysicalPathCellLookup,
	PhysicalPathIdentityIndex,
} from "../compile/PhysicalPathLookup";
import {
	type CompiledPhysicalPathSelection,
	collectPhysicalModulePathCandidates,
	compilePhysicalModuleSelection,
} from "../compile/PhysicalPathSelection";
import { PhysicalPathSpatialIndex } from "../compile/PhysicalPathSpatialIndex";
import type { PortEquipmentGroupEditPlan } from "../compile/PortEquipmentGroupEditPlanner";
import {
	type CompiledPortEquipmentPresentation,
	equipmentGroupPresentationRow,
	PORT_EQUIPMENT_GROUP_PRESENTATION_MODE,
	type PortEquipmentHit,
	type PortEquipmentSpatialIndex,
	portEquipmentPresentationRow,
	portEquipmentSpatialIndexFor,
} from "../compile/PortEquipmentPresentation";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	type PortSlotBounds,
	PortSlotSpatialIndex,
	type PortSlotSpatialIndexSnapshot,
} from "../compile/PortSlotCompiler";
import type { PreparedPortSlotAvailabilityIndex } from "../compile/PortSlotPreparedArtifacts";
import {
	compileAdvancedSwitchPreviewLayout,
	type RailDraftEvaluation,
} from "../compile/RailDraftEvaluator";
import {
	createRailTemplatePlacementFeedback,
	type RailTemplatePlacementFeedback,
	type RailTemplatePlacementHandle,
} from "../compile/RailTemplatePlacementFeedback";
import type {
	StaticFabOrganizationOutlineBounds,
	StaticFabOrganizationOutlineIndex,
	StaticFabOrganizationOutlineRole,
} from "../compile/StaticFabOrganizationOutlineIndex";
import type { StkDraftSelection } from "../compile/StkDraftSelector";
import {
	type AdvancedSwitchGeometry,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import type {
	AdvancedSwitchPlan,
	AdvancedSwitchReplacementPlan,
} from "../core/AdvancedSwitchPlanner";
import { EQUIPMENT_GROUP_KINDS, type EquipmentGroupKind } from "../core/EquipmentGroup";
import type { RailReplacementPlan } from "../core/edit";
import { PORT_TYPES, type PortType } from "../core/PortRecord";
import type { RailConstructionPlan, RailErasePlan, RailMutation } from "../core/paint";
import type { RailAreaSelection } from "../core/RailAreaSelection";
import { isRailAreaStampPlan, type RailAreaStampPlan } from "../core/RailAreaStamp";
import { RAIL_CLOSURE_SNAP_RADIUS_METERS } from "../core/RailClosureSnap";
import { deriveRailConstructionMetric } from "../core/RailConstructionMetric";
import type { RailModuleOwnership } from "../core/RailModuleOwnership";
import { isRailNetworkLinkPlan, type RailNetworkLinkPlan } from "../core/RailNetworkLinkPlanner";
import type { RailTemplateAttachmentGuide } from "../core/RailTemplateAttachmentGuide";
import { isRailTemplatePlan, type RailTemplatePlan } from "../core/RailTemplateCatalog";
import type {
	RailTemplateCompositionGuide,
	RailTemplateCompositionResolution,
} from "../core/RailTemplateCompositionGuide";
import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	isTangentJunction,
	oppositeDirection,
	tangentJunctionSide,
} from "../core/railShape";
import type {
	StaticFabAssemblyConnectorPlan,
	StaticFabAssemblyGatewayCandidate,
} from "../core/StaticFabAssemblyConnector";
import { isStaticFabMutationPlan, type StaticFabMutationPlan } from "../core/StaticFabBlueprint";
import {
	isIssuedStaticFabOrganizationBundlePlacementPlan,
	type StaticFabOrganizationBundlePlacementPlan,
} from "../core/StaticFabOrganizationBundlePlacement";
import {
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS,
	type StaticFabOrganizationBundlePlacementPreview,
	type StaticFabOrganizationBundlePlacementPreviewArtifact,
} from "../core/StaticFabOrganizationBundlePlacementPreview";
import { type Cell, cellKey, decodeRailCell, type RailCell, type TileMap } from "../core/TileMap";
import {
	type CompiledRailPresentation,
	compilePhysicalRailPresentation,
	OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE,
	RAIL_DECORATION_KIND,
	RAIL_DECORATION_PRIORITY,
	type RailDecorationKind,
} from "./PhysicalRailPresentation";
import {
	type CompiledPhysicalRailRenderArtifacts,
	physicalRailRenderArtifactsMatch,
} from "./PhysicalRailRenderArtifacts";
import {
	type SimulationRuntimePresentation,
	simulationRuntimePresentationMatchesPublication,
} from "./SimulationRuntimePresentation";
import {
	STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
	type StaticFabArrangementPreviewArtifact,
	type StaticFabArrangementPreviewChunk,
	type StaticFabArrangementPreviewPresentationChunk,
	type StaticFabArrangementPreviewRoot,
} from "./StaticFabArrangementPreview";

export { compileAdvancedSwitchPreviewLayout };

export interface Camera {
	offsetX: number;
	offsetY: number;
	zoom: number;
	rotation: 0 | 1 | 2 | 3;
}

export type RailPresentationMode = "profiled" | "centerline";

const CLOSURE_SNAP_SCREEN_MARGIN_PIXELS = 8;
const AREA_SELECTION_CELL_DETAIL_LIMIT = 1_500;
const AREA_STAMP_GHOST_CELL_DETAIL_LIMIT = 2_000;
const AREA_STAMP_GHOST_SAMPLE_LIMIT = 1_600;
const AREA_STAMP_GHOST_CONFLICT_LIMIT = 128;
const ORGANIZATION_BUNDLE_GHOST_CHUNK_METERS = 16;
const ORGANIZATION_BUNDLE_PREVIEW_MAX_VISIBLE_PORTS = 2_048;
const ORGANIZATION_BUNDLE_PREVIEW_MAX_VISIBLE_GROUPS = 1_024;
const ORGANIZATION_BUNDLE_PREVIEW_MAX_GROUP_SECTIONS = 1_024;
export const STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT = 128;
const STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_CONFLICT_LIMIT = 256;
export const STATIC_FAB_ARRANGEMENT_PREVIEW_CELL_DETAIL_MIN_ZOOM = 8;
const STATIC_FAB_ARRANGEMENT_PREVIEW_CONFLICT_MIN_ZOOM = 3;
const STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_VISIBLE_TARGET_CELLS = 4_096;
const STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_VISIBLE_PORTS = 2_048;
const STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_VISIBLE_EQUIPMENT_SECTIONS = 1_024;
const STATIC_FAB_ARRANGEMENT_PREVIEW_EQUIPMENT_MIN_ZOOM = 3;
const STATIC_FAB_ORGANIZATION_OUTLINE_MAX_PASSIVE_ROWS = 2_048;
const STATIC_FAB_ARRANGEMENT_SOURCE_DASH = [8, 5];
const STATIC_FAB_ARRANGEMENT_PLANNING_DASH = [6, 4];
const EMPTY_LINE_DASH: number[] = [];
const EMPTY_NUMBER_ARRAY: readonly number[] = Object.freeze([]);
const STATIC_FAB_ORGANIZATION_OUTLINE_PASSIVE_ROLE_ORDER = [
	"FAB",
	"BAY_BANK",
	"BAY",
] as const satisfies readonly StaticFabOrganizationOutlineRole[];
Object.freeze(STATIC_FAB_ARRANGEMENT_SOURCE_DASH);
Object.freeze(STATIC_FAB_ARRANGEMENT_PLANNING_DASH);
Object.freeze(EMPTY_LINE_DASH);

/** Keep an 8 px magnet margin outside the target cell while respecting the metric safety bound. */
export function closureSnapRadiusMetersForZoom(zoomPixelsPerMeter: number): number {
	if (!Number.isFinite(zoomPixelsPerMeter) || zoomPixelsPerMeter <= 0) {
		return RAIL_CLOSURE_SNAP_RADIUS_METERS;
	}
	return Math.min(
		RAIL_CLOSURE_SNAP_RADIUS_METERS,
		0.5 + CLOSURE_SNAP_SCREEN_MARGIN_PIXELS / zoomPixelsPerMeter,
	);
}

/** Keep compact slots selectable; overlapping hit disks still resolve to the nearest 1 m station. */
export function portSlotPickRadiusMeters(portType: PortType, zoomPixelsPerMeter: number): number {
	const maximumRadius = portType === "STK" ? 0.8 : portType === "EQ" ? 0.7 : 0.48;
	if (!Number.isFinite(zoomPixelsPerMeter) || zoomPixelsPerMeter <= 0) return maximumRadius;
	const screenRadiusPixels = portType === "STK" ? 26 : portType === "EQ" ? 20 : 14;
	return clamp(
		screenRadiusPixels / zoomPixelsPerMeter,
		portType === "STK" ? 0.24 : 0.18,
		maximumRadius,
	);
}

/** Give touch a 44 px target near normal editing zoom while keeping distant low-zoom picks bounded. */
export function touchPortSlotPickRadiusMeters(
	portType: PortType,
	zoomPixelsPerMeter: number,
): number {
	const pointerRadius = portSlotPickRadiusMeters(portType, zoomPixelsPerMeter);
	if (!Number.isFinite(zoomPixelsPerMeter) || zoomPixelsPerMeter <= 0) return pointerRadius;
	return Math.max(pointerRadius, Math.min(0.75, 22 / zoomPixelsPerMeter));
}

export function physicalFlowMarkerStride(
	zoomPixelsPerMeter: number,
	intervalMeters = OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE.flowIntervalMeters,
): number {
	if (
		!Number.isFinite(zoomPixelsPerMeter) ||
		zoomPixelsPerMeter <= 0 ||
		!Number.isFinite(intervalMeters) ||
		intervalMeters <= 0
	) {
		return 1;
	}
	return Math.max(1, Math.ceil(56 / (zoomPixelsPerMeter * intervalMeters)));
}

export function overviewFlowMinimumRunMeters(zoomPixelsPerMeter: number): number {
	if (!Number.isFinite(zoomPixelsPerMeter) || zoomPixelsPerMeter <= 0) return 0;
	if (zoomPixelsPerMeter < 3) return 24;
	if (zoomPixelsPerMeter < 6) return 12;
	return 0;
}

export function overviewFlowMarkerCellPixels(zoomPixelsPerMeter: number): number | null {
	if (!Number.isFinite(zoomPixelsPerMeter) || zoomPixelsPerMeter <= 0) return null;
	if (zoomPixelsPerMeter < 3) return 48;
	if (zoomPixelsPerMeter < 6) return 40;
	if (zoomPixelsPerMeter < 10) return 32;
	return null;
}

export function overviewPhysicalDecorationVisible(
	kind: RailDecorationKind,
	priority: number,
	zoomPixelsPerMeter: number,
): boolean {
	const switchJoint = kind === RAIL_DECORATION_KIND.SWITCH_JOINT;
	if (
		!switchJoint &&
		priority === RAIL_DECORATION_PRIORITY.CONSTRUCTION &&
		zoomPixelsPerMeter < 14
	) {
		return false;
	}
	if (!switchJoint && priority === RAIL_DECORATION_PRIORITY.DETAIL && zoomPixelsPerMeter < 24) {
		return false;
	}
	if (
		kind === RAIL_DECORATION_KIND.FLOW ||
		kind === RAIL_DECORATION_KIND.FLOW_COMPACT ||
		zoomPixelsPerMeter >= 8
	) {
		return true;
	}
	return switchJoint || (kind === RAIL_DECORATION_KIND.PROFILE_JOINT && zoomPixelsPerMeter >= 6);
}

export function overviewFlowMarkerBucket(
	worldX: number,
	worldY: number,
	direction: "E" | "N" | "S" | "W",
	zoomPixelsPerMeter: number,
	cellPixels: number,
): string {
	const cellMeters = cellPixels / zoomPixelsPerMeter;
	return `${Math.floor(worldX / cellMeters)}:${Math.floor(worldY / cellMeters)}:${direction}`;
}

export function gridMajorStepForZoom(zoomPixelsPerMeter: number): 5 | 10 | 20 {
	if (!Number.isFinite(zoomPixelsPerMeter) || zoomPixelsPerMeter <= 0) return 5;
	if (zoomPixelsPerMeter < 3) return 20;
	if (zoomPixelsPerMeter < 6) return 10;
	return 5;
}

export function overviewRailPixelWidths(
	zoomPixelsPerMeter: number,
): Readonly<{ shadow: number; bed: number; face: number }> | null {
	if (!Number.isFinite(zoomPixelsPerMeter) || zoomPixelsPerMeter <= 0 || zoomPixelsPerMeter >= 10) {
		return null;
	}
	return Object.freeze({
		shadow: clamp(zoomPixelsPerMeter * RAIL_PROFILE_METERS.constructionShadow, 4, 4.4),
		bed: clamp(zoomPixelsPerMeter * RAIL_PROFILE_METERS.profileWidth, 2.5, 2.8),
		face: clamp(zoomPixelsPerMeter * RAIL_PROFILE_METERS.faceWidth, 1.5, 2),
	});
}

export type GhostState =
	| {
			mode: "build";
			plan:
				| RailConstructionPlan
				| RailReplacementPlan
				| AdvancedSwitchPlan
				| AdvancedSwitchReplacementPlan
				| RailTemplatePlan
				| StaticFabOrganizationBundlePlacementPlan;
			evaluation: RailDraftEvaluation;
			templateFeedback?: RailTemplatePlacementFeedback | null;
	  }
	| { mode: "erase"; plan: RailErasePlan };

export type PortRowDraft =
	| { readonly portType: "OHB"; readonly selection: OhbRowDragSelection }
	| { readonly portType: "EQ"; readonly selection: EqRowDraftSelection }
	| { readonly portType: "STK"; readonly selection: StkDraftSelection };

export type StaticFabAssemblyConnectorOverlayPhase =
	| "pick-source"
	| "pick-target"
	| "verifying"
	| "ready"
	| "rejected"
	| "applying";

/** Transient Connect Bays presentation state. It never participates in authored map state. */
export interface StaticFabAssemblyConnectorOverlay {
	readonly phase: StaticFabAssemblyConnectorOverlayPhase;
	readonly gateways: readonly StaticFabAssemblyGatewayCandidate[];
	readonly sourceGatewayId: string | null;
	readonly targetGatewayId: string | null;
	readonly hoveredGatewayId: string | null;
	readonly plan: StaticFabAssemblyConnectorPlan | null;
}

export type TileInteractionFocus = "rail" | "ports";

interface RailIssueCorridor {
	readonly cells: readonly Cell[];
	readonly departure: Readonly<{ from: Cell; to: Cell }>;
	readonly arrival: Readonly<{ from: Cell; to: Cell }>;
}

interface RailIssueCorridorSegmentIndex {
	readonly buckets: ReadonlyMap<string, Uint32Array>;
	readonly visitStamps: Uint32Array;
	visitGeneration: number;
}

export interface TileRenderInput {
	map: TileMap;
	physicalPaths: CompiledPhysicalPaths;
	physicalRenderArtifacts?: CompiledPhysicalRailRenderArtifacts | null;
	portSlots?: CompiledPortSlots | null;
	portSlotSpatialIndex?: PortSlotSpatialIndexSnapshot | null;
	portSlotAvailability?: PreparedPortSlotAvailabilityIndex | null;
	showPortSlots?: boolean;
	portEquipmentPresentation?: CompiledPortEquipmentPresentation | null;
	hoverPortId?: number | null;
	selectedPortId?: number | null;
	selectedEquipmentGroupIds?: readonly number[];
	hoverPortSlot?: number | null;
	ignoredPortIdForPortSlots?: number;
	ignoredEquipmentGroupIdForPortSlots?: number;
	portRowDraft?: PortRowDraft | null;
	portEquipmentGroupEditPreview?: Readonly<{
		slots: CompiledPortSlots;
		plan: PortEquipmentGroupEditPlan | null;
	}> | null;
	portEquipmentMembershipPreview?: Readonly<{
		slots: CompiledPortSlots;
		sourceRows: readonly number[];
		targetRows: readonly number[];
	}> | null;
	ghost: GhostState | null;
	organizationBundlePreview?: StaticFabOrganizationBundlePlacementPreview | null;
	organizationBundlePlacementGuide?: Readonly<{
		readonly sourceBounds: Readonly<{
			readonly minX: number;
			readonly minY: number;
			readonly maxX: number;
			readonly maxY: number;
		}>;
		readonly anchor: Readonly<Cell>;
		readonly centerX: boolean;
		readonly centerY: boolean;
	}> | null;
	staticFabArrangementPreview?: StaticFabArrangementPreviewArtifact | null;
	staticFabAssemblyConnectorOverlay?: StaticFabAssemblyConnectorOverlay | null;
	camera: Camera;
	width: number;
	height: number;
	dpr: number;
	hoverTile: Cell | null;
	hoverWorld: { x: number; y: number } | null;
	anchorTile: Cell | null;
	anchorIntent?: "default" | "network-link-source";
	anchorDirection?: Direction | null;
	snapTargetTile?: Cell | null;
	snapTargetRadiusPixels?: number;
	selectedTile: Cell | null;
	selectedModule?: RailModuleOwnership | null;
	railAreaSelection?: RailAreaSelection | null;
	railAreaMarquee?: Readonly<{
		start: Cell;
		end: Cell;
		operation?: "replace" | "add" | "subtract";
	}> | null;
	staticFabOrganizationOutline?: StaticFabOrganizationOutlineIndex | null;
	staticFabOrganizationSelectionEnabled?: boolean;
	selectedStaticFabOrganizationIds?: readonly number[];
	hoverStaticFabOrganizationId?: number | null;
	templateAttachmentGuide?: RailTemplateAttachmentGuide | null;
	templateCompositionGuide?: RailTemplateCompositionGuide | null;
	templateCompositionResolution?: RailTemplateCompositionResolution | null;
	issueTiles?: readonly Cell[];
	issueFocusTile?: Cell | null;
	issueHighlightKind?: "fault" | "region" | "path" | "corridor" | null;
	issueCorridor?: RailIssueCorridor | null;
	issuePathIdentity?: Int32Array | null;
	issuePathIdentityIndex?: Int32CsrIndexSnapshot | null;
	railPresentationMode?: RailPresentationMode;
	interactionFocus?: TileInteractionFocus;
	simulationRuntime?: SimulationRuntimePresentation | null;
}

const COLORS = {
	background: "#080b0c",
	majorTileA: "#0b1011",
	majorTileB: "#0d1213",
	grid: "rgba(103, 123, 126, 0.14)",
	gridMajor: "rgba(143, 162, 165, 0.28)",
	gridAxis: "rgba(103, 179, 190, 0.38)",
	occupied: "rgba(95, 161, 167, 0.055)",
	occupiedBorder: "rgba(113, 174, 180, 0.12)",
	railShadow: "#102327",
	railProfile: "#3c7177",
	railFace: "#8dc7cb",
	railSlot: "#172e32",
	railGuide: "#c9f0f1",
	turnoutBlade: "#d4b663",
	directionHalo: "rgba(5, 9, 10, 0.94)",
	direction: "#f1c66f",
	flowGlow: "rgba(74, 224, 231, 0.26)",
	flowHalo: "rgba(5, 12, 13, 0.96)",
	flowDirection: "#efffff",
	junction: "#d9f0ed",
	unsafeJunction: "#f06b72",
	endpoint: "#efb85a",
	hoverRail: "rgba(143, 229, 235, 0.78)",
	attachmentCompatible: "rgba(76, 224, 210, 0.92)",
	attachmentCompatibleFill: "rgba(76, 224, 210, 0.16)",
	attachmentBlocked: "rgba(239, 100, 107, 0.82)",
	areaSelection: "rgba(117, 211, 219, 0.94)",
	areaSelectionFill: "rgba(79, 188, 198, 0.19)",
	areaSelectionSubtract: "rgba(246, 112, 121, 0.96)",
	areaSelectionSubtractFill: "rgba(224, 76, 85, 0.16)",
	organizationFabOutline: "rgba(231, 194, 99, 0.46)",
	organizationBankOutline: "rgba(116, 190, 196, 0.5)",
	organizationBayOutline: "rgba(141, 225, 231, 0.56)",
	organizationOutlineHover: "#8de3ea",
	organizationOutlineSelected: "#f1c66f",
	runtimeVehicle: "#f2cd69",
	runtimeVehicleEdge: "#fff1b0",
	runtimeVehicleDirection: "#102124",
	selection: "#8de3ea",
	valid: "#50d58a",
	clearanceValid: "#62dbe5",
	clearanceValidFill: "rgba(59, 190, 202, 0.18)",
	invalid: "#f06b72",
	invalidFill: "rgba(224, 76, 85, 0.16)",
	issue: "#ff8b93",
	issueFill: "rgba(240, 107, 114, 0.12)",
	erase: "#f07a68",
	eraseFill: "rgba(232, 89, 70, 0.16)",
	switchEnvelope: "rgba(76, 171, 181, 0.12)",
	switchEnvelopeBorder: "rgba(111, 215, 224, 0.42)",
	switchThroat: "rgba(222, 190, 103, 0.36)",
	switchInput: "#75c9f0",
	switchOutput: "#efc66d",
	switchGhost: "#66dce6",
	switchGhostFill: "rgba(72, 184, 205, 0.16)",
	switchConflict: "#ff6570",
	templateReservation: "rgba(221, 185, 91, 0.1)",
	templateReservationBorder: "rgba(232, 198, 111, 0.46)",
	templateTerminal: "#f0d27b",
} as const;

const ADVANCED_SWITCH_PROFILE_COLORS: Readonly<Record<AdvancedSwitchProfileClass, string>> = {
	A: "#6ddde5",
	B: "#e0bc65",
	C: "#79d39b",
	D: "#ee8b79",
};

const RAIL_PROFILE_METERS = {
	constructionShadow: 0.44,
	profileWidth: 0.23,
	faceWidth: 0.17,
	slotWidth: 0.04,
	guideWidth: 0.018,
} as const;

const ADVANCED_SWITCH_INDEX_CHUNK_SIZE = 32;
const ISSUE_CORRIDOR_INDEX_CHUNK_SIZE = 32;

interface ScreenPoint {
	x: number;
	y: number;
}

interface PhysicalRailPalette {
	readonly shadow: string;
	readonly bed: string;
	readonly beamEdge: string;
	readonly face: string;
	readonly slot: string;
	readonly highlight: string;
}

interface PhysicalRailScreenPaths {
	readonly center: Path2D | null;
	readonly left: Path2D | null;
	readonly right: Path2D | null;
}

interface LocalRoute {
	from: Direction | null;
	to: Direction | null;
}

interface AdvancedSwitchVisual {
	record: AdvancedSwitchRecord;
	geometry: AdvancedSwitchGeometry;
}

interface IndexedAdvancedSwitchVisual extends AdvancedSwitchVisual {
	bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

interface StaticFabOrganizationGhostPortMarker {
	readonly portId: number;
	readonly equipmentGroupId: number;
	readonly portType: PortType;
	readonly railX: number;
	readonly railZ: number;
	readonly worldX: number;
	readonly worldZ: number;
}

interface StaticFabOrganizationGhostGroupExtent {
	readonly equipmentGroupId: number;
	readonly kind: EquipmentGroupKind;
	readonly markerIndices: readonly number[];
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

interface StaticFabOrganizationGhostPresentation {
	readonly markers: readonly StaticFabOrganizationGhostPortMarker[];
	readonly markerChunks: ReadonlyMap<string, readonly number[]>;
	readonly groupExtents: readonly StaticFabOrganizationGhostGroupExtent[];
}

interface StaticFabAssemblyConnectorGatewayPresentation {
	readonly gateways: readonly StaticFabAssemblyGatewayCandidate[];
	readonly bounds: Float64Array;
	readonly indicesById: ReadonlyMap<string, number>;
	readonly drawStamps: Uint32Array;
	drawGeneration: number;
}

interface StaticFabAssemblyConnectorPlanPresentation {
	readonly outboundWorldPath: Path2D | null;
	readonly returnWorldPath: Path2D | null;
	readonly conflicts: readonly Cell[];
}

type AdvancedSwitchVisualPlan = AdvancedSwitchPlan | AdvancedSwitchReplacementPlan;

const COMMITTED_RAIL_PALETTE: PhysicalRailPalette = {
	shadow: COLORS.railShadow,
	bed: COLORS.railProfile,
	beamEdge: COLORS.railSlot,
	face: COLORS.railFace,
	slot: COLORS.railSlot,
	highlight: COLORS.railGuide,
};

const VALID_GHOST_RAIL_PALETTE: PhysicalRailPalette = {
	shadow: "rgba(21, 86, 91, 0.92)",
	bed: "rgba(63, 194, 204, 0.76)",
	beamEdge: "rgba(7, 44, 48, 0.96)",
	face: "#69e0e8",
	slot: "#14383c",
	highlight: "#d4fcff",
};

const INVALID_GHOST_RAIL_PALETTE: PhysicalRailPalette = {
	shadow: "rgba(92, 24, 31, 0.94)",
	bed: "rgba(210, 63, 74, 0.78)",
	beamEdge: "rgba(60, 12, 18, 0.98)",
	face: "#f06b72",
	slot: "#4a161c",
	highlight: "#ffd7d9",
};

const STATIC_FAB_ASSEMBLY_CONNECTOR_WORLD_CAMERA: Readonly<Camera> = Object.freeze({
	offsetX: 0,
	offsetY: 0,
	zoom: 1,
	rotation: 0,
});

export function advancedSwitchHighlightCells(map: TileMap, cell: Cell | null): readonly Cell[] {
	if (!cell) return [];
	const switchRecord = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
	return switchRecord ? deriveAdvancedSwitchGeometry(switchRecord).claimedCells : [cell];
}

/** Static rails are cached; pointer movement redraws only the lightweight overlay. */
export class TileRenderer {
	private staticKey = "";
	private staticRedraws = 0;
	private overlayRedraws = 0;
	private boundMap: TileMap | null = null;
	private boundPhysicalPaths: CompiledPhysicalPaths | null = null;
	private boundPortSlots: CompiledPortSlots | null = null;
	private boundPortSlotSpatialIndex: PortSlotSpatialIndexSnapshot | null = null;
	private boundPortSlotAvailability: PreparedPortSlotAvailabilityIndex | null = null;
	private portSlotSpatialIndex: PortSlotSpatialIndex | null = null;
	private readonly portSlotSpatialIndexCache = new WeakMap<
		CompiledPortSlots,
		{
			readonly snapshot: PortSlotSpatialIndexSnapshot | null;
			readonly index: PortSlotSpatialIndex;
		}
	>();
	private portSlotPreparedArtifactBindings = 0;
	private readonly visiblePortSlotBuffer: number[] = [];
	private visiblePortSlotCandidates = 0;
	private readonly hitPortSlotBuffer: number[] = [];
	private ohbDraftRows = 0;
	private ohbDraftSkippedRows = 0;
	private eqDraftRows = 0;
	private eqDraftBlockedRows = 0;
	private stkDraftRows = 0;
	private stkDraftCanComplete = false;
	private boundPortEquipmentPresentation: CompiledPortEquipmentPresentation | null = null;
	private portEquipmentSpatialIndex: PortEquipmentSpatialIndex | null = null;
	private readonly visiblePortEquipmentBuffer: number[] = [];
	private readonly visibleEquipmentGroupBuffer: number[] = [];
	private physicalPresentation: CompiledRailPresentation | null = null;
	private physicalPresentationBuilds = 0;
	private physicalPreparedArtifactBindings = 0;
	private physicalJointCount = 0;
	private physicalSupportCount = 0;
	private physicalFlowMarkerCount = 0;
	private physicalPathBindings = 0;
	private physicalPathSpatialIndex: PhysicalPathSpatialIndex | null = null;
	private boundIssuePathIdentityIndex: Int32CsrIndexSnapshot | null = null;
	private issuePathIdentityIndex: PhysicalPathIdentityIndex | null = null;
	private issuePathIdentityKey = "";
	private readonly issuePathIndices: number[] = [];
	private readonly visiblePathBuffer: number[] = [];
	private visiblePathCandidates = 0;
	private pathIndicesByCell: PhysicalPathCellLookup = new Map();
	private physicalAdjacency: PhysicalPathAdjacency = {
		offsets: new Uint32Array(1),
		targets: new Uint32Array(),
	};
	private flowCacheKey = "";
	private flowTrace: readonly PhysicalFlowTraceEntry[] = [];
	private flowPathIndices: readonly number[] = [];
	private ghostEvaluation: RailDraftEvaluation | null = null;
	private ghostPhysicalPaths: CompiledPhysicalPaths | null = null;
	private ghostPresentation: CompiledRailPresentation | null = null;
	private ghostPathIndices: readonly number[] = [];
	private ghostPathCompiles = 0;
	private ghostPresentationBuilds = 0;
	private ghostScreenPathSource: CompiledPhysicalPaths | null = null;
	private ghostScreenPathKey = "";
	private ghostScreenPaths: PhysicalRailScreenPaths | null = null;
	private ghostScreenPathBuilds = 0;
	private readonly organizationBundleGhostPresentations = new WeakMap<
		StaticFabOrganizationBundlePlacementPlan,
		StaticFabOrganizationGhostPresentation
	>();
	private readonly staticFabAssemblyConnectorGatewayPresentations = new WeakMap<
		readonly StaticFabAssemblyGatewayCandidate[],
		StaticFabAssemblyConnectorGatewayPresentation
	>();
	private readonly staticFabAssemblyConnectorPlanPresentations = new WeakMap<
		RailNetworkLinkPlan,
		StaticFabAssemblyConnectorPlanPresentation
	>();
	private readonly staticFabAssemblyConnectorVisibleGatewayIndices: number[] = [];
	private staticFabAssemblyConnectorGatewayBindings = 0;
	private staticFabAssemblyConnectorPlanBindings = 0;
	private staticFabAssemblyConnectorRoutePathBuilds = 0;
	private staticFabAssemblyConnectorRoutePathStrokes = 0;
	private staticFabAssemblyConnectorRouteCellFallbackStrokes = 0;
	private staticFabAssemblyConnectorVisibleGateways = 0;
	private staticFabAssemblyConnectorVisibleConflicts = 0;
	private organizationBundlePreviewArtifact: StaticFabOrganizationBundlePlacementPreviewArtifact | null =
		null;
	private organizationBundlePreviewGeneration = 0;
	private organizationBundlePreviewCellStamps = new Uint32Array();
	private organizationBundlePreviewPortStamps = new Uint32Array();
	private organizationBundlePreviewGroupStamps = new Uint32Array();
	private readonly organizationBundlePreviewCellBuffer: number[] = [];
	private readonly organizationBundlePreviewPortBuffer: number[] = [];
	private readonly organizationBundlePreviewGroupBuffer: number[] = [];
	private organizationBundlePreviewVisibleChunks = 0;
	private organizationBundlePreviewVisibleCells = 0;
	private organizationBundlePreviewVisiblePorts = 0;
	private staticFabArrangementPreviewArtifact: StaticFabArrangementPreviewArtifact | null = null;
	private staticFabArrangementPreviewArtifactBindings = 0;
	private staticFabArrangementPreviewVisibleRoots = 0;
	private staticFabArrangementPreviewVisibleChunks = 0;
	private staticFabArrangementPreviewVisibleTargetCells = 0;
	private staticFabArrangementPreviewVisiblePorts = 0;
	private staticFabArrangementPreviewVisibleEquipmentSections = 0;
	private staticFabArrangementPreviewVisibleConflicts = 0;
	private readonly staticFabArrangementPreviewVisibleBounds = new Float64Array(4);
	private boundStaticFabOrganizationOutline: StaticFabOrganizationOutlineIndex | null = null;
	private staticFabOrganizationSelectionEnabled = false;
	private staticFabOrganizationOutlineBindings = 0;
	private staticFabOrganizationOutlineQueryCandidates = 0;
	private staticFabOrganizationOutlineVisibleRows = 0;
	private staticFabOrganizationOutlineHitCandidates = 0;
	private simulationRuntimeSequence = 0;
	private simulationRuntimePoseFingerprint = "";
	private simulationRuntimePoseCount = 0;
	private simulationRuntimeVisiblePoseCount = 0;
	private simulationRuntimeDrawCount = 0;
	private staticFabOrganizationOutlineQueryRows = new Int32Array();
	private readonly staticFabOrganizationOutlineVisibleBounds: StaticFabOrganizationOutlineBounds = {
		minX: 0,
		minZ: 0,
		maxX: 0,
		maxZ: 0,
	};
	private readonly staticFabOrganizationOutlineReadBounds: StaticFabOrganizationOutlineBounds = {
		minX: 0,
		minZ: 0,
		maxX: 0,
		maxZ: 0,
	};
	private selectedStaticFabOrganizationIdsSource: readonly number[] | null = null;
	private readonly selectedStaticFabOrganizationIdSet = new Set<number>();
	private selectedModuleSource: CompiledPhysicalPaths | null = null;
	private selectedModuleKey: string | null = null;
	private selectedModuleRevision = -1;
	private selectedPhysicalSelection: CompiledPhysicalPathSelection | null = null;
	private physicalSelectionBuilds = 0;
	private physicalSelectionCandidates = 0;
	private readonly selectionCandidatePathBuffer: number[] = [];
	private selectionCandidateStamps = new Uint32Array();
	private selectionCandidateGeneration = 0;
	private readonly hoverPathIndexBuffer = [0];
	private hoverScreenPathSource: CompiledPhysicalPaths | null = null;
	private hoverScreenPathKey = "";
	private hoverScreenPaths: PhysicalRailScreenPaths | null = null;
	private hoverScreenPathBuilds = 0;
	private selectedScreenPathSource: CompiledPhysicalPaths | null = null;
	private selectedScreenPathSelection: CompiledPhysicalPathSelection | null = null;
	private selectedScreenPathKey = "";
	private selectedScreenPaths: PhysicalRailScreenPaths | null = null;
	private selectedScreenPathBuilds = 0;
	private advancedSwitchMap: TileMap | null = null;
	private advancedSwitchRevision = -1;
	private advancedSwitchIndexBuilds = 0;
	private advancedSwitchVisuals: IndexedAdvancedSwitchVisual[] = [];
	private advancedSwitchBuckets = new Map<string, Uint32Array>();
	private advancedSwitchVisitStamps = new Uint32Array();
	private advancedSwitchVisitGeneration = 0;
	private readonly visibleAdvancedSwitchBuffer: AdvancedSwitchVisual[] = [];
	private visibleAdvancedSwitchCount = 0;
	private areaSelectionSource: RailAreaSelection | null = null;
	private areaSelectionCells: readonly Cell[] = [];
	private issueCorridorSource: RailIssueCorridor | null = null;
	private issueCorridorScreenKey = "";
	private issueCorridorScreenPath: Path2D | null = null;
	private issueCorridorScreenPathBuilds = 0;
	private issueCorridorVisibleSegments = 0;
	private issueCorridorSegmentIndexBuilds = 0;
	private issueCorridorCandidateSegments = 0;
	private readonly issueCorridorSegmentIndexCache = new WeakMap<
		RailIssueCorridor,
		RailIssueCorridorSegmentIndex
	>();
	private readonly issueCorridorCandidateBuffer: number[] = [];

	render(
		staticContext: CanvasRenderingContext2D,
		overlayContext: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		this.bindStaticFabOrganizationOutline(input);
		this.ensureStaticLayer(staticContext, input);
		overlayContext.save();
		overlayContext.setTransform(1, 0, 0, 1, 0, 0);
		overlayContext.clearRect(0, 0, overlayContext.canvas.width, overlayContext.canvas.height);
		overlayContext.restore();

		overlayContext.save();
		overlayContext.setTransform(input.dpr, 0, 0, input.dpr, 0, 0);
		const portFocus = input.interactionFocus === "ports";
		if (portFocus) {
			this.staticFabOrganizationOutlineQueryCandidates = 0;
			this.staticFabOrganizationOutlineVisibleRows = 0;
		}
		const hoverHit = portFocus ? null : this.resolveHoverPhysicalHit(input);
		if (!portFocus) {
			this.drawDownstreamFlow(overlayContext, input, hoverHit);
			this.drawTemplateAttachmentGuide(overlayContext, input);
			this.drawTemplateCompositionGuide(overlayContext, input);
			this.drawPhysicalHover(overlayContext, input, hoverHit);
			this.drawSelectedModule(overlayContext, input);
			this.drawRailAreaSelection(overlayContext, input);
			this.drawStaticFabOrganizationOutlines(overlayContext, input);
		}
		this.drawPortEquipmentInteraction(overlayContext, input);
		if (!portFocus) this.drawIssueTiles(overlayContext, input);
		this.drawOrganizationBundlePlacementGuide(overlayContext, input);
		this.drawStaticFabOrganizationBundlePlacementPreview(overlayContext, input);
		this.drawGhost(overlayContext, input);
		this.drawStaticFabAssemblyConnectorOverlay(overlayContext, input);
		this.drawClosureSnap(overlayContext, input);
		this.drawPortRowDraft(overlayContext, input);
		this.drawPortEquipmentMembershipPreview(overlayContext, input);
		this.drawPortEquipmentGroupEditPreview(overlayContext, input);
		this.drawHoveredPortSlot(overlayContext, input);
		this.drawAnchor(overlayContext, input);
		this.drawStaticFabArrangementPreview(overlayContext, input);
		this.drawSimulationRuntime(overlayContext, input);
		overlayContext.restore();
		this.overlayRedraws++;
	}

	tileAtScreen(screenX: number, screenY: number, camera: Camera): Cell {
		const world = this.worldAtScreen(screenX, screenY, camera);
		return {
			x: Math.floor(world.x),
			y: Math.floor(world.y),
		};
	}

	tileCenterAtScreen(cell: Cell, camera: Camera): ScreenPoint {
		return this.worldToScreen({ x: cell.x + 0.5, y: cell.y + 0.5 }, camera);
	}

	worldAtScreen(screenX: number, screenY: number, camera: Camera): ScreenPoint {
		const rotated = {
			x: (screenX - camera.offsetX) / camera.zoom,
			y: (screenY - camera.offsetY) / camera.zoom,
		};
		return inverseRotatePoint(rotated, camera.rotation);
	}

	worldToScreen(world: ScreenPoint, camera: Camera): ScreenPoint {
		const rotated = rotatePoint(world, camera.rotation);
		return {
			x: rotated.x * camera.zoom + camera.offsetX,
			y: rotated.y * camera.zoom + camera.offsetY,
		};
	}

	hitTestCommittedPath(
		cell: Cell,
		world: { x: number; y: number },
		zoom: number,
		expectedPaths: CompiledPhysicalPaths,
	): PhysicalPathHit | null {
		const paths = this.boundPhysicalPaths;
		const candidates = this.pathIndicesByCell.get(cellKey(cell.x, cell.y));
		if (!paths || paths !== expectedPaths || !candidates) return null;
		return hitTestPhysicalPaths(paths, candidates, world, clamp(8 / zoom, 0.18, 0.32));
	}

	hitTestPortSlot(
		slots: CompiledPortSlots,
		world: { x: number; y: number },
		zoom: number,
		maximumDistanceMeters = portSlotPickRadiusMeters(slots.portType, zoom),
		ignoredPortId = 0,
		includeDynamicConflicts = false,
		ignoredEquipmentGroupId = 0,
		includeStaticConflicts = false,
	): number | null {
		if (this.boundPortSlots !== slots || !this.portSlotSpatialIndex) return null;
		this.portSlotSpatialIndex.query(
			{
				minX: world.x - maximumDistanceMeters,
				minZ: world.y - maximumDistanceMeters,
				maxX: world.x + maximumDistanceMeters,
				maxZ: world.y + maximumDistanceMeters,
			},
			this.hitPortSlotBuffer,
		);
		let nearest: number | null = null;
		let nearestDistance = maximumDistanceMeters;
		for (const row of this.hitPortSlotBuffer) {
			const status =
				this.boundPortSlotAvailability?.statusFor(
					slots,
					row,
					ignoredPortId,
					ignoredEquipmentGroupId,
				).status ?? (slots.statuses[row] as number);
			if (
				status !== PORT_SLOT_STATUS.LEGAL &&
				!includeStaticConflicts &&
				(!includeDynamicConflicts || !isDynamicPortSlotConflict(status))
			) {
				continue;
			}
			const distance = Math.hypot(
				(slots.worldPositions[row * 2] as number) - world.x,
				(slots.worldPositions[row * 2 + 1] as number) - world.y,
			);
			if (distance <= nearestDistance) {
				nearest = row;
				nearestDistance = distance;
			}
		}
		return nearest;
	}

	hitTestPortEquipment(
		presentation: CompiledPortEquipmentPresentation,
		world: { x: number; y: number },
		zoom: number,
	): PortEquipmentHit | null {
		if (this.boundPortEquipmentPresentation !== presentation || !this.portEquipmentSpatialIndex) {
			return null;
		}
		return (
			this.portEquipmentSpatialIndex.nearest(world.x, world.y, clamp(13 / zoom, 0.24, 0.42)) ??
			this.portEquipmentSpatialIndex.groupAt(world.x, world.y, clamp(3 / zoom, 0.04, 0.12))
		);
	}

	queryPortSlots(
		slots: CompiledPortSlots,
		bounds: PortSlotBounds,
		target: number[] = [],
	): number[] {
		if (this.boundPortSlots !== slots || !this.portSlotSpatialIndex) {
			target.length = 0;
			return target;
		}
		return this.portSlotSpatialIndex.query(bounds, target);
	}

	queryStaticFabOrganizationOutlinePoint(
		expectedOutline: StaticFabOrganizationOutlineIndex,
		worldX: number,
		worldZ: number,
		targetRows: Int32Array,
	): number {
		if (
			!this.staticFabOrganizationSelectionEnabled ||
			this.boundStaticFabOrganizationOutline !== expectedOutline
		) {
			this.staticFabOrganizationOutlineHitCandidates = 0;
			return 0;
		}
		const count = expectedOutline.queryPoint(worldX, worldZ, targetRows);
		this.staticFabOrganizationOutlineHitCandidates = count;
		return count;
	}

	canQueryStaticFabOrganizationOutline(
		expectedOutline: StaticFabOrganizationOutlineIndex,
	): boolean {
		return (
			this.staticFabOrganizationSelectionEnabled &&
			this.boundStaticFabOrganizationOutline === expectedOutline
		);
	}

	hitTestStaticFabOrganizationOutline(
		expectedOutline: StaticFabOrganizationOutlineIndex,
		worldX: number,
		worldZ: number,
	): number {
		if (!this.canQueryStaticFabOrganizationOutline(expectedOutline)) {
			this.staticFabOrganizationOutlineHitCandidates = 0;
			return -1;
		}
		const row = expectedOutline.hitTest(worldX, worldZ);
		this.staticFabOrganizationOutlineHitCandidates = row >= 0 ? 1 : 0;
		return row;
	}

	invalidateStatic(): void {
		this.staticKey = "";
	}

	getStats(): {
		staticRedraws: number;
		overlayRedraws: number;
		physicalPathBindings: number;
		physicalPathCount: number;
		physicalPresentationBuilds: number;
		physicalPreparedArtifactBindings: number;
		portSlotPreparedArtifactBindings: number;
		visiblePortSlotCandidates: number;
		ohbDraftRows: number;
		ohbDraftSkippedRows: number;
		eqDraftRows: number;
		eqDraftBlockedRows: number;
		stkDraftRows: number;
		stkDraftCanComplete: boolean;
		physicalJointCount: number;
		physicalSupportCount: number;
		physicalFlowMarkerCount: number;
		ghostPathCompiles: number;
		ghostPresentationBuilds: number;
		ghostScreenPathBuilds: number;
		physicalSelectionBuilds: number;
		physicalSelectionCandidates: number;
		hoverScreenPathBuilds: number;
		selectedScreenPathBuilds: number;
		spatialChunkCount: number;
		spatialPathReferences: number;
		visiblePathCandidates: number;
		advancedSwitchIndexBuilds: number;
		advancedSwitchCount: number;
		visibleAdvancedSwitchCount: number;
		issueCorridorScreenPathBuilds: number;
		issueCorridorVisibleSegments: number;
		issueCorridorSegmentIndexBuilds: number;
		issueCorridorCandidateSegments: number;
		staticFabAssemblyConnectorGatewayBindings: number;
		staticFabAssemblyConnectorPlanBindings: number;
		staticFabAssemblyConnectorRoutePathBuilds: number;
		staticFabAssemblyConnectorRoutePathStrokes: number;
		staticFabAssemblyConnectorRouteCellFallbackStrokes: number;
		staticFabAssemblyConnectorVisibleGateways: number;
		staticFabAssemblyConnectorVisibleConflicts: number;
		organizationBundlePreviewVisibleChunks: number;
		organizationBundlePreviewVisibleCells: number;
		organizationBundlePreviewVisiblePorts: number;
		staticFabArrangementPreviewArtifactBindings: number;
		staticFabArrangementPreviewVisibleRoots: number;
		staticFabArrangementPreviewVisibleChunks: number;
		staticFabArrangementPreviewVisibleTargetCells: number;
		staticFabArrangementPreviewVisiblePorts: number;
		staticFabArrangementPreviewVisibleEquipmentSections: number;
		staticFabArrangementPreviewVisibleConflicts: number;
		staticFabOrganizationOutlineBindings: number;
		staticFabOrganizationOutlineQueryCandidates: number;
		staticFabOrganizationOutlineVisibleRows: number;
		staticFabOrganizationOutlineHitCandidates: number;
		simulationRuntimeSequence: number;
		simulationRuntimePoseFingerprint: string;
		simulationRuntimePoseCount: number;
		simulationRuntimeVisiblePoseCount: number;
		simulationRuntimeDrawCount: number;
	} {
		return {
			staticRedraws: this.staticRedraws,
			overlayRedraws: this.overlayRedraws,
			physicalPathBindings: this.physicalPathBindings,
			physicalPathCount: this.boundPhysicalPaths?.pathCount ?? 0,
			physicalPresentationBuilds: this.physicalPresentationBuilds,
			physicalPreparedArtifactBindings: this.physicalPreparedArtifactBindings,
			portSlotPreparedArtifactBindings: this.portSlotPreparedArtifactBindings,
			visiblePortSlotCandidates: this.visiblePortSlotCandidates,
			ohbDraftRows: this.ohbDraftRows,
			ohbDraftSkippedRows: this.ohbDraftSkippedRows,
			eqDraftRows: this.eqDraftRows,
			eqDraftBlockedRows: this.eqDraftBlockedRows,
			stkDraftRows: this.stkDraftRows,
			stkDraftCanComplete: this.stkDraftCanComplete,
			physicalJointCount: this.physicalJointCount,
			physicalSupportCount: this.physicalSupportCount,
			physicalFlowMarkerCount: this.physicalFlowMarkerCount,
			ghostPathCompiles: this.ghostPathCompiles,
			ghostPresentationBuilds: this.ghostPresentationBuilds,
			ghostScreenPathBuilds: this.ghostScreenPathBuilds,
			physicalSelectionBuilds: this.physicalSelectionBuilds,
			physicalSelectionCandidates: this.physicalSelectionCandidates,
			hoverScreenPathBuilds: this.hoverScreenPathBuilds,
			selectedScreenPathBuilds: this.selectedScreenPathBuilds,
			spatialChunkCount: this.physicalPathSpatialIndex?.stats.chunkCount ?? 0,
			spatialPathReferences: this.physicalPathSpatialIndex?.stats.pathReferences ?? 0,
			visiblePathCandidates: this.visiblePathCandidates,
			advancedSwitchIndexBuilds: this.advancedSwitchIndexBuilds,
			advancedSwitchCount: this.advancedSwitchVisuals.length,
			visibleAdvancedSwitchCount: this.visibleAdvancedSwitchCount,
			issueCorridorScreenPathBuilds: this.issueCorridorScreenPathBuilds,
			issueCorridorVisibleSegments: this.issueCorridorVisibleSegments,
			issueCorridorSegmentIndexBuilds: this.issueCorridorSegmentIndexBuilds,
			issueCorridorCandidateSegments: this.issueCorridorCandidateSegments,
			staticFabAssemblyConnectorGatewayBindings: this.staticFabAssemblyConnectorGatewayBindings,
			staticFabAssemblyConnectorPlanBindings: this.staticFabAssemblyConnectorPlanBindings,
			staticFabAssemblyConnectorRoutePathBuilds: this.staticFabAssemblyConnectorRoutePathBuilds,
			staticFabAssemblyConnectorRoutePathStrokes: this.staticFabAssemblyConnectorRoutePathStrokes,
			staticFabAssemblyConnectorRouteCellFallbackStrokes:
				this.staticFabAssemblyConnectorRouteCellFallbackStrokes,
			staticFabAssemblyConnectorVisibleGateways: this.staticFabAssemblyConnectorVisibleGateways,
			staticFabAssemblyConnectorVisibleConflicts: this.staticFabAssemblyConnectorVisibleConflicts,
			organizationBundlePreviewVisibleChunks: this.organizationBundlePreviewVisibleChunks,
			organizationBundlePreviewVisibleCells: this.organizationBundlePreviewVisibleCells,
			organizationBundlePreviewVisiblePorts: this.organizationBundlePreviewVisiblePorts,
			staticFabArrangementPreviewArtifactBindings: this.staticFabArrangementPreviewArtifactBindings,
			staticFabArrangementPreviewVisibleRoots: this.staticFabArrangementPreviewVisibleRoots,
			staticFabArrangementPreviewVisibleChunks: this.staticFabArrangementPreviewVisibleChunks,
			staticFabArrangementPreviewVisibleTargetCells:
				this.staticFabArrangementPreviewVisibleTargetCells,
			staticFabArrangementPreviewVisiblePorts: this.staticFabArrangementPreviewVisiblePorts,
			staticFabArrangementPreviewVisibleEquipmentSections:
				this.staticFabArrangementPreviewVisibleEquipmentSections,
			staticFabArrangementPreviewVisibleConflicts: this.staticFabArrangementPreviewVisibleConflicts,
			staticFabOrganizationOutlineBindings: this.staticFabOrganizationOutlineBindings,
			staticFabOrganizationOutlineQueryCandidates: this.staticFabOrganizationOutlineQueryCandidates,
			staticFabOrganizationOutlineVisibleRows: this.staticFabOrganizationOutlineVisibleRows,
			staticFabOrganizationOutlineHitCandidates: this.staticFabOrganizationOutlineHitCandidates,
			simulationRuntimeSequence: this.simulationRuntimeSequence,
			simulationRuntimePoseFingerprint: this.simulationRuntimePoseFingerprint,
			simulationRuntimePoseCount: this.simulationRuntimePoseCount,
			simulationRuntimeVisiblePoseCount: this.simulationRuntimeVisiblePoseCount,
			simulationRuntimeDrawCount: this.simulationRuntimeDrawCount,
		};
	}

	private drawSimulationRuntime(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const presentation = input.simulationRuntime;
		const publication = presentation?.publication;
		if (
			!presentation ||
			!publication ||
			!simulationRuntimePresentationMatchesPublication(presentation) ||
			typeof presentation.poseFingerprint !== "string" ||
			presentation.poseFingerprint.length === 0 ||
			!Number.isSafeInteger(publication.publishedPoseCount) ||
			publication.publishedPoseCount < 0 ||
			publication.publishedPoseCount > 8_192 ||
			!Number.isSafeInteger(publication.maximumPoseCount) ||
			publication.maximumPoseCount <= 0 ||
			publication.maximumPoseCount < publication.publishedPoseCount ||
			publication.maximumPoseCount > 8_192 ||
			publication.poseWorldXMeters.length < publication.publishedPoseCount ||
			publication.poseWorldZMeters.length < publication.publishedPoseCount ||
			publication.poseTangentX.length < publication.publishedPoseCount ||
			publication.poseTangentZ.length < publication.publishedPoseCount
		) {
			this.simulationRuntimeSequence = 0;
			this.simulationRuntimePoseFingerprint = "";
			this.simulationRuntimePoseCount = 0;
			this.simulationRuntimeVisiblePoseCount = 0;
			return;
		}
		this.simulationRuntimeSequence = publication.sequence;
		this.simulationRuntimePoseFingerprint = presentation.poseFingerprint;
		this.simulationRuntimePoseCount = publication.publishedPoseCount;
		this.simulationRuntimeVisiblePoseCount = 0;
		this.simulationRuntimeDrawCount++;
		const overview = input.camera.zoom < 6;
		const margin = overview ? 4 : 16;
		const length = clamp(input.camera.zoom * 0.72, 8, 24);
		const width = clamp(input.camera.zoom * 0.34, 5, 12);

		ctx.save();
		ctx.fillStyle = COLORS.runtimeVehicle;
		ctx.strokeStyle = COLORS.runtimeVehicleEdge;
		ctx.lineWidth = 1.25;
		if (overview) ctx.beginPath();
		for (let row = 0; row < publication.publishedPoseCount; row++) {
			const worldX = publication.poseWorldXMeters[row] as number;
			const worldZ = publication.poseWorldZMeters[row] as number;
			const tangentX = publication.poseTangentX[row] as number;
			const tangentZ = publication.poseTangentZ[row] as number;
			if (
				!Number.isFinite(worldX) ||
				!Number.isFinite(worldZ) ||
				!Number.isFinite(tangentX) ||
				!Number.isFinite(tangentZ) ||
				Math.hypot(tangentX, tangentZ) <= Number.EPSILON
			) {
				continue;
			}
			const screen = this.worldToScreen({ x: worldX, y: worldZ }, input.camera);
			if (
				screen.x < -margin ||
				screen.y < -margin ||
				screen.x > input.width + margin ||
				screen.y > input.height + margin
			) {
				continue;
			}
			this.simulationRuntimeVisiblePoseCount++;
			if (overview) {
				ctx.moveTo(screen.x + 2.5, screen.y);
				ctx.arc(screen.x, screen.y, 2.5, 0, Math.PI * 2);
				continue;
			}
			const tangentScreen = this.worldToScreen(
				{
					x: worldX + tangentX,
					y: worldZ + tangentZ,
				},
				input.camera,
			);
			ctx.save();
			ctx.translate(screen.x, screen.y);
			ctx.rotate(Math.atan2(tangentScreen.y - screen.y, tangentScreen.x - screen.x));
			roundRect(ctx, -length * 0.5, -width * 0.5, length, width, Math.min(3, width * 0.3));
			ctx.fill();
			ctx.stroke();
			ctx.strokeStyle = COLORS.runtimeVehicleDirection;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(length * 0.12, -width * 0.22);
			ctx.lineTo(length * 0.34, 0);
			ctx.lineTo(length * 0.12, width * 0.22);
			ctx.stroke();
			ctx.strokeStyle = COLORS.runtimeVehicleEdge;
			ctx.restore();
		}
		if (overview && this.simulationRuntimeVisiblePoseCount > 0) ctx.fill();
		ctx.restore();
	}

	private ensureStaticLayer(staticContext: CanvasRenderingContext2D, input: TileRenderInput): void {
		const { map, physicalPaths, camera, width, height, dpr } = input;
		if (this.boundMap !== map) {
			this.boundMap = map;
			this.staticKey = "";
		}
		if (this.boundPhysicalPaths !== physicalPaths) {
			this.boundPhysicalPaths = physicalPaths;
			this.selectedModuleSource = null;
			this.selectedModuleKey = null;
			this.selectedModuleRevision = -1;
			this.selectedPhysicalSelection = null;
			this.physicalSelectionCandidates = 0;
			this.selectionCandidatePathBuffer.length = 0;
			this.selectionCandidateStamps = new Uint32Array(physicalPaths.pathCount);
			this.selectionCandidateGeneration = 0;
			this.hoverScreenPathSource = null;
			this.hoverScreenPathKey = "";
			this.hoverScreenPaths = null;
			this.selectedScreenPathSource = null;
			this.selectedScreenPathSelection = null;
			this.selectedScreenPathKey = "";
			this.selectedScreenPaths = null;
			this.physicalPathBindings++;
			const prepared = input.physicalRenderArtifacts;
			const usePrepared =
				prepared !== null &&
				prepared !== undefined &&
				physicalRailRenderArtifactsMatch(physicalPaths, prepared);
			this.physicalPresentation = usePrepared
				? prepared.presentation.source === physicalPaths
					? prepared.presentation
					: Object.freeze({ ...prepared.presentation, source: physicalPaths })
				: compilePhysicalRailPresentation(physicalPaths);
			this.physicalPresentationBuilds++;
			if (usePrepared) {
				this.physicalPreparedArtifactBindings++;
				this.physicalJointCount = prepared.decorationCounts.joints;
				this.physicalSupportCount = prepared.decorationCounts.supports;
				this.physicalFlowMarkerCount = prepared.decorationCounts.flowMarkers;
				this.physicalPathSpatialIndex = PhysicalPathSpatialIndex.fromSnapshot(
					physicalPaths,
					prepared.spatialIndex,
				);
				this.pathIndicesByCell = new PhysicalPathCellIndex(prepared.cellIndex);
				this.physicalAdjacency = prepared.adjacency;
			} else {
				this.physicalJointCount = 0;
				this.physicalSupportCount = 0;
				this.physicalFlowMarkerCount = 0;
				for (const kind of this.physicalPresentation.decorations.kinds) {
					if (kind <= RAIL_DECORATION_KIND.SWITCH_JOINT) this.physicalJointCount++;
					else if (kind === RAIL_DECORATION_KIND.SUPPORT) this.physicalSupportCount++;
					else if (
						kind === RAIL_DECORATION_KIND.FLOW ||
						kind === RAIL_DECORATION_KIND.FLOW_COMPACT
					) {
						this.physicalFlowMarkerCount++;
					}
				}
				this.physicalPathSpatialIndex = new PhysicalPathSpatialIndex(physicalPaths);
				this.pathIndicesByCell = PhysicalPathCellIndex.compile(physicalPaths);
				this.physicalAdjacency = buildPhysicalPathAdjacency(physicalPaths);
			}
			this.flowCacheKey = "";
			this.staticKey = "";
		}
		const nextPortSlots = input.portSlots ?? null;
		const nextPortSlotSpatialIndex = input.portSlotSpatialIndex ?? null;
		if (
			this.boundPortSlots !== nextPortSlots ||
			this.boundPortSlotSpatialIndex !== nextPortSlotSpatialIndex
		) {
			this.boundPortSlots = nextPortSlots;
			this.boundPortSlotSpatialIndex = nextPortSlotSpatialIndex;
			if (!nextPortSlots) {
				this.portSlotSpatialIndex = null;
			} else {
				const preparedSnapshot = nextPortSlotSpatialIndex ?? null;
				const cached = this.portSlotSpatialIndexCache.get(nextPortSlots);
				if (cached?.snapshot === preparedSnapshot) {
					this.portSlotSpatialIndex = cached.index;
				} else {
					this.portSlotSpatialIndex = preparedSnapshot
						? PortSlotSpatialIndex.fromPreparedSnapshot(nextPortSlots, preparedSnapshot)
						: new PortSlotSpatialIndex(nextPortSlots);
					this.portSlotSpatialIndexCache.set(nextPortSlots, {
						snapshot: preparedSnapshot,
						index: this.portSlotSpatialIndex,
					});
					if (preparedSnapshot) this.portSlotPreparedArtifactBindings++;
				}
			}
			this.staticKey = "";
		}
		const nextPortSlotAvailability = input.portSlotAvailability ?? null;
		if (this.boundPortSlotAvailability !== nextPortSlotAvailability) {
			this.boundPortSlotAvailability = nextPortSlotAvailability;
			this.staticKey = "";
		}
		const nextPortEquipment = input.portEquipmentPresentation ?? null;
		if (this.boundPortEquipmentPresentation !== nextPortEquipment) {
			this.boundPortEquipmentPresentation = nextPortEquipment;
			this.portEquipmentSpatialIndex = nextPortEquipment
				? portEquipmentSpatialIndexFor(nextPortEquipment)
				: null;
			this.visiblePortEquipmentBuffer.length = 0;
			this.visibleEquipmentGroupBuffer.length = 0;
			this.staticKey = "";
		}
		const pixelWidth = Math.max(1, Math.round(width * dpr));
		const pixelHeight = Math.max(1, Math.round(height * dpr));
		const key = [
			map.getRevision(),
			camera.offsetX.toFixed(2),
			camera.offsetY.toFixed(2),
			camera.zoom.toFixed(3),
			camera.rotation,
			input.railPresentationMode ?? "profiled",
			input.showPortSlots === false ? "slots-hidden" : "slots-visible",
			input.interactionFocus ?? "rail",
			input.ignoredPortIdForPortSlots ?? 0,
			input.ignoredEquipmentGroupIdForPortSlots ?? 0,
			pixelWidth,
			pixelHeight,
		].join(":");
		if (this.staticKey === key) return;
		this.staticKey = key;
		staticContext.save();
		staticContext.setTransform(1, 0, 0, 1, 0, 0);
		staticContext.clearRect(0, 0, pixelWidth, pixelHeight);
		staticContext.restore();
		staticContext.setTransform(dpr, 0, 0, dpr, 0, 0);
		staticContext.fillStyle = COLORS.background;
		staticContext.fillRect(0, 0, width, height);
		this.drawGrid(staticContext, camera, width, height);
		this.prepareVisiblePortEquipment(input);
		this.drawPortEquipmentFootprints(staticContext, input);
		this.drawRails(staticContext, input);
		this.drawPortSlots(staticContext, input);
		this.drawPortEquipment(staticContext, input);
		this.staticRedraws++;
	}

	private prepareVisiblePortEquipment(input: TileRenderInput): void {
		this.visiblePortEquipmentBuffer.length = 0;
		this.visibleEquipmentGroupBuffer.length = 0;
		const presentation = input.portEquipmentPresentation;
		if (!presentation || !this.portEquipmentSpatialIndex) return;
		const visible = visibleBounds(input.camera, input.width, input.height, 4);
		this.portEquipmentSpatialIndex.query(
			{
				minX: visible.minX,
				minZ: visible.minY,
				maxX: visible.maxX,
				maxZ: visible.maxY,
			},
			this.visiblePortEquipmentBuffer,
		);
		this.portEquipmentSpatialIndex.queryBodySections(
			{
				minX: visible.minX,
				minZ: visible.minY,
				maxX: visible.maxX,
				maxZ: visible.maxY,
			},
			this.visibleEquipmentGroupBuffer,
		);
	}

	private drawPortEquipmentFootprints(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const presentation = input.portEquipmentPresentation;
		if (!presentation) return;
		for (const sectionRow of this.visibleEquipmentGroupBuffer) {
			const groupRow = presentation.bodySectionGroupRows[sectionRow] as number;
			const groupKind = EQUIPMENT_GROUP_KINDS[presentation.groupKinds[groupRow] as number];
			if (groupKind !== "EQ" && groupKind !== "STK") continue;
			const center = this.worldToScreen(
				{
					x: presentation.bodySectionCenters[sectionRow * 2] as number,
					y: presentation.bodySectionCenters[sectionRow * 2 + 1] as number,
				},
				input.camera,
			);
			const tangentTip = this.worldToScreen(
				{
					x:
						(presentation.bodySectionCenters[sectionRow * 2] as number) +
						(presentation.bodySectionTangents[sectionRow * 2] as number),
					y:
						(presentation.bodySectionCenters[sectionRow * 2 + 1] as number) +
						(presentation.bodySectionTangents[sectionRow * 2 + 1] as number),
				},
				input.camera,
			);
			const width =
				(presentation.bodySectionHalfExtents[sectionRow * 2] as number) * 2 * input.camera.zoom;
			const height =
				(presentation.bodySectionHalfExtents[sectionRow * 2 + 1] as number) * 2 * input.camera.zoom;
			ctx.save();
			ctx.translate(center.x, center.y);
			ctx.rotate(Math.atan2(tangentTip.y - center.y, tangentTip.x - center.x));
			ctx.fillStyle = groupKind === "STK" ? "rgba(139, 100, 40, 0.16)" : "rgba(43, 119, 105, 0.2)";
			ctx.strokeStyle =
				groupKind === "STK" ? "rgba(225, 188, 91, 0.62)" : "rgba(102, 211, 190, 0.5)";
			ctx.lineWidth = 1.2;
			roundRect(ctx, -width / 2, -height / 2, width, height, Math.min(6, height * 0.22));
			ctx.fill();
			ctx.stroke();
			if (
				input.camera.zoom >= 24 &&
				sectionRow === (presentation.groupBodySectionOffsets[groupRow] as number)
			) {
				ctx.fillStyle =
					groupKind === "STK" ? "rgba(242, 214, 145, 0.82)" : "rgba(185, 233, 222, 0.72)";
				ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(`${groupKind}-${presentation.groupIds[groupRow] as number}`, 0, 0);
			}
			ctx.restore();
		}
	}

	private drawPortSlots(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const slots = input.portSlots;
		this.visiblePortSlotCandidates = 0;
		if (input.showPortSlots === false || !slots || !this.portSlotSpatialIndex) return;
		const visible = visibleBounds(input.camera, input.width, input.height, 1);
		this.portSlotSpatialIndex.query(
			{
				minX: visible.minX,
				minZ: visible.minY,
				maxX: visible.maxX,
				maxZ: visible.maxY,
			},
			this.visiblePortSlotBuffer,
		);
		this.visiblePortSlotCandidates = this.visiblePortSlotBuffer.length;
		const markerRadius =
			slots.portType === "STK"
				? clamp(input.camera.zoom * 0.23, 9, 14)
				: slots.portType === "EQ"
					? clamp(input.camera.zoom * 0.19, 7, 11)
					: clamp(input.camera.zoom * 0.15, 6, 9);
		for (const row of this.visiblePortSlotBuffer) {
			const status = this.portSlotStatus(input, row);
			const legal = status === PORT_SLOT_STATUS.LEGAL;
			const dynamicConflict = isDynamicPortSlotConflict(status);
			const showStaticConflict = input.portEquipmentGroupEditPreview !== null;
			if (!legal && !dynamicConflict && !showStaticConflict) continue;
			const bodyReserved = status === PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT;
			const port = this.worldToScreen(
				{
					x: slots.worldPositions[row * 2] as number,
					y: slots.worldPositions[row * 2 + 1] as number,
				},
				input.camera,
			);
			const tangentTip = this.worldToScreen(
				{
					x: (slots.worldPositions[row * 2] as number) + (slots.tangents[row * 2] as number),
					y:
						(slots.worldPositions[row * 2 + 1] as number) + (slots.tangents[row * 2 + 1] as number),
				},
				input.camera,
			);
			const tangentLength = Math.max(
				1e-6,
				Math.hypot(tangentTip.x - port.x, tangentTip.y - port.y),
			);
			const tangentX = (tangentTip.x - port.x) / tangentLength;
			const tangentY = (tangentTip.y - port.y) / tangentLength;
			const normalX = -tangentY;
			const normalY = tangentX;
			ctx.save();
			ctx.strokeStyle = bodyReserved
				? "rgba(225, 188, 91, 0.58)"
				: !legal
					? "rgba(238, 122, 132, 0.62)"
					: slots.portType === "STK"
						? "rgba(225, 188, 91, 0.82)"
						: slots.portType === "EQ"
							? "rgba(102, 211, 190, 0.76)"
							: "rgba(91, 221, 227, 0.68)";
			ctx.fillStyle = bodyReserved
				? "rgba(225, 188, 91, 0.06)"
				: !legal
					? "rgba(238, 122, 132, 0.06)"
					: slots.portType === "STK"
						? "rgba(225, 188, 91, 0.14)"
						: slots.portType === "EQ"
							? "rgba(102, 211, 190, 0.12)"
							: "rgba(95, 225, 231, 0.1)";
			ctx.lineWidth = 1.5;
			if (slots.portType === "EQ") {
				const halfTick = markerRadius * 1.25;
				ctx.lineWidth = legal ? 2 : 1.4;
				ctx.lineCap = "round";
				ctx.beginPath();
				ctx.arc(port.x, port.y, markerRadius * 0.9, 0, Math.PI * 2);
				ctx.fill();
				ctx.beginPath();
				ctx.moveTo(port.x - normalX * halfTick, port.y - normalY * halfTick);
				ctx.lineTo(port.x + normalX * halfTick, port.y + normalY * halfTick);
				ctx.stroke();
				if (!legal) {
					ctx.strokeStyle = bodyReserved ? "#c5a758" : "#d96f79";
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.moveTo(port.x - markerRadius * 0.5, port.y + markerRadius * 0.5);
					ctx.lineTo(port.x + markerRadius * 0.5, port.y - markerRadius * 0.5);
					ctx.stroke();
				}
			} else if (slots.portType === "STK" && bodyReserved) {
				ctx.translate(port.x, port.y);
				ctx.rotate(Math.atan2(tangentY, tangentX));
				const width = clamp(markerRadius * 1.7, 18, 24);
				const height = clamp(markerRadius * 0.92, 10, 13);
				ctx.fillStyle = "rgba(29, 24, 13, 0.94)";
				ctx.strokeStyle = "rgba(244, 211, 124, 0.92)";
				ctx.lineWidth = 1.8;
				roundRect(ctx, -width / 2, -height / 2, width, height, height * 0.32);
				ctx.fill();
				ctx.stroke();
				ctx.strokeStyle = "#f6d884";
				ctx.lineWidth = 2.2;
				ctx.beginPath();
				ctx.moveTo(-width * 0.2, -height * 0.28);
				ctx.lineTo(width * 0.2, height * 0.28);
				ctx.moveTo(width * 0.2, -height * 0.28);
				ctx.lineTo(-width * 0.2, height * 0.28);
				ctx.stroke();
			} else if (slots.portType === "STK") {
				ctx.translate(port.x, port.y);
				ctx.rotate(Math.PI / 4);
				const size = clamp(markerRadius * 1.45, 16, 22);
				ctx.fillRect(-size / 2, -size / 2, size, size);
				ctx.strokeRect(-size / 2, -size / 2, size, size);
				if (legal) {
					ctx.beginPath();
					ctx.arc(0, 0, Math.max(1.2, markerRadius * 0.22), 0, Math.PI * 2);
					ctx.fillStyle = "#f6dc8b";
					ctx.fill();
				} else {
					ctx.strokeStyle = bodyReserved ? "#c5a758" : "#d96f79";
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.moveTo(-size * 0.28, size * 0.28);
					ctx.lineTo(size * 0.28, -size * 0.28);
					ctx.stroke();
				}
			} else {
				ctx.beginPath();
				ctx.arc(port.x, port.y, markerRadius, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
				if (!legal) {
					ctx.strokeStyle = bodyReserved ? "#c5a758" : "#d96f79";
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.moveTo(port.x - markerRadius * 0.5, port.y + markerRadius * 0.5);
					ctx.lineTo(port.x + markerRadius * 0.5, port.y - markerRadius * 0.5);
					ctx.stroke();
				}
			}
			ctx.restore();
		}
	}

	private drawPortEquipment(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const presentation = input.portEquipmentPresentation;
		if (!presentation) return;
		for (const row of this.visiblePortEquipmentBuffer) {
			const railWorld = {
				x: presentation.railPositions[row * 2] as number,
				y: presentation.railPositions[row * 2 + 1] as number,
			};
			const portWorld = {
				x: presentation.worldPositions[row * 2] as number,
				y: presentation.worldPositions[row * 2 + 1] as number,
			};
			const rail = this.worldToScreen(railWorld, input.camera);
			const port = this.worldToScreen(portWorld, input.camera);
			const tangentTip = this.worldToScreen(
				{
					x: portWorld.x + (presentation.tangents[row * 2] as number),
					y: portWorld.y + (presentation.tangents[row * 2 + 1] as number),
				},
				input.camera,
			);
			const facingTip = this.worldToScreen(
				{
					x: portWorld.x + Math.cos(presentation.yawRadians[row] as number),
					y: portWorld.y + Math.sin(presentation.yawRadians[row] as number),
				},
				input.camera,
			);
			ctx.save();
			const portType = PORT_TYPES[presentation.portTypes[row] as number];
			if (portType === "OHB") {
				ctx.strokeStyle = "rgba(214, 239, 238, 0.72)";
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.moveTo(rail.x, rail.y);
				ctx.lineTo(port.x, port.y);
				ctx.stroke();
			}
			ctx.translate(port.x, port.y);
			ctx.rotate(Math.atan2(tangentTip.y - port.y, tangentTip.x - port.x));
			if (portType === "EQ") {
				ctx.beginPath();
				ctx.arc(0, 0, clamp(input.camera.zoom * 0.11, 3.5, 7), 0, Math.PI * 2);
				ctx.fillStyle = "#62c9b5";
				ctx.strokeStyle = "#d4f5ed";
				ctx.lineWidth = 1.4;
				ctx.fill();
				ctx.stroke();
			} else if (portType === "STK") {
				const size = clamp(input.camera.zoom * 0.16, 5, 9);
				ctx.rotate(Math.PI / 4);
				ctx.fillStyle = "#d6b454";
				ctx.strokeStyle = "#fff0b0";
				ctx.lineWidth = 1.4;
				ctx.fillRect(-size / 2, -size / 2, size, size);
				ctx.strokeRect(-size / 2, -size / 2, size, size);
			} else {
				const width = input.camera.zoom * 0.54;
				const height = input.camera.zoom * 0.34;
				ctx.fillStyle = "#31585b";
				ctx.strokeStyle = "#a8d9d9";
				ctx.lineWidth = 1.2;
				roundRect(ctx, -width / 2, -height / 2, width, height, Math.min(4, height * 0.22));
				ctx.fill();
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(0, 0, clamp(input.camera.zoom * 0.07, 2.5, 5), 0, Math.PI * 2);
				ctx.fillStyle = "#e3c466";
				ctx.fill();
			}
			ctx.restore();
			if (input.camera.zoom >= 12) {
				this.drawPortEquipmentFacingIndicator(ctx, input.camera.zoom, portType, port, facingTip);
			}
			const barcode = presentation.barcodes[row];
			if (portType === "OHB" && barcode && input.camera.zoom >= 30) {
				ctx.fillStyle = "rgba(222, 239, 238, 0.88)";
				ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
				ctx.textAlign = "center";
				ctx.textBaseline = "bottom";
				ctx.fillText(barcode, port.x, port.y - input.camera.zoom * 0.24);
			}
		}
	}

	private drawPortEquipmentFacingIndicator(
		ctx: CanvasRenderingContext2D,
		zoom: number,
		portType: "OHB" | "EQ" | "STK",
		port: ScreenPoint,
		facingTip: ScreenPoint,
	): void {
		const magnitude = Math.hypot(facingTip.x - port.x, facingTip.y - port.y);
		if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) return;
		const facingX = (facingTip.x - port.x) / magnitude;
		const facingY = (facingTip.y - port.y) / magnitude;
		const markerExtent =
			portType === "OHB"
				? Math.max(3, zoom * 0.27)
				: portType === "EQ"
					? clamp(zoom * 0.11, 3.5, 7)
					: clamp(zoom * 0.12, 4, 7);
		const startDistance = markerExtent + 1.5;
		const indicatorLength = clamp(zoom * 0.16, 5, 10);
		const startX = port.x + facingX * startDistance;
		const startY = port.y + facingY * startDistance;
		const tipX = startX + facingX * indicatorLength;
		const tipY = startY + facingY * indicatorLength;
		const headLength = Math.min(4, indicatorLength * 0.45);
		const headWidth = Math.min(3.2, indicatorLength * 0.34);
		ctx.save();
		ctx.strokeStyle = "rgba(238, 255, 246, 0.92)";
		ctx.lineWidth = 1.6;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.beginPath();
		ctx.moveTo(startX, startY);
		ctx.lineTo(tipX, tipY);
		ctx.moveTo(tipX, tipY);
		ctx.lineTo(
			tipX - facingX * headLength - facingY * headWidth,
			tipY - facingY * headLength + facingX * headWidth,
		);
		ctx.moveTo(tipX, tipY);
		ctx.lineTo(
			tipX - facingX * headLength + facingY * headWidth,
			tipY - facingY * headLength - facingX * headWidth,
		);
		ctx.stroke();
		ctx.restore();
	}

	private drawHoveredPortSlot(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const slots = input.portSlots;
		const row = input.hoverPortSlot;
		if (
			input.showPortSlots === false ||
			!slots ||
			row === null ||
			row === undefined ||
			row < 0 ||
			row >= slots.count
		) {
			return;
		}
		const rail = this.worldToScreen(
			{
				x: slots.railPositions[row * 2] as number,
				y: slots.railPositions[row * 2 + 1] as number,
			},
			input.camera,
		);
		const center = this.worldToScreen(
			{
				x: slots.worldPositions[row * 2] as number,
				y: slots.worldPositions[row * 2 + 1] as number,
			},
			input.camera,
		);
		const status = this.portSlotStatus(input, row);
		const legal = status === PORT_SLOT_STATUS.LEGAL;
		const bodyReserved = status === PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT;
		const tangentTip = this.worldToScreen(
			{
				x: (slots.worldPositions[row * 2] as number) + (slots.tangents[row * 2] as number),
				y: (slots.worldPositions[row * 2 + 1] as number) + (slots.tangents[row * 2 + 1] as number),
			},
			input.camera,
		);
		const tangentLength = Math.max(
			1e-6,
			Math.hypot(tangentTip.x - center.x, tangentTip.y - center.y),
		);
		const tangentX = (tangentTip.x - center.x) / tangentLength;
		const tangentY = (tangentTip.y - center.y) / tangentLength;
		const radius =
			slots.portType === "STK"
				? clamp(input.camera.zoom * 0.27, 10, 17)
				: clamp(input.camera.zoom * 0.17, 6, 12);
		ctx.save();
		ctx.strokeStyle = legal ? "#d8ffff" : bodyReserved ? "#e0bd60" : "#ff8d94";
		ctx.fillStyle = legal
			? "rgba(91, 222, 228, 0.24)"
			: bodyReserved
				? "rgba(225, 188, 91, 0.18)"
				: "rgba(240, 92, 101, 0.2)";
		ctx.lineWidth = 2;
		if (Math.hypot(center.x - rail.x, center.y - rail.y) > 0.5) {
			ctx.beginPath();
			ctx.moveTo(rail.x, rail.y);
			ctx.lineTo(center.x, center.y);
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		if (legal) {
			const baseX = center.x + tangentX * radius * 1.15;
			const baseY = center.y + tangentY * radius * 1.15;
			const tipX = center.x + tangentX * radius * 2.15;
			const tipY = center.y + tangentY * radius * 2.15;
			ctx.strokeStyle = "#efffff";
			ctx.lineWidth = 1.8;
			ctx.beginPath();
			ctx.moveTo(baseX, baseY);
			ctx.lineTo(tipX, tipY);
			ctx.moveTo(tipX, tipY);
			ctx.lineTo(tipX - tangentX * 5 - tangentY * 3.5, tipY - tangentY * 5 + tangentX * 3.5);
			ctx.moveTo(tipX, tipY);
			ctx.lineTo(tipX - tangentX * 5 + tangentY * 3.5, tipY - tangentY * 5 - tangentX * 3.5);
			ctx.stroke();
		} else {
			ctx.lineWidth = 2.4;
			ctx.beginPath();
			ctx.moveTo(center.x - radius * 0.5, center.y + radius * 0.5);
			ctx.lineTo(center.x + radius * 0.5, center.y - radius * 0.5);
			ctx.stroke();
		}
		if (legal && slots.portType === "STK") {
			const selected =
				input.portRowDraft?.portType === "STK" && input.portRowDraft.selection.rows.includes(row);
			ctx.fillStyle = "#fff4c2";
			ctx.font = "bold 13px ui-monospace, SFMono-Regular, Menlo, monospace";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(selected ? "−" : "+", center.x, center.y + 0.5);
		} else if (bodyReserved && slots.portType === "STK") {
			ctx.fillStyle = "#f6d884";
			ctx.font = "bold 10px ui-monospace, SFMono-Regular, Menlo, monospace";
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillText("RESERVED", center.x, center.y + radius + 5);
		}
		ctx.restore();
	}

	private drawPortEquipmentGroupEditPreview(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		const preview = input.portEquipmentGroupEditPreview;
		const plan = preview?.plan;
		const presentation = input.portEquipmentPresentation;
		if (
			!preview ||
			!plan ||
			!presentation ||
			preview.slots.revision !== input.map.getRevision() ||
			presentation.revision !== input.map.getRevision()
		) {
			return;
		}
		const slots = preview.slots;
		const targetAnchorRow = plan.groupEdit.targetAnchorRow;
		if (targetAnchorRow < 0 || targetAnchorRow >= slots.count) return;
		const sourceAnchorRow = portEquipmentPresentationRow(
			presentation,
			plan.groupEdit.sourceAnchorPortId,
		);
		const sourceGroupRow = equipmentGroupPresentationRow(
			presentation,
			plan.groupEdit.sourceEquipmentGroupId,
		);
		if (sourceAnchorRow === null || sourceGroupRow === null) return;
		const sourceAnchor = {
			x: presentation.worldPositions[sourceAnchorRow * 2] as number,
			y: presentation.worldPositions[sourceAnchorRow * 2 + 1] as number,
		};
		const targetAnchor = {
			x: slots.worldPositions[targetAnchorRow * 2] as number,
			y: slots.worldPositions[targetAnchorRow * 2 + 1] as number,
		};
		const radians = plan.groupEdit.quarterTurns * (Math.PI / 2);
		const cosine = Math.cos(radians);
		const sine = Math.sin(radians);
		const rotateVector = (x: number, y: number): ScreenPoint => ({
			x: x * cosine - y * sine,
			y: x * sine + y * cosine,
		});
		const transformWorld = (x: number, y: number): ScreenPoint => {
			const relative = rotateVector(x - sourceAnchor.x, y - sourceAnchor.y);
			return { x: targetAnchor.x + relative.x, y: targetAnchor.y + relative.y };
		};
		const valid = plan.valid;
		const stroke = valid ? "#96f2dc" : "#ff8d94";
		const fill = valid ? "rgba(73, 213, 181, 0.24)" : "rgba(240, 92, 101, 0.2)";
		ctx.save();
		const sectionStart = presentation.groupBodySectionOffsets[sourceGroupRow] as number;
		const sectionEnd = presentation.groupBodySectionOffsets[sourceGroupRow + 1] as number;
		for (let sectionRow = sectionStart; sectionRow < sectionEnd; sectionRow++) {
			const sourceCenterWorld = {
				x: presentation.bodySectionCenters[sectionRow * 2] as number,
				y: presentation.bodySectionCenters[sectionRow * 2 + 1] as number,
			};
			const sourceTangentWorld = {
				x: presentation.bodySectionTangents[sectionRow * 2] as number,
				y: presentation.bodySectionTangents[sectionRow * 2 + 1] as number,
			};
			if (plan.groupEdit.mode === "move") {
				const sourceCenter = this.worldToScreen(sourceCenterWorld, input.camera);
				const sourceTangentTip = this.worldToScreen(
					{
						x: sourceCenterWorld.x + sourceTangentWorld.x,
						y: sourceCenterWorld.y + sourceTangentWorld.y,
					},
					input.camera,
				);
				const sourceWidth =
					(presentation.bodySectionHalfExtents[sectionRow * 2] as number) * 2 * input.camera.zoom;
				const sourceHeight =
					(presentation.bodySectionHalfExtents[sectionRow * 2 + 1] as number) *
					2 *
					input.camera.zoom;
				ctx.save();
				ctx.translate(sourceCenter.x, sourceCenter.y);
				ctx.rotate(
					Math.atan2(sourceTangentTip.y - sourceCenter.y, sourceTangentTip.x - sourceCenter.x),
				);
				ctx.fillStyle = "rgba(8, 11, 12, 0.62)";
				ctx.strokeStyle = "rgba(143, 162, 165, 0.62)";
				ctx.lineWidth = 1.5;
				ctx.setLineDash([5, 4]);
				roundRect(
					ctx,
					-sourceWidth / 2,
					-sourceHeight / 2,
					sourceWidth,
					sourceHeight,
					Math.min(6, sourceHeight * 0.22),
				);
				ctx.fill();
				ctx.stroke();
				ctx.restore();
			}
			const targetCenterWorld = transformWorld(sourceCenterWorld.x, sourceCenterWorld.y);
			const targetTangentWorld = rotateVector(sourceTangentWorld.x, sourceTangentWorld.y);
			const targetCenter = this.worldToScreen(targetCenterWorld, input.camera);
			const targetTangentTip = this.worldToScreen(
				{
					x: targetCenterWorld.x + targetTangentWorld.x,
					y: targetCenterWorld.y + targetTangentWorld.y,
				},
				input.camera,
			);
			const width =
				(presentation.bodySectionHalfExtents[sectionRow * 2] as number) * 2 * input.camera.zoom;
			const height =
				(presentation.bodySectionHalfExtents[sectionRow * 2 + 1] as number) * 2 * input.camera.zoom;
			ctx.save();
			ctx.translate(targetCenter.x, targetCenter.y);
			ctx.rotate(
				Math.atan2(targetTangentTip.y - targetCenter.y, targetTangentTip.x - targetCenter.x),
			);
			ctx.fillStyle = fill;
			ctx.strokeStyle = stroke;
			ctx.lineWidth = valid ? 2.2 : 2.6;
			ctx.setLineDash(valid ? [] : [7, 5]);
			roundRect(ctx, -width / 2, -height / 2, width, height, Math.min(7, height * 0.22));
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
		const portStart = presentation.groupPortOffsets[sourceGroupRow] as number;
		const portEnd = presentation.groupPortOffsets[sourceGroupRow + 1] as number;
		const sourcePortRows: number[] = [];
		for (let offset = portStart; offset < portEnd; offset++) {
			const row = presentation.groupPortRows[offset];
			if (row !== undefined) sourcePortRows.push(row);
		}
		sourcePortRows.sort((left, right) =>
			left === sourceAnchorRow ? -1 : right === sourceAnchorRow ? 1 : left - right,
		);
		const points = sourcePortRows.map((row) => {
			const world = transformWorld(
				presentation.worldPositions[row * 2] as number,
				presentation.worldPositions[row * 2 + 1] as number,
			);
			return this.worldToScreen(world, input.camera);
		});
		if (points.length === 0) {
			ctx.restore();
			return;
		}
		const radius = clamp(input.camera.zoom * 0.2, 8, 15);
		for (const [index, point] of points.entries()) {
			ctx.beginPath();
			ctx.arc(point.x, point.y, index === 0 ? radius * 1.18 : radius, 0, Math.PI * 2);
			ctx.fillStyle = fill;
			ctx.strokeStyle = stroke;
			ctx.lineWidth = index === 0 ? 3 : 2;
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = valid ? "#effffb" : "#fff0f1";
			ctx.font = "800 10px ui-monospace, SFMono-Regular, Menlo, monospace";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(index === 0 ? "A" : String(index + 1), point.x, point.y + 0.5);
		}
		const anchor = points[0] as ScreenPoint;
		const label = `${plan.groupEdit.mode === "move" ? "MOVE" : "COPY"} ${slots.portType} · ${
			points.length
		} PORT`;
		ctx.font = "800 11px Inter, system-ui, sans-serif";
		const labelWidth = ctx.measureText(label).width;
		const labelX = clamp(anchor.x + 14, 8, Math.max(8, input.width - labelWidth - 18));
		const labelY = clamp(anchor.y - 24, 20, Math.max(20, input.height - 8));
		ctx.fillStyle = valid ? "rgba(10, 34, 29, 0.94)" : "rgba(48, 16, 20, 0.95)";
		roundRect(ctx, labelX - 6, labelY - 14, labelWidth + 12, 21, 4);
		ctx.fill();
		ctx.fillStyle = stroke;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, labelX, labelY);
		ctx.restore();
	}

	private drawPortEquipmentInteraction(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		const presentation = input.portEquipmentPresentation;
		if (!presentation) return;
		const selectedRow =
			input.selectedPortId === null || input.selectedPortId === undefined
				? null
				: portEquipmentPresentationRow(presentation, input.selectedPortId);
		const hoverRow =
			input.hoverPortId === null || input.hoverPortId === undefined
				? null
				: portEquipmentPresentationRow(presentation, input.hoverPortId);
		const selectedGroupIds = new Set(input.selectedEquipmentGroupIds ?? []);
		if (selectedRow !== null) {
			selectedGroupIds.add(presentation.equipmentGroupIds[selectedRow] as number);
		}
		for (const groupId of selectedGroupIds) {
			const groupRow = equipmentGroupPresentationRow(presentation, groupId);
			if (groupRow === null) continue;
			const portOffset = presentation.groupPortOffsets[groupRow] as number;
			const portRow = presentation.groupPortRows[portOffset];
			if (portRow !== undefined) this.drawPortEquipmentHighlight(ctx, input, portRow, true);
		}
		const hoverGroupId =
			hoverRow === null ? null : (presentation.equipmentGroupIds[hoverRow] as number);
		if (hoverRow !== null && hoverGroupId !== null && !selectedGroupIds.has(hoverGroupId)) {
			this.drawPortEquipmentHighlight(ctx, input, hoverRow, false);
		}
	}

	private drawPortEquipmentHighlight(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		row: number,
		selected: boolean,
	): void {
		const presentation = input.portEquipmentPresentation;
		if (!presentation || row < 0 || row >= presentation.count) return;
		const rail = this.worldToScreen(
			{
				x: presentation.railPositions[row * 2] as number,
				y: presentation.railPositions[row * 2 + 1] as number,
			},
			input.camera,
		);
		const portWorld = {
			x: presentation.worldPositions[row * 2] as number,
			y: presentation.worldPositions[row * 2 + 1] as number,
		};
		const port = this.worldToScreen(portWorld, input.camera);
		const portType = PORT_TYPES[presentation.portTypes[row] as number];
		if (portType === "EQ" || portType === "STK") {
			const groupRow = equipmentGroupPresentationRow(
				presentation,
				presentation.equipmentGroupIds[row] as number,
			);
			if (groupRow === null) return;
			this.drawEquipmentGroupHighlight(ctx, input, groupRow, port, selected, portType);
			return;
		}
		const tangentTip = this.worldToScreen(
			{
				x: portWorld.x + (presentation.tangents[row * 2] as number),
				y: portWorld.y + (presentation.tangents[row * 2 + 1] as number),
			},
			input.camera,
		);
		const color = selected ? "#d8ffff" : "#8de3ea";
		ctx.save();
		ctx.strokeStyle = color;
		ctx.lineWidth = selected ? 3 : 2;
		ctx.shadowColor = selected ? "rgba(105, 226, 232, 0.62)" : "rgba(105, 226, 232, 0.36)";
		ctx.shadowBlur = selected ? 9 : 5;
		ctx.beginPath();
		ctx.moveTo(rail.x, rail.y);
		ctx.lineTo(port.x, port.y);
		ctx.stroke();
		ctx.translate(port.x, port.y);
		ctx.rotate(Math.atan2(tangentTip.y - port.y, tangentTip.x - port.x));
		const width = input.camera.zoom * 0.66;
		const height = input.camera.zoom * 0.44;
		ctx.fillStyle = selected ? "rgba(98, 219, 229, 0.18)" : "rgba(98, 219, 229, 0.1)";
		roundRect(ctx, -width / 2, -height / 2, width, height, Math.min(5, height * 0.22));
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}

	private drawEquipmentGroupHighlight(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		groupRow: number,
		port: ScreenPoint,
		selected: boolean,
		portType: "EQ" | "STK",
	): void {
		const presentation = input.portEquipmentPresentation;
		if (!presentation) return;
		if (
			(presentation.groupPresentationModes[groupRow] as number) ===
			PORT_EQUIPMENT_GROUP_PRESENTATION_MODE.PORTS_ONLY
		) {
			this.drawPortOnlyGroupHighlight(ctx, input, groupRow, selected);
			return;
		}
		const outline =
			portType === "STK" ? (selected ? "#fff0b0" : "#dfc06a") : selected ? "#d8ffff" : "#8de3ea";
		const fill =
			portType === "STK"
				? selected
					? "rgba(225, 188, 91, 0.2)"
					: "rgba(225, 188, 91, 0.1)"
				: selected
					? "rgba(98, 219, 229, 0.16)"
					: "rgba(98, 219, 229, 0.08)";
		const shadow =
			portType === "STK"
				? selected
					? "rgba(225, 188, 91, 0.58)"
					: "rgba(225, 188, 91, 0.32)"
				: selected
					? "rgba(105, 226, 232, 0.62)"
					: "rgba(105, 226, 232, 0.36)";
		const sectionStart = presentation.groupBodySectionOffsets[groupRow] as number;
		const sectionEnd = presentation.groupBodySectionOffsets[groupRow + 1] as number;
		for (let sectionRow = sectionStart; sectionRow < sectionEnd; sectionRow++) {
			const center = this.worldToScreen(
				{
					x: presentation.bodySectionCenters[sectionRow * 2] as number,
					y: presentation.bodySectionCenters[sectionRow * 2 + 1] as number,
				},
				input.camera,
			);
			const tangentTip = this.worldToScreen(
				{
					x:
						(presentation.bodySectionCenters[sectionRow * 2] as number) +
						(presentation.bodySectionTangents[sectionRow * 2] as number),
					y:
						(presentation.bodySectionCenters[sectionRow * 2 + 1] as number) +
						(presentation.bodySectionTangents[sectionRow * 2 + 1] as number),
				},
				input.camera,
			);
			const width =
				(presentation.bodySectionHalfExtents[sectionRow * 2] as number) * 2 * input.camera.zoom;
			const height =
				(presentation.bodySectionHalfExtents[sectionRow * 2 + 1] as number) * 2 * input.camera.zoom;
			ctx.save();
			ctx.translate(center.x, center.y);
			ctx.rotate(Math.atan2(tangentTip.y - center.y, tangentTip.x - center.x));
			ctx.strokeStyle = outline;
			ctx.fillStyle = fill;
			ctx.lineWidth = selected ? 3 : 2;
			ctx.shadowColor = shadow;
			ctx.shadowBlur = selected ? 9 : 5;
			roundRect(ctx, -width / 2, -height / 2, width, height, Math.min(7, height * 0.22));
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
		ctx.save();
		ctx.strokeStyle =
			portType === "STK" ? (selected ? "#fff7ce" : "#e7cc7c") : selected ? "#ffffff" : "#bdf5ed";
		ctx.lineWidth = selected ? 2.5 : 2;
		ctx.beginPath();
		ctx.arc(port.x, port.y, clamp(input.camera.zoom * 0.16, 6, 10), 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}

	private drawPortOnlyGroupHighlight(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		groupRow: number,
		selected: boolean,
	): void {
		const presentation = input.portEquipmentPresentation;
		if (!presentation) return;
		const start = presentation.groupPortOffsets[groupRow] as number;
		const end = presentation.groupPortOffsets[groupRow + 1] as number;
		ctx.save();
		ctx.strokeStyle = selected ? "#fff7ce" : "#e7cc7c";
		ctx.fillStyle = selected ? "rgba(225, 188, 91, 0.2)" : "rgba(225, 188, 91, 0.1)";
		ctx.lineWidth = selected ? 2.5 : 2;
		ctx.shadowColor = selected ? "rgba(225, 188, 91, 0.58)" : "rgba(225, 188, 91, 0.32)";
		ctx.shadowBlur = selected ? 9 : 5;
		for (let offset = start; offset < end; offset++) {
			const portRow = presentation.groupPortRows[offset];
			if (portRow === undefined || portRow >= presentation.count) continue;
			const center = this.worldToScreen(
				{
					x: presentation.worldPositions[portRow * 2] as number,
					y: presentation.worldPositions[portRow * 2 + 1] as number,
				},
				input.camera,
			);
			const radius = clamp(input.camera.zoom * 0.18, 7, 12);
			ctx.beginPath();
			ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			if (selected && input.camera.zoom >= 22) {
				ctx.shadowBlur = 0;
				ctx.fillStyle = "#fff7ce";
				ctx.font = "bold 9px ui-monospace, SFMono-Regular, Menlo, monospace";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(`P${offset - start + 1}`, center.x, center.y + 0.5);
				ctx.fillStyle = selected ? "rgba(225, 188, 91, 0.2)" : "rgba(225, 188, 91, 0.1)";
				ctx.shadowBlur = selected ? 9 : 5;
			}
		}
		ctx.restore();
	}

	private drawPortRowDraft(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const slots = input.portSlots;
		const portDraft = input.portRowDraft;
		const ohbDraft = portDraft?.portType === "OHB" ? portDraft.selection : null;
		const eqDraft = portDraft?.portType === "EQ" ? portDraft.selection : null;
		const stkDraft = portDraft?.portType === "STK" ? portDraft.selection : null;
		this.ohbDraftRows = ohbDraft?.rows.length ?? 0;
		this.ohbDraftSkippedRows = ohbDraft?.skippedRows.length ?? 0;
		this.eqDraftRows = eqDraft?.rows.length ?? 0;
		this.eqDraftBlockedRows = eqDraft?.blockedRows.length ?? 0;
		this.stkDraftRows = stkDraft?.rows.length ?? 0;
		this.stkDraftCanComplete = stkDraft?.canComplete ?? false;
		if (!slots || !portDraft) return;

		if (eqDraft && eqDraft.rows.length > 0) {
			this.drawEqDraftFootprint(ctx, input, eqDraft);
			this.drawEqDraftHandles(ctx, input, eqDraft);
		}
		if (stkDraft && stkDraft.rows.length > 0) {
			this.drawStkDraftFootprint(ctx, input, stkDraft);
		}

		if (ohbDraft && ohbDraft.rows.length > 1) {
			ctx.save();
			ctx.strokeStyle = "rgba(105, 230, 209, 0.55)";
			ctx.lineWidth = Math.max(1.5, input.camera.zoom * 0.055);
			ctx.setLineDash([7, 5]);
			ctx.beginPath();
			for (let index = 0; index < ohbDraft.rows.length; index++) {
				const row = ohbDraft.rows[index] as number;
				const center = this.worldToScreen(
					{
						x: slots.worldPositions[row * 2] as number,
						y: slots.worldPositions[row * 2 + 1] as number,
					},
					input.camera,
				);
				if (index === 0) ctx.moveTo(center.x, center.y);
				else ctx.lineTo(center.x, center.y);
			}
			ctx.stroke();
			ctx.restore();
		}

		if (ohbDraft) {
			for (const row of ohbDraft.rows) this.drawPortDraftMarker(ctx, input, row, true, "OHB");
			for (const row of ohbDraft.skippedRows) {
				this.drawPortDraftMarker(ctx, input, row, false, "OHB");
			}
		} else if (eqDraft) {
			for (let index = 0; index < eqDraft.rows.length; index++) {
				const row = eqDraft.rows[index] as number;
				const hasSpecificBlockedRows = eqDraft.blockedRows.length > 0;
				this.drawPortDraftMarker(
					ctx,
					input,
					row,
					eqDraft.state !== "BLOCKED" ||
						(hasSpecificBlockedRows && !eqDraft.blockedRows.includes(row)),
					"EQ",
					String(index + 1),
					eqDraft.state === "ANCHORED" ? 2 : 0,
				);
			}
		} else if (stkDraft) {
			const displayRows = stkDraft.orderedRows.length > 0 ? stkDraft.orderedRows : stkDraft.rows;
			const endpointRows = new Set<number>();
			for (const lane of stkDraft.laneRows) {
				const firstRow = lane[0];
				const lastRow = lane.at(-1);
				if (firstRow !== undefined) endpointRows.add(firstRow);
				if (lastRow !== undefined) endpointRows.add(lastRow);
			}
			for (let index = 0; index < displayRows.length; index++) {
				const row = displayRows[index] as number;
				this.drawPortDraftMarker(
					ctx,
					input,
					row,
					true,
					"STK",
					`P${index + 1}`,
					0,
					endpointRows.has(row),
				);
			}
			if (stkDraft.rejectedRow !== null) {
				this.drawPortDraftMarker(ctx, input, stkDraft.rejectedRow, false, "STK");
			}
		}
		if (ohbDraft && !ohbDraft.valid && isPortSlotRow(slots, ohbDraft.targetRow)) {
			this.drawPortDraftMarker(ctx, input, ohbDraft.targetRow, false, "OHB");
		}
		if (
			eqDraft?.state === "BLOCKED" &&
			isPortSlotRow(slots, eqDraft.targetRow) &&
			!eqDraft.rows.includes(eqDraft.targetRow)
		) {
			this.drawPortDraftMarker(ctx, input, eqDraft.targetRow, false, "EQ");
		}
	}

	private drawPortEquipmentMembershipPreview(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		const preview = input.portEquipmentMembershipPreview;
		if (!preview) return;
		const sourceRows = new Set(preview.sourceRows);
		const targetRows = new Set(preview.targetRows);
		for (const row of preview.sourceRows) {
			this.drawPortMembershipMarker(
				ctx,
				input,
				preview.slots,
				row,
				targetRows.has(row) ? "retained" : "removed",
			);
		}
		for (const row of preview.targetRows) {
			if (sourceRows.has(row)) continue;
			this.drawPortMembershipMarker(ctx, input, preview.slots, row, "added");
		}
	}

	private drawPortMembershipMarker(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		slots: CompiledPortSlots,
		row: number,
		state: "retained" | "added" | "removed",
	): void {
		if (!isPortSlotRow(slots, row)) return;
		const center = this.worldToScreen(
			{
				x: slots.worldPositions[row * 2] as number,
				y: slots.worldPositions[row * 2 + 1] as number,
			},
			input.camera,
		);
		const radius = clamp(input.camera.zoom * 0.2, 8, 13);
		const color = state === "added" ? "#6fe0a8" : state === "removed" ? "#ff7f8e" : "#d9c884";
		ctx.save();
		ctx.beginPath();
		ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
		ctx.fillStyle =
			state === "added"
				? "rgba(55, 153, 109, 0.28)"
				: state === "removed"
					? "rgba(173, 51, 70, 0.3)"
					: "rgba(184, 157, 82, 0.14)";
		ctx.strokeStyle = color;
		ctx.lineWidth = state === "retained" ? 1.5 : 2.5;
		ctx.shadowColor = color;
		ctx.shadowBlur = state === "retained" ? 3 : 8;
		ctx.fill();
		ctx.stroke();
		ctx.shadowBlur = 0;
		ctx.fillStyle = color;
		ctx.font = `bold ${Math.round(clamp(radius * 1.25, 11, 16))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(state === "added" ? "+" : state === "removed" ? "−" : "·", center.x, center.y);
		ctx.restore();
	}

	private drawEqDraftFootprint(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		draft: EqRowDraftSelection,
	): void {
		const slots = input.portSlots;
		const firstRow = draft.rows[0];
		const lastRow = draft.rows.at(-1);
		if (!slots || firstRow === undefined || lastRow === undefined) return;
		const first = this.worldToScreen(
			{
				x: slots.worldPositions[firstRow * 2] as number,
				y: slots.worldPositions[firstRow * 2 + 1] as number,
			},
			input.camera,
		);
		const last = this.worldToScreen(
			{
				x: slots.worldPositions[lastRow * 2] as number,
				y: slots.worldPositions[lastRow * 2 + 1] as number,
			},
			input.camera,
		);
		const footprintStyle =
			draft.state === "BLOCKED"
				? { broad: "rgba(208, 64, 77, 0.2)", line: "#ff7680" }
				: draft.state === "ANCHORED"
					? { broad: "rgba(71, 145, 196, 0.18)", line: "#72b7e8" }
					: { broad: "rgba(66, 178, 160, 0.2)", line: "#68dec2" };
		ctx.save();
		ctx.lineCap = "round";
		ctx.strokeStyle = footprintStyle.broad;
		ctx.lineWidth = Math.max(16, input.camera.zoom * 1.18);
		ctx.beginPath();
		ctx.moveTo(first.x, first.y);
		ctx.lineTo(last.x, last.y);
		ctx.stroke();
		ctx.strokeStyle = footprintStyle.line;
		ctx.lineWidth = Math.max(1.5, input.camera.zoom * 0.045);
		ctx.setLineDash([7, 5]);
		ctx.stroke();
		ctx.restore();
	}

	private drawEqDraftHandles(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		draft: EqRowDraftSelection,
	): void {
		const slots = input.portSlots;
		const snappedRow = draft.rows.at(-1);
		if (!slots || !isPortSlotRow(slots, draft.anchorRow) || snappedRow === undefined) return;
		const anchor = this.portSlotScreenPosition(slots, draft.anchorRow, input.camera);
		const snapped = this.portSlotScreenPosition(slots, snappedRow, input.camera);
		const target = isPortSlotRow(slots, draft.targetRow)
			? this.portSlotScreenPosition(slots, draft.targetRow, input.camera)
			: null;
		const handleRadius = clamp(input.camera.zoom * 0.16, 6, 11);
		const handleStyle =
			draft.state === "BLOCKED"
				? { stroke: "#ff9299", fill: "rgba(229, 76, 88, 0.24)", end: "#5b242a" }
				: draft.state === "ANCHORED"
					? {
							stroke: "#b9e2ff",
							fill: "rgba(64, 132, 183, 0.3)",
							end: "#2f6f9b",
						}
					: { stroke: "#d8ffff", fill: "#173e3b", end: "#216d60" };
		ctx.save();
		ctx.lineWidth = 2.2;
		ctx.strokeStyle = handleStyle.stroke;
		ctx.fillStyle = handleStyle.fill;
		ctx.beginPath();
		ctx.arc(anchor.x, anchor.y, handleRadius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		if (snappedRow !== draft.anchorRow) {
			ctx.fillStyle = handleStyle.end;
			ctx.beginPath();
			ctx.arc(snapped.x, snapped.y, handleRadius, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		if (target && draft.targetRow !== snappedRow) {
			ctx.strokeStyle = "rgba(231, 191, 91, 0.9)";
			ctx.lineWidth = 1.5;
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo(snapped.x, snapped.y);
			ctx.lineTo(target.x, target.y);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.arc(target.x, target.y, handleRadius * 0.72, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.fillStyle = "#e8ffff";
		ctx.font = "bold 8px ui-monospace, SFMono-Regular, Menlo, monospace";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("S", anchor.x, anchor.y + 0.5);
		if (snappedRow !== draft.anchorRow) ctx.fillText("E", snapped.x, snapped.y + 0.5);
		ctx.restore();
	}

	private drawStkDraftFootprint(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		draft: StkDraftSelection,
	): void {
		const slots = input.portSlots;
		if (!slots) return;
		ctx.save();
		ctx.lineCap = "round";
		const selectedRows = new Set(draft.rows);
		for (let laneIndex = 0; laneIndex < draft.laneRows.length; laneIndex++) {
			const lane = draft.laneRows[laneIndex];
			const firstRow = lane?.[0];
			const lastRow = lane?.at(-1);
			if (
				firstRow === undefined ||
				lastRow === undefined ||
				!isPortSlotRow(slots, firstRow) ||
				!isPortSlotRow(slots, lastRow)
			) {
				continue;
			}
			const first = this.portSlotScreenPosition(slots, firstRow, input.camera);
			if (lane.length < 2) continue;
			const last = this.portSlotScreenPosition(slots, lastRow, input.camera);
			ctx.setLineDash([]);
			ctx.strokeStyle = "rgba(5, 9, 9, 0.72)";
			ctx.lineWidth = Math.max(22, input.camera.zoom * 1.02);
			ctx.beginPath();
			ctx.moveTo(first.x, first.y);
			ctx.lineTo(last.x, last.y);
			ctx.stroke();
			ctx.strokeStyle = draft.canComplete ? "rgba(184, 139, 47, 0.34)" : "rgba(151, 117, 48, 0.24)";
			ctx.lineWidth = Math.max(16, input.camera.zoom * 0.78);
			ctx.beginPath();
			ctx.moveTo(first.x, first.y);
			ctx.lineTo(last.x, last.y);
			ctx.stroke();
			ctx.strokeStyle = draft.canComplete
				? "rgba(246, 216, 132, 0.98)"
				: "rgba(223, 189, 99, 0.76)";
			ctx.lineWidth = Math.max(2.4, input.camera.zoom * 0.06);
			ctx.setLineDash([8, 5]);
			ctx.beginPath();
			ctx.moveTo(first.x, first.y);
			ctx.lineTo(last.x, last.y);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.strokeStyle = draft.canComplete
				? "rgba(246, 216, 132, 0.62)"
				: "rgba(223, 189, 99, 0.48)";
			ctx.lineWidth = 1.6;
			for (const row of lane) {
				if (selectedRows.has(row) || !isPortSlotRow(slots, row)) continue;
				const center = this.portSlotScreenPosition(slots, row, input.camera);
				const tangent = rotatePoint(
					{
						x: slots.tangents[row * 2] as number,
						y: slots.tangents[row * 2 + 1] as number,
					},
					input.camera.rotation,
				);
				const normal = { x: -tangent.y, y: tangent.x };
				const halfTick = clamp(input.camera.zoom * 0.12, 4, 7);
				ctx.beginPath();
				ctx.moveTo(center.x - normal.x * halfTick, center.y - normal.y * halfTick);
				ctx.lineTo(center.x + normal.x * halfTick, center.y + normal.y * halfTick);
				ctx.stroke();
			}
			const spanLength = Math.hypot(last.x - first.x, last.y - first.y);
			if (spanLength >= 90 && input.camera.zoom >= 18) {
				const tangentLength = Math.max(1e-6, spanLength);
				const normalX = -(last.y - first.y) / tangentLength;
				const normalY = (last.x - first.x) / tangentLength;
				const labelOffset = Math.max(15, input.camera.zoom * 0.58);
				ctx.fillStyle = draft.canComplete ? "#f5d680" : "#c6aa67";
				ctx.font = "bold 10px ui-monospace, SFMono-Regular, Menlo, monospace";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(
					"RESERVED SPAN",
					(first.x + last.x) / 2 + normalX * labelOffset,
					(first.y + last.y) / 2 + normalY * labelOffset,
				);
			}
			ctx.fillStyle = draft.canComplete ? "#f0cf73" : "#b89b55";
			for (const endpoint of [first, last]) {
				ctx.beginPath();
				ctx.arc(endpoint.x, endpoint.y, clamp(input.camera.zoom * 0.12, 5, 8), 0, Math.PI * 2);
				ctx.fill();
			}
		}
		ctx.restore();
	}

	private drawPortDraftMarker(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		row: number,
		valid: boolean,
		portType: "OHB" | "EQ" | "STK",
		label?: string,
		accent = 0,
		emphasized = false,
	): void {
		const slots = input.portSlots;
		if (!slots || !isPortSlotRow(slots, row)) return;
		const rail = this.worldToScreen(
			{
				x: slots.railPositions[row * 2] as number,
				y: slots.railPositions[row * 2 + 1] as number,
			},
			input.camera,
		);
		const portWorld = {
			x: slots.worldPositions[row * 2] as number,
			y: slots.worldPositions[row * 2 + 1] as number,
		};
		const port = this.worldToScreen(portWorld, input.camera);
		const tangentTip = this.worldToScreen(
			{
				x: portWorld.x + (slots.tangents[row * 2] as number),
				y: portWorld.y + (slots.tangents[row * 2 + 1] as number),
			},
			input.camera,
		);
		ctx.save();
		ctx.strokeStyle = valid
			? portType === "STK"
				? accent === 1
					? "#79c9ec"
					: "#e3c568"
				: portType === "EQ" && accent === 2
					? "#72b7e8"
					: "#76e5c3"
			: "#ff8089";
		ctx.fillStyle = valid
			? portType === "STK"
				? accent === 1
					? "rgba(79, 167, 211, 0.34)"
					: "rgba(211, 177, 72, 0.34)"
				: portType === "EQ" && accent === 2
					? "rgba(64, 132, 183, 0.34)"
					: "rgba(71, 211, 166, 0.34)"
			: "rgba(236, 76, 88, 0.24)";
		ctx.lineWidth = portType === "STK" ? (emphasized ? 3.2 : 2.4) : 1.8;
		if (portType === "STK") {
			ctx.shadowColor = valid ? "rgba(246, 216, 132, 0.56)" : "rgba(240, 92, 101, 0.48)";
			ctx.shadowBlur = emphasized ? 9 : 5;
		}
		ctx.beginPath();
		ctx.moveTo(rail.x, rail.y);
		ctx.lineTo(port.x, port.y);
		ctx.stroke();
		ctx.translate(port.x, port.y);
		ctx.rotate(Math.atan2(tangentTip.y - port.y, tangentTip.x - port.x));
		const width =
			portType === "STK"
				? emphasized
					? clamp(input.camera.zoom * 0.48, 20, 28)
					: clamp(input.camera.zoom * 0.38, 16, 23)
				: input.camera.zoom * (portType === "EQ" ? 0.22 : 0.46);
		const height =
			portType === "STK" ? width : input.camera.zoom * (portType === "EQ" ? 0.22 : 0.28);
		if (portType === "EQ") {
			ctx.beginPath();
			ctx.arc(0, 0, clamp(width / 2, 4, 8), 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		} else if (portType === "STK") {
			if (emphasized) {
				ctx.beginPath();
				ctx.arc(0, 0, width * 0.66, 0, Math.PI * 2);
				ctx.stroke();
			}
			ctx.rotate(Math.PI / 4);
			ctx.fillRect(-width / 2, -height / 2, width, height);
			ctx.strokeRect(-width / 2, -height / 2, width, height);
		} else {
			roundRect(ctx, -width / 2, -height / 2, width, height, Math.min(4, height * 0.25));
			ctx.fill();
			ctx.stroke();
		}
		if (!valid) {
			ctx.beginPath();
			ctx.moveTo(-width * 0.18, -height * 0.25);
			ctx.lineTo(width * 0.18, height * 0.25);
			ctx.moveTo(width * 0.18, -height * 0.25);
			ctx.lineTo(-width * 0.18, height * 0.25);
			ctx.stroke();
		} else if (label && portType !== "OHB" && input.camera.zoom >= 18) {
			ctx.rotate(portType === "STK" ? -Math.PI / 4 : 0);
			ctx.fillStyle =
				portType === "STK"
					? accent === 1
						? "#e2f6ff"
						: "#fff5c5"
					: portType === "EQ" && accent === 2
						? "#e6f5ff"
						: "#eafff8";
			ctx.font = `${portType === "STK" ? (emphasized ? "bold 11px" : "bold 10px") : "bold 7px"} ui-monospace, SFMono-Regular, Menlo, monospace`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(label, 0, 0.5);
		}
		ctx.restore();
	}

	private portSlotScreenPosition(
		slots: CompiledPortSlots,
		row: number,
		camera: Camera,
	): { readonly x: number; readonly y: number } {
		return this.worldToScreen(
			{
				x: slots.worldPositions[row * 2] as number,
				y: slots.worldPositions[row * 2 + 1] as number,
			},
			camera,
		);
	}

	private portSlotStatus(input: TileRenderInput, row: number): number {
		const slots = input.portSlots;
		if (!slots) return PORT_SLOT_STATUS.ATTACHMENT_INVALID;
		return (
			input.portSlotAvailability?.statusFor(
				slots,
				row,
				input.ignoredPortIdForPortSlots ?? 0,
				input.ignoredEquipmentGroupIdForPortSlots ?? 0,
			).status ?? (slots.statuses[row] as number)
		);
	}

	private drawGrid(
		ctx: CanvasRenderingContext2D,
		camera: Camera,
		width: number,
		height: number,
	): void {
		const minX = Math.floor(-camera.offsetX / camera.zoom) - 1;
		const maxX = Math.ceil((width - camera.offsetX) / camera.zoom) + 1;
		const minY = Math.floor(-camera.offsetY / camera.zoom) - 1;
		const maxY = Math.ceil((height - camera.offsetY) / camera.zoom) + 1;
		const majorStep = gridMajorStepForZoom(camera.zoom);
		for (let y = Math.floor(minY / majorStep) * majorStep; y <= maxY; y += majorStep) {
			for (let x = Math.floor(minX / majorStep) * majorStep; x <= maxX; x += majorStep) {
				const origin = this.tileOrigin({ x, y }, camera);
				ctx.fillStyle =
					((x / majorStep + y / majorStep) & 1) === 0 ? COLORS.majorTileA : COLORS.majorTileB;
				ctx.fillRect(origin.x, origin.y, camera.zoom * majorStep, camera.zoom * majorStep);
			}
		}

		if (camera.zoom >= 12) {
			ctx.strokeStyle = COLORS.grid;
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (let x = minX; x <= maxX; x++) {
				if (x % majorStep === 0) continue;
				const screenX = x * camera.zoom + camera.offsetX;
				ctx.moveTo(screenX, 0);
				ctx.lineTo(screenX, height);
			}
			for (let y = minY; y <= maxY; y++) {
				if (y % majorStep === 0) continue;
				const screenY = y * camera.zoom + camera.offsetY;
				ctx.moveTo(0, screenY);
				ctx.lineTo(width, screenY);
			}
			ctx.stroke();
		}

		for (const axis of ["x", "y"] as const) {
			ctx.beginPath();
			for (
				let value = Math.floor((axis === "x" ? minX : minY) / majorStep) * majorStep;
				value <= (axis === "x" ? maxX : maxY);
				value += majorStep
			) {
				const screen = value * camera.zoom + (axis === "x" ? camera.offsetX : camera.offsetY);
				ctx.strokeStyle = value === 0 ? COLORS.gridAxis : COLORS.gridMajor;
				ctx.lineWidth = value === 0 ? 1.4 : 1;
				ctx.moveTo(axis === "x" ? screen : 0, axis === "x" ? 0 : screen);
				ctx.lineTo(axis === "x" ? screen : width, axis === "x" ? height : screen);
			}
			ctx.stroke();
		}
	}

	private drawRails(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const { map, physicalPaths, camera, width, height } = input;
		const visible = visibleBounds(
			camera,
			width,
			height,
			Math.max(2, (this.physicalPresentation?.maxLateralExtentMeters ?? 0) + 0.25),
		);
		const visiblePathIndices = this.visiblePathBuffer;
		visiblePathIndices.length = 0;
		this.physicalPathSpatialIndex?.query(visible, visiblePathIndices);
		this.visiblePathCandidates = visiblePathIndices.length;
		const visibleCells = new Map<string, Cell>();
		const showCellDetails = camera.zoom >= 6;
		if (showCellDetails) {
			for (const pathIndex of visiblePathIndices) {
				const coverageStart = physicalPaths.coverageOffsets[pathIndex] as number;
				const coverageEnd = physicalPaths.coverageOffsets[pathIndex + 1] as number;
				for (let coverageIndex = coverageStart; coverageIndex < coverageEnd; coverageIndex++) {
					const cellOffset = coverageIndex * 2;
					const cell = {
						x: physicalPaths.coverageCells[cellOffset] as number,
						y: physicalPaths.coverageCells[cellOffset + 1] as number,
					};
					visibleCells.set(cellKey(cell.x, cell.y), cell);
				}
			}
		}

		for (const cell of visibleCells.values()) {
			const origin = this.tileOrigin(cell, camera);
			ctx.fillStyle = COLORS.occupied;
			ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
			if (camera.zoom >= 18) {
				ctx.strokeStyle = COLORS.occupiedBorder;
				ctx.lineWidth = 1;
				ctx.strokeRect(origin.x + 1.5, origin.y + 1.5, camera.zoom - 3, camera.zoom - 3);
			}
		}
		const visibleSwitches = showCellDetails ? this.queryVisibleAdvancedSwitches(map, visible) : [];
		for (const switchVisual of visibleSwitches) {
			this.drawAdvancedSwitchEnvelope(ctx, switchVisual, camera, "committed");
		}

		this.drawCommittedPhysicalRail(ctx, input, visiblePathIndices);

		ctx.strokeStyle = COLORS.turnoutBlade;
		ctx.lineWidth = Math.max(1, camera.zoom * 0.03);
		this.strokePhysicalPaths(
			ctx,
			physicalPaths,
			visiblePathIndices,
			camera,
			PATH_KIND.TURNOUT_DIVERGE,
		);
		if (input.interactionFocus !== "ports") {
			this.drawPhysicalDecorations(
				ctx,
				physicalPaths,
				visiblePathIndices,
				camera,
				input.railPresentationMode ?? "profiled",
			);
		}

		for (const cell of visibleCells.values()) {
			this.drawRailDetails(ctx, cell, map.getRail(cell.x, cell.y), camera);
		}
		for (const switchVisual of visibleSwitches) {
			this.drawAdvancedSwitchDetails(ctx, switchVisual, camera, "committed");
		}
	}

	private drawAdvancedSwitchEnvelope(
		ctx: CanvasRenderingContext2D,
		visual: AdvancedSwitchVisual,
		camera: Camera,
		state: "committed" | "valid" | "invalid" | "hover" | "selected",
	): void {
		const { geometry } = visual;
		const invalid = state === "invalid";
		const active = state === "valid" || state === "hover" || state === "selected";
		const fill = invalid
			? COLORS.invalidFill
			: state === "committed"
				? COLORS.switchEnvelope
				: COLORS.switchGhostFill;
		const stroke = invalid
			? COLORS.switchConflict
			: state === "committed"
				? COLORS.switchEnvelopeBorder
				: COLORS.switchGhost;

		ctx.save();
		for (const cell of geometry.claimedCells) {
			const origin = this.tileOrigin(cell, camera);
			ctx.fillStyle = fill;
			ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
			if (active || invalid) {
				ctx.strokeStyle = stroke;
				ctx.lineWidth = state === "selected" ? 1.8 : 1;
				ctx.strokeRect(origin.x + 1.5, origin.y + 1.5, camera.zoom - 3, camera.zoom - 3);
			}
		}

		ctx.strokeStyle = invalid ? "rgba(255, 101, 112, 0.28)" : COLORS.switchThroat;
		ctx.lineWidth = Math.max(8, camera.zoom * (state === "selected" ? 0.78 : 0.68));
		ctx.lineCap = "round";
		ctx.beginPath();
		const merge = this.tileCenterAtScreen(geometry.mergeAnchor, camera);
		const branch = this.tileCenterAtScreen(geometry.branchAnchor, camera);
		ctx.moveTo(merge.x, merge.y);
		ctx.lineTo(branch.x, branch.y);
		ctx.stroke();

		ctx.strokeStyle = stroke;
		ctx.lineWidth = state === "selected" ? 2 : 1;
		ctx.setLineDash([Math.max(3, camera.zoom * 0.14), Math.max(3, camera.zoom * 0.1)]);
		for (const cell of geometry.reservedCells) {
			const origin = this.tileOrigin(cell, camera);
			ctx.strokeRect(origin.x + 3, origin.y + 3, camera.zoom - 6, camera.zoom - 6);
		}
		ctx.restore();
	}

	private drawAdvancedSwitchDetails(
		ctx: CanvasRenderingContext2D,
		visual: AdvancedSwitchVisual,
		camera: Camera,
		state: "committed" | "valid" | "invalid" | "hover" | "selected",
	): void {
		const { record, geometry } = visual;
		const invalid = state === "invalid";
		const accent = invalid
			? COLORS.switchConflict
			: state === "committed"
				? ADVANCED_SWITCH_PROFILE_COLORS[record.profileClass]
				: COLORS.switchGhost;
		const merge = this.tileCenterAtScreen(geometry.mergeAnchor, camera);
		const branch = this.tileCenterAtScreen(geometry.branchAnchor, camera);

		ctx.save();
		ctx.strokeStyle = accent;
		ctx.lineWidth = Math.max(1.5, camera.zoom * 0.045);
		ctx.setLineDash(state === "committed" ? [] : [5, 4]);
		ctx.beginPath();
		ctx.moveTo(merge.x, merge.y);
		ctx.lineTo(branch.x, branch.y);
		ctx.stroke();
		ctx.setLineDash([]);

		const throat = this.tileCenterAtScreen(geometry.sharedTrunkSupport, camera);
		const lateralVector = rotatePoint(directionVector(record.lateral), camera.rotation);
		const badge = {
			x: throat.x + lateralVector.x * camera.zoom * 0.34,
			y: throat.y + lateralVector.y * camera.zoom * 0.34,
		};
		const badgeRadius = clamp(camera.zoom * 0.12, 4, 7);
		ctx.fillStyle = COLORS.background;
		ctx.strokeStyle = accent;
		ctx.lineWidth = state === "selected" ? 2.5 : 1.5;
		ctx.beginPath();
		ctx.moveTo(badge.x, badge.y - badgeRadius);
		ctx.lineTo(badge.x + badgeRadius, badge.y);
		ctx.lineTo(badge.x, badge.y + badgeRadius);
		ctx.lineTo(badge.x - badgeRadius, badge.y);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

		if (camera.zoom >= 24) {
			ctx.fillStyle = accent;
			ctx.font = "700 8px Inter, system-ui, sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(record.profileClass, badge.x, badge.y + 0.5);
		}
		if (camera.zoom >= 34 && state === "committed") {
			ctx.fillStyle = "rgba(219, 239, 240, 0.88)";
			ctx.font = "650 8px Inter, system-ui, sans-serif";
			ctx.textAlign = "left";
			ctx.textBaseline = "alphabetic";
			ctx.fillText(`SW-${record.id} · ${record.profileClass}`, badge.x + 9, badge.y - 6);
		}

		for (const port of geometry.ports) {
			const origin = this.tileOrigin(port.cell, camera);
			const screenDirection = rotateDirection(port.direction, camera.rotation);
			const center = sidePoint(origin, camera.zoom, screenDirection);
			const color = invalid
				? COLORS.switchConflict
				: port.role === "input"
					? COLORS.switchInput
					: COLORS.switchOutput;
			this.drawAdvancedSwitchPort(ctx, center, port.role, port.index, color, camera.zoom);
			const travelDirection =
				port.role === "input" ? oppositeDirection(port.direction) : port.direction;
			const travelVector = rotatePoint(directionVector(travelDirection), camera.rotation);
			this.drawDirectionChevron(
				ctx,
				center,
				travelVector,
				camera.zoom * 0.72,
				state !== "committed",
			);
		}
		ctx.restore();
	}

	private drawAdvancedSwitchPort(
		ctx: CanvasRenderingContext2D,
		center: ScreenPoint,
		role: "input" | "output",
		index: 0 | 1,
		color: string,
		zoom: number,
	): void {
		const radius = clamp(zoom * 0.105, 3.5, 6);
		ctx.fillStyle = COLORS.background;
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.beginPath();
		if (role === "input") {
			ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
		} else {
			ctx.rect(center.x - radius, center.y - radius, radius * 2, radius * 2);
		}
		ctx.fill();
		ctx.stroke();
		if (zoom < 28) return;
		ctx.fillStyle = color;
		ctx.font = "700 7px Inter, system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(index + 1), center.x, center.y + 0.5);
	}

	private drawCommittedPhysicalRail(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		pathIndices: readonly number[],
	): void {
		this.drawPhysicalRailBody(
			ctx,
			input.physicalPaths,
			this.physicalPresentation,
			pathIndices,
			input.camera,
			input.railPresentationMode ?? "profiled",
			COMMITTED_RAIL_PALETTE,
		);
	}

	private drawPhysicalRailBody(
		ctx: CanvasRenderingContext2D,
		paths: CompiledPhysicalPaths,
		presentation: CompiledRailPresentation | null,
		pathIndices: readonly number[],
		camera: Camera,
		mode: RailPresentationMode,
		palette: PhysicalRailPalette,
		screenPaths?: PhysicalRailScreenPaths | null,
	): void {
		const centerPath =
			screenPaths?.center ?? this.buildPhysicalScreenPath(paths, pathIndices, camera, null, 0);
		const overviewWidths = overviewRailPixelWidths(camera.zoom);
		if (overviewWidths) {
			for (const layer of [
				{ color: palette.shadow, widthPixels: overviewWidths.shadow },
				{ color: palette.bed, widthPixels: overviewWidths.bed },
				{ color: palette.face, widthPixels: overviewWidths.face },
			] as const) {
				this.strokePhysicalPixelLayer(
					ctx,
					paths,
					pathIndices,
					camera,
					layer.color,
					layer.widthPixels,
					centerPath,
				);
			}
			return;
		}
		const useProfiledBeam =
			mode === "profiled" && camera.zoom >= 12 && presentation?.source === paths;
		if (!useProfiledBeam || !presentation) {
			const layers = [
				{
					color: palette.shadow,
					widthMeters: RAIL_PROFILE_METERS.constructionShadow,
				},
				{ color: palette.bed, widthMeters: RAIL_PROFILE_METERS.profileWidth },
				{ color: palette.face, widthMeters: RAIL_PROFILE_METERS.faceWidth },
				{ color: palette.slot, widthMeters: RAIL_PROFILE_METERS.slotWidth },
				{
					color: palette.highlight,
					widthMeters: RAIL_PROFILE_METERS.guideWidth,
				},
			] as const;
			for (const layer of layers) {
				this.strokePhysicalLayer(
					ctx,
					paths,
					pathIndices,
					camera,
					layer.color,
					layer.widthMeters,
					centerPath,
				);
			}
			return;
		}

		const profile = presentation.profile;
		this.strokePhysicalLayer(
			ctx,
			paths,
			pathIndices,
			camera,
			palette.shadow,
			profile.constructionShadowWidthMeters,
			centerPath,
		);
		this.strokePhysicalLayer(
			ctx,
			paths,
			pathIndices,
			camera,
			palette.bed,
			profile.bedWidthMeters,
			centerPath,
		);
		for (const [side, offset] of [
			["left", -profile.beamCenterOffsetMeters],
			["right", profile.beamCenterOffsetMeters],
		] as const) {
			const offsetPath =
				screenPaths?.[side] ??
				this.buildPhysicalScreenPath(paths, pathIndices, camera, presentation, offset);
			this.strokeOffsetPhysicalLayer(
				ctx,
				paths,
				presentation,
				pathIndices,
				camera,
				palette.beamEdge,
				profile.beamWidthMeters + 0.026,
				offset,
				offsetPath,
			);
			this.strokeOffsetPhysicalLayer(
				ctx,
				paths,
				presentation,
				pathIndices,
				camera,
				palette.face,
				profile.beamWidthMeters,
				offset,
				offsetPath,
			);
			this.strokeOffsetPhysicalLayer(
				ctx,
				paths,
				presentation,
				pathIndices,
				camera,
				palette.highlight,
				profile.beamHighlightWidthMeters,
				offset,
				offsetPath,
			);
		}
		this.strokePhysicalLayer(
			ctx,
			paths,
			pathIndices,
			camera,
			palette.slot,
			profile.slotWidthMeters,
			centerPath,
		);
	}

	private buildPhysicalScreenPath(
		paths: CompiledPhysicalPaths,
		pathIndices: readonly number[],
		camera: Camera,
		presentation: CompiledRailPresentation | null,
		lateralOffsetMeters: number,
	): Path2D | null {
		if (typeof Path2D === "undefined") return null;
		const screenPath = new Path2D();
		for (const pathIndex of pathIndices) {
			if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
			const start = paths.offsets[pathIndex] as number;
			const end = paths.offsets[pathIndex + 1] as number;
			if (end - start < 2) continue;
			for (let pointIndex = start; pointIndex < end; pointIndex++) {
				const pointOffset = pointIndex * 2;
				const screen = this.worldToScreen(
					{
						x:
							(paths.positions[pointOffset] as number) +
							(presentation?.pointNormals[pointOffset] ?? 0) * lateralOffsetMeters,
						y:
							(paths.positions[pointOffset + 1] as number) +
							(presentation?.pointNormals[pointOffset + 1] ?? 0) * lateralOffsetMeters,
					},
					camera,
				);
				if (pointIndex === start) screenPath.moveTo(screen.x, screen.y);
				else screenPath.lineTo(screen.x, screen.y);
			}
		}
		return screenPath;
	}

	private strokePhysicalLayer(
		ctx: CanvasRenderingContext2D,
		paths: CompiledPhysicalPaths,
		pathIndices: readonly number[],
		camera: Camera,
		color: string,
		widthMeters: number,
		screenPath: Path2D | null = null,
	): void {
		ctx.strokeStyle = color;
		ctx.lineWidth = Math.max(widthMeters * camera.zoom, widthMeters < 0.03 ? 1 : 0);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		if (screenPath) ctx.stroke(screenPath);
		else this.strokePhysicalPaths(ctx, paths, pathIndices, camera);
	}

	private strokePhysicalPixelLayer(
		ctx: CanvasRenderingContext2D,
		paths: CompiledPhysicalPaths,
		pathIndices: readonly number[],
		camera: Camera,
		color: string,
		widthPixels: number,
		screenPath: Path2D | null,
	): void {
		ctx.strokeStyle = color;
		ctx.lineWidth = widthPixels;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		if (screenPath) ctx.stroke(screenPath);
		else this.strokePhysicalPaths(ctx, paths, pathIndices, camera);
	}

	private strokeOffsetPhysicalLayer(
		ctx: CanvasRenderingContext2D,
		paths: CompiledPhysicalPaths,
		presentation: CompiledRailPresentation,
		pathIndices: readonly number[],
		camera: Camera,
		color: string,
		widthMeters: number,
		lateralOffsetMeters: number,
		screenPath: Path2D | null = null,
	): void {
		ctx.strokeStyle = color;
		ctx.lineWidth = Math.max(1, widthMeters * camera.zoom);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		if (screenPath) {
			ctx.stroke(screenPath);
			return;
		}
		ctx.beginPath();
		for (const pathIndex of pathIndices) {
			if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
			const start = paths.offsets[pathIndex] as number;
			const end = paths.offsets[pathIndex + 1] as number;
			if (end - start < 2) continue;
			for (let pointIndex = start; pointIndex < end; pointIndex++) {
				const pointOffset = pointIndex * 2;
				const screen = this.worldToScreen(
					{
						x:
							(paths.positions[pointOffset] as number) +
							(presentation.pointNormals[pointOffset] as number) * lateralOffsetMeters,
						y:
							(paths.positions[pointOffset + 1] as number) +
							(presentation.pointNormals[pointOffset + 1] as number) * lateralOffsetMeters,
					},
					camera,
				);
				if (pointIndex === start) ctx.moveTo(screen.x, screen.y);
				else ctx.lineTo(screen.x, screen.y);
			}
		}
		ctx.stroke();
	}

	private drawPhysicalDecorations(
		ctx: CanvasRenderingContext2D,
		paths: CompiledPhysicalPaths,
		pathIndices: readonly number[],
		camera: Camera,
		mode: RailPresentationMode,
	): void {
		const presentation = this.physicalPresentation;
		if (!presentation || presentation.source !== paths) return;
		const { decorations, profile } = presentation;
		const flowStride = physicalFlowMarkerStride(camera.zoom, profile.flowIntervalMeters);
		const minimumFlowRunMeters = overviewFlowMinimumRunMeters(camera.zoom);
		const overviewFlowCellPixels = overviewFlowMarkerCellPixels(camera.zoom);
		const overviewFlowCells = overviewFlowCellPixels === null ? null : new Set<string>();
		const compactFlowRuns = camera.zoom < 10 ? new Set<number>() : null;
		for (const pathIndex of pathIndices) {
			const start = decorations.pathOffsets[pathIndex] as number;
			const end = decorations.pathOffsets[pathIndex + 1] as number;
			for (let index = start; index < end; index++) {
				const priority = decorations.priorities[index] as number;
				const kind = decorations.kinds[index] as RailDecorationKind;
				const flow =
					kind === RAIL_DECORATION_KIND.FLOW || kind === RAIL_DECORATION_KIND.FLOW_COMPACT;
				if (mode === "centerline" && !flow) continue;
				if (!overviewPhysicalDecorationVisible(kind, priority, camera.zoom)) continue;
				const runIndex = decorations.runIndices[index] as number;
				const runLength = presentation.runs.lengths[runIndex] as number;
				if (flow && runLength < minimumFlowRunMeters) continue;
				if (kind === RAIL_DECORATION_KIND.FLOW_COMPACT && compactFlowRuns) {
					if (compactFlowRuns.has(runIndex)) continue;
					compactFlowRuns.add(runIndex);
				}
				if (kind === RAIL_DECORATION_KIND.FLOW && flowStride > 1) {
					const markerCount = Math.max(1, Math.floor(runLength / profile.flowIntervalMeters));
					const firstStation = (runLength - (markerCount - 1) * profile.flowIntervalMeters) / 2;
					const markerOrdinal = Math.max(
						0,
						Math.round(
							((decorations.runStations[index] as number) - firstStation) /
								profile.flowIntervalMeters,
						),
					);
					if (markerOrdinal % flowStride !== 0) continue;
				}
				const pointOffset = index * 2;
				const worldX = decorations.positions[pointOffset] as number;
				const worldY = decorations.positions[pointOffset + 1] as number;
				const center = this.worldToScreen(
					{
						x: worldX,
						y: worldY,
					},
					camera,
				);
				const tangent = rotatePoint(
					{
						x: decorations.tangents[pointOffset] as number,
						y: decorations.tangents[pointOffset + 1] as number,
					},
					camera.rotation,
				);
				if (flow) {
					if (overviewFlowCells && overviewFlowCellPixels !== null) {
						const horizontal = Math.abs(tangent.x) >= Math.abs(tangent.y);
						const direction = horizontal
							? tangent.x >= 0
								? "E"
								: "W"
							: tangent.y >= 0
								? "S"
								: "N";
						const bucket = overviewFlowMarkerBucket(
							worldX,
							worldY,
							direction,
							camera.zoom,
							overviewFlowCellPixels,
						);
						if (overviewFlowCells.has(bucket)) continue;
						overviewFlowCells.add(bucket);
					}
					this.drawDirectionChevron(
						ctx,
						center,
						tangent,
						camera.zoom,
						false,
						kind === RAIL_DECORATION_KIND.FLOW_COMPACT || camera.zoom < 10,
					);
					continue;
				}
				const support = kind === RAIL_DECORATION_KIND.SUPPORT;
				const halfSpanMeters = support
					? profile.supportHalfSpanMeters
					: profile.jointHalfSpanMeters;
				this.drawPhysicalCrossbar(ctx, center, tangent, camera.zoom, halfSpanMeters, kind);
			}
		}
	}

	private drawPhysicalCrossbar(
		ctx: CanvasRenderingContext2D,
		center: ScreenPoint,
		tangent: ScreenPoint,
		zoom: number,
		halfSpanMeters: number,
		kind: RailDecorationKind,
	): void {
		const perpendicular = { x: -tangent.y, y: tangent.x };
		const halfSpan = halfSpanMeters * zoom;
		const from = {
			x: center.x - perpendicular.x * halfSpan,
			y: center.y - perpendicular.y * halfSpan,
		};
		const to = {
			x: center.x + perpendicular.x * halfSpan,
			y: center.y + perpendicular.y * halfSpan,
		};
		const support = kind === RAIL_DECORATION_KIND.SUPPORT;
		const color =
			kind === RAIL_DECORATION_KIND.SWITCH_JOINT
				? COLORS.turnoutBlade
				: kind === RAIL_DECORATION_KIND.PROFILE_JOINT
					? "#d7e5e6"
					: support
						? "#80979a"
						: "#b79a52";
		const stroke = (strokeStyle: string, lineWidth: number): void => {
			ctx.strokeStyle = strokeStyle;
			ctx.lineWidth = lineWidth;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(from.x, from.y);
			ctx.lineTo(to.x, to.y);
			ctx.stroke();
		};
		stroke(COLORS.directionHalo, support ? 5 : 4);
		stroke(color, support ? 2 : 1.4);
		if (!support || zoom < 28) return;
		ctx.fillStyle = COLORS.turnoutBlade;
		for (const point of [from, to]) {
			ctx.beginPath();
			ctx.arc(point.x, point.y, 1.6, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private strokePhysicalPaths(
		ctx: CanvasRenderingContext2D,
		physicalPaths: CompiledPhysicalPaths,
		pathIndices: readonly number[],
		camera: Camera,
		kindFilter?: number,
	): void {
		ctx.beginPath();
		for (const pathIndex of pathIndices) {
			const kind = physicalPaths.kinds[pathIndex] as number;
			if (kind === PATH_KIND.INVALID || (kindFilter !== undefined && kind !== kindFilter)) continue;
			const start = physicalPaths.offsets[pathIndex] as number;
			const end = physicalPaths.offsets[pathIndex + 1] as number;
			if (end - start < 2) continue;
			for (let pointIndex = start; pointIndex < end; pointIndex++) {
				const positionOffset = pointIndex * 2;
				const screen = this.worldToScreen(
					{
						x: physicalPaths.positions[positionOffset] as number,
						y: physicalPaths.positions[positionOffset + 1] as number,
					},
					camera,
				);
				if (pointIndex === start) ctx.moveTo(screen.x, screen.y);
				else ctx.lineTo(screen.x, screen.y);
			}
		}
		ctx.stroke();
	}

	private resolveHoverPhysicalHit(input: TileRenderInput): PhysicalPathHit | null {
		const { hoverTile, hoverWorld, ghost, physicalPaths, camera } = input;
		if (!hoverTile || !hoverWorld || ghost || this.boundPhysicalPaths !== physicalPaths)
			return null;
		const candidates = this.pathIndicesByCell.get(cellKey(hoverTile.x, hoverTile.y));
		if (!candidates) return null;
		return hitTestPhysicalPaths(
			physicalPaths,
			candidates,
			hoverWorld,
			clamp(8 / camera.zoom, 0.18, 0.32),
		);
	}

	private drawDownstreamFlow(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		hit: PhysicalPathHit | null,
	): void {
		const { physicalPaths, camera } = input;
		if (!hit) return;
		const trace = this.downstreamTrace(physicalPaths, hit);
		if (trace.length === 0) return;
		const pathIndices = this.flowPathIndices;

		ctx.save();
		ctx.strokeStyle = COLORS.flowGlow;
		ctx.lineWidth = 8;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		this.strokePhysicalPaths(ctx, physicalPaths, pathIndices, camera);
		ctx.strokeStyle = COLORS.flowDirection;
		ctx.globalAlpha = 0.86;
		ctx.lineWidth = 2;
		ctx.setLineDash([10, 14]);
		this.strokePhysicalPaths(ctx, physicalPaths, pathIndices, camera);
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
		this.drawFlowChevrons(ctx, physicalPaths, trace, hit, camera);
		ctx.restore();
	}

	private downstreamTrace(
		physicalPaths: CompiledPhysicalPaths,
		hit: PhysicalPathHit,
	): readonly PhysicalFlowTraceEntry[] {
		const quantizedDistance = Math.floor(hit.distanceMeters * 4);
		const key = `${hit.pathIndex}:${quantizedDistance}`;
		if (this.flowCacheKey === key) return this.flowTrace;
		this.flowCacheKey = key;
		const quantizedHit = { ...hit, distanceMeters: quantizedDistance / 4 };
		this.flowTrace = tracePhysicalPathFlow(
			physicalPaths,
			this.physicalAdjacency,
			quantizedHit,
			12,
			64,
		);
		this.flowPathIndices = this.flowTrace.map((entry) => entry.pathIndex);
		return this.flowTrace;
	}

	private drawFlowChevrons(
		ctx: CanvasRenderingContext2D,
		physicalPaths: CompiledPhysicalPaths,
		trace: readonly PhysicalFlowTraceEntry[],
		hit: PhysicalPathHit,
		camera: Camera,
	): void {
		const spacingMeters = 72 / camera.zoom;
		const insetMeters = Math.max(0.12, 6 / camera.zoom);
		for (const entry of trace) {
			const pathLength = physicalPaths.lengths[entry.pathIndex] as number;
			const firstGlobalMarker =
				Math.ceil(Math.max(0.45, entry.pathStartMeters + insetMeters) / spacingMeters) *
				spacingMeters;
			for (
				let globalDistance = firstGlobalMarker;
				globalDistance <= 12;
				globalDistance += spacingMeters
			) {
				const localDistance = globalDistance - entry.pathStartMeters;
				if (localDistance < insetMeters || localDistance > pathLength - insetMeters) continue;
				this.drawChevronAtPath(ctx, physicalPaths, entry.pathIndex, localDistance, camera, true);
			}
		}
		const startLength = physicalPaths.lengths[hit.pathIndex] as number;
		const immediateDistance = Math.min(startLength - insetMeters, hit.distanceMeters + 0.32);
		if (immediateDistance >= insetMeters) {
			this.drawChevronAtPath(ctx, physicalPaths, hit.pathIndex, immediateDistance, camera, true);
		}
	}

	private drawChevronAtPath(
		ctx: CanvasRenderingContext2D,
		physicalPaths: CompiledPhysicalPaths,
		pathIndex: number,
		distanceMeters: number,
		camera: Camera,
		active: boolean,
	): void {
		const sample = samplePhysicalPath(physicalPaths, pathIndex, distanceMeters);
		if (!sample) return;
		const center = this.worldToScreen({ x: sample.x, y: sample.y }, camera);
		const tangent = rotatePoint({ x: sample.tangentX, y: sample.tangentY }, camera.rotation);
		this.drawDirectionChevron(ctx, center, tangent, camera.zoom, active);
	}

	private queryVisibleAdvancedSwitches(
		map: TileMap,
		bounds: { minX: number; maxX: number; minY: number; maxY: number },
	): readonly AdvancedSwitchVisual[] {
		if (this.advancedSwitchMap !== map || this.advancedSwitchRevision !== map.getRevision()) {
			this.rebuildAdvancedSwitchIndex(map);
		}
		const visible = this.visibleAdvancedSwitchBuffer;
		visible.length = 0;
		if (this.advancedSwitchVisuals.length === 0) {
			this.visibleAdvancedSwitchCount = 0;
			return visible;
		}

		this.advancedSwitchVisitGeneration++;
		if (this.advancedSwitchVisitGeneration === 0xffff_ffff) {
			this.advancedSwitchVisitStamps.fill(0);
			this.advancedSwitchVisitGeneration = 1;
		}
		const generation = this.advancedSwitchVisitGeneration;
		const minChunkX = Math.floor(bounds.minX / ADVANCED_SWITCH_INDEX_CHUNK_SIZE);
		const maxChunkX = Math.floor(bounds.maxX / ADVANCED_SWITCH_INDEX_CHUNK_SIZE);
		const minChunkY = Math.floor(bounds.minY / ADVANCED_SWITCH_INDEX_CHUNK_SIZE);
		const maxChunkY = Math.floor(bounds.maxY / ADVANCED_SWITCH_INDEX_CHUNK_SIZE);
		for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const bucket = this.advancedSwitchBuckets.get(cellKey(chunkX, chunkY));
				if (!bucket) continue;
				for (const index of bucket) {
					if (this.advancedSwitchVisitStamps[index] === generation) continue;
					this.advancedSwitchVisitStamps[index] = generation;
					const visual = this.advancedSwitchVisuals[index];
					if (!visual || !boundsOverlap(visual.bounds, bounds)) continue;
					visible.push(visual);
				}
			}
		}
		this.visibleAdvancedSwitchCount = visible.length;
		return visible;
	}

	private rebuildAdvancedSwitchIndex(map: TileMap): void {
		const visuals: IndexedAdvancedSwitchVisual[] = [];
		const mutableBuckets = new Map<string, number[]>();
		map.forEachAdvancedSwitch((record) => {
			const geometry = deriveAdvancedSwitchGeometry(record);
			const bounds = cellBounds(geometry.claimedCells);
			const index = visuals.length;
			visuals.push({ record, geometry, bounds });
			const minChunkX = Math.floor(bounds.minX / ADVANCED_SWITCH_INDEX_CHUNK_SIZE);
			const maxChunkX = Math.floor(bounds.maxX / ADVANCED_SWITCH_INDEX_CHUNK_SIZE);
			const minChunkY = Math.floor(bounds.minY / ADVANCED_SWITCH_INDEX_CHUNK_SIZE);
			const maxChunkY = Math.floor(bounds.maxY / ADVANCED_SWITCH_INDEX_CHUNK_SIZE);
			for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
				for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
					const key = cellKey(chunkX, chunkY);
					const bucket = mutableBuckets.get(key);
					if (bucket) bucket.push(index);
					else mutableBuckets.set(key, [index]);
				}
			}
		});
		this.advancedSwitchMap = map;
		this.advancedSwitchRevision = map.getRevision();
		this.advancedSwitchVisuals = visuals;
		this.advancedSwitchBuckets = new Map(
			[...mutableBuckets].map(([key, indices]) => [key, Uint32Array.from(indices)]),
		);
		this.advancedSwitchVisitStamps = new Uint32Array(visuals.length);
		this.advancedSwitchVisitGeneration = 0;
		this.advancedSwitchIndexBuilds++;
	}

	private strokeRailCell(
		ctx: CanvasRenderingContext2D,
		cell: Cell,
		rail: RailCell,
		camera: Camera,
	): void {
		for (const route of routesForRail(rail)) this.strokeRoute(ctx, cell, route, camera);
	}

	private strokeRoute(
		ctx: CanvasRenderingContext2D,
		cell: Cell,
		route: LocalRoute,
		camera: Camera,
	): void {
		ctx.beginPath();
		this.traceRoute(ctx, cell, route, camera);
		ctx.stroke();
	}

	private traceRailCell(
		ctx: Pick<CanvasRenderingContext2D, "arc" | "lineTo" | "moveTo">,
		cell: Cell,
		rail: RailCell,
		camera: Camera,
	): void {
		for (const route of routesForRail(rail)) this.traceRoute(ctx, cell, route, camera);
	}

	private traceRoute(
		ctx: Pick<CanvasRenderingContext2D, "arc" | "lineTo" | "moveTo">,
		cell: Cell,
		route: LocalRoute,
		camera: Camera,
	): void {
		const origin = this.tileOrigin(cell, camera);
		const size = camera.zoom;
		const center = { x: origin.x + size / 2, y: origin.y + size / 2 };
		const fromDirection = route.from === null ? null : rotateDirection(route.from, camera.rotation);
		const toDirection = route.to === null ? null : rotateDirection(route.to, camera.rotation);
		const from = fromDirection === null ? center : sidePoint(origin, size, fromDirection);
		const to = toDirection === null ? center : sidePoint(origin, size, toDirection);

		if (fromDirection === null || toDirection === null || areOpposite(fromDirection, toDirection)) {
			ctx.moveTo(from.x, from.y);
			ctx.lineTo(to.x, to.y);
			return;
		}

		const mask = fromDirection | toDirection;
		const arc = cornerArc(origin, size, mask);
		ctx.moveTo(arc.x + Math.cos(arc.start) * (size / 2), arc.y + Math.sin(arc.start) * (size / 2));
		ctx.arc(arc.x, arc.y, size / 2, arc.start, arc.end);
	}

	private drawRailDetails(
		ctx: CanvasRenderingContext2D,
		cell: Cell,
		rail: RailCell,
		camera: Camera,
	): void {
		const center = this.tileCenterAtScreen(cell, camera);
		const degree = bitCount(rail.incoming | rail.outgoing);
		if (degree === 3) {
			const safe = isTangentJunction(rail.incoming, rail.outgoing);
			const tangentSide = tangentJunctionSide(rail.incoming, rail.outgoing);
			const marker = tangentSide
				? sidePoint(
						this.tileOrigin(cell, camera),
						camera.zoom,
						rotateDirection(tangentSide, camera.rotation),
					)
				: center;
			ctx.fillStyle = safe ? COLORS.junction : COLORS.unsafeJunction;
			ctx.beginPath();
			ctx.arc(marker.x, marker.y, Math.max(2.5, camera.zoom * 0.075), 0, Math.PI * 2);
			ctx.fill();
			if (!safe) {
				ctx.strokeStyle = COLORS.unsafeJunction;
				ctx.lineWidth = Math.max(1.5, camera.zoom * 0.04);
				ctx.beginPath();
				ctx.arc(center.x, center.y, Math.max(6, camera.zoom * 0.2), 0, Math.PI * 2);
				ctx.stroke();
			}
		}
		if (rail.incoming === 0 || rail.outgoing === 0) {
			ctx.strokeStyle = COLORS.endpoint;
			ctx.lineWidth = Math.max(1.5, camera.zoom * 0.045);
			ctx.beginPath();
			ctx.arc(center.x, center.y, Math.max(4, camera.zoom * 0.15), 0, Math.PI * 2);
			ctx.stroke();
		}
	}

	private drawDirectionChevron(
		ctx: CanvasRenderingContext2D,
		center: ScreenPoint,
		vector: ScreenPoint,
		size: number,
		active: boolean,
		compact = false,
	): void {
		const perpendicular = { x: -vector.y, y: vector.x };
		const glyphLength = compact
			? clamp(size * 0.16, 5, 8)
			: clamp(size * (active ? 0.31 : 0.28), active ? 10 : 9, active ? 17 : 15);
		const halfWidth = compact
			? clamp(size * 0.055, 2, 3)
			: clamp(size * (active ? 0.1 : 0.09), 3, active ? 6 : 5);
		const pairGap = glyphLength * 0.36;
		const shifts = active && !compact ? [-pairGap / 2, pairGap / 2] : [0];
		const draw = (): void => {
			ctx.beginPath();
			for (const shift of shifts) {
				const tipDistance = shift + glyphLength * 0.28;
				const shoulderDistance = shift - glyphLength * 0.22;
				const tip = {
					x: center.x + vector.x * tipDistance,
					y: center.y + vector.y * tipDistance,
				};
				const shoulder = {
					x: center.x + vector.x * shoulderDistance,
					y: center.y + vector.y * shoulderDistance,
				};
				ctx.moveTo(
					shoulder.x + perpendicular.x * halfWidth,
					shoulder.y + perpendicular.y * halfWidth,
				);
				ctx.lineTo(tip.x, tip.y);
				ctx.lineTo(
					shoulder.x - perpendicular.x * halfWidth,
					shoulder.y - perpendicular.y * halfWidth,
				);
			}
			ctx.stroke();
		};

		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = active ? COLORS.flowHalo : COLORS.directionHalo;
		ctx.lineWidth = compact ? (active ? 4 : 3) : active ? 5 : 4;
		draw();
		ctx.strokeStyle = active ? COLORS.flowDirection : COLORS.direction;
		ctx.lineWidth = compact ? (active ? 2 : 1.5) : active ? 2.5 : 2;
		draw();
	}

	private drawDraftClearanceCorridor(
		ctx: CanvasRenderingContext2D,
		evaluation: RailDraftEvaluation,
		camera: Camera,
	): void {
		const envelopes = evaluation.envelopes;
		if (!envelopes || envelopes.count === 0) return;
		ctx.save();
		ctx.strokeStyle = evaluation.valid ? COLORS.clearanceValidFill : COLORS.invalidFill;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (let envelopeIndex = 0; envelopeIndex < envelopes.count; envelopeIndex++) {
			const start = this.worldToScreen(
				{
					x: envelopes.startPoints[envelopeIndex * 2] as number,
					y: envelopes.startPoints[envelopeIndex * 2 + 1] as number,
				},
				camera,
			);
			const end = this.worldToScreen(
				{
					x: envelopes.endPoints[envelopeIndex * 2] as number,
					y: envelopes.endPoints[envelopeIndex * 2 + 1] as number,
				},
				camera,
			);
			const radiusMeters =
				((envelopes.installationRadiusMillimeters[envelopeIndex] as number) +
					(envelopes.approximationToleranceMillimeters[envelopeIndex] as number)) /
				1_000;
			ctx.lineWidth = Math.max(1, radiusMeters * 2 * camera.zoom);
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
		}
		ctx.restore();
	}

	private drawRailTemplateFootprint(
		ctx: CanvasRenderingContext2D,
		plan: RailTemplatePlan,
		feedback: RailTemplatePlacementFeedback,
		camera: Camera,
	): void {
		const valid = feedback.state === "ready";
		const occupiedKeys = new Set(
			plan.template.occupiedCells.map((cell) => cellKey(cell.x, cell.y)),
		);
		ctx.save();
		ctx.fillStyle = valid ? COLORS.templateReservation : COLORS.invalidFill;
		ctx.strokeStyle = valid ? COLORS.templateReservationBorder : COLORS.invalid;
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 3]);
		for (const cell of plan.template.hardReservedCells) {
			if (occupiedKeys.has(cellKey(cell.x, cell.y))) continue;
			const origin = this.tileOrigin(cell, camera);
			ctx.fillRect(origin.x + 2, origin.y + 2, camera.zoom - 4, camera.zoom - 4);
			ctx.strokeRect(origin.x + 2.5, origin.y + 2.5, camera.zoom - 5, camera.zoom - 5);
		}

		const bounds = feedback.reservation.bounds;
		const corners = [
			this.worldToScreen({ x: bounds.minX, y: bounds.minY }, camera),
			this.worldToScreen({ x: bounds.maxX + 1, y: bounds.minY }, camera),
			this.worldToScreen({ x: bounds.maxX + 1, y: bounds.maxY + 1 }, camera),
			this.worldToScreen({ x: bounds.minX, y: bounds.maxY + 1 }, camera),
		];
		const left = Math.min(...corners.map((corner) => corner.x));
		const top = Math.min(...corners.map((corner) => corner.y));
		const right = Math.max(...corners.map((corner) => corner.x));
		const bottom = Math.max(...corners.map((corner) => corner.y));
		ctx.setLineDash([7, 5]);
		ctx.strokeRect(left + 1, top + 1, right - left - 2, bottom - top - 2);
		ctx.setLineDash([]);
		ctx.fillStyle = valid ? COLORS.templateTerminal : COLORS.invalid;
		ctx.font = "700 8px Inter, system-ui, sans-serif";
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(`RESERVED ${feedback.reservation.cellCount}`, left + 4, top - 5);

		for (const handle of feedback.handles) {
			this.drawRailTemplateTerminalHandle(ctx, handle, camera, valid);
		}
		ctx.restore();
	}

	private drawRailTemplateTerminalHandle(
		ctx: CanvasRenderingContext2D,
		handle: RailTemplatePlacementHandle,
		camera: Camera,
		valid: boolean,
	): void {
		const center = this.tileCenterAtScreen(handle.cell, camera);
		const vector = rotatePoint(directionVector(handle.travelDirection), camera.rotation);
		const radius = clamp(camera.zoom * 0.14, 5, 7);
		const semanticColor =
			handle.kind === "entry" ? "#76dce4" : handle.kind === "exit" ? "#efc76d" : "#d7e7e8";
		const accent = valid ? semanticColor : COLORS.invalid;
		ctx.fillStyle = handle.kind === "exit" ? semanticColor : COLORS.background;
		ctx.strokeStyle = accent;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		if (handle.kind === "origin") {
			ctx.beginPath();
			ctx.arc(center.x, center.y, Math.max(2, radius - 3), 0, Math.PI * 2);
			ctx.stroke();
		}

		const rayStart = radius + 2;
		const rayEnd = radius + 9;
		const tip = {
			x: center.x + vector.x * rayEnd,
			y: center.y + vector.y * rayEnd,
		};
		const perpendicular = { x: -vector.y, y: vector.x };
		ctx.beginPath();
		ctx.moveTo(center.x + vector.x * rayStart, center.y + vector.y * rayStart);
		ctx.lineTo(tip.x, tip.y);
		ctx.moveTo(tip.x, tip.y);
		ctx.lineTo(
			tip.x - vector.x * 4 + perpendicular.x * 2.5,
			tip.y - vector.y * 4 + perpendicular.y * 2.5,
		);
		ctx.moveTo(tip.x, tip.y);
		ctx.lineTo(
			tip.x - vector.x * 4 - perpendicular.x * 2.5,
			tip.y - vector.y * 4 - perpendicular.y * 2.5,
		);
		ctx.stroke();

		ctx.font = "750 8px Inter, system-ui, sans-serif";
		ctx.textAlign = "left";
		ctx.textBaseline = "bottom";
		ctx.fillStyle = accent;
		ctx.fillText(handle.label, center.x + 9, center.y - 7);
	}

	private drawStaticFabOrganizationBundlePlacementPreview(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		this.organizationBundlePreviewVisibleChunks = 0;
		this.organizationBundlePreviewVisibleCells = 0;
		this.organizationBundlePreviewVisiblePorts = 0;
		this.organizationBundlePreviewCellBuffer.length = 0;
		this.organizationBundlePreviewPortBuffer.length = 0;
		this.organizationBundlePreviewGroupBuffer.length = 0;
		const preview = input.organizationBundlePreview;
		if (!preview) return;

		const artifact = preview.artifact;
		if (this.organizationBundlePreviewArtifact !== artifact) {
			this.organizationBundlePreviewArtifact = artifact;
			this.organizationBundlePreviewCellStamps = new Uint32Array(artifact.footprintCellCount);
			this.organizationBundlePreviewPortStamps = new Uint32Array(artifact.portCount);
			this.organizationBundlePreviewGroupStamps = new Uint32Array(artifact.equipmentGroupCount);
			this.organizationBundlePreviewGeneration = 0;
		}
		this.organizationBundlePreviewGeneration++;
		if (this.organizationBundlePreviewGeneration >= 0xffff_fffe) {
			this.organizationBundlePreviewCellStamps.fill(0);
			this.organizationBundlePreviewPortStamps.fill(0);
			this.organizationBundlePreviewGroupStamps.fill(0);
			this.organizationBundlePreviewGeneration = 1;
		}
		const generation = this.organizationBundlePreviewGeneration;
		const visible = visibleBounds(input.camera, input.width, input.height, 2);
		const localVisible = {
			minX: visible.minX - preview.anchor.x,
			maxX: visible.maxX - preview.anchor.x,
			minY: visible.minY - preview.anchor.y,
			maxY: visible.maxY - preview.anchor.y,
		};
		const chunkMeters = STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS;
		const minChunkX = Math.floor(localVisible.minX / chunkMeters);
		const maxChunkX = Math.floor(localVisible.maxX / chunkMeters);
		const minChunkY = Math.floor(localVisible.minY / chunkMeters);
		const maxChunkY = Math.floor(localVisible.maxY / chunkMeters);
		const chunkGridArea = (maxChunkX - minChunkX + 1) * (maxChunkY - minChunkY + 1);
		const visibleChunks = [] as (typeof artifact.chunks)[number][];
		if (chunkGridArea <= artifact.chunkCount * 3 + 16) {
			for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
				for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
					const chunk = artifact.readChunk(chunkX, chunkY);
					if (chunk) visibleChunks.push(chunk);
				}
			}
		} else {
			for (const chunk of artifact.chunks) {
				if (
					chunk.chunkX >= minChunkX &&
					chunk.chunkX <= maxChunkX &&
					chunk.chunkY >= minChunkY &&
					chunk.chunkY <= maxChunkY
				) {
					visibleChunks.push(chunk);
				}
			}
		}
		this.organizationBundlePreviewVisibleChunks = visibleChunks.length;

		for (const chunk of visibleChunks) {
			for (const index of chunk.footprintCellIndices) {
				if (this.organizationBundlePreviewCellStamps[index] === generation) continue;
				this.organizationBundlePreviewCellStamps[index] = generation;
				this.organizationBundlePreviewCellBuffer.push(index);
			}
			for (const index of chunk.portIndices) {
				if (this.organizationBundlePreviewPortStamps[index] === generation) continue;
				this.organizationBundlePreviewPortStamps[index] = generation;
				if (
					this.organizationBundlePreviewPortBuffer.length <
					ORGANIZATION_BUNDLE_PREVIEW_MAX_VISIBLE_PORTS
				) {
					this.organizationBundlePreviewPortBuffer.push(index);
				}
			}
			for (const index of chunk.equipmentGroupIndices) {
				if (this.organizationBundlePreviewGroupStamps[index] === generation) continue;
				this.organizationBundlePreviewGroupStamps[index] = generation;
				if (
					this.organizationBundlePreviewGroupBuffer.length <
					ORGANIZATION_BUNDLE_PREVIEW_MAX_VISIBLE_GROUPS
				) {
					this.organizationBundlePreviewGroupBuffer.push(index);
				}
			}
		}
		this.organizationBundlePreviewVisibleCells = this.organizationBundlePreviewCellBuffer.length;
		this.organizationBundlePreviewVisiblePorts = this.organizationBundlePreviewPortBuffer.length;

		const sampledCollision = preview.disposition === "sampled-collision";
		const color = sampledCollision ? COLORS.invalid : "#65d9e2";
		const face = sampledCollision ? "#ff9aa3" : "#d5fcff";
		const background = sampledCollision ? "rgba(142, 34, 46, 0.08)" : "rgba(35, 153, 163, 0.055)";
		const outline = {
			minX: preview.anchor.x + artifact.bounds.minX - 0.35,
			minY: preview.anchor.y + artifact.bounds.minY - 0.35,
			maxX: preview.anchor.x + artifact.bounds.maxX + 0.35,
			maxY: preview.anchor.y + artifact.bounds.maxY + 0.35,
		};
		const outlineCorners = [
			this.worldToScreen({ x: outline.minX, y: outline.minY }, input.camera),
			this.worldToScreen({ x: outline.maxX, y: outline.minY }, input.camera),
			this.worldToScreen({ x: outline.maxX, y: outline.maxY }, input.camera),
			this.worldToScreen({ x: outline.minX, y: outline.maxY }, input.camera),
		];

		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.beginPath();
		ctx.moveTo((outlineCorners[0] as ScreenPoint).x, (outlineCorners[0] as ScreenPoint).y);
		for (const corner of outlineCorners.slice(1)) ctx.lineTo(corner.x, corner.y);
		ctx.closePath();
		ctx.fillStyle = background;
		ctx.fill();
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.setLineDash([8, 6]);
		ctx.stroke();
		ctx.setLineDash([]);

		ctx.strokeStyle = sampledCollision ? "rgba(91, 20, 30, 0.96)" : "rgba(8, 48, 52, 0.96)";
		ctx.lineWidth = clamp(input.camera.zoom * 0.34, 3, 10);
		ctx.beginPath();
		for (const index of this.organizationBundlePreviewCellBuffer) {
			const cell = artifact.readFootprintCell(index);
			if (cell.encoded === 0) continue;
			this.traceRailCell(
				ctx,
				{ x: preview.anchor.x + cell.x, y: preview.anchor.y + cell.y },
				decodeRailCell(cell.encoded),
				input.camera,
			);
		}
		ctx.stroke();
		ctx.strokeStyle = face;
		ctx.lineWidth = clamp(input.camera.zoom * 0.13, 1.25, 4);
		ctx.stroke();
		for (const index of this.organizationBundlePreviewCellBuffer) {
			const cell = artifact.readFootprintCell(index);
			if (cell.encoded !== 0 || !cell.advancedSwitchClaim) continue;
			const worldCell = {
				x: preview.anchor.x + cell.x,
				y: preview.anchor.y + cell.y,
			};
			const origin = this.tileOrigin(worldCell, input.camera);
			ctx.fillStyle = background;
			ctx.strokeStyle = color;
			ctx.lineWidth = 1;
			ctx.fillRect(origin.x + 1, origin.y + 1, input.camera.zoom - 2, input.camera.zoom - 2);
			ctx.strokeRect(origin.x + 1.5, origin.y + 1.5, input.camera.zoom - 3, input.camera.zoom - 3);
		}

		if (input.camera.zoom >= 4) {
			ctx.strokeStyle = color;
			ctx.fillStyle = sampledCollision ? "rgba(52, 9, 15, 0.94)" : "rgba(6, 28, 31, 0.94)";
			for (const index of this.organizationBundlePreviewGroupBuffer) {
				const group = artifact.readEquipmentGroup(index);
				if (group.sections.length > ORGANIZATION_BUNDLE_PREVIEW_MAX_GROUP_SECTIONS) continue;
				for (const section of group.sections) {
					if (
						section.maxX < localVisible.minX ||
						section.minX > localVisible.maxX ||
						section.maxY < localVisible.minY ||
						section.minY > localVisible.maxY
					) {
						continue;
					}
					const screen = worldBoundsToScreenBounds(
						{
							minX: preview.anchor.x + section.minX,
							minY: preview.anchor.y + section.minY,
							maxX: preview.anchor.x + section.maxX,
							maxY: preview.anchor.y + section.maxY,
						},
						input.camera,
					);
					const padding = clamp(input.camera.zoom * 0.14, 5, 10);
					const width = Math.max(14, screen.maxX - screen.minX) + padding * 2;
					const height = Math.max(14, screen.maxY - screen.minY) + padding * 2;
					const left = (screen.minX + screen.maxX - width) * 0.5;
					const top = (screen.minY + screen.maxY - height) * 0.5;
					ctx.globalAlpha = 0.7;
					ctx.setLineDash([5, 4]);
					roundRect(ctx, left, top, width, height, 4);
					ctx.fill();
					ctx.stroke();
					ctx.setLineDash([]);
					ctx.globalAlpha = 1;
				}
			}
			const radius = clamp(input.camera.zoom * 0.14, 4, 8);
			for (const index of this.organizationBundlePreviewPortBuffer) {
				const port = artifact.readPort(index);
				const rail = this.worldToScreen(
					{
						x: preview.anchor.x + port.railX,
						y: preview.anchor.y + port.railY,
					},
					input.camera,
				);
				const station = this.worldToScreen(
					{
						x: preview.anchor.x + port.worldX,
						y: preview.anchor.y + port.worldY,
					},
					input.camera,
				);
				ctx.strokeStyle = color;
				ctx.fillStyle = sampledCollision ? "rgba(52, 9, 15, 0.96)" : "rgba(6, 28, 31, 0.96)";
				ctx.lineWidth = 1.75;
				ctx.beginPath();
				ctx.moveTo(rail.x, rail.y);
				ctx.lineTo(station.x, station.y);
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(station.x, station.y, radius, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
		}

		ctx.strokeStyle = COLORS.invalid;
		ctx.fillStyle = "rgba(82, 13, 22, 0.72)";
		ctx.lineWidth = 2;
		for (const conflict of preview.sampledConflicts) {
			const origin = this.tileOrigin(conflict, input.camera);
			const inset = Math.max(1, input.camera.zoom * 0.08);
			ctx.fillRect(
				origin.x + inset,
				origin.y + inset,
				input.camera.zoom - inset * 2,
				input.camera.zoom - inset * 2,
			);
			ctx.beginPath();
			ctx.moveTo(origin.x + inset, origin.y + inset);
			ctx.lineTo(origin.x + input.camera.zoom - inset, origin.y + input.camera.zoom - inset);
			ctx.moveTo(origin.x + input.camera.zoom - inset, origin.y + inset);
			ctx.lineTo(origin.x + inset, origin.y + input.camera.zoom - inset);
			ctx.stroke();
		}

		const labelAnchor = this.worldToScreen({ x: outline.minX, y: outline.minY }, input.camera);
		const label = sampledCollision
			? `SAMPLED COLLISION ${preview.sampledOccupiedCellCount.toLocaleString()} · MOVE BEFORE EXACT CHECK`
			: `${artifact.sourceModuleCount.toLocaleString()} MODULE · ${artifact.portCount.toLocaleString()} PORT · CLICK = EXACT CHECK`;
		ctx.font = "750 10px Inter, system-ui, sans-serif";
		const labelWidth = Math.min(input.width - 16, ctx.measureText(label).width + 16);
		const labelX = clamp(labelAnchor.x + 8, 8, Math.max(8, input.width - labelWidth - 8));
		const labelY = clamp(labelAnchor.y - 28, 8, Math.max(8, input.height - 30));
		ctx.fillStyle = sampledCollision ? "rgba(52, 9, 15, 0.96)" : "rgba(5, 23, 25, 0.96)";
		roundRect(ctx, labelX, labelY, labelWidth, 22, 4);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText(label, labelX + 8, labelY + 11, Math.max(0, labelWidth - 16));
		ctx.restore();
	}

	private drawOrganizationBundlePlacementGuide(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		const preview = input.organizationBundlePreview;
		const guide = input.organizationBundlePlacementGuide;
		if (!preview || !guide || (!guide.centerX && !guide.centerY)) return;
		const source = guide.sourceBounds;
		const target = {
			minX: preview.anchor.x + preview.artifact.bounds.minX,
			minY: preview.anchor.y + preview.artifact.bounds.minY,
			maxX: preview.anchor.x + preview.artifact.bounds.maxX,
			maxY: preview.anchor.y + preview.artifact.bounds.maxY,
		};
		const centerX = (source.minX + source.maxX + 1) / 2;
		const centerY = (source.minY + source.maxY + 1) / 2;
		ctx.save();
		ctx.strokeStyle = "rgba(241, 198, 111, 0.9)";
		ctx.fillStyle = "rgba(8, 23, 25, 0.94)";
		ctx.lineWidth = 1.5;
		ctx.setLineDash([7, 5]);
		ctx.beginPath();
		if (guide.centerX) {
			const start = this.worldToScreen(
				{ x: centerX, y: Math.min(source.minY, target.minY) - 1 },
				input.camera,
			);
			const end = this.worldToScreen(
				{ x: centerX, y: Math.max(source.maxY, target.maxY) + 1 },
				input.camera,
			);
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
		}
		if (guide.centerY) {
			const start = this.worldToScreen(
				{ x: Math.min(source.minX, target.minX) - 1, y: centerY },
				input.camera,
			);
			const end = this.worldToScreen(
				{ x: Math.max(source.maxX, target.maxX) + 1, y: centerY },
				input.camera,
			);
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
		}
		ctx.stroke();
		ctx.setLineDash([]);

		const labels = [guide.centerX ? "X CENTER" : "", guide.centerY ? "Z CENTER" : ""].filter(
			Boolean,
		);
		const label = `SNAP · ${labels.join(" + ")}`;
		const sourceCenter = this.worldToScreen({ x: centerX, y: centerY }, input.camera);
		ctx.font = "750 9px Inter, system-ui, sans-serif";
		const width = ctx.measureText(label).width + 14;
		const x = clamp(sourceCenter.x - width / 2, 8, Math.max(8, input.width - width - 8));
		const y = clamp(sourceCenter.y - 28, 8, Math.max(8, input.height - 24));
		roundRect(ctx, x, y, width, 20, 4);
		ctx.fill();
		ctx.strokeStyle = "rgba(241, 198, 111, 0.72)";
		ctx.stroke();
		ctx.fillStyle = "#f1c66f";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(label, x + width / 2, y + 10);
		ctx.restore();
	}

	private drawGhost(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const { ghost, camera } = input;
		if (!ghost || ghost.plan.cells.length === 0) return;
		if (ghost.mode === "build" && isAdvancedSwitchVisualPlan(ghost.plan)) {
			this.drawAdvancedSwitchGhost(ctx, input, ghost);
			return;
		}
		const valid = ghost.mode === "build" ? ghost.evaluation.valid : ghost.plan.valid;
		const templatePlan =
			ghost.mode === "build" && isRailTemplatePlan(ghost.plan) ? ghost.plan : null;
		const networkLinkPlan =
			ghost.mode === "build" && isRailNetworkLinkPlan(ghost.plan) ? ghost.plan : null;
		const staticFabPlan =
			ghost.mode === "build" && isStaticFabMutationPlan(ghost.plan) ? ghost.plan : null;
		const organizationBundlePlan =
			ghost.mode === "build" && isStaticFabOrganizationBundleGhostPlan(ghost.plan)
				? ghost.plan
				: null;
		const areaStampPlan =
			ghost.mode === "build" && isRailAreaStampPlan(ghost.plan) ? ghost.plan : null;
		const compactAreaStamp =
			areaStampPlan !== null &&
			areaStampPlan.areaStamp.sourceEdgeCount > AREA_STAMP_GHOST_CELL_DETAIL_LIMIT;
		const finalCheckPending =
			compactAreaStamp &&
			ghost.mode === "build" &&
			ghost.evaluation.validationLevel === "topology-only";
		if (networkLinkPlan && !valid) {
			this.drawRejectedNetworkLinkTarget(ctx, networkLinkPlan, camera);
			this.drawMeasurement(
				ctx,
				ghost,
				camera,
				networkLinkPlan.networkLink.targetAnchor,
				COLORS.invalid,
				input.width,
				input.height,
			);
			return;
		}
		const templateFeedback =
			ghost.mode === "build" && templatePlan
				? (ghost.templateFeedback ??
					createRailTemplatePlacementFeedback(templatePlan, ghost.evaluation))
				: null;
		const physicalGhost = compactAreaStamp ? null : this.getGhostPhysicalPaths(input);
		const fill =
			ghost.mode === "erase"
				? valid
					? COLORS.eraseFill
					: COLORS.invalidFill
				: finalCheckPending
					? "rgba(241, 198, 111, 0.12)"
					: valid
						? COLORS.clearanceValidFill
						: COLORS.invalidFill;
		const stroke =
			ghost.mode === "erase"
				? valid
					? COLORS.erase
					: COLORS.invalid
				: finalCheckPending
					? COLORS.direction
					: valid
						? COLORS.clearanceValid
						: COLORS.invalid;
		const conflictCells =
			ghost.mode === "build"
				? compactAreaStamp
					? [
							...ghost.plan.conflicts.slice(0, AREA_STAMP_GHOST_CONFLICT_LIMIT),
							...ghost.evaluation.conflictCells.slice(0, AREA_STAMP_GHOST_CONFLICT_LIMIT),
						]
					: [...ghost.plan.conflicts, ...ghost.evaluation.conflictCells]
				: [];
		const conflictKeys = new Set(conflictCells.map((cell) => cellKey(cell.x, cell.y)));
		if (ghost.mode === "build" && templatePlan && templateFeedback) {
			this.drawRailTemplateFootprint(ctx, templatePlan, templateFeedback, camera);
		}
		if (ghost.mode === "build" && !compactAreaStamp) {
			this.drawDraftClearanceCorridor(ctx, ghost.evaluation, camera);
		}

		const highlightedCells = new Map(
			(compactAreaStamp ? [] : ghost.plan.cells).map((cell) => [cellKey(cell.x, cell.y), cell]),
		);
		if (physicalGhost) {
			for (let index = 0; index < physicalGhost.coverageCells.length; index += 2) {
				const cell = {
					x: physicalGhost.coverageCells[index] as number,
					y: physicalGhost.coverageCells[index + 1] as number,
				};
				highlightedCells.set(cellKey(cell.x, cell.y), cell);
			}
		}
		for (const cell of conflictCells) highlightedCells.set(cellKey(cell.x, cell.y), cell);
		if (!compactAreaStamp) {
			for (const cell of highlightedCells.values()) {
				if (conflictKeys.has(cellKey(cell.x, cell.y))) continue;
				const origin = this.tileOrigin(cell, camera);
				ctx.fillStyle = fill;
				ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
				ctx.strokeStyle = stroke;
				ctx.lineWidth = 1;
				ctx.strokeRect(origin.x + 1.5, origin.y + 1.5, camera.zoom - 3, camera.zoom - 3);
			}
		}

		if (ghost.mode === "build") {
			if (compactAreaStamp && areaStampPlan) {
				this.drawLargeAreaStampGhost(ctx, areaStampPlan, camera, valid, finalCheckPending);
			} else if (ghost.plan.kind === "edit") {
				ctx.strokeStyle = COLORS.erase;
				ctx.lineWidth = 1.5;
				for (const mutation of ghost.plan.mutations) {
					if (mutation.before === 0 || mutation.after !== 0) continue;
					const origin = this.tileOrigin({ x: mutation.x, y: mutation.y }, camera);
					ctx.fillStyle = COLORS.eraseFill;
					ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
					ctx.beginPath();
					ctx.moveTo(origin.x + camera.zoom * 0.3, origin.y + camera.zoom * 0.3);
					ctx.lineTo(origin.x + camera.zoom * 0.7, origin.y + camera.zoom * 0.7);
					ctx.moveTo(origin.x + camera.zoom * 0.7, origin.y + camera.zoom * 0.3);
					ctx.lineTo(origin.x + camera.zoom * 0.3, origin.y + camera.zoom * 0.7);
					ctx.stroke();
				}
			}
			if (!compactAreaStamp && physicalGhost) {
				const mode = input.railPresentationMode ?? "profiled";
				this.drawPhysicalRailBody(
					ctx,
					physicalGhost,
					this.ghostPresentation,
					this.ghostPathIndices,
					camera,
					mode,
					valid ? VALID_GHOST_RAIL_PALETTE : INVALID_GHOST_RAIL_PALETTE,
					this.getGhostScreenPaths(physicalGhost, camera, mode),
				);
			} else if (!compactAreaStamp && valid) {
				ctx.strokeStyle = stroke;
				ctx.lineWidth = camera.zoom * 0.13;
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				const future = mutationLookup(ghost.plan.mutations);
				for (const cell of ghost.plan.cells) {
					const encoded = future.get(cellKey(cell.x, cell.y));
					if (encoded !== undefined)
						this.strokeRailCell(ctx, cell, decodeRailCell(encoded), camera);
				}
			} else if (!compactAreaStamp) {
				ctx.strokeStyle = stroke;
				ctx.lineWidth = camera.zoom * 0.13;
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				for (const route of templatePlan?.template.buildRoutes ?? [ghost.plan.cells]) {
					this.strokeGhostSequence(ctx, route, camera);
				}
			}
			if (staticFabPlan && !compactAreaStamp) {
				this.drawStaticFabPortGhost(ctx, staticFabPlan, camera, valid);
			}
			if (organizationBundlePlan && !compactAreaStamp) {
				this.drawStaticFabOrganizationBundleGhost(
					ctx,
					organizationBundlePlan,
					camera,
					valid,
					input.width,
					input.height,
				);
			}
		} else {
			ctx.strokeStyle = stroke;
			ctx.lineWidth = 2;
			for (const cell of ghost.plan.cells) {
				const center = this.tileCenterAtScreen(cell, camera);
				const radius = camera.zoom * 0.18;
				ctx.beginPath();
				ctx.moveTo(center.x - radius, center.y - radius);
				ctx.lineTo(center.x + radius, center.y + radius);
				ctx.moveTo(center.x + radius, center.y - radius);
				ctx.lineTo(center.x - radius, center.y + radius);
				ctx.stroke();
			}
		}
		const start = areaStampPlan?.areaStamp.anchor ?? (ghost.plan.cells[0] as Cell);
		const end = areaStampPlan
			? {
					x: areaStampPlan.areaStamp.bounds.maxX,
					y: areaStampPlan.areaStamp.bounds.maxY,
				}
			: (ghost.plan.cells.at(-1) as Cell);
		if (networkLinkPlan) {
			this.drawNetworkLinkGhostOverlay(ctx, networkLinkPlan, camera, valid);
		} else if (areaStampPlan && !input.snapTargetTile) {
			const bounds = areaStampPlan.areaStamp.bounds;
			this.drawWorldHandle(
				ctx,
				{
					x: (bounds.minX + bounds.maxX + 1) / 2,
					y: (bounds.minY + bounds.maxY + 1) / 2,
				},
				camera,
				stroke,
				true,
			);
		} else {
			this.drawHandle(ctx, start, camera, stroke, false);
			this.drawHandle(ctx, end, camera, stroke, true);
		}
		this.drawMeasurement(ctx, ghost, camera, end, stroke, input.width, input.height);
		if (ghost.mode === "build" && conflictKeys.size > 0) {
			this.drawGhostConflictCells(ctx, highlightedCells, conflictKeys, camera);
		}
	}

	private drawLargeAreaStampGhost(
		ctx: CanvasRenderingContext2D,
		plan: RailAreaStampPlan,
		camera: Camera,
		valid: boolean,
		finalCheckPending: boolean,
	): void {
		const bounds = plan.areaStamp.bounds;
		const corners = [
			this.worldToScreen({ x: bounds.minX, y: bounds.minY }, camera),
			this.worldToScreen({ x: bounds.maxX + 1, y: bounds.minY }, camera),
			this.worldToScreen({ x: bounds.maxX + 1, y: bounds.maxY + 1 }, camera),
			this.worldToScreen({ x: bounds.minX, y: bounds.maxY + 1 }, camera),
		];
		const color = finalCheckPending
			? COLORS.direction
			: valid
				? COLORS.clearanceValid
				: COLORS.invalid;
		ctx.save();
		ctx.beginPath();
		ctx.moveTo((corners[0] as ScreenPoint).x, (corners[0] as ScreenPoint).y);
		for (const corner of corners.slice(1)) ctx.lineTo(corner.x, corner.y);
		ctx.closePath();
		ctx.fillStyle = finalCheckPending
			? "rgba(241, 198, 111, 0.055)"
			: valid
				? "rgba(74, 214, 218, 0.055)"
				: "rgba(255, 74, 91, 0.075)";
		ctx.fill();
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.setLineDash([9, 6]);
		ctx.stroke();
		ctx.setLineDash([]);

		const sampleStride = Math.max(
			1,
			Math.ceil(plan.mutations.length / AREA_STAMP_GHOST_SAMPLE_LIMIT),
		);
		ctx.strokeStyle = color;
		ctx.globalAlpha = valid ? 0.72 : 0.62;
		ctx.lineWidth = clamp(camera.zoom * 0.1, 0.8, 2.2);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (let index = 0; index < plan.mutations.length; index += sampleStride) {
			const mutation = plan.mutations[index];
			if (!mutation || mutation.after === 0) continue;
			this.strokeRailCell(
				ctx,
				{ x: mutation.x, y: mutation.y },
				decodeRailCell(mutation.after),
				camera,
			);
		}
		ctx.globalAlpha = 1;

		const anchor = this.worldToScreen(
			{ x: plan.areaStamp.anchor.x + 0.5, y: plan.areaStamp.anchor.y + 0.5 },
			camera,
		);
		const label = `${plan.areaStamp.sourceModuleCount.toLocaleString()} MODULE FAB · ${plan.areaStamp.sourceEdgeCount.toLocaleString()} m${finalCheckPending ? " · CHECK ON CLICK" : ""}`;
		ctx.font = "750 10px Inter, system-ui, sans-serif";
		const width = ctx.measureText(label).width + 14;
		const labelX = anchor.x + 10;
		const labelY = anchor.y - 12;
		ctx.fillStyle = "rgba(7, 12, 13, 0.94)";
		roundRect(ctx, labelX, labelY - 14, width, 20, 4);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, labelX + 7, labelY);
		ctx.restore();
	}

	private drawRejectedNetworkLinkTarget(
		ctx: CanvasRenderingContext2D,
		plan: RailNetworkLinkPlan,
		camera: Camera,
	): void {
		const target = plan.networkLink.targetAnchor;
		const origin = this.tileOrigin(target, camera);
		const center = this.tileCenterAtScreen(target, camera);
		const radius = clamp(camera.zoom * 0.24, 7, 12);
		const crossRadius = Math.max(4, radius * 0.46);
		ctx.save();
		ctx.fillStyle = COLORS.invalidFill;
		ctx.strokeStyle = COLORS.invalid;
		ctx.lineWidth = 1.5;
		ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
		ctx.strokeRect(origin.x + 1.5, origin.y + 1.5, camera.zoom - 3, camera.zoom - 3);
		ctx.fillStyle = "rgba(10, 14, 15, 0.94)";
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(center.x - crossRadius, center.y - crossRadius);
		ctx.lineTo(center.x + crossRadius, center.y + crossRadius);
		ctx.moveTo(center.x + crossRadius, center.y - crossRadius);
		ctx.lineTo(center.x - crossRadius, center.y + crossRadius);
		ctx.stroke();

		const label = "2 NO LINK";
		ctx.font = "750 9px Inter, system-ui, sans-serif";
		const labelWidth = ctx.measureText(label).width;
		const labelX = center.x + radius + 6;
		const labelY = center.y - radius - 4;
		ctx.fillStyle = "rgba(7, 12, 13, 0.94)";
		roundRect(ctx, labelX - 4, labelY - 10, labelWidth + 8, 15, 3);
		ctx.fill();
		ctx.fillStyle = COLORS.invalid;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, labelX, labelY);
		ctx.restore();
	}

	private drawStaticFabPortGhost(
		ctx: CanvasRenderingContext2D,
		plan: StaticFabMutationPlan,
		camera: Camera,
		valid: boolean,
	): void {
		const groups = new Map<number, typeof plan.staticFab.portPreviews>();
		for (const preview of plan.staticFab.portPreviews) {
			const current = groups.get(preview.equipmentGroupId);
			if (current) groups.set(preview.equipmentGroupId, [...current, preview]);
			else groups.set(preview.equipmentGroupId, [preview]);
		}
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const [groupId, previews] of groups) {
			const color = valid
				? previews[0]?.portType === "STK"
					? "#f0d17a"
					: "#8de3ea"
				: COLORS.invalid;
			if (previews.length > 1) {
				ctx.strokeStyle = color;
				ctx.globalAlpha = 0.42;
				ctx.lineWidth = clamp(camera.zoom * 0.1, 3, 7);
				ctx.setLineDash([7, 5]);
				ctx.beginPath();
				for (let index = 0; index < previews.length; index++) {
					const preview = previews[index];
					if (!preview) continue;
					const point = this.worldToScreen({ x: preview.worldX, y: preview.worldZ }, camera);
					if (index === 0) ctx.moveTo(point.x, point.y);
					else ctx.lineTo(point.x, point.y);
				}
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.globalAlpha = 1;
			}
			for (const preview of previews) {
				const rail = this.worldToScreen({ x: preview.railX, y: preview.railZ }, camera);
				const port = this.worldToScreen({ x: preview.worldX, y: preview.worldZ }, camera);
				const radius = clamp(camera.zoom * 0.16, 5, 9);
				ctx.strokeStyle = color;
				ctx.fillStyle = valid ? "rgba(8, 20, 21, 0.9)" : "rgba(64, 13, 18, 0.9)";
				ctx.lineWidth = 2.5;
				ctx.beginPath();
				ctx.moveTo(rail.x, rail.y);
				ctx.lineTo(port.x, port.y);
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(port.x, port.y, radius, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
			const labelPort = previews[0];
			if (labelPort) {
				const label = this.worldToScreen({ x: labelPort.worldX, y: labelPort.worldZ }, camera);
				ctx.fillStyle = color;
				ctx.font = "700 9px Inter, system-ui, sans-serif";
				ctx.textAlign = "left";
				ctx.textBaseline = "bottom";
				ctx.fillText(`${labelPort.portType}-${groupId}`, label.x + 9, label.y - 7);
			}
		}
		ctx.restore();
	}

	private drawStaticFabOrganizationBundleGhost(
		ctx: CanvasRenderingContext2D,
		plan: StaticFabOrganizationBundlePlacementPlan,
		camera: Camera,
		valid: boolean,
		viewportWidth: number,
		viewportHeight: number,
	): void {
		const presentation = this.getStaticFabOrganizationGhostPresentation(plan);
		if (presentation.markers.length === 0) return;
		const visible = visibleBounds(camera, viewportWidth, viewportHeight, 2);
		const color = valid ? COLORS.clearanceValid : COLORS.invalid;
		const fill = valid ? "rgba(26, 130, 139, 0.13)" : "rgba(196, 48, 61, 0.15)";
		const labelFill = valid ? "rgba(7, 25, 27, 0.94)" : "rgba(48, 10, 15, 0.94)";
		const visibleMarkerIndices = visibleOrganizationGhostMarkerIndices(presentation, visible);

		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const group of presentation.groupExtents) {
			if (!organizationGhostBoundsIntersect(group, visible)) continue;
			const screenBounds = organizationGhostScreenBounds(group, camera);
			const centerX = (screenBounds.minX + screenBounds.maxX) * 0.5;
			const centerY = (screenBounds.minY + screenBounds.maxY) * 0.5;
			const minimumSize = clamp(camera.zoom * 0.52, 18, 30);
			const padding = clamp(camera.zoom * 0.2, 7, 13);
			const width = Math.max(minimumSize, screenBounds.maxX - screenBounds.minX) + padding * 2;
			const height = Math.max(minimumSize, screenBounds.maxY - screenBounds.minY) + padding * 2;
			const left = clamp(centerX - width * 0.5, -24, viewportWidth + 24);
			const top = clamp(centerY - height * 0.5, -24, viewportHeight + 24);
			const right = clamp(centerX + width * 0.5, -24, viewportWidth + 24);
			const bottom = clamp(centerY + height * 0.5, -24, viewportHeight + 24);
			if (right <= left || bottom <= top) continue;

			ctx.fillStyle = fill;
			ctx.strokeStyle = color;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([7, 5]);
			roundRect(ctx, left, top, right - left, bottom - top, 5);
			ctx.fill();
			ctx.stroke();
			ctx.setLineDash([]);

			if (group.markerIndices.length > 1) {
				ctx.strokeStyle = color;
				ctx.globalAlpha = 0.54;
				ctx.lineWidth = clamp(camera.zoom * 0.07, 1.5, 3);
				ctx.setLineDash([5, 4]);
				ctx.beginPath();
				let started = false;
				for (const markerIndex of group.markerIndices) {
					const marker = presentation.markers[markerIndex];
					if (!marker) continue;
					const point = this.worldToScreen({ x: marker.worldX, y: marker.worldZ }, camera);
					if (!started) {
						ctx.moveTo(point.x, point.y);
						started = true;
					} else ctx.lineTo(point.x, point.y);
				}
				if (started) ctx.stroke();
				ctx.setLineDash([]);
				ctx.globalAlpha = 1;
			}

			if (camera.zoom >= 8) {
				const label = `${group.kind}-${group.equipmentGroupId}`;
				ctx.font = "750 9px Inter, system-ui, sans-serif";
				const labelWidth = ctx.measureText(label).width + 10;
				const labelX = clamp(left + 5, 4, Math.max(4, viewportWidth - labelWidth - 4));
				const labelY = clamp(top - 18, 4, Math.max(4, viewportHeight - 20));
				ctx.fillStyle = labelFill;
				roundRect(ctx, labelX, labelY, labelWidth, 16, 3);
				ctx.fill();
				ctx.fillStyle = color;
				ctx.textAlign = "left";
				ctx.textBaseline = "middle";
				ctx.fillText(label, labelX + 5, labelY + 8);
			}
		}

		const markerRadius = clamp(camera.zoom * 0.16, 5, 9);
		for (const markerIndex of visibleMarkerIndices) {
			const marker = presentation.markers[markerIndex];
			if (!marker) continue;
			const rail = this.worldToScreen({ x: marker.railX, y: marker.railZ }, camera);
			const port = this.worldToScreen({ x: marker.worldX, y: marker.worldZ }, camera);
			ctx.strokeStyle = color;
			ctx.fillStyle = labelFill;
			ctx.lineWidth = clamp(camera.zoom * 0.065, 1.5, 3);
			ctx.beginPath();
			ctx.moveTo(rail.x, rail.y);
			ctx.lineTo(port.x, port.y);
			ctx.stroke();
			ctx.lineWidth = 2.25;
			ctx.beginPath();
			ctx.arc(port.x, port.y, markerRadius, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(port.x, port.y, Math.max(1.5, markerRadius * 0.28), 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	private getStaticFabOrganizationGhostPresentation(
		plan: StaticFabOrganizationBundlePlacementPlan,
	): StaticFabOrganizationGhostPresentation {
		const cached = this.organizationBundleGhostPresentations.get(plan);
		if (cached) return cached;
		const compiled = compileStaticFabOrganizationGhostPresentation(plan);
		this.organizationBundleGhostPresentations.set(plan, compiled);
		return compiled;
	}

	private drawNetworkLinkGhostOverlay(
		ctx: CanvasRenderingContext2D,
		plan: RailNetworkLinkPlan,
		camera: Camera,
		valid: boolean,
		presentation: StaticFabAssemblyConnectorPlanPresentation = this.getStaticFabAssemblyConnectorPlanPresentation(
			plan,
		),
	): void {
		const outboundColor = valid ? "#6fe5f0" : "#ff6f80";
		const returnColor = valid ? "#f1c66a" : "#ffad66";
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = outboundColor;
		this.strokeStaticFabAssemblyConnectorRoute(
			ctx,
			presentation.outboundWorldPath,
			plan.networkLink.outboundCells,
			camera,
		);
		ctx.strokeStyle = returnColor;
		this.strokeStaticFabAssemblyConnectorRoute(
			ctx,
			presentation.returnWorldPath,
			plan.networkLink.returnCells,
			camera,
		);
		ctx.setLineDash([]);
		this.drawNetworkLinkRouteLabel(
			ctx,
			plan.networkLink.outboundCells,
			"OUTBOUND",
			outboundColor,
			camera,
		);
		this.drawNetworkLinkRouteLabel(
			ctx,
			plan.networkLink.returnCells,
			"RETURN",
			returnColor,
			camera,
		);

		const outboundDirection = routeDirection(plan.networkLink.outboundCells, false);
		const outboundArrivalDirection = routeDirection(plan.networkLink.outboundCells, true);
		const returnDirection = routeDirection(plan.networkLink.returnCells, false);
		const returnArrivalDirection = routeDirection(plan.networkLink.returnCells, true);
		if (plan.networkLink.sourceDeparture && outboundDirection) {
			this.drawNetworkLinkHandle(
				ctx,
				plan.networkLink.sourceDeparture,
				outboundDirection,
				"B",
				outboundColor,
				camera,
			);
		}
		if (plan.networkLink.targetArrival && outboundArrivalDirection) {
			this.drawNetworkLinkHandle(
				ctx,
				plan.networkLink.targetArrival,
				outboundArrivalDirection,
				"M",
				outboundColor,
				camera,
			);
		}
		if (plan.networkLink.targetDeparture && returnDirection) {
			this.drawNetworkLinkHandle(
				ctx,
				plan.networkLink.targetDeparture,
				returnDirection,
				"B",
				returnColor,
				camera,
			);
		}
		if (plan.networkLink.sourceArrival && returnArrivalDirection) {
			this.drawNetworkLinkHandle(
				ctx,
				plan.networkLink.sourceArrival,
				returnArrivalDirection,
				"M",
				returnColor,
				camera,
			);
		}
		if (plan.networkLink.outboundCells.length === 0) {
			this.drawHandle(ctx, plan.networkLink.sourceAnchor, camera, outboundColor, false);
			this.drawHandle(ctx, plan.networkLink.targetAnchor, camera, returnColor, true);
		}
		ctx.restore();
	}

	private strokeStaticFabAssemblyConnectorRoute(
		ctx: CanvasRenderingContext2D,
		worldPath: Path2D | null,
		cells: readonly Cell[],
		camera: Camera,
	): void {
		const lineWidthPixels = clamp(camera.zoom * 0.1, 2, 4);
		if (!worldPath) {
			ctx.lineWidth = lineWidthPixels;
			ctx.setLineDash([7, 5]);
			this.staticFabAssemblyConnectorRouteCellFallbackStrokes += cells.length;
			this.strokeGhostSequence(ctx, cells, camera);
			return;
		}
		ctx.save();
		ctx.lineWidth = lineWidthPixels / camera.zoom;
		ctx.setLineDash([7 / camera.zoom, 5 / camera.zoom]);
		applyCameraWorldTransform(ctx, camera);
		ctx.stroke(worldPath);
		ctx.restore();
		this.staticFabAssemblyConnectorRoutePathStrokes++;
	}

	private drawStaticFabAssemblyConnectorOverlay(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		const overlay = input.staticFabAssemblyConnectorOverlay;
		if (!overlay) return;
		const visible = visibleBounds(input.camera, input.width, input.height, 2);
		const plan = overlay.plan;
		const planPresentation = plan ? this.getStaticFabAssemblyConnectorPlanPresentation(plan) : null;

		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		if (plan && planPresentation) {
			const routeValid = plan.valid && overlay.phase !== "rejected";
			this.drawNetworkLinkGhostOverlay(ctx, plan, input.camera, routeValid, planPresentation);
			this.drawStaticFabAssemblyConnectorConflicts(
				ctx,
				planPresentation.conflicts,
				visible,
				input.camera,
			);
		} else {
			this.staticFabAssemblyConnectorVisibleConflicts = 0;
		}

		const gatewayPresentation = this.getStaticFabAssemblyConnectorGatewayPresentation(
			overlay.gateways,
		);
		const visibleGatewayIndices = this.collectVisibleStaticFabAssemblyConnectorGatewayIndices(
			gatewayPresentation,
			overlay,
			visible,
		);
		for (const gatewayIndex of visibleGatewayIndices) {
			const gateway = gatewayPresentation.gateways[
				gatewayIndex
			] as StaticFabAssemblyGatewayCandidate;
			const role =
				gateway.id === overlay.sourceGatewayId
					? "source"
					: gateway.id === overlay.targetGatewayId
						? "target"
						: "candidate";
			const rejected = overlay.phase === "rejected" && role !== "candidate";
			this.drawStaticFabAssemblyGateway(
				ctx,
				gateway,
				input.camera,
				role,
				gateway.id === overlay.hoveredGatewayId,
				rejected,
			);
		}

		if (plan) {
			this.drawStaticFabAssemblyConnectorStatus(ctx, overlay, input.camera);
		}
		ctx.restore();
	}

	private getStaticFabAssemblyConnectorPlanPresentation(
		plan: RailNetworkLinkPlan,
	): StaticFabAssemblyConnectorPlanPresentation {
		const cached = this.staticFabAssemblyConnectorPlanPresentations.get(plan);
		if (cached) return cached;
		const conflicts: Cell[] = [];
		const conflictKeys = new Set<string>();
		for (
			let index = 0;
			index < Math.min(plan.conflicts.length, STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_CONFLICT_LIMIT);
			index++
		) {
			const conflict = plan.conflicts[index];
			if (!conflict) continue;
			const key = cellKey(conflict.x, conflict.y);
			if (conflictKeys.has(key)) continue;
			conflictKeys.add(key);
			conflicts.push(conflict);
		}
		const presentation = Object.freeze({
			outboundWorldPath: this.buildStaticFabAssemblyConnectorWorldPath(
				plan.networkLink.outboundCells,
			),
			returnWorldPath: this.buildStaticFabAssemblyConnectorWorldPath(plan.networkLink.returnCells),
			conflicts: Object.freeze(conflicts),
		});
		this.staticFabAssemblyConnectorPlanPresentations.set(plan, presentation);
		this.staticFabAssemblyConnectorPlanBindings++;
		return presentation;
	}

	private buildStaticFabAssemblyConnectorWorldPath(cells: readonly Cell[]): Path2D | null {
		if (typeof Path2D === "undefined") return null;
		const path = new Path2D();
		for (let index = 0; index < cells.length; index++) {
			const previous = cells[index - 1];
			const current = cells[index] as Cell;
			const next = cells[index + 1];
			const from = previous ? directionFromNeighbor(current, previous) : null;
			const to = next ? directionFromNeighbor(current, next) : null;
			this.traceRoute(path, current, { from, to }, STATIC_FAB_ASSEMBLY_CONNECTOR_WORLD_CAMERA);
		}
		this.staticFabAssemblyConnectorRoutePathBuilds++;
		return path;
	}

	private getStaticFabAssemblyConnectorGatewayPresentation(
		gateways: readonly StaticFabAssemblyGatewayCandidate[],
	): StaticFabAssemblyConnectorGatewayPresentation {
		const cached = this.staticFabAssemblyConnectorGatewayPresentations.get(gateways);
		if (cached) return cached;
		const uniqueGateways: StaticFabAssemblyGatewayCandidate[] = [];
		const indicesById = new Map<string, number>();
		for (const gateway of gateways) {
			if (indicesById.has(gateway.id)) continue;
			indicesById.set(gateway.id, uniqueGateways.length);
			uniqueGateways.push(gateway);
		}
		const bounds = new Float64Array(uniqueGateways.length * 4);
		for (let index = 0; index < uniqueGateways.length; index++) {
			const gateway = uniqueGateways[index] as StaticFabAssemblyGatewayCandidate;
			const offset = index * 4;
			bounds[offset] = Math.min(gateway.start.x, gateway.end.x, gateway.anchor.x);
			bounds[offset + 1] = Math.min(gateway.start.y, gateway.end.y, gateway.anchor.y);
			bounds[offset + 2] = Math.max(gateway.start.x, gateway.end.x, gateway.anchor.x);
			bounds[offset + 3] = Math.max(gateway.start.y, gateway.end.y, gateway.anchor.y);
		}
		const presentation: StaticFabAssemblyConnectorGatewayPresentation = {
			gateways: Object.freeze(uniqueGateways),
			bounds,
			indicesById,
			drawStamps: new Uint32Array(uniqueGateways.length),
			drawGeneration: 0,
		};
		this.staticFabAssemblyConnectorGatewayPresentations.set(gateways, presentation);
		this.staticFabAssemblyConnectorGatewayBindings++;
		return presentation;
	}

	private collectVisibleStaticFabAssemblyConnectorGatewayIndices(
		presentation: StaticFabAssemblyConnectorGatewayPresentation,
		overlay: StaticFabAssemblyConnectorOverlay,
		visible: { minX: number; maxX: number; minY: number; maxY: number },
	): readonly number[] {
		presentation.drawGeneration = (presentation.drawGeneration + 1) >>> 0;
		if (presentation.drawGeneration === 0) {
			presentation.drawStamps.fill(0);
			presentation.drawGeneration = 1;
		}
		const visibleIndices = this.staticFabAssemblyConnectorVisibleGatewayIndices;
		visibleIndices.length = 0;
		for (
			let index = 0;
			index < presentation.gateways.length &&
			visibleIndices.length < STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT;
			index++
		) {
			if (!staticFabAssemblyConnectorGatewayBoundsIntersect(presentation.bounds, index, visible)) {
				continue;
			}
			visibleIndices.push(index);
			presentation.drawStamps[index] = presentation.drawGeneration;
		}
		this.appendPriorityStaticFabAssemblyConnectorGateway(
			presentation,
			overlay.sourceGatewayId,
			visible,
			visibleIndices,
		);
		this.appendPriorityStaticFabAssemblyConnectorGateway(
			presentation,
			overlay.targetGatewayId,
			visible,
			visibleIndices,
		);
		this.appendPriorityStaticFabAssemblyConnectorGateway(
			presentation,
			overlay.hoveredGatewayId,
			visible,
			visibleIndices,
		);
		this.staticFabAssemblyConnectorVisibleGateways = visibleIndices.length;
		return visibleIndices;
	}

	private appendPriorityStaticFabAssemblyConnectorGateway(
		presentation: StaticFabAssemblyConnectorGatewayPresentation,
		id: string | null,
		visible: { minX: number; maxX: number; minY: number; maxY: number },
		target: number[],
	): void {
		if (id === null) return;
		const index = presentation.indicesById.get(id);
		if (
			index === undefined ||
			presentation.drawStamps[index] === presentation.drawGeneration ||
			!staticFabAssemblyConnectorGatewayBoundsIntersect(presentation.bounds, index, visible)
		) {
			return;
		}
		target.push(index);
		presentation.drawStamps[index] = presentation.drawGeneration;
	}

	private drawStaticFabAssemblyConnectorConflicts(
		ctx: CanvasRenderingContext2D,
		conflicts: readonly Cell[],
		visible: { minX: number; maxX: number; minY: number; maxY: number },
		camera: Camera,
	): void {
		let visibleCount = 0;
		ctx.save();
		ctx.fillStyle = "rgba(255, 69, 82, 0.22)";
		ctx.strokeStyle = COLORS.invalid;
		ctx.lineWidth = 2;
		for (const cell of conflicts) {
			if (!cellIntersectsVisibleBounds(cell, visible)) continue;
			visibleCount++;
			const origin = this.tileOrigin(cell, camera);
			ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
			ctx.strokeRect(origin.x + 1.5, origin.y + 1.5, camera.zoom - 3, camera.zoom - 3);
			ctx.beginPath();
			ctx.moveTo(origin.x + camera.zoom * 0.26, origin.y + camera.zoom * 0.26);
			ctx.lineTo(origin.x + camera.zoom * 0.74, origin.y + camera.zoom * 0.74);
			ctx.moveTo(origin.x + camera.zoom * 0.74, origin.y + camera.zoom * 0.26);
			ctx.lineTo(origin.x + camera.zoom * 0.26, origin.y + camera.zoom * 0.74);
			ctx.stroke();
		}
		ctx.restore();
		this.staticFabAssemblyConnectorVisibleConflicts = visibleCount;
	}

	private drawStaticFabAssemblyGateway(
		ctx: CanvasRenderingContext2D,
		gateway: StaticFabAssemblyGatewayCandidate,
		camera: Camera,
		role: "candidate" | "source" | "target",
		hovered: boolean,
		rejected: boolean,
	): void {
		const interval = staticFabAssemblyGatewayWorldInterval(gateway);
		const start = this.worldToScreen(interval.start, camera);
		const end = this.worldToScreen(interval.end, camera);
		const center = this.tileCenterAtScreen(gateway.anchor, camera);
		const color = rejected
			? "#ff6f80"
			: role === "source"
				? "#6fe5f0"
				: role === "target"
					? "#f1c66a"
					: hovered
						? "#8de3ea"
						: "rgba(105, 203, 211, 0.54)";
		const emphasized = rejected || hovered || role !== "candidate";
		const markerRadius = emphasized ? 14 : 12;

		ctx.save();
		ctx.strokeStyle = color;
		ctx.lineWidth = emphasized ? 10 : 7;
		ctx.globalAlpha = role === "candidate" && !hovered ? 0.44 : 0.62;
		ctx.beginPath();
		ctx.moveTo(start.x, start.y);
		ctx.lineTo(end.x, end.y);
		ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.lineWidth = emphasized ? 2.5 : 1.5;
		ctx.beginPath();
		ctx.moveTo(start.x, start.y);
		ctx.lineTo(end.x, end.y);
		ctx.stroke();

		ctx.fillStyle = rejected ? "rgba(55, 8, 14, 0.96)" : "rgba(7, 18, 20, 0.96)";
		ctx.lineWidth = emphasized ? 3 : 2;
		ctx.beginPath();
		ctx.arc(center.x, center.y, markerRadius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		const vector = rotatePoint(directionVector(gateway.forward), camera.rotation);
		const perpendicular = { x: -vector.y, y: vector.x };
		const arrowStart = 5;
		const arrowTip = 9;
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.moveTo(center.x - vector.x * arrowStart, center.y - vector.y * arrowStart);
		ctx.lineTo(center.x + vector.x * arrowTip, center.y + vector.y * arrowTip);
		ctx.lineTo(
			center.x + vector.x * (arrowTip - 5) + perpendicular.x * 4,
			center.y + vector.y * (arrowTip - 5) + perpendicular.y * 4,
		);
		ctx.moveTo(center.x + vector.x * arrowTip, center.y + vector.y * arrowTip);
		ctx.lineTo(
			center.x + vector.x * (arrowTip - 5) - perpendicular.x * 4,
			center.y + vector.y * (arrowTip - 5) - perpendicular.y * 4,
		);
		ctx.stroke();

		const label =
			role === "source"
				? `SOURCE · ${directionLabel(gateway.forward)}`
				: role === "target"
					? `TARGET · ${directionLabel(gateway.forward)}`
					: hovered
						? `${gateway.runLengthMeters} m GATEWAY · ${directionLabel(gateway.forward)}`
						: null;
		if (label) {
			ctx.font = "760 10px Inter, system-ui, sans-serif";
			const labelWidth = ctx.measureText(label).width + 12;
			const labelX = center.x + markerRadius + 7;
			const labelY = center.y - markerRadius - 5;
			ctx.fillStyle = rejected ? "rgba(48, 8, 13, 0.96)" : "rgba(7, 18, 20, 0.96)";
			roundRect(ctx, labelX, labelY - 12, labelWidth, 18, 4);
			ctx.fill();
			ctx.fillStyle = color;
			ctx.textAlign = "left";
			ctx.textBaseline = "alphabetic";
			ctx.fillText(label, labelX + 6, labelY);
		}
		ctx.restore();
	}

	private drawStaticFabAssemblyConnectorStatus(
		ctx: CanvasRenderingContext2D,
		overlay: StaticFabAssemblyConnectorOverlay,
		camera: Camera,
	): void {
		const plan = overlay.plan;
		if (!plan) return;
		const rejected = overlay.phase === "rejected" || !plan.valid;
		const label = rejected
			? `REJECTED · ${plan.assemblyConnector.issueCode ?? plan.networkLink.placementCode}`
			: overlay.phase === "verifying"
				? "VERIFYING CONNECTOR"
				: overlay.phase === "applying"
					? "APPLYING CONNECTOR"
					: overlay.phase === "ready"
						? "CONNECTOR READY"
						: null;
		if (!label) return;
		const center = this.tileCenterAtScreen(plan.networkLink.targetAnchor, camera);
		const color = rejected ? "#ff6f80" : "#8de3ea";
		ctx.font = "780 10px Inter, system-ui, sans-serif";
		const width = ctx.measureText(label).width + 14;
		const x = center.x + 18;
		const y = center.y + 31;
		ctx.fillStyle = rejected ? "rgba(48, 8, 13, 0.96)" : "rgba(7, 20, 22, 0.96)";
		roundRect(ctx, x, y - 14, width, 20, 4);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, x + 7, y);
	}

	private drawNetworkLinkRouteLabel(
		ctx: CanvasRenderingContext2D,
		cells: readonly Cell[],
		label: string,
		color: string,
		camera: Camera,
	): void {
		const middle = cells[Math.floor(cells.length / 2)];
		if (!middle) return;
		const center = this.tileCenterAtScreen(middle, camera);
		ctx.font = "760 9px Inter, system-ui, sans-serif";
		const width = ctx.measureText(label).width + 10;
		const x = center.x + 8;
		const y = center.y - 8;
		ctx.fillStyle = "rgba(7, 12, 13, 0.94)";
		roundRect(ctx, x, y - 11, width, 15, 3);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, x + 5, y);
	}

	private drawNetworkLinkHandle(
		ctx: CanvasRenderingContext2D,
		cell: Cell,
		direction: Direction,
		label: string,
		color: string,
		camera: Camera,
	): void {
		const center = this.tileCenterAtScreen(cell, camera);
		const vector = rotatePoint(directionVector(direction), camera.rotation);
		const radius = clamp(camera.zoom * 0.15, 5, 7);
		const tipDistance = radius + 10;
		const tip = {
			x: center.x + vector.x * tipDistance,
			y: center.y + vector.y * tipDistance,
		};
		const perpendicular = { x: -vector.y, y: vector.x };
		ctx.fillStyle = COLORS.background;
		ctx.strokeStyle = color;
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(center.x + vector.x * (radius + 1), center.y + vector.y * (radius + 1));
		ctx.lineTo(tip.x, tip.y);
		ctx.lineTo(
			tip.x - vector.x * 4 + perpendicular.x * 2.5,
			tip.y - vector.y * 4 + perpendicular.y * 2.5,
		);
		ctx.moveTo(tip.x, tip.y);
		ctx.lineTo(
			tip.x - vector.x * 4 - perpendicular.x * 2.5,
			tip.y - vector.y * 4 - perpendicular.y * 2.5,
		);
		ctx.stroke();

		ctx.font = "750 8px Inter, system-ui, sans-serif";
		const textWidth = ctx.measureText(label).width;
		const labelX = center.x + 8;
		const labelY = center.y - 10;
		ctx.fillStyle = "rgba(7, 12, 13, 0.92)";
		roundRect(ctx, labelX - 3, labelY - 9, textWidth + 6, 13, 3);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, labelX, labelY);
	}

	private drawGhostConflictCells(
		ctx: CanvasRenderingContext2D,
		cells: ReadonlyMap<string, Cell>,
		conflictKeys: ReadonlySet<string>,
		camera: Camera,
	): void {
		ctx.save();
		ctx.fillStyle = "rgba(255, 69, 82, 0.22)";
		ctx.strokeStyle = COLORS.invalid;
		ctx.lineWidth = 2;
		for (const key of conflictKeys) {
			const cell = cells.get(key);
			if (!cell) continue;
			const origin = this.tileOrigin(cell, camera);
			ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
			ctx.strokeRect(origin.x + 1.5, origin.y + 1.5, camera.zoom - 3, camera.zoom - 3);
			ctx.beginPath();
			ctx.moveTo(origin.x + camera.zoom * 0.26, origin.y + camera.zoom * 0.26);
			ctx.lineTo(origin.x + camera.zoom * 0.74, origin.y + camera.zoom * 0.74);
			ctx.moveTo(origin.x + camera.zoom * 0.74, origin.y + camera.zoom * 0.26);
			ctx.lineTo(origin.x + camera.zoom * 0.26, origin.y + camera.zoom * 0.74);
			ctx.stroke();
		}
		ctx.restore();
	}

	private drawAdvancedSwitchGhost(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		ghost: Extract<GhostState, { mode: "build" }>,
	): void {
		const { camera } = input;
		const plan = ghost.plan as AdvancedSwitchVisualPlan;
		const valid = ghost.evaluation.valid;
		const stroke = valid ? COLORS.switchGhost : COLORS.switchConflict;
		this.drawDraftClearanceCorridor(ctx, ghost.evaluation, camera);
		const record = plan.switchRecord;
		if (!record) {
			const anchor = ("entry" in plan ? plan.entry : plan.previousSwitchRecord?.origin) ??
				plan.cells[0] ?? { x: 0, y: 0 };
			const origin = this.tileOrigin(anchor, camera);
			ctx.fillStyle = COLORS.invalidFill;
			ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
			this.drawHandle(ctx, anchor, camera, stroke, true);
			this.drawMeasurement(ctx, ghost, camera, anchor, stroke, input.width, input.height);
			this.drawAdvancedSwitchConflictCells(
				ctx,
				[anchor, ...ghost.evaluation.conflictCells],
				camera,
			);
			return;
		}

		if (isAdvancedSwitchReplacementVisualPlan(plan)) {
			this.drawAdvancedSwitchReplacementRemoval(ctx, plan, camera);
		}
		const visual = { record, geometry: deriveAdvancedSwitchGeometry(record) };
		this.drawAdvancedSwitchEnvelope(ctx, visual, camera, valid ? "valid" : "invalid");
		const physicalGhost = this.getGhostPhysicalPaths(input);
		if (physicalGhost) {
			const mode = input.railPresentationMode ?? "profiled";
			this.drawPhysicalRailBody(
				ctx,
				physicalGhost,
				this.ghostPresentation,
				this.ghostPathIndices,
				camera,
				mode,
				valid ? VALID_GHOST_RAIL_PALETTE : INVALID_GHOST_RAIL_PALETTE,
				this.getGhostScreenPaths(physicalGhost, camera, mode),
			);
		} else {
			ctx.save();
			ctx.strokeStyle = stroke;
			ctx.lineWidth = Math.max(3, camera.zoom * 0.13);
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			for (const route of visual.geometry.routes) this.strokeGhostSequence(ctx, route, camera);
			ctx.restore();
		}

		this.drawAdvancedSwitchDetails(ctx, visual, camera, valid ? "valid" : "invalid");
		const entry = visual.geometry.inputs[0].cell;
		const exit = visual.geometry.outputs[0].cell;
		this.drawHandle(ctx, entry, camera, stroke, false);
		this.drawHandle(ctx, exit, camera, stroke, true);
		this.drawMeasurement(ctx, ghost, camera, exit, stroke, input.width, input.height);
		this.drawAdvancedSwitchConflictCells(ctx, ghost.evaluation.conflictCells, camera);
	}

	private drawAdvancedSwitchConflictCells(
		ctx: CanvasRenderingContext2D,
		cells: readonly Cell[],
		camera: Camera,
	): void {
		if (cells.length === 0) return;
		const unique = new Map<string, Cell>();
		for (const cell of cells) unique.set(cellKey(cell.x, cell.y), cell);
		ctx.save();
		ctx.strokeStyle = COLORS.switchConflict;
		ctx.fillStyle = "rgba(255, 69, 82, 0.2)";
		ctx.lineWidth = 2;
		for (const cell of unique.values()) {
			const origin = this.tileOrigin(cell, camera);
			ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
			ctx.strokeRect(origin.x + 2, origin.y + 2, camera.zoom - 4, camera.zoom - 4);
			ctx.beginPath();
			ctx.moveTo(origin.x + camera.zoom * 0.26, origin.y + camera.zoom * 0.26);
			ctx.lineTo(origin.x + camera.zoom * 0.74, origin.y + camera.zoom * 0.74);
			ctx.moveTo(origin.x + camera.zoom * 0.74, origin.y + camera.zoom * 0.26);
			ctx.lineTo(origin.x + camera.zoom * 0.26, origin.y + camera.zoom * 0.74);
			ctx.stroke();
		}
		ctx.restore();
	}

	private drawAdvancedSwitchReplacementRemoval(
		ctx: CanvasRenderingContext2D,
		plan: AdvancedSwitchReplacementPlan,
		camera: Camera,
	): void {
		const previousRecord = plan.previousSwitchRecord;
		if (!previousRecord) return;
		const previousGeometry = deriveAdvancedSwitchGeometry(previousRecord);
		const nextClaimKeys = new Set(
			plan.switchRecord
				? deriveAdvancedSwitchGeometry(plan.switchRecord).claimedCells.map((cell) =>
						cellKey(cell.x, cell.y),
					)
				: [],
		);
		const removedCells = new Map<string, Cell>();
		for (const cell of previousGeometry.claimedCells) {
			if (!nextClaimKeys.has(cellKey(cell.x, cell.y))) {
				removedCells.set(cellKey(cell.x, cell.y), cell);
			}
		}
		for (const mutation of plan.mutations) {
			if (mutation.before === 0 || mutation.after !== 0) continue;
			removedCells.set(cellKey(mutation.x, mutation.y), {
				x: mutation.x,
				y: mutation.y,
			});
		}

		ctx.save();
		for (const cell of previousGeometry.claimedCells) {
			const origin = this.tileOrigin(cell, camera);
			const majorX = Math.floor(cell.x / 5);
			const majorY = Math.floor(cell.y / 5);
			ctx.fillStyle = ((majorX + majorY) & 1) === 0 ? COLORS.majorTileA : COLORS.majorTileB;
			ctx.fillRect(origin.x, origin.y, camera.zoom, camera.zoom);
			if (camera.zoom >= 12) {
				ctx.strokeStyle = COLORS.grid;
				ctx.lineWidth = 1;
				ctx.strokeRect(origin.x + 0.5, origin.y + 0.5, camera.zoom - 1, camera.zoom - 1);
			}
		}

		ctx.fillStyle = COLORS.eraseFill;
		ctx.strokeStyle = COLORS.erase;
		ctx.lineWidth = 1.5;
		ctx.setLineDash([Math.max(3, camera.zoom * 0.12), Math.max(3, camera.zoom * 0.08)]);
		for (const cell of removedCells.values()) {
			const origin = this.tileOrigin(cell, camera);
			ctx.fillRect(origin.x + 1, origin.y + 1, camera.zoom - 2, camera.zoom - 2);
			ctx.strokeRect(origin.x + 2, origin.y + 2, camera.zoom - 4, camera.zoom - 4);
			ctx.beginPath();
			ctx.moveTo(origin.x + camera.zoom * 0.3, origin.y + camera.zoom * 0.3);
			ctx.lineTo(origin.x + camera.zoom * 0.7, origin.y + camera.zoom * 0.7);
			ctx.moveTo(origin.x + camera.zoom * 0.7, origin.y + camera.zoom * 0.3);
			ctx.lineTo(origin.x + camera.zoom * 0.3, origin.y + camera.zoom * 0.7);
			ctx.stroke();
		}
		ctx.restore();
	}

	private getGhostPhysicalPaths(input: TileRenderInput): CompiledPhysicalPaths | null {
		const { ghost } = input;
		if (!ghost || ghost.mode !== "build") return null;
		if (this.ghostEvaluation === ghost.evaluation) return this.ghostPhysicalPaths;
		this.ghostEvaluation = ghost.evaluation;
		this.ghostPhysicalPaths = ghost.evaluation.paths;
		this.ghostScreenPathSource = null;
		this.ghostScreenPathKey = "";
		this.ghostScreenPaths = null;
		if (!this.ghostPhysicalPaths) {
			this.ghostPresentation = null;
			this.ghostPathIndices = [];
			return null;
		}
		this.ghostPresentation = compilePhysicalRailPresentation(this.ghostPhysicalPaths);
		this.ghostPresentationBuilds++;
		this.ghostPathIndices = Array.from(
			{ length: this.ghostPhysicalPaths.pathCount },
			(_, index) => index,
		);
		this.ghostPathCompiles++;
		return this.ghostPhysicalPaths;
	}

	private getGhostScreenPaths(
		paths: CompiledPhysicalPaths,
		camera: Camera,
		mode: RailPresentationMode,
	): PhysicalRailScreenPaths | null {
		if (typeof Path2D === "undefined") return null;
		const key = screenPathCameraKey(camera, mode);
		if (
			this.ghostScreenPathSource === paths &&
			this.ghostScreenPathKey === key &&
			this.ghostScreenPaths
		) {
			return this.ghostScreenPaths;
		}
		const presentation = this.ghostPresentation;
		const profiled = mode === "profiled" && camera.zoom >= 12 && presentation?.source === paths;
		this.ghostScreenPathSource = paths;
		this.ghostScreenPathKey = key;
		this.ghostScreenPaths = Object.freeze({
			center: this.buildPhysicalScreenPath(paths, this.ghostPathIndices, camera, null, 0),
			left:
				profiled && presentation
					? this.buildPhysicalScreenPath(
							paths,
							this.ghostPathIndices,
							camera,
							presentation,
							-presentation.profile.beamCenterOffsetMeters,
						)
					: null,
			right:
				profiled && presentation
					? this.buildPhysicalScreenPath(
							paths,
							this.ghostPathIndices,
							camera,
							presentation,
							presentation.profile.beamCenterOffsetMeters,
						)
					: null,
		});
		this.ghostScreenPathBuilds++;
		return this.ghostScreenPaths;
	}

	private strokeGhostSequence(
		ctx: CanvasRenderingContext2D,
		cells: readonly Cell[],
		camera: Camera,
	): void {
		for (let index = 0; index < cells.length; index++) {
			const previous = cells[index - 1];
			const current = cells[index] as Cell;
			const next = cells[index + 1];
			const from = previous ? directionFromNeighbor(current, previous) : null;
			const to = next ? directionFromNeighbor(current, next) : null;
			this.strokeRoute(ctx, current, { from, to }, camera);
		}
	}

	private drawMeasurement(
		ctx: CanvasRenderingContext2D,
		ghost: GhostState,
		camera: Camera,
		end: Cell,
		accent: string,
		viewportWidth: number,
		viewportHeight: number,
	): void {
		const point = this.tileCenterAtScreen(end, camera);
		const networkLink =
			ghost.mode === "build" && isRailNetworkLinkPlan(ghost.plan) ? ghost.plan.networkLink : null;
		const metric = ghost.mode === "build" ? deriveRailConstructionMetric(ghost.plan) : null;
		const networkLinkRejected =
			networkLink !== null && ghost.mode === "build" && !ghost.evaluation.valid;
		const primary = networkLink
			? networkLinkRejected
				? "NO LINK · MAP UNCHANGED"
				: `OUT ${Math.max(0, networkLink.outboundCells.length - 1)} m  ·  RETURN ${Math.max(0, networkLink.returnCells.length - 1)} m`
			: metric
				? metric.primaryLabel
				: `${ghost.plan.cells.length} module`;
		const geometry = networkLinkRejected ? "" : (metric?.geometryLabel ?? "");
		const secondary = ghost.mode === "build" ? ghost.evaluation.reason : ghost.plan.reason;
		ctx.font = "650 12px Inter, system-ui, sans-serif";
		const primaryWidth = ctx.measureText(primary).width;
		ctx.font = "550 10px ui-monospace, SFMono-Regular, Menlo, monospace";
		const geometryWidth = ctx.measureText(geometry).width;
		ctx.font = "500 10px Inter, system-ui, sans-serif";
		const reasonWidth = ctx.measureText(secondary).width;
		const width = Math.max(primaryWidth, geometryWidth, reasonWidth) + 20;
		const height = geometry ? 58 : 42;
		const x = clamp(point.x + 14, 8, Math.max(8, viewportWidth - width - 8));
		const y = clamp(point.y - height - 6, 8, Math.max(8, viewportHeight - height - 8));
		ctx.fillStyle = "rgba(10, 14, 15, 0.94)";
		ctx.strokeStyle = accent;
		ctx.lineWidth = 1;
		roundRect(ctx, x, y, width, height, 4);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#e6eeee";
		ctx.font = "650 12px Inter, system-ui, sans-serif";
		ctx.fillText(primary, x + 10, y + 16);
		if (geometry) {
			ctx.fillStyle = "#91a4a6";
			ctx.font = "550 10px ui-monospace, SFMono-Regular, Menlo, monospace";
			ctx.fillText(geometry, x + 10, y + 32);
		}
		ctx.fillStyle = accent;
		ctx.font = "500 10px Inter, system-ui, sans-serif";
		ctx.fillText(secondary, x + 10, y + (geometry ? 49 : 30));
	}

	private drawPhysicalHover(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		hit: PhysicalPathHit | null,
	): void {
		if (!hit || input.ghost) return;
		this.hoverPathIndexBuffer[0] = hit.pathIndex;
		const mode = input.railPresentationMode ?? "profiled";
		this.drawPhysicalPathInteraction(
			ctx,
			input.physicalPaths,
			this.hoverPathIndexBuffer,
			input.camera,
			mode,
			COLORS.hoverRail,
			false,
			this.getHoverScreenPaths(input.physicalPaths, hit.pathIndex, input.camera, mode),
		);
	}

	private drawTemplateAttachmentGuide(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const guide = input.templateAttachmentGuide;
		if (!guide || guide.baseRevision !== input.map.getRevision()) return;
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const interval of guide.intervals) {
			const start = this.tileCenterAtScreen(interval.startAnchor, input.camera);
			const end = this.tileCenterAtScreen(interval.endAnchor, input.camera);
			const margin = 18;
			if (
				Math.max(start.x, end.x) < -margin ||
				Math.min(start.x, end.x) > input.width + margin ||
				Math.max(start.y, end.y) < -margin ||
				Math.min(start.y, end.y) > input.height + margin
			) {
				continue;
			}
			const compatible = interval.status === "compatible";
			ctx.setLineDash(compatible ? [] : [6, 5]);
			ctx.strokeStyle = compatible ? COLORS.attachmentCompatibleFill : "rgba(239, 100, 107, 0.12)";
			ctx.lineWidth = compatible ? 12 : 9;
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
			ctx.strokeStyle = compatible ? COLORS.attachmentCompatible : COLORS.attachmentBlocked;
			ctx.lineWidth = compatible ? 2.5 : 2;
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();

			ctx.setLineDash([]);
			ctx.fillStyle = compatible ? COLORS.attachmentCompatible : COLORS.attachmentBlocked;
			for (const point of interval.anchorCount === 1 ? [start] : [start, end]) {
				ctx.beginPath();
				ctx.arc(point.x, point.y, compatible ? 3.5 : 3, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		ctx.restore();
	}

	private drawTemplateCompositionGuide(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		const guide = input.templateCompositionGuide;
		if (!guide || guide.baseRevision !== input.map.getRevision()) return;
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const interval of guide.intervals) {
			const start = this.tileCenterAtScreen(interval.firstTargetStart, input.camera);
			const end = this.tileCenterAtScreen(interval.lastTargetStart, input.camera);
			const margin = 18;
			if (
				Math.max(start.x, end.x) < -margin ||
				Math.min(start.x, end.x) > input.width + margin ||
				Math.max(start.y, end.y) < -margin ||
				Math.min(start.y, end.y) > input.height + margin
			) {
				continue;
			}
			ctx.strokeStyle = COLORS.attachmentCompatibleFill;
			ctx.lineWidth = 12;
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
			ctx.strokeStyle = COLORS.attachmentCompatible;
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
			ctx.fillStyle = COLORS.attachmentCompatible;
			for (const point of interval.anchorCount === 1 ? [start] : [start, end]) {
				ctx.beginPath();
				ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		for (const target of guide.routeReuseTargets) {
			const point = this.tileCenterAtScreen(target.handleCell, input.camera);
			if (
				point.x < -18 ||
				point.x > input.width + 18 ||
				point.y < -18 ||
				point.y > input.height + 18
			) {
				continue;
			}
			ctx.fillStyle = "rgba(10, 16, 17, 0.88)";
			ctx.strokeStyle = COLORS.attachmentCompatible;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = COLORS.turnoutBlade;
			ctx.beginPath();
			ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		const resolution = input.templateCompositionResolution;
		if (resolution && resolution.baseRevision === guide.baseRevision) {
			const start = this.tileCenterAtScreen(resolution.overlapStart, input.camera);
			const end = this.tileCenterAtScreen(resolution.overlapEnd, input.camera);
			ctx.strokeStyle = "rgba(239, 205, 105, 0.34)";
			ctx.lineWidth = 16;
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
			ctx.strokeStyle = "#f0cf73";
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
		}
		ctx.restore();
	}

	private drawRailAreaSelection(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const marquee = input.railAreaMarquee;
		if (marquee) {
			this.drawRailAreaMarquee(
				ctx,
				input,
				marquee.start,
				marquee.end,
				marquee.operation ?? "replace",
			);
		}

		const selection = input.railAreaSelection;
		if (!selection || selection.revision !== input.map.getRevision()) return;
		const cells = this.resolveRailAreaSelectionCells(selection);
		if (cells.length === 0) return;
		if (cells.length > AREA_SELECTION_CELL_DETAIL_LIMIT) {
			this.drawRailAreaSelectionOutline(ctx, input, selection);
			return;
		}
		ctx.save();
		ctx.fillStyle = COLORS.areaSelectionFill;
		ctx.strokeStyle = COLORS.areaSelection;
		ctx.lineWidth = 1.5;
		const padding = Math.max(1.5, input.camera.zoom * 0.07);
		const size = Math.max(3, input.camera.zoom - padding * 2);
		for (const cell of cells) {
			const origin = this.tileOrigin(cell, input.camera);
			if (
				origin.x > input.width + input.camera.zoom ||
				origin.y > input.height + input.camera.zoom ||
				origin.x + input.camera.zoom < 0 ||
				origin.y + input.camera.zoom < 0
			) {
				continue;
			}
			ctx.fillRect(origin.x + padding, origin.y + padding, size, size);
			ctx.strokeRect(origin.x + padding, origin.y + padding, size, size);
		}
		ctx.restore();
	}

	private drawStaticFabArrangementPreview(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		this.staticFabArrangementPreviewVisibleRoots = 0;
		this.staticFabArrangementPreviewVisibleChunks = 0;
		this.staticFabArrangementPreviewVisibleTargetCells = 0;
		this.staticFabArrangementPreviewVisiblePorts = 0;
		this.staticFabArrangementPreviewVisibleEquipmentSections = 0;
		this.staticFabArrangementPreviewVisibleConflicts = 0;
		const preview = input.staticFabArrangementPreview;
		if (!preview) {
			this.staticFabArrangementPreviewArtifact = null;
			return;
		}
		if (this.staticFabArrangementPreviewArtifact !== preview) {
			this.staticFabArrangementPreviewArtifact = preview;
			this.staticFabArrangementPreviewArtifactBindings++;
		}

		writeStaticFabArrangementVisibleBounds(
			this.staticFabArrangementPreviewVisibleBounds,
			input.camera,
			input.width,
			input.height,
			2,
		);
		const visibleBounds = this.staticFabArrangementPreviewVisibleBounds;
		const rejected = preview.phase === "rejected";
		const targetStroke = rejected ? COLORS.invalid : "#e3bd58";
		const targetFill = rejected ? "rgba(224, 76, 85, 0.17)" : "rgba(227, 189, 88, 0.12)";

		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = targetStroke;
		ctx.fillStyle = targetFill;
		ctx.lineWidth = preview.phase === "certified" ? 2.25 : 1.75;
		ctx.setLineDash(
			preview.phase === "planning" ? STATIC_FAB_ARRANGEMENT_PLANNING_DASH : EMPTY_LINE_DASH,
		);
		for (let index = 0; index < preview.roots.length; index++) {
			const root = preview.roots[index] as StaticFabArrangementPreviewRoot;
			const sourceVisible = staticFabArrangementBoundsIntersectVisible(
				root.sourceBounds,
				visibleBounds,
			);
			const targetVisible = staticFabArrangementBoundsIntersectVisible(
				root.targetBounds,
				visibleBounds,
			);
			if (sourceVisible || targetVisible) this.staticFabArrangementPreviewVisibleRoots++;
			if (targetVisible) {
				this.drawStaticFabArrangementBounds(ctx, root.targetBounds, input.camera);
			}
		}

		const drawTargetCells =
			preview.hasExactTargetCells &&
			preview.targetCellCount > 0 &&
			input.camera.zoom >= STATIC_FAB_ARRANGEMENT_PREVIEW_CELL_DETAIL_MIN_ZOOM;
		const drawConflicts =
			preview.reportedConflictCount > 0 &&
			input.camera.zoom >= STATIC_FAB_ARRANGEMENT_PREVIEW_CONFLICT_MIN_ZOOM;
		if (drawTargetCells || drawConflicts) {
			this.drawStaticFabArrangementPreviewChunks(
				ctx,
				input,
				preview,
				visibleBounds,
				targetStroke,
				targetFill,
				drawTargetCells,
				drawConflicts,
			);
		}
		if (
			input.camera.zoom >= STATIC_FAB_ARRANGEMENT_PREVIEW_EQUIPMENT_MIN_ZOOM &&
			(preview.targetPortCount > 0 || preview.targetEquipmentSectionCount > 0)
		) {
			this.drawStaticFabArrangementEquipmentPreview(
				ctx,
				input,
				preview,
				visibleBounds,
				targetStroke,
				targetFill,
			);
		}

		ctx.strokeStyle = "#65d9e2";
		ctx.fillStyle = "rgba(101, 217, 226, 0.035)";
		ctx.lineWidth = 1.75;
		ctx.setLineDash(STATIC_FAB_ARRANGEMENT_SOURCE_DASH);
		for (let index = 0; index < preview.roots.length; index++) {
			const root = preview.roots[index] as StaticFabArrangementPreviewRoot;
			if (staticFabArrangementBoundsIntersectVisible(root.sourceBounds, visibleBounds)) {
				this.drawStaticFabArrangementBounds(ctx, root.sourceBounds, input.camera);
			}
		}
		ctx.setLineDash(EMPTY_LINE_DASH);
		ctx.restore();
	}

	private drawStaticFabArrangementEquipmentPreview(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		preview: StaticFabArrangementPreviewArtifact,
		visibleBounds: Float64Array,
		strokeStyle: string,
		fillStyle: string,
	): void {
		ctx.strokeStyle = strokeStyle;
		ctx.fillStyle = fillStyle;
		ctx.lineWidth = Math.max(1.25, Math.min(2.5, input.camera.zoom * 0.12));
		this.visitStaticFabArrangementPresentationChunks(
			preview,
			visibleBounds,
			preview.equipmentSectionQueryMarginMeters,
			(chunk) => {
				const end = chunk.equipmentSectionIndexStart + chunk.equipmentSectionIndexCount;
				for (let row = chunk.equipmentSectionIndexStart; row < end; row++) {
					if (
						this.staticFabArrangementPreviewVisibleEquipmentSections >=
						STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_VISIBLE_EQUIPMENT_SECTIONS
					) {
						return false;
					}
					const index = preview.presentationEquipmentSectionIndex(row);
					if (
						!staticFabArrangementContinuousBoundsIntersectVisible(
							preview.targetEquipmentSectionMinX(index),
							preview.targetEquipmentSectionMinZ(index),
							preview.targetEquipmentSectionMaxX(index),
							preview.targetEquipmentSectionMaxZ(index),
							visibleBounds,
						)
					) {
						continue;
					}
					const centerX = preview.targetEquipmentSectionCenterX(index);
					const centerZ = preview.targetEquipmentSectionCenterZ(index);
					const tangentX = preview.targetEquipmentSectionTangentX(index);
					const tangentZ = preview.targetEquipmentSectionTangentZ(index);
					const tangentLength = Math.hypot(tangentX, tangentZ);
					const alongX =
						(tangentX / tangentLength) * preview.targetEquipmentSectionHalfLength(index);
					const alongZ =
						(tangentZ / tangentLength) * preview.targetEquipmentSectionHalfLength(index);
					const acrossX =
						(-tangentZ / tangentLength) * preview.targetEquipmentSectionHalfWidth(index);
					const acrossZ =
						(tangentX / tangentLength) * preview.targetEquipmentSectionHalfWidth(index);
					const corners = [
						[centerX - alongX - acrossX, centerZ - alongZ - acrossZ],
						[centerX + alongX - acrossX, centerZ + alongZ - acrossZ],
						[centerX + alongX + acrossX, centerZ + alongZ + acrossZ],
						[centerX - alongX + acrossX, centerZ - alongZ + acrossZ],
					] as const;
					ctx.beginPath();
					for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
						const corner = corners[cornerIndex] as (typeof corners)[number];
						const screenX = staticFabArrangementScreenX(corner[0], corner[1], input.camera);
						const screenY = staticFabArrangementScreenY(corner[0], corner[1], input.camera);
						if (cornerIndex === 0) ctx.moveTo(screenX, screenY);
						else ctx.lineTo(screenX, screenY);
					}
					ctx.closePath();
					ctx.fill();
					ctx.stroke();
					this.staticFabArrangementPreviewVisibleEquipmentSections++;
				}
				return true;
			},
		);

		ctx.lineWidth = Math.max(1.25, Math.min(2, input.camera.zoom * 0.1));
		const radius = Math.max(2.5, Math.min(7, input.camera.zoom * 0.2));
		this.visitStaticFabArrangementPresentationChunks(preview, visibleBounds, 0, (chunk) => {
			const end = chunk.portIndexStart + chunk.portIndexCount;
			for (let row = chunk.portIndexStart; row < end; row++) {
				if (
					this.staticFabArrangementPreviewVisiblePorts >=
					STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_VISIBLE_PORTS
				) {
					return false;
				}
				const index = preview.presentationPortIndex(row);
				const x = preview.targetPortX(index);
				const z = preview.targetPortZ(index);
				if (
					!staticFabArrangementPointIntersectsVisible(
						x,
						z,
						visibleBounds,
						radius / input.camera.zoom,
					)
				) {
					continue;
				}
				ctx.beginPath();
				ctx.arc(
					staticFabArrangementScreenX(x, z, input.camera),
					staticFabArrangementScreenY(x, z, input.camera),
					radius,
					0,
					Math.PI * 2,
				);
				ctx.fill();
				ctx.stroke();
				this.staticFabArrangementPreviewVisiblePorts++;
			}
			return true;
		});
	}

	private visitStaticFabArrangementPresentationChunks(
		preview: StaticFabArrangementPreviewArtifact,
		visibleBounds: Float64Array,
		marginMeters: number,
		visit: (chunk: StaticFabArrangementPreviewPresentationChunk) => boolean,
	): void {
		if (preview.presentationChunkCount === 0) return;
		const minChunkX = Math.floor(
			((visibleBounds[0] as number) - marginMeters) / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
		);
		const maxChunkX = Math.floor(
			((visibleBounds[1] as number) + marginMeters) / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
		);
		const minChunkZ = Math.floor(
			((visibleBounds[2] as number) - marginMeters) / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
		);
		const maxChunkZ = Math.floor(
			((visibleBounds[3] as number) + marginMeters) / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
		);
		const gridArea = (maxChunkX - minChunkX + 1) * (maxChunkZ - minChunkZ + 1);
		if (gridArea <= preview.presentationChunkCount * 3 + 16) {
			for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
				for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
					const chunk = preview.readPresentationChunk(chunkX, chunkZ);
					if (chunk && !visit(chunk)) return;
				}
			}
			return;
		}
		for (const chunk of preview.presentationChunks) {
			if (
				chunk.chunkX < minChunkX ||
				chunk.chunkX > maxChunkX ||
				chunk.chunkZ < minChunkZ ||
				chunk.chunkZ > maxChunkZ
			) {
				continue;
			}
			if (!visit(chunk)) return;
		}
	}

	private drawStaticFabArrangementPreviewChunks(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		preview: StaticFabArrangementPreviewArtifact,
		visibleBounds: Float64Array,
		targetStroke: string,
		targetFill: string,
		drawTargetCells: boolean,
		drawConflicts: boolean,
	): void {
		const minChunkX = Math.floor(
			(visibleBounds[0] as number) / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
		);
		const maxChunkX = Math.floor(
			(visibleBounds[1] as number) / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
		);
		const minChunkZ = Math.floor(
			(visibleBounds[2] as number) / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
		);
		const maxChunkZ = Math.floor(
			(visibleBounds[3] as number) / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
		);
		const chunkGridArea = (maxChunkX - minChunkX + 1) * (maxChunkZ - minChunkZ + 1);
		if (chunkGridArea <= preview.chunkCount * 3 + 16) {
			chunkRows: for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
				for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
					if (this.staticFabArrangementPreviewComplete(preview, drawTargetCells, drawConflicts)) {
						break chunkRows;
					}
					const chunk = preview.readChunk(chunkX, chunkZ);
					if (chunk) {
						this.drawStaticFabArrangementPreviewChunk(
							ctx,
							input,
							preview,
							chunk,
							visibleBounds,
							targetStroke,
							targetFill,
							drawTargetCells,
							drawConflicts,
						);
					}
				}
			}
			return;
		}

		for (let index = 0; index < preview.chunks.length; index++) {
			const chunk = preview.chunks[index] as StaticFabArrangementPreviewChunk;
			if (this.staticFabArrangementPreviewComplete(preview, drawTargetCells, drawConflicts)) {
				break;
			}
			if (
				chunk.chunkX < minChunkX ||
				chunk.chunkX > maxChunkX ||
				chunk.chunkZ < minChunkZ ||
				chunk.chunkZ > maxChunkZ
			) {
				continue;
			}
			this.drawStaticFabArrangementPreviewChunk(
				ctx,
				input,
				preview,
				chunk,
				visibleBounds,
				targetStroke,
				targetFill,
				drawTargetCells,
				drawConflicts,
			);
		}
	}

	private drawStaticFabArrangementPreviewChunk(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		preview: StaticFabArrangementPreviewArtifact,
		chunk: StaticFabArrangementPreviewChunk,
		visibleBounds: Float64Array,
		targetStroke: string,
		targetFill: string,
		drawTargetCells: boolean,
		drawConflicts: boolean,
	): void {
		this.staticFabArrangementPreviewVisibleChunks++;
		if (
			drawTargetCells &&
			this.staticFabArrangementPreviewVisibleTargetCells <
				STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_VISIBLE_TARGET_CELLS
		) {
			ctx.fillStyle = targetFill;
			ctx.strokeStyle = targetStroke;
			ctx.lineWidth = 1;
			const targetEnd = chunk.targetCellStart + chunk.targetCellCount;
			for (let index = chunk.targetCellStart; index < targetEnd; index++) {
				if (
					this.staticFabArrangementPreviewVisibleTargetCells >=
					STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_VISIBLE_TARGET_CELLS
				) {
					break;
				}
				const x = preview.targetCellX(index);
				const z = preview.targetCellZ(index);
				if (!staticFabArrangementCellIntersectsVisible(x, z, visibleBounds)) continue;
				const left = staticFabArrangementCellScreenLeft(x, z, input.camera);
				const top = staticFabArrangementCellScreenTop(x, z, input.camera);
				const inset = Math.max(1, input.camera.zoom * 0.1);
				const size = Math.max(1, input.camera.zoom - inset * 2);
				ctx.fillRect(left + inset, top + inset, size, size);
				if (input.camera.zoom >= 12) {
					ctx.strokeRect(left + inset + 0.5, top + inset + 0.5, size - 1, size - 1);
				}
				this.staticFabArrangementPreviewVisibleTargetCells++;
			}
		}

		if (drawConflicts) {
			ctx.fillStyle = "rgba(224, 76, 85, 0.42)";
			ctx.strokeStyle = COLORS.invalid;
			ctx.lineWidth = 2;
			const conflictEnd = chunk.conflictStart + chunk.conflictCount;
			for (let index = chunk.conflictStart; index < conflictEnd; index++) {
				const x = preview.conflictX(index);
				const z = preview.conflictZ(index);
				if (!staticFabArrangementCellIntersectsVisible(x, z, visibleBounds)) continue;
				const left = staticFabArrangementCellScreenLeft(x, z, input.camera);
				const top = staticFabArrangementCellScreenTop(x, z, input.camera);
				const inset = Math.max(1, input.camera.zoom * 0.08);
				const right = left + input.camera.zoom - inset;
				const bottom = top + input.camera.zoom - inset;
				ctx.fillRect(
					left + inset,
					top + inset,
					Math.max(1, input.camera.zoom - inset * 2),
					Math.max(1, input.camera.zoom - inset * 2),
				);
				ctx.beginPath();
				ctx.moveTo(left + inset, top + inset);
				ctx.lineTo(right, bottom);
				ctx.moveTo(right, top + inset);
				ctx.lineTo(left + inset, bottom);
				ctx.stroke();
				this.staticFabArrangementPreviewVisibleConflicts++;
			}
		}
	}

	private staticFabArrangementPreviewComplete(
		preview: StaticFabArrangementPreviewArtifact,
		drawTargetCells: boolean,
		drawConflicts: boolean,
	): boolean {
		return (
			(!drawTargetCells ||
				this.staticFabArrangementPreviewVisibleTargetCells >=
					STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_VISIBLE_TARGET_CELLS) &&
			(!drawConflicts ||
				this.staticFabArrangementPreviewVisibleConflicts >= preview.reportedConflictCount)
		);
	}

	private drawStaticFabArrangementBounds(
		ctx: CanvasRenderingContext2D,
		bounds: StaticFabArrangementPreviewRoot["sourceBounds"],
		camera: Camera,
	): void {
		const firstX = staticFabArrangementScreenX(bounds.minX, bounds.minZ, camera);
		const firstY = staticFabArrangementScreenY(bounds.minX, bounds.minZ, camera);
		const secondX = staticFabArrangementScreenX(bounds.maxXExclusive, bounds.maxZExclusive, camera);
		const secondY = staticFabArrangementScreenY(bounds.maxXExclusive, bounds.maxZExclusive, camera);
		const left = Math.min(firstX, secondX);
		const top = Math.min(firstY, secondY);
		const width = Math.abs(secondX - firstX);
		const height = Math.abs(secondY - firstY);
		ctx.fillRect(left, top, width, height);
		ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
	}

	private bindStaticFabOrganizationOutline(input: TileRenderInput): void {
		const outline = input.staticFabOrganizationOutline ?? null;
		if (this.boundStaticFabOrganizationOutline !== outline) {
			this.boundStaticFabOrganizationOutline = outline;
			const organizationCount = outline?.organizationCount ?? 0;
			this.staticFabOrganizationOutlineQueryRows = new Int32Array(organizationCount);
			this.staticFabOrganizationOutlineHitCandidates = 0;
			if (outline) this.staticFabOrganizationOutlineBindings++;
		}
		this.staticFabOrganizationSelectionEnabled =
			input.staticFabOrganizationSelectionEnabled === true && outline !== null;
		const selectedIds = input.selectedStaticFabOrganizationIds ?? EMPTY_NUMBER_ARRAY;
		if (this.selectedStaticFabOrganizationIdsSource !== selectedIds) {
			this.selectedStaticFabOrganizationIdsSource = selectedIds;
			this.selectedStaticFabOrganizationIdSet.clear();
			for (const organizationId of selectedIds) {
				if (Number.isInteger(organizationId)) {
					this.selectedStaticFabOrganizationIdSet.add(organizationId);
				}
			}
		}
	}

	private drawStaticFabOrganizationOutlines(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
	): void {
		this.staticFabOrganizationOutlineQueryCandidates = 0;
		this.staticFabOrganizationOutlineVisibleRows = 0;
		const outline = this.boundStaticFabOrganizationOutline;
		if (!outline || !this.staticFabOrganizationSelectionEnabled) return;

		writeStaticFabOrganizationOutlineVisibleBounds(
			this.staticFabOrganizationOutlineVisibleBounds,
			input.camera,
			input.width,
			input.height,
			2,
		);
		const count = outline.queryBounds(
			this.staticFabOrganizationOutlineVisibleBounds,
			this.staticFabOrganizationOutlineQueryRows,
		);
		this.staticFabOrganizationOutlineQueryCandidates = count;
		const hoveredId = input.hoverStaticFabOrganizationId ?? null;
		let passiveRows = 0;
		ctx.save();
		for (const role of STATIC_FAB_ORGANIZATION_OUTLINE_PASSIVE_ROLE_ORDER) {
			if (!staticFabOrganizationOutlineRoleVisible(role, input.camera.zoom)) continue;
			for (let index = 0; index < count; index++) {
				if (passiveRows >= STATIC_FAB_ORGANIZATION_OUTLINE_MAX_PASSIVE_ROWS) break;
				const row = this.staticFabOrganizationOutlineQueryRows[index] as number;
				if (outline.readOrganizationRole(row) !== role) continue;
				const organizationId = outline.readOrganizationId(row);
				if (
					organizationId === hoveredId ||
					this.selectedStaticFabOrganizationIdSet.has(organizationId)
				) {
					continue;
				}
				this.drawStaticFabOrganizationOutlineRow(ctx, input, outline, row, "passive");
				passiveRows++;
			}
			if (passiveRows >= STATIC_FAB_ORGANIZATION_OUTLINE_MAX_PASSIVE_ROWS) break;
		}

		for (let index = 0; index < count; index++) {
			const row = this.staticFabOrganizationOutlineQueryRows[index] as number;
			const organizationId = outline.readOrganizationId(row);
			if (
				organizationId !== hoveredId &&
				this.selectedStaticFabOrganizationIdSet.has(organizationId)
			) {
				this.drawStaticFabOrganizationOutlineRow(ctx, input, outline, row, "selected");
			}
		}
		if (hoveredId !== null) {
			for (let index = 0; index < count; index++) {
				const row = this.staticFabOrganizationOutlineQueryRows[index] as number;
				if (outline.readOrganizationId(row) === hoveredId) {
					this.drawStaticFabOrganizationOutlineRow(ctx, input, outline, row, "hovered");
					break;
				}
			}
		}
		ctx.restore();
	}

	private drawStaticFabOrganizationOutlineRow(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		outline: StaticFabOrganizationOutlineIndex,
		row: number,
		state: "hovered" | "passive" | "selected",
	): void {
		if (
			!outline.readOrganizationBounds(row, "EFFECTIVE", this.staticFabOrganizationOutlineReadBounds)
		) {
			return;
		}
		const bounds = this.staticFabOrganizationOutlineReadBounds;
		const minimum = this.worldToScreen({ x: bounds.minX, y: bounds.minZ }, input.camera);
		const maximum = this.worldToScreen({ x: bounds.maxX, y: bounds.maxZ }, input.camera);
		const left = Math.min(minimum.x, maximum.x);
		const top = Math.min(minimum.y, maximum.y);
		const width = Math.abs(maximum.x - minimum.x);
		const height = Math.abs(maximum.y - minimum.y);
		const role = outline.readOrganizationRole(row);
		ctx.strokeStyle = staticFabOrganizationOutlineStrokeStyle(role, state);
		ctx.lineWidth = state === "hovered" ? 3 : state === "selected" ? 2.5 : 1.25;
		ctx.setLineDash(
			state === "passive" ? staticFabOrganizationOutlinePassiveDash(role) : EMPTY_LINE_DASH,
		);
		ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
		ctx.setLineDash(EMPTY_LINE_DASH);
		this.staticFabOrganizationOutlineVisibleRows++;
	}

	private drawRailAreaSelectionOutline(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		selection: RailAreaSelection,
	): void {
		const minimum = this.worldToScreen(
			{ x: selection.bounds.minX, y: selection.bounds.minY },
			input.camera,
		);
		const maximum = this.worldToScreen(
			{ x: selection.bounds.maxX + 1, y: selection.bounds.maxY + 1 },
			input.camera,
		);
		const left = Math.min(minimum.x, maximum.x);
		const top = Math.min(minimum.y, maximum.y);
		const width = Math.abs(maximum.x - minimum.x);
		const height = Math.abs(maximum.y - minimum.y);
		ctx.save();
		ctx.fillStyle = "rgba(79, 188, 198, 0.025)";
		ctx.strokeStyle = COLORS.areaSelection;
		ctx.lineWidth = 2;
		ctx.setLineDash([10, 6]);
		ctx.fillRect(left, top, width, height);
		ctx.strokeRect(left, top, width, height);
		ctx.setLineDash([]);
		const label = `${selection.ownerships.length.toLocaleString()} MODULES`;
		ctx.font = "750 10px Inter, system-ui, sans-serif";
		const labelWidth = ctx.measureText(label).width;
		const labelX = clamp(left + 8, 8, Math.max(8, input.width - labelWidth - 16));
		const labelY = clamp(top + 18, 18, Math.max(18, input.height - 8));
		ctx.fillStyle = "rgba(8, 16, 17, 0.92)";
		roundRect(ctx, labelX - 5, labelY - 12, labelWidth + 10, 18, 3);
		ctx.fill();
		ctx.fillStyle = COLORS.areaSelection;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, labelX, labelY);
		ctx.restore();
	}

	private drawRailAreaMarquee(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		start: Cell,
		end: Cell,
		operation: "replace" | "add" | "subtract",
	): void {
		const minX = Math.min(start.x, end.x);
		const minY = Math.min(start.y, end.y);
		const maxX = Math.max(start.x, end.x) + 1;
		const maxY = Math.max(start.y, end.y) + 1;
		const corners = [
			this.worldToScreen({ x: minX, y: minY }, input.camera),
			this.worldToScreen({ x: maxX, y: minY }, input.camera),
			this.worldToScreen({ x: maxX, y: maxY }, input.camera),
			this.worldToScreen({ x: minX, y: maxY }, input.camera),
		];
		ctx.save();
		ctx.fillStyle =
			operation === "subtract" ? COLORS.areaSelectionSubtractFill : "rgba(79, 188, 198, 0.11)";
		ctx.strokeStyle =
			operation === "subtract" ? COLORS.areaSelectionSubtract : COLORS.areaSelection;
		ctx.lineWidth = 1.5;
		ctx.setLineDash([6, 4]);
		ctx.beginPath();
		ctx.moveTo(corners[0]?.x ?? 0, corners[0]?.y ?? 0);
		for (let index = 1; index < corners.length; index++) {
			const point = corners[index];
			if (point) ctx.lineTo(point.x, point.y);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}

	private resolveRailAreaSelectionCells(selection: RailAreaSelection): readonly Cell[] {
		if (this.areaSelectionSource === selection) return this.areaSelectionCells;
		const cells = new Map<string, Cell>();
		for (const ownership of selection.ownerships) {
			for (const cell of ownership.footprintCells) {
				cells.set(cellKey(cell.x, cell.y), cell);
			}
		}
		this.areaSelectionSource = selection;
		this.areaSelectionCells = Object.freeze([...cells.values()]);
		return this.areaSelectionCells;
	}

	private drawSelectedModule(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const { selectedTile, selectedModule, map, camera, physicalPaths } = input;
		if (!selectedTile || !selectedModule) return;
		if (selectedModule.advancedSwitchId !== null) {
			const record = map.getAdvancedSwitch(selectedModule.advancedSwitchId);
			if (record) {
				const visual = {
					record,
					geometry: deriveAdvancedSwitchGeometry(record),
				};
				this.drawAdvancedSwitchEnvelope(ctx, visual, camera, "selected");
				this.drawAdvancedSwitchDetails(ctx, visual, camera, "selected");
			}
		}
		const selection = this.resolveSelectedPhysicalPaths(physicalPaths, selectedModule);
		if (!selection || selection.count === 0) return;
		const mode = input.railPresentationMode ?? "profiled";
		this.drawPhysicalSelectionInteraction(
			ctx,
			physicalPaths,
			selection,
			camera,
			mode,
			this.getSelectedScreenPaths(physicalPaths, selection, camera, mode),
		);
	}

	private drawIssueTiles(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const cells = input.issueTiles;
		const kind = input.issueHighlightKind ?? "fault";
		const issuePathIndices = this.resolveIssuePathIndices(input);
		if ((!cells || cells.length === 0) && issuePathIndices.length === 0 && !input.issueCorridor) {
			return;
		}
		if (kind === "corridor" && input.issueCorridor) {
			this.drawIssueCorridor(ctx, input, input.issueCorridor);
			return;
		}
		if (kind === "path" && issuePathIndices.length > 0) {
			this.drawPhysicalPathInteraction(
				ctx,
				input.physicalPaths,
				issuePathIndices,
				input.camera,
				input.railPresentationMode ?? "profiled",
				"#69d4dc",
				true,
			);
		}
		ctx.save();
		ctx.fillStyle =
			kind === "fault"
				? COLORS.issueFill
				: kind === "region"
					? "rgba(230, 190, 86, 0.2)"
					: "rgba(93, 210, 219, 0.18)";
		ctx.strokeStyle = kind === "fault" ? COLORS.issue : kind === "region" ? "#e3bd58" : "#69d4dc";
		ctx.lineWidth = 2;
		if (kind === "fault") ctx.setLineDash([5, 3]);
		const padding = Math.max(2, input.camera.zoom * 0.08);
		const size = Math.max(4, input.camera.zoom - padding * 2);
		for (let index = 0; index < Math.min(cells?.length ?? 0, 256); index++) {
			const cell = cells?.[index] as Cell;
			const origin = this.tileOrigin(cell, input.camera);
			if (
				origin.x > input.width + input.camera.zoom ||
				origin.y > input.height + input.camera.zoom ||
				origin.x + input.camera.zoom < 0 ||
				origin.y + input.camera.zoom < 0
			) {
				continue;
			}
			if (kind === "fault") {
				ctx.fillRect(origin.x + padding, origin.y + padding, size, size);
				ctx.strokeRect(origin.x + padding, origin.y + padding, size, size);
				continue;
			}
			const centerX = origin.x + input.camera.zoom * 0.5;
			const centerY = origin.y + input.camera.zoom * 0.5;
			const radius = clamp(input.camera.zoom * 0.2, 6, 10);
			ctx.beginPath();
			ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			if (input.camera.zoom >= 18) {
				ctx.fillStyle = kind === "region" ? "#fff1ba" : "#d6fbff";
				ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(String(index + 1), centerX, centerY);
				ctx.fillStyle = kind === "region" ? "rgba(230, 190, 86, 0.2)" : "rgba(93, 210, 219, 0.18)";
			}
		}
		const focus = input.issueFocusTile;
		if (focus) {
			const center = this.worldToScreen({ x: focus.x + 0.5, y: focus.y + 0.5 }, input.camera);
			const radius = clamp(input.camera.zoom * 0.43, 10, 22);
			ctx.setLineDash([]);
			ctx.strokeStyle = kind === "fault" ? "#ffb0b5" : kind === "region" ? "#ffe59a" : "#b7f7fb";
			ctx.fillStyle =
				kind === "fault"
					? "rgba(255, 102, 112, 0.18)"
					: kind === "region"
						? "rgba(230, 190, 86, 0.18)"
						: "rgba(93, 210, 219, 0.16)";
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(center.x - radius - 5, center.y);
			ctx.lineTo(center.x + radius + 5, center.y);
			ctx.moveTo(center.x, center.y - radius - 5);
			ctx.lineTo(center.x, center.y + radius + 5);
			ctx.stroke();
		}
		ctx.restore();
	}

	private drawIssueCorridor(
		ctx: CanvasRenderingContext2D,
		input: TileRenderInput,
		corridor: RailIssueCorridor,
	): void {
		if (corridor.cells.length < 2) return;
		const departure = this.worldToScreen(
			{
				x: corridor.departure.from.x + 0.5,
				y: corridor.departure.from.y + 0.5,
			},
			input.camera,
		);
		const arrival = this.worldToScreen(
			{ x: corridor.arrival.to.x + 0.5, y: corridor.arrival.to.y + 0.5 },
			input.camera,
		);
		const anchorRadius = clamp(input.camera.zoom * 0.34, 9, 18);

		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = "rgba(255, 196, 76, 0.24)";
		ctx.lineWidth = clamp(input.camera.zoom * 0.7, 12, 26);
		const screenPath = this.resolveIssueCorridorScreenPath(corridor, input);
		if (screenPath) {
			ctx.stroke(screenPath);
		} else if (typeof Path2D === "undefined") {
			this.traceVisibleIssueCorridor(ctx, corridor, input);
			ctx.stroke();
		}
		ctx.strokeStyle = "#ffd369";
		ctx.lineWidth = 3;
		ctx.setLineDash([9, 6]);
		if (screenPath) ctx.stroke(screenPath);
		else if (typeof Path2D === "undefined") ctx.stroke();

		for (const [point, color] of [
			[departure, "#ffd369"],
			[arrival, "#77e4dc"],
		] as const) {
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.arc(point.x, point.y, anchorRadius, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(11, 16, 17, 0.86)";
			ctx.fill();
			ctx.strokeStyle = color;
			ctx.lineWidth = 3;
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(point.x, point.y, Math.max(3, anchorRadius * 0.28), 0, Math.PI * 2);
			ctx.fillStyle = color;
			ctx.fill();
		}

		this.drawIssueCorridorLabel(
			ctx,
			departure.x,
			departure.y - anchorRadius - 9,
			"ONE-WAY OUT",
			"#ffd369",
		);
		this.drawIssueCorridorLabel(
			ctx,
			arrival.x,
			arrival.y - anchorRadius - 9,
			"ONE-WAY IN",
			"#77e4dc",
		);
		ctx.restore();
	}

	private resolveIssueCorridorScreenPath(
		corridor: RailIssueCorridor,
		input: TileRenderInput,
	): Path2D | null {
		if (typeof Path2D === "undefined") return null;
		const key = `${screenPathCameraKey(input.camera, "centerline")}:${input.width}:${input.height}`;
		if (this.issueCorridorSource === corridor && this.issueCorridorScreenKey === key) {
			return this.issueCorridorScreenPath;
		}
		const path = new Path2D();
		this.issueCorridorSource = corridor;
		this.issueCorridorScreenKey = key;
		this.issueCorridorScreenPathBuilds++;
		this.issueCorridorVisibleSegments = this.traceVisibleIssueCorridor(path, corridor, input);
		this.issueCorridorScreenPath = this.issueCorridorVisibleSegments > 0 ? path : null;
		return this.issueCorridorScreenPath;
	}

	private traceVisibleIssueCorridor(
		path: Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo"> | Path2D,
		corridor: RailIssueCorridor,
		input: TileRenderInput,
	): number {
		const beginPath = "beginPath" in path ? path.beginPath.bind(path) : null;
		beginPath?.();
		const bounds = visibleBounds(input.camera, input.width, input.height, 2);
		const candidates = this.queryIssueCorridorSegments(corridor, bounds);
		let previousVisibleSegment = -1;
		let visibleSegments = 0;
		for (const segmentIndex of candidates) {
			const from = corridor.cells[segmentIndex - 1] as Cell;
			const to = corridor.cells[segmentIndex] as Cell;
			const visible =
				Math.max(from.x + 0.5, to.x + 0.5) >= bounds.minX &&
				Math.min(from.x + 0.5, to.x + 0.5) <= bounds.maxX &&
				Math.max(from.y + 0.5, to.y + 0.5) >= bounds.minY &&
				Math.min(from.y + 0.5, to.y + 0.5) <= bounds.maxY;
			if (!visible) {
				previousVisibleSegment = -1;
				continue;
			}
			if (segmentIndex !== previousVisibleSegment + 1) {
				const screen = this.worldToScreen({ x: from.x + 0.5, y: from.y + 0.5 }, input.camera);
				path.moveTo(screen.x, screen.y);
			}
			const screen = this.worldToScreen({ x: to.x + 0.5, y: to.y + 0.5 }, input.camera);
			path.lineTo(screen.x, screen.y);
			previousVisibleSegment = segmentIndex;
			visibleSegments++;
		}
		return visibleSegments;
	}

	private queryIssueCorridorSegments(
		corridor: RailIssueCorridor,
		bounds: { minX: number; maxX: number; minY: number; maxY: number },
	): readonly number[] {
		let index = this.issueCorridorSegmentIndexCache.get(corridor);
		if (!index) {
			index = this.buildIssueCorridorSegmentIndex(corridor);
			this.issueCorridorSegmentIndexCache.set(corridor, index);
			this.issueCorridorSegmentIndexBuilds++;
		}
		index.visitGeneration++;
		if (index.visitGeneration === 0xffff_ffff) {
			index.visitStamps.fill(0);
			index.visitGeneration = 1;
		}
		const generation = index.visitGeneration;
		const candidates = this.issueCorridorCandidateBuffer;
		candidates.length = 0;
		const minChunkX = Math.floor(bounds.minX / ISSUE_CORRIDOR_INDEX_CHUNK_SIZE);
		const maxChunkX = Math.floor(bounds.maxX / ISSUE_CORRIDOR_INDEX_CHUNK_SIZE);
		const minChunkY = Math.floor(bounds.minY / ISSUE_CORRIDOR_INDEX_CHUNK_SIZE);
		const maxChunkY = Math.floor(bounds.maxY / ISSUE_CORRIDOR_INDEX_CHUNK_SIZE);
		for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const bucket = index.buckets.get(cellKey(chunkX, chunkY));
				if (!bucket) continue;
				for (const segmentIndex of bucket) {
					if (index.visitStamps[segmentIndex] === generation) continue;
					index.visitStamps[segmentIndex] = generation;
					candidates.push(segmentIndex);
				}
			}
		}
		candidates.sort((left, right) => left - right);
		this.issueCorridorCandidateSegments = candidates.length;
		return candidates;
	}

	private buildIssueCorridorSegmentIndex(
		corridor: RailIssueCorridor,
	): RailIssueCorridorSegmentIndex {
		const mutableBuckets = new Map<string, number[]>();
		for (let segmentIndex = 1; segmentIndex < corridor.cells.length; segmentIndex++) {
			const from = corridor.cells[segmentIndex - 1] as Cell;
			const to = corridor.cells[segmentIndex] as Cell;
			const minChunkX = Math.floor(
				Math.min(from.x + 0.5, to.x + 0.5) / ISSUE_CORRIDOR_INDEX_CHUNK_SIZE,
			);
			const maxChunkX = Math.floor(
				Math.max(from.x + 0.5, to.x + 0.5) / ISSUE_CORRIDOR_INDEX_CHUNK_SIZE,
			);
			const minChunkY = Math.floor(
				Math.min(from.y + 0.5, to.y + 0.5) / ISSUE_CORRIDOR_INDEX_CHUNK_SIZE,
			);
			const maxChunkY = Math.floor(
				Math.max(from.y + 0.5, to.y + 0.5) / ISSUE_CORRIDOR_INDEX_CHUNK_SIZE,
			);
			for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
				for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
					const key = cellKey(chunkX, chunkY);
					const bucket = mutableBuckets.get(key);
					if (bucket) bucket.push(segmentIndex);
					else mutableBuckets.set(key, [segmentIndex]);
				}
			}
		}
		return {
			buckets: new Map(
				[...mutableBuckets].map(([key, segmentIndices]) => [key, Uint32Array.from(segmentIndices)]),
			),
			visitStamps: new Uint32Array(corridor.cells.length),
			visitGeneration: 0,
		};
	}

	private drawIssueCorridorLabel(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		label: string,
		color: string,
	): void {
		ctx.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const width = ctx.measureText(label).width + 12;
		ctx.fillStyle = "rgba(10, 15, 16, 0.94)";
		ctx.fillRect(x - width * 0.5, y - 8, width, 16);
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.strokeRect(x - width * 0.5, y - 8, width, 16);
		ctx.fillStyle = color;
		ctx.fillText(label, x, y + 0.5);
	}

	private resolveIssuePathIndices(input: TileRenderInput): readonly number[] {
		const snapshot = input.issuePathIdentityIndex ?? null;
		const identity = input.issuePathIdentity;
		if (!snapshot || !identity) {
			this.issuePathIdentityKey = "";
			this.issuePathIndices.length = 0;
			return this.issuePathIndices;
		}
		if (this.boundIssuePathIdentityIndex !== snapshot) {
			this.boundIssuePathIdentityIndex = snapshot;
			this.issuePathIdentityIndex = new PhysicalPathIdentityIndex(snapshot);
			this.issuePathIdentityKey = "";
		}
		const key = identity.join(":");
		if (key === this.issuePathIdentityKey) return this.issuePathIndices;
		this.issuePathIdentityKey = key;
		this.issuePathIndices.length = 0;
		const matches = this.issuePathIdentityIndex?.get(identity);
		if (matches) for (const pathIndex of matches) this.issuePathIndices.push(pathIndex);
		return this.issuePathIndices;
	}

	private resolveSelectedPhysicalPaths(
		paths: CompiledPhysicalPaths,
		module: RailModuleOwnership,
	): CompiledPhysicalPathSelection | null {
		if (
			this.selectedModuleSource === paths &&
			this.selectedModuleKey === module.key &&
			this.selectedModuleRevision === module.revision
		) {
			return this.selectedPhysicalSelection;
		}
		this.selectedModuleSource = paths;
		this.selectedModuleKey = module.key;
		this.selectedModuleRevision = module.revision;
		const candidates = this.collectSelectionPathCandidates(module);
		this.physicalSelectionCandidates = candidates.length;
		this.selectedPhysicalSelection = compilePhysicalModuleSelection(paths, module, candidates);
		this.physicalSelectionBuilds++;
		return this.selectedPhysicalSelection;
	}

	private collectSelectionPathCandidates(module: RailModuleOwnership): readonly number[] {
		const target = this.selectionCandidatePathBuffer;
		target.length = 0;
		this.selectionCandidateGeneration++;
		if (this.selectionCandidateGeneration === 0xffff_ffff) {
			this.selectionCandidateStamps.fill(0);
			this.selectionCandidateGeneration = 1;
		}
		return collectPhysicalModulePathCandidates(
			this.pathIndicesByCell,
			module,
			this.selectionCandidateStamps,
			this.selectionCandidateGeneration,
			target,
		);
	}

	private getHoverScreenPaths(
		paths: CompiledPhysicalPaths,
		pathIndex: number,
		camera: Camera,
		mode: RailPresentationMode,
	): PhysicalRailScreenPaths | null {
		if (typeof Path2D === "undefined") return null;
		const key = `${pathIndex}:${screenPathCameraKey(camera, mode)}`;
		if (
			this.hoverScreenPathSource === paths &&
			this.hoverScreenPathKey === key &&
			this.hoverScreenPaths
		) {
			return this.hoverScreenPaths;
		}
		const presentation = this.physicalPresentation;
		const profiled = mode === "profiled" && camera.zoom >= 12 && presentation?.source === paths;
		const edgeOffset =
			profiled && presentation
				? presentation.profile.beamCenterOffsetMeters +
					presentation.profile.beamWidthMeters / 2 +
					0.018
				: 0;
		this.hoverPathIndexBuffer[0] = pathIndex;
		this.hoverScreenPathSource = paths;
		this.hoverScreenPathKey = key;
		this.hoverScreenPaths = Object.freeze({
			center: profiled
				? null
				: this.buildPhysicalScreenPath(paths, this.hoverPathIndexBuffer, camera, null, 0),
			left:
				profiled && presentation
					? this.buildPhysicalScreenPath(
							paths,
							this.hoverPathIndexBuffer,
							camera,
							presentation,
							-edgeOffset,
						)
					: null,
			right:
				profiled && presentation
					? this.buildPhysicalScreenPath(
							paths,
							this.hoverPathIndexBuffer,
							camera,
							presentation,
							edgeOffset,
						)
					: null,
		});
		this.hoverScreenPathBuilds++;
		return this.hoverScreenPaths;
	}

	private getSelectedScreenPaths(
		paths: CompiledPhysicalPaths,
		selection: CompiledPhysicalPathSelection,
		camera: Camera,
		mode: RailPresentationMode,
	): PhysicalRailScreenPaths | null {
		if (typeof Path2D === "undefined") return null;
		const key = screenPathCameraKey(camera, mode);
		if (
			this.selectedScreenPathSource === paths &&
			this.selectedScreenPathSelection === selection &&
			this.selectedScreenPathKey === key &&
			this.selectedScreenPaths
		) {
			return this.selectedScreenPaths;
		}
		const presentation = this.physicalPresentation;
		const profiled = mode === "profiled" && camera.zoom >= 12 && presentation?.source === paths;
		const edgeOffset =
			profiled && presentation
				? presentation.profile.beamCenterOffsetMeters +
					presentation.profile.beamWidthMeters / 2 +
					0.018
				: 0;
		this.selectedScreenPathSource = paths;
		this.selectedScreenPathSelection = selection;
		this.selectedScreenPathKey = key;
		this.selectedScreenPaths = Object.freeze({
			center: profiled ? null : this.buildPhysicalSelectionScreenPath(paths, selection, camera, 0),
			left: profiled
				? this.buildPhysicalSelectionScreenPath(paths, selection, camera, -edgeOffset)
				: null,
			right: profiled
				? this.buildPhysicalSelectionScreenPath(paths, selection, camera, edgeOffset)
				: null,
		});
		this.selectedScreenPathBuilds++;
		return this.selectedScreenPaths;
	}

	private drawPhysicalPathInteraction(
		ctx: CanvasRenderingContext2D,
		paths: CompiledPhysicalPaths,
		pathIndices: readonly number[],
		camera: Camera,
		mode: RailPresentationMode,
		accent: string,
		selected: boolean,
		screenPaths: PhysicalRailScreenPaths | null = null,
	): void {
		const presentation = this.physicalPresentation;
		const profiled = mode === "profiled" && camera.zoom >= 12 && presentation?.source === paths;
		if (!profiled || !presentation) {
			const path =
				screenPaths?.center ?? this.buildPhysicalScreenPath(paths, pathIndices, camera, null, 0);
			this.strokeInteractionPath(
				ctx,
				path,
				() => {
					this.tracePhysicalPathIndices(ctx, paths, pathIndices, camera, null, 0);
				},
				accent,
				selected,
			);
			return;
		}
		const edgeOffset =
			presentation.profile.beamCenterOffsetMeters +
			presentation.profile.beamWidthMeters / 2 +
			0.018;
		for (const [side, offset] of [
			["left", -edgeOffset],
			["right", edgeOffset],
		] as const) {
			const path =
				screenPaths?.[side] ??
				this.buildPhysicalScreenPath(paths, pathIndices, camera, presentation, offset);
			this.strokeInteractionPath(
				ctx,
				path,
				() => {
					this.tracePhysicalPathIndices(ctx, paths, pathIndices, camera, presentation, offset);
				},
				accent,
				selected,
			);
		}
	}

	private drawPhysicalSelectionInteraction(
		ctx: CanvasRenderingContext2D,
		paths: CompiledPhysicalPaths,
		selection: CompiledPhysicalPathSelection,
		camera: Camera,
		mode: RailPresentationMode,
		screenPaths: PhysicalRailScreenPaths | null = null,
	): void {
		const presentation = this.physicalPresentation;
		const profiled = mode === "profiled" && camera.zoom >= 12 && presentation?.source === paths;
		const edgeOffset =
			profiled && presentation
				? presentation.profile.beamCenterOffsetMeters +
					presentation.profile.beamWidthMeters / 2 +
					0.018
				: 0;
		for (const [side, offset] of profiled
			? ([
					["left", -edgeOffset],
					["right", edgeOffset],
				] as const)
			: ([["center", 0]] as const)) {
			const path =
				screenPaths?.[side] ??
				this.buildPhysicalSelectionScreenPath(paths, selection, camera, offset);
			this.strokeInteractionPath(
				ctx,
				path,
				() => {
					this.tracePhysicalSelection(ctx, paths, selection, camera, offset);
				},
				COLORS.selection,
				true,
			);
		}
	}

	private strokeInteractionPath(
		ctx: CanvasRenderingContext2D,
		path: Path2D | null,
		traceFallback: () => void,
		accent: string,
		selected: boolean,
	): void {
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		if (!path) {
			ctx.beginPath();
			traceFallback();
		}
		ctx.strokeStyle = COLORS.directionHalo;
		ctx.lineWidth = selected ? 5 : 4;
		if (path) ctx.stroke(path);
		else ctx.stroke();
		ctx.strokeStyle = accent;
		ctx.lineWidth = selected ? 2.4 : 1.6;
		if (path) ctx.stroke(path);
		else ctx.stroke();
		ctx.restore();
	}

	private buildPhysicalSelectionScreenPath(
		paths: CompiledPhysicalPaths,
		selection: CompiledPhysicalPathSelection,
		camera: Camera,
		lateralOffsetMeters: number,
	): Path2D | null {
		if (typeof Path2D === "undefined") return null;
		const path = new Path2D();
		this.tracePhysicalSelection(path, paths, selection, camera, lateralOffsetMeters);
		return path;
	}

	private tracePhysicalSelection(
		sink: Pick<CanvasRenderingContext2D, "moveTo" | "lineTo">,
		paths: CompiledPhysicalPaths,
		selection: CompiledPhysicalPathSelection,
		camera: Camera,
		lateralOffsetMeters: number,
	): void {
		for (let row = 0; row < selection.count; row++) {
			const pathIndex = selection.pathIndices[row] as number;
			const startStation = selection.startStations[row] as number;
			const endStation = selection.endStations[row] as number;
			const start = samplePhysicalPath(paths, pathIndex, startStation);
			const end = samplePhysicalPath(paths, pathIndex, endStation);
			if (!start || !end) continue;
			const startScreen = this.worldToScreen(
				offsetPhysicalSample(start, lateralOffsetMeters),
				camera,
			);
			sink.moveTo(startScreen.x, startScreen.y);
			const pointStart = paths.offsets[pathIndex] as number;
			const pointEnd = paths.offsets[pathIndex + 1] as number;
			for (let pointIndex = pointStart; pointIndex < pointEnd; pointIndex++) {
				const station = paths.distances[pointIndex] as number;
				if (station <= startStation + 0.0001 || station >= endStation - 0.0001) continue;
				const pointOffset = pointIndex * 2;
				const screen = this.worldToScreen(
					offsetPhysicalPoint(
						paths.positions[pointOffset] as number,
						paths.positions[pointOffset + 1] as number,
						paths.tangents[pointOffset] as number,
						paths.tangents[pointOffset + 1] as number,
						lateralOffsetMeters,
					),
					camera,
				);
				sink.lineTo(screen.x, screen.y);
			}
			const endScreen = this.worldToScreen(offsetPhysicalSample(end, lateralOffsetMeters), camera);
			sink.lineTo(endScreen.x, endScreen.y);
		}
	}

	private tracePhysicalPathIndices(
		sink: Pick<CanvasRenderingContext2D, "moveTo" | "lineTo">,
		paths: CompiledPhysicalPaths,
		pathIndices: readonly number[],
		camera: Camera,
		presentation: CompiledRailPresentation | null,
		lateralOffsetMeters: number,
	): void {
		for (const pathIndex of pathIndices) {
			if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
			const start = paths.offsets[pathIndex] as number;
			const end = paths.offsets[pathIndex + 1] as number;
			for (let pointIndex = start; pointIndex < end; pointIndex++) {
				const pointOffset = pointIndex * 2;
				const screen = this.worldToScreen(
					{
						x:
							(paths.positions[pointOffset] as number) +
							(presentation?.pointNormals[pointOffset] ?? 0) * lateralOffsetMeters,
						y:
							(paths.positions[pointOffset + 1] as number) +
							(presentation?.pointNormals[pointOffset + 1] ?? 0) * lateralOffsetMeters,
					},
					camera,
				);
				if (pointIndex === start) sink.moveTo(screen.x, screen.y);
				else sink.lineTo(screen.x, screen.y);
			}
		}
	}

	private drawAnchor(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const { anchorTile, camera, ghost } = input;
		const isNetworkLinkSource = input.anchorIntent === "network-link-source";
		if (!anchorTile || (ghost && !isNetworkLinkSource)) return;
		const accent = isNetworkLinkSource ? "#6fe5f0" : COLORS.valid;
		this.drawHandle(ctx, anchorTile, camera, accent, true);
		const center = this.tileCenterAtScreen(anchorTile, camera);
		ctx.strokeStyle = isNetworkLinkSource ? "rgba(111, 229, 240, 0.58)" : "rgba(80, 213, 138, 0.4)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(center.x, center.y, Math.max(9, camera.zoom * 0.31), 0, Math.PI * 2);
		ctx.stroke();
		if (!isNetworkLinkSource) return;
		ctx.beginPath();
		ctx.arc(center.x, center.y, Math.max(13, camera.zoom * 0.43), 0, Math.PI * 2);
		ctx.stroke();
		const direction = input.anchorDirection;
		if (direction) {
			const vector = rotatePoint(directionVector(direction), camera.rotation);
			const tip = { x: center.x + vector.x * 18, y: center.y + vector.y * 18 };
			const perpendicular = { x: -vector.y, y: vector.x };
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.moveTo(center.x + vector.x * 8, center.y + vector.y * 8);
			ctx.lineTo(tip.x, tip.y);
			ctx.lineTo(
				tip.x - vector.x * 5 + perpendicular.x * 3,
				tip.y - vector.y * 5 + perpendicular.y * 3,
			);
			ctx.moveTo(tip.x, tip.y);
			ctx.lineTo(
				tip.x - vector.x * 5 - perpendicular.x * 3,
				tip.y - vector.y * 5 - perpendicular.y * 3,
			);
			ctx.stroke();
		}
		ctx.font = "750 9px Inter, system-ui, sans-serif";
		const label = "1 SOURCE";
		const labelWidth = ctx.measureText(label).width;
		const labelX = center.x + 12;
		const labelY = center.y - 18;
		ctx.fillStyle = "rgba(7, 12, 13, 0.94)";
		roundRect(ctx, labelX - 4, labelY - 10, labelWidth + 8, 15, 3);
		ctx.fill();
		ctx.fillStyle = accent;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillText(label, labelX, labelY);
	}

	private drawClosureSnap(ctx: CanvasRenderingContext2D, input: TileRenderInput): void {
		const { snapTargetTile, camera } = input;
		if (!snapTargetTile) return;
		const center = this.tileCenterAtScreen(snapTargetTile, camera);
		const radius = Math.max(10, Math.min(34, input.snapTargetRadiusPixels ?? 14));
		ctx.save();
		ctx.fillStyle = "rgba(8, 18, 19, 0.88)";
		ctx.strokeStyle = COLORS.valid;
		ctx.lineWidth = 2.75;
		ctx.beginPath();
		ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.strokeStyle = "rgba(202, 255, 224, 0.86)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(center.x, center.y, Math.max(3, radius - 4), 0, Math.PI * 2);
		ctx.stroke();
		ctx.strokeStyle = COLORS.valid;
		ctx.lineWidth = 2;
		const tickInner = radius + 2;
		const tickOuter = radius + 7;
		ctx.beginPath();
		ctx.moveTo(center.x - tickOuter, center.y);
		ctx.lineTo(center.x - tickInner, center.y);
		ctx.moveTo(center.x + tickInner, center.y);
		ctx.lineTo(center.x + tickOuter, center.y);
		ctx.moveTo(center.x, center.y - tickOuter);
		ctx.lineTo(center.x, center.y - tickInner);
		ctx.moveTo(center.x, center.y + tickInner);
		ctx.lineTo(center.x, center.y + tickOuter);
		ctx.stroke();
		ctx.fillStyle = "rgba(202, 255, 224, 0.96)";
		ctx.beginPath();
		ctx.arc(center.x, center.y, 2.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.font = "750 8px Inter, system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "bottom";
		const label = "SNAP";
		const labelWidth = ctx.measureText(label).width;
		const labelY = center.y - radius - 9;
		ctx.fillStyle = "rgba(7, 12, 13, 0.94)";
		roundRect(ctx, center.x - labelWidth / 2 - 4, labelY - 9, labelWidth + 8, 13, 3);
		ctx.fill();
		ctx.fillStyle = COLORS.valid;
		ctx.fillText(label, center.x, labelY);
		ctx.restore();
	}

	private drawHandle(
		ctx: CanvasRenderingContext2D,
		cell: Cell,
		camera: Camera,
		color: string,
		endpoint: boolean,
	): void {
		const center = this.tileCenterAtScreen(cell, camera);
		ctx.fillStyle = COLORS.background;
		ctx.strokeStyle = color;
		ctx.lineWidth = endpoint ? 2.5 : 1.5;
		ctx.beginPath();
		ctx.arc(center.x, center.y, endpoint ? 6 : 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}

	private drawWorldHandle(
		ctx: CanvasRenderingContext2D,
		world: ScreenPoint,
		camera: Camera,
		color: string,
		primary: boolean,
	): void {
		const center = this.worldToScreen(world, camera);
		ctx.fillStyle = COLORS.background;
		ctx.strokeStyle = color;
		ctx.lineWidth = primary ? 2.5 : 1.5;
		ctx.beginPath();
		ctx.arc(center.x, center.y, primary ? 6 : 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}

	private tileOrigin(cell: Cell, camera: Camera): ScreenPoint {
		const center = this.tileCenterAtScreen(cell, camera);
		return { x: center.x - camera.zoom / 2, y: center.y - camera.zoom / 2 };
	}
}

function offsetPhysicalSample(
	sample: { x: number; y: number; tangentX: number; tangentY: number },
	lateralOffsetMeters: number,
): ScreenPoint {
	return offsetPhysicalPoint(
		sample.x,
		sample.y,
		sample.tangentX,
		sample.tangentY,
		lateralOffsetMeters,
	);
}

function offsetPhysicalPoint(
	x: number,
	y: number,
	tangentX: number,
	tangentY: number,
	lateralOffsetMeters: number,
): ScreenPoint {
	const magnitude = Math.hypot(tangentX, tangentY) || 1;
	return {
		x: x - (tangentY / magnitude) * lateralOffsetMeters,
		y: y + (tangentX / magnitude) * lateralOffsetMeters,
	};
}

function isAdvancedSwitchVisualPlan(
	plan:
		| RailConstructionPlan
		| RailReplacementPlan
		| AdvancedSwitchPlan
		| AdvancedSwitchReplacementPlan,
): plan is AdvancedSwitchVisualPlan {
	return "moduleKind" in plan && plan.moduleKind === "advanced-switch";
}

function isAdvancedSwitchReplacementVisualPlan(
	plan: AdvancedSwitchVisualPlan,
): plan is AdvancedSwitchReplacementPlan {
	return plan.kind === "edit" && "previousSwitchRecord" in plan;
}

function cellBounds(cells: readonly Cell[]): {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
} {
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const cell of cells) {
		minX = Math.min(minX, cell.x);
		maxX = Math.max(maxX, cell.x + 1);
		minY = Math.min(minY, cell.y);
		maxY = Math.max(maxY, cell.y + 1);
	}
	return { minX, maxX, minY, maxY };
}

function boundsOverlap(
	left: { minX: number; maxX: number; minY: number; maxY: number },
	right: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
	return !(
		left.maxX < right.minX ||
		left.minX > right.maxX ||
		left.maxY < right.minY ||
		left.minY > right.maxY
	);
}

function directionVector(direction: Direction): ScreenPoint {
	if (direction === DIR_N) return { x: 0, y: -1 };
	if (direction === DIR_E) return { x: 1, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function directionLabel(direction: Direction): "N" | "E" | "S" | "W" {
	if (direction === DIR_N) return "N";
	if (direction === DIR_E) return "E";
	if (direction === DIR_S) return "S";
	return "W";
}

function staticFabAssemblyGatewayWorldInterval(
	gateway: StaticFabAssemblyGatewayCandidate,
): Readonly<{ start: ScreenPoint; end: ScreenPoint }> {
	const offsetX = gateway.axis === "x" ? 0 : 0.5;
	const offsetY = gateway.axis === "y" ? 0 : 0.5;
	return {
		start: { x: gateway.start.x + offsetX, y: gateway.start.y + offsetY },
		end: { x: gateway.end.x + offsetX, y: gateway.end.y + offsetY },
	};
}

function staticFabAssemblyConnectorGatewayBoundsIntersect(
	bounds: Float64Array,
	index: number,
	visible: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
	const offset = index * 4;
	return !(
		(bounds[offset + 2] as number) < visible.minX ||
		(bounds[offset] as number) > visible.maxX ||
		(bounds[offset + 3] as number) < visible.minY ||
		(bounds[offset + 1] as number) > visible.maxY
	);
}

function cellIntersectsVisibleBounds(
	cell: Cell,
	visible: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
	return (
		cell.x + 1 >= visible.minX &&
		cell.x <= visible.maxX &&
		cell.y + 1 >= visible.minY &&
		cell.y <= visible.maxY
	);
}

function routeDirection(cells: readonly Cell[], arrival: boolean): Direction | null {
	if (cells.length < 2) return null;
	return arrival
		? directionBetween(cells[cells.length - 2] as Cell, cells[cells.length - 1] as Cell)
		: directionBetween(cells[0] as Cell, cells[1] as Cell);
}

function routesForRail(rail: RailCell): LocalRoute[] {
	const incoming = ALL_DIRECTIONS.filter((direction) => (rail.incoming & direction) !== 0);
	const outgoing = ALL_DIRECTIONS.filter((direction) => (rail.outgoing & direction) !== 0);
	if (incoming.length === 0) return outgoing.map((to) => ({ from: null, to }));
	if (outgoing.length === 0) return incoming.map((from) => ({ from, to: null }));
	const routes: LocalRoute[] = [];
	for (const from of incoming) {
		for (const to of outgoing) {
			if (from !== to) routes.push({ from, to });
		}
	}
	return routes;
}

function sidePoint(origin: ScreenPoint, size: number, direction: Direction): ScreenPoint {
	if (direction === DIR_N) return { x: origin.x + size / 2, y: origin.y };
	if (direction === DIR_E) return { x: origin.x + size, y: origin.y + size / 2 };
	if (direction === DIR_S) return { x: origin.x + size / 2, y: origin.y + size };
	return { x: origin.x, y: origin.y + size / 2 };
}

function cornerArc(
	origin: ScreenPoint,
	size: number,
	mask: number,
): { x: number; y: number; start: number; end: number } {
	if (mask === (DIR_N | DIR_E)) {
		return {
			x: origin.x + size,
			y: origin.y,
			start: Math.PI / 2,
			end: Math.PI,
		};
	}
	if (mask === (DIR_E | DIR_S)) {
		return {
			x: origin.x + size,
			y: origin.y + size,
			start: Math.PI,
			end: Math.PI * 1.5,
		};
	}
	if (mask === (DIR_S | DIR_W)) {
		return {
			x: origin.x,
			y: origin.y + size,
			start: Math.PI * 1.5,
			end: Math.PI * 2,
		};
	}
	return { x: origin.x, y: origin.y, start: 0, end: Math.PI / 2 };
}

function areOpposite(left: Direction, right: Direction): boolean {
	return (
		(left === DIR_N && right === DIR_S) ||
		(left === DIR_S && right === DIR_N) ||
		(left === DIR_E && right === DIR_W) ||
		(left === DIR_W && right === DIR_E)
	);
}

function directionFromNeighbor(current: Cell, neighbor: Cell): Direction {
	if (neighbor.y < current.y) return DIR_N;
	if (neighbor.x > current.x) return DIR_E;
	if (neighbor.y > current.y) return DIR_S;
	return DIR_W;
}

function mutationLookup(mutations: readonly RailMutation[]): Map<string, number> {
	const values = new Map<string, number>();
	for (const mutation of mutations) values.set(cellKey(mutation.x, mutation.y), mutation.after);
	return values;
}

type BuildGhostPlan = Extract<GhostState, { mode: "build" }>["plan"];

function isStaticFabOrganizationBundleGhostPlan(
	plan: BuildGhostPlan,
): plan is StaticFabOrganizationBundlePlacementPlan {
	return "organizationBundle" in plan && isIssuedStaticFabOrganizationBundlePlacementPlan(plan);
}

function compileStaticFabOrganizationGhostPresentation(
	plan: StaticFabOrganizationBundlePlacementPlan,
): StaticFabOrganizationGhostPresentation {
	const groupMutations = new Map(
		plan.equipmentGroupMutations.flatMap((mutation) =>
			mutation.after ? [[mutation.after.id, mutation.after] as const] : [],
		),
	);
	const markers = plan.portMutations.flatMap((mutation) => {
		const port = mutation.after;
		if (!port || !groupMutations.has(port.equipmentGroupId)) return [];
		const position = staticFabOrganizationGhostPortPosition(port);
		return position
			? [
					Object.freeze({
						portId: port.id,
						equipmentGroupId: port.equipmentGroupId,
						portType: port.portType,
						...position,
					}),
				]
			: [];
	});
	const markerIndexByPortId = new Map(
		markers.map((marker, index) => [marker.portId, index] as const),
	);
	const groupExtents = [...groupMutations.values()].flatMap((group) => {
		const markerIndices = group.portIds.flatMap((portId) => {
			const markerIndex = markerIndexByPortId.get(portId);
			return markerIndex === undefined ? [] : [markerIndex];
		});
		if (markerIndices.length === 0) return [];
		const groupMarkers = markerIndices.map(
			(index) => markers[index] as StaticFabOrganizationGhostPortMarker,
		);
		return [
			Object.freeze({
				equipmentGroupId: group.id,
				kind: group.kind,
				markerIndices: Object.freeze(markerIndices),
				minX: Math.min(...groupMarkers.map((marker) => marker.worldX)),
				minZ: Math.min(...groupMarkers.map((marker) => marker.worldZ)),
				maxX: Math.max(...groupMarkers.map((marker) => marker.worldX)),
				maxZ: Math.max(...groupMarkers.map((marker) => marker.worldZ)),
			}),
		];
	});
	const mutableChunks = new Map<string, number[]>();
	for (let index = 0; index < markers.length; index++) {
		const marker = markers[index] as StaticFabOrganizationGhostPortMarker;
		const key = organizationGhostChunkKey(marker.worldX, marker.worldZ);
		const chunk = mutableChunks.get(key);
		if (chunk) chunk.push(index);
		else mutableChunks.set(key, [index]);
	}
	const markerChunks = new Map(
		[...mutableChunks].map(([key, indices]) => [key, Object.freeze(indices)] as const),
	);
	return Object.freeze({
		markers: Object.freeze(markers),
		markerChunks,
		groupExtents: Object.freeze(groupExtents),
	});
}

function staticFabOrganizationGhostPortPosition(
	port: NonNullable<StaticFabOrganizationBundlePlacementPlan["portMutations"][number]["after"]>,
): Readonly<{
	railX: number;
	railZ: number;
	worldX: number;
	worldZ: number;
}> | null {
	if (port.route.kind !== "CARDINAL_CELL") return null;
	const center = { x: port.route.x + 0.5, z: port.route.z + 0.5 };
	const from = port.route.from === 0 ? null : directionUnit(port.route.from);
	const to = port.route.to === 0 ? null : directionUnit(port.route.to);
	if (!from && !to) return null;
	const start = from ? { x: center.x + from.x * 0.5, z: center.z + from.z * 0.5 } : center;
	const end = to ? { x: center.x + to.x * 0.5, z: center.z + to.z * 0.5 } : center;
	const corner =
		from !== null &&
		to !== null &&
		port.route.to !== oppositeDirection(port.route.from as Direction);
	const pathLength = corner ? Math.PI * 0.25 : Math.hypot(end.x - start.x, end.z - start.z);
	if (pathLength <= Number.EPSILON) return null;
	const amount = clamp(port.stationMillimeters / 1_000 / pathLength, 0, 1);
	let railX: number;
	let railZ: number;
	let tangentX: number;
	let tangentZ: number;
	if (corner && from && to) {
		const control = {
			x: center.x + (from.x + to.x) * 0.5,
			z: center.z + (from.z + to.z) * 0.5,
		};
		const inverse = 1 - amount;
		railX =
			inverse * inverse * start.x + 2 * inverse * amount * control.x + amount * amount * end.x;
		railZ =
			inverse * inverse * start.z + 2 * inverse * amount * control.z + amount * amount * end.z;
		tangentX = 2 * inverse * (control.x - start.x) + 2 * amount * (end.x - control.x);
		tangentZ = 2 * inverse * (control.z - start.z) + 2 * amount * (end.z - control.z);
	} else {
		railX = start.x + (end.x - start.x) * amount;
		railZ = start.z + (end.z - start.z) * amount;
		tangentX = end.x - start.x;
		tangentZ = end.z - start.z;
	}
	const tangentLength = Math.hypot(tangentX, tangentZ);
	if (tangentLength <= Number.EPSILON) return null;
	tangentX /= tangentLength;
	tangentZ /= tangentLength;
	const offsetMeters =
		port.side === "CENTER"
			? 0
			: (port.side === "LEFT" ? 1 : -1) * (port.lateralOffsetMillimeters / 1_000);
	return Object.freeze({
		railX,
		railZ,
		worldX: railX - tangentZ * offsetMeters,
		worldZ: railZ + tangentX * offsetMeters,
	});
}

function directionUnit(direction: Direction): Readonly<{ x: number; z: number }> {
	if (direction === DIR_N) return { x: 0, z: -1 };
	if (direction === DIR_E) return { x: 1, z: 0 };
	if (direction === DIR_S) return { x: 0, z: 1 };
	return { x: -1, z: 0 };
}

function organizationGhostChunkKey(worldX: number, worldZ: number): string {
	return `${Math.floor(worldX / ORGANIZATION_BUNDLE_GHOST_CHUNK_METERS)}:${Math.floor(worldZ / ORGANIZATION_BUNDLE_GHOST_CHUNK_METERS)}`;
}

function visibleOrganizationGhostMarkerIndices(
	presentation: StaticFabOrganizationGhostPresentation,
	bounds: { minX: number; maxX: number; minY: number; maxY: number },
): readonly number[] {
	const indices: number[] = [];
	const minChunkX = Math.floor(bounds.minX / ORGANIZATION_BUNDLE_GHOST_CHUNK_METERS);
	const maxChunkX = Math.floor(bounds.maxX / ORGANIZATION_BUNDLE_GHOST_CHUNK_METERS);
	const minChunkZ = Math.floor(bounds.minY / ORGANIZATION_BUNDLE_GHOST_CHUNK_METERS);
	const maxChunkZ = Math.floor(bounds.maxY / ORGANIZATION_BUNDLE_GHOST_CHUNK_METERS);
	for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
		for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
			const chunk = presentation.markerChunks.get(`${chunkX}:${chunkZ}`);
			if (!chunk) continue;
			for (const index of chunk) {
				const marker = presentation.markers[index];
				if (
					marker &&
					marker.worldX >= bounds.minX &&
					marker.worldX <= bounds.maxX &&
					marker.worldZ >= bounds.minY &&
					marker.worldZ <= bounds.maxY
				) {
					indices.push(index);
				}
			}
		}
	}
	return indices;
}

function organizationGhostBoundsIntersect(
	group: StaticFabOrganizationGhostGroupExtent,
	bounds: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
	return !(
		group.maxX < bounds.minX ||
		group.minX > bounds.maxX ||
		group.maxZ < bounds.minY ||
		group.minZ > bounds.maxY
	);
}

function organizationGhostScreenBounds(
	group: StaticFabOrganizationGhostGroupExtent,
	camera: Camera,
): { minX: number; maxX: number; minY: number; maxY: number } {
	return worldBoundsToScreenBounds(
		{ minX: group.minX, minY: group.minZ, maxX: group.maxX, maxY: group.maxZ },
		camera,
	);
}

function writeStaticFabArrangementVisibleBounds(
	output: Float64Array,
	camera: Camera,
	width: number,
	height: number,
	padding: number,
): void {
	const rotatedMinX = -camera.offsetX / camera.zoom;
	const rotatedMaxX = (width - camera.offsetX) / camera.zoom;
	const rotatedMinZ = -camera.offsetY / camera.zoom;
	const rotatedMaxZ = (height - camera.offsetY) / camera.zoom;
	if (camera.rotation === 1) {
		output[0] = rotatedMinZ - padding;
		output[1] = rotatedMaxZ + padding;
		output[2] = -rotatedMaxX - padding;
		output[3] = -rotatedMinX + padding;
		return;
	}
	if (camera.rotation === 2) {
		output[0] = -rotatedMaxX - padding;
		output[1] = -rotatedMinX + padding;
		output[2] = -rotatedMaxZ - padding;
		output[3] = -rotatedMinZ + padding;
		return;
	}
	if (camera.rotation === 3) {
		output[0] = -rotatedMaxZ - padding;
		output[1] = -rotatedMinZ + padding;
		output[2] = rotatedMinX - padding;
		output[3] = rotatedMaxX + padding;
		return;
	}
	output[0] = rotatedMinX - padding;
	output[1] = rotatedMaxX + padding;
	output[2] = rotatedMinZ - padding;
	output[3] = rotatedMaxZ + padding;
}

function writeStaticFabOrganizationOutlineVisibleBounds(
	output: StaticFabOrganizationOutlineBounds,
	camera: Camera,
	width: number,
	height: number,
	padding: number,
): void {
	const rotatedMinX = -camera.offsetX / camera.zoom;
	const rotatedMaxX = (width - camera.offsetX) / camera.zoom;
	const rotatedMinZ = -camera.offsetY / camera.zoom;
	const rotatedMaxZ = (height - camera.offsetY) / camera.zoom;
	if (camera.rotation === 1) {
		output.minX = rotatedMinZ - padding;
		output.maxX = rotatedMaxZ + padding;
		output.minZ = -rotatedMaxX - padding;
		output.maxZ = -rotatedMinX + padding;
		return;
	}
	if (camera.rotation === 2) {
		output.minX = -rotatedMaxX - padding;
		output.maxX = -rotatedMinX + padding;
		output.minZ = -rotatedMaxZ - padding;
		output.maxZ = -rotatedMinZ + padding;
		return;
	}
	if (camera.rotation === 3) {
		output.minX = -rotatedMaxZ - padding;
		output.maxX = -rotatedMinZ + padding;
		output.minZ = rotatedMinX - padding;
		output.maxZ = rotatedMaxX + padding;
		return;
	}
	output.minX = rotatedMinX - padding;
	output.maxX = rotatedMaxX + padding;
	output.minZ = rotatedMinZ - padding;
	output.maxZ = rotatedMaxZ + padding;
}

function staticFabOrganizationOutlineRoleVisible(
	role: StaticFabOrganizationOutlineRole,
	zoom: number,
): boolean {
	if (role === "FAB") return true;
	if (role === "BAY_BANK") return zoom >= 0.55;
	return zoom >= 1.1;
}

function staticFabOrganizationOutlineStrokeStyle(
	role: StaticFabOrganizationOutlineRole,
	state: "hovered" | "passive" | "selected",
): string {
	if (state === "hovered") return COLORS.organizationOutlineHover;
	if (state === "selected") return COLORS.organizationOutlineSelected;
	if (role === "FAB") return COLORS.organizationFabOutline;
	if (role === "BAY_BANK") return COLORS.organizationBankOutline;
	return COLORS.organizationBayOutline;
}

function staticFabOrganizationOutlinePassiveDash(role: StaticFabOrganizationOutlineRole): number[] {
	if (role === "FAB") return STATIC_FAB_ORGANIZATION_FAB_DASH;
	if (role === "BAY_BANK") return STATIC_FAB_ORGANIZATION_BANK_DASH;
	return STATIC_FAB_ORGANIZATION_BAY_DASH;
}

const STATIC_FAB_ORGANIZATION_FAB_DASH = [12, 6];
const STATIC_FAB_ORGANIZATION_BANK_DASH = [8, 5];
const STATIC_FAB_ORGANIZATION_BAY_DASH = [4, 4];
Object.freeze(STATIC_FAB_ORGANIZATION_FAB_DASH);
Object.freeze(STATIC_FAB_ORGANIZATION_BANK_DASH);
Object.freeze(STATIC_FAB_ORGANIZATION_BAY_DASH);

function staticFabArrangementBoundsIntersectVisible(
	bounds: StaticFabArrangementPreviewRoot["sourceBounds"],
	visibleBounds: Float64Array,
): boolean {
	return !(
		bounds.maxXExclusive < (visibleBounds[0] as number) ||
		bounds.minX > (visibleBounds[1] as number) ||
		bounds.maxZExclusive < (visibleBounds[2] as number) ||
		bounds.minZ > (visibleBounds[3] as number)
	);
}

function staticFabArrangementCellIntersectsVisible(
	x: number,
	z: number,
	visibleBounds: Float64Array,
): boolean {
	return !(
		x + 1 < (visibleBounds[0] as number) ||
		x > (visibleBounds[1] as number) ||
		z + 1 < (visibleBounds[2] as number) ||
		z > (visibleBounds[3] as number)
	);
}

function staticFabArrangementContinuousBoundsIntersectVisible(
	minX: number,
	minZ: number,
	maxX: number,
	maxZ: number,
	visibleBounds: Float64Array,
): boolean {
	return !(
		maxX < (visibleBounds[0] as number) ||
		minX > (visibleBounds[1] as number) ||
		maxZ < (visibleBounds[2] as number) ||
		minZ > (visibleBounds[3] as number)
	);
}

function staticFabArrangementPointIntersectsVisible(
	x: number,
	z: number,
	visibleBounds: Float64Array,
	padding: number,
): boolean {
	return staticFabArrangementContinuousBoundsIntersectVisible(
		x - padding,
		z - padding,
		x + padding,
		z + padding,
		visibleBounds,
	);
}

function staticFabArrangementCellScreenLeft(x: number, z: number, camera: Camera): number {
	return staticFabArrangementScreenX(x + 0.5, z + 0.5, camera) - camera.zoom * 0.5;
}

function staticFabArrangementCellScreenTop(x: number, z: number, camera: Camera): number {
	return staticFabArrangementScreenY(x + 0.5, z + 0.5, camera) - camera.zoom * 0.5;
}

function staticFabArrangementScreenX(x: number, z: number, camera: Camera): number {
	const rotatedX =
		camera.rotation === 1 ? -z : camera.rotation === 2 ? -x : camera.rotation === 3 ? z : x;
	return rotatedX * camera.zoom + camera.offsetX;
}

function staticFabArrangementScreenY(x: number, z: number, camera: Camera): number {
	const rotatedZ =
		camera.rotation === 1 ? x : camera.rotation === 2 ? -z : camera.rotation === 3 ? -x : z;
	return rotatedZ * camera.zoom + camera.offsetY;
}

function worldBoundsToScreenBounds(
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	camera: Camera,
): { minX: number; maxX: number; minY: number; maxY: number } {
	const points = [
		{ x: bounds.minX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.minY },
		{ x: bounds.minX, y: bounds.maxY },
		{ x: bounds.maxX, y: bounds.maxY },
	].map((world) => {
		const rotated = rotatePoint(world, camera.rotation);
		return {
			x: rotated.x * camera.zoom + camera.offsetX,
			y: rotated.y * camera.zoom + camera.offsetY,
		};
	});
	return {
		minX: Math.min(...points.map((point) => point.x)),
		maxX: Math.max(...points.map((point) => point.x)),
		minY: Math.min(...points.map((point) => point.y)),
		maxY: Math.max(...points.map((point) => point.y)),
	};
}

function visibleBounds(
	camera: Camera,
	width: number,
	height: number,
	padding: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
	const corners = [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: 0, y: height },
		{ x: width, y: height },
	].map((screen) =>
		inverseRotatePoint(
			{
				x: (screen.x - camera.offsetX) / camera.zoom,
				y: (screen.y - camera.offsetY) / camera.zoom,
			},
			camera.rotation,
		),
	);
	return {
		minX: Math.floor(Math.min(...corners.map((point) => point.x))) - padding,
		maxX: Math.ceil(Math.max(...corners.map((point) => point.x))) + padding,
		minY: Math.floor(Math.min(...corners.map((point) => point.y))) - padding,
		maxY: Math.ceil(Math.max(...corners.map((point) => point.y))) + padding,
	};
}

function rotatePoint(point: ScreenPoint, rotation: Camera["rotation"]): ScreenPoint {
	if (rotation === 1) return { x: -point.y, y: point.x };
	if (rotation === 2) return { x: -point.x, y: -point.y };
	if (rotation === 3) return { x: point.y, y: -point.x };
	return point;
}

function applyCameraWorldTransform(ctx: CanvasRenderingContext2D, camera: Camera): void {
	if (camera.rotation === 1) {
		ctx.transform(0, camera.zoom, -camera.zoom, 0, camera.offsetX, camera.offsetY);
		return;
	}
	if (camera.rotation === 2) {
		ctx.transform(-camera.zoom, 0, 0, -camera.zoom, camera.offsetX, camera.offsetY);
		return;
	}
	if (camera.rotation === 3) {
		ctx.transform(0, -camera.zoom, camera.zoom, 0, camera.offsetX, camera.offsetY);
		return;
	}
	ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY);
}

function inverseRotatePoint(point: ScreenPoint, rotation: Camera["rotation"]): ScreenPoint {
	if (rotation === 1) return { x: point.y, y: -point.x };
	if (rotation === 2) return { x: -point.x, y: -point.y };
	if (rotation === 3) return { x: -point.y, y: point.x };
	return point;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function isDynamicPortSlotConflict(status: number): boolean {
	return (
		status === PORT_SLOT_STATUS.PORT_OCCUPIED ||
		status === PORT_SLOT_STATUS.PORT_CLEARANCE_CONFLICT ||
		status === PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT
	);
}

function screenPathCameraKey(camera: Camera, mode: RailPresentationMode): string {
	return [
		camera.offsetX.toFixed(2),
		camera.offsetY.toFixed(2),
		camera.zoom.toFixed(3),
		camera.rotation,
		mode,
	].join(":");
}

function rotateDirection(direction: Direction, rotation: Camera["rotation"]): Direction {
	const directions = [DIR_N, DIR_E, DIR_S, DIR_W] as const;
	const index = directions.indexOf(direction);
	return directions[(index + rotation) % directions.length] as Direction;
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	ctx.beginPath();
	ctx.roundRect(x, y, width, height, radius);
}

function isPortSlotRow(slots: CompiledPortSlots, row: number): boolean {
	return Number.isInteger(row) && row >= 0 && row < slots.count;
}
