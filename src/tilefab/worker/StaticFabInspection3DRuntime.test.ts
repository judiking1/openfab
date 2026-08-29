import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	type CompiledRailPresentation,
	compilePhysicalRailPresentation,
} from "../render/PhysicalRailPresentation";
import {
	captureStaticFabInspection3DSource,
	collectStaticFabInspection3DChunkedArtifactTransferBuffers,
	collectStaticFabInspection3DSourceTransferBuffers,
	isStaticFabInspection3DChunkedArtifact,
	isStaticFabInspection3DSourceSnapshot,
	type StaticFabInspection3DSourceSnapshot,
} from "../render/StaticFabInspection3DArtifact";
import {
	compileStaticFabInspection3DWorkerRequest,
	type StaticFabInspection3DWorkerRequest,
} from "./StaticFabInspection3DRuntime";

describe("compileStaticFabInspection3DWorkerRequest", () => {
	it("validates the request discriminant and positive safe request id", () => {
		const snapshot = snapshotFixture(9);
		for (const request of [
			{ type: "WRONG", requestId: 1, snapshot },
			{ type: "COMPILE_STATIC_FAB_INSPECTION_3D", requestId: 0, snapshot },
			{ type: "COMPILE_STATIC_FAB_INSPECTION_3D", requestId: -1, snapshot },
			{ type: "COMPILE_STATIC_FAB_INSPECTION_3D", requestId: 1.5, snapshot },
			{
				type: "COMPILE_STATIC_FAB_INSPECTION_3D",
				requestId: Number.MAX_SAFE_INTEGER + 1,
				snapshot,
			},
		]) {
			expect(() =>
				compileStaticFabInspection3DWorkerRequest(
					request as unknown as StaticFabInspection3DWorkerRequest,
				),
			).toThrow();
		}
	});

	it("rejects a malformed source snapshot instead of producing partial geometry", () => {
		const snapshot = snapshotFixture(4);
		const malformed = {
			...snapshot,
			byteLength: snapshot.byteLength + 1,
		} as StaticFabInspection3DSourceSnapshot;

		expect(() =>
			compileStaticFabInspection3DWorkerRequest({
				type: "COMPILE_STATIC_FAB_INSPECTION_3D",
				requestId: 1,
				snapshot: malformed,
			}),
		).toThrow(RangeError);
	});

	it("compiles transferred input into independently owned transferable artifact buffers", () => {
		const presentation = presentationFixture();
		const canonicalPositions = presentation.source.positions;
		const canonicalByteLength = canonicalPositions.byteLength;
		const snapshot = captureStaticFabInspection3DSource(presentation, 23);
		const sourceTransfers = collectStaticFabInspection3DSourceTransferBuffers(snapshot);
		const deliveredRequest = structuredClone(
			{
				type: "COMPILE_STATIC_FAB_INSPECTION_3D",
				requestId: 72,
				snapshot,
			} satisfies StaticFabInspection3DWorkerRequest,
			{ transfer: sourceTransfers },
		);

		expect(sourceTransfers).toHaveLength(15);
		expect(snapshot.positions.byteLength).toBe(0);
		expect(isStaticFabInspection3DSourceSnapshot(deliveredRequest.snapshot)).toBe(true);
		expect(canonicalPositions.byteLength).toBe(canonicalByteLength);
		const deliveredSourceBuffers = new Set(
			collectStaticFabInspection3DSourceTransferBuffers(deliveredRequest.snapshot),
		);
		const artifact = compileStaticFabInspection3DWorkerRequest(deliveredRequest);
		const artifactTransfers = collectStaticFabInspection3DChunkedArtifactTransferBuffers(artifact);

		expect(artifact).toMatchObject({
			sourceGeneration: 23,
			sourceRevision: presentation.source.revision,
			pathCount: presentation.source.pathCount,
		});
		expect(isStaticFabInspection3DChunkedArtifact(artifact)).toBe(true);
		expect(artifactTransfers.length).toBeGreaterThan(10);
		expect(new Set(artifactTransfers).size).toBe(artifactTransfers.length);
		expect(artifactTransfers.reduce((total, buffer) => total + buffer.byteLength, 0)).toBe(
			artifact.byteLength,
		);
		for (const buffer of artifactTransfers) {
			expect(deliveredSourceBuffers.has(buffer)).toBe(false);
		}
		expect(deliveredRequest.snapshot.positions.byteLength).toBeGreaterThan(0);

		const deliveredArtifact = structuredClone(artifact, { transfer: artifactTransfers });
		expect(artifact.railChunks[0]?.bed.positions.byteLength).toBe(0);
		expect(isStaticFabInspection3DChunkedArtifact(deliveredArtifact)).toBe(true);
		expect(deliveredArtifact.railChunks[0]?.bed.positions.byteLength).toBeGreaterThan(0);
		expect(deliveredRequest.snapshot.positions.byteLength).toBeGreaterThan(0);
	});
});

function snapshotFixture(sourceGeneration: number): StaticFabInspection3DSourceSnapshot {
	return captureStaticFabInspection3DSource(presentationFixture(), sourceGeneration);
}

function presentationFixture(): CompiledRailPresentation {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 });
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`3D inspection runtime fixture failed: ${plan.reason}`);
	}
	return compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
}
