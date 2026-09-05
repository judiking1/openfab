import { ArrowRight, Check, MousePointer2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { GuidedBuildChapterDefinition } from "./GuidedBuildChapter";

export interface GuidedBuildChapterCheckpointProps {
	readonly completedChapter: GuidedBuildChapterDefinition;
	readonly nextChapter: GuidedBuildChapterDefinition;
	readonly onContinue: () => void;
	readonly onStartEditing: () => void;
}

export function GuidedBuildChapterCheckpoint({
	completedChapter,
	nextChapter,
	onContinue,
	onStartEditing,
}: GuidedBuildChapterCheckpointProps): React.ReactElement {
	const continueButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const frame = requestAnimationFrame(() =>
			continueButtonRef.current?.focus({ preventScroll: true }),
		);
		return () => cancelAnimationFrame(frame);
	}, []);

	return (
		<section
			className="tilefab-guided-build-chapter-checkpoint"
			data-testid="guided-build-chapter-checkpoint"
			data-completed-chapter={completedChapter.id}
		>
			<span className="tilefab-guided-build-chapter-checkmark" aria-hidden="true">
				<Check size={18} />
			</span>
			<div>
				<small>{completedChapter.label} COMPLETE</small>
				<strong>{guidedBuildChapterCompletionTitle(completedChapter.id)}</strong>
				<p>{guidedBuildChapterCompletionSummary(completedChapter.id)}</p>
			</div>
			<aside>
				<small>다음 과정</small>
				<strong>{nextChapter.label}</strong>
				<span>{nextChapter.title}</span>
			</aside>
			<footer>
				<button ref={continueButtonRef} type="button" className="primary" onClick={onContinue}>
					{guidedBuildChapterContinueLabel(completedChapter.id, nextChapter.label)}{" "}
					<ArrowRight size={14} />
				</button>
				<button type="button" onClick={onStartEditing}>
					<MousePointer2 size={14} /> 잠시 접고 편집
				</button>
			</footer>
		</section>
	);
}

function guidedBuildChapterContinueLabel(
	completedChapterId: GuidedBuildChapterDefinition["id"],
	nextChapterLabel: string,
): string {
	return completedChapterId === "reuse"
		? `${nextChapterLabel} 안내 보기`
		: `다음 과정 · ${nextChapterLabel}`;
}

function guidedBuildChapterCompletionTitle(chapterId: GuidedBuildChapterDefinition["id"]): string {
	if (chapterId === "quick-start") return "레일 기본기를 익혔습니다";
	if (chapterId === "equip") return "Port-first 장비를 익혔습니다";
	if (chapterId === "reuse") return "Loop 재사용을 익혔습니다";
	return "FAB 구조·검증·저장을 익혔습니다";
}

function guidedBuildChapterCompletionSummary(
	chapterId: GuidedBuildChapterDefinition["id"],
): string {
	if (chapterId === "quick-start") {
		return "빈 곳에서 직선을 만들고 열린 끝이 없는 방향성 Process Loop까지 완성했습니다.";
	}
	if (chapterId === "equip") {
		return "레일에서 파생된 방향과 합법 슬롯으로 OHB·EQ·STK Port를 배치했습니다.";
	}
	if (chapterId === "reuse") {
		return "Process Loop와 연결된 Port를 한 번의 원자적 복제로 함께 재사용했습니다.";
	}
	return "FAB 구조와 정적 검증, 저장·재개 흐름을 완료했습니다.";
}
