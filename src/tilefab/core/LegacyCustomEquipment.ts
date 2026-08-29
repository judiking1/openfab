import {
	copyEquipmentGroupRecord,
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	equipmentGroupEquals,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { copyPortRecord, type PortMutation, type PortRecord, portRecordEquals } from "./PortRecord";

/** Immutable v2 CUSTOM records that may only be removed or restored byte-for-byte. */
export interface LegacyCustomEquipmentBaseline {
	readonly groups: ReadonlyMap<number, EquipmentGroupRecord>;
	readonly ports: ReadonlyMap<number, PortRecord>;
}

export function captureLegacyCustomEquipmentBaseline(
	state: PortEquipmentState,
): LegacyCustomEquipmentBaseline {
	const groups = new Map<number, EquipmentGroupRecord>();
	for (const group of state.equipmentGroups) {
		if (group.kind === "STK" && group.template === "CUSTOM") {
			groups.set(group.id, copyEquipmentGroupRecord(group));
		}
	}
	const ports = new Map<number, PortRecord>();
	for (const port of state.ports) {
		if (groups.has(port.equipmentGroupId)) ports.set(port.id, copyPortRecord(port));
	}
	return freezeLegacyCustomEquipmentBaseline(groups, ports);
}

/** Capture load-only CUSTOM truth without one unbounded walk over a factory-scale state. */
export async function captureLegacyCustomEquipmentBaselineCooperatively(
	state: PortEquipmentState,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<LegacyCustomEquipmentBaseline> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Legacy CUSTOM capture operation budget must be positive.");
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const groups = new Map<number, EquipmentGroupRecord>();
	for (const group of state.equipmentGroups) {
		if (group.kind === "STK" && group.template === "CUSTOM") {
			groups.set(group.id, copyEquipmentGroupRecord(group));
		}
		await consumeOperation();
	}
	const ports = new Map<number, PortRecord>();
	for (const port of state.ports) {
		if (groups.has(port.equipmentGroupId)) ports.set(port.id, copyPortRecord(port));
		await consumeOperation();
	}
	await checkpoint();
	return freezeLegacyCustomEquipmentBaseline(groups, ports);
}

export function legacyCustomEquipmentMutationError(
	portChanges: readonly PortMutation[],
	groupChanges: readonly EquipmentGroupMutation[],
	baseline: LegacyCustomEquipmentBaseline,
): string | null {
	for (const change of groupChanges) {
		const original = baseline.groups.get(change.id);
		if (original) {
			if (
				(change.before !== null && !equipmentGroupEquals(original, change.before)) ||
				(change.after !== null && !equipmentGroupEquals(original, change.after))
			) {
				return customGroupError(change.id);
			}
			continue;
		}
		for (const group of [change.before, change.after]) {
			if (group?.kind === "STK" && group.template === "CUSTOM") {
				return customGroupError(group.id);
			}
		}
	}

	for (const change of portChanges) {
		const original = baseline.ports.get(change.id);
		if (original) {
			if (
				(change.before !== null && !portRecordEquals(original, change.before)) ||
				(change.after !== null && !portRecordEquals(original, change.after))
			) {
				return customPortError(change.id, original.equipmentGroupId);
			}
			continue;
		}
		for (const port of [change.before, change.after]) {
			if (port && baseline.groups.has(port.equipmentGroupId)) {
				return customPortError(port.id, port.equipmentGroupId);
			}
		}
	}
	return null;
}

/** Same legacy-CUSTOM guard with caller-controlled checkpoints between immutable mutations. */
export async function legacyCustomEquipmentMutationErrorCooperatively(
	portChanges: readonly PortMutation[],
	groupChanges: readonly EquipmentGroupMutation[],
	baseline: LegacyCustomEquipmentBaseline,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<string | null> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Legacy CUSTOM validation operation budget must be positive.");
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	for (const change of groupChanges) {
		const original = baseline.groups.get(change.id);
		if (original) {
			if (
				(change.before !== null && !equipmentGroupEquals(original, change.before)) ||
				(change.after !== null && !equipmentGroupEquals(original, change.after))
			) {
				return customGroupError(change.id);
			}
		} else {
			for (const group of [change.before, change.after]) {
				if (group?.kind === "STK" && group.template === "CUSTOM") {
					return customGroupError(group.id);
				}
			}
		}
		await consumeOperation();
	}
	for (const change of portChanges) {
		const original = baseline.ports.get(change.id);
		if (original) {
			if (
				(change.before !== null && !portRecordEquals(original, change.before)) ||
				(change.after !== null && !portRecordEquals(original, change.after))
			) {
				return customPortError(change.id, original.equipmentGroupId);
			}
		} else {
			for (const port of [change.before, change.after]) {
				if (port && baseline.groups.has(port.equipmentGroupId)) {
					return customPortError(port.id, port.equipmentGroupId);
				}
			}
		}
		await consumeOperation();
	}
	return null;
}

/** Validate a same-document resync without forgetting CUSTOM records currently in undo history. */
export function legacyCustomEquipmentResyncError(
	state: PortEquipmentState,
	baseline: LegacyCustomEquipmentBaseline,
): string | null {
	const groupsById = new Map(state.equipmentGroups.map((group) => [group.id, group]));
	const portsById = new Map(state.ports.map((port) => [port.id, port]));
	for (const [groupId, original] of baseline.groups) {
		const group = groupsById.get(groupId);
		if (group && !equipmentGroupEquals(original, group)) {
			return customGroupError(groupId);
		}
	}
	for (const [portId, original] of baseline.ports) {
		const port = portsById.get(portId);
		if (port && !portRecordEquals(original, port)) {
			return customPortError(portId, original.equipmentGroupId);
		}
	}
	for (const group of state.equipmentGroups) {
		if (
			group.kind === "STK" &&
			group.template === "CUSTOM" &&
			!equipmentGroupEquals(baseline.groups.get(group.id), group)
		) {
			return customGroupError(group.id);
		}
	}
	for (const port of state.ports) {
		if (
			baseline.groups.has(port.equipmentGroupId) &&
			!portRecordEquals(baseline.ports.get(port.id), port)
		) {
			return customPortError(port.id, port.equipmentGroupId);
		}
	}
	return null;
}

function customGroupError(groupId: number): string {
	return `CUSTOM STK equipment group ${groupId} is legacy load-only data and cannot be newly authored or changed`;
}

function customPortError(portId: number, groupId: number): string {
	return `CUSTOM STK equipment group ${groupId} port ${portId} is legacy load-only data and cannot be newly authored or changed`;
}

function freezeLegacyCustomEquipmentBaseline(
	groups: Map<number, EquipmentGroupRecord>,
	ports: Map<number, PortRecord>,
): LegacyCustomEquipmentBaseline {
	return Object.freeze({
		groups: immutableReadonlyMap(groups),
		ports: immutableReadonlyMap(ports),
	});
}

/** Object.freeze(Map) does not freeze entries; expose only a frozen closure-backed read view. */
function immutableReadonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
	const view: ReadonlyMap<K, V> = Object.freeze({
		get size(): number {
			return source.size;
		},
		get(key: K): V | undefined {
			return source.get(key);
		},
		has(key: K): boolean {
			return source.has(key);
		},
		entries(): MapIterator<[K, V]> {
			return source.entries();
		},
		keys(): MapIterator<K> {
			return source.keys();
		},
		values(): MapIterator<V> {
			return source.values();
		},
		forEach(
			callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
			thisArg?: unknown,
		): void {
			for (const [key, value] of source) {
				Reflect.apply(callbackfn, thisArg, [value, key, view]);
			}
		},
		[Symbol.iterator](): MapIterator<[K, V]> {
			return source[Symbol.iterator]();
		},
	} satisfies ReadonlyMap<K, V>);
	return view;
}
