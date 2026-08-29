import { OPENFAB_STATION_PROPOSAL_MAX_ROWS } from "../compile/OpenFabStationProposalArtifact";
import type {
	OpenFabStationProposalGroupDecision,
	OpenFabStationProposalReviewDraft,
	OpenFabStationProposalRowDecision,
} from "../compile/OpenFabStationProposalReview";
import type { AdvancedSwitchProfileClass } from "../core/AdvancedSwitch";
import { ADVANCED_SWITCH_PROFILE_CLASSES } from "../core/AdvancedSwitch";
import { STK_AUTHORING_TEMPLATES, type StkAuthoringTemplate } from "../core/EquipmentGroup";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	ADVANCED_SWITCH_ROUTE_ROLES,
	type AdvancedSwitchRouteRole,
	PORT_DIRECTIONS,
	PORT_SIDES,
	PORT_TYPES,
	type PortDirection,
	type PortSide,
	type PortType,
} from "../core/PortRecord";
import { ALL_DIRECTIONS, type Direction } from "../core/railShape";

export const OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_SNAPSHOT_VERSION = 1 as const;
export const OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_MAX_BYTES = 8 * 1024 * 1024;
export const OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT = 32;

export const OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_SNAPSHOT_ERROR_CODES = Object.freeze([
	"INVALID_INPUT",
	"CAPACITY_EXCEEDED",
	"BYTE_LIMIT_EXCEEDED",
	"INVALID_COOPERATIVE_OPTIONS",
	"ENCODE_FAILED",
	"ADOPTION_FAILED",
	"SNAPSHOT_CONTRACT_MISMATCH",
	"SNAPSHOT_SCALAR_MISMATCH",
	"SNAPSHOT_TYPED_ARRAY_MISMATCH",
	"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
	"SNAPSHOT_LENGTH_MISMATCH",
	"SNAPSHOT_VALUE_MISMATCH",
	"SNAPSHOT_CSR_MISMATCH",
	"SNAPSHOT_FINGERPRINT_MISMATCH",
] as const);

export type OpenFabStationProposalReviewDraftSnapshotErrorCode =
	(typeof OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_SNAPSHOT_ERROR_CODES)[number];

export interface OpenFabStationProposalReviewDraftSnapshot {
	readonly kind: "openfab-station-proposal-review-draft-snapshot";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_SNAPSHOT_VERSION;
	readonly proposalRowCount: number;
	readonly decisionCount: number;
	readonly groupCount: number;
	readonly membershipCount: number;
	readonly rejectedSourceRowsPolicyCode: number;
	readonly unknownColumnsPolicyCode: number;
	readonly organizationPolicyCode: number;
	readonly byteLength: number;
	readonly decisionRows: Int32Array;
	readonly decisionDispositions: Uint8Array;
	readonly rejectReasons: Uint8Array;
	readonly identityActions: Uint8Array;
	readonly portTypes: Uint8Array;
	readonly typeReviews: Uint8Array;
	readonly attachmentReviews: Uint8Array;
	readonly routeKinds: Uint8Array;
	readonly routeXs: Int32Array;
	readonly routeZs: Int32Array;
	readonly routeFromDirections: Uint8Array;
	readonly routeToDirections: Uint8Array;
	readonly routeSwitchIds: Int32Array;
	readonly routeProfileClasses: Uint8Array;
	readonly routeRoles: Uint8Array;
	readonly routePortIndices: Int8Array;
	readonly routeSegmentOrdinals: Uint16Array;
	readonly stationMillimeters: Int32Array;
	readonly stationReviews: Uint8Array;
	readonly sides: Uint8Array;
	readonly lateralOffsetMillimeters: Int32Array;
	readonly sideOffsetReviews: Uint8Array;
	readonly directions: Uint8Array;
	readonly directionReviews: Uint8Array;
	readonly sourcePositionReviews: Uint8Array;
	readonly groupReviewIds: Int32Array;
	readonly groupKinds: Uint8Array;
	readonly groupingReviews: Uint8Array;
	readonly groupTemplates: Uint8Array;
	readonly groupPitchMillimeters: Int32Array;
	readonly groupMemberOffsets: Uint32Array;
	readonly groupMemberRows: Int32Array;
	readonly fingerprint: string;
}

/**
 * Fresh, compact columns produced by an editor-owned typed review session.
 *
 * The columns are not an authority on their own. They must be cooperatively sealed by
 * `sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively`, which validates the exact
 * fixed-buffer identity, canonical values, CSR membership, and revision before minting the same
 * one-shot snapshot authority used by the compatibility object encoder.
 */
export type OpenFabStationProposalReviewDraftSnapshotSource = Omit<
	OpenFabStationProposalReviewDraftSnapshot,
	"kind" | "version" | "byteLength" | "fingerprint"
>;

export interface OpenFabStationProposalReviewDraftEncodeOptions {
	readonly checkpoint: () => Promise<void>;
	/** Monotonic UI/project generation. Any change makes the cooperative capture terminal. */
	readonly revision: () => number;
	readonly signal?: AbortSignal;
	readonly now?: () => number;
	readonly sliceMilliseconds?: number;
}

export interface OpenFabStationProposalReviewDraftSnapshotAdoptionOptions {
	readonly checkpoint: () => Promise<void>;
	readonly signal?: AbortSignal;
	readonly now?: () => number;
	readonly sliceMilliseconds?: number;
}

/** Opaque validated snapshot ownership; raw columns are intentionally not exposed. */
export interface AdoptedOpenFabStationProposalReviewDraftSnapshot {
	readonly kind: "adopted-openfab-station-proposal-review-draft-snapshot";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_SNAPSHOT_VERSION;
	readonly proposalRowCount: number;
	readonly decisionCount: number;
	readonly groupCount: number;
	readonly membershipCount: number;
	readonly byteLength: number;
	readonly fingerprint: string;
}

export interface ReleasedOpenFabStationProposalReviewDraftSnapshotTransfer {
	readonly snapshot: OpenFabStationProposalReviewDraftSnapshot;
	readonly transfers: readonly ArrayBuffer[];
}

type SnapshotColumns = Omit<
	OpenFabStationProposalReviewDraftSnapshot,
	| "kind"
	| "version"
	| "proposalRowCount"
	| "decisionCount"
	| "groupCount"
	| "membershipCount"
	| "rejectedSourceRowsPolicyCode"
	| "unknownColumnsPolicyCode"
	| "organizationPolicyCode"
	| "byteLength"
	| "fingerprint"
>;

interface CapturedDraftEnvelope {
	readonly rowDecisions: readonly Readonly<Record<string, unknown>>[];
	readonly groupDecisions: readonly Readonly<Record<string, unknown>>[];
	readonly groupMemberOffsets: Uint32Array;
	readonly groupMemberRows: readonly unknown[];
	readonly decisionCount: number;
	readonly groupCount: number;
	readonly membershipCount: number;
	readonly rejectedSourceRowsPolicyCode: number;
	readonly unknownColumnsPolicyCode: number;
	readonly organizationPolicyCode: number;
}

interface CapturedArrayEnvelope {
	readonly source: readonly unknown[];
	readonly count: number;
}

interface CapturedMatchedDataRecord {
	readonly values: Readonly<Record<string, unknown>>;
	readonly matchIndex: number;
}

const SNAPSHOT_KIND = "openfab-station-proposal-review-draft-snapshot" as const;
const ADOPTED_SNAPSHOT_KIND = "adopted-openfab-station-proposal-review-draft-snapshot" as const;
const FINGERPRINT_DOMAIN = "openfab-station-proposal-review-draft:v1";
const FINGERPRINT_PATTERN = /^openfab-station-proposal-review-draft:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const DEFAULT_SLICE_MILLISECONDS = 4;
const MAX_SLICE_MILLISECONDS = 4;
const OPERATIONS_PER_TIME_CHECK = 128;
const CHECKSUM_BYTES_PER_TIME_CHECK = 64 * 1024;
const MAX_UINT16 = 0xffff;
const MIN_INT32 = -0x8000_0000;
const MAX_INT32 = 0x7fff_ffff;
const ARRAY_BUFFER_SLICE = ArrayBuffer.prototype.slice;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"byteLength",
)?.get;
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"resizable",
)?.get;
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
	AbortSignal.prototype,
	"aborted",
)?.get;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"buffer",
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"byteOffset",
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"byteLength",
)?.get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"length",
)?.get;
const TYPED_ARRAY_CRITICAL_KEYS = Object.freeze([
	"buffer",
	"byteOffset",
	"byteLength",
	"length",
] as const);

const adoptedSnapshotStates = new WeakMap<
	AdoptedOpenFabStationProposalReviewDraftSnapshot,
	OpenFabStationProposalReviewDraftSnapshot
>();
const freshlyEncodedSnapshots = new WeakSet<OpenFabStationProposalReviewDraftSnapshot>();
const internallyMintedDraftSnapshotErrorCodes = new WeakMap<
	object,
	OpenFabStationProposalReviewDraftSnapshotErrorCode
>();
const internallyMintedAbortErrors = new WeakSet<object>();

const REJECT_REASONS = Object.freeze(["USER_EXCLUDED", "UNRESOLVED", "UNSUPPORTED"] as const);
const IDENTITY_ACTIONS = Object.freeze(["CREATE_NEW"] as const);
const TYPE_REVIEWS = Object.freeze(["CONFIRM_DECLARED", "OVERRIDE"] as const);
const ATTACHMENT_REVIEWS = Object.freeze(["USER_SELECTED_EXACT_ROUTE"] as const);
const STATION_REVIEWS = Object.freeze(["CONFIRM_DECLARED", "OVERRIDE"] as const);
const SIDE_OFFSET_REVIEWS = Object.freeze(["CONFIRM_DECLARED", "OVERRIDE"] as const);
const DIRECTION_REVIEWS = Object.freeze([
	"CONFIRM_DECLARED",
	"CONFIRM_HEURISTIC",
	"OVERRIDE",
] as const);
const SOURCE_POSITION_REVIEWS = Object.freeze([
	"NOT_PROVIDED",
	"CONFIRM_MATCH",
	"ACKNOWLEDGE_MISMATCH",
] as const);
const GROUPING_REVIEWS = Object.freeze(["CONFIRM_DECLARED", "OVERRIDE"] as const);
const GROUP_KINDS = Object.freeze(["OHB", "EQ", "STK"] as const);
const GROUP_TEMPLATES = Object.freeze(["SINGLE", ...STK_AUTHORING_TEMPLATES] as const);
const REJECTED_SOURCE_ROWS_POLICIES = Object.freeze([
	"NOT_APPLICABLE",
	"ACKNOWLEDGE_DISCARDED",
] as const);
const UNKNOWN_COLUMNS_POLICIES = Object.freeze(["NOT_APPLICABLE", "ACKNOWLEDGE_IGNORED"] as const);
const ORGANIZATION_POLICIES = Object.freeze(["EXPLICIT_UNASSIGNED"] as const);
const ROUTE_ENDS = Object.freeze([0, ...ALL_DIRECTIONS] as const);

const DRAFT_KEYS = Object.freeze([
	"rowDecisions",
	"groupDecisions",
	"rejectedSourceRowsPolicy",
	"unknownColumnsPolicy",
	"organizationPolicy",
] as const);
const REJECT_DECISION_KEYS = Object.freeze(["row", "disposition", "reason"] as const);
const INCLUDE_DECISION_KEYS = Object.freeze([
	"row",
	"disposition",
	"identityAction",
	"portType",
	"typeReview",
	"attachmentReview",
	"route",
	"stationMillimeters",
	"stationReview",
	"side",
	"lateralOffsetMillimeters",
	"sideOffsetReview",
	"direction",
	"directionReview",
	"sourcePositionReview",
] as const);
const CARDINAL_ROUTE_KEYS = Object.freeze(["kind", "x", "z", "from", "to"] as const);
const ADVANCED_ROUTE_KEYS = Object.freeze([
	"kind",
	"switchId",
	"profileClass",
	"role",
	"portIndex",
	"segmentOrdinal",
] as const);
const OHB_GROUP_KEYS = Object.freeze([
	"reviewGroupId",
	"memberRows",
	"groupingReview",
	"kind",
	"template",
] as const);
const EQ_GROUP_KEYS = Object.freeze([
	"reviewGroupId",
	"memberRows",
	"groupingReview",
	"kind",
	"pitchMillimeters",
	"recipe",
] as const);
const SNAPSHOT_KEYS = Object.freeze([
	"kind",
	"version",
	"proposalRowCount",
	"decisionCount",
	"groupCount",
	"membershipCount",
	"rejectedSourceRowsPolicyCode",
	"unknownColumnsPolicyCode",
	"organizationPolicyCode",
	"byteLength",
	"decisionRows",
	"decisionDispositions",
	"rejectReasons",
	"identityActions",
	"portTypes",
	"typeReviews",
	"attachmentReviews",
	"routeKinds",
	"routeXs",
	"routeZs",
	"routeFromDirections",
	"routeToDirections",
	"routeSwitchIds",
	"routeProfileClasses",
	"routeRoles",
	"routePortIndices",
	"routeSegmentOrdinals",
	"stationMillimeters",
	"stationReviews",
	"sides",
	"lateralOffsetMillimeters",
	"sideOffsetReviews",
	"directions",
	"directionReviews",
	"sourcePositionReviews",
	"groupReviewIds",
	"groupKinds",
	"groupingReviews",
	"groupTemplates",
	"groupPitchMillimeters",
	"groupMemberOffsets",
	"groupMemberRows",
	"fingerprint",
] as const);
const SNAPSHOT_SOURCE_KEYS = Object.freeze(
	SNAPSHOT_KEYS.filter(
		(key) => key !== "kind" && key !== "version" && key !== "byteLength" && key !== "fingerprint",
	),
);

/**
 * Cooperatively compact one review draft into independently owned transferable columns.
 * Row/member indexes remain raw signed-int32 values so the review evaluator, not transport, owns
 * duplicate, missing, and range semantics.
 */
export async function encodeOpenFabStationProposalReviewDraftCooperatively(
	draftValue: OpenFabStationProposalReviewDraft,
	proposalRowCount: number,
	options: OpenFabStationProposalReviewDraftEncodeOptions,
): Promise<OpenFabStationProposalReviewDraftSnapshot> {
	try {
		const cooperative = resolveEncodeCooperativeOptions(options);
		cooperative.throwIfAborted();
		const captured = await captureDraftEnvelopeCooperatively(
			draftValue,
			proposalRowCount,
			cooperative,
		);
		cooperative.throwIfAborted();
		const capacityByteLength = snapshotByteLength(
			captured.decisionCount,
			captured.groupCount,
			proposalRowCount,
		);
		if (capacityByteLength > OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_MAX_BYTES) {
			throw fixedError("BYTE_LIMIT_EXCEEDED");
		}

		const provisionalColumns = allocateColumns(
			captured.decisionCount,
			captured.groupCount,
			proposalRowCount,
		);
		for (let index = 0; index < captured.decisionCount; index++) {
			encodeCapturedDecision(captured.rowDecisions[index], provisionalColumns, index);
			if (cooperative.noteOperation()) await cooperative.checkTime();
		}

		let membershipOffset = 0;
		provisionalColumns.groupMemberOffsets[0] = 0;
		for (let index = 0; index < captured.groupCount; index++) {
			encodeCapturedGroup(captured.groupDecisions[index], provisionalColumns, index);
			const memberEnd = captured.groupMemberOffsets[index + 1] as number;
			for (; membershipOffset < memberEnd; membershipOffset++) {
				const row = captured.groupMemberRows[membershipOffset];
				if (!isInt32(row)) throw fixedError("INVALID_INPUT");
				provisionalColumns.groupMemberRows[membershipOffset] = row;
				if (cooperative.noteOperation()) await cooperative.checkTime();
			}
			provisionalColumns.groupMemberOffsets[index + 1] = membershipOffset;
			if (cooperative.noteOperation()) await cooperative.checkTime();
		}
		const columns: SnapshotColumns = {
			...provisionalColumns,
			groupMemberRows: provisionalColumns.groupMemberRows.slice(0, membershipOffset),
		};
		const byteLength = snapshotByteLength(
			captured.decisionCount,
			captured.groupCount,
			membershipOffset,
		);

		const base = {
			kind: SNAPSHOT_KIND,
			version: OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_SNAPSHOT_VERSION,
			proposalRowCount,
			decisionCount: captured.decisionCount,
			groupCount: captured.groupCount,
			membershipCount: membershipOffset,
			rejectedSourceRowsPolicyCode: captured.rejectedSourceRowsPolicyCode,
			unknownColumnsPolicyCode: captured.unknownColumnsPolicyCode,
			organizationPolicyCode: captured.organizationPolicyCode,
			byteLength,
			...columns,
		};
		const fingerprint = await fingerprintCooperatively(base, cooperative);
		await cooperative.checkTime();
		cooperative.throwIfAborted();
		const snapshot = Object.freeze({ ...base, fingerprint });
		const error = openFabStationProposalReviewDraftSnapshotShallowShapeError(snapshot);
		if (error) throw fixedError(error);
		lockTypedArrayViewShapes(snapshotViews(snapshot));
		freshlyEncodedSnapshots.add(snapshot);
		return snapshot;
	} catch (error) {
		throw normalizeEncodeError(error);
	}
}

/**
 * Seal fresh session-owned compact columns without rebuilding 100,000 row/group objects.
 *
 * Callers must pass newly allocated, independently owned fixed-buffer columns. After shallow
 * identity/ownership validation, all 32 buffers are synchronously transferred into a private
 * snapshot identity before any cooperative value scan. This terminally detaches the disposable
 * source columns and prevents stable-revision mutation from manufacturing a validate/fingerprint
 * hybrid. Persistent editor-session columns are separate and remain attached. Descriptor capture
 * prevents accessor/Proxy hybrids, while the caller's monotonic revision remains checked before
 * and after every cooperative checkpoint.
 */
export async function sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(
	sourceValue: OpenFabStationProposalReviewDraftSnapshotSource,
	options: OpenFabStationProposalReviewDraftEncodeOptions,
): Promise<OpenFabStationProposalReviewDraftSnapshot> {
	try {
		const cooperative = resolveEncodeCooperativeOptions(options);
		cooperative.throwIfAborted();
		const source = captureDraftSnapshotSourceIdentity(sourceValue);
		if (source === null) throw fixedError("INVALID_INPUT");
		const proposalRowCount = source.proposalRowCount;
		const decisionCount = source.decisionCount;
		const groupCount = source.groupCount;
		const membershipCount = source.membershipCount;
		if (
			!isBoundedCount(proposalRowCount, OPENFAB_STATION_PROPOSAL_MAX_ROWS) ||
			!isBoundedCount(decisionCount, proposalRowCount) ||
			!isBoundedCount(groupCount, proposalRowCount) ||
			!isBoundedCount(membershipCount, proposalRowCount) ||
			!isEnumCode(source.rejectedSourceRowsPolicyCode, REJECTED_SOURCE_ROWS_POLICIES.length) ||
			!isEnumCode(source.unknownColumnsPolicyCode, UNKNOWN_COLUMNS_POLICIES.length) ||
			!isEnumCode(source.organizationPolicyCode, ORGANIZATION_POLICIES.length)
		) {
			throw fixedError("INVALID_INPUT");
		}
		const byteLength = snapshotByteLength(decisionCount, groupCount, membershipCount);
		if (byteLength > OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_MAX_BYTES) {
			throw fixedError("BYTE_LIMIT_EXCEEDED");
		}
		const provisional = Object.freeze({
			kind: SNAPSHOT_KIND,
			version: OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_SNAPSHOT_VERSION,
			...source,
			byteLength,
			fingerprint: `${FINGERPRINT_DOMAIN}:00000000:00000000`,
		}) as OpenFabStationProposalReviewDraftSnapshot;
		const shallowError = capturedSnapshotShallowShapeError(provisional);
		if (shallowError) throw fixedError(shallowError);
		cooperative.throwIfAborted();
		const sourceViews = snapshotViews(provisional);
		let adoptedValue: OpenFabStationProposalReviewDraftSnapshot;
		try {
			adoptedValue = structuredClone(provisional, {
				transfer: sourceViews.map((view) => intrinsicOwnedArrayBufferOrThrow(view)),
			});
		} catch {
			throw fixedError("ENCODE_FAILED");
		}
		if (!transferredSourceViewsHaveNoCustomOwnProperties(sourceViews)) {
			throw fixedError("SNAPSHOT_TYPED_ARRAY_MISMATCH");
		}
		const adopted = captureSnapshotIdentity(adoptedValue);
		if (adopted === null) throw fixedError("ENCODE_FAILED");
		const adoptedShallowError = capturedSnapshotShallowShapeError(adopted);
		if (adoptedShallowError) throw fixedError(adoptedShallowError);
		lockTypedArrayViewShapes(snapshotViews(adopted));
		const valueError = await capturedSnapshotValueErrorCooperatively(adopted, cooperative);
		if (valueError) throw fixedError(valueError);
		const fingerprint = await fingerprintCooperatively(adopted, cooperative);
		await cooperative.checkTime();
		cooperative.throwIfAborted();
		const snapshot = Object.freeze({ ...adopted, fingerprint });
		const finalError = capturedSnapshotShallowShapeError(snapshot);
		if (finalError) throw fixedError(finalError);
		freshlyEncodedSnapshots.add(snapshot);
		return snapshot;
	} catch (error) {
		throw normalizeEncodeError(error);
	}
}

/** One-shot O(column-count) transfer release for this encoder's exact fresh snapshot identity. */
export function releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): ReleasedOpenFabStationProposalReviewDraftSnapshotTransfer {
	if (!freshlyEncodedSnapshots.has(snapshot)) throw fixedError("SNAPSHOT_CONTRACT_MISMATCH");
	const captured = captureSnapshotIdentity(snapshot);
	if (captured === null || capturedSnapshotShallowShapeError(captured) !== null) {
		freshlyEncodedSnapshots.delete(snapshot);
		throw fixedError("SNAPSHOT_CONTRACT_MISMATCH");
	}
	freshlyEncodedSnapshots.delete(snapshot);
	return Object.freeze({
		snapshot,
		transfers: Object.freeze(snapshotTransferBuffersUnchecked(captured)),
	});
}

export function revokeEncodedOpenFabStationProposalReviewDraftSnapshot(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): void {
	freshlyEncodedSnapshots.delete(snapshot);
}

/** Strict scalar/type/ownership/length validation without scanning column values. */
export function openFabStationProposalReviewDraftSnapshotShallowShapeError(
	value: unknown,
): OpenFabStationProposalReviewDraftSnapshotErrorCode | null {
	const snapshot = captureSnapshotIdentity(value);
	if (snapshot === null) return "SNAPSHOT_CONTRACT_MISMATCH";
	return capturedSnapshotShallowShapeError(snapshot);
}

function capturedSnapshotShallowShapeError(
	value: OpenFabStationProposalReviewDraftSnapshot,
): OpenFabStationProposalReviewDraftSnapshotErrorCode | null {
	try {
		if (
			value.kind !== SNAPSHOT_KIND ||
			value.version !== OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_SNAPSHOT_VERSION ||
			!isBoundedCount(value.proposalRowCount, OPENFAB_STATION_PROPOSAL_MAX_ROWS) ||
			!isBoundedCount(value.decisionCount, value.proposalRowCount as number) ||
			!isBoundedCount(value.groupCount, value.proposalRowCount as number) ||
			!isBoundedCount(value.membershipCount, value.proposalRowCount as number) ||
			!isEnumCode(value.rejectedSourceRowsPolicyCode, REJECTED_SOURCE_ROWS_POLICIES.length) ||
			!isEnumCode(value.unknownColumnsPolicyCode, UNKNOWN_COLUMNS_POLICIES.length) ||
			!isEnumCode(value.organizationPolicyCode, ORGANIZATION_POLICIES.length) ||
			!Number.isSafeInteger(value.byteLength) ||
			(value.byteLength as number) < 0 ||
			typeof value.fingerprint !== "string" ||
			!FINGERPRINT_PATTERN.test(value.fingerprint)
		) {
			return "SNAPSHOT_SCALAR_MISMATCH";
		}
		if ((value.byteLength as number) > OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_MAX_BYTES) {
			return "BYTE_LIMIT_EXCEEDED";
		}
		if (!snapshotArraysHaveExactTypes(value)) return "SNAPSHOT_TYPED_ARRAY_MISMATCH";
		const snapshot = value;
		const views = snapshotViews(snapshot);
		if (!viewsOwnUniqueFixedBuffers(views)) {
			return "SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH";
		}
		if (!snapshotColumnsHaveExactLengths(snapshot)) return "SNAPSHOT_LENGTH_MISMATCH";
		const expectedByteLength = snapshotByteLength(
			snapshot.decisionCount,
			snapshot.groupCount,
			snapshot.membershipCount,
		);
		const actualByteLength = views.reduce(
			(total, view) => total + intrinsicTypedArrayStateOrThrow(view).byteLength,
			0,
		);
		if (
			expectedByteLength !== snapshot.byteLength ||
			actualByteLength !== snapshot.byteLength ||
			actualByteLength > OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_MAX_BYTES
		) {
			return "SNAPSHOT_LENGTH_MISMATCH";
		}
		return null;
	} catch {
		return "SNAPSHOT_CONTRACT_MISMATCH";
	}
}

/** Full canonical value, CSR, and deterministic fingerprint validation. */
export function openFabStationProposalReviewDraftSnapshotShapeError(
	value: unknown,
): OpenFabStationProposalReviewDraftSnapshotErrorCode | null {
	const snapshot = captureSnapshotIdentity(value);
	if (snapshot === null) return "SNAPSHOT_CONTRACT_MISMATCH";
	return capturedSnapshotShapeError(snapshot);
}

function capturedSnapshotShapeError(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): OpenFabStationProposalReviewDraftSnapshotErrorCode | null {
	const shallow = capturedSnapshotShallowShapeError(snapshot);
	if (shallow) return shallow;
	try {
		if (!decisionColumnsAreCanonical(snapshot) || !groupColumnsAreCanonical(snapshot)) {
			return "SNAPSHOT_VALUE_MISMATCH";
		}
		if (!groupMembershipCsrIsCanonical(snapshot)) return "SNAPSHOT_CSR_MISMATCH";
		if (snapshot.fingerprint !== fingerprintUnchecked(snapshot)) {
			return "SNAPSHOT_FINGERPRINT_MISMATCH";
		}
		return null;
	} catch {
		return "SNAPSHOT_VALUE_MISMATCH";
	}
}

async function capturedSnapshotShapeErrorCooperatively(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
	cooperative: CooperativeController,
): Promise<OpenFabStationProposalReviewDraftSnapshotErrorCode | null> {
	try {
		const valueError = await capturedSnapshotValueErrorCooperatively(snapshot, cooperative);
		if (valueError) return valueError;
		const fingerprint = await fingerprintCooperatively(snapshot, cooperative);
		return fingerprint === snapshot.fingerprint ? null : "SNAPSHOT_FINGERPRINT_MISMATCH";
	} catch (error) {
		if (isInternallyMintedAbortError(error)) throw error;
		if (isInternallyMintedDraftSnapshotError(error)) throw error;
		return "SNAPSHOT_VALUE_MISMATCH";
	}
}

async function capturedSnapshotValueErrorCooperatively(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
	cooperative: CooperativeController,
): Promise<OpenFabStationProposalReviewDraftSnapshotErrorCode | null> {
	for (let index = 0; index < snapshot.decisionCount; index++) {
		if (!decisionRowIsCanonical(snapshot, index)) return "SNAPSHOT_VALUE_MISMATCH";
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	for (let index = 0; index < snapshot.groupCount; index++) {
		if (!groupRowIsCanonical(snapshot, index)) return "SNAPSHOT_VALUE_MISMATCH";
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	if (
		snapshot.groupMemberOffsets[0] !== 0 ||
		snapshot.groupMemberOffsets[snapshot.groupCount] !== snapshot.membershipCount
	) {
		return "SNAPSHOT_CSR_MISMATCH";
	}
	for (let index = 0; index < snapshot.groupCount; index++) {
		if (
			(snapshot.groupMemberOffsets[index] as number) >
			(snapshot.groupMemberOffsets[index + 1] as number)
		) {
			return "SNAPSHOT_CSR_MISMATCH";
		}
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	return null;
}

/** Diagnostic only: validation does not confer stable ownership; adopt before trusted use. */
export function validateOpenFabStationProposalReviewDraftSnapshot(value: unknown): void {
	validatedSnapshotIdentity(value);
}

/**
 * Synchronous compatibility decode. Worker runtime should adopt first and use the opaque-handle
 * decoder so source ordering and raw int32 row evidence come from one private identity.
 */
export function decodeOpenFabStationProposalReviewDraftSnapshot(
	value: unknown,
): OpenFabStationProposalReviewDraft {
	const snapshot = validatedSnapshotIdentity(value);
	return decodeCapturedSnapshot(snapshot);
}

function decodeCapturedSnapshot(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): OpenFabStationProposalReviewDraft {
	const rowDecisions = new Array<OpenFabStationProposalRowDecision>(snapshot.decisionCount);
	for (let index = 0; index < rowDecisions.length; index++) {
		const row = snapshot.decisionRows[index] as number;
		if (snapshot.decisionDispositions[index] === 1) {
			rowDecisions[index] = Object.freeze({
				row,
				disposition: "REJECT" as const,
				reason: decodeEnum(REJECT_REASONS, snapshot.rejectReasons[index] as number),
			});
			continue;
		}
		const route =
			snapshot.routeKinds[index] === 1
				? Object.freeze({
						kind: "CARDINAL_CELL" as const,
						x: snapshot.routeXs[index] as number,
						z: snapshot.routeZs[index] as number,
						from: snapshot.routeFromDirections[index] as 0 | Direction,
						to: snapshot.routeToDirections[index] as 0 | Direction,
					})
				: Object.freeze({
						kind: "ADVANCED_SWITCH_SEGMENT" as const,
						switchId: snapshot.routeSwitchIds[index] as number,
						profileClass: decodeEnum(
							ADVANCED_SWITCH_PROFILE_CLASSES,
							snapshot.routeProfileClasses[index] as number,
						) as AdvancedSwitchProfileClass,
						role: decodeEnum(
							ADVANCED_SWITCH_ROUTE_ROLES,
							snapshot.routeRoles[index] as number,
						) as AdvancedSwitchRouteRole,
						portIndex:
							(snapshot.routePortIndices[index] as number) < 0
								? null
								: (snapshot.routePortIndices[index] as 0 | 1),
						segmentOrdinal: snapshot.routeSegmentOrdinals[index] as number,
					});
		rowDecisions[index] = Object.freeze({
			row,
			disposition: "INCLUDE" as const,
			identityAction: decodeEnum(IDENTITY_ACTIONS, snapshot.identityActions[index] as number),
			portType: decodeEnum(PORT_TYPES, snapshot.portTypes[index] as number) as PortType,
			typeReview: decodeEnum(TYPE_REVIEWS, snapshot.typeReviews[index] as number),
			attachmentReview: decodeEnum(ATTACHMENT_REVIEWS, snapshot.attachmentReviews[index] as number),
			route,
			stationMillimeters: snapshot.stationMillimeters[index] as number,
			stationReview: decodeEnum(STATION_REVIEWS, snapshot.stationReviews[index] as number),
			side: decodeEnum(PORT_SIDES, snapshot.sides[index] as number) as PortSide,
			lateralOffsetMillimeters: snapshot.lateralOffsetMillimeters[index] as number,
			sideOffsetReview: decodeEnum(
				SIDE_OFFSET_REVIEWS,
				snapshot.sideOffsetReviews[index] as number,
			),
			direction: decodeEnum(PORT_DIRECTIONS, snapshot.directions[index] as number) as PortDirection,
			directionReview: decodeEnum(DIRECTION_REVIEWS, snapshot.directionReviews[index] as number),
			sourcePositionReview: decodeEnum(
				SOURCE_POSITION_REVIEWS,
				snapshot.sourcePositionReviews[index] as number,
			),
		});
	}

	const groupDecisions = new Array<OpenFabStationProposalGroupDecision>(snapshot.groupCount);
	const cleanGroupMemberRows = cleanTypedArrayView(snapshot.groupMemberRows) as Int32Array;
	for (let index = 0; index < groupDecisions.length; index++) {
		const memberRows = Object.freeze(
			Array.from(
				cleanGroupMemberRows.subarray(
					snapshot.groupMemberOffsets[index] as number,
					snapshot.groupMemberOffsets[index + 1] as number,
				),
			),
		);
		const common = {
			reviewGroupId: snapshot.groupReviewIds[index] as number,
			memberRows,
			groupingReview: decodeEnum(GROUPING_REVIEWS, snapshot.groupingReviews[index] as number),
		};
		const kind = decodeEnum(GROUP_KINDS, snapshot.groupKinds[index] as number);
		if (kind === "OHB") {
			groupDecisions[index] = Object.freeze({ ...common, kind, template: "SINGLE" as const });
		} else if (kind === "EQ") {
			groupDecisions[index] = Object.freeze({
				...common,
				kind,
				pitchMillimeters: snapshot.groupPitchMillimeters[index] as number,
				recipe: null,
			});
		} else {
			groupDecisions[index] = Object.freeze({
				...common,
				kind,
				template: decodeEnum(
					GROUP_TEMPLATES,
					snapshot.groupTemplates[index] as number,
				) as StkAuthoringTemplate,
			});
		}
	}

	return Object.freeze({
		rowDecisions: Object.freeze(rowDecisions),
		groupDecisions: Object.freeze(groupDecisions),
		rejectedSourceRowsPolicy: decodeEnum(
			REJECTED_SOURCE_ROWS_POLICIES,
			snapshot.rejectedSourceRowsPolicyCode,
		),
		unknownColumnsPolicy: decodeEnum(UNKNOWN_COLUMNS_POLICIES, snapshot.unknownColumnsPolicyCode),
		organizationPolicy: decodeEnum(ORGANIZATION_POLICIES, snapshot.organizationPolicyCode),
	});
}

export function openFabStationProposalReviewDraftSnapshotFingerprint(value: unknown): string {
	const snapshot = captureSnapshotIdentity(value);
	if (snapshot === null) throw fixedError("SNAPSHOT_CONTRACT_MISMATCH");
	const shallow = capturedSnapshotShallowShapeError(snapshot);
	if (shallow) throw fixedError(shallow);
	return fingerprintUnchecked(snapshot);
}

/** Synchronous compatibility helper; maximum snapshots should use cooperative adoption/release. */
export function collectOpenFabStationProposalReviewDraftSnapshotTransfers(
	value: unknown,
): ArrayBuffer[] {
	const snapshot = validatedSnapshotIdentity(value);
	const views = snapshotViews(snapshot);
	const isExactFreshIdentity =
		typeof value === "object" &&
		value !== null &&
		freshlyEncodedSnapshots.has(value as OpenFabStationProposalReviewDraftSnapshot);
	if (
		isExactFreshIdentity
			? !typedArrayViewShapesAreLocked(views)
			: !typedArrayViewShapesAreCanonicalForSynchronousTransfer(views)
	) {
		throw fixedError("SNAPSHOT_TYPED_ARRAY_MISMATCH");
	}
	return snapshotTransferBuffersUnchecked(snapshot);
}

function snapshotTransferBuffersUnchecked(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): ArrayBuffer[] {
	return snapshotViews(snapshot).map(intrinsicOwnedArrayBufferOrThrow);
}

function validatedSnapshotIdentity(value: unknown): OpenFabStationProposalReviewDraftSnapshot {
	const snapshot = captureSnapshotIdentity(value);
	if (snapshot === null) throw fixedError("SNAPSHOT_CONTRACT_MISMATCH");
	const error = capturedSnapshotShapeError(snapshot);
	if (error) throw fixedError(error);
	return snapshot;
}

/** Synchronous Worker-side adoption. Main-thread maximum payloads should use the cooperative API. */
export function adoptOpenFabStationProposalReviewDraftSnapshot(
	value: unknown,
): AdoptedOpenFabStationProposalReviewDraftSnapshot {
	try {
		const snapshot = captureSnapshotIdentity(value);
		if (snapshot === null) throw fixedError("SNAPSHOT_CONTRACT_MISMATCH");
		if (typeof value === "object" && value !== null) {
			freshlyEncodedSnapshots.delete(value as OpenFabStationProposalReviewDraftSnapshot);
		}
		const error = capturedSnapshotShapeError(snapshot);
		if (error) throw fixedError(error);
		return createAdoptedSnapshotHandle(transferSnapshotToPrivateIdentity(snapshot));
	} catch (error) {
		throw normalizeAdoptionError(error);
	}
}

/**
 * Preferred main-thread boundary: exact-capture outer identities, consume their owned buffers,
 * then validate the private snapshot cooperatively before exposing an opaque handle.
 */
export async function adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(
	value: unknown,
	options: OpenFabStationProposalReviewDraftSnapshotAdoptionOptions,
): Promise<AdoptedOpenFabStationProposalReviewDraftSnapshot> {
	try {
		const cooperative = resolveAdoptionCooperativeOptions(options);
		cooperative.throwIfAborted();
		const snapshot = captureSnapshotIdentity(value);
		if (snapshot === null) throw fixedError("SNAPSHOT_CONTRACT_MISMATCH");
		if (typeof value === "object" && value !== null) {
			freshlyEncodedSnapshots.delete(value as OpenFabStationProposalReviewDraftSnapshot);
		}
		const shallowError = capturedSnapshotShallowShapeError(snapshot);
		if (shallowError) throw fixedError(shallowError);
		cooperative.throwIfAborted();
		const privateSnapshot = transferSnapshotToPrivateIdentity(snapshot);
		await cooperative.checkpointNow();
		const error = await capturedSnapshotShapeErrorCooperatively(privateSnapshot, cooperative);
		if (error) throw fixedError(error);
		await cooperative.checkpointNow();
		cooperative.throwIfAborted();
		return createAdoptedSnapshotHandle(privateSnapshot);
	} catch (error) {
		throw normalizeAdoptionError(error);
	}
}

/** Decode only an adopted private identity in Worker runtime code. */
export function decodeAdoptedOpenFabStationProposalReviewDraftSnapshot(
	handle: AdoptedOpenFabStationProposalReviewDraftSnapshot,
): OpenFabStationProposalReviewDraft {
	const snapshot = adoptedSnapshotStates.get(handle);
	if (!snapshot) throw fixedError("SNAPSHOT_CONTRACT_MISMATCH");
	return decodeCapturedSnapshot(snapshot);
}

/** One-shot release for immediate postMessage transfer; the handle is invalid afterwards. */
export function releaseAdoptedOpenFabStationProposalReviewDraftSnapshotTransfer(
	handle: AdoptedOpenFabStationProposalReviewDraftSnapshot,
): ReleasedOpenFabStationProposalReviewDraftSnapshotTransfer {
	const snapshot = adoptedSnapshotStates.get(handle);
	if (!snapshot) throw fixedError("SNAPSHOT_CONTRACT_MISMATCH");
	adoptedSnapshotStates.delete(handle);
	const transfers = Object.freeze(snapshotTransferBuffersUnchecked(snapshot));
	return Object.freeze({ snapshot, transfers });
}

function transferSnapshotToPrivateIdentity(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): OpenFabStationProposalReviewDraftSnapshot {
	const sourceViews = snapshotViews(snapshot);
	let transferred: unknown;
	try {
		transferred = structuredClone(snapshot, {
			transfer: sourceViews.map((view) => intrinsicOwnedArrayBufferOrThrow(view)),
		});
	} catch {
		throw fixedError("ADOPTION_FAILED");
	}
	if (!transferredSourceViewsHaveNoCustomOwnProperties(sourceViews)) {
		throw fixedError("SNAPSHOT_TYPED_ARRAY_MISMATCH");
	}
	const privateSnapshot = captureSnapshotIdentity(transferred);
	if (privateSnapshot === null) throw fixedError("ADOPTION_FAILED");
	const shallowError = capturedSnapshotShallowShapeError(privateSnapshot);
	if (shallowError) throw fixedError(shallowError);
	lockTypedArrayViewShapes(snapshotViews(privateSnapshot));
	return privateSnapshot;
}

function createAdoptedSnapshotHandle(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): AdoptedOpenFabStationProposalReviewDraftSnapshot {
	const handle = Object.freeze({
		kind: ADOPTED_SNAPSHOT_KIND,
		version: snapshot.version,
		proposalRowCount: snapshot.proposalRowCount,
		decisionCount: snapshot.decisionCount,
		groupCount: snapshot.groupCount,
		membershipCount: snapshot.membershipCount,
		byteLength: snapshot.byteLength,
		fingerprint: snapshot.fingerprint,
	});
	adoptedSnapshotStates.set(handle, snapshot);
	return handle;
}

async function captureDraftEnvelopeCooperatively(
	value: unknown,
	proposalRowCount: number,
	cooperative: CooperativeController,
): Promise<CapturedDraftEnvelope> {
	if (!Number.isSafeInteger(proposalRowCount) || proposalRowCount < 0) {
		throw fixedError("INVALID_INPUT");
	}
	const capturedDraft = captureMatchedEnumerableOwnDataRecord(value, [DRAFT_KEYS]);
	if (capturedDraft === null) throw fixedError("INVALID_INPUT");
	if (proposalRowCount > OPENFAB_STATION_PROPOSAL_MAX_ROWS) {
		throw fixedError("CAPACITY_EXCEEDED");
	}

	const values = capturedDraft.values;
	const rowEnvelope = captureBoundedArrayEnvelope(values.rowDecisions, proposalRowCount);
	const rowDecisions = new Array<Readonly<Record<string, unknown>>>(rowEnvelope.count);
	for (let index = 0; index < rowDecisions.length; index++) {
		rowDecisions[index] = captureDecisionForEncoding(
			capturedArrayElementValue(rowEnvelope.source, index),
		);
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}

	const groupEnvelope = captureBoundedArrayEnvelope(values.groupDecisions, proposalRowCount);
	const groupDecisions = new Array<Readonly<Record<string, unknown>>>(groupEnvelope.count);
	const groupMemberOffsets = new Uint32Array(groupEnvelope.count + 1);
	const groupMemberRows = new Array<unknown>(proposalRowCount);
	let membershipCount = 0;
	for (let index = 0; index < groupDecisions.length; index++) {
		const group = captureGroupForEncoding(
			capturedArrayElementValue(groupEnvelope.source, index),
			proposalRowCount - membershipCount,
		);
		groupDecisions[index] = group.values;
		for (let memberIndex = 0; memberIndex < group.members.count; memberIndex++) {
			groupMemberRows[membershipCount++] = capturedArrayElementValue(
				group.members.source,
				memberIndex,
			);
			if (cooperative.noteOperation()) await cooperative.checkTime();
		}
		groupMemberOffsets[index + 1] = membershipCount;
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	groupMemberRows.length = membershipCount;

	return Object.freeze({
		rowDecisions,
		groupDecisions,
		groupMemberOffsets,
		groupMemberRows,
		decisionCount: rowDecisions.length,
		groupCount: groupDecisions.length,
		membershipCount,
		rejectedSourceRowsPolicyCode: encodeEnum(
			REJECTED_SOURCE_ROWS_POLICIES,
			values.rejectedSourceRowsPolicy,
		),
		unknownColumnsPolicyCode: encodeEnum(UNKNOWN_COLUMNS_POLICIES, values.unknownColumnsPolicy),
		organizationPolicyCode: encodeEnum(ORGANIZATION_POLICIES, values.organizationPolicy),
	});
}

function captureBoundedArrayEnvelope(value: unknown, maximumCount: number): CapturedArrayEnvelope {
	if (!Array.isArray(value)) throw fixedError("INVALID_INPUT");
	let lengthDescriptor: PropertyDescriptor | undefined;
	try {
		lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	} catch {
		throw fixedError("INVALID_INPUT");
	}
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		lengthDescriptor.value < 0
	) {
		throw fixedError("INVALID_INPUT");
	}
	const count = lengthDescriptor.value as number;
	if (count > maximumCount) throw fixedError("CAPACITY_EXCEEDED");
	return Object.freeze({ source: value, count });
}

function capturedArrayElementValue(value: readonly unknown[], index: number): unknown {
	let descriptor: PropertyDescriptor | undefined;
	try {
		descriptor = Object.getOwnPropertyDescriptor(value, String(index));
	} catch {
		throw fixedError("INVALID_INPUT");
	}
	if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
		throw fixedError("INVALID_INPUT");
	}
	return descriptor.value;
}

function allocateColumns(
	decisionCount: number,
	groupCount: number,
	membershipCount: number,
): SnapshotColumns {
	return {
		decisionRows: new Int32Array(decisionCount),
		decisionDispositions: new Uint8Array(decisionCount),
		rejectReasons: new Uint8Array(decisionCount),
		identityActions: new Uint8Array(decisionCount),
		portTypes: new Uint8Array(decisionCount),
		typeReviews: new Uint8Array(decisionCount),
		attachmentReviews: new Uint8Array(decisionCount),
		routeKinds: new Uint8Array(decisionCount),
		routeXs: new Int32Array(decisionCount),
		routeZs: new Int32Array(decisionCount),
		routeFromDirections: new Uint8Array(decisionCount),
		routeToDirections: new Uint8Array(decisionCount),
		routeSwitchIds: new Int32Array(decisionCount),
		routeProfileClasses: new Uint8Array(decisionCount),
		routeRoles: new Uint8Array(decisionCount),
		routePortIndices: new Int8Array(decisionCount),
		routeSegmentOrdinals: new Uint16Array(decisionCount),
		stationMillimeters: new Int32Array(decisionCount),
		stationReviews: new Uint8Array(decisionCount),
		sides: new Uint8Array(decisionCount),
		lateralOffsetMillimeters: new Int32Array(decisionCount),
		sideOffsetReviews: new Uint8Array(decisionCount),
		directions: new Uint8Array(decisionCount),
		directionReviews: new Uint8Array(decisionCount),
		sourcePositionReviews: new Uint8Array(decisionCount),
		groupReviewIds: new Int32Array(groupCount),
		groupKinds: new Uint8Array(groupCount),
		groupingReviews: new Uint8Array(groupCount),
		groupTemplates: new Uint8Array(groupCount),
		groupPitchMillimeters: new Int32Array(groupCount),
		groupMemberOffsets: new Uint32Array(groupCount + 1),
		groupMemberRows: new Int32Array(membershipCount),
	};
}

function captureDecisionForEncoding(value: unknown): Readonly<Record<string, unknown>> {
	const captured = captureMatchedEnumerableOwnDataRecord(value, [
		REJECT_DECISION_KEYS,
		INCLUDE_DECISION_KEYS,
	]);
	if (captured === null) throw fixedError("INVALID_INPUT");
	const values = captured.values;
	if (captured.matchIndex === 0) {
		if (values.disposition !== "REJECT") throw fixedError("INVALID_INPUT");
		return values;
	}
	if (values.disposition !== "INCLUDE") throw fixedError("INVALID_INPUT");
	return Object.freeze({
		...values,
		route: captureRouteForEncoding(values.route),
	});
}

function captureRouteForEncoding(value: unknown): Readonly<Record<string, unknown>> {
	const captured = captureMatchedEnumerableOwnDataRecord(value, [
		CARDINAL_ROUTE_KEYS,
		ADVANCED_ROUTE_KEYS,
	]);
	if (captured === null) throw fixedError("INVALID_INPUT");
	if (
		(captured.matchIndex === 0 && captured.values.kind !== "CARDINAL_CELL") ||
		(captured.matchIndex === 1 && captured.values.kind !== "ADVANCED_SWITCH_SEGMENT")
	) {
		throw fixedError("INVALID_INPUT");
	}
	return captured.values;
}

function encodeCapturedDecision(
	value: Readonly<Record<string, unknown>>,
	columns: SnapshotColumns,
	index: number,
): void {
	const row = value.row;
	const disposition = value.disposition;
	if (!isInt32(row)) throw fixedError("INVALID_INPUT");
	columns.decisionRows[index] = row;
	if (disposition === "REJECT") {
		const reason = value.reason;
		columns.decisionDispositions[index] = 1;
		columns.rejectReasons[index] = encodeEnum(REJECT_REASONS, reason);
		return;
	}
	if (disposition !== "INCLUDE") throw fixedError("INVALID_INPUT");
	const identityAction = value.identityAction;
	const portType = value.portType;
	const typeReview = value.typeReview;
	const attachmentReview = value.attachmentReview;
	const route = value.route;
	const stationMillimeters = value.stationMillimeters;
	const stationReview = value.stationReview;
	const side = value.side;
	const lateralOffsetMillimeters = value.lateralOffsetMillimeters;
	const sideOffsetReview = value.sideOffsetReview;
	const direction = value.direction;
	const directionReview = value.directionReview;
	const sourcePositionReview = value.sourcePositionReview;
	if (!isInt32(stationMillimeters) || !isInt32(lateralOffsetMillimeters)) {
		throw fixedError("INVALID_INPUT");
	}
	columns.decisionDispositions[index] = 2;
	columns.identityActions[index] = encodeEnum(IDENTITY_ACTIONS, identityAction);
	columns.portTypes[index] = encodeEnum(PORT_TYPES, portType);
	columns.typeReviews[index] = encodeEnum(TYPE_REVIEWS, typeReview);
	columns.attachmentReviews[index] = encodeEnum(ATTACHMENT_REVIEWS, attachmentReview);
	encodeCapturedRoute(route as Readonly<Record<string, unknown>>, columns, index);
	columns.stationMillimeters[index] = stationMillimeters;
	columns.stationReviews[index] = encodeEnum(STATION_REVIEWS, stationReview);
	columns.sides[index] = encodeEnum(PORT_SIDES, side);
	columns.lateralOffsetMillimeters[index] = lateralOffsetMillimeters;
	columns.sideOffsetReviews[index] = encodeEnum(SIDE_OFFSET_REVIEWS, sideOffsetReview);
	columns.directions[index] = encodeEnum(PORT_DIRECTIONS, direction);
	columns.directionReviews[index] = encodeEnum(DIRECTION_REVIEWS, directionReview);
	columns.sourcePositionReviews[index] = encodeEnum(SOURCE_POSITION_REVIEWS, sourcePositionReview);
}

function encodeCapturedRoute(
	value: Readonly<Record<string, unknown>>,
	columns: SnapshotColumns,
	index: number,
): void {
	const kind = value.kind;
	if (kind === "CARDINAL_CELL") {
		const x = value.x;
		const z = value.z;
		const from = value.from;
		const to = value.to;
		if (
			!isInt32(x) ||
			!isInt32(z) ||
			!isRouteEnd(from) ||
			!isRouteEnd(to) ||
			(from === 0 && to === 0) ||
			from === to
		) {
			throw fixedError("INVALID_INPUT");
		}
		columns.routeKinds[index] = 1;
		columns.routeXs[index] = x;
		columns.routeZs[index] = z;
		columns.routeFromDirections[index] = from;
		columns.routeToDirections[index] = to;
		return;
	}
	const switchId = value.switchId;
	const profileClass = value.profileClass;
	const roleValue = value.role;
	const portIndex = value.portIndex;
	const segmentOrdinal = value.segmentOrdinal;
	if (
		kind !== "ADVANCED_SWITCH_SEGMENT" ||
		!isInt32(switchId) ||
		switchId <= 0 ||
		!Number.isInteger(segmentOrdinal) ||
		(segmentOrdinal as number) < 0 ||
		(segmentOrdinal as number) > MAX_UINT16
	) {
		throw fixedError("INVALID_INPUT");
	}
	const roleCode = encodeEnum(ADVANCED_SWITCH_ROUTE_ROLES, roleValue);
	const role = decodeEnum(ADVANCED_SWITCH_ROUTE_ROLES, roleCode);
	if (
		(role === "THROAT" && portIndex !== null) ||
		(role !== "THROAT" && portIndex !== 0 && portIndex !== 1)
	) {
		throw fixedError("INVALID_INPUT");
	}
	columns.routeKinds[index] = 2;
	columns.routeSwitchIds[index] = switchId;
	columns.routeProfileClasses[index] = encodeEnum(ADVANCED_SWITCH_PROFILE_CLASSES, profileClass);
	columns.routeRoles[index] = roleCode;
	columns.routePortIndices[index] = portIndex === null ? -1 : (portIndex as number);
	columns.routeSegmentOrdinals[index] = segmentOrdinal as number;
}

function captureGroupForEncoding(
	value: unknown,
	remainingMembershipCapacity: number,
): {
	readonly values: Readonly<Record<string, unknown>>;
	readonly members: CapturedArrayEnvelope;
} {
	const captured = captureMatchedEnumerableOwnDataRecord(value, [OHB_GROUP_KEYS, EQ_GROUP_KEYS]);
	if (captured === null) throw fixedError("INVALID_INPUT");
	const values = captured.values;
	if (
		(captured.matchIndex === 0 && values.kind !== "OHB" && values.kind !== "STK") ||
		(captured.matchIndex === 1 && values.kind !== "EQ")
	) {
		throw fixedError("INVALID_INPUT");
	}
	const members = captureBoundedArrayEnvelope(values.memberRows, remainingMembershipCapacity);
	return Object.freeze({
		values: Object.freeze({ ...values, memberRows: null }),
		members,
	});
}

function encodeCapturedGroup(
	value: Readonly<Record<string, unknown>>,
	columns: SnapshotColumns,
	index: number,
): void {
	const reviewGroupId = value.reviewGroupId;
	const groupingReview = value.groupingReview;
	const kind = value.kind;
	if (!isInt32(reviewGroupId)) throw fixedError("INVALID_INPUT");

	columns.groupReviewIds[index] = reviewGroupId;
	columns.groupingReviews[index] = encodeEnum(GROUPING_REVIEWS, groupingReview);
	if (kind === "OHB") {
		const template = value.template;
		if (template !== "SINGLE") throw fixedError("INVALID_INPUT");
		columns.groupKinds[index] = encodeEnum(GROUP_KINDS, kind);
		columns.groupTemplates[index] = encodeEnum(GROUP_TEMPLATES, template);
	} else if (kind === "EQ") {
		const pitchMillimeters = value.pitchMillimeters;
		const recipe = value.recipe;
		if (!isInt32(pitchMillimeters) || recipe !== null) {
			throw fixedError("INVALID_INPUT");
		}
		columns.groupKinds[index] = encodeEnum(GROUP_KINDS, kind);
		columns.groupPitchMillimeters[index] = pitchMillimeters;
	} else if (kind === "STK") {
		const template = value.template;
		if (!STK_AUTHORING_TEMPLATES.includes(template as StkAuthoringTemplate)) {
			throw fixedError("INVALID_INPUT");
		}
		columns.groupKinds[index] = encodeEnum(GROUP_KINDS, kind);
		columns.groupTemplates[index] = encodeEnum(GROUP_TEMPLATES, template);
	} else {
		throw fixedError("INVALID_INPUT");
	}
}

function snapshotArraysHaveExactTypes(value: OpenFabStationProposalReviewDraftSnapshot): boolean {
	return (
		hasExactTypedArrayPrototype(value.decisionRows, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(value.decisionDispositions, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.rejectReasons, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.identityActions, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.portTypes, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.typeReviews, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.attachmentReviews, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeKinds, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeXs, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeZs, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeFromDirections, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeToDirections, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeSwitchIds, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeProfileClasses, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeRoles, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.routePortIndices, Int8Array.prototype) &&
		hasExactTypedArrayPrototype(value.routeSegmentOrdinals, Uint16Array.prototype) &&
		hasExactTypedArrayPrototype(value.stationMillimeters, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(value.stationReviews, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.sides, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.lateralOffsetMillimeters, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(value.sideOffsetReviews, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.directions, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.directionReviews, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.sourcePositionReviews, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.groupReviewIds, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(value.groupKinds, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.groupingReviews, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.groupTemplates, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(value.groupPitchMillimeters, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(value.groupMemberOffsets, Uint32Array.prototype) &&
		hasExactTypedArrayPrototype(value.groupMemberRows, Int32Array.prototype)
	);
}

function snapshotColumnsHaveExactLengths(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): boolean {
	const decisionLength = snapshot.decisionCount;
	const groupLength = snapshot.groupCount;
	return (
		intrinsicTypedArrayLength(snapshot.decisionRows) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.decisionDispositions) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.rejectReasons) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.identityActions) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.portTypes) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.typeReviews) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.attachmentReviews) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeKinds) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeXs) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeZs) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeFromDirections) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeToDirections) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeSwitchIds) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeProfileClasses) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeRoles) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routePortIndices) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.routeSegmentOrdinals) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.stationMillimeters) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.stationReviews) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.sides) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.lateralOffsetMillimeters) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.sideOffsetReviews) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.directions) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.directionReviews) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.sourcePositionReviews) === decisionLength &&
		intrinsicTypedArrayLength(snapshot.groupReviewIds) === groupLength &&
		intrinsicTypedArrayLength(snapshot.groupKinds) === groupLength &&
		intrinsicTypedArrayLength(snapshot.groupingReviews) === groupLength &&
		intrinsicTypedArrayLength(snapshot.groupTemplates) === groupLength &&
		intrinsicTypedArrayLength(snapshot.groupPitchMillimeters) === groupLength &&
		intrinsicTypedArrayLength(snapshot.groupMemberOffsets) === groupLength + 1 &&
		intrinsicTypedArrayLength(snapshot.groupMemberRows) === snapshot.membershipCount
	);
}

function decisionColumnsAreCanonical(snapshot: OpenFabStationProposalReviewDraftSnapshot): boolean {
	for (let index = 0; index < snapshot.decisionCount; index++) {
		if (!decisionRowIsCanonical(snapshot, index)) return false;
	}
	return true;
}

function decisionRowIsCanonical(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
	index: number,
): boolean {
	const disposition = snapshot.decisionDispositions[index] as number;
	if (disposition === 1) {
		return (
			isEnumCode(snapshot.rejectReasons[index], REJECT_REASONS.length) &&
			includeColumnsAreZero(snapshot, index)
		);
	}
	return (
		disposition === 2 &&
		snapshot.rejectReasons[index] === 0 &&
		isEnumCode(snapshot.identityActions[index], IDENTITY_ACTIONS.length) &&
		isEnumCode(snapshot.portTypes[index], PORT_TYPES.length) &&
		isEnumCode(snapshot.typeReviews[index], TYPE_REVIEWS.length) &&
		isEnumCode(snapshot.attachmentReviews[index], ATTACHMENT_REVIEWS.length) &&
		isEnumCode(snapshot.stationReviews[index], STATION_REVIEWS.length) &&
		isEnumCode(snapshot.sides[index], PORT_SIDES.length) &&
		isEnumCode(snapshot.sideOffsetReviews[index], SIDE_OFFSET_REVIEWS.length) &&
		isEnumCode(snapshot.directions[index], PORT_DIRECTIONS.length) &&
		isEnumCode(snapshot.directionReviews[index], DIRECTION_REVIEWS.length) &&
		isEnumCode(snapshot.sourcePositionReviews[index], SOURCE_POSITION_REVIEWS.length) &&
		routeColumnsAreCanonical(snapshot, index)
	);
}

function includeColumnsAreZero(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
	index: number,
): boolean {
	return (
		snapshot.identityActions[index] === 0 &&
		snapshot.portTypes[index] === 0 &&
		snapshot.typeReviews[index] === 0 &&
		snapshot.attachmentReviews[index] === 0 &&
		snapshot.routeKinds[index] === 0 &&
		snapshot.routeXs[index] === 0 &&
		snapshot.routeZs[index] === 0 &&
		snapshot.routeFromDirections[index] === 0 &&
		snapshot.routeToDirections[index] === 0 &&
		snapshot.routeSwitchIds[index] === 0 &&
		snapshot.routeProfileClasses[index] === 0 &&
		snapshot.routeRoles[index] === 0 &&
		snapshot.routePortIndices[index] === 0 &&
		snapshot.routeSegmentOrdinals[index] === 0 &&
		snapshot.stationMillimeters[index] === 0 &&
		snapshot.stationReviews[index] === 0 &&
		snapshot.sides[index] === 0 &&
		snapshot.lateralOffsetMillimeters[index] === 0 &&
		snapshot.sideOffsetReviews[index] === 0 &&
		snapshot.directions[index] === 0 &&
		snapshot.directionReviews[index] === 0 &&
		snapshot.sourcePositionReviews[index] === 0
	);
}

function routeColumnsAreCanonical(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
	index: number,
): boolean {
	if (snapshot.routeKinds[index] === 1) {
		const from = snapshot.routeFromDirections[index] as number;
		const to = snapshot.routeToDirections[index] as number;
		return (
			isRouteEnd(from) &&
			isRouteEnd(to) &&
			!(from === 0 && to === 0) &&
			from !== to &&
			snapshot.routeSwitchIds[index] === 0 &&
			snapshot.routeProfileClasses[index] === 0 &&
			snapshot.routeRoles[index] === 0 &&
			snapshot.routePortIndices[index] === 0 &&
			snapshot.routeSegmentOrdinals[index] === 0
		);
	}
	if (snapshot.routeKinds[index] !== 2) return false;
	const roleCode = snapshot.routeRoles[index] as number;
	if (
		snapshot.routeXs[index] !== 0 ||
		snapshot.routeZs[index] !== 0 ||
		snapshot.routeFromDirections[index] !== 0 ||
		snapshot.routeToDirections[index] !== 0 ||
		(snapshot.routeSwitchIds[index] as number) <= 0 ||
		!isEnumCode(snapshot.routeProfileClasses[index], ADVANCED_SWITCH_PROFILE_CLASSES.length) ||
		!isEnumCode(roleCode, ADVANCED_SWITCH_ROUTE_ROLES.length)
	) {
		return false;
	}
	const role = decodeEnum(ADVANCED_SWITCH_ROUTE_ROLES, roleCode);
	const portIndex = snapshot.routePortIndices[index] as number;
	return role === "THROAT" ? portIndex === -1 : portIndex === 0 || portIndex === 1;
}

function groupColumnsAreCanonical(snapshot: OpenFabStationProposalReviewDraftSnapshot): boolean {
	for (let index = 0; index < snapshot.groupCount; index++) {
		if (!groupRowIsCanonical(snapshot, index)) return false;
	}
	return true;
}

function groupRowIsCanonical(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
	index: number,
): boolean {
	if (
		!isEnumCode(snapshot.groupKinds[index], GROUP_KINDS.length) ||
		!isEnumCode(snapshot.groupingReviews[index], GROUPING_REVIEWS.length)
	) {
		return false;
	}
	const kind = decodeEnum(GROUP_KINDS, snapshot.groupKinds[index] as number);
	const templateCode = snapshot.groupTemplates[index] as number;
	if (kind === "OHB") {
		return templateCode === 1 && snapshot.groupPitchMillimeters[index] === 0;
	}
	if (kind === "EQ") return templateCode === 0;
	return (
		isEnumCode(templateCode, GROUP_TEMPLATES.length) &&
		templateCode !== 1 &&
		snapshot.groupPitchMillimeters[index] === 0
	);
}

function groupMembershipCsrIsCanonical(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): boolean {
	if (
		snapshot.groupMemberOffsets[0] !== 0 ||
		snapshot.groupMemberOffsets[snapshot.groupCount] !== snapshot.membershipCount
	) {
		return false;
	}
	for (let index = 0; index < snapshot.groupCount; index++) {
		if (
			(snapshot.groupMemberOffsets[index] as number) >
			(snapshot.groupMemberOffsets[index + 1] as number)
		) {
			return false;
		}
	}
	return true;
}

function snapshotViews(snapshot: OpenFabStationProposalReviewDraftSnapshot): ArrayBufferView[] {
	return [
		snapshot.decisionRows,
		snapshot.decisionDispositions,
		snapshot.rejectReasons,
		snapshot.identityActions,
		snapshot.portTypes,
		snapshot.typeReviews,
		snapshot.attachmentReviews,
		snapshot.routeKinds,
		snapshot.routeXs,
		snapshot.routeZs,
		snapshot.routeFromDirections,
		snapshot.routeToDirections,
		snapshot.routeSwitchIds,
		snapshot.routeProfileClasses,
		snapshot.routeRoles,
		snapshot.routePortIndices,
		snapshot.routeSegmentOrdinals,
		snapshot.stationMillimeters,
		snapshot.stationReviews,
		snapshot.sides,
		snapshot.lateralOffsetMillimeters,
		snapshot.sideOffsetReviews,
		snapshot.directions,
		snapshot.directionReviews,
		snapshot.sourcePositionReviews,
		snapshot.groupReviewIds,
		snapshot.groupKinds,
		snapshot.groupingReviews,
		snapshot.groupTemplates,
		snapshot.groupPitchMillimeters,
		snapshot.groupMemberOffsets,
		snapshot.groupMemberRows,
	];
}

function cleanSnapshotViews(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): ArrayBufferView[] {
	return snapshotViews(snapshot).map(cleanTypedArrayView);
}

interface IntrinsicTypedArrayState {
	readonly buffer: ArrayBufferLike;
	readonly byteOffset: number;
	readonly byteLength: number;
	readonly length: number;
}

function intrinsicTypedArrayState(value: object): IntrinsicTypedArrayState | null {
	if (
		TYPED_ARRAY_BUFFER_GETTER === undefined ||
		TYPED_ARRAY_BYTE_OFFSET_GETTER === undefined ||
		TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
		TYPED_ARRAY_LENGTH_GETTER === undefined
	) {
		return null;
	}
	try {
		const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
		const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []);
		const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
		const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []);
		if (
			typeof buffer !== "object" ||
			buffer === null ||
			!Number.isSafeInteger(byteOffset) ||
			byteOffset < 0 ||
			!Number.isSafeInteger(byteLength) ||
			byteLength < 0 ||
			!Number.isSafeInteger(length) ||
			length < 0
		) {
			return null;
		}
		return { buffer, byteOffset, byteLength, length };
	} catch {
		return null;
	}
}

function intrinsicTypedArrayStateOrThrow(value: object): IntrinsicTypedArrayState {
	const state = intrinsicTypedArrayState(value);
	if (state === null) throw fixedError("SNAPSHOT_TYPED_ARRAY_MISMATCH");
	return state;
}

function intrinsicOwnedArrayBufferOrThrow(value: object): ArrayBuffer {
	const buffer = intrinsicTypedArrayStateOrThrow(value).buffer;
	if (!(buffer instanceof ArrayBuffer)) {
		throw fixedError("SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH");
	}
	return buffer;
}

function intrinsicTypedArrayLength(value: object): number {
	return intrinsicTypedArrayState(value)?.length ?? -1;
}

function hasExactTypedArrayPrototype(value: unknown, prototype: object): value is ArrayBufferView {
	if (typeof value !== "object" || value === null) return false;
	try {
		return Object.getPrototypeOf(value) === prototype && intrinsicTypedArrayState(value) !== null;
	} catch {
		return false;
	}
}

function hasCriticalTypedArrayOwnProperty(value: object): boolean {
	return TYPED_ARRAY_CRITICAL_KEYS.some((key) => Object.hasOwn(value, key));
}

function cleanTypedArrayView(view: ArrayBufferView): ArrayBufferView {
	const state = intrinsicTypedArrayStateOrThrow(view);
	if (!(state.buffer instanceof ArrayBuffer)) {
		throw fixedError("SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH");
	}
	const prototype = Object.getPrototypeOf(view);
	if (prototype === Int32Array.prototype) {
		return new Int32Array(state.buffer, state.byteOffset, state.length);
	}
	if (prototype === Uint32Array.prototype) {
		return new Uint32Array(state.buffer, state.byteOffset, state.length);
	}
	if (prototype === Uint16Array.prototype) {
		return new Uint16Array(state.buffer, state.byteOffset, state.length);
	}
	if (prototype === Int8Array.prototype) {
		return new Int8Array(state.buffer, state.byteOffset, state.length);
	}
	if (prototype === Uint8Array.prototype) {
		return new Uint8Array(state.buffer, state.byteOffset, state.length);
	}
	throw fixedError("SNAPSHOT_TYPED_ARRAY_MISMATCH");
}

function viewsOwnUniqueFixedBuffers(views: readonly ArrayBufferView[]): boolean {
	if (views.length !== OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT) return false;
	const buffers = new Set<ArrayBuffer>();
	for (const view of views) {
		if (hasCriticalTypedArrayOwnProperty(view)) return false;
		const state = intrinsicTypedArrayState(view);
		if (state === null) return false;
		const buffer = state.buffer;
		const intrinsicByteLength = intrinsicArrayBufferByteLength(buffer);
		let bufferHasCanonicalObjectShape = false;
		try {
			bufferHasCanonicalObjectShape =
				Object.getPrototypeOf(buffer) === ArrayBuffer.prototype &&
				Reflect.ownKeys(buffer).length === 0;
		} catch {
			return false;
		}
		if (
			!(buffer instanceof ArrayBuffer) ||
			!bufferHasCanonicalObjectShape ||
			intrinsicByteLength === null ||
			arrayBufferIsDetached(buffer) ||
			arrayBufferIsResizable(buffer) ||
			state.byteOffset !== 0 ||
			state.byteLength !== intrinsicByteLength ||
			buffers.has(buffer)
		) {
			return false;
		}
		buffers.add(buffer);
	}
	return true;
}

/**
 * A transfer detaches the source view and removes all canonical integer-index keys. Any residual
 * own key is therefore a custom enumerable, hidden, or symbol field that structured clone dropped.
 * This keeps the exact-shape check O(column count) instead of enumerating up to 100,000 indices.
 */
function transferredSourceViewsHaveNoCustomOwnProperties(
	views: readonly ArrayBufferView[],
): boolean {
	try {
		return views.every((view) => Reflect.ownKeys(view).length === 0);
	} catch {
		return false;
	}
}

/** Keep accepted private/fresh views writable by index while preventing later custom metadata. */
function lockTypedArrayViewShapes(views: readonly ArrayBufferView[]): void {
	try {
		for (const view of views) {
			Object.preventExtensions(view);
			if (Object.isExtensible(view)) throw new Error("typed view remained extensible");
		}
	} catch {
		throw fixedError("SNAPSHOT_TYPED_ARRAY_MISMATCH");
	}
}

function typedArrayViewShapesAreLocked(views: readonly ArrayBufferView[]): boolean {
	try {
		return views.every((view) => !Object.isExtensible(view));
	} catch {
		return false;
	}
}

/**
 * Compatibility-only exact scan for externally cloned snapshots. Maximum payloads should use the
 * cooperative adoption API, whose detachment check remains O(column count).
 */
function typedArrayViewShapesAreCanonicalForSynchronousTransfer(
	views: readonly ArrayBufferView[],
): boolean {
	try {
		for (const view of views) {
			const state = intrinsicTypedArrayState(view);
			if (state === null || Reflect.ownKeys(view).length !== state.length) return false;
		}
		for (const view of views) {
			Object.preventExtensions(view);
			if (Object.isExtensible(view)) return false;
		}
		return true;
	} catch {
		return false;
	}
}

function intrinsicArrayBufferByteLength(buffer: ArrayBufferLike): number | null {
	if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return null;
	try {
		const byteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
		return typeof byteLength === "number" ? byteLength : null;
	} catch {
		return null;
	}
}

function arrayBufferIsDetached(buffer: ArrayBuffer): boolean {
	try {
		Reflect.apply(ARRAY_BUFFER_SLICE, buffer, [0, 0]);
		return false;
	} catch {
		return true;
	}
}

function arrayBufferIsResizable(buffer: ArrayBuffer): boolean {
	if (ARRAY_BUFFER_RESIZABLE_GETTER === undefined) return false;
	try {
		return Reflect.apply(ARRAY_BUFFER_RESIZABLE_GETTER, buffer, []) === true;
	} catch {
		return true;
	}
}

function snapshotByteLength(
	decisionCount: number,
	groupCount: number,
	membershipCount: number,
): number {
	// 25 decision columns = 44 bytes/decision; five group fields plus CSR = 15 bytes/group.
	const byteLength = decisionCount * 44 + groupCount * 15 + membershipCount * 4 + 4;
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw fixedError("BYTE_LIMIT_EXCEEDED");
	return byteLength;
}

function fingerprintUnchecked(snapshot: OpenFabStationProposalReviewDraftSnapshot): string {
	const checksum = fingerprintPrefix(snapshot);
	checksum.addViews(cleanSnapshotViews(snapshot));
	return `${FINGERPRINT_DOMAIN}:${checksum.digest()}`;
}

async function fingerprintCooperatively(
	snapshot: Omit<OpenFabStationProposalReviewDraftSnapshot, "fingerprint">,
	cooperative: CooperativeController,
): Promise<string> {
	const checksum = fingerprintPrefix(snapshot);
	await checksum.addViewsCooperatively(
		cleanSnapshotViews(snapshot as OpenFabStationProposalReviewDraftSnapshot),
		() => cooperative.checkTime(),
		CHECKSUM_BYTES_PER_TIME_CHECK,
	);
	return `${FINGERPRINT_DOMAIN}:${checksum.digest()}`;
}

function fingerprintPrefix(
	snapshot: Omit<OpenFabStationProposalReviewDraftSnapshot, "fingerprint">,
): OrderedTypedChecksum {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([FINGERPRINT_DOMAIN]);
	checksum.addNumbers([
		snapshot.version,
		snapshot.proposalRowCount,
		snapshot.decisionCount,
		snapshot.groupCount,
		snapshot.membershipCount,
		snapshot.rejectedSourceRowsPolicyCode,
		snapshot.unknownColumnsPolicyCode,
		snapshot.organizationPolicyCode,
		snapshot.byteLength,
	]);
	return checksum;
}

interface CooperativeController {
	noteOperation(): boolean;
	checkTime(): Promise<void>;
	checkpointNow(): Promise<void>;
	throwIfAborted(): void;
}

function resolveEncodeCooperativeOptions(
	options: OpenFabStationProposalReviewDraftEncodeOptions,
): CooperativeController {
	if (!isDataRecord(options)) throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	const revisionValue = ownDataPropertyValue(options, "revision");
	if (typeof revisionValue !== "function") throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	const revision = revisionValue as () => unknown;
	const expectedRevision = readRevision(revision);
	return resolveCooperativeOptions(
		options,
		() => {
			if (readRevision(revision) !== expectedRevision) throw abortedError();
		},
		"ENCODE_FAILED",
	);
}

function resolveAdoptionCooperativeOptions(
	options: OpenFabStationProposalReviewDraftSnapshotAdoptionOptions,
): CooperativeController {
	return resolveCooperativeOptions(options, () => {}, "ADOPTION_FAILED");
}

function resolveCooperativeOptions(
	options:
		| OpenFabStationProposalReviewDraftEncodeOptions
		| OpenFabStationProposalReviewDraftSnapshotAdoptionOptions,
	assertRevision: () => void,
	failureCode: "ENCODE_FAILED" | "ADOPTION_FAILED",
): CooperativeController {
	if (!isDataRecord(options)) throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	const checkpoint = ownDataPropertyValue(options, "checkpoint");
	const signal = ownDataPropertyValue(options, "signal") as AbortSignal | undefined;
	const nowValue = ownDataPropertyValue(options, "now");
	const sliceValue = ownDataPropertyValue(options, "sliceMilliseconds");
	if (
		typeof checkpoint !== "function" ||
		(nowValue !== undefined && typeof nowValue !== "function") ||
		(sliceValue !== undefined &&
			(!Number.isFinite(sliceValue) ||
				(sliceValue as number) <= 0 ||
				(sliceValue as number) > MAX_SLICE_MILLISECONDS))
	) {
		throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	}
	const now = (nowValue as (() => number) | undefined) ?? (() => performance.now());
	const sliceMilliseconds = (sliceValue as number | undefined) ?? DEFAULT_SLICE_MILLISECONDS;
	let sliceStartedAt = readCooperativeTime(now, failureCode);
	let operations = 0;
	const throwIfAborted = (): void => {
		assertRevision();
		if (intrinsicSignalAborted(signal, failureCode)) throw abortedError();
	};
	const checkpointNow = async (): Promise<void> => {
		throwIfAborted();
		try {
			await checkpoint();
		} catch {
			throwIfAborted();
			throw fixedError(failureCode);
		}
		throwIfAborted();
		sliceStartedAt = readCooperativeTime(now, failureCode);
	};
	return {
		noteOperation() {
			operations++;
			return operations % OPERATIONS_PER_TIME_CHECK === 0;
		},
		async checkTime() {
			throwIfAborted();
			const current = readCooperativeTime(now, failureCode);
			if (current < sliceStartedAt) throw fixedError("INVALID_COOPERATIVE_OPTIONS");
			if (current - sliceStartedAt < sliceMilliseconds) return;
			await checkpointNow();
		},
		checkpointNow,
		throwIfAborted,
	};
}

function ownDataPropertyValue(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function readRevision(revision: () => unknown): number {
	const value = revision();
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	}
	return value as number;
}

function readCooperativeTime(
	now: () => number,
	failureCode: "ENCODE_FAILED" | "ADOPTION_FAILED",
): number {
	let value: unknown;
	try {
		value = now();
	} catch {
		throw fixedError(failureCode);
	}
	if (!Number.isFinite(value)) throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	return value as number;
}

function intrinsicSignalAborted(
	signal: AbortSignal | undefined,
	failureCode: "ENCODE_FAILED" | "ADOPTION_FAILED",
): boolean {
	if (signal === undefined) return false;
	if (ABORT_SIGNAL_ABORTED_GETTER === undefined) throw fixedError(failureCode);
	try {
		return Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) === true;
	} catch {
		throw fixedError(failureCode);
	}
}

function encodeEnum<const Values extends readonly unknown[]>(
	values: Values,
	value: unknown,
): number {
	const index = values.indexOf(value);
	if (index < 0) throw fixedError("INVALID_INPUT");
	return index + 1;
}

function decodeEnum<const Values extends readonly unknown[]>(
	values: Values,
	code: number,
): Values[number] {
	return values[code - 1] as Values[number];
}

function isEnumCode(value: unknown, count: number): value is number {
	return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= count;
}

function isRouteEnd(value: unknown): value is 0 | Direction {
	return ROUTE_ENDS.includes(value as (typeof ROUTE_ENDS)[number]);
}

function isInt32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= MIN_INT32 && (value as number) <= MAX_INT32
	);
}

function isBoundedCount(value: unknown, maximum: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

/** Capture every outer scalar/column identity once; later validation never re-reads the caller. */
function captureSnapshotIdentity(value: unknown): OpenFabStationProposalReviewDraftSnapshot | null {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;
		const actualKeys = Reflect.ownKeys(value);
		if (
			actualKeys.length !== SNAPSHOT_KEYS.length ||
			actualKeys.some((key) => typeof key !== "string")
		) {
			return null;
		}
		const actualKeySet = new Set(actualKeys as string[]);
		if (SNAPSHOT_KEYS.some((key) => !actualKeySet.has(key))) return null;
		const captured = Object.create(null) as Record<string, unknown>;
		for (const key of SNAPSHOT_KEYS) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			Object.defineProperty(captured, key, {
				value: descriptor.value,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze(captured) as unknown as OpenFabStationProposalReviewDraftSnapshot;
	} catch {
		return null;
	}
}

function captureDraftSnapshotSourceIdentity(
	value: unknown,
): OpenFabStationProposalReviewDraftSnapshotSource | null {
	const captured = captureMatchedEnumerableOwnDataRecord(value, [SNAPSHOT_SOURCE_KEYS]);
	return captured === null
		? null
		: (captured.values as unknown as OpenFabStationProposalReviewDraftSnapshotSource);
}

/** Capture a caller-owned record exactly once without invoking any property getter or get trap. */
function captureMatchedEnumerableOwnDataRecord(
	value: unknown,
	expectedKeySets: readonly (readonly string[])[],
): CapturedMatchedDataRecord | null {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;
		const actualKeys = Reflect.ownKeys(value);
		if (actualKeys.some((key) => typeof key !== "string")) return null;
		const actualStringKeys = actualKeys as string[];
		const actualKeySet = new Set(actualStringKeys);
		let matchIndex = -1;
		for (let index = 0; index < expectedKeySets.length; index++) {
			const expectedKeys = expectedKeySets[index] as readonly string[];
			if (
				actualStringKeys.length === expectedKeys.length &&
				expectedKeys.every((key) => actualKeySet.has(key))
			) {
				matchIndex = index;
				break;
			}
		}
		if (matchIndex < 0) return null;

		const values = Object.create(null) as Record<string, unknown>;
		for (const key of expectedKeySets[matchIndex] as readonly string[]) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			Object.defineProperty(values, key, {
				value: descriptor.value,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze({ values: Object.freeze(values), matchIndex });
	} catch {
		return null;
	}
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	return Reflect.ownKeys(value).every((key) => {
		if (typeof key !== "string") return false;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) return false;
		return descriptor.enumerable && "value" in descriptor;
	});
}

class DraftSnapshotError extends Error {
	readonly code: OpenFabStationProposalReviewDraftSnapshotErrorCode;

	constructor(code: OpenFabStationProposalReviewDraftSnapshotErrorCode) {
		super(code);
		this.name = "OpenFabStationProposalReviewDraftSnapshotError";
		this.code = code;
	}
}

function fixedError(code: OpenFabStationProposalReviewDraftSnapshotErrorCode): DraftSnapshotError {
	const error = new DraftSnapshotError(code);
	internallyMintedDraftSnapshotErrorCodes.set(error, code);
	return error;
}

function abortedError(): Error {
	const error = new Error("OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED");
	error.name = "AbortError";
	internallyMintedAbortErrors.add(error);
	return error;
}

function isInternallyMintedAbortError(error: unknown): error is Error {
	return typeof error === "object" && error !== null && internallyMintedAbortErrors.has(error);
}

function isInternallyMintedDraftSnapshotError(error: unknown): error is DraftSnapshotError {
	return (
		typeof error === "object" &&
		error !== null &&
		internallyMintedDraftSnapshotErrorCodes.has(error)
	);
}

function internallyMintedDraftSnapshotErrorCode(
	error: unknown,
): OpenFabStationProposalReviewDraftSnapshotErrorCode | undefined {
	return typeof error === "object" && error !== null
		? internallyMintedDraftSnapshotErrorCodes.get(error)
		: undefined;
}

function normalizeEncodeError(error: unknown): Error {
	if (isInternallyMintedAbortError(error)) {
		return abortedError();
	}
	const code = internallyMintedDraftSnapshotErrorCode(error);
	if (code !== undefined) return fixedError(code);
	return fixedError("ENCODE_FAILED");
}

function normalizeAdoptionError(error: unknown): Error {
	if (isInternallyMintedAbortError(error)) {
		return abortedError();
	}
	const code = internallyMintedDraftSnapshotErrorCode(error);
	if (code !== undefined) return fixedError(code);
	return fixedError("ADOPTION_FAILED");
}
