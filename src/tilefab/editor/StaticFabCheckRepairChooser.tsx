import { type KeyboardEvent, type ReactElement, type Ref, useId } from "react";

/**
 * The editor supplies current display receipts and owns every query, selection and launch.
 */
export type StaticFabCheckRepairChooserRole = "PROCESS_LOOP" | "BAY" | "BAY_BANK";
export type StaticFabCheckRepairChooserRoleFilter = StaticFabCheckRepairChooserRole | "ALL";
export type StaticFabCheckRepairChooserPhase = "preparing" | "querying" | "ready" | "launching";

export interface StaticFabCheckRepairChooserOption {
	readonly id: number;
	readonly name: string;
	readonly role: StaticFabCheckRepairChooserRole;
}

export type StaticFabCheckRepairChooserSelectedSlot = Readonly<
	| {
			status: "available";
			organizationId: number;
			option: StaticFabCheckRepairChooserOption;
	  }
	| { status: "missing" | "unsupported" | "pending"; organizationId: number }
>;

export type StaticFabCheckRepairChooserQueryStatus =
	| "text-results"
	| "exact-id-match"
	| "exact-id-missing"
	| "exact-id-unsupported"
	| "exact-id-filtered"
	| "exact-id-selected"
	| "invalid-id";

export interface StaticFabCheckRepairChooserPage {
	readonly matches: readonly StaticFabCheckRepairChooserOption[];
	readonly queryStatus: StaticFabCheckRepairChooserQueryStatus;
	readonly explanation: string | null;
	readonly hasMore: boolean;
}

/** Structural subset of the controller view; no continuation or domain data. */
export interface StaticFabCheckRepairChooserDisplayView {
	readonly kind: "loop" | "connector";
	readonly phase: StaticFabCheckRepairChooserPhase;
	readonly page: StaticFabCheckRepairChooserPage | null;
	readonly advice: Readonly<{ status: "choose" | "blocked" | "ready"; reason?: string }> | null;
	readonly reason: string | null;
}

export interface StaticFabCheckRepairChooserRemoveRequest {
	readonly slotIndex: 0 | 1;
	readonly organizationId: number;
}

export interface StaticFabCheckRepairChooserProps {
	readonly view: StaticFabCheckRepairChooserDisplayView;
	/** Controlled owner draft; query normalization and replacement remain outside React. */
	readonly input: Readonly<{
		searchText: string;
		role: StaticFabCheckRepairChooserRoleFilter;
	}>;
	/**
	 * At most two explicit slots, in controller-owned order.
	 * Supply independently of page; available names/roles survive querying and filtering.
	 */
	readonly selectedSlots: readonly StaticFabCheckRepairChooserSelectedSlot[];
	/** Additional current owner guard, never a replacement for final admission checks. */
	readonly launchBlockedReason?: string | null;
	/** Optional human-readable progress from asynchronous launch preparation. */
	readonly busyMessage?: string | null;
	readonly headingRef?: Ref<HTMLHeadingElement>;
	readonly searchInputRef?: Ref<HTMLInputElement>;
	readonly closeButtonRef?: Ref<HTMLButtonElement>;
	readonly launchButtonRef?: Ref<HTMLButtonElement>;
	readonly onSearchTextChange: (text: string) => void;
	readonly onSubmitSearch: () => void;
	readonly onRoleFilterChange: (role: StaticFabCheckRepairChooserRoleFilter) => void;
	readonly onSelectOrganizationId: (organizationId: number) => void;
	readonly onRemoveOrganizationId: (request: StaticFabCheckRepairChooserRemoveRequest) => void;
	/**
	 * Emit intent only. These callbacks may start owner-managed asynchronous work.
	 * No callback return value closes this component or changes selection.
	 */
	readonly onLaunch: () => void;
	readonly onCancel: () => void;
	readonly onClose: () => void;
}

const ROLE_LABELS: Readonly<Record<StaticFabCheckRepairChooserRole, string>> = {
	PROCESS_LOOP: "작업 루프",
	BAY: "생산 베이",
	BAY_BANK: "베이 뱅크",
};

export function StaticFabCheckRepairChooser({
	view,
	input,
	selectedSlots,
	launchBlockedReason,
	busyMessage,
	headingRef,
	searchInputRef,
	closeButtonRef,
	launchButtonRef,
	onSearchTextChange,
	onSubmitSearch,
	onRoleFilterChange,
	onSelectOrganizationId,
	onRemoveOrganizationId,
	onLaunch,
	onCancel,
	onClose,
}: StaticFabCheckRepairChooserProps): ReactElement {
	const id = useId();
	const headingId = `${id}-heading`;
	const bodyHeadingId = `${id}-body-heading`;
	const searchId = `${id}-search`;
	const roleId = `${id}-role`;
	const feedbackId = `${id}-feedback`;
	const resultsHeadingId = `${id}-results`;
	const selectedHeadingId = `${id}-selected`;
	const isLaunching = view.phase === "launching";
	const canLaunch =
		view.phase === "ready" && view.advice?.status === "ready" && launchBlockedReason == null;
	const slotIndices: readonly (0 | 1)[] = view.kind === "loop" ? [0] : [0, 1];
	const title = view.kind === "loop" ? "작업 루프 선택" : "연결 대상 선택";
	const launchLabel = view.kind === "loop" ? "레일 편집 시작" : "연결 편집 시작";
	const phaseMessage =
		view.phase === "preparing"
			? (busyMessage ?? "대상 목록을 준비하고 있습니다. 취소할 수 있습니다.")
			: view.phase === "querying"
				? (busyMessage ?? "검색 결과를 확인하고 있습니다. 선택한 대상은 유지됩니다.")
				: view.phase === "launching"
					? (busyMessage ?? "편집을 준비하고 있습니다. 취소할 수 있습니다.")
					: canLaunch
						? "직접 선택한 대상으로 편집을 시작할 수 있습니다."
						: "목록에서 수정할 대상을 직접 선택하세요.";
	const reason = launchBlockedReason ?? view.reason ?? view.advice?.reason ?? null;
	const queryMessage = view.page ? (view.page.explanation ?? describeQueryResult(view.page)) : null;
	const matches = view.page?.matches ?? [];

	const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
		if (event.key !== "Escape" || event.nativeEvent.isComposing || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		onCancel();
	};

	return (
		<section
			className="tilefab-check-repair-chooser"
			aria-labelledby={headingId}
			data-kind={view.kind}
			data-phase={view.phase}
			onKeyDown={handleKeyDown}
		>
			<header className="tilefab-check-repair-chooser__header">
				<h3 id={headingId} ref={headingRef} tabIndex={-1}>
					<span>검사</span>
					{title}
				</h3>
				<button
					ref={closeButtonRef}
					type="button"
					className="tilefab-check-repair-chooser__close"
					aria-label={`${title} 닫기 · 검사로 돌아가기`}
					onClick={onClose}
				>
					닫기
				</button>
			</header>
			<section
				className="tilefab-check-repair-chooser__body"
				aria-labelledby={bodyHeadingId}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll this region.
				tabIndex={0}
			>
				<h4 id={bodyHeadingId} className="tilefab-check-repair-chooser__sr-only">
					대상 검색과 직접 선택
				</h4>
				<form
					className="tilefab-check-repair-chooser__search"
					onSubmit={(event) => {
						event.preventDefault();
						if (!isLaunching) onSubmitSearch();
					}}
				>
					<label htmlFor={searchId}>이름 또는 #ID</label>
					<label htmlFor={roleId}>역할</label>
					<input
						id={searchId}
						ref={searchInputRef}
						type="text"
						inputMode="search"
						maxLength={120}
						autoComplete="off"
						value={input.searchText}
						disabled={isLaunching}
						onChange={(event) => onSearchTextChange(event.currentTarget.value)}
					/>
					<select
						id={roleId}
						value={input.role}
						disabled={isLaunching}
						onChange={(event) =>
							onRoleFilterChange(event.currentTarget.value as StaticFabCheckRepairChooserRoleFilter)
						}
					>
						{view.kind === "loop" ? (
							<option value="PROCESS_LOOP">작업 루프</option>
						) : (
							<>
								<option value="ALL">전체 역할</option>
								<option value="BAY">생산 베이</option>
								<option value="BAY_BANK">베이 뱅크</option>
							</>
						)}
					</select>
					<button
						type="submit"
						className="tilefab-check-repair-chooser__search-button"
						disabled={isLaunching}
					>
						검색
					</button>
				</form>

				<section
					className="tilefab-check-repair-chooser__selection"
					aria-labelledby={selectedHeadingId}
				>
					<h4 id={selectedHeadingId}>직접 고른 대상</h4>
					<p className="tilefab-check-repair-chooser__selection-hint">
						{view.kind === "loop"
							? "작업 루프 1개를 직접 선택하세요."
							: "같은 역할의 생산 베이 2개 또는 베이 뱅크 2개를 직접 선택하세요."}
					</p>
					<ol className="tilefab-check-repair-chooser__slots">
						{slotIndices.map((slotIndex) => {
							const slot = selectedSlots[slotIndex];
							const slotLabel = view.kind === "loop" ? "작업 루프" : `대상 ${slotIndex + 1}`;
							return (
								<li key={slotIndex} className="tilefab-check-repair-chooser__slot">
									<div>
										<span className="tilefab-check-repair-chooser__slot-label">{slotLabel}</span>
										{slot ? (
											<>
												{slot.status === "available" ? <strong>{slot.option.name}</strong> : null}
												<span className="tilefab-check-repair-chooser__identity">
													{slot.status === "available" ? `${ROLE_LABELS[slot.option.role]} · ` : ""}
													{`#${slot.organizationId}`}
												</span>
												{slot.status !== "available" ? (
													<small>{describeUnavailableSlot(slot.status)}</small>
												) : null}
											</>
										) : (
											<span className="tilefab-check-repair-chooser__empty-slot">
												직접 선택하세요
											</span>
										)}
									</div>
									{slot ? (
										<button
											type="button"
											className="tilefab-check-repair-chooser__remove"
											disabled={isLaunching}
											aria-label={
												slotLabel +
												" " +
												(slot.status === "available" ? `${slot.option.name} ` : "") +
												"#" +
												slot.organizationId +
												" 선택 해제"
											}
											onClick={() =>
												onRemoveOrganizationId({ slotIndex, organizationId: slot.organizationId })
											}
										>
											해제
										</button>
									) : null}
								</li>
							);
						})}
					</ol>
				</section>

				<div
					id={feedbackId}
					className="tilefab-check-repair-chooser__feedback"
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					<p>{phaseMessage}</p>
					{reason && reason !== phaseMessage ? <p>{reason}</p> : null}
					{queryMessage && queryMessage !== reason ? <p>{queryMessage}</p> : null}
					{view.page?.hasMore ? (
						<p>후보가 100개를 넘습니다. 이름 또는 #ID로 검색을 좁혀 주세요.</p>
					) : null}
				</div>

				<section
					className="tilefab-check-repair-chooser__results"
					aria-labelledby={resultsHeadingId}
					aria-busy={view.phase === "preparing" || view.phase === "querying"}
				>
					<h4 id={resultsHeadingId}>
						검색 결과
						{view.page ? <span>{`후보 ${matches.length}개`}</span> : null}
					</h4>
					<ul className="tilefab-check-repair-chooser__matches">
						{matches.map((option) => (
							<li key={option.id}>
								<button
									type="button"
									className="tilefab-check-repair-chooser__candidate"
									disabled={view.phase !== "ready"}
									onClick={() => onSelectOrganizationId(option.id)}
								>
									<span>
										<strong>{option.name}</strong>
										<span className="tilefab-check-repair-chooser__identity">
											{`${ROLE_LABELS[option.role]} · #${option.id}`}
										</span>
									</span>
									<span className="tilefab-check-repair-chooser__select-word">선택</span>
								</button>
							</li>
						))}
					</ul>
					{view.phase === "ready" && matches.length === 0 ? (
						<p className="tilefab-check-repair-chooser__empty-results">
							표시할 후보가 없습니다. 이름, #ID 또는 역할을 확인하세요.
						</p>
					) : null}
				</section>
			</section>
			<footer className="tilefab-check-repair-chooser__actions">
				<button type="button" onClick={onCancel}>
					취소
				</button>
				<button
					ref={launchButtonRef}
					type="button"
					className="tilefab-check-repair-chooser__launch"
					disabled={!canLaunch}
					aria-describedby={feedbackId}
					onClick={onLaunch}
				>
					{isLaunching ? "편집 준비 중" : launchLabel}
				</button>
			</footer>
		</section>
	);
}

function describeUnavailableSlot(status: "missing" | "unsupported" | "pending"): string {
	switch (status) {
		case "pending":
			return "선택한 대상을 확인 중입니다.";
		case "missing":
			return "현재 대상 정보를 찾을 수 없습니다.";
		case "unsupported":
			return "현재 수정 작업의 대상이 아닙니다.";
	}
}

function describeQueryResult(page: StaticFabCheckRepairChooserPage): string {
	switch (page.queryStatus) {
		case "text-results":
			return `검색 후보 ${page.matches.length}개를 표시합니다.`;
		case "exact-id-match":
			return "입력한 #ID의 후보를 찾았습니다. 직접 선택하세요.";
		case "exact-id-missing":
			return "현재 프로젝트에서 해당 #ID를 찾을 수 없습니다.";
		case "exact-id-unsupported":
			return "해당 #ID는 현재 수정 작업의 대상이 아닙니다.";
		case "exact-id-filtered":
			return "해당 #ID는 선택한 역할 필터와 다릅니다.";
		case "exact-id-selected":
			return "해당 #ID는 이미 직접 고른 대상입니다.";
		case "invalid-id":
			return "# 뒤에 올바른 조직 ID를 입력하세요.";
	}
}
