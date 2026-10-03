import { expect } from "vitest";
import type { SourceBoundCooperativeTask } from "./SourceBoundCooperativeTask";
import {
	copyStaticFabOrganizationState,
	createCanonicalStaticFabOrganizationStateBuilder,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import {
	createStaticFabOrganizationMetadataLookupPreparation,
	type StaticFabOrganizationMetadataLookup,
} from "./StaticFabOrganizationMetadataLookup";

// Metadata-only fixtures, not a physical network/gateway/topology/mutation proof.
export function record(
	id: number,
	kind: StaticFabOrganizationKind,
	parents: readonly number[] = [],
	declared = false,
	name = `synthetic ${id}`,
): StaticFabOrganizationRecord {
	return {
		id,
		kind,
		name,
		parentOrganizationIds: parents,
		declaredSemanticRole: declared ? "PROCESS_LOOP" : null,
		membership: {
			railEdges: [{ from: { x: id * 2, y: 0 }, to: { x: id * 2 + 1, y: 0 } }],
			advancedSwitchIds: [],
			equipmentGroupIds: [],
		},
	};
}

export function bay(
	id: number,
	parents: readonly number[] = [],
): readonly StaticFabOrganizationRecord[] {
	return [record(id, "BAY", parents), record(id + 1, "AISLE", [id])];
}

export function state(records: readonly StaticFabOrganizationRecord[]): StaticFabOrganizationState {
	let maximumId = 0;
	for (const item of records) maximumId = Math.max(maximumId, item.id);
	return copyStaticFabOrganizationState({
		nextOrganizationId: maximumId + 1,
		records: [...records].sort((left, right) => left.id - right.id),
	});
}

export function loops(count: number, commonNamePrefix = ""): StaticFabOrganizationState {
	const builder = createCanonicalStaticFabOrganizationStateBuilder(count + 1);
	for (let id = 1; id <= count; id++) {
		builder.addRailEdge({ from: { x: id * 2, y: 0 }, to: { x: id * 2 + 1, y: 0 } });
		builder.finishRecord({
			id,
			kind: "AISLE",
			name: `${commonNamePrefix}${id === count ? "Rare Last" : "Loop"} ${id}`,
			declaredSemanticRole: "PROCESS_LOOP",
			description: "",
			color: "TEAL",
		});
	}
	return builder.finish();
}

export function advance<T>(task: SourceBoundCooperativeTask<T>, budget = 128): number {
	let turns = 0;
	while (!task.done) {
		const operations = task.step(budget);
		expect(operations).toBeGreaterThan(0);
		expect(operations).toBeLessThanOrEqual(Math.min(budget, 128));
		if (++turns > 2_000_000) throw new Error("Proposed fixture exceeded its operation bound.");
	}
	return turns;
}

export function lookup(
	organizations: StaticFabOrganizationState,
	isCurrent: (source: StaticFabOrganizationState) => boolean = (source) => source === organizations,
): StaticFabOrganizationMetadataLookup {
	const preparation = createStaticFabOrganizationMetadataLookupPreparation(
		organizations,
		isCurrent,
	);
	advance(preparation);
	return preparation.finish();
}

export function expectCode(run: () => unknown, code: string): void {
	let caught: unknown;
	try {
		run();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(Error);
	expect(caught).toMatchObject({ code });
}
