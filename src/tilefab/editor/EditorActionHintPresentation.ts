import { type EditorCommandId, editorCommandHintBinding } from "./EditorCommandRegistry";
import type { EditorTool } from "./EditorTool";

export interface EditorActionHint {
	readonly id: string;
	readonly commandIds: readonly EditorCommandId[];
	readonly inputs: readonly string[];
	readonly action: string;
	readonly pointer?: boolean;
	readonly inputJoin?: "plus" | "or";
}

export interface EditorActionHintContext {
	readonly tool: EditorTool;
	readonly reshapeKind?: "straight" | "corner" | "endpoint" | null;
	readonly ohbPlacementIntentActive: boolean;
	readonly equipmentGroupEditActive: boolean;
	readonly equipmentMembershipEditType: "EQ" | "STK" | null;
	readonly hasAreaSelection: boolean;
	readonly hasEquipmentSelection: boolean;
	readonly hasPortEquipmentSelection: boolean;
	readonly hasAuthoredEquipment: boolean;
	readonly hasAuthoredRails: boolean;
	readonly areaSelectionCopyable: boolean;
	readonly hasSingleSelection: boolean;
	readonly hasCloneableSelection: boolean;
	readonly areaStampActive: boolean;
	readonly placementExitIsCancellation: boolean;
	readonly placementPrimaryIsSingleCommit: boolean;
	readonly organizationBundleActive: boolean;
	readonly moduleStampActive: boolean;
	readonly templateActive: boolean;
	readonly stkDraftActive: boolean;
	readonly stkKeyboardActive: boolean;
	readonly eqKeyboardActive: boolean;
	readonly eqKeyboardDraftActive: boolean;
}

export function editorActionHint(
	id: string,
	commandId: EditorCommandId,
	action: string,
	options: Readonly<{
		bindingIndex?: number;
		includeAllBindings?: boolean;
	}> = {},
): EditorActionHint {
	const binding = editorCommandHintBinding(commandId, options);
	return Object.freeze({
		id,
		commandIds: Object.freeze([commandId]),
		inputs: binding.inputs,
		action,
		pointer: binding.pointer,
		inputJoin: binding.inputJoin,
	});
}

function editorActionHintAlternatives(
	id: string,
	commandIds: readonly EditorCommandId[],
	action: string,
): EditorActionHint {
	const bindings = commandIds.map((commandId) => editorCommandHintBinding(commandId));
	return Object.freeze({
		id,
		commandIds: Object.freeze([...commandIds]),
		inputs: Object.freeze(bindings.map((binding) => binding.inputs.join(" + "))),
		action,
		pointer: bindings.some((binding) => binding.pointer),
		inputJoin: "or",
	});
}

export function deriveEditorActionHints(
	context: EditorActionHintContext,
): readonly EditorActionHint[] {
	if (context.ohbPlacementIntentActive) {
		return Object.freeze([
			editorActionHint("navigate-ohb-transform", "equipment.navigate", "대상 슬롯 이동"),
			editorActionHint("apply-ohb-transform", "command.apply", "이동·복제 확정"),
			editorActionHint("click-ohb-transform", "canvas.primary-click", "가리킨 슬롯 확정"),
			editorActionHint("cancel-ohb-transform", "command.cancel", "이동·복제 취소"),
			editorActionHint("pan-ohb-transform", "camera.pan-pointer", "화면 이동"),
		]);
	}
	if (context.equipmentGroupEditActive) {
		return Object.freeze([
			editorActionHint("place-equipment-group", "canvas.primary-click", "그룹 전체 배치"),
			editorActionHint("cancel-equipment-group", "command.cancel", "그룹 편집 취소", {
				includeAllBindings: true,
			}),
			editorActionHint("pan-equipment-group", "camera.pan-pointer", "화면 이동"),
		]);
	}
	if (context.equipmentMembershipEditType) {
		return Object.freeze([
			editorActionHint(
				"edit-equipment-membership",
				context.equipmentMembershipEditType === "EQ"
					? "canvas.primary-drag"
					: "canvas.primary-click",
				context.equipmentMembershipEditType === "EQ" ? "끝점 늘이기·줄이기" : "포트 추가·제거",
			),
			editorActionHint(
				"navigate-equipment-membership",
				"equipment.navigate",
				context.equipmentMembershipEditType === "EQ" ? "끝점 이동" : "커서 이동",
			),
			...(context.equipmentMembershipEditType === "EQ"
				? [editorActionHint("switch-equipment-endpoint", "equipment.switch-endpoint", "반대 끝점")]
				: [
						editorActionHint(
							"toggle-equipment-membership",
							"equipment.toggle-slot",
							"포트 추가·제거",
						),
					]),
			editorActionHint("complete-equipment-membership", "command.apply", "변경 완료"),
			editorActionHint("cancel-equipment-membership", "command.cancel", "변경 취소"),
			editorActionHint("pan-equipment-membership", "camera.pan-pointer", "화면 이동"),
		]);
	}
	if (context.areaStampActive || context.organizationBundleActive || context.moduleStampActive) {
		const repeatPlacementActive =
			context.areaStampActive || context.organizationBundleActive || context.moduleStampActive;
		return Object.freeze([
			context.areaStampActive || context.organizationBundleActive || context.moduleStampActive
				? editorActionHintAlternatives(
						"place-blueprint",
						["canvas.primary-click", "placement.apply"],
						context.placementPrimaryIsSingleCommit ? "여기에 1회 배치" : "여기에 배치",
					)
				: editorActionHint(
						"place-blueprint",
						"canvas.primary-click",
						repeatPlacementActive ? "여기에 배치" : "청사진 배치",
					),
			editorActionHint(
				"cancel-blueprint",
				"command.cancel",
				repeatPlacementActive && !context.placementExitIsCancellation ? "배치 종료" : "배치 취소",
				{ includeAllBindings: true },
			),
			editorActionHint("rotate-blueprint", "placement.rotate-clockwise", "회전"),
			...(context.areaStampActive
				? [editorActionHint("reverse-blueprint", "placement.reverse-flow", "진행 방향 반전")]
				: []),
			...(repeatPlacementActive
				? [
						editorActionHint(
							"save-project-during-placement",
							"project.save-context",
							"프로젝트 저장",
						),
					]
				: []),
			editorActionHint("recall-blueprint", "blueprint.paste-recent", "최근 청사진"),
			editorActionHint("cycle-blueprint", "blueprint.cycle-recent", "최근 기록 전환"),
		]);
	}
	if (context.templateActive) {
		return Object.freeze([
			editorActionHint("place-template", "canvas.primary-click", "패턴 배치"),
			editorActionHint("rotate-template", "placement.rotate-clockwise", "회전"),
			editorActionHintAlternatives(
				"resize-template",
				["template.resize-decrease", "template.resize-increase"],
				"치수",
			),
			editorActionHint("open-blueprints", "blueprint.open-library", "청사진 라이브러리"),
			editorActionHint("cancel-template", "command.cancel", "배치 취소"),
		]);
	}
	if (context.tool === "reshape") {
		const action =
			context.reshapeKind === "straight"
				? "직선 평행 이동"
				: context.reshapeKind === "corner"
					? "코너 이동"
					: context.reshapeKind === "endpoint"
						? "끝점 이동"
						: "레일 위치 이동";
		return Object.freeze([
			editorActionHint("move-reshape", "reshape.navigate", action),
			editorActionHint("apply-reshape", "command.apply", "이동 적용"),
			editorActionHintAlternatives(
				"pointer-reshape",
				["canvas.primary-click", "canvas.primary-drag"],
				action,
			),
			editorActionHint("cancel-reshape", "command.cancel", "이동 취소", {
				includeAllBindings: true,
			}),
			editorActionHint("pan-reshape", "camera.pan-pointer", "화면 이동"),
		]);
	}
	if (context.hasAreaSelection) {
		return Object.freeze([
			editorActionHint("toggle-selection-item", "selection.toggle-pointer", "항목 추가·제거"),
			editorActionHint("add-selection", "selection.add-area", "선택 추가"),
			editorActionHint("subtract-selection", "selection.subtract-area", "선택 제외"),
			editorActionHint("connected-selection", "selection.connected", "연결 구조 전체"),
			context.areaSelectionCopyable
				? editorActionHint(
						"clone-selection",
						"selection.copy",
						context.hasEquipmentSelection ? "정적 FAB 복제" : "선택 레일 복제",
					)
				: editorActionHint("selection-actions", "selection.clone-hovered", "편집 명령"),
			editorActionHint(
				"cut-selection",
				"selection.cut",
				context.hasEquipmentSelection ? "정적 FAB 잘라내기" : "선택 레일 잘라내기",
			),
			editorActionHint("save-project", "project.save-context", "프로젝트 저장"),
			editorActionHint(
				"delete-selection",
				"selection.delete",
				context.hasEquipmentSelection ? "장비 포함 철거" : "철거",
			),
		]);
	}
	if (context.hasPortEquipmentSelection) {
		return Object.freeze([
			editorActionHint("connected-selection", "selection.connected", "연결 구조 전체"),
			editorActionHint("select-next-equipment", "canvas.primary-click", "다른 장비·Port로 전환"),
			editorActionHint("clear-equipment-selection", "command.cancel", "선택 닫기"),
			editorActionHint("pan-equipment-selection", "camera.pan-pointer", "화면 이동"),
		]);
	}
	if (context.hasSingleSelection) {
		if (!context.hasCloneableSelection) {
			return Object.freeze([
				editorActionHint("clear-readonly-selection", "command.cancel", "읽기 전용 선택 해제"),
			]);
		}
		return Object.freeze([
			editorActionHint("toggle-selection-item", "selection.toggle-pointer", "항목 추가·제거"),
			editorActionHint("extend-selection", "selection.add-area", "영역 선택"),
			editorActionHint("connected-selection", "selection.connected", "연결 구조 전체"),
			editorActionHint("clone-module", "selection.copy", "선택 복제"),
			editorActionHint("cut-module", "selection.cut", "잘라내기"),
			editorActionHint("delete-module", "selection.delete", "철거"),
			editorActionHint("clear-module", "command.cancel", "선택 해제"),
		]);
	}
	if (context.tool === "stk") {
		if (context.stkKeyboardActive) {
			return Object.freeze([
				editorActionHint("navigate-stk-port", "equipment.navigate", "다음 Port 슬롯 이동"),
				editorActionHint("choose-stk-port", "command.apply", "Port 추가·제거"),
				editorActionHint(
					"complete-stk",
					"equipment.complete-stk",
					context.stkDraftActive ? "Stocker 생성" : "Port 선택 후 Stocker 생성",
				),
				editorActionHint(
					"cancel-stk",
					"command.cancel",
					context.stkDraftActive ? "선택 취소" : "배치 종료",
				),
			]);
		}
		return Object.freeze([
			editorActionHint("choose-stk-port", "canvas.primary-click", "포트 추가·제거"),
			{
				id: "complete-stk",
				commandIds: Object.freeze([]),
				inputs: ["Stocker 생성"],
				action: context.stkDraftActive ? "Stocker 생성" : "Port 선택 후 Stocker 생성",
			},
			editorActionHint(
				"cancel-stk",
				"command.cancel",
				context.stkDraftActive ? "선택 취소" : "배치 종료",
			),
			editorActionHint("pan-stk", "camera.pan-pointer", "화면 이동"),
		]);
	}
	if (context.tool === "ohb") {
		return Object.freeze([
			editorActionHint("place-ohb", "canvas.primary-click", "OHB 1개"),
			editorActionHint("place-ohb-row", "canvas.primary-drag", "OHB 행 배치"),
			editorActionHint("cancel-port", "command.cancel", "배치 종료"),
			editorActionHint("pan-port", "camera.pan-pointer", "화면 이동"),
		]);
	}
	if (context.tool === "eq") {
		if (context.eqKeyboardActive) {
			return Object.freeze([
				editorActionHint(
					"navigate-eq-port",
					"equipment.navigate",
					context.eqKeyboardDraftActive ? "2번 끝점 이동" : "CENTER 이동",
				),
				editorActionHint(
					"apply-eq-port",
					"command.apply",
					context.eqKeyboardDraftActive ? "EQ 행 확정" : "1번 시작 선택",
				),
				editorActionHint(
					"cancel-port",
					"command.cancel",
					context.eqKeyboardDraftActive ? "행 선택 취소" : "배치 종료",
				),
				editorActionHint("pan-port", "camera.pan-pointer", "화면 이동"),
			]);
		}
		return Object.freeze([
			editorActionHint("place-eq-row", "canvas.primary-drag", "한 기기의 포트 행"),
			editorActionHint("select-anywhere", "selection.add-area", "레일 선택"),
			editorActionHint(
				"cancel-port",
				"command.cancel",
				context.eqKeyboardDraftActive ? "행 선택 취소" : "배치 종료",
			),
			editorActionHint("pan-port", "camera.pan-pointer", "화면 이동"),
		]);
	}
	if (context.tool === "erase") {
		return Object.freeze([
			editorActionHint("erase-route", "canvas.primary-drag", "정확한 철거"),
			editorActionHint("select-while-erase", "selection.add-area", "영역 선택"),
			editorActionHint("pan-erase", "camera.pan-pointer", "화면 이동"),
			editorActionHint("cancel-erase", "command.cancel", "취소"),
		]);
	}
	if (context.tool === "inspect") {
		return Object.freeze([
			editorActionHint(
				"select-module",
				"canvas.primary-click",
				context.hasAuthoredEquipment ? "레일·장비·Port 선택" : "레일 선택",
			),
			editorActionHint("select-partial-area", "canvas.primary-drag", "부분 영역 선택"),
			editorActionHint("select-connected", "selection.connected", "호버 연결 전체"),
			editorActionHint("clone-hovered", "selection.clone-hovered", "호버 항목 복제"),
			editorActionHint("open-blueprints", "blueprint.open-library", "청사진 라이브러리"),
			editorActionHint("pan-inspect", "camera.pan-pointer", "화면 이동"),
		]);
	}
	return Object.freeze([
		editorActionHintAlternatives(
			"build-track",
			["canvas.primary-drag", "command.apply"],
			"레일 건설",
		),
		editorActionHintAlternatives(
			"rotate-build",
			["construction.rotate-left", "construction.rotate-right"],
			"방향·코너",
		),
		...(context.hasAuthoredRails
			? [
					editorActionHint("select-while-building", "selection.add-area", "영역 선택"),
					editorActionHint("clone-hovered", "selection.clone-hovered", "호버 항목 복제"),
				]
			: []),
		editorActionHint("open-blueprints", "blueprint.open-library", "청사진 라이브러리"),
		editorActionHint("pan-build", "camera.pan-pointer", "화면 이동"),
	]);
}
