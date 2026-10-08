import { describe, expect, it } from "vitest";
import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import {
	createConnectedStaticFabSelection,
	createEquipmentProcessLoopRailSelection,
} from "./ConnectedStaticFabSelection";
import type { PortEquipmentState } from "./EquipmentGroup";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { planRailRouteBatch } from "./RailTemplateCatalog";
import { DIR_E, DIR_W, type Direction, moveCell } from "./railShape";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
	emptyStaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import { type Cell, encodeRailCell, TileMap } from "./TileMap";

describe("ConnectedStaticFabSelection", () => {
	it.each([
		"OHB",
		"EQ",
		"STK",
	] as const)("offers only rail selection for an unregistered %s component", (kind) => {
		const map = closedLoops(0, 20);
		const ownership = buildRailModuleOwnershipIndex(map);
		const equipment = singleLoopEquipment(kind);
		const before = [map.getRevision(), map.getMutationGeneration(), map.size, map.edgeCount];
		const result = createEquipmentProcessLoopRailSelection(
			map,
			ownership,
			equipment,
			emptyStaticFabOrganizationState(),
			7,
			1,
		);
		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.selection.equipmentGroups).toEqual([]);
		expect(result.selection.rail.bounds).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 6 });
		expect(result.selection.basePatchSequence).toBe(7);
		expect([map.getRevision(), map.getMutationGeneration(), map.size, map.edgeCount]).toEqual(
			before,
		);
		expect(equipment.equipmentGroups).toHaveLength(1);
	});

	it("keeps Loop discovery on the selected equipment rails while ordinary selection follows bridges", () => {
		const map = closedLoops(0, 10);
		const ownership = buildRailModuleOwnershipIndex(map);
		const state = bridgedPortEquipment();
		const equipment = { ...state, ports: [...state.ports.slice(0, 2), port(3, 2, 2, "OHB")] };
		const ordinary = createConnectedStaticFabSelection(map, ownership, equipment, 1, {
			equipmentGroupIds: [2],
		});
		expect(ordinary.valid).toBe(true);
		if (!ordinary.valid) throw new Error(ordinary.reason);
		expect(ordinary.selection.rail.bounds).toEqual({ minX: 0, minY: 0, maxX: 16, maxY: 6 });
		expect(ordinary.selection.equipmentGroups.map(({ group }) => group.id).sort()).toEqual([1, 2]);
		const registration = createEquipmentProcessLoopRailSelection(
			map,
			ownership,
			equipment,
			emptyStaticFabOrganizationState(),
			1,
			2,
		);
		expect(registration.valid).toBe(true);
		if (!registration.valid) throw new Error(registration.reason);
		expect(registration.selection.rail.bounds).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 6 });
		expect(registration.railCellCount).toBe(ordinary.railCellCount / 2);
		expect(registration.selection.equipmentGroups).toEqual([]);
		expect(
			createEquipmentProcessLoopRailSelection(
				map,
				ownership,
				equipment,
				emptyStaticFabOrganizationState(),
				1,
				1,
			),
		).toMatchObject({ valid: false, reason: "Port가 여러 연결 레일에 걸쳐 있습니다" });
	});

	it("refuses open rail, split equipment support and stale ownership without guessing a Loop", () => {
		const equipment = singleLoopEquipment("OHB");
		const open = disconnectedLines(0);
		expect(
			createEquipmentProcessLoopRailSelection(
				open,
				buildRailModuleOwnershipIndex(open),
				equipment,
				emptyStaticFabOrganizationState(),
				1,
				1,
			),
		).toMatchObject({ valid: false, reason: "연결 레일을 먼저 폐쇄하세요" });
		const map = closedLoops(0, 10, 20);
		const ownership = buildRailModuleOwnershipIndex(map);
		expect(
			createEquipmentProcessLoopRailSelection(
				map,
				ownership,
				bridgedPortEquipment(),
				emptyStaticFabOrganizationState(),
				1,
				1,
			),
		).toMatchObject({ valid: false, reason: "Port가 여러 연결 레일에 걸쳐 있습니다" });
		map.setEncoded(50, 50, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		expect(
			createEquipmentProcessLoopRailSelection(
				map,
				ownership,
				equipment,
				emptyStaticFabOrganizationState(),
				1,
				1,
			).valid,
		).toBe(false);
	});

	it("refuses stored rail overlap and direct equipment ownership but permits an unrelated organization", () => {
		const map = closedLoops(0, 20);
		const ownership = buildRailModuleOwnershipIndex(map);
		const equipment = singleLoopEquipment("EQ");
		const organizations = (offset: number, groupIds: number[] = []) =>
			copyStaticFabOrganizationState({
				nextOrganizationId: 2,
				records: [
					{
						id: 1,
						kind: "AISLE",
						name: "Existing Loop",
						declaredSemanticRole: "PROCESS_LOOP",
						membership: {
							railEdges: [
								...new Map(
									ownership.modules
										.flatMap((module) => module.eraseEdges)
										.filter((edge) => edge.from.x >= offset && edge.from.x <= offset + 6)
										.map((edge) => [staticFabOrganizationEdgeKey(edge), edge]),
								).values(),
							].sort(compareDirectedRailEdges),
							advancedSwitchIds: [],
							equipmentGroupIds: groupIds,
						},
					},
				],
			});
		expect(
			createEquipmentProcessLoopRailSelection(map, ownership, equipment, organizations(0), 1, 1),
		).toMatchObject({ valid: false, reason: "이미 조직에 속한 레일입니다" });
		expect(
			createEquipmentProcessLoopRailSelection(map, ownership, equipment, organizations(20), 1, 1)
				.valid,
		).toBe(true);
		expect(
			createEquipmentProcessLoopRailSelection(
				map,
				ownership,
				equipment,
				organizations(20, [1]),
				1,
				1,
			),
		).toMatchObject({ valid: false, reason: "장비가 이미 조직에 속해 있습니다" });
	});

	it("selects one exact weakly connected rail component", () => {
		const map = disconnectedLines(0, 10);
		const ownership = buildRailModuleOwnershipIndex(map);
		const first = ownership.resolve({ x: 1, y: 0 });
		if (first.status !== "resolved") throw new Error(first.reason);

		const result = createConnectedStaticFabSelection(map, ownership, emptyPortEquipment(), 4, {
			railModuleKeys: [first.module.key],
		});

		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.railCellCount).toBe(3);
		expect(result.selection.rail.ownerships).toHaveLength(1);
		expect(result.selection.rail.bounds).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 0 });
		expect(result.selection.equipmentGroups).toEqual([]);
		expect(result.selection.basePatchSequence).toBe(4);
	});

	it("expands through one complete equipment group without admitting unrelated equipment", () => {
		const map = disconnectedLines(0, 10, 20);
		const ownership = buildRailModuleOwnershipIndex(map);
		const first = ownership.resolve({ x: 1, y: 0 });
		if (first.status !== "resolved") throw new Error(first.reason);
		const state = bridgedPortEquipment();

		const result = createConnectedStaticFabSelection(map, ownership, state, 9, {
			railModuleKeys: [first.module.key],
		});

		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.railCellCount).toBe(6);
		expect(result.selection.rail.ownerships).toHaveLength(2);
		expect(result.selection.equipmentGroups.map((selected) => selected.group.id)).toEqual([1]);
		expect(result.selection.equipmentGroups[0]?.ports.map((port) => port.id)).toEqual([1, 2]);
	});

	it("can start from an equipment group and rejects stale or incomplete seeds", () => {
		const map = disconnectedLines(0, 10, 20);
		const ownership = buildRailModuleOwnershipIndex(map);
		const state = bridgedPortEquipment();

		const selected = createConnectedStaticFabSelection(map, ownership, state, 2, {
			equipmentGroupIds: [1],
		});
		expect(selected.valid).toBe(true);
		if (selected.valid) {
			expect(selected.selection.rail.ownerships).toHaveLength(2);
			expect(selected.selection.equipmentGroups).toHaveLength(1);
		}

		const missing = createConnectedStaticFabSelection(map, ownership, state, 2, {
			equipmentGroupIds: [999],
		});
		expect(missing).toMatchObject({ valid: false, selection: null });

		map.setEncoded(30, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		const stale = createConnectedStaticFabSelection(map, ownership, state, 2, {
			equipmentGroupIds: [1],
		});
		expect(stale).toMatchObject({ valid: false, selection: null });
	});

	it("traverses every physical leg owned by one advanced switch module", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(document.commit(switchPlan)).toBe(true);
		if (!switchPlan.switchRecord) throw new Error("expected advanced switch record");
		for (const output of deriveAdvancedSwitchGeometry(switchPlan.switchRecord).outputs) {
			const extension = planRailConstruction(
				document.map,
				output.cell,
				moveRepeated(output.cell, output.direction, 3),
			);
			expect(extension.valid, extension.reason).toBe(true);
			expect(document.commit(extension)).toBe(true);
		}
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const input = ownership.resolve({ x: -2, y: 0 });
		if (input.status !== "resolved") throw new Error(input.reason);

		const result = createConnectedStaticFabSelection(
			document.map,
			ownership,
			emptyPortEquipment(),
			document.getPatchSequence(),
			{ railModuleKeys: [input.module.key] },
		);

		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.reason);
		expect(result.selection.rail.ownerships).toHaveLength(ownership.modules.length);
		expect(
			result.selection.rail.ownerships.some((module) => module.kind === "advanced-switch"),
		).toBe(true);
		let railCellCount = 0;
		document.map.forEachRail(() => railCellCount++);
		expect(result.railCellCount).toBe(railCellCount);
		const equipment: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [port(1, 1, -2, "OHB")],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		expect(
			createEquipmentProcessLoopRailSelection(
				document.map,
				ownership,
				equipment,
				emptyStaticFabOrganizationState(),
				document.getPatchSequence(),
				1,
			),
		).toMatchObject({
			valid: false,
			reason: "고급 스위치는 선택 메뉴에서 직접 등록하세요",
		});
	});
});

function moveRepeated(cell: Cell, direction: Direction, steps: number): Cell {
	let current = cell;
	for (let index = 0; index < steps; index++) current = moveCell(current, direction);
	return current;
}

function disconnectedLines(...starts: number[]): TileMap {
	const map = new TileMap();
	for (const start of starts) {
		map.setEncoded(start, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		map.setEncoded(start + 1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(start + 2, 0, encodeRailCell({ incoming: DIR_W, outgoing: 0 }));
	}
	return map;
}

function emptyPortEquipment(): PortEquipmentState {
	return Object.freeze({ nextPortId: 1, nextEquipmentGroupId: 1, ports: [], equipmentGroups: [] });
}

function bridgedPortEquipment(): PortEquipmentState {
	return Object.freeze({
		nextPortId: 4,
		nextEquipmentGroupId: 3,
		ports: Object.freeze([port(1, 1, 1, "STK"), port(2, 1, 11, "STK"), port(3, 2, 21, "OHB")]),
		equipmentGroups: Object.freeze([
			Object.freeze({ id: 1, kind: "STK", template: "FLEX", portIds: Object.freeze([1, 2]) }),
			Object.freeze({ id: 2, kind: "OHB", template: "SINGLE", portIds: Object.freeze([3]) }),
		]),
	});
}

function closedLoops(...starts: number[]): TileMap {
	const document = new RailDocument();
	const routes = starts.map((x) => {
		let current = { x, y: 0 };
		const cells = [current];
		for (const [dx, dy] of [
			[1, 0],
			[0, 1],
			[-1, 0],
			[0, -1],
		] as const) {
			for (let step = 0; step < 6; step++) {
				current = { x: current.x + dx, y: current.y + dy };
				cells.push(current);
			}
		}
		return cells;
	});
	const plan = planRailRouteBatch(document.map, routes);
	if (!document.commit(plan)) throw new Error(plan.reason);
	return document.map;
}

function singleLoopEquipment(kind: "OHB" | "EQ" | "STK"): PortEquipmentState {
	const ports = kind === "OHB" ? [port(1, 1, 1, kind)] : [port(1, 1, 1, kind), port(2, 1, 2, kind)];
	const portIds = ports.map((value) => value.id);
	const group: PortEquipmentState["equipmentGroups"][number] =
		kind === "OHB"
			? { id: 1, kind, template: "SINGLE", portIds }
			: kind === "EQ"
				? { id: 1, kind, pitchMillimeters: 1000, recipe: null, portIds }
				: { id: 1, kind, template: "FLEX", portIds };
	return { nextPortId: ports.length + 1, nextEquipmentGroupId: 2, ports, equipmentGroups: [group] };
}

function port(id: number, equipmentGroupId: number, x: number, portType: "STK" | "OHB" | "EQ") {
	return Object.freeze({
		id,
		equipmentGroupId,
		route: Object.freeze({
			kind: "CARDINAL_CELL" as const,
			x,
			z: 0,
			from: DIR_W,
			to: DIR_E,
		}),
		stationMillimeters: 500,
		side: "CENTER" as const,
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL" as const,
		portType,
		barcode: null,
	});
}
