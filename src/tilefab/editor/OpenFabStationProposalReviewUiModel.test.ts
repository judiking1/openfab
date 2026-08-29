import { describe, expect, it } from "vitest";
import type { OpenFabStationProposalRow } from "../compile/OpenFabStationProposalArtifact";
import type { OpenFabStationProposalReviewAttachment } from "../compile/OpenFabStationProposalReviewAttachment";
import {
	classifyOpenFabStationProposalSourcePosition,
	createOpenFabStationProposalIncludeDecisionFromSelection,
	declaredOpenFabStationProposalDirection,
	declaredOpenFabStationProposalPortType,
	type OpenFabStationProposalReviewAttachmentSelection,
} from "./OpenFabStationProposalReviewUiModel";

describe("OpenFabStationProposalReviewUiModel", () => {
	it("uses only resolved declared type and direction as visible initial choices", () => {
		expect(declaredOpenFabStationProposalPortType(proposal())).toBe("EQ");
		expect(declaredOpenFabStationProposalDirection(proposal())).toBe("WITH_TRAVEL");
		expect(declaredOpenFabStationProposalPortType(proposal({ portType: "UNRESOLVED" }))).toBeNull();
		expect(declaredOpenFabStationProposalDirection(proposal({ direction: "UNKNOWN" }))).toBeNull();
	});

	it("classifies absent, exact, tolerant, and mismatched source positions", () => {
		expect(
			classifyOpenFabStationProposalSourcePosition(
				proposal({ sourceXMillimeters: null, sourceZMillimeters: null }),
				10_000,
				20_000,
			),
		).toBe("NOT_PROVIDED");
		expect(classifyOpenFabStationProposalSourcePosition(proposal(), 10_000, 20_000)).toBe(
			"CONFIRM_MATCH",
		);
		expect(classifyOpenFabStationProposalSourcePosition(proposal(), 10_001, 19_999)).toBe(
			"CONFIRM_MATCH",
		);
		expect(classifyOpenFabStationProposalSourcePosition(proposal(), 10_002, 20_000)).toBe(
			"ACKNOWLEDGE_MISMATCH",
		);
	});

	it("builds one exact reviewed include decision without adopting proposal placement", () => {
		const source = proposal();
		const selection = attachmentSelection();

		const decision = createOpenFabStationProposalIncludeDecisionFromSelection(
			source,
			selection,
			false,
		);

		expect(decision).toEqual({
			row: 7,
			disposition: "INCLUDE",
			identityAction: "CREATE_NEW",
			portType: "EQ",
			typeReview: "CONFIRM_DECLARED",
			attachmentReview: "USER_SELECTED_EXACT_ROUTE",
			route: selection.attachment.route,
			stationMillimeters: 500,
			stationReview: "OVERRIDE",
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			sideOffsetReview: "OVERRIDE",
			direction: "WITH_TRAVEL",
			directionReview: "CONFIRM_DECLARED",
			sourcePositionReview: "CONFIRM_MATCH",
		});
		expect(decision).not.toHaveProperty("portKey");
		expect(decision).not.toHaveProperty("organizationAlias");
	});

	it("requires an explicit acknowledgement for a source-position mismatch", () => {
		const mismatch = attachmentSelection({
			worldXMillimeters: 30_000,
			sourcePositionReview: "ACKNOWLEDGE_MISMATCH",
		});
		expect(() =>
			createOpenFabStationProposalIncludeDecisionFromSelection(proposal(), mismatch, false),
		).toThrow("must be acknowledged");
		expect(
			createOpenFabStationProposalIncludeDecisionFromSelection(proposal(), mismatch, true)
				.sourcePositionReview,
		).toBe("ACKNOWLEDGE_MISMATCH");
	});

	it("rejects stale or cross-type attachment evidence", () => {
		expect(() =>
			createOpenFabStationProposalIncludeDecisionFromSelection(
				proposal(),
				attachmentSelection({ sourcePositionReview: "ACKNOWLEDGE_MISMATCH" }),
				true,
			),
		).toThrow("evidence is stale");
		expect(() =>
			createOpenFabStationProposalIncludeDecisionFromSelection(
				proposal(),
				attachmentSelection({
					attachment: Object.freeze({ ...attachment(), portType: "OHB" }),
				}),
				false,
			),
		).toThrow("type does not match");
	});
});

function proposal(override: Partial<OpenFabStationProposalRow> = {}): OpenFabStationProposalRow {
	return Object.freeze({
		identityScope: "SOURCE",
		portKey: "P-1",
		secondaryAliases: Object.freeze([]),
		attachmentScope: "RAIL",
		attachmentAlias: "A-1",
		stationMillimeters: 1_000,
		side: "LEFT",
		lateralOffsetMillimeters: 250,
		direction: "WITH_TRAVEL",
		directionEvidence: "DECLARED",
		portType: "EQ",
		physicalGroupKey: "G-1",
		physicalGroupKind: "EQ",
		organizationAlias: "",
		sourceXMillimeters: 10_000,
		sourceZMillimeters: 20_000,
		...override,
	});
}

function attachment(): OpenFabStationProposalReviewAttachment {
	return Object.freeze({
		portType: "EQ",
		route: Object.freeze({ kind: "CARDINAL_CELL", x: 2, z: 3, from: 8, to: 2 }),
		stationMillimeters: 500,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
	});
}

function attachmentSelection(
	override: Partial<OpenFabStationProposalReviewAttachmentSelection> = {},
): OpenFabStationProposalReviewAttachmentSelection {
	return Object.freeze({
		request: Object.freeze({ row: 7, portType: "EQ", direction: "WITH_TRAVEL" }),
		attachment: attachment(),
		worldXMillimeters: 10_000,
		worldZMillimeters: 20_000,
		sourcePositionReview: "CONFIRM_MATCH",
		...override,
	});
}
