import { describe, expect, it } from "vitest";
import type { EqEquipmentGroup, PortEquipmentState } from "./EquipmentGroup";
import {
	assertPortEquipmentLayout,
	assertPortEquipmentLayoutCooperatively,
	collectPortEquipmentLayoutIssues,
	portEquipmentBodyOverlapError,
	portEquipmentLayoutError,
} from "./PortEquipmentLayoutValidator";
import { createPortEquipmentMutationPlan } from "./PortEquipmentPlan";
import type { PortRecord } from "./PortRecord";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "./railShape";
import { encodeRailCell, TileMap } from "./TileMap";

describe("PortEquipmentLayoutValidator", () => {
	it("accepts exhausted MAX+1 cursors during cooperative validation", async () => {
		await expect(
			assertPortEquipmentLayoutCooperatively(
				new TileMap(),
				{
					nextPortId: 0x8000_0000,
					nextEquipmentGroupId: 0x8000_0000,
					ports: [],
					equipmentGroups: [],
				},
				async () => {},
			),
		).resolves.toBeUndefined();
	});

	it("detects a rollback ABA cycle at its final stability checkpoint", async () => {
		const map = straightMap(0, 1);
		const checkpoint = map.createMutationCheckpoint();
		const before = map.getEncoded(0, 0);
		const after = encodeRailCell({ incoming: 0, outgoing: DIR_E });
		const mutation = Object.freeze({ x: 0, y: 0, before, after });
		let rolledBack = false;

		await expect(
			assertPortEquipmentLayoutCooperatively(
				map,
				{
					nextPortId: 1,
					nextEquipmentGroupId: 1,
					ports: [],
					equipmentGroups: [],
				},
				async () => {
					if (rolledBack) return;
					rolledBack = true;
					map.applyAtomicMutations([mutation], []);
					map.rollbackAtomicMutations([mutation], [], checkpoint);
				},
			),
		).rejects.toThrow(/map changed/);
		expect(map.getRevision()).toBe(checkpoint.revision);
		expect(map.getEncoded(0, 0)).toBe(before);
	});

	it("accepts an ordered CENTER EQ row over one uninterrupted directed lane", () => {
		const document = straightDocument();
		const state = eqState([1, 3, 5], 2_000);

		expect(portEquipmentLayoutError(document.map, state)).toBeNull();
		expect(() => assertPortEquipmentLayout(document.map, state)).not.toThrow();
	});

	it("accepts a uniformly reversed EQ facing direction and rejects a mixed group", () => {
		const document = straightDocument();
		const source = eqState([1, 3, 5], 2_000);
		const reversed: PortEquipmentState = {
			...source,
			ports: source.ports.map((port) => ({ ...port, direction: "AGAINST_TRAVEL" as const })),
		};
		expect(portEquipmentLayoutError(document.map, reversed)).toBeNull();

		const mixed: PortEquipmentState = {
			...reversed,
			ports: reversed.ports.map((port, index) =>
				index === 1 ? { ...port, direction: "WITH_TRAVEL" as const } : port,
			),
		};
		expect(portEquipmentLayoutError(document.map, mixed)).toContain(
			"one equipment-facing direction",
		);
	});

	it("rejects sided EQ ports and rows whose configured pitch crosses a gap", () => {
		const document = straightDocument();
		const sided = eqState([1, 3], 2_000);
		const first = sided.ports[0] as PortRecord;
		const invalidSide: PortEquipmentState = {
			...sided,
			ports: [
				{ ...first, side: "LEFT", lateralOffsetMillimeters: 700 },
				sided.ports[1] as PortRecord,
			],
		};
		expect(portEquipmentLayoutError(document.map, invalidSide)).toContain("zero-offset CENTER");

		const hydrator = TileMap.createHydrator();
		const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		hydrator.addEncodedCell(1, 0, straight);
		hydrator.addEncodedCell(3, 0, straight);
		const gapMap = hydrator.finish(2);
		expect(portEquipmentLayoutError(gapMap, eqState([1, 3], 2_000))).toContain(
			"pitch crosses a gap",
		);
	});

	it("reports EQ pitch order with a signed travel-axis measurement", () => {
		const issue = collectPortEquipmentLayoutIssues(straightMap(-1, 4), eqState([2, 0], 2_000)).find(
			(candidate) => candidate.code === "EQ_PORT_PITCH_ORDER",
		);

		expect(issue?.measurement).toEqual({
			measured: -2,
			required: 2,
			unit: "METERS",
			relation: "EXACT",
		});
	});

	it("reports an off-axis EQ port as a lane violation instead of an exact pitch", () => {
		const source = eqState([0, 2, 4], 2_000);
		const state: PortEquipmentState = {
			...source,
			ports: [
				source.ports[0] as PortRecord,
				{
					...(source.ports[1] as PortRecord),
					route: { kind: "CARDINAL_CELL", x: 2, z: 1, from: DIR_W, to: DIR_E },
				},
				source.ports[2] as PortRecord,
			],
		};

		const issues = collectPortEquipmentLayoutIssues(straightMap(-1, 4), state);
		expect(issues.some((issue) => issue.code === "EQ_PORT_LANE")).toBe(true);
		expect(issues.some((issue) => issue.code === "EQ_PORT_PITCH_ORDER")).toBe(false);
	});

	it("makes the RailDocument command boundary reject malformed EQ atomically", () => {
		const document = straightDocument();
		const before = document.portEquipment;
		const state = eqState([1, 3], 2_000);
		const malformedPorts = state.ports.map((port) => ({
			...port,
			side: "LEFT" as const,
			lateralOffsetMillimeters: 700,
		}));
		const group = state.equipmentGroups[0] as EqEquipmentGroup;
		const plan = createPortEquipmentMutationPlan(
			"place-eq",
			document.map.getRevision(),
			document.getPatchSequence(),
			malformedPorts.map((port) => ({ id: port.id, before: null, after: port })),
			[{ id: group.id, before: null, after: group }],
		);

		expect(document.commitPortEquipment(plan)).toBe(false);
		expect(document.portEquipment).toBe(before);
		expect(document.getPatchSequence()).toBe(1);
	});

	it("rejects exact station reuse and ports closer than the 600 mm authored boundary", () => {
		const document = straightDocument();
		const state = (secondStationMillimeters: number): PortEquipmentState => ({
			nextPortId: 3,
			nextEquipmentGroupId: 3,
			ports: [500, secondStationMillimeters].map(
				(stationMillimeters, index): PortRecord => ({
					id: index + 1,
					equipmentGroupId: index + 1,
					route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
					stationMillimeters,
					side: "LEFT",
					lateralOffsetMillimeters: 700,
					direction: "WITH_TRAVEL",
					portType: "OHB",
					barcode: `OHB-${index + 1}`,
				}),
			),
			equipmentGroups: [
				{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
				{ id: 2, kind: "OHB", template: "SINGLE", portIds: [2] },
			],
		});

		expect(portEquipmentLayoutError(document.map, state(500))).toContain(
			"occupy the same authored station",
		);
		expect(portEquipmentLayoutError(document.map, state(900))).toContain("closer than 600 mm");
		expect(portEquipmentLayoutError(document.map, state(1_100))).toBeNull();
	});

	it("collects simultaneous EQ problems with typed entities, cells, and measurements", () => {
		const document = straightDocument();
		const source = eqState([1, 4], 2_000);
		const second = source.ports[1] as PortRecord;
		const state: PortEquipmentState = {
			...source,
			ports: [
				source.ports[0] as PortRecord,
				{
					...second,
					side: "LEFT",
					lateralOffsetMillimeters: 700,
					direction: "AGAINST_TRAVEL",
				},
			],
		};

		const issues = collectPortEquipmentLayoutIssues(document.map, state);
		expect(issues.map((issue) => issue.code)).toEqual([
			"EQ_PORT_SIDE_OFFSET",
			"EQ_PORT_DIRECTION",
			"EQ_PORT_PITCH_ORDER",
		]);
		expect(issues[0]).toMatchObject({
			portIds: [2],
			equipmentGroupIds: [1],
			cells: [{ x: 4, z: 0 }],
			measurement: { measured: 700, required: 0, unit: "MILLIMETERS", relation: "EXACT" },
		});
		expect(issues[1]?.portIds).toEqual([1, 2]);
		expect(issues[2]).toMatchObject({
			portIds: [1, 2],
			cells: [
				{ x: 1, z: 0 },
				{ x: 4, z: 0 },
				{ x: 3, z: 0 },
			],
			measurement: { measured: 3, required: 2, unit: "METERS", relation: "EXACT" },
		});
		expect(portEquipmentLayoutError(document.map, state)).toBe(issues[0]?.message);
	});

	it("collects every missing authored route before dependent group layout checks", () => {
		const state = eqState([1, 3, 5], 2_000);
		const issues = collectPortEquipmentLayoutIssues(new TileMap(), state);

		expect(issues.slice(0, 3).map((issue) => issue.code)).toEqual([
			"PORT_ROUTE_MISSING",
			"PORT_ROUTE_MISSING",
			"PORT_ROUTE_MISSING",
		]);
		expect(issues.slice(0, 3).map((issue) => issue.portIds)).toEqual([[1], [2], [3]]);
		expect(issues[1]).toMatchObject({
			equipmentGroupIds: [1],
			cells: [{ x: 3, z: 0 }],
		});
	});

	it("does not throw or emit dependent layout issues for an integrity-invalid state", () => {
		const source = eqState([1, 3], 2_000);
		const invalid: PortEquipmentState = {
			...source,
			ports: [source.ports[0] as PortRecord, { ...(source.ports[1] as PortRecord), id: 1 }],
		};

		const map = straightDocument().map;
		expect(() => collectPortEquipmentLayoutIssues(map, invalid)).not.toThrow();
		expect(collectPortEquipmentLayoutIssues(map, invalid)).toEqual([]);
	});

	it("bounds coincident-port growth while retaining each offending pair and distance", () => {
		const document = straightDocument();
		const stations = [100, 100, 400, 800] as const;
		const ports: PortRecord[] = stations.map((stationMillimeters, index) => ({
			id: index + 1,
			equipmentGroupId: index + 1,
			route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters,
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL",
			portType: "OHB",
			barcode: `OHB-${index + 1}`,
		}));
		const state: PortEquipmentState = {
			nextPortId: 5,
			nextEquipmentGroupId: 5,
			ports,
			equipmentGroups: ports.map((port) => ({
				id: port.equipmentGroupId,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: [port.id],
			})),
		};

		const issues = collectPortEquipmentLayoutIssues(document.map, state);
		expect(issues.map((issue) => issue.code)).toEqual([
			"PORT_STATION_OCCUPIED",
			"PORT_SPACING",
			"PORT_SPACING",
		]);
		expect(issues.map((issue) => issue.portIds)).toEqual([
			[1, 2],
			[1, 3],
			[3, 4],
		]);
		expect(issues.map((issue) => issue.measurement?.measured)).toEqual([
			0,
			expect.closeTo(300),
			expect.closeTo(400),
		]);
		expect(issues.every((issue) => issue.measurement?.required === 600)).toBe(true);
	});

	it("accepts canonical four-port and opposite-direction back-to-back STK layouts", () => {
		const map = parallelStraightMap();

		expect(portEquipmentLayoutError(map, stkState([1, 2, 3, 4], "FOUR_PORT"))).toBeNull();
		expect(
			portEquipmentLayoutError(
				map,
				stkState([1, 2, 6, 5], "BACK_TO_BACK", [
					{ x: 1, z: 0, from: DIR_W, to: DIR_E },
					{ x: 2, z: 0, from: DIR_W, to: DIR_E },
					{ x: 2, z: 2, from: DIR_E, to: DIR_W },
					{ x: 1, z: 2, from: DIR_E, to: DIR_W },
				]),
			),
		).toBeNull();
	});

	it("accepts odd FLEX STK ports with independent spacing on two lanes", () => {
		const map = parallelStraightMap();
		const state = stkState([1, 2, 3, 4, 5], "FLEX", [
			{ x: 1, z: 0, from: DIR_W, to: DIR_E },
			{ x: 3, z: 0, from: DIR_W, to: DIR_E },
			{ x: 6, z: 0, from: DIR_W, to: DIR_E },
			{ x: 6, z: 2, from: DIR_E, to: DIR_W },
			{ x: 2, z: 2, from: DIR_E, to: DIR_W },
		]);

		expect(portEquipmentLayoutError(map, state)).toBeNull();
	});

	it("accepts one FLEX STK across perpendicular rails and distant Bays", () => {
		const hydrator = TileMap.createHydrator();
		for (let coordinate = 0; coordinate <= 7; coordinate++) {
			hydrator.addEncodedCell(coordinate, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
			hydrator.addEncodedCell(20, coordinate, encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }));
		}
		const state = stkState([1, 2, 3, 4], "FLEX", [
			{ x: 1, z: 0, from: DIR_W, to: DIR_E },
			{ x: 5, z: 0, from: DIR_W, to: DIR_E },
			{ x: 20, z: 1, from: DIR_N, to: DIR_S },
			{ x: 20, z: 5, from: DIR_N, to: DIR_S },
		]);

		expect(portEquipmentLayoutError(hydrator.finish(16), state)).toBeNull();
	});

	it("does not claim missing cells between sparse FLEX ports", () => {
		const hydrator = TileMap.createHydrator();
		for (let x = 0; x <= 7; x++) {
			if (x === 4) continue;
			hydrator.addEncodedCell(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		}
		const map = hydrator.finish(16);

		expect(
			portEquipmentLayoutError(
				map,
				stkState([1, 2], "FLEX", [
					{ x: 1, z: 0, from: DIR_W, to: DIR_E },
					{ x: 6, z: 0, from: DIR_W, to: DIR_E },
				]),
			),
		).toBeNull();
	});

	it("rejects FLEX stations beside a curve and outside the canonical cell midpoint", () => {
		const hydrator = TileMap.createHydrator();
		hydrator.addEncodedCell(-1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		hydrator.addEncodedCell(0, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		hydrator.addEncodedCell(1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		hydrator.addEncodedCell(2, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_S }));
		const map = hydrator.finish(4);

		expect(portEquipmentLayoutError(map, stkState([1], "FLEX", [routeAt(1)]))).toContain(
			"safe straight approach",
		);
		const offCenter = stkState([1], "FLEX", [routeAt(0)]);
		expect(
			portEquipmentLayoutError(map, {
				...offCenter,
				ports: [{ ...(offCenter.ports[0] as PortRecord), stationMillimeters: 499 }],
			}),
		).toContain("500 mm cell-center station");
	});

	it("does not impose a synthetic body-span limit on FLEX ports", () => {
		const map = straightMap(-1, 66);
		expect(
			portEquipmentLayoutError(map, stkState([1, 2], "FLEX", [routeAt(0), routeAt(64)])),
		).toBeNull();
		expect(
			portEquipmentLayoutError(map, stkState([1, 2], "FLEX", [routeAt(0), routeAt(65)])),
		).toBeNull();
	});

	it("rejects a FLEX reservation that spans another equipment group", () => {
		const existing = stkState([1, 2, 3, 4], "FOUR_PORT", [
			routeAt(3),
			routeAt(4),
			routeAt(5),
			routeAt(6),
		]);
		const state: PortEquipmentState = {
			nextPortId: 7,
			nextEquipmentGroupId: 3,
			ports: [...existing.ports, stkPort(5, 2, routeAt(2)), stkPort(6, 2, routeAt(7))],
			equipmentGroups: [
				...(existing.equipmentGroups as PortEquipmentState["equipmentGroups"]),
				{ id: 2, kind: "STK", template: "FLEX", portIds: [5, 6] },
			],
		};

		const map = straightMap(0, 10);
		expect(portEquipmentBodyOverlapError(map, state)).toContain(
			"reservation overlaps equipment group",
		);
		expect(portEquipmentLayoutError(map, state)).toContain("reservation overlaps equipment group");
	});

	it("rejects an EQ body whose sparse endpoint ports straddle an STK reservation", () => {
		const existing = stkState([1, 2], "FLEX", [routeAt(4), routeAt(5)]);
		const eqPorts: PortRecord[] = [2, 7].map((x, index) => ({
			id: index + 3,
			equipmentGroupId: 2,
			route: { kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "EQ",
			barcode: `EQ-2-P0${index + 1}`,
		}));
		const state: PortEquipmentState = {
			nextPortId: 5,
			nextEquipmentGroupId: 3,
			ports: [...existing.ports, ...eqPorts],
			equipmentGroups: [
				...(existing.equipmentGroups as PortEquipmentState["equipmentGroups"]),
				{
					id: 2,
					kind: "EQ",
					pitchMillimeters: 5_000,
					recipe: null,
					portIds: [3, 4],
				},
			],
		};

		expect(portEquipmentBodyOverlapError(straightMap(0, 10), state)).toBe(
			"EQ group 2 body crosses STK group 1 reservation",
		);
		expect(portEquipmentLayoutError(straightMap(0, 10), state)).toContain(
			"EQ group 2 body crosses STK group 1 reservation",
		);
	});

	it("bounds body diagnostics to canonical group conflicts with typed overlap semantics", () => {
		const makePort = (
			id: number,
			equipmentGroupId: number,
			x: number,
			portType: PortRecord["portType"],
		): PortRecord => ({
			id,
			equipmentGroupId,
			route: { kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: portType === "OHB" ? "LEFT" : "CENTER",
			lateralOffsetMillimeters: portType === "OHB" ? 700 : 0,
			direction: "WITH_TRAVEL",
			portType,
			barcode: `${portType}-${equipmentGroupId}-P${id}`,
		});
		const ports = [
			makePort(1, 1, 2, "STK"),
			makePort(2, 1, 8, "STK"),
			makePort(3, 2, 4, "STK"),
			makePort(4, 2, 10, "STK"),
			makePort(5, 3, 5, "EQ"),
			makePort(6, 3, 7, "EQ"),
			makePort(7, 4, 6, "OHB"),
		];
		const state: PortEquipmentState = {
			nextPortId: 8,
			nextEquipmentGroupId: 5,
			ports,
			equipmentGroups: [
				{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] },
				{ id: 2, kind: "STK", template: "FLEX", portIds: [3, 4] },
				{ id: 3, kind: "EQ", pitchMillimeters: 2_000, recipe: null, portIds: [5, 6] },
				{ id: 4, kind: "OHB", template: "SINGLE", portIds: [7] },
			],
		};

		const bodyIssues = collectPortEquipmentLayoutIssues(straightMap(0, 12), state).filter(
			(issue) =>
				issue.code === "EQ_STK_BODY_OVERLAP" ||
				issue.code === "STK_RESERVATION_OVERLAP" ||
				issue.code === "STK_RESERVATION_CROSSES_EQUIPMENT",
		);
		expect(bodyIssues.map((issue) => issue.code)).toEqual([
			"EQ_STK_BODY_OVERLAP",
			"EQ_STK_BODY_OVERLAP",
			"STK_RESERVATION_OVERLAP",
			"STK_RESERVATION_CROSSES_EQUIPMENT",
			"STK_RESERVATION_CROSSES_EQUIPMENT",
		]);
		expect(bodyIssues.map((issue) => issue.equipmentGroupIds)).toEqual([
			[3, 2],
			[3, 1],
			[2, 1],
			[1, 4],
			[2, 4],
		]);
		expect(bodyIssues.slice(0, 3).map((issue) => issue.measurement)).toEqual([
			{ measured: 2, required: 0, unit: "METERS", relation: "OVERLAP" },
			{ measured: 2, required: 0, unit: "METERS", relation: "OVERLAP" },
			{ measured: 4, required: 0, unit: "METERS", relation: "OVERLAP" },
		]);
		expect(bodyIssues[3]?.portIds).toEqual([1, 2, 7]);
		expect(bodyIssues[4]?.portIds).toEqual([3, 4, 7]);
	});

	it("gives every affected EQ, STK, and OHB group one bounded body-overlap witness", () => {
		const ports: PortRecord[] = [
			stkPort(1, 1, routeAt(2)),
			stkPort(2, 1, routeAt(3)),
			stkPort(3, 2, routeAt(6)),
			stkPort(4, 2, routeAt(7)),
			stkPort(5, 3, routeAt(10)),
			stkPort(6, 3, routeAt(11)),
			...eqState([1, 6, 11], 5_000).ports.map((port, index) => ({
				...port,
				id: 7 + index,
				equipmentGroupId: 4,
				barcode: `EQ-4-P0${index + 1}`,
			})),
			stkPort(10, 5, { ...routeAt(1), z: 2 }),
			stkPort(11, 5, { ...routeAt(9), z: 2 }),
			...([3, 5, 7] as const).map(
				(x, index): PortRecord => ({
					id: 12 + index,
					equipmentGroupId: 6 + index,
					route: { kind: "CARDINAL_CELL", x, z: 2, from: DIR_W, to: DIR_E },
					stationMillimeters: 500,
					side: "LEFT",
					lateralOffsetMillimeters: 700,
					direction: "WITH_TRAVEL",
					portType: "OHB",
					barcode: `OHB-${6 + index}`,
				}),
			),
		];
		const state: PortEquipmentState = {
			nextPortId: 15,
			nextEquipmentGroupId: 9,
			ports,
			equipmentGroups: [
				{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] },
				{ id: 2, kind: "STK", template: "FLEX", portIds: [3, 4] },
				{ id: 3, kind: "STK", template: "FLEX", portIds: [5, 6] },
				{ id: 4, kind: "EQ", pitchMillimeters: 5_000, recipe: null, portIds: [7, 8, 9] },
				{ id: 5, kind: "STK", template: "FLEX", portIds: [10, 11] },
				{ id: 6, kind: "OHB", template: "SINGLE", portIds: [12] },
				{ id: 7, kind: "OHB", template: "SINGLE", portIds: [13] },
				{ id: 8, kind: "OHB", template: "SINGLE", portIds: [14] },
			],
		};
		const hydrator = TileMap.createHydrator();
		for (let x = 0; x <= 13; x++) {
			hydrator.addEncodedCell(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
			hydrator.addEncodedCell(x, 2, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		}
		const bodyIssues = collectPortEquipmentLayoutIssues(hydrator.finish(28), state).filter(
			(issue) =>
				issue.code === "EQ_STK_BODY_OVERLAP" || issue.code === "STK_RESERVATION_CROSSES_EQUIPMENT",
		);
		const pairKeys = new Set(
			bodyIssues.map((issue) =>
				[...issue.equipmentGroupIds].sort((left, right) => left - right).join(":"),
			),
		);

		expect(pairKeys).toEqual(new Set(["1:4", "2:4", "3:4", "5:6", "5:7", "5:8"]));
		expect(bodyIssues).toHaveLength(6);
	});

	it("keeps a legacy CUSTOM sparse gap loadable", () => {
		const hydrator = TileMap.createHydrator();
		for (const x of [0, 1, 2, 5, 6, 7]) {
			hydrator.addEncodedCell(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		}
		const map = hydrator.finish(16);

		expect(
			portEquipmentLayoutError(
				map,
				stkState([1, 2], "CUSTOM", [
					{ x: 1, z: 0, from: DIR_W, to: DIR_E },
					{ x: 6, z: 0, from: DIR_W, to: DIR_E },
				]),
			),
		).toBeNull();
	});

	it("skips body-pair traversal when a large equipment map has no FLEX group", () => {
		const count = 20_000;
		const ports: PortRecord[] = Array.from({ length: count }, (_, index) => ({
			id: index + 1,
			equipmentGroupId: index + 1,
			route: {
				kind: "CARDINAL_CELL" as const,
				x: index,
				z: 0,
				from: DIR_W,
				to: DIR_E,
			},
			stationMillimeters: 500,
			side: "LEFT" as const,
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL" as const,
			portType: "OHB" as const,
			barcode: `OHB-${index + 1}`,
		}));
		const state: PortEquipmentState = {
			nextPortId: count + 1,
			nextEquipmentGroupId: count + 1,
			ports,
			equipmentGroups: ports.map((port) => ({
				id: port.equipmentGroupId,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: [port.id],
			})),
		};

		expect(portEquipmentBodyOverlapError(new TileMap(), state)).toBeNull();
	});

	it("keeps FLEX overlap validation near-linear with 20,000 X-overlapping bodies", () => {
		const count = 20_000;
		const ports: PortRecord[] = Array.from({ length: count }, (_, index) => ({
			id: index + 1,
			equipmentGroupId: index + 1,
			route: {
				kind: "CARDINAL_CELL" as const,
				x: 0,
				z: index * 2,
				from: DIR_W,
				to: DIR_E,
			},
			stationMillimeters: 500,
			side: "LEFT" as const,
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL" as const,
			portType: "OHB" as const,
			barcode: `OHB-${index + 1}`,
		}));
		const flexPorts = [
			stkPort(count + 1, count + 1, { x: 0, z: -100, from: DIR_W, to: DIR_E }),
			stkPort(count + 2, count + 1, { x: 1, z: -100, from: DIR_W, to: DIR_E }),
		];
		const state: PortEquipmentState = {
			nextPortId: count + 3,
			nextEquipmentGroupId: count + 2,
			ports: [...ports, ...flexPorts],
			equipmentGroups: [
				...ports.map((port) => ({
					id: port.equipmentGroupId,
					kind: "OHB" as const,
					template: "SINGLE" as const,
					portIds: [port.id],
				})),
				{
					id: count + 1,
					kind: "STK",
					template: "FLEX",
					portIds: flexPorts.map((port) => port.id),
				},
			],
		};

		expect(portEquipmentBodyOverlapError(new TileMap(), state)).toBeNull();
	});

	it("bounds dense multi-issue overlap output on a real directed rail run", () => {
		const groupCount = 2_000;
		const ports: PortRecord[] = [];
		const equipmentGroups: PortEquipmentState["equipmentGroups"][number][] = [];
		for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
			const groupId = groupIndex + 1;
			const firstPortId = groupIndex * 2 + 1;
			ports.push(
				stkPort(firstPortId, groupId, { x: 1, z: 0, from: DIR_W, to: DIR_E }),
				stkPort(firstPortId + 1, groupId, { x: 2, z: 0, from: DIR_W, to: DIR_E }),
			);
			equipmentGroups.push({
				id: groupId,
				kind: "STK",
				template: "FLEX",
				portIds: [firstPortId, firstPortId + 1],
			});
		}
		const state: PortEquipmentState = {
			nextPortId: ports.length + 1,
			nextEquipmentGroupId: groupCount + 1,
			ports,
			equipmentGroups,
		};
		const startedAt = performance.now();
		const bodyIssues = collectPortEquipmentLayoutIssues(straightMap(0, 3), state).filter(
			(issue) => issue.code === "STK_RESERVATION_OVERLAP",
		);
		const durationMilliseconds = performance.now() - startedAt;

		expect(bodyIssues).toHaveLength(groupCount - 1);
		expect(durationMilliseconds).toBeLessThan(2_000);
	});

	it("rejects STK gaps, unpaired back-to-back rows, and noncanonical order", () => {
		const map = parallelStraightMap();
		expect(portEquipmentLayoutError(map, stkState([1, 2, 3, 5], "FOUR_PORT"))).toContain(
			"consecutive",
		);
		expect(
			portEquipmentLayoutError(
				map,
				stkState([1, 2, 5, 6], "BACK_TO_BACK", [
					{ x: 1, z: 0, from: DIR_W, to: DIR_E },
					{ x: 2, z: 0, from: DIR_W, to: DIR_E },
					{ x: 2, z: 2, from: DIR_E, to: DIR_W },
					{ x: 3, z: 2, from: DIR_E, to: DIR_W },
				]),
			),
		).toContain("aligned");
		expect(portEquipmentLayoutError(map, stkState([4, 3, 2, 1], "FOUR_PORT"))).toContain(
			"canonical lane and travel order",
		);
	});
});

function straightDocument(): RailDocument {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 7, y: 0 }))).toBe(
		true,
	);
	return document;
}

function eqState(xs: readonly number[], pitchMillimeters: number): PortEquipmentState {
	const ports = xs.map(
		(x, index): PortRecord => ({
			id: index + 1,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: x * 1_000 + 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "EQ",
			barcode: `EQ-1-P${String(index + 1).padStart(2, "0")}`,
		}),
	);
	return {
		nextPortId: ports.length + 1,
		nextEquipmentGroupId: 2,
		ports,
		equipmentGroups: [
			{
				id: 1,
				kind: "EQ",
				pitchMillimeters,
				recipe: "PHOTO",
				portIds: ports.map((port) => port.id),
			},
		],
	};
}

function parallelStraightMap(): TileMap {
	const hydrator = TileMap.createHydrator();
	for (let x = 0; x <= 7; x++) {
		hydrator.addEncodedCell(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		hydrator.addEncodedCell(x, 2, encodeRailCell({ incoming: DIR_E, outgoing: DIR_W }));
	}
	return hydrator.finish(16);
}

function straightMap(minX: number, maxX: number): TileMap {
	const hydrator = TileMap.createHydrator();
	for (let x = minX; x <= maxX; x++) {
		hydrator.addEncodedCell(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
	}
	return hydrator.finish(maxX - minX + 1);
}

function routeAt(x: number): {
	readonly x: number;
	readonly z: number;
	readonly from: typeof DIR_W;
	readonly to: typeof DIR_E;
} {
	return { x, z: 0, from: DIR_W, to: DIR_E };
}

function stkPort(
	id: number,
	equipmentGroupId: number,
	route: ReturnType<typeof routeAt>,
): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", ...route },
		stationMillimeters: 500,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "STK",
		barcode: `STK-${equipmentGroupId}-P${String(id).padStart(2, "0")}`,
	};
}

function stkState(
	portIds: readonly number[],
	template: "CUSTOM" | "FLEX" | "FOUR_PORT" | "SIX_PORT" | "BACK_TO_BACK",
	routes: readonly {
		x: number;
		z: number;
		from: typeof DIR_W | typeof DIR_E | typeof DIR_N | typeof DIR_S;
		to: typeof DIR_W | typeof DIR_E | typeof DIR_N | typeof DIR_S;
	}[] = portIds.map((id) => ({ x: id, z: 0, from: DIR_W, to: DIR_E })),
): PortEquipmentState {
	const ports = routes.map(
		(route, index): PortRecord => ({
			id: portIds[index] as number,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", ...route },
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "STK",
			barcode: `STK-1-P${String(index + 1).padStart(2, "0")}`,
		}),
	);
	return {
		nextPortId: Math.max(...portIds) + 1,
		nextEquipmentGroupId: 2,
		ports,
		equipmentGroups: [{ id: 1, kind: "STK", template, portIds }],
	};
}
