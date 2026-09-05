import {
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
	validateAdvancedSwitchPatch,
} from "./AdvancedSwitch";
import { classifyRailCell } from "./RailCellClassification";
import {
	ALL_DIRECTIONS,
	bitCount,
	DIR_E,
	DIR_W,
	directionBetween,
	isTangentJunction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, decodeRailCell, encodeRailCell, type RailCell } from "./TileMap";
import {
	collectAffectedTurnoutFootprints,
	type TurnoutValidationIssue,
	validateTurnoutFootprints,
} from "./turnout";

export type BendPreference = "auto" | "horizontal-first" | "vertical-first";

export type RailConstructionIssueCode =
	| "insufficient-path"
	| "disconnected"
	| "non-cardinal"
	| "reverse-overlap"
	| "duplicate"
	| "reserved-footprint"
	| "topology";

export interface RailMapReader {
	readonly edgeCount: number;
	getRevision(): number;
	getEncoded(x: number, y: number): number;
	getRail(x: number, y: number): RailCell;
	hasRail(x: number, y: number): boolean;
	getAdvancedSwitch(id: number): AdvancedSwitchRecord | undefined;
	getAdvancedSwitchOwningCell(x: number, y: number): AdvancedSwitchRecord | undefined;
}

export interface RailMutation {
	x: number;
	y: number;
	before: number;
	after: number;
}

export interface RailConstructionPlan {
	kind: "build";
	baseRevision: number;
	cells: readonly Cell[];
	mutations: readonly RailMutation[];
	switchMutations?: readonly AdvancedSwitchMutation[];
	valid: boolean;
	reason: string;
	issueCode?: RailConstructionIssueCode | null;
	conflicts: readonly Cell[];
	newEdges: number;
	lengthMeters: number;
	turns: number;
	bend: Exclude<BendPreference, "auto">;
}

export interface RailErasePlan {
	kind: "erase";
	baseRevision: number;
	cells: readonly Cell[];
	mutations: readonly RailMutation[];
	switchMutations: readonly AdvancedSwitchMutation[];
	valid: boolean;
	reason: string;
}

/** Orthogonal route with one optional corner. Cells are ordered in vehicle flow direction. */
export function lShapedPath(start: Cell, end: Cell, horizontalFirst = true): Cell[] {
	const cells: Cell[] = [];
	const push = (x: number, y: number): void => {
		const previous = cells.at(-1);
		if (previous?.x === x && previous.y === y) return;
		cells.push({ x, y });
	};
	const walkX = (fromX: number, toX: number, y: number): void => {
		const step = Math.sign(toX - fromX);
		for (let x = fromX; ; x += step) {
			push(x, y);
			if (x === toX) break;
		}
	};
	const walkY = (fromY: number, toY: number, x: number): void => {
		const step = Math.sign(toY - fromY);
		for (let y = fromY; ; y += step) {
			push(x, y);
			if (y === toY) break;
		}
	};

	if (horizontalFirst) {
		walkX(start.x, end.x, start.y);
		walkY(start.y, end.y, end.x);
	} else {
		walkY(start.y, end.y, start.x);
		walkX(start.x, end.x, end.y);
	}
	return cells;
}

export function planRailConstruction(
	map: RailMapReader,
	start: Cell,
	end: Cell,
	preference: BendPreference = "auto",
): RailConstructionPlan {
	if (start.x === end.x || start.y === end.y) {
		const bend = start.x === end.x ? "vertical-first" : "horizontal-first";
		return evaluateRoute(map, lShapedPath(start, end, start.y === end.y), bend);
	}

	const candidates: RailConstructionPlan[] = [];
	if (preference !== "vertical-first") {
		candidates.push(evaluateRoute(map, lShapedPath(start, end, true), "horizontal-first"));
	}
	if (preference !== "horizontal-first" && start.x !== end.x && start.y !== end.y) {
		candidates.push(evaluateRoute(map, lShapedPath(start, end, false), "vertical-first"));
	}
	if (candidates.length === 1) return candidates[0] as RailConstructionPlan;

	return [...candidates].sort(
		(left, right) => routeScore(map, left) - routeScore(map, right),
	)[0] as RailConstructionPlan;
}

/** Validate an already-routed cardinal path through the same topology rules as drag construction. */
export function planRailPath(map: RailMapReader, cells: readonly Cell[]): RailConstructionPlan {
	const firstDirection =
		cells.length >= 2 ? directionBetween(cells[0] as Cell, cells[1] as Cell) : null;
	const bend =
		firstDirection === null || firstDirection === DIR_E || firstDirection === DIR_W
			? "horizontal-first"
			: "vertical-first";
	return evaluateRoute(map, cells, bend);
}

/** Validate that a catalog root is self-closed before applying the ordinary route rules. */
export function planClosedRailPathComponent(
	map: RailMapReader,
	cells: readonly Cell[],
): RailConstructionPlan {
	const first = cells[0];
	const last = cells.at(-1);
	if (!first || !last || first.x !== last.x || first.y !== last.y) {
		return Object.freeze({
			kind: "build",
			baseRevision: map.getRevision(),
			cells: Object.freeze(cells.map((cell) => Object.freeze({ ...cell }))),
			mutations: Object.freeze([]),
			valid: false,
			reason: "분리 배치는 자체 폐합된 FAB 패턴의 기준 순환로만 허용됩니다",
			issueCode: "disconnected",
			conflicts: Object.freeze(cells.length > 0 ? [Object.freeze({ ...first })] : []),
			newEdges: 0,
			lengthMeters: 0,
			turns: 0,
			bend: "horizontal-first",
		});
	}
	const firstDirection =
		cells.length >= 2 ? directionBetween(cells[0] as Cell, cells[1] as Cell) : null;
	const bend =
		firstDirection === null || firstDirection === DIR_E || firstDirection === DIR_W
			? "horizontal-first"
			: "vertical-first";
	return evaluateRoute(map, cells, bend);
}

export function planRailErase(map: RailMapReader, cells: readonly Cell[]): RailErasePlan {
	const overlay = new Map<string, RailMutation>();
	const switchMutationsById = new Map<number, AdvancedSwitchMutation>();
	const expandedCells = new Map<string, Cell>();
	const ordinaryCells = new Map<string, Cell>();
	for (const cell of cells) {
		const owner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
		if (!owner) {
			expandedCells.set(cellKey(cell.x, cell.y), cell);
			ordinaryCells.set(cellKey(cell.x, cell.y), cell);
			continue;
		}
		if (switchMutationsById.has(owner.id)) continue;
		switchMutationsById.set(owner.id, { id: owner.id, before: owner, after: null });
		for (const occupied of deriveAdvancedSwitchGeometry(owner).occupiedCells) {
			expandedCells.set(cellKey(occupied.x, occupied.y), occupied);
		}
	}
	const switchMutations = [...switchMutationsById.values()];
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
	for (const mutation of switchMutations) {
		if (!mutation.before) continue;
		for (const expected of deriveAdvancedSwitchGeometry(mutation.before).cellStates) {
			const actual = decodeRailCell(read(expected));
			write(
				expected,
				encodeRailCell({
					incoming: actual.incoming & ~expected.incoming,
					outgoing: actual.outgoing & ~expected.outgoing,
				}),
			);
		}
	}

	for (const cell of ordinaryCells.values()) {
		const state = decodeRailCell(read(cell));
		if ((state.incoming | state.outgoing) === 0) continue;
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = moveCell(cell, direction);
			const opposite = oppositeDirection(direction);
			const neighborState = decodeRailCell(read(neighbor));
			if ((state.outgoing & direction) !== 0) {
				write(
					neighbor,
					encodeRailCell({
						...neighborState,
						incoming: neighborState.incoming & ~opposite,
					}),
				);
			}
			if ((state.incoming & direction) !== 0) {
				write(
					neighbor,
					encodeRailCell({
						...neighborState,
						outgoing: neighborState.outgoing & ~opposite,
					}),
				);
			}
		}
		write(cell, 0);
	}

	const mutations = [...overlay.values()].filter((mutation) => mutation.before !== mutation.after);
	const topologyError = railMutationTopologyError(map, mutations, switchMutations);
	return {
		kind: "erase",
		baseRevision: map.getRevision(),
		cells: [...expandedCells.values()],
		mutations,
		switchMutations,
		valid: (mutations.length > 0 || switchMutations.length > 0) && topologyError === null,
		reason:
			topologyError ??
			(mutations.length > 0 || switchMutations.length > 0
				? switchMutations.length > 0
					? "고급 스위치 모듈 전체 철거"
					: "선택 구간 철거"
				: "철거할 레일이 없습니다"),
	};
}

/** Validate an authored mutation batch against local cell, reciprocity, turnout, and switch rules. */
export function railMutationTopologyError(
	map: RailMapReader,
	mutations: readonly RailMutation[],
	switchMutations: readonly AdvancedSwitchMutation[] = [],
): string | null {
	const afterByCell = new Map(
		mutations.map((mutation) => [cellKey(mutation.x, mutation.y), mutation.after]),
	);
	const readEncoded = (x: number, y: number): number =>
		afterByCell.get(cellKey(x, y)) ?? map.getEncoded(x, y);
	const affected = new Map<string, Cell>();
	for (const mutation of mutations) {
		const cell = { x: mutation.x, y: mutation.y };
		affected.set(cellKey(cell.x, cell.y), cell);
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = moveCell(cell, direction);
			affected.set(cellKey(neighbor.x, neighbor.y), neighbor);
		}
	}
	for (const cell of affected.values()) {
		const encoded = readEncoded(cell.x, cell.y);
		if (encoded !== 0 && classifyRailCell(decodeRailCell(encoded)) === "INVALID") {
			return `철거 후 X ${cell.x} · Z ${cell.y}의 방향 토폴로지가 유효하지 않습니다`;
		}
		const rail = decodeRailCell(encoded);
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = moveCell(cell, direction);
			const neighborRail = decodeRailCell(readEncoded(neighbor.x, neighbor.y));
			const opposite = oppositeDirection(direction);
			if (((rail.outgoing & direction) !== 0) !== ((neighborRail.incoming & opposite) !== 0)) {
				return `철거 후 X ${cell.x} · Z ${cell.y}의 연결이 이웃 셀과 일치하지 않습니다`;
			}
		}
	}
	const read = (cell: Cell): number => readEncoded(cell.x, cell.y);
	const turnoutIssue = validateAffectedTurnouts(map, read, mutations, switchMutations)[0];
	if (turnoutIssue) return turnoutIssue.message;
	return validateAdvancedSwitchPatch(map, mutations, switchMutations)[0]?.message ?? null;
}

function evaluateRoute(
	map: RailMapReader,
	cells: readonly Cell[],
	bend: Exclude<BendPreference, "auto">,
): RailConstructionPlan {
	const overlay = new Map<string, RailMutation>();
	const conflicts = new Map<string, Cell>();
	let reason = "배치 가능";
	let valid = cells.length >= 2;
	let issueCode: RailConstructionIssueCode | null = valid ? null : "insufficient-path";
	let newEdges = 0;

	const read = (cell: Cell): number =>
		overlay.get(cellKey(cell.x, cell.y))?.after ?? map.getEncoded(cell.x, cell.y);
	const write = (cell: Cell, state: RailCell): void => {
		const key = cellKey(cell.x, cell.y);
		const existing = overlay.get(key);
		overlay.set(key, {
			x: cell.x,
			y: cell.y,
			before: existing?.before ?? map.getEncoded(cell.x, cell.y),
			after: encodeRailCell(state),
		});
	};
	const fail = (code: RailConstructionIssueCode, message: string, ...cellsToMark: Cell[]): void => {
		if (valid) {
			reason = message;
			issueCode = code;
		}
		valid = false;
		for (const cell of cellsToMark) conflicts.set(cellKey(cell.x, cell.y), cell);
	};

	if (cells.length < 2) reason = "시작점을 잡고 한 칸 이상 드래그하세요";
	for (let index = 0; index < cells.length - 1; index++) {
		const from = cells[index] as Cell;
		const to = cells[index + 1] as Cell;
		const direction = directionBetween(from, to);
		if (direction === null) {
			fail("non-cardinal", "레일은 5m 직교 모듈로만 연결할 수 있습니다", from, to);
			continue;
		}
		const opposite = oppositeDirection(direction);
		const fromState = decodeRailCell(read(from));
		const toState = decodeRailCell(read(to));

		if ((fromState.incoming & direction) !== 0 || (toState.outgoing & opposite) !== 0) {
			fail("reverse-overlap", "같은 레일을 역방향으로 겹칠 수 없습니다", from, to);
			continue;
		}
		if ((fromState.outgoing & direction) !== 0 && (toState.incoming & opposite) !== 0) {
			continue;
		}

		write(from, { ...fromState, outgoing: fromState.outgoing | direction });
		write(to, { ...toState, incoming: toState.incoming | opposite });
		newEdges++;
	}

	for (const mutation of overlay.values()) {
		const state = decodeRailCell(mutation.after);
		const incomingCount = bitCount(state.incoming);
		const outgoingCount = bitCount(state.outgoing);
		const degree = bitCount(state.incoming | state.outgoing);
		const cell = { x: mutation.x, y: mutation.y };
		if ((state.incoming & state.outgoing) !== 0) {
			fail("reverse-overlap", "한 레일 모듈에 양방향 선로를 겹칠 수 없습니다", cell);
		} else if (degree > 3) {
			fail("topology", "평면 십자 교차는 허용되지 않습니다", cell);
		} else if (degree === 2 && (incomingCount !== 1 || outgoingCount !== 1)) {
			fail("topology", "진행 방향이 이어지지 않는 레일입니다", cell);
		} else if (degree === 3) {
			if (
				!(
					(incomingCount === 1 && outgoingCount === 2) ||
					(incomingCount === 2 && outgoingCount === 1)
				)
			) {
				fail("topology", "분기와 합류는 1→2 또는 2→1 방향으로만 만들 수 있습니다", cell);
			} else if (!isTangentJunction(state.incoming, state.outgoing)) {
				fail("topology", "정면 충돌 T자는 만들 수 없습니다. 직선 본선에 곡선으로 접속하세요", cell);
			}
		}
	}

	const mutations = [...overlay.values()].filter((mutation) => mutation.before !== mutation.after);
	for (const issue of validateAdvancedSwitchPatch(map, mutations)) {
		fail("reserved-footprint", issue.message, ...issue.cells);
	}
	for (const issue of validateAffectedTurnouts(map, read, mutations)) {
		fail("topology", issue.message, ...issue.cells);
	}

	if (newEdges === 0 && cells.length >= 2) {
		fail("duplicate", "이미 같은 방향으로 설치된 레일입니다", ...cells);
	}
	return {
		kind: "build",
		baseRevision: map.getRevision(),
		cells,
		mutations,
		valid,
		reason,
		issueCode: valid ? null : issueCode,
		conflicts: [...conflicts.values()],
		newEdges,
		lengthMeters: Math.max(0, cells.length - 1),
		turns: countTurns(cells),
		bend,
	};
}

function validateAffectedTurnouts(
	map: RailMapReader,
	readEncoded: (cell: Cell) => number,
	mutations: readonly RailMutation[],
	switchMutations: readonly AdvancedSwitchMutation[] = [],
): TurnoutValidationIssue[] {
	if (mutations.length === 0) return [];
	const changedCells = mutations.map(({ x, y }) => ({ x, y }));
	const readRail = (x: number, y: number): RailCell => decodeRailCell(readEncoded({ x, y }));
	const footprints = collectAffectedTurnoutFootprints(readRail, changedCells);
	const switches = new Map<number, AdvancedSwitchRecord>();
	for (const footprint of footprints) {
		for (const cell of footprint.reservedCells) {
			const owner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
			if (owner) switches.set(owner.id, owner);
		}
	}
	for (const mutation of switchMutations) {
		if (mutation.after) switches.set(mutation.id, mutation.after);
		else switches.delete(mutation.id);
	}
	return validateTurnoutFootprints(readRail, footprints, [...switches.values()]);
}

function routeScore(map: RailMapReader, plan: RailConstructionPlan): number {
	let score = plan.valid ? 0 : 10_000 + plan.conflicts.length * 100;
	const firstDirection = directionBetween(plan.cells[0] as Cell, plan.cells[1] as Cell);
	const start = plan.cells[0] as Cell;
	const startRail = map.getRail(start.x, start.y);
	let preferredDirection: number | null = null;
	if (bitCount(startRail.outgoing) === 1) {
		preferredDirection =
			ALL_DIRECTIONS.find((direction) => (startRail.outgoing & direction) !== 0) ?? null;
	} else if (startRail.outgoing === 0 && bitCount(startRail.incoming) === 1) {
		const incoming = ALL_DIRECTIONS.find((direction) => (startRail.incoming & direction) !== 0);
		preferredDirection = incoming ? oppositeDirection(incoming) : null;
	}
	if (
		firstDirection !== null &&
		preferredDirection !== null &&
		firstDirection !== preferredDirection
	) {
		score += 6;
	}
	for (const mutation of plan.mutations) {
		if (mutation.before !== 0) score += 1;
	}
	return score;
}

function countTurns(cells: readonly Cell[]): number {
	let turns = 0;
	let previousDirection: number | null = null;
	let firstDirection: number | null = null;
	for (let index = 0; index < cells.length - 1; index++) {
		const direction = directionBetween(cells[index] as Cell, cells[index + 1] as Cell);
		if (firstDirection === null) firstDirection = direction;
		if (previousDirection !== null && direction !== previousDirection) turns++;
		previousDirection = direction;
	}
	const first = cells[0];
	const last = cells.at(-1);
	if (
		first &&
		last &&
		first.x === last.x &&
		first.y === last.y &&
		firstDirection !== null &&
		previousDirection !== null &&
		firstDirection !== previousDirection
	) {
		turns++;
	}
	return turns;
}
