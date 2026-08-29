import { describe, expect, it } from "vitest";
import type { StaticFabBayFlowEditReview } from "../core/StaticFabBayFlowEdit";
import type { StaticFabBayFlowEditTopologyEvidence } from "../worker/StaticFabBayFlowEditProtocol";
import {
	createStaticFabBayFlowEditSession,
	reduceStaticFabBayFlowEditSession,
	staticFabBayFlowEditSessionCanApply,
} from "./StaticFabBayFlowEditSession";

describe("StaticFabBayFlowEditSession", () => {
	it("moves one exact target review from analysis to apply", () => {
		const initial = createStaticFabBayFlowEditSession({
			bayOrganizationId: 7,
			bayName: " Bay 7 ",
			targetInternalFlowPattern: "co-rotating",
		});
		expect(initial).toMatchObject({
			bayName: "Bay 7",
			phase: "analyzing",
			requestSequence: 1,
		});
		expect(staticFabBayFlowEditSessionCanApply(initial)).toBe(false);

		const ready = reduceStaticFabBayFlowEditSession(initial, {
			type: "ANALYSIS_READY",
			requestSequence: 1,
			reason: "Exact target certified.",
			review: review(),
			sourceEvidence: evidence(),
			prospectiveEvidence: evidence(),
			timings: { planningMilliseconds: 4, validationMilliseconds: 5 },
		});
		expect(ready).toMatchObject({ phase: "ready", reason: "Exact target certified." });
		expect(staticFabBayFlowEditSessionCanApply(ready)).toBe(true);
		expect(reduceStaticFabBayFlowEditSession(ready, { type: "APPLY" }).phase).toBe("applying");
	});

	it("ignores stale or target-divergent results", () => {
		const initial = createStaticFabBayFlowEditSession({
			bayOrganizationId: 7,
			bayName: "Bay 7",
			targetInternalFlowPattern: "co-rotating",
			requestSequence: 4,
		});
		const stale = reduceStaticFabBayFlowEditSession(initial, {
			type: "ANALYSIS_READY",
			requestSequence: 3,
			reason: "stale",
			review: review(),
			sourceEvidence: evidence(),
			prospectiveEvidence: evidence(),
			timings: { planningMilliseconds: 1, validationMilliseconds: 1 },
		});
		expect(stale).toBe(initial);

		const wrongTarget = Object.freeze({
			...review(),
			sourceInternalFlowPattern: "co-rotating" as const,
			targetInternalFlowPattern: "alternating" as const,
		});
		expect(
			reduceStaticFabBayFlowEditSession(initial, {
				type: "ANALYSIS_READY",
				requestSequence: 4,
				reason: "wrong",
				review: wrongTarget,
				sourceEvidence: evidence(),
				prospectiveEvidence: evidence(),
				timings: { planningMilliseconds: 1, validationMilliseconds: 1 },
			}),
		).toBe(initial);
	});

	it("requires an increasing sequence to retry a rejected analysis", () => {
		const initial = createStaticFabBayFlowEditSession({
			bayOrganizationId: 7,
			bayName: "Bay 7",
			targetInternalFlowPattern: "co-rotating",
		});
		const rejected = reduceStaticFabBayFlowEditSession(initial, {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "Source changed.",
			review: null,
			sourceEvidence: null,
			prospectiveEvidence: null,
			timings: null,
		});
		expect(rejected.phase).toBe("rejected");
		expect(reduceStaticFabBayFlowEditSession(rejected, { type: "RETRY", requestSequence: 1 })).toBe(
			rejected,
		);
		expect(
			reduceStaticFabBayFlowEditSession(rejected, { type: "RETRY", requestSequence: 2 }),
		).toMatchObject({ phase: "analyzing", requestSequence: 2, review: null });
	});

	it("publishes a source-not-recognized review whose source pattern is unavailable", () => {
		const initial = createStaticFabBayFlowEditSession({
			bayOrganizationId: 7,
			bayName: "Bay 7",
			targetInternalFlowPattern: "co-rotating",
		});
		const rejectedReview = Object.freeze({
			...review(),
			sourceInternalFlowPattern: null,
			issueCode: "SOURCE_NOT_RECOGNIZED" as const,
		});
		const rejected = reduceStaticFabBayFlowEditSession(initial, {
			type: "ANALYSIS_REJECTED",
			requestSequence: 1,
			reason: "The selected Bay is not a supported Twin Bay.",
			review: rejectedReview,
			sourceEvidence: evidence(),
			prospectiveEvidence: null,
			timings: { planningMilliseconds: 2, validationMilliseconds: 3 },
		});
		expect(rejected).toMatchObject({
			phase: "rejected",
			review: {
				sourceInternalFlowPattern: null,
				issueCode: "SOURCE_NOT_RECOGNIZED",
			},
		});
		expect(staticFabBayFlowEditSessionCanApply(rejected)).toBe(false);

		const wrongBayReview = Object.freeze({ ...rejectedReview, bayOrganizationId: 8 });
		expect(
			reduceStaticFabBayFlowEditSession(initial, {
				type: "ANALYSIS_REJECTED",
				requestSequence: 1,
				reason: "wrong Bay",
				review: wrongBayReview,
				sourceEvidence: null,
				prospectiveEvidence: null,
				timings: null,
			}),
		).toBe(initial);
	});

	it("sanitizes timings and rejects invalid identity", () => {
		expect(() =>
			createStaticFabBayFlowEditSession({
				bayOrganizationId: 0,
				bayName: "Bay",
				targetInternalFlowPattern: "co-rotating",
			}),
		).toThrow(/positive safe integer/);
		const initial = createStaticFabBayFlowEditSession({
			bayOrganizationId: 7,
			bayName: "Bay 7",
			targetInternalFlowPattern: "co-rotating",
		});
		const ready = reduceStaticFabBayFlowEditSession(initial, {
			type: "ANALYSIS_READY",
			requestSequence: 1,
			reason: "Ready",
			review: review(),
			sourceEvidence: evidence(),
			prospectiveEvidence: evidence(),
			timings: { planningMilliseconds: Number.NaN, validationMilliseconds: -3 },
		});
		expect(ready.timings).toEqual({ planningMilliseconds: 0, validationMilliseconds: 0 });
	});
});

function review(): StaticFabBayFlowEditReview {
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
		sourceSpecificationAliasCount: 1,
		sourceDirectedEdgeCount: 20,
		targetDirectedEdgeCount: 20,
		removedDirectedEdgeCount: 4,
		addedDirectedEdgeCount: 4,
		changedCellCount: 8,
		changedOrganizationIds: Object.freeze([7, 8, 9]),
		incidentConnectorCount: 1,
		connectorBankToBayDirectedEdgeKeys: Object.freeze(["0:0>1:0"]),
		connectorBayToBankDirectedEdgeKeys: Object.freeze(["1:1>0:1"]),
		shellCertification: "PENDING_WORKER_CERTIFICATION",
		externalGatewayCertification: "PENDING_WORKER_CERTIFICATION",
		topologyCertification: "PENDING_WORKER_CERTIFICATION",
		issueCode: null,
	});
}

function evidence(): StaticFabBayFlowEditTopologyEvidence {
	return Object.freeze({
		authoredCellCount: 20,
		authoredDirectedEdgeCount: 20,
		authoredStatus: "closed",
		authoredComponentCount: 1,
		authoredStrongComponentCount: 1,
		authoredOpenTerminalCount: 0,
		authoredUnsafeJunctionCount: 0,
		authoredComponentsClosed: true,
		physicalValid: true,
		physicalPathCount: 1,
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
