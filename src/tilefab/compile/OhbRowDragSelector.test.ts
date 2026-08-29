import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	findOhbRowDragTarget,
	ohbRowDragBounds,
	ohbRowDragTargetBounds,
	selectOhbRowDrag,
} from "./OhbRowDragSelector";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
	PortSlotSpatialIndex,
	portSlotRecord,
} from "./PortSlotCompiler";
import {
	compilePortSlotPreparedArtifactCatalog,
	compilePortSlotPreparedArtifacts,
	createPreparedPortSlotAvailabilityIndex,
} from "./PortSlotPreparedArtifacts";

describe("OhbRowDragSelector", () => {
	it("selects a continuous same-side cardinal row in gesture order", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const slots = prepared.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState());
		const sameSide = legalRows(slots).filter((row) => slots.sides[row] === 1);
		const anchor = sameSide[1] as number;
		const target = sameSide[6] as number;
		const index = new PortSlotSpatialIndex(slots, prepared.spatialIndex);
		const candidates = index.query(ohbRowDragBounds(slots, anchor, target));

		const forward = selectOhbRowDrag(slots, availability, anchor, target, candidates);
		const backward = selectOhbRowDrag(slots, availability, target, anchor, candidates);

		expect(forward.valid, forward.reason).toBe(true);
		expect(forward.rows).toHaveLength(6);
		expect(forward.rows[0]).toBe(anchor);
		expect(forward.rows.at(-1)).toBe(target);
		expect(backward.rows).toEqual([...forward.rows].reverse());
		expect(forward.skippedRows).toEqual([]);
	});

	it("skips occupied stations without joining a different rail row", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const slots = prepared.slots;
		const sameSide = legalRows(slots).filter((row) => slots.sides[row] === 1);
		const anchor = sameSide[1] as number;
		const occupiedRow = sameSide[3] as number;
		const target = sameSide[6] as number;
		const occupiedPort = portSlotRecord(slots, occupiedRow, 1, 1, "OHB-1");
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [occupiedPort],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const availability = new PortSlotAvailabilityIndex(physical, state);
		const index = new PortSlotSpatialIndex(slots, prepared.spatialIndex);
		const selection = selectOhbRowDrag(
			slots,
			availability,
			anchor,
			target,
			index.query(ohbRowDragBounds(slots, anchor, target)),
		);

		expect(selection.valid, selection.reason).toBe(true);
		expect(selection.rows).toHaveLength(5);
		expect(selection.rows).not.toContain(occupiedRow);
		expect(selection.skippedRows).toEqual([occupiedRow]);
		expect(selection.reason).toContain("충돌 1개 제외");
	});

	it("skips the rail span reserved between sparse FLEX STK ports", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const catalog = compilePortSlotPreparedArtifactCatalog(physical);
		const stkSlots = catalog.STK.slots;
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 8,
			ports: [4, 5].map((x, index) =>
				portSlotRecord(stkSlots, stkSlots.routeXs.indexOf(x), index + 1, 7, `STK-7-P0${index + 1}`),
			),
			equipmentGroups: [{ id: 7, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		};
		const slots = catalog.OHB.slots;
		const sameSide = legalRows(slots).filter((row) => slots.sides[row] === 1);
		const anchor = sameSide.find((row) => slots.routeXs[row] === 2) as number;
		const target = sameSide.find((row) => slots.routeXs[row] === 8) as number;
		const selection = selectOhbRowDrag(
			slots,
			new PortSlotAvailabilityIndex(physical, state, "OHB"),
			anchor,
			target,
			new PortSlotSpatialIndex(slots, catalog.OHB.spatialIndex).query(
				ohbRowDragBounds(slots, anchor, target),
			),
		);

		expect(selection.valid, selection.reason).toBe(true);
		expect(selection.conflictingEquipmentGroupIds).toEqual([7]);
		expect(selection.skippedRows).toHaveLength(2);
		expect(selection.rows).toHaveLength(5);
		expect(selection.reason).toContain("STK-7 점유 구간");
	});

	it("rejects an OHB drag that starts inside a FLEX STK reservation", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const catalog = compilePortSlotPreparedArtifactCatalog(physical);
		const stkSlots = catalog.STK.slots;
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 8,
			ports: [4, 5].map((x, index) =>
				portSlotRecord(stkSlots, stkSlots.routeXs.indexOf(x), index + 1, 7, `STK-7-P0${index + 1}`),
			),
			equipmentGroups: [{ id: 7, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		};
		const slots = catalog.OHB.slots;
		const sameSide = legalRows(slots).filter((row) => slots.sides[row] === 1);
		const anchor = sameSide.find((row) => slots.routeXs[row] === 4) as number;
		const target = sameSide.find((row) => slots.routeXs[row] === 8) as number;
		const candidates = new PortSlotSpatialIndex(slots, catalog.OHB.spatialIndex).query(
			ohbRowDragBounds(slots, anchor, target),
		);
		const selection = selectOhbRowDrag(
			slots,
			new PortSlotAvailabilityIndex(physical, state, "OHB"),
			anchor,
			target,
			candidates,
		);

		expect(selection.valid).toBe(false);
		expect(selection.reason).toContain("STK-7 점유 구간");
		expect(selection.conflictingEquipmentGroupIds).toEqual([7]);
		expect(selection.skippedRows).toEqual([]);
	});

	it("rejects the opposite side and a candidate gap", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const slots = prepared.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState());
		const legal = legalRows(slots);
		const anchor = legal.find((row) => slots.sides[row] === 1) as number;
		const opposite = legal.find(
			(row) =>
				slots.routeXs[row] === slots.routeXs[anchor] &&
				slots.routeZs[row] === slots.routeZs[anchor] &&
				slots.sides[row] === 2,
		) as number;
		const sameSide = legal.filter((row) => slots.sides[row] === 1);
		const target = sameSide[4] as number;
		const candidates = new PortSlotSpatialIndex(slots, prepared.spatialIndex).query(
			ohbRowDragBounds(slots, anchor, target),
		);

		expect(selectOhbRowDrag(slots, availability, anchor, opposite, candidates)).toMatchObject({
			valid: false,
			reason: expect.stringContaining("같은 레일 측면"),
		});
		expect(
			selectOhbRowDrag(
				slots,
				availability,
				anchor,
				target,
				candidates.filter((row) => slots.routeXs[row] !== slots.routeXs[anchor] + 2),
			),
		).toMatchObject({
			valid: false,
			reason: expect.stringContaining("빈 구간"),
		});
	});

	it("rejects a prepared row whose availability inputs changed after binding", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const slots = prepared.slots;
		const row = legalRows(slots)[0] as number;
		const availability = createPreparedPortSlotAvailabilityIndex(
			physical,
			prepared,
			document.portEquipment,
		);
		expect(selectOhbRowDrag(slots, availability, row, row, [row]).valid).toBe(true);

		const routeX = slots.routeXs[row] as number;
		slots.routeXs[row] = routeX + 1;
		expect(selectOhbRowDrag(slots, availability, row, row, [row])).toMatchObject({
			valid: false,
			rows: [],
			reason: expect.stringContaining("배치 가능한 OHB 슬롯"),
		});
		slots.routeXs[row] = routeX;
	});

	it("locks the pointer-down side while projecting off-axis pointer drift", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical);
		const slots = prepared.slots;
		const index = new PortSlotSpatialIndex(slots, prepared.spatialIndex);
		const sameSide = legalRows(slots).filter((row) => slots.sides[row] === 1);
		const anchor = sameSide[1] as number;
		const expected = sameSide[5] as number;
		const opposite = legalRows(slots).find(
			(row) =>
				slots.routeXs[row] === slots.routeXs[expected] &&
				slots.routeZs[row] === slots.routeZs[expected] &&
				slots.sides[row] !== slots.sides[expected],
		) as number;
		const pointer = {
			x: slots.worldPositions[opposite * 2] as number,
			y: slots.worldPositions[opposite * 2 + 1] as number,
		};
		const candidates = index.query(ohbRowDragTargetBounds(pointer));

		expect(findOhbRowDragTarget(slots, anchor, pointer, candidates)).toBe(expected);
		const tangentX = slots.tangents[expected * 2] as number;
		const tangentZ = slots.tangents[expected * 2 + 1] as number;
		expect(
			findOhbRowDragTarget(
				slots,
				anchor,
				{
					x: (slots.worldPositions[expected * 2] as number) - tangentZ * 2,
					y: (slots.worldPositions[expected * 2 + 1] as number) + tangentX * 2,
				},
				candidates,
			),
		).toBeNull();
	});
});

function straightDocument(lengthMeters: number): RailDocument {
	const document = new RailDocument();
	expect(
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: lengthMeters, y: 0 })),
	).toBe(true);
	return document;
}

function legalRows(slots: ReturnType<typeof compilePortSlotPreparedArtifacts>["slots"]): number[] {
	const rows: number[] = [];
	for (let row = 0; row < slots.count; row++) {
		if (slots.statuses[row] === PORT_SLOT_STATUS.LEGAL) rows.push(row);
	}
	return rows;
}
