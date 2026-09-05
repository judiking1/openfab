import type { Cell } from "../core/TileMap";

export type RailConstructionContinuation =
	| Readonly<{ kind: "direct-route" }>
	| Readonly<{ kind: "module"; repeatFromExit: boolean; exit: Cell }>;

/**
 * Resolve the visible command loop after a successful rail construction.
 *
 * Direct Smart Route commits deliberately release their hidden anchor: the next drag begins where
 * the user presses. Compound modules may retain the planner-owned output contract.
 */
export function nextRailConstructionAnchor(
	continuation: RailConstructionContinuation,
	pointerEnd: Cell,
): Cell | null {
	if (continuation.kind === "direct-route") return null;
	return continuation.repeatFromExit ? continuation.exit : pointerEnd;
}

/**
 * Resolve the anchor after a moved construction gesture is rejected.
 *
 * A rejected Smart Route drag must not turn its pressed cell into a hidden click-then-click anchor;
 * the next drag still begins where the user presses. Compound modules keep their explicit source so
 * the user can correct the attempted direction without reselecting the terminal.
 */
export function rejectedRailConstructionAnchor(
	continuation: RailConstructionContinuation,
	attemptedStart: Cell,
): Cell | null {
	return continuation.kind === "direct-route" ? null : attemptedStart;
}
