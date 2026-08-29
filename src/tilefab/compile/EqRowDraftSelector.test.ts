import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	EQ_PORT_PITCHES_MILLIMETERS,
	eqRowDraftCandidatesFromSlotIndex,
	eqRowDraftExceedsMaximum,
	selectEqRowDraft,
} from "./EqRowDraftSelector";
import { portRowDragBounds } from "./OhbRowDragSelector";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { PortEquipmentGroupSlotIndex } from "./PortEquipmentGroupEditPlanner";
import { planEqRowPlacement } from "./PortPlacementPlanner";
import {
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
	PortSlotSpatialIndex,
	portSlotRecord,
} from "./PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "./PortSlotPreparedArtifacts";

describe("EqRowDraftSelector", () => {
	it("treats the first legal port as an anchored draft instead of an error", () => {
		const document = straightDocument(8);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifactCatalog(physical).EQ;
		const slots = prepared.slots;
		const anchor = legalRows(slots)[1] as number;
		const selection = selectEqRowDraft(
			slots,
			new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "EQ"),
			anchor,
			anchor,
			new PortSlotSpatialIndex(slots, prepared.spatialIndex).query(
				portRowDragBounds(slots, anchor, anchor),
			),
			2_000,
		);

		expect(selection).toMatchObject({
			state: "ANCHORED",
			valid: false,
			rows: [anchor],
			blockedRows: [],
		});
	});

	it("selects pitch-spaced CENTER slots over one uninterrupted directed row", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifactCatalog(physical).EQ;
		const slots = prepared.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "EQ");
		const legal = legalRows(slots);
		const anchor = legal[1] as number;
		const target = legal[7] as number;
		const candidates = new PortSlotSpatialIndex(slots, prepared.spatialIndex).query(
			portRowDragBounds(slots, anchor, target),
		);

		const forward = selectEqRowDraft(slots, availability, anchor, target, candidates, 2_000);
		const backward = selectEqRowDraft(slots, availability, target, anchor, candidates, 2_000);

		expect(forward.valid, forward.reason).toBe(true);
		expect(forward.state).toBe("READY");
		expect(forward.rows).toHaveLength(4);
		expect(forward.rows[0]).toBe(anchor);
		expect(forward.rows.at(-1)).toBe(target);
		expect(backward.rows).toEqual([...forward.rows].reverse());
		expect(forward.blockedRows).toEqual([]);
		expect(forward.continuityRows).toHaveLength(7);
	});

	it("keeps every selected row visible and rejects the whole EQ when one port is occupied", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifactCatalog(physical).EQ;
		const slots = prepared.slots;
		const legal = legalRows(slots);
		const anchor = legal[1] as number;
		const occupiedRow = legal[3] as number;
		const target = legal[7] as number;
		const occupiedPort = portSlotRecord(slots, occupiedRow, 1, 1, "EQ-1-P01");
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [occupiedPort],
			equipmentGroups: [{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1] }],
		};
		const availability = new PortSlotAvailabilityIndex(physical, state, "EQ");
		const selection = selectEqRowDraft(
			slots,
			availability,
			anchor,
			target,
			new PortSlotSpatialIndex(slots, prepared.spatialIndex).query(
				portRowDragBounds(slots, anchor, target),
			),
			2_000,
		);

		expect(selection).toMatchObject({
			state: "BLOCKED",
			valid: false,
			reason: expect.stringContaining("충돌"),
			blockedRows: [occupiedRow],
		});
		expect(selection.rows).toHaveLength(4);
	});

	it("blocks an EQ body from crossing a FLEX STK reservation and its authored ports", () => {
		const document = straightDocument(10);
		const physical = compilePhysicalRail(document.map);
		const catalog = compilePortSlotPreparedArtifactCatalog(physical);
		const stkSlots = catalog.STK.slots;
		const stkRows = [4, 5].map((x) => stkSlots.routeXs.indexOf(x));
		const stkPorts = stkRows.map((row, index) =>
			portSlotRecord(stkSlots, row, index + 1, 1, `STK-1-P0${index + 1}`),
		);
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			ports: stkPorts,
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		};
		const slots = catalog.EQ.slots;
		const anchor = slots.routeXs.indexOf(2);
		const target = slots.routeXs.indexOf(7);
		const availability = new PortSlotAvailabilityIndex(physical, state, "EQ");
		expect(availability.statusFor(slots, anchor)).toEqual({
			status: PORT_SLOT_STATUS.LEGAL,
			conflictingPortId: 0,
			conflictingEquipmentGroupId: 0,
		});
		const selection = selectEqRowDraft(
			slots,
			availability,
			anchor,
			target,
			new PortSlotSpatialIndex(slots, catalog.EQ.spatialIndex).query(
				portRowDragBounds(slots, anchor, target),
			),
			5_000,
		);

		expect(availability.statusFor(slots, slots.routeXs.indexOf(4))).toMatchObject({
			status: PORT_SLOT_STATUS.PORT_OCCUPIED,
			conflictingEquipmentGroupId: 1,
		});
		expect(selection).toMatchObject({
			state: "BLOCKED",
			valid: false,
			reason: "EQ 배치 구간이 STK-1 점유 구간과 겹칩니다",
		});
	});

	it("can reselect the source EQ group while retaining normal occupancy checks", () => {
		const document = straightDocument(10);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifactCatalog(physical).EQ;
		const slots = prepared.slots;
		const sourceRows = [slots.routeXs.indexOf(2), slots.routeXs.indexOf(3)];
		const sourcePorts = sourceRows.map((row, index) =>
			portSlotRecord(slots, row, index + 1, 1, `EQ-1-P0${index + 1}`),
		);
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			ports: sourcePorts,
			equipmentGroups: [
				{
					id: 1,
					kind: "EQ",
					pitchMillimeters: 1_000,
					recipe: null,
					portIds: [1, 2],
				},
			],
		};
		const availability = new PortSlotAvailabilityIndex(physical, state, "EQ");
		const target = slots.routeXs.indexOf(4);
		const candidates = new PortSlotSpatialIndex(slots, prepared.spatialIndex).query(
			portRowDragBounds(slots, sourceRows[0] as number, target),
		);

		expect(
			selectEqRowDraft(slots, availability, sourceRows[0] as number, target, candidates, 1_000)
				.valid,
		).toBe(false);
		expect(
			selectEqRowDraft(slots, availability, sourceRows[0] as number, target, candidates, 1_000, 1),
		).toMatchObject({ valid: true, rows: { length: 3 } });
	});

	it("rebuilds source membership candidates without a renderer spatial binding", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifactCatalog(physical).EQ;
		const slots = prepared.slots;
		const sourceRows = [2, 3, 4, 5, 6, 7, 8, 9].map((x) => slots.routeXs.indexOf(x));
		const sourcePort = portSlotRecord(slots, sourceRows[1] as number, 1, 1, "EQ-1-P01");
		const candidates = eqRowDraftCandidatesFromSlotIndex(
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			sourcePort,
			sourceRows.at(-1) as number,
			sourceRows[0] as number,
		);

		expect(candidates).toHaveLength(8);
		expect(new Set(candidates)).toEqual(new Set(sourceRows));
		expect(
			selectEqRowDraft(
				slots,
				new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "EQ"),
				sourceRows.at(-1) as number,
				sourceRows[0] as number,
				candidates,
				1_000,
			),
		).toMatchObject({ valid: true, rows: { length: 8 } });
	});

	it("snaps an off-pitch pointer tail to the last complete EQ pitch", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifactCatalog(physical).EQ;
		const slots = prepared.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "EQ");
		const legal = legalRows(slots);
		const anchor = legal[1] as number;
		const target = legal[6] as number;
		const selection = selectEqRowDraft(
			slots,
			availability,
			anchor,
			target,
			new PortSlotSpatialIndex(slots, prepared.spatialIndex).query(
				portRowDragBounds(slots, anchor, target),
			),
			2_000,
		);

		expect(selection.valid, selection.reason).toBe(true);
		expect(selection.rows).toHaveLength(3);
		expect(selection.rows.at(-1)).not.toBe(target);
		expect(selection.continuityRows).toHaveLength(5);
		expect(
			planEqRowPlacement(
				slots,
				selection.rows,
				availability,
				emptyPortEquipmentState(),
				2_000,
				null,
				document.map.getRevision(),
				document.getPatchSequence(),
				selection.continuityRows,
			).valid,
		).toBe(true);
	});

	it("rejects invalid pitch, short rows, candidate gaps, wrong slot type, and stale generations", () => {
		const document = straightDocument(12);
		const physical = compilePhysicalRail(document.map);
		const catalog = compilePortSlotPreparedArtifactCatalog(physical);
		const slots = catalog.EQ.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "EQ");
		const legal = legalRows(slots);
		const anchor = legal[1] as number;
		const target = legal[6] as number;
		const candidates = new PortSlotSpatialIndex(slots, catalog.EQ.spatialIndex).query(
			portRowDragBounds(slots, anchor, target),
		);

		expect(selectEqRowDraft(slots, availability, anchor, target, candidates, 1_500)).toMatchObject({
			valid: false,
			reason: expect.stringContaining("1~5 m"),
		});
		expect(selectEqRowDraft(slots, availability, anchor, anchor, candidates, 1_000)).toMatchObject({
			valid: false,
			reason: expect.stringContaining("최소 2개"),
		});
		expect(
			selectEqRowDraft(
				slots,
				availability,
				anchor,
				target,
				candidates.filter(
					(row) =>
						slots.routeXs[row] !== slots.routeXs[anchor] + 2 ||
						slots.routeZs[row] !== slots.routeZs[anchor],
				),
				1_000,
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("빈 구간") });
		expect(
			selectEqRowDraft(
				catalog.OHB.slots,
				new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "OHB"),
				0,
				0,
				[],
				1_000,
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("EQ 슬롯") });

		expect(
			document.commit(planRailConstruction(document.map, { x: 12, y: 0 }, { x: 13, y: 0 })),
		).toBe(true);
		const nextPhysical = compilePhysicalRail(document.map);
		expect(
			selectEqRowDraft(
				slots,
				new PortSlotAvailabilityIndex(nextPhysical, emptyPortEquipmentState(), "EQ"),
				anchor,
				target,
				candidates,
				1_000,
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("세대") });
	});

	it("exposes only the supported whole-meter pitch catalog", () => {
		expect(EQ_PORT_PITCHES_MILLIMETERS).toEqual([1_000, 2_000, 3_000, 4_000, 5_000]);
	});

	it("rejects more than 64 ports before a long-row preview is accepted", () => {
		const document = straightDocument(80);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifactCatalog(physical).EQ;
		const slots = prepared.slots;
		const legal = legalRows(slots);
		const anchor = legal[0] as number;
		const target = legal[64] as number;

		expect(eqRowDraftExceedsMaximum(slots, anchor, target, 1_000)).toBe(true);
		expect(
			selectEqRowDraft(
				slots,
				new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "EQ"),
				anchor,
				target,
				new PortSlotSpatialIndex(slots, prepared.spatialIndex).query(
					portRowDragBounds(slots, anchor, target),
				),
				1_000,
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("최대 64개") });
	});
});

function straightDocument(lengthMeters: number): RailDocument {
	const document = new RailDocument();
	expect(
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: lengthMeters, y: 0 })),
	).toBe(true);
	return document;
}

function legalRows(
	slots: ReturnType<typeof compilePortSlotPreparedArtifactCatalog>["EQ"]["slots"],
): number[] {
	const rows: number[] = [];
	for (let row = 0; row < slots.count; row++) {
		if (slots.statuses[row] === PORT_SLOT_STATUS.LEGAL) rows.push(row);
	}
	return rows;
}
