import { describe, expect, it } from "vitest";
import { analyzePhysicalPathTopology } from "../compile/PhysicalPathTopology";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { analyzeRailNetwork } from "../core/network";
import { recognizeProductionBayModule } from "../core/ProductionBayModuleRecognition";
import { deriveStaticFabOrganizationSemanticRoles } from "../core/StaticFabOrganization";
import {
	planStaticFabSemanticBayMutationWithProspectiveState,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
} from "../core/StaticFabSemanticBayMutation";
import {
	createBayFlowEditScaleProbeDocument,
	createRailEquipmentScaleProbeDocument,
	createRailScaleProbeDocument,
	createSemanticBayDeleteScaleProbeDocument,
} from "../worker/RailStartupFixture";
import {
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA,
	RAIL_SCALE_ACCEPTANCE_VERSION,
	RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_METADATA,
} from "../worker/RailStartupProtocol";
import {
	parseRailEquipmentScaleProbePortCount,
	parseRailScaleProbeCellCount,
	parseRailScaleProbeRootCount,
} from "./RailScaleProbeFixture";

describe("RailScaleProbeFixture", () => {
	it("accepts only the documented browser scale fixtures", () => {
		expect(parseRailScaleProbeCellCount("?scaleFixture=10000")).toBe(10_000);
		expect(parseRailScaleProbeCellCount("?scaleFixture=50000&ignored=true")).toBe(50_000);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100001&scaleRoots=4")).toBe(100_001);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100002&scaleRoots=2")).toBe(100_002);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100004&scaleRoots=3")).toBe(100_004);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100001")).toBe(0);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100001&scaleRoots=2")).toBe(0);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100002")).toBe(0);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100002&scaleRoots=4")).toBe(0);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100004")).toBe(0);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100004&scaleRoots=2")).toBe(0);
		expect(parseRailScaleProbeCellCount("?scaleFixture=100004&scaleRoots=4")).toBe(0);
		expect(parseRailScaleProbeCellCount("?scaleFixture=25000")).toBe(0);
		expect(parseRailScaleProbeCellCount("?scaleFixture=invalid")).toBe(0);
	});

	it("enables the isolated two-root arrangement probe only by explicit query", () => {
		expect(parseRailScaleProbeRootCount("?scaleFixture=10000")).toBe(1);
		expect(parseRailScaleProbeRootCount("?scaleFixture=10000&scaleRoots=2")).toBe(2);
		expect(parseRailScaleProbeRootCount("?scaleFixture=100001&scaleRoots=4")).toBe(4);
		expect(parseRailScaleProbeRootCount("?scaleFixture=100002&scaleRoots=2")).toBe(2);
		expect(parseRailScaleProbeRootCount("?scaleFixture=100004&scaleRoots=3")).toBe(3);
		expect(parseRailScaleProbeRootCount("?scaleRoots=3")).toBe(3);
		expect(parseRailScaleProbeRootCount("?scaleRoots=4")).toBe(1);
	});

	it("enables the exact 50,000-port equipment probe only on its one-root rail fixture", () => {
		expect(parseRailEquipmentScaleProbePortCount("?scaleFixture=50000&equipmentPorts=50000")).toBe(
			50_000,
		);
		expect(
			parseRailEquipmentScaleProbePortCount(
				"?scaleFixture=50000&equipmentPorts=50000&scaleRoots=1",
			),
		).toBe(50_000);
		expect(parseRailEquipmentScaleProbePortCount("?scaleFixture=50000")).toBe(0);
		expect(
			parseRailEquipmentScaleProbePortCount(
				"?scaleFixture=50000&equipmentPorts=50000&scaleRoots=2",
			),
		).toBe(0);
	});

	it("publishes an exact public-safe Bay Flow Edit scale contract", () => {
		expect(RAIL_SCALE_ACCEPTANCE_VERSION).toBe(18);
		expect(RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA).toEqual({
			cellCount: 100_004,
			rootCount: 3,
			authoredEdgeCount: 100_008,
			physicalPathCount: 100_012,
			organizationCount: 3,
			weakComponentCount: 2,
			strongComponentCount: 2,
			targetBayOrganizationId: 1,
			sourceInternalFlowPattern: "alternating",
			targetInternalFlowPattern: "co-rotating",
		});
		expect(Object.isFrozen(RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA)).toBe(true);
	});

	it("publishes an exact public-safe Semantic Bay equipment dependency contract", () => {
		expect(RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_METADATA).toEqual({
			cellCount: 100_002,
			rootCount: 2,
			targetBayOrganizationId: 1,
			sourcePortCount: 5,
			sourceEquipmentGroupCount: 4,
			deletedPortIds: [1, 2, 3, 4],
			deletedEquipmentGroupIds: [1, 2, 3],
			deletedEquipmentKinds: ["EQ", "OHB", "STK"],
			bayEquipmentGroupIds: [2],
			processLoopOrganizationId: 2,
			processLoopEquipmentGroupIds: [1, 3],
			retainedPortIds: [5],
			retainedEquipmentGroupIds: [4],
			nextPortId: 6,
			nextEquipmentGroupId: 5,
		});
		expect(Object.isFrozen(RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_METADATA)).toBe(true);
	});

	it("compiles a small topology-isomorphic detached Twin Bay flow fixture exactly", () => {
		const document = createBayFlowEditScaleProbeDocument(10);
		const authored = analyzeRailNetwork(document.map);
		const physical = analyzePhysicalPathTopology(compilePhysicalRail(document.map).paths);
		const recognition = recognizeProductionBayModule(
			document.map,
			document.organizations,
			RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA.targetBayOrganizationId,
		);

		expect(document.map.size).toBe(302);
		expect(document.map.edgeCount).toBe(306);
		expect(document.organizations.records).toHaveLength(3);
		expect(authored).toMatchObject({
			cells: 302,
			edges: 306,
			components: 2,
			strongComponents: 2,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		expect(physical).toMatchObject({
			paths: 306,
			invalidPaths: 0,
			openPaths: 0,
			strongComponents: 2,
			stronglyConnected: false,
		});
		expect(recognition.valid).toBe(true);
		if (!recognition.valid) return;
		expect(recognition.recognition.plan.specification).toMatchObject({
			processLoopCount: 2,
			internalFlowPattern: RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA.sourceInternalFlowPattern,
		});
	});

	it("compiles a small topology-isomorphic detached semantic Bay Delete fixture exactly", () => {
		const document = createSemanticBayDeleteScaleProbeDocument(16);
		const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
		const authored = analyzeRailNetwork(document.map);
		const physical = analyzePhysicalPathTopology(compilePhysicalRail(document.map).paths);

		expect(document.map.size).toBe(208);
		expect(document.organizations.records).toHaveLength(2);
		expect(roles.get(1)).toBe("BAY");
		expect(roles.get(2)).toBe("PROCESS_LOOP");
		expect(document.organizations.records[0]?.parentOrganizationIds).toEqual([]);
		expect(document.organizations.records[1]?.parentOrganizationIds).toEqual([1]);
		expect(document.portEquipment).toMatchObject({
			nextPortId: 6,
			nextEquipmentGroupId: 5,
			ports: [
				{ id: 1, equipmentGroupId: 1, portType: "EQ", direction: "WITH_TRAVEL" },
				{ id: 2, equipmentGroupId: 1, portType: "EQ", direction: "WITH_TRAVEL" },
				{ id: 3, equipmentGroupId: 2, portType: "OHB", direction: "WITH_TRAVEL" },
				{ id: 4, equipmentGroupId: 3, portType: "STK", direction: "WITH_TRAVEL" },
				{ id: 5, equipmentGroupId: 4, portType: "OHB", direction: "AGAINST_TRAVEL" },
			],
			equipmentGroups: [
				{ id: 1, kind: "EQ", portIds: [1, 2] },
				{ id: 2, kind: "OHB", portIds: [3] },
				{ id: 3, kind: "STK", template: "FLEX", portIds: [4] },
				{ id: 4, kind: "OHB", portIds: [5] },
			],
		});
		expect(document.organizations.records[0]?.membership.equipmentGroupIds).toEqual([2]);
		expect(document.organizations.records[1]?.membership.equipmentGroupIds).toEqual([1, 3]);
		expect(authored).toMatchObject({
			cells: 208,
			edges: 212,
			components: 2,
			strongComponents: 2,
			openEnds: 0,
			unsafeJunctions: 0,
		});
		expect(physical).toMatchObject({
			paths: 216,
			invalidPaths: 0,
			openPaths: 0,
			strongComponents: 2,
			stronglyConnected: false,
		});

		const deletion = planStaticFabSemanticBayMutationWithProspectiveState(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			Object.freeze({
				version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
				action: "DELETE",
				bayOrganizationId: RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_METADATA.targetBayOrganizationId,
			}),
		);
		expect(deletion.plan.valid, deletion.plan.reason).toBe(true);
		expect(deletion.plan.review).toMatchObject({
			portCount: 4,
			portIds: [1, 2, 3, 4],
			equipmentGroupCount: 3,
			equipmentGroupIds: [1, 2, 3],
		});
		expect(deletion.plan.portMutations).toHaveLength(4);
		expect(deletion.plan.equipmentGroupMutations).toHaveLength(3);
		expect(deletion.prospectiveState?.portEquipment).toMatchObject({
			nextPortId: 6,
			nextEquipmentGroupId: 5,
			ports: [{ id: 5, direction: "AGAINST_TRAVEL" }],
			equipmentGroups: [{ id: 4, kind: "OHB", portIds: [5] }],
		});
		expect(deletion.prospectiveState?.organizations.records).toEqual([]);
	});

	it("creates one atomic, undoable directed route", () => {
		const document = createRailScaleProbeDocument(25);
		expect(document.map.size).toBe(25);
		expect(document.map.edgeCount).toBe(24);
		expect(document.map.getRevision()).toBe(25);
		expect(document.getPatchSequence()).toBe(1);
		expect(document.canUndo).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.map.size).toBe(0);
	});

	it("creates a canonical public-safe equipment scale source with one OHB per rail cell", () => {
		const document = createRailEquipmentScaleProbeDocument(25);
		expect(document.map.size).toBe(25);
		expect(document.portEquipment).toMatchObject({
			nextPortId: 26,
			nextEquipmentGroupId: 26,
		});
		expect(document.portEquipment.ports).toHaveLength(25);
		expect(document.portEquipment.equipmentGroups).toHaveLength(25);
		expect(document.portEquipment.ports[0]).toMatchObject({
			id: 1,
			equipmentGroupId: 1,
			portType: "OHB",
		});
		expect(document.portEquipment.equipmentGroups[24]).toEqual({
			id: 25,
			kind: "OHB",
			template: "SINGLE",
			portIds: [25],
		});
	});

	it("rejects unsafe fixture sizes", () => {
		expect(() => createRailScaleProbeDocument(1)).toThrow(RangeError);
		expect(() => createRailScaleProbeDocument(50_001)).toThrow(RangeError);
		expect(() => createRailScaleProbeDocument(2.5)).toThrow(RangeError);
		expect(() => createRailScaleProbeDocument(100_002)).toThrow(RangeError);
		expect(() => createRailScaleProbeDocument(100_004, 2)).toThrow(RangeError);
		expect(() => createSemanticBayDeleteScaleProbeDocument(9)).toThrow(RangeError);
		expect(() => createSemanticBayDeleteScaleProbeDocument(14)).toThrow(RangeError);
		expect(() => createBayFlowEditScaleProbeDocument(9)).toThrow(RangeError);
	});
});
