import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	compilePortEquipmentInteractionPresentation,
	PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS,
	portEquipmentInteractionPresentationFor,
} from "./PortEquipmentInteractionPresentation";
import {
	type CompiledPortEquipmentPresentation,
	compilePortEquipmentPresentation,
	equipmentGroupPresentationRow,
	nearestPortEquipmentBodySectionPortRow,
	PORT_EQUIPMENT_BODY_FACE_KIND,
	PORT_EQUIPMENT_GROUP_PRESENTATION_MODE,
	PortEquipmentSpatialIndex,
	portEquipmentPresentationRow,
	portEquipmentSpatialIndexFor,
} from "./PortEquipmentPresentation";
import { compilePortEquipmentShellPresentation } from "./PortEquipmentShellPresentation";

describe("PortEquipmentPresentation", () => {
	it("keeps radius boundaries and stable ID ties when picking directly across chunks", () => {
		const document = new RailDocument();
		const empty = compilePortEquipmentPresentation(
			compilePhysicalRail(document.map),
			document.portEquipment,
		);
		const presentation = {
			...empty,
			count: 3,
			portIds: Int32Array.of(41, 7, 99),
			equipmentGroupIds: Int32Array.of(1, 2, 3),
			worldPositions: Float32Array.of(15, 0, 17, 0, 16, 3),
		};
		const index = new PortEquipmentSpatialIndex(presentation);
		for (let repeat = 0; repeat < 2; repeat++) {
			expect(index.nearest(16, 0, 1)).toMatchObject({ row: 1, portId: 7, distanceMeters: 1 });
			expect(index.nearest(16, 0, 0.999)).toBeNull();
			expect(index.nearest(15, 0, 0.001)).toMatchObject({ portId: 41, distanceMeters: 0 });
			expect(index.nearest(16, 1, Math.SQRT2)).toMatchObject({
				portId: 7,
				distanceMeters: Math.SQRT2,
			});
			expect(index.nearest(16, 1, Math.SQRT2 - 0.001)).toBeNull();
		}
	});

	it("does not index factory-wide physical routes when no ports require attachment", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const layout = compilePhysicalRail(document.map);
		const guardedLayout = new Proxy(layout, {
			get(target, property, receiver) {
				if (property === "pathIntervalRemap") {
					throw new Error("Empty equipment presentation must not build a route attachment index.");
				}
				return Reflect.get(target, property, receiver);
			},
		});
		const emptyState: PortEquipmentState = {
			nextPortId: 1,
			nextEquipmentGroupId: 1,
			ports: [],
			equipmentGroups: [],
		};

		const presentation = compilePortEquipmentPresentation(guardedLayout, emptyState);

		expect(presentation.revision).toBe(layout.revision);
		expect(presentation.count).toBe(0);
		expect(presentation.equipmentGroupCount).toBe(0);
		expect(presentation.bodySectionCount).toBe(0);
		expect(presentation.portBodySectionRows).toHaveLength(0);
		expect([...presentation.bodySectionPortOffsets]).toEqual([0]);
		expect(presentation.bodySectionPortRows).toHaveLength(0);
	});

	it("derives OHB render coordinates from canonical station data", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [
				{
					id: 1,
					equipmentGroupId: 1,
					route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
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
		const presentation = compilePortEquipmentPresentation(compilePhysicalRail(document.map), state);
		const interaction = portEquipmentInteractionPresentationFor(presentation);
		expect(portEquipmentInteractionPresentationFor(presentation)).toBe(interaction);

		expect(presentation.count).toBe(1);
		expect([...presentation.portIds]).toEqual([1]);
		expect(presentation.worldPositions[0]).toBeCloseTo(2.5, 5);
		expect(
			Math.abs(
				(presentation.worldPositions[1] as number) - (presentation.railPositions[1] as number),
			),
		).toBeCloseTo(0.7, 5);
		expect(presentation.barcodes).toEqual(["OHB-001"]);
		expect(presentation.equipmentGroupCount).toBe(1);
		expect([...presentation.groupIds]).toEqual([1]);
		expect([...presentation.groupKinds]).toEqual([0]);
		expect([...presentation.groupPresentationModes]).toEqual([
			PORT_EQUIPMENT_GROUP_PRESENTATION_MODE.BODY,
		]);
		expect([...presentation.groupPortOffsets]).toEqual([0, 1]);
		expect([...presentation.groupPortRows]).toEqual([0]);
		expect([...presentation.portBodySectionRows]).toEqual([0]);
		expect([...presentation.bodySectionPortOffsets]).toEqual([0, 1]);
		expect([...presentation.bodySectionPortRows]).toEqual([0]);
		expect([...presentation.portBodyFaceKinds]).toEqual([
			PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
		]);
		expect([...interaction.portOpeningCenters]).toEqual([...presentation.worldPositions]);
		expect(interaction.portOpeningNormals[0]).toBeCloseTo(1, 5);
		expect(interaction.portOpeningNormals[1]).toBeCloseTo(0, 5);
		expect(interaction.portPickBounds[0]).toBeCloseTo(
			(presentation.worldPositions[0] as number) - PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS,
			5,
		);
		expect(interaction.portPickBounds[3]).toBeCloseTo(
			(presentation.worldPositions[1] as number) + PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS,
			5,
		);
		expect(interaction.byteLength).toBe(32);
		expect(portEquipmentPresentationRow(presentation, 1)).toBe(0);
		expect(portEquipmentPresentationRow(presentation, 99)).toBeNull();
		const hit = new PortEquipmentSpatialIndex(presentation).nearest(
			presentation.worldPositions[0] as number,
			presentation.worldPositions[1] as number,
			0.25,
		);
		expect(hit).toMatchObject({ row: 0, portId: 1, equipmentGroupId: 1 });
		expect(hit?.distanceMeters).toBeCloseTo(0, 5);
		expect(new PortEquipmentSpatialIndex(presentation).nearest(9, 9, 0.25)).toBeNull();
		expect(portEquipmentSpatialIndexFor(presentation)).toBe(
			portEquipmentSpatialIndexFor(presentation),
		);
	});

	it("derives explicit opening face, normal, and pick bounds from equipment-facing direction", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 3,
			ports: [
				{
					id: 1,
					equipmentGroupId: 1,
					route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
					stationMillimeters: 500,
					side: "CENTER",
					lateralOffsetMillimeters: 0,
					direction: "WITH_TRAVEL",
					portType: "OHB",
					barcode: null,
				},
				{
					id: 2,
					equipmentGroupId: 2,
					route: { kind: "CARDINAL_CELL", x: 4, z: 0, from: DIR_W, to: DIR_E },
					stationMillimeters: 500,
					side: "CENTER",
					lateralOffsetMillimeters: 0,
					direction: "AGAINST_TRAVEL",
					portType: "OHB",
					barcode: null,
				},
			],
			equipmentGroups: [
				{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
				{ id: 2, kind: "OHB", template: "SINGLE", portIds: [2] },
			],
		};
		const presentation = compilePortEquipmentPresentation(compilePhysicalRail(document.map), state);
		const interaction = compilePortEquipmentInteractionPresentation(presentation);

		expect([...presentation.portBodyFaceKinds]).toEqual([
			PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
			PORT_EQUIPMENT_BODY_FACE_KIND.AGAINST_SECTION_TANGENT,
		]);
		expect(interaction.portOpeningCenters).toHaveLength(presentation.count * 2);
		expect(interaction.portOpeningNormals).toHaveLength(presentation.count * 2);
		expect(interaction.portPickBounds).toHaveLength(presentation.count * 4);
		for (let row = 0; row < presentation.count; row++) {
			const sectionRow = presentation.portBodySectionRows[row] as number;
			const normalX = interaction.portOpeningNormals[row * 2] as number;
			const normalZ = interaction.portOpeningNormals[row * 2 + 1] as number;
			const tangentX = presentation.bodySectionTangents[sectionRow * 2] as number;
			const tangentZ = presentation.bodySectionTangents[sectionRow * 2 + 1] as number;
			expect(Math.hypot(normalX, normalZ)).toBeCloseTo(1, 5);
			expect(normalX * tangentX + normalZ * tangentZ).toBeCloseTo(row === 0 ? 1 : -1, 5);
			const boundsOffset = row * 4;
			expect(
				(interaction.portPickBounds[boundsOffset + 2] as number) -
					(interaction.portPickBounds[boundsOffset] as number),
			).toBeCloseTo(PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS * 2, 5);
			expect(
				(interaction.portPickBounds[boundsOffset + 3] as number) -
					(interaction.portPickBounds[boundsOffset + 1] as number),
			).toBeCloseTo(PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS * 2, 5);
		}
	});

	it("compiles a multi-port EQ as one oriented SoA equipment group", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const state: PortEquipmentState = {
			nextPortId: 4,
			nextEquipmentGroupId: 2,
			ports: [2, 4, 6].map((x, index) => ({
				id: index + 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL" as const, x, z: 0, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "EQ" as const,
				barcode: `EQ-1-P0${index + 1}`,
			})),
			equipmentGroups: [
				{ id: 1, kind: "EQ", pitchMillimeters: 2_000, recipe: "PHOTO", portIds: [1, 2, 3] },
			],
		};
		const presentation = compilePortEquipmentPresentation(compilePhysicalRail(document.map), state);

		expect(presentation.equipmentGroupCount).toBe(1);
		expect([...presentation.groupIds]).toEqual([1]);
		expect([...presentation.groupKinds]).toEqual([1]);
		expect([...presentation.groupPresentationModes]).toEqual([
			PORT_EQUIPMENT_GROUP_PRESENTATION_MODE.BODY,
		]);
		expect([...presentation.groupPortOffsets]).toEqual([0, 3]);
		expect([...presentation.groupPortRows]).toEqual([0, 1, 2]);
		expect([...presentation.groupCenters]).toEqual([4.5, 0.5]);
		expect([...presentation.groupTangents]).toEqual([1, 0]);
		expect(presentation.groupHalfExtents[0]).toBeCloseTo(2.5, 5);
		expect(presentation.groupHalfExtents[1]).toBeCloseTo(0.45, 5);
		expect([...presentation.groupBounds]).toHaveLength(4);
		expect(presentation.groupBounds[0]).toBeCloseTo(2, 5);
		expect(presentation.groupBounds[1]).toBeCloseTo(0.05, 5);
		expect(presentation.groupBounds[2]).toBeCloseTo(7, 5);
		expect(presentation.groupBounds[3]).toBeCloseTo(0.95, 5);
		expect(equipmentGroupPresentationRow(presentation, 1)).toBe(0);
		expect(equipmentGroupPresentationRow(presentation, 99)).toBeNull();
		const index = new PortEquipmentSpatialIndex(presentation);
		const visibleRows = index.query({
			minX: 2,
			minZ: 0,
			maxX: 3,
			maxZ: 1,
		});
		expect(visibleRows).toEqual([0]);
		expect(
			index.query({
				minX: 6.75,
				minZ: 0.2,
				maxX: 6.9,
				maxZ: 0.8,
			}),
		).toEqual([]);
		expect(
			index.queryGroups({
				minX: 6.75,
				minZ: 0.2,
				maxX: 6.9,
				maxZ: 0.8,
			}),
		).toEqual([0]);
		expect(index.groupAt(3.5, 0.5)).toMatchObject({
			row: 0,
			portId: 1,
			equipmentGroupId: 1,
			distanceMeters: 0,
		});
		expect(index.groupAt(8, 3)).toBeNull();
	});

	it("indexes a sparse FLEX STK as one connected-run reservation body", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			ports: [2, 6].map((x, index) => ({
				id: index + 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL" as const, x, z: 0, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "STK" as const,
				barcode: `STK-1-P0${index + 1}`,
			})),
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		};
		const presentation = compilePortEquipmentPresentation(compilePhysicalRail(document.map), state);
		const index = new PortEquipmentSpatialIndex(presentation);

		expect([...presentation.groupPresentationModes]).toEqual([
			PORT_EQUIPMENT_GROUP_PRESENTATION_MODE.BODY,
		]);
		expect(presentation.bodySectionCount).toBe(1);
		expect([...presentation.groupBodySectionOffsets]).toEqual([0, 1]);
		expect([...presentation.bodySectionCenters]).toEqual([4.5, 0.5]);
		expect(presentation.bodySectionHalfExtents[0]).toBeCloseTo(2.5, 5);
		expect(index.queryGroups({ minX: 1, minZ: 0, maxX: 7, maxZ: 1 })).toEqual([0]);
		expect(index.queryBodySections({ minX: 1, minZ: 0, maxX: 7, maxZ: 1 })).toEqual([0]);
		expect(index.groupAt(4.5, 0.5)).toMatchObject({
			portId: 1,
			equipmentGroupId: 1,
			distanceMeters: 0,
		});
		expect(index.nearest(2.5, 0.5, 0.25)).toMatchObject({ portId: 1, equipmentGroupId: 1 });
	});

	it("keeps a legacy CUSTOM STK selectable when no exact straight-run sweep exists", () => {
		const hydrator = TileMap.createHydrator();
		hydrator.addEncodedCell(0, 0, encodeRailCell({ incoming: DIR_N, outgoing: DIR_E }));
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [
				{
					id: 1,
					equipmentGroupId: 1,
					route: { kind: "CARDINAL_CELL", x: 0, z: 0, from: DIR_N, to: DIR_E },
					stationMillimeters: 500,
					side: "CENTER",
					lateralOffsetMillimeters: 0,
					direction: "WITH_TRAVEL",
					portType: "STK",
					barcode: null,
				},
			],
			equipmentGroups: [{ id: 1, kind: "STK", template: "CUSTOM", portIds: [1] }],
		};
		const layout = compilePhysicalRail(hydrator.finish(16));

		const presentation = compilePortEquipmentPresentation(layout, state);

		expect(presentation.bodySectionCount).toBe(1);
		expect([...presentation.portBodySectionRows]).toEqual([0]);
		expect([...presentation.bodySectionPortOffsets]).toEqual([0, 1]);
		expect([...presentation.bodySectionPortRows]).toEqual([0]);
		expect(
			new PortEquipmentSpatialIndex(presentation).groupAt(
				presentation.bodySectionCenters[0] as number,
				presentation.bodySectionCenters[1] as number,
			),
		).toMatchObject({ portId: 1, equipmentGroupId: 1 });
		expect(() =>
			compilePortEquipmentPresentation(layout, {
				...state,
				equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1] }],
			}),
		).toThrow("no complete exact straight-run body mapping");
	});

	it("resolves a multi-run STK body click to the nearest port on that run", () => {
		const hydrator = TileMap.createHydrator();
		for (let coordinate = 0; coordinate <= 7; coordinate++) {
			hydrator.addEncodedCell(coordinate, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
			hydrator.addEncodedCell(20, coordinate, encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }));
		}
		const portLocations: readonly {
			readonly id: number;
			readonly x: number;
			readonly z: number;
			readonly from: Direction;
			readonly to: Direction;
		}[] = [
			{ id: 1, x: 1, z: 0, from: DIR_W, to: DIR_E },
			{ id: 2, x: 5, z: 0, from: DIR_W, to: DIR_E },
			{ id: 3, x: 20, z: 1, from: DIR_N, to: DIR_S },
			{ id: 4, x: 20, z: 5, from: DIR_N, to: DIR_S },
		];
		const state: PortEquipmentState = {
			nextPortId: 5,
			nextEquipmentGroupId: 2,
			ports: portLocations.map(({ id, x, z, from, to }) => ({
				id,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL" as const, x, z, from, to },
				stationMillimeters: 500,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "STK" as const,
				barcode: `STK-1-P0${id}`,
			})),
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2, 3, 4] }],
		};
		const presentation = compilePortEquipmentPresentation(
			compilePhysicalRail(hydrator.finish(16)),
			state,
		);
		const index = new PortEquipmentSpatialIndex(presentation);

		expect(presentation.bodySectionCount).toBe(2);
		expect([...presentation.portBodySectionRows]).toEqual([0, 0, 1, 1]);
		expect([...presentation.bodySectionPortOffsets]).toEqual([0, 2, 4]);
		expect([...presentation.bodySectionPortRows]).toEqual([0, 1, 2, 3]);
		for (let portRow = 0; portRow < presentation.count; portRow++) {
			const sectionRow = presentation.portBodySectionRows[portRow] as number;
			const groupRow = presentation.bodySectionGroupRows[sectionRow] as number;
			expect(presentation.groupIds[groupRow]).toBe(presentation.equipmentGroupIds[portRow]);
			expect([...presentation.bodySectionPortRows].filter((row) => row === portRow)).toHaveLength(
				1,
			);
		}
		expect(nearestPortEquipmentBodySectionPortRow(presentation, 0, 3.5, 0.5)).toBe(0);
		expect(nearestPortEquipmentBodySectionPortRow(presentation, 1, 20.5, 4.5)).toBe(3);
		const malformedDirect = {
			...presentation,
			portBodySectionRows: new Uint32Array(presentation.portBodySectionRows),
		} as CompiledPortEquipmentPresentation;
		malformedDirect.portBodySectionRows[2] = 0;
		expect(nearestPortEquipmentBodySectionPortRow(malformedDirect, 1, 20.5, 4.5)).toBeNull();
		const malformedGroup = {
			...presentation,
			equipmentGroupIds: new Int32Array(presentation.equipmentGroupIds),
		} as CompiledPortEquipmentPresentation;
		malformedGroup.equipmentGroupIds[2] = 99;
		expect(nearestPortEquipmentBodySectionPortRow(malformedGroup, 1, 20.5, 4.5)).toBeNull();
		const malformedBijection = {
			...presentation,
			bodySectionPortRows: Uint32Array.of(0, 0, 2, 3),
		} as CompiledPortEquipmentPresentation;
		expect(new PortEquipmentSpatialIndex(malformedBijection).groupAt(3.5, 0.5)).toBeNull();
		expect(index.groupAt(3.5, 0.5)).toMatchObject({ portId: 1, equipmentGroupId: 1 });
		expect(index.groupAt(20.5, 4.5)).toMatchObject({ portId: 4, equipmentGroupId: 1 });
		expect(index.groupAt(Number.POSITIVE_INFINITY, 0.5)).toBeNull();
		expect(index.nearest(Number.NEGATIVE_INFINITY, 0.5, 1)).toBeNull();
		expect(index.query({ minX: 0, minZ: 0, maxX: Number.POSITIVE_INFINITY, maxZ: 1 })).toEqual([]);
		expect(
			index.queryBodySections({ minX: 0, minZ: 0, maxX: 1, maxZ: Number.NEGATIVE_INFINITY }),
		).toEqual([]);
	});

	it("keeps STK body selection on the owning section when another run has a closer port", () => {
		const hydrator = TileMap.createHydrator();
		for (let x = 0; x <= 100; x++) {
			hydrator.addEncodedCell(x, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
			hydrator.addEncodedCell(x, 2, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		}
		const state: PortEquipmentState = {
			nextPortId: 4,
			nextEquipmentGroupId: 2,
			ports: [stkPort(1, 1, 0), stkPort(2, 99, 0), stkPort(3, 50, 2)],
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2, 3] }],
		};
		const presentation = compilePortEquipmentPresentation(
			compilePhysicalRail(hydrator.finish(16)),
			state,
		);
		const index = new PortEquipmentSpatialIndex(presentation);

		expect(presentation.bodySectionCount).toBe(2);
		expect(index.groupAt(50.5, 0.5)).toMatchObject({
			portId: 1,
			equipmentGroupId: 1,
			distanceMeters: 0,
		});
		expect(index.groupAt(50.5, 2.5)).toMatchObject({
			portId: 3,
			equipmentGroupId: 1,
			distanceMeters: 0,
		});
	});

	it("compiles 50,000 independent STK sweep groups within a bounded scale budget", () => {
		const hydrator = TileMap.createHydrator();
		hydrator.addEncodedCell(0, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		const layout = compilePhysicalRail(hydrator.finish(16));
		const groupCount = 50_000;
		const state: PortEquipmentState = {
			nextPortId: groupCount + 1,
			nextEquipmentGroupId: groupCount + 1,
			ports: Array.from({ length: groupCount }, (_, index) => stkPort(index + 1, 0, 0, index + 1)),
			equipmentGroups: Array.from({ length: groupCount }, (_, index) => ({
				id: index + 1,
				kind: "STK" as const,
				template: "FLEX" as const,
				portIds: [index + 1],
			})),
		};

		const startedAt = performance.now();
		const presentation = compilePortEquipmentPresentation(layout, state);
		const interaction = compilePortEquipmentInteractionPresentation(presentation);
		const shell = compilePortEquipmentShellPresentation(presentation, interaction);
		const elapsedMilliseconds = performance.now() - startedAt;

		expect(presentation.equipmentGroupCount).toBe(groupCount);
		expect(presentation.bodySectionCount).toBe(groupCount);
		expect(presentation.portBodySectionRows).toHaveLength(groupCount);
		expect(presentation.bodySectionPortOffsets).toHaveLength(groupCount + 1);
		expect(presentation.bodySectionPortRows).toHaveLength(groupCount);
		expect(presentation.portBodyFaceKinds).toHaveLength(groupCount);
		expect(interaction.portOpeningCenters).toHaveLength(groupCount * 2);
		expect(interaction.portOpeningNormals).toHaveLength(groupCount * 2);
		expect(interaction.portPickBounds).toHaveLength(groupCount * 4);
		expect(interaction.byteLength).toBe(groupCount * 32);
		expect(shell.bodySectionCount).toBe(groupCount);
		expect(shell.shellSpanCount).toBe(groupCount * 2);
		expect(shell.portSlotCount).toBe(groupCount);
		expect(shell.byteLength).toBe(groupCount * 116);
		expect(
			presentation.portBodySectionRows.byteLength +
				presentation.bodySectionPortOffsets.byteLength +
				presentation.bodySectionPortRows.byteLength +
				presentation.portBodyFaceKinds.byteLength,
		).toBe(groupCount * 13 + 4);
		expect(presentation.bodySectionPortOffsets[groupCount]).toBe(groupCount);
		expect(elapsedMilliseconds).toBeLessThan(1_200);
	}, 5_000);

	it("keeps co-located stable ports distinct and resolves distance ties by stable id", () => {
		const presentation = {
			count: 2,
			bodySectionCount: 1,
			equipmentGroupCount: 1,
			portIds: Int32Array.of(41, 7),
			equipmentGroupIds: Int32Array.of(1, 1),
			groupIds: Int32Array.of(1),
			worldPositions: Float32Array.of(5, 8, 5, 8),
			yawRadians: Float32Array.of(0, 0),
			portBodySectionRows: Uint32Array.of(0, 0),
			portBodyFaceKinds: Uint8Array.of(
				PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
				PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT,
			),
			bodySectionGroupRows: Uint32Array.of(0),
			bodySectionPortOffsets: Uint32Array.of(0, 2),
			bodySectionPortRows: Uint32Array.of(0, 1),
		} as unknown as CompiledPortEquipmentPresentation;
		const interaction = compilePortEquipmentInteractionPresentation(presentation);

		expect(nearestPortEquipmentBodySectionPortRow(presentation, 0, 5, 8)).toBe(1);
		expect(interaction.count).toBe(2);
		expect(interaction.portOpeningCenters).toHaveLength(4);
		expect(interaction.portPickBounds).toHaveLength(8);
		expect([...interaction.portOpeningCenters]).toEqual([5, 8, 5, 8]);
		const cached = portEquipmentInteractionPresentationFor(presentation);
		const changedPresentation = {
			...presentation,
			yawRadians: Float32Array.of(Math.PI, Math.PI),
			portBodyFaceKinds: Uint8Array.of(
				PORT_EQUIPMENT_BODY_FACE_KIND.UNKNOWN,
				PORT_EQUIPMENT_BODY_FACE_KIND.UNKNOWN,
			),
		} as CompiledPortEquipmentPresentation;
		const changed = portEquipmentInteractionPresentationFor(changedPresentation);
		expect(portEquipmentInteractionPresentationFor(presentation)).toBe(cached);
		expect(changed).not.toBe(cached);
		expect(changed.portOpeningNormals[0]).toBeCloseTo(-1, 5);
		expect(() =>
			compilePortEquipmentInteractionPresentation({
				...presentation,
				portBodyFaceKinds: Uint8Array.of(99, 0),
			} as CompiledPortEquipmentPresentation),
		).toThrow("interaction mapping is malformed");
		presentation.bodySectionPortRows.reverse();
		expect(nearestPortEquipmentBodySectionPortRow(presentation, 0, 5, 8)).toBe(1);
	});

	it("rejects the empty AABB corners of a rotated body section", () => {
		const extent = Math.SQRT1_2 * 1.2;
		const presentation = {
			count: 1,
			equipmentGroupCount: 1,
			portIds: Int32Array.of(1),
			equipmentGroupIds: Int32Array.of(1),
			worldPositions: Float32Array.of(0, 0),
			groupIds: Int32Array.of(1),
			groupKinds: Uint8Array.of(1),
			bodySectionCount: 1,
			bodySectionGroupRows: Uint32Array.of(0),
			bodySectionCenters: Float32Array.of(0, 0),
			bodySectionTangents: Float32Array.of(Math.SQRT1_2, Math.SQRT1_2),
			bodySectionHalfExtents: Float32Array.of(1, 0.2),
			bodySectionBounds: Float32Array.of(-extent, -extent, extent, extent),
			portBodySectionRows: Uint32Array.of(0),
			bodySectionPortOffsets: Uint32Array.of(0, 1),
			bodySectionPortRows: Uint32Array.of(0),
		} as unknown as CompiledPortEquipmentPresentation;
		const index = new PortEquipmentSpatialIndex(presentation);

		expect(index.groupAt(0.5, 0.5)).toMatchObject({ portId: 1, equipmentGroupId: 1 });
		expect(index.groupAt(0.75, -0.75)).toBeNull();
	});
});

function stkPort(id: number, x: number, z: number, equipmentGroupId = 1): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL" as const, x, z, from: DIR_W, to: DIR_E },
		stationMillimeters: 500,
		side: "CENTER" as const,
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL" as const,
		portType: "STK" as const,
		barcode: `STK-${equipmentGroupId}-P01`,
	};
}
