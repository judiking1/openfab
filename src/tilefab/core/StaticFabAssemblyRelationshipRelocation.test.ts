import { beforeAll, describe, expect, it } from "vitest";
import { productionBankContactFixture } from "../compile/StaticFabAssemblyRelationshipTestFixture";
import { createCooperativeTask } from "./CooperativeTask";
import {
	copyStaticFabAssemblyRelationshipState,
	remapStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import {
	planStaticFabAssemblyRelationshipRelocation,
	planStaticFabAssemblyRelationshipRelocationSteps,
	type StaticFabAssemblyRelocationTranslations,
} from "./StaticFabAssemblyRelationshipRelocation";
import {
	copyStaticFabOrganizationRecord,
	copyStaticFabOrganizationState,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import type { Cell } from "./TileMap";

describe("existing-ID assembly relationship relocation closure", () => {
	let organizations: StaticFabOrganizationState;
	let relationships: StaticFabAssemblyRelationshipStateV1;
	beforeAll(() => {
		const fixture = productionBankContactFixture();
		organizations = copyStaticFabOrganizationState(fixture.organizations);
		relationships = copyStaticFabAssemblyRelationshipState(fixture.relationships);
		expect(
			staticFabAssemblyRelationshipStateSourceError(fixture.map, organizations, relationships),
		).toBeNull();
	});

	it("moves a complete real Production FAB without changing identity or its source", () => {
		const source = JSON.stringify({ organizations, relationships });
		const result = planStaticFabAssemblyRelationshipRelocation(
			organizations,
			relationships,
			translations(organizations, { x: 20, y: -30 }),
		);
		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.nextRelationshipId).toBe(relationships.nextRelationshipId);
		expect(result.mutations).toHaveLength(1);
		const mutation = required(result.mutations[0]);
		expect(mutation.before).toBe(relationships.records[0]);
		expect(mutation.after?.id).toBe(mutation.before?.id);
		expect(mutation.after?.parentOrganizationId).toBe(mutation.before?.parentOrganizationId);
		expect(mutation.after?.participantOrganizationIds).toEqual(
			mutation.before?.participantOrganizationIds,
		);
		const previous = firstWitness(required(mutation.before));
		const next = firstWitness(required(mutation.after));
		expect(next.scopedEdge.edge.from).toEqual({
			x: previous.scopedEdge.edge.from.x + 20,
			y: previous.scopedEdge.edge.from.y - 30,
		});
		expect(next.scopedEdge.scope).toEqual(previous.scopedEdge.scope);
		expect(Object.isFrozen(next.scopedEdge.edge.from)).toBe(true);
		expect(JSON.stringify({ organizations, relationships })).toBe(source);
	});

	it("keeps two separate FAB relationships independent under different translations", () => {
		expect(
			organizations.records.every(
				(record) =>
					record.membership.advancedSwitchIds.length === 0 &&
					record.membership.equipmentGroupIds.length === 0,
			),
		).toBe(true);
		const offset = organizations.nextOrganizationId;
		const shifted = organizations.records.map((record) =>
			copyStaticFabOrganizationRecord({
				...record,
				id: record.id + offset,
				name: `${record.name} second`,
				parentOrganizationIds: staticFabOrganizationParentIds(record).map((id) => id + offset),
				membership: {
					...record.membership,
					railEdges: record.membership.railEdges.map((edge) => ({
						from: { x: edge.from.x + 4000, y: edge.from.y },
						to: { x: edge.to.x + 4000, y: edge.to.y },
					})),
				},
			}),
		);
		const bothOrganizations = copyStaticFabOrganizationState({
			records: [...organizations.records, ...shifted],
			nextOrganizationId: offset * 2,
		});
		const second = remapStaticFabAssemblyRelationshipRecord(required(relationships.records[0]), {
			relationshipId: relationships.nextRelationshipId,
			organizationIds: new Map(
				organizations.records.map((record) => [record.id, record.id + offset]),
			),
			quarterTurns: 0,
			offset: { x: 4000, y: 0 },
		});
		const bothRelationships = copyStaticFabAssemblyRelationshipState({
			records: [...relationships.records, second],
			nextRelationshipId: relationships.nextRelationshipId + 1,
		});
		const moves = translations(organizations, { x: 20, y: 0 });
		for (const record of shifted) {
			for (const edge of record.membership.railEdges)
				moves.railEdges.set(staticFabOrganizationEdgeKey(edge), { x: -30, y: 0 });
		}
		const result = planStaticFabAssemblyRelationshipRelocation(
			bothOrganizations,
			bothRelationships,
			moves,
		);
		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.mutations).toHaveLength(2);
		for (const [index, deltaX] of [20, -30].entries()) {
			const mutation = required(result.mutations[index]);
			expect(firstWitness(required(mutation.after)).scopedEdge.edge.from.x).toBe(
				firstWitness(required(mutation.before)).scopedEdge.edge.from.x + deltaX,
			);
		}
		moves.railEdges.delete(staticFabOrganizationEdgeKey(firstWitness(second).scopedEdge.edge));
		const incomplete = planStaticFabAssemblyRelationshipRelocation(
			bothOrganizations,
			bothRelationships,
			moves,
		);
		expect(incomplete.valid).toBe(false);
		if (incomplete.valid) throw new Error("Incomplete second relationship accepted");
		expect(incomplete.relationshipId).toBe(second.id);
		expect(incomplete.mutations).toHaveLength(0);
	});

	it("does not issue mutations for untouched or explicit zero-motion relationships", () => {
		for (const moves of [translations(organizations, { x: 0, y: 0 }), emptyTranslations()]) {
			const result = planStaticFabAssemblyRelationshipRelocation(
				organizations,
				relationships,
				moves,
			);
			expect(result).toEqual({
				valid: true,
				mutations: [],
				nextRelationshipId: relationships.nextRelationshipId,
			});
		}
	});

	it("folds a shared descendant through both sides of an organization DAG", () => {
		const parentId = required(relationships.records[0]).parentOrganizationId;
		const banks = organizations.records.filter(
			(record) =>
				record.kind === "AREA" && staticFabOrganizationParentIds(record).includes(parentId),
		);
		const firstBank = required(banks[0]);
		const secondBank = required(banks[1]);
		const descendant = required(
			organizations.records.find(
				(record) =>
					staticFabOrganizationParentIds(record).includes(firstBank.id) &&
					record.membership.railEdges.length > 0,
			),
		);
		const sharedOrganizations = copyStaticFabOrganizationState({
			...organizations,
			records: organizations.records.map((record) =>
				record.id === descendant.id
					? {
							...record,
							parentOrganizationIds: [...staticFabOrganizationParentIds(record), secondBank.id],
						}
					: record,
			),
		});
		const moves = translations(sharedOrganizations, { x: 20, y: 0 });
		const whole = planStaticFabAssemblyRelationshipRelocation(
			sharedOrganizations,
			relationships,
			moves,
		);
		expect(whole.valid).toBe(true);
		expect(whole.mutations).toHaveLength(1);
		for (const edge of descendant.membership.railEdges)
			moves.railEdges.delete(staticFabOrganizationEdgeKey(edge));
		const partial = planStaticFabAssemblyRelationshipRelocation(
			sharedOrganizations,
			relationships,
			moves,
		);
		expect(partial.valid).toBe(false);
		if (partial.valid) throw new Error("Stationary shared descendant accepted");
		expect(partial.code).toBe("PARTIAL_RELATIONSHIP");
		expect(partial.mutations).toHaveLength(0);
	});

	it("rejects one omitted witness edge even when every other source edge moves together", () => {
		const moves = translations(organizations, { x: 20, y: 0 });
		const binding = firstWitness(required(relationships.records[0]));
		moves.railEdges.delete(staticFabOrganizationEdgeKey(binding.scopedEdge.edge));
		const result = planStaticFabAssemblyRelationshipRelocation(organizations, relationships, moves);
		expect(result.valid).toBe(false);
		expect(result.mutations).toHaveLength(0);
		if (result.valid) throw new Error("Partial relationship was accepted");
		expect(result.relationshipId).toBe(required(relationships.records[0]).id);
		expect(result.code).toBe("PARTIAL_RELATIONSHIP");
		expect(result.reason).toContain("전체를 함께 선택");
	});

	it("rejects a different translation of a descendant that the relationship does not name directly", () => {
		const moves = translations(organizations, { x: 20, y: 0 });
		const parent = required(relationships.records[0]).parentOrganizationId;
		const participant = required(relationships.records[0]).participantOrganizationIds[0];
		const descendant = required(
			organizations.records.find(
				(record) =>
					record.id !== parent &&
					record.id !== participant &&
					record.membership.railEdges.length > 0,
			),
		);
		for (const edge of descendant.membership.railEdges)
			moves.railEdges.set(staticFabOrganizationEdgeKey(edge), { x: 0, y: 20 });
		const result = planStaticFabAssemblyRelationshipRelocation(organizations, relationships, moves);
		expect(result.valid).toBe(false);
		if (result.valid) throw new Error("Split relationship accepted");
		expect(result.code).toBe("INCOMPATIBLE_RELATIONSHIP_TRANSFORMS");
		expect(result.mutations).toHaveLength(0);
	});

	it.each([
		"advancedSwitchIds",
		"equipmentGroupIds",
	] as const)("requires the same motion for %s membership even when every rail was selected", (field) => {
		const parentId = required(relationships.records[0]).parentOrganizationId;
		const extended = copyStaticFabOrganizationState({
			...organizations,
			records: organizations.records.map((record) =>
				record.id === parentId
					? { ...record, membership: { ...record.membership, [field]: [1] } }
					: record,
			),
		});
		const moves = translations(organizations, { x: 20, y: 0 });
		expect(planStaticFabAssemblyRelationshipRelocation(extended, relationships, moves).valid).toBe(
			false,
		);
		(field === "advancedSwitchIds" ? moves.advancedSwitches : moves.equipmentGroups).set(1, {
			x: 20,
			y: 0,
		});
		expect(planStaticFabAssemblyRelationshipRelocation(extended, relationships, moves).valid).toBe(
			true,
		);
	});

	it("rejects translated coordinates that overflow without mutating the canonical source", () => {
		const before = JSON.stringify(relationships);
		expect(() =>
			planStaticFabAssemblyRelationshipRelocation(
				organizations,
				relationships,
				translations(organizations, { x: 2147483647, y: 0 }),
			),
		).toThrow("signed-int32");
		expect(JSON.stringify(relationships)).toBe(before);
	});

	it("keeps unrelated authored translations from creating relationship changes", () => {
		const moves = emptyTranslations();
		moves.railEdges.set("unrelated-edge", { x: 5, y: 0 });
		expect(
			planStaticFabAssemblyRelationshipRelocation(organizations, relationships, moves),
		).toEqual({
			valid: true,
			mutations: [],
			nextRelationshipId: relationships.nextRelationshipId,
		});
	});

	it("can stop cooperative preparation before any authored source is changed", () => {
		const before = JSON.stringify({ organizations, relationships });
		const task = createCooperativeTask(
			planStaticFabAssemblyRelationshipRelocationSteps(
				organizations,
				relationships,
				translations(organizations, { x: 20, y: 0 }),
			),
		);
		expect(task.step(64)).toBe(64);
		expect(task.done).toBe(false);
		expect(() => task.finish()).toThrow("not complete");
		expect(JSON.stringify({ organizations, relationships })).toBe(before);
	});

	it("yields throughout closure and remapping of a 65,536-reference record", () => {
		const fixture = maximumRelationshipFixture();
		const task = createCooperativeTask(
			planStaticFabAssemblyRelationshipRelocationSteps(
				fixture.organizations,
				fixture.relationships,
				translations(fixture.organizations, { x: 7, y: -3 }),
			),
		);
		let slices = 0;
		let maximumSlice = 0;
		while (!task.done) {
			const started = performance.now();
			expect(task.step(64)).toBeLessThanOrEqual(64);
			maximumSlice = Math.max(maximumSlice, performance.now() - started);
			slices++;
		}
		expect(slices).toBeGreaterThan(1000);
		expect(maximumSlice).toBeLessThan(50);
		const result = task.finish();
		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.mutations).toHaveLength(1);
		const after = required(required(result.mutations[0]).after);
		const cuts = required(after.connectionGroups[0]?.legs[0]).exclusiveCutEdges;
		expect(cuts).toHaveLength(65528);
		expect(required(cuts[0]).edge.from).toEqual({ x: 7, y: -3 });
		expect(required(cuts.at(-1)).edge.to).toEqual({ x: 65535, y: -3 });
		expect(result.nextRelationshipId).toBe(2);
	});

	it("rejects mutable sources and invalid coordinate deltas before constructing a proposal", () => {
		expect(() =>
			planStaticFabAssemblyRelationshipRelocation(
				organizations,
				{ ...relationships },
				emptyTranslations(),
			),
		).toThrow("검증된 불변");
		const moves = emptyTranslations();
		moves.railEdges.set("invalid", { x: Number.NaN, y: 0 });
		expect(() =>
			planStaticFabAssemblyRelationshipRelocation(organizations, relationships, moves),
		).toThrow("정수 셀");
	});
});

function emptyTranslations() {
	return {
		railEdges: new Map<string, Cell>(),
		advancedSwitches: new Map<number, Cell>(),
		equipmentGroups: new Map<number, Cell>(),
	} satisfies StaticFabAssemblyRelocationTranslations;
}

function translations(organizations: StaticFabOrganizationState, delta: Cell) {
	const moves = emptyTranslations();
	for (const record of organizations.records) {
		for (const edge of record.membership.railEdges)
			moves.railEdges.set(staticFabOrganizationEdgeKey(edge), delta);
		for (const id of record.membership.advancedSwitchIds) moves.advancedSwitches.set(id, delta);
		for (const id of record.membership.equipmentGroupIds) moves.equipmentGroups.set(id, delta);
	}
	return moves;
}

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error("Missing fixture value");
	return value;
}
function firstWitness(record: StaticFabAssemblyRelationshipRecordV1) {
	const binding = required(
		record.connectionGroups[0]?.legs[0]?.seamContacts[0]?.incidences[0]?.binding,
	);
	if (binding.kind !== "WITNESS") throw new Error("Expected Contact witness");
	return binding;
}

/** Shape-valid maximum relationship for scheduling proof; production source proof is tested above. */
function maximumRelationshipFixture() {
	const count = 65528;
	const edge = (x: number) => ({ from: { x, y: 0 }, to: { x: x + 1, y: 0 } });
	const parent = (x: number) => ({ edge: edge(x), scope: { kind: "PARENT_DIRECT" as const } });
	const cuts = Array.from({ length: count }, (_, x) => ({
		edge: edge(x),
		scope: {
			kind: "PARTICIPANT_EFFECTIVE" as const,
			participantIndex: 0 as const,
			directOwnerOrganizationIds: [2],
		},
	}));
	const relationships = copyStaticFabAssemblyRelationshipState({
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2],
				managedChildOrganizationIds: [2],
				reviewPolicy: "REVIEW_REQUIRED",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [
							{
								ordinal: 0,
								directionRole: "ATTACHMENT",
								exclusiveCutEdges: cuts,
								endpointSupports: [
									{
										support: parent(-1),
										adjacentExclusiveCutEdgeIndex: 0,
										position: "PREDECESSOR",
									},
									{
										support: parent(count),
										adjacentExclusiveCutEdgeIndex: count - 1,
										position: "SUCCESSOR",
									},
								],
								seamContacts: [
									{
										role: "CONTACT",
										incidences: [
											{
												incidence: "INCOMING",
												binding: { kind: "WITNESS", scopedEdge: parent(-1) },
											},
											{
												incidence: "OUTGOING",
												binding: { kind: "EXCLUSIVE_CUT_EDGE", exclusiveCutEdgeIndex: 0 },
											},
										],
									},
									{
										role: "CONTACT",
										incidences: [
											{
												incidence: "INCOMING",
												binding: { kind: "EXCLUSIVE_CUT_EDGE", exclusiveCutEdgeIndex: count - 1 },
											},
											{
												incidence: "OUTGOING",
												binding: { kind: "WITNESS", scopedEdge: parent(count) },
											},
										],
									},
								],
							},
						],
					},
				],
			},
		],
	});
	const organizations = copyStaticFabOrganizationState({
		nextOrganizationId: 3,
		records: [
			{
				id: 1,
				kind: "AREA",
				name: "Scheduling parent",
				membership: {
					railEdges: [edge(-1), edge(count)],
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			},
			{
				id: 2,
				kind: "BAY",
				name: "Scheduling participant",
				parentOrganizationIds: [1],
				membership: {
					railEdges: cuts.map((cut) => cut.edge),
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			},
		],
	});
	return { organizations, relationships };
}
