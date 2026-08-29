import { Check, Factory, GraduationCap, MousePointer2, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";

export interface OpenFabStartDialogProps {
	readonly busy?: boolean;
	readonly returnFocus?: HTMLElement | null;
	readonly onGuidedBuild: () => void;
	readonly onVerifiedTemplate: () => void;
	readonly onBlankCanvas: () => void;
	readonly onClose: () => void;
}

export function OpenFabStartDialog({
	busy = false,
	returnFocus = null,
	onGuidedBuild,
	onVerifiedTemplate,
	onBlankCanvas,
	onClose,
}: OpenFabStartDialogProps): React.ReactElement {
	const dialogRef = useRef<HTMLElement | null>(null);
	const guidedButtonRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		guidedButtonRef.current?.focus({ preventScroll: true });
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
					처음이라면 Guided Build로 첫 정적 FAB를 완성하세요. 같은 프로젝트와 편집 명령으로 레일부터
					검증·저장까지 이어집니다.
				</p>
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
							<small>합성 OpenFab 템플릿에서 시작</small>
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
							<small>전체 Editor v1 도구를 직접 사용</small>
						</span>
					</button>
				</div>
			</section>
		</div>
	);
}
