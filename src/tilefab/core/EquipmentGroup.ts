import {
	copyPortRecord,
	isPositiveRecordId,
	type PortMutation,
	type PortRecord,
	portRecordEquals,
	portRecordError,
} from "./PortRecord";

export const EQUIPMENT_GROUP_KINDS = ["OHB", "EQ", "STK"] as const;
export type EquipmentGroupKind = (typeof EQUIPMENT_GROUP_KINDS)[number];

export const EQ_PORT_PITCHES_MILLIMETERS = Object.freeze([1_000, 2_000, 3_000, 4_000, 5_000]);
export const EQ_MINIMUM_PORT_COUNT = 2;
export const EQ_MAXIMUM_PORT_COUNT = 64;

export const STK_EQUIPMENT_TEMPLATES = [
	"CUSTOM",
	"FLEX",
	"FOUR_PORT",
	"SIX_PORT",
	"BACK_TO_BACK",
] as const;
export type StkEquipmentTemplate = (typeof STK_EQUIPMENT_TEMPLATES)[number];
export const STK_AUTHORING_TEMPLATES = ["FLEX", "FOUR_PORT", "SIX_PORT", "BACK_TO_BACK"] as const;
export type StkAuthoringTemplate = (typeof STK_AUTHORING_TEMPLATES)[number];
export const STK_MAXIMUM_PORT_COUNT = 16;
export const STK_MAXIMUM_BACK_TO_BACK_LANE_SEPARATION_CELLS = 6;
/** Product safety bound for one derived stocker body; this is not an equipment specification. */
export const STK_FLEX_MAXIMUM_SPAN_CELLS = 64;

interface EquipmentGroupBase {
	readonly id: number;
	/** Authored order. Layout validation additionally requires deterministic station order. */
	readonly portIds: readonly number[];
}

export interface OhbEquipmentGroup extends EquipmentGroupBase {
	readonly kind: "OHB";
	readonly template: "SINGLE";
}

export interface EqEquipmentGroup extends EquipmentGroupBase {
	readonly kind: "EQ";
	readonly pitchMillimeters: number;
	readonly recipe: string | null;
}

export interface StkEquipmentGroup extends EquipmentGroupBase {
	readonly kind: "STK";
	readonly template: StkEquipmentTemplate;
}

export type EquipmentGroupRecord = OhbEquipmentGroup | EqEquipmentGroup | StkEquipmentGroup;

export interface EquipmentGroupMutation {
	readonly id: number;
	readonly before: EquipmentGroupRecord | null;
	readonly after: EquipmentGroupRecord | null;
}

export interface PortEquipmentState {
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly ports: readonly PortRecord[];
	readonly equipmentGroups: readonly EquipmentGroupRecord[];
}

/** Opaque runtime provenance for generations built by the canonical copy/hydration boundaries. */
const canonicalPortEquipmentStates = new WeakSet<object>();

export function isCanonicalPortEquipmentState(state: PortEquipmentState): boolean {
	return canonicalPortEquipmentStates.has(state);
}

export interface CanonicalPortEquipmentStateBuilder {
	addPort(record: PortRecord): void;
	addEquipmentGroup(record: EquipmentGroupRecord): void;
	finish(): PortEquipmentState;
}

/**
 * Incremental trusted construction boundary for transferable startup hydration.
 *
 * Every supplied record is validated and copied before retention. The builder therefore cannot be
 * used as a public "bless this object" escape hatch, while callers can checkpoint between records
 * and avoid one final synchronous O(N) copy.
 */
export function createCanonicalPortEquipmentStateBuilder(
	nextPortId: number,
	nextEquipmentGroupId: number,
): CanonicalPortEquipmentStateBuilder {
	if (!validCursor(nextPortId)) {
		throw new TypeError("next port id cursor is outside the signed-int32 range");
	}
	if (!validCursor(nextEquipmentGroupId)) {
		throw new TypeError("next equipment group id cursor is outside the signed-int32 range");
	}
	const ports: PortRecord[] = [];
	const equipmentGroups: EquipmentGroupRecord[] = [];
	const portsById = new Map<number, PortRecord>();
	const portIdByBarcode = new Map<string, number>();
	const claimedPorts = new Set<number>();
	let previousPortId = 0;
	let previousEquipmentGroupId = 0;
	let groupsStarted = false;
	let finished = false;
	const assertOpen = (): void => {
		if (finished) throw new Error("Canonical port/equipment state builder is already finished.");
	};
	return Object.freeze({
		addPort(record: PortRecord): void {
			assertOpen();
			if (groupsStarted) {
				throw new Error("Canonical port records must be added before equipment groups.");
			}
			const copied = copyPortRecord(record);
			if (copied.id <= previousPortId) {
				throw new TypeError("Port snapshot IDs must be strictly increasing and unique.");
			}
			if (copied.barcode !== null) {
				const existing = portIdByBarcode.get(copied.barcode);
				if (existing !== undefined) {
					throw new TypeError(
						`duplicate port barcode ${copied.barcode} on ports ${existing} and ${copied.id}`,
					);
				}
				portIdByBarcode.set(copied.barcode, copied.id);
			}
			ports.push(copied);
			portsById.set(copied.id, copied);
			previousPortId = copied.id;
		},
		addEquipmentGroup(record: EquipmentGroupRecord): void {
			assertOpen();
			groupsStarted = true;
			const copied = copyEquipmentGroupRecord(record);
			if (copied.id <= previousEquipmentGroupId) {
				throw new TypeError("Equipment snapshot IDs must be strictly increasing and unique.");
			}
			for (const portId of copied.portIds) {
				const port = portsById.get(portId);
				if (!port) {
					throw new TypeError(`equipment group ${copied.id} references missing port ${portId}`);
				}
				if (claimedPorts.has(portId)) {
					throw new TypeError(`port ${portId} belongs to more than one equipment group`);
				}
				if (port.equipmentGroupId !== copied.id) {
					throw new TypeError(`port ${portId} does not point back to equipment group ${copied.id}`);
				}
				if (port.portType !== copied.kind) {
					throw new TypeError(`port ${portId} type does not match equipment group ${copied.id}`);
				}
				claimedPorts.add(portId);
			}
			equipmentGroups.push(copied);
			previousEquipmentGroupId = copied.id;
		},
		finish(): PortEquipmentState {
			assertOpen();
			finished = true;
			if (nextPortId <= previousPortId) {
				throw new TypeError("next port id cursor must exceed every port id");
			}
			if (nextEquipmentGroupId <= previousEquipmentGroupId) {
				throw new TypeError("next equipment group id cursor must exceed every equipment group id");
			}
			if (claimedPorts.size !== ports.length) {
				throw new TypeError("port/equipment ownership is incomplete");
			}
			return brandCanonicalPortEquipmentState(
				Object.freeze({
					nextPortId,
					nextEquipmentGroupId,
					ports: Object.freeze(ports),
					equipmentGroups: Object.freeze(equipmentGroups),
				}),
			);
		},
	});
}

export const PORT_EQUIPMENT_INTEGRITY_ISSUE_CODES = [
	"NEXT_PORT_ID_CURSOR_INVALID",
	"NEXT_EQUIPMENT_GROUP_ID_CURSOR_INVALID",
	"PORT_RECORD_INVALID",
	"PORT_ID_DUPLICATE",
	"PORT_BARCODE_DUPLICATE",
	"EQUIPMENT_GROUP_RECORD_INVALID",
	"EQUIPMENT_GROUP_ID_DUPLICATE",
	"EQUIPMENT_GROUP_PORT_MISSING",
	"PORT_OWNED_BY_MULTIPLE_GROUPS",
	"PORT_GROUP_POINTER_MISMATCH",
	"PORT_GROUP_TYPE_MISMATCH",
	"PORT_EQUIPMENT_GROUP_MISSING",
	"PORT_NOT_OWNED_BY_GROUP",
	"NEXT_PORT_ID_CURSOR_STALE",
	"NEXT_EQUIPMENT_GROUP_ID_CURSOR_STALE",
] as const;

export type PortEquipmentIntegrityIssueCode = (typeof PORT_EQUIPMENT_INTEGRITY_ISSUE_CODES)[number];

/**
 * One independently actionable authored-data integrity problem.
 *
 * Record indexes disambiguate malformed inputs that reuse the same ID. The ID
 * arrays retain the authored values, including an invalid value, so consumers
 * never need to recover entity relationships by parsing `message`.
 */
export interface PortEquipmentIntegrityIssue {
	readonly code: PortEquipmentIntegrityIssueCode;
	readonly message: string;
	readonly portIds: readonly number[];
	readonly equipmentGroupIds: readonly number[];
	readonly portRecordIndexes: readonly number[];
	readonly equipmentGroupRecordIndexes: readonly number[];
}

export function equipmentGroupError(group: EquipmentGroupRecord): string | null {
	if (!isPositiveRecordId(group.id)) {
		return "equipment group id must be a positive signed int32";
	}
	if (!EQUIPMENT_GROUP_KINDS.includes(group.kind)) return "equipment group kind is invalid";
	if (group.portIds.length === 0) return "equipment group must own at least one port";
	const portIds = new Set<number>();
	for (const id of group.portIds) {
		if (!isPositiveRecordId(id)) return "equipment group port ids must be positive signed int32";
		if (portIds.has(id)) return "equipment group cannot reference the same port more than once";
		portIds.add(id);
	}
	if (group.kind === "OHB") {
		if (group.template !== "SINGLE") return "OHB equipment requires the single-port template";
		if (group.portIds.length !== 1) return "OHB equipment must own exactly one port";
		return null;
	}
	if (group.kind === "EQ") {
		if (!EQ_PORT_PITCHES_MILLIMETERS.includes(group.pitchMillimeters)) {
			return "EQ pitch must be 1000 to 5000 millimeters in whole-meter steps";
		}
		if (
			group.portIds.length < EQ_MINIMUM_PORT_COUNT ||
			group.portIds.length > EQ_MAXIMUM_PORT_COUNT
		) {
			return `EQ equipment must own ${EQ_MINIMUM_PORT_COUNT} to ${EQ_MAXIMUM_PORT_COUNT} ports`;
		}
		if (group.recipe !== null && !validPortableLabel(group.recipe, 120)) {
			return "EQ recipe must be a trimmed portable label up to 120 characters";
		}
		return null;
	}
	if (!STK_EQUIPMENT_TEMPLATES.includes(group.template)) {
		return "STK equipment template is invalid";
	}
	if (group.portIds.length > STK_MAXIMUM_PORT_COUNT) {
		return `STK equipment cannot own more than ${STK_MAXIMUM_PORT_COUNT} ports`;
	}
	if (group.template === "FOUR_PORT" && group.portIds.length !== 4) {
		return "the four-port STK template requires exactly four ports";
	}
	if (group.template === "SIX_PORT" && group.portIds.length !== 6) {
		return "the six-port STK template requires exactly six ports";
	}
	if (
		group.template === "BACK_TO_BACK" &&
		(group.portIds.length < 4 || group.portIds.length % 2 !== 0)
	) {
		return "the back-to-back STK template requires an even port count of at least four";
	}
	return null;
}

export function portEquipmentStateError(state: PortEquipmentState): string | null {
	if (!validCursor(state.nextPortId)) {
		return "next port id cursor is outside the signed-int32 range";
	}
	if (!validCursor(state.nextEquipmentGroupId)) {
		return "next equipment group id cursor is outside the signed-int32 range";
	}
	const ports = new Map<number, PortRecord>();
	const portIdByBarcode = new Map<string, number>();
	let maximumPortId = 0;
	for (const port of state.ports) {
		const error = portRecordError(port);
		if (error) return `port ${port.id}: ${error}`;
		const copied = copyPortRecord(port);
		if (ports.has(copied.id)) return `duplicate port id ${copied.id}`;
		if (copied.barcode !== null) {
			const existingPortId = portIdByBarcode.get(copied.barcode);
			if (existingPortId !== undefined) {
				return `duplicate port barcode ${copied.barcode} on ports ${existingPortId} and ${copied.id}`;
			}
			portIdByBarcode.set(copied.barcode, copied.id);
		}
		ports.set(copied.id, copied);
		maximumPortId = Math.max(maximumPortId, copied.id);
	}
	const groups = new Map<number, EquipmentGroupRecord>();
	let maximumGroupId = 0;
	const claimedPorts = new Set<number>();
	for (const group of state.equipmentGroups) {
		const error = equipmentGroupError(group);
		if (error) return `equipment group ${group.id}: ${error}`;
		if (groups.has(group.id)) return `duplicate equipment group id ${group.id}`;
		groups.set(group.id, group);
		maximumGroupId = Math.max(maximumGroupId, group.id);
		for (const portId of group.portIds) {
			const port = ports.get(portId);
			if (!port) return `equipment group ${group.id} references missing port ${portId}`;
			if (claimedPorts.has(portId)) {
				return `port ${portId} belongs to more than one equipment group`;
			}
			if (port.equipmentGroupId !== group.id) {
				return `port ${portId} does not point back to equipment group ${group.id}`;
			}
			if (port.portType !== group.kind) {
				return `port ${portId} type does not match equipment group ${group.id}`;
			}
			claimedPorts.add(portId);
		}
	}
	for (const port of ports.values()) {
		if (!groups.has(port.equipmentGroupId)) {
			return `port ${port.id} references missing equipment group ${port.equipmentGroupId}`;
		}
		if (!claimedPorts.has(port.id)) return `port ${port.id} is not owned by its equipment group`;
	}
	if (state.nextPortId <= maximumPortId) return "next port id cursor must exceed every port id";
	if (state.nextEquipmentGroupId <= maximumGroupId) {
		return "next equipment group id cursor must exceed every equipment group id";
	}
	return null;
}

/** Collect all safely discoverable reciprocal port/equipment integrity issues. */
export function collectPortEquipmentIntegrityIssues(
	state: PortEquipmentState,
): readonly PortEquipmentIntegrityIssue[] {
	const issues: PortEquipmentIntegrityIssue[] = [];
	const addIssue = (
		code: PortEquipmentIntegrityIssueCode,
		message: string,
		portIds: readonly number[] = [],
		equipmentGroupIds: readonly number[] = [],
		portRecordIndexes: readonly number[] = [],
		equipmentGroupRecordIndexes: readonly number[] = [],
	): void => {
		issues.push(
			Object.freeze({
				code,
				message,
				portIds: Object.freeze([...portIds]),
				equipmentGroupIds: Object.freeze([...equipmentGroupIds]),
				portRecordIndexes: Object.freeze([...portRecordIndexes]),
				equipmentGroupRecordIndexes: Object.freeze([...equipmentGroupRecordIndexes]),
			}),
		);
	};

	const portCursorValid = validCursor(state.nextPortId);
	const equipmentGroupCursorValid = validCursor(state.nextEquipmentGroupId);
	if (!portCursorValid) {
		addIssue(
			"NEXT_PORT_ID_CURSOR_INVALID",
			"next port id cursor is outside the signed-int32 range",
		);
	}
	if (!equipmentGroupCursorValid) {
		addIssue(
			"NEXT_EQUIPMENT_GROUP_ID_CURSOR_INVALID",
			"next equipment group id cursor is outside the signed-int32 range",
		);
	}

	const ports = new Map<number, { readonly record: PortRecord; readonly index: number }[]>();
	const firstPortById = new Map<number, number>();
	const firstPortByBarcode = new Map<string, { readonly id: number; readonly index: number }>();
	let maximumPortId = 0;
	for (let portIndex = 0; portIndex < state.ports.length; portIndex += 1) {
		const port = state.ports[portIndex] as PortRecord;
		const error = portRecordError(port);
		if (error) {
			addIssue(
				"PORT_RECORD_INVALID",
				`port ${port.id}: ${error}`,
				[port.id],
				[port.equipmentGroupId],
				[portIndex],
			);
		}

		const existingPortIndex = firstPortById.get(port.id);
		if (existingPortIndex !== undefined) {
			addIssue(
				"PORT_ID_DUPLICATE",
				`duplicate port id ${port.id}`,
				[port.id, port.id],
				[],
				[existingPortIndex, portIndex],
			);
		} else {
			firstPortById.set(port.id, portIndex);
		}

		if (port.barcode !== null) {
			const existingPort = firstPortByBarcode.get(port.barcode);
			if (existingPort) {
				addIssue(
					"PORT_BARCODE_DUPLICATE",
					`duplicate port barcode ${port.barcode} on ports ${existingPort.id} and ${port.id}`,
					[existingPort.id, port.id],
					[],
					[existingPort.index, portIndex],
				);
			} else {
				firstPortByBarcode.set(port.barcode, { id: port.id, index: portIndex });
			}
		}

		if (isPositiveRecordId(port.id)) {
			maximumPortId = Math.max(maximumPortId, port.id);
			const records = ports.get(port.id);
			if (records) records.push({ record: port, index: portIndex });
			else ports.set(port.id, [{ record: port, index: portIndex }]);
		}
	}

	const groups = new Map<
		number,
		{ readonly record: EquipmentGroupRecord; readonly index: number }
	>();
	const firstGroupById = new Map<number, number>();
	for (let groupIndex = 0; groupIndex < state.equipmentGroups.length; groupIndex += 1) {
		const group = state.equipmentGroups[groupIndex] as EquipmentGroupRecord;
		if (isPositiveRecordId(group.id) && !groups.has(group.id)) {
			groups.set(group.id, { record: group, index: groupIndex });
		}
	}

	let maximumGroupId = 0;
	const claimsByPortId = new Map<
		number,
		{ readonly groupId: number; readonly groupIndex: number }
	>();
	for (let groupIndex = 0; groupIndex < state.equipmentGroups.length; groupIndex += 1) {
		const group = state.equipmentGroups[groupIndex] as EquipmentGroupRecord;
		const error = equipmentGroupError(group);
		if (error) {
			addIssue(
				"EQUIPMENT_GROUP_RECORD_INVALID",
				`equipment group ${group.id}: ${error}`,
				group.portIds,
				[group.id],
				[],
				[groupIndex],
			);
		}

		const existingGroupIndex = firstGroupById.get(group.id);
		if (existingGroupIndex !== undefined) {
			addIssue(
				"EQUIPMENT_GROUP_ID_DUPLICATE",
				`duplicate equipment group id ${group.id}`,
				[],
				[group.id, group.id],
				[],
				[existingGroupIndex, groupIndex],
			);
		} else {
			firstGroupById.set(group.id, groupIndex);
		}
		if (isPositiveRecordId(group.id)) maximumGroupId = Math.max(maximumGroupId, group.id);

		const visitedPortIds = new Set<number>();
		for (const portId of group.portIds) {
			if (visitedPortIds.has(portId)) continue;
			visitedPortIds.add(portId);
			const portEntries = ports.get(portId);
			if (!portEntries) {
				addIssue(
					"EQUIPMENT_GROUP_PORT_MISSING",
					`equipment group ${group.id} references missing port ${portId}`,
					[portId],
					[group.id],
					[],
					[groupIndex],
				);
				continue;
			}

			const existingClaim = claimsByPortId.get(portId);
			if (existingClaim && existingClaim.groupIndex !== groupIndex) {
				addIssue(
					"PORT_OWNED_BY_MULTIPLE_GROUPS",
					`port ${portId} belongs to more than one equipment group`,
					[portId],
					[existingClaim.groupId, group.id],
					canonicalDuplicatePortWitnesses(portEntries).map((entry) => entry.index),
					[existingClaim.groupIndex, groupIndex],
				);
			} else if (!existingClaim) {
				claimsByPortId.set(portId, { groupId: group.id, groupIndex });
			}

			const relationshipPortEntries =
				existingClaim && existingClaim.groupIndex !== groupIndex
					? canonicalDuplicatePortWitnesses(portEntries)
					: portEntries;
			for (const portEntry of relationshipPortEntries) {
				if (portEntry.record.equipmentGroupId !== group.id) {
					addIssue(
						"PORT_GROUP_POINTER_MISMATCH",
						`port ${portId} does not point back to equipment group ${group.id}`,
						[portId],
						[portEntry.record.equipmentGroupId, group.id],
						[portEntry.index],
						[groupIndex],
					);
				}
				if (portEntry.record.portType !== group.kind) {
					addIssue(
						"PORT_GROUP_TYPE_MISMATCH",
						`port ${portId} type does not match equipment group ${group.id}`,
						[portId],
						[group.id],
						[portEntry.index],
						[groupIndex],
					);
				}
			}
		}
	}

	for (let portIndex = 0; portIndex < state.ports.length; portIndex += 1) {
		const port = state.ports[portIndex] as PortRecord;
		if (!isPositiveRecordId(port.id)) continue;
		if (!groups.has(port.equipmentGroupId)) {
			addIssue(
				"PORT_EQUIPMENT_GROUP_MISSING",
				`port ${port.id} references missing equipment group ${port.equipmentGroupId}`,
				[port.id],
				[port.equipmentGroupId],
				[portIndex],
			);
		}
		if (!claimsByPortId.has(port.id)) {
			addIssue(
				"PORT_NOT_OWNED_BY_GROUP",
				`port ${port.id} is not owned by its equipment group`,
				[port.id],
				[port.equipmentGroupId],
				[portIndex],
			);
		}
	}

	if (portCursorValid && state.nextPortId <= maximumPortId) {
		addIssue("NEXT_PORT_ID_CURSOR_STALE", "next port id cursor must exceed every port id");
	}
	if (equipmentGroupCursorValid && state.nextEquipmentGroupId <= maximumGroupId) {
		addIssue(
			"NEXT_EQUIPMENT_GROUP_ID_CURSOR_STALE",
			"next equipment group id cursor must exceed every equipment group id",
		);
	}
	return Object.freeze(issues);
}

function canonicalDuplicatePortWitnesses<T>(entries: readonly T[]): readonly T[] {
	if (entries.length <= 2) return entries;
	return [entries[0] as T, entries[entries.length - 1] as T];
}

export function copyEquipmentGroupRecord(group: EquipmentGroupRecord): EquipmentGroupRecord {
	const sourcePortIds = group.portIds;
	if (!Array.isArray(sourcePortIds))
		throw new TypeError("equipment group port ids must be an array");
	const portCount = sourcePortIds.length;
	if (!Number.isInteger(portCount) || portCount < 0 || portCount > EQ_MAXIMUM_PORT_COUNT) {
		throw new TypeError(`equipment group cannot own more than ${EQ_MAXIMUM_PORT_COUNT} ports`);
	}
	const portIds = new Array<number>(portCount);
	for (let index = 0; index < portIds.length; index++) {
		portIds[index] = sourcePortIds[index] as number;
	}
	const frozenPortIds = Object.freeze(portIds);
	const kind = group.kind;
	const copy: EquipmentGroupRecord =
		kind === "OHB"
			? { id: group.id, kind, template: group.template, portIds: frozenPortIds }
			: kind === "EQ"
				? {
						id: group.id,
						kind,
						portIds: frozenPortIds,
						pitchMillimeters: group.pitchMillimeters,
						recipe: group.recipe,
					}
				: { id: group.id, kind, template: group.template, portIds: frozenPortIds };
	const error = equipmentGroupError(copy);
	if (error) throw new TypeError(error);
	return Object.freeze(copy);
}

export function equipmentGroupEquals(
	left: EquipmentGroupRecord | null | undefined,
	right: EquipmentGroupRecord | null | undefined,
): boolean {
	if (!left || !right) return left == null && right == null;
	if (left.id !== right.id || left.kind !== right.kind || !sameIds(left.portIds, right.portIds)) {
		return false;
	}
	if (left.kind === "OHB" && right.kind === "OHB") return left.template === right.template;
	if (left.kind === "EQ" && right.kind === "EQ") {
		return left.pitchMillimeters === right.pitchMillimeters && left.recipe === right.recipe;
	}
	return left.kind === "STK" && right.kind === "STK" && left.template === right.template;
}

export function copyPortEquipmentState(state: PortEquipmentState): PortEquipmentState {
	const sourcePorts = state.ports;
	const sourceGroups = state.equipmentGroups;
	if (!Array.isArray(sourcePorts) || !Array.isArray(sourceGroups)) {
		throw new TypeError("port/equipment records must be arrays");
	}
	const portCount = sourcePorts.length;
	const groupCount = sourceGroups.length;
	const ports = new Array<PortRecord>(portCount);
	for (let index = 0; index < portCount; index++) {
		ports[index] = copyPortRecord(sourcePorts[index] as PortRecord);
	}
	ports.sort((left, right) => left.id - right.id);
	const equipmentGroups = new Array<EquipmentGroupRecord>(groupCount);
	for (let index = 0; index < groupCount; index++) {
		equipmentGroups[index] = copyEquipmentGroupRecord(sourceGroups[index] as EquipmentGroupRecord);
	}
	equipmentGroups.sort((left, right) => left.id - right.id);
	const copy = Object.freeze({
		nextPortId: state.nextPortId,
		nextEquipmentGroupId: state.nextEquipmentGroupId,
		ports: Object.freeze(ports),
		equipmentGroups: Object.freeze(equipmentGroups),
	});
	const error = portEquipmentStateError(copy);
	if (error) throw new TypeError(error);
	return brandCanonicalPortEquipmentState(copy);
}

/** Apply a reciprocal port/group batch without publishing a partially valid state. */
export function applyPortEquipmentMutations(
	current: PortEquipmentState,
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
): PortEquipmentState {
	if (portChanges.length === 0 && equipmentGroupChanges.length === 0) return current;
	const ports = new Map(current.ports.map((port) => [port.id, port]));
	const equipmentGroups = new Map(current.equipmentGroups.map((group) => [group.id, group]));
	const touchedPorts = new Set<number>();
	const touchedGroups = new Set<number>();
	let nextPortId = current.nextPortId;
	let nextEquipmentGroupId = current.nextEquipmentGroupId;
	for (const change of portChanges) {
		if (touchedPorts.has(change.id)) throw new Error(`Port ${change.id} changes more than once.`);
		touchedPorts.add(change.id);
		if (!change.before && !change.after) throw new Error(`Port ${change.id} mutation is empty.`);
		if (
			(change.before && change.before.id !== change.id) ||
			(change.after && change.after.id !== change.id) ||
			portRecordEquals(change.before, change.after) ||
			!portRecordEquals(ports.get(change.id), change.before)
		) {
			throw new Error(`Port ${change.id} mutation before/after values are invalid.`);
		}
		if (change.after) {
			ports.set(change.id, copyPortRecord(change.after));
			nextPortId = Math.max(nextPortId, change.id + 1);
		} else ports.delete(change.id);
	}
	for (const change of equipmentGroupChanges) {
		if (touchedGroups.has(change.id)) {
			throw new Error(`Equipment group ${change.id} changes more than once.`);
		}
		touchedGroups.add(change.id);
		if (!change.before && !change.after) {
			throw new Error(`Equipment group ${change.id} mutation is empty.`);
		}
		if (
			(change.before && change.before.id !== change.id) ||
			(change.after && change.after.id !== change.id) ||
			equipmentGroupEquals(change.before, change.after) ||
			!equipmentGroupEquals(equipmentGroups.get(change.id), change.before)
		) {
			throw new Error(`Equipment group ${change.id} mutation before/after values are invalid.`);
		}
		if (change.after) {
			equipmentGroups.set(change.id, copyEquipmentGroupRecord(change.after));
			nextEquipmentGroupId = Math.max(nextEquipmentGroupId, change.id + 1);
		} else equipmentGroups.delete(change.id);
	}
	const next: PortEquipmentState = {
		nextPortId,
		nextEquipmentGroupId,
		ports: [...ports.values()],
		equipmentGroups: [...equipmentGroups.values()],
	};
	const error = portEquipmentStateError(next);
	if (error) throw new Error(error);
	return copyPortEquipmentState(next);
}

/**
 * Apply an immutable additions-only batch through an off-side canonical builder.
 *
 * Nothing publishes until the returned state is complete; callers may therefore yield between
 * records and atomically adopt the finished state after rechecking their document generation.
 */
export async function applyPortEquipmentAdditionsCooperatively(
	current: PortEquipmentState,
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<PortEquipmentState> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Port/equipment addition operation budget must be positive.");
	}
	if (!isCanonicalPortEquipmentState(current)) {
		throw new TypeError("Cooperative port/equipment additions require canonical source state.");
	}
	if (portChanges.length === 0 && equipmentGroupChanges.length === 0) return current;
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const existingPortIds = new Set<number>();
	for (const port of current.ports) {
		existingPortIds.add(port.id);
		await consumeOperation();
	}
	const existingGroupIds = new Set<number>();
	for (const group of current.equipmentGroups) {
		existingGroupIds.add(group.id);
		await consumeOperation();
	}
	const addedPortIds = new Set<number>();
	const addedPorts = new Array<PortRecord>(portChanges.length);
	let nextPortId = current.nextPortId;
	for (let index = 0; index < portChanges.length; index += 1) {
		const change = portChanges[index] as PortMutation;
		if (
			change.before !== null ||
			change.after === null ||
			change.after.id !== change.id ||
			existingPortIds.has(change.id) ||
			addedPortIds.has(change.id)
		) {
			throw new Error(`Port ${change.id} addition before/after values are invalid.`);
		}
		addedPortIds.add(change.id);
		addedPorts[index] = change.after;
		nextPortId = Math.max(nextPortId, change.id + 1);
		await consumeOperation();
	}
	const addedGroupIds = new Set<number>();
	const addedGroups = new Array<EquipmentGroupRecord>(equipmentGroupChanges.length);
	let nextEquipmentGroupId = current.nextEquipmentGroupId;
	for (let index = 0; index < equipmentGroupChanges.length; index += 1) {
		const change = equipmentGroupChanges[index] as EquipmentGroupMutation;
		if (
			change.before !== null ||
			change.after === null ||
			change.after.id !== change.id ||
			existingGroupIds.has(change.id) ||
			addedGroupIds.has(change.id)
		) {
			throw new Error(`Equipment group ${change.id} addition before/after values are invalid.`);
		}
		addedGroupIds.add(change.id);
		addedGroups[index] = change.after;
		nextEquipmentGroupId = Math.max(nextEquipmentGroupId, change.id + 1);
		await consumeOperation();
	}
	const sortedAddedPorts = await sortRecordsByIdCooperatively(
		addedPorts,
		checkpoint,
		operationBudget,
	);
	const sortedAddedGroups = await sortRecordsByIdCooperatively(
		addedGroups,
		checkpoint,
		operationBudget,
	);
	const builder = createCanonicalPortEquipmentStateBuilder(nextPortId, nextEquipmentGroupId);
	let currentPortIndex = 0;
	let addedPortIndex = 0;
	while (currentPortIndex < current.ports.length || addedPortIndex < sortedAddedPorts.length) {
		const existing = current.ports[currentPortIndex];
		const added = sortedAddedPorts[addedPortIndex];
		if (added === undefined || (existing !== undefined && existing.id < added.id)) {
			builder.addPort(existing as PortRecord);
			currentPortIndex++;
		} else {
			builder.addPort(added);
			addedPortIndex++;
		}
		await consumeOperation();
	}
	let currentGroupIndex = 0;
	let addedGroupIndex = 0;
	while (
		currentGroupIndex < current.equipmentGroups.length ||
		addedGroupIndex < sortedAddedGroups.length
	) {
		const existing = current.equipmentGroups[currentGroupIndex];
		const added = sortedAddedGroups[addedGroupIndex];
		if (added === undefined || (existing !== undefined && existing.id < added.id)) {
			builder.addEquipmentGroup(existing as EquipmentGroupRecord);
			currentGroupIndex++;
		} else {
			builder.addEquipmentGroup(added);
			addedGroupIndex++;
		}
		await consumeOperation();
	}
	await checkpoint();
	return builder.finish();
}

async function sortRecordsByIdCooperatively<T extends { readonly id: number }>(
	records: readonly T[],
	checkpoint: () => Promise<void>,
	operationBudget: number,
): Promise<readonly T[]> {
	if (records.length < 2) return records;
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	let alreadySorted = true;
	for (let index = 1; index < records.length; index += 1) {
		if ((records[index - 1] as T).id >= (records[index] as T).id) alreadySorted = false;
		await consumeOperation();
	}
	if (alreadySorted) return records;
	let source = Array.from(records);
	let target = new Array<T>(records.length);
	for (let width = 1; width < records.length; width *= 2) {
		for (let start = 0; start < records.length; start += width * 2) {
			const middle = Math.min(start + width, records.length);
			const end = Math.min(start + width * 2, records.length);
			let left = start;
			let right = middle;
			for (let output = start; output < end; output += 1) {
				if (right >= end || (left < middle && (source[left] as T).id <= (source[right] as T).id)) {
					target[output] = source[left] as T;
					left++;
				} else {
					target[output] = source[right] as T;
					right++;
				}
				await consumeOperation();
			}
		}
		[source, target] = [target, source];
	}
	return source;
}

export function emptyPortEquipmentState(): PortEquipmentState {
	return brandCanonicalPortEquipmentState(
		Object.freeze({
			nextPortId: 1,
			nextEquipmentGroupId: 1,
			ports: Object.freeze([]),
			equipmentGroups: Object.freeze([]),
		}),
	);
}

function brandCanonicalPortEquipmentState(state: PortEquipmentState): PortEquipmentState {
	canonicalPortEquipmentStates.add(state);
	return state;
}

function validCursor(value: number): boolean {
	return Number.isInteger(value) && value >= 1 && value <= 0x8000_0000;
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validPortableLabel(value: string, maximumLength: number): boolean {
	if (value.length === 0 || value.length > maximumLength || value !== value.trim()) {
		return false;
	}
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) {
			return false;
		}
	}
	return true;
}
