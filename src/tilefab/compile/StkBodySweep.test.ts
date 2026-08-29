import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { CardinalPortRoute, PortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { StkBodySweepIndex } from "./StkBodySweep";

describe("StkBodySweep", () => {
	it("reserves every station between sparse STK ports on one connected run", () => {
		const document = straightDocument(10);
		const state = stkState([
			cardinalPort(1, 2, 0, DIR_W, DIR_E),
			cardinalPort(2, 6, 0, DIR_W, DIR_E),
		]);
		const index = new StkBodySweepIndex(compilePhysicalRail(document.map), state);

		expect(index.sweeps).toHaveLength(1);
		expect(index.sweeps[0]).toMatchObject({
			equipmentGroupId: 1,
			centerX: 4.5,
			centerZ: 0.5,
			halfLength: 2.5,
		});
		expect(index.conflictingGroupForPort(candidate(4, 0, DIR_W, DIR_E))).toBe(1);
		expect(index.conflictingGroupForPort(candidate(8, 0, DIR_W, DIR_E))).toBe(0);
	});

	it("does not bridge a physical gap between collinear directed rail runs", () => {
		const map = new TileMap();
		for (const x of [0, 1, 2, 3, 6, 7, 8, 9]) {
			map.setEncoded(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		}
		const index = new StkBodySweepIndex(
			compilePhysicalRail(map),
			stkState([cardinalPort(1, 1, 0, DIR_W, DIR_E), cardinalPort(2, 3, 0, DIR_W, DIR_E)]),
		);

		expect(index.conflictingGroupForPort(candidate(7, 0, DIR_W, DIR_E))).toBe(0);
	});

	it("derives a union of run sweeps for an L-shaped FLEX group instead of one rectangle", () => {
		const map = new TileMap();
		for (let x = 0; x <= 8; x++) {
			map.setEncoded(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		}
		for (let z = 1; z <= 8; z++) {
			map.setEncoded(10, z, encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }));
		}
		const index = new StkBodySweepIndex(
			compilePhysicalRail(map),
			stkState([
				cardinalPort(1, 2, 0, DIR_W, DIR_E),
				cardinalPort(2, 6, 0, DIR_W, DIR_E),
				cardinalPort(3, 10, 2, DIR_N, DIR_S),
				cardinalPort(4, 10, 6, DIR_N, DIR_S),
			]),
		);

		expect(index.sweeps).toHaveLength(2);
		expect(index.conflictingGroupForPort(candidate(4, 0, DIR_W, DIR_E))).toBe(1);
		expect(index.conflictingGroupForPort(candidate(10, 4, DIR_N, DIR_S))).toBe(1);
		expect(
			index.conflictingGroupForSpan([candidate(1, 0, DIR_W, DIR_E), candidate(7, 0, DIR_W, DIR_E)]),
		).toBe(1);
	});

	it("queries run-local interval indexes without rescanning the public sweep catalog", () => {
		const document = straightDocument(12);
		const first = { ...cardinalPort(1, 1, 0, DIR_W, DIR_E), equipmentGroupId: 3 };
		const second = { ...cardinalPort(2, 6, 0, DIR_W, DIR_E), equipmentGroupId: 2 };
		const equipment = {
			...cardinalPort(3, 8, 0, DIR_W, DIR_E),
			equipmentGroupId: 9,
			portType: "EQ" as const,
		};
		const state: PortEquipmentState = {
			nextPortId: 4,
			nextEquipmentGroupId: 10,
			ports: [first, second, equipment],
			equipmentGroups: [
				{ id: 3, kind: "STK", template: "FLEX", portIds: [first.id] },
				{ id: 2, kind: "STK", template: "FLEX", portIds: [second.id] },
				{ id: 9, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [equipment.id] },
			],
		};
		const index = new StkBodySweepIndex(compilePhysicalRail(document.map), state);
		expect(index.conflictingGroupForPort(candidate(1, 0, DIR_W, DIR_E))).toBe(3);
		Object.defineProperty(index, "sweeps", {
			value: new Proxy(index.sweeps, {
				get() {
					throw new Error("Public sweep catalog must not be scanned by occupancy queries.");
				},
			}),
		});

		expect(index.conflictingGroupForPort(candidate(1, 0, DIR_W, DIR_E))).toBe(3);
		expect(
			index.conflictingGroupForSpan([candidate(1, 0, DIR_W, DIR_E), candidate(6, 0, DIR_W, DIR_E)]),
		).toBe(2);
		expect(
			index.conflictingGroupForSpan(
				[candidate(1, 0, DIR_W, DIR_E), candidate(6, 0, DIR_W, DIR_E)],
				2,
			),
		).toBe(3);
		expect(index.conflictingGroupForSpan([candidate(8, 0, DIR_W, DIR_E)])).toBe(9);
	});
});

function straightDocument(length: number): RailDocument {
	const document = new RailDocument();
	expect(
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: length, y: 0 })),
	).toBe(true);
	return document;
}

function stkState(ports: readonly PortRecord[]): PortEquipmentState {
	return {
		nextPortId: ports.length + 1,
		nextEquipmentGroupId: 2,
		ports,
		equipmentGroups: [
			{ id: 1, kind: "STK", template: "FLEX", portIds: ports.map((port) => port.id) },
		],
	};
}

function cardinalPort(
	id: number,
	x: number,
	z: number,
	from: typeof DIR_W | typeof DIR_E | typeof DIR_N | typeof DIR_S,
	to: typeof DIR_W | typeof DIR_E | typeof DIR_N | typeof DIR_S,
): PortRecord {
	return {
		id,
		equipmentGroupId: 1,
		route: { kind: "CARDINAL_CELL", x, z, from, to },
		stationMillimeters: 500,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "STK",
		barcode: `STK-1-P${String(id).padStart(2, "0")}`,
	};
}

function candidate(
	x: number,
	z: number,
	from: CardinalPortRoute["from"],
	to: CardinalPortRoute["to"],
): { readonly route: CardinalPortRoute; readonly stationMillimeters: number } {
	return {
		route: { kind: "CARDINAL_CELL", x, z, from, to },
		stationMillimeters: 500,
	};
}
