import { type RailErasePlan, type RailMutation, railMutationTopologyErrorSteps } from "./paint";
import {
	type RailModuleOwnership,
	type RailModuleOwnershipIndex,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import { directionBetween, oppositeDirection } from "./railShape";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type TileMap } from "./TileMap";

/** exact selected module edges only; the plan grants no owner/commit authority. */
export function* planStaticFabProcessLoopSelectionEraseSteps(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	selectedModules: readonly RailModuleOwnership[],
): Generator<void, RailErasePlan> {
	const revision = map.getRevision();
	if (!Array.isArray(selectedModules) || !Object.isFrozen(selectedModules))
		throw new Error("레일 모듈 선택은 변경되지 않는 목록이어야 합니다");
	if (!railModuleOwnershipIndexMatchesMap(ownership, map))
		throw new Error("레일 선택이 오래되었습니다 · 다시 선택하세요");
	const overlay = new Map<string, RailMutation>();
	const erased = new Set<string>();
	const keys = new Set<string>();
	const read = (cell: Cell): number =>
		overlay.get(cellKey(cell.x, cell.y))?.after ?? map.getEncoded(cell.x, cell.y);
	const write = (cell: Cell, after: number): void => {
		const key = cellKey(cell.x, cell.y);
		const existing = overlay.get(key);
		overlay.set(key, {
			x: cell.x,
			y: cell.y,
			before: existing?.before ?? map.getEncoded(cell.x, cell.y),
			after,
		});
	};
	for (let index = 0; index < selectedModules.length; index++) {
		yield;
		const descriptor = Object.getOwnPropertyDescriptor(selectedModules, index);
		if (!descriptor || !("value" in descriptor))
			throw new Error("레일 모듈 선택은 일반 데이터 목록이어야 합니다");
		const selected = descriptor.value as RailModuleOwnership;
		const key = selected.key;
		if (keys.has(key)) throw new Error("레일 모듈 선택이 중복되었습니다 · 다시 선택하세요");
		keys.add(key);
		const module = ownership.find(key);
		if (!module || module !== selected || module.revision !== revision)
			throw new Error("선택한 레일 모듈이 변경되었습니다 · 다시 선택하세요");
		if (module.advancedSwitchId !== null || module.kind === "advanced-switch")
			throw new Error("Loop 레일 편집은 일반 레일만 지원합니다 · 스위치 선택을 제외하세요");
		for (const edge of module.eraseEdges) {
			yield;
			const key = `${cellKey(edge.from.x, edge.from.y)}>${cellKey(edge.to.x, edge.to.y)}`;
			if (erased.has(key)) continue;
			erased.add(key);
			const direction = directionBetween(edge.from, edge.to);
			if (direction === null) throw new Error("선택한 모듈의 레일 방향을 확인하세요");
			const opposite = oppositeDirection(direction);
			const from = decodeRailCell(read(edge.from));
			const to = decodeRailCell(read(edge.to));
			if ((from.outgoing & direction) === 0 || (to.incoming & opposite) === 0)
				throw new Error("선택한 모듈의 연결이 변경되었습니다 · 다시 선택하세요");
			write(edge.from, encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }));
			write(edge.to, encodeRailCell({ ...to, incoming: to.incoming & ~opposite }));
		}
	}
	const mutations: RailMutation[] = [];
	const cells: Cell[] = [];
	for (const mutation of overlay.values()) {
		yield;
		if (mutation.before === mutation.after) continue;
		mutations.push(Object.freeze({ ...mutation }));
		cells.push(Object.freeze({ x: mutation.x, y: mutation.y }));
	}
	const switchMutations = Object.freeze([]);
	const topologyError = yield* railMutationTopologyErrorSteps(map, mutations, switchMutations);
	return Object.freeze({
		kind: "erase",
		baseRevision: revision,
		cells: Object.freeze(cells),
		mutations: Object.freeze(mutations),
		switchMutations,
		valid: mutations.length > 0 && topologyError === null,
		reason:
			topologyError ??
			(mutations.length > 0 ? "선택한 Loop 레일 모듈 철거" : "철거할 레일 모듈을 먼저 선택하세요"),
	});
}
