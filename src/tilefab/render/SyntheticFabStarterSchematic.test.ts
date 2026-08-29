import { describe, expect, it } from "vitest";
import { createSyntheticFabAssemblyPlan } from "../compile/SyntheticFabAssemblyPlan";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
	SYNTHETIC_FAB_STARTER_IDS,
	setSyntheticFabStarterParameter,
} from "../compile/SyntheticFabStarter";
import { syntheticFabStarterSchematic } from "./SyntheticFabStarterSchematic";

describe("SyntheticFabStarterSchematic", () => {
	it("derives bounded deterministic catalog sketches without project data", () => {
		for (const id of SYNTHETIC_FAB_STARTER_IDS) {
			const request = defaultSyntheticFabStarterRequest(id);
			const first = syntheticFabStarterSchematic(request);
			const second = syntheticFabStarterSchematic(request);
			expect(second).toEqual(first);
			if (id === "blank") {
				expect(first).toBeNull();
				continue;
			}
			expect(first).not.toBeNull();
			expect(first?.version).toBe(5);
			expect(first?.bounds.maxX).toBeGreaterThan(first?.bounds.minX ?? 0);
			expect(first?.bounds.maxY).toBeGreaterThan(first?.bounds.minY ?? 0);
			expect(`${first?.railPathData} ${first?.connectorPathData}`).not.toMatch(
				/NaN|Infinity|undefined/,
			);
			expect(first?.railPathData.length).toBeLessThan(24_000);
		}
	});

	it("shows the factory preset hierarchy before the exact physical preview is ready", () => {
		const request = defaultSyntheticFabStarterRequest("large-fab-60");
		const assembly = createSyntheticFabAssemblyPlan(
			{
				processBlockCount: request.parameters.processBlockCount,
				totalBayCount: request.parameters.bayCount,
			},
			request.parameters.bayPitchMeters,
		);
		const schematic = syntheticFabStarterSchematic(request);
		expect(schematic).not.toBeNull();
		expect(schematic?.zoneCount).toBe(12);
		expect(schematic?.bayCount).toBe(60);
		expect(schematic?.processRowCount).toBe(6);
		expect(schematic?.processBankCount).toBe(6);
		expect(schematic?.processBlockCount).toBe(3);
		expect(schematic?.interbaySpineCount).toBe(1);
		expect(schematic?.wallCircuitCount).toBe(1);
		expect(schematic?.outerCirculationCount).toBe(1);
		expect(schematic?.wallCircuitLinkCount).toBe(18);
		expect(schematic?.outerGatewayCount).toBe(4);
		expect(schematic?.gatewayMarkers.map((marker) => marker.side).sort()).toEqual([
			"east",
			"north",
			"south",
			"west",
		]);
		expect(schematic?.flowMarkers.map((marker) => marker.role).sort()).toEqual([
			"outer",
			"spine",
			"wall",
		]);
		expect(schematic?.semanticPathData.outer).not.toBe("");
		expect(schematic?.semanticPathData.wall).not.toBe("");
		expect(schematic?.semanticPathData.spine).not.toBe("");
		expect(schematic?.semanticPathData.process).not.toBe("");
		expect(schematic?.planFingerprint).toBe(assembly.planFingerprint);
		expect(schematic?.railPathData.match(/\bM\b/g)?.length).toBe(63);
		expect(schematic?.connectorPathData).not.toBe("");
		expect(schematic?.connectorPathData.match(/\bM\b/g)?.length).toBe(36);
		expect(schematic?.bounds.minX).toBeLessThan(0);
		expect(schematic?.bounds.minY).toBeLessThan(0);
	});

	it("shows one full FAB as two process halls, four Banks, and 104 Process Loops", () => {
		const request = defaultSyntheticFabStarterRequest("full-fab-52");
		const schematic = syntheticFabStarterSchematic(request);

		expect(schematic).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
			processRowCount: 104,
			processBankCount: 4,
			processBlockCount: 2,
			interbaySpineCount: 2,
			wallCircuitCount: 0,
			outerCirculationCount: 1,
			wallCircuitLinkCount: 8,
			outerGatewayCount: 4,
			bounds: { minX: 0, minY: 0, maxX: 632, maxY: 608 },
		});
		expect(schematic?.railPathData.match(/\bM\b/g)?.length).toBe(163);
		expect(schematic?.connectorPathData.match(/\bM\b/g)?.length).toBe(16);
		expect(schematic?.gatewayMarkers.map((marker) => marker.side)).toEqual([
			"west",
			"east",
			"west",
			"east",
		]);
		expect(schematic?.flowMarkers.map((marker) => marker.role)).toEqual([
			"outer",
			"spine",
			"spine",
		]);
	});

	it("shows the paired production profile before compiling its 33k-cell authored map", () => {
		const schematic = syntheticFabStarterSchematic(
			defaultSyntheticFabStarterRequest("paired-circulation-fab-52"),
		);

		expect(schematic).toMatchObject({
			zoneCount: 4,
			bayCount: 52,
			processRowCount: 87,
			processBankCount: 4,
			processBlockCount: 2,
			interbaySpineCount: 2,
			wallCircuitCount: 0,
			outerCirculationCount: 2,
			wallCircuitLinkCount: 4,
			outerGatewayCount: 4,
			bounds: { minX: 0, minY: 0, maxX: 712, maxY: 524 },
		});
		expect(schematic?.railPathData.match(/\bM\b/g)?.length).toBe(143);
		expect(schematic?.connectorPathData.match(/\bM\b/g)?.length).toBe(116);
		expect(schematic?.gatewayMarkers.map((marker) => marker.side)).toEqual([
			"west",
			"east",
			"west",
			"east",
		]);
		expect(schematic?.flowMarkers.map((marker) => marker.role)).toEqual([
			"outer",
			"outer",
			"spine",
			"spine",
		]);
	});

	it("shows the production hierarchy as Banks, real Bays, and two Process Loops per Bay", () => {
		const request = defaultSyntheticFabStarterRequest("production-fab-60");
		const schematic = syntheticFabStarterSchematic(request);

		expect(schematic).toMatchObject({
			zoneCount: 3,
			bayCount: 60,
			processRowCount: 120,
			processBankCount: 3,
			processBlockCount: 1,
			interbaySpineCount: 1,
			wallCircuitCount: 0,
			outerCirculationCount: 1,
			wallCircuitLinkCount: 0,
			outerGatewayCount: 0,
		});
		expect(schematic?.semanticPathData.outer).not.toBe("");
		expect(schematic?.semanticPathData.wall).toBe("");
		expect(schematic?.semanticPathData.spine).not.toBe("");
		expect(schematic?.semanticPathData.process).not.toBe("");
		expect(schematic?.gatewayMarkers).toHaveLength(0);
		expect(schematic?.flowMarkers.map((marker) => marker.role)).toEqual(["outer", "spine"]);
		expect(schematic?.railPathData.match(/\bM\b/g)?.length).toBe(185);
		expect(schematic?.connectorPathData).toBe("");
	});

	it("shows the parallel production hall with collectors and explicit outer gateways", () => {
		const request = defaultSyntheticFabStarterRequest("parallel-hall-fab-12");
		const schematic = syntheticFabStarterSchematic(request);

		expect(schematic).toMatchObject({
			zoneCount: 2,
			bayCount: 12,
			processRowCount: 24,
			processBankCount: 2,
			processBlockCount: 1,
			interbaySpineCount: 1,
			wallCircuitCount: 0,
			outerCirculationCount: 1,
			wallCircuitLinkCount: 4,
			outerGatewayCount: 2,
			bounds: { minX: 0, minY: 0, maxX: 324, maxY: 316 },
		});
		expect(schematic?.railPathData.match(/\bM\b/g)?.length).toBe(40);
		expect(schematic?.connectorPathData.match(/\bM\b/g)?.length).toBe(8);
		expect(schematic?.gatewayMarkers.map((marker) => marker.side)).toEqual(["west", "east"]);
		expect(schematic?.flowMarkers.map((marker) => marker.role)).toEqual(["outer", "spine"]);
		expect(schematic?.semanticPathData.process).not.toBe("");
	});

	it("updates configurable proportions without compiling authored rail", () => {
		const initial = defaultSyntheticFabStarterRequest("fab-block");
		const expanded = setSyntheticFabStarterParameter(initial, "bayCount", 6);
		const initialSchematic = syntheticFabStarterSchematic(initial);
		const expandedSchematic = syntheticFabStarterSchematic(expanded);
		expect(initialSchematic?.bayCount).toBe(4);
		expect(expandedSchematic?.bayCount).toBe(6);
		expect(expandedSchematic?.bounds.maxX).toBeGreaterThan(
			initialSchematic?.bounds.maxX ?? Number.POSITIVE_INFINITY,
		);
		expect(expandedSchematic?.railPathData).not.toBe(initialSchematic?.railPathData);
	});

	it("updates the large FAB schematic Bay allocation before exact physical compilation", () => {
		const initial = defaultSyntheticFabStarterRequest("large-fab-60");
		const expanded = setSyntheticFabStarterParameter(initial, "bayCount", 100);
		const initialSchematic = syntheticFabStarterSchematic(initial);
		const expandedSchematic = syntheticFabStarterSchematic(expanded);

		expect(initialSchematic?.bayCount).toBe(60);
		expect(expandedSchematic?.bayCount).toBe(100);
		expect(expandedSchematic?.planFingerprint).not.toBe(initialSchematic?.planFingerprint);
		expect(expandedSchematic?.bounds.maxX).toBeGreaterThan(
			initialSchematic?.bounds.maxX ?? Number.POSITIVE_INFINITY,
		);
		expect(expandedSchematic?.railPathData).not.toBe(initialSchematic?.railPathData);
	});

	it("expands the rectangular FAB vertically when Process Blocks increase", () => {
		const initial = defaultSyntheticFabStarterRequest("large-fab-60");
		const expanded = setSyntheticFabStarterParameter(initial, "processBlockCount", 6);
		const initialSchematic = syntheticFabStarterSchematic(initial);
		const expandedSchematic = syntheticFabStarterSchematic(expanded);

		expect(expandedSchematic).toMatchObject({
			zoneCount: 24,
			bayCount: 60,
			processRowCount: 12,
			processBankCount: 12,
			processBlockCount: 6,
		});
		expect(expandedSchematic?.bounds.maxY).toBeGreaterThan(
			initialSchematic?.bounds.maxY ?? Number.POSITIVE_INFINITY,
		);
		expect(expandedSchematic?.railPathData).not.toBe(initialSchematic?.railPathData);
	});

	it("normalizes raw large-FAB controls through the same contract as exact construction", () => {
		const initial = defaultSyntheticFabStarterRequest("large-fab-60");
		const raw = {
			...initial,
			parameters: {
				...initial.parameters,
				bayCount: 101,
				bayPitchMeters: 21,
				processBlockCount: 7,
			},
		};
		const schematic = syntheticFabStarterSchematic(raw);
		const exact = buildSyntheticFabStarter(raw);

		expect(exact.request.parameters).toMatchObject({
			bayCount: 100,
			bayPitchMeters: 22,
			processBlockCount: 6,
		});
		expect(schematic).toMatchObject({
			bayCount: 100,
			processBlockCount: 6,
			planFingerprint: exact.planFingerprint,
		});
	}, 30_000);
});
