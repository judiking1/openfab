import { describe, expect, it } from "vitest";
import { createCooperativeTask } from "./CooperativeTask";
import {
	copyStaticFabAssemblyRelationshipRecord,
	remapStaticFabAssemblyRelationshipRecord,
	remapStaticFabAssemblyRelationshipRecordSteps,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyScopedEdgeV1,
	staticFabAssemblyRelationshipStateShapeError,
} from "./StaticFabAssemblyRelationship";

describe("cooperative assembly relationship remapping", () => {
	it("remaps one maximum-size relation without a whole-record validation/copy step", () => {
		const count = STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD - 8;
		const record = attachment(count);
		const task = createCooperativeTask(
			remapStaticFabAssemblyRelationshipRecordSteps(record, {
				relationshipId: 7,
				organizationIds: new Map([
					[1, 100],
					[2, 50],
				]),
				quarterTurns: 1,
				offset: { x: -400, y: 500 },
			}),
		);
		let checkpoints = 0,
			maximumSlice = 0;
		while (!task.done) {
			const start = performance.now();
			expect(task.step(64)).toBeLessThanOrEqual(64);
			maximumSlice = Math.max(maximumSlice, performance.now() - start);
			checkpoints++;
		}
		expect(checkpoints).toBeGreaterThan(Math.ceil(count / 64));
		expect(maximumSlice).toBeLessThan(50);
		const transformed = task.finish();
		expect(
			staticFabAssemblyRelationshipStateShapeError({
				nextRelationshipId: 8,
				records: [transformed],
			}),
		).toBeNull();
		const leg = required(required(transformed.connectionGroups[0]).legs[0]);
		expect(leg.exclusiveCutEdges).toHaveLength(count);
		expect(required(leg.exclusiveCutEdges[0]).edge).toEqual({
			from: { x: -400, y: 500 },
			to: { x: -400, y: 501 },
		});
		expect(required(leg.exclusiveCutEdges.at(-1)).edge).toEqual({
			from: { x: -400, y: count + 499 },
			to: { x: -400, y: count + 500 },
		});
		expect(transformed.participantOrganizationIds).toEqual([50]);
		expect(transformed.parentOrganizationId).toBe(100);
		expect(Object.isFrozen(leg.exclusiveCutEdges)).toBe(true);
		expect(Object.isFrozen(required(leg.exclusiveCutEdges.at(-1)).edge.to)).toBe(true);
		expect(
			required(required(record.connectionGroups[0]).legs[0]).exclusiveCutEdges[0]?.edge.from,
		).toEqual({ x: 0, y: 0 });
	});

	it("recanonicalizes every direct owner and rejects a missing or colliding descendant mapping", () => {
		const owners = Array.from({ length: 64 }, (_, index) => index + 2);
		const record = attachment(4, owners);
		const organizationIds = new Map([[1, 500], ...owners.map((id) => [id, 100 - id] as const)]);
		const options = {
			relationshipId: 3,
			organizationIds,
			quarterTurns: 2 as const,
			offset: { x: 0, y: 0 },
		};
		const remapped = remapStaticFabAssemblyRelationshipRecord(record, options);
		const scope = required(
			required(required(remapped.connectionGroups[0]).legs[0]).exclusiveCutEdges[0],
		).scope;
		expect(scope).toEqual({
			kind: "PARTICIPANT_EFFECTIVE",
			participantIndex: 0,
			directOwnerOrganizationIds: owners.map((id) => 100 - id).sort((a, b) => a - b),
		});
		const missing = new Map(organizationIds);
		missing.delete(65);
		expect(() =>
			remapStaticFabAssemblyRelationshipRecord(record, { ...options, organizationIds: missing }),
		).toThrow(/65.*새 ID가 없습니다/);
		const collision = new Map(organizationIds);
		collision.set(65, required(collision.get(64)));
		expect(() =>
			remapStaticFabAssemblyRelationshipRecord(record, { ...options, organizationIds: collision }),
		).toThrow(/같은 ID로 합칠/);
	});
});

function attachment(
	count: number,
	owners: readonly number[] = [2],
): StaticFabAssemblyRelationshipRecordV1 {
	const parent = (x: number): StaticFabAssemblyScopedEdgeV1 => ({
		edge: { from: { x, y: 0 }, to: { x: x + 1, y: 0 } },
		scope: { kind: "PARENT_DIRECT" },
	});
	const cuts = Array.from(
		{ length: count },
		(_, x): StaticFabAssemblyScopedEdgeV1 => ({
			edge: { from: { x, y: 0 }, to: { x: x + 1, y: 0 } },
			scope: {
				kind: "PARTICIPANT_EFFECTIVE",
				participantIndex: 0,
				directOwnerOrganizationIds: owners,
			},
		}),
	);
	return copyStaticFabAssemblyRelationshipRecord({
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
							{ support: parent(-1), adjacentExclusiveCutEdgeIndex: 0, position: "PREDECESSOR" },
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
									{ incidence: "INCOMING", binding: { kind: "WITNESS", scopedEdge: parent(-1) } },
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
	});
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing remap fixture value");
	return value;
}
