import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import {
	STATIC_FAB_ARRANGEMENT_MAX_ROOTS,
	STATIC_FAB_ARRANGEMENT_VERSION,
	type StaticFabArrangementAxis,
	type StaticFabArrangementMode,
} from "./StaticFabArrangement";
import type { StaticFabOrganizationSelectionMode } from "./StaticFabOrganizationSelection";

export const STATIC_FAB_ARRANGEMENT_COMMAND_VERSION = 1 as const;
export const STATIC_FAB_ARRANGEMENT_COMMAND_MAX_MODULE_KEYS = 200_000;
export const STATIC_FAB_ARRANGEMENT_COMMAND_MAX_KEY_LENGTH = 256;

export interface StaticFabComponentArrangementRootReference {
	readonly kind: "STATIC_COMPONENT";
	readonly moduleKeys: readonly string[];
}

export interface StaticFabOrganizationArrangementRootReference {
	readonly kind: "ORGANIZATION";
	readonly organizationId: number;
	readonly selectionMode: StaticFabOrganizationSelectionMode;
}

export type StaticFabArrangementRootReference =
	| StaticFabComponentArrangementRootReference
	| StaticFabOrganizationArrangementRootReference;

/** Portable user intent. The Worker re-resolves every reference from its exact source snapshot. */
export interface StaticFabArrangementCommandIntent {
	readonly version: typeof STATIC_FAB_ARRANGEMENT_COMMAND_VERSION;
	readonly arrangementVersion: typeof STATIC_FAB_ARRANGEMENT_VERSION;
	readonly axis: StaticFabArrangementAxis;
	readonly mode: StaticFabArrangementMode;
	readonly roots: readonly StaticFabArrangementRootReference[];
}

export type StaticFabArrangementCommandPreparation =
	| {
			readonly valid: true;
			readonly reason: string;
			readonly intent: StaticFabArrangementCommandIntent;
	  }
	| { readonly valid: false; readonly reason: string; readonly intent: null };

/** Canonicalize untrusted UI/Worker input before it can name authored content. */
export function prepareStaticFabArrangementCommand(
	input: unknown,
): StaticFabArrangementCommandPreparation {
	if (!isRecord(input)) return failure("정렬 명령 형식이 유효하지 않습니다");
	if (
		input.version !== STATIC_FAB_ARRANGEMENT_COMMAND_VERSION ||
		input.arrangementVersion !== STATIC_FAB_ARRANGEMENT_VERSION ||
		(input.axis !== "X" && input.axis !== "Z") ||
		!isMode(input.mode) ||
		!Array.isArray(input.roots)
	) {
		return failure("정렬 명령의 버전, 축 또는 방식이 유효하지 않습니다");
	}
	if (input.roots.length === 0) return failure("정렬할 루트를 하나 이상 지정하세요");
	if (input.roots.length > STATIC_FAB_ARRANGEMENT_MAX_ROOTS) {
		return failure(`정렬 루트는 최대 ${STATIC_FAB_ARRANGEMENT_MAX_ROOTS.toLocaleString()}개입니다`);
	}
	const roots: StaticFabArrangementRootReference[] = [];
	const canonicalRootKeys = new Set<string>();
	let totalModuleKeys = 0;
	for (const value of input.roots) {
		if (!isRecord(value)) return failure("정렬 루트 참조가 유효하지 않습니다");
		let root: StaticFabArrangementRootReference;
		let canonicalKey: string;
		if (value.kind === "STATIC_COMPONENT") {
			if (!Array.isArray(value.moduleKeys) || value.moduleKeys.length === 0) {
				return failure("정적 컴포넌트에는 하나 이상의 레일 모듈 key가 필요합니다");
			}
			totalModuleKeys += value.moduleKeys.length;
			if (totalModuleKeys > STATIC_FAB_ARRANGEMENT_COMMAND_MAX_MODULE_KEYS) {
				return failure(
					`정렬 명령의 레일 모듈 key는 최대 ${STATIC_FAB_ARRANGEMENT_COMMAND_MAX_MODULE_KEYS.toLocaleString()}개입니다`,
				);
			}
			const moduleKeys = [...new Set(value.moduleKeys)];
			if (
				moduleKeys.length !== value.moduleKeys.length ||
				moduleKeys.some(
					(key) =>
						typeof key !== "string" ||
						key.length === 0 ||
						key.length > STATIC_FAB_ARRANGEMENT_COMMAND_MAX_KEY_LENGTH,
				)
			) {
				return failure("정적 컴포넌트의 레일 모듈 key가 유효하지 않거나 중복되었습니다");
			}
			moduleKeys.sort(compareText);
			canonicalKey = `C:${moduleKeys.join("\u001f")}`;
			root = Object.freeze({ kind: "STATIC_COMPONENT", moduleKeys: Object.freeze(moduleKeys) });
		} else if (value.kind === "ORGANIZATION") {
			if (
				!positiveInt32(value.organizationId) ||
				(value.selectionMode !== "DIRECT" && value.selectionMode !== "EFFECTIVE")
			) {
				return failure("조직 정렬 루트의 ID 또는 선택 범위가 유효하지 않습니다");
			}
			canonicalKey = `O:${value.organizationId}:${value.selectionMode}`;
			root = Object.freeze({
				kind: "ORGANIZATION",
				organizationId: value.organizationId,
				selectionMode: value.selectionMode,
			});
		} else {
			return failure("지원하지 않는 정렬 루트 종류입니다");
		}
		if (canonicalRootKeys.has(canonicalKey)) return failure("정렬 루트 참조가 중복되었습니다");
		canonicalRootKeys.add(canonicalKey);
		roots.push(root);
	}
	const intent = Object.freeze({
		version: STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
		arrangementVersion: STATIC_FAB_ARRANGEMENT_VERSION,
		axis: input.axis,
		mode: input.mode,
		roots: Object.freeze(roots),
	} satisfies StaticFabArrangementCommandIntent);
	return Object.freeze({
		valid: true,
		reason: `${roots.length}개 정렬 루트를 확인했습니다`,
		intent,
	});
}

export function staticFabArrangementCommandFingerprint(input: unknown): string {
	const prepared = prepareStaticFabArrangementCommand(input);
	if (!prepared.valid) throw new TypeError(prepared.reason);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"STATIC_FAB_ARRANGEMENT_COMMAND",
		prepared.intent.axis,
		prepared.intent.mode,
	]);
	checksum.addNumbers([
		prepared.intent.version,
		prepared.intent.arrangementVersion,
		prepared.intent.roots.length,
	]);
	for (const root of prepared.intent.roots) {
		checksum.addStrings([root.kind]);
		if (root.kind === "STATIC_COMPONENT") {
			checksum.addNumbers([root.moduleKeys.length]);
			checksum.addStrings(root.moduleKeys);
		} else {
			checksum.addNumbers([root.organizationId]);
			checksum.addStrings([root.selectionMode]);
		}
	}
	return checksum.digest();
}

function failure(reason: string): StaticFabArrangementCommandPreparation {
	return Object.freeze({ valid: false, reason, intent: null });
}

function isMode(value: unknown): value is StaticFabArrangementMode {
	return (
		value === "ALIGN_MIN" ||
		value === "ALIGN_CENTER" ||
		value === "ALIGN_MAX" ||
		value === "DISTRIBUTE_CENTERS" ||
		value === "DISTRIBUTE_GAPS"
	);
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
