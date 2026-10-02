import { hasExactProcessLoopFields } from "../core/StaticFabProcessLoopTopologyEvidence";

export { hasExactProcessLoopFields } from "../core/StaticFabProcessLoopTopologyEvidence";

import type { StaticFabProcessLoopTopologyResult } from "../compile/StaticFabProcessLoopTopology";
import type { StaticFabProcessLoopTopologyColumns } from "./StaticFabProcessLoopTopologyColumns";

export const STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION = 1 as const;
export const STATIC_FAB_PROCESS_LOOP_TOPOLOGY_MAX_ERROR_LENGTH = 512;

/** Source identity is echoed for correlation; it is never standalone source/commit authority. */
export interface StaticFabProcessLoopTopologySourceIdentity {
	readonly revision: number;
	readonly patchSequence: number;
	readonly epoch: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly nextRelationshipId: number;
}

export interface StaticFabProcessLoopTopologyWorkerRequest {
	readonly type: "CHECK_STATIC_FAB_PROCESS_LOOP_TOPOLOGY";
	readonly version: typeof STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly source: StaticFabProcessLoopTopologySourceIdentity;
	readonly fingerprint: string;
	readonly columns: StaticFabProcessLoopTopologyColumns;
}

export type StaticFabProcessLoopTopologyWorkerResponse =
	| Readonly<{
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED";
			version: typeof STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION;
			requestId: number;
			source: StaticFabProcessLoopTopologySourceIdentity;
			fingerprint: string;
			result: StaticFabProcessLoopTopologyResult;
	  }>
	| Readonly<{
			type: "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_ERROR";
			version: typeof STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION;
			requestId: number;
			message: string;
	  }>;

export function staticFabProcessLoopTopologySourceIdentityIsValid(
	value: unknown,
): value is StaticFabProcessLoopTopologySourceIdentity {
	if (
		!hasExactProcessLoopFields(value, [
			"revision",
			"patchSequence",
			"epoch",
			"checksum",
			"nextAdvancedSwitchId",
			"nextPortId",
			"nextEquipmentGroupId",
			"nextOrganizationId",
			"nextRelationshipId",
		])
	)
		return false;
	if (typeof value.checksum !== "string" || !/^00000003(?::[0-9a-f]{8}){11}$/.test(value.checksum))
		return false;
	for (const key of ["revision", "patchSequence", "epoch"])
		if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) return false;
	for (const key of [
		"nextAdvancedSwitchId",
		"nextPortId",
		"nextEquipmentGroupId",
		"nextOrganizationId",
		"nextRelationshipId",
	])
		if (
			!Number.isSafeInteger(value[key]) ||
			(value[key] as number) < 1 ||
			(value[key] as number) > 0x80000000
		)
			return false;
	return true;
}

export function staticFabProcessLoopTopologySourceIdentitiesEqual(
	left: StaticFabProcessLoopTopologySourceIdentity,
	right: StaticFabProcessLoopTopologySourceIdentity,
): boolean {
	return (
		left.revision === right.revision &&
		left.patchSequence === right.patchSequence &&
		left.epoch === right.epoch &&
		left.checksum === right.checksum &&
		left.nextAdvancedSwitchId === right.nextAdvancedSwitchId &&
		left.nextPortId === right.nextPortId &&
		left.nextEquipmentGroupId === right.nextEquipmentGroupId &&
		left.nextOrganizationId === right.nextOrganizationId &&
		left.nextRelationshipId === right.nextRelationshipId
	);
}
