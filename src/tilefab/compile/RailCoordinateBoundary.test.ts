import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RAIL_COORDINATE_MAX_METERS as BOUND } from "../core/RailCoordinateDomain";
import { RailDocument } from "../core/RailDocument";
import { ALL_DIRECTIONS, oppositeDirection } from "../core/railShape";
import { type Cell, TileMap } from "../core/TileMap";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { validateRailPhysicalLayoutContract } from "../worker/RailPhysicalLayout";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { samplePhysicalPath } from "./PhysicalPathCompiler";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { resolvePortAttachment } from "./PortAttachmentResolver";
import { compilePortEquipmentInteractionPresentation } from "./PortEquipmentInteractionPresentation";
import { compilePortEquipmentPresentation } from "./PortEquipmentPresentation";
import { compileBasePortSlots, portSlotRecord } from "./PortSlotCompiler";

function rails(paths: readonly (readonly [number, number, number, number])[]): TileMap {
	const document = new RailDocument();
	for (const [x, y, endX, endY] of paths) {
		expect(
			document.commit(
				planRailConstruction(document.map, { x, y }, { x: endX, y: endY }, "horizontal-first"),
			),
		).toBe(true);
	}
	return document.map;
}

const fixtures: { name: string; make: () => TileMap }[] = [
	{ name: "east rail", make: () => rails([[0, 0, 8, 0]]) },
	{ name: "south rail", make: () => rails([[0, 0, 0, 8]]) },
	{ name: "corner", make: () => rails([[0, 0, 6, 6]]) },
	{
		name: "branch with support",
		make: () =>
			rails([
				[0, 0, 12, 0],
				[4, 0, 4, 6],
			]),
	},
	{
		name: "merge with support",
		make: () =>
			rails([
				[0, 0, 12, 0],
				[4, 6, 4, 0],
			]),
	},
	...ADVANCED_SWITCH_PROFILE_CLASSES.flatMap((profileClass) =>
		ALL_DIRECTIONS.flatMap((forward) =>
			ALL_DIRECTIONS.filter(
				(lateral) => lateral !== forward && lateral !== oppositeDirection(forward),
			).map((lateral) => ({
				name: `advanced ${profileClass}/${forward}/${lateral}`,
				make: () => {
					const record = {
						id: 1,
						profileClass,
						origin: { x: 0, y: 0 },
						forward,
						lateral,
						movementMask: 15,
					};
					const map = new TileMap();
					for (const cell of deriveAdvancedSwitchGeometry(record).cellStates)
						map.setEncoded(cell.x, cell.y, cell.encoded);
					map.setAdvancedSwitch(record);
					return map;
				},
			})),
		),
	),
];

function translated(map: TileMap, origin: Cell): TileMap {
	const hydrator = TileMap.createHydrator();
	map.forEachRail((x, y, _rail, encoded) =>
		hydrator.addEncodedCell(x + origin.x, y + origin.y, encoded),
	);
	map.forEachAdvancedSwitch((record) =>
		hydrator.addAdvancedSwitch({
			...record,
			origin: { x: record.origin.x + origin.x, y: record.origin.y + origin.y },
		}),
	);
	return hydrator.finish(map.getRevision(), map.getAdvancedSwitchIdCursor());
}

function assertPortAndRoundtrip(map: TileMap): void {
	const layout = compilePhysicalRail(map);
	const slots = compileBasePortSlots(layout, "OHB");
	const row = slots.statuses.indexOf(0);
	// One actual legal route/station, with the maximum supported lateral offset. This does not
	// presume that the serialized maximum station is available on any particular path.
	const ports =
		row < 0
			? []
			: [{ ...portSlotRecord(slots, row, 1, 1, null), lateralOffsetMillimeters: 100_000 }];
	const state: PortEquipmentState = {
		nextPortId: ports.length + 1,
		nextEquipmentGroupId: ports.length + 1,
		ports,
		equipmentGroups: ports.map((port) => ({
			id: port.id,
			kind: "OHB",
			template: "SINGLE",
			portIds: [port.id],
		})),
	};
	const presentation = compilePortEquipmentPresentation(layout, state);
	const interaction = compilePortEquipmentInteractionPresentation(presentation);
	for (const buffer of [
		presentation.worldPositions,
		presentation.groupBounds,
		interaction.portPickBounds,
	]) {
		for (const coordinate of buffer) expect(Math.abs(coordinate)).toBeLessThan(2 ** 17);
	}
	for (const port of ports) expect(resolvePortAttachment(layout, port).ok).toBe(true);
	const document = RailDocument.fromLoadedMap(map, 0, state);
	const snapshot = captureRailMirrorSnapshot(map, 0, state).snapshot;
	const json = serializeOpenFabProject(
		captureOpenFabProject(document, {
			manifest: {
				id: "synthetic-boundary",
				name: "Synthetic boundary",
				createdAt: "2026-09-25T00:00:00.000Z",
				updatedAt: "2026-09-25T00:00:00.000Z",
			},
		}),
	);
	for (const source of [
		{ kind: "snapshot", snapshot } as const,
		{ kind: "project-json", json } as const,
	]) {
		const startup = compileRailStartup(source);
		expect(startup.snapshot.checksum).toBe(snapshot.checksum);
	}
}

describe("physical and native contracts at the V1 coordinate boundary", () => {
	it.each(
		fixtures,
	)("$name preserves supported geometry and rejects the next cell on each signed edge/corner", ({
		make,
	}) => {
		const base = make();
		const baseline = compilePhysicalRail(base);
		const bounds = base.bounds();
		if (!bounds) throw new Error("Synthetic fixture has no bounds");
		base.forEachAdvancedSwitch((record) => {
			for (const cell of [record.origin, ...deriveAdvancedSwitchGeometry(record).claimedCells]) {
				bounds.minX = Math.min(bounds.minX, cell.x);
				bounds.maxX = Math.max(bounds.maxX, cell.x);
				bounds.minY = Math.min(bounds.minY, cell.y);
				bounds.maxY = Math.max(bounds.maxY, cell.y);
			}
		});
		const cases = [
			{ origin: { x: 0, y: 0 }, supported: true },
			...[-1, 0, 1].flatMap((delta) => {
				const b = BOUND + delta,
					lowX = -b - bounds.minX,
					highX = b - bounds.maxX;
				const lowY = -b - bounds.minY,
					highY = b - bounds.maxY;
				return [
					{ x: lowX, y: 0 },
					{ x: highX, y: 0 },
					{ x: 0, y: lowY },
					{ x: 0, y: highY },
					{ x: lowX, y: lowY },
					{ x: lowX, y: highY },
					{ x: highX, y: lowY },
					{ x: highX, y: highY },
				].map((origin) => ({ origin, supported: delta <= 0 }));
			}),
		];
		for (const { origin, supported } of cases) {
			const map = translated(base, origin);
			if (!supported) {
				expect(() => RailDocument.fromLoadedMap(map, 0)).toThrow(/지원 범위/);
				continue;
			}
			expect(map.getUnsupportedCoordinateSourceCount()).toBe(0);
			const layout = compilePhysicalRail(map),
				paths = layout.paths;
			expect(layout.valid).toBe(true);
			expect(() => validateRailPhysicalLayoutContract(layout)).not.toThrow();
			expect(paths.pathCount).toBe(baseline.paths.pathCount);
			for (let p = 0; p < paths.pathCount; p++) {
				expect([
					paths.cells[p * 2] - origin.x,
					paths.cells[p * 2 + 1] - origin.y,
					paths.kinds[p],
					paths.fromDirections[p],
					paths.toDirections[p],
				]).toEqual([
					baseline.paths.cells[p * 2],
					baseline.paths.cells[p * 2 + 1],
					baseline.paths.kinds[p],
					baseline.paths.fromDirections[p],
					baseline.paths.toDirections[p],
				]);
				for (let point = paths.offsets[p]; point < paths.offsets[p + 1]; point++) {
					const reference = samplePhysicalPath(baseline.paths, p, paths.distances[point]);
					if (!reference) throw new Error("Missing origin path sample");
					// Observed point-translation regression budget, independent of clearance tolerance.
					expect(
						Math.hypot(
							paths.positions[point * 2] - origin.x - reference.x,
							paths.positions[point * 2 + 1] - origin.y - reference.y,
						),
					).toBeLessThan(0.006);
					if (
						point + 1 < paths.offsets[p + 1] &&
						paths.distances[point + 1] > paths.distances[point]
					) {
						expect(
							Math.hypot(
								paths.positions[(point + 1) * 2] - paths.positions[point * 2],
								paths.positions[(point + 1) * 2 + 1] - paths.positions[point * 2 + 1],
							),
						).toBeGreaterThan(0);
					}
				}
			}
			assertPortAndRoundtrip(map);
		}
	});
});
