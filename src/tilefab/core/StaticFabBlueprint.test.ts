import { describe, expect, it } from "vitest";
import type { EquipmentGroupRecord, PortEquipmentState } from "./EquipmentGroup";
import { type CardinalPortRoute, PORT_RECORD_MAX_ID, type PortRecord } from "./PortRecord";
import { planRailConstruction } from "./paint";
import { createRailAreaSelection } from "./RailAreaSelection";
import {
	createRailAreaStampTemplate,
	initialRailAreaStampPose,
	planRailAreaStamp,
} from "./RailAreaStamp";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "./RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction, oppositeDirection } from "./railShape";
import {
	createStaticFabBlueprintTemplate,
	planStaticFabBlueprintPlacement,
	transformStaticFabBlueprintTemplate,
} from "./StaticFabBlueprint";
import { createStaticFabSelection } from "./StaticFabSelection";
import { TileMap } from "./TileMap";

describe("StaticFabBlueprint", () => {
	it("captures one rail, OHB, EQ, and STK template and allocates new runtime identities", () => {
		const document = longBayDocument();
		const state = mixedEquipmentState(document);
		const selection = createStaticFabSelection(selectWholeMap(document), state, 9, [1, 2, 3]);
		const template = createStaticFabBlueprintTemplate(selection);

		expect(template.rail.sourceEdgeCount).toBeGreaterThan(0);
		expect(template.equipmentGroups.map((group) => group.kind)).toEqual(["OHB", "EQ", "STK"]);
		expect(template.ports).toHaveLength(7);

		const plan = planStaticFabBlueprintPlacement(
			document.map,
			state,
			9,
			template,
			{ x: 120, y: 50 },
			initialRailAreaStampPose(),
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.basePatchSequence).toBe(9);
		expect(plan.portMutations.map((mutation) => mutation.id)).toEqual([40, 41, 42, 43, 44, 45, 46]);
		expect(plan.equipmentGroupMutations.map((mutation) => mutation.id)).toEqual([20, 21, 22]);
		expect(plan.portMutations.map((mutation) => mutation.after?.barcode)).toEqual([
			"OHB-40",
			"EQ-21-P01",
			"EQ-21-P02",
			"STK-22-P01",
			"STK-22-P02",
			"STK-22-P03",
			"STK-22-P04",
		]);
	});

	it("captures an open rail with OHB, EQ, and STK and places it as one undoable command", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 15, y: 0 }))).toBe(
			true,
		);
		const sourceEquipment = openLineEquipmentState(source);
		const sourceDocument = RailDocument.fromLoadedMap(source.map.clone(), 3, sourceEquipment);
		const selection = createStaticFabSelection(
			selectWholeMap(sourceDocument),
			sourceDocument.portEquipment,
			sourceDocument.getPatchSequence(),
			[1, 2, 3],
		);
		const template = createStaticFabBlueprintTemplate(selection);

		expect(template.rail.sourceHeightMeters).toBe(0);
		expect(template.equipmentGroups.map((group) => group.kind)).toEqual(["OHB", "EQ", "STK"]);
		const plan = planStaticFabBlueprintPlacement(
			sourceDocument.map,
			sourceDocument.portEquipment,
			sourceDocument.getPatchSequence(),
			template,
			{ x: 0, y: 20 },
			initialRailAreaStampPose(),
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(sourceDocument.commitStaticFab(plan)).toBe(true);
		expect(sourceDocument.portEquipment.equipmentGroups).toHaveLength(6);
		expect(sourceDocument.portEquipment.ports).toHaveLength(14);

		expect(sourceDocument.undo()).toBe(true);
		expect(sourceDocument.portEquipment.equipmentGroups).toHaveLength(3);
		expect(sourceDocument.portEquipment.ports).toHaveLength(7);
		expect(sourceDocument.redo()).toBe(true);
		expect(sourceDocument.portEquipment.equipmentGroups).toHaveLength(6);
		expect(sourceDocument.portEquipment.ports).toHaveLength(14);
	});

	it("rejects an equipment group whose supporting rail was not part of the selected closed area", () => {
		const document = longBayDocument();
		const sourceSelection = selectWholeMap(document);
		const sourceTemplate = createRailAreaStampTemplate(sourceSelection);
		const secondPlan = planRailAreaStamp(
			document.map,
			sourceTemplate,
			{ x: 120, y: 0 },
			initialRailAreaStampPose(),
		);
		expect(secondPlan.valid, secondPlan.reason).toBe(true);
		expect(document.commit(secondPlan)).toBe(true);

		const externalRoute = firstStraightRoute(document, 100);
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [port(1, 1, externalRoute, "OHB", "LEFT", 700)],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const selection = createStaticFabSelection(sourceSelection, state, 2, [1]);

		expect(() => createStaticFabBlueprintTemplate(selection)).toThrow(
			/지지 레일이 선택되지 않았습니다/,
		);
	});

	it("rotates cardinal port routes and reverses flow, side, and equipment direction together", () => {
		const document = longBayDocument();
		const state = mixedEquipmentState(document);
		const template = createStaticFabBlueprintTemplate(
			createStaticFabSelection(selectWholeMap(document), state, 4, [1, 2, 3]),
		);
		const pose = { quarterTurns: 1 as const, reverseFlow: true };
		const anchor = { x: 180, y: 60 };
		const plan = planStaticFabBlueprintPlacement(document.map, state, 4, template, anchor, pose);
		expect(plan.valid, plan.reason).toBe(true);

		for (const [index, source] of template.ports.entries()) {
			const placed = plan.portMutations[index]?.after;
			if (!placed || placed.route.kind !== "CARDINAL_CELL")
				throw new Error("Expected placed cardinal port.");
			if (source.route.from === 0 || source.route.to === 0) {
				throw new Error("Fixture ports must stay on directed through-routes.");
			}
			expect(placed.route).toEqual({
				kind: "CARDINAL_CELL",
				x: anchor.x - source.route.z,
				z: anchor.y + source.route.x,
				from: rotate(source.route.to),
				to: rotate(source.route.from),
			});
			expect(placed.side).toBe(
				source.side === "LEFT" ? "RIGHT" : source.side === "RIGHT" ? "LEFT" : "CENTER",
			);
			expect(placed.direction).toBe("AGAINST_TRAVEL");
		}
	});

	it("saves a transformed mixed-FAB ghost exactly as it is currently held", () => {
		const source = longBayDocument();
		const sourceEquipment = mixedEquipmentState(source);
		const template = createStaticFabBlueprintTemplate(
			createStaticFabSelection(selectWholeMap(source), sourceEquipment, 4, [1, 2, 3]),
		);
		const pose = { quarterTurns: 3 as const, reverseFlow: true };
		const baked = transformStaticFabBlueprintTemplate(template, pose);
		const emptyEquipment: PortEquipmentState = Object.freeze({
			nextPortId: 1,
			nextEquipmentGroupId: 1,
			ports: Object.freeze([]),
			equipmentGroups: Object.freeze([]),
		});
		const posed = planStaticFabBlueprintPlacement(
			new TileMap(),
			emptyEquipment,
			0,
			template,
			{ x: 0, y: template.rail.sourceWidthMeters },
			pose,
		);
		const restored = planStaticFabBlueprintPlacement(
			new TileMap(),
			emptyEquipment,
			0,
			baked,
			{ x: 0, y: 0 },
			initialRailAreaStampPose(),
		);

		expect(posed.valid, posed.reason).toBe(true);
		expect(restored.valid, restored.reason).toBe(true);
		expect(restored.railPlan.mutations).toEqual(posed.railPlan.mutations);
		expect(restored.portMutations).toEqual(posed.portMutations);
		expect(restored.equipmentGroupMutations).toEqual(posed.equipmentGroupMutations);
		expect(baked.rail.sourceWidthMeters).toBe(template.rail.sourceHeightMeters);
		expect(baked.rail.sourceHeightMeters).toBe(template.rail.sourceWidthMeters);
	});

	it("commits rail and equipment in one event, one undo, and one redo", () => {
		const source = longBayDocument();
		const sourceEquipment = mixedEquipmentState(source);
		const document = RailDocument.fromLoadedMap(source.map, 9, sourceEquipment);
		const template = createStaticFabBlueprintTemplate(
			createStaticFabSelection(selectWholeMap(document), sourceEquipment, 9, [1, 2, 3]),
		);
		const plan = planStaticFabBlueprintPlacement(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			template,
			{ x: 120, y: 50 },
			initialRailAreaStampPose(),
		);
		const events: Parameters<Parameters<RailDocument["subscribe"]>[0]>[0][] = [];
		document.subscribe((event) => events.push(event));

		expect(document.commitStaticFab(plan)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "place-static-fab-blueprint",
			portChanges: { length: 7 },
			equipmentGroupChanges: { length: 3 },
		});
		expect(document.portEquipment.ports).toHaveLength(14);
		expect(document.portEquipment.equipmentGroups).toHaveLength(6);

		expect(document.undo()).toBe(true);
		expect(events).toHaveLength(2);
		expect(document.portEquipment.ports).toHaveLength(7);
		expect(document.portEquipment.equipmentGroups).toHaveLength(3);

		expect(document.redo()).toBe(true);
		expect(events).toHaveLength(3);
		expect(document.portEquipment.ports).toHaveLength(14);
		expect(document.portEquipment.equipmentGroups).toHaveLength(6);
	});

	it("returns an invalid ghost plan instead of throwing when runtime IDs are exhausted", () => {
		const document = longBayDocument();
		const sourceState = mixedEquipmentState(document);
		const template = createStaticFabBlueprintTemplate(
			createStaticFabSelection(selectWholeMap(document), sourceState, 9, [1, 2, 3]),
		);
		const exhaustedState: PortEquipmentState = {
			...sourceState,
			nextPortId: PORT_RECORD_MAX_ID + 1,
		};

		const plan = planStaticFabBlueprintPlacement(
			document.map,
			exhaustedState,
			9,
			template,
			{ x: 120, y: 50 },
			initialRailAreaStampPose(),
		);
		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("ID");
		expect(plan.portMutations).toEqual([]);
		expect(plan.staticFab.portPreviews).toEqual([]);
	});

	it("contains malformed STK templates as an invalid ghost plan", () => {
		const document = longBayDocument();
		const sourceState = mixedEquipmentState(document);
		const template = createStaticFabBlueprintTemplate(
			createStaticFabSelection(selectWholeMap(document), sourceState, 9, [1, 2, 3]),
		);
		const malformedTemplate = {
			...template,
			equipmentGroups: template.equipmentGroups.map((group) =>
				group.kind === "STK" ? { ...group, template: "SIX_PORT" as const } : group,
			),
		};

		const plan = planStaticFabBlueprintPlacement(
			document.map,
			sourceState,
			9,
			malformedTemplate,
			{ x: 120, y: 50 },
			initialRailAreaStampPose(),
		);

		expect(plan.valid).toBe(false);
		expect(plan.reason).toMatch(/six-port/i);
		expect(plan.portMutations).toEqual([]);
		expect(plan.equipmentGroupMutations).toEqual([]);
		expect(plan.staticFab.portPreviews).toEqual([]);
	});
});

function longBayDocument(): RailDocument {
	const document = new RailDocument();
	const plan = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function selectWholeMap(document: RailDocument) {
	return createRailAreaSelection(
		buildRailModuleOwnershipIndex(document.map),
		{ x: -20, y: -20 },
		{ x: 80, y: 80 },
	);
}

function mixedEquipmentState(document: RailDocument): PortEquipmentState {
	const runs = straightRuns(document).filter((run) => run.length >= 4);
	if (runs.length < 3) throw new Error("Long Bay fixture needs three straight rail runs.");
	const [ohbRun, eqRun, stkRun] = runs;
	if (!ohbRun || !eqRun || !stkRun) throw new Error("Expected fixture rail runs.");
	const ports: PortRecord[] = [
		port(1, 1, ohbRun[0] as RouteCell, "OHB", "LEFT", 700),
		port(2, 2, eqRun[0] as RouteCell, "EQ", "CENTER", 0),
		port(3, 2, eqRun[1] as RouteCell, "EQ", "CENTER", 0),
		...stkRun.slice(0, 4).map((route, index) => port(index + 4, 3, route, "STK", "CENTER", 0)),
	];
	const equipmentGroups: EquipmentGroupRecord[] = [
		{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
		{ id: 2, kind: "EQ", pitchMillimeters: 1_000, recipe: "PHOTO", portIds: [2, 3] },
		{ id: 3, kind: "STK", template: "FOUR_PORT", portIds: [4, 5, 6, 7] },
	];
	return { nextPortId: 40, nextEquipmentGroupId: 20, ports, equipmentGroups };
}

function openLineEquipmentState(document: RailDocument): PortEquipmentState {
	const run = straightRuns(document).find((candidate) => candidate.length >= 9);
	if (!run) throw new Error("Open-line fixture needs one long straight rail run.");
	const ports: PortRecord[] = [
		port(1, 1, run[0] as RouteCell, "OHB", "LEFT", 700),
		port(2, 2, run[2] as RouteCell, "EQ", "CENTER", 0),
		port(3, 2, run[3] as RouteCell, "EQ", "CENTER", 0),
		...run.slice(5, 9).map((route, index) => port(index + 4, 3, route, "STK", "CENTER", 0)),
	];
	return {
		nextPortId: 40,
		nextEquipmentGroupId: 20,
		ports,
		equipmentGroups: [
			{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			{ id: 2, kind: "EQ", pitchMillimeters: 1_000, recipe: "ETCH", portIds: [2, 3] },
			{ id: 3, kind: "STK", template: "FOUR_PORT", portIds: [4, 5, 6, 7] },
		],
	};
}

interface RouteCell {
	readonly x: number;
	readonly z: number;
	readonly from: Direction;
	readonly to: Direction;
}

function firstStraightRoute(document: RailDocument, minimumX: number): RouteCell {
	const route = straightRuns(document)
		.flat()
		.find((candidate) => candidate.x >= minimumX);
	if (!route) throw new Error("Expected external straight route.");
	return route;
}

function straightRuns(document: RailDocument): RouteCell[][] {
	const routes = new Map<string, RouteCell>();
	document.map.forEachRail((x, z, rail) => {
		if (
			rail.incoming === 0 ||
			rail.outgoing === 0 ||
			(rail.incoming & (rail.incoming - 1)) !== 0 ||
			(rail.outgoing & (rail.outgoing - 1)) !== 0 ||
			rail.outgoing !== oppositeDirection(rail.incoming as Direction)
		) {
			return;
		}
		const from = rail.incoming as Direction;
		const to = rail.outgoing as Direction;
		routes.set(`${x}:${z}:${from}:${to}`, { x, z, from, to });
	});
	const visited = new Set<string>();
	const runs: RouteCell[][] = [];
	for (const route of routes.values()) {
		const key = `${route.x}:${route.z}:${route.from}:${route.to}`;
		if (visited.has(key)) continue;
		const backward = move(route, oppositeDirection(route.to));
		if (routes.has(`${backward.x}:${backward.z}:${route.from}:${route.to}`)) continue;
		const run: RouteCell[] = [];
		let current: RouteCell | undefined = route;
		while (current) {
			const currentKey = `${current.x}:${current.z}:${current.from}:${current.to}`;
			if (visited.has(currentKey)) break;
			visited.add(currentKey);
			run.push(current);
			const next = move(current, current.to);
			current = routes.get(`${next.x}:${next.z}:${current.from}:${current.to}`);
		}
		runs.push(run);
	}
	return runs.sort((left, right) => right.length - left.length);
}

function move(cell: Pick<RouteCell, "x" | "z">, direction: Direction): { x: number; z: number } {
	if (direction === DIR_E) return { x: cell.x + 1, z: cell.z };
	if (direction === DIR_W) return { x: cell.x - 1, z: cell.z };
	return direction === DIR_N ? { x: cell.x, z: cell.z - 1 } : { x: cell.x, z: cell.z + 1 };
}

function rotate(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_E;
	if (direction === DIR_E) return DIR_S;
	if (direction === DIR_S) return DIR_W;
	return DIR_N;
}

function port(
	id: number,
	equipmentGroupId: number,
	route: RouteCell,
	portType: "OHB" | "EQ" | "STK",
	side: "LEFT" | "CENTER",
	lateralOffsetMillimeters: number,
): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", ...route } satisfies CardinalPortRoute,
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters,
		direction: "WITH_TRAVEL",
		portType,
		barcode: `${portType}-${id}`,
	};
}
