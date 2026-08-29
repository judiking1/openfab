import type { RailModuleOwnership, RailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import type { Cell } from "../core/TileMap";

/** Keep an existing semantic identity exact; only pending selections may resolve by cell. */
export function resolveRailSelectionOwnership(
	index: RailModuleOwnershipIndex,
	cell: Cell,
	currentModuleKey: string | null,
): RailModuleOwnership | null {
	if (currentModuleKey !== null) return index.find(currentModuleKey);
	const resolution = index.resolve(cell);
	return resolution.status === "resolved" ? resolution.module : null;
}
