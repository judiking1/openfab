import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SIMULATION_RESIDENT_READINESS_LIMITATIONS } from "../compile/SimulationResidentReadinessCertificate";
import {
	DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE,
	DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE,
} from "../simulation/DeterministicResidentRuntimePublisher";
import type {
	LiveSimulationActiveRunClock,
	LiveSimulationActiveRunClockState,
} from "./LiveSimulationActiveRunClock";
import type {
	LiveSimulationActiveRunOwner,
	LiveSimulationActiveRunOwnerState,
} from "./LiveSimulationActiveRunOwner";
import { SimulationResidentScenarioActiveRunCard } from "./SimulationResidentScenarioActiveRunCard";
import type {
	SimulationResidentScenarioEditorController,
	SimulationResidentScenarioEditorControllerState,
} from "./SimulationResidentScenarioEditorController";

describe("SimulationResidentScenarioActiveRunCard", () => {
	it("keeps Start locked until the separate resident one-shot authority exists", () => {
		const markup = renderToStaticMarkup(
			<SimulationResidentScenarioActiveRunCard
				controller={controllerWithState(baseState())}
				clock={clockWithState({ phase: "IDLE", generation: 0 })}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="waiting"');
		expect(markup).toContain('data-source-kind="NONE"');
		expect(markup).toContain("ONE-SHOT AUTHORIZATION REQUIRED");
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*START RESIDENT RUNTIME/s);
		for (const speed of [1, 2, 4, 8, 16, 32, 64]) {
			expect(markup).toContain(`>${speed}x</option>`);
		}
	});

	it("shows bounded home-return KPI/publication facts and explicit Stop at 64x", () => {
		const state: SimulationResidentScenarioEditorControllerState = {
			...baseState(),
			activeRun: activeRunState(),
		};
		const markup = renderToStaticMarkup(
			<SimulationResidentScenarioActiveRunCard
				controller={controllerWithState(state)}
				clock={clockWithState(runningClockState())}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="running"');
		expect(markup).toContain('data-source-kind="TRANSFER_PLAN"');
		expect(markup).toContain('data-clock-phase="RUNNING"');
		expect(markup).toContain('data-stop-reason=""');
		expect(markup).toContain("RUNNING · 64x");
		expect(markup).toContain("OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1");
		expect(markup).toContain('data-publication-sequence="3"');
		expect(markup).toContain('data-request-completed="1"');
		expect(markup).toContain('data-request-waiting-cycle="0"');
		expect(markup).toContain('data-service-ready="1"');
		expect(markup).toContain('data-service-active="1"');
		expect(markup).toContain('data-vehicle-idle="1"');
		expect(markup).toContain('data-vehicle-waiting-cycle="0"');
		expect(markup).toContain('data-vehicle-moving="1"');
		expect(markup).toContain('data-core-events="2"');
		expect(markup).toContain('data-resource-events="2"');
		expect(markup).toContain("#3 / 2");
		expect(markup).toContain("1 / 2 COMPLETE");
		expect(markup).toContain("CYCLE LEASES");
		expect(markup).toContain("OHB / STK STORAGE");
		expect(markup).toContain("CYCLE ADMITTED");
		expect(markup).toContain("EQ SERVICE STARTED");
		expect(markup).toContain("PAUSE CLOCK");
		expect(markup).toContain("STOP &amp; DISCARD");
		expect(markup).not.toContain("START RESIDENT RUNTIME");
	});

	it("shows settled terminal EQ/storage outcomes and clears them after Stop", () => {
		const terminalState: SimulationResidentScenarioEditorControllerState = {
			...baseState(),
			activeRun: activeRunState(true),
		};
		const terminalMarkup = renderToStaticMarkup(
			<SimulationResidentScenarioActiveRunCard
				controller={controllerWithState(terminalState)}
				clock={clockWithState({
					phase: "PAUSED",
					generation: 1,
					reason: "RUN_COMPLETED",
					summary: {
						advanceCallCount: 1,
						observedWallClockMicroseconds: 1,
						advancedWallClockMicroseconds: 1,
						discardedWallClockMicroseconds: 0,
					},
				})}
				setStatus={vi.fn()}
			/>,
		);

		expect(terminalMarkup).toContain('data-terminal="true"');
		expect(terminalMarkup).toContain("2 / 2 COMPLETE");
		expect(terminalMarkup).toContain("2 HOME");
		expect(terminalMarkup).toContain("0 TRACK");
		expect(terminalMarkup).toContain("2 OCCUPIED · 0 RESERVED");
		expect(terminalMarkup).toContain("EQ SERVICE READY");
		expect(terminalMarkup).toContain("STORAGE SERVICE READY");

		const stoppedMarkup = renderToStaticMarkup(
			<SimulationResidentScenarioActiveRunCard
				controller={controllerWithState({
					...baseState(),
					activeRun: { phase: "STOPPED", generation: 1, reason: "EXPLICIT_STOP" },
				})}
				clock={clockWithState({ phase: "IDLE", generation: 0 })}
				setStatus={vi.fn()}
			/>,
		);
		expect(stoppedMarkup).not.toContain("simulation-resident-runtime-kpis");
		expect(stoppedMarkup).not.toContain("simulation-resident-runtime-events");
		expect(stoppedMarkup).not.toContain("EQ SERVICE READY");
		expect(stoppedMarkup).toContain('data-clock-phase="IDLE"');
		expect(stoppedMarkup).toContain('data-stop-reason="EXPLICIT_STOP"');
	});

	it("locks resident Start while the current From-To profile is active", () => {
		const state: SimulationResidentScenarioEditorControllerState = {
			...baseState(),
			authorization: {
				fingerprint: "authorization",
				preparationGeneration: 1,
				authorizationGeneration: 1,
				readinessProfileId: "OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1",
				requestCount: 2,
				loadCount: 2,
				vehicleCount: 2,
				eqResourceCount: 1,
				storageResourceCount: 1,
			},
		};
		const markup = renderToStaticMarkup(
			<SimulationResidentScenarioActiveRunCard
				controller={controllerWithState(state)}
				clock={clockWithState({ phase: "IDLE", generation: 0 })}
				setStatus={vi.fn()}
				incompatibleCurrentRun={currentOwnerWithState({
					phase: "ACTIVE",
					generation: 1,
				} as LiveSimulationActiveRunOwnerState)}
			/>,
		);

		expect(markup).toContain('data-phase="locked"');
		expect(markup).toContain("CURRENT FROM-TO RUN ACTIVE");
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*START RESIDENT RUNTIME/s);
	});

	it("fails closed instead of rendering events when the resident KPI code order drifts", () => {
		const activeRun = activeRunState();
		if (activeRun.phase !== "ACTIVE") throw new Error("Expected active resident test state.");
		activeRun.latestPublication.kpiCodes[0] =
			DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_COMPLETED;
		const markup = renderToStaticMarkup(
			<SimulationResidentScenarioActiveRunCard
				controller={controllerWithState({ ...baseState(), activeRun })}
				clock={clockWithState(runningClockState())}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain("INVALID KPI / EVENT PUBLICATION · FAIL CLOSED");
		expect(markup).not.toContain("simulation-resident-runtime-events");
	});
});

function baseState(): SimulationResidentScenarioEditorControllerState {
	return {
		projectId: "PROJECT-RESIDENT-UI-1",
		source: null,
		session: { phase: "IDLE", generation: 0 },
		authorization: null,
		activeRun: { phase: "IDLE", generation: 0 },
	};
}

function activeRunState(
	terminal = false,
): SimulationResidentScenarioEditorControllerState["activeRun"] {
	const kpiCodes = Uint8Array.from(Object.values(DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE));
	const kpiValues = Float64Array.from(
		terminal
			? [2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 2, 2, 0, 0, 2, 0, 0, 2, 0, 2, 2]
			: [2, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 2, 1, 0, 1, 2, 3, 1, 2, 1, 2, 2],
	);
	return {
		phase: "ACTIVE",
		generation: 1,
		projectId: "PROJECT-RESIDENT-UI-1",
		sourceKind: "TRANSFER_PLAN",
		authorizationFingerprint: "authorization",
		readinessProfileId: "OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1",
		limitations: SIMULATION_RESIDENT_READINESS_LIMITATIONS,
		requestCount: 2,
		loadCount: 2,
		vehicleCount: 2,
		eqResourceCount: 1,
		storageResourceCount: 1,
		speedMultiplier: 64,
		sampledSimulationTimeMicroseconds: 250_000,
		completed: terminal,
		latestPublication: {
			sequence: 3,
			triggerCode: terminal
				? DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL
				: DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
			sampledSimulationTimeMicroseconds: 250_000,
			maximumPoseCount: 8,
			eligiblePoseCount: 2,
			publishedPoseCount: 2,
			posesTruncated: false,
			kpiCodes,
			kpiValues,
			coreEventCount: 2,
			publishedCoreEventCount: 2,
			coreEventsTruncated: false,
			coreEventSequences: Uint32Array.of(1, 2),
			coreEventTimesMicroseconds: Float64Array.of(10, 20),
			coreEventTypeCodes: terminal ? Uint8Array.of(4, 5) : Uint8Array.of(1, 2),
			coreEventRequestRows: Uint32Array.of(0, 1),
			resourceEventCount: 2,
			publishedResourceEventCount: 2,
			resourceEventsTruncated: false,
			resourceEventSequences: Uint32Array.of(1, 2),
			resourceEventTimesMicroseconds: Float64Array.of(30, 40),
			resourceEventTypeCodes: terminal ? Uint8Array.of(6, 8) : Uint8Array.of(1, 5),
			resourceEventRequestRows: Uint32Array.of(0, 1),
			resourceEventResourceRows: Uint32Array.of(4, 7),
		} as never,
	};
}

function runningClockState(): LiveSimulationActiveRunClockState {
	return {
		phase: "RUNNING",
		generation: 1,
		clockPolicy: "VISIBLE_FRAME_INTEGER_MICROSECONDS_BOUNDED_CATCH_UP_V1",
		visibilityPolicy: "EXPLICIT_RESUME_NO_HIDDEN_CATCH_UP_V1",
		maximumWallClockAdvancePerFrameMicroseconds: 25_000,
		maximumPendingWallClockMicroseconds: 100_000,
	};
}

function controllerWithState(
	state: SimulationResidentScenarioEditorControllerState,
): SimulationResidentScenarioEditorController {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
		start: vi.fn(),
		stop: vi.fn(),
		setSpeedMultiplier: vi.fn(),
	} as unknown as SimulationResidentScenarioEditorController;
}

function clockWithState(state: LiveSimulationActiveRunClockState): LiveSimulationActiveRunClock {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
		start: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		stop: vi.fn(),
	} as unknown as LiveSimulationActiveRunClock;
}

function currentOwnerWithState(
	state: LiveSimulationActiveRunOwnerState,
): LiveSimulationActiveRunOwner {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
	} as unknown as LiveSimulationActiveRunOwner;
}
