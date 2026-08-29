import {
	consumeOpenFabStationProposalArtifactCaptureTransfer,
	type HydratedOpenFabStationProposalArtifact,
	type OpenFabStationProposalArtifact,
	type OpenFabStationProposalArtifactCapture,
} from "../compile/OpenFabStationProposalArtifact";
import {
	consumeHydratedOpenFabStationProposalReviewEvaluationPreview,
	type HydratedOpenFabStationProposalReviewEvaluationPreview,
} from "../compile/OpenFabStationProposalReviewEvaluationArtifact";
import { ADVANCED_SWITCH_PROFILE_CLASSES } from "../core/AdvancedSwitch";
import {
	applyPortEquipmentMutations,
	copyEquipmentGroupRecord,
	EQ_PORT_PITCHES_MILLIMETERS,
	type EquipmentGroupMutation,
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
import {
	assertPortEquipmentLayoutCooperatively,
	portEquipmentLayoutError,
} from "../core/PortEquipmentLayoutValidator";
import {
	createPortEquipmentMutationPlan,
	createPortEquipmentMutationPlanWithImmutableGraphCertificate,
	createPortEquipmentMutationPlanWithImmutableGraphCertificateCooperatively,
	isCertifiedImmutablePortEquipmentMutationPlanGraph,
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
	type PortEquipmentMutationPlan,
	portEquipmentPlanKindError,
} from "../core/PortEquipmentPlan";
import {
	ADVANCED_SWITCH_ROUTE_ROLES,
	copyPortRecord,
	PORT_DIRECTIONS,
	PORT_RECORD_MAX_ID,
	PORT_RECORD_MAX_OFFSET_MILLIMETERS,
	PORT_RECORD_MAX_STATION_MILLIMETERS,
	PORT_SIDES,
	type PortMutation,
	type PortRecord,
	type PortRouteIdentity,
	portRecordError,
} from "../core/PortRecord";
import type { RailDocument } from "../core/RailDocument";
import {
	railPatchTransitionFingerprint,
	railPatchTransitionFingerprintCooperatively,
} from "../core/RailPatchHistory";
import {
	issueReviewedPortEquipmentApply,
	issueReviewedPortEquipmentApplyCooperatively,
	type ReviewedPortEquipmentApply,
	revokeReviewedPortEquipmentApply,
} from "../core/ReviewedPortEquipmentApplyCertification";
import { ALL_DIRECTIONS, type Direction } from "../core/railShape";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
import {
	type OpenFabStationProposalReviewDraftSnapshot,
	releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer,
} from "./OpenFabStationProposalReviewDraftSoA";
import type { OpenFabStationProposalReviewWorkerTicket } from "./OpenFabStationProposalReviewWorkerProtocol";
import {
	checksumRailMap,
	checksumRailMapCooperatively,
	checksumRailPatchResult,
	checksumRailPatchResultCooperatively,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
	revokeRailMirrorSnapshotCaptureAuthority,
} from "./RailMirrorChecksum";
import { collectTransferableBuffers } from "./TransferableBuffers";

export const OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ARTIFACT_VERSION = 1 as const;
export const OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_PORTS = 100_000;
export const OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_GROUPS = 100_000;
export const OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_BYTES = 4 * 1024 * 1024;
export const OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT = 16;

/** Stable defense-in-depth identity for the fully materialized mutation graph. */
export function openFabStationProposalReviewedPlanFingerprint(
	plan: PortEquipmentMutationPlan,
): string {
	if (!isCertifiedImmutablePortEquipmentMutationPlanGraph(plan)) {
		throw new TypeError("Reviewed plan graph fingerprint requires immutable Worker evidence.");
	}
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_GRAPH_V1",
		plan.kind,
		plan.reason,
		railPatchTransitionFingerprint({
			changes: [],
			switchChanges: [],
			portChanges: plan.portMutations,
			equipmentGroupChanges: plan.equipmentGroupMutations,
			organizationChanges: [],
			organizationNextIdBefore: 0,
			organizationNextIdAfter: 0,
		}),
	]);
	checksum.addNumbers([plan.valid ? 1 : 0, plan.baseRevision, plan.basePatchSequence]);
	return `openfab-station-proposal-reviewed-plan-graph:v1:${checksum.digest()}`;
}

async function openFabStationProposalReviewedPlanFingerprintCooperatively(
	plan: PortEquipmentMutationPlan,
	cooperative: CooperativeController,
): Promise<string> {
	if (!isCertifiedImmutablePortEquipmentMutationPlanGraph(plan)) {
		throw new TypeError("Reviewed plan graph fingerprint requires immutable Worker evidence.");
	}
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_GRAPH_V1",
		plan.kind,
		plan.reason,
		await railPatchTransitionFingerprintCooperatively(
			{
				changes: [],
				switchChanges: [],
				portChanges: plan.portMutations,
				equipmentGroupChanges: plan.equipmentGroupMutations,
				organizationChanges: [],
				organizationNextIdBefore: 0,
				organizationNextIdAfter: 0,
				organizationImpactAuthorizations: [],
			},
			() => cooperative.checkTime(),
			OPERATIONS_PER_TIME_CHECK,
		),
	]);
	checksum.addNumbers([plan.valid ? 1 : 0, plan.baseRevision, plan.basePatchSequence]);
	return `openfab-station-proposal-reviewed-plan-graph:v1:${checksum.digest()}`;
}

/**
 * Consume the proposal, draft, and authoritative mirror captures together and mint one main-realm
 * permit. Any failed attempt still terminally consumes all three supplied authorities.
 */
export function prepareOpenFabStationProposalReviewEvaluationTransfer(
	input: OpenFabStationProposalReviewEvaluationPermitInput,
): PreparedOpenFabStationProposalReviewEvaluationTransfer {
	const { document, proposalFacade, proposalCapture, draftSnapshot, sourceSnapshot } = input;
	const permitInputValid =
		isPositiveSafeInteger(input.generation) &&
		isPositiveSafeInteger(input.evaluationRequestId) &&
		Number.isSafeInteger(nextReviewPermitTicketId);

	let proposalRelease: ReturnType<
		typeof consumeOpenFabStationProposalArtifactCaptureTransfer
	> | null = null;
	let draftRelease: ReturnType<
		typeof releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer
	> | null = null;
	try {
		proposalRelease = consumeOpenFabStationProposalArtifactCaptureTransfer(
			proposalCapture,
			proposalFacade,
		);
	} catch {
		// Continue so every supplied authority is consumed terminally.
	}
	try {
		draftRelease = releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(draftSnapshot);
	} catch {
		// Continue so every supplied authority is consumed terminally.
	}
	let map: TileMap | null = null;
	let portEquipment: PortEquipmentState | null = null;
	let organizations: StaticFabOrganizationState | null = null;
	let patchSequence: number | null = null;
	let snapshotAuthorized = false;
	try {
		map = document.map;
		portEquipment = document.portEquipment;
		organizations = document.organizations;
		patchSequence = document.getPatchSequence();
		snapshotAuthorized = consumeRailMirrorSnapshotCaptureAuthority(
			sourceSnapshot,
			map,
			patchSequence,
			portEquipment,
			organizations,
		);
	} catch {
		revokeRailMirrorSnapshotCaptureAuthority(sourceSnapshot);
	}
	if (
		!permitInputValid ||
		map === null ||
		portEquipment === null ||
		organizations === null ||
		patchSequence === null ||
		!proposalRelease ||
		!draftRelease ||
		!snapshotAuthorized ||
		proposalRelease.artifact.semanticFingerprint !== proposalFacade.semanticFingerprint ||
		proposalRelease.artifact.snapshotFingerprint !== proposalFacade.snapshotFingerprint ||
		draftRelease.snapshot.proposalRowCount !== proposalFacade.rowCount ||
		sourceSnapshot.checksum.length === 0
	) {
		throw new Error("STATION_PROPOSAL_REVIEW_CAPTURE_AUTHORITY_INVALID");
	}
	const transfers = [
		...proposalRelease.transfers,
		...draftRelease.transfers,
		...collectTransferableBuffers(sourceSnapshot),
	];
	assertUniqueTransferBuffers(transfers);

	const permit = Object.freeze({ ticketId: nextReviewPermitTicketId++ });
	pendingReviewPermits.set(
		permit,
		Object.freeze({
			document,
			map,
			portEquipment,
			organizations,
			sourceRevision: map.getRevision(),
			sourcePatchSequence: patchSequence,
			sourceChecksum: sourceSnapshot.checksum,
			sourceNextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			sourceNextPortId: portEquipment.nextPortId,
			sourceNextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			sourceNextOrganizationId: organizations.nextOrganizationId,
			proposalSemanticFingerprint: proposalFacade.semanticFingerprint,
			proposalSnapshotFingerprint: proposalFacade.snapshotFingerprint,
			draftFingerprint: draftRelease.snapshot.fingerprint,
			evaluationRequestId: input.evaluationRequestId,
			generation: input.generation,
			reviewFingerprint: null,
			evaluationSnapshotFingerprint: null,
			applyRequestId: null,
		}),
	);
	return Object.freeze({
		permit,
		proposal: proposalRelease.artifact,
		draft: draftRelease.snapshot,
		snapshot: sourceSnapshot,
		transfers: Object.freeze(transfers),
	});
}

/** Arm one genuine READY preview. Malformed, copied, stale, or non-READY receipts revoke the permit. */
export function armOpenFabStationProposalReviewPermit(
	permit: OpenFabStationProposalReviewPermit,
	preview: HydratedOpenFabStationProposalReviewEvaluationPreview,
	receiptValue: OpenFabStationProposalReviewEvaluationReceipt,
): boolean {
	const source = pendingReviewPermits.get(permit);
	pendingReviewPermits.delete(permit);
	const previewAuthorized = consumeHydratedOpenFabStationProposalReviewEvaluationPreview(preview);
	const receipt = captureMatchedEnumerableOwnDataRecord(receiptValue, [EVALUATION_RECEIPT_KEYS]);
	if (
		!source ||
		!receipt ||
		!previewAuthorized ||
		preview.state !== "READY" ||
		preview.reviewFingerprint === null ||
		receipt.values.evaluationRequestId !== source.evaluationRequestId ||
		receipt.values.generation !== source.generation ||
		receipt.values.ticketId !== permit.ticketId ||
		receipt.values.proposalSemanticFingerprint !== source.proposalSemanticFingerprint ||
		receipt.values.proposalSnapshotFingerprint !== source.proposalSnapshotFingerprint ||
		receipt.values.draftFingerprint !== source.draftFingerprint ||
		receipt.values.sourceChecksum !== source.sourceChecksum ||
		!livePermitSourceMatches(source)
	) {
		return false;
	}
	pendingReviewPermits.set(
		permit,
		Object.freeze({
			...source,
			reviewFingerprint: preview.reviewFingerprint,
			evaluationSnapshotFingerprint: preview.snapshotFingerprint,
		}),
	);
	return true;
}

/** Bind one distinct Apply request before posting it to the retained READY Worker. */
export function authorizeOpenFabStationProposalReviewApply(
	permit: OpenFabStationProposalReviewPermit,
	applyRequestId: number,
	generation: number,
): boolean {
	const source = pendingReviewPermits.get(permit);
	pendingReviewPermits.delete(permit);
	if (
		!source ||
		source.reviewFingerprint === null ||
		source.evaluationSnapshotFingerprint === null ||
		source.applyRequestId !== null ||
		!isPositiveSafeInteger(applyRequestId) ||
		applyRequestId === source.evaluationRequestId ||
		generation !== source.generation ||
		!livePermitSourceMatches(source)
	) {
		return false;
	}
	pendingReviewPermits.set(permit, Object.freeze({ ...source, applyRequestId }));
	return true;
}

export function revokeOpenFabStationProposalReviewPermit(
	permit: OpenFabStationProposalReviewPermit,
): void {
	pendingReviewPermits.delete(permit);
}

/**
 * Terminally consume one adopted plan artifact and its exact main permit, reconstruct and validate
 * the complete prospective layout, then return only an opaque document-consumable Apply handle.
 */
export function materializeOpenFabStationProposalReviewedApply(
	permit: OpenFabStationProposalReviewPermit,
	adopted: AdoptedOpenFabStationProposalReviewedPlanArtifact,
	ticketValue: OpenFabStationProposalReviewWorkerTicket,
	document: RailDocument,
	currentGeneration: number,
): ReviewedPortEquipmentApply {
	return materializeOpenFabStationProposalReviewedApplyMeasured(
		permit,
		adopted,
		ticketValue,
		document,
		currentGeneration,
	).apply;
}

export interface OpenFabStationProposalReviewedApplyMaterializationTimings {
	readonly authorityValidationMilliseconds: number;
	readonly mutationReconstructionMilliseconds: number;
	readonly planValidationMilliseconds: number;
	readonly prospectiveStateMilliseconds: number;
	readonly layoutValidationMilliseconds: number;
	readonly checksumValidationMilliseconds: number;
	readonly applyIssuanceMilliseconds: number;
	readonly totalMilliseconds: number;
}

export interface MeasuredOpenFabStationProposalReviewedApply {
	readonly apply: ReviewedPortEquipmentApply;
	readonly timings: OpenFabStationProposalReviewedApplyMaterializationTimings;
}

/** Synchronous stage baseline retained until each measured 100k Apply stage is partitioned. */
export function materializeOpenFabStationProposalReviewedApplyMeasured(
	permit: OpenFabStationProposalReviewPermit,
	adopted: AdoptedOpenFabStationProposalReviewedPlanArtifact,
	ticketValue: OpenFabStationProposalReviewWorkerTicket,
	document: RailDocument,
	currentGeneration: number,
	now: () => number = () => performance.now(),
): MeasuredOpenFabStationProposalReviewedApply {
	const authority = consumeReviewedApplyMaterializationAuthority(permit, adopted, ticketValue);
	const { source, artifact, ticket } = authority;
	const totalStartedAt = readMaterializationTime(now);
	const authorityValidationStartedAt = totalStartedAt;
	assertReviewedApplyMaterializationAuthority(authority, document, currentGeneration);
	const authorityValidationFinishedAt = readMaterializationTime(now, authorityValidationStartedAt);

	const mutationReconstructionStartedAt = authorityValidationFinishedAt;
	const plan = materializeAdoptedReviewedPlanArtifact(artifact);
	const mutationReconstructionFinishedAt = readMaterializationTime(
		now,
		mutationReconstructionStartedAt,
	);
	const planValidationStartedAt = mutationReconstructionFinishedAt;
	if (
		openFabStationProposalReviewedPlanFingerprint(plan) !== ticket.planFingerprint ||
		portEquipmentPlanKindError(plan) !== null
	) {
		throw new Error("STATION_PROPOSAL_REVIEW_PLAN_MATERIALIZATION_MISMATCH");
	}
	const planValidationFinishedAt = readMaterializationTime(now, planValidationStartedAt);
	let prospective: PortEquipmentState;
	const prospectiveStateStartedAt = planValidationFinishedAt;
	try {
		prospective = applyPortEquipmentMutations(
			source.portEquipment,
			plan.portMutations,
			plan.equipmentGroupMutations,
		);
	} catch {
		throw new Error("STATION_PROPOSAL_REVIEW_PROSPECTIVE_LAYOUT_INVALID");
	}
	const prospectiveStateFinishedAt = readMaterializationTime(now, prospectiveStateStartedAt);
	const layoutValidationStartedAt = prospectiveStateFinishedAt;
	try {
		if (portEquipmentLayoutError(source.map, prospective) !== null) {
			throw new Error("INVALID_LAYOUT");
		}
	} catch {
		throw new Error("STATION_PROPOSAL_REVIEW_PROSPECTIVE_LAYOUT_INVALID");
	}
	const layoutValidationFinishedAt = readMaterializationTime(now, layoutValidationStartedAt);
	const checksumValidationStartedAt = layoutValidationFinishedAt;
	const incrementalChecksum = checksumRailPatchResult(source.sourceChecksum, {
		changes: [],
		switchChanges: [],
		portChanges: plan.portMutations,
		equipmentGroupChanges: plan.equipmentGroupMutations,
		organizationChanges: [],
		organizationNextIdBefore: source.sourceNextOrganizationId,
		organizationNextIdAfter: source.sourceNextOrganizationId,
	});
	const fullChecksum = checksumRailMap(source.map, prospective, source.organizations);
	assertReviewedApplyProspectiveIdentity(authority, prospective, incrementalChecksum, fullChecksum);
	const checksumValidationFinishedAt = readMaterializationTime(now, checksumValidationStartedAt);
	const applyIssuanceStartedAt = checksumValidationFinishedAt;
	let apply: ReviewedPortEquipmentApply | null = null;
	let applyIssuanceFinishedAt: number;
	try {
		apply = issueReviewedPortEquipmentApply(
			plan,
			source.map,
			source.portEquipment,
			source.organizations,
			source.sourcePatchSequence,
		);
		applyIssuanceFinishedAt = readMaterializationTime(now, applyIssuanceStartedAt);
	} catch (error) {
		if (apply) revokeReviewedPortEquipmentApply(apply);
		throw error;
	}
	return Object.freeze({
		apply,
		timings: Object.freeze({
			authorityValidationMilliseconds: authorityValidationFinishedAt - authorityValidationStartedAt,
			mutationReconstructionMilliseconds:
				mutationReconstructionFinishedAt - mutationReconstructionStartedAt,
			planValidationMilliseconds: planValidationFinishedAt - planValidationStartedAt,
			prospectiveStateMilliseconds: prospectiveStateFinishedAt - prospectiveStateStartedAt,
			layoutValidationMilliseconds: layoutValidationFinishedAt - layoutValidationStartedAt,
			checksumValidationMilliseconds: checksumValidationFinishedAt - checksumValidationStartedAt,
			applyIssuanceMilliseconds: applyIssuanceFinishedAt - applyIssuanceStartedAt,
			totalMilliseconds: applyIssuanceFinishedAt - totalStartedAt,
		}),
	});
}

/**
 * Main-realm path for large reviewed plans. Authority is consumed before the first await; every
 * cooperative checkpoint rechecks the exact document generation before work resumes.
 */
export async function materializeOpenFabStationProposalReviewedApplyCooperatively(
	permit: OpenFabStationProposalReviewPermit,
	adopted: AdoptedOpenFabStationProposalReviewedPlanArtifact,
	ticketValue: OpenFabStationProposalReviewWorkerTicket,
	document: RailDocument,
	currentGeneration: number,
	options: OpenFabStationProposalReviewedPlanCooperativeOptions,
): Promise<MeasuredOpenFabStationProposalReviewedApply> {
	const authority = consumeReviewedApplyMaterializationAuthority(permit, adopted, ticketValue);
	const { source, artifact, ticket } = authority;
	const cooperative = resolveCooperativeOptions(options, "ADOPTION_FAILED", () => {
		if (!livePermitSourceMatches(source)) {
			throw new Error("STATION_PROPOSAL_REVIEW_APPLY_IDENTITY_MISMATCH");
		}
	});
	const totalStartedAt = cooperative.readTime();
	const authorityValidationStartedAt = totalStartedAt;
	assertReviewedApplyMaterializationAuthority(authority, document, currentGeneration, false);
	if (
		(await checksumRailMapCooperatively(
			source.map,
			source.portEquipment,
			source.organizations,
			() => cooperative.checkTime(),
			OPERATIONS_PER_TIME_CHECK,
		)) !== source.sourceChecksum
	) {
		throw new Error("STATION_PROPOSAL_REVIEW_APPLY_IDENTITY_MISMATCH");
	}
	const authorityValidationFinishedAt = cooperative.readTime(authorityValidationStartedAt);
	await cooperative.checkpointNow();

	const mutationReconstructionStartedAt = cooperative.readTime(authorityValidationFinishedAt);
	const plan = await materializeAdoptedReviewedPlanArtifactCooperatively(artifact, cooperative);
	const mutationReconstructionFinishedAt = cooperative.readTime(mutationReconstructionStartedAt);
	await cooperative.checkpointNow();

	const planValidationStartedAt = cooperative.readTime(mutationReconstructionFinishedAt);
	if (
		(await openFabStationProposalReviewedPlanFingerprintCooperatively(plan, cooperative)) !==
			ticket.planFingerprint ||
		portEquipmentPlanKindError(plan) !== null
	) {
		throw new Error("STATION_PROPOSAL_REVIEW_PLAN_MATERIALIZATION_MISMATCH");
	}
	const planValidationFinishedAt = cooperative.readTime(planValidationStartedAt);
	await cooperative.checkpointNow();

	let prospective: PortEquipmentState;
	const prospectiveStateStartedAt = cooperative.readTime(planValidationFinishedAt);
	try {
		prospective = await materializeReviewedAdditionProspectiveStateCooperatively(
			source.portEquipment,
			plan,
			cooperative,
		);
	} catch {
		throw new Error("STATION_PROPOSAL_REVIEW_PROSPECTIVE_LAYOUT_INVALID");
	}
	const prospectiveStateFinishedAt = cooperative.readTime(prospectiveStateStartedAt);
	await cooperative.checkpointNow();

	const layoutValidationStartedAt = cooperative.readTime(prospectiveStateFinishedAt);
	try {
		await assertPortEquipmentLayoutCooperatively(
			source.map,
			prospective,
			() => cooperative.checkTime(),
			OPERATIONS_PER_TIME_CHECK,
		);
	} catch {
		throw new Error("STATION_PROPOSAL_REVIEW_PROSPECTIVE_LAYOUT_INVALID");
	}
	const layoutValidationFinishedAt = cooperative.readTime(layoutValidationStartedAt);
	await cooperative.checkpointNow();

	const checksumValidationStartedAt = cooperative.readTime(layoutValidationFinishedAt);
	const incrementalChecksum = await checksumRailPatchResultCooperatively(
		source.sourceChecksum,
		{
			changes: [],
			switchChanges: [],
			portChanges: plan.portMutations,
			equipmentGroupChanges: plan.equipmentGroupMutations,
			organizationChanges: [],
			organizationNextIdBefore: source.sourceNextOrganizationId,
			organizationNextIdAfter: source.sourceNextOrganizationId,
		},
		() => cooperative.checkTime(),
		OPERATIONS_PER_TIME_CHECK,
	);
	const fullChecksum = await checksumRailMapCooperatively(
		source.map,
		prospective,
		source.organizations,
		() => cooperative.checkTime(),
		OPERATIONS_PER_TIME_CHECK,
	);
	assertReviewedApplyProspectiveIdentity(authority, prospective, incrementalChecksum, fullChecksum);
	const checksumValidationFinishedAt = cooperative.readTime(checksumValidationStartedAt);
	await cooperative.checkpointNow();

	const applyIssuanceStartedAt = cooperative.readTime(checksumValidationFinishedAt);
	let apply: ReviewedPortEquipmentApply | null = null;
	let applyIssuanceFinishedAt: number;
	try {
		apply = await issueReviewedPortEquipmentApplyCooperatively(
			plan,
			source.map,
			source.portEquipment,
			source.organizations,
			source.sourcePatchSequence,
			() => cooperative.checkTime(),
		);
		applyIssuanceFinishedAt = cooperative.readTime(applyIssuanceStartedAt);
	} catch (error) {
		if (apply) revokeReviewedPortEquipmentApply(apply);
		throw error;
	}
	return Object.freeze({
		apply,
		timings: createReviewedApplyMaterializationTimings({
			totalStartedAt,
			authorityValidationStartedAt,
			authorityValidationFinishedAt,
			mutationReconstructionStartedAt,
			mutationReconstructionFinishedAt,
			planValidationStartedAt,
			planValidationFinishedAt,
			prospectiveStateStartedAt,
			prospectiveStateFinishedAt,
			layoutValidationStartedAt,
			layoutValidationFinishedAt,
			checksumValidationStartedAt,
			checksumValidationFinishedAt,
			applyIssuanceStartedAt,
			applyIssuanceFinishedAt,
		}),
	});
}

export const OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ERROR_CODES = Object.freeze([
	"INVALID_INPUT",
	"NO_CHANGES",
	"CAPACITY_EXCEEDED",
	"BYTE_LIMIT_EXCEEDED",
	"INVALID_COOPERATIVE_OPTIONS",
	"SOURCE_IDENTITY_MISMATCH",
	"PLAN_STATE_MISMATCH",
	"PLAN_INPUT_NOT_IMMUTABLE",
	"PLAN_NOT_ADDITION_ONLY",
	"PLAN_ID_SEQUENCE_MISMATCH",
	"PLAN_GROUP_MEMBERSHIP_MISMATCH",
	"PLAN_PORT_DERIVATION_MISMATCH",
	"PLAN_GROUP_SPEC_MISMATCH",
	"PLAN_KIND_MISMATCH",
	"ENCODE_FAILED",
	"ADOPTION_FAILED",
	"ARTIFACT_CONTRACT_MISMATCH",
	"ARTIFACT_SCALAR_MISMATCH",
	"ARTIFACT_TYPED_ARRAY_MISMATCH",
	"ARTIFACT_BUFFER_OWNERSHIP_MISMATCH",
	"ARTIFACT_LENGTH_MISMATCH",
	"ARTIFACT_VALUE_MISMATCH",
	"ARTIFACT_CSR_MISMATCH",
	"ARTIFACT_FINGERPRINT_MISMATCH",
] as const);

export type OpenFabStationProposalReviewedPlanErrorCode =
	(typeof OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ERROR_CODES)[number];

/**
 * Exact source-bound input to the compact transport encoder.
 *
 * This artifact is data transport only. It cannot transfer the Worker-realm reviewed-review
 * WeakMap entry or the mixed-batch WeakMap certificate. Main must recheck its live source permit
 * and reissue mixed-plan authority in the main realm after deterministic reconstruction.
 */
export interface OpenFabStationProposalReviewedPlanEncodeInput {
	readonly plan: PortEquipmentMutationPlan;
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly reviewFingerprint: string;
}

export interface OpenFabStationProposalReviewedPlanArtifact {
	readonly kind: "openfab-station-proposal-reviewed-plan-artifact";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ARTIFACT_VERSION;
	readonly planKindCode: number;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly portCount: number;
	readonly groupCount: number;
	readonly byteLength: number;
	readonly reviewFingerprint: string;
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
	readonly sides: Uint8Array;
	readonly lateralOffsetMillimeters: Uint32Array;
	readonly directions: Uint8Array;
	readonly groupSpecCodes: Uint8Array;
	readonly groupPortOffsets: Uint32Array;
	readonly fingerprint: string;
}

export interface OpenFabStationProposalReviewedPlanCooperativeOptions {
	readonly checkpoint: () => Promise<void>;
	/** Monotonic project/session generation. Any change makes this operation terminal. */
	readonly revision: () => number;
	readonly signal?: AbortSignal;
	readonly now?: () => number;
	readonly sliceMilliseconds?: number;
}

/** Opaque private ownership consumed only by release or the exact main-realm permit materializer. */
export interface AdoptedOpenFabStationProposalReviewedPlanArtifact {
	readonly kind: "adopted-openfab-station-proposal-reviewed-plan-artifact";
	readonly version: typeof OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ARTIFACT_VERSION;
	readonly planKindCode: number;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly portCount: number;
	readonly groupCount: number;
	readonly byteLength: number;
	readonly reviewFingerprint: string;
	readonly fingerprint: string;
}

export interface ReleasedOpenFabStationProposalReviewedPlanArtifactTransfer {
	readonly artifact: OpenFabStationProposalReviewedPlanArtifact;
	readonly transfers: readonly ArrayBuffer[];
}

/** Exact main-realm authority retained across one Worker evaluation and explicit Apply. */
export interface OpenFabStationProposalReviewPermit {
	readonly ticketId: number;
}

export interface OpenFabStationProposalReviewEvaluationPermitInput {
	readonly document: RailDocument;
	readonly proposalFacade: HydratedOpenFabStationProposalArtifact;
	readonly proposalCapture: OpenFabStationProposalArtifactCapture;
	readonly draftSnapshot: OpenFabStationProposalReviewDraftSnapshot;
	readonly sourceSnapshot: RailMirrorSnapshot;
	readonly generation: number;
	readonly evaluationRequestId: number;
}

export interface PreparedOpenFabStationProposalReviewEvaluationTransfer {
	readonly permit: OpenFabStationProposalReviewPermit;
	readonly proposal: OpenFabStationProposalArtifact;
	readonly draft: OpenFabStationProposalReviewDraftSnapshot;
	readonly snapshot: RailMirrorSnapshot;
	readonly transfers: readonly ArrayBuffer[];
}

export interface OpenFabStationProposalReviewEvaluationReceipt {
	readonly evaluationRequestId: number;
	readonly generation: number;
	readonly ticketId: number;
	readonly proposalSemanticFingerprint: string;
	readonly proposalSnapshotFingerprint: string;
	readonly draftFingerprint: string;
	readonly sourceChecksum: string;
}

type ArtifactColumns = Pick<
	OpenFabStationProposalReviewedPlanArtifact,
	| "routeKinds"
	| "routeXs"
	| "routeZs"
	| "routeFromDirections"
	| "routeToDirections"
	| "routeSwitchIds"
	| "routeProfileClasses"
	| "routeRoles"
	| "routePortIndices"
	| "routeSegmentOrdinals"
	| "stationMillimeters"
	| "sides"
	| "lateralOffsetMillimeters"
	| "directions"
	| "groupSpecCodes"
	| "groupPortOffsets"
>;

interface CapturedArrayEnvelope {
	readonly source: readonly unknown[];
	readonly count: number;
}

interface CapturedMatchedDataRecord {
	readonly values: Readonly<Record<string, unknown>>;
	readonly matchIndex: number;
}

interface RepresentativeAddition {
	readonly portMutation: PortMutation;
	readonly groupMutation: EquipmentGroupMutation;
}

interface OpenFabStationProposalReviewPermitSource {
	readonly document: RailDocument;
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly sourceRevision: number;
	readonly sourcePatchSequence: number;
	readonly sourceChecksum: string;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly proposalSemanticFingerprint: string;
	readonly proposalSnapshotFingerprint: string;
	readonly draftFingerprint: string;
	readonly evaluationRequestId: number;
	readonly generation: number;
	readonly reviewFingerprint: string | null;
	readonly evaluationSnapshotFingerprint: string | null;
	readonly applyRequestId: number | null;
}

interface ConsumedReviewedApplyMaterializationAuthority {
	readonly source: OpenFabStationProposalReviewPermitSource;
	readonly artifact: OpenFabStationProposalReviewedPlanArtifact;
	readonly ticket: Readonly<Record<string, unknown>>;
	readonly permit: OpenFabStationProposalReviewPermit;
}

const ARTIFACT_KIND = "openfab-station-proposal-reviewed-plan-artifact" as const;
const ADOPTED_KIND = "adopted-openfab-station-proposal-reviewed-plan-artifact" as const;
const FINGERPRINT_DOMAIN = "openfab-station-proposal-reviewed-plan:v1";
const REVIEW_FINGERPRINT_PATTERN = /^openfab-station-proposal-review:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const FINGERPRINT_PATTERN = /^openfab-station-proposal-reviewed-plan:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const PLAN_GRAPH_FINGERPRINT_PATTERN =
	/^openfab-station-proposal-reviewed-plan-graph:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const EVALUATION_SNAPSHOT_FINGERPRINT_PATTERN =
	/^openfab-station-proposal-review-evaluation-snapshot:v1:[0-9a-f]{8}:[0-9a-f]{8}$/;
const RAIL_CHECKSUM_PATTERN = /^(?:[0-9a-f]{8}:){8}[0-9a-f]{8}$/;
const READY_PLAN_REASON =
	"Port/equipment mutations are structurally ready for document validation.";
const DEFAULT_SLICE_MILLISECONDS = 4;
const MAX_SLICE_MILLISECONDS = 4;
const OPERATIONS_PER_TIME_CHECK = 128;
const CHECKSUM_BYTES_PER_TIME_CHECK = 64 * 1024;
const MIN_INT32 = -0x8000_0000;
const MAX_INT32 = 0x7fff_ffff;
const MAX_UINT16 = 0xffff;

const PLAN_KINDS = Object.freeze([
	"place-ohb",
	"place-eq",
	"place-stk",
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
] as const);
const GROUP_SPEC_CODES = Object.freeze([
	"OHB_SINGLE",
	"EQ_1000",
	"EQ_2000",
	"EQ_3000",
	"EQ_4000",
	"EQ_5000",
	"STK_FLEX",
	"STK_FOUR_PORT",
	"STK_SIX_PORT",
	"STK_BACK_TO_BACK",
] as const);
const ROUTE_ENDS = Object.freeze([0, ...ALL_DIRECTIONS] as const);

const INPUT_KEYS = Object.freeze([
	"plan",
	"sourceRevision",
	"sourcePatchSequence",
	"sourceNextPortId",
	"sourceNextEquipmentGroupId",
	"reviewFingerprint",
] as const);
const EVALUATION_RECEIPT_KEYS = Object.freeze([
	"evaluationRequestId",
	"generation",
	"ticketId",
	"proposalSemanticFingerprint",
	"proposalSnapshotFingerprint",
	"draftFingerprint",
	"sourceChecksum",
] as const);
const WORKER_TICKET_KEYS = Object.freeze([
	"ticketId",
	"evaluationRequestId",
	"applyRequestId",
	"validationLevel",
	"requestGeneration",
	"sourceRevision",
	"sourcePatchSequence",
	"sourceChecksum",
	"sourceNextAdvancedSwitchId",
	"sourceNextPortId",
	"sourceNextEquipmentGroupId",
	"sourceNextOrganizationId",
	"proposalSemanticFingerprint",
	"proposalSnapshotFingerprint",
	"draftFingerprint",
	"evaluationSnapshotFingerprint",
	"reviewFingerprint",
	"planArtifactFingerprint",
	"planFingerprint",
	"planKindCode",
	"portCount",
	"groupCount",
	"prospectiveChecksum",
	"prospectiveNextAdvancedSwitchId",
	"prospectiveNextPortId",
	"prospectiveNextEquipmentGroupId",
	"prospectiveNextOrganizationId",
] as const);
const PLAN_KEYS = Object.freeze([
	"kind",
	"valid",
	"reason",
	"baseRevision",
	"basePatchSequence",
	"portMutations",
	"equipmentGroupMutations",
] as const);
const MUTATION_KEYS = Object.freeze(["id", "before", "after"] as const);
const PORT_KEYS = Object.freeze([
	"id",
	"equipmentGroupId",
	"route",
	"stationMillimeters",
	"side",
	"lateralOffsetMillimeters",
	"direction",
	"portType",
	"barcode",
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
const OHB_GROUP_KEYS = Object.freeze(["id", "kind", "template", "portIds"] as const);
const EQ_GROUP_KEYS = Object.freeze([
	"id",
	"kind",
	"pitchMillimeters",
	"recipe",
	"portIds",
] as const);
const STK_GROUP_KEYS = OHB_GROUP_KEYS;
const ARTIFACT_KEYS = Object.freeze([
	"kind",
	"version",
	"planKindCode",
	"baseRevision",
	"basePatchSequence",
	"sourceNextPortId",
	"sourceNextEquipmentGroupId",
	"portCount",
	"groupCount",
	"byteLength",
	"reviewFingerprint",
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
	"sides",
	"lateralOffsetMillimeters",
	"directions",
	"groupSpecCodes",
	"groupPortOffsets",
	"fingerprint",
] as const);

const ARRAY_BUFFER_SLICE = ArrayBuffer.prototype.slice;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = intrinsicGetter(ArrayBuffer.prototype, "byteLength");
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"resizable",
)?.get;
const ABORT_SIGNAL_ABORTED_GETTER = intrinsicGetter(AbortSignal.prototype, "aborted");
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, "buffer");
const TYPED_ARRAY_BYTE_OFFSET_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, "byteOffset");
const TYPED_ARRAY_BYTE_LENGTH_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, "byteLength");
const TYPED_ARRAY_LENGTH_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, "length");
const TYPED_ARRAY_CRITICAL_KEYS = Object.freeze([
	"buffer",
	"byteOffset",
	"byteLength",
	"length",
	Symbol.iterator,
] as const);

const adoptedArtifacts = new WeakMap<
	AdoptedOpenFabStationProposalReviewedPlanArtifact,
	OpenFabStationProposalReviewedPlanArtifact
>();
const freshlyEncodedArtifacts = new WeakSet<OpenFabStationProposalReviewedPlanArtifact>();
const pendingReviewPermits = new WeakMap<
	OpenFabStationProposalReviewPermit,
	OpenFabStationProposalReviewPermitSource
>();
let nextReviewPermitTicketId = 1;
const internallyMintedErrorCodes = new WeakMap<
	object,
	OpenFabStationProposalReviewedPlanErrorCode
>();
const internallyMintedAbortErrors = new WeakSet<object>();

/**
 * Prove that a reviewed addition-only plan is exactly reconstructable, then encode only the
 * non-derivable route/group fields into 16 independently owned transferable buffers.
 */
export async function encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
	inputValue: OpenFabStationProposalReviewedPlanEncodeInput,
	options: OpenFabStationProposalReviewedPlanCooperativeOptions,
): Promise<OpenFabStationProposalReviewedPlanArtifact> {
	try {
		const cooperative = resolveCooperativeOptions(options, "ENCODE_FAILED");
		cooperative.throwIfAborted();
		const input = captureMatchedEnumerableOwnDataRecord(inputValue, [INPUT_KEYS]);
		if (input === null) throw fixedError("INVALID_INPUT");
		const values = input.values;
		const planValue = values.plan;
		const planCapture = captureMatchedEnumerableOwnDataRecord(planValue, [PLAN_KEYS]);
		if (planCapture === null) throw fixedError("INVALID_INPUT");
		const plan = planCapture.values;
		const sourceRevision = requireNonnegativeSafeInteger(values.sourceRevision);
		const sourcePatchSequence = requireNonnegativeSafeInteger(values.sourcePatchSequence);
		const sourceNextPortId = requireAllocatableId(values.sourceNextPortId);
		const sourceNextEquipmentGroupId = requireAllocatableId(values.sourceNextEquipmentGroupId);
		const reviewFingerprint = values.reviewFingerprint;
		if (
			typeof reviewFingerprint !== "string" ||
			!REVIEW_FINGERPRINT_PATTERN.test(reviewFingerprint)
		) {
			throw fixedError("INVALID_INPUT");
		}
		if (plan.baseRevision !== sourceRevision || plan.basePatchSequence !== sourcePatchSequence) {
			throw fixedError("SOURCE_IDENTITY_MISMATCH");
		}
		const planKindCode = encodeEnum(PLAN_KINDS, plan.kind, "PLAN_KIND_MISMATCH");
		const portEnvelope = captureBoundedArrayEnvelope(
			plan.portMutations,
			OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_PORTS,
		);
		const groupEnvelope = captureBoundedArrayEnvelope(
			plan.equipmentGroupMutations,
			OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_GROUPS,
		);
		if (portEnvelope.count === 0 && groupEnvelope.count === 0) throw fixedError("NO_CHANGES");
		if (plan.valid !== true || plan.reason !== READY_PLAN_REASON) {
			throw fixedError("PLAN_STATE_MISMATCH");
		}
		if (
			portEnvelope.count === 0 ||
			groupEnvelope.count === 0 ||
			groupEnvelope.count > portEnvelope.count
		) {
			throw fixedError("PLAN_GROUP_MEMBERSHIP_MISMATCH");
		}
		assertContiguousIdCapacity(sourceNextPortId, portEnvelope.count);
		assertContiguousIdCapacity(sourceNextEquipmentGroupId, groupEnvelope.count);
		const byteLength = artifactByteLength(portEnvelope.count, groupEnvelope.count);
		if (byteLength > OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_BYTES) {
			throw fixedError("BYTE_LIMIT_EXCEEDED");
		}
		if (
			!isCertifiedImmutablePortEquipmentMutationPlanGraph(planValue as PortEquipmentMutationPlan)
		) {
			throw fixedError("PLAN_INPUT_NOT_IMMUTABLE");
		}

		const columns = allocateColumns(portEnvelope.count, groupEnvelope.count);
		const representatives = new Map<EquipmentGroupRecord["kind"], RepresentativeAddition>();
		let globalPortIndex = 0;
		columns.groupPortOffsets[0] = 0;
		for (let groupIndex = 0; groupIndex < groupEnvelope.count; groupIndex++) {
			const expectedGroupId = sourceNextEquipmentGroupId + groupIndex;
			const capturedGroup = captureAdditionMutation(
				capturedArrayElementValue(groupEnvelope.source, groupIndex),
				"group",
			);
			if (capturedGroup.id !== expectedGroupId) throw fixedError("PLAN_ID_SEQUENCE_MISMATCH");
			const groupRecord = captureEquipmentGroupRecord(capturedGroup.after, expectedGroupId);
			const memberEnvelope = groupRecord.memberEnvelope;
			if (
				memberEnvelope.count === 0 ||
				memberEnvelope.count > portEnvelope.count - globalPortIndex
			) {
				throw fixedError("PLAN_GROUP_MEMBERSHIP_MISMATCH");
			}
			columns.groupSpecCodes[groupIndex] = groupRecord.specCode;
			const ports: PortRecord[] = new Array(memberEnvelope.count);
			const portIds: number[] = new Array(memberEnvelope.count);
			let representativePort: PortMutation | null = null;
			for (let memberIndex = 0; memberIndex < memberEnvelope.count; memberIndex++) {
				const expectedPortId = sourceNextPortId + globalPortIndex;
				const declaredPortId = capturedArrayElementValue(memberEnvelope.source, memberIndex);
				if (declaredPortId !== expectedPortId) {
					throw fixedError("PLAN_GROUP_MEMBERSHIP_MISMATCH");
				}
				const capturedPort = captureAdditionMutation(
					capturedArrayElementValue(portEnvelope.source, globalPortIndex),
					"port",
				);
				if (capturedPort.id !== expectedPortId) throw fixedError("PLAN_ID_SEQUENCE_MISMATCH");
				const port = captureAndEncodePortRecord(
					capturedPort.after,
					expectedPortId,
					expectedGroupId,
					groupRecord.kind,
					memberIndex,
					columns,
					globalPortIndex,
				);
				ports[memberIndex] = port;
				portIds[memberIndex] = expectedPortId;
				representativePort ??= Object.freeze({ id: expectedPortId, before: null, after: port });
				globalPortIndex++;
				if (cooperative.noteOperation()) await cooperative.checkTime();
			}
			const safeGroup = groupRecord.createRecord(Object.freeze(portIds));
			if (equipmentGroupError(safeGroup) !== null) throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
			let canonicalIds: readonly number[];
			try {
				canonicalIds = canonicalEquipmentGroupPortIds(
					groupRecord.kind === "STK"
						? { kind: "STK", template: groupRecord.template as StkAuthoringTemplate }
						: { kind: groupRecord.kind },
					portIds,
					ports,
				);
			} catch {
				throw fixedError("PLAN_GROUP_MEMBERSHIP_MISMATCH");
			}
			if (!sameNumbers(canonicalIds, portIds)) {
				throw fixedError("PLAN_GROUP_MEMBERSHIP_MISMATCH");
			}
			if (representativePort !== null && !representatives.has(groupRecord.kind)) {
				representatives.set(
					groupRecord.kind,
					Object.freeze({
						portMutation: representativePort,
						groupMutation: Object.freeze({ id: expectedGroupId, before: null, after: safeGroup }),
					}),
				);
			}
			columns.groupPortOffsets[groupIndex + 1] = globalPortIndex;
			if (cooperative.noteOperation()) await cooperative.checkTime();
		}
		if (globalPortIndex !== portEnvelope.count) {
			throw fixedError("PLAN_GROUP_MEMBERSHIP_MISMATCH");
		}
		const derivedPlanKind = derivePlanKindFromRepresentatives(representatives);
		if (plan.kind !== derivedPlanKind || planKindCode !== encodeEnum(PLAN_KINDS, derivedPlanKind)) {
			throw fixedError("PLAN_KIND_MISMATCH");
		}
		const representativePlan = createPortEquipmentMutationPlan(
			derivedPlanKind,
			sourceRevision,
			sourcePatchSequence,
			[...representatives.values()].map((value) => value.portMutation),
			[...representatives.values()].map((value) => value.groupMutation),
		);
		if (portEquipmentPlanKindError(representativePlan) !== null) {
			throw fixedError("PLAN_KIND_MISMATCH");
		}

		const base = {
			kind: ARTIFACT_KIND,
			version: OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ARTIFACT_VERSION,
			planKindCode,
			baseRevision: sourceRevision,
			basePatchSequence: sourcePatchSequence,
			sourceNextPortId,
			sourceNextEquipmentGroupId,
			portCount: portEnvelope.count,
			groupCount: groupEnvelope.count,
			byteLength,
			reviewFingerprint,
			...columns,
		};
		const fingerprint = await fingerprintCooperatively(base, cooperative);
		await cooperative.checkTime();
		cooperative.throwIfAborted();
		const artifact = Object.freeze({ ...base, fingerprint });
		const shallowError = capturedArtifactShallowShapeError(artifact);
		if (shallowError) throw fixedError(shallowError);
		freshlyEncodedArtifacts.add(artifact);
		return artifact;
	} catch (error) {
		throw normalizeOperationError(error, "ENCODE_FAILED");
	}
}

/** One-shot O(column-count) release for this cooperative encoder's exact artifact identity. */
export function releaseEncodedOpenFabStationProposalReviewedPlanArtifactTransfer(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): ReleasedOpenFabStationProposalReviewedPlanArtifactTransfer {
	if (!freshlyEncodedArtifacts.has(artifact)) throw fixedError("ARTIFACT_CONTRACT_MISMATCH");
	freshlyEncodedArtifacts.delete(artifact);
	return Object.freeze({
		artifact,
		transfers: Object.freeze(artifactTransferBuffersUnchecked(artifact)),
	});
}

/** Strict scalar, typed-array, ownership, and exact-length validation without value scans. */
export function openFabStationProposalReviewedPlanArtifactShallowShapeError(
	value: unknown,
): OpenFabStationProposalReviewedPlanErrorCode | null {
	const artifact = captureArtifactIdentity(value);
	return artifact === null
		? "ARTIFACT_CONTRACT_MISMATCH"
		: capturedArtifactShallowShapeError(artifact);
}

/** Full canonical route/group/CSR/fingerprint validation. */
export function openFabStationProposalReviewedPlanArtifactShapeError(
	value: unknown,
): OpenFabStationProposalReviewedPlanErrorCode | null {
	const artifact = captureArtifactIdentity(value);
	if (artifact === null) return "ARTIFACT_CONTRACT_MISMATCH";
	return capturedArtifactShapeError(artifact);
}

/** Diagnostic validation only; stable use requires adoption. */
export function validateOpenFabStationProposalReviewedPlanArtifact(value: unknown): void {
	validatedArtifactIdentity(value);
}

/** Synchronous compatibility transfer collector; maximum payloads should use adoption/release. */
export function collectOpenFabStationProposalReviewedPlanArtifactTransfers(
	value: unknown,
): ArrayBuffer[] {
	return artifactTransferBuffersUnchecked(validatedArtifactIdentity(value));
}

/** Synchronous Worker-side adoption. Main-thread maximum payloads should use the cooperative API. */
export function adoptOpenFabStationProposalReviewedPlanArtifact(
	value: unknown,
): AdoptedOpenFabStationProposalReviewedPlanArtifact {
	try {
		const artifact = validatedArtifactIdentity(value);
		freshlyEncodedArtifacts.delete(artifact);
		return createAdoptedHandle(transferArtifactToPrivateIdentity(artifact));
	} catch (error) {
		throw normalizeOperationError(error, "ADOPTION_FAILED");
	}
}

/**
 * Preferred main-thread boundary: capture one outer identity, shallow-check it, consume its 16
 * buffers, and only then perform canonical and checksum scans cooperatively on private ownership.
 */
export async function adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(
	value: unknown,
	options: OpenFabStationProposalReviewedPlanCooperativeOptions,
): Promise<AdoptedOpenFabStationProposalReviewedPlanArtifact> {
	try {
		const cooperative = resolveCooperativeOptions(options, "ADOPTION_FAILED");
		cooperative.throwIfAborted();
		const artifact = captureArtifactIdentity(value);
		if (artifact === null) throw fixedError("ARTIFACT_CONTRACT_MISMATCH");
		freshlyEncodedArtifacts.delete(artifact);
		const shallowError = capturedArtifactShallowShapeError(artifact);
		if (shallowError) throw fixedError(shallowError);
		cooperative.throwIfAborted();
		const privateArtifact = transferArtifactToPrivateIdentity(artifact);
		await cooperative.checkpointNow();
		const semanticError = await capturedArtifactValueErrorCooperatively(
			privateArtifact,
			cooperative,
		);
		if (semanticError) throw fixedError(semanticError);
		await cooperative.checkpointNow();
		cooperative.throwIfAborted();
		return createAdoptedHandle(privateArtifact);
	} catch (error) {
		throw normalizeOperationError(error, "ADOPTION_FAILED");
	}
}

/** One-shot release for immediate postMessage transfer. */
export function releaseAdoptedOpenFabStationProposalReviewedPlanArtifactTransfer(
	handle: AdoptedOpenFabStationProposalReviewedPlanArtifact,
): ReleasedOpenFabStationProposalReviewedPlanArtifactTransfer {
	const artifact = adoptedArtifacts.get(handle);
	if (!artifact) throw fixedError("ARTIFACT_CONTRACT_MISMATCH");
	adoptedArtifacts.delete(handle);
	return Object.freeze({
		artifact,
		transfers: Object.freeze(artifactTransferBuffersUnchecked(artifact)),
	});
}

export function revokeAdoptedOpenFabStationProposalReviewedPlanArtifact(
	handle: AdoptedOpenFabStationProposalReviewedPlanArtifact,
): void {
	adoptedArtifacts.delete(handle);
}

function materializeAdoptedReviewedPlanArtifact(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): PortEquipmentMutationPlan {
	const planKind = PLAN_KINDS[artifact.planKindCode - 1];
	if (!planKind) throw new Error("STATION_PROPOSAL_REVIEW_PLAN_KIND_INVALID");
	const portMutations: PortMutation[] = new Array(artifact.portCount);
	const groupMutations: EquipmentGroupMutation[] = new Array(artifact.groupCount);
	for (let groupIndex = 0; groupIndex < artifact.groupCount; groupIndex++) {
		const groupId = artifact.sourceNextEquipmentGroupId + groupIndex;
		const start = artifact.groupPortOffsets[groupIndex] as number;
		const end = artifact.groupPortOffsets[groupIndex + 1] as number;
		const spec = tryDecodeGroupSpec(artifact.groupSpecCodes[groupIndex] as number);
		if (!spec) throw new Error("STATION_PROPOSAL_REVIEW_GROUP_SPEC_INVALID");
		const ports: PortRecord[] = [];
		const portIds: number[] = [];
		for (let portIndex = start; portIndex < end; portIndex++) {
			const portId = artifact.sourceNextPortId + portIndex;
			const port = copyPortRecord(
				reconstructPortRecord(artifact, portIndex, portId, groupId, spec.kind, portIndex - start),
			);
			ports.push(port);
			portIds.push(portId);
			portMutations[portIndex] = Object.freeze({ id: portId, before: null, after: port });
		}
		const group = copyEquipmentGroupRecord(createGroupRecordFromSpec(spec, groupId, portIds));
		const canonicalPortIds = canonicalEquipmentGroupPortIds(
			spec.kind === "STK" ? { kind: "STK", template: spec.template } : { kind: spec.kind },
			portIds,
			ports,
		);
		if (!sameNumbers(canonicalPortIds, portIds)) {
			throw new Error("STATION_PROPOSAL_REVIEW_GROUP_ORDER_INVALID");
		}
		groupMutations[groupIndex] = Object.freeze({ id: groupId, before: null, after: group });
	}
	if (portMutations.some((mutation) => mutation === undefined)) {
		throw new Error("STATION_PROPOSAL_REVIEW_PORT_CSR_INVALID");
	}
	return createPortEquipmentMutationPlanWithImmutableGraphCertificate(
		planKind,
		artifact.baseRevision,
		artifact.basePatchSequence,
		portMutations,
		groupMutations,
	);
}

async function materializeAdoptedReviewedPlanArtifactCooperatively(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
	cooperative: CooperativeController,
): Promise<PortEquipmentMutationPlan> {
	const planKind = PLAN_KINDS[artifact.planKindCode - 1];
	if (!planKind) throw new Error("STATION_PROPOSAL_REVIEW_PLAN_KIND_INVALID");
	const portMutations: PortMutation[] = new Array(artifact.portCount);
	const groupMutations: EquipmentGroupMutation[] = new Array(artifact.groupCount);
	let materializedPortCount = 0;
	for (let groupIndex = 0; groupIndex < artifact.groupCount; groupIndex++) {
		const groupId = artifact.sourceNextEquipmentGroupId + groupIndex;
		const start = artifact.groupPortOffsets[groupIndex] as number;
		const end = artifact.groupPortOffsets[groupIndex + 1] as number;
		const spec = tryDecodeGroupSpec(artifact.groupSpecCodes[groupIndex] as number);
		if (!spec) throw new Error("STATION_PROPOSAL_REVIEW_GROUP_SPEC_INVALID");
		const ports: PortRecord[] = [];
		const portIds: number[] = [];
		for (let portIndex = start; portIndex < end; portIndex++) {
			const portId = artifact.sourceNextPortId + portIndex;
			const port = copyPortRecord(
				reconstructPortRecord(artifact, portIndex, portId, groupId, spec.kind, portIndex - start),
			);
			ports.push(port);
			portIds.push(portId);
			portMutations[portIndex] = Object.freeze({ id: portId, before: null, after: port });
			materializedPortCount++;
			if (cooperative.noteOperation()) await cooperative.checkTime();
		}
		const group = copyEquipmentGroupRecord(createGroupRecordFromSpec(spec, groupId, portIds));
		const canonicalPortIds = canonicalEquipmentGroupPortIds(
			spec.kind === "STK" ? { kind: "STK", template: spec.template } : { kind: spec.kind },
			portIds,
			ports,
		);
		if (!sameNumbers(canonicalPortIds, portIds)) {
			throw new Error("STATION_PROPOSAL_REVIEW_GROUP_ORDER_INVALID");
		}
		groupMutations[groupIndex] = Object.freeze({ id: groupId, before: null, after: group });
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	if (materializedPortCount !== artifact.portCount) {
		throw new Error("STATION_PROPOSAL_REVIEW_PORT_CSR_INVALID");
	}
	return createPortEquipmentMutationPlanWithImmutableGraphCertificateCooperatively(
		planKind,
		artifact.baseRevision,
		artifact.basePatchSequence,
		portMutations,
		groupMutations,
		() => cooperative.checkTime(),
		OPERATIONS_PER_TIME_CHECK,
	);
}

async function materializeReviewedAdditionProspectiveStateCooperatively(
	current: PortEquipmentState,
	plan: PortEquipmentMutationPlan,
	cooperative: CooperativeController,
): Promise<PortEquipmentState> {
	const ports = new Array<PortRecord>(current.ports.length + plan.portMutations.length);
	for (let index = 0; index < current.ports.length; index++) {
		ports[index] = current.ports[index] as PortRecord;
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	for (let index = 0; index < plan.portMutations.length; index++) {
		const mutation = plan.portMutations[index] as PortMutation;
		if (mutation.before !== null || mutation.after === null) {
			throw new Error("STATION_PROPOSAL_REVIEW_PLAN_NOT_ADDITION_ONLY");
		}
		ports[current.ports.length + index] = mutation.after;
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	const equipmentGroups = new Array<EquipmentGroupRecord>(
		current.equipmentGroups.length + plan.equipmentGroupMutations.length,
	);
	for (let index = 0; index < current.equipmentGroups.length; index++) {
		equipmentGroups[index] = current.equipmentGroups[index] as EquipmentGroupRecord;
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	for (let index = 0; index < plan.equipmentGroupMutations.length; index++) {
		const mutation = plan.equipmentGroupMutations[index] as EquipmentGroupMutation;
		if (mutation.before !== null || mutation.after === null) {
			throw new Error("STATION_PROPOSAL_REVIEW_PLAN_NOT_ADDITION_ONLY");
		}
		equipmentGroups[current.equipmentGroups.length + index] = mutation.after;
		if (cooperative.noteOperation()) await cooperative.checkTime();
	}
	return Object.freeze({
		nextPortId: current.nextPortId + plan.portMutations.length,
		nextEquipmentGroupId: current.nextEquipmentGroupId + plan.equipmentGroupMutations.length,
		ports: Object.freeze(ports),
		equipmentGroups: Object.freeze(equipmentGroups),
	});
}

function validatedArtifactIdentity(value: unknown): OpenFabStationProposalReviewedPlanArtifact {
	const artifact = captureArtifactIdentity(value);
	if (artifact === null) throw fixedError("ARTIFACT_CONTRACT_MISMATCH");
	const error = capturedArtifactShapeError(artifact);
	if (error) throw fixedError(error);
	return artifact;
}

function createAdoptedHandle(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): AdoptedOpenFabStationProposalReviewedPlanArtifact {
	const handle = Object.freeze({
		kind: ADOPTED_KIND,
		version: artifact.version,
		planKindCode: artifact.planKindCode,
		baseRevision: artifact.baseRevision,
		basePatchSequence: artifact.basePatchSequence,
		sourceNextPortId: artifact.sourceNextPortId,
		sourceNextEquipmentGroupId: artifact.sourceNextEquipmentGroupId,
		portCount: artifact.portCount,
		groupCount: artifact.groupCount,
		byteLength: artifact.byteLength,
		reviewFingerprint: artifact.reviewFingerprint,
		fingerprint: artifact.fingerprint,
	});
	adoptedArtifacts.set(handle, artifact);
	return handle;
}

function transferArtifactToPrivateIdentity(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): OpenFabStationProposalReviewedPlanArtifact {
	let transferred: unknown;
	try {
		transferred = structuredClone(artifact, {
			transfer: artifactTransferBuffersUnchecked(artifact),
		});
	} catch {
		throw fixedError("ADOPTION_FAILED");
	}
	const privateArtifact = captureArtifactIdentity(transferred);
	if (privateArtifact === null) throw fixedError("ADOPTION_FAILED");
	const shallowError = capturedArtifactShallowShapeError(privateArtifact);
	if (shallowError) throw fixedError(shallowError);
	return privateArtifact;
}

interface CapturedAdditionMutation {
	readonly id: number;
	readonly after: unknown;
}

interface CapturedEquipmentGroupRecord {
	readonly kind: EquipmentGroupRecord["kind"];
	readonly specCode: number;
	readonly template: "SINGLE" | StkAuthoringTemplate | null;
	readonly memberEnvelope: CapturedArrayEnvelope;
	createRecord(portIds: readonly number[]): EquipmentGroupRecord;
}

function captureAdditionMutation(
	value: unknown,
	label: "port" | "group",
): CapturedAdditionMutation {
	const captured = captureMatchedEnumerableOwnDataRecord(value, [MUTATION_KEYS]);
	if (captured === null) throw fixedError("INVALID_INPUT");
	const id = captured.values.id;
	if (!isPositiveId(id)) throw fixedError("PLAN_ID_SEQUENCE_MISMATCH");
	if (captured.values.before !== null || captured.values.after === null) {
		throw fixedError("PLAN_NOT_ADDITION_ONLY");
	}
	if (label === "port" && typeof captured.values.after !== "object") {
		throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
	}
	if (label === "group" && typeof captured.values.after !== "object") {
		throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
	}
	return Object.freeze({ id, after: captured.values.after });
}

function captureEquipmentGroupRecord(
	value: unknown,
	expectedId: number,
): CapturedEquipmentGroupRecord {
	const captured = captureMatchedEnumerableOwnDataRecord(value, [
		OHB_GROUP_KEYS,
		EQ_GROUP_KEYS,
		STK_GROUP_KEYS,
	]);
	if (captured === null) throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
	const values = captured.values;
	if (values.id !== expectedId) throw fixedError("PLAN_ID_SEQUENCE_MISMATCH");
	if (values.kind === "OHB") {
		if (captured.matchIndex !== 0 || values.template !== "SINGLE") {
			throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
		}
		const memberEnvelope = captureBoundedArrayEnvelope(
			values.portIds,
			OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_PORTS,
		);
		if (memberEnvelope.count !== 1) throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
		return Object.freeze({
			kind: "OHB" as const,
			specCode: encodeEnum(GROUP_SPEC_CODES, "OHB_SINGLE"),
			template: "SINGLE" as const,
			memberEnvelope,
			createRecord: (portIds: readonly number[]) =>
				Object.freeze({
					id: expectedId,
					kind: "OHB" as const,
					template: "SINGLE" as const,
					portIds,
				}),
		});
	}
	if (values.kind === "EQ") {
		if (
			captured.matchIndex !== 1 ||
			values.recipe !== null ||
			!EQ_PORT_PITCHES_MILLIMETERS.includes(values.pitchMillimeters as number)
		) {
			throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
		}
		const memberEnvelope = captureBoundedArrayEnvelope(
			values.portIds,
			OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_PORTS,
		);
		if (memberEnvelope.count < 2 || memberEnvelope.count > 64) {
			throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
		}
		const pitchMillimeters = values.pitchMillimeters as number;
		return Object.freeze({
			kind: "EQ" as const,
			specCode: encodeEnum(GROUP_SPEC_CODES, `EQ_${pitchMillimeters}`),
			template: null,
			memberEnvelope,
			createRecord: (portIds: readonly number[]) =>
				Object.freeze({
					id: expectedId,
					kind: "EQ" as const,
					pitchMillimeters,
					recipe: null,
					portIds,
				}),
		});
	}
	if (
		values.kind !== "STK" ||
		captured.matchIndex !== 0 ||
		!STK_AUTHORING_TEMPLATES.includes(values.template as StkAuthoringTemplate)
	) {
		throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
	}
	const template = values.template as StkAuthoringTemplate;
	const memberEnvelope = captureBoundedArrayEnvelope(
		values.portIds,
		OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_PORTS,
	);
	if (
		memberEnvelope.count < 1 ||
		memberEnvelope.count > 16 ||
		(template === "FOUR_PORT" && memberEnvelope.count !== 4) ||
		(template === "SIX_PORT" && memberEnvelope.count !== 6) ||
		(template === "BACK_TO_BACK" && (memberEnvelope.count < 4 || memberEnvelope.count % 2 !== 0))
	) {
		throw fixedError("PLAN_GROUP_SPEC_MISMATCH");
	}
	return Object.freeze({
		kind: "STK" as const,
		specCode: encodeEnum(GROUP_SPEC_CODES, `STK_${template}`),
		template,
		memberEnvelope,
		createRecord: (portIds: readonly number[]) =>
			Object.freeze({ id: expectedId, kind: "STK" as const, template, portIds }),
	});
}

function captureAndEncodePortRecord(
	value: unknown,
	expectedPortId: number,
	expectedGroupId: number,
	expectedKind: EquipmentGroupRecord["kind"],
	memberIndex: number,
	columns: ArtifactColumns,
	columnIndex: number,
): PortRecord {
	const captured = captureMatchedEnumerableOwnDataRecord(value, [PORT_KEYS]);
	if (captured === null) throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
	const values = captured.values;
	if (values.id !== expectedPortId) throw fixedError("PLAN_ID_SEQUENCE_MISMATCH");
	if (values.equipmentGroupId !== expectedGroupId || values.portType !== expectedKind) {
		throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
	}
	const route = captureAndEncodeRoute(values.route, columns, columnIndex);
	const stationMillimeters = values.stationMillimeters;
	const lateralOffsetMillimeters = values.lateralOffsetMillimeters;
	if (!isInt32(stationMillimeters) || !isNonnegativeUint32(lateralOffsetMillimeters)) {
		throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
	}
	const sideCode = encodeEnum(PORT_SIDES, values.side, "PLAN_PORT_DERIVATION_MISMATCH");
	const directionCode = encodeEnum(
		PORT_DIRECTIONS,
		values.direction,
		"PLAN_PORT_DERIVATION_MISMATCH",
	);
	const expectedBarcode = equipmentGroupPortBarcode(
		expectedKind,
		expectedGroupId,
		expectedPortId,
		memberIndex,
	);
	if (values.barcode !== expectedBarcode) throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
	const port: PortRecord = Object.freeze({
		id: expectedPortId,
		equipmentGroupId: expectedGroupId,
		route,
		stationMillimeters,
		side: PORT_SIDES[sideCode - 1] as PortRecord["side"],
		lateralOffsetMillimeters,
		direction: PORT_DIRECTIONS[directionCode - 1] as PortRecord["direction"],
		portType: expectedKind,
		barcode: expectedBarcode,
	});
	if (portRecordError(port) !== null) throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
	columns.stationMillimeters[columnIndex] = stationMillimeters;
	columns.sides[columnIndex] = sideCode;
	columns.lateralOffsetMillimeters[columnIndex] = lateralOffsetMillimeters;
	columns.directions[columnIndex] = directionCode;
	return port;
}

function captureAndEncodeRoute(
	value: unknown,
	columns: ArtifactColumns,
	index: number,
): PortRouteIdentity {
	const captured = captureMatchedEnumerableOwnDataRecord(value, [
		CARDINAL_ROUTE_KEYS,
		ADVANCED_ROUTE_KEYS,
	]);
	if (captured === null) throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
	const values = captured.values;
	if (captured.matchIndex === 0) {
		const x = values.x;
		const z = values.z;
		const from = values.from;
		const to = values.to;
		if (
			values.kind !== "CARDINAL_CELL" ||
			!isInt32(x) ||
			!isInt32(z) ||
			!isRouteEnd(from) ||
			!isRouteEnd(to) ||
			(from === 0 && to === 0) ||
			from === to
		) {
			throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
		}
		columns.routeKinds[index] = 1;
		columns.routeXs[index] = x;
		columns.routeZs[index] = z;
		columns.routeFromDirections[index] = from;
		columns.routeToDirections[index] = to;
		return Object.freeze({ kind: "CARDINAL_CELL" as const, x, z, from, to });
	}
	const switchId = values.switchId;
	const segmentOrdinal = values.segmentOrdinal;
	const roleCode = encodeEnum(
		ADVANCED_SWITCH_ROUTE_ROLES,
		values.role,
		"PLAN_PORT_DERIVATION_MISMATCH",
	);
	const role = ADVANCED_SWITCH_ROUTE_ROLES[roleCode - 1];
	const portIndex = values.portIndex;
	if (
		values.kind !== "ADVANCED_SWITCH_SEGMENT" ||
		!isPositiveId(switchId) ||
		!Number.isInteger(segmentOrdinal) ||
		(segmentOrdinal as number) < 0 ||
		(segmentOrdinal as number) > MAX_UINT16 ||
		(role === "THROAT" && portIndex !== null) ||
		(role !== "THROAT" && portIndex !== 0 && portIndex !== 1)
	) {
		throw fixedError("PLAN_PORT_DERIVATION_MISMATCH");
	}
	const profileCode = encodeEnum(
		ADVANCED_SWITCH_PROFILE_CLASSES,
		values.profileClass,
		"PLAN_PORT_DERIVATION_MISMATCH",
	);
	columns.routeKinds[index] = 2;
	columns.routeSwitchIds[index] = switchId;
	columns.routeProfileClasses[index] = profileCode;
	columns.routeRoles[index] = roleCode;
	columns.routePortIndices[index] = portIndex === null ? -1 : (portIndex as number);
	columns.routeSegmentOrdinals[index] = segmentOrdinal as number;
	return Object.freeze({
		kind: "ADVANCED_SWITCH_SEGMENT" as const,
		switchId,
		profileClass: ADVANCED_SWITCH_PROFILE_CLASSES[
			profileCode - 1
		] as (typeof ADVANCED_SWITCH_PROFILE_CLASSES)[number],
		role,
		portIndex: portIndex as 0 | 1 | null,
		segmentOrdinal: segmentOrdinal as number,
	}) as PortRouteIdentity;
}

function allocateColumns(portCount: number, groupCount: number): ArtifactColumns {
	return {
		routeKinds: new Uint8Array(portCount),
		routeXs: new Int32Array(portCount),
		routeZs: new Int32Array(portCount),
		routeFromDirections: new Uint8Array(portCount),
		routeToDirections: new Uint8Array(portCount),
		routeSwitchIds: new Int32Array(portCount),
		routeProfileClasses: new Uint8Array(portCount),
		routeRoles: new Uint8Array(portCount),
		routePortIndices: new Int8Array(portCount),
		routeSegmentOrdinals: new Uint16Array(portCount),
		stationMillimeters: new Int32Array(portCount),
		sides: new Uint8Array(portCount),
		lateralOffsetMillimeters: new Uint32Array(portCount),
		directions: new Uint8Array(portCount),
		groupSpecCodes: new Uint8Array(groupCount),
		groupPortOffsets: new Uint32Array(groupCount + 1),
	};
}

function derivePlanKindFromRepresentatives(
	representatives: ReadonlyMap<EquipmentGroupRecord["kind"], RepresentativeAddition>,
): (typeof PLAN_KINDS)[number] {
	if (representatives.size >= 2) return PORT_EQUIPMENT_BATCH_PLAN_KIND;
	const kind = representatives.keys().next().value as EquipmentGroupRecord["kind"] | undefined;
	if (kind === "OHB") return "place-ohb";
	if (kind === "EQ") return "place-eq";
	if (kind === "STK") return "place-stk";
	throw fixedError("PLAN_KIND_MISMATCH");
}

function capturedArtifactShallowShapeError(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): OpenFabStationProposalReviewedPlanErrorCode | null {
	try {
		if (
			artifact.kind !== ARTIFACT_KIND ||
			artifact.version !== OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ARTIFACT_VERSION ||
			!isEnumCode(artifact.planKindCode, PLAN_KINDS.length) ||
			!isNonnegativeSafeInteger(artifact.baseRevision) ||
			!isNonnegativeSafeInteger(artifact.basePatchSequence) ||
			!isPositiveId(artifact.sourceNextPortId) ||
			!isPositiveId(artifact.sourceNextEquipmentGroupId) ||
			!isBoundedPositiveCount(
				artifact.portCount,
				OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_PORTS,
			) ||
			!isBoundedPositiveCount(
				artifact.groupCount,
				OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_GROUPS,
			) ||
			artifact.groupCount > artifact.portCount ||
			!Number.isSafeInteger(artifact.byteLength) ||
			artifact.byteLength < 0 ||
			artifact.byteLength > OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_BYTES ||
			typeof artifact.reviewFingerprint !== "string" ||
			!REVIEW_FINGERPRINT_PATTERN.test(artifact.reviewFingerprint) ||
			typeof artifact.fingerprint !== "string" ||
			!FINGERPRINT_PATTERN.test(artifact.fingerprint)
		) {
			return "ARTIFACT_SCALAR_MISMATCH";
		}
		if (
			artifact.sourceNextPortId + artifact.portCount - 1 > PORT_RECORD_MAX_ID ||
			artifact.sourceNextEquipmentGroupId + artifact.groupCount - 1 > PORT_RECORD_MAX_ID
		) {
			return "ARTIFACT_SCALAR_MISMATCH";
		}
		if (!artifactArraysHaveExactTypes(artifact)) return "ARTIFACT_TYPED_ARRAY_MISMATCH";
		const views = artifactViews(artifact);
		if (!viewsOwnUniqueFixedBuffers(views)) {
			return "ARTIFACT_BUFFER_OWNERSHIP_MISMATCH";
		}
		if (!artifactColumnsHaveExactLengths(artifact)) return "ARTIFACT_LENGTH_MISMATCH";
		const expectedByteLength = artifactByteLength(artifact.portCount, artifact.groupCount);
		const actualByteLength = views.reduce(
			(total, view) => total + intrinsicTypedArrayStateOrThrow(view).byteLength,
			0,
		);
		if (
			expectedByteLength !== artifact.byteLength ||
			actualByteLength !== artifact.byteLength ||
			actualByteLength > OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_BYTES
		) {
			return "ARTIFACT_LENGTH_MISMATCH";
		}
		return null;
	} catch {
		return "ARTIFACT_CONTRACT_MISMATCH";
	}
}

function capturedArtifactShapeError(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): OpenFabStationProposalReviewedPlanErrorCode | null {
	const shallow = capturedArtifactShallowShapeError(artifact);
	if (shallow) return shallow;
	try {
		const semantic = capturedArtifactValueError(artifact);
		if (semantic) return semantic;
		return artifact.fingerprint === fingerprintUnchecked(artifact)
			? null
			: "ARTIFACT_FINGERPRINT_MISMATCH";
	} catch {
		return "ARTIFACT_VALUE_MISMATCH";
	}
}

function capturedArtifactValueError(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): OpenFabStationProposalReviewedPlanErrorCode | null {
	if (
		artifact.groupPortOffsets[0] !== 0 ||
		artifact.groupPortOffsets[artifact.groupCount] !== artifact.portCount
	) {
		return "ARTIFACT_CSR_MISMATCH";
	}
	let kindMask = 0;
	for (let groupIndex = 0; groupIndex < artifact.groupCount; groupIndex++) {
		const start = artifact.groupPortOffsets[groupIndex] as number;
		const end = artifact.groupPortOffsets[groupIndex + 1] as number;
		if (start >= end || end > artifact.portCount) return "ARTIFACT_CSR_MISMATCH";
		const spec = tryDecodeGroupSpec(artifact.groupSpecCodes[groupIndex] as number);
		if (spec === null || !groupSpecCountIsCanonical(spec, end - start)) {
			return "ARTIFACT_VALUE_MISMATCH";
		}
		kindMask |= spec.kind === "OHB" ? 1 : spec.kind === "EQ" ? 2 : 4;
		const groupId = artifact.sourceNextEquipmentGroupId + groupIndex;
		const ports: PortRecord[] = new Array(end - start);
		const portIds: number[] = new Array(end - start);
		for (let portIndex = start; portIndex < end; portIndex++) {
			if (!portColumnsAreCanonical(artifact, portIndex)) return "ARTIFACT_VALUE_MISMATCH";
			const portId = artifact.sourceNextPortId + portIndex;
			const memberIndex = portIndex - start;
			const port = reconstructPortRecord(
				artifact,
				portIndex,
				portId,
				groupId,
				spec.kind,
				memberIndex,
			);
			if (portRecordError(port) !== null) return "ARTIFACT_VALUE_MISMATCH";
			ports[memberIndex] = port;
			portIds[memberIndex] = portId;
		}
		const group = createGroupRecordFromSpec(spec, groupId, Object.freeze(portIds));
		if (equipmentGroupError(group) !== null) return "ARTIFACT_VALUE_MISMATCH";
		let canonical: readonly number[];
		try {
			canonical = canonicalEquipmentGroupPortIds(
				spec.kind === "STK" ? { kind: "STK", template: spec.template } : { kind: spec.kind },
				portIds,
				ports,
			);
		} catch {
			return "ARTIFACT_VALUE_MISMATCH";
		}
		if (!sameNumbers(canonical, portIds)) return "ARTIFACT_VALUE_MISMATCH";
	}
	return planKindMatchesKindMask(artifact.planKindCode, kindMask)
		? null
		: "ARTIFACT_VALUE_MISMATCH";
}

async function capturedArtifactValueErrorCooperatively(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
	cooperative: CooperativeController,
): Promise<OpenFabStationProposalReviewedPlanErrorCode | null> {
	try {
		if (
			artifact.groupPortOffsets[0] !== 0 ||
			artifact.groupPortOffsets[artifact.groupCount] !== artifact.portCount
		) {
			return "ARTIFACT_CSR_MISMATCH";
		}
		let kindMask = 0;
		for (let groupIndex = 0; groupIndex < artifact.groupCount; groupIndex++) {
			const start = artifact.groupPortOffsets[groupIndex] as number;
			const end = artifact.groupPortOffsets[groupIndex + 1] as number;
			if (start >= end || end > artifact.portCount) return "ARTIFACT_CSR_MISMATCH";
			const spec = tryDecodeGroupSpec(artifact.groupSpecCodes[groupIndex] as number);
			if (spec === null || !groupSpecCountIsCanonical(spec, end - start)) {
				return "ARTIFACT_VALUE_MISMATCH";
			}
			kindMask |= spec.kind === "OHB" ? 1 : spec.kind === "EQ" ? 2 : 4;
			const groupId = artifact.sourceNextEquipmentGroupId + groupIndex;
			const ports: PortRecord[] = new Array(end - start);
			const portIds: number[] = new Array(end - start);
			for (let portIndex = start; portIndex < end; portIndex++) {
				if (!portColumnsAreCanonical(artifact, portIndex)) return "ARTIFACT_VALUE_MISMATCH";
				const portId = artifact.sourceNextPortId + portIndex;
				const memberIndex = portIndex - start;
				const port = reconstructPortRecord(
					artifact,
					portIndex,
					portId,
					groupId,
					spec.kind,
					memberIndex,
				);
				if (portRecordError(port) !== null) return "ARTIFACT_VALUE_MISMATCH";
				ports[memberIndex] = port;
				portIds[memberIndex] = portId;
				if (cooperative.noteOperation()) await cooperative.checkTime();
			}
			const group = createGroupRecordFromSpec(spec, groupId, Object.freeze(portIds));
			if (equipmentGroupError(group) !== null) return "ARTIFACT_VALUE_MISMATCH";
			let canonical: readonly number[];
			try {
				canonical = canonicalEquipmentGroupPortIds(
					spec.kind === "STK" ? { kind: "STK", template: spec.template } : { kind: spec.kind },
					portIds,
					ports,
				);
			} catch {
				return "ARTIFACT_VALUE_MISMATCH";
			}
			if (!sameNumbers(canonical, portIds)) return "ARTIFACT_VALUE_MISMATCH";
			if (cooperative.noteOperation()) await cooperative.checkTime();
		}
		if (!planKindMatchesKindMask(artifact.planKindCode, kindMask)) {
			return "ARTIFACT_VALUE_MISMATCH";
		}
		const fingerprint = await fingerprintCooperatively(artifact, cooperative);
		return fingerprint === artifact.fingerprint ? null : "ARTIFACT_FINGERPRINT_MISMATCH";
	} catch (error) {
		if (isInternallyMintedAbortError(error) || internallyMintedErrorCode(error) !== undefined) {
			throw error;
		}
		return "ARTIFACT_VALUE_MISMATCH";
	}
}

type DecodedGroupSpec =
	| Readonly<{ kind: "OHB"; template: "SINGLE" }>
	| Readonly<{ kind: "EQ"; pitchMillimeters: number; recipe: null }>
	| Readonly<{ kind: "STK"; template: StkAuthoringTemplate }>;

function tryDecodeGroupSpec(code: number): DecodedGroupSpec | null {
	if (!isEnumCode(code, GROUP_SPEC_CODES.length)) return null;
	const token = GROUP_SPEC_CODES[code - 1];
	if (token === "OHB_SINGLE")
		return Object.freeze({ kind: "OHB" as const, template: "SINGLE" as const });
	if (token?.startsWith("EQ_")) {
		const pitchMillimeters = Number(token.slice(3));
		return EQ_PORT_PITCHES_MILLIMETERS.includes(pitchMillimeters)
			? Object.freeze({ kind: "EQ" as const, pitchMillimeters, recipe: null })
			: null;
	}
	if (token?.startsWith("STK_")) {
		const template = token.slice(4) as StkAuthoringTemplate;
		return STK_AUTHORING_TEMPLATES.includes(template)
			? Object.freeze({ kind: "STK" as const, template })
			: null;
	}
	return null;
}

function groupSpecCountIsCanonical(spec: DecodedGroupSpec, count: number): boolean {
	if (spec.kind === "OHB") return count === 1;
	if (spec.kind === "EQ") return count >= 2 && count <= 64;
	if (count < 1 || count > 16) return false;
	if (spec.template === "FOUR_PORT") return count === 4;
	if (spec.template === "SIX_PORT") return count === 6;
	if (spec.template === "BACK_TO_BACK") return count >= 4 && count % 2 === 0;
	return spec.template === "FLEX";
}

function createGroupRecordFromSpec(
	spec: DecodedGroupSpec,
	id: number,
	portIds: readonly number[],
): EquipmentGroupRecord {
	if (spec.kind === "OHB") {
		return Object.freeze({ id, kind: "OHB" as const, template: "SINGLE" as const, portIds });
	}
	if (spec.kind === "EQ") {
		return Object.freeze({
			id,
			kind: "EQ" as const,
			pitchMillimeters: spec.pitchMillimeters,
			recipe: null,
			portIds,
		});
	}
	return Object.freeze({ id, kind: "STK" as const, template: spec.template, portIds });
}

function reconstructPortRecord(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
	index: number,
	portId: number,
	groupId: number,
	portType: EquipmentGroupRecord["kind"],
	memberIndex: number,
): PortRecord {
	const route: PortRouteIdentity =
		artifact.routeKinds[index] === 1
			? Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: artifact.routeXs[index] as number,
					z: artifact.routeZs[index] as number,
					from: artifact.routeFromDirections[index] as 0 | Direction,
					to: artifact.routeToDirections[index] as 0 | Direction,
				})
			: Object.freeze({
					kind: "ADVANCED_SWITCH_SEGMENT" as const,
					switchId: artifact.routeSwitchIds[index] as number,
					profileClass: ADVANCED_SWITCH_PROFILE_CLASSES[
						(artifact.routeProfileClasses[index] as number) - 1
					] as (typeof ADVANCED_SWITCH_PROFILE_CLASSES)[number],
					role: ADVANCED_SWITCH_ROUTE_ROLES[
						(artifact.routeRoles[index] as number) - 1
					] as (typeof ADVANCED_SWITCH_ROUTE_ROLES)[number],
					portIndex:
						(artifact.routePortIndices[index] as number) < 0
							? null
							: (artifact.routePortIndices[index] as 0 | 1),
					segmentOrdinal: artifact.routeSegmentOrdinals[index] as number,
				});
	return Object.freeze({
		id: portId,
		equipmentGroupId: groupId,
		route,
		stationMillimeters: artifact.stationMillimeters[index] as number,
		side: PORT_SIDES[(artifact.sides[index] as number) - 1] as PortRecord["side"],
		lateralOffsetMillimeters: artifact.lateralOffsetMillimeters[index] as number,
		direction: PORT_DIRECTIONS[
			(artifact.directions[index] as number) - 1
		] as PortRecord["direction"],
		portType,
		barcode: equipmentGroupPortBarcode(portType, groupId, portId, memberIndex),
	});
}

function portColumnsAreCanonical(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
	index: number,
): boolean {
	if (
		(artifact.stationMillimeters[index] as number) < 0 ||
		(artifact.stationMillimeters[index] as number) > PORT_RECORD_MAX_STATION_MILLIMETERS ||
		!isEnumCode(artifact.sides[index], PORT_SIDES.length) ||
		(artifact.lateralOffsetMillimeters[index] as number) > PORT_RECORD_MAX_OFFSET_MILLIMETERS ||
		!isEnumCode(artifact.directions[index], PORT_DIRECTIONS.length)
	) {
		return false;
	}
	const side = PORT_SIDES[(artifact.sides[index] as number) - 1];
	const offset = artifact.lateralOffsetMillimeters[index] as number;
	if ((side === "CENTER" && offset !== 0) || (side !== "CENTER" && offset === 0)) return false;
	if (artifact.routeKinds[index] === 1) {
		const from = artifact.routeFromDirections[index] as number;
		const to = artifact.routeToDirections[index] as number;
		return (
			isRouteEnd(from) &&
			isRouteEnd(to) &&
			!(from === 0 && to === 0) &&
			from !== to &&
			artifact.routeSwitchIds[index] === 0 &&
			artifact.routeProfileClasses[index] === 0 &&
			artifact.routeRoles[index] === 0 &&
			artifact.routePortIndices[index] === 0 &&
			artifact.routeSegmentOrdinals[index] === 0
		);
	}
	if (
		artifact.routeKinds[index] !== 2 ||
		artifact.routeXs[index] !== 0 ||
		artifact.routeZs[index] !== 0 ||
		artifact.routeFromDirections[index] !== 0 ||
		artifact.routeToDirections[index] !== 0 ||
		(artifact.routeSwitchIds[index] as number) <= 0 ||
		!isEnumCode(artifact.routeProfileClasses[index], ADVANCED_SWITCH_PROFILE_CLASSES.length) ||
		!isEnumCode(artifact.routeRoles[index], ADVANCED_SWITCH_ROUTE_ROLES.length)
	) {
		return false;
	}
	const role = ADVANCED_SWITCH_ROUTE_ROLES[(artifact.routeRoles[index] as number) - 1];
	const portIndex = artifact.routePortIndices[index] as number;
	return role === "THROAT" ? portIndex === -1 : portIndex === 0 || portIndex === 1;
}

function planKindMatchesKindMask(planKindCode: number, kindMask: number): boolean {
	const kind = PLAN_KINDS[planKindCode - 1];
	if (kindMask === 1) return kind === "place-ohb";
	if (kindMask === 2) return kind === "place-eq";
	if (kindMask === 4) return kind === "place-stk";
	return (kindMask & (kindMask - 1)) !== 0 && kind === PORT_EQUIPMENT_BATCH_PLAN_KIND;
}

function artifactArraysHaveExactTypes(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): boolean {
	return (
		hasExactTypedArrayPrototype(artifact.routeKinds, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routeXs, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routeZs, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routeFromDirections, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routeToDirections, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routeSwitchIds, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routeProfileClasses, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routeRoles, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routePortIndices, Int8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.routeSegmentOrdinals, Uint16Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.stationMillimeters, Int32Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.sides, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.lateralOffsetMillimeters, Uint32Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.directions, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.groupSpecCodes, Uint8Array.prototype) &&
		hasExactTypedArrayPrototype(artifact.groupPortOffsets, Uint32Array.prototype)
	);
}

function artifactColumnsHaveExactLengths(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): boolean {
	const portCount = artifact.portCount;
	return (
		intrinsicTypedArrayLength(artifact.routeKinds) === portCount &&
		intrinsicTypedArrayLength(artifact.routeXs) === portCount &&
		intrinsicTypedArrayLength(artifact.routeZs) === portCount &&
		intrinsicTypedArrayLength(artifact.routeFromDirections) === portCount &&
		intrinsicTypedArrayLength(artifact.routeToDirections) === portCount &&
		intrinsicTypedArrayLength(artifact.routeSwitchIds) === portCount &&
		intrinsicTypedArrayLength(artifact.routeProfileClasses) === portCount &&
		intrinsicTypedArrayLength(artifact.routeRoles) === portCount &&
		intrinsicTypedArrayLength(artifact.routePortIndices) === portCount &&
		intrinsicTypedArrayLength(artifact.routeSegmentOrdinals) === portCount &&
		intrinsicTypedArrayLength(artifact.stationMillimeters) === portCount &&
		intrinsicTypedArrayLength(artifact.sides) === portCount &&
		intrinsicTypedArrayLength(artifact.lateralOffsetMillimeters) === portCount &&
		intrinsicTypedArrayLength(artifact.directions) === portCount &&
		intrinsicTypedArrayLength(artifact.groupSpecCodes) === artifact.groupCount &&
		intrinsicTypedArrayLength(artifact.groupPortOffsets) === artifact.groupCount + 1
	);
}

function artifactViews(artifact: OpenFabStationProposalReviewedPlanArtifact): ArrayBufferView[] {
	return [
		artifact.routeKinds,
		artifact.routeXs,
		artifact.routeZs,
		artifact.routeFromDirections,
		artifact.routeToDirections,
		artifact.routeSwitchIds,
		artifact.routeProfileClasses,
		artifact.routeRoles,
		artifact.routePortIndices,
		artifact.routeSegmentOrdinals,
		artifact.stationMillimeters,
		artifact.sides,
		artifact.lateralOffsetMillimeters,
		artifact.directions,
		artifact.groupSpecCodes,
		artifact.groupPortOffsets,
	];
}

function cleanArtifactViews(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): ArrayBufferView[] {
	return artifactViews(artifact).map(cleanTypedArrayView);
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
		const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []) as unknown;
		const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as unknown;
		const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as unknown;
		if (
			typeof buffer !== "object" ||
			buffer === null ||
			typeof byteOffset !== "number" ||
			!Number.isSafeInteger(byteOffset) ||
			byteOffset < 0 ||
			typeof byteLength !== "number" ||
			!Number.isSafeInteger(byteLength) ||
			byteLength < 0 ||
			typeof length !== "number" ||
			!Number.isSafeInteger(length) ||
			length < 0
		) {
			return null;
		}
		return {
			buffer,
			byteOffset,
			byteLength,
			length,
		};
	} catch {
		return null;
	}
}

function intrinsicTypedArrayStateOrThrow(value: object): IntrinsicTypedArrayState {
	const state = intrinsicTypedArrayState(value);
	if (state === null) throw fixedError("ARTIFACT_TYPED_ARRAY_MISMATCH");
	return state;
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

function cleanTypedArrayView(view: ArrayBufferView): ArrayBufferView {
	const state = intrinsicTypedArrayStateOrThrow(view);
	if (!(state.buffer instanceof ArrayBuffer)) {
		throw fixedError("ARTIFACT_BUFFER_OWNERSHIP_MISMATCH");
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
	throw fixedError("ARTIFACT_TYPED_ARRAY_MISMATCH");
}

function viewsOwnUniqueFixedBuffers(views: readonly ArrayBufferView[]): boolean {
	if (views.length !== OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT) return false;
	const buffers = new Set<ArrayBuffer>();
	for (const view of views) {
		if (TYPED_ARRAY_CRITICAL_KEYS.some((key) => Object.hasOwn(view, key))) return false;
		const state = intrinsicTypedArrayState(view);
		if (state === null) return false;
		const buffer = state.buffer;
		const byteLength = intrinsicArrayBufferByteLength(buffer);
		if (
			!(buffer instanceof ArrayBuffer) ||
			byteLength === null ||
			arrayBufferIsDetached(buffer) ||
			arrayBufferIsResizable(buffer) ||
			state.byteOffset !== 0 ||
			state.byteLength !== byteLength ||
			buffers.has(buffer)
		) {
			return false;
		}
		buffers.add(buffer);
	}
	return true;
}

function intrinsicArrayBufferByteLength(buffer: ArrayBufferLike): number | null {
	if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return null;
	try {
		const value = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
		return typeof value === "number" ? value : null;
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

function artifactTransferBuffersUnchecked(
	artifact: OpenFabStationProposalReviewedPlanArtifact,
): ArrayBuffer[] {
	return artifactViews(artifact).map((view) => {
		const buffer = intrinsicTypedArrayStateOrThrow(view).buffer;
		if (!(buffer instanceof ArrayBuffer)) {
			throw fixedError("ARTIFACT_BUFFER_OWNERSHIP_MISMATCH");
		}
		return buffer;
	});
}

function artifactByteLength(portCount: number, groupCount: number): number {
	const byteLength = portCount * 30 + groupCount * 5 + 4;
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw fixedError("BYTE_LIMIT_EXCEEDED");
	return byteLength;
}

function fingerprintUnchecked(artifact: OpenFabStationProposalReviewedPlanArtifact): string {
	const checksum = fingerprintPrefix(artifact);
	checksum.addViews(cleanArtifactViews(artifact));
	return `${FINGERPRINT_DOMAIN}:${checksum.digest()}`;
}

async function fingerprintCooperatively(
	artifact: Omit<OpenFabStationProposalReviewedPlanArtifact, "fingerprint">,
	cooperative: CooperativeController,
): Promise<string> {
	const checksum = fingerprintPrefix(artifact);
	await checksum.addViewsCooperatively(
		cleanArtifactViews(artifact as OpenFabStationProposalReviewedPlanArtifact),
		() => cooperative.checkTime(),
		CHECKSUM_BYTES_PER_TIME_CHECK,
	);
	return `${FINGERPRINT_DOMAIN}:${checksum.digest()}`;
}

function fingerprintPrefix(
	artifact: Omit<OpenFabStationProposalReviewedPlanArtifact, "fingerprint">,
): OrderedTypedChecksum {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([FINGERPRINT_DOMAIN, artifact.reviewFingerprint]);
	checksum.addNumbers([
		artifact.version,
		artifact.planKindCode,
		artifact.baseRevision,
		artifact.basePatchSequence,
		artifact.sourceNextPortId,
		artifact.sourceNextEquipmentGroupId,
		artifact.portCount,
		artifact.groupCount,
		artifact.byteLength,
	]);
	return checksum;
}

interface CooperativeController {
	noteOperation(): boolean;
	checkTime(): Promise<void>;
	checkpointNow(): Promise<void>;
	readTime(previous?: number): number;
	throwIfAborted(): void;
}

function resolveCooperativeOptions(
	options: OpenFabStationProposalReviewedPlanCooperativeOptions,
	failureCode: "ENCODE_FAILED" | "ADOPTION_FAILED",
	checkpointGuard: (() => void) | null = null,
): CooperativeController {
	if (!isDataRecord(options)) throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	const checkpoint = ownDataPropertyValue(options, "checkpoint");
	const revisionValue = ownDataPropertyValue(options, "revision");
	const signal = ownDataPropertyValue(options, "signal") as AbortSignal | undefined;
	const nowValue = ownDataPropertyValue(options, "now");
	const sliceValue = ownDataPropertyValue(options, "sliceMilliseconds");
	if (
		typeof checkpoint !== "function" ||
		typeof revisionValue !== "function" ||
		(nowValue !== undefined && typeof nowValue !== "function") ||
		(sliceValue !== undefined &&
			(!Number.isFinite(sliceValue) ||
				(sliceValue as number) <= 0 ||
				(sliceValue as number) > MAX_SLICE_MILLISECONDS))
	) {
		throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	}
	const revision = revisionValue as () => unknown;
	const expectedRevision = readRevision(revision);
	const now = (nowValue as (() => number) | undefined) ?? (() => performance.now());
	const sliceMilliseconds = (sliceValue as number | undefined) ?? DEFAULT_SLICE_MILLISECONDS;
	let sliceStartedAt = readCooperativeTime(now, failureCode);
	let operations = 0;
	const throwIfAborted = (): void => {
		if (readRevision(revision) !== expectedRevision) throw abortedError();
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
		checkpointGuard?.();
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
		readTime(previous = Number.NEGATIVE_INFINITY) {
			const current = readCooperativeTime(now, failureCode);
			if (current < previous) throw fixedError("INVALID_COOPERATIVE_OPTIONS");
			return current;
		},
		throwIfAborted,
	};
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

function readRevision(revision: () => unknown): number {
	let value: unknown;
	try {
		value = revision();
	} catch {
		throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	}
	if (!isNonnegativeSafeInteger(value)) throw fixedError("INVALID_COOPERATIVE_OPTIONS");
	return value;
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

function readMaterializationTime(now: () => number, previous = Number.NEGATIVE_INFINITY): number {
	let value: unknown;
	try {
		value = now();
	} catch {
		throw new Error("STATION_PROPOSAL_REVIEW_MATERIALIZATION_CLOCK_INVALID");
	}
	if (!Number.isFinite(value) || (value as number) < previous) {
		throw new Error("STATION_PROPOSAL_REVIEW_MATERIALIZATION_CLOCK_INVALID");
	}
	return value as number;
}

function captureArtifactIdentity(
	value: unknown,
): OpenFabStationProposalReviewedPlanArtifact | null {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;
		const actualKeys = Reflect.ownKeys(value);
		if (
			actualKeys.length !== ARTIFACT_KEYS.length ||
			actualKeys.some((key) => typeof key !== "string")
		) {
			return null;
		}
		const keySet = new Set(actualKeys as string[]);
		if (ARTIFACT_KEYS.some((key) => !keySet.has(key))) return null;
		const captured = Object.create(null) as Record<string, unknown>;
		for (const key of ARTIFACT_KEYS) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			Object.defineProperty(captured, key, {
				value: descriptor.value,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze(captured) as unknown as OpenFabStationProposalReviewedPlanArtifact;
	} catch {
		return null;
	}
}

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
		const stringKeys = actualKeys as string[];
		const keySet = new Set(stringKeys);
		let matchIndex = -1;
		for (let index = 0; index < expectedKeySets.length; index++) {
			const expectedKeys = expectedKeySets[index] as readonly string[];
			if (
				stringKeys.length === expectedKeys.length &&
				expectedKeys.every((key) => keySet.has(key))
			) {
				matchIndex = index;
				break;
			}
		}
		if (matchIndex < 0) return null;
		const captured = Object.create(null) as Record<string, unknown>;
		for (const key of expectedKeySets[matchIndex] as readonly string[]) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			Object.defineProperty(captured, key, {
				value: descriptor.value,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze({ values: Object.freeze(captured), matchIndex });
	} catch {
		return null;
	}
}

function captureBoundedArrayEnvelope(value: unknown, maximumCount: number): CapturedArrayEnvelope {
	if (!Array.isArray(value)) throw fixedError("INVALID_INPUT");
	let descriptor: PropertyDescriptor | undefined;
	try {
		descriptor = Object.getOwnPropertyDescriptor(value, "length");
	} catch {
		throw fixedError("INVALID_INPUT");
	}
	if (
		descriptor === undefined ||
		!("value" in descriptor) ||
		!Number.isSafeInteger(descriptor.value) ||
		descriptor.value < 0
	) {
		throw fixedError("INVALID_INPUT");
	}
	if (descriptor.value > maximumCount) throw fixedError("CAPACITY_EXCEEDED");
	return Object.freeze({ source: value, count: descriptor.value as number });
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

function isDataRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return false;
		return Reflect.ownKeys(value).every((key) => {
			if (typeof key !== "string") return false;
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return descriptor?.enumerable === true && "value" in descriptor;
		});
	} catch {
		return false;
	}
}

function ownDataPropertyValue(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function createReviewedApplyMaterializationTimings(values: {
	readonly totalStartedAt: number;
	readonly authorityValidationStartedAt: number;
	readonly authorityValidationFinishedAt: number;
	readonly mutationReconstructionStartedAt: number;
	readonly mutationReconstructionFinishedAt: number;
	readonly planValidationStartedAt: number;
	readonly planValidationFinishedAt: number;
	readonly prospectiveStateStartedAt: number;
	readonly prospectiveStateFinishedAt: number;
	readonly layoutValidationStartedAt: number;
	readonly layoutValidationFinishedAt: number;
	readonly checksumValidationStartedAt: number;
	readonly checksumValidationFinishedAt: number;
	readonly applyIssuanceStartedAt: number;
	readonly applyIssuanceFinishedAt: number;
}): OpenFabStationProposalReviewedApplyMaterializationTimings {
	return Object.freeze({
		authorityValidationMilliseconds:
			values.authorityValidationFinishedAt - values.authorityValidationStartedAt,
		mutationReconstructionMilliseconds:
			values.mutationReconstructionFinishedAt - values.mutationReconstructionStartedAt,
		planValidationMilliseconds: values.planValidationFinishedAt - values.planValidationStartedAt,
		prospectiveStateMilliseconds:
			values.prospectiveStateFinishedAt - values.prospectiveStateStartedAt,
		layoutValidationMilliseconds:
			values.layoutValidationFinishedAt - values.layoutValidationStartedAt,
		checksumValidationMilliseconds:
			values.checksumValidationFinishedAt - values.checksumValidationStartedAt,
		applyIssuanceMilliseconds: values.applyIssuanceFinishedAt - values.applyIssuanceStartedAt,
		totalMilliseconds: values.applyIssuanceFinishedAt - values.totalStartedAt,
	});
}

function consumeReviewedApplyMaterializationAuthority(
	permit: OpenFabStationProposalReviewPermit,
	adopted: AdoptedOpenFabStationProposalReviewedPlanArtifact,
	ticketValue: OpenFabStationProposalReviewWorkerTicket,
): ConsumedReviewedApplyMaterializationAuthority {
	const source = pendingReviewPermits.get(permit);
	const artifact = adoptedArtifacts.get(adopted);
	pendingReviewPermits.delete(permit);
	adoptedArtifacts.delete(adopted);
	const ticketCapture = captureMatchedEnumerableOwnDataRecord(ticketValue, [WORKER_TICKET_KEYS]);
	if (!source || !artifact || !ticketCapture) {
		throw new Error("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
	}
	return Object.freeze({ source, artifact, ticket: ticketCapture.values, permit });
}

function assertReviewedApplyMaterializationAuthority(
	authority: ConsumedReviewedApplyMaterializationAuthority,
	document: RailDocument,
	currentGeneration: number,
	validateSourceChecksum = true,
): void {
	const { source, artifact, ticket, permit } = authority;
	if (
		source.document !== document ||
		source.applyRequestId === null ||
		source.reviewFingerprint === null ||
		source.evaluationSnapshotFingerprint === null ||
		currentGeneration !== source.generation ||
		!livePermitSourceMatches(source) ||
		ticket.ticketId !== permit.ticketId ||
		ticket.evaluationRequestId !== source.evaluationRequestId ||
		ticket.applyRequestId !== source.applyRequestId ||
		ticket.validationLevel !== "exact" ||
		ticket.requestGeneration !== source.generation ||
		ticket.sourceRevision !== source.sourceRevision ||
		ticket.sourcePatchSequence !== source.sourcePatchSequence ||
		ticket.sourceChecksum !== source.sourceChecksum ||
		ticket.sourceNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.sourceNextPortId !== source.sourceNextPortId ||
		ticket.sourceNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		ticket.sourceNextOrganizationId !== source.sourceNextOrganizationId ||
		ticket.proposalSemanticFingerprint !== source.proposalSemanticFingerprint ||
		ticket.proposalSnapshotFingerprint !== source.proposalSnapshotFingerprint ||
		ticket.draftFingerprint !== source.draftFingerprint ||
		!matchesPattern(
			ticket.evaluationSnapshotFingerprint,
			EVALUATION_SNAPSHOT_FINGERPRINT_PATTERN,
		) ||
		ticket.evaluationSnapshotFingerprint !== source.evaluationSnapshotFingerprint ||
		ticket.reviewFingerprint !== source.reviewFingerprint ||
		artifact.baseRevision !== source.sourceRevision ||
		artifact.basePatchSequence !== source.sourcePatchSequence ||
		artifact.sourceNextPortId !== source.sourceNextPortId ||
		artifact.sourceNextEquipmentGroupId !== source.sourceNextEquipmentGroupId ||
		artifact.reviewFingerprint !== source.reviewFingerprint ||
		ticket.planArtifactFingerprint !== artifact.fingerprint ||
		ticket.planKindCode !== artifact.planKindCode ||
		ticket.portCount !== artifact.portCount ||
		ticket.groupCount !== artifact.groupCount ||
		!matchesPattern(ticket.planFingerprint, PLAN_GRAPH_FINGERPRINT_PATTERN) ||
		!matchesPattern(ticket.prospectiveChecksum, RAIL_CHECKSUM_PATTERN) ||
		(validateSourceChecksum &&
			checksumRailMap(source.map, source.portEquipment, source.organizations) !==
				source.sourceChecksum)
	) {
		throw new Error("STATION_PROPOSAL_REVIEW_APPLY_IDENTITY_MISMATCH");
	}
}

function assertReviewedApplyProspectiveIdentity(
	authority: ConsumedReviewedApplyMaterializationAuthority,
	prospective: PortEquipmentState,
	incrementalChecksum: string,
	fullChecksum: string,
): void {
	const { source, artifact, ticket } = authority;
	if (
		prospective.nextPortId !== ticket.prospectiveNextPortId ||
		prospective.nextEquipmentGroupId !== ticket.prospectiveNextEquipmentGroupId ||
		ticket.prospectiveNextPortId !== source.sourceNextPortId + artifact.portCount ||
		ticket.prospectiveNextEquipmentGroupId !==
			source.sourceNextEquipmentGroupId + artifact.groupCount ||
		ticket.prospectiveNextAdvancedSwitchId !== source.sourceNextAdvancedSwitchId ||
		ticket.prospectiveNextOrganizationId !== source.sourceNextOrganizationId ||
		incrementalChecksum !== ticket.prospectiveChecksum ||
		fullChecksum !== ticket.prospectiveChecksum
	) {
		throw new Error("STATION_PROPOSAL_REVIEW_PROSPECTIVE_IDENTITY_MISMATCH");
	}
}

function livePermitSourceMatches(source: OpenFabStationProposalReviewPermitSource): boolean {
	return (
		source.document.map === source.map &&
		source.document.portEquipment === source.portEquipment &&
		source.document.organizations === source.organizations &&
		source.map.getRevision() === source.sourceRevision &&
		source.document.getPatchSequence() === source.sourcePatchSequence &&
		source.map.getAdvancedSwitchIdCursor() === source.sourceNextAdvancedSwitchId &&
		source.portEquipment.nextPortId === source.sourceNextPortId &&
		source.portEquipment.nextEquipmentGroupId === source.sourceNextEquipmentGroupId &&
		source.organizations.nextOrganizationId === source.sourceNextOrganizationId
	);
}

function assertUniqueTransferBuffers(buffers: readonly ArrayBuffer[]): void {
	const seen = new Set<ArrayBuffer>();
	for (const buffer of buffers) {
		if (!(buffer instanceof ArrayBuffer) || seen.has(buffer)) {
			throw new Error("STATION_PROPOSAL_REVIEW_TRANSFER_OWNERSHIP_INVALID");
		}
		seen.add(buffer);
	}
}

function matchesPattern(value: unknown, pattern: RegExp): value is string {
	return typeof value === "string" && pattern.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function intrinsicGetter(prototype: object, key: string): ((this: unknown) => unknown) | undefined {
	return Object.getOwnPropertyDescriptor(prototype, key)?.get;
}

function encodeEnum<const Values extends readonly unknown[]>(
	values: Values,
	value: unknown,
	code: OpenFabStationProposalReviewedPlanErrorCode = "INVALID_INPUT",
): number {
	const index = values.indexOf(value);
	if (index < 0) throw fixedError(code);
	return index + 1;
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

function isNonnegativeUint32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function isPositiveId(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= 1 && (value as number) <= PORT_RECORD_MAX_ID
	);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedPositiveCount(value: unknown, maximum: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;
}

function requireNonnegativeSafeInteger(value: unknown): number {
	if (!isNonnegativeSafeInteger(value)) throw fixedError("SOURCE_IDENTITY_MISMATCH");
	return value;
}

function requireAllocatableId(value: unknown): number {
	if (!isPositiveId(value)) throw fixedError("SOURCE_IDENTITY_MISMATCH");
	return value;
}

function assertContiguousIdCapacity(firstId: number, count: number): void {
	if (firstId + count - 1 > PORT_RECORD_MAX_ID) throw fixedError("PLAN_ID_SEQUENCE_MISMATCH");
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

class ReviewedPlanArtifactError extends Error {
	readonly code: OpenFabStationProposalReviewedPlanErrorCode;

	constructor(code: OpenFabStationProposalReviewedPlanErrorCode) {
		super(code);
		this.name = "OpenFabStationProposalReviewedPlanArtifactError";
		this.code = code;
	}
}

function fixedError(code: OpenFabStationProposalReviewedPlanErrorCode): ReviewedPlanArtifactError {
	const error = new ReviewedPlanArtifactError(code);
	internallyMintedErrorCodes.set(error, code);
	return error;
}

function abortedError(): Error {
	const error = new Error("OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ABORTED");
	error.name = "AbortError";
	internallyMintedAbortErrors.add(error);
	return error;
}

function isInternallyMintedAbortError(error: unknown): error is Error {
	return typeof error === "object" && error !== null && internallyMintedAbortErrors.has(error);
}

function internallyMintedErrorCode(
	error: unknown,
): OpenFabStationProposalReviewedPlanErrorCode | undefined {
	return typeof error === "object" && error !== null
		? internallyMintedErrorCodes.get(error)
		: undefined;
}

function normalizeOperationError(
	error: unknown,
	fallback: "ENCODE_FAILED" | "ADOPTION_FAILED",
): Error {
	if (isInternallyMintedAbortError(error)) return abortedError();
	const code = internallyMintedErrorCode(error);
	return fixedError(code ?? fallback);
}
