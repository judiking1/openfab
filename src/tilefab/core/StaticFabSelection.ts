import {
	applyPortEquipmentMutations,
	copyEquipmentGroupRecord,
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	equipmentGroupEquals,
	type PortEquipmentState,
} from "./EquipmentGroup";
import { assertPortEquipmentLayout } from "./PortEquipmentLayoutValidator";
import { copyPortRecord, type PortMutation, type PortRecord, portRecordEquals } from "./PortRecord";
import type { RailErasePlan } from "./paint";
import {
	planRailAreaBulldoze,
	type RailAreaSelection,
	railAreaSelectionStaleReason,
	subtractRailAreaSelections,
	unionRailAreaSelections,
} from "./RailAreaSelection";
import type { RailModuleOwnershipIndex } from "./RailModuleOwnership";
import type { TileMap } from "./TileMap";

export interface StaticFabSelectedEquipmentGroup {
	readonly group: EquipmentGroupRecord;
	readonly ports: readonly PortRecord[];
}

/** Revision- and command-bound selection over authored rail plus complete equipment groups. */
export interface StaticFabSelection {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly rail: RailAreaSelection;
	readonly equipmentGroups: readonly StaticFabSelectedEquipmentGroup[];
}

export type StaticFabSelectionErasePlan = Omit<RailErasePlan, "kind"> & {
	readonly kind: "erase-static-fab-selection";
	readonly basePatchSequence: number;
	readonly railPlan: RailErasePlan;
	readonly portMutations: readonly PortMutation[];
	readonly equipmentGroupMutations: readonly EquipmentGroupMutation[];
	readonly staticFabErase: Readonly<{
		railModuleCount: number;
		equipmentGroupCount: number;
		portCount: number;
	}>;
};

export function createStaticFabSelection(
	rail: RailAreaSelection,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	equipmentGroupIds: readonly number[],
): StaticFabSelection {
	assertPatchSequence(basePatchSequence);
	const groupsById = new Map(portEquipment.equipmentGroups.map((group) => [group.id, group]));
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port]));
	const uniqueGroupIds = [...new Set(equipmentGroupIds)].sort((left, right) => left - right);
	const equipmentGroups = uniqueGroupIds.map((groupId) => {
		const group = groupsById.get(groupId);
		if (!group) throw new Error(`장비 그룹 ${groupId}을 현재 정적 FAB에서 찾을 수 없습니다`);
		const ports = group.portIds.map((portId) => {
			const port = portsById.get(portId);
			if (!port) throw new Error(`장비 그룹 ${groupId}의 PORT-${portId}가 없습니다`);
			return copyPortRecord(port);
		});
		return Object.freeze({
			group: copyEquipmentGroupRecord(group),
			ports: Object.freeze(ports),
		});
	});
	return Object.freeze({
		baseRevision: rail.revision,
		basePatchSequence,
		rail,
		equipmentGroups: Object.freeze(equipmentGroups),
	});
}

export function unionStaticFabSelections(
	current: StaticFabSelection | null,
	incoming: StaticFabSelection,
): StaticFabSelection {
	if (!current) return incoming;
	if (
		current.baseRevision !== incoming.baseRevision ||
		current.basePatchSequence !== incoming.basePatchSequence
	) {
		throw new Error("서로 다른 정적 FAB 세대의 영역 선택은 합칠 수 없습니다");
	}
	const equipmentById = new Map<number, StaticFabSelectedEquipmentGroup>();
	for (const selected of [...current.equipmentGroups, ...incoming.equipmentGroups]) {
		const existing = equipmentById.get(selected.group.id);
		if (existing && !sameSelectedEquipmentGroup(existing, selected)) {
			throw new Error(`장비 그룹 ${selected.group.id}이 선택 중 변경되었습니다`);
		}
		equipmentById.set(selected.group.id, selected);
	}
	return Object.freeze({
		baseRevision: current.baseRevision,
		basePatchSequence: current.basePatchSequence,
		rail: unionRailAreaSelections(current.rail, incoming.rail),
		equipmentGroups: Object.freeze(
			[...equipmentById.values()].sort((left, right) => left.group.id - right.group.id),
		),
	});
}

/** Remove complete authored rail modules and equipment groups from an existing static selection. */
export function subtractStaticFabSelections(
	current: StaticFabSelection,
	incoming: StaticFabSelection,
): StaticFabSelection | null {
	if (current.baseRevision !== current.rail.revision) {
		throw new Error("현재 정적 FAB 선택의 레일 revision이 일치하지 않습니다");
	}
	if (incoming.baseRevision !== incoming.rail.revision) {
		throw new Error("제외할 정적 FAB 선택의 레일 revision이 일치하지 않습니다");
	}
	if (
		current.baseRevision !== incoming.baseRevision ||
		current.basePatchSequence !== incoming.basePatchSequence
	) {
		throw new Error("서로 다른 정적 FAB 세대의 영역 선택은 제외할 수 없습니다");
	}
	const rail = subtractRailAreaSelections(current.rail, incoming.rail);
	const equipmentById = new Map<number, StaticFabSelectedEquipmentGroup>();
	for (const selected of current.equipmentGroups) {
		if (equipmentById.has(selected.group.id)) {
			throw new Error(`현재 선택에 장비 그룹 ${selected.group.id}이 중복되었습니다`);
		}
		equipmentById.set(selected.group.id, selected);
	}
	let equipmentChanged = false;
	const incomingIds = new Set<number>();
	for (const selected of incoming.equipmentGroups) {
		if (incomingIds.has(selected.group.id)) {
			throw new Error(`제외할 선택에 장비 그룹 ${selected.group.id}이 중복되었습니다`);
		}
		incomingIds.add(selected.group.id);
		const existing = equipmentById.get(selected.group.id);
		if (!existing) continue;
		if (!sameSelectedEquipmentGroup(existing, selected)) {
			throw new Error(`장비 그룹 ${selected.group.id}이 선택 중 변경되었습니다`);
		}
		equipmentById.delete(selected.group.id);
		equipmentChanged = true;
	}
	if (rail.ownerships.length === 0 && equipmentById.size === 0) return null;
	if (rail === current.rail && !equipmentChanged) return current;
	return Object.freeze({
		baseRevision: current.baseRevision,
		basePatchSequence: current.basePatchSequence,
		rail,
		equipmentGroups: Object.freeze(
			[...equipmentById.values()].sort((left, right) => left.group.id - right.group.id),
		),
	});
}

export function staticFabSelectionStaleReason(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	selection: StaticFabSelection,
): string | null {
	if (
		selection.baseRevision !== map.getRevision() ||
		selection.basePatchSequence !== patchSequence
	) {
		return "선택 이후 정적 FAB가 변경되어 영역을 다시 선택해야 합니다";
	}
	const railReason = railAreaSelectionStaleReason(map, ownership, selection.rail);
	if (railReason) return railReason;
	const groupsById = new Map(portEquipment.equipmentGroups.map((group) => [group.id, group]));
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port]));
	const seenGroups = new Set<number>();
	for (const selected of selection.equipmentGroups) {
		if (seenGroups.has(selected.group.id)) {
			return `선택 영역에 장비 그룹 ${selected.group.id}이 중복되었습니다`;
		}
		seenGroups.add(selected.group.id);
		const currentGroup = groupsById.get(selected.group.id);
		if (!equipmentGroupEquals(currentGroup, selected.group)) {
			return `장비 그룹 ${selected.group.id}이 선택 이후 변경되었습니다`;
		}
		if (selected.ports.length !== selected.group.portIds.length) {
			return `장비 그룹 ${selected.group.id}의 포트 스냅샷이 완전하지 않습니다`;
		}
		for (let index = 0; index < selected.group.portIds.length; index++) {
			const portId = selected.group.portIds[index] as number;
			const selectedPort = selected.ports[index];
			if (
				!selectedPort ||
				selectedPort.id !== portId ||
				!portRecordEquals(portsById.get(portId), selectedPort)
			) {
				return `PORT-${portId}가 선택 이후 변경되었습니다`;
			}
		}
	}
	return null;
}

export function staticFabSelectionEquipmentGroupIds(
	selection: StaticFabSelection,
): readonly number[] {
	return Object.freeze(selection.equipmentGroups.map((selected) => selected.group.id));
}

export function staticFabSelectionPortCount(selection: StaticFabSelection): number {
	return selection.equipmentGroups.reduce((count, selected) => count + selected.ports.length, 0);
}

/** Plan rail, port, and complete equipment-group removal as one revision/sequence-bound command. */
export function planStaticFabSelectionErase(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	basePatchSequence: number,
	selection: StaticFabSelection,
): StaticFabSelectionErasePlan {
	const staleReason = staticFabSelectionStaleReason(
		map,
		ownership,
		portEquipment,
		basePatchSequence,
		selection,
	);
	const railPlan =
		selection.rail.ownerships.length === 0
			? equipmentOnlyRailErasePlan(map)
			: planRailAreaBulldoze(map, ownership, selection.rail);
	if (staleReason)
		return invalidStaticFabErase(railPlan, basePatchSequence, selection, staleReason);
	if (selection.rail.ownerships.length === 0 && selection.equipmentGroups.length === 0) {
		return invalidStaticFabErase(
			railPlan,
			basePatchSequence,
			selection,
			"철거할 레일 또는 장비가 선택되지 않았습니다",
		);
	}
	if (!railPlan.valid) {
		return invalidStaticFabErase(railPlan, basePatchSequence, selection, railPlan.reason);
	}
	if (
		selection.equipmentGroups.some(
			(selected) => selected.group.kind === "STK" && selected.group.template === "CUSTOM",
		)
	) {
		return invalidStaticFabErase(
			railPlan,
			basePatchSequence,
			selection,
			"legacy CUSTOM STK 그룹은 정적 FAB 영역 철거에서 변경할 수 없습니다",
		);
	}
	const portMutations = Object.freeze(
		selection.equipmentGroups
			.flatMap((selected) => selected.ports)
			.sort((left, right) => left.id - right.id)
			.map((port) => Object.freeze({ id: port.id, before: copyPortRecord(port), after: null })),
	);
	const equipmentGroupMutations = Object.freeze(
		selection.equipmentGroups.map((selected) =>
			Object.freeze({
				id: selected.group.id,
				before: copyEquipmentGroupRecord(selected.group),
				after: null,
			}),
		),
	);
	try {
		const prospectiveMap = map.clone();
		prospectiveMap.applyAtomicMutations(railPlan.mutations, railPlan.switchMutations);
		const prospectiveEquipment = applyPortEquipmentMutations(
			portEquipment,
			portMutations,
			equipmentGroupMutations,
		);
		assertPortEquipmentLayout(prospectiveMap, prospectiveEquipment);
	} catch (error) {
		return invalidStaticFabErase(
			railPlan,
			basePatchSequence,
			selection,
			error instanceof Error ? error.message : "정적 FAB 영역 철거 검증에 실패했습니다",
		);
	}
	return Object.freeze({
		...railPlan,
		kind: "erase-static-fab-selection",
		basePatchSequence,
		railPlan,
		portMutations,
		equipmentGroupMutations,
		staticFabErase: staticFabEraseMetadata(selection),
		reason: `레일 ${selection.rail.ownerships.length}개 · 장비 ${selection.equipmentGroups.length}개 · 포트 ${portMutations.length}개 일괄 철거`,
	});
}

export function isStaticFabSelectionErasePlan(plan: unknown): plan is StaticFabSelectionErasePlan {
	return typeof plan === "object" && plan !== null && "staticFabErase" in plan;
}

function sameSelectedEquipmentGroup(
	left: StaticFabSelectedEquipmentGroup,
	right: StaticFabSelectedEquipmentGroup,
): boolean {
	return (
		equipmentGroupEquals(left.group, right.group) &&
		left.ports.length === right.ports.length &&
		left.ports.every((port, index) => portRecordEquals(port, right.ports[index]))
	);
}

function assertPatchSequence(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError("정적 FAB 선택 patch sequence는 0 이상의 정수여야 합니다");
	}
}

function invalidStaticFabErase(
	railPlan: RailErasePlan,
	basePatchSequence: number,
	selection: StaticFabSelection,
	reason: string,
): StaticFabSelectionErasePlan {
	return Object.freeze({
		...railPlan,
		kind: "erase-static-fab-selection",
		valid: false,
		reason,
		basePatchSequence,
		railPlan,
		portMutations: Object.freeze([]),
		equipmentGroupMutations: Object.freeze([]),
		staticFabErase: staticFabEraseMetadata(selection),
	});
}

function staticFabEraseMetadata(selection: StaticFabSelection) {
	return Object.freeze({
		railModuleCount: selection.rail.ownerships.length,
		equipmentGroupCount: selection.equipmentGroups.length,
		portCount: staticFabSelectionPortCount(selection),
	});
}

function equipmentOnlyRailErasePlan(map: TileMap): RailErasePlan {
	return Object.freeze({
		kind: "erase",
		baseRevision: map.getRevision(),
		cells: Object.freeze([]),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		valid: true,
		reason: "장비 전용 영역 철거",
	});
}
