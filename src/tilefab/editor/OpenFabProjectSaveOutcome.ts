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

/** Explain why a guarded transition still needs a save after retry/save-as planning. */
export function describeOpenFabProjectSaveRetry(
	status: OpenFabProjectSaveOutcome["status"],
): string {
	switch (status) {
		case "cancelled":
			return describeOpenFabProjectSaveCancellation("pending-transition");
		case "failed":
			return "저장을 완료하지 못했습니다 · 현재 프로젝트와 전환 선택을 유지합니다 · 다시 시도할 수 있습니다";
		case "save-as-required":
			return "기존 파일에 저장할 수 없습니다 · 다른 이름으로 저장 후 계속을 눌러 저장할 파일을 선택하세요";
		case "download-requested":
			return "다운로드를 요청했습니다 · 다운로드한 파일을 확인하세요 · 저장 완료를 확인할 수 없어 현재 프로젝트와 전환 선택을 유지합니다";
		case "saved-stale":
		case "saved":
			return "저장 후 프로젝트가 바뀌었습니다 · 현재 변경 사항을 다시 저장하세요 · 전환 선택을 유지합니다";
	}
}
