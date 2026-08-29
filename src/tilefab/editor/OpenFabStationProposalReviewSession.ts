import {
	type HydratedOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_MAX_ROWS,
	OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
	type OpenFabStationProposalRow,
} from "../compile/OpenFabStationProposalArtifact";
import type {
	OpenFabStationProposalIncludeDecision,
	OpenFabStationProposalRejectReason,
	OpenFabStationProposalReviewDraft,
	OpenFabStationProposalRowDecision,
} from "../compile/OpenFabStationProposalReview";
import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchProfileClass,
} from "../core/AdvancedSwitch";
import {
	EQ_MAXIMUM_PORT_COUNT,
	EQ_PORT_PITCHES_MILLIMETERS,
	STK_AUTHORING_TEMPLATES,
	STK_MAXIMUM_PORT_COUNT,
	type StkAuthoringTemplate,
} from "../core/EquipmentGroup";
import {
	ADVANCED_SWITCH_ROUTE_ROLES,
	type AdvancedSwitchRouteRole,
	copyPortRouteIdentity,
	PORT_DIRECTIONS,
	PORT_RECORD_MAX_OFFSET_MILLIMETERS,
	PORT_RECORD_MAX_STATION_MILLIMETERS,
	PORT_SIDES,
	PORT_TYPES,
	type PortRouteIdentity,
	type PortType,
} from "../core/PortRecord";
import type { Direction } from "../core/railShape";
import {
	type OpenFabStationProposalReviewDraftSnapshot,
	type OpenFabStationProposalReviewDraftSnapshotSource,
	revokeEncodedOpenFabStationProposalReviewDraftSnapshot,
	sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively,
} from "../worker/OpenFabStationProposalReviewDraftSoA";

export const OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_VERSION = 1 as const;
export const OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_WINDOW_MAX_ROWS = 128;

export type OpenFabStationProposalReviewRejectedSourceRowsPolicy =
	OpenFabStationProposalReviewDraft["rejectedSourceRowsPolicy"];
export type OpenFabStationProposalReviewUnknownColumnsPolicy =
	OpenFabStationProposalReviewDraft["unknownColumnsPolicy"];
export type OpenFabStationProposalReviewOrganizationPolicy =
	OpenFabStationProposalReviewDraft["organizationPolicy"];
export type OpenFabStationProposalReviewGroupingReview = "CONFIRM_DECLARED" | "OVERRIDE";

export interface OpenFabStationProposalReviewSessionSummary {
	readonly revision: number;
	readonly proposalRowCount: number;
	readonly decidedRowCount: number;
	readonly includedRowCount: number;
	readonly rejectedRowCount: number;
	readonly activeGroupCount: number;
	readonly emptyGroupCount: number;
	readonly membershipCount: number;
	readonly ungroupedIncludedRowCount: number;
	readonly pendingGroupReviewCount: number;
	readonly pendingGroupConfigurationCount: number;
	readonly rejectedSourceRowsPolicy: OpenFabStationProposalReviewRejectedSourceRowsPolicy | null;
	readonly unknownColumnsPolicy: OpenFabStationProposalReviewUnknownColumnsPolicy | null;
	readonly organizationPolicy: OpenFabStationProposalReviewOrganizationPolicy | null;
	readonly captureReady: boolean;
}

export interface OpenFabStationProposalReviewSessionRow {
	readonly row: number;
	readonly proposal: OpenFabStationProposalRow;
	readonly decision: OpenFabStationProposalRowDecision | null;
	readonly reviewGroupId: number | null;
}

export interface OpenFabStationProposalReviewSessionGroup {
	readonly reviewGroupId: number;
	readonly kind: PortType;
	readonly groupingReview: OpenFabStationProposalReviewGroupingReview | null;
	readonly template: "SINGLE" | StkAuthoringTemplate | null;
	readonly pitchMillimeters: number | null;
	readonly memberCount: number;
}

export interface OpenFabStationProposalReviewSessionWindow<Item> {
	readonly start: number;
	readonly endExclusive: number;
	readonly totalCount: number;
	readonly items: readonly Item[];
}

export type OpenFabStationProposalReviewSessionCommand =
	| {
			readonly type: "REJECT_ROW";
			readonly row: number;
			readonly reason: OpenFabStationProposalRejectReason;
	  }
	| {
			readonly type: "INCLUDE_ROW";
			readonly decision: OpenFabStationProposalIncludeDecision;
	  }
	| {
			readonly type: "CREATE_GROUP";
			readonly reviewGroupId: number;
			readonly kind: PortType;
	  }
	| {
			readonly type: "DELETE_GROUP";
			readonly reviewGroupId: number;
	  }
	| {
			readonly type: "SET_GROUP_MEMBERS";
			readonly reviewGroupId: number;
			readonly memberRows: readonly number[];
	  }
	| {
			readonly type: "SET_GROUP_REVIEW";
			readonly reviewGroupId: number;
			readonly groupingReview: OpenFabStationProposalReviewGroupingReview;
	  }
	| {
			readonly type: "SET_EQ_PITCH";
			readonly reviewGroupId: number;
			readonly pitchMillimeters: number;
	  }
	| {
			readonly type: "SET_STK_TEMPLATE";
			readonly reviewGroupId: number;
			readonly template: StkAuthoringTemplate;
	  }
	| {
			readonly type: "SET_REJECTED_SOURCE_ROWS_POLICY";
			readonly policy: OpenFabStationProposalReviewRejectedSourceRowsPolicy;
	  }
	| {
			readonly type: "SET_UNKNOWN_COLUMNS_POLICY";
			readonly policy: OpenFabStationProposalReviewUnknownColumnsPolicy;
	  }
	| {
			readonly type: "SET_ORGANIZATION_POLICY";
			readonly policy: OpenFabStationProposalReviewOrganizationPolicy;
	  };

export interface OpenFabStationProposalReviewSessionCaptureOptions {
	readonly checkpoint: () => Promise<void>;
	/** A positive caller-owned generation. A change makes this capture terminally stale. */
	readonly revision: () => number;
	readonly signal?: AbortSignal;
	readonly operationsPerCheckpoint?: number;
	readonly now?: () => number;
	readonly sliceMilliseconds?: number;
}

export interface OpenFabStationProposalReviewSession {
	readonly kind: "openfab-station-proposal-review-session";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_VERSION;
	readonly proposalRowCount: number;
	getSummary(): OpenFabStationProposalReviewSessionSummary;
	subscribe(listener: () => void): () => void;
	readRowWindow(
		start: number,
		count: number,
	): OpenFabStationProposalReviewSessionWindow<OpenFabStationProposalReviewSessionRow>;
	readGroupWindow(
		start: number,
		count: number,
	): OpenFabStationProposalReviewSessionWindow<OpenFabStationProposalReviewSessionGroup>;
	readGroupMemberWindow(
		reviewGroupId: number,
		start: number,
		count: number,
	): OpenFabStationProposalReviewSessionWindow<number>;
	dispatch(
		command: OpenFabStationProposalReviewSessionCommand,
	): OpenFabStationProposalReviewSessionSummary;
	captureDraftSnapshotCooperatively(
		options: OpenFabStationProposalReviewSessionCaptureOptions,
	): Promise<OpenFabStationProposalReviewDraftSnapshot>;
}

interface SessionState {
	readonly proposal: HydratedOpenFabStationProposalArtifact;
	readonly readProposalRow: (row: number) => OpenFabStationProposalRow;
	readonly rowCount: number;
	readonly rejectedSourceRowCount: number;
	readonly unknownColumnCount: number;
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
	readonly rowGroupSlots: Int32Array;
	readonly rowGroupNext: Int32Array;
	readonly groupActive: Uint8Array;
	readonly groupFirstRows: Int32Array;
	readonly activeGroupSlots: Int32Array;
	readonly groupActiveIndexes: Int32Array;
	readonly groupReviewIds: Int32Array;
	readonly groupKinds: Uint8Array;
	readonly groupingReviews: Uint8Array;
	readonly groupTemplates: Uint8Array;
	readonly groupPitchMillimeters: Int32Array;
	readonly groupMemberCounts: Uint32Array;
	readonly groupSlotById: Map<number, number>;
	readonly freeGroupSlots: number[];
	readonly listeners: Set<() => void>;
	capturingCommand: boolean;
	nextUnusedGroupSlot: number;
	revision: number;
	decidedRowCount: number;
	includedRowCount: number;
	rejectedRowCount: number;
	activeGroupCount: number;
	emptyGroupCount: number;
	membershipCount: number;
	pendingGroupReviewCount: number;
	pendingGroupConfigurationCount: number;
	rejectedSourceRowsPolicy: OpenFabStationProposalReviewRejectedSourceRowsPolicy | null;
	unknownColumnsPolicy: OpenFabStationProposalReviewUnknownColumnsPolicy | null;
	organizationPolicy: OpenFabStationProposalReviewOrganizationPolicy | null;
	summary: OpenFabStationProposalReviewSessionSummary;
}

interface CapturedProposalFacade {
	readonly rowCount: number;
	readonly rejectedRowCount: number;
	readonly unknownColumnCount: number;
	readonly readRow: HydratedOpenFabStationProposalArtifact["readRow"];
}

interface CompactColumns {
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
}

interface CapturedSessionCaptureOptions {
	readonly checkpoint: () => Promise<void>;
	readonly revision: () => number;
	readonly signal: AbortSignal | undefined;
	readonly operationsPerCheckpoint: number;
	readonly now: (() => number) | undefined;
	readonly sliceMilliseconds: number | undefined;
}

interface SessionCaptureGuard {
	readonly options: CapturedSessionCaptureOptions;
	readonly assertFresh: () => void;
	readonly sealerRevision: () => number;
}

const SESSION_KIND = "openfab-station-proposal-review-session" as const;
const DEFAULT_OPERATIONS_PER_CHECKPOINT = 512;
const MAX_OPERATIONS_PER_CHECKPOINT = 4_096;
const DEFAULT_CAPTURE_SLICE_MILLISECONDS = 4;
const CAPTURE_TIME_CHECK_OPERATIONS = 128;
const MAX_INT32 = 0x7fff_ffff;
const MAX_GROUP_MEMBER_INPUT_COUNT = EQ_MAXIMUM_PORT_COUNT;

const REJECT_REASONS = Object.freeze(["USER_EXCLUDED", "UNRESOLVED", "UNSUPPORTED"] as const);
const TYPE_REVIEWS = Object.freeze(["CONFIRM_DECLARED", "OVERRIDE"] as const);
const STATION_REVIEWS = TYPE_REVIEWS;
const SIDE_OFFSET_REVIEWS = TYPE_REVIEWS;
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
const GROUPING_REVIEWS = TYPE_REVIEWS;
const GROUP_TEMPLATES = Object.freeze(["SINGLE", ...STK_AUTHORING_TEMPLATES] as const);
const REJECT_COMMAND_KEYS = Object.freeze(["type", "row", "reason"] as const);
const INCLUDE_COMMAND_KEYS = Object.freeze(["type", "decision"] as const);
const CREATE_GROUP_COMMAND_KEYS = Object.freeze(["type", "reviewGroupId", "kind"] as const);
const GROUP_ID_COMMAND_KEYS = Object.freeze(["type", "reviewGroupId"] as const);
const GROUP_MEMBERS_COMMAND_KEYS = Object.freeze(["type", "reviewGroupId", "memberRows"] as const);
const GROUP_REVIEW_COMMAND_KEYS = Object.freeze([
	"type",
	"reviewGroupId",
	"groupingReview",
] as const);
const EQ_PITCH_COMMAND_KEYS = Object.freeze(["type", "reviewGroupId", "pitchMillimeters"] as const);
const STK_TEMPLATE_COMMAND_KEYS = Object.freeze(["type", "reviewGroupId", "template"] as const);
const POLICY_COMMAND_KEYS = Object.freeze(["type", "policy"] as const);
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
const CAPTURE_OPTION_KEYS = Object.freeze([
	"checkpoint",
	"revision",
	"signal",
	"operationsPerCheckpoint",
	"now",
	"sliceMilliseconds",
] as const);
const PROPOSAL_FACADE_KEYS = Object.freeze([
	"kind",
	"schemaId",
	"schemaVersion",
	"sourceByteLength",
	"sourceRecordCount",
	"rowCount",
	"rejectedRowCount",
	"unknownColumnCount",
	"semanticFingerprint",
	"snapshotFingerprint",
	"readRow",
	"issueCount",
] as const);
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
	AbortSignal.prototype,
	"aborted",
)?.get;

const genuineSessions = new WeakSet<object>();
const sessionStates = new WeakMap<object, SessionState>();

export function createOpenFabStationProposalReviewSession(
	proposal: HydratedOpenFabStationProposalArtifact,
): OpenFabStationProposalReviewSession {
	const capturedProposal = captureProposalFacade(proposal);
	const rowCount = capturedProposal.rowCount;
	const state = createSessionState(proposal, capturedProposal);
	const session = Object.freeze({
		kind: SESSION_KIND,
		version: OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_VERSION,
		proposalRowCount: rowCount,
		getSummary(this: OpenFabStationProposalReviewSession) {
			return requireSessionState(this).summary;
		},
		subscribe(this: OpenFabStationProposalReviewSession, listener: () => void) {
			const current = requireSessionState(this);
			if (typeof listener !== "function") throw new TypeError("review session listener is invalid");
			current.listeners.add(listener);
			let subscribed = true;
			return (): void => {
				if (!subscribed) return;
				subscribed = false;
				current.listeners.delete(listener);
			};
		},
		readRowWindow(this: OpenFabStationProposalReviewSession, start: number, count: number) {
			return readRowWindow(requireSessionState(this), start, count);
		},
		readGroupWindow(this: OpenFabStationProposalReviewSession, start: number, count: number) {
			return readGroupWindow(requireSessionState(this), start, count);
		},
		readGroupMemberWindow(
			this: OpenFabStationProposalReviewSession,
			reviewGroupId: number,
			start: number,
			count: number,
		) {
			return readGroupMemberWindow(requireSessionState(this), reviewGroupId, start, count);
		},
		dispatch(
			this: OpenFabStationProposalReviewSession,
			command: OpenFabStationProposalReviewSessionCommand,
		) {
			return dispatchCommand(requireSessionState(this), command);
		},
		captureDraftSnapshotCooperatively(
			this: OpenFabStationProposalReviewSession,
			options: OpenFabStationProposalReviewSessionCaptureOptions,
		) {
			return captureDraftSnapshotCooperatively(requireSessionState(this), options);
		},
	}) satisfies OpenFabStationProposalReviewSession;
	genuineSessions.add(session);
	sessionStates.set(session, state);
	return session;
}

export function isOpenFabStationProposalReviewSession(
	value: unknown,
): value is OpenFabStationProposalReviewSession {
	return typeof value === "object" && value !== null && genuineSessions.has(value);
}

export function openFabStationProposalReviewSessionMatchesProposal(
	session: unknown,
	proposal: unknown,
): boolean {
	if (typeof session !== "object" || session === null || !genuineSessions.has(session))
		return false;
	return sessionStates.get(session)?.proposal === proposal;
}

function createSessionState(
	proposal: HydratedOpenFabStationProposalArtifact,
	capturedProposal: CapturedProposalFacade,
): SessionState {
	const rowCount = capturedProposal.rowCount;
	const readProposalRow = (row: number): OpenFabStationProposalRow =>
		Reflect.apply(capturedProposal.readRow, proposal, [row]);
	const rowGroupSlots = new Int32Array(rowCount);
	rowGroupSlots.fill(-1);
	const rowGroupNext = new Int32Array(rowCount);
	rowGroupNext.fill(-1);
	const groupFirstRows = new Int32Array(rowCount);
	groupFirstRows.fill(-1);
	const activeGroupSlots = new Int32Array(rowCount);
	activeGroupSlots.fill(-1);
	const groupActiveIndexes = new Int32Array(rowCount);
	groupActiveIndexes.fill(-1);
	const provisional = {
		proposal,
		readProposalRow,
		rowCount,
		rejectedSourceRowCount: capturedProposal.rejectedRowCount,
		unknownColumnCount: capturedProposal.unknownColumnCount,
		decisionDispositions: new Uint8Array(rowCount),
		rejectReasons: new Uint8Array(rowCount),
		identityActions: new Uint8Array(rowCount),
		portTypes: new Uint8Array(rowCount),
		typeReviews: new Uint8Array(rowCount),
		attachmentReviews: new Uint8Array(rowCount),
		routeKinds: new Uint8Array(rowCount),
		routeXs: new Int32Array(rowCount),
		routeZs: new Int32Array(rowCount),
		routeFromDirections: new Uint8Array(rowCount),
		routeToDirections: new Uint8Array(rowCount),
		routeSwitchIds: new Int32Array(rowCount),
		routeProfileClasses: new Uint8Array(rowCount),
		routeRoles: new Uint8Array(rowCount),
		routePortIndices: new Int8Array(rowCount),
		routeSegmentOrdinals: new Uint16Array(rowCount),
		stationMillimeters: new Int32Array(rowCount),
		stationReviews: new Uint8Array(rowCount),
		sides: new Uint8Array(rowCount),
		lateralOffsetMillimeters: new Int32Array(rowCount),
		sideOffsetReviews: new Uint8Array(rowCount),
		directions: new Uint8Array(rowCount),
		directionReviews: new Uint8Array(rowCount),
		sourcePositionReviews: new Uint8Array(rowCount),
		rowGroupSlots,
		rowGroupNext,
		groupActive: new Uint8Array(rowCount),
		groupFirstRows,
		activeGroupSlots,
		groupActiveIndexes,
		groupReviewIds: new Int32Array(rowCount),
		groupKinds: new Uint8Array(rowCount),
		groupingReviews: new Uint8Array(rowCount),
		groupTemplates: new Uint8Array(rowCount),
		groupPitchMillimeters: new Int32Array(rowCount),
		groupMemberCounts: new Uint32Array(rowCount),
		groupSlotById: new Map<number, number>(),
		freeGroupSlots: [],
		listeners: new Set<() => void>(),
		capturingCommand: false,
		nextUnusedGroupSlot: 0,
		revision: 1,
		decidedRowCount: 0,
		includedRowCount: 0,
		rejectedRowCount: 0,
		activeGroupCount: 0,
		emptyGroupCount: 0,
		membershipCount: 0,
		pendingGroupReviewCount: 0,
		pendingGroupConfigurationCount: 0,
		rejectedSourceRowsPolicy: null,
		unknownColumnsPolicy: null,
		organizationPolicy: null,
		summary: null,
	};
	const state = provisional as unknown as SessionState;
	state.summary = createSummary(state);
	return state;
}

function captureProposalFacade(proposal: unknown): CapturedProposalFacade {
	const record = captureEnumerableOwnDataRecord(proposal, "station proposal review source");
	assertExactRecordKeys(record, PROPOSAL_FACADE_KEYS, "station proposal review source");
	if (
		record.kind !== "hydrated-openfab-station-proposal-artifact" ||
		record.schemaId !== OPENFAB_STATION_PROPOSAL_SCHEMA_ID ||
		record.schemaVersion !== OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION ||
		!isNonNegativeSafeInteger(record.sourceByteLength) ||
		!isNonNegativeSafeInteger(record.sourceRecordCount) ||
		!isNonNegativeSafeInteger(record.rowCount) ||
		record.rowCount > OPENFAB_STATION_PROPOSAL_MAX_ROWS ||
		!isNonNegativeSafeInteger(record.rejectedRowCount) ||
		!isNonNegativeSafeInteger(record.unknownColumnCount) ||
		typeof record.semanticFingerprint !== "string" ||
		record.semanticFingerprint.length === 0 ||
		typeof record.snapshotFingerprint !== "string" ||
		record.snapshotFingerprint.length === 0 ||
		typeof record.readRow !== "function" ||
		typeof record.issueCount !== "function"
	) {
		throw new TypeError("station proposal review source is invalid");
	}
	return Object.freeze({
		rowCount: record.rowCount,
		rejectedRowCount: record.rejectedRowCount,
		unknownColumnCount: record.unknownColumnCount,
		readRow: record.readRow as HydratedOpenFabStationProposalArtifact["readRow"],
	});
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requireSessionState(session: OpenFabStationProposalReviewSession): SessionState {
	if (!genuineSessions.has(session))
		throw new TypeError("station proposal review session is invalid");
	const state = sessionStates.get(session);
	if (!state) throw new TypeError("station proposal review session is invalid");
	return state;
}

function readRowWindow(
	state: SessionState,
	startValue: number,
	countValue: number,
): OpenFabStationProposalReviewSessionWindow<OpenFabStationProposalReviewSessionRow> {
	const { start, count } = boundedWindow(startValue, countValue, state.rowCount);
	const items: OpenFabStationProposalReviewSessionRow[] = [];
	for (let row = start; row < start + count; row += 1) {
		const groupSlot = state.rowGroupSlots[row] as number;
		items.push(
			Object.freeze({
				row,
				proposal: state.readProposalRow(row),
				decision: decodeDecision(state, row),
				reviewGroupId: groupSlot < 0 ? null : (state.groupReviewIds[groupSlot] as number),
			}),
		);
	}
	return freezeWindow(start, state.rowCount, items);
}

function readGroupWindow(
	state: SessionState,
	startValue: number,
	countValue: number,
): OpenFabStationProposalReviewSessionWindow<OpenFabStationProposalReviewSessionGroup> {
	const window = boundedWindow(startValue, countValue, state.activeGroupCount);
	const items: OpenFabStationProposalReviewSessionGroup[] = [];
	for (
		let activeIndex = window.start;
		activeIndex < window.start + window.count;
		activeIndex += 1
	) {
		const slot = state.activeGroupSlots[activeIndex] as number;
		if (slot < 0 || state.groupActive[slot] !== 1) {
			throw new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CORRUPT");
		}
		items.push(decodeGroup(state, slot));
	}
	return freezeWindow(window.start, state.activeGroupCount, items);
}

function readGroupMemberWindow(
	state: SessionState,
	reviewGroupId: number,
	startValue: number,
	countValue: number,
): OpenFabStationProposalReviewSessionWindow<number> {
	const slot = requireGroupSlot(state, reviewGroupId);
	const totalCount = state.groupMemberCounts[slot] as number;
	const window = boundedWindow(startValue, countValue, totalCount);
	const items: number[] = [];
	let memberIndex = 0;
	let row = state.groupFirstRows[slot] as number;
	while (row >= 0 && items.length < window.count) {
		if (memberIndex >= window.start) items.push(row);
		memberIndex += 1;
		row = state.rowGroupNext[row] as number;
	}
	return freezeWindow(window.start, totalCount, items);
}

function freezeWindow<Item>(
	start: number,
	totalCount: number,
	items: Item[],
): OpenFabStationProposalReviewSessionWindow<Item> {
	return Object.freeze({
		start,
		endExclusive: start + items.length,
		totalCount,
		items: Object.freeze(items),
	});
}

function boundedWindow(
	startValue: number,
	countValue: number,
	totalCount: number,
): { readonly start: number; readonly count: number } {
	const start = Math.min(totalCount, nonNegativeInteger(startValue));
	const requestedCount = nonNegativeInteger(countValue);
	return Object.freeze({
		start,
		count: Math.min(
			OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_WINDOW_MAX_ROWS,
			requestedCount,
			totalCount - start,
		),
	});
}

function nonNegativeInteger(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function captureCommand(value: unknown): OpenFabStationProposalReviewSessionCommand {
	const command = captureEnumerableOwnDataRecord(value, "review session command");
	switch (command.type) {
		case "REJECT_ROW":
			assertExactRecordKeys(command, REJECT_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "REJECT_ROW",
				row: command.row as number,
				reason: command.reason as OpenFabStationProposalRejectReason,
			});
		case "INCLUDE_ROW":
			assertExactRecordKeys(command, INCLUDE_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "INCLUDE_ROW",
				decision: captureIncludeDecision(command.decision),
			});
		case "CREATE_GROUP":
			assertExactRecordKeys(command, CREATE_GROUP_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "CREATE_GROUP",
				reviewGroupId: command.reviewGroupId as number,
				kind: command.kind as PortType,
			});
		case "DELETE_GROUP":
			assertExactRecordKeys(command, GROUP_ID_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "DELETE_GROUP",
				reviewGroupId: command.reviewGroupId as number,
			});
		case "SET_GROUP_MEMBERS":
			assertExactRecordKeys(command, GROUP_MEMBERS_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "SET_GROUP_MEMBERS",
				reviewGroupId: command.reviewGroupId as number,
				memberRows: captureMemberRows(command.memberRows),
			});
		case "SET_GROUP_REVIEW":
			assertExactRecordKeys(command, GROUP_REVIEW_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "SET_GROUP_REVIEW",
				reviewGroupId: command.reviewGroupId as number,
				groupingReview: command.groupingReview as OpenFabStationProposalReviewGroupingReview,
			});
		case "SET_EQ_PITCH":
			assertExactRecordKeys(command, EQ_PITCH_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "SET_EQ_PITCH",
				reviewGroupId: command.reviewGroupId as number,
				pitchMillimeters: command.pitchMillimeters as number,
			});
		case "SET_STK_TEMPLATE":
			assertExactRecordKeys(command, STK_TEMPLATE_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "SET_STK_TEMPLATE",
				reviewGroupId: command.reviewGroupId as number,
				template: command.template as StkAuthoringTemplate,
			});
		case "SET_REJECTED_SOURCE_ROWS_POLICY":
			assertExactRecordKeys(command, POLICY_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "SET_REJECTED_SOURCE_ROWS_POLICY",
				policy: command.policy as OpenFabStationProposalReviewRejectedSourceRowsPolicy,
			});
		case "SET_UNKNOWN_COLUMNS_POLICY":
			assertExactRecordKeys(command, POLICY_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "SET_UNKNOWN_COLUMNS_POLICY",
				policy: command.policy as OpenFabStationProposalReviewUnknownColumnsPolicy,
			});
		case "SET_ORGANIZATION_POLICY":
			assertExactRecordKeys(command, POLICY_COMMAND_KEYS, "review session command");
			return Object.freeze({
				type: "SET_ORGANIZATION_POLICY",
				policy: command.policy as OpenFabStationProposalReviewOrganizationPolicy,
			});
		default:
			throw new TypeError("review session command is invalid");
	}
}

function captureIncludeDecision(value: unknown): OpenFabStationProposalIncludeDecision {
	const decision = captureEnumerableOwnDataRecord(value, "include decision");
	assertExactRecordKeys(decision, INCLUDE_DECISION_KEYS, "include decision");
	return Object.freeze({
		row: decision.row as number,
		disposition: decision.disposition as "INCLUDE",
		identityAction: decision.identityAction as "CREATE_NEW",
		portType: decision.portType as PortType,
		typeReview: decision.typeReview as OpenFabStationProposalIncludeDecision["typeReview"],
		attachmentReview:
			decision.attachmentReview as OpenFabStationProposalIncludeDecision["attachmentReview"],
		route: captureRoute(decision.route),
		stationMillimeters: decision.stationMillimeters as number,
		stationReview: decision.stationReview as OpenFabStationProposalIncludeDecision["stationReview"],
		side: decision.side as OpenFabStationProposalIncludeDecision["side"],
		lateralOffsetMillimeters: decision.lateralOffsetMillimeters as number,
		sideOffsetReview:
			decision.sideOffsetReview as OpenFabStationProposalIncludeDecision["sideOffsetReview"],
		direction: decision.direction as OpenFabStationProposalIncludeDecision["direction"],
		directionReview:
			decision.directionReview as OpenFabStationProposalIncludeDecision["directionReview"],
		sourcePositionReview:
			decision.sourcePositionReview as OpenFabStationProposalIncludeDecision["sourcePositionReview"],
	});
}

function captureRoute(value: unknown): PortRouteIdentity {
	const route = captureEnumerableOwnDataRecord(value, "include route");
	if (route.kind === "CARDINAL_CELL") {
		assertExactRecordKeys(route, CARDINAL_ROUTE_KEYS, "include route");
		return Object.freeze({
			kind: "CARDINAL_CELL",
			x: route.x as number,
			z: route.z as number,
			from: route.from as 0 | Direction,
			to: route.to as 0 | Direction,
		});
	}
	if (route.kind === "ADVANCED_SWITCH_SEGMENT") {
		assertExactRecordKeys(route, ADVANCED_ROUTE_KEYS, "include route");
		return Object.freeze({
			kind: "ADVANCED_SWITCH_SEGMENT",
			switchId: route.switchId as number,
			profileClass: route.profileClass as AdvancedSwitchProfileClass,
			role: route.role as AdvancedSwitchRouteRole,
			portIndex: route.portIndex as 0 | 1 | null,
			segmentOrdinal: route.segmentOrdinal as number,
		});
	}
	throw new TypeError("include route is invalid");
}

function captureMemberRows(value: unknown): readonly number[] {
	try {
		if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
			throw new TypeError();
		}
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
		if (
			lengthDescriptor === undefined ||
			!("value" in lengthDescriptor) ||
			lengthDescriptor.enumerable ||
			!Number.isSafeInteger(lengthDescriptor.value) ||
			lengthDescriptor.value < 0 ||
			lengthDescriptor.value > MAX_GROUP_MEMBER_INPUT_COUNT
		) {
			throw new TypeError();
		}
		const length = lengthDescriptor.value as number;
		const keys = Reflect.ownKeys(value);
		if (keys.length !== length + 1 || !keys.includes("length")) throw new TypeError();
		const members = new Array<number>(length);
		for (let index = 0; index < length; index += 1) {
			const key = String(index);
			if (!keys.includes(key)) throw new TypeError();
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError();
			members[index] = descriptor.value as number;
		}
		return Object.freeze(members);
	} catch {
		throw new TypeError("review group members are invalid");
	}
}

function captureEnumerableOwnDataRecord(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
		const keys = Reflect.ownKeys(value);
		if (keys.some((key) => typeof key !== "string")) throw new TypeError();
		const captured = Object.create(null) as Record<string, unknown>;
		for (const key of keys as string[]) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError();
			Object.defineProperty(captured, key, {
				value: descriptor.value,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze(captured);
	} catch {
		throw new TypeError(`${label} is invalid`);
	}
}

function assertExactRecordKeys(
	record: Readonly<Record<string, unknown>>,
	expectedKeys: readonly string[],
	label: string,
): void {
	const keys = Object.keys(record);
	if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))) {
		throw new TypeError(`${label} is invalid`);
	}
}

function dispatchCommand(
	state: SessionState,
	commandValue: OpenFabStationProposalReviewSessionCommand,
): OpenFabStationProposalReviewSessionSummary {
	if (state.revision >= Number.MAX_SAFE_INTEGER) {
		throw new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_REVISION_EXHAUSTED");
	}
	if (state.capturingCommand) throw new TypeError("review session command capture is reentrant");
	const revisionBeforeCapture = state.revision;
	let command: OpenFabStationProposalReviewSessionCommand;
	state.capturingCommand = true;
	try {
		command = captureCommand(commandValue);
	} finally {
		state.capturingCommand = false;
	}
	if (state.revision !== revisionBeforeCapture) {
		throw new TypeError("review session changed while capturing a command");
	}
	switch (command.type) {
		case "REJECT_ROW":
			rejectRow(state, command.row, command.reason);
			break;
		case "INCLUDE_ROW":
			includeRow(state, command.decision);
			break;
		case "CREATE_GROUP":
			createGroup(state, command.reviewGroupId, command.kind);
			break;
		case "DELETE_GROUP":
			deleteGroup(state, command.reviewGroupId);
			break;
		case "SET_GROUP_MEMBERS":
			setGroupMembers(state, command.reviewGroupId, command.memberRows);
			break;
		case "SET_GROUP_REVIEW":
			setGroupReview(state, command.reviewGroupId, command.groupingReview);
			break;
		case "SET_EQ_PITCH":
			setEqPitch(state, command.reviewGroupId, command.pitchMillimeters);
			break;
		case "SET_STK_TEMPLATE":
			setStkTemplate(state, command.reviewGroupId, command.template);
			break;
		case "SET_REJECTED_SOURCE_ROWS_POLICY":
			setRejectedSourceRowsPolicy(state, command.policy);
			break;
		case "SET_UNKNOWN_COLUMNS_POLICY":
			setUnknownColumnsPolicy(state, command.policy);
			break;
		case "SET_ORGANIZATION_POLICY":
			setOrganizationPolicy(state, command.policy);
			break;
		default:
			throw new TypeError("review session command is invalid");
	}
	state.revision += 1;
	const completedSummary = createSummary(state);
	state.summary = completedSummary;
	notifyListeners(state);
	return completedSummary;
}

function rejectRow(
	state: SessionState,
	row: number,
	reason: OpenFabStationProposalRejectReason,
): void {
	assertRow(state, row);
	const reasonCode = encode(REJECT_REASONS, reason, "reject reason");
	const previousDisposition = state.decisionDispositions[row] as number;
	if (previousDisposition === 0) state.decidedRowCount += 1;
	if (previousDisposition === 2) {
		state.includedRowCount -= 1;
		state.rejectedRowCount += 1;
	} else if (previousDisposition === 0) {
		state.rejectedRowCount += 1;
	}
	detachRowFromGroup(state, row);
	clearIncludeColumns(state, row);
	state.decisionDispositions[row] = 1;
	state.rejectReasons[row] = reasonCode;
}

function includeRow(state: SessionState, decision: OpenFabStationProposalIncludeDecision): void {
	const revisionBeforeValidation = state.revision;
	const captured = validateAndCopyIncludeDecision(state, decision);
	if (state.revision !== revisionBeforeValidation) {
		throw new TypeError("review session changed while validating an include decision");
	}
	const row = captured.row;
	const portTypeCode = encode(PORT_TYPES, captured.portType, "port type");
	const previousDisposition = state.decisionDispositions[row] as number;
	if (previousDisposition === 0) state.decidedRowCount += 1;
	if (previousDisposition === 1) {
		state.rejectedRowCount -= 1;
		state.includedRowCount += 1;
	} else if (previousDisposition === 0) {
		state.includedRowCount += 1;
	}
	const groupSlot = state.rowGroupSlots[row] as number;
	if (groupSlot >= 0) {
		if (state.groupKinds[groupSlot] !== portTypeCode) detachRowFromGroup(state, row);
		else clearGroupReview(state, groupSlot);
	}
	clearIncludeColumns(state, row);
	state.decisionDispositions[row] = 2;
	state.identityActions[row] = 1;
	state.portTypes[row] = portTypeCode;
	state.typeReviews[row] = encode(TYPE_REVIEWS, captured.typeReview, "type review");
	state.attachmentReviews[row] = 1;
	encodeRoute(state, row, captured.route);
	state.stationMillimeters[row] = captured.stationMillimeters;
	state.stationReviews[row] = encode(STATION_REVIEWS, captured.stationReview, "station review");
	state.sides[row] = encode(PORT_SIDES, captured.side, "port side");
	state.lateralOffsetMillimeters[row] = captured.lateralOffsetMillimeters;
	state.sideOffsetReviews[row] = encode(
		SIDE_OFFSET_REVIEWS,
		captured.sideOffsetReview,
		"side/offset review",
	);
	state.directions[row] = encode(PORT_DIRECTIONS, captured.direction, "port direction");
	state.directionReviews[row] = encode(
		DIRECTION_REVIEWS,
		captured.directionReview,
		"direction review",
	);
	state.sourcePositionReviews[row] = encode(
		SOURCE_POSITION_REVIEWS,
		captured.sourcePositionReview,
		"source position review",
	);
}

function validateAndCopyIncludeDecision(
	state: SessionState,
	decision: OpenFabStationProposalIncludeDecision,
): OpenFabStationProposalIncludeDecision {
	if (typeof decision !== "object" || decision === null || decision.disposition !== "INCLUDE") {
		throw new TypeError("include decision is invalid");
	}
	assertRow(state, decision.row);
	if (decision.identityAction !== "CREATE_NEW") throw new TypeError("identity action is invalid");
	if (!PORT_TYPES.includes(decision.portType)) throw new TypeError("port type is invalid");
	if (!TYPE_REVIEWS.includes(decision.typeReview)) throw new TypeError("type review is invalid");
	if (decision.attachmentReview !== "USER_SELECTED_EXACT_ROUTE") {
		throw new TypeError("attachment review is invalid");
	}
	const route = copyPortRouteIdentity(decision.route);
	if (
		!Number.isInteger(decision.stationMillimeters) ||
		decision.stationMillimeters < 0 ||
		decision.stationMillimeters > PORT_RECORD_MAX_STATION_MILLIMETERS
	) {
		throw new TypeError("station millimeters are invalid");
	}
	if (!STATION_REVIEWS.includes(decision.stationReview)) {
		throw new TypeError("station review is invalid");
	}
	if (!PORT_SIDES.includes(decision.side)) throw new TypeError("port side is invalid");
	if (
		!Number.isInteger(decision.lateralOffsetMillimeters) ||
		decision.lateralOffsetMillimeters < 0 ||
		decision.lateralOffsetMillimeters > PORT_RECORD_MAX_OFFSET_MILLIMETERS ||
		(decision.side === "CENTER" && decision.lateralOffsetMillimeters !== 0) ||
		(decision.side !== "CENTER" && decision.lateralOffsetMillimeters === 0)
	) {
		throw new TypeError("port side/offset is invalid");
	}
	if (!SIDE_OFFSET_REVIEWS.includes(decision.sideOffsetReview)) {
		throw new TypeError("side/offset review is invalid");
	}
	if (!PORT_DIRECTIONS.includes(decision.direction)) {
		throw new TypeError("port direction is invalid");
	}
	if (!DIRECTION_REVIEWS.includes(decision.directionReview)) {
		throw new TypeError("direction review is invalid");
	}
	if (!SOURCE_POSITION_REVIEWS.includes(decision.sourcePositionReview)) {
		throw new TypeError("source position review is invalid");
	}
	const proposal = state.readProposalRow(decision.row);
	validateConfirmationClaims(proposal, decision);
	return Object.freeze({ ...decision, route });
}

function validateConfirmationClaims(
	proposal: OpenFabStationProposalRow,
	decision: OpenFabStationProposalIncludeDecision,
): void {
	if (
		decision.typeReview === "CONFIRM_DECLARED" &&
		(proposal.portType === "UNRESOLVED" || proposal.portType !== decision.portType)
	) {
		throw new TypeError("declared port type confirmation does not match the proposal");
	}
	if (
		decision.stationReview === "CONFIRM_DECLARED" &&
		proposal.stationMillimeters !== decision.stationMillimeters
	) {
		throw new TypeError("declared station confirmation does not match the proposal");
	}
	if (
		decision.sideOffsetReview === "CONFIRM_DECLARED" &&
		(proposal.side === "UNRESOLVED" ||
			proposal.side !== decision.side ||
			proposal.lateralOffsetMillimeters !== decision.lateralOffsetMillimeters)
	) {
		throw new TypeError("declared side/offset confirmation does not match the proposal");
	}
	if (
		decision.directionReview === "CONFIRM_DECLARED" &&
		(proposal.directionEvidence !== "DECLARED" || proposal.direction !== decision.direction)
	) {
		throw new TypeError("declared direction confirmation does not match the proposal");
	}
	if (
		decision.directionReview === "CONFIRM_HEURISTIC" &&
		(proposal.directionEvidence !== "HEURISTIC" || proposal.direction !== decision.direction)
	) {
		throw new TypeError("heuristic direction confirmation does not match the proposal");
	}
	const hasSourcePosition =
		proposal.sourceXMillimeters !== null && proposal.sourceZMillimeters !== null;
	if (
		(hasSourcePosition && decision.sourcePositionReview === "NOT_PROVIDED") ||
		(!hasSourcePosition && decision.sourcePositionReview !== "NOT_PROVIDED")
	) {
		throw new TypeError("source position review does not match source presence");
	}
}

function createGroup(state: SessionState, reviewGroupId: number, kind: PortType): void {
	assertPositiveInt32(reviewGroupId, "review group id");
	if (!PORT_TYPES.includes(kind)) throw new TypeError("review group kind is invalid");
	if (state.groupSlotById.has(reviewGroupId)) throw new TypeError("review group id already exists");
	const slot = allocateGroupSlot(state);
	state.groupActive[slot] = 1;
	state.groupReviewIds[slot] = reviewGroupId;
	state.groupKinds[slot] = encode(PORT_TYPES, kind, "review group kind");
	state.groupFirstRows[slot] = -1;
	state.groupingReviews[slot] = 0;
	state.groupTemplates[slot] = kind === "OHB" ? 1 : 0;
	state.groupPitchMillimeters[slot] = 0;
	state.groupMemberCounts[slot] = 0;
	state.groupSlotById.set(reviewGroupId, slot);
	state.activeGroupSlots[state.activeGroupCount] = slot;
	state.groupActiveIndexes[slot] = state.activeGroupCount;
	state.activeGroupCount += 1;
	state.emptyGroupCount += 1;
	state.pendingGroupReviewCount += 1;
	if (kind !== "OHB") state.pendingGroupConfigurationCount += 1;
}

function deleteGroup(state: SessionState, reviewGroupId: number): void {
	const slot = requireGroupSlot(state, reviewGroupId);
	const activeIndex = state.groupActiveIndexes[slot] as number;
	const lastActiveIndex = state.activeGroupCount - 1;
	const lastActiveSlot = state.activeGroupSlots[lastActiveIndex] as number;
	if (activeIndex < 0 || lastActiveSlot < 0) {
		throw new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CORRUPT");
	}
	clearGroupMemberLinks(state, slot);
	state.membershipCount -= state.groupMemberCounts[slot] as number;
	if (state.groupMemberCounts[slot] === 0) state.emptyGroupCount -= 1;
	if (state.groupingReviews[slot] === 0) state.pendingGroupReviewCount -= 1;
	if (groupConfigurationPending(state, slot)) state.pendingGroupConfigurationCount -= 1;
	state.groupSlotById.delete(reviewGroupId);
	state.groupActive[slot] = 0;
	state.groupReviewIds[slot] = 0;
	state.groupKinds[slot] = 0;
	state.groupFirstRows[slot] = -1;
	state.groupingReviews[slot] = 0;
	state.groupTemplates[slot] = 0;
	state.groupPitchMillimeters[slot] = 0;
	state.groupMemberCounts[slot] = 0;
	state.activeGroupSlots[activeIndex] = lastActiveSlot;
	state.groupActiveIndexes[lastActiveSlot] = activeIndex;
	state.activeGroupSlots[lastActiveIndex] = -1;
	state.groupActiveIndexes[slot] = -1;
	state.freeGroupSlots.push(slot);
	state.activeGroupCount -= 1;
}

function setGroupMembers(
	state: SessionState,
	reviewGroupId: number,
	memberRows: readonly number[],
): void {
	const slot = requireGroupSlot(state, reviewGroupId);
	if (!Array.isArray(memberRows)) throw new TypeError("review group members are invalid");
	const maximum = maximumMemberCount(decode(PORT_TYPES, state.groupKinds[slot] as number));
	if (memberRows.length > maximum) throw new TypeError("review group member capacity exceeded");
	const members = new Set<number>();
	for (const row of memberRows) {
		assertRow(state, row);
		if (members.has(row)) throw new TypeError("review group member is duplicated");
		if (state.decisionDispositions[row] !== 2) {
			throw new TypeError("review group members must be included rows");
		}
		if (state.portTypes[row] !== state.groupKinds[slot]) {
			throw new TypeError("review group member kind does not match");
		}
		const existingSlot = state.rowGroupSlots[row] as number;
		if (existingSlot >= 0 && existingSlot !== slot) {
			throw new TypeError("review group member already belongs to another group");
		}
		members.add(row);
	}
	if (groupMembersEqual(state, slot, members)) return;
	const previousCount = state.groupMemberCounts[slot] as number;
	clearGroupMemberLinks(state, slot);
	const sortedMembers = [...members].sort((left, right) => left - right);
	let previousRow = -1;
	for (const row of sortedMembers) {
		state.rowGroupSlots[row] = slot;
		state.rowGroupNext[row] = -1;
		if (previousRow < 0) state.groupFirstRows[slot] = row;
		else state.rowGroupNext[previousRow] = row;
		previousRow = row;
	}
	state.groupMemberCounts[slot] = members.size;
	state.membershipCount += members.size - previousCount;
	if (previousCount === 0 && members.size > 0) state.emptyGroupCount -= 1;
	if (previousCount > 0 && members.size === 0) state.emptyGroupCount += 1;
	clearGroupReview(state, slot);
}

function setGroupReview(
	state: SessionState,
	reviewGroupId: number,
	groupingReview: OpenFabStationProposalReviewGroupingReview,
): void {
	const slot = requireGroupSlot(state, reviewGroupId);
	const code = encode(GROUPING_REVIEWS, groupingReview, "grouping review");
	if (state.groupingReviews[slot] === 0) state.pendingGroupReviewCount -= 1;
	state.groupingReviews[slot] = code;
}

function setEqPitch(state: SessionState, reviewGroupId: number, pitchMillimeters: number): void {
	const slot = requireGroupSlot(state, reviewGroupId);
	if (decode(PORT_TYPES, state.groupKinds[slot] as number) !== "EQ") {
		throw new TypeError("EQ pitch can only be set on an EQ group");
	}
	if (!EQ_PORT_PITCHES_MILLIMETERS.includes(pitchMillimeters)) {
		throw new TypeError("EQ pitch is invalid");
	}
	if (state.groupPitchMillimeters[slot] === 0) state.pendingGroupConfigurationCount -= 1;
	state.groupPitchMillimeters[slot] = pitchMillimeters;
}

function setStkTemplate(
	state: SessionState,
	reviewGroupId: number,
	template: StkAuthoringTemplate,
): void {
	const slot = requireGroupSlot(state, reviewGroupId);
	if (decode(PORT_TYPES, state.groupKinds[slot] as number) !== "STK") {
		throw new TypeError("STK template can only be set on an STK group");
	}
	if (!STK_AUTHORING_TEMPLATES.includes(template)) throw new TypeError("STK template is invalid");
	if (state.groupTemplates[slot] === 0) state.pendingGroupConfigurationCount -= 1;
	state.groupTemplates[slot] = encode(GROUP_TEMPLATES, template, "STK template");
}

function setRejectedSourceRowsPolicy(
	state: SessionState,
	policy: OpenFabStationProposalReviewRejectedSourceRowsPolicy,
): void {
	const expected = state.rejectedSourceRowCount === 0 ? "NOT_APPLICABLE" : "ACKNOWLEDGE_DISCARDED";
	if (policy !== expected)
		throw new TypeError("rejected source row policy does not match source facts");
	state.rejectedSourceRowsPolicy = policy;
}

function setUnknownColumnsPolicy(
	state: SessionState,
	policy: OpenFabStationProposalReviewUnknownColumnsPolicy,
): void {
	const expected = state.unknownColumnCount === 0 ? "NOT_APPLICABLE" : "ACKNOWLEDGE_IGNORED";
	if (policy !== expected) throw new TypeError("unknown column policy does not match source facts");
	state.unknownColumnsPolicy = policy;
}

function setOrganizationPolicy(
	state: SessionState,
	policy: OpenFabStationProposalReviewOrganizationPolicy,
): void {
	if (policy !== "EXPLICIT_UNASSIGNED") throw new TypeError("organization policy is invalid");
	state.organizationPolicy = policy;
}

function allocateGroupSlot(state: SessionState): number {
	const recycled = state.freeGroupSlots.pop();
	if (recycled !== undefined) return recycled;
	if (state.nextUnusedGroupSlot >= state.rowCount) {
		throw new TypeError("review group capacity exceeded");
	}
	const slot = state.nextUnusedGroupSlot;
	state.nextUnusedGroupSlot += 1;
	return slot;
}

function requireGroupSlot(state: SessionState, reviewGroupId: number): number {
	assertPositiveInt32(reviewGroupId, "review group id");
	const slot = state.groupSlotById.get(reviewGroupId);
	if (slot === undefined || state.groupActive[slot] !== 1) {
		throw new TypeError("review group does not exist");
	}
	return slot;
}

function groupMembersEqual(
	state: SessionState,
	slot: number,
	members: ReadonlySet<number>,
): boolean {
	if (state.groupMemberCounts[slot] !== members.size) return false;
	for (const row of members) {
		if (state.rowGroupSlots[row] !== slot) return false;
	}
	return true;
}

function detachRowFromGroup(state: SessionState, row: number): void {
	const slot = state.rowGroupSlots[row] as number;
	if (slot < 0) return;
	let current = state.groupFirstRows[slot] as number;
	let previous = -1;
	while (current >= 0 && current !== row) {
		previous = current;
		current = state.rowGroupNext[current] as number;
	}
	if (current !== row) throw new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CORRUPT");
	const next = state.rowGroupNext[row] as number;
	if (previous < 0) state.groupFirstRows[slot] = next;
	else state.rowGroupNext[previous] = next;
	state.rowGroupSlots[row] = -1;
	state.rowGroupNext[row] = -1;
	state.groupMemberCounts[slot] -= 1;
	state.membershipCount -= 1;
	if (state.groupMemberCounts[slot] === 0) state.emptyGroupCount += 1;
	clearGroupReview(state, slot);
}

function clearGroupMemberLinks(state: SessionState, slot: number): void {
	let row = state.groupFirstRows[slot] as number;
	let remaining = state.groupMemberCounts[slot] as number;
	while (row >= 0 && remaining > 0) {
		const next = state.rowGroupNext[row] as number;
		state.rowGroupSlots[row] = -1;
		state.rowGroupNext[row] = -1;
		row = next;
		remaining -= 1;
	}
	if (row >= 0 || remaining !== 0) {
		throw new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CORRUPT");
	}
	state.groupFirstRows[slot] = -1;
}

function clearGroupReview(state: SessionState, slot: number): void {
	if (state.groupingReviews[slot] === 0) return;
	state.groupingReviews[slot] = 0;
	state.pendingGroupReviewCount += 1;
}

function groupConfigurationPending(state: SessionState, slot: number): boolean {
	const kind = decode(PORT_TYPES, state.groupKinds[slot] as number);
	return kind === "EQ"
		? state.groupPitchMillimeters[slot] === 0
		: kind === "STK" && state.groupTemplates[slot] === 0;
}

function maximumMemberCount(kind: PortType): number {
	if (kind === "OHB") return 1;
	if (kind === "EQ") return EQ_MAXIMUM_PORT_COUNT;
	return STK_MAXIMUM_PORT_COUNT;
}

function clearIncludeColumns(state: SessionState, row: number): void {
	state.rejectReasons[row] = 0;
	state.identityActions[row] = 0;
	state.portTypes[row] = 0;
	state.typeReviews[row] = 0;
	state.attachmentReviews[row] = 0;
	state.routeKinds[row] = 0;
	state.routeXs[row] = 0;
	state.routeZs[row] = 0;
	state.routeFromDirections[row] = 0;
	state.routeToDirections[row] = 0;
	state.routeSwitchIds[row] = 0;
	state.routeProfileClasses[row] = 0;
	state.routeRoles[row] = 0;
	state.routePortIndices[row] = 0;
	state.routeSegmentOrdinals[row] = 0;
	state.stationMillimeters[row] = 0;
	state.stationReviews[row] = 0;
	state.sides[row] = 0;
	state.lateralOffsetMillimeters[row] = 0;
	state.sideOffsetReviews[row] = 0;
	state.directions[row] = 0;
	state.directionReviews[row] = 0;
	state.sourcePositionReviews[row] = 0;
}

function encodeRoute(state: SessionState, row: number, route: PortRouteIdentity): void {
	if (route.kind === "CARDINAL_CELL") {
		state.routeKinds[row] = 1;
		state.routeXs[row] = route.x;
		state.routeZs[row] = route.z;
		state.routeFromDirections[row] = route.from;
		state.routeToDirections[row] = route.to;
		return;
	}
	state.routeKinds[row] = 2;
	state.routeSwitchIds[row] = route.switchId;
	state.routeProfileClasses[row] = encode(
		ADVANCED_SWITCH_PROFILE_CLASSES,
		route.profileClass,
		"advanced switch profile",
	);
	state.routeRoles[row] = encode(ADVANCED_SWITCH_ROUTE_ROLES, route.role, "advanced switch role");
	state.routePortIndices[row] = route.portIndex === null ? -1 : route.portIndex;
	state.routeSegmentOrdinals[row] = route.segmentOrdinal;
}

function decodeDecision(
	state: SessionState,
	row: number,
): OpenFabStationProposalRowDecision | null {
	const disposition = state.decisionDispositions[row] as number;
	if (disposition === 0) return null;
	if (disposition === 1) {
		return Object.freeze({
			row,
			disposition: "REJECT",
			reason: decode(REJECT_REASONS, state.rejectReasons[row] as number),
		});
	}
	return Object.freeze({
		row,
		disposition: "INCLUDE",
		identityAction: "CREATE_NEW",
		portType: decode(PORT_TYPES, state.portTypes[row] as number),
		typeReview: decode(TYPE_REVIEWS, state.typeReviews[row] as number),
		attachmentReview: "USER_SELECTED_EXACT_ROUTE",
		route: decodeRoute(state, row),
		stationMillimeters: state.stationMillimeters[row] as number,
		stationReview: decode(STATION_REVIEWS, state.stationReviews[row] as number),
		side: decode(PORT_SIDES, state.sides[row] as number),
		lateralOffsetMillimeters: state.lateralOffsetMillimeters[row] as number,
		sideOffsetReview: decode(SIDE_OFFSET_REVIEWS, state.sideOffsetReviews[row] as number),
		direction: decode(PORT_DIRECTIONS, state.directions[row] as number),
		directionReview: decode(DIRECTION_REVIEWS, state.directionReviews[row] as number),
		sourcePositionReview: decode(
			SOURCE_POSITION_REVIEWS,
			state.sourcePositionReviews[row] as number,
		),
	});
}

function decodeRoute(state: SessionState, row: number): PortRouteIdentity {
	if (state.routeKinds[row] === 1) {
		return Object.freeze({
			kind: "CARDINAL_CELL",
			x: state.routeXs[row] as number,
			z: state.routeZs[row] as number,
			from: state.routeFromDirections[row] as 0 | 1 | 2 | 4 | 8,
			to: state.routeToDirections[row] as 0 | 1 | 2 | 4 | 8,
		});
	}
	return Object.freeze({
		kind: "ADVANCED_SWITCH_SEGMENT",
		switchId: state.routeSwitchIds[row] as number,
		profileClass: decode(ADVANCED_SWITCH_PROFILE_CLASSES, state.routeProfileClasses[row] as number),
		role: decode(ADVANCED_SWITCH_ROUTE_ROLES, state.routeRoles[row] as number),
		portIndex: state.routePortIndices[row] === -1 ? null : (state.routePortIndices[row] as 0 | 1),
		segmentOrdinal: state.routeSegmentOrdinals[row] as number,
	});
}

function decodeGroup(state: SessionState, slot: number): OpenFabStationProposalReviewSessionGroup {
	const kind = decode(PORT_TYPES, state.groupKinds[slot] as number);
	return Object.freeze({
		reviewGroupId: state.groupReviewIds[slot] as number,
		kind,
		groupingReview:
			state.groupingReviews[slot] === 0
				? null
				: decode(GROUPING_REVIEWS, state.groupingReviews[slot] as number),
		template:
			kind === "EQ" || state.groupTemplates[slot] === 0
				? null
				: decode(GROUP_TEMPLATES, state.groupTemplates[slot] as number),
		pitchMillimeters:
			kind === "EQ" && state.groupPitchMillimeters[slot] !== 0
				? (state.groupPitchMillimeters[slot] as number)
				: null,
		memberCount: state.groupMemberCounts[slot] as number,
	});
}

async function captureDraftSnapshotCooperatively(
	state: SessionState,
	optionsValue: OpenFabStationProposalReviewSessionCaptureOptions,
): Promise<OpenFabStationProposalReviewDraftSnapshot> {
	const startingSessionRevision = state.revision;
	const startingCaptureReady = state.summary.captureReady;
	if (!startingCaptureReady) {
		throw new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CAPTURE_NOT_READY");
	}
	const guard = createSessionCaptureGuard(state, optionsValue, startingSessionRevision);
	const source = await captureDraftSourceCooperatively(state, guard);
	guard.assertFresh();
	let snapshot: OpenFabStationProposalReviewDraftSnapshot;
	try {
		snapshot = await sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(source, {
			checkpoint: guard.options.checkpoint,
			revision: guard.sealerRevision,
			signal: guard.options.signal,
			now: guard.options.now,
			sliceMilliseconds: guard.options.sliceMilliseconds,
		});
	} catch (error) {
		guard.assertFresh();
		throw error;
	}
	try {
		guard.assertFresh();
	} catch (error) {
		revokeEncodedOpenFabStationProposalReviewDraftSnapshot(snapshot);
		throw error;
	}
	return snapshot;
}

async function captureDraftSourceCooperatively(
	state: SessionState,
	guard: SessionCaptureGuard,
): Promise<OpenFabStationProposalReviewDraftSnapshotSource> {
	const scheduler = createCaptureScheduler(guard);
	await scheduler.checkpointNow();
	const columns = allocateCompactColumns(
		state.decidedRowCount,
		state.activeGroupCount,
		state.membershipCount,
	);
	let decisionIndex = 0;
	for (let row = 0; row < state.rowCount; row += 1) {
		if (state.decisionDispositions[row] !== 0) {
			copyDecisionRow(state, row, columns, decisionIndex);
			decisionIndex += 1;
		}
		const checkpoint = scheduler.step();
		if (checkpoint !== null) await checkpoint;
	}
	if (decisionIndex !== state.decidedRowCount) throw staleCaptureError();

	const groupIndexBySlot = new Int32Array(state.nextUnusedGroupSlot);
	groupIndexBySlot.fill(-1);
	for (let groupIndex = 0; groupIndex < state.activeGroupCount; groupIndex += 1) {
		const slot = state.activeGroupSlots[groupIndex] as number;
		if (slot < 0 || state.groupActive[slot] !== 1) throw staleCaptureError();
		groupIndexBySlot[slot] = groupIndex;
		copyGroupRow(state, slot, columns, groupIndex);
		columns.groupMemberOffsets[groupIndex + 1] = state.groupMemberCounts[slot] as number;
		const checkpoint = scheduler.step();
		if (checkpoint !== null) await checkpoint;
	}
	for (let index = 0; index < state.activeGroupCount; index += 1) {
		columns.groupMemberOffsets[index + 1] += columns.groupMemberOffsets[index] as number;
		const checkpoint = scheduler.step();
		if (checkpoint !== null) await checkpoint;
	}
	const memberCursors = columns.groupMemberOffsets.slice(0, state.activeGroupCount);
	let membershipCount = 0;
	for (let row = 0; row < state.rowCount; row += 1) {
		const slot = state.rowGroupSlots[row] as number;
		if (slot >= 0) {
			const compactGroupIndex = groupIndexBySlot[slot] as number;
			if (compactGroupIndex < 0) throw staleCaptureError();
			const cursor = memberCursors[compactGroupIndex] as number;
			columns.groupMemberRows[cursor] = row;
			memberCursors[compactGroupIndex] = cursor + 1;
			membershipCount += 1;
		}
		const checkpoint = scheduler.step();
		if (checkpoint !== null) await checkpoint;
	}
	if (membershipCount !== state.membershipCount) throw staleCaptureError();

	const source = Object.freeze({
		proposalRowCount: state.rowCount,
		decisionCount: state.decidedRowCount,
		groupCount: state.activeGroupCount,
		membershipCount: state.membershipCount,
		rejectedSourceRowsPolicyCode: encode(
			["NOT_APPLICABLE", "ACKNOWLEDGE_DISCARDED"] as const,
			state.rejectedSourceRowsPolicy,
			"rejected source row policy",
		),
		unknownColumnsPolicyCode: encode(
			["NOT_APPLICABLE", "ACKNOWLEDGE_IGNORED"] as const,
			state.unknownColumnsPolicy,
			"unknown column policy",
		),
		organizationPolicyCode: encode(
			["EXPLICIT_UNASSIGNED"] as const,
			state.organizationPolicy,
			"organization policy",
		),
		...columns,
	}) satisfies OpenFabStationProposalReviewDraftSnapshotSource;
	await scheduler.checkpointNow();
	return source;
}

function allocateCompactColumns(
	decisionCount: number,
	groupCount: number,
	membershipCount: number,
): CompactColumns {
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

function copyDecisionRow(
	state: SessionState,
	row: number,
	columns: CompactColumns,
	index: number,
): void {
	columns.decisionRows[index] = row;
	columns.decisionDispositions[index] = state.decisionDispositions[row] as number;
	columns.rejectReasons[index] = state.rejectReasons[row] as number;
	columns.identityActions[index] = state.identityActions[row] as number;
	columns.portTypes[index] = state.portTypes[row] as number;
	columns.typeReviews[index] = state.typeReviews[row] as number;
	columns.attachmentReviews[index] = state.attachmentReviews[row] as number;
	columns.routeKinds[index] = state.routeKinds[row] as number;
	columns.routeXs[index] = state.routeXs[row] as number;
	columns.routeZs[index] = state.routeZs[row] as number;
	columns.routeFromDirections[index] = state.routeFromDirections[row] as number;
	columns.routeToDirections[index] = state.routeToDirections[row] as number;
	columns.routeSwitchIds[index] = state.routeSwitchIds[row] as number;
	columns.routeProfileClasses[index] = state.routeProfileClasses[row] as number;
	columns.routeRoles[index] = state.routeRoles[row] as number;
	columns.routePortIndices[index] = state.routePortIndices[row] as number;
	columns.routeSegmentOrdinals[index] = state.routeSegmentOrdinals[row] as number;
	columns.stationMillimeters[index] = state.stationMillimeters[row] as number;
	columns.stationReviews[index] = state.stationReviews[row] as number;
	columns.sides[index] = state.sides[row] as number;
	columns.lateralOffsetMillimeters[index] = state.lateralOffsetMillimeters[row] as number;
	columns.sideOffsetReviews[index] = state.sideOffsetReviews[row] as number;
	columns.directions[index] = state.directions[row] as number;
	columns.directionReviews[index] = state.directionReviews[row] as number;
	columns.sourcePositionReviews[index] = state.sourcePositionReviews[row] as number;
}

function copyGroupRow(
	state: SessionState,
	slot: number,
	columns: CompactColumns,
	index: number,
): void {
	columns.groupReviewIds[index] = state.groupReviewIds[slot] as number;
	columns.groupKinds[index] = state.groupKinds[slot] as number;
	columns.groupingReviews[index] = state.groupingReviews[slot] as number;
	columns.groupTemplates[index] = state.groupTemplates[slot] as number;
	columns.groupPitchMillimeters[index] = state.groupPitchMillimeters[slot] as number;
}

function createCaptureScheduler(guard: SessionCaptureGuard): {
	readonly step: () => Promise<void> | null;
	readonly checkpointNow: () => Promise<void>;
} {
	let operationCount = 0;
	const now = guard.options.now ?? (() => performance.now());
	const sliceMilliseconds = guard.options.sliceMilliseconds ?? DEFAULT_CAPTURE_SLICE_MILLISECONDS;
	let sliceStartedAt = readCaptureTime(now, guard);
	const checkpointNow = async (): Promise<void> => {
		guard.assertFresh();
		await guard.options.checkpoint();
		guard.assertFresh();
		operationCount = 0;
		sliceStartedAt = readCaptureTime(now, guard);
	};
	return Object.freeze({
		step(): Promise<void> | null {
			operationCount += 1;
			if (operationCount >= guard.options.operationsPerCheckpoint) return checkpointNow();
			if (operationCount % CAPTURE_TIME_CHECK_OPERATIONS !== 0) return null;
			const current = readCaptureTime(now, guard);
			if (current < sliceStartedAt) {
				throw new TypeError("review session capture clock is invalid");
			}
			return current - sliceStartedAt >= sliceMilliseconds ? checkpointNow() : null;
		},
		checkpointNow,
	});
}

function readCaptureTime(now: () => number, guard: SessionCaptureGuard): number {
	guard.assertFresh();
	let value: number;
	try {
		value = Reflect.apply(now, undefined, []);
	} catch {
		guard.assertFresh();
		throw new TypeError("review session capture clock is invalid");
	}
	guard.assertFresh();
	if (!Number.isFinite(value)) {
		throw new TypeError("review session capture clock is invalid");
	}
	return value;
}

function createSessionCaptureGuard(
	state: SessionState,
	optionsValue: OpenFabStationProposalReviewSessionCaptureOptions,
	expectedSessionRevision: number,
): SessionCaptureGuard {
	let options: CapturedSessionCaptureOptions;
	try {
		options = captureSessionCaptureOptions(optionsValue);
	} catch (error) {
		if (state.revision !== expectedSessionRevision || !state.summary.captureReady) {
			throw staleCaptureError();
		}
		throw error;
	}
	if (state.revision !== expectedSessionRevision || !state.summary.captureReady) {
		throw staleCaptureError();
	}
	let expectedCallerRevision: number;
	try {
		expectedCallerRevision = options.revision();
	} catch {
		if (state.revision !== expectedSessionRevision || !state.summary.captureReady) {
			throw staleCaptureError();
		}
		throw new TypeError("review session capture revision is invalid");
	}
	if (!Number.isSafeInteger(expectedCallerRevision) || expectedCallerRevision <= 0) {
		throw new TypeError("review session capture revision must be positive");
	}
	const revisionsMatch = (): boolean => {
		let callerRevision: number;
		try {
			callerRevision = options.revision();
		} catch {
			return false;
		}
		return (
			state.revision === expectedSessionRevision &&
			state.summary.captureReady &&
			Number.isSafeInteger(callerRevision) &&
			callerRevision === expectedCallerRevision
		);
	};
	const assertFresh = (): void => {
		if (captureSignalAborted(options.signal)) throw abortedCaptureError();
		if (!revisionsMatch()) throw staleCaptureError();
	};
	const guard = Object.freeze({
		options,
		assertFresh,
		sealerRevision(): number {
			return !captureSignalAborted(options.signal) && revisionsMatch() ? 1 : 2;
		},
	});
	guard.assertFresh();
	return guard;
}

function captureSessionCaptureOptions(value: unknown): CapturedSessionCaptureOptions {
	const record = captureEnumerableOwnDataRecord(
		value,
		"review session cooperative capture options",
	);
	const keys = Object.keys(record);
	if (
		keys.some(
			(key) => !CAPTURE_OPTION_KEYS.includes(key as (typeof CAPTURE_OPTION_KEYS)[number]),
		) ||
		!keys.includes("checkpoint") ||
		!keys.includes("revision") ||
		typeof record.checkpoint !== "function" ||
		typeof record.revision !== "function" ||
		(record.now !== undefined && typeof record.now !== "function")
	) {
		throw new TypeError("review session cooperative capture options are invalid");
	}
	const operationsPerCheckpoint =
		(record.operationsPerCheckpoint as number | undefined) ?? DEFAULT_OPERATIONS_PER_CHECKPOINT;
	if (
		!Number.isInteger(operationsPerCheckpoint) ||
		operationsPerCheckpoint <= 0 ||
		operationsPerCheckpoint > MAX_OPERATIONS_PER_CHECKPOINT
	) {
		throw new TypeError("review session checkpoint interval is invalid");
	}
	const sliceMilliseconds = record.sliceMilliseconds as number | undefined;
	if (
		sliceMilliseconds !== undefined &&
		(!Number.isFinite(sliceMilliseconds) || sliceMilliseconds <= 0 || sliceMilliseconds > 4)
	) {
		throw new TypeError("review session capture slice is invalid");
	}
	const signal = record.signal as AbortSignal | undefined;
	if (signal !== undefined) captureSignalAborted(signal);
	return Object.freeze({
		checkpoint: record.checkpoint as () => Promise<void>,
		revision: record.revision as () => number,
		signal,
		operationsPerCheckpoint,
		now: record.now as (() => number) | undefined,
		sliceMilliseconds,
	});
}

function captureSignalAborted(signal: AbortSignal | undefined): boolean {
	if (signal === undefined) return false;
	if (ABORT_SIGNAL_ABORTED_GETTER === undefined) {
		throw new TypeError("review session capture signal is invalid");
	}
	try {
		return Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) === true;
	} catch {
		throw new TypeError("review session capture signal is invalid");
	}
}

function staleCaptureError(): Error {
	const error = new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CAPTURE_STALE");
	error.name = "AbortError";
	return error;
}

function abortedCaptureError(): Error {
	const error = new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CAPTURE_ABORTED");
	error.name = "AbortError";
	return error;
}

function createSummary(state: SessionState): OpenFabStationProposalReviewSessionSummary {
	const policiesComplete =
		state.rejectedSourceRowsPolicy !== null &&
		state.unknownColumnsPolicy !== null &&
		state.organizationPolicy !== null;
	return Object.freeze({
		revision: state.revision,
		proposalRowCount: state.rowCount,
		decidedRowCount: state.decidedRowCount,
		includedRowCount: state.includedRowCount,
		rejectedRowCount: state.rejectedRowCount,
		activeGroupCount: state.activeGroupCount,
		emptyGroupCount: state.emptyGroupCount,
		membershipCount: state.membershipCount,
		ungroupedIncludedRowCount: state.includedRowCount - state.membershipCount,
		pendingGroupReviewCount: state.pendingGroupReviewCount,
		pendingGroupConfigurationCount: state.pendingGroupConfigurationCount,
		rejectedSourceRowsPolicy: state.rejectedSourceRowsPolicy,
		unknownColumnsPolicy: state.unknownColumnsPolicy,
		organizationPolicy: state.organizationPolicy,
		captureReady:
			policiesComplete &&
			state.decidedRowCount === state.rowCount &&
			state.membershipCount === state.includedRowCount &&
			state.emptyGroupCount === 0 &&
			state.pendingGroupReviewCount === 0 &&
			state.pendingGroupConfigurationCount === 0,
	});
}

function notifyListeners(state: SessionState): void {
	for (const listener of [...state.listeners]) {
		try {
			listener();
		} catch {
			// A subscriber cannot roll back or interrupt a completed domain mutation.
		}
	}
}

function assertRow(state: SessionState, row: number): void {
	if (!Number.isInteger(row) || row < 0 || row >= state.rowCount) {
		throw new RangeError("review row is outside the proposal");
	}
}

function assertPositiveInt32(value: number, label: string): void {
	if (!Number.isInteger(value) || value <= 0 || value > MAX_INT32) {
		throw new TypeError(`${label} must be a positive signed int32`);
	}
}

function encode<const Values extends readonly unknown[]>(
	values: Values,
	value: unknown,
	label: string,
): number {
	const index = values.indexOf(value);
	if (index < 0) throw new TypeError(`${label} is invalid`);
	return index + 1;
}

function decode<const Values extends readonly unknown[]>(
	values: Values,
	code: number,
): Values[number] {
	const value = values[code - 1];
	if (value === undefined) throw new Error("OPENFAB_STATION_PROPOSAL_REVIEW_SESSION_CORRUPT");
	return value;
}
