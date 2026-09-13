import type { RailConstructionPlan } from "../core/paint";
import type { Cell } from "../core/TileMap";

/** A single interactive gesture budget, independent of project/import/Blueprint capacity. */
export const RAIL_POINTER_MAX_PATH_METERS = 4096;

export function railPointerPlanningIssue(
	start: Cell,
	target: Cell,
	gesture: "path" | "direction" = "path",
): string | null {
	for (const value of [start.x, start.y, target.x, target.y]) {
		if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
			return "레일 좌표 범위 밖입니다 · 기존 배치로 돌아가 위치를 선택하세요";
		}
	}
	if (
		gesture === "path" &&
		Math.abs(target.x - start.x) + Math.abs(target.y - start.y) > RAIL_POINTER_MAX_PATH_METERS
	) {
		return "한 번에 4,096m까지 편집할 수 있습니다 · 확대 후 짧게 나누어 편집하세요";
	}
	return null;
}

export function rejectedRailPointerPlan(
	baseRevision: number,
	reason: string,
): RailConstructionPlan {
	return {
		kind: "build",
		baseRevision,
		cells: [],
		mutations: [],
		valid: false,
		reason,
		conflicts: [],
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
	};
}
