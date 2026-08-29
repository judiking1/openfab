import type { Cell } from "../core/TileMap";

export interface OpenTerminalSnap {
	readonly cell: Cell;
	readonly distanceMeters: number;
}

export function shouldPreserveInitialOpenTerminalSnap(input: {
	readonly requiresOpenTerminal: boolean;
	readonly planCreated: boolean;
	readonly start: Cell;
	readonly current: Cell;
}): boolean {
	return (
		input.requiresOpenTerminal &&
		!input.planCreated &&
		input.current.x === input.start.x &&
		input.current.y === input.start.y
	);
}

export function resolveNearestOpenTerminal(
	openTerminalCells: Int32Array,
	pointerWorld: Readonly<{ x: number; y: number }>,
	maximumDistanceMeters: number,
	isCompatible: (cell: Cell) => boolean,
): OpenTerminalSnap | null {
	if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters <= 0) return null;
	let nearest: OpenTerminalSnap | null = null;
	for (let index = 0; index + 1 < openTerminalCells.length; index += 2) {
		const cell = Object.freeze({
			x: openTerminalCells[index] as number,
			y: openTerminalCells[index + 1] as number,
		});
		if (!isCompatible(cell)) continue;
		const distanceMeters = Math.hypot(cell.x + 0.5 - pointerWorld.x, cell.y + 0.5 - pointerWorld.y);
		if (distanceMeters > maximumDistanceMeters) continue;
		if (
			!nearest ||
			distanceMeters < nearest.distanceMeters ||
			(distanceMeters === nearest.distanceMeters &&
				(cell.y < nearest.cell.y || (cell.y === nearest.cell.y && cell.x < nearest.cell.x)))
		) {
			nearest = Object.freeze({ cell, distanceMeters });
		}
	}
	return nearest;
}
