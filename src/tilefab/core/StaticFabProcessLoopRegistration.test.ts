import { describe, expect, it, vi } from "vitest";
import { evaluateStaticFabProcessLoopTopology } from "../compile/StaticFabProcessLoopTopology";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	checksumRailPatchResultCooperatively,
} from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import { copyPortEquipmentState, emptyPortEquipmentState } from "./EquipmentGroup";
import { emptyOperationalConfigurationState } from "./OperationalConfiguration";
import { planRailConstruction } from "./paint";
import { createRailAreaSelectionFromOwnerships } from "./RailAreaSelection";
import {
	RailDocument,
	type RailDocumentProcessLoopRegistrationCommitOptions,
	type RailPatchEvent,
} from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { DIR_E, DIR_W } from "./railShape";
import { emptyStaticFabAssemblyRelationshipState } from "./StaticFabAssemblyRelationship";
import {
	copyStaticFabOrganizationState,
	emptyStaticFabOrganizationState,
	isCanonicalStaticFabOrganizationState,
} from "./StaticFabOrganization";
import {
	planAssignStaticFabOrganizationFromSelection,
	planRenameStaticFabOrganization,
} from "./StaticFabOrganizationPlan";
import { createStaticFabProcessLoopRailCandidatePreparation } from "./StaticFabProcessLoopRailCandidate";
import {
	consumeStaticFabProcessLoopRegistrationApplyCooperatively,
	prepareStaticFabProcessLoopRegistrationCooperatively,
	revokeStaticFabProcessLoopRegistrationApply,
	type StaticFabProcessLoopRegistrationPorts,
} from "./StaticFabProcessLoopRegistration";
import { createStaticFabSelection } from "./StaticFabSelection";
import { TileMap } from "./TileMap";

describe("standalone Process Loop registration authority and org-only publication", () => {
	it("registers, mirrors and replays one intent while retaining all other source objects and monotonic IDs", async () => {
		const f = fixture(equippedLoopDocument());
		const before = snapshot(f.document);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(
				f.document.map,
				0,
				f.document.portEquipment,
				f.document.organizations,
				f.document.relationships,
			).snapshot,
		);
		const published: RailPatchEvent[] = [],
			prepared: RailPatchEvent[] = [];
		f.document.subscribe((event) => published.push(event));
		const apply = await f.prepare().promise;
		expect(apply).toEqual({
			kind: "register-static-fab-process-loop",
			organizationId: 1,
			name: "Manual Loop",
		});
		expect(Object.keys(apply)).not.toContain("plan");
		const result = await f.document.commitStaticFabProcessLoopRegistrationCooperatively(
			apply,
			options(f.document, prepared),
		);
		expect(result.committed).toBe(true);
		const record = f.document.organizations.records[0];
		expect(record).toMatchObject({
			id: 1,
			kind: "AISLE",
			name: "Manual Loop",
			declaredSemanticRole: "PROCESS_LOOP",
			parentOrganizationIds: [],
		});
		expect(record?.membership).toEqual(f.candidate.membership);
		expect(record?.membership.equipmentGroupIds).toEqual([]);
		expect(f.document.portEquipment.ports).toHaveLength(1);
		expect(f.document.portEquipment.equipmentGroups).toHaveLength(1);
		expect(isCanonicalStaticFabOrganizationState(f.document.organizations)).toBe(true);
		expect(f.document.organizations.nextOrganizationId).toBe(2);
		assertNonOrganizationIdentity(f.document, before);
		expect(f.document.getPatchSequence()).toBe(1);
		expect(f.document.captureRailMirrorHistoryLedger().undo).toHaveLength(1);
		expect(published).toHaveLength(1);
		expect(published[0]).toBe(prepared[0]);
		expect(published[0]).toMatchObject({
			changes: [],
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
			relationshipChanges: [],
			organizationNextIdBefore: 1,
			organizationNextIdAfter: 2,
			baseRevision: before.revision,
			revision: before.revision,
		});
		assertMirror(mirror, published[0], f.document);
		const registeredChecksum = digest(f.document);
		expect(f.document.canReplayStaticFabProcessLoopRegistration("undo")).toBe(true);
		const beforeDirectUndo = snapshot(f.document);
		expect(f.document.undo()).toBe(false);
		assertUnchanged(f.document, beforeDirectUndo);
		expect(
			(
				await f.document.replayStaticFabProcessLoopRegistrationCooperatively(
					"undo",
					f.source.ownership,
					options(f.document, prepared),
				)
			).committed,
		).toBe(true);
		expect(f.document.organizations).toMatchObject({ records: [], nextOrganizationId: 2 });
		assertNonOrganizationIdentity(f.document, before);
		assertMirror(mirror, published[1], f.document);
		expect(f.document.canReplayStaticFabProcessLoopRegistration("redo")).toBe(true);
		const beforeDirectRedo = snapshot(f.document);
		expect(f.document.redo()).toBe(false);
		assertUnchanged(f.document, beforeDirectRedo);
		expect(
			(
				await f.document.replayStaticFabProcessLoopRegistrationCooperatively(
					"redo",
					f.source.ownership,
					options(f.document, prepared),
				)
			).committed,
		).toBe(true);
		expect(f.document.organizations.records[0]).toBe(record);
		expect(digest(f.document)).toBe(registeredChecksum);
		expect(f.document.getPatchSequence()).toBe(3);
		expect(f.document.captureRailMirrorHistoryLedger()).toMatchObject({
			undo: [{ originKind: "create-static-fab-organization" }],
			redo: [],
		});
		expect(published.every((event, i) => event === prepared[i])).toBe(true);
		assertNonOrganizationIdentity(f.document, before);
		assertMirror(mirror, published[2], f.document);
	});

	it.each([
		"rename",
		"equipment-assignment",
	] as const)("replays registration after ordinary %s Undo retains canonical Loop identity", async (kind) => {
		const f = fixture(equippedLoopDocument());
		expect(
			(
				await f.document.commitStaticFabProcessLoopRegistrationCooperatively(
					await f.prepare().promise,
					options(f.document, []),
				)
			).committed,
		).toBe(true);
		const registered = f.document.organizations.records[0];
		if (!registered) throw new Error("missing registered Loop");
		const plan =
			kind === "rename"
				? planRenameStaticFabOrganization(
						f.document.map,
						f.document.portEquipment,
						f.document.getPatchSequence(),
						f.document.organizations,
						registered.id,
						"Renamed Loop",
					)
				: planAssignStaticFabOrganizationFromSelection(
						f.document.map,
						f.source.ownership,
						f.document.portEquipment,
						f.document.getPatchSequence(),
						f.document.organizations,
						createStaticFabSelection(
							f.source.selection.rail,
							f.document.portEquipment,
							f.document.getPatchSequence(),
							[1],
						),
						{
							kind: "AISLE",
							organizationId: registered.id,
							name: registered.name,
							sourceOwners: [],
						},
					);
		expect(f.document.commitOrganization(plan)).toBe(true);
		expect(f.document.organizations.records[0]?.membership.equipmentGroupIds).toEqual(
			kind === "equipment-assignment" ? [1] : [],
		);
		expect(f.document.undo()).toBe(true);
		expect(f.document.organizations.records[0]).toEqual(registered);
		expect(f.document.organizations.records[0]).toBe(registered);
		expect(
			(
				await f.document.replayStaticFabProcessLoopRegistrationCooperatively(
					"undo",
					f.source.ownership,
					options(f.document, []),
				)
			).committed,
		).toBe(true);
		expect(
			(
				await f.document.replayStaticFabProcessLoopRegistrationCooperatively(
					"redo",
					f.source.ownership,
					options(f.document, []),
				)
			).committed,
		).toBe(true);
		expect(f.document.organizations.records[0]).toBe(registered);
		expect(f.document.organizations.nextOrganizationId).toBe(2);
		expect(f.document.redo()).toBe(true);
		expect(f.document.organizations.records[0]).toMatchObject({
			id: registered.id,
			declaredSemanticRole: "PROCESS_LOOP",
			name: kind === "rename" ? "Renamed Loop" : registered.name,
			membership: { equipmentGroupIds: kind === "equipment-assignment" ? [1] : [] },
		});
		expect(f.document.portEquipment).toHaveProperty("nextEquipmentGroupId", 2);
	});

	it("rejects a forged or cloned Apply and terminally consumes a handle offered to another document", async () => {
		const f = fixture();
		const apply = await f.prepare().promise;
		for (const forged of [Object.freeze({ ...apply }), structuredClone(apply)])
			expect(
				await consumeStaticFabProcessLoopRegistrationApplyCooperatively(
					forged,
					f.document,
					async () => {},
				),
			).toBeNull();
		const other = Object.assign(
			Object.create(Object.getPrototypeOf(f.document)),
			f.document,
		) as RailDocument;
		expect(other.map).toBe(f.document.map);
		expect(
			await consumeStaticFabProcessLoopRegistrationApplyCooperatively(apply, other, async () => {}),
		).toBeNull();
		expect(
			await consumeStaticFabProcessLoopRegistrationApplyCooperatively(
				apply,
				f.document,
				async () => {},
			),
		).toBeNull();
		expect(f.document.organizations.records).toHaveLength(0);
	});

	it.each([
		"clone-request",
		"fingerprint",
		"facts",
		"authority",
		"open",
	] as const)("refuses %s at the trusted validation completion boundary", async (kind) => {
		const f = fixture(kind === "open" ? lineDocument() : undefined);
		const before = snapshot(f.document);
		const preparation = f.prepare({
			validateTopology: async (request) => {
				const result = evaluateStaticFabProcessLoopTopology(
					request.source.map,
					request.candidate.topologyMembership,
				);
				return {
					request: kind === "clone-request" ? { ...request } : request,
					candidateFingerprint: kind === "fingerprint" ? "wrong" : "12345678:abcdef01",
					result:
						kind === "authority"
							? { ...result, authoringAuthority: "COMMIT" }
							: kind === "facts"
								? { ...result, evidence: { ...result.evidence, physicalOpenPaths: 1 } }
								: result,
				};
			},
		});
		await expect(preparation.promise).rejects.toThrow();
		assertUnchanged(f.document, before);
	});

	it.each([
		"selection",
		"name",
		"epoch",
		"checksum",
		"document",
		"rollback",
		"ports",
		"organizations",
		"relationships",
		"operations",
	] as const)("rejects stale %s after validation without issuing or publishing", async (kind) => {
		const f = fixture();
		const before = snapshot(f.document);
		const preparation = f.prepare({
			validateTopology: async (request) => {
				if (kind === "rollback") {
					const checkpoint = f.document.map.createMutationCheckpoint(),
						mutation = { x: 200, y: 200, before: 0, after: 0x11 };
					f.document.map.applyAtomicMutations([mutation], []);
					f.document.map.rollbackAtomicMutations([mutation], [], checkpoint);
				} else if (kind === "ports")
					replacePrivate(f.document, "currentPortEquipment", emptyPortEquipmentState());
				else if (kind === "organizations")
					replacePrivate(f.document, "currentOrganizations", emptyStaticFabOrganizationState());
				else if (kind === "relationships")
					replacePrivate(
						f.document,
						"currentRelationships",
						emptyStaticFabAssemblyRelationshipState(),
					);
				else if (kind === "operations")
					replacePrivate(
						f.document,
						"currentOperationalConfiguration",
						emptyOperationalConfigurationState(),
					);
				else if (kind === "selection") f.live.selection = Object.freeze({ ...f.source.selection });
				else if (kind === "name") f.live.name = "Changed Loop";
				else if (kind === "epoch") f.live.epoch++;
				else if (kind === "checksum")
					f.live.checksum = f.live.checksum.replace(
						/.$/,
						f.live.checksum.endsWith("0") ? "1" : "0",
					);
				else if (kind === "document")
					f.live.document = Object.assign(
						Object.create(Object.getPrototypeOf(f.document)),
						f.document,
					);
				return {
					request,
					candidateFingerprint: "12345678:abcdef01",
					result: evaluateStaticFabProcessLoopTopology(
						request.source.map,
						request.candidate.topologyMembership,
					),
				};
			},
		});
		await expect(preparation.promise).rejects.toThrow("current");
		expect(f.document.getPatchSequence()).toBe(0);
		expect(f.document.captureRailMirrorHistoryLedger().undo).toHaveLength(0);
		expect(f.document.map.getRevision()).toBe(before.revision);
		expect(f.document.organizations.records).toHaveLength(0);
		if (kind === "rollback")
			expect(f.document.map.getMutationGeneration()).toBeGreaterThan(before.generation);
	});

	it.each([
		"",
		" Loop",
		"Loop ",
		"Bad\nName",
		"x".repeat(121),
	])("rejects invalid name before validation: %j", (name) => {
		const f = fixture();
		expect(() =>
			prepareStaticFabProcessLoopRegistrationCooperatively({ ...f.request, name }, f.ports),
		).toThrow("이름");
	});

	it("refuses a normalized duplicate name and exhausted cursor without invoking the topology adapter", async () => {
		const f = fixture();
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 2,
			records: [{ id: 1, kind: "AISLE", name: "Ｍanual Loop", membership: f.candidate.membership }],
		});
		// The narrow constructor validates metadata independently; initial all-kind overlap remains the candidate's job.
		const { applyStaticFabProcessLoopRegistrationMutationSteps, copyStaticFabOrganizationRecord } =
			await import("./StaticFabOrganization");
		const record = copyStaticFabOrganizationRecord({
			id: 2,
			kind: "AISLE",
			name: "Manual Loop",
			declaredSemanticRole: "PROCESS_LOOP",
			membership: f.candidate.membership,
		});
		const steps = applyStaticFabProcessLoopRegistrationMutationSteps(
			organizations,
			Object.freeze({ id: 2, before: null, after: record }),
			3,
			"register",
		);
		expect(() => {
			while (!steps.next().done) {
				// Exhaust the synchronous oracle until the duplicate-name guard rejects.
			}
		}).toThrow("중복");
		const exhaustedDocument = RailDocument.fromLoadedMap(f.document.map, 0, undefined, {
			nextOrganizationId: 0x7fffffff,
			records: [],
		});
		const exhausted = fixture(exhaustedDocument),
			validation = vi.fn(exhausted.ports.validateTopology);
		await expect(exhausted.prepare({ validateTopology: validation }).promise).rejects.toThrow(
			"exhausted",
		);
		expect(validation).not.toHaveBeenCalled();
	});

	it("cancels preparation and an issued Apply terminally, including revocation during consumption", async () => {
		const f = fixture();
		const before = snapshot(f.document),
			cancel = vi.fn();
		const early = f.prepare({ cancelTopology: cancel });
		early.cancel();
		await expect(early.promise).rejects.toThrow("current");
		expect(cancel).toHaveBeenCalled();
		const prepared = f.prepare(),
			apply = await prepared.promise;
		prepared.cancel();
		expect(
			await consumeStaticFabProcessLoopRegistrationApplyCooperatively(
				apply,
				f.document,
				async () => {},
			),
		).toBeNull();
		const apply2 = await f.prepare().promise;
		await expect(
			consumeStaticFabProcessLoopRegistrationApplyCooperatively(apply2, f.document, async () => {
				revokeStaticFabProcessLoopRegistrationApply(apply2);
			}),
		).rejects.toThrow("revoked");
		expect(
			await consumeStaticFabProcessLoopRegistrationApplyCooperatively(
				apply2,
				f.document,
				async () => {},
			),
		).toBeNull();
		assertUnchanged(f.document, before);
	});

	it("rejects checksum changes, stale lease and revocation immediately before publication without retry authority", async () => {
		for (const kind of ["checksum", "lease", "revoke"] as const) {
			const f = fixture(),
				before = snapshot(f.document),
				apply = await f.prepare().promise;
			const o = options(f.document, []);
			const altered = {
				...o,
				preparePatch: async (
					event: RailPatchEvent,
					checkpoint: () => Promise<void>,
					expected: string,
				) => {
					if (kind === "revoke") revokeStaticFabProcessLoopRegistrationApply(apply);
					await o.preparePatch(event, checkpoint, expected);
					return { isCurrent: () => kind !== "lease" };
				},
				...(kind === "checksum"
					? {
							sourceChecksum: o.sourceChecksum.replace(
								/.$/,
								o.sourceChecksum.endsWith("0") ? "1" : "0",
							),
						}
					: {}),
			};
			if (kind === "lease")
				expect(
					(await f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, altered))
						.committed,
				).toBe(false);
			else
				await expect(
					f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, altered),
				).rejects.toThrow();
			assertUnchanged(f.document, before);
			expect(
				(await f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, o)).committed,
			).toBe(false);
		}
	});

	it("checks prospective digest twice and accepts no inconsistent checksum-port result", async () => {
		const f = fixture(),
			before = snapshot(f.document);
		await expect(
			f.prepare({ checksumTransition: async (source) => source }).promise,
		).rejects.toThrow("count and cursor");
		let calls = 0;
		const prepared = f.prepare({
			checksumTransition: async (source, transition, checkpoint) => {
				const checksum = await checksumRailPatchResultCooperatively(source, transition, checkpoint);
				return ++calls === 1
					? checksum
					: checksum.replace(/.$/, checksum.endsWith("0") ? "1" : "0");
			},
		});
		await expect(
			f.document.commitStaticFabProcessLoopRegistrationCooperatively(
				await prepared.promise,
				options(f.document, []),
			),
		).rejects.toThrow("prospective checksum changed");
		assertUnchanged(f.document, before);
	});

	it("terminally revokes an Apply when the very first commit cancellation check fails", async () => {
		const f = fixture(),
			before = snapshot(f.document),
			apply = await f.prepare().promise;
		await expect(
			f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, {
				...options(f.document, []),
				checkCancelled: () => {
					throw new Error("early cancel");
				},
			}),
		).rejects.toThrow("early cancel");
		expect(
			(
				await f.document.commitStaticFabProcessLoopRegistrationCooperatively(
					apply,
					options(f.document, []),
				)
			).committed,
		).toBe(false);
		assertUnchanged(f.document, before);
	});

	it.each([
		"revoke",
		"edit",
	] as const)("rechecks authority and source after a reentrant lease %s callback", async (kind) => {
		const f = fixture(),
			apply = await f.prepare().promise,
			before = snapshot(f.document);
		const o = {
			...options(f.document, []),
			preparePatch: async () => ({
				isCurrent: () => {
					if (kind === "revoke") revokeStaticFabProcessLoopRegistrationApply(apply);
					else
						expect(
							f.document.commit(
								planRailConstruction(f.document.map, { x: 200, y: 200 }, { x: 205, y: 200 }),
							),
						).toBe(true);
					return true;
				},
			}),
		};
		if (kind === "revoke") {
			await expect(
				f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, o),
			).rejects.toThrow("current");
			assertUnchanged(f.document, before);
		} else {
			expect(
				(await f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, o)).committed,
			).toBe(false);
			expect(f.document.organizations.records).toHaveLength(0);
			expect(f.document.getPatchSequence()).toBe(1);
			expect(f.document.map.getEncoded(200, 200)).not.toBe(0);
			expect(f.document.captureRailMirrorHistoryLedger().undo).toMatchObject([
				{ originKind: "build" },
			]);
		}
		expect(
			(
				await f.document.commitStaticFabProcessLoopRegistrationCooperatively(
					apply,
					options(f.document, []),
				)
			).committed,
		).toBe(false);
	});

	it("rejects revocation inside the last external source guard after packet preparation", async () => {
		const f = fixture(),
			before = snapshot(f.document);
		let armed = false;
		const prepared = f.prepare({
			isCurrent: () => {
				if (armed) revokeStaticFabProcessLoopRegistrationApply(apply);
				return f.ports.isCurrent();
			},
		});
		const apply = await prepared.promise;
		await expect(
			f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, {
				...options(f.document, []),
				preparePatch: async () => {
					armed = true;
					return { isCurrent: () => true };
				},
			}),
		).rejects.toThrow("current");
		assertUnchanged(f.document, before);
		expect(
			(
				await f.document.commitStaticFabProcessLoopRegistrationCooperatively(
					apply,
					options(f.document, []),
				)
			).committed,
		).toBe(false);
	});

	it.each([
		"source",
		"cancellation",
	] as const)("refuses a lease invalidated inside the final %s callback", async (kind) => {
		const f = fixture(),
			before = snapshot(f.document);
		let armed = false,
			leaseCurrent = true;
		const apply = await f.prepare({
			isCurrent: () => {
				if (armed && kind === "source") leaseCurrent = false;
				return f.ports.isCurrent();
			},
		}).promise;
		const result = await f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, {
			...options(f.document, []),
			checkCancelled: () => {
				if (armed && kind === "cancellation") leaseCurrent = false;
			},
			preparePatch: async () => {
				armed = true;
				return { isCurrent: () => leaseCurrent };
			},
		});
		expect(result.committed).toBe(false);
		assertUnchanged(f.document, before);
		expect(
			(
				await f.document.commitStaticFabProcessLoopRegistrationCooperatively(
					apply,
					options(f.document, []),
				)
			).committed,
		).toBe(false);
	});

	it("allows only one concurrent commit and records listener failure as committed without rollback", async () => {
		const f = fixture(),
			apply = await f.prepare().promise,
			events = vi.fn();
		f.document.subscribe(events);
		f.document.subscribe(() => {
			throw new Error("listener failed");
		});
		const results = await Promise.all([
			f.document.commitStaticFabProcessLoopRegistrationCooperatively(
				apply,
				options(f.document, []),
			),
			f.document.commitStaticFabProcessLoopRegistrationCooperatively(
				apply,
				options(f.document, []),
			),
		]);
		expect(results.filter((result) => result.committed)).toHaveLength(1);
		expect(results.find((result) => result.committed)?.publicationError).toBe("listener failed");
		expect(events).toHaveBeenCalledTimes(1);
		expect(f.document.organizations.records).toHaveLength(1);
		expect(f.document.getPatchSequence()).toBe(1);
		expect(f.document.captureRailMirrorHistoryLedger().undo).toHaveLength(1);
	});

	it("cancels genuine 100k-edge preparation and commit mid-work without partial state or reusable Apply", async () => {
		const f = fixture(loopDocument(49_980, 20)),
			before = snapshot(f.document);
		let preparationChecks = 0;
		const validateTopology = vi.fn(f.ports.validateTopology);
		await expect(
			f.prepare({
				validateTopology,
				checkpoint: async () => {
					if (++preparationChecks === 16) throw new Error("large preparation cancel");
				},
			}).promise,
		).rejects.toThrow("large preparation cancel");
		expect(preparationChecks).toBe(16);
		expect(validateTopology).not.toHaveBeenCalled();
		assertUnchanged(f.document, before);
		const apply = await f.prepare().promise;
		let commitChecks = 0,
			clock = 0;
		await expect(
			f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, {
				...options(f.document, []),
				checkpoint: async () => {
					if (++commitChecks === 16) throw new Error("large commit cancel");
				},
				now: () => (clock += 4),
			}),
		).rejects.toThrow("large commit cancel");
		expect(commitChecks).toBe(16);
		assertUnchanged(f.document, before);
		expect(
			(
				await f.document.commitStaticFabProcessLoopRegistrationCooperatively(
					apply,
					options(f.document, []),
				)
			).committed,
		).toBe(false);
	}, 30_000);

	it("prepares and replays a genuine 100k-edge Loop cooperatively without cloning its map", async () => {
		const f = fixture(loopDocument(49_980, 20)),
			before = snapshot(f.document);
		let checkpoints = 0;
		const checkpoint = async () => {
			checkpoints++;
		};
		const apply = await f.prepare({ checkpoint }).promise;
		expect(checkpoints).toBeGreaterThan(1_000);
		expect(f.candidate.membership.railEdges).toHaveLength(100_000);
		const o = { ...options(f.document, []), checkpoint, now: () => checkpoints++ * 4 };
		expect(
			(await f.document.commitStaticFabProcessLoopRegistrationCooperatively(apply, o)).committed,
		).toBe(true);
		assertNonOrganizationIdentity(f.document, before);
		expect(f.document.organizations.records[0]?.membership.railEdges).toHaveLength(100_000);
		expect(
			(
				await f.document.replayStaticFabProcessLoopRegistrationCooperatively(
					"undo",
					f.source.ownership,
					{ ...o, sourceChecksum: digest(f.document) },
				)
			).committed,
		).toBe(true);
		expect(
			(
				await f.document.replayStaticFabProcessLoopRegistrationCooperatively(
					"redo",
					f.source.ownership,
					{ ...o, sourceChecksum: digest(f.document) },
				)
			).committed,
		).toBe(true);
		assertNonOrganizationIdentity(f.document, before);
		expect(f.document.organizations.nextOrganizationId).toBe(2);
	}, 30_000);
});

function fixture(document = loopDocument()) {
	const ownership = buildRailModuleOwnershipIndex(document.map);
	const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
	const source = Object.freeze({
		map: document.map,
		ownership,
		organizations: document.organizations,
		patchSequence: document.getPatchSequence(),
		selection: Object.freeze({
			baseRevision: document.map.getRevision(),
			basePatchSequence: document.getPatchSequence(),
			rail,
			equipmentGroups: Object.freeze([]),
		}),
	});
	const task = createStaticFabProcessLoopRailCandidatePreparation(source, () => true);
	while (!task.done) task.step(128);
	const result = task.finish();
	if (!result.valid) throw new Error(result.error.code);
	const request = {
		document,
		source,
		candidate: result.candidate,
		name: "Manual Loop",
		sourceChecksum: digest(document),
		mirrorEpoch: 1,
	};
	const live = {
		document,
		selection: source.selection,
		name: request.name,
		epoch: request.mirrorEpoch,
		checksum: request.sourceChecksum,
	};
	const ports: StaticFabProcessLoopRegistrationPorts = {
		checkpoint: async () => {},
		isCurrent: () =>
			live.document === document &&
			live.selection === source.selection &&
			live.name === request.name &&
			live.epoch === request.mirrorEpoch &&
			live.checksum === request.sourceChecksum,
		cancelTopology: () => {},
		checksumTransition: checksumRailPatchResultCooperatively,
		validateTopology: async (pending) => ({
			request: pending,
			candidateFingerprint: "12345678:abcdef01",
			result: evaluateStaticFabProcessLoopTopology(
				pending.source.map,
				pending.candidate.topologyMembership,
			),
		}),
	};
	return {
		document,
		source,
		candidate: result.candidate,
		request,
		ports,
		live,
		prepare: (overrides: Partial<StaticFabProcessLoopRegistrationPorts> = {}) =>
			prepareStaticFabProcessLoopRegistrationCooperatively(request, { ...ports, ...overrides }),
	};
}

function equippedLoopDocument(): RailDocument {
	const base = loopDocument();
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
	return RailDocument.fromLoadedMap(base.map, 0, equipment);
}

function loopDocument(width = 30, height = 20): RailDocument {
	const map = new TileMap(),
		points = [
			{ x: 0, y: 0 },
			{ x: width, y: 0 },
			{ x: width, y: height },
			{ x: 0, y: height },
			{ x: 0, y: 0 },
		];
	for (let i = 1; i < points.length; i++) {
		const plan = planRailConstruction(map, points[i - 1], points[i]);
		if (!plan.valid) throw new Error("invalid synthetic loop");
		map.applyAtomicMutations(plan.mutations, []);
	}
	return RailDocument.fromLoadedMap(map, 0);
}
function lineDocument(): RailDocument {
	const map = new TileMap(),
		plan = planRailConstruction(map, { x: 0, y: 0 }, { x: 10, y: 0 });
	map.applyAtomicMutations(plan.mutations, []);
	return RailDocument.fromLoadedMap(map, 0);
}
function digest(document: RailDocument): string {
	return checksumRailMap(
		document.map,
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
}
function options(
	document: RailDocument,
	prepared: RailPatchEvent[],
): RailDocumentProcessLoopRegistrationCommitOptions {
	return {
		checkpoint: async () => {},
		now: () => 0,
		checkCancelled: () => {},
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
function snapshot(document: RailDocument) {
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
		ledger: document.captureRailMirrorHistoryLedger(),
	};
}
function assertNonOrganizationIdentity(
	document: RailDocument,
	before: ReturnType<typeof snapshot>,
) {
	expect(document.map).toBe(before.map);
	expect(document.portEquipment).toBe(before.equipment);
	expect(document.relationships).toBe(before.relationships);
	expect(document.operationalConfiguration).toBe(before.operations);
	expect(document.map.getRevision()).toBe(before.revision);
	expect(document.map.getMutationGeneration()).toBe(before.generation);
}
function assertUnchanged(document: RailDocument, before: ReturnType<typeof snapshot>) {
	assertNonOrganizationIdentity(document, before);
	expect(document.organizations).toBe(before.organizations);
	expect(document.getPatchSequence()).toBe(before.sequence);
	expect(digest(document)).toBe(before.checksum);
	expect(document.captureRailMirrorHistoryLedger()).toEqual(before.ledger);
}
function assertMirror(mirror: RailPatchMirror, event: RailPatchEvent, document: RailDocument) {
	const decoded = decodeRailPatchSoA(encodeRailPatchEvent(event).patch);
	expect(mirror.applyPatch(decoded).checksum).toBe(digest(document));
}
function replacePrivate(document: RailDocument, key: string, value: unknown): void {
	(document as unknown as Record<string, unknown>)[key] = value;
}
