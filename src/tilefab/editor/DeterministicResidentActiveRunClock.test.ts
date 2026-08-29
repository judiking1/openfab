import { describe, expect, it } from "vitest";
import { publishSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import { issueSimulationResidentRunAuthorization } from "../compile/SimulationResidentRunAuthorization";
import { DeterministicResidentActiveRunOwner } from "../simulation/DeterministicResidentActiveRunOwner";
import {
	LiveSimulationActiveRunClock,
	type LiveSimulationActiveRunClockFramePort,
} from "./LiveSimulationActiveRunClock";

class ResidentControlledFrames implements LiveSimulationActiveRunClockFramePort {
	private readonly callbacks = new Map<number, (timestampMilliseconds: number) => void>();
	private readonly visibilityListeners = new Set<() => void>();
	private nextHandle = 1;
	visible = true;

	requestFrame(callback: (timestampMilliseconds: number) => void): number {
		const handle = this.nextHandle++;
		this.callbacks.set(handle, callback);
		return handle;
	}

	cancelFrame(handle: number): void {
		this.callbacks.delete(handle);
	}

	isVisible(): boolean {
		return this.visible;
	}

	subscribeVisibility(listener: () => void): () => void {
		this.visibilityListeners.add(listener);
		return () => this.visibilityListeners.delete(listener);
	}

	fire(timestampMilliseconds: number): void {
		const [handle, callback] = this.callbacks.entries().next().value ?? [];
		if (!handle || !callback) throw new Error("No resident animation frame is scheduled.");
		this.callbacks.delete(handle);
		callback(timestampMilliseconds);
	}

	get scheduledFrameCount(): number {
		return this.callbacks.size;
	}
}

describe("resident active-run controlled clock integration", () => {
	it("advances the owned resident runtime at 64x and pauses on its terminal publication", async () => {
		const { owner } = await startedOwner(64);
		const frames = new ResidentControlledFrames();
		const clock = residentClock(owner, frames);

		clock.start();
		frames.fire(0);
		for (let frame = 1; frame <= 50 && clock.getState().phase === "RUNNING"; frame++) {
			frames.fire(frame * 100);
		}

		expect(owner.getState()).toMatchObject({
			phase: "ACTIVE",
			completed: true,
			speedMultiplier: 64,
			latestPublication: { triggerCode: 2 },
		});
		expect(clock.getState()).toMatchObject({
			phase: "PAUSED",
			reason: "RUN_COMPLETED",
			summary: { advanceCallCount: expect.any(Number) },
		});
		const completedClockState = clock.getState();
		if (completedClockState.phase !== "PAUSED") throw new Error("Expected completed clock pause.");
		expect(completedClockState.summary.advanceCallCount).toBeGreaterThan(0);
		expect(frames.scheduledFrameCount).toBe(0);
		clock.dispose();
		owner.dispose();
	});

	it("cancels the scheduled frame when the resident source is invalidated", async () => {
		const { owner } = await startedOwner(1);
		const frames = new ResidentControlledFrames();
		const clock = residentClock(owner, frames);
		clock.start();
		expect(frames.scheduledFrameCount).toBe(1);

		expect(owner.invalidateSource("CURRENT_SOURCE_CHANGED")).toBe(true);
		expect(clock.getState()).toMatchObject({
			phase: "STOPPED",
			reason: "ACTIVE_RUN_STOPPED",
			activeRunStopReason: "CURRENT_SOURCE_CHANGED",
		});
		expect(frames.scheduledFrameCount).toBe(0);
		clock.dispose();
		owner.dispose();
	});
});

function residentClock(
	owner: DeterministicResidentActiveRunOwner,
	frames: ResidentControlledFrames,
): LiveSimulationActiveRunClock {
	return new LiveSimulationActiveRunClock(owner, frames, {
		maximumWallClockAdvancePerFrameMicroseconds: 100_000,
		maximumPendingWallClockMicroseconds: 1_000_000,
	});
}

async function startedOwner(speedMultiplier: 1 | 64): Promise<{
	owner: DeterministicResidentActiveRunOwner;
}> {
	const snapshot = await publishSimulationResidentReadinessSnapshot(
		await buildSimulationResidentReadinessTestSources(),
	);
	const input = {
		projectId: "PROJECT-RESIDENT-CLOCK-1",
		preparationGeneration: 1,
		authorizationGeneration: 1,
		runAssetFingerprint: "resident-clock-run-asset-1",
		snapshot,
	};
	const grant = await issueSimulationResidentRunAuthorization(input);
	const owner = new DeterministicResidentActiveRunOwner({
		cadenceMicroseconds: 1_000,
		maximumPoseCount: 1,
	});
	await owner.start(grant, input, speedMultiplier);
	return { owner };
}
