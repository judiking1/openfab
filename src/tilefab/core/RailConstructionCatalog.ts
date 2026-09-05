import type { AdvancedSwitchProfileClass } from "./AdvancedSwitch";
import {
	type AdvancedSwitchPlan,
	type AdvancedSwitchPlanningMap,
	planAdvancedSwitch,
} from "./AdvancedSwitchPlanner";
import { type BendPreference, planRailConstruction, type RailConstructionPlan } from "./paint";
import {
	planRailModule,
	type RailModuleKind,
	type RailModulePlan,
	type RailModuleSide,
	type RailModuleSpan,
	terminalForwardDirection,
} from "./RailModulePlanner";
import {
	createRailNetworkLinkAnchorContext,
	planRailNetworkLink,
	type RailNetworkLinkAnchorContext,
	type RailNetworkLinkPlan,
} from "./RailNetworkLinkPlanner";
import type { Direction } from "./railShape";
import type { Cell } from "./TileMap";

export const RAIL_CONSTRUCTION_CATALOG_IDS = [
	"route",
	"network-link",
	"u-turn",
	"shift",
	"advanced-switch",
] as const;

export type RailConstructionCatalogId = (typeof RAIL_CONSTRUCTION_CATALOG_IDS)[number];
export type RailConstructionControl = "bend" | "side" | "span" | "switch-profile";
export type RailConstructionGrammar =
	| "straight-1-5m"
	| "r500-turn"
	| "directed-branch"
	| "directed-merge"
	| "network-link"
	| "u-turn"
	| "shift"
	| "advanced-switch";
export type RailConstructionIcon = "route" | "link" | "u-turn" | "shift" | "switch";
export type RailConstructionApplicabilityState = "ready" | "anchor-required" | "invalid-anchor";

export interface RailConstructionCatalogItem {
	readonly id: RailConstructionCatalogId;
	readonly label: string;
	readonly statusLabel: string;
	readonly title: string;
	readonly engineeringSpec: string;
	readonly icon: RailConstructionIcon;
	readonly planner: "route" | "network-link" | "fixed-module" | "advanced-switch";
	readonly moduleKind: RailModuleKind | null;
	readonly controls: readonly RailConstructionControl[];
	readonly grammar: readonly RailConstructionGrammar[];
	readonly requiresOpenTerminal: boolean;
	readonly pointerIntent: "route-end" | "side";
	readonly repeatFromExit: boolean;
}

export interface RailConstructionApplicability {
	readonly state: RailConstructionApplicabilityState;
	readonly ready: boolean;
	readonly reason: string;
}

export interface RailConstructionOptions {
	readonly bend: BendPreference;
	readonly span: RailModuleSpan;
	readonly advancedSwitchProfile: AdvancedSwitchProfileClass;
	readonly preferredSide?: RailModuleSide | null;
	readonly explicitForward?: Direction | null;
	readonly explicitSide?: RailModuleSide | null;
	readonly networkLinkContext?: RailNetworkLinkAnchorContext | null;
}

export type RailCatalogPlan =
	| RailConstructionPlan
	| RailModulePlan
	| AdvancedSwitchPlan
	| RailNetworkLinkPlan;

const CATALOG: readonly RailConstructionCatalogItem[] = Object.freeze([
	catalogItem({
		id: "route",
		label: "SMART ROUTE",
		statusLabel: "경로",
		title: "직선, R500 코너, 방향성 분기와 합류를 드래그해 건설",
		engineeringSpec: "1-5 m · R500 · B/M",
		icon: "route",
		planner: "route",
		moduleKind: null,
		controls: ["bend"],
		grammar: ["straight-1-5m", "r500-turn", "directed-branch", "directed-merge"],
		requiresOpenTerminal: false,
		pointerIntent: "route-end",
		repeatFromExit: true,
	}),
	catalogItem({
		id: "network-link",
		label: "LOOP CONNECT",
		statusLabel: "폐쇄 루프 연결",
		title: "서로 다른 두 폐쇄 루프 사이에 분리된 OUTBOUND와 RETURN 경로를 한 번에 건설",
		engineeringSpec: "2 ROUTES · 4×B/M · ATOMIC",
		icon: "link",
		planner: "network-link",
		moduleKind: null,
		controls: ["side"],
		grammar: ["directed-branch", "directed-merge", "network-link"],
		requiresOpenTerminal: false,
		pointerIntent: "route-end",
		repeatFromExit: false,
	}),
	catalogItem({
		id: "u-turn",
		label: "U-TURN",
		statusLabel: "U턴",
		title: "열린 끝점에서 규격 U턴 모듈을 건설",
		engineeringSpec: "R500 · 180°",
		icon: "u-turn",
		planner: "fixed-module",
		moduleKind: "u-turn",
		controls: ["span", "side"],
		grammar: ["u-turn"],
		requiresOpenTerminal: true,
		pointerIntent: "side",
		repeatFromExit: true,
	}),
	catalogItem({
		id: "shift",
		label: "SHIFT",
		statusLabel: "평행 이동",
		title: "열린 끝점에서 규격 평행 이동 모듈을 건설",
		engineeringSpec: "R600 S · CSC",
		icon: "shift",
		planner: "fixed-module",
		moduleKind: "shift",
		controls: ["span", "side"],
		grammar: ["shift"],
		requiresOpenTerminal: true,
		pointerIntent: "side",
		repeatFromExit: true,
	}),
	catalogItem({
		id: "advanced-switch",
		label: "2×2 SWITCH",
		statusLabel: "2-in/2-out 스위치",
		title: "열린 끝점에서 2-in/2-out merge-throat-branch 스위치를 건설",
		engineeringSpec: "K2,2 · 4/4",
		icon: "switch",
		planner: "advanced-switch",
		moduleKind: null,
		controls: ["switch-profile", "side"],
		grammar: ["advanced-switch"],
		requiresOpenTerminal: true,
		pointerIntent: "side",
		repeatFromExit: false,
	}),
]);

const CATALOG_BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

export const RAIL_CONSTRUCTION_CATALOG = CATALOG;

export function railConstructionCatalogItem(
	id: RailConstructionCatalogId,
): RailConstructionCatalogItem {
	const item = CATALOG_BY_ID.get(id);
	if (!item) throw new RangeError(`Unknown rail construction catalog id: ${id}`);
	return item;
}

export function railConstructionApplicability(
	map: AdvancedSwitchPlanningMap,
	id: RailConstructionCatalogId,
	anchor: Cell | null,
	networkLinkContext: RailNetworkLinkAnchorContext | null = null,
): RailConstructionApplicability {
	const item = railConstructionCatalogItem(id);
	if (id === "network-link") {
		if (!anchor) {
			return applicability("anchor-required", "첫 번째 폐쇄 루프의 단방향 직선 구간을 선택하세요");
		}
		const context = networkLinkContext?.matchesAnchor(map, anchor) ? networkLinkContext : null;
		if (!context) {
			return applicability("invalid-anchor", "첫 번째 폐쇄 루프의 직선 연결 지점을 지정하세요");
		}
		return context.valid
			? applicability("ready", context.reason)
			: applicability("invalid-anchor", context.reason);
	}
	if (!item.requiresOpenTerminal) {
		return applicability(
			"ready",
			anchor
				? "선택한 시작점에서 끝점을 드래그하세요"
				: map.edgeCount === 0
					? "빈 곳에서 시작해 레일 경로의 끝점을 드래그하세요"
					: "기존 열린 끝 또는 다른 빈 곳에서 새 경로를 시작할 수 있습니다",
		);
	}
	if (!anchor) {
		return applicability("anchor-required", "진행 방향의 열린 끝점을 먼저 선택하세요");
	}
	if (terminalForwardDirection(map, anchor) === null) {
		return applicability("invalid-anchor", "선택한 셀은 진행 방향의 열린 끝점이 아닙니다");
	}
	return applicability("ready", "왼쪽 또는 오른쪽에서 모듈 방향을 선택하세요");
}

export function planCatalogRailConstruction(
	map: AdvancedSwitchPlanningMap,
	start: Cell,
	pointer: Cell,
	id: RailConstructionCatalogId,
	options: RailConstructionOptions,
): RailCatalogPlan {
	const item = railConstructionCatalogItem(id);
	if (item.planner === "route") {
		const plan = planRailConstruction(map, start, pointer, options.bend);
		if (
			options.networkLinkContext?.matchesAnchor(map, start) &&
			options.networkLinkContext.valid &&
			options.networkLinkContext.isDistinctClosedTarget(map, pointer)
		) {
			const networkLink = planRailNetworkLink(
				map,
				options.networkLinkContext,
				pointer,
				options.explicitSide ?? null,
			);
			// A distinct closed target is an explicit component-link intent. Keep physical/topology
			// failures inside that contract, but do not hijack ordinary Smart Route pointer targets.
			return networkLink;
		}
		return plan;
	}
	if (item.planner === "network-link") {
		const context = options.networkLinkContext?.matchesAnchor(map, start)
			? options.networkLinkContext
			: createRailNetworkLinkAnchorContext(map, start);
		return planRailNetworkLink(map, context, pointer, options.explicitSide ?? null);
	}
	if (item.planner === "advanced-switch") {
		return planAdvancedSwitch(
			map,
			start,
			pointer,
			options.advancedSwitchProfile,
			options.preferredSide,
			options.explicitForward,
			options.explicitSide,
		);
	}
	if (!item.moduleKind) {
		throw new Error(`Fixed rail catalog item ${item.id} is missing its module kind.`);
	}
	return planRailModule(
		map,
		start,
		pointer,
		item.moduleKind,
		options.span,
		options.preferredSide,
		options.explicitSide,
	);
}

function catalogItem(item: RailConstructionCatalogItem): RailConstructionCatalogItem {
	return Object.freeze({
		...item,
		controls: Object.freeze([...item.controls]),
		grammar: Object.freeze([...item.grammar]),
	});
}

function applicability(
	state: RailConstructionApplicabilityState,
	reason: string,
): RailConstructionApplicability {
	return Object.freeze({ state, ready: state === "ready", reason });
}
