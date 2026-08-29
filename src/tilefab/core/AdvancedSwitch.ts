import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	directionBetween,
	oppositeDirection,
} from "./railShape";
import type { Cell } from "./TileMap";

export const ADVANCED_SWITCH_PROFILE_CLASSES = ["A", "B", "C", "D"] as const;

export type AdvancedSwitchProfileClass = (typeof ADVANCED_SWITCH_PROFILE_CLASSES)[number];
export type AdvancedSwitchPortIndex = 0 | 1;

export const ADVANCED_SWITCH_ALL_MOVEMENTS = 0b1111;
export const ADVANCED_SWITCH_MAX_ID = 0x7fff_ffff;

export interface AdvancedSwitchRecord {
	readonly id: number;
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly origin: Cell;
	readonly forward: Direction;
	readonly lateral: Direction;
	/** Bit `(inputIndex * 2 + outputIndex)` authorizes that directed movement. */
	readonly movementMask: number;
}

export type AdvancedSwitch = AdvancedSwitchRecord;

export interface AdvancedSwitchMutation {
	readonly id: number;
	readonly before: AdvancedSwitchRecord | null;
	readonly after: AdvancedSwitchRecord | null;
}

export interface AdvancedSwitchBoundaryPort {
	readonly role: "input" | "output";
	readonly index: AdvancedSwitchPortIndex;
	readonly cell: Cell;
	/** Cell side facing away from the owned module. */
	readonly direction: Direction;
}

export interface AdvancedSwitchCellState extends Cell {
	readonly incoming: number;
	readonly outgoing: number;
	readonly encoded: number;
}

export interface AdvancedSwitchGeometry {
	readonly mergeAnchor: Cell;
	readonly branchAnchor: Cell;
	readonly sharedTrunkSupport: Cell;
	readonly mainPath: readonly Cell[];
	readonly secondaryInputPath: readonly Cell[];
	readonly secondaryOutputPath: readonly Cell[];
	readonly routes: readonly (readonly Cell[])[];
	readonly inputs: readonly [AdvancedSwitchBoundaryPort, AdvancedSwitchBoundaryPort];
	readonly outputs: readonly [AdvancedSwitchBoundaryPort, AdvancedSwitchBoundaryPort];
	readonly ports: readonly AdvancedSwitchBoundaryPort[];
	readonly occupiedCells: readonly Cell[];
	readonly reservedCells: readonly Cell[];
	readonly claimedCells: readonly Cell[];
	readonly cellStates: readonly AdvancedSwitchCellState[];
}

export interface AdvancedSwitchSharedTrunkProfile {
	readonly id: string;
	readonly supportLengthMeters: number;
	readonly mergeSharedLeadMeters: number;
	readonly clearTrunkMeters: number;
	readonly branchSharedLeadMeters: number;
	readonly mergeProfileId: string;
	readonly branchProfileId: string;
}

export const ADVANCED_SWITCH_SHARED_TRUNK_PROFILE: AdvancedSwitchSharedTrunkProfile = Object.freeze(
	{
		id: "OPENFAB_ADVANCED_SHARED_400_200_400_V1",
		supportLengthMeters: 1,
		mergeSharedLeadMeters: 0.4,
		clearTrunkMeters: 0.2,
		branchSharedLeadMeters: 0.4,
		mergeProfileId: "OPENFAB_ADVANCED_MERGE_V1",
		branchProfileId: "OPENFAB_ADVANCED_BRANCH_V1",
	},
);

export function advancedSwitchMovementBit(
	inputIndex: AdvancedSwitchPortIndex,
	outputIndex: AdvancedSwitchPortIndex,
): number {
	return 1 << (inputIndex * 2 + outputIndex);
}

export function advancedSwitchAllowsMovement(
	switchRecord: AdvancedSwitchRecord,
	inputIndex: AdvancedSwitchPortIndex,
	outputIndex: AdvancedSwitchPortIndex,
): boolean {
	return (switchRecord.movementMask & advancedSwitchMovementBit(inputIndex, outputIndex)) !== 0;
}

export function advancedSwitchRecordError(switchRecord: AdvancedSwitchRecord): string | null {
	if (
		!Number.isInteger(switchRecord.id) ||
		switchRecord.id <= 0 ||
		switchRecord.id > ADVANCED_SWITCH_MAX_ID
	) {
		return "advanced switch id must be a positive signed int32";
	}
	if (!ADVANCED_SWITCH_PROFILE_CLASSES.includes(switchRecord.profileClass)) {
		return "advanced switch profile class must be A, B, C, or D";
	}
	if (!Number.isInteger(switchRecord.origin.x) || !Number.isInteger(switchRecord.origin.y)) {
		return "advanced switch origin must use integer cells";
	}
	if (!isDirection(switchRecord.forward) || !isDirection(switchRecord.lateral)) {
		return "advanced switch orientation must use cardinal directions";
	}
	if (
		switchRecord.lateral === switchRecord.forward ||
		switchRecord.lateral === oppositeDirection(switchRecord.forward)
	) {
		return "advanced switch lateral direction must be perpendicular to forward";
	}
	if (
		!Number.isInteger(switchRecord.movementMask) ||
		switchRecord.movementMask !== ADVANCED_SWITCH_ALL_MOVEMENTS
	) {
		return "advanced switches require all four K2,2 movements";
	}
	return null;
}

export function copyAdvancedSwitch(switchRecord: AdvancedSwitchRecord): AdvancedSwitchRecord {
	const error = advancedSwitchRecordError(switchRecord);
	if (error) throw new TypeError(error);
	return Object.freeze({
		id: switchRecord.id,
		profileClass: switchRecord.profileClass,
		origin: Object.freeze({ x: switchRecord.origin.x, y: switchRecord.origin.y }),
		forward: switchRecord.forward,
		lateral: switchRecord.lateral,
		movementMask: switchRecord.movementMask,
	});
}

export function advancedSwitchEquals(
	left: AdvancedSwitchRecord | null | undefined,
	right: AdvancedSwitchRecord | null | undefined,
): boolean {
	if (!left || !right) return left == null && right == null;
	return (
		left.id === right.id &&
		left.profileClass === right.profileClass &&
		left.origin.x === right.origin.x &&
		left.origin.y === right.origin.y &&
		left.forward === right.forward &&
		left.lateral === right.lateral &&
		left.movementMask === right.movementMask
	);
}

export function deriveAdvancedSwitchGeometry(
	switchRecord: AdvancedSwitchRecord,
): AdvancedSwitchGeometry {
	const error = advancedSwitchRecordError(switchRecord);
	if (error) throw new TypeError(error);

	const { origin, forward, lateral, profileClass } = switchRecord;
	const at = (forwardOffset: number, lateralOffset = 0): Cell =>
		offsetCell(origin, forward, forwardOffset, lateral, lateralOffset);
	const mergeAnchor = at(2);
	const sharedTrunkSupport = at(3);
	const branchAnchor = at(4);
	const inputIsParallel = profileClass === "A" || profileClass === "B";
	const outputIsParallel = profileClass === "B" || profileClass === "D";

	const mainPath = Array.from({ length: 7 }, (_, distance) => at(distance));
	const secondaryInputPath = inputIsParallel
		? [at(0, 2), at(1, 2), at(2, 2), at(2, 1), mergeAnchor]
		: [at(2, 3), at(2, 2), at(2, 1), mergeAnchor];
	const secondaryOutputPath = outputIsParallel
		? [branchAnchor, at(4, 1), at(4, 2), at(5, 2), at(6, 2)]
		: [branchAnchor, at(4, 1), at(4, 2), at(4, 3)];
	const routes = [mainPath, secondaryInputPath, secondaryOutputPath] as const;
	const occupiedCells = uniqueCells(routes.flat());
	const catalogSweepCells = [
		...(inputIsParallel ? [at(1, 1)] : []),
		...(outputIsParallel ? [at(5, 1)] : []),
	];
	const reservedCells = uniqueCells([
		at(2, 1),
		mergeAnchor,
		sharedTrunkSupport,
		branchAnchor,
		at(4, 1),
		...catalogSweepCells,
	]);
	const claimedCells = uniqueCells([...occupiedCells, ...reservedCells]);
	const inputs: [AdvancedSwitchBoundaryPort, AdvancedSwitchBoundaryPort] = [
		{ role: "input", index: 0, cell: origin, direction: oppositeDirection(forward) },
		{
			role: "input",
			index: 1,
			cell: inputIsParallel ? at(0, 2) : at(2, 3),
			direction: inputIsParallel ? oppositeDirection(forward) : lateral,
		},
	];
	const outputs: [AdvancedSwitchBoundaryPort, AdvancedSwitchBoundaryPort] = [
		{ role: "output", index: 0, cell: at(6), direction: forward },
		{
			role: "output",
			index: 1,
			cell: outputIsParallel ? at(6, 2) : at(4, 3),
			direction: outputIsParallel ? forward : lateral,
		},
	];
	const states = new Map<string, { cell: Cell; incoming: number; outgoing: number }>();
	for (const route of routes) addRouteStates(states, route);
	const cellStates = occupiedCells.map((cell) => {
		const state = states.get(coordinateKey(cell.x, cell.y));
		if (!state) throw new Error("advanced switch route state is incomplete");
		return {
			x: cell.x,
			y: cell.y,
			incoming: state.incoming,
			outgoing: state.outgoing,
			encoded: encode(state.incoming, state.outgoing),
		};
	});

	return {
		mergeAnchor,
		branchAnchor,
		sharedTrunkSupport,
		mainPath,
		secondaryInputPath,
		secondaryOutputPath,
		routes,
		inputs,
		outputs,
		ports: [...inputs, ...outputs],
		occupiedCells,
		reservedCells,
		claimedCells,
		cellStates,
	};
}

export interface AdvancedSwitchTopologyIssue {
	readonly code:
		| "INVALID_RECORD"
		| "INVALID_CELL_MUTATION"
		| "INVALID_SWITCH_MUTATION"
		| "CLAIM_CONFLICT"
		| "TOPOLOGY_MISMATCH"
		| "INCOMPLETE_ERASE";
	readonly message: string;
	readonly cells: readonly Cell[];
	readonly switchIds: readonly number[];
}

export interface AdvancedSwitchCellMutation {
	readonly x: number;
	readonly y: number;
	readonly before: number;
	readonly after: number;
}

export interface AdvancedSwitchMapReader {
	getEncoded(x: number, y: number): number;
	getAdvancedSwitch(id: number): AdvancedSwitchRecord | undefined;
	getAdvancedSwitchOwningCell(x: number, y: number): AdvancedSwitchRecord | undefined;
}

export function validateAdvancedSwitchTopology(
	readEncoded: (x: number, y: number) => number,
	switchRecord: AdvancedSwitchRecord,
): AdvancedSwitchTopologyIssue[] {
	const recordError = advancedSwitchRecordError(switchRecord);
	if (recordError) {
		return [
			{
				code: "INVALID_RECORD",
				message: recordError,
				cells: [switchRecord.origin],
				switchIds: [switchRecord.id],
			},
		];
	}

	const geometry = deriveAdvancedSwitchGeometry(switchRecord);
	const allowedIncoming = new Map<string, number>();
	const allowedOutgoing = new Map<string, number>();
	for (const port of geometry.inputs) {
		allowedIncoming.set(coordinateKey(port.cell.x, port.cell.y), port.direction);
	}
	for (const port of geometry.outputs) {
		allowedOutgoing.set(coordinateKey(port.cell.x, port.cell.y), port.direction);
	}

	const issues: AdvancedSwitchTopologyIssue[] = [];
	const occupiedKeys = new Set(geometry.occupiedCells.map((cell) => coordinateKey(cell.x, cell.y)));
	for (const expected of geometry.cellStates) {
		const key = coordinateKey(expected.x, expected.y);
		const actual = decode(readEncoded(expected.x, expected.y));
		const incomingExtension = allowedIncoming.get(key) ?? 0;
		const outgoingExtension = allowedOutgoing.get(key) ?? 0;
		const incomingValid =
			actual.incoming === expected.incoming ||
			actual.incoming === (expected.incoming | incomingExtension);
		const outgoingValid =
			actual.outgoing === expected.outgoing ||
			actual.outgoing === (expected.outgoing | outgoingExtension);
		if (!incomingValid || !outgoingValid) {
			issues.push({
				code: "TOPOLOGY_MISMATCH",
				message:
					"advanced switch 내부 셀은 변경할 수 없고 네 개 boundary port만 연장할 수 있습니다",
				cells: [{ x: expected.x, y: expected.y }],
				switchIds: [switchRecord.id],
			});
		}
	}
	for (const claimed of geometry.claimedCells) {
		if (occupiedKeys.has(coordinateKey(claimed.x, claimed.y))) continue;
		if (readEncoded(claimed.x, claimed.y) !== 0) {
			issues.push({
				code: "TOPOLOGY_MISMATCH",
				message: "advanced switch의 물리 곡선 예약 셀에는 다른 레일을 놓을 수 없습니다",
				cells: [claimed],
				switchIds: [switchRecord.id],
			});
		}
	}
	return issues;
}

/**
 * Validate cell and sidecar changes together against the source map. Existing modules are checked
 * only when their claimed cells are touched, so unrelated sparse cells do not affect plan cost.
 */
export function validateAdvancedSwitchPatch(
	map: AdvancedSwitchMapReader,
	cellMutations: readonly AdvancedSwitchCellMutation[],
	switchMutations: readonly AdvancedSwitchMutation[] = [],
): AdvancedSwitchTopologyIssue[] {
	const issues: AdvancedSwitchTopologyIssue[] = [];
	const cellsAfter = new Map<string, number>();
	const changedCells = new Set<string>();
	for (const mutation of cellMutations) {
		const key = coordinateKey(mutation.x, mutation.y);
		if (
			changedCells.has(key) ||
			mutation.before !== map.getEncoded(mutation.x, mutation.y) ||
			mutation.before === mutation.after ||
			!Number.isInteger(mutation.after) ||
			mutation.after < 0 ||
			mutation.after > 0xff
		) {
			issues.push({
				code: "INVALID_CELL_MUTATION",
				message: "advanced switch patch의 셀 before/after 값이 현재 맵과 일치하지 않습니다",
				cells: [{ x: mutation.x, y: mutation.y }],
				switchIds: [],
			});
		}
		changedCells.add(key);
		cellsAfter.set(key, mutation.after & 0xff);
	}

	const changesById = new Map<number, AdvancedSwitchMutation>();
	for (const mutation of switchMutations) {
		const current = map.getAdvancedSwitch(mutation.id);
		const recordError = mutation.after ? advancedSwitchRecordError(mutation.after) : null;
		if (
			changesById.has(mutation.id) ||
			(mutation.before?.id ?? mutation.id) !== mutation.id ||
			(mutation.after?.id ?? mutation.id) !== mutation.id ||
			!advancedSwitchEquals(current, mutation.before) ||
			advancedSwitchEquals(mutation.before, mutation.after) ||
			recordError
		) {
			issues.push({
				code: recordError ? "INVALID_RECORD" : "INVALID_SWITCH_MUTATION",
				message:
					recordError ??
					"advanced switch patch의 metadata before/after 값이 현재 맵과 일치하지 않습니다",
				cells: [mutation.after?.origin ?? mutation.before?.origin ?? { x: 0, y: 0 }],
				switchIds: [mutation.id],
			});
		}
		changesById.set(mutation.id, mutation);
	}

	const readAfter = (x: number, y: number): number =>
		cellsAfter.get(coordinateKey(x, y)) ?? map.getEncoded(x, y);
	const affected = new Map<number, AdvancedSwitchRecord>();
	for (const mutation of cellMutations) {
		const owner = map.getAdvancedSwitchOwningCell(mutation.x, mutation.y);
		if (owner) affected.set(owner.id, owner);
	}
	for (const mutation of switchMutations) {
		if (mutation.before) affected.set(mutation.before.id, mutation.before);
		if (mutation.after) affected.set(mutation.after.id, mutation.after);
	}

	const finalRecord = (id: number): AdvancedSwitchRecord | null => {
		const mutation = changesById.get(id);
		return mutation ? mutation.after : (map.getAdvancedSwitch(id) ?? null);
	};

	const pendingClaims = new Map<string, AdvancedSwitchRecord>();
	for (const mutation of switchMutations) {
		const after = mutation.after;
		if (!after || advancedSwitchRecordError(after)) continue;
		for (const cell of deriveAdvancedSwitchGeometry(after).claimedCells) {
			const key = coordinateKey(cell.x, cell.y);
			const pendingOwner = pendingClaims.get(key);
			const sourceOwner = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
			const sourceOwnerFinal = sourceOwner ? finalRecord(sourceOwner.id) : null;
			const sourceOwnerStillClaims =
				sourceOwnerFinal !== null &&
				deriveAdvancedSwitchGeometry(sourceOwnerFinal).claimedCells.some(
					(claimed) => claimed.x === cell.x && claimed.y === cell.y,
				);
			if (
				(pendingOwner && pendingOwner.id !== after.id) ||
				(sourceOwnerStillClaims && sourceOwnerFinal.id !== after.id)
			) {
				const other = pendingOwner ?? (sourceOwnerStillClaims ? sourceOwnerFinal : null);
				issues.push({
					code: "CLAIM_CONFLICT",
					message: "advanced switch footprint는 다른 switch가 소유한 셀과 겹칠 수 없습니다",
					cells: [cell],
					switchIds: other ? [after.id, other.id] : [after.id],
				});
			}
			pendingClaims.set(key, after);
		}
	}

	for (const [id, touchedRecord] of affected) {
		const mutation = changesById.get(id);
		const after = finalRecord(id);
		if (mutation?.before) {
			const beforeGeometry = deriveAdvancedSwitchGeometry(mutation.before);
			const afterClaims = new Set(
				after
					? deriveAdvancedSwitchGeometry(after).claimedCells.map((cell) =>
							coordinateKey(cell.x, cell.y),
						)
					: [],
			);
			for (const cell of beforeGeometry.occupiedCells) {
				const key = coordinateKey(cell.x, cell.y);
				const replacementOwner = pendingClaims.get(key);
				const remaining = readAfter(cell.x, cell.y);
				if (
					!afterClaims.has(key) &&
					remaining !== 0 &&
					!isRemovedSwitchBoundaryRemainder(beforeGeometry, cell, remaining) &&
					(!replacementOwner || replacementOwner.id === id)
				) {
					issues.push({
						code: "INCOMPLETE_ERASE",
						message:
							"advanced switch metadata를 제거할 때는 소유한 module 전체를 함께 철거해야 합니다",
						cells: [cell],
						switchIds: [id],
					});
				}
			}
		}
		if (after) issues.push(...validateAdvancedSwitchTopology(readAfter, after));
		else if (!mutation) issues.push(...validateAdvancedSwitchTopology(readAfter, touchedRecord));
	}

	return deduplicateIssues(issues);
}

function isRemovedSwitchBoundaryRemainder(
	geometry: AdvancedSwitchGeometry,
	cell: Cell,
	encoded: number,
): boolean {
	const port = geometry.ports.find(
		(candidate) => candidate.cell.x === cell.x && candidate.cell.y === cell.y,
	);
	if (!port) return false;
	return encoded === (port.role === "input" ? port.direction : port.direction << 4);
}

function addRouteStates(
	states: Map<string, { cell: Cell; incoming: number; outgoing: number }>,
	route: readonly Cell[],
): void {
	for (let index = 0; index < route.length - 1; index++) {
		const from = route[index] as Cell;
		const to = route[index + 1] as Cell;
		const direction = directionBetween(from, to);
		if (!direction) throw new Error("advanced switch routes must be cardinal and adjacent");
		const opposite = oppositeDirection(direction);
		const fromState = getRouteState(states, from);
		const toState = getRouteState(states, to);
		fromState.outgoing |= direction;
		toState.incoming |= opposite;
	}
}

function getRouteState(
	states: Map<string, { cell: Cell; incoming: number; outgoing: number }>,
	cell: Cell,
): { cell: Cell; incoming: number; outgoing: number } {
	const key = coordinateKey(cell.x, cell.y);
	const existing = states.get(key);
	if (existing) return existing;
	const created = { cell, incoming: 0, outgoing: 0 };
	states.set(key, created);
	return created;
}

function uniqueCells(cells: readonly Cell[]): Cell[] {
	const unique = new Map<string, Cell>();
	for (const cell of cells) {
		const key = coordinateKey(cell.x, cell.y);
		if (!unique.has(key)) unique.set(key, { x: cell.x, y: cell.y });
	}
	return [...unique.values()];
}

function offsetCell(
	origin: Cell,
	forward: Direction,
	forwardOffset: number,
	lateral: Direction,
	lateralOffset: number,
): Cell {
	const forwardVector = directionVector(forward);
	const lateralVector = directionVector(lateral);
	return {
		x: origin.x + forwardVector.x * forwardOffset + lateralVector.x * lateralOffset,
		y: origin.y + forwardVector.y * forwardOffset + lateralVector.y * lateralOffset,
	};
}

function directionVector(direction: Direction): Cell {
	if (direction === 1) return { x: 0, y: -1 };
	if (direction === 2) return { x: 1, y: 0 };
	if (direction === 4) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function isDirection(value: number): value is Direction {
	return ALL_DIRECTIONS.includes(value as Direction) && bitCount(value) === 1;
}

function coordinateKey(x: number, y: number): string {
	return `${x},${y}`;
}

function encode(incoming: number, outgoing: number): number {
	return ((outgoing & 15) << 4) | (incoming & 15);
}

function decode(encoded: number): { incoming: number; outgoing: number } {
	return { incoming: encoded & 15, outgoing: (encoded >> 4) & 15 };
}

function deduplicateIssues(
	issues: readonly AdvancedSwitchTopologyIssue[],
): AdvancedSwitchTopologyIssue[] {
	const unique = new Map<string, AdvancedSwitchTopologyIssue>();
	for (const issue of issues) {
		const key = `${issue.code}:${issue.switchIds.join(",")}:${issue.cells
			.map((cell) => coordinateKey(cell.x, cell.y))
			.join("|")}`;
		if (!unique.has(key)) unique.set(key, issue);
	}
	return [...unique.values()];
}
