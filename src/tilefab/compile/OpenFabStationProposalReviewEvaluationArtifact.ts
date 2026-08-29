import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	OPENFAB_STATION_PROPOSAL_REVIEW_GLOBAL_ONLY_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_GROUP_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_ROW_ISSUE_CODES,
	OPENFAB_STATION_PROPOSAL_REVIEW_VERSION,
	type OpenFabStationProposalReviewEvaluation,
	type OpenFabStationProposalReviewIssueCode,
	type OpenFabStationProposalReviewState,
} from "./OpenFabStationProposalReview";

export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ARTIFACT_VERSION = 1 as const;
export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_ROWS = 100_000;
export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_GROUPS = 100_000;
export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_TRANSFER_BYTES = 1024 * 1024;
export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT = 29;

/** Version-one bit positions are immutable; adding a review issue requires an artifact version bump. */
export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_CODES = Object.freeze([
	"INVALID_SOURCE",
	"INVALID_DRAFT",
	"PROPOSAL_REJECTIONS_UNACKNOWLEDGED",
	"UNKNOWN_COLUMNS_UNACKNOWLEDGED",
	"ORGANIZATION_POLICY_UNRESOLVED",
	"ROW_DECISION_OUT_OF_RANGE",
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
	"GROUP_DECISION_INVALID",
	"GROUP_ID_DUPLICATE",
	"GROUP_MEMBER_OUT_OF_RANGE",
	"GROUP_MEMBER_DUPLICATE",
	"GROUP_MEMBER_REJECTED",
	"ROW_GROUP_MISSING",
	"ROW_GROUP_MULTIPLE",
	"GROUP_KIND_MISMATCH",
	"GROUPING_REVIEW_INVALID",
	"EQUIPMENT_GROUP_INVALID",
	"ID_ALLOCATION_EXHAUSTED",
	"PROSPECTIVE_LAYOUT_INVALID",
] as const satisfies readonly OpenFabStationProposalReviewIssueCode[]);

export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ARTIFACT_ERROR_CODES = Object.freeze([
	"NOT_OBJECT",
	"CONTRACT_MISMATCH",
	"SCALAR_MISMATCH",
	"TYPED_ARRAY_MISMATCH",
	"BUFFER_OWNERSHIP_MISMATCH",
	"COLUMN_LENGTH_MISMATCH",
	"TRANSFER_BUDGET_EXCEEDED",
	"BITMASK_MISMATCH",
	"ISSUE_COUNT_MISMATCH",
	"STATE_MISMATCH",
	"SNAPSHOT_FINGERPRINT_MISMATCH",
] as const);

export type OpenFabStationProposalReviewEvaluationArtifactErrorCode =
	(typeof OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ARTIFACT_ERROR_CODES)[number];

export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR =
	"OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_FAILED" as const;
export const OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR =
	"OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_FAILED" as const;

export interface OpenFabStationProposalReviewEvaluationArtifact {
	readonly kind: "openfab-station-proposal-review-evaluation-artifact";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ARTIFACT_VERSION;
	readonly state: OpenFabStationProposalReviewState;
	readonly proposalRowCount: number;
	readonly groupDecisionCount: number;
	readonly includedPortCount: number;
	readonly rejectedPortCount: number;
	readonly equipmentGroupCount: number;
	readonly reviewFingerprint: string | null;
	readonly issueCounts: Uint32Array;
	readonly rowMasks: Uint32Array;
	readonly groupMasks: Uint32Array;
	readonly snapshotFingerprint: string;
}

/** Read-only main-realm preview. It deliberately cannot be finalized as a review evaluation. */
export interface HydratedOpenFabStationProposalReviewEvaluationPreview {
	readonly kind: "hydrated-openfab-station-proposal-review-evaluation-preview";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ARTIFACT_VERSION;
	readonly state: OpenFabStationProposalReviewState;
	readonly proposalRowCount: number;
	readonly groupDecisionCount: number;
	readonly includedPortCount: number;
	readonly rejectedPortCount: number;
	readonly equipmentGroupCount: number;
	readonly reviewFingerprint: string | null;
	readonly snapshotFingerprint: string;
	issueCount(code: OpenFabStationProposalReviewIssueCode): number;
	rowIssueMask(row: number): number;
	groupIssueMask(group: number): number;
}

export interface OpenFabStationProposalReviewEvaluationCooperativeHydrationOptions {
	readonly checkpoint: () => Promise<void>;
	/** Monotonic request/project generation. Any change makes preview installation terminally stale. */
	readonly revision: () => number;
	readonly signal?: AbortSignal;
	readonly now?: () => number;
	readonly sliceMilliseconds?: number;
}

const ARTIFACT_KIND = "openfab-station-proposal-review-evaluation-artifact" as const;
const HYDRATED_KIND = "hydrated-openfab-station-proposal-review-evaluation-preview" as const;
const SNAPSHOT_FINGERPRINT_PREFIX = "openfab-station-proposal-review-evaluation-snapshot:v1:";
const REVIEW_FINGERPRINT_PATTERN = /^openfab-station-proposal-review:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const SNAPSHOT_FINGERPRINT_PATTERN =
	/^openfab-station-proposal-review-evaluation-snapshot:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const DEFINED_ISSUE_MASK = 2 ** OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT - 1;
const GLOBAL_ONLY_ISSUE_MASK = issueMaskForCodes(
	OPENFAB_STATION_PROPOSAL_REVIEW_GLOBAL_ONLY_ISSUE_CODES,
);
const ROW_ISSUE_MASK = issueMaskForCodes(OPENFAB_STATION_PROPOSAL_REVIEW_ROW_ISSUE_CODES);
const GROUP_ISSUE_MASK = issueMaskForCodes(OPENFAB_STATION_PROPOSAL_REVIEW_GROUP_ISSUE_CODES);
const LOCAL_ISSUE_MASK = ROW_ISSUE_MASK | GROUP_ISSUE_MASK;
const hydratedEvaluationPreviews = new WeakSet<object>();
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint32Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, "buffer");
const TYPED_ARRAY_BYTE_OFFSET_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, "byteOffset");
const TYPED_ARRAY_BYTE_LENGTH_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, "byteLength");
const TYPED_ARRAY_LENGTH_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, "length");
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = intrinsicGetter(ArrayBuffer.prototype, "byteLength");
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"resizable",
)?.get;
const ARRAY_BUFFER_SLICE = ArrayBuffer.prototype.slice;
const ABORT_SIGNAL_ABORTED_GETTER = intrinsicGetter(AbortSignal.prototype, "aborted");
const DEFAULT_COOPERATIVE_HYDRATION_SLICE_MILLISECONDS = 4;
const MAX_COOPERATIVE_HYDRATION_SLICE_MILLISECONDS = 4;
const COOPERATIVE_MASKS_PER_TIME_CHECK = 256;
const COOPERATIVE_CHECKSUM_BYTES_PER_TIME_CHECK = 64 * 1024;

const ARTIFACT_KEYS = Object.freeze([
	"kind",
	"version",
	"state",
	"proposalRowCount",
	"groupDecisionCount",
	"includedPortCount",
	"rejectedPortCount",
	"equipmentGroupCount",
	"reviewFingerprint",
	"issueCounts",
	"rowMasks",
	"groupMasks",
	"snapshotFingerprint",
] as const);

/** Capture every method-based issue field exactly once into an owned transferable artifact. */
export function captureOpenFabStationProposalReviewEvaluationArtifact(
	evaluation: OpenFabStationProposalReviewEvaluation,
): OpenFabStationProposalReviewEvaluationArtifact {
	try {
		const kind = evaluation.kind;
		const reviewVersion = evaluation.version;
		const state = evaluation.state;
		const proposalRowCount = evaluation.proposalRowCount;
		const groupDecisionCount = evaluation.groupDecisionCount;
		const includedPortCount = evaluation.includedPortCount;
		const rejectedPortCount = evaluation.rejectedPortCount;
		const equipmentGroupCount = evaluation.equipmentGroupCount;
		const reviewFingerprint = evaluation.reviewFingerprint;
		const issueCount = evaluation.issueCount;
		const rowIssueMask = evaluation.rowIssueMask;
		const groupIssueMask = evaluation.groupIssueMask;

		if (
			kind !== "openfab-station-proposal-review-evaluation" ||
			reviewVersion !== OPENFAB_STATION_PROPOSAL_REVIEW_VERSION ||
			!boundedCount(proposalRowCount, OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_ROWS) ||
			!boundedCount(groupDecisionCount, OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_GROUPS) ||
			typeof issueCount !== "function" ||
			typeof rowIssueMask !== "function" ||
			typeof groupIssueMask !== "function"
		) {
			throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR);
		}

		const issueCounts = new Uint32Array(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT);
		for (let index = 0; index < OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT; index++) {
			const code = OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_CODES[
				index
			] as OpenFabStationProposalReviewIssueCode;
			const count = Reflect.apply(issueCount, evaluation, [code]) as unknown;
			const bit = 2 ** index;
			const maximumIssueCount =
				(GLOBAL_ONLY_ISSUE_MASK & bit) !== 0 ? 1 : proposalRowCount + groupDecisionCount;
			if (!boundedCount(count, maximumIssueCount)) {
				throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR);
			}
			issueCounts[index] = count;
		}

		const rowMasks = new Uint32Array(proposalRowCount);
		for (let row = 0; row < proposalRowCount; row++) {
			const mask = Reflect.apply(rowIssueMask, evaluation, [row]) as unknown;
			if (!validLocalIssueMask(mask, ROW_ISSUE_MASK)) {
				throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR);
			}
			rowMasks[row] = mask;
		}

		const groupMasks = new Uint32Array(groupDecisionCount);
		for (let group = 0; group < groupDecisionCount; group++) {
			const mask = Reflect.apply(groupIssueMask, evaluation, [group]) as unknown;
			if (!validLocalIssueMask(mask, GROUP_ISSUE_MASK)) {
				throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR);
			}
			groupMasks[group] = mask;
		}

		const withoutFingerprint = {
			kind: ARTIFACT_KIND,
			version: OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ARTIFACT_VERSION,
			state,
			proposalRowCount,
			groupDecisionCount,
			includedPortCount,
			rejectedPortCount,
			equipmentGroupCount,
			reviewFingerprint,
			issueCounts,
			rowMasks,
			groupMasks,
		};
		const artifact: OpenFabStationProposalReviewEvaluationArtifact = Object.freeze({
			...withoutFingerprint,
			snapshotFingerprint:
				openFabStationProposalReviewEvaluationSnapshotFingerprint(withoutFingerprint),
		});
		if (openFabStationProposalReviewEvaluationArtifactShapeError(artifact) !== null) {
			throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR);
		}
		return artifact;
	} catch {
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_CAPTURE_ERROR);
	}
}

export function openFabStationProposalReviewEvaluationSnapshotFingerprint(
	artifact: Omit<OpenFabStationProposalReviewEvaluationArtifact, "snapshotFingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([artifact.kind, artifact.state, artifact.reviewFingerprint ?? ""]);
	checksum.addNumbers([
		artifact.version,
		artifact.proposalRowCount,
		artifact.groupDecisionCount,
		artifact.includedPortCount,
		artifact.rejectedPortCount,
		artifact.equipmentGroupCount,
	]);
	checksum.addViews([
		intrinsicChecksumView(artifact.issueCounts),
		intrinsicChecksumView(artifact.rowMasks),
		intrinsicChecksumView(artifact.groupMasks),
	]);
	return `${SNAPSHOT_FINGERPRINT_PREFIX}${checksum.digest()}`;
}

export function openFabStationProposalReviewEvaluationArtifactShapeError(
	value: unknown,
): OpenFabStationProposalReviewEvaluationArtifactErrorCode | null {
	const captured = captureEvaluationArtifactIdentity(value);
	if (!captured.ok) return captured.error;
	const shallowError = capturedEvaluationArtifactShallowShapeError(captured.artifact);
	if (shallowError) return shallowError;
	return openFabStationProposalReviewEvaluationArtifactValueError(captured.artifact);
}

function capturedEvaluationArtifactShallowShapeError(
	artifact: OpenFabStationProposalReviewEvaluationArtifact,
): OpenFabStationProposalReviewEvaluationArtifactErrorCode | null {
	try {
		if (
			artifact.kind !== ARTIFACT_KIND ||
			artifact.version !== OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ARTIFACT_VERSION
		) {
			return "CONTRACT_MISMATCH";
		}
		if (
			!reviewState(artifact.state) ||
			!boundedCount(
				artifact.proposalRowCount,
				OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_ROWS,
			) ||
			!boundedCount(
				artifact.groupDecisionCount,
				OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_GROUPS,
			) ||
			!boundedCount(artifact.includedPortCount, artifact.proposalRowCount) ||
			!boundedCount(artifact.rejectedPortCount, artifact.proposalRowCount) ||
			artifact.includedPortCount + artifact.rejectedPortCount > artifact.proposalRowCount ||
			!boundedCount(artifact.equipmentGroupCount, artifact.groupDecisionCount) ||
			!validReviewFingerprintScalar(artifact.reviewFingerprint) ||
			typeof artifact.snapshotFingerprint !== "string" ||
			!SNAPSHOT_FINGERPRINT_PATTERN.test(artifact.snapshotFingerprint)
		) {
			return "SCALAR_MISMATCH";
		}
		if (
			!isExactUint32Array(artifact.issueCounts) ||
			!isExactUint32Array(artifact.rowMasks) ||
			!isExactUint32Array(artifact.groupMasks)
		) {
			return "TYPED_ARRAY_MISMATCH";
		}
		if (!arraysOwnUniqueBuffers([artifact.issueCounts, artifact.rowMasks, artifact.groupMasks])) {
			return "BUFFER_OWNERSHIP_MISMATCH";
		}
		if (
			intrinsicViewLength(artifact.issueCounts) !==
				OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT ||
			intrinsicViewLength(artifact.rowMasks) !== artifact.proposalRowCount ||
			intrinsicViewLength(artifact.groupMasks) !== artifact.groupDecisionCount
		) {
			return "COLUMN_LENGTH_MISMATCH";
		}
		if (
			artifactTransferByteLength(artifact) >
			OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_TRANSFER_BYTES
		) {
			return "TRANSFER_BUDGET_EXCEEDED";
		}
		if (
			(GLOBAL_ONLY_ISSUE_MASK & LOCAL_ISSUE_MASK) !== 0 ||
			(GLOBAL_ONLY_ISSUE_MASK | LOCAL_ISSUE_MASK) !== DEFINED_ISSUE_MASK
		) {
			return "CONTRACT_MISMATCH";
		}
		return null;
	} catch {
		return "CONTRACT_MISMATCH";
	}
}

function openFabStationProposalReviewEvaluationArtifactValueError(
	artifact: OpenFabStationProposalReviewEvaluationArtifact,
): OpenFabStationProposalReviewEvaluationArtifactErrorCode | null {
	try {
		const localOccurrenceCounts = new Uint32Array(
			OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT,
		);
		for (let row = 0; row < artifact.proposalRowCount; row++) {
			const mask = artifact.rowMasks[row] as number;
			if (!validLocalIssueMask(mask, ROW_ISSUE_MASK)) return "BITMASK_MISMATCH";
			addMaskOccurrences(localOccurrenceCounts, mask);
		}
		for (let group = 0; group < artifact.groupDecisionCount; group++) {
			const mask = artifact.groupMasks[group] as number;
			if (!validLocalIssueMask(mask, GROUP_ISSUE_MASK)) return "BITMASK_MISMATCH";
			addMaskOccurrences(localOccurrenceCounts, mask);
		}
		const countError = issueCountsAndStateError(artifact, localOccurrenceCounts);
		if (countError) return countError;
		if (
			openFabStationProposalReviewEvaluationSnapshotFingerprint(artifact) !==
			artifact.snapshotFingerprint
		) {
			return "SNAPSHOT_FINGERPRINT_MISMATCH";
		}
		return null;
	} catch {
		return "CONTRACT_MISMATCH";
	}
}

export function validateOpenFabStationProposalReviewEvaluationArtifact(
	value: unknown,
): asserts value is OpenFabStationProposalReviewEvaluationArtifact {
	const error = openFabStationProposalReviewEvaluationArtifactShapeError(value);
	if (error) throw new Error(error);
}

export function openFabStationProposalReviewEvaluationArtifactTransfers(
	value: unknown,
): ArrayBuffer[] {
	const captured = validatedEvaluationArtifactIdentity(value);
	return artifactTransferBuffersUnchecked(captured);
}

/**
 * Synchronous compatibility path. Future main-thread bridges should use the cooperative API below
 * for maximum-size artifacts. Validation and intrinsic transfer collection share one uninterrupted
 * tick, so the adopted fixed buffers do not need a redundant second full scan.
 */
export function hydrateOpenFabStationProposalReviewEvaluationArtifact(
	value: unknown,
): HydratedOpenFabStationProposalReviewEvaluationPreview {
	const captured = validatedEvaluationArtifactIdentity(value);
	let adopted: OpenFabStationProposalReviewEvaluationArtifact;
	try {
		adopted = structuredClone(captured, {
			transfer: artifactTransferBuffersUnchecked(captured),
		});
	} catch {
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
	}
	return createHydratedPreview(adopted);
}

/**
 * Preferred main-thread adoption path: shallow-check and transfer first, then validate the private
 * fixed-buffer snapshot in cancellable four-millisecond slices before exposing a preview.
 */
export async function hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(
	value: unknown,
	options: OpenFabStationProposalReviewEvaluationCooperativeHydrationOptions,
): Promise<HydratedOpenFabStationProposalReviewEvaluationPreview> {
	const cooperative = resolveCooperativeHydrationOptions(options);
	cooperative.throwIfAborted();
	const captured = captureEvaluationArtifactIdentity(value);
	if (!captured.ok) throw new Error(captured.error);
	const shallowError = capturedEvaluationArtifactShallowShapeError(captured.artifact);
	if (shallowError) throw new Error(shallowError);
	cooperative.throwIfAborted();
	const source = captured.artifact;
	let adopted: OpenFabStationProposalReviewEvaluationArtifact;
	try {
		adopted = structuredClone(source, {
			transfer: artifactTransferBuffersUnchecked(source),
		});
	} catch {
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
	}
	let adoptedError: OpenFabStationProposalReviewEvaluationArtifactErrorCode | null;
	try {
		await cooperative.checkpointNow();
		adoptedError = await openFabStationProposalReviewEvaluationArtifactValueErrorCooperatively(
			adopted,
			cooperative,
		);
		if (!adoptedError) await cooperative.checkpointNow();
	} catch {
		cooperative.throwIfAborted();
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
	}
	if (adoptedError) throw new Error(adoptedError);
	return createHydratedPreview(adopted);
}

function createHydratedPreview(
	adopted: OpenFabStationProposalReviewEvaluationArtifact,
): HydratedOpenFabStationProposalReviewEvaluationPreview {
	const preview = Object.freeze({
		kind: HYDRATED_KIND,
		version: adopted.version,
		state: adopted.state,
		proposalRowCount: adopted.proposalRowCount,
		groupDecisionCount: adopted.groupDecisionCount,
		includedPortCount: adopted.includedPortCount,
		rejectedPortCount: adopted.rejectedPortCount,
		equipmentGroupCount: adopted.equipmentGroupCount,
		reviewFingerprint: adopted.reviewFingerprint,
		snapshotFingerprint: adopted.snapshotFingerprint,
		issueCount(code: OpenFabStationProposalReviewIssueCode): number {
			const index = reviewIssueIndex(code);
			return index < 0 ? 0 : (adopted.issueCounts[index] as number);
		},
		rowIssueMask(row: number): number {
			return Number.isInteger(row) && row >= 0 && row < adopted.proposalRowCount
				? (adopted.rowMasks[row] as number)
				: 0;
		},
		groupIssueMask(group: number): number {
			return Number.isInteger(group) && group >= 0 && group < adopted.groupDecisionCount
				? (adopted.groupMasks[group] as number)
				: 0;
		},
	});
	hydratedEvaluationPreviews.add(preview);
	return preview;
}

/** Exact main-realm identity check; copied preview facades cannot arm an Apply permit. */
export function isHydratedOpenFabStationProposalReviewEvaluationPreview(
	value: unknown,
): value is HydratedOpenFabStationProposalReviewEvaluationPreview {
	return typeof value === "object" && value !== null && hydratedEvaluationPreviews.has(value);
}

/** Terminally consume the exact genuine preview evidence retained by cooperative hydration. */
export function consumeHydratedOpenFabStationProposalReviewEvaluationPreview(
	value: unknown,
): value is HydratedOpenFabStationProposalReviewEvaluationPreview {
	if (typeof value !== "object" || value === null) return false;
	const genuine = hydratedEvaluationPreviews.has(value);
	hydratedEvaluationPreviews.delete(value);
	return genuine;
}

async function openFabStationProposalReviewEvaluationArtifactValueErrorCooperatively(
	artifact: OpenFabStationProposalReviewEvaluationArtifact,
	cooperative: CooperativeHydrationController,
): Promise<OpenFabStationProposalReviewEvaluationArtifactErrorCode | null> {
	const localOccurrenceCounts = new Uint32Array(
		OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT,
	);
	for (let row = 0; row < artifact.proposalRowCount; row++) {
		const mask = artifact.rowMasks[row] as number;
		if (!validLocalIssueMask(mask, ROW_ISSUE_MASK)) return "BITMASK_MISMATCH";
		addMaskOccurrences(localOccurrenceCounts, mask);
		if ((row + 1) % COOPERATIVE_MASKS_PER_TIME_CHECK === 0) {
			await cooperative.checkpointIfDue();
		}
	}
	for (let group = 0; group < artifact.groupDecisionCount; group++) {
		const mask = artifact.groupMasks[group] as number;
		if (!validLocalIssueMask(mask, GROUP_ISSUE_MASK)) return "BITMASK_MISMATCH";
		addMaskOccurrences(localOccurrenceCounts, mask);
		if ((group + 1) % COOPERATIVE_MASKS_PER_TIME_CHECK === 0) {
			await cooperative.checkpointIfDue();
		}
	}
	const countError = issueCountsAndStateError(artifact, localOccurrenceCounts);
	if (countError) return countError;
	const fingerprint = await openFabStationProposalReviewEvaluationSnapshotFingerprintCooperatively(
		artifact,
		cooperative,
	);
	return fingerprint === artifact.snapshotFingerprint ? null : "SNAPSHOT_FINGERPRINT_MISMATCH";
}

function issueCountsAndStateError(
	artifact: OpenFabStationProposalReviewEvaluationArtifact,
	localOccurrenceCounts: Uint32Array,
): "ISSUE_COUNT_MISMATCH" | "STATE_MISMATCH" | null {
	let totalIssueCount = 0;
	for (let index = 0; index < OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_COUNT; index++) {
		const count = artifact.issueCounts[index] as number;
		const bit = 2 ** index;
		const occurrences = localOccurrenceCounts[index] as number;
		if ((GLOBAL_ONLY_ISSUE_MASK & bit) !== 0 ? count !== 0 && count !== 1 : count !== occurrences) {
			return "ISSUE_COUNT_MISMATCH";
		}
		totalIssueCount += count;
	}
	return stateCountsAreConsistent(artifact, totalIssueCount) ? null : "STATE_MISMATCH";
}

async function openFabStationProposalReviewEvaluationSnapshotFingerprintCooperatively(
	artifact: OpenFabStationProposalReviewEvaluationArtifact,
	cooperative: CooperativeHydrationController,
): Promise<string> {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([artifact.kind, artifact.state, artifact.reviewFingerprint ?? ""]);
	checksum.addNumbers([
		artifact.version,
		artifact.proposalRowCount,
		artifact.groupDecisionCount,
		artifact.includedPortCount,
		artifact.rejectedPortCount,
		artifact.equipmentGroupCount,
	]);
	await checksum.addViewsCooperatively(
		[
			intrinsicChecksumView(artifact.issueCounts),
			intrinsicChecksumView(artifact.rowMasks),
			intrinsicChecksumView(artifact.groupMasks),
		],
		() => cooperative.checkpointIfDue(),
		COOPERATIVE_CHECKSUM_BYTES_PER_TIME_CHECK,
	);
	return `${SNAPSHOT_FINGERPRINT_PREFIX}${checksum.digest()}`;
}

interface CooperativeHydrationController {
	checkpointIfDue(): Promise<void>;
	checkpointNow(): Promise<void>;
	throwIfAborted(): void;
}

function resolveCooperativeHydrationOptions(
	options: OpenFabStationProposalReviewEvaluationCooperativeHydrationOptions,
): CooperativeHydrationController {
	try {
		if (!options) throw new TypeError();
		const checkpoint = options.checkpoint;
		const revision = options.revision;
		const signal = options.signal;
		if (typeof checkpoint !== "function" || typeof revision !== "function") throw new TypeError();
		const now = options.now ?? (() => performance.now());
		if (typeof now !== "function") throw new TypeError();
		const sliceMilliseconds =
			options.sliceMilliseconds ?? DEFAULT_COOPERATIVE_HYDRATION_SLICE_MILLISECONDS;
		if (
			!Number.isFinite(sliceMilliseconds) ||
			sliceMilliseconds <= 0 ||
			sliceMilliseconds > MAX_COOPERATIVE_HYDRATION_SLICE_MILLISECONDS
		) {
			throw new TypeError();
		}
		const expectedRevision = readCooperativeHydrationRevision(revision);
		let sliceStartedAt = readCooperativeHydrationTime(now);
		const throwIfAborted = (): void => {
			if (readCooperativeHydrationRevision(revision) !== expectedRevision) {
				throw cooperativeHydrationAbortError();
			}
			if (signal === undefined) return;
			let aborted: unknown;
			try {
				aborted = Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []);
			} catch {
				throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
			}
			if (typeof aborted !== "boolean") {
				throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
			}
			if (aborted) throw cooperativeHydrationAbortError();
		};
		const checkpointNow = async (): Promise<void> => {
			throwIfAborted();
			try {
				await checkpoint();
			} catch {
				throwIfAborted();
				throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
			}
			throwIfAborted();
			sliceStartedAt = readCooperativeHydrationTime(now);
		};
		return Object.freeze({
			async checkpointIfDue(): Promise<void> {
				throwIfAborted();
				const current = readCooperativeHydrationTime(now);
				if (current < sliceStartedAt) {
					sliceStartedAt = current;
					return;
				}
				if (current - sliceStartedAt < sliceMilliseconds) return;
				await checkpointNow();
			},
			checkpointNow,
			throwIfAborted,
		});
	} catch {
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
	}
}

function readCooperativeHydrationRevision(revision: () => number): number {
	let value: unknown;
	try {
		value = revision();
	} catch {
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
	}
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
	}
	return value as number;
}

function readCooperativeHydrationTime(now: () => number): number {
	let value: number;
	try {
		value = now();
	} catch {
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
	}
	if (!Number.isFinite(value)) {
		throw new Error(OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ERROR);
	}
	return value;
}

function cooperativeHydrationAbortError(): Error {
	const error = new Error("OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_HYDRATION_ABORTED");
	error.name = "AbortError";
	return error;
}

function stateCountsAreConsistent(
	artifact: OpenFabStationProposalReviewEvaluationArtifact,
	totalIssueCount: number,
): boolean {
	if (artifact.state === "BLOCKED") {
		return totalIssueCount > 0 && artifact.reviewFingerprint === null;
	}
	if (totalIssueCount !== 0) return false;
	if (artifact.state === "NO_CHANGES") {
		return (
			artifact.reviewFingerprint === null &&
			artifact.includedPortCount === 0 &&
			artifact.rejectedPortCount === artifact.proposalRowCount &&
			artifact.equipmentGroupCount === 0 &&
			artifact.groupDecisionCount === 0
		);
	}
	return (
		artifact.reviewFingerprint !== null &&
		artifact.proposalRowCount > 0 &&
		artifact.includedPortCount > 0 &&
		artifact.includedPortCount + artifact.rejectedPortCount === artifact.proposalRowCount &&
		artifact.equipmentGroupCount > 0 &&
		artifact.equipmentGroupCount === artifact.groupDecisionCount &&
		artifact.equipmentGroupCount <= artifact.includedPortCount
	);
}

function addMaskOccurrences(counts: Uint32Array, mask: number): void {
	for (let index = 0; index < counts.length; index++) {
		if ((mask & (2 ** index)) !== 0) counts[index] = (counts[index] as number) + 1;
	}
}

function artifactTransferByteLength(
	artifact: OpenFabStationProposalReviewEvaluationArtifact,
): number {
	return (
		intrinsicViewByteLength(artifact.issueCounts) +
		intrinsicViewByteLength(artifact.rowMasks) +
		intrinsicViewByteLength(artifact.groupMasks)
	);
}

function arraysOwnUniqueBuffers(arrays: readonly Uint32Array[]): boolean {
	const buffers = new Set<ArrayBuffer>();
	for (const array of arrays) {
		const view = intrinsicViewMetadata(array);
		if (!view || view.byteOffset !== 0 || view.byteLength !== view.bufferByteLength) return false;
		if (view.resizable || arrayBufferIsDetached(view.buffer) || buffers.has(view.buffer))
			return false;
		buffers.add(view.buffer);
	}
	return true;
}

function arrayBufferIsDetached(buffer: ArrayBuffer): boolean {
	try {
		Reflect.apply(ARRAY_BUFFER_SLICE, buffer, [0, 0]);
		return false;
	} catch {
		return true;
	}
}

function validIssueMask(value: unknown): value is number {
	return isUint32(value) && ((value as number) & ~DEFINED_ISSUE_MASK) === 0;
}

function validLocalIssueMask(value: unknown, allowedMask: number): value is number {
	return validIssueMask(value) && ((value as number) & ~allowedMask) === 0;
}

function issueMaskForCodes(codes: readonly OpenFabStationProposalReviewIssueCode[]): number {
	let mask = 0;
	for (const code of codes) {
		const index = OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_CODES.indexOf(code);
		if (index >= 0) mask |= 2 ** index;
	}
	return mask;
}

interface IntrinsicUint32ViewMetadata {
	readonly buffer: ArrayBuffer;
	readonly bufferByteLength: number;
	readonly byteOffset: number;
	readonly byteLength: number;
	readonly length: number;
	readonly resizable: boolean;
}

function isExactUint32Array(value: unknown): value is Uint32Array {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.getPrototypeOf(value) === Uint32Array.prototype
	);
}

function intrinsicViewMetadata(array: Uint32Array): IntrinsicUint32ViewMetadata | null {
	try {
		for (const key of ["buffer", "byteOffset", "byteLength", "length"] as const) {
			if (Object.hasOwn(array, key)) return null;
		}
		if (Object.hasOwn(array, Symbol.iterator)) return null;
		const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, array, []) as unknown;
		const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, array, []) as unknown;
		const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, array, []) as unknown;
		const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, array, []) as unknown;
		const bufferByteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []) as unknown;
		const resizable = ARRAY_BUFFER_RESIZABLE_GETTER
			? (Reflect.apply(ARRAY_BUFFER_RESIZABLE_GETTER, buffer, []) as unknown)
			: false;
		if (
			!(buffer instanceof ArrayBuffer) ||
			typeof bufferByteLength !== "number" ||
			typeof byteOffset !== "number" ||
			typeof byteLength !== "number" ||
			typeof length !== "number" ||
			typeof resizable !== "boolean"
		) {
			return null;
		}
		return { buffer, bufferByteLength, byteOffset, byteLength, length, resizable };
	} catch {
		return null;
	}
}

function intrinsicViewLength(array: Uint32Array): number {
	return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, array, []) as number;
}

function intrinsicViewByteLength(array: Uint32Array): number {
	return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, array, []) as number;
}

function intrinsicChecksumView(array: Uint32Array): Uint8Array {
	const metadata = intrinsicViewMetadata(array);
	if (!metadata) throw new TypeError("Invalid Uint32Array backing.");
	return new Uint8Array(metadata.buffer, metadata.byteOffset, metadata.byteLength);
}

function artifactTransferBuffersUnchecked(
	artifact: OpenFabStationProposalReviewEvaluationArtifact,
): ArrayBuffer[] {
	return [artifact.issueCounts, artifact.rowMasks, artifact.groupMasks].map((array) => {
		const metadata = intrinsicViewMetadata(array);
		if (!metadata) throw new TypeError("Invalid Uint32Array backing.");
		return metadata.buffer;
	});
}

type CapturedEvaluationArtifactIdentity =
	| Readonly<{
			ok: true;
			artifact: OpenFabStationProposalReviewEvaluationArtifact;
	  }>
	| Readonly<{
			ok: false;
			error: "NOT_OBJECT" | "CONTRACT_MISMATCH";
	  }>;

/**
 * Pin every untrusted envelope field to one own-data identity before any validation or transfer.
 * A Proxy may participate in the diagnostic boundary, but its ordinary `get` trap is never used.
 */
function captureEvaluationArtifactIdentity(value: unknown): CapturedEvaluationArtifactIdentity {
	try {
		if (!isRecord(value)) return Object.freeze({ ok: false, error: "NOT_OBJECT" });
		if (Object.getPrototypeOf(value) !== Object.prototype || !hasExactKeys(value, ARTIFACT_KEYS)) {
			return Object.freeze({ ok: false, error: "CONTRACT_MISMATCH" });
		}
		const captured = {} as Record<string, unknown>;
		for (const key of ARTIFACT_KEYS) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				return Object.freeze({ ok: false, error: "CONTRACT_MISMATCH" });
			}
			captured[key] = descriptor.value;
		}
		return Object.freeze({
			ok: true,
			artifact: Object.freeze(
				captured as unknown as OpenFabStationProposalReviewEvaluationArtifact,
			),
		});
	} catch {
		return Object.freeze({ ok: false, error: "CONTRACT_MISMATCH" });
	}
}

function validatedEvaluationArtifactIdentity(
	value: unknown,
): OpenFabStationProposalReviewEvaluationArtifact {
	const captured = captureEvaluationArtifactIdentity(value);
	if (!captured.ok) throw new Error(captured.error);
	const shallowError = capturedEvaluationArtifactShallowShapeError(captured.artifact);
	if (shallowError) throw new Error(shallowError);
	const valueError = openFabStationProposalReviewEvaluationArtifactValueError(captured.artifact);
	if (valueError) throw new Error(valueError);
	return captured.artifact;
}

function intrinsicGetter(prototype: object, key: string): (this: unknown) => unknown {
	const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get;
	if (!getter) throw new Error(`Missing intrinsic getter: ${key}`);
	return getter;
}

function validReviewFingerprintScalar(value: unknown): value is string | null {
	return value === null || (typeof value === "string" && REVIEW_FINGERPRINT_PATTERN.test(value));
}

function reviewState(value: unknown): value is OpenFabStationProposalReviewState {
	return value === "BLOCKED" || value === "NO_CHANGES" || value === "READY";
}

function boundedCount(value: unknown, maximum: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function isUint32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function reviewIssueIndex(code: OpenFabStationProposalReviewIssueCode): number {
	return OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_CODES.indexOf(
		code as (typeof OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_ISSUE_CODES)[number],
	);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Reflect.ownKeys(value);
	if (actual.some((key) => typeof key !== "string")) return false;
	const sortedActual = (actual as string[]).sort();
	const sortedExpected = [...expected].sort();
	return (
		sortedActual.length === sortedExpected.length &&
		sortedActual.every((key, index) => key === sortedExpected[index])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
