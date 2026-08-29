import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	createRailAreaSelectionFromOwnerships,
	type RailAreaSelection,
} from "../core/RailAreaSelection";
import type { RailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	prepareStaticFabArrangementCommand,
	type StaticFabArrangementCommandIntent,
} from "../core/StaticFabArrangementCommand";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import type { TileMap } from "../core/TileMap";
import type { CompiledPortEquipmentPresentation } from "./PortEquipmentPresentation";
import {
	type ResolvedStaticFabArrangementRoot,
	resolveStaticFabOrganizationArrangementRoots,
	resolveStaticFabSelectionArrangementRoots,
	type StaticFabArrangementRootFailureCode,
	validateResolvedStaticFabArrangementRoots,
} from "./StaticFabArrangementRoots";

export type StaticFabArrangementCommandResolution =
	| {
			readonly valid: true;
			readonly reason: string;
			readonly intent: StaticFabArrangementCommandIntent;
			readonly roots: readonly ResolvedStaticFabArrangementRoot[];
	  }
	| {
			readonly valid: false;
			readonly code: StaticFabArrangementRootFailureCode | "INVALID_COMMAND";
			readonly reason: string;
			readonly intent: null;
			readonly roots: readonly [];
	  };

/** Re-resolve every portable root reference from exact authored truth. */
export function resolveStaticFabArrangementCommand(
	map: TileMap,
	ownership: RailModuleOwnershipIndex,
	portEquipment: PortEquipmentState,
	patchSequence: number,
	organizations: StaticFabOrganizationState,
	input: unknown,
	presentation: CompiledPortEquipmentPresentation | null = null,
): StaticFabArrangementCommandResolution {
	const prepared = prepareStaticFabArrangementCommand(input);
	if (!prepared.valid) return failure("INVALID_COMMAND", prepared.reason);
	const roots: ResolvedStaticFabArrangementRoot[] = [];
	for (const reference of prepared.intent.roots) {
		if (reference.kind === "STATIC_COMPONENT") {
			const modules = reference.moduleKeys.map((key) => ownership.find(key));
			const missingIndex = modules.indexOf(null);
			if (missingIndex >= 0) {
				return failure(
					"MISSING_ROOT",
					`레일 모듈 '${reference.moduleKeys[missingIndex]}'을 현재 정적 FAB에서 찾을 수 없습니다`,
				);
			}
			let rail: RailAreaSelection;
			try {
				rail = createRailAreaSelectionFromOwnerships(
					ownership,
					modules as NonNullable<(typeof modules)[number]>[],
					"fully-contained",
				);
			} catch (error) {
				return failure(
					"INVALID_SOURCE",
					error instanceof Error ? error.message : "정적 컴포넌트를 다시 선택할 수 없습니다",
				);
			}
			const selection = createStaticFabSelection(rail, portEquipment, patchSequence, []);
			const resolution = resolveStaticFabSelectionArrangementRoots(
				map,
				ownership,
				portEquipment,
				patchSequence,
				selection,
				presentation,
			);
			if (!resolution.valid) return failure(resolution.code, resolution.reason);
			if (resolution.roots.length !== 1) {
				return failure(
					"INVALID_SOURCE",
					"하나의 정적 컴포넌트 참조가 둘 이상의 연결 컴포넌트로 분리되었습니다",
				);
			}
			const root = resolution.roots[0] as ResolvedStaticFabArrangementRoot;
			if (!sameStrings(root.moduleKeys, reference.moduleKeys)) {
				return failure(
					"INVALID_SOURCE",
					"정적 컴포넌트의 레일 모듈 경계가 명령 생성 이후 변경되었습니다",
				);
			}
			roots.push(root);
			continue;
		}
		const resolution = resolveStaticFabOrganizationArrangementRoots(
			map,
			ownership,
			portEquipment,
			patchSequence,
			organizations,
			[reference.organizationId],
			reference.selectionMode,
			presentation,
		);
		if (!resolution.valid) return failure(resolution.code, resolution.reason);
		if (resolution.roots.length !== 1) {
			return failure(
				"INVALID_SOURCE",
				`조직 ${reference.organizationId}의 정렬 루트가 유일하지 않습니다`,
			);
		}
		roots.push(resolution.roots[0] as ResolvedStaticFabArrangementRoot);
	}
	const validation = validateResolvedStaticFabArrangementRoots(roots);
	if (!validation.valid) return failure(validation.code, validation.reason);
	return Object.freeze({
		valid: true,
		reason: `${validation.roots.length}개 정렬 루트를 현재 스냅샷에서 다시 확인했습니다`,
		intent: prepared.intent,
		roots: validation.roots,
	});
}

function failure(
	code: StaticFabArrangementRootFailureCode | "INVALID_COMMAND",
	reason: string,
): StaticFabArrangementCommandResolution {
	return Object.freeze({
		valid: false,
		code,
		reason,
		intent: null,
		roots: Object.freeze([]) as [],
	});
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
