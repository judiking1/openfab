import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { DIR_E, DIR_S, DIR_W, directionBetween } from "./railShape";
import { compareDirectedRailEdges } from "./StaticFabOrganization";
import type { StaticFabOrganizationBundle } from "./StaticFabOrganizationBundle";
import {
	isIssuedStaticFabOrganizationBundlePlacementPlan,
	type StaticFabOrganizationBundlePlacementPlan,
} from "./StaticFabOrganizationBundlePlacement";
import {
	isStaticFabOrganizationBundlePlacementPreview,
	isStaticFabOrganizationBundlePlacementPreviewArtifact,
	planStaticFabOrganizationBundlePlacementPreview,
	prepareStaticFabOrganizationBundlePlacementPreviewArtifact,
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS,
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_MAP_COLLISION_READS,
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_SAMPLED_CELLS,
	type StaticFabOrganizationBundlePlacementPreviewArtifact,
	type StaticFabOrganizationBundlePlacementPreviewMapReader,
	staticFabOrganizationBundlePlacementPreviewSampleIndices,
} from "./StaticFabOrganizationBundlePlacementPreview";
import { encodeRailCell, TileMap } from "./TileMap";

describe("StaticFabOrganizationBundlePlacementPreview", () => {
	it("prepares immutable deterministic local SoA geometry and rotates around the portable origin", () => {
		const mutable = lineBundle(5, true);
		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(mutable, 0);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		const artifact = prepared.artifact;
		expect(isStaticFabOrganizationBundlePlacementPreviewArtifact(artifact)).toBe(true);
		expect(Object.isFrozen(artifact)).toBe(true);
		expect(Object.isFrozen(artifact.chunks)).toBe(true);
		expect(Object.isFrozen(artifact.chunks[0]?.railEdgeIndices)).toBe(true);
		expect(Object.isFrozen(artifact.organizations)).toBe(true);
		expect(artifact.widthMeters).toBe(5);
		expect(artifact.heightMeters).toBe(0);
		expect(artifact.railEdgeCount).toBe(5);
		expect(artifact.footprintCellCount).toBe(6);
		expect(artifact.chunkCount).toBe(1);
		expect(artifact.readChunk(0, 0)).toBe(artifact.chunks[0]);
		expect(artifact.readChunk(1, 0)).toBeNull();
		expect(artifact.portCount).toBe(1);
		expect(artifact.equipmentGroupCount).toBe(1);
		expect(artifact.readRailEdge(0)).toEqual({
			index: 0,
			fromX: 0,
			fromY: 0,
			toX: 1,
			toY: 0,
		});
		expect(Object.isFrozen(artifact.readRailEdge(0))).toBe(true);
		expect(artifact.readPort(0)).toMatchObject({
			index: 0,
			equipmentGroupIndex: 0,
			portType: "OHB",
			railX: 2.5,
			railY: 0.5,
			worldX: 2.5,
			worldY: 1.5,
		});
		expect(artifact.readEquipmentGroup(0)).toMatchObject({
			index: 0,
			order: 0,
			kind: "OHB",
			template: "SINGLE",
			portIndices: [0],
			sections: [{ minX: 2.5, minY: 1.5, maxX: 2.5, maxY: 1.5 }],
			bounds: { minX: 2.5, minY: 1.5, maxX: 2.5, maxY: 1.5 },
		});
		expect(artifact.organizations).toEqual([
			expect.objectContaining({
				index: 0,
				root: true,
				kind: "AREA",
				name: "Line Area",
				railEdgeCount: 5,
				equipmentGroupCount: 1,
			}),
		]);

		// Preparing an untrusted mutable value copies it before any presentation buffers are built.
		const mutableEdge = mutable.railEdges[0];
		const mutableOrganization = mutable.organizations[0];
		if (!mutableEdge || !mutableOrganization) throw new Error("Expected mutable fixture records.");
		mutableEdge.from.x = 400;
		mutableOrganization.name = "Mutated";
		expect(artifact.readRailEdge(0).fromX).toBe(0);
		expect(artifact.organizations[0]?.name).toBe("Line Area");

		const cached = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
			artifact.preparedBundle,
			0,
		);
		expect(cached.valid).toBe(true);
		if (cached.valid) expect(cached.artifact).toBe(artifact);

		const rotated = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
			artifact.preparedBundle,
			1,
		);
		expect(rotated.valid, rotated.reason).toBe(true);
		if (!rotated.valid) return;
		expect(rotated.artifact).not.toBe(artifact);
		expect(rotated.artifact.widthMeters).toBe(0);
		expect(rotated.artifact.heightMeters).toBe(5);
		expect(rotated.artifact.readRailEdge(0)).toEqual({
			index: 0,
			fromX: 0,
			fromY: 0,
			toX: 0,
			toY: 1,
		});
		expect(rotated.artifact.readPort(0)).toMatchObject({
			railX: 0.5,
			railY: 2.5,
			worldX: -0.5,
			worldY: 2.5,
		});
	});

	it("limits collision work to 512 sampled cells and 1,024 reads on a 50k-cell map", () => {
		const artifact = largeArtifact();
		const map = fiftyThousandCellMap();
		let encodedReads = 0;
		let switchClaimReads = 0;
		const instrumented: StaticFabOrganizationBundlePlacementPreviewMapReader = {
			getRevision: () => map.getRevision(),
			getEncoded(x, y) {
				encodedReads++;
				return map.getEncoded(x, y);
			},
			getAdvancedSwitchOwningCell(x, y) {
				switchClaimReads++;
				return map.getAdvancedSwitchOwningCell(x, y);
			},
		};

		const preview = planStaticFabOrganizationBundlePlacementPreview(instrumented, artifact, {
			x: 0,
			y: 0,
		});

		expect(map.size).toBe(50_000);
		expect(preview.disposition).toBe("candidate");
		expect(preview.sampledCellCount).toBe(
			STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_SAMPLED_CELLS,
		);
		expect(encodedReads).toBe(STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_SAMPLED_CELLS);
		expect(switchClaimReads).toBe(
			STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_SAMPLED_CELLS,
		);
		expect(preview.mapCollisionReadCount).toBe(
			STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_MAP_COLLISION_READS,
		);
	});

	it("reports sampled collisions without ever claiming exact validity", () => {
		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
			lineBundle(5, false),
			0,
		);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		const artifact = prepared.artifact;
		const target = new TileMap();
		const sampleIndex = artifact.sampledFootprintCellIndices[2];
		if (sampleIndex === undefined) throw new Error("Expected a sampled footprint cell.");
		const sampled = artifact.readFootprintCell(sampleIndex);
		const anchor = { x: 70, y: -30 };
		target.setEncoded(
			anchor.x + sampled.x,
			anchor.y + sampled.y,
			encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }),
		);

		const preview = planStaticFabOrganizationBundlePlacementPreview(target, artifact, anchor);

		expect(preview.disposition).toBe("sampled-collision");
		expect(preview.sampledOccupiedCellCount).toBe(1);
		expect(preview.sampledConflicts).toEqual([
			{ x: anchor.x + sampled.x, y: anchor.y + sampled.y },
		]);
		expect(preview.exactValidity).toBe("unknown");
		expect(preview.committable).toBe(false);
		expect(preview.reason).toContain("표본");
	});

	it("cannot be mistaken for an exact issued or certified placement plan", () => {
		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
			lineBundle(5, false),
			0,
		);
		if (!prepared.valid) throw new Error(prepared.reason);
		const preview = planStaticFabOrganizationBundlePlacementPreview(
			new TileMap(),
			prepared.artifact,
			{ x: 0, y: 0 },
		);

		expect(isStaticFabOrganizationBundlePlacementPreview(preview)).toBe(true);
		expect(preview.kind).not.toBe("build");
		expect("valid" in preview).toBe(false);
		expect("mutations" in preview).toBe(false);
		expect(
			isIssuedStaticFabOrganizationBundlePlacementPlan(
				preview as unknown as StaticFabOrganizationBundlePlacementPlan,
			),
		).toBe(false);
		expect(
			isStaticFabOrganizationBundlePlacementPreview({
				...preview,
			}),
		).toBe(false);
	});

	it("prepares and spatially chunks a maximum 20k-edge organization artifact", () => {
		const artifact = largeArtifact();

		expect(artifact.railEdgeCount).toBe(20_000);
		expect(artifact.footprintCellCount).toBe(20_001);
		expect(artifact.sourceModuleCount).toBe(4_000);
		expect(artifact.widthMeters).toBe(20_000);
		expect(artifact.chunks).toHaveLength(1_251);
		expect(artifact.sampledFootprintCellIndices).toEqual(
			staticFabOrganizationBundlePlacementPreviewSampleIndices(20_001),
		);
		expect(artifact.chunks.every((chunk) => Object.isFrozen(chunk))).toBe(true);
		expect(
			artifact.chunks.every(
				(chunk) =>
					chunk.bounds.maxX - chunk.bounds.minX ===
						STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS &&
					chunk.bounds.maxY - chunk.bounds.minY ===
						STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS,
			),
		).toBe(true);
		const indexedEdges = new Set(artifact.chunks.flatMap((chunk) => chunk.railEdgeIndices));
		expect(indexedEdges.size).toBe(20_000);
		expect(artifact.chunks[0]?.railEdgeIndices).toContain(0);
		expect(artifact.chunks.at(-1)?.railEdgeIndices).toContain(19_999);
	});

	it("indexes negative chunk seams and rejects signed-int32 world overflow", () => {
		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
			lineBundle(20, false),
			2,
		);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		const artifact = prepared.artifact;
		const seamChunk = artifact.readChunk(-1, 0);
		const originChunk = artifact.readChunk(0, 0);

		expect(seamChunk).not.toBeNull();
		expect(originChunk).not.toBeNull();
		expect(seamChunk?.railEdgeIndices).toContain(0);
		expect(originChunk?.railEdgeIndices).toContain(0);
		expect(artifact.readChunk(-2, 0)).not.toBeNull();
		expect(() =>
			planStaticFabOrganizationBundlePlacementPreview(new TileMap(), artifact, {
				x: -0x8000_0000,
				y: 0,
			}),
		).toThrow(/signed-int32/);
		expect(() =>
			planStaticFabOrganizationBundlePlacementPreview(new TileMap(), artifact, {
				x: -0x8000_0000 + 20,
				y: 0,
			}),
		).not.toThrow();
	});

	it("indexes dispersed FLEX ports only at authored runs instead of filling their bounding rectangle", () => {
		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
			dispersedStkBundle(),
			0,
		);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		const artifact = prepared.artifact;
		const group = artifact.readEquipmentGroup(0);

		expect(group.sections).toEqual([
			{ minX: 2.5, minY: 0.5, maxX: 2.5, maxY: 0.5 },
			{ minX: 513.5, minY: 513.5, maxX: 513.5, maxY: 513.5 },
		]);
		expect(group.bounds).toEqual({ minX: 2.5, minY: 0.5, maxX: 513.5, maxY: 513.5 });
		expect(artifact.chunkCount).toBeLessThanOrEqual(4);
		expect(artifact.readChunk(16, 16)).toBeNull();
		expect(artifact.readChunk(0, 0)?.equipmentGroupIndices).toEqual([0]);
		expect(artifact.readChunk(32, 32)?.equipmentGroupIndices).toEqual([0]);
	});

	it("applies advanced-switch station and lateral offset to the coarse port ghost", () => {
		const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
			advancedSwitchPortBundle(),
			0,
		);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		const port = prepared.artifact.readPort(0);

		expect(port.route).toMatchObject({
			kind: "ADVANCED_SWITCH_SEGMENT",
			advancedSwitchIndex: 0,
			role: "INPUT",
			portIndex: 0,
		});
		expect(port.railX).toBeCloseTo(2, 6);
		expect(port.railY).toBeCloseTo(0.5, 6);
		expect(port.worldX).toBeCloseTo(2, 6);
		expect(port.worldY).toBeCloseTo(1.5, 6);
	});
});

type MutableLineBundle = {
	version: 2;
	relationships: { nextRelationshipId: 1; records: [] };
	captureMode: "DIRECT";
	rootOrganizationIndices: number[];
	sourceModuleCount: number;
	sourceWidthMeters: number;
	sourceHeightMeters: number;
	railEdges: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
	advancedSwitches: [];
	ports: Array<{
		equipmentGroupIndex: number;
		route: {
			kind: "CARDINAL_CELL";
			x: number;
			z: number;
			from: typeof DIR_W;
			to: typeof DIR_E;
		};
		stationMillimeters: number;
		side: "LEFT";
		lateralOffsetMillimeters: number;
		direction: "WITH_TRAVEL";
		portType: "OHB";
	}>;
	equipmentGroups: Array<{ kind: "OHB"; template: "SINGLE"; portIndices: number[] }>;
	organizations: Array<{
		kind: "AREA";
		name: string;
		parentOrganizationIndices: number[];
		properties: { description: string; color: "TEAL" };
		membership: {
			railEdgeIndices: number[];
			advancedSwitchIndices: number[];
			equipmentGroupIndices: number[];
		};
	}>;
};

function lineBundle(edgeCount: number, withEquipment: boolean): MutableLineBundle {
	return {
		version: 2,
		relationships: { nextRelationshipId: 1, records: [] },
		captureMode: "DIRECT",
		rootOrganizationIndices: [0],
		sourceModuleCount: Math.ceil(edgeCount / 5),
		sourceWidthMeters: edgeCount,
		sourceHeightMeters: 0,
		railEdges: Array.from({ length: edgeCount }, (_, x) => ({
			from: { x, y: 0 },
			to: { x: x + 1, y: 0 },
		})),
		advancedSwitches: [],
		ports: withEquipment
			? [
					{
						equipmentGroupIndex: 0,
						route: {
							kind: "CARDINAL_CELL",
							x: 2,
							z: 0,
							from: DIR_W,
							to: DIR_E,
						},
						stationMillimeters: 500,
						side: "LEFT",
						lateralOffsetMillimeters: 1_000,
						direction: "WITH_TRAVEL",
						portType: "OHB",
					},
				]
			: [],
		equipmentGroups: withEquipment ? [{ kind: "OHB", template: "SINGLE", portIndices: [0] }] : [],
		organizations: [
			{
				kind: "AREA",
				name: "Line Area",
				parentOrganizationIndices: [],
				properties: { description: "", color: "TEAL" },
				membership: {
					railEdgeIndices: Array.from({ length: edgeCount }, (_, index) => index),
					advancedSwitchIndices: [],
					equipmentGroupIndices: withEquipment ? [0] : [],
				},
			},
		],
	};
}

let cachedLargeArtifact: StaticFabOrganizationBundlePlacementPreviewArtifact | null = null;

function largeArtifact(): StaticFabOrganizationBundlePlacementPreviewArtifact {
	if (cachedLargeArtifact) return cachedLargeArtifact;
	const prepared = prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
		lineBundle(20_000, false) satisfies StaticFabOrganizationBundle,
		0,
	);
	expect(prepared.valid, prepared.reason).toBe(true);
	if (!prepared.valid) throw new Error(prepared.reason);
	cachedLargeArtifact = prepared.artifact;
	return cachedLargeArtifact;
}

function fiftyThousandCellMap(): TileMap {
	const hydrator = TileMap.createHydrator();
	const encoded = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
	for (let x = 0; x < 50_000; x++) hydrator.addEncodedCell(x, 1_000, encoded);
	return hydrator.finish(0);
}

function dispersedStkBundle(): StaticFabOrganizationBundle {
	return {
		version: 2,
		relationships: { nextRelationshipId: 1, records: [] },
		captureMode: "DIRECT",
		rootOrganizationIndices: [0],
		sourceModuleCount: 2,
		sourceWidthMeters: 515,
		sourceHeightMeters: 513,
		railEdges: [
			{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
			{ from: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
			{ from: { x: 2, y: 0 }, to: { x: 3, y: 0 } },
			{ from: { x: 3, y: 0 }, to: { x: 4, y: 0 } },
			{ from: { x: 511, y: 513 }, to: { x: 512, y: 513 } },
			{ from: { x: 512, y: 513 }, to: { x: 513, y: 513 } },
			{ from: { x: 513, y: 513 }, to: { x: 514, y: 513 } },
			{ from: { x: 514, y: 513 }, to: { x: 515, y: 513 } },
		],
		advancedSwitches: [],
		ports: [
			{
				equipmentGroupIndex: 0,
				route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "CENTER",
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL",
				portType: "STK",
			},
			{
				equipmentGroupIndex: 0,
				route: { kind: "CARDINAL_CELL", x: 513, z: 513, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "CENTER",
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL",
				portType: "STK",
			},
		],
		equipmentGroups: [{ kind: "STK", template: "FLEX", portIndices: [0, 1] }],
		organizations: [
			{
				kind: "AREA",
				name: "Dispersed STK",
				parentOrganizationIndices: [],
				properties: { description: "", color: "TEAL" },
				membership: {
					railEdgeIndices: [0, 1, 2, 3, 4, 5, 6, 7],
					advancedSwitchIndices: [],
					equipmentGroupIndices: [0],
				},
			},
		],
	};
}

function advancedSwitchPortBundle(): StaticFabOrganizationBundle {
	const switchRecord = {
		id: 1,
		profileClass: "B",
		origin: { x: 0, y: 0 },
		forward: DIR_E,
		lateral: DIR_S,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	} as const satisfies AdvancedSwitchRecord;
	const geometry = deriveAdvancedSwitchGeometry(switchRecord);
	const edgesByKey = new Map<string, StaticFabOrganizationBundle["railEdges"][number]>();
	for (const route of geometry.routes) {
		for (let index = 1; index < route.length; index++) {
			const from = route[index - 1] as { x: number; y: number };
			const to = route[index] as { x: number; y: number };
			if (directionBetween(from, to) === null) throw new Error("advanced-switch fixture edge");
			edgesByKey.set(`${from.x},${from.y}>${to.x},${to.y}`, { from, to });
		}
	}
	const railEdges = [...edgesByKey.values()].sort(compareDirectedRailEdges);
	return {
		version: 2,
		relationships: { nextRelationshipId: 1, records: [] },
		captureMode: "DIRECT",
		rootOrganizationIndices: [0],
		sourceModuleCount: 1,
		sourceWidthMeters: 6,
		sourceHeightMeters: 2,
		railEdges,
		advancedSwitches: [
			{
				profileClass: switchRecord.profileClass,
				origin: switchRecord.origin,
				forward: switchRecord.forward,
				lateral: switchRecord.lateral,
				movementMask: switchRecord.movementMask,
			},
		],
		ports: [
			{
				equipmentGroupIndex: 0,
				route: {
					kind: "ADVANCED_SWITCH_SEGMENT",
					advancedSwitchIndex: 0,
					profileClass: "B",
					role: "INPUT",
					portIndex: 0,
					segmentOrdinal: 0,
				},
				stationMillimeters: 2_000,
				side: "LEFT",
				lateralOffsetMillimeters: 1_000,
				direction: "WITH_TRAVEL",
				portType: "OHB",
			},
		],
		equipmentGroups: [{ kind: "OHB", template: "SINGLE", portIndices: [0] }],
		organizations: [
			{
				kind: "AREA",
				name: "Switch Area",
				parentOrganizationIndices: [],
				properties: { description: "", color: "CYAN" },
				membership: {
					railEdgeIndices: railEdges.map((_, index) => index),
					advancedSwitchIndices: [0],
					equipmentGroupIndices: [0],
				},
			},
		],
	};
}
