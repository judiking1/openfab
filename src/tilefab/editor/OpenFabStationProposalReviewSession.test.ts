import { describe, expect, it, vi } from "vitest";
import type {
	HydratedOpenFabStationProposalArtifact,
	OpenFabStationProposalRow,
} from "../compile/OpenFabStationProposalArtifact";
import type { OpenFabStationProposalIncludeDecision } from "../compile/OpenFabStationProposalReview";
import type { PortType } from "../core/PortRecord";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	decodeOpenFabStationProposalReviewDraftSnapshot,
	revokeEncodedOpenFabStationProposalReviewDraftSnapshot,
} from "../worker/OpenFabStationProposalReviewDraftSoA";
import {
	createOpenFabStationProposalReviewSession,
	isOpenFabStationProposalReviewSession,
	OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_WINDOW_MAX_ROWS,
	openFabStationProposalReviewSessionMatchesProposal,
} from "./OpenFabStationProposalReviewSession";

describe("OpenFabStationProposalReviewSession", () => {
	it("descriptor-captures proposal allocation facts once without invoking ordinary getters", () => {
		const fixture = proposalFixture(1);
		const mutableProposal = { ...fixture.proposal };
		let rowCountDescriptorReads = 0;
		let ordinaryReads = 0;
		const proposal = new Proxy(mutableProposal, {
			get() {
				ordinaryReads++;
				throw new Error("ordinary proposal reads are forbidden");
			},
			getOwnPropertyDescriptor(target, key) {
				if (key === "rowCount") {
					rowCountDescriptorReads++;
					return {
						value: rowCountDescriptorReads === 1 ? 1 : Number.MAX_SAFE_INTEGER,
						enumerable: true,
						writable: true,
						configurable: true,
					};
				}
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});

		const session = createOpenFabStationProposalReviewSession(proposal);
		expect(session.proposalRowCount).toBe(1);
		expect(session.getSummary().proposalRowCount).toBe(1);
		expect(rowCountDescriptorReads).toBe(1);
		expect(ordinaryReads).toBe(0);

		let accessorCalls = 0;
		const accessorProposal = { ...fixture.proposal } as Record<string, unknown>;
		Object.defineProperty(accessorProposal, "rowCount", {
			enumerable: true,
			get() {
				accessorCalls++;
				return 100_000;
			},
		});
		expect(() =>
			createOpenFabStationProposalReviewSession(
				accessorProposal as unknown as HydratedOpenFabStationProposalArtifact,
			),
		).toThrow(/review source is invalid/i);
		expect(accessorCalls).toBe(0);
	});

	it("keeps genuine scalar state and only materializes bounded row/group windows", () => {
		const fixture = proposalFixture(100_000);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		const initial = session.getSummary();

		expect(isOpenFabStationProposalReviewSession(session)).toBe(true);
		expect(isOpenFabStationProposalReviewSession({ ...session })).toBe(false);
		expect(openFabStationProposalReviewSessionMatchesProposal(session, fixture.proposal)).toBe(
			true,
		);
		expect(
			openFabStationProposalReviewSessionMatchesProposal({ ...session }, fixture.proposal),
		).toBe(false);
		expect(
			openFabStationProposalReviewSessionMatchesProposal(session, { ...fixture.proposal }),
		).toBe(false);
		expect(() => ({ ...session }).getSummary()).toThrow(/session is invalid/i);
		expect(initial).toMatchObject({
			revision: 1,
			proposalRowCount: 100_000,
			decidedRowCount: 0,
			activeGroupCount: 0,
			captureReady: false,
		});
		expect(Object.values(initial).some(Array.isArray)).toBe(false);
		expect(fixture.readRow).not.toHaveBeenCalled();

		const rowWindow = session.readRowWindow(50_000, Number.MAX_SAFE_INTEGER);
		expect(rowWindow.items).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_WINDOW_MAX_ROWS);
		expect(rowWindow).toMatchObject({
			start: 50_000,
			endExclusive: 50_128,
			totalCount: 100_000,
		});
		expect(fixture.readRow).toHaveBeenCalledTimes(128);

		for (let reviewGroupId = 1; reviewGroupId <= 140; reviewGroupId += 1) {
			session.dispatch({ type: "CREATE_GROUP", reviewGroupId, kind: "OHB" });
		}
		const groupWindow = session.readGroupWindow(0, 1_000);
		expect(groupWindow.items).toHaveLength(128);
		expect(groupWindow.items[0]).toMatchObject({ reviewGroupId: 1, kind: "OHB" });
		expect(groupWindow.items[127]).toMatchObject({ reviewGroupId: 128, kind: "OHB" });
		expect(fixture.readRow).toHaveBeenCalledTimes(128);

		const listener = vi.fn();
		const unsubscribe = session.subscribe(listener);
		session.dispatch({
			type: "SET_ORGANIZATION_POLICY",
			policy: "EXPLICIT_UNASSIGNED",
		});
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		unsubscribe();
		session.dispatch({
			type: "SET_REJECTED_SOURCE_ROWS_POLICY",
			policy: "NOT_APPLICABLE",
		});
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("uses bounded linked membership for a last-row member, replacement, detach, and delete", () => {
		const fixture = proposalFixture(100_000);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		setNoIssuePolicies(session);
		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 7, kind: "OHB" });
		session.dispatch({ type: "INCLUDE_ROW", decision: includeDecision(99_999, "OHB") });
		session.dispatch({ type: "SET_GROUP_MEMBERS", reviewGroupId: 7, memberRows: [99_999] });
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: 7,
			groupingReview: "OVERRIDE",
		});

		expect(session.readGroupMemberWindow(7, 0, 1_000)).toMatchObject({
			start: 0,
			endExclusive: 1,
			totalCount: 1,
			items: [99_999],
		});
		expect(fixture.readRow).toHaveBeenCalledTimes(1);

		session.dispatch({ type: "INCLUDE_ROW", decision: includeDecision(0, "OHB") });
		session.dispatch({ type: "SET_GROUP_MEMBERS", reviewGroupId: 7, memberRows: [0] });
		expect(session.readGroupMemberWindow(7, 0, 128).items).toEqual([0]);
		expect(session.getSummary()).toMatchObject({
			membershipCount: 1,
			ungroupedIncludedRowCount: 1,
			pendingGroupReviewCount: 1,
		});
		expect(fixture.readRow).toHaveBeenCalledTimes(2);

		session.dispatch({ type: "REJECT_ROW", row: 0, reason: "USER_EXCLUDED" });
		expect(session.readGroupMemberWindow(7, 0, 128).items).toEqual([]);
		expect(session.getSummary()).toMatchObject({
			includedRowCount: 1,
			rejectedRowCount: 1,
			membershipCount: 0,
			ungroupedIncludedRowCount: 1,
		});
		expect(fixture.readRow).toHaveBeenCalledTimes(2);

		session.dispatch({ type: "DELETE_GROUP", reviewGroupId: 7 });
		expect(session.getSummary()).toMatchObject({ activeGroupCount: 0, membershipCount: 0 });
		expect(() => session.readGroupMemberWindow(7, 0, 1)).toThrow(/does not exist/i);
	});

	it("reads dense bounded group windows after 100,000-slot create/delete churn", () => {
		const fixture = proposalFixture(100_000);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		for (let reviewGroupId = 1; reviewGroupId <= 100_000; reviewGroupId += 1) {
			session.dispatch({ type: "CREATE_GROUP", reviewGroupId, kind: "OHB" });
		}
		for (let reviewGroupId = 1; reviewGroupId <= 99_997; reviewGroupId += 1) {
			session.dispatch({ type: "DELETE_GROUP", reviewGroupId });
		}

		expect(session.getSummary()).toMatchObject({
			activeGroupCount: 3,
			pendingGroupReviewCount: 3,
		});
		expect(session.readGroupWindow(0, 128)).toMatchObject({
			start: 0,
			endExclusive: 3,
			totalCount: 3,
			items: [
				{ reviewGroupId: 100_000, kind: "OHB" },
				{ reviewGroupId: 99_999, kind: "OHB" },
				{ reviewGroupId: 99_998, kind: "OHB" },
			],
		});
		expect(session.readGroupWindow(2, Number.MAX_SAFE_INTEGER)).toMatchObject({
			start: 2,
			endExclusive: 3,
			totalCount: 3,
			items: [{ reviewGroupId: 99_998, kind: "OHB" }],
		});

		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 100_001, kind: "OHB" });
		expect(session.readGroupWindow(3, 128)).toMatchObject({
			start: 3,
			endExclusive: 4,
			totalCount: 4,
			items: [{ reviewGroupId: 100_001, kind: "OHB" }],
		});
		expect(fixture.readRow).not.toHaveBeenCalled();
	});

	it("captures fresh canonical decision/group/CSR columns and feeds the typed sealer", async () => {
		const fixture = proposalFixture(5, {
			rejectedRowCount: 2,
			unknownColumnCount: 1,
			kindAt: (row) => (["EQ", "EQ", "STK", "OHB", "EQ"] as const)[row] as PortType,
		});
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		session.dispatch({
			type: "SET_REJECTED_SOURCE_ROWS_POLICY",
			policy: "ACKNOWLEDGE_DISCARDED",
		});
		session.dispatch({
			type: "SET_UNKNOWN_COLUMNS_POLICY",
			policy: "ACKNOWLEDGE_IGNORED",
		});
		session.dispatch({
			type: "SET_ORGANIZATION_POLICY",
			policy: "EXPLICIT_UNASSIGNED",
		});
		for (const [row, kind] of [
			[0, "EQ"],
			[1, "EQ"],
			[2, "STK"],
			[3, "OHB"],
		] as const) {
			session.dispatch({ type: "INCLUDE_ROW", decision: includeDecision(row, kind) });
		}
		session.dispatch({ type: "REJECT_ROW", row: 4, reason: "UNSUPPORTED" });

		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 20, kind: "EQ" });
		session.dispatch({ type: "SET_GROUP_MEMBERS", reviewGroupId: 20, memberRows: [1, 0] });
		session.dispatch({ type: "SET_EQ_PITCH", reviewGroupId: 20, pitchMillimeters: 2_000 });
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: 20,
			groupingReview: "CONFIRM_DECLARED",
		});
		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 30, kind: "STK" });
		session.dispatch({ type: "SET_GROUP_MEMBERS", reviewGroupId: 30, memberRows: [2] });
		session.dispatch({ type: "SET_STK_TEMPLATE", reviewGroupId: 30, template: "FLEX" });
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: 30,
			groupingReview: "OVERRIDE",
		});
		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 40, kind: "OHB" });
		session.dispatch({ type: "SET_GROUP_MEMBERS", reviewGroupId: 40, memberRows: [3] });
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: 40,
			groupingReview: "OVERRIDE",
		});
		expect(session.getSummary()).toMatchObject({
			captureReady: true,
			decidedRowCount: 5,
			activeGroupCount: 3,
			membershipCount: 4,
		});

		let callerRevision = 91;
		const checkpoint = vi.fn(async () => Promise.resolve());
		const snapshot = await session.captureDraftSnapshotCooperatively({
			checkpoint,
			revision: () => callerRevision,
			operationsPerCheckpoint: 2,
		});
		expect(fixture.readRow).toHaveBeenCalledTimes(4);
		expect(snapshot).toMatchObject({
			kind: "openfab-station-proposal-review-draft-snapshot",
			proposalRowCount: 5,
			decisionCount: 5,
			groupCount: 3,
			membershipCount: 4,
			rejectedSourceRowsPolicyCode: 2,
			unknownColumnsPolicyCode: 2,
			organizationPolicyCode: 1,
			byteLength: 285,
		});
		expect([...snapshot.decisionRows]).toEqual([0, 1, 2, 3, 4]);
		expect([...snapshot.decisionDispositions]).toEqual([2, 2, 2, 2, 1]);
		expect([...snapshot.groupReviewIds]).toEqual([20, 30, 40]);
		expect([...snapshot.groupKinds]).toEqual([2, 3, 1]);
		expect([...snapshot.groupTemplates]).toEqual([0, 2, 1]);
		expect([...snapshot.groupPitchMillimeters]).toEqual([2_000, 0, 0]);
		expect([...snapshot.groupMemberOffsets]).toEqual([0, 2, 3, 4]);
		expect([...snapshot.groupMemberRows]).toEqual([0, 1, 2, 3]);
		expect(Object.isFrozen(snapshot)).toBe(true);
		const snapshotViews = Object.values(snapshot).filter(ArrayBuffer.isView);
		expect(snapshotViews).toHaveLength(32);
		expect(new Set(snapshotViews.map((view) => view.buffer)).size).toBe(32);
		expect(snapshot.fingerprint).toMatch(/^openfab-station-proposal-review-draft:v1:/);
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(snapshot)).toMatchObject({
			rowDecisions: [
				{ row: 0, disposition: "INCLUDE", portType: "EQ" },
				{ row: 1, disposition: "INCLUDE", portType: "EQ" },
				{ row: 2, disposition: "INCLUDE", portType: "STK" },
				{ row: 3, disposition: "INCLUDE", portType: "OHB" },
				{ row: 4, disposition: "REJECT", reason: "UNSUPPORTED" },
			],
			groupDecisions: [
				{ reviewGroupId: 20, kind: "EQ", memberRows: [0, 1], pitchMillimeters: 2_000 },
				{ reviewGroupId: 30, kind: "STK", memberRows: [2], template: "FLEX" },
				{ reviewGroupId: 40, kind: "OHB", memberRows: [3], template: "SINGLE" },
			],
			rejectedSourceRowsPolicy: "ACKNOWLEDGE_DISCARDED",
			unknownColumnsPolicy: "ACKNOWLEDGE_IGNORED",
			organizationPolicy: "EXPLICIT_UNASSIGNED",
		});

		const secondSnapshot = await session.captureDraftSnapshotCooperatively({
			checkpoint: async () => Promise.resolve(),
			revision: () => callerRevision,
		});
		expect(secondSnapshot.decisionRows.buffer).not.toBe(snapshot.decisionRows.buffer);
		expect(secondSnapshot.groupMemberRows.buffer).not.toBe(snapshot.groupMemberRows.buffer);
		expect(fixture.readRow).toHaveBeenCalledTimes(4);
		revokeEncodedOpenFabStationProposalReviewDraftSnapshot(snapshot);
		revokeEncodedOpenFabStationProposalReviewDraftSnapshot(secondSnapshot);
		callerRevision += 1;
	});

	it("honors the captured wall-clock slice even with a large operation interval", async () => {
		const fixture = proposalFixture(1_024);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		setNoIssuePolicies(session);
		rejectEveryProposalRow(session);
		const checkpoint = vi.fn(async () => Promise.resolve());
		let time = 0;
		const now = vi.fn(() => {
			time += 0.6;
			return time;
		});
		const poisonedCall = vi.fn(() => Number.NaN);
		Object.defineProperty(now, "call", {
			configurable: true,
			enumerable: true,
			value: poisonedCall,
		});

		const snapshot = await session.captureDraftSnapshotCooperatively({
			checkpoint,
			revision: () => 1,
			operationsPerCheckpoint: 4_096,
			now,
			sliceMilliseconds: 0.5,
		});

		expect(checkpoint.mock.calls.length).toBeGreaterThan(10);
		expect(poisonedCall).not.toHaveBeenCalled();
		revokeEncodedOpenFabStationProposalReviewDraftSnapshot(snapshot);
	});

	it("cancels capture after a cooperative session revision change", async () => {
		const fixture = proposalFixture(1);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		setNoIssuePolicies(session);
		rejectEveryProposalRow(session);
		let mutated = false;
		const capture = session.captureDraftSnapshotCooperatively({
			revision: () => 1,
			operationsPerCheckpoint: 1,
			checkpoint: async () => {
				if (!mutated) {
					mutated = true;
					session.dispatch({ type: "REJECT_ROW", row: 0, reason: "UNRESOLVED" });
				}
			},
		});

		await expect(capture).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CAPTURE_STALE",
		});
		expect(session.getSummary()).toMatchObject({ decidedRowCount: 1, rejectedRowCount: 1 });
	});

	it("keeps the same revision guard active while the private source is being sealed", async () => {
		const fixture = proposalFixture(1);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		setNoIssuePolicies(session);
		rejectEveryProposalRow(session);
		let mutatedDuringSealerSetup = false;
		let time = 0;
		const capture = session.captureDraftSnapshotCooperatively({
			revision: () => 33,
			checkpoint: async () => Promise.resolve(),
			now: () => {
				time += 1;
				if (!mutatedDuringSealerSetup) {
					mutatedDuringSealerSetup = true;
					session.dispatch({ type: "REJECT_ROW", row: 0, reason: "UNRESOLVED" });
				}
				return time;
			},
		});

		await expect(capture).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CAPTURE_STALE",
		});
		expect(mutatedDuringSealerSetup).toBe(true);
		expect(session.getSummary()).toMatchObject({ decidedRowCount: 1, rejectedRowCount: 1 });
	});

	it("rejects capture when an options descriptor trap changes the starting session", async () => {
		const fixture = proposalFixture(1);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		setNoIssuePolicies(session);
		rejectEveryProposalRow(session);
		const revision = vi.fn(() => 7);
		let reentered = false;
		const options = new Proxy(
			{
				checkpoint: async () => Promise.resolve(),
				revision,
			},
			{
				getOwnPropertyDescriptor(target, key) {
					if (!reentered) {
						reentered = true;
						session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 1, kind: "OHB" });
						throw new Error("HOSTILE_OPTIONS_DESCRIPTOR");
					}
					return Reflect.getOwnPropertyDescriptor(target, key);
				},
			},
		);

		await expect(session.captureDraftSnapshotCooperatively(options)).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CAPTURE_STALE",
		});
		expect(reentered).toBe(true);
		expect(revision).not.toHaveBeenCalled();
		expect(session.getSummary()).toMatchObject({ activeGroupCount: 1, captureReady: false });
	});

	it("captures exact command data before mutation and rejects getter or alternating Proxy hybrids", () => {
		const fixture = proposalFixture(1);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		const before = session.getSummary();
		const valid = includeDecision(0, "OHB");
		const getter = vi.fn(() => "WITH_TRAVEL");
		const getterDescriptors = Object.getOwnPropertyDescriptors(valid) as Record<
			string,
			PropertyDescriptor
		>;
		getterDescriptors.direction = {
			configurable: true,
			enumerable: true,
			get: getter,
		};
		const getterDecision = Object.defineProperties({}, getterDescriptors);

		expect(() =>
			session.dispatch({
				type: "INCLUDE_ROW",
				decision: getterDecision as OpenFabStationProposalIncludeDecision,
			}),
		).toThrow(/include decision is invalid/i);
		expect(getter).not.toHaveBeenCalled();
		expect(session.getSummary()).toBe(before);
		expect(session.readRowWindow(0, 1).items[0]?.decision).toBeNull();

		let directionDescriptorReads = 0;
		let ordinaryReads = 0;
		const alternatingDecision = new Proxy(
			{ ...valid },
			{
				get(target, key, receiver) {
					ordinaryReads += 1;
					return Reflect.get(target, key, receiver);
				},
				getOwnPropertyDescriptor(target, key) {
					if (key === "direction") {
						directionDescriptorReads += 1;
						return {
							configurable: true,
							enumerable: true,
							writable: true,
							value: directionDescriptorReads % 2 === 1 ? "UNKNOWN" : "WITH_TRAVEL",
						};
					}
					return Reflect.getOwnPropertyDescriptor(target, key);
				},
			},
		);
		expect(() =>
			session.dispatch({
				type: "INCLUDE_ROW",
				decision: alternatingDecision,
			}),
		).toThrow(/port direction is invalid/i);
		expect(directionDescriptorReads).toBe(1);
		expect(ordinaryReads).toBe(0);
		expect(session.getSummary()).toBe(before);
		expect(session.readRowWindow(0, 1).items[0]?.decision).toBeNull();

		expect(() =>
			session.dispatch({
				type: "INCLUDE_ROW",
				decision: { ...valid, extra: true } as OpenFabStationProposalIncludeDecision,
			}),
		).toThrow(/include decision is invalid/i);
		expect(session.getSummary()).toBe(before);

		let reentrantAttempted = false;
		const reentrantDecision = new Proxy(
			{ ...valid },
			{
				getOwnPropertyDescriptor(target, key) {
					if (!reentrantAttempted) {
						reentrantAttempted = true;
						session.dispatch({ type: "REJECT_ROW", row: 0, reason: "USER_EXCLUDED" });
					}
					return Reflect.getOwnPropertyDescriptor(target, key);
				},
			},
		);
		expect(() => session.dispatch({ type: "INCLUDE_ROW", decision: reentrantDecision })).toThrow(
			/include decision is invalid/i,
		);
		expect(reentrantAttempted).toBe(true);
		expect(session.getSummary()).toBe(before);
		expect(session.readRowWindow(0, 1).items[0]?.decision).toBeNull();
	});

	it("does not apply an outer include when proposal row access reenters the session", () => {
		const fixture = proposalFixture(1);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		const proposalRow = fixture.proposal.readRow(0);
		const revision = session.getSummary().revision;
		fixture.readRow.mockImplementationOnce(() => {
			session.dispatch({ type: "REJECT_ROW", row: 0, reason: "USER_EXCLUDED" });
			return proposalRow;
		});

		expect(() =>
			session.dispatch({ type: "INCLUDE_ROW", decision: includeDecision(0, "OHB") }),
		).toThrow(/changed while validating/i);
		expect(session.getSummary()).toMatchObject({
			revision: revision + 1,
			decidedRowCount: 1,
			includedRowCount: 0,
			rejectedRowCount: 1,
		});
		expect(session.readRowWindow(0, 1).items[0]?.decision).toMatchObject({
			disposition: "REJECT",
			reason: "USER_EXCLUDED",
		});
	});

	it("uses the captured row reader without trusting its mutable call property", () => {
		const fixture = proposalFixture(1);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		const poisonedCall = vi.fn(() => {
			throw new Error("poisoned call");
		});
		Object.defineProperty(fixture.readRow, "call", {
			configurable: true,
			enumerable: true,
			value: poisonedCall,
		});

		expect(session.readRowWindow(0, 1).items[0]?.proposal.portKey).toBe("P0");
		expect(poisonedCall).not.toHaveBeenCalled();
	});

	it("requires exact confirmation claims and explicit group configuration policies", () => {
		const fixture = proposalFixture(2, { kindAt: () => "EQ" });
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		setNoIssuePolicies(session);
		expect(session.getSummary()).toMatchObject({
			decidedRowCount: 0,
			ungroupedIncludedRowCount: 0,
			captureReady: false,
		});
		const revision = session.getSummary().revision;
		expect(() =>
			session.dispatch({
				type: "INCLUDE_ROW",
				decision: {
					...includeDecision(0, "EQ"),
					direction: "AGAINST_TRAVEL",
				},
			}),
		).toThrow(/direction confirmation/i);
		expect(session.getSummary().revision).toBe(revision);

		session.dispatch({ type: "INCLUDE_ROW", decision: includeDecision(0, "EQ") });
		session.dispatch({ type: "INCLUDE_ROW", decision: includeDecision(1, "EQ") });
		expect(session.getSummary()).toMatchObject({
			decidedRowCount: 2,
			ungroupedIncludedRowCount: 2,
			captureReady: false,
		});
		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 9, kind: "EQ" });
		session.dispatch({ type: "SET_GROUP_MEMBERS", reviewGroupId: 9, memberRows: [0, 1] });
		expect(session.getSummary()).toMatchObject({
			pendingGroupReviewCount: 1,
			pendingGroupConfigurationCount: 1,
			captureReady: false,
		});
		session.dispatch({ type: "SET_EQ_PITCH", reviewGroupId: 9, pitchMillimeters: 1_000 });
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: 9,
			groupingReview: "OVERRIDE",
		});
		expect(session.getSummary()).toMatchObject({
			pendingGroupReviewCount: 0,
			pendingGroupConfigurationCount: 0,
			captureReady: true,
		});

		session.dispatch({ type: "INCLUDE_ROW", decision: includeDecision(0, "EQ") });
		expect(session.readGroupMemberWindow(9, 0, 2).items).toEqual([0, 1]);
		expect(session.getSummary()).toMatchObject({
			pendingGroupReviewCount: 1,
			pendingGroupConfigurationCount: 0,
			captureReady: false,
		});
	});

	it("never reports capture ready while an active review group is empty", () => {
		const fixture = proposalFixture(1, { kindAt: () => "EQ" });
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		setNoIssuePolicies(session);
		session.dispatch({ type: "REJECT_ROW", row: 0, reason: "USER_EXCLUDED" });
		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 9, kind: "EQ" });
		session.dispatch({ type: "SET_EQ_PITCH", reviewGroupId: 9, pitchMillimeters: 1_000 });
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: 9,
			groupingReview: "OVERRIDE",
		});

		expect(session.getSummary()).toMatchObject({
			activeGroupCount: 1,
			emptyGroupCount: 1,
			pendingGroupReviewCount: 0,
			pendingGroupConfigurationCount: 0,
			captureReady: false,
		});

		session.dispatch({ type: "DELETE_GROUP", reviewGroupId: 9 });
		expect(session.getSummary()).toMatchObject({
			activeGroupCount: 0,
			emptyGroupCount: 0,
			captureReady: true,
		});
	});

	it("returns the summary for the completed command when a listener dispatches a later command", () => {
		const fixture = proposalFixture(1);
		const session = createOpenFabStationProposalReviewSession(fixture.proposal);
		let nested = false;
		const unsubscribe = session.subscribe(() => {
			if (nested) return;
			nested = true;
			session.dispatch({
				type: "SET_UNKNOWN_COLUMNS_POLICY",
				policy: "NOT_APPLICABLE",
			});
		});

		const completed = session.dispatch({
			type: "SET_REJECTED_SOURCE_ROWS_POLICY",
			policy: "NOT_APPLICABLE",
		});
		unsubscribe();

		expect(completed.revision).toBe(2);
		expect(completed.rejectedSourceRowsPolicy).toBe("NOT_APPLICABLE");
		expect(completed.unknownColumnsPolicy).toBeNull();
		expect(session.getSummary()).toMatchObject({
			revision: 3,
			unknownColumnsPolicy: "NOT_APPLICABLE",
		});
	});
});

function setNoIssuePolicies(
	session: ReturnType<typeof createOpenFabStationProposalReviewSession>,
): void {
	session.dispatch({
		type: "SET_REJECTED_SOURCE_ROWS_POLICY",
		policy: "NOT_APPLICABLE",
	});
	session.dispatch({
		type: "SET_UNKNOWN_COLUMNS_POLICY",
		policy: "NOT_APPLICABLE",
	});
	session.dispatch({ type: "SET_ORGANIZATION_POLICY", policy: "EXPLICIT_UNASSIGNED" });
}

function rejectEveryProposalRow(
	session: ReturnType<typeof createOpenFabStationProposalReviewSession>,
): void {
	for (let row = 0; row < session.proposalRowCount; row += 1) {
		session.dispatch({ type: "REJECT_ROW", row, reason: "USER_EXCLUDED" });
	}
}

function includeDecision(row: number, portType: PortType): OpenFabStationProposalIncludeDecision {
	return Object.freeze({
		row,
		disposition: "INCLUDE",
		identityAction: "CREATE_NEW",
		portType,
		typeReview: "CONFIRM_DECLARED",
		attachmentReview: "USER_SELECTED_EXACT_ROUTE",
		route: Object.freeze({
			kind: "CARDINAL_CELL",
			x: row,
			z: 0,
			from: DIR_W,
			to: DIR_E,
		}),
		stationMillimeters: stationForRow(row),
		stationReview: "CONFIRM_DECLARED",
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		sideOffsetReview: "CONFIRM_DECLARED",
		direction: "WITH_TRAVEL",
		directionReview: "CONFIRM_DECLARED",
		sourcePositionReview: "NOT_PROVIDED",
	});
}

function proposalFixture(
	rowCount: number,
	options: {
		readonly rejectedRowCount?: number;
		readonly unknownColumnCount?: number;
		readonly kindAt?: (row: number) => PortType;
	} = {},
): {
	readonly proposal: HydratedOpenFabStationProposalArtifact;
	readonly readRow: ReturnType<typeof vi.fn<(row: number) => OpenFabStationProposalRow>>;
} {
	const kindAt = options.kindAt ?? (() => "OHB");
	const readRow = vi.fn<(row: number) => OpenFabStationProposalRow>((row) => {
		if (!Number.isInteger(row) || row < 0 || row >= rowCount) throw new RangeError("row");
		const kind = kindAt(row);
		return Object.freeze({
			identityScope: "PUBLIC_TEST",
			portKey: `P${row}`,
			secondaryAliases: Object.freeze([]),
			attachmentScope: "PUBLIC_TEST",
			attachmentAlias: `R${row}`,
			stationMillimeters: stationForRow(row),
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			directionEvidence: "DECLARED",
			portType: kind,
			physicalGroupKey: `G${Math.floor(row / 2)}`,
			physicalGroupKind: kind,
			organizationAlias: "",
			sourceXMillimeters: null,
			sourceZMillimeters: null,
		});
	});
	const proposal = Object.freeze({
		kind: "hydrated-openfab-station-proposal-artifact" as const,
		schemaId: "openfab/station-proposal" as const,
		schemaVersion: 1 as const,
		sourceByteLength: 0,
		sourceRecordCount: rowCount,
		rowCount,
		rejectedRowCount: options.rejectedRowCount ?? 0,
		unknownColumnCount: options.unknownColumnCount ?? 0,
		semanticFingerprint: "public-test-semantic",
		snapshotFingerprint: "public-test-snapshot",
		readRow,
		issueCount: () => 0,
	}) satisfies HydratedOpenFabStationProposalArtifact;
	return Object.freeze({ proposal, readRow });
}

function stationForRow(row: number): number {
	return row % 100_001;
}
