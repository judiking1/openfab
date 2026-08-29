import { describe, expect, it } from "vitest";
import {
	type CompiledPhysicalPaths,
	NO_ADVANCED_SWITCH_PROFILE_CLASS,
	NO_ADVANCED_SWITCH_SEGMENT_ROLE,
} from "../compile/PhysicalPathCompiler";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { analyzeRailNetwork } from "../core/network";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	type CompiledRailPresentation,
	compilePhysicalRailPresentation,
	OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE,
	type PhysicalRailDecorations,
	RAIL_DECORATION_KIND,
} from "./PhysicalRailPresentation";
import {
	captureStaticFabInspection3DSource,
	collectStaticFabInspection3DArtifactTransferBuffers,
	collectStaticFabInspection3DChunkedArtifactTransferBuffers,
	collectStaticFabInspection3DSourceTransferBuffers,
	compileStaticFabInspection3DArtifact,
	compileStaticFabInspection3DArtifactFromPresentation,
	compileStaticFabInspection3DChunkedArtifact,
	isStaticFabInspection3DArtifact,
	isStaticFabInspection3DArtifactTransferEnvelope,
	isStaticFabInspection3DChunkedArtifact,
	isStaticFabInspection3DChunkedArtifactTransferEnvelope,
	isStaticFabInspection3DSourceSnapshot,
	STATIC_FAB_INSPECTION_3D_GEOMETRY_PROFILE,
	type StaticFabInspection3DSourceSnapshot,
} from "./StaticFabInspection3DArtifact";

describe("StaticFabInspection3DArtifact", () => {
	it("copies a straight presentation into exact bed, paired-beam, and pick buffers", () => {
		const presentation = presentationFixture({
			positions: [0, 0, 2, 0],
			normals: [0, 1, 0, 1],
			pathOffsets: [0, 2],
		});
		const sourcePositions = presentation.source.positions;
		const sourceNormals = presentation.pointNormals;
		const snapshot = captureStaticFabInspection3DSource(presentation, 17);
		const artifact = compileStaticFabInspection3DArtifact(snapshot);

		expect(snapshot.sourceGeneration).toBe(17);
		expect(snapshot.sourceRevision).toBe(41);
		expect(snapshot.positions).toEqual(sourcePositions);
		expect(snapshot.positions).not.toBe(sourcePositions);
		expect(snapshot.positions.buffer).not.toBe(sourcePositions.buffer);
		expect(snapshot.pointNormals).not.toBe(sourceNormals);
		expect(isStaticFabInspection3DSourceSnapshot(snapshot)).toBe(true);

		expect(artifact.pathCount).toBe(1);
		expect(artifact.pointCount).toBe(2);
		expect(artifact.segmentCount).toBe(1);
		expect(artifact.bed.vertexCount).toBe(24);
		expect(artifact.bed.positions).toHaveLength(72);
		expect(artifact.bed.normals).toHaveLength(72);
		expect(artifact.bed.indices).toHaveLength(36);
		expect(artifact.bed.triangleCount).toBe(12);
		expect(artifact.beams.vertexCount).toBe(48);
		expect(artifact.beams.positions).toHaveLength(144);
		expect(artifact.beams.indices).toHaveLength(72);
		expect(artifact.beams.triangleCount).toBe(24);
		expect(artifact.pickLines.positions).toEqual(new Float32Array([0, 3.17, 0, 2, 3.17, 0]));
		expect([...artifact.pickLines.pathRows]).toEqual([0]);
		expect(artifact.bounds.minX).toBeCloseTo(0, 6);
		expect(artifact.bounds.maxX).toBeCloseTo(2, 6);
		expect(artifact.bounds.minY).toBeCloseTo(
			STATIC_FAB_INSPECTION_3D_GEOMETRY_PROFILE.railBaseElevationMeters,
			6,
		);
		expect(artifact.bounds.maxY).toBeCloseTo(3.17, 6);
		expect(artifact.bounds.minZ).toBeCloseTo(
			-OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE.bedWidthMeters / 2,
			6,
		);
		expect(artifact.bounds.maxZ).toBeCloseTo(
			OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE.bedWidthMeters / 2,
			6,
		);
		expect(isStaticFabInspection3DArtifact(artifact)).toBe(true);
		expect(isStaticFabInspection3DArtifactTransferEnvelope(artifact)).toBe(true);
	});

	it("checks the Worker transfer envelope without weakening full artifact validation", () => {
		const artifact = compileStaticFabInspection3DArtifactFromPresentation(
			presentationFixture({
				positions: [0, 0, 2, 0],
				normals: [0, 1, 0, 1],
				pathOffsets: [0, 2],
			}),
			5,
		);

		expect(isStaticFabInspection3DArtifactTransferEnvelope(artifact)).toBe(true);
		expect(
			isStaticFabInspection3DArtifactTransferEnvelope({
				...artifact,
				byteLength: artifact.byteLength + 1,
			}),
		).toBe(false);
		expect(
			isStaticFabInspection3DArtifactTransferEnvelope({
				...artifact,
				bed: { ...artifact.bed, vertexCount: artifact.bed.vertexCount + 1 },
			}),
		).toBe(false);
		const invalidPositions = new Float32Array(artifact.bed.positions.length - 1);
		expect(
			isStaticFabInspection3DArtifactTransferEnvelope({
				...artifact,
				bed: { ...artifact.bed, positions: invalidPositions },
			}),
		).toBe(false);
	});

	it("sweeps curve normals without losing rectangular prism counts or finite bounds", () => {
		const diagonal = Math.SQRT1_2;
		const artifact = compileStaticFabInspection3DArtifactFromPresentation(
			presentationFixture({
				positions: [0, 0, 1, 0, 1, 1],
				normals: [0, 1, -diagonal, diagonal, -1, 0],
				pathOffsets: [0, 3],
			}),
			4,
		);

		expect(artifact.segmentCount).toBe(2);
		expect(artifact.bed.vertexCount).toBe(32);
		expect(artifact.bed.indices).toHaveLength(60);
		expect(artifact.beams.vertexCount).toBe(64);
		expect(artifact.beams.indices).toHaveLength(120);
		expect(artifact.pickLines.positions).toHaveLength(12);
		expect(artifact.bounds.minX).toBeCloseTo(0, 6);
		expect(artifact.bounds.maxX).toBeCloseTo(
			1 + OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE.bedWidthMeters / 2,
			6,
		);
		expect(artifact.bounds.minZ).toBeCloseTo(
			-OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE.bedWidthMeters / 2,
			6,
		);
		expect(artifact.bounds.maxZ).toBeCloseTo(1, 6);
		expect([...artifact.bed.positions].every(Number.isFinite)).toBe(true);
		expect([...artifact.bed.normals].every(Number.isFinite)).toBe(true);
		expect(isStaticFabInspection3DArtifact(artifact)).toBe(true);
	});

	it("accepts the real physical presentation emitted for a chained straight and curve", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 5, y: 0 }, { x: 5, y: 4 })),
		).toBe(true);
		const presentation = compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
		const artifact = compileStaticFabInspection3DArtifactFromPresentation(presentation, 23);

		expect(artifact.sourceGeneration).toBe(23);
		expect(artifact.sourceRevision).toBe(document.map.getRevision());
		expect(artifact.pathCount).toBe(presentation.source.pathCount);
		expect(artifact.pointCount).toBe(presentation.source.pointCount);
		expect(artifact.segmentCount).toBeGreaterThan(artifact.pathCount - 1);
		expect(artifact.supports.count).toBeGreaterThan(0);
		expect(artifact.flows.count).toBeGreaterThan(0);
		expect(isStaticFabInspection3DArtifact(artifact)).toBe(true);
	});

	it.each([
		"A",
		"B",
		"C",
		"D",
	] as const)("derives one stable rigid hardware instance from a %s switch throat", (profileClass) => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 2, y: 0 })),
		).toBe(true);
		const plan = planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, profileClass);
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		const presentation = compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
		const artifact = compileStaticFabInspection3DChunkedArtifact(
			captureStaticFabInspection3DSource(presentation, 31),
		);

		expect(artifact.advancedSwitches.count).toBe(1);
		expect([...artifact.advancedSwitches.switchIds]).toEqual([plan.switchRecord?.id]);
		expect([...artifact.advancedSwitches.profileClasses]).toEqual([
			{ A: 0, B: 1, C: 2, D: 3 }[profileClass],
		]);
		expect(artifact.advancedSwitches.pathRows[0]).toBeLessThan(artifact.pathCount);
		expect(
			Math.hypot(
				artifact.advancedSwitches.tangents[0] as number,
				artifact.advancedSwitches.tangents[2] as number,
			),
		).toBeCloseTo(1, 6);
		expect(artifact.bounds.maxY).toBeGreaterThanOrEqual(
			(artifact.advancedSwitches.positions[1] as number) + 0.29,
		);
		expect(isStaticFabInspection3DChunkedArtifact(artifact)).toBe(true);
	});

	it("rejects missing, duplicate, or profile-divergent advanced-switch throat metadata", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 2, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, "D")),
		).toBe(true);
		const snapshot = captureStaticFabInspection3DSource(
			compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths),
			32,
		);
		const throatRow = snapshot.advancedSwitchSegmentRoles.indexOf(1);
		expect(throatRow).toBeGreaterThanOrEqual(0);
		const switchId = snapshot.advancedSwitchIds[throatRow];
		const siblingRow = snapshot.advancedSwitchIds.findIndex(
			(candidateSwitchId, row) => candidateSwitchId === switchId && row !== throatRow,
		);
		expect(siblingRow).toBeGreaterThanOrEqual(0);

		const missingThroatRoles = new Uint8Array(snapshot.advancedSwitchSegmentRoles);
		missingThroatRoles[throatRow] = 0;
		const duplicateThroatRoles = new Uint8Array(snapshot.advancedSwitchSegmentRoles);
		duplicateThroatRoles[siblingRow] = 1;
		const divergentProfiles = new Uint8Array(snapshot.advancedSwitchProfileClasses);
		divergentProfiles[siblingRow] = ((divergentProfiles[siblingRow] as number) + 1) % 4;
		for (const candidate of [
			{ ...snapshot, advancedSwitchSegmentRoles: missingThroatRoles },
			{ ...snapshot, advancedSwitchSegmentRoles: duplicateThroatRoles },
			{ ...snapshot, advancedSwitchProfileClasses: divergentProfiles },
		]) {
			expect(isStaticFabInspection3DSourceSnapshot(candidate)).toBe(false);
			expect(() =>
				compileStaticFabInspection3DChunkedArtifact(
					candidate as unknown as StaticFabInspection3DSourceSnapshot,
				),
			).toThrow(RangeError);
		}
	});

	it("supports a closed public-safe advanced-switch inspection fixture", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 2, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, "D")),
		).toBe(true);
		const routes = [
			[
				{ x: 8, y: 0 },
				{ x: 10, y: 0 },
			],
			[
				{ x: 10, y: 0 },
				{ x: 10, y: 4 },
			],
			[
				{ x: 10, y: 4 },
				{ x: 0, y: 4 },
			],
			[
				{ x: 0, y: 4 },
				{ x: 0, y: 0 },
			],
			[
				{ x: 8, y: -2 },
				{ x: 10, y: -2 },
			],
			[
				{ x: 10, y: -2 },
				{ x: 10, y: -5 },
			],
			[
				{ x: 10, y: -5 },
				{ x: 4, y: -5 },
			],
			[
				{ x: 4, y: -5 },
				{ x: 4, y: -3 },
			],
		] as const;
		for (const [start, end] of routes) {
			const plan = planRailConstruction(document.map, start, end);
			expect(plan.valid, `${JSON.stringify([start, end])}: ${plan.reason}`).toBe(true);
			expect(document.commit(plan)).toBe(true);
		}
		expect(analyzeRailNetwork(document.map).status).toBe("closed");
		expect(
			compileStaticFabInspection3DChunkedArtifact(
				captureStaticFabInspection3DSource(
					compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths),
					1,
				),
			).advancedSwitches.count,
		).toBe(1);
	});

	it("removes non-owner turnout overlap from rendered rails and pick proxies", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: 3 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const presentation = compilePhysicalRailPresentation(paths);
		const snapshot = captureStaticFabInspection3DSource(presentation, 29);
		const artifact = compileStaticFabInspection3DArtifact(snapshot);
		const duplicatedLength = paths.totalRouteLengthMeters - paths.totalLengthMeters;
		const sourcePolylineLength = packedPathLength(paths.positions, paths.offsets);
		const renderedPolylineLength = nonIndexedLineLength(artifact.pickLines.positions);

		expect(duplicatedLength).toBeGreaterThan(0);
		expect(snapshot.ownedIntervalCount).toBe(artifact.runCount);
		expect(sourcePolylineLength - renderedPolylineLength).toBeCloseTo(duplicatedLength, 3);
		expect(renderedPolylineLength).toBeLessThan(sourcePolylineLength);
		expect(artifact.pickLines.pathRows).toHaveLength(artifact.segmentCount);
		expect(isStaticFabInspection3DArtifact(artifact)).toBe(true);
	});

	it("maps every non-indexed pick segment and decoration instance to its source path row", () => {
		const presentation = presentationFixture({
			positions: [0, 0, 1, 0, 4, 0, 4, 1, 5, 1],
			normals: [0, 1, 0, 1, 1, 0, 1, 0, 0, 1],
			pathOffsets: [0, 2, 5],
			decorations: [
				{
					position: [0.5, 0],
					tangent: [1, 0],
					kind: RAIL_DECORATION_KIND.SUPPORT,
					pathRow: 0,
					stableId: [11, 12],
				},
				{
					position: [4, 0.5],
					tangent: [0, 1],
					kind: RAIL_DECORATION_KIND.FLOW,
					pathRow: 1,
					stableId: [21, 22],
				},
				{
					position: [4.5, 1],
					tangent: [1, 0],
					kind: RAIL_DECORATION_KIND.FLOW_COMPACT,
					pathRow: 1,
					stableId: [31, 32],
				},
				{
					position: [0.75, 0],
					tangent: [1, 0],
					kind: RAIL_DECORATION_KIND.METRIC_JOINT,
					pathRow: 0,
					stableId: [41, 42],
				},
			],
		});
		const artifact = compileStaticFabInspection3DArtifactFromPresentation(presentation, 8);

		expect(artifact.segmentCount).toBe(3);
		expect([...artifact.pickLines.pathRows]).toEqual([0, 1, 1]);
		expect(artifact.supports.count).toBe(1);
		expect([...artifact.supports.pathRows]).toEqual([0]);
		expect([...artifact.supports.kinds]).toEqual([RAIL_DECORATION_KIND.SUPPORT]);
		expect([...artifact.supports.stableIds]).toEqual([11, 12]);
		expect(artifact.flows.count).toBe(2);
		expect([...artifact.flows.pathRows]).toEqual([1, 1]);
		expect([...artifact.flows.kinds]).toEqual([
			RAIL_DECORATION_KIND.FLOW,
			RAIL_DECORATION_KIND.FLOW_COMPACT,
		]);
		expect([...artifact.flows.stableIds]).toEqual([21, 22, 31, 32]);
		expect([...artifact.flows.tangents]).toEqual([0, 0, 1, 1, 0, 0]);
	});

	it("is byte-for-byte deterministic for the same source generation and revision", () => {
		const presentation = presentationFixture({
			positions: [0, 0, 1, 0, 1, 1],
			normals: [0, 1, -Math.SQRT1_2, Math.SQRT1_2, -1, 0],
			pathOffsets: [0, 3],
			decorations: [
				{
					position: [0.5, 0],
					tangent: [1, 0],
					kind: RAIL_DECORATION_KIND.SUPPORT,
					pathRow: 0,
					stableId: [7, 9],
				},
			],
		});
		const first = compileStaticFabInspection3DArtifactFromPresentation(presentation, 12);
		const second = compileStaticFabInspection3DArtifactFromPresentation(presentation, 12);

		expect(first.sourceGeneration).toBe(second.sourceGeneration);
		expect(first.sourceRevision).toBe(second.sourceRevision);
		expect(first.bounds).toEqual(second.bounds);
		expect(first.byteLength).toBe(second.byteLength);
		for (const [left, right] of artifactViewPairs(first, second)) {
			expect(left).toEqual(right);
		}
	});

	it("rejects malformed offsets, finite data, normals, ownership, and source identity", () => {
		const snapshot = captureStaticFabInspection3DSource(
			presentationFixture({
				positions: [0, 0, 1, 0],
				normals: [0, 1, 0, 1],
				pathOffsets: [0, 2],
			}),
			2,
		);
		const invalidOffsets = new Uint32Array([0, 1]);
		const nonFinitePositions = new Float32Array(snapshot.positions);
		nonFinitePositions[0] = Number.NaN;
		const nonUnitNormals = new Float32Array(snapshot.pointNormals);
		nonUnitNormals[0] = 4;
		const nonFiniteNormals = new Float32Array(snapshot.pointNormals);
		nonFiniteNormals[0] = Number.NaN;

		for (const candidate of [
			{ ...snapshot, sourceGeneration: -1 },
			{ ...snapshot, pathOffsets: invalidOffsets },
			{ ...snapshot, positions: nonFinitePositions },
			{ ...snapshot, pointNormals: nonUnitNormals },
			{ ...snapshot, pointNormals: nonFiniteNormals },
		]) {
			expect(isStaticFabInspection3DSourceSnapshot(candidate)).toBe(false);
			expect(() =>
				compileStaticFabInspection3DArtifact(
					candidate as unknown as StaticFabInspection3DSourceSnapshot,
				),
			).toThrow(RangeError);
		}

		const ownedSnapshot = captureStaticFabInspection3DSource(
			presentationFixture({
				positions: [0, 0, 1, 0],
				normals: [0, 1, 0, 1],
				pathOffsets: [0, 2],
				decorations: [
					{
						position: [0.5, 0],
						tangent: [1, 0],
						kind: RAIL_DECORATION_KIND.FLOW,
						pathRow: 0,
						stableId: [1, 2],
					},
				],
			}),
			2,
		);
		const invalidOwners = new Uint32Array([9]);
		expect(
			isStaticFabInspection3DSourceSnapshot({
				...ownedSnapshot,
				decorationOwnerPathRows: invalidOwners,
			}),
		).toBe(false);
	});

	it("collects each owned transfer buffer once without detaching canonical arrays", () => {
		const presentation = presentationFixture({
			positions: [0, 0, 2, 0],
			normals: [0, 1, 0, 1],
			pathOffsets: [0, 2],
			decorations: [
				{
					position: [1, 0],
					tangent: [1, 0],
					kind: RAIL_DECORATION_KIND.FLOW,
					pathRow: 0,
					stableId: [5, 6],
				},
			],
		});
		const canonicalPositions = presentation.source.positions;
		const canonicalByteLength = canonicalPositions.byteLength;
		const snapshot = captureStaticFabInspection3DSource(presentation, 3);
		const artifact = compileStaticFabInspection3DArtifact(snapshot);
		const sourceTransfers = collectStaticFabInspection3DSourceTransferBuffers(snapshot);
		const artifactTransfers = collectStaticFabInspection3DArtifactTransferBuffers(artifact);

		expect(sourceTransfers).toHaveLength(15);
		expect(new Set(sourceTransfers).size).toBe(sourceTransfers.length);
		expect(sourceTransfers.reduce((sum, buffer) => sum + buffer.byteLength, 0)).toBe(
			snapshot.byteLength,
		);
		expect(artifactTransfers).toHaveLength(18);
		expect(new Set(artifactTransfers).size).toBe(artifactTransfers.length);
		expect(artifactTransfers.reduce((sum, buffer) => sum + buffer.byteLength, 0)).toBe(
			artifact.byteLength,
		);

		const deliveredSource = structuredClone(snapshot, { transfer: sourceTransfers });
		expect(isStaticFabInspection3DSourceSnapshot(deliveredSource)).toBe(true);
		expect(snapshot.positions.byteLength).toBe(0);
		expect(canonicalPositions.byteLength).toBe(canonicalByteLength);
		expect([...canonicalPositions]).toEqual([0, 0, 2, 0]);

		const deliveredArtifact = structuredClone(artifact, { transfer: artifactTransfers });
		expect(isStaticFabInspection3DArtifact(deliveredArtifact)).toBe(true);
		expect(artifact.bed.positions.byteLength).toBe(0);
	});

	it("accepts an empty presentation as a finite, zero-sized derived scene", () => {
		const artifact = compileStaticFabInspection3DArtifactFromPresentation(
			presentationFixture({ positions: [], normals: [], pathOffsets: [0] }),
			0,
		);

		expect(artifact.pathCount).toBe(0);
		expect(artifact.pointCount).toBe(0);
		expect(artifact.segmentCount).toBe(0);
		expect(artifact.bed.vertexCount).toBe(0);
		expect(artifact.beams.vertexCount).toBe(0);
		expect(artifact.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
		expect(isStaticFabInspection3DArtifact(artifact)).toBe(true);
	});

	it("partitions owned rail segments into deterministic 32 m chunks without changing path identity", () => {
		const presentation = presentationFixture({
			positions: [-33, 0, -31, 0, -1, 0, 1, 0, 31, 0, 33, 0],
			normals: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
			pathOffsets: [0, 6],
		});
		const artifact = compileStaticFabInspection3DChunkedArtifact(
			captureStaticFabInspection3DSource(presentation, 31),
		);

		expect(artifact.schemaVersion).toBe(3);
		expect(artifact.worldChunkSizeMeters).toBe(32);
		expect(artifact.segmentCount).toBe(5);
		expect(artifact.runCount).toBe(3);
		expect(artifact.renderPointCount).toBe(8);
		expect(artifact.railChunks.map((chunk) => [chunk.worldChunkX, chunk.worldChunkZ])).toEqual([
			[-1, 0],
			[0, 0],
			[1, 0],
		]);
		expect(artifact.railChunks.map((chunk) => chunk.segmentCount)).toEqual([2, 2, 1]);
		expect(artifact.railChunks.map((chunk) => chunk.pickSegmentOffset)).toEqual([0, 2, 4]);
		expect([...artifact.pickLines.pathRows]).toEqual([0, 0, 0, 0, 0]);
		expect(nonIndexedLineLength(artifact.pickLines.positions)).toBeCloseTo(66, 6);
		expect(isStaticFabInspection3DChunkedArtifact(artifact)).toBe(true);
		expect(isStaticFabInspection3DChunkedArtifactTransferEnvelope(artifact)).toBe(true);

		const transfers = collectStaticFabInspection3DChunkedArtifactTransferBuffers(artifact);
		expect(transfers).toHaveLength(35);
		expect(new Set(transfers).size).toBe(transfers.length);
		expect(transfers.reduce((total, buffer) => total + buffer.byteLength, 0)).toBe(
			artifact.byteLength,
		);
		const repeated = compileStaticFabInspection3DChunkedArtifact(
			captureStaticFabInspection3DSource(presentation, 31),
		);
		expect(repeated.byteLength).toBe(artifact.byteLength);
		expect(repeated.pickLines.positions).toEqual(artifact.pickLines.positions);
		expect(repeated.pickLines.pathRows).toEqual(artifact.pickLines.pathRows);
		for (let row = 0; row < artifact.railChunks.length; row++) {
			expect(repeated.railChunks[row]?.bed.positions).toEqual(
				artifact.railChunks[row]?.bed.positions,
			);
			expect(repeated.railChunks[row]?.beams.indices).toEqual(
				artifact.railChunks[row]?.beams.indices,
			);
		}
	});

	it("rejects reordered chunks, discontinuous pick ranges, and malformed chunk meshes", () => {
		const artifact = compileStaticFabInspection3DChunkedArtifact(
			captureStaticFabInspection3DSource(
				presentationFixture({
					positions: [-33, 0, -31, 0, -1, 0, 1, 0],
					normals: [0, 1, 0, 1, 0, 1, 0, 1],
					pathOffsets: [0, 4],
				}),
				32,
			),
		);
		const first = artifact.railChunks[0];
		const second = artifact.railChunks[1];
		if (!first || !second) throw new Error("Expected two chunk validation fixtures.");

		for (const candidate of [
			{ ...artifact, railChunks: [second, first] },
			{
				...artifact,
				railChunks: [first, { ...second, pickSegmentOffset: second.pickSegmentOffset + 1 }],
			},
			{
				...artifact,
				railChunks: [
					{
						...first,
						bed: { ...first.bed, vertexCount: first.bed.vertexCount + 1 },
					},
					second,
				],
			},
		]) {
			expect(isStaticFabInspection3DChunkedArtifactTransferEnvelope(candidate)).toBe(false);
		}
	});

	it("rejects source polyline spans larger than one world chunk", () => {
		expect(() =>
			captureStaticFabInspection3DSource(
				presentationFixture({
					positions: [0, 0, 32.01, 0],
					normals: [0, 1, 0, 1],
					pathOffsets: [0, 2],
				}),
				1,
			),
		).toThrow(RangeError);
	});
});

interface DecorationFixture {
	readonly position: readonly [number, number];
	readonly tangent: readonly [number, number];
	readonly kind: number;
	readonly pathRow: number;
	readonly stableId: readonly [number, number];
}

function presentationFixture(input: {
	readonly positions: readonly number[];
	readonly normals: readonly number[];
	readonly pathOffsets: readonly number[];
	readonly decorations?: readonly DecorationFixture[];
}): CompiledRailPresentation {
	const positions = new Float32Array(input.positions);
	const pointNormals = new Float32Array(input.normals);
	const offsets = new Uint32Array(input.pathOffsets);
	const pathCount = offsets.length - 1;
	const pointCount = positions.length / 2;
	const distances = new Float32Array(pointCount);
	const lengths = new Float32Array(pathCount);
	let totalRouteLengthMeters = 0;
	for (let pathRow = 0; pathRow < pathCount; pathRow++) {
		const start = offsets[pathRow] as number;
		const end = offsets[pathRow + 1] as number;
		let distance = 0;
		for (let pointIndex = start + 1; pointIndex < end; pointIndex++) {
			const priorOffset = (pointIndex - 1) * 2;
			const pointOffset = pointIndex * 2;
			distance += Math.hypot(
				(positions[pointOffset] as number) - (positions[priorOffset] as number),
				(positions[pointOffset + 1] as number) - (positions[priorOffset + 1] as number),
			);
			distances[pointIndex] = distance;
		}
		lengths[pathRow] = distance;
		totalRouteLengthMeters += distance;
	}
	const decorations = input.decorations ?? [];
	const decorationPositions = new Float32Array(decorations.length * 2);
	const decorationTangents = new Float32Array(decorations.length * 2);
	const decorationKinds = new Uint8Array(decorations.length);
	const ownerPathIndices = new Uint32Array(decorations.length);
	const stableIds = new Uint32Array(decorations.length * 2);
	for (let index = 0; index < decorations.length; index++) {
		const decoration = decorations[index] as DecorationFixture;
		decorationPositions[index * 2] = decoration.position[0];
		decorationPositions[index * 2 + 1] = decoration.position[1];
		decorationTangents[index * 2] = decoration.tangent[0];
		decorationTangents[index * 2 + 1] = decoration.tangent[1];
		decorationKinds[index] = decoration.kind;
		ownerPathIndices[index] = decoration.pathRow;
		stableIds[index * 2] = decoration.stableId[0];
		stableIds[index * 2 + 1] = decoration.stableId[1];
	}
	const source = {
		revision: 41,
		positions,
		tangents: new Float32Array(positions.length),
		distances,
		offsets,
		kinds: new Uint8Array(pathCount),
		cells: new Int32Array(pathCount * 2),
		exitCells: new Int32Array(pathCount * 2),
		fromDirections: new Uint8Array(pathCount),
		toDirections: new Uint8Array(pathCount),
		lengths,
		bounds: new Float32Array(pathCount * 4),
		startInsets: new Float32Array(pathCount),
		endInsets: new Float32Array(pathCount),
		startExtensions: new Float32Array(pathCount),
		endExtensions: new Float32Array(pathCount),
		coverageOffsets: new Uint32Array(pathCount + 1),
		coverageCells: new Int32Array(),
		sharedSegmentOffsets: new Uint32Array(pathCount + 1),
		sharedSegmentIds: new Uint32Array(),
		sharedSegmentStarts: new Float32Array(),
		sharedSegmentEnds: new Float32Array(),
		sourceKinds: new Uint8Array(pathCount),
		advancedSwitchIds: new Uint32Array(pathCount),
		advancedSwitchProfileClasses: new Uint8Array(pathCount).fill(NO_ADVANCED_SWITCH_PROFILE_CLASS),
		advancedSwitchSegmentRoles: new Uint8Array(pathCount).fill(NO_ADVANCED_SWITCH_SEGMENT_ROLE),
		advancedSwitchSegmentPorts: new Uint8Array(pathCount),
		advancedSwitchSegmentOrdinals: new Uint16Array(pathCount),
		advancedSwitchCatalogProfiles: new Uint8Array(pathCount),
		explicitAdjacencyOffsets: new Uint32Array(pathCount + 1),
		explicitAdjacencyTargets: new Uint32Array(),
		sharedSegmentCount: 0,
		totalLengthMeters: totalRouteLengthMeters,
		totalRouteLengthMeters,
		pathCount,
		pointCount,
	} satisfies CompiledPhysicalPaths;
	const physicalDecorations = {
		count: decorations.length,
		positions: decorationPositions,
		tangents: decorationTangents,
		kinds: decorationKinds,
		ownerPathIndices,
		stableIds,
	} as unknown as PhysicalRailDecorations;
	return {
		source,
		profile: OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE,
		pointNormals,
		decorations: physicalDecorations,
	} as unknown as CompiledRailPresentation;
}

function artifactViewPairs(
	first: ReturnType<typeof compileStaticFabInspection3DArtifact>,
	second: ReturnType<typeof compileStaticFabInspection3DArtifact>,
): readonly (readonly [ArrayBufferView, ArrayBufferView])[] {
	return [
		[first.bed.positions, second.bed.positions],
		[first.bed.normals, second.bed.normals],
		[first.bed.indices, second.bed.indices],
		[first.beams.positions, second.beams.positions],
		[first.beams.normals, second.beams.normals],
		[first.beams.indices, second.beams.indices],
		[first.pickLines.positions, second.pickLines.positions],
		[first.pickLines.pathRows, second.pickLines.pathRows],
		[first.supports.positions, second.supports.positions],
		[first.supports.tangents, second.supports.tangents],
		[first.supports.pathRows, second.supports.pathRows],
		[first.supports.kinds, second.supports.kinds],
		[first.supports.stableIds, second.supports.stableIds],
		[first.flows.positions, second.flows.positions],
		[first.flows.tangents, second.flows.tangents],
		[first.flows.pathRows, second.flows.pathRows],
		[first.flows.kinds, second.flows.kinds],
		[first.flows.stableIds, second.flows.stableIds],
	];
}

function packedPathLength(positions: Float32Array, offsets: Uint32Array): number {
	let total = 0;
	for (let pathRow = 0; pathRow < offsets.length - 1; pathRow++) {
		const start = offsets[pathRow] as number;
		const end = offsets[pathRow + 1] as number;
		for (let pointIndex = start; pointIndex < end - 1; pointIndex++) {
			const offset = pointIndex * 2;
			const nextOffset = offset + 2;
			total += Math.hypot(
				(positions[nextOffset] as number) - (positions[offset] as number),
				(positions[nextOffset + 1] as number) - (positions[offset + 1] as number),
			);
		}
	}
	return total;
}

function nonIndexedLineLength(positions: Float32Array): number {
	let total = 0;
	for (let offset = 0; offset < positions.length; offset += 6) {
		total += Math.hypot(
			(positions[offset + 3] as number) - (positions[offset] as number),
			(positions[offset + 5] as number) - (positions[offset + 2] as number),
		);
	}
	return total;
}
