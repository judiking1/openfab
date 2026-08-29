import { analyzeRailNetwork } from "./network";
import {
	type BendPreference,
	planRailConstruction,
	planRailErase,
	type RailConstructionPlan,
	type RailErasePlan,
	type RailMapReader,
	type RailMutation,
} from "./paint";
import { MutationRailMap } from "./RailMutationMap";
import { createRailNetworkLinkAnchorContext, planRailNetworkLink } from "./RailNetworkLinkPlanner";
import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_W,
	type Direction,
	directionBetween,
	isCorner,
	moveCell,
	oppositeDirection,
} from "./railShape";
import {
	type Cell,
	cellKey,
	decodeRailCell,
	encodeRailCell,
	type RailCell,
	type TileMap,
} from "./TileMap";

export interface RailReplacementPlan {
	kind: "edit";
	baseRevision: number;
	cells: readonly Cell[];
	mutations: readonly RailMutation[];
	valid: boolean;
	reason: string;
	conflicts: readonly Cell[];
	newEdges: number;
	lengthMeters: number;
	turns: number;
	bend: Exclude<BendPreference, "auto">;
}

export interface RailOneWayCorridorProof {
	readonly cells: readonly Cell[];
	readonly departure: Readonly<{ from: Cell; to: Cell }>;
	readonly arrival: Readonly<{ from: Cell; to: Cell }>;
}

/** Replaces a regular 90-degree corner and 3 m approach arms with a routed detour. */
export function planMoveCorner(
	map: TileMap,
	corner: Cell,
	target: Cell,
	preference: BendPreference = "auto",
): RailReplacementPlan {
	const switchOwner = map.getAdvancedSwitchOwningCell(corner.x, corner.y);
	if (switchOwner) {
		return invalidReplacement(
			map,
			[corner],
			`스위치 ${switchOwner.id}는 복합 모듈 전체를 선택해 편집하세요`,
			[corner],
		);
	}
	const cornerRail = map.getRail(corner.x, corner.y);
	if (
		bitCount(cornerRail.incoming) !== 1 ||
		bitCount(cornerRail.outgoing) !== 1 ||
		(cornerRail.incoming | cornerRail.outgoing) === 5 ||
		(cornerRail.incoming | cornerRail.outgoing) === 10
	) {
		return invalidReplacement(map, [corner], "일반 90도 코너만 재배치할 수 있습니다", [corner]);
	}
	if (corner.x === target.x && corner.y === target.y) {
		return invalidReplacement(map, [corner], "코너를 다른 셀로 이동하세요", [corner]);
	}

	const incomingSide = singleDirection(cornerRail.incoming);
	const outgoingSide = singleDirection(cornerRail.outgoing);
	if (!incomingSide || !outgoingSide) {
		return invalidReplacement(map, [corner], "코너 연결 방향을 찾을 수 없습니다", [corner]);
	}

	const armLength = 3;
	const previous = moveRepeated(corner, incomingSide, armLength);
	const next = moveRepeated(corner, outgoingSide, armLength);
	const editableCells: Cell[] = [];
	for (let distance = armLength - 1; distance >= 1; distance--) {
		editableCells.push(moveRepeated(corner, incomingSide, distance));
	}
	editableCells.push(corner);
	for (let distance = 1; distance < armLength; distance++) {
		editableCells.push(moveRepeated(corner, outgoingSide, distance));
	}
	if (!map.hasRail(previous.x, previous.y) || !map.hasRail(next.x, next.y)) {
		return invalidReplacement(map, editableCells, "코너 양쪽에 3 m 편집 여유가 필요합니다", [
			corner,
		]);
	}
	for (const cell of editableCells) {
		const rail = map.getRail(cell.x, cell.y);
		if (bitCount(rail.incoming) !== 1 || bitCount(rail.outgoing) !== 1) {
			return invalidReplacement(
				map,
				editableCells,
				"junction과 겹친 코너는 직접 이동할 수 없습니다",
				[cell],
			);
		}
	}

	const erasedBase = new MutationRailMap(map);
	const erase = planRailErase(erasedBase, editableCells);
	if (!erase.valid) return invalidReplacement(map, editableCells, erase.reason, [corner]);
	erasedBase.apply(erase.mutations);
	const editableKeys = new Set(editableCells.map((cell) => cellKey(cell.x, cell.y)));
	const combinations: ReadonlyArray<
		readonly [Exclude<BendPreference, "auto">, Exclude<BendPreference, "auto">]
	> =
		preference === "auto"
			? [
					["horizontal-first", "horizontal-first"],
					["vertical-first", "vertical-first"],
					["horizontal-first", "vertical-first"],
					["vertical-first", "horizontal-first"],
				]
			: [[preference, preference]];
	const validPlans: RailReplacementPlan[] = [];
	let lastFailure = invalidReplacement(map, editableCells, "코너 재배치 경로가 유효하지 않습니다", [
		target,
	]);

	for (const [firstBend, secondBend] of combinations) {
		const temporary = erasedBase.clone();
		const first = planRailConstruction(temporary, previous, target, firstBend);
		if (!first.valid) {
			lastFailure = invalidFromConstruction(map, [previous, target], first);
			continue;
		}
		temporary.apply(first.mutations);
		const second = planRailConstruction(temporary, target, next, secondBend);
		if (!second.valid) {
			lastFailure = invalidFromConstruction(map, [target, next], second);
			continue;
		}

		const cells = [...first.cells, ...second.cells.slice(1)];
		const seen = new Set<string>();
		let conflict: Cell | null = null;
		for (const cell of cells) {
			const key = cellKey(cell.x, cell.y);
			if (seen.has(key)) {
				conflict = cell;
				break;
			}
			seen.add(key);
			if (
				map.hasRail(cell.x, cell.y) &&
				!editableKeys.has(key) &&
				!(cell.x === previous.x && cell.y === previous.y) &&
				!(cell.x === next.x && cell.y === next.y)
			) {
				conflict = cell;
				break;
			}
		}
		if (conflict) {
			lastFailure = invalidReplacement(
				map,
				cells,
				"재배치 경로가 기존 레일 또는 자기 자신과 겹칩니다",
				[conflict],
			);
			continue;
		}

		temporary.apply(second.mutations);
		const affectedKeys = new Map<string, Cell>();
		for (const mutation of [...erase.mutations, ...first.mutations, ...second.mutations]) {
			affectedKeys.set(cellKey(mutation.x, mutation.y), { x: mutation.x, y: mutation.y });
		}
		const mutations: RailMutation[] = [];
		for (const cell of affectedKeys.values()) {
			const before = map.getEncoded(cell.x, cell.y);
			const after = temporary.getEncoded(cell.x, cell.y);
			if (before !== after) mutations.push({ x: cell.x, y: cell.y, before, after });
		}
		validPlans.push({
			kind: "edit",
			baseRevision: map.getRevision(),
			cells,
			mutations,
			valid: mutations.length > 0,
			reason: mutations.length > 0 ? "코너 재배치 가능" : "변경된 레일이 없습니다",
			conflicts: [],
			newEdges: first.newEdges + second.newEdges,
			lengthMeters: Math.max(0, cells.length - 1),
			turns: countPhysicalCorners(temporary, cells),
			bend: first.bend,
		});
	}

	return (
		validPlans.sort(
			(left, right) => left.lengthMeters - right.lengthMeters || left.turns - right.turns,
		)[0] ?? lastFailure
	);
}

/** Moves an open directed endpoint while preserving a 3 m fixed connection into the network. */
export function planMoveEndpoint(
	map: TileMap,
	endpoint: Cell,
	target: Cell,
	preference: BendPreference = "auto",
): RailReplacementPlan {
	const switchOwner = map.getAdvancedSwitchOwningCell(endpoint.x, endpoint.y);
	if (switchOwner) {
		return invalidReplacement(
			map,
			[endpoint],
			`스위치 ${switchOwner.id}의 boundary port는 이동할 수 없습니다`,
			[endpoint],
		);
	}
	const endpointRail = map.getRail(endpoint.x, endpoint.y);
	const movesFromEndpoint = endpointRail.incoming === 0 && bitCount(endpointRail.outgoing) === 1;
	const movesIntoEndpoint = endpointRail.outgoing === 0 && bitCount(endpointRail.incoming) === 1;
	if (!movesFromEndpoint && !movesIntoEndpoint) {
		return invalidReplacement(map, [endpoint], "열린 레일 끝점만 재배치할 수 있습니다", [endpoint]);
	}
	if (endpoint.x === target.x && endpoint.y === target.y) {
		return invalidReplacement(map, [endpoint], "끝점을 다른 셀로 이동하세요", [endpoint]);
	}

	const connectedSide = singleDirection(
		movesFromEndpoint ? endpointRail.outgoing : endpointRail.incoming,
	);
	if (!connectedSide) {
		return invalidReplacement(map, [endpoint], "끝점 연결 방향을 찾을 수 없습니다", [endpoint]);
	}

	const armLength = 3;
	const boundary = moveRepeated(endpoint, connectedSide, armLength);
	const editableCells = Array.from({ length: armLength }, (_, distance) =>
		moveRepeated(endpoint, connectedSide, distance),
	);
	const expectedIncoming = movesFromEndpoint ? oppositeDirection(connectedSide) : connectedSide;
	const expectedOutgoing = movesFromEndpoint ? connectedSide : oppositeDirection(connectedSide);
	for (let distance = 1; distance <= armLength; distance++) {
		const cell = moveRepeated(endpoint, connectedSide, distance);
		const rail = map.getRail(cell.x, cell.y);
		if (rail.incoming !== expectedIncoming || rail.outgoing !== expectedOutgoing) {
			return invalidReplacement(
				map,
				editableCells,
				"끝점 안쪽에 같은 방향의 3 m 직선 편집 여유가 필요합니다",
				[cell],
			);
		}
	}

	const temporary = new MutationRailMap(map);
	const erase = planRailErase(temporary, editableCells);
	if (!erase.valid) return invalidReplacement(map, editableCells, erase.reason, [endpoint]);
	temporary.apply(erase.mutations);

	const construction = movesFromEndpoint
		? planRailConstruction(temporary, target, boundary, preference)
		: planRailConstruction(temporary, boundary, target, preference);
	if (!construction.valid) {
		return invalidFromConstruction(map, [endpoint, target], construction);
	}
	const conflict = firstOccupiedReplacementConflict(
		map,
		construction.cells,
		new Set(editableCells.map((cell) => cellKey(cell.x, cell.y))),
		[boundary],
	);
	if (conflict) {
		return invalidReplacement(map, construction.cells, "끝점 이동 경로가 기존 레일과 겹칩니다", [
			conflict,
		]);
	}
	temporary.apply(construction.mutations);

	return replacementFromTemporary(
		map,
		temporary,
		construction.cells,
		[...erase.mutations, ...construction.mutations],
		"끝점 재배치 가능",
		construction.bend,
		construction.newEdges,
	);
}

/** Offsets a local 7 m straight run through two dogleg transitions and four R500 corners. */
export function planOffsetStraight(
	map: TileMap,
	selected: Cell,
	target: Cell,
): RailReplacementPlan {
	const switchOwner = map.getAdvancedSwitchOwningCell(selected.x, selected.y);
	if (switchOwner) {
		return invalidReplacement(
			map,
			[selected],
			`스위치 ${switchOwner.id}의 내부 직선은 독립적으로 이동할 수 없습니다`,
			[selected],
		);
	}
	const selectedRail = map.getRail(selected.x, selected.y);
	const incomingSide = singleDirection(selectedRail.incoming);
	const outgoingSide = singleDirection(selectedRail.outgoing);
	if (!incomingSide || !outgoingSide || outgoingSide !== oppositeDirection(incomingSide)) {
		return invalidReplacement(map, [selected], "일반 단방향 직선 모듈만 평행 이동할 수 있습니다", [
			selected,
		]);
	}

	const horizontal = outgoingSide === DIR_E || outgoingSide === DIR_W;
	const projectedTarget = horizontal
		? { x: selected.x, y: target.y }
		: { x: target.x, y: selected.y };
	if (projectedTarget.x === selected.x && projectedTarget.y === selected.y) {
		return invalidReplacement(map, [selected], "직선과 수직인 방향으로 이동하세요", [selected]);
	}

	const armLength = 3;
	const previous = moveRepeated(selected, incomingSide, armLength);
	const next = moveRepeated(selected, outgoingSide, armLength);
	const editableCells: Cell[] = [];
	for (let distance = armLength - 1; distance >= 1; distance--) {
		editableCells.push(moveRepeated(selected, incomingSide, distance));
	}
	editableCells.push(selected);
	for (let distance = 1; distance < armLength; distance++) {
		editableCells.push(moveRepeated(selected, outgoingSide, distance));
	}
	for (let distance = armLength; distance >= -armLength; distance--) {
		const direction = distance > 0 ? incomingSide : outgoingSide;
		const cell = moveRepeated(selected, direction, Math.abs(distance));
		const rail = map.getRail(cell.x, cell.y);
		if (rail.incoming !== incomingSide || rail.outgoing !== outgoingSide) {
			return invalidReplacement(
				map,
				editableCells,
				"선택점 양쪽에 같은 방향의 3 m 직선 편집 여유가 필요합니다",
				[cell],
			);
		}
	}

	const entry = horizontal
		? { x: previous.x, y: projectedTarget.y }
		: { x: projectedTarget.x, y: previous.y };
	const exit = horizontal
		? { x: next.x, y: projectedTarget.y }
		: { x: projectedTarget.x, y: next.y };
	const temporary = new MutationRailMap(map);
	const erase = planRailErase(temporary, editableCells);
	if (!erase.valid) return invalidReplacement(map, editableCells, erase.reason, [selected]);
	temporary.apply(erase.mutations);

	const segments: RailConstructionPlan[] = [];
	for (const [from, to] of [
		[previous, entry],
		[entry, exit],
		[exit, next],
	] as const) {
		const segment = planRailConstruction(temporary, from, to);
		if (!segment.valid) return invalidFromConstruction(map, [from, to], segment);
		segments.push(segment);
		temporary.apply(segment.mutations);
	}
	const cells = segments.flatMap((segment, index) =>
		index === 0 ? [...segment.cells] : [...segment.cells.slice(1)],
	);
	const conflict = firstOccupiedReplacementConflict(
		map,
		cells,
		new Set(editableCells.map((cell) => cellKey(cell.x, cell.y))),
		[previous, next],
	);
	if (conflict) {
		return invalidReplacement(map, cells, "평행 이동 경로가 기존 레일과 겹칩니다", [conflict]);
	}

	const sourceMutations = [...erase.mutations, ...segments.flatMap((segment) => segment.mutations)];
	return replacementFromTemporary(
		map,
		temporary,
		cells,
		sourceMutations,
		"직선 구간 평행 이동 가능",
		horizontal ? "vertical-first" : "horizontal-first",
		segments.reduce((sum, segment) => sum + segment.newEdges, 0),
	);
}

/** Removes only the secondary bypass between a branch and its merge, preserving the trunk. */
export function planRemoveBranchRoute(map: TileMap, selected: Cell): RailErasePlan {
	const switchOwner = map.getAdvancedSwitchOwningCell(selected.x, selected.y);
	if (switchOwner) {
		return invalidPlan(
			map,
			selected,
			`스위치 ${switchOwner.id}의 movement는 부분 철거할 수 없습니다`,
		);
	}
	const selectedRail = map.getRail(selected.x, selected.y);
	const incomingCount = bitCount(selectedRail.incoming);
	const outgoingCount = bitCount(selectedRail.outgoing);
	let path: Cell[] | null = null;

	if (incomingCount === 1 && outgoingCount === 2) {
		path = traceForwardBranch(map, selected, selectedRail);
	} else if (incomingCount === 2 && outgoingCount === 1) {
		path = traceBackwardMerge(map, selected, selectedRail);
	}

	if (!path || path.length < 2)
		return invalidPlan(map, selected, "선택한 junction의 보조 경로를 결정할 수 없습니다");
	const branch = path[0] as Cell;
	const first = path[1] as Cell;
	const branchDirection = directionBetween(branch, first);
	if (!branchDirection) return invalidPlan(map, selected, "분기 경로가 인접하지 않습니다");

	const mutations: RailMutation[] = [];
	const branchBefore = map.getEncoded(branch.x, branch.y);
	const branchRail = decodeRailCell(branchBefore);
	mutations.push({
		x: branch.x,
		y: branch.y,
		before: branchBefore,
		after: encodeRailCell({ ...branchRail, outgoing: branchRail.outgoing & ~branchDirection }),
	});

	const last = path.at(-1) as Cell;
	const lastRail = map.getRail(last.x, last.y);
	const endsAtMerge = bitCount(lastRail.incoming) === 2 && bitCount(lastRail.outgoing) === 1;
	const interiorEnd = endsAtMerge ? path.length - 1 : path.length;
	for (let index = 1; index < interiorEnd; index++) {
		const cell = path[index] as Cell;
		const before = map.getEncoded(cell.x, cell.y);
		if (before !== 0) mutations.push({ x: cell.x, y: cell.y, before, after: 0 });
	}

	if (endsAtMerge) {
		const previous = path[path.length - 2] as Cell;
		const mergeIncomingSide = directionBetween(last, previous);
		if (!mergeIncomingSide) return invalidPlan(map, selected, "합류 경로가 인접하지 않습니다");
		const mergeBefore = map.getEncoded(last.x, last.y);
		mutations.push({
			x: last.x,
			y: last.y,
			before: mergeBefore,
			after: encodeRailCell({ ...lastRail, incoming: lastRail.incoming & ~mergeIncomingSide }),
		});
	}

	return {
		kind: "erase",
		baseRevision: map.getRevision(),
		cells: path,
		mutations: mutations.filter((mutation) => mutation.before !== mutation.after),
		switchMutations: [],
		valid: mutations.length > 0,
		reason: endsAtMerge ? "분기-합류 우회 경로 철거" : "열린 분기 경로 철거",
	};
}

/**
 * Removes one diagnosed one-way bridge only after proving that the typed readiness corridor still
 * matches the authored graph and that the result is a set of closed directed components. The user
 * can then replace the unsafe bridge with one atomic outbound/return Network Link.
 */
export function planRemoveOneWayCorridor(
	map: TileMap,
	corridor: RailOneWayCorridorProof,
): RailErasePlan {
	const focus = corridor.departure.from;
	const before = analyzeRailNetwork(map);
	if (
		before.components !== 1 ||
		before.openEnds !== 0 ||
		before.strongComponents <= 1 ||
		before.unsafeJunctions !== 0
	) {
		return invalidPlan(
			map,
			focus,
			"현재 레일은 폐쇄된 단방향 브리지 복구 조건과 일치하지 않습니다",
		);
	}
	if (!analysisContainsExactCorridor(before, corridor)) {
		return invalidPlan(map, focus, "진단 이후 레일이 변경되었습니다. 문제를 다시 검사하세요");
	}

	const removal = planRemoveBranchRoute(map, focus);
	if (!removal.valid || !sameOrderedCells(removal.cells, corridor.cells)) {
		return invalidPlan(
			map,
			focus,
			"강조된 단방향 브리지를 다른 분기와 구분할 수 없어 자동 철거하지 않았습니다",
		);
	}
	if (
		!sameCell(removal.cells[0], corridor.departure.from) ||
		!sameCell(removal.cells[1], corridor.departure.to) ||
		!sameCell(removal.cells.at(-2), corridor.arrival.from) ||
		!sameCell(removal.cells.at(-1), corridor.arrival.to)
	) {
		return invalidPlan(map, focus, "단방향 브리지 경계가 현재 분기·합류와 일치하지 않습니다");
	}

	const future = map.clone();
	future.applyAtomicMutations(removal.mutations, removal.switchMutations);
	const after = analyzeRailNetwork(future);
	if (
		after.components <= before.components ||
		after.openEnds !== 0 ||
		after.unsafeJunctions !== 0 ||
		after.strongComponents !== after.components
	) {
		return invalidPlan(
			map,
			focus,
			"브리지를 제거해도 독립된 폐쇄 루프가 보존되지 않아 자동 철거하지 않았습니다",
		);
	}

	return {
		...removal,
		reason: "단방향 브리지를 제거하고 두 폐쇄 루프를 보존",
	};
}

/**
 * Atomically replaces an exact one-way bridge with a validated outbound/return Network Link. The
 * authored graph never publishes the intermediate disconnected state.
 */
export function planRepairOneWayCorridor(
	map: TileMap,
	corridor: RailOneWayCorridorProof,
): RailReplacementPlan {
	const removal = planRemoveOneWayCorridor(map, corridor);
	if (!removal.valid) {
		return invalidReplacement(map, corridor.cells, removal.reason, [corridor.departure.from]);
	}

	const withoutBridge = new MutationRailMap(map);
	withoutBridge.apply(removal.mutations);
	const context = createRailNetworkLinkAnchorContext(withoutBridge, corridor.departure.from);
	if (!context.valid) {
		return invalidReplacement(
			map,
			corridor.cells,
			`브리지는 식별했지만 자동 왕복 연결 지점이 부족합니다 · ${context.reason}`,
			[corridor.departure.from],
		);
	}
	const link = planRailNetworkLink(withoutBridge, context, corridor.arrival.to);
	if (!link.valid) {
		return invalidReplacement(
			map,
			corridor.cells,
			`브리지는 식별했지만 자동 왕복 경로를 만들 수 없습니다 · ${link.reason}`,
			link.conflicts,
		);
	}

	const combined = new MutationRailMap(map);
	combined.apply(removal.mutations);
	combined.apply(link.mutations);
	const mutations = combined.mutations();
	const future = map.clone();
	future.applyAtomicMutations(mutations, []);
	const after = analyzeRailNetwork(future);
	if (
		after.status !== "closed" ||
		after.components !== 1 ||
		after.strongComponents !== 1 ||
		after.openEnds !== 0 ||
		after.unsafeJunctions !== 0
	) {
		return invalidReplacement(
			map,
			corridor.cells,
			"자동 왕복 경로가 하나의 폐합 유향망을 만들지 못해 원본을 보존했습니다",
			link.conflicts,
		);
	}

	const cells = uniqueOrderedCells([...corridor.cells, ...link.cells]);
	return {
		kind: "edit",
		baseRevision: map.getRevision(),
		cells,
		mutations,
		valid: mutations.length > 0,
		reason: "단방향 브리지를 OUTBOUND와 RETURN 폐쇄 연결로 교체",
		conflicts: [],
		newEdges: future.edgeCount - map.edgeCount,
		lengthMeters: link.lengthMeters,
		turns: link.turns,
		bend: link.bend,
	};
}

function traceForwardBranch(map: TileMap, start: Cell, rail: RailCell): Cell[] | null {
	const incoming = singleDirection(rail.incoming);
	if (!incoming) return null;
	const trunkDirection = oppositeDirection(incoming);
	const branchDirection = ALL_DIRECTIONS.find(
		(direction) => (rail.outgoing & direction) !== 0 && direction !== trunkDirection,
	);
	if (!branchDirection || (rail.outgoing & trunkDirection) === 0) return null;

	const path: Cell[] = [start];
	const visited = new Set([cellKey(start.x, start.y)]);
	let direction: Direction = branchDirection;
	let current = moveCell(start, direction);
	for (let steps = 0; steps <= map.size; steps++) {
		const key = cellKey(current.x, current.y);
		if (visited.has(key) || !map.hasRail(current.x, current.y)) return null;
		visited.add(key);
		path.push(current);
		const currentRail = map.getRail(current.x, current.y);
		const expectedIncoming = oppositeDirection(direction);
		if ((currentRail.incoming & expectedIncoming) === 0) return null;

		const incomingCount = bitCount(currentRail.incoming);
		const outgoingCount = bitCount(currentRail.outgoing);
		if (incomingCount === 2 && outgoingCount === 1) return path;
		if (incomingCount === 1 && outgoingCount === 0) return path;
		if (incomingCount !== 1 || outgoingCount !== 1) return null;
		const nextDirection = singleDirection(currentRail.outgoing);
		if (!nextDirection) return null;
		direction = nextDirection;
		current = moveCell(current, direction);
	}
	return null;
}

function traceBackwardMerge(map: TileMap, merge: Cell, rail: RailCell): Cell[] | null {
	const outgoing = singleDirection(rail.outgoing);
	if (!outgoing) return null;
	const trunkIncoming = oppositeDirection(outgoing);
	const branchIncoming = ALL_DIRECTIONS.find(
		(direction) => (rail.incoming & direction) !== 0 && direction !== trunkIncoming,
	);
	if (!branchIncoming || (rail.incoming & trunkIncoming) === 0) return null;

	const reversePath: Cell[] = [merge];
	const visited = new Set([cellKey(merge.x, merge.y)]);
	let current = moveCell(merge, branchIncoming);
	let expectedOutgoing = oppositeDirection(branchIncoming);
	for (let steps = 0; steps <= map.size; steps++) {
		const key = cellKey(current.x, current.y);
		if (visited.has(key) || !map.hasRail(current.x, current.y)) return null;
		visited.add(key);
		reversePath.push(current);
		const currentRail = map.getRail(current.x, current.y);
		if ((currentRail.outgoing & expectedOutgoing) === 0) return null;

		const incomingCount = bitCount(currentRail.incoming);
		const outgoingCount = bitCount(currentRail.outgoing);
		if (incomingCount === 1 && outgoingCount === 2) return reversePath.reverse();
		if (incomingCount !== 1 || outgoingCount !== 1) return null;
		const incoming = singleDirection(currentRail.incoming);
		if (!incoming) return null;
		expectedOutgoing = oppositeDirection(incoming);
		current = moveCell(current, incoming);
	}
	return null;
}

function analysisContainsExactCorridor(
	analysis: ReturnType<typeof analyzeRailNetwork>,
	corridor: RailOneWayCorridorProof,
): boolean {
	for (let index = 0; index + 1 < analysis.oneWayCorridorOffsets.length; index++) {
		const start = analysis.oneWayCorridorOffsets[index] as number;
		const end = analysis.oneWayCorridorOffsets[index + 1] as number;
		if (end - start !== corridor.cells.length) continue;
		const boundaryOffset = index * 8;
		if (
			analysis.oneWayCorridorBoundaries[boundaryOffset] !== corridor.departure.from.x ||
			analysis.oneWayCorridorBoundaries[boundaryOffset + 1] !== corridor.departure.from.y ||
			analysis.oneWayCorridorBoundaries[boundaryOffset + 2] !== corridor.departure.to.x ||
			analysis.oneWayCorridorBoundaries[boundaryOffset + 3] !== corridor.departure.to.y ||
			analysis.oneWayCorridorBoundaries[boundaryOffset + 4] !== corridor.arrival.from.x ||
			analysis.oneWayCorridorBoundaries[boundaryOffset + 5] !== corridor.arrival.from.y ||
			analysis.oneWayCorridorBoundaries[boundaryOffset + 6] !== corridor.arrival.to.x ||
			analysis.oneWayCorridorBoundaries[boundaryOffset + 7] !== corridor.arrival.to.y
		) {
			continue;
		}
		let matches = true;
		for (let cellIndex = 0; cellIndex < corridor.cells.length; cellIndex++) {
			const cell = corridor.cells[cellIndex] as Cell;
			const analysisOffset = (start + cellIndex) * 2;
			if (
				analysis.oneWayCorridorCells[analysisOffset] !== cell.x ||
				analysis.oneWayCorridorCells[analysisOffset + 1] !== cell.y
			) {
				matches = false;
				break;
			}
		}
		if (matches) return true;
	}
	return false;
}

function sameOrderedCells(left: readonly Cell[], right: readonly Cell[]): boolean {
	return left.length === right.length && left.every((cell, index) => sameCell(cell, right[index]));
}

function sameCell(left: Cell | undefined, right: Cell | undefined): boolean {
	return left !== undefined && right !== undefined && left.x === right.x && left.y === right.y;
}

function uniqueOrderedCells(cells: readonly Cell[]): readonly Cell[] {
	const seen = new Set<string>();
	const result: Cell[] = [];
	for (const cell of cells) {
		const key = cellKey(cell.x, cell.y);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(Object.freeze({ x: cell.x, y: cell.y }));
	}
	return Object.freeze(result);
}

function invalidPlan(map: TileMap, selected: Cell, reason: string): RailErasePlan {
	return {
		kind: "erase",
		baseRevision: map.getRevision(),
		cells: [selected],
		mutations: [],
		switchMutations: [],
		valid: false,
		reason,
	};
}

function singleDirection(mask: number): Direction | null {
	if (bitCount(mask) !== 1) return null;
	return ALL_DIRECTIONS.find((direction) => (mask & direction) !== 0) ?? null;
}

function moveRepeated(cell: Cell, direction: Direction, distance: number): Cell {
	let current = cell;
	for (let step = 0; step < distance; step++) current = moveCell(current, direction);
	return current;
}

function firstOccupiedReplacementConflict(
	map: TileMap,
	cells: readonly Cell[],
	editableKeys: ReadonlySet<string>,
	boundaries: readonly Cell[],
): Cell | null {
	const boundaryKeys = new Set(boundaries.map((cell) => cellKey(cell.x, cell.y)));
	const seen = new Set<string>();
	for (const cell of cells) {
		const key = cellKey(cell.x, cell.y);
		if (seen.has(key)) return cell;
		seen.add(key);
		if (map.hasRail(cell.x, cell.y) && !editableKeys.has(key) && !boundaryKeys.has(key)) {
			return cell;
		}
	}
	return null;
}

function replacementFromTemporary(
	map: TileMap,
	temporary: MutationRailMap,
	cells: readonly Cell[],
	sourceMutations: readonly RailMutation[],
	reason: string,
	bend: Exclude<BendPreference, "auto">,
	newEdges: number,
): RailReplacementPlan {
	const affected = new Map<string, Cell>();
	for (const mutation of sourceMutations) {
		affected.set(cellKey(mutation.x, mutation.y), { x: mutation.x, y: mutation.y });
	}
	const mutations: RailMutation[] = [];
	for (const cell of affected.values()) {
		const before = map.getEncoded(cell.x, cell.y);
		const after = temporary.getEncoded(cell.x, cell.y);
		if (before !== after) mutations.push({ x: cell.x, y: cell.y, before, after });
	}
	return {
		kind: "edit",
		baseRevision: map.getRevision(),
		cells,
		mutations,
		valid: mutations.length > 0,
		reason: mutations.length > 0 ? reason : "변경된 레일이 없습니다",
		conflicts: [],
		newEdges,
		lengthMeters: Math.max(0, cells.length - 1),
		turns: countPhysicalCorners(temporary, cells),
		bend,
	};
}

function invalidFromConstruction(
	map: TileMap,
	cells: readonly Cell[],
	plan: RailConstructionPlan,
): RailReplacementPlan {
	return invalidReplacement(map, cells, plan.reason, plan.conflicts);
}

function invalidReplacement(
	map: TileMap,
	cells: readonly Cell[],
	reason: string,
	conflicts: readonly Cell[],
): RailReplacementPlan {
	return {
		kind: "edit",
		baseRevision: map.getRevision(),
		cells,
		mutations: [],
		valid: false,
		reason,
		conflicts,
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
	};
}

function countPhysicalCorners(map: RailMapReader, cells: readonly Cell[]): number {
	const seen = new Set<string>();
	let corners = 0;
	for (const cell of cells) {
		const key = cellKey(cell.x, cell.y);
		if (seen.has(key)) continue;
		seen.add(key);
		const rail = map.getRail(cell.x, cell.y);
		if (bitCount(rail.incoming) === 1 && bitCount(rail.outgoing) === 1) {
			corners += Number(isCorner(rail.incoming | rail.outgoing));
		}
	}
	return corners;
}
