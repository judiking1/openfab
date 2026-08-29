import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { TileMap } from "../core/TileMap";
import { planEqRowPlacement, planStkPlacement } from "./PortPlacementPlanner";
import {
	planPortEquipmentGroupEdit,
	PortEquipmentGroupSlotIndex,
	portEquipmentGroupSlotIndexFor,
} from "./PortEquipmentGroupEditPlanner";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { PortSlotAvailabilityIndex } from "./PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "./PortSlotPreparedArtifacts";

describe("PortEquipmentGroupEditPlanner", () => {
	it("moves a complete EQ group through a 180 degree rail rotation as one undoable patch", () => {
		const document = closedLoopDocument(13, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const placement = planEqRowPlacement(
			slots,
			[rowAt(slots, 2, 0), rowAt(slots, 3, 0), rowAt(slots, 4, 0)],
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1_000,
			"PHOTO",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(placement)).toBe(true);
		const before = document.portEquipment;
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));

		const plan = planPortEquipmentGroupEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			1,
			rowAt(slots, 9, 4),
			"move",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.groupEdit).toMatchObject({
			mode: "move",
			sourceEquipmentGroupId: 1,
			targetEquipmentGroupId: 1,
			quarterTurns: 2,
			portTargets: { length: 3 },
		});
		expect(plan.portMutations.map((mutation) => mutation.id)).toEqual([1, 2, 3]);
		expect(plan.portMutations.map((mutation) => mutation.after?.barcode)).toEqual([
			"EQ-1-P01",
			"EQ-1-P02",
			"EQ-1-P03",
		]);
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "edit-port-equipment",
			portChanges: { length: 3 },
		});
		expect(
			document.portEquipment.ports.map((port) =>
				port.route.kind === "CARDINAL_CELL"
					? [port.id, port.route.x, port.route.z, port.route.to]
					: [],
			),
		).toEqual([
			[1, 9, 4, 8],
			[2, 8, 4, 8],
			[3, 7, 4, 8],
		]);
		expect(document.undo()).toBe(true);
		expect(document.portEquipment).toEqual(before);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports[0]?.route).toEqual(plan.portMutations[0]?.after?.route);
	});

	it("copies an EQ group with fresh IDs and rejects an occupied source target", () => {
		const document = closedLoopDocument(15, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const placement = planEqRowPlacement(
			slots,
			[rowAt(slots, 2, 0), rowAt(slots, 3, 0), rowAt(slots, 4, 0)],
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1_000,
			null,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(placement)).toBe(true);
		const index = new PortEquipmentGroupSlotIndex(slots);
		const availability = new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ");
		expect(portEquipmentGroupSlotIndexFor(slots)).toBe(portEquipmentGroupSlotIndexFor(slots));

		const copy = planPortEquipmentGroupEdit(
			document.map,
			slots,
			index,
			availability,
			document.portEquipment,
			1,
			1,
			rowAt(slots, 9, 0),
			"copy",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(copy.valid, copy.reason).toBe(true);
		expect(copy).toMatchObject({
			kind: "place-eq",
			groupEdit: { sourceEquipmentGroupId: 1, targetEquipmentGroupId: 2 },
			portMutations: [
				{ id: 4, after: { equipmentGroupId: 2, barcode: "EQ-2-P01" } },
				{ id: 5, after: { equipmentGroupId: 2, barcode: "EQ-2-P02" } },
				{ id: 6, after: { equipmentGroupId: 2, barcode: "EQ-2-P03" } },
			],
			equipmentGroupMutations: [{ id: 2, after: { portIds: [4, 5, 6] } }],
		});
		expect(document.commitPortEquipment(copy)).toBe(true);
		expect(document.portEquipment).toMatchObject({
			nextPortId: 7,
			nextEquipmentGroupId: 3,
			ports: { length: 6 },
			equipmentGroups: { length: 2 },
		});

		const occupied = planPortEquipmentGroupEdit(
			document.map,
			slots,
			index,
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			1,
			rowAt(slots, 2, 0),
			"copy",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(occupied).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/conflicts with PORT-/),
			groupEdit: { portTargets: { length: 3 } },
		});
	});

	it("keeps hover validation local and reruns full layout validation before commit", () => {
		const document = closedLoopDocument(15, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const placement = planEqRowPlacement(
			slots,
			[rowAt(slots, 2, 0), rowAt(slots, 3, 0)],
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1_000,
			null,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(placement)).toBe(true);
		const index = portEquipmentGroupSlotIndexFor(slots);
		const availability = new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ");
		const detachedMap = new TileMap();
		const args = [
			detachedMap,
			slots,
			index,
			availability,
			document.portEquipment,
			1,
			1,
			rowAt(slots, 8, 0),
			"copy",
			document.map.getRevision(),
			document.getPatchSequence(),
		] as const;

		const preview = planPortEquipmentGroupEdit(...args, "preview");
		const commit = planPortEquipmentGroupEdit(...args, "commit");

		expect(preview.valid, preview.reason).toBe(true);
		expect(commit.valid).toBe(false);
		expect(commit.reason).toMatch(/rail|attach|route|connection/i);
	});

	it("moves an asymmetric FLEX STK while excluding every source port and its old body", () => {
		const document = closedLoopDocument(18, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const placement = planStkPlacement(
			slots,
			[rowAt(slots, 2, 0), rowAt(slots, 4, 0), rowAt(slots, 4, 4)],
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(placement.valid, placement.reason).toBe(true);
		expect(document.commitPortEquipment(placement)).toBe(true);
		const group = document.portEquipment.equipmentGroups[0];
		const anchorPortId = group?.portIds[0] as number;

		const plan = planPortEquipmentGroupEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			group?.id as number,
			anchorPortId,
			rowAt(slots, 3, 0),
			"move",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.groupEdit.portTargets).toHaveLength(3);
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(document.portEquipment.equipmentGroups[0]).toMatchObject({
			id: 1,
			kind: "STK",
			template: "FLEX",
			portIds: { length: 3 },
		});
		expect(document.undo()).toBe(true);
		expect(
			document.portEquipment.ports.map((port) =>
				port.route.kind === "CARDINAL_CELL" ? [port.route.x, port.route.z] : [],
			),
		).toEqual([
			[2, 0],
			[4, 0],
			[4, 4],
		]);
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
