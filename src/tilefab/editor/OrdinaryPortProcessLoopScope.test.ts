import { describe, expect, it } from "vitest";
import { type CompiledPortSlots, PORT_SLOT_STATUS } from "../compile/PortSlotCompiler";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import type { StaticFabOrganizationRecord } from "../core/StaticFabOrganization";
import {
	compileOrdinaryPortProcessLoopScope,
	ordinaryPortProcessLoopScopeMatches,
} from "./OrdinaryPortProcessLoopScope";

describe("compileOrdinaryPortProcessLoopScope", () => {
	it("includes legal rows only when both directed route edges belong directly to the Loop", () => {
		const slots = slotsFor([
			{ x: 0, from: DIR_W, to: DIR_E, status: PORT_SLOT_STATUS.LEGAL },
			{ x: 1, from: DIR_W, to: DIR_E, status: PORT_SLOT_STATUS.LEGAL },
			{ x: 9, from: DIR_W, to: DIR_E, status: PORT_SLOT_STATUS.LEGAL },
			{ x: 0, from: DIR_W, to: DIR_E, status: PORT_SLOT_STATUS.PORT_OCCUPIED },
			{ x: 3, from: DIR_W, to: DIR_E, status: PORT_SLOT_STATUS.LEGAL },
			{ x: 5, from: DIR_W, to: DIR_E, status: PORT_SLOT_STATUS.LEGAL },
			{ x: 0, from: 0, to: DIR_E, status: PORT_SLOT_STATUS.LEGAL },
		]);
		const loop = processLoop([
			edge(-1, 0),
			edge(0, 1),
			edge(1, 2),
			edge(2, 3), // The row at x=3 has only its incoming edge.
		]);
		const originalStatuses = slots.statuses.slice();

		const scope = compileOrdinaryPortProcessLoopScope(slots, loop);

		expect([...scope.rowMask]).toEqual([1, 1, 0, 0, 0, 0, 0]);
		expect(scope.eligibleCount).toBe(2);
		expect(scope.organizationId).toBe(loop.id);
		expect(slots.statuses).toEqual(originalStatuses);
	});

	it("does not infer nearby or inherited rail and cannot grant a cardinal row from switch-only scope", () => {
		const slots = slotsFor([{ x: 0, from: DIR_W, to: DIR_E, status: PORT_SLOT_STATUS.LEGAL }]);
		const neighboringLoop = processLoop([edge(1, 2), edge(2, 3)]);
		const switchOnlyLoop = processLoop([], [11]);
		const emptyLoop = processLoop([]);

		expect(compileOrdinaryPortProcessLoopScope(slots, neighboringLoop).eligibleCount).toBe(0);
		expect([...compileOrdinaryPortProcessLoopScope(slots, switchOnlyLoop).rowMask]).toEqual([0]);
		expect([...compileOrdinaryPortProcessLoopScope(slots, emptyLoop).rowMask]).toEqual([0]);
	});

	it("binds the derived mask to the exact slot and organization generations", () => {
		const slots = slotsFor([{ x: 0, from: DIR_W, to: DIR_E, status: PORT_SLOT_STATUS.LEGAL }]);
		const loop = processLoop([edge(-1, 0), edge(0, 1)]);
		const scope = compileOrdinaryPortProcessLoopScope(slots, loop);

		expect(ordinaryPortProcessLoopScopeMatches(scope, slots, loop)).toBe(true);
		expect(ordinaryPortProcessLoopScopeMatches(scope, slotsFor([]), loop)).toBe(false);
		expect(
			ordinaryPortProcessLoopScopeMatches(scope, slots, processLoop(loop.membership.railEdges)),
		).toBe(false);
	});
});

interface SlotRow {
	readonly x: number;
	readonly from: number;
	readonly to: number;
	readonly status: number;
}

function slotsFor(rows: readonly SlotRow[]): CompiledPortSlots {
	return {
		revision: 1,
		portType: "OHB",
		count: rows.length,
		legalCount: rows.filter((row) => row.status === PORT_SLOT_STATUS.LEGAL).length,
		routeXs: Int32Array.from(rows.map((row) => row.x)),
		routeZs: new Int32Array(rows.length),
		routeFromDirections: Uint8Array.from(rows.map((row) => row.from)),
		routeToDirections: Uint8Array.from(rows.map((row) => row.to)),
		statuses: Uint8Array.from(rows.map((row) => row.status)),
	} as CompiledPortSlots;
}

function edge(fromX: number, toX: number): DirectedRailEdge {
	return { from: { x: fromX, y: 0 }, to: { x: toX, y: 0 } };
}

function processLoop(
	railEdges: readonly DirectedRailEdge[],
	advancedSwitchIds: readonly number[] = [],
): StaticFabOrganizationRecord {
	return {
		id: 7,
		kind: "AISLE",
		name: "Synthetic Process Loop",
		membership: { railEdges, advancedSwitchIds, equipmentGroupIds: [] },
	};
}
