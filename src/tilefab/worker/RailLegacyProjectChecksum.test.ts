import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { emptyStaticFabAssemblyRelationshipState } from "../core/StaticFabAssemblyRelationship";
import {
	copyStaticFabOrganizationRecord,
	emptyStaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { checksumLegacyOpenFabProject } from "./RailLegacyProjectChecksum";
import { RailChecksumAccumulator } from "./RailMirrorChecksum";

describe("historical native recovery checksums", () => {
	const relationships = emptyStaticFabAssemblyRelationshipState();
	const rail = (): TileMap => {
		const map = new TileMap();
		map.setEncoded(0, 0, 40);
		map.setEncoded(1, 0, 40);
		return map;
	};
	const ports: PortEquipmentState = {
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL", x: 0, z: 0, from: 8, to: 2 },
				stationMillimeters: 500,
				side: "LEFT",
				lateralOffsetMillimeters: 1500,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: "OHB-001",
			},
		],
		equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
	};
	const legacyOrganization = () =>
		copyStaticFabOrganizationRecord({
			id: 7,
			kind: "BAY",
			name: "Legacy Digest Bay",
			membership: {
				railEdges: [
					{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
					{ from: { x: 1, y: 0 }, to: { x: 1, y: 1 } },
				],
				advancedSwitchIds: [11, 19],
				equipmentGroupIds: [23, 29],
			},
		});

	// Fixed outputs from the original internal accumulator classes, before this verifier existed.
	it("preserves the schema1 five-field contract from 72805a0d9d2529e5ec92661ed8bac1669ba43750", () => {
		expect(
			checksumLegacyOpenFabProject(
				1,
				rail(),
				emptyPortEquipmentState(),
				emptyStaticFabOrganizationState(),
				relationships,
			),
		).toBe("00000002:00000002:00000000:6c64ca58:997022e9");
	});
	it.each([
		2, 3, 4, 5,
	])("preserves the schema%s seven-field contract from d9d02c67265c146163ecfc9b0fecb314b742cf18", (version) => {
		expect(
			checksumLegacyOpenFabProject(
				version,
				rail(),
				ports,
				emptyStaticFabOrganizationState(),
				relationships,
			),
		).toBe("00000002:00000002:00000000:00000001:00000001:9e00a187:4d17dff5");
	});
	it("preserves the schema6 metadata formula from db4e001a147d58e0a75bdb791a2499b45e8dfc45", () => {
		expect(
			checksumLegacyOpenFabProject(
				6,
				new TileMap(),
				emptyPortEquipmentState(),
				{ records: [legacyOrganization()], nextOrganizationId: 31 },
				relationships,
			),
		).toBe("00000000:00000000:00000000:00000000:00000000:00000001:0000001f:81e71a4a:1b160a50");
	});
	it.each([
		7, 8, 9, 10,
	])("preserves the original schema%s golden from 9b3b1a6's parent", (version) => {
		const record = copyStaticFabOrganizationRecord({
			...legacyOrganization(),
			parentOrganizationIds: [2, 5],
			properties: { description: "Checksum contract", color: "AMBER" },
		});
		expect(
			checksumLegacyOpenFabProject(
				version,
				new TileMap(),
				emptyPortEquipmentState(),
				{ records: [record], nextOrganizationId: 31 },
				relationships,
			),
		).toBe("00000000:00000000:00000000:00000000:00000000:00000001:0000001f:55bf56a6:f5ae92b4");
	});
	it("rejects impossible old metadata, cursors and all historical digests as current authority", () => {
		const record = legacyOrganization();
		expect(() =>
			checksumLegacyOpenFabProject(
				6,
				new TileMap(),
				emptyPortEquipmentState(),
				{
					records: [{ ...record, properties: { description: "new", color: "TEAL" } }],
					nextOrganizationId: 31,
				},
				relationships,
			),
		).toThrow(/metadata/);
		expect(() =>
			checksumLegacyOpenFabProject(
				1,
				rail(),
				{ ...emptyPortEquipmentState(), nextPortId: 2 },
				emptyStaticFabOrganizationState(),
				relationships,
			),
		).toThrow(/equipment/);
		for (const version of [1, 2, 6, 7, 11, 12, 13]) {
			const historical = checksumLegacyOpenFabProject(
				version,
				rail(),
				emptyPortEquipmentState(),
				emptyStaticFabOrganizationState(),
				relationships,
			);
			expect(() => RailChecksumAccumulator.fromDigest(historical)).toThrow();
		}
	});
});
