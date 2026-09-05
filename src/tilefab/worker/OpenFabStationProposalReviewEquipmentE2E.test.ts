import { describe, expect, it } from "vitest";
import {
	captureOpenFabStationProposalArtifactCooperatively,
	hydrateOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
} from "../compile/OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "../compile/OpenFabStationProposalCsvReader";
import type {
	OpenFabStationProposalGroupDecision,
	OpenFabStationProposalIncludeDecision,
	OpenFabStationProposalReviewDraft,
} from "../compile/OpenFabStationProposalReview";
import { hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively } from "../compile/OpenFabStationProposalReviewEvaluationArtifact";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { compilePortEquipmentInteractionPresentation } from "../compile/PortEquipmentInteractionPresentation";
import {
	compilePortEquipmentPresentation,
	equipmentGroupPresentationRow,
	PORT_EQUIPMENT_BODY_FACE_KIND,
	PortEquipmentSpatialIndex,
	portEquipmentPresentationRow,
} from "../compile/PortEquipmentPresentation";
import type { EquipmentGroupRecord } from "../core/EquipmentGroup";
import type { PortEquipmentPlanKind } from "../core/PortEquipmentPlan";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { encodeOpenFabStationProposalReviewDraftCooperatively } from "./OpenFabStationProposalReviewDraftSoA";
import {
	adoptOpenFabStationProposalReviewedPlanArtifactCooperatively,
	armOpenFabStationProposalReviewPermit,
	authorizeOpenFabStationProposalReviewApply,
	materializeOpenFabStationProposalReviewedApply,
	prepareOpenFabStationProposalReviewEvaluationTransfer,
} from "./OpenFabStationProposalReviewedPlanArtifact";
import {
	type EvaluateOpenFabStationProposalReviewWorkerRequest,
	OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
} from "./OpenFabStationProposalReviewWorkerProtocol";
import {
	collectOpenFabStationProposalReviewWorkerResponseTransfers,
	OpenFabStationProposalReviewWorkerSession,
} from "./OpenFabStationProposalReviewWorkerRuntime";
import {
	adoptRailMirrorSnapshotCaptureHandoff,
	captureRailMirrorSnapshot,
	issueRailMirrorSnapshotCaptureHandoff,
} from "./RailMirrorChecksum";
import { railMirrorSnapshotTransfers } from "./railMirrorProtocol";

const GENERATION = 31;
const EVALUATION_REQUEST_ID = 401;
const APPLY_REQUEST_ID = 402;
const START_PORT_ID = 41;
const START_GROUP_ID = 9;
const NOOP_COOPERATIVE_OPTIONS = Object.freeze({
	checkpoint: async () => {},
	revision: () => GENERATION,
});

type PortKind = PortRecord["portType"];

interface ExpectedGroup {
	readonly id: number;
	readonly kind: EquipmentGroupRecord["kind"];
	readonly portIds: readonly number[];
	readonly routeXs: readonly number[];
	readonly barcodes: readonly string[];
	readonly directions: readonly PortRecord["direction"][];
	readonly pitchMillimeters?: number;
	readonly template?: "FLEX" | "FOUR_PORT";
}

interface EquipmentReviewScenario {
	readonly label: string;
	readonly rows: readonly SyntheticStationRow[];
	readonly draft: OpenFabStationProposalReviewDraft;
	readonly planKind: PortEquipmentPlanKind;
	readonly planKindCode: number;
	readonly groups: readonly ExpectedGroup[];
}

describe("OpenFab station proposal equipment review end-to-end", () => {
	it("carries one opposite-facing OHB through the disposable Worker and one-shot document commit", async () => {
		await expectEquipmentReviewEndToEnd(ohbScenario());
	});

	it("carries a canonical EQ group through the disposable Worker and one-shot document commit", async () => {
		await expectEquipmentReviewEndToEnd(eqScenario());
	});

	it("carries a CENTER/0 FLEX STK through the disposable Worker and one-shot document commit", async () => {
		await expectEquipmentReviewEndToEnd(stkScenario());
	});

	it("canonicalizes a reversed EQ/STK group draft before one atomic mixed-batch commit", async () => {
		await expectEquipmentReviewEndToEnd(mixedScenario());
	});
});

async function expectEquipmentReviewEndToEnd(scenario: EquipmentReviewScenario): Promise<void> {
	const document = straightDocument();
	const proposalFacade = hydrateOpenFabStationProposalArtifact(proposalArtifact(scenario.rows));
	const proposalCapture = await captureOpenFabStationProposalArtifactCooperatively(proposalFacade, {
		checkpoint: async () => {},
	});
	const draftSnapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(
		scenario.draft,
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
	const snapshotHandoff = issueRailMirrorSnapshotCaptureHandoff(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
		sourceCapture.snapshot.checksum,
	);
	const sourceSnapshot = structuredClone(sourceCapture.snapshot, {
		transfer: requireArrayBuffers(railMirrorSnapshotTransfers(sourceCapture.snapshot)),
	});
	expect(adoptRailMirrorSnapshotCaptureHandoff(snapshotHandoff, sourceSnapshot)).toBe(true);

	const preparedInput = prepareOpenFabStationProposalReviewEvaluationTransfer({
		document,
		proposalFacade,
		proposalCapture,
		draftSnapshot,
		sourceSnapshot,
		generation: GENERATION,
		evaluationRequestId: EVALUATION_REQUEST_ID,
	});
	expect(preparedInput.transfers.length).toBeGreaterThan(0);
	expect(new Set(preparedInput.transfers).size).toBe(preparedInput.transfers.length);

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
	const evaluationInputTransfers = [...preparedInput.transfers];
	const deliveredEvaluationRequest = structuredClone(evaluationRequest, {
		transfer: evaluationInputTransfers,
	});
	expect(evaluationInputTransfers.every((buffer) => buffer.byteLength === 0)).toBe(true);

	const session = new OpenFabStationProposalReviewWorkerSession();
	const evaluated = await session.receive(deliveredEvaluationRequest);
	if (evaluated.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATED") {
		throw new Error(`${scenario.label} did not return a review evaluation.`);
	}
	expect(session.isReady()).toBe(true);
	expect(evaluated.evaluation).toMatchObject({
		state: "READY",
		proposalRowCount: scenario.rows.length,
		includedPortCount: scenario.groups.reduce((count, group) => count + group.portIds.length, 0),
		equipmentGroupCount: scenario.groups.length,
		rejectedPortCount: 0,
	});

	const evaluationTransfers = collectOpenFabStationProposalReviewWorkerResponseTransfers(evaluated);
	const deliveredEvaluationArtifact = structuredClone(evaluated.evaluation, {
		transfer: evaluationTransfers,
	});
	expect(evaluationTransfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
	const preview = await hydrateOpenFabStationProposalReviewEvaluationArtifactCooperatively(
		deliveredEvaluationArtifact,
		NOOP_COOPERATIVE_OPTIONS,
	);
	expect(preview.state).toBe("READY");
	if (preview.reviewFingerprint === null) {
		throw new Error(`${scenario.label} READY preview did not expose a review fingerprint.`);
	}
	expect(
		armOpenFabStationProposalReviewPermit(preparedInput.permit, preview, {
			evaluationRequestId: evaluated.requestId,
			generation: evaluated.generation,
			ticketId: evaluated.ticketId,
			proposalSemanticFingerprint: evaluated.proposalSemanticFingerprint,
			proposalSnapshotFingerprint: evaluated.proposalSnapshotFingerprint,
			draftFingerprint: evaluated.draftFingerprint,
			sourceChecksum: evaluated.sourceChecksum,
		}),
	).toBe(true);
	expect(
		authorizeOpenFabStationProposalReviewApply(preparedInput.permit, APPLY_REQUEST_ID, GENERATION),
	).toBe(true);

	const preparedPlan = await session.receive(
		Object.freeze({
			type: "APPLY_OPENFAB_STATION_PROPOSAL_REVIEW" as const,
			protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
			requestId: APPLY_REQUEST_ID,
			generation: GENERATION,
			ticketId: preparedInput.permit.ticketId,
			evaluationRequestId: EVALUATION_REQUEST_ID,
			evaluationSnapshotFingerprint: preview.snapshotFingerprint,
			reviewFingerprint: preview.reviewFingerprint,
		}),
	);
	if (preparedPlan.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED") {
		throw new Error(`${scenario.label} Apply did not prepare a reviewed plan artifact.`);
	}
	expect(preparedPlan.ticket).toMatchObject({
		evaluationRequestId: EVALUATION_REQUEST_ID,
		applyRequestId: APPLY_REQUEST_ID,
		requestGeneration: GENERATION,
		sourceNextPortId: START_PORT_ID,
		sourceNextEquipmentGroupId: START_GROUP_ID,
		planKindCode: scenario.planKindCode,
		portCount: scenario.groups.reduce((count, group) => count + group.portIds.length, 0),
		groupCount: scenario.groups.length,
		prospectiveNextPortId:
			START_PORT_ID + scenario.groups.reduce((count, group) => count + group.portIds.length, 0),
		prospectiveNextEquipmentGroupId: START_GROUP_ID + scenario.groups.length,
	});
	expect(preparedPlan.planArtifact.planKindCode).toBe(scenario.planKindCode);

	const planTransfers = collectOpenFabStationProposalReviewWorkerResponseTransfers(preparedPlan);
	const deliveredPlanArtifact = structuredClone(preparedPlan.planArtifact, {
		transfer: planTransfers,
	});
	expect(planTransfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
	session.terminate();
	expect(session.isTerminal()).toBe(true);

	const adoptedPlan = await adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(
		deliveredPlanArtifact,
		NOOP_COOPERATIVE_OPTIONS,
	);
	const apply = materializeOpenFabStationProposalReviewedApply(
		preparedInput.permit,
		adoptedPlan,
		preparedPlan.ticket,
		document,
		GENERATION,
	);
	expect(apply).toEqual({
		kind: "reviewed-port-equipment-apply",
		planKind: scenario.planKind,
		portCount: scenario.groups.reduce((count, group) => count + group.portIds.length, 0),
		equipmentGroupCount: scenario.groups.length,
	});
	expect(document.portEquipment).toMatchObject({
		nextPortId: START_PORT_ID,
		nextEquipmentGroupId: START_GROUP_ID,
		ports: [],
		equipmentGroups: [],
	});

	expect(document.commitReviewedPortEquipment({ ...apply })).toBe(false);
	expect(document.commitReviewedPortEquipment(apply)).toBe(true);
	expectCommittedScenario(document, scenario);
	expectPortDerivedPresentation(document, scenario);
	expect(document.commitReviewedPortEquipment(apply)).toBe(false);

	expect(document.undo()).toBe(true);
	expect(document.portEquipment).toMatchObject({
		nextPortId:
			START_PORT_ID + scenario.groups.reduce((count, group) => count + group.portIds.length, 0),
		nextEquipmentGroupId: START_GROUP_ID + scenario.groups.length,
		ports: [],
		equipmentGroups: [],
	});
	expect(document.redo()).toBe(true);
	expectCommittedScenario(document, scenario);
	expectPortDerivedPresentation(document, scenario);
}

function expectCommittedScenario(document: RailDocument, scenario: EquipmentReviewScenario): void {
	const expectedPortCount = scenario.groups.reduce(
		(count, group) => count + group.portIds.length,
		0,
	);
	expect(document.portEquipment.nextPortId).toBe(START_PORT_ID + expectedPortCount);
	expect(document.portEquipment.nextEquipmentGroupId).toBe(START_GROUP_ID + scenario.groups.length);
	expect(document.portEquipment.ports.map((port) => port.id)).toEqual(
		Array.from({ length: expectedPortCount }, (_, index) => START_PORT_ID + index),
	);
	expect(
		document.portEquipment.equipmentGroups.map((group) => ({
			id: group.id,
			kind: group.kind,
			portIds: group.portIds,
		})),
	).toEqual(
		scenario.groups.map((group) => ({
			id: group.id,
			kind: group.kind,
			portIds: group.portIds,
		})),
	);
	const portById = new Map(document.portEquipment.ports.map((port) => [port.id, port] as const));
	for (const group of scenario.groups) {
		const committedGroup = document.portEquipment.equipmentGroups.find(
			(candidate) => candidate.id === group.id,
		);
		expect(committedGroup).toBeDefined();
		if (group.kind === "EQ") {
			expect(committedGroup).toMatchObject({
				kind: "EQ",
				pitchMillimeters: group.pitchMillimeters,
				recipe: null,
			});
		} else if (group.kind === "STK") {
			expect(committedGroup).toMatchObject({ kind: "STK", template: group.template });
		}
		const ports = group.portIds.map((portId) => portById.get(portId));
		expect(ports.every((port) => port !== undefined)).toBe(true);
		expect(
			ports.map((port) => (port?.route.kind === "CARDINAL_CELL" ? port.route.x : null)),
		).toEqual(group.routeXs);
		expect(ports.map((port) => port?.barcode)).toEqual(group.barcodes);
		expect(ports.map((port) => port?.direction)).toEqual(group.directions);
		if (group.kind === "STK") {
			expect(
				ports.map((port) => ({
					side: port?.side,
					lateralOffsetMillimeters: port?.lateralOffsetMillimeters,
					stationMillimeters: port?.stationMillimeters,
				})),
			).toEqual(
				group.portIds.map(() => ({
					side: "CENTER",
					lateralOffsetMillimeters: 0,
					stationMillimeters: 500,
				})),
			);
		}
	}
}

function expectPortDerivedPresentation(
	document: RailDocument,
	scenario: EquipmentReviewScenario,
): void {
	const presentation = compilePortEquipmentPresentation(
		compilePhysicalRail(document.map),
		document.portEquipment,
	);
	const interaction = compilePortEquipmentInteractionPresentation(presentation);
	const spatialIndex = new PortEquipmentSpatialIndex(presentation);
	const expectedPortIds = scenario.groups.flatMap((group) => group.portIds);

	expect([...presentation.portIds]).toEqual(expectedPortIds);
	expect([...presentation.groupIds]).toEqual(scenario.groups.map((group) => group.id));
	expect([...presentation.equipmentGroupIds]).toEqual(
		scenario.groups.flatMap((group) => group.portIds.map(() => group.id)),
	);
	for (const group of scenario.groups) {
		const groupRow = equipmentGroupPresentationRow(presentation, group.id);
		expect(groupRow).not.toBeNull();
		if (groupRow === null) continue;
		expect(presentation.groupKinds[groupRow]).toBe({ OHB: 0, EQ: 1, STK: 2 }[group.kind]);
		const bodySectionRow = presentation.groupBodySectionOffsets[groupRow] as number;
		const bodyHit = spatialIndex.groupAt(
			presentation.bodySectionCenters[bodySectionRow * 2] as number,
			presentation.bodySectionCenters[bodySectionRow * 2 + 1] as number,
		);
		expect(bodyHit?.equipmentGroupId).toBe(group.id);
	}
	for (const group of scenario.groups) {
		for (let memberRow = 0; memberRow < group.portIds.length; memberRow++) {
			const portId = group.portIds[memberRow] as number;
			const row = portEquipmentPresentationRow(presentation, portId);
			expect(row).not.toBeNull();
			if (row === null) continue;
			expect(presentation.equipmentGroupIds[row]).toBe(group.id);
			const facingX = interaction.portOpeningNormals[row * 2] as number;
			const facingZ = interaction.portOpeningNormals[row * 2 + 1] as number;
			const tangentX = presentation.tangents[row * 2] as number;
			const tangentZ = presentation.tangents[row * 2 + 1] as number;
			const expectedWithTravel = group.directions[memberRow] === "WITH_TRAVEL";
			expect(facingX * tangentX + facingZ * tangentZ).toBeCloseTo(expectedWithTravel ? 1 : -1, 5);
			expect(presentation.portBodyFaceKinds[row]).toBe(
				expectedWithTravel
					? PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT
					: PORT_EQUIPMENT_BODY_FACE_KIND.AGAINST_SECTION_TANGENT,
			);
			expect(
				spatialIndex.nearest(
					interaction.portOpeningCenters[row * 2] as number,
					interaction.portOpeningCenters[row * 2 + 1] as number,
					0.01,
				),
			).toMatchObject({ portId, equipmentGroupId: group.id });
		}
	}
}

function ohbScenario(): EquipmentReviewScenario {
	return Object.freeze({
		label: "OHB",
		rows: Object.freeze([stationRow("OHB", "PUBLIC_SYNTHETIC_OHB_GROUP", 0, "AGAINST_TRAVEL")]),
		draft: reviewDraft(
			[includeDecision(0, "OHB", 8, "AGAINST_TRAVEL")],
			[
				Object.freeze({
					reviewGroupId: 601,
					kind: "OHB" as const,
					template: "SINGLE" as const,
					groupingReview: "CONFIRM_DECLARED" as const,
					memberRows: Object.freeze([0]),
				}),
			],
		),
		planKind: "place-ohb",
		planKindCode: 1,
		groups: Object.freeze([
			Object.freeze({
				id: 9,
				kind: "OHB" as const,
				portIds: Object.freeze([41]),
				routeXs: Object.freeze([8]),
				barcodes: Object.freeze(["OHB-41"]),
				directions: ["AGAINST_TRAVEL"] as const,
			}),
		]),
	});
}

function eqScenario(): EquipmentReviewScenario {
	return Object.freeze({
		label: "EQ",
		rows: Object.freeze([
			stationRow("EQ", "PUBLIC_SYNTHETIC_EQ_GROUP", 0),
			stationRow("EQ", "PUBLIC_SYNTHETIC_EQ_GROUP", 1),
		]),
		draft: reviewDraft(
			[includeDecision(0, "EQ", 6), includeDecision(1, "EQ", 4)],
			[
				Object.freeze({
					reviewGroupId: 701,
					kind: "EQ" as const,
					pitchMillimeters: 2_000,
					recipe: null,
					groupingReview: "CONFIRM_DECLARED" as const,
					memberRows: Object.freeze([0, 1]),
				}),
			],
		),
		planKind: "place-eq",
		planKindCode: 2,
		groups: Object.freeze([
			Object.freeze({
				id: 9,
				kind: "EQ" as const,
				portIds: Object.freeze([41, 42]),
				routeXs: Object.freeze([4, 6]),
				barcodes: Object.freeze(["EQ-9-P01", "EQ-9-P02"]),
				directions: ["WITH_TRAVEL", "WITH_TRAVEL"] as const,
				pitchMillimeters: 2_000,
			}),
		]),
	});
}

function stkScenario(): EquipmentReviewScenario {
	return Object.freeze({
		label: "STK",
		rows: Object.freeze([
			stationRow("STK", "PUBLIC_SYNTHETIC_STK_GROUP", 0),
			stationRow("STK", "PUBLIC_SYNTHETIC_STK_GROUP", 1),
		]),
		draft: reviewDraft(
			[includeDecision(0, "STK", 15), includeDecision(1, "STK", 12)],
			[
				Object.freeze({
					reviewGroupId: 801,
					kind: "STK" as const,
					template: "FLEX" as const,
					groupingReview: "CONFIRM_DECLARED" as const,
					memberRows: Object.freeze([0, 1]),
				}),
			],
		),
		planKind: "place-stk",
		planKindCode: 3,
		groups: Object.freeze([
			Object.freeze({
				id: 9,
				kind: "STK" as const,
				portIds: Object.freeze([41, 42]),
				routeXs: Object.freeze([12, 15]),
				barcodes: Object.freeze(["STK-9-P01", "STK-9-P02"]),
				directions: ["WITH_TRAVEL", "WITH_TRAVEL"] as const,
				template: "FLEX" as const,
			}),
		]),
	});
}

function mixedScenario(): EquipmentReviewScenario {
	return Object.freeze({
		label: "EQ/STK mixed batch",
		rows: Object.freeze([
			stationRow("EQ", "PUBLIC_SYNTHETIC_MIXED_EQ_GROUP", 0),
			stationRow("EQ", "PUBLIC_SYNTHETIC_MIXED_EQ_GROUP", 1),
			stationRow("STK", "PUBLIC_SYNTHETIC_MIXED_STK_GROUP", 2, "AGAINST_TRAVEL"),
			stationRow("STK", "PUBLIC_SYNTHETIC_MIXED_STK_GROUP", 3, "AGAINST_TRAVEL"),
			stationRow("STK", "PUBLIC_SYNTHETIC_MIXED_STK_GROUP", 4, "AGAINST_TRAVEL"),
			stationRow("STK", "PUBLIC_SYNTHETIC_MIXED_STK_GROUP", 5, "AGAINST_TRAVEL"),
		]),
		draft: reviewDraft(
			[
				includeDecision(0, "EQ", 5),
				includeDecision(1, "EQ", 2),
				includeDecision(2, "STK", 15, "AGAINST_TRAVEL"),
				includeDecision(3, "STK", 12, "AGAINST_TRAVEL"),
				includeDecision(4, "STK", 14, "AGAINST_TRAVEL"),
				includeDecision(5, "STK", 13, "AGAINST_TRAVEL"),
			],
			[
				Object.freeze({
					reviewGroupId: 902,
					kind: "STK" as const,
					template: "FOUR_PORT" as const,
					groupingReview: "CONFIRM_DECLARED" as const,
					memberRows: Object.freeze([2, 3, 4, 5]),
				}),
				Object.freeze({
					reviewGroupId: 901,
					kind: "EQ" as const,
					pitchMillimeters: 3_000,
					recipe: null,
					groupingReview: "CONFIRM_DECLARED" as const,
					memberRows: Object.freeze([0, 1]),
				}),
			],
		),
		planKind: "place-port-equipment-batch",
		planKindCode: 4,
		groups: Object.freeze([
			Object.freeze({
				id: 9,
				kind: "EQ" as const,
				portIds: Object.freeze([41, 42]),
				routeXs: Object.freeze([2, 5]),
				barcodes: Object.freeze(["EQ-9-P01", "EQ-9-P02"]),
				directions: ["WITH_TRAVEL", "WITH_TRAVEL"] as const,
				pitchMillimeters: 3_000,
			}),
			Object.freeze({
				id: 10,
				kind: "STK" as const,
				portIds: Object.freeze([43, 44, 45, 46]),
				routeXs: Object.freeze([12, 13, 14, 15]),
				barcodes: Object.freeze(["STK-10-P01", "STK-10-P02", "STK-10-P03", "STK-10-P04"]),
				directions: [
					"AGAINST_TRAVEL",
					"AGAINST_TRAVEL",
					"AGAINST_TRAVEL",
					"AGAINST_TRAVEL",
				] as const,
				template: "FOUR_PORT" as const,
			}),
		]),
	});
}

function reviewDraft(
	rowDecisions: readonly OpenFabStationProposalIncludeDecision[],
	groupDecisions: readonly OpenFabStationProposalGroupDecision[],
): OpenFabStationProposalReviewDraft {
	return Object.freeze({
		rowDecisions: Object.freeze([...rowDecisions]),
		groupDecisions: Object.freeze([...groupDecisions]),
		rejectedSourceRowsPolicy: "NOT_APPLICABLE" as const,
		unknownColumnsPolicy: "NOT_APPLICABLE" as const,
		organizationPolicy: "EXPLICIT_UNASSIGNED" as const,
	});
}

function includeDecision(
	row: number,
	portType: PortKind,
	x: number,
	direction: PortRecord["direction"] = "WITH_TRAVEL",
): OpenFabStationProposalIncludeDecision {
	return Object.freeze({
		row,
		disposition: "INCLUDE" as const,
		identityAction: "CREATE_NEW" as const,
		portType,
		typeReview: "CONFIRM_DECLARED" as const,
		attachmentReview: "USER_SELECTED_EXACT_ROUTE" as const,
		route: Object.freeze({
			kind: "CARDINAL_CELL" as const,
			x,
			z: 0,
			from: DIR_W,
			to: DIR_E,
		}),
		stationMillimeters: 500,
		stationReview: "CONFIRM_DECLARED" as const,
		side: "CENTER" as const,
		lateralOffsetMillimeters: 0,
		sideOffsetReview: "CONFIRM_DECLARED" as const,
		direction,
		directionReview: "CONFIRM_DECLARED" as const,
		sourcePositionReview: "NOT_PROVIDED" as const,
	});
}

type SyntheticStationRow = Readonly<
	Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], string>
>;

function stationRow(
	portType: PortKind,
	physicalGroupKey: string,
	row: number,
	direction: PortRecord["direction"] = "WITH_TRAVEL",
): SyntheticStationRow {
	return Object.freeze({
		identity_scope: "PUBLIC_SYNTHETIC_SCOPE",
		port_key: `PUBLIC_SYNTHETIC_${portType}_PORT_${row + 1}`,
		secondary_aliases: "",
		attachment_scope: "PUBLIC_SYNTHETIC_RAIL_SCOPE",
		attachment_alias: `PUBLIC_SYNTHETIC_ROUTE_${row + 1}`,
		station_mm: "500",
		side: "CENTER",
		lateral_offset_mm: "0",
		direction,
		direction_evidence: "DECLARED",
		port_type: portType,
		physical_group_key: physicalGroupKey,
		physical_group_kind: portType,
		organization_alias: "",
		source_x_mm: "",
		source_z_mm: "",
	});
}

function proposalArtifact(rows: readonly SyntheticStationRow[]) {
	const csv = [
		OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(","),
		...rows.map((row) =>
			OPENFAB_STATION_PROPOSAL_V1_HEADERS.map((header) => csvCell(row[header])).join(","),
		),
	].join("\n");
	const parsed = parseOpenFabStationProposalCsv(new TextEncoder().encode(csv));
	if (!parsed.ok) throw new Error(`Synthetic proposal failed: ${parsed.failure.code}`);
	return parsed.artifact;
}

function csvCell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function straightDocument(): RailDocument {
	const seed = new RailDocument();
	const construction = planRailConstruction(seed.map, { x: 0, y: 0 }, { x: 24, y: 0 });
	if (!seed.commit(construction)) throw new Error("Synthetic straight rail could not be built.");
	return RailDocument.fromLoadedMap(seed.map, 7, {
		nextPortId: START_PORT_ID,
		nextEquipmentGroupId: START_GROUP_ID,
		ports: [],
		equipmentGroups: [],
	});
}

function requireArrayBuffers(transfers: readonly Transferable[]): ArrayBuffer[] {
	return transfers.map((transfer) => {
		if (!(transfer instanceof ArrayBuffer)) {
			throw new Error("Synthetic rail snapshot exposed a non-buffer transfer.");
		}
		return transfer;
	});
}
