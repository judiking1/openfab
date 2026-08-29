import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchMutation,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
	validateAdvancedSwitchPatch,
} from "./AdvancedSwitch";
import type { RailReplacementPlan } from "./edit";
import type { RailConstructionPlan, RailMapReader, RailMutation } from "./paint";
import { terminalForwardDirection } from "./RailModulePlanner";
import {
	bitCount,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, decodeRailCell, encodeRailCell } from "./TileMap";
import { collectAffectedTurnoutFootprints, validateTurnoutFootprints } from "./turnout";

export type AdvancedSwitchSide = "left" | "right";

export interface AdvancedSwitchPlanningMap extends RailMapReader {
	getNextAdvancedSwitchId(): number | null;
}

export interface AdvancedSwitchPlan extends RailConstructionPlan {
	readonly moduleKind: "advanced-switch";
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly side: AdvancedSwitchSide;
	readonly entry: Cell;
	readonly exit: Cell;
	readonly secondaryInput: Cell;
	readonly secondaryOutput: Cell;
	readonly switchRecord: AdvancedSwitchRecord | null;
	readonly switchMutations: readonly AdvancedSwitchMutation[];
}

export interface AdvancedSwitchReplacementPlan extends RailReplacementPlan {
	readonly moduleKind: "advanced-switch";
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly side: AdvancedSwitchSide;
	readonly previousSwitchRecord: AdvancedSwitchRecord | null;
	readonly switchRecord: AdvancedSwitchRecord | null;
	readonly switchMutations: readonly AdvancedSwitchMutation[];
}

/**
 * Plan one project-owned merge -> shared throat -> branch compound from an open terminal.
 * The pointer selects chirality only; all dimensions and directions remain grid-owned.
 */
export function planAdvancedSwitch(
	map: AdvancedSwitchPlanningMap,
	anchor: Cell,
	pointer: Cell,
	profileClass: AdvancedSwitchProfileClass,
	preferredSide: AdvancedSwitchSide | null = null,
	explicitForward: Direction | null = null,
	explicitSide: AdvancedSwitchSide | null = null,
): AdvancedSwitchPlan {
	const connectedForward = terminalForwardDirection(map, anchor);
	const forward = explicitForward ?? connectedForward;
	const selectedSide =
		(explicitSide ? sideChoice(forward ?? DIR_E, explicitSide) : null) ??
		chooseSide(anchor, pointer, forward ?? DIR_E) ??
		(preferredSide ? sideChoice(forward ?? DIR_E, preferredSide) : null);
	if (!connectedForward || !forward) {
		return invalidPlan(
			map,
			anchor,
			profileClass,
			selectedSide?.side ?? "right",
			"진행 방향의 열린 끝점에서만 2-in/2-out 스위치를 건설할 수 있습니다",
		);
	}
	if (!selectedSide) {
		return invalidPlan(
			map,
			anchor,
			profileClass,
			"right",
			"끝점의 왼쪽 또는 오른쪽으로 포인터를 이동해 스위치 방향을 선택하세요",
		);
	}
	const id = map.getNextAdvancedSwitchId();
	if (id === null) {
		return invalidPlan(
			map,
			anchor,
			profileClass,
			selectedSide.side,
			"고급 스위치 ID 공간을 모두 사용했습니다",
		);
	}

	const switchRecord: AdvancedSwitchRecord = {
		id,
		profileClass,
		origin: anchor,
		forward,
		lateral: selectedSide.direction,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
	const geometry = deriveAdvancedSwitchGeometry(switchRecord);
	const conflicts = new Map<string, Cell>();
	let reason = "2-in/2-out 스위치 배치 가능";
	let valid = true;
	const fail = (message: string, ...cells: readonly Cell[]): void => {
		if (valid) reason = message;
		valid = false;
		for (const cell of cells) conflicts.set(cellKey(cell.x, cell.y), cell);
	};
	if (connectedForward !== forward) {
		fail("선택한 회전 방향이 열린 끝점의 진행 방향과 맞지 않습니다", anchor);
	}

	const inputExtensions = new Map(
		geometry.inputs.map((port) => [cellKey(port.cell.x, port.cell.y), port.direction]),
	);
	const outputExtensions = new Map(
		geometry.outputs.map((port) => [cellKey(port.cell.x, port.cell.y), port.direction]),
	);
	const occupiedKeys = new Set(geometry.occupiedCells.map((cell) => cellKey(cell.x, cell.y)));
	for (const claimed of geometry.claimedCells) {
		const owner = map.getAdvancedSwitchOwningCell(claimed.x, claimed.y);
		if (owner) fail(`스위치 ${owner.id}의 전용 footprint와 겹칩니다`, claimed);
		if (
			!occupiedKeys.has(cellKey(claimed.x, claimed.y)) &&
			map.getEncoded(claimed.x, claimed.y) !== 0
		) {
			fail("스위치의 물리 곡선 예약 셀에는 다른 레일을 겹칠 수 없습니다", claimed);
		}
	}
	const mutations: RailMutation[] = [];
	for (const expected of geometry.cellStates) {
		const cell = { x: expected.x, y: expected.y };
		const key = cellKey(cell.x, cell.y);
		const owner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
		if (owner) {
			fail(`스위치 ${owner.id}의 전용 footprint와 겹칩니다`, cell);
		}

		const before = map.getEncoded(cell.x, cell.y);
		const actual = decodeRailCell(before);
		const allowedIncoming = expected.incoming | (inputExtensions.get(key) ?? 0);
		const allowedOutgoing = expected.outgoing | (outputExtensions.get(key) ?? 0);
		if ((actual.incoming & ~allowedIncoming) !== 0 || (actual.outgoing & ~allowedOutgoing) !== 0) {
			fail("스위치 내부 footprint에는 다른 레일을 겹칠 수 없습니다", cell);
		}
		const after = encodeRailCell({
			incoming: expected.incoming | (actual.incoming & (inputExtensions.get(key) ?? 0)),
			outgoing: expected.outgoing | (actual.outgoing & (outputExtensions.get(key) ?? 0)),
		});
		if (before !== after) mutations.push({ x: cell.x, y: cell.y, before, after });
	}

	const switchMutations: AdvancedSwitchMutation[] = [
		{ id: switchRecord.id, before: null, after: switchRecord },
	];
	const afterByCell = new Map(
		mutations.map((mutation) => [cellKey(mutation.x, mutation.y), mutation.after]),
	);
	const readAfter = (x: number, y: number): number =>
		afterByCell.get(cellKey(x, y)) ?? map.getEncoded(x, y);

	for (const issue of validateAdvancedSwitchPatch(map, mutations, switchMutations)) {
		fail(issue.message, ...issue.cells);
	}
	for (const issue of validatePlannedSwitchTurnouts(
		map,
		switchRecord,
		geometry.claimedCells,
		readAfter,
	)) {
		fail(issue.message, ...issue.cells);
	}

	const newEdges = mutations.reduce((sum, mutation) => {
		const before = decodeRailCell(mutation.before);
		const after = decodeRailCell(mutation.after);
		return sum + bitCount(after.outgoing) - bitCount(before.outgoing);
	}, 0);
	const routeLength = geometry.routes.reduce(
		(sum, route) => sum + Math.max(0, route.length - 1),
		0,
	);
	const turns = geometry.routes.reduce((sum, route) => sum + countTurns(route), 0);

	return {
		kind: "build",
		moduleKind: "advanced-switch",
		baseRevision: map.getRevision(),
		cells: geometry.claimedCells,
		mutations,
		switchMutations,
		valid,
		reason,
		conflicts: [...conflicts.values()],
		newEdges,
		lengthMeters: routeLength,
		turns,
		bend: forward === DIR_E || forward === DIR_W ? "horizontal-first" : "vertical-first",
		profileClass,
		side: selectedSide.side,
		entry: geometry.inputs[0].cell,
		exit: geometry.outputs[0].cell,
		secondaryInput: geometry.inputs[1].cell,
		secondaryOutput: geometry.outputs[1].cell,
		switchRecord,
	};
}

/** Replace profile/chirality in place while preserving the switch's stable identity. */
export function planAdvancedSwitchReshape(
	map: AdvancedSwitchPlanningMap,
	switchId: number,
	profileClass: AdvancedSwitchProfileClass,
	side?: AdvancedSwitchSide,
): AdvancedSwitchReplacementPlan {
	const beforeRecord = map.getAdvancedSwitch(switchId);
	if (!beforeRecord) {
		return invalidReplacementPlan(
			map,
			profileClass,
			side ?? "right",
			`스위치 ${switchId}를 찾을 수 없습니다`,
		);
	}
	const nextLateral =
		side === undefined
			? beforeRecord.lateral
			: side === "left"
				? leftDirection(beforeRecord.forward)
				: oppositeDirection(leftDirection(beforeRecord.forward));
	const afterRecord: AdvancedSwitchRecord = {
		...beforeRecord,
		profileClass,
		lateral: nextLateral,
	};
	if (
		beforeRecord.profileClass === afterRecord.profileClass &&
		beforeRecord.lateral === afterRecord.lateral
	) {
		return invalidReplacementPlan(
			map,
			profileClass,
			sideFor(beforeRecord.forward, beforeRecord.lateral),
			"스위치 형상이 이미 같은 설정입니다",
			beforeRecord,
		);
	}

	const beforeGeometry = deriveAdvancedSwitchGeometry(beforeRecord);
	const afterGeometry = deriveAdvancedSwitchGeometry(afterRecord);
	const beforeClaimKeys = new Set(
		beforeGeometry.claimedCells.map((cell) => cellKey(cell.x, cell.y)),
	);
	const afterClaimKeys = new Set(afterGeometry.claimedCells.map((cell) => cellKey(cell.x, cell.y)));
	const beforePorts = new Set(
		beforeGeometry.ports.map((port) =>
			switchPortKey(port.role, port.index, port.cell, port.direction),
		),
	);
	const afterPorts = new Set(
		afterGeometry.ports.map((port) =>
			switchPortKey(port.role, port.index, port.cell, port.direction),
		),
	);
	const overlay = new Map<string, RailMutation>();
	const conflicts = new Map<string, Cell>();
	let valid = true;
	let reason = "스위치 형상 변경 가능";
	const fail = (message: string, ...cells: readonly Cell[]): void => {
		if (valid) reason = message;
		valid = false;
		for (const cell of cells) conflicts.set(cellKey(cell.x, cell.y), cell);
	};
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

	for (const cell of beforeGeometry.occupiedCells) write(cell, 0);
	for (const port of beforeGeometry.ports) {
		if (afterPorts.has(switchPortKey(port.role, port.index, port.cell, port.direction))) continue;
		const portState = decodeRailCell(map.getEncoded(port.cell.x, port.cell.y));
		const hasExtension =
			port.role === "input"
				? (portState.incoming & port.direction) !== 0
				: (portState.outgoing & port.direction) !== 0;
		if (!hasExtension) continue;
		const neighbor = moveCell(port.cell, port.direction);
		fail("형상이 바뀌는 boundary port의 외부 레일을 먼저 철거하세요", port.cell, neighbor);
	}

	const inputExtensions = new Map(
		afterGeometry.inputs.map((port) => [cellKey(port.cell.x, port.cell.y), port.direction]),
	);
	const outputExtensions = new Map(
		afterGeometry.outputs.map((port) => [cellKey(port.cell.x, port.cell.y), port.direction]),
	);
	const afterOccupiedKeys = new Set(
		afterGeometry.occupiedCells.map((cell) => cellKey(cell.x, cell.y)),
	);
	for (const claimed of afterGeometry.claimedCells) {
		const owner = map.getAdvancedSwitchOwningCell(claimed.x, claimed.y);
		if (owner && owner.id !== switchId) {
			fail(`스위치 ${owner.id}의 전용 footprint와 겹칩니다`, claimed);
		}
	}
	for (const expected of afterGeometry.cellStates) {
		const cell = { x: expected.x, y: expected.y };
		const key = cellKey(cell.x, cell.y);
		const owner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
		if (owner && owner.id !== switchId) {
			fail(`스위치 ${owner.id}의 전용 footprint와 겹칩니다`, cell);
		}
		const sourceEncoded = map.getEncoded(cell.x, cell.y);
		const source = decodeRailCell(sourceEncoded);
		const incomingExtension = inputExtensions.get(key) ?? 0;
		const outgoingExtension = outputExtensions.get(key) ?? 0;
		if (!beforeClaimKeys.has(key)) {
			const allowedIncoming = expected.incoming | incomingExtension;
			const allowedOutgoing = expected.outgoing | outgoingExtension;
			if (
				(source.incoming & ~allowedIncoming) !== 0 ||
				(source.outgoing & ~allowedOutgoing) !== 0
			) {
				fail("변경할 스위치 footprint에 다른 레일이 있습니다", cell);
			}
		}
		const preserveIncoming =
			incomingExtension !== 0 &&
			(source.incoming & incomingExtension) !== 0 &&
			(!beforeClaimKeys.has(key) ||
				beforePorts.has(
					switchPortKey("input", inputPortIndex(afterGeometry, cell), cell, incomingExtension),
				));
		const preserveOutgoing =
			outgoingExtension !== 0 &&
			(source.outgoing & outgoingExtension) !== 0 &&
			(!beforeClaimKeys.has(key) ||
				beforePorts.has(
					switchPortKey("output", outputPortIndex(afterGeometry, cell), cell, outgoingExtension),
				));
		write(
			cell,
			encodeRailCell({
				incoming: expected.incoming | (preserveIncoming ? incomingExtension : 0),
				outgoing: expected.outgoing | (preserveOutgoing ? outgoingExtension : 0),
			}),
		);
	}
	for (const cell of beforeGeometry.occupiedCells) {
		if (!afterClaimKeys.has(cellKey(cell.x, cell.y))) write(cell, 0);
	}
	for (const claimed of afterGeometry.claimedCells) {
		if (afterOccupiedKeys.has(cellKey(claimed.x, claimed.y))) continue;
		const after =
			overlay.get(cellKey(claimed.x, claimed.y))?.after ?? map.getEncoded(claimed.x, claimed.y);
		if (after !== 0) {
			fail("변경할 스위치의 물리 곡선 예약 셀에 다른 레일이 있습니다", claimed);
		}
	}

	const mutations = [...overlay.values()].filter((mutation) => mutation.before !== mutation.after);
	const switchMutations: AdvancedSwitchMutation[] = [
		{ id: switchId, before: beforeRecord, after: afterRecord },
	];
	for (const issue of validateAdvancedSwitchPatch(map, mutations, switchMutations)) {
		fail(issue.message, ...issue.cells);
	}
	const readAfter = (x: number, y: number): number =>
		overlay.get(cellKey(x, y))?.after ?? map.getEncoded(x, y);
	for (const issue of validatePlannedSwitchTurnouts(
		map,
		afterRecord,
		[...beforeGeometry.claimedCells, ...afterGeometry.claimedCells],
		readAfter,
	)) {
		fail(issue.message, ...issue.cells);
	}

	const newEdges = mutations.reduce((sum, mutation) => {
		return (
			sum +
			bitCount(decodeRailCell(mutation.after).outgoing) -
			bitCount(decodeRailCell(mutation.before).outgoing)
		);
	}, 0);
	return {
		kind: "edit",
		moduleKind: "advanced-switch",
		baseRevision: map.getRevision(),
		cells: uniqueCells([...beforeGeometry.claimedCells, ...afterGeometry.claimedCells]),
		mutations,
		switchMutations,
		valid,
		reason,
		conflicts: [...conflicts.values()],
		newEdges,
		lengthMeters: afterGeometry.routes.reduce(
			(sum, route) => sum + Math.max(0, route.length - 1),
			0,
		),
		turns: afterGeometry.routes.reduce((sum, route) => sum + countTurns(route), 0),
		bend:
			beforeRecord.forward === DIR_E || beforeRecord.forward === DIR_W
				? "horizontal-first"
				: "vertical-first",
		profileClass,
		side: sideFor(afterRecord.forward, afterRecord.lateral),
		previousSwitchRecord: beforeRecord,
		switchRecord: afterRecord,
	};
}

function chooseSide(
	anchor: Cell,
	pointer: Cell,
	forward: Direction,
): { side: AdvancedSwitchSide; direction: Direction } | null {
	const left = leftDirection(forward);
	const vector = directionVector(left);
	const projection = (pointer.x - anchor.x) * vector.x + (pointer.y - anchor.y) * vector.y;
	if (projection === 0) return null;
	return projection > 0
		? { side: "left", direction: left }
		: { side: "right", direction: oppositeDirection(left) };
}

function sideChoice(
	forward: Direction,
	side: AdvancedSwitchSide,
): { side: AdvancedSwitchSide; direction: Direction } {
	const left = leftDirection(forward);
	return side === "left" ? { side, direction: left } : { side, direction: oppositeDirection(left) };
}

function leftDirection(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_W;
	if (direction === DIR_E) return DIR_N;
	if (direction === DIR_S) return DIR_E;
	return DIR_S;
}

function directionVector(direction: Direction): Cell {
	if (direction === DIR_N) return { x: 0, y: -1 };
	if (direction === DIR_E) return { x: 1, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function countTurns(route: readonly Cell[]): number {
	let turns = 0;
	let previous: Direction | null = null;
	for (let index = 0; index < route.length - 1; index++) {
		const direction = directionBetween(route[index] as Cell, route[index + 1] as Cell);
		if (direction !== null && previous !== null && direction !== previous) turns++;
		previous = direction;
	}
	return turns;
}

function validatePlannedSwitchTurnouts(
	map: AdvancedSwitchPlanningMap,
	switchRecord: AdvancedSwitchRecord,
	changedCells: readonly Cell[],
	readEncoded: (x: number, y: number) => number,
) {
	const readRail = (x: number, y: number) => decodeRailCell(readEncoded(x, y));
	const footprints = collectAffectedTurnoutFootprints(readRail, changedCells);
	const nearbySwitches = new Map<number, AdvancedSwitchRecord>([[switchRecord.id, switchRecord]]);
	for (const footprint of footprints) {
		for (const cell of footprint.reservedCells) {
			const owner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
			if (owner) nearbySwitches.set(owner.id, owner.id === switchRecord.id ? switchRecord : owner);
		}
	}
	return validateTurnoutFootprints(readRail, footprints, [...nearbySwitches.values()]);
}

function inputPortIndex(
	geometry: ReturnType<typeof deriveAdvancedSwitchGeometry>,
	cell: Cell,
): 0 | 1 {
	return geometry.inputs.find((port) => sameCell(port.cell, cell))?.index ?? 0;
}

function outputPortIndex(
	geometry: ReturnType<typeof deriveAdvancedSwitchGeometry>,
	cell: Cell,
): 0 | 1 {
	return geometry.outputs.find((port) => sameCell(port.cell, cell))?.index ?? 0;
}

function switchPortKey(
	role: "input" | "output",
	index: 0 | 1,
	cell: Cell,
	direction: Direction,
): string {
	return `${role}:${index}:${cellKey(cell.x, cell.y)}:${direction}`;
}

function sideFor(forward: Direction, lateral: Direction): AdvancedSwitchSide {
	return lateral === leftDirection(forward) ? "left" : "right";
}

function sameCell(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}

function uniqueCells(cells: readonly Cell[]): Cell[] {
	const unique = new Map<string, Cell>();
	for (const cell of cells) unique.set(cellKey(cell.x, cell.y), cell);
	return [...unique.values()];
}

function invalidPlan(
	map: AdvancedSwitchPlanningMap,
	anchor: Cell,
	profileClass: AdvancedSwitchProfileClass,
	side: AdvancedSwitchSide,
	reason: string,
): AdvancedSwitchPlan {
	return {
		kind: "build",
		moduleKind: "advanced-switch",
		baseRevision: map.getRevision(),
		cells: [anchor],
		mutations: [],
		switchMutations: [],
		valid: false,
		reason,
		conflicts: [anchor],
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
		profileClass,
		side,
		entry: anchor,
		exit: anchor,
		secondaryInput: anchor,
		secondaryOutput: anchor,
		switchRecord: null,
	};
}

function invalidReplacementPlan(
	map: AdvancedSwitchPlanningMap,
	profileClass: AdvancedSwitchProfileClass,
	side: AdvancedSwitchSide,
	reason: string,
	previousSwitchRecord: AdvancedSwitchRecord | null = null,
): AdvancedSwitchReplacementPlan {
	const cell = previousSwitchRecord?.origin ?? { x: 0, y: 0 };
	return {
		kind: "edit",
		moduleKind: "advanced-switch",
		baseRevision: map.getRevision(),
		cells: [cell],
		mutations: [],
		switchMutations: [],
		valid: false,
		reason,
		conflicts: [cell],
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
		profileClass,
		side,
		previousSwitchRecord,
		switchRecord: null,
	};
}
