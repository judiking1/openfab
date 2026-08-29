import {
	copyEquipmentGroupRecord,
	copyPortEquipmentState,
	createCanonicalPortEquipmentStateBuilder,
	EQ_MAXIMUM_PORT_COUNT,
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import { copyPortRecord, type PortMutation, type PortRecord } from "../core/PortRecord";
import type { Direction } from "../core/railShape";
import { hasTransferableArrayBuffer, isTransferableTypedArray } from "./TransferableTypedArray";

export const PORT_EQUIPMENT_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const ROUTE_CARDINAL = 0;
const ROUTE_ADVANCED_SWITCH = 1;
const PROFILE_CLASSES = ["A", "B", "C", "D"] as const;
const ROUTE_ROLES = ["INPUT", "THROAT", "OUTPUT"] as const;
const PORT_SIDES = ["CENTER", "LEFT", "RIGHT"] as const;
const PORT_DIRECTIONS = ["WITH_TRAVEL", "AGAINST_TRAVEL"] as const;
const PORT_TYPES = ["OHB", "EQ", "STK"] as const;
const GROUP_KINDS = ["OHB", "EQ", "STK"] as const;
const GROUP_TEMPLATES = [
	"SINGLE",
	"CUSTOM",
	"FOUR_PORT",
	"SIX_PORT",
	"BACK_TO_BACK",
	"FLEX",
] as const;
const MAXIMUM_EQUIPMENT_GROUP_PORT_COUNT = EQ_MAXIMUM_PORT_COUNT;
type NumericArray = Int8Array | Uint8Array | Uint16Array | Int32Array | Uint32Array;

export interface PortRecordFieldsSoA {
	readonly equipmentGroupIds: Int32Array;
	readonly routeKinds: Uint8Array;
	readonly routeXs: Int32Array;
	readonly routeZs: Int32Array;
	readonly routeFromDirections: Uint8Array;
	readonly routeToDirections: Uint8Array;
	readonly routeSwitchIds: Int32Array;
	readonly routeProfileClasses: Uint8Array;
	readonly routeRoles: Uint8Array;
	readonly routePortIndices: Int8Array;
	readonly routeSegmentOrdinals: Uint16Array;
	readonly stationMillimeters: Int32Array;
	readonly sides: Uint8Array;
	readonly lateralOffsetMillimeters: Uint32Array;
	readonly directions: Uint8Array;
	readonly portTypes: Uint8Array;
	readonly barcodes: readonly (string | null)[];
}

export interface EquipmentGroupFieldsSoA {
	readonly kinds: Uint8Array;
	readonly portOffsets: Uint32Array;
	readonly portIds: Int32Array;
	readonly templates: Uint8Array;
	readonly pitchMillimeters: Uint32Array;
	readonly recipes: readonly (string | null)[];
}

export interface PortEquipmentSnapshot {
	readonly schemaVersion: typeof PORT_EQUIPMENT_SNAPSHOT_SCHEMA_VERSION;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly portIds: Int32Array;
	readonly ports: PortRecordFieldsSoA;
	readonly equipmentGroupIds: Int32Array;
	readonly equipmentGroups: EquipmentGroupFieldsSoA;
}

export interface PortEquipmentPatchSoA {
	readonly portIds: Int32Array;
	readonly portBeforePresent: Uint8Array;
	readonly portBefore: PortRecordFieldsSoA;
	readonly portAfterPresent: Uint8Array;
	readonly portAfter: PortRecordFieldsSoA;
	readonly equipmentGroupIds: Int32Array;
	readonly equipmentGroupBeforePresent: Uint8Array;
	readonly equipmentGroupBefore: EquipmentGroupFieldsSoA;
	readonly equipmentGroupAfterPresent: Uint8Array;
	readonly equipmentGroupAfter: EquipmentGroupFieldsSoA;
}

export interface EncodedPortEquipmentPatch {
	readonly fields: PortEquipmentPatchSoA;
	readonly transfer: ArrayBuffer[];
}

export function encodePortEquipmentPatch(
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
): EncodedPortEquipmentPatch {
	const portIds = new Int32Array(portChanges.length);
	const portBeforePresent = new Uint8Array(portChanges.length);
	const portBefore = createPortRecordFields(portChanges.length);
	const portAfterPresent = new Uint8Array(portChanges.length);
	const portAfter = createPortRecordFields(portChanges.length);
	for (let index = 0; index < portChanges.length; index++) {
		const change = portChanges[index] as PortMutation;
		portIds[index] = change.id;
		if (change.before) {
			portBeforePresent[index] = 1;
			writePortRecord(portBefore, index, change.before);
		}
		if (change.after) {
			portAfterPresent[index] = 1;
			writePortRecord(portAfter, index, change.after);
		}
	}
	const equipmentGroupIds = new Int32Array(equipmentGroupChanges.length);
	const equipmentGroupBeforePresent = new Uint8Array(equipmentGroupChanges.length);
	const equipmentGroupAfterPresent = new Uint8Array(equipmentGroupChanges.length);
	const equipmentGroupBefore = createMutationEquipmentGroupFields(
		equipmentGroupChanges.map((change) => change.before),
		equipmentGroupBeforePresent,
	);
	const equipmentGroupAfter = createMutationEquipmentGroupFields(
		equipmentGroupChanges.map((change) => change.after),
		equipmentGroupAfterPresent,
	);
	for (let index = 0; index < equipmentGroupChanges.length; index++) {
		equipmentGroupIds[index] = (equipmentGroupChanges[index] as EquipmentGroupMutation).id;
	}
	const fields: PortEquipmentPatchSoA = {
		portIds,
		portBeforePresent,
		portBefore,
		portAfterPresent,
		portAfter,
		equipmentGroupIds,
		equipmentGroupBeforePresent,
		equipmentGroupBefore,
		equipmentGroupAfterPresent,
		equipmentGroupAfter,
	};
	return Object.freeze({ fields, transfer: portEquipmentPatchTransfers(fields) });
}

/** Encode the same patch columns with caller-controlled checkpoints between immutable records. */
export async function encodePortEquipmentPatchCooperatively(
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<EncodedPortEquipmentPatch> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Port/equipment patch encoding operation budget must be positive.");
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const portIds = new Int32Array(portChanges.length);
	const portBeforePresent = new Uint8Array(portChanges.length);
	const portBefore = createPortRecordFields(portChanges.length);
	const portAfterPresent = new Uint8Array(portChanges.length);
	const portAfter = createPortRecordFields(portChanges.length);
	for (let index = 0; index < portChanges.length; index += 1) {
		const change = portChanges[index] as PortMutation;
		portIds[index] = change.id;
		if (change.before) {
			portBeforePresent[index] = 1;
			writePortRecord(portBefore, index, change.before);
		}
		if (change.after) {
			portAfterPresent[index] = 1;
			writePortRecord(portAfter, index, change.after);
		}
		await consumeOperation();
	}
	const equipmentGroupIds = new Int32Array(equipmentGroupChanges.length);
	const equipmentGroupBeforePresent = new Uint8Array(equipmentGroupChanges.length);
	const equipmentGroupAfterPresent = new Uint8Array(equipmentGroupChanges.length);
	const equipmentGroupBefore = await createMutationEquipmentGroupFieldsCooperatively(
		equipmentGroupChanges,
		"before",
		equipmentGroupBeforePresent,
		consumeOperation,
	);
	const equipmentGroupAfter = await createMutationEquipmentGroupFieldsCooperatively(
		equipmentGroupChanges,
		"after",
		equipmentGroupAfterPresent,
		consumeOperation,
	);
	for (let index = 0; index < equipmentGroupChanges.length; index += 1) {
		equipmentGroupIds[index] = (equipmentGroupChanges[index] as EquipmentGroupMutation).id;
		await consumeOperation();
	}
	const fields: PortEquipmentPatchSoA = {
		portIds,
		portBeforePresent,
		portBefore,
		portAfterPresent,
		portAfter,
		equipmentGroupIds,
		equipmentGroupBeforePresent,
		equipmentGroupBefore,
		equipmentGroupAfterPresent,
		equipmentGroupAfter,
	};
	await checkpoint();
	return Object.freeze({ fields, transfer: portEquipmentPatchTransfers(fields) });
}

export function decodePortEquipmentPatch(fields: PortEquipmentPatchSoA): {
	readonly portChanges: readonly PortMutation[];
	readonly equipmentGroupChanges: readonly EquipmentGroupMutation[];
} {
	validatePatchShape(fields);
	const portChanges = new Array<PortMutation>(fields.portIds.length);
	for (let index = 0; index < portChanges.length; index++) {
		const beforePresent = presence(
			fields.portBeforePresent[index] as number,
			`port ${index} before`,
		);
		const afterPresent = presence(fields.portAfterPresent[index] as number, `port ${index} after`);
		if (!beforePresent && !afterPresent) throw new Error(`Port patch row ${index} is empty.`);
		if (!beforePresent) assertEmptyPortFields(fields.portBefore, index);
		if (!afterPresent) assertEmptyPortFields(fields.portAfter, index);
		const id = fields.portIds[index] as number;
		portChanges[index] = {
			id,
			before: beforePresent ? readPortFromFields(id, fields.portBefore, index) : null,
			after: afterPresent ? readPortFromFields(id, fields.portAfter, index) : null,
		};
	}
	const equipmentGroupChanges = new Array<EquipmentGroupMutation>(fields.equipmentGroupIds.length);
	for (let index = 0; index < equipmentGroupChanges.length; index++) {
		const beforePresent = presence(
			fields.equipmentGroupBeforePresent[index] as number,
			`equipment group ${index} before`,
		);
		const afterPresent = presence(
			fields.equipmentGroupAfterPresent[index] as number,
			`equipment group ${index} after`,
		);
		if (!beforePresent && !afterPresent) throw new Error(`Equipment patch row ${index} is empty.`);
		if (!beforePresent) assertEmptyEquipmentFields(fields.equipmentGroupBefore, index);
		if (!afterPresent) assertEmptyEquipmentFields(fields.equipmentGroupAfter, index);
		const id = fields.equipmentGroupIds[index] as number;
		equipmentGroupChanges[index] = {
			id,
			before: beforePresent
				? readEquipmentFromFields(id, fields.equipmentGroupBefore, index)
				: null,
			after: afterPresent ? readEquipmentFromFields(id, fields.equipmentGroupAfter, index) : null,
		};
	}
	return Object.freeze({
		portChanges: Object.freeze(portChanges),
		equipmentGroupChanges: Object.freeze(equipmentGroupChanges),
	});
}

export function portEquipmentPatchTransfers(fields: PortEquipmentPatchSoA): ArrayBuffer[] {
	return [
		fields.portIds.buffer,
		fields.portBeforePresent.buffer,
		...portFieldArrays(fields.portBefore).map((values) => values.buffer),
		fields.portAfterPresent.buffer,
		...portFieldArrays(fields.portAfter).map((values) => values.buffer),
		fields.equipmentGroupIds.buffer,
		fields.equipmentGroupBeforePresent.buffer,
		...equipmentFieldArrays(fields.equipmentGroupBefore).map((values) => values.buffer),
		fields.equipmentGroupAfterPresent.buffer,
		...equipmentFieldArrays(fields.equipmentGroupAfter).map((values) => values.buffer),
	] as ArrayBuffer[];
}

export function createPortEquipmentSnapshot(state: PortEquipmentState): PortEquipmentSnapshot {
	const canonical = copyPortEquipmentState(state);
	const portIds = new Int32Array(canonical.ports.length);
	const ports = createPortRecordFields(canonical.ports.length);
	for (let index = 0; index < canonical.ports.length; index++) {
		const port = canonical.ports[index] as PortRecord;
		portIds[index] = port.id;
		writePortRecord(ports, index, port);
	}
	const equipmentGroupIds = new Int32Array(canonical.equipmentGroups.length);
	const totalGroupPorts = canonical.equipmentGroups.reduce(
		(total, group) => total + group.portIds.length,
		0,
	);
	const equipmentGroups = createEquipmentGroupFields(
		canonical.equipmentGroups.length,
		totalGroupPorts,
	);
	let portOffset = 0;
	for (let index = 0; index < canonical.equipmentGroups.length; index++) {
		const group = canonical.equipmentGroups[index] as EquipmentGroupRecord;
		equipmentGroupIds[index] = group.id;
		equipmentGroups.portOffsets[index] = portOffset;
		writeEquipmentGroup(equipmentGroups, index, portOffset, group);
		portOffset += group.portIds.length;
	}
	equipmentGroups.portOffsets[canonical.equipmentGroups.length] = portOffset;
	return Object.freeze({
		schemaVersion: PORT_EQUIPMENT_SNAPSHOT_SCHEMA_VERSION,
		nextPortId: canonical.nextPortId,
		nextEquipmentGroupId: canonical.nextEquipmentGroupId,
		portIds,
		ports,
		equipmentGroupIds,
		equipmentGroups,
	});
}

export function hydratePortEquipmentSnapshot(snapshot: PortEquipmentSnapshot): PortEquipmentState {
	return copyPortEquipmentState(hydratePortEquipmentSnapshotRecords(snapshot));
}

/** Main-thread startup hydrator with canonical ordering and reciprocal validation in bounded slices. */
export async function hydratePortEquipmentSnapshotCooperatively(
	snapshot: PortEquipmentSnapshot,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<PortEquipmentState> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Port/equipment hydration operation budget must be positive.");
	}
	await validatePortEquipmentSnapshotShapeCooperatively(snapshot, checkpoint, operationBudget);
	const builder = createCanonicalPortEquipmentStateBuilder(
		snapshot.nextPortId,
		snapshot.nextEquipmentGroupId,
	);
	let operations = 0;
	const tick = async (): Promise<void> => {
		operations++;
		if (operations % operationBudget === 0) await checkpoint();
	};
	for (let index = 0; index < snapshot.portIds.length; index++) {
		const port = readPortRecord(snapshot, index);
		builder.addPort(port);
		await tick();
	}

	for (let index = 0; index < snapshot.equipmentGroupIds.length; index++) {
		const group = readEquipmentGroup(snapshot, index);
		builder.addEquipmentGroup(group);
		for (let memberIndex = 0; memberIndex < group.portIds.length; memberIndex++) {
			await tick();
		}
		await tick();
	}
	await checkpoint();
	return builder.finish();
}

/**
 * Decode individually valid records without accepting their cross-record ownership as canonical.
 * This is reserved for read-only diagnostics; document activation must use the strict hydrator.
 */
export function hydratePortEquipmentSnapshotRecords(
	snapshot: PortEquipmentSnapshot,
): PortEquipmentState {
	validatePortEquipmentSnapshotShape(snapshot);
	const ports = new Array<PortRecord>(snapshot.portIds.length);
	for (let index = 0; index < ports.length; index++) ports[index] = readPortRecord(snapshot, index);
	const equipmentGroups = new Array<EquipmentGroupRecord>(snapshot.equipmentGroupIds.length);
	for (let index = 0; index < equipmentGroups.length; index++) {
		equipmentGroups[index] = readEquipmentGroup(snapshot, index);
	}
	return Object.freeze({
		nextPortId: snapshot.nextPortId,
		nextEquipmentGroupId: snapshot.nextEquipmentGroupId,
		ports: Object.freeze(ports),
		equipmentGroups: Object.freeze(equipmentGroups),
	});
}

export function readPortRecord(snapshot: PortEquipmentSnapshot, index: number): PortRecord {
	validateIndex(index, snapshot.portIds.length, "port");
	return readPortFromFields(snapshot.portIds[index] as number, snapshot.ports, index);
}

function readPortFromFields(id: number, fields: PortRecordFieldsSoA, index: number): PortRecord {
	const routeKind = fields.routeKinds[index] as number;
	return copyPortRecord({
		id,
		equipmentGroupId: fields.equipmentGroupIds[index] as number,
		route:
			routeKind === ROUTE_CARDINAL
				? {
						kind: "CARDINAL_CELL",
						x: fields.routeXs[index] as number,
						z: fields.routeZs[index] as number,
						from: fields.routeFromDirections[index] as 0 | Direction,
						to: fields.routeToDirections[index] as 0 | Direction,
					}
				: {
						kind: "ADVANCED_SWITCH_SEGMENT",
						switchId: fields.routeSwitchIds[index] as number,
						profileClass: enumValue(
							PROFILE_CLASSES,
							fields.routeProfileClasses[index] as number,
							"advanced-switch profile class",
						),
						role: enumValue(
							ROUTE_ROLES,
							fields.routeRoles[index] as number,
							"advanced-switch route role",
						),
						portIndex:
							(fields.routePortIndices[index] as number) < 0
								? null
								: (fields.routePortIndices[index] as 0 | 1),
						segmentOrdinal: fields.routeSegmentOrdinals[index] as number,
					},
		stationMillimeters: fields.stationMillimeters[index] as number,
		side: enumValue(PORT_SIDES, fields.sides[index] as number, "port side"),
		lateralOffsetMillimeters: fields.lateralOffsetMillimeters[index] as number,
		direction: enumValue(PORT_DIRECTIONS, fields.directions[index] as number, "port direction"),
		portType: enumValue(PORT_TYPES, fields.portTypes[index] as number, "port type"),
		barcode: fields.barcodes[index] ?? null,
	});
}

export function readEquipmentGroup(
	snapshot: PortEquipmentSnapshot,
	index: number,
): EquipmentGroupRecord {
	validateIndex(index, snapshot.equipmentGroupIds.length, "equipment group");
	return readEquipmentFromFields(
		snapshot.equipmentGroupIds[index] as number,
		snapshot.equipmentGroups,
		index,
	);
}

function readEquipmentFromFields(
	id: number,
	fields: EquipmentGroupFieldsSoA,
	index: number,
): EquipmentGroupRecord {
	const kind = enumValue(GROUP_KINDS, fields.kinds[index] as number, "equipment group kind");
	const start = fields.portOffsets[index] as number;
	const end = fields.portOffsets[index + 1] as number;
	const portIds = Object.freeze(Array.from(fields.portIds.slice(start, end)));
	if (kind === "OHB") return copyEquipmentGroupRecord({ id, kind, template: "SINGLE", portIds });
	if (kind === "EQ") {
		return copyEquipmentGroupRecord({
			id,
			kind,
			portIds,
			pitchMillimeters: fields.pitchMillimeters[index] as number,
			recipe: fields.recipes[index] ?? null,
		});
	}
	const template = enumValue(
		GROUP_TEMPLATES,
		fields.templates[index] as number,
		"equipment group template",
	);
	if (template === "SINGLE") throw new Error("STK equipment cannot use the OHB single template.");
	return copyEquipmentGroupRecord({ id, kind, template, portIds });
}

export function portEquipmentSnapshotTransfers(snapshot: PortEquipmentSnapshot): ArrayBuffer[] {
	return [
		snapshot.portIds.buffer,
		...portFieldArrays(snapshot.ports).map((values) => values.buffer),
		snapshot.equipmentGroupIds.buffer,
		...equipmentFieldArrays(snapshot.equipmentGroups).map((values) => values.buffer),
	] as ArrayBuffer[];
}

export function validatePortEquipmentSnapshotShape(snapshot: PortEquipmentSnapshot): void {
	if (snapshot.schemaVersion !== PORT_EQUIPMENT_SNAPSHOT_SCHEMA_VERSION) {
		throw new Error(`Unsupported port/equipment snapshot schema ${snapshot.schemaVersion}.`);
	}
	if (!isTransferableTypedArray(snapshot.portIds, Int32Array)) {
		throw new Error("Port snapshot ID column must be Int32Array.");
	}
	if (!isTransferableTypedArray(snapshot.equipmentGroupIds, Int32Array)) {
		throw new Error("Equipment snapshot ID column must be Int32Array.");
	}
	validatePortFieldTypes(snapshot.ports, "Port snapshot");
	validateEquipmentFieldTypes(snapshot.equipmentGroups, "Equipment snapshot");
	const portCount = snapshot.portIds.length;
	for (const values of portFieldArrays(snapshot.ports)) {
		if (values.length !== portCount) throw new Error("Port snapshot SoA lengths do not match.");
	}
	if (snapshot.ports.barcodes.length !== portCount) {
		throw new Error("Port snapshot barcode length does not match.");
	}
	const groupCount = snapshot.equipmentGroupIds.length;
	for (const values of equipmentFieldArrays(snapshot.equipmentGroups)) {
		if (values === snapshot.equipmentGroups.portIds) continue;
		const expected = values === snapshot.equipmentGroups.portOffsets ? groupCount + 1 : groupCount;
		if (values.length !== expected) throw new Error("Equipment snapshot SoA lengths do not match.");
	}
	if (snapshot.equipmentGroups.recipes.length !== groupCount) {
		throw new Error("Equipment snapshot recipe length does not match.");
	}
	if (
		(snapshot.equipmentGroups.portOffsets[0] as number) !== 0 ||
		(snapshot.equipmentGroups.portOffsets[groupCount] as number) !==
			snapshot.equipmentGroups.portIds.length
	) {
		throw new Error("Equipment snapshot port offsets do not span the port ID buffer.");
	}
	for (let index = 0; index < groupCount; index++) {
		const start = snapshot.equipmentGroups.portOffsets[index] as number;
		const end = snapshot.equipmentGroups.portOffsets[index + 1] as number;
		if (start > end) {
			throw new Error("Equipment snapshot port offsets are not monotonic.");
		}
		if (end - start > MAXIMUM_EQUIPMENT_GROUP_PORT_COUNT) {
			throw new Error("Equipment snapshot group port count exceeds the authored maximum.");
		}
	}
}

async function validatePortEquipmentSnapshotShapeCooperatively(
	snapshot: PortEquipmentSnapshot,
	checkpoint: () => Promise<void>,
	operationBudget: number,
): Promise<void> {
	if (snapshot.schemaVersion !== PORT_EQUIPMENT_SNAPSHOT_SCHEMA_VERSION) {
		throw new Error(`Unsupported port/equipment snapshot schema ${snapshot.schemaVersion}.`);
	}
	if (!isTransferableTypedArray(snapshot.portIds, Int32Array)) {
		throw new Error("Port snapshot ID column must be Int32Array.");
	}
	if (!isTransferableTypedArray(snapshot.equipmentGroupIds, Int32Array)) {
		throw new Error("Equipment snapshot ID column must be Int32Array.");
	}
	validatePortFieldTypes(snapshot.ports, "Port snapshot");
	validateEquipmentFieldTypes(snapshot.equipmentGroups, "Equipment snapshot");
	const portCount = snapshot.portIds.length;
	for (const values of portFieldArrays(snapshot.ports)) {
		if (values.length !== portCount) throw new Error("Port snapshot SoA lengths do not match.");
	}
	if (snapshot.ports.barcodes.length !== portCount) {
		throw new Error("Port snapshot barcode length does not match.");
	}
	const groupCount = snapshot.equipmentGroupIds.length;
	for (const values of equipmentFieldArrays(snapshot.equipmentGroups)) {
		if (values === snapshot.equipmentGroups.portIds) continue;
		const expected = values === snapshot.equipmentGroups.portOffsets ? groupCount + 1 : groupCount;
		if (values.length !== expected) throw new Error("Equipment snapshot SoA lengths do not match.");
	}
	if (snapshot.equipmentGroups.recipes.length !== groupCount) {
		throw new Error("Equipment snapshot recipe length does not match.");
	}
	if (
		(snapshot.equipmentGroups.portOffsets[0] as number) !== 0 ||
		(snapshot.equipmentGroups.portOffsets[groupCount] as number) !==
			snapshot.equipmentGroups.portIds.length
	) {
		throw new Error("Equipment snapshot port offsets do not span the port ID buffer.");
	}
	for (let index = 0; index < groupCount; index++) {
		const start = snapshot.equipmentGroups.portOffsets[index] as number;
		const end = snapshot.equipmentGroups.portOffsets[index + 1] as number;
		if (start > end) {
			throw new Error("Equipment snapshot port offsets are not monotonic.");
		}
		if (end - start > MAXIMUM_EQUIPMENT_GROUP_PORT_COUNT) {
			throw new Error("Equipment snapshot group port count exceeds the authored maximum.");
		}
		if ((index + 1) % operationBudget === 0) await checkpoint();
	}
	await checkpoint();
}

function createPortRecordFields(count: number): PortRecordFieldsSoA {
	return {
		equipmentGroupIds: new Int32Array(count),
		routeKinds: new Uint8Array(count),
		routeXs: new Int32Array(count),
		routeZs: new Int32Array(count),
		routeFromDirections: new Uint8Array(count),
		routeToDirections: new Uint8Array(count),
		routeSwitchIds: new Int32Array(count),
		routeProfileClasses: new Uint8Array(count),
		routeRoles: new Uint8Array(count),
		routePortIndices: new Int8Array(count).fill(-1),
		routeSegmentOrdinals: new Uint16Array(count),
		stationMillimeters: new Int32Array(count),
		sides: new Uint8Array(count),
		lateralOffsetMillimeters: new Uint32Array(count),
		directions: new Uint8Array(count),
		portTypes: new Uint8Array(count),
		barcodes: new Array<string | null>(count).fill(null),
	};
}

function writePortRecord(fields: PortRecordFieldsSoA, index: number, port: PortRecord): void {
	fields.equipmentGroupIds[index] = port.equipmentGroupId;
	fields.stationMillimeters[index] = port.stationMillimeters;
	fields.sides[index] = PORT_SIDES.indexOf(port.side);
	fields.lateralOffsetMillimeters[index] = port.lateralOffsetMillimeters;
	fields.directions[index] = PORT_DIRECTIONS.indexOf(port.direction);
	fields.portTypes[index] = PORT_TYPES.indexOf(port.portType);
	(fields.barcodes as (string | null)[])[index] = port.barcode;
	if (port.route.kind === "CARDINAL_CELL") {
		fields.routeKinds[index] = ROUTE_CARDINAL;
		fields.routeXs[index] = port.route.x;
		fields.routeZs[index] = port.route.z;
		fields.routeFromDirections[index] = port.route.from;
		fields.routeToDirections[index] = port.route.to;
		return;
	}
	fields.routeKinds[index] = ROUTE_ADVANCED_SWITCH;
	fields.routeSwitchIds[index] = port.route.switchId;
	fields.routeProfileClasses[index] = PROFILE_CLASSES.indexOf(port.route.profileClass);
	fields.routeRoles[index] = ROUTE_ROLES.indexOf(port.route.role);
	fields.routePortIndices[index] = port.route.portIndex ?? -1;
	fields.routeSegmentOrdinals[index] = port.route.segmentOrdinal;
}

function createEquipmentGroupFields(count: number, portCount: number): EquipmentGroupFieldsSoA {
	return {
		kinds: new Uint8Array(count),
		portOffsets: new Uint32Array(count + 1),
		portIds: new Int32Array(portCount),
		templates: new Uint8Array(count),
		pitchMillimeters: new Uint32Array(count),
		recipes: new Array<string | null>(count).fill(null),
	};
}

function writeEquipmentGroup(
	fields: EquipmentGroupFieldsSoA,
	index: number,
	portOffset: number,
	group: EquipmentGroupRecord,
): void {
	fields.kinds[index] = GROUP_KINDS.indexOf(group.kind);
	fields.portIds.set(group.portIds, portOffset);
	if (group.kind === "OHB") {
		fields.templates[index] = GROUP_TEMPLATES.indexOf(group.template);
		return;
	}
	if (group.kind === "EQ") {
		fields.pitchMillimeters[index] = group.pitchMillimeters;
		(fields.recipes as (string | null)[])[index] = group.recipe;
		return;
	}
	fields.templates[index] = GROUP_TEMPLATES.indexOf(group.template);
}

function createMutationEquipmentGroupFields(
	records: readonly (EquipmentGroupRecord | null)[],
	presenceValues: Uint8Array,
): EquipmentGroupFieldsSoA {
	const totalPorts = records.reduce((total, record) => total + (record?.portIds.length ?? 0), 0);
	const fields = createEquipmentGroupFields(records.length, totalPorts);
	let portOffset = 0;
	for (let index = 0; index < records.length; index++) {
		fields.portOffsets[index] = portOffset;
		const record = records[index];
		if (!record) continue;
		presenceValues[index] = 1;
		writeEquipmentGroup(fields, index, portOffset, record);
		portOffset += record.portIds.length;
	}
	fields.portOffsets[records.length] = portOffset;
	return fields;
}

async function createMutationEquipmentGroupFieldsCooperatively(
	changes: readonly EquipmentGroupMutation[],
	side: "before" | "after",
	presenceValues: Uint8Array,
	consumeOperation: () => Promise<void>,
): Promise<EquipmentGroupFieldsSoA> {
	let totalPorts = 0;
	for (const change of changes) {
		totalPorts += change[side]?.portIds.length ?? 0;
		await consumeOperation();
	}
	const fields = createEquipmentGroupFields(changes.length, totalPorts);
	let portOffset = 0;
	for (let index = 0; index < changes.length; index += 1) {
		fields.portOffsets[index] = portOffset;
		const record = (changes[index] as EquipmentGroupMutation)[side];
		if (record) {
			presenceValues[index] = 1;
			writeEquipmentGroup(fields, index, portOffset, record);
			portOffset += record.portIds.length;
		}
		await consumeOperation();
	}
	fields.portOffsets[changes.length] = portOffset;
	return fields;
}

function validatePatchShape(fields: PortEquipmentPatchSoA): void {
	if (
		!isTransferableTypedArray(fields.portIds, Int32Array) ||
		!isTransferableTypedArray(fields.portBeforePresent, Uint8Array) ||
		!isTransferableTypedArray(fields.portAfterPresent, Uint8Array)
	) {
		throw new Error("Port patch identity and presence columns have invalid typed arrays.");
	}
	const portCount = fields.portIds.length;
	if (
		fields.portBeforePresent.length !== portCount ||
		fields.portAfterPresent.length !== portCount
	) {
		throw new Error("Port patch presence lengths do not match.");
	}
	validatePortFields(fields.portBefore, portCount, "before");
	validatePortFields(fields.portAfter, portCount, "after");
	if (
		!isTransferableTypedArray(fields.equipmentGroupIds, Int32Array) ||
		!isTransferableTypedArray(fields.equipmentGroupBeforePresent, Uint8Array) ||
		!isTransferableTypedArray(fields.equipmentGroupAfterPresent, Uint8Array)
	) {
		throw new Error("Equipment patch identity and presence columns have invalid typed arrays.");
	}
	const groupCount = fields.equipmentGroupIds.length;
	if (
		fields.equipmentGroupBeforePresent.length !== groupCount ||
		fields.equipmentGroupAfterPresent.length !== groupCount
	) {
		throw new Error("Equipment patch presence lengths do not match.");
	}
	validateEquipmentFields(fields.equipmentGroupBefore, groupCount, "before");
	validateEquipmentFields(fields.equipmentGroupAfter, groupCount, "after");
}

function validatePortFields(fields: PortRecordFieldsSoA, count: number, label: string): void {
	validatePortFieldTypes(fields, `Port patch ${label}`);
	for (const values of portFieldArrays(fields)) {
		if (values.length !== count) throw new Error(`Port patch ${label} SoA lengths do not match.`);
	}
	if (fields.barcodes.length !== count) {
		throw new Error(`Port patch ${label} barcode length does not match.`);
	}
}

function validateEquipmentFields(
	fields: EquipmentGroupFieldsSoA,
	count: number,
	label: string,
): void {
	validateEquipmentFieldTypes(fields, `Equipment patch ${label}`);
	if (
		fields.kinds.length !== count ||
		fields.portOffsets.length !== count + 1 ||
		fields.templates.length !== count ||
		fields.pitchMillimeters.length !== count ||
		fields.recipes.length !== count ||
		(fields.portOffsets[0] as number) !== 0 ||
		(fields.portOffsets[count] as number) !== fields.portIds.length
	) {
		throw new Error(`Equipment patch ${label} SoA lengths or offsets do not match.`);
	}
	for (let index = 0; index < count; index++) {
		const start = fields.portOffsets[index] as number;
		const end = fields.portOffsets[index + 1] as number;
		if (start > end) {
			throw new Error(`Equipment patch ${label} offsets are not monotonic.`);
		}
		if (end - start > MAXIMUM_EQUIPMENT_GROUP_PORT_COUNT) {
			throw new Error(`Equipment patch ${label} group port count exceeds the authored maximum.`);
		}
	}
}

function validatePortFieldTypes(fields: PortRecordFieldsSoA, label: string): void {
	if (
		!(fields.equipmentGroupIds instanceof Int32Array) ||
		!(fields.routeKinds instanceof Uint8Array) ||
		!(fields.routeXs instanceof Int32Array) ||
		!(fields.routeZs instanceof Int32Array) ||
		!(fields.routeFromDirections instanceof Uint8Array) ||
		!(fields.routeToDirections instanceof Uint8Array) ||
		!(fields.routeSwitchIds instanceof Int32Array) ||
		!(fields.routeProfileClasses instanceof Uint8Array) ||
		!(fields.routeRoles instanceof Uint8Array) ||
		!(fields.routePortIndices instanceof Int8Array) ||
		!(fields.routeSegmentOrdinals instanceof Uint16Array) ||
		!(fields.stationMillimeters instanceof Int32Array) ||
		!(fields.sides instanceof Uint8Array) ||
		!(fields.lateralOffsetMillimeters instanceof Uint32Array) ||
		!(fields.directions instanceof Uint8Array) ||
		!(fields.portTypes instanceof Uint8Array)
	) {
		throw new Error(`${label} numeric columns have invalid typed arrays.`);
	}
	if (portFieldArrays(fields).some((values) => !hasTransferableArrayBuffer(values))) {
		throw new Error(`${label} numeric columns must use transferable ArrayBuffers.`);
	}
	if (!validNullableStringArray(fields.barcodes)) {
		throw new Error(`${label} barcode column must be an array of strings or nulls.`);
	}
}

function validateEquipmentFieldTypes(fields: EquipmentGroupFieldsSoA, label: string): void {
	if (
		!(fields.kinds instanceof Uint8Array) ||
		!(fields.portOffsets instanceof Uint32Array) ||
		!(fields.portIds instanceof Int32Array) ||
		!(fields.templates instanceof Uint8Array) ||
		!(fields.pitchMillimeters instanceof Uint32Array)
	) {
		throw new Error(`${label} numeric columns have invalid typed arrays.`);
	}
	if (equipmentFieldArrays(fields).some((values) => !hasTransferableArrayBuffer(values))) {
		throw new Error(`${label} numeric columns must use transferable ArrayBuffers.`);
	}
	if (!validNullableStringArray(fields.recipes)) {
		throw new Error(`${label} recipe column must be an array of strings or nulls.`);
	}
}

function validNullableStringArray(value: unknown): value is readonly (string | null)[] {
	return (
		Array.isArray(value) && value.every((entry) => entry === null || typeof entry === "string")
	);
}

function assertEmptyPortFields(fields: PortRecordFieldsSoA, index: number): void {
	for (const values of portFieldArrays(fields)) {
		const expected = values === fields.routePortIndices ? -1 : 0;
		if ((values[index] as number) !== expected) {
			throw new Error(`Absent port patch row ${index} carries record data.`);
		}
	}
	if (fields.barcodes[index] !== null) {
		throw new Error(`Absent port patch row ${index} carries a barcode.`);
	}
}

function assertEmptyEquipmentFields(fields: EquipmentGroupFieldsSoA, index: number): void {
	if (
		(fields.portOffsets[index] as number) !== (fields.portOffsets[index + 1] as number) ||
		(fields.kinds[index] as number) !== 0 ||
		(fields.templates[index] as number) !== 0 ||
		(fields.pitchMillimeters[index] as number) !== 0 ||
		fields.recipes[index] !== null
	) {
		throw new Error(`Absent equipment patch row ${index} carries record data.`);
	}
}

function presence(value: number, label: string): boolean {
	if (value !== 0 && value !== 1) throw new Error(`${label} presence must be 0 or 1.`);
	return value === 1;
}

function portFieldArrays(fields: PortRecordFieldsSoA): readonly NumericArray[] {
	return [
		fields.equipmentGroupIds,
		fields.routeKinds,
		fields.routeXs,
		fields.routeZs,
		fields.routeFromDirections,
		fields.routeToDirections,
		fields.routeSwitchIds,
		fields.routeProfileClasses,
		fields.routeRoles,
		fields.routePortIndices,
		fields.routeSegmentOrdinals,
		fields.stationMillimeters,
		fields.sides,
		fields.lateralOffsetMillimeters,
		fields.directions,
		fields.portTypes,
	];
}

function equipmentFieldArrays(fields: EquipmentGroupFieldsSoA): readonly NumericArray[] {
	return [
		fields.kinds,
		fields.portOffsets,
		fields.portIds,
		fields.templates,
		fields.pitchMillimeters,
	];
}

function enumValue<const Values extends readonly string[]>(
	values: Values,
	index: number,
	label: string,
): Values[number] {
	const value = values[index];
	if (value === undefined) throw new Error(`Invalid ${label} code ${index}.`);
	return value;
}

function validateIndex(index: number, count: number, label: string): void {
	if (!Number.isInteger(index) || index < 0 || index >= count) {
		throw new RangeError(`${label} index ${index} is outside the snapshot.`);
	}
}
