import { resolveEqBodyEditTransition } from "../core/EqBodyEdit";
import { resolveEqRecipeEditTransition } from "../core/EqRecipeEdit";
import {
	applyPortEquipmentMutations,
	collectPortEquipmentIntegrityIssues,
	copyEqBodyDimensionsProperties,
	type EqBodyDimensions,
	type EquipmentGroupRecord,
	equipmentGroupEquals,
	type OhbEquipmentGroup,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import { allocatePortEquipmentRecordIds } from "../core/PortEquipmentIdAllocator";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import { portEquipmentLoopEditTargetError } from "../core/PortEquipmentLoopEdit";
import {
	createInvalidPortEquipmentMutationPlan,
	createPortEquipmentMutationPlan,
	type PortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import {
	resolvePortEquipmentServiceDirectionTransition,
	reversePortServiceDirection,
} from "../core/PortEquipmentServiceDirection";
import { type PortRecord, portRecordEquals } from "../core/PortRecord";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
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

export function planResizeEqBody(
	map: TileMap,
	state: PortEquipmentState,
	selection: { readonly portId: number; readonly equipmentGroupId: number },
	dimensions: EqBodyDimensions | null,
	baseRevision: number,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
): PortEquipmentMutationPlan {
	const fail = (reason: string) =>
		invalid("edit-port-equipment", baseRevision, basePatchSequence, reason);
	if (map.getRevision() !== baseRevision)
		return fail("원본 레일이 변경되었습니다 · EQ를 다시 선택하세요");
	if (collectPortEquipmentIntegrityIssues(state).length > 0)
		return fail("장비 Port 관계가 불완전합니다 · 무결성을 복구한 뒤 다시 선택하세요");
	const source = state.equipmentGroups.find((group) => group.id === selection.equipmentGroupId);
	const port = state.ports.find((candidate) => candidate.id === selection.portId);
	if (
		source?.kind !== "EQ" ||
		!port ||
		port.equipmentGroupId !== source.id ||
		!source.portIds.includes(port.id)
	)
		return fail("몸체 크기를 편집할 EQ와 Port를 다시 선택하세요");
	try {
		const target = {
			...source,
			...copyEqBodyDimensionsProperties(dimensions === null ? {} : { bodyDimensions: dimensions }),
		};
		if (dimensions === null) delete target.bodyDimensions;
		if (equipmentGroupEquals(source, target)) return fail("EQ 몸체 크기가 현재 값과 같습니다");
		const changes = [{ id: source.id, before: source, after: target }];
		const after = applyPortEquipmentMutations(state, [], changes);
		const transition = resolveEqBodyEditTransition(organizations, state, after, [], changes);
		if (!transition || transition.reason)
			return fail(transition?.reason ?? "EQ 몸체 크기 변경을 확인할 수 없습니다");
		assertPortEquipmentLayout(map, after);
		return createPortEquipmentMutationPlan(
			"edit-port-equipment",
			baseRevision,
			basePatchSequence,
			[],
			changes,
		);
	} catch (error) {
		return fail(error instanceof Error ? error.message : "EQ 몸체 크기를 적용할 수 없습니다");
	}
}

/** Match creation normalization; recipe remains an optional authoring label, never a process rule. */
export function planEditEqRecipe(
	map: TileMap,
	state: PortEquipmentState,
	selection: { readonly portId: number; readonly equipmentGroupId: number },
	text: string,
	baseRevision: number,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
): PortEquipmentMutationPlan {
	const fail = (reason: string) =>
		invalid("edit-port-equipment", baseRevision, basePatchSequence, reason);
	if (map.getRevision() !== baseRevision)
		return fail("원본 레일이 변경되었습니다 · EQ를 다시 선택하세요");
	if (collectPortEquipmentIntegrityIssues(state).length > 0)
		return fail("장비 Port 관계가 불완전합니다 · 무결성을 복구한 뒤 다시 선택하세요");
	const source = state.equipmentGroups.find((group) => group.id === selection.equipmentGroupId);
	const port = state.ports.find((candidate) => candidate.id === selection.portId);
	if (
		source?.kind !== "EQ" ||
		!port ||
		port.equipmentGroupId !== source.id ||
		!source.portIds.includes(port.id)
	)
		return fail("Recipe를 편집할 EQ와 Port를 다시 선택하세요");
	const recipe = text.trim() || null;
	if (recipe === source.recipe) return fail("Recipe가 현재 값과 같습니다");
	try {
		const changes = [{ id: source.id, before: source, after: { ...source, recipe } }];
		const after = applyPortEquipmentMutations(state, [], changes);
		const transition = resolveEqRecipeEditTransition(organizations, state, after, [], changes);
		if (!transition || transition.reason)
			return fail(transition?.reason ?? "EQ Recipe 변경을 확인할 수 없습니다");
		assertPortEquipmentLayout(map, after);
		return createPortEquipmentMutationPlan(
			"edit-port-equipment",
			baseRevision,
			basePatchSequence,
			[],
			changes,
		);
	} catch (error) {
		return fail(error instanceof Error ? error.message : "EQ Recipe를 적용할 수 없습니다");
	}
}

/** Flip service facing in place as one atomic edit; rail flow and slot geometry stay unchanged. */
export function planReversePortEquipmentServiceDirection(
	state: PortEquipmentState,
	selection: { readonly portId: number; readonly equipmentGroupId: number },
	baseRevision: number,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
): PortEquipmentMutationPlan {
	const fail = (reason: string) =>
		invalid("edit-port-equipment", baseRevision, basePatchSequence, reason);
	if (collectPortEquipmentIntegrityIssues(state).length > 0) {
		return fail("장비 Port 관계가 불완전합니다 · 검사 화면에서 무결성을 복구한 뒤 다시 선택하세요");
	}
	const group = state.equipmentGroups.find(
		(candidate) => candidate.id === selection.equipmentGroupId,
	);
	const selected = state.ports.find((port) => port.id === selection.portId);
	if (
		!group ||
		!selected ||
		selected.equipmentGroupId !== group.id ||
		!group.portIds.includes(selected.id)
	) {
		return fail(
			"선택한 장비 또는 Port가 변경되었습니다 · 서비스 방향을 반전할 장비를 다시 선택하세요",
		);
	}
	const mutations = state.ports
		.filter((port) => port.equipmentGroupId === group.id)
		.map((port) => ({
			id: port.id,
			before: port,
			after: { ...port, direction: reversePortServiceDirection(port.direction) },
		}));
	const replacements = new Map(mutations.map((change) => [change.id, change.after]));
	const after = { ...state, ports: state.ports.map((port) => replacements.get(port.id) ?? port) };
	const transition = resolvePortEquipmentServiceDirectionTransition(
		organizations,
		state,
		after,
		mutations,
		[],
	);
	if (!transition || transition.reason)
		return fail(transition?.reason ?? "반전할 전체 Port를 찾을 수 없습니다");
	return createPortEquipmentMutationPlan(
		"edit-port-equipment",
		baseRevision,
		basePatchSequence,
		mutations,
		[],
	);
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
	organizations?: StaticFabOrganizationState,
): PortEquipmentMutationPlan {
	const source = resolveSingleOhb(state, equipmentGroupId);
	if (typeof source === "string") {
		return invalid("edit-port-equipment", baseRevision, basePatchSequence, source);
	}
	const rowError = slotRowError(slots, row, availability, baseRevision, source.port.id);
	if (rowError) {
		return invalid("edit-port-equipment", baseRevision, basePatchSequence, rowError);
	}
	const moved = {
		...portSlotRecord(slots, row, source.port.id, source.equipmentGroup.id, source.port.barcode),
		direction: source.port.direction,
	};
	const ownershipError = organizations
		? portEquipmentLoopEditTargetError(
				organizations,
				source.equipmentGroup,
				[source.port],
				source.equipmentGroup,
				[moved],
			)
		: null;
	if (ownershipError)
		return invalid("edit-port-equipment", baseRevision, basePatchSequence, ownershipError);
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
	const copiedPort = {
		...portSlotRecord(slots, row, portId, equipmentGroupId, `OHB-${portId}`),
		direction: source.port.direction,
	};
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
