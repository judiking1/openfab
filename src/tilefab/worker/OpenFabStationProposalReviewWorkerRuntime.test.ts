import { describe, expect, it } from "vitest";
import {
	captureOpenFabStationProposalArtifactCooperatively,
	hydrateOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
	type OpenFabStationProposalArtifact,
	openFabStationProposalArtifactTransfers,
} from "../compile/OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "../compile/OpenFabStationProposalCsvReader";
import type { OpenFabStationProposalReviewDraft } from "../compile/OpenFabStationProposalReview";
import {
	hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively,
	validateOpenFabStationProposalReviewEvaluationArtifact,
} from "../compile/OpenFabStationProposalReviewEvaluationArtifact";
import { applyPortEquipmentMutations, copyEquipmentGroupRecord } from "../core/EquipmentGroup";
import { equipmentGroupPortBarcode } from "../core/EquipmentGroupPortOrder";
import { createPortEquipmentMutationPlanWithImmutableGraphCertificate } from "../core/PortEquipmentPlan";
import { copyPortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	collectOpenFabStationProposalReviewDraftSnapshotTransfers,
	encodeOpenFabStationProposalReviewDraftCooperatively,
} from "./OpenFabStationProposalReviewDraftSoA";
import {
	adoptOpenFabStationProposalReviewedPlanArtifactCooperatively,
	armOpenFabStationProposalReviewPermit,
	authorizeOpenFabStationProposalReviewApply,
	encodeOpenFabStationProposalReviewedPlanArtifactCooperatively,
	materializeOpenFabStationProposalReviewedApply,
	OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT,
	openFabStationProposalReviewedPlanFingerprint,
	prepareOpenFabStationProposalReviewEvaluationTransfer,
	releaseEncodedOpenFabStationProposalReviewedPlanArtifactTransfer,
	validateOpenFabStationProposalReviewedPlanArtifact,
} from "./OpenFabStationProposalReviewedPlanArtifact";
import {
	type ApplyOpenFabStationProposalReviewWorkerRequest,
	type EvaluateOpenFabStationProposalReviewWorkerRequest,
	OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalReviewEvaluatedResponse,
	type OpenFabStationProposalReviewPlanPreparedResponse,
	type OpenFabStationProposalReviewWorkerErrorCode,
	type OpenFabStationProposalReviewWorkerResponse,
	type OpenFabStationProposalReviewWorkerTicket,
	openFabStationProposalReviewWorkerErrorMessage,
} from "./OpenFabStationProposalReviewWorkerProtocol";
import {
	collectOpenFabStationProposalReviewWorkerResponseTransfers,
	OpenFabStationProposalReviewWorkerSession,
} from "./OpenFabStationProposalReviewWorkerRuntime";
import {
	adoptRailMirrorSnapshotCaptureHandoff,
	captureRailMirrorSnapshot,
	checksumRailMap,
	issueRailMirrorSnapshotCaptureHandoff,
} from "./RailMirrorChecksum";
import { railMirrorSnapshotTransfers } from "./railMirrorProtocol";

const EVALUATION_REQUEST_ID = 101;
const APPLY_REQUEST_ID = 102;
const GENERATION = 7;
const TICKET_ID = 11;
const NOOP_COOPERATIVE_OPTIONS = Object.freeze({
	checkpoint: async () => {},
	revision: () => 0,
});
const REDACTION_SENTINEL = "PUBLIC_SYNTHETIC_HOSTILE_ERROR_SENTINEL";
const ARM_RECEIPT_FIELDS = Object.freeze([
	"evaluationRequestId",
	"generation",
	"ticketId",
	"proposalSemanticFingerprint",
	"proposalSnapshotFingerprint",
	"draftFingerprint",
	"sourceChecksum",
] as const);
type TicketMutation = readonly [
	name: string,
	mutate: (
		ticket: OpenFabStationProposalReviewWorkerTicket,
	) => OpenFabStationProposalReviewWorkerTicket,
];
type ApplyRequestMutation = readonly [
	name: string,
	mutate: (
		request: ApplyOpenFabStationProposalReviewWorkerRequest,
	) => ApplyOpenFabStationProposalReviewWorkerRequest,
];
const APPLY_REQUEST_MUTATIONS: readonly ApplyRequestMutation[] = Object.freeze([
	[
		"evaluation request ID reuse",
		(request) => Object.freeze({ ...request, requestId: request.evaluationRequestId }),
	],
	["generation", (request) => Object.freeze({ ...request, generation: request.generation + 1 })],
	["ticket ID", (request) => Object.freeze({ ...request, ticketId: request.ticketId + 1 })],
	[
		"evaluation snapshot fingerprint",
		(request) =>
			Object.freeze({
				...request,
				evaluationSnapshotFingerprint: flipLastFingerprintNibble(
					request.evaluationSnapshotFingerprint,
				),
			}),
	],
	[
		"review fingerprint",
		(request) =>
			Object.freeze({
				...request,
				reviewFingerprint: flipLastFingerprintNibble(request.reviewFingerprint),
			}),
	],
]);
const TICKET_MUTATIONS: readonly TicketMutation[] = Object.freeze([
	["ticketId", (ticket) => ticketWith(ticket, "ticketId", ticket.ticketId + 1)],
	[
		"evaluationRequestId",
		(ticket) => ticketWith(ticket, "evaluationRequestId", ticket.evaluationRequestId + 1),
	],
	["applyRequestId", (ticket) => ticketWith(ticket, "applyRequestId", ticket.applyRequestId + 1)],
	["validationLevel", (ticket) => ticketWith(ticket, "validationLevel", "inexact")],
	[
		"requestGeneration",
		(ticket) => ticketWith(ticket, "requestGeneration", ticket.requestGeneration + 1),
	],
	["sourceRevision", (ticket) => ticketWith(ticket, "sourceRevision", ticket.sourceRevision + 1)],
	[
		"sourcePatchSequence",
		(ticket) => ticketWith(ticket, "sourcePatchSequence", ticket.sourcePatchSequence + 1),
	],
	[
		"sourceChecksum",
		(ticket) =>
			ticketWith(ticket, "sourceChecksum", flipLastFingerprintNibble(ticket.sourceChecksum)),
	],
	[
		"sourceNextAdvancedSwitchId",
		(ticket) =>
			ticketWith(ticket, "sourceNextAdvancedSwitchId", ticket.sourceNextAdvancedSwitchId + 1),
	],
	[
		"sourceNextPortId",
		(ticket) => ticketWith(ticket, "sourceNextPortId", ticket.sourceNextPortId + 1),
	],
	[
		"sourceNextEquipmentGroupId",
		(ticket) =>
			ticketWith(ticket, "sourceNextEquipmentGroupId", ticket.sourceNextEquipmentGroupId + 1),
	],
	[
		"sourceNextOrganizationId",
		(ticket) => ticketWith(ticket, "sourceNextOrganizationId", ticket.sourceNextOrganizationId + 1),
	],
	[
		"proposalSemanticFingerprint",
		(ticket) =>
			ticketWith(
				ticket,
				"proposalSemanticFingerprint",
				flipLastFingerprintNibble(ticket.proposalSemanticFingerprint),
			),
	],
	[
		"proposalSnapshotFingerprint",
		(ticket) =>
			ticketWith(
				ticket,
				"proposalSnapshotFingerprint",
				flipLastFingerprintNibble(ticket.proposalSnapshotFingerprint),
			),
	],
	[
		"draftFingerprint",
		(ticket) =>
			ticketWith(ticket, "draftFingerprint", flipLastFingerprintNibble(ticket.draftFingerprint)),
	],
	[
		"evaluationSnapshotFingerprint",
		(ticket) =>
			ticketWith(
				ticket,
				"evaluationSnapshotFingerprint",
				flipLastFingerprintNibble(ticket.evaluationSnapshotFingerprint),
			),
	],
	[
		"reviewFingerprint",
		(ticket) =>
			ticketWith(ticket, "reviewFingerprint", flipLastFingerprintNibble(ticket.reviewFingerprint)),
	],
	[
		"planArtifactFingerprint",
		(ticket) =>
			ticketWith(
				ticket,
				"planArtifactFingerprint",
				flipLastFingerprintNibble(ticket.planArtifactFingerprint),
			),
	],
	[
		"planFingerprint",
		(ticket) =>
			ticketWith(ticket, "planFingerprint", flipLastFingerprintNibble(ticket.planFingerprint)),
	],
	["planKindCode", (ticket) => ticketWith(ticket, "planKindCode", ticket.planKindCode + 1)],
	["portCount", (ticket) => ticketWith(ticket, "portCount", ticket.portCount + 1)],
	["groupCount", (ticket) => ticketWith(ticket, "groupCount", ticket.groupCount + 1)],
	[
		"prospectiveChecksum",
		(ticket) =>
			ticketWith(
				ticket,
				"prospectiveChecksum",
				flipLastFingerprintNibble(ticket.prospectiveChecksum),
			),
	],
	[
		"prospectiveNextAdvancedSwitchId",
		(ticket) =>
			ticketWith(
				ticket,
				"prospectiveNextAdvancedSwitchId",
				ticket.prospectiveNextAdvancedSwitchId + 1,
			),
	],
	[
		"prospectiveNextPortId",
		(ticket) => ticketWith(ticket, "prospectiveNextPortId", ticket.prospectiveNextPortId + 1),
	],
	[
		"prospectiveNextEquipmentGroupId",
		(ticket) =>
			ticketWith(
				ticket,
				"prospectiveNextEquipmentGroupId",
				ticket.prospectiveNextEquipmentGroupId + 1,
			),
	],
	[
		"prospectiveNextOrganizationId",
		(ticket) =>
			ticketWith(ticket, "prospectiveNextOrganizationId", ticket.prospectiveNextOrganizationId + 1),
	],
]);

describe("OpenFabStationProposalReviewWorkerSession", () => {
	it("terminally consumes all three main captures even when permit scalars are invalid", async () => {
		const document = straightDocument();
		const proposalFacade = hydrateOpenFabStationProposalArtifact(syntheticProposalArtifact());
		const proposalCapture = await captureOpenFabStationProposalArtifactCooperatively(
			proposalFacade,
			{ checkpoint: async () => {} },
		);
		const draftSnapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(
			readyDraft(),
			proposalFacade.rowCount,
			NOOP_COOPERATIVE_OPTIONS,
		);
		const sourceSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		const input = {
			document,
			proposalFacade,
			proposalCapture,
			draftSnapshot,
			sourceSnapshot,
			evaluationRequestId: EVALUATION_REQUEST_ID,
		};

		expect(() =>
			prepareOpenFabStationProposalReviewEvaluationTransfer({
				...input,
				generation: 0,
			}),
		).toThrow("STATION_PROPOSAL_REVIEW_CAPTURE_AUTHORITY_INVALID");
		expect(() =>
			prepareOpenFabStationProposalReviewEvaluationTransfer({
				...input,
				generation: GENERATION,
			}),
		).toThrow("STATION_PROPOSAL_REVIEW_CAPTURE_AUTHORITY_INVALID");
	});

	it("terminally consumes READY preview and permit for every mismatched arm receipt field", async () => {
		for (const field of ARM_RECEIPT_FIELDS) {
			const { document, preparedInput, preview, evaluated } = await prepareEvaluatedReadyPermit();
			const before = captureDocumentIdentity(document);
			const receipt = permitReceipt(evaluated);
			const value = receipt[field];
			const forged = Object.freeze({
				...receipt,
				[field]: typeof value === "number" ? value + 1 : flipLastFingerprintNibble(value),
			});

			expect(armOpenFabStationProposalReviewPermit(preparedInput.permit, preview, forged)).toBe(
				false,
			);
			expect(armOpenFabStationProposalReviewPermit(preparedInput.permit, preview, receipt)).toBe(
				false,
			);
			expect(
				authorizeOpenFabStationProposalReviewApply(
					preparedInput.permit,
					APPLY_REQUEST_ID,
					GENERATION,
				),
			).toBe(false);
			expectDocumentIdentity(document, before);
		}
	});

	it("terminally consumes an armed permit when Apply reuses the evaluation request ID", async () => {
		const { document, preparedInput, preview, evaluated } = await prepareEvaluatedReadyPermit();
		const before = captureDocumentIdentity(document);
		expect(
			armOpenFabStationProposalReviewPermit(
				preparedInput.permit,
				preview,
				permitReceipt(evaluated),
			),
		).toBe(true);

		expect(
			authorizeOpenFabStationProposalReviewApply(
				preparedInput.permit,
				EVALUATION_REQUEST_ID,
				GENERATION,
			),
		).toBe(false);
		expect(
			authorizeOpenFabStationProposalReviewApply(
				preparedInput.permit,
				APPLY_REQUEST_ID,
				GENERATION,
			),
		).toBe(false);
		expectDocumentIdentity(document, before);
	});

	it("keeps main authority opaque through exact permit arming, materialization, and one commit", async () => {
		const { document, preparedInput, preparedPlan, session } =
			await prepareAuthorizedReadyResponse();
		const planTransfers = collectOpenFabStationProposalReviewWorkerResponseTransfers(preparedPlan);
		const deliveredPlan = structuredClone(preparedPlan.planArtifact, {
			transfer: planTransfers,
		});
		const adoptedPlan = await adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(
			deliveredPlan,
			{
				checkpoint: async () => {},
				revision: () => GENERATION,
			},
		);
		expect(session.isTerminal()).toBe(true);
		const applyHandle = materializeOpenFabStationProposalReviewedApply(
			preparedInput.permit,
			adoptedPlan,
			preparedPlan.ticket,
			document,
			GENERATION,
		);
		expect(applyHandle).toMatchObject({
			kind: "reviewed-port-equipment-apply",
			planKind: "place-ohb",
			portCount: 1,
			equipmentGroupCount: 1,
		});
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.commitReviewedPortEquipment({ ...applyHandle })).toBe(false);
		expect(document.commitReviewedPortEquipment(applyHandle)).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(1);
		expect(document.commitReviewedPortEquipment(applyHandle)).toBe(false);
		expect(document.undo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(1);
	});

	it("rejects a valid reviewed artifact whose allocation cursors do not start at the permit source", async () => {
		const { document, preparedInput, preparedPlan, preview } =
			await prepareAuthorizedReadyResponse();
		if (preview.reviewFingerprint === null) throw new Error("Expected a READY review fingerprint.");
		const highPortId = document.portEquipment.nextPortId + 99;
		const highGroupId = document.portEquipment.nextEquipmentGroupId + 99;
		const port = copyPortRecord({
			id: highPortId,
			equipmentGroupId: highGroupId,
			route: Object.freeze({ kind: "CARDINAL_CELL", x: 1, z: 0, from: DIR_W, to: DIR_E }),
			stationMillimeters: 500,
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL",
			portType: "OHB",
			barcode: equipmentGroupPortBarcode("OHB", highGroupId, highPortId, 0),
		});
		const group = copyEquipmentGroupRecord({
			id: highGroupId,
			kind: "OHB",
			template: "SINGLE",
			portIds: [highPortId],
		});
		const plan = createPortEquipmentMutationPlanWithImmutableGraphCertificate(
			"place-ohb",
			document.map.getRevision(),
			document.getPatchSequence(),
			[Object.freeze({ id: highPortId, before: null, after: port })],
			[Object.freeze({ id: highGroupId, before: null, after: group })],
		);
		const encoded = await encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
			{
				plan,
				sourceRevision: document.map.getRevision(),
				sourcePatchSequence: document.getPatchSequence(),
				sourceNextPortId: highPortId,
				sourceNextEquipmentGroupId: highGroupId,
				reviewFingerprint: preview.reviewFingerprint,
			},
			NOOP_COOPERATIVE_OPTIONS,
		);
		const released = releaseEncodedOpenFabStationProposalReviewedPlanArtifactTransfer(encoded);
		const delivered = structuredClone(released.artifact, {
			transfer: [...released.transfers],
		});
		const adopted = await adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(
			delivered,
			NOOP_COOPERATIVE_OPTIONS,
		);
		const prospective = applyPortEquipmentMutations(
			document.portEquipment,
			plan.portMutations,
			plan.equipmentGroupMutations,
		);
		const forgedTicket = Object.freeze({
			...preparedPlan.ticket,
			planArtifactFingerprint: encoded.fingerprint,
			planFingerprint: openFabStationProposalReviewedPlanFingerprint(plan),
			planKindCode: encoded.planKindCode,
			portCount: encoded.portCount,
			groupCount: encoded.groupCount,
			prospectiveChecksum: checksumRailMap(document.map, prospective, document.organizations),
			prospectiveNextPortId: highPortId + 1,
			prospectiveNextEquipmentGroupId: highGroupId + 1,
		});

		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				forgedTicket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_IDENTITY_MISMATCH");
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				forgedTicket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.portEquipment.equipmentGroups).toHaveLength(0);
	});

	it("terminally rejects a reviewed plan whose complete prospective layout is invalid", async () => {
		const { document, preparedInput, preparedPlan, preview } =
			await prepareAuthorizedReadyResponse();
		if (preview.reviewFingerprint === null) throw new Error("Expected a READY review fingerprint.");
		const portId = document.portEquipment.nextPortId;
		const groupId = document.portEquipment.nextEquipmentGroupId;
		const port = copyPortRecord({
			id: portId,
			equipmentGroupId: groupId,
			route: Object.freeze({ kind: "CARDINAL_CELL", x: 99, z: 0, from: DIR_W, to: DIR_E }),
			stationMillimeters: 500,
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL",
			portType: "OHB",
			barcode: equipmentGroupPortBarcode("OHB", groupId, portId, 0),
		});
		const group = copyEquipmentGroupRecord({
			id: groupId,
			kind: "OHB",
			template: "SINGLE",
			portIds: [portId],
		});
		const plan = createPortEquipmentMutationPlanWithImmutableGraphCertificate(
			"place-ohb",
			document.map.getRevision(),
			document.getPatchSequence(),
			[Object.freeze({ id: portId, before: null, after: port })],
			[Object.freeze({ id: groupId, before: null, after: group })],
		);
		const encoded = await encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
			{
				plan,
				sourceRevision: document.map.getRevision(),
				sourcePatchSequence: document.getPatchSequence(),
				sourceNextPortId: portId,
				sourceNextEquipmentGroupId: groupId,
				reviewFingerprint: preview.reviewFingerprint,
			},
			NOOP_COOPERATIVE_OPTIONS,
		);
		const released = releaseEncodedOpenFabStationProposalReviewedPlanArtifactTransfer(encoded);
		const delivered = structuredClone(released.artifact, {
			transfer: [...released.transfers],
		});
		const adopted = await adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(
			delivered,
			NOOP_COOPERATIVE_OPTIONS,
		);
		const prospective = applyPortEquipmentMutations(
			document.portEquipment,
			plan.portMutations,
			plan.equipmentGroupMutations,
		);
		const forgedTicket = Object.freeze({
			...preparedPlan.ticket,
			planArtifactFingerprint: encoded.fingerprint,
			planFingerprint: openFabStationProposalReviewedPlanFingerprint(plan),
			planKindCode: encoded.planKindCode,
			portCount: encoded.portCount,
			groupCount: encoded.groupCount,
			prospectiveChecksum: checksumRailMap(document.map, prospective, document.organizations),
			prospectiveNextPortId: portId + 1,
			prospectiveNextEquipmentGroupId: groupId + 1,
		});
		const before = captureDocumentIdentity(document);

		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				forgedTicket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_PROSPECTIVE_LAYOUT_INVALID");
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				forgedTicket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expectDocumentIdentity(document, before);
	});

	it.each(
		TICKET_MUTATIONS,
	)("terminally rejects a reviewed plan with mutated ticket field %s", async (_name, mutate) => {
		const { document, preparedInput, preparedPlan } = await prepareAuthorizedReadyResponse();
		const adopted = await adoptPreparedPlanResponse(preparedPlan);
		const before = captureDocumentIdentity(document);
		const forgedTicket = mutate(preparedPlan.ticket);

		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				forgedTicket,
				document,
				GENERATION,
			),
		).toThrow(
			/STATION_PROPOSAL_REVIEW_(?:APPLY_IDENTITY|PLAN_MATERIALIZATION|PROSPECTIVE_IDENTITY)_MISMATCH/,
		);
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				preparedPlan.ticket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expectDocumentIdentity(document, before);
	});

	it.each([
		"extra",
		"missing",
		"accessor",
	] as const)("terminally rejects a reviewed plan with a %s ticket shape", async (mode) => {
		const { document, preparedInput, preparedPlan } = await prepareAuthorizedReadyResponse();
		const adopted = await adoptPreparedPlanResponse(preparedPlan);
		const before = captureDocumentIdentity(document);
		const malformed = { ...preparedPlan.ticket } as Record<string, unknown>;
		let accessorReads = 0;
		if (mode === "extra") malformed.unexpected = REDACTION_SENTINEL;
		if (mode === "missing") delete malformed.planFingerprint;
		if (mode === "accessor") {
			delete malformed.planFingerprint;
			Object.defineProperty(malformed, "planFingerprint", {
				enumerable: true,
				get() {
					accessorReads++;
					throw new Error(REDACTION_SENTINEL);
				},
			});
		}

		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				malformed as unknown as OpenFabStationProposalReviewWorkerTicket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expect(accessorReads).toBe(0);
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				preparedPlan.ticket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expectDocumentIdentity(document, before);
	});

	it("terminally binds materialization to the exact document and live generation", async () => {
		const foreignFixture = await prepareAuthorizedReadyResponse();
		const foreignAdopted = await adoptPreparedPlanResponse(foreignFixture.preparedPlan);
		const originalBefore = captureDocumentIdentity(foreignFixture.document);
		const foreignDocument = straightDocument();
		const foreignBefore = captureDocumentIdentity(foreignDocument);

		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				foreignFixture.preparedInput.permit,
				foreignAdopted,
				foreignFixture.preparedPlan.ticket,
				foreignDocument,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_IDENTITY_MISMATCH");
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				foreignFixture.preparedInput.permit,
				foreignAdopted,
				foreignFixture.preparedPlan.ticket,
				foreignFixture.document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expectDocumentIdentity(foreignFixture.document, originalBefore);
		expectDocumentIdentity(foreignDocument, foreignBefore);

		const generationFixture = await prepareAuthorizedReadyResponse();
		const generationAdopted = await adoptPreparedPlanResponse(generationFixture.preparedPlan);
		const generationBefore = captureDocumentIdentity(generationFixture.document);
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				generationFixture.preparedInput.permit,
				generationAdopted,
				generationFixture.preparedPlan.ticket,
				generationFixture.document,
				GENERATION + 1,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_IDENTITY_MISMATCH");
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				generationFixture.preparedInput.permit,
				generationAdopted,
				generationFixture.preparedPlan.ticket,
				generationFixture.document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expectDocumentIdentity(generationFixture.document, generationBefore);
	});

	it("terminally rejects a permit after the authored rail becomes stale", async () => {
		const { document, preparedInput, preparedPlan } = await prepareAuthorizedReadyResponse();
		const adopted = await adoptPreparedPlanResponse(preparedPlan);
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const staleIdentity = captureDocumentIdentity(document);

		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				preparedPlan.ticket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_IDENTITY_MISMATCH");
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				preparedInput.permit,
				adopted,
				preparedPlan.ticket,
				document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expectDocumentIdentity(document, staleIdentity);
	});

	it("requires the exact permit and adopted-plan handle identities", async () => {
		const copiedPermitFixture = await prepareAuthorizedReadyResponse();
		const copiedPermitAdopted = await adoptPreparedPlanResponse(copiedPermitFixture.preparedPlan);
		const copiedPermitBefore = captureDocumentIdentity(copiedPermitFixture.document);
		const copiedPermit = Object.freeze({
			...copiedPermitFixture.preparedInput.permit,
		}) as typeof copiedPermitFixture.preparedInput.permit;

		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				copiedPermit,
				copiedPermitAdopted,
				copiedPermitFixture.preparedPlan.ticket,
				copiedPermitFixture.document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				copiedPermitFixture.preparedInput.permit,
				copiedPermitAdopted,
				copiedPermitFixture.preparedPlan.ticket,
				copiedPermitFixture.document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expectDocumentIdentity(copiedPermitFixture.document, copiedPermitBefore);

		const copiedAdoptedFixture = await prepareAuthorizedReadyResponse();
		const exactAdopted = await adoptPreparedPlanResponse(copiedAdoptedFixture.preparedPlan);
		const copiedAdoptedBefore = captureDocumentIdentity(copiedAdoptedFixture.document);
		const copiedAdopted = Object.freeze({ ...exactAdopted }) as typeof exactAdopted;
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				copiedAdoptedFixture.preparedInput.permit,
				copiedAdopted,
				copiedAdoptedFixture.preparedPlan.ticket,
				copiedAdoptedFixture.document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expect(() =>
			materializeOpenFabStationProposalReviewedApply(
				copiedAdoptedFixture.preparedInput.permit,
				exactAdopted,
				copiedAdoptedFixture.preparedPlan.ticket,
				copiedAdoptedFixture.document,
				GENERATION,
			),
		).toThrow("STATION_PROPOSAL_REVIEW_APPLY_AUTHORITY_INVALID");
		expectDocumentIdentity(copiedAdoptedFixture.document, copiedAdoptedBefore);
	});

	it("terminally rejects an opaque Apply handle after the document changes", async () => {
		const { document, preparedInput, preparedPlan } = await prepareAuthorizedReadyResponse();
		const adopted = await adoptPreparedPlanResponse(preparedPlan);
		const applyHandle = materializeOpenFabStationProposalReviewedApply(
			preparedInput.permit,
			adopted,
			preparedPlan.ticket,
			document,
			GENERATION,
		);
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const changedIdentity = captureDocumentIdentity(document);

		expect(document.commitReviewedPortEquipment(applyHandle)).toBe(false);
		expect(document.commitReviewedPortEquipment(applyHandle)).toBe(false);
		expectDocumentIdentity(document, changedIdentity);
	});

	it("retains READY for a distinct APPLY request and prepares one transferable reviewed plan", async () => {
		const request = await evaluateRequest("READY");
		const sourceIdentity = Object.freeze({
			revision: request.snapshot.revision,
			sequence: request.snapshot.sequence,
			nextAdvancedSwitchId: request.snapshot.nextAdvancedSwitchId,
			nextPortId: request.snapshot.portEquipment.nextPortId,
			nextEquipmentGroupId: request.snapshot.portEquipment.nextEquipmentGroupId,
			nextOrganizationId: request.snapshot.organizations.nextOrganizationId,
			checksum: request.snapshot.checksum,
		});
		const inputTransfers = collectEvaluateRequestTransfers(request);
		expect(inputTransfers).toHaveLength(125);
		expect(new Set(inputTransfers).size).toBe(inputTransfers.length);

		const deliveredRequest = structuredClone(request, { transfer: inputTransfers });
		expect(inputTransfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		const session = new OpenFabStationProposalReviewWorkerSession();
		const evaluated = await session.receive(deliveredRequest);

		expect(session.isReady()).toBe(true);
		expect(session.isTerminal()).toBe(false);
		expect(evaluated).toMatchObject({
			type: "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED",
			protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
			requestId: EVALUATION_REQUEST_ID,
			generation: GENERATION,
			ticketId: TICKET_ID,
			proposalSemanticFingerprint: deliveredRequest.proposalSemanticFingerprint,
			proposalSnapshotFingerprint: deliveredRequest.proposalSnapshotFingerprint,
			draftFingerprint: deliveredRequest.draftFingerprint,
			sourceChecksum: sourceIdentity.checksum,
		});
		if (evaluated.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED") {
			throw new Error("Expected the synthetic review to evaluate.");
		}
		expect(evaluated.evaluation).toMatchObject({
			state: "READY",
			proposalRowCount: 1,
			groupDecisionCount: 1,
			includedPortCount: 1,
			rejectedPortCount: 0,
			equipmentGroupCount: 1,
		});

		const evaluationTransfers =
			collectOpenFabStationProposalReviewWorkerResponseTransfers(evaluated);
		expect(evaluationTransfers).toHaveLength(3);
		expect(new Set(evaluationTransfers).size).toBe(3);
		const deliveredEvaluation = structuredClone(evaluated, {
			transfer: evaluationTransfers,
		});
		expect(evaluationTransfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		validateOpenFabStationProposalReviewEvaluationArtifact(deliveredEvaluation.evaluation);
		const reviewFingerprint = deliveredEvaluation.evaluation.reviewFingerprint;
		if (reviewFingerprint === null) throw new Error("READY evaluation needs a review fingerprint.");

		const apply = applyRequest({
			requestId: APPLY_REQUEST_ID,
			evaluationRequestId: EVALUATION_REQUEST_ID,
			evaluationSnapshotFingerprint: deliveredEvaluation.evaluation.snapshotFingerprint,
			reviewFingerprint,
		});
		const prepared = await session.receive(apply);

		expect(session.isReady()).toBe(false);
		expect(session.isTerminal()).toBe(true);
		expect(prepared).toMatchObject({
			type: "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED",
			protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
			requestId: APPLY_REQUEST_ID,
			generation: GENERATION,
			ticketId: TICKET_ID,
			ticket: {
				ticketId: TICKET_ID,
				evaluationRequestId: EVALUATION_REQUEST_ID,
				applyRequestId: APPLY_REQUEST_ID,
				validationLevel: "exact",
				requestGeneration: GENERATION,
				sourceRevision: sourceIdentity.revision,
				sourcePatchSequence: sourceIdentity.sequence,
				sourceChecksum: sourceIdentity.checksum,
				sourceNextAdvancedSwitchId: sourceIdentity.nextAdvancedSwitchId,
				sourceNextPortId: sourceIdentity.nextPortId,
				sourceNextEquipmentGroupId: sourceIdentity.nextEquipmentGroupId,
				sourceNextOrganizationId: sourceIdentity.nextOrganizationId,
				evaluationSnapshotFingerprint: deliveredEvaluation.evaluation.snapshotFingerprint,
				reviewFingerprint,
				planKindCode: 1,
				portCount: 1,
				groupCount: 1,
				prospectiveNextAdvancedSwitchId: sourceIdentity.nextAdvancedSwitchId,
				prospectiveNextPortId: sourceIdentity.nextPortId + 1,
				prospectiveNextEquipmentGroupId: sourceIdentity.nextEquipmentGroupId + 1,
				prospectiveNextOrganizationId: sourceIdentity.nextOrganizationId,
			},
		});
		if (prepared.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED") {
			throw new Error("Expected the explicit APPLY to prepare a reviewed plan.");
		}
		expect(prepared.ticket.planArtifactFingerprint).toBe(prepared.planArtifact.fingerprint);
		expect(prepared.ticket.planKindCode).toBe(prepared.planArtifact.planKindCode);
		expect(prepared.ticket.portCount).toBe(prepared.planArtifact.portCount);
		expect(prepared.ticket.groupCount).toBe(prepared.planArtifact.groupCount);

		const planTransfers = collectOpenFabStationProposalReviewWorkerResponseTransfers(prepared);
		expect(planTransfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT);
		expect(new Set(planTransfers).size).toBe(OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT);
		const deliveredPlan = structuredClone(prepared, { transfer: planTransfers });
		expect(planTransfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		validateOpenFabStationProposalReviewedPlanArtifact(deliveredPlan.planArtifact);

		const duplicateApply = await session.receive(apply);
		expectWorkerError(duplicateApply, "SESSION_NOT_READY");
	});

	it("returns a transferable BLOCKED evaluation and makes the disposable session terminal", async () => {
		const request = await evaluateRequest("BLOCKED");
		const session = new OpenFabStationProposalReviewWorkerSession();
		const evaluated = await session.receive(request);

		expect(session.isReady()).toBe(false);
		expect(session.isTerminal()).toBe(true);
		if (evaluated.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED") {
			throw new Error("Expected the incomplete synthetic draft to evaluate as BLOCKED.");
		}
		expect(evaluated.evaluation).toMatchObject({
			state: "BLOCKED",
			proposalRowCount: 1,
			groupDecisionCount: 0,
			includedPortCount: 0,
			reviewFingerprint: null,
		});
		const transfers = collectOpenFabStationProposalReviewWorkerResponseTransfers(evaluated);
		expect(transfers).toHaveLength(3);
		expect(new Set(transfers).size).toBe(3);

		const applyAfterBlocked = applyRequest({
			requestId: APPLY_REQUEST_ID,
			evaluationRequestId: EVALUATION_REQUEST_ID,
			evaluationSnapshotFingerprint: evaluated.evaluation.snapshotFingerprint,
			reviewFingerprint: "openfab-station-proposal-review:v1:00000000:00000000",
		});
		const rejected = await session.receive(applyAfterBlocked);
		expectWorkerError(rejected, "SESSION_NOT_READY");
	});

	it("rejects exact-key violations and accessors without evaluating them or disclosing input data", async () => {
		const malformedFixture = await evaluateRequest("READY");
		const malformed = {
			...malformedFixture,
			untrustedDiagnostic: REDACTION_SENTINEL,
		};
		const malformedResponse = await new OpenFabStationProposalReviewWorkerSession().receive(
			malformed,
		);
		expectWorkerError(malformedResponse, "MALFORMED_REQUEST");
		expect(JSON.stringify(malformedResponse)).not.toContain(REDACTION_SENTINEL);

		const accessorFixture = await evaluateRequest("READY");
		const accessorRequest = { ...accessorFixture } as Record<string, unknown>;
		delete accessorRequest.proposal;
		let accessorReads = 0;
		Object.defineProperty(accessorRequest, "proposal", {
			enumerable: true,
			get() {
				accessorReads++;
				throw new Error(REDACTION_SENTINEL);
			},
		});
		const accessorResponse = await new OpenFabStationProposalReviewWorkerSession().receive(
			accessorRequest,
		);
		expect(accessorReads).toBe(0);
		expectWorkerError(accessorResponse, "MALFORMED_REQUEST");
		expect(accessorResponse).toMatchObject({ requestId: 0, generation: 0, ticketId: 0 });
		expect(JSON.stringify(accessorResponse)).not.toContain(REDACTION_SENTINEL);

		const invalidProposalFixture = await evaluateRequest("READY");
		const invalidProposalResponse = await new OpenFabStationProposalReviewWorkerSession().receive({
			...invalidProposalFixture,
			proposal: {
				...invalidProposalFixture.proposal,
				untrustedDiagnostic: REDACTION_SENTINEL,
			},
		});
		expectWorkerError(invalidProposalResponse, "INVALID_PROPOSAL");
		expect(JSON.stringify(invalidProposalResponse)).not.toContain(REDACTION_SENTINEL);
	});

	it("terminally rejects a duplicate EVALUATE after retaining READY", async () => {
		const request = await evaluateRequest("READY");
		const session = new OpenFabStationProposalReviewWorkerSession();
		const first = await session.receive(request);
		expect(first.type).toBe("OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED");
		expect(session.isReady()).toBe(true);

		const duplicate = await session.receive({ ...request, requestId: EVALUATION_REQUEST_ID + 1 });
		expectWorkerError(duplicate, "SESSION_NOT_READY");
		expect(session.isTerminal()).toBe(true);
	});

	it("terminally rejects an APPLY issued for a foreign evaluation identity", async () => {
		const request = await evaluateRequest("READY");
		const session = new OpenFabStationProposalReviewWorkerSession();
		const evaluated = await session.receive(request);
		if (evaluated.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED") {
			throw new Error("Expected the synthetic review to evaluate.");
		}
		const reviewFingerprint = evaluated.evaluation.reviewFingerprint;
		if (reviewFingerprint === null) throw new Error("READY evaluation needs a review fingerprint.");

		const foreignApply = applyRequest({
			requestId: APPLY_REQUEST_ID,
			evaluationRequestId: EVALUATION_REQUEST_ID + 1,
			evaluationSnapshotFingerprint: evaluated.evaluation.snapshotFingerprint,
			reviewFingerprint,
		});
		const rejected = await session.receive(foreignApply);
		expectWorkerError(rejected, "APPLY_IDENTITY_MISMATCH");
		expect(session.isTerminal()).toBe(true);

		const correctedTooLate = await session.receive(
			applyRequest({
				requestId: APPLY_REQUEST_ID + 1,
				evaluationRequestId: EVALUATION_REQUEST_ID,
				evaluationSnapshotFingerprint: evaluated.evaluation.snapshotFingerprint,
				reviewFingerprint,
			}),
		);
		expectWorkerError(correctedTooLate, "SESSION_NOT_READY");
	});

	it.each(
		APPLY_REQUEST_MUTATIONS,
	)("terminally rejects APPLY with mismatched %s", async (_name, mutate) => {
		const { session, validApply } = await prepareReadyWorkerApplySession();

		const rejected = await session.receive(mutate(validApply));

		expectWorkerError(rejected, "APPLY_IDENTITY_MISMATCH");
		expect(session.isTerminal()).toBe(true);
		expectWorkerError(await session.receive(validApply), "SESSION_NOT_READY");
	});

	it.each([
		"extra",
		"accessor",
	] as const)("terminally rejects a %s APPLY request without reading accessors", async (mode) => {
		const { session, validApply } = await prepareReadyWorkerApplySession();
		const malformed = { ...validApply } as Record<string, unknown>;
		let accessorReads = 0;
		if (mode === "extra") malformed.unexpected = REDACTION_SENTINEL;
		if (mode === "accessor") {
			delete malformed.reviewFingerprint;
			Object.defineProperty(malformed, "reviewFingerprint", {
				enumerable: true,
				get() {
					accessorReads++;
					throw new Error(REDACTION_SENTINEL);
				},
			});
		}

		const rejected = await session.receive(malformed);

		expect(accessorReads).toBe(0);
		expectWorkerError(rejected, "MALFORMED_REQUEST");
		expect(session.isTerminal()).toBe(true);
		expectWorkerError(await session.receive(validApply), "SESSION_NOT_READY");
	});
});

async function prepareEvaluatedReadyPermit() {
	const document = straightDocument();
	const proposalFacade = hydrateOpenFabStationProposalArtifact(syntheticProposalArtifact());
	const proposalCapture = await captureOpenFabStationProposalArtifactCooperatively(proposalFacade, {
		checkpoint: async () => {},
	});
	const draftSnapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(
		readyDraft(),
		proposalFacade.rowCount,
		NOOP_COOPERATIVE_OPTIONS,
	);
	const sourceCapture = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
	const handoff = issueRailMirrorSnapshotCaptureHandoff(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
		sourceCapture.snapshot.checksum,
	);
	const snapshotTransfers = requireArrayBuffers(
		railMirrorSnapshotTransfers(sourceCapture.snapshot),
	);
	const sourceSnapshot = structuredClone(sourceCapture.snapshot, {
		transfer: snapshotTransfers,
	});
	if (!adoptRailMirrorSnapshotCaptureHandoff(handoff, sourceSnapshot)) {
		throw new Error("Expected the synthetic snapshot handoff to remain authoritative.");
	}
	const preparedInput = prepareOpenFabStationProposalReviewEvaluationTransfer({
		document,
		proposalFacade,
		proposalCapture,
		draftSnapshot,
		sourceSnapshot,
		generation: GENERATION,
		evaluationRequestId: EVALUATION_REQUEST_ID,
	});
	if (new Set(preparedInput.transfers).size !== preparedInput.transfers.length) {
		throw new Error("Expected globally unique review input transfers.");
	}
	const evaluationRequest: EvaluateOpenFabStationProposalReviewWorkerRequest = Object.freeze({
		type: "EVALUATE_OPENFAB_STATION_PROPOSAL_REVIEW",
		protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
		requestId: EVALUATION_REQUEST_ID,
		generation: GENERATION,
		ticketId: preparedInput.permit.ticketId,
		proposalSemanticFingerprint: preparedInput.proposal.semanticFingerprint,
		proposalSnapshotFingerprint: preparedInput.proposal.snapshotFingerprint,
		draftFingerprint: preparedInput.draft.fingerprint,
		sourceChecksum: preparedInput.snapshot.checksum,
		proposal: preparedInput.proposal,
		draft: preparedInput.draft,
		snapshot: preparedInput.snapshot,
	});
	const deliveredRequest = structuredClone(evaluationRequest, {
		transfer: [...preparedInput.transfers],
	});
	const session = new OpenFabStationProposalReviewWorkerSession();
	const evaluated = await session.receive(deliveredRequest);
	if (evaluated.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED") {
		throw new Error("Expected a READY permit evaluation.");
	}
	const deliveredEvaluation = structuredClone(evaluated.evaluation, {
		transfer: collectOpenFabStationProposalReviewWorkerResponseTransfers(evaluated),
	});
	const preview = await hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(
		deliveredEvaluation,
		{
			checkpoint: async () => {},
			revision: () => GENERATION,
		},
	);
	return Object.freeze({ document, preparedInput, preview, session, evaluated });
}

async function prepareAuthorizedReadyResponse() {
	const { document, preparedInput, preview, session, evaluated } =
		await prepareEvaluatedReadyPermit();
	if (
		!armOpenFabStationProposalReviewPermit(preparedInput.permit, preview, {
			evaluationRequestId: evaluated.requestId,
			generation: evaluated.generation,
			ticketId: evaluated.ticketId,
			proposalSemanticFingerprint: evaluated.proposalSemanticFingerprint,
			proposalSnapshotFingerprint: evaluated.proposalSnapshotFingerprint,
			draftFingerprint: evaluated.draftFingerprint,
			sourceChecksum: evaluated.sourceChecksum,
		}) ||
		!authorizeOpenFabStationProposalReviewApply(
			preparedInput.permit,
			APPLY_REQUEST_ID,
			GENERATION,
		) ||
		preview.reviewFingerprint === null
	) {
		throw new Error("Expected the synthetic READY review permit to authorize Apply.");
	}
	const preparedPlan = await session.receive(
		Object.freeze({
			...applyRequest({
				requestId: APPLY_REQUEST_ID,
				evaluationRequestId: EVALUATION_REQUEST_ID,
				evaluationSnapshotFingerprint: preview.snapshotFingerprint,
				reviewFingerprint: preview.reviewFingerprint,
			}),
			ticketId: preparedInput.permit.ticketId,
		}),
	);
	if (preparedPlan.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED") {
		throw new Error("Expected a permit-bound reviewed plan.");
	}
	return Object.freeze({ document, preparedInput, preparedPlan, preview, session });
}

async function prepareReadyWorkerApplySession(): Promise<{
	readonly session: OpenFabStationProposalReviewWorkerSession;
	readonly validApply: ApplyOpenFabStationProposalReviewWorkerRequest;
}> {
	const session = new OpenFabStationProposalReviewWorkerSession();
	const evaluated = await session.receive(await evaluateRequest("READY"));
	if (evaluated.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED") {
		throw new Error("Expected a synthetic READY Worker session.");
	}
	if (evaluated.evaluation.reviewFingerprint === null) {
		throw new Error("Expected a synthetic READY review fingerprint.");
	}
	return Object.freeze({
		session,
		validApply: applyRequest({
			requestId: APPLY_REQUEST_ID,
			evaluationRequestId: evaluated.requestId,
			evaluationSnapshotFingerprint: evaluated.evaluation.snapshotFingerprint,
			reviewFingerprint: evaluated.evaluation.reviewFingerprint,
		}),
	});
}

function permitReceipt(evaluated: OpenFabStationProposalReviewEvaluatedResponse) {
	return Object.freeze({
		evaluationRequestId: evaluated.requestId,
		generation: evaluated.generation,
		ticketId: evaluated.ticketId,
		proposalSemanticFingerprint: evaluated.proposalSemanticFingerprint,
		proposalSnapshotFingerprint: evaluated.proposalSnapshotFingerprint,
		draftFingerprint: evaluated.draftFingerprint,
		sourceChecksum: evaluated.sourceChecksum,
	});
}

async function adoptPreparedPlanResponse(
	preparedPlan: OpenFabStationProposalReviewPlanPreparedResponse,
) {
	const transfers = collectOpenFabStationProposalReviewWorkerResponseTransfers(preparedPlan);
	const delivered = structuredClone(preparedPlan.planArtifact, {
		transfer: [...transfers],
	});
	return adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(delivered, {
		checkpoint: async () => {},
		revision: () => GENERATION,
	});
}

function ticketWith(
	ticket: OpenFabStationProposalReviewWorkerTicket,
	key: keyof OpenFabStationProposalReviewWorkerTicket,
	value: unknown,
): OpenFabStationProposalReviewWorkerTicket {
	return Object.freeze({ ...ticket, [key]: value }) as OpenFabStationProposalReviewWorkerTicket;
}

function flipLastFingerprintNibble(value: string): string {
	if (value.length === 0) throw new Error("Synthetic fingerprint must not be empty.");
	return `${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`;
}

interface RuntimeDocumentIdentity {
	readonly map: RailDocument["map"];
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly revision: number;
	readonly patchSequence: number;
	readonly advancedSwitchCursor: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly portCount: number;
	readonly groupCount: number;
	readonly organizationCount: number;
	readonly checksum: string;
}

function captureDocumentIdentity(document: RailDocument): RuntimeDocumentIdentity {
	return Object.freeze({
		map: document.map,
		portEquipment: document.portEquipment,
		organizations: document.organizations,
		revision: document.map.getRevision(),
		patchSequence: document.getPatchSequence(),
		advancedSwitchCursor: document.map.getAdvancedSwitchIdCursor(),
		nextPortId: document.portEquipment.nextPortId,
		nextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: document.organizations.nextOrganizationId,
		portCount: document.portEquipment.ports.length,
		groupCount: document.portEquipment.equipmentGroups.length,
		organizationCount: document.organizations.records.length,
		checksum: checksumRailMap(document.map, document.portEquipment, document.organizations),
	});
}

function expectDocumentIdentity(document: RailDocument, expected: RuntimeDocumentIdentity): void {
	const actual = captureDocumentIdentity(document);
	expect(actual.map).toBe(expected.map);
	expect(actual.portEquipment).toBe(expected.portEquipment);
	expect(actual.organizations).toBe(expected.organizations);
	expect({ ...actual, map: null, portEquipment: null, organizations: null }).toEqual({
		...expected,
		map: null,
		portEquipment: null,
		organizations: null,
	});
}

async function evaluateRequest(
	mode: "READY" | "BLOCKED",
): Promise<EvaluateOpenFabStationProposalReviewWorkerRequest> {
	const proposal = syntheticProposalArtifact();
	const draft = await encodeOpenFabStationProposalReviewDraftCooperatively(
		mode === "READY" ? readyDraft() : blockedDraft(),
		proposal.rowCount,
		NOOP_COOPERATIVE_OPTIONS,
	);
	const document = straightDocument();
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
	).snapshot;
	return Object.freeze({
		type: "EVALUATE_OPENFAB_STATION_PROPOSAL_REVIEW" as const,
		protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
		requestId: EVALUATION_REQUEST_ID,
		generation: GENERATION,
		ticketId: TICKET_ID,
		proposalSemanticFingerprint: proposal.semanticFingerprint,
		proposalSnapshotFingerprint: proposal.snapshotFingerprint,
		draftFingerprint: draft.fingerprint,
		sourceChecksum: snapshot.checksum,
		proposal,
		draft,
		snapshot,
	});
}

function applyRequest(input: {
	readonly requestId: number;
	readonly evaluationRequestId: number;
	readonly evaluationSnapshotFingerprint: string;
	readonly reviewFingerprint: string;
}): ApplyOpenFabStationProposalReviewWorkerRequest {
	return Object.freeze({
		type: "APPLY_OPENFAB_STATION_PROPOSAL_REVIEW" as const,
		protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
		requestId: input.requestId,
		generation: GENERATION,
		ticketId: TICKET_ID,
		evaluationRequestId: input.evaluationRequestId,
		evaluationSnapshotFingerprint: input.evaluationSnapshotFingerprint,
		reviewFingerprint: input.reviewFingerprint,
	});
}

function collectEvaluateRequestTransfers(
	request: EvaluateOpenFabStationProposalReviewWorkerRequest,
): ArrayBuffer[] {
	const snapshotTransfers = requireArrayBuffers(railMirrorSnapshotTransfers(request.snapshot));
	return [
		...openFabStationProposalArtifactTransfers(request.proposal),
		...collectOpenFabStationProposalReviewDraftSnapshotTransfers(request.draft),
		...snapshotTransfers,
	];
}

function requireArrayBuffers(transfers: readonly Transferable[]): ArrayBuffer[] {
	return transfers.map((transfer) => {
		if (!(transfer instanceof ArrayBuffer)) {
			throw new Error("Synthetic rail snapshot unexpectedly exposed a non-buffer transfer.");
		}
		return transfer;
	});
}

function expectWorkerError(
	response: OpenFabStationProposalReviewWorkerResponse,
	code: OpenFabStationProposalReviewWorkerErrorCode,
): void {
	expect(response).toMatchObject({
		type: "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR",
		code,
		message: openFabStationProposalReviewWorkerErrorMessage(code),
	});
	expect(collectOpenFabStationProposalReviewWorkerResponseTransfers(response)).toEqual([]);
}

function straightDocument(): RailDocument {
	const seed = new RailDocument();
	const construction = planRailConstruction(seed.map, { x: 0, y: 0 }, { x: 4, y: 0 });
	if (!seed.commit(construction)) throw new Error("Synthetic straight rail could not be built.");
	return RailDocument.fromLoadedMap(seed.map, 7);
}

function readyDraft(): OpenFabStationProposalReviewDraft {
	return Object.freeze({
		rowDecisions: Object.freeze([
			Object.freeze({
				row: 0,
				disposition: "INCLUDE" as const,
				identityAction: "CREATE_NEW" as const,
				portType: "OHB" as const,
				typeReview: "CONFIRM_DECLARED" as const,
				attachmentReview: "USER_SELECTED_EXACT_ROUTE" as const,
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: 1,
					z: 0,
					from: DIR_W,
					to: DIR_E,
				}),
				stationMillimeters: 500,
				stationReview: "CONFIRM_DECLARED" as const,
				side: "LEFT" as const,
				lateralOffsetMillimeters: 700,
				sideOffsetReview: "CONFIRM_DECLARED" as const,
				direction: "WITH_TRAVEL" as const,
				directionReview: "CONFIRM_DECLARED" as const,
				sourcePositionReview: "NOT_PROVIDED" as const,
			}),
		]),
		groupDecisions: Object.freeze([
			Object.freeze({
				reviewGroupId: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				groupingReview: "CONFIRM_DECLARED" as const,
				memberRows: Object.freeze([0]),
			}),
		]),
		rejectedSourceRowsPolicy: "NOT_APPLICABLE" as const,
		unknownColumnsPolicy: "NOT_APPLICABLE" as const,
		organizationPolicy: "EXPLICIT_UNASSIGNED" as const,
	});
}

function blockedDraft(): OpenFabStationProposalReviewDraft {
	return Object.freeze({
		rowDecisions: Object.freeze([]),
		groupDecisions: Object.freeze([]),
		rejectedSourceRowsPolicy: "NOT_APPLICABLE" as const,
		unknownColumnsPolicy: "NOT_APPLICABLE" as const,
		organizationPolicy: "EXPLICIT_UNASSIGNED" as const,
	});
}

function syntheticProposalArtifact(): OpenFabStationProposalArtifact {
	const row: Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], string> = {
		identity_scope: "PUBLIC_SYNTHETIC_SCOPE",
		port_key: "PUBLIC_SYNTHETIC_OHB_1",
		secondary_aliases: "",
		attachment_scope: "PUBLIC_SYNTHETIC_RAIL_SCOPE",
		attachment_alias: "PUBLIC_SYNTHETIC_ROUTE_1",
		station_mm: "500",
		side: "LEFT",
		lateral_offset_mm: "700",
		direction: "WITH_TRAVEL",
		direction_evidence: "DECLARED",
		port_type: "OHB",
		physical_group_key: "PUBLIC_SYNTHETIC_OHB_GROUP_1",
		physical_group_kind: "OHB",
		organization_alias: "",
		source_x_mm: "",
		source_z_mm: "",
	};
	const csv = `${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n${OPENFAB_STATION_PROPOSAL_V1_HEADERS.map((header) => row[header]).join(",")}`;
	const parsed = parseOpenFabStationProposalCsv(new TextEncoder().encode(csv));
	if (!parsed.ok) throw new Error(`Synthetic proposal failed: ${parsed.failure.code}`);
	return parsed.artifact;
}
