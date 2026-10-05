export type OpenFabProjectSaveOutcome =
	| Readonly<{ status: "saved"; isCurrent: () => boolean }>
	| Readonly<{ status: "cancelled" | "failed" | "save-as-required" | "download-requested" }>
	| Readonly<{ status: "saved-stale"; canReuseDestination: boolean }>;

export function planOpenFabProjectSaveContinuation(
	actionKind: string,
	outcome: OpenFabProjectSaveOutcome,
): "retry" | "save-as" | "open-confirmation" | "continue" {
	if (outcome.status === "save-as-required") return "save-as";
	if (outcome.status !== "saved" || !outcome.isCurrent()) return "retry";
	return actionKind === "open" ? "open-confirmation" : "continue";
}

export type OpenFabProjectSaveCancellationContext = "direct" | "pending-transition";

export function describeOpenFabProjectSaveCancellation(
	context: OpenFabProjectSaveCancellationContext,
): string {
	return context === "pending-transition"
		? "저장이 취소되었습니다 · 현재 프로젝트와 전환 선택을 유지합니다"
		: "프로젝트 저장을 취소했습니다 · 현재 프로젝트를 유지합니다";
}
