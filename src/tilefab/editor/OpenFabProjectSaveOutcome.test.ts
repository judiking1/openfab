import { describe, expect, it } from "vitest";
import {
	describeOpenFabProjectSaveCancellation,
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
