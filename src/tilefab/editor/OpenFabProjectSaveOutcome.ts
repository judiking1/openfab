export type OpenFabProjectSaveOutcome = "saved" | "cancelled" | "failed";

export type OpenFabProjectSaveCancellationContext = "direct" | "pending-transition";

export function describeOpenFabProjectSaveCancellation(
	context: OpenFabProjectSaveCancellationContext,
): string {
	return context === "pending-transition"
		? "저장이 취소되었습니다 · 현재 프로젝트와 전환 선택을 유지합니다"
		: "프로젝트 저장을 취소했습니다 · 현재 프로젝트를 유지합니다";
}
