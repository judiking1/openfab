import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithEqPorts } from "../compile/SimulationReadinessTestFixture";
import type {
	DeterministicResidentActiveRunOwner,
	DeterministicResidentActiveRunOwnerState,
} from "../simulation/DeterministicResidentActiveRunOwner";
import type { DeterministicScenarioRuntimeEventWindow } from "../simulation/DeterministicScenarioRuntimeEventWindow";
import {
	DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE,
	DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE,
} from "../simulation/DeterministicScenarioRuntimePublisher";
import type {
	LiveSimulationActiveRunClock,
	LiveSimulationActiveRunClockState,
} from "./LiveSimulationActiveRunClock";
import type {
	LiveSimulationActiveRunOwner,
	LiveSimulationActiveRunOwnerState,
} from "./LiveSimulationActiveRunOwner";
import type { BoundLiveSimulationReadinessPublication } from "./LiveSimulationReadiness";
import type {
	LiveSimulationScenarioEditorController,
	LiveSimulationScenarioEditorControllerState,
} from "./LiveSimulationScenarioEditorController";
import { SimulationScenarioActiveRunCard } from "./SimulationScenarioActiveRunCard";

describe("SimulationScenarioActiveRunCard", () => {
	it("keeps Start locked until an exact one-shot authorization exists", () => {
		const markup = renderToStaticMarkup(
			<SimulationScenarioActiveRunCard
				owner={ownerWithState({ phase: "IDLE", generation: 0 })}
				clock={clockWithState({ phase: "IDLE", generation: 0 })}
				controller={controllerWithState(controllerState(null))}
				readinessBinding={readinessBinding()}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="waiting"');
		expect(markup).toContain('data-source-kind="NONE"');
		expect(markup).toContain("ONE-SHOT AUTHORIZATION REQUIRED");
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*START SAFE RUNTIME/s);
		expect(markup).toContain("hidden 복귀는 명시적으로");
	});

	it("opens only construction Start after authorization and exposes all 1x-64x choices", () => {
		const markup = renderToStaticMarkup(
			<SimulationScenarioActiveRunCard
				owner={ownerWithState({ phase: "IDLE", generation: 0 })}
				clock={clockWithState({ phase: "IDLE", generation: 0 })}
				controller={controllerWithState(controllerState(authorizationSummary()))}
				readinessBinding={readinessBinding()}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="authorized"');
		expect(markup).toContain("AUTHORIZED · START READY");
		expect(markup).toMatch(/<button[^>]*>.*START SAFE RUNTIME/s);
		expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>.*START SAFE RUNTIME/s);
		for (const speed of [1, 2, 4, 8, 16, 32, 64]) {
			expect(markup).toContain(`>${speed}x</option>`);
		}
	});

	it("locks current Start while the separate resident profile is starting or active", () => {
		const markup = renderToStaticMarkup(
			<SimulationScenarioActiveRunCard
				owner={ownerWithState({ phase: "IDLE", generation: 0 })}
				clock={clockWithState({ phase: "IDLE", generation: 0 })}
				controller={controllerWithState(controllerState(authorizationSummary()))}
				readinessBinding={readinessBinding()}
				setStatus={vi.fn()}
				incompatibleResidentRun={residentOwnerWithState({
					phase: "STARTING",
					generation: 1,
				})}
			/>,
		);

		expect(markup).toContain('data-phase="locked"');
		expect(markup).toContain("RESIDENT PROFILE RUN ACTIVE");
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*START SAFE RUNTIME/s);
	});

	it("shows only bounded runtime publication facts and explicit Stop while active", () => {
		const markup = renderToStaticMarkup(
			<SimulationScenarioActiveRunCard
				owner={ownerWithState(activeState(), recentEventWindow())}
				clock={clockWithState(runningClockState())}
				controller={controllerWithState(controllerState(null))}
				readinessBinding={readinessBinding()}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="running"');
		expect(markup).toContain('data-source-kind="TRANSFER_PLAN"');
		expect(markup).toContain("RUNNING · 64x");
		expect(markup).toContain("TRANSFER_PLAN · OPENFAB_UNLAUNCHED_TRANSFER_TOKEN_READINESS_V1");
		expect(markup).toContain("#3 / 2");
		expect(markup).toContain('data-publication-sequence="3"');
		expect(markup).toContain('data-request-in-transit="2"');
		expect(markup).toContain('data-service-ready="0"');
		expect(markup).toContain('data-service-active="0"');
		expect(markup).toContain('data-eq-destination-requests="1"');
		expect(markup).toContain('data-eq-ready="0"');
		expect(markup).toContain('data-eq-active="0"');
		expect(markup).toContain('data-storage-resources="0"');
		expect(markup).toContain('data-storage-occupied="0"');
		expect(markup).toContain('data-storage-reserved="0"');
		expect(markup).toContain('data-core-events="3"');
		expect(markup).toContain('data-resource-events="1"');
		expect(markup).toContain('data-core-event-count="3"');
		expect(markup).toContain('data-core-window-start="0"');
		expect(markup).toContain('data-resource-event-count="1"');
		expect(markup).toContain("RECENT CANONICAL EVENTS");
		expect(markup).toContain("VEHICLE TOKEN ADMITTED");
		expect(markup).toContain("EQ SERVICE QUEUED");
		expect(markup).toContain("TRANSFER-1 · LOAD-1 · PORT 1 → 2");
		expect(markup).toContain("0 / 2 COMPLETE");
		expect(markup).toContain("2 TRANSIT · 0 QUEUED · 0 SCHEDULED");
		expect(markup).toContain("0 / 1 READY");
		expect(markup).toContain("PAUSE CLOCK");
		expect(markup).toContain("STOP &amp; DISCARD");
		expect(markup).not.toContain("START SAFE RUNTIME");
	});

	it("surfaces asynchronous clock failures without losing explicit runtime disposal", () => {
		const markup = renderToStaticMarkup(
			<SimulationScenarioActiveRunCard
				owner={ownerWithState(activeState())}
				clock={clockWithState({
					phase: "FAILED",
					generation: 1,
					message: "controlled clock failure",
					summary: {
						advanceCallCount: 0,
						observedWallClockMicroseconds: 16_000,
						advancedWallClockMicroseconds: 0,
						discardedWallClockMicroseconds: 16_000,
					},
				})}
				controller={controllerWithState(controllerState(null))}
				readinessBinding={readinessBinding()}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="error"');
		expect(markup).toContain("CLOCK FAILED");
		expect(markup).toContain("controlled clock failure");
		expect(markup).toContain("RUN CLOCK");
		expect(markup).toContain("STOP &amp; DISCARD");
	});
});

function controllerState(
	authorization: LiveSimulationScenarioEditorControllerState["authorization"],
): LiveSimulationScenarioEditorControllerState {
	return {
		projectId: "PROJECT-UI-1",
		source: null,
		session: { phase: "IDLE", generation: 0 },
		authorization,
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

function authorizationSummary() {
	return {
		fingerprint: "authorization",
		preparationGeneration: 1,
		authorizationGeneration: 1,
		readinessProfileId: "OPENFAB_UNLAUNCHED_TRANSFER_TOKEN_READINESS_V1",
		limitations: [
			"UNLAUNCHED_TRANSFER_TOKENS_ONLY",
			"NO_RESIDENT_FLEET",
			"NO_IDLE_TRACK_PARKING",
			"NO_MID_ROUTE_REPLAN",
		],
		requestCount: 2,
		loadCount: 1,
		eqResourceCount: 1,
		storageResourceCount: 0,
	};
}

function activeState(): LiveSimulationActiveRunOwnerState {
	return {
		phase: "ACTIVE",
		generation: 1,
		projectId: "PROJECT-UI-1",
		sourceKind: "TRANSFER_PLAN",
		authorizationFingerprint: "authorization",
		readinessProfileId: "OPENFAB_UNLAUNCHED_TRANSFER_TOKEN_READINESS_V1",
		limitations: [
			"UNLAUNCHED_TRANSFER_TOKENS_ONLY",
			"NO_RESIDENT_FLEET",
			"NO_IDLE_TRACK_PARKING",
			"NO_MID_ROUTE_REPLAN",
		],
		runIdentityFingerprint: "run",
		requestCount: 2,
		loadCount: 1,
		eqResourceCount: 1,
		storageResourceCount: 0,
		speedMultiplier: 64,
		sampledSimulationTimeMicroseconds: 250_000,
		completed: false,
		latestPublication: {
			sequence: 3,
			triggerCode: DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
			resourceExecutionPrepared: true,
			sampledSimulationTimeMicroseconds: 250_000,
			maximumPoseCount: 8,
			eligiblePoseCount: 2,
			publishedPoseCount: 2,
			posesTruncated: false,
			kpiCount: 20,
			kpiCodes: Uint8Array.from(Object.values(DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE)),
			kpiValues: Float64Array.from([2, 0, 0, 0, 0, 2, 0, 2, 0, 0, 3, 1, 1, 1, 0, 0, 0, 0, 0, 0]),
		} as never,
	};
}

function ownerWithState(
	state: LiveSimulationActiveRunOwnerState,
	eventWindow: DeterministicScenarioRuntimeEventWindow | null = null,
): LiveSimulationActiveRunOwner {
	return {
		getState: () => state,
		getLatestEventWindow: () => eventWindow,
		subscribe: () => () => undefined,
		start: vi.fn(),
		stop: vi.fn(),
		setSpeedMultiplier: vi.fn(),
	} as unknown as LiveSimulationActiveRunOwner;
}

function residentOwnerWithState(
	state: DeterministicResidentActiveRunOwnerState,
): DeterministicResidentActiveRunOwner {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
	} as unknown as DeterministicResidentActiveRunOwner;
}

function recentEventWindow(): DeterministicScenarioRuntimeEventWindow {
	const identity = {
		requestRow: 0,
		recordId: "TRANSFER-1",
		loadId: "LOAD-1",
		sourcePortId: 1,
		destinationPortId: 2,
	};
	return {
		sourceKind: "TRANSFER_PLAN",
		coreEventCount: 3,
		coreStartIndex: 0,
		resourceEventCount: 1,
		resourceStartIndex: 0,
		coreRows: [
			{
				...identity,
				sequence: 1,
				timeMicroseconds: 10,
				type: "VEHICLE_TOKEN_ADMITTED",
				vehicleTokenId: 1,
				loadRow: 0,
			},
			{
				...identity,
				sequence: 2,
				timeMicroseconds: 10,
				type: "FOUP_PICKED_UP",
				vehicleTokenId: 1,
				loadRow: 0,
			},
			{
				...identity,
				sequence: 3,
				timeMicroseconds: 250_000,
				type: "TRANSFER_COMPLETED",
				vehicleTokenId: 1,
				loadRow: 0,
			},
		],
		resourceRows: [
			{
				...identity,
				sequence: 1,
				timeMicroseconds: 20,
				type: "EQ_SERVICE_QUEUED",
				loadRow: 0,
				resourceRow: 0,
			},
		],
	};
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

function controllerWithState(
	state: LiveSimulationScenarioEditorControllerState,
): LiveSimulationScenarioEditorController {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
	} as unknown as LiveSimulationScenarioEditorController;
}

function readinessBinding(): BoundLiveSimulationReadinessPublication {
	const published = publishSimulationReadinessSnapshot(
		buildSimulationReadinessTestComponentsWithEqPorts(),
	);
	return {
		source: {
			modelGeneration: 1,
			patchSequence: published.certificate.sourcePatchSequence,
			revision: published.certificate.sourceRevision,
			authoredChecksum: published.certificate.sourceAuthoredChecksum,
			physicalFingerprint: published.certificate.sourcePhysicalFingerprint,
			railReadinessFingerprint: published.certificate.sourceRailReadinessFingerprint,
			staticChecksFingerprint: "static-checks",
			operationalConfigurationRevision: 1,
			operationalConfigurationFingerprint: "operational",
			nextAdvancedSwitchId: 1,
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			nextOrganizationId: 1,
		},
		published,
	};
}
