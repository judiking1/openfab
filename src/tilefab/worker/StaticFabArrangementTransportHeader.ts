import { completeCooperativeSteps } from "../core/CooperativeTask";
import { STATIC_FAB_ARRANGEMENT_MAX_ROOTS } from "../core/StaticFabArrangement";
import type { StaticFabArrangementPlan } from "../core/StaticFabArrangementPlan";
import type { PreparedStaticFabArrangement } from "./StaticFabArrangementProtocol";
import {
	STATIC_FAB_ARRANGEMENT_MAX_ORGANIZATIONS,
	staticFabArrangementMetadataShapeErrorSteps,
	staticFabArrangementPlanHeaderShapeError,
	staticFabArrangementPreparedEnvelopeShapeErrorSteps,
	staticFabArrangementTicketHeaderShapeError,
} from "./StaticFabArrangementResponseValidator";
import { transferDataObject as object } from "./TransferColumnCapture";

export type ArrangementPlanHeader = Omit<
	StaticFabArrangementPlan,
	| "cells"
	| "mutations"
	| "switchMutations"
	| "portMutations"
	| "equipmentGroupMutations"
	| "organizationMutations"
	| "relationshipMutations"
>;
export type ArrangementEnvelope = Omit<PreparedStaticFabArrangement, "plan">;

/** Only bounded whitelisted data is read or retained before cooperative column capture. */
export function ownArrangementEnvelope(input: unknown): ArrangementEnvelope {
	const raw = object(input, "arrangement envelope", ["ticket", "conflictCells"]);
	const owned = Object.freeze({
		...scalars(raw, [
			"valid",
			"failureCode",
			"reason",
			"conflictCount",
			"planningMilliseconds",
			"validationMilliseconds",
		]),
		conflictCells: ownArrangementCells(raw.conflictCells),
		ticket:
			raw.ticket === null
				? null
				: scalars(raw.ticket, [
						"ticketId",
						"validationLevel",
						"sourceRevision",
						"sourcePatchSequence",
						"sourceChecksum",
						"sourceNextAdvancedSwitchId",
						"sourceNextPortId",
						"sourceNextEquipmentGroupId",
						"sourceNextOrganizationId",
						"sourceNextRelationshipId",
						"intentFingerprint",
						"planFingerprint",
						"prospectiveChecksum",
						"prospectiveNextAdvancedSwitchId",
						"prospectiveNextPortId",
						"prospectiveNextEquipmentGroupId",
						"prospectiveNextOrganizationId",
						"prospectiveNextRelationshipId",
					]),
	});
	assertArrangementTransport(
		completeCooperativeSteps(staticFabArrangementPreparedEnvelopeShapeErrorSteps(owned)),
	);
	return owned as unknown as ArrangementEnvelope;
}

export function ownArrangementHeader(input: unknown, valid: boolean): ArrangementPlanHeader {
	const raw = object(input, "arrangement header", [
		"arrangement",
		"conflicts",
		"organizationImpactAuthorizations",
	]);
	const header = Object.freeze({
		...scalars(raw, [
			"kind",
			"baseRevision",
			"basePatchSequence",
			"valid",
			"reason",
			"issueCode",
			"nextOrganizationIdBefore",
			"nextOrganizationIdAfter",
			"nextRelationshipIdBefore",
			"nextRelationshipIdAfter",
		]),
		conflicts: ownArrangementCells(raw.conflicts),
		organizationImpactAuthorizations: dense(
			raw.organizationImpactAuthorizations,
			STATIC_FAB_ARRANGEMENT_MAX_ORGANIZATIONS,
			scalar,
		),
		arrangement: raw.arrangement === null ? null : ownMetadata(raw.arrangement),
	});
	assertArrangementTransport(
		staticFabArrangementPlanHeaderShapeError(header, valid ? "full" : "compact"),
	);
	if (valid)
		assertArrangementTransport(
			completeCooperativeSteps(staticFabArrangementMetadataShapeErrorSteps(header.arrangement)),
		);
	return header as unknown as ArrangementPlanHeader;
}

export function assertArrangementTicket(
	envelope: ArrangementEnvelope,
	header: ArrangementPlanHeader,
): void {
	assertArrangementTransport(staticFabArrangementTicketHeaderShapeError(envelope.ticket, header));
}

export function ownArrangementCells(value: unknown): StaticFabArrangementPlan["cells"] {
	return dense(value, 512, (item) =>
		scalars(item, ["x", "y"]),
	) as unknown as StaticFabArrangementPlan["cells"];
}

function ownMetadata(value: unknown): unknown {
	const raw = object(value, "arrangement metadata", ["translations", "affectedOrganizationIds"]);
	return Object.freeze({
		...scalars(raw, [
			"version",
			"axis",
			"mode",
			"maximumSnapErrorMeters",
			"rootCount",
			"moduleCount",
			"railEdgeCount",
			"advancedSwitchCount",
			"portCount",
			"equipmentGroupCount",
		]),
		affectedOrganizationIds: dense(
			raw.affectedOrganizationIds,
			STATIC_FAB_ARRANGEMENT_MAX_ORGANIZATIONS,
			scalar,
		),
		translations: dense(raw.translations, STATIC_FAB_ARRANGEMENT_MAX_ROOTS, (value) => {
			const translation = object(value, "arrangement translation", ["before", "after"]);
			const bounds = ["minX", "minZ", "maxXExclusive", "maxZExclusive"];
			return Object.freeze({
				...scalars(translation, ["key", "deltaX", "deltaZ"]),
				before: scalars(translation.before, bounds),
				after: scalars(translation.after, bounds),
			});
		}),
	});
}

function dense(
	value: unknown,
	maximum: number,
	copy: (item: unknown) => unknown,
): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum)
		throw new Error("Arrangement header array exceeds bounds.");
	const result: unknown[] = [];
	for (let i = 0; i < value.length; i++) {
		const field = Object.getOwnPropertyDescriptor(value, String(i));
		if (!field || !Object.hasOwn(field, "value"))
			throw new Error("Arrangement header requires dense data rows.");
		result.push(copy(field.value));
	}
	return Object.freeze(result);
}

function scalar(value: unknown): unknown {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		(typeof value === "string" && value.length <= 4096)
	)
		return value;
	throw new Error("Arrangement header requires bounded scalar fields.");
}

function scalars(input: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
	const raw = object(input, "arrangement scalar fields", keys);
	return Object.freeze(Object.fromEntries(keys.map((key) => [key, scalar(raw[key])])));
}

export function assertArrangementTransport(error: string | null): void {
	if (error) throw new Error(`Invalid arrangement transport: ${error}.`);
}
