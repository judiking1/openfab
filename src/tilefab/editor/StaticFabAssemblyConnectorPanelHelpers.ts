import type { RailModuleSide } from "../core/RailModulePlanner";
import type {
	StaticFabAssemblyConnectorHierarchyRole,
	StaticFabAssemblyConnectorPurpose,
} from "../core/StaticFabAssemblyConnector";

export type StaticFabAssemblyConnectorRecoveryTarget =
	| "side-left"
	| "side-right"
	| "target-next"
	| "source-next"
	| "cancel";

export interface StaticFabAssemblyConnectorRecoveryPrompt {
	readonly target: StaticFabAssemblyConnectorRecoveryTarget;
	readonly eyebrow: string;
	readonly instruction: string;
}

export function staticFabAssemblyConnectorRecoveryPrompt(
	target: StaticFabAssemblyConnectorRecoveryTarget | null,
	recommendationAttempts: number,
): StaticFabAssemblyConnectorRecoveryPrompt | null {
	if (target === null) return null;
	const attempts = Number.isSafeInteger(recommendationAttempts)
		? Math.max(0, recommendationAttempts)
		: 0;
	if (target === "side-left") {
		return Object.freeze({
			target: "side-left",
			eyebrow: attempts > 0 ? `추천 ${attempts}개 확인 · 다음 시도 1/3` : "다음 시도 1/3",
			instruction: "출발 진행 방향을 기준으로 왼쪽 경로를 검증하세요.",
		});
	}
	if (target === "side-right") {
		return Object.freeze({
			target: "side-right",
			eyebrow: "다음 시도 2/3",
			instruction: "출발 진행 방향을 기준으로 오른쪽 경로를 검증하세요.",
		});
	}
	if (target === "target-next") {
		return Object.freeze({
			target: "target-next",
			eyebrow: "다음 시도 3/3",
			instruction: "도착 연결점을 다음 후보로 바꾸세요. 현재 프로젝트는 아직 바뀌지 않았습니다.",
		});
	}
	if (target === "source-next") {
		return Object.freeze({
			target: "source-next",
			eyebrow: "다음 시도 3/3",
			instruction: "출발 연결점을 다음 후보로 바꾸세요. 현재 프로젝트는 아직 바뀌지 않았습니다.",
		});
	}
	return Object.freeze({
		target: "cancel",
		eyebrow: "배치 확인 필요",
		instruction:
			"시도할 연결점과 방향이 남아 있지 않습니다. 취소한 뒤 두 객체의 배치를 확인하세요.",
	});
}

export function cycleConnectorSide(
	side: RailModuleSide | null,
	delta: -1 | 1,
): RailModuleSide | null {
	const sides: readonly (RailModuleSide | null)[] = [null, "left", "right"];
	const index = sides.indexOf(side);
	return sides[(index + delta + sides.length) % sides.length] ?? null;
}

export function parseConnectorCandidateIndex(value: string, candidateCount: number): number | null {
	if (!/^(0|[1-9]\d*)$/.test(value)) return null;
	const index = Number(value);
	return Number.isSafeInteger(index) && index < candidateCount ? index : null;
}

export function staticFabAssemblyConnectorAppliedStatus(
	hierarchyRole: StaticFabAssemblyConnectorHierarchyRole,
	purpose: StaticFabAssemblyConnectorPurpose,
	createdParent: boolean,
): string {
	if (purpose === "FAB_LOOP") {
		return "Fab 외곽 순환을 추가했습니다 · 실행 취소 1회로 되돌릴 수 있습니다";
	}
	return hierarchyRole === "BAY_TO_BANK"
		? createdParent
			? "두 Twin Bay를 연결해 Bay Bank를 만들었습니다 · 실행 취소 1회로 되돌릴 수 있습니다"
			: "두 Twin Bay를 기존 Bay Bank에 연결했습니다 · 실행 취소 1회로 되돌릴 수 있습니다"
		: createdParent
			? "두 Bay Bank를 연결해 Fab을 만들었습니다 · 실행 취소 1회로 되돌릴 수 있습니다"
			: "두 Bay Bank를 기존 Fab에 연결했습니다 · 실행 취소 1회로 되돌릴 수 있습니다";
}

export function staticFabAssemblyConnectorCancelledStatus(
	hierarchyRole: StaticFabAssemblyConnectorHierarchyRole,
	purpose: StaticFabAssemblyConnectorPurpose,
	preservesFabSelection = false,
): string {
	if (purpose === "FAB_LOOP") {
		return preservesFabSelection
			? "Fab 외곽 순환 검토를 취소했습니다 · Fab 선택은 유지됩니다"
			: "Fab 외곽 순환 검토를 취소했습니다 · Bay Bank 선택은 유지됩니다";
	}
	return hierarchyRole === "BAY_TO_BANK"
		? "Twin Bay 연결을 취소했습니다 · Twin Bay 선택은 유지됩니다"
		: "Interbay 연결을 취소했습니다 · Bay Bank 선택은 유지됩니다";
}

export function staticFabAssemblyConnectorConnectionLabel(
	hierarchyRole: StaticFabAssemblyConnectorHierarchyRole,
	purpose: StaticFabAssemblyConnectorPurpose,
): string {
	if (purpose === "FAB_LOOP") return "Fab 외곽 순환";
	return hierarchyRole === "BAY_TO_BANK" ? "Twin Bay 연결" : "Interbay 연결";
}

export function staticFabAssemblyConnectorGatewayPrompt(
	hierarchyRole: StaticFabAssemblyConnectorHierarchyRole,
	purpose: StaticFabAssemblyConnectorPurpose,
	sourceSelected: boolean,
): string {
	const participant = hierarchyRole === "BAY_TO_BANK" ? "Twin Bay" : "Bay Bank";
	const gateway =
		purpose === "FAB_LOOP"
			? "외곽 Gateway(연결 지점)"
			: hierarchyRole === "BANK_TO_FAB"
				? "Interbay Gateway(연결 지점)"
				: "Gateway(연결 지점)";
	return sourceSelected
		? `다른 ${participant}의 강조된 ${gateway}을 선택하세요`
		: `두 ${participant} 중 하나의 강조된 ${gateway}을 선택하세요`;
}
