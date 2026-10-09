import { eqPitchPortTargets, resolveEqPitchEditTransition } from "../core/EqPitchEdit";
import {
	applyPortEquipmentMutations,
	collectPortEquipmentIntegrityIssues,
	defaultEqBodyDimensions,
	type EquipmentGroupRecord,
	equipmentGroupEquals,
	equipmentGroupError,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import {
	canonicalEquipmentGroupPortIds,
	copyEquipmentGroupWithPortIds,
} from "../core/EquipmentGroupPortOrder";
import { allocatePortEquipmentRecordIds } from "../core/PortEquipmentIdAllocator";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import { portEquipmentLoopEditTargetError } from "../core/PortEquipmentLoopEdit";
import {
	createInvalidPortEquipmentMutationPlan,
	createPortEquipmentMutationPlan,
	type PortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import { type PortMutation, type PortRecord, portRecordEquals } from "../core/PortRecord";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
import {
	capturePortEquipmentGroupEditSnapshot,
	type PortEquipmentGroupSlotIndex,
} from "./PortEquipmentGroupEditPlanner";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
	portSlotRecord,
} from "./PortSlotCompiler";

export interface PortEquipmentMembershipEditMetadata {
	readonly sourceEquipmentGroupId: number;
	readonly targetRows: readonly number[];
	readonly retainedPortIds: readonly number[];
	readonly addedPortIds: readonly number[];
	readonly removedPortIds: readonly number[];
}

export interface PortEquipmentMembershipEditPlan extends PortEquipmentMutationPlan {
	readonly membershipEdit: PortEquipmentMembershipEditMetadata;
}

export interface PortEquipmentMembershipEditReview {
	readonly valid: boolean;
	readonly reason: string;
}

/** Preview and commit use the same exact, anchor-fixed pitch plan; no IDs are allocated. */
export function planEqPortPitchEdit(
	map: TileMap,
	slots: CompiledPortSlots,
	slotIndex: PortEquipmentGroupSlotIndex,
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	selection: { readonly equipmentGroupId: number; readonly portId: number },
	pitchMillimeters: number,
	baseRevision: number,
	basePatchSequence: number,
	organizations: StaticFabOrganizationState,
): PortEquipmentMembershipEditPlan {
	let editMetadata = metadata(selection.equipmentGroupId, [], [], [], []);
	const fail = (reason: string) => invalid(baseRevision, basePatchSequence, editMetadata, reason);
	if (
		map.getRevision() !== baseRevision ||
		slots.revision !== baseRevision ||
		slotIndex.revision !== baseRevision ||
		availability.revision !== baseRevision ||
		!slotIndex.matches(slots) ||
		!availability.matchesState(state)
	)
		return fail("원본 슬롯이나 장비가 변경되었습니다 · EQ를 다시 선택하세요");
	if (slots.portType !== "EQ" || slotIndex.portType !== "EQ" || availability.portType !== "EQ")
		return fail("EQ 간격 편집에는 EQ 슬롯이 필요합니다");
	if (collectPortEquipmentIntegrityIssues(state).length > 0)
		return fail("장비 Port 관계가 불완전합니다 · EQ를 다시 확인하세요");
	try {
		const snapshot = capturePortEquipmentGroupEditSnapshot(
			state,
			selection.equipmentGroupId,
			selection.portId,
		);
		const source = snapshot.equipmentGroup;
		if (source.kind !== "EQ") return fail("간격을 편집할 EQ Port를 선택하세요");
		const targetPorts = eqPitchPortTargets(
			source,
			snapshot.ports,
			selection.portId,
			pitchMillimeters,
		);
		const rows: number[] = [];
		const problems: string[] = [];
		for (const [index, port] of targetPorts.entries()) {
			const original = snapshot.ports[index] as PortRecord;
			if (slotIndex.rowForPort(original) === null)
				problems.push(`PORT-${port.id}의 기존 슬롯이 정확하지 않습니다`);
			const row = slotIndex.rowForPort(port);
			if (row === null) {
				problems.push(
					`PORT-${port.id}가 놓일 직선 슬롯이 없습니다 · 간격을 줄이거나 레일을 확장하세요`,
				);
				continue;
			}
			rows.push(row);
			if (slots.statuses[row] !== PORT_SLOT_STATUS.LEGAL)
				problems.push(`PORT-${port.id}가 놓일 슬롯이 안전하지 않습니다`);
			const occupied = availability.statusForEquipmentGroup(slots, row, source.id);
			if (occupied.status !== PORT_SLOT_STATUS.LEGAL)
				problems.push(
					`PORT-${port.id}의 대상 슬롯이 다른 장비와 겹칩니다 · 간격이나 주변 배치를 확인하세요`,
				);
		}
		editMetadata = metadata(source.id, rows, source.portIds, [], []);
		if (problems.length > 0) return fail(problems[0] as string);
		if (source.pitchMillimeters === pitchMillimeters)
			return fail("현재 간격과 같습니다 · 다른 간격을 선택하세요");
		const target = { ...source, pitchMillimeters };
		const minimum = defaultEqBodyDimensions(target).lengthMillimeters;
		if (target.bodyDimensions && target.bodyDimensions.lengthMillimeters < minimum)
			return fail(
				`지정한 몸체 길이 ${target.bodyDimensions.lengthMillimeters / 1_000} m가 부족합니다 · ${source.portIds.length} Port에는 최소 ${minimum / 1_000} m가 필요합니다`,
			);
		const portChanges = targetPorts.flatMap((port, index) =>
			portRecordEquals(snapshot.ports[index], port)
				? []
				: [{ id: port.id, before: snapshot.ports[index] as PortRecord, after: port }],
		);
		const groupChanges = [{ id: source.id, before: source, after: target }];
		const prospective = applyPortEquipmentMutations(state, portChanges, groupChanges);
		const transition = resolveEqPitchEditTransition(
			organizations,
			state,
			prospective,
			portChanges,
			groupChanges,
		);
		if (!transition || transition.reason)
			return fail(transition?.reason ?? "간격 변경을 확인할 수 없습니다");
		assertPortEquipmentLayout(map, prospective);
		return Object.freeze({
			...createPortEquipmentMutationPlan(
				"edit-port-equipment",
				baseRevision,
				basePatchSequence,
				portChanges,
				groupChanges,
			),
			reason: `PORT-${selection.portId} 고정 · ${source.portIds.length} Port · ${source.pitchMillimeters / 1_000} → ${pitchMillimeters / 1_000} m`,
			membershipEdit: editMetadata,
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : "EQ 간격을 변경할 수 없습니다";
		return fail(reason.replace(/^Port equipment layout is invalid:\s*/, "") || reason);
	}
}

/**
 * Read-only draft admission through the exact final planner, including body and Loop constraints.
 * This runs prospective validation; callers should memoize stable draft/source inputs, not run it
 * on every paint. It neither reserves authored IDs nor returns a plan to commit. Apply must replan
 * against the live source, including its organizations, even after a successful review.
 */
export function reviewPortEquipmentMembershipEdit(
	...args: Parameters<typeof planPortEquipmentMembershipEdit>
): PortEquipmentMembershipEditReview {
	const { valid, reason } = planPortEquipmentMembershipEdit(...args);
	return Object.freeze({ valid, reason });
}

/**
 * Replace one EQ/STK group's station membership as one reciprocal, revision-bound mutation.
 * Existing station members keep their IDs and barcodes; only genuinely new stations allocate IDs.
 */
export function planPortEquipmentMembershipEdit(
	map: TileMap,
	slots: CompiledPortSlots,
	slotIndex: PortEquipmentGroupSlotIndex,
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	sourceEquipmentGroupId: number,
	targetRows: readonly number[],
	baseRevision: number,
	basePatchSequence: number,
	organizations?: StaticFabOrganizationState,
): PortEquipmentMembershipEditPlan {
	const emptyMetadata = metadata(sourceEquipmentGroupId, targetRows, [], [], []);
	if (
		map.getRevision() !== baseRevision ||
		slots.revision !== baseRevision ||
		slotIndex.revision !== baseRevision ||
		availability.revision !== baseRevision ||
		!slotIndex.matches(slots) ||
		!availability.matchesState(state)
	) {
		return invalid(
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			"Port membership data is stale for the current rail revision.",
		);
	}
	if (
		slots.portType !== slotIndex.portType ||
		slots.portType !== availability.portType ||
		(slots.portType !== "EQ" && slots.portType !== "STK")
	) {
		return invalid(
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			"Port membership editing requires matching EQ or STK slot catalogs.",
		);
	}

	let snapshot: ReturnType<typeof capturePortEquipmentGroupEditSnapshot>;
	try {
		snapshot = capturePortEquipmentGroupEditSnapshot(state, sourceEquipmentGroupId);
	} catch (error) {
		return invalid(
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			error instanceof Error ? error.message : "Equipment group cannot be captured.",
		);
	}
	if (snapshot.equipmentGroup.kind !== slots.portType) {
		return invalid(
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			`${snapshot.equipmentGroup.kind} membership requires ${snapshot.equipmentGroup.kind} slots.`,
		);
	}
	const equipmentKind = snapshot.equipmentGroup.kind;

	const uniqueTargetRows = new Set<number>();
	for (const row of targetRows) {
		if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
			return invalid(
				baseRevision,
				basePatchSequence,
				emptyMetadata,
				`Target slot row ${row} is outside the compiled slot buffer.`,
			);
		}
		if (uniqueTargetRows.has(row)) {
			return invalid(
				baseRevision,
				basePatchSequence,
				emptyMetadata,
				`Target slot row ${row} is repeated.`,
			);
		}
		uniqueTargetRows.add(row);
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
			return invalid(
				baseRevision,
				basePatchSequence,
				emptyMetadata,
				`Target slot row ${row} is not a statically legal ${slots.portType} station.`,
			);
		}
		const availabilityResult = availability.statusForEquipmentGroup(
			slots,
			row,
			sourceEquipmentGroupId,
		);
		if (availabilityResult.status !== PORT_SLOT_STATUS.LEGAL) {
			const conflict =
				availabilityResult.conflictingPortId !== 0
					? `PORT-${availabilityResult.conflictingPortId}`
					: availabilityResult.conflictingEquipmentGroupId !== 0
						? `equipment group ${availabilityResult.conflictingEquipmentGroupId}`
						: "the static clearance envelope";
			return invalid(
				baseRevision,
				basePatchSequence,
				emptyMetadata,
				`Target slot row ${row} conflicts with ${conflict}.`,
			);
		}
	}
	if (slots.portType === "STK") {
		const conflictingGroupId = availability.conflictingEquipmentGroupForStkRows(
			slots,
			targetRows,
			sourceEquipmentGroupId,
		);
		if (conflictingGroupId !== 0) {
			return invalid(
				baseRevision,
				basePatchSequence,
				emptyMetadata,
				`STK body span overlaps equipment group ${conflictingGroupId}.`,
			);
		}
	}

	const existingPortByRow = new Map<number, PortRecord>();
	for (const port of snapshot.ports) {
		const row = slotIndex.rowForPort(port);
		if (row === null) {
			return invalid(
				baseRevision,
				basePatchSequence,
				emptyMetadata,
				`PORT-${port.id} no longer has an exact modular slot.`,
			);
		}
		if (existingPortByRow.has(row)) {
			return invalid(
				baseRevision,
				basePatchSequence,
				emptyMetadata,
				`Equipment group ${sourceEquipmentGroupId} owns duplicate station rows.`,
			);
		}
		existingPortByRow.set(row, port);
	}

	let canonicalTargetRows: readonly number[];
	try {
		const pseudoPorts = targetRows.map((row) =>
			Object.freeze({
				...portSlotRecord(slots, row, row + 1, sourceEquipmentGroupId, null),
				direction: snapshot.ports[0]?.direction ?? "WITH_TRAVEL",
			}),
		);
		canonicalTargetRows = canonicalEquipmentGroupPortIds(
			snapshot.equipmentGroup,
			pseudoPorts.map((port) => port.id),
			pseudoPorts,
		).map((portId) => portId - 1);
	} catch (error) {
		return invalid(
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			error instanceof Error ? error.message : "Equipment membership is not structurally valid.",
		);
	}

	const retainedPorts: PortRecord[] = [];
	const addedRows: number[] = [];
	for (const row of canonicalTargetRows) {
		const retained = existingPortByRow.get(row);
		if (retained) retainedPorts.push(retained);
		else addedRows.push(row);
	}
	const targetRowSet = new Set(canonicalTargetRows);
	const removedPorts = snapshot.ports.filter((port) => {
		const row = slotIndex.rowForPort(port);
		return row === null || !targetRowSet.has(row);
	});

	let addedPortIds: readonly number[];
	try {
		addedPortIds = allocatePortEquipmentRecordIds(state, addedRows.length, 0).portIds;
	} catch (error) {
		return invalid(
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			error instanceof Error ? error.message : "Port IDs cannot be allocated.",
		);
	}
	const equipmentFacingDirection = snapshot.ports[0]?.direction ?? "WITH_TRAVEL";
	const addedPorts = addedRows.map((row, index) => {
		const portId = addedPortIds[index] as number;
		return Object.freeze({
			...portSlotRecord(
				slots,
				row,
				portId,
				sourceEquipmentGroupId,
				`${equipmentKind}-${sourceEquipmentGroupId}-PORT-${portId}`,
			),
			direction: equipmentFacingDirection,
		});
	});
	const targetPorts = [...retainedPorts, ...addedPorts];

	let targetGroup: EquipmentGroupRecord;
	try {
		const canonicalIds = canonicalEquipmentGroupPortIds(
			snapshot.equipmentGroup,
			targetPorts.map((port) => port.id),
			targetPorts,
		);
		targetGroup = copyEquipmentGroupWithPortIds(
			snapshot.equipmentGroup,
			sourceEquipmentGroupId,
			canonicalIds,
		);
	} catch (error) {
		return invalid(
			baseRevision,
			basePatchSequence,
			metadata(
				sourceEquipmentGroupId,
				canonicalTargetRows,
				retainedPorts.map((port) => port.id),
				addedPorts.map((port) => port.id),
				removedPorts.map((port) => port.id),
			),
			error instanceof Error ? error.message : "Equipment membership is not structurally valid.",
		);
	}

	const targetGroupError = equipmentGroupError(targetGroup);
	if (targetGroupError) {
		const minimumLength =
			targetGroup.kind === "EQ" ? defaultEqBodyDimensions(targetGroup).lengthMillimeters : null;
		const reason =
			targetGroup.kind === "EQ" &&
			targetGroup.bodyDimensions &&
			minimumLength !== null &&
			targetGroup.bodyDimensions.lengthMillimeters < minimumLength
				? `${targetGroupError} · 현재 몸체 ${targetGroup.bodyDimensions.lengthMillimeters} mm / ${targetGroup.portIds.length} Port 최소 ${minimumLength} mm · 몸체 크기를 먼저 변경하거나 Port 수를 줄이세요`
				: targetGroupError;
		return invalid(baseRevision, basePatchSequence, emptyMetadata, reason);
	}

	if (organizations) {
		const ownershipError = portEquipmentLoopEditTargetError(
			organizations,
			snapshot.equipmentGroup,
			snapshot.ports,
			targetGroup,
			targetPorts,
		);
		if (ownershipError)
			return invalid(baseRevision, basePatchSequence, emptyMetadata, ownershipError);
	}
	const portMutations: PortMutation[] = [
		...removedPorts.map((before) => Object.freeze({ id: before.id, before, after: null })),
		...addedPorts.map((after) => Object.freeze({ id: after.id, before: null, after })),
	].sort((left, right) => left.id - right.id);
	const equipmentGroupMutations = equipmentGroupEquals(snapshot.equipmentGroup, targetGroup)
		? []
		: [
				Object.freeze({
					id: sourceEquipmentGroupId,
					before: snapshot.equipmentGroup,
					after: targetGroup,
				}),
			];
	const editMetadata = metadata(
		sourceEquipmentGroupId,
		canonicalTargetRows,
		retainedPorts.map((port) => port.id),
		addedPorts.map((port) => port.id),
		removedPorts.map((port) => port.id),
	);
	if (portMutations.length === 0 && equipmentGroupMutations.length === 0) {
		return invalid(
			baseRevision,
			basePatchSequence,
			editMetadata,
			"Choose a different legal port membership for this equipment group.",
		);
	}
	try {
		const prospective = applyPortEquipmentMutations(state, portMutations, equipmentGroupMutations);
		assertPortEquipmentLayout(map, prospective);
	} catch (error) {
		return invalid(
			baseRevision,
			basePatchSequence,
			editMetadata,
			error instanceof Error ? error.message : "Prospective equipment membership is invalid.",
		);
	}

	const base = createPortEquipmentMutationPlan(
		"edit-port-equipment",
		baseRevision,
		basePatchSequence,
		portMutations,
		equipmentGroupMutations,
	);
	return Object.freeze({
		...base,
		reason: `${slots.portType} group membership is valid for ${targetPorts.length} ports.`,
		membershipEdit: editMetadata,
	});
}

function metadata(
	sourceEquipmentGroupId: number,
	targetRows: readonly number[],
	retainedPortIds: readonly number[],
	addedPortIds: readonly number[],
	removedPortIds: readonly number[],
): PortEquipmentMembershipEditMetadata {
	return Object.freeze({
		sourceEquipmentGroupId,
		targetRows: Object.freeze([...targetRows]),
		retainedPortIds: Object.freeze([...retainedPortIds]),
		addedPortIds: Object.freeze([...addedPortIds]),
		removedPortIds: Object.freeze([...removedPortIds]),
	});
}

function invalid(
	baseRevision: number,
	basePatchSequence: number,
	membershipEdit: PortEquipmentMembershipEditMetadata,
	reason: string,
): PortEquipmentMembershipEditPlan {
	return Object.freeze({
		...createInvalidPortEquipmentMutationPlan(
			"edit-port-equipment",
			baseRevision,
			basePatchSequence,
			reason,
		),
		membershipEdit,
	});
}
