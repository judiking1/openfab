import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyOperationalConfigurationState } from "../core/OperationalConfiguration";
import type {
	SimulationResidentScenarioEditorController,
	SimulationResidentScenarioEditorControllerState,
} from "./SimulationResidentScenarioEditorController";
import { SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID } from "./SimulationResidentScenarioEditorRunAssetFile";
import {
	ResidentScenarioReviewFacts,
	type ReviewedResidentScenarioDraft,
	SimulationResidentScenarioSourceReviewCard,
} from "./SimulationResidentScenarioSourceReviewCard";

describe("SimulationResidentScenarioSourceReviewCard", () => {
	it("keeps both resident source journeys and preparation locked before certification", () => {
		const markup = renderToStaticMarkup(
			<SimulationResidentScenarioSourceReviewCard
				controller={controllerWithState()}
				projectId="PROJECT-RESIDENT-UI-1"
				readinessBinding={null}
				operationalConfiguration={emptyOperationalConfigurationState()}
				setStatus={vi.fn()}
				forceFileInputFallback
			/>,
		);

		expect(markup).toContain('data-phase="empty"');
		expect(markup).toContain('data-source-kind="NONE"');
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*LOAD RESIDENT PLAN/s);
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*LOAD RESIDENT REPLAY/s);
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*PREPARE RESIDENT/s);
		expect(markup).toContain("reviewed home-slot vehicle");
		expect(markup).not.toContain("START RESIDENT");
	});

	it("shows an invalidated lifecycle as empty only after its local source is cleared", () => {
		const cleared = renderToStaticMarkup(
			<SimulationResidentScenarioSourceReviewCard
				controller={controllerWithState({
					projectId: "PROJECT-RESIDENT-UI-1",
					source: null,
					session: { phase: "INVALIDATED", generation: 1, reason: "SOURCE_SWITCH" },
					authorization: null,
					activeRun: { phase: "IDLE", generation: 0 },
				})}
				projectId="PROJECT-RESIDENT-UI-1"
				readinessBinding={null}
				operationalConfiguration={emptyOperationalConfigurationState()}
				setStatus={vi.fn()}
			/>,
		);
		const retained = renderToStaticMarkup(
			<SimulationResidentScenarioSourceReviewCard
				controller={controllerWithState({
					projectId: "PROJECT-RESIDENT-UI-1",
					source: {
						sourceKind: "TRANSFER_PLAN",
						manifestFingerprint: "manifest",
						runAssetFingerprint: "asset",
						inputRecordCount: 1,
						acceptedRecordCount: 1,
						rejectedRecordCount: 0,
						issuesTruncated: false,
					},
					session: { phase: "INVALIDATED", generation: 2, reason: "AUTHORED_MUTATION" },
					authorization: null,
					activeRun: { phase: "IDLE", generation: 0 },
				})}
				projectId="PROJECT-RESIDENT-UI-1"
				readinessBinding={null}
				operationalConfiguration={emptyOperationalConfigurationState()}
				setStatus={vi.fn()}
			/>,
		);

		expect(cleared).toContain('data-phase="empty"');
		expect(cleared).toContain("PLAN OR REPLAY REQUIRED");
		expect(retained).toContain('data-phase="invalidated"');
		expect(retained).toContain("INVALIDATED · AUTHORED_MUTATION");
	});

	it("renders only the bounded canonical resident row and issue prefixes", () => {
		const rows = Array.from({ length: 8 }, (_, sourceOrdinal) => ({
			sourceOrdinal,
			recordId: `TRANSFER-${sourceOrdinal}`,
			timeMicroseconds: sourceOrdinal * 1_000,
			loadId: `LOAD-${sourceOrdinal}`,
			vehicleId: `OHT-${sourceOrdinal}`,
			sourcePortId: sourceOrdinal + 1,
			destinationPortId: sourceOrdinal + 2,
		}));
		const review = {
			projectId: "PROJECT-RESIDENT-UI-1",
			certificateFingerprint: "certificate",
			operationalConfigurationFingerprint: "operational",
			draft: {
				schemaVersion: 1,
				profileId: SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID,
				source: {
					sourceKind: "TRANSFER_PLAN",
					manifestId: "RESIDENT-PLAN-1",
					mappingVersion: 1,
					records: [],
				},
				serviceTimingInput: { eqProcessTimings: [] },
				resourceRunInput: { eqResources: [], initialStorageLoads: [] },
			},
			summary: {
				sourceKind: "TRANSFER_PLAN",
				manifestId: "RESIDENT-PLAN-1",
				runAssetFingerprint: "asset",
				inputRecordCount: 100_000,
				acceptedRecordCount: 99_999,
				rejectedRecordCount: 1,
				issuesTruncated: false,
				vehicleCount: 4,
				rows,
				issues: [
					{
						sourceOrdinal: 99_999,
						code: "UNKNOWN_VEHICLE",
						message: "The reviewed resident row vehicle has no configured home slot.",
					},
				],
			},
		} satisfies ReviewedResidentScenarioDraft;

		const markup = renderToStaticMarkup(<ResidentScenarioReviewFacts review={review} />);

		expect(markup).toContain('data-record-count="99999"');
		expect(markup).toContain('data-preview-count="8"');
		expect(markup).toContain("TRANSFER-0");
		expect(markup).toContain("TRANSFER-7");
		expect(markup).toContain("OHT-7 · LOAD-7");
		expect(markup).toContain("#99999 · UNKNOWN_VEHICLE");
		expect(markup).not.toContain("TRANSFER-8");
	});
});

function controllerWithState(
	state: SimulationResidentScenarioEditorControllerState = {
		projectId: "PROJECT-RESIDENT-UI-1",
		source: null,
		session: { phase: "IDLE", generation: 0 },
		authorization: null,
		activeRun: { phase: "IDLE", generation: 0 },
	},
): SimulationResidentScenarioEditorController {
	return {
		getState: () => state,
		subscribe: () => () => undefined,
	} as unknown as SimulationResidentScenarioEditorController;
}
