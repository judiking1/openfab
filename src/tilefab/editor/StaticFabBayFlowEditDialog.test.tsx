import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StaticFabBayFlowEditReview } from "../core/StaticFabBayFlowEdit";
import type { StaticFabBayFlowEditTopologyEvidence } from "../worker/StaticFabBayFlowEditProtocol";
import {
	STATIC_FAB_BAY_FLOW_EDIT_DETAIL_LIMIT,
	StaticFabBayFlowEditDialog,
} from "./StaticFabBayFlowEditDialog";
import {
	createStaticFabBayFlowEditSession,
	reduceStaticFabBayFlowEditSession,
	type StaticFabBayFlowEditSession,
} from "./StaticFabBayFlowEditSession";

describe("StaticFabBayFlowEditDialog", () => {
	it("renders deferred analysis as an accessible explicit-target modal", () => {
		const markup = renderDialog(analyzingSession());

		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup).toContain('data-command="edit-bay-flow"');
		expect(markup).toContain('data-target-pattern="co-rotating"');
		expect(markup).toContain('data-phase="analyzing"');
		expect(markup).toContain("ANALYZING EXACT SOURCE");
		expect(markup).toMatch(/data-testid="bay-flow-edit-cancel"[^>]*data-initial-focus="true"/);
		expect(markup).toMatch(/data-testid="bay-flow-edit-apply"[^>]*disabled/);
		expect(markup).not.toContain("autofocus");
	});

	it("shows a bounded exact replacement review and equal Worker topology", () => {
		const markup = renderDialog(readySession());

		expect(markup).toContain('data-phase="ready"');
		expect(markup).toContain("ALTERNATING");
		expect(markup).toContain("CO-ROTATING");
		expect(markup).toContain("92 removed");
		expect(markup).toContain("92 added directed edges");
		expect(markup).toContain("FIXED");
		expect(markup).toContain(
			"Bay identity, Process Loops, Bank relation, external gateway, envelope, and equipment remain authored.",
		);
		expect(markup).toContain("WORKER-CERTIFIED TOPOLOGY");
		expect(markup).toContain("zero open, unsafe, diagnostic");
		expect(markup).not.toMatch(/data-testid="bay-flow-edit-apply"[^>]*disabled/);
	});

	it("bounds connector identity samples", () => {
		expect(STATIC_FAB_BAY_FLOW_EDIT_DETAIL_LIMIT).toBe(4);
		const review = reviewFixture({
			connectorBankToBayDirectedEdgeKeys: Object.freeze(["0:0>1:0", "1:0>2:0", "2:0>3:0"]),
			connectorBayToBankDirectedEdgeKeys: Object.freeze(["3:1>2:1", "2:1>1:1", "1:1>0:1"]),
		});
		const markup = renderDialog(readySession(review));

		expect(markup).toContain("0:0&gt;1:0, 1:0&gt;2:0, 2:0&gt;3:0, 3:1&gt;2:1 +2 MORE");
		expect(markup).not.toContain("2:1&gt;1:1");
		expect(markup).not.toContain("1:1&gt;0:1");
	});

	it("keeps rejected and applying phases on the same bounded command surface", () => {
		const rejected = reduceStaticFabBayFlowEditSession(analyzingSession(), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "The selected Bay is not one exact Twin module.",
			review: null,
			sourceEvidence: null,
			prospectiveEvidence: null,
			timings: null,
		});
		const applying = reduceStaticFabBayFlowEditSession(readySession(), { type: "APPLY" });

		expect(renderDialog(rejected)).toContain('data-phase="rejected"');
		expect(renderDialog(rejected)).toContain("COMMAND BLOCKED");
		expect(renderDialog(applying)).toContain('data-phase="applying"');
		expect(renderDialog(applying)).toContain('aria-busy="true"');
		expect(renderDialog(applying)).toMatch(/data-testid="bay-flow-edit-cancel"[^>]*disabled/);
	});
});

function renderDialog(session: StaticFabBayFlowEditSession): string {
	return renderToStaticMarkup(
		<StaticFabBayFlowEditDialog
			session={session}
			onAnalyze={vi.fn()}
			onCancel={vi.fn()}
			onApply={vi.fn()}
		/>,
	);
}

function analyzingSession(): StaticFabBayFlowEditSession {
	return createStaticFabBayFlowEditSession({
		bayOrganizationId: 7,
		bayName: "Bay 7",
		targetInternalFlowPattern: "co-rotating",
	});
}

function readySession(
	review: StaticFabBayFlowEditReview = reviewFixture(),
): StaticFabBayFlowEditSession {
	return reduceStaticFabBayFlowEditSession(analyzingSession(), {
		type: "ANALYSIS_READY",
		requestSequence: 1,
		reason: "Exact flow target certified.",
		review,
		sourceEvidence: evidence(),
		prospectiveEvidence: evidence(),
		timings: { planningMilliseconds: 4.5, validationMilliseconds: 8.25 },
	});
}

function reviewFixture(
	override: Partial<StaticFabBayFlowEditReview> = {},
): StaticFabBayFlowEditReview {
	return Object.freeze({
		version: 1,
		bayOrganizationId: 7,
		bayName: "Bay 7",
		bankOrganizationId: 2,
		processLoopOrganizationIds: Object.freeze([8, 9] as const),
		sourceInternalFlowPattern: "alternating",
		targetInternalFlowPattern: "co-rotating",
		sourceAuthoredProjectionFingerprint: "source",
		targetAuthoredProjectionFingerprint: "target",
		sourceSpecificationAliasCount: 3,
		sourceDirectedEdgeCount: 300,
		targetDirectedEdgeCount: 300,
		removedDirectedEdgeCount: 92,
		addedDirectedEdgeCount: 92,
		changedCellCount: 96,
		changedOrganizationIds: Object.freeze([7, 8, 9]),
		incidentConnectorCount: 1,
		connectorBankToBayDirectedEdgeKeys: Object.freeze(["0:0>1:0"]),
		connectorBayToBankDirectedEdgeKeys: Object.freeze(["1:1>0:1"]),
		shellCertification: "PENDING_WORKER_CERTIFICATION",
		externalGatewayCertification: "PENDING_WORKER_CERTIFICATION",
		topologyCertification: "PENDING_WORKER_CERTIFICATION",
		issueCode: null,
		...override,
	});
}

function evidence(): StaticFabBayFlowEditTopologyEvidence {
	return Object.freeze({
		authoredCellCount: 3_592,
		authoredDirectedEdgeCount: 3_632,
		authoredStatus: "closed",
		authoredComponentCount: 1,
		authoredStrongComponentCount: 1,
		authoredOpenTerminalCount: 0,
		authoredUnsafeJunctionCount: 0,
		authoredComponentsClosed: true,
		physicalValid: true,
		physicalPathCount: 3_700,
		physicalComponentCount: 1,
		physicalStrongComponentCount: 1,
		physicalOpenPathCount: 0,
		physicalInvalidPathCount: 0,
		physicalDiagnosticCount: 0,
		physicalTerminalCount: 0,
		physicalClearanceIssueCount: 0,
		physicalComponentsClosed: true,
	});
}
