import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { openFabStationProposalReviewAttachmentFromSlot } from "./OpenFabStationProposalReviewAttachment";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
	portSlotRecord,
} from "./PortSlotCompiler";
import {
	adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively,
	checksumPortSlotPreparedArtifactCatalog,
	compilePortSlotPreparedArtifactCatalog,
	compilePortSlotPreparedArtifacts,
	createPreparedPortSlotAvailabilityIndex,
} from "./PortSlotPreparedArtifacts";

describe("OpenFabStationProposalReviewAttachment", () => {
	it.each([
		"OHB",
		"EQ",
		"STK",
	] as const)("projects an exact legal %s slot without adopting proposal metadata", (portType) => {
		const layout = compilePhysicalRail(straightDocument(6).map);
		const portEquipment = emptyPortEquipmentState();
		const artifacts = compilePortSlotPreparedArtifacts(layout, portType);
		const slots = artifacts.slots;
		const availability = new PortSlotAvailabilityIndex(layout, portEquipment, portType);
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);

		const attachment = openFabStationProposalReviewAttachmentFromSlot(
			layout,
			artifacts,
			availability,
			portEquipment,
			row,
		);

		expect(attachment).toEqual({
			portType,
			route: {
				kind: "CARDINAL_CELL",
				x: slots.routeXs[row],
				z: slots.routeZs[row],
				from: slots.routeFromDirections[row],
				to: slots.routeToDirections[row],
			},
			stationMillimeters: slots.stationMillimeters[row],
			side: portType === "OHB" ? "LEFT" : "CENTER",
			lateralOffsetMillimeters: slots.lateralOffsetMillimeters[row],
		});
		expect(Object.keys(attachment).sort()).toEqual([
			"lateralOffsetMillimeters",
			"portType",
			"route",
			"side",
			"stationMillimeters",
		]);
		expect(attachment).not.toHaveProperty("direction");
	});

	it("rejects rows outside the compiled slot buffer and non-legal physical slots", () => {
		const layout = compilePhysicalRail(straightDocument(6).map);
		const portEquipment = emptyPortEquipmentState();
		const artifacts = compilePortSlotPreparedArtifacts(layout, "OHB");
		const slots = artifacts.slots;
		const availability = new PortSlotAvailabilityIndex(layout, portEquipment, "OHB");
		const unsafeRow = slots.statuses.indexOf(PORT_SLOT_STATUS.UNSAFE_APPROACH);

		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				portEquipment,
				-1,
			),
		).toThrow(RangeError);
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				portEquipment,
				slots.count,
			),
		).toThrow(RangeError);
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				portEquipment,
				unsafeRow,
			),
		).toThrow(`Port slot row ${unsafeRow} is not currently legal.`);
	});

	it("rejects a base slot occupied in the live port/equipment state", () => {
		const layout = compilePhysicalRail(straightDocument(6).map);
		const artifacts = compilePortSlotPreparedArtifacts(layout, "OHB");
		const baseline = artifacts.slots;
		const row = baseline.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		const port = portSlotRecord(baseline, row, 1, 1, "OHB-1");
		const occupiedState: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [port],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const availability = new PortSlotAvailabilityIndex(layout, occupiedState, "OHB");

		expect(availability.statusFor(baseline, row).status).toBe(PORT_SLOT_STATUS.PORT_OCCUPIED);
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				occupiedState,
				row,
			),
		).toThrow(`Port slot row ${row} is not currently legal.`);
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				{ ...occupiedState },
				row,
			),
		).toThrow("Port slot availability is stale for the current port/equipment state.");
	});

	it("rejects prepared slots and live availability from different exact layouts", () => {
		const layoutA = compilePhysicalRail(straightDocument(6).map);
		const layoutB = compilePhysicalRail(straightDocument(6).map);
		expect(layoutA.revision).toBe(layoutB.revision);
		const artifactsA = compilePortSlotPreparedArtifacts(layoutA, "OHB");
		const state = emptyPortEquipmentState();
		const availabilityB = new PortSlotAvailabilityIndex(layoutB, state, "OHB");
		const row = artifactsA.slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);

		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layoutA,
				artifactsA,
				availabilityB,
				state,
				row,
			),
		).toThrow("Port slot sources do not share the current physical-layout identity.");
	});

	it.each([
		[
			"route",
			(slots: CompiledPortSlots, row: number) => {
				slots.routeXs[row]++;
			},
		],
		[
			"station",
			(slots: CompiledPortSlots, row: number) => {
				slots.stationMillimeters[row]++;
			},
		],
		[
			"side",
			(slots: CompiledPortSlots, row: number) => {
				slots.sides[row] = slots.sides[row] === 1 ? 2 : 1;
			},
		],
		[
			"direction",
			(slots: CompiledPortSlots, row: number) => {
				slots.directions[row] = 1;
			},
		],
		[
			"source identity",
			(slots: CompiledPortSlots, row: number) => {
				slots.sourcePathIndices[row]++;
			},
		],
		[
			"resolved world position",
			(slots: CompiledPortSlots, row: number) => {
				slots.worldPositions[row * 2] += 0.25;
			},
		],
	] as const)("rejects a syntactically valid post-validation %s mutation", (_label, mutate) => {
		const layout = compilePhysicalRail(straightDocument(6).map);
		const portEquipment = emptyPortEquipmentState();
		const artifacts = compilePortSlotPreparedArtifacts(layout, "OHB");
		const slots = artifacts.slots;
		const availability = new PortSlotAvailabilityIndex(layout, portEquipment, "OHB");
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);

		mutate(slots, row);
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.LEGAL);
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				portEquipment,
				row,
			),
		).toThrow("no longer matches its validated physical layout");
	});

	it("rejects a non-legal prepared row mutated to a legal base status", () => {
		const layout = compilePhysicalRail(straightDocument(6).map);
		const portEquipment = emptyPortEquipmentState();
		const artifacts = compilePortSlotPreparedArtifacts(layout, "OHB");
		const slots = artifacts.slots;
		const availability = new PortSlotAvailabilityIndex(layout, portEquipment, "OHB");
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.UNSAFE_APPROACH);
		expect(row).toBeGreaterThanOrEqual(0);

		slots.statuses[row] = PORT_SLOT_STATUS.LEGAL;
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.LEGAL);
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				portEquipment,
				row,
			),
		).toThrow("source identity or base status no longer matches");
	});

	it("rejects a coordinated physical-layout and slot route mutation after validation", () => {
		const layout = compilePhysicalRail(straightDocument(6).map);
		const portEquipment = emptyPortEquipmentState();
		const artifacts = compilePortSlotPreparedArtifacts(layout, "OHB");
		const slots = artifacts.slots;
		const availability = new PortSlotAvailabilityIndex(layout, portEquipment, "OHB");
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		const sourcePathIndex = slots.sourcePathIndices[row] as number;
		const cellOffset = sourcePathIndex * 2;
		const changedX = (layout.pathIntervalRemap.sourcePathCells[cellOffset] as number) + 10_000;

		layout.pathIntervalRemap.sourcePathCells[cellOffset] = changedX;
		slots.routeXs[row] = changedX;
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.LEGAL);
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				portEquipment,
				row,
			),
		).toThrow("source identity or base status no longer matches its validated physical layout");
	});

	it("keeps live availability bound to the exact validated world position", () => {
		const layout = twoDistantStraightLayout();
		const artifacts = compilePortSlotPreparedArtifacts(layout, "OHB");
		const slots = artifacts.slots;
		const row = slots.statuses.findIndex(
			(status, candidate) =>
				status === PORT_SLOT_STATUS.LEGAL && (slots.routeZs[candidate] as number) === 0,
		);
		expect(row).toBeGreaterThanOrEqual(0);
		const farRow = slots.statuses.findIndex(
			(status, candidate) =>
				status === PORT_SLOT_STATUS.LEGAL &&
				(slots.routeZs[candidate] as number) === 100 &&
				(slots.routeXs[candidate] as number) === (slots.routeXs[row] as number) &&
				(slots.sides[candidate] as number) === (slots.sides[row] as number),
		);
		expect(farRow).toBeGreaterThanOrEqual(0);
		const port = portSlotRecord(slots, row, 1, 1, "OHB-1");
		const portEquipment: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [port],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const availability = new PortSlotAvailabilityIndex(layout, portEquipment, "OHB");
		const preparedAvailability = createPreparedPortSlotAvailabilityIndex(
			layout,
			artifacts,
			portEquipment,
		);
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.PORT_OCCUPIED);
		expect(preparedAvailability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.PORT_OCCUPIED);

		const validatedRoute = [
			slots.routeXs[row],
			slots.routeZs[row],
			slots.routeFromDirections[row],
			slots.routeToDirections[row],
		] as const;
		const validatedStation = slots.stationMillimeters[row] as number;
		const validatedSide = slots.sides[row] as number;
		const validatedWorld = [
			slots.worldPositions[row * 2] as number,
			slots.worldPositions[row * 2 + 1] as number,
		] as const;
		const remap = layout.pathIntervalRemap;
		const sourcePathIndex = slots.sourcePathIndices[row] as number;
		const farSourcePathIndex = slots.sourcePathIndices[farRow] as number;
		const mappingRow = remap.sourcePathOffsets[sourcePathIndex] as number;
		const farMappingRow = remap.sourcePathOffsets[farSourcePathIndex] as number;
		expect((remap.sourcePathOffsets[sourcePathIndex + 1] as number) - mappingRow).toBe(1);
		expect((remap.sourcePathOffsets[farSourcePathIndex + 1] as number) - farMappingRow).toBe(1);

		remap.targetPathIndices[mappingRow] = remap.targetPathIndices[farMappingRow] as number;
		remap.targetStarts[mappingRow] = remap.targetStarts[farMappingRow] as number;
		remap.targetEnds[mappingRow] = remap.targetEnds[farMappingRow] as number;
		slots.finalPathIndices[row] = slots.finalPathIndices[farRow] as number;
		for (const values of [slots.railPositions, slots.worldPositions, slots.tangents]) {
			values[row * 2] = values[farRow * 2] as number;
			values[row * 2 + 1] = values[farRow * 2 + 1] as number;
		}
		slots.yawRadians[row] = slots.yawRadians[farRow] as number;

		expect([
			slots.routeXs[row],
			slots.routeZs[row],
			slots.routeFromDirections[row],
			slots.routeToDirections[row],
		]).toEqual(validatedRoute);
		expect(slots.stationMillimeters[row]).toBe(validatedStation);
		expect(slots.sides[row]).toBe(validatedSide);
		expect([slots.worldPositions[row * 2], slots.worldPositions[row * 2 + 1]]).not.toEqual(
			validatedWorld,
		);
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.LEGAL);
		expect(preparedAvailability.statusFor(slots, row).status).toBe(
			PORT_SLOT_STATUS.ATTACHMENT_INVALID,
		);
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				portEquipment,
				row,
			),
		).toThrow("source identity or base status no longer matches its validated physical layout");
	});

	it("seals row integrity for a privately adopted Worker catalog", async () => {
		const layout = compilePhysicalRail(straightDocument(6).map);
		const source = compilePortSlotPreparedArtifactCatalog(layout);
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);
		const adopted = await adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
			layout,
			source,
			physicalFingerprint,
			expectedFingerprint,
			async () => undefined,
			() => undefined,
		);
		const artifacts = adopted.OHB;
		const row = artifacts.slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		const portEquipment = emptyPortEquipmentState();
		const availability = new PortSlotAvailabilityIndex(layout, portEquipment, "OHB");

		artifacts.slots.directions[row] = 1;
		expect(() =>
			openFabStationProposalReviewAttachmentFromSlot(
				layout,
				artifacts,
				availability,
				portEquipment,
				row,
			),
		).toThrow("direction no longer matches its validated physical layout");
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

function twoDistantStraightLayout(): ReturnType<typeof compilePhysicalRail> {
	const hydrator = TileMap.createHydrator();
	for (const z of [0, 100]) {
		for (let x = 0; x <= 6; x++) {
			hydrator.addEncodedCell(
				x,
				z,
				encodeRailCell({
					incoming: x === 0 ? 0 : DIR_W,
					outgoing: x === 6 ? 0 : DIR_E,
				}),
			);
		}
	}
	const layout = compilePhysicalRail(hydrator.finish(1));
	expect(layout.valid).toBe(true);
	return layout;
}
