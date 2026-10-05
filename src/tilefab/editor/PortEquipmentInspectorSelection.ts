import {
	collectPortEquipmentIntegrityIssues,
	type PortEquipmentIntegrityIssue,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import { resolvePortEquipmentLoopEditOwnership } from "../core/PortEquipmentLoopEdit";
import type { PortRecord } from "../core/PortRecord";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";

export interface PortEquipmentSelectionIdentity {
	readonly portId: number;
	readonly equipmentGroupId: number;
}

export interface ResolvedPortEquipmentSelection {
	readonly port: PortRecord;
	readonly equipmentGroup: PortEquipmentState["equipmentGroups"][number];
}

export type PortEquipmentActionBlockCode =
	| "SELECTION_NOT_EDITABLE"
	| "DIRECTLY_OWNED"
	| "LEGACY_CUSTOM"
	| "OHB_MEMBERSHIP_UNSUPPORTED";

export type PortEquipmentActionDecision =
	| { readonly allowed: true; readonly code: null; readonly reason: null }
	| {
			readonly allowed: false;
			readonly code: PortEquipmentActionBlockCode;
			readonly reason: string;
	  };

export interface PortEquipmentActionAvailability {
	readonly move: PortEquipmentActionDecision;
	readonly copy: PortEquipmentActionDecision;
	readonly editMembership: PortEquipmentActionDecision;
	readonly delete: PortEquipmentActionDecision;
}

export interface PortEquipmentActionContext {
	/** Result of resolveEditablePortEquipmentSelection, not the display-only resolver. */
	readonly editableSelection: ResolvedPortEquipmentSelection | null;
	/** Direct stored equipment membership in any organization from the same current source. */
	readonly directlyOwned: boolean;
	/** Current document source; omission keeps the older fail-closed ownership restriction. */
	readonly organizations?: StaticFabOrganizationState;
}

const EQUIPMENT_ACTION_ALLOWED: PortEquipmentActionDecision = Object.freeze({
	allowed: true,
	code: null,
	reason: null,
});

function blockedEquipmentAction(
	code: PortEquipmentActionBlockCode,
	reason: string,
): PortEquipmentActionDecision {
	return Object.freeze({ allowed: false, code, reason });
}

/**
 * Selection capability only, not mutation authority or a placement-validity result. Handlers must
 * resolve selection/integrity and direct ownership again from the current document before changing
 * tools or capturing a draft. Existing project/mirror/session guards and planners remain required.
 */
export function resolvePortEquipmentActionAvailability({
	editableSelection,
	directlyOwned,
	organizations,
}: PortEquipmentActionContext): PortEquipmentActionAvailability {
	if (!editableSelection) {
		const blocked = blockedEquipmentAction(
			"SELECTION_NOT_EDITABLE",
			"편집할 장비 포트를 다시 선택하세요 · 무결성 문제가 있으면 검사 화면에서 먼저 복구하세요",
		);
		return Object.freeze({
			move: blocked,
			copy: blocked,
			editMembership: blocked,
			delete: blocked,
		});
	}
	const group = editableSelection.equipmentGroup;
	const ownership = organizations
		? resolvePortEquipmentLoopEditOwnership(organizations, group.id)
		: null;
	const hasOwner = ownership ? ownership.ownerOrganizationIds.length > 0 : directlyOwned;
	const ownershipBlock = ownership?.reason
		? blockedEquipmentAction("DIRECTLY_OWNED", ownership.reason)
		: !ownership && directlyOwned
			? blockedEquipmentAction(
					"DIRECTLY_OWNED",
					"이 장비는 조직에 소속되어 있습니다 · 소속을 먼저 분리한 뒤 이동·Port 편집·철거하세요",
				)
			: null;
	const customBlock =
		group.kind === "STK" && group.template === "CUSTOM"
			? blockedEquipmentAction(
					"LEGACY_CUSTOM",
					"이전 CUSTOM Stocker는 이동·복제·Port 편집을 지원하지 않습니다 · FLEX Stocker로 새로 배치하세요",
				)
			: null;
	return Object.freeze({
		move: ownershipBlock ?? customBlock ?? EQUIPMENT_ACTION_ALLOWED,
		copy: customBlock ?? EQUIPMENT_ACTION_ALLOWED,
		editMembership:
			group.kind === "OHB"
				? blockedEquipmentAction(
						"OHB_MEMBERSHIP_UNSUPPORTED",
						"OHB는 한 개 Port를 사용합니다 · Port 구성 편집은 EQ 또는 Stocker에서 사용할 수 있습니다",
					)
				: (ownershipBlock ?? customBlock ?? EQUIPMENT_ACTION_ALLOWED),
		delete: hasOwner
			? (ownershipBlock ??
				blockedEquipmentAction(
					"DIRECTLY_OWNED",
					"이 장비는 조직에 소속되어 있습니다 · 철거하려면 소속을 먼저 분리하세요",
				))
			: EQUIPMENT_ACTION_ALLOWED,
	});
}

/** Resolve an exact display target even when the surrounding authored relationship is invalid. */
export function resolveExactPortEquipmentSelection(
	state: PortEquipmentState,
	selection: PortEquipmentSelectionIdentity,
): ResolvedPortEquipmentSelection | null {
	const port = state.ports.find((candidate) => candidate.id === selection.portId);
	const equipmentGroup = state.equipmentGroups.find(
		(candidate) => candidate.id === selection.equipmentGroupId,
	);
	return port && equipmentGroup ? Object.freeze({ port, equipmentGroup }) : null;
}

/**
 * Editing is fail-closed for the entire static FAB equipment state. Every mutation is validated
 * atomically against that whole state, so an unrelated damaged group or cursor must not leave an
 * action enabled that the document will reject.
 */
export function resolveEditablePortEquipmentSelection(
	state: PortEquipmentState,
	selection: PortEquipmentSelectionIdentity,
	integrityIssues: readonly PortEquipmentIntegrityIssue[] = collectPortEquipmentIntegrityIssues(
		state,
	),
): ResolvedPortEquipmentSelection | null {
	if (integrityIssues.length > 0) return null;
	const matchingPortRows: number[] = [];
	const matchingGroupRows: number[] = [];
	for (let row = 0; row < state.ports.length; row++) {
		if (state.ports[row]?.id === selection.portId) matchingPortRows.push(row);
	}
	for (let row = 0; row < state.equipmentGroups.length; row++) {
		if (state.equipmentGroups[row]?.id === selection.equipmentGroupId) matchingGroupRows.push(row);
	}
	if (matchingPortRows.length !== 1 || matchingGroupRows.length !== 1) return null;

	const portRow = matchingPortRows[0] as number;
	const equipmentGroupRow = matchingGroupRows[0] as number;
	const port = state.ports[portRow] as PortRecord;
	const equipmentGroup = state.equipmentGroups[
		equipmentGroupRow
	] as PortEquipmentState["equipmentGroups"][number];
	if (
		port.equipmentGroupId !== equipmentGroup.id ||
		port.portType !== equipmentGroup.kind ||
		equipmentGroup.portIds.filter((portId) => portId === port.id).length !== 1
	) {
		return null;
	}
	const claimingGroups = state.equipmentGroups.filter((candidate) =>
		candidate.portIds.includes(port.id),
	);
	if (claimingGroups.length !== 1 || claimingGroups[0] !== equipmentGroup) return null;
	return Object.freeze({ port, equipmentGroup });
}
