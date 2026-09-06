import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { DIR_E, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { RailDraftEvaluator } from "./RailDraftEvaluator";
import { compileRailDraftPreparedArtifacts } from "./RailDraftPreparedArtifacts";

describe("cooperative committed draft preparation", () => {
	it("preserves exact clearance results and binds prepared resources only once", async () => {
		const { map, layout, artifacts } = fixture(256);
		const synchronous = new RailDraftEvaluator();
		synchronous.prepare(layout, artifacts);
		const cooperative = new RailDraftEvaluator();
		let checkpoints = 0;
		await cooperative.prepareCooperatively(layout, artifacts, async () => {
			checkpoints++;
		});
		expect(checkpoints).toBeGreaterThan(10);
		for (const y of [0, 1, 4]) {
			const plan = planRailConstruction(map, { x: 255, y }, { x: 260, y });
			expect(cooperative.evaluate(map, layout, plan)).toEqual(
				synchronous.evaluate(map, layout, plan),
			);
		}
		const before = cooperative.getStats();
		expect(before).toMatchObject({
			committedBindings: 1,
			committedIndexBuilds: 1,
			committedPreparedBindings: 1,
			committedAdjacencyBuilds: 0,
		});
		cooperative.prepare(layout, artifacts);
		expect(cooperative.getStats()).toEqual(before);
	});

	it.each([
		"during validation",
		"at final publication",
	])("retains the old binding when cancelled %s", async (phase) => {
		const previous = fixture(12);
		const next = fixture(256, 20);
		let total = 0;
		await new RailDraftEvaluator().prepareCooperatively(next.layout, next.artifacts, async () => {
			total++;
		});
		const evaluator = new RailDraftEvaluator();
		evaluator.prepare(previous.layout, previous.artifacts);
		const before = evaluator.getStats();
		const cancelled = new Error("cancel private draft preparation");
		let checkpoints = 0;
		const cancelAt = phase === "during validation" ? 2 : total;
		await expect(
			evaluator.prepareCooperatively(next.layout, next.artifacts, async () => {
				if (++checkpoints === cancelAt) throw cancelled;
			}),
		).rejects.toBe(cancelled);
		expect(checkpoints).toBe(cancelAt);
		expect(evaluator.getStats()).toEqual(before);
		const plan = planRailConstruction(previous.map, { x: 11, y: 0 }, { x: 16, y: 0 });
		expect(evaluator.evaluate(previous.map, previous.layout, plan).valid).toBe(true);
		expect(evaluator.getStats().committedIndexBuilds).toBe(before.committedIndexBuilds);
	});

	it.each([false, true])("cannot replace a newer binding (cooperative=%s)", async (cooperative) => {
		const older = fixture(256);
		const newer = fixture(32, 20);
		const evaluator = new RailDraftEvaluator();
		let signalStarted!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => {
			signalStarted = resolve;
		});
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		let checkpoints = 0;
		const pending = evaluator.prepareCooperatively(older.layout, older.artifacts, async () => {
			if (++checkpoints === 2) {
				signalStarted();
				await paused;
			}
		});
		await started;
		if (cooperative) {
			await evaluator.prepareCooperatively(newer.layout, newer.artifacts, async () => undefined);
		} else evaluator.prepare(newer.layout, newer.artifacts);
		const beforeRelease = evaluator.getStats();
		release();
		await expect(pending).rejects.toThrow("superseded");
		expect(evaluator.getStats()).toEqual(beforeRelease);
		expect(evaluator.getStats().committedEnvelopeCount).toBe(
			newer.layout.clearance.envelopes.count,
		);
	});

	it.each([
		false,
		true,
	])("rejects corrupted envelope bytes without publishing (cooperative=%s)", async (cooperative) => {
		const previous = fixture(12);
		const corrupt = fixture(32, 20);
		const evaluator = new RailDraftEvaluator();
		evaluator.prepare(previous.layout, previous.artifacts);
		const before = evaluator.getStats();
		const offsets = corrupt.artifacts.envelopeSpatialIndex.chunkOffsets;
		offsets[offsets.length - 1] = corrupt.artifacts.envelopeSpatialIndex.envelopeIndices.length + 1;
		if (cooperative) {
			await expect(
				evaluator.prepareCooperatively(corrupt.layout, corrupt.artifacts, async () => undefined),
			).rejects.toThrow();
		} else expect(() => evaluator.prepare(corrupt.layout, corrupt.artifacts)).toThrow();
		expect(evaluator.getStats()).toEqual(before);
	});

	it("rejects artifacts that have not passed independent adoption", async () => {
		const { layout, artifacts } = fixture(12);
		const evaluator = new RailDraftEvaluator();
		await expect(
			evaluator.prepareCooperatively(layout, structuredClone(artifacts), async () => undefined),
		).rejects.toThrow("validated matching artifacts");
		expect(evaluator.getStats().committedBindings).toBe(0);
	});
});

function fixture(count: number, y = 0) {
	const map = new TileMap();
	for (let x = 0; x < count; x++) {
		map.setEncoded(
			x,
			y,
			encodeRailCell({
				incoming: x === 0 ? 0 : DIR_W,
				outgoing: x === count - 1 ? 0 : DIR_E,
			}),
		);
	}
	const layout = compilePhysicalRail(map);
	return { map, layout, artifacts: compileRailDraftPreparedArtifacts(layout) };
}
