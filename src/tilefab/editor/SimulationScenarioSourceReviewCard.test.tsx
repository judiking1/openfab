import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { compileSimulationTransferPlanManifest } from "../compile/SimulationScenarioManifest";
import { RailDocument } from "../core/RailDocument";
import { LiveSimulationScenarioEditorController } from "./LiveSimulationScenarioEditorController";
import {
	type ReviewedScenarioDraft,
	ScenarioReviewFacts,
	SimulationScenarioSourceReviewCard,
} from "./SimulationScenarioSourceReviewCard";

describe("SimulationScenarioSourceReviewCard", () => {
	it("keeps both source journeys and preparation locked before exact certification", () => {
		const controller = new LiveSimulationScenarioEditorController(
			"PROJECT-UI-1",
			new RailDocument(),
		);
		try {
			const markup = renderToStaticMarkup(
				<SimulationScenarioSourceReviewCard
					controller={controller}
					projectId="PROJECT-UI-1"
					readinessBinding={null}
					setStatus={vi.fn()}
					forceFileInputFallback
				/>,
			);

			expect(markup).toContain('data-phase="empty"');
			expect(markup).toContain('data-source-kind="NONE"');
			expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*LOAD TRANSFER PLAN/s);
			expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*LOAD REPLAY HISTORY/s);
			expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*PREPARE/s);
			expect(markup).toContain("Certify the exact current project source");
			expect(markup).not.toMatch(/>RUN</);
		} finally {
			controller.dispose();
		}
	});

	it("keeps the controller-owned source kind visible after local review state remounts", () => {
		const source = {
			sourceKind: "REPLAY_HISTORY" as const,
			manifestFingerprint: "manifest",
			certificateFingerprint: "certificate",
			readinessProfileId: "profile",
			runIdentityFingerprint: "run",
			serviceTimingInputFingerprint: "timing",
			resourceRunInputFingerprint: "resources",
		};
		const controller = {
			subscribe: () => () => undefined,
			getState: () => ({
				projectId: "PROJECT-UI-1",
				source: {
					sourceKind: "REPLAY_HISTORY" as const,
					manifestFingerprint: "manifest",
					runAssetFingerprint: "asset",
					inputRecordCount: 2,
					acceptedRecordCount: 2,
					rejectedRecordCount: 0,
					issuesTruncated: false,
				},
				session: { phase: "PREPARING" as const, generation: 1, source },
				authorization: null,
			}),
		} as unknown as LiveSimulationScenarioEditorController;

		const markup = renderToStaticMarkup(
			<SimulationScenarioSourceReviewCard
				controller={controller}
				projectId="PROJECT-UI-1"
				readinessBinding={null}
				setStatus={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="preparing"');
		expect(markup).toContain('data-source-kind="REPLAY_HISTORY"');
		expect(markup).toMatch(/<button[^>]*data-selected="true"[^>]*>.*LOAD REPLAY HISTORY/s);
	});

	it("renders only one bounded canonical record page during local review", () => {
		const records = Array.from({ length: 10 }, (_, index) => ({
			sourceOrdinal: index,
			transferId: `PLAN-${index}`,
			releaseTimeMicroseconds: index * 1_000,
			loadId: `LOAD-${index}`,
			sourcePortId: index + 1,
			destinationPortId: index + 2,
		}));
		const manifest = compileSimulationTransferPlanManifest({
			manifestId: "PLAN-UI-REVIEW",
			adapterId: "PUBLIC-UI-TEST",
			adapterVersion: 1,
			mappingVersion: 1,
			inputRecordCount: records.length,
			rejectedRecordCount: 0,
			rejectionIssues: [],
			issuesTruncated: false,
			records,
		});
		const review = {
			projectId: "PROJECT-UI-1",
			certificateFingerprint: "certificate",
			manifest,
			draft: {
				schemaVersion: 1,
				source: {
					sourceKind: "TRANSFER_PLAN",
					manifestId: manifest.manifestId,
					mappingVersion: 1,
					records,
				},
				serviceTimingInput: { eqProcessTimings: [] },
				resourceRunInput: { eqResources: [], initialStorageLoads: [] },
			},
		} satisfies ReviewedScenarioDraft;

		const markup = renderToStaticMarkup(<ScenarioReviewFacts review={review} />);

		expect(markup).toContain('data-window-start="0"');
		expect(markup).toContain('data-window-end="8"');
		expect(markup).toContain('data-record-count="10"');
		expect(markup).toContain("PLAN-0");
		expect(markup).toContain("PLAN-7");
		expect(markup).not.toContain("PLAN-8");
		expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*PREVIOUS/s);
		expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>NEXT/s);
	});
});
