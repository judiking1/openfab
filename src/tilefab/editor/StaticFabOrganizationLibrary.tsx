import {
	AlertTriangle,
	ArrowLeft,
	ArrowLeftRight,
	Check,
	ChevronRight,
	Copy,
	Crosshair,
	Layers3,
	Link2,
	MapPinned,
	Plus,
	RefreshCcw,
	Save,
	Search,
	Trash2,
	X,
} from "lucide-react";
import type {
	ReactElement,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	RefObject,
} from "react";
import type {
	StaticFabAssemblyConnectorHierarchyRole,
	StaticFabAssemblyConnectorPurpose,
} from "../core/StaticFabAssemblyConnector";
import {
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH,
	type StaticFabOrganizationColor,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationSemanticRole,
} from "../core/StaticFabOrganization";
import type { StaticFabOrganizationSelectionMode } from "../core/StaticFabOrganizationSelection";
import type { StaticFabMinimapWorldBounds } from "../render/StaticFabMinimapGeometry";
import type { ContextualBlueprintSaveRequest } from "./BlueprintLibraryTypes";
import type { ContextualBlueprintSaveDestination } from "./ContextualBlueprintSave";
import { EditorInfoPopover } from "./EditorInfoPopover";
import type { StaticFabAssembleActionAvailability } from "./StaticFabAssembleMenu";
import type { StaticFabBankStructureSupport } from "./StaticFabBankStructureSupport";
import type { StaticFabBayStructureSupport } from "./StaticFabBayStructureSupport";
import {
	StaticFabNavigator,
	type StaticFabNavigatorIssueMarker,
	type StaticFabNavigatorModel,
	type StaticFabNavigatorTab,
} from "./StaticFabNavigator";

export type OrganizationDetailTab = "overview" | "relations" | "properties";

interface StaticFabOrganizationLibraryProps {
	readonly view: "list" | "detail";
	readonly onOpenDetails: () => void;
	readonly onShowList: () => void;
	readonly bayFlowSupport: StaticFabBayStructureSupport | null;
	readonly bankDetachSupport: StaticFabBankStructureSupport | null;
	readonly bankDeleteSupport: StaticFabBankStructureSupport | null;
	readonly assemblyConnectorAvailability: StaticFabAssembleActionAvailability;
	readonly assemblyConnectorHierarchyRole: StaticFabAssemblyConnectorHierarchyRole | null;
	readonly assemblyConnectorPurpose: StaticFabAssemblyConnectorPurpose | null;
	readonly centerNavigatorWorld: (x: number, y: number) => void;
	readonly chooseOrganizationSelectionMode: (mode: StaticFabOrganizationSelectionMode) => void;
	readonly chooseStaticFabNavigatorTab: (
		tab: StaticFabNavigatorTab,
		returnFocusTarget?: HTMLElement | null,
	) => void;
	readonly chooseStaticFabOrganizationFilter: (kind: StaticFabOrganizationKind | "ALL") => void;
	readonly closeStaticFabNavigator: () => void;
	readonly openSelectedStructureCommands: (organizationId: number) => void;
	readonly copySelectionToRailClipboard: () => void;
	readonly currentStaticFabInspectionPending: boolean;
	readonly equipmentGroupCount: number;
	readonly filteredStaticFabOrganizations: readonly StaticFabOrganizationRecord[];
	readonly organizationPageStart: number;
	readonly organizationMatchCount: number;
	readonly onChangeOrganizationPage: (direction: -1 | 1) => void;
	readonly fitMap: () => void;
	readonly focusedIssueId: string | null;
	readonly getNavigatorViewportBounds: () => StaticFabMinimapWorldBounds | null;
	readonly guidedBuildNavigatorCloseTarget: boolean;
	readonly guidedBuildNavigatorCloseTargetId: string | undefined;
	readonly guidedBuildOrganizationNextRecordId: number | undefined;
	readonly guidedBuildOrganizationPickerActive: boolean;
	readonly guidedBuildOrganizationPickerSelectionCount: number | null;
	readonly guidedBuildOrganizationRowOwnsNextStep: boolean;
	readonly guidedBuildOrganizationRowTargetId: string | null;
	readonly guidedBuildOrganizationSelectionTargetCount: number | null;
	readonly handleOrganizationDetailTabKeyDown: (
		event: ReactKeyboardEvent<HTMLButtonElement>,
		index: number,
	) => void;
	readonly handleStaticFabOrganizationClick: (
		event: ReactMouseEvent<HTMLButtonElement>,
		record: StaticFabOrganizationRecord,
	) => void;
	readonly handleStaticFabOrganizationFilterKeyDown: (
		event: ReactKeyboardEvent<HTMLButtonElement>,
		index: number,
	) => void;
	readonly handleStaticFabOrganizationOptionKeyDown: (
		event: ReactKeyboardEvent<HTMLButtonElement>,
		index: number,
	) => void;
	readonly handleStaticFabOrganizationSearchKeyDown: (
		event: ReactKeyboardEvent<HTMLInputElement>,
	) => void;
	readonly inspectStaticFabEquipment: () => void;
	readonly modelSyncPending: boolean;
	readonly navigatorIssueMarkers: readonly StaticFabNavigatorIssueMarker[];
	readonly navigatorModel: StaticFabNavigatorModel | null;
	readonly organizationColorDraft: StaticFabOrganizationColor;
	readonly organizationCount: number;
	readonly organizationDescriptionDraft: string;
	readonly organizationDetailsDirty: boolean;
	readonly organizationDetailsError: string | null;
	readonly organizationDetailsStale: boolean;
	readonly organizationDetailTab: OrganizationDetailTab;
	readonly organizationDetailTabs: readonly OrganizationDetailTab[];
	readonly organizationEditorDirty: boolean;
	readonly organizationEditorRef: RefObject<HTMLElement | null>;
	readonly organizationFilter: StaticFabOrganizationKind | "ALL";
	readonly organizationFilters: readonly (StaticFabOrganizationKind | "ALL")[];
	readonly organizationKindCounts: ReadonlyMap<StaticFabOrganizationKind, number>;
	readonly organizationListRef: RefObject<HTMLDivElement | null>;
	readonly organizationParentCandidateCount: number;
	readonly organizationParentCandidates: readonly StaticFabOrganizationRecord[];
	readonly organizationParentIdsDraft: readonly number[];
	readonly organizationParentSearch: string;
	readonly organizationRelationshipBlockedIds: ReadonlySet<number>;
	readonly organizationRenameDraft: string;
	readonly organizationSearch: string;
	readonly organizationSearchInputRef: RefObject<HTMLInputElement | null>;
	readonly organizationSelectionCount: number;
	readonly organizationSelectionGuidance: string;
	readonly organizationSelectionMode: StaticFabOrganizationSelectionMode;
	readonly organizationSemanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>;
	readonly projectBusy: boolean;
	readonly reloadSelectedStaticFabOrganizationDetails: () => void;
	readonly removeSelectedStaticFabOrganization: () => void;
	readonly renameSelectedStaticFabOrganization: () => void;
	readonly requestContextualBlueprintSave: (
		request?: ContextualBlueprintSaveRequest,
		trigger?: HTMLElement | null,
		initialDestination?: ContextualBlueprintSaveDestination,
	) => boolean;
	readonly saveSelectedStaticFabOrganizationDetails: () => void;
	readonly selectedOrganizationDescendantCount: number;
	readonly selectedOrganizationId: number | null;
	readonly selectedOrganizationIds: readonly number[];
	readonly selectedStaticFabOrganization: StaticFabOrganizationRecord | null;
	readonly selectedStaticFabOrganizationChildCount: number;
	readonly selectedStaticFabOrganizationVisible: boolean;
	readonly setOrganizationColorDraft: (color: StaticFabOrganizationColor) => void;
	readonly setOrganizationDescriptionDraft: (value: string) => void;
	readonly setOrganizationDetailsError: (error: string | null) => void;
	readonly setOrganizationDetailTab: (tab: OrganizationDetailTab) => void;
	readonly setOrganizationParentSearch: (value: string) => void;
	readonly setOrganizationRenameDraft: (value: string) => void;
	readonly showSelectedStaticFabOrganizationOnMap: (
		mode?: StaticFabOrganizationSelectionMode,
	) => void;
	readonly startProcessLoopRailEdit: (organizationId: number) => boolean;
	readonly startStaticFabArrangement: (
		selectionModeOverride?: StaticFabOrganizationSelectionMode,
	) => void;
	readonly startStaticFabAssemblyConnector: () => void;
	readonly startStaticFabOrganizationSelection: () => void;
	readonly staticFabCheckIssueCount: number;
	readonly staticFabChecksUnavailableMessage: string | null;
	readonly staticFabExclusiveCommandActive: boolean;
	readonly StaticFabOrganizationKindIcon: (
		props: Readonly<{ kind: StaticFabOrganizationKind; size: number }>,
	) => ReactElement;
	readonly staticFabOrganizationKindLabelForFilter: (
		kind: StaticFabOrganizationKind | "ALL",
	) => string;
	readonly staticFabOrganizationKindShortLabel: (kind: StaticFabOrganizationKind | "ALL") => string;
	readonly staticFabOrganizationKindTabLabel: (kind: StaticFabOrganizationKind | "ALL") => string;
	readonly staticFabOrganizationParentIds: (
		record: StaticFabOrganizationRecord,
	) => readonly number[];
	readonly staticFabOrganizationSemanticRoleLabel: (
		role: StaticFabOrganizationSemanticRole | undefined,
	) => string | null;
	readonly toggleStaticFabOrganizationParent: (parentId: number) => void;
	readonly updateStaticFabOrganizationSearch: (value: string) => void;
}

export function StaticFabOrganizationLibrary({
	view,
	onOpenDetails,
	onShowList,
	bayFlowSupport,
	bankDetachSupport,
	bankDeleteSupport,
	assemblyConnectorAvailability,
	assemblyConnectorHierarchyRole,
	assemblyConnectorPurpose,
	centerNavigatorWorld,
	chooseOrganizationSelectionMode,
	chooseStaticFabNavigatorTab,
	chooseStaticFabOrganizationFilter,
	closeStaticFabNavigator,
	openSelectedStructureCommands,
	copySelectionToRailClipboard,
	currentStaticFabInspectionPending,
	equipmentGroupCount,
	filteredStaticFabOrganizations,
	organizationPageStart,
	organizationMatchCount,
	onChangeOrganizationPage,
	fitMap,
	focusedIssueId,
	getNavigatorViewportBounds,
	guidedBuildNavigatorCloseTarget,
	guidedBuildNavigatorCloseTargetId,
	guidedBuildOrganizationNextRecordId,
	guidedBuildOrganizationPickerActive,
	guidedBuildOrganizationPickerSelectionCount,
	guidedBuildOrganizationRowOwnsNextStep,
	guidedBuildOrganizationRowTargetId,
	guidedBuildOrganizationSelectionTargetCount,
	handleOrganizationDetailTabKeyDown,
	handleStaticFabOrganizationClick,
	handleStaticFabOrganizationFilterKeyDown,
	handleStaticFabOrganizationOptionKeyDown,
	handleStaticFabOrganizationSearchKeyDown,
	inspectStaticFabEquipment,
	modelSyncPending,
	navigatorIssueMarkers,
	navigatorModel,
	organizationColorDraft,
	organizationCount,
	organizationDescriptionDraft,
	organizationDetailsDirty,
	organizationDetailsError,
	organizationDetailsStale,
	organizationDetailTab,
	organizationDetailTabs: ORGANIZATION_DETAIL_TABS,
	organizationEditorDirty,
	organizationEditorRef,
	organizationFilter,
	organizationFilters: STATIC_FAB_ORGANIZATION_FILTERS,
	organizationKindCounts,
	organizationListRef,
	organizationParentCandidateCount,
	organizationParentCandidates,
	organizationParentIdsDraft,
	organizationParentSearch,
	organizationRelationshipBlockedIds,
	organizationRenameDraft,
	organizationSearch,
	organizationSearchInputRef,
	organizationSelectionCount,
	organizationSelectionGuidance,
	organizationSelectionMode,
	organizationSemanticRoles,
	projectBusy,
	reloadSelectedStaticFabOrganizationDetails,
	removeSelectedStaticFabOrganization,
	renameSelectedStaticFabOrganization,
	requestContextualBlueprintSave,
	saveSelectedStaticFabOrganizationDetails,
	selectedOrganizationDescendantCount,
	selectedOrganizationId,
	selectedOrganizationIds,
	selectedStaticFabOrganization,
	selectedStaticFabOrganizationChildCount,
	selectedStaticFabOrganizationVisible,
	setOrganizationColorDraft,
	setOrganizationDescriptionDraft,
	setOrganizationDetailsError,
	setOrganizationDetailTab,
	setOrganizationParentSearch,
	setOrganizationRenameDraft,
	showSelectedStaticFabOrganizationOnMap,
	startProcessLoopRailEdit,
	startStaticFabArrangement,
	startStaticFabAssemblyConnector,
	startStaticFabOrganizationSelection,
	staticFabCheckIssueCount,
	staticFabChecksUnavailableMessage,
	staticFabExclusiveCommandActive,
	StaticFabOrganizationKindIcon,
	staticFabOrganizationKindLabelForFilter,
	staticFabOrganizationKindShortLabel,
	staticFabOrganizationKindTabLabel,
	staticFabOrganizationParentIds,
	staticFabOrganizationSemanticRoleLabel,
	toggleStaticFabOrganizationParent,
	updateStaticFabOrganizationSearch,
}: StaticFabOrganizationLibraryProps): ReactElement {
	const detailVisible =
		view === "detail" && !!selectedStaticFabOrganization && !guidedBuildOrganizationPickerActive;
	const bankReviewBlocked =
		bankDetachSupport?.state === "blocked" && bankDeleteSupport?.state === "blocked";
	const reuseActions = (
		<details
			className="tilefab-organization-reuse"
			open={organizationSelectionCount > 1 || undefined}
		>
			<summary>복사·청사진 {organizationSelectionCount > 1 ? "· 연결·정렬" : ""}</summary>

			<fieldset
				className="tilefab-segmented tilefab-organization-selection-mode"
				aria-label="조직 청사진 포함 범위"
				aria-describedby="tilefab-organization-copy-scope-description"
			>
				<button
					type="button"
					data-active={organizationSelectionMode === "DIRECT"}
					aria-pressed={organizationSelectionMode === "DIRECT"}
					title="선택한 조직 자체만 포함"
					onClick={() => chooseOrganizationSelectionMode("DIRECT")}
				>
					선택 조직만
				</button>
				<button
					type="button"
					data-active={organizationSelectionMode === "EFFECTIVE"}
					aria-pressed={organizationSelectionMode === "EFFECTIVE"}
					title="선택한 조직과 모든 하위 조직 포함"
					onClick={() => chooseOrganizationSelectionMode("EFFECTIVE")}
				>
					하위 조직 포함
				</button>
			</fieldset>
			<p
				id="tilefab-organization-copy-scope-description"
				className="tilefab-organization-scope-description"
			>
				{organizationSelectionMode === "DIRECT"
					? "선택한 조직에 직접 속한 레일과 장비만 포함합니다."
					: "하위 조직의 레일과 장비까지 함께 포함합니다."}
			</p>
			<div
				className="tilefab-organization-selection-actions"
				data-count={organizationSelectionCount}
			>
				<button
					type="button"
					onClick={() => showSelectedStaticFabOrganizationOnMap(organizationSelectionMode)}
				>
					<Crosshair size={15} /> 지도 보기
				</button>

				<button
					type="button"
					disabled={modelSyncPending || organizationEditorDirty || organizationDetailsStale}
					className="tilefab-organization-copy"
					onClick={copySelectionToRailClipboard}
				>
					<Copy size={15} /> 복사·배치
				</button>
				<button
					type="button"
					data-testid="save-organization-blueprint"
					title="선택한 조직을 재사용 청사진으로 저장 · 전체 파일은 상단 프로젝트 저장 (.openfab)"
					disabled={modelSyncPending || organizationEditorDirty || organizationDetailsStale}
					onClick={(event) => requestContextualBlueprintSave("organization", event.currentTarget)}
				>
					<Save size={15} /> 청사진 저장
				</button>
				{organizationSelectionCount > 1 ? (
					<div className="tilefab-organization-pair-actions">
						<button
							type="button"
							data-testid="connect-static-fab-assemblies"
							aria-keyshortcuts="J"
							disabled={assemblyConnectorAvailability.state !== "ready"}
							onClick={startStaticFabAssemblyConnector}
							title={assemblyConnectorAvailability.reason}
						>
							<Link2 size={15} />{" "}
							{assemblyConnectorPurpose === "FAB_LOOP"
								? "ADD FAB LOOP"
								: assemblyConnectorHierarchyRole === "BANK_TO_FAB"
									? "CONNECT BANKS"
									: "CONNECT BAYS"}
						</button>
						<button
							type="button"
							data-testid="arrange-static-fab-organizations"
							aria-keyshortcuts="L"
							disabled={modelSyncPending || organizationEditorDirty || organizationDetailsStale}
							onClick={() => startStaticFabArrangement()}
							title="선택한 조직 루트를 정렬하거나 균등 분배 · L"
						>
							<ArrowLeftRight size={15} /> ARRANGE
						</button>
					</div>
				) : null}
			</div>
		</details>
	);
	return (
		<aside
			id="tilefab-fab-navigator"
			className="tilefab-organization-library"
			data-testid="static-fab-organization-library"
			data-count={organizationCount}
			data-view={detailVisible ? "detail" : "list"}
			data-filter={organizationFilter}
			data-guided-picker={guidedBuildOrganizationPickerActive ? "true" : undefined}
			aria-label="저장된 정적 FAB 조직"
		>
			<header>
				<span>
					<MapPinned size={15} />
					<strong>FAB ORGANIZATION</strong>
					<small>
						{guidedBuildOrganizationPickerSelectionCount === null
							? organizationCount
							: guidedBuildOrganizationSelectionTargetCount === null
								? `${guidedBuildOrganizationPickerSelectionCount} 선택`
								: `${guidedBuildOrganizationPickerSelectionCount} / ${guidedBuildOrganizationSelectionTargetCount} 선택`}
					</small>
				</span>
				<button
					type="button"
					className="tilefab-navigator-close"
					aria-label="FAB 조직 라이브러리 닫기"
					data-guided-action-id={
						guidedBuildNavigatorCloseTarget ? guidedBuildNavigatorCloseTargetId : undefined
					}
					data-guided-target={guidedBuildNavigatorCloseTarget || undefined}
					aria-describedby={
						guidedBuildNavigatorCloseTarget
							? "tilefab-guided-primary-target-description"
							: undefined
					}
					onClick={closeStaticFabNavigator}
				>
					<X size={15} />
				</button>
			</header>
			<StaticFabNavigator
				tab="organizations"
				model={navigatorModel}
				preparing={currentStaticFabInspectionPending}
				selectedOrganizationIds={selectedOrganizationIds}
				organizationMode={organizationSelectionMode}
				issues={navigatorIssueMarkers}
				totalIssueCount={staticFabCheckIssueCount}
				equipmentGroupCount={equipmentGroupCount}
				equipmentActionDisabled={projectBusy || modelSyncPending || staticFabExclusiveCommandActive}
				unavailableMessage={staticFabChecksUnavailableMessage}
				focusedIssueId={focusedIssueId}
				getViewportBounds={getNavigatorViewportBounds}
				onTabChange={chooseStaticFabNavigatorTab}
				onCenterWorld={centerNavigatorWorld}
				onFitAll={fitMap}
				onInspectEquipment={inspectStaticFabEquipment}
			/>
			<div
				className="tilefab-navigator-tabpanel tilefab-navigator-tabpanel--organizations"
				role="tabpanel"
				id="tilefab-fab-navigator-panel-organizations"
				aria-labelledby="tilefab-fab-navigator-tab-organizations"
			>
				{!detailVisible ? (
					<div className="tilefab-organization-browser">
						<div className="tilefab-organization-filters" role="tablist" aria-label="조직 종류">
							{STATIC_FAB_ORGANIZATION_FILTERS.map((kind, index) => {
								const count =
									kind === "ALL" ? organizationCount : (organizationKindCounts.get(kind) ?? 0);
								return (
									<button
										key={kind}
										type="button"
										role="tab"
										id={`tilefab-organization-filter-${kind.toLocaleLowerCase("en-US")}`}
										aria-label={`${staticFabOrganizationKindShortLabel(kind)} ${count}`}
										aria-controls="tilefab-organization-list"
										aria-selected={organizationFilter === kind}
										data-active={organizationFilter === kind}
										tabIndex={organizationFilter === kind ? 0 : -1}
										title={staticFabOrganizationKindLabelForFilter(kind)}
										onClick={() => chooseStaticFabOrganizationFilter(kind)}
										onKeyDown={(event) => handleStaticFabOrganizationFilterKeyDown(event, index)}
									>
										<span>{staticFabOrganizationKindTabLabel(kind)}</span>
										<small>{count}</small>
									</button>
								);
							})}
						</div>
						<label className="tilefab-organization-search">
							<Search size={14} />
							<input
								ref={organizationSearchInputRef}
								value={organizationSearch}
								placeholder="이름으로 조직 찾기"
								aria-label="저장된 FAB 조직 검색"
								onChange={(event) => updateStaticFabOrganizationSearch(event.currentTarget.value)}
								onKeyDown={handleStaticFabOrganizationSearchKeyDown}
							/>
						</label>
						<section
							className="tilefab-organization-selection-toolbar"
							data-count={organizationSelectionCount}
							aria-label="선택한 FAB 조직 청사진 작업"
						>
							<div
								className="tilefab-organization-selection-summary"
								data-testid="static-fab-organization-selection-summary"
							>
								<strong>
									{organizationSelectionCount === 1
										? selectedStaticFabOrganization?.name
										: `선택 조직 ${organizationSelectionCount.toLocaleString()}개`}
								</strong>
								<span>{organizationDetailsError ?? organizationSelectionGuidance}</span>
								{selectedStaticFabOrganization ? (
									<button
										type="button"
										className="tilefab-organization-detail-jump"
										onClick={onOpenDetails}
									>
										세부 편집
									</button>
								) : null}
							</div>
							{organizationSelectionCount > 0 ? reuseActions : null}
						</section>
						{organizationMatchCount > filteredStaticFabOrganizations.length ? (
							<nav className="tilefab-organization-pagination" aria-label="조직 목록 페이지">
								<span className="tilefab-organization-page-range" role="status">
									{(organizationPageStart + 1).toLocaleString()}–
									{(organizationPageStart + filteredStaticFabOrganizations.length).toLocaleString()}{" "}
									/ {organizationMatchCount.toLocaleString()}개
								</span>
								<button
									type="button"
									aria-label="이전 조직 목록"
									className="tilefab-organization-page-button"
									disabled={organizationPageStart === 0}
									onClick={() => onChangeOrganizationPage(-1)}
								>
									<ArrowLeft size={14} aria-hidden="true" /> 이전
								</button>
								<button
									type="button"
									aria-label="다음 조직 목록"
									className="tilefab-organization-page-button"
									disabled={
										organizationPageStart + filteredStaticFabOrganizations.length >=
										organizationMatchCount
									}
									onClick={() => onChangeOrganizationPage(1)}
								>
									다음 <ChevronRight size={14} aria-hidden="true" />
								</button>
							</nav>
						) : null}
						<div
							id="tilefab-organization-list"
							ref={organizationListRef}
							className="tilefab-organization-list"
							role="listbox"
							aria-multiselectable="true"
							aria-label="FAB 조직 목록"
						>
							{filteredStaticFabOrganizations.length === 0 ? (
								<div className="tilefab-organization-empty">
									<MapPinned size={20} />
									<strong>
										{organizationCount === 0 ? "NO SAVED ORGANIZATION" : "NO MATCHING ORGANIZATION"}
									</strong>
									<small>
										{organizationCount === 0
											? "범위를 선택한 뒤 AREA, BAY, AISLE 또는 PROCESS FAMILY로 분류하세요."
											: "필터나 검색어를 지우면 저장된 조직을 다시 볼 수 있습니다."}
									</small>
									<button
										type="button"
										onClick={() => {
											if (organizationCount === 0) {
												startStaticFabOrganizationSelection();
											} else {
												updateStaticFabOrganizationSearch("");
												chooseStaticFabOrganizationFilter("ALL");
												requestAnimationFrame(() => organizationSearchInputRef.current?.focus());
											}
										}}
									>
										{organizationCount === 0 ? "START ORGANIZATION SELECTION" : "SHOW ALL"}
									</button>
								</div>
							) : (
								filteredStaticFabOrganizations.map((record, index) => {
									const organizationSelected = selectedOrganizationIds.includes(record.id);
									const guidedSelectionTarget =
										guidedBuildOrganizationRowOwnsNextStep &&
										guidedBuildOrganizationNextRecordId === record.id;
									return (
										<button
											key={record.id}
											type="button"
											role="option"
											id={`static-fab-organization-${record.id}`}
											data-testid="static-fab-organization-item"
											data-organization-id={record.id}
											data-organization-name={record.name}
											data-active={selectedOrganizationId === record.id}
											data-selected={organizationSelected}
											data-guided-target={guidedSelectionTarget || undefined}
											data-guided-action-id={
												guidedSelectionTarget
													? (guidedBuildOrganizationRowTargetId ?? undefined)
													: undefined
											}
											aria-selected={organizationSelected}
											aria-describedby={
												guidedSelectionTarget
													? "tilefab-guided-primary-target-description"
													: undefined
											}
											tabIndex={
												guidedBuildOrganizationRowOwnsNextStep
													? guidedSelectionTarget
														? 0
														: -1
													: selectedOrganizationId === record.id ||
															(!selectedStaticFabOrganizationVisible && index === 0)
														? 0
														: -1
											}
											onClick={(event) => handleStaticFabOrganizationClick(event, record)}
											onKeyDown={(event) => handleStaticFabOrganizationOptionKeyDown(event, index)}
										>
											<StaticFabOrganizationKindIcon kind={record.kind} size={15} />
											<span>
												<strong>
													<em>
														{staticFabOrganizationSemanticRoleLabel(
															organizationSemanticRoles.get(record.id),
														) ?? staticFabOrganizationKindShortLabel(record.kind)}
													</em>
													{record.name}
												</strong>
												<small>
													{record.membership.railEdges.length} EDGES ·{" "}
													{record.membership.equipmentGroupIds.length} GROUPS
												</small>
											</span>
											{organizationSelected ? (
												<Check size={15} />
											) : guidedBuildOrganizationPickerActive ? (
												<Plus size={15} aria-hidden="true" />
											) : (
												<ChevronRight size={14} />
											)}
										</button>
									);
								})
							)}
						</div>
					</div>
				) : null}
				{detailVisible && selectedStaticFabOrganization ? (
					<section
						className="tilefab-organization-editor"
						ref={organizationEditorRef}
						data-tab={organizationDetailTab}
						data-dirty={organizationEditorDirty}
					>
						<header>
							<span className="tilefab-organization-detail-identity">
								<strong>{selectedStaticFabOrganization.name}</strong>
								<small>
									{organizationSemanticRoles.get(selectedStaticFabOrganization.id) ===
									"PROCESS_LOOP"
										? "작업 루프 · Process Loop"
										: (staticFabOrganizationSemanticRoleLabel(
												organizationSemanticRoles.get(selectedStaticFabOrganization.id),
											) ?? selectedStaticFabOrganization.kind)}
									-{selectedStaticFabOrganization.id}
								</small>
							</span>
							<button type="button" className="tilefab-organization-return" onClick={onShowList}>
								<ArrowLeft size={14} /> 목록으로
							</button>
							<small>
								{organizationDetailsStale ? "STALE" : organizationEditorDirty ? "UNSAVED" : "SAVED"}
							</small>
						</header>
						<div
							className="tilefab-organization-detail-tabs"
							role="tablist"
							aria-label="FAB 조직 상세"
						>
							{ORGANIZATION_DETAIL_TABS.map((tab, index) => (
								<button
									key={tab}
									type="button"
									role="tab"
									id={`organization-detail-tab-${tab}`}
									aria-controls={`organization-detail-panel-${tab}`}
									aria-selected={organizationDetailTab === tab}
									tabIndex={organizationDetailTab === tab ? 0 : -1}
									data-active={organizationDetailTab === tab}
									onClick={() => setOrganizationDetailTab(tab)}
									onKeyDown={(event) => handleOrganizationDetailTabKeyDown(event, index)}
								>
									{tab === "overview"
										? "OVERVIEW"
										: tab === "relations"
											? "RELATIONS"
											: "PROPERTIES"}
								</button>
							))}
						</div>
						{organizationDetailTab === "overview" ? (
							<div
								className="tilefab-organization-detail-panel"
								role="tabpanel"
								id="organization-detail-panel-overview"
								aria-labelledby="organization-detail-tab-overview"
							>
								{organizationSelectionCount === 1 &&
								["BAY_BANK", "FAB", "BAY"].includes(
									organizationSemanticRoles.get(selectedStaticFabOrganization.id) ?? "",
								) ? (
									<div className="tilefab-organization-editor-actions">
										<button
											type="button"
											data-testid={
												organizationSemanticRoles.get(selectedStaticFabOrganization.id) === "FAB"
													? "organization-open-fab-commands"
													: organizationSemanticRoles.get(selectedStaticFabOrganization.id) ===
															"BAY_BANK"
														? "organization-open-bank-commands"
														: "organization-open-bay-commands"
											}
											disabled={
												projectBusy ||
												modelSyncPending ||
												staticFabExclusiveCommandActive ||
												organizationEditorDirty ||
												organizationDetailsStale ||
												bankReviewBlocked ||
												bayFlowSupport?.state === "blocked"
											}
											aria-describedby={
												bayFlowSupport?.state === "blocked"
													? "organization-bay-flow-support"
													: undefined
											}
											onClick={() =>
												openSelectedStructureCommands(selectedStaticFabOrganization.id)
											}
										>
											{organizationSemanticRoles.get(selectedStaticFabOrganization.id) === "FAB"
												? "FAB 삭제 검토"
												: organizationSemanticRoles.get(selectedStaticFabOrganization.id) ===
														"BAY_BANK"
													? "Bank 분리·삭제 검토"
													: "Bay 흐름 편집"}{" "}
											<ChevronRight size={14} />
										</button>
									</div>
								) : null}
								{bayFlowSupport ? (
									<>
										{bayFlowSupport.state === "blocked" ? (
											<div
												className="tilefab-organization-support tilefab-organization-support-with-info"
												data-testid="organization-bay-flow-support"
												id="organization-bay-flow-support"
											>
												<p>{bayFlowSupport.reason}</p>
												{bayFlowSupport.detail ? (
													<EditorInfoPopover
														key={selectedStaticFabOrganization.id}
														label="흐름 변경 지원 안내"
														text={bayFlowSupport.detail}
													/>
												) : null}
											</div>
										) : null}
										<div className="tilefab-organization-editor-actions">
											<button
												type="button"
												data-testid="organization-open-bay-connection-commands"
												disabled={
													projectBusy ||
													modelSyncPending ||
													staticFabExclusiveCommandActive ||
													organizationEditorDirty ||
													organizationDetailsStale
												}
												onClick={() =>
													openSelectedStructureCommands(selectedStaticFabOrganization.id)
												}
											>
												Bay 연결·삭제 검토 <ChevronRight size={14} />
											</button>
										</div>
									</>
								) : null}
								{bankReviewBlocked ? (
									<p
										className="tilefab-organization-support"
										data-testid="organization-bank-editing-support"
									>
										{bankDetachSupport.reason}
										<br />
										{bankDeleteSupport.reason}
									</p>
								) : null}
								<label className="tilefab-organization-field">
									<span>NAME</span>
									<input
										value={organizationRenameDraft}
										maxLength={120}
										aria-label="선택한 FAB 조직 이름"
										onChange={(event) => setOrganizationRenameDraft(event.currentTarget.value)}
										onKeyDown={(event) => {
											if (
												event.key !== "Enter" ||
												event.nativeEvent.isComposing ||
												event.nativeEvent.keyCode === 229
											)
												return;
											event.preventDefault();
											renameSelectedStaticFabOrganization();
										}}
									/>
								</label>
								<dl className="tilefab-organization-coverage">
									<div>
										<dt>직접 소속</dt>
										<dd>
											레일 구간 {selectedStaticFabOrganization.membership.railEdges.length}개 · 장비{" "}
											{selectedStaticFabOrganization.membership.equipmentGroupIds.length}개
										</dd>
									</div>
									<div>
										<dt>하위 조직</dt>
										<dd>{selectedOrganizationDescendantCount}개</dd>
									</div>
									<div>
										<dt>하위 포함</dt>
										<dd>조직 {selectedOrganizationDescendantCount + 1}개</dd>
									</div>
								</dl>

								<div className="tilefab-organization-editor-actions">
									{selectedStaticFabOrganization.kind === "AISLE" &&
									selectedStaticFabOrganization.declaredSemanticRole === "PROCESS_LOOP" &&
									staticFabOrganizationParentIds(selectedStaticFabOrganization).length === 0 ? (
										<button
											type="button"
											data-testid="edit-process-loop-rail"
											disabled={modelSyncPending || staticFabExclusiveCommandActive}
											onClick={() => startProcessLoopRailEdit(selectedStaticFabOrganization.id)}
										>
											작업 루프 레일 편집
										</button>
									) : null}
									<button
										type="button"
										onClick={() => showSelectedStaticFabOrganizationOnMap("DIRECT")}
									>
										<Crosshair size={14} /> 직접 소속 보기
									</button>
									{selectedOrganizationDescendantCount > 0 ? (
										<button
											type="button"
											onClick={() => showSelectedStaticFabOrganizationOnMap("EFFECTIVE")}
										>
											<Layers3 size={14} /> 하위 포함 보기
										</button>
									) : null}
									<button
										type="button"
										disabled={
											modelSyncPending ||
											organizationRenameDraft.trim().length === 0 ||
											organizationRenameDraft.trim() === selectedStaticFabOrganization.name
										}
										onClick={renameSelectedStaticFabOrganization}
									>
										<Save size={14} /> RENAME
									</button>
								</div>
							</div>
						) : organizationDetailTab === "relations" ? (
							<div
								className="tilefab-organization-detail-panel"
								role="tabpanel"
								id="organization-detail-panel-relations"
								aria-labelledby="organization-detail-tab-relations"
							>
								<div className="tilefab-organization-section-heading">
									<span>SAVED PARENTS</span>
									<small>
										{organizationParentIdsDraft.length} SELECTED ·{" "}
										{organizationParentCandidateCount} MATCHES
									</small>
								</div>
								<p
									className="tilefab-organization-relations-scope"
									data-testid="organization-relations-metadata-scope"
									role="note"
								>
									<AlertTriangle size={14} aria-hidden="true" />
									<span>
										<strong>ORGANIZATION ONLY</strong>
										Parent changes do not alter Rail connectors. Semantic geometry detach/delete is
										a separate protected command.
									</span>
								</p>
								<label className="tilefab-organization-field">
									<span>PARENT SEARCH</span>
									<input
										value={organizationParentSearch}
										aria-label="부모 조직 검색"
										placeholder="Search parent organization"
										onChange={(event) => setOrganizationParentSearch(event.currentTarget.value)}
									/>
								</label>
								<div className="tilefab-organization-parent-list">
									{organizationParentCandidates.length === 0 ? (
										<small>NO AVAILABLE ORGANIZATIONS</small>
									) : (
										organizationParentCandidates.map((candidate) => {
											const blocked = organizationRelationshipBlockedIds.has(candidate.id);
											return (
												<label
													key={candidate.id}
													data-blocked={blocked}
													title={blocked ? "하위 조직은 부모로 지정할 수 없습니다" : undefined}
												>
													<input
														type="checkbox"
														checked={organizationParentIdsDraft.includes(candidate.id)}
														disabled={blocked}
														onChange={() => toggleStaticFabOrganizationParent(candidate.id)}
													/>
													<StaticFabOrganizationKindIcon kind={candidate.kind} size={14} />
													<span>
														<strong>{candidate.name}</strong>
														<small>
															{candidate.kind}-{candidate.id}
															{blocked ? " · DESCENDANT" : ""}
														</small>
													</span>
												</label>
											);
										})
									)}
								</div>
							</div>
						) : (
							<div
								className="tilefab-organization-detail-panel"
								role="tabpanel"
								id="organization-detail-panel-properties"
								aria-labelledby="organization-detail-tab-properties"
							>
								<label className="tilefab-organization-field">
									<span>DESCRIPTION</span>
									<textarea
										value={organizationDescriptionDraft}
										maxLength={STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH}
										onChange={(event) => {
											setOrganizationDescriptionDraft(event.currentTarget.value);
											setOrganizationDetailsError(null);
										}}
									/>
									<small>
										{organizationDescriptionDraft.length}/
										{STATIC_FAB_ORGANIZATION_MAX_DESCRIPTION_LENGTH}
									</small>
								</label>
								<fieldset className="tilefab-organization-colors" aria-label="조직 색상">
									<legend>COLOR</legend>
									{STATIC_FAB_ORGANIZATION_COLORS.map((color) => (
										<button
											key={color}
											type="button"
											data-color={color}
											data-active={organizationColorDraft === color}
											aria-label={color}
											aria-pressed={organizationColorDraft === color}
											onClick={() => {
												setOrganizationColorDraft(color);
												setOrganizationDetailsError(null);
											}}
										>
											<span />
										</button>
									))}
								</fieldset>
							</div>
						)}
						{organizationDetailsError ? (
							<div className="tilefab-organization-error" role="alert">
								<AlertTriangle size={14} /> {organizationDetailsError}
							</div>
						) : null}
						{organizationDetailsStale ? (
							<div className="tilefab-organization-stale" role="alert">
								<span>
									<AlertTriangle size={14} /> 편집 기록이 바뀌어 현재 초안을 바로 저장할 수
									없습니다.
								</span>
								<button type="button" onClick={reloadSelectedStaticFabOrganizationDetails}>
									<RefreshCcw size={14} /> RELOAD
								</button>
							</div>
						) : null}
						<div className="tilefab-organization-editor-footer">
							<button
								type="button"
								disabled={modelSyncPending || !organizationDetailsDirty || organizationDetailsStale}
								onClick={saveSelectedStaticFabOrganizationDetails}
							>
								<Save size={14} /> SAVE DETAILS
							</button>
							<button
								type="button"
								className="tilefab-organization-remove"
								disabled={
									modelSyncPending ||
									organizationEditorDirty ||
									organizationDetailsStale ||
									selectedStaticFabOrganizationChildCount > 0
								}
								title={
									selectedStaticFabOrganizationChildCount > 0
										? `먼저 ${selectedStaticFabOrganizationChildCount}개 자식 조직의 부모 관계를 해제하세요`
										: organizationEditorDirty || organizationDetailsStale
											? "관계와 속성 편집을 저장하거나 다시 불러온 뒤 제거하세요"
											: undefined
								}
								onClick={removeSelectedStaticFabOrganization}
							>
								<Trash2 size={14} />
								{selectedStaticFabOrganizationChildCount > 0
									? `${selectedStaticFabOrganizationChildCount} CHILDREN`
									: "REMOVE METADATA"}
							</button>
						</div>
						{reuseActions}
					</section>
				) : null}
			</div>
		</aside>
	);
}
