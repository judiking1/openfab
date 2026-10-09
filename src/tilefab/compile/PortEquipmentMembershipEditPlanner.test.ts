import { describe, expect, it, vi } from "vitest";
import { type PortEquipmentState, resolveEqBodyDimensions } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { compareDirectedRailEdges } from "../core/StaticFabOrganization";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { selectEqRowDraft } from "./EqRowDraftSelector";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { planResizeEqBody } from "./PortEquipmentEditPlanner";
import {
	PortEquipmentGroupSlotIndex,
	portEquipmentGroupSlotIndexFor,
} from "./PortEquipmentGroupEditPlanner";
import {
	planEqPortPitchEdit,
	planPortEquipmentMembershipEdit,
	reviewPortEquipmentMembershipEdit,
} from "./PortEquipmentMembershipEditPlanner";
import { planEqRowPlacement, planStkPlacement } from "./PortPlacementPlanner";
import { PortSlotAvailabilityIndex } from "./PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "./PortSlotPreparedArtifacts";

describe("PortEquipmentMembershipEditPlanner", () => {
	it("rejects a slot-valid three-Port draft when the authored EQ body only fits two Ports", () => {
		const document = closedLoopDocument(14, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const rows = [2, 3, 4].map((x) => rowAt(slots, x, 0));
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					rows.slice(0, 2),
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					null,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		expect(
			document.commitPortEquipment(
				planResizeEqBody(
					document.map,
					document.portEquipment,
					{ portId: 1, equipmentGroupId: 1 },
					{ lengthMillimeters: 2_000, widthMillimeters: 900 },
					document.map.getRevision(),
					document.getPatchSequence(),
					document.organizations,
				),
			),
		).toBe(true);
		const availability = new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ");
		const draft = selectEqRowDraft(
			slots,
			availability,
			rows[0] as number,
			rows[2] as number,
			rows,
			1_000,
			1,
		);
		expect(draft.valid, draft.reason).toBe(true);
		const args = [
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			availability,
			document.portEquipment,
			1,
			draft.rows,
			document.map.getRevision(),
			document.getPatchSequence(),
			document.organizations,
		] as const;
		const source = document.portEquipment;
		const checksum = checksumRailMap(document.map, source, document.organizations);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const review = reviewPortEquipmentMembershipEdit(...args);
		const plan = planPortEquipmentMembershipEdit(...args);
		expect(review).toEqual({ valid: plan.valid, reason: plan.reason });
		expect(review).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/2000.*3 Port.*3000/),
		});
		expect(Object.keys(review).sort()).toEqual(["reason", "valid"]);
		expect(Object.isFrozen(review)).toBe(true);
		expect(plan.portMutations).toEqual([]);
		expect(plan.equipmentGroupMutations).toEqual([]);
		expect(document.portEquipment).toBe(source);
		expect(document.getPatchSequence()).toBe(args[8]);
		expect(checksumRailMap(document.map, source, document.organizations)).toBe(checksum);
		expect(events).toEqual([]);
	});

	it("reviews and commits an owned EQ draft with sufficient authored dimensions without changing identity or ownership", () => {
		const source = closedLoopDocument(14, 4);
		const physical = compilePhysicalRail(source.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const initialRows = [2, 3].map((x) => rowAt(slots, x, 0));
		expect(
			source.commitPortEquipment(
				planEqRowPlacement(
					slots,
					initialRows,
					new PortSlotAvailabilityIndex(physical, source.portEquipment, "EQ"),
					source.portEquipment,
					1_000,
					"PHOTO",
					source.map.getRevision(),
					source.getPatchSequence(),
				),
			),
		).toBe(true);
		const dimensions = { lengthMillimeters: 4_000, widthMillimeters: 1_000 };
		expect(
			source.commitPortEquipment(
				planResizeEqBody(
					source.map,
					source.portEquipment,
					{ portId: 1, equipmentGroupId: 1 },
					dimensions,
					source.map.getRevision(),
					source.getPatchSequence(),
					source.organizations,
				),
			),
		).toBe(true);
		const document = ownedEquipmentDocument(source);
		const equipment = document.portEquipment;
		const organizations = document.organizations;
		const args = [
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, equipment, "EQ"),
			equipment,
			1,
			[...initialRows, rowAt(slots, 4, 0)],
			document.map.getRevision(),
			document.getPatchSequence(),
			organizations,
		] as const;
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		expect(reviewPortEquipmentMembershipEdit(...args).valid).toBe(true);
		expect(reviewPortEquipmentMembershipEdit(...args).valid).toBe(true);
		expect(events).toEqual([]);
		expect(document.portEquipment).toBe(equipment);
		expect(document.getPatchSequence()).toBe(args[8]);
		const plan = planPortEquipmentMembershipEdit(...args);
		expect(plan.membershipEdit).toMatchObject({
			retainedPortIds: [1, 2],
			addedPortIds: [3],
			removedPortIds: [],
		});
		expect(document.commitPortEquipment(plan), document.getLastCommandError() ?? plan.reason).toBe(
			true,
		);
		expect(events).toHaveLength(1);
		expect(document.portEquipment.equipmentGroups[0]).toEqual({
			...equipment.equipmentGroups[0],
			portIds: [1, 2, 3],
		});
		expect(document.portEquipment.equipmentGroups[0]).toMatchObject({
			id: 1,
			kind: "EQ",
			bodyDimensions: dimensions,
			recipe: "PHOTO",
			pitchMillimeters: 1_000,
		});
		expect(document.portEquipment.ports.slice(0, 2)).toEqual(equipment.ports);
		expect(document.portEquipment.nextPortId).toBe(4);
		expect(document.portEquipment.nextEquipmentGroupId).toBe(equipment.nextEquipmentGroupId);
		expect(document.organizations).toBe(organizations);
		const edited = document.portEquipment;
		expect(document.undo()).toBe(true);
		expect(document.portEquipment).toEqual({ ...equipment, nextPortId: edited.nextPortId });
		expect(document.redo()).toBe(true);
		expect(document.portEquipment).toEqual(edited);
		expect(document.organizations).toBe(organizations);
		expect(
			reviewPortEquipmentMembershipEdit(
				document.map,
				slots,
				args[2],
				args[3],
				document.portEquipment,
				1,
				args[6],
				document.map.getRevision(),
				document.getPatchSequence(),
				document.organizations,
			),
		).toMatchObject({ valid: false, reason: expect.stringMatching(/stale/) });
	});

	it("rejects a draft's new FLEX Port outside its owning Loop before committing", () => {
		const source = closedLoopDocument(14, 4);
		expect(source.commit(planRailConstruction(source.map, { x: 20, y: 0 }, { x: 35, y: 0 }))).toBe(
			true,
		);
		const physical = compilePhysicalRail(source.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		expect(
			source.commitPortEquipment(
				planStkPlacement(
					slots,
					[2, 3].map((x) => rowAt(slots, x, 0)),
					new PortSlotAvailabilityIndex(physical, source.portEquipment, "STK"),
					source.portEquipment,
					"FLEX",
					source.map.getRevision(),
					source.getPatchSequence(),
				),
			),
		).toBe(true);
		const document = ownedEquipmentDocument(source);
		const args = [
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			1,
			[2, 23].map((x) => rowAt(slots, x, 0)),
			document.map.getRevision(),
			document.getPatchSequence(),
		] as const;
		expect(planPortEquipmentMembershipEdit(...args).valid).toBe(true);
		const review = reviewPortEquipmentMembershipEdit(...args, document.organizations);
		const plan = planPortEquipmentMembershipEdit(...args, document.organizations);
		expect(review).toEqual({ valid: plan.valid, reason: plan.reason });
		expect(review).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/PORT-3.*Synthetic Loop.*밖/),
		});
		expect(document.portEquipment).toBe(args[4]);
		expect(document.portEquipment.nextPortId).toBe(3);
		expect(document.getPatchSequence()).toBe(args[8]);
	});

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

function ownedEquipmentDocument(source: RailDocument): RailDocument {
	return RailDocument.fromLoadedMap(source.map, source.getPatchSequence(), source.portEquipment, {
		nextOrganizationId: 2,
		records: [
			{
				id: 1,
				kind: "AISLE",
				declaredSemanticRole: "PROCESS_LOOP",
				name: "Synthetic Loop",
				membership: {
					railEdges: buildRailModuleOwnershipIndex(source.map)
						.modules.flatMap((module) => module.eraseEdges)
						.filter((edge) => edge.from.x < 20 && edge.to.x < 20)
						.sort(compareDirectedRailEdges),
					advancedSwitchIds: [],
					equipmentGroupIds: [1],
				},
			},
		],
	});
}

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

describe("anchor-fixed EQ pitch editing", () => {
	it("keeps the complete body-collision cause without the internal layout prefix", () => {
		const { document, slots, physical, plan } = pitchFixture();
		expect(
			document.commitPortEquipment(
				planResizeEqBody(
					document.map,
					document.portEquipment,
					{ portId: 1, equipmentGroupId: 1 },
					{ lengthMillimeters: 8_000, widthMillimeters: 900 },
					document.map.getRevision(),
					document.getPatchSequence(),
					document.organizations,
				),
			),
		).toBe(true);
		const neighbor = planEqRowPlacement(
			slots,
			[16, 17].map((x) => rowAt(slots, x, 0)),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1_000,
			null,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(neighbor), neighbor.reason).toBe(true);
		const source = document.portEquipment;
		const sequence = document.getPatchSequence();
		expect(plan(2_000, 1)).toMatchObject({
			valid: false,
			reason: "EQ 1 몸체가 EQ 2 몸체와 겹칩니다 · 길이·폭을 줄이거나 주변 장비를 이동하세요.",
		});
		expect(document.portEquipment).toBe(source);
		expect(document.getPatchSequence()).toBe(sequence);
	});

	it.each([
		"Unexpected slot lookup failure: detailed cause",
		"Port equipment layout is invalid:",
	])("preserves an unknown or detail-free error: %s", (reason) => {
		const { slots, plan } = pitchFixture();
		const lookup = vi
			.spyOn(portEquipmentGroupSlotIndexFor(slots), "rowForPort")
			.mockImplementationOnce(() => {
				throw new Error(reason);
			});
		try {
			expect(plan(2_000)).toMatchObject({ valid: false, reason });
		} finally {
			lookup.mockRestore();
		}
	});

	it.each([
		"east",
		"south",
		"west",
		"north",
	] as const)("keeps all identities with each anchor on a %s rail", (direction) => {
		for (const anchorId of [1, 2, 3]) {
			const fixture = pitchFixture(direction);
			const { document } = fixture;
			const original = document.portEquipment;
			const originalSequence = document.getPatchSequence();
			const plan = fixture.plan(3_000, anchorId);
			expect(plan.valid, plan.reason).toBe(true);
			expect(document.portEquipment).toBe(original);
			expect(document.getPatchSequence()).toBe(originalSequence);
			expect(plan.membershipEdit).toMatchObject({
				retainedPortIds: [1, 2, 3],
				addedPortIds: [],
				removedPortIds: [],
			});
			expect(plan.portMutations).toHaveLength(2);
			expect(
				document.commitPortEquipment(plan),
				document.getLastCommandError() ?? plan.reason,
			).toBe(true);
			const changed = document.portEquipment;
			expect(changed.ports.find((port) => port.id === anchorId)).toEqual(
				original.ports.find((port) => port.id === anchorId),
			);
			expect(changed.equipmentGroups[0]).toEqual({
				...original.equipmentGroups[0],
				pitchMillimeters: 3_000,
			});
			expect(changed.equipmentGroups[0]).not.toHaveProperty("bodyDimensions");
			expect(changed.nextPortId).toBe(original.nextPortId);
			expect(changed.nextEquipmentGroupId).toBe(original.nextEquipmentGroupId);
			for (const port of changed.ports)
				expect({
					...port,
					route: original.ports.find((source) => source.id === port.id)?.route,
				}).toEqual(original.ports.find((source) => source.id === port.id));
			expect(document.undo()).toBe(true);
			expect(document.portEquipment).toEqual(original);
			expect(document.redo()).toBe(true);
			expect(document.portEquipment).toEqual(changed);
		}
	});

	it.each([
		1_000, 2_000, 3_000, 4_000, 5_000,
	])("supports %i mm and derives automatic body length", (pitch) => {
		const { document, plan } = pitchFixture();
		if (pitch === 1_000) {
			expect(plan(pitch).valid).toBe(false);
			expect(document.commitPortEquipment(plan(2_000))).toBe(true);
		}
		const edit = plan(pitch);
		expect(document.commitPortEquipment(edit), edit.reason).toBe(true);
		const group = document.portEquipment.equipmentGroups[0];
		if (group?.kind !== "EQ") throw new Error("Expected EQ");
		expect(resolveEqBodyDimensions(group).lengthMillimeters).toBe(2 * pitch + 1_000);
		expect(group).not.toHaveProperty("bodyDimensions");
	});

	it("preserves explicit dimensions and rejects insufficient length without changing the draft source", () => {
		const { document, plan } = pitchFixture();
		const dimensions = { lengthMillimeters: 5_000, widthMillimeters: 1_000 };
		expect(
			document.commitPortEquipment(
				planResizeEqBody(
					document.map,
					document.portEquipment,
					{ portId: 2, equipmentGroupId: 1 },
					dimensions,
					document.map.getRevision(),
					document.getPatchSequence(),
					document.organizations,
				),
			),
		).toBe(true);
		const before = document.portEquipment;
		expect(plan(3_000)).toMatchObject({ valid: false, reason: expect.stringMatching(/최소 7 m/) });
		expect(document.portEquipment).toBe(before);
		expect(document.commitPortEquipment(plan(2_000))).toBe(true);
		expect(document.portEquipment.equipmentGroups[0]).toMatchObject({ bodyDimensions: dimensions });
	});

	it("rejects invalid pitch, anchor, stale catalogs, missing slots and occupied target slots", () => {
		const { document, slots, physical, plan } = pitchFixture();
		for (const pitch of [0, 500, 1_500, 6_000, Number.NaN]) expect(plan(pitch).valid).toBe(false);
		expect(plan(2_000, 99).valid).toBe(false);
		const staleAvailability = new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ");
		const stale = plan(2_000);
		expect(document.commitPortEquipment(stale)).toBe(true);
		expect(document.commitPortEquipment(stale)).toBe(false);
		expect(
			planEqPortPitchEdit(
				document.map,
				slots,
				portEquipmentGroupSlotIndexFor(slots),
				staleAvailability,
				document.portEquipment,
				{ equipmentGroupId: 1, portId: 2 },
				3_000,
				document.map.getRevision(),
				document.getPatchSequence(),
				document.organizations,
			).valid,
		).toBe(false);
		const limited = pitchFixture("east", [2, 3, 4]);
		expect(limited.plan(5_000, 3)).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/직선 슬롯이 없습니다/),
		});
		const occupied = pitchFixture();
		const extra = planEqRowPlacement(
			occupied.slots,
			[14, 15].map((x) => rowAt(occupied.slots, x, 0)),
			new PortSlotAvailabilityIndex(occupied.physical, occupied.document.portEquipment, "EQ"),
			occupied.document.portEquipment,
			1_000,
			null,
			occupied.document.map.getRevision(),
			occupied.document.getPatchSequence(),
		);
		expect(occupied.document.commitPortEquipment(extra), extra.reason).toBe(true);
		expect(occupied.plan(3_000)).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/겹칩니다/),
		});
	});

	it.each([
		false,
		true,
	])("reopens pitch and explicit-body=%s through the native codec and continues editing", (explicitBody) => {
		const fixture = pitchFixture();
		const { document } = fixture;
		if (explicitBody)
			expect(
				document.commitPortEquipment(
					planResizeEqBody(
						document.map,
						document.portEquipment,
						{ portId: 2, equipmentGroupId: 1 },
						{ lengthMillimeters: 7_000, widthMillimeters: 900 },
						document.map.getRevision(),
						document.getPatchSequence(),
						document.organizations,
					),
				),
			).toBe(true);
		expect(document.commitPortEquipment(fixture.plan(3_000))).toBe(true);
		const manifest = {
			id: "eq-pitch-test",
			name: "Synthetic EQ pitch",
			createdAt: "2026-10-09T00:00:00.000Z",
			updatedAt: "2026-10-09T00:00:00.000Z",
		};
		const json = serializeOpenFabProject(captureOpenFabProject(document, { manifest }));
		expect(parseOpenFabProjectJson(json).project.schemaVersion).toBe(16);
		const startup = compileRailStartup({ kind: "project-json", json });
		const reopened = hydrateRailMirrorSnapshotDocument(startup.snapshot);
		expect(startup.authoredChecksum).toBe(
			checksumRailMap(document.map, document.portEquipment, document.organizations),
		);
		expect(reopened.portEquipment).toEqual(document.portEquipment);
		expect(reopened.canUndo).toBe(false);
		const physical = compilePhysicalRail(reopened.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const edit = planEqPortPitchEdit(
			reopened.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, reopened.portEquipment, "EQ"),
			reopened.portEquipment,
			{ equipmentGroupId: 1, portId: 2 },
			2_000,
			reopened.map.getRevision(),
			reopened.getPatchSequence(),
			reopened.organizations,
		);
		expect(reopened.commitPortEquipment(edit), edit.reason).toBe(true);
		expect(reopened.undo()).toBe(true);
		expect(reopened.portEquipment).toEqual(document.portEquipment);
		expect(reopened.redo()).toBe(true);
	});

	it("keeps all 64 Port identities at the maximum count and pitch", () => {
		const document = closedLoopDocument(330, 8);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const rows = Array.from({ length: 64 }, (_, index) => rowAt(slots, index + 2, 0));
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
		const source = document.portEquipment;
		const edit = planEqPortPitchEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, source, "EQ"),
			source,
			{ equipmentGroupId: 1, portId: 1 },
			5_000,
			document.map.getRevision(),
			document.getPatchSequence(),
			document.organizations,
		);
		expect(edit.portMutations).toHaveLength(63);
		expect(document.commitPortEquipment(edit), edit.reason).toBe(true);
		expect(document.portEquipment.equipmentGroups[0]?.portIds).toEqual(
			source.equipmentGroups[0]?.portIds,
		);
		expect(document.undo()).toBe(true);
		expect(document.portEquipment).toEqual(source);
	});

	it("rejects proposals crossing separated straight runs", () => {
		const document = new RailDocument();
		for (const [start, end] of [
			[0, 6],
			[8, 14],
		])
			expect(
				document.commit(
					planRailConstruction(
						document.map,
						{ x: start as number, y: 0 },
						{ x: end as number, y: 0 },
					),
				),
			).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					[2, 3].map((x) => rowAt(slots, x, 0)),
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					null,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		const plan = planEqPortPitchEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			{ equipmentGroupId: 1, portId: 1 },
			5_000,
			document.map.getRevision(),
			document.getPatchSequence(),
			document.organizations,
		);
		expect(plan).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/슬롯/),
		});
	});

	it("rechecks every proposed Port against supplied Process Loop containment", () => {
		const fixture = pitchFixture("east", [16, 17, 18]);
		const { document } = fixture;
		// A narrowed ownership snapshot is passed to preview directly: containment must be checked
		// independently of document admission (which also requires whole rail modules).
		const organizations = {
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AISLE" as const,
					declaredSemanticRole: "PROCESS_LOOP" as const,
					name: "Synthetic Loop",
					membership: {
						railEdges: buildRailModuleOwnershipIndex(document.map)
							.modules.flatMap((module) => module.eraseEdges)
							.filter((edge) => edge.from.x < 20 && edge.to.x < 20)
							.sort(compareDirectedRailEdges),
						advancedSwitchIds: [],
						equipmentGroupIds: [1],
					},
				},
			],
		};
		const plan = planEqPortPitchEdit(
			document.map,
			fixture.slots,
			portEquipmentGroupSlotIndexFor(fixture.slots),
			new PortSlotAvailabilityIndex(fixture.physical, document.portEquipment, "EQ"),
			document.portEquipment,
			{ equipmentGroupId: 1, portId: 2 },
			3_000,
			document.map.getRevision(),
			document.getPatchSequence(),
			organizations,
		);
		expect(plan).toMatchObject({ valid: false, reason: expect.stringMatching(/Loop.*밖/) });
	});
});

function pitchFixture(
	direction: "east" | "south" | "west" | "north" = "east",
	positions = [10, 11, 12],
) {
	const rails = closedLoopDocument(30, 30);
	const physical = compilePhysicalRail(rails.map);
	const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
	const rows = positions.map((position) =>
		rowAt(
			slots,
			direction === "east"
				? position
				: direction === "west"
					? 30 - position
					: direction === "south"
						? 30
						: 0,
			direction === "south"
				? position
				: direction === "north"
					? 30 - position
					: direction === "west"
						? 30
						: 0,
		),
	);
	const placement = planEqRowPlacement(
		slots,
		rows,
		new PortSlotAvailabilityIndex(physical, rails.portEquipment, "EQ"),
		rails.portEquipment,
		1_000,
		"PHOTO",
		rails.map.getRevision(),
		rails.getPatchSequence(),
	);
	expect(rails.commitPortEquipment(placement), placement.reason).toBe(true);
	const state: PortEquipmentState = {
		...rails.portEquipment,
		ports: rails.portEquipment.ports.map((port) => ({ ...port, direction: "AGAINST_TRAVEL" })),
	};
	const document = RailDocument.fromLoadedMap(rails.map, rails.getPatchSequence(), state);
	const plan = (pitch: number, anchorId = 2) =>
		planEqPortPitchEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			{ equipmentGroupId: 1, portId: anchorId },
			pitch,
			document.map.getRevision(),
			document.getPatchSequence(),
			document.organizations,
		);
	return { document, slots, physical, plan };
}
