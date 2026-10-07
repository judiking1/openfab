import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { compareDirectedRailEdges } from "../core/StaticFabOrganization";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { selectEqRowDraft } from "./EqRowDraftSelector";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { planResizeEqBody } from "./PortEquipmentEditPlanner";
import {
	PortEquipmentGroupSlotIndex,
	portEquipmentGroupSlotIndexFor,
} from "./PortEquipmentGroupEditPlanner";
import {
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
