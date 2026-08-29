import {
	applyPortEquipmentMutations,
	copyEquipmentGroupRecord,
	type EquipmentGroupRecord,
	equipmentGroupError,
	type PortEquipmentState,
	STK_AUTHORING_TEMPLATES,
	type StkAuthoringTemplate,
} from "../core/EquipmentGroup";
import {
	canonicalEquipmentGroupPortIds,
	equipmentGroupPortBarcode,
} from "../core/EquipmentGroupPortOrder";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { issuePortEquipmentBatchPlan } from "../core/PortEquipmentBatchPlanCertification";
import { allocatePortEquipmentRecordIds } from "../core/PortEquipmentIdAllocator";
import { portEquipmentLayoutError } from "../core/PortEquipmentLayoutValidator";
import {
	createInvalidPortEquipmentMutationPlan,
	createPortEquipmentMutationPlanWithImmutableGraphCertificate,
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
	type PortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import {
	copyPortRecord,
	PORT_DIRECTIONS,
	PORT_RECORD_MAX_OFFSET_MILLIMETERS,
	PORT_RECORD_MAX_STATION_MILLIMETERS,
	PORT_SIDES,
	PORT_TYPES,
	type PortDirection,
	type PortRecord,
	type PortRouteIdentity,
	type PortSide,
	type PortType,
} from "../core/PortRecord";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import {
	type HydratedOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE,
	OPENFAB_STATION_PROPOSAL_DIRECTIONS,
	OPENFAB_STATION_PROPOSAL_MAX_ROWS,
	OPENFAB_STATION_PROPOSAL_PORT_TYPES,
	OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
	OPENFAB_STATION_PROPOSAL_SIDES,
	type OpenFabStationProposalRow,
} from "./OpenFabStationProposalArtifact";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	createPortAttachmentSourceIndex,
	resolvePortAttachmentWithSourceIndex,
} from "./PortAttachmentResolver";

export const OPENFAB_STATION_PROPOSAL_REVIEW_VERSION = 1 as const;
export const OPENFAB_STATION_PROPOSAL_SOURCE_POSITION_TOLERANCE_MILLIMETERS = 1;

export const OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES = Object.freeze([
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
] as const);

export type OpenFabStationProposalReviewIssueCode =
	(typeof OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES)[number];

/** Issue emission locality is part of the V1 review contract, not presentation metadata. */
export const OPENFAB_STATION_PROPOSAL_REVIEW_GLOBAL_ONLY_ISSUE_CODES = Object.freeze([
	"INVALID_SOURCE",
	"INVALID_DRAFT",
	"PROPOSAL_REJECTIONS_UNACKNOWLEDGED",
	"UNKNOWN_COLUMNS_UNACKNOWLEDGED",
	"ORGANIZATION_POLICY_UNRESOLVED",
	"ROW_DECISION_OUT_OF_RANGE",
	"ID_ALLOCATION_EXHAUSTED",
	"PROSPECTIVE_LAYOUT_INVALID",
] as const satisfies readonly OpenFabStationProposalReviewIssueCode[]);
export const OPENFAB_STATION_PROPOSAL_REVIEW_ROW_ISSUE_CODES = Object.freeze([
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
] as const satisfies readonly OpenFabStationProposalReviewIssueCode[]);
export const OPENFAB_STATION_PROPOSAL_REVIEW_GROUP_ISSUE_CODES = Object.freeze([
	"GROUP_DECISION_INVALID",
	"GROUP_ID_DUPLICATE",
	"GROUP_MEMBER_OUT_OF_RANGE",
	"GROUP_MEMBER_DUPLICATE",
	"GROUP_MEMBER_REJECTED",
	"GROUP_KIND_MISMATCH",
	"GROUPING_REVIEW_INVALID",
	"EQUIPMENT_GROUP_INVALID",
] as const satisfies readonly OpenFabStationProposalReviewIssueCode[]);

export type OpenFabStationProposalReviewGlobalOnlyIssueCode =
	(typeof OPENFAB_STATION_PROPOSAL_REVIEW_GLOBAL_ONLY_ISSUE_CODES)[number];
export type OpenFabStationProposalReviewRowIssueCode =
	(typeof OPENFAB_STATION_PROPOSAL_REVIEW_ROW_ISSUE_CODES)[number];
export type OpenFabStationProposalReviewGroupIssueCode =
	(typeof OPENFAB_STATION_PROPOSAL_REVIEW_GROUP_ISSUE_CODES)[number];

export type OpenFabStationProposalReviewState = "BLOCKED" | "NO_CHANGES" | "READY";
export type OpenFabStationProposalRejectReason = "USER_EXCLUDED" | "UNRESOLVED" | "UNSUPPORTED";

export interface OpenFabStationProposalReviewSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly patchSequence: number;
}

export interface OpenFabStationProposalRejectDecision {
	readonly row: number;
	readonly disposition: "REJECT";
	readonly reason: OpenFabStationProposalRejectReason;
}

export interface OpenFabStationProposalIncludeDecision {
	readonly row: number;
	readonly disposition: "INCLUDE";
	readonly identityAction: "CREATE_NEW";
	readonly portType: PortType;
	readonly typeReview: "CONFIRM_DECLARED" | "OVERRIDE";
	readonly attachmentReview: "USER_SELECTED_EXACT_ROUTE";
	readonly route: PortRouteIdentity;
	readonly stationMillimeters: number;
	readonly stationReview: "CONFIRM_DECLARED" | "OVERRIDE";
	readonly side: PortSide;
	readonly lateralOffsetMillimeters: number;
	readonly sideOffsetReview: "CONFIRM_DECLARED" | "OVERRIDE";
	readonly direction: PortDirection;
	readonly directionReview: "CONFIRM_DECLARED" | "CONFIRM_HEURISTIC" | "OVERRIDE";
	readonly sourcePositionReview: "NOT_PROVIDED" | "CONFIRM_MATCH" | "ACKNOWLEDGE_MISMATCH";
}

export type OpenFabStationProposalRowDecision =
	| OpenFabStationProposalRejectDecision
	| OpenFabStationProposalIncludeDecision;

interface OpenFabStationProposalGroupDecisionBase {
	readonly reviewGroupId: number;
	readonly memberRows: readonly number[];
	readonly groupingReview: "CONFIRM_DECLARED" | "OVERRIDE";
}

export interface OpenFabStationProposalOhbGroupDecision
	extends OpenFabStationProposalGroupDecisionBase {
	readonly kind: "OHB";
	readonly template: "SINGLE";
}

export interface OpenFabStationProposalEqGroupDecision
	extends OpenFabStationProposalGroupDecisionBase {
	readonly kind: "EQ";
	readonly pitchMillimeters: number;
	/** V1 does not adopt external process metadata. */
	readonly recipe: null;
}

export interface OpenFabStationProposalStkGroupDecision
	extends OpenFabStationProposalGroupDecisionBase {
	readonly kind: "STK";
	readonly template: StkAuthoringTemplate;
}

export type OpenFabStationProposalGroupDecision =
	| OpenFabStationProposalOhbGroupDecision
	| OpenFabStationProposalEqGroupDecision
	| OpenFabStationProposalStkGroupDecision;

export interface OpenFabStationProposalReviewDraft {
	readonly rowDecisions: readonly OpenFabStationProposalRowDecision[];
	readonly groupDecisions: readonly OpenFabStationProposalGroupDecision[];
	readonly rejectedSourceRowsPolicy: "NOT_APPLICABLE" | "ACKNOWLEDGE_DISCARDED";
	readonly unknownColumnsPolicy: "NOT_APPLICABLE" | "ACKNOWLEDGE_IGNORED";
	readonly organizationPolicy: "EXPLICIT_UNASSIGNED";
}

export interface OpenFabStationProposalReviewEvaluation {
	readonly kind: "openfab-station-proposal-review-evaluation";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEW_VERSION;
	readonly state: OpenFabStationProposalReviewState;
	readonly proposalRowCount: number;
	readonly groupDecisionCount: number;
	readonly includedPortCount: number;
	readonly rejectedPortCount: number;
	readonly equipmentGroupCount: number;
	readonly reviewFingerprint: string | null;
	issueCount(code: OpenFabStationProposalReviewIssueCode): number;
	rowIssueMask(row: number): number;
	groupIssueMask(group: number): number;
}

/** Opaque, session-only evidence of one explicit user finalization. */
export interface ReviewedOpenFabStationProposal {
	readonly kind: "reviewed-openfab-station-proposal";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEW_VERSION;
	readonly proposalRowCount: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly rejectedPortCount: number;
	readonly reviewFingerprint: string;
}

interface PendingPortDecision {
	readonly row: number;
	readonly route: PortRouteIdentity;
	readonly stationMillimeters: number;
	readonly side: PortSide;
	readonly lateralOffsetMillimeters: number;
	readonly direction: PortDirection;
	readonly portType: PortType;
	readonly identityAction: OpenFabStationProposalIncludeDecision["identityAction"];
	readonly typeReview: OpenFabStationProposalIncludeDecision["typeReview"];
	readonly stationReview: OpenFabStationProposalIncludeDecision["stationReview"];
	readonly sideOffsetReview: OpenFabStationProposalIncludeDecision["sideOffsetReview"];
	readonly directionReview: OpenFabStationProposalIncludeDecision["directionReview"];
	readonly sourcePositionReview: OpenFabStationProposalIncludeDecision["sourcePositionReview"];
	readonly declaredGroupScope: string;
	readonly declaredGroupKey: string;
	readonly declaredGroupKind: OpenFabStationProposalRow["physicalGroupKind"];
}

type NormalizedPortDecision = Omit<
	PendingPortDecision,
	"declaredGroupScope" | "declaredGroupKey" | "declaredGroupKind"
>;

type NormalizedGroupDecision =
	| Readonly<{
			kind: "OHB";
			template: "SINGLE";
			groupingReview: "CONFIRM_DECLARED" | "OVERRIDE";
			ports: readonly NormalizedPortDecision[];
	  }>
	| Readonly<{
			kind: "EQ";
			pitchMillimeters: number;
			recipe: null;
			groupingReview: "CONFIRM_DECLARED" | "OVERRIDE";
			ports: readonly NormalizedPortDecision[];
	  }>
	| Readonly<{
			kind: "STK";
			template: StkAuthoringTemplate;
			groupingReview: "CONFIRM_DECLARED" | "OVERRIDE";
			ports: readonly NormalizedPortDecision[];
	  }>;

interface NormalizedReview {
	readonly groups: readonly NormalizedGroupDecision[];
	readonly rejected: readonly Readonly<{
		row: number;
		reason: OpenFabStationProposalRejectReason;
	}>[];
}

interface ReadyReviewSource {
	readonly source: OpenFabStationProposalReviewSource;
	readonly sourceMap: TileMap;
	readonly sourcePortEquipment: PortEquipmentState;
	readonly sourceOrganizations: StaticFabOrganizationState;
	readonly sourceChecksum: string;
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly plan: PortEquipmentMutationPlan;
	readonly reviewFingerprint: string;
}

interface ReviewArtifactSnapshot {
	readonly rowCount: number;
	readonly rejectedRowCount: number;
	readonly unknownColumnCount: number;
	readonly semanticFingerprint: string;
	readRow(row: number): OpenFabStationProposalRow;
}

interface ReviewSourceSnapshot {
	readonly original: OpenFabStationProposalReviewSource;
	readonly stable: OpenFabStationProposalReviewSource;
	readonly revision: number;
}

interface ParsedGroupDecision {
	readonly inputIndex: number;
	readonly reviewGroupId: number;
	readonly kind: PortType;
	readonly groupingReview: "CONFIRM_DECLARED" | "OVERRIDE";
	readonly memberRows: readonly number[];
	readonly template?: "SINGLE" | StkAuthoringTemplate;
	readonly pitchMillimeters?: number;
	readonly recipe?: null;
}

interface ReviewIssueCollector {
	readonly issueCounts: Uint32Array;
	readonly rowMasks: Uint32Array;
	readonly groupMasks: Uint32Array;
	addGlobal(code: OpenFabStationProposalReviewGlobalOnlyIssueCode): void;
	addRow(row: number, code: OpenFabStationProposalReviewRowIssueCode): void;
	addGroup(group: number, code: OpenFabStationProposalReviewGroupIssueCode): void;
	hasIssues(): boolean;
}

interface CapturedReviewDraft {
	readonly valid: boolean;
	readonly suppliedRowCount: number;
	readonly suppliedGroupCount: number;
	readonly rowDecisions: readonly unknown[];
	readonly groupDecisions: readonly OpenFabStationProposalGroupDecision[];
	readonly rejectedSourceRowsPolicy: unknown;
	readonly unknownColumnsPolicy: unknown;
	readonly organizationPolicy: unknown;
}

interface CapturedArrayPrefix {
	readonly valid: boolean;
	readonly sourceLength: number;
	readonly values: readonly unknown[];
}

interface CapturedOwnDataRecord {
	readonly valid: boolean;
	readonly keys: readonly string[];
	readonly values: Readonly<Record<string, unknown>>;
}

const readyEvaluations = new WeakMap<object, ReadyReviewSource>();
const finalizedReviews = new WeakMap<object, ReadyReviewSource>();

export function evaluateOpenFabStationProposalReview(
	artifact: HydratedOpenFabStationProposalArtifact,
	draft: OpenFabStationProposalReviewDraft,
	source: OpenFabStationProposalReviewSource,
): OpenFabStationProposalReviewEvaluation {
	const artifactSnapshot = snapshotReviewArtifact(artifact);
	const sourceSnapshot = snapshotReviewSource(source);
	const rowCount = artifactSnapshot?.rowCount ?? 0;
	const draftSnapshot = snapshotReviewDraft(draft, rowCount);
	const rawGroups = draftSnapshot.groupDecisions;
	const issues = createIssueCollector(rowCount, rawGroups.length);
	if (!draftSnapshot.valid || draftSnapshot.suppliedGroupCount > rowCount) {
		issues.addGlobal("INVALID_DRAFT");
	}
	let sourceChecksum = "";
	let physical: ReturnType<typeof compilePhysicalRail> | null = null;
	if (!sourceSnapshot || !artifactSnapshot) {
		issues.addGlobal("INVALID_SOURCE");
	} else {
		try {
			sourceChecksum = checksumRailMap(
				sourceSnapshot.stable.map,
				sourceSnapshot.stable.portEquipment,
				sourceSnapshot.stable.organizations,
			);
			physical = compilePhysicalRail(sourceSnapshot.stable.map);
		} catch {
			issues.addGlobal("INVALID_SOURCE");
		}
	}

	if (
		!artifactSnapshot || artifactSnapshot.rejectedRowCount === 0
			? draftSnapshot.rejectedSourceRowsPolicy !== "NOT_APPLICABLE"
			: draftSnapshot.rejectedSourceRowsPolicy !== "ACKNOWLEDGE_DISCARDED"
	) {
		issues.addGlobal("PROPOSAL_REJECTIONS_UNACKNOWLEDGED");
	}
	if (
		!artifactSnapshot || artifactSnapshot.unknownColumnCount === 0
			? draftSnapshot.unknownColumnsPolicy !== "NOT_APPLICABLE"
			: draftSnapshot.unknownColumnsPolicy !== "ACKNOWLEDGE_IGNORED"
	) {
		issues.addGlobal("UNKNOWN_COLUMNS_UNACKNOWLEDGED");
	}
	if (draftSnapshot.organizationPolicy !== "EXPLICIT_UNASSIGNED") {
		issues.addGlobal("ORGANIZATION_POLICY_UNRESOLVED");
	}

	const rawRows = draftSnapshot.rowDecisions;
	if (draftSnapshot.suppliedRowCount > rowCount) issues.addGlobal("INVALID_DRAFT");
	const decisionsByRow = new Array<OpenFabStationProposalRowDecision | undefined>(rowCount);
	for (let decisionIndex = 0; decisionIndex < rawRows.length; decisionIndex++) {
		const rawDecision = rawRows[decisionIndex];
		const row = isRecord(rawDecision) ? rawDecision.row : null;
		if (!Number.isInteger(row) || (row as number) < 0 || (row as number) >= rowCount) {
			issues.addGlobal("ROW_DECISION_OUT_OF_RANGE");
			continue;
		}
		const exactRow = row as number;
		if (decisionsByRow[exactRow] !== undefined) {
			issues.addRow(exactRow, "ROW_DECISION_DUPLICATE");
			continue;
		}
		decisionsByRow[exactRow] = rawDecision as OpenFabStationProposalRowDecision;
	}

	const attachmentIndex = physical ? createPortAttachmentSourceIndex(physical) : null;
	const includedRows = new Uint8Array(rowCount);
	const rejectedRows = new Uint8Array(rowCount);
	const pendingPorts = new Map<number, PendingPortDecision>();
	const rejected: { row: number; reason: OpenFabStationProposalRejectReason }[] = [];
	const declaredGroups = new Map<string, Map<string, number[]>>();
	for (let row = 0; row < rowCount; row++) {
		let proposal: OpenFabStationProposalRow;
		try {
			const rawProposal = artifactSnapshot?.readRow(row);
			const snapshot = snapshotProposalRow(rawProposal);
			if (!snapshot) throw new TypeError("Invalid station proposal row facade.");
			proposal = snapshot;
		} catch {
			issues.addGlobal("INVALID_SOURCE");
			break;
		}
		addDeclaredGroupMember(declaredGroups, proposal, row);
		const decision = decisionsByRow[row];
		if (!decision) {
			issues.addRow(row, "ROW_DECISION_MISSING");
			continue;
		}
		if (decision.disposition === "REJECT") {
			rejectedRows[row] = 1;
			if (
				!hasExactKeys(decision, REJECT_DECISION_KEYS) ||
				!OPENFAB_STATION_PROPOSAL_REJECT_REASONS.includes(decision.reason)
			) {
				issues.addRow(row, "ROW_DISPOSITION_INVALID");
				continue;
			}
			rejected.push({ row, reason: decision.reason });
			continue;
		}
		if (decision.disposition !== "INCLUDE") {
			issues.addRow(row, "ROW_DISPOSITION_INVALID");
			continue;
		}
		includedRows[row] = 1;
		const pending = validateIncludeDecision(
			row,
			proposal,
			decision,
			physical,
			attachmentIndex,
			issues,
		);
		if (pending) pendingPorts.set(row, pending);
	}

	const parsedGroups = parseGroupDecisions(rawGroups, rowCount, issues);
	const membershipCounts = new Uint8Array(rowCount);
	for (const group of parsedGroups) {
		for (const row of group.memberRows) {
			membershipCounts[row] = Math.min(2, (membershipCounts[row] as number) + 1);
			if (rejectedRows[row] === 1) {
				issues.addGroup(group.inputIndex, "GROUP_MEMBER_REJECTED");
				issues.addRow(row, "GROUP_MEMBER_REJECTED");
			}
		}
	}
	for (let row = 0; row < rowCount; row++) {
		if (includedRows[row] !== 1) continue;
		if (membershipCounts[row] === 0) issues.addRow(row, "ROW_GROUP_MISSING");
		else if (membershipCounts[row] > 1) issues.addRow(row, "ROW_GROUP_MULTIPLE");
	}

	const normalizedGroups: NormalizedGroupDecision[] = [];
	for (const group of parsedGroups) {
		const ports = group.memberRows
			.map((row) => pendingPorts.get(row))
			.filter((port): port is PendingPortDecision => port !== undefined);
		if (ports.length !== group.memberRows.length) {
			issues.addGroup(group.inputIndex, "EQUIPMENT_GROUP_INVALID");
			continue;
		}
		if (ports.some((port) => port.portType !== group.kind)) {
			issues.addGroup(group.inputIndex, "GROUP_KIND_MISMATCH");
			for (const port of ports) {
				if (port.portType !== group.kind) issues.addRow(port.row, "GROUP_KIND_MISMATCH");
			}
		}
		if (
			group.groupingReview === "CONFIRM_DECLARED" &&
			!confirmedDeclaredGroupIsExact(group, ports, declaredGroups)
		) {
			issues.addGroup(group.inputIndex, "GROUPING_REVIEW_INVALID");
		}
		const groupRecord = provisionalGroupRecord(group);
		if (!groupRecord || equipmentGroupError(groupRecord)) {
			issues.addGroup(group.inputIndex, "EQUIPMENT_GROUP_INVALID");
			continue;
		}
		if (issues.groupMasks[group.inputIndex] !== 0) continue;
		normalizedGroups.push(normalizeGroup(group, ports));
	}

	normalizedGroups.sort(compareNormalizedGroups);
	rejected.sort((left, right) => left.row - right.row);
	const normalized: NormalizedReview = Object.freeze({
		groups: Object.freeze(normalizedGroups),
		rejected: Object.freeze(rejected.map((decision) => Object.freeze({ ...decision }))),
	});

	let preparedPlan: PortEquipmentMutationPlan | null = null;
	if (!issues.hasIssues() && normalizedGroups.length > 0 && sourceSnapshot) {
		const materialized = materializeReviewedBatch(normalized, sourceSnapshot.stable);
		if (!materialized.ok) issues.addGlobal(materialized.code);
		else preparedPlan = materialized.plan;
	}
	const state: OpenFabStationProposalReviewState = issues.hasIssues()
		? "BLOCKED"
		: normalizedGroups.length === 0
			? "NO_CHANGES"
			: "READY";
	const reviewFingerprint =
		state === "READY" && artifactSnapshot && sourceSnapshot
			? openFabStationProposalReviewFingerprint(
					artifactSnapshot.semanticFingerprint,
					sourceChecksum,
					sourceSnapshot.stable,
					normalized,
				)
			: null;
	const evaluation = createEvaluation(
		state,
		rowCount,
		rawGroups.length,
		pendingPorts.size,
		rejected.length,
		normalizedGroups.length,
		reviewFingerprint,
		issues,
	);
	if (state === "READY" && reviewFingerprint !== null && preparedPlan !== null && sourceSnapshot) {
		readyEvaluations.set(
			evaluation,
			Object.freeze({
				source: sourceSnapshot.original,
				sourceMap: sourceSnapshot.stable.map,
				sourcePortEquipment: sourceSnapshot.stable.portEquipment,
				sourceOrganizations: sourceSnapshot.stable.organizations,
				sourceChecksum,
				sourceRevision: sourceSnapshot.revision,
				sourcePatchSequence: sourceSnapshot.stable.patchSequence,
				sourceNextPortId: sourceSnapshot.stable.portEquipment.nextPortId,
				sourceNextEquipmentGroupId: sourceSnapshot.stable.portEquipment.nextEquipmentGroupId,
				sourceNextOrganizationId: sourceSnapshot.stable.organizations.nextOrganizationId,
				plan: preparedPlan,
				reviewFingerprint,
			}),
		);
	}
	return evaluation;
}

/** Explicit one-shot transition from a READY evaluation into opaque reviewed evidence. */
export function finalizeOpenFabStationProposalReview(
	evaluation: OpenFabStationProposalReviewEvaluation,
): ReviewedOpenFabStationProposal {
	const ready = readyEvaluations.get(evaluation);
	readyEvaluations.delete(evaluation);
	if (!ready || evaluation.state !== "READY") {
		throw new Error("OpenFab station proposal review is not ready or was already finalized.");
	}
	const reviewed = Object.freeze({
		kind: "reviewed-openfab-station-proposal" as const,
		version: OPENFAB_STATION_PROPOSAL_REVIEW_VERSION,
		proposalRowCount: evaluation.proposalRowCount,
		portCount: evaluation.includedPortCount,
		equipmentGroupCount: evaluation.equipmentGroupCount,
		rejectedPortCount: evaluation.rejectedPortCount,
		reviewFingerprint: ready.reviewFingerprint,
	});
	finalizedReviews.set(reviewed, ready);
	return reviewed;
}

/**
 * Resolve one finalized review into an ordinary reciprocal placement batch.
 * Planning is pure; only `RailDocument.commitPortEquipment` mutates authored truth.
 */
export function planReviewedOpenFabStationProposalBatch(
	reviewed: ReviewedOpenFabStationProposal,
	source: OpenFabStationProposalReviewSource,
): PortEquipmentMutationPlan {
	const ready = finalizedReviews.get(reviewed);
	finalizedReviews.delete(reviewed);
	const sourceSnapshot = snapshotReviewSource(source);
	if (!ready || !sourceSnapshot || !reviewSourceStillMatches(ready, sourceSnapshot)) {
		return invalidReviewedBatch(source, "Reviewed station proposal is stale or already consumed.");
	}
	let checksum: string;
	try {
		checksum = checksumRailMap(
			sourceSnapshot.stable.map,
			sourceSnapshot.stable.portEquipment,
			sourceSnapshot.stable.organizations,
		);
	} catch {
		return invalidReviewedBatch(source, "Reviewed station proposal source is invalid.");
	}
	if (checksum !== ready.sourceChecksum) {
		return invalidReviewedBatch(source, "Reviewed station proposal source checksum changed.");
	}
	if (ready.plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND) {
		issuePortEquipmentBatchPlan(
			ready.plan,
			sourceSnapshot.stable.map,
			sourceSnapshot.stable.portEquipment,
			sourceSnapshot.stable.organizations,
			sourceSnapshot.stable.patchSequence,
		);
	}
	return ready.plan;
}

function validateIncludeDecision(
	row: number,
	proposal: OpenFabStationProposalRow,
	decision: OpenFabStationProposalIncludeDecision,
	physical: ReturnType<typeof compilePhysicalRail> | null,
	attachmentIndex: ReturnType<typeof createPortAttachmentSourceIndex> | null,
	issues: ReviewIssueCollector,
): PendingPortDecision | null {
	if (!hasExactKeys(decision, INCLUDE_DECISION_KEYS)) {
		issues.addRow(row, "ROW_DISPOSITION_INVALID");
		return null;
	}
	if (decision.identityAction !== "CREATE_NEW") {
		issues.addRow(row, "ROW_IDENTITY_REVIEW_INVALID");
	}
	if (
		!PORT_TYPES.includes(decision.portType) ||
		(decision.typeReview !== "OVERRIDE" &&
			(decision.typeReview !== "CONFIRM_DECLARED" ||
				proposal.portType === "UNRESOLVED" ||
				proposal.portType !== decision.portType))
	) {
		issues.addRow(row, "ROW_TYPE_REVIEW_INVALID");
	}
	if (decision.attachmentReview !== "USER_SELECTED_EXACT_ROUTE") {
		issues.addRow(row, "ROW_ATTACHMENT_REVIEW_INVALID");
	}
	const routeShapeValid = validExactRouteShape(decision.route);
	if (!routeShapeValid) {
		issues.addRow(row, "ROW_ATTACHMENT_REVIEW_INVALID");
	}
	const stationValueValid =
		Number.isInteger(decision.stationMillimeters) &&
		decision.stationMillimeters >= 0 &&
		decision.stationMillimeters <= PORT_RECORD_MAX_STATION_MILLIMETERS;
	if (
		!stationValueValid ||
		(decision.stationReview !== "OVERRIDE" &&
			(decision.stationReview !== "CONFIRM_DECLARED" ||
				proposal.stationMillimeters !== decision.stationMillimeters))
	) {
		issues.addRow(row, "ROW_STATION_REVIEW_INVALID");
	}
	const sideOffsetValueValid =
		PORT_SIDES.includes(decision.side) &&
		Number.isInteger(decision.lateralOffsetMillimeters) &&
		decision.lateralOffsetMillimeters >= 0 &&
		decision.lateralOffsetMillimeters <= PORT_RECORD_MAX_OFFSET_MILLIMETERS &&
		((decision.side === "CENTER" && decision.lateralOffsetMillimeters === 0) ||
			(decision.side !== "CENTER" && decision.lateralOffsetMillimeters > 0));
	if (
		!sideOffsetValueValid ||
		(decision.sideOffsetReview !== "OVERRIDE" &&
			(decision.sideOffsetReview !== "CONFIRM_DECLARED" ||
				proposal.side === "UNRESOLVED" ||
				proposal.side !== decision.side ||
				proposal.lateralOffsetMillimeters !== decision.lateralOffsetMillimeters))
	) {
		issues.addRow(row, "ROW_SIDE_OFFSET_REVIEW_INVALID");
	}
	if (!directionReviewMatchesProposal(decision, proposal)) {
		issues.addRow(row, "ROW_DIRECTION_REVIEW_INVALID");
	}
	if (
		!routeShapeValid ||
		!stationValueValid ||
		!sideOffsetValueValid ||
		!PORT_DIRECTIONS.includes(decision.direction) ||
		!PORT_TYPES.includes(decision.portType)
	) {
		return null;
	}
	let candidate: PortRecord;
	try {
		candidate = copyPortRecord({
			id: row + 1,
			equipmentGroupId: 1,
			route: decision.route,
			stationMillimeters: decision.stationMillimeters,
			side: decision.side,
			lateralOffsetMillimeters: decision.lateralOffsetMillimeters,
			direction: decision.direction,
			portType: decision.portType,
			barcode: null,
		});
	} catch {
		issues.addRow(row, "ROW_ATTACHMENT_REVIEW_INVALID");
		return null;
	}
	if (!physical || !attachmentIndex) {
		issues.addRow(row, "ATTACHMENT_RESOLUTION_INVALID");
		return null;
	}
	const resolution = resolvePortAttachmentWithSourceIndex(physical, candidate, attachmentIndex);
	if (!resolution.ok) {
		issues.addRow(row, "ATTACHMENT_RESOLUTION_INVALID");
		return null;
	}
	const sourcePositionPresent =
		proposal.sourceXMillimeters !== null && proposal.sourceZMillimeters !== null;
	const sourcePositionMatches =
		sourcePositionPresent &&
		Math.abs(resolution.worldXMeters * 1_000 - (proposal.sourceXMillimeters as number)) <=
			OPENFAB_STATION_PROPOSAL_SOURCE_POSITION_TOLERANCE_MILLIMETERS &&
		Math.abs(resolution.worldZMeters * 1_000 - (proposal.sourceZMillimeters as number)) <=
			OPENFAB_STATION_PROPOSAL_SOURCE_POSITION_TOLERANCE_MILLIMETERS;
	const sourceReviewValid = sourcePositionPresent
		? sourcePositionMatches
			? decision.sourcePositionReview === "CONFIRM_MATCH"
			: decision.sourcePositionReview === "ACKNOWLEDGE_MISMATCH"
		: decision.sourcePositionReview === "NOT_PROVIDED";
	if (!sourceReviewValid) issues.addRow(row, "ROW_SOURCE_POSITION_REVIEW_INVALID");
	if (issues.rowMasks[row] !== 0) return null;
	return Object.freeze({
		row,
		route: candidate.route,
		stationMillimeters: candidate.stationMillimeters,
		side: candidate.side,
		lateralOffsetMillimeters: candidate.lateralOffsetMillimeters,
		direction: candidate.direction,
		portType: candidate.portType,
		identityAction: decision.identityAction,
		typeReview: decision.typeReview,
		stationReview: decision.stationReview,
		sideOffsetReview: decision.sideOffsetReview,
		directionReview: decision.directionReview,
		sourcePositionReview: decision.sourcePositionReview,
		declaredGroupScope: proposal.identityScope,
		declaredGroupKey: proposal.physicalGroupKey,
		declaredGroupKind: proposal.physicalGroupKind,
	});
}

function directionReviewMatchesProposal(
	decision: OpenFabStationProposalIncludeDecision,
	proposal: OpenFabStationProposalRow,
): boolean {
	if (!PORT_DIRECTIONS.includes(decision.direction)) return false;
	if (decision.directionReview === "OVERRIDE") return true;
	if (
		decision.directionReview === "CONFIRM_DECLARED" &&
		proposal.directionEvidence === "DECLARED"
	) {
		return proposal.direction === decision.direction;
	}
	if (
		decision.directionReview === "CONFIRM_HEURISTIC" &&
		proposal.directionEvidence === "HEURISTIC"
	) {
		return proposal.direction === decision.direction;
	}
	return false;
}

function parseGroupDecisions(
	rawGroups: readonly OpenFabStationProposalGroupDecision[],
	rowCount: number,
	issues: ReviewIssueCollector,
): readonly ParsedGroupDecision[] {
	const parsed: ParsedGroupDecision[] = [];
	const firstIndexById = new Map<number, number>();
	let suppliedMembershipCount = 0;
	for (let inputIndex = 0; inputIndex < rawGroups.length; inputIndex++) {
		const raw = rawGroups[inputIndex];
		if (!validGroupDecisionShape(raw)) {
			issues.addGroup(inputIndex, "GROUP_DECISION_INVALID");
			continue;
		}
		const memberCount = raw.memberRows.length;
		if (memberCount > rowCount - suppliedMembershipCount) {
			issues.addGroup(inputIndex, "GROUP_DECISION_INVALID");
			continue;
		}
		suppliedMembershipCount += memberCount;
		const firstIndex = firstIndexById.get(raw.reviewGroupId);
		if (firstIndex !== undefined) {
			issues.addGroup(firstIndex, "GROUP_ID_DUPLICATE");
			issues.addGroup(inputIndex, "GROUP_ID_DUPLICATE");
			continue;
		}
		firstIndexById.set(raw.reviewGroupId, inputIndex);
		const uniqueRows = new Set<number>();
		const memberRows: number[] = [];
		for (let memberIndex = 0; memberIndex < memberCount; memberIndex++) {
			const row = raw.memberRows[memberIndex] as number;
			if (!Number.isInteger(row) || row < 0 || row >= rowCount) {
				issues.addGroup(inputIndex, "GROUP_MEMBER_OUT_OF_RANGE");
				continue;
			}
			if (uniqueRows.has(row)) {
				issues.addGroup(inputIndex, "GROUP_MEMBER_DUPLICATE");
				continue;
			}
			uniqueRows.add(row);
			memberRows.push(row);
		}
		memberRows.sort((left, right) => left - right);
		if (memberRows.length === 0) issues.addGroup(inputIndex, "EQUIPMENT_GROUP_INVALID");
		parsed.push(
			Object.freeze({
				inputIndex,
				reviewGroupId: raw.reviewGroupId,
				kind: raw.kind,
				groupingReview: raw.groupingReview,
				memberRows: Object.freeze(memberRows),
				...(raw.kind === "EQ"
					? { pitchMillimeters: raw.pitchMillimeters, recipe: raw.recipe }
					: { template: raw.template }),
			}),
		);
	}
	return Object.freeze(parsed);
}

function validGroupDecisionShape(value: unknown): value is OpenFabStationProposalGroupDecision {
	if (
		!isRecord(value) ||
		!isPositiveInt32(value.reviewGroupId) ||
		!Array.isArray(value.memberRows)
	) {
		return false;
	}
	if (value.groupingReview !== "CONFIRM_DECLARED" && value.groupingReview !== "OVERRIDE") {
		return false;
	}
	if (value.kind === "OHB") {
		return hasExactKeys(value, OHB_GROUP_KEYS) && value.template === "SINGLE";
	}
	if (value.kind === "EQ") {
		return (
			hasExactKeys(value, EQ_GROUP_KEYS) &&
			Number.isInteger(value.pitchMillimeters) &&
			value.recipe === null
		);
	}
	return (
		value.kind === "STK" &&
		hasExactKeys(value, STK_GROUP_KEYS) &&
		STK_AUTHORING_TEMPLATES.includes(value.template as StkAuthoringTemplate)
	);
}

function validExactRouteShape(value: unknown): value is PortRouteIdentity {
	if (!isRecord(value)) return false;
	return value.kind === "CARDINAL_CELL"
		? hasExactKeys(value, CARDINAL_ROUTE_KEYS)
		: value.kind === "ADVANCED_SWITCH_SEGMENT" && hasExactKeys(value, ADVANCED_ROUTE_KEYS);
}

function confirmedDeclaredGroupIsExact(
	group: ParsedGroupDecision,
	ports: readonly PendingPortDecision[],
	declaredGroups: ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>,
): boolean {
	const first = ports[0];
	if (
		!first ||
		first.declaredGroupKey.length === 0 ||
		first.declaredGroupKind !== group.kind ||
		ports.some(
			(port) =>
				port.declaredGroupScope !== first.declaredGroupScope ||
				port.declaredGroupKey !== first.declaredGroupKey ||
				port.declaredGroupKind !== group.kind,
		)
	) {
		return false;
	}
	const declared = declaredGroups.get(first.declaredGroupScope)?.get(first.declaredGroupKey);
	return (
		declared?.length === group.memberRows.length &&
		declared.every((row, index) => row === group.memberRows[index])
	);
}

function provisionalGroupRecord(group: ParsedGroupDecision): EquipmentGroupRecord | null {
	const portIds = group.memberRows.map((row) => row + 1);
	if (group.kind === "OHB") {
		return { id: 1, kind: "OHB", template: "SINGLE", portIds };
	}
	if (group.kind === "EQ") {
		return {
			id: 1,
			kind: "EQ",
			pitchMillimeters: group.pitchMillimeters as number,
			recipe: null,
			portIds,
		};
	}
	if (!group.template || group.template === "SINGLE") return null;
	return { id: 1, kind: "STK", template: group.template, portIds };
}

function normalizeGroup(
	group: ParsedGroupDecision,
	ports: readonly PendingPortDecision[],
): NormalizedGroupDecision {
	const normalizedPorts = Object.freeze(
		ports.map(stripDeclaredGroupEvidence).sort((left, right) => left.row - right.row),
	);
	if (group.kind === "OHB") {
		return Object.freeze({
			kind: "OHB",
			template: "SINGLE",
			groupingReview: group.groupingReview,
			ports: normalizedPorts,
		});
	}
	if (group.kind === "EQ") {
		return Object.freeze({
			kind: "EQ",
			pitchMillimeters: group.pitchMillimeters as number,
			recipe: null,
			groupingReview: group.groupingReview,
			ports: normalizedPorts,
		});
	}
	return Object.freeze({
		kind: "STK",
		template: group.template as StkAuthoringTemplate,
		groupingReview: group.groupingReview,
		ports: normalizedPorts,
	});
}

function stripDeclaredGroupEvidence(port: PendingPortDecision): NormalizedPortDecision {
	return Object.freeze({
		row: port.row,
		route: port.route,
		stationMillimeters: port.stationMillimeters,
		side: port.side,
		lateralOffsetMillimeters: port.lateralOffsetMillimeters,
		direction: port.direction,
		portType: port.portType,
		identityAction: port.identityAction,
		typeReview: port.typeReview,
		stationReview: port.stationReview,
		sideOffsetReview: port.sideOffsetReview,
		directionReview: port.directionReview,
		sourcePositionReview: port.sourcePositionReview,
	});
}

function materializeReviewedBatch(
	normalized: NormalizedReview,
	source: OpenFabStationProposalReviewSource,
):
	| { readonly ok: true; readonly plan: PortEquipmentMutationPlan }
	| {
			readonly ok: false;
			readonly code: "ID_ALLOCATION_EXHAUSTED" | "PROSPECTIVE_LAYOUT_INVALID";
	  } {
	const portCount = normalized.groups.reduce((count, group) => count + group.ports.length, 0);
	let allocation: ReturnType<typeof allocatePortEquipmentRecordIds>;
	try {
		allocation = allocatePortEquipmentRecordIds(
			source.portEquipment,
			portCount,
			normalized.groups.length,
		);
	} catch {
		return { ok: false, code: "ID_ALLOCATION_EXHAUSTED" };
	}
	const portMutations = [];
	const equipmentGroupMutations = [];
	let portAllocationIndex = 0;
	try {
		for (let groupIndex = 0; groupIndex < normalized.groups.length; groupIndex++) {
			const group = normalized.groups[groupIndex] as NormalizedGroupDecision;
			const equipmentGroupId = allocation.equipmentGroupIds[groupIndex] as number;
			const provisionalPorts = group.ports.map((port) =>
				copyPortRecord({
					id: port.row + 1,
					equipmentGroupId: 1,
					route: port.route,
					stationMillimeters: port.stationMillimeters,
					side: port.side,
					lateralOffsetMillimeters: port.lateralOffsetMillimeters,
					direction: port.direction,
					portType: port.portType,
					barcode: null,
				}),
			);
			const canonicalRows = canonicalEquipmentGroupPortIds(
				group.kind === "STK" ? { kind: "STK", template: group.template } : { kind: group.kind },
				provisionalPorts.map((port) => port.id),
				provisionalPorts,
			);
			const portByRowId = new Map(group.ports.map((port) => [port.row + 1, port] as const));
			const actualPorts: PortRecord[] = [];
			for (const rowId of canonicalRows) {
				const reviewedPort = portByRowId.get(rowId);
				if (!reviewedPort) throw new Error("canonical reviewed port is missing");
				const portId = allocation.portIds[portAllocationIndex++] as number;
				const actual = copyPortRecord({
					id: portId,
					equipmentGroupId,
					route: reviewedPort.route,
					stationMillimeters: reviewedPort.stationMillimeters,
					side: reviewedPort.side,
					lateralOffsetMillimeters: reviewedPort.lateralOffsetMillimeters,
					direction: reviewedPort.direction,
					portType: reviewedPort.portType,
					barcode: equipmentGroupPortBarcode(
						group.kind,
						equipmentGroupId,
						portId,
						actualPorts.length,
					),
				});
				actualPorts.push(actual);
				portMutations.push(Object.freeze({ id: portId, before: null, after: actual }));
			}
			const groupRecord = copyEquipmentGroupRecord(
				group.kind === "OHB"
					? {
							id: equipmentGroupId,
							kind: "OHB",
							template: "SINGLE",
							portIds: actualPorts.map((port) => port.id),
						}
					: group.kind === "EQ"
						? {
								id: equipmentGroupId,
								kind: "EQ",
								pitchMillimeters: group.pitchMillimeters,
								recipe: null,
								portIds: actualPorts.map((port) => port.id),
							}
						: {
								id: equipmentGroupId,
								kind: "STK",
								template: group.template,
								portIds: actualPorts.map((port) => port.id),
							},
			);
			equipmentGroupMutations.push(
				Object.freeze({ id: equipmentGroupId, before: null, after: groupRecord }),
			);
		}
		const prospective = applyPortEquipmentMutations(
			source.portEquipment,
			portMutations,
			equipmentGroupMutations,
		);
		if (portEquipmentLayoutError(source.map, prospective)) {
			return { ok: false, code: "PROSPECTIVE_LAYOUT_INVALID" };
		}
	} catch {
		return { ok: false, code: "PROSPECTIVE_LAYOUT_INVALID" };
	}
	return {
		ok: true,
		plan: createPortEquipmentMutationPlanWithImmutableGraphCertificate(
			reviewedPlacementPlanKind(normalized.groups),
			source.map.getRevision(),
			source.patchSequence,
			portMutations,
			equipmentGroupMutations,
		),
	};
}

function reviewedPlacementPlanKind(
	groups: readonly NormalizedGroupDecision[],
): "place-ohb" | "place-eq" | "place-stk" | typeof PORT_EQUIPMENT_BATCH_PLAN_KIND {
	const firstKind = groups[0]?.kind;
	if (!firstKind || groups.some((group) => group.kind !== firstKind)) {
		return PORT_EQUIPMENT_BATCH_PLAN_KIND;
	}
	return firstKind === "OHB" ? "place-ohb" : firstKind === "EQ" ? "place-eq" : "place-stk";
}

function openFabStationProposalReviewFingerprint(
	proposalSemanticFingerprint: string,
	sourceChecksum: string,
	source: OpenFabStationProposalReviewSource,
	normalized: NormalizedReview,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"OPENFAB_STATION_PROPOSAL_REVIEW_V1",
		proposalSemanticFingerprint,
		sourceChecksum,
	]);
	checksum.addNumbers([
		source.map.getRevision(),
		source.patchSequence,
		source.portEquipment.nextPortId,
		source.portEquipment.nextEquipmentGroupId,
		source.organizations.nextOrganizationId,
		normalized.groups.length,
		normalized.rejected.length,
	]);
	for (const group of normalized.groups) {
		checksum.addStrings([group.kind, group.groupingReview]);
		checksum.addNumbers([
			group.kind === "EQ" ? group.pitchMillimeters : 0,
			group.kind === "STK" ? STK_AUTHORING_TEMPLATES.indexOf(group.template) + 1 : 0,
			group.ports.length,
		]);
		for (const port of group.ports) {
			addReviewedPortFingerprint(checksum, port);
		}
	}
	for (const decision of normalized.rejected) {
		checksum.addStrings([decision.reason]);
		checksum.addNumbers([decision.row]);
	}
	return `openfab-station-proposal-review:v1:${checksum.digest()}`;
}

function addReviewedPortFingerprint(
	checksum: OrderedTypedChecksum,
	port: NormalizedPortDecision,
): void {
	checksum.addStrings([
		port.portType,
		port.identityAction,
		port.side,
		port.direction,
		port.typeReview,
		port.stationReview,
		port.sideOffsetReview,
		port.directionReview,
		port.sourcePositionReview,
		port.route.kind,
	]);
	checksum.addNumbers([port.row, port.stationMillimeters, port.lateralOffsetMillimeters]);
	if (port.route.kind === "CARDINAL_CELL") {
		checksum.addNumbers([port.route.x, port.route.z, port.route.from, port.route.to]);
	} else {
		checksum.addStrings([port.route.profileClass, port.route.role]);
		checksum.addNumbers([
			port.route.switchId,
			port.route.portIndex ?? -1,
			port.route.segmentOrdinal,
		]);
	}
}

function reviewSourceStillMatches(
	ready: ReadyReviewSource,
	snapshot: ReviewSourceSnapshot,
): boolean {
	const source = snapshot.stable;
	return (
		ready.source === snapshot.original &&
		ready.sourceMap === source.map &&
		ready.sourcePortEquipment === source.portEquipment &&
		ready.sourceOrganizations === source.organizations &&
		ready.sourceRevision === snapshot.revision &&
		ready.sourcePatchSequence === source.patchSequence &&
		ready.sourceNextPortId === source.portEquipment.nextPortId &&
		ready.sourceNextEquipmentGroupId === source.portEquipment.nextEquipmentGroupId &&
		ready.sourceNextOrganizationId === source.organizations.nextOrganizationId
	);
}

function invalidReviewedBatch(
	source: OpenFabStationProposalReviewSource,
	reason: string,
): PortEquipmentMutationPlan {
	let revision = 0;
	let patchSequence = 0;
	try {
		const candidateRevision = source?.map?.getRevision?.();
		if (Number.isSafeInteger(candidateRevision) && (candidateRevision as number) >= 0) {
			revision = candidateRevision as number;
		}
		if (Number.isSafeInteger(source?.patchSequence) && source.patchSequence >= 0) {
			patchSequence = source.patchSequence;
		}
	} catch {
		// Invalid runtime input remains a fixed invalid plan rather than escaping this boundary.
	}
	return createInvalidPortEquipmentMutationPlan(
		PORT_EQUIPMENT_BATCH_PLAN_KIND,
		revision,
		patchSequence,
		reason,
	);
}

function createEvaluation(
	state: OpenFabStationProposalReviewState,
	proposalRowCount: number,
	groupDecisionCount: number,
	includedPortCount: number,
	rejectedPortCount: number,
	equipmentGroupCount: number,
	reviewFingerprint: string | null,
	issues: ReviewIssueCollector,
): OpenFabStationProposalReviewEvaluation {
	return Object.freeze({
		kind: "openfab-station-proposal-review-evaluation" as const,
		version: OPENFAB_STATION_PROPOSAL_REVIEW_VERSION,
		state,
		proposalRowCount,
		groupDecisionCount,
		includedPortCount,
		rejectedPortCount,
		equipmentGroupCount,
		reviewFingerprint,
		issueCount: (code: OpenFabStationProposalReviewIssueCode): number =>
			issues.issueCounts[reviewIssueIndex(code)] as number,
		rowIssueMask: (row: number): number =>
			Number.isInteger(row) && row >= 0 && row < issues.rowMasks.length
				? (issues.rowMasks[row] as number)
				: 0,
		groupIssueMask: (group: number): number =>
			Number.isInteger(group) && group >= 0 && group < issues.groupMasks.length
				? (issues.groupMasks[group] as number)
				: 0,
	});
}

function createIssueCollector(rowCount: number, groupCount: number): ReviewIssueCollector {
	const issueCounts = new Uint32Array(OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES.length);
	const rowMasks = new Uint32Array(rowCount);
	const groupMasks = new Uint32Array(groupCount);
	const globalIssues = new Set<number>();
	const addCount = (index: number): void => {
		issueCounts[index] = Math.min(0xffff_ffff, (issueCounts[index] as number) + 1);
	};
	return {
		issueCounts,
		rowMasks,
		groupMasks,
		addGlobal(code) {
			const index = reviewIssueIndex(code);
			if (globalIssues.has(index)) return;
			globalIssues.add(index);
			addCount(index);
		},
		addRow(row, code) {
			if (!Number.isInteger(row) || row < 0 || row >= rowMasks.length) return;
			const index = reviewIssueIndex(code);
			const bit = 2 ** index;
			if (((rowMasks[row] as number) & bit) !== 0) return;
			rowMasks[row] = (rowMasks[row] as number) | bit;
			addCount(index);
		},
		addGroup(group, code) {
			if (!Number.isInteger(group) || group < 0 || group >= groupMasks.length) return;
			const index = reviewIssueIndex(code);
			const bit = 2 ** index;
			if (((groupMasks[group] as number) & bit) !== 0) return;
			groupMasks[group] = (groupMasks[group] as number) | bit;
			addCount(index);
		},
		hasIssues() {
			return issueCounts.some((count) => count !== 0);
		},
	};
}

function reviewIssueIndex(code: OpenFabStationProposalReviewIssueCode): number {
	const index = OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES.indexOf(code);
	if (index < 0) throw new RangeError("Unknown station proposal review issue code.");
	return index;
}

function addDeclaredGroupMember(
	groups: Map<string, Map<string, number[]>>,
	proposal: OpenFabStationProposalRow,
	row: number,
): void {
	if (proposal.physicalGroupKey.length === 0) return;
	let byKey = groups.get(proposal.identityScope);
	if (!byKey) {
		byKey = new Map();
		groups.set(proposal.identityScope, byKey);
	}
	const members = byKey.get(proposal.physicalGroupKey);
	if (members) members.push(row);
	else byKey.set(proposal.physicalGroupKey, [row]);
}

function compareNormalizedGroups(
	left: NormalizedGroupDecision,
	right: NormalizedGroupDecision,
): number {
	const count = Math.min(left.ports.length, right.ports.length);
	for (let index = 0; index < count; index++) {
		const difference =
			(left.ports[index] as NormalizedPortDecision).row -
			(right.ports[index] as NormalizedPortDecision).row;
		if (difference !== 0) return difference;
	}
	return left.ports.length - right.ports.length;
}

function snapshotReviewDraft(value: unknown, rowCount: number): CapturedReviewDraft {
	const record = snapshotEnumerableOwnDataRecord(value);
	const values = record?.values;
	const rowPrefix = captureFixedArrayPrefix(values?.rowDecisions, rowCount + 1, false);
	const groupPrefix = captureFixedArrayPrefix(values?.groupDecisions, rowCount, false);

	const rowDecisions = new Array<unknown>(rowPrefix.values.length);
	let canReuseRowDecisions = rowPrefix.values === values?.rowDecisions;
	for (let index = 0; index < rowDecisions.length; index++) {
		rowDecisions[index] = snapshotRowDecision(rowPrefix.values[index]);
		if (rowDecisions[index] !== rowPrefix.values[index]) canReuseRowDecisions = false;
	}

	const groupDecisions = new Array<OpenFabStationProposalGroupDecision>(groupPrefix.values.length);
	let canReuseGroupDecisions = groupPrefix.values === values?.groupDecisions;
	let remainingMembershipCapacity = rowCount;
	for (let index = 0; index < groupDecisions.length; index++) {
		const captured = snapshotGroupDecision(groupPrefix.values[index], remainingMembershipCapacity);
		groupDecisions[index] = captured.decision;
		if (groupDecisions[index] !== groupPrefix.values[index]) canReuseGroupDecisions = false;
		remainingMembershipCapacity -= captured.membershipCount;
	}

	return Object.freeze({
		valid:
			record?.valid === true &&
			capturedKeysMatch(record.keys, REVIEW_DRAFT_KEYS) &&
			rowPrefix.valid &&
			groupPrefix.valid,
		suppliedRowCount: rowPrefix.sourceLength,
		suppliedGroupCount: groupPrefix.sourceLength,
		rowDecisions: canReuseRowDecisions ? rowPrefix.values : Object.freeze(rowDecisions),
		groupDecisions: (canReuseGroupDecisions
			? groupPrefix.values
			: Object.freeze(groupDecisions)) as readonly OpenFabStationProposalGroupDecision[],
		rejectedSourceRowsPolicy: values?.rejectedSourceRowsPolicy,
		unknownColumnsPolicy: values?.unknownColumnsPolicy,
		organizationPolicy: values?.organizationPolicy,
	});
}

function snapshotRowDecision(value: unknown): unknown {
	const record = snapshotEnumerableOwnDataRecord(value);
	if (!record)
		return Object.freeze({ row: undefined, disposition: undefined, invalidSnapshot: true });
	const values = record.values;
	const row = values?.row;
	const disposition = values?.disposition;
	if (
		record.valid &&
		disposition === "REJECT" &&
		capturedKeysMatch(record.keys, REJECT_DECISION_KEYS)
	) {
		if (objectIsFrozen(value)) return value;
		return Object.freeze({ row, disposition, reason: values.reason });
	}
	if (
		record.valid &&
		disposition === "INCLUDE" &&
		capturedKeysMatch(record.keys, INCLUDE_DECISION_KEYS)
	) {
		const route = snapshotDecisionRoute(values.route);
		if (objectIsFrozen(value) && route === values.route) return value;
		return Object.freeze({
			row,
			disposition,
			identityAction: values.identityAction,
			portType: values.portType,
			typeReview: values.typeReview,
			attachmentReview: values.attachmentReview,
			route,
			stationMillimeters: values.stationMillimeters,
			stationReview: values.stationReview,
			side: values.side,
			lateralOffsetMillimeters: values.lateralOffsetMillimeters,
			sideOffsetReview: values.sideOffsetReview,
			direction: values.direction,
			directionReview: values.directionReview,
			sourcePositionReview: values.sourcePositionReview,
		});
	}
	return Object.freeze({ row, disposition, invalidSnapshot: true });
}

function snapshotDecisionRoute(value: unknown): unknown {
	const record = snapshotEnumerableOwnDataRecord(value);
	const values = record?.values;
	if (
		record?.valid &&
		values?.kind === "CARDINAL_CELL" &&
		capturedKeysMatch(record.keys, CARDINAL_ROUTE_KEYS)
	) {
		if (objectIsFrozen(value)) return value;
		return Object.freeze({
			kind: values.kind,
			x: values.x,
			z: values.z,
			from: values.from,
			to: values.to,
		});
	}
	if (
		record?.valid &&
		values?.kind === "ADVANCED_SWITCH_SEGMENT" &&
		capturedKeysMatch(record.keys, ADVANCED_ROUTE_KEYS)
	) {
		if (objectIsFrozen(value)) return value;
		return Object.freeze({
			kind: values.kind,
			switchId: values.switchId,
			profileClass: values.profileClass,
			role: values.role,
			portIndex: values.portIndex,
			segmentOrdinal: values.segmentOrdinal,
		});
	}
	return Object.freeze({ invalidSnapshot: true });
}

function snapshotGroupDecision(
	value: unknown,
	remainingMembershipCapacity: number,
): {
	readonly decision: OpenFabStationProposalGroupDecision;
	readonly membershipCount: number;
} {
	const invalid = (): {
		readonly decision: OpenFabStationProposalGroupDecision;
		readonly membershipCount: number;
	} => ({
		decision: Object.freeze({
			invalidSnapshot: true,
		}) as unknown as OpenFabStationProposalGroupDecision,
		membershipCount: 0,
	});
	const record = snapshotEnumerableOwnDataRecord(value);
	const values = record?.values;
	if (!record?.valid || !Array.isArray(values?.memberRows)) return invalid();
	const expectedKeys =
		values.kind === "OHB"
			? OHB_GROUP_KEYS
			: values.kind === "EQ"
				? EQ_GROUP_KEYS
				: values.kind === "STK"
					? STK_GROUP_KEYS
					: null;
	if (!expectedKeys || !capturedKeysMatch(record.keys, expectedKeys)) return invalid();
	const members = captureFixedArrayPrefix(values.memberRows, remainingMembershipCapacity, true);
	if (!members.valid || members.sourceLength > remainingMembershipCapacity) return invalid();
	const memberRows = members.values as readonly number[];
	if (objectIsFrozen(value) && members.values === values.memberRows) {
		const decision = value as OpenFabStationProposalGroupDecision;
		if (validGroupDecisionShape(decision)) {
			return { decision, membershipCount: members.sourceLength };
		}
		return invalid();
	}
	const decision = Object.freeze(
		values.kind === "OHB"
			? {
					reviewGroupId: values.reviewGroupId,
					memberRows,
					groupingReview: values.groupingReview,
					kind: values.kind,
					template: values.template,
				}
			: values.kind === "EQ"
				? {
						reviewGroupId: values.reviewGroupId,
						memberRows,
						groupingReview: values.groupingReview,
						kind: values.kind,
						pitchMillimeters: values.pitchMillimeters,
						recipe: values.recipe,
					}
				: {
						reviewGroupId: values.reviewGroupId,
						memberRows,
						groupingReview: values.groupingReview,
						kind: values.kind,
						template: values.template,
					},
	) as unknown as OpenFabStationProposalGroupDecision;
	if (!validGroupDecisionShape(decision)) return invalid();
	return { decision, membershipCount: members.sourceLength };
}

function captureFixedArrayPrefix(
	value: unknown,
	maximumCount: number,
	skipOverflowValues: boolean,
): CapturedArrayPrefix {
	try {
		if (!Array.isArray(value)) {
			return Object.freeze({ valid: false, sourceLength: 0, values: Object.freeze([]) });
		}
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
		if (
			!lengthDescriptor ||
			!("value" in lengthDescriptor) ||
			!Number.isSafeInteger(lengthDescriptor.value) ||
			lengthDescriptor.value < 0
		) {
			return Object.freeze({ valid: false, sourceLength: 0, values: Object.freeze([]) });
		}
		const sourceLength = lengthDescriptor.value as number;
		if (skipOverflowValues && sourceLength > maximumCount) {
			return Object.freeze({ valid: true, sourceLength, values: Object.freeze([]) });
		}
		const capturedCount = Math.min(sourceLength, maximumCount);
		const values = new Array<unknown>(capturedCount);
		let valid = true;
		let reusable = capturedCount === sourceLength && objectIsFrozen(value);
		for (let index = 0; index < capturedCount; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (descriptor === undefined) {
				reusable = false;
				values[index] = undefined;
				continue;
			}
			if (!("value" in descriptor) || !descriptor.enumerable) {
				valid = false;
				reusable = false;
				values[index] = undefined;
				continue;
			}
			values[index] = descriptor.value;
		}
		return Object.freeze({
			valid,
			sourceLength,
			values: reusable ? value : Object.freeze(values),
		});
	} catch {
		return Object.freeze({ valid: false, sourceLength: 0, values: Object.freeze([]) });
	}
}

function snapshotEnumerableOwnDataRecord(value: unknown): CapturedOwnDataRecord | null {
	try {
		if (!isRecord(value)) return null;
		const prototype = Object.getPrototypeOf(value);
		let valid = prototype === Object.prototype || prototype === null;
		const ownKeys = Reflect.ownKeys(value);
		const keys: string[] = [];
		const values = Object.create(null) as Record<string, unknown>;
		for (const key of ownKeys) {
			if (typeof key !== "string") {
				valid = false;
				continue;
			}
			keys.push(key);
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				valid = false;
				continue;
			}
			values[key] = descriptor.value;
		}
		keys.sort();
		return Object.freeze({
			valid,
			keys: Object.freeze(keys),
			values: Object.freeze(values),
		});
	} catch {
		return null;
	}
}

function capturedKeysMatch(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function objectIsFrozen(value: unknown): value is object {
	try {
		return typeof value === "object" && value !== null && Object.isFrozen(value);
	} catch {
		return false;
	}
}

function snapshotReviewSource(value: unknown): ReviewSourceSnapshot | null {
	try {
		if (!isRecord(value) || !hasExactKeys(value, REVIEW_SOURCE_KEYS)) return null;
		const map = value.map;
		const portEquipment = value.portEquipment;
		const organizations = value.organizations;
		const patchSequence = value.patchSequence;
		if (
			!isRecord(map) ||
			typeof map.getRevision !== "function" ||
			!isRecord(portEquipment) ||
			!isRecord(organizations) ||
			!Number.isSafeInteger(patchSequence) ||
			(patchSequence as number) < 0
		) {
			return null;
		}
		const revision = map.getRevision();
		if (!Number.isSafeInteger(revision) || revision < 0) return null;
		return Object.freeze({
			original: value as unknown as OpenFabStationProposalReviewSource,
			stable: Object.freeze({
				map: map as unknown as TileMap,
				portEquipment: portEquipment as unknown as PortEquipmentState,
				organizations: organizations as unknown as StaticFabOrganizationState,
				patchSequence: patchSequence as number,
			}),
			revision,
		});
	} catch {
		return null;
	}
}

function snapshotReviewArtifact(value: unknown): ReviewArtifactSnapshot | null {
	try {
		if (!isRecord(value) || !hasExactKeys(value, REVIEW_ARTIFACT_KEYS)) return null;
		const sourceByteLength = value.sourceByteLength;
		const sourceRecordCount = value.sourceRecordCount;
		const rowCount = value.rowCount;
		const rejectedRowCount = value.rejectedRowCount;
		const unknownColumnCount = value.unknownColumnCount;
		const kind = value.kind;
		const schemaId = value.schemaId;
		const schemaVersion = value.schemaVersion;
		const semanticFingerprint = value.semanticFingerprint;
		const snapshotFingerprint = value.snapshotFingerprint;
		const readRow = value.readRow;
		const issueCount = value.issueCount;
		if (
			kind !== "hydrated-openfab-station-proposal-artifact" ||
			schemaId !== OPENFAB_STATION_PROPOSAL_SCHEMA_ID ||
			schemaVersion !== OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION ||
			!isNonNegativeSafeInteger(sourceByteLength) ||
			!isNonNegativeSafeInteger(sourceRecordCount) ||
			sourceRecordCount > OPENFAB_STATION_PROPOSAL_MAX_ROWS ||
			!isNonNegativeSafeInteger(rowCount) ||
			rowCount > OPENFAB_STATION_PROPOSAL_MAX_ROWS ||
			!isNonNegativeSafeInteger(rejectedRowCount) ||
			rowCount + rejectedRowCount !== sourceRecordCount ||
			!isNonNegativeSafeInteger(unknownColumnCount) ||
			typeof semanticFingerprint !== "string" ||
			semanticFingerprint.length === 0 ||
			typeof snapshotFingerprint !== "string" ||
			snapshotFingerprint.length === 0 ||
			typeof readRow !== "function" ||
			typeof issueCount !== "function"
		) {
			return null;
		}
		return Object.freeze({
			rowCount,
			rejectedRowCount,
			unknownColumnCount,
			semanticFingerprint,
			readRow: (row: number) => Reflect.apply(readRow, value, [row]) as OpenFabStationProposalRow,
		});
	} catch {
		return null;
	}
}

function snapshotProposalRow(value: unknown): OpenFabStationProposalRow | null {
	if (!isRecord(value) || !hasExactKeys(value, PROPOSAL_ROW_KEYS)) return null;
	const sourcePositionValid =
		(value.sourceXMillimeters === null && value.sourceZMillimeters === null) ||
		(Number.isInteger(value.sourceXMillimeters) && Number.isInteger(value.sourceZMillimeters));
	if (
		typeof value.identityScope !== "string" ||
		typeof value.portKey !== "string" ||
		!Array.isArray(value.secondaryAliases) ||
		!value.secondaryAliases.every((alias) => typeof alias === "string") ||
		typeof value.attachmentScope !== "string" ||
		typeof value.attachmentAlias !== "string" ||
		!Number.isInteger(value.stationMillimeters) ||
		!OPENFAB_STATION_PROPOSAL_SIDES.includes(
			value.side as (typeof OPENFAB_STATION_PROPOSAL_SIDES)[number],
		) ||
		!Number.isInteger(value.lateralOffsetMillimeters) ||
		!OPENFAB_STATION_PROPOSAL_DIRECTIONS.includes(
			value.direction as (typeof OPENFAB_STATION_PROPOSAL_DIRECTIONS)[number],
		) ||
		!OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE.includes(
			value.directionEvidence as (typeof OPENFAB_STATION_PROPOSAL_DIRECTION_EVIDENCE)[number],
		) ||
		!OPENFAB_STATION_PROPOSAL_PORT_TYPES.includes(
			value.portType as (typeof OPENFAB_STATION_PROPOSAL_PORT_TYPES)[number],
		) ||
		typeof value.physicalGroupKey !== "string" ||
		!OPENFAB_STATION_PROPOSAL_PORT_TYPES.includes(
			value.physicalGroupKind as (typeof OPENFAB_STATION_PROPOSAL_PORT_TYPES)[number],
		) ||
		typeof value.organizationAlias !== "string" ||
		!sourcePositionValid
	) {
		return null;
	}
	return Object.freeze({
		identityScope: value.identityScope,
		portKey: value.portKey,
		secondaryAliases: Object.freeze([...value.secondaryAliases]),
		attachmentScope: value.attachmentScope,
		attachmentAlias: value.attachmentAlias,
		stationMillimeters: value.stationMillimeters as number,
		side: value.side as OpenFabStationProposalRow["side"],
		lateralOffsetMillimeters: value.lateralOffsetMillimeters as number,
		direction: value.direction as OpenFabStationProposalRow["direction"],
		directionEvidence: value.directionEvidence as OpenFabStationProposalRow["directionEvidence"],
		portType: value.portType as OpenFabStationProposalRow["portType"],
		physicalGroupKey: value.physicalGroupKey,
		physicalGroupKind: value.physicalGroupKind as OpenFabStationProposalRow["physicalGroupKind"],
		organizationAlias: value.organizationAlias,
		sourceXMillimeters: value.sourceXMillimeters as number | null,
		sourceZMillimeters: value.sourceZMillimeters as number | null,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
	const keys = Object.keys(value).sort();
	return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isPositiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

const OPENFAB_STATION_PROPOSAL_REJECT_REASONS = Object.freeze([
	"USER_EXCLUDED",
	"UNRESOLVED",
	"UNSUPPORTED",
] as const);

const REVIEW_SOURCE_KEYS = Object.freeze(
	["map", "organizations", "patchSequence", "portEquipment"].sort(),
);
const REVIEW_ARTIFACT_KEYS = Object.freeze(
	[
		"issueCount",
		"kind",
		"readRow",
		"rejectedRowCount",
		"rowCount",
		"schemaId",
		"schemaVersion",
		"semanticFingerprint",
		"snapshotFingerprint",
		"sourceByteLength",
		"sourceRecordCount",
		"unknownColumnCount",
	].sort(),
);

const REVIEW_DRAFT_KEYS = Object.freeze(
	[
		"groupDecisions",
		"organizationPolicy",
		"rejectedSourceRowsPolicy",
		"rowDecisions",
		"unknownColumnsPolicy",
	].sort(),
);
const REJECT_DECISION_KEYS = Object.freeze(["disposition", "reason", "row"].sort());
const INCLUDE_DECISION_KEYS = Object.freeze(
	[
		"attachmentReview",
		"direction",
		"directionReview",
		"disposition",
		"identityAction",
		"lateralOffsetMillimeters",
		"portType",
		"route",
		"row",
		"side",
		"sideOffsetReview",
		"sourcePositionReview",
		"stationMillimeters",
		"stationReview",
		"typeReview",
	].sort(),
);
const GROUP_BASE_KEYS = ["groupingReview", "kind", "memberRows", "reviewGroupId"] as const;
const OHB_GROUP_KEYS = Object.freeze([...GROUP_BASE_KEYS, "template"].sort());
const EQ_GROUP_KEYS = Object.freeze([...GROUP_BASE_KEYS, "pitchMillimeters", "recipe"].sort());
const STK_GROUP_KEYS = Object.freeze([...GROUP_BASE_KEYS, "template"].sort());
const CARDINAL_ROUTE_KEYS = Object.freeze(["from", "kind", "to", "x", "z"].sort());
const ADVANCED_ROUTE_KEYS = Object.freeze(
	["kind", "portIndex", "profileClass", "role", "segmentOrdinal", "switchId"].sort(),
);
const PROPOSAL_ROW_KEYS = Object.freeze(
	[
		"attachmentAlias",
		"attachmentScope",
		"direction",
		"directionEvidence",
		"identityScope",
		"lateralOffsetMillimeters",
		"organizationAlias",
		"physicalGroupKey",
		"physicalGroupKind",
		"portKey",
		"portType",
		"secondaryAliases",
		"side",
		"sourceXMillimeters",
		"sourceZMillimeters",
		"stationMillimeters",
	].sort(),
);
