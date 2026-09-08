import { describe, expect, it } from "vitest";
import { readAdvancedSwitchRecord } from "../worker/AdvancedSwitchSoA";
import { hydratePortEquipmentSnapshot } from "../worker/PortEquipmentSoA";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { hydrateStaticFabAssemblyRelationshipSnapshot } from "../worker/StaticFabAssemblyRelationshipSoA";
import { createStaticFabOrganizationBundlePlacementCapture } from "../worker/StaticFabOrganizationBundlePlacementCapture";
import { STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION } from "../worker/StaticFabOrganizationBundlePlacementProtocol";
import { staticFabOrganizationBundlePlacementPreparedShapeError } from "../worker/StaticFabOrganizationBundlePlacementResponseValidator";
import { prepareStaticFabOrganizationBundlePlacement } from "../worker/StaticFabOrganizationBundlePlacementRuntime";
import {
	decodeStaticFabOrganizationBundlePlacementTransport,
	encodeStaticFabOrganizationBundlePlacementTransport,
} from "../worker/StaticFabOrganizationBundlePlacementTransport";
import { hydrateStaticFabOrganizationSnapshot } from "../worker/StaticFabOrganizationSoA";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import {
	applyPortEquipmentMutations,
	type EquipmentGroupRecord,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { portEquipmentLayoutError } from "./PortEquipmentLayoutValidator";
import type { CardinalPortRoute, PortRecord } from "./PortRecord";
import { planRailPath } from "./paint";
import { RailDocument } from "./RailDocument";
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
import { DIR_E, DIR_N, DIR_W, type Direction, oppositeDirection } from "./railShape";
import {
	checksumStaticFabAssemblyRelationshipRecord,
	copyStaticFabAssemblyRelationshipRecord,
	STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD,
	type StaticFabAssemblyRelationshipRecordV1,
} from "./StaticFabAssemblyRelationship";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	materializeStaticFabOrganizationBundle,
	prepareStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "./StaticFabOrganizationBundle";
import {
	adoptStaticFabOrganizationBundlePlacementWorkerPlanCooperatively,
	consumeCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor,
	fingerprintFrozenStaticFabOrganizationBundleCooperatively,
	isCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor,
	isIssuedStaticFabOrganizationBundlePlacementPlan,
	isStaticFabOrganizationBundlePlacementPlanIssuedFor,
	issueStaticFabOrganizationBundlePlacementPermit,
	planStaticFabOrganizationBundlePlacement,
	planStaticFabOrganizationBundlePlacementWithProspectiveState,
	revokeStaticFabOrganizationBundlePlacementPermit,
	type StaticFabOrganizationBundlePlacementPlan,
	staticFabOrganizationBundleFingerprint,
	staticFabOrganizationBundlePlacementFingerprint,
	staticFabOrganizationBundlePlacementFingerprintSteps,
} from "./StaticFabOrganizationBundlePlacement";
import type { Cell } from "./TileMap";

describe("StaticFabOrganizationBundlePlacement", () => {
	it("keeps cooperative adoption one-shot and revocable through the last checkpoint", async () => {
		const fixture = async () => {
			const document = new RailDocument();
			const bundle = capturedOrganizationBundle();
			const anchor = { x: 120, y: 45 };
			const snapshot = captureRailMirrorSnapshot(
				document.map,
				0,
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot;
			const permit = issueStaticFabOrganizationBundlePlacementPermit(
				document.map,
				document.portEquipment,
				0,
				document.organizations,
				document.relationships,
				bundle,
				anchor,
				0,
				snapshot.checksum,
			);
			const prepared = prepareStaticFabOrganizationBundlePlacement({
				version: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION,
				type: "PREPARE_STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT",
				requestId: 1,
				ticketId: permit.ticketId,
				snapshot,
				bundle,
				expectedBundleFingerprint: staticFabOrganizationBundleFingerprint(bundle),
				anchor,
				quarterTurns: 0,
			});
			const decoded = await decodeStaticFabOrganizationBundlePlacementTransport(
				structuredClone(encodeStaticFabOrganizationBundlePlacementTransport(prepared)),
				async () => {},
				7,
			);
			if (!decoded.plan || !decoded.ticket) throw new Error("Expected exact decoded plan");
			const { plan, ticket } = decoded;
			const adopt = (checkpoint: () => Promise<void>, candidate = plan) =>
				adoptStaticFabOrganizationBundlePlacementWorkerPlanCooperatively(
					permit,
					candidate,
					ticket,
					ticket.prospectiveChecksum,
					document.map,
					document.portEquipment,
					document.organizations,
					document.relationships,
					checkpoint,
					7,
				);
			return { document, permit, plan, adopt };
		};
		const successful = await fixture();
		let checkpoints = 0;
		const adopted = await successful.adopt(async () => {
			checkpoints++;
		});
		expect(adopted).not.toBeNull();
		if (!adopted) throw new Error("Expected adopted plan");
		expect(adopted).toEqual(successful.plan);
		expect(adopted).not.toBe(successful.plan);
		const { document } = successful;
		expect(
			isCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
				adopted,
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(true);
		expect(document.getPatchSequence()).toBe(0);
		expect(await successful.adopt(async () => {})).toBeNull();
		expect(
			consumeCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
				adopted,
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(true);
		expect(
			consumeCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
				adopted,
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(false);
		for (const cancelledAt of [1, Math.floor(checkpoints / 2), checkpoints]) {
			const cancelled = await fixture();
			let count = 0;
			expect(
				await cancelled.adopt(async () => {
					if (++count === cancelledAt)
						revokeStaticFabOrganizationBundlePlacementPermit(cancelled.permit);
				}),
			).toBeNull();
			expect(count).toBe(cancelledAt);
			expect(isIssuedStaticFabOrganizationBundlePlacementPlan(cancelled.plan)).toBe(false);
			expect(await cancelled.adopt(async () => {})).toBeNull();
			expect(cancelled.document.getPatchSequence()).toBe(0);
		}
		const counterfeit = await fixture();
		const copiedPlan = structuredClone(counterfeit.plan);
		const freeze = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			for (const child of Object.values(value)) freeze(child);
			Object.freeze(value);
		};
		freeze(copiedPlan);
		expect(await counterfeit.adopt(async () => {}, copiedPlan)).toBeNull();
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(copiedPlan)).toBe(false);
		const coercible = await fixture();
		const coercionPlan = Object.freeze({
			...coercible.plan,
			organizationBundle: Object.freeze({
				...coercible.plan.organizationBundle,
				widthMeters: {
					valueOf: () => coercible.plan.organizationBundle.widthMeters,
				} as unknown as number,
			}),
		});
		expect(staticFabOrganizationBundlePlacementFingerprint(coercionPlan)).toBe(
			staticFabOrganizationBundlePlacementFingerprint(coercible.plan),
		);
		expect(await coercible.adopt(async () => {}, coercionPlan)).toBeNull();
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(coercionPlan)).toBe(false);
		const rolledBack = await fixture();
		const prior = await rolledBack.adopt(async () => {});
		if (!prior) throw new Error("Expected an adopted plan before rollback");
		const map = rolledBack.document.map;
		const checkpoint = map.createMutationCheckpoint();
		const mutation = { x: -10, y: -10, before: 0, after: 0x21 };
		expect(map.applyAtomicMutations([mutation], [])).toBe(true);
		map.rollbackAtomicMutations([mutation], [], checkpoint);
		expect(map.getRevision()).toBe(prior.baseRevision);
		expect(
			isCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
				prior,
				map,
				rolledBack.document.portEquipment,
				rolledBack.document.organizations,
				rolledBack.document.relationships,
			),
		).toBe(false);
		expect(rolledBack.document.commitStaticFabOrganizationBundle(prior)).toBe(false);
	});
	it("transfers one typed addition representation with the exact mixed-equipment plan bytes", async () => {
		const target = new RailDocument();
		const bundle = capturedOrganizationBundle();
		const prepared = prepareStaticFabOrganizationBundlePlacement({
			version: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION,
			type: "PREPARE_STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT",
			requestId: 1,
			ticketId: 1,
			snapshot: captureRailMirrorSnapshot(
				target.map,
				0,
				target.portEquipment,
				target.organizations,
				target.relationships,
			).snapshot,
			bundle,
			expectedBundleFingerprint: staticFabOrganizationBundleFingerprint(bundle),
			anchor: { x: 120, y: 45 },
			quarterTurns: 0,
		});
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.plan || !prepared.ticket) throw new Error("Expected exact Worker plan");
		const originalPlan = prepared.plan;
		const encoded = encodeStaticFabOrganizationBundlePlacementTransport(prepared);
		expect(encoded.kind).toBe("additions");
		if (encoded.kind !== "additions") throw new Error("Expected typed additions");
		for (const field of [
			"cells",
			"mutations",
			"switchMutations",
			"portMutations",
			"equipmentGroupMutations",
			"organizationMutations",
			"relationshipMutations",
		]) {
			expect(Object.hasOwn(encoded.prepared.plan, field)).toBe(false);
		}
		const received = structuredClone(encoded, { transfer: collectTransferableBuffers(encoded) });
		expect(encoded.additions.xs.byteLength).toBe(0);
		let checkpoints = 0;
		const decoded = await decodeStaticFabOrganizationBundlePlacementTransport(
			received,
			async () => {
				checkpoints++;
			},
			7,
		);
		expect(checkpoints).toBeGreaterThan(50);
		expect(decoded).toEqual(prepared);
		expect(staticFabOrganizationBundlePlacementPreparedShapeError(decoded)).toBeNull();
		expect(
			Object.isFrozen(decoded.plan?.organizationMutations[0]?.after?.membership.railEdges),
		).toBe(true);
		for (const cancelledAt of [1, Math.floor(checkpoints / 2), checkpoints]) {
			let count = 0;
			await expect(
				decodeStaticFabOrganizationBundlePlacementTransport(
					received,
					async () => {
						if (++count === cancelledAt) throw new Error("test admission cancelled");
					},
					7,
				),
			).rejects.toThrow("test admission cancelled");
			expect(count).toBe(cancelledAt);
		}
		const replaced = structuredClone(received);
		let replacedHeader = false;
		const ownedResult = await decodeStaticFabOrganizationBundlePlacementTransport(
			replaced,
			async () => {
				if (replacedHeader) return;
				replacedHeader = true;
				Object.assign(replaced.prepared.plan, {
					reason: "changed after capture",
					organizationBundle: null,
				});
				Object.assign(replaced.additions, { xs: new Int32Array(), organizations: null });
			},
			7,
		);
		expect(ownedResult).toEqual(prepared);
		const corrupted = structuredClone(received);
		corrupted.additions.encoded[0] = 0;
		await expect(
			decodeStaticFabOrganizationBundlePlacementTransport(corrupted, async () => {}, 7),
		).rejects.toThrow("rail addition mutation");
		await expect(
			decodeStaticFabOrganizationBundlePlacementTransport(
				{ ...received, version: 999 },
				async () => {},
			),
		).rejects.toThrow("version");
		const capture = createStaticFabOrganizationBundlePlacementCapture(received.additions);
		while (!capture.done) expect(capture.step(7)).toBeLessThanOrEqual(7);
		const additions = capture.finish();
		expect(additions).toEqual(received.additions);
		const sourceBuffers = new Set(collectTransferableBuffers(received.additions));
		for (const buffer of collectTransferableBuffers(additions))
			expect(sourceBuffers.has(buffer)).toBe(false);
		const equipment = hydratePortEquipmentSnapshot(additions.portEquipment);
		const organizations = hydrateStaticFabOrganizationSnapshot(additions.organizations);
		const relationships = hydrateStaticFabAssemblyRelationshipSnapshot(additions.relationships);
		const plan: StaticFabOrganizationBundlePlacementPlan = {
			...received.prepared.plan,
			cells: Array.from(additions.xs, (x, index) => ({ x, y: additions.ys[index] as number })),
			mutations: Array.from(additions.xs, (x, index) => ({
				x,
				y: additions.ys[index] as number,
				before: 0,
				after: additions.encoded[index] as number,
			})),
			switchMutations: Array.from(additions.switchIds, (id, index) => ({
				id,
				before: null,
				after: readAdvancedSwitchRecord(additions.switches, index, id, "placement test"),
			})),
			portMutations: equipment.ports.map((after) => ({ id: after.id, before: null, after })),
			equipmentGroupMutations: equipment.equipmentGroups.map((after) => ({
				id: after.id,
				before: null,
				after,
			})),
			organizationMutations: organizations.records.map((after) => ({
				id: after.id,
				before: null,
				after,
			})),
			relationshipMutations: relationships.records.map((after) => ({
				id: after.id,
				before: null,
				after,
			})),
		};
		expect(equipment.ports).toHaveLength(7);
		expect(equipment.equipmentGroups.map((record) => record.kind)).toEqual(["OHB", "EQ", "STK"]);
		expect(plan).toEqual(prepared.plan);
		expect(staticFabOrganizationBundlePlacementFingerprint(plan)).toBe(
			prepared.ticket.planFingerprint,
		);
		const first = prepared.plan.mutations[0];
		if (!first) throw new Error("Expected rail additions");
		expect(() =>
			encodeStaticFabOrganizationBundlePlacementTransport({
				...prepared,
				plan: {
					...originalPlan,
					mutations: [{ ...first, before: 1 }, ...originalPlan.mutations.slice(1)],
				},
			}),
		).toThrow("rail addition mutation");
	});
	it("bounds fingerprint steps inside a maximum schema-valid relationship record", () => {
		const target = new RailDocument();
		const base = planStaticFabOrganizationBundlePlacement(
			target.map,
			target.portEquipment,
			17,
			target.organizations,
			target.relationships,
			capturedOrganizationBundle(),
			{ x: 120, y: 45 },
			0,
			null,
		);
		const record = maximumFingerprintRelationship();
		expect(checksumStaticFabAssemblyRelationshipRecord(record)).toBe("07937eda:5c0bf0f9");
		// This isolates the record byte contract; it does not certify a placement against source topology.
		const plan: StaticFabOrganizationBundlePlacementPlan = Object.freeze({
			...base,
			nextRelationshipIdAfter: 2,
			relationshipMutations: Object.freeze([Object.freeze({ id: 1, before: null, after: record })]),
			organizationBundle: Object.freeze({ ...base.organizationBundle, relationshipCount: 1 }),
		});
		const expected = staticFabOrganizationBundlePlacementFingerprint(plan);
		const task = createCooperativeTask(staticFabOrganizationBundlePlacementFingerprintSteps(plan));
		task.step(64);
		expect(task.done).toBe(false);
		expect(() => task.finish()).toThrow("not complete");
		let batches = 1;
		while (!task.done) {
			expect(task.step(64)).toBeLessThanOrEqual(64);
			batches++;
		}
		expect(batches).toBeGreaterThanOrEqual(
			Math.ceil(STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD / 64),
		);
		expect(task.finish()).toBe(expected);
		const mutableRecord = Object.freeze(structuredClone(record));
		const shallow = Object.freeze({
			...plan,
			relationshipMutations: Object.freeze([
				Object.freeze({ id: 1, before: null, after: mutableRecord }),
			]),
		});
		expect(() =>
			completeCooperativeSteps(staticFabOrganizationBundlePlacementFingerprintSteps(shallow)),
		).toThrow("불변");
	});
	it("preserves placement fingerprint bytes through all four quarter turns", () => {
		const fingerprints = ([0, 1, 2, 3] as const).map((turns) => {
			const target = new RailDocument();
			const plan = planStaticFabOrganizationBundlePlacement(
				target.map,
				target.portEquipment,
				17,
				target.organizations,
				target.relationships,
				capturedOrganizationBundle(),
				{ x: 120, y: 45 },
				turns,
				null,
			);
			expect(plan.valid, plan.reason).toBe(true);
			const synchronous = staticFabOrganizationBundlePlacementFingerprint(plan);
			const task = createCooperativeTask(
				staticFabOrganizationBundlePlacementFingerprintSteps(plan),
			);
			let batches = 0;
			while (!task.done) {
				expect(task.step(7)).toBeLessThanOrEqual(7);
				batches++;
			}
			expect(batches).toBeGreaterThanOrEqual(Math.ceil((plan.mutations.length * 4) / 7));
			expect(task.finish()).toBe(synchronous);
			return synchronous;
		});
		expect(fingerprints).toMatchInlineSnapshot(`
			[
			  "58a1890b:f248f510",
			  "e05ac39c:49a98afb",
			  "f07cfd80:0a8a08db",
			  "43950344:dfa1618c",
			]
		`);
	});
	it.each([
		["mutations"],
		["mutations", 0],
		["portMutations", 0, "after", "route"],
		["equipmentGroupMutations", 0, "after", "portIds"],
		["organizationMutations", 0, "after", "membership", "railEdges", 0, "from"],
		["organizationBundle", "anchor"],
		["organizationBundle", "organizationNames"],
	])("rejects a mutable hashed container at %j without trusting a frozen root", (...path) => {
		const target = new RailDocument();
		const plan = planStaticFabOrganizationBundlePlacement(
			target.map,
			target.portEquipment,
			17,
			target.organizations,
			target.relationships,
			capturedOrganizationBundle(),
			{ x: 120, y: 45 },
			0,
			null,
		);
		const clone = structuredClone(plan);
		let mutable: unknown = clone;
		for (const key of path) mutable = Reflect.get(mutable as object, key);
		if (typeof mutable !== "object" || mutable === null)
			throw new Error("Missing hash fixture field");
		const freezeExcept = (value: unknown): void => {
			if (typeof value !== "object" || value === null) return;
			for (const nested of Object.values(value)) freezeExcept(nested);
			if (value !== mutable) Object.freeze(value);
		};
		freezeExcept(clone);
		expect(Object.isFrozen(clone)).toBe(true);
		expect(() =>
			completeCooperativeSteps(staticFabOrganizationBundlePlacementFingerprintSteps(clone)),
		).toThrow("immutable hashed fields");
		expect(staticFabOrganizationBundlePlacementFingerprint(clone)).toBe(
			staticFabOrganizationBundlePlacementFingerprint(plan),
		);
	});
	it("keeps cooperative bundle fingerprints equal to the synchronous portable identity", async () => {
		const source = capturedOrganizationBundle();
		const prepared = prepareStaticFabOrganizationBundle(structuredClone(source));
		if (!prepared.valid) throw new Error(prepared.reason);
		let checkpoints = 0;
		const actual = await fingerprintFrozenStaticFabOrganizationBundleCooperatively(
			prepared.bundle,
			async () => {
				checkpoints++;
			},
			3,
		);
		expect(checkpoints).toBeGreaterThan(10);
		expect(actual).toBe(staticFabOrganizationBundleFingerprint(source));
		expect(prepared.bundle).toEqual(source);
	});

	it("does not cache a fingerprint cancelled at the final checkpoint", async () => {
		const source = capturedOrganizationBundle();
		const first = prepareStaticFabOrganizationBundle(structuredClone(source));
		const second = prepareStaticFabOrganizationBundle(structuredClone(source));
		if (!first.valid || !second.valid) throw new Error("Expected valid bundle fixtures.");
		let total = 0;
		await fingerprintFrozenStaticFabOrganizationBundleCooperatively(
			first.bundle,
			async () => {
				total++;
			},
			3,
		);
		let reached = 0;
		const cancellation = new Error("cancel fingerprint publication");
		await expect(
			fingerprintFrozenStaticFabOrganizationBundleCooperatively(
				second.bundle,
				async () => {
					if (++reached === total) throw cancellation;
				},
				3,
			),
		).rejects.toBe(cancellation);
		let retried = 0;
		await fingerprintFrozenStaticFabOrganizationBundleCooperatively(
			second.bundle,
			async () => {
				retried++;
			},
			3,
		);
		expect(retried).toBe(total);
	});
	it("plans rail, equipment, and organization records as one valid placement", () => {
		const bundle = capturedOrganizationBundle();
		const target = new RailDocument();
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const planning = planStaticFabOrganizationBundlePlacementWithProspectiveState(
			target.map,
			equipment,
			17,
			organizations,
			target.relationships,
			bundle,
			{ x: 120, y: 45 },
			0,
			null,
		);
		const plan = planning.plan;

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.baseRevision).toBe(0);
		expect(plan.basePatchSequence).toBe(17);
		expect(plan.mutations.length).toBeGreaterThan(0);
		expect(plan.portMutations).toHaveLength(7);
		expect(plan.equipmentGroupMutations).toHaveLength(3);
		expect(plan.organizationMutations).toHaveLength(2);
		expect(plan.organizationMutations[1]?.after?.parentOrganizationIds).toEqual([1]);
		expect(plan.organizationMutations[0]?.after?.membership.equipmentGroupIds).toEqual([1, 2, 3]);
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(plan)).toBe(true);
		expect(planning.prospectiveState).not.toBeNull();

		const placedMap = target.map.clone();
		expect(placedMap.applyAtomicMutations(plan.mutations, plan.switchMutations)).toBe(true);
		const placedEquipment = applyPortEquipmentMutations(
			equipment,
			plan.portMutations,
			plan.equipmentGroupMutations,
		);
		const placedOrganizations = applyStaticFabOrganizationMutations(
			organizations,
			plan.organizationMutations,
			plan.nextOrganizationIdAfter,
		);

		expect(portEquipmentLayoutError(placedMap, placedEquipment)).toBeNull();
		expect(
			staticFabOrganizationStateError(placedMap, placedEquipment, placedOrganizations),
		).toBeNull();
		expect(placedEquipment.ports.map((port) => port.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(placedOrganizations.records.map((record) => record.name)).toEqual([
			"Factory",
			"Process Bay",
		]);
		expect(planning.prospectiveState?.portEquipment).toEqual(placedEquipment);
		expect(planning.prospectiveState?.organizations).toEqual(placedOrganizations);
		for (const mutation of plan.mutations) {
			expect(planning.prospectiveState?.map.getEncoded(mutation.x, mutation.y)).toBe(
				mutation.after,
			);
		}
	});

	it("allocates deterministic fresh IDs, barcodes, parent links, and collision-free names", () => {
		const bundle = capturedOrganizationBundle();
		const equipmentA = emptyEquipmentAt(41, 7);
		const equipmentB = emptyEquipmentAt(41, 7);
		const targetA = longBayDocument();
		const targetB = longBayDocument();
		const organizationsA = namingCollisionState(targetA);
		const organizationsB = namingCollisionState(targetB);
		const anchor = { x: 80, y: -30 };
		const first = planStaticFabOrganizationBundlePlacement(
			targetA.map,
			equipmentA,
			9,
			organizationsA,
			targetA.relationships,
			bundle,
			anchor,
			0,
			null,
		);
		const second = planStaticFabOrganizationBundlePlacement(
			targetB.map,
			equipmentB,
			9,
			organizationsB,
			targetB.relationships,
			bundle,
			anchor,
			0,
			null,
		);

		expect(first.valid, first.reason).toBe(true);
		expect(second.valid, second.reason).toBe(true);
		expect(first.portMutations.map((mutation) => mutation.id)).toEqual([
			41, 42, 43, 44, 45, 46, 47,
		]);
		expect(first.equipmentGroupMutations.map((mutation) => mutation.id)).toEqual([7, 8, 9]);
		expect(first.organizationMutations.map((mutation) => mutation.id)).toEqual([50, 51]);
		expect(first.nextOrganizationIdBefore).toBe(50);
		expect(first.nextOrganizationIdAfter).toBe(52);
		expect(first.organizationBundle.organizationNames).toEqual([
			"Factory copy 2",
			"Process Bay copy",
		]);
		expect(first.organizationMutations[1]?.after?.parentOrganizationIds).toEqual([50]);
		expect(first.portMutations.map((mutation) => mutation.after?.barcode)).toEqual(
			second.portMutations.map((mutation) => mutation.after?.barcode),
		);
		expect(first.mutations).toEqual(second.mutations);
		expect(first.portMutations).toEqual(second.portMutations);
		expect(first.equipmentGroupMutations).toEqual(second.equipmentGroupMutations);
		expect(first.organizationMutations).toEqual(second.organizationMutations);
	});

	it("rejects an occupied footprint without issuing partial mutations", () => {
		const bundle = capturedOrganizationBundle();
		const target = new RailDocument();
		const anchor = { x: 30, y: 60 };
		const materialized = materializeStaticFabOrganizationBundle(bundle, anchor, 0);
		const occupiedEdge = materialized.railEdges[0];
		if (!occupiedEdge) throw new Error("Expected captured rail edges.");
		const occupied = planRailPath(target.map, [occupiedEdge.from, occupiedEdge.to]);
		expect(occupied.valid, occupied.reason).toBe(true);
		expect(target.commit(occupied)).toBe(true);

		const plan = planStaticFabOrganizationBundlePlacement(
			target.map,
			target.portEquipment,
			target.getPatchSequence(),
			target.organizations,
			target.relationships,
			bundle,
			anchor,
			0,
			null,
		);

		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("빈 footprint");
		expect(plan.conflicts).toEqual(expect.arrayContaining([occupiedEdge.from, occupiedEdge.to]));
		expect(plan.mutations).toEqual([]);
		expect(plan.portMutations).toEqual([]);
		expect(plan.equipmentGroupMutations).toEqual([]);
		expect(plan.organizationMutations).toEqual([]);
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(plan)).toBe(false);
	});

	it("binds issuance to exact source identities and carries stale-detection generations", () => {
		const bundle = capturedOrganizationBundle();
		const target = new RailDocument();
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const plan = planStaticFabOrganizationBundlePlacement(
			target.map,
			equipment,
			23,
			organizations,
			target.relationships,
			bundle,
			{ x: -90, y: 25 },
			0,
			null,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(plan)).toBe(true);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				target.map,
				equipment,
				organizations,
				target.relationships,
			),
		).toBe(true);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				target.map.clone(),
				equipment,
				organizations,
				target.relationships,
			),
		).toBe(false);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				target.map,
				Object.freeze({ ...equipment }),
				organizations,
				target.relationships,
			),
		).toBe(false);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				target.map,
				equipment,
				Object.freeze({ ...organizations }),
				target.relationships,
			),
		).toBe(false);

		const forged = Object.freeze({ ...plan });
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(forged)).toBe(false);
		expect(
			isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				forged,
				target.map,
				equipment,
				organizations,
				target.relationships,
			),
		).toBe(false);

		const plannedRevision = plan.baseRevision;
		expect(target.map.setEncoded(10_000, -10_000, 0x12)).toBe(true);
		expect(target.map.getRevision()).not.toBe(plannedRevision);
		expect(plan.basePatchSequence).toBe(23);

		const invalidSequence = planStaticFabOrganizationBundlePlacement(
			target.map,
			equipment,
			-1,
			organizations,
			target.relationships,
			bundle,
			{ x: 0, y: 0 },
			0,
			null,
		);
		expect(invalidSequence.valid).toBe(false);
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(invalidSequence)).toBe(false);
	});

	it("rotates rail and cardinal port identities around the portable origin", () => {
		const bundle = capturedOrganizationBundle();
		const target = new RailDocument();
		const anchor = { x: 210, y: -75 };
		const materialized = materializeStaticFabOrganizationBundle(bundle, anchor, 1);
		const plan = planStaticFabOrganizationBundlePlacement(
			target.map,
			target.portEquipment,
			target.getPatchSequence(),
			target.organizations,
			target.relationships,
			bundle,
			anchor,
			1,
			null,
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.organizationBundle).toMatchObject({
			anchor,
			quarterTurns: 1,
			widthMeters: bundle.sourceHeightMeters,
			heightMeters: bundle.sourceWidthMeters,
		});
		expect(new Set(plan.cells.map(cellKey))).toEqual(
			new Set(materialized.railEdges.flatMap((edge) => [cellKey(edge.from), cellKey(edge.to)])),
		);
		for (const [index, portable] of materialized.ports.entries()) {
			const placed = plan.portMutations[index]?.after;
			if (!placed) throw new Error(`Expected placed PORT-${index}.`);
			expect(placed.route).toEqual(portable.route);
			expect(placed.stationMillimeters).toBe(portable.stationMillimeters);
			expect(placed.side).toBe(portable.side);
			expect(placed.direction).toBe(portable.direction);
		}
		const root = plan.organizationMutations[0]?.after;
		if (!root) throw new Error("Expected placed root organization.");
		const expectedRootEdges = materialized.organizations[0]?.membership.railEdgeIndices
			.map((index) => materialized.railEdges[index])
			.filter((edge): edge is DirectedRailEdge => edge !== undefined)
			.sort(compareDirectedRailEdges);
		expect(root.membership.railEdges).toEqual(expectedRootEdges);
	});

	it("contains malformed bundle input as an unissued invalid plan without throwing", () => {
		const target = new RailDocument();
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const valid = capturedOrganizationBundle();
		const malformedPortBundle = JSON.parse(JSON.stringify(valid)) as {
			ports: Array<{ route: unknown }>;
		};
		if (malformedPortBundle.ports[0]) malformedPortBundle.ports[0].route = null;
		const throwingRecord = Object.defineProperty({}, "version", {
			get(): never {
				throw new Error("hostile getter");
			},
		});
		const malformedInputs: readonly unknown[] = [
			null,
			{},
			{ version: 1 },
			malformedPortBundle,
			throwingRecord,
		];

		for (const malformed of malformedInputs) {
			let plan: ReturnType<typeof planStaticFabOrganizationBundlePlacement> | undefined;
			expect(() => {
				plan = planStaticFabOrganizationBundlePlacement(
					target.map,
					equipment,
					0,
					organizations,
					target.relationships,
					malformed,
					{ x: 0, y: 0 },
					0,
					null,
				);
			}).not.toThrow();
			if (!plan) throw new Error("Planner did not return an invalid plan.");
			expect(plan.valid).toBe(false);
			expect(plan.mutations).toEqual([]);
			expect(isIssuedStaticFabOrganizationBundlePlacementPlan(plan)).toBe(false);
		}
	});
});

function maximumFingerprintRelationship(): StaticFabAssemblyRelationshipRecordV1 {
	const cutCount = STATIC_FAB_ASSEMBLY_RELATIONSHIP_MAX_EDGE_REFERENCES_PER_RECORD - 8;
	const edge = (x: number): DirectedRailEdge => ({ from: { x, y: 0 }, to: { x: x + 1, y: 0 } });
	const parent = (x: number) => ({ edge: edge(x), scope: { kind: "PARENT_DIRECT" as const } });
	const owners = Array.from({ length: 64 }, (_, index) => index + 2);
	const cuts = Array.from({ length: cutCount }, (_, x) =>
		x < 1023 || x === cutCount - 1
			? {
					edge: edge(x),
					scope: {
						kind: "PARTICIPANT_EFFECTIVE" as const,
						participantIndex: 0 as const,
						directOwnerOrganizationIds: owners,
					},
				}
			: parent(x),
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
								support: parent(cutCount),
								adjacentExclusiveCutEdgeIndex: cutCount - 1,
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
										binding: { kind: "EXCLUSIVE_CUT_EDGE", exclusiveCutEdgeIndex: cutCount - 1 },
									},
									{
										incidence: "OUTGOING",
										binding: { kind: "WITNESS", scopedEdge: parent(cutCount) },
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

function capturedOrganizationBundle(): StaticFabOrganizationBundle {
	const source = longBayDocument();
	const modules = [...buildRailModuleOwnershipIndex(source.map).modules].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
	if (modules.length < 4) throw new Error("Expected at least four Long Bay modules.");
	const equipment = mixedEquipmentState(source);
	const organizations = organizationState(
		[
			organizationRecord(10, "AREA", "Factory", [], modules, [1, 2, 3]),
			organizationRecord(20, "BAY", "Process Bay", [10], modules.slice(0, 1), []),
		],
		21,
	);
	const capture = captureStaticFabOrganizationBundle(
		source.map,
		equipment,
		source.getPatchSequence(),
		organizations,
		source.relationships,
		[10],
		"EFFECTIVE",
	);
	expect(capture.valid, capture.reason).toBe(true);
	if (!capture.valid) throw new Error(capture.reason);
	return capture.bundle;
}

function longBayDocument(): RailDocument {
	const source = new RailDocument();
	const template = planRailTemplate(
		source.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	expect(template.valid, template.reason).toBe(true);
	expect(source.commit(template)).toBe(true);
	return source;
}

function emptyEquipmentAt(nextPortId: number, nextEquipmentGroupId: number): PortEquipmentState {
	return Object.freeze({
		nextPortId,
		nextEquipmentGroupId,
		ports: Object.freeze([]),
		equipmentGroups: Object.freeze([]),
	});
}

function namingCollisionState(document: RailDocument): StaticFabOrganizationState {
	const modules = [...buildRailModuleOwnershipIndex(document.map).modules].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
	if (modules.length < 3) throw new Error("Expected three modules for organization names.");
	return organizationState(
		[
			organizationRecord(4, "AREA", "Factory", [], modules.slice(0, 1), []),
			organizationRecord(9, "AREA", "Factory copy", [], modules.slice(1, 2), []),
			organizationRecord(20, "BAY", "Process Bay", [], modules.slice(2, 3), []),
		],
		50,
	);
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
	nextOrganizationId: number,
): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId,
		records: Object.freeze([...records].sort((left, right) => left.id - right.id)),
	});
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	parentOrganizationIds: readonly number[],
	modules: readonly RailModuleOwnership[],
	equipmentGroupIds: readonly number[],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: membershipFromModules(modules, equipmentGroupIds),
	});
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
	equipmentGroupIds: readonly number[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) edges.set(edgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds].sort((left, right) => left - right)),
	});
}

function mixedEquipmentState(document: RailDocument): PortEquipmentState {
	const runs = straightRuns(document).filter((run) => run.length >= 4);
	const [ohbRun, eqRun, stkRun] = runs;
	if (!ohbRun || !eqRun || !stkRun) {
		throw new Error("Long Bay fixture needs three straight rail runs.");
	}
	const ports: PortRecord[] = [
		port(1, 1, ohbRun[0] as RouteCell, "OHB", "LEFT", 700),
		port(2, 2, eqRun[0] as RouteCell, "EQ", "CENTER", 0),
		port(3, 2, eqRun[1] as RouteCell, "EQ", "CENTER", 0),
		...stkRun.slice(0, 4).map((route, index) => port(index + 4, 3, route, "STK", "CENTER", 0)),
	];
	const equipmentGroups: EquipmentGroupRecord[] = [
		{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
		{
			id: 2,
			kind: "EQ",
			pitchMillimeters: 1_000,
			recipe: "PHOTO",
			portIds: [2, 3],
		},
		{ id: 3, kind: "STK", template: "FOUR_PORT", portIds: [4, 5, 6, 7] },
	];
	return Object.freeze({
		nextPortId: 40,
		nextEquipmentGroupId: 20,
		ports: Object.freeze(ports),
		equipmentGroups: Object.freeze(equipmentGroups),
	});
}

interface RouteCell {
	readonly x: number;
	readonly z: number;
	readonly from: Direction;
	readonly to: Direction;
}

function straightRuns(document: RailDocument): RouteCell[][] {
	const routes = new Map<string, RouteCell>();
	document.map.forEachRail((x, z, rail) => {
		if (
			rail.incoming === 0 ||
			rail.outgoing === 0 ||
			(rail.incoming & (rail.incoming - 1)) !== 0 ||
			(rail.outgoing & (rail.outgoing - 1)) !== 0 ||
			rail.outgoing !== oppositeDirection(rail.incoming as Direction)
		) {
			return;
		}
		const from = rail.incoming as Direction;
		const to = rail.outgoing as Direction;
		routes.set(`${x}:${z}:${from}:${to}`, { x, z, from, to });
	});
	const visited = new Set<string>();
	const runs: RouteCell[][] = [];
	for (const route of routes.values()) {
		const key = `${route.x}:${route.z}:${route.from}:${route.to}`;
		if (visited.has(key)) continue;
		const backward = moveRouteCell(route, oppositeDirection(route.to));
		if (routes.has(`${backward.x}:${backward.z}:${route.from}:${route.to}`)) continue;
		const run: RouteCell[] = [];
		let current: RouteCell | undefined = route;
		while (current) {
			const currentKey = `${current.x}:${current.z}:${current.from}:${current.to}`;
			if (visited.has(currentKey)) break;
			visited.add(currentKey);
			run.push(current);
			const next = moveRouteCell(current, current.to);
			current = routes.get(`${next.x}:${next.z}:${current.from}:${current.to}`);
		}
		runs.push(run);
	}
	return runs.sort((left, right) => right.length - left.length);
}

function moveRouteCell(
	cell: Pick<RouteCell, "x" | "z">,
	direction: Direction,
): { x: number; z: number } {
	if (direction === DIR_E) return { x: cell.x + 1, z: cell.z };
	if (direction === DIR_W) return { x: cell.x - 1, z: cell.z };
	return direction === DIR_N ? { x: cell.x, z: cell.z - 1 } : { x: cell.x, z: cell.z + 1 };
}

function port(
	id: number,
	equipmentGroupId: number,
	route: RouteCell,
	portType: "OHB" | "EQ" | "STK",
	side: "LEFT" | "CENTER",
	lateralOffsetMillimeters: number,
): PortRecord {
	return Object.freeze({
		id,
		equipmentGroupId,
		route: Object.freeze({ kind: "CARDINAL_CELL", ...route }) satisfies CardinalPortRoute,
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters,
		direction: "WITH_TRAVEL",
		portType,
		barcode: `${portType}-${id}`,
	});
}

function edgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function cellKey(cell: Cell): string {
	return `${cell.x},${cell.y}`;
}
