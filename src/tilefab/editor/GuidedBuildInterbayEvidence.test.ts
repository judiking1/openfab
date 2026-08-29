import { describe, expect, it } from "vitest";
import {
	copyStaticFabOrganizationRecord,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import {
	guidedBuildBayBankPairCenterAligned,
	summarizeGuidedBuildInterbayEvidence,
} from "./GuidedBuildInterbayEvidence";

describe("GuidedBuildInterbayEvidence", () => {
	it("keeps an empty project incomplete", () => {
		expect(summarizeGuidedBuildInterbayEvidence(emptyStaticFabOrganizationState())).toEqual({
			semanticBayBankCount: 0,
			detachedBayBankCount: 0,
			semanticFabCount: 0,
			interbayFabCount: 0,
			fabBankCount: 0,
		});
	});

	it("does not accept an empty Fab metadata parent as Interbay", () => {
		const state = hierarchy(false);
		expect(summarizeGuidedBuildInterbayEvidence(state)).toMatchObject({
			semanticBayBankCount: 2,
			semanticFabCount: 1,
			interbayFabCount: 0,
			fabBankCount: 2,
		});
	});

	it("accepts a Fab that directly owns connector rail for two Banks", () => {
		const state = hierarchy(true);
		expect(summarizeGuidedBuildInterbayEvidence(state)).toMatchObject({
			semanticBayBankCount: 2,
			detachedBayBankCount: 0,
			semanticFabCount: 1,
			interbayFabCount: 1,
			fabBankCount: 2,
		});
	});

	it("uses effective authored hierarchy bounds only for alignment coaching", () => {
		const state = hierarchy(true);
		expect(guidedBuildBayBankPairCenterAligned(state, [5, 6])).toBe(true);
		expect(guidedBuildBayBankPairCenterAligned(state, [3, 4])).toBe(false);
	});
});

function hierarchy(fabOwnsRail: boolean): StaticFabOrganizationState {
	const loopA = record(1, "AISLE", [], edge(0, 0, 1, 0));
	const loopB = record(2, "AISLE", [], edge(20, 0, 21, 0));
	const bayA = record(3, "BAY", [5], edge(0, 0, 0, 1));
	const bayB = record(4, "BAY", [6], edge(20, 0, 20, 1));
	const bankA = record(5, "AREA", [7], edge(0, 10, 1, 10));
	const bankB = record(6, "AREA", [7], edge(20, 10, 21, 10));
	const fab = fabOwnsRail
		? record(7, "AREA", [], edge(9, 10, 10, 10))
		: copyStaticFabOrganizationRecord({
				id: 7,
				kind: "AREA",
				name: "ORG 7",
				parentOrganizationIds: [],
				properties: { description: "Synthetic metadata-only parent", color: "TEAL" },
				membership: {
					railEdges: [],
					advancedSwitchIds: [],
					equipmentGroupIds: [999],
				},
			});
	return Object.freeze({
		nextOrganizationId: 8,
		records: Object.freeze([
			copyStaticFabOrganizationRecord({ ...loopA, parentOrganizationIds: [3] }),
			copyStaticFabOrganizationRecord({ ...loopB, parentOrganizationIds: [4] }),
			bayA,
			bayB,
			bankA,
			bankB,
			fab,
		]),
	});
}

function record(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	parentOrganizationIds: readonly number[],
	...railEdges: StaticFabOrganizationRecord["membership"]["railEdges"]
): StaticFabOrganizationRecord {
	return copyStaticFabOrganizationRecord({
		id,
		kind,
		name: `ORG ${id}`,
		parentOrganizationIds,
		properties: { description: "Synthetic guided evidence fixture", color: "TEAL" },
		membership: {
			railEdges,
			advancedSwitchIds: [],
			equipmentGroupIds: [],
		},
	});
}

function edge(fromX: number, fromY: number, toX: number, toY: number) {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}
