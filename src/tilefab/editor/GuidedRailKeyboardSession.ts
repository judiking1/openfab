import type { RailDocument } from "../core/RailDocument";
import { terminalForwardDirection } from "../core/RailModulePlanner";
import type { Cell, TileMap } from "../core/TileMap";

export type GuidedRailKeyboardMission = "first-rail" | "process-loop";
export type RailKeyboardScope = "guided" | "ordinary";
export type GuidedRailKeyboardPhase = "choose-start" | "choose-end";
export type GuidedRailKeyboardDirection = "up" | "down" | "left" | "right";

export interface GuidedRailKeyboardBinding {
	readonly modelGeneration: number;
	readonly document: RailDocument;
	readonly map: TileMap;
	readonly revision: number;
	readonly patchSequence: number;
}

interface RailKeyboardSessionBase {
	readonly scope: RailKeyboardScope;
	readonly phase: GuidedRailKeyboardPhase;
	readonly source: Cell | null;
	readonly endpoint: Cell;
	readonly binding: GuidedRailKeyboardBinding;
}

export type GuidedRailKeyboardSession =
	| (RailKeyboardSessionBase & {
			readonly scope: "guided";
			readonly mission: GuidedRailKeyboardMission;
	  })
	| (RailKeyboardSessionBase & {
			readonly scope: "ordinary";
			readonly mission: null;
	  });

export interface GuidedRailKeyboardEndpointEvaluation {
	readonly lengthMeters: number;
	readonly valid: boolean;
	readonly reason: string;
}

export interface GuidedRailKeyboardAccessiblePresentation {
	readonly summary: string;
	readonly validityKey: string;
}

export function guidedRailKeyboardOperationInstruction(phase: GuidedRailKeyboardPhase): string {
	return phase === "choose-start"
		? "방향키로 시작점을 1미터씩, Shift와 방향키로 5미터씩 옮기고 Enter로 선택하세요. Esc는 미확정 위치만 취소합니다."
		: "방향키로 끝점을 1미터씩, Shift와 방향키로 5미터씩 옮기고 Enter로 구간을 확정하세요. Esc는 미확정 구간만 취소합니다.";
}

export function railKeyboardExitStatus(scope: RailKeyboardScope): string {
	return scope === "ordinary"
		? "키보드 레일 건설을 종료했습니다 · 확정한 구간은 유지됩니다"
		: "키보드 레일 미리보기를 취소했습니다 · 확정한 구간은 유지됩니다";
}

export type GuidedRailKeyboardCurrentBinding = GuidedRailKeyboardBinding;

export function createGuidedRailKeyboardBinding(
	modelGeneration: number,
	document: RailDocument,
	map: TileMap,
): GuidedRailKeyboardBinding {
	return Object.freeze({
		modelGeneration,
		document,
		map,
		revision: map.getRevision(),
		patchSequence: document.getPatchSequence(),
	});
}

export function createGuidedRailKeyboardSession(
	mission: GuidedRailKeyboardMission,
	endpoint: Cell,
	binding: GuidedRailKeyboardBinding,
): GuidedRailKeyboardSession {
	return Object.freeze({
		scope: "guided",
		mission,
		phase: "choose-start",
		source: null,
		endpoint: copyCell(endpoint),
		binding,
	});
}

export function createOrdinaryRailKeyboardSession(
	endpoint: Cell,
	binding: GuidedRailKeyboardBinding,
): GuidedRailKeyboardSession {
	return Object.freeze({
		scope: "ordinary",
		mission: null,
		phase: "choose-start",
		source: null,
		endpoint: copyCell(endpoint),
		binding,
	});
}

export function guidedRailKeyboardSessionIsCurrent(
	session: GuidedRailKeyboardSession,
	current: GuidedRailKeyboardCurrentBinding,
): boolean {
	return (
		session.binding.modelGeneration === current.modelGeneration &&
		session.binding.document === current.document &&
		session.binding.map === current.map &&
		session.binding.revision === current.revision &&
		session.binding.patchSequence === current.patchSequence
	);
}

/**
 * A stable, text-only description of the transient keyboard cursor.
 *
 * The canvas drawing is deliberately derived and silent. This presentation keeps the same
 * transient state inspectable without making the renderer or DOM an editable source of truth.
 */
export function guidedRailKeyboardAccessiblePresentation(
	session: GuidedRailKeyboardSession,
	evaluation: GuidedRailKeyboardEndpointEvaluation | null,
): GuidedRailKeyboardAccessiblePresentation {
	const coordinate = `X ${session.endpoint.x}미터 · Z ${session.endpoint.y}미터`;
	if (session.phase === "choose-start") {
		return Object.freeze({
			summary: `키보드 레일 시작점 단계 · ${coordinate} · 길이 0미터 · Enter로 시작점 선택`,
			validityKey: "choose-start",
		});
	}
	const lengthMeters = evaluation?.lengthMeters ?? 0;
	const valid = evaluation?.valid === true;
	const reason = evaluation?.reason.trim() || "현재 끝점에는 레일을 배치할 수 없습니다";
	return Object.freeze({
		summary: `키보드 레일 끝점 단계 · ${coordinate} · 시작점 기준 ${lengthMeters}미터 · ${
			valid ? "배치 가능 · Enter로 구간 확정" : `배치 불가 · ${reason}`
		}`,
		validityKey: valid ? "valid" : `invalid:${reason}`,
	});
}

export function moveGuidedRailKeyboardEndpoint(
	session: GuidedRailKeyboardSession,
	direction: GuidedRailKeyboardDirection,
	fast: boolean,
): GuidedRailKeyboardSession {
	const distance = fast ? 5 : 1;
	const delta = directionDelta(direction, distance);
	return Object.freeze({
		...session,
		endpoint: Object.freeze({
			x: session.endpoint.x + delta.x,
			y: session.endpoint.y + delta.y,
		}),
	});
}

export function selectGuidedRailKeyboardSource(
	session: GuidedRailKeyboardSession,
): GuidedRailKeyboardSession {
	if (session.phase === "choose-end") return session;
	const source = copyCell(session.endpoint);
	return Object.freeze({
		...session,
		phase: "choose-end",
		source,
		endpoint: source,
	});
}

export function continueGuidedRailKeyboardSession(
	session: GuidedRailKeyboardSession,
	endpoint: Cell,
	binding: GuidedRailKeyboardBinding,
): GuidedRailKeyboardSession {
	return Object.freeze({
		...session,
		phase: "choose-start",
		source: null,
		endpoint: copyCell(endpoint),
		binding,
	});
}

export function chooseGuidedRailKeyboardInitialCell(
	map: TileMap,
	mission: GuidedRailKeyboardMission,
	preferred: Cell,
	openTerminalCells: Int32Array,
): Cell {
	if (mission === "process-loop") {
		const terminal = nearestForwardTerminal(map, preferred, openTerminalCells);
		if (terminal) return terminal;
	}
	return nearestUnoccupiedCell(map, preferred);
}

function nearestForwardTerminal(
	map: TileMap,
	preferred: Cell,
	openTerminalCells: Int32Array,
): Cell | null {
	let nearest: Cell | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (let index = 0; index + 1 < openTerminalCells.length; index += 2) {
		const candidate = {
			x: openTerminalCells[index] as number,
			y: openTerminalCells[index + 1] as number,
		};
		if (terminalForwardDirection(map, candidate) === null) continue;
		const distance = Math.abs(candidate.x - preferred.x) + Math.abs(candidate.y - preferred.y);
		if (distance >= nearestDistance) continue;
		nearestDistance = distance;
		nearest = candidate;
	}
	return nearest ? copyCell(nearest) : null;
}

function nearestUnoccupiedCell(map: TileMap, preferred: Cell): Cell {
	if (isUnoccupied(map, preferred.x, preferred.y)) return copyCell(preferred);
	for (let radius = 1; radius <= 64; radius++) {
		for (let offset = -radius; offset <= radius; offset++) {
			const candidates = [
				{ x: preferred.x + offset, y: preferred.y - radius },
				{ x: preferred.x + radius, y: preferred.y + offset },
				{ x: preferred.x - offset, y: preferred.y + radius },
				{ x: preferred.x - radius, y: preferred.y - offset },
			];
			for (const candidate of candidates) {
				if (isUnoccupied(map, candidate.x, candidate.y)) return Object.freeze(candidate);
			}
		}
	}
	return copyCell(preferred);
}

function isUnoccupied(map: TileMap, x: number, y: number): boolean {
	return !map.hasRail(x, y) && !map.hasAdvancedSwitchClaim(x, y);
}

function directionDelta(direction: GuidedRailKeyboardDirection, distance: number): Cell {
	if (direction === "up") return { x: 0, y: -distance };
	if (direction === "down") return { x: 0, y: distance };
	if (direction === "left") return { x: -distance, y: 0 };
	return { x: distance, y: 0 };
}

function copyCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
