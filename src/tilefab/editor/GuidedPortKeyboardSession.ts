import type { CompiledPortSlots } from "../compile/PortSlotCompiler";
import { PORT_SLOT_STATUS } from "../compile/PortSlotCompiler";
import type { PreparedPortSlotAvailabilityIndex } from "../compile/PortSlotPreparedArtifacts";
import type { RailDocument } from "../core/RailDocument";

export type GuidedPortKeyboardType = "OHB" | "EQ" | "STK";
export type GuidedPortKeyboardPhase = "choose-slot" | "choose-end";
export type GuidedPortKeyboardDirection = "up" | "down" | "left" | "right";
export type GuidedPortKeyboardScope = "guided" | "ordinary";

export interface GuidedPortKeyboardBinding {
	readonly modelGeneration: number;
	readonly document: RailDocument;
	readonly slots: CompiledPortSlots;
	readonly availability: PreparedPortSlotAvailabilityIndex;
	readonly revision: number;
	readonly patchSequence: number;
}

export interface GuidedPortKeyboardSession {
	readonly scope: GuidedPortKeyboardScope;
	readonly portType: GuidedPortKeyboardType;
	readonly phase: GuidedPortKeyboardPhase;
	readonly anchorRow: number | null;
	readonly currentRow: number;
	readonly binding: GuidedPortKeyboardBinding;
}

export interface GuidedPortKeyboardAccessiblePresentation {
	readonly summary: string;
	readonly validityKey: string;
}

export type OrdinaryPortKeyboardEscapeAction =
	| "exit-authoring"
	| "reset-eq-row"
	| "reset-stk-draft";

export interface OrdinaryPortKeyboardEscapePresentation {
	readonly action: OrdinaryPortKeyboardEscapeAction;
	readonly message: string;
}

export function ordinaryPortKeyboardEscapePresentation(
	portType: GuidedPortKeyboardType,
	phase: GuidedPortKeyboardPhase,
	selectedPortCount = 0,
): OrdinaryPortKeyboardEscapePresentation {
	if (portType === "EQ" && phase === "choose-end") {
		return Object.freeze({
			action: "reset-eq-row",
			message: "EQ 행 선택을 취소했습니다 · 1번 시작을 다시 선택하세요",
		});
	}
	if (portType === "STK" && selectedPortCount > 0) {
		return Object.freeze({
			action: "reset-stk-draft",
			message: `STK Port ${selectedPortCount}개 선택을 초기화했습니다 · 첫 Port부터 다시 선택하세요`,
		});
	}
	return Object.freeze({
		action: "exit-authoring",
		message: `${portType} Port 배치를 종료했습니다 · Canvas에서 Rail 또는 Port를 선택하세요`,
	});
}

export function createGuidedPortKeyboardBinding(
	modelGeneration: number,
	document: RailDocument,
	slots: CompiledPortSlots,
	availability: PreparedPortSlotAvailabilityIndex,
): GuidedPortKeyboardBinding {
	return Object.freeze({
		modelGeneration,
		document,
		slots,
		availability,
		revision: document.map.getRevision(),
		patchSequence: document.getPatchSequence(),
	});
}

export function createGuidedPortKeyboardSession(
	portType: GuidedPortKeyboardType,
	currentRow: number,
	binding: GuidedPortKeyboardBinding,
	scope: GuidedPortKeyboardScope = "guided",
): GuidedPortKeyboardSession {
	if (!Number.isInteger(currentRow) || currentRow < 0 || currentRow >= binding.slots.count) {
		throw new RangeError("Guided Port keyboard row is outside the compiled slot catalog.");
	}
	if (binding.slots.portType !== portType) {
		throw new Error("Guided Port keyboard type does not match the compiled slot catalog.");
	}
	return Object.freeze({
		scope,
		portType,
		phase: "choose-slot",
		anchorRow: null,
		currentRow,
		binding,
	});
}

export function nearestPortKeyboardInitialRow(
	binding: GuidedPortKeyboardBinding,
	target: Readonly<{ x: number; z: number }>,
): number | null {
	if (!Number.isFinite(target.x) || !Number.isFinite(target.z)) {
		throw new TypeError("Port keyboard initial target must be finite.");
	}
	const { slots, availability } = binding;
	let nearestAnyRow: number | null = null;
	let nearestAnyDistance = Number.POSITIVE_INFINITY;
	let nearestLegalRow: number | null = null;
	let nearestLegalDistance = Number.POSITIVE_INFINITY;
	for (let row = 0; row < slots.count; row++) {
		const deltaX = (slots.routeXs[row] as number) - target.x;
		const deltaZ = (slots.routeZs[row] as number) - target.z;
		const distance = deltaX * deltaX + deltaZ * deltaZ;
		if (distance < nearestAnyDistance) {
			nearestAnyRow = row;
			nearestAnyDistance = distance;
		}
		if (
			distance < nearestLegalDistance &&
			availability.statusFor(slots, row).status === PORT_SLOT_STATUS.LEGAL
		) {
			nearestLegalRow = row;
			nearestLegalDistance = distance;
		}
	}
	return nearestLegalRow ?? nearestAnyRow;
}

export function guidedPortKeyboardSessionIsCurrent(
	session: GuidedPortKeyboardSession,
	current: GuidedPortKeyboardBinding,
): boolean {
	return (
		session.binding.modelGeneration === current.modelGeneration &&
		session.binding.document === current.document &&
		session.binding.slots === current.slots &&
		session.binding.availability === current.availability &&
		session.binding.revision === current.revision &&
		session.binding.patchSequence === current.patchSequence
	);
}

export function moveGuidedPortKeyboardCursor(
	session: GuidedPortKeyboardSession,
	currentRow: number,
): GuidedPortKeyboardSession {
	if (
		!Number.isInteger(currentRow) ||
		currentRow < 0 ||
		currentRow >= session.binding.slots.count
	) {
		return session;
	}
	return Object.freeze({ ...session, currentRow });
}

export function selectGuidedEqKeyboardAnchor(
	session: GuidedPortKeyboardSession,
): GuidedPortKeyboardSession {
	if (session.portType !== "EQ" || session.phase === "choose-end") return session;
	return Object.freeze({
		...session,
		phase: "choose-end",
		anchorRow: session.currentRow,
	});
}

export function guidedPortKeyboardOperationInstruction(
	portType: GuidedPortKeyboardType,
	phase: GuidedPortKeyboardPhase,
	scope: GuidedPortKeyboardScope = "guided",
	selectedPortCount = 0,
): string {
	if (portType === "EQ" && phase === "choose-end") {
		return "방향키 또는 WASD로 같은 레일의 끝 슬롯을 고르고 Enter로 EQ 행을 확정하세요. Esc는 미확정 행만 취소합니다.";
	}
	if (scope === "ordinary" && portType === "EQ") {
		return "방향키 또는 WASD로 EQ 시작 슬롯을 고르고 Enter로 선택하세요. Esc는 Port 배치를 종료합니다.";
	}
	if (portType === "EQ") {
		return "방향키 또는 WASD로 EQ 시작 슬롯을 고르고 Enter로 선택하세요. Esc는 미확정 위치만 취소합니다.";
	}
	if (portType === "STK" && scope === "ordinary") {
		return selectedPortCount > 0
			? `방향키 또는 WASD로 STK 슬롯을 고르고 Enter로 포트를 추가·제거하세요. Shift+Enter는 선택한 포트로 그룹을 확정하고 Esc는 현재 ${selectedPortCount}개 선택을 초기화합니다.`
			: "방향키 또는 WASD로 STK 슬롯을 고르고 Enter로 포트를 추가하세요. Esc는 Port 배치를 종료합니다.";
	}
	if (portType === "STK") {
		return "강조된 슬롯에서 Enter로 Port를 선택하세요. 선택을 확인한 뒤 STK 생성 또는 Shift+Enter로 생성합니다. Esc는 선택을 초기화합니다.";
	}
	if (portType === "OHB" && scope === "ordinary") {
		return "방향키 또는 WASD로 OHB 슬롯을 고르고 Enter로 배치하세요. Esc는 Port 배치를 종료합니다.";
	}
	return `방향키 또는 WASD로 ${portType} 슬롯을 고르고 Enter로 배치하세요. Esc는 미확정 위치만 취소합니다.`;
}

export function guidedPortKeyboardAccessiblePresentation(
	session: GuidedPortKeyboardSession,
	input: Readonly<{
		routeX: number;
		routeZ: number;
		legal: boolean;
		reason: string;
		selectedPortCount?: number;
	}>,
): GuidedPortKeyboardAccessiblePresentation {
	const coordinate = `X ${input.routeX}미터 · Z ${input.routeZ}미터`;
	const anchorRow =
		session.portType === "EQ" && session.phase === "choose-end" ? session.anchorRow : null;
	const anchorCoordinate =
		anchorRow !== null && anchorRow >= 0 && anchorRow < session.binding.slots.count
			? `X ${session.binding.slots.routeXs[anchorRow] as number}미터 · Z ${session.binding.slots.routeZs[anchorRow] as number}미터`
			: null;
	const legality = input.legal ? "배치 가능" : `배치 불가 · ${input.reason}`;
	const selected = Math.max(0, input.selectedPortCount ?? 0);
	const phase =
		session.portType === "EQ" ? (session.phase === "choose-end" ? "행" : "시작 슬롯") : "슬롯";
	const selectedSummary = session.portType === "STK" ? ` · 현재 ${selected}개 선택` : "";
	const applyInstruction =
		session.portType === "STK"
			? selected > 0
				? `Enter로 추가·제거 · Shift+Enter로 그룹 확정 · Esc로 ${selected}개 선택 초기화`
				: `Enter로 추가 · Esc로 ${session.scope === "ordinary" ? "Port 배치 종료" : "선택 초기화"}`
			: session.portType === "EQ" && session.phase === "choose-end"
				? "Enter로 행 확정 · Esc로 행 선택 취소"
				: `Enter로 ${
						session.portType === "EQ" && session.phase === "choose-slot" ? "시작점 선택" : "적용"
					}${session.scope === "ordinary" ? " · Esc로 Port 배치 종료" : ""}`;
	const positionSummary = anchorCoordinate
		? `1 시작 · ${anchorCoordinate} · 고정 · 2 끝 · ${coordinate}`
		: coordinate;
	return Object.freeze({
		summary: `키보드 ${session.portType} ${phase} · ${positionSummary}${selectedSummary} · ${legality} · ${applyInstruction}`,
		validityKey: `${session.portType}:${session.phase}:${input.legal ? "legal" : input.reason}:${selected}`,
	});
}
