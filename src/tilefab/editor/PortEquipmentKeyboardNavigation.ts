import type { CompiledPortSlots, PortSlotBounds } from "../compile/PortSlotCompiler";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";

export type PortEquipmentKeyboardNavigationScope = "same-directed-lane" | "nearby";

export const PORT_EQUIPMENT_KEYBOARD_SEARCH_RADII = Object.freeze([
	32, 64, 128, 256, 512, 1_024, 2_048, 4_096, 8_192,
]);

export interface PortEquipmentKeyboardNavigationRequest {
	readonly slots: CompiledPortSlots;
	readonly currentRow: number;
	readonly deltaX: number;
	readonly deltaZ: number;
	readonly candidateRows: readonly number[];
	readonly scope: PortEquipmentKeyboardNavigationScope;
}

export interface ProgressivePortEquipmentKeyboardNavigationRequest
	extends Omit<PortEquipmentKeyboardNavigationRequest, "candidateRows"> {
	readonly query: (bounds: PortSlotBounds, target: number[]) => readonly number[];
	readonly target: number[];
	readonly searchRadii?: readonly number[];
}

export interface ProgressivePortEquipmentKeyboardNavigationResult {
	readonly row: number | null;
	readonly searchRadius: number;
	readonly searchSteps: number;
	readonly candidateRows: number;
	readonly maximumCandidateRows: number;
}

/**
 * Choose one deterministic slot in the requested world-cardinal direction.
 *
 * Candidate discovery remains the caller's responsibility so a spatial index can keep keyboard
 * interaction local on factory-scale maps. EQ endpoint editing uses the stricter directed-lane
 * scope; FLEX STK navigation may cross to a nearby rail run before Space toggles that station.
 */
export function directionalPortEquipmentSlotRow(
	request: PortEquipmentKeyboardNavigationRequest,
): number | null {
	const { slots, currentRow, deltaX, deltaZ, candidateRows, scope } = request;
	if (
		!Number.isInteger(currentRow) ||
		currentRow < 0 ||
		currentRow >= slots.count ||
		!isCardinalDelta(deltaX, deltaZ)
	) {
		return null;
	}

	const currentX = slots.routeXs[currentRow] as number;
	const currentZ = slots.routeZs[currentRow] as number;
	let winner: number | null = null;
	let winnerScore = Number.POSITIVE_INFINITY;
	for (const row of candidateRows) {
		if (!Number.isInteger(row) || row < 0 || row >= slots.count || row === currentRow) continue;
		if (scope === "same-directed-lane" && !sameDirectedLane(slots, currentRow, row)) continue;
		const offsetX = (slots.routeXs[row] as number) - currentX;
		const offsetZ = (slots.routeZs[row] as number) - currentZ;
		const forwardDistance = offsetX * deltaX + offsetZ * deltaZ;
		if (forwardDistance <= 0) continue;
		const sideDistance = Math.abs(offsetX * deltaZ - offsetZ * deltaX);
		const score =
			sideDistance * 1_000_000 + forwardDistance * 1_000 + row / Math.max(1, slots.count);
		if (score < winnerScore) {
			winner = row;
			winnerScore = score;
		}
	}
	return winner;
}

/** Query progressively larger indexed windows up to one explicit maximum radius. */
export function progressiveDirectionalPortEquipmentSlotRow(
	request: ProgressivePortEquipmentKeyboardNavigationRequest,
): ProgressivePortEquipmentKeyboardNavigationResult {
	const {
		slots,
		currentRow,
		deltaX,
		deltaZ,
		scope,
		query,
		target,
		searchRadii = PORT_EQUIPMENT_KEYBOARD_SEARCH_RADII,
	} = request;
	if (
		!Number.isInteger(currentRow) ||
		currentRow < 0 ||
		currentRow >= slots.count ||
		!isCardinalDelta(deltaX, deltaZ)
	) {
		target.length = 0;
		return {
			row: null,
			searchRadius: 0,
			searchSteps: 0,
			candidateRows: 0,
			maximumCandidateRows: 0,
		};
	}
	const worldX = slots.worldPositions[currentRow * 2] as number;
	const worldZ = slots.worldPositions[currentRow * 2 + 1] as number;
	let searchRadius = 0;
	let searchSteps = 0;
	let candidateRows = 0;
	let maximumCandidateRows = 0;
	for (const radius of searchRadii) {
		if (!Number.isFinite(radius) || radius <= searchRadius) continue;
		searchRadius = radius;
		searchSteps++;
		const candidates = query(
			{
				minX: worldX - radius,
				minZ: worldZ - radius,
				maxX: worldX + radius,
				maxZ: worldZ + radius,
			},
			target,
		);
		candidateRows = candidates.length;
		maximumCandidateRows = Math.max(maximumCandidateRows, candidateRows);
		const row = directionalPortEquipmentSlotRow({
			slots,
			currentRow,
			deltaX,
			deltaZ,
			candidateRows: candidates,
			scope,
		});
		if (row !== null) {
			return {
				row,
				searchRadius,
				searchSteps,
				candidateRows,
				maximumCandidateRows,
			};
		}
	}
	return {
		row: null,
		searchRadius,
		searchSteps,
		candidateRows,
		maximumCandidateRows,
	};
}

function sameDirectedLane(
	slots: CompiledPortSlots,
	referenceRow: number,
	candidateRow: number,
): boolean {
	const referenceFrom = slots.routeFromDirections[referenceRow] as Direction;
	const referenceTo = slots.routeToDirections[referenceRow] as Direction;
	if (
		(slots.routeFromDirections[candidateRow] as Direction) !== referenceFrom ||
		(slots.routeToDirections[candidateRow] as Direction) !== referenceTo
	) {
		return false;
	}
	if (referenceTo === DIR_E || referenceTo === DIR_W) {
		return slots.routeZs[candidateRow] === slots.routeZs[referenceRow];
	}
	if (referenceTo === DIR_N || referenceTo === DIR_S) {
		return slots.routeXs[candidateRow] === slots.routeXs[referenceRow];
	}
	return false;
}

function isCardinalDelta(deltaX: number, deltaZ: number): boolean {
	return (
		Number.isInteger(deltaX) &&
		Number.isInteger(deltaZ) &&
		Math.abs(deltaX) + Math.abs(deltaZ) === 1
	);
}
