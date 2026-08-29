import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	PortEquipmentGroupSlotIndex,
	portEquipmentGroupSlotIndexFor,
} from "./PortEquipmentGroupEditPlanner";
import { planPortEquipmentMembershipEdit } from "./PortEquipmentMembershipEditPlanner";
import { planEqRowPlacement, planStkPlacement } from "./PortPlacementPlanner";
import { PortSlotAvailabilityIndex } from "./PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "./PortSlotPreparedArtifacts";

describe("PortEquipmentMembershipEditPlanner", () => {
	it("adds and removes EQ stations atomically while retaining existing IDs and barcodes", () => {
		const document = closedLoopDocument(14, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const initialRows = [rowAt(slots, 2, 0), rowAt(slots, 3, 0), rowAt(slots, 4, 0)];
		const placement = planEqRowPlacement(
			slots,
			initialRows,
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1_000,
			"PHOTO",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(placement)).toBe(true);
		const initialPorts = document.portEquipment.ports;
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));

		const add = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			[...initialRows, rowAt(slots, 5, 0)],
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(add.valid, add.reason).toBe(true);
		expect(add.membershipEdit).toEqual({
			sourceEquipmentGroupId: 1,
			targetRows: [...initialRows, rowAt(slots, 5, 0)],
			retainedPortIds: [1, 2, 3],
			addedPortIds: [4],
			removedPortIds: [],
		});
		expect(add.portMutations).toMatchObject([
			{ id: 4, before: null, after: { id: 4, barcode: "EQ-1-PORT-4" } },
		]);
		expect(document.commitPortEquipment(add)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "edit-port-equipment",
			portChanges: { length: 1 },
			equipmentGroupChanges: { length: 1 },
		});
		expect(document.portEquipment.ports.slice(0, 3)).toEqual(initialPorts);

		const remove = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			[rowAt(slots, 2, 0), rowAt(slots, 3, 0)],
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(remove.valid, remove.reason).toBe(true);
		expect(remove.membershipEdit).toMatchObject({
			retainedPortIds: [1, 2],
			addedPortIds: [],
			removedPortIds: [3, 4],
		});
		expect(document.commitPortEquipment(remove)).toBe(true);
		expect(document.portEquipment.equipmentGroups[0]?.portIds).toEqual([1, 2]);
		expect(document.portEquipment.ports.map((port) => [port.id, port.barcode])).toEqual([
			[1, "EQ-1-P01"],
			[2, "EQ-1-P02"],
		]);
		expect(document.undo()).toBe(true);
		expect(document.portEquipment.equipmentGroups[0]?.portIds).toEqual([1, 2, 3, 4]);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.equipmentGroups[0]?.portIds).toEqual([1, 2]);
	});

	it("recomputes a sparse FLEX STK body and rejects another group's occupied station", () => {
		const document = closedLoopDocument(18, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const initialRows = [rowAt(slots, 2, 0), rowAt(slots, 4, 0), rowAt(slots, 4, 4)];
		const placement = planStkPlacement(
			slots,
			initialRows,
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(placement.valid, placement.reason).toBe(true);
		expect(document.commitPortEquipment(placement)).toBe(true);

		const edit = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			1,
			[...initialRows, rowAt(slots, 7, 0)],
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(edit.valid, edit.reason).toBe(true);
		expect(edit.membershipEdit).toMatchObject({
			retainedPortIds: [1, 2, 3],
			addedPortIds: [4],
			removedPortIds: [],
		});
		expect(document.commitPortEquipment(edit)).toBe(true);

		const second = planStkPlacement(
			slots,
			[rowAt(slots, 10, 0)],
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(second.valid, second.reason).toBe(true);
		expect(document.commitPortEquipment(second)).toBe(true);

		const conflict = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			1,
			[rowAt(slots, 2, 0), rowAt(slots, 10, 0)],
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(conflict).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/PORT-|equipment group/),
		});
	});

	it("rejects a no-op membership replacement", () => {
		const document = closedLoopDocument(10, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const rows = [rowAt(slots, 2, 0), rowAt(slots, 3, 0)];
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					rows,
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					null,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);

		const plan = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			rows,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(plan).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/different legal port membership/i),
		});
	});

	it("rejects EQ membership gaps and unsupported port counts before document commit", () => {
		const document = closedLoopDocument(72, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const initialRows = [rowAt(slots, 2, 0), rowAt(slots, 3, 0), rowAt(slots, 4, 0)];
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					initialRows,
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					null,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		const planFor = (rows: readonly number[]) =>
			planPortEquipmentMembershipEdit(
				document.map,
				slots,
				portEquipmentGroupSlotIndexFor(slots),
				new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
				document.portEquipment,
				1,
				rows,
				document.map.getRevision(),
				document.getPatchSequence(),
			);

		expect(planFor([rowAt(slots, 2, 0), rowAt(slots, 4, 0)])).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/pitch|피치|spacing/i),
		});
		expect(planFor([rowAt(slots, 2, 0)])).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/at least|최소|2/i),
		});
		expect(
			planFor(Array.from({ length: 65 }, (_, index) => rowAt(slots, index + 2, 0))),
		).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/64|maximum|최대/i),
		});
	});

	it("allocates new identities in canonical station order regardless of click order", () => {
		const document = closedLoopDocument(14, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const initialRows = [rowAt(slots, 4, 0), rowAt(slots, 5, 0)];
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					initialRows,
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					null,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		const targetRows = [rowAt(slots, 3, 0), ...initialRows, rowAt(slots, 6, 0)];
		const planFor = (rows: readonly number[]) =>
			planPortEquipmentMembershipEdit(
				document.map,
				slots,
				portEquipmentGroupSlotIndexFor(slots),
				new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
				document.portEquipment,
				1,
				rows,
				document.map.getRevision(),
				document.getPatchSequence(),
			);

		const forward = planFor(targetRows);
		const reversed = planFor([...targetRows].reverse());

		expect(forward.valid, forward.reason).toBe(true);
		expect(reversed.valid, reversed.reason).toBe(true);
		expect(reversed.membershipEdit).toEqual(forward.membershipEdit);
		expect(reversed.portMutations).toEqual(forward.portMutations);
		expect(reversed.equipmentGroupMutations).toEqual(forward.equipmentGroupMutations);
	});

	it("rejects same-revision slot indexes and availability prepared from different inputs", () => {
		const document = closedLoopDocument(10, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const rows = [rowAt(slots, 2, 0), rowAt(slots, 3, 0)];
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					rows,
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					null,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		const targetRows = [...rows, rowAt(slots, 4, 0)];
		const foreignSlots = Object.freeze({
			...slots,
			routeXs: slots.routeXs.slice(),
		});
		const foreignIndex = new PortEquipmentGroupSlotIndex(foreignSlots);
		const currentAvailability = new PortSlotAvailabilityIndex(
			physical,
			document.portEquipment,
			"EQ",
		);
		const mismatchedIndex = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			foreignIndex,
			currentAvailability,
			document.portEquipment,
			1,
			targetRows,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(mismatchedIndex).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/stale/i),
		});

		const copiedState = Object.freeze({
			...document.portEquipment,
			ports: Object.freeze([...document.portEquipment.ports]),
			equipmentGroups: Object.freeze([...document.portEquipment.equipmentGroups]),
		});
		const mismatchedAvailability = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, copiedState, "EQ"),
			document.portEquipment,
			1,
			targetRows,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(mismatchedAvailability).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/stale/i),
		});
	});
});

function closedLoopDocument(width: number, depth: number): RailDocument {
	const document = new RailDocument();
	for (const [start, end] of [
		[
			{ x: 0, y: 0 },
			{ x: width, y: 0 },
		],
		[
			{ x: width, y: 0 },
			{ x: width, y: depth },
		],
		[
			{ x: width, y: depth },
			{ x: 0, y: depth },
		],
		[
			{ x: 0, y: depth },
			{ x: 0, y: 0 },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	}
	return document;
}

function rowAt(
	slots: ReturnType<typeof compilePortSlotPreparedArtifactCatalog>["EQ"]["slots"],
	x: number,
	z: number,
): number {
	for (let row = 0; row < slots.count; row++) {
		if (slots.routeXs[row] === x && slots.routeZs[row] === z) return row;
	}
	throw new Error(`Missing ${slots.portType} slot at ${x},${z}.`);
}
