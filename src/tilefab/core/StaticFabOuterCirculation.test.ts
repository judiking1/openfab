import { describe, expect, it } from "vitest";
import type {
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "./StaticFabOrganization";
import { deriveStaticFabOrganizationSemanticRoles } from "./StaticFabOrganization";
import {
	analyzeStaticFabOuterCirculation,
	createStaticFabOuterCirculationIndex,
	staticFabBankPairHasResilientCirculation,
	staticFabBankPairHasResilientCirculationInIndex,
	staticFabHasExactDirectBankPairInIndex,
} from "./StaticFabOuterCirculation";

describe("StaticFabOuterCirculation", () => {
	it("rejects a single round trip and outbound-only redundancy", () => {
		const single = fabState([...path("A", "B", "C"), ...path("C", "D", "A")]);
		expect(staticFabBankPairHasResilientCirculation(single, 15, 7, 14)).toBe(false);
		expect(analyzeStaticFabOuterCirculation(single)).toMatchObject({
			semanticFabCount: 1,
			eligibleFabCount: 1,
			resilientFabLoopCount: 0,
			resilientBankPairCount: 0,
		});

		const outboundOnly = fabState([
			...path("A", "B", "C"),
			...path("A", "E", "C"),
			...path("C", "D", "A"),
		]);
		expect(staticFabBankPairHasResilientCirculation(outboundOnly, 15, 7, 14)).toBe(false);
	});

	it("rejects duplicated and shared directed edges as independent routes", () => {
		const duplicated = path("A", "B", "C");
		const duplicateEdges = fabState([
			...duplicated,
			...duplicated,
			...path("C", "D", "A"),
			...path("C", "E", "A"),
		]);
		expect(staticFabBankPairHasResilientCirculation(duplicateEdges, 15, 7, 14)).toBe(false);

		const sharedTail = fabState([
			...path("A", "B", "X", "C"),
			...path("A", "E", "X", "C"),
			...path("C", "D", "A"),
			...path("C", "F", "A"),
		]);
		expect(staticFabBankPairHasResilientCirculation(sharedTail, 15, 7, 14)).toBe(false);
	});

	it("accepts two edge-disjoint directed routes in both directions", () => {
		const resilient = fabState([
			...path("A", "B", "C"),
			...path("A", "E", "C"),
			...path("C", "D", "A"),
			...path("C", "F", "A"),
		]);
		expect(staticFabBankPairHasResilientCirculation(resilient, 15, 7, 14)).toBe(true);
		expect(
			staticFabHasExactDirectBankPairInIndex(
				createStaticFabOuterCirculationIndex(resilient),
				15,
				7,
				14,
			),
		).toBe(true);
		expect(analyzeStaticFabOuterCirculation(resilient)).toEqual({
			semanticFabCount: 1,
			eligibleFabCount: 1,
			resilientFabLoopCount: 1,
			resilientBankPairCount: 1,
		});
	});

	it("fails closed for another Fab and a non-direct Bank", () => {
		const resilient = fabState([
			...path("A", "B", "C"),
			...path("A", "E", "C"),
			...path("C", "D", "A"),
			...path("C", "F", "A"),
		]);
		expect(staticFabBankPairHasResilientCirculation(resilient, 99, 7, 14)).toBe(false);
		expect(staticFabBankPairHasResilientCirculation(resilient, 15, 7, 8)).toBe(false);
	});

	it("distinguishes one resilient pair from whole-Fab resilience with three Banks", () => {
		const pairOnly = fabState(
			[
				...path("A", "B", "C"),
				...path("A", "E", "C"),
				...path("C", "D", "A"),
				...path("C", "F", "A"),
			],
			true,
		);
		expect(staticFabBankPairHasResilientCirculation(pairOnly, 15, 7, 14)).toBe(true);
		expect(
			staticFabHasExactDirectBankPairInIndex(
				createStaticFabOuterCirculationIndex(pairOnly),
				15,
				7,
				14,
			),
		).toBe(false);
		expect(staticFabBankPairHasResilientCirculation(pairOnly, 15, 7, 21)).toBe(false);
		expect(analyzeStaticFabOuterCirculation(pairOnly)).toEqual({
			semanticFabCount: 1,
			eligibleFabCount: 1,
			resilientFabLoopCount: 0,
			resilientBankPairCount: 1,
		});
	});

	it("keeps a native exact-pair selection query bounded after indexing 100,000 unrelated records", () => {
		const base = fabState([
			...path("A", "B", "C"),
			...path("A", "E", "C"),
			...path("C", "D", "A"),
			...path("C", "F", "A"),
		]);
		const organizations = Object.freeze({
			nextOrganizationId: 100_100,
			records: Object.freeze([
				...base.records,
				...Array.from({ length: 100_000 }, (_, index) => record(index + 100, "PROCESS_FAMILY")),
			]),
		});
		const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
		const recordsById = new Map(organizations.records.map((item) => [item.id, item] as const));
		const index = createStaticFabOuterCirculationIndex(organizations, roles, recordsById);
		const startedAt = performance.now();
		expect(staticFabBankPairHasResilientCirculationInIndex(index, 15, 7, 14)).toBe(true);
		expect(performance.now() - startedAt).toBeLessThan(60);
	}, 10_000);
});

function fabState(
	fabEdges: readonly ReturnType<typeof edge>[],
	includeThirdBank = false,
): StaticFabOrganizationState {
	const records = [
		...bankHierarchy(7, 8, "A", 15),
		...bankHierarchy(14, 16, "C", 15),
		record(15, "AREA", [], fabEdges),
		...(includeThirdBank ? bankHierarchy(21, 22, "Z", 15) : []),
	].sort((left, right) => left.id - right.id);
	return Object.freeze({ nextOrganizationId: includeThirdBank ? 24 : 18, records });
}

function bankHierarchy(
	bankId: number,
	bayId: number,
	vertex: string,
	fabId: number,
): readonly StaticFabOrganizationRecord[] {
	const coordinate = point(vertex);
	return Object.freeze([
		record(
			bankId,
			"AREA",
			[fabId],
			[edge(coordinate.x, coordinate.y, coordinate.x + 1, coordinate.y)],
		),
		record(bayId, "BAY", [bankId]),
		record(bayId + 1, "AISLE", [bayId]),
	]);
}

function record(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	parentOrganizationIds: readonly number[] = [],
	railEdges: readonly ReturnType<typeof edge>[] = [],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name: `${kind}-${id}`,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		membership: Object.freeze({
			railEdges: Object.freeze([...railEdges]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}

function path(...vertices: string[]) {
	return Object.freeze(
		vertices.slice(1).map((target, index) => {
			const source = vertices[index];
			if (!source) throw new Error("Expected path source.");
			const from = point(source);
			const to = point(target);
			return edge(from.x, from.y, to.x, to.y);
		}),
	);
}

function point(vertex: string): Readonly<{ x: number; y: number }> {
	const code = vertex.charCodeAt(0) - 65;
	return Object.freeze({ x: code * 10, y: code });
}

function edge(fromX: number, fromY: number, toX: number, toY: number) {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}
