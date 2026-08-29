import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction, planRailErase } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	planEqRowPlacement,
	planOhbPlacement,
	planOhbRowPlacement,
	planStkPlacement,
} from "./PortPlacementPlanner";
import { compilePortSlots, PORT_SLOT_STATUS, PortSlotAvailabilityIndex } from "./PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "./PortSlotPreparedArtifacts";

describe("PortPlacementPlanner", () => {
	it("plans and commits one click as one reciprocal port/OHB command", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlots(layout, document.portEquipment, "OHB");
		const row = legalRows(slots)[0] as number;
		const availability = new PortSlotAvailabilityIndex(layout, document.portEquipment);
		const plan = planOhbPlacement(
			slots,
			row,
			availability,
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(document.portEquipment).toMatchObject({
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [{ id: 1, equipmentGroupId: 1, portType: "OHB", barcode: "OHB-1" }],
			equipmentGroups: [{ id: 1, kind: "OHB", portIds: [1] }],
		});
		const repeated = planOhbPlacement(
			slots,
			row,
			new PortSlotAvailabilityIndex(layout, document.portEquipment),
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(repeated).toMatchObject({
			valid: false,
			reason: expect.stringContaining("not currently available"),
		});
	});

	it("plans a drag row as independent one-port OHB groups with monotonic ids", () => {
		const document = straightDocument();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const slots = compilePortSlots(
			compilePhysicalRail(document.map),
			emptyPortEquipmentState(),
			"OHB",
		);
		const rows = legalRows(slots)
			.filter((row) => slots.sides[row] === 1)
			.slice(0, 3);
		const availability = new PortSlotAvailabilityIndex(
			compilePhysicalRail(document.map),
			document.portEquipment,
		);
		const plan = planOhbRowPlacement(
			slots,
			rows,
			availability,
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.portMutations.map((change) => change.id)).toEqual([1, 2, 3]);
		expect(plan.equipmentGroupMutations.map((change) => change.id)).toEqual([1, 2, 3]);
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(document.portEquipment.equipmentGroups.map((group) => group.portIds)).toEqual([
			[1],
			[2],
			[3],
		]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "place-ohb",
			portChanges: { length: 3 },
			equipmentGroupChanges: { length: 3 },
		});
		expect(document.undo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.portEquipment.equipmentGroups).toHaveLength(0);
		expect(events.at(-1)).toMatchObject({ kind: "undo", portChanges: { length: 3 } });
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(3);
		expect(events.at(-1)).toMatchObject({ kind: "redo", portChanges: { length: 3 } });
	});

	it("rejects a batch when another static command changes the patch sequence", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlots(layout, document.portEquipment, "OHB");
		const rows = legalRows(slots).filter((row) => slots.sides[row] === 1);
		const first = planOhbPlacement(
			slots,
			rows[0] as number,
			new PortSlotAvailabilityIndex(layout, document.portEquipment),
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(first)).toBe(true);
		const stale = planOhbPlacement(
			slots,
			rows[2] as number,
			new PortSlotAvailabilityIndex(layout, document.portEquipment),
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(stale.valid, stale.reason).toBe(true);

		expect(document.undo()).toBe(true);
		expect(document.commitPortEquipment(stale)).toBe(false);
		expect(document.portEquipment.ports).toHaveLength(0);
	});

	it("rejects ports that conflict with another row inside the same batch", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlots(layout, document.portEquipment, "OHB");
		const rows = legalRows(slots)
			.filter((row) => slots.sides[row] === 1)
			.slice(0, 2);
		const worldPositions = slots.worldPositions.slice();
		worldPositions[(rows[1] as number) * 2] =
			(worldPositions[(rows[0] as number) * 2] as number) + 0.25;
		worldPositions[(rows[1] as number) * 2 + 1] = worldPositions[
			(rows[0] as number) * 2 + 1
		] as number;
		const conflictingSlots = Object.freeze({ ...slots, worldPositions });
		const plan = planOhbRowPlacement(
			conflictingSlots,
			rows,
			new PortSlotAvailabilityIndex(layout, document.portEquipment),
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan).toMatchObject({
			valid: false,
			reason: expect.stringContaining("inside this batch"),
		});
		expect(document.portEquipment.ports).toHaveLength(0);
	});

	it("rejects stale, repeated, and invalid slot rows before document mutation", () => {
		const document = straightDocument();
		const slots = compilePortSlots(
			compilePhysicalRail(document.map),
			emptyPortEquipmentState(),
			"OHB",
		);
		const legal = legalRows(slots)[0] as number;
		const invalid = slots.statuses.indexOf(PORT_SLOT_STATUS.UNSAFE_APPROACH);
		const availability = new PortSlotAvailabilityIndex(
			compilePhysicalRail(document.map),
			document.portEquipment,
		);

		expect(
			planOhbPlacement(
				slots,
				legal,
				availability,
				document.portEquipment,
				document.map.getRevision() + 1,
				document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("stale") });
		expect(
			planOhbRowPlacement(
				slots,
				[legal, legal],
				availability,
				document.portEquipment,
				document.map.getRevision(),
				document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("repeated") });
		expect(
			planOhbPlacement(
				slots,
				invalid,
				availability,
				document.portEquipment,
				document.map.getRevision(),
				document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("not legal") });
		expect(document.portEquipment.ports).toHaveLength(0);
	});

	it("creates one ordered multi-port EQ group as one command and one worker patch", () => {
		const document = straightDocument();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(layout).EQ.slots;
		const rows = legalRows(slots).slice(1, 5).reverse();
		const plan = planEqRowPlacement(
			slots,
			rows,
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "EQ"),
			document.portEquipment,
			1_000,
			"PHOTO",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.portMutations.map((change) => change.id)).toEqual([1, 2, 3, 4]);
		const routeXs = plan.portMutations.map((change) => {
			const route = change.after?.route;
			expect(route?.kind).toBe("CARDINAL_CELL");
			return route?.kind === "CARDINAL_CELL" ? route.x : Number.NaN;
		});
		expect(routeXs).toEqual([...routeXs].sort((left, right) => left - right));
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(document.portEquipment).toMatchObject({
			nextPortId: 5,
			nextEquipmentGroupId: 2,
			ports: [
				{ id: 1, equipmentGroupId: 1, portType: "EQ", barcode: "EQ-1-P01" },
				{ id: 2, equipmentGroupId: 1, portType: "EQ", barcode: "EQ-1-P02" },
				{ id: 3, equipmentGroupId: 1, portType: "EQ", barcode: "EQ-1-P03" },
				{ id: 4, equipmentGroupId: 1, portType: "EQ", barcode: "EQ-1-P04" },
			],
			equipmentGroups: [
				{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: "PHOTO", portIds: [1, 2, 3, 4] },
			],
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "place-eq",
			portChanges: { length: 4 },
			equipmentGroupChanges: { length: 1 },
		});
		expect(document.undo()).toBe(true);
		expect(document.portEquipment).toMatchObject({ ports: [], equipmentGroups: [] });
		expect(events.at(-1)).toMatchObject({ kind: "undo", portChanges: { length: 4 } });
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(4);
		expect(events.at(-1)).toMatchObject({ kind: "redo", portChanges: { length: 4 } });
	});

	it("rejects malformed or occupied EQ rows before document mutation", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const catalog = compilePortSlotPreparedArtifactCatalog(layout);
		const slots = catalog.EQ.slots;
		const rows = legalRows(slots).slice(1, 4);
		const availability = new PortSlotAvailabilityIndex(layout, document.portEquipment, "EQ");
		const args = [
			availability,
			document.portEquipment,
			1_000,
			null,
			document.map.getRevision(),
			document.getPatchSequence(),
		] as const;

		expect(planEqRowPlacement(catalog.OHB.slots, rows, ...args)).toMatchObject({
			valid: false,
			reason: expect.stringContaining("requires EQ"),
		});
		expect(
			planEqRowPlacement(
				slots,
				rows.slice(0, 1),
				availability,
				document.portEquipment,
				1_000,
				null,
				document.map.getRevision(),
				document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("at least two") });
		expect(
			planEqRowPlacement(slots, [rows[0] as number, rows[0] as number], ...args),
		).toMatchObject({ valid: false, reason: expect.stringContaining("repeated") });
		expect(
			planEqRowPlacement(
				slots,
				rows,
				availability,
				document.portEquipment,
				1_500,
				null,
				document.map.getRevision(),
				document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("whole meters") });
		expect(
			planEqRowPlacement(
				slots,
				rows,
				availability,
				document.portEquipment,
				1_000,
				" PHOTO ",
				document.map.getRevision(),
				document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("trimmed") });

		const occupiedPort = planEqRowPlacement(slots, rows.slice(0, 2), ...args).portMutations[0]
			?.after;
		if (!occupiedPort) throw new Error("Expected the EQ fixture port.");
		expect(occupiedPort.id).toBe(1);
		const occupiedState: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [occupiedPort],
			equipmentGroups: [{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1] }],
		};
		expect(
			planEqRowPlacement(
				slots,
				rows.slice(0, 2),
				new PortSlotAvailabilityIndex(layout, occupiedState, "EQ"),
				occupiedState,
				1_000,
				null,
				document.map.getRevision(),
				document.getPatchSequence(),
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("not currently available") });
		expect(document.portEquipment.ports).toHaveLength(0);
	});

	it("requires a bounded proof for every intermediate 1 m cell at wider EQ pitch", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(layout).EQ.slots;
		const legal = legalRows(slots);
		const selectedRows = [legal[1] as number, legal[3] as number];
		const continuityRows = legal.slice(1, 4);
		const args = [
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "EQ"),
			document.portEquipment,
			2_000,
			null,
			document.map.getRevision(),
			document.getPatchSequence(),
		] as const;

		expect(planEqRowPlacement(slots, selectedRows, ...args)).toMatchObject({
			valid: false,
			reason: expect.stringContaining("cannot cross"),
		});
		expect(planEqRowPlacement(slots, selectedRows, ...args, continuityRows)).toMatchObject({
			valid: true,
			portMutations: { length: 2 },
		});
	});

	it("commits one unordered four-port STK as one canonical command and patch", () => {
		const document = straightDocument();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(layout).STK.slots;
		const rows = [rowAt(slots, 4, 0), rowAt(slots, 2, 0), rowAt(slots, 5, 0), rowAt(slots, 3, 0)];
		const plan = planStkPlacement(
			slots,
			rows,
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "STK"),
			document.portEquipment,
			"FOUR_PORT",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.portMutations.map((change) => change.after?.barcode)).toEqual([
			"STK-1-P01",
			"STK-1-P02",
			"STK-1-P03",
			"STK-1-P04",
		]);
		expect(
			plan.portMutations.map((change) => {
				const route = change.after?.route;
				return route?.kind === "CARDINAL_CELL" ? route.x : Number.NaN;
			}),
		).toEqual([2, 3, 4, 5]);
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(document.portEquipment.equipmentGroups).toEqual([
			{ id: 1, kind: "STK", template: "FOUR_PORT", portIds: [1, 2, 3, 4] },
		]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "place-stk",
			portChanges: { length: 4 },
			equipmentGroupChanges: { length: 1 },
		});
		expect(document.undo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(4);
	});

	it("accepts paired back-to-back lanes and rejects incomplete or gapped templates", () => {
		const document = closedLoopDocument();
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(layout).STK.slots;
		const availability = new PortSlotAvailabilityIndex(layout, document.portEquipment, "STK");
		const args = [
			availability,
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		] as const;
		const pairedRows = [
			rowAt(slots, 2, 0),
			rowAt(slots, 3, 0),
			rowAt(slots, 3, 3),
			rowAt(slots, 2, 3),
		];

		expect(
			planStkPlacement(slots, pairedRows, args[0], args[1], "BACK_TO_BACK", args[2], args[3]),
		).toMatchObject({
			valid: true,
			portMutations: { length: 4 },
		});
		expect(
			planStkPlacement(
				slots,
				pairedRows.slice(0, 3),
				args[0],
				args[1],
				"BACK_TO_BACK",
				args[2],
				args[3],
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("even port count") });
		expect(
			planStkPlacement(
				slots,
				[rowAt(slots, 2, 0), rowAt(slots, 3, 0), rowAt(slots, 4, 0), rowAt(slots, 6, 0)],
				args[0],
				args[1],
				"FOUR_PORT",
				args[2],
				args[3],
			),
		).toMatchObject({ valid: false, reason: expect.stringContaining("consecutive") });
	});

	it("commits an odd asymmetric two-lane FLEX STK as one atomic group", () => {
		const document = closedLoopDocument();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(layout).STK.slots;
		const rows = [
			rowAt(slots, 2, 0),
			rowAt(slots, 4, 0),
			rowAt(slots, 6, 0),
			rowAt(slots, 5, 3),
			rowAt(slots, 2, 3),
		];
		const plan = planStkPlacement(
			slots,
			rows,
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.portMutations).toHaveLength(5);
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(document.portEquipment.equipmentGroups).toEqual([
			{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2, 3, 4, 5] },
		]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "place-stk", portChanges: { length: 5 } });
		expect(document.undo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(5);

		const beforeRevision = document.map.getRevision();
		const beforeSequence = document.getPatchSequence();
		const beforeCell = document.map.getEncoded(3, 0);
		const erase = planRailErase(document.map, [{ x: 3, y: 0 }]);
		let committed = true;
		expect(() => {
			committed = document.commit(erase);
		}).not.toThrow();
		expect(committed).toBe(false);
		expect(document.map.getRevision()).toBe(beforeRevision);
		expect(document.getPatchSequence()).toBe(beforeSequence);
		expect(document.map.getEncoded(3, 0)).toBe(beforeCell);
	});

	it("rejects legacy CUSTOM as a new STK authoring command", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(layout).STK.slots;
		const plan = planStkPlacement(
			slots,
			[rowAt(slots, 2, 0)],
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "STK"),
			document.portEquipment,
			"CUSTOM" as unknown as Parameters<typeof planStkPlacement>[4],
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan).toMatchObject({
			valid: false,
			reason: expect.stringContaining("legacy load-only"),
		});
		expect(document.commitPortEquipment(plan)).toBe(false);
	});

	it("rejects a FLEX body that would enclose an existing side-mounted OHB", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const ohbSlots = compilePortSlotPreparedArtifactCatalog(layout).OHB.slots;
		const ohbRow = Array.from({ length: ohbSlots.count }, (_, row) => row).find(
			(row) =>
				ohbSlots.routeXs[row] === 4 &&
				ohbSlots.routeZs[row] === 0 &&
				ohbSlots.sides[row] === 1 &&
				ohbSlots.statuses[row] === PORT_SLOT_STATUS.LEGAL,
		);
		if (ohbRow === undefined) throw new Error("expected a left OHB slot at 4:0");
		const ohbPlan = planOhbPlacement(
			ohbSlots,
			ohbRow,
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "OHB"),
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(ohbPlan.valid, ohbPlan.reason).toBe(true);
		expect(document.commitPortEquipment(ohbPlan)).toBe(true);

		const stkSlots = compilePortSlotPreparedArtifactCatalog(layout).STK.slots;
		const plan = planStkPlacement(
			stkSlots,
			[rowAt(stkSlots, 2, 0), rowAt(stkSlots, 6, 0)],
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("equipment group 1");
		expect(document.commitPortEquipment(plan)).toBe(false);
		expect(document.portEquipment).toMatchObject({
			ports: { length: 1 },
			equipmentGroups: { length: 1 },
		});
	});

	it("blocks OHB placement inside a committed FLEX STK reservation", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const catalog = compilePortSlotPreparedArtifactCatalog(layout);
		const stkPlan = planStkPlacement(
			catalog.STK.slots,
			[rowAt(catalog.STK.slots, 2, 0), rowAt(catalog.STK.slots, 6, 0)],
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(stkPlan)).toBe(true);

		const ohbRow = Array.from({ length: catalog.OHB.slots.count }, (_, row) => row).find(
			(row) =>
				catalog.OHB.slots.routeXs[row] === 4 &&
				catalog.OHB.slots.routeZs[row] === 0 &&
				catalog.OHB.slots.sides[row] === 1,
		);
		if (ohbRow === undefined) throw new Error("expected a left OHB slot at 4:0");
		const plan = planOhbPlacement(
			catalog.OHB.slots,
			ohbRow,
			new PortSlotAvailabilityIndex(layout, document.portEquipment, "OHB"),
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("not currently available");
		expect(document.commitPortEquipment(plan)).toBe(false);
		expect(document.portEquipment).toMatchObject({
			ports: { length: 2 },
			equipmentGroups: { length: 1 },
		});
	});
});

function straightDocument(): RailDocument {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 }))).toBe(
		true,
	);
	return document;
}

function closedLoopDocument(): RailDocument {
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

function legalRows(slots: ReturnType<typeof compilePortSlots>): number[] {
	const rows: number[] = [];
	for (let row = 0; row < slots.count; row++) {
		if ((slots.statuses[row] as number) === PORT_SLOT_STATUS.LEGAL) rows.push(row);
	}
	return rows;
}

function rowAt(slots: ReturnType<typeof compilePortSlots>, x: number, z: number): number {
	for (let row = 0; row < slots.count; row++) {
		if (slots.routeXs[row] === x && slots.routeZs[row] === z) return row;
	}
	throw new Error(`Missing slot at ${x},${z}.`);
}
