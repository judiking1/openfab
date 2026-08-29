import type { PortEquipmentState } from "../core/EquipmentGroup";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import type { RailModuleOwnership, RailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	STATIC_FAB_ARRANGEMENT_VERSION,
	type StaticFabArrangementAxis,
	type StaticFabArrangementBounds,
	type StaticFabArrangementMode,
	type StaticFabArrangementResult,
	type StaticFabArrangementRoot,
	solveStaticFabArrangement,
} from "../core/StaticFabArrangement";
import {
	prepareStaticFabArrangementCommand,
	STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
	type StaticFabArrangementCommandIntent,
} from "../core/StaticFabArrangementCommand";
import {
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";
import {
	resolveStaticFabOrganizationSelectionFromState,
	type StaticFabOrganizationSelectionMode,
} from "../core/StaticFabOrganizationSelection";
import {
	createStaticFabSelection,
	type StaticFabSelection,
	staticFabSelectionStaleReason,
} from "../core/StaticFabSelection";
import { cellKey, type TileMap } from "../core/TileMap";
import {
	type CompiledPortEquipmentPresentation,
	equipmentGroupPresentationRow,
} from "./PortEquipmentPresentation";
import { resolveStaticFabEquipmentGroupsForRailSelection } from "./StaticFabSelectionResolver";

export type StaticFabArrangementRootKind = "STATIC_COMPONENT" | "ORGANIZATION";

export interface ResolvedStaticFabArrangementRoot extends StaticFabArrangementRoot {
	readonly kind: StaticFabArrangementRootKind;
	readonly selection: StaticFabSelection;
	readonly moduleKeys: readonly string[];
	readonly advancedSwitchIds: readonly number[];
	readonly equipmentGroupIds: readonly number[];
	readonly organizationRootIds: readonly number[];
	readonly organizationSelectionMode: StaticFabOrganizationSelectionMode | null;
}

export type StaticFabArrangementRootFailureCode =
	| "INVALID_SOURCE"
	| "EMPTY_SELECTION"
	| "MISSING_ROOT"
	| "PARTIAL_EQUIPMENT"
	| "UNASSIGNED_EQUIPMENT"
	| "OVERLAPPING_ROOTS"
	| "INVALID_BOUNDS";

export type StaticFabArrangementRootResolution =
	| {
			readonly valid: true;
			readonly code: null;
			readonly reason: string;
			readonly roots: readonly ResolvedStaticFabArrangementRoot[];
			readonly suppressedOrganizationRootIds: readonly number[];
	  }
	| {
			readonly valid: false;
			readonly code: StaticFabArrangementRootFailureCode;
			readonly reason: string;
			readonly roots: readonly [];
			readonly suppressedOrganizationRootIds: readonly number[];
	  };

/** Resolve each selected organization independently so arrangement never loses root boundaries. */
export function resolveStaticFabOrganizationArrangementRoots(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	organizationIds: readonly number[],
	mode: StaticFabOrganizationSelectionMode,
	presentation: CompiledPortEquipmentPresentation | null = null,
): StaticFabArrangementRootResolution {
	if (ownership.revision !== map.getRevision()) {
		return failure("INVALID_SOURCE", "현재 레일 모듈 인덱스가 오래되었습니다");
	}
	if (mode !== "DIRECT" && mode !== "EFFECTIVE") {
		return failure("INVALID_SOURCE", "조직 정렬 범위가 유효하지 않습니다");
	}
	const requestedIds = [...new Set(organizationIds)].sort(numberCompare);
	if (requestedIds.length === 0) {
		return failure("EMPTY_SELECTION", "정렬할 조직을 하나 이상 선택하세요");
	}
	const recordsById = new Map(organizations.records.map((record) => [record.id, record] as const));
	for (const organizationId of requestedIds) {
		if (!recordsById.has(organizationId)) {
			return failure("MISSING_ROOT", `조직 ${organizationId}을 현재 정적 FAB에서 찾을 수 없습니다`);
		}
	}
	const suppressed =
		mode === "EFFECTIVE"
			? selectedDescendantsCoveredBySelectedAncestors(organizations, requestedIds)
			: new Set<number>();
	const effectiveRootIds = requestedIds.filter((id) => !suppressed.has(id));
	const roots: ResolvedStaticFabArrangementRoot[] = [];
	for (const organizationId of effectiveRootIds) {
		const resolution = resolveStaticFabOrganizationSelectionFromState(
			ownership,
			portEquipment,
			patchSequence,
			organizations,
			organizationId,
			mode,
		);
		if (!resolution.valid) return failure("INVALID_SOURCE", resolution.reason, suppressed);
		const root = createResolvedRoot(
			"ORGANIZATION",
			`organization:${organizationId}:${mode}`,
			resolution.selection,
			[organizationId],
			mode,
			presentation,
		);
		if (!root) {
			return failure(
				"INVALID_BOUNDS",
				`조직 ${organizationId}의 정렬 footprint를 계산할 수 없습니다`,
				suppressed,
			);
		}
		roots.push(root);
	}
	return validateResolvedRoots(roots, suppressed);
}

/** Resolve one ordinary marquee selection into independent connected authored components. */
export function resolveStaticFabSelectionArrangementRoots(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	selection: StaticFabSelection,
	presentation: CompiledPortEquipmentPresentation | null = null,
): StaticFabArrangementRootResolution {
	const staleReason = staticFabSelectionStaleReason(
		map,
		ownership,
		portEquipment,
		patchSequence,
		selection,
	);
	if (staleReason) return failure("INVALID_SOURCE", staleReason);
	if (selection.rail.ownerships.length === 0) {
		return failure("EMPTY_SELECTION", "정렬할 완전한 레일 모듈이 없습니다");
	}
	const components = connectedOwnershipComponents(selection.rail.ownerships);
	const selectedEquipmentIds = new Set(
		selection.equipmentGroups.map((selected) => selected.group.id),
	);
	const assignedEquipmentIds = new Set<number>();
	const roots: ResolvedStaticFabArrangementRoot[] = [];
	for (const component of components) {
		const rail = createRailAreaSelectionFromOwnerships(ownership, component, "fully-contained");
		const equipment = resolveStaticFabEquipmentGroupsForRailSelection(portEquipment, rail);
		if (equipment.partialGroupIds.length > 0) {
			return failure(
				"PARTIAL_EQUIPMENT",
				`레일 컴포넌트가 장비 그룹 ${equipment.partialGroupIds.join(", ")}의 일부 포트만 포함합니다`,
			);
		}
		// A rail root carries every complete attached group. This keeps route-bound ports and their
		// equipment body together even when the marquee only crossed the authored rail footprint.
		const equipmentGroupIds = equipment.completeGroupIds;
		for (const groupId of equipmentGroupIds) {
			if (assignedEquipmentIds.has(groupId)) {
				return failure(
					"OVERLAPPING_ROOTS",
					`장비 그룹 ${groupId}이 둘 이상의 정렬 루트에 포함됩니다`,
				);
			}
			assignedEquipmentIds.add(groupId);
		}
		const componentSelection = createStaticFabSelection(
			rail,
			portEquipment,
			patchSequence,
			equipmentGroupIds,
		);
		const firstKey = component[0]?.key;
		if (!firstKey) return failure("INVALID_SOURCE", "빈 레일 컴포넌트가 생성되었습니다");
		const root = createResolvedRoot(
			"STATIC_COMPONENT",
			`component:${firstKey}`,
			componentSelection,
			[],
			null,
			presentation,
		);
		if (!root) {
			return failure("INVALID_BOUNDS", `컴포넌트 '${firstKey}'의 footprint가 유효하지 않습니다`);
		}
		roots.push(root);
	}
	const unassigned = [...selectedEquipmentIds].filter((id) => !assignedEquipmentIds.has(id));
	if (unassigned.length > 0) {
		return failure(
			"UNASSIGNED_EQUIPMENT",
			`선택한 장비 그룹 ${unassigned.join(", ")}을 하나의 완전한 레일 컴포넌트에 연결할 수 없습니다`,
		);
	}
	return validateResolvedRoots(roots, new Set());
}

function connectedOwnershipComponents(
	ownerships: readonly RailModuleOwnership[],
): readonly (readonly RailModuleOwnership[])[] {
	const ordered = [...ownerships].sort((left, right) => compareText(left.key, right.key));
	const parent = ordered.map((_, index) => index);
	const firstModuleByCell = new Map<string, number>();
	for (let index = 0; index < ordered.length; index++) {
		const ownership = ordered[index];
		if (!ownership) continue;
		const cells = new Set<string>();
		for (const edge of ownership.eraseEdges) {
			cells.add(cellKey(edge.from.x, edge.from.y));
			cells.add(cellKey(edge.to.x, edge.to.y));
		}
		for (const cell of ownership.footprintCells) cells.add(cellKey(cell.x, cell.y));
		for (const key of cells) {
			const previous = firstModuleByCell.get(key);
			if (previous === undefined) firstModuleByCell.set(key, index);
			else union(parent, previous, index);
		}
	}
	const grouped = new Map<number, RailModuleOwnership[]>();
	for (let index = 0; index < ordered.length; index++) {
		const ownership = ordered[index];
		if (!ownership) continue;
		const root = find(parent, index);
		const group = grouped.get(root);
		if (group) group.push(ownership);
		else grouped.set(root, [ownership]);
	}
	return Object.freeze(
		[...grouped.values()]
			.map((component) =>
				Object.freeze(component.sort((left, right) => compareText(left.key, right.key))),
			)
			.sort((left, right) => compareText(left[0]?.key ?? "", right[0]?.key ?? "")),
	);
}

function createResolvedRoot(
	kind: StaticFabArrangementRootKind,
	key: string,
	selection: StaticFabSelection,
	organizationRootIds: readonly number[],
	organizationSelectionMode: StaticFabOrganizationSelectionMode | null,
	presentation: CompiledPortEquipmentPresentation | null,
): ResolvedStaticFabArrangementRoot | null {
	const moduleKeys = Object.freeze(
		selection.rail.ownerships.map((module) => module.key).sort(compareText),
	);
	const advancedSwitchIds = Object.freeze(
		selection.rail.ownerships
			.flatMap((module) => (module.advancedSwitchId === null ? [] : [module.advancedSwitchId]))
			.sort(numberCompare),
	);
	const equipmentGroupIds = Object.freeze(
		selection.equipmentGroups.map((selected) => selected.group.id).sort(numberCompare),
	);
	const bounds = rootBounds(selection, presentation);
	if (!bounds) return null;
	return Object.freeze({
		kind,
		key,
		bounds,
		selection,
		moduleKeys,
		advancedSwitchIds,
		equipmentGroupIds,
		organizationRootIds: Object.freeze([...organizationRootIds].sort(numberCompare)),
		organizationSelectionMode,
	});
}

/** Convert already-resolved roots into the bounded portable intent re-resolved by the Worker. */
export function staticFabArrangementCommandFromRoots(
	axis: StaticFabArrangementAxis,
	mode: StaticFabArrangementMode,
	roots: readonly ResolvedStaticFabArrangementRoot[],
): StaticFabArrangementCommandIntent {
	const prepared = prepareStaticFabArrangementCommand({
		version: STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
		arrangementVersion: STATIC_FAB_ARRANGEMENT_VERSION,
		axis,
		mode,
		roots: roots.map((root) => {
			if (root.kind === "STATIC_COMPONENT") {
				return { kind: "STATIC_COMPONENT" as const, moduleKeys: root.moduleKeys };
			}
			const organizationId = root.organizationRootIds[0];
			if (organizationId === undefined || root.organizationRootIds.length !== 1) {
				throw new Error(`조직 정렬 루트 '${root.key}'의 identity가 유효하지 않습니다`);
			}
			if (!root.organizationSelectionMode) {
				throw new Error(`조직 정렬 루트 '${root.key}'의 선택 범위가 없습니다`);
			}
			return {
				kind: "ORGANIZATION" as const,
				organizationId,
				selectionMode: root.organizationSelectionMode,
			};
		}),
	});
	if (!prepared.valid) throw new Error(prepared.reason);
	return prepared.intent;
}

/** Type-safe UI preview adapter; Worker command references are intentionally not solver input. */
export function solveStaticFabArrangementFromRoots(
	axis: StaticFabArrangementAxis,
	mode: StaticFabArrangementMode,
	roots: readonly ResolvedStaticFabArrangementRoot[],
): StaticFabArrangementResult {
	return solveStaticFabArrangement({
		version: STATIC_FAB_ARRANGEMENT_VERSION,
		axis,
		mode,
		roots: roots.map((root) => ({ key: root.key, bounds: root.bounds })),
	});
}

function rootBounds(
	selection: StaticFabSelection,
	presentation: CompiledPortEquipmentPresentation | null,
): StaticFabArrangementBounds | null {
	const mutable = emptyBounds();
	for (const module of selection.rail.ownerships) {
		for (const cell of module.footprintCells) includeCell(mutable, cell.x, cell.y);
	}
	if (presentation) {
		for (const selected of selection.equipmentGroups) {
			const groupRow = equipmentGroupPresentationRow(presentation, selected.group.id);
			if (groupRow === null) return null;
			const sectionStart = presentation.groupBodySectionOffsets[groupRow] as number;
			const sectionEnd = presentation.groupBodySectionOffsets[groupRow + 1] as number;
			if (sectionStart === sectionEnd)
				includePresentationBounds(mutable, presentation.groupBounds, groupRow);
			else {
				for (let row = sectionStart; row < sectionEnd; row++) {
					includePresentationBounds(mutable, presentation.bodySectionBounds, row);
				}
			}
			const portStart = presentation.groupPortOffsets[groupRow] as number;
			const portEnd = presentation.groupPortOffsets[groupRow + 1] as number;
			for (let offset = portStart; offset < portEnd; offset++) {
				const portRow = presentation.groupPortRows[offset] as number;
				includePointCell(
					mutable,
					presentation.worldPositions[portRow * 2] as number,
					presentation.worldPositions[portRow * 2 + 1] as number,
				);
			}
		}
	}
	return freezeBounds(mutable);
}

function validateResolvedRoots(
	roots: readonly ResolvedStaticFabArrangementRoot[],
	suppressed: ReadonlySet<number>,
): StaticFabArrangementRootResolution {
	const ordered = [...roots].sort((left, right) => compareText(left.key, right.key));
	const moduleOwner = new Map<string, string>();
	const equipmentOwner = new Map<number, string>();
	for (const root of ordered) {
		for (const moduleKey of root.moduleKeys) {
			const previous = moduleOwner.get(moduleKey);
			if (previous) {
				return failure(
					"OVERLAPPING_ROOTS",
					`정렬 루트 '${previous}'와 '${root.key}'가 레일 모듈 '${moduleKey}'을 공유합니다`,
					suppressed,
				);
			}
			moduleOwner.set(moduleKey, root.key);
		}
		for (const groupId of root.equipmentGroupIds) {
			const previous = equipmentOwner.get(groupId);
			if (previous) {
				return failure(
					"OVERLAPPING_ROOTS",
					`정렬 루트 '${previous}'와 '${root.key}'가 장비 그룹 ${groupId}을 공유합니다`,
					suppressed,
				);
			}
			equipmentOwner.set(groupId, root.key);
		}
	}
	return Object.freeze({
		valid: true,
		code: null,
		reason: `${ordered.length}개 독립 정적 FAB 루트를 확인했습니다`,
		roots: Object.freeze(ordered),
		suppressedOrganizationRootIds: Object.freeze([...suppressed].sort(numberCompare)),
	});
}

/** Recheck roots assembled from independent portable references before solving one command. */
export function validateResolvedStaticFabArrangementRoots(
	roots: readonly ResolvedStaticFabArrangementRoot[],
): StaticFabArrangementRootResolution {
	return validateResolvedRoots(roots, new Set());
}

function selectedDescendantsCoveredBySelectedAncestors(
	state: StaticFabOrganizationState,
	selectedIds: readonly number[],
): Set<number> {
	const selected = new Set(selectedIds);
	const parentsById = new Map(
		state.records.map((record) => [record.id, staticFabOrganizationParentIds(record)] as const),
	);
	const suppressed = new Set<number>();
	for (const organizationId of selectedIds) {
		const pending = [...(parentsById.get(organizationId) ?? [])];
		const visited = new Set<number>();
		for (let offset = 0; offset < pending.length; offset++) {
			const parentId = pending[offset];
			if (parentId === undefined || visited.has(parentId)) continue;
			visited.add(parentId);
			if (selected.has(parentId)) {
				suppressed.add(organizationId);
				break;
			}
			pending.push(...(parentsById.get(parentId) ?? []));
		}
	}
	return suppressed;
}

interface MutableBounds {
	minX: number;
	minZ: number;
	maxXExclusive: number;
	maxZExclusive: number;
}

function emptyBounds(): MutableBounds {
	return {
		minX: Number.POSITIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxXExclusive: Number.NEGATIVE_INFINITY,
		maxZExclusive: Number.NEGATIVE_INFINITY,
	};
}

function includeCell(bounds: MutableBounds, x: number, z: number): void {
	bounds.minX = Math.min(bounds.minX, x);
	bounds.minZ = Math.min(bounds.minZ, z);
	bounds.maxXExclusive = Math.max(bounds.maxXExclusive, x + 1);
	bounds.maxZExclusive = Math.max(bounds.maxZExclusive, z + 1);
}

function includePointCell(bounds: MutableBounds, x: number, z: number): void {
	includeCell(bounds, Math.floor(x), Math.floor(z));
}

function includePresentationBounds(
	bounds: MutableBounds,
	columns: Float32Array,
	row: number,
): void {
	const offset = row * 4;
	const minX = columns[offset] as number;
	const minZ = columns[offset + 1] as number;
	const maxX = columns[offset + 2] as number;
	const maxZ = columns[offset + 3] as number;
	if (![minX, minZ, maxX, maxZ].every(Number.isFinite)) return;
	bounds.minX = Math.min(bounds.minX, Math.floor(minX));
	bounds.minZ = Math.min(bounds.minZ, Math.floor(minZ));
	bounds.maxXExclusive = Math.max(bounds.maxXExclusive, Math.ceil(maxX));
	bounds.maxZExclusive = Math.max(bounds.maxZExclusive, Math.ceil(maxZ));
}

function freezeBounds(bounds: MutableBounds): StaticFabArrangementBounds | null {
	if (
		![bounds.minX, bounds.minZ, bounds.maxXExclusive, bounds.maxZExclusive].every(isInt32) ||
		bounds.minX >= bounds.maxXExclusive ||
		bounds.minZ >= bounds.maxZExclusive
	) {
		return null;
	}
	return Object.freeze({ ...bounds });
}

function find(parent: number[], index: number): number {
	let root = index;
	while ((parent[root] as number) !== root) root = parent[root] as number;
	let current = index;
	while ((parent[current] as number) !== current) {
		const next = parent[current] as number;
		parent[current] = root;
		current = next;
	}
	return root;
}

function union(parent: number[], left: number, right: number): void {
	const leftRoot = find(parent, left);
	const rightRoot = find(parent, right);
	if (leftRoot === rightRoot) return;
	parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

function failure(
	code: StaticFabArrangementRootFailureCode,
	reason: string,
	suppressed: ReadonlySet<number> = new Set(),
): StaticFabArrangementRootResolution {
	return Object.freeze({
		valid: false,
		code,
		reason,
		roots: Object.freeze([]) as readonly [],
		suppressedOrganizationRootIds: Object.freeze([...suppressed].sort(numberCompare)),
	});
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function numberCompare(left: number, right: number): number {
	return left - right;
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}
