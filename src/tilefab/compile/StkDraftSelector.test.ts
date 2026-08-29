import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
	PortSlotSpatialIndex,
} from "./PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "./PortSlotPreparedArtifacts";
import { evaluateStkDraftSelection, toggleStkDraftRow } from "./StkDraftSelector";

describe("StkDraftSelector", () => {
	it("accumulates an unordered four-port row and canonicalizes only when complete", () => {
		const document = straightDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK");
		const rows = [rowAt(slots, 4, 0), rowAt(slots, 2, 0), rowAt(slots, 3, 0), rowAt(slots, 5, 0)];
		let selection = evaluateStkDraftSelection(slots, availability, [], "FOUR_PORT");

		for (const row of rows)
			selection = toggleStkDraftRow(slots, availability, selection.rows, row, "FOUR_PORT");

		expect(selection.valid, selection.reason).toBe(true);
		expect(selection.canComplete, selection.reason).toBe(true);
		expect(selection.orderedRows.map((row) => slots.routeXs[row])).toEqual([2, 3, 4, 5]);
	});

	it("toggles an accepted row off and rejects a second lane for a single-row template", () => {
		const document = loopDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK");
		const first = rowAt(slots, 2, 0);
		const secondLane = rowAt(slots, 2, 3);
		const selected = toggleStkDraftRow(slots, availability, [], first, "FOUR_PORT");
		const rejected = toggleStkDraftRow(slots, availability, selected.rows, secondLane, "FOUR_PORT");

		expect(rejected.rows).toEqual([first]);
		expect(rejected.rejectedRow).toBe(secondLane);
		expect(rejected.reason).toContain("하나의 직선 레일 행");
		expect(toggleStkDraftRow(slots, availability, selected.rows, first, "FOUR_PORT").rows).toEqual(
			[],
		);
	});

	it("completes aligned opposite-direction back-to-back pairs", () => {
		const document = loopDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK");
		const rows = [rowAt(slots, 2, 0), rowAt(slots, 3, 0), rowAt(slots, 3, 3), rowAt(slots, 2, 3)];
		const selection = evaluateStkDraftSelection(slots, availability, rows, "BACK_TO_BACK");

		expect(selection.valid, selection.reason).toBe(true);
		expect(selection.canComplete, selection.reason).toBe(true);
		expect(selection.laneCount).toBe(2);
		expect(selection.orderedRows).toHaveLength(4);
	});

	it("completes an odd asymmetric two-lane FLEX group", () => {
		const document = loopDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK");
		const rows = [
			rowAt(slots, 2, 0),
			rowAt(slots, 4, 0),
			rowAt(slots, 7, 0),
			rowAt(slots, 6, 3),
			rowAt(slots, 3, 3),
		];
		const selection = evaluateStkDraftSelection(slots, availability, rows, "FLEX");

		expect(selection.valid, selection.reason).toBe(true);
		expect(selection.canComplete, selection.reason).toBe(true);
		expect(selection.rows).toHaveLength(5);
		expect(selection.laneCount).toBe(2);
		expect(selection.reason).toBe("FLEX · 5 PORT");
	});

	it("previews sparse FLEX occupancy as connected rail-run sections", () => {
		const document = straightDocument();
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifactCatalog(physical).STK;
		const slots = prepared.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK");
		const rows = [rowAt(slots, 2, 0), rowAt(slots, 6, 0)];
		const spatialIndex = new PortSlotSpatialIndex(slots, prepared.spatialIndex);
		const connected = evaluateStkDraftSelection(
			slots,
			availability,
			rows,
			"FLEX",
			(bounds, target) => spatialIndex.query(bounds, target),
		);
		const disconnected = evaluateStkDraftSelection(
			slots,
			availability,
			rows,
			"FLEX",
			(_bounds, target) => {
				target.length = 0;
				target.push(...rows);
				return target;
			},
		);

		expect(connected.laneRows).toEqual([rows]);
		expect(disconnected.laneRows).toEqual([[rows[0]], [rows[1]]]);
	});

	it("does not claim unselected cells between sparse FLEX ports as body", () => {
		const document = straightDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK");
		const middle = rowAt(slots, 4, 0);
		slots.statuses[middle] = PORT_SLOT_STATUS.ATTACHMENT_INVALID;

		const selection = evaluateStkDraftSelection(
			slots,
			availability,
			[rowAt(slots, 2, 0), rowAt(slots, 6, 0)],
			"FLEX",
		);

		expect(selection.valid, selection.reason).toBe(true);
		expect(selection.canComplete, selection.reason).toBe(true);
	});

	it("rejects a sparse FLEX span that crosses an existing STK reservation", () => {
		const document = straightDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const occupied: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [
				{
					id: 1,
					equipmentGroupId: 1,
					route: { kind: "CARDINAL_CELL", x: 4, z: 0, from: DIR_W, to: DIR_E },
					stationMillimeters: 500,
					side: "CENTER",
					lateralOffsetMillimeters: 0,
					direction: "WITH_TRAVEL",
					portType: "STK",
					barcode: "STK-1-P01",
				},
			],
			equipmentGroups: [{ id: 1, kind: "STK", template: "CUSTOM", portIds: [1] }],
		};

		const selection = evaluateStkDraftSelection(
			slots,
			new PortSlotAvailabilityIndex(physical, occupied, "STK"),
			[rowAt(slots, 2, 0), rowAt(slots, 6, 0)],
			"FLEX",
		);

		expect(selection.valid).toBe(false);
		expect(selection.canComplete).toBe(false);
		expect(selection.reason).toContain("STK-1 예약 구간");
	});

	it("can reselect the source STK group without ignoring other groups", () => {
		const document = straightDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const sourceRows = [rowAt(slots, 2, 0), rowAt(slots, 4, 0)];
		const sourcePorts = sourceRows.map((row, index) => ({
			id: index + 1,
			equipmentGroupId: 1,
			route: {
				kind: "CARDINAL_CELL" as const,
				x: slots.routeXs[row] as number,
				z: slots.routeZs[row] as number,
				from: slots.routeFromDirections[row] as typeof DIR_W,
				to: slots.routeToDirections[row] as typeof DIR_E,
			},
			stationMillimeters: slots.stationMillimeters[row] as number,
			side: "CENTER" as const,
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL" as const,
			portType: "STK" as const,
			barcode: `STK-1-P0${index + 1}`,
		}));
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			ports: sourcePorts,
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		};
		const availability = new PortSlotAvailabilityIndex(physical, state, "STK");

		expect(evaluateStkDraftSelection(slots, availability, sourceRows, "FLEX").valid).toBe(false);
		expect(
			evaluateStkDraftSelection(slots, availability, sourceRows, "FLEX", null, 1),
		).toMatchObject({ valid: true, canComplete: true });
	});

	it("rejects interleaving FLEX groups even when their endpoint ports do not conflict", () => {
		const document = straightDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const existingRows = [rowAt(slots, 4, 0), rowAt(slots, 5, 0)];
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 8,
			ports: existingRows.map((row, index) => ({
				id: index + 1,
				equipmentGroupId: 7,
				route: {
					kind: "CARDINAL_CELL" as const,
					x: slots.routeXs[row] as number,
					z: slots.routeZs[row] as number,
					from: slots.routeFromDirections[row] as typeof DIR_W,
					to: slots.routeToDirections[row] as typeof DIR_E,
				},
				stationMillimeters: slots.stationMillimeters[row] as number,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "STK" as const,
				barcode: `STK-7-P0${index + 1}`,
			})),
			equipmentGroups: [{ id: 7, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		};

		const selection = evaluateStkDraftSelection(
			slots,
			new PortSlotAvailabilityIndex(physical, state, "STK"),
			[rowAt(slots, 2, 0), rowAt(slots, 7, 0)],
			"FLEX",
		);

		expect(selection.valid).toBe(false);
		expect(selection.canComplete).toBe(false);
		expect(selection.reason).toContain("STK-7 예약 구간");
	});

	it("names the existing FLEX group selected directly as a new STK port", () => {
		const document = straightDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const occupiedRow = rowAt(slots, 4, 0);
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 8,
			ports: [
				{
					id: 1,
					equipmentGroupId: 7,
					route: {
						kind: "CARDINAL_CELL",
						x: 4,
						z: 0,
						from: DIR_W,
						to: DIR_E,
					},
					stationMillimeters: slots.stationMillimeters[occupiedRow] as number,
					side: "CENTER",
					lateralOffsetMillimeters: 0,
					direction: "WITH_TRAVEL",
					portType: "STK",
					barcode: "STK-7-P01",
				},
			],
			equipmentGroups: [{ id: 7, kind: "STK", template: "FLEX", portIds: [1] }],
		};

		const selection = evaluateStkDraftSelection(
			slots,
			new PortSlotAvailabilityIndex(physical, state, "STK"),
			[occupiedRow],
			"FLEX",
		);

		expect(selection.valid).toBe(false);
		expect(selection.reason).toBe("이미 STK 포트 #1이 이 슬롯을 사용하고 있습니다");
	});

	it("completes one FLEX group across perpendicular rails and distant Bays", () => {
		const document = multiAxisDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const selection = evaluateStkDraftSelection(
			slots,
			new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK"),
			[rowAt(slots, 2, 0), rowAt(slots, 6, 0), rowAt(slots, 9, 2), rowAt(slots, 9, 6)],
			"FLEX",
		);

		expect(selection.valid, selection.reason).toBe(true);
		expect(selection.canComplete, selection.reason).toBe(true);
		expect(selection.laneCount).toBe(2);
		expect(selection.rows).toHaveLength(4);
	});

	it("rejects a same-direction second back-to-back lane without losing accepted rows", () => {
		const document = loopDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const availability = new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK");
		const firstLane = [rowAt(slots, 2, 0), rowAt(slots, 3, 0)];
		const secondLane = rowAt(slots, 2, 3);
		slots.routeFromDirections[secondLane] = slots.routeFromDirections[
			firstLane[0] as number
		] as number;
		slots.routeToDirections[secondLane] = slots.routeToDirections[firstLane[0] as number] as number;

		const rejected = toggleStkDraftRow(slots, availability, firstLane, secondLane, "BACK_TO_BACK");

		expect(rejected.rows).toEqual(firstLane);
		expect(rejected.rejectedRow).toBe(secondLane);
		expect(rejected.reason).toContain("서로 반대 방향");
	});

	it("keeps incomplete gaps editable but disables Complete", () => {
		const document = straightDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const selection = evaluateStkDraftSelection(
			slots,
			new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK"),
			[rowAt(slots, 2, 0), rowAt(slots, 3, 0), rowAt(slots, 4, 0), rowAt(slots, 6, 0)],
			"FOUR_PORT",
		);

		expect(selection.valid).toBe(true);
		expect(selection.canComplete).toBe(false);
		expect(selection.reason).toContain("consecutive");
	});

	it("preserves lane identity while a back-to-back draft is incomplete", () => {
		const document = loopDocument();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const selection = evaluateStkDraftSelection(
			slots,
			new PortSlotAvailabilityIndex(physical, emptyPortEquipmentState(), "STK"),
			[rowAt(slots, 3, 3), rowAt(slots, 2, 0), rowAt(slots, 3, 0)],
			"BACK_TO_BACK",
		);

		expect(selection.valid).toBe(true);
		expect(selection.canComplete).toBe(false);
		expect(selection.laneRows).toHaveLength(2);
		expect(selection.laneRows.flat()).toHaveLength(3);
	});
});

function straightDocument(): RailDocument {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 9, y: 0 }))).toBe(
		true,
	);
	return document;
}

function loopDocument(): RailDocument {
	const document = new RailDocument();
	for (const [start, end] of [
		[
			{ x: 0, y: 0 },
			{ x: 9, y: 0 },
		],
		[
			{ x: 9, y: 0 },
			{ x: 9, y: 3 },
		],
		[
			{ x: 9, y: 3 },
			{ x: 0, y: 3 },
		],
		[
			{ x: 0, y: 3 },
			{ x: 0, y: 0 },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	}
	return document;
}

function multiAxisDocument(): RailDocument {
	const document = new RailDocument();
	for (const [start, end] of [
		[
			{ x: 0, y: 0 },
			{ x: 9, y: 0 },
		],
		[
			{ x: 9, y: 0 },
			{ x: 9, y: 9 },
		],
		[
			{ x: 9, y: 9 },
			{ x: 0, y: 9 },
		],
		[
			{ x: 0, y: 9 },
			{ x: 0, y: 0 },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	}
	return document;
}

function rowAt(
	slots: ReturnType<typeof compilePortSlotPreparedArtifactCatalog>["STK"]["slots"],
	x: number,
	z: number,
): number {
	for (let row = 0; row < slots.count; row++) {
		if (slots.routeXs[row] === x && slots.routeZs[row] === z) return row;
	}
	throw new Error(`Missing STK slot at ${x},${z}.`);
}
