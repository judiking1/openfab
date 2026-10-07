export interface StandaloneProcessLoopRegistrationFormProps {
	readonly name: string;
	readonly busy: boolean;
	readonly selectionAvailable: boolean;
	readonly selectionUnavailableReason?: string;
	readonly selectedEquipmentGroupCount?: number;
	readonly onSelectRailOnly?: () => void;
	readonly onNameChange: (name: string) => void;
	readonly onRegister: () => void;
}

/** Explicit user intent; candidate closure and membership are validated when submitted. */
export function StandaloneProcessLoopRegistrationForm({
	name,
	busy,
	selectionAvailable,
	selectionUnavailableReason,
	selectedEquipmentGroupCount = 0,
	onSelectRailOnly,
	onNameChange,
	onRegister,
}: StandaloneProcessLoopRegistrationFormProps) {
	return (
		<section
			className="tilefab-loop-registration"
			aria-labelledby="standalone-process-loop-heading"
			aria-busy={busy}
		>
			<h3 id="standalone-process-loop-heading">
				작업 루프 등록 <small>Process Loop</small>
			</h3>
			<p id="standalone-process-loop-instructions">
				직접 만든 폐쇄 레일 전체를 선택해 등록하세요. 이미 배치한 장비는 그대로 유지되며, 루프 등록
				후 장비의 소속을 지정할 수 있습니다.
			</p>
			{selectedEquipmentGroupCount > 0 && onSelectRailOnly ? (
				<button
					type="button"
					className="tilefab-loop-registration-control"
					data-testid="process-loop-select-rail-only"
					disabled={busy}
					onClick={onSelectRailOnly}
				>
					레일만 선택 · 장비 {selectedEquipmentGroupCount}개 제외
				</button>
			) : null}
			<label className="tilefab-organization-field">
				<span>작업 루프 이름</span>
				<input
					className="tilefab-loop-registration-control tilefab-loop-registration-input"
					value={name}
					maxLength={120}
					disabled={busy}
					data-testid="standalone-process-loop-name"
					aria-describedby="standalone-process-loop-instructions"
					onChange={(event) => onNameChange(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (
							event.key !== "Enter" ||
							event.nativeEvent.isComposing ||
							event.nativeEvent.keyCode === 229
						)
							return;
						event.preventDefault();
						if (!busy && selectionAvailable && name.trim().length > 0) onRegister();
					}}
				/>
			</label>
			<button
				type="button"
				className="tilefab-inspector-primary tilefab-loop-registration-control"
				data-testid="register-process-loop"
				disabled={busy || !selectionAvailable || name.trim().length === 0}
				onClick={onRegister}
			>
				{busy ? "루프 등록 검사 중…" : "선택한 레일을 작업 루프로 등록"}
			</button>
			<small data-testid="standalone-process-loop-selection-help">
				{!selectionAvailable
					? (selectionUnavailableReason ??
						"선택 메뉴에서 폐쇄 레일 전체를 선택한 뒤 여기서 등록하세요.")
					: "등록 시 폐합과 기존 소속을 검사합니다. 실패하면 레일과 선택이 유지됩니다."}
			</small>
		</section>
	);
}

export interface StandaloneProcessLoopAuthoringBarProps {
	readonly ownerName: string | null;
	readonly pendingLabel: string | null;
	readonly feedback: string | null;
	readonly onExit: () => void;
	readonly onSelectRail: () => void;
	readonly onCancel: () => void;
	readonly returnToChecks?: boolean;
}

export function StandaloneProcessLoopAuthoringBar({
	ownerName,
	pendingLabel,
	feedback,
	onExit,
	onCancel,
	onSelectRail,
	returnToChecks = false,
}: StandaloneProcessLoopAuthoringBarProps) {
	if (!ownerName && !pendingLabel) return null;
	return (
		<section
			className="tilefab-process-loop-contextbar"
			data-testid="process-loop-edit-context"
			aria-label="작업 루프 레일 편집"
			aria-busy={pendingLabel !== null}
		>
			<div>
				<strong>
					{ownerName ? `${ownerName} · 작업 루프 레일 편집` : "작업 루프 · Process Loop"}
				</strong>
				<p role="status" data-testid="process-loop-edit-feedback">
					{pendingLabel ?? feedback ?? "그리기·지우기·Delete · 장비와 루프 소속은 유지됩니다"}
				</p>
			</div>
			{ownerName && !pendingLabel ? (
				<button
					type="button"
					className="tilefab-arrangement-history-cancel tilefab-process-loop-context-action"
					data-testid="select-process-loop-rail"
					onClick={onSelectRail}
				>
					레일 선택
				</button>
			) : null}
			<button
				type="button"
				className="tilefab-arrangement-history-cancel tilefab-process-loop-context-action"
				data-testid={pendingLabel ? "cancel-process-loop-operation" : "exit-process-loop-edit"}
				aria-label={
					!pendingLabel && returnToChecks ? "편집 종료 후 현재 FAB을 다시 검사" : undefined
				}
				onClick={pendingLabel ? onCancel : onExit}
			>
				{pendingLabel ? "취소" : returnToChecks ? "종료·검사" : "편집 종료"} <kbd>ESC</kbd>
			</button>
		</section>
	);
}
