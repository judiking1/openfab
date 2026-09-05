import { describe, expect, it } from "vitest";
import { guidedBuildPracticeTransitionPresentation } from "./GuidedBuildPracticeTransitionPresentation";

describe("guidedBuildPracticeTransitionPresentation", () => {
	it("names the isolated practice save choice and the empty FAB outcome", () => {
		const presentation = guidedBuildPracticeTransitionPresentation(
			"OpenFab Guided Practice",
			"OpenFab Guided FAB",
			{ equipmentGroups: 6, ports: 12 },
		);

		expect(presentation).toEqual({
			title: "연습 프로젝트를 저장할까요?",
			context: "OpenFab Guided Practice → OpenFab Guided FAB",
			explanation:
				"연습 프로젝트: 장비 6 · Port 12. 새 FAB 프로젝트: 장비 0 · Port 0. 연습 레일·장비·Port는 새 FAB로 복사되지 않습니다. 저장하면 .openfab 파일로 남긴 뒤 빈 FAB를 시작하고, 저장하지 않으면 바로 빈 FAB를 시작합니다.",
			discardLabel: "저장 없이 FAB 시작",
			saveLabel: "연습 저장 후 FAB 시작",
		});
		expect(Object.isFrozen(presentation)).toBe(true);
	});

	it("preserves the exact project identities in the transition context", () => {
		const presentation = guidedBuildPracticeTransitionPresentation(
			"사용자 연습 · A",
			"생산 FAB · B",
			{ equipmentGroups: 3, ports: 6 },
		);

		expect(presentation.context).toBe("사용자 연습 · A → 생산 FAB · B");
	});

	it("rejects invalid authored-scope counts", () => {
		expect(() =>
			guidedBuildPracticeTransitionPresentation("Practice", "FAB", {
				equipmentGroups: -1,
				ports: 2,
			}),
		).toThrow("non-negative integers");
	});
});
