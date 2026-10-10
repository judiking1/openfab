import {
	AlertTriangle,
	ArchiveRestore,
	Check,
	ChevronRight,
	Copy,
	Download,
	EllipsisVertical,
	FileUp,
	FolderClock,
	FolderOpen,
	GripVertical,
	LibraryBig,
	RefreshCcw,
	Save,
	SaveAll,
	Search,
	Trash2,
	Undo2,
	X,
} from "lucide-react";
import {
	type Dispatch,
	Fragment,
	type DragEvent as ReactDragEvent,
	type ReactElement,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	type SetStateAction,
	useId,
	useMemo,
	useRef,
} from "react";
import { prepareRailModuleBlueprint } from "../core/RailModuleStamp";
import {
	OPENFAB_BLUEPRINT_KIND_STATIC_FAB,
	OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION,
	type OpenFabProjectBlueprint,
} from "../project/OpenFabBlueprintLibrary";
import type {
	OpenFabUserBlueprintLibraryStatus,
	OpenFabUserBlueprintRecord,
	OpenFabUserBlueprintRejectedDiagnostic,
} from "../project/OpenFabUserBlueprintLibrary";
import type { BlueprintPlacementOrigin } from "./BlueprintCommandLoop";
import type {
	BlueprintLibraryTab,
	ContextualBlueprintSaveRequest,
	PendingUserBlueprintImport,
	ProjectBlueprintNameDraft,
	RailClipboardHistoryEntry,
	UserBlueprintMetadataDraft,
} from "./BlueprintLibraryTypes";
import {
	type BlueprintRecordCommandId,
	type BlueprintRecordContextScope,
	type BlueprintRecordContextState,
	type BlueprintRecordContextView,
	filterProjectBlueprintRecords,
	projectBlueprintRenameError,
	type UserBlueprintOrganizationTarget,
} from "./BlueprintRecordContext";
import { BlueprintRecordContextTray, RailBlueprintMiniature } from "./BlueprintRecordPresentation";
import type { ContextualBlueprintSaveDestination } from "./ContextualBlueprintSave";
import type { UserBlueprintLibraryCrossTabRefreshState } from "./UserBlueprintLibraryCrossTabRefreshController";

interface BlueprintLibraryPanelProps {
	readonly projectBlueprintNameDraft: ProjectBlueprintNameDraft | null;
	readonly projectBlueprintNameRef: RefObject<HTMLInputElement | null>;
	readonly setProjectBlueprintNameDraft: Dispatch<SetStateAction<ProjectBlueprintNameDraft | null>>;
	readonly cancelProjectBlueprintRename: () => void;
	readonly saveProjectBlueprintName: () => void;
	readonly areaStampSelectionValid: boolean;
	readonly backupUserBlueprintLibrary: () => Promise<boolean>;
	readonly beginUserBlueprintDrag: (
		event: ReactDragEvent<HTMLElement>,
		record: OpenFabUserBlueprintRecord,
	) => void;
	readonly blueprintLibraryTab: BlueprintLibraryTab;
	readonly blueprintRecentTabRef: RefObject<HTMLButtonElement | null>;
	readonly blueprintRecordContext: BlueprintRecordContextState | null;
	readonly blueprintRecordContextKey: (
		scope: BlueprintRecordContextScope,
		recordId: string,
	) => string;
	readonly blueprintRecordContextRef: RefObject<HTMLDivElement | null>;
	readonly blueprintRecordContextTriggerRefs: RefObject<Map<string, HTMLButtonElement>>;
	readonly blueprintSaveDestination: ContextualBlueprintSaveDestination;
	readonly blueprintSavedTabRef: RefObject<HTMLButtonElement | null>;
	readonly blueprintUserTabRef: RefObject<HTMLButtonElement | null>;
	readonly cancelUserBlueprintImport: () => void;
	readonly cancelUserBlueprintMetadataEdit: () => void;
	readonly chooseBlueprintLibraryTab: (tab: BlueprintLibraryTab) => void;
	readonly chooseRecentRailClipboard: (index: number, place?: boolean) => boolean;
	readonly chooseUserBlueprintFolder: (folderPath: readonly string[]) => void;
	readonly chooseUserBlueprintImport: () => Promise<void>;
	readonly chooseUserBlueprintLibraryRestore: () => Promise<void>;
	readonly closeBlueprintLibrary: (restoreFocus?: boolean) => void;
	readonly closeBlueprintRecordContext: (restoreFocus?: boolean) => void;
	readonly confirmUserBlueprintImport: () => Promise<void>;
	readonly deletedUserBlueprintRecovery: OpenFabUserBlueprintRecord | null;
	readonly displayedUserBlueprintCount: number;
	readonly dragOverUserBlueprintOrganizationTarget: (
		event: ReactDragEvent<HTMLElement>,
		target: UserBlueprintOrganizationTarget,
	) => void;
	readonly dropUserBlueprintOnOrganizationTarget: (
		event: ReactDragEvent<HTMLElement>,
		target: UserBlueprintOrganizationTarget,
	) => void;
	readonly exportRejectedUserBlueprintDiagnostic: (
		diagnostic: OpenFabUserBlueprintRejectedDiagnostic,
	) => Promise<void>;
	readonly finishUserBlueprintDrag: () => void;
	readonly focusBlueprintRecordContextFirstCommand: () => void;
	readonly handleBlueprintLibraryTabKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
	readonly handleBlueprintRecordContextKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	readonly hasRecentBlueprint: boolean;
	readonly leaveUserBlueprintOrganizationTarget: (event: ReactDragEvent<HTMLElement>) => void;
	readonly modelSyncPending: boolean;
	readonly normalizeBlueprintName: (value: string) => string;
	readonly onProjectBlueprintSearchChange: (query: string) => void;
	readonly openBlueprintRecordContext: (
		scope: BlueprintRecordContextScope,
		recordId: string,
		trigger: HTMLButtonElement,
		view?: BlueprintRecordContextView,
	) => void;
	readonly orderedProjectBlueprints: readonly OpenFabProjectBlueprint[];
	readonly pendingUserBlueprintDeleteId: string | null;
	readonly pendingUserBlueprintImport: PendingUserBlueprintImport | null;
	readonly pendingUserBlueprintImportPreview: Readonly<{
		folderPath: readonly string[];
		name: string;
		idCollision: boolean;
		quickSlotCollision: boolean;
	}> | null;
	readonly placeProjectBlueprint: (
		record: OpenFabProjectBlueprint,
		origin?: Extract<BlueprintPlacementOrigin, "library" | "favorite">,
		fromUserLibraryRecord?: boolean,
	) => void;
	readonly projectBlueprintCount: number;
	readonly projectBlueprintSearch: string;
	readonly projectBusy: boolean;
	readonly recentRailClipboardActiveIndex: number;
	readonly recentRailClipboards: readonly RailClipboardHistoryEntry[];
	readonly refreshUserBlueprintLibrary: (
		signal?: AbortSignal,
	) => Promise<readonly OpenFabUserBlueprintRecord[]>;
	readonly requestContextualBlueprintSave: (
		request?: ContextualBlueprintSaveRequest,
		trigger?: HTMLElement | null,
		initialDestination?: ContextualBlueprintSaveDestination,
	) => boolean;
	readonly resolveBlueprintRecordContextTrigger: (
		target: EventTarget | null,
		scope: BlueprintRecordContextScope,
		recordId: string,
	) => HTMLButtonElement | null;
	readonly restoreDeletedUserBlueprint: () => Promise<void>;
	readonly revealMoreUserBlueprints: () => void;
	readonly runProjectBlueprintRecordCommand: (
		commandId: BlueprintRecordCommandId,
		record: OpenFabProjectBlueprint,
	) => void;
	readonly runUserBlueprintRecordCommand: (
		commandId: BlueprintRecordCommandId,
		record: OpenFabUserBlueprintRecord,
	) => void;
	readonly saveUserBlueprintMetadata: () => Promise<void>;
	readonly selectedOrganizationCount: number;
	readonly setBlueprintRecordContext: Dispatch<SetStateAction<BlueprintRecordContextState | null>>;
	readonly setDeletedUserBlueprintRecovery: (value: OpenFabUserBlueprintRecord | null) => void;
	readonly setPendingUserBlueprintDeleteId: (id: string | null) => void;
	readonly setPendingUserBlueprintImport: Dispatch<
		SetStateAction<PendingUserBlueprintImport | null>
	>;
	readonly setStatus: (message: string) => void;
	readonly setUserBlueprintMetadataDraft: Dispatch<
		SetStateAction<UserBlueprintMetadataDraft | null>
	>;
	readonly setUserBlueprintSearch: (value: string) => void;
	readonly setUserBlueprintVisibleLimit: (limit: number) => void;
	readonly updateUserBlueprintQuickSlot: (
		record: OpenFabUserBlueprintRecord,
		quickSlot: number | null,
	) => Promise<void>;
	readonly userBlueprintChildFolders: readonly Readonly<{
		name: string;
		count: number;
		path: readonly string[];
	}>[];
	readonly userBlueprintCount: number;
	readonly userBlueprintCrossTabRefresh: UserBlueprintLibraryCrossTabRefreshState;
	readonly userBlueprintFolderPath: readonly string[];
	readonly userBlueprintImportButtonRef: RefObject<HTMLButtonElement | null>;
	readonly userBlueprintImportNameRef: RefObject<HTMLInputElement | null>;
	readonly userBlueprintLibraryBusy: string | null;
	readonly userBlueprintLibraryRestoreButtonRef: RefObject<HTMLButtonElement | null>;
	readonly userBlueprintLibraryRestoreCancelButtonRef: RefObject<HTMLButtonElement | null>;
	readonly userBlueprintLibraryRestoreControllerRef: RefObject<AbortController | null>;
	readonly userBlueprintLibrarySafetyBlockedReason: string | null;
	readonly userBlueprintMetadataDraft: UserBlueprintMetadataDraft | null;
	readonly userBlueprintMetadataNameRef: RefObject<HTMLInputElement | null>;
	readonly userBlueprintPanelRef: RefObject<HTMLElement | null>;
	readonly userBlueprintQuickSlotEntries: readonly Readonly<{
		slot: number;
		record: OpenFabUserBlueprintRecord | null;
	}>[];
	readonly userBlueprintQuickSlotOwners: ReadonlyMap<number, string>;
	readonly userBlueprintQuickSlots: readonly number[];
	readonly userBlueprintRecordRefs: RefObject<Map<string, HTMLElement>>;
	readonly userBlueprintRejectedDiagnostics: readonly OpenFabUserBlueprintRejectedDiagnostic[];
	readonly userBlueprintRootFolderDropTarget: UserBlueprintOrganizationTarget;
	readonly userBlueprintSearch: string;
	readonly userBlueprintStorageStatus: OpenFabUserBlueprintLibraryStatus;
	readonly userBlueprintTrashDropTarget: UserBlueprintOrganizationTarget;
	readonly userBlueprintVisiblePageSize: number;
	readonly visibleUserBlueprints: readonly OpenFabUserBlueprintRecord[];
	readonly wholeMapBlueprintAvailable: boolean;
}

export function BlueprintLibraryPanel({
	projectBlueprintNameDraft,
	projectBlueprintNameRef,
	setProjectBlueprintNameDraft,
	cancelProjectBlueprintRename,
	saveProjectBlueprintName,
	areaStampSelectionValid,
	backupUserBlueprintLibrary,
	beginUserBlueprintDrag,
	blueprintLibraryTab,
	blueprintRecentTabRef,
	blueprintRecordContext,
	blueprintRecordContextKey,
	blueprintRecordContextRef,
	blueprintRecordContextTriggerRefs,
	blueprintSaveDestination,
	blueprintSavedTabRef,
	blueprintUserTabRef,
	cancelUserBlueprintImport,
	cancelUserBlueprintMetadataEdit,
	chooseBlueprintLibraryTab,
	chooseRecentRailClipboard,
	chooseUserBlueprintFolder,
	chooseUserBlueprintImport,
	chooseUserBlueprintLibraryRestore,
	closeBlueprintLibrary,
	closeBlueprintRecordContext,
	confirmUserBlueprintImport,
	deletedUserBlueprintRecovery,
	displayedUserBlueprintCount,
	dragOverUserBlueprintOrganizationTarget,
	dropUserBlueprintOnOrganizationTarget,
	exportRejectedUserBlueprintDiagnostic,
	finishUserBlueprintDrag,
	focusBlueprintRecordContextFirstCommand,
	handleBlueprintLibraryTabKeyDown,
	handleBlueprintRecordContextKeyDown,
	hasRecentBlueprint,
	leaveUserBlueprintOrganizationTarget,
	modelSyncPending,
	normalizeBlueprintName,
	onProjectBlueprintSearchChange,
	openBlueprintRecordContext,
	orderedProjectBlueprints,
	pendingUserBlueprintDeleteId,
	pendingUserBlueprintImport,
	pendingUserBlueprintImportPreview,
	placeProjectBlueprint,
	projectBlueprintCount,
	projectBlueprintSearch,
	projectBusy,
	recentRailClipboardActiveIndex,
	recentRailClipboards,
	refreshUserBlueprintLibrary,
	requestContextualBlueprintSave,
	resolveBlueprintRecordContextTrigger,
	restoreDeletedUserBlueprint,
	revealMoreUserBlueprints,
	runProjectBlueprintRecordCommand,
	runUserBlueprintRecordCommand,
	saveUserBlueprintMetadata,
	selectedOrganizationCount,
	setBlueprintRecordContext,
	setDeletedUserBlueprintRecovery,
	setPendingUserBlueprintDeleteId,
	setPendingUserBlueprintImport,
	setStatus,
	setUserBlueprintMetadataDraft,
	setUserBlueprintSearch,
	setUserBlueprintVisibleLimit,
	updateUserBlueprintQuickSlot,
	userBlueprintChildFolders,
	userBlueprintCount,
	userBlueprintCrossTabRefresh,
	userBlueprintFolderPath,
	userBlueprintImportButtonRef,
	userBlueprintImportNameRef,
	userBlueprintLibraryBusy,
	userBlueprintLibraryRestoreButtonRef,
	userBlueprintLibraryRestoreCancelButtonRef,
	userBlueprintLibraryRestoreControllerRef,
	userBlueprintLibrarySafetyBlockedReason,
	userBlueprintMetadataDraft,
	userBlueprintMetadataNameRef,
	userBlueprintPanelRef,
	userBlueprintQuickSlotEntries,
	userBlueprintQuickSlotOwners,
	userBlueprintQuickSlots: USER_BLUEPRINT_QUICK_SLOTS,
	userBlueprintRecordRefs,
	userBlueprintRejectedDiagnostics,
	userBlueprintRootFolderDropTarget,
	userBlueprintSearch,
	userBlueprintStorageStatus,
	userBlueprintTrashDropTarget,
	userBlueprintVisiblePageSize: USER_BLUEPRINT_VISIBLE_PAGE_SIZE,
	visibleUserBlueprints,
	wholeMapBlueprintAvailable,
}: BlueprintLibraryPanelProps): ReactElement {
	const projectBlueprintSearchRef = useRef<HTMLInputElement>(null);
	const recentModuleBlueprints = useMemo(
		() =>
			new Map(
				recentRailClipboards.flatMap(({ id, clipboard }) =>
					clipboard.kind === "module"
						? [[id, prepareRailModuleBlueprint(clipboard.template)] as const]
						: [],
				),
			),
		[recentRailClipboards],
	);
	const visibleProjectBlueprints = useMemo(
		() => filterProjectBlueprintRecords(orderedProjectBlueprints, projectBlueprintSearch),
		[orderedProjectBlueprints, projectBlueprintSearch],
	);
	return (
		<aside
			id="tilefab-blueprint-library"
			className="tilefab-blueprint-library"
			data-testid="blueprint-library"
			data-tab={blueprintLibraryTab}
			aria-label="OpenFab 청사진 라이브러리"
			onPointerDownCapture={(event) => {
				if (!blueprintRecordContext) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				if (
					target.closest(
						'[data-testid="blueprint-record-context"], [data-testid="blueprint-record-menu"], [data-testid="user-blueprint-record-menu"], .tilefab-blueprint-record-drag',
					)
				) {
					return;
				}
				setBlueprintRecordContext(null);
				setPendingUserBlueprintDeleteId(null);
			}}
		>
			<header>
				<span>
					<LibraryBig size={15} />
					<strong>BLUEPRINT LIBRARY</strong>
				</span>
				<button
					type="button"
					aria-label="청사진 라이브러리 닫기"
					onClick={() => closeBlueprintLibrary()}
				>
					<X size={14} />
				</button>
			</header>
			<div className="tilefab-blueprint-tabs" aria-label="청사진 보기" role="tablist">
				<button
					ref={blueprintSavedTabRef}
					id="tilefab-blueprint-tab-saved"
					type="button"
					role="tab"
					aria-selected={blueprintLibraryTab === "saved"}
					aria-controls="tilefab-blueprint-panel-saved"
					tabIndex={blueprintLibraryTab === "saved" ? 0 : -1}
					data-active={blueprintLibraryTab === "saved"}
					onClick={() => chooseBlueprintLibraryTab("saved")}
					onKeyDown={handleBlueprintLibraryTabKeyDown}
				>
					<LibraryBig size={14} />
					PROJECT
					<small>{projectBlueprintCount}</small>
				</button>
				<button
					ref={blueprintUserTabRef}
					id="tilefab-blueprint-tab-user"
					type="button"
					role="tab"
					aria-selected={blueprintLibraryTab === "user"}
					aria-controls="tilefab-blueprint-panel-user"
					tabIndex={blueprintLibraryTab === "user" ? 0 : -1}
					data-active={blueprintLibraryTab === "user"}
					data-testid="blueprint-user-tab"
					onClick={() => chooseBlueprintLibraryTab("user")}
					onKeyDown={handleBlueprintLibraryTabKeyDown}
				>
					<FolderOpen size={14} />
					BROWSER LOCAL
					<small>{userBlueprintCount}</small>
				</button>
				<button
					ref={blueprintRecentTabRef}
					id="tilefab-blueprint-tab-recent"
					type="button"
					role="tab"
					aria-selected={blueprintLibraryTab === "recent"}
					aria-controls="tilefab-blueprint-panel-recent"
					tabIndex={blueprintLibraryTab === "recent" ? 0 : -1}
					data-active={blueprintLibraryTab === "recent"}
					data-testid="blueprint-recent-tab"
					onClick={() => chooseBlueprintLibraryTab("recent")}
					onKeyDown={handleBlueprintLibraryTabKeyDown}
				>
					<FolderClock size={14} />
					RECENT
					<small>{recentRailClipboards.length}</small>
				</button>
			</div>
			<p className="tilefab-blueprint-storage-note" data-testid="blueprint-storage-note">
				{blueprintLibraryTab === "saved"
					? "PROJECT · 프로젝트 저장 시 .openfab 파일에 포함됩니다"
					: blueprintLibraryTab === "user"
						? "BROWSER LOCAL · 이 브라우저에 별도 보관 · 프로젝트 파일에는 포함되지 않습니다"
						: "RECENT · 이번 세션의 복사 기록 · 파일에 저장되지 않습니다"}
			</p>
			<section
				className="tilefab-blueprint-save"
				data-ready={areaStampSelectionValid || selectedOrganizationCount > 0}
				data-destination={blueprintSaveDestination}
			>
				<div className="tilefab-blueprint-save-actions">
					<button
						type="button"
						disabled={
							(!areaStampSelectionValid && selectedOrganizationCount === 0) ||
							projectBusy ||
							modelSyncPending ||
							userBlueprintLibraryBusy !== null
						}
						data-testid="save-area-blueprint"
						onClick={(event) =>
							requestContextualBlueprintSave(
								"context",
								event.currentTarget,
								blueprintSaveDestination,
							)
						}
						title="선택한 레일·장비 또는 FAB 조직의 저장 옵션 열기"
					>
						<Save size={14} /> 선택을 청사진으로 저장
					</button>
					<button
						type="button"
						disabled={
							!wholeMapBlueprintAvailable ||
							projectBusy ||
							modelSyncPending ||
							userBlueprintLibraryBusy !== null
						}
						data-testid="save-whole-map-blueprint"
						onClick={(event) =>
							requestContextualBlueprintSave(
								"whole-map",
								event.currentTarget,
								blueprintSaveDestination,
							)
						}
						title={
							wholeMapBlueprintAvailable
								? `현재 정적 FAB 전체를 ${
										blueprintSaveDestination === "project" ? "프로젝트" : "내 라이브러리"
									} 청사진으로 저장`
								: "저장할 레일이 없습니다"
						}
					>
						<SaveAll size={14} /> 전체를 청사진으로 저장
					</button>
				</div>
			</section>
			{blueprintLibraryTab === "saved" ? (
				<section
					id="tilefab-blueprint-panel-saved"
					className="tilefab-blueprint-list"
					role="tabpanel"
					aria-labelledby="tilefab-blueprint-tab-saved"
				>
					<div className="tilefab-blueprint-project-toolbar">
						<label className="tilefab-blueprint-user-search tilefab-blueprint-project-search">
							<Search size={14} aria-hidden="true" />
							<input
								ref={projectBlueprintSearchRef}
								type="search"
								value={projectBlueprintSearch}
								aria-label="프로젝트 청사진 검색"
								placeholder="이름·폴더·종류 검색"
								data-testid="project-blueprint-search"
								onChange={(event) => onProjectBlueprintSearchChange(event.currentTarget.value)}
							/>
						</label>
						<button
							type="button"
							className="tilefab-blueprint-project-search-clear"
							aria-label="프로젝트 청사진 검색 지우기"
							data-testid="project-blueprint-search-clear"
							disabled={projectBlueprintSearch.length === 0}
							onClick={() => {
								onProjectBlueprintSearchChange("");
								projectBlueprintSearchRef.current?.focus();
							}}
						>
							<X size={16} aria-hidden="true" />
						</button>
					</div>
					<p
						className="tilefab-blueprint-search-result"
						data-testid="project-blueprint-search-result"
						role="status"
						aria-atomic="true"
					>
						{projectBlueprintSearch.trim()
							? `검색 결과 ${visibleProjectBlueprints.length} / 전체 ${orderedProjectBlueprints.length}`
							: `전체 ${orderedProjectBlueprints.length}개`}
					</p>
					{visibleProjectBlueprints.length === 0 ? (
						<div className="tilefab-blueprint-empty">
							<LibraryBig size={24} />
							<strong>
								{orderedProjectBlueprints.length === 0 ? "NO SAVED BLUEPRINTS" : "NO MATCHES"}
							</strong>
							<small>
								{orderedProjectBlueprints.length === 0
									? "레일·장비 또는 조직을 선택한 뒤 ‘선택을 청사진으로 저장’을 누르세요"
									: "검색어를 바꾸거나 지워 전체 청사진을 확인하세요"}
							</small>
						</div>
					) : (
						visibleProjectBlueprints.map((record) => (
							<article
								key={record.id}
								data-testid="blueprint-record"
								data-blueprint-id={record.id}
								data-blueprint-name={record.name}
								data-favorite={record.favorite}
								data-kind={record.kind}
								data-equipment-groups={
									record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB
										? record.equipmentGroups.length
										: 0
								}
								data-ports={
									record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB ? record.ports.length : 0
								}
								onContextMenu={(event) => {
									event.preventDefault();
									const trigger = resolveBlueprintRecordContextTrigger(
										event.target,
										"project",
										record.id,
									);
									if (trigger) openBlueprintRecordContext("project", record.id, trigger);
								}}
								onKeyDown={(event) => {
									if (!(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))) {
										return;
									}
									event.preventDefault();
									const trigger = resolveBlueprintRecordContextTrigger(
										event.target,
										"project",
										record.id,
									);
									if (trigger) openBlueprintRecordContext("project", record.id, trigger);
								}}
							>
								{projectBlueprintNameDraft?.record.id === record.id ? (
									<BlueprintMetadataEditor
										record={record}
										name={projectBlueprintNameDraft.name}
										nameRef={projectBlueprintNameRef}
										onNameChange={(name) =>
											setProjectBlueprintNameDraft((current) =>
												current ? Object.freeze({ ...current, name }) : null,
											)
										}
										error={projectBlueprintRenameError(
											record,
											normalizeBlueprintName(projectBlueprintNameDraft.name),
											orderedProjectBlueprints,
										)}
										disabled={projectBusy || userBlueprintLibraryBusy !== null}
										onCancel={cancelProjectBlueprintRename}
										onSave={saveProjectBlueprintName}
									/>
								) : (
									<>
										<button
											type="button"
											className="tilefab-blueprint-place"
											data-testid="blueprint-place"
											disabled={projectBusy}
											onClick={() => placeProjectBlueprint(record)}
											title={`${record.name} 배치`}
										>
											<RailBlueprintMiniature record={record} />
											<span>
												<strong>{record.name}</strong>
												<small>
													{record.folder || "PROJECT"} · {record.widthMeters}×{record.heightMeters}{" "}
													m
												</small>
												<small className="tilefab-blueprint-kind">
													{record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB
														? `STATIC FAB · ${record.equipmentGroups.length} GROUPS · ${record.ports.length} PORTS`
														: record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION
															? `ORGANIZED FAB · ${record.bundle.organizations.length} ORGANIZATIONS · ${record.bundle.equipmentGroups.length} GROUPS`
															: `RAIL ONLY · ${record.sourceModuleCount} MODULES`}
												</small>
											</span>
										</button>
										<div className="tilefab-blueprint-record-tools">
											<button
												ref={(element) => {
													const key = blueprintRecordContextKey("project", record.id);
													if (element) blueprintRecordContextTriggerRefs.current.set(key, element);
													else blueprintRecordContextTriggerRefs.current.delete(key);
												}}
												type="button"
												data-testid="blueprint-record-menu"
												disabled={projectBusy || userBlueprintLibraryBusy !== null}
												aria-label={`${record.name} 청사진 메뉴`}
												aria-haspopup="menu"
												aria-expanded={
													blueprintRecordContext?.scope === "project" &&
													blueprintRecordContext.recordId === record.id
												}
												aria-controls={`tilefab-blueprint-context-project-${record.id}`}
												title="청사진 명령"
												onClick={(event) =>
													openBlueprintRecordContext("project", record.id, event.currentTarget)
												}
											>
												<EllipsisVertical size={17} />
											</button>
										</div>
										{blueprintRecordContext?.scope === "project" &&
										blueprintRecordContext.recordId === record.id ? (
											<BlueprintRecordContextTray
												state={blueprintRecordContext}
												recordName={record.name}
												favorite={record.favorite}
												quickSlot={null}
												quickSlots={USER_BLUEPRINT_QUICK_SLOTS}
												quickSlotOwners={userBlueprintQuickSlotOwners}
												busy={projectBusy || userBlueprintLibraryBusy !== null}
												deleteConfirmation={false}
												contextRef={blueprintRecordContextRef}
												onCommand={(commandId) =>
													runProjectBlueprintRecordCommand(commandId, record)
												}
												onQuickSlot={() => undefined}
												onBack={() => undefined}
												onClose={() => closeBlueprintRecordContext()}
												onKeyDown={handleBlueprintRecordContextKeyDown}
											/>
										) : null}
									</>
								)}
							</article>
						))
					)}
				</section>
			) : blueprintLibraryTab === "user" ? (
				<section
					ref={userBlueprintPanelRef}
					id="tilefab-blueprint-panel-user"
					className="tilefab-blueprint-list tilefab-blueprint-user-panel"
					role="tabpanel"
					aria-labelledby="tilefab-blueprint-tab-user"
					data-testid="blueprint-user-panel"
					aria-busy={userBlueprintLibraryBusy !== null}
				>
					<div className="tilefab-blueprint-user-toolbar">
						<label className="tilefab-blueprint-user-search">
							<Search size={14} />
							<input
								type="search"
								value={userBlueprintSearch}
								aria-label="내 라이브러리 검색"
								placeholder="Search all blueprints"
								onChange={(event) => setUserBlueprintSearch(event.currentTarget.value)}
								onInput={() => setUserBlueprintVisibleLimit(USER_BLUEPRINT_VISIBLE_PAGE_SIZE)}
							/>
						</label>
						<button
							type="button"
							data-testid="user-blueprint-all"
							onClick={() => chooseUserBlueprintFolder(Object.freeze([]))}
							aria-label="모든 청사진 보기"
							title="모든 청사진"
						>
							<LibraryBig size={16} />
						</button>
						<button
							type="button"
							data-testid="user-blueprint-refresh"
							disabled={userBlueprintLibraryBusy !== null}
							onClick={() => void refreshUserBlueprintLibrary()}
							aria-label="내 라이브러리 새로고침"
							title="내 라이브러리 새로고침"
						>
							<RefreshCcw size={16} />
						</button>
						<button
							ref={userBlueprintImportButtonRef}
							type="button"
							data-testid="user-blueprint-import"
							disabled={projectBusy || userBlueprintLibraryBusy !== null}
							onClick={() => void chooseUserBlueprintImport()}
							aria-label=".openfabbp 청사진 가져오기"
							title=".openfabbp 가져오기"
						>
							<FileUp size={16} />
						</button>
					</div>
					<section
						className="tilefab-blueprint-library-safety"
						aria-label="내 라이브러리 백업과 복원"
						data-testid="user-blueprint-library-safety"
						data-durability={userBlueprintStorageStatus.durability}
					>
						<FolderOpen size={16} aria-hidden="true" />
						<span>
							<strong>
								BROWSER LOCAL · {userBlueprintCount.toLocaleString()} ·{" "}
								{userBlueprintStorageStatus.durability === "persistent"
									? "INDEXEDDB"
									: "SESSION ONLY"}
							</strong>
							<small>
								{userBlueprintLibrarySafetyBlockedReason ??
									(userBlueprintCrossTabRefresh.lastOutcome === "failed"
										? "다른 탭 변경을 읽지 못했습니다 · 새로고침으로 다시 시도하세요"
										: userBlueprintCrossTabRefresh.pending || userBlueprintCrossTabRefresh.inFlight
											? "다른 탭 변경을 확인하는 중 · 프로젝트 맵은 그대로 유지됩니다"
											: userBlueprintCrossTabRefresh.available
												? "열린 탭 자동 갱신 · 클라우드 동기화 없음 · 전체 이동은 .openfablib"
												: "탭 자동 갱신 미지원 · 전체 이동은 .openfablib · 개별 공유는 .openfabbp")}
							</small>
						</span>
						<div className="tilefab-blueprint-library-safety-actions">
							{userBlueprintLibraryBusy === "restore-library-file" ? (
								<button
									ref={userBlueprintLibraryRestoreCancelButtonRef}
									type="button"
									onClick={() => userBlueprintLibraryRestoreControllerRef.current?.abort()}
									aria-label="청사진 라이브러리 파일 검증 취소"
									title="검증 취소 (Esc)"
								>
									<X size={15} />
									<span>CANCEL CHECK</span>
								</button>
							) : (
								<>
									<button
										type="button"
										disabled={
											projectBusy ||
											userBlueprintLibraryBusy !== null ||
											userBlueprintLibrarySafetyBlockedReason !== null
										}
										onClick={() => void backupUserBlueprintLibrary()}
										aria-label="전체 청사진 라이브러리 백업 파일 생성"
										title={
											userBlueprintLibrarySafetyBlockedReason ?? "전체 라이브러리 .openfablib 백업"
										}
									>
										<Download size={15} />
										<span>BACKUP</span>
									</button>
									<button
										ref={userBlueprintLibraryRestoreButtonRef}
										type="button"
										disabled={
											projectBusy ||
											userBlueprintLibraryBusy !== null ||
											userBlueprintLibrarySafetyBlockedReason !== null
										}
										onClick={() => void chooseUserBlueprintLibraryRestore()}
										aria-label="전체 청사진 라이브러리 백업 복원"
										title={userBlueprintLibrarySafetyBlockedReason ?? ".openfablib 검증 후 복원"}
									>
										<ArchiveRestore size={15} />
										<span>RESTORE</span>
									</button>
								</>
							)}
						</div>
					</section>
					<section
						className="tilefab-user-blueprint-quick-slots"
						aria-label="내 청사진 빠른 슬롯"
						data-testid="user-blueprint-quick-slots"
					>
						<header>
							<strong>QUICK SLOTS</strong>
							<small>ALT + 1…9</small>
						</header>
						<div className="tilefab-user-blueprint-quick-slot-grid">
							{userBlueprintQuickSlotEntries.map(({ slot, record }) => {
								const target = Object.freeze({
									kind: "quick-slot" as const,
									quickSlot: slot,
									occupiedById: record?.id ?? null,
								});
								return (
									<button
										type="button"
										key={slot}
										data-testid={`user-blueprint-quick-slot-${slot}`}
										data-filled={record !== null}
										disabled={projectBusy || userBlueprintLibraryBusy !== null}
										onClick={() => {
											if (record) {
												placeProjectBlueprint(record.blueprint);
											} else {
												setStatus(`MY LIBRARY SLOT ${slot}이 비어 있습니다`);
											}
										}}
										onDragOver={(event) => dragOverUserBlueprintOrganizationTarget(event, target)}
										onDragLeave={(event) => leaveUserBlueprintOrganizationTarget(event)}
										onDrop={(event) => dropUserBlueprintOnOrganizationTarget(event, target)}
										aria-label={
											record
												? `빠른 슬롯 ${slot}: ${record.blueprint.name} 배치`
												: `빠른 슬롯 ${slot}: 비어 있음`
										}
										title={
											record ? `Alt+${slot} · ${record.blueprint.name}` : `Alt+${slot} · 비어 있음`
										}
									>
										<kbd>{slot}</kbd>
										<span>{record?.blueprint.name ?? "EMPTY"}</span>
									</button>
								);
							})}
						</div>
					</section>
					<nav className="tilefab-blueprint-folder-breadcrumb" aria-label="라이브러리 경로 탐색">
						<button
							type="button"
							aria-current={userBlueprintFolderPath.length === 0 ? "page" : undefined}
							onClick={() => chooseUserBlueprintFolder(Object.freeze([]))}
							onDragOver={(event) =>
								dragOverUserBlueprintOrganizationTarget(event, userBlueprintRootFolderDropTarget)
							}
							onDragLeave={(event) => leaveUserBlueprintOrganizationTarget(event)}
							onDrop={(event) =>
								dropUserBlueprintOnOrganizationTarget(event, userBlueprintRootFolderDropTarget)
							}
						>
							<LibraryBig size={13} />
							ALL
						</button>
						{userBlueprintFolderPath.map((segment, index) => {
							const folderPath = Object.freeze(userBlueprintFolderPath.slice(0, index + 1));
							const target = Object.freeze({
								kind: "folder" as const,
								folderPath,
							});
							return (
								<Fragment key={folderPath.join("/")}>
									<ChevronRight size={12} />
									<button
										type="button"
										aria-current={index === userBlueprintFolderPath.length - 1 ? "page" : undefined}
										onClick={() => chooseUserBlueprintFolder(folderPath)}
										onDragOver={(event) => dragOverUserBlueprintOrganizationTarget(event, target)}
										onDragLeave={(event) => leaveUserBlueprintOrganizationTarget(event)}
										onDrop={(event) => dropUserBlueprintOnOrganizationTarget(event, target)}
									>
										{segment}
									</button>
								</Fragment>
							);
						})}
					</nav>
					{userBlueprintStorageStatus.durability === "session-only" ||
					userBlueprintStorageStatus.rejectedRecordCount > 0 ||
					userBlueprintStorageStatus.overflowDetected ? (
						<div
							className="tilefab-blueprint-storage-status"
							role="status"
							data-durability={userBlueprintStorageStatus.durability}
						>
							<AlertTriangle size={16} />
							<span>
								<strong>
									{userBlueprintStorageStatus.durability === "session-only"
										? "BROWSER LIBRARY UNAVAILABLE"
										: "LIBRARY RECORDS ISOLATED"}
								</strong>
								<small>
									{userBlueprintStorageStatus.durability === "session-only"
										? "빈 목록은 브라우저 로컬 데이터가 없다는 뜻이 아닙니다. 연결을 다시 확인하세요."
										: `${userBlueprintStorageStatus.rejectedRecordCountIsLowerBound ? "최소 " : ""}${userBlueprintStorageStatus.rejectedRecordCount}개 레코드를 격리했습니다${userBlueprintStorageStatus.overflowDetected ? " · 저장 한도 초과 감지" : ""}`}
								</small>
							</span>
							<button
								type="button"
								disabled={userBlueprintLibraryBusy !== null}
								onClick={() => void refreshUserBlueprintLibrary()}
								aria-label="내 라이브러리 저장소 다시 확인"
								title="저장소 다시 확인"
							>
								<RefreshCcw size={15} />
							</button>
						</div>
					) : null}
					{userBlueprintRejectedDiagnostics.length > 0 ? (
						<section
							className="tilefab-blueprint-quarantine"
							aria-label="격리된 청사진 레코드"
							data-testid="user-blueprint-quarantine"
						>
							<header>
								<span>
									<strong>QUARANTINE RECOVERY</strong>
									<small>
										{userBlueprintRejectedDiagnostics.length}개 표시 /{" "}
										{userBlueprintStorageStatus.rejectedRecordCountIsLowerBound ? "최소 " : ""}
										{userBlueprintStorageStatus.rejectedRecordCount}개 감지
									</small>
								</span>
							</header>
							<ol>
								{userBlueprintRejectedDiagnostics.map((diagnostic) => (
									<li key={diagnostic.token}>
										<span>
											<strong>
												#{diagnostic.ordinal} · {diagnostic.code}
											</strong>
											<code>{diagnostic.path}</code>
											<small>{diagnostic.message}</small>
										</span>
										<button
											type="button"
											disabled={userBlueprintLibraryBusy !== null}
											onClick={() => void exportRejectedUserBlueprintDiagnostic(diagnostic)}
											aria-label={
												diagnostic.code === "LIMIT_EXCEEDED"
													? `한도 초과 레코드 ${diagnostic.ordinal}를 청사진 파일로 백업하고 저장소에서 제거`
													: `격리 레코드 ${diagnostic.ordinal} 원본 진단 JSON 내보내기`
											}
											title={
												diagnostic.code === "LIMIT_EXCEEDED"
													? ".openfabbp 백업 후 원본 제거"
													: "원본 진단 JSON 내보내기"
											}
										>
											<Download size={16} />
										</button>
									</li>
								))}
							</ol>
						</section>
					) : null}
					{deletedUserBlueprintRecovery ? (
						<div
							className="tilefab-blueprint-delete-recovery"
							role="status"
							data-testid="user-blueprint-delete-recovery"
						>
							<Undo2 size={16} />
							<span>
								<strong>DELETED</strong>
								<small>{deletedUserBlueprintRecovery.blueprint.name}</small>
							</span>
							<button
								type="button"
								disabled={userBlueprintLibraryBusy !== null}
								onClick={() => void restoreDeletedUserBlueprint()}
							>
								UNDO DELETE
							</button>
							<button
								type="button"
								aria-label="삭제 복구 알림 닫기"
								onClick={() => {
									setDeletedUserBlueprintRecovery(null);
									requestAnimationFrame(() => blueprintUserTabRef.current?.focus());
								}}
							>
								<X size={14} />
							</button>
						</div>
					) : null}
					{pendingUserBlueprintImport && pendingUserBlueprintImportPreview ? (
						<form
							className="tilefab-blueprint-import-preview"
							data-testid="user-blueprint-import-preview"
							onSubmit={(event) => {
								event.preventDefault();
								void confirmUserBlueprintImport();
							}}
						>
							<header>
								<FileUp size={16} />
								<span>
									<strong>IMPORT PREVIEW</strong>
									<small>{pendingUserBlueprintImport.fileName}</small>
								</span>
							</header>
							<div className="tilefab-blueprint-import-summary">
								<RailBlueprintMiniature record={pendingUserBlueprintImport.record.blueprint} />
								<span>
									<strong>{pendingUserBlueprintImport.record.blueprint.kind}</strong>
									<small>
										{pendingUserBlueprintImport.record.blueprint.widthMeters}×
										{pendingUserBlueprintImport.record.blueprint.heightMeters} m ·{" "}
										{pendingUserBlueprintImport.record.blueprint.edges.length.toLocaleString()}{" "}
										EDGES
									</small>
									{pendingUserBlueprintImportPreview.idCollision ||
									pendingUserBlueprintImportPreview.quickSlotCollision ? (
										<small data-warning="true">
											{pendingUserBlueprintImportPreview.idCollision ? "새 라이브러리 ID" : ""}
											{pendingUserBlueprintImportPreview.idCollision &&
											pendingUserBlueprintImportPreview.quickSlotCollision
												? " · "
												: ""}
											{pendingUserBlueprintImportPreview.quickSlotCollision
												? "quick slot 해제"
												: ""}
										</small>
									) : null}
								</span>
							</div>
							<div className="tilefab-blueprint-import-fields">
								<label>
									<span>NAME</span>
									<input
										ref={userBlueprintImportNameRef}
										value={pendingUserBlueprintImport.name}
										aria-label="가져올 청사진 이름"
										onChange={(event) => {
											const name = event.currentTarget.value;
											setPendingUserBlueprintImport((current) =>
												current ? Object.freeze({ ...current, name }) : null,
											);
										}}
									/>
								</label>
								<label>
									<span>FOLDER</span>
									<input
										value={pendingUserBlueprintImport.folder}
										aria-label="가져올 청사진 폴더"
										placeholder="Process/Photo"
										onChange={(event) => {
											const folder = event.currentTarget.value;
											setPendingUserBlueprintImport((current) =>
												current ? Object.freeze({ ...current, folder }) : null,
											);
										}}
									/>
								</label>
							</div>
							<small className="tilefab-blueprint-import-resolution">
								SAVE AS · {pendingUserBlueprintImportPreview.folderPath.join("/") || "MY LIBRARY"} /{" "}
								{pendingUserBlueprintImportPreview.name || "NAME REQUIRED"}
							</small>
							<footer>
								<button type="button" onClick={cancelUserBlueprintImport}>
									CANCEL
								</button>
								<button
									type="submit"
									disabled={
										!pendingUserBlueprintImportPreview.name || userBlueprintLibraryBusy !== null
									}
								>
									IMPORT
								</button>
							</footer>
						</form>
					) : null}
					{userBlueprintChildFolders.length > 0 ? (
						<div className="tilefab-blueprint-folder-list" data-testid="user-blueprint-folders">
							{userBlueprintChildFolders.map((folder) => {
								const target = Object.freeze({
									kind: "folder" as const,
									folderPath: folder.path,
								});
								return (
									<button
										key={folder.path.join("/")}
										type="button"
										onClick={() => chooseUserBlueprintFolder(folder.path)}
										onDragOver={(event) => dragOverUserBlueprintOrganizationTarget(event, target)}
										onDragLeave={(event) => leaveUserBlueprintOrganizationTarget(event)}
										onDrop={(event) => dropUserBlueprintOnOrganizationTarget(event, target)}
									>
										<FolderOpen size={16} />
										<span>
											<strong>{folder.name}</strong>
											<small>{folder.count} BLUEPRINTS</small>
										</span>
										<ChevronRight size={14} />
									</button>
								);
							})}
						</div>
					) : null}
					{displayedUserBlueprintCount === 0 && userBlueprintChildFolders.length === 0 ? (
						<div className="tilefab-blueprint-empty">
							<FolderOpen size={24} />
							<strong>{userBlueprintCount === 0 ? "BROWSER LOCAL IS EMPTY" : "NO MATCHES"}</strong>
							<small>
								{userBlueprintCount === 0
									? "레일·장비를 만든 뒤 ‘선택을 청사진으로 저장’ 또는 ‘전체를 청사진으로 저장’을 누르세요."
									: "이름, 폴더 또는 종류로 다시 검색하세요"}
							</small>
						</div>
					) : (
						<>
							{visibleUserBlueprints.map((entry) => {
								const record = entry.blueprint;
								return (
									<article
										key={entry.id}
										ref={(element) => {
											if (element) userBlueprintRecordRefs.current.set(entry.id, element);
											else userBlueprintRecordRefs.current.delete(entry.id);
										}}
										data-testid="user-blueprint-record"
										data-blueprint-id={entry.id}
										data-blueprint-name={record.name}
										data-favorite={record.favorite}
										data-kind={record.kind}
										data-quick-slot={entry.quickSlot ?? ""}
										data-equipment-groups={
											record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB
												? record.equipmentGroups.length
												: record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION
													? record.bundle.equipmentGroups.length
													: 0
										}
										data-ports={
											record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB
												? record.ports.length
												: record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION
													? record.bundle.ports.length
													: 0
										}
										onContextMenu={(event) => {
											event.preventDefault();
											const trigger = resolveBlueprintRecordContextTrigger(
												event.target,
												"user",
												entry.id,
											);
											if (trigger) openBlueprintRecordContext("user", entry.id, trigger);
										}}
										onKeyDown={(event) => {
											if (
												!(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
											) {
												return;
											}
											event.preventDefault();
											const trigger = resolveBlueprintRecordContextTrigger(
												event.target,
												"user",
												entry.id,
											);
											if (trigger) openBlueprintRecordContext("user", entry.id, trigger);
										}}
									>
										{userBlueprintMetadataDraft?.id === entry.id ? (
											<BlueprintMetadataEditor
												record={record}
												name={userBlueprintMetadataDraft.name}
												nameRef={userBlueprintMetadataNameRef}
												onNameChange={(name) =>
													setUserBlueprintMetadataDraft((current) =>
														current ? Object.freeze({ ...current, name }) : null,
													)
												}
												folder={{
													value: userBlueprintMetadataDraft.folder,
													onChange: (folder) =>
														setUserBlueprintMetadataDraft((current) =>
															current ? Object.freeze({ ...current, folder }) : null,
														),
												}}
												disabled={
													!normalizeBlueprintName(userBlueprintMetadataDraft.name) ||
													userBlueprintLibraryBusy !== null
												}
												onCancel={cancelUserBlueprintMetadataEdit}
												onSave={() => void saveUserBlueprintMetadata()}
											/>
										) : (
											<>
												<button
													type="button"
													className="tilefab-blueprint-place"
													disabled={projectBusy || userBlueprintLibraryBusy !== null}
													onClick={() => placeProjectBlueprint(record, "library", true)}
													title={`${record.name} 배치`}
												>
													<RailBlueprintMiniature record={record} />
													<span>
														<strong>{record.name}</strong>
														<small>
															{entry.folderPath.join("/") || "MY LIBRARY"} · {record.widthMeters}×
															{record.heightMeters} m
															{entry.quickSlot === null ? "" : ` · SLOT ${entry.quickSlot}`}
														</small>
														<small className="tilefab-blueprint-kind">
															{record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB
																? `STATIC FAB · ${record.equipmentGroups.length} GROUPS · ${record.ports.length} PORTS`
																: record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB_ORGANIZATION
																	? `ORGANIZED FAB · ${record.bundle.organizations.length} ORGANIZATIONS`
																	: `RAIL ONLY · ${record.sourceModuleCount} MODULES`}
														</small>
													</span>
												</button>
												<div className="tilefab-blueprint-record-tools">
													<button
														type="button"
														className="tilefab-blueprint-record-drag"
														draggable={!projectBusy && userBlueprintLibraryBusy === null}
														disabled={projectBusy || userBlueprintLibraryBusy !== null}
														aria-label={`${record.name} 정리 위치 선택`}
														aria-haspopup="menu"
														aria-expanded={
															blueprintRecordContext?.scope === "user" &&
															blueprintRecordContext.recordId === entry.id
														}
														aria-controls={`tilefab-blueprint-context-user-${entry.id}`}
														title="폴더, Quick Slot 또는 휴지통으로 드래그"
														onDragStart={(event) => beginUserBlueprintDrag(event, entry)}
														onDragEnd={finishUserBlueprintDrag}
														onClick={(event) =>
															openBlueprintRecordContext("user", entry.id, event.currentTarget)
														}
													>
														<GripVertical size={17} />
													</button>
													<button
														ref={(element) => {
															const key = blueprintRecordContextKey("user", entry.id);
															if (element)
																blueprintRecordContextTriggerRefs.current.set(key, element);
															else blueprintRecordContextTriggerRefs.current.delete(key);
														}}
														type="button"
														data-testid="user-blueprint-record-menu"
														disabled={projectBusy || userBlueprintLibraryBusy !== null}
														aria-label={`${record.name} 청사진 메뉴`}
														aria-haspopup="menu"
														aria-expanded={
															blueprintRecordContext?.scope === "user" &&
															blueprintRecordContext.recordId === entry.id
														}
														aria-controls={`tilefab-blueprint-context-user-${entry.id}`}
														title="청사진 명령"
														onClick={(event) =>
															openBlueprintRecordContext("user", entry.id, event.currentTarget)
														}
													>
														<EllipsisVertical size={17} />
													</button>
												</div>
												{blueprintRecordContext?.scope === "user" &&
												blueprintRecordContext.recordId === entry.id ? (
													<BlueprintRecordContextTray
														state={blueprintRecordContext}
														recordName={record.name}
														favorite={record.favorite}
														quickSlot={entry.quickSlot}
														quickSlots={USER_BLUEPRINT_QUICK_SLOTS}
														quickSlotOwners={userBlueprintQuickSlotOwners}
														busy={projectBusy || userBlueprintLibraryBusy !== null}
														deleteConfirmation={pendingUserBlueprintDeleteId === entry.id}
														contextRef={blueprintRecordContextRef}
														onCommand={(commandId) =>
															runUserBlueprintRecordCommand(commandId, entry)
														}
														onQuickSlot={(quickSlot) => {
															if (quickSlot === entry.quickSlot) {
																closeBlueprintRecordContext();
																return;
															}
															closeBlueprintRecordContext(false);
															void updateUserBlueprintQuickSlot(entry, quickSlot);
														}}
														onBack={() => {
															setBlueprintRecordContext(
																Object.freeze({
																	scope: "user",
																	recordId: entry.id,
																	view: "commands",
																}),
															);
															focusBlueprintRecordContextFirstCommand();
														}}
														onClose={() => closeBlueprintRecordContext()}
														onKeyDown={handleBlueprintRecordContextKeyDown}
													/>
												) : null}
											</>
										)}
									</article>
								);
							})}
							{visibleUserBlueprints.length < displayedUserBlueprintCount ? (
								<button
									type="button"
									className="tilefab-blueprint-show-more"
									data-testid="user-blueprint-show-more"
									onClick={revealMoreUserBlueprints}
								>
									SHOW{" "}
									{Math.min(
										USER_BLUEPRINT_VISIBLE_PAGE_SIZE,
										displayedUserBlueprintCount - visibleUserBlueprints.length,
									)}{" "}
									MORE
								</button>
							) : null}
						</>
					)}
					<div
						className="tilefab-blueprint-drag-dock"
						data-testid="user-blueprint-drag-dock"
						aria-hidden="true"
					>
						<fieldset
							className="tilefab-blueprint-drop-target"
							data-kind="folder"
							data-testid="user-blueprint-drag-root"
							onDragOver={(event) =>
								dragOverUserBlueprintOrganizationTarget(event, userBlueprintRootFolderDropTarget)
							}
							onDragLeave={(event) => leaveUserBlueprintOrganizationTarget(event)}
							onDrop={(event) =>
								dropUserBlueprintOnOrganizationTarget(event, userBlueprintRootFolderDropTarget)
							}
						>
							<FolderOpen size={17} />
							<span>ROOT</span>
						</fieldset>
						<div className="tilefab-blueprint-drag-slot-strip">
							{userBlueprintQuickSlotEntries.map(({ slot, record }) => {
								const target = Object.freeze({
									kind: "quick-slot" as const,
									quickSlot: slot,
									occupiedById: record?.id ?? null,
								});
								return (
									<fieldset
										key={slot}
										className="tilefab-blueprint-drop-target"
										data-kind="quick-slot"
										data-testid={`user-blueprint-drag-slot-${slot}`}
										data-filled={record !== null}
										onDragOver={(event) => dragOverUserBlueprintOrganizationTarget(event, target)}
										onDragLeave={(event) => leaveUserBlueprintOrganizationTarget(event)}
										onDrop={(event) => dropUserBlueprintOnOrganizationTarget(event, target)}
									>
										<kbd>{slot}</kbd>
									</fieldset>
								);
							})}
						</div>
						<fieldset
							className="tilefab-blueprint-drop-target"
							data-kind="trash"
							data-testid="user-blueprint-drag-trash"
							onDragOver={(event) =>
								dragOverUserBlueprintOrganizationTarget(event, userBlueprintTrashDropTarget)
							}
							onDragLeave={(event) => leaveUserBlueprintOrganizationTarget(event)}
							onDrop={(event) =>
								dropUserBlueprintOnOrganizationTarget(event, userBlueprintTrashDropTarget)
							}
						>
							<Trash2 size={17} />
							<span>TRASH</span>
						</fieldset>
					</div>
				</section>
			) : (
				<section
					id="tilefab-blueprint-panel-recent"
					className="tilefab-blueprint-list tilefab-blueprint-recent-panel"
					role="tabpanel"
					aria-labelledby="tilefab-blueprint-tab-recent"
					data-testid="blueprint-recent-panel"
				>
					{hasRecentBlueprint ? (
						recentRailClipboards.map(({ id, clipboard }, index) => {
							const prepared = recentModuleBlueprints.get(id);
							const unavailableReason = prepared && !prepared.valid ? prepared.reason : null;
							return (
								<article
									key={id}
									data-testid={
										index === 0 ? "blueprint-recent-record" : "blueprint-recent-history-record"
									}
									data-recent-index={index}
									data-active={index === recentRailClipboardActiveIndex}
								>
									<button
										type="button"
										className="tilefab-blueprint-place"
										aria-current={index === recentRailClipboardActiveIndex ? "true" : undefined}
										onClick={() => {
											closeBlueprintLibrary(false);
											chooseRecentRailClipboard(index, true);
										}}
									>
										<span className="tilefab-blueprint-recent-glyph">
											<Copy size={24} />
											<small>{index === 0 ? "LATEST" : `-${index}`}</small>
										</span>
										<span>
											<strong>
												{index === recentRailClipboardActiveIndex
													? `ACTIVE · RECENT ${index + 1}`
													: index === 0
														? "LATEST CAPTURE"
														: `RECENT ${index + 1}`}
											</strong>
											<small>
												{clipboard.kind === "organization"
													? `${clipboard.bundle.sourceWidthMeters}×${clipboard.bundle.sourceHeightMeters} m · ${clipboard.bundle.sourceModuleCount} MODULES`
													: clipboard.kind === "area"
														? `${clipboard.template.sourceWidthMeters}×${clipboard.template.sourceHeightMeters} m · ${clipboard.template.sourceModuleCount} MODULES`
														: `${clipboard.template.grammar} · ${clipboard.template.path.length} CELLS`}
											</small>
											<small className="tilefab-blueprint-kind">
												{clipboard.kind === "organization"
													? `ORGANIZATION FAB · ${clipboard.bundle.organizations.length} ORGS · ${clipboard.bundle.equipmentGroups.length} GROUPS · ${clipboard.bundle.ports.length} PORTS`
													: clipboard.kind === "area" && clipboard.staticFabTemplate
														? `STATIC FAB · ${clipboard.staticFabTemplate.equipmentGroups.length} GROUPS · ${clipboard.staticFabTemplate.ports.length} PORTS`
														: "TRANSIENT CLIPBOARD · CTRL + V"}
											</small>
											{unavailableReason ? (
												<small
													className="tilefab-blueprint-unavailable"
													id={`recent-blueprint-unavailable-${id}`}
													data-testid="recent-blueprint-unavailable"
												>
													보관: {unavailableReason}
												</small>
											) : null}
										</span>
									</button>
									<div className="tilefab-blueprint-record-tools">
										<button
											type="button"
											data-testid="save-recent-blueprint"
											aria-label={`RECENT ${index + 1} 보관`}
											aria-describedby={
												unavailableReason ? `recent-blueprint-unavailable-${id}` : undefined
											}
											title={unavailableReason ?? "이 복사 기록을 청사진으로 보관"}
											disabled={
												unavailableReason !== null ||
												projectBusy ||
												modelSyncPending ||
												userBlueprintLibraryBusy !== null
											}
											onClick={(event) =>
												requestContextualBlueprintSave(
													{ recentEntry: { id, clipboard } },
													event.currentTarget,
													blueprintSaveDestination,
												)
											}
										>
											보관
										</button>
									</div>
								</article>
							);
						})
					) : (
						<div className="tilefab-blueprint-empty">
							<FolderClock size={24} />
							<strong>NO RECENT BLUEPRINT</strong>
							<small>레일·장비 또는 조직을 선택한 뒤 ⌘/Ctrl+C로 복사하세요</small>
						</div>
					)}
				</section>
			)}
		</aside>
	);
}

function BlueprintMetadataEditor({
	record,
	name,
	nameRef,
	onNameChange,
	folder,
	error,
	disabled,
	onCancel,
	onSave,
}: Readonly<{
	record: OpenFabProjectBlueprint;
	name: string;
	nameRef: RefObject<HTMLInputElement | null>;
	onNameChange: (name: string) => void;
	folder?: Readonly<{ value: string; onChange: (folder: string) => void }>;
	error?: string | null;
	disabled: boolean;
	onCancel: () => void;
	onSave: () => void;
}>): ReactElement {
	const errorId = useId();
	return (
		<form
			className="tilefab-user-blueprint-metadata-editor"
			data-testid={folder ? "user-blueprint-metadata-editor" : "project-blueprint-name-editor"}
			onKeyDown={(event) => {
				if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
					if (event.key === "Enter") event.preventDefault();
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					onCancel();
				}
			}}
			onSubmit={(event) => {
				event.preventDefault();
				if (!disabled && !error) onSave();
			}}
		>
			<RailBlueprintMiniature record={record} />
			<div className="tilefab-user-blueprint-metadata-fields">
				<label>
					<span>NAME</span>
					<input
						ref={nameRef}
						value={name}
						aria-label={`${record.name} 새 이름`}
						aria-invalid={!!error}
						aria-describedby={error ? errorId : undefined}
						onChange={(event) => onNameChange(event.currentTarget.value)}
					/>
				</label>
				{folder ? (
					<label>
						<span>FOLDER · UP TO 4 LEVELS</span>
						<input
							value={folder.value}
							aria-label={`${record.name} 새 폴더`}
							placeholder="Process/Photo"
							onChange={(event) => folder.onChange(event.currentTarget.value)}
						/>
					</label>
				) : null}
			</div>
			{error ? (
				<p id={errorId} className="tilefab-blueprint-name-error" role="alert">
					{error}
				</p>
			) : null}
			<footer>
				<button type="button" onClick={onCancel}>
					<X size={14} />
					{folder ? "CANCEL" : "취소"}
				</button>
				<button type="submit" disabled={disabled || !!error}>
					<Check size={14} />
					{folder ? "SAVE" : "적용"}
				</button>
			</footer>
		</form>
	);
}
