import type { Cell } from "../core/TileMap";

export type InspectAreaKeyboardDirection = "up" | "down" | "left" | "right";

/** Inclusive authored-cell limits for one transient keyboard selection session. */
export interface InspectAreaKeyboardBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface InspectAreaKeyboardCurrentIdentity {
	readonly modelGeneration: number;
	readonly revision: number;
	readonly patchSequence: number;
}

/**
 * Ephemeral Inspect state. It is never part of the serializable project model or edit history.
 */
export interface InspectAreaKeyboardSession extends InspectAreaKeyboardCurrentIdentity {
	readonly start: Cell;
	readonly current: Cell;
	readonly bounds: InspectAreaKeyboardBounds;
}

export interface InspectAreaKeyboardSessionInput extends InspectAreaKeyboardCurrentIdentity {
	readonly start: Cell;
	readonly bounds: InspectAreaKeyboardBounds;
}

export interface InspectAreaKeyboardReadout {
	readonly summary: string;
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly widthCells: number;
	readonly heightCells: number;
}

export function createInspectAreaKeyboardSession(
	input: InspectAreaKeyboardSessionInput,
): InspectAreaKeyboardSession {
	const identity = copyIdentity(input);
	const bounds = normalizeInspectAreaKeyboardBounds(input.bounds);
	const start = clampInspectAreaKeyboardCell(input.start, bounds);
	return Object.freeze({
		...identity,
		start,
		current: start,
		bounds,
	});
}

/** Move the active corner exactly one authored metre, clamped to the session limits. */
export function moveInspectAreaKeyboardSession(
	session: InspectAreaKeyboardSession,
	direction: InspectAreaKeyboardDirection,
): InspectAreaKeyboardSession {
	const delta = directionDelta(direction);
	const current = clampInspectAreaKeyboardCell(
		{
			x: session.current.x + delta.x,
			y: session.current.y + delta.y,
		},
		session.bounds,
	);
	if (current.x === session.current.x && current.y === session.current.y) return session;
	return Object.freeze({ ...session, current });
}

/** Clamp one integer authored cell to validated inclusive limits. */
export function clampInspectAreaKeyboardCell(cell: Cell, bounds: InspectAreaKeyboardBounds): Cell {
	const normalized = normalizeInspectAreaKeyboardBounds(bounds);
	assertCell(cell);
	return Object.freeze({
		x: Math.min(normalized.maxX, Math.max(normalized.minX, cell.x)),
		y: Math.min(normalized.maxY, Math.max(normalized.minY, cell.y)),
	});
}

export function inspectAreaKeyboardSessionIsCurrent(
	session: InspectAreaKeyboardSession,
	current: InspectAreaKeyboardCurrentIdentity,
): boolean {
	if (!validIdentity(current)) return false;
	return (
		session.modelGeneration === current.modelGeneration &&
		session.revision === current.revision &&
		session.patchSequence === current.patchSequence
	);
}

/** Stable text and normalized inclusive rectangle for Canvas description/live presentation. */
export function inspectAreaKeyboardSessionReadout(
	session: InspectAreaKeyboardSession,
): InspectAreaKeyboardReadout {
	const minX = Math.min(session.start.x, session.current.x);
	const minY = Math.min(session.start.y, session.current.y);
	const maxX = Math.max(session.start.x, session.current.x);
	const maxY = Math.max(session.start.y, session.current.y);
	const widthCells = maxX - minX + 1;
	const heightCells = maxY - minY + 1;
	return Object.freeze({
		summary: `키보드 부분 영역 선택 · 시작 X ${session.start.x}미터 · Z ${session.start.y}미터 · 현재 X ${session.current.x}미터 · Z ${session.current.y}미터 · 범위 ${widthCells} × ${heightCells}셀`,
		minX,
		minY,
		maxX,
		maxY,
		widthCells,
		heightCells,
	});
}

function normalizeInspectAreaKeyboardBounds(
	bounds: InspectAreaKeyboardBounds,
): InspectAreaKeyboardBounds {
	if (
		!Number.isFinite(bounds.minX) ||
		!Number.isFinite(bounds.minY) ||
		!Number.isFinite(bounds.maxX) ||
		!Number.isFinite(bounds.maxY)
	) {
		throw new RangeError("Inspect area keyboard bounds must be finite.");
	}
	const minX = Math.ceil(bounds.minX);
	const minY = Math.ceil(bounds.minY);
	const maxX = Math.floor(bounds.maxX);
	const maxY = Math.floor(bounds.maxY);
	if (minX > maxX || minY > maxY) {
		throw new RangeError("Inspect area keyboard bounds contain no authored cells.");
	}
	return Object.freeze({ minX, minY, maxX, maxY });
}

function copyIdentity(
	identity: InspectAreaKeyboardCurrentIdentity,
): InspectAreaKeyboardCurrentIdentity {
	if (!validIdentity(identity)) {
		throw new RangeError(
			"Inspect area keyboard identity must use non-negative safe integer values.",
		);
	}
	return Object.freeze({
		modelGeneration: identity.modelGeneration,
		revision: identity.revision,
		patchSequence: identity.patchSequence,
	});
}

function validIdentity(identity: InspectAreaKeyboardCurrentIdentity): boolean {
	return (
		isNonNegativeSafeInteger(identity.modelGeneration) &&
		isNonNegativeSafeInteger(identity.revision) &&
		isNonNegativeSafeInteger(identity.patchSequence)
	);
}

function isNonNegativeSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function assertCell(cell: Cell): void {
	if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) {
		throw new RangeError("Inspect area keyboard cells must use safe integer coordinates.");
	}
}

function directionDelta(direction: InspectAreaKeyboardDirection): Cell {
	if (direction === "up") return { x: 0, y: -1 };
	if (direction === "down") return { x: 0, y: 1 };
	if (direction === "left") return { x: -1, y: 0 };
	return { x: 1, y: 0 };
}
