import { describe, expect, it } from "vitest";
import type { StaticFabSemanticBayMutationReview } from "../core/StaticFabSemanticBayMutation";
import type { StaticFabSemanticBayMutationTopologyEvidence } from "../worker/StaticFabSemanticBayMutationProtocol";
import {
	createStaticFabSemanticBayMutationSession,
	reduceStaticFabSemanticBayMutationSession,
	staticFabSemanticBayMutationSessionCanApply,
} from "./StaticFabSemanticBayMutationSession";

describe("StaticFabSemanticBayMutationSession", () => {
	it("starts in analyzing and adopts only an exact request, action, and Bay review", () => {
		const source = createStaticFabSemanticBayMutationSession({
			action: "DISCONNECT",
			bayOrganizationId: 12,
			bayName: "Bay 12",
		});
		const review = reviewFixture("DISCONNECT", 12);
		const evidence = topologyEvidenceFixture(1);
		const readyAction = {
			type: "ANALYSIS_READY" as const,
			requestSequence: 1,
			reason: "Exact prospective topology verified.",
			review,
			sourceEvidence: evidence,
			prospectiveEvidence: topologyEvidenceFixture(2),
			timings: { planningMilliseconds: 4.5, validationMilliseconds: 8.25 },
		};

		expect(source.phase).toBe("analyzing");
		expect(staticFabSemanticBayMutationSessionCanApply(source)).toBe(false);
		expect(
			reduceStaticFabSemanticBayMutationSession(source, {
				...readyAction,
				requestSequence: 2,
			}),
		).toBe(source);
		expect(
			reduceStaticFabSemanticBayMutationSession(source, {
				...readyAction,
				review: reviewFixture("DELETE", 12),
			}),
		).toBe(source);
		expect(
			reduceStaticFabSemanticBayMutationSession(source, {
				...readyAction,
				review: reviewFixture("DISCONNECT", 13),
			}),
		).toBe(source);

		const ready = reduceStaticFabSemanticBayMutationSession(source, readyAction);
		expect(ready).toMatchObject({
			phase: "ready",
			reason: "Exact prospective topology verified.",
			review,
			sourceEvidence: evidence,
			timings: { planningMilliseconds: 4.5, validationMilliseconds: 8.25 },
		});
		expect(staticFabSemanticBayMutationSessionCanApply(ready)).toBe(true);
	});

	it("keeps Apply one-way and represents a commit rejection without inventing another phase", () => {
		const ready = readySession("DELETE");
		const applying = reduceStaticFabSemanticBayMutationSession(ready, { type: "APPLY" });

		expect(applying.phase).toBe("applying");
		expect(staticFabSemanticBayMutationSessionCanApply(applying)).toBe(false);
		expect(reduceStaticFabSemanticBayMutationSession(applying, { type: "APPLY" })).toBe(applying);

		const rejected = reduceStaticFabSemanticBayMutationSession(applying, {
			type: "APPLICATION_REJECTED",
			reason: "The source changed before commit.",
		});
		expect(rejected).toMatchObject({
			phase: "rejected",
			reason: "The source changed before commit.",
		});
	});

	it("invalidates ready evidence when the live source changes before Apply", () => {
		const ready = readySession("DISCONNECT");
		const rejected = reduceStaticFabSemanticBayMutationSession(ready, {
			type: "ANALYSIS_REJECTED",
			requestSequence: ready.requestSequence,
			reason: "The live source changed after certification.",
			review: ready.review,
			sourceEvidence: ready.sourceEvidence,
			prospectiveEvidence: ready.prospectiveEvidence,
			timings: ready.timings,
		});

		expect(rejected).toMatchObject({
			phase: "rejected",
			reason: "The live source changed after certification.",
		});
		expect(staticFabSemanticBayMutationSessionCanApply(rejected)).toBe(false);
	});

	it("preserves bounded rejection evidence and retries only with a newer request sequence", () => {
		const source = createStaticFabSemanticBayMutationSession({
			action: "DELETE",
			bayOrganizationId: 12,
			bayName: "Bay 12",
			requestSequence: 7,
		});
		const review = reviewFixture("DELETE", 12);
		const rejected = reduceStaticFabSemanticBayMutationSession(source, {
			type: "ANALYSIS_REJECTED",
			requestSequence: 7,
			reason: "A connector port depends on this Bay.",
			review,
			sourceEvidence: topologyEvidenceFixture(1),
			prospectiveEvidence: null,
			timings: { planningMilliseconds: 3, validationMilliseconds: 0 },
		});

		expect(rejected).toMatchObject({
			phase: "rejected",
			review,
			reason: "A connector port depends on this Bay.",
		});
		expect(
			reduceStaticFabSemanticBayMutationSession(rejected, {
				type: "RETRY",
				requestSequence: 7,
			}),
		).toBe(rejected);

		const retrying = reduceStaticFabSemanticBayMutationSession(rejected, {
			type: "RETRY",
			requestSequence: 8,
		});
		expect(retrying).toMatchObject({
			phase: "analyzing",
			requestSequence: 8,
			review: null,
			sourceEvidence: null,
			prospectiveEvidence: null,
			timings: null,
		});
	});

	it("rejects invalid initial identity instead of opening an unbound command", () => {
		expect(() =>
			createStaticFabSemanticBayMutationSession({
				action: "DISCONNECT",
				bayOrganizationId: 0,
				bayName: "Bay",
			}),
		).toThrow(/positive safe integer/);
		expect(() =>
			createStaticFabSemanticBayMutationSession({
				action: "DELETE",
				bayOrganizationId: 1,
				bayName: "   ",
			}),
		).toThrow(/name is required/);
	});
});

function readySession(action: "DISCONNECT" | "DELETE") {
	const source = createStaticFabSemanticBayMutationSession({
		action,
		bayOrganizationId: 12,
		bayName: "Bay 12",
	});
	return reduceStaticFabSemanticBayMutationSession(source, {
		type: "ANALYSIS_READY",
		requestSequence: 1,
		reason: "Ready.",
		review: reviewFixture(action, 12),
		sourceEvidence: topologyEvidenceFixture(1),
		prospectiveEvidence: topologyEvidenceFixture(action === "DISCONNECT" ? 2 : 1),
		timings: { planningMilliseconds: 1, validationMilliseconds: 2 },
	});
}

function reviewFixture(
	action: "DISCONNECT" | "DELETE",
	bayOrganizationId: number,
): StaticFabSemanticBayMutationReview {
	return Object.freeze({
		version: 1,
		action,
		bayOrganizationId,
		bayName: `Bay ${bayOrganizationId}`,
		bankOrganizationId: 2,
		removedOrganizationIds: action === "DELETE" ? Object.freeze([12, 13, 14]) : Object.freeze([]),
		processLoopOrganizationIds: Object.freeze([13, 14]),
		processLoopCount: 2,
		railModuleCount: 18,
		railModuleKeys: Object.freeze(["module:a", "module:b"]),
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
		authoredStatus: "closed",
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
