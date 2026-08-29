import { describe, expect, it } from "vitest";
import { copyEquipmentGroupRecord } from "./EquipmentGroup";
import {
	createPortEquipmentMutationPlanWithImmutableGraphCertificate,
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
} from "./PortEquipmentPlan";
import { copyPortRecord, type PortRecord } from "./PortRecord";
import { planRailConstruction } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import {
	issueReviewedPortEquipmentApply,
	issueReviewedPortEquipmentApplyCooperatively,
	revokeReviewedPortEquipmentApply,
} from "./ReviewedPortEquipmentApplyCertification";
import { DIR_E, DIR_W } from "./railShape";

describe("reviewed port/equipment Apply certification", () => {
	it("rejects copied handles while preserving the exact one-shot document authority", () => {
		const document = straightDocument();
		const plan = singleOhbPlan(document);
		const handle = issueReviewedPortEquipmentApply(
			plan,
			document.map,
			document.portEquipment,
			document.organizations,
			document.getPatchSequence(),
		);

		expect(document.commitReviewedPortEquipment({ ...handle })).toBe(false);
		expect(document.commitReviewedPortEquipment(handle)).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(1);
		expect(document.commitReviewedPortEquipment(handle)).toBe(false);
	});

	it("issues the same opaque one-shot authority through cooperative fingerprint slices", async () => {
		const document = straightDocument();
		const plan = singleOhbPlan(document);
		let checkpoints = 0;
		const handle = await issueReviewedPortEquipmentApplyCooperatively(
			plan,
			document.map,
			document.portEquipment,
			document.organizations,
			document.getPatchSequence(),
			async () => {
				checkpoints++;
			},
		);

		expect(checkpoints).toBeGreaterThan(0);
		let tick = 0;
		const committed = document.commitReviewedPortEquipmentMeasured(handle, () => ++tick);
		expect(committed).toMatchObject({
			committed: true,
			timings: {
				authorityConsumptionMilliseconds: 1,
				commandValidationMilliseconds: 1,
				historyCreationMilliseconds: 1,
				stateApplicationMilliseconds: 1,
				historyPublicationMilliseconds: 1,
				patchPublicationMilliseconds: 1,
				totalMilliseconds: 6,
			},
		});
		expect(document.commitReviewedPortEquipment(handle)).toBe(false);
	});

	it("prepares reviewed state and history cooperatively before one atomic publication", async () => {
		const document = straightDocument();
		const plan = singleOhbPlan(document);
		const handle = issueReviewedPortEquipmentApply(
			plan,
			document.map,
			document.portEquipment,
			document.organizations,
			document.getPatchSequence(),
		);
		const events: unknown[] = [];
		const unsubscribe = document.subscribe((event) => events.push(event));
		let checkpoints = 0;
		let tick = 0;
		let preparedEvent: RailPatchEvent | null = null;

		const committed = await document.commitReviewedPortEquipmentCooperatively(handle, {
			checkpoint: async () => {
				checkpoints++;
			},
			now: () => ++tick,
			sliceMilliseconds: 1,
			preparePatch: async (event) => {
				preparedEvent = event;
				expect(document.portEquipment.ports).toHaveLength(0);
				expect(events).toHaveLength(0);
				expect(Object.isFrozen(event)).toBe(true);
			},
		});
		unsubscribe();

		expect(committed.committed).toBe(true);
		expect(committed.timings?.totalMilliseconds).toBeGreaterThan(0);
		expect(checkpoints).toBeGreaterThan(0);
		expect(events).toHaveLength(1);
		expect(events[0]).toBe(preparedEvent);
		expect(document.portEquipment.ports).toHaveLength(1);
		expect(document.commitReviewedPortEquipment(handle)).toBe(false);
		expect(document.undo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(1);
	});

	it("terminally rejects cooperative Apply when the document changes at a checkpoint", async () => {
		const document = straightDocument();
		const handle = issueReviewedPortEquipmentApply(
			singleOhbPlan(document),
			document.map,
			document.portEquipment,
			document.organizations,
			document.getPatchSequence(),
		);
		let changed = false;
		let tick = 0;

		const committed = await document.commitReviewedPortEquipmentCooperatively(handle, {
			checkpoint: async () => {
				if (changed) return;
				changed = true;
				expect(
					document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 6, y: 0 })),
				).toBe(true);
			},
			now: () => ++tick,
			sliceMilliseconds: 1,
		});

		expect(changed).toBe(true);
		expect(committed).toEqual({ committed: false, timings: null });
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.commitReviewedPortEquipment(handle)).toBe(false);
	});

	it("discards a prepared unpublished event when the source changes before publication", async () => {
		const document = straightDocument();
		const handle = issueReviewedPortEquipmentApply(
			singleOhbPlan(document),
			document.map,
			document.portEquipment,
			document.organizations,
			document.getPatchSequence(),
		);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		let prepared = false;
		let tick = 0;

		const committed = await document.commitReviewedPortEquipmentCooperatively(handle, {
			checkpoint: async () => {},
			now: () => ++tick,
			sliceMilliseconds: 1,
			preparePatch: async () => {
				prepared = true;
				expect(
					document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 6, y: 0 })),
				).toBe(true);
			},
		});

		expect(prepared).toBe(true);
		expect(committed).toEqual({ committed: false, timings: null });
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(events).toHaveLength(1);
		expect(events[0]?.kind).toBe("build");
		expect(document.commitReviewedPortEquipment(handle)).toBe(false);
	});

	it("terminally rejects the exact handle on a checksum-equivalent foreign document", () => {
		const source = straightDocument();
		const foreign = straightDocument();
		const plan = singleOhbPlan(source);
		const handle = issueReviewedPortEquipmentApply(
			plan,
			source.map,
			source.portEquipment,
			source.organizations,
			source.getPatchSequence(),
		);

		expect(foreign.commitReviewedPortEquipment(handle)).toBe(false);
		expect(source.commitReviewedPortEquipment(handle)).toBe(false);
		expect(source.portEquipment.ports).toHaveLength(0);
		expect(foreign.portEquipment.ports).toHaveLength(0);
	});

	it("terminally revokes an issued handle before it escapes a stale review session", () => {
		const document = straightDocument();
		const plan = singleOhbPlan(document);
		const handle = issueReviewedPortEquipmentApply(
			plan,
			document.map,
			document.portEquipment,
			document.organizations,
			document.getPatchSequence(),
		);

		revokeReviewedPortEquipmentApply(handle);

		expect(document.commitReviewedPortEquipment(handle)).toBe(false);
		expect(document.portEquipment.ports).toHaveLength(0);
	});

	it("reissues mixed-batch authority only inside the exact document consume stack", () => {
		const document = straightDocument();
		const ohb = port(1, 1, "OHB", 1, "LEFT");
		const stk = port(2, 2, "STK", 2, "CENTER");
		const plan = createPortEquipmentMutationPlanWithImmutableGraphCertificate(
			PORT_EQUIPMENT_BATCH_PLAN_KIND,
			document.map.getRevision(),
			document.getPatchSequence(),
			[
				Object.freeze({ id: 1, before: null, after: ohb }),
				Object.freeze({ id: 2, before: null, after: stk }),
			],
			[
				Object.freeze({
					id: 1,
					before: null,
					after: copyEquipmentGroupRecord({
						id: 1,
						kind: "OHB",
						template: "SINGLE",
						portIds: [1],
					}),
				}),
				Object.freeze({
					id: 2,
					before: null,
					after: copyEquipmentGroupRecord({
						id: 2,
						kind: "STK",
						template: "FLEX",
						portIds: [2],
					}),
				}),
			],
		);
		const handle = issueReviewedPortEquipmentApply(
			plan,
			document.map,
			document.portEquipment,
			document.organizations,
			document.getPatchSequence(),
		);

		expect(document.commitReviewedPortEquipment(handle)).toBe(true);
		expect(document.portEquipment.ports.map((record) => record.portType)).toEqual(["OHB", "STK"]);
		expect(document.undo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(2);
	});
});

function singleOhbPlan(document: RailDocument) {
	const record = port(1, 1, "OHB", 1, "LEFT");
	return createPortEquipmentMutationPlanWithImmutableGraphCertificate(
		"place-ohb",
		document.map.getRevision(),
		document.getPatchSequence(),
		[Object.freeze({ id: 1, before: null, after: record })],
		[
			Object.freeze({
				id: 1,
				before: null,
				after: copyEquipmentGroupRecord({
					id: 1,
					kind: "OHB",
					template: "SINGLE",
					portIds: [1],
				}),
			}),
		],
	);
}

function port(
	id: number,
	equipmentGroupId: number,
	portType: PortRecord["portType"],
	x: number,
	side: PortRecord["side"],
): PortRecord {
	return copyPortRecord({
		id,
		equipmentGroupId,
		route: Object.freeze({ kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E }),
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters: portType === "STK" ? 0 : 700,
		direction: "WITH_TRAVEL",
		portType,
		barcode: `${portType}-${equipmentGroupId}-${id}`,
	});
}

function straightDocument(): RailDocument {
	const seed = new RailDocument();
	if (!seed.commit(planRailConstruction(seed.map, { x: 0, y: 0 }, { x: 4, y: 0 }))) {
		throw new Error("Synthetic straight rail could not be built.");
	}
	return RailDocument.fromLoadedMap(seed.map, 7);
}
