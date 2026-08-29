import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
	SimulationResidentScenarioEditorController,
	SimulationResidentScenarioEditorControllerState,
} from "./SimulationResidentScenarioEditorController";
import { SimulationResidentScenarioRunAuthorizationCard } from "./SimulationResidentScenarioRunAuthorizationCard";

describe("SimulationResidentScenarioRunAuthorizationCard", () => {
	it("keeps resident authorization locked before exact preparation", () => {
		const markup = renderToStaticMarkup(
			<SimulationResidentScenarioRunAuthorizationCard
				controller={controllerWithState(baseState())}
				readinessBinding={null}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="locked"');
		expect(markup).toContain("CURRENT CERTIFICATE REQUIRED");
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*AUTHORIZE RESIDENT RUN/s);
		expect(markup).toContain("차량 runtime이나 clock은 시작되지 않습니다");
		expect(markup).not.toContain("START RESIDENT");
	});

	it("discloses exact resident counts after authorization without adding Start here", () => {
		const state: SimulationResidentScenarioEditorControllerState = {
			...baseState(),
			source: {
				sourceKind: "TRANSFER_PLAN",
				manifestFingerprint: "manifest",
				runAssetFingerprint: "asset",
				inputRecordCount: 2,
				acceptedRecordCount: 2,
				rejectedRecordCount: 0,
				issuesTruncated: false,
			},
			authorization: {
				fingerprint: "authorization",
				preparationGeneration: 1,
				authorizationGeneration: 1,
				readinessProfileId: "OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1",
				requestCount: 2,
				loadCount: 1,
				vehicleCount: 1,
				eqResourceCount: 1,
				storageResourceCount: 1,
			},
		};
		const markup = renderToStaticMarkup(
			<SimulationResidentScenarioRunAuthorizationCard
				controller={controllerWithState(state)}
				readinessBinding={null}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="authorized"');
		expect(markup).toContain("AUTHORIZED · START READY");
		expect(markup).toContain("2 / 1");
		expect(markup).toContain("COMPLETE HOME RETURN");
		expect(markup).toContain("REVOKE");
		expect(markup).not.toContain("START RESIDENT");
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

function controllerWithState(
	state: SimulationResidentScenarioEditorControllerState,
): SimulationResidentScenarioEditorController {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
		authorizeCurrentPrepared: vi.fn(),
		revokeAuthorization: vi.fn(),
	} as unknown as SimulationResidentScenarioEditorController;
}
