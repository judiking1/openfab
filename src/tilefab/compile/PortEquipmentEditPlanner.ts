import type {
	EquipmentGroupRecord,
	OhbEquipmentGroup,
	PortEquipmentState,
} from "../core/EquipmentGroup";
import {
	createInvalidPortEquipmentMutationPlan,
	createPortEquipmentMutationPlan,
	type PortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import { allocatePortEquipmentRecordIds } from "../core/PortEquipmentIdAllocator";
import { portRecordEquals, type PortRecord } from "../core/PortRecord";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
	portSlotRecord,
} from "./PortSlotCompiler";

export interface PortEquipmentSelectionRecord {
	readonly port: PortRecord;
	readonly equipmentGroup: EquipmentGroupRecord;
}

interface OhbEquipmentSelectionRecord {
	readonly port: PortRecord;
	readonly equipmentGroup: OhbEquipmentGroup;
}

export function resolvePortEquipmentSelection(
	state: PortEquipmentState,
	portId: number,
): PortEquipmentSelectionRecord | null {
	const port = state.ports.find((candidate) => candidate.id === portId);
	if (!port) return null;
	const equipmentGroup = state.equipmentGroups.find(
		(candidate) => candidate.id === port.equipmentGroupId,
	);
	return equipmentGroup ? Object.freeze({ port, equipmentGroup }) : null;
}

export function planEraseEquipmentGroup(
	state: PortEquipmentState,
	equipmentGroupId: number,
	baseRevision: number,
	basePatchSequence: number,
): PortEquipmentMutationPlan {
	const group = state.equipmentGroups.find((candidate) => candidate.id === equipmentGroupId);
	if (!group) {
		return invalid(
			"erase-port-equipment",
			baseRevision,
			basePatchSequence,
			`Equipment group ${equipmentGroupId} no longer exists.`,
		);
	}
	const ports = group.portIds
		.map((portId) => state.ports.find((port) => port.id === portId))
		.filter((port): port is PortRecord => port !== undefined)
		.sort((left, right) => left.id - right.id);
	if (ports.length !== group.portIds.length) {
		return invalid(
			"erase-port-equipment",
			baseRevision,
			basePatchSequence,
			`Equipment group ${equipmentGroupId} has an incomplete port set.`,
		);
	}
	return createPortEquipmentMutationPlan(
		"erase-port-equipment",
		baseRevision,
		basePatchSequence,
		ports.map((port) => ({ id: port.id, before: port, after: null })),
		[{ id: group.id, before: group, after: null }],
	);
}

export function planMoveOhbToSlot(
	slots: CompiledPortSlots,
	row: number,
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	equipmentGroupId: number,
	baseRevision: number,
	basePatchSequence: number,
): PortEquipmentMutationPlan {
	const source = resolveSingleOhb(state, equipmentGroupId);
	if (typeof source === "string") {
		return invalid("edit-port-equipment", baseRevision, basePatchSequence, source);
	}
	const rowError = slotRowError(slots, row, availability, baseRevision, source.port.id);
	if (rowError) {
		return invalid("edit-port-equipment", baseRevision, basePatchSequence, rowError);
	}
	const moved = portSlotRecord(
		slots,
		row,
		source.port.id,
		source.equipmentGroup.id,
		source.port.barcode,
	);
	if (portRecordEquals(source.port, moved)) {
		return invalid(
			"edit-port-equipment",
			baseRevision,
			basePatchSequence,
			"Choose a different legal OHB slot.",
		);
	}
	return createPortEquipmentMutationPlan(
		"edit-port-equipment",
		baseRevision,
		basePatchSequence,
		[{ id: source.port.id, before: source.port, after: moved }],
		[],
	);
}

export function planCopyOhbToSlot(
	slots: CompiledPortSlots,
	row: number,
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	sourceEquipmentGroupId: number,
	baseRevision: number,
	basePatchSequence: number,
): PortEquipmentMutationPlan {
	const source = resolveSingleOhb(state, sourceEquipmentGroupId);
	if (typeof source === "string") {
		return invalid("place-ohb", baseRevision, basePatchSequence, source);
	}
	const rowError = slotRowError(slots, row, availability, baseRevision, 0);
	if (rowError) return invalid("place-ohb", baseRevision, basePatchSequence, rowError);
	let allocation: ReturnType<typeof allocatePortEquipmentRecordIds>;
	try {
		allocation = allocatePortEquipmentRecordIds(state, 1, 1);
	} catch (error) {
		return invalid(
			"place-ohb",
			baseRevision,
			basePatchSequence,
			error instanceof Error ? error.message : "OHB record IDs cannot be allocated.",
		);
	}
	const portId = allocation.portIds[0] as number;
	const equipmentGroupId = allocation.equipmentGroupIds[0] as number;
	const copiedPort = portSlotRecord(slots, row, portId, equipmentGroupId, `OHB-${portId}`);
	const copiedGroup = {
		id: equipmentGroupId,
		kind: source.equipmentGroup.kind,
		template: source.equipmentGroup.template,
		portIds: [portId],
	} as const;
	return createPortEquipmentMutationPlan(
		"place-ohb",
		baseRevision,
		basePatchSequence,
		[{ id: portId, before: null, after: copiedPort }],
		[{ id: equipmentGroupId, before: null, after: copiedGroup }],
	);
}

function resolveSingleOhb(
	state: PortEquipmentState,
	equipmentGroupId: number,
): OhbEquipmentSelectionRecord | string {
	const equipmentGroup = state.equipmentGroups.find(
		(candidate) => candidate.id === equipmentGroupId,
	);
	if (!equipmentGroup) return `Equipment group ${equipmentGroupId} no longer exists.`;
	if (equipmentGroup.kind !== "OHB" || equipmentGroup.portIds.length !== 1) {
		return "Only one-port OHB equipment can use the OHB slot editor.";
	}
	const port = state.ports.find((candidate) => candidate.id === equipmentGroup.portIds[0]);
	if (!port || port.equipmentGroupId !== equipmentGroup.id || port.portType !== "OHB") {
		return `OHB equipment group ${equipmentGroup.id} has an invalid reciprocal port.`;
	}
	return Object.freeze({ port, equipmentGroup });
}

function slotRowError(
	slots: CompiledPortSlots,
	row: number,
	availability: PortSlotAvailabilityIndex,
	baseRevision: number,
	ignoredPortId: number,
): string | null {
	if (slots.portType !== "OHB") return "OHB editing requires OHB slot buffers.";
	if (slots.revision !== baseRevision || availability.revision !== baseRevision) {
		return "OHB slot data is stale for the current rail revision.";
	}
	if (availability.portType !== "OHB") return "OHB slot availability has the wrong port type.";
	if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
		return `OHB slot row ${row} is outside the compiled slot buffer.`;
	}
	if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
		return `OHB slot row ${row} is not legal.`;
	}
	if (availability.statusFor(slots, row, ignoredPortId).status !== PORT_SLOT_STATUS.LEGAL) {
		return `OHB slot row ${row} is not currently available.`;
	}
	return null;
}

function invalid(
	kind: "place-ohb" | "edit-port-equipment" | "erase-port-equipment",
	baseRevision: number,
	basePatchSequence: number,
	reason: string,
): PortEquipmentMutationPlan {
	return createInvalidPortEquipmentMutationPlan(kind, baseRevision, basePatchSequence, reason);
}
