import { describe, expect, it, vi } from "vitest";
import {
	OPENFAB_STATION_PROPOSAL_REVIEW_GLOBAL_ONLY_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_GROUP_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_ROW_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_VERSION,
	type OpenFabStationProposalReviewEvaluation,
	type OpenFabStationProposalReviewIssueCode,
	type OpenFabStationProposalReviewState,
} from "./OpenFabStationProposalReview";
import {
	captureOpenFabStationProposalReviewEvaluationArtifact,
	consumeHydratedOpenFabStationProposalReviewEvaluationPreview,
	hydrateOpenFabStationProposalReviewEvaluationArtifact,
	hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively,
	isHydratedOpenFabStationProposalReviewEvaluationPreview,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_GROUPS,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_ROWS,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_TRANSFER_BYTES,
	type OpenFabStationProposalReviewEvaluationArtifact,
	openFabStationProposalReviewEvaluationArtifactShapeError,
	openFabStationProposalReviewEvaluationArtifactTransfers,
	openFabStationProposalReviewEvaluationSnapshotFingerprint,
	validateOpenFabStationProposalReviewEvaluationArtifact,
} from "./OpenFabStationProposalReviewEvaluationArtifact";

const READY_FINGERPRINT = "openfab-station-proposal-review:v1:01234567:89abcdef";

describe("OpenFabStationProposalReviewEvaluationArtifact", () => {
	it("captures exact row/group masks and deterministic transferable columns", () => {
		const issueCounts = counts({
			INVALID_DRAFT: 1,
			ROW_DECISION_MISSING: 1,
			GROUP_KIND_MISMATCH: 2,
		});
		const rowMasks = Uint32Array.of(bit("ROW_DECISION_MISSING"), 0, bit("GROUP_KIND_MISMATCH"));
		const groupMasks = Uint32Array.of(bit("GROUP_KIND_MISMATCH"), 0);
		const issueCount = vi.fn((code: OpenFabStationProposalReviewIssueCode) => {
			return issueCounts[issueIndex(code)] as number;
		});
		const rowIssueMask = vi.fn((row: number) => rowMasks[row] ?? 0);
		const groupIssueMask = vi.fn((group: number) => groupMasks[group] ?? 0);
		const evaluation = evaluationFixture({
			state: "BLOCKED",
			proposalRowCount: 3,
			includedPortCount: 1,
			rejectedPortCount: 1,
			equipmentGroupCount: 1,
			groupDecisionCount: 2,
			issueCount,
			rowIssueMask,
			groupIssueMask,
		});

		const first = captureOpenFabStationProposalReviewEvaluationArtifact(evaluation);
		const second = captureOpenFabStationProposalReviewEvaluationArtifact(evaluation);

		expect(first).toMatchObject({
			kind: "openfab-station-proposal-review-evaluation-artifact",
			version: 1,
			state: "BLOCKED",
			proposalRowCount: 3,
			groupDecisionCount: 2,
			includedPortCount: 1,
			rejectedPortCount: 1,
			equipmentGroupCount: 1,
			reviewFingerprint: null,
		});
		expect(first.issueCounts).toEqual(issueCounts);
		expect(first.rowMasks).toEqual(rowMasks);
		expect(first.groupMasks).toEqual(groupMasks);
		expect(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_CODES).toEqual(
			OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES,
		);
		expect(first.issueCounts).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT);
		expect(first.snapshotFingerprint).toBe(second.snapshotFingerprint);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(first)).toBeNull();
		expect(Object.isFrozen(first)).toBe(true);
		expect(issueCount).toHaveBeenCalledTimes(29 * 2);
		expect(rowIssueMask).toHaveBeenCalledTimes(3 * 2);
		expect(groupIssueMask).toHaveBeenCalledTimes(2 * 2);

		const transfers = openFabStationProposalReviewEvaluationArtifactTransfers(first);
		expect(transfers).toEqual([
			first.issueCounts.buffer,
			first.rowMasks.buffer,
			first.groupMasks.buffer,
		]);
		expect(new Set(transfers).size).toBe(3);
	});

	it("pins one descriptor-captured column identity before validation and transfer", () => {
		const artifact = captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation());
		const validationReads = new Map<PropertyKey, number>();
		const calibration = new Proxy(artifact, {
			get(target, key, receiver) {
				validationReads.set(key, (validationReads.get(key) ?? 0) + 1);
				return Reflect.get(target, key, receiver);
			},
		});
		validateOpenFabStationProposalReviewEvaluationArtifact(calibration);

		const rogueColumns = {
			issueCounts: new Uint32Array(artifact.issueCounts.length),
			rowMasks: new Uint32Array(artifact.rowMasks.length),
			groupMasks: new Uint32Array(artifact.groupMasks.length),
		};
		const transferReads = new Map<PropertyKey, number>();
		const alternating = new Proxy(artifact, {
			get(target, key, receiver) {
				const read = (transferReads.get(key) ?? 0) + 1;
				transferReads.set(key, read);
				if (
					(key === "issueCounts" || key === "rowMasks" || key === "groupMasks") &&
					read > (validationReads.get(key) ?? 0)
				) {
					return rogueColumns[key];
				}
				return Reflect.get(target, key, receiver);
			},
		});

		const transfers = openFabStationProposalReviewEvaluationArtifactTransfers(alternating);

		expect(transfers).toEqual([
			artifact.issueCounts.buffer,
			artifact.rowMasks.buffer,
			artifact.groupMasks.buffer,
		]);
		expect(transfers).not.toContain(rogueColumns.issueCounts.buffer);
		expect(transfers).not.toContain(rogueColumns.rowMasks.buffer);
		expect(transfers).not.toContain(rogueColumns.groupMasks.buffer);
		expect(transferReads.size).toBe(0);
	});

	it("hydrates a descriptor-captured envelope without invoking a Proxy get trap", async () => {
		for (const cooperative of [false, true]) {
			const artifact = captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation());
			let getCalls = 0;
			const envelope = new Proxy(artifact, {
				get() {
					getCalls++;
					throw new Error("UNTRUSTED_EVALUATION_ENVELOPE_GET");
				},
			});
			const preview = cooperative
				? await hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(envelope, {
						checkpoint: async () => undefined,
						revision: () => 0,
					})
				: hydrateOpenFabStationProposalReviewEvaluationArtifact(envelope);

			expect(getCalls).toBe(0);
			expect(artifact.issueCounts.byteLength).toBe(0);
			expect(artifact.rowMasks.byteLength).toBe(0);
			expect(artifact.groupMasks.byteLength).toBe(0);
			expect(preview.state).toBe("BLOCKED");
		}
	});

	it("locks every current evaluator emission channel to the V1 artifact locality", () => {
		expect(OPENFAB_STATION_PROPOSAL_REVIEW_GLOBAL_ONLY_ISSUE_CODES).toEqual([
			"INVALID_SOURCE",
			"INVALID_DRAFT",
			"PROPOSAL_REJECTIONS_UNACKNOWLEDGED",
			"UNKNOWN_COLUMNS_UNACKNOWLEDGED",
			"ORGANIZATION_POLICY_UNRESOLVED",
			"ROW_DECISION_OUT_OF_RANGE",
			"ID_ALLOCATION_EXHAUSTED",
			"PROSPECTIVE_LAYOUT_INVALID",
		]);
		expect(OPENFAB_STATION_PROPOSAL_REVIEW_ROW_ISSUE_CODES).toEqual([
			"ROW_DECISION_DUPLICATE",
			"ROW_DECISION_MISSING",
			"ROW_DISPOSITION_INVALID",
			"ROW_IDENTITY_REVIEW_INVALID",
			"ROW_TYPE_REVIEW_INVALID",
			"ROW_ATTACHMENT_REVIEW_INVALID",
			"ROW_STATION_REVIEW_INVALID",
			"ROW_SIDE_OFFSET_REVIEW_INVALID",
			"ROW_DIRECTION_REVIEW_INVALID",
			"ROW_SOURCE_POSITION_REVIEW_INVALID",
			"ATTACHMENT_RESOLUTION_INVALID",
			"GROUP_MEMBER_REJECTED",
			"ROW_GROUP_MISSING",
			"ROW_GROUP_MULTIPLE",
			"GROUP_KIND_MISMATCH",
		]);
		expect(OPENFAB_STATION_PROPOSAL_REVIEW_GROUP_ISSUE_CODES).toEqual([
			"GROUP_DECISION_INVALID",
			"GROUP_ID_DUPLICATE",
			"GROUP_MEMBER_OUT_OF_RANGE",
			"GROUP_MEMBER_DUPLICATE",
			"GROUP_MEMBER_REJECTED",
			"GROUP_KIND_MISMATCH",
			"GROUPING_REVIEW_INVALID",
			"EQUIPMENT_GROUP_INVALID",
		]);

		const global = new Set<OpenFabStationProposalReviewIssueCode>(
			OPENFAB_STATION_PROPOSAL_REVIEW_GLOBAL_ONLY_ISSUE_CODES,
		);
		const row = new Set<OpenFabStationProposalReviewIssueCode>(
			OPENFAB_STATION_PROPOSAL_REVIEW_ROW_ISSUE_CODES,
		);
		const group = new Set<OpenFabStationProposalReviewIssueCode>(
			OPENFAB_STATION_PROPOSAL_REVIEW_GROUP_ISSUE_CODES,
		);
		for (const code of OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES) {
			expect(Number(global.has(code)) + Number(row.has(code) || group.has(code))).toBe(1);
		}
		expect([...row].filter((code) => group.has(code))).toEqual([
			"GROUP_MEMBER_REJECTED",
			"GROUP_KIND_MISMATCH",
		]);
	});

	it("reads the facade group count once and ignores a caller-supplied truncation argument", () => {
		const groupMasks = Uint32Array.of(0, bit("GROUP_DECISION_INVALID"));
		let groupCountReads = 0;
		const evaluation = {
			...evaluationFixture({
				state: "BLOCKED",
				proposalRowCount: 0,
				groupDecisionCount: 2,
				includedPortCount: 0,
				rejectedPortCount: 0,
				equipmentGroupCount: 0,
				issueCount: (code) => (code === "GROUP_DECISION_INVALID" ? 1 : 0),
				groupIssueMask: (group) => groupMasks[group] ?? 0,
			}),
		};
		Object.defineProperty(evaluation, "groupDecisionCount", {
			enumerable: true,
			get() {
				groupCountReads++;
				return groupCountReads === 1 ? 2 : 0;
			},
		});

		const artifact = Reflect.apply(captureOpenFabStationProposalReviewEvaluationArtifact, null, [
			evaluation,
			1,
		]);

		expect(groupCountReads).toBe(1);
		expect(artifact.groupDecisionCount).toBe(2);
		expect(Array.from(artifact.groupMasks)).toEqual(Array.from(groupMasks));
	});

	it("hydrates by transfer into a distinct accessor-only non-finalizable preview", () => {
		const artifact = captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation());
		const fingerprint = artifact.snapshotFingerprint;

		const preview = hydrateOpenFabStationProposalReviewEvaluationArtifact(artifact);

		expect(artifact.issueCounts.byteLength).toBe(0);
		expect(artifact.rowMasks.byteLength).toBe(0);
		expect(artifact.groupMasks.byteLength).toBe(0);
		expect(preview).toMatchObject({
			kind: "hydrated-openfab-station-proposal-review-evaluation-preview",
			version: 1,
			state: "BLOCKED",
			proposalRowCount: 3,
			groupDecisionCount: 2,
			snapshotFingerprint: fingerprint,
		});
		expect(preview.issueCount("INVALID_DRAFT")).toBe(1);
		expect(preview.issueCount("GROUP_KIND_MISMATCH")).toBe(2);
		expect(preview.rowIssueMask(2)).toBe(bit("GROUP_KIND_MISMATCH"));
		expect(preview.rowIssueMask(-1)).toBe(0);
		expect(preview.groupIssueMask(0)).toBe(bit("GROUP_KIND_MISMATCH"));
		expect(preview.groupIssueMask(2)).toBe(0);
		expect(Object.keys(preview)).not.toContain("issueCounts");
		expect(Object.keys(preview)).not.toContain("rowMasks");
		expect(Object.keys(preview)).not.toContain("groupMasks");
		expect(Object.keys(preview)).not.toContain("finalize");
		expect(Object.isFrozen(preview)).toBe(true);
		expect(isHydratedOpenFabStationProposalReviewEvaluationPreview(preview)).toBe(true);
		expect(isHydratedOpenFabStationProposalReviewEvaluationPreview({ ...preview })).toBe(false);
		expect(consumeHydratedOpenFabStationProposalReviewEvaluationPreview({ ...preview })).toBe(
			false,
		);
		expect(consumeHydratedOpenFabStationProposalReviewEvaluationPreview(preview)).toBe(true);
		expect(isHydratedOpenFabStationProposalReviewEvaluationPreview(preview)).toBe(false);
		expect(consumeHydratedOpenFabStationProposalReviewEvaluationPreview(preview)).toBe(false);
	});

	it("accepts the exact READY, NO_CHANGES, and BLOCKED state contracts", () => {
		const ready = captureOpenFabStationProposalReviewEvaluationArtifact(
			evaluationFixture({
				state: "READY",
				proposalRowCount: 3,
				includedPortCount: 2,
				rejectedPortCount: 1,
				equipmentGroupCount: 1,
				reviewFingerprint: READY_FINGERPRINT,
			}),
		);
		const noChanges = captureOpenFabStationProposalReviewEvaluationArtifact(
			evaluationFixture({
				state: "NO_CHANGES",
				proposalRowCount: 2,
				includedPortCount: 0,
				rejectedPortCount: 2,
				equipmentGroupCount: 0,
			}),
		);
		const blocked = captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation());

		for (const artifact of [ready, noChanges, blocked]) {
			expect(openFabStationProposalReviewEvaluationArtifactShapeError(artifact)).toBeNull();
			expect(() => validateOpenFabStationProposalReviewEvaluationArtifact(artifact)).not.toThrow();
		}
	});

	it("supports both 100k columns below the fixed one-MiB transfer budget", () => {
		const artifact = maximumBlockedArtifact();
		const transferBytes = openFabStationProposalReviewEvaluationArtifactTransfers(artifact).reduce(
			(total, buffer) => total + buffer.byteLength,
			0,
		);

		expect(artifact.rowMasks).toHaveLength(100_000);
		expect(artifact.groupMasks).toHaveLength(100_000);
		expect(transferBytes).toBe(800_116);
		expect(transferBytes).toBeLessThanOrEqual(
			OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_TRANSFER_BYTES,
		);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(artifact)).toBeNull();
	});

	it("cooperatively adopts the 100k + 100k boundary in bounded checkpoints", async () => {
		const artifact = maximumBlockedArtifact();
		let checkpoints = 0;
		let clock = 0;

		const preview = await hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(
			artifact,
			{
				checkpoint: async () => {
					checkpoints++;
				},
				revision: () => 0,
				now: () => ++clock,
				sliceMilliseconds: 1,
			},
		);

		expect(artifact.issueCounts.byteLength).toBe(0);
		expect(artifact.rowMasks.byteLength).toBe(0);
		expect(artifact.groupMasks.byteLength).toBe(0);
		expect(checkpoints).toBeGreaterThan(700);
		expect(checkpoints).toBeLessThan(1_000);
		expect(preview).toMatchObject({
			state: "BLOCKED",
			proposalRowCount: 100_000,
			groupDecisionCount: 100_000,
		});
		expect(preview.issueCount("INVALID_SOURCE")).toBe(1);
	}, 15_000);

	it("cancels cooperative validation after adoption and redacts checkpoint failures", async () => {
		const preTransfer = captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation());
		const preTransferController = new AbortController();
		let descriptorReads = 0;
		const abortingEnvelope = new Proxy(preTransfer, {
			getOwnPropertyDescriptor(target, key) {
				descriptorReads++;
				preTransferController.abort();
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});
		await expect(
			hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(abortingEnvelope, {
				checkpoint: async () => undefined,
				revision: () => 0,
				signal: preTransferController.signal,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ABORTED",
		});
		expect(descriptorReads).toBeGreaterThan(0);
		expect(preTransfer.issueCounts.byteLength).toBeGreaterThan(0);
		expect(preTransfer.rowMasks.byteLength).toBeGreaterThan(0);
		expect(preTransfer.groupMasks.byteLength).toBeGreaterThan(0);

		const revisionBeforeTransfer = captureOpenFabStationProposalReviewEvaluationArtifact(
			blockedEvaluation(),
		);
		let descriptorRevision = 0;
		const revisionChangingEnvelope = new Proxy(revisionBeforeTransfer, {
			getOwnPropertyDescriptor(target, key) {
				descriptorRevision++;
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});
		await expect(
			hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(revisionChangingEnvelope, {
				checkpoint: async () => undefined,
				revision: () => descriptorRevision,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ABORTED",
		});
		expect(descriptorRevision).toBeGreaterThan(0);
		expect(revisionBeforeTransfer.issueCounts.byteLength).toBeGreaterThan(0);
		expect(revisionBeforeTransfer.rowMasks.byteLength).toBeGreaterThan(0);
		expect(revisionBeforeTransfer.groupMasks.byteLength).toBeGreaterThan(0);

		const artifact = maximumBlockedArtifact();
		const controller = new AbortController();
		let checkpoints = 0;
		let clock = 0;
		await expect(
			hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(artifact, {
				checkpoint: async () => {
					checkpoints++;
					if (checkpoints === 3) controller.abort();
				},
				revision: () => 0,
				signal: controller.signal,
				now: () => ++clock,
				sliceMilliseconds: 1,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ABORTED",
		});
		expect(checkpoints).toBe(3);
		expect(artifact.rowMasks.byteLength).toBe(0);

		const staleArtifact = captureOpenFabStationProposalReviewEvaluationArtifact(
			blockedEvaluation(),
		);
		let revision = 0;
		await expect(
			hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(staleArtifact, {
				checkpoint: async () => {
					revision++;
				},
				revision: () => revision,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ABORTED",
		});
		expect(staleArtifact.rowMasks.byteLength).toBe(0);

		const secret = "SECRET_COOPERATIVE_CHECKPOINT";
		await expect(
			hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(
				captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
				{
					checkpoint: async () => {
						throw new Error(secret);
					},
					revision: () => 0,
				},
			),
		).rejects.toThrow("OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_FAILED");

		const hostileNameSecret = "SECRET_CHECKPOINT_ERROR_NAME_GETTER";
		const hostileName = new Error("untrusted checkpoint failure");
		Object.defineProperty(hostileName, "name", {
			get() {
				throw new Error(hostileNameSecret);
			},
		});
		await expect(
			hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(
				captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
				{
					checkpoint: async () => {
						throw hostileName;
					},
					revision: () => 0,
				},
			),
		).rejects.toThrow(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);

		const forgedAbort = new Error("FORGED_ABORT_SECRET");
		forgedAbort.name = "AbortError";
		await expect(
			hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(
				captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
				{
					checkpoint: async () => {
						throw forgedAbort;
					},
					revision: () => 0,
				},
			),
		).rejects.toMatchObject({
			name: "Error",
			message: OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR,
		});
	});

	it("redacts every capture failure behind one fixed code", () => {
		const secret = "TOP_SECRET_CAPTURE_VALUE";
		const throwing = evaluationFixture({
			state: "BLOCKED",
			proposalRowCount: 1,
			includedPortCount: 0,
			rejectedPortCount: 0,
			equipmentGroupCount: 0,
			issueCount: () => {
				throw new Error(secret);
			},
		});
		const invalidMask = evaluationFixture({
			state: "BLOCKED",
			proposalRowCount: 1,
			includedPortCount: 0,
			rejectedPortCount: 0,
			equipmentGroupCount: 0,
			issueCount: (code) => (code === "INVALID_SOURCE" ? 1 : 0),
			rowIssueMask: () => 2 ** OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES.length,
		});

		for (const invoke of [
			() => captureOpenFabStationProposalReviewEvaluationArtifact(throwing),
			() => captureOpenFabStationProposalReviewEvaluationArtifact(invalidMask),
			() =>
				captureOpenFabStationProposalReviewEvaluationArtifact(
					evaluationFixture({
						state: "BLOCKED",
						proposalRowCount: 0,
						groupDecisionCount: OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_GROUPS + 1,
						includedPortCount: 0,
						rejectedPortCount: 0,
						equipmentGroupCount: 0,
					}),
				),
		]) {
			try {
				invoke();
				throw new Error("Expected capture to fail.");
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe(
					OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR,
				);
				expect((error as Error).message).not.toContain(secret);
			}
		}
	});

	it("rejects non-objects, extra keys, wrong columns, partial views, and aliased buffers", () => {
		const valid = captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation());
		expect(openFabStationProposalReviewEvaluationArtifactShapeError([])).toBe("NOT_OBJECT");
		const exoticCarrier = Object.assign(new Date(0), valid);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(exoticCarrier)).toBe(
			"CONTRACT_MISMATCH",
		);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError({ ...valid, extra: 1 })).toBe(
			"CONTRACT_MISMATCH",
		);
		const symbolSidecar = { ...valid, [Symbol("sidecar")]: 1 };
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(symbolSidecar)).toBe(
			"CONTRACT_MISMATCH",
		);
		const hiddenSidecar = { ...valid } as Record<string, unknown>;
		Object.defineProperty(hiddenSidecar, "hidden", { value: 1 });
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(hiddenSidecar)).toBe(
			"CONTRACT_MISMATCH",
		);
		expect(
			openFabStationProposalReviewEvaluationArtifactShapeError({
				...valid,
				issueCounts: new Uint16Array(29),
			}),
		).toBe("TYPED_ARRAY_MISMATCH");

		const wrongLength = mutableClone(valid);
		wrongLength.issueCounts = new Uint32Array(28);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(wrongLength)).toBe(
			"COLUMN_LENGTH_MISMATCH",
		);

		const partial = mutableClone(valid);
		partial.issueCounts = new Uint32Array(
			new ArrayBuffer(30 * Uint32Array.BYTES_PER_ELEMENT),
			4,
			29,
		);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(partial)).toBe(
			"BUFFER_OWNERSHIP_MISMATCH",
		);

		const aliased = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation(3)),
		);
		aliased.groupMasks = new Uint32Array(aliased.rowMasks.buffer);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(aliased)).toBe(
			"BUFFER_OWNERSHIP_MISMATCH",
		);
	});

	it("rejects SharedArrayBuffer columns and every detached artifact", () => {
		const valid = captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation());
		const shared = mutableClone(valid);
		shared.rowMasks = new Uint32Array(
			new SharedArrayBuffer(valid.rowMasks.byteLength),
		) as Uint32Array;
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(shared)).toBe(
			"BUFFER_OWNERSHIP_MISMATCH",
		);

		const resizable = mutableClone(valid);
		const ResizableArrayBuffer = ArrayBuffer as unknown as new (
			byteLength: number,
			options: { readonly maxByteLength: number },
		) => ArrayBuffer;
		const resizableBuffer = new ResizableArrayBuffer(valid.rowMasks.byteLength, {
			maxByteLength: valid.rowMasks.byteLength + Uint32Array.BYTES_PER_ELEMENT,
		});
		resizable.rowMasks = new Uint32Array(resizableBuffer);
		resizable.rowMasks.set(valid.rowMasks);
		Object.defineProperty(resizableBuffer, "resizable", { value: false });
		refingerprint(resizable);
		expect((resizableBuffer as ArrayBuffer & { readonly resizable: boolean }).resizable).toBe(
			false,
		);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(resizable)).toBe(
			"BUFFER_OWNERSHIP_MISMATCH",
		);

		const sharedDecoy = mutableClone(valid);
		sharedDecoy.rowMasks = new Uint32Array(
			new SharedArrayBuffer(valid.rowMasks.byteLength),
		) as Uint32Array;
		Object.defineProperty(sharedDecoy.rowMasks, "buffer", {
			value: new ArrayBuffer(valid.rowMasks.byteLength),
		});
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(sharedDecoy)).toBe(
			"BUFFER_OWNERSHIP_MISMATCH",
		);

		const detached = mutableClone(valid);
		structuredClone(detached, {
			transfer: openFabStationProposalReviewEvaluationArtifactTransfers(detached),
		});
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(detached)).toBe(
			"BUFFER_OWNERSHIP_MISMATCH",
		);
		expect(() => openFabStationProposalReviewEvaluationArtifactTransfers(detached)).toThrow(
			"BUFFER_OWNERSHIP_MISMATCH",
		);
	});

	it("rejects every mask outside its locality and a phantom global increment on a row issue", () => {
		const globalInRow = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		globalInRow.rowMasks[0] |= bit("INVALID_DRAFT");
		refingerprint(globalInRow);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(globalInRow)).toBe(
			"BITMASK_MISMATCH",
		);

		const globalInGroup = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		globalInGroup.groupMasks[0] |= bit("INVALID_DRAFT");
		refingerprint(globalInGroup);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(globalInGroup)).toBe(
			"BITMASK_MISMATCH",
		);

		const rowOnlyInGroup = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		rowOnlyInGroup.groupMasks[0] |= bit("ROW_DECISION_MISSING");
		rowOnlyInGroup.issueCounts[issueIndex("ROW_DECISION_MISSING")]++;
		refingerprint(rowOnlyInGroup);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(rowOnlyInGroup)).toBe(
			"BITMASK_MISMATCH",
		);

		const groupOnlyInRow = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		groupOnlyInRow.rowMasks[0] |= bit("GROUP_DECISION_INVALID");
		groupOnlyInRow.issueCounts[issueIndex("GROUP_DECISION_INVALID")] = 1;
		refingerprint(groupOnlyInRow);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(groupOnlyInRow)).toBe(
			"BITMASK_MISMATCH",
		);

		const phantomGlobalForRow = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		phantomGlobalForRow.issueCounts[issueIndex("ROW_DECISION_MISSING")] = 2;
		refingerprint(phantomGlobalForRow);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(phantomGlobalForRow)).toBe(
			"ISSUE_COUNT_MISMATCH",
		);
	});

	it("rejects undefined issue bits and issue-count underflow, overflow, or phantom multiplicity", () => {
		const invalidBit = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		invalidBit.rowMasks[0] = 2 ** OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES.length;
		refingerprint(invalidBit);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(invalidBit)).toBe(
			"BITMASK_MISMATCH",
		);

		const underflow = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		underflow.issueCounts[issueIndex("GROUP_KIND_MISMATCH")] = 1;
		refingerprint(underflow);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(underflow)).toBe(
			"ISSUE_COUNT_MISMATCH",
		);

		const phantom = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		phantom.issueCounts[issueIndex("PROSPECTIVE_LAYOUT_INVALID")] = 2;
		refingerprint(phantom);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(phantom)).toBe(
			"ISSUE_COUNT_MISMATCH",
		);

		const overMaximum = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		overMaximum.issueCounts[issueIndex("INVALID_DRAFT")] = 7;
		refingerprint(overMaximum);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(overMaximum)).toBe(
			"ISSUE_COUNT_MISMATCH",
		);
	});

	it("strictly binds state, counts, and READY fingerprint relationships", () => {
		const ready = captureOpenFabStationProposalReviewEvaluationArtifact(
			evaluationFixture({
				state: "READY",
				proposalRowCount: 3,
				includedPortCount: 2,
				rejectedPortCount: 1,
				equipmentGroupCount: 1,
				reviewFingerprint: READY_FINGERPRINT,
			}),
		);
		const missingFingerprint = mutableClone(ready);
		missingFingerprint.reviewFingerprint = null;
		refingerprint(missingFingerprint);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(missingFingerprint)).toBe(
			"STATE_MISMATCH",
		);

		const armedReady = mutableClone(ready);
		armedReady.issueCounts[issueIndex("INVALID_SOURCE")] = 1;
		refingerprint(armedReady);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(armedReady)).toBe(
			"STATE_MISMATCH",
		);

		const badReadyCounts = mutableClone(ready);
		badReadyCounts.rejectedPortCount = 0;
		refingerprint(badReadyCounts);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(badReadyCounts)).toBe(
			"STATE_MISMATCH",
		);

		const noChanges = captureOpenFabStationProposalReviewEvaluationArtifact(
			evaluationFixture({
				state: "NO_CHANGES",
				proposalRowCount: 2,
				includedPortCount: 0,
				rejectedPortCount: 2,
				equipmentGroupCount: 0,
			}),
		);
		const nonEmptyNoChanges = mutableClone(noChanges);
		nonEmptyNoChanges.includedPortCount = 1;
		nonEmptyNoChanges.rejectedPortCount = 1;
		refingerprint(nonEmptyNoChanges);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(nonEmptyNoChanges)).toBe(
			"STATE_MISMATCH",
		);

		const unblocked = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		unblocked.issueCounts.fill(0);
		unblocked.rowMasks.fill(0);
		unblocked.groupMasks.fill(0);
		refingerprint(unblocked);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(unblocked)).toBe(
			"STATE_MISMATCH",
		);
	});

	it("rejects scalar count contradictions before trusting the checksum", () => {
		const valid = captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation());
		const overflow = mutableClone(valid);
		overflow.includedPortCount = 3;
		overflow.rejectedPortCount = 1;
		refingerprint(overflow);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(overflow)).toBe(
			"SCALAR_MISMATCH",
		);

		const groupOverflow = mutableClone(valid);
		groupOverflow.equipmentGroupCount = 3;
		refingerprint(groupOverflow);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(groupOverflow)).toBe(
			"SCALAR_MISMATCH",
		);

		const tooManyRows = mutableClone(valid);
		tooManyRows.proposalRowCount = OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_ROWS + 1;
		refingerprint(tooManyRows);
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(tooManyRows)).toBe(
			"SCALAR_MISMATCH",
		);
	});

	it("detects scalar or column tampering through the deterministic snapshot fingerprint", () => {
		const ready = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(
				evaluationFixture({
					state: "READY",
					proposalRowCount: 3,
					includedPortCount: 2,
					rejectedPortCount: 1,
					equipmentGroupCount: 1,
					reviewFingerprint: READY_FINGERPRINT,
				}),
			),
		);
		ready.reviewFingerprint = "openfab-station-proposal-review:v1:fedcba98:76543210";
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(ready)).toBe(
			"SNAPSHOT_FINGERPRINT_MISMATCH",
		);

		const blocked = mutableClone(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		);
		blocked.snapshotFingerprint = `${blocked.snapshotFingerprint.slice(0, -1)}${
			blocked.snapshotFingerprint.endsWith("0") ? "1" : "0"
		}`;
		expect(openFabStationProposalReviewEvaluationArtifactShapeError(blocked)).toBe(
			"SNAPSHOT_FINGERPRINT_MISMATCH",
		);
	});

	it("returns fixed validation codes even when hostile accessors throw secret values", () => {
		const secret = "TOP_SECRET_VALIDATION_VALUE";
		const hostile = {} as Record<string, unknown>;
		for (const key of Object.keys(
			captureOpenFabStationProposalReviewEvaluationArtifact(blockedEvaluation()),
		)) {
			Object.defineProperty(hostile, key, {
				enumerable: true,
				get: () => {
					throw new Error(secret);
				},
			});
		}

		expect(openFabStationProposalReviewEvaluationArtifactShapeError(hostile)).toBe(
			"CONTRACT_MISMATCH",
		);
		expect(() => validateOpenFabStationProposalReviewEvaluationArtifact(hostile)).toThrow(
			"CONTRACT_MISMATCH",
		);
		try {
			validateOpenFabStationProposalReviewEvaluationArtifact(hostile);
		} catch (error) {
			expect((error as Error).message).not.toContain(secret);
		}
	});
});

interface EvaluationFixtureOptions {
	readonly state: OpenFabStationProposalReviewState;
	readonly proposalRowCount: number;
	readonly groupDecisionCount?: number;
	readonly includedPortCount: number;
	readonly rejectedPortCount: number;
	readonly equipmentGroupCount: number;
	readonly reviewFingerprint?: string | null;
	readonly issueCount?: (code: OpenFabStationProposalReviewIssueCode) => number;
	readonly rowIssueMask?: (row: number) => number;
	readonly groupIssueMask?: (group: number) => number;
}

function evaluationFixture(
	options: EvaluationFixtureOptions,
): OpenFabStationProposalReviewEvaluation {
	return Object.freeze({
		kind: "openfab-station-proposal-review-evaluation" as const,
		version: OPENFAB_STATION_PROPOSAL_REVIEW_VERSION,
		state: options.state,
		proposalRowCount: options.proposalRowCount,
		groupDecisionCount: options.groupDecisionCount ?? options.equipmentGroupCount,
		includedPortCount: options.includedPortCount,
		rejectedPortCount: options.rejectedPortCount,
		equipmentGroupCount: options.equipmentGroupCount,
		reviewFingerprint: options.reviewFingerprint ?? null,
		issueCount: options.issueCount ?? (() => 0),
		rowIssueMask: options.rowIssueMask ?? (() => 0),
		groupIssueMask: options.groupIssueMask ?? (() => 0),
	});
}

function blockedEvaluation(groupDecisionCount = 2): OpenFabStationProposalReviewEvaluation {
	const issueCounts = counts({
		INVALID_DRAFT: 1,
		ROW_DECISION_MISSING: 1,
		GROUP_KIND_MISMATCH: 2,
	});
	const rowMasks = Uint32Array.of(bit("ROW_DECISION_MISSING"), 0, bit("GROUP_KIND_MISMATCH"));
	const groupMasks = Uint32Array.of(bit("GROUP_KIND_MISMATCH"), 0);
	return evaluationFixture({
		state: "BLOCKED",
		proposalRowCount: 3,
		groupDecisionCount,
		includedPortCount: 1,
		rejectedPortCount: 1,
		equipmentGroupCount: 1,
		issueCount: (code) => issueCounts[issueIndex(code)] as number,
		rowIssueMask: (row) => rowMasks[row] ?? 0,
		groupIssueMask: (group) => groupMasks[group] ?? 0,
	});
}

function maximumBlockedArtifact(): OpenFabStationProposalReviewEvaluationArtifact {
	return captureOpenFabStationProposalReviewEvaluationArtifact(
		evaluationFixture({
			state: "BLOCKED",
			proposalRowCount: OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_ROWS,
			groupDecisionCount: OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_GROUPS,
			includedPortCount: 0,
			rejectedPortCount: 0,
			equipmentGroupCount: 0,
			issueCount: (code) => (code === "INVALID_SOURCE" ? 1 : 0),
		}),
	);
}

function counts(
	values: Partial<Record<OpenFabStationProposalReviewIssueCode, number>>,
): Uint32Array {
	return Uint32Array.from(
		OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES.map((code) => values[code] ?? 0),
	);
}

function bit(code: OpenFabStationProposalReviewIssueCode): number {
	return 2 ** issueIndex(code);
}

function issueIndex(code: OpenFabStationProposalReviewIssueCode): number {
	return OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES.indexOf(code);
}

type MutableArtifact = {
	-readonly [Key in keyof OpenFabStationProposalReviewEvaluationArtifact]: OpenFabStationProposalReviewEvaluationArtifact[Key];
};

function mutableClone(artifact: OpenFabStationProposalReviewEvaluationArtifact): MutableArtifact {
	return structuredClone(artifact) as MutableArtifact;
}

function refingerprint(artifact: MutableArtifact): void {
	artifact.snapshotFingerprint =
		openFabStationProposalReviewEvaluationSnapshotFingerprint(artifact);
}
