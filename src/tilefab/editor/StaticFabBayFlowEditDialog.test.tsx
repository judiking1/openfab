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
		expect(markup).toContain("변경 가능 여부를 확인하고 있습니다");
		expect(markup).toMatch(/data-testid="bay-flow-edit-cancel"[^>]*data-initial-focus="true"/);
		expect(markup).toMatch(/data-testid="bay-flow-edit-apply"[^>]*disabled/);
		expect(markup).not.toContain("autofocus");
	});

	it("shows a bounded exact replacement review and equal Worker topology", () => {
		const markup = renderDialog(readySession());

		expect(markup).toContain('data-phase="ready"');
		expect(markup).toContain("ALTERNATING");
		expect(markup).toContain("CO-ROTATING");
		expect(markup).toContain("92개 제거");
		expect(markup).toContain("92개 추가");
		expect(markup).toContain("유지하는 항목");
		expect(markup).toContain(
			"Bay와 Process Loop, Bank 연결, 외부 진입·진출구, 외곽 범위, 장비를 유지합니다.",
		);
		expect(markup).toContain("연결 구조 검증");
		expect(markup).toMatch(/<details[^>]*data-testid="bay-flow-edit-details"/);
		expect(markup).not.toMatch(/<details[^>]*open/);
		expect(markup).toContain("레일·검증 세부 정보");
		expect(markup).toContain("열린 끝점, 위험 분기, 잘못된 경로");
		expect(markup).not.toMatch(/data-testid="bay-flow-edit-apply"[^>]*disabled/);
	});

	it("does not certify partial evidence on a rejected command", () => {
		const rejected = reduceStaticFabBayFlowEditSession(analyzingSession(), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "An external gateway changed.",
			review: reviewFixture(),
			sourceEvidence: evidence(),
			prospectiveEvidence: { ...evidence(), physicalPathCount: 3699, physicalOpenPathCount: 2 },
			timings: null,
		});
		const markup = renderDialog(rejected);
		expect(markup).toContain("An external gateway changed.");
		expect(markup).toContain("검증 미완료 · 적용 불가");
		expect(markup).toContain("3,700 → 3,699");
		expect(markup).toContain("0 → 2");
		expect(markup).not.toContain("변경 전후 개수 동일");
		expect(markup).not.toContain("문제 0건");
		expect(markup).toMatch(/data-testid="bay-flow-edit-apply"[^>]*disabled/);
	});

	it("bounds connector identity samples", () => {
		expect(STATIC_FAB_BAY_FLOW_EDIT_DETAIL_LIMIT).toBe(4);
		const review = reviewFixture({
			connectorBankToBayDirectedEdgeKeys: Object.freeze(["0:0>1:0", "1:0>2:0", "2:0>3:0"]),
			connectorBayToBankDirectedEdgeKeys: Object.freeze(["3:1>2:1", "2:1>1:1", "1:1>0:1"]),
		});
		const markup = renderDialog(readySession(review));

		expect(markup).toContain("0:0&gt;1:0, 1:0&gt;2:0, 2:0&gt;3:0, 3:1&gt;2:1 외 2개");
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
		expect(renderDialog(rejected)).toContain("변경할 수 없습니다");
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
