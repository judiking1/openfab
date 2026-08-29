export const CONTEXTUAL_BLUEPRINT_SAVE_DESTINATIONS = ["project", "user-library"] as const;
export const CONTEXTUAL_BLUEPRINT_QUICK_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type ContextualBlueprintSaveDestination =
	(typeof CONTEXTUAL_BLUEPRINT_SAVE_DESTINATIONS)[number];
export type ContextualBlueprintQuickSlot = (typeof CONTEXTUAL_BLUEPRINT_QUICK_SLOTS)[number];
export type ContextualBlueprintSaveSourceKind =
	| "area-selection"
	| "organization-selection"
	| "area-ghost"
	| "organization-ghost"
	| "whole-map";

export interface ContextualBlueprintSaveSourceSummary {
	readonly kind: ContextualBlueprintSaveSourceKind;
	readonly label: string;
	readonly moduleCount: number;
	readonly edgeCount: number;
	readonly equipmentGroupCount: number;
	readonly portCount: number;
	readonly organizationCount: number;
}

export interface ContextualBlueprintSaveDraft {
	readonly name: string;
	readonly folder: string;
	readonly destination: ContextualBlueprintSaveDestination;
	readonly quickSlot: ContextualBlueprintQuickSlot | null;
}

export type ContextualBlueprintSaveInvalidField = "name" | "folder" | "quick-slot";

export type ContextualBlueprintSaveValidation =
	| Readonly<{
			valid: true;
			name: string;
			folder: string;
			folderPath: readonly string[];
			destination: ContextualBlueprintSaveDestination;
			quickSlot: ContextualBlueprintQuickSlot | null;
	  }>
	| Readonly<{
			valid: false;
			field: ContextualBlueprintSaveInvalidField;
			reason: string;
	  }>;

/**
 * Validate the portable metadata before either the project store or installation library runs.
 * This contract deliberately contains no React, browser storage, or file-system dependency.
 */
export function validateContextualBlueprintSaveDraft(
	draft: ContextualBlueprintSaveDraft,
	occupiedQuickSlots: ReadonlySet<number> = new Set<number>(),
): ContextualBlueprintSaveValidation {
	const name = normalizeContextualBlueprintName(draft.name);
	if (!name) {
		return invalid("name", "청사진 이름을 입력하세요");
	}
	if (draft.name.length > 80) {
		return invalid("name", "청사진 이름은 최대 80자까지 입력할 수 있습니다");
	}
	if (containsAsciiControlCharacter(draft.name)) {
		return invalid("name", "청사진 이름에는 제어 문자를 사용할 수 없습니다");
	}
	if (name !== draft.name) {
		return invalid("name", "청사진 이름의 앞뒤 또는 연속 공백을 정리하세요");
	}

	const folderResult = validateFolder(draft.folder);
	if (!folderResult.valid) return folderResult;

	const quickSlot = draft.destination === "user-library" ? draft.quickSlot : null;
	if (quickSlot !== null) {
		if (!CONTEXTUAL_BLUEPRINT_QUICK_SLOTS.includes(quickSlot)) {
			return invalid("quick-slot", "Quick slot은 1부터 9까지 선택할 수 있습니다");
		}
		if (occupiedQuickSlots.has(quickSlot)) {
			return invalid("quick-slot", `Quick slot ${quickSlot}은 이미 사용 중입니다`);
		}
	}

	return Object.freeze({
		valid: true,
		name,
		folder: folderResult.folder,
		folderPath: folderResult.folderPath,
		destination: draft.destination,
		quickSlot,
	});
}

export function normalizeContextualBlueprintName(value: string): string {
	return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function normalizeContextualBlueprintFolder(value: string): string {
	return value
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0)
		.join("/");
}

function validateFolder(
	value: string,
):
	| Readonly<{ valid: true; folder: string; folderPath: readonly string[] }>
	| Extract<ContextualBlueprintSaveValidation, { valid: false }> {
	if (value.length > 160) {
		return invalid("folder", "폴더 경로는 최대 160자까지 입력할 수 있습니다");
	}
	if (containsAsciiControlCharacter(value) || value.includes("\\")) {
		return invalid("folder", "폴더에는 제어 문자나 역슬래시를 사용할 수 없습니다");
	}
	if (!value.trim()) {
		return Object.freeze({ valid: true, folder: "", folderPath: Object.freeze([]) });
	}
	const rawSegments = value.split("/");
	if (rawSegments.length > 4) {
		return invalid("folder", "폴더는 최대 4단계까지 만들 수 있습니다");
	}
	const folderPath: string[] = [];
	for (const rawSegment of rawSegments) {
		const segment = rawSegment.trim();
		if (!segment) return invalid("folder", "폴더 이름 사이를 비워 둘 수 없습니다");
		if (segment === "." || segment === "..") {
			return invalid("folder", "폴더 이름으로 . 또는 ..을 사용할 수 없습니다");
		}
		if (segment.length > 40) {
			return invalid("folder", "각 폴더 이름은 최대 40자까지 입력할 수 있습니다");
		}
		folderPath.push(segment);
	}
	return Object.freeze({
		valid: true,
		folder: folderPath.join("/"),
		folderPath: Object.freeze(folderPath),
	});
}

function invalid(
	field: ContextualBlueprintSaveInvalidField,
	reason: string,
): Extract<ContextualBlueprintSaveValidation, { valid: false }> {
	return Object.freeze({ valid: false, field, reason });
}

function containsAsciiControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) < 0x20) return true;
	}
	return false;
}
