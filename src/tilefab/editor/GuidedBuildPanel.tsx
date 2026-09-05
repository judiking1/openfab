import {
	Check,
	ChevronLeft,
	ChevronRight,
	CircleHelp,
	GraduationCap,
	Minus,
	X,
} from "lucide-react";
import { type KeyboardEvent, type RefObject, useId, useRef, useState } from "react";
import { editorCommand, editorCommandHintBinding } from "./EditorCommandRegistry";
import {
	deriveGuidedBuildChapters,
	GUIDED_BUILD_CHAPTERS,
	type GuidedBuildChapterId,
	guidedBuildCurrentChapter,
} from "./GuidedBuildChapter";
import { GuidedBuildChapterCheckpoint } from "./GuidedBuildChapterCheckpoint";
import { guidedBuildInputHint } from "./GuidedBuildInputHint";
import type { GuidedBuildEvaluation, GuidedBuildSuggestedAction } from "./GuidedBuildMission";
import {
	type GuidedPortKeyboardPhase,
	type GuidedPortKeyboardType,
	guidedPortKeyboardOperationInstruction,
} from "./GuidedPortKeyboardSession";
import {
	type GuidedRailKeyboardMission,
	type GuidedRailKeyboardPhase,
	guidedRailKeyboardOperationInstruction,
} from "./GuidedRailKeyboardSession";

export interface GuidedBuildKeyboardRailState {
	readonly mission: GuidedRailKeyboardMission;
	readonly phase: GuidedRailKeyboardPhase;
}

export interface GuidedBuildKeyboardPortState {
	readonly scope?: "guided" | "ordinary";
	readonly portType: GuidedPortKeyboardType;
	readonly phase: GuidedPortKeyboardPhase;
	readonly currentRowSelected?: boolean;
	readonly currentRowLegal?: boolean;
}

export interface GuidedBuildPanelProps {
	readonly evaluation: GuidedBuildEvaluation;
	readonly practiceGraduated?: boolean;
	readonly currentEquipmentGroupCount?: number;
	readonly currentPortCount?: number;
	readonly suggestedActionActive?: boolean;
	readonly suggestedActionGuidedActionId?: string;
	readonly suggestedActionGuidedTarget?: boolean;
	readonly suggestedActionDescriptionId?: string;
	readonly completionActionGuidedActionId?: string;
	readonly completionActionGuidedTarget?: boolean;
	readonly completionActionDescriptionId?: string;
	readonly primaryTargetInstruction?: string | null;
	readonly primaryTargetManaged?: boolean;
	readonly primaryTargetActionable?: boolean;
	readonly chapterCheckpointId?: GuidedBuildChapterId | null;
	readonly keyboardRail?: GuidedBuildKeyboardRailState | null;
	readonly keyboardPort?: GuidedBuildKeyboardPortState | null;
	readonly exclusiveCommandActive?: boolean;
	readonly keyboardRailEntryRef?: RefObject<HTMLButtonElement | null>;
	readonly onAcknowledgeNavigation: () => void;
	readonly onActivateSuggestedAction: (action: GuidedBuildSuggestedAction) => void;
	readonly onContinueChapter: () => void;
	readonly onStartEditing: () => void;
	readonly onStartKeyboardRail?: (mission: GuidedRailKeyboardMission) => void;
	readonly onApplyKeyboardRail?: () => void;
	readonly onCancelKeyboardRail?: () => void;
	readonly onCancelKeyboardPort?: (resumeKeyboard: boolean) => void;
	readonly onReviewingChange?: (reviewing: boolean) => void;
	readonly onMinimize: () => void;
	readonly onExit: () => void;
}

export function GuidedBuildPanel({
	evaluation,
	practiceGraduated = false,
	currentEquipmentGroupCount = 0,
	currentPortCount = 0,
	suggestedActionActive = false,
	suggestedActionGuidedActionId,
	suggestedActionGuidedTarget = false,
	suggestedActionDescriptionId,
	completionActionGuidedActionId,
	completionActionGuidedTarget = false,
	completionActionDescriptionId,
	primaryTargetInstruction = null,
	primaryTargetManaged = false,
	primaryTargetActionable = true,
	chapterCheckpointId = null,
	keyboardRail = null,
	keyboardPort = null,
	exclusiveCommandActive = false,
	keyboardRailEntryRef,
	onAcknowledgeNavigation,
	onActivateSuggestedAction,
	onContinueChapter,
	onStartEditing,
	onStartKeyboardRail,
	onApplyKeyboardRail,
	onCancelKeyboardRail,
	onCancelKeyboardPort,
	onReviewingChange,
	onMinimize,
	onExit,
}: GuidedBuildPanelProps): React.ReactElement {
	const chapterSummary = deriveGuidedBuildChapters(evaluation);
	const currentChapter = guidedBuildCurrentChapter(chapterSummary);
	const chapterCheckpoint =
		chapterCheckpointId === null
			? null
			: (chapterSummary.chapters.find((chapter) => chapter.definition.id === chapterCheckpointId) ??
				null);
	const nextChapter = chapterCheckpoint
		? (GUIDED_BUILD_CHAPTERS.find(
				(chapter) => chapter.sequence === chapterCheckpoint.definition.sequence + 1,
			) ?? null)
		: null;
	const missionHelpId = useId();
	const missionHelpButtonRef = useRef<HTMLButtonElement>(null);
	const [helpState, setHelpState] = useState<{
		readonly currentMissionId: GuidedBuildEvaluation["currentMissionId"];
		readonly missionId: NonNullable<GuidedBuildEvaluation["currentMissionId"]>;
	} | null>(null);
	const [reviewState, setReviewState] = useState<{
		readonly currentMissionId: GuidedBuildEvaluation["currentMissionId"];
		readonly sequence: number;
	} | null>(null);
	const current = evaluation.missions.find((mission) => mission.status === "current") ?? null;
	const missionCount = evaluation.missions.length;
	const currentSequence = evaluation.complete ? missionCount : (current?.definition.sequence ?? 1);
	const reviewSequence =
		reviewState?.currentMissionId === evaluation.currentMissionId ? reviewState.sequence : null;
	const displayedSequence = reviewSequence ?? currentSequence;
	const displayed =
		evaluation.missions.find((mission) => mission.definition.sequence === displayedSequence) ??
		current;
	const reviewing =
		!evaluation.complete && reviewSequence !== null && displayedSequence !== currentSequence;
	const definition = displayed?.definition ?? null;
	const prompt = displayed?.prompt ?? null;
	const reopenFinalCheck = !reviewing && prompt?.progressPresentation === "reopen-final-check";
	const presentedCurrentSequence = reopenFinalCheck ? missionCount : currentSequence;
	const suggestedAction = prompt?.suggestedAction ?? null;
	const showSuggestedAction =
		!reviewing &&
		suggestedAction !== null &&
		prompt?.suggestedActionLabel !== null &&
		!primaryTargetManaged &&
		!suggestedActionActive;
	const progressCue = reviewing ? null : (prompt?.progressCue ?? null);
	const progressInstruction =
		primaryTargetInstruction ??
		(progressCue && suggestedActionActive
			? activeSuggestedActionInstruction(suggestedAction, progressCue.instruction)
			: progressCue?.instruction);
	const command = prompt?.primaryCommandId ? editorCommand(prompt.primaryCommandId) : null;
	const commandLabel =
		command && prompt?.organizationSelectionTargetCount !== undefined
			? "FAB ORGANIZATION 목록 선택"
			: command?.label;
	const hint = prompt?.primaryCommandId
		? guidedBuildInputHint(
				prompt.primaryCommandId,
				editorCommandHintBinding(prompt.primaryCommandId),
			)
		: null;
	const currentTitle = evaluation.complete
		? "완료"
		: chapterCheckpoint
			? `${chapterCheckpoint.definition.title} 완료`
			: (current?.prompt.title ?? current?.definition.title ?? "현재 미션");
	const displayedTitle = evaluation.complete
		? "완료"
		: (prompt?.title ?? definition?.title ?? "현재 미션");
	const missionDetail =
		definition && prompt ? guidedBuildMissionDetail(definition.eyebrow, prompt.eyebrow) : null;
	const showRationale =
		missionDetail === null ||
		/(?:^|·\s)(?:작업\s)?1\/\d+$/.test(missionDetail) ||
		missionDetail === "HANDOFF";
	const missionHelpOpen =
		definition !== null &&
		helpState?.currentMissionId === evaluation.currentMissionId &&
		helpState.missionId === definition.id;
	const presentedChapter = chapterCheckpoint ?? currentChapter;
	const presentedChapterStep = chapterCheckpoint
		? chapterCheckpoint.missionCount
		: reopenFinalCheck && currentChapter
			? currentChapter.missionCount
			: currentChapter
				? guidedBuildChapterStep(currentChapter, evaluation)
				: (GUIDED_BUILD_CHAPTERS.at(-1)?.missionIds.length ?? 1);
	const presentedChapterState = chapterCheckpoint || evaluation.complete ? "미션 완료" : "미션";
	const presentedOverallState = chapterCheckpoint
		? `다음 전체 미션 ${presentedCurrentSequence}/${missionCount}`
		: evaluation.complete
			? `전체 미션 ${missionCount}/${missionCount}`
			: reopenFinalCheck
				? `전체 미션 ${missionCount}/${missionCount} · 최종 확인`
				: `전체 미션 ${currentSequence}/${missionCount}`;
	const panelActionOwnsNextStep = showSuggestedAction && suggestedActionGuidedTarget;
	const reviewActionOwnsNextStep =
		!reviewing &&
		exclusiveCommandActive &&
		(prompt?.primaryCommandId === "command.apply" || prompt?.primaryCommandId === "command.cancel");
	const presentation =
		prompt?.organizationSelectionTargetCount === 1 || prompt?.organizationSelectionTargetCount === 2
			? "picker"
			: (prompt?.presentation ?? "default");
	const displayedKeyboardRailMission =
		!reviewing && (definition?.id === "first-rail" || definition?.id === "process-loop")
			? definition.id
			: null;
	const keyboardRailActive =
		displayedKeyboardRailMission !== null && keyboardRail?.mission === displayedKeyboardRailMission;
	const keyboardRailOperation =
		keyboardRailActive && keyboardRail
			? guidedRailKeyboardOperationInstruction(keyboardRail.phase)
			: null;
	const keyboardPortActive =
		!reviewing &&
		definition?.id === "ports" &&
		keyboardPort !== null &&
		suggestedAction?.toUpperCase() === keyboardPort.portType;
	const keyboardPortOperation = keyboardPortActive
		? guidedPortKeyboardOperationInstruction(keyboardPort.portType, keyboardPort.phase)
		: null;
	const keyboardOperation = keyboardRailOperation ?? keyboardPortOperation;

	const reviewMission = (sequence: number): void => {
		if (keyboardRailActive || keyboardPortActive || exclusiveCommandActive) return;
		const bounded = Math.max(1, Math.min(currentSequence, sequence));
		const nextReviewing = bounded !== currentSequence;
		setHelpState(null);
		setReviewState(
			nextReviewing ? { currentMissionId: evaluation.currentMissionId, sequence: bounded } : null,
		);
		onReviewingChange?.(nextReviewing);
	};

	return (
		<aside
			className="tilefab-guided-build-panel"
			data-testid="guided-build-panel"
			data-current-mission={evaluation.currentMissionId ?? "complete"}
			data-current-chapter={currentChapter?.definition.id ?? "complete"}
			data-chapter-checkpoint={chapterCheckpoint?.definition.id ?? ""}
			data-presentation={presentation}
			aria-labelledby="guided-build-title"
			onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
				if (event.key !== "Escape") return;
				if (missionHelpOpen) {
					event.preventDefault();
					event.stopPropagation();
					setHelpState(null);
					missionHelpButtonRef.current?.focus();
					return;
				}
				if (exclusiveCommandActive) return;
				event.preventDefault();
				event.stopPropagation();
				if (evaluation.complete) {
					onExit();
					return;
				}
				if (reviewing) {
					setReviewState(null);
					onReviewingChange?.(false);
					return;
				}
				if (keyboardRailActive && onCancelKeyboardRail) {
					onCancelKeyboardRail();
					return;
				}
				if (keyboardPortActive && onCancelKeyboardPort) {
					onCancelKeyboardPort(true);
					return;
				}
				onMinimize();
			}}
		>
			<header>
				<span>
					<GraduationCap size={17} />
				</span>
				<div>
					<small>
						GUIDED BUILD
						{presentedChapter
							? ` · 챕터 ${presentedChapter.definition.sequence}/${GUIDED_BUILD_CHAPTERS.length} · ${presentedChapter.definition.label}`
							: ""}
					</small>
					<strong id="guided-build-title">
						{evaluation.complete
							? "첫 정적 FAB 작업 흐름 완료"
							: chapterCheckpoint
								? `${chapterCheckpoint.definition.title} 완료`
								: reviewing
									? `검토 · ${displayedTitle}`
									: displayedTitle}
					</strong>
				</div>
				<div className="tilefab-guided-build-window-actions">
					{!evaluation.complete ? (
						<button
							type="button"
							aria-label="Guided Build 최소화"
							onClick={() => {
								if (keyboardRailActive) onCancelKeyboardRail?.();
								if (keyboardPortActive) onCancelKeyboardPort?.(false);
								onMinimize();
							}}
						>
							<Minus size={14} /> <span>접기</span>
						</button>
					) : null}
					<button
						type="button"
						aria-label="Guided Build 종료"
						onClick={() => {
							if (keyboardRailActive) onCancelKeyboardRail?.();
							if (keyboardPortActive) onCancelKeyboardPort?.(false);
							onExit();
						}}
					>
						<X size={14} /> <span>종료</span>
					</button>
				</div>
			</header>
			<div className="tilefab-guided-build-progress">
				<span className="tilefab-sr-only" role="status" aria-live="polite" aria-atomic="true">
					{`전체 미션 ${presentedCurrentSequence}/${missionCount} · ${currentTitle}`}
				</span>
				<span aria-hidden="true">
					<strong>{presentedChapter?.definition.label ?? "ADVANCED FAB"}</strong> ·{" "}
					{presentedChapterState} {presentedChapterStep}/{presentedChapter?.missionCount ?? 7} ·{" "}
					{presentedOverallState}
				</span>
				<progress
					aria-label="Guided Build 전체 미션 진행률"
					aria-valuetext={`전체 미션 ${presentedCurrentSequence}/${missionCount} · ${currentTitle}`}
					value={presentedCurrentSequence}
					max={missionCount}
				/>
			</div>
			{chapterCheckpoint && nextChapter ? (
				<GuidedBuildChapterCheckpoint
					completedChapter={chapterCheckpoint.definition}
					nextChapter={nextChapter}
					onContinue={onContinueChapter}
					onStartEditing={onStartEditing}
				/>
			) : evaluation.complete ? (
				<div className="tilefab-guided-build-complete">
					<Check size={20} />
					<p>
						<strong>저장한 파일에서 같은 FAB를 다시 열었습니다.</strong>
						<small>
							현재 FAB의 레일·포트·장비·조직과 프로젝트 설정이 모두 복원됐습니다. 아래 버튼을 누르면
							이 안내와 CHECKS 결과를 닫고 일반 Inspect 편집으로 돌아갑니다.
						</small>
					</p>
					{practiceGraduated ? (
						<p
							className="tilefab-guided-build-project-scope"
							data-testid="guided-build-project-scope"
						>
							<strong>
								현재 FAB · 장비 {currentEquipmentGroupCount} · Port {currentPortCount}
							</strong>
							<small>
								초반 연습 장비와 Port는 이 FAB로 복사되지 않았습니다. 저장했다면 별도 연습 파일에만
								있습니다.
							</small>
						</p>
					) : null}
					<button
						type="button"
						data-testid="guided-build-completion-action"
						data-guided-action-id={completionActionGuidedActionId}
						data-guided-target={completionActionGuidedTarget || undefined}
						aria-describedby={
							completionActionGuidedTarget ? completionActionDescriptionId : undefined
						}
						onClick={onExit}
					>
						가이드 종료 · 편집 계속
					</button>
				</div>
			) : definition && prompt ? (
				<div className="tilefab-guided-build-mission">
					{missionDetail ? (
						<small data-testid="guided-build-mission-detail">{missionDetail}</small>
					) : null}
					<p>{prompt.objective}</p>
					{practiceGraduated && definition.id === "bay" ? (
						<p
							className="tilefab-guided-build-project-scope"
							data-testid="guided-build-project-scope"
						>
							<strong>
								새 FAB · 장비 {currentEquipmentGroupCount} · Port {currentPortCount}
							</strong>
							<small>
								연습 장비와 Port는 복사되지 않았으며, 저장했다면 별도 연습 파일에 있습니다.
							</small>
						</p>
					) : null}
					{progressCue ? (
						<div
							className="tilefab-guided-build-progress-cue"
							data-testid="guided-build-progress-cue"
						>
							<span>
								<small>{progressCue.label}</small>
								<strong>{progressCue.value}</strong>
							</span>
							<p>{progressInstruction}</p>
						</div>
					) : primaryTargetManaged && progressInstruction ? (
						<div
							className="tilefab-guided-build-progress-cue tilefab-guided-build-primary-instruction"
							data-testid="guided-build-primary-instruction"
						>
							<span>
								<small>NEXT</small>
								<strong>실제 편집 대상</strong>
							</span>
							<p>{progressInstruction}</p>
						</div>
					) : showRationale ? (
						<em>{prompt.rationale}</em>
					) : null}
					{keyboardRailActive && keyboardRail ? (
						<div
							className="tilefab-guided-build-hint tilefab-guided-build-keyboard-rail-hint"
							data-testid="guided-build-keyboard-rail-hint"
							aria-live="off"
						>
							<span>KEYBOARD RAIL</span>
							<strong>
								{keyboardRail.phase === "choose-start"
									? "방향키로 시작점 이동 · ENTER 선택"
									: "방향키 1 m · SHIFT+방향키 5 m · ENTER 확정"}
							</strong>
						</div>
					) : keyboardPortActive && keyboardPort ? (
						<div
							className="tilefab-guided-build-hint tilefab-guided-build-keyboard-port-hint"
							data-testid="guided-build-keyboard-port-hint"
							aria-live="off"
						>
							<span>KEYBOARD {keyboardPort.portType}</span>
							<strong>
								{keyboardPort.portType === "EQ" && keyboardPort.phase === "choose-end"
									? "방향키 / WASD · ENTER 행 확정"
									: "방향키 / WASD · ENTER 선택"}
							</strong>
						</div>
					) : command && hint && !panelActionOwnsNextStep && !reviewActionOwnsNextStep ? (
						<div className="tilefab-guided-build-hint">
							<span>{commandLabel}</span>
							<strong>{hint.inputs.join(hint.inputJoin === "or" ? " 또는 " : " + ")}</strong>
						</div>
					) : null}
					{missionHelpOpen ? (
						<section
							id={missionHelpId}
							className="tilefab-guided-build-mission-help"
							data-testid="guided-build-mission-help"
							aria-label={`${displayedTitle} 단계 도움말`}
						>
							<small>현재 단계만</small>
							<ol>
								<li>
									<strong>목표</strong>
									<span>{prompt.objective}</span>
								</li>
								<li>
									<strong>조작</strong>
									<span>
										{reviewing ? (
											"완료한 단계의 설명을 검토하고 현재 단계로 돌아가세요."
										) : showSuggestedAction && keyboardOperation === null ? (
											<>{prompt.suggestedActionLabel} → </>
										) : null}
										{!reviewing && keyboardOperation ? (
											keyboardOperation
										) : !reviewing && command && hint ? (
											<>
												{commandLabel} <kbd>{hint.inputs.join(" / ")}</kbd>
											</>
										) : reviewing ? null : (
											"화면의 강조된 작업을 완료하세요."
										)}
									</span>
								</li>
								<li>
									<strong>이유</strong>
									<span>{prompt.rationale}</span>
								</li>
								<li>
									<strong>다음 단계</strong>
									<span>
										{reviewing
											? `현재 진행 단계는 ${presentedCurrentSequence} / ${missionCount}입니다.`
											: "프로젝트 증거가 충족되면 다음 단계가 자동으로 열립니다."}
									</span>
								</li>
							</ol>
						</section>
					) : null}
					<div className="tilefab-guided-build-actions">
						{displayedKeyboardRailMission && onStartKeyboardRail ? (
							keyboardRailActive && keyboardRail ? (
								<>
									<button
										type="button"
										className="primary"
										data-testid="guided-build-keyboard-rail-apply"
										disabled={!primaryTargetActionable}
										onClick={onApplyKeyboardRail}
									>
										{keyboardRail.phase === "choose-start"
											? "시작점 선택 · Enter"
											: "구간 확정 · Enter"}
									</button>
									<button
										type="button"
										data-testid="guided-build-keyboard-rail-cancel"
										onClick={() => {
											onCancelKeyboardRail?.();
											keyboardRailEntryRef?.current?.focus();
										}}
									>
										구간 취소 · Esc
									</button>
								</>
							) : (
								<button
									ref={keyboardRailEntryRef}
									type="button"
									className="primary tilefab-guided-build-keyboard-rail-entry"
									data-testid="guided-build-keyboard-rail-entry"
									disabled={!primaryTargetActionable}
									onClick={() => onStartKeyboardRail(displayedKeyboardRailMission)}
								>
									키보드로 레일 만들기
								</button>
							)
						) : null}
						{showSuggestedAction && suggestedAction ? (
							<button
								type="button"
								className="primary"
								data-testid="guided-build-suggested-action"
								data-guided-action-id={suggestedActionGuidedActionId}
								data-guided-target={suggestedActionGuidedTarget || undefined}
								aria-describedby={
									suggestedActionGuidedTarget ? suggestedActionDescriptionId : undefined
								}
								onClick={() => onActivateSuggestedAction(suggestedAction)}
							>
								{prompt.suggestedActionLabel}
							</button>
						) : null}
						{definition.id === "orient" ? (
							<button type="button" className="primary" onClick={onAcknowledgeNavigation}>
								이동을 익혔어요
							</button>
						) : null}
						<button
							ref={missionHelpButtonRef}
							type="button"
							data-testid="guided-build-command-help"
							aria-expanded={missionHelpOpen}
							aria-controls={missionHelpId}
							onClick={() =>
								setHelpState(
									missionHelpOpen
										? null
										: {
												currentMissionId: evaluation.currentMissionId,
												missionId: definition.id,
											},
								)
							}
						>
							<CircleHelp size={14} /> {missionHelpOpen ? "단계 도움말 닫기" : "이 단계 도움말"}
						</button>
					</div>
					<nav className="tilefab-guided-build-navigation" aria-label="Guided Build 미션 이동">
						<button
							type="button"
							disabled={
								displayedSequence <= 1 ||
								keyboardRailActive ||
								keyboardPortActive ||
								exclusiveCommandActive
							}
							title={
								keyboardRailActive
									? "키보드 레일을 확정하거나 취소한 뒤 단계 이동"
									: keyboardPortActive
										? "키보드 Port 배치를 확정하거나 Esc로 취소한 뒤 단계 이동"
										: exclusiveCommandActive
											? "현재 검토를 적용하거나 취소한 뒤 단계 이동"
											: undefined
							}
							onClick={() => reviewMission(displayedSequence - 1)}
						>
							<ChevronLeft size={13} /> 이전
						</button>
						<span>{reviewing ? `완료 미션 ${displayedSequence}` : "현재 미션 진행 중"}</span>
						{reviewing ? (
							<button
								type="button"
								title={
									displayedSequence + 1 === currentSequence
										? "현재 단계로 돌아가기"
										: "다음 완료 단계 검토"
								}
								onClick={() => reviewMission(displayedSequence + 1)}
							>
								{displayedSequence + 1 === currentSequence ? "현재" : "다음"}
								<ChevronRight size={13} />
							</button>
						) : (
							<span className="tilefab-guided-build-auto-advance">
								{panelActionOwnsNextStep
									? "강조된 작업을 완료해 계속"
									: reviewActionOwnsNextStep
										? "강조된 검토 작업을 완료해 계속"
										: "조건 충족 시 자동 진행"}
							</span>
						)}
					</nav>
				</div>
			) : null}
		</aside>
	);
}

function guidedBuildChapterStep(
	chapter: NonNullable<ReturnType<typeof guidedBuildCurrentChapter>>,
	evaluation: GuidedBuildEvaluation,
): number {
	if (chapter.status === "complete") return chapter.missionCount;
	const missionId = evaluation.currentMissionId;
	const missionIndex = missionId ? chapter.definition.missionIds.indexOf(missionId) : -1;
	return missionIndex >= 0
		? missionIndex + 1
		: Math.min(chapter.completedMissionCount + 1, chapter.missionCount);
}

function activeSuggestedActionInstruction(
	action: GuidedBuildSuggestedAction | null,
	fallback: string,
): string {
	if (action === "ohb") {
		return "OHB 도구가 준비됐습니다. 캔버스 포커스에서 방향키 또는 WASD로 추천 슬롯을 확인하고 Enter로 배치하세요. 포인터로 강조 슬롯을 클릭해도 됩니다.";
	}
	if (action === "eq") {
		return "EQ 도구가 준비됐습니다. 캔버스에서 Enter로 시작 슬롯을 고른 뒤 방향키로 끝 슬롯을 확인하고 Enter로 확정하세요. 포인터 드래그도 가능합니다.";
	}
	if (action === "stk") {
		return "STK 도구가 준비됐습니다. 캔버스에서 Enter로 추천 입고·출고 슬롯을 차례로 선택하면 그룹이 완성됩니다. 포인터 선택과 STK 생성도 가능합니다.";
	}
	return fallback;
}

function guidedBuildMissionDetail(definitionEyebrow: string, promptEyebrow: string): string | null {
	if (promptEyebrow === definitionEyebrow) return null;
	const definitionPrefix = `${definitionEyebrow} · `;
	const detail = promptEyebrow.startsWith(definitionPrefix)
		? promptEyebrow.slice(definitionPrefix.length)
		: promptEyebrow;
	if (!/^\d+\/\d+$/.test(detail)) return detail;
	const processLabel = definitionEyebrow.split("·").at(-1)?.trim() ?? "STEP";
	return `${processLabel} · 작업 ${detail}`;
}
