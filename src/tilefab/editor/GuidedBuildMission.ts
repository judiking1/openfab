import type {
	RailProjectReadinessIssue,
	RailProjectReadinessStatus,
	RailProjectReadinessSummary,
} from "../compile/RailProjectReadiness";
import type { RailConstructionCatalogId } from "../core/RailConstructionCatalog";
import type { BlueprintPlacementOrigin } from "./BlueprintCommandLoop";
import { EDITOR_ACTIVITIES, type EditorActivity } from "./EditorActivity";
import type { EditorCommandId } from "./EditorCommandRegistry";
import type { GuidedBuildBayBankEvidence } from "./GuidedBuildBayBankEvidence";
import type { GuidedBuildBayEvidence } from "./GuidedBuildBayEvidence";
import type { GuidedBuildFabLoopEvidence } from "./GuidedBuildFabLoopEvidence";
import type { GuidedBuildInterbayEvidence } from "./GuidedBuildInterbayEvidence";
import type { GuidedBuildRailReuseEvidence } from "./GuidedBuildRailReuseEvidence";
import { isOpenFabProjectDirty } from "./OpenFabProjectSession";

export const GUIDED_BUILD_FOUNDATION_MISSION_IDS = [
	"orient",
	"first-rail",
	"process-loop",
	"ports",
	"reuse-loop",
	"bay",
	"bay-bank",
	"interbay",
	"fab-loop",
	"checks",
	"project-save",
	"project-reopen",
] as const;

export type GuidedBuildFoundationMissionId = (typeof GUIDED_BUILD_FOUNDATION_MISSION_IDS)[number];

export interface GuidedBuildMissionDefinition {
	readonly id: GuidedBuildFoundationMissionId;
	readonly sequence: number;
	readonly activity: EditorActivity;
	readonly eyebrow: string;
	readonly title: string;
	readonly objective: string;
	readonly rationale: string;
	readonly primaryCommandId: EditorCommandId | null;
}

export type GuidedBuildSuggestedAction =
	| "build"
	| "inspect"
	| "ohb"
	| "eq"
	| "stk"
	| "select-connected"
	| "copy-selection"
	| "graduate-practice"
	| "add-bay"
	| "browse-bays"
	| "duplicate-bay"
	| "arrange-bays"
	| "connect-bays"
	| "browse-banks"
	| "duplicate-bank"
	| "arrange-banks"
	| "connect-banks"
	| "add-fab-loop"
	| "open-checks"
	| "confirm-checks"
	| "save-project"
	| "open-project";

export interface GuidedBuildMissionPrompt {
	readonly eyebrow: string;
	readonly title: string;
	readonly objective: string;
	readonly rationale: string;
	readonly presentation?: "connector";
	/** Keeps a successful exact reopen visually at 12/12 while fresh CHECKS are republished. */
	readonly progressPresentation?: "reopen-final-check";
	readonly primaryCommandId: EditorCommandId | null;
	readonly suggestedAction: GuidedBuildSuggestedAction | null;
	readonly suggestedActionLabel: string | null;
	/** Guided organization rows may promote the second plain tap to the ordinary primary toggle. */
	readonly organizationSelectionTargetCount?: 1 | 2;
	readonly progressCue?: GuidedBuildMissionProgressCue;
}

export interface GuidedBuildMissionProgressCue {
	readonly label: string;
	readonly value: string;
	readonly instruction: string;
}

export const GUIDED_BUILD_FOUNDATION_MISSIONS = Object.freeze([
	Object.freeze({
		id: "orient",
		sequence: 1,
		activity: "build",
		eyebrow: "MISSION 1 · ORIENT",
		title: "캔버스 익히기",
		objective: "빈 캔버스를 이동하고, +/− 버튼이나 마우스 휠로 확대·축소한 뒤 계속하세요.",
		rationale: "큰 FAB를 만들기 전에 이동과 전체 보기를 안전하게 익힙니다.",
		primaryCommandId: "camera.pan-pointer",
	}),
	Object.freeze({
		id: "first-rail",
		sequence: 2,
		activity: "build",
		eyebrow: "MISSION 2 · FIRST RAIL",
		title: "첫 단방향 레일",
		objective: "맵의 어느 빈 곳에서든 가로 또는 세로로 15 m 이상의 단방향 레일을 만드세요.",
		rationale: "모든 Process Loop와 Bay는 검증된 directed rail에서 시작합니다.",
		primaryCommandId: "canvas.primary-drag",
	}),
	Object.freeze({
		id: "process-loop",
		sequence: 3,
		activity: "build",
		eyebrow: "MISSION 3 · PROCESS LOOP",
		title: "닫힌 Process Loop",
		objective: "레일을 계속 연결해 열린 끝이 없는 하나의 닫힌 방향성 회로를 만드세요.",
		rationale: "작은 닫힌 회로는 Bay가 아니라 장비 접근의 기본 단위인 Process Loop입니다.",
		primaryCommandId: "canvas.primary-drag",
	}),
	Object.freeze({
		id: "ports",
		sequence: 4,
		activity: "equip",
		eyebrow: "MISSION 4 · PORTS",
		title: "Port-first 장비",
		objective: "OHB, EQ, STK의 대표 Port를 기존 레일의 합법 슬롯에 배치하세요.",
		rationale: "장비 객체는 Port의 위치·방향·그룹에서 파생되며 별도 좌표로 먼저 만들지 않습니다.",
		primaryCommandId: "canvas.primary-click",
	}),
	Object.freeze({
		id: "reuse-loop",
		sequence: 5,
		activity: "assemble",
		eyebrow: "MISSION 5 · REUSE LOOP",
		title: "Process Loop 재사용",
		objective: "완성한 Process Loop를 선택하고 복제해 정렬된 두 번째 닫힌 Loop를 만드세요.",
		rationale:
			"이 미션은 Port까지 보존하는 닫힌 Loop 전체 복제를 연습합니다. 일반 편집에서는 드래그 상자에 닿은 일부 레일 모듈도 닫히지 않아도 그대로 복제할 수 있습니다.",
		primaryCommandId: "selection.connected",
	}),
	Object.freeze({
		id: "bay",
		sequence: 6,
		activity: "assemble",
		eyebrow: "MISSION 6 · BAY",
		title: "첫 Twin Bay",
		objective: "큰 순환 Shell, 두 Process Loop, 검증된 Gateway를 가진 Twin Bay를 배치하세요.",
		rationale:
			"Bay는 Loop 묶음이나 외곽 박스가 아니라 명시적 계층과 순환 Gateway를 가진 조립 단위입니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "bay-bank",
		sequence: 7,
		activity: "assemble",
		eyebrow: "MISSION 7 · BAY BANK",
		title: "첫 Bay Bank",
		objective: "Twin Bay를 복제·정렬하고 왕복 연결 레일로 하나의 Bay Bank를 만드세요.",
		rationale:
			"Bay Bank는 반복되는 Bay와 그 사이의 왕복 연결 레일을 하나로 묶어 관리하는 단위입니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "interbay",
		sequence: 8,
		activity: "assemble",
		eyebrow: "MISSION 8 · INTERBAY",
		title: "두 Bay Bank를 잇는 Interbay",
		objective:
			"완성된 Bay Bank를 복제·정렬하고 CONNECT BANKS로 Interbay 왕복 연결과 하나의 Fab을 만드세요.",
		rationale:
			"Interbay는 두 Bay Bank 사이의 outbound·return 왕복 연결이며, Fab은 두 Bay Bank와 이 연결을 함께 소유합니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "fab-loop",
		sequence: 9,
		activity: "assemble",
		eyebrow: "MISSION 9 · FAB LOOP",
		title: "Fab 외곽 순환 완성",
		objective:
			"같은 Fab의 두 Bay Bank 사이에 기존 Interbay와 겹치지 않는 두 번째 왕복 길을 만드세요.",
		rationale:
			"Fab Loop를 더하면 한쪽 연결을 사용할 수 없을 때도 다른 왕복 길로 이동할 수 있습니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "checks",
		sequence: 10,
		activity: "inspect",
		eyebrow: "MISSION 10 · CHECKS",
		title: "정적 FAB 전체 검증",
		objective: "CHECKS를 열어 레일·포트·장비·조직이 서로 올바르게 연결됐는지 확인하세요.",
		rationale:
			"저장하기 전에 현재 FAB의 레일 흐름과 모든 구성 요소의 관계를 한 화면에서 확인합니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "project-save",
		sequence: 11,
		activity: "inspect",
		eyebrow: "MISSION 11 · SAVE",
		title: "OpenFab 프로젝트 저장",
		objective: "현재 FAB 전체를 하나의 .openfab 프로젝트 파일로 저장하세요.",
		rationale: ".openfab 파일에는 레일·포트·장비·조직과 프로젝트 설정이 함께 저장됩니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "project-reopen",
		sequence: 12,
		activity: "inspect",
		eyebrow: "MISSION 12 · REOPEN",
		title: "저장한 프로젝트 다시 열기",
		objective: "방금 저장한 OpenFab 프로젝트 파일을 다시 열어 동일한 FAB에서 가이드를 재개하세요.",
		rationale: "방금 저장한 파일을 직접 다시 열어 같은 FAB가 온전히 복원되는지 확인합니다.",
		primaryCommandId: null,
	}),
] as const satisfies readonly GuidedBuildMissionDefinition[]);

export type GuidedBuildEquipmentKind = "OHB" | "EQ" | "STK";
export type GuidedBuildEquipmentToolId = "ohb" | "eq" | "stk";

export interface GuidedBuildEquipmentKindEvidence {
	readonly groupCount: number;
	readonly portCount: number;
	/** Largest canonical group membership. Aggregate Port totals cannot substitute for this value. */
	readonly largestGroupPortCount: number;
}

export interface GuidedBuildEquipmentEvidence {
	readonly OHB: GuidedBuildEquipmentKindEvidence;
	readonly EQ: GuidedBuildEquipmentKindEvidence;
	readonly STK: GuidedBuildEquipmentKindEvidence;
}

export interface GuidedBuildReuseGuidanceEvidence {
	readonly selectionAnchorReady: boolean;
	readonly reusableSelectionReady: boolean;
	readonly placementActive: boolean;
}

export interface GuidedBuildBayGuidanceEvidence {
	readonly placementActive: boolean;
}

export type GuidedBuildArrangementGuidancePhase =
	| "inactive"
	| "planning"
	| "certified"
	| "rejected";

export type GuidedBuildConnectorGuidancePhase =
	| "inactive"
	| "pick-source-gateway"
	| "pick-target-gateway"
	| "verifying"
	| "ready"
	| "rejected"
	| "applying";

export interface GuidedBuildBayBankGuidanceEvidence {
	readonly placementActive: boolean;
	readonly organizationBrowserOpen: boolean;
	readonly selectedOrganizationCount: number;
	readonly selectedTwinBayCount: number;
	readonly selectedTwinBayPairAligned: boolean;
	readonly arrangementPhase: GuidedBuildArrangementGuidancePhase;
	readonly connectorPhase: GuidedBuildConnectorGuidancePhase;
}

export interface GuidedBuildInterbayGuidanceEvidence {
	readonly placementActive: boolean;
	readonly organizationBrowserOpen: boolean;
	readonly selectedOrganizationCount: number;
	readonly selectedBayBankCount: number;
	readonly selectedBayBankPairAligned: boolean;
	readonly arrangementPhase: GuidedBuildArrangementGuidancePhase;
	readonly connectorPhase: GuidedBuildConnectorGuidancePhase;
}

export interface GuidedBuildFabLoopGuidanceEvidence {
	readonly organizationBrowserOpen: boolean;
	readonly selectedOrganizationCount: number;
	readonly selectedBayBankCount: number;
	readonly connectorPhase: GuidedBuildConnectorGuidancePhase;
}

export interface GuidedBuildChecksEvidence {
	readonly available: boolean;
	readonly ready: boolean;
	readonly fingerprint: string;
	readonly blockingIssueCount: number;
	readonly followUpIssueCount: number;
	readonly separateRailNetworkCount: number;
}

export interface GuidedBuildChecksGuidanceEvidence {
	readonly navigatorOpen: boolean;
	readonly inspectionPending: boolean;
	readonly acknowledgedFingerprint: string | null;
}

export type GuidedBuildProjectOperation = "idle" | "opening" | "saving" | "other";

export interface GuidedBuildProjectPersistenceEvidence {
	readonly operation: GuidedBuildProjectOperation;
	readonly projectId: string;
	readonly currentChecksum: string;
	readonly savedChecksum: string;
	readonly currentOperationalConfigurationFingerprint: string;
	readonly savedOperationalConfigurationFingerprint: string;
	readonly fileReferenceAvailable: boolean;
	readonly migrated: boolean;
	readonly needsSave: boolean;
	readonly reopenExpectationProjectId: string | null;
	readonly reopenExpectationChecksum: string | null;
	readonly reopenExpectationSequence: number;
	readonly lastOpenedProjectId: string | null;
	readonly lastOpenedChecksum: string | null;
	readonly lastOpenedSequence: number;
}

export interface GuidedBuildReadinessEvidence {
	readonly status: RailProjectReadinessStatus;
	readonly ready: boolean;
	readonly fingerprint: string;
	readonly issues: readonly Readonly<Pick<RailProjectReadinessIssue, "code">>[];
	readonly summary: Readonly<
		Pick<
			RailProjectReadinessSummary,
			| "edges"
			| "closure"
			| "weakComponents"
			| "strongComponents"
			| "openTerminals"
			| "physicalOpenPaths"
			| "physicalStrongComponents"
		>
	>;
}

export interface GuidedBuildEvidence {
	/** Explicit UI acknowledgement, not authored project data. */
	readonly navigationAcknowledged: boolean;
	/** Project-bound receipt that the disposable practice sandbox was explicitly left behind. */
	readonly practiceGraduated: boolean;
	/** Monotonic document revision used only to bind a presentation evaluation to its source. */
	readonly authoredRevision: number;
	/** Existing canonical rail-readiness publication; never recomputed by the tutorial. */
	readonly readiness: GuidedBuildReadinessEvidence;
	/** Canonical authored group membership summarized without renderer or DOM evidence. */
	readonly equipment: GuidedBuildEquipmentEvidence;
	/** Ephemeral editor context changes guidance only; it never satisfies an authored mission. */
	readonly reuseGuidance: GuidedBuildReuseGuidanceEvidence;
	/** Exact translation/rotation-normalized authored component equivalence. */
	readonly railReuse: GuidedBuildRailReuseEvidence;
	/** Ephemeral organization-bundle placement context changes guidance only. */
	readonly bayGuidance: GuidedBuildBayGuidanceEvidence;
	/** Canonical persisted Bay -> Process Loop hierarchy evidence. */
	readonly bay: GuidedBuildBayEvidence;
	/** Ephemeral selection and reviewed command sessions change Bay Bank coaching only. */
	readonly bayBankGuidance: GuidedBuildBayBankGuidanceEvidence;
	/** Canonical persisted Bay Bank hierarchy, Twin children, and direct connector rail. */
	readonly bayBank: GuidedBuildBayBankEvidence;
	/** Ephemeral Bank selection and reviewed command sessions change Interbay coaching only. */
	readonly interbayGuidance: GuidedBuildInterbayGuidanceEvidence;
	/** Canonical persisted Fab hierarchy with direct Interbay rail ownership. */
	readonly interbay: GuidedBuildInterbayEvidence;
	/** Ephemeral same-Fab Bank selection changes Fab Loop coaching only. */
	readonly fabLoopGuidance: GuidedBuildFabLoopGuidanceEvidence;
	/** Canonical persisted two-route resilience across every direct Bank pair. */
	readonly fabLoop: GuidedBuildFabLoopEvidence;
	/** Exact current-source whole-project Worker checks. */
	readonly checks: GuidedBuildChecksEvidence;
	/** Ephemeral review surface and source-bound user acknowledgement. */
	readonly checksGuidance: GuidedBuildChecksGuidanceEvidence;
	/** Existing native project session plus session-local, exact reopen receipts. */
	readonly projectPersistence: GuidedBuildProjectPersistenceEvidence;
}

export type GuidedBuildMissionStatus = "locked" | "current" | "complete";

export interface GuidedBuildMissionEvaluation {
	readonly definition: GuidedBuildMissionDefinition;
	readonly prompt: GuidedBuildMissionPrompt;
	readonly conditionMet: boolean;
	readonly status: GuidedBuildMissionStatus;
}

export interface GuidedBuildEvaluation {
	readonly sourceKey: string;
	readonly currentMissionId: GuidedBuildFoundationMissionId | null;
	readonly completedMissionCount: number;
	readonly complete: boolean;
	readonly missions: readonly GuidedBuildMissionEvaluation[];
}

/**
 * Keeps Guided Build's activity rail aligned with the authored learning sequence.
 *
 * This is presentation policy derived from immutable mission state. It does not lock commands,
 * change editor tools, or become project data. Completed and current mission owners stay visible,
 * and the current suggested action may reveal an additional owner when coaching crosses activities
 * (for example, selecting a reusable Loop through Inspect during the Assemble mission).
 */
export function guidedBuildRevealedActivities(
	evaluation: GuidedBuildEvaluation,
): readonly EditorActivity[] {
	const revealed = new Set<EditorActivity>(["build"]);
	for (const mission of evaluation.missions) {
		if (mission.status === "locked") continue;
		revealed.add(mission.definition.activity);
		if (mission.status === "current") {
			const actionActivity = guidedBuildSuggestedActionActivity(mission.prompt.suggestedAction);
			if (actionActivity !== null) revealed.add(actionActivity);
		}
	}
	return Object.freeze(EDITOR_ACTIVITIES.filter((activity) => revealed.has(activity)));
}

export function guidedBuildRevealedRailConstructionCatalogIds(
	evaluation: GuidedBuildEvaluation,
): readonly RailConstructionCatalogId[] {
	if (evaluation.currentMissionId === null) {
		return Object.freeze(["route", "u-turn", "shift", "advanced-switch"]);
	}
	if (evaluation.currentMissionId === "orient") return Object.freeze([]);
	return Object.freeze(["route"]);
}

export function guidedBuildRevealsErase(evaluation: GuidedBuildEvaluation): boolean {
	return (
		evaluation.missions.find((mission) => mission.definition.id === "first-rail")?.status ===
		"complete"
	);
}

export function guidedBuildRevealsConstructionBar(evaluation: GuidedBuildEvaluation): boolean {
	return evaluation.currentMissionId !== "orient" && evaluation.currentMissionId !== "first-rail";
}

export function guidedBuildHidesPracticeHandoffConstructionBar(
	evaluation: GuidedBuildEvaluation,
): boolean {
	const current = evaluation.missions.find((mission) => mission.status === "current");
	return current?.prompt.suggestedAction === "graduate-practice";
}

export function guidedBuildHidesOrganizationSelectionConstructionBar(
	evaluation: GuidedBuildEvaluation,
): boolean {
	const current = evaluation.missions.find((mission) => mission.status === "current");
	return (
		current?.prompt.suggestedAction === "browse-bays" ||
		current?.prompt.suggestedAction === "browse-banks"
	);
}

export function guidedBuildRevealsRouteBendControls(evaluation: GuidedBuildEvaluation): boolean {
	return evaluation.currentMissionId !== "orient" && evaluation.currentMissionId !== "first-rail";
}

export function guidedBuildRevealsCheckStatus(evaluation: GuidedBuildEvaluation): boolean {
	const checks = evaluation.missions.find((mission) => mission.definition.id === "checks");
	return checks?.status !== "locked";
}

export function guidedBuildRevealedEquipmentToolIds(
	evaluation: GuidedBuildEvaluation,
): readonly GuidedBuildEquipmentToolId[] {
	const ports = evaluation.missions.find((mission) => mission.definition.id === "ports");
	if (ports?.status === "complete" || evaluation.currentMissionId === null) {
		return Object.freeze(["ohb", "eq", "stk"]);
	}
	const action = ports?.status === "current" ? ports.prompt.suggestedAction : null;
	return action === "ohb" || action === "eq" || action === "stk"
		? Object.freeze([action])
		: Object.freeze([]);
}

export function guidedBuildSuggestedActionClearsPortSelection(
	action: GuidedBuildSuggestedAction,
	currentMissionId: GuidedBuildFoundationMissionId | null,
): boolean {
	return (
		action === "ohb" ||
		action === "eq" ||
		action === "stk" ||
		(action === "inspect" && currentMissionId === "reuse-loop")
	);
}

export function guidedBuildPortPlacementRetainsSelection(
	guidedBuildOpen: boolean,
	currentMissionId: GuidedBuildFoundationMissionId | null,
	currentSuggestedAction: GuidedBuildSuggestedAction | null,
	completedTool: GuidedBuildEquipmentToolId,
): boolean {
	return !(
		guidedBuildOpen &&
		currentMissionId === "ports" &&
		currentSuggestedAction === completedTool
	);
}

export function guidedBuildHidesExpertSelectionInspectors(
	guidedBuildOpen: boolean,
	currentMissionId: GuidedBuildFoundationMissionId | null,
): boolean {
	return guidedBuildOpen && currentMissionId === "reuse-loop";
}

export function guidedBuildUsesCompactOrganizationPicker(
	guidedBuildOpen: boolean,
	currentMissionId: GuidedBuildFoundationMissionId | null,
): boolean {
	return (
		guidedBuildOpen &&
		(currentMissionId === "bay-bank" ||
			currentMissionId === "interbay" ||
			currentMissionId === "fab-loop")
	);
}

export function guidedBuildVisibleOrganizationSelectionCount(
	guidedPickerActive: boolean,
	selectedOrganizationIds: readonly number[],
	visibleOrganizationIds: readonly number[],
): number | null {
	if (!guidedPickerActive) return null;
	const selectedIds = new Set(selectedOrganizationIds);
	return visibleOrganizationIds.reduce(
		(count, organizationId) => count + (selectedIds.has(organizationId) ? 1 : 0),
		0,
	);
}

export function guidedBuildSuggestedActionSuppressesBayConfiguration(
	action: GuidedBuildSuggestedAction,
	currentMissionId: GuidedBuildFoundationMissionId | null,
): boolean {
	return action === "add-bay" && currentMissionId === "bay";
}

export function guidedBuildOrganizationPlacementIsHierarchyDuplicate(
	origin: BlueprintPlacementOrigin | null,
): boolean {
	return origin === "selection-copy";
}

export function guidedBuildSelectionCopyPlacementIsSingleCommit(
	guidedBuildActive: boolean,
	currentMissionId: GuidedBuildFoundationMissionId | null,
	origin: BlueprintPlacementOrigin | null,
): boolean {
	return guidedBuildActive && currentMissionId === "reuse-loop" && origin === "selection-copy";
}

export function guidedBuildOrganizationPlacementIsSingleCommit(
	currentMissionId: GuidedBuildFoundationMissionId | null,
	primaryCommandId: EditorCommandId | null,
): boolean {
	return (
		primaryCommandId === "canvas.primary-click" &&
		(currentMissionId === "bay" ||
			currentMissionId === "bay-bank" ||
			currentMissionId === "interbay")
	);
}

export function guidedBuildSuggestedActionClearsOrganizationPlacement(
	action: GuidedBuildSuggestedAction,
): boolean {
	return action === "browse-bays" || action === "browse-banks";
}

export function guidedBuildOrganizationArrangementSelectionMode(
	action: GuidedBuildSuggestedAction,
): "EFFECTIVE" | null {
	return action === "arrange-bays" || action === "arrange-banks" ? "EFFECTIVE" : null;
}

export function guidedBuildShouldAddOrganizationTap(
	prompt: GuidedBuildMissionPrompt | null,
	selectedOrganizationIds: readonly number[],
	clickedOrganizationId: number,
): boolean {
	return (
		prompt?.organizationSelectionTargetCount === 2 &&
		selectedOrganizationIds.length === 1 &&
		selectedOrganizationIds[0] !== clickedOrganizationId
	);
}

export function guidedBuildTreatsPrimaryTouchAsPan(evaluation: GuidedBuildEvaluation): boolean {
	return evaluation.currentMissionId === "orient";
}

export function evaluateGuidedBuildFoundation(
	evidence: GuidedBuildEvidence,
): GuidedBuildEvaluation {
	const conditions: Readonly<Record<GuidedBuildFoundationMissionId, boolean>> = {
		orient: evidence.navigationAcknowledged,
		"first-rail":
			evidence.practiceGraduated ||
			(evidence.readiness.summary.edges > 0 &&
				evidence.railReuse.networkLinkSupportedComponentCount > 0),
		"process-loop":
			evidence.practiceGraduated ||
			(processLoopConditionMet(evidence.readiness, evidence.railReuse) &&
				evidence.railReuse.networkLinkSupportedComponentCount > 0),
		ports: evidence.practiceGraduated || portEquipmentConditionMet(evidence.equipment),
		"reuse-loop":
			evidence.practiceGraduated ||
			reusedLoopConditionMet(evidence.readiness, evidence.railReuse, evidence.equipment),
		bay: evidence.bay.twinProductionBayCount > 0,
		"bay-bank": evidence.bayBank.railBearingTwinBayBankCount > 0,
		interbay: evidence.interbay.interbayFabCount > 0,
		"fab-loop": evidence.fabLoop.resilientFabLoopCount > 0,
		checks:
			evidence.checks.available &&
			evidence.checks.ready &&
			evidence.checks.fingerprint.length > 0 &&
			evidence.checksGuidance.acknowledgedFingerprint === evidence.checks.fingerprint,
		"project-save": guidedBuildProjectSaved(evidence.projectPersistence),
		"project-reopen": guidedBuildProjectReopened(evidence.projectPersistence),
	};
	let previousComplete = true;
	let currentMissionId: GuidedBuildFoundationMissionId | null = null;
	let completedMissionCount = 0;
	const missions = GUIDED_BUILD_FOUNDATION_MISSIONS.map((definition) => {
		const conditionMet = conditions[definition.id];
		const status: GuidedBuildMissionStatus = !previousComplete
			? "locked"
			: conditionMet
				? "complete"
				: "current";
		if (status === "current") currentMissionId ??= definition.id;
		if (status === "complete") completedMissionCount++;
		previousComplete = previousComplete && status === "complete";
		return Object.freeze({
			definition,
			prompt: guidedBuildMissionPrompt(definition, evidence),
			conditionMet,
			status,
		});
	});
	const complete = completedMissionCount === GUIDED_BUILD_FOUNDATION_MISSIONS.length;
	return Object.freeze({
		sourceKey: guidedBuildSourceKey(evidence),
		currentMissionId: complete ? null : currentMissionId,
		completedMissionCount,
		complete,
		missions: Object.freeze(missions),
	});
}

export function guidedBuildSuggestedActionActivity(
	action: GuidedBuildSuggestedAction | null,
): EditorActivity | null {
	if (action === null) return null;
	if (action === "build") return "build";
	if (action === "inspect" || action === "open-checks" || action === "confirm-checks") {
		return "inspect";
	}
	if (action === "ohb" || action === "eq" || action === "stk") return "equip";
	if (action === "save-project" || action === "open-project") return "inspect";
	return "assemble";
}

/**
 * Identify the Activity that can perform the current mission instruction.
 *
 * A cross-Activity suggested action takes precedence (for example Inspect while Reuse Loop is
 * waiting for an anchor). Missions without an action still point back to their owning Activity so
 * an ordinary Expert detour cannot leave the visible instruction bound to the wrong tool.
 */
export function guidedBuildTargetActivity(
	evaluation: GuidedBuildEvaluation,
): EditorActivity | null {
	const current = evaluation.missions.find((mission) => mission.status === "current") ?? null;
	if (current === null) return null;
	return (
		guidedBuildSuggestedActionActivity(current.prompt.suggestedAction) ??
		current.definition.activity
	);
}

function guidedBuildMissionPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	if (definition.id === "orient") return guidedBuildOrientPrompt(definition);
	if (definition.id === "first-rail") return guidedBuildFirstRailPrompt(definition, evidence);
	if (definition.id === "process-loop") {
		return guidedBuildProcessLoopPrompt(definition, evidence.readiness);
	}
	if (definition.id === "checks") {
		const checksPrompt = guidedBuildChecksPrompt(definition, evidence);
		return guidedBuildProjectReopened(evidence.projectPersistence)
			? guidedBuildReopenFinalCheckPrompt(checksPrompt, evidence)
			: checksPrompt;
	}
	if (definition.id === "project-save") return guidedBuildProjectSavePrompt(definition, evidence);
	if (definition.id === "project-reopen")
		return guidedBuildProjectReopenPrompt(definition, evidence);
	if (definition.id === "fab-loop") return guidedBuildFabLoopPrompt(definition, evidence);
	if (definition.id === "interbay") return guidedBuildInterbayPrompt(definition, evidence);
	if (definition.id === "bay-bank") return guidedBuildBayBankPrompt(definition, evidence);
	if (definition.id === "bay") {
		if (!evidence.practiceGraduated) {
			return Object.freeze({
				eyebrow: "MISSION 6 · BAY · HANDOFF",
				title: "연습을 마치고 FAB 시작",
				objective:
					"START FAB를 누른 뒤 연습 프로젝트를 저장할지 선택하세요. 그러면 빈 실제 FAB 프로젝트에서 Twin Bay 배치를 시작합니다.",
				rationale:
					"연습 Loop와 실제 FAB 구조는 별도 프로젝트로 관리합니다. 저장을 선택하면 연습 파일도 남길 수 있습니다.",
				primaryCommandId: null,
				suggestedAction: "graduate-practice",
				suggestedActionLabel: "START FAB · 새 프로젝트",
			});
		}
		if (evidence.bayGuidance.placementActive) {
			return Object.freeze({
				eyebrow: "MISSION 6 · BAY · 2/2",
				title: "기본 Twin Bay 배치",
				objective:
					"청록색 Twin Bay 미리보기의 ‘여기를 탭’ 표식을 눌러 현재 위치에 배치하세요. 표식이 보이지 않으면 −로 한 번 축소하세요.",
				rationale: definition.rationale,
				primaryCommandId: "canvas.primary-click",
				suggestedAction: null,
				suggestedActionLabel: null,
			});
		}
		return Object.freeze({
			eyebrow: "MISSION 6 · BAY · 1/2",
			title: "기본 Twin Bay 시작",
			objective:
				"기본 Twin Bay 배치를 바로 시작하세요. 연습 Loop를 박스로 묶지 않고 Shell과 Gateway를 함께 만듭니다.",
			rationale: definition.rationale,
			primaryCommandId: null,
			suggestedAction: "add-bay",
			suggestedActionLabel: "조립 · 기본 TWIN BAY",
		});
	}
	if (definition.id === "reuse-loop") {
		if (
			evidence.railReuse.repeatedComponentCopyCount >= 2 &&
			!reusedEquipmentConditionMet(evidence.equipment)
		) {
			return Object.freeze({
				eyebrow: "MISSION 5 · REUSE LOOP · PORT CHECK",
				title: evidence.reuseGuidance.selectionAnchorReady
					? "Port 포함 Loop 전체 선택"
					: "Port 포함 Loop 선택",
				objective: evidence.reuseGuidance.selectionAnchorReady
					? "선택한 원본 Loop의 연결 구조 전체를 선택해 OHB, EQ, STK까지 함께 복제하세요."
					: "OHB, EQ, STK가 붙은 원본 Loop의 레일 하나를 먼저 탭하세요.",
				rationale: definition.rationale,
				primaryCommandId: evidence.reuseGuidance.selectionAnchorReady
					? "selection.connected"
					: "selection.inspect-target",
				suggestedAction: evidence.reuseGuidance.selectionAnchorReady
					? "select-connected"
					: "inspect",
				suggestedActionLabel: evidence.reuseGuidance.selectionAnchorReady
					? "SELECT · 선택한 Port 포함 Loop 전체"
					: "검사 · Port 포함 Loop 탭",
			});
		}
		if (evidence.reuseGuidance.placementActive) {
			return Object.freeze({
				eyebrow: "MISSION 5 · REUSE LOOP · 3/3",
				title: "Port 포함 Loop 배치",
				objective:
					"공간이 부족하면 −로 축소한 뒤, 기존 Loop와 겹치지 않는 정렬된 위치에 레일과 OHB·EQ·STK 복제 미리보기를 한 번 배치하세요.",
				rationale: definition.rationale,
				primaryCommandId: "canvas.primary-click",
				suggestedAction: null,
				suggestedActionLabel: null,
			});
		}
		if (evidence.reuseGuidance.reusableSelectionReady) {
			return Object.freeze({
				eyebrow: "MISSION 5 · REUSE LOOP · 2/3",
				title: "Port 포함 Loop 복제",
				objective: "선택한 레일과 OHB·EQ·STK를 함께 복사해 1회 배치 미리보기를 시작하세요.",
				rationale: definition.rationale,
				primaryCommandId: "selection.copy",
				suggestedAction: "copy-selection",
				suggestedActionLabel: "COPY · Port 포함 Loop 복제",
			});
		}
		return Object.freeze({
			eyebrow: "MISSION 5 · REUSE LOOP · 1/3",
			title: evidence.reuseGuidance.selectionAnchorReady
				? "Port 포함 Loop 전체 선택"
				: "Port 포함 Loop 선택",
			objective: evidence.reuseGuidance.selectionAnchorReady
				? "현재 선택이 속한 Loop의 레일과 OHB·EQ·STK 전체를 선택하세요."
				: "원본 Loop의 레일이나 OHB·EQ·STK 하나를 먼저 탭하세요.",
			rationale: definition.rationale,
			primaryCommandId: evidence.reuseGuidance.selectionAnchorReady
				? "selection.connected"
				: "selection.inspect-target",
			suggestedAction: evidence.reuseGuidance.selectionAnchorReady ? "select-connected" : "inspect",
			suggestedActionLabel: evidence.reuseGuidance.selectionAnchorReady
				? "SELECT · Port 포함 Loop 전체"
				: "검사 · Port 포함 Loop 탭",
		});
	}
	if (definition.id !== "ports") return promptFromDefinition(definition, null, null);
	if (!equipmentKindComplete("OHB", evidence.equipment.OHB)) {
		return Object.freeze({
			eyebrow: "MISSION 4 · PORTS · 1/3",
			title: "OHB Port 배치",
			objective: "OHB 도구로 레일의 합법 슬롯에 대표 Port를 하나 배치하세요.",
			rationale: definition.rationale,
			primaryCommandId: "canvas.primary-click",
			suggestedAction: "ohb",
			suggestedActionLabel: "장비 · OHB 열기",
			progressCue: guidedBuildPortProgressCue(
				evidence.equipment,
				"왼쪽의 강조된 OHB · 단일 Port를 선택하세요. 캔버스 포커스에서 방향키로 슬롯을 고르고 Enter로 배치하거나, 점선 고리가 있는 청록 슬롯을 클릭하세요.",
			),
		});
	}
	if (!equipmentKindComplete("EQ", evidence.equipment.EQ)) {
		return Object.freeze({
			eyebrow: "MISSION 4 · PORTS · 2/3",
			title: "EQ Port 행 배치",
			objective: "EQ 도구로 같은 직선 레일을 따라 두 개 이상의 Port를 한 그룹으로 배치하세요.",
			rationale: definition.rationale,
			primaryCommandId: "canvas.primary-click",
			suggestedAction: "eq",
			suggestedActionLabel: "장비 · EQ 열기",
			progressCue: guidedBuildPortProgressCue(
				evidence.equipment,
				"강조된 EQ · Port를 선택하세요. 청록색 1 시작과 2 끝을 차례로 클릭하거나 드래그하세요. 키보드는 시작과 끝에서 Enter를 사용합니다.",
			),
		});
	}
	if (!equipmentKindComplete("STK", evidence.equipment.STK)) {
		return Object.freeze({
			eyebrow: "MISSION 4 · PORTS · 3/3",
			title: "STK Port 그룹 배치",
			objective: "STK 도구로 진입·배출 Port를 선택해 대표 Stocker 그룹을 완성하세요.",
			rationale: definition.rationale,
			primaryCommandId: "canvas.primary-click",
			suggestedAction: "stk",
			suggestedActionLabel: "장비 · STK 열기",
			progressCue: guidedBuildPortProgressCue(
				evidence.equipment,
				"왼쪽의 강조된 STK · 입출고 Port를 선택하세요. 캔버스에서 방향키와 Enter로 추천 슬롯 두 개를 고르거나, 황금 마름모 슬롯 두 개를 클릭한 뒤 STK 생성을 누르세요.",
			),
		});
	}
	return promptFromDefinition(definition, null, null);
}

function guidedBuildOrientPrompt(
	definition: GuidedBuildMissionDefinition,
): GuidedBuildMissionPrompt {
	return Object.freeze({
		...promptFromDefinition(definition, null, null),
		progressCue: Object.freeze({
			label: "화면 조작",
			value: "TOUCH · MOUSE",
			instruction:
				"터치는 한 손가락 드래그로 이동하고 화면의 +/− 버튼으로 확대·축소하세요. 마우스는 오른쪽/가운데 드래그와 휠을 사용합니다.",
		}),
	});
}

function guidedBuildPortProgressCue(
	equipment: GuidedBuildEquipmentEvidence,
	instruction: string,
): GuidedBuildMissionProgressCue {
	const completedPortCount = (
		kind: GuidedBuildEquipmentKind,
		evidence: GuidedBuildEquipmentKindEvidence,
	): number =>
		evidence.groupCount > 0 ? Math.min(evidence.largestGroupPortCount, kind === "OHB" ? 1 : 2) : 0;
	return Object.freeze({
		label: "Port-first 진행",
		value: `OHB ${completedPortCount("OHB", equipment.OHB)}/1 · EQ ${completedPortCount("EQ", equipment.EQ)}/2 · STK ${completedPortCount("STK", equipment.STK)}/2`,
		instruction,
	});
}

function guidedBuildFirstRailPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	const existingEdgeCount = evidence.readiness.summary.edges;
	const longestStraightRunMeters = evidence.railReuse.longestStraightRunMeters ?? 0;
	return Object.freeze({
		...promptFromDefinition(definition, null, null),
		progressCue: Object.freeze({
			label: existingEdgeCount > 0 ? "다시 그려도 안전해요" : "첫 실습",
			value:
				existingEdgeCount > 0
					? `가장 긴 직선 ${longestStraightRunMeters.toLocaleString()} / 15 m · 전체 ${existingEdgeCount.toLocaleString()} m`
					: "가장 긴 직선 0 / 15 m",
			instruction:
				existingEdgeCount > 0
					? "꺾인 길이의 합이 아니라 한 방향의 연속 직선이 목표입니다. 주황색 열린 끝을 같은 방향으로 늘리거나, 다른 빈 곳에서 15 m 직선을 새로 그리세요. 연습 초안은 남겨도 되며 START FAB에서 새 프로젝트로 넘어갑니다."
					: "빈 곳 어디에서든 터치는 누른 채, 마우스는 LMB를 누른 채 가로 또는 세로로 15 m 이상 끌고 놓으세요. 이 직선은 그대로 유지하고, 다음 단계에서 레일 화살표가 향하는 끝부터 Loop를 닫습니다.",
		}),
	});
}

function guidedBuildProcessLoopPrompt(
	definition: GuidedBuildMissionDefinition,
	readiness: GuidedBuildReadinessEvidence,
): GuidedBuildMissionPrompt {
	const openTerminalCount = readiness.summary.openTerminals;
	const multipleDrafts = readiness.summary.weakComponents > 1;
	return Object.freeze({
		...promptFromDefinition(definition, null, null),
		progressCue: Object.freeze({
			label: "Loop 상태",
			value:
				openTerminalCount > 0
					? `열린 끝 ${openTerminalCount}개 · 목표 0개`
					: "열린 끝 0개 · 방향 흐름 확인",
			instruction: multipleDrafts
				? "15 m 이상인 긴 직선에서 레일 화살표가 향하는 주황색 열린 끝을 찾으세요. 먼저 바깥으로 최소 6칸 뻗은 뒤 나머지 두 변을 이어 그 직선의 시작점에 닫으세요. 짧은 연습 초안은 남겨도 됩니다."
				: openTerminalCount > 0
					? "공간이 부족하면 −로 축소하세요. 첫 15칸 이상 직선을 유지한 채 레일 화살표가 향하는 주황색 열린 끝에서 먼저 바깥으로 최소 6칸 뻗고, 나머지 두 변을 이어 시작점에 닫으세요."
					: "모든 단방향 흐름이 끊김 없이 한 바퀴 이어지도록 표시된 구간을 고치세요.",
		}),
	});
}

function guidedBuildBayBankPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	const guidance = evidence.bayBankGuidance;
	if (evidence.bayBank.twinProductionBayCount < 2) {
		if (guidance.placementActive) {
			return bankPrompt(
				definition,
				"MISSION 7 · BAY BANK · 3/8",
				"복제 Twin Bay 배치",
				"원본 옆 청록색 복제 미리보기의 ‘여기를 탭’ 표식을 눌러 현재 위치에 배치하세요. 직접 옮기면 가까운 X/Z 중심축에 스냅됩니다.",
				"canvas.primary-click",
			);
		}
		if (guidance.selectedOrganizationCount === 1 && guidance.selectedTwinBayCount === 1) {
			return bankPrompt(
				definition,
				"MISSION 7 · BAY BANK · 2/8",
				"Twin Bay 전체 계층 복제",
				"아래 DUPLICATE를 눌러 Twin Bay와 하위 Process Loop 두 개를 함께 복제하세요.",
				null,
				"duplicate-bay",
				"DUPLICATE · TWIN BAY 전체 복제",
			);
		}
		return bankPrompt(
			definition,
			"MISSION 7 · BAY BANK · 1/8",
			"복제할 Twin Bay 선택",
			guidance.organizationBrowserOpen
				? "FAB ORGANIZATION 목록에서 Twin Bay 하나만 선택하세요."
				: "FAB ORGANIZATION 목록을 열어 방금 만든 Twin Bay 하나를 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-bays",
			guidance.organizationBrowserOpen ? null : "TWIN BAY 목록 열기",
			1,
		);
	}

	if (guidance.selectedOrganizationCount !== 2 || guidance.selectedTwinBayCount !== 2) {
		const originalBaySelectionRetained =
			guidance.selectedOrganizationCount === 1 && guidance.selectedTwinBayCount === 1;
		return bankPrompt(
			definition,
			"MISSION 7 · BAY BANK · 4/8",
			"Twin Bay 두 개 선택",
			guidance.organizationBrowserOpen
				? originalBaySelectionRetained
					? "원본 Twin Bay는 이미 선택되어 있습니다(✓). 체크가 없는 복제 Twin Bay 하나만 탭해 2 / 2로 만드세요."
					: "FAB ORGANIZATION 목록에서 원본과 복제 Twin Bay 두 개를 선택하세요."
				: originalBaySelectionRetained
					? "원본 Twin Bay 선택은 유지되었습니다. FAB ORGANIZATION 목록을 열어 복제 Twin Bay 하나를 추가하세요."
					: "FAB ORGANIZATION 목록을 열어 원본과 복제 Twin Bay 두 개를 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-bays",
			guidance.organizationBrowserOpen ? null : "TWIN BAY 목록 열기 · 2개 선택",
			2,
		);
	}

	if (guidance.connectorPhase !== "inactive") {
		return guidedBuildConnectorPrompt(definition, guidance.connectorPhase);
	}
	if (!guidance.selectedTwinBayPairAligned) {
		if (guidance.arrangementPhase !== "inactive") {
			return bankPrompt(
				definition,
				"MISSION 7 · BAY BANK · 6/8",
				guidance.arrangementPhase === "rejected" ? "현재 정렬 적용 불가" : "중심 정렬 검증·적용",
				guidance.arrangementPhase === "certified"
					? "충돌 없이 정렬된 미리보기를 APPLY로 적용하세요."
					: guidance.arrangementPhase === "rejected"
						? "현재 옵션은 적용할 수 없습니다. 강조된 취소로 두 Twin Bay 선택을 유지한 뒤 복제 Bay 위치를 바꾸세요."
						: "두 Twin Bay의 정렬 미리보기가 준비될 때까지 기다리세요.",
				guidance.arrangementPhase === "certified"
					? "command.apply"
					: guidance.arrangementPhase === "rejected"
						? "command.cancel"
						: null,
			);
		}
		return bankPrompt(
			definition,
			"MISSION 7 · BAY BANK · 5/8",
			"Twin Bay 중심 정렬",
			"두 Twin Bay의 선택을 유지하고 ARRANGE로 행 또는 열 중심을 맞추세요.",
			"arrangement.start",
			"arrange-bays",
			"ARRANGE · TWIN BAY 중심 맞추기",
		);
	}
	return bankPrompt(
		definition,
		"MISSION 7 · BAY BANK · 7/8",
		"두 Twin Bay 연결",
		"현재 두 Twin Bay가 같은 중심축이므로 추가 ARRANGE 없이 아래 CONNECT BAYS를 눌러 하나의 Bay Bank를 만들 연결 경로를 검토하세요.",
		"assembly-connector.start",
		"connect-bays",
		"CONNECT BAYS · BAY BANK 만들기",
	);
}

function guidedBuildConnectorPrompt(
	definition: GuidedBuildMissionDefinition,
	phase: GuidedBuildConnectorGuidancePhase,
): GuidedBuildMissionPrompt {
	if (phase === "pick-source-gateway" || phase === "pick-target-gateway") {
		return connectorPrompt(
			definition,
			"MISSION 7 · BAY BANK · 8/8",
			phase === "pick-source-gateway" ? "출발 Gateway(연결 지점) 선택" : "도착 Gateway 선택",
			phase === "pick-source-gateway"
				? "첫 Twin Bay 외곽에서 강조된 직선 Gateway 하나를 선택하세요."
				: "다른 Twin Bay 외곽에서 마주보는 강조 Gateway를 선택하세요.",
			"canvas.primary-click",
		);
	}
	if (phase === "ready") {
		return connectorPrompt(
			definition,
			"MISSION 7 · BAY BANK · 8/8",
			"Bay Bank 만들기",
			"검토한 왕복 연결과 Bay Bank를 한 번의 실행 취소 가능한 작업으로 적용하세요.",
			"command.apply",
		);
	}
	if (phase === "rejected") {
		return connectorPrompt(
			definition,
			"MISSION 7 · BAY BANK · 8/8",
			"다음 연결 시도 확인",
			"CONNECT BAYS 패널에서 맥동하는 다음 시도 하나를 선택하세요. 새 경로가 READY가 될 때까지 적용은 잠깁니다.",
			null,
		);
	}
	return connectorPrompt(
		definition,
		"MISSION 7 · BAY BANK · 8/8",
		phase === "applying" ? "Bay Bank 적용 중" : "왕복 연결 확인 중",
		phase === "applying"
			? "검증된 왕복 연결과 Bay Bank 계층을 적용하고 있습니다."
			: "충돌 없는 왕복 경로가 준비될 때까지 기다리세요.",
		null,
	);
}

function guidedBuildInterbayPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	const guidance = evidence.interbayGuidance;
	if (evidence.interbay.semanticBayBankCount < 2) {
		if (guidance.placementActive) {
			return bankPrompt(
				definition,
				"MISSION 8 · INTERBAY · 3/8",
				"복제 Bay Bank 배치",
				"원본 옆 청록색 복제 Bay Bank 미리보기의 ‘여기를 탭’ 표식을 눌러 현재 위치에 배치하세요. 직접 옮기면 가까운 X/Z 중심축에 스냅됩니다.",
				"canvas.primary-click",
			);
		}
		if (guidance.selectedOrganizationCount === 1 && guidance.selectedBayBankCount === 1) {
			return bankPrompt(
				definition,
				"MISSION 8 · INTERBAY · 2/8",
				"Bay Bank 전체 계층 복제",
				"아래 DUPLICATE를 눌러 Bay Bank와 하위 Bay·Process Loop·연결 레일을 함께 복제하세요.",
				null,
				"duplicate-bank",
				"DUPLICATE · BAY BANK 전체 복제",
			);
		}
		return bankPrompt(
			definition,
			"MISSION 8 · INTERBAY · 1/8",
			"복제할 Bay Bank 선택",
			guidance.organizationBrowserOpen
				? "FAB ORGANIZATION 목록에서 방금 완성한 Bay Bank 하나만 선택하세요."
				: "FAB ORGANIZATION 목록을 열어 방금 완성한 Bay Bank 하나를 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-banks",
			guidance.organizationBrowserOpen ? null : "BAY BANK 목록 열기",
			1,
		);
	}

	if (guidance.selectedOrganizationCount !== 2 || guidance.selectedBayBankCount !== 2) {
		const originalBankSelectionRetained =
			guidance.selectedOrganizationCount === 1 && guidance.selectedBayBankCount === 1;
		return bankPrompt(
			definition,
			"MISSION 8 · INTERBAY · 4/8",
			"Bay Bank 두 개 선택",
			guidance.organizationBrowserOpen
				? originalBankSelectionRetained
					? "원본 Bay Bank는 이미 선택되어 있습니다(✓). 체크가 없는 복제 Bay Bank 하나만 탭해 2 / 2로 만드세요."
					: "FAB ORGANIZATION 목록에서 원본과 복제 Bay Bank 두 개를 선택하세요."
				: originalBankSelectionRetained
					? "원본 Bay Bank 선택은 유지되었습니다. FAB ORGANIZATION 목록을 열어 복제 Bay Bank 하나를 추가하세요."
					: "FAB ORGANIZATION 목록을 열어 원본과 복제 Bay Bank 두 개를 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-banks",
			guidance.organizationBrowserOpen ? null : "BAY BANK 목록 열기 · 2개 선택",
			2,
		);
	}

	if (guidance.connectorPhase !== "inactive") {
		return guidedBuildInterbayConnectorPrompt(definition, guidance.connectorPhase);
	}
	if (!guidance.selectedBayBankPairAligned) {
		if (guidance.arrangementPhase !== "inactive") {
			return bankPrompt(
				definition,
				"MISSION 8 · INTERBAY · 6/8",
				guidance.arrangementPhase === "rejected"
					? "현재 정렬 적용 불가"
					: "Bay Bank 중심 정렬 검증·적용",
				guidance.arrangementPhase === "certified"
					? "충돌 없이 정렬된 미리보기를 APPLY로 적용하세요."
					: guidance.arrangementPhase === "rejected"
						? "현재 옵션은 적용할 수 없습니다. 강조된 취소로 두 Bay Bank 선택을 유지한 뒤 복제 Bay Bank 위치를 바꾸세요."
						: "두 Bay Bank의 정렬 미리보기가 준비될 때까지 기다리세요.",
				guidance.arrangementPhase === "certified"
					? "command.apply"
					: guidance.arrangementPhase === "rejected"
						? "command.cancel"
						: null,
			);
		}
		return bankPrompt(
			definition,
			"MISSION 8 · INTERBAY · 5/8",
			"Bay Bank 중심 정렬",
			"두 Bay Bank의 선택을 유지하고 ARRANGE로 Interbay가 지나갈 행 또는 열 중심을 맞추세요.",
			"arrangement.start",
			"arrange-banks",
			"ARRANGE · BAY BANK 중심 맞추기",
		);
	}
	return bankPrompt(
		definition,
		"MISSION 8 · INTERBAY · 7/8",
		"두 Bay Bank 연결",
		"현재 두 Bay Bank가 같은 중심축이므로 추가 ARRANGE 없이 아래 CONNECT BANKS를 눌러 하나의 Fab을 만들 Interbay 경로를 검토하세요.",
		"assembly-connector.start",
		"connect-banks",
		"CONNECT BANKS · FAB 만들기",
	);
}

function guidedBuildInterbayConnectorPrompt(
	definition: GuidedBuildMissionDefinition,
	phase: GuidedBuildConnectorGuidancePhase,
): GuidedBuildMissionPrompt {
	if (phase === "pick-source-gateway" || phase === "pick-target-gateway") {
		return connectorPrompt(
			definition,
			"MISSION 8 · INTERBAY · 8/8",
			phase === "pick-source-gateway"
				? "출발 Bay Bank의 Gateway 선택"
				: "도착 Bay Bank의 Gateway 선택",
			phase === "pick-source-gateway"
				? "첫 Bay Bank 안의 연결 레일에서 강조된 Gateway(연결 지점) 하나를 선택하세요."
				: "다른 Bay Bank에서 마주보는 강조 Gateway를 선택하세요.",
			"canvas.primary-click",
		);
	}
	if (phase === "ready") {
		return connectorPrompt(
			definition,
			"MISSION 8 · INTERBAY · 8/8",
			"Fab 만들기",
			"검토한 왕복 연결과 Fab을 한 번의 실행 취소 가능한 작업으로 적용하세요.",
			"command.apply",
		);
	}
	if (phase === "rejected") {
		return connectorPrompt(
			definition,
			"MISSION 8 · INTERBAY · 8/8",
			"다음 Interbay 시도 확인",
			"CONNECT BANKS 패널에서 맥동하는 다음 시도 하나를 선택하세요. 새 경로가 READY가 될 때까지 적용은 잠깁니다.",
			null,
		);
	}
	return connectorPrompt(
		definition,
		"MISSION 8 · INTERBAY · 8/8",
		phase === "applying" ? "Fab Interbay 적용 중" : "Interbay 검증 중",
		phase === "applying"
			? "검증된 Interbay 왕복 연결과 Fab 계층을 적용하고 있습니다."
			: "충돌 없는 Interbay 왕복 경로가 준비될 때까지 기다리세요.",
		null,
	);
}

function guidedBuildFabLoopPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	const guidance = evidence.fabLoopGuidance;
	if (guidance.selectedOrganizationCount !== 2 || guidance.selectedBayBankCount !== 2) {
		return bankPrompt(
			definition,
			"MISSION 9 · FAB LOOP · 1/3",
			"같은 Fab의 두 Bay Bank 선택",
			guidance.organizationBrowserOpen
				? "현재 선택은 그대로 두고, 같은 Fab의 Bay Bank가 2 / 2가 될 때까지 목록에서 선택하세요."
				: "FAB ORGANIZATION 목록을 열어 같은 Fab의 두 Bay Bank를 함께 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-banks",
			guidance.organizationBrowserOpen ? null : "BAY BANK 목록 열기 · 2개 선택",
			2,
		);
	}
	if (guidance.connectorPhase !== "inactive") {
		return guidedBuildFabLoopConnectorPrompt(definition, guidance.connectorPhase);
	}
	return bankPrompt(
		definition,
		"MISSION 9 · FAB LOOP · 2/3",
		"Fab 외곽 순환 추가",
		"아래 ADD FAB LOOP를 눌러 같은 두 Bay Bank를 다시 연결해 기존 Interbay와 겹치지 않는 두 번째 왕복 길을 만드세요.",
		"assembly-connector.start",
		"add-fab-loop",
		"ADD FAB LOOP · 외곽 순환",
	);
}

function guidedBuildFabLoopConnectorPrompt(
	definition: GuidedBuildMissionDefinition,
	phase: GuidedBuildConnectorGuidancePhase,
): GuidedBuildMissionPrompt {
	if (phase === "pick-source-gateway" || phase === "pick-target-gateway") {
		return connectorPrompt(
			definition,
			"MISSION 9 · FAB LOOP · 3/3",
			phase === "pick-source-gateway" ? "출발 외곽 Gateway 선택" : "도착 외곽 Gateway 선택",
			phase === "pick-source-gateway"
				? "첫 Bay Bank 하위 Bay 레일에서 기존 Interbay와 떨어진 강조 Gateway를 선택하세요."
				: "다른 Bay Bank 하위 Bay 레일에서 마주보는 강조 Gateway를 선택하세요.",
			"canvas.primary-click",
		);
	}
	if (phase === "ready") {
		return connectorPrompt(
			definition,
			"MISSION 9 · FAB LOOP · 3/3",
			"외곽 순환 적용",
			"검토한 두 번째 왕복 연결을 기존 Fab에 한 번의 실행 취소 가능한 작업으로 적용하세요.",
			"command.apply",
		);
	}
	if (phase === "rejected") {
		return connectorPrompt(
			definition,
			"MISSION 9 · FAB LOOP · 3/3",
			"다음 외곽 경로 시도 확인",
			"ADD FAB LOOP 패널에서 맥동하는 다음 시도 하나를 선택하세요. 새 경로가 READY가 될 때까지 적용은 잠깁니다.",
			null,
		);
	}
	return connectorPrompt(
		definition,
		"MISSION 9 · FAB LOOP · 3/3",
		phase === "applying" ? "Fab Loop 적용 중" : "Fab Loop 검증 중",
		phase === "applying"
			? "검증된 Fab 외곽 왕복 연결을 적용하고 있습니다."
			: "기존 Interbay와 겹치지 않는 왕복 경로가 준비될 때까지 기다리세요.",
		null,
	);
}

function guidedBuildChecksPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	const checks = evidence.checks;
	const guidance = evidence.checksGuidance;
	if (!checks.available) {
		if (guidance.inspectionPending) {
			return bankPrompt(
				definition,
				"MISSION 10 · CHECKS · 2/3",
				"전체 프로젝트 검사 중",
				"현재 FAB의 레일·포트·장비·조직 관계 검사가 끝날 때까지 기다리세요.",
				null,
			);
		}
		return bankPrompt(
			definition,
			"MISSION 10 · CHECKS · 1/3",
			"CHECKS 열기",
			"아래 검사 열기를 눌러 현재 FAB 전체 검사를 시작하세요.",
			null,
			"open-checks",
			"검사 열기",
		);
	}
	if (!checks.ready) {
		const protectedNetworkGuidance =
			checks.separateRailNetworkCount > 1
				? " Bay·Bank·Fab 안의 레일은 일반 레일 연결로 바꾸지 마세요. CHECKS에서 첫 차단 문제를 선택하고 NEXT EDIT에 표시된 조직 또는 연결 편집을 따르세요."
				: "";
		return bankPrompt(
			definition,
			"MISSION 10 · CHECKS · FIX",
			"차단 이슈 해결",
			`${checks.blockingIssueCount}개 차단 이슈와 ${checks.followUpIssueCount}개 후속 이슈를 CHECKS에서 확인하고 일반 편집 명령으로 해결하세요.${protectedNetworkGuidance}`,
			null,
			guidance.navigatorOpen ? null : "open-checks",
			guidance.navigatorOpen ? null : "CHECKS 다시 열기",
		);
	}
	if (!guidance.navigatorOpen) {
		return bankPrompt(
			definition,
			"MISSION 10 · CHECKS · 2/3",
			"검증 결과 검토",
			"현재 프로젝트 검사는 통과했습니다. CHECKS를 열어 각 도메인의 OK 결과를 확인하세요.",
			null,
			"open-checks",
			"통과 결과 보기",
		);
	}
	return bankPrompt(
		definition,
		"MISSION 10 · CHECKS · 3/3",
		"현재 검증 결과 확인",
		"CHECKS에서 '0 ISSUES'와 'ALL STATIC FAB CHECKS PASSED'가 표시되는지 확인하세요.",
		null,
		"confirm-checks",
		"검사 통과 확인",
	);
}

function guidedBuildReopenFinalCheckPrompt(
	prompt: GuidedBuildMissionPrompt,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	const checks = evidence.checks;
	const guidance = evidence.checksGuidance;
	if (!checks.available) {
		return Object.freeze({
			...prompt,
			eyebrow: "MISSION 12 · REOPEN · FINAL CHECK",
			title: guidance.inspectionPending ? "다시 연 프로젝트 검사 중" : "다시 연 프로젝트 최종 검사",
			objective: guidance.inspectionPending
				? "방금 다시 연 FAB의 레일·포트·장비·조직 관계를 확인하고 있습니다."
				: "방금 저장한 같은 프로젝트를 다시 열었습니다. 마지막 확인으로 CHECKS를 한 번 실행하세요.",
			suggestedActionLabel: guidance.inspectionPending ? null : "다시 연 파일 검사",
			progressPresentation: "reopen-final-check",
		});
	}
	if (!checks.ready) {
		return Object.freeze({
			...prompt,
			eyebrow: "MISSION 12 · REOPEN · FINAL CHECK",
			title: "다시 연 프로젝트 문제 해결",
			progressPresentation: "reopen-final-check",
		});
	}
	return Object.freeze({
		...prompt,
		eyebrow: "MISSION 12 · REOPEN · FINAL CHECK",
		title: guidance.navigatorOpen ? "다시 연 프로젝트 최종 확인" : "최종 검사 결과 검토",
		objective: guidance.navigatorOpen
			? "CHECKS에서 '0 ISSUES'와 'ALL STATIC FAB CHECKS PASSED'가 표시되는지 확인하세요."
			: "다시 연 FAB의 검사가 통과했습니다. CHECKS를 열어 저장 전과 같은 결과인지 확인하세요.",
		suggestedActionLabel: guidance.navigatorOpen ? "최종 검사 통과 확인" : "최종 결과 보기",
		progressPresentation: "reopen-final-check",
	});
}

function guidedBuildProjectSavePrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	if (evidence.projectPersistence.operation === "saving") {
		return bankPrompt(
			definition,
			"MISSION 11 · SAVE · WRITING",
			"프로젝트 저장 중",
			".openfab 파일 저장이 완료될 때까지 기다리세요.",
			null,
		);
	}
	return bankPrompt(
		definition,
		"MISSION 11 · SAVE",
		"OpenFab 프로젝트 저장",
		"현재 FAB 전체를 하나의 .openfab 파일로 저장하세요. 일부 모듈만 보관하는 청사진 저장과는 다른 전체 프로젝트 저장입니다.",
		null,
		"save-project",
		"전체 프로젝트 저장",
	);
}

function guidedBuildProjectReopenPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	if (evidence.projectPersistence.operation === "opening") {
		return bankPrompt(
			definition,
			"MISSION 12 · REOPEN · VERIFYING",
			"저장 파일 검증 중",
			"파일 내용을 확인하고 같은 FAB를 복원할 때까지 기다리세요.",
			null,
		);
	}
	const reopenedDifferentProject =
		evidence.projectPersistence.lastOpenedProjectId !== null &&
		!guidedBuildProjectReopened(evidence.projectPersistence);
	return bankPrompt(
		definition,
		"MISSION 12 · REOPEN",
		reopenedDifferentProject ? "저장한 프로젝트 다시 선택" : "저장한 프로젝트 다시 열기",
		reopenedDifferentProject
			? "다른 프로젝트가 열렸습니다. 이전 단계에서 저장한 동일 프로젝트 파일을 다시 선택하세요."
			: "방금 저장한 OpenFab 파일을 선택하세요. 같은 FAB가 복원되면 CHECKS로 마지막 검사를 진행합니다.",
		null,
		"open-project",
		"저장한 파일 열기",
	);
}

function bankPrompt(
	definition: GuidedBuildMissionDefinition,
	eyebrow: string,
	title: string,
	objective: string,
	primaryCommandId: EditorCommandId | null,
	suggestedAction: GuidedBuildSuggestedAction | null = null,
	suggestedActionLabel: string | null = null,
	organizationSelectionTargetCount?: 1 | 2,
): GuidedBuildMissionPrompt {
	return Object.freeze({
		eyebrow,
		title,
		objective,
		rationale: definition.rationale,
		primaryCommandId,
		suggestedAction,
		suggestedActionLabel,
		...(organizationSelectionTargetCount === undefined ? {} : { organizationSelectionTargetCount }),
	});
}

function connectorPrompt(
	definition: GuidedBuildMissionDefinition,
	eyebrow: string,
	title: string,
	objective: string,
	primaryCommandId: EditorCommandId | null,
): GuidedBuildMissionPrompt {
	return Object.freeze({
		...bankPrompt(definition, eyebrow, title, objective, primaryCommandId),
		presentation: "connector" as const,
	});
}

function promptFromDefinition(
	definition: GuidedBuildMissionDefinition,
	suggestedAction: GuidedBuildSuggestedAction | null,
	suggestedActionLabel: string | null,
): GuidedBuildMissionPrompt {
	return Object.freeze({
		eyebrow: definition.eyebrow,
		title: definition.title,
		objective: definition.objective,
		rationale: definition.rationale,
		primaryCommandId: definition.primaryCommandId,
		suggestedAction,
		suggestedActionLabel,
	});
}

function portEquipmentConditionMet(equipment: GuidedBuildEquipmentEvidence): boolean {
	return (
		equipmentKindComplete("OHB", equipment.OHB) &&
		equipmentKindComplete("EQ", equipment.EQ) &&
		equipmentKindComplete("STK", equipment.STK)
	);
}

function equipmentKindComplete(
	kind: GuidedBuildEquipmentKind,
	evidence: GuidedBuildEquipmentKindEvidence,
): boolean {
	return evidence.groupCount > 0 && evidence.largestGroupPortCount >= (kind === "OHB" ? 1 : 2);
}

function reusedLoopConditionMet(
	readiness: GuidedBuildReadinessEvidence,
	reuse: GuidedBuildRailReuseEvidence,
	equipment: GuidedBuildEquipmentEvidence,
): boolean {
	const summary = readiness.summary;
	return (
		reuse.repeatedComponentCopyCount >= 2 &&
		reusedEquipmentConditionMet(equipment) &&
		hasOnlyClosedComponentSeparationIssues(readiness) &&
		summary.edges > 0 &&
		summary.closure === "closed" &&
		summary.weakComponents >= 2 &&
		summary.strongComponents === summary.weakComponents &&
		summary.openTerminals === 0 &&
		summary.physicalOpenPaths === 0 &&
		summary.physicalStrongComponents === summary.weakComponents
	);
}

function reusedEquipmentConditionMet(equipment: GuidedBuildEquipmentEvidence): boolean {
	return (
		equipmentKindRepeated("OHB", equipment.OHB) &&
		equipmentKindRepeated("EQ", equipment.EQ) &&
		equipmentKindRepeated("STK", equipment.STK)
	);
}

function equipmentKindRepeated(
	kind: GuidedBuildEquipmentKind,
	evidence: GuidedBuildEquipmentKindEvidence,
): boolean {
	return evidence.groupCount >= 2 && evidence.portCount >= (kind === "OHB" ? 2 : 4);
}

function processLoopConditionMet(
	readiness: GuidedBuildReadinessEvidence,
	railReuse: GuidedBuildRailReuseEvidence,
): boolean {
	const summary = readiness.summary;
	return (
		(railReuse.closedStrongComponentCount ?? 0) > 0 ||
		(((readiness.status === "ready" && readiness.ready) ||
			hasOnlyClosedComponentSeparationIssues(readiness)) &&
			summary.edges > 0 &&
			summary.closure === "closed" &&
			summary.weakComponents >= 1 &&
			summary.strongComponents === summary.weakComponents &&
			summary.openTerminals === 0 &&
			summary.physicalOpenPaths === 0 &&
			summary.physicalStrongComponents === summary.weakComponents)
	);
}

function guidedBuildProjectSaved(evidence: GuidedBuildProjectPersistenceEvidence): boolean {
	return (
		evidence.operation === "idle" &&
		evidence.fileReferenceAvailable &&
		evidence.projectId.length > 0 &&
		evidence.currentChecksum.length > 0 &&
		!isOpenFabProjectDirty(
			evidence,
			evidence.currentChecksum,
			evidence.currentOperationalConfigurationFingerprint,
		)
	);
}

function guidedBuildProjectReopened(evidence: GuidedBuildProjectPersistenceEvidence): boolean {
	return (
		guidedBuildProjectSaved(evidence) &&
		evidence.reopenExpectationProjectId !== null &&
		evidence.reopenExpectationChecksum !== null &&
		evidence.reopenExpectationProjectId === evidence.projectId &&
		evidence.reopenExpectationChecksum === evidence.currentChecksum &&
		evidence.lastOpenedProjectId === evidence.reopenExpectationProjectId &&
		evidence.lastOpenedChecksum === evidence.reopenExpectationChecksum &&
		evidence.reopenExpectationSequence > 0 &&
		evidence.lastOpenedSequence > evidence.reopenExpectationSequence
	);
}

function hasOnlyClosedComponentSeparationIssues(readiness: GuidedBuildReadinessEvidence): boolean {
	return (
		readiness.summary.weakComponents >= 2 &&
		readiness.issues.some((issue) => issue.code === "DISCONNECTED_NETWORK") &&
		readiness.issues.every(
			(issue) =>
				issue.code === "DISCONNECTED_NETWORK" ||
				issue.code === "MULTIPLE_STRONG_COMPONENTS" ||
				issue.code === "PHYSICAL_DISCONNECTED",
		)
	);
}

function guidedBuildSourceKey(evidence: GuidedBuildEvidence): string {
	return [
		String(evidence.authoredRevision),
		evidence.navigationAcknowledged ? "oriented" : "unoriented",
		evidence.practiceGraduated ? "practice-graduated" : "practice-active",
		evidence.readiness.fingerprint,
		...(["OHB", "EQ", "STK"] as const).map(
			(kind) =>
				`${kind}:${evidence.equipment[kind].groupCount}:${evidence.equipment[kind].portCount}`,
		),
		evidence.reuseGuidance.selectionAnchorReady ? "selection-anchor" : "no-selection-anchor",
		evidence.reuseGuidance.reusableSelectionReady ? "selection" : "no-selection",
		evidence.reuseGuidance.placementActive ? "placement" : "no-placement",
		`reuse:${evidence.railReuse.weakComponentCount}:${evidence.railReuse.networkLinkSupportedComponentCount}:${evidence.railReuse.repeatedComponentKindCount}:${evidence.railReuse.repeatedComponentCopyCount}`,
		evidence.bayGuidance.placementActive ? "bay-placement" : "no-bay-placement",
		`bay:${evidence.bay.semanticBayCount}:${evidence.bay.twinProductionBayCount}:${evidence.bay.directProcessLoopCount}`,
		`bank:${evidence.bayBank.twinProductionBayCount}:${evidence.bayBank.detachedTwinBayCount}:${evidence.bayBank.alignedDetachedTwinBayPairCount}:${evidence.bayBank.semanticBayBankCount}:${evidence.bayBank.railBearingTwinBayBankCount}:${evidence.bayBank.bankedTwinBayCount}`,
		`bank-ui:${evidence.bayBankGuidance.placementActive ? "placement" : "idle"}:${evidence.bayBankGuidance.organizationBrowserOpen ? "browser" : "canvas"}:${evidence.bayBankGuidance.selectedOrganizationCount}:${evidence.bayBankGuidance.selectedTwinBayCount}:${evidence.bayBankGuidance.selectedTwinBayPairAligned ? "aligned" : "offset"}:${evidence.bayBankGuidance.arrangementPhase}:${evidence.bayBankGuidance.connectorPhase}`,
		`interbay:${evidence.interbay.semanticBayBankCount}:${evidence.interbay.detachedBayBankCount}:${evidence.interbay.semanticFabCount}:${evidence.interbay.interbayFabCount}:${evidence.interbay.fabBankCount}`,
		`interbay-ui:${evidence.interbayGuidance.placementActive ? "placement" : "idle"}:${evidence.interbayGuidance.organizationBrowserOpen ? "browser" : "canvas"}:${evidence.interbayGuidance.selectedOrganizationCount}:${evidence.interbayGuidance.selectedBayBankCount}:${evidence.interbayGuidance.selectedBayBankPairAligned ? "aligned" : "offset"}:${evidence.interbayGuidance.arrangementPhase}:${evidence.interbayGuidance.connectorPhase}`,
		`fab-loop:${evidence.fabLoop.semanticFabCount}:${evidence.fabLoop.eligibleFabCount}:${evidence.fabLoop.resilientFabLoopCount}:${evidence.fabLoop.resilientBankPairCount}`,
		`fab-loop-ui:${evidence.fabLoopGuidance.organizationBrowserOpen ? "browser" : "canvas"}:${evidence.fabLoopGuidance.selectedOrganizationCount}:${evidence.fabLoopGuidance.selectedBayBankCount}:${evidence.fabLoopGuidance.connectorPhase}`,
		`checks:${evidence.checks.available ? "available" : "unavailable"}:${evidence.checks.ready ? "ready" : "blocked"}:${evidence.checks.fingerprint}:${evidence.checks.blockingIssueCount}:${evidence.checks.followUpIssueCount}:${evidence.checks.separateRailNetworkCount}`,
		`checks-ui:${evidence.checksGuidance.navigatorOpen ? "open" : "closed"}:${evidence.checksGuidance.inspectionPending ? "pending" : "settled"}:${evidence.checksGuidance.acknowledgedFingerprint ?? "unacknowledged"}`,
		`project:${evidence.projectPersistence.operation}:${evidence.projectPersistence.projectId}:${evidence.projectPersistence.currentChecksum}:${evidence.projectPersistence.savedChecksum}:${evidence.projectPersistence.currentOperationalConfigurationFingerprint}:${evidence.projectPersistence.savedOperationalConfigurationFingerprint}:${evidence.projectPersistence.fileReferenceAvailable ? "file" : "no-file"}:${evidence.projectPersistence.migrated ? "migrated" : "current"}:${evidence.projectPersistence.needsSave ? "needs-save" : "saved"}`,
		`reopen:${evidence.projectPersistence.reopenExpectationProjectId ?? "no-expectation"}:${evidence.projectPersistence.reopenExpectationChecksum ?? "no-expected-checksum"}:${evidence.projectPersistence.reopenExpectationSequence}:${evidence.projectPersistence.lastOpenedProjectId ?? "never-opened"}:${evidence.projectPersistence.lastOpenedChecksum ?? "no-opened-checksum"}:${evidence.projectPersistence.lastOpenedSequence}`,
	].join(":");
}
