import { describe, expect, it } from "vitest";
import { productionBankContactFixture } from "../compile/StaticFabAssemblyRelationshipTestFixture";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	checksumRailPatchResult,
} from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import {
	decodeRailPatchSoA,
	encodeRailPatchEvent,
	encodeStaticFabAdditionRailPatchEventCooperatively,
} from "../worker/railMirrorProtocol";
import { planRailConstruction } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "./RailTemplateCatalog";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import { captureStaticFabOrganizationBundle } from "./StaticFabOrganizationBundle";
import {
	adoptStaticFabOrganizationBundlePlacementWorkerPlan,
	issueStaticFabOrganizationBundlePlacementPermit,
	planStaticFabOrganizationBundlePlacement,
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_KIND,
	type StaticFabOrganizationBundlePlacementPermit,
	type StaticFabOrganizationBundlePlacementPlan,
	staticFabOrganizationBundleFingerprint,
	staticFabOrganizationBundlePlacementFingerprint,
} from "./StaticFabOrganizationBundlePlacement";

describe("StaticFabOrganizationBundle document commit", () => {
	it("prepares a complete nested relationship closure and replays the exact six-domain packet", async () => {
		const fixture = productionBankContactFixture();
		const root = fixture.organizations.records.find(
			(record) => (record.parentOrganizationIds?.length ?? 0) === 0,
		);
		if (!root) throw new Error("Synthetic Fab root missing");
		const captured = captureStaticFabOrganizationBundle(
			fixture.map,
			fixture.portEquipment,
			0,
			fixture.organizations,
			fixture.relationships,
			[root.id],
			"EFFECTIVE",
		);
		if (!captured.valid) throw new Error(captured.reason);
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(snapshotFor(document));
		let encoded: ReturnType<typeof encodeRailPatchEvent> | null = null;
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => {
			events.push(event);
			const packet = encoded ?? encodeRailPatchEvent(event);
			encoded = null;
			mirror.applyPatch(decodeRailPatchSoA(packet.patch, mirror.organizationState));
		});
		const plan = adoptedWorkerPlan(document, captured.bundle, { x: 500, y: 500 }, 1);
		expect(plan.relationshipMutations.length).toBeGreaterThan(0);
		let tick = 0;
		const result = await document.commitStaticFabOrganizationBundleCooperatively(plan, {
			now: () => ++tick,
			checkpoint: async () => {},
			preparePatch: async (event, checkpoint) => {
				encoded = await encodeStaticFabAdditionRailPatchEventCooperatively(event, checkpoint, 37);
			},
		});
		expect(result.committed).toBe(true);
		expect(result.publicationError).toBeUndefined();
		expect(events).toHaveLength(1);
		const expected = snapshotFor(document);
		expect(mirror.captureSnapshot()).toEqual(expected);
		expect(document.undo()).toBe(true);
		expect(document.relationships.records).toHaveLength(0);
		expect(document.redo()).toBe(true);
		expect(snapshotFor(document).checksum).toBe(expected.checksum);
		expect(mirror.captureSnapshot()).toEqual(snapshotFor(document));
	});
	it.each([
		["observer failed", "observer failed"],
		["", "문서 변경 통지를 완료하지 못했습니다"],
	])("reports observer failure %j without undoing or misreporting the committed command", async (observerMessage, expectedMessage) => {
		const document = new RailDocument();
		const plan = adoptedWorkerPlan(document, sourceBundle(), { x: 30, y: 30 }, 0);
		const unsubscribe = document.subscribe(() => {
			throw new Error(observerMessage);
		});
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		let tick = 0;
		const result = await document.commitStaticFabOrganizationBundleCooperatively(plan, {
			now: () => ++tick,
			checkpoint: async () => {},
		});
		expect(result).toMatchObject({ committed: true, publicationError: expectedMessage });
		expect(events).toHaveLength(1);
		expect(document.getPatchSequence()).toBe(1);
		expect(document.organizations.records).toHaveLength(1);
		unsubscribe();
		expect(document.undo()).toBe(true);
		expect(document.redo()).toBe(true);
	});
	it("cancels every actual preparation checkpoint without publishing or discarding existing Redo", async () => {
		const bundle = sourceBundle();
		const fixture = () => {
			const document = new RailDocument();
			document.commit(
				planRailConstruction(document.map, { x: -100, y: -100 }, { x: -98, y: -100 }),
			);
			document.undo();
			return { document, plan: adoptedWorkerPlan(document, bundle, { x: 30, y: 30 }, 0) };
		};
		const successful = fixture();
		let checkpoints = 0;
		let tick = 0;
		expect(
			(
				await successful.document.commitStaticFabOrganizationBundleCooperatively(successful.plan, {
					now: () => (tick += 5),
					checkpoint: async () => {
						checkpoints++;
					},
				})
			).committed,
		).toBe(true);
		expect(checkpoints).toBeGreaterThan(10);
		for (let stop = 1; stop <= checkpoints; stop++) {
			const { document, plan } = fixture();
			const original = snapshotFor(document);
			const history = document.captureRailMirrorHistoryLedger();
			const events: RailPatchEvent[] = [];
			document.subscribe((event) => events.push(event));
			const cancelled = new Error(`cancel at ${stop}`);
			let seen = 0;
			await expect(
				document.commitStaticFabOrganizationBundleCooperatively(plan, {
					now: () => (tick += 5),
					checkpoint: async () => {
						if (++seen === stop) throw cancelled;
					},
				}),
			).rejects.toBe(cancelled);
			expect(snapshotFor(document)).toEqual(original);
			expect(document.captureRailMirrorHistoryLedger()).toEqual(history);
			expect(events).toHaveLength(0);
			expect(document.commitStaticFabOrganizationBundle(plan)).toBe(false);
			expect(document.redo()).toBe(true);
		}
	});

	it("keeps a newer command and history when the last preparation clock reenters", async () => {
		const document = new RailDocument();
		const plan = adoptedWorkerPlan(document, sourceBundle(), { x: 30, y: 30 }, 0);
		let armed = false;
		let authored = false;
		let time = 0;
		const result = await document.commitStaticFabOrganizationBundleCooperatively(plan, {
			checkpoint: async () => {},
			preparePatch: async () => {
				armed = true;
			},
			now: () => {
				if (armed && !authored)
					authored = document.commit(
						planRailConstruction(document.map, { x: -100, y: -100 }, { x: -98, y: -100 }),
					);
				return ++time;
			},
		});
		expect(authored).toBe(true);
		expect(result.committed).toBe(false);
		expect(document.getPatchSequence()).toBe(1);
		expect(document.organizations.records).toHaveLength(0);
		expect(document.captureRailMirrorHistoryLedger().undo).toHaveLength(1);
		expect(document.undo()).toBe(true);
		expect(document.map.size).toBe(0);
		expect(document.redo()).toBe(true);
	});

	it("publishes complete state, history and sequence before clocks can observe the candidate", async () => {
		const document = new RailDocument();
		const plan = adoptedWorkerPlan(document, sourceBundle(), { x: 30, y: 30 }, 0);
		const observations: { sequence: number; cells: number; organizations: number; undo: number }[] =
			[];
		const observe = () =>
			observations.push({
				sequence: document.getPatchSequence(),
				cells: document.map.size,
				organizations: document.organizations.records.length,
				undo: document.captureRailMirrorHistoryLedger().undo.length,
			});
		document.subscribe(observe);
		let time = 0;
		const result = await document.commitStaticFabOrganizationBundleCooperatively(plan, {
			now: () => {
				observe();
				return ++time;
			},
			checkpoint: async () => {},
		});
		expect(result.committed).toBe(true);
		for (const observation of observations)
			expect(observation).toEqual(
				observation.sequence === 0
					? { sequence: 0, cells: 0, organizations: 0, undo: 0 }
					: { sequence: 1, cells: plan.mutations.length, organizations: 1, undo: 1 },
			);
	});
	it.each([
		"ordinary",
		"cooperative",
	])("%s publishes one atomic patch and preserves Worker parity through undo and redo", async (mode) => {
		const bundle = sourceBundle();
		const destination = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(
				destination.map,
				destination.getPatchSequence(),
				destination.portEquipment,
				destination.organizations,
			).snapshot,
		);
		const events: RailPatchEvent[] = [];
		let preparedEncoding: Awaited<
			ReturnType<typeof encodeStaticFabAdditionRailPatchEventCooperatively>
		> | null = null;
		destination.subscribe((event) => {
			events.push(event);
			const encoded = preparedEncoding ?? encodeRailPatchEvent(event);
			preparedEncoding = null;
			mirror.applyPatch(decodeRailPatchSoA(encoded.patch, mirror.organizationState));
		});
		const plan = adoptedWorkerPlan(destination, bundle, { x: 30, y: -12 }, 1);

		expect(plan.valid, plan.reason).toBe(true);
		let time = 0;
		const committed =
			mode === "ordinary"
				? destination.commitStaticFabOrganizationBundle(plan)
				: (
						await destination.commitStaticFabOrganizationBundleCooperatively(plan, {
							now: () => ++time,
							checkpoint: async () => {},
							preparePatch: async (event) => {
								expect(destination.map.size).toBe(0);
								expect(destination.organizations.records).toHaveLength(0);
								expect(destination.getPatchSequence()).toBe(0);
								expect(event.sequence).toBe(1);
								preparedEncoding = await encodeStaticFabAdditionRailPatchEventCooperatively(
									event,
									async () => {},
									7,
								);
								expect(preparedEncoding.patch).toEqual(encodeRailPatchEvent(event).patch);
							},
						})
					).committed;
		expect(committed).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]?.kind).toBe(STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_KIND);
		expect(events[0]?.changes.length).toBeGreaterThan(0);
		expect(events[0]?.organizationChanges).toHaveLength(1);
		expect(destination.organizations.records).toHaveLength(1);
		expect(mirror.state.checksum).toBe(
			checksumRailMap(destination.map, destination.portEquipment, destination.organizations),
		);
		const committedChecksum = mirror.state.checksum;
		const committedOrganization = destination.organizations.records[0];

		expect(destination.undo()).toBe(true);
		expect(destination.map.size).toBe(0);
		expect(destination.organizations.records).toHaveLength(0);
		expect(mirror.state.checksum).toBe(
			checksumRailMap(destination.map, destination.portEquipment, destination.organizations),
		);

		expect(destination.redo()).toBe(true);
		expect(destination.organizations.records).toEqual([committedOrganization]);
		expect(mirror.state.checksum).toBe(committedChecksum);
		expect(mirror.state.checksum).toBe(
			checksumRailMap(destination.map, destination.portEquipment, destination.organizations),
		);
	});

	it("rejects forged, cross-document, and stale issued plans without partial mutation", () => {
		const bundle = sourceBundle();
		const destination = new RailDocument();
		const sourceSnapshot = snapshotFor(destination);
		const plan = planStaticFabOrganizationBundlePlacement(
			destination.map,
			destination.portEquipment,
			destination.getPatchSequence(),
			destination.organizations,
			destination.relationships,
			bundle,
			{ x: 20, y: 20 },
			0,
			sourceSnapshot.checksum,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(destination.commitStaticFabOrganizationBundle(plan)).toBe(false);
		const adopted = adoptedWorkerPlan(destination, bundle, { x: 20, y: 20 }, 0);

		const forged = { ...adopted };
		expect(destination.commitStaticFabOrganizationBundle(forged)).toBe(false);
		expect(destination.map.size).toBe(0);
		expect(destination.organizations.records).toHaveLength(0);

		const other = new RailDocument();
		expect(other.commitStaticFabOrganizationBundle(adopted)).toBe(false);
		expect(other.map.size).toBe(0);

		const unrelated = planRailTemplate(
			destination.map,
			"long-bay",
			{ x: -40, y: -40 },
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		expect(destination.commit(unrelated)).toBe(true);
		const before = checksumRailMap(
			destination.map,
			destination.portEquipment,
			destination.organizations,
		);
		expect(destination.commitStaticFabOrganizationBundle(adopted)).toBe(false);
		expect(
			checksumRailMap(destination.map, destination.portEquipment, destination.organizations),
		).toBe(before);
	});

	it("keeps direct planner output non-committable without one-shot Worker adoption", () => {
		const destination = new RailDocument();
		const plan = planStaticFabOrganizationBundlePlacement(
			destination.map,
			destination.portEquipment,
			destination.getPatchSequence(),
			destination.organizations,
			destination.relationships,
			sourceBundle(),
			{ x: -30, y: 18 },
			0,
			null,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(destination.commitStaticFabOrganizationBundle(plan)).toBe(false);
		expect(destination.map.size).toBe(0);
	});

	it("adopts a Worker clone once and rejects cloned permits, replay, and second commit", () => {
		const destination = new RailDocument();
		const bundle = sourceBundle();
		const snapshot = snapshotFor(destination);
		const anchor = Object.freeze({ x: 24, y: -18 });
		const permit = issueStaticFabOrganizationBundlePlacementPermit(
			destination.map,
			destination.portEquipment,
			destination.getPatchSequence(),
			destination.organizations,
			destination.relationships,
			bundle,
			anchor,
			1,
			snapshot.checksum,
		);
		const workerPlan = structuredClone(
			planStaticFabOrganizationBundlePlacement(
				destination.map,
				destination.portEquipment,
				destination.getPatchSequence(),
				destination.organizations,
				destination.relationships,
				bundle,
				anchor,
				1,
				snapshot.checksum,
			),
		);
		const ticket = Object.freeze({
			ticketId: permit.ticketId,
			validationLevel: "exact" as const,
			sourceRevision: snapshot.revision,
			sourcePatchSequence: snapshot.sequence,
			sourceChecksum: snapshot.checksum,
			sourceNextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
			sourceNextPortId: snapshot.portEquipment.nextPortId,
			sourceNextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: destination.organizations.nextOrganizationId,
			sourceNextRelationshipId: destination.relationships.nextRelationshipId,
			bundleFingerprint: staticFabOrganizationBundleFingerprint(bundle),
			anchor,
			quarterTurns: 1 as const,
			planFingerprint: staticFabOrganizationBundlePlacementFingerprint(workerPlan),
			prospectiveChecksum: checksumRailPatchResult(snapshot.checksum, {
				changes: workerPlan.mutations,
				switchChanges: workerPlan.switchMutations,
				portChanges: workerPlan.portMutations,
				equipmentGroupChanges: workerPlan.equipmentGroupMutations,
				organizationChanges: workerPlan.organizationMutations,
				organizationNextIdBefore: workerPlan.nextOrganizationIdBefore,
				organizationNextIdAfter: workerPlan.nextOrganizationIdAfter,
				relationshipChanges: workerPlan.relationshipMutations,
				relationshipNextIdBefore: workerPlan.nextRelationshipIdBefore,
				relationshipNextIdAfter: workerPlan.nextRelationshipIdAfter,
			}),
			prospectiveNextAdvancedSwitchId: nextCursor(
				snapshot.nextAdvancedSwitchId,
				workerPlan.switchMutations,
			),
			prospectiveNextPortId: nextCursor(
				snapshot.portEquipment.nextPortId,
				workerPlan.portMutations,
			),
			prospectiveNextEquipmentGroupId: nextCursor(
				snapshot.portEquipment.nextEquipmentGroupId,
				workerPlan.equipmentGroupMutations,
			),
			prospectiveNextOrganizationId: workerPlan.nextOrganizationIdAfter,
			prospectiveNextRelationshipId: workerPlan.nextRelationshipIdAfter,
		});
		const expectedProspectiveChecksum = ticket.prospectiveChecksum;
		const mismatchedPermit = issueStaticFabOrganizationBundlePlacementPermit(
			destination.map,
			destination.portEquipment,
			destination.getPatchSequence(),
			destination.organizations,
			destination.relationships,
			bundle,
			anchor,
			1,
			snapshot.checksum,
		);
		const mismatchedTicket = Object.freeze({
			...ticket,
			ticketId: mismatchedPermit.ticketId,
			prospectiveChecksum: `${expectedProspectiveChecksum}-corrupted`,
		});
		expect(
			adoptStaticFabOrganizationBundlePlacementWorkerPlan(
				mismatchedPermit,
				workerPlan,
				mismatchedTicket,
				expectedProspectiveChecksum,
				destination.map,
				destination.portEquipment,
				destination.organizations,
				destination.relationships,
			),
		).toBeNull();
		expect(
			adoptStaticFabOrganizationBundlePlacementWorkerPlan(
				mismatchedPermit,
				workerPlan,
				{ ...ticket, ticketId: mismatchedPermit.ticketId },
				expectedProspectiveChecksum,
				destination.map,
				destination.portEquipment,
				destination.organizations,
				destination.relationships,
			),
		).toBeNull();

		expect(
			adoptStaticFabOrganizationBundlePlacementWorkerPlan(
				structuredClone(permit) as StaticFabOrganizationBundlePlacementPermit,
				workerPlan,
				ticket,
				expectedProspectiveChecksum,
				destination.map,
				destination.portEquipment,
				destination.organizations,
				destination.relationships,
			),
		).toBeNull();
		const adopted = adoptStaticFabOrganizationBundlePlacementWorkerPlan(
			permit,
			workerPlan,
			ticket,
			expectedProspectiveChecksum,
			destination.map,
			destination.portEquipment,
			destination.organizations,
			destination.relationships,
		);
		expect(adopted).not.toBeNull();
		expect(
			adoptStaticFabOrganizationBundlePlacementWorkerPlan(
				permit,
				workerPlan,
				ticket,
				expectedProspectiveChecksum,
				destination.map,
				destination.portEquipment,
				destination.organizations,
				destination.relationships,
			),
		).toBeNull();
		if (!adopted) throw new Error("Expected the Worker plan to be adopted.");
		expect(destination.commitStaticFabOrganizationBundle(adopted)).toBe(true);
		expect(destination.commitStaticFabOrganizationBundle(adopted)).toBe(false);
	});
});

function adoptedWorkerPlan(
	document: RailDocument,
	bundle: ReturnType<typeof sourceBundle>,
	anchor: { x: number; y: number },
	quarterTurns: 0 | 1 | 2 | 3,
): StaticFabOrganizationBundlePlacementPlan {
	const snapshot = snapshotFor(document);
	const permit = issueStaticFabOrganizationBundlePlacementPermit(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		document.relationships,
		bundle,
		anchor,
		quarterTurns,
		snapshot.checksum,
	);
	const workerPlan = structuredClone(
		planStaticFabOrganizationBundlePlacement(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			document.relationships,
			bundle,
			anchor,
			quarterTurns,
			snapshot.checksum,
		),
	);
	if (!workerPlan.valid) throw new Error(workerPlan.reason);
	const prospectiveChecksum = checksumRailPatchResult(snapshot.checksum, {
		changes: workerPlan.mutations,
		switchChanges: workerPlan.switchMutations,
		portChanges: workerPlan.portMutations,
		equipmentGroupChanges: workerPlan.equipmentGroupMutations,
		organizationChanges: workerPlan.organizationMutations,
		organizationNextIdBefore: workerPlan.nextOrganizationIdBefore,
		organizationNextIdAfter: workerPlan.nextOrganizationIdAfter,
		relationshipChanges: workerPlan.relationshipMutations,
		relationshipNextIdBefore: workerPlan.nextRelationshipIdBefore,
		relationshipNextIdAfter: workerPlan.nextRelationshipIdAfter,
	});
	const adopted = adoptStaticFabOrganizationBundlePlacementWorkerPlan(
		permit,
		workerPlan,
		{
			ticketId: permit.ticketId,
			sourceRevision: snapshot.revision,
			sourcePatchSequence: snapshot.sequence,
			sourceChecksum: snapshot.checksum,
			sourceNextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
			sourceNextPortId: snapshot.portEquipment.nextPortId,
			sourceNextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: document.organizations.nextOrganizationId,
			sourceNextRelationshipId: document.relationships.nextRelationshipId,
			bundleFingerprint: staticFabOrganizationBundleFingerprint(bundle),
			anchor,
			quarterTurns,
			planFingerprint: staticFabOrganizationBundlePlacementFingerprint(workerPlan),
			validationLevel: "exact",
			prospectiveChecksum,
			prospectiveNextAdvancedSwitchId: nextCursor(
				snapshot.nextAdvancedSwitchId,
				workerPlan.switchMutations,
			),
			prospectiveNextPortId: nextCursor(
				snapshot.portEquipment.nextPortId,
				workerPlan.portMutations,
			),
			prospectiveNextEquipmentGroupId: nextCursor(
				snapshot.portEquipment.nextEquipmentGroupId,
				workerPlan.equipmentGroupMutations,
			),
			prospectiveNextOrganizationId: workerPlan.nextOrganizationIdAfter,
			prospectiveNextRelationshipId: workerPlan.nextRelationshipIdAfter,
		},
		prospectiveChecksum,
		document.map,
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
	if (!adopted) throw new Error("Worker plan adoption failed.");
	return adopted;
}

function nextCursor(
	source: number,
	mutations: readonly { readonly after: { readonly id: number } | null }[],
): number {
	return mutations.reduce(
		(cursor, mutation) =>
			mutation.after && mutation.after.id >= cursor ? mutation.after.id + 1 : cursor,
		source,
	);
}

function snapshotFor(document: RailDocument) {
	return captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	).snapshot;
}

function sourceBundle() {
	const source = new RailDocument();
	const plan = planRailTemplate(
		source.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	if (!plan.valid || !source.commit(plan)) {
		throw new Error(`Source Long Bay failed: ${plan.reason}`);
	}
	const modules = buildRailModuleOwnershipIndex(source.map).modules;
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: 2,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "BAY" as const,
				name: "Reusable Bay",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "", color: "CYAN" as const }),
				membership: membershipFromModules(modules),
			}),
		]),
	});
	const result = captureStaticFabOrganizationBundle(
		source.map,
		source.portEquipment,
		source.getPatchSequence(),
		organizations,
		source.relationships,
		[1],
		"DIRECT",
	);
	if (!result.valid) throw new Error(result.reason);
	return result.bundle;
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([]),
	});
}
