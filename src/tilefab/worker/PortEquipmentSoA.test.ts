import { describe, expect, it } from "vitest";
import {
	copyPortEquipmentState,
	isCanonicalPortEquipmentState,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import type { CardinalPortRoute } from "../core/PortRecord";
import { DIR_E, DIR_W } from "../core/railShape";
import { TileMap } from "../core/TileMap";
import {
	createPortEquipmentSnapshot,
	decodePortEquipmentPatch,
	encodePortEquipmentPatch,
	encodePortEquipmentPatchCooperatively,
	hydratePortEquipmentSnapshot,
	hydratePortEquipmentSnapshotCooperatively,
	portEquipmentSnapshotTransfers,
} from "./PortEquipmentSoA";
import { checksumRailMap } from "./RailMirrorChecksum";

describe("PortEquipmentSoA", () => {
	it("round-trips every Phase 3 record variant through deterministic typed buffers", () => {
		const canonical = copyPortEquipmentState(fixture());
		const snapshot = createPortEquipmentSnapshot(fixture());
		const hydrated = hydratePortEquipmentSnapshot(snapshot);

		expect(hydrated).toEqual(canonical);
		expect(isCanonicalPortEquipmentState(hydrated)).toBe(true);
		expect([...snapshot.portIds]).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect([...snapshot.equipmentGroupIds]).toEqual([1, 2, 3]);
		expect([...snapshot.equipmentGroups.portOffsets]).toEqual([0, 1, 3, 7]);
		expect(snapshot.ports.routePortIndices).toBeInstanceOf(Int8Array);
		expect(snapshot.equipmentGroups.portIds).toBeInstanceOf(Int32Array);
	});

	it("cooperatively hydrates canonical reciprocal ownership", async () => {
		const canonical = copyPortEquipmentState(fixture());
		const snapshot = createPortEquipmentSnapshot(fixture());
		let checkpoints = 0;

		await expect(
			hydratePortEquipmentSnapshotCooperatively(
				snapshot,
				async () => {
					checkpoints++;
				},
				1,
			),
		).resolves.toEqual(canonical);
		expect(checkpoints).toBeGreaterThan(
			snapshot.portIds.length + snapshot.equipmentGroupIds.length,
		);

		const orphan = createPortEquipmentSnapshot(fixture());
		orphan.equipmentGroups.portIds[0] = 99;
		await expect(
			hydratePortEquipmentSnapshotCooperatively(orphan, async () => undefined),
		).rejects.toThrow("missing port");
	});

	it("hydrates the exhausted MAX+1 port and equipment cursors", async () => {
		const snapshot = {
			...createPortEquipmentSnapshot({
				nextPortId: 1,
				nextEquipmentGroupId: 1,
				ports: [],
				equipmentGroups: [],
			}),
			nextPortId: 0x8000_0000,
			nextEquipmentGroupId: 0x8000_0000,
		};

		expect(hydratePortEquipmentSnapshot(snapshot)).toMatchObject({
			nextPortId: 0x8000_0000,
			nextEquipmentGroupId: 0x8000_0000,
		});
		await expect(
			hydratePortEquipmentSnapshotCooperatively(snapshot, async () => {}, 1),
		).resolves.toMatchObject({
			nextPortId: 0x8000_0000,
			nextEquipmentGroupId: 0x8000_0000,
		});
	});

	it("exposes every numeric buffer exactly once for Worker transfer", () => {
		const snapshot = createPortEquipmentSnapshot(fixture());
		const transfers = portEquipmentSnapshotTransfers(snapshot);

		expect(new Set(transfers).size).toBe(transfers.length);
		expect(transfers.every((buffer) => buffer.byteLength > 0)).toBe(true);
	});

	it("rejects corrupt unions and broken reciprocal group ownership", () => {
		const invalidRoute = createPortEquipmentSnapshot(fixture());
		invalidRoute.ports.routeKinds[0] = 9;
		expect(() => hydratePortEquipmentSnapshot(invalidRoute)).toThrow();

		const orphan = createPortEquipmentSnapshot(fixture());
		orphan.portIds[0] = 99;
		expect(() => hydratePortEquipmentSnapshot(orphan)).toThrow("missing port");
	});

	it("rejects an oversized CSR group before boxing its member row", async () => {
		const source = createPortEquipmentSnapshot(fixture());
		const oversized = {
			...source,
			equipmentGroups: {
				...source.equipmentGroups,
				portOffsets: new Uint32Array([0, 65, 65, 65]),
				portIds: new Int32Array(65),
			},
		};

		expect(() => hydratePortEquipmentSnapshot(oversized)).toThrow(/group port count/i);
		let checkpoints = 0;
		await expect(
			hydratePortEquipmentSnapshotCooperatively(
				oversized,
				async () => {
					checkpoints++;
				},
				1,
			),
		).rejects.toThrow(/group port count/i);
		expect(checkpoints).toBe(0);
	});

	it("rejects wrong-width, plain-array, and non-string snapshot columns", () => {
		const snapshot = createPortEquipmentSnapshot(fixture());
		expect(() =>
			hydratePortEquipmentSnapshot({
				...snapshot,
				portIds: new Uint32Array(snapshot.portIds) as unknown as Int32Array,
			}),
		).toThrow(/ID column must be Int32Array/i);
		expect(() =>
			hydratePortEquipmentSnapshot({
				...snapshot,
				ports: {
					...snapshot.ports,
					routeXs: [...snapshot.ports.routeXs] as unknown as Int32Array,
				},
			}),
		).toThrow(/invalid typed arrays/i);
		expect(() =>
			hydratePortEquipmentSnapshot({
				...snapshot,
				ports: {
					...snapshot.ports,
					barcodes: new Uint8Array(snapshot.portIds.length) as unknown as readonly (
						| string
						| null
					)[],
				},
			}),
		).toThrow(/barcode column/i);
		const sharedPortIds = new Int32Array(new SharedArrayBuffer(snapshot.portIds.byteLength));
		sharedPortIds.set(snapshot.portIds);
		expect(() =>
			hydratePortEquipmentSnapshot({
				...snapshot,
				portIds: sharedPortIds,
			}),
		).toThrow(/ID column must be Int32Array/i);
	});

	it("binds ports and groups into the authored checksum independent of input ordering", () => {
		const map = new TileMap();
		const state = fixture();
		const reversed: PortEquipmentState = {
			...state,
			ports: [...state.ports].reverse(),
			equipmentGroups: [...state.equipmentGroups].reverse(),
		};

		expect(checksumRailMap(map, state)).toBe(checksumRailMap(map, reversed));
		expect(checksumRailMap(map, state)).not.toBe(checksumRailMap(map));
	});

	it("round-trips reciprocal mutation batches through transferable patch buffers", () => {
		const state = copyPortEquipmentState(fixture());
		const port = state.ports[0];
		const group = state.equipmentGroups[0];
		if (!port || !group) throw new Error("expected static-world fixture records");
		const encoded = encodePortEquipmentPatch(
			[{ id: port.id, before: null, after: port }],
			[{ id: group.id, before: null, after: group }],
		);
		const delivered = structuredClone(encoded.fields, { transfer: encoded.transfer });

		expect(decodePortEquipmentPatch(delivered)).toEqual({
			portChanges: [{ id: port.id, before: null, after: port }],
			equipmentGroupChanges: [{ id: group.id, before: null, after: group }],
		});
		expect(new Set(encoded.transfer).size).toBe(encoded.transfer.length);
	});

	it("cooperatively encodes byte-identical reciprocal patch columns", async () => {
		const state = copyPortEquipmentState(fixture());
		const port = state.ports[0];
		const group = state.equipmentGroups[0];
		if (!port || !group) throw new Error("expected static-world fixture records");
		const portChanges = [{ id: port.id, before: null, after: port }];
		const groupChanges = [{ id: group.id, before: null, after: group }];
		const direct = encodePortEquipmentPatch(portChanges, groupChanges);
		let checkpoints = 0;

		const cooperative = await encodePortEquipmentPatchCooperatively(
			portChanges,
			groupChanges,
			async () => {
				checkpoints++;
			},
			1,
		);

		expect(cooperative.fields).toEqual(direct.fields);
		expect(cooperative.transfer.map((buffer) => buffer.byteLength)).toEqual(
			direct.transfer.map((buffer) => buffer.byteLength),
		);
		expect(new Set(cooperative.transfer).size).toBe(cooperative.transfer.length);
		expect(checkpoints).toBeGreaterThan(0);
	});

	it("rejects malformed patch presence markers before document mutation", () => {
		const state = copyPortEquipmentState(fixture());
		const port = state.ports[0];
		if (!port) throw new Error("expected port fixture");
		const encoded = encodePortEquipmentPatch([{ id: port.id, before: null, after: port }], []);
		encoded.fields.portAfterPresent[0] = 2;

		expect(() => decodePortEquipmentPatch(encoded.fields)).toThrow("presence");
	});

	it("rejects an oversized patch CSR row before boxing its members", () => {
		const state = copyPortEquipmentState(fixture());
		const group = state.equipmentGroups[0];
		if (!group) throw new Error("expected equipment group fixture");
		const encoded = encodePortEquipmentPatch([], [{ id: group.id, before: null, after: group }]);
		const forged = {
			...encoded.fields,
			equipmentGroupAfter: {
				...encoded.fields.equipmentGroupAfter,
				portOffsets: new Uint32Array([0, 65]),
				portIds: new Int32Array(65),
			},
		};

		expect(() => decodePortEquipmentPatch(forged)).toThrow(/group port count/i);
	});

	it("rejects patch columns whose runtime typed-array width does not match the protocol", () => {
		const state = copyPortEquipmentState(fixture());
		const port = state.ports[0];
		if (!port) throw new Error("expected port fixture");
		const encoded = encodePortEquipmentPatch([{ id: port.id, before: null, after: port }], []);
		const forged = {
			...encoded.fields,
			portAfter: {
				...encoded.fields.portAfter,
				routeKinds: new Int8Array(encoded.fields.portAfter.routeKinds),
			},
		} as unknown as typeof encoded.fields;

		expect(() => decodePortEquipmentPatch(forged)).toThrow(/invalid typed arrays/i);
	});
});

function fixture(): PortEquipmentState {
	const cardinal: CardinalPortRoute = {
		kind: "CARDINAL_CELL",
		x: 5,
		z: 3,
		from: DIR_E,
		to: DIR_W,
	};
	return {
		nextPortId: 8,
		nextEquipmentGroupId: 4,
		ports: [
			port(7, 3, "STK", cardinal, 3_500, "CENTER", 0),
			port(1, 1, "OHB", cardinal, 500, "LEFT", 700),
			port(4, 3, "STK", cardinal, 500, "CENTER", 0),
			port(2, 2, "EQ", cardinal, 1_500, "CENTER", 0),
			port(6, 3, "STK", cardinal, 2_500, "CENTER", 0),
			{
				...port(3, 2, "EQ", cardinal, 2_500, "RIGHT", 800),
				route: {
					kind: "ADVANCED_SWITCH_SEGMENT",
					switchId: 12,
					profileClass: "C",
					role: "THROAT",
					portIndex: null,
					segmentOrdinal: 2,
				},
			},
			port(5, 3, "STK", cardinal, 1_500, "CENTER", 0),
		],
		equipmentGroups: [
			{ id: 3, kind: "STK", template: "FOUR_PORT", portIds: [4, 5, 6, 7] },
			{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			{ id: 2, kind: "EQ", pitchMillimeters: 1_000, recipe: "PHOTO", portIds: [2, 3] },
		],
	};
}

function port(
	id: number,
	equipmentGroupId: number,
	portType: "OHB" | "EQ" | "STK",
	route: CardinalPortRoute,
	stationMillimeters: number,
	side: "CENTER" | "LEFT" | "RIGHT",
	lateralOffsetMillimeters: number,
) {
	return {
		id,
		equipmentGroupId,
		route,
		stationMillimeters,
		side,
		lateralOffsetMillimeters,
		direction: "WITH_TRAVEL" as const,
		portType,
		barcode: `PORT-${id}`,
	};
}
