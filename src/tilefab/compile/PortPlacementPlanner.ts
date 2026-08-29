import {
	EQ_MAXIMUM_PORT_COUNT,
	equipmentGroupError,
	type PortEquipmentState,
	STK_AUTHORING_TEMPLATES,
	type StkAuthoringTemplate,
} from "../core/EquipmentGroup";
import {
	createInvalidPortEquipmentMutationPlan,
	createPortEquipmentMutationPlan,
	type PortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import { allocatePortEquipmentRecordIds } from "../core/PortEquipmentIdAllocator";
import { PORT_SIDES } from "../core/PortRecord";
import { type Direction, moveCell } from "../core/railShape";
import { analyzeStkPortLayout } from "../core/StkPortLayout";
import { isEqPitch } from "./EqRowDraftSelector";
import {
	type CompiledPortSlots,
	OPENFAB_PORT_SLOT_POLICIES,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
	portSlotRecord,
} from "./PortSlotCompiler";
import type { StkDraftSlotQuery } from "./StkDraftSelector";

/** One click creates one rail-attached port and one independent OHB equipment group. */
export function planOhbPlacement(
	slots: CompiledPortSlots,
	row: number,
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	baseRevision: number,
	basePatchSequence: number,
): PortEquipmentMutationPlan {
	return planOhbRowPlacement(slots, [row], availability, state, baseRevision, basePatchSequence);
}

/** A drag row repeats independent one-port OHBs; it never merges them into an EQ-style group. */
export function planOhbRowPlacement(
	slots: CompiledPortSlots,
	rows: readonly number[],
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	baseRevision: number,
	basePatchSequence: number,
): PortEquipmentMutationPlan {
	if (slots.portType !== "OHB") {
		return invalid(baseRevision, basePatchSequence, "OHB placement requires OHB slot buffers.");
	}
	if (slots.revision !== baseRevision) {
		return invalid(
			baseRevision,
			basePatchSequence,
			"Port slots are stale for the current rail revision.",
		);
	}
	if (availability.revision !== baseRevision || availability.portType !== "OHB") {
		return invalid(
			baseRevision,
			basePatchSequence,
			"OHB slot availability is stale for the current static world.",
		);
	}
	if (rows.length === 0) {
		return invalid(baseRevision, basePatchSequence, "Choose at least one legal OHB slot.");
	}
	const uniqueRows = new Set<number>();
	for (const row of rows) {
		if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
			return invalid(
				baseRevision,
				basePatchSequence,
				`OHB slot row ${row} is outside the compiled slot buffer.`,
			);
		}
		if (uniqueRows.has(row)) {
			return invalid(baseRevision, basePatchSequence, `OHB slot row ${row} is repeated.`);
		}
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
			return invalid(baseRevision, basePatchSequence, `OHB slot row ${row} is not legal.`);
		}
		if (availability.statusFor(slots, row).status !== PORT_SLOT_STATUS.LEGAL) {
			return invalid(
				baseRevision,
				basePatchSequence,
				`OHB slot row ${row} is not currently available.`,
			);
		}
		uniqueRows.add(row);
	}
	const spacingConflict = firstBatchSpacingConflict(slots, rows);
	if (spacingConflict) {
		return invalid(
			baseRevision,
			basePatchSequence,
			`OHB slot rows ${spacingConflict[0]} and ${spacingConflict[1]} conflict inside this batch.`,
		);
	}

	const portMutations = [];
	const equipmentGroupMutations = [];
	let allocation: ReturnType<typeof allocatePortEquipmentRecordIds>;
	try {
		allocation = allocatePortEquipmentRecordIds(state, rows.length, rows.length);
	} catch (error) {
		return invalid(
			baseRevision,
			basePatchSequence,
			error instanceof Error ? error.message : "OHB record IDs cannot be allocated.",
		);
	}
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index] as number;
		const portId = allocation.portIds[index] as number;
		const equipmentGroupId = allocation.equipmentGroupIds[index] as number;
		const port = portSlotRecord(slots, row, portId, equipmentGroupId, `OHB-${portId}`);
		const group = {
			id: equipmentGroupId,
			kind: "OHB" as const,
			template: "SINGLE" as const,
			portIds: [portId],
		};
		portMutations.push({ id: portId, before: null, after: port });
		equipmentGroupMutations.push({ id: equipmentGroupId, before: null, after: group });
	}
	return createPortEquipmentMutationPlan(
		"place-ohb",
		baseRevision,
		basePatchSequence,
		portMutations,
		equipmentGroupMutations,
	);
}

/** One contiguous cardinal row creates multiple ports owned by one EQ group. */
export function planEqRowPlacement(
	slots: CompiledPortSlots,
	rows: readonly number[],
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	pitchMillimeters: number,
	recipe: string | null,
	baseRevision: number,
	basePatchSequence: number,
	continuityRows: readonly number[] = rows,
): PortEquipmentMutationPlan {
	if (slots.portType !== "EQ") {
		return invalidEq(baseRevision, basePatchSequence, "EQ placement requires EQ slot buffers.");
	}
	if (slots.revision !== baseRevision) {
		return invalidEq(
			baseRevision,
			basePatchSequence,
			"Port slots are stale for the current rail revision.",
		);
	}
	if (availability.revision !== baseRevision || availability.portType !== "EQ") {
		return invalidEq(
			baseRevision,
			basePatchSequence,
			"EQ slot availability is stale for the current static world.",
		);
	}
	if (!isEqPitch(pitchMillimeters)) {
		return invalidEq(baseRevision, basePatchSequence, "EQ pitch must be 1 to 5 whole meters.");
	}
	if (rows.length < 2) {
		return invalidEq(baseRevision, basePatchSequence, "Choose at least two legal EQ slots.");
	}
	if (rows.length > EQ_MAXIMUM_PORT_COUNT) {
		return invalidEq(
			baseRevision,
			basePatchSequence,
			`EQ placement cannot exceed ${EQ_MAXIMUM_PORT_COUNT} ports.`,
		);
	}
	const uniqueRows = new Set<number>();
	for (const row of rows) {
		if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
			return invalidEq(
				baseRevision,
				basePatchSequence,
				`EQ slot row ${row} is outside the compiled slot buffer.`,
			);
		}
		if (uniqueRows.has(row)) {
			return invalidEq(baseRevision, basePatchSequence, `EQ slot row ${row} is repeated.`);
		}
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
			return invalidEq(baseRevision, basePatchSequence, `EQ slot row ${row} is not legal.`);
		}
		if (availability.statusFor(slots, row).status !== PORT_SLOT_STATUS.LEGAL) {
			return invalidEq(
				baseRevision,
				basePatchSequence,
				`EQ slot row ${row} is not currently available.`,
			);
		}
		if (PORT_SIDES[slots.sides[row] as number] !== "CENTER") {
			return invalidEq(baseRevision, basePatchSequence, "EQ ports must use CENTER rail slots.");
		}
		if ((slots.lateralOffsetMillimeters[row] as number) !== 0) {
			return invalidEq(baseRevision, basePatchSequence, "EQ CENTER slots must use zero offset.");
		}
		uniqueRows.add(row);
	}

	const firstRow = rows[0] as number;
	const from = slots.routeFromDirections[firstRow] as number;
	const to = slots.routeToDirections[firstRow] as Direction;
	const travel = moveCell({ x: 0, y: 0 }, to);
	const orderedRows = [...rows].sort((left, right) => {
		const leftProjection =
			(slots.routeXs[left] as number) * travel.x + (slots.routeZs[left] as number) * travel.y;
		const rightProjection =
			(slots.routeXs[right] as number) * travel.x + (slots.routeZs[right] as number) * travel.y;
		return leftProjection - rightProjection || left - right;
	});
	const pitchCells = pitchMillimeters / 1_000;
	const laneRows = new Map<string, number>();
	for (const row of continuityRows) {
		if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
			return invalidEq(
				baseRevision,
				basePatchSequence,
				"EQ continuity proof is outside the slot buffer.",
			);
		}
		if (
			(slots.routeFromDirections[row] as number) !== from ||
			(slots.routeToDirections[row] as number) !== to ||
			PORT_SIDES[slots.sides[row] as number] !== "CENTER" ||
			(slots.lateralOffsetMillimeters[row] as number) !== 0
		) {
			return invalidEq(
				baseRevision,
				basePatchSequence,
				"EQ continuity proof must stay on one zero-offset CENTER lane.",
			);
		}
		const key = `${slots.routeXs[row] as number}:${slots.routeZs[row] as number}`;
		if (laneRows.has(key)) {
			return invalidEq(baseRevision, basePatchSequence, "EQ lane contains duplicate slot cells.");
		}
		laneRows.set(key, row);
	}
	if (laneRows.size === 0) {
		return invalidEq(baseRevision, basePatchSequence, "EQ continuity proof is empty.");
	}
	for (let index = 0; index < orderedRows.length; index++) {
		const row = orderedRows[index] as number;
		if (
			(slots.routeFromDirections[row] as number) !== from ||
			(slots.routeToDirections[row] as number) !== to
		) {
			return invalidEq(
				baseRevision,
				basePatchSequence,
				"EQ ports must share one directed cardinal rail row.",
			);
		}
		if (index === 0) continue;
		const previous = orderedRows[index - 1] as number;
		const deltaX = (slots.routeXs[row] as number) - (slots.routeXs[previous] as number);
		const deltaZ = (slots.routeZs[row] as number) - (slots.routeZs[previous] as number);
		const longitudinal = deltaX * travel.x + deltaZ * travel.y;
		const lateral = deltaX * -travel.y + deltaZ * travel.x;
		if (longitudinal !== pitchCells || lateral !== 0) {
			return invalidEq(
				baseRevision,
				basePatchSequence,
				"EQ ports must be contiguous at the configured pitch.",
			);
		}
		for (let step = 1; step < pitchCells; step++) {
			const x = (slots.routeXs[previous] as number) + travel.x * step;
			const z = (slots.routeZs[previous] as number) + travel.y * step;
			const intermediateRow = laneRows.get(`${x}:${z}`);
			if (
				intermediateRow === undefined ||
				(slots.statuses[intermediateRow] as number) !== PORT_SLOT_STATUS.LEGAL
			) {
				return invalidEq(
					baseRevision,
					basePatchSequence,
					"EQ pitch cannot cross a gap, curve, junction, endpoint, or unsafe rail cell.",
				);
			}
		}
	}
	const firstOrderedRow = orderedRows[0] as number;
	const lastOrderedRow = orderedRows.at(-1) as number;
	const expectedContinuityCount =
		((slots.routeXs[lastOrderedRow] as number) - (slots.routeXs[firstOrderedRow] as number)) *
			travel.x +
		((slots.routeZs[lastOrderedRow] as number) - (slots.routeZs[firstOrderedRow] as number)) *
			travel.y +
		1;
	if (laneRows.size !== expectedContinuityCount) {
		return invalidEq(
			baseRevision,
			basePatchSequence,
			"EQ continuity proof must include every 1 m rail cell between its ports.",
		);
	}
	const spacingConflict = firstBatchSpacingConflict(slots, orderedRows);
	if (spacingConflict) {
		return invalidEq(
			baseRevision,
			basePatchSequence,
			`EQ slot rows ${spacingConflict[0]} and ${spacingConflict[1]} conflict inside this batch.`,
		);
	}

	let allocation: ReturnType<typeof allocatePortEquipmentRecordIds>;
	try {
		allocation = allocatePortEquipmentRecordIds(state, orderedRows.length, 1);
	} catch (error) {
		return invalidEq(
			baseRevision,
			basePatchSequence,
			error instanceof Error ? error.message : "EQ record IDs cannot be allocated.",
		);
	}
	const equipmentGroupId = allocation.equipmentGroupIds[0] as number;
	const portIds = allocation.portIds;
	const group = {
		id: equipmentGroupId,
		kind: "EQ" as const,
		portIds,
		pitchMillimeters,
		recipe,
	};
	const groupError = equipmentGroupError(group);
	if (groupError) return invalidEq(baseRevision, basePatchSequence, groupError);
	const portMutations = orderedRows.map((row, index) => {
		const portId = portIds[index] as number;
		return {
			id: portId,
			before: null,
			after: portSlotRecord(
				slots,
				row,
				portId,
				equipmentGroupId,
				`EQ-${equipmentGroupId}-P${String(index + 1).padStart(2, "0")}`,
			),
		};
	});
	const equipmentGroupMutations = [{ id: equipmentGroupId, before: null, after: group }];
	return createPortEquipmentMutationPlan(
		"place-eq",
		baseRevision,
		basePatchSequence,
		portMutations,
		equipmentGroupMutations,
	);
}

/** Repeated clicks become one deterministically ordered stocker group on explicit Complete. */
export function planStkPlacement(
	slots: CompiledPortSlots,
	rows: readonly number[],
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	template: StkAuthoringTemplate,
	baseRevision: number,
	basePatchSequence: number,
	_slotQuery?: StkDraftSlotQuery | null,
): PortEquipmentMutationPlan {
	void _slotQuery;
	if (!STK_AUTHORING_TEMPLATES.includes(template)) {
		return invalidStk(
			baseRevision,
			basePatchSequence,
			"CUSTOM STK is legacy load-only data and cannot be newly authored.",
		);
	}
	if (slots.portType !== "STK") {
		return invalidStk(baseRevision, basePatchSequence, "STK placement requires STK slot buffers.");
	}
	if (slots.revision !== baseRevision) {
		return invalidStk(
			baseRevision,
			basePatchSequence,
			"Port slots are stale for the current rail revision.",
		);
	}
	if (availability.revision !== baseRevision || availability.portType !== "STK") {
		return invalidStk(
			baseRevision,
			basePatchSequence,
			"STK slot availability is stale for the current static world.",
		);
	}
	if (rows.length === 0) {
		return invalidStk(
			baseRevision,
			basePatchSequence,
			"Choose STK ports before completing the group.",
		);
	}
	const uniqueRows = new Set<number>();
	for (const row of rows) {
		if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
			return invalidStk(
				baseRevision,
				basePatchSequence,
				`STK slot row ${row} is outside the compiled slot buffer.`,
			);
		}
		if (uniqueRows.has(row)) {
			return invalidStk(baseRevision, basePatchSequence, `STK slot row ${row} is repeated.`);
		}
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
			return invalidStk(baseRevision, basePatchSequence, `STK slot row ${row} is not legal.`);
		}
		if (availability.statusFor(slots, row).status !== PORT_SLOT_STATUS.LEGAL) {
			return invalidStk(
				baseRevision,
				basePatchSequence,
				`STK slot row ${row} is not currently available.`,
			);
		}
		uniqueRows.add(row);
	}
	const conflictingEquipmentGroupId = availability.conflictingEquipmentGroupForStkRows(slots, rows);
	if (conflictingEquipmentGroupId !== 0) {
		return invalidStk(
			baseRevision,
			basePatchSequence,
			`STK body span overlaps equipment group ${conflictingEquipmentGroupId}.`,
		);
	}

	const analysis = analyzeStkPortLayout(
		rows.map((row) => ({
			id: row,
			x: slots.routeXs[row] as number,
			z: slots.routeZs[row] as number,
			from: slots.routeFromDirections[row] as Direction,
			to: slots.routeToDirections[row] as Direction,
			side: PORT_SIDES[slots.sides[row] as number] as "CENTER" | "LEFT" | "RIGHT",
			lateralOffsetMillimeters: slots.lateralOffsetMillimeters[row] as number,
			direction: "WITH_TRAVEL" as const,
		})),
		template,
	);
	if (!analysis.valid) return invalidStk(baseRevision, basePatchSequence, analysis.reason);
	const orderedRows = analysis.orderedIds;
	const spacingConflict = firstBatchSpacingConflict(slots, orderedRows);
	if (spacingConflict) {
		return invalidStk(
			baseRevision,
			basePatchSequence,
			`STK slot rows ${spacingConflict[0]} and ${spacingConflict[1]} conflict inside this batch.`,
		);
	}

	let allocation: ReturnType<typeof allocatePortEquipmentRecordIds>;
	try {
		allocation = allocatePortEquipmentRecordIds(state, orderedRows.length, 1);
	} catch (error) {
		return invalidStk(
			baseRevision,
			basePatchSequence,
			error instanceof Error ? error.message : "STK record IDs cannot be allocated.",
		);
	}
	const equipmentGroupId = allocation.equipmentGroupIds[0] as number;
	const portIds = allocation.portIds;
	const group = {
		id: equipmentGroupId,
		kind: "STK" as const,
		template,
		portIds,
	};
	const groupError = equipmentGroupError(group);
	if (groupError) return invalidStk(baseRevision, basePatchSequence, groupError);
	const portMutations = orderedRows.map((row, index) => {
		const portId = portIds[index] as number;
		return {
			id: portId,
			before: null,
			after: portSlotRecord(
				slots,
				row,
				portId,
				equipmentGroupId,
				`STK-${equipmentGroupId}-P${String(index + 1).padStart(2, "0")}`,
			),
		};
	});
	const equipmentGroupMutations = [{ id: equipmentGroupId, before: null, after: group }];
	return createPortEquipmentMutationPlan(
		"place-stk",
		baseRevision,
		basePatchSequence,
		portMutations,
		equipmentGroupMutations,
	);
}

function firstBatchSpacingConflict(
	slots: CompiledPortSlots,
	rows: readonly number[],
): readonly [number, number] | null {
	const spacingMeters =
		OPENFAB_PORT_SLOT_POLICIES[slots.portType].minimumPortSpacingMillimeters / 1_000;
	const buckets = new Map<string, number[]>();
	for (const row of rows) {
		const worldX = slots.worldPositions[row * 2] as number;
		const worldZ = slots.worldPositions[row * 2 + 1] as number;
		const bucketX = Math.floor(worldX / spacingMeters);
		const bucketZ = Math.floor(worldZ / spacingMeters);
		for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
			for (let deltaX = -1; deltaX <= 1; deltaX++) {
				const candidates = buckets.get(`${bucketX + deltaX}:${bucketZ + deltaZ}`);
				if (!candidates) continue;
				for (const candidate of candidates) {
					const distance = Math.hypot(
						worldX - (slots.worldPositions[candidate * 2] as number),
						worldZ - (slots.worldPositions[candidate * 2 + 1] as number),
					);
					if (distance < spacingMeters - 1e-6) return [candidate, row];
				}
			}
		}
		const key = `${bucketX}:${bucketZ}`;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(row);
		else buckets.set(key, [row]);
	}
	return null;
}

function invalid(
	baseRevision: number,
	basePatchSequence: number,
	reason: string,
): PortEquipmentMutationPlan {
	return createInvalidPortEquipmentMutationPlan(
		"place-ohb",
		baseRevision,
		basePatchSequence,
		reason,
	);
}

function invalidEq(
	baseRevision: number,
	basePatchSequence: number,
	reason: string,
): PortEquipmentMutationPlan {
	return createInvalidPortEquipmentMutationPlan(
		"place-eq",
		baseRevision,
		basePatchSequence,
		reason,
	);
}

function invalidStk(
	baseRevision: number,
	basePatchSequence: number,
	reason: string,
): PortEquipmentMutationPlan {
	return createInvalidPortEquipmentMutationPlan(
		"place-stk",
		baseRevision,
		basePatchSequence,
		reason,
	);
}
