import type { PortEquipmentState } from "./EquipmentGroup";
import type { RailErasePlan } from "./paint";
import {
	planRailAreaBulldoze,
	type RailAreaSelection,
	railAreaSelectionStaleReason,
} from "./RailAreaSelection";
import {
	createRailAreaStampTemplateFromValidatedSelection,
	type RailAreaStampTemplate,
} from "./RailAreaStamp";
import { railPatchInvalidatedPorts } from "./RailDocument";
import {
	planRailModuleBulldoze,
	type RailModuleOwnership,
	type RailModuleOwnershipIndex,
} from "./RailModuleOwnership";
import { createRailModuleStampTemplate, type RailModuleStampTemplate } from "./RailModuleStamp";
import {
	createStaticFabBlueprintTemplateFromValidatedSelection,
	type StaticFabBlueprintTemplate,
} from "./StaticFabBlueprint";
import {
	planStaticFabSelectionErase,
	type StaticFabSelection,
	type StaticFabSelectionErasePlan,
	staticFabSelectionStaleReason,
} from "./StaticFabSelection";
import type { TileMap } from "./TileMap";

export interface RailAreaCutClipboard {
	readonly kind: "area";
	readonly template: RailAreaStampTemplate;
	readonly staticFabTemplate?: StaticFabBlueprintTemplate;
}

export interface RailModuleCutClipboard {
	readonly kind: "module";
	readonly template: RailModuleStampTemplate;
}

export type PreparedRailAreaCut =
	| Readonly<{
			valid: true;
			reason: string;
			clipboard: RailAreaCutClipboard;
			erasePlan: RailErasePlan | StaticFabSelectionErasePlan;
	  }>
	| Readonly<{
			valid: false;
			reason: string;
			clipboard: null;
			erasePlan: null;
	  }>;

export type PreparedRailModuleCut =
	| Readonly<{
			valid: true;
			reason: string;
			clipboard: RailModuleCutClipboard;
			erasePlan: RailErasePlan;
	  }>
	| Readonly<{
			valid: false;
			reason: string;
			clipboard: null;
			erasePlan: null;
	  }>;

/**
 * Capture and validate one area cut against the same immutable revision/patch-sequence snapshot.
 * The caller must commit erasePlan before publishing clipboard so a rejected commit cannot destroy
 * the previous clipboard.
 */
export function prepareRailAreaCut(
	input: Readonly<{
		map: TileMap;
		ownership: RailModuleOwnershipIndex;
		portEquipment: PortEquipmentState;
		basePatchSequence: number;
		selection: RailAreaSelection;
		staticFabSelection?: StaticFabSelection | null;
	}>,
): PreparedRailAreaCut {
	const { map, ownership, portEquipment, basePatchSequence, selection } = input;
	const staticFabSelection = input.staticFabSelection ?? null;
	try {
		if (staticFabSelection && !sameRailSelection(selection, staticFabSelection.rail)) {
			return invalidAreaCut("레일과 장비 선택 범위가 달라 다시 영역을 선택해야 합니다");
		}
		if (staticFabSelection?.equipmentGroups.length) {
			const staleReason = staticFabSelectionStaleReason(
				map,
				ownership,
				portEquipment,
				basePatchSequence,
				staticFabSelection,
			);
			if (staleReason) return invalidAreaCut(staleReason);
			const staticFabTemplate =
				createStaticFabBlueprintTemplateFromValidatedSelection(staticFabSelection);
			const erasePlan = planStaticFabSelectionErase(
				map,
				ownership,
				portEquipment,
				basePatchSequence,
				staticFabSelection,
			);
			if (!erasePlan.valid) return invalidAreaCut(erasePlan.reason);
			return Object.freeze({
				valid: true,
				reason: `레일 ${erasePlan.staticFabErase.railModuleCount}개와 장비 ${erasePlan.staticFabErase.equipmentGroupCount}개를 잘라낼 준비가 되었습니다`,
				clipboard: Object.freeze({
					kind: "area",
					template: staticFabTemplate.rail,
					staticFabTemplate,
				}),
				erasePlan,
			});
		}

		const staleReason = railAreaSelectionStaleReason(map, ownership, selection);
		if (staleReason) return invalidAreaCut(staleReason);
		const template = createRailAreaStampTemplateFromValidatedSelection(selection);
		const erasePlan = planRailAreaBulldoze(map, ownership, selection);
		if (!erasePlan.valid) return invalidAreaCut(erasePlan.reason);
		const invalidatedPorts = railPatchInvalidatedPorts(
			map,
			erasePlan.mutations,
			erasePlan.switchMutations,
			portEquipment,
		);
		if (invalidatedPorts.length > 0) {
			return invalidAreaCut(
				`선택 레일을 잘라내면 PORT-${invalidatedPorts[0]?.id ?? "?"} 등 ${invalidatedPorts.length}개 포트가 레일을 잃습니다 · 장비까지 영역 선택하세요`,
			);
		}
		return Object.freeze({
			valid: true,
			reason: `레일 모듈 ${selection.ownerships.length}개를 잘라낼 준비가 되었습니다`,
			clipboard: Object.freeze({ kind: "area", template }),
			erasePlan,
		});
	} catch (error) {
		return invalidAreaCut(
			error instanceof Error ? error.message : "선택 영역을 잘라낼 수 없습니다",
		);
	}
}

/** Prepare a single-module cut without changing document, selection, history, or clipboard state. */
export function prepareRailModuleCut(
	input: Readonly<{
		map: TileMap;
		portEquipment: PortEquipmentState;
		module: RailModuleOwnership;
	}>,
): PreparedRailModuleCut {
	try {
		const template = createRailModuleStampTemplate(input.module);
		const erasePlan = planRailModuleBulldoze(input.map, input.module);
		if (!erasePlan.valid) return invalidModuleCut(erasePlan.reason);
		const invalidatedPorts = railPatchInvalidatedPorts(
			input.map,
			erasePlan.mutations,
			erasePlan.switchMutations,
			input.portEquipment,
		);
		if (invalidatedPorts.length > 0) {
			return invalidModuleCut(
				`이 모듈을 잘라내면 PORT-${invalidatedPorts[0]?.id ?? "?"} 등 ${invalidatedPorts.length}개 포트가 레일을 잃습니다 · 장비까지 영역 선택하세요`,
			);
		}
		return Object.freeze({
			valid: true,
			reason: `${input.module.key} 모듈을 잘라낼 준비가 되었습니다`,
			clipboard: Object.freeze({ kind: "module", template }),
			erasePlan,
		});
	} catch (error) {
		return invalidModuleCut(
			error instanceof Error ? error.message : "레일 모듈을 잘라낼 수 없습니다",
		);
	}
}

function sameRailSelection(left: RailAreaSelection, right: RailAreaSelection): boolean {
	if (left.revision !== right.revision || left.ownerships.length !== right.ownerships.length) {
		return false;
	}
	const rightKeys = new Set(right.ownerships.map((ownership) => ownership.key));
	return left.ownerships.every((ownership) => rightKeys.has(ownership.key));
}

function invalidAreaCut(reason: string): PreparedRailAreaCut {
	return Object.freeze({ valid: false, reason, clipboard: null, erasePlan: null });
}

function invalidModuleCut(reason: string): PreparedRailModuleCut {
	return Object.freeze({ valid: false, reason, clipboard: null, erasePlan: null });
}
