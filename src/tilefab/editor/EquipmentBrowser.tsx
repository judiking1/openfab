import { ArrowLeft, Check, ChevronRight, Search } from "lucide-react";
import { type ReactElement, type Ref, type UIEventHandler, useId } from "react";
import type { EquipmentGroupKind, EquipmentGroupRecord } from "../core/EquipmentGroup";
import type { StaticFabOrganizationRecord } from "../core/StaticFabOrganization";

export type EquipmentBrowserKindFilter = EquipmentGroupKind | "ALL";
export type EquipmentBrowserLoopFilter = "ALL" | "UNOWNED" | number;
export type EquipmentBrowserLoopOption = Pick<StaticFabOrganizationRecord, "id" | "name">;

export interface EquipmentBrowserRow {
	readonly equipmentGroup: Pick<EquipmentGroupRecord, "id" | "kind" | "portIds">;
	/** Resolved by the caller, including non-Loop or ambiguous ownership. */
	readonly ownershipLabel: string;
	readonly disabledReason?: string | null;
}

export interface EquipmentBrowserProps {
	/** Current filtered page. The caller owns lookup, ownership resolution and pagination. */
	readonly rows: readonly EquipmentBrowserRow[];
	readonly loopOptions: readonly EquipmentBrowserLoopOption[];
	readonly kindFilter: EquipmentBrowserKindFilter;
	readonly loopFilter: EquipmentBrowserLoopFilter;
	readonly search: string;
	readonly selectedEquipmentGroupId: number | null;
	readonly equipmentCount: number;
	readonly matchCount: number;
	readonly pageStart: number;
	readonly interactionBlockedReason?: string | null;
	readonly listRef?: Ref<HTMLDivElement>;
	readonly searchInputRef?: Ref<HTMLInputElement>;
	readonly onListScroll?: UIEventHandler<HTMLDivElement>;
	readonly onKindFilterChange: (kind: EquipmentBrowserKindFilter) => void;
	readonly onLoopFilterChange: (loop: EquipmentBrowserLoopFilter) => void;
	readonly onSearchChange: (search: string) => void;
	readonly onChangePage: (direction: -1 | 1) => void;
	readonly onSelectEquipment: (equipmentGroupId: number, trigger: HTMLButtonElement) => void;
	readonly onOpenProperties: (equipmentGroupId: number, trigger: HTMLButtonElement) => void;
}

const KIND_FILTERS = ["ALL", "OHB", "EQ", "STK"] as const;

/** Presentation only. Selection and Inspector entry still require the caller's current-source guards. */
export function EquipmentBrowser({
	rows,
	loopOptions,
	kindFilter,
	loopFilter,
	search,
	selectedEquipmentGroupId,
	equipmentCount,
	matchCount,
	pageStart,
	interactionBlockedReason,
	listRef,
	searchInputRef,
	onListScroll,
	onKindFilterChange,
	onLoopFilterChange,
	onSearchChange,
	onChangePage,
	onSelectEquipment,
	onOpenProperties,
}: EquipmentBrowserProps): ReactElement {
	const instanceId = useId();
	const searchId = `${instanceId}-search`;
	const loopId = `${instanceId}-loop`;
	const listId = `${instanceId}-list`;
	const blockedReasonId = `${instanceId}-blocked`;
	const loopValue = typeof loopFilter === "number" ? `loop:${loopFilter}` : loopFilter;
	const pageEnd = pageStart + rows.length;
	const paginated = pageStart > 0 || matchCount > rows.length;

	return (
		<section
			className="tilefab-equipment-browser"
			data-testid="equipment-browser"
			aria-label="장비 찾기"
		>
			<fieldset className="tilefab-equipment-browser-filters">
				<legend>장비 종류</legend>
				{KIND_FILTERS.map((kind) => (
					<button
						key={kind}
						type="button"
						aria-pressed={kindFilter === kind}
						aria-controls={listId}
						data-active={kindFilter === kind}
						onClick={() => onKindFilterChange(kind)}
					>
						{kind === "ALL" ? "전체" : kind}
					</button>
				))}
			</fieldset>
			<div className="tilefab-equipment-browser-search">
				<label htmlFor={searchId}>장비·Port 검색</label>
				<div className="tilefab-equipment-browser-search-input">
					<Search size={14} aria-hidden="true" />
					<input
						id={searchId}
						ref={searchInputRef}
						type="search"
						data-testid="equipment-browser-search"
						value={search}
						placeholder="장비 ID / Port ID"
						aria-controls={listId}
						onChange={(event) => onSearchChange(event.currentTarget.value)}
					/>
				</div>
			</div>
			<label className="tilefab-equipment-browser-loop-filter" htmlFor={loopId}>
				<span>Loop 소속</span>
				<select
					id={loopId}
					data-testid="equipment-browser-loop-filter"
					value={loopValue}
					aria-controls={listId}
					onChange={(event) => {
						const value = event.currentTarget.value;
						if (value === "ALL" || value === "UNOWNED") {
							onLoopFilterChange(value);
							return;
						}
						const id = Number(value.slice("loop:".length));
						if (loopOptions.some((loop) => loop.id === id)) onLoopFilterChange(id);
					}}
				>
					<option value="ALL">전체</option>
					<option value="UNOWNED">미소속</option>
					{loopOptions.map((loop) => (
						<option key={loop.id} value={`loop:${loop.id}`}>
							{loop.name || `Loop-${loop.id}`}
						</option>
					))}
				</select>
			</label>
			<div className="tilefab-equipment-browser-summary" role="status">
				{matchCount.toLocaleString()}개
			</div>
			{interactionBlockedReason ? (
				<p id={blockedReasonId} className="tilefab-equipment-browser-blocked">
					{interactionBlockedReason}
				</p>
			) : null}
			<div
				id={listId}
				ref={listRef}
				className="tilefab-equipment-browser-list"
				data-testid="equipment-browser-list"
				onScroll={onListScroll}
			>
				{rows.length === 0 ? (
					<p className="tilefab-equipment-browser-empty">
						{equipmentCount === 0 ? "배치된 장비가 없습니다." : "검색 결과가 없습니다."}
					</p>
				) : (
					<ul>
						{rows.map(({ equipmentGroup, ownershipLabel, disabledReason }) => {
							const selected = equipmentGroup.id === selectedEquipmentGroupId;
							const label = `${equipmentGroup.kind}-${equipmentGroup.id}`;
							const blockedReason = interactionBlockedReason || disabledReason;
							const rowReasonId = `${instanceId}-equipment-${equipmentGroup.id}-reason`;
							const describedBy = interactionBlockedReason
								? blockedReasonId
								: disabledReason
									? rowReasonId
									: undefined;
							return (
								<li
									key={equipmentGroup.id}
									className="tilefab-equipment-browser-row"
									data-equipment-group-id={equipmentGroup.id}
									data-selected={selected}
								>
									<button
										type="button"
										className="tilefab-equipment-browser-select"
										aria-label={`${label} 선택 · ${ownershipLabel} · Port ${equipmentGroup.portIds.length}개`}
										aria-pressed={selected}
										aria-describedby={describedBy}
										disabled={Boolean(blockedReason)}
										onClick={(event) => onSelectEquipment(equipmentGroup.id, event.currentTarget)}
									>
										<span className="tilefab-equipment-browser-row-copy">
											<strong>{label}</strong>
											<span className="tilefab-equipment-browser-ownership">{ownershipLabel}</span>
											<span className="tilefab-equipment-browser-port-count">
												Port {equipmentGroup.portIds.length.toLocaleString()}개
											</span>
										</span>
										{selected ? (
											<span className="tilefab-equipment-browser-selected">
												<Check size={14} aria-hidden="true" /> 선택됨
											</span>
										) : null}
									</button>
									<button
										type="button"
										className="tilefab-equipment-browser-edit"
										aria-label={`${label} 속성 편집`}
										aria-describedby={describedBy}
										disabled={Boolean(blockedReason)}
										onClick={(event) => onOpenProperties(equipmentGroup.id, event.currentTarget)}
									>
										속성 편집 <ChevronRight size={14} aria-hidden="true" />
									</button>
									{disabledReason && !interactionBlockedReason ? (
										<p id={rowReasonId} className="tilefab-equipment-browser-row-reason">
											{disabledReason}
										</p>
									) : null}
								</li>
							);
						})}
					</ul>
				)}
			</div>
			{paginated ? (
				<nav className="tilefab-equipment-browser-pagination" aria-label="장비 목록 페이지">
					<span className="tilefab-equipment-browser-page-range">
						{rows.length > 0
							? `${(pageStart + 1).toLocaleString()}–${pageEnd.toLocaleString()}`
							: "0"}
						{" / "}
						{matchCount.toLocaleString()}개
					</span>
					<button type="button" disabled={pageStart === 0} onClick={() => onChangePage(-1)}>
						<ArrowLeft size={14} aria-hidden="true" /> 이전
					</button>
					<button type="button" disabled={pageEnd >= matchCount} onClick={() => onChangePage(1)}>
						다음 <ChevronRight size={14} aria-hidden="true" />
					</button>
				</nav>
			) : null}
		</section>
	);
}
