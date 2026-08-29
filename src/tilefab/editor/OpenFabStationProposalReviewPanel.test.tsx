import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
	HydratedOpenFabStationProposalArtifact,
	OpenFabStationProposalRow,
} from "../compile/OpenFabStationProposalArtifact";
import { OpenFabStationProposalReviewPanel } from "./OpenFabStationProposalReviewPanel";
import { createOpenFabStationProposalReviewSession } from "./OpenFabStationProposalReviewSession";

describe("OpenFabStationProposalReviewPanel", () => {
	it("renders only one bounded typed-session row window for a 100k proposal", () => {
		const fixture = proposalFixture(100_000);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);

		const markup = renderToStaticMarkup(
			<OpenFabStationProposalReviewPanel
				sourceName="public-stations.csv"
				proposal={fixture.proposal}
				session={session}
				phase="reviewing"
				evaluation={null}
				attachmentSelection={null}
				attachmentRequestActive={false}
				error={null}
				onRequestAttachment={vi.fn()}
				onClearAttachment={vi.fn()}
				onEvaluate={vi.fn()}
				onApply={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-testid="openfab-station-proposal-review"');
		expect(markup).toContain('data-row-count="100000"');
		expect(markup).toContain('data-rendered-rows="16"');
		expect(markup).toContain("P0");
		expect(markup).toContain("P15");
		expect(markup).not.toContain("P16");
		expect(markup).not.toContain("P99999");
		expect(markup).toContain(" EVALUATE</button>");
		expect(markup).toMatch(
			/<button type="button" disabled=""><svg[\s\S]*?lucide-shield-check[\s\S]*? EVALUATE<\/button>/,
		);
		expect(fixture.readRow.mock.calls.length).toBeLessThanOrEqual(20);
	});

	it("keeps evaluation and Apply explicit while exposing source facts only in the UI", () => {
		const fixture = proposalFixture(1);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		const markup = renderToStaticMarkup(
			<OpenFabStationProposalReviewPanel
				sourceName="visible-only.map"
				proposal={fixture.proposal}
				session={session}
				phase="reviewing"
				evaluation={null}
				attachmentSelection={null}
				attachmentRequestActive={false}
				error={null}
				onRequestAttachment={vi.fn()}
				onClearAttachment={vi.fn()}
				onEvaluate={vi.fn()}
				onApply={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(markup).toContain("visible-only.map");
		expect(markup).toContain("PORT-FIRST IMPORT");
		expect(markup).toContain("SELECT EXACT SLOT");
		expect(markup).toContain("APPLY ONCE");
		expect(markup).toMatch(
			/data-testid="openfab-station-proposal-review"[^>]*data-capture-ready="false"/,
		);
	});
});

function proposalFixture(rowCount: number): {
	readonly proposal: HydratedOpenFabStationProposalArtifact;
	readonly readRow: ReturnType<typeof vi.fn<(row: number) => OpenFabStationProposalRow>>;
} {
	const readRow = vi.fn<(row: number) => OpenFabStationProposalRow>((row) => {
		if (!Number.isInteger(row) || row < 0 || row >= rowCount) throw new RangeError("row");
		return Object.freeze({
			identityScope: "PUBLIC_TEST",
			portKey: `P${row}`,
			secondaryAliases: Object.freeze([]),
			attachmentScope: "PUBLIC_TEST",
			attachmentAlias: `R${row}`,
			stationMillimeters: row,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			directionEvidence: "DECLARED",
			portType: "OHB",
			physicalGroupKey: "",
			physicalGroupKind: "UNRESOLVED",
			organizationAlias: "",
			sourceXMillimeters: null,
			sourceZMillimeters: null,
		});
	});
	const proposal = Object.freeze({
		kind: "hydrated-openfab-station-proposal-artifact" as const,
		schemaId: "openfab/station-proposal" as const,
		schemaVersion: 1 as const,
		sourceByteLength: 0,
		sourceRecordCount: rowCount,
		rowCount,
		rejectedRowCount: 0,
		unknownColumnCount: 0,
		semanticFingerprint: "public-test-semantic",
		snapshotFingerprint: "public-test-snapshot",
		readRow,
		issueCount: () => 0,
	}) satisfies HydratedOpenFabStationProposalArtifact;
	return Object.freeze({ proposal, readRow });
}
