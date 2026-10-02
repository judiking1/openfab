import { describe, expect, it, vi } from "vitest";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	checksumRailPatchResultCooperatively,
} from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import {
	decodeRailPatchSoA,
	encodeRailPatchEvent,
	railMirrorSnapshotTransfers,
} from "../worker/railMirrorProtocol";
import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { copyPortEquipmentState, emptyPortEquipmentState } from "./EquipmentGroup";
import { emptyOperationalConfigurationState } from "./OperationalConfiguration";
import { planRailConstruction, planRailErase, type RailMutation } from "./paint";
import {
	RailDocument,
	type RailDocumentProcessLoopRepairCommitOptions,
	type RailPatchEvent,
} from "./RailDocument";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "./RailModuleOwnership";
import type { RailPatchTransition } from "./RailPatchHistory";
import { DIR_E, DIR_W } from "./railShape";
import { emptyStaticFabAssemblyRelationshipState } from "./StaticFabAssemblyRelationship";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	createCanonicalStaticFabOrganizationStateBuilder,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import { cachedStaticFabOrganizationMembershipFingerprint } from "./StaticFabOrganizationFingerprint";
import {
	planRemoveStaticFabOrganization,
	planRenameStaticFabOrganization,
} from "./StaticFabOrganizationPlan";
import type { StaticFabProcessLoopRegistrationDocument } from "./StaticFabProcessLoopRegistration";
import {
	consumeStaticFabProcessLoopRepairApplyCooperatively,
	prepareStaticFabProcessLoopRepairCooperatively,
	revokeStaticFabProcessLoopRepairApply,
	type StaticFabProcessLoopRepairPorts,
	type StaticFabProcessLoopRepairRequest,
} from "./StaticFabProcessLoopRepair";
import { TileMap } from "./TileMap";

describe("source-bound standalone Loop repair preparation (unpublished candidate)", () => {
	it("opens an equipped Loop with one candidate and unchanged ID, declaration and equipment", async () => {
		const f = fixture();
		const before = capture(f.document),
			events = vi.fn();
		f.document.subscribe(events);
		const clone = vi.spyOn(f.document.map, "createMutationCandidateSteps");
		const apply = await f.prepare().promise;
		expect(apply).toEqual({
			kind: "repair-static-fab-process-loop",
			organizationId: 1,
			name: "Manual Loop",
		});
		expect(Object.keys(apply)).toEqual(["kind", "organizationId", "name"]);
		const plan = await consumeStaticFabProcessLoopRepairApplyCooperatively(
			apply,
			f.document,
			async () => {},
		);
		expect(plan).not.toBeNull();
		if (!plan) throw new Error("expected prepared candidate");
		expect(clone).toHaveBeenCalledTimes(1);
		expect(plan.nextMap).not.toBe(f.document.map);
		expect(plan.nextMap.getEncoded(18, 20)).toBe(0);
		expect(plan.nextMap.getRevision()).toBe(before.revision + plan.changes.length);
		expect(plan.nextOrganizations.records[0]).toMatchObject({
			id: 1,
			name: "Manual Loop",
			kind: "AISLE",
			declaredSemanticRole: "PROCESS_LOOP",
			parentOrganizationIds: [],
			properties: { description: "Synthetic user Loop", color: "TEAL" },
			membership: { advancedSwitchIds: [], equipmentGroupIds: [1] },
		});
		expect(plan.portChanges).toEqual([]);
		expect(plan.equipmentGroupChanges).toEqual([]);
		expect(plan.relationshipChanges).toEqual([]);
		expect(plan.organizationImpactAuthorizations).toEqual([]);
		expect(plan.prospectiveChecksum).toBe(
			checksumRailMap(
				plan.nextMap,
				f.document.portEquipment,
				plan.nextOrganizations,
				f.document.relationships,
			),
		);
		for (const transition of f.transitions) {
			expect(Object.keys(transition)).not.toContain("nextMap");
			expect(Object.keys(transition)).not.toContain("nextImpactIndex");
			expect(Object.keys(transition)).not.toContain("organizationActivation");
		}
		expect(f.transitions).toHaveLength(2);
		expect(events).not.toHaveBeenCalled();
		assertUnchanged(f.document, before);
		revokeStaticFabProcessLoopRepairApply(apply);
	});

	it("refuses erasing actual Port support while preserving all source objects", async () => {
		const document = equippedDocument();
		const plan = planRailErase(document.map, [{ x: 10, y: 0 }]);
		expect(plan.valid, plan.reason).toBe(true);
		const f = fixture(document, plan.mutations),
			before = capture(document);
		await expect(f.prepare().promise).rejects.toThrow(/port.*route|Port|PORT/i);
		assertUnchanged(document, before);
	});

	it("refuses impact on another stored owner even when the target owns the same rail", async () => {
		const base = equippedDocument();
		const index = buildRailModuleOwnershipIndex(base.map);
		const shared = index.modules.find((module) =>
			module.eraseEdges.some((value) => value.from.x === 18 && value.from.y === 20),
		);
		if (!shared) throw new Error("expected protected synthetic module");
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 3,
			records: [
				base.organizations.records[0] as StaticFabOrganizationState["records"][number],
				{
					id: 2,
					kind: "AREA",
					name: "Protected zone",
					declaredSemanticRole: null,
					parentOrganizationIds: [],
					membership: {
						railEdges: [...shared.eraseEdges].sort(compareDirectedRailEdges),
						advancedSwitchIds: [],
						equipmentGroupIds: [],
					},
				},
			],
		});
		const document = RailDocument.fromLoadedMap(base.map, 0, base.portEquipment, organizations);
		const f = fixture(document),
			before = capture(document);
		await expect(f.prepare().promise).rejects.toThrow(/protected organization 2/);
		assertUnchanged(document, before);
	});

	it("refuses deletion of otherwise unowned rails", async () => {
		const base = equippedDocument();
		const addition = planRailConstruction(base.map, { x: 100, y: 40 }, { x: 115, y: 40 });
		expect(addition.valid, addition.reason).toBe(true);
		base.map.applyAtomicMutations(addition.mutations, []);
		const document = RailDocument.fromLoadedMap(
			base.map,
			0,
			base.portEquipment,
			base.organizations,
		);
		const erase = planRailErase(document.map, [{ x: 106, y: 40 }]);
		const f = fixture(document, erase.mutations),
			before = capture(document);
		await expect(f.prepare().promise).rejects.toThrow(/outside the existing owner/);
		assertUnchanged(document, before);
	});

	it("refuses adding a detached new component to an existing Loop", async () => {
		const document = equippedDocument();
		const addition = planRailConstruction(document.map, { x: 100, y: 40 }, { x: 110, y: 40 });
		const f = fixture(document, addition.mutations),
			before = capture(document);
		await expect(f.prepare().promise).rejects.toThrow(/touch the existing Loop/);
		assertUnchanged(document, before);
	});

	it("refuses silently acquiring unchanged unowned edges after a module merge", async () => {
		const map = new TileMap();
		for (const [from, to] of [
			[0, 5],
			[7, 12],
		]) {
			const plan = planRailConstruction(
				map,
				{ x: from as number, y: 0 },
				{ x: to as number, y: 0 },
			);
			map.applyAtomicMutations(plan.mutations, []);
		}
		const index = buildRailModuleOwnershipIndex(map);
		const owned = index.modules
			.flatMap((module) => module.eraseEdges)
			.filter((value) => value.from.x < 5 && value.to.x <= 5);
		const organizations = organizationState(owned);
		const document = RailDocument.fromLoadedMap(map, 0, emptyPortEquipmentState(), organizations);
		const addition = planRailConstruction(map, { x: 5, y: 0 }, { x: 7, y: 0 });
		expect(addition.valid, addition.reason).toBe(true);
		const f = fixture(document, addition.mutations),
			before = capture(document);
		await expect(f.prepare().promise).rejects.toThrow(/모듈.*전체/);
		assertUnchanged(document, before);
	});

	it("rejects switch sidecar commands and raw edits to switch claims", async () => {
		const base = new RailDocument();
		const lead = planRailConstruction(base.map, { x: -3, y: 0 }, { x: 0, y: 0 });
		base.commit(lead);
		const switchPlan = planAdvancedSwitch(base.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "A");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		base.commit(switchPlan);
		const document = registeredDocument(base.map);
		const switchRecord = document.map.getAdvancedSwitch(1);
		if (!switchRecord) throw new Error("expected switch fixture");
		const cell = deriveAdvancedSwitchGeometry(switchRecord).sharedTrunkSupport;
		const f = fixture(document, [
			{ ...cell, before: document.map.getEncoded(cell.x, cell.y), after: 0 },
		]);
		const before = capture(document);
		expect(() =>
			prepareStaticFabProcessLoopRepairCooperatively(
				{ ...f.request, switchChanges: [{ id: 1, before: switchRecord, after: null }] },
				f.ports,
			),
		).toThrow(/rail-only/);
		await expect(f.prepare().promise).rejects.toThrow(/switch claim/);
		assertUnchanged(document, before);
	});

	it("captures an accessor intent once and uses that exact admitted frozen array", async () => {
		const f = fixture();
		let reads = 0;
		const input = {
			...f.request,
			get changes() {
				return ++reads === 1 ? f.request.changes : [];
			},
		};
		const preparation = prepareStaticFabProcessLoopRepairCooperatively(input, f.ports);
		const apply = await preparation.promise;
		expect(reads).toBe(1);
		expect(preparation.request.changes).toBe(f.request.changes);
		revokeStaticFabProcessLoopRepairApply(apply);
	});

	it("refuses mutable intent containers and records instead of reading across awaits", async () => {
		const f = fixture(),
			before = capture(f.document);
		expect(() =>
			prepareStaticFabProcessLoopRepairCooperatively(
				{ ...f.request, changes: [...f.request.changes] },
				f.ports,
			),
		).toThrow(/immutable/);
		const changes = Object.freeze(f.request.changes.map((value) => ({ ...value })));
		await expect(
			prepareStaticFabProcessLoopRepairCooperatively({ ...f.request, changes }, f.ports).promise,
		).rejects.toThrow(/mutable/);
		assertUnchanged(f.document, before);
	});

	it("rejects forged/cloned Apply objects and terminally consumes a wrong-document attempt", async () => {
		const f = fixture(),
			before = capture(f.document);
		const apply = await f.prepare().promise;
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(
				{ ...apply },
				f.document,
				async () => {},
			),
		).toBeNull();
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(
				apply,
				equippedDocument(),
				async () => {},
			),
		).toBeNull();
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(apply, f.document, async () => {}),
		).toBeNull();
		assertUnchanged(f.document, before);
	});

	it("permits one concurrent consumer without letting a duplicate cancel it", async () => {
		const f = fixture(),
			apply = await f.prepare().promise;
		let release!: () => void,
			calls = 0;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = consumeStaticFabProcessLoopRepairApplyCooperatively(
			apply,
			f.document,
			async () => {
				if (++calls === 1) await held;
			},
		);
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(apply, f.document, async () => {}),
		).toBeNull();
		release();
		expect(await first).not.toBeNull();
		revokeStaticFabProcessLoopRepairApply(apply);
	});

	it("cancels terminally at the first consumption checkpoint without source mutation", async () => {
		const f = fixture(),
			before = capture(f.document),
			apply = await f.prepare().promise;
		await expect(
			consumeStaticFabProcessLoopRepairApplyCooperatively(apply, f.document, async () => {
				throw new Error("consume cancel");
			}),
		).rejects.toThrow("consume cancel");
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(apply, f.document, async () => {}),
		).toBeNull();
		assertUnchanged(f.document, before);
	});

	it("revokes preparation and issued Apply when the exact intent session changes", async () => {
		const f = fixture(),
			before = capture(f.document);
		const preparation = f.prepare();
		preparation.cancel();
		await expect(preparation.promise).rejects.toThrow(/current/);
		const second = f.prepare(),
			apply = await second.promise;
		second.cancel();
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(apply, f.document, async () => {}),
		).toBeNull();
		assertUnchanged(f.document, before);
	});

	it("detects rollback ABA even when bytes and revision are restored", async () => {
		const f = fixture(),
			before = capture(f.document);
		let changed = false;
		await expect(
			f.prepare({
				checkpoint: async () => {
					if (changed) return;
					changed = true;
					const changes = [{ x: 18, y: 20, before: f.document.map.getEncoded(18, 20), after: 0 }];
					const checkpoint = f.document.map.createMutationCheckpoint();
					f.document.map.applyAtomicMutations(changes, []);
					f.document.map.rollbackAtomicMutations(changes, [], checkpoint);
				},
			}).promise,
		).rejects.toThrow(/current/);
		expect(f.document.map.getRevision()).toBe(before.revision);
		expect(f.document.map.getMutationGeneration()).toBeGreaterThan(before.generation);
		expect(digest(f.document)).toBe(before.checksum);
		expect(f.document.getPatchSequence()).toBe(before.sequence);
	});

	it("never issues an Apply when the prepared candidate exceeds source capacity", async () => {
		const f = fixture(),
			before = capture(f.document);
		const original = TileMap.prototype.getEncodedCellCount;
		const counts = vi.spyOn(TileMap.prototype, "getEncodedCellCount").mockImplementation(function (
			this: TileMap,
			encoded: number,
		) {
			return this !== f.document.map && encoded === 0x28
				? 1_000_000_000
				: original.call(this, encoded);
		});
		try {
			await expect(f.prepare().promise).rejects.toThrow(/규모|budget|한도|최대/i);
		} finally {
			counts.mockRestore();
		}
		assertUnchanged(f.document, before);
	});

	it("primes a cold 100k canonical before fingerprint during bounded preparation before foreign checksum code", async () => {
		const base = registeredDocument(rectangleMap(49_980, 20));
		const organizations = copyStaticFabOrganizationState(base.organizations);
		const source: StaticFabProcessLoopRegistrationDocument = {
			map: base.map,
			portEquipment: base.portEquipment,
			organizations,
			relationships: emptyStaticFabAssemblyRelationshipState(),
			operationalConfiguration: emptyOperationalConfigurationState(),
			getPatchSequence: () => 0,
		};
		const record = organizations.records[0];
		if (!record) throw new Error("expected large owner");
		expect(record.membership.railEdges).toHaveLength(100_000);
		expect(cachedStaticFabOrganizationMembershipFingerprint(record.membership)).toBeUndefined();
		const sourceChecksum = checksumRailMap(
			source.map,
			source.portEquipment,
			copyStaticFabOrganizationState(organizations),
			source.relationships,
		);
		expect(cachedStaticFabOrganizationMembershipFingerprint(record.membership)).toBeUndefined();
		const erase = planRailErase(source.map, [{ x: 30, y: 20 }]);
		let checkpoints = 0;
		const preparation = prepareStaticFabProcessLoopRepairCooperatively(
			{
				document: source,
				ownership: buildRailModuleOwnershipIndex(source.map),
				organizationId: 1,
				changes: freezeChanges(erase.mutations),
				sourceChecksum,
				mirrorEpoch: 1,
			},
			{
				checkpoint: async () => {
					checkpoints++;
				},
				isCurrent: () => true,
				checksumTransition: async (...args) => {
					expect(cachedStaticFabOrganizationMembershipFingerprint(record.membership)).toBeDefined();
					return checksumRailPatchResultCooperatively(...args);
				},
			},
		);
		const apply = await preparation.promise;
		expect(checkpoints).toBeGreaterThan(1_000);
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(apply, source, async () => {}),
		).not.toBeNull();
		expect(source.map.getEncoded(30, 20)).not.toBe(0);
		revokeStaticFabProcessLoopRepairApply(apply);
	}, 30_000);
});

describe("atomic registered Loop rail repair and exact private replay", () => {
	it("adopts one candidate, transfers the exact event, and replays without changing Port/rels/ops", async () => {
		const f = fixture(),
			before = capture(f.document),
			mirror = mirrorFor(f.document);
		const prepared: RailPatchEvent[] = [],
			published: RailPatchEvent[] = [];
		f.document.subscribe((event) => {
			published.push(event);
			mirror.applyPatch(transferred(event, mirror.organizationState));
		});
		const clone = vi.spyOn(f.document.map, "createMutationCandidateSteps");
		const apply = await f.prepare().promise;
		expect(
			(
				await f.document.commitStaticFabProcessLoopRepairCooperatively(
					apply,
					commitOptions(f.document, prepared),
				)
			).committed,
		).toBe(true);
		expect(clone).toHaveBeenCalledTimes(1);
		expect(prepared[0]).toBe(published[0]);
		expect(published[0]?.kind).toBe("repair-static-fab-process-loop");
		expect(digest(f.document)).toBe(mirror.state.checksum);
		expect(f.document.map).not.toBe(before.map);
		expect(before.map.getEncoded(18, 20)).not.toBe(0);
		expect(f.document.map.getEncoded(18, 20)).toBe(0);
		const repaired = digest(f.document);
		expect(f.document.undo()).toBe(false);
		for (const direction of ["undo", "redo"] as const) {
			expect(f.document.canReplayStaticFabProcessLoopRepair(direction)).toBe(true);
			expect(
				(
					await f.document.replayStaticFabProcessLoopRepairCooperatively(
						direction,
						buildRailModuleOwnershipIndex(f.document.map),
						commitOptions(f.document, prepared),
					)
				).committed,
			).toBe(true);
			expect(prepared.at(-1)).toBe(published.at(-1));
			expect(digest(f.document)).toBe(direction === "undo" ? before.checksum : repaired);
			expect(mirror.state.checksum).toBe(digest(f.document));
			expect(f.document.portEquipment).toBe(before.equipment);
			expect(f.document.relationships).toBe(before.relationships);
			expect(f.document.operationalConfiguration).toBe(before.operations);
			expect(f.document.organizations.nextOrganizationId).toBe(2);
		}
		expect(f.document.getPatchSequence()).toBe(before.sequence + 3);
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(apply, f.document, async () => {}),
		).toBeNull();
		const history = (f.document as unknown as { undoStack: object[] }).undoStack[0];
		for (const key of [
			"nextMap",
			"nextImpactIndex",
			"ownership",
			"assertCurrent",
			"organizationActivation",
		])
			expect(Object.keys(history ?? {})).not.toContain(key);
	});

	it("restores a separated owned fragment only through exact top history, with a rejecting forged inverse", async () => {
		const map = new TileMap();
		for (const x of [0, 100]) {
			const line = planRailConstruction(map, { x, y: 0 }, { x: x + 10, y: 0 });
			map.applyAtomicMutations(line.mutations, []);
		}
		const document = registeredDocument(map),
			before = capture(document),
			mirror = mirrorFor(document);
		const erase = planRailErase(
			map,
			Array.from({ length: 11 }, (_, x) => ({ x, y: 0 })),
		);
		const f = fixture(document, erase.mutations),
			events: RailPatchEvent[] = [];
		document.subscribe((event) => {
			events.push(event);
			mirror.applyPatch(transferred(event, mirror.organizationState));
		});
		expect(
			(
				await document.commitStaticFabProcessLoopRepairCooperatively(
					await f.prepare().promise,
					commitOptions(document),
				)
			).committed,
		).toBe(true);
		const erased = digest(document),
			erasedMirror = mirror.state;
		const restoration = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 });
		await expect(fixture(document, restoration.mutations).prepare().promise).rejects.toThrow(
			/touch the existing Loop/,
		);
		const undoOriginal = (document as unknown as { undoStack: object[] }).undoStack.at(-1);
		(document as unknown as { undoStack: object[] }).undoStack = [{ ...undoOriginal }];
		expect(document.canReplayStaticFabProcessLoopRepair("undo")).toBe(false);
		(document as unknown as { undoStack: object[] }).undoStack = [undoOriginal as object];
		expect(
			(
				await document.replayStaticFabProcessLoopRepairCooperatively(
					"undo",
					buildRailModuleOwnershipIndex(document.map),
					commitOptions(document),
				)
			).committed,
		).toBe(true);
		expect(digest(document)).toBe(before.checksum);
		const inverse = events[1];
		if (!inverse) throw new Error("missing actual inverse");
		const forgedMirror = mirrorFor(
			RailDocument.fromLoadedMap(before.map, 0, before.equipment, before.organizations),
		);
		const first = events[0];
		if (!first) throw new Error("missing authored erase");
		const inverseOwner = inverse.organizationChanges[0];
		if (!inverseOwner?.after) throw new Error("missing inverse owner");
		const inverseAfter = inverseOwner.after;
		forgedMirror.applyPatch(transferred(first, forgedMirror.organizationState));
		const unchanged = forgedMirror.state;
		expect(() =>
			forgedMirror.applyPatch(
				transferred({
					...inverse,
					organizationChanges: [
						{
							...inverseOwner,
							after: { ...inverseAfter, name: "Forged inverse" },
						},
					],
				}),
			),
		).toThrow(/exactly match/);
		expect(forgedMirror.state).toEqual(unchanged);
		expect(unchanged).toEqual(erasedMirror);
		// Matching inverse bytes alone do not authorize an authored detached addition.
		expect(() =>
			forgedMirror.applyPatch(
				transferred({
					...inverse,
					kind: "repair-static-fab-process-loop",
					historyOriginKind: undefined,
				}),
			),
		).toThrow(/touch the existing Loop/);
		expect(forgedMirror.state).toEqual(unchanged);
		expect(
			(
				await document.replayStaticFabProcessLoopRepairCooperatively(
					"redo",
					buildRailModuleOwnershipIndex(document.map),
					commitOptions(document),
				)
			).committed,
		).toBe(true);
		expect(digest(document)).toBe(erased);
	});

	it("refuses erasing the final member without removing the owner's identity", async () => {
		const map = new TileMap(),
			line = planRailConstruction(map, { x: 0, y: 0 }, { x: 5, y: 0 });
		map.applyAtomicMutations(line.mutations, []);
		const document = registeredDocument(map),
			before = capture(document);
		const erase = planRailErase(
			map,
			Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
		);
		await expect(fixture(document, erase.mutations).prepare().promise).rejects.toThrow(
			/하나 이상의/,
		);
		assertUnchanged(document, before);
	});

	it("prepares a 100k-source near-total erase and restores it through cancellable private replay", async () => {
		const map = new TileMap();
		for (const [start, end] of [
			[
				{ x: -50_000, y: 0 },
				{ x: 49_995, y: 0 },
			],
			[
				{ x: 0, y: 100 },
				{ x: 5, y: 100 },
			],
		] as const) {
			const line = planRailConstruction(map, start, end);
			if (!line.valid) throw new Error(line.reason ?? "invalid 100k synthetic source");
			map.applyAtomicMutations(line.mutations, []);
		}
		const document = registeredDocument(map),
			before = capture(document);
		expect(document.organizations.records[0]?.membership.railEdges).toHaveLength(100_000);
		const erase = planRailErase(
			map,
			Array.from({ length: 99_996 }, (_, offset) => ({ x: offset - 50_000, y: 0 })),
		);
		if (!erase.valid) throw new Error(erase.reason ?? "invalid large erase");
		const f = fixture(document, erase.mutations);
		let preparationCheckpoints = 0;
		const apply = await f.prepare({
			checkpoint: async () => {
				preparationCheckpoints++;
			},
		}).promise;
		expect(preparationCheckpoints).toBeGreaterThan(1_000);
		assertUnchanged(document, before);
		expect(
			(await document.commitStaticFabProcessLoopRepairCooperatively(apply, commitOptions(document)))
				.committed,
		).toBe(true);
		expect(document.organizations.records[0]?.membership.railEdges).toHaveLength(5);
		const erased = capture(document);
		let cancelledCheckpoints = 0,
			clock = 0;
		await expect(
			document.replayStaticFabProcessLoopRepairCooperatively(
				"undo",
				buildRailModuleOwnershipIndex(document.map),
				{
					...commitOptions(document),
					now: () => (clock += 5),
					checkpoint: async () => {
						if (++cancelledCheckpoints === 100) throw new Error("large inverse cancelled");
					},
				},
			),
		).rejects.toThrow("large inverse cancelled");
		assertUnchanged(document, erased);
		expect(document.canReplayStaticFabProcessLoopRepair("undo")).toBe(true);
		let replayCheckpoints = 0;
		for (const direction of ["undo", "redo"] as const) {
			clock = 0;
			expect(
				(
					await document.replayStaticFabProcessLoopRepairCooperatively(
						direction,
						buildRailModuleOwnershipIndex(document.map),
						{
							...commitOptions(document),
							now: () => (clock += 5),
							checkpoint: async () => {
								replayCheckpoints++;
							},
						},
					)
				).committed,
			).toBe(true);
			expect(digest(document)).toBe(direction === "undo" ? before.checksum : erased.checksum);
		}
		expect(replayCheckpoints).toBeGreaterThan(1_000);
	}, 60_000);

	it.each([
		"lease-false",
		"lease-revoke",
		"source-guard-revoke",
		"checksum",
		"cancel-first",
		"cancel-checkpoint",
	] as const)("rejects %s terminally without partial truth/history and allows replacement", async (failure) => {
		const f = fixture(),
			before = capture(f.document),
			preparation = f.prepare();
		const apply = await preparation.promise,
			published = vi.fn();
		f.document.subscribe(published);
		let revokeInGuard = false,
			clock = 0;
		const options: RailDocumentProcessLoopRepairCommitOptions = {
			...commitOptions(f.document),
			now: () => (clock += 5),
			checkCancelled: () => {
				if (failure === "cancel-first") throw new Error("first cancellation");
			},
			checkpoint: async () => {
				if (failure === "cancel-checkpoint") throw new Error("checkpoint cancellation");
			},
			checksumTransition: async (source, event, check) => {
				const value = await checksumRailPatchResultCooperatively(source, event, check);
				return failure === "checksum"
					? value.replace(/.$/, value.endsWith("0") ? "1" : "0")
					: value;
			},
			preparePatch: async () => {
				if (failure === "source-guard-revoke") revokeInGuard = true;
				return {
					isCurrent: () => {
						if (failure === "lease-revoke") preparation.cancel();
						return failure !== "lease-false";
					},
				};
			},
		};
		// Use the genuine pending source guard for the final cancellation scenario.
		if (failure === "source-guard-revoke") {
			preparation.cancel();
			const replacement = f.prepare({
				isCurrent: () => {
					if (revokeInGuard) replacement.cancel();
					return true;
				},
			});
			await expect(
				f.document.commitStaticFabProcessLoopRepairCooperatively(
					await replacement.promise,
					options,
				),
			).rejects.toThrow(/current|revoked/);
		} else if (failure === "lease-false") {
			expect(
				(await f.document.commitStaticFabProcessLoopRepairCooperatively(apply, options)).committed,
			).toBe(false);
		} else
			await expect(
				f.document.commitStaticFabProcessLoopRepairCooperatively(apply, options),
			).rejects.toThrow();
		assertUnchanged(f.document, before);
		expect(published).not.toHaveBeenCalled();
		expect(
			await consumeStaticFabProcessLoopRepairApplyCooperatively(apply, f.document, async () => {}),
		).toBeNull();
		expect(
			(
				await f.document.commitStaticFabProcessLoopRepairCooperatively(
					await f.prepare().promise,
					commitOptions(f.document),
				)
			).committed,
		).toBe(true);
	});

	it("a duplicate Doc call does not revoke the first consumer held at a checkpoint", async () => {
		const f = fixture(),
			apply = await f.prepare().promise;
		let release!: () => void,
			entered!: () => void,
			once = true,
			clock = 0;
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const options = {
			...commitOptions(f.document),
			now: () => (clock += 5),
			checkpoint: async () => {
				if (once) {
					once = false;
					entered();
					await paused;
				}
			},
		};
		const first = f.document.commitStaticFabProcessLoopRepairCooperatively(apply, options);
		await started;
		expect(
			(
				await f.document.commitStaticFabProcessLoopRepairCooperatively(
					apply,
					commitOptions(f.document),
				)
			).committed,
		).toBe(false);
		release();
		expect((await first).committed).toBe(true);
		expect(f.document.getPatchSequence()).toBe(1);
	});

	it("retains committed truth, history and sequence when an observer throws", async () => {
		const f = fixture(),
			before = capture(f.document),
			observer = vi.fn();
		f.document.subscribe(() => {
			throw new Error("observer failure");
		});
		f.document.subscribe(observer);
		const result = await f.document.commitStaticFabProcessLoopRepairCooperatively(
			await f.prepare().promise,
			commitOptions(f.document),
		);
		expect(result).toMatchObject({ committed: true, publicationError: "observer failure" });
		expect(observer).toHaveBeenCalledTimes(1);
		expect(f.document.getPatchSequence()).toBe(before.sequence + 1);
		expect(f.document.map.getEncoded(18, 20)).toBe(0);
		expect(f.document.canReplayStaticFabProcessLoopRepair("undo")).toBe(true);
	});

	it.each([
		"rename",
		"remove",
	] as const)("mixes %s metadata history with repair while preserving original ID and direct equipment", async (kind) => {
		const f = fixture(),
			mirror = mirrorFor(f.document),
			before = capture(f.document);
		f.document.subscribe((event) =>
			mirror.applyPatch(transferred(event, mirror.organizationState)),
		);
		expect(
			(
				await f.document.commitStaticFabProcessLoopRepairCooperatively(
					await f.prepare().promise,
					commitOptions(f.document),
				)
			).committed,
		).toBe(true);
		const repaired = digest(f.document),
			record = f.document.organizations.records[0];
		const plan =
			kind === "rename"
				? planRenameStaticFabOrganization(
						f.document.map,
						f.document.portEquipment,
						f.document.getPatchSequence(),
						f.document.organizations,
						1,
						"Renamed Loop",
					)
				: planRemoveStaticFabOrganization(
						f.document.map,
						f.document.portEquipment,
						f.document.getPatchSequence(),
						f.document.organizations,
						1,
					);
		expect(f.document.commitOrganization(plan)).toBe(true);
		expect(f.document.canReplayStaticFabProcessLoopRepair("undo")).toBe(false);
		expect(f.document.undo()).toBe(true);
		expect(f.document.organizations.records[0]).toEqual(record);
		expect(
			(
				await f.document.replayStaticFabProcessLoopRepairCooperatively(
					"undo",
					buildRailModuleOwnershipIndex(f.document.map),
					commitOptions(f.document),
				)
			).committed,
		).toBe(true);
		expect(digest(f.document)).toBe(before.checksum);
		expect(f.document.redo()).toBe(false);
		expect(
			(
				await f.document.replayStaticFabProcessLoopRepairCooperatively(
					"redo",
					buildRailModuleOwnershipIndex(f.document.map),
					commitOptions(f.document),
				)
			).committed,
		).toBe(true);
		expect(digest(f.document)).toBe(repaired);
		expect(f.document.redo()).toBe(true);
		expect(mirror.state.checksum).toBe(digest(f.document));
		expect(f.document.portEquipment.equipmentGroups).toEqual(before.equipment.equipmentGroups);
		expect(f.document.organizations.nextOrganizationId).toBe(2);
	});
});

function commitOptions(
	document: RailDocument,
	prepared: RailPatchEvent[] = [],
): RailDocumentProcessLoopRepairCommitOptions {
	return {
		checkpoint: async () => {},
		now: () => 0,
		checkCancelled: () => {},
		mirrorEpoch: 1,
		sourceChecksum: digest(document),
		checksumTransition: checksumRailPatchResultCooperatively,
		preparePatch: async (event, checkpoint, expectedChecksum) => {
			expect(await checksumRailPatchResultCooperatively(digest(document), event, checkpoint)).toBe(
				expectedChecksum,
			);
			prepared.push(event);
			return { isCurrent: () => true };
		},
	};
}
function transferred(
	event: RailPatchEvent,
	currentOrganizations?: StaticFabOrganizationState,
): RailPatchEvent {
	const encoded = encodeRailPatchEvent(event, {
		compactOrganizations: currentOrganizations !== undefined,
	});
	return decodeRailPatchSoA(
		structuredClone(encoded.patch, { transfer: encoded.transfer }),
		currentOrganizations,
	);
}
function mirrorFor(document: RailDocument): RailPatchMirror {
	const mirror = new RailPatchMirror();
	const captured = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
	const snapshot = structuredClone(captured.snapshot, {
		transfer: railMirrorSnapshotTransfers(captured.snapshot),
	});
	mirror.sync(snapshot);
	return mirror;
}

function fixture(document = equippedDocument(), changes?: readonly RailMutation[]) {
	const erase = changes ?? planRailErase(document.map, [{ x: 18, y: 20 }]).mutations;
	const request: StaticFabProcessLoopRepairRequest = {
		document,
		ownership: buildRailModuleOwnershipIndex(document.map),
		organizationId: 1,
		changes: freezeChanges(erase),
		sourceChecksum: digest(document),
		mirrorEpoch: 1,
	};
	const transitions: RailPatchTransition[] = [];
	const ports: StaticFabProcessLoopRepairPorts = {
		checkpoint: async () => {},
		isCurrent: () => true,
		checksumTransition: async (checksum, transition, checkpoint) => {
			transitions.push(transition);
			return checksumRailPatchResultCooperatively(checksum, transition, checkpoint);
		},
	};
	return {
		document,
		request,
		ports,
		transitions,
		prepare: (overrides: Partial<StaticFabProcessLoopRepairPorts> = {}) =>
			prepareStaticFabProcessLoopRepairCooperatively(request, { ...ports, ...overrides }),
	};
}

function freezeChanges(changes: readonly RailMutation[]): readonly RailMutation[] {
	return Object.freeze(changes.map((value) => Object.freeze({ ...value })));
}

function equippedDocument(): RailDocument {
	const equipment = copyPortEquipmentState({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL", x: 10, z: 0, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "LEFT",
				lateralOffsetMillimeters: 700,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: null,
			},
		],
		equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
	});
	return registeredDocument(rectangleMap(30, 20), equipment);
}

function rectangleMap(width: number, height: number): TileMap {
	const map = new TileMap();
	const points = [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
		{ x: 0, y: 0 },
	];
	for (let index = 1; index < points.length; index++) {
		const plan = planRailConstruction(map, points[index - 1], points[index]);
		if (!plan.valid) throw new Error(plan.reason ?? "invalid synthetic rail fixture");
		map.applyAtomicMutations(plan.mutations, []);
	}
	return map;
}

function registeredDocument(map: TileMap, equipment = emptyPortEquipmentState()): RailDocument {
	const index = buildRailModuleOwnershipIndex(map);
	const edges = new Map<string, DirectedRailEdge>(),
		switches = new Set<number>();
	for (const module of index.modules) {
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switches.add(module.advancedSwitchId);
	}
	return RailDocument.fromLoadedMap(
		map,
		0,
		equipment,
		organizationState(
			[...edges.values()],
			[...switches],
			equipment.equipmentGroups.map((value) => value.id),
		),
	);
}

function organizationState(
	edges: readonly DirectedRailEdge[],
	switches: readonly number[] = [],
	groups: readonly number[] = [],
): StaticFabOrganizationState {
	const builder = createCanonicalStaticFabOrganizationStateBuilder(2);
	for (const edge of [...edges].sort(compareDirectedRailEdges)) builder.addRailEdge(edge);
	for (const id of [...switches].sort((a, b) => a - b)) builder.addAdvancedSwitchId(id);
	for (const id of [...groups].sort((a, b) => a - b)) builder.addEquipmentGroupId(id);
	builder.finishRecord({
		id: 1,
		kind: "AISLE",
		name: "Manual Loop",
		declaredSemanticRole: "PROCESS_LOOP",
		description: "Synthetic user Loop",
		color: "TEAL",
	});
	return builder.finish();
}

function digest(document: StaticFabProcessLoopRegistrationDocument): string {
	return checksumRailMap(
		document.map,
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
}

function capture(document: RailDocument) {
	return {
		map: document.map,
		equipment: document.portEquipment,
		organizations: document.organizations,
		relationships: document.relationships,
		operations: document.operationalConfiguration,
		revision: document.map.getRevision(),
		generation: document.map.getMutationGeneration(),
		sequence: document.getPatchSequence(),
		checksum: digest(document),
		history: document.captureRailMirrorHistoryLedger(),
	};
}
function assertUnchanged(document: RailDocument, before: ReturnType<typeof capture>): void {
	for (const [actual, expected] of [
		[document.map, before.map],
		[document.portEquipment, before.equipment],
		[document.organizations, before.organizations],
		[document.relationships, before.relationships],
		[document.operationalConfiguration, before.operations],
	])
		expect(actual).toBe(expected);
	expect(document.map.getRevision()).toBe(before.revision);
	expect(document.map.getMutationGeneration()).toBe(before.generation);
	expect(document.getPatchSequence()).toBe(before.sequence);
	expect(digest(document)).toBe(before.checksum);
	expect(document.captureRailMirrorHistoryLedger()).toEqual(before.history);
}
