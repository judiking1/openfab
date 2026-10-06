import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaticFabSemanticBankDeleteDialog } from "./StaticFabSemanticBankDeleteDialog";
import {
	createStaticFabSemanticBankDeleteSession,
	reduceStaticFabSemanticBankDeleteSession,
	type StaticFabSemanticBankDeleteEvidenceView,
	type StaticFabSemanticBankDeleteSession,
	type StaticFabSemanticBankDeleteSessionAction,
	staticFabSemanticBankDeleteSessionCanApply,
} from "./StaticFabSemanticBankDeleteSession";

const start = (): StaticFabSemanticBankDeleteSession =>
	createStaticFabSemanticBankDeleteSession({
		bankOrganizationId: 3,
		bankName: "Bank C",
		requestSequence: 1,
	});
const evidence: StaticFabSemanticBankDeleteEvidenceView = {
	checks: [{ label: "다른 조직·무소속 항목", value: "보존 확인" }],
	source: [{ label: "레일 연결 영역", value: 2 }],
	prospective: [{ label: "레일 연결 영역", value: 1 }],
};
const readyAction = (): Extract<
	StaticFabSemanticBankDeleteSessionAction,
	{ type: "ANALYSIS_READY" }
> => ({
	type: "ANALYSIS_READY",
	requestSequence: 1,
	reason: "삭제 범위와 남는 FAB의 검증을 마쳤습니다.",
	review: {
		action: "DELETE",
		bankOrganizationId: 3,
		parentFabOrganizationId: 1,
		planFingerprint: "synthetic-bank-delete-plan",
		removed: [
			{ label: "Bank·하위 조직", count: 20, samples: [3, 4, 5, 6, 7, 8] },
			{ label: "Port", count: 6, samples: [1, 2] },
		],
		preserved: [{ label: "다른 조직", count: 1, samples: ["FAB 1"] }],
	},
	evidence,
});
const ready = (): StaticFabSemanticBankDeleteSession =>
	reduceStaticFabSemanticBankDeleteSession(start(), readyAction());
const render = (session: StaticFabSemanticBankDeleteSession): string =>
	renderToStaticMarkup(
		<StaticFabSemanticBankDeleteDialog
			session={session}
			onAnalyze={vi.fn()}
			onCancel={vi.fn()}
			onRetry={vi.fn()}
			onApply={vi.fn()}
		/>,
	);

describe("Bank delete review session", () => {
	it("does not make analysis or an incomplete review applicable", () => {
		expect(staticFabSemanticBankDeleteSessionCanApply(start())).toBe(false);
		expect(staticFabSemanticBankDeleteSessionCanApply({ ...ready(), evidence: null })).toBe(false);
		expect(reduceStaticFabSemanticBankDeleteSession(start(), { type: "APPLY" }).phase).toBe(
			"analyzing",
		);
	});
	it("ignores stale analysis and a response for another Bank", () => {
		const state = start();
		const response = readyAction();
		expect(
			reduceStaticFabSemanticBankDeleteSession(state, { ...response, requestSequence: 2 }),
		).toBe(state);
		expect(
			reduceStaticFabSemanticBankDeleteSession(state, {
				...response,
				review: { ...response.review, bankOrganizationId: 4 },
			}),
		).toBe(state);
	});
	it("invalidates readiness and clears old evidence before retry", () => {
		const rejected = reduceStaticFabSemanticBankDeleteSession(ready(), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "연결 관계가 변경되었습니다.",
		});
		expect(staticFabSemanticBankDeleteSessionCanApply(rejected)).toBe(false);
		expect(
			reduceStaticFabSemanticBankDeleteSession(rejected, { type: "RETRY", requestSequence: 1 }),
		).toBe(rejected);
		const retry = reduceStaticFabSemanticBankDeleteSession(rejected, {
			type: "RETRY",
			requestSequence: 2,
		});
		expect(retry).toMatchObject({
			phase: "analyzing",
			requestSequence: 2,
			review: null,
			evidence: null,
		});
		expect(reduceStaticFabSemanticBankDeleteSession(retry, readyAction())).toBe(retry);
	});
	it("rejects a detach review even when the Bank and request match", () => {
		const state = start();
		const response = readyAction();
		const detachReview = {
			...response.review,
			action: "DETACH",
		} as unknown as typeof response.review;
		expect(
			reduceStaticFabSemanticBankDeleteSession(state, {
				...response,
				review: detachReview,
			}),
		).toBe(state);
	});
	it("allows a standalone Bank review without implying a parent connection cut", () => {
		const response = readyAction();
		const state = reduceStaticFabSemanticBankDeleteSession(start(), {
			...response,
			review: { ...response.review, parentFabOrganizationId: null },
		});
		expect(staticFabSemanticBankDeleteSessionCanApply(state)).toBe(true);
		expect(render(state)).not.toContain("상위 FAB 연결 정리");
		expect(render(ready())).toContain("상위 FAB 연결 정리와 Bank 삭제를 한 번에 적용합니다.");
	});
	it("accepts Apply once and never returns to ready from a late response", () => {
		const applying = reduceStaticFabSemanticBankDeleteSession(ready(), { type: "APPLY" });
		expect(applying.phase).toBe("applying");
		expect(reduceStaticFabSemanticBankDeleteSession(applying, { type: "APPLY" })).toBe(applying);
		expect(reduceStaticFabSemanticBankDeleteSession(applying, readyAction())).toBe(applying);
		expect(staticFabSemanticBankDeleteSessionCanApply(applying)).toBe(false);
	});
	it("requires fresh review after an application rejection", () => {
		const applying = reduceStaticFabSemanticBankDeleteSession(ready(), { type: "APPLY" });
		const rejected = reduceStaticFabSemanticBankDeleteSession(applying, {
			type: "APPLICATION_REJECTED",
			reason: "프로젝트가 변경되었습니다.",
		});
		expect(rejected.phase).toBe("rejected");
		expect(reduceStaticFabSemanticBankDeleteSession(rejected, { type: "APPLY" })).toBe(rejected);
	});
});

describe("Bank delete review dialog", () => {
	it("starts with disabled Apply and one live owner before explicit Delete", () => {
		const markup = render(start());
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup.match(/aria-live=/g)).toHaveLength(1);
		expect(markup).toMatch(/data-testid="bank-delete-apply"[^>]*disabled/);
		expect(markup.indexOf('data-testid="bank-delete-cancel"')).toBeLessThan(
			markup.indexOf('data-testid="bank-delete-apply"'),
		);
		expect(markup).toContain("Bank 삭제");
		expect(markup).not.toContain("분리 적용");
	});
	it("separates preserved/removed impact and Worker evidence with bounded exact totals", () => {
		const markup = render(ready());
		expect(markup).toContain("보존");
		expect(markup).toContain("삭제 예정");
		expect(markup).toContain("Worker 검증 결과");
		expect(markup).toContain("3, 4, 5, 6");
		expect(markup).toContain("외 16개");
		expect(markup).not.toContain("5, 6, 7");
		expect(markup).toContain("외 4개");
		expect(markup).not.toMatch(/data-testid="bank-delete-apply"[^>]*disabled/);
	});
	it("shows a rejection reason and Retry while keeping Apply disabled", () => {
		const markup = render(
			reduceStaticFabSemanticBankDeleteSession(start(), {
				type: "ANALYSIS_REJECTED",
				requestSequence: 1,
				reason: "장비 그룹이 삭제 범위 밖의 Port도 포함합니다.",
			}),
		);
		expect(markup).toContain("장비 그룹이 삭제 범위 밖의 Port도 포함합니다.");
		expect(markup).toContain('data-testid="bank-delete-retry"');
		expect(markup).toMatch(/data-testid="bank-delete-apply"[^>]*disabled/);
	});
});

describe("named impact summary", () => {
	it("puts the changed impact first and keeps bounded raw evidence in closed details", () => {
		const action = readyAction();
		const session = reduceStaticFabSemanticBankDeleteSession(start(), {
			...action,
			review: {
				...action.review,
				organizationLabels: { 1: "FAB North", 3: "Bank Etch", 4: "Bay Clean" },
			},
		});
		const html = render(session);
		const technical = html.indexOf('data-testid="semantic-review-technical-details"');
		const summary = html.slice(
			html.indexOf('data-testid="semantic-review-impact-summary"'),
			technical,
		);
		expect(summary).toContain("삭제되는 항목");
		expect(summary.indexOf('data-impact="removed"')).toBeLessThan(
			summary.indexOf('data-impact="preserved"'),
		);
		expect(summary).toContain("Bank Etch");
		expect(summary).toContain("조직 20개");
		expect(summary).toContain("Port 6개");
		expect(summary).not.toContain("3, 4, 5, 6");
		expect(html).toMatch(
			/<details[^>]*data-testid="semantic-review-technical-details"[^>]*><summary>수량·ID·좌표 상세/,
		);
		expect(
			html.slice(html.lastIndexOf("<details", technical), html.indexOf(">", technical)),
		).not.toContain("open=");
		expect(html.slice(technical)).toContain("3, 4, 5, 6");
		expect(html.slice(technical)).toContain("외 16개");
		expect(summary).toContain("Bay Clean");
		expect(summary).toContain("외 18개 조직");
		expect(staticFabSemanticBankDeleteSessionCanApply(session)).toBe(true);
	});
});
