import { describe, expect, it } from "vitest";
import { describeOpenFabProjectSaveCancellation } from "./OpenFabProjectSaveOutcome";

describe("OpenFabProjectSaveOutcome", () => {
	it("keeps direct save cancellation truthful without implying a completed write", () => {
		expect(describeOpenFabProjectSaveCancellation("direct")).toBe(
			"프로젝트 저장을 취소했습니다 · 현재 프로젝트를 유지합니다",
		);
	});

	it("keeps a guarded project transition pending when its save chooser is cancelled", () => {
		expect(describeOpenFabProjectSaveCancellation("pending-transition")).toBe(
			"저장이 취소되었습니다 · 현재 프로젝트와 전환 선택을 유지합니다",
		);
	});
});
