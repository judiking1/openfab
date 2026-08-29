import { describe, expect, it } from "vitest";
import { initialRailAreaStampPose, type RailAreaStampTemplate } from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import type { StaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";
import {
	BLUEPRINT_PLACEMENT_CONFLICT_LIMIT,
	BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
	type PrepareBlueprintPlacementRequest,
} from "./BlueprintPlacementProtocol";
import { prepareBlueprintPlacement } from "./BlueprintPlacementRuntime";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";

const THREE_METER_ROUTE = Object.freeze({
	sourceRevision: 0,
	sourceModuleKeys: Object.freeze(["TEST-ROUTE"]),
	sourceModuleCount: 1,
	sourceEdgeCount: 3,
	sourceWidthMeters: 3,
	sourceHeightMeters: 0,
	edges: Object.freeze([
		Object.freeze({ from: Object.freeze({ x: 0, y: 0 }), to: Object.freeze({ x: 1, y: 0 }) }),
		Object.freeze({ from: Object.freeze({ x: 1, y: 0 }), to: Object.freeze({ x: 2, y: 0 }) }),
		Object.freeze({ from: Object.freeze({ x: 2, y: 0 }), to: Object.freeze({ x: 3, y: 0 }) }),
	]),
}) satisfies RailAreaStampTemplate;

function linearRouteTemplate(edgeCount: number): RailAreaStampTemplate {
	return Object.freeze({
		sourceRevision: 0,
		sourceModuleKeys: Object.freeze(["LARGE-TEST-ROUTE"]),
		sourceModuleCount: 1,
		sourceEdgeCount: edgeCount,
		sourceWidthMeters: edgeCount,
		sourceHeightMeters: 0,
		edges: Object.freeze(
			Array.from({ length: edgeCount }, (_, index) =>
				Object.freeze({
					from: Object.freeze({ x: index, y: 0 }),
					to: Object.freeze({ x: index + 1, y: 0 }),
				}),
			),
		),
	});
}

function placementRequest(
	document: RailDocument,
	railTemplate: RailAreaStampTemplate,
	reverseFlow = false,
): PrepareBlueprintPlacementRequest {
	return {
		type: "PREPARE_BLUEPRINT_PLACEMENT",
		requestId: reverseFlow ? 2 : 1,
		snapshot: captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot,
		railTemplate,
		staticFabTemplate: null,
		anchor: { x: 0, y: 0 },
		pose: Object.freeze({ ...initialRailAreaStampPose(), reverseFlow }),
	};
}

function staticFabTemplate(
	rail: RailAreaStampTemplate,
	portCount: number,
): StaticFabBlueprintTemplate {
	return Object.freeze({
		rail,
		ports: Object.freeze(
			Array.from({ length: portCount }, (_, index) =>
				Object.freeze({
					equipmentGroupIndex: index,
					route: Object.freeze({
						kind: "CARDINAL_CELL" as const,
						x: index + 1,
						z: 0,
						from: DIR_W,
						to: DIR_E,
					}),
					stationMillimeters: 500,
					side: "CENTER" as const,
					lateralOffsetMillimeters: 0,
					direction: "WITH_TRAVEL" as const,
					portType: "OHB" as const,
				}),
			),
		),
		equipmentGroups: Object.freeze(
			Array.from({ length: portCount }, (_, index) =>
				Object.freeze({
					kind: "OHB" as const,
					template: "SINGLE" as const,
					portIndices: Object.freeze([index]),
				}),
			),
		),
	});
}

describe("BlueprintPlacementRuntime", () => {
	it("plans and physically validates one exact placement against a typed authored snapshot", () => {
		const document = new RailDocument();
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot;
		let now = 0;
		const prepared = prepareBlueprintPlacement(
			{
				type: "PREPARE_BLUEPRINT_PLACEMENT",
				requestId: 7,
				snapshot,
				railTemplate: THREE_METER_ROUTE,
				staticFabTemplate: null,
				anchor: { x: 20, y: -4 },
				pose: initialRailAreaStampPose(),
			},
			() => ++now,
		);

		expect(prepared).toMatchObject({
			sourceRevision: 0,
			sourcePatchSequence: 0,
			sourceChecksum: snapshot.checksum,
			valid: true,
			conflictCount: 0,
			planningMilliseconds: 1,
			validationMilliseconds: 1,
		});
		if (!("areaStamp" in prepared.plan)) throw new Error("Expected a rail-area placement plan.");
		expect(prepared.plan.areaStamp).toMatchObject({
			planningLevel: "exact",
			anchor: { x: 20, y: -4 },
		});
		expect(prepared.plan.mutations).toHaveLength(4);
	});

	it("returns the exact duplicate rejection without mutating the snapshot source", () => {
		const document = new RailDocument();
		const first = prepareBlueprintPlacement({
			type: "PREPARE_BLUEPRINT_PLACEMENT",
			requestId: 1,
			snapshot: captureRailMirrorSnapshot(document.map, 0).snapshot,
			railTemplate: THREE_METER_ROUTE,
			staticFabTemplate: null,
			anchor: { x: 0, y: 0 },
			pose: initialRailAreaStampPose(),
		});
		expect(document.commit(first.plan)).toBe(true);
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot;

		const duplicate = prepareBlueprintPlacement({
			type: "PREPARE_BLUEPRINT_PLACEMENT",
			requestId: 2,
			snapshot,
			railTemplate: THREE_METER_ROUTE,
			staticFabTemplate: null,
			anchor: { x: 0, y: 0 },
			pose: initialRailAreaStampPose(),
		});

		expect(duplicate.valid).toBe(false);
		expect(duplicate.reason).toContain("이미 설치");
		expect(duplicate.plan.mutations).toHaveLength(0);
		expect(snapshot.revision).toBe(document.map.getRevision());
	});

	it("keeps a large valid placement fully committable after structured clone", () => {
		const edgeCount = BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT + 64;
		const document = new RailDocument();
		const prepared = prepareBlueprintPlacement(
			placementRequest(document, linearRouteTemplate(edgeCount)),
		);

		expect(prepared.valid).toBe(true);
		expect(prepared.plan.cells).toHaveLength(edgeCount + 1);
		expect(prepared.plan.mutations).toHaveLength(edgeCount + 1);

		const cloned = structuredClone(prepared);
		expect(cloned.plan.cells).toHaveLength(edgeCount + 1);
		expect(cloned.plan.mutations).toHaveLength(edgeCount + 1);
		expect(document.commit(cloned.plan)).toBe(true);
		expect(document.map.edgeCount).toBe(edgeCount);
	});

	it("bounds every large invalid rail array and its structured-clone payload", () => {
		const edgeCount = BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT * 8;
		const railTemplate = linearRouteTemplate(edgeCount);
		const document = new RailDocument();
		const installed = prepareBlueprintPlacement(placementRequest(document, railTemplate));
		expect(installed.valid).toBe(true);
		expect(document.commit(installed.plan)).toBe(true);

		const rejected = prepareBlueprintPlacement(placementRequest(document, railTemplate, true));
		expect(rejected.valid).toBe(false);
		expect(rejected.conflictCount).toBeGreaterThan(BLUEPRINT_PLACEMENT_CONFLICT_LIMIT);

		const cloned = structuredClone(rejected);
		expect(cloned.conflictCells).toHaveLength(BLUEPRINT_PLACEMENT_CONFLICT_LIMIT);
		expect(cloned.plan.cells).toHaveLength(BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT);
		expect(cloned.plan.mutations).toHaveLength(BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT);
		expect(cloned.plan.conflicts).toHaveLength(BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT);
		if (!("areaStamp" in cloned.plan)) throw new Error("Expected a rail-area placement plan.");
		expect(cloned.plan.areaStamp).toMatchObject({
			sourceEdgeCount: edgeCount,
			bounds: { minX: 0, minY: 0, maxX: edgeCount, maxY: 0 },
			widthMeters: edgeCount,
			heightMeters: 0,
		});
		expect(cloned.plan.cells[0]).toEqual({ x: 0, y: 0 });
		expect(cloned.plan.cells.at(-1)).toEqual({ x: edgeCount, y: 0 });

		const cloneBytes = new TextEncoder().encode(JSON.stringify(cloned)).byteLength;
		expect(cloneBytes).toBeLessThan(256 * 1024);
	});

	it("removes commit mutations and bounds previews in a large invalid static FAB clone", () => {
		const portCount = BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT + 88;
		const edgeCount = portCount + 1;
		const railTemplate = linearRouteTemplate(edgeCount);
		const document = new RailDocument();
		const installed = prepareBlueprintPlacement(placementRequest(document, railTemplate));
		expect(installed.valid).toBe(true);
		expect(document.commit(installed.plan)).toBe(true);

		const rejected = prepareBlueprintPlacement({
			...placementRequest(document, railTemplate, true),
			staticFabTemplate: staticFabTemplate(railTemplate, portCount),
		});
		expect(rejected.valid).toBe(false);
		if (!("staticFab" in rejected.plan)) {
			throw new Error("Expected a static FAB placement plan.");
		}

		const cloned = structuredClone(rejected);
		if (!("staticFab" in cloned.plan)) throw new Error("Expected a static FAB placement plan.");
		expect(cloned.plan.portMutations).toHaveLength(0);
		expect(cloned.plan.equipmentGroupMutations).toHaveLength(0);
		expect(cloned.plan.staticFab).toMatchObject({
			portCount,
			equipmentGroupCount: portCount,
		});
		expect(cloned.plan.staticFab.portPreviews).toHaveLength(
			BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
		);
		expect(cloned.plan.cells.length).toBeLessThanOrEqual(
			BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
		);
		expect(cloned.plan.mutations.length).toBeLessThanOrEqual(
			BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
		);
		expect(cloned.plan.railPlan.cells.length).toBeLessThanOrEqual(
			BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
		);
		expect(cloned.plan.railPlan.mutations.length).toBeLessThanOrEqual(
			BLUEPRINT_PLACEMENT_INVALID_PLAN_SAMPLE_LIMIT,
		);
	});

	it("physically validates every prospective static FAB port before exposing a commit plan", () => {
		const document = new RailDocument();
		const prepared = prepareBlueprintPlacement({
			...placementRequest(document, THREE_METER_ROUTE),
			staticFabTemplate: staticFabTemplate(THREE_METER_ROUTE, 1),
			anchor: { x: 20, y: -4 },
		});

		expect(prepared.valid).toBe(true);
		if (!("staticFab" in prepared.plan)) throw new Error("Expected a static FAB placement plan.");
		expect(prepared.plan.portMutations).toHaveLength(1);
		expect(prepared.plan.equipmentGroupMutations).toHaveLength(1);
		expect(document.commitStaticFab(prepared.plan)).toBe(true);
	});

	it("rejects a static FAB port whose copied route is no longer a valid authored attachment", () => {
		const document = new RailDocument();
		const vertical = prepareBlueprintPlacement({
			...placementRequest(document, THREE_METER_ROUTE),
			anchor: { x: 0, y: -3 },
			pose: Object.freeze({ quarterTurns: 1, reverseFlow: false }),
		});
		expect(vertical.valid).toBe(true);
		expect(document.commit(vertical.plan)).toBe(true);

		const seamPortTemplate: StaticFabBlueprintTemplate = Object.freeze({
			rail: THREE_METER_ROUTE,
			ports: Object.freeze([
				Object.freeze({
					equipmentGroupIndex: 0,
					route: Object.freeze({
						kind: "CARDINAL_CELL" as const,
						x: 0,
						z: 0,
						from: DIR_W,
						to: DIR_E,
					}),
					stationMillimeters: 500,
					side: "CENTER" as const,
					lateralOffsetMillimeters: 0,
					direction: "WITH_TRAVEL" as const,
					portType: "OHB" as const,
				}),
			]),
			equipmentGroups: Object.freeze([
				Object.freeze({
					kind: "OHB" as const,
					template: "SINGLE" as const,
					portIndices: Object.freeze([0]),
				}),
			]),
		});
		const rejected = prepareBlueprintPlacement({
			...placementRequest(document, THREE_METER_ROUTE),
			staticFabTemplate: seamPortTemplate,
		});

		expect(rejected.valid).toBe(false);
		expect(rejected.reason).toContain("route does not exist in the authored rail map");
		if (!("staticFab" in rejected.plan)) throw new Error("Expected a static FAB placement plan.");
		expect(rejected.plan.portMutations).toHaveLength(0);
		expect(rejected.plan.equipmentGroupMutations).toHaveLength(0);
	});
});
