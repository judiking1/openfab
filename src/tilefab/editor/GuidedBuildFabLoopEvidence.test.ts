import { describe, expect, it } from "vitest";
import {
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import {
	EMPTY_GUIDED_BUILD_FAB_LOOP_EVIDENCE,
	summarizeGuidedBuildFabLoopEvidence,
} from "./GuidedBuildFabLoopEvidence";

describe("summarizeGuidedBuildFabLoopEvidence", () => {
	it("keeps an empty project incomplete", () => {
		expect(summarizeGuidedBuildFabLoopEvidence(emptyStaticFabOrganizationState())).toEqual(
			EMPTY_GUIDED_BUILD_FAB_LOOP_EVIDENCE,
		);
	});

	it("does not treat one bidirectional Interbay as redundant outer circulation", () => {
		expect(summarizeGuidedBuildFabLoopEvidence(hierarchy("INTERBAY_ONLY"))).toEqual({
			semanticFabCount: 1,
			eligibleFabCount: 1,
			resilientFabLoopCount: 0,
			resilientBankPairCount: 0,
		});
	});

	it("requires two edge-disjoint routes in both directions", () => {
		expect(summarizeGuidedBuildFabLoopEvidence(hierarchy("OUTBOUND_REDUNDANT"))).toMatchObject({
			resilientFabLoopCount: 0,
			resilientBankPairCount: 0,
		});
	});

	it("accepts a canonical second outbound and return route owned by the same Fab", () => {
		expect(summarizeGuidedBuildFabLoopEvidence(hierarchy("FAB_LOOP"))).toEqual({
			semanticFabCount: 1,
			eligibleFabCount: 1,
			resilientFabLoopCount: 1,
			resilientBankPairCount: 1,
		});
	});
});

type FixtureMode = "INTERBAY_ONLY" | "OUTBOUND_REDUNDANT" | "FAB_LOOP";

function hierarchy(mode: FixtureMode): StaticFabOrganizationState {
	const fabEdges = [edge(1, 0, 10, 0), edge(10, 0, 1, 0)];
	if (mode !== "INTERBAY_ONLY") fabEdges.push(edge(2, 0, 11, 0));
	if (mode === "FAB_LOOP") fabEdges.push(edge(11, 0, 2, 0));
	const records = [
		record(1, "AISLE", [2], [edge(1, 0, 2, 0), edge(2, 0, 1, 0)]),
		record(2, "BAY", [3], [edge(2, 0, 3, 0), edge(3, 0, 2, 0)]),
		record(3, "AREA", [7], [edge(3, 0, 1, 0), edge(1, 0, 3, 0)]),
		record(4, "AISLE", [5], [edge(10, 0, 11, 0), edge(11, 0, 10, 0)]),
		record(5, "BAY", [6], [edge(11, 0, 12, 0), edge(12, 0, 11, 0)]),
		record(6, "AREA", [7], [edge(12, 0, 10, 0), edge(10, 0, 12, 0)]),
		record(7, "AREA", [], fabEdges),
	];
	return Object.freeze({ nextOrganizationId: 8, records: Object.freeze(records) });
}

function record(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	parentOrganizationIds: readonly number[],
	railEdges: StaticFabOrganizationRecord["membership"]["railEdges"],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name: `ORG ${id}`,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		properties: Object.freeze({ description: "Synthetic Fab Loop fixture", color: "TEAL" }),
		membership: Object.freeze({
			railEdges: Object.freeze([...railEdges]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}

function edge(fromX: number, fromY: number, toX: number, toY: number) {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}
