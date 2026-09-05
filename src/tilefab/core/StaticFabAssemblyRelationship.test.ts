import { describe, expect, it } from "vitest";
import { productionBankContactFixture } from "../compile/StaticFabAssemblyRelationshipTestFixture";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "./RailModuleOwnership";
import { directionBetween, oppositeDirection } from "./railShape";
import {
	applyStaticFabAssemblyRelationshipMutations,
	checksumStaticFabAssemblyRelationshipRecord,
	checksumStaticFabAssemblyRelationshipState,
	copyStaticFabAssemblyRelationshipRecord,
	copyStaticFabAssemblyRelationshipState,
	createStaticFabAssemblyRelationshipState,
	emptyStaticFabAssemblyRelationshipState,
	isCanonicalStaticFabAssemblyRelationshipState,
	reverseStaticFabAssemblyRelationshipMutations,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES_PER_TRANSITION,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_TRANSITION,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_TRANSITION,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS,
	type StaticFabAssemblyRelationshipLegV1,
	type StaticFabAssemblyRelationshipMutationV1,
	type StaticFabAssemblyRelationshipStateV1,
	type StaticFabAssemblyScopedEdgeV1,
	staticFabAssemblyRelationshipCanonicalByteLength,
	staticFabAssemblyRelationshipRecordEquals,
	staticFabAssemblyRelationshipStateEquals,
	staticFabAssemblyRelationshipStateShapeError,
	staticFabAssemblyRelationshipStateSourceError,
	staticFabAssemblyRelationshipTransitionFootprint,
} from "./StaticFabAssemblyRelationship";
import {
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import { decodeRailCell, encodeRailCell, TileMap } from "./TileMap";

describe("StaticFabAssemblyRelationship", () => {
	it("constructs the empty canonical state", () => {
		const state = emptyStaticFabAssemblyRelationshipState();

		expect(state).toEqual({ nextRelationshipId: 1, records: [] });
		expect(isCanonicalStaticFabAssemblyRelationshipState(state)).toBe(true);
		expect(Object.isFrozen(state)).toBe(true);
		expect(Object.isFrozen(state.records)).toBe(true);
		expect(checksumStaticFabAssemblyRelationshipState(state)).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
	});

	it("validates empty relationship shape without traversing unrelated Rail or organization state", () => {
		const source = new Proxy(
			{},
			{
				get() {
					throw new Error("unrelated source traversal");
				},
			},
		);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				source as TileMap,
				source as StaticFabOrganizationState,
				emptyStaticFabAssemblyRelationshipState(),
			),
		).toBeNull();
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				source as TileMap,
				source as StaticFabOrganizationState,
				{ nextRelationshipId: 0, records: [] },
			),
		).toContain("ID");
	});

	it("deep-copies, freezes, compares, and fingerprints every nested identity field", () => {
		const source = reciprocalState();
		const copy = createStaticFabAssemblyRelationshipState(source);
		const second = copyStaticFabAssemblyRelationshipState(structuredClone(source));

		expect(isCanonicalStaticFabAssemblyRelationshipState(copy)).toBe(true);
		expect(staticFabAssemblyRelationshipStateEquals(copy, second)).toBe(true);
		expect(checksumStaticFabAssemblyRelationshipState(copy)).toBe(
			checksumStaticFabAssemblyRelationshipState(second),
		);
		expect(Object.isFrozen(copy.records[0]?.connectionGroups[0]?.legs[0]?.seamContacts[0])).toBe(
			true,
		);
		const copiedScope = copy.records[0]?.connectionGroups[0]?.legs[0]?.exclusiveCutEdges[0]?.scope;
		expect(
			copiedScope?.kind === "PARENT_DIRECT"
				? false
				: Object.isFrozen(copiedScope?.directOwnerOrganizationIds),
		).toBe(true);

		const originalFingerprint = checksumStaticFabAssemblyRelationshipState(copy);
		(source.records[0]?.participantOrganizationIds as unknown as number[]).reverse();
		(
			source.records[0]?.connectionGroups[0]?.legs[0]?.exclusiveCutEdges[0]?.edge.from as {
				x: number;
				y: number;
			}
		).x = 99;
		expect(copy.records[0]?.participantOrganizationIds).toEqual([2, 3]);
		expect(copy.records[0]?.connectionGroups[0]?.legs[0]?.exclusiveCutEdges[0]?.edge.from.x).toBe(
			0,
		);
		expect(checksumStaticFabAssemblyRelationshipState(copy)).toBe(originalFingerprint);
	});

	it("preserves participant and directed-walk order as fingerprinted identity", () => {
		const source = reciprocalState();
		const reversedParticipants = structuredClone(source);
		(reversedParticipants.records[0]?.participantOrganizationIds as unknown as number[]).reverse();
		const reversedWalk = structuredClone(source);
		const reversedLeg = reversedWalk.records[0]?.connectionGroups[0]?.legs[0] as unknown as {
			exclusiveCutEdges: unknown[];
		};
		reversedLeg.exclusiveCutEdges = [
			...(reversedWalk.records[0]?.connectionGroups[0]?.legs[0]?.exclusiveCutEdges ?? []),
		].reverse();

		expect(checksumStaticFabAssemblyRelationshipState(source)).not.toBe(
			checksumStaticFabAssemblyRelationshipState(reversedParticipants),
		);
		expect(staticFabAssemblyRelationshipStateEquals(source, reversedParticipants)).toBe(false);
		expect(staticFabAssemblyRelationshipStateShapeError(reversedWalk)).toContain("directed walk");
	});

	it("copies, compares, and fingerprints one public relationship record", () => {
		const source = reciprocalState().records[0];
		if (!source) throw new Error("expected relationship record");
		const copy = copyStaticFabAssemblyRelationshipRecord(source);

		expect(staticFabAssemblyRelationshipRecordEquals(source, copy)).toBe(true);
		expect(checksumStaticFabAssemblyRelationshipRecord(copy)).toBe(
			checksumStaticFabAssemblyRelationshipRecord(source),
		);
		expect(Object.isFrozen(copy)).toBe(true);
		expect(Object.isFrozen(copy.connectionGroups[0]?.legs[0]?.exclusiveCutEdges)).toBe(true);

		const changed = structuredClone(source);
		(changed as { reviewPolicy: string }).reviewPolicy = "AUTHORING_NON_DETACHABLE";
		expect(staticFabAssemblyRelationshipRecordEquals(copy, changed)).toBe(false);
		expect(checksumStaticFabAssemblyRelationshipRecord(copy)).not.toBe(
			checksumStaticFabAssemblyRelationshipRecord(changed),
		);
	});

	it("applies and reverses exact mutations with canonical output and a monotonic cursor", () => {
		const raw = reciprocalState();
		(raw as { nextRelationshipId: number }).nextRelationshipId = 7;
		const source = createStaticFabAssemblyRelationshipState(raw);
		const before = source.records[0];
		if (!before) throw new Error("expected relationship record");
		const changed = structuredClone(before);
		(changed as { reviewPolicy: string }).reviewPolicy = "AUTHORING_NON_DETACHABLE";
		const after = copyStaticFabAssemblyRelationshipRecord(changed);
		const mutation = Object.freeze({ id: 1, before, after });

		const applied = applyStaticFabAssemblyRelationshipMutations(source, [mutation], 2);
		expect(applied.nextRelationshipId).toBe(7);
		expect(applied.records).toHaveLength(1);
		expect(applied.records[0]?.reviewPolicy).toBe("AUTHORING_NON_DETACHABLE");
		expect(isCanonicalStaticFabAssemblyRelationshipState(applied)).toBe(true);
		expect(applied.records[0]).not.toBe(after);

		const reversed = reverseStaticFabAssemblyRelationshipMutations([mutation]);
		expect(Object.isFrozen(reversed)).toBe(true);
		expect(Object.isFrozen(reversed[0])).toBe(true);
		expect(reversed[0]?.before).not.toBe(after);
		const restored = applyStaticFabAssemblyRelationshipMutations(applied, reversed, 2);
		expect(staticFabAssemblyRelationshipStateEquals(restored, source)).toBe(true);

		const added = applyStaticFabAssemblyRelationshipMutations(
			emptyStaticFabAssemblyRelationshipState(),
			[{ id: 1, before: null, after: before }],
			2,
		);
		expect(added).toEqual({ nextRelationshipId: 2, records: [before] });
		const deleted = applyStaticFabAssemblyRelationshipMutations(
			added,
			[{ id: 1, before: added.records[0] as typeof before, after: null }],
			1,
		);
		expect(deleted).toEqual({ nextRelationshipId: 2, records: [] });
		expect(
			applyStaticFabAssemblyRelationshipMutations(emptyStaticFabAssemblyRelationshipState(), [], 5)
				.nextRelationshipId,
		).toBe(5);
	});

	it("rejects stale, duplicate, malformed, and no-op relationship mutations", () => {
		const source = createStaticFabAssemblyRelationshipState(reciprocalState());
		const before = source.records[0];
		if (!before) throw new Error("expected relationship record");
		const changed = structuredClone(before);
		(changed as { reviewPolicy: string }).reviewPolicy = "AUTHORING_NON_DETACHABLE";
		const after = copyStaticFabAssemblyRelationshipRecord(changed);
		const mutation: StaticFabAssemblyRelationshipMutationV1 = { id: 1, before, after };
		const stale = structuredClone(before);
		(stale as { parentOrganizationId: number }).parentOrganizationId = 9;

		expect(() =>
			applyStaticFabAssemblyRelationshipMutations(source, [{ id: 1, before: stale, after }], 2),
		).toThrow(/before/);
		expect(() => staticFabAssemblyRelationshipTransitionFootprint([mutation, mutation])).toThrow(
			/두 번/,
		);
		expect(() =>
			staticFabAssemblyRelationshipTransitionFootprint([{ id: 1, before, after: before }]),
		).toThrow(/no-op/);
		expect(() =>
			staticFabAssemblyRelationshipTransitionFootprint([{ id: 1, before: null, after: null }]),
		).toThrow(/모두 없습니다/);
		expect(() =>
			staticFabAssemblyRelationshipTransitionFootprint([{ id: 2, before, after }]),
		).toThrow(/record ID/);
		expect(() =>
			applyStaticFabAssemblyRelationshipMutations(source, [{ id: 1, before: null, after }], 2),
		).toThrow(/현재 문서/);
	});

	it("counts both transition sides and enforces all production footprint ceilings", () => {
		const source = reciprocalState();
		const before = source.records[0];
		if (!before) throw new Error("expected relationship record");
		const changed = structuredClone(before);
		(changed as { reviewPolicy: string }).reviewPolicy = "AUTHORING_NON_DETACHABLE";
		const after = copyStaticFabAssemblyRelationshipRecord(changed);
		const mutations = [{ id: 1, before, after }];
		const recordBytes = staticFabAssemblyRelationshipCanonicalByteLength(source) - 8;
		const footprint = staticFabAssemblyRelationshipTransitionFootprint(mutations);

		expect(STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_TRANSITION).toBe(2_000_000);
		expect(STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_OWNER_IDS_PER_TRANSITION).toBe(2_000_000);
		expect(STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES_PER_TRANSITION).toBe(
			64 * 1024 * 1024,
		);
		expect(footprint).toEqual({
			edgeReferenceCount: 40,
			ownerIdCount: 8,
			canonicalByteCount: recordBytes * 2,
		});
		expect(() =>
			staticFabAssemblyRelationshipTransitionFootprint(mutations, {
				maximumEdgeReferences: footprint.edgeReferenceCount - 1,
			}),
		).toThrow(/edge 참조/);
		expect(() =>
			staticFabAssemblyRelationshipTransitionFootprint(mutations, {
				maximumOwnerIds: footprint.ownerIdCount - 1,
			}),
		).toThrow(/소유자 ID/);
		expect(() =>
			staticFabAssemblyRelationshipTransitionFootprint(mutations, {
				maximumCanonicalBytes: footprint.canonicalByteCount - 1,
			}),
		).toThrow(/canonical byte/);
		expect(() =>
			staticFabAssemblyRelationshipTransitionFootprint(mutations, {
				maximumCanonicalBytes:
					STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_CANONICAL_BYTES_PER_TRANSITION + 1,
			}),
		).toThrow(/범위/);
	});

	it("rejects oversized top-level and seam arrays before reading sparse elements", () => {
		let recordRead = false;
		const oversizedRecords = new Proxy(
			new Array(STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_RECORDS + 1),
			{
				get(target, property, receiver) {
					if (typeof property === "string" && /^\d+$/.test(property)) recordRead = true;
					return Reflect.get(target, property, receiver);
				},
			},
		);
		expect(
			staticFabAssemblyRelationshipStateShapeError({
				nextRelationshipId: 1,
				records: oversizedRecords,
			} as StaticFabAssemblyRelationshipStateV1),
		).toContain("최대");
		expect(recordRead).toBe(false);

		const source = contactOnlyState();
		let incidenceRead = false;
		const oversizedIncidences = new Proxy(
			new Array(STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD + 1),
			{
				get(target, property, receiver) {
					if (typeof property === "string" && /^\d+$/.test(property)) incidenceRead = true;
					return Reflect.get(target, property, receiver);
				},
			},
		);
		(
			source.records[0]?.connectionGroups[0]?.legs[0]?.seamContacts[0] as unknown as {
				incidences: unknown[];
			}
		).incidences = oversizedIncidences;
		expect(staticFabAssemblyRelationshipStateShapeError(source)).toContain("incidence");
		expect(incidenceRead).toBe(false);

		const managed = contactOnlyState();
		let managedRead = false;
		const oversizedManaged = new Proxy([2, 3], {
			get(target, property, receiver) {
				if (typeof property === "string" && /^\d+$/.test(property)) managedRead = true;
				return Reflect.get(target, property, receiver);
			},
		});
		(
			managed.records[0] as unknown as { managedChildOrganizationIds: number[] }
		).managedChildOrganizationIds = oversizedManaged;
		expect(staticFabAssemblyRelationshipStateShapeError(managed)).toContain("부분집합");
		expect(managedRead).toBe(false);
	});

	it("enforces exact node keys and the canonical byte budget before copying", () => {
		const source = contactOnlyState();
		const byteLength = staticFabAssemblyRelationshipCanonicalByteLength(source);
		expect(byteLength).toBeGreaterThan(0);
		expect(staticFabAssemblyRelationshipStateShapeError(source, byteLength)).toBeNull();
		expect(staticFabAssemblyRelationshipStateShapeError(source, byteLength - 1)).toContain(
			"canonical byte",
		);
		expect(staticFabAssemblyRelationshipStateShapeError(source, 128 * 1024 * 1024 + 1)).toContain(
			"canonical byte",
		);

		const extraState = { ...source, fingerprint: "must-not-be-truncated" };
		expect(
			staticFabAssemblyRelationshipStateShapeError(
				extraState as StaticFabAssemblyRelationshipStateV1,
			),
		).toContain("정확히");
		const extraScope = contactOnlyState();
		const parentScope = (
			firstLeg(extraScope).seamContacts[0]?.incidences[0]?.binding as {
				scopedEdge: { scope: Record<string, unknown> };
			}
		).scopedEdge.scope;
		parentScope.participantIndex = 0;
		expect(staticFabAssemblyRelationshipStateShapeError(extraScope)).toContain("추가 필드");
	});

	it.each([
		["stale cursor", (state: StaticFabAssemblyRelationshipStateV1) => setCursor(state, 1), "다음"],
		[
			"duplicate managed child",
			(state: StaticFabAssemblyRelationshipStateV1) => setManagedChildren(state, [2, 2]),
			"부분집합",
		],
		[
			"group ordinal gap",
			(state: StaticFabAssemblyRelationshipStateV1) => setFirstGroupOrdinal(state, 1),
			"ordinal",
		],
		[
			"disconnected walk",
			(state: StaticFabAssemblyRelationshipStateV1) => {
				const disconnected = firstLeg(state).exclusiveCutEdges[1]?.edge as {
					from: { x: number; y: number };
					to: { x: number; y: number };
				};
				disconnected.from.x = 8;
				disconnected.to.x = 9;
			},
			"directed walk",
		],
		[
			"support on non-final edge",
			(state: StaticFabAssemblyRelationshipStateV1) => {
				(
					firstLeg(state).endpointSupports[1] as { adjacentExclusiveCutEdgeIndex: number }
				).adjacentExclusiveCutEdgeIndex = 0;
			},
			"successor",
		],
		[
			"missing complete contact incidence",
			(state: StaticFabAssemblyRelationshipStateV1) => {
				(firstLeg(state).seamContacts[0] as unknown as { incidences: unknown[] }).incidences.pop();
			},
			"완전",
		],
		[
			"missing return leg",
			(state: StaticFabAssemblyRelationshipStateV1) => {
				(state.records[0]?.connectionGroups[0] as unknown as { legs: unknown[] }).legs.pop();
			},
			"outbound/return",
		],
	] as const)("fails closed for %s", (_label, mutate, expected) => {
		const source = reciprocalState();
		mutate(source);
		expect(staticFabAssemblyRelationshipStateShapeError(source)).toContain(expected);
	});

	it("rejects one-participant outbound legs and same-region seam aliases", () => {
		const oneParticipant = contactOnlyState();
		(firstLeg(oneParticipant) as { directionRole: string }).directionRole = "OUTBOUND";
		expect(staticFabAssemblyRelationshipStateShapeError(oneParticipant)).toContain(
			"attachment/contact",
		);

		const sameRegion = contactOnlyState();
		const seam = firstLeg(sameRegion).seamContacts[0];
		if (!seam) throw new Error("expected seam");
		(seam.incidences[0] as { binding: unknown }).binding = structuredClone(
			seam.incidences[1]?.binding,
		);
		expect(staticFabAssemblyRelationshipStateShapeError(sameRegion)).toContain("junction");

		const sameCombinedRegion = contactOnlyState();
		const combinedSeam = firstLeg(sameCombinedRegion).seamContacts[0];
		if (!combinedSeam) throw new Error("expected combined seam");
		(combinedSeam.incidences[0] as { binding: unknown }).binding = {
			kind: "WITNESS",
			scopedEdge: combinedScoped(edge(4, 0, 5, 0), 0, [1, 2, 3]),
		};
		(combinedSeam.incidences[1] as { binding: unknown }).binding = {
			kind: "WITNESS",
			scopedEdge: combinedScoped(edge(5, 0, 6, 0), 0, [1, 2, 3]),
		};
		expect(staticFabAssemblyRelationshipStateShapeError(sameCombinedRegion)).toContain(
			"scope region",
		);
	});

	it("limits FAB_LOOP identity to the Bank-to-Fab tier", () => {
		const invalid = reciprocalState();
		(invalid.records[0] as { purpose: string }).purpose = "FAB_LOOP";
		(
			invalid.records[0] as unknown as { managedChildOrganizationIds: number[] }
		).managedChildOrganizationIds = [];

		expect(staticFabAssemblyRelationshipStateShapeError(invalid)).toContain("BANK_TO_FAB");
	});

	it("rejects duplicate exclusive identity across records and review-required contact-only records", () => {
		const duplicate = reciprocalState();
		const secondRecord = structuredClone(duplicate.records[0]);
		if (!secondRecord) throw new Error("expected relationship record");
		(secondRecord as { id: number }).id = 2;
		(secondRecord as { hierarchyRole: string }).hierarchyRole = "BANK_TO_FAB";
		(secondRecord as { purpose: string }).purpose = "FAB_LOOP";
		(
			secondRecord as unknown as { managedChildOrganizationIds: number[] }
		).managedChildOrganizationIds = [];
		(duplicate as { nextRelationshipId: number }).nextRelationshipId = 3;
		(duplicate.records as unknown as (typeof secondRecord)[]).push(secondRecord);
		expect(staticFabAssemblyRelationshipStateShapeError(duplicate)).toContain("exclusive cut edge");

		const contact = contactOnlyState();
		(contact.records[0] as { reviewPolicy: string }).reviewPolicy = "REVIEW_REQUIRED";
		expect(staticFabAssemblyRelationshipStateShapeError(contact)).toContain("exclusive cut edge");

		const witnessInsideCut = attachmentFixture(0, 15).relationships;
		const attachment = firstLeg(witnessInsideCut);
		(attachment.seamContacts as unknown as unknown[]).splice(
			1,
			0,
			contactSeam(
				alias("INCOMING", 1),
				witness("OUTGOING", attachment.exclusiveCutEdges[2] as StaticFabAssemblyScopedEdgeV1),
			),
		);
		expect(staticFabAssemblyRelationshipStateShapeError(witnessInsideCut)).toContain("removal set");
	});

	it("validates a contact-only hierarchy identity against current Rail and organization truth", () => {
		const fixture = contactFixture();

		expect(staticFabAssemblyRelationshipStateShapeError(fixture.relationships)).toBeNull();
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				fixture.map,
				fixture.organizations,
				fixture.relationships,
			),
		).toBeNull();

		const ownership = buildRailModuleOwnershipIndex(fixture.map);
		connectDirectedPath(fixture.map, [
			{ x: 5, y: 0 },
			{ x: 5, y: 1 },
		]);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				fixture.map,
				fixture.organizations,
				fixture.relationships,
				ownership,
			),
		).toContain("generation");
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				fixture.map,
				fixture.organizations,
				fixture.relationships,
			),
		).toContain("전체 incidence");
	});

	it("rejects stale direct-owner sets and incomplete whole-module exclusive cuts", () => {
		const ownerFixture = contactFixture();
		const ownerDrift = structuredClone(ownerFixture.organizations);
		(ownerDrift.records[0]?.membership.railEdges as DirectedRailEdge[]).push(edge(5, 0, 6, 0));
		(ownerDrift.records[0]?.membership.railEdges as DirectedRailEdge[]).sort(compareEdges);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				ownerFixture.map,
				ownerDrift,
				ownerFixture.relationships,
			),
		).toMatch(/직접 소유자|모듈/);

		const complete = attachmentFixture(0, 15);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				complete.map,
				complete.organizations,
				complete.relationships,
			),
		).toBeNull();

		const incompleteRelationship = attachmentFixture(0, 15);
		const incompleteLeg = firstLeg(incompleteRelationship.relationships);
		(incompleteLeg.exclusiveCutEdges as unknown as unknown[]).pop();
		const successor = incompleteLeg.endpointSupports[1];
		if (!successor) throw new Error("expected successor support");
		(successor as { adjacentExclusiveCutEdgeIndex: number }).adjacentExclusiveCutEdgeIndex = 3;
		(successor as { support: StaticFabAssemblyScopedEdgeV1 }).support = parentScoped(
			edge(9, 0, 10, 0),
		);
		const endSeam = incompleteLeg.seamContacts[1];
		if (!endSeam) throw new Error("expected end seam");
		(endSeam.incidences[0] as { binding: unknown }).binding = {
			kind: "EXCLUSIVE_CUT_EDGE",
			exclusiveCutEdgeIndex: 3,
		};
		(endSeam.incidences[1] as { binding: unknown }).binding = witness(
			"OUTGOING",
			parentScoped(edge(9, 0, 10, 0)),
		).binding;
		expect(
			staticFabAssemblyRelationshipStateShapeError(incompleteRelationship.relationships),
		).toBeNull();
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				incompleteRelationship.map,
				incompleteRelationship.organizations,
				incompleteRelationship.relationships,
			),
		).toContain("전체를 포함");

		const witnessInsideExpandedModule = attachmentFixture(0, 15);
		const relationship = witnessInsideExpandedModule.relationships.records[0];
		const group = relationship?.connectionGroups[0];
		if (!group) throw new Error("expected connection group");
		(group.legs as StaticFabAssemblyRelationshipLegV1[]).push({
			ordinal: 1,
			directionRole: "CONTACT",
			exclusiveCutEdges: [],
			endpointSupports: [],
			seamContacts: [
				contactSeam(
					witness("INCOMING", parentScoped(edge(4, 0, 5, 0))),
					witness("OUTGOING", participantScoped(edge(5, 0, 6, 0), 0, [2, 3])),
				),
			],
		});
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				witnessInsideExpandedModule.map,
				witnessInsideExpandedModule.organizations,
				witnessInsideExpandedModule.relationships,
			),
		).toContain("exclusive Rail module");

		const truncatedContext = attachmentFixture(4, 11);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				truncatedContext.map,
				truncatedContext.organizations,
				truncatedContext.relationships,
			),
		).toMatch(/module|Rail module|현재 맵/);
	});

	it("validates a two-participant reciprocal relationship against current source", () => {
		const fixture = reciprocalSourceFixture();

		expect(staticFabAssemblyRelationshipStateShapeError(fixture.relationships)).toBeNull();
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				fixture.map,
				fixture.organizations,
				fixture.relationships,
			),
		).toBeNull();
	});

	it("accepts complete branch/merge current source and parent-plus-participant scope", () => {
		const branchMerge = branchMergeSourceFixture();
		const branchOwnership = buildRailModuleOwnershipIndex(branchMerge.map);
		const branchWitnessEdges = firstLeg(branchMerge.relationships).seamContacts.flatMap((seam) =>
			seam.incidences.flatMap((incidence) =>
				incidence.binding.kind === "WITNESS" ? [incidence.binding.scopedEdge.edge] : [],
			),
		);
		expect(staticFabAssemblyRelationshipStateShapeError(branchMerge.relationships)).toBeNull();
		expect(
			branchWitnessEdges.some(
				(witnessEdge) =>
					branchOwnership.modules.filter((module) =>
						module.eraseEdges.some(
							(moduleEdge) =>
								staticFabOrganizationEdgeKey(moduleEdge) ===
								staticFabOrganizationEdgeKey(witnessEdge),
						),
					).length > 1,
			),
		).toBe(true);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				branchMerge.map,
				branchMerge.organizations,
				branchMerge.relationships,
			),
		).toBeNull();

		const combined = contactFixture();
		const participantModule = straightEdges(5, 10);
		const parentMembership = combined.organizations.records[0]?.membership;
		if (!parentMembership) throw new Error("expected parent membership");
		(parentMembership.railEdges as DirectedRailEdge[]).push(...participantModule);
		(parentMembership.railEdges as DirectedRailEdge[]).sort(compareEdges);
		const outgoing = firstLeg(combined.relationships).seamContacts[0]?.incidences[1];
		if (!outgoing || outgoing.binding.kind !== "WITNESS") throw new Error("expected witness");
		(outgoing.binding as { scopedEdge: StaticFabAssemblyScopedEdgeV1 }).scopedEdge = combinedScoped(
			edge(5, 0, 6, 0),
			0,
			[1, 2, 3],
		);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				combined.map,
				combined.organizations,
				combined.relationships,
			),
		).toBeNull();
	});

	it("validates the first Production 60 Bank contact identity against the generated source", () => {
		const fixture = productionBankContactFixture();

		expect(
			fixture.relationships.records[0]?.connectionGroups[0]?.legs[0]?.seamContacts,
		).toHaveLength(2);
		expect(staticFabAssemblyRelationshipStateShapeError(fixture.relationships)).toBeNull();
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				fixture.map,
				fixture.organizations,
				fixture.relationships,
			),
		).toBeNull();
	});
});

function contactOnlyState(): StaticFabAssemblyRelationshipStateV1 {
	return {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2],
				managedChildOrganizationIds: [2],
				reviewPolicy: "AUTHORING_NON_DETACHABLE",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [
							{
								ordinal: 0,
								directionRole: "CONTACT",
								exclusiveCutEdges: [],
								endpointSupports: [],
								seamContacts: [
									contactSeam(
										witness("INCOMING", parentScoped(edge(4, 0, 5, 0))),
										witness("OUTGOING", participantScoped(edge(5, 0, 6, 0), 0, [2, 3])),
									),
								],
							},
						],
					},
				],
			},
		],
	};
}

function reciprocalState(): StaticFabAssemblyRelationshipStateV1 {
	return {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2, 3],
				managedChildOrganizationIds: [2, 3],
				reviewPolicy: "REVIEW_REQUIRED",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [reciprocalLeg(0, "OUTBOUND"), reciprocalLeg(1, "RETURN")],
					},
				],
			},
		],
	};
}

function branchMergeShapeState(): StaticFabAssemblyRelationshipStateV1 {
	return {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2],
				managedChildOrganizationIds: [2],
				reviewPolicy: "AUTHORING_NON_DETACHABLE",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [
							{
								ordinal: 0,
								directionRole: "CONTACT",
								exclusiveCutEdges: [],
								endpointSupports: [],
								seamContacts: [
									{
										role: "BRANCH",
										incidences: [
											witness("INCOMING", parentScoped(edge(-1, 0, 0, 0))),
											witness("OUTGOING", participantScoped(edge(0, 0, 0, 1), 0, [2])),
											witness("OUTGOING", participantScoped(edge(0, 0, 1, 0), 0, [2])),
										],
									},
									{
										role: "MERGE",
										incidences: [
											witness("INCOMING", participantScoped(edge(1, 1, 2, 1), 0, [2])),
											witness("INCOMING", participantScoped(edge(2, 0, 2, 1), 0, [2])),
											witness("OUTGOING", parentScoped(edge(2, 1, 3, 1))),
										],
									},
								],
							},
						],
					},
				],
			},
		],
	};
}

function branchMergeSourceFixture(): {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
} {
	const map = new TileMap();
	connectDirectedPath(map, [
		{ x: -3, y: 0 },
		{ x: -2, y: 0 },
		{ x: -1, y: 0 },
		{ x: 0, y: 0 },
		{ x: 1, y: 0 },
		{ x: 2, y: 0 },
		{ x: 3, y: 0 },
		{ x: 4, y: 0 },
		{ x: 5, y: 0 },
	]);
	connectDirectedPath(map, [
		{ x: 0, y: 0 },
		{ x: 0, y: 1 },
		{ x: 1, y: 1 },
		{ x: 2, y: 1 },
		{ x: 2, y: 0 },
	]);
	const parentEdges = straightEdges(-3, 5);
	const participantEdges = [edge(0, 0, 0, 1), edge(0, 1, 1, 1), edge(1, 1, 2, 1), edge(2, 1, 2, 0)];
	const emptyIds = Object.freeze([]) as readonly number[];
	const membership = (railEdges: readonly DirectedRailEdge[]) => ({
		railEdges: [...railEdges].sort(compareEdges),
		advancedSwitchIds: emptyIds,
		equipmentGroupIds: emptyIds,
	});
	const organizations: StaticFabOrganizationState = {
		nextOrganizationId: 4,
		records: [
			{ id: 1, kind: "AREA", name: "Bank", membership: membership(parentEdges) },
			{
				id: 2,
				kind: "BAY",
				name: "Bay",
				parentOrganizationIds: [1],
				membership: membership(participantEdges),
			},
			{
				id: 3,
				kind: "AISLE",
				name: "Process Loop",
				parentOrganizationIds: [2],
				membership: membership(participantEdges),
			},
		],
	};
	const relationships = branchMergeShapeState();
	const seams = firstLeg(relationships).seamContacts;
	const branch = seams[0];
	const merge = seams[1];
	if (!branch || !merge) throw new Error("expected branch and merge seams");
	(branch as unknown as { incidences: unknown[] }).incidences = [
		witness("INCOMING", parentScoped(edge(-1, 0, 0, 0))),
		witness("OUTGOING", participantScoped(edge(0, 0, 0, 1), 0, [2, 3])),
		witness("OUTGOING", parentScoped(edge(0, 0, 1, 0))),
	];
	(merge as unknown as { incidences: unknown[] }).incidences = [
		witness("INCOMING", parentScoped(edge(1, 0, 2, 0))),
		witness("INCOMING", participantScoped(edge(2, 1, 2, 0), 0, [2, 3])),
		witness("OUTGOING", parentScoped(edge(2, 0, 3, 0))),
	];
	return { map, organizations, relationships };
}

function reciprocalLeg(y: number, role: "OUTBOUND" | "RETURN"): StaticFabAssemblyRelationshipLegV1 {
	const outbound = role === "OUTBOUND";
	const cut = outbound
		? [participantScoped(edge(0, y, 1, y), 0, [2]), participantScoped(edge(1, y, 2, y), 1, [3])]
		: [participantScoped(edge(2, y, 1, y), 1, [3]), participantScoped(edge(1, y, 0, y), 0, [2])];
	const predecessor = parentScoped(outbound ? edge(-1, y, 0, y) : edge(3, y, 2, y));
	const successor = parentScoped(outbound ? edge(2, y, 3, y) : edge(0, y, -1, y));
	const start = contactSeam(witness("INCOMING", predecessor), alias("OUTGOING", 0));
	const end = contactSeam(alias("INCOMING", 1), witness("OUTGOING", successor));
	return {
		ordinal: outbound ? 0 : 1,
		directionRole: role,
		exclusiveCutEdges: cut,
		endpointSupports: [
			{ support: predecessor, adjacentExclusiveCutEdgeIndex: 0, position: "PREDECESSOR" },
			{ support: successor, adjacentExclusiveCutEdgeIndex: 1, position: "SUCCESSOR" },
		],
		seamContacts: outbound ? [start, end] : [end, start],
	};
}

function contactFixture(): {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
} {
	const map = new TileMap();
	connectDirectedPath(
		map,
		Array.from({ length: 11 }, (_, x) => ({ x, y: 0 })),
	);
	return {
		map,
		relationships: contactOnlyState(),
		organizations: organizationState(straightEdges(0, 5), straightEdges(5, 10)),
	};
}

function attachmentFixture(
	pathStart: number,
	pathEnd: number,
): {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
} {
	const map = new TileMap();
	connectDirectedPath(
		map,
		Array.from({ length: pathEnd - pathStart + 1 }, (_, offset) => ({
			x: pathStart + offset,
			y: 0,
		})),
	);
	const cuts = Array.from({ length: 5 }, (_, offset) => edge(5 + offset, 0, 6 + offset, 0));
	const predecessor = edge(4, 0, 5, 0);
	const successor = edge(10, 0, 11, 0);
	const relationships: StaticFabAssemblyRelationshipStateV1 = {
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
								exclusiveCutEdges: cuts.map((cut) => participantScoped(cut, 0, [2, 3])),
								endpointSupports: [
									{
										support: parentScoped(predecessor),
										adjacentExclusiveCutEdgeIndex: 0,
										position: "PREDECESSOR",
									},
									{
										support: parentScoped(successor),
										adjacentExclusiveCutEdgeIndex: 4,
										position: "SUCCESSOR",
									},
								],
								seamContacts: [
									contactSeam(witness("INCOMING", parentScoped(predecessor)), alias("OUTGOING", 0)),
									contactSeam(alias("INCOMING", 4), witness("OUTGOING", parentScoped(successor))),
								],
							},
						],
					},
				],
			},
		],
	};
	return {
		map,
		relationships,
		organizations: organizationState([...straightEdges(0, 5), ...straightEdges(10, 15)], cuts),
	};
}

function straightEdges(startX: number, endX: number, y = 0): DirectedRailEdge[] {
	return Array.from({ length: endX - startX }, (_, offset) =>
		edge(startX + offset, y, startX + offset + 1, y),
	);
}

function organizationState(
	parentEdges: readonly DirectedRailEdge[],
	participantEdges: readonly DirectedRailEdge[],
): StaticFabOrganizationState {
	const emptyIds = Object.freeze([]) as readonly number[];
	return {
		nextOrganizationId: 4,
		records: [
			{
				id: 1,
				kind: "AREA",
				name: "Bank",
				membership: {
					railEdges: [...parentEdges].sort(compareEdges),
					advancedSwitchIds: emptyIds,
					equipmentGroupIds: emptyIds,
				},
			},
			{
				id: 2,
				kind: "BAY",
				name: "Bay",
				parentOrganizationIds: [1],
				membership: {
					railEdges: [...participantEdges].sort(compareEdges),
					advancedSwitchIds: emptyIds,
					equipmentGroupIds: emptyIds,
				},
			},
			{
				id: 3,
				kind: "AISLE",
				name: "Process Loop",
				parentOrganizationIds: [2],
				membership: {
					railEdges: [...participantEdges].sort(compareEdges),
					advancedSwitchIds: emptyIds,
					equipmentGroupIds: emptyIds,
				},
			},
		],
	};
}

function reciprocalSourceFixture(): {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
} {
	const map = new TileMap();
	connectDirectedPath(
		map,
		Array.from({ length: 21 }, (_, x) => ({ x, y: 0 })),
	);
	connectDirectedPath(
		map,
		Array.from({ length: 21 }, (_, offset) => ({ x: 20 - offset, y: 2 })),
	);
	const outboundCut = straightEdges(5, 15, 0);
	const returnCut = Array.from({ length: 10 }, (_, offset) => edge(15 - offset, 2, 14 - offset, 2));
	const outboundPredecessor = parentScoped(edge(4, 0, 5, 0));
	const outboundSuccessor = parentScoped(edge(15, 0, 16, 0));
	const returnPredecessor = parentScoped(edge(16, 2, 15, 2));
	const returnSuccessor = parentScoped(edge(5, 2, 4, 2));
	const outbound: StaticFabAssemblyRelationshipLegV1 = {
		ordinal: 0,
		directionRole: "OUTBOUND",
		exclusiveCutEdges: outboundCut.map((cut, index) =>
			index < 5 ? participantScoped(cut, 0, [2, 4]) : participantScoped(cut, 1, [3, 5]),
		),
		endpointSupports: [
			{
				support: outboundPredecessor,
				adjacentExclusiveCutEdgeIndex: 0,
				position: "PREDECESSOR",
			},
			{
				support: outboundSuccessor,
				adjacentExclusiveCutEdgeIndex: 9,
				position: "SUCCESSOR",
			},
		],
		seamContacts: [
			contactSeam(witness("INCOMING", outboundPredecessor), alias("OUTGOING", 0)),
			contactSeam(alias("INCOMING", 9), witness("OUTGOING", outboundSuccessor)),
		],
	};
	const returned: StaticFabAssemblyRelationshipLegV1 = {
		ordinal: 1,
		directionRole: "RETURN",
		exclusiveCutEdges: returnCut.map((cut, index) =>
			index < 5 ? participantScoped(cut, 1, [3, 5]) : participantScoped(cut, 0, [2, 4]),
		),
		endpointSupports: [
			{
				support: returnPredecessor,
				adjacentExclusiveCutEdgeIndex: 0,
				position: "PREDECESSOR",
			},
			{
				support: returnSuccessor,
				adjacentExclusiveCutEdgeIndex: 9,
				position: "SUCCESSOR",
			},
		],
		seamContacts: [
			contactSeam(alias("INCOMING", 9), witness("OUTGOING", returnSuccessor)),
			contactSeam(witness("INCOMING", returnPredecessor), alias("OUTGOING", 0)),
		],
	};
	const relationships: StaticFabAssemblyRelationshipStateV1 = {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2, 3],
				managedChildOrganizationIds: [2, 3],
				reviewPolicy: "REVIEW_REQUIRED",
				connectionGroups: [{ ordinal: 0, legs: [outbound, returned] }],
			},
		],
	};
	const parentEdges = [
		...straightEdges(0, 5, 0),
		...straightEdges(15, 20, 0),
		...Array.from({ length: 5 }, (_, offset) => edge(20 - offset, 2, 19 - offset, 2)),
		...Array.from({ length: 5 }, (_, offset) => edge(5 - offset, 2, 4 - offset, 2)),
	];
	const participantZeroEdges = [
		...straightEdges(5, 10, 0),
		...Array.from({ length: 5 }, (_, offset) => edge(10 - offset, 2, 9 - offset, 2)),
	];
	const participantOneEdges = [
		...straightEdges(10, 15, 0),
		...Array.from({ length: 5 }, (_, offset) => edge(15 - offset, 2, 14 - offset, 2)),
	];
	const emptyIds = Object.freeze([]) as readonly number[];
	const membership = (railEdges: readonly DirectedRailEdge[]) => ({
		railEdges: [...railEdges].sort(compareEdges),
		advancedSwitchIds: emptyIds,
		equipmentGroupIds: emptyIds,
	});
	const organizations: StaticFabOrganizationState = {
		nextOrganizationId: 6,
		records: [
			{ id: 1, kind: "AREA", name: "Bank", membership: membership(parentEdges) },
			{
				id: 2,
				kind: "BAY",
				name: "Bay A",
				parentOrganizationIds: [1],
				membership: membership(participantZeroEdges),
			},
			{
				id: 3,
				kind: "BAY",
				name: "Bay B",
				parentOrganizationIds: [1],
				membership: membership(participantOneEdges),
			},
			{
				id: 4,
				kind: "AISLE",
				name: "Process A",
				parentOrganizationIds: [2],
				membership: membership(participantZeroEdges),
			},
			{
				id: 5,
				kind: "AISLE",
				name: "Process B",
				parentOrganizationIds: [3],
				membership: membership(participantOneEdges),
			},
		],
	};
	return { map, organizations, relationships };
}

function connectDirectedPath(map: TileMap, cells: readonly { x: number; y: number }[]): void {
	for (let index = 1; index < cells.length; index++) {
		const from = cells[index - 1] as { x: number; y: number };
		const to = cells[index] as { x: number; y: number };
		const direction = directionBetween(from, to);
		if (direction === null) throw new Error("test path must be adjacent");
		const source = decodeRailCell(map.getEncoded(from.x, from.y));
		const target = decodeRailCell(map.getEncoded(to.x, to.y));
		map.setEncoded(
			from.x,
			from.y,
			encodeRailCell({ ...source, outgoing: source.outgoing | direction }),
		);
		map.setEncoded(
			to.x,
			to.y,
			encodeRailCell({ ...target, incoming: target.incoming | oppositeDirection(direction) }),
		);
	}
}

function edge(fromX: number, fromY: number, toX: number, toY: number): DirectedRailEdge {
	return { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
}

function parentScoped(edgeValue: DirectedRailEdge): StaticFabAssemblyScopedEdgeV1 {
	return { edge: edgeValue, scope: { kind: "PARENT_DIRECT" } };
}

function participantScoped(
	edgeValue: DirectedRailEdge,
	participantIndex: 0 | 1,
	directOwnerOrganizationIds: readonly number[],
): StaticFabAssemblyScopedEdgeV1 {
	return {
		edge: edgeValue,
		scope: { kind: "PARTICIPANT_EFFECTIVE", participantIndex, directOwnerOrganizationIds },
	};
}

function combinedScoped(
	edgeValue: DirectedRailEdge,
	participantIndex: 0 | 1,
	directOwnerOrganizationIds: readonly number[],
): StaticFabAssemblyScopedEdgeV1 {
	return {
		edge: edgeValue,
		scope: {
			kind: "PARENT_AND_PARTICIPANT_EFFECTIVE",
			participantIndex,
			directOwnerOrganizationIds,
		},
	};
}

function witness(incidence: "INCOMING" | "OUTGOING", scopedEdge: StaticFabAssemblyScopedEdgeV1) {
	return { incidence, binding: { kind: "WITNESS" as const, scopedEdge } };
}

function alias(incidence: "INCOMING" | "OUTGOING", exclusiveCutEdgeIndex: number) {
	return {
		incidence,
		binding: { kind: "EXCLUSIVE_CUT_EDGE" as const, exclusiveCutEdgeIndex },
	};
}

function contactSeam(
	incoming: ReturnType<typeof witness> | ReturnType<typeof alias>,
	outgoing: ReturnType<typeof witness> | ReturnType<typeof alias>,
) {
	return { role: "CONTACT" as const, incidences: [incoming, outgoing] };
}

function firstLeg(state: StaticFabAssemblyRelationshipStateV1): StaticFabAssemblyRelationshipLegV1 {
	const leg = state.records[0]?.connectionGroups[0]?.legs[0];
	if (!leg) throw new Error("expected first leg");
	return leg;
}

function setCursor(state: StaticFabAssemblyRelationshipStateV1, value: number): void {
	(state as { nextRelationshipId: number }).nextRelationshipId = value;
}

function setManagedChildren(state: StaticFabAssemblyRelationshipStateV1, value: number[]): void {
	(
		state.records[0] as unknown as { managedChildOrganizationIds: number[] }
	).managedChildOrganizationIds = value;
}

function setFirstGroupOrdinal(state: StaticFabAssemblyRelationshipStateV1, value: number): void {
	(state.records[0]?.connectionGroups[0] as { ordinal: number }).ordinal = value;
}

function compareEdges(left: DirectedRailEdge, right: DirectedRailEdge): number {
	return (
		left.from.x - right.from.x ||
		left.from.y - right.from.y ||
		left.to.x - right.to.x ||
		left.to.y - right.to.y
	);
}
