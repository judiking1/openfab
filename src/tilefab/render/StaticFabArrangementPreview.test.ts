import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import type { RailMutation } from "../core/paint";
import { DIR_E, DIR_S } from "../core/railShape";
import type {
	StaticFabArrangementRoot,
	StaticFabArrangementTranslation,
} from "../core/StaticFabArrangement";
import {
	STATIC_FAB_ARRANGEMENT_PLAN_KIND,
	STATIC_FAB_ARRANGEMENT_PLAN_VERSION,
	type StaticFabArrangementPlan,
} from "../core/StaticFabArrangementPlan";
import { TileMap } from "../core/TileMap";
import {
	createStaticFabArrangementPreviewArtifact,
	prepareStaticFabArrangementSelectionIdentity,
	prepareStaticFabArrangementTargetPreview,
	STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_EXACT_TARGET_CELLS,
	STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_REPORTED_CONFLICTS,
} from "./StaticFabArrangementPreview";
import { STATIC_FAB_ARRANGEMENT_PREVIEW_CELL_DETAIL_MIN_ZOOM, TileRenderer } from "./TileRenderer";

describe("StaticFabArrangementPreview", () => {
	it("translates complete source footprints instead of mutation-only deltas", () => {
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		const target = prepareStaticFabArrangementTargetPreview(
			[
				{
					key: "root:a",
					ownerships: [
						{
							footprintCells: [
								{ x: 0, y: 0 },
								{ x: 1, y: 0 },
							],
						},
						{
							footprintCells: [
								{ x: 1, y: 0 },
								{ x: 2, y: 0 },
							],
						},
					],
				},
				{
					key: "root:b",
					ownerships: [
						{
							footprintCells: [
								{ x: 20, y: 0 },
								{ x: 21, y: 0 },
							],
						},
					],
				},
			],
			translations,
		);

		expect(target.omitted).toBe(false);
		expect(target.cells).toEqual([
			{ x: 32, y: 0 },
			{ x: 33, y: 0 },
			{ x: 34, y: 0 },
			{ x: 20, y: 0 },
			{ x: 21, y: 0 },
		]);
	});

	it("copies planning roots and translations into an immutable bounds-only artifact", () => {
		const sourceBounds = { minX: 0, minZ: 0, maxXExclusive: 4, maxZExclusive: 3 };
		const targetBounds = { minX: 8, minZ: 0, maxXExclusive: 12, maxZExclusive: 3 };
		const roots = [
			{ key: "root:a", bounds: sourceBounds },
			{
				key: "root:b",
				bounds: { minX: 20, minZ: 0, maxXExclusive: 24, maxZExclusive: 3 },
			},
		] satisfies StaticFabArrangementRoot[];
		const translations = [
			{
				key: "root:a",
				deltaX: 8,
				deltaZ: 0,
				before: sourceBounds,
				after: targetBounds,
			},
			{
				key: "root:b",
				deltaX: 0,
				deltaZ: 0,
				before: roots[1].bounds,
				after: roots[1].bounds,
			},
		] satisfies StaticFabArrangementTranslation[];

		const artifact = createStaticFabArrangementPreviewArtifact({
			phase: "planning",
			roots,
			translations,
		});
		sourceBounds.minX = -100;
		targetBounds.maxXExclusive = 100;

		expect(artifact.phase).toBe("planning");
		expect(artifact.rootCount).toBe(2);
		expect(artifact.roots[0]).toMatchObject({
			key: "root:a",
			deltaX: 8,
			deltaZ: 0,
			sourceBounds: { minX: 0, minZ: 0, maxXExclusive: 4, maxZExclusive: 3 },
			targetBounds: { minX: 8, minZ: 0, maxXExclusive: 12, maxZExclusive: 3 },
		});
		expect(Object.isFrozen(artifact)).toBe(true);
		expect(Object.isFrozen(artifact.roots)).toBe(true);
		expect(Object.isFrozen(artifact.roots[0])).toBe(true);
		expect(artifact.hasExactTargetCells).toBe(false);
		expect(artifact.targetCellCount).toBe(0);
		expect(artifact.chunkCount).toBe(0);
	});

	it("uses the complete caller-prepared target footprint, including advanced-switch claims", () => {
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		const switchAfter: AdvancedSwitchRecord = {
			id: 7,
			profileClass: "A",
			origin: { x: 32, y: 0 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		};
		const claimed = deriveAdvancedSwitchGeometry(switchAfter).claimedCells;
		const firstClaim = claimed[0];
		expect(firstClaim).toBeDefined();
		if (!firstClaim) return;
		const plan = validPlan(
			translations,
			[
				{ x: 0, y: 0, before: 3, after: 0 },
				{ x: firstClaim.x, y: firstClaim.y, before: 0, after: 3 },
			],
			[{ id: switchAfter.id, before: null, after: switchAfter }],
		);

		const artifact = createStaticFabArrangementPreviewArtifact({
			phase: "certified",
			roots,
			plan,
			exactTargetCells: claimed,
		});

		expect(artifact.hasExactTargetCells).toBe(true);
		expect(artifact.targetCellCount).toBe(claimed.length);
		expect(artifact.roots[0]?.targetBounds).toEqual(translations[0]?.after);
		const claimedKeys = new Set(claimed.map((cell) => `${cell.x}:${cell.y}`));
		const artifactKeys = new Set<string>();
		for (const chunk of artifact.chunks) {
			for (
				let index = chunk.targetCellStart;
				index < chunk.targetCellStart + chunk.targetCellCount;
				index++
			) {
				artifactKeys.add(`${artifact.targetCellX(index)}:${artifact.targetCellZ(index)}`);
			}
			expect(artifact.readChunk(chunk.chunkX, chunk.chunkZ)).toBe(chunk);
		}
		expect(artifactKeys).toEqual(claimedKeys);
		expect(() => artifact.targetCellX(artifact.targetCellCount)).toThrow(RangeError);
	});

	it("translates exact port points and oriented equipment body sections with their rail root", () => {
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		const target = prepareStaticFabArrangementTargetPreview(
			[
				{
					key: "root:a",
					ownerships: [{ footprintCells: [{ x: 0, y: 0 }] }],
					equipmentGroupIds: [11],
				},
				{
					key: "root:b",
					ownerships: [{ footprintCells: [{ x: 20, y: 0 }] }],
					equipmentGroupIds: [],
				},
			],
			translations,
			{
				groupIds: Int32Array.of(11),
				groupPortOffsets: Uint32Array.of(0, 2),
				groupPortRows: Uint32Array.of(0, 1),
				worldPositions: Float32Array.of(0.5, 1.5, 2.5, 1.5),
				groupBodySectionOffsets: Uint32Array.of(0, 1),
				bodySectionCenters: Float32Array.of(1.5, 2),
				bodySectionTangents: Float32Array.of(1, 0),
				bodySectionHalfExtents: Float32Array.of(1.2, 0.8),
				bodySectionBounds: Float32Array.of(0.3, 1.2, 2.7, 2.8),
			},
		);

		expect(target.ports).toEqual([
			{ x: 32.5, z: 1.5 },
			{ x: 34.5, z: 1.5 },
		]);
		expect(target.equipmentSections[0]).toMatchObject({
			centerX: 33.5,
			centerZ: 2,
			tangentX: 1,
			tangentZ: 0,
			halfLength: expect.closeTo(1.2),
			halfWidth: expect.closeTo(0.8),
			minX: expect.closeTo(32.3),
			maxX: expect.closeTo(34.7),
		});

		const artifact = createStaticFabArrangementPreviewArtifact({
			phase: "certified",
			roots,
			plan: validPlan(translations, [], []),
			exactTargetCells: target.cells,
			targetPorts: target.ports,
			targetEquipmentSections: target.equipmentSections,
		});
		expect(artifact.targetPortCount).toBe(2);
		expect(artifact.targetEquipmentSectionCount).toBe(1);
		expect(artifact.presentationChunkCount).toBe(1);
		const presentationChunk = artifact.readPresentationChunk(2, 0);
		expect(presentationChunk).toMatchObject({
			portIndexCount: 2,
			equipmentSectionIndexCount: 1,
		});
		expect(artifact.presentationPortIndex(presentationChunk?.portIndexStart ?? Number.NaN)).toBe(0);
		expect(
			artifact.presentationEquipmentSectionIndex(
				presentationChunk?.equipmentSectionIndexStart ?? Number.NaN,
			),
		).toBe(0);
		expect(artifact.targetPortX(1)).toBe(34.5);
		expect(artifact.targetEquipmentSectionCenterX(0)).toBe(33.5);
		expect(() => artifact.targetPortX(2)).toThrow(RangeError);
	});

	it("falls back to root bounds before processing an oversized exact target", () => {
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		const exactTargetCells = Array.from(
			{ length: STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_EXACT_TARGET_CELLS + 1 },
			(_, index) => ({ x: index, y: 0 }),
		);
		const artifact = createStaticFabArrangementPreviewArtifact({
			phase: "certified",
			roots,
			plan: validPlan(translations, [], []),
			exactTargetCells,
		});

		expect(artifact.hasExactTargetCells).toBe(false);
		expect(artifact.targetCellsOmitted).toBe(true);
		expect(artifact.targetCellCount).toBe(0);
		expect(artifact.chunkCount).toBe(0);
	});

	it("retains large-selection identity when exact-cell rendering falls back to bounds", () => {
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		const sourceCells = Array.from(
			{ length: STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_EXACT_TARGET_CELLS + 1 },
			(_, index) => ({ x: index, y: 0 }),
		);
		const footprintRoots = [
			{ key: "root:a", ownerships: [{ footprintCells: sourceCells }] },
			{ key: "root:b", ownerships: [] },
		];
		const target = prepareStaticFabArrangementTargetPreview(footprintRoots, translations);
		const identity = prepareStaticFabArrangementSelectionIdentity(footprintRoots, translations);

		expect(target.omitted).toBe(true);
		expect(target.cells).toBeUndefined();
		expect(identity?.cellCount).toBe(sourceCells.length);
		expect(identity?.has(translations[0]?.deltaX ?? Number.NaN, 0)).toBe(true);
		expect(identity?.has((translations[0]?.deltaX ?? 0) - 1, 0)).toBe(false);
	});

	it("deduplicates signed coordinates in the packed apply-only selection identity", () => {
		const roots = [
			{
				key: "root:negative",
				ownerships: [
					{
						footprintCells: [
							{ x: -2, y: -3 },
							{ x: -2, y: -3 },
							{ x: 0, y: 0 },
						],
					},
				],
			},
			{ key: "root:empty", ownerships: [] },
		];
		const bounds = { minX: -10, minZ: -10, maxXExclusive: 1, maxZExclusive: 1 };
		const identity = prepareStaticFabArrangementSelectionIdentity(roots, [
			{
				key: "root:negative",
				deltaX: -4,
				deltaZ: 2,
				before: bounds,
				after: { minX: -14, minZ: -8, maxXExclusive: -3, maxZExclusive: 3 },
			},
			{ key: "root:empty", deltaX: 0, deltaZ: 0, before: bounds, after: bounds },
		]);

		expect(identity?.cellCount).toBe(2);
		expect(identity?.has(-6, -1)).toBe(true);
		expect(identity?.has(-4, 2)).toBe(true);
		expect(identity?.has(-6, 1)).toBe(false);
	});

	it("deduplicates and bounds rejected conflicts while retaining the total count", () => {
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		const conflicts = Array.from(
			{ length: STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_REPORTED_CONFLICTS + 25 },
			(_, index) => ({ x: index - 70, y: index % 3 }),
		);
		const plan = rejectedPlan([...conflicts, conflicts[0] as (typeof conflicts)[number]]);

		const artifact = createStaticFabArrangementPreviewArtifact({
			phase: "rejected",
			roots,
			translations,
			plan,
			conflicts: [conflicts[1] as (typeof conflicts)[number]],
		});

		expect(artifact.hasExactTargetCells).toBe(false);
		expect(artifact.totalConflictCount).toBe(conflicts.length);
		expect(artifact.reportedConflictCount).toBe(
			STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_REPORTED_CONFLICTS,
		);
		expect(artifact.conflictsTruncated).toBe(true);
		expect(artifact.chunks.reduce((total, chunk) => total + chunk.conflictCount, 0)).toBe(
			STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_REPORTED_CONFLICTS,
		);
	});

	it("rejects false certification and partial or inconsistent translations", () => {
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		expect(() =>
			createStaticFabArrangementPreviewArtifact({
				phase: "certified",
				roots,
				plan: rejectedPlan([]),
			}),
		).toThrow(/valid exact plan/);
		expect(() =>
			createStaticFabArrangementPreviewArtifact({
				phase: "planning",
				roots,
				translations: translations.slice(0, 1),
			}),
		).toThrow(/cover every root/);
		expect(() =>
			createStaticFabArrangementPreviewArtifact({
				phase: "planning",
				roots,
				translations: [
					{ ...translations[0], after: { ...translations[0]?.after, minX: 99 } },
					translations[1],
				] as StaticFabArrangementTranslation[],
			}),
		).toThrow(/inconsistent/);
		expect(() =>
			createStaticFabArrangementPreviewArtifact({
				phase: "certified",
				roots,
				plan: validPlan(translations, [], []),
				translations: translations.map((translation, index) =>
					index === 0
						? {
								...translation,
								deltaX: translation.deltaX + 1,
								after: {
									...translation.after,
									minX: translation.after.minX + 1,
									maxXExclusive: translation.after.maxXExclusive + 1,
								},
							}
						: translation,
				),
			}),
		).toThrow(/diverge/);
	});

	it("renders bounds at overview LOD and exact cells only at detail LOD without static redraws", () => {
		const map = new TileMap();
		const physicalPaths = compilePhysicalRail(map).paths;
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		const planning = createStaticFabArrangementPreviewArtifact({
			phase: "planning",
			roots,
			translations,
		});
		const certified = createStaticFabArrangementPreviewArtifact({
			phase: "certified",
			roots,
			plan: validPlan(
				translations,
				[
					{ x: 0, y: 0, before: 3, after: 0 },
					{ x: 32, y: 0, before: 0, after: 3 },
				],
				[],
			),
			exactTargetCells: [{ x: 32, y: 0 }],
			targetPorts: [{ x: 32.5, z: 0.5 }],
			targetEquipmentSections: [
				{
					centerX: 33,
					centerZ: 1.5,
					tangentX: 1,
					tangentZ: 0,
					halfLength: 1,
					halfWidth: 0.5,
					minX: 32,
					minZ: 1,
					maxX: 34,
					maxZ: 2,
				},
			],
		});
		const renderer = new TileRenderer();
		const staticContext = recordingContext();
		const overviewOverlay = recordingContext();
		const input = {
			map,
			physicalPaths,
			ghost: null,
			camera: { offsetX: 120, offsetY: 120, zoom: 4, rotation: 0 as const },
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			staticFabArrangementPreview: planning,
		};

		renderer.render(staticContext.context, overviewOverlay.context, input);
		const firstStats = renderer.getStats();
		expect(firstStats.staticFabArrangementPreviewVisibleRoots).toBe(2);
		expect(firstStats.staticFabArrangementPreviewVisibleTargetCells).toBe(0);
		expect(overviewOverlay.strokeRectStyles).toContain("#e3bd58");
		expect(overviewOverlay.strokeRectStyles).toContain("#65d9e2");
		const detailCamera = {
			...input.camera,
			zoom: STATIC_FAB_ARRANGEMENT_PREVIEW_CELL_DETAIL_MIN_ZOOM,
		};
		renderer.render(staticContext.context, recordingContext().context, {
			...input,
			camera: detailCamera,
		});
		const staticRedraws = renderer.getStats().staticRedraws;

		const detailOverlay = recordingContext();
		renderer.render(staticContext.context, detailOverlay.context, {
			...input,
			camera: detailCamera,
			staticFabArrangementPreview: certified,
		});
		expect(renderer.getStats()).toMatchObject({
			staticRedraws,
			staticFabArrangementPreviewArtifactBindings: 2,
			staticFabArrangementPreviewVisibleTargetCells: 1,
			staticFabArrangementPreviewVisiblePorts: 1,
			staticFabArrangementPreviewVisibleEquipmentSections: 1,
		});
		expect(detailOverlay.fillRectStyles).toContain("rgba(227, 189, 88, 0.12)");
	});

	it("renders rejected targets and bounded conflicts in red", () => {
		const map = new TileMap();
		const roots = arrangementRoots();
		const translations = arrangementTranslations(roots);
		const rejected = createStaticFabArrangementPreviewArtifact({
			phase: "rejected",
			roots,
			translations,
			plan: rejectedPlan([{ x: 32, y: 0 }]),
		});
		const renderer = new TileRenderer();
		const overlay = recordingContext();
		renderer.render(recordingContext().context, overlay.context, {
			map,
			physicalPaths: compilePhysicalRail(map).paths,
			ghost: null,
			camera: { offsetX: 120, offsetY: 120, zoom: 12, rotation: 0 },
			width: 960,
			height: 640,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			staticFabArrangementPreview: rejected,
		});

		expect(overlay.strokeRectStyles).toContain("#f06b72");
		expect(renderer.getStats().staticFabArrangementPreviewVisibleConflicts).toBe(1);
	});
});

function arrangementRoots(): readonly StaticFabArrangementRoot[] {
	return Object.freeze([
		Object.freeze({
			key: "root:a",
			bounds: Object.freeze({ minX: 0, minZ: 0, maxXExclusive: 4, maxZExclusive: 4 }),
		}),
		Object.freeze({
			key: "root:b",
			bounds: Object.freeze({ minX: 20, minZ: 0, maxXExclusive: 24, maxZExclusive: 4 }),
		}),
	]);
}

function arrangementTranslations(
	roots: readonly StaticFabArrangementRoot[],
): readonly StaticFabArrangementTranslation[] {
	return Object.freeze([
		Object.freeze({
			key: roots[0]?.key ?? "root:a",
			deltaX: 32,
			deltaZ: 0,
			before: roots[0]?.bounds as StaticFabArrangementRoot["bounds"],
			after: Object.freeze({ minX: 32, minZ: 0, maxXExclusive: 36, maxZExclusive: 4 }),
		}),
		Object.freeze({
			key: roots[1]?.key ?? "root:b",
			deltaX: 0,
			deltaZ: 0,
			before: roots[1]?.bounds as StaticFabArrangementRoot["bounds"],
			after: roots[1]?.bounds as StaticFabArrangementRoot["bounds"],
		}),
	]);
}

function validPlan(
	translations: readonly StaticFabArrangementTranslation[],
	mutations: readonly RailMutation[],
	switchMutations: readonly AdvancedSwitchMutation[],
): StaticFabArrangementPlan {
	return Object.freeze({
		kind: STATIC_FAB_ARRANGEMENT_PLAN_KIND,
		baseRevision: 0,
		basePatchSequence: 0,
		valid: true,
		reason: "certified fixture",
		issueCode: null,
		cells: Object.freeze([]),
		conflicts: Object.freeze([]),
		mutations: Object.freeze([...mutations]),
		switchMutations: Object.freeze([...switchMutations]),
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		organizationImpactAuthorizations: Object.freeze([]),
		nextOrganizationIdBefore: 1,
		nextOrganizationIdAfter: 1,
		arrangement: Object.freeze({
			version: STATIC_FAB_ARRANGEMENT_PLAN_VERSION,
			axis: "X",
			mode: "ALIGN_MIN",
			translations,
			maximumSnapErrorMeters: 0,
			rootCount: translations.length,
			moduleCount: 2,
			railEdgeCount: mutations.length,
			advancedSwitchCount: switchMutations.length,
			portCount: 0,
			equipmentGroupCount: 0,
			affectedOrganizationIds: Object.freeze([]),
		}),
	});
}

function rejectedPlan(conflicts: readonly { readonly x: number; readonly y: number }[]) {
	return Object.freeze({
		kind: STATIC_FAB_ARRANGEMENT_PLAN_KIND,
		baseRevision: 0,
		basePatchSequence: 0,
		valid: false,
		reason: "rejected fixture",
		issueCode: "TARGET_COLLISION" as const,
		cells: Object.freeze([]),
		conflicts: Object.freeze([...conflicts]),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		organizationImpactAuthorizations: Object.freeze([]),
		nextOrganizationIdBefore: 1,
		nextOrganizationIdAfter: 1,
		arrangement: null,
	}) satisfies StaticFabArrangementPlan;
}

function recordingContext(): {
	readonly context: CanvasRenderingContext2D;
	readonly fillRectStyles: readonly string[];
	readonly strokeRectStyles: readonly string[];
} {
	const fillRectStyles: string[] = [];
	const strokeRectStyles: string[] = [];
	const target: Record<PropertyKey, unknown> = {
		canvas: { width: 960, height: 640 },
		measureText: (value: string) => ({ width: value.length * 6 }),
		fillRect: () => fillRectStyles.push(String(target.fillStyle ?? "")),
		strokeRect: () => strokeRectStyles.push(String(target.strokeStyle ?? "")),
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
	return { context, fillRectStyles, strokeRectStyles };
}
