import type {
	RailTemplateCompositionConnector,
	RailTemplatePlan,
	RailTemplateTerminal,
} from "../core/RailTemplateCatalog";
import type { Direction } from "../core/railShape";
import { type Cell, cellKey } from "../core/TileMap";
import type { RailDraftEvaluation } from "./RailDraftEvaluator";

export const RAIL_TEMPLATE_PLACEMENT_FEEDBACK_CODES = Object.freeze([
	"valid",
	"invalid-parameters",
	"starter-only",
	"terminal-only",
	"wrong-direction",
	"insufficient-support",
	"overlap",
	"topology",
	"physical-clearance",
	"port-conflict",
	"stale",
	"preview-error",
] as const);

export type RailTemplatePlacementFeedbackCode =
	(typeof RAIL_TEMPLATE_PLACEMENT_FEEDBACK_CODES)[number];

export interface RailTemplatePlacementHandle {
	readonly kind: "entry" | "exit" | "origin";
	readonly role: RailTemplateTerminal["role"];
	readonly label: "ENTRY" | "EXIT" | "ORIGIN";
	readonly cell: Cell;
	readonly travelDirection: Direction;
	readonly attachment: RailTemplateTerminal["attachment"];
}

export interface RailTemplatePlacementConnector {
	readonly kind: RailTemplateCompositionConnector["kind"];
	readonly id: RailTemplateCompositionConnector["id"];
	readonly startCell: Cell;
	readonly endCell: Cell;
	readonly travelDirection: Direction | null;
	readonly spanMeters: number;
}

export interface RailTemplateReservationSummary {
	readonly bounds: Readonly<{
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}>;
	readonly widthMeters: number;
	readonly depthMeters: number;
	readonly cellCount: number;
	readonly extraCellCount: number;
}

export interface RailTemplatePlacementFeedback {
	readonly state: "ready" | "blocked";
	readonly code: RailTemplatePlacementFeedbackCode;
	readonly label: string;
	readonly summary: string;
	readonly reason: string;
	readonly expected: string;
	readonly baseRevision: number;
	readonly committedRevision: number;
	readonly handles: readonly RailTemplatePlacementHandle[];
	readonly connectors: readonly RailTemplatePlacementConnector[];
	readonly reservation: RailTemplateReservationSummary;
	readonly conflictCellCount: number;
	readonly focusCells: readonly Cell[];
	readonly newLengthMeters: number;
	readonly repeatable: boolean;
}

interface FeedbackDescriptor {
	readonly label: string;
	readonly summary: string;
	readonly expected: string;
}

const DESCRIPTORS: Readonly<Record<RailTemplatePlacementFeedbackCode, FeedbackDescriptor>> =
	Object.freeze({
		valid: Object.freeze({
			label: "READY",
			summary: "패턴을 배치할 수 있습니다",
			expected: "현재 위치가 방향·토폴로지·물리 간격 규칙을 통과했습니다",
		}),
		"invalid-parameters": Object.freeze({
			label: "PARAMETERS",
			summary: "패턴 치수를 확인하세요",
			expected: "카탈로그 최소·최대·상호 치수 규칙을 만족해야 합니다",
		}),
		"starter-only": Object.freeze({
			label: "STARTER ONLY",
			summary: "이 패턴은 현재 네트워크에서 시작할 수 없습니다",
			expected: "빈 작업면 또는 패턴이 요구하는 호환 앵커가 필요합니다",
		}),
		"terminal-only": Object.freeze({
			label: "OPEN END ONLY",
			summary: "이 패턴은 열린 끝점 전용입니다",
			expected: "빈 맵에서 시작하거나 화살표 방향이 맞는 열린 끝점에 배치하세요",
		}),
		"wrong-direction": Object.freeze({
			label: "WRONG DIRECTION",
			summary: "레일 진행 방향이 맞지 않습니다",
			expected: "FLOW를 반전하거나 패턴 화살표와 같은 방향의 직선 본선을 사용하세요",
		}),
		"insufficient-support": Object.freeze({
			label: "INSUFFICIENT SUPPORT",
			summary: "직선 지지 구간이 부족합니다",
			expected: "분기·합류 전후를 포함한 연속 단방향 직선 본선이 필요합니다",
		}),
		overlap: Object.freeze({
			label: "OVERLAP",
			summary: "기존 레일 또는 예약 구간과 충돌합니다",
			expected: "같은 방향의 호환 edge만 재사용하고 나머지 footprint는 비워 두세요",
		}),
		topology: Object.freeze({
			label: "TOPOLOGY",
			summary: "단방향 레일 토폴로지를 만들 수 없습니다",
			expected: "평면 교차·정면 T·역방향 흐름 없이 접선으로 연결해야 합니다",
		}),
		"physical-clearance": Object.freeze({
			label: "PHYSICAL CLEARANCE",
			summary: "물리 설치 간격이 부족합니다",
			expected: "beam·OHT sweep·설치 envelope가 기존 레일과 겹치지 않아야 합니다",
		}),
		"port-conflict": Object.freeze({
			label: "PORT CONFLICT",
			summary: "기존 장비 포트 연결을 유지할 수 없습니다",
			expected: "포트가 소유한 레일 station과 진행 방향을 보존해야 합니다",
		}),
		stale: Object.freeze({
			label: "REVALIDATE",
			summary: "맵이 변경되어 배치 판정이 만료되었습니다",
			expected: "현재 revision에서 패턴 위치를 다시 평가해야 합니다",
		}),
		"preview-error": Object.freeze({
			label: "PREVIEW ERROR",
			summary: "물리 배치 미리보기를 만들 수 없습니다",
			expected: "현재 패턴을 다시 선택하고 문제가 반복되면 진단 정보를 확인해야 합니다",
		}),
	});

/** Build one renderer-independent placement explanation from the authoritative plan/evaluation. */
export function createRailTemplatePlacementFeedback(
	plan: RailTemplatePlan,
	evaluation: RailDraftEvaluation,
): RailTemplatePlacementFeedback {
	const code = feedbackCode(plan, evaluation);
	const descriptor = DESCRIPTORS[code];
	const conflictCells = uniqueCells([...plan.conflicts, ...evaluation.conflictCells]);
	const focusCells = conflictCells.slice(0, 64);
	return Object.freeze({
		state: code === "valid" ? "ready" : "blocked",
		code,
		label: descriptor.label,
		summary: descriptor.summary,
		reason: evaluation.reason,
		expected: descriptor.expected,
		baseRevision: plan.baseRevision,
		committedRevision: evaluation.committedRevision,
		handles: Object.freeze(plan.template.terminals.map(placementHandle)),
		connectors: Object.freeze(plan.template.compositionConnectors.map(placementConnector)),
		reservation: reservationSummary(plan),
		conflictCellCount: conflictCells.length,
		focusCells: Object.freeze(focusCells.map(freezeCell)),
		newLengthMeters: plan.lengthMeters,
		repeatable: plan.template.repeatPolicy !== "single",
	});
}

function placementConnector(
	connector: RailTemplateCompositionConnector,
): RailTemplatePlacementConnector {
	if (connector.kind === "route-reuse") {
		return Object.freeze({
			kind: connector.kind,
			id: connector.id,
			startCell: freezeCell(connector.handleCell),
			endCell: freezeCell(connector.handleCell),
			travelDirection: null,
			spanMeters: connector.routeLengthMeters,
		});
	}
	return Object.freeze({
		kind: connector.kind,
		id: connector.id,
		startCell: freezeCell(connector.startCell),
		endCell: freezeCell(connector.endCell),
		travelDirection: connector.travelDirection,
		spanMeters: connector.spanMeters,
	});
}

function feedbackCode(
	plan: RailTemplatePlan,
	evaluation: RailDraftEvaluation,
): RailTemplatePlacementFeedbackCode {
	if (
		evaluation.stale ||
		evaluation.plan !== plan ||
		evaluation.baseRevision !== plan.baseRevision ||
		evaluation.committedRevision !== plan.baseRevision
	) {
		return "stale";
	}
	if (evaluation.failureCode === "compile") return "preview-error";
	if (!plan.valid) return plan.template.placementCode;
	if (evaluation.invalidatedPortIds.length > 0) return "port-conflict";
	if (evaluation.issues.length > 0) return "physical-clearance";
	if (!evaluation.valid || !evaluation.topologyValid) return "topology";
	return "valid";
}

function placementHandle(terminal: RailTemplateTerminal): RailTemplatePlacementHandle {
	const kind =
		terminal.role === "starter-origin"
			? "origin"
			: terminal.role === "entry" || terminal.role === "branch"
				? "entry"
				: "exit";
	return Object.freeze({
		kind,
		role: terminal.role,
		label: kind === "entry" ? "ENTRY" : kind === "exit" ? "EXIT" : "ORIGIN",
		cell: freezeCell(terminal.cell),
		travelDirection: terminal.travelDirection,
		attachment: terminal.attachment,
	});
}

function reservationSummary(plan: RailTemplatePlan): RailTemplateReservationSummary {
	const reserved = plan.template.hardReservedCells;
	const occupied = new Set(plan.template.occupiedCells.map((cell) => cellKey(cell.x, cell.y)));
	let minX = plan.template.anchor.x;
	let minY = plan.template.anchor.y;
	let maxX = minX;
	let maxY = minY;
	for (const cell of reserved) {
		minX = Math.min(minX, cell.x);
		minY = Math.min(minY, cell.y);
		maxX = Math.max(maxX, cell.x);
		maxY = Math.max(maxY, cell.y);
	}
	return Object.freeze({
		bounds: Object.freeze({ minX, minY, maxX, maxY }),
		widthMeters: maxX - minX + 1,
		depthMeters: maxY - minY + 1,
		cellCount: reserved.length,
		extraCellCount: reserved.filter((cell) => !occupied.has(cellKey(cell.x, cell.y))).length,
	});
}

function uniqueCells(cells: readonly Cell[]): Cell[] {
	const unique = new Map<string, Cell>();
	for (const cell of cells) unique.set(cellKey(cell.x, cell.y), cell);
	return [...unique.values()].sort((left, right) => left.y - right.y || left.x - right.x);
}

function freezeCell(cell: Cell): Cell {
	return Object.freeze({ x: cell.x, y: cell.y });
}
