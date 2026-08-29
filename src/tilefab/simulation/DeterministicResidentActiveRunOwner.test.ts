import { describe, expect, it } from "vitest";
import { publishSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import {
	issueSimulationResidentRunAuthorization,
	type SimulationResidentRunAuthorizationGrant,
} from "../compile/SimulationResidentRunAuthorization";
import { DeterministicResidentActiveRunOwner } from "./DeterministicResidentActiveRunOwner";

describe("DeterministicResidentActiveRunOwner", () => {
	it("consumes one exact grant, owns publication, speed, and Stop across fresh generations", async () => {
		const fixture = await ownerFixture();
		const owner = new DeterministicResidentActiveRunOwner({
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 1,
		});
		const phases: string[] = [];
		owner.subscribe(() => phases.push(owner.getState().phase));

		await expect(owner.start(fixture.grant, fixture.input, 64)).resolves.toMatchObject({
			phase: "ACTIVE",
			generation: 1,
			projectId: fixture.input.projectId,
			speedMultiplier: 64,
			sampledSimulationTimeMicroseconds: 0,
			completed: false,
			latestPublication: { sequence: 1 },
		});
		const advanced = owner.advanceByWallClockMicroseconds(1_000);
		expect(advanced.publication).toMatchObject({
			sequence: 2,
			sampledSimulationTimeMicroseconds: 64_000,
		});
		owner.setSpeedMultiplier(2);
		expect(owner.getState()).toMatchObject({ phase: "ACTIVE", speedMultiplier: 2 });
		expect(owner.stop()).toBe(true);
		expect(owner.getState()).toEqual({
			phase: "STOPPED",
			generation: 1,
			reason: "EXPLICIT_STOP",
		});
		expect(owner.stop()).toBe(false);
		expect(() => owner.advanceByWallClockMicroseconds(1)).toThrow(/no resident simulation run/i);

		const freshGrant = await issueSimulationResidentRunAuthorization(fixture.input);
		await expect(owner.start(freshGrant, fixture.input, 1)).resolves.toMatchObject({
			phase: "ACTIVE",
			generation: 2,
			speedMultiplier: 1,
		});
		expect(phases).toEqual([
			"STARTING",
			"ACTIVE",
			"ACTIVE",
			"ACTIVE",
			"STOPPED",
			"STARTING",
			"ACTIVE",
		]);
	});

	it("cancels an in-flight one-shot adoption before the synchronous runtime constructor", async () => {
		const fixture = await ownerFixture();
		const owner = ownerForTest();
		const starting = owner.start(fixture.grant, fixture.input, 1);
		expect(owner.getState()).toEqual({ phase: "STARTING", generation: 1 });
		expect(owner.stop()).toBe(true);
		expect(await starting).toEqual({
			phase: "STOPPED",
			generation: 1,
			reason: "EXPLICIT_STOP",
		});
		expect(() => owner.advanceByWallClockMicroseconds(1)).toThrow(/no resident simulation run/i);
	});

	it("disposes and drops the active runtime synchronously on source invalidation", async () => {
		const fixture = await ownerFixture();
		const owner = ownerForTest();
		await owner.start(fixture.grant, fixture.input, 1);

		expect(owner.invalidateSource("AUTHORED_MUTATION")).toBe(true);
		expect(owner.getState()).toEqual({
			phase: "STOPPED",
			generation: 1,
			reason: "AUTHORED_MUTATION",
		});
		expect(owner.invalidateSource("PROJECT_REPLACEMENT")).toBe(false);
		expect(() => owner.invalidateSource("EXPLICIT_STOP" as never)).toThrow(/reason/i);
		owner.dispose();
		expect(() => owner.stop()).toThrow(/disposed/i);
		owner.dispose();
	});

	it("fails closed and clears ownership when retained certified sources drift", async () => {
		const fixture = await ownerFixture();
		const owner = ownerForTest();
		await owner.start(fixture.grant, fixture.input, 1);
		fixture.input.snapshot.admissionProgram.requestVehicleRows[0] =
			fixture.input.snapshot.parking.slotCount;

		expect(() => owner.advanceByWallClockMicroseconds(0)).toThrow(/vehicle/i);
		expect(owner.getState()).toMatchObject({
			phase: "FAILED",
			generation: 1,
			message: expect.stringMatching(/vehicle/i),
		});
		expect(() => owner.advanceByWallClockMicroseconds(1)).toThrow(/no resident simulation run/i);
	});

	it("publishes terminal UNMOUNT state before owner disposal clears listeners", async () => {
		const fixture = await ownerFixture();
		const owner = ownerForTest();
		const observed: string[] = [];
		owner.subscribe(() => observed.push(owner.getState().phase));
		await owner.start(fixture.grant, fixture.input, 1);

		owner.dispose();
		expect(owner.getState()).toEqual({
			phase: "STOPPED",
			generation: 1,
			reason: "UNMOUNT",
		});
		expect(observed).toEqual(["STARTING", "ACTIVE", "STOPPED"]);
		await expect(owner.start(fixture.grant, fixture.input, 1)).rejects.toThrow(/disposed/i);
	});

	it("rejects invalid publication configuration without consuming authority", async () => {
		const fixture = await ownerFixture();
		expect(
			() =>
				new DeterministicResidentActiveRunOwner({
					cadenceMicroseconds: 999,
					maximumPoseCount: 1,
				}),
		).toThrow(/configuration/i);
		const owner = ownerForTest();
		await expect(owner.start(fixture.grant, fixture.input, 1)).resolves.toMatchObject({
			phase: "ACTIVE",
		});
	});
});

function ownerForTest(): DeterministicResidentActiveRunOwner {
	return new DeterministicResidentActiveRunOwner({
		cadenceMicroseconds: 1_000,
		maximumPoseCount: 1,
	});
}

async function ownerFixture(): Promise<{
	input: {
		projectId: string;
		preparationGeneration: number;
		authorizationGeneration: number;
		runAssetFingerprint: string;
		snapshot: Awaited<ReturnType<typeof publishSimulationResidentReadinessSnapshot>>;
	};
	grant: SimulationResidentRunAuthorizationGrant;
}> {
	const snapshot = await publishSimulationResidentReadinessSnapshot(
		await buildSimulationResidentReadinessTestSources(),
	);
	const input = {
		projectId: "PROJECT-RESIDENT-OWNER-1",
		preparationGeneration: 1,
		authorizationGeneration: 1,
		runAssetFingerprint: "resident-owner-run-asset-1",
		snapshot,
	};
	return { input, grant: await issueSimulationResidentRunAuthorization(input) };
}
