import type { PortEquipmentState } from "./EquipmentGroup";
import { PORT_RECORD_MAX_ID } from "./PortRecord";

export interface PortEquipmentRecordIdAllocation {
	readonly portIds: readonly number[];
	readonly equipmentGroupIds: readonly number[];
}

/** Reserve deterministic positive signed-int32 IDs without mutating the authored cursor state. */
export function allocatePortEquipmentRecordIds(
	state: Pick<PortEquipmentState, "nextPortId" | "nextEquipmentGroupId">,
	portCount: number,
	equipmentGroupCount: number,
): PortEquipmentRecordIdAllocation {
	assertAllocationCount(portCount, "port");
	assertAllocationCount(equipmentGroupCount, "equipment group");
	assertCursor(state.nextPortId, "port");
	assertCursor(state.nextEquipmentGroupId, "equipment group");
	if (portCount > 0 && state.nextPortId + portCount - 1 > PORT_RECORD_MAX_ID) {
		throw new RangeError("No positive signed-int32 port IDs remain for this operation.");
	}
	if (
		equipmentGroupCount > 0 &&
		state.nextEquipmentGroupId + equipmentGroupCount - 1 > PORT_RECORD_MAX_ID
	) {
		throw new RangeError("No positive signed-int32 equipment group IDs remain for this operation.");
	}
	return Object.freeze({
		portIds: Object.freeze(
			Array.from({ length: portCount }, (_, index) => state.nextPortId + index),
		),
		equipmentGroupIds: Object.freeze(
			Array.from({ length: equipmentGroupCount }, (_, index) => state.nextEquipmentGroupId + index),
		),
	});
}

function assertAllocationCount(count: number, label: string): void {
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new RangeError(`${label} allocation count must be a non-negative safe integer.`);
	}
}

function assertCursor(cursor: number, label: string): void {
	if (!Number.isInteger(cursor) || cursor < 1 || cursor > PORT_RECORD_MAX_ID + 1) {
		throw new RangeError(`${label} ID cursor is outside the signed-int32 allocation range.`);
	}
}
