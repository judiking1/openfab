import {
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import type {
	RailConstructionCatalogId,
	RailConstructionGrammar,
} from "../core/RailConstructionCatalog";
import type { RailModuleOwnership } from "../core/RailModuleOwnership";
import type { RailModuleSide, RailModuleSpan } from "../core/RailModulePlanner";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import type { Cell } from "../core/TileMap";
import type { CompiledJunction, CompiledRailPiece } from "./PhysicalRailCompiler";

export interface RailConstructionCopyPreset {
	readonly catalogId: RailConstructionCatalogId;
	readonly source: "physical-piece" | "junction" | "advanced-switch";
	readonly sourceId: string;
	readonly grammar: RailConstructionGrammar;
	readonly span: RailModuleSpan | null;
	readonly side: RailModuleSide | null;
	readonly advancedSwitchProfile: AdvancedSwitchProfileClass | null;
	readonly sourceCells: readonly Cell[];
}

export interface RailConstructionPresetSource {
	readonly piece: CompiledRailPiece | null;
	readonly junction?: CompiledJunction | null;
	readonly advancedSwitch?: AdvancedSwitchRecord | null;
}

/** Resolve derived selection geometry back to a catalog setting, never to a second editable model. */
export function resolveRailConstructionCopyPreset(
	source: RailConstructionPresetSource,
): RailConstructionCopyPreset | null {
	if (source.advancedSwitch) return advancedSwitchPreset(source.advancedSwitch);
	if (source.junction) return junctionPreset(source.junction);
	const piece = source.piece;
	if (!piece || (piece.advancedSwitchId ?? 0) !== 0) return null;

	if (piece.type === "CCW_CURVE") return compoundPreset(piece, "u-turn", "compact", "u-turn");
	if (piece.type === "CSC_CURVE_HOMO") return compoundPreset(piece, "u-turn", "wide", "u-turn");
	if (piece.type === "S_CURVE") return compoundPreset(piece, "shift", "compact", "shift");
	if (piece.type === "CSC_CURVE_HETE") return compoundPreset(piece, "shift", "wide", "shift");
	if (piece.type === "LEFT_CURVE" || piece.type === "RIGHT_CURVE") {
		return piecePreset(piece, "r500-turn");
	}
	if (piece.type === "LINEAR") return piecePreset(piece, "straight-1-5m");
	return null;
}

/** Convert authored semantic ownership directly into catalog settings. */
export function resolveOwnershipConstructionCopyPreset(
	module: RailModuleOwnership,
): RailConstructionCopyPreset {
	return preset({
		catalogId: module.construction.catalogId,
		source:
			module.kind === "advanced-switch"
				? "advanced-switch"
				: module.kind === "turnout"
					? "junction"
					: "physical-piece",
		sourceId: module.key,
		grammar: module.construction.grammar,
		span: module.construction.span,
		side: module.construction.side,
		advancedSwitchProfile: module.construction.advancedSwitchProfile,
		sourceCells: module.footprintCells,
	});
}

function advancedSwitchPreset(record: AdvancedSwitchRecord): RailConstructionCopyPreset {
	return preset({
		catalogId: "advanced-switch",
		source: "advanced-switch",
		sourceId: `SW-${record.id}`,
		grammar: "advanced-switch",
		span: null,
		side: record.lateral === leftDirection(record.forward) ? "left" : "right",
		advancedSwitchProfile: record.profileClass,
		sourceCells: deriveAdvancedSwitchGeometry(record).claimedCells,
	});
}

function junctionPreset(junction: CompiledJunction): RailConstructionCopyPreset {
	return preset({
		catalogId: "route",
		source: "junction",
		sourceId: junction.id,
		grammar: junction.type === "BRANCH" ? "directed-branch" : "directed-merge",
		span: null,
		side: null,
		advancedSwitchProfile: null,
		sourceCells: junction.footprintCells,
	});
}

function compoundPreset(
	piece: CompiledRailPiece,
	catalogId: "u-turn" | "shift",
	span: RailModuleSpan,
	grammar: "u-turn" | "shift",
): RailConstructionCopyPreset {
	return preset({
		catalogId,
		source: "physical-piece",
		sourceId: piece.id,
		grammar,
		span,
		side: piece.turn ?? null,
		advancedSwitchProfile: null,
		sourceCells: piece.cells,
	});
}

function piecePreset(
	piece: CompiledRailPiece,
	grammar: "straight-1-5m" | "r500-turn",
): RailConstructionCopyPreset {
	return preset({
		catalogId: "route",
		source: "physical-piece",
		sourceId: piece.id,
		grammar,
		span: null,
		side: piece.turn ?? null,
		advancedSwitchProfile: null,
		sourceCells: piece.cells,
	});
}

function preset(value: RailConstructionCopyPreset): RailConstructionCopyPreset {
	return Object.freeze({
		...value,
		sourceCells: Object.freeze(value.sourceCells.map((cell) => Object.freeze({ ...cell }))),
	});
}

function leftDirection(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_W;
	if (direction === DIR_E) return DIR_N;
	if (direction === DIR_S) return DIR_E;
	return DIR_S;
}
