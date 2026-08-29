import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "../compile/SimulationReadinessTestFixture";
import { compileSimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import { compileSimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import { compileSimulationScenarioResourceRunConfiguration } from "../compile/SimulationScenarioResourceRunConfiguration";
import { compileSimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import { compileSimulationScenarioServiceTiming } from "../compile/SimulationScenarioServiceTiming";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DeterministicScenarioMotionScheduler } from "../simulation/DeterministicScenarioMotionScheduler";
import { DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE } from "../simulation/DeterministicScenarioRuntimePublisher";
import type { PreparedSimulationScenarioArtifacts } from "../worker/SimulationScenarioPreparationWorkerProtocol";
import { LiveSimulationActiveRunOwner } from "./LiveSimulationActiveRunOwner";
import { LiveSimulationScenarioEditorController } from "./LiveSimulationScenarioEditorController";
import {
	type LiveSimulationScenarioPreparationPort,
	LiveSimulationScenarioSession,
} from "./LiveSimulationScenarioSession";

class ImmediatePreparation implements LiveSimulationScenarioPreparationPort {
	prepare(
		snapshot: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[0],
		manifest: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[1],
		timing: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[2],
		resources: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[3],
	): Promise<PreparedSimulationScenarioArtifacts> {
		return compilePrepared(snapshot, manifest, timing, resources);
	}

	cancel(): void {}
	dispose(): void {}
}

describe("LiveSimulationActiveRunOwner", () => {
	it("rejects an invalid publication budget before subscribing or consuming authority", async () => {
		const fixture = await preparedFixture();
		const authorization = fixture.controller.authorizeCurrentPrepared(fixture.snapshot);

		expect(
			() =>
				new LiveSimulationActiveRunOwner(fixture.controller, {
					cadenceMicroseconds: 999,
					maximumPoseCount: 8,
				}),
		).toThrow(/publication configuration/i);
		expect(fixture.controller.getState().authorization?.fingerprint).toBe(
			authorization.fingerprint,
		);
	});

	it("consumes one exact authorization and constructs the resource-backed runtime once", async () => {
		const fixture = await preparedFixture();
		const authorization = fixture.controller.authorizeCurrentPrepared(fixture.snapshot);
		const owner = new LiveSimulationActiveRunOwner(fixture.controller, {
			cadenceMicroseconds: 1_000,
			maximumPoseCount: 8,
		});

		const started = owner.start(fixture.snapshot, 64);
		expect(started).toMatchObject({
			phase: "ACTIVE",
			generation: 1,
			projectId: "PROJECT-1",
			authorizationFingerprint: authorization.fingerprint,
			speedMultiplier: 64,
			sampledSimulationTimeMicroseconds: 0,
			completed: false,
			latestPublication: {
				sequence: 1,
				resourceExecutionPrepared: true,
			},
		});
		expect(fixture.controller.getState().authorization).toBeNull();
		expect(() => owner.start(fixture.snapshot, 1)).toThrow(/already active/i);
		expect(owner.getLatestEventWindow()).toMatchObject({
			coreEventCount: 0,
			resourceEventCount: 0,
			coreRows: [],
			resourceRows: [],
		});

		const advanced = owner.advanceByWallClockMicroseconds(1_000);
		expect(advanced.publication).toMatchObject({
			sequence: 2,
			sampledSimulationTimeMicroseconds: 64_000,
			skippedCadenceCount: 63,
		});
		expect(owner.getState()).toMatchObject({
			phase: "ACTIVE",
			sampledSimulationTimeMicroseconds: 64_000,
		});
		expect(owner.getLatestEventWindow()).toMatchObject({
			coreEventCount: 2,
			coreRows: [
				{ type: "VEHICLE_TOKEN_ADMITTED", recordId: "TRANSFER-1", loadId: "LOAD-1" },
				{ type: "FOUP_PICKED_UP", recordId: "TRANSFER-1", loadId: "LOAD-1" },
			],
		});
		const publication = requiredActiveState(owner).latestPublication;
		expect(
			kpi(
				publication.kpiCodes,
				publication.kpiValues,
				DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_TOTAL,
			),
		).toBe(1);
	});

	it("drops all runtime access on Stop and requires a newly issued authority for another run", async () => {
		const fixture = await preparedFixture();
		fixture.controller.authorizeCurrentPrepared(fixture.snapshot);
		const owner = ownerFor(fixture.controller);
		owner.start(fixture.snapshot, 1);

		expect(owner.stop()).toBe(true);
		expect(owner.getLatestEventWindow()).toBeNull();
		expect(owner.getState()).toEqual({
			phase: "STOPPED",
			generation: 1,
			reason: "EXPLICIT_STOP",
		});
		expect(owner.stop()).toBe(false);
		expect(() => owner.advanceByWallClockMicroseconds(1)).toThrow(/no simulation scenario run/i);
		expect(() => owner.start(fixture.snapshot, 1)).toThrow(/authorization/i);

		fixture.controller.authorizeCurrentPrepared(fixture.snapshot);
		expect(owner.start(fixture.snapshot, 2)).toMatchObject({
			phase: "ACTIVE",
			generation: 2,
			speedMultiplier: 2,
		});
	});

	it("keeps delayed public consumption subject to fresh scheduler validation", async () => {
		const fixture = await preparedFixture();
		fixture.controller.authorizeCurrentPrepared(fixture.snapshot);
		const consumed = fixture.controller.consumeAuthorizedRunForCurrent(fixture.snapshot);
		expect(consumed).not.toBeNull();
		if (!consumed) throw new Error("Expected exact public Run consumption.");
		consumed.prepared.routes.routeDistancesMeters[0] =
			(consumed.prepared.routes.routeDistancesMeters[0] as number) + 1;

		expect(
			() =>
				new DeterministicScenarioMotionScheduler(
					fixture.snapshot,
					consumed.runAsset.manifest,
					consumed.prepared.routes,
					consumed.prepared.leaseClaims,
					consumed.prepared.admissionProgram,
					consumed.prepared.serviceTiming,
					consumed.prepared.resourceRunConfiguration,
				),
		).toThrow(/sources|configuration|invalid/i);
	});

	it("synchronously stops and discards an active run on an authored RailDocument mutation", async () => {
		const fixture = await preparedFixture();
		fixture.controller.authorizeCurrentPrepared(fixture.snapshot);
		const owner = ownerFor(fixture.controller);
		const notifications: string[] = [];
		owner.subscribe(() => notifications.push(owner.getState().phase));
		owner.start(fixture.snapshot, 1);

		expect(
			fixture.document.commit(
				planRailConstruction(fixture.document.map, { x: 0, y: 0 }, { x: 4, y: 0 }),
			),
		).toBe(true);
		expect(fixture.controller.getState().session).toMatchObject({
			phase: "INVALIDATED",
			reason: "AUTHORED_MUTATION",
		});
		expect(owner.getState()).toEqual({
			phase: "STOPPED",
			generation: 1,
			reason: "AUTHORED_MUTATION",
		});
		expect(notifications).toEqual(["ACTIVE", "STOPPED"]);
		expect(() => owner.advanceByWallClockMicroseconds(1)).toThrow(/no simulation scenario run/i);
	});

	it("stops on project replacement and makes owner disposal terminal", async () => {
		const fixture = await preparedFixture();
		fixture.controller.authorizeCurrentPrepared(fixture.snapshot);
		const owner = ownerFor(fixture.controller);
		owner.start(fixture.snapshot, 1);

		fixture.controller.replaceProject("PROJECT-2", new RailDocument());
		expect(owner.getState()).toEqual({
			phase: "STOPPED",
			generation: 1,
			reason: "PROJECT_REPLACEMENT",
		});
		owner.dispose();
		expect(() => owner.start(fixture.snapshot, 1)).toThrow(/disposed/i);
		owner.dispose();
	});
});

function ownerFor(controller: LiveSimulationScenarioEditorController) {
	return new LiveSimulationActiveRunOwner(controller, {
		cadenceMicroseconds: 1_000,
		maximumPoseCount: 8,
	});
}

async function preparedFixture() {
	const snapshot = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithEqPorts(),
	);
	const document = new RailDocument();
	const controller = new LiveSimulationScenarioEditorController(
		"PROJECT-1",
		document,
		new LiveSimulationScenarioSession(new ImmediatePreparation()),
	);
	await controller.prepare(snapshot, planSource(), timingInput(), resourceInput());
	return { snapshot, document, controller };
}

function planSource() {
	return {
		sourceKind: "TRANSFER_PLAN" as const,
		manifestId: "ACTIVE-RUN-PLAN",
		mappingVersion: 1,
		records: [
			{
				transferId: "TRANSFER-1",
				releaseTimeMicroseconds: 10,
				loadId: "LOAD-1",
				sourcePortId: 1,
				destinationPortId: 2,
			},
		],
	};
}

function timingInput() {
	return {
		eqProcessTimings: [
			{ sourceOrdinal: 0, capabilityId: 1, processingDurationMicroseconds: 1_000_000 },
		],
	};
}

function resourceInput() {
	return {
		eqResources: [
			{
				equipmentGroupId: 1,
				concurrentCapacity: 1,
				availabilityMode: "ALWAYS" as const,
				availabilityWindows: [],
			},
		],
		initialStorageLoads: [],
	};
}

async function compilePrepared(
	snapshot: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[0],
	manifest: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[1],
	timing: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[2],
	resources: Parameters<LiveSimulationScenarioPreparationPort["prepare"]>[3],
) {
	const routes = await compileSimulationScenarioRouteRequests(snapshot, manifest);
	const leaseClaims = compileSimulationScenarioLeaseClaims(snapshot, manifest, routes);
	const admissionProgram = compileSimulationScenarioAdmissionProgram(
		snapshot,
		manifest,
		routes,
		leaseClaims,
	);
	const serviceTiming = compileSimulationScenarioServiceTiming(
		snapshot,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		timing,
	);
	return Object.freeze({
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourceRunConfiguration: compileSimulationScenarioResourceRunConfiguration(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
			resources,
		),
	});
}

function requiredActiveState(owner: LiveSimulationActiveRunOwner) {
	const state = owner.getState();
	if (state.phase !== "ACTIVE") throw new Error("Expected active run state.");
	return state;
}

function kpi(codes: Uint8Array, values: Float64Array, code: number): number {
	const index = codes.indexOf(code);
	if (index < 0) throw new Error(`Missing KPI code ${code}.`);
	return values[index] as number;
}
