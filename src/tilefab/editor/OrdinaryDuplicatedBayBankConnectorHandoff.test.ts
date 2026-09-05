import { describe, expect, it } from "vitest";
import {
	type OrdinaryDuplicatedBayBankConnectorHandoffContext,
	ordinaryDuplicatedBayBankConnectorHandoff,
} from "./OrdinaryDuplicatedBayBankConnectorHandoff";

const READY_CONTEXT = Object.freeze({
	organizationBundleActive: true,
	bundleCaptureMode: "EFFECTIVE",
	committedPlacementCount: 1,
	rootOrganizationCount: 1,
	sourceRootOrganizationIds: Object.freeze([7]),
	placedRootOrganizationId: 14,
	selectedOrganizationIds: Object.freeze([7, 14]),
	sourceRecognizedBayBank: true,
	placedRecognizedBayBank: true,
	selectedRecognizedBayBankPair: true,
	hierarchyLinkConnectorReady: true,
	redoAvailable: false,
	guidedBuildActive: false,
	placementPending: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
}) satisfies OrdinaryDuplicatedBayBankConnectorHandoffContext;

describe("ordinaryDuplicatedBayBankConnectorHandoff", () => {
	it("offers the existing Bank Connector for one exact source and duplicate pair", () => {
		expect(ordinaryDuplicatedBayBankConnectorHandoff(READY_CONTEXT)).toEqual({
			action: "connect-recognized-bay-bank-pair",
			label: "다음 · 두 Bay Bank 연결",
			instruction: "원본과 복제본 사이 Interbay 연결 검토",
			ariaLabel:
				"다음 · 두 Bay Bank 연결. 원본 Bay Bank와 복제 Bay Bank의 반복 배치를 끝내고 CONNECT BANKS 연결 검토를 엽니다. Apply 전에는 프로젝트가 변경되지 않습니다",
			description:
				"현재 선택은 원본 Bay Bank와 방금 배치한 복제 Bay Bank입니다. 반복 배치를 끝내고 두 Bank의 연결 검토를 엽니다. Apply 전에는 Rail이나 조직이 변경되지 않습니다.",
		});
	});

	it("recovers the same Connector after repeat placement exits", () => {
		expect(
			ordinaryDuplicatedBayBankConnectorHandoff({
				...READY_CONTEXT,
				organizationBundleActive: false,
				bundleCaptureMode: null,
				committedPlacementCount: 0,
				rootOrganizationCount: 0,
				sourceRootOrganizationIds: Object.freeze([]),
				placedRootOrganizationId: null,
				sourceRecognizedBayBank: false,
				placedRecognizedBayBank: false,
			}),
		).toEqual({
			action: "connect-recognized-bay-bank-pair",
			label: "다음 · 두 Bay Bank 연결",
			instruction: "선택한 두 Bank 사이 Interbay 연결 검토",
			ariaLabel:
				"다음 · 두 Bay Bank 연결. 선택한 Bay Bank 두 개의 CONNECT BANKS 연결 검토를 엽니다. Apply 전에는 프로젝트가 변경되지 않습니다",
			description:
				"현재 선택은 프로젝트에서 Bay Bank로 확인된 두 조직입니다. 두 Bank의 연결 검토를 엽니다. Apply 전에는 Rail이나 조직이 변경되지 않습니다.",
		});
	});

	it("accepts canonical pair equality regardless of selection order", () => {
		expect(
			ordinaryDuplicatedBayBankConnectorHandoff({
				...READY_CONTEXT,
				selectedOrganizationIds: Object.freeze([14, 7]),
			}),
		).not.toBeNull();
	});

	it.each([
		["before commit", { committedPlacementCount: 0 }],
		["outside placement", { organizationBundleActive: false }],
		["for DIRECT capture", { bundleCaptureMode: "DIRECT" as const }],
		["for multiple roots", { rootOrganizationCount: 2 }],
		["without source identity", { sourceRootOrganizationIds: Object.freeze([]) }],
		["with multiple source identities", { sourceRootOrganizationIds: Object.freeze([7, 8]) }],
		["when source and target match", { placedRootOrganizationId: 7 }],
		["without exact pair selection", { selectedOrganizationIds: Object.freeze([14]) }],
		["with unrelated selection", { selectedOrganizationIds: Object.freeze([7, 99]) }],
		["without source Bank recognition", { sourceRecognizedBayBank: false }],
		["without target Bank recognition", { placedRecognizedBayBank: false }],
		["while the hierarchy-link Connector is blocked", { hierarchyLinkConnectorReady: false }],
		["after Undo exposes Redo", { redoAvailable: true }],
		["inside Guided Build", { guidedBuildActive: true }],
		["while placement is pending", { placementPending: true }],
		["during exclusive review", { exclusiveCommandActive: true }],
		["while mutation is unavailable", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryDuplicatedBayBankConnectorHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});

	it("does not recover an exit selection unless both organizations are current Banks", () => {
		expect(
			ordinaryDuplicatedBayBankConnectorHandoff({
				...READY_CONTEXT,
				organizationBundleActive: false,
				bundleCaptureMode: null,
				committedPlacementCount: 0,
				rootOrganizationCount: 0,
				sourceRootOrganizationIds: Object.freeze([]),
				placedRootOrganizationId: null,
				sourceRecognizedBayBank: false,
				placedRecognizedBayBank: false,
				selectedRecognizedBayBankPair: false,
			}),
		).toBeNull();
	});
});
