import {
	collectPortEquipmentIntegrityIssues,
	type PortEquipmentIntegrityIssue,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";

export interface PortEquipmentSelectionIdentity {
	readonly portId: number;
	readonly equipmentGroupId: number;
}

export interface ResolvedPortEquipmentSelection {
	readonly port: PortRecord;
	readonly equipmentGroup: PortEquipmentState["equipmentGroups"][number];
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
