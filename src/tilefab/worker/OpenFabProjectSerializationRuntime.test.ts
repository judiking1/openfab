import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { portEquipmentGroupSlotIndexFor } from "../compile/PortEquipmentGroupEditPlanner";
import { planPortEquipmentMembershipEdit } from "../compile/PortEquipmentMembershipEditPlanner";
import { planStkPlacement } from "../compile/PortPlacementPlanner";
import { PortSlotAvailabilityIndex } from "../compile/PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "../compile/PortSlotPreparedArtifacts";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { createEmptyOpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import {
	createRailSnapshotFromOpenFabProject,
	type OpenFabProjectManifest,
} from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { serializeOpenFabProjectSnapshot } from "./OpenFabProjectSerializationRuntime";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";
import { createRailScaleProbeDocument } from "./RailStartupFixture";

describe("serializeOpenFabProjectSnapshot", () => {
	it.each([
		{ cells: 10_000, maximumCharacters: 700_000, maximumMilliseconds: 2_000 },
		{ cells: 50_000, maximumCharacters: 3_500_000, maximumMilliseconds: 5_000 },
	])("round-trips a $cells-cell project within the native file budget", ({
		cells,
		maximumCharacters,
		maximumMilliseconds,
	}) => {
		const document = createRailScaleProbeDocument(cells);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const startedAt = performance.now();
		const serialized = serializeOpenFabProjectSnapshot(snapshot, MANIFEST, null, EMPTY_BLUEPRINTS);
		const parsed = parseOpenFabProjectJson(serialized.json).project;
		const loaded = createRailSnapshotFromOpenFabProject(parsed);
		const elapsed = performance.now() - startedAt;

		expect(parsed.rail.cells).toHaveLength(cells);
		expect(loaded.checksum).toBe(snapshot.checksum);
		expect(loaded.revision).toBe(snapshot.revision);
		expect(loaded.sequence).toBe(snapshot.sequence);
		expect(serializeOpenFabProject(parsed)).toBe(serialized.json);
		expect(serialized.characterCount).toBeLessThan(maximumCharacters);
		expect(elapsed).toBeLessThan(maximumMilliseconds);
	});

	it("rejects a detached or corrupted source snapshot before emitting bytes", () => {
		const document = createRailScaleProbeDocument(12);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		snapshot.encoded[0] ^= 1;

		expect(() =>
			serializeOpenFabProjectSnapshot(snapshot, MANIFEST, null, EMPTY_BLUEPRINTS),
		).toThrow("checksum does not match");
	});

	it("preserves non-empty ports and equipment groups through Worker save-load-save", () => {
		const document = createRailScaleProbeDocument(12);
		const portEquipment = portEquipmentFixture();
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			portEquipment,
		).snapshot;
		const first = serializeOpenFabProjectSnapshot(snapshot, MANIFEST, null, EMPTY_BLUEPRINTS);
		const parsed = parseOpenFabProjectJson(first.json).project;
		const loaded = createRailSnapshotFromOpenFabProject(parsed);
		const second = serializeOpenFabProjectSnapshot(loaded, MANIFEST, null, EMPTY_BLUEPRINTS);

		expect(parsed.ports.records).toHaveLength(1);
		expect(parsed.equipment.records).toEqual([
			{ id: 1, kind: "OHB", portIds: [1], template: "SINGLE" },
		]);
		expect(loaded.checksum).toBe(snapshot.checksum);
		expect(second.json).toBe(first.json);
	});

	it("preserves edited FLEX STK membership through Worker save-load-save", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const rowAt = (x: number): number => {
			for (let row = 0; row < slots.count; row++) {
				if (slots.routeXs[row] === x && slots.routeZs[row] === 0) return row;
			}
			throw new Error(`Missing STK Worker serialization slot at ${x}:0.`);
		};
		expect(
			document.commitPortEquipment(
				planStkPlacement(
					slots,
					[2, 4, 6].map(rowAt),
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
					document.portEquipment,
					"FLEX",
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		const edit = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			1,
			[2, 5, 7].map(rowAt),
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(edit.valid, edit.reason).toBe(true);
		expect(document.commitPortEquipment(edit)).toBe(true);

		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot;
		const first = serializeOpenFabProjectSnapshot(snapshot, MANIFEST, null, EMPTY_BLUEPRINTS);
		const parsed = parseOpenFabProjectJson(first.json).project;
		const loaded = createRailSnapshotFromOpenFabProject(parsed);
		const second = serializeOpenFabProjectSnapshot(loaded, MANIFEST, null, EMPTY_BLUEPRINTS);

		expect(parsed.ports).toMatchObject({
			nextPortId: 6,
			records: [
				{ id: 1, barcode: "STK-1-P01" },
				{ id: 4, barcode: "STK-1-PORT-4" },
				{ id: 5, barcode: "STK-1-PORT-5" },
			],
		});
		expect(parsed.equipment.records).toEqual([
			{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 4, 5] },
		]);
		expect(loaded.checksum).toBe(snapshot.checksum);
		expect(second.json).toBe(first.json);
	});
});

function portEquipmentFixture(): PortEquipmentState {
	return {
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL", x: 1, z: 0, from: DIR_E, to: DIR_W },
				stationMillimeters: 500,
				side: "LEFT",
				lateralOffsetMillimeters: 700,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: "OHB-001",
			},
		],
		equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
	};
}

const MANIFEST: OpenFabProjectManifest = Object.freeze({
	id: "scale-project",
	name: "Scale project",
	createdAt: "2026-07-18T00:00:00.000Z",
	updatedAt: "2026-07-18T00:00:00.000Z",
});

const EMPTY_BLUEPRINTS = createEmptyOpenFabProjectBlueprintSection();
