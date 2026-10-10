import { describe, expect, it } from "vitest";
import { createPortEquipmentMutationPlan } from "../core/PortEquipmentPlan";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { compareDirectedRailEdges } from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import {
	adjacentFlexStkPortRow,
	deriveFlexStkPortMoveBodyPreview,
	flexStkPortDistanceForRow,
	flexStkPortRowAtDistance,
	planMoveFlexStkPort,
} from "./FlexStkPortMovePlanner";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { planResizeEqBody } from "./PortEquipmentEditPlanner";
import {
	describePortEquipmentGroupEditFailure,
	PortEquipmentGroupSlotIndex,
	planPortEquipmentGroupEdit,
	portEquipmentGroupSlotIndexFor,
} from "./PortEquipmentGroupEditPlanner";
import { compilePortEquipmentPresentation } from "./PortEquipmentPresentation";
import { planEqRowPlacement, planOhbPlacement, planStkPlacement } from "./PortPlacementPlanner";
import { PortSlotAvailabilityIndex } from "./PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "./PortSlotPreparedArtifacts";

describe("PortEquipmentGroupEditPlanner", () => {
	it("locates a named rejected Port without giving invalid previews mutation authority", () => {
		const document = closedLoopDocument(13, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const placement = planEqRowPlacement(
			slots,
			[2, 3, 4].map((x) => rowAt(slots, x, 0)),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1_000,
			null,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(placement)).toBe(true);
		const source = document.portEquipment,
			sequence = document.getPatchSequence();
		const plan = planPortEquipmentGroupEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, source, "EQ"),
			source,
			1,
			1,
			rowAt(slots, 11, 0),
			"move",
			document.map.getRevision(),
			sequence,
			"preview",
		);
		expect(plan.reason).toBe("PORT-2 maps to an unsafe rail slot.");
		expect(describePortEquipmentGroupEditFailure(plan, slots)).toEqual({
			kind: "port",
			sourcePortId: 2,
			targetRow: rowAt(slots, 12, 0),
		});
		expect(plan.portMutations).toHaveLength(0);
		expect(plan.equipmentGroupMutations).toHaveLength(0);
		expect(document.commitPortEquipment(plan)).toBe(false);
		expect(document.portEquipment).toBe(source);
		expect(document.getPatchSequence()).toBe(sequence);
		expect(
			describePortEquipmentGroupEditFailure(
				{ ...plan, reason: "PORT-3 has no matching rail slot after transformation." },
				slots,
			),
		).toEqual({ kind: "port", sourcePortId: 3, targetRow: null });
		for (const reason of [
			"Port slot data is stale.",
			"PORT-2 cannot be transformed.",
			"EQ 8 몸체가 EQ 9 몸체와 겹칩니다 · 별도 오류",
		])
			expect(describePortEquipmentGroupEditFailure({ ...plan, reason }, slots)).toBeNull();
		expect(
			describePortEquipmentGroupEditFailure(
				{ ...plan, baseRevision: plan.baseRevision + 1 },
				slots,
			),
		).toBeNull();
		expect(describePortEquipmentGroupEditFailure({ ...plan, valid: true }, slots)).toBeNull();
	});

	it.each([
		"move",
		"copy",
	] as const)("rejects authored EQ body overlap in %s preview before applying", (mode) => {
		const document = closedLoopDocument(30, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const index = new PortEquipmentGroupSlotIndex(slots);
		for (const xs of [
			[2, 3],
			[12, 13],
		]) {
			const placement = planEqRowPlacement(
				slots,
				xs.map((x) => rowAt(slots, x, 0)),
				new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
				document.portEquipment,
				1_000,
				null,
				document.map.getRevision(),
				document.getPatchSequence(),
			);
			expect(document.commitPortEquipment(placement), placement.reason).toBe(true);
		}
		const resize = planResizeEqBody(
			document.map,
			document.portEquipment,
			{ portId: 1, equipmentGroupId: 1 },
			{ lengthMillimeters: 10_000, widthMillimeters: 900 },
			document.map.getRevision(),
			document.getPatchSequence(),
			document.organizations,
		);
		expect(document.commitPortEquipment(resize), resize.reason).toBe(true);
		const source = document.portEquipment;
		const sequence = document.getPatchSequence();
		const planAt = (x: number, z: number, validation: "preview" | "commit") =>
			planPortEquipmentGroupEdit(
				document.map,
				slots,
				index,
				new PortSlotAvailabilityIndex(physical, source, "EQ"),
				source,
				1,
				1,
				rowAt(slots, x, z),
				mode,
				document.map.getRevision(),
				sequence,
				validation,
				document.organizations,
			);
		for (const validation of ["preview", "commit"] as const) {
			const rejected = planAt(8, 0, validation);
			expect(rejected.valid, rejected.reason).toBe(false);
			expect(rejected.reason).toContain("겹칩니다");
			expect(describePortEquipmentGroupEditFailure(rejected, slots)).toMatchObject({
				kind: "body",
			});
			const accepted = planAt(15, 4, validation);
			expect(accepted.valid, accepted.reason).toBe(true);
		}
		expect(planAt(15, 4, "preview").portMutations).toEqual(planAt(15, 4, "commit").portMutations);
		expect(document.portEquipment).toBe(source);
		expect(document.getPatchSequence()).toBe(sequence);
	});
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

describe("individual FLEX STK Port movement", () => {
	it.each([
		"east",
		"south",
		"west",
		"north",
	] as const)("resolves signed distance from the %s source, retaining ordinary move validation", (direction) => {
		const cell = (along: number) =>
			direction === "east"
				? [along, 0]
				: direction === "south"
					? [20, along]
					: direction === "west"
						? [20 - along, 20]
						: [0, 20 - along];
		const f = flexPortFixture([4, 8, 14].map(cell));
		const source = f.document.portEquipment.ports.find(
			(port) =>
				port.route.kind === "CARDINAL_CELL" &&
				port.route.x === cell(8)[0] &&
				port.route.z === cell(8)[1],
		) as PortRecord;
		const index = new PortEquipmentGroupSlotIndex(f.slots);
		for (const distance of [-2, 0, 3]) {
			const target = cell(8 + distance);
			const row = flexStkPortRowAtDistance(f.slots, index, source, distance);
			expect(row).toBe(rowAt(f.slots, target[0] as number, target[1] as number));
			expect(flexStkPortDistanceForRow(f.slots, source, row)).toBe(distance);
			expect(f.plan(target, source.id).valid).toBe(distance !== 0);
		}
		expect(f.plan(cell(14), source.id).valid).toBe(false);
		for (const value of [Number.NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, 1000]) {
			expect(flexStkPortRowAtDistance(f.slots, index, source, value)).toBeNull();
		}
	});

	it("cannot use a distant matching slot to bypass a gap or stale slot index", () => {
		const f = flexPortFixture();
		const source = f.document.portEquipment.ports[1] as PortRecord;
		const index = new PortEquipmentGroupSlotIndex(f.slots);
		expect(flexStkPortRowAtDistance(f.slots, index, source, 27)).toBe(rowAt(f.slots, 35, 0));
		expect(f.plan([35, 0]).valid).toBe(false);
		const empty = compilePortSlotPreparedArtifactCatalog(compilePhysicalRail(new TileMap())).STK
			.slots;
		expect(flexStkPortRowAtDistance(empty, index, source, 1)).toBeNull();
		for (const row of [null, -1, 1.5, f.slots.count])
			expect(flexStkPortDistanceForRow(f.slots, source, row)).toBeNull();
	});

	it("nudges exact neighboring slots without a renderer and never jumps sideways or across a gap", () => {
		const f = flexPortFixture(),
			index = new PortEquipmentGroupSlotIndex(f.slots),
			current = rowAt(f.slots, 8, 0);
		expect(
			adjacentFlexStkPortRow(
				f.slots,
				index,
				f.document.portEquipment.ports[1] as PortRecord,
				current,
				1,
				0,
			),
		).toBe(rowAt(f.slots, 9, 0));
		expect(
			adjacentFlexStkPortRow(
				f.slots,
				index,
				f.document.portEquipment.ports[1] as PortRecord,
				current,
				-1,
				0,
			),
		).toBe(rowAt(f.slots, 7, 0));
		expect(
			adjacentFlexStkPortRow(
				f.slots,
				index,
				f.document.portEquipment.ports[1] as PortRecord,
				current,
				0,
				1,
			),
		).toBeNull();
		expect(
			adjacentFlexStkPortRow(
				f.slots,
				index,
				f.document.portEquipment.ports[1] as PortRecord,
				current,
				1,
				1,
			),
		).toBeNull();
		expect(
			adjacentFlexStkPortRow(
				f.slots,
				index,
				f.document.portEquipment.ports[1] as PortRecord,
				-1,
				1,
				0,
			),
		).toBeNull();
		expect(
			adjacentFlexStkPortRow(
				f.slots,
				index,
				f.document.portEquipment.ports[1] as PortRecord,
				rowAt(f.slots, 19, 0),
				1,
				0,
			),
		).toBeNull();
	});

	it.each([
		"east",
		"south",
		"west",
		"north",
	] as const)("moves one %s Port with retained identities, typed Worker and exact Undo/Redo", (direction) => {
		const cell = (along: number) =>
			direction === "east"
				? [along, 0]
				: direction === "south"
					? [20, along]
					: direction === "west"
						? [20 - along, 20]
						: [0, 20 - along];
		const f = flexPortFixture([4, 8, 14].map(cell));
		const before = f.document.portEquipment,
			organizations = f.document.organizations;
		const middle = before.ports.find(
			(p) =>
				p.route.kind === "CARDINAL_CELL" && p.route.x === cell(8)[0] && p.route.z === cell(8)[1],
		) as PortRecord;
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(
				f.document.map,
				f.document.getPatchSequence(),
				before,
				organizations,
			).snapshot,
		);
		const buffers = mirror.getPhysicalPublication().current.buffers;
		const events: RailPatchEvent[] = [];
		f.document.subscribe((event) => {
			events.push(event);
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(event).patch));
		});
		const plan = f.plan(cell(9), middle.id);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.portMutations).toHaveLength(1);
		expect(plan.groupEdit).toMatchObject({ scope: "port", mode: "move" });
		expect(f.document.portEquipment).toBe(before);
		expect(events).toHaveLength(0);
		expect(
			f.document.commitPortEquipment(plan),
			f.document.getLastCommandError() ?? plan.reason,
		).toBe(true);
		const after = f.document.portEquipment;
		expect(after.nextPortId).toBe(before.nextPortId);
		expect(after.nextEquipmentGroupId).toBe(before.nextEquipmentGroupId);
		for (const port of before.ports)
			expect(after.ports.find((p) => p.id === port.id)).toEqual(
				port.id === middle.id
					? { ...port, route: { ...port.route, x: cell(9)[0], z: cell(9)[1] } }
					: port,
			);
		expect(after.equipmentGroups).toEqual(before.equipmentGroups);
		expect(f.document.organizations).toBe(organizations);
		expect(f.document.undo()).toBe(true);
		expect(f.document.portEquipment).toEqual(before);
		expect(f.document.redo()).toBe(true);
		expect(f.document.portEquipment).toEqual(after);
		expect(events).toHaveLength(3);
		expect(
			events.every(
				(e) =>
					e.portChanges.length === 1 &&
					e.changes.length === 0 &&
					e.organizationChanges.length === 0,
			),
		).toBe(true);
		expect(mirror.state.checksum).toBe(checksumRailMap(f.document.map, after, organizations));
		expect(mirror.getPhysicalPublication().current.buffers).toBe(buffers);
	});

	it.each([
		[8, 0],
		[14, 0],
		[8, 20],
		[20, 8],
		[38, 0],
		[1, 0],
		[18, 0],
	])("rejects unchanged, occupied, wrong-run, unsafe or resized target %j without any mutation", (x, z) => {
		const f = flexPortFixture();
		const before = f.document.portEquipment,
			sequence = f.document.getPatchSequence();
		const plan = f.plan([x, z]);
		expect(plan.valid, plan.reason).toBe(false);
		expect(plan.portMutations).toEqual([]);
		expect(plan.equipmentGroupMutations).toEqual([]);
		expect(f.document.commitPortEquipment(plan)).toBe(false);
		expect(f.document.portEquipment).toBe(before);
		expect(f.document.getPatchSequence()).toBe(sequence);
	});

	it("rejects a collinear gap and a branch inside the candidate interval", () => {
		for (const branch of [false, true]) {
			const source = closedLoopDocument(20, 20);
			if (branch)
				expect(
					source.commit(planRailConstruction(source.map, { x: 10, y: 0 }, { x: 10, y: -8 })),
				).toBe(true);
			else
				expect(
					source.commit(planRailConstruction(source.map, { x: 30, y: 0 }, { x: 50, y: 0 })),
				).toBe(true);
			const f = flexPortFixture(
				[
					[4, 0],
					[6, 0],
				],
				source,
			);
			expect(f.plan(branch ? [14, 0] : [38, 0]).reason).toMatch(/같은 연속 직선/);
		}
	});

	it("preserves source when revision, sequence, prepared slots or state changes", () => {
		const f = flexPortFixture(),
			old = f.plan([9, 0]);
		expect(f.document.commitPortEquipment(f.plan([7, 0]))).toBe(true);
		const current = f.document.portEquipment,
			sequence = f.document.getPatchSequence();
		expect(f.document.commitPortEquipment(old)).toBe(false);
		expect(f.document.portEquipment).toBe(current);
		expect(f.document.getPatchSequence()).toBe(sequence);
		expect(
			planMoveFlexStkPort(
				f.document.map,
				f.slots,
				new PortEquipmentGroupSlotIndex(f.slots),
				f.availability,
				current,
				{ equipmentGroupId: 1, portId: 2 },
				rowAt(f.slots, 9, 0),
				f.document.map.getRevision(),
				sequence,
				f.document.organizations,
			).valid,
		).toBe(false);
		expect(
			f.document.commit(planRailConstruction(f.document.map, { x: 60, y: 0 }, { x: 70, y: 0 })),
		).toBe(true);
		expect(f.plan([9, 0]).reason).toMatch(/変更|변경/);
	});

	it("keeps service facing and canonical identities when the moved Port crosses another Port", () => {
		const f = flexPortFixture([
			[4, 0],
			[7, 0],
			[10, 0],
			[14, 0],
		]);
		const before = f.document.portEquipment;
		const plan = f.plan([11, 0], 2);
		expect(plan.valid, plan.reason).toBe(true);
		expect(f.document.commitPortEquipment(plan)).toBe(true);
		expect(f.document.portEquipment.equipmentGroups[0]?.portIds).toEqual([1, 3, 2, 4]);
		expect(f.document.portEquipment.ports.find((p) => p.id === 3)).toEqual(before.ports[2]);
		expect(f.document.undo()).toBe(true);
		expect(f.document.portEquipment).toEqual(before);
	});

	it.each([
		false,
		true,
	])("previews the actual shifted FLEX body, retaining other sections: extra=%s", (extraSection) => {
		const f = flexPortFixture(
			[
				[4, 0],
				[9, 0],
				[14, 0],
				...(extraSection
					? [
							[26, 4],
							[26, 9],
						]
					: []),
			],
			closedLoopDocument(26, 20),
		);
		const source = f.document.portEquipment;
		const before = compilePortEquipmentPresentation(f.physical, source);
		const sequence = f.document.getPatchSequence();
		const plan = f.plan([19, 0], 1);
		expect(plan.valid, plan.reason).toBe(true);
		const preview = deriveFlexStkPortMoveBodyPreview(f.physical, source, plan);
		expect(f.document.portEquipment).toBe(source);
		expect(f.document.getPatchSequence()).toBe(sequence);
		expect(preview).toHaveLength(extraSection ? 2 : 1);
		const moved = preview.find((body) => body.tangentZ === 0);
		expect(moved?.centerX).toBe(14.5);
		expect(Array.from(before.bodySectionCenters).filter((_, i) => i % 2 === 0)).toContain(9.5);
		expect(f.document.commitPortEquipment(plan)).toBe(true);
		const applied = compilePortEquipmentPresentation(f.physical, f.document.portEquipment);
		expect(
			Array.from(new Float32Array(preview.flatMap((body) => [body.centerX, body.centerZ]))),
		).toEqual(Array.from(applied.bodySectionCenters));
		expect(
			Array.from(new Float32Array(preview.flatMap((body) => [body.tangentX, body.tangentZ]))),
		).toEqual(Array.from(applied.bodySectionTangents));
		expect(
			Array.from(new Float32Array(preview.flatMap((body) => [body.halfLength, body.halfWidth]))),
		).toEqual(Array.from(applied.bodySectionHalfExtents));
		expect(applied.bodySectionHalfExtents).toEqual(before.bodySectionHalfExtents);
		if (extraSection) {
			const retained = preview.find((body) => body.tangentZ !== 0);
			expect(retained?.centerX).toBe(26.5);
			expect(retained?.centerZ).toBe(7);
		}
	});

	it("does not derive a body ghost for invalid or stale single-Port previews", () => {
		const f = flexPortFixture();
		const source = f.document.portEquipment;
		const valid = f.plan([9, 0]);
		expect(deriveFlexStkPortMoveBodyPreview(f.physical, source, f.plan([14, 0]))).toEqual([]);
		expect(
			deriveFlexStkPortMoveBodyPreview(f.physical, source, {
				...valid,
				baseRevision: valid.baseRevision + 1,
			}),
		).toEqual([]);
		expect(f.document.commitPortEquipment(f.plan([7, 0]))).toBe(true);
		expect(deriveFlexStkPortMoveBodyPreview(f.physical, f.document.portEquipment, valid)).toEqual(
			[],
		);
	});

	it("rejects strict STK presets and single-Port FLEX without changing group movement", () => {
		const f = flexPortFixture(
			[
				[4, 0],
				[5, 0],
				[6, 0],
				[7, 0],
			],
			undefined,
			"FOUR_PORT",
		);
		expect(f.plan([8, 0]).reason).toMatch(/FLEX/);
		const one = flexPortFixture([[4, 0]]);
		expect(one.plan([5, 0], 1).reason).toMatch(/여러 Port/);
		const whole = planPortEquipmentGroupEdit(
			f.document.map,
			f.slots,
			new PortEquipmentGroupSlotIndex(f.slots),
			f.availability,
			f.document.portEquipment,
			1,
			1,
			rowAt(f.slots, 6, 0),
			"move",
			f.document.map.getRevision(),
			f.document.getPatchSequence(),
			"commit",
			f.document.organizations,
		);
		expect(whole.valid, whole.reason).toBe(true);
		expect(whole.groupEdit.portTargets).toHaveLength(4);
	});

	it("retains Loop ownership and rejects outside Loop or invalid slots in Document and Worker", () => {
		const f = flexPortFixture(),
			source = f.document;
		const railEdges = buildRailModuleOwnershipIndex(source.map)
			.modules.flatMap((m) => m.eraseEdges)
			.filter((e) => e.from.x < 30 && e.to.x < 30)
			.sort(compareDirectedRailEdges);
		const owned = RailDocument.fromLoadedMap(
			source.map,
			source.getPatchSequence(),
			source.portEquipment,
			{
				nextOrganizationId: 2,
				records: [
					{
						id: 1,
						kind: "AISLE",
						declaredSemanticRole: "PROCESS_LOOP",
						name: "Synthetic Loop",
						membership: { railEdges, advancedSwitchIds: [], equipmentGroupIds: [1] },
					},
				],
			},
		);
		const plan = (x: number) =>
			planMoveFlexStkPort(
				owned.map,
				f.slots,
				new PortEquipmentGroupSlotIndex(f.slots),
				new PortSlotAvailabilityIndex(f.physical, owned.portEquipment, "STK"),
				owned.portEquipment,
				{ equipmentGroupId: 1, portId: 2 },
				rowAt(f.slots, x, 0),
				owned.map.getRevision(),
				owned.getPatchSequence(),
				owned.organizations,
			);
		const valid = plan(9);
		expect(valid.valid, valid.reason).toBe(true);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(
				owned.map,
				owned.getPatchSequence(),
				owned.portEquipment,
				owned.organizations,
			).snapshot,
		);
		owned.subscribe((event) =>
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(event).patch)),
		);
		expect(owned.commitPortEquipment(valid)).toBe(true);
		expect(owned.undo()).toBe(true);
		expect(owned.redo()).toBe(true);
		expect(mirror.state.checksum).toBe(
			checksumRailMap(owned.map, owned.portEquipment, owned.organizations),
		);
		const original = owned.portEquipment.ports[1] as PortRecord;
		const group = owned.portEquipment.equipmentGroups[0];
		if (!group) throw new Error("Expected the owned fixture group");
		for (const x of [14, 1, 38]) {
			const moved = { ...original, route: { ...original.route, x } } as PortRecord;
			const forged = createPortEquipmentMutationPlan(
				"edit-port-equipment",
				owned.map.getRevision(),
				owned.getPatchSequence(),
				[{ id: original.id, before: original, after: moved }],
				x === 38
					? [
							{
								id: 1,
								before: group,
								after: { ...group, portIds: [1, 3, 2] },
							},
						]
					: [],
			);
			const before = owned.portEquipment,
				sequence = owned.getPatchSequence(),
				state = mirror.state;
			expect(owned.commitPortEquipment(forged)).toBe(false);
			if (x === 38) expect(owned.getLastCommandError()).toMatch(/Loop.*밖/);
			expect(owned.portEquipment).toBe(before);
			expect(owned.getPatchSequence()).toBe(sequence);
			const patch: RailPatchEvent = {
				kind: "edit-port-equipment",
				sequence: sequence + 1,
				baseRevision: owned.map.getRevision(),
				revision: owned.map.getRevision(),
				changes: [],
				switchChanges: [],
				portChanges: forged.portMutations,
				equipmentGroupChanges: forged.equipmentGroupMutations,
				organizationChanges: [],
				organizationNextIdBefore: 2,
				organizationNextIdAfter: 2,
				relationshipChanges: [],
				relationshipNextIdBefore: 1,
				relationshipNextIdAfter: 1,
			};
			expect(() =>
				mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(patch).patch)),
			).toThrow();
			expect(mirror.state).toEqual(state);
		}
	});

	it("rejects an expanded reservation around another equipment body in planner, Document and Worker", () => {
		const f = flexPortFixture([
				[4, 0],
				[8, 0],
			]),
			d = f.document;
		const ohbSlots = compilePortSlotPreparedArtifactCatalog(f.physical).OHB.slots;
		expect(
			d.commitPortEquipment(
				planOhbPlacement(
					ohbSlots,
					rowAt(ohbSlots, 11, 0),
					new PortSlotAvailabilityIndex(f.physical, d.portEquipment, "OHB"),
					d.portEquipment,
					d.map.getRevision(),
					d.getPatchSequence(),
				),
			),
		).toBe(true);
		const rejected = f.plan([14, 0]);
		expect(rejected.valid).toBe(false);
		expect(rejected.reason).toMatch(/reservation|몸체/);
		const before = d.portEquipment,
			sequence = d.getPatchSequence(),
			original = before.ports[1] as PortRecord;
		const moved = { ...original, route: { ...original.route, x: 14 } } as PortRecord;
		const forged = createPortEquipmentMutationPlan(
			"edit-port-equipment",
			d.map.getRevision(),
			sequence,
			[{ id: original.id, before: original, after: moved }],
			[],
		);
		expect(d.commitPortEquipment(forged)).toBe(false);
		expect(d.portEquipment).toBe(before);
		expect(d.getPatchSequence()).toBe(sequence);
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(d.map, sequence, before, d.organizations).snapshot);
		const state = mirror.state;
		const patch: RailPatchEvent = {
			kind: "edit-port-equipment",
			sequence: sequence + 1,
			baseRevision: d.map.getRevision(),
			revision: d.map.getRevision(),
			changes: [],
			switchChanges: [],
			portChanges: forged.portMutations,
			equipmentGroupChanges: [],
			organizationChanges: [],
			organizationNextIdBefore: 1,
			organizationNextIdAfter: 1,
			relationshipChanges: [],
			relationshipNextIdBefore: 1,
			relationshipNextIdAfter: 1,
		};
		expect(() => mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(patch).patch))).toThrow(
			/reservation/,
		);
		expect(mirror.state).toEqual(state);
	});

	it("keeps an authored reversed service direction while moving only its slot", () => {
		const f = flexPortFixture();
		const before = f.document.portEquipment;
		const state = {
			...before,
			ports: before.ports.map((port) => ({ ...port, direction: "AGAINST_TRAVEL" as const })),
		};
		const d = RailDocument.fromLoadedMap(f.document.map, f.document.getPatchSequence(), state);
		const plan = planMoveFlexStkPort(
			d.map,
			f.slots,
			new PortEquipmentGroupSlotIndex(f.slots),
			new PortSlotAvailabilityIndex(f.physical, d.portEquipment, "STK"),
			d.portEquipment,
			{ equipmentGroupId: 1, portId: 2 },
			rowAt(f.slots, 9, 0),
			d.map.getRevision(),
			d.getPatchSequence(),
			d.organizations,
		);
		expect(d.commitPortEquipment(plan), plan.reason).toBe(true);
		expect(d.portEquipment.ports.every((port) => port.direction === "AGAINST_TRAVEL")).toBe(true);
	});

	it("round-trips the native project with empty reopened history and permits another move", () => {
		const f = flexPortFixture();
		expect(f.document.commitPortEquipment(f.plan([9, 0]))).toBe(true);
		const json = serializeOpenFabProject(
			captureOpenFabProject(f.document, {
				manifest: {
					id: "flex-port-move-test",
					name: "Synthetic STK Port",
					createdAt: "2026-10-09T00:00:00.000Z",
					updatedAt: "2026-10-09T00:00:00.000Z",
				},
			}),
		);
		const startup = compileRailStartup({ kind: "project-json", json }),
			reopened = hydrateRailMirrorSnapshotDocument(startup.snapshot);
		expect(reopened.portEquipment).toEqual(f.document.portEquipment);
		expect(reopened.canUndo).toBe(false);
		const physical = compilePhysicalRail(reopened.map),
			slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const plan = planMoveFlexStkPort(
			reopened.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, reopened.portEquipment, "STK"),
			reopened.portEquipment,
			{ equipmentGroupId: 1, portId: 2 },
			rowAt(slots, 8, 0),
			reopened.map.getRevision(),
			reopened.getPatchSequence(),
			reopened.organizations,
		);
		expect(reopened.commitPortEquipment(plan), plan.reason).toBe(true);
		expect(reopened.undo()).toBe(true);
		expect(reopened.portEquipment).toEqual(f.document.portEquipment);
		expect(reopened.redo()).toBe(true);
	});
});

function flexPortFixture(
	cells: number[][] = [
		[4, 0],
		[8, 0],
		[14, 0],
	],
	source?: RailDocument,
	template: "FLEX" | "FOUR_PORT" = "FLEX",
) {
	const document = source ?? closedLoopDocument(20, 20);
	if (!source)
		expect(
			document.commit(planRailConstruction(document.map, { x: 30, y: 0 }, { x: 50, y: 0 })),
		).toBe(true);
	const physical = compilePhysicalRail(document.map),
		slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
	const placement = planStkPlacement(
		slots,
		cells.map(([x, z]) => rowAt(slots, x as number, z as number)),
		new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
		document.portEquipment,
		template,
		document.map.getRevision(),
		document.getPatchSequence(),
	);
	expect(document.commitPortEquipment(placement), placement.reason).toBe(true);
	const availability = new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK");
	const plan = (cell: number[], id = 2) =>
		planMoveFlexStkPort(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			{ equipmentGroupId: 1, portId: id },
			rowAt(slots, cell[0] as number, cell[1] as number),
			document.map.getRevision(),
			document.getPatchSequence(),
			document.organizations,
		);
	return { document, physical, slots, availability, plan };
}
