import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { createPortEquipmentMutationPlan } from "../core/PortEquipmentPlan";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { resolvePortAttachment } from "./PortAttachmentResolver";
import { compilePortEquipmentPresentation } from "./PortEquipmentPresentation";
import {
	compileBasePortSlots,
	compilePortSlotExclusionMask,
	compilePortSlotExclusionMaskCooperatively,
	compilePortSlots,
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
	PortSlotSpatialIndex,
	portSlotRecord,
} from "./PortSlotCompiler";

describe("PortSlotCompiler", () => {
	it("skips physical attachment indexing for empty ports while rejecting foreign empty proofs", () => {
		const document = straightDocument(8);
		const layout = compilePhysicalRail(document.map);
		const state = document.portEquipment;
		const guardedLayout = new Proxy(layout, {
			get(target, property, receiver) {
				if (property === "pathIntervalRemap") throw new Error("Unexpected full attachment index");
				return Reflect.get(target, property, receiver);
			},
		});
		const presentation = compilePortEquipmentPresentation(guardedLayout, state);
		expect(new PortSlotAvailabilityIndex(guardedLayout, state, "EQ").portCount).toBe(0);
		expect(
			new PortSlotAvailabilityIndex(guardedLayout, state, "EQ", presentation.resolvedPositions)
				.portCount,
		).toBe(0);
		expect(
			() =>
				new PortSlotAvailabilityIndex(guardedLayout, state, "EQ", {
					...presentation.resolvedPositions,
				}),
		).toThrow("not certified");
		expect(
			() => new PortSlotAvailabilityIndex(layout, state, "EQ", presentation.resolvedPositions),
		).toThrow("not certified");
		expect(
			() =>
				new PortSlotAvailabilityIndex(
					guardedLayout,
					{ ...state },
					"EQ",
					presentation.resolvedPositions,
				),
		).toThrow("not certified");
	});

	it("emits deterministic OHB left/right stations and excludes unsafe approaches", () => {
		const document = straightDocument(6);
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlots(layout, emptyPortEquipmentState(), "OHB");

		expect(slots.revision).toBe(layout.revision);
		expect(slots.count).toBe(10);
		expect(slots.legalCount).toBe(6);
		expect([...slots.statuses]).toEqual([
			PORT_SLOT_STATUS.UNSAFE_APPROACH,
			PORT_SLOT_STATUS.UNSAFE_APPROACH,
			PORT_SLOT_STATUS.LEGAL,
			PORT_SLOT_STATUS.LEGAL,
			PORT_SLOT_STATUS.LEGAL,
			PORT_SLOT_STATUS.LEGAL,
			PORT_SLOT_STATUS.LEGAL,
			PORT_SLOT_STATUS.LEGAL,
			PORT_SLOT_STATUS.UNSAFE_APPROACH,
			PORT_SLOT_STATUS.UNSAFE_APPROACH,
		]);
		expect([...slots.sides]).toEqual([1, 2, 1, 2, 1, 2, 1, 2, 1, 2]);
		expect([...slots.stationMillimeters]).toEqual(new Array(10).fill(500));
		expect(slots.sourcePathOffsets.length).toBe(layout.pathIntervalRemap.sourcePathCount + 1);
	});

	it("round-trips every legal slot into a stable authored record", () => {
		const document = straightDocument(8);
		const layout = compilePhysicalRail(document.map);
		const slots = compilePortSlots(layout, emptyPortEquipmentState(), "OHB");
		let nextId = 1;

		for (let row = 0; row < slots.count; row++) {
			if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) continue;
			const record = portSlotRecord(slots, row, nextId, nextId, `OHB-${nextId}`);
			const resolution = resolvePortAttachment(layout, record);
			expect(resolution.ok).toBe(true);
			if (!resolution.ok) continue;
			expect(resolution.worldXMeters).toBeCloseTo(slots.worldPositions[row * 2] as number, 5);
			expect(resolution.worldZMeters).toBeCloseTo(slots.worldPositions[row * 2 + 1] as number, 5);
			nextId++;
		}
		expect(nextId).toBe(slots.legalCount + 1);
	});

	it("marks an exact committed port occupied while preserving the opposite-side slot", () => {
		const document = straightDocument(6);
		const layout = compilePhysicalRail(document.map);
		const baseline = compilePortSlots(layout, emptyPortEquipmentState(), "OHB");
		const row = baseline.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		const port = portSlotRecord(baseline, row, 1, 1, "OHB-001");
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [port],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const occupied = compilePortSlots(layout, state, "OHB");

		expect(occupied.statuses[row]).toBe(PORT_SLOT_STATUS.PORT_OCCUPIED);
		expect(occupied.conflictingPortIds[row]).toBe(1);
		expect(occupied.statuses[row + 1]).toBe(PORT_SLOT_STATUS.LEGAL);
		expect(occupied.legalCount).toBe(baseline.legalCount - 1);
	});

	it("keeps physical slots immutable while live occupancy follows commit and undo", () => {
		const document = straightDocument(6);
		const layout = compilePhysicalRail(document.map);
		const slots = compileBasePortSlots(layout, "OHB");
		const baselineStatuses = slots.statuses.slice();
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		const port = portSlotRecord(slots, row, 1, 1, "OHB-001");
		const plan = createPortEquipmentMutationPlan(
			"place-ohb",
			document.map.getRevision(),
			document.getPatchSequence(),
			[{ id: 1, before: null, after: port }],
			[
				{
					id: 1,
					before: null,
					after: { id: 1, kind: "OHB" as const, template: "SINGLE" as const, portIds: [1] },
				},
			],
		);

		expect(document.commitPortEquipment(plan)).toBe(true);
		const occupied = new PortSlotAvailabilityIndex(layout, document.portEquipment);
		expect(occupied.statusFor(slots, row)).toEqual({
			status: PORT_SLOT_STATUS.PORT_OCCUPIED,
			conflictingPortId: 1,
			conflictingEquipmentGroupId: 0,
		});
		expect([...slots.statuses]).toEqual([...baselineStatuses]);

		expect(document.undo()).toBe(true);
		const restored = new PortSlotAvailabilityIndex(layout, document.portEquipment);
		expect(restored.statusFor(slots, row)).toEqual({
			status: PORT_SLOT_STATUS.LEGAL,
			conflictingPortId: 0,
			conflictingEquipmentGroupId: 0,
		});
		expect([...slots.statuses]).toEqual([...baselineStatuses]);
	});

	it("indexes source routes once instead of scanning every physical path for every port", () => {
		const layout = compilePhysicalRail(straightDocument(200).map);
		const slots = compileBasePortSlots(layout, "OHB");
		const rows: number[] = [];
		for (let row = 0; row < slots.count; row += 2) {
			if ((slots.statuses[row] as number) === PORT_SLOT_STATUS.LEGAL) rows.push(row);
		}
		const ports = rows.map((row, index) =>
			portSlotRecord(slots, row, index + 1, index + 1, `OHB-${index + 1}`),
		);
		const state: PortEquipmentState = {
			nextPortId: ports.length + 1,
			nextEquipmentGroupId: ports.length + 1,
			ports,
			equipmentGroups: ports.map((port) => ({
				id: port.equipmentGroupId,
				kind: "OHB",
				template: "SINGLE",
				portIds: [port.id],
			})),
		};
		let sourcePathCountReads = 0;
		const remap = new Proxy(layout.pathIntervalRemap, {
			get(target, key, receiver) {
				if (key === "sourcePathCount") sourcePathCountReads++;
				return Reflect.get(target, key, receiver);
			},
		});
		const instrumentedLayout = { ...layout, pathIntervalRemap: remap };

		const availability = new PortSlotAvailabilityIndex(instrumentedLayout, state, "OHB");

		expect(availability.portCount).toBe(ports.length);
		expect(sourcePathCountReads).toBeLessThan(layout.pathIntervalRemap.sourcePathCount * 5);
	});

	it("matches fallback availability at the 600 mm boundary beyond 50 km", () => {
		const document = straightDocument(50_010);
		const layout = compilePhysicalRail(document.map);
		const slots = compileBasePortSlots(layout, "EQ");
		const row = slots.routeXs.indexOf(50_000);
		expect(row).toBeGreaterThanOrEqual(0);
		for (const [stationMillimeters, expectedStatus] of [
			[99, PORT_SLOT_STATUS.PORT_CLEARANCE_CONFLICT],
			[100, PORT_SLOT_STATUS.LEGAL],
		] as const) {
			const port = {
				id: 1,
				equipmentGroupId: 1,
				route: {
					kind: "CARDINAL_CELL" as const,
					x: 50_001,
					z: 0,
					from: slots.routeFromDirections[row] as typeof DIR_W,
					to: slots.routeToDirections[row] as typeof DIR_E,
				},
				stationMillimeters,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: null,
			};
			const state: PortEquipmentState = {
				nextPortId: 2,
				nextEquipmentGroupId: 2,
				ports: [port],
				equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
			};
			const fallback = new PortSlotAvailabilityIndex(layout, state, "EQ");
			const presentation = compilePortEquipmentPresentation(layout, state);
			const reused = new PortSlotAvailabilityIndex(
				layout,
				state,
				"EQ",
				presentation.resolvedPositions,
			);
			expect(reused.statusFor(slots, row)).toEqual(fallback.statusFor(slots, row));
			expect(reused.statusFor(slots, row).status).toBe(expectedStatus);
		}
	});

	it("reserves slots between FLEX STK ports as one derived connected-run body", () => {
		const document = straightDocument(10);
		const layout = compilePhysicalRail(document.map);
		const stkSlots = compileBasePortSlots(layout, "STK");
		const firstRow = stkSlots.routeXs.indexOf(2);
		const lastRow = stkSlots.routeXs.indexOf(6);
		const ports = [firstRow, lastRow].map((row, index) =>
			portSlotRecord(stkSlots, row, index + 1, 1, `STK-1-P0${index + 1}`),
		);
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			ports,
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		};

		for (const portType of ["OHB", "EQ"] as const) {
			const slots = compileBasePortSlots(layout, portType);
			const row = slots.routeXs.indexOf(4);
			const result = new PortSlotAvailabilityIndex(layout, state, portType).statusFor(slots, row);
			expect(result).toEqual({
				status: PORT_SLOT_STATUS.EQUIPMENT_BODY_CONFLICT,
				conflictingPortId: 0,
				conflictingEquipmentGroupId: 1,
			});
		}
	});

	it("uses center stations for future EQ/STK policies without changing authored identity", () => {
		const document = straightDocument(6);
		const layout = compilePhysicalRail(document.map);
		for (const type of ["EQ", "STK"] as const) {
			const slots = compilePortSlots(layout, emptyPortEquipmentState(), type);
			expect(slots.count).toBe(5);
			expect(slots.legalCount).toBe(3);
			expect([...slots.statuses]).toEqual([
				PORT_SLOT_STATUS.UNSAFE_APPROACH,
				PORT_SLOT_STATUS.LEGAL,
				PORT_SLOT_STATUS.LEGAL,
				PORT_SLOT_STATUS.LEGAL,
				PORT_SLOT_STATUS.UNSAFE_APPROACH,
			]);
			expect([...slots.sides]).toEqual([0, 0, 0, 0, 0]);
			expect([...slots.lateralOffsetMillimeters]).toEqual([0, 0, 0, 0, 0]);
		}
	});

	it("cooperatively compiles the exact static exclusion mask", async () => {
		const layout = compilePhysicalRail(straightDocument(80).map);
		let checkpoints = 0;
		const cooperative = await compilePortSlotExclusionMaskCooperatively(layout, async () => {
			checkpoints++;
		});

		expect(cooperative).toEqual(compilePortSlotExclusionMask(layout));
		expect(checkpoints).toBeGreaterThan(0);
	});

	it("queries visible and nearest candidates through a revision-local spatial index", () => {
		const document = straightDocument(80);
		const slots = compilePortSlots(
			compilePhysicalRail(document.map),
			emptyPortEquipmentState(),
			"OHB",
		);
		const index = new PortSlotSpatialIndex(slots);
		const visible = index.query({ minX: 20, minZ: -2, maxX: 30, maxZ: 2 });

		expect(visible.length).toBeGreaterThan(0);
		expect(visible.length).toBeLessThan(slots.count);
		const row = visible[0] as number;
		expect(
			index.nearest(
				slots.worldPositions[row * 2] as number,
				slots.worldPositions[row * 2 + 1] as number,
				0.25,
			),
		).toBe(row);
	});

	it("keeps query membership private after exposed slot and snapshot buffers mutate", () => {
		const slots = compileBasePortSlots(compilePhysicalRail(straightDocument(80).map), "OHB");
		const index = new PortSlotSpatialIndex(slots);
		const snapshot = index.snapshot;
		const firstRow = 0;
		const lastRow = slots.count - 1;
		const firstPosition = snapshot.slotIndices.indexOf(firstRow);
		const lastPosition = snapshot.slotIndices.indexOf(lastRow);
		const firstX = slots.worldPositions[firstRow * 2] as number;
		const firstZ = slots.worldPositions[firstRow * 2 + 1] as number;
		snapshot.slotIndices[firstPosition] = lastRow;
		snapshot.slotIndices[lastPosition] = firstRow;
		snapshot.chunkCoordinates.fill(2_000_000_000);
		snapshot.chunkOffsets.fill(0);
		slots.worldPositions[firstRow * 2] = firstX + 10_000;

		expect(
			index.query({
				minX: firstX - 0.1,
				minZ: firstZ - 0.1,
				maxX: firstX + 0.1,
				maxZ: firstZ + 0.1,
			}),
		).toContain(firstRow);
	});
});

function straightDocument(lengthMeters: number): RailDocument {
	const document = new RailDocument();
	expect(
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: lengthMeters, y: 0 })),
	).toBe(true);
	const interior = document.map.getRail(1, 0);
	expect(interior?.incoming).toBe(DIR_W);
	expect(interior?.outgoing).toBe(DIR_E);
	return document;
}
