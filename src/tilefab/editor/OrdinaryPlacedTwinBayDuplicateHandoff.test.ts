import { describe, expect, it } from "vitest";
import {
	type OrdinaryPlacedTwinBayDuplicateHandoffContext,
	ordinaryPlacedTwinBayDuplicateHandoff,
} from "./OrdinaryPlacedTwinBayDuplicateHandoff";

const READY_CONTEXT = Object.freeze({
	organizationBundleActive: true,
	committedPlacementCount: 1,
	rootOrganizationCount: 1,
	placedRootOrganizationId: 42,
	selectedOrganizationIds: Object.freeze([42]),
	recognizedTwinBay: true,
	duplicateReady: true,
	redoAvailable: false,
	guidedBuildActive: false,
	placementPending: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
}) satisfies OrdinaryPlacedTwinBayDuplicateHandoffContext;

describe("ordinaryPlacedTwinBayDuplicateHandoff", () => {
	it("offers the existing effective hierarchy duplicate for one exactly recognized placed Twin Bay", () => {
		expect(ordinaryPlacedTwinBayDuplicateHandoff(READY_CONTEXT)).toEqual({
			action: "duplicate-recognized-twin-bay",
			label: "다음 · Twin Bay 전체 복제",
			instruction: "방금 배치한 Twin Bay와 하위 Process Loop 2개만 복제",
			ariaLabel:
				"다음 작업: 방금 배치하고 인증한 Twin Bay와 그 하위 Process Loop 두 개의 전체 계층을 복제합니다. 앞서 만든 일반 레일과 장비 연결 구조는 포함하지 않습니다",
			description:
				"현재 선택은 authored truth에서 Shell, Gateway, 두 Process Loop가 정확히 재인식된 Twin Bay 하나입니다. 이 행동은 기존 EFFECTIVE 조직 복제 경로를 시작하며 앞서 만든 일반 레일과 장비 연결 구조는 변경하거나 포함하지 않습니다.",
		});
	});

	it.each([
		["before a commit", { committedPlacementCount: 0 }],
		["outside an organization placement", { organizationBundleActive: false }],
		["for a multi-root bundle", { rootOrganizationCount: 2 }],
		["without an exact placed root", { placedRootOrganizationId: null }],
		["without exact Twin Bay recognition", { recognizedTwinBay: false }],
		["without the placed root selected", { selectedOrganizationIds: Object.freeze([]) }],
		["with a different organization selected", { selectedOrganizationIds: Object.freeze([41]) }],
		["with multiple organizations selected", { selectedOrganizationIds: Object.freeze([42, 43]) }],
		["while Duplicate is blocked", { duplicateReady: false }],
		["after Undo exposes Redo", { redoAvailable: true }],
		["inside Guided Build", { guidedBuildActive: true }],
		["while placement is pending", { placementPending: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while mutation is not ready", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryPlacedTwinBayDuplicateHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});
});
