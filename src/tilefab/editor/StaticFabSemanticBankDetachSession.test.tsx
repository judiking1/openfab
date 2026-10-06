import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	copyStaticFabOrganizationRecord,
	type StaticFabOrganizationKind,
} from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { StaticFabSemanticBankDetachDialog } from "./StaticFabSemanticBankDetachDialog";
import {
	createStaticFabSemanticBankDetachSession,
	reduceStaticFabSemanticBankDetachSession,
	type StaticFabSemanticBankDetachEvidenceView,
	type StaticFabSemanticBankDetachSession,
	type StaticFabSemanticBankDetachSessionAction,
	staticFabSemanticBankDetachSessionCanApply,
} from "./StaticFabSemanticBankDetachSession";
import {
	captureStaticFabReviewOrganizationLabels,
	staticFabReviewOrganizationLabel,
} from "./StaticFabSemanticImpactReviewLabels";

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

describe("named impact summary", () => {
	it("puts the changed impact first and keeps bounded raw evidence in closed details", () => {
		const action = readyAction();
		const session = reduceStaticFabSemanticBankDetachSession(start(), {
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
		expect(summary).toContain("분리되는 항목 · 연결 제거");
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
		expect(summary).toContain("FAB North ↔ Bank Etch");
		expect(summary).toContain("Bank Etch 내부 구성 유지");
		expect(staticFabSemanticBankDetachSessionCanApply(session)).toBe(true);
	});
});

describe("review revision name snapshot", () => {
	const fixture = () => {
		const record = (id: number, kind: StaticFabOrganizationKind, name: string, parentId?: number) =>
			copyStaticFabOrganizationRecord({
				id,
				kind,
				name,
				parentOrganizationIds: parentId === undefined ? [] : [parentId],
				membership: {
					railEdges: [{ from: { x: id * 2, y: 0 }, to: { x: id * 2 + 1, y: 0 } }],
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			});
		return {
			map: new TileMap(),
			getPatchSequence: () => 7,
			organizations: {
				nextOrganizationId: 7,
				records: [
					record(1, "AREA", "North"),
					record(2, "AREA", "Etch", 1),
					record(3, "BAY", "Clean", 2),
					record(4, "AISLE", "Loop A", 3),
					record(5, "AISLE", "Loop  A", 3),
					{ ...record(6, "AREA", "Placeholder"), name: "" },
				],
			},
		};
	};
	it("captures user names and semantic kinds, disambiguates duplicates and missing targets", () => {
		const source = fixture();
		const labels = captureStaticFabReviewOrganizationLabels(source, source, {
			baseRevision: source.map.getRevision(),
			basePatchSequence: 7,
		});
		expect(labels).toEqual({
			1: "FAB North",
			2: "Bank Etch",
			3: "Bay Clean",
			4: "Loop Loop A (ID 4)",
			5: "Loop Loop A (ID 5)",
			6: "AREA 이름 없음 (ID 6)",
		});
		expect(Object.isFrozen(labels)).toBe(true);
		expect(staticFabReviewOrganizationLabel(labels, 99)).toBe("조직 ID 99 (대상 없음)");
		source.organizations = {
			...source.organizations,
			records: source.organizations.records.map((r) => ({ ...r, name: "Renamed" })),
		};
		expect(labels?.[2]).toBe("Bank Etch");
	});
	it("does not resolve names from another document, revision or patch sequence", () => {
		const source = fixture(),
			plan = { baseRevision: source.map.getRevision(), basePatchSequence: 7 };
		expect(captureStaticFabReviewOrganizationLabels(source, fixture(), plan)).toBeNull();
		expect(
			captureStaticFabReviewOrganizationLabels(source, source, {
				...plan,
				baseRevision: plan.baseRevision + 1,
			}),
		).toBeNull();
		expect(
			captureStaticFabReviewOrganizationLabels(source, source, { ...plan, basePatchSequence: 8 }),
		).toBeNull();
		expect(staticFabReviewOrganizationLabel(null, 2)).toBe("조직 ID 2 (검토 시점 이름 확인 불가)");
	});
});
