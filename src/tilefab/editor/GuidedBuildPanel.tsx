import { Check, CircleHelp, GraduationCap, X } from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { editorCommand, editorCommandHintBinding } from "./EditorCommandRegistry";
import { guidedBuildInputHint } from "./GuidedBuildInputHint";
import type { GuidedBuildEvaluation, GuidedBuildSuggestedAction } from "./GuidedBuildMission";

export interface GuidedBuildPanelProps {
	readonly evaluation: GuidedBuildEvaluation;
	readonly suggestedActionActive?: boolean;
	readonly onAcknowledgeNavigation: () => void;
	readonly onActivateSuggestedAction: (action: GuidedBuildSuggestedAction) => void;
	readonly onExit: () => void;
}

export function GuidedBuildPanel({
	evaluation,
	suggestedActionActive = false,
	onAcknowledgeNavigation,
	onActivateSuggestedAction,
	onExit,
}: GuidedBuildPanelProps): React.ReactElement {
	const missionHelpId = useId();
	const missionHelpButtonRef = useRef<HTMLButtonElement>(null);
	const [helpMissionId, setHelpMissionId] =
		useState<GuidedBuildEvaluation["currentMissionId"]>(null);
	const current = evaluation.missions.find((mission) => mission.status === "current") ?? null;
	const definition = current?.definition ?? null;
	const prompt = current?.prompt ?? null;
	const suggestedAction = prompt?.suggestedAction ?? null;
	const showSuggestedAction =
		suggestedAction !== null && prompt?.suggestedActionLabel !== null && !suggestedActionActive;
	const progressCue = prompt?.progressCue ?? null;
	const command = prompt?.primaryCommandId ? editorCommand(prompt.primaryCommandId) : null;
	const hint = prompt?.primaryCommandId
		? guidedBuildInputHint(
				prompt.primaryCommandId,
				editorCommandHintBinding(prompt.primaryCommandId),
			)
		: null;
	const missionCount = evaluation.missions.length;
	const currentSequence = evaluation.complete ? missionCount : (definition?.sequence ?? 1);
	const currentTitle = evaluation.complete
		? "완료"
		: (prompt?.title ?? definition?.title ?? "현재 미션");
	const missionDetail =
		definition && prompt ? guidedBuildMissionDetail(definition.eyebrow, prompt.eyebrow) : null;
	const missionHelpOpen =
		evaluation.currentMissionId !== null && helpMissionId === evaluation.currentMissionId;

	return (
		<aside
			className="tilefab-guided-build-panel"
			data-testid="guided-build-panel"
			data-current-mission={evaluation.currentMissionId ?? "complete"}
			data-presentation={prompt?.presentation ?? "default"}
			aria-labelledby="guided-build-title"
			aria-live="polite"
			onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				if (missionHelpOpen) {
					setHelpMissionId(null);
					missionHelpButtonRef.current?.focus();
					return;
				}
				onExit();
			}}
		>
			<header>
				<span>
					<GraduationCap size={17} />
				</span>
				<div>
					<small>GUIDED BUILD</small>
					<strong id="guided-build-title">
						{evaluation.complete ? "첫 정적 FAB 작업 흐름 완료" : prompt?.title}
					</strong>
				</div>
				<button type="button" aria-label="Guided Build 종료" onClick={onExit}>
					<X size={15} />
				</button>
			</header>
			<div className="tilefab-guided-build-progress">
				<span aria-hidden="true">
					<strong>{currentSequence}</strong> / {missionCount}
				</span>
				<progress
					aria-label="Guided Build 진행률"
					aria-valuetext={`${currentSequence} / ${missionCount} · ${currentTitle}`}
					value={currentSequence}
					max={missionCount}
				/>
			</div>
			{evaluation.complete ? (
				<div className="tilefab-guided-build-complete">
					<Check size={20} />
					<p>
						<strong>검증한 OpenFab 프로젝트를 저장하고 같은 파일로 다시 열었습니다.</strong>
						<small>
							가이드 진행률은 파일에 저장하지 않고 현재 canonical 프로젝트 증거에서 다시
							구성됐습니다.
						</small>
					</p>
					<button type="button" onClick={onExit}>
						편집 계속하기
					</button>
				</div>
			) : definition && prompt ? (
				<div className="tilefab-guided-build-mission">
					{missionDetail ? (
						<small data-testid="guided-build-mission-detail">{missionDetail}</small>
					) : null}
					<p>{prompt.objective}</p>
					{progressCue ? (
						<div
							className="tilefab-guided-build-progress-cue"
							data-testid="guided-build-progress-cue"
						>
							<span>
								<small>{progressCue.label}</small>
								<strong>{progressCue.value}</strong>
							</span>
							<p>{progressCue.instruction}</p>
						</div>
					) : (
						<em>{prompt.rationale}</em>
					)}
					{command && hint ? (
						<div className="tilefab-guided-build-hint">
							<span>{command.label}</span>
							<strong>{hint.inputs.join(hint.inputJoin === "or" ? " 또는 " : " + ")}</strong>
						</div>
					) : null}
					{missionHelpOpen ? (
						<section
							id={missionHelpId}
							className="tilefab-guided-build-mission-help"
							data-testid="guided-build-mission-help"
							aria-label={`${currentTitle} 단계 도움말`}
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
										{showSuggestedAction ? <>{prompt.suggestedActionLabel} → </> : null}
										{command && hint ? (
											<>
												{command.label} <kbd>{hint.inputs.join(" / ")}</kbd>
											</>
										) : (
											"화면의 강조된 작업을 완료하세요."
										)}
									</span>
								</li>
								<li>
									<strong>다음 단계</strong>
									<span>프로젝트 증거가 충족되면 자동으로 열립니다.</span>
								</li>
							</ol>
						</section>
					) : null}
					<div className="tilefab-guided-build-actions">
						{showSuggestedAction && suggestedAction ? (
							<button
								type="button"
								className="primary"
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
							onClick={() => setHelpMissionId(missionHelpOpen ? null : evaluation.currentMissionId)}
						>
							<CircleHelp size={14} /> {missionHelpOpen ? "단계 도움말 닫기" : "이 단계 도움말"}
						</button>
					</div>
				</div>
			) : null}
		</aside>
	);
}

function guidedBuildMissionDetail(definitionEyebrow: string, promptEyebrow: string): string | null {
	if (promptEyebrow === definitionEyebrow) return null;
	const definitionPrefix = `${definitionEyebrow} · `;
	const detail = promptEyebrow.startsWith(definitionPrefix)
		? promptEyebrow.slice(definitionPrefix.length)
		: promptEyebrow;
	return /^\d+\/\d+$/.test(detail) ? `STEP ${detail}` : detail;
}
