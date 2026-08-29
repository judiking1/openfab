import type { RailModuleSide } from "../core/RailModulePlanner";
import type {
	StaticFabAssemblyConnectorHierarchyRole,
	StaticFabAssemblyConnectorPurpose,
} from "../core/StaticFabAssemblyConnector";

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
): string {
	if (purpose === "FAB_LOOP") {
		return "Fab 외곽 순환을 추가했습니다 · 실행 취소 1회로 되돌릴 수 있습니다";
	}
	return hierarchyRole === "BAY_TO_BANK"
		? "두 Production Bay를 연결해 Bay Bank를 만들었습니다 · 실행 취소 1회로 되돌릴 수 있습니다"
		: "두 Bay Bank를 연결해 Fab을 만들었습니다 · 실행 취소 1회로 되돌릴 수 있습니다";
}
