import { describe, expect, it } from "vitest";
import { analyzeRailNetwork } from "../core/network";
import { createRailAreaSelection, type RailAreaSelection } from "../core/RailAreaSelection";
import {
	createRailAreaStampTemplate,
	initialRailAreaStampPose,
	planRailAreaStamp,
	RAIL_AREA_STAMP_MAX_EDGES,
	rotateRailAreaStampPose,
} from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { TileMap } from "../core/TileMap";
import {
	createOpenFabRailAreaBlueprint,
	OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
} from "../project/OpenFabBlueprintLibrary";
import { captureOpenFabProject, createOpenFabProjectManifest } from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { prepareBlueprintPlacement } from "../worker/BlueprintPlacementRuntime";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	applyStaticFabProcessRowPairingAlternative,
	compileStaticFabHierarchyCandidateOwnershipIndex,
	compileStaticFabHierarchyIndex,
	deriveStaticFabHierarchy,
	resolveStaticFabProcessRowPairing,
	type StaticFabHierarchyBranch,
	type StaticFabProcessRowTopologyEvidence,
	selectStaticFabHierarchyAxis,
	staticFabProcessRowTopologyHopLimit,
} from "./StaticFabHierarchy";
import { createSyntheticFabAssemblyPlan } from "./SyntheticFabAssemblyPlan";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
} from "./SyntheticFabStarter";

const LARGE_FAB_BUILD = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
const LARGE_FAB_INDEX = buildRailModuleOwnershipIndex(LARGE_FAB_BUILD.document.map);
const LARGE_FAB_BUILDS = new Map<number, ReturnType<typeof buildSyntheticFabStarter>>([
	[60, LARGE_FAB_BUILD],
]);

describe("StaticFabHierarchy", () => {
	it("pairs Process rows only from one complete same-side topology phase", () => {
		const pairing = resolveStaticFabProcessRowPairing(6, [
			rowTopologyEvidence(0, 1, 25, 30),
			rowTopologyEvidence(1, 2, 25, 25),
			rowTopologyEvidence(2, 3, 30, 30),
			rowTopologyEvidence(3, 4, 25, 25),
			rowTopologyEvidence(4, 5, 30, 25),
		]);

		expect(pairing).toMatchObject({
			state: "resolved",
			pairs: [
				[0, 1],
				[2, 3],
				[4, 5],
			],
			totalHopCount: 170,
		});
	});

	it("preserves symmetric 4-Row alternatives without fabricating canonical Bank pairs", () => {
		const pairing = resolveStaticFabProcessRowPairing(4, [
			rowTopologyEvidence(0, 1, 10, 10),
			rowTopologyEvidence(1, 2, 10, 10),
			rowTopologyEvidence(2, 3, 10, 10),
			rowTopologyEvidence(3, 0, 10, 10),
		]);

		expect(pairing).toEqual({
			state: "ambiguous",
			pairs: [],
			alternatives: [
				{
					pairs: [
						[0, 1],
						[2, 3],
					],
					totalHopCount: 40,
				},
				{
					pairs: [
						[0, 3],
						[1, 2],
					],
					totalHopCount: 40,
				},
			],
			reason: "2 complete Row pairing phases have topology evidence",
		});
	});

	it("materializes exactly one revision-bound pairing alternative into canonical Banks and Blocks", () => {
		const compiled = compileStaticFabHierarchyIndex(LARGE_FAB_BUILD.document.map, LARGE_FAB_INDEX);
		const branch = compiled.branches[0];
		if (!branch) throw new Error("expected generated Factory hierarchy");
		const pairing = resolveStaticFabProcessRowPairing(4, [
			rowTopologyEvidence(0, 1, 10, 10),
			rowTopologyEvidence(1, 2, 10, 10),
			rowTopologyEvidence(2, 3, 10, 10),
			rowTopologyEvidence(3, 0, 10, 10),
		]);
		if (pairing.state !== "ambiguous") throw new Error("expected ambiguous pairing");
		const ambiguous = Object.freeze({
			revision: compiled.revision,
			branches: Object.freeze([
				Object.freeze({
					factory: branch.factory,
					wings: Object.freeze(branch.wings.slice(0, 8)),
					processRows: Object.freeze(branch.processRows.slice(0, 4)),
					processRowPairing: pairing,
					processBanks: Object.freeze([]),
					processBlocks: Object.freeze([]),
				}),
			]),
		});

		const selected = applyStaticFabProcessRowPairingAlternative(
			ambiguous,
			LARGE_FAB_INDEX,
			branch.factory.key,
			1,
		);
		const selectedBranch = selected.branches[0];
		if (!selectedBranch) throw new Error("expected selected hierarchy branch");

		expect(selectedBranch.processRowPairing).toMatchObject({
			state: "resolved",
			pairs: [
				[0, 3],
				[1, 2],
			],
		});
		expect(selectedBranch.processBanks).toHaveLength(4);
		expect(selectedBranch.processBlocks).toHaveLength(2);
		expect(
			new Set(selectedBranch.processBlocks[0]?.selection.ownerships.map(({ key }) => key)),
		).toEqual(
			new Set(
				[branch.processRows[0], branch.processRows[3]].flatMap(
					(row) => row?.selection.ownerships.map(({ key }) => key) ?? [],
				),
			),
		);
		expect(branch.processBanks).toHaveLength(6);
		expect(branch.processBlocks).toHaveLength(3);
	});

	it("prefers topology confidence over competing-axis geometry counts", () => {
		const resolved = {
			processRowPairingState: "resolved",
			wingCount: 8,
			processRowCount: 4,
		} as const;
		const ambiguous = {
			processRowPairingState: "ambiguous",
			wingCount: 120,
			processRowCount: 60,
		} as const;
		const none = {
			processRowPairingState: "none",
			wingCount: 200,
			processRowCount: 100,
		} as const;

		expect(selectStaticFabHierarchyAxis(ambiguous, resolved)).toBe("vertical");
		expect(selectStaticFabHierarchyAxis(resolved, ambiguous)).toBe("horizontal");
		expect(selectStaticFabHierarchyAxis(none, ambiguous)).toBe("vertical");
		expect(selectStaticFabHierarchyAxis(ambiguous, none)).toBe("horizontal");
	});

	it("scales the local topology budget from authored Row pitch instead of a fixed 64-hop cap", () => {
		const compact = staticFabProcessRowTopologyHopLimit(
			[
				{ minX: 0, minY: 0, maxX: 20, maxY: 10 },
				{ minX: 0, minY: 20, maxX: 20, maxY: 30 },
			],
			"horizontal",
		);
		const expanded = staticFabProcessRowTopologyHopLimit(
			[
				{ minX: 0, minY: 0, maxX: 20, maxY: 10 },
				{ minX: 0, minY: 120, maxX: 20, maxY: 130 },
			],
			"horizontal",
		);

		expect(compact).toBe(56);
		expect(expanded).toBe(256);
		expect(expanded).toBeGreaterThan(64);
	});

	it("uses geometry only after equal topology confidence and breaks exact ties horizontally", () => {
		const smaller = {
			processRowPairingState: "resolved",
			wingCount: 8,
			processRowCount: 4,
		} as const;
		const larger = {
			processRowPairingState: "resolved",
			wingCount: 12,
			processRowCount: 6,
		} as const;

		expect(selectStaticFabHierarchyAxis(smaller, larger)).toBe("vertical");
		expect(selectStaticFabHierarchyAxis(larger, smaller)).toBe("horizontal");
		expect(selectStaticFabHierarchyAxis(smaller, smaller)).toBe("horizontal");
	});

	it("ignores distractor Wing links outside the two wall-adjacent pairing phases", () => {
		const pairing = resolveStaticFabProcessRowPairing(6, [
			rowTopologyEvidence(0, 1, 25, 30),
			rowTopologyEvidence(2, 3, 30, 30),
			rowTopologyEvidence(4, 5, 30, 25),
			rowTopologyEvidence(0, 2, 1, 1),
			rowTopologyEvidence(1, 3, 1, 1),
			rowTopologyEvidence(2, 4, 1, 1),
		]);

		expect(pairing).toMatchObject({
			state: "resolved",
			pairs: [
				[0, 1],
				[2, 3],
				[4, 5],
			],
		});
	});

	it("does not pair geometry-adjacent Rows when same-side topology evidence is incomplete", () => {
		const pairing = resolveStaticFabProcessRowPairing(4, [
			rowTopologyEvidence(0, 1, 4, 4),
			rowTopologyEvidence(1, 2, 4, 4),
		]);

		expect(pairing).toEqual({
			state: "none",
			pairs: [],
			reason: "No complete same-side circulation pairing exists",
		});
	});

	it("derives resolved Wing, row, bank, block, and Factory scopes from authored geometry", () => {
		const build = LARGE_FAB_BUILD;
		const index = LARGE_FAB_INDEX;
		const focus = createRailAreaSelection(index, { x: -120, y: -10 }, { x: -100, y: 10 });

		const hierarchy = deriveStaticFabHierarchy(build.document.map, index, focus);

		expect(hierarchy.wing.state).toBe("resolved");
		expect(hierarchy.processRow.state).toBe("resolved");
		expect(hierarchy.processRowPairing).toMatchObject({
			state: "resolved",
			pairs: [
				[0, 1],
				[2, 3],
				[4, 5],
			],
		});
		expect(hierarchy.processBank.state).toBe("resolved");
		expect(hierarchy.processBlock.state).toBe("resolved");
		expect(hierarchy.factory.state).toBe("resolved");
		if (
			hierarchy.wing.state !== "resolved" ||
			hierarchy.processRow.state !== "resolved" ||
			hierarchy.processBank.state !== "resolved" ||
			hierarchy.processBlock.state !== "resolved" ||
			hierarchy.factory.state !== "resolved"
		) {
			throw new Error("expected resolved hierarchy");
		}
		expect(hierarchy.wing.node.selection.ownerships.length).toBeGreaterThan(
			focus.ownerships.length,
		);
		expect(hierarchy.processRow.node.selection.ownerships.length).toBeGreaterThan(
			hierarchy.wing.node.selection.ownerships.length,
		);
		expect(hierarchy.processBank.node.selection.ownerships.length).toBeGreaterThan(
			hierarchy.wing.node.selection.ownerships.length,
		);
		expect(hierarchy.processBlock.node.selection.ownerships.length).toBeGreaterThan(
			hierarchy.processRow.node.selection.ownerships.length,
		);
		expect(hierarchy.processBlock.node.selection.ownerships.length).toBeGreaterThan(
			hierarchy.processBank.node.selection.ownerships.length,
		);
		expect(hierarchy.factory.node.selection.ownerships).toHaveLength(index.modules.length);
		expect(hierarchy.factory.node.directedEdgeCount).toBe(build.summary.directedEdges);
	});

	it("resolves different rows and Wings without using generated preset identity", () => {
		const build = LARGE_FAB_BUILD;
		const index = LARGE_FAB_INDEX;
		const first = deriveStaticFabHierarchy(
			build.document.map,
			index,
			createRailAreaSelection(index, { x: -170, y: -10 }, { x: -140, y: 18 }),
		);
		const later = deriveStaticFabHierarchy(
			build.document.map,
			index,
			createRailAreaSelection(index, { x: 120, y: 362 }, { x: 170, y: 397 }),
		);
		if (
			first.processRow.state !== "resolved" ||
			later.processRow.state !== "resolved" ||
			first.wing.state !== "resolved" ||
			later.wing.state !== "resolved"
		) {
			throw new Error("expected resolved hierarchy");
		}
		expect(first.processRow.node.selection.bounds.maxY).toBeLessThan(
			later.processRow.node.selection.bounds.minY,
		);
		expect(first.wing.node.selection.bounds.maxX).toBeLessThanOrEqual(0);
		expect(later.wing.node.selection.bounds.minX).toBeGreaterThan(0);
	});

	it.each([
		50, 60, 100,
	])("keeps the %i Bay hierarchy portable through every quarter-turn", (bayCount) => {
		const build = largeFabBuild(bayCount);
		const sourceIndex = buildRailModuleOwnershipIndex(build.document.map);
		const bounds = build.document.map.bounds();
		if (!bounds) throw new Error("expected generated FAB bounds");
		const wholeFactory = createRailAreaSelection(
			sourceIndex,
			{ x: bounds.minX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.maxY },
			"fully-contained",
		);
		const template = createRailAreaStampTemplate(wholeFactory);

		for (let quarterTurn = 0; quarterTurn < 4; quarterTurn++) {
			let pose = initialRailAreaStampPose();
			for (let rotation = 0; rotation < quarterTurn; rotation++) {
				pose = rotateRailAreaStampPose(pose, 1);
			}
			const target = new RailDocument();
			const plan = planRailAreaStamp(target.map, template, { x: 1_000, y: 1_000 }, pose);
			expect(plan.valid, `${quarterTurn}: ${plan.reason}`).toBe(true);
			expect(target.commit(plan), `${quarterTurn}`).toBe(true);
			const index = buildRailModuleOwnershipIndex(target.map);
			const hierarchy = compileStaticFabHierarchyIndex(target.map, index);

			expect(hierarchy.branches).toHaveLength(1);
			const branch = hierarchy.branches[0];
			expect(branch?.factory.selection.ownerships, `${bayCount}:${quarterTurn}`).toHaveLength(
				index.modules.length,
			);
			expect(branch?.wings, `${bayCount}:${quarterTurn}`).toHaveLength(12);
			expect(branch?.processRows, `${bayCount}:${quarterTurn}`).toHaveLength(6);
			expect(branch?.processRowPairing, `${bayCount}:${quarterTurn}`).toMatchObject({
				state: "resolved",
				pairs: [
					[0, 1],
					[2, 3],
					[4, 5],
				],
			});
			expect(branch?.processBanks, `${bayCount}:${quarterTurn}`).toHaveLength(6);
			expect(branch?.processBlocks, `${bayCount}:${quarterTurn}`).toHaveLength(3);
			expectExactRowMembership(branch, `${bayCount}:${quarterTurn}`);
			expectExactBankMembership(branch, `${bayCount}:${quarterTurn}`);
			expectExactBlockMembership(branch, `${bayCount}:${quarterTurn}`);
			for (const row of branch?.processRows ?? []) {
				const rowTemplate = createRailAreaStampTemplate(row.selection);
				const rowPlan = planRailAreaStamp(
					new TileMap(),
					rowTemplate,
					{ x: 3_000, y: 3_000 },
					initialRailAreaStampPose(),
				);
				expect(rowPlan.valid, `${bayCount}:${quarterTurn} ${row.key}: ${rowPlan.reason}`).toBe(
					true,
				);
			}
		}
	}, 180_000);

	it.each([
		50, 60, 100,
	])("produces portable process-row selections for a %i Bay factory", (bayCount) => {
		const build = largeFabBuild(bayCount);
		const index = buildRailModuleOwnershipIndex(build.document.map);
		const hierarchy = compileStaticFabHierarchyIndex(build.document.map, index);
		const branch = hierarchy.branches[0];
		if (!branch) throw new Error("expected generated Factory hierarchy");
		const assembly = createSyntheticFabAssemblyPlan(
			{
				processBlockCount: build.request.parameters.processBlockCount,
				totalBayCount: bayCount,
			},
			build.request.parameters.bayPitchMeters,
		);

		expect(branch.wings).toHaveLength(12);
		expect(branch.processRows).toHaveLength(6);
		expect(branch.processRowPairing).toMatchObject({
			state: "resolved",
			pairs: [
				[0, 1],
				[2, 3],
				[4, 5],
			],
		});
		expect(branch.processBanks).toHaveLength(6);
		expect(branch.processBlocks).toHaveLength(3);
		expectExactRowMembership(branch, `${bayCount}`);
		expectExactBankMembership(branch, `${bayCount}`);
		expectExactBlockMembership(branch, `${bayCount}`);
		for (const [wingIndex, wing] of branch.wings.entries()) {
			const expectedBayCount = assembly.layout.wings[wingIndex]?.profile.bayCount;
			if (expectedBayCount === undefined) throw new Error("expected matching assembly Wing");
			const branchMergeModules = wing.selection.ownerships.filter(
				(ownership) =>
					ownership.construction.grammar === "directed-branch" ||
					ownership.construction.grammar === "directed-merge",
			);
			expect(branchMergeModules, `${bayCount}:${wing.key}`).toHaveLength(expectedBayCount * 2);
			expect(
				branchMergeModules.filter(
					(ownership) => ownership.construction.grammar === "directed-branch",
				),
				`${bayCount}:${wing.key}:branch`,
			).toHaveLength(expectedBayCount);
			expect(
				branchMergeModules.filter(
					(ownership) => ownership.construction.grammar === "directed-merge",
				),
				`${bayCount}:${wing.key}:merge`,
			).toHaveLength(expectedBayCount);
		}
		for (const row of branch.processRows) {
			const template = createRailAreaStampTemplate(row.selection);
			const plan = planRailAreaStamp(
				new TileMap(),
				template,
				{ x: 2_000, y: 2_000 },
				initialRailAreaStampPose(),
			);
			expect(plan.valid, `${bayCount} ${row.key}: ${plan.reason}`).toBe(true);
		}
	});

	it.each([
		[50, 3],
		[60, 4],
		[100, 6],
	] as const)(
		"keeps %i Bay / %i Block Wing and Row scopes portable in every rotation",
		(bayCount, processBlockCount) => {
			const build = largeFabProfileBuild(bayCount, processBlockCount);
			const index = buildRailModuleOwnershipIndex(build.document.map);
			const branch = compileStaticFabHierarchyIndex(build.document.map, index).branches[0];
			if (!branch) throw new Error("expected generated Factory hierarchy");
			const scopes = [
				...representativeHierarchyNodes(branch.wings).map((node) => ({
					label: `wing:${node.key}`,
					node,
					components: 2,
					openEnds: 4,
				})),
				...representativeHierarchyNodes(branch.processRows).map((node) => ({
					label: `row:${node.key}`,
					node,
					components: 4,
					openEnds: 8,
				})),
			];

			for (const [scopeIndex, scope] of scopes.entries()) {
				const template = createRailAreaStampTemplate(scope.node.selection);
				for (let quarterTurn = 0; quarterTurn < 4; quarterTurn++) {
					let pose = initialRailAreaStampPose();
					for (let rotation = 0; rotation < quarterTurn; rotation++) {
						pose = rotateRailAreaStampPose(pose, 1);
					}
					const target = new RailDocument();
					const snapshot = captureRailMirrorSnapshot(
						target.map,
						target.getPatchSequence(),
						target.portEquipment,
					).snapshot;
					const prepared = prepareBlueprintPlacement({
						type: "PREPARE_BLUEPRINT_PLACEMENT",
						requestId: bayCount * 100 + scopeIndex * 4 + quarterTurn,
						snapshot,
						railTemplate: template,
						staticFabTemplate: null,
						anchor: { x: 2_000, y: 2_000 },
						pose,
					});

					expect(
						prepared.valid,
						`${bayCount}:${scope.label}:${quarterTurn}:${prepared.reason}`,
					).toBe(true);
					expect(
						target.commit(structuredClone(prepared).plan),
						`${bayCount}:${scope.label}:${quarterTurn}`,
					).toBe(true);
					const analysis = analyzeRailNetwork(target.map);
					expect(analysis, `${bayCount}:${scope.label}:${quarterTurn}`).toMatchObject({
						status: "disconnected",
						components: scope.components,
						openEnds: scope.openEnds,
					});
					const physical = compilePhysicalRail(target.map);
					expect(physical.valid, `${bayCount}:${scope.label}:${quarterTurn}`).toBe(true);
					expect(physical.diagnostics, `${bayCount}:${scope.label}:${quarterTurn}`).toEqual([]);
					expect(physical.clearance.issues.count, `${bayCount}:${scope.label}:${quarterTurn}`).toBe(
						0,
					);
					const physicalTopology = analyzePhysicalPathTopology(physical.paths);
					expect(physicalTopology.invalidPaths, `${bayCount}:${scope.label}:${quarterTurn}`).toBe(
						0,
					);
					expect(
						physicalTopology.openPaths,
						`${bayCount}:${scope.label}:${quarterTurn}`,
					).toBeGreaterThan(0);
				}
			}
		},
		180_000,
	);

	it("keeps shared wall and spine infrastructure outside portable Process Wings", () => {
		const branch = compileStaticFabHierarchyIndex(LARGE_FAB_BUILD.document.map, LARGE_FAB_INDEX)
			.branches[0];
		if (!branch) throw new Error("expected generated Factory hierarchy");

		for (const wing of branch.wings) {
			for (const ownership of wing.selection.ownerships) {
				if (ownership.kind === "turnout") {
					expect([DIR_E, DIR_W], `${wing.key}:${ownership.key}`).toContain(
						ownership.construction.forward,
					);
				}
				if (
					ownership.kind === "straight" &&
					(ownership.construction.forward === DIR_N || ownership.construction.forward === DIR_S)
				) {
					expect(
						ownership.primaryCells.some(
							(cell) =>
								cell.x === wing.selection.bounds.minX || cell.x === wing.selection.bounds.maxX,
						),
						`${wing.key}:${ownership.key}`,
					).toBe(false);
				}
			}
		}
	});

	it.each([
		4, 6,
	])("infers the full hierarchy of a %i-block rectangular factory", (processBlockCount) => {
		const request = setSyntheticFabStarterParameter(
			defaultSyntheticFabStarterRequest("large-fab-60"),
			"processBlockCount",
			processBlockCount,
		);
		const build = buildSyntheticFabStarter(request);
		const ownership = buildRailModuleOwnershipIndex(build.document.map);
		const branch = compileStaticFabHierarchyIndex(build.document.map, ownership).branches[0];
		if (!branch) throw new Error("expected generated Factory hierarchy");

		expect(branch.wings).toHaveLength(processBlockCount * 4);
		expect(branch.processRows).toHaveLength(processBlockCount * 2);
		expect(branch.processRowPairing).toMatchObject({
			state: "resolved",
			pairs: Array.from({ length: processBlockCount }, (_, block) => [block * 2, block * 2 + 1]),
		});
		expect(branch.processBanks).toHaveLength(processBlockCount * 2);
		expect(branch.processBlocks).toHaveLength(processBlockCount);
		expectExactRowMembership(branch, `${processBlockCount}-block`);
		expectExactBankMembership(branch, `${processBlockCount}-block`);
		expectExactBlockMembership(branch, `${processBlockCount}-block`);
	}, 180_000);

	it.each([
		"single-loop",
		"dual-loop",
		"nested-bay",
		"shift-bay",
		"duplicate-bays",
		"interbay-row",
		"fab-block",
		"complete-fab",
	] as const)("does not invent Wing or process-row hierarchy for the %s starter", (starterId) => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest(starterId));
		const index = buildRailModuleOwnershipIndex(build.document.map);
		const hierarchy = compileStaticFabHierarchyIndex(build.document.map, index);

		for (const branch of hierarchy.branches) {
			expect(branch.wings).toHaveLength(0);
			expect(branch.processRows).toHaveLength(0);
			expect(branch.processRowPairing.state).toBe("none");
			expect(branch.processBanks).toHaveLength(0);
			expect(branch.processBlocks).toHaveLength(0);
		}
	});

	it("allows one complete generated Factory to become a portable blueprint", () => {
		const build = LARGE_FAB_BUILD;
		const index = LARGE_FAB_INDEX;
		const bounds = build.document.map.bounds();
		if (!bounds) throw new Error("expected generated FAB bounds");
		const focus = createRailAreaSelection(
			index,
			{ x: bounds.minX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.maxY },
			"fully-contained",
		);
		const hierarchy = deriveStaticFabHierarchy(build.document.map, index, focus);
		if (hierarchy.factory.state !== "resolved") throw new Error("expected resolved Factory");

		const template = createRailAreaStampTemplate(hierarchy.factory.node.selection);
		const plan = planRailAreaStamp(
			new TileMap(),
			template,
			{ x: 500, y: 500 },
			initialRailAreaStampPose(),
		);

		expect(template.sourceEdgeCount).toBe(build.summary.directedEdges);
		expect(template.sourceEdgeCount).toBeLessThanOrEqual(RAIL_AREA_STAMP_MAX_EDGES);
		expect(plan.valid).toBe(true);
		expect(plan.newEdges).toBe(template.sourceEdgeCount);
		expect(plan.mutations.length).toBe(build.summary.railCells);

		const blueprint = createOpenFabRailAreaBlueprint(template, {
			id: "large-fab-blueprint",
			name: "Large FAB",
			createdAt: "2026-07-31T00:00:00.000Z",
		});
		const project = captureOpenFabProject(build.document, {
			manifest: createOpenFabProjectManifest(
				"large-fab-blueprint-project",
				"Large FAB Blueprint Project",
				"2026-07-31T00:00:00.000Z",
			),
			blueprints: {
				schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
				records: [blueprint],
			},
		});
		const parsed = parseOpenFabProjectJson(serializeOpenFabProject(project));
		expect(parsed.project.blueprints.records[0]?.edges).toHaveLength(template.sourceEdgeCount);
	});

	it.each([
		["process-bank", 4, 8],
		["process-block", 8, 16],
		["factory", 1, 0],
	] as const)(
		"keeps one %s content scope physically portable through the placement Worker in every rotation",
		(scope, expectedComponents, expectedOpenEnds) => {
			const branch = compileStaticFabHierarchyIndex(LARGE_FAB_BUILD.document.map, LARGE_FAB_INDEX)
				.branches[0];
			if (!branch) throw new Error("expected generated Factory hierarchy");
			const source =
				scope === "process-bank"
					? branch.processBanks[0]
					: scope === "process-block"
						? branch.processBlocks[0]
						: branch.factory;
			if (!source) throw new Error(`expected ${scope} hierarchy node`);
			const template = createRailAreaStampTemplate(source.selection);

			for (let quarterTurn = 0; quarterTurn < 4; quarterTurn++) {
				let pose = initialRailAreaStampPose();
				for (let rotation = 0; rotation < quarterTurn; rotation++) {
					pose = rotateRailAreaStampPose(pose, 1);
				}
				const target = new RailDocument();
				const snapshot = captureRailMirrorSnapshot(
					target.map,
					target.getPatchSequence(),
					target.portEquipment,
				).snapshot;
				const prepared = prepareBlueprintPlacement({
					type: "PREPARE_BLUEPRINT_PLACEMENT",
					requestId: quarterTurn + 1,
					snapshot,
					railTemplate: template,
					staticFabTemplate: null,
					anchor: { x: 2_000, y: 2_000 },
					pose,
				});

				expect(prepared.valid, `${scope}:${quarterTurn}:${prepared.reason}`).toBe(true);
				if (!("areaStamp" in prepared.plan)) {
					throw new Error(`expected rail-area plan for ${scope}:${quarterTurn}`);
				}
				const expectedWidth =
					quarterTurn % 2 === 0 ? template.sourceWidthMeters : template.sourceHeightMeters;
				const expectedHeight =
					quarterTurn % 2 === 0 ? template.sourceHeightMeters : template.sourceWidthMeters;
				expect(prepared.plan.areaStamp, `${scope}:${quarterTurn}`).toMatchObject({
					quarterTurns: quarterTurn,
					anchor: { x: 2_000, y: 2_000 },
					widthMeters: expectedWidth,
					heightMeters: expectedHeight,
				});
				expect(
					prepared.plan.areaStamp.bounds.maxX - prepared.plan.areaStamp.bounds.minX,
					`${scope}:${quarterTurn}:width`,
				).toBe(expectedWidth);
				expect(
					prepared.plan.areaStamp.bounds.maxY - prepared.plan.areaStamp.bounds.minY,
					`${scope}:${quarterTurn}:height`,
				).toBe(expectedHeight);
				expect(target.commit(structuredClone(prepared).plan), `${scope}:${quarterTurn}`).toBe(true);
				expect(target.getPatchSequence(), `${scope}:${quarterTurn}`).toBe(1);
				const analysis = analyzeRailNetwork(target.map);
				expect(analysis, `${scope}:${quarterTurn}`).toMatchObject({
					status: scope === "factory" ? "closed" : "disconnected",
					components: expectedComponents,
					openEnds: expectedOpenEnds,
				});
				if (scope === "factory") {
					expect(analysis.strongComponents, `${scope}:${quarterTurn}`).toBe(1);
				} else {
					expect(analysis.strongComponents, `${scope}:${quarterTurn}`).toBeGreaterThan(
						expectedComponents,
					);
				}
			}
		},
		180_000,
	);

	it("rejects stale focus selections", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("single-loop"));
		const index = buildRailModuleOwnershipIndex(build.document.map);
		const focus = createRailAreaSelection(index, { x: -20, y: -20 }, { x: 80, y: 80 });
		const stale = { ...focus, revision: focus.revision + 1 } satisfies RailAreaSelection;

		expect(() => deriveStaticFabHierarchy(build.document.map, index, stale)).toThrow(/revision/);
	});

	it("resolves Canvas candidates only from committed module ownership", () => {
		const build = LARGE_FAB_BUILD;
		const index = LARGE_FAB_INDEX;
		const bounds = build.document.map.bounds();
		if (!bounds) throw new Error("expected generated FAB bounds");
		const wholeFactory = createRailAreaSelection(
			index,
			{ x: bounds.minX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.maxY },
			"fully-contained",
		);
		const hierarchy = deriveStaticFabHierarchy(build.document.map, index, wholeFactory);
		expect(hierarchy.wing.state).toBe("ambiguous");
		if (hierarchy.wing.state !== "ambiguous") throw new Error("expected ambiguous Wings");

		const candidates = compileStaticFabHierarchyCandidateOwnershipIndex(hierarchy.wing.candidates);
		for (const candidate of hierarchy.wing.candidates) {
			const ownership = candidate.selection.ownerships[0];
			if (!ownership) throw new Error("expected candidate ownership");
			expect(candidates.resolve(ownership.key)?.key).toBe(candidate.key);
		}
		expect(candidates.resolve("missing-ownership")).toBeNull();
	});

	it("keeps shared candidate ownership unresolved instead of guessing", () => {
		const branch = compileStaticFabHierarchyIndex(LARGE_FAB_BUILD.document.map, LARGE_FAB_INDEX)
			.branches[0];
		const candidate = branch?.wings[0];
		if (!candidate) throw new Error("expected Wing candidate");
		const duplicate = Object.freeze({ ...candidate, key: `${candidate.key}-DUPLICATE` });
		const candidates = compileStaticFabHierarchyCandidateOwnershipIndex([candidate, duplicate]);

		expect(candidates.resolve(candidate.selection.ownerships[0]?.key ?? "")).toBeNull();
	});
});

function largeFabBuild(bayCount: number): ReturnType<typeof buildSyntheticFabStarter> {
	const cached = LARGE_FAB_BUILDS.get(bayCount);
	if (cached) return cached;
	const request = setSyntheticFabStarterParameter(
		defaultSyntheticFabStarterRequest("large-fab-60"),
		"bayCount",
		bayCount,
	);
	const build = buildSyntheticFabStarter(request);
	LARGE_FAB_BUILDS.set(bayCount, build);
	return build;
}

function largeFabProfileBuild(
	bayCount: number,
	processBlockCount: number,
): ReturnType<typeof buildSyntheticFabStarter> {
	if (processBlockCount === 3) return largeFabBuild(bayCount);
	let request = setSyntheticFabStarterParameter(
		defaultSyntheticFabStarterRequest("large-fab-60"),
		"bayCount",
		bayCount,
	);
	request = setSyntheticFabStarterParameter(request, "processBlockCount", processBlockCount);
	return buildSyntheticFabStarter(request);
}

function representativeHierarchyNodes<T>(nodes: readonly T[]): readonly T[] {
	if (nodes.length === 0) return [];
	const indices = new Set([0, 1, Math.floor(nodes.length / 2), nodes.length - 2, nodes.length - 1]);
	return [...indices]
		.filter((index) => index >= 0 && index < nodes.length)
		.sort((left, right) => left - right)
		.map((index) => nodes[index] as T);
}

function rowTopologyEvidence(
	firstRow: number,
	secondRow: number,
	firstSideHops: number,
	secondSideHops: number,
): StaticFabProcessRowTopologyEvidence {
	return Object.freeze({
		rows: Object.freeze([firstRow, secondRow] as const),
		sameSideHopCounts: Object.freeze([firstSideHops, secondSideHops] as const),
	});
}

function expectExactRowMembership(
	branch: StaticFabHierarchyBranch | undefined,
	label: string,
): void {
	if (!branch) throw new Error(`expected generated Factory hierarchy for ${label}`);
	const wingMembership = new Map<string, number>();
	for (const row of branch.processRows) {
		const rowWings = branch.wings.filter((wing) => wing.key.startsWith(`${row.key}-WING-`));
		expect(rowWings, `${label}:${row.key}`).toHaveLength(2);
		const wingOwnershipKeys = new Set(
			rowWings.flatMap((wing) => wing.selection.ownerships.map((ownership) => ownership.key)),
		);
		const rowOwnershipKeys = new Set(row.selection.ownerships.map((ownership) => ownership.key));
		expect(rowOwnershipKeys, `${label}:${row.key}`).toEqual(wingOwnershipKeys);
		for (const wing of rowWings) {
			wingMembership.set(wing.key, (wingMembership.get(wing.key) ?? 0) + 1);
		}
	}
	expect(wingMembership.size, label).toBe(branch.wings.length);
	expect(new Set(wingMembership.values()), label).toEqual(new Set([1]));
}

function expectExactBlockMembership(
	branch: StaticFabHierarchyBranch | undefined,
	label: string,
): void {
	if (!branch) throw new Error(`expected generated Factory hierarchy for ${label}`);
	expect(branch.processRows.length % 2, label).toBe(0);
	for (const [blockIndex, block] of branch.processBlocks.entries()) {
		const rows = branch.processRows.slice(blockIndex * 2, blockIndex * 2 + 2);
		expect(rows, `${label}:${block.key}`).toHaveLength(2);
		const rowOwnershipKeys = new Set(
			rows.flatMap((row) => row.selection.ownerships.map((ownership) => ownership.key)),
		);
		expect(
			new Set(block.selection.ownerships.map((ownership) => ownership.key)),
			`${label}:${block.key}`,
		).toEqual(rowOwnershipKeys);
	}
}

function expectExactBankMembership(
	branch: StaticFabHierarchyBranch | undefined,
	label: string,
): void {
	if (!branch) throw new Error(`expected generated Factory hierarchy for ${label}`);
	const wingMembership = new Map<string, number>();
	for (let blockIndex = 0; blockIndex < branch.processBlocks.length; blockIndex++) {
		const rows = branch.processRows.slice(blockIndex * 2, blockIndex * 2 + 2);
		const banks = branch.processBanks.slice(blockIndex * 2, blockIndex * 2 + 2);
		expect(rows, `${label}:block-${blockIndex + 1}`).toHaveLength(2);
		expect(banks, `${label}:block-${blockIndex + 1}`).toHaveLength(2);
		for (let column = 0; column < 2; column++) {
			const rowWings = rows.map((row) => {
				const wing = branch.wings
					.filter((candidate) => candidate.key.startsWith(`${row.key}-WING-`))
					.at(column);
				if (!wing) throw new Error(`missing Wing ${column + 1} for ${row.key}`);
				return wing;
			});
			const bank = banks[column];
			if (!bank) throw new Error(`missing process bank ${column + 1}`);
			const wingOwnershipKeys = new Set(
				rowWings.flatMap((wing) => wing.selection.ownerships.map((ownership) => ownership.key)),
			);
			expect(
				new Set(bank.selection.ownerships.map((ownership) => ownership.key)),
				`${label}:${bank.key}`,
			).toEqual(wingOwnershipKeys);
			for (const wing of rowWings) {
				wingMembership.set(wing.key, (wingMembership.get(wing.key) ?? 0) + 1);
			}
		}
	}
	expect(wingMembership.size, label).toBe(branch.wings.length);
	expect(new Set(wingMembership.values()), label).toEqual(new Set([1]));
}
