import type { AdvancedSwitchMutation } from "./AdvancedSwitch";
import type { EquipmentGroupMutation } from "./EquipmentGroup";
import type { PortMutation } from "./PortRecord";
import type { RailMutation } from "./paint";
import type {
	StaticFabArrangementAxis,
	StaticFabArrangementMode,
	StaticFabArrangementTranslation,
} from "./StaticFabArrangement";
import type { StaticFabOrganizationMutation } from "./StaticFabOrganization";
import type { Cell } from "./TileMap";

export const STATIC_FAB_ARRANGEMENT_PLAN_KIND = "arrange-static-fab" as const;
export const STATIC_FAB_ARRANGEMENT_PLAN_VERSION = 1 as const;

export type StaticFabArrangementPlanIssueCode =
	| "INVALID_ARRANGEMENT"
	| "STALE_SELECTION"
	| "EMPTY_SELECTION"
	| "LIMIT_EXCEEDED"
	| "ROOT_OVERLAP"
	| "EXTERNAL_ATTACHMENT"
	| "TARGET_COLLISION"
	| "TARGET_OVERLAP"
	| "COORDINATE_OVERFLOW"
	| "LEGACY_EQUIPMENT_UNSUPPORTED"
	| "PORT_DEPENDENCY"
	| "TOPOLOGY_INVALID"
	| "PORT_LAYOUT_INVALID"
	| "CLEARANCE_INVALID"
	| "ORGANIZATION_INVALID"
	| "COMPILE_FAILURE";

export interface StaticFabArrangementPlanMetadata {
	readonly version: typeof STATIC_FAB_ARRANGEMENT_PLAN_VERSION;
	readonly axis: StaticFabArrangementAxis;
	readonly mode: StaticFabArrangementMode;
	readonly translations: readonly StaticFabArrangementTranslation[];
	readonly maximumSnapErrorMeters: number;
	readonly rootCount: number;
	readonly moduleCount: number;
	readonly railEdgeCount: number;
	readonly advancedSwitchCount: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly affectedOrganizationIds: readonly number[];
}

/**
 * One existing-ID relocation proposal. Worker certification is layered on top of this portable
 * mutation graph; rendering objects are never part of the command truth.
 */
export interface StaticFabArrangementPlan {
	readonly kind: typeof STATIC_FAB_ARRANGEMENT_PLAN_KIND;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly valid: boolean;
	readonly reason: string;
	readonly issueCode: StaticFabArrangementPlanIssueCode | null;
	readonly cells: readonly Cell[];
	readonly conflicts: readonly Cell[];
	readonly mutations: readonly RailMutation[];
	readonly switchMutations: readonly AdvancedSwitchMutation[];
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupMutations: readonly EquipmentGroupMutation[];
	readonly organizationMutations: readonly StaticFabOrganizationMutation[];
	readonly organizationImpactAuthorizations: readonly number[];
	readonly nextOrganizationIdBefore: number;
	readonly nextOrganizationIdAfter: number;
	readonly arrangement: StaticFabArrangementPlanMetadata | null;
}
