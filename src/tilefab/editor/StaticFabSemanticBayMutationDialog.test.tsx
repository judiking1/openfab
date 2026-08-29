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
		expect(markup).toContain("ANALYZING EXACT SOURCE");
		expect(markup).toMatch(
			/data-testid="semantic-bay-command-cancel"[^>]*data-initial-focus="true"/,
		);
		expect(markup).toMatch(/data-testid="semantic-bay-command-apply"[^>]*disabled/);
		expect(markup).not.toContain("autofocus");
	});

	it("uses Disconnect-specific preserved and removed wording with relative Worker evidence", () => {
		const markup = renderDialog(readySession("DISCONNECT", 3, 4));

		expect(markup).toContain('data-phase="ready"');
		expect(markup).toContain("The Bay, 2 Process Loops, 18 rail modules");
		expect(markup).toContain("stay authored");
		expect(markup).toContain("the Bank parent relation are removed");
		expect(markup).toContain("All source and result components are independently closed");
		expect(markup).toContain("authored Δ+1 · physical Δ+1 · DISCONNECT");
		expect(markup).toContain("WORKER-CERTIFIED TOPOLOGY");
		expect(markup).toContain("PLANNER REVIEW · WORKER EVIDENCE BELOW");
		expect(markup).toContain("not certification");
		expect(markup).not.toMatch(/data-testid="semantic-bay-command-apply"[^>]*disabled/);
	});

	it("uses Delete-specific removal wording and keeps retained circulation a planner candidate", () => {
		const markup = renderDialog(readySession("DELETE", 3, 3));

		expect(markup).toContain('data-command="delete-bay"');
		expect(markup).toContain('data-review-action="DELETE"');
		expect(markup).toContain('data-review-equipment-group-count="2"');
		expect(markup).toContain('data-review-port-count="4"');
		expect(markup).toContain("3 organizations, 2 Process Loops, 18 rail modules");
		expect(markup).toContain("2 equipment groups, and 4 ports are removed");
		expect(markup).toContain("removed in the same atomic command");
		expect(markup).toContain("340 remaining Bank directed edges stay authored");
		expect(markup).toContain("Retained circulation candidate · PRESENT");
		expect(markup).toContain("authored Δ+0 · physical Δ+0 · DELETE");
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

		expect(markup).toContain("module:1, module:2, module:3, module:4 +14 MORE");
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
			"sampled-module:1, sampled-module:2, sampled-module:3, sampled-module:4 +9,996 MORE",
		);
		expect(markup).not.toContain("+252 MORE");
		expect(markup).not.toContain("sampled-module:256");
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
		expect(renderDialog(rejected)).toContain("COMMAND BLOCKED");
		expect(renderDialog(rejected)).toContain("A connector-attached port blocks this command.");
		expect(renderDialog(applying)).toContain('data-phase="applying"');
		expect(renderDialog(applying)).toContain('aria-busy="true"');
		expect(renderDialog(applying)).toContain("APPLYING ONE ATOMIC COMMAND");
		expect(renderDialog(applying)).toMatch(
			/data-testid="semantic-bay-command-cancel"[^>]*disabled/,
		);
	});
});

function renderDialog(session: StaticFabSemanticBayMutationSession): string {
	return renderToStaticMarkup(
		<StaticFabSemanticBayMutationDialog
			session={session}
			onAnalyze={vi.fn()}
			onCancel={vi.fn()}
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
