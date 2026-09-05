import { describe, expect, it, vi } from "vitest";
import { emptyPortEquipmentState } from "./EquipmentGroup";
import { validatePortEquipmentActivation } from "./PortEquipmentActivation";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { DIR_E, DIR_W } from "./railShape";
import {
	createStaticFabAssemblyRelationshipState,
	type StaticFabAssemblyRelationshipStateV1,
	staticFabAssemblyRelationshipStateSourceError,
} from "./StaticFabAssemblyRelationship";
import {
	assertStaticFabAssemblyRelationshipActivation,
	staticFabAssemblyRelationshipActivationMatches,
	validateStaticFabAssemblyRelationshipActivation,
} from "./StaticFabAssemblyRelationshipActivation";
import { copyStaticFabOrganizationState } from "./StaticFabOrganization";
import { validateStaticFabOrganizationActivation } from "./StaticFabOrganizationActivation";
import { encodeRailCell, TileMap } from "./TileMap";

describe("StaticFabAssemblyRelationshipActivation", () => {
	it("requires the exact completed proof before consuming document adoption evidence", async () => {
		const fixture = await sourceFixture();
		const portProof = await validatePortEquipmentActivation(
			fixture.map,
			fixture.portEquipment,
			async () => undefined,
		);
		const proof = await activate(fixture);
		const adopt = (relationships = fixture.relationships, activation?: typeof proof) =>
			RailDocument.fromCooperativelyValidatedMap(
				fixture.map,
				17,
				fixture.portEquipment,
				fixture.organizations,
				portProof,
				fixture.organizationActivation,
				undefined,
				relationships,
				activation,
			);
		expect(() => adopt()).toThrow(/generation/);
		expect(() => adopt(fixture.relationships, Object.freeze({}) as typeof proof)).toThrow(
			/generation/,
		);
		expect(() =>
			adopt(createStaticFabAssemblyRelationshipState(fixture.relationships), proof),
		).toThrow(/generation/);
		expect(() => adopt(structuredClone(fixture.relationships), proof)).toThrow(/canonical/);
		const scan = vi.spyOn(fixture.map, "forEachRail").mockImplementation(() => {
			throw new Error("Document adoption must use completed relationship evidence");
		});
		try {
			const document = adopt(fixture.relationships, proof);
			expect(document.relationships).toBe(fixture.relationships);
			expect(document.organizations).toBe(fixture.organizations);
			expect(document.map).toBe(fixture.map);
			expect(document.getPatchSequence()).toBe(17);
			expect(document.canUndo).toBe(false);
			expect(document.canRedo).toBe(false);
			expect(scan).not.toHaveBeenCalled();
			expect(() => adopt(fixture.relationships, proof)).toThrow(/이미 다른 문서에서 소비/);
		} finally {
			scan.mockRestore();
		}
	});

	it("accepts canonical empty relationship cursors and rejects mutable empty input before adoption", async () => {
		const fixture = await sourceFixture();
		const portProof = await validatePortEquipmentActivation(
			fixture.map,
			fixture.portEquipment,
			async () => undefined,
		);
		const adopt = (relationships: StaticFabAssemblyRelationshipStateV1) =>
			RailDocument.fromCooperativelyValidatedMap(
				fixture.map,
				0,
				fixture.portEquipment,
				fixture.organizations,
				portProof,
				fixture.organizationActivation,
				undefined,
				relationships,
			);
		expect(() => adopt({ nextRelationshipId: 7, records: [] })).toThrow(/canonical/);
		const empty = createStaticFabAssemblyRelationshipState({ nextRelationshipId: 7, records: [] });
		expect(adopt(empty).relationships).toBe(empty);
	});

	it("validates a non-empty source across 50k background edges using the supplied ownership", async () => {
		const fixture = await sourceFixture(50_000);
		expect(
			staticFabAssemblyRelationshipStateSourceError(
				fixture.map,
				fixture.organizations,
				fixture.relationships,
				fixture.ownership,
			),
		).toBeNull();
		const scan = vi.spyOn(fixture.map, "forEachRail").mockImplementation(() => {
			throw new Error("Relationship activation must not rebuild the ownership graph");
		});
		let checkpoints = 0;
		let previous = performance.now();
		let maximumSlice = 0;
		const proof = await activate(
			fixture,
			async () => {
				const now = performance.now();
				maximumSlice = Math.max(maximumSlice, now - previous);
				previous = now;
				checkpoints++;
			},
			64,
		);
		expect(checkpoints).toBeGreaterThan(1_000);
		expect(maximumSlice).toBeLessThan(50);
		expect(scan).not.toHaveBeenCalled();
		scan.mockRestore();
		expect(matches(fixture, proof)).toBe(true);
		expect(Object.isFrozen(proof)).toBe(true);
		expect(Reflect.ownKeys(proof)).toEqual([]);
	});

	it("binds proof identity to the exact authored generations and rejects forged values", async () => {
		const fixture = await sourceFixture();
		const proof = await activate(fixture);
		expect(matches(fixture, proof)).toBe(true);
		for (const forged of [null, {}, Object.freeze({}), { ...proof }, Object.create(proof)]) {
			expect(matches(fixture, forged)).toBe(false);
			expect(() =>
				assertStaticFabAssemblyRelationshipActivation(
					forged,
					fixture.map,
					fixture.portEquipment,
					fixture.organizations,
					fixture.relationships,
				),
			).toThrow(/generation/);
		}
		expect(
			staticFabAssemblyRelationshipActivationMatches(
				proof,
				fixture.map,
				fixture.portEquipment,
				fixture.organizations,
				createStaticFabAssemblyRelationshipState(fixture.relationships),
			),
		).toBe(false);
		expect(
			staticFabAssemblyRelationshipActivationMatches(
				proof,
				fixture.map,
				fixture.portEquipment,
				copyStaticFabOrganizationState(fixture.organizations),
				fixture.relationships,
			),
		).toBe(false);
		const revision = fixture.map.getRevision();
		const original = fixture.map.getEncoded(0, 0);
		const checkpoint = fixture.map.createMutationCheckpoint();
		const mutations = [{ x: 0, y: 0, before: original, after: 0 }];
		fixture.map.applyAtomicMutations(mutations, []);
		fixture.map.rollbackAtomicMutations(mutations, [], checkpoint);
		expect(fixture.map.getRevision()).toBe(revision);
		expect(matches(fixture, proof)).toBe(false);
	});

	it("rejects changed source after yielding and preserves cancellation through the final checkpoint", async () => {
		const fixture = await sourceFixture();
		let checkpoints = 0;
		await activate(
			fixture,
			async () => {
				checkpoints++;
			},
			1,
		);
		let current = 0;
		await expect(
			activate(
				fixture,
				async () => {
					if (++current === checkpoints) throw new Error("cancelled at completion");
				},
				1,
			),
		).rejects.toThrow("cancelled at completion");
		await expect(
			activate(
				fixture,
				async () => {
					fixture.map.setEncoded(0, 0, 0);
				},
				1,
			),
		).rejects.toThrow(/generation/);
	});

	it("rejects source-invalid canonical relationships with the same semantic error as synchronous validation", async () => {
		const fixture = await sourceFixture();
		const record = fixture.relationships.records[0];
		if (!record) throw new Error("Missing source relationship");
		const invalid = createStaticFabAssemblyRelationshipState({
			nextRelationshipId: 2,
			records: [{ ...record, parentOrganizationId: 99 }],
		});
		const error = staticFabAssemblyRelationshipStateSourceError(
			fixture.map,
			fixture.organizations,
			invalid,
			fixture.ownership,
		);
		expect(error).toContain("부모 조직");
		await expect(activate({ ...fixture, relationships: invalid })).rejects.toThrow(error as string);
	});

	it("requires canonical input, exact organization authority, and positive operation budgets", async () => {
		const fixture = await sourceFixture();
		await expect(
			activate({ ...fixture, relationships: structuredClone(fixture.relationships) }),
		).rejects.toThrow(/canonical/);
		const foreign = await sourceFixture();
		await expect(
			activate({ ...fixture, organizationActivation: foreign.organizationActivation }),
		).rejects.toThrow(/generation/);
		await expect(activate({ ...fixture, ownership: foreign.ownership })).rejects.toThrow(
			/generation/,
		);
		for (const budget of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			await expect(activate(fixture, async () => undefined, budget)).rejects.toThrow(/budget/);
		}
	});
});

async function sourceFixture(backgroundEdges = 0) {
	const map = new TileMap();
	const line = (length: number, y: number) => {
		for (let x = 0; x <= length; x++) {
			map.setEncoded(
				x,
				y,
				encodeRailCell({ incoming: x === 0 ? 0 : DIR_W, outgoing: x === length ? 0 : DIR_E }),
			);
		}
		return Array.from({ length }, (_, x) => ({ from: { x, y }, to: { x: x + 1, y } }));
	};
	const edges = line(10, 0);
	const incoming = edges[4];
	const outgoing = edges[5];
	if (!incoming || !outgoing) throw new Error("Missing contact edges");
	const background = backgroundEdges > 0 ? line(backgroundEdges, 20) : [];
	const membership = (railEdges: typeof edges) => ({
		railEdges,
		advancedSwitchIds: [],
		equipmentGroupIds: [],
	});
	const organizations = copyStaticFabOrganizationState({
		nextOrganizationId: 5,
		records: [
			{ id: 1, kind: "AREA", name: "Bank", membership: membership(edges.slice(0, 5)) },
			{
				id: 2,
				kind: "BAY",
				name: "Bay",
				parentOrganizationIds: [1],
				membership: membership(edges.slice(5)),
			},
			{
				id: 3,
				kind: "AISLE",
				name: "Process Loop",
				parentOrganizationIds: [2],
				membership: membership(edges.slice(5)),
			},
			...(backgroundEdges > 0
				? [
						{
							id: 4,
							kind: "PROCESS_FAMILY" as const,
							name: "Independent scale rail",
							membership: membership(background),
						},
					]
				: []),
		],
	});
	const relationships = createStaticFabAssemblyRelationshipState({
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
										role: "CONTACT",
										incidences: [
											{
												incidence: "INCOMING",
												binding: {
													kind: "WITNESS",
													scopedEdge: { edge: incoming, scope: { kind: "PARENT_DIRECT" } },
												},
											},
											{
												incidence: "OUTGOING",
												binding: {
													kind: "WITNESS",
													scopedEdge: {
														edge: outgoing,
														scope: {
															kind: "PARTICIPANT_EFFECTIVE",
															participantIndex: 0,
															directOwnerOrganizationIds: [2, 3],
														},
													},
												},
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
	} satisfies StaticFabAssemblyRelationshipStateV1);
	const portEquipment = emptyPortEquipmentState();
	const ownership = buildRailModuleOwnershipIndex(map);
	const organizationActivation = await validateStaticFabOrganizationActivation(
		map,
		portEquipment,
		organizations,
		ownership,
		async () => undefined,
	);
	return { map, portEquipment, organizations, relationships, ownership, organizationActivation };
}

function activate(
	fixture: Awaited<ReturnType<typeof sourceFixture>>,
	checkpoint: () => Promise<void> = async () => undefined,
	budget = 128,
) {
	return validateStaticFabAssemblyRelationshipActivation(
		fixture.map,
		fixture.portEquipment,
		fixture.organizations,
		fixture.relationships,
		fixture.ownership,
		fixture.organizationActivation,
		checkpoint,
		budget,
	);
}

function matches(fixture: Awaited<ReturnType<typeof sourceFixture>>, proof: unknown) {
	return staticFabAssemblyRelationshipActivationMatches(
		proof,
		fixture.map,
		fixture.portEquipment,
		fixture.organizations,
		fixture.relationships,
	);
}
