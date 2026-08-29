import type { RailConstructionPlan } from "./paint";
import type { Cell } from "./TileMap";

export interface RailConstructionMetric {
	readonly start: Cell;
	readonly end: Cell;
	readonly lengthMeters: number;
	readonly turns: number;
	readonly deltaXMeters: number;
	readonly deltaZMeters: number;
	readonly footprintWidthMeters: number;
	readonly footprintDepthMeters: number;
	readonly primaryLabel: string;
	readonly geometryLabel: string;
}

/** Pure, renderer-independent metric readout for one authored construction draft. */
export function deriveRailConstructionMetric(
	plan: Pick<RailConstructionPlan, "cells" | "lengthMeters" | "turns">,
): RailConstructionMetric | null {
	const start = plan.cells[0];
	const end = plan.cells.at(-1);
	if (!start || !end) return null;
	let minX = start.x;
	let maxX = start.x;
	let minZ = start.y;
	let maxZ = start.y;
	for (const cell of plan.cells) {
		minX = Math.min(minX, cell.x);
		maxX = Math.max(maxX, cell.x);
		minZ = Math.min(minZ, cell.y);
		maxZ = Math.max(maxZ, cell.y);
	}
	const deltaXMeters = end.x - start.x;
	const deltaZMeters = end.y - start.y;
	const footprintWidthMeters = maxX - minX + 1;
	const footprintDepthMeters = maxZ - minZ + 1;
	return Object.freeze({
		start: freezeCell(start),
		end: freezeCell(end),
		lengthMeters: plan.lengthMeters,
		turns: plan.turns,
		deltaXMeters,
		deltaZMeters,
		footprintWidthMeters,
		footprintDepthMeters,
		primaryLabel: `${plan.lengthMeters} m · ${plan.turns} ${plan.turns === 1 ? "CURVE" : "CURVES"}`,
		geometryLabel: `ΔX ${signed(deltaXMeters)} · ΔZ ${signed(deltaZMeters)} · ${footprintWidthMeters}×${footprintDepthMeters} m`,
	});
}

function signed(value: number): string {
	return value > 0 ? `+${value}` : String(value);
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
