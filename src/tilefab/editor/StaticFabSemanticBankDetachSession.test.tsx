import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaticFabSemanticBankDetachDialog } from "./StaticFabSemanticBankDetachDialog";
import {
	createStaticFabSemanticBankDetachSession,
	reduceStaticFabSemanticBankDetachSession,
	type StaticFabSemanticBankDetachEvidenceView,
	type StaticFabSemanticBankDetachSession,
	type StaticFabSemanticBankDetachSessionAction,
	staticFabSemanticBankDetachSessionCanApply,
} from "./StaticFabSemanticBankDetachSession";

const start = (): StaticFabSemanticBankDetachSession =>
	createStaticFabSemanticBankDetachSession({
		bankOrganizationId: 3,
		bankName: "Bank C",
		requestSequence: 1,
	});
const topology = Object.freeze({
	authoredCellCount: 120,
	authoredDirectedEdgeCount: 124,
	authoredComponentCount: 1,
	authoredStrongComponentCount: 1,
	authoredOpenTerminalCount: 0,
	authoredUnsafeJunctionCount: 0,
	authoredComponentsClosed: true,
	physicalPathCount: 60,
	physicalComponentCount: 1,
	physicalStrongComponentCount: 1,
	physicalOpenPathCount: 0,
	physicalInvalidPathCount: 0,
	physicalDiagnosticCount: 0,
	physicalTerminalCount: 0,
	physicalClearanceIssueCount: 0,
	physicalComponentsClosed: true,
	authoredPhysicalComponentMappingExact: true,
});
const region = Object.freeze({
	authoredComponentCount: 1,
	authoredStrongComponentCount: 1,
	physicalComponentCount: 1,
	physicalStrongComponentCount: 1,
	completeModuleCoverage: true,
	closed: true,
});
const evidence: StaticFabSemanticBankDetachEvidenceView = {
	source: topology,
	prospective: { ...topology, authoredComponentCount: 2, physicalComponentCount: 2 },
	selectedBank: region,
	retainedFab: region,
};
const readyAction = (): Extract<
	StaticFabSemanticBankDetachSessionAction,
	{ type: "ANALYSIS_READY" }
> => ({
	type: "ANALYSIS_READY",
	requestSequence: 1,
	reason: "현재 Bank와 남는 FAB의 검증을 마쳤습니다.",
	review: {
		bankOrganizationId: 3,
		parentFabOrganizationId: 1,
		planFingerprint: "synthetic-bank-detach-plan",
		preserved: [
			{ label: "Bank·하위 조직", count: 20, samples: [3, 4, 5, 6, 7, 8] },
			{ label: "Port", count: 6, samples: [1, 2] },
		],
		removed: [{ label: "상위 FAB 소속", count: 1, samples: ["FAB 1 → Bank 3"] }],
	},
	evidence,
});
const ready = (): StaticFabSemanticBankDetachSession =>
	reduceStaticFabSemanticBankDetachSession(start(), readyAction());
const render = (session: StaticFabSemanticBankDetachSession): string =>
	renderToStaticMarkup(
		<StaticFabSemanticBankDetachDialog
			session={session}
			onAnalyze={vi.fn()}
			onCancel={vi.fn()}
			onRetry={vi.fn()}
			onApply={vi.fn()}
		/>,
	);

describe("Bank detach review session", () => {
	it("does not make analysis or an incomplete review applicable", () => {
		expect(staticFabSemanticBankDetachSessionCanApply(start())).toBe(false);
		expect(staticFabSemanticBankDetachSessionCanApply({ ...ready(), evidence: null })).toBe(false);
		expect(reduceStaticFabSemanticBankDetachSession(start(), { type: "APPLY" }).phase).toBe(
			"analyzing",
		);
	});
	it("ignores stale analysis and a response for another Bank", () => {
		const state = start();
		const response = readyAction();
		expect(
			reduceStaticFabSemanticBankDetachSession(state, { ...response, requestSequence: 2 }),
		).toBe(state);
		expect(
			reduceStaticFabSemanticBankDetachSession(state, {
				...response,
				review: { ...response.review, bankOrganizationId: 4 },
			}),
		).toBe(state);
	});
	it("invalidates readiness and clears old evidence before retry", () => {
		const rejected = reduceStaticFabSemanticBankDetachSession(ready(), {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "연결 관계가 변경되었습니다.",
		});
		expect(staticFabSemanticBankDetachSessionCanApply(rejected)).toBe(false);
		expect(
			reduceStaticFabSemanticBankDetachSession(rejected, { type: "RETRY", requestSequence: 1 }),
		).toBe(rejected);
		const retry = reduceStaticFabSemanticBankDetachSession(rejected, {
			type: "RETRY",
			requestSequence: 2,
		});
		expect(retry).toMatchObject({
			phase: "analyzing",
			requestSequence: 2,
			review: null,
			evidence: null,
		});
		expect(reduceStaticFabSemanticBankDetachSession(retry, readyAction())).toBe(retry);
	});
	it("accepts Apply once and never returns to ready from a late response", () => {
		const applying = reduceStaticFabSemanticBankDetachSession(ready(), { type: "APPLY" });
		expect(applying.phase).toBe("applying");
		expect(reduceStaticFabSemanticBankDetachSession(applying, { type: "APPLY" })).toBe(applying);
		expect(reduceStaticFabSemanticBankDetachSession(applying, readyAction())).toBe(applying);
		expect(staticFabSemanticBankDetachSessionCanApply(applying)).toBe(false);
	});
	it("requires fresh review after an application rejection", () => {
		const applying = reduceStaticFabSemanticBankDetachSession(ready(), { type: "APPLY" });
		const rejected = reduceStaticFabSemanticBankDetachSession(applying, {
			type: "APPLICATION_REJECTED",
			reason: "프로젝트가 변경되었습니다.",
		});
		expect(rejected.phase).toBe("rejected");
		expect(reduceStaticFabSemanticBankDetachSession(rejected, { type: "APPLY" })).toBe(rejected);
	});
});

describe("Bank detach review dialog", () => {
	it("starts with disabled Apply and one live owner without Delete", () => {
		const markup = render(start());
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup.match(/aria-live=/g)).toHaveLength(1);
		expect(markup).toMatch(/data-testid="bank-detach-apply"[^>]*disabled/);
		expect(markup.indexOf('data-testid="bank-detach-cancel"')).toBeLessThan(
			markup.indexOf('data-testid="bank-detach-apply"'),
		);
		expect(markup).not.toContain("삭제");
	});
	it("separates preserved/removed impact and Worker evidence with bounded exact totals", () => {
		const markup = render(ready());
		expect(markup).toContain("보존");
		expect(markup).toContain("제거");
		expect(markup).toContain("Worker 검증 결과");
		expect(markup).toContain("3, 4, 5, 6");
		expect(markup).toContain("외 16개");
		expect(markup).not.toContain("5, 6, 7");
		expect(markup).toContain("외 4개");
		expect(markup).not.toMatch(/data-testid="bank-detach-apply"[^>]*disabled/);
	});
	it("shows a rejection reason and Retry while keeping Apply disabled", () => {
		const markup = render(
			reduceStaticFabSemanticBankDetachSession(start(), {
				type: "ANALYSIS_REJECTED",
				requestSequence: 1,
				reason: "제거할 연결에 Port가 있습니다.",
			}),
		);
		expect(markup).toContain("제거할 연결에 Port가 있습니다.");
		expect(markup).toContain('data-testid="bank-detach-retry"');
		expect(markup).toMatch(/data-testid="bank-detach-apply"[^>]*disabled/);
	});
});
