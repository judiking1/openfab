import { describe, expect, it } from "vitest";
import { analyzeRailNetwork } from "../core/network";
import { bitCount, directionBetween, oppositeDirection } from "../core/railShape";
import { deriveStaticFabOrganizationSemanticRoles } from "../core/StaticFabOrganization";
import type { Cell, TileMap } from "../core/TileMap";
import {
	captureOpenFabProject,
	createOpenFabProjectManifest,
	createRailSnapshotFromOpenFabProject,
} from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import {
	createSyntheticFabAssemblyPlan,
	type SyntheticFabAssemblyProcessTrunkOperation,
} from "./SyntheticFabAssemblyPlan";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterProjectName,
	defaultSyntheticFabStarterRequest,
	SYNTHETIC_FAB_PRESET_CATALOG,
	SYNTHETIC_FAB_STARTER_CATALOG,
	type SyntheticFabStarterId,
	type SyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
	syntheticFabStarterAssemblyFingerprint,
	syntheticFabStarterFullFabAssemblyPlan,
	syntheticFabStarterPairedCirculationAssemblyPlan,
	syntheticFabStarterParallelHallAssemblyPlan,
	syntheticFabStarterProductionAssemblyPlan,
	syntheticFabStarterRequestFingerprint,
} from "./SyntheticFabStarter";
import { LARGE_FAB_60_TOPOLOGY_SPEC } from "./SyntheticFabTopologySpec";

describe("SyntheticFabStarter", () => {
	it("keeps catalog default project names for default requests", () => {
		for (const item of [...SYNTHETIC_FAB_STARTER_CATALOG, ...SYNTHETIC_FAB_PRESET_CATALOG]) {
			expect(
				defaultSyntheticFabStarterProjectName(defaultSyntheticFabStarterRequest(item.id)),
			).toBe(item.defaultProjectName);
		}
	});

	it.each([
		[50, 50],
		[73, 73],
		[100, 100],
		[49, 50],
		[101, 100],
	])("names normalized production configuration %i with %i Bays", (bayCount, expected) => {
		const request = defaultSyntheticFabStarterRequest("production-fab-60");
		const configured = { ...request, parameters: { ...request.parameters, bayCount } };
		const before = JSON.stringify(configured);
		expect(defaultSyntheticFabStarterProjectName(configured)).toBe(
			`OpenFab ${expected}-Bay Rail Foundation`,
		);
		expect(JSON.stringify(configured)).toBe(before);
	});

	it("builds every public starter deterministically through ordinary authored rail", () => {
		for (const [id, stepCount] of [
			["blank", 0],
			["bay-assembly", 3],
			["bay-bank", 13],
			["paired-circulation-fab-52", 201],
			["full-fab-52", 171],
			["parallel-hall-fab-12", 44],
			["central-spine-fab-24", 74],
			["production-fab-60", 185],
			["single-loop", 1],
			["dual-loop", 1],
			["nested-bay", 1],
			["shift-bay", 1],
			["duplicate-bays", 2],
			["interbay-row", 1],
			["fab-block", 2],
			["complete-fab", 8],
			["large-fab-60", 81],
		] as const) {
			const first = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest(id));
			const second = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest(id));

			expect(first.steps, id).toHaveLength(stepCount);
			expect(second.authoredChecksum, id).toBe(first.authoredChecksum);
			expect(second.physicalFingerprint, id).toBe(first.physicalFingerprint);
			expect(second.summary, id).toEqual(first.summary);
			expect(first.document.getPatchSequence(), id).toBe(stepCount);
			expect(first.document.portEquipment.ports, id).toHaveLength(0);
			expect(first.document.portEquipment.equipmentGroups, id).toHaveLength(0);

			if (id === "blank") {
				expect(first.summary).toMatchObject({
					railCells: 0,
					directedEdges: 0,
					physicalPaths: 0,
					bounds: null,
				});
				continue;
			}

			if (id === "duplicate-bays") {
				expect(analyzeRailNetwork(first.document.map), id).toMatchObject({
					components: 2,
					strongComponents: 2,
					stronglyConnected: false,
					openEnds: 0,
				});
				expect(
					createRailProjectReadiness(first.analysis, first.physical, first.authoredChecksum),
					id,
				).toMatchObject({
					ready: false,
					summary: {
						strongComponents: 2,
						physicalStrongComponents: 2,
						openTerminals: 0,
					},
				});
			} else {
				expect(analyzeRailNetwork(first.document.map), id).toMatchObject({
					status: "closed",
					components: 1,
					strongComponents: 1,
					stronglyConnected: true,
					openEnds: 0,
				});
				expect(
					createRailProjectReadiness(first.analysis, first.physical, first.authoredChecksum),
					id,
				).toMatchObject({
					ready: true,
					summary: {
						strongComponents: 1,
						physicalStrongComponents: 1,
						openTerminals: 0,
					},
				});
			}
			expect(first.summary.bounds?.widthMeters, id).toBeGreaterThan(0);
			expect(first.summary.bounds?.heightMeters, id).toBeGreaterThan(0);
		}
	}, 180_000);

	it("builds the default paired-circulation FAB as one validated static authoring network", () => {
		const request = defaultSyntheticFabStarterRequest("paired-circulation-fab-52");
		const plan = syntheticFabStarterPairedCirculationAssemblyPlan(request);
		expect(plan).not.toBeNull();
		const build = buildSyntheticFabStarter(request);
		const organizations = build.document.organizations;
		const roles = [...deriveStaticFabOrganizationSemanticRoles(organizations).values()];

		expect(build.planFingerprint).toBe(plan?.planFingerprint);
		expect(build.steps).toHaveLength(201);
		expect(build.steps.filter((step) => step.hierarchyRole === "outer-circulation")).toHaveLength(
			4,
		);
		const turnbackSteps = build.steps.filter((step) => step.kind === "paired-turnback");
		expect(turnbackSteps).toHaveLength(2);
		expect(turnbackSteps.map((step) => step.connectionId)).toEqual(
			plan?.outer.turnbacks.map((turnback) => turnback.id),
		);
		const interbaySteps = build.steps.filter((step) => step.hierarchyRole === "interbay-spine");
		expect(interbaySteps).toHaveLength(2);
		expect(interbaySteps.every((step) => step.kind === "paired-corridor")).toBe(true);
		expect(interbaySteps.every((step) => step.templateId === "paired-corridor")).toBe(true);
		expect(build.steps.filter((step) => step.hierarchyRole === "process-bay")).toHaveLength(52);
		expect(build.steps.filter((step) => step.hierarchyRole === "process-loop")).toHaveLength(87);
		expect(build.steps.filter((step) => step.kind === "network-link")).toHaveLength(56);
		const plannedGateways = [
			...(plan?.gateways ?? []),
			...(plan?.banks.flatMap((bank) => bank.bays.map((bay) => bay.gateway)) ?? []),
		];
		expect(plannedGateways).toHaveLength(56);
		for (const gateway of plannedGateways) {
			const step = build.steps.find((candidate) => candidate.connectionId === gateway.id);
			expect(step, gateway.id).toBeDefined();
			expect(step?.anchor, gateway.id).toEqual(gateway.sourceAnchor);
			expect(step?.targetAnchor, gateway.id).toEqual(gateway.targetAnchor);
			expect(step?.junctions, gateway.id).toEqual(gateway.exactJunctions);
			expect(step?.outboundTurns, gateway.id).toBe(gateway.expectedOutboundTurns);
			expect(step?.returnTurns, gateway.id).toBe(gateway.expectedReturnTurns);
		}
		expect(organizations.records).toHaveLength(144);
		expect(roles.filter((role) => role === "FAB")).toHaveLength(1);
		expect(roles.filter((role) => role === "BAY_BANK")).toHaveLength(4);
		expect(roles.filter((role) => role === "BAY")).toHaveLength(52);
		expect(roles.filter((role) => role === "PROCESS_LOOP")).toHaveLength(87);
		expect(build.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
			railCells: 33_663,
			directedEdges: 33_864,
			physicalPaths: 34_065,
			openTerminals: 0,
			strongComponents: 1,
			bounds: { widthMeters: 712, heightMeters: 524 },
		});
		expect(build.analysis).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
			unsafeJunctions: 0,
		});
		expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
	}, 120_000);

	it("builds a full project-scale FAB with four Banks and explicit gateway ownership", () => {
		const request = defaultSyntheticFabStarterRequest("full-fab-52");
		const plan = syntheticFabStarterFullFabAssemblyPlan(request);
		expect(plan).not.toBeNull();
		const build = buildSyntheticFabStarter(request);
		const organizations = build.document.organizations;
		const roles = [...deriveStaticFabOrganizationSemanticRoles(organizations).values()];

		expect(build.planFingerprint).toBe(plan?.planFingerprint);
		expect(build.steps).toHaveLength(171);
		expect(build.steps.filter((step) => step.hierarchyRole === "bay-bank")).toHaveLength(4);
		expect(build.steps.filter((step) => step.hierarchyRole === "process-bay")).toHaveLength(52);
		expect(build.steps.filter((step) => step.hierarchyRole === "process-loop")).toHaveLength(104);
		expect(build.steps.filter((step) => step.kind === "network-link")).toHaveLength(8);
		expect(organizations.records).toHaveLength(161);
		expect(roles.filter((role) => role === "FAB")).toHaveLength(1);
		expect(roles.filter((role) => role === "BAY_BANK")).toHaveLength(4);
		expect(roles.filter((role) => role === "BAY")).toHaveLength(52);
		expect(roles.filter((role) => role === "PROCESS_LOOP")).toHaveLength(104);
		expect(build.summary).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
			openTerminals: 0,
			strongComponents: 1,
			bounds: { widthMeters: 632, heightMeters: 608 },
		});
		expect(build.analysis).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
		});
		expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
	}, 120_000);

	it("builds a production-scale parallel hall with explicit Fab, Bank, Bay, and Process Loop ownership", () => {
		const request = defaultSyntheticFabStarterRequest("parallel-hall-fab-12");
		const plan = syntheticFabStarterParallelHallAssemblyPlan(request);
		expect(plan).not.toBeNull();
		const build = buildSyntheticFabStarter(request);
		const organizations = build.document.organizations;
		const roles = [...deriveStaticFabOrganizationSemanticRoles(organizations).values()];

		expect(build.planFingerprint).toBe(plan?.planFingerprint);
		expect(build.steps).toHaveLength(44);
		expect(build.steps.filter((step) => step.hierarchyRole === "bay-bank")).toHaveLength(2);
		expect(build.steps.filter((step) => step.hierarchyRole === "process-bay")).toHaveLength(12);
		expect(build.steps.filter((step) => step.hierarchyRole === "process-loop")).toHaveLength(24);
		expect(build.steps.filter((step) => step.kind === "network-link")).toHaveLength(4);
		expect(organizations.records).toHaveLength(39);
		expect(roles.filter((role) => role === "FAB")).toHaveLength(1);
		expect(roles.filter((role) => role === "BAY_BANK")).toHaveLength(2);
		expect(roles.filter((role) => role === "BAY")).toHaveLength(12);
		expect(roles.filter((role) => role === "PROCESS_LOOP")).toHaveLength(24);
		expect(build.summary).toMatchObject({
			zoneCount: 2,
			bayCount: 12,
			openTerminals: 0,
			strongComponents: 1,
			bounds: { widthMeters: 324, heightMeters: 316 },
		});
		expect(build.analysis).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
		});
		expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
	}, 20_000);

	it("builds one production Bay as an enclosing circulation with two long internal Process Loops", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("bay-assembly"));

		expect(build.steps.map((step) => step.templateId)).toEqual([
			"outer-loop",
			"outerbay-link",
			"outerbay-link",
		]);
		expect(build.steps.map((step) => step.label)).toEqual([
			"Bay circulation envelope",
			"BAY-01 Process Loop 1",
			"BAY-01 Process Loop 2",
		]);
		expect(build.document.organizations.records).toHaveLength(3);
		expect(build.document.organizations.records.map((record) => record.kind)).toEqual([
			"BAY",
			"AISLE",
			"AISLE",
		]);
		expect(
			build.document.organizations.records.slice(1).map((record) => record.parentOrganizationIds),
		).toEqual([[1], [1]]);
		expect(build.summary).toMatchObject({
			zoneCount: 1,
			bayCount: 1,
			junctions: 4,
			openTerminals: 0,
			strongComponents: 1,
			bounds: { widthMeters: 96, heightMeters: 32 },
		});
		expect(build.analysis).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			unsafeJunctions: 0,
		});
		expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
	});

	it("builds a production FAB from actual Bay assemblies on shared Bank collectors", () => {
		const request = defaultSyntheticFabStarterRequest("production-fab-60");
		const plan = syntheticFabStarterProductionAssemblyPlan(request);
		expect(plan).not.toBeNull();
		const build = buildSyntheticFabStarter(request);
		const bankSteps = build.steps.filter((step) => step.hierarchyRole === "bay-bank");
		const baySteps = build.steps.filter((step) => step.hierarchyRole === "process-bay");
		const processLoopSteps = build.steps.filter((step) => step.hierarchyRole === "process-loop");

		expect(build.planFingerprint).toBe(plan?.planFingerprint);
		expect(build.steps).toHaveLength(185);
		expect(build.steps.slice(0, 2).map((step) => step.entityId)).toEqual([
			"FAB-OUTER-CIRCULATION",
			"FAB-INTERBAY-SPINE",
		]);
		expect(bankSteps).toHaveLength(3);
		expect(bankSteps.reduce((total, step) => total + step.bayCount, 0)).toBe(60);
		expect(bankSteps.flatMap((step) => step.bayIds)).toHaveLength(60);
		expect(new Set(bankSteps.flatMap((step) => step.bayIds)).size).toBe(60);
		expect(baySteps).toHaveLength(60);
		expect(new Set(baySteps.map((step) => step.entityId)).size).toBe(60);
		expect(baySteps.filter((step) => step.templateId === "outer-loop")).toHaveLength(60);
		expect(processLoopSteps).toHaveLength(120);
		expect(processLoopSteps.every((step) => step.templateId === "outerbay-link")).toBe(true);
		const organizations = build.document.organizations;
		expect(organizations.nextOrganizationId).toBe(185);
		expect(organizations.records).toHaveLength(184);
		expect(organizations.records.filter((record) => record.kind === "AREA")).toHaveLength(4);
		expect(organizations.records.filter((record) => record.kind === "BAY")).toHaveLength(60);
		expect(organizations.records.filter((record) => record.kind === "AISLE")).toHaveLength(120);
		const fab = organizations.records.find((record) => record.name === "Production FAB");
		expect(fab).toMatchObject({
			id: 1,
			kind: "AREA",
			parentOrganizationIds: [],
		});
		const firstBank = organizations.records.find((record) => record.name === "BAY-BANK-01");
		expect(firstBank).toMatchObject({
			kind: "AREA",
			parentOrganizationIds: [1],
		});
		const firstBay = organizations.records.find((record) => record.name === "BAY-001");
		expect(firstBay).toMatchObject({
			kind: "BAY",
			parentOrganizationIds: [firstBank?.id],
		});
		const firstProcessLoops = organizations.records.filter((record) =>
			record.name.startsWith("BAY-001-PROCESS-LOOP-"),
		);
		expect(firstProcessLoops).toHaveLength(2);
		expect(firstProcessLoops.map((record) => record.parentOrganizationIds)).toEqual([
			[firstBay?.id],
			[firstBay?.id],
		]);
		const semanticRoles = [...deriveStaticFabOrganizationSemanticRoles(organizations).values()];
		expect(semanticRoles.filter((role) => role === "FAB")).toHaveLength(1);
		expect(semanticRoles.filter((role) => role === "BAY_BANK")).toHaveLength(3);
		expect(semanticRoles.filter((role) => role === "BAY")).toHaveLength(60);
		expect(semanticRoles.filter((role) => role === "PROCESS_LOOP")).toHaveLength(120);
		const directlyOwnedEdges = new Set(
			organizations.records.flatMap((record) =>
				record.membership.railEdges.map(
					(edge) => `${edge.from.x}:${edge.from.y}>${edge.to.x}:${edge.to.y}`,
				),
			),
		);
		expect(directlyOwnedEdges.size).toBe(build.analysis.edges);
		expect(build.summary).toMatchObject({
			zoneCount: 3,
			bayCount: 60,
			openTerminals: 0,
			strongComponents: 1,
			bounds: {
				widthMeters: plan?.outer.lengthMeters,
				heightMeters: plan?.outer.depthMeters,
			},
		});
		expect(build.analysis).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });

		const project = captureOpenFabProject(build.document, {
			manifest: createOpenFabProjectManifest(
				"project-production-fab-round-trip",
				"Production FAB Round Trip",
				"2026-08-11T00:00:00.000Z",
			),
			view: null,
		});
		const serialized = serializeOpenFabProject(project);
		const parsed = parseOpenFabProjectJson(serialized).project;
		const snapshot = createRailSnapshotFromOpenFabProject(parsed);
		const loaded = hydrateRailMirrorSnapshotDocument(snapshot);
		const loadedCapture = captureRailMirrorSnapshot(
			loaded.map,
			loaded.getPatchSequence(),
			loaded.portEquipment,
			loaded.organizations,
		);

		expect(parsed.areas.nextOrganizationId).toBe(185);
		expect(parsed.areas.records).toHaveLength(184);
		expect(loaded.organizations).toEqual(build.document.organizations);
		expect(loadedCapture.snapshot.checksum).toBe(snapshot.checksum);
		expect(snapshot.checksum).toBe(build.authoredChecksum);
		expect(serializeOpenFabProject(parsed)).toBe(serialized);
		expect(serialized).not.toContain("production-fab-60");
	}, 120_000);

	it.each([
		[50, 3, 104],
		[73, 4, 120],
		[100, 3, 112],
		[100, 6, 140],
	] as const)(
		"keeps the production FAB physically closed at %i Bays / %i Banks / %i m pitch",
		(bayCount, bankCount, bayPitchMeters) => {
			let request = setSyntheticFabStarterParameter(
				defaultSyntheticFabStarterRequest("production-fab-60"),
				"bayCount",
				bayCount,
			);
			request = setSyntheticFabStarterParameter(request, "processBlockCount", bankCount);
			request = setSyntheticFabStarterParameter(request, "bayPitchMeters", bayPitchMeters);
			const build = buildSyntheticFabStarter(request);

			expect(build.steps).toHaveLength(2 + bankCount + bayCount * 3);
			expect(build.summary).toMatchObject({
				zoneCount: bankCount,
				bayCount,
				openTerminals: 0,
				strongComponents: 1,
			});
			expect(build.analysis).toMatchObject({
				status: "closed",
				components: 1,
				strongComponents: 1,
				stronglyConnected: true,
				unsafeJunctions: 0,
			});
			expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
		},
		120_000,
	);

	it("builds a Bay Bank from actual Bay assemblies sharing one interbay collector", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("bay-bank"));
		const collectorSteps = build.steps.filter((step) => step.hierarchyRole === "interbay-spine");
		const baySteps = build.steps.filter((step) => step.hierarchyRole === "process-bay");
		const processLoopSteps = build.steps.filter((step) => step.hierarchyRole === "process-loop");

		expect(collectorSteps).toHaveLength(1);
		expect(collectorSteps[0]).toMatchObject({
			templateId: "outer-loop",
			entityId: "BANK-COLLECTOR-01",
			bayCount: 4,
		});
		expect(baySteps).toHaveLength(4);
		expect(new Set(baySteps.map((step) => step.entityId))).toEqual(
			new Set(["BAY-01", "BAY-02", "BAY-03", "BAY-04"]),
		);
		expect(baySteps.filter((step) => step.templateId === "outer-loop")).toHaveLength(4);
		expect(processLoopSteps).toHaveLength(8);
		expect(processLoopSteps.every((step) => step.templateId === "outerbay-link")).toBe(true);
		expect(
			build.document.organizations.records.filter((record) => record.kind === "AREA"),
		).toHaveLength(1);
		expect(
			build.document.organizations.records.filter((record) => record.kind === "BAY"),
		).toHaveLength(4);
		expect(
			build.document.organizations.records.filter((record) => record.kind === "AISLE"),
		).toHaveLength(8);
		expect(build.summary).toMatchObject({
			zoneCount: 1,
			bayCount: 4,
			junctions: 24,
			openTerminals: 0,
			strongComponents: 1,
		});
		expect(build.analysis).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			unsafeJunctions: 0,
		});
		expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });

		let maximum = defaultSyntheticFabStarterRequest("bay-bank");
		maximum = setSyntheticFabStarterParameter(maximum, "bayCount", 8);
		maximum = setSyntheticFabStarterParameter(maximum, "aisleLengthMeters", 224);
		maximum = setSyntheticFabStarterParameter(maximum, "laneSpacingMeters", 60);
		maximum = setSyntheticFabStarterParameter(maximum, "bayPitchMeters", 244);
		const maximumBuild = buildSyntheticFabStarter(maximum);
		expect(maximumBuild.summary).toMatchObject({
			bayCount: 8,
			openTerminals: 0,
			strongComponents: 1,
		});
		expect(maximumBuild.physical).toMatchObject({
			valid: true,
			diagnostics: [],
		});
	});

	it("builds twelve process Wings between the central spine and one wall circuit", () => {
		for (const bayPitchMeters of [20, 22, 24]) {
			const request = setSyntheticFabStarterParameter(
				defaultSyntheticFabStarterRequest("large-fab-60"),
				"bayPitchMeters",
				bayPitchMeters,
			);
			let build: ReturnType<typeof buildSyntheticFabStarter>;
			try {
				build = buildSyntheticFabStarter(request);
			} catch (error) {
				throw new Error(
					`Large FAB ${bayPitchMeters} m Bay pitch failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			expect(build.summary).toMatchObject({
				zoneCount: 12,
				bayCount: 60,
				strongComponents: 1,
				openTerminals: 0,
			});
			const wingSteps = build.steps.filter((step) => step.hierarchyRole === "process-wing");
			expect(wingSteps).toHaveLength(12);
			expect(wingSteps.every((step) => step.connectionRole === "process-row")).toBe(true);
			const outerSteps = build.steps.filter((step) => step.templateId === "outer-loop");
			expect(outerSteps).toHaveLength(3);
			expect(outerSteps.find((step) => step.hierarchyRole === "outer-circulation")).toMatchObject({
				hierarchyRole: "outer-circulation",
				entityId: "FAB-OUTER-CIRCULATION",
			});
			expect(outerSteps.find((step) => step.hierarchyRole === "interbay-spine")).toMatchObject({
				hierarchyRole: "interbay-spine",
				entityId: LARGE_FAB_60_TOPOLOGY_SPEC.spineId,
			});
			expect(outerSteps.find((step) => step.hierarchyRole === "wall-circuit")).toMatchObject({
				hierarchyRole: "wall-circuit",
				entityId: LARGE_FAB_60_TOPOLOGY_SPEC.wallCircuit.id,
			});
			expect(build.steps.filter((step) => step.templateId === "outerbay-link")).toHaveLength(0);
			const networkLinkSteps = build.steps.filter((step) => step.kind === "network-link");
			expect(networkLinkSteps).toHaveLength(18);
			expect(
				networkLinkSteps
					.filter((step) => step.connectionRole === "process-row")
					.map((step) => step.connectionId),
			).toEqual(
				LARGE_FAB_60_TOPOLOGY_SPEC.processRows.flatMap((row) => [
					`process-trunk:${row.id}:${row.leftWingId}`,
					`process-trunk:${row.id}:${row.rightWingId}`,
				]),
			);
			expect(
				networkLinkSteps
					.filter((step) => step.connectionRole === "spine-wall")
					.map((step) => step.connectionId),
			).toEqual(LARGE_FAB_60_TOPOLOGY_SPEC.spineWallLinks.map((link) => link.id));
			expect(
				networkLinkSteps
					.filter((step) => step.connectionRole === "wall-outer")
					.map((step) => step.connectionId),
			).toEqual(LARGE_FAB_60_TOPOLOGY_SPEC.wallOuterLinks.map((link) => link.id));
			expect(
				build.steps
					.filter((step) => step.kind === "template")
					.every((step) => step.connectionId === null && step.connectionRole === null),
			).toBe(true);
			const wingBayCounts = wingSteps.map((step) => step.bayCount);
			expect(wingBayCounts.reduce((total, count) => total + count, 0)).toBe(60);
			expect(new Set(wingBayCounts)).toEqual(new Set([5]));
			expect(wingSteps.flatMap((step) => step.bayIds)).toHaveLength(60);
			expect(new Set(wingSteps.flatMap((step) => step.bayIds)).size).toBe(60);
			expect(new Set(wingSteps.map((step) => step.entityId)).size).toBe(12);
			const baySteps = build.steps.filter((step) => step.hierarchyRole === "process-bay");
			expect(baySteps).toHaveLength(60);
			expect(baySteps.every((step) => step.templateId === "branch-bypass")).toBe(true);
			expect(build.analysis).toMatchObject({
				status: "closed",
				components: 1,
				strongComponents: 1,
				stronglyConnected: true,
				openEnds: 0,
				unsafeJunctions: 0,
			});
			expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
			expect(build.summary.bounds?.widthMeters).toBeGreaterThanOrEqual(370);
			expect(build.summary.bounds?.heightMeters).toBeGreaterThanOrEqual(470);
			expect(build.document.getPatchSequence()).toBe(81);
		}
	}, 60_000);

	it.each([
		50, 60, 61, 72, 73, 84, 85, 96, 97, 100,
	])("builds a physically closed aligned factory at %i total Bays", (targetBayCount) => {
		const request = setSyntheticFabStarterParameter(
			defaultSyntheticFabStarterRequest("large-fab-60"),
			"bayCount",
			targetBayCount,
		);
		const build = buildSyntheticFabStarter(request);
		const wingSteps = build.steps.filter((step) => step.hierarchyRole === "process-wing");

		expect(build.summary).toMatchObject({
			zoneCount: 12,
			bayCount: targetBayCount,
			strongComponents: 1,
			openTerminals: 0,
		});
		expect(wingSteps.reduce((total, step) => total + step.bayCount, 0)).toBe(targetBayCount);
		expect(Math.max(...wingSteps.map((step) => step.bayCount))).toBeLessThanOrEqual(10);
		expect(build.analysis).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
		expectLargeFabCirculationGrammar(build, targetBayCount);
		expect(build.document.getPatchSequence()).toBe(targetBayCount + 21);
	}, 90_000);

	it("physically validates an uneven 73 Bay factory at the non-default 22 m pitch", () => {
		let request = setSyntheticFabStarterParameter(
			defaultSyntheticFabStarterRequest("large-fab-60"),
			"bayCount",
			73,
		);
		request = setSyntheticFabStarterParameter(request, "bayPitchMeters", 22);
		const build = buildSyntheticFabStarter(request);

		expect(build.summary).toMatchObject({
			zoneCount: 12,
			bayCount: 73,
			strongComponents: 1,
			openTerminals: 0,
		});
		expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
		expectLargeFabCirculationGrammar(build, 73);
	}, 90_000);

	it.each([
		[3, 60, 20],
		[4, 50, 20],
		[5, 100, 20],
		[6, 50, 20],
		[6, 100, 24],
	] as const)(
		"builds a closed rectangular factory with %i Process Blocks, %i Bays, and %i m pitch",
		(processBlockCount, totalBayCount, bayPitchMeters) => {
			let request = setSyntheticFabStarterParameter(
				defaultSyntheticFabStarterRequest("large-fab-60"),
				"processBlockCount",
				processBlockCount,
			);
			request = setSyntheticFabStarterParameter(request, "bayCount", totalBayCount);
			request = setSyntheticFabStarterParameter(request, "bayPitchMeters", bayPitchMeters);
			const build = buildSyntheticFabStarter(request);
			const expectedWings = processBlockCount * 4;

			expect(build.summary).toMatchObject({
				zoneCount: expectedWings,
				bayCount: totalBayCount,
				strongComponents: 1,
				openTerminals: 0,
			});
			expect(build.steps.filter((step) => step.hierarchyRole === "process-wing")).toHaveLength(
				expectedWings,
			);
			expect(build.steps.filter((step) => step.connectionRole === "process-row")).toHaveLength(
				expectedWings,
			);
			expect(build.steps.filter((step) => step.connectionRole === "spine-wall")).toHaveLength(2);
			expect(build.steps.filter((step) => step.connectionRole === "wall-outer")).toHaveLength(4);
			const wingSteps = build.steps.filter((step) => step.hierarchyRole === "process-wing");
			expect(wingSteps.flatMap((step) => step.bayIds)).toHaveLength(totalBayCount);
			expect(new Set(wingSteps.flatMap((step) => step.bayIds)).size).toBe(totalBayCount);
			expect(build.document.getPatchSequence()).toBe(totalBayCount + expectedWings + 9);
			expect(build.analysis).toMatchObject({
				status: "closed",
				components: 1,
				strongComponents: 1,
				stronglyConnected: true,
				openEnds: 0,
				unsafeJunctions: 0,
			});
			expect(build.physical).toMatchObject({ valid: true, diagnostics: [] });
			expectLargeFabCirculationGrammar(build, totalBayCount);
		},
		120_000,
	);

	it("builds a complete three-zone FAB with atomic interbay links and outer circulation", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("complete-fab"));

		expect(build.steps.map((step) => step.templateId)).toEqual([
			"interbay-spine",
			"interbay-spine",
			"interbay-spine",
			"outerbay-link",
			"outerbay-link",
			"outerbay-link",
			"network-link",
			"network-link",
		]);
		expect(build.steps.filter((step) => step.kind === "network-link")).toHaveLength(2);
		expect(build.steps.at(-1)?.targetAnchor).toEqual({ x: 240, y: 8 });
		expect(build.analysis).toMatchObject({
			status: "closed",
			cells: 1721,
			edges: 1740,
			components: 1,
			strongComponents: 1,
			stronglyConnected: true,
			openEnds: 0,
			junctions: 38,
			unsafeJunctions: 0,
		});
		expect(build.summary).toMatchObject({
			physicalPaths: 1759,
			bounds: {
				widthMeters: 324,
				heightMeters: 62,
			},
		});
		expect(build.document.getPatchSequence()).toBe(8);
	});

	it("normalizes only the controls exposed by the selected starter", () => {
		let request = defaultSyntheticFabStarterRequest("fab-block");
		request = setSyntheticFabStarterParameter(request, "bayCount", 99);
		request = setSyntheticFabStarterParameter(request, "bayPitchMeters", 1);
		request = setSyntheticFabStarterParameter(request, "outerbayDepthMeters", 31);

		expect(request.parameters).toMatchObject({
			bayCount: 6,
			bayPitchMeters: 16,
			outerbayDepthMeters: 32,
		});
		expect(() => setSyntheticFabStarterParameter(request, "aisleLengthMeters", 60)).toThrow(
			/not configurable/,
		);
	});

	it("keeps production FAB pitch inside the density-dependent 2 km envelope", () => {
		let request = setSyntheticFabStarterParameter(
			defaultSyntheticFabStarterRequest("production-fab-60"),
			"bayPitchMeters",
			140,
		);
		expect(request.parameters.bayPitchMeters).toBe(140);

		request = setSyntheticFabStarterParameter(request, "bayCount", 100);
		expect(request.parameters.bayPitchMeters).toBe(112);
		request = setSyntheticFabStarterParameter(request, "bayPitchMeters", 140);
		expect(request.parameters.bayPitchMeters).toBe(112);

		request = setSyntheticFabStarterParameter(request, "processBlockCount", 6);
		request = setSyntheticFabStarterParameter(request, "bayPitchMeters", 140);
		expect(request.parameters.bayPitchMeters).toBe(140);
	});

	it("fingerprints every normalized starter field used by preview and activation", () => {
		const initial = defaultSyntheticFabStarterRequest("large-fab-60");
		const fingerprints = new Set([
			syntheticFabStarterRequestFingerprint(initial),
			syntheticFabStarterRequestFingerprint(
				setSyntheticFabStarterParameter(initial, "bayCount", 61),
			),
			syntheticFabStarterRequestFingerprint(
				setSyntheticFabStarterParameter(initial, "bayPitchMeters", 22),
			),
			syntheticFabStarterRequestFingerprint(
				setSyntheticFabStarterParameter(initial, "processBlockCount", 4),
			),
		]);

		expect(fingerprints.size).toBe(4);
		expect(
			syntheticFabStarterRequestFingerprint({
				...initial,
				parameters: { ...initial.parameters },
			}),
		).toBe(syntheticFabStarterRequestFingerprint(initial));
		expect(syntheticFabStarterAssemblyFingerprint(initial)).toBe(
			createSyntheticFabAssemblyPlan(
				{
					processBlockCount: initial.parameters.processBlockCount,
					totalBayCount: initial.parameters.bayCount,
				},
				initial.parameters.bayPitchMeters,
			).planFingerprint,
		);
		expect(
			syntheticFabStarterAssemblyFingerprint(defaultSyntheticFabStarterRequest("blank")),
		).toBeNull();
	});

	it("keeps the largest starter as one closed SCC with a distinct outerbay route", () => {
		let request = defaultSyntheticFabStarterRequest("fab-block");
		request = setSyntheticFabStarterParameter(request, "bayCount", 6);
		request = setSyntheticFabStarterParameter(request, "bayPitchMeters", 24);
		request = setSyntheticFabStarterParameter(request, "laneSpacingMeters", 16);
		request = setSyntheticFabStarterParameter(request, "outerbayDepthMeters", 60);
		const build = buildSyntheticFabStarter(request);

		expect(build.steps.map((step) => step.templateId)).toEqual(["interbay-spine", "outerbay-link"]);
		expect(build.analysis).toMatchObject({
			status: "closed",
			components: 1,
			strongComponents: 1,
			openEnds: 0,
		});
		expect(build.summary.junctions).toBeGreaterThan(12);
		expect(build.summary.bounds?.widthMeters).toBe(148);
		expect(build.summary.bounds?.heightMeters).toBe(92);
	});

	it("keeps every exposed min/default/max parameter combination physically closed", () => {
		let configurations = 0;
		for (const item of SYNTHETIC_FAB_STARTER_CATALOG) {
			for (const request of starterParameterMatrix(item.id)) {
				const build = buildSyntheticFabStarter(request);
				configurations++;
				if (item.id === "blank") {
					expect(build.summary.physicalPaths).toBe(0);
					continue;
				}
				const expectedComponents = item.id === "duplicate-bays" ? 2 : 1;
				expect(build.analysis, `${item.id}:${JSON.stringify(request.parameters)}`).toMatchObject({
					components: expectedComponents,
					strongComponents: expectedComponents,
					stronglyConnected: expectedComponents === 1,
					openEnds: 0,
				});
				expect(build.physical.valid).toBe(true);
				expect(build.physical.diagnostics).toHaveLength(0);
			}
		}
		expect(configurations).toBe(271);
	}, 120_000);

	it("captures ordinary schema-v11 project data without persisted starter provenance", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("complete-fab"));
		const project = captureOpenFabProject(build.document, {
			manifest: createOpenFabProjectManifest(
				"project-synthetic-test",
				"Synthetic Test",
				"2026-07-23T00:00:00.000Z",
			),
			view: null,
		});
		const json = JSON.stringify(project);

		expect(project.schemaVersion).toBe(11);
		expect(project.rail.cells).toHaveLength(build.summary.railCells);
		expect(project.ports.records).toHaveLength(0);
		expect(project.equipment.records).toHaveLength(0);
		expect(project.relationships).toEqual({
			schemaVersion: 1,
			nextRelationshipId: 1,
			records: [],
		});
		expect(json).not.toContain("fab-block");
		expect(json).not.toContain("interbay-spine");
		expect(json).not.toContain("outerbay-link");
		expect(json).not.toContain("network-link");
		expect(json).not.toContain("complete-fab");
	});

	it("round-trips the maximum legacy FAB as ordinary current-schema project data", () => {
		let request = setSyntheticFabStarterParameter(
			defaultSyntheticFabStarterRequest("large-fab-60"),
			"processBlockCount",
			6,
		);
		request = setSyntheticFabStarterParameter(request, "bayCount", 100);
		request = setSyntheticFabStarterParameter(request, "bayPitchMeters", 24);
		const build = buildSyntheticFabStarter(request);
		const expectedSequence = build.steps.length;
		const project = captureOpenFabProject(build.document, {
			manifest: createOpenFabProjectManifest(
				"project-large-fab-round-trip",
				"Large FAB Round Trip",
				"2026-07-31T00:00:00.000Z",
			),
			view: null,
		});
		const serialized = serializeOpenFabProject(project);
		const parsed = parseOpenFabProjectJson(serialized).project;
		const snapshot = createRailSnapshotFromOpenFabProject(parsed);
		const loaded = hydrateRailMirrorSnapshotDocument(snapshot);
		const loadedCapture = captureRailMirrorSnapshot(
			loaded.map,
			loaded.getPatchSequence(),
			loaded.portEquipment,
		);

		expect(parsed.rail.patchSequence).toBe(expectedSequence);
		expect(snapshot.sequence).toBe(expectedSequence);
		expect(loaded.getPatchSequence()).toBe(expectedSequence);
		expect(loadedCapture.snapshot.checksum).toBe(snapshot.checksum);
		expect(checksumRailPhysicalLayout(compilePhysicalRail(loaded.map))).toBe(
			build.physicalFingerprint,
		);
		expect(serializeOpenFabProject(parsed)).toBe(serialized);
		expect(serialized).not.toContain("large-fab-60");
		expect(serialized).not.toContain("process-wing");
		expect(serialized).not.toContain("wall-circuit");
	}, 120_000);

	it("publishes a compact ordered catalog with unique ids", () => {
		const ids = SYNTHETIC_FAB_STARTER_CATALOG.map((item) => item.id);
		expect(ids).toEqual([
			"blank",
			"bay-assembly",
			"bay-bank",
			"single-loop",
			"dual-loop",
			"nested-bay",
			"shift-bay",
			"duplicate-bays",
			"interbay-row",
			"fab-block",
			"complete-fab",
		] satisfies SyntheticFabStarterId[]);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("publishes product and stress factories only through the dedicated preset catalog", () => {
		expect(SYNTHETIC_FAB_PRESET_CATALOG.map((item) => item.id)).toEqual([
			"paired-circulation-fab-52",
			"full-fab-52",
			"parallel-hall-fab-12",
			"central-spine-fab-24",
			"production-fab-60",
		]);
		const preset = SYNTHETIC_FAB_PRESET_CATALOG.find((item) => item.id === "production-fab-60");
		if (!preset) throw new Error("Missing production FAB preset.");
		const bayCount = preset.parameters.find((parameter) => parameter.key === "bayCount");
		const bankCount = preset.parameters.find((parameter) => parameter.key === "processBlockCount");

		expect(preset.expectedTopology).toBe("single-closed-scc");
		expect(preset.parameters.map((parameter) => parameter.key)).toEqual([
			"bayCount",
			"processBlockCount",
			"bayPitchMeters",
		]);
		expect(bayCount).toMatchObject({ minimum: 50, maximum: 100, step: 1 });
		expect(bankCount).toMatchObject({
			minimum: 3,
			maximum: 6,
			step: 1,
			unit: "bank",
		});
		expect(defaultSyntheticFabStarterRequest(preset.id).parameters.bayCount).toBe(60);
		expect(defaultSyntheticFabStarterRequest(preset.id).parameters.processBlockCount).toBe(3);
		expect(SYNTHETIC_FAB_STARTER_CATALOG.some((item) => item.id === preset.id)).toBe(false);
	});
});

function expectLargeFabCirculationGrammar(
	build: ReturnType<typeof buildSyntheticFabStarter>,
	targetBayCount: number,
): void {
	const assembly = createSyntheticFabAssemblyPlan(
		{
			processBlockCount: build.request.parameters.processBlockCount,
			totalBayCount: targetBayCount,
		},
		build.request.parameters.bayPitchMeters,
	);
	const { layout, topology } = assembly;
	const map = build.document.map;
	const outerSteps = build.steps.filter((step) => step.hierarchyRole === "outer-circulation");
	const spineSteps = build.steps.filter((step) => step.hierarchyRole === "interbay-spine");
	const wallSteps = build.steps.filter((step) => step.hierarchyRole === "wall-circuit");

	expect(build.planFingerprint).toBe(assembly.planFingerprint);
	expect(build.steps).toHaveLength(assembly.operations.length + targetBayCount);
	expect(build.steps.map((step) => step.ordinal)).toEqual(
		Array.from({ length: build.steps.length }, (_, index) => index + 1),
	);
	const processWingSteps = build.steps.filter((step) => step.hierarchyRole === "process-wing");
	const processBaySteps = build.steps.filter((step) => step.hierarchyRole === "process-bay");
	const connectionSteps = build.steps.filter((step) => step.kind === "network-link");
	const connectionById = new Map(connectionSteps.map((step) => [step.connectionId, step] as const));
	const entityById = new Map(build.steps.map((step) => [step.entityId, step] as const));
	for (const operation of assembly.operations) {
		if (operation.kind === "link") {
			const step = connectionById.get(operation.id);
			expect(step, operation.id).toMatchObject({
				kind: "network-link",
				templateId: "network-link",
				hierarchyRole: "network-link",
				entityId: null,
				connectionId: operation.id,
				connectionRole: operation.role,
			});
			expect(step?.anchor, operation.id).toEqual(operation.sourceRun.anchor);
			expect(step?.targetAnchor, operation.id).toEqual(operation.targetRun.anchor);
			expect(step?.junctions, operation.id).not.toBeNull();
		} else if (operation.kind === "process-trunk") {
			const step = connectionById.get(operation.id);
			expect(step, operation.id).toMatchObject({
				kind: "network-link",
				templateId: "network-link",
				hierarchyRole: "process-wing",
				entityId: operation.wingId,
				connectionId: operation.id,
				connectionRole: "process-row",
				bayCount: operation.wing.profile.bayCount,
			});
			expect(step?.anchor, operation.id).toEqual(operation.sourceRun.anchor);
			expect(step?.targetAnchor, operation.id).toEqual(operation.targetRun.anchor);
			expect(step?.junctions, operation.id).toEqual(operation.exactJunctions);
		} else {
			const step = entityById.get(operation.id);
			expect(step, operation.id).toMatchObject({
				kind: "template",
				entityId: operation.id,
				hierarchyRole: operation.role,
				connectionId: null,
				connectionRole: null,
				junctions: null,
			});
		}
	}

	expect(outerSteps).toHaveLength(1);
	expect(outerSteps[0]).toMatchObject({
		templateId: "outer-loop",
		entityId: layout.outer.id,
	});
	expect(spineSteps).toHaveLength(1);
	expect(spineSteps[0]).toMatchObject({
		templateId: "outer-loop",
		entityId: layout.spine.id,
	});
	expect(wallSteps).toHaveLength(1);
	expect(wallSteps[0]).toMatchObject({
		templateId: "outer-loop",
		entityId: layout.wallCircuit.id,
	});
	const outerFlow = expectDirectedRectangularCirculation(map, layout.outer, "outer circulation");
	const spineFlow = expectDirectedRectangularCirculation(map, layout.spine, "central spine");
	const wallFlow = expectDirectedRectangularCirculation(map, layout.wallCircuit, "wall circuit");
	expect(spineFlow).not.toBe(outerFlow);
	expect(wallFlow).not.toBe(outerFlow);
	expect(layout.spine.lengthMeters).toBe(topology.spineWidthMeters);
	expect(layout.spine.depthMeters).toBeGreaterThan(layout.spine.lengthMeters * 4);

	expect(connectionSteps).toHaveLength(
		topology.wings.length + topology.spineWallLinks.length + topology.wallOuterLinks.length,
	);
	expect(connectionById.size).toBe(connectionSteps.length);
	for (const step of connectionSteps) {
		expect(step.outboundTurns, step.connectionId ?? step.label).toBe(0);
		expect(step.returnTurns, step.connectionId ?? step.label).toBe(0);
	}
	for (const step of build.steps.filter((candidate) => candidate.kind === "template")) {
		expect(step.outboundTurns, step.label).toBeNull();
		expect(step.returnTurns, step.label).toBeNull();
	}
	expect(processWingSteps).toHaveLength(topology.wings.length);
	expect(processBaySteps).toHaveLength(targetBayCount);
	expect(new Set(processBaySteps.map((step) => step.entityId)).size).toBe(targetBayCount);
	expect(processBaySteps.every((step) => step.templateId === "branch-bypass")).toBe(true);

	for (const row of topology.processRows) {
		const wingIds = new Set([row.leftWingId, row.rightWingId]);
		const rowTrunks = assembly.operations.filter(
			(operation): operation is SyntheticFabAssemblyProcessTrunkOperation =>
				operation.kind === "process-trunk" && wingIds.has(operation.wingId),
		);
		expect(rowTrunks, row.id).toHaveLength(2);
		expect(new Set(rowTrunks.map((operation) => operation.sourceSide)), row.id).toEqual(
			new Set(["west", "east"]),
		);
		for (const operation of rowTrunks) {
			const step = connectionById.get(operation.id);
			expect(step, operation.id).toBeDefined();
			expect(step?.connectionRole, operation.id).toBe("process-row");
			expect(step?.addedEdges, operation.id).toBeGreaterThan(0);
			expect(map.hasRail(step?.anchor.x ?? 0, step?.anchor.y ?? 0), operation.id).toBe(true);
			expect(
				map.hasRail(step?.targetAnchor?.x ?? 0, step?.targetAnchor?.y ?? 0),
				operation.id,
			).toBe(true);
		}
	}
	for (const gateway of topology.spineWallLinks) {
		expect(connectionById.get(gateway.id), gateway.id).toMatchObject({
			connectionRole: "spine-wall",
			addedEdges: expect.any(Number),
		});
		expect(connectionById.get(gateway.id)?.addedEdges, gateway.id).toBeGreaterThan(0);
	}
	for (const gateway of topology.wallOuterLinks) {
		expect(connectionById.get(gateway.id), gateway.id).toMatchObject({
			connectionRole: "wall-outer",
			addedEdges: expect.any(Number),
		});
		expect(connectionById.get(gateway.id)?.addedEdges, gateway.id).toBeGreaterThan(0);
	}

	const physicalTopology = analyzePhysicalPathTopology(build.physical.paths);
	expect(build.analysis).toMatchObject({
		status: "closed",
		components: 1,
		strongComponents: 1,
		stronglyConnected: true,
		openEnds: 0,
		unsafeJunctions: 0,
	});
	expect(physicalTopology).toMatchObject({
		invalidPaths: 0,
		openPaths: 0,
		strongComponents: 1,
		stronglyConnected: true,
	});
	expect(map.advancedSwitchCount).toBe(0);
	expect(flatCrossingCells(map)).toEqual([]);
}

function expectDirectedRectangularCirculation(
	map: TileMap,
	loop: Readonly<{
		origin: Cell;
		lengthMeters: number;
		depthMeters: number;
	}>,
	label: string,
): "clockwise" | "counter-clockwise" {
	const perimeter = rectangularPerimeterCells(loop);
	const clockwise = perimeter.every((cell, index) =>
		hasDirectedEdge(map, cell, perimeter[(index + 1) % perimeter.length] as Cell),
	);
	const counterClockwise = perimeter.every((cell, index) =>
		hasDirectedEdge(map, perimeter[(index + 1) % perimeter.length] as Cell, cell),
	);

	expect(clockwise || counterClockwise, `${label} must be one continuous directed rectangle`).toBe(
		true,
	);
	expect(clockwise && counterClockwise, `${label} must not contain reverse-overlap rail`).toBe(
		false,
	);
	return clockwise ? "clockwise" : "counter-clockwise";
}

function rectangularPerimeterCells(
	loop: Readonly<{
		origin: Cell;
		lengthMeters: number;
		depthMeters: number;
	}>,
): readonly Cell[] {
	const minX = loop.origin.x;
	const minY = loop.origin.y;
	const maxX = minX + loop.lengthMeters;
	const maxY = minY + loop.depthMeters;
	const cells: Cell[] = [];
	for (let x = minX; x <= maxX; x++) cells.push({ x, y: minY });
	for (let y = minY + 1; y <= maxY; y++) cells.push({ x: maxX, y });
	for (let x = maxX - 1; x >= minX; x--) cells.push({ x, y: maxY });
	for (let y = maxY - 1; y > minY; y--) cells.push({ x: minX, y });
	return cells;
}

function hasDirectedEdge(map: TileMap, from: Cell, to: Cell): boolean {
	const direction = directionBetween(from, to);
	if (direction === null) return false;
	return (
		(map.getRail(from.x, from.y).outgoing & direction) !== 0 &&
		(map.getRail(to.x, to.y).incoming & oppositeDirection(direction)) !== 0
	);
}

function flatCrossingCells(map: TileMap): readonly Cell[] {
	const cells: Cell[] = [];
	map.forEachRail((x, y, rail) => {
		if (bitCount(rail.incoming | rail.outgoing) === 4) cells.push({ x, y });
	});
	return cells;
}

function starterParameterMatrix(id: SyntheticFabStarterId): SyntheticFabStarterRequest[] {
	const item = SYNTHETIC_FAB_STARTER_CATALOG.find((candidate) => candidate.id === id);
	if (!item) throw new Error(`Missing synthetic FAB starter ${id}.`);
	if (id === "bay-bank") {
		const initial = defaultSyntheticFabStarterRequest(id);
		return [
			initial,
			...item.parameters.flatMap((descriptor) => [
				setSyntheticFabStarterParameter(initial, descriptor.key, descriptor.minimum),
				setSyntheticFabStarterParameter(initial, descriptor.key, descriptor.maximum),
			]),
		];
	}
	let requests = [defaultSyntheticFabStarterRequest(id)];
	for (const descriptor of item.parameters) {
		const expanded: SyntheticFabStarterRequest[] = [];
		for (const request of requests) {
			const values = new Set([
				descriptor.minimum,
				request.parameters[descriptor.key],
				descriptor.maximum,
			]);
			for (const value of values) {
				expanded.push(setSyntheticFabStarterParameter(request, descriptor.key, value));
			}
		}
		requests = expanded;
	}
	return requests;
}
