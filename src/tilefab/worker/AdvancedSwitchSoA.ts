import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	advancedSwitchRecordError,
} from "../core/AdvancedSwitch";
import { assertTransferableTypedArray } from "./TransferableTypedArray";

export interface AdvancedSwitchRecordFieldsSoA {
	profileClasses: Uint8Array;
	origins: Int32Array;
	forwardDirections: Uint8Array;
	lateralDirections: Uint8Array;
	movementMasks: Uint8Array;
}

export function createAdvancedSwitchRecordFields(count: number): AdvancedSwitchRecordFieldsSoA {
	return {
		profileClasses: new Uint8Array(count),
		origins: new Int32Array(count * 2),
		forwardDirections: new Uint8Array(count),
		lateralDirections: new Uint8Array(count),
		movementMasks: new Uint8Array(count),
	};
}

export function writeAdvancedSwitchRecord(
	fields: AdvancedSwitchRecordFieldsSoA,
	index: number,
	record: AdvancedSwitchRecord,
): void {
	const error = advancedSwitchRecordError(record);
	if (error) throw new Error(`Advanced switch ${record.id}: ${error}.`);
	assertSignedInt32(record.origin.x, `Advanced switch ${record.id} origin x`);
	assertSignedInt32(record.origin.y, `Advanced switch ${record.id} origin y`);
	fields.profileClasses[index] = encodeAdvancedSwitchProfileClass(record.profileClass);
	fields.origins[index * 2] = record.origin.x;
	fields.origins[index * 2 + 1] = record.origin.y;
	fields.forwardDirections[index] = record.forward;
	fields.lateralDirections[index] = record.lateral;
	fields.movementMasks[index] = record.movementMask;
}

export function readAdvancedSwitchRecord(
	fields: AdvancedSwitchRecordFieldsSoA,
	index: number,
	id: number,
	label: string,
): AdvancedSwitchRecord {
	const profileClass = decodeAdvancedSwitchProfileClass(
		fields.profileClasses[index] as number,
		`${label} profile class`,
	);
	const record: AdvancedSwitchRecord = {
		id,
		profileClass,
		origin: {
			x: fields.origins[index * 2] as number,
			y: fields.origins[index * 2 + 1] as number,
		},
		forward: fields.forwardDirections[index] as AdvancedSwitchRecord["forward"],
		lateral: fields.lateralDirections[index] as AdvancedSwitchRecord["lateral"],
		movementMask: fields.movementMasks[index] as number,
	};
	const error = advancedSwitchRecordError(record);
	if (error) throw new Error(`${label}: ${error}.`);
	return record;
}

export function validateAdvancedSwitchRecordFieldLengths(
	fields: AdvancedSwitchRecordFieldsSoA,
	count: number,
	label: string,
): void {
	assertTransferableTypedArray(
		fields.profileClasses,
		Uint8Array,
		`${label} advanced switch profile classes`,
	);
	assertTransferableTypedArray(fields.origins, Int32Array, `${label} advanced switch origins`);
	assertTransferableTypedArray(
		fields.forwardDirections,
		Uint8Array,
		`${label} advanced switch forward directions`,
	);
	assertTransferableTypedArray(
		fields.lateralDirections,
		Uint8Array,
		`${label} advanced switch lateral directions`,
	);
	assertTransferableTypedArray(
		fields.movementMasks,
		Uint8Array,
		`${label} advanced switch movement masks`,
	);
	if (
		fields.profileClasses.length !== count ||
		fields.origins.length !== count * 2 ||
		fields.forwardDirections.length !== count ||
		fields.lateralDirections.length !== count ||
		fields.movementMasks.length !== count
	) {
		throw new Error(`${label} advanced switch SoA lengths do not match.`);
	}
}

export function assertEmptyAdvancedSwitchRecord(
	fields: AdvancedSwitchRecordFieldsSoA,
	index: number,
	label: string,
): void {
	if (
		(fields.profileClasses[index] as number) !== 0 ||
		(fields.origins[index * 2] as number) !== 0 ||
		(fields.origins[index * 2 + 1] as number) !== 0 ||
		(fields.forwardDirections[index] as number) !== 0 ||
		(fields.lateralDirections[index] as number) !== 0 ||
		(fields.movementMasks[index] as number) !== 0
	) {
		throw new Error(`${label} absent advanced switch payload must be zeroed.`);
	}
}

export function advancedSwitchRecordFieldTransfers(
	fields: AdvancedSwitchRecordFieldsSoA,
): Transferable[] {
	return [
		fields.profileClasses.buffer,
		fields.origins.buffer,
		fields.forwardDirections.buffer,
		fields.lateralDirections.buffer,
		fields.movementMasks.buffer,
	];
}

export function encodeAdvancedSwitchProfileClass(profileClass: AdvancedSwitchProfileClass): number {
	const code = ADVANCED_SWITCH_PROFILE_CLASSES.indexOf(profileClass);
	if (code < 0) throw new Error(`Unknown advanced switch profile class ${profileClass}.`);
	return code;
}

function decodeAdvancedSwitchProfileClass(code: number, label: string): AdvancedSwitchProfileClass {
	const profileClass = ADVANCED_SWITCH_PROFILE_CLASSES[code];
	if (!profileClass) throw new Error(`${label} ${code} is invalid.`);
	return profileClass;
}

function assertSignedInt32(value: number, label: string): void {
	if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
		throw new Error(`${label} ${value} is outside the signed 32-bit worker contract.`);
	}
}
