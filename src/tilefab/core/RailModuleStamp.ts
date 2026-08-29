import type { AdvancedSwitchPlan, AdvancedSwitchPlanningMap } from "./AdvancedSwitchPlanner";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { planRailPath, type RailConstructionPlan } from "./paint";
import type { RailConstructionCatalogId } from "./RailConstructionCatalog";
import {
	type RailConstructionGrammar,
	railConstructionCatalogItem,
} from "./RailConstructionCatalog";
import type { RailModuleKind, RailModuleOwnership } from "./RailModuleOwnership";
import type { RailModuleSide, RailModuleSpan } from "./RailModulePlanner";
import { terminalForwardDirection } from "./RailModulePlanner";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import type { Cell } from "./TileMap";

export interface RailModuleStampOffset {
	readonly longitudinal: number;
	readonly lateral: number;
}

/** Serializable, renderer-independent geometry captured from one authored semantic module. */
export interface RailModuleStampTemplate {
	readonly sourceKey: string;
	readonly sourceKind: RailModuleKind;
	readonly catalogId: RailConstructionCatalogId;
	readonly grammar: RailConstructionGrammar;
	readonly sourceForward: Direction;
	readonly sourceSide: RailModuleSide | null;
	readonly span: RailModuleSpan | null;
	readonly advancedSwitchProfile: RailModuleOwnership["construction"]["advancedSwitchProfile"];
	readonly anchorRole: "entry" | "junction" | "switch-input-0";
	readonly path: readonly RailModuleStampOffset[];
	readonly repeatPolicy: "single" | "from-output" | "compatible-anchor" | "choose-output";
}

export interface RailModuleStampPose {
	readonly forward: Direction;
	readonly side: RailModuleSide | null;
}

export interface RailModuleStampMetadata {
	readonly sourceKey: string;
	readonly sourceKind: RailModuleKind;
	readonly grammar: RailConstructionGrammar;
	readonly forward: Direction;
	readonly outputForward: Direction;
	readonly side: RailModuleSide | null;
	readonly entry: Cell;
	readonly exit: Cell;
	readonly repeatPolicy: RailModuleStampTemplate["repeatPolicy"];
}

export type RailModuleStampPlan = (RailConstructionPlan | AdvancedSwitchPlan) & {
	readonly stamp: RailModuleStampMetadata;
};

export function createRailModuleStampTemplate(
	module: RailModuleOwnership,
): RailModuleStampTemplate {
	const sourceForward = module.construction.forward;
	assertDirection(sourceForward);
	const path = module.kind === "advanced-switch" ? [] : normalizedPath(module, sourceForward);
	if (module.kind === "advanced-switch" && !module.construction.advancedSwitchProfile) {
		throw new Error("Advanced switch stamp requires a profile class.");
	}
	return Object.freeze({
		sourceKey: module.key,
		sourceKind: module.kind,
		catalogId: module.construction.catalogId,
		grammar: module.construction.grammar,
		sourceForward,
		sourceSide: module.construction.side,
		span: module.construction.span,
		advancedSwitchProfile: module.construction.advancedSwitchProfile,
		anchorRole:
			module.kind === "advanced-switch"
				? "switch-input-0"
				: module.kind === "turnout"
					? "junction"
					: "entry",
		path: Object.freeze(path),
		repeatPolicy: repeatPolicy(module),
	});
}

export function initialRailModuleStampPose(template: RailModuleStampTemplate): RailModuleStampPose {
	return Object.freeze({ forward: template.sourceForward, side: template.sourceSide });
}

export function rotateRailModuleStampPose(
	pose: RailModuleStampPose,
	quarterTurns: -1 | 1,
): RailModuleStampPose {
	return Object.freeze({
		...pose,
		forward: rotateDirection(pose.forward, quarterTurns),
	});
}

export function setRailModuleStampSide(
	pose: RailModuleStampPose,
	side: RailModuleSide,
): RailModuleStampPose {
	return Object.freeze({ ...pose, side });
}

export function continueRailModuleStampPose(
	pose: RailModuleStampPose,
	stamp: RailModuleStampMetadata,
): RailModuleStampPose {
	return stamp.repeatPolicy === "from-output"
		? Object.freeze({ ...pose, forward: stamp.outputForward })
		: pose;
}

/** Rebuild a captured module at a target cell through the ordinary construction validators. */
export function planRailModuleStamp(
	map: AdvancedSwitchPlanningMap,
	template: RailModuleStampTemplate,
	target: Cell,
	pose: RailModuleStampPose,
): RailModuleStampPlan {
	assertDirection(pose.forward);
	const side = template.sourceSide === null ? null : (pose.side ?? template.sourceSide);
	if (template.sourceKind === "advanced-switch") {
		const selectedSide = side ?? "right";
		const pointer = moveCell(target, lateralDirection(pose.forward, selectedSide));
		const plan = planAdvancedSwitch(
			map,
			target,
			pointer,
			template.advancedSwitchProfile as NonNullable<
				RailModuleStampTemplate["advancedSwitchProfile"]
			>,
			selectedSide,
			pose.forward,
			selectedSide,
		);
		return Object.freeze({
			...plan,
			stamp: stampMetadata(
				template,
				pose.forward,
				pose.forward,
				selectedSide,
				plan.entry,
				plan.exit,
			),
		});
	}

	const mirrored = template.sourceSide !== null && side !== template.sourceSide;
	const cells = template.path.map((offset) =>
		worldCell(
			target,
			pose.forward,
			offset.longitudinal,
			mirrored ? -offset.lateral : offset.lateral,
		),
	);
	let plan = planRailPath(map, cells);
	const attachmentReason = stampAttachmentError(map, template, target, pose.forward, cells);
	if (attachmentReason) plan = invalidStampPlan(plan, attachmentReason, [target]);
	const expectedNewEdges = Math.max(0, cells.length - 1);
	if (plan.valid && plan.newEdges !== expectedNewEdges) {
		plan = invalidStampPlan(
			plan,
			"선택한 모듈이 기존 레일과 부분 중첩되어 원본 문법을 유지할 수 없습니다",
			cells,
		);
	}
	const outputForward =
		cells.length >= 2
			? (directionBetween(cells.at(-2) as Cell, cells.at(-1) as Cell) ?? pose.forward)
			: pose.forward;
	return Object.freeze({
		...plan,
		stamp: stampMetadata(
			template,
			pose.forward,
			outputForward,
			side,
			cells[0] ?? target,
			cells.at(-1) ?? target,
		),
	});
}

export function isRailModuleStampPlan(plan: unknown): plan is RailModuleStampPlan {
	return typeof plan === "object" && plan !== null && "stamp" in plan;
}

function normalizedPath(
	module: RailModuleOwnership,
	forward: Direction,
): readonly RailModuleStampOffset[] {
	const first = module.eraseEdges[0];
	if (!first) throw new Error(`Rail module ${module.key} has no directed path to stamp.`);
	const cells: Cell[] =
		module.kind === "turnout" ? turnoutConstructionPath(module, first) : [first.from, first.to];
	for (const edge of module.kind === "turnout" ? [] : module.eraseEdges.slice(1)) {
		const previous = cells.at(-1) as Cell;
		if (!sameCell(previous, edge.from)) {
			throw new Error(`Rail module ${module.key} does not own one ordered stamp path.`);
		}
		cells.push(edge.to);
	}
	const origin =
		module.kind === "turnout" && module.construction.grammar === "directed-merge"
			? first.to
			: (cells[0] as Cell);
	const forwardVector = directionVector(forward);
	const rightVector = directionVector(rightDirection(forward));
	return cells.map((cell) => {
		const deltaX = cell.x - origin.x;
		const deltaY = cell.y - origin.y;
		return Object.freeze({
			longitudinal: deltaX * forwardVector.x + deltaY * forwardVector.y,
			lateral: deltaX * rightVector.x + deltaY * rightVector.y,
		});
	});
}

function turnoutConstructionPath(
	module: RailModuleOwnership,
	edge: RailModuleOwnership["eraseEdges"][number],
): Cell[] {
	const direction = directionBetween(edge.from, edge.to);
	if (!direction)
		throw new Error(`Turnout module ${module.key} has a non-cardinal diverging edge.`);
	if (module.construction.grammar === "directed-branch") {
		const firstLead = moveCell(edge.to, direction);
		return [edge.from, edge.to, firstLead, moveCell(firstLead, direction)];
	}
	if (module.construction.grammar === "directed-merge") {
		const reverse = oppositeDirection(direction);
		const firstLead = moveCell(edge.from, reverse);
		return [moveCell(firstLead, reverse), firstLead, edge.from, edge.to];
	}
	throw new Error(
		`Turnout module ${module.key} has unsupported grammar ${module.construction.grammar}.`,
	);
}

function stampMetadata(
	template: RailModuleStampTemplate,
	forward: Direction,
	outputForward: Direction,
	side: RailModuleSide | null,
	entry: Cell,
	exit: Cell,
): RailModuleStampMetadata {
	return Object.freeze({
		sourceKey: template.sourceKey,
		sourceKind: template.sourceKind,
		grammar: template.grammar,
		forward,
		outputForward,
		side,
		entry: Object.freeze({ ...entry }),
		exit: Object.freeze({ ...exit }),
		repeatPolicy: template.repeatPolicy,
	});
}

function repeatPolicy(module: RailModuleOwnership): RailModuleStampTemplate["repeatPolicy"] {
	if (module.kind === "advanced-switch") return "choose-output";
	if (module.construction.grammar === "directed-merge") return "single";
	if (module.construction.grammar === "directed-branch") return "compatible-anchor";
	return railConstructionCatalogItem(module.construction.catalogId).repeatFromExit
		? "from-output"
		: "single";
}

function stampAttachmentError(
	map: AdvancedSwitchPlanningMap,
	template: RailModuleStampTemplate,
	target: Cell,
	forward: Direction,
	cells: readonly Cell[],
): string | null {
	if (template.anchorRole === "junction") {
		const rail = map.getRail(target.x, target.y);
		if (rail.incoming !== oppositeDirection(forward) || rail.outgoing !== forward) {
			return "분기와 합류 스탬프는 선택한 방향의 단방향 직선 본선 셀에만 배치할 수 있습니다";
		}
	} else {
		if (map.edgeCount === 0) return null;
		if (terminalForwardDirection(map, target) !== forward) {
			return "모듈 입력 방향과 일치하는 열린 끝점에 배치하세요";
		}
	}

	const anchorIndex =
		template.anchorRole === "junction" && template.grammar === "directed-merge"
			? cells.length - 1
			: 0;
	for (let index = 1; index < cells.length - 1; index++) {
		if (index === anchorIndex) continue;
		const cell = cells[index] as Cell;
		if (map.hasRail(cell.x, cell.y)) {
			return "모듈 내부 footprint가 기존 레일과 겹칩니다";
		}
	}
	return null;
}

function invalidStampPlan(
	plan: RailConstructionPlan,
	reason: string,
	conflicts: readonly Cell[],
): RailConstructionPlan {
	return Object.freeze({
		...plan,
		valid: false,
		reason,
		conflicts: Object.freeze(conflicts.map((cell) => Object.freeze({ ...cell }))),
	});
}

function worldCell(origin: Cell, forward: Direction, longitudinal: number, lateral: number): Cell {
	const forwardVector = directionVector(forward);
	const rightVector = directionVector(rightDirection(forward));
	return Object.freeze({
		x: origin.x + forwardVector.x * longitudinal + rightVector.x * lateral,
		y: origin.y + forwardVector.y * longitudinal + rightVector.y * lateral,
	});
}

function lateralDirection(forward: Direction, side: RailModuleSide): Direction {
	const right = rightDirection(forward);
	return side === "right" ? right : oppositeQuarterDirection(right);
}

function rotateDirection(direction: Direction, quarterTurns: -1 | 1): Direction {
	const directions = [DIR_N, DIR_E, DIR_S, DIR_W] as const;
	const index = directions.indexOf(direction);
	if (index < 0) throw new RangeError(`Invalid cardinal direction ${direction}.`);
	return directions[(index + quarterTurns + directions.length) % directions.length] as Direction;
}

function rightDirection(direction: Direction): Direction {
	return rotateDirection(direction, 1);
}

function oppositeQuarterDirection(direction: Direction): Direction {
	return rotateDirection(rotateDirection(direction, 1), 1);
}

function directionVector(direction: Direction): { readonly x: number; readonly y: number } {
	if (direction === DIR_N) return { x: 0, y: -1 };
	if (direction === DIR_E) return { x: 1, y: 0 };
	if (direction === DIR_S) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}

function assertDirection(direction: Direction): void {
	if (!ALL_DIRECTIONS.includes(direction)) {
		throw new RangeError(`Invalid cardinal direction ${direction}.`);
	}
}

function sameCell(left: Cell, right: Cell): boolean {
	return left.x === right.x && left.y === right.y;
}
