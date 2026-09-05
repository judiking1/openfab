import { afterEach, describe, expect, it, vi } from "vitest";
import { selectEqRowDraft } from "../compile/EqRowDraftSelector";
import { ohbRowDragBounds, selectOhbRowDrag } from "../compile/OhbRowDragSelector";
import { PATH_KIND, samplePhysicalPath } from "../compile/PhysicalPathCompiler";
import { physicalPathIdentity } from "../compile/PhysicalPathIdentity";
import { PhysicalPathIdentityIndex } from "../compile/PhysicalPathLookup";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { compilePortEquipmentPresentation } from "../compile/PortEquipmentPresentation";
import { PORT_SLOT_STATUS, portSlotRecord } from "../compile/PortSlotCompiler";
import {
	compilePortSlotPreparedArtifacts,
	createPreparedPortSlotAvailabilityIndex,
} from "../compile/PortSlotPreparedArtifacts";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import {
	STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES,
	type StaticFabOrganizationOutlineBounds,
	type StaticFabOrganizationOutlineIndex,
	type StaticFabOrganizationOutlineRole,
} from "../compile/StaticFabOrganizationOutlineIndex";
import { evaluateStkDraftSelection } from "../compile/StkDraftSelector";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import {
	type AdvancedSwitchPlan,
	planAdvancedSwitch,
	planAdvancedSwitchReshape,
} from "../core/AdvancedSwitchPlanner";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import type { CardinalPortRoute, PortRecord } from "../core/PortRecord";
import { planRailConstruction, planRailPath, type RailConstructionPlan } from "../core/paint";
import { createRailAreaSelection } from "../core/RailAreaSelection";
import {
	initialRailAreaStampPose,
	planRailAreaStamp,
	type RailAreaStampEdge,
	type RailAreaStampTemplate,
} from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { planRailModule } from "../core/RailModulePlanner";
import {
	createRailNetworkLinkAnchorContext,
	planRailNetworkLink,
} from "../core/RailNetworkLinkPlanner";
import { deriveRailTemplateAttachmentGuide } from "../core/RailTemplateAttachmentGuide";
import {
	type BranchBypassTemplateParameters,
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "../core/RailTemplateCatalog";
import {
	deriveRailTemplateCompositionGuide,
	resolveRailTemplateCompositionSnap,
} from "../core/RailTemplateCompositionGuide";
import { DIR_E, DIR_S, type Direction, oppositeDirection } from "../core/railShape";
import {
	compareDirectedRailEdges,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import {
	planStaticFabOrganizationBundlePlacement,
	type StaticFabOrganizationBundlePlacementPlan,
} from "../core/StaticFabOrganizationBundlePlacement";
import {
	planStaticFabOrganizationBundlePlacementPreview,
	prepareStaticFabOrganizationBundlePlacementPreviewArtifact,
} from "../core/StaticFabOrganizationBundlePlacementPreview";
import { type Cell, encodeRailCell, TileMap } from "../core/TileMap";
import {
	OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE,
	RAIL_DECORATION_KIND,
	RAIL_DECORATION_PRIORITY,
} from "./PhysicalRailPresentation";
import { compilePhysicalRailRenderArtifacts } from "./PhysicalRailRenderArtifacts";
import {
	advancedSwitchHighlightCells,
	type Camera,
	closureSnapRadiusMetersForZoom,
	compileAdvancedSwitchPreviewLayout,
	EQ_PASSIVE_SLOT_VISUAL_MIN_ZOOM,
	gridMajorStepForZoom,
	OHB_PASSIVE_SLOT_VISUAL_MIN_ZOOM,
	overviewFlowMarkerBucket,
	overviewFlowMarkerCellPixels,
	overviewFlowMinimumRunMeters,
	overviewPhysicalDecorationVisible,
	overviewRailPixelWidths,
	passivePortSlotVisualsVisible,
	physicalFlowMarkerStride,
	portSlotPickRadiusMeters,
	STK_PASSIVE_SLOT_VISUAL_MIN_ZOOM,
	TileRenderer,
	touchPortSlotPickRadiusMeters,
} from "./TileRenderer";

afterEach(() => vi.unstubAllGlobals());

describe("TileRenderer camera transforms", () => {
	it("uses larger nearest-station pick targets for EQ and STK authoring", () => {
		expect(portSlotPickRadiusMeters("OHB", 40)).toBeCloseTo(0.35);
		expect(portSlotPickRadiusMeters("EQ", 40)).toBeCloseTo(0.5);
		expect(portSlotPickRadiusMeters("STK", 40)).toBeCloseTo(0.65);
		expect(portSlotPickRadiusMeters("STK", 8)).toBe(0.8);
		expect(portSlotPickRadiusMeters("EQ", 8)).toBe(0.7);
		expect(portSlotPickRadiusMeters("EQ", 100)).toBe(0.2);
	});

	it("expands compact touch slot targets without changing the bounded pointer radius", () => {
		expect(touchPortSlotPickRadiusMeters("OHB", 40)).toBeCloseTo(0.55);
		expect(touchPortSlotPickRadiusMeters("EQ", 40)).toBeCloseTo(0.55);
		expect(touchPortSlotPickRadiusMeters("STK", 40)).toBeCloseTo(0.65);
		expect(touchPortSlotPickRadiusMeters("OHB", 8)).toBe(0.75);
		expect(touchPortSlotPickRadiusMeters("OHB", 100)).toBeCloseTo(0.22);
		expect(touchPortSlotPickRadiusMeters("OHB", Number.NaN)).toBe(0.48);
	});

	it("hides passive ordinary Port visuals before overview markers merge", () => {
		expect(passivePortSlotVisualsVisible("STK", STK_PASSIVE_SLOT_VISUAL_MIN_ZOOM - 0.001)).toBe(
			false,
		);
		expect(passivePortSlotVisualsVisible("STK", STK_PASSIVE_SLOT_VISUAL_MIN_ZOOM)).toBe(true);
		expect(passivePortSlotVisualsVisible("EQ", EQ_PASSIVE_SLOT_VISUAL_MIN_ZOOM - 0.001)).toBe(
			false,
		);
		expect(passivePortSlotVisualsVisible("EQ", EQ_PASSIVE_SLOT_VISUAL_MIN_ZOOM)).toBe(true);
		expect(passivePortSlotVisualsVisible("OHB", OHB_PASSIVE_SLOT_VISUAL_MIN_ZOOM - 0.001)).toBe(
			false,
		);
		expect(passivePortSlotVisualsVisible("OHB", OHB_PASSIVE_SLOT_VISUAL_MIN_ZOOM)).toBe(true);
		expect(passivePortSlotVisualsVisible("STK", Number.NaN)).toBe(true);
		expect(passivePortSlotVisualsVisible("EQ", Number.NaN)).toBe(true);
		expect(passivePortSlotVisualsVisible("OHB", Number.NaN)).toBe(true);
	});

	it("decimates flow markers by screen spacing in whole-map overviews", () => {
		expect(physicalFlowMarkerStride(4)).toBe(4);
		expect(physicalFlowMarkerStride(8)).toBe(2);
		expect(physicalFlowMarkerStride(14)).toBe(1);
		expect(physicalFlowMarkerStride(Number.NaN)).toBe(1);
		expect(overviewFlowMinimumRunMeters(1.5)).toBe(24);
		expect(overviewFlowMinimumRunMeters(4)).toBe(12);
		expect(overviewFlowMinimumRunMeters(8)).toBe(0);
		expect(overviewFlowMarkerCellPixels(1.5)).toBe(48);
		expect(overviewFlowMarkerCellPixels(4)).toBe(40);
		expect(overviewFlowMarkerCellPixels(8)).toBe(32);
		expect(overviewFlowMarkerCellPixels(10)).toBeNull();
	});

	it("keeps overview switches while suppressing repetitive construction marks", () => {
		expect(
			overviewPhysicalDecorationVisible(
				RAIL_DECORATION_KIND.SWITCH_JOINT,
				RAIL_DECORATION_PRIORITY.DETAIL,
				2,
			),
		).toBe(true);
		expect(
			overviewPhysicalDecorationVisible(
				RAIL_DECORATION_KIND.SUPPORT,
				RAIL_DECORATION_PRIORITY.OVERVIEW,
				2,
			),
		).toBe(false);
		expect(
			overviewPhysicalDecorationVisible(
				RAIL_DECORATION_KIND.PROFILE_JOINT,
				RAIL_DECORATION_PRIORITY.OVERVIEW,
				6,
			),
		).toBe(true);
	});

	it("deduplicates overview flow in world-space buckets independent of camera pan", () => {
		expect(overviewFlowMarkerBucket(24, 12, "E", 4, 40)).toBe("2:1:E");
		expect(overviewFlowMarkerBucket(24, 12, "W", 4, 40)).toBe("2:1:W");
		expect(overviewFlowMarkerBucket(-1, -1, "N", 4, 40)).toBe("-1:-1:N");
	});

	it("uses overview LOD for factory-scale rail and grid rendering", () => {
		expect(gridMajorStepForZoom(1.5)).toBe(20);
		expect(gridMajorStepForZoom(4)).toBe(10);
		expect(gridMajorStepForZoom(8)).toBe(5);
		expect(overviewRailPixelWidths(1.5)).toEqual({ shadow: 4, bed: 2.5, face: 1.5 });
		expect(overviewRailPixelWidths(10)).toBeNull();
	});

	it("keeps a stable screen margin beyond the closure target cell", () => {
		expect(closureSnapRadiusMetersForZoom(8)).toBe(0.82);
		expect(closureSnapRadiusMetersForZoom(38) * 38 - 19).toBeCloseTo(8);
		expect(closureSnapRadiusMetersForZoom(96) * 96 - 48).toBeCloseTo(8);
	});

	it("round-trips tile centers for all quarter-turn views", () => {
		const renderer = new TileRenderer();
		for (const rotation of [0, 1, 2, 3] as const) {
			const camera: Camera = { offsetX: 530, offsetY: 310, zoom: 32, rotation };
			for (const cell of [
				{ x: 0, y: 0 },
				{ x: -12, y: 7 },
				{ x: 19, y: -23 },
			]) {
				const screen = renderer.tileCenterAtScreen(cell, camera);
				expect(renderer.tileAtScreen(screen.x, screen.y, camera)).toEqual(cell);
			}
		}
	});

	it("preserves arbitrary world points through screen conversion", () => {
		const renderer = new TileRenderer();
		for (const rotation of [0, 1, 2, 3] as const) {
			const camera: Camera = { offsetX: 400, offsetY: 280, zoom: 17, rotation };
			const world = { x: -4.25, y: 13.75 };
			const screen = renderer.worldToScreen(world, camera);
			const roundTrip = renderer.worldAtScreen(screen.x, screen.y, camera);
			expect(roundTrip.x).toBeCloseTo(world.x);
			expect(roundTrip.y).toBeCloseTo(world.y);
		}
	});

	it("renders focused readiness cells only on the overlay and culls off-screen cells", () => {
		const renderer = new TileRenderer();
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();

		renderer.render(staticContext.context, overlayContext.context, {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 160, zoom: 40, rotation: 0 as const },
			width: 400,
			height: 320,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			issueTiles: [
				{ x: 0, y: 0 },
				{ x: 10_000, y: 10_000 },
			],
		});

		expect(overlayContext.strokeRectCalls).toBe(1);
		expect(overlayContext.strokeRectStyles).toEqual(["#ff8b93"]);
		expect(overlayContext.fillRectStyles).toContain("rgba(240, 107, 114, 0.12)");
	});

	it("temporarily suppresses readiness overlays while ports are the interaction focus", () => {
		const renderer = new TileRenderer();
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const overlay = createRecordingContext();

		const input = {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 160, zoom: 40, rotation: 0 as const },
			width: 400,
			height: 320,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			interactionFocus: "ports" as const,
			issueTiles: [{ x: 0, y: 0 }],
			issueFocusTile: { x: 0, y: 0 },
		};
		renderer.render(createRecordingContext().context, overlay.context, input);

		expect(overlay.strokeRectCalls).toBe(0);
		expect(overlay.arcCalls).toBe(0);

		const railOverlay = createRecordingContext();
		renderer.render(createRecordingContext().context, railOverlay.context, {
			...input,
			interactionFocus: "rail",
		});
		expect(railOverlay.strokeRectCalls).toBe(1);
		expect(railOverlay.arcCalls).toBe(1);
	});

	it("renders SCC representatives as numbered flow-region pins instead of fault cells", () => {
		const renderer = new TileRenderer();
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const overlayContext = createRecordingContext();

		renderer.render(createRecordingContext().context, overlayContext.context, {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 160, zoom: 40, rotation: 0 },
			width: 400,
			height: 320,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			issueTiles: [
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
			],
			issueFocusTile: { x: 1, y: 0 },
			issueHighlightKind: "region",
		});

		expect(overlayContext.strokeRectCalls).toBe(0);
		expect(overlayContext.labels).toEqual(["1", "2"]);
		expect(overlayContext.arcCalls).toBe(3);
		expect(overlayContext.strokes.some((stroke) => stroke.style === "#e3bd58")).toBe(true);
		expect(overlayContext.strokes.some((stroke) => stroke.style === "#ffe59a")).toBe(true);
		expect(overlayContext.fillRectStyles).not.toContain("rgba(240, 107, 114, 0.12)");
	});

	it("traces the exact compiled path behind a path readiness diagnostic", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const pathIndex = [...physical.paths.kinds].indexOf(PATH_KIND.LINEAR);
		expect(pathIndex).toBeGreaterThanOrEqual(0);
		const overlayContext = createRecordingContext();

		new TileRenderer().render(createRecordingContext().context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 160, zoom: 40, rotation: 0 },
			width: 400,
			height: 320,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			issueTiles: [{ x: physical.paths.cells[pathIndex * 2] as number, y: 0 }],
			issueFocusTile: { x: physical.paths.cells[pathIndex * 2] as number, y: 0 },
			issueHighlightKind: "path",
			issuePathIdentity: physicalPathIdentity(physical.paths, pathIndex),
			issuePathIdentityIndex: PhysicalPathIdentityIndex.compile(physical.paths).snapshot,
		});

		expect(
			overlayContext.strokes.filter((stroke) => stroke.style === "#69d4dc").length,
		).toBeGreaterThanOrEqual(2);
	});

	it("caches and viewport-culls long one-way corridor overlays", () => {
		installRecordingPath2D();
		const renderer = new TileRenderer();
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const cells = Array.from({ length: 2_001 }, (_, index) => ({ x: index - 1_000, y: 0 }));
		const issueCorridor = {
			cells,
			departure: { from: cells[0] as Cell, to: cells[1] as Cell },
			arrival: { from: cells.at(-2) as Cell, to: cells.at(-1) as Cell },
		};
		const input = {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 160, zoom: 40, rotation: 0 as const },
			width: 400,
			height: 320,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			issueHighlightKind: "corridor" as const,
			issueCorridor,
		};

		renderer.render(createRecordingContext().context, createRecordingContext().context, input);
		expect(renderer.getStats()).toMatchObject({
			issueCorridorScreenPathBuilds: 1,
			issueCorridorVisibleSegments: 15,
			issueCorridorSegmentIndexBuilds: 1,
		});
		expect(renderer.getStats().issueCorridorCandidateSegments).toBeLessThan(100);

		renderer.render(createRecordingContext().context, createRecordingContext().context, input);
		expect(renderer.getStats().issueCorridorScreenPathBuilds).toBe(1);

		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			...input,
			camera: { ...input.camera, offsetX: 240 },
		});
		expect(renderer.getStats()).toMatchObject({
			issueCorridorScreenPathBuilds: 2,
			issueCorridorVisibleSegments: 15,
			issueCorridorSegmentIndexBuilds: 1,
		});
		expect(renderer.getStats().issueCorridorCandidateSegments).toBeLessThan(100);

		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			...input,
			camera: { ...input.camera, rotation: 1 },
		});
		expect(renderer.getStats()).toMatchObject({
			issueCorridorScreenPathBuilds: 3,
			issueCorridorSegmentIndexBuilds: 1,
		});
		expect(renderer.getStats().issueCorridorCandidateSegments).toBeLessThan(100);
	});

	it("uses the chunked corridor query in environments without Path2D", () => {
		vi.stubGlobal("Path2D", undefined);
		const renderer = new TileRenderer();
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const cells = Array.from({ length: 2_001 }, (_, index) => ({ x: index - 1_000, y: 0 }));
		const overlay = createRecordingContext();

		renderer.render(createRecordingContext().context, overlay.context, {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 160, zoom: 40, rotation: 0 },
			width: 400,
			height: 320,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			issueHighlightKind: "corridor",
			issueCorridor: {
				cells,
				departure: { from: cells[0] as Cell, to: cells[1] as Cell },
				arrival: { from: cells.at(-2) as Cell, to: cells.at(-1) as Cell },
			},
		});

		expect(renderer.getStats()).toMatchObject({
			issueCorridorScreenPathBuilds: 0,
			issueCorridorVisibleSegments: 0,
			issueCorridorSegmentIndexBuilds: 1,
		});
		expect(renderer.getStats().issueCorridorCandidateSegments).toBeLessThan(100);
		expect(overlay.strokes.some((stroke) => stroke.style === "#ffd369")).toBe(true);
	});

	it("draws a closure magnet only on the interaction overlay", () => {
		const renderer = new TileRenderer();
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();

		renderer.render(staticContext.context, overlayContext.context, {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 160, zoom: 40, rotation: 0 },
			width: 400,
			height: 320,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			snapTargetTile: { x: 0, y: 0 },
			selectedTile: null,
		});

		expect(staticContext.arcCalls).toBe(0);
		expect(overlayContext.arcCalls).toBe(3);
		expect(overlayContext.strokes.map((stroke) => stroke.style)).toEqual([
			"#50d58a",
			"rgba(202, 255, 224, 0.86)",
			"#50d58a",
		]);
		expect(overlayContext.labels).toContain("SNAP");
	});

	it("draws revision-bound template attachment zones only on the interaction overlay", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 30, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const guide = deriveRailTemplateAttachmentGuide(
			document.map,
			"branch-bypass",
			initialRailTemplatePose(),
			defaultRailTemplateParameters("branch-bypass") as BranchBypassTemplateParameters,
		);
		expect(guide.compatibleAnchorCount).toBeGreaterThan(0);
		expect(guide.blockedAnchorCount).toBeGreaterThan(0);
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();

		new TileRenderer().render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 160, zoom: 20, rotation: 0 },
			width: 900,
			height: 320,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			templateAttachmentGuide: guide,
		});

		expect(staticContext.strokes.map((stroke) => stroke.style)).not.toContain(
			"rgba(76, 224, 210, 0.92)",
		);
		expect(overlayContext.strokes.map((stroke) => stroke.style)).toContain(
			"rgba(76, 224, 210, 0.92)",
		);
		expect(overlayContext.strokes.map((stroke) => stroke.style)).toContain(
			"rgba(239, 100, 107, 0.82)",
		);
	});

	it("draws closed-pattern composition intervals and the resolved shared span on the overlay", () => {
		const document = new RailDocument();
		const pose = initialRailTemplatePose();
		expect(
			document.commit(
				planRailTemplate(
					document.map,
					"outer-loop",
					{ x: 0, y: 0 },
					pose,
					defaultRailTemplateParameters("outer-loop"),
				),
			),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const guide = deriveRailTemplateCompositionGuide(
			document.map,
			"long-bay",
			pose,
			defaultRailTemplateParameters("long-bay"),
		);
		const interval = guide.intervals[0];
		if (!interval) throw new Error("Expected a visible composition interval.");
		const resolution = resolveRailTemplateCompositionSnap(
			guide,
			{ x: interval.firstTargetStart.x + 0.5, y: interval.firstTargetStart.y + 0.5 },
			1,
		);
		expect(resolution).not.toBeNull();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();

		new TileRenderer().render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 140, offsetY: 140, zoom: 12, rotation: 0 },
			width: 1_200,
			height: 520,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			templateCompositionGuide: guide,
			templateCompositionResolution: resolution,
		});

		expect(staticContext.strokes.map((stroke) => stroke.style)).not.toContain(
			"rgba(76, 224, 210, 0.92)",
		);
		expect(overlayContext.strokes.map((stroke) => stroke.style)).toContain(
			"rgba(76, 224, 210, 0.92)",
		);
		expect(overlayContext.strokes.map((stroke) => stroke.style)).toContain("#f0cf73");
	});

	it("draws a semantic area selection and drag marquee on the interaction overlay", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const selection = createRailAreaSelection(
			buildRailModuleOwnershipIndex(document.map),
			{ x: 0, y: -1 },
			{ x: 8, y: 1 },
			"intersect",
		);
		expect(selection.ownerships.length).toBeGreaterThan(0);
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();

		new TileRenderer().render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			railAreaSelection: selection,
			railAreaMarquee: { start: { x: 0, y: -1 }, end: { x: 8, y: 1 } },
		});

		expect(staticContext.fillRectStyles).not.toContain("rgba(79, 188, 198, 0.19)");
		expect(overlayContext.fillRectStyles).toContain("rgba(79, 188, 198, 0.19)");
		expect(overlayContext.strokeRectStyles).toContain("rgba(117, 211, 219, 0.94)");
	});

	it("draws a subtractive area marquee with fault-red feedback", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const overlayContext = createRecordingContext();

		new TileRenderer().render(createRecordingContext().context, overlayContext.context, {
			map: document.map,
			physicalPaths: compilePhysicalRail(document.map).paths,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			railAreaMarquee: {
				start: { x: 0, y: -1 },
				end: { x: 8, y: 1 },
				operation: "subtract",
			},
		});

		expect(overlayContext.strokes.map((stroke) => stroke.style)).toContain(
			"rgba(246, 112, 121, 0.96)",
		);
	});
});

describe("Static FAB organization outline rendering", () => {
	it("binds one exact artifact for effective rendering and source-bound overlap hits", () => {
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const outline = createStaticFabOrganizationOutlineFixture([
			{ id: 1, role: "FAB", bounds: { minX: 0, minZ: 0, maxX: 20, maxZ: 20 } },
			{ id: 2, role: "BAY_BANK", bounds: { minX: 1, minZ: 1, maxX: 18, maxZ: 18 } },
			{ id: 3, role: "BAY", bounds: { minX: 2, minZ: 2, maxX: 8, maxZ: 8 } },
			{ id: 4, role: "BAY", bounds: { minX: 4, minZ: 4, maxX: 10, maxZ: 10 } },
		]);
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlay = createRecordingContext();
		const input = {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 40, offsetY: 40, zoom: 10, rotation: 0 as const },
			width: 400,
			height: 300,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			staticFabOrganizationOutline: outline,
			staticFabOrganizationSelectionEnabled: true,
			selectedStaticFabOrganizationIds: [3],
			hoverStaticFabOrganizationId: 4,
		};

		expect(renderer.canQueryStaticFabOrganizationOutline(outline)).toBe(false);
		renderer.render(staticContext.context, overlay.context, input);
		expect(renderer.canQueryStaticFabOrganizationOutline(outline)).toBe(true);
		expect(renderer.getStats()).toMatchObject({
			staticFabOrganizationOutlineBindings: 1,
			staticFabOrganizationOutlineQueryCandidates: 4,
			staticFabOrganizationOutlineVisibleRows: 4,
		});
		expect(overlay.strokeRectStyles).toEqual([
			"rgba(231, 194, 99, 0.46)",
			"rgba(116, 190, 196, 0.5)",
			"#f1c66f",
			"#8de3ea",
		]);

		const hitRows = new Int32Array(outline.organizationCount);
		expect(renderer.queryStaticFabOrganizationOutlinePoint(outline, 5, 5, hitRows)).toBe(2);
		expect([...hitRows.slice(0, 2)]).toEqual([2, 3]);
		expect(renderer.hitTestStaticFabOrganizationOutline(outline, 5, 5)).toBe(2);
		expect(renderer.getStats().staticFabOrganizationOutlineHitCandidates).toBe(1);
		const foreignOutline = createStaticFabOrganizationOutlineFixture([]);
		expect(renderer.canQueryStaticFabOrganizationOutline(foreignOutline)).toBe(false);
		expect(
			renderer.queryStaticFabOrganizationOutlinePoint(foreignOutline, 5, 5, new Int32Array()),
		).toBe(0);

		const staticRedraws = renderer.getStats().staticRedraws;
		renderer.render(staticContext.context, createRecordingContext().context, {
			...input,
			selectedStaticFabOrganizationIds: [4],
			hoverStaticFabOrganizationId: 3,
		});
		expect(renderer.getStats()).toMatchObject({
			staticRedraws,
			staticFabOrganizationOutlineBindings: 1,
		});
		renderer.render(staticContext.context, createRecordingContext().context, {
			...input,
			staticFabOrganizationSelectionEnabled: false,
		});
		expect(renderer.canQueryStaticFabOrganizationOutline(outline)).toBe(false);
		expect(renderer.hitTestStaticFabOrganizationOutline(outline, 5, 5)).toBe(-1);
		expect(renderer.getStats()).toMatchObject({
			staticFabOrganizationOutlineBindings: 1,
			staticFabOrganizationOutlineQueryCandidates: 0,
			staticFabOrganizationOutlineVisibleRows: 0,
		});
	});

	it("keeps selected and hovered Bays beyond passive LOD and the passive row cap", () => {
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const records: StaticFabOrganizationOutlineFixtureRow[] = [
			{ id: 1, role: "FAB", bounds: { minX: 0, minZ: 0, maxX: 20, maxZ: 20 } },
			{ id: 2, role: "BAY_BANK", bounds: { minX: 0, minZ: 0, maxX: 20, maxZ: 20 } },
		];
		for (let index = 0; index < 2_050; index++) {
			records.push({
				id: index + 3,
				role: "BAY",
				bounds: { minX: 0, minZ: 0, maxX: 20, maxZ: 20 },
			});
		}
		const outline = createStaticFabOrganizationOutlineFixture(records);
		const renderer = new TileRenderer();
		const renderAtZoom = (zoom: number): void => {
			renderer.render(createRecordingContext().context, createRecordingContext().context, {
				map,
				physicalPaths: physical.paths,
				ghost: null,
				camera: { offsetX: 40, offsetY: 40, zoom, rotation: 0 },
				width: 400,
				height: 300,
				dpr: 1,
				hoverTile: null,
				hoverWorld: null,
				anchorTile: null,
				selectedTile: null,
				staticFabOrganizationOutline: outline,
				staticFabOrganizationSelectionEnabled: true,
				selectedStaticFabOrganizationIds: [2_051],
				hoverStaticFabOrganizationId: 2_052,
			});
		};

		renderAtZoom(0.5);
		expect(renderer.getStats()).toMatchObject({
			staticFabOrganizationOutlineQueryCandidates: 2_052,
			staticFabOrganizationOutlineVisibleRows: 3,
		});
		renderAtZoom(2);
		expect(renderer.getStats()).toMatchObject({
			staticFabOrganizationOutlineQueryCandidates: 2_052,
			staticFabOrganizationOutlineVisibleRows: 2_050,
		});
	});

	it("queries the rotated viewport before applying the passive row cap", () => {
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const records: StaticFabOrganizationOutlineFixtureRow[] = [];
		for (let index = 0; index < 2_100; index++) {
			records.push({
				id: index + 1,
				role: "BAY",
				bounds: { minX: 10_000 + index, minZ: 10_000, maxX: 10_001 + index, maxZ: 10_001 },
			});
		}
		records.push(
			{ id: 2_101, role: "FAB", bounds: { minX: -2, minZ: -2, maxX: 2, maxZ: 2 } },
			{ id: 2_102, role: "BAY", bounds: { minX: -1, minZ: -1, maxX: 1, maxZ: 1 } },
		);
		const outline = createStaticFabOrganizationOutlineFixture(records);
		const renderer = new TileRenderer();
		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 150, zoom: 10, rotation: 1 },
			width: 400,
			height: 300,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			staticFabOrganizationOutline: outline,
			staticFabOrganizationSelectionEnabled: true,
		});

		expect(renderer.getStats()).toMatchObject({
			staticFabOrganizationOutlineQueryCandidates: 2,
			staticFabOrganizationOutlineVisibleRows: 2,
		});
	});
});

describe("port slot rendering", () => {
	it("draws named Guided Port instructions and dotted legal targets outside reserved tools", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, "OHB");
		const staticContext = createRecordingContext();
		const renderer = new TileRenderer();

		renderer.render(staticContext.context, createRecordingContext().context, {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: prepared.slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: createPreparedPortSlotAvailabilityIndex(
				physical,
				prepared,
				document.portEquipment,
			),
			showPortSlots: true,
			guidedPortPlacement: {
				label: "OHB · 대표 Port 1개",
				instruction: "강조된 합법 슬롯 하나를 클릭하세요",
				reservedLeftPixels: 180,
			},
			interactionFocus: "ports",
			ghost: null,
			camera: { offsetX: 40, offsetY: 320, zoom: 18, rotation: 0 },
			width: 390,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(staticContext.labels).toContain("OHB · 대표 Port 1개");
		expect(staticContext.labels).toContain("강조된 합법 슬롯 하나를 클릭하세요");
		expect(staticContext.strokes.filter((stroke) => stroke.style === "#91f3f4")).toHaveLength(1);
		expect(renderer.getGuidedCanvasActionMarkers()).toEqual([
			expect.objectContaining({ role: "target" }),
		]);
	});

	it("projects a visible three-slot Guided EQ drag span with start and end markers", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 18, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, "EQ");
		const staticContext = createRecordingContext();
		const renderer = new TileRenderer();

		renderer.render(staticContext.context, createRecordingContext().context, {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: prepared.slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: createPreparedPortSlotAvailabilityIndex(
				physical,
				prepared,
				document.portEquipment,
			),
			showPortSlots: true,
			guidedPortPlacement: {
				label: "EQ · Port 3개를 한 번에",
				instruction: "청록색 1에서 2까지 드래그하세요",
				reservedLeftPixels: 180,
				gesture: "row",
				recommendedPortCount: 3,
			},
			interactionFocus: "ports",
			ghost: null,
			camera: { offsetX: 40, offsetY: 320, zoom: 18, rotation: 0 },
			width: 390,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(staticContext.strokes.filter((stroke) => stroke.style === "#91f3f4")).toHaveLength(3);
		expect(renderer.getGuidedCanvasActionMarkers()).toEqual([
			expect.objectContaining({ role: "start" }),
			expect.objectContaining({ role: "end" }),
		]);
	});

	it("projects a visible Guided Reuse rail selection marker", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 18, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const renderer = new TileRenderer();

		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			map: document.map,
			physicalPaths: physical.paths,
			guidedRailSelection: {
				label: "Port 포함 Loop",
				instruction: "청록색 고리의 레일을 탭하세요",
				reservedLeftPixels: 64,
				reservedTopPixels: 0,
				eligibleRailCells: new Set(Array.from({ length: 19 }, (_, x) => `${x},0`)),
			},
			ghost: null,
			camera: { offsetX: 40, offsetY: 320, zoom: 18, rotation: 0 },
			width: 390,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(renderer.getGuidedCanvasActionMarkers()).toEqual([
			expect.objectContaining({
				role: "rail",
				pathIndex: expect.any(Number),
				worldX: expect.any(Number),
				worldY: expect.any(Number),
			}),
		]);
	});

	it("does not project a Guided Reuse marker outside the eligible equipment Loop", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 18, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const renderer = new TileRenderer();

		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			map: document.map,
			physicalPaths: physical.paths,
			guidedRailSelection: {
				label: "Port 포함 Loop",
				instruction: "청록색 고리의 레일을 탭하세요",
				eligibleRailCells: new Set(["100,100"]),
			},
			ghost: null,
			camera: { offsetX: 40, offsetY: 320, zoom: 18, rotation: 0 },
			width: 390,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(renderer.getGuidedCanvasActionMarkers()).toEqual([]);
	});

	it("renders EQ anchoring, snapped endpoints, and only blocked ports as errors", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, "EQ");
		const slots = prepared.slots;
		const rowsByX = new Map<number, number>();
		for (let row = 0; row < slots.count; row++) {
			if ((slots.statuses[row] as number) === PORT_SLOT_STATUS.LEGAL) {
				rowsByX.set(slots.routeXs[row] as number, row);
			}
		}
		const anchor = rowsByX.get(2) as number;
		const occupiedRow = rowsByX.get(4) as number;
		const target = rowsByX.get(7) as number;
		const emptyAvailability = createPreparedPortSlotAvailabilityIndex(
			physical,
			prepared,
			document.portEquipment,
		);
		const renderer = new TileRenderer();
		const candidates = Array.from({ length: slots.count }, (_, row) => row);
		const anchored = selectEqRowDraft(slots, emptyAvailability, anchor, anchor, candidates, 2_000);
		expect(anchored.state).toBe("ANCHORED");

		const staticContext = createRecordingContext();
		const anchoredOverlay = createRecordingContext();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: emptyAvailability,
			showPortSlots: true,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			interactionFocus: "ports" as const,
		};
		renderer.render(staticContext.context, anchoredOverlay.context, {
			...input,
			portRowDraft: { portType: "EQ" as const, selection: anchored },
		});
		expect(renderer.getStats()).toMatchObject({ eqDraftRows: 1, eqDraftBlockedRows: 0 });
		expect(anchoredOverlay.strokes.some((stroke) => stroke.style === "#72b7e8")).toBe(true);
		expect(anchoredOverlay.strokes.some((stroke) => stroke.style === "#76e5c3")).toBe(false);
		expect(anchoredOverlay.strokes.some((stroke) => stroke.style === "#ff8089")).toBe(false);
		expect(anchoredOverlay.labels).toContain("S");

		const ready = selectEqRowDraft(slots, emptyAvailability, anchor, target, candidates, 2_000);
		expect(ready.state).toBe("READY");
		const readyOverlay = createRecordingContext();
		renderer.render(staticContext.context, readyOverlay.context, {
			...input,
			portRowDraft: { portType: "EQ" as const, selection: ready },
		});
		expect(readyOverlay.strokes.some((stroke) => stroke.style === "#76e5c3")).toBe(true);
		expect(readyOverlay.strokes.some((stroke) => stroke.style === "#72b7e8")).toBe(false);

		const occupiedPort = portSlotRecord(slots, occupiedRow, 1, 1, "EQ-1-P01");
		const occupiedState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [occupiedPort],
			equipmentGroups: [
				{ id: 1, kind: "EQ" as const, pitchMillimeters: 2_000, recipe: null, portIds: [1] },
			],
		};
		const occupiedAvailability = createPreparedPortSlotAvailabilityIndex(
			physical,
			prepared,
			occupiedState,
		);
		const blocked = selectEqRowDraft(
			slots,
			occupiedAvailability,
			anchor,
			target,
			candidates,
			2_000,
		);
		expect(blocked.state).toBe("BLOCKED");
		expect(blocked.blockedRows).toEqual([occupiedRow]);
		const blockedOverlay = createRecordingContext();
		renderer.render(staticContext.context, blockedOverlay.context, {
			...input,
			portSlotAvailability: occupiedAvailability,
			portRowDraft: { portType: "EQ" as const, selection: blocked },
		});
		expect(blockedOverlay.strokes.some((stroke) => stroke.style === "#76e5c3")).toBe(true);
		expect(blockedOverlay.strokes.some((stroke) => stroke.style === "#ff8089")).toBe(true);
		expect(
			blockedOverlay.strokes.some((stroke) => stroke.style === "rgba(231, 191, 91, 0.9)"),
		).toBe(true);
		expect(renderer.getStats().staticRedraws).toBe(2);
	});

	it("reuses Worker-prepared slot geometry while live occupancy changes", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const slots = prepared.slots;
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		expect(row).toBeGreaterThanOrEqual(0);

		const renderer = new TileRenderer();
		const initialStatic = createRecordingContext();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: createPreparedPortSlotAvailabilityIndex(
				physical,
				prepared,
				document.portEquipment,
			),
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			interactionFocus: "ports" as const,
		};
		renderer.render(initialStatic.context, createRecordingContext().context, input);

		expect(renderer.getStats()).toMatchObject({
			portSlotPreparedArtifactBindings: 1,
			staticRedraws: 1,
		});
		expect(
			initialStatic.strokes.some((stroke) => stroke.style === "rgba(91, 221, 227, 0.68)"),
		).toBe(true);
		expect(initialStatic.strokes.some((stroke) => stroke.style === "#f1c66f")).toBe(false);
		expect(
			renderer.hitTestPortSlot(
				slots,
				{
					x: slots.worldPositions[row * 2] as number,
					y: slots.worldPositions[row * 2 + 1] as number,
				},
				TEST_CAMERA.zoom,
			),
		).toBe(row);

		const targetRow = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL, row + 2);
		const candidateRows = renderer.queryPortSlots(slots, ohbRowDragBounds(slots, row, targetRow));
		const draft = selectOhbRowDrag(
			slots,
			input.portSlotAvailability,
			row,
			targetRow,
			candidateRows,
		);
		const draftOverlay = createRecordingContext();
		renderer.render(initialStatic.context, draftOverlay.context, {
			...input,
			portRowDraft: { portType: "OHB", selection: draft },
		});
		expect(renderer.getStats()).toMatchObject({
			ohbDraftRows: draft.rows.length,
			ohbDraftSkippedRows: 0,
			portSlotPreparedArtifactBindings: 1,
			staticRedraws: 1,
		});
		expect(draftOverlay.strokes.some((stroke) => stroke.style === "#76e5c3")).toBe(true);

		const occupiedPort = portSlotRecord(slots, row, 1, 1, "OHB-1");
		const occupiedState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [occupiedPort],
			equipmentGroups: [{ id: 1, kind: "OHB" as const, template: "SINGLE" as const, portIds: [1] }],
		};
		const occupiedStatic = createRecordingContext();
		const occupiedInput = {
			...input,
			portSlotAvailability: createPreparedPortSlotAvailabilityIndex(
				physical,
				prepared,
				occupiedState,
			),
		};
		renderer.render(occupiedStatic.context, createRecordingContext().context, occupiedInput);

		expect(renderer.getStats()).toMatchObject({
			portSlotPreparedArtifactBindings: 1,
			staticRedraws: 2,
		});
		expect(
			occupiedStatic.strokes.some((stroke) => stroke.style === "rgba(229, 188, 91, 0.48)"),
		).toBe(false);

		const occupiedHover = createRecordingContext();
		renderer.render(occupiedStatic.context, occupiedHover.context, {
			...occupiedInput,
			hoverPortSlot: row,
		});
		expect(renderer.getStats()).toMatchObject({
			portSlotPreparedArtifactBindings: 1,
			staticRedraws: 2,
		});
		expect(occupiedHover.strokes.some((stroke) => stroke.style === "#ff8d94")).toBe(true);

		renderer.render(occupiedStatic.context, createRecordingContext().context, {
			...occupiedInput,
			showPortSlots: false,
		});
		expect(renderer.getStats()).toMatchObject({
			portSlotPreparedArtifactBindings: 1,
			visiblePortSlotCandidates: 0,
			staticRedraws: 3,
		});
		renderer.render(occupiedStatic.context, createRecordingContext().context, {
			...occupiedInput,
			showPortSlots: true,
		});
		expect(renderer.getStats()).toMatchObject({
			portSlotPreparedArtifactBindings: 1,
			staticRedraws: 4,
		});
		expect(renderer.getStats().visiblePortSlotCandidates).toBeGreaterThan(0);

		const railStatic = createRecordingContext();
		renderer.render(railStatic.context, createRecordingContext().context, {
			...occupiedInput,
			showPortSlots: true,
			interactionFocus: "rail",
		});
		expect(renderer.getStats()).toMatchObject({
			portSlotPreparedArtifactBindings: 1,
			physicalPresentationBuilds: 1,
			staticRedraws: 5,
		});
		expect(railStatic.strokes.some((stroke) => stroke.style === "#f1c66f")).toBe(true);
	});

	it("does not display or hit-test a prepared row whose availability inputs changed", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const slots = prepared.slots;
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		expect(row).toBeGreaterThanOrEqual(0);
		const availability = createPreparedPortSlotAvailabilityIndex(
			physical,
			prepared,
			document.portEquipment,
		);
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: availability,
			showPortSlots: true,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			interactionFocus: "ports" as const,
		};
		const world = {
			x: slots.worldPositions[row * 2] as number,
			y: slots.worldPositions[row * 2 + 1] as number,
		};
		const renderer = new TileRenderer();
		const before = createRecordingContext();
		renderer.render(before.context, createRecordingContext().context, input);
		const beforeLegalMarkers = before.strokes.filter(
			(stroke) => stroke.style === "rgba(91, 221, 227, 0.68)",
		).length;
		expect(renderer.hitTestPortSlot(slots, world, TEST_CAMERA.zoom)).toBe(row);

		const routeX = slots.routeXs[row] as number;
		slots.routeXs[row] = routeX + 1;
		expect(renderer.hitTestPortSlot(slots, world, TEST_CAMERA.zoom)).toBeNull();
		const reboundRenderer = new TileRenderer();
		const after = createRecordingContext();
		reboundRenderer.render(after.context, createRecordingContext().context, input);
		expect(
			after.strokes.filter((stroke) => stroke.style === "rgba(91, 221, 227, 0.68)").length,
		).toBe(beforeLegalMarkers - 1);
		expect(reboundRenderer.hitTestPortSlot(slots, world, TEST_CAMERA.zoom)).toBeNull();
		slots.routeXs[row] = routeX;
	});

	it("redraws legal port slots when a moved port becomes the ignored occupant", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const row = prepared.slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		const occupiedPort = portSlotRecord(prepared.slots, row, 1, 1, "OHB-1");
		const availability = createPreparedPortSlotAvailabilityIndex(physical, prepared, {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [occupiedPort],
			equipmentGroups: [{ id: 1, kind: "OHB" as const, template: "SINGLE" as const, portIds: [1] }],
		});
		const renderer = new TileRenderer();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: prepared.slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: availability,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			interactionFocus: "ports" as const,
		};
		const occupiedStatic = createRecordingContext();
		renderer.render(occupiedStatic.context, createRecordingContext().context, input);
		const occupiedMarkers = occupiedStatic.strokes.filter(
			(stroke) => stroke.style === "rgba(91, 221, 227, 0.68)",
		).length;

		const ignoredStatic = createRecordingContext();
		renderer.render(ignoredStatic.context, createRecordingContext().context, {
			...input,
			ignoredPortIdForPortSlots: 1,
		});

		expect(renderer.getStats().staticRedraws).toBe(2);
		expect(
			ignoredStatic.strokes.filter((stroke) => stroke.style === "rgba(91, 221, 227, 0.68)").length,
		).toBe(occupiedMarkers + 1);
	});

	it("hit-tests committed ports by stable ID and paints hover/selection on the overlay only", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const row = prepared.slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		const port = portSlotRecord(prepared.slots, row, 7, 11, "OHB-007");
		const state = {
			nextPortId: 8,
			nextEquipmentGroupId: 12,
			ports: [port],
			equipmentGroups: [
				{ id: 11, kind: "OHB" as const, template: "SINGLE" as const, portIds: [7] },
			],
		};
		const presentation = compilePortEquipmentPresentation(physical, state);
		const renderer = new TileRenderer();
		const portWorld = {
			x: presentation.worldPositions[0] as number,
			y: presentation.worldPositions[1] as number,
		};
		expect(renderer.hitTestPortEquipment(presentation, portWorld, TEST_CAMERA.zoom)).toMatchObject({
			row: 0,
			portId: 7,
			equipmentGroupId: 11,
		});
		const staticContext = createRecordingContext();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			portEquipmentPresentation: presentation,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		};
		renderer.render(staticContext.context, createRecordingContext().context, input);
		expect(
			staticContext.strokes.some(
				(stroke) => stroke.style === "rgba(238, 255, 246, 0.92)" && stroke.width === 1.6,
			),
		).toBe(true);

		expect(renderer.hitTestPortEquipment(presentation, portWorld, TEST_CAMERA.zoom)).toMatchObject({
			row: 0,
			portId: 7,
			equipmentGroupId: 11,
		});
		expect(
			renderer.hitTestPortEquipment(presentation, { x: 99, y: 99 }, TEST_CAMERA.zoom),
		).toBeNull();
		const staticRedraws = renderer.getStats().staticRedraws;
		const hoverOverlay = createRecordingContext();
		renderer.render(staticContext.context, hoverOverlay.context, { ...input, hoverPortId: 7 });
		expect(renderer.getStats().staticRedraws).toBe(staticRedraws);
		expect(hoverOverlay.strokes.some((stroke) => stroke.style === "#8de3ea")).toBe(true);
		const selectedOverlay = createRecordingContext();
		renderer.render(staticContext.context, selectedOverlay.context, {
			...input,
			selectedPortId: 7,
		});
		expect(renderer.getStats().staticRedraws).toBe(staticRedraws);
		expect(selectedOverlay.strokes.some((stroke) => stroke.style === "#d8ffff")).toBe(true);
	});

	it("keeps a cold 50k current-presentation hit inside the input-task budget", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, "STK");
		const row = prepared.slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		expect(row).toBeGreaterThanOrEqual(0);
		const basePort = portSlotRecord(prepared.slots, row, 1, 1, null);
		const groupCount = 50_000;
		const presentation = compilePortEquipmentPresentation(physical, {
			nextPortId: groupCount + 1,
			nextEquipmentGroupId: groupCount + 1,
			ports: Array.from({ length: groupCount }, (_, index) => ({
				...basePort,
				id: index + 1,
				equipmentGroupId: index + 1,
			})),
			equipmentGroups: Array.from({ length: groupCount }, (_, index) => ({
				id: index + 1,
				kind: "STK" as const,
				template: "FLEX" as const,
				portIds: [index + 1],
			})),
		});
		const renderer = new TileRenderer();
		const world = {
			x: presentation.worldPositions[0] as number,
			y: presentation.worldPositions[1] as number,
		};

		const coldStartedAt = performance.now();
		const coldHit = renderer.hitTestPortEquipment(presentation, world, TEST_CAMERA.zoom);
		const coldMilliseconds = performance.now() - coldStartedAt;
		const cachedStartedAt = performance.now();
		const cachedHit = renderer.hitTestPortEquipment(presentation, world, TEST_CAMERA.zoom);
		const cachedMilliseconds = performance.now() - cachedStartedAt;
		const movedStartedAt = performance.now();
		const movedHit = renderer.hitTestPortEquipment(
			presentation,
			{ x: world.x + 0.01, y: world.y + 0.01 },
			TEST_CAMERA.zoom,
		);
		const movedMilliseconds = performance.now() - movedStartedAt;

		expect(coldHit).toMatchObject({ portId: 1, equipmentGroupId: 1 });
		expect(cachedHit).toMatchObject({ portId: 1, equipmentGroupId: 1 });
		expect(movedHit).toMatchObject({ portId: 1, equipmentGroupId: 1 });
		expect(coldMilliseconds).toBeLessThan(50);
		expect(cachedMilliseconds).toBeLessThan(5);
		expect(movedMilliseconds).toBeLessThan(5);
	}, 5_000);

	it.each([
		["OHB", OHB_PASSIVE_SLOT_VISUAL_MIN_ZOOM],
		["EQ", EQ_PASSIVE_SLOT_VISUAL_MIN_ZOOM],
	] as const)("keeps the ordinary %s target and hit test while suppressing passive overview markers", (portType, overviewThreshold) => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, portType);
		const slots = prepared.slots;
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		expect(row).toBeGreaterThanOrEqual(0);
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: createPreparedPortSlotAvailabilityIndex(
				physical,
				prepared,
				document.portEquipment,
			),
			showPortSlots: true,
			ghost: null,
			camera: {
				...TEST_CAMERA,
				zoom: overviewThreshold - 0.001,
			},
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		};
		const renderer = new TileRenderer();
		const overviewStatic = createRecordingContext();
		renderer.render(overviewStatic.context, createRecordingContext().context, input);
		expect(renderer.getStats().visiblePortSlotCandidates).toBeGreaterThan(0);
		expect(renderer.getStats().suppressedPassivePortSlotMarkers).toBeGreaterThan(0);
		expect(renderer.getStats()).toMatchObject({
			renderedPassivePortSlotMarkers: 0,
			portSlotPresentationLod: "overview",
		});
		expect(
			renderer.hitTestPortSlot(
				slots,
				{
					x: slots.worldPositions[row * 2] as number,
					y: slots.worldPositions[row * 2 + 1] as number,
				},
				overviewThreshold - 0.001,
			),
		).toBe(row);

		const hoverOverlay = createRecordingContext();
		renderer.render(overviewStatic.context, hoverOverlay.context, { ...input, hoverPortSlot: row });
		expect(hoverOverlay.strokes.some((stroke) => stroke.style === "#d8ffff")).toBe(true);

		const guidedStatic = createRecordingContext();
		renderer.render(guidedStatic.context, createRecordingContext().context, {
			...input,
			guidedPortPlacement: { label: "첫 Port", instruction: "ENTER" },
		});
		expect(renderer.getStats().renderedPassivePortSlotMarkers).toBe(0);
		expect(renderer.getGuidedCanvasActionMarkers()).toHaveLength(1);

		const detailStatic = createRecordingContext();
		renderer.render(detailStatic.context, createRecordingContext().context, {
			...input,
			camera: { ...TEST_CAMERA, zoom: overviewThreshold },
		});
		expect(renderer.getStats()).toMatchObject({
			suppressedPassivePortSlotMarkers: 0,
			portSlotPresentationLod: "detail",
		});
		expect(renderer.getStats().renderedPassivePortSlotMarkers).toBeGreaterThan(0);
	});

	it("keeps STK accumulation overlay-only and selects the derived committed group body", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, "STK");
		const slots = prepared.slots;
		const rows = [2, 3, 4, 5].map((x) => {
			const row = Array.from({ length: slots.count }, (_, index) => index).find(
				(index) =>
					(slots.routeXs[index] as number) === x &&
					(slots.routeZs[index] as number) === 0 &&
					(slots.statuses[index] as number) === PORT_SLOT_STATUS.LEGAL,
			);
			if (row === undefined) throw new Error(`expected STK slot at ${x}:0`);
			return row;
		});
		const availability = createPreparedPortSlotAvailabilityIndex(
			physical,
			prepared,
			document.portEquipment,
		);
		const draft = evaluateStkDraftSelection(slots, availability, rows, "FOUR_PORT");
		expect(draft.canComplete).toBe(true);

		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: availability,
			showPortSlots: true,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		};
		const overviewStatic = createRecordingContext();
		renderer.render(overviewStatic.context, createRecordingContext().context, {
			...input,
			camera: {
				...TEST_CAMERA,
				zoom: STK_PASSIVE_SLOT_VISUAL_MIN_ZOOM - 0.001,
			},
		});
		expect(renderer.getStats().visiblePortSlotCandidates).toBeGreaterThan(0);
		expect(renderer.getStats()).toMatchObject({
			visiblePortSlotMarks: 2,
			renderedPassivePortSlotMarkers: 0,
			suppressedPassivePortSlotMarkers: 5,
			portSlotPresentationLod: "overview",
		});
		expect(
			renderer.hitTestPortSlot(
				slots,
				{
					x: slots.worldPositions[rows[0] * 2] as number,
					y: slots.worldPositions[rows[0] * 2 + 1] as number,
				},
				STK_PASSIVE_SLOT_VISUAL_MIN_ZOOM - 0.001,
			),
		).toBe(rows[0]);

		const guidedOverviewStatic = createRecordingContext();
		renderer.render(guidedOverviewStatic.context, createRecordingContext().context, {
			...input,
			camera: {
				...TEST_CAMERA,
				zoom: STK_PASSIVE_SLOT_VISUAL_MIN_ZOOM - 0.001,
			},
			guidedPortPlacement: {
				label: "첫 Port",
				instruction: "ENTER",
			},
		});
		expect(renderer.getStats()).toMatchObject({
			visiblePortSlotMarks: 3,
			renderedPassivePortSlotMarkers: 0,
			suppressedPassivePortSlotMarkers: 4,
			portSlotPresentationLod: "overview",
		});
		expect(renderer.getGuidedCanvasActionMarkers()).toHaveLength(1);
		expect(guidedOverviewStatic.strokeRectCalls).toBe(overviewStatic.strokeRectCalls + 1);

		renderer.render(staticContext.context, createRecordingContext().context, input);
		expect(renderer.getStats()).toMatchObject({
			portSlotPresentationLod: "detail",
			suppressedPassivePortSlotMarkers: 0,
		});
		expect(renderer.getStats().renderedPassivePortSlotMarkers).toBeGreaterThan(0);
		expect(staticContext.fillRectStyles).not.toContain("rgba(225, 188, 91, 0.14)");
		expect(staticContext.strokeRectCalls).toBeGreaterThan(0);
		expect(staticContext.strokeRectStyles).toContain("rgba(225, 188, 91, 0.22)");
		// Only the two genuinely blocked edge-adjacent rows carry a red cross; legal hollow
		// diamonds must not be painted as rejected candidates.
		expect(staticContext.strokes.filter((stroke) => stroke.style === "#d96f79")).toHaveLength(2);
		const staticRedraws = renderer.getStats().staticRedraws;
		const draftOverlay = createRecordingContext();
		renderer.render(staticContext.context, draftOverlay.context, {
			...input,
			portRowDraft: { portType: "STK", selection: draft },
		});
		expect(renderer.getStats()).toMatchObject({
			staticRedraws,
			stkDraftRows: 4,
			stkDraftCanComplete: true,
		});
		expect(
			draftOverlay.strokes.some((stroke) => stroke.style === "rgba(246, 216, 132, 0.98)"),
		).toBe(true);
		expect(draftOverlay.strokes.some((stroke) => stroke.style === "rgba(184, 139, 47, 0.34)")).toBe(
			true,
		);

		const ports = rows.map((row, index) =>
			portSlotRecord(slots, row, index + 1, 9, `STK-9-P0${index + 1}`),
		);
		const presentation = compilePortEquipmentPresentation(physical, {
			nextPortId: 5,
			nextEquipmentGroupId: 10,
			ports,
			equipmentGroups: [{ id: 9, kind: "STK", template: "FOUR_PORT", portIds: [1, 2, 3, 4] }],
		});
		const committedStatic = createRecordingContext();
		renderer.render(committedStatic.context, createRecordingContext().context, {
			...input,
			portEquipmentPresentation: presentation,
			portRowDraft: null,
		});
		expect(committedStatic.labels).toContain("STK-9");
		expect(committedStatic.fillRectStyles).toContain("#d6b454");
		expect(
			renderer.hitTestPortEquipment(
				presentation,
				{
					x: presentation.groupCenters[0] as number,
					y: presentation.groupCenters[1] as number,
				},
				TEST_CAMERA.zoom,
			),
		).toMatchObject({ equipmentGroupId: 9, distanceMeters: 0 });
		const selectedOverlay = createRecordingContext();
		renderer.render(committedStatic.context, selectedOverlay.context, {
			...input,
			portEquipmentPresentation: presentation,
			selectedPortId: 1,
		});
		expect(selectedOverlay.strokes.some((stroke) => stroke.style === "#fff0b0")).toBe(true);
	});

	it("selects a FLEX STK through its ports or connected-run reservation body", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, "STK");
		const slots = prepared.slots;
		const rows = [2, 8].map((x) => {
			const row = Array.from({ length: slots.count }, (_, index) => index).find(
				(index) =>
					(slots.routeXs[index] as number) === x &&
					(slots.routeZs[index] as number) === 0 &&
					(slots.statuses[index] as number) === PORT_SLOT_STATUS.LEGAL,
			);
			if (row === undefined) throw new Error(`expected FLEX STK slot at ${x}:0`);
			return row;
		});
		const ports = rows.map((row, index) =>
			portSlotRecord(slots, row, index + 1, 5, `STK-5-P0${index + 1}`),
		);
		const renderer = new TileRenderer();
		const emptyAvailability = createPreparedPortSlotAvailabilityIndex(
			physical,
			prepared,
			document.portEquipment,
		);
		const draftStatic = createRecordingContext();
		const draftInput = {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: emptyAvailability,
			showPortSlots: true,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			interactionFocus: "ports" as const,
		};
		renderer.render(draftStatic.context, createRecordingContext().context, draftInput);
		const draft = evaluateStkDraftSelection(
			slots,
			emptyAvailability,
			rows,
			"FLEX",
			(bounds, target) => renderer.queryPortSlots(slots, bounds, target),
		);
		expect(draft.canComplete).toBe(true);
		const draftOverlay = createRecordingContext();
		renderer.render(draftStatic.context, draftOverlay.context, {
			...draftInput,
			portRowDraft: { portType: "STK", selection: draft },
		});
		expect(draftOverlay.labels).toEqual(expect.arrayContaining(["P1", "P2", "RESERVED SPAN"]));
		expect(
			draftOverlay.strokes.some(
				(stroke) => stroke.style === "rgba(246, 216, 132, 0.98)" && stroke.width >= 2.4,
			),
		).toBe(true);
		expect(
			draftOverlay.strokes.filter((stroke) => stroke.style === "#e3c568" && stroke.width === 3.2),
		).toHaveLength(4);

		const equipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 6,
			ports,
			equipmentGroups: [{ id: 5, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		} as const;
		const presentation = compilePortEquipmentPresentation(physical, equipmentState);
		const stalePort = { ...ports[0], id: 99, equipmentGroupId: 99 };
		const stalePresentation = compilePortEquipmentPresentation(physical, {
			nextPortId: 100,
			nextEquipmentGroupId: 100,
			ports: [stalePort],
			equipmentGroups: [{ id: 99, kind: "STK", template: "FLEX", portIds: [99] }],
		});
		const availability = createPreparedPortSlotAvailabilityIndex(
			physical,
			prepared,
			equipmentState,
		);
		const staticContext = createRecordingContext();
		const selectedOverlay = createRecordingContext();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			portSlots: slots,
			portSlotSpatialIndex: prepared.spatialIndex,
			portSlotAvailability: availability,
			portEquipmentPresentation: presentation,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			interactionFocus: "ports" as const,
		};
		const staleStatic = createRecordingContext();
		renderer.render(staleStatic.context, createRecordingContext().context, {
			...input,
			portEquipmentPresentation: stalePresentation,
		});
		expect(
			renderer.hitTestPortEquipment(presentation, { x: 5.5, y: 0.5 }, TEST_CAMERA.zoom),
		).toMatchObject({ portId: 1, equipmentGroupId: 5, distanceMeters: 0 });

		renderer.render(staticContext.context, selectedOverlay.context, {
			...input,
			selectedPortId: 1,
		});

		expect(staticContext.labels).toContain("STK-5");
		expect(
			staticContext.strokes.filter((stroke) => stroke.style === "#f6d884" && stroke.width === 2.2),
		).toHaveLength(5);
		expect(selectedOverlay.strokes.some((stroke) => stroke.style === "#fff0b0")).toBe(true);
		const reservedRow = slots.routeXs.indexOf(5);
		const reservedHover = createRecordingContext();
		renderer.render(staticContext.context, reservedHover.context, {
			...input,
			hoverPortSlot: reservedRow,
		});
		expect(reservedHover.labels).toContain("RESERVED");
		expect(
			renderer.hitTestPortEquipment(presentation, { x: 5.5, y: 0.5 }, TEST_CAMERA.zoom),
		).toMatchObject({ portId: 1, equipmentGroupId: 5, distanceMeters: 0 });
		expect(renderer.hitTestPortSlot(slots, { x: 5.5, y: 0.5 }, TEST_CAMERA.zoom)).toBeNull();
		expect(
			renderer.hitTestPortSlot(slots, { x: 5.5, y: 0.5 }, TEST_CAMERA.zoom, undefined, 0, true),
		).toBe(reservedRow);
		const staticInvalidRow = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		expect(staticInvalidRow).toBeGreaterThanOrEqual(0);
		slots.statuses[staticInvalidRow] = PORT_SLOT_STATUS.UNSAFE_APPROACH;
		const staticInvalidWorld = {
			x: slots.worldPositions[staticInvalidRow * 2] as number,
			y: slots.worldPositions[staticInvalidRow * 2 + 1] as number,
		};
		expect(renderer.hitTestPortSlot(slots, staticInvalidWorld, TEST_CAMERA.zoom)).toBeNull();
		expect(
			renderer.hitTestPortSlot(
				slots,
				staticInvalidWorld,
				TEST_CAMERA.zoom,
				undefined,
				0,
				true,
				0,
				true,
			),
		).toBe(staticInvalidRow);
		expect(
			renderer.hitTestPortEquipment(
				presentation,
				{
					x: presentation.worldPositions[0] as number,
					y: presentation.worldPositions[1] as number,
				},
				TEST_CAMERA.zoom,
			),
		).toMatchObject({ portId: 1, equipmentGroupId: 5 });
	});
});

describe("module ownership rendering", () => {
	it("highlights an ordinary module by exact physical spans without cell rectangles", () => {
		const screenPaths = installRecordingPath2D();
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const module = buildRailModuleOwnershipIndex(document.map).modules.find(
			(candidate) => candidate.kind === "straight",
		);
		if (!module) throw new Error("expected straight ownership");
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();

		renderer.render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: module.primaryCells[0] as Cell,
			selectedModule: module,
		});

		expect(overlayContext.strokeRectCalls).toBe(0);
		expect(overlayContext.strokes.filter((stroke) => stroke.style === "#8de3ea")).toHaveLength(2);
		expect(renderer.getStats().physicalSelectionBuilds).toBe(1);
		expect(renderer.getStats().physicalSelectionCandidates).toBeGreaterThan(0);
		expect(renderer.getStats().physicalSelectionCandidates).toBeLessThanOrEqual(6);
		expect(renderer.getStats().selectedScreenPathBuilds).toBe(1);
		const pathCountAfterFirstRender = screenPaths.length;

		renderer.render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: module.primaryCells[0] as Cell,
			selectedModule: module,
		});
		expect(renderer.getStats().physicalSelectionBuilds).toBe(1);
		expect(renderer.getStats().selectedScreenPathBuilds).toBe(1);
		expect(screenPaths).toHaveLength(pathCountAfterFirstRender);

		renderer.render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { ...TEST_CAMERA, offsetX: TEST_CAMERA.offsetX + 12 },
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: module.primaryCells[0] as Cell,
			selectedModule: module,
		});
		expect(renderer.getStats().physicalSelectionBuilds).toBe(1);
		expect(renderer.getStats().selectedScreenPathBuilds).toBe(2);
		expect(screenPaths.length).toBeGreaterThan(pathCountAfterFirstRender);
	});

	it("keeps a selected five-meter straight inside its exact metric interval in every view", () => {
		const screenPaths = installRecordingPath2D();
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const modules = buildRailModuleOwnershipIndex(document.map).modules.filter(
			(candidate) => candidate.kind === "straight",
		);
		const selectedModule = modules[1];
		if (!selectedModule) throw new Error("expected middle straight module");
		const physical = compilePhysicalRail(document.map);

		for (const rotation of [0, 1, 2, 3] as const) {
			const renderer = new TileRenderer();
			const before = screenPaths.length;
			renderer.render(createRecordingContext().context, createRecordingContext().context, {
				map: document.map,
				physicalPaths: physical.paths,
				ghost: null,
				camera: { ...TEST_CAMERA, rotation },
				width: 960,
				height: 640,
				dpr: 1,
				hoverTile: null,
				hoverWorld: null,
				anchorTile: null,
				selectedTile: selectedModule.primaryCells[0] as Cell,
				selectedModule,
			});
			const selectionPaths = screenPaths.slice(before + 3, before + 5);
			expect(selectionPaths).toHaveLength(2);
			for (const path of selectionPaths) {
				const worldPoints = path.commands.map((command) =>
					renderer.worldAtScreen(command.x, command.y, { ...TEST_CAMERA, rotation }),
				);
				expect(Math.min(...worldPoints.map((point) => point.x))).toBeCloseTo(5.5, 5);
				expect(Math.max(...worldPoints.map((point) => point.x))).toBeCloseTo(10.5, 5);
			}
		}
	});

	it("does not reuse a stale empty selection for a current module with the same key", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 })),
		).toBe(true);
		const staleModule = buildRailModuleOwnershipIndex(document.map).modules.find(
			(module) => module.kind === "straight",
		);
		if (!staleModule) throw new Error("expected stale straight module");
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const currentModule = buildRailModuleOwnershipIndex(document.map).find(staleModule.key);
		if (!currentModule) throw new Error("expected current straight module with the same key");
		const physical = compilePhysicalRail(document.map);
		const renderer = new TileRenderer();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: staleModule.primaryCells[0] as Cell,
		} as const;
		const staleOverlay = createRecordingContext();
		renderer.render(createRecordingContext().context, staleOverlay.context, {
			...input,
			selectedModule: staleModule,
		});
		expect(staleOverlay.strokes.filter((stroke) => stroke.style === "#8de3ea")).toHaveLength(0);

		const currentOverlay = createRecordingContext();
		renderer.render(createRecordingContext().context, currentOverlay.context, {
			...input,
			selectedModule: currentModule,
		});
		expect(currentOverlay.strokes.filter((stroke) => stroke.style === "#8de3ea")).toHaveLength(2);
		expect(renderer.getStats().physicalSelectionBuilds).toBe(2);
	});

	it("invalidates hover and selection screen paths for every geometry-affecting input", () => {
		installRecordingPath2D();
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const modules = buildRailModuleOwnershipIndex(document.map).modules.filter(
			(module) => module.kind === "straight",
		);
		const firstModule = modules[0];
		const secondModule = modules[1];
		if (!firstModule || !secondModule) throw new Error("expected two straight modules");
		const firstPhysical = compilePhysicalRail(document.map);
		const pathIndex = [...firstPhysical.paths.kinds].indexOf(PATH_KIND.LINEAR);
		const hoverWorld = samplePhysicalPath(firstPhysical.paths, pathIndex, 0.5);
		if (!hoverWorld) throw new Error("expected hover sample");
		const renderer = new TileRenderer();
		const render = (
			physicalPaths: typeof firstPhysical.paths,
			selectedModule: RailModuleOwnership,
			camera: Camera,
			mode: "profiled" | "centerline",
		): void => {
			renderer.render(createRecordingContext().context, createRecordingContext().context, {
				map: document.map,
				physicalPaths,
				ghost: null,
				camera,
				width: 960,
				height: 640,
				dpr: 1,
				hoverTile: { x: Math.floor(hoverWorld.x), y: Math.floor(hoverWorld.y) },
				hoverWorld,
				anchorTile: null,
				selectedTile: selectedModule.primaryCells[0] as Cell,
				selectedModule,
				railPresentationMode: mode,
			});
		};

		render(firstPhysical.paths, firstModule, TEST_CAMERA, "profiled");
		render(firstPhysical.paths, firstModule, TEST_CAMERA, "profiled");
		expect(renderer.getStats()).toMatchObject({
			hoverScreenPathBuilds: 1,
			selectedScreenPathBuilds: 1,
		});
		render(firstPhysical.paths, firstModule, { ...TEST_CAMERA, zoom: 8 }, "profiled");
		render(firstPhysical.paths, firstModule, { ...TEST_CAMERA, zoom: 8, rotation: 1 }, "profiled");
		render(
			firstPhysical.paths,
			firstModule,
			{ ...TEST_CAMERA, zoom: 8, rotation: 1 },
			"centerline",
		);
		expect(renderer.getStats()).toMatchObject({
			hoverScreenPathBuilds: 4,
			selectedScreenPathBuilds: 4,
		});

		render(
			firstPhysical.paths,
			secondModule,
			{ ...TEST_CAMERA, zoom: 8, rotation: 1 },
			"centerline",
		);
		expect(renderer.getStats()).toMatchObject({
			hoverScreenPathBuilds: 4,
			selectedScreenPathBuilds: 5,
		});

		const replacementPaths = compilePhysicalRail(document.map).paths;
		render(replacementPaths, secondModule, { ...TEST_CAMERA, zoom: 8, rotation: 1 }, "centerline");
		expect(renderer.getStats()).toMatchObject({
			hoverScreenPathBuilds: 5,
			selectedScreenPathBuilds: 6,
			physicalSelectionBuilds: 3,
		});
	});

	it("reuses the bound physical index for pointer route hit testing", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const pathIndex = [...physical.paths.kinds].indexOf(PATH_KIND.LINEAR);
		const sample = samplePhysicalPath(
			physical.paths,
			pathIndex,
			(physical.paths.lengths[pathIndex] as number) / 2,
		);
		if (!sample) throw new Error("expected a physical path sample");
		const renderer = new TileRenderer();
		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(
			renderer.hitTestCommittedPath(
				{ x: Math.floor(sample.x), y: Math.floor(sample.y) },
				sample,
				TEST_CAMERA.zoom,
				physical.paths,
			),
		).toMatchObject({ pathIndex, distanceToPathMeters: 0 });
		expect(
			renderer.hitTestCommittedPath(
				{ x: Math.floor(sample.x), y: Math.floor(sample.y) },
				sample,
				TEST_CAMERA.zoom,
				compilePhysicalRail(document.map).paths,
			),
		).toBeNull();
	});

	it("uses one exact turnout polyline hit for both hover and downstream flow", () => {
		const screenPaths = installRecordingPath2D();
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const divergePath = [...physical.paths.kinds].indexOf(PATH_KIND.TURNOUT_DIVERGE);
		const sample = samplePhysicalPath(
			physical.paths,
			divergePath,
			(physical.paths.lengths[divergePath] as number) * 0.72,
		);
		if (!sample) throw new Error("expected turnout sample");
		const renderer = new TileRenderer();
		const overlay = createRecordingContext();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: { x: Math.floor(sample.x), y: Math.floor(sample.y) },
			hoverWorld: sample,
			anchorTile: null,
			selectedTile: null,
			railPresentationMode: "profiled",
		} as const;
		renderer.render(createRecordingContext().context, overlay.context, input);

		expect(overlay.strokeRectCalls).toBe(0);
		expect(
			overlay.strokes.filter((stroke) => stroke.style === "rgba(143, 229, 235, 0.78)"),
		).toHaveLength(2);
		expect(screenPaths.slice(-2).every((path) => path.commands.length > 2)).toBe(true);
		expect(renderer.getStats().hoverScreenPathBuilds).toBe(1);
		const pathCountAfterFirstRender = screenPaths.length;
		renderer.render(createRecordingContext().context, overlay.context, input);
		expect(renderer.getStats().hoverScreenPathBuilds).toBe(1);
		expect(screenPaths).toHaveLength(pathCountAfterFirstRender);

		const portsOverlay = createRecordingContext();
		renderer.render(createRecordingContext().context, portsOverlay.context, {
			...input,
			interactionFocus: "ports",
		});
		expect(renderer.getStats().hoverScreenPathBuilds).toBe(1);
		expect(
			portsOverlay.strokes.some((stroke) => stroke.style === "rgba(143, 229, 235, 0.78)"),
		).toBe(false);
	});

	it("renders every authored module family through all interaction LODs and camera rotations", () => {
		const screenPaths = installRecordingPath2D();
		for (const fixture of createModuleRenderFixtures()) {
			const physical = compilePhysicalRail(fixture.document.map);
			for (const zoom of [8, 18, 38]) {
				for (const rotation of [0, 1, 2, 3] as const) {
					const before = screenPaths.length;
					const overlay = createRecordingContext();
					new TileRenderer().render(createRecordingContext().context, overlay.context, {
						map: fixture.document.map,
						physicalPaths: physical.paths,
						ghost: null,
						camera: { offsetX: 480, offsetY: 320, zoom, rotation },
						width: 960,
						height: 640,
						dpr: 1,
						hoverTile: null,
						hoverWorld: null,
						anchorTile: null,
						selectedTile: fixture.module.primaryCells[0] as Cell,
						selectedModule: fixture.module,
						railPresentationMode: "profiled",
					});

					const created = screenPaths.slice(before);
					expect(created.length, `${fixture.name}/${zoom}/${rotation}`).toBeGreaterThan(0);
					expect(
						created.every(
							(path) =>
								path.commands.length > 1 &&
								path.commands.every(
									(command) => Number.isFinite(command.x) && Number.isFinite(command.y),
								),
						),
						`${fixture.name}/${zoom}/${rotation}`,
					).toBe(true);
					expect(
						overlay.strokes.filter((stroke) => stroke.style === "#8de3ea"),
						`${fixture.name}/${zoom}/${rotation}`,
					).toHaveLength(zoom < 12 ? 1 : 2);
				}
			}
		}
	});
});

describe("organization bundle ghost presentation", () => {
	it("renders the coarse chunk artifact without compiling an exact rail ghost", () => {
		const fixture = createOrganizationBundleGhostFixture();
		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(fixture.bundle, 0);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		const preview = planStaticFabOrganizationBundlePlacementPreview(
			fixture.map,
			prepared.artifact,
			{ x: 0, y: 0 },
		);
		const renderer = new TileRenderer();
		const overlay = createRecordingContext();

		renderer.render(createRecordingContext().context, overlay.context, {
			map: fixture.map,
			physicalPaths: fixture.physicalPaths,
			ghost: null,
			organizationBundlePreview: preview,
			guidedOrganizationPlacement: {
				reservedLeftPixels: 0,
				reservedRightPixels: 0,
				reservedTopPixels: 0,
				reservedBottomPixels: 0,
			},
			organizationBundlePlacementGuide: {
				sourceBounds: {
					minX: prepared.artifact.bounds.minX - 50,
					minY: prepared.artifact.bounds.minY,
					maxX: prepared.artifact.bounds.maxX - 50,
					maxY: prepared.artifact.bounds.maxY,
				},
				anchor: preview.anchor,
				centerX: false,
				centerY: true,
			},
			camera: fixture.camera,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(overlay.labels.some((label) => label.includes("표식을 탭해 정확 검사"))).toBe(false);
		expect(overlay.labels).toContain("SNAP · Z CENTER");
		expect(renderer.getGuidedCanvasActionMarkers()).toEqual([
			expect.objectContaining({ role: "organization-placement" }),
		]);
		expect(renderer.getStats()).toMatchObject({
			ghostPathCompiles: 0,
			organizationBundlePreviewVisibleChunks: expect.any(Number),
			organizationBundlePreviewVisiblePorts: fixture.bundle.ports.length,
		});
		expect(renderer.getStats().organizationBundlePreviewVisibleChunks).toBeGreaterThan(0);
		expect(renderer.getStats().organizationBundlePreviewVisibleCells).toBeGreaterThan(0);
	});

	it("keeps a guided touch center on a shallow fitted organization ghost", () => {
		const fixture = createOrganizationBundleGhostFixture();
		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(fixture.bundle, 0);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		const preview = planStaticFabOrganizationBundlePlacementPreview(
			fixture.map,
			prepared.artifact,
			{ x: 0, y: 0 },
		);
		const zoom = 1.6;
		const worldCenterX =
			preview.anchor.x + (prepared.artifact.bounds.minX + prepared.artifact.bounds.maxX) / 2;
		const worldCenterY =
			preview.anchor.y + (prepared.artifact.bounds.minY + prepared.artifact.bounds.maxY) / 2;
		const renderer = new TileRenderer();
		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			map: fixture.map,
			physicalPaths: fixture.physicalPaths,
			ghost: null,
			organizationBundlePreview: preview,
			guidedOrganizationPlacement: {
				reservedLeftPixels: 70,
				reservedRightPixels: 8,
				reservedTopPixels: 250,
				reservedBottomPixels: 170,
			},
			camera: {
				offsetX: 480 - worldCenterX * zoom,
				offsetY: 430 - worldCenterY * zoom,
				zoom,
				rotation: 0,
			},
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		const marker = renderer
			.getGuidedCanvasActionMarkers()
			.find((candidate) => candidate.role === "organization-placement");
		expect(marker).toBeDefined();
		expect(marker?.x).toBeGreaterThanOrEqual(70 + 26);
		expect(marker?.x).toBeLessThanOrEqual(960 - 8 - 26);
		expect(marker?.y).toBeGreaterThanOrEqual(250 + 26);
		expect(marker?.y).toBeLessThanOrEqual(640 - 170 - 26);
	});

	it("renders every visible cell in a factory-scale organization ghost", () => {
		const source = new RailDocument();
		const sourcePlan = planRailAreaStamp(
			source.map,
			createRectangularAreaStampTemplate(1_200, 900),
			{ x: 0, y: 0 },
			initialRailAreaStampPose(),
		);
		expect(sourcePlan.valid, sourcePlan.reason).toBe(true);
		expect(source.commit(sourcePlan)).toBe(true);

		const edgesByKey = new Map<string, DirectedRailEdge>();
		for (const module of buildRailModuleOwnershipIndex(source.map).modules) {
			for (const edge of module.eraseEdges) {
				edgesByKey.set(`${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`, edge);
			}
		}
		const railEdges = Object.freeze([...edgesByKey.values()].sort(compareDirectedRailEdges));
		const organizations: StaticFabOrganizationState = Object.freeze({
			nextOrganizationId: 2,
			records: Object.freeze([
				Object.freeze({
					id: 1,
					kind: "AREA" as const,
					name: "Factory-scale Ghost",
					parentOrganizationIds: Object.freeze([]),
					properties: Object.freeze({ description: "", color: "TEAL" as const }),
					membership: Object.freeze({
						railEdges,
						advancedSwitchIds: Object.freeze([]),
						equipmentGroupIds: Object.freeze([]),
					}),
				}),
			]),
		});
		const capture = captureStaticFabOrganizationBundle(
			source.map,
			source.portEquipment,
			source.getPatchSequence(),
			organizations,
			[1],
			"DIRECT",
		);
		expect(capture.valid, capture.reason).toBe(true);
		if (!capture.valid) return;

		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(capture.bundle, 0);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		expect(prepared.artifact.footprintCellCount).toBeGreaterThan(4_096);

		const map = new TileMap();
		const preview = planStaticFabOrganizationBundlePlacementPreview(map, prepared.artifact, {
			x: 0,
			y: 0,
		});
		const zoom = Math.min(
			896 / (prepared.artifact.widthMeters + 1),
			576 / (prepared.artifact.heightMeters + 1),
		);
		const renderer = new TileRenderer();
		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			map,
			physicalPaths: compilePhysicalRail(map).paths,
			ghost: null,
			organizationBundlePreview: preview,
			camera: {
				offsetX: 480 - (prepared.artifact.widthMeters * zoom) / 2,
				offsetY: 320 - (prepared.artifact.heightMeters * zoom) / 2,
				zoom,
				rotation: 0,
			},
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(renderer.getStats()).toMatchObject({
			organizationBundlePreviewVisibleChunks: prepared.artifact.chunkCount,
			organizationBundlePreviewVisibleCells: prepared.artifact.footprintCellCount,
		});
	});

	it("draws viewport-visible authored ports and equipment extents in validity colors", () => {
		const fixture = createOrganizationBundleGhostFixture();
		const renderer = new TileRenderer();
		const validOverlay = createRecordingContext();
		renderer.render(createRecordingContext().context, validOverlay.context, {
			map: fixture.map,
			physicalPaths: fixture.physicalPaths,
			ghost: { mode: "build", plan: fixture.plan, evaluation: fixture.evaluation },
			camera: fixture.camera,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: fixture.plan.cells[0] as Cell,
			selectedTile: null,
		});

		const group = fixture.plan.equipmentGroupMutations[0]?.after;
		expect(group).toBeDefined();
		const label = `EQ-${group?.id}`;
		const validLabelIndex = validOverlay.labels.indexOf(label);
		expect(validLabelIndex).toBeGreaterThanOrEqual(0);
		expect(validOverlay.labelStyles[validLabelIndex]).toBe("#62dbe5");
		expect(validOverlay.arcCalls).toBeGreaterThanOrEqual(fixture.plan.portMutations.length * 2);
		expect(
			validOverlay.strokes.filter((stroke) => stroke.style === "#62dbe5").length,
		).toBeGreaterThan(fixture.plan.portMutations.length);

		const invalidOverlay = createRecordingContext();
		const invalidEvaluation = Object.freeze({
			...fixture.evaluation,
			valid: false,
			reason: "equipment footprint conflict",
		});
		renderer.render(createRecordingContext().context, invalidOverlay.context, {
			map: fixture.map,
			physicalPaths: fixture.physicalPaths,
			ghost: { mode: "build", plan: fixture.plan, evaluation: invalidEvaluation },
			camera: fixture.camera,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: fixture.plan.cells[0] as Cell,
			selectedTile: null,
		});
		const invalidLabelIndex = invalidOverlay.labels.indexOf(label);
		expect(invalidLabelIndex).toBeGreaterThanOrEqual(0);
		expect(invalidOverlay.labelStyles[invalidLabelIndex]).toBe("#f06b72");
	});

	it("culls off-screen organization equipment presentation", () => {
		const fixture = createOrganizationBundleGhostFixture();
		const overlay = createRecordingContext();
		new TileRenderer().render(createRecordingContext().context, overlay.context, {
			map: fixture.map,
			physicalPaths: fixture.physicalPaths,
			ghost: { mode: "build", plan: fixture.plan, evaluation: fixture.evaluation },
			camera: {
				...fixture.camera,
				offsetX: fixture.camera.offsetX + 100_000,
				offsetY: fixture.camera.offsetY + 100_000,
			},
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: fixture.plan.cells[0] as Cell,
			selectedTile: null,
		});

		const groupId = fixture.plan.equipmentGroupMutations[0]?.after?.id;
		expect(overlay.labels).not.toContain(`EQ-${groupId}`);
	});
});

describe("physical rail presentation rendering", () => {
	it("renders a factory-scale blueprint as a bounded schematic instead of thousands of tile fills", () => {
		const map = new TileMap();
		const template = createRectangularAreaStampTemplate(600, 501);
		const plan = planRailAreaStamp(map, template, { x: -300, y: -250 }, initialRailAreaStampPose());
		const committed = compilePhysicalRail(map);
		const evaluation = new RailDraftEvaluator().evaluate(map, committed, plan);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		const renderer = new TileRenderer();
		const overlay = createRecordingContext();

		renderer.render(createRecordingContext().context, overlay.context, {
			map,
			physicalPaths: committed.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: { offsetX: 480, offsetY: 320, zoom: 1, rotation: 0 },
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: plan.areaStamp.anchor,
			selectedTile: null,
		});

		expect(template.sourceEdgeCount).toBeGreaterThan(2_000);
		expect(renderer.getStats()).toMatchObject({
			ghostPathCompiles: 0,
			ghostPresentationBuilds: 0,
			ghostScreenPathBuilds: 0,
		});
		expect(overlay.labels.some((label) => label.includes("MODULE FAB"))).toBe(true);
		expect(overlay.fillRectStyles.length).toBeLessThan(100);
	});

	it("binds Worker-prepared presentation and lookup artifacts on the first committed render", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const artifacts = compilePhysicalRailRenderArtifacts(physical.paths);
		const renderer = new TileRenderer();

		renderer.render(createRecordingContext().context, createRecordingContext().context, {
			map: document.map,
			physicalPaths: physical.paths,
			physicalRenderArtifacts: artifacts,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(renderer.getStats()).toMatchObject({
			physicalPathBindings: 1,
			physicalPreparedArtifactBindings: 1,
			spatialChunkCount: artifacts.spatialIndex.chunkOffsets.length - 1,
		});
	});

	it("uses byte-equivalent paired-beam screen geometry for a valid ghost and its commit", () => {
		const screenPaths = installRecordingPath2D();
		const document = new RailDocument();
		const committedBefore = compilePhysicalRail(document.map);
		const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 3 });
		const evaluation = new RailDraftEvaluator().evaluate(document.map, committedBefore, plan);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		const renderer = new TileRenderer();
		const input = {
			map: document.map,
			physicalPaths: committedBefore.paths,
			ghost: { mode: "build", plan, evaluation } as const,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: { x: 0, y: 0 },
			selectedTile: null,
			railPresentationMode: "profiled" as const,
		};

		renderer.render(createRecordingContext().context, createRecordingContext().context, input);
		const ghostPaths = screenPaths.slice(-3);
		expect(ghostPaths).toHaveLength(3);
		expect(renderer.getStats()).toMatchObject({
			ghostPathCompiles: 1,
			ghostPresentationBuilds: 1,
			ghostScreenPathBuilds: 1,
		});
		const pathCountAfterFirstRender = screenPaths.length;
		renderer.render(createRecordingContext().context, createRecordingContext().context, input);
		expect(screenPaths).toHaveLength(pathCountAfterFirstRender);
		expect(renderer.getStats()).toMatchObject({
			ghostPresentationBuilds: 1,
			ghostScreenPathBuilds: 1,
		});

		expect(document.commit(plan)).toBe(true);
		const committedAfter = compilePhysicalRail(document.map);
		const commitStart = screenPaths.length;
		new TileRenderer().render(createRecordingContext().context, createRecordingContext().context, {
			...input,
			map: document.map,
			physicalPaths: committedAfter.paths,
			ghost: null,
			anchorTile: null,
		});
		const committedPaths = screenPaths.slice(commitStart, commitStart + 3);
		expectScreenPathsClose(ghostPaths, committedPaths);
	});

	it("draws an invalid exact ghost with the same paired profile and caches it", () => {
		const screenPaths = installRecordingPath2D();
		const document = createOpenEastTerminal();
		const physical = compilePhysicalRail(document.map);
		const plan = planRailConstruction(document.map, { x: 1, y: 0 }, { x: 1, y: 4 });
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		expect(evaluation.valid).toBe(false);
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();
		const input = {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation } as const,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			railPresentationMode: "profiled" as const,
		};

		renderer.render(staticContext.context, overlayContext.context, input);
		const expectedBeamWidth =
			OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE.beamWidthMeters * TEST_CAMERA.zoom;
		expect(
			overlayContext.strokes.filter(
				(stroke) =>
					stroke.style === "#f06b72" && Math.abs(stroke.width - expectedBeamWidth) < 0.001,
			),
		).toHaveLength(2);
		const firstPathCount = screenPaths.length;
		renderer.render(staticContext.context, overlayContext.context, input);
		expect(screenPaths).toHaveLength(firstPathCount);
		expect(renderer.getStats()).toMatchObject({
			ghostPresentationBuilds: 1,
			ghostScreenPathBuilds: 1,
		});
		renderer.render(staticContext.context, overlayContext.context, {
			...input,
			camera: { ...TEST_CAMERA, offsetX: TEST_CAMERA.offsetX + 8 },
		});
		renderer.render(staticContext.context, overlayContext.context, {
			...input,
			camera: { ...TEST_CAMERA, offsetX: TEST_CAMERA.offsetX + 8 },
			railPresentationMode: "centerline",
		});
		expect(renderer.getStats()).toMatchObject({
			ghostPresentationBuilds: 1,
			ghostScreenPathBuilds: 3,
		});

		const replacementEvaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		renderer.render(staticContext.context, overlayContext.context, {
			...input,
			ghost: { mode: "build", plan, evaluation: replacementEvaluation },
			camera: { ...TEST_CAMERA, offsetX: TEST_CAMERA.offsetX + 8 },
			railPresentationMode: "centerline",
		});
		expect(renderer.getStats()).toMatchObject({
			ghostPathCompiles: 2,
			ghostPresentationBuilds: 2,
			ghostScreenPathBuilds: 4,
		});
	});

	it("keeps outbound and return routes visually distinct in a Network Link ghost", () => {
		installRecordingPath2D();
		const document = new RailDocument();
		const parameters = defaultRailTemplateParameters("long-bay");
		for (const y of [0, 20]) {
			const bay = planRailTemplate(
				document.map,
				"long-bay",
				{ x: 0, y },
				{ forward: DIR_E, side: "right" },
				parameters,
			);
			expect(bay.valid, bay.reason).toBe(true);
			expect(document.commit(bay)).toBe(true);
		}
		const physical = compilePhysicalRail(document.map);
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 });
		const plan = planRailNetworkLink(document.map, context, { x: 16, y: 20 });
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		const overlay = createRecordingContext();

		new TileRenderer().render(createRecordingContext().context, overlay.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: { offsetX: 250, offsetY: 100, zoom: 16, rotation: 0 },
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: { x: 16, y: 20 },
			hoverWorld: { x: 16.5, y: 20.5 },
			anchorTile: { x: 16, y: 6 },
			anchorIntent: "network-link-source",
			anchorDirection: context.sourceForward,
			selectedTile: null,
			railPresentationMode: "profiled",
		});

		expect(overlay.labels).toEqual(
			expect.arrayContaining(["OUTBOUND", "RETURN", "B", "M", "1 SOURCE"]),
		);
		expect(overlay.strokes).toContainEqual(expect.objectContaining({ style: "#6fe5f0" }));
		expect(overlay.strokes).toContainEqual(expect.objectContaining({ style: "#f1c66a" }));
	});

	it("suppresses a rejected Network Link candidate instead of drawing failed helper rails", () => {
		installRecordingPath2D();
		const document = new RailDocument();
		const parameters = defaultRailTemplateParameters("long-bay");
		for (const y of [0, 20]) {
			const bay = planRailTemplate(
				document.map,
				"long-bay",
				{ x: 0, y },
				{ forward: DIR_E, side: "right" },
				parameters,
			);
			expect(bay.valid, bay.reason).toBe(true);
			expect(document.commit(bay)).toBe(true);
		}
		const physical = compilePhysicalRail(document.map);
		const context = createRailNetworkLinkAnchorContext(document.map, { x: 16, y: 6 }, () => false);
		const plan = planRailNetworkLink(document.map, context, { x: 16, y: 20 });
		expect(plan.valid).toBe(false);
		expect(plan.networkLink.outboundCells.length).toBeGreaterThan(2);
		expect(plan.networkLink.returnCells.length).toBeGreaterThan(2);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		const renderer = new TileRenderer();
		const overlay = createRecordingContext();

		renderer.render(createRecordingContext().context, overlay.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: { offsetX: 250, offsetY: 100, zoom: 16, rotation: 0 },
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: { x: 16, y: 20 },
			hoverWorld: { x: 16.5, y: 20.5 },
			anchorTile: { x: 16, y: 6 },
			anchorIntent: "network-link-source",
			anchorDirection: context.sourceForward,
			selectedTile: null,
			railPresentationMode: "profiled",
		});

		expect(overlay.labels).toEqual(
			expect.arrayContaining(["NO LINK · MAP UNCHANGED", "2 NO LINK", "1 SOURCE"]),
		);
		expect(overlay.labels).not.toContain("OUTBOUND");
		expect(overlay.labels).not.toContain("RETURN");
		expect(overlay.labels).not.toContain("B");
		expect(overlay.labels).not.toContain("M");
		expect(renderer.getStats().ghostPathCompiles).toBe(0);
	});

	it("keeps one-way flow visible at overview zoom while hiding construction hardware", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		renderer.render(staticContext.context, createRecordingContext().context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { ...TEST_CAMERA, zoom: 8 },
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			railPresentationMode: "profiled",
		});

		expect(staticContext.strokes).toContainEqual(expect.objectContaining({ style: "#f1c66f" }));
		expect(staticContext.strokes).not.toContainEqual(expect.objectContaining({ style: "#d7e5e6" }));
		expect(staticContext.strokes).not.toContainEqual(expect.objectContaining({ style: "#80979a" }));
	});

	it("reuses one presentation while paired beams rotate through every top-view orientation", () => {
		const screenPaths = installRecordingPath2D();
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 6, y: 0 }, { x: 6, y: 4 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();

		for (const rotation of [0, 1, 2, 3] as const) {
			renderer.render(staticContext.context, overlayContext.context, {
				map: document.map,
				physicalPaths: physical.paths,
				ghost: null,
				camera: { ...TEST_CAMERA, rotation },
				width: 960,
				height: 640,
				dpr: 1,
				hoverTile: null,
				hoverWorld: null,
				anchorTile: null,
				selectedTile: null,
				railPresentationMode: "profiled",
			});
		}

		expect(screenPaths).toHaveLength(12);
		expect(screenPaths.every((path) => path.commands.length > 0)).toBe(true);
		expect(renderer.getStats()).toMatchObject({
			staticRedraws: 4,
			overlayRedraws: 4,
			physicalPathBindings: 1,
			physicalPresentationBuilds: 1,
		});
	});

	it("draws paired beams and reuses metric presentation buffers across view-only redraws", () => {
		const screenPaths = installRecordingPath2D();
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();
		const baseInput = {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		} as const;

		renderer.render(staticContext.context, overlayContext.context, {
			...baseInput,
			camera: TEST_CAMERA,
			railPresentationMode: "profiled",
		});

		const expectedBeamWidth =
			OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE.beamWidthMeters * TEST_CAMERA.zoom;
		const beamFaceStrokes = staticContext.strokes.filter(
			(stroke) => stroke.style === "#8dc7cb" && Math.abs(stroke.width - expectedBeamWidth) < 0.001,
		);
		expect(beamFaceStrokes).toHaveLength(2);
		expect(screenPaths).toHaveLength(3);
		expect(renderer.getStats()).toMatchObject({
			staticRedraws: 1,
			overlayRedraws: 1,
			physicalPathBindings: 1,
			physicalPresentationBuilds: 1,
		});
		expect(renderer.getStats().physicalJointCount).toBeGreaterThanOrEqual(4);
		expect(renderer.getStats().physicalSupportCount).toBeGreaterThan(0);
		expect(renderer.getStats().physicalFlowMarkerCount).toBeGreaterThan(0);

		renderer.render(staticContext.context, overlayContext.context, {
			...baseInput,
			camera: { ...TEST_CAMERA, offsetX: TEST_CAMERA.offsetX + 18 },
			railPresentationMode: "profiled",
		});
		expect(screenPaths).toHaveLength(6);
		const strokesBeforeCenterline = staticContext.strokes.length;
		renderer.render(staticContext.context, overlayContext.context, {
			...baseInput,
			camera: { ...TEST_CAMERA, offsetX: TEST_CAMERA.offsetX + 18 },
			railPresentationMode: "centerline",
		});
		expect(screenPaths).toHaveLength(7);
		const centerlineStrokes = staticContext.strokes.slice(strokesBeforeCenterline);
		expect(centerlineStrokes).toContainEqual(expect.objectContaining({ style: "#f1c66f" }));
		for (const hardwareColor of ["#d7e5e6", "#80979a", "#b79a52"]) {
			expect(centerlineStrokes).not.toContainEqual(
				expect.objectContaining({ style: hardwareColor }),
			);
		}

		expect(renderer.getStats()).toMatchObject({
			staticRedraws: 3,
			overlayRedraws: 3,
			physicalPathBindings: 1,
			physicalPresentationBuilds: 1,
		});
	});
});

describe("advanced switch rendering", () => {
	it.each([
		"A",
		"B",
		"C",
		"D",
	] as const)("compiles class %s ghosts through the shared physical layout", (profileClass) => {
		const { plan } = createAdvancedSwitchFixture(profileClass);
		const preview = compileAdvancedSwitchPreviewLayout(plan);

		expect(preview).not.toBeNull();
		expect(preview?.advancedSwitches.count).toBe(1);
		expect(preview?.compoundProfiles.count).toBe(2);
		expect([...(preview?.paths.advancedSwitchIds ?? [])].filter((id) => id > 0)).toHaveLength(5);
	});

	it("keeps switch geometry visible when a footprint conflict makes the draft invalid", () => {
		const document = createOpenEastTerminal();
		const candidate = planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, "A");
		if (!candidate.switchRecord) throw new Error("expected a switch candidate");
		const blocker = deriveAdvancedSwitchGeometry(candidate.switchRecord)
			.secondaryInputPath[1] as Cell;
		document.map.setEncoded(
			blocker.x,
			blocker.y,
			encodeRailCell({ incoming: DIR_S, outgoing: DIR_E }),
		);
		const invalid = planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, "A");

		expect(invalid.valid).toBe(false);
		expect(invalid.conflicts).toContainEqual(blocker);
		const preview = compileAdvancedSwitchPreviewLayout(invalid);
		expect(preview?.advancedSwitches.count).toBe(1);
		expect([...(preview?.paths.advancedSwitchIds ?? [])].filter((id) => id > 0)).toHaveLength(5);

		const physical = compilePhysicalRail(document.map);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, invalid);
		const overlay = createRecordingContext();
		const renderer = new TileRenderer();
		renderer.render(createRecordingContext().context, overlay.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan: invalid, evaluation },
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});
		const finalLabel = overlay.operations.findLastIndex(
			(operation) => operation.type === "fillText",
		);
		const finalConflict = overlay.operations.findLastIndex(
			(operation) => operation.type === "stroke" && operation.style === "#ff6570",
		);
		expect(finalLabel).toBeGreaterThanOrEqual(0);
		expect(finalConflict).toBeGreaterThan(finalLabel);
		const uniqueConflictCount = new Set(
			evaluation.conflictCells.map((cell) => `${cell.x},${cell.y}`),
		).size;
		expect(
			overlay.operations
				.slice(finalLabel + 1)
				.filter((operation) => operation.type === "strokeRect" && operation.style === "#ff6570"),
		).toHaveLength(uniqueConflictCount);
		expect(renderer.getStats().ghostPresentationBuilds).toBe(1);
	});

	it("keeps an anchor-only invalid switch conflict above its handle and label", () => {
		const document = new RailDocument();
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: -2 }, "A");
		expect(plan.valid).toBe(false);
		expect(plan.switchRecord).toBeNull();
		const physical = compilePhysicalRail(document.map);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		const overlay = createRecordingContext();
		new TileRenderer().render(createRecordingContext().context, overlay.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});
		const finalLabel = overlay.operations.findLastIndex(
			(operation) => operation.type === "fillText",
		);
		const finalConflict = overlay.operations.findLastIndex(
			(operation) => operation.type === "stroke" && operation.style === "#ff6570",
		);
		expect(finalLabel).toBeGreaterThanOrEqual(0);
		expect(finalConflict).toBeGreaterThan(finalLabel);
	});

	it("resolves every owned cell to the complete switch footprint", () => {
		const { document, plan } = createAdvancedSwitchFixture("C");
		expect(document.commit(plan)).toBe(true);
		const record = document.map.getAdvancedSwitch(plan.switchRecord?.id ?? -1);
		if (!record) throw new Error("expected a committed advanced switch");
		const geometry = deriveAdvancedSwitchGeometry(record);
		const remoteOwnedCell = geometry.secondaryInputPath[1] as Cell;

		expect(advancedSwitchHighlightCells(document.map, remoteOwnedCell)).toEqual(
			geometry.claimedCells,
		);
		expect(advancedSwitchHighlightCells(document.map, { x: 90, y: 40 })).toEqual([
			{ x: 90, y: 40 },
		]);
	});

	it("keeps committed geometry cached while chirality ghosts change", () => {
		const document = createOpenEastTerminal();
		const physical = compilePhysicalRail(document.map);
		const leftPlan = planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, "A");
		const rightPlan = planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: 2 }, "A");
		expect(leftPlan.valid).toBe(true);
		expect(rightPlan.valid).toBe(true);

		const renderer = new TileRenderer();
		const evaluator = new RailDraftEvaluator();
		const leftEvaluation = evaluator.evaluate(document.map, physical, leftPlan);
		const rightEvaluation = evaluator.evaluate(document.map, physical, rightPlan);
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();
		const baseInput = {
			map: document.map,
			physicalPaths: physical.paths,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: { x: 2, y: 0 },
			selectedTile: null,
		} as const;

		renderer.render(staticContext.context, overlayContext.context, {
			...baseInput,
			ghost: { mode: "build", plan: leftPlan, evaluation: leftEvaluation },
		});
		renderer.render(staticContext.context, overlayContext.context, {
			...baseInput,
			ghost: { mode: "build", plan: rightPlan, evaluation: rightEvaluation },
		});

		expect(renderer.getStats()).toMatchObject({
			staticRedraws: 1,
			overlayRedraws: 2,
			ghostPathCompiles: 2,
			physicalPathBindings: 1,
		});
	});

	it("masks the committed footprint and marks released cells for a reshape ghost", () => {
		const { document, plan } = createAdvancedSwitchFixture("A");
		expect(document.commit(plan)).toBe(true);
		const record = document.map.getAdvancedSwitch(plan.switchRecord?.id ?? -1);
		if (!record) throw new Error("expected a committed advanced switch");
		const reshape = planAdvancedSwitchReshape(document.map, record.id, "C");
		expect(reshape.valid).toBe(true);

		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();
		const physical = compilePhysicalRail(document.map);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, reshape);
		renderer.render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan: reshape, evaluation },
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: record.origin,
		});

		const previousClaimCount = deriveAdvancedSwitchGeometry(record).claimedCells.length;
		const opaqueMaskFills = overlayContext.fillRectStyles.filter(
			(style) => style === "#0b1011" || style === "#0d1213",
		);
		expect(opaqueMaskFills.length).toBeGreaterThanOrEqual(previousClaimCount);
		expect(overlayContext.fillRectStyles).toContain("rgba(232, 89, 70, 0.16)");
	});

	it("draws a committed identity cue and four differentiated boundary ports", () => {
		const { document, plan } = createAdvancedSwitchFixture("D");
		expect(document.commit(plan)).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();

		renderer.render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(staticContext.labels).toContain(`SW-${plan.switchRecord?.id} · D`);
		expect(staticContext.rectCalls).toBeGreaterThanOrEqual(2);
		expect(staticContext.arcCalls).toBeGreaterThanOrEqual(2);
	});

	it("reuses a chunked switch index while panning across a large sparse map", () => {
		const map = new TileMap();
		for (let index = 0; index < 2_000; index++) {
			map.setAdvancedSwitch({
				id: index + 1,
				profileClass: "A",
				origin: { x: index * 64, y: 0 },
				forward: DIR_E,
				lateral: DIR_S,
				movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
			});
		}
		const emptyPaths = compilePhysicalRail(new TileMap()).paths;
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();
		const renderAt = (camera: Camera): void =>
			renderer.render(staticContext.context, overlayContext.context, {
				map,
				physicalPaths: emptyPaths,
				ghost: null,
				camera,
				width: 960,
				height: 640,
				dpr: 1,
				hoverTile: null,
				hoverWorld: null,
				anchorTile: null,
				selectedTile: null,
			});

		renderAt(TEST_CAMERA);
		expect(renderer.getStats()).toMatchObject({
			advancedSwitchIndexBuilds: 1,
			advancedSwitchCount: 2_000,
		});
		expect(renderer.getStats().visibleAdvancedSwitchCount).toBeLessThan(4);

		renderAt({ ...TEST_CAMERA, offsetX: 240 - 1_000 * 64 * TEST_CAMERA.zoom });
		expect(renderer.getStats().advancedSwitchIndexBuilds).toBe(1);
		expect(renderer.getStats().visibleAdvancedSwitchCount).toBeLessThan(4);
	}, 30_000);

	it("invalidates the static layer when a same-revision map instance is rebound", () => {
		const firstMap = new TileMap();
		const secondMap = new TileMap();
		firstMap.setAdvancedSwitch({
			id: 1,
			profileClass: "A",
			origin: { x: 0, y: 0 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		});
		secondMap.setAdvancedSwitch({
			id: 1,
			profileClass: "D",
			origin: { x: 0, y: 0 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		});
		const sharedPaths = compilePhysicalRail(new TileMap()).paths;
		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();
		const renderMap = (map: TileMap): void =>
			renderer.render(staticContext.context, overlayContext.context, {
				map,
				physicalPaths: sharedPaths,
				ghost: null,
				camera: TEST_CAMERA,
				width: 960,
				height: 640,
				dpr: 1,
				hoverTile: null,
				hoverWorld: null,
				anchorTile: null,
				selectedTile: null,
			});

		renderMap(firstMap);
		renderMap(secondMap);

		expect(renderer.getStats()).toMatchObject({
			staticRedraws: 2,
			advancedSwitchIndexBuilds: 2,
		});
		expect(staticContext.labels).toContain("SW-1 · A");
		expect(staticContext.labels).toContain("SW-1 · D");
	});
});

describe("draft clearance rendering", () => {
	it("separates template reservation cells, physical clearance, and terminal handles", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 20, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const plan = planRailTemplate(
			document.map,
			"branch-bypass",
			{ x: 0, y: 0 },
			{ forward: DIR_E, side: "right" },
			{
				templateId: "branch-bypass",
				trunkSpanMeters: 12,
				offsetMeters: 4,
				clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
			},
		);
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		expect(plan.valid, plan.reason).toBe(true);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		const overlay = createRecordingContext();

		new TileRenderer().render(createRecordingContext().context, overlay.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		const occupied = new Set(plan.template.occupiedCells.map((cell) => `${cell.x},${cell.y}`));
		const reservationOnly = plan.template.hardReservedCells.filter(
			(cell) => !occupied.has(`${cell.x},${cell.y}`),
		).length;
		expect(
			overlay.fillRectStyles.filter((style) => style === "rgba(221, 185, 91, 0.1)"),
		).toHaveLength(reservationOnly);
		expect(
			overlay.strokeRectStyles.filter((style) => style === "rgba(232, 198, 111, 0.46)"),
		).toHaveLength(reservationOnly + 1);
		expect(overlay.arcCalls).toBeGreaterThanOrEqual(plan.template.terminals.length);
		expect(overlay.labels).toContain(`RESERVED ${plan.template.hardReservedCells.length}`);
		expect(overlay.labels).toContain("ENTRY");
		expect(overlay.labels).toContain("EXIT");
		expect(overlay.strokes.some((stroke) => stroke.style === "rgba(59, 190, 202, 0.18)")).toBe(
			true,
		);
	});

	it("marks both the draft and committed cells of a proximity conflict", () => {
		const document = new RailDocument();
		expect(
			document.commit(
				planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 3 }, "horizontal-first"),
			),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const isolated = new TileMap();
		const isolatedPlan = planRailPath(isolated, [
			{ x: -1, y: 1 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
		]);
		const plan: RailConstructionPlan = {
			...isolatedPlan,
			baseRevision: document.map.getRevision(),
		};
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		expect(evaluation.issues.some((issue) => issue.source === "committed")).toBe(true);
		const overlay = createRecordingContext();

		new TileRenderer().render(createRecordingContext().context, overlay.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		const uniqueConflicts = new Set(evaluation.conflictCells.map((cell) => `${cell.x},${cell.y}`))
			.size;
		expect(
			overlay.fillRectStyles.filter((style) => style === "rgba(255, 69, 82, 0.22)"),
		).toHaveLength(uniqueConflicts);
	});

	it("keeps an invalid ghost above an overlapping selected-module outline", () => {
		const document = createOpenEastTerminal();
		const physical = compilePhysicalRail(document.map);
		const module = buildRailModuleOwnershipIndex(document.map).modules.find(
			(candidate) => candidate.kind === "straight",
		);
		if (!module) throw new Error("expected straight ownership");
		const plan = planRailConstruction(document.map, { x: 2, y: 0 }, { x: 0, y: 0 });
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		expect(evaluation.valid).toBe(false);
		const selectedCell = module.primaryCells[0] as Cell;
		const overlayContext = createRecordingContext();

		new TileRenderer().render(createRecordingContext().context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: selectedCell,
			hoverWorld: { x: selectedCell.x + 0.5, y: selectedCell.y + 0.5 },
			anchorTile: null,
			selectedTile: selectedCell,
			selectedModule: module,
		});

		const selectionOperation = overlayContext.operations.findIndex(
			(operation) => operation.type === "stroke" && operation.style === "#8de3ea",
		);
		const finalConflictOperation = overlayContext.operations.findLastIndex(
			(operation) => operation.type === "stroke" && operation.style === "#f06b72",
		);
		expect(selectionOperation).toBeGreaterThanOrEqual(0);
		expect(finalConflictOperation).toBeGreaterThan(selectionOperation);
	});

	it("draws the exact installation capsule width from the shared valid evaluation", () => {
		const document = createOpenEastTerminal();
		const physical = compilePhysicalRail(document.map);
		const plan = planRailConstruction(document.map, { x: 2, y: 0 }, { x: 5, y: 0 });
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		if (!evaluation.envelopes) throw new Error("expected draft clearance envelopes");

		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();
		renderer.render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: { x: 2, y: 0 },
			selectedTile: null,
		});

		const expectedWidth =
			(((evaluation.envelopes.installationRadiusMillimeters[0] as number) +
				(evaluation.envelopes.approximationToleranceMillimeters[0] as number)) /
				1_000) *
			2 *
			TEST_CAMERA.zoom;
		const corridorStroke = overlayContext.strokes.find(
			(stroke) => stroke.style === "rgba(59, 190, 202, 0.18)",
		);
		expect(corridorStroke).toBeDefined();
		expect(corridorStroke?.width).toBeCloseTo(expectedWidth);
		expect(corridorStroke).toMatchObject({ lineCap: "round", lineJoin: "round" });
	});

	it("draws a red capsule corridor when the shared evaluation rejects topology", () => {
		const document = createOpenEastTerminal();
		const physical = compilePhysicalRail(document.map);
		const plan = planRailConstruction(document.map, { x: 1, y: 0 }, { x: 1, y: 4 });
		const evaluation = new RailDraftEvaluator().evaluate(document.map, physical, plan);
		expect(evaluation.valid).toBe(false);
		expect(evaluation.envelopes?.count).toBeGreaterThan(0);

		const renderer = new TileRenderer();
		const staticContext = createRecordingContext();
		const overlayContext = createRecordingContext();
		renderer.render(staticContext.context, overlayContext.context, {
			map: document.map,
			physicalPaths: physical.paths,
			ghost: { mode: "build", plan, evaluation },
			camera: TEST_CAMERA,
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
		});

		expect(overlayContext.strokes).toContainEqual(
			expect.objectContaining({ style: "rgba(224, 76, 85, 0.16)" }),
		);
	});
});

const TEST_CAMERA: Camera = { offsetX: 240, offsetY: 260, zoom: 38, rotation: 0 };

function createOpenEastTerminal(): RailDocument {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 2, y: 0 }))).toBe(
		true,
	);
	return document;
}

function createAdvancedSwitchFixture(profileClass: "A" | "B" | "C" | "D"): {
	document: RailDocument;
	plan: AdvancedSwitchPlan;
} {
	const document = createOpenEastTerminal();
	const plan = planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, profileClass);
	expect(plan.valid).toBe(true);
	expect(plan.switchRecord).not.toBeNull();
	return { document, plan };
}

function createModuleRenderFixtures(): Array<{
	name: string;
	document: RailDocument;
	module: RailModuleOwnership;
}> {
	const fixtures: Array<{ name: string; document: RailDocument; module: RailModuleOwnership }> = [];
	const add = (
		name: string,
		document: RailDocument,
		predicate: (module: RailModuleOwnership) => boolean,
	): void => {
		const module = buildRailModuleOwnershipIndex(document.map).modules.find(predicate);
		if (!module) throw new Error(`expected ${name} ownership`);
		fixtures.push({ name, document, module });
	};

	const straight = new RailDocument();
	expect(straight.commit(planRailConstruction(straight.map, { x: 0, y: 0 }, { x: 5, y: 0 }))).toBe(
		true,
	);
	add("straight", straight, (module) => module.kind === "straight");

	const turn = new RailDocument();
	expect(turn.commit(planRailConstruction(turn.map, { x: 0, y: 0 }, { x: 3, y: 3 }))).toBe(true);
	add("turn", turn, (module) => module.kind === "turn");

	for (const kind of ["u-turn", "shift"] as const) {
		for (const span of ["compact", "wide"] as const) {
			const document = createOpenEastTerminal();
			const plan = planRailModule(document.map, { x: 2, y: 0 }, { x: 2, y: -3 }, kind, span);
			expect(plan.valid, `${kind}/${span}: ${plan.reason}`).toBe(true);
			expect(document.commit(plan)).toBe(true);
			add(
				`${kind}-${span}`,
				document,
				(module) => module.kind === kind && module.construction.span === span,
			);
		}
	}

	for (const movement of ["branch", "merge"] as const) {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 3, y: 0 })),
		).toBe(true);
		const plan =
			movement === "branch"
				? planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: -3 })
				: planRailConstruction(document.map, { x: 0, y: -3 }, { x: 0, y: 0 });
		expect(plan.valid, `${movement}: ${plan.reason}`).toBe(true);
		expect(document.commit(plan)).toBe(true);
		add(movement, document, (module) => module.kind === "turnout");
	}

	for (const profileClass of ["A", "B", "C", "D"] as const) {
		const { document, plan } = createAdvancedSwitchFixture(profileClass);
		expect(document.commit(plan)).toBe(true);
		add(
			`switch-${profileClass}`,
			document,
			(module) =>
				module.kind === "advanced-switch" &&
				module.construction.advancedSwitchProfile === profileClass,
		);
	}

	return fixtures;
}

function createRectangularAreaStampTemplate(
	widthMeters: number,
	heightMeters: number,
): RailAreaStampTemplate {
	const edges: RailAreaStampEdge[] = [];
	for (let x = 0; x < widthMeters; x++) {
		edges.push({ from: { x, y: 0 }, to: { x: x + 1, y: 0 } });
	}
	for (let y = 0; y < heightMeters; y++) {
		edges.push({
			from: { x: widthMeters, y },
			to: { x: widthMeters, y: y + 1 },
		});
	}
	for (let x = widthMeters; x > 0; x--) {
		edges.push({
			from: { x, y: heightMeters },
			to: { x: x - 1, y: heightMeters },
		});
	}
	for (let y = heightMeters; y > 0; y--) {
		edges.push({ from: { x: 0, y }, to: { x: 0, y: y - 1 } });
	}
	return Object.freeze({
		sourceRevision: 0,
		sourceModuleKeys: Object.freeze([]),
		sourceModuleCount: edges.length,
		sourceEdgeCount: edges.length,
		sourceWidthMeters: widthMeters,
		sourceHeightMeters: heightMeters,
		edges: Object.freeze(
			edges.map((edge) =>
				Object.freeze({
					from: Object.freeze({ ...edge.from }),
					to: Object.freeze({ ...edge.to }),
				}),
			),
		),
	});
}

function createOrganizationBundleGhostFixture(): Readonly<{
	map: TileMap;
	physicalPaths: ReturnType<typeof compilePhysicalRail>["paths"];
	bundle: StaticFabOrganizationBundle;
	plan: StaticFabOrganizationBundlePlacementPlan;
	evaluation: ReturnType<RailDraftEvaluator["evaluate"]>;
	camera: Camera;
}> {
	const source = new RailDocument();
	const sourceTemplate = planRailTemplate(
		source.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	expect(sourceTemplate.valid, sourceTemplate.reason).toBe(true);
	expect(source.commit(sourceTemplate)).toBe(true);
	const [firstRoute, secondRoute] = adjacentStraightRoutes(source);
	const ports = Object.freeze([
		organizationGhostPort(1, firstRoute),
		organizationGhostPort(2, secondRoute),
	]);
	const equipment: PortEquipmentState = Object.freeze({
		nextPortId: 3,
		nextEquipmentGroupId: 2,
		ports,
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "EQ" as const,
				pitchMillimeters: 1_000,
				recipe: "GHOST",
				portIds: Object.freeze([1, 2]),
			}),
		]),
	});
	const modules = buildRailModuleOwnershipIndex(source.map).modules;
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) {
			edges.set(`${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`, edge);
		}
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: 2,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "AREA" as const,
				name: "Ghost Factory",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "", color: "TEAL" as const }),
				membership: Object.freeze({
					railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
					advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
					equipmentGroupIds: Object.freeze([1]),
				}),
			}),
		]),
	});
	const capture = captureStaticFabOrganizationBundle(
		source.map,
		equipment,
		source.getPatchSequence(),
		organizations,
		[1],
		"DIRECT",
	);
	expect(capture.valid, capture.reason).toBe(true);
	if (!capture.valid) throw new Error(capture.reason);

	const target = new RailDocument();
	const plan = planStaticFabOrganizationBundlePlacement(
		target.map,
		emptyPortEquipmentState(),
		target.getPatchSequence(),
		emptyStaticFabOrganizationState(),
		capture.bundle,
		{ x: 0, y: 0 },
		0,
		null,
	);
	expect(plan.valid, plan.reason).toBe(true);
	const physical = compilePhysicalRail(target.map);
	const evaluation = new RailDraftEvaluator().evaluate(target.map, physical, plan);
	expect(evaluation.valid, evaluation.reason).toBe(true);
	const firstPort = plan.portMutations[0]?.after;
	if (!firstPort || firstPort.route.kind !== "CARDINAL_CELL") {
		throw new Error("Expected a cardinal organization-bundle port fixture.");
	}
	const zoom = 30;
	return Object.freeze({
		map: target.map,
		physicalPaths: physical.paths,
		bundle: capture.bundle,
		plan,
		evaluation,
		camera: Object.freeze({
			offsetX: 480 - (firstPort.route.x + 0.5) * zoom,
			offsetY: 320 - (firstPort.route.z + 0.5) * zoom,
			zoom,
			rotation: 0 as const,
		}),
	});
}

interface OrganizationGhostRouteCell {
	readonly x: number;
	readonly z: number;
	readonly from: Direction;
	readonly to: Direction;
}

function adjacentStraightRoutes(
	document: RailDocument,
): readonly [OrganizationGhostRouteCell, OrganizationGhostRouteCell] {
	const routes = new Map<string, OrganizationGhostRouteCell>();
	document.map.forEachRail((x, z, rail) => {
		if (
			rail.incoming === 0 ||
			rail.outgoing === 0 ||
			(rail.incoming & (rail.incoming - 1)) !== 0 ||
			(rail.outgoing & (rail.outgoing - 1)) !== 0 ||
			rail.outgoing !== oppositeDirection(rail.incoming as Direction)
		) {
			return;
		}
		const route = {
			x,
			z,
			from: rail.incoming as Direction,
			to: rail.outgoing as Direction,
		};
		routes.set(`${x}:${z}:${route.from}:${route.to}`, route);
	});
	for (const route of routes.values()) {
		const next = organizationGhostRouteNeighbor(route, route.to);
		const candidate = routes.get(`${next.x}:${next.z}:${route.from}:${route.to}`);
		if (candidate) return [route, candidate];
	}
	throw new Error("Expected adjacent straight routes in the Long Bay fixture.");
}

function organizationGhostRouteNeighbor(
	route: Pick<OrganizationGhostRouteCell, "x" | "z">,
	direction: Direction,
): Readonly<{ x: number; z: number }> {
	if (direction === DIR_E) return { x: route.x + 1, z: route.z };
	if (direction === DIR_S) return { x: route.x, z: route.z + 1 };
	if (direction === 1) return { x: route.x, z: route.z - 1 };
	return { x: route.x - 1, z: route.z };
}

function organizationGhostPort(id: number, route: OrganizationGhostRouteCell): PortRecord {
	return Object.freeze({
		id,
		equipmentGroupId: 1,
		route: Object.freeze({ kind: "CARDINAL_CELL", ...route }) satisfies CardinalPortRoute,
		stationMillimeters: 500,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "EQ",
		barcode: `EQ-${id}`,
	});
}

interface StaticFabOrganizationOutlineFixtureRow {
	readonly id: number;
	readonly role: StaticFabOrganizationOutlineRole;
	readonly bounds: StaticFabOrganizationOutlineBounds;
}

function createStaticFabOrganizationOutlineFixture(
	rows: readonly StaticFabOrganizationOutlineFixtureRow[],
): StaticFabOrganizationOutlineIndex {
	const rolePriority: Readonly<Record<StaticFabOrganizationOutlineRole, number>> = {
		FAB: 0,
		BAY_BANK: 1,
		BAY: 2,
	};
	const queryRows = (
		matches: (row: StaticFabOrganizationOutlineFixtureRow) => boolean,
		targetRows: Int32Array,
		pointOrder: boolean,
	): number => {
		const requiredRows = pointOrder
			? Math.min(rows.length, STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES)
			: rows.length;
		if (targetRows.length < requiredRows)
			throw new RangeError("outline fixture target is too small");
		const matchesRows: number[] = [];
		for (let index = 0; index < rows.length; index++) {
			const row = rows[index];
			if (row && matches(row)) matchesRows.push(index);
		}
		if (pointOrder) {
			let highestRole = -1;
			for (const row of matchesRows) {
				highestRole = Math.max(
					highestRole,
					rolePriority[(rows[row] as StaticFabOrganizationOutlineFixtureRow).role],
				);
			}
			for (let index = matchesRows.length - 1; index >= 0; index--) {
				const row = rows[matchesRows[index] as number] as StaticFabOrganizationOutlineFixtureRow;
				if (rolePriority[row.role] !== highestRole) matchesRows.splice(index, 1);
			}
			matchesRows.sort((left, right) => {
				const leftRow = rows[left] as StaticFabOrganizationOutlineFixtureRow;
				const rightRow = rows[right] as StaticFabOrganizationOutlineFixtureRow;
				const roleDifference = rolePriority[rightRow.role] - rolePriority[leftRow.role];
				if (roleDifference !== 0) return roleDifference;
				const leftArea =
					(leftRow.bounds.maxX - leftRow.bounds.minX) * (leftRow.bounds.maxZ - leftRow.bounds.minZ);
				const rightArea =
					(rightRow.bounds.maxX - rightRow.bounds.minX) *
					(rightRow.bounds.maxZ - rightRow.bounds.minZ);
				return leftArea - rightArea || leftRow.id - rightRow.id;
			});
			matchesRows.length = Math.min(
				matchesRows.length,
				STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES,
			);
		}
		targetRows.set(matchesRows);
		return matchesRows.length;
	};
	const artifact: StaticFabOrganizationOutlineIndex = {
		kind: "static-fab-organization-outline-index",
		version: 1,
		fingerprint: `fixture-${rows.length}`,
		sourceRevision: 1,
		sourceChecksum: "fixture",
		sourceSequence: 1,
		sourceNextAdvancedSwitchId: 1,
		sourceNextPortId: 1,
		sourceNextEquipmentGroupId: 1,
		sourceNextOrganizationId: rows.length + 1,
		sourcePhysicalSequence: 1,
		sourcePhysicalRevision: 1,
		sourcePhysicalFingerprint: "fixture",
		organizationCount: rows.length,
		indexedOrganizationCount: rows.length,
		bvhNodeCount: Math.max(0, rows.length * 2 - 1),
		byteLength: rows.length * 64,
		readOrganizationId: (row) => (rows[row] as StaticFabOrganizationOutlineFixtureRow).id,
		readOrganizationRole: (row) => (rows[row] as StaticFabOrganizationOutlineFixtureRow).role,
		readOrganizationBounds: (row, _scope, target) => {
			Object.assign(target, (rows[row] as StaticFabOrganizationOutlineFixtureRow).bounds);
			return true;
		},
		queryBounds: (bounds, targetRows) =>
			queryRows(
				(row) =>
					row.bounds.maxX >= bounds.minX &&
					row.bounds.minX <= bounds.maxX &&
					row.bounds.maxZ >= bounds.minZ &&
					row.bounds.minZ <= bounds.maxZ,
				targetRows,
				false,
			),
		queryPoint: (worldX, worldZ, targetRows) =>
			queryRows(
				(row) =>
					worldX >= row.bounds.minX &&
					worldX <= row.bounds.maxX &&
					worldZ >= row.bounds.minZ &&
					worldZ <= row.bounds.maxZ,
				targetRows,
				true,
			),
		hitTest: (worldX, worldZ) => {
			const targetRows = new Int32Array(rows.length);
			return artifact.queryPoint(worldX, worldZ, targetRows) > 0 ? (targetRows[0] as number) : -1;
		},
	};
	return Object.freeze(artifact);
}

function createRecordingContext(): {
	context: CanvasRenderingContext2D;
	labels: string[];
	labelStyles: string[];
	arcCalls: number;
	rectCalls: number;
	strokeRectCalls: number;
	strokeRectStyles: string[];
	fillRectStyles: string[];
	operations: Array<{ type: string; style: string }>;
	strokes: Array<{
		style: string;
		width: number;
		lineCap: string;
		lineJoin: string;
	}>;
} {
	const labels: string[] = [];
	const labelStyles: string[] = [];
	const fillRectStyles: string[] = [];
	const strokeRectStyles: string[] = [];
	const operations: Array<{ type: string; style: string }> = [];
	const strokes: Array<{
		style: string;
		width: number;
		lineCap: string;
		lineJoin: string;
	}> = [];
	const counters = { arcCalls: 0, rectCalls: 0, strokeRectCalls: 0 };
	const canvas = { width: 960, height: 640 };
	const target: Record<PropertyKey, unknown> = {
		canvas,
		measureText: (value: string) => ({ width: value.length * 6 }),
		fillText: (value: string) => {
			labels.push(value);
			labelStyles.push(String(target.fillStyle ?? ""));
			operations.push({ type: "fillText", style: String(target.fillStyle ?? "") });
		},
		arc: () => {
			counters.arcCalls++;
		},
		rect: () => {
			counters.rectCalls++;
		},
		strokeRect: () => {
			counters.strokeRectCalls++;
			strokeRectStyles.push(String(target.strokeStyle ?? ""));
			operations.push({ type: "strokeRect", style: String(target.strokeStyle ?? "") });
		},
		fillRect: () => {
			fillRectStyles.push(String(target.fillStyle ?? ""));
			operations.push({ type: "fillRect", style: String(target.fillStyle ?? "") });
		},
		stroke: () => {
			operations.push({ type: "stroke", style: String(target.strokeStyle ?? "") });
			strokes.push({
				style: String(target.strokeStyle ?? ""),
				width: Number(target.lineWidth ?? 1),
				lineCap: String(target.lineCap ?? "butt"),
				lineJoin: String(target.lineJoin ?? "miter"),
			});
		},
	};
	const noOp = (): void => undefined;
	const context = new Proxy(target, {
		get(source, property) {
			return property in source ? source[property] : noOp;
		},
		set(source, property, value) {
			source[property] = value;
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
	return {
		context,
		labels,
		labelStyles,
		fillRectStyles,
		operations,
		strokeRectStyles,
		strokes,
		get arcCalls() {
			return counters.arcCalls;
		},
		get rectCalls() {
			return counters.rectCalls;
		},
		get strokeRectCalls() {
			return counters.strokeRectCalls;
		},
	};
}

interface RecordingScreenPath {
	commands: Array<{ kind: "move" | "line"; x: number; y: number }>;
}

function installRecordingPath2D(): RecordingScreenPath[] {
	const paths: RecordingScreenPath[] = [];
	class RecordingPath2D {
		commands: RecordingScreenPath["commands"] = [];

		constructor() {
			paths.push(this);
		}

		moveTo(x: number, y: number): void {
			this.commands.push({ kind: "move", x, y });
		}

		lineTo(x: number, y: number): void {
			this.commands.push({ kind: "line", x, y });
		}
	}
	vi.stubGlobal("Path2D", RecordingPath2D);
	return paths;
}

function expectScreenPathsClose(
	actual: readonly RecordingScreenPath[],
	expected: readonly RecordingScreenPath[],
): void {
	expect(actual).toHaveLength(expected.length);
	for (let pathIndex = 0; pathIndex < actual.length; pathIndex++) {
		const actualCommands = actual[pathIndex]?.commands ?? [];
		const expectedCommands = expected[pathIndex]?.commands ?? [];
		expect(actualCommands).toHaveLength(expectedCommands.length);
		for (let commandIndex = 0; commandIndex < actualCommands.length; commandIndex++) {
			expect(actualCommands[commandIndex]?.kind).toBe(expectedCommands[commandIndex]?.kind);
			expect(actualCommands[commandIndex]?.x).toBeCloseTo(
				expectedCommands[commandIndex]?.x ?? Number.NaN,
				5,
			);
			expect(actualCommands[commandIndex]?.y).toBeCloseTo(
				expectedCommands[commandIndex]?.y ?? Number.NaN,
				5,
			);
		}
	}
}
