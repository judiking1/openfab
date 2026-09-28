import { Check, Factory, FolderClock, GraduationCap, MousePointer2, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";

export interface OpenFabStartDialogProps {
	readonly busy?: boolean;
	readonly hasCurrentFabContent?: boolean;
	readonly returnFocus?: HTMLElement | null;
	readonly recovery?: Readonly<{
		readonly projectName: string;
		readonly totalCount: number;
	}> | null;
	readonly onGuidedBuild: () => void;
	readonly onVerifiedTemplate: () => void;
	readonly onBlankCanvas: () => void;
	readonly onResumeRecovery?: () => void;
	readonly onReviewRecovery?: () => void;
	readonly onClose: () => void;
}

export function OpenFabStartDialog({
	busy = false,
	hasCurrentFabContent = false,
	returnFocus = null,
	recovery = null,
	onGuidedBuild,
	onVerifiedTemplate,
	onBlankCanvas,
	onResumeRecovery,
	onReviewRecovery,
	onClose,
}: OpenFabStartDialogProps): React.ReactElement {
	const dialogRef = useRef<HTMLElement | null>(null);
	const guidedButtonRef = useRef<HTMLButtonElement | null>(null);
	const recoveryButtonRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		(recoveryButtonRef.current ?? guidedButtonRef.current)?.focus({ preventScroll: true });
		return () => returnFocus?.focus({ preventScroll: true });
	}, [returnFocus]);

	const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
		if (event.key === "Escape" && !busy) {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key !== "Tab") return;
		const dialog = dialogRef.current;
		if (!dialog) return;
		const focusable = Array.from(
			dialog.querySelectorAll<HTMLElement>(
				"button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
			),
		).filter((element) => !element.hasAttribute("hidden"));
		if (focusable.length === 0) {
			event.preventDefault();
			dialog.focus({ preventScroll: true });
			return;
		}
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	return (
		<div className="tilefab-openfab-start-backdrop" data-testid="openfab-start-dialog-backdrop">
			<section
				ref={dialogRef}
				className="tilefab-openfab-start-dialog"
				data-testid="openfab-start-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="openfab-start-title"
				aria-describedby="openfab-start-description"
				tabIndex={-1}
				onKeyDown={handleKeyDown}
			>
				<header>
					<span>
						<GraduationCap size={18} />
					</span>
					<div>
						<small>START OPENFAB</small>
						<h2 id="openfab-start-title">어떻게 시작할까요?</h2>
					</div>
					<button
						type="button"
						aria-label="OpenFab 시작 선택 닫기"
						disabled={busy}
						onClick={onClose}
					>
						<X size={16} />
					</button>
				</header>
				<p id="openfab-start-description">
					{recovery
						? "저장되지 않은 작업의 로컬 복구본이 있습니다. 이어서 열거나 새 FAB를 시작하세요. 새로 시작해도 복구본은 자동으로 삭제되지 않습니다."
						: hasCurrentFabContent
							? "현재 FAB를 계속 편집할 수 있습니다. 빈 프로젝트가 필요하면 프로젝트 메뉴에서 새 프로젝트를 선택하세요."
							: "처음이라면 Guided Build로 첫 정적 FAB를 완성하세요. 같은 프로젝트와 편집 명령으로 레일부터 검증·저장까지 이어집니다."}
				</p>
				{recovery && onResumeRecovery && onReviewRecovery ? (
					<section className="tilefab-openfab-start-recovery" aria-label="복구본 이어하기">
						<FolderClock size={20} />
						<span>
							<strong>복구본 이어하기</strong>
							<small>
								“{recovery.projectName}” · 최신 복구본 · 전체 {recovery.totalCount.toLocaleString()}
								개
							</small>
						</span>
						<div>
							<button
								ref={recoveryButtonRef}
								type="button"
								disabled={busy}
								onClick={onResumeRecovery}
							>
								최신 복구본 이어하기
							</button>
							<button type="button" disabled={busy} onClick={onReviewRecovery}>
								다른 복구본 보기
							</button>
						</div>
					</section>
				) : null}
				<div className="tilefab-openfab-start-options">
					<button
						ref={guidedButtonRef}
						type="button"
						className="tilefab-openfab-start-option tilefab-openfab-start-option--primary"
						disabled={busy}
						onClick={onGuidedBuild}
					>
						<GraduationCap size={22} />
						<span>
							<strong>GUIDED BUILD</strong>
							<small>레일 → Port → Bay/Bank → Fab → 검증·저장</small>
						</span>
						<em>
							<Check size={12} /> 추천
						</em>
					</button>
					<button
						type="button"
						className="tilefab-openfab-start-option"
						disabled={busy}
						onClick={onVerifiedTemplate}
					>
						<Factory size={22} />
						<span>
							<strong>VERIFIED TEMPLATE</strong>
							<small>
								{hasCurrentFabContent
									? "합성 레일·FAB 구조를 새 프로젝트 또는 현재 FAB에 배치 · 장비는 직접 배치"
									: "합성 레일·FAB 구조 예제 · 장비는 직접 배치"}
							</small>
						</span>
					</button>
					<button
						type="button"
						className="tilefab-openfab-start-option"
						disabled={busy}
						onClick={onBlankCanvas}
					>
						<MousePointer2 size={22} />
						<span>
							<strong>BLANK CANVAS</strong>
							<small>
								{hasCurrentFabContent
									? "현재 FAB를 유지하고 편집기로 돌아가기"
									: "빈 프로젝트에서 편집 도구 직접 사용"}
							</small>
						</span>
					</button>
				</div>
			</section>
		</div>
	);
}
