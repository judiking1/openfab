import { describe, expect, it } from "vitest";
import { RenderPerformanceTelemetry } from "./RenderPerformanceTelemetry";

describe("RenderPerformanceTelemetry", () => {
	it("tracks render budgets, long tasks, and heap growth without retaining samples", () => {
		const telemetry = new RenderPerformanceTelemetry();
		telemetry.recordStartup(120);
		telemetry.recordStartup(30);
		telemetry.recordInteraction(3, "rail-draft");
		telemetry.recordInteraction(18, "port-row-draft");
		telemetry.recordInteraction(55, "blueprint-snapshot");
		for (const duration of [4, 17, 33, 51, Number.NaN, -1]) telemetry.recordRender(duration);
		telemetry.setLongTaskSupported(true);
		telemetry.recordLongTask(72);
		telemetry.recordLongTask(91);
		telemetry.recordHeap(1_000);
		telemetry.recordHeap(1_250);

		expect(telemetry.snapshot()).toEqual({
			startupSamples: 2,
			startupTotalMilliseconds: 150,
			startupMaxMilliseconds: 120,
			interactionSamples: 3,
			interactionLastMilliseconds: 55,
			interactionMeanMilliseconds: 76 / 3,
			interactionMaxMilliseconds: 55,
			interactionMaxCategory: "blueprint-snapshot",
			interactionOver16Milliseconds: 2,
			interactionOver50Milliseconds: 1,
			renderSamples: 4,
			renderLastMilliseconds: 51,
			renderMeanMilliseconds: 26.25,
			renderMaxMilliseconds: 51,
			renderOver16Milliseconds: 3,
			renderOver32Milliseconds: 2,
			renderOver50Milliseconds: 1,
			longTaskCount: 2,
			longTaskSupported: true,
			longTaskTotalMilliseconds: 163,
			longTaskMaxMilliseconds: 91,
			heapBaselineBytes: 1_000,
			heapTelemetrySupported: true,
			heapCurrentBytes: 1_250,
			heapPeakBytes: 1_250,
			heapGrowthBytes: 250,
		});
	});

	it("keeps zero means and ignores invalid long-task and heap values", () => {
		const telemetry = new RenderPerformanceTelemetry();
		telemetry.recordLongTask(Number.POSITIVE_INFINITY);
		telemetry.recordHeap(-10);
		expect(telemetry.snapshot()).toMatchObject({
			startupSamples: 0,
			interactionSamples: 0,
			interactionMaxCategory: "none",
			renderSamples: 0,
			renderMeanMilliseconds: 0,
			longTaskCount: 0,
			longTaskSupported: false,
			heapBaselineBytes: 0,
			heapTelemetrySupported: false,
		});
	});
});
