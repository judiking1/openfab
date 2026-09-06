import { describe, expect, it } from "vitest";
import {
	analyzeRailNetwork,
	checksumRailNetworkAnalysis,
	checksumRailNetworkAnalysisCooperatively,
} from "./network";
import { DIR_E, DIR_W } from "./railShape";
import { encodeRailCell, TileMap } from "./TileMap";

describe("cooperative network analysis checksum", () => {
	it("preserves the exact synchronous digest across large component and terminal tables", async () => {
		const analysis = fragmentedAnalysis();
		const source = "test-authored-source";
		const before = checksumRailNetworkAnalysis(analysis, source);
		// Recorded from the synchronous contract before the cooperative API was introduced.
		expect(before).toBe("cf801163:5dd456c1");
		let checkpoints = 0;
		expect(
			await checksumRailNetworkAnalysisCooperatively(analysis, source, async () => {
				checkpoints++;
			}),
		).toBe(before);
		expect(checkpoints).toBeGreaterThan(2);
		const last = analysis.openEndCells.length - 1;
		expect(last).toBeGreaterThan(0);
		analysis.openEndCells[last] = (analysis.openEndCells[last] as number) + 1;
		const changed = checksumRailNetworkAnalysis(analysis, source);
		expect(changed).not.toBe(before);
		expect(
			await checksumRailNetworkAnalysisCooperatively(analysis, source, async () => undefined),
		).toBe(changed);
	});

	it("propagates cancellation while hashing large typed tables", async () => {
		const cancelled = new Error("cancel checksum");
		let checkpoints = 0;
		await expect(
			checksumRailNetworkAnalysisCooperatively(fragmentedAnalysis(), "source", async () => {
				if (++checkpoints === 2) throw cancelled;
			}),
		).rejects.toBe(cancelled);
		expect(checkpoints).toBe(2);
	});

	it("checks cancellation after hashing an empty network's CSR sentinel", async () => {
		const analysis = analyzeRailNetwork(new TileMap());
		expect(analysis.oneWayCorridorOffsets).toEqual(new Uint32Array([0]));
		const cancelled = new Error("cancel empty checksum");
		let checkpoints = 0;
		await expect(
			checksumRailNetworkAnalysisCooperatively(analysis, "source", async () => {
				if (++checkpoints === 2) throw cancelled;
			}),
		).rejects.toBe(cancelled);
		expect(checkpoints).toBe(2);
	});
});

function fragmentedAnalysis() {
	const map = new TileMap();
	for (let index = 0; index < 4096; index++) {
		const x = index * 5;
		map.setEncoded(x, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		map.setEncoded(x + 1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(x + 2, 0, encodeRailCell({ incoming: DIR_W, outgoing: 0 }));
	}
	return analyzeRailNetwork(map);
}
