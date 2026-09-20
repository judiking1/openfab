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
			ariaLabel: "다음 작업: 방금 배치한 Twin Bay와 내부 Process Loop 두 개를 함께 복제합니다",
			description:
				"Twin Bay와 내부 Process Loop 두 개를 함께 복제할 위치를 고릅니다. 위치를 확정하면 복제본이 추가됩니다.",
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
