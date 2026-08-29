import {
	applyPortEquipmentMutations,
	type EquipmentGroupRecord,
	equipmentGroupEquals,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import {
	canonicalEquipmentGroupPortIds,
	copyEquipmentGroupWithPortIds,
} from "../core/EquipmentGroupPortOrder";
import { allocatePortEquipmentRecordIds } from "../core/PortEquipmentIdAllocator";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import {
	createInvalidPortEquipmentMutationPlan,
	createPortEquipmentMutationPlan,
	type PortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import type { PortMutation, PortRecord } from "../core/PortRecord";
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
