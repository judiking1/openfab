import { describe, expect, it } from "vitest";
import {
	describeOpenFabProjectSaveCancellation,
	describeOpenFabProjectSaveRetry,
	planOpenFabProjectSaveContinuation,
} from "./OpenFabProjectSaveOutcome";

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

describe("saved project continuation", () => {
	it("requires a new click for native Open after a current-source save", () => {
		expect(
			planOpenFabProjectSaveContinuation("open", { status: "saved", isCurrent: () => true }),
		).toBe("open-confirmation");
	});
	it.each([
		"new",
		"new-profile-fab",
		"recover",
		"recent",
	])("continues %s without another click when the saved source is current", (kind) => {
		expect(
			planOpenFabProjectSaveContinuation(kind, { status: "saved", isCurrent: () => true }),
		).toBe("continue");
	});
	it.each([
		"cancelled",
		"failed",
		"saved-stale",
		"download-requested",
	] as const)("retains pending work after %s", (status) => {
		expect(
			planOpenFabProjectSaveContinuation(
				"new",
				status === "saved-stale" ? { status, canReuseDestination: true } : { status },
			),
		).toBe("retry");
	});
	it("retains pending work when source changes after the save returns", () => {
		expect(
			planOpenFabProjectSaveContinuation("new", { status: "saved", isCurrent: () => false }),
		).toBe("retry");
	});
	it("requires a fresh Save As action after existing-handle authority is unavailable", () => {
		expect(planOpenFabProjectSaveContinuation("open", { status: "save-as-required" })).toBe(
			"save-as",
		);
	});
});

describe("guarded save retry feedback", () => {
	it("distinguishes cancellation from a failed write without guessing its cause", () => {
		expect(describeOpenFabProjectSaveRetry("cancelled")).toBe(
			describeOpenFabProjectSaveCancellation("pending-transition"),
		);
		const failed = describeOpenFabProjectSaveRetry("failed");
		expect(failed).toContain("저장을 완료하지 못했습니다");
		expect(failed).toContain("현재 프로젝트와 전환 선택을 유지합니다");
		expect(failed).not.toMatch(/권한|취소|브라우저/);
	});
	it("explains that requesting a download does not authorize a project transition", () => {
		const message = describeOpenFabProjectSaveRetry("download-requested");
		expect(message).toContain("다운로드한 파일을 확인하세요");
		expect(message).toContain("저장 완료를 확인할 수 없어");
		expect(message).toContain("현재 프로젝트와 전환 선택을 유지합니다");
	});
	it("names the explicit Save As action when the original destination is unavailable", () => {
		expect(describeOpenFabProjectSaveRetry("save-as-required")).toContain(
			"다른 이름으로 저장 후 계속을 눌러 저장할 파일을 선택하세요",
		);
	});
	it.each([
		"saved-stale",
		"saved",
	] as const)("asks to save current changes when %s cannot continue", (status) => {
		expect(describeOpenFabProjectSaveRetry(status)).toContain("현재 변경 사항을 다시 저장하세요");
		expect(describeOpenFabProjectSaveRetry(status)).toContain("전환 선택을 유지합니다");
	});
});
