import { describe, expect, it } from "vitest";
import { resolveStaticFabSelectionArrangementRoots } from "../compile/StaticFabArrangementRoots";
import { staticFabTranslationSelectionReason } from "../compile/StaticFabTranslationSelection";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { planRailPath } from "../core/paint";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	STATIC_FAB_ARRANGEMENT_VERSION,
	solveStaticFabArrangement,
} from "../core/StaticFabArrangement";
import {
	adoptStaticFabArrangementWorkerPlan,
	issueStaticFabArrangementPermit,
} from "../core/StaticFabArrangementCertification";
import {
	prepareStaticFabArrangementCommand,
	STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
	type StaticFabArrangementCommandIntent,
	staticFabArrangementCommandFingerprint,
} from "../core/StaticFabArrangementCommand";
import {
	compareDirectedRailEdges,
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { type Cell, TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot, checksumRailMap } from "./RailMirrorChecksum";
import { RailPatchMirror } from "./RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "./railMirrorProtocol";
import { STATIC_FAB_ARRANGEMENT_SESSION_VERSION } from "./StaticFabArrangementProtocol";
import {
	initializeStaticFabArrangementRuntimeSession,
	prepareStaticFabArrangementInSession,
} from "./StaticFabArrangementRuntime";
import {
	decodeStaticFabArrangementTransport,
	encodeStaticFabArrangementTransport,
} from "./StaticFabArrangementTransport";

function fixture(axis: "X" | "Z" = "X", distanceMeters = 1) {
	const map = new TileMap();
	addLoop(map, 0);
	const equipment: PortEquipmentState = {
		nextPortId: 6,
		nextEquipmentGroupId: 4,
		equipmentGroups: [
			{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			{ id: 2, kind: "EQ", pitchMillimeters: 2000, recipe: "TEST-RECIPE", portIds: [2, 3] },
			{ id: 3, kind: "STK", template: "FLEX", portIds: [4, 5] },
		],
		ports: [4, 10, 12, 20, 24].map((x, i) => ({
			id: i + 1,
			equipmentGroupId: i === 0 ? 1 : i < 3 ? 2 : 3,
			route: { kind: "CARDINAL_CELL" as const, x, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: i === 0 ? ("LEFT" as const) : ("CENTER" as const),
			lateralOffsetMillimeters: i === 0 ? 1000 : 0,
			direction: "WITH_TRAVEL" as const,
			portType: i === 0 ? ("OHB" as const) : i < 3 ? ("EQ" as const) : ("STK" as const),
			barcode: `KEEP-${i + 1}`,
		})),
	};
	const document = RailDocument.fromLoadedMap(map, 0, equipment, emptyStaticFabOrganizationState());
	const ownership = buildRailModuleOwnershipIndex(map);
	const intent: StaticFabArrangementCommandIntent = {
		version: STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
		arrangementVersion: STATIC_FAB_ARRANGEMENT_VERSION,
		mode: "TRANSLATE",
		axis,
		distanceMeters,
		equipmentGroupIds: [1, 2, 3],
		roots: [{ kind: "STATIC_COMPONENT", moduleKeys: ownership.modules.map((m) => m.key).sort() }],
	};
	return { document, intent };
}
function addLoop(map: TileMap, x0: number) {
	const cells: Cell[] = [];
	for (let x = 0; x <= 32; x++) cells.push({ x: x + x0, y: 0 });
	for (let y = 1; y <= 12; y++) cells.push({ x: 32 + x0, y });
	for (let x = 31; x >= 0; x--) cells.push({ x: x + x0, y: 12 });
	for (let y = 11; y >= 0; y--) cells.push({ x: x0, y });
	const plan = planRailPath(map, cells);
	if (!plan.valid) throw Error(plan.reason);
	map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? []);
}
function capture(document: RailDocument) {
	return captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	).snapshot;
}
function prepare(
	document: RailDocument,
	intent: StaticFabArrangementCommandIntent,
	ticketId = 1,
	fingerprint = staticFabArrangementCommandFingerprint(intent),
) {
	const session = initializeStaticFabArrangementRuntimeSession(capture(document)).session;
	return prepareStaticFabArrangementInSession(session, {
		type: "PREPARE_STATIC_FAB_ARRANGEMENT",
		version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
		sessionId: 1,
		requestId: 1,
		ticketId,
		intent,
		expectedIntentFingerprint: fingerprint,
	}).prepared;
}

describe("independent structure translation", () => {
	it.each([
		["X", 1],
		["X", -1],
		["Z", 1],
		["Z", -2],
	] as const)("moves %s by %i with self-overlap, stable identities and one mirrored history command", async (axis, distance) => {
		const { document: d, intent } = fixture(axis, distance),
			before = capture(d),
			equipment = d.portEquipment;
		const permit = issueStaticFabArrangementPermit(
			d.map,
			d.portEquipment,
			0,
			d.organizations,
			d.relationships,
			intent,
			before.checksum,
		);
		const prepared = prepare(d, intent, permit.ticketId);
		expect(prepared.valid, prepared.reason).toBe(true);
		expect(capture(d)).toEqual(before);
		const wire = structuredClone(encodeStaticFabArrangementTransport(prepared));
		const decoded = await decodeStaticFabArrangementTransport(wire, async () => {});
		if (!decoded.plan || !decoded.ticket) throw Error("Expected certified plan");
		expect(decoded.plan.equipmentGroupMutations).toEqual([]);
		expect(decoded.plan.organizationMutations).toEqual([]);
		const certified = adoptStaticFabArrangementWorkerPlan(
			permit,
			decoded.ticket,
			decoded.plan,
			decoded.ticket.prospectiveChecksum,
			d.map,
			d.portEquipment,
			d.getPatchSequence(),
			d.organizations,
			d.relationships,
			intent,
		);
		const events: RailPatchEvent[] = [];
		d.subscribe((e) => events.push(e));
		const mirror = new RailPatchMirror();
		mirror.sync(before);
		expect(d.commitStaticFabArrangement(certified)).toBe(true);
		expect(events).toHaveLength(1);
		expect(d.getPatchSequence()).toBe(1);
		expect(d.portEquipment.equipmentGroups).toEqual(equipment.equipmentGroups);
		expect(d.portEquipment.nextPortId).toBe(equipment.nextPortId);
		expect(d.portEquipment.nextEquipmentGroupId).toBe(equipment.nextEquipmentGroupId);
		for (const port of equipment.ports) {
			const moved = d.portEquipment.ports.find((p) => p.id === port.id);
			if (port.route.kind !== "CARDINAL_CELL") throw Error("Expected route");
			expect(moved).toEqual({
				...port,
				route: {
					...port.route,
					x: port.route.x + (axis === "X" ? distance : 0),
					z: port.route.z + (axis === "Z" ? distance : 0),
				},
			});
		}
		const after = checksumRailMap(d.map, d.portEquipment, d.organizations);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[0]).patch)).checksum,
		).toBe(after);
		expect(d.commitStaticFabArrangement(certified)).toBe(false);
		expect(events).toHaveLength(1);
		expect(d.undo()).toBe(true);
		expect(d.portEquipment).toEqual(equipment);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[1]).patch)).checksum,
		).toBe(before.checksum);
		expect(d.redo()).toBe(true);
		expect(events).toHaveLength(3);
		expect(
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(events[2]).patch)).checksum,
		).toBe(after);
	});
	it("binds signed distance, axis and exact equipment identities without weakening old alignment", () => {
		const { intent } = fixture();
		const base = staticFabArrangementCommandFingerprint(intent);
		for (const change of [
			{ distanceMeters: -1 },
			{ distanceMeters: 2 },
			{ axis: "Z" },
			{ equipmentGroupIds: [1, 2] },
		])
			expect(staticFabArrangementCommandFingerprint({ ...intent, ...change })).not.toBe(base);
		for (const distanceMeters of [NaN, Infinity, 0.5, 260097, "1", undefined])
			expect(prepareStaticFabArrangementCommand({ ...intent, distanceMeters }).valid).toBe(false);
		for (const roots of [
			[],
			[...intent.roots, ...intent.roots],
			[{ kind: "ORGANIZATION", organizationId: 1, selectionMode: "DIRECT" }],
		])
			expect(prepareStaticFabArrangementCommand({ ...intent, roots }).valid).toBe(false);
		const roots = [
			{ key: "a", bounds: { minX: 0, minZ: 0, maxXExclusive: 33, maxZExclusive: 13 } },
		];
		expect(
			solveStaticFabArrangement({
				version: STATIC_FAB_ARRANGEMENT_VERSION,
				axis: "X",
				mode: "ALIGN_MIN",
				roots,
			}),
		).toMatchObject({ valid: false, code: "TOO_FEW_ROOTS" });
	});
	it("rejects omitted equipment in both source selection and the Worker, including a changed-distance fingerprint", () => {
		const { document: d, intent } = fixture(),
			before = capture(d),
			ownership = buildRailModuleOwnershipIndex(d.map);
		const selection = createStaticFabSelection(
			createRailAreaSelectionFromOwnerships(ownership, ownership.modules, "fully-contained"),
			d.portEquipment,
			0,
			[],
		);
		const resolved = resolveStaticFabSelectionArrangementRoots(
			d.map,
			ownership,
			d.portEquipment,
			0,
			selection,
		);
		if (!resolved.valid) throw Error(resolved.reason);
		expect(staticFabTranslationSelectionReason(d.organizations, resolved.roots, [])).toContain(
			"장비가 빠졌습니다",
		);
		expect(prepare(d, { ...intent, equipmentGroupIds: [1, 2] })).toMatchObject({
			valid: false,
			ticket: null,
			failureCode: "selection",
		});
		expect(
			prepare(
				d,
				{ ...intent, distanceMeters: -1 },
				1,
				staticFabArrangementCommandFingerprint(intent),
			),
		).toMatchObject({ valid: false, ticket: null, failureCode: "fingerprint" });
		expect(capture(d)).toEqual(before);
	});
	it("rejects rail or equipment ownership before authorizing movement", () => {
		for (const owned of ["rail", "equipment"]) {
			const { document: source, intent } = fixture(),
				ownership = buildRailModuleOwnershipIndex(source.map);
			const organizations: StaticFabOrganizationState = {
				nextOrganizationId: 2,
				records: [
					{
						id: 1,
						kind: "AREA",
						name: "Owner",
						membership: {
							railEdges: ownership.modules
								.flatMap((module) => module.eraseEdges)
								.sort(compareDirectedRailEdges),
							advancedSwitchIds: [],
							equipmentGroupIds: owned === "equipment" ? [2] : [],
						},
					},
				],
			};
			const d = RailDocument.fromLoadedMap(source.map, 0, source.portEquipment, organizations),
				before = capture(d);
			const p = prepare(d, intent);
			expect(p.valid).toBe(false);
			expect(p.ticket).toBeNull();
			expect(p.reason).toContain("조직");
			expect(capture(d)).toEqual(before);
		}
	});
	it("rejects partial/external, open, multiple, stale and colliding structures without mutation", () => {
		const { document: d, intent } = fixture();
		const root = intent.roots[0];
		if (root.kind !== "STATIC_COMPONENT") throw Error("Expected component");
		const partial = { ...intent, roots: [{ ...root, moduleKeys: root.moduleKeys.slice(1) }] };
		expect(prepare(d, partial).valid).toBe(false);
		expect(prepare(d, { ...intent, roots: [{ ...root, moduleKeys: ["missing"] }] }).valid).toBe(
			false,
		);
		const map = new TileMap(),
			line = planRailPath(
				map,
				Array.from({ length: 15 }, (_, x) => ({ x, y: 0 })),
			);
		map.applyAtomicMutations(line.mutations, []);
		const open = RailDocument.fromLoadedMap(map, 0),
			keys = buildRailModuleOwnershipIndex(map).modules.map((m) => m.key);
		const p = prepare(open, {
			...intent,
			equipmentGroupIds: [],
			roots: [{ kind: "STATIC_COMPONENT", moduleKeys: keys }],
		});
		expect(p.valid).toBe(false);
		expect(p.reason).toContain("폐회로");
		addLoop(d.map, 50);
		const before = capture(d);
		expect(prepare(d, { ...intent, distanceMeters: 50 })).toMatchObject({
			valid: false,
			ticket: null,
			failureCode: "plan",
		});
		expect(prepare(d, { ...intent, distanceMeters: 0 }).valid).toBe(false);
		for (const distanceMeters of [-260096, 260096]) {
			const outside = prepare(d, { ...intent, distanceMeters });
			expect(outside).toMatchObject({ valid: false, ticket: null, failureCode: "plan" });
			expect(outside.reason).toContain("지원 범위");
		}
		expect(capture(d)).toEqual(before);
	});
	it("rejects an issued permit after a source mutation", () => {
		const { document: d, intent } = fixture(),
			before = capture(d);
		const permit = issueStaticFabArrangementPermit(
				d.map,
				d.portEquipment,
				0,
				d.organizations,
				d.relationships,
				intent,
				before.checksum,
			),
			p = prepare(d, intent, permit.ticketId);
		const { plan, ticket } = p;
		if (!plan || !ticket) throw Error(p.reason);
		addLoop(d.map, 50);
		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				permit,
				ticket,
				plan,
				ticket.prospectiveChecksum,
				d.map,
				d.portEquipment,
				d.getPatchSequence(),
				d.organizations,
				d.relationships,
				intent,
			),
		).toThrow();
	});
});
