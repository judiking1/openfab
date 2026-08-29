import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { TileMap } from "../core/TileMap";
import type { DeterministicResidentRuntimePublication } from "../simulation/DeterministicResidentRuntimePublisher";
import type { DeterministicScenarioRuntimePublication } from "../simulation/DeterministicScenarioRuntimePublisher";
import {
	LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
	RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
	type SimulationRuntimePresentation,
} from "./SimulationRuntimePresentation";
import { TileRenderer, type TileRenderInput } from "./TileRenderer";

describe("TileRenderer simulation runtime overlay", () => {
	it("culls a bounded borrowed publication without invalidating static rail rendering", () => {
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const renderer = new TileRenderer();
		const staticContext = recordingContext();
		const overlayContext = recordingContext();
		const input: TileRenderInput = {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 150, zoom: 40, rotation: 0 },
			width: 400,
			height: 300,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			simulationRuntime: presentationWithPoses(
				Float64Array.of(0, 10_000),
				Float64Array.of(0, 10_000),
			),
		};

		renderer.render(staticContext, overlayContext, input);
		const activeStats = renderer.getStats();
		expect(activeStats.simulationRuntimeSequence).toBe(7);
		expect(activeStats.simulationRuntimePoseFingerprint).toBe("runtime-overlay-pose");
		expect(activeStats.simulationRuntimePoseCount).toBe(2);
		expect(activeStats.simulationRuntimeVisiblePoseCount).toBe(1);
		expect(activeStats.simulationRuntimeDrawCount).toBe(1);
		expect(activeStats.staticRedraws).toBe(1);

		renderer.render(staticContext, overlayContext, { ...input, simulationRuntime: null });
		const clearedStats = renderer.getStats();
		expect(clearedStats.simulationRuntimeSequence).toBe(0);
		expect(clearedStats.simulationRuntimePoseFingerprint).toBe("");
		expect(clearedStats.simulationRuntimePoseCount).toBe(0);
		expect(clearedStats.simulationRuntimeVisiblePoseCount).toBe(0);
		expect(clearedStats.simulationRuntimeDrawCount).toBe(1);
		expect(clearedStats.staticRedraws).toBe(1);

		const malformed = presentationWithPoses(Float64Array.of(0, 1), Float64Array.of(0, 1));
		Object.defineProperty(malformed.publication, "maximumPoseCount", { value: 1 });
		expect(() =>
			renderer.render(staticContext, overlayContext, { ...input, simulationRuntime: malformed }),
		).not.toThrow();
		expect(renderer.getStats().simulationRuntimePoseCount).toBe(0);
		expect(renderer.getStats().staticRedraws).toBe(1);
	});

	it("draws the resident profile through the same bounded pose columns", () => {
		const map = new TileMap();
		const physical = compilePhysicalRail(map);
		const renderer = new TileRenderer();
		const staticContext = recordingContext();
		const overlayContext = recordingContext();
		const input: TileRenderInput = {
			map,
			physicalPaths: physical.paths,
			ghost: null,
			camera: { offsetX: 200, offsetY: 150, zoom: 40, rotation: 0 },
			width: 400,
			height: 300,
			dpr: 1,
			hoverTile: null,
			hoverWorld: null,
			anchorTile: null,
			selectedTile: null,
			simulationRuntime: residentPresentationWithPoses(
				Float64Array.of(0, 10_000),
				Float64Array.of(0, 10_000),
			),
		};

		renderer.render(staticContext, overlayContext, input);
		const stats = renderer.getStats();
		expect(stats.simulationRuntimeSequence).toBe(11);
		expect(stats.simulationRuntimePoseFingerprint).toBe("resident-overlay-pose");
		expect(stats.simulationRuntimePoseCount).toBe(2);
		expect(stats.simulationRuntimeVisiblePoseCount).toBe(1);
		expect(stats.simulationRuntimeDrawCount).toBe(1);
	});
});

function presentationWithPoses(
	worldX: Float64Array,
	worldZ: Float64Array,
): SimulationRuntimePresentation {
	const count = worldX.length;
	const publication = {
		sequence: 7,
		runIdentityFingerprint: "runtime-overlay-run",
		resourceExecutionPrepared: true,
		maximumPoseCount: 4_096,
		publishedPoseCount: count,
		poseWorldXMeters: worldX,
		poseWorldZMeters: worldZ,
		poseTangentX: new Float64Array(count).fill(1),
		poseTangentZ: new Float64Array(count),
	} as DeterministicScenarioRuntimePublication;
	return {
		policy: LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
		activeRunGeneration: 3,
		projectId: "PROJECT-RUNTIME-OVERLAY",
		sourceKind: "TRANSFER_PLAN",
		readinessProfileId: "READINESS-V1",
		runIdentityFingerprint: "runtime-overlay-run",
		poseFingerprint: "runtime-overlay-pose",
		publication,
	};
}

function residentPresentationWithPoses(
	worldX: Float64Array,
	worldZ: Float64Array,
): SimulationRuntimePresentation {
	const count = worldX.length;
	const publication = {
		sequence: 11,
		sourceAuthorizationFingerprint: "resident-overlay-authorization",
		sourceCertificateFingerprint: "resident-overlay-certificate",
		maximumPoseCount: 4_096,
		publishedPoseCount: count,
		poseWorldXMeters: worldX,
		poseWorldZMeters: worldZ,
		poseTangentX: new Float64Array(count).fill(1),
		poseTangentZ: new Float64Array(count),
	} as DeterministicResidentRuntimePublication;
	return {
		policy: RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
		activeRunGeneration: 4,
		projectId: "PROJECT-RESIDENT-RUNTIME-OVERLAY",
		sourceKind: "TRANSFER_PLAN",
		readinessProfileId: "OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1",
		authorizationFingerprint: "resident-overlay-authorization",
		certificateFingerprint: "resident-overlay-certificate",
		poseFingerprint: "resident-overlay-pose",
		publication,
	};
}

function recordingContext(): CanvasRenderingContext2D {
	const canvas = { width: 400, height: 300 };
	const noOp = (): void => undefined;
	return new Proxy(
		{ canvas },
		{
			get(target, property) {
				return property in target ? target[property as keyof typeof target] : noOp;
			},
			set(target, property, value) {
				Reflect.set(target, property, value);
				return true;
			},
		},
	) as unknown as CanvasRenderingContext2D;
}
