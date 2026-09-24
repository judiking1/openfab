import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StaticFabSemanticBayMutationReview } from "../core/StaticFabSemanticBayMutation";
import type { StaticFabSemanticBayMutationTopologyEvidence } from "../worker/StaticFabSemanticBayMutationProtocol";
import {
	STATIC_FAB_SEMANTIC_BAY_MUTATION_DETAIL_LIMIT,
	StaticFabSemanticBayMutationDialog,
} from "./StaticFabSemanticBayMutationDialog";
import {
	createStaticFabSemanticBayMutationSession,
	reduceStaticFabSemanticBayMutationSession,
	type StaticFabSemanticBayMutationSession,
} from "./StaticFabSemanticBayMutationSession";

describe("StaticFabSemanticBayMutationDialog", () => {
	it("renders the analyzing phase as a modal with CANCEL as its first-focus command", () => {
		const markup = renderDialog(analyzingSession("DISCONNECT"));

		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup).toContain('data-testid="semantic-bay-command-dialog"');
		expect(markup).toContain('data-command="disconnect-bay"');
		expect(markup).toContain('data-action="DISCONNECT"');
		expect(markup).toContain('data-phase="analyzing"');
		expect(markup).toContain("변경 영향을 검토하고 있습니다");
		expect(markup).toMatch(
			/data-testid="semantic-bay-command-cancel"[^>]*data-initial-focus="true"/,
		);
		expect(markup).toMatch(/data-testid="semantic-bay-command-apply"[^>]*disabled/);
		expect(markup).not.toContain("autofocus");
	});

	it("uses Disconnect-specific preserved and removed wording with relative Worker evidence", () => {
		const markup = renderDialog(readySession("DISCONNECT", 3, 4));

		expect(markup).toContain('data-phase="ready"');
		expect(markup).toContain("내부 순환로 2개 · 레일 모듈 18개");
		expect(markup).toContain("Bay 내부 구성");
		expect(markup).toContain("Bank와 이어지는 연결 레일·상위 소속");
		expect(markup).toContain("현재·예상 지도의 경로 조건 충족");
		expect(markup).toContain("연결 구역 Δ+1 · 물리 구역 Δ+1 · DISCONNECT");
		expect(markup).toContain("연결 검증 완료");
		expect(markup).toContain("변경 대상");
		expect(markup).toContain("경로 후보의 유무만으로 적용을 허용하지 않습니다");
		expect(markup).not.toMatch(/data-testid="semantic-bay-command-apply"[^>]*disabled/);
	});

	it("uses Delete-specific removal wording and keeps retained circulation a planner candidate", () => {
		const markup = renderDialog(readySession("DELETE", 3, 3));

		expect(markup).toContain('data-command="delete-bay"');
		expect(markup).toContain('data-review-action="DELETE"');
		expect(markup).toContain('data-review-equipment-group-count="2"');
		expect(markup).toContain('data-review-port-count="4"');
		expect(markup).toContain("내부 순환로 2개 · 레일 모듈 18개");
		expect(markup).toContain("장비 2개 · 포트 4개");
		expect(markup).toContain("Bank 연결 1개도 함께 제거합니다");
		expect(markup).toContain("Bank의 방향 레일 340개를 유지합니다");
		expect(markup).toContain("Bank 순환 경로 후보: 있음");
		expect(markup).toContain("연결 구역 Δ+0 · 물리 구역 Δ+0 · DELETE");
	});

	it("bounds identity samples even when the exact review contains more rows", () => {
		expect(STATIC_FAB_SEMANTIC_BAY_MUTATION_DETAIL_LIMIT).toBe(4);
		const review = reviewFixture("DELETE");
		const session = readySession("DELETE", 1, 1, {
			...review,
			railModuleKeys: Object.freeze([
				"module:1",
				"module:2",
				"module:3",
				"module:4",
				"module:5",
				"module:6",
			]),
		});
		const markup = renderDialog(session);

		expect(markup).toContain("module:1, module:2, module:3, module:4 외 14개");
		expect(markup).not.toContain("module:5");
		expect(markup).not.toContain("module:6");
	});

	it("derives omitted identity count from the exact review total rather than the compact sample", () => {
		const compactKeys = Object.freeze(
			Array.from({ length: 256 }, (_, index) => `sampled-module:${index + 1}`),
		);
		const rejected = reduceStaticFabSemanticBayMutationSession(analyzingSession("DELETE"), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "Prospective topology was rejected after bounded review sampling.",
			review: {
				...reviewFixture("DELETE"),
				railModuleCount: 10_000,
				railModuleKeys: compactKeys,
			},
			sourceEvidence: topologyEvidenceFixture(2),
			prospectiveEvidence: null,
			timings: { planningMilliseconds: 2, validationMilliseconds: 3 },
		});
		const markup = renderDialog(rejected);

		expect(markup).toContain(
			"sampled-module:1, sampled-module:2, sampled-module:3, sampled-module:4 외 9,996개",
		);
		expect(markup).not.toContain("외 252개");
		expect(markup).not.toContain("sampled-module:256");
	});

	it.each([
		["sourceEvidence", "authoredComponentsClosed"],
		["sourceEvidence", "physicalComponentsClosed"],
		["prospectiveEvidence", "authoredComponentsClosed"],
		["prospectiveEvidence", "physicalComponentsClosed"],
	] as const)("never labels failed %s.%s as closed", (side, flag) => {
		const sourceEvidence = topologyEvidenceFixture(2);
		const prospectiveEvidence = topologyEvidenceFixture(3);
		const session = reduceStaticFabSemanticBayMutationSession(analyzingSession("DISCONNECT"), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "Closure failed.",
			review: reviewFixture("DISCONNECT"),
			sourceEvidence,
			prospectiveEvidence,
			[side]: {
				...(side === "sourceEvidence" ? sourceEvidence : prospectiveEvidence),
				[flag]: false,
			},
			timings: null,
		});
		const markup = renderDialog(session);
		expect(markup).toContain('data-closed="false"');
		expect(markup).toContain("연결 또는 물리 경로 검토 실패");
		expect(markup).toContain("검토 자료의 연결 또는 물리 경로 조건 미충족");
		expect(markup).not.toContain("현재·예상 지도의 경로 조건 충족");
		expect(markup).not.toContain("연결 검증 완료");
		expect(markup).toContain("검토한 변경 대상 · 적용되지 않음");
		expect(markup).not.toContain('data-testid="semantic-bay-command-apply"');
		expect(markup).toContain('data-testid="semantic-bay-command-retry"');
	});

	it("keeps stale successful evidence diagnostic after application is rejected", () => {
		const applying = reduceStaticFabSemanticBayMutationSession(readySession("DELETE", 2, 2), {
			type: "APPLY",
		});
		const rejected = reduceStaticFabSemanticBayMutationSession(applying, {
			type: "APPLICATION_REJECTED",
			reason: "Source changed.",
		});
		const markup = renderDialog(rejected);
		expect(markup).toContain("현재 작업의 적용을 허용하는 결과가 아닙니다");
		expect(markup).toContain("참고용 경로 검토 수치");
		expect(markup).not.toContain("연결 검증 완료");
		expect(markup).not.toContain('data-testid="semantic-bay-command-apply"');
	});

	it("keeps detailed evidence collapsed after the impact summary", () => {
		const markup = renderDialog(readySession("DELETE", 2, 2));
		expect(markup).not.toMatch(/<details[^>]*\sopen/);
		expect(markup.indexOf("없어지는 항목")).toBeLessThan(markup.indexOf("검토 상세"));
		expect(markup).toContain("실행 취소 한 번");
		expect(markup).not.toContain('data-testid="semantic-bay-command-retry"');
	});

	it("does not turn diagnostic zero counts into an approved removal summary", () => {
		const rejected = reduceStaticFabSemanticBayMutationSession(analyzingSession("DISCONNECT"), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "Already detached.",
			review: {
				...reviewFixture("DISCONNECT"),
				issueCode: "ALREADY_DISCONNECTED",
				bankOrganizationId: null,
				incidentConnectorCount: 0,
			},
			sourceEvidence: topologyEvidenceFixture(2),
			prospectiveEvidence: null,
			timings: null,
		});
		const markup = renderDialog(rejected);
		expect(markup).toContain("이미 Bank에서 분리된 Bay입니다");
		expect(markup).not.toContain("연결 0개를 제거");
		expect(markup).not.toContain('data-impact="removed"');
		expect(markup).not.toContain("Bank 순환 경로 후보: 없음");
		expect(markup).not.toContain("식별자 표본 없음 외 1개");
		expect(markup).not.toContain("실행 취소 한 번");
		expect(markup.indexOf("Already detached.")).toBeLessThan(markup.indexOf("<details"));
	});

	it("renders rejected and applying as the same bounded four-phase command surface", () => {
		const rejected = reduceStaticFabSemanticBayMutationSession(analyzingSession("DELETE"), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "A connector-attached port blocks this command.",
			review: reviewFixture("DELETE"),
			sourceEvidence: topologyEvidenceFixture(2),
			prospectiveEvidence: null,
			timings: { planningMilliseconds: 2, validationMilliseconds: 1 },
		});
		const applying = reduceStaticFabSemanticBayMutationSession(readySession("DELETE", 2, 2), {
			type: "APPLY",
		});

		expect(renderDialog(rejected)).toContain('data-phase="rejected"');
		expect(renderDialog(rejected)).toContain("변경을 적용할 수 없습니다");
		expect(renderDialog(rejected)).toContain("A connector-attached port blocks this command.");
		expect(renderDialog(applying)).toContain('data-phase="applying"');
		expect(renderDialog(applying)).toContain('aria-busy="true"');
		expect(renderDialog(applying)).toContain("변경을 적용하고 있습니다");
		expect(renderDialog(applying)).toMatch(
			/data-testid="semantic-bay-command-cancel"[^>]*disabled/,
		);
		expect(renderDialog(applying)).not.toContain('data-testid="semantic-bay-command-retry"');
	});
});

function renderDialog(session: StaticFabSemanticBayMutationSession): string {
	return renderToStaticMarkup(
		<StaticFabSemanticBayMutationDialog
			session={session}
			onAnalyze={vi.fn()}
			onCancel={vi.fn()}
			onRetry={vi.fn()}
			onApply={vi.fn()}
		/>,
	);
}

function analyzingSession(action: "DISCONNECT" | "DELETE") {
	return createStaticFabSemanticBayMutationSession({
		action,
		bayOrganizationId: 12,
		bayName: "Bay 12",
	});
}

function readySession(
	action: "DISCONNECT" | "DELETE",
	sourceComponents: number,
	resultComponents: number,
	review: StaticFabSemanticBayMutationReview = reviewFixture(action),
) {
	return reduceStaticFabSemanticBayMutationSession(analyzingSession(action), {
		type: "ANALYSIS_READY",
		requestSequence: 1,
		reason: "Exact prospective topology verified.",
		review,
		sourceEvidence: topologyEvidenceFixture(sourceComponents),
		prospectiveEvidence: topologyEvidenceFixture(resultComponents),
		timings: { planningMilliseconds: 4.5, validationMilliseconds: 8.25 },
	});
}

function reviewFixture(action: "DISCONNECT" | "DELETE"): StaticFabSemanticBayMutationReview {
	return Object.freeze({
		version: 1,
		action,
		bayOrganizationId: 12,
		bayName: "Bay 12",
		bankOrganizationId: 2,
		removedOrganizationIds: action === "DELETE" ? Object.freeze([12, 13, 14]) : Object.freeze([]),
		processLoopOrganizationIds: Object.freeze([13, 14]),
		processLoopCount: 2,
		railModuleCount: 18,
		railModuleKeys: Object.freeze(["module:1", "module:2"]),
		bayDirectedEdgeCount: 88,
		incidentConnectorCount: 1,
		connectorDirectedEdgeCount: 24,
		connectorOutboundDirectedEdgeKeys: Object.freeze(["0,0:E"]),
		connectorReturnDirectedEdgeKeys: Object.freeze(["1,0:W"]),
		advancedSwitchCount: 0,
		equipmentGroupCount: action === "DELETE" ? 2 : 0,
		equipmentGroupIds: action === "DELETE" ? Object.freeze([8, 9]) : Object.freeze([]),
		portCount: action === "DELETE" ? 4 : 0,
		portIds: action === "DELETE" ? Object.freeze([21, 22, 23, 24]) : Object.freeze([]),
		remainingBankDirectedEdgeCount: 340,
		retainedCirculationCandidatePresent: true,
		circulationCertification: "PENDING_WORKER_CERTIFICATION",
		issueCode: null,
	});
}

function topologyEvidenceFixture(
	componentCount: number,
): StaticFabSemanticBayMutationTopologyEvidence {
	return Object.freeze({
		authoredCellCount: 120,
		authoredDirectedEdgeCount: 124,
		authoredStatus: componentCount === 1 ? "closed" : "disconnected",
		authoredComponentCount: componentCount,
		authoredStrongComponentCount: componentCount,
		authoredOpenTerminalCount: 0,
		authoredUnsafeJunctionCount: 0,
		authoredComponentsClosed: true,
		physicalValid: true,
		physicalPathCount: 126,
		physicalComponentCount: componentCount,
		physicalStrongComponentCount: componentCount,
		physicalOpenPathCount: 0,
		physicalInvalidPathCount: 0,
		physicalDiagnosticCount: 0,
		physicalTerminalCount: 0,
		physicalClearanceIssueCount: 0,
		physicalComponentsClosed: true,
	});
}
