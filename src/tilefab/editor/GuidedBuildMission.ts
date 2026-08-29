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
	| "repair-networks"
	| "confirm-checks"
	| "save-project"
	| "open-project";

export interface GuidedBuildMissionPrompt {
	readonly eyebrow: string;
	readonly title: string;
	readonly objective: string;
	readonly rationale: string;
	readonly presentation?: "connector";
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
		objective: "빈 격자에서 시작점과 도착점을 이어 단방향 레일을 만드세요.",
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
		rationale: "검증된 구조를 재사용하면 반복 FAB 저작이 빨라지고 방향·규격도 일관됩니다.",
		primaryCommandId: "selection.connected",
	}),
	Object.freeze({
		id: "bay",
		sequence: 6,
		activity: "assemble",
		eyebrow: "MISSION 6 · BAY",
		title: "첫 Semantic Twin Bay",
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
		title: "첫 Semantic Bay Bank",
		objective: "Twin Bay를 복제·정렬하고 검증된 양방향 Connector로 하나의 Bank를 만드세요.",
		rationale:
			"Bay Bank는 화면상의 행이 아니라 반복 Bay와 공유 Connector를 소유하는 명시적 상위 조직입니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "interbay",
		sequence: 8,
		activity: "assemble",
		eyebrow: "MISSION 8 · INTERBAY",
		title: "두 Bank를 잇는 Interbay",
		objective: "완성된 Bay Bank를 복제·정렬하고 typed Interbay로 하나의 Fab에 연결하세요.",
		rationale:
			"Interbay는 화면상의 긴 선이 아니라 Bank gateway를 잇고 Fab가 직접 소유하는 outbound·return 순환 인프라입니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "fab-loop",
		sequence: 9,
		activity: "assemble",
		eyebrow: "MISSION 9 · FAB LOOP",
		title: "Fab 외곽 순환 완성",
		objective: "같은 Fab의 두 Bank를 다시 선택해 독립적인 두 번째 outbound·return 경로를 만드세요.",
		rationale:
			"Fab Loop는 화면상의 외곽 사각형이 아니라 Bank 사이에 양방향 edge-disjoint 경로를 보장하는 복원력 있는 순환 인프라입니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "checks",
		sequence: 10,
		activity: "inspect",
		eyebrow: "MISSION 10 · CHECKS",
		title: "정적 FAB 전체 검증",
		objective: "CHECKS를 열어 Rail, Switch, Port, Equipment, Organization 검사를 확인하세요.",
		rationale:
			"저장 전 전체 검사는 화면 모양이 아니라 현재 프로젝트 리비전과 체크섬에 묶인 Worker 검증 결과를 사용합니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "project-save",
		sequence: 11,
		activity: "inspect",
		eyebrow: "MISSION 11 · SAVE",
		title: "OpenFab 프로젝트 저장",
		objective: "현재 정적 FAB를 기존 네이티브 OpenFab 프로젝트 파일로 저장하세요.",
		rationale:
			"저장은 Canvas나 튜토리얼 상태가 아니라 canonical 프로젝트 데이터와 검토된 운영 설정을 보존합니다.",
		primaryCommandId: null,
	}),
	Object.freeze({
		id: "project-reopen",
		sequence: 12,
		activity: "inspect",
		eyebrow: "MISSION 12 · REOPEN",
		title: "저장한 프로젝트 다시 열기",
		objective: "방금 저장한 OpenFab 프로젝트 파일을 다시 열어 동일한 FAB에서 가이드를 재개하세요.",
		rationale:
			"재개는 저장 파일의 프로젝트 ID와 authored checksum을 다시 검증한 뒤 canonical 증거에서 진행률을 재구성합니다.",
		primaryCommandId: null,
	}),
] as const satisfies readonly GuidedBuildMissionDefinition[]);

export type GuidedBuildEquipmentKind = "OHB" | "EQ" | "STK";
export type GuidedBuildEquipmentToolId = "ohb" | "eq" | "stk";

export interface GuidedBuildEquipmentKindEvidence {
	readonly groupCount: number;
	readonly portCount: number;
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
	readonly networkLinkRepairAvailable: boolean;
	readonly networkLinkRepairActive: boolean;
	readonly networkLinkSourceSelected: boolean;
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
	return guidedBuildRevealsErase(evaluation);
}

export function guidedBuildHidesPracticeHandoffConstructionBar(
	evaluation: GuidedBuildEvaluation,
): boolean {
	const current = evaluation.missions.find((mission) => mission.status === "current");
	return current?.prompt.suggestedAction === "graduate-practice";
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
			(processLoopConditionMet(evidence.readiness) &&
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

function guidedBuildSuggestedActionActivity(
	action: GuidedBuildSuggestedAction | null,
): EditorActivity | null {
	if (action === null) return null;
	if (action === "build" || action === "repair-networks") return "build";
	if (action === "inspect" || action === "open-checks" || action === "confirm-checks") {
		return "inspect";
	}
	if (action === "ohb" || action === "eq" || action === "stk") return "equip";
	if (action === "save-project" || action === "open-project") return "inspect";
	return "assemble";
}

function guidedBuildMissionPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	if (definition.id === "orient") return guidedBuildOrientPrompt(definition);
	if (definition.id === "first-rail") return guidedBuildFirstRailPrompt(definition);
	if (definition.id === "process-loop") {
		return guidedBuildProcessLoopPrompt(definition, evidence.readiness);
	}
	if (definition.id === "checks") return guidedBuildChecksPrompt(definition, evidence);
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
					"연습 Loop와 보호된 Semantic Bay를 한 프로젝트에 섞지 않습니다. 저장을 선택하면 연습 파일도 남길 수 있습니다.",
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
					"−로 Twin Bay 전체가 보일 때까지 축소한 뒤, 캔버스의 빈 곳을 탭해 미리보기를 배치하세요.",
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
			suggestedActionLabel: "ASSEMBLE · 기본 TWIN BAY",
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
				primaryCommandId: "selection.connected",
				suggestedAction: evidence.reuseGuidance.selectionAnchorReady
					? "select-connected"
					: "inspect",
				suggestedActionLabel: evidence.reuseGuidance.selectionAnchorReady
					? "SELECT · 선택한 Port 포함 Loop 전체"
					: "INSPECT · Port 포함 Loop 탭",
			});
		}
		if (evidence.reuseGuidance.placementActive) {
			return Object.freeze({
				eyebrow: "MISSION 5 · REUSE LOOP · 3/3",
				title: "Port 포함 Loop 배치",
				objective:
					"공간이 부족하면 −로 축소한 뒤, 기존 Loop와 겹치지 않는 정렬된 위치에 레일과 OHB·EQ·STK 복제 미리보기를 배치하세요.",
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
				objective: "선택한 레일과 OHB·EQ·STK를 함께 복사해 반복 배치 미리보기를 시작하세요.",
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
			primaryCommandId: "selection.connected",
			suggestedAction: evidence.reuseGuidance.selectionAnchorReady ? "select-connected" : "inspect",
			suggestedActionLabel: evidence.reuseGuidance.selectionAnchorReady
				? "SELECT · Port 포함 Loop 전체"
				: "INSPECT · Port 포함 Loop 탭",
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
			suggestedActionLabel: "EQUIP · OHB 열기",
			progressCue: guidedBuildPortProgressCue(
				evidence.equipment,
				"표식이 작으면 왼쪽 아래 +로 확대하고, 레일 옆 청록 원 하나를 탭하세요. 레일 흐름이 Port와 OHB 방향을 정합니다.",
			),
		});
	}
	if (!equipmentKindComplete("EQ", evidence.equipment.EQ)) {
		return Object.freeze({
			eyebrow: "MISSION 4 · PORTS · 2/3",
			title: "EQ Port 행 배치",
			objective: "EQ 도구로 같은 직선 레일을 따라 두 개 이상의 Port를 한 그룹으로 배치하세요.",
			rationale: definition.rationale,
			primaryCommandId: "canvas.primary-drag",
			suggestedAction: "eq",
			suggestedActionLabel: "EQUIP · EQ 열기",
			progressCue: guidedBuildPortProgressCue(
				evidence.equipment,
				"표식이 작으면 +로 확대하고, 같은 직선 레일 위 청록 CENTER 표식 두 개를 한 번에 드래그하세요.",
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
			suggestedActionLabel: "EQUIP · STK 열기",
			progressCue: guidedBuildPortProgressCue(
				evidence.equipment,
				"표식이 작으면 +로 확대하고, 같은 흐름의 황금색 마름모 CENTER 표식 두 개를 차례로 탭하세요.",
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
				"터치는 한 손가락 드래그로 이동하고 왼쪽 아래 +/−로 확대·축소하세요. 마우스는 오른쪽/가운데 드래그와 휠을 사용합니다.",
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
	): number => (evidence.groupCount > 0 ? Math.min(evidence.portCount, kind === "OHB" ? 1 : 2) : 0);
	return Object.freeze({
		label: "Port-first 진행",
		value: `OHB ${completedPortCount("OHB", equipment.OHB)}/1 · EQ ${completedPortCount("EQ", equipment.EQ)}/2 · STK ${completedPortCount("STK", equipment.STK)}/2`,
		instruction,
	});
}

function guidedBuildFirstRailPrompt(
	definition: GuidedBuildMissionDefinition,
): GuidedBuildMissionPrompt {
	return Object.freeze({
		...promptFromDefinition(definition, null, null),
		progressCue: Object.freeze({
			label: "첫 실습",
			value: "연결 가능한 직선 0 / 1",
			instruction:
				"터치는 빈 곳을 누른 채, 마우스는 LMB를 누른 채 가로 또는 세로로 15칸 이상 끌고 놓으세요. 이 직선이 나중에 Loop Connect의 두 분기를 지지합니다.",
		}),
	});
}

function guidedBuildProcessLoopPrompt(
	definition: GuidedBuildMissionDefinition,
	readiness: GuidedBuildReadinessEvidence,
): GuidedBuildMissionPrompt {
	const openTerminalCount = readiness.summary.openTerminals;
	return Object.freeze({
		...promptFromDefinition(definition, null, null),
		progressCue: Object.freeze({
			label: "Loop 상태",
			value:
				openTerminalCount > 0
					? `열린 끝 ${openTerminalCount}개 · 목표 0개`
					: "열린 끝 0개 · 방향 흐름 확인",
			instruction:
				openTerminalCount > 0
					? "공간이 부족하면 −로 축소하세요. 첫 15칸 이상 직선을 유지한 채 주황색 끝에서 나머지 세 변을 이어 시작점에 닫으세요."
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
				"복제 Bay 배치",
				"원본 옆의 빈 정렬 후보로 준비된 전체 계층 미리보기를 탭하세요. 직접 옮기면 가까운 X/Z 중심축에 스냅됩니다.",
				"canvas.primary-click",
			);
		}
		if (guidance.selectedOrganizationCount === 1 && guidance.selectedTwinBayCount === 1) {
			return bankPrompt(
				definition,
				"MISSION 7 · BAY BANK · 2/8",
				"Twin Bay 전체 계층 복제",
				"ASSEMBLE의 DUPLICATE로 Shell과 두 Process Loop를 EFFECTIVE 범위 그대로 복제하세요.",
				null,
				"duplicate-bay",
				"DUPLICATE · 하위 계층 포함",
			);
		}
		return bankPrompt(
			definition,
			"MISSION 7 · BAY BANK · 1/8",
			"복제할 Twin Bay 선택",
			guidance.organizationBrowserOpen
				? "FAB ORGANIZATION 목록에서 Twin Bay 하나만 선택하세요."
				: "조직 브라우저를 열어 방금 만든 Semantic Twin Bay 하나를 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-bays",
			guidance.organizationBrowserOpen ? null : "ASSEMBLE · BAY 선택",
			1,
		);
	}

	if (guidance.selectedOrganizationCount !== 2 || guidance.selectedTwinBayCount !== 2) {
		return bankPrompt(
			definition,
			"MISSION 7 · BAY BANK · 4/8",
			"Twin Bay 두 개 선택",
			guidance.organizationBrowserOpen
				? "FAB ORGANIZATION 목록에서 원본과 복제 Twin Bay를 차례로 탭하세요."
				: "조직 브라우저에서 원본과 복제 Twin Bay 두 개를 함께 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-bays",
			guidance.organizationBrowserOpen ? null : "ASSEMBLE · 두 BAY 선택",
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
				guidance.arrangementPhase === "rejected" ? "정렬 옵션 조정" : "중심 정렬 검증·적용",
				guidance.arrangementPhase === "certified"
					? "Worker가 인증한 ALIGN CENTER 미리보기를 적용하세요."
					: guidance.arrangementPhase === "rejected"
						? "X/Z 축을 바꾸거나 충돌 없는 정렬 옵션을 선택한 뒤 적용하세요."
						: "Worker가 두 Bay의 정렬 미리보기를 검증할 때까지 기다리세요.",
				guidance.arrangementPhase === "certified" ? "command.apply" : null,
			);
		}
		return bankPrompt(
			definition,
			"MISSION 7 · BAY BANK · 5/8",
			"Bay 중심 정렬",
			"두 Bay의 선택을 유지하고 ARRANGE로 행 또는 열 중심을 맞추세요.",
			"arrangement.start",
			"arrange-bays",
			"ARRANGE · 중심 맞추기",
		);
	}
	return bankPrompt(
		definition,
		"MISSION 7 · BAY BANK · 7/8",
		"두 Production Bay 연결",
		"선택한 두 Bay를 CONNECT BAYS로 연결해 하나의 Bay Bank를 만드세요. 연결 경로는 적용 전에 검토합니다.",
		"assembly-connector.start",
		"connect-bays",
		"CONNECT BAYS · BANK 생성",
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
			phase === "pick-source-gateway" ? "Source Gateway 선택" : "Target Gateway 선택",
			phase === "pick-source-gateway"
				? "첫 Bay 외곽에서 강조된 직선 Gateway 하나를 선택하세요."
				: "다른 Bay 외곽에서 마주보는 강조 Gateway를 선택하세요.",
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
			"Connector 충돌 조정",
			"다른 Gateway 또는 Q/E corridor side를 선택해 충돌 없는 경로를 다시 검증하세요.",
			"assembly-connector.cycle-side",
		);
	}
	return connectorPrompt(
		definition,
		"MISSION 7 · BAY BANK · 8/8",
		phase === "applying" ? "Bay Bank 적용 중" : "Connector 검증 중",
		phase === "applying"
			? "원자적 Rail·Organization 패치가 Worker mirror에 반영되고 있습니다."
			: "Worker가 경로·clearance·Bank 계층을 검증할 때까지 기다리세요.",
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
				"복제 Bank 배치",
				"원본 옆의 빈 정렬 후보로 준비된 Bay·Loop 하위 계층 미리보기를 탭하세요. 직접 옮기면 가까운 X/Z 중심축에 스냅됩니다.",
				"canvas.primary-click",
			);
		}
		if (guidance.selectedOrganizationCount === 1 && guidance.selectedBayBankCount === 1) {
			return bankPrompt(
				definition,
				"MISSION 8 · INTERBAY · 2/8",
				"Bay Bank 전체 계층 복제",
				"DUPLICATE로 Bank의 Connector, Bay, Process Loop를 EFFECTIVE 범위 그대로 복제하세요.",
				null,
				"duplicate-bank",
				"DUPLICATE · BANK 하위 계층 포함",
			);
		}
		return bankPrompt(
			definition,
			"MISSION 8 · INTERBAY · 1/8",
			"복제할 Bay Bank 선택",
			guidance.organizationBrowserOpen
				? "FAB ORGANIZATION 목록에서 방금 완성한 Bay Bank 하나만 선택하세요."
				: "조직 브라우저를 열어 방금 완성한 Bay Bank 하나를 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-banks",
			guidance.organizationBrowserOpen ? null : "ASSEMBLE · BANK 선택",
			1,
		);
	}

	if (guidance.selectedOrganizationCount !== 2 || guidance.selectedBayBankCount !== 2) {
		return bankPrompt(
			definition,
			"MISSION 8 · INTERBAY · 4/8",
			"Bay Bank 두 개 선택",
			guidance.organizationBrowserOpen
				? "FAB ORGANIZATION 목록에서 원본과 복제 Bay Bank를 차례로 탭하세요."
				: "조직 브라우저에서 원본과 복제 Bay Bank 두 개를 함께 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-banks",
			guidance.organizationBrowserOpen ? null : "ASSEMBLE · 두 BANK 선택",
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
					? "Bank 정렬 옵션 조정"
					: "Bank 중심 정렬 검증·적용",
				guidance.arrangementPhase === "certified"
					? "Worker가 인증한 ALIGN CENTER 미리보기를 적용하세요."
					: guidance.arrangementPhase === "rejected"
						? "X/Z 축을 바꾸거나 충돌 없는 정렬 옵션을 선택한 뒤 적용하세요."
						: "Worker가 두 Bank의 정렬 미리보기를 검증할 때까지 기다리세요.",
				guidance.arrangementPhase === "certified" ? "command.apply" : null,
			);
		}
		return bankPrompt(
			definition,
			"MISSION 8 · INTERBAY · 5/8",
			"Bay Bank 중심 정렬",
			"두 Bank의 선택을 유지하고 ARRANGE로 Interbay가 지나갈 행 또는 열 중심을 맞추세요.",
			"arrangement.start",
			"arrange-banks",
			"ARRANGE · BANK 중심 맞추기",
		);
	}
	return bankPrompt(
		definition,
		"MISSION 8 · INTERBAY · 7/8",
		"두 Bay Bank 연결",
		"선택한 두 Bay Bank를 CONNECT BANKS로 연결해 하나의 Fab을 만드세요. 연결 경로는 적용 전에 검토합니다.",
		"assembly-connector.start",
		"connect-banks",
		"CONNECT BANKS · FAB 생성",
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
			phase === "pick-source-gateway" ? "Source Bank Gateway 선택" : "Target Bank Gateway 선택",
			phase === "pick-source-gateway"
				? "첫 Bank의 직접 소유 Connector에서 강조된 Gateway 하나를 선택하세요."
				: "다른 Bank에서 마주보는 강조 Gateway를 선택하세요.",
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
			"Interbay corridor 조정",
			"다른 Bank Gateway 또는 Q/E corridor side를 선택해 충돌 없는 경로를 다시 검증하세요.",
			"assembly-connector.cycle-side",
		);
	}
	return connectorPrompt(
		definition,
		"MISSION 8 · INTERBAY · 8/8",
		phase === "applying" ? "Fab Interbay 적용 중" : "Interbay 검증 중",
		phase === "applying"
			? "원자적 Rail·Organization 패치가 Worker mirror에 반영되고 있습니다."
			: "Worker가 경로·clearance·Fab 계층을 검증할 때까지 기다리세요.",
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
			"같은 Fab의 두 Bank 선택",
			guidance.organizationBrowserOpen
				? "FAB ORGANIZATION 목록에서 방금 Interbay로 연결한 두 Bay Bank를 차례로 탭하세요."
				: "조직 브라우저를 열어 같은 Fab의 두 Bay Bank를 함께 선택하세요.",
			"organization.select",
			guidance.organizationBrowserOpen ? null : "browse-banks",
			guidance.organizationBrowserOpen ? null : "ASSEMBLE · 두 BANK 선택",
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
		"같은 Fab의 두 Bank를 ADD FAB LOOP로 다시 연결해 기존 Interbay와 겹치지 않는 두 번째 순환 경로를 만드세요.",
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
			phase === "pick-source-gateway" ? "Source 외곽 Gateway 선택" : "Target 외곽 Gateway 선택",
			phase === "pick-source-gateway"
				? "첫 Bank 하위 Bay 레일에서 기존 Interbay와 떨어진 강조 Gateway를 선택하세요."
				: "다른 Bank 하위 Bay 레일에서 마주보는 강조 Gateway를 선택하세요.",
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
			"외곽 corridor 조정",
			"다른 하위 Bay Gateway 또는 Q/E corridor side를 선택해 독립 경로를 다시 검증하세요.",
			"assembly-connector.cycle-side",
		);
	}
	return connectorPrompt(
		definition,
		"MISSION 9 · FAB LOOP · 3/3",
		phase === "applying" ? "Fab Loop 적용 중" : "Fab Loop 검증 중",
		phase === "applying"
			? "원자적 Rail·Organization 패치가 Worker mirror에 반영되고 있습니다."
			: "Worker가 경로·clearance와 양방향 복원력을 검증할 때까지 기다리세요.",
		null,
	);
}

function guidedBuildChecksPrompt(
	definition: GuidedBuildMissionDefinition,
	evidence: GuidedBuildEvidence,
): GuidedBuildMissionPrompt {
	const checks = evidence.checks;
	const guidance = evidence.checksGuidance;
	if (
		checks.separateRailNetworkCount > 1 &&
		guidance.networkLinkRepairAvailable &&
		(checks.available || guidance.networkLinkRepairActive)
	) {
		const remaining = checks.separateRailNetworkCount;
		if (guidance.networkLinkRepairActive) {
			return bankPrompt(
				definition,
				"MISSION 10 · CHECKS · FIX",
				guidance.networkLinkSourceSelected
					? "연결할 다른 레일망 선택"
					: `${remaining}개 레일망 연결`,
				guidance.networkLinkSourceSelected
					? "다른 레일망의 평행한 긴 직선까지 드래그해 왕복 연결 미리보기를 만든 뒤 놓으세요."
					: "한 레일망의 긴 직선에서 다른 레일망의 평행한 긴 직선까지 드래그하세요. 두 방향 연결을 한 번에 검토·적용합니다.",
				"canvas.primary-drag",
			);
		}
		return bankPrompt(
			definition,
			"MISSION 10 · CHECKS · FIX",
			`${remaining}개 레일망 연결`,
			"보호되지 않은 독립 레일망입니다. 기존 Smart Route의 Loop Connect로 한 망씩 연결한 뒤 CHECKS를 다시 실행하세요.",
			null,
			"repair-networks",
			"BUILD · 레일망 연결",
		);
	}
	if (!checks.available) {
		if (guidance.inspectionPending) {
			return bankPrompt(
				definition,
				"MISSION 10 · CHECKS · 2/3",
				"전체 프로젝트 검사 중",
				"Worker가 현재 리비전의 Rail·Switch·Port·Equipment·Organization 진단을 완료할 때까지 기다리세요.",
				null,
			);
		}
		return bankPrompt(
			definition,
			"MISSION 10 · CHECKS · 1/3",
			"CHECKS 열기",
			"상단 FAB CHECK 버튼이나 아래 동작으로 현재 프로젝트의 전체 검사를 시작하세요.",
			null,
			"open-checks",
			"INSPECT · CHECKS 열기",
		);
	}
	if (!checks.ready) {
		const protectedNetworkGuidance =
			checks.separateRailNetworkCount > 1 && !guidance.networkLinkRepairAvailable
				? " 보호된 Bay·Bank·Fab 레일은 Smart Route로 직접 바꾸지 말고 ASSEMBLE의 계층 Connector 또는 명시적 메타데이터 재할당으로 해결하세요."
				: "";
		return bankPrompt(
			definition,
			"MISSION 10 · CHECKS · FIX",
			"차단 이슈 해결",
			`${checks.blockingIssueCount}개 차단 이슈와 ${checks.followUpIssueCount}개 후속 이슈를 CHECKS에서 확인하고 일반 편집 명령으로 해결하세요.${protectedNetworkGuidance}`,
			null,
			guidance.navigatorOpen ? null : "open-checks",
			guidance.navigatorOpen ? null : "INSPECT · CHECKS 다시 열기",
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
			"INSPECT · 통과 결과 보기",
		);
	}
	return bankPrompt(
		definition,
		"MISSION 10 · CHECKS · 3/3",
		"현재 검증 결과 확인",
		"Rail·Switch·Port·Equipment·Organization이 모두 현재 프로젝트 fingerprint에서 통과했는지 확인하세요.",
		null,
		"confirm-checks",
		"CHECKS · 검증 결과 확인",
	);
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
			"Worker 직렬화와 네이티브 파일 쓰기가 완료될 때까지 기다리세요.",
			null,
		);
	}
	return bankPrompt(
		definition,
		"MISSION 11 · SAVE",
		"OpenFab 프로젝트 저장",
		"기존 프로젝트 저장 명령으로 현재 canonical FAB와 운영 설정을 하나의 OpenFab 파일에 기록하세요.",
		null,
		"save-project",
		"PROJECT · 저장",
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
			"Worker가 파일을 검증하고 동일한 프로젝트 ID와 authored checksum을 승격할 때까지 기다리세요.",
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
			: "기존 프로젝트 열기 명령으로 방금 저장한 OpenFab 파일을 선택하세요.",
		null,
		"open-project",
		"PROJECT · 열기",
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
	return evidence.groupCount > 0 && evidence.portCount >= (kind === "OHB" ? 1 : 2);
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

function processLoopConditionMet(readiness: GuidedBuildReadinessEvidence): boolean {
	const summary = readiness.summary;
	return (
		((readiness.status === "ready" && readiness.ready) ||
			hasOnlyClosedComponentSeparationIssues(readiness)) &&
		summary.edges > 0 &&
		summary.closure === "closed" &&
		summary.weakComponents >= 1 &&
		summary.strongComponents === summary.weakComponents &&
		summary.openTerminals === 0 &&
		summary.physicalOpenPaths === 0 &&
		summary.physicalStrongComponents === summary.weakComponents
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
		`checks-ui:${evidence.checksGuidance.navigatorOpen ? "open" : "closed"}:${evidence.checksGuidance.inspectionPending ? "pending" : "settled"}:${evidence.checksGuidance.acknowledgedFingerprint ?? "unacknowledged"}:${evidence.checksGuidance.networkLinkRepairAvailable ? "network-repair-available" : "network-repair-protected"}:${evidence.checksGuidance.networkLinkRepairActive ? "network-repair" : "no-network-repair"}:${evidence.checksGuidance.networkLinkSourceSelected ? "source" : "no-source"}`,
		`project:${evidence.projectPersistence.operation}:${evidence.projectPersistence.projectId}:${evidence.projectPersistence.currentChecksum}:${evidence.projectPersistence.savedChecksum}:${evidence.projectPersistence.currentOperationalConfigurationFingerprint}:${evidence.projectPersistence.savedOperationalConfigurationFingerprint}:${evidence.projectPersistence.fileReferenceAvailable ? "file" : "no-file"}:${evidence.projectPersistence.migrated ? "migrated" : "current"}:${evidence.projectPersistence.needsSave ? "needs-save" : "saved"}`,
		`reopen:${evidence.projectPersistence.reopenExpectationProjectId ?? "no-expectation"}:${evidence.projectPersistence.reopenExpectationChecksum ?? "no-expected-checksum"}:${evidence.projectPersistence.reopenExpectationSequence}:${evidence.projectPersistence.lastOpenedProjectId ?? "never-opened"}:${evidence.projectPersistence.lastOpenedChecksum ?? "no-opened-checksum"}:${evidence.projectPersistence.lastOpenedSequence}`,
	].join(":");
}
