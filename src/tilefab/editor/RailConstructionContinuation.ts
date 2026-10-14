import type { AdvancedSwitchProfileClass } from "../core/AdvancedSwitch";
import {
	type RailConstructionCatalogId,
	railConstructionCatalogItem,
} from "../core/RailConstructionCatalog";
import type { RailDocument } from "../core/RailDocument";
import type { RailModuleSide, RailModuleSpan } from "../core/RailModulePlanner";
import type { Cell } from "../core/TileMap";

export type RailConstructionContinuation =
	| Readonly<{ kind: "direct-route" }>
	| Readonly<{ kind: "module"; repeatFromExit: boolean; exit: Cell }>;

/**
 * Resolve the visible command loop after a successful rail construction.
 *
 * Direct Smart Route commits deliberately release their hidden anchor: the next drag begins where
 * the user presses. Compound modules may retain the planner-owned output contract.
 */
export function nextRailConstructionAnchor(
	continuation: RailConstructionContinuation,
	pointerEnd: Cell,
): Cell | null {
	if (continuation.kind === "direct-route") return null;
	return continuation.repeatFromExit ? continuation.exit : pointerEnd;
}

/**
 * Resolve the anchor after a moved construction gesture is rejected.
 *
 * A rejected Smart Route drag must not turn its pressed cell into a hidden click-then-click anchor;
 * the next drag still begins where the user presses. Compound modules keep their explicit source so
 * the user can correct the attempted direction without reselecting the terminal.
 */
export function rejectedRailConstructionAnchor(
	continuation: RailConstructionContinuation,
	attemptedStart: Cell,
): Cell | null {
	return continuation.kind === "direct-route" ? null : attemptedStart;
}

/** Retain only this document's module choice while ordinary rail construction prepares its anchor. */
export interface RailModulePreparation {
	readonly document: RailDocument;
	readonly mode: RailConstructionCatalogId;
	readonly span: RailModuleSpan;
	readonly profile: AdvancedSwitchProfileClass;
	readonly copiedSide: RailModuleSide | null;
	readonly explicitSide: RailModuleSide | null;
}

export function captureRailModulePreparation(
	document: RailDocument,
	mode: RailConstructionCatalogId,
	settings: Pick<RailModulePreparation, "span" | "profile" | "copiedSide" | "explicitSide">,
): RailModulePreparation | null {
	if (document.map.edgeCount !== 0 || !railConstructionCatalogItem(mode).requiresOpenTerminal)
		return null;
	return Object.freeze({ document, mode, ...settings });
}

export function railModulePreparationHandoff(
	preparation: RailModulePreparation | null,
	document: RailDocument,
	hasForwardTerminal: boolean,
) {
	if (!preparation || preparation.document !== document) return null;
	const name = railConstructionCatalogItem(preparation.mode).label;
	const label = hasForwardTerminal ? `${name} 배치로 돌아가기` : "먼저 레일 그리기";
	const instruction = hasForwardTerminal
		? "레일 준비됨 · 열린 끝점을 선택하세요"
		: `${name}에는 진행 방향의 열린 끝점이 필요합니다`;
	return {
		label,
		instruction,
		ariaLabel: label,
		description: instruction,
		railReady: hasForwardTerminal,
	};
}
