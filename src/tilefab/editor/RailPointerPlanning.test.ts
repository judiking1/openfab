import { describe, expect, it } from "vitest";
import {
	RAIL_POINTER_MAX_PATH_METERS,
	railPointerPlanningIssue,
	rejectedRailPointerPlan,
} from "./RailPointerPlanning";

describe("railPointerPlanningIssue", () => {
	it("allows distant directional input for fixed geometry while still checking coordinates", () => {
		expect(railPointerPlanningIssue({ x: 0, y: 0 }, { x: 200000, y: 0 }, "direction")).toBeNull();
		for (const target of [
			{ x: 2147483648, y: 0 },
			{ x: NaN, y: 0 },
			{ x: 0.5, y: 0 },
		]) {
			expect(railPointerPlanningIssue({ x: 0, y: 0 }, target, "direction")).not.toBeNull();
		}
	});
	it("admits short gestures at signed coordinates and the exact Manhattan limit", () => {
		expect(
			railPointerPlanningIssue(
				{ x: -10, y: -20 },
				{ x: -10 + RAIL_POINTER_MAX_PATH_METERS, y: -20 },
			),
		).toBeNull();
		expect(railPointerPlanningIssue({ x: -2048, y: -2048 }, { x: 0, y: 0 })).toBeNull();
		expect(railPointerPlanningIssue({ x: -2147483648, y: 0 }, { x: -2147483647, y: 0 })).toBeNull();
	});
	it("rejects diagonal, very wide and malformed gestures before any path is allocated", () => {
		for (const target of [
			{ x: 2048, y: 2049 },
			{ x: 200000, y: 0 },
			{ x: 2147483648, y: 0 },
			{ x: NaN, y: 0 },
			{ x: 0.5, y: 0 },
		]) {
			const issue = railPointerPlanningIssue({ x: 0, y: 0 }, target);
			expect(issue).not.toBeNull();
			const plan = rejectedRailPointerPlan(71, issue as string);
			expect(plan).toMatchObject({
				baseRevision: 71,
				valid: false,
				cells: [],
				mutations: [],
				conflicts: [],
				newEdges: 0,
			});
		}
		expect(railPointerPlanningIssue({ x: Infinity, y: 0 }, { x: 0, y: 0 })).not.toBeNull();
	});
});
