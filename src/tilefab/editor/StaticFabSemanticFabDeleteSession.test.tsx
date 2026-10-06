import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaticFabSemanticFabDeleteDialog } from "./StaticFabSemanticFabDeleteDialog";
import {
	createStaticFabSemanticFabDeleteSession,
	reduceStaticFabSemanticFabDeleteSession,
	type StaticFabSemanticFabDeleteEvidenceView,
	type StaticFabSemanticFabDeleteSession,
	type StaticFabSemanticFabDeleteSessionAction,
	staticFabSemanticFabDeleteSessionCanApply,
} from "./StaticFabSemanticFabDeleteSession";

const start = (): StaticFabSemanticFabDeleteSession =>
	createStaticFabSemanticFabDeleteSession({
		fabOrganizationId: 3,
		fabName: "FAB C",
		requestSequence: 1,
	});
const evidence: StaticFabSemanticFabDeleteEvidenceView = {
	checks: [{ label: "다른 조직·무소속 항목", value: "보존 확인" }],
	source: [{ label: "레일 연결 영역", value: 2 }],
	prospective: [{ label: "레일 연결 영역", value: 1 }],
};
const readyAction = (): Extract<
	StaticFabSemanticFabDeleteSessionAction,
	{ type: "ANALYSIS_READY" }
> => ({
	type: "ANALYSIS_READY",
	requestSequence: 1,
	reason: "삭제 범위와 남는 FAB의 검증을 마쳤습니다.",
	review: {
		action: "DELETE",
		targetRole: "FAB",
		fabOrganizationId: 3,
		planFingerprint: "synthetic-fab-delete-plan",
		removed: [
			{ label: "FAB·하위 조직", count: 20, samples: [3, 4, 5, 6, 7, 8] },
			{ label: "Port", count: 6, samples: [1, 2] },
		],
		preserved: [{ label: "다른 조직", count: 1, samples: ["FAB 1"] }],
	},
	evidence,
});
const ready = (): StaticFabSemanticFabDeleteSession =>
	reduceStaticFabSemanticFabDeleteSession(start(), readyAction());
const render = (session: StaticFabSemanticFabDeleteSession): string =>
	renderToStaticMarkup(
		<StaticFabSemanticFabDeleteDialog
			session={session}
			onAnalyze={vi.fn()}
			onCancel={vi.fn()}
			onRetry={vi.fn()}
			onApply={vi.fn()}
		/>,
	);

describe("Fab delete review session", () => {
	it("does not make analysis or an incomplete review applicable", () => {
		expect(staticFabSemanticFabDeleteSessionCanApply(start())).toBe(false);
		expect(staticFabSemanticFabDeleteSessionCanApply({ ...ready(), evidence: null })).toBe(false);
		expect(reduceStaticFabSemanticFabDeleteSession(start(), { type: "APPLY" }).phase).toBe(
			"analyzing",
		);
	});
	it("ignores stale analysis and a response for another Fab", () => {
		const state = start();
		const response = readyAction();
		expect(
			reduceStaticFabSemanticFabDeleteSession(state, { ...response, requestSequence: 2 }),
		).toBe(state);
		expect(
			reduceStaticFabSemanticFabDeleteSession(state, {
				...response,
				review: { ...response.review, fabOrganizationId: 4 },
			}),
		).toBe(state);
	});
	it("invalidates readiness and clears old evidence before retry", () => {
		const rejected = reduceStaticFabSemanticFabDeleteSession(ready(), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "연결 관계가 변경되었습니다.",
		});
		expect(staticFabSemanticFabDeleteSessionCanApply(rejected)).toBe(false);
		expect(
			reduceStaticFabSemanticFabDeleteSession(rejected, { type: "RETRY", requestSequence: 1 }),
		).toBe(rejected);
		const retry = reduceStaticFabSemanticFabDeleteSession(rejected, {
			type: "RETRY",
			requestSequence: 2,
		});
		expect(retry).toMatchObject({
			phase: "analyzing",
			requestSequence: 2,
			review: null,
			evidence: null,
		});
		expect(reduceStaticFabSemanticFabDeleteSession(retry, readyAction())).toBe(retry);
	});
	it("rejects a detach review even when the Fab and request match", () => {
		const state = start();
		const response = readyAction();
		const detachReview = {
			...response.review,
			action: "DETACH",
		} as unknown as typeof response.review;
		expect(
			reduceStaticFabSemanticFabDeleteSession(state, {
				...response,
				review: detachReview,
			}),
		).toBe(state);
	});
	it("rejects Bank Delete review even with a matching id and request", () => {
		const state = start();
		const response = readyAction();
		expect(
			reduceStaticFabSemanticFabDeleteSession(state, {
				...response,
				review: { ...response.review, targetRole: "BAY_BANK" } as unknown as typeof response.review,
			}),
		).toBe(state);
	});
	it("explains an empty remaining canvas only when no authored content remains", () => {
		const response = readyAction();
		const state = reduceStaticFabSemanticFabDeleteSession(start(), {
			...response,
			review: { ...response.review, preserved: [{ label: "조직 전체", count: 0, samples: [] }] },
		});
		expect(staticFabSemanticFabDeleteSessionCanApply(state)).toBe(true);
		expect(render(state)).toContain("삭제 후 캔버스에 남는 조직·레일·장비·Port가 없습니다.");
		expect(render(ready())).not.toContain("삭제 후 캔버스에 남는");
		expect(render(ready())).toContain("다른 최상위 FAB와 무소속 항목은 보존합니다.");
	});
	it("accepts Apply once and never returns to ready from a late response", () => {
		const applying = reduceStaticFabSemanticFabDeleteSession(ready(), { type: "APPLY" });
		expect(applying.phase).toBe("applying");
		expect(reduceStaticFabSemanticFabDeleteSession(applying, { type: "APPLY" })).toBe(applying);
		expect(reduceStaticFabSemanticFabDeleteSession(applying, readyAction())).toBe(applying);
		expect(staticFabSemanticFabDeleteSessionCanApply(applying)).toBe(false);
	});
	it("requires fresh review after an application rejection", () => {
		const applying = reduceStaticFabSemanticFabDeleteSession(ready(), { type: "APPLY" });
		const rejected = reduceStaticFabSemanticFabDeleteSession(applying, {
			type: "APPLICATION_REJECTED",
			reason: "프로젝트가 변경되었습니다.",
		});
		expect(rejected.phase).toBe("rejected");
		expect(reduceStaticFabSemanticFabDeleteSession(rejected, { type: "APPLY" })).toBe(rejected);
	});
});

describe("Fab delete review dialog", () => {
	it("starts with disabled Apply and one live owner before explicit Delete", () => {
		const markup = render(start());
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup.match(/aria-live=/g)).toHaveLength(1);
		expect(markup).toMatch(/data-testid="fab-delete-apply"[^>]*disabled/);
		expect(markup.indexOf('data-testid="fab-delete-cancel"')).toBeLessThan(
			markup.indexOf('data-testid="fab-delete-apply"'),
		);
		expect(markup).toContain("FAB 삭제");
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
		expect(markup).not.toMatch(/data-testid="fab-delete-apply"[^>]*disabled/);
	});
	it("shows a rejection reason and Retry while keeping Apply disabled", () => {
		const markup = render(
			reduceStaticFabSemanticFabDeleteSession(start(), {
				type: "ANALYSIS_REJECTED",
				requestSequence: 1,
				reason: "장비 그룹이 삭제 범위 밖의 Port도 포함합니다.",
			}),
		);
		expect(markup).toContain("장비 그룹이 삭제 범위 밖의 Port도 포함합니다.");
		expect(markup).toContain('data-testid="fab-delete-retry"');
		expect(markup).toMatch(/data-testid="fab-delete-apply"[^>]*disabled/);
	});
});

describe("named impact summary", () => {
	it("puts the changed impact first and keeps bounded raw evidence in closed details", () => {
		const action = readyAction();
		const session = reduceStaticFabSemanticFabDeleteSession(start(), {
			...action,
			review: {
				...action.review,
				organizationLabels: { 1: "FAB North", 3: "FAB Etch", 4: "Bay Clean" },
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
		expect(summary).toContain("FAB Etch");
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
		expect(staticFabSemanticFabDeleteSessionCanApply(session)).toBe(true);
	});
});
