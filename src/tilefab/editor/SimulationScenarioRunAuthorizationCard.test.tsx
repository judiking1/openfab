import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
	LiveSimulationActiveRunOwner,
	LiveSimulationActiveRunOwnerState,
} from "./LiveSimulationActiveRunOwner";
import type {
	LiveSimulationScenarioEditorController,
	LiveSimulationScenarioEditorControllerState,
} from "./LiveSimulationScenarioEditorController";
import { SimulationScenarioRunAuthorizationCard } from "./SimulationScenarioRunAuthorizationCard";

describe("SimulationScenarioRunAuthorizationCard", () => {
	it("keeps authorization and Start locked before exact preparation", () => {
		const markup = renderToStaticMarkup(
			<SimulationScenarioRunAuthorizationCard
				controller={controllerWithState({
					projectId: "PROJECT-UI-1",
					source: null,
					session: { phase: "IDLE", generation: 0 },
					authorization: null,
				})}
				readinessBinding={null}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="locked"');
		expect(markup).toContain("CERTIFICATE REQUIRED");
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*AUTHORIZE LIMITED RUN/s);
		expect(markup).toContain("scheduler를 만들거나 시간을 진행하지 않습니다");
		expect(markup).not.toMatch(/>START</);
		expect(markup).not.toMatch(/>RUN</);
	});

	it("discloses the exact limited profile after authorization but still has no Start action", () => {
		const markup = renderToStaticMarkup(
			<SimulationScenarioRunAuthorizationCard
				controller={controllerWithState({
					projectId: "PROJECT-UI-1",
					source: {
						sourceKind: "TRANSFER_PLAN",
						manifestFingerprint: "manifest",
						runAssetFingerprint: "asset",
						inputRecordCount: 2,
						acceptedRecordCount: 2,
						rejectedRecordCount: 0,
						issuesTruncated: false,
					},
					session: { phase: "IDLE", generation: 0 },
					authorization: {
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
					},
				})}
				readinessBinding={null}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="authorized"');
		expect(markup).toContain("AUTHORIZED · START LOCKED");
		expect(markup).toContain("UNLAUNCHED TOKENS ONLY");
		expect(markup).toContain("NO RESIDENT FLEET");
		expect(markup).toContain("NO IDLE TRACK PARKING");
		expect(markup).toContain("NO MID-ROUTE REPLAN");
		expect(markup).toContain("REVOKE");
		expect(markup).not.toMatch(/>START</);
	});

	it("keeps a second authorization disabled while the consumed run is active", () => {
		const markup = renderToStaticMarkup(
			<SimulationScenarioRunAuthorizationCard
				controller={controllerWithState({
					projectId: "PROJECT-UI-1",
					source: null,
					session: { phase: "IDLE", generation: 0 },
					authorization: null,
				})}
				activeRunOwner={ownerWithState({
					phase: "ACTIVE",
					generation: 1,
				} as LiveSimulationActiveRunOwnerState)}
				readinessBinding={null}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="active"');
		expect(markup).toContain("CONSUMED · RUN ACTIVE");
		expect(markup).toContain("AUTHORITY CONSUMED");
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*AUTHORITY CONSUMED/s);
	});
});

function controllerWithState(
	state: LiveSimulationScenarioEditorControllerState,
): LiveSimulationScenarioEditorController {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
		authorizeCurrentPrepared: vi.fn(),
		revokeRunAuthorization: vi.fn(),
	} as unknown as LiveSimulationScenarioEditorController;
}

function ownerWithState(state: LiveSimulationActiveRunOwnerState): LiveSimulationActiveRunOwner {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
	} as unknown as LiveSimulationActiveRunOwner;
}
