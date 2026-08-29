import type { OpenFabStationProposalRow } from "../compile/OpenFabStationProposalArtifact";
import {
	OPENFAB_STATION_PROPOSAL_SOURCE_POSITION_TOLERANCE_MILLIMETERS,
	type OpenFabStationProposalIncludeDecision,
} from "../compile/OpenFabStationProposalReview";
import type { OpenFabStationProposalReviewAttachment } from "../compile/OpenFabStationProposalReviewAttachment";
import { PORT_DIRECTIONS, PORT_TYPES, type PortDirection, type PortType } from "../core/PortRecord";

export interface OpenFabStationProposalReviewAttachmentRequest {
	readonly row: number;
	readonly portType: PortType;
	readonly direction: PortDirection;
}

export type OpenFabStationProposalSourcePositionReview =
	| "NOT_PROVIDED"
	| "CONFIRM_MATCH"
	| "ACKNOWLEDGE_MISMATCH";

export interface OpenFabStationProposalReviewAttachmentSelection {
	readonly request: OpenFabStationProposalReviewAttachmentRequest;
	readonly attachment: OpenFabStationProposalReviewAttachment;
	readonly worldXMillimeters: number;
	readonly worldZMillimeters: number;
	readonly sourcePositionReview: OpenFabStationProposalSourcePositionReview;
}

export function declaredOpenFabStationProposalPortType(
	proposal: OpenFabStationProposalRow,
): PortType | null {
	return PORT_TYPES.includes(proposal.portType as PortType)
		? (proposal.portType as PortType)
		: null;
}

export function declaredOpenFabStationProposalDirection(
	proposal: OpenFabStationProposalRow,
): PortDirection | null {
	return PORT_DIRECTIONS.includes(proposal.direction as PortDirection)
		? (proposal.direction as PortDirection)
		: null;
}

export function classifyOpenFabStationProposalSourcePosition(
	proposal: OpenFabStationProposalRow,
	worldXMillimeters: number,
	worldZMillimeters: number,
): OpenFabStationProposalSourcePositionReview {
	if (proposal.sourceXMillimeters === null || proposal.sourceZMillimeters === null) {
		return "NOT_PROVIDED";
	}
	if (!Number.isInteger(worldXMillimeters) || !Number.isInteger(worldZMillimeters)) {
		throw new TypeError("Selected station world position must use integer millimeters.");
	}
	return Math.abs(proposal.sourceXMillimeters - worldXMillimeters) <=
		OPENFAB_STATION_PROPOSAL_SOURCE_POSITION_TOLERANCE_MILLIMETERS &&
		Math.abs(proposal.sourceZMillimeters - worldZMillimeters) <=
			OPENFAB_STATION_PROPOSAL_SOURCE_POSITION_TOLERANCE_MILLIMETERS
		? "CONFIRM_MATCH"
		: "ACKNOWLEDGE_MISMATCH";
}

export function createOpenFabStationProposalIncludeDecisionFromSelection(
	proposal: OpenFabStationProposalRow,
	selection: OpenFabStationProposalReviewAttachmentSelection,
	acknowledgeSourcePositionMismatch: boolean,
): OpenFabStationProposalIncludeDecision {
	const { request, attachment } = selection;
	if (!Number.isInteger(request.row) || request.row < 0) {
		throw new RangeError("Station proposal review row must be a non-negative integer.");
	}
	if (!PORT_TYPES.includes(request.portType) || attachment.portType !== request.portType) {
		throw new TypeError("Station proposal review attachment type does not match the request.");
	}
	if (!PORT_DIRECTIONS.includes(request.direction)) {
		throw new TypeError("Station proposal review direction is invalid.");
	}
	const sourcePositionReview = classifyOpenFabStationProposalSourcePosition(
		proposal,
		selection.worldXMillimeters,
		selection.worldZMillimeters,
	);
	if (sourcePositionReview !== selection.sourcePositionReview) {
		throw new TypeError("Station proposal source-position evidence is stale.");
	}
	if (sourcePositionReview === "ACKNOWLEDGE_MISMATCH" && !acknowledgeSourcePositionMismatch) {
		throw new TypeError("Station proposal source-position mismatch must be acknowledged.");
	}

	const directionReview =
		proposal.direction === request.direction && proposal.directionEvidence === "DECLARED"
			? "CONFIRM_DECLARED"
			: proposal.direction === request.direction && proposal.directionEvidence === "HEURISTIC"
				? "CONFIRM_HEURISTIC"
				: "OVERRIDE";
	return Object.freeze({
		row: request.row,
		disposition: "INCLUDE",
		identityAction: "CREATE_NEW",
		portType: request.portType,
		typeReview: proposal.portType === request.portType ? "CONFIRM_DECLARED" : "OVERRIDE",
		attachmentReview: "USER_SELECTED_EXACT_ROUTE",
		route: attachment.route,
		stationMillimeters: attachment.stationMillimeters,
		stationReview:
			proposal.stationMillimeters === attachment.stationMillimeters
				? "CONFIRM_DECLARED"
				: "OVERRIDE",
		side: attachment.side,
		lateralOffsetMillimeters: attachment.lateralOffsetMillimeters,
		sideOffsetReview:
			proposal.side === attachment.side &&
			proposal.lateralOffsetMillimeters === attachment.lateralOffsetMillimeters
				? "CONFIRM_DECLARED"
				: "OVERRIDE",
		direction: request.direction,
		directionReview,
		sourcePositionReview,
	});
}
