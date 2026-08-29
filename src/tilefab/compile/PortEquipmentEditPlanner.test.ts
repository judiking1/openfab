import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import {
	planCopyOhbToSlot,
	planEraseEquipmentGroup,
	planMoveOhbToSlot,
	resolvePortEquipmentSelection,
} from "./PortEquipmentEditPlanner";
import { planOhbPlacement } from "./PortPlacementPlanner";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { compilePortSlots, PORT_SLOT_STATUS, PortSlotAvailabilityIndex } from "./PortSlotCompiler";

describe("PortEquipmentEditPlanner", () => {
	it("moves one OHB while preserving stable IDs and barcode", () => {
		const fixture = placedOhbFixture();
		const source = resolvePortEquipmentSelection(fixture.document.portEquipment, 1);
		expect(source?.equipmentGroup.id).toBe(1);
		const targetRow = legalRows(fixture.slots).find(
			(row) =>
				fixture.slots.sides[row] === fixture.slots.sides[fixture.sourceRow] &&
				fixture.availability.statusFor(fixture.slots, row, 1).status === PORT_SLOT_STATUS.LEGAL &&
				row !== fixture.sourceRow,
		) as number;
		const before = fixture.document.portEquipment.ports[0];
		const plan = planMoveOhbToSlot(
			fixture.slots,
			targetRow,
			fixture.availability,
			fixture.document.portEquipment,
			1,
			fixture.document.map.getRevision(),
			fixture.document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan).toMatchObject({ kind: "edit-port-equipment", equipmentGroupMutations: [] });
		expect(fixture.document.commitPortEquipment(plan)).toBe(true);
		expect(fixture.document.portEquipment.ports[0]).toMatchObject({
			id: 1,
			equipmentGroupId: 1,
			barcode: "OHB-1",
		});
		expect(fixture.document.portEquipment.ports[0]?.route).not.toEqual(before?.route);
		expect(fixture.document.undo()).toBe(true);
		expect(fixture.document.portEquipment.ports[0]).toEqual(before);
		expect(fixture.document.redo()).toBe(true);
		expect(fixture.document.portEquipment.ports[0]?.route).toEqual(plan.portMutations[0]?.after?.route);
	});

	it("copies an OHB with new monotonic IDs and one Worker-visible command", () => {
		const fixture = placedOhbFixture();
		const events: RailPatchEvent[] = [];
		fixture.document.subscribe((event) => events.push(event));
		const targetRow = legalRows(fixture.slots).find(
			(row) => fixture.availability.statusFor(fixture.slots, row).status === PORT_SLOT_STATUS.LEGAL,
		) as number;
		const plan = planCopyOhbToSlot(
			fixture.slots,
			targetRow,
			fixture.availability,
			fixture.document.portEquipment,
			1,
			fixture.document.map.getRevision(),
			fixture.document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(fixture.document.commitPortEquipment(plan)).toBe(true);
		expect(fixture.document.portEquipment).toMatchObject({
			nextPortId: 3,
			nextEquipmentGroupId: 3,
			ports: [{ id: 1 }, { id: 2, equipmentGroupId: 2, barcode: "OHB-2" }],
			equipmentGroups: [{ id: 1 }, { id: 2, kind: "OHB", portIds: [2] }],
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "place-ohb",
			portChanges: [{ id: 2 }],
			equipmentGroupChanges: [{ id: 2 }],
		});
	});

	it("bulldozes the reciprocal group and all owned ports atomically", () => {
		const fixture = placedOhbFixture();
		const plan = planEraseEquipmentGroup(
			fixture.document.portEquipment,
			1,
			fixture.document.map.getRevision(),
			fixture.document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan).toMatchObject({
			kind: "erase-port-equipment",
			portMutations: [{ id: 1, after: null }],
			equipmentGroupMutations: [{ id: 1, after: null }],
		});
		expect(fixture.document.commitPortEquipment(plan)).toBe(true);
		expect(fixture.document.portEquipment.ports).toHaveLength(0);
		expect(fixture.document.portEquipment.equipmentGroups).toHaveLength(0);
		expect(fixture.document.undo()).toBe(true);
		expect(fixture.document.portEquipment.ports).toHaveLength(1);
	});

	it("rejects stale, occupied, no-op, missing, and non-OHB edits", () => {
		const fixture = placedOhbFixture();
		expect(
			planMoveOhbToSlot(
				fixture.slots,
				fixture.sourceRow,
				fixture.availability,
				fixture.document.portEquipment,
				1,
				fixture.document.map.getRevision() + 1,
				fixture.document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("stale") });
		expect(
			planMoveOhbToSlot(
				fixture.slots,
				fixture.sourceRow,
				fixture.availability,
				fixture.document.portEquipment,
				1,
				fixture.document.map.getRevision(),
				fixture.document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("different") });
		expect(
			planCopyOhbToSlot(
				fixture.slots,
				fixture.sourceRow,
				fixture.availability,
				fixture.document.portEquipment,
				1,
				fixture.document.map.getRevision(),
				fixture.document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("available") });
		expect(
			planMoveOhbToSlot(
				fixture.slots,
				fixture.sourceRow,
				fixture.availability,
				fixture.document.portEquipment,
				99,
				fixture.document.map.getRevision(),
				fixture.document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("no longer exists") });
		expect(
			planEraseEquipmentGroup(
				fixture.document.portEquipment,
				99,
				fixture.document.map.getRevision(),
				fixture.document.getPatchSequence(),
			),
		).toMatchObject({ valid: false });
		const sourcePort = fixture.document.portEquipment.ports[0];
		if (!sourcePort) throw new Error("missing OHB fixture port");
		const nonOhbState: PortEquipmentState = {
			...fixture.document.portEquipment,
			ports: [{ ...sourcePort, portType: "EQ" }],
			equipmentGroups: [
				{ id: 1, kind: "EQ", portIds: [1], pitchMillimeters: 1_000, recipe: null },
			],
		};
		expect(
			planMoveOhbToSlot(
				fixture.slots,
				fixture.sourceRow,
				fixture.availability,
				nonOhbState,
				1,
				fixture.document.map.getRevision(),
				fixture.document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("Only one-port OHB") });

		const copiedRow = legalRows(fixture.slots).find(
			(row) => fixture.availability.statusFor(fixture.slots, row).status === PORT_SLOT_STATUS.LEGAL,
		) as number;
		const copy = planCopyOhbToSlot(
			fixture.slots,
			copiedRow,
			fixture.availability,
			fixture.document.portEquipment,
			1,
			fixture.document.map.getRevision(),
			fixture.document.getPatchSequence(),
		);
		expect(fixture.document.commitPortEquipment(copy)).toBe(true);
		const availabilityWithCopy = new PortSlotAvailabilityIndex(
			compilePhysicalRail(fixture.document.map),
			fixture.document.portEquipment,
		);
		expect(
			planMoveOhbToSlot(
				fixture.slots,
				copiedRow,
				availabilityWithCopy,
				fixture.document.portEquipment,
				1,
				fixture.document.map.getRevision(),
				fixture.document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("available") });
	});
});

function placedOhbFixture(): {
	document: RailDocument;
	slots: ReturnType<typeof compilePortSlots>;
	availability: PortSlotAvailabilityIndex;
	sourceRow: number;
} {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 }))).toBe(
		true,
	);
	const layout = compilePhysicalRail(document.map);
	const slots = compilePortSlots(layout, document.portEquipment, "OHB");
	const sourceRow = legalRows(slots)[0] as number;
	const initialAvailability = new PortSlotAvailabilityIndex(layout, document.portEquipment);
	const placement = planOhbPlacement(
		slots,
		sourceRow,
		initialAvailability,
		document.portEquipment,
		document.map.getRevision(),
		document.getPatchSequence(),
	);
	expect(document.commitPortEquipment(placement)).toBe(true);
	return {
		document,
		slots,
		availability: new PortSlotAvailabilityIndex(layout, document.portEquipment),
		sourceRow,
	};
}

function legalRows(slots: ReturnType<typeof compilePortSlots>): number[] {
	const rows: number[] = [];
	for (let row = 0; row < slots.count; row++) {
		if ((slots.statuses[row] as number) === PORT_SLOT_STATUS.LEGAL) rows.push(row);
	}
	return rows;
}
