import { describe, expect, it } from "vitest";
import {
	DEFAULT_RAIL_BUILD_STATUS,
	guidedBuildPresentedStatus,
	guidedFirstRailPreviewStatus,
	RAIL_ROUTE_DRAG_STATUS,
} from "./GuidedBuildRailGestureStatus";

describe("GuidedBuildRailGestureStatus", () => {
	it("replaces only the untouched First Rail status with the complete pointer gesture", () => {
		expect(
			guidedBuildPresentedStatus({
				guidedBuildOpen: true,
				currentMissionId: "first-rail",
				status: DEFAULT_RAIL_BUILD_STATUS,
			}),
		).toBe("빈 곳을 누른 채 가로/세로 15 m 이상 끌고 놓으세요");
		expect(
			guidedBuildPresentedStatus({
				guidedBuildOpen: true,
				currentMissionId: "first-rail",
				status: RAIL_ROUTE_DRAG_STATUS,
			}),
		).toBe("빈 곳을 누른 채 가로/세로 15 m 이상 끌고 놓으세요");
		expect(
			guidedBuildPresentedStatus({
				guidedBuildOpen: false,
				currentMissionId: "first-rail",
				status: DEFAULT_RAIL_BUILD_STATUS,
			}),
		).toBe(DEFAULT_RAIL_BUILD_STATUS);
		expect(
			guidedBuildPresentedStatus({
				guidedBuildOpen: true,
				currentMissionId: "first-rail",
				status: "현재 오류를 먼저 해결하세요",
			}),
		).toBe("현재 오류를 먼저 해결하세요");
	});

	it("reports remaining length, axis correction, and release readiness", () => {
		expect(
			guidedFirstRailPreviewStatus({
				guidedBuildOpen: true,
				currentMissionId: "first-rail",
				lengthMeters: 9,
				turns: 0,
				valid: true,
			}),
		).toBe("9 m · 6 m 더 끌어 첫 직선을 만드세요");
		expect(
			guidedFirstRailPreviewStatus({
				guidedBuildOpen: true,
				currentMissionId: "first-rail",
				lengthMeters: 16,
				turns: 1,
				valid: true,
			}),
		).toBe("16 m · 한 축으로 곧게 끌어 첫 직선을 만드세요");
		expect(
			guidedFirstRailPreviewStatus({
				guidedBuildOpen: true,
				currentMissionId: "first-rail",
				lengthMeters: 15,
				turns: 0,
				valid: true,
			}),
		).toBe("15 m · 목표 충족 · 놓아서 건설");
	});

	it("replaces only stale rail-idle copy with the exact next Port action", () => {
		expect(
			guidedBuildPresentedStatus({
				guidedBuildOpen: true,
				currentMissionId: "ports",
				suggestedActionLabel: "EQUIP · OHB 열기",
				status: RAIL_ROUTE_DRAG_STATUS,
			}),
		).toBe("다음: EQUIP · OHB 열기");
		expect(
			guidedBuildPresentedStatus({
				guidedBuildOpen: true,
				currentMissionId: "ports",
				suggestedActionLabel: "EQUIP · STK 열기",
				status: DEFAULT_RAIL_BUILD_STATUS,
			}),
		).toBe("다음: EQUIP · STK 열기");
		expect(
			guidedBuildPresentedStatus({
				guidedBuildOpen: true,
				currentMissionId: "ports",
				suggestedActionLabel: "EQUIP · OHB 열기",
				status: "현재 오류를 먼저 해결하세요",
			}),
		).toBe("현재 오류를 먼저 해결하세요");
	});

	it("defers to ordinary invalid and non-mission preview reasons", () => {
		expect(
			guidedFirstRailPreviewStatus({
				guidedBuildOpen: true,
				currentMissionId: "first-rail",
				lengthMeters: 15,
				turns: 0,
				valid: false,
			}),
		).toBeNull();
		expect(
			guidedFirstRailPreviewStatus({
				guidedBuildOpen: true,
				currentMissionId: "process-loop",
				lengthMeters: 15,
				turns: 0,
				valid: true,
			}),
		).toBeNull();
	});
});
