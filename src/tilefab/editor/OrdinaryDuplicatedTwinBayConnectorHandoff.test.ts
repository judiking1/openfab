import { describe, expect, it } from "vitest";
import {
	type OrdinaryDuplicatedTwinBayConnectorHandoffContext,
	ordinaryDuplicatedTwinBayConnectorHandoff,
} from "./OrdinaryDuplicatedTwinBayConnectorHandoff";

const READY_CONTEXT = Object.freeze({
	organizationBundleActive: true,
	bundleCaptureMode: "EFFECTIVE",
	committedPlacementCount: 1,
	rootOrganizationCount: 1,
	sourceRootOrganizationIds: Object.freeze([17]),
	placedRootOrganizationId: 42,
	selectedOrganizationIds: Object.freeze([17, 42]),
	sourceRecognizedTwinBay: true,
	placedRecognizedTwinBay: true,
	selectedRecognizedTwinBayPair: true,
	connectorReady: true,
	redoAvailable: false,
	guidedBuildActive: false,
	placementPending: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
}) satisfies OrdinaryDuplicatedTwinBayConnectorHandoffContext;

describe("ordinaryDuplicatedTwinBayConnectorHandoff", () => {
	it("offers the existing Worker-certified Connector for one exact source/duplicate pair", () => {
		expect(ordinaryDuplicatedTwinBayConnectorHandoff(READY_CONTEXT)).toEqual({
			action: "connect-recognized-twin-bay-pair",
			label: "다음 · 두 Twin Bay 연결",
			instruction: "원본과 복제본을 Bay Bank로 묶기",
			ariaLabel:
				"다음 · 두 Twin Bay 연결. 정확히 인식된 원본 Twin Bay와 복제 Twin Bay의 반복 배치를 끝내고 CONNECT BAYS 검토를 엽니다. 연결은 Apply 전까지 프로젝트를 변경하지 않습니다",
			description:
				"현재 선택은 authored truth에서 각각 독립적인 Twin Bay로 재인식된 원본과 복제본 두 개입니다. 이 행동은 반복 복제 고스트를 닫고 기존 Worker 인증 CONNECT BAYS 검토를 열며 Apply 전에는 레일이나 조직을 변경하지 않습니다.",
		});
	});

	it("recovers the same Connector action after repeat placement exits", () => {
		expect(
			ordinaryDuplicatedTwinBayConnectorHandoff({
				...READY_CONTEXT,
				organizationBundleActive: false,
				bundleCaptureMode: null,
				committedPlacementCount: 0,
				rootOrganizationCount: 0,
				sourceRootOrganizationIds: Object.freeze([]),
				placedRootOrganizationId: null,
				sourceRecognizedTwinBay: false,
				placedRecognizedTwinBay: false,
			}),
		).toEqual({
			action: "connect-recognized-twin-bay-pair",
			label: "다음 · 두 Twin Bay 연결",
			instruction: "선택한 두 Bay를 Bay Bank로 묶기",
			ariaLabel:
				"다음 · 두 Twin Bay 연결. 정확히 선택된 Twin Bay 두 개의 CONNECT BAYS 검토를 엽니다. 연결은 Apply 전까지 프로젝트를 변경하지 않습니다",
			description:
				"현재 선택은 authored truth에서 각각 독립적인 Twin Bay로 재인식된 두 개의 Bay입니다. 이 행동은 기존 Worker 인증 CONNECT BAYS 검토를 열며 Apply 전에는 레일이나 조직을 변경하지 않습니다.",
		});
	});

	it("accepts canonical identity equality regardless of input order", () => {
		expect(
			ordinaryDuplicatedTwinBayConnectorHandoff({
				...READY_CONTEXT,
				selectedOrganizationIds: Object.freeze([42, 17]),
			}),
		).not.toBeNull();
	});

	it.each([
		["before commit", { committedPlacementCount: 0 }],
		["outside placement", { organizationBundleActive: false }],
		["for DIRECT capture", { bundleCaptureMode: "DIRECT" as const }],
		["for multiple bundle roots", { rootOrganizationCount: 2 }],
		["without source identity", { sourceRootOrganizationIds: Object.freeze([]) }],
		["with multiple source identities", { sourceRootOrganizationIds: Object.freeze([17, 18]) }],
		["when source and target match", { placedRootOrganizationId: 17 }],
		["without exact pair selection", { selectedOrganizationIds: Object.freeze([42]) }],
		["with an unrelated selection", { selectedOrganizationIds: Object.freeze([17, 99]) }],
		["without source recognition", { sourceRecognizedTwinBay: false }],
		["without placed recognition", { placedRecognizedTwinBay: false }],
		["while Connector is blocked", { connectorReady: false }],
		["after Undo exposes Redo", { redoAvailable: true }],
		["inside Guided Build", { guidedBuildActive: true }],
		["while placement is pending", { placementPending: true }],
		["during exclusive review", { exclusiveCommandActive: true }],
		["while mutation is unavailable", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryDuplicatedTwinBayConnectorHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});

	it("does not recover after exit for a pair that is not two exact Twin Bays", () => {
		expect(
			ordinaryDuplicatedTwinBayConnectorHandoff({
				...READY_CONTEXT,
				organizationBundleActive: false,
				bundleCaptureMode: null,
				committedPlacementCount: 0,
				rootOrganizationCount: 0,
				sourceRootOrganizationIds: Object.freeze([]),
				placedRootOrganizationId: null,
				sourceRecognizedTwinBay: false,
				placedRecognizedTwinBay: false,
				selectedRecognizedTwinBayPair: false,
			}),
		).toBeNull();
	});
});
