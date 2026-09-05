export interface GuidedBuildPracticeTransitionPresentation {
	readonly title: string;
	readonly context: string;
	readonly explanation: string;
	readonly discardLabel: string;
	readonly saveLabel: string;
}

export interface GuidedBuildPracticeTransitionScope {
	readonly equipmentGroups: number;
	readonly ports: number;
}

export function guidedBuildPracticeTransitionPresentation(
	practiceProjectName: string,
	fabProjectName: string,
	scope: GuidedBuildPracticeTransitionScope,
): GuidedBuildPracticeTransitionPresentation {
	if (
		!Number.isInteger(scope.equipmentGroups) ||
		scope.equipmentGroups < 0 ||
		!Number.isInteger(scope.ports) ||
		scope.ports < 0
	) {
		throw new TypeError("Guided practice transition counts must be non-negative integers");
	}
	return Object.freeze({
		title: "연습 프로젝트를 저장할까요?",
		context: `${practiceProjectName} → ${fabProjectName}`,
		explanation: `연습 프로젝트: 장비 ${scope.equipmentGroups} · Port ${scope.ports}. 새 FAB 프로젝트: 장비 0 · Port 0. 연습 레일·장비·Port는 새 FAB로 복사되지 않습니다. 저장하면 .openfab 파일로 남긴 뒤 빈 FAB를 시작하고, 저장하지 않으면 바로 빈 FAB를 시작합니다.`,
		discardLabel: "저장 없이 FAB 시작",
		saveLabel: "연습 저장 후 FAB 시작",
	});
}
