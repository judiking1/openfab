import {
	Crosshair,
	Factory,
	FileUp,
	LibraryBig,
	Map as MapIcon,
	MousePointer2,
	PackagePlus,
	Route,
	Trash2,
	Warehouse,
} from "lucide-react";
import type * as React from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { EDITOR_ACTIVITY_DEFINITIONS, type EditorActivity } from "./EditorActivity";
import type { EditorTool } from "./EditorTool";
import type { GuidedBuildEquipmentToolId, GuidedBuildSuggestedAction } from "./GuidedBuildMission";
import type { GuidedBuildPrimaryTarget } from "./GuidedBuildPrimaryTarget";

export interface EditorActivityToolsProps {
	readonly editorActivity: EditorActivity;
	readonly tool: EditorTool;
	readonly guidedBuildExperienceActive: boolean;
	readonly guidedBuildEraseRevealed: boolean;
	readonly guidedBuildOpen: boolean;
	readonly guidedBuildPrimaryTarget: GuidedBuildPrimaryTarget | null;
	readonly guidedBuildVisibleEquipmentToolIds: readonly GuidedBuildEquipmentToolId[];
	readonly guidedBuildCurrentSuggestedAction: GuidedBuildSuggestedAction | null;
	readonly guidedBuildComplete: boolean;
	readonly staticFabExclusiveCommandActive: boolean;
	readonly editorMutationWaitActive: boolean;
	readonly blueprintLibraryOpen: boolean;
	readonly stationProposalReviewActive: boolean;
	readonly staticFabNavigatorOpen: boolean;
	readonly startupReady: boolean;
	readonly projectBusy: boolean;
	readonly modelSyncPending: boolean;
	readonly contextPaletteOpen: boolean;
	readonly chooseExplicitEditorTool: (next: EditorTool) => boolean;
	readonly closeBlueprintLibrary: () => void;
	readonly openBlueprintLibraryFromActivity: (tab: "saved", launcher: HTMLButtonElement) => void;
	readonly chooseGuidedEquipmentTool: (next: GuidedBuildEquipmentToolId) => boolean;
	readonly openStationProposalReview: (launcher: HTMLButtonElement) => Promise<void>;
	readonly closeStaticFabNavigator: () => void;
	readonly chooseStaticFabNavigatorTab: (tab: "map", launcher: HTMLButtonElement) => void;
	readonly toggleContextPalette: () => void;
}

export function EditorActivityTools({
	editorActivity,
	tool,
	guidedBuildExperienceActive,
	guidedBuildEraseRevealed,
	guidedBuildOpen,
	guidedBuildPrimaryTarget,
	guidedBuildVisibleEquipmentToolIds,
	guidedBuildCurrentSuggestedAction,
	guidedBuildComplete,
	staticFabExclusiveCommandActive,
	editorMutationWaitActive,
	blueprintLibraryOpen,
	stationProposalReviewActive,
	staticFabNavigatorOpen,
	startupReady,
	projectBusy,
	modelSyncPending,
	contextPaletteOpen,
	chooseExplicitEditorTool,
	closeBlueprintLibrary,
	openBlueprintLibraryFromActivity,
	chooseGuidedEquipmentTool,
	openStationProposalReview,
	closeStaticFabNavigator,
	chooseStaticFabNavigatorTab,
	toggleContextPalette,
}: EditorActivityToolsProps): React.ReactElement {
	return (
		<fieldset
			id="tilefab-editor-activity-tools"
			className="tilefab-editor-activity-tools"
			data-activity={editorActivity}
			aria-label={`${EDITOR_ACTIVITY_DEFINITIONS.find(({ id }) => id === editorActivity)?.label} 도구`}
		>
			{editorActivity === "build" ? (
				<>
					{!guidedBuildExperienceActive || guidedBuildEraseRevealed || tool !== "build" ? (
						<ToolButton
							label="레일 건설"
							active={tool === "build"}
							disabled={staticFabExclusiveCommandActive}
							caption="레일 건설"
							compactCaption="건설"
							captionDescription="끌어서 Smart Route"
							guidedCaption={
								guidedBuildPrimaryTarget?.kind === "rail-tool"
									? "레일 건설 · Smart Route"
									: undefined
							}
							guidedTarget={guidedBuildPrimaryTarget?.kind === "rail-tool"}
							guidedActionId="tool:build"
							guidedDescriptionId={
								guidedBuildPrimaryTarget?.kind === "rail-tool"
									? "tilefab-guided-primary-target-description"
									: undefined
							}
							onClick={() => chooseExplicitEditorTool("build")}
						>
							<Route size={18} />
						</ToolButton>
					) : null}
					{!guidedBuildExperienceActive || guidedBuildEraseRevealed || tool === "erase" ? (
						<ToolButton
							label="모듈 철거"
							active={tool === "erase"}
							disabled={staticFabExclusiveCommandActive}
							tone="danger"
							caption="모듈 철거"
							compactCaption="철거"
							captionDescription="클릭 또는 드래그"
							onClick={() => chooseExplicitEditorTool("erase")}
						>
							<Trash2 size={18} />
						</ToolButton>
					) : null}
				</>
			) : null}
			{editorActivity === "assemble" ? (
				<ToolButton
					label="내 청사진"
					active={blueprintLibraryOpen}
					disabled={staticFabExclusiveCommandActive}
					caption="내 청사진"
					compactCaption="청사진"
					captionDescription="저장·배치·관리"
					controls="tilefab-blueprint-library"
					expanded={blueprintLibraryOpen}
					keyShortcuts="B"
					onClick={(event) =>
						blueprintLibraryOpen
							? closeBlueprintLibrary()
							: openBlueprintLibraryFromActivity("saved", event.currentTarget)
					}
				>
					<LibraryBig size={18} />
				</ToolButton>
			) : null}
			{editorActivity === "equip" ? (
				<>
					{!guidedBuildExperienceActive ||
					guidedBuildVisibleEquipmentToolIds.includes("ohb") ||
					tool === "ohb" ? (
						<ToolButton
							label="OHB 포트 배치"
							active={tool === "ohb"}
							disabled={staticFabExclusiveCommandActive}
							caption={!guidedBuildOpen ? "OHB Port" : undefined}
							captionDescription={!guidedBuildOpen ? "레일 옆 원 · 클릭 또는 드래그" : undefined}
							compactCaption="OHB"
							guidedCaption={guidedBuildOpen ? "1 · OHB · Port 1개" : undefined}
							guidedTarget={
								guidedBuildPrimaryTarget?.kind === "equipment-tool" &&
								guidedBuildPrimaryTarget.tool === "ohb"
							}
							guidedActionId="tool:ohb"
							guidedDescriptionId={
								guidedBuildPrimaryTarget?.kind === "equipment-tool" &&
								guidedBuildPrimaryTarget.tool === "ohb"
									? "tilefab-guided-primary-target-description"
									: undefined
							}
							guidedSelected={guidedBuildCurrentSuggestedAction === "ohb" && tool === "ohb"}
							onClick={() => chooseGuidedEquipmentTool("ohb")}
						>
							<PackagePlus size={18} />
						</ToolButton>
					) : null}
					{!guidedBuildExperienceActive ||
					guidedBuildVisibleEquipmentToolIds.includes("eq") ||
					tool === "eq" ? (
						<ToolButton
							label="EQ 포트 행 배치"
							active={tool === "eq"}
							disabled={staticFabExclusiveCommandActive}
							caption={!guidedBuildOpen ? "EQ Port 행" : undefined}
							captionDescription={
								!guidedBuildOpen ? "같은 직선 레일 · 시작점 → 끝점 클릭" : undefined
							}
							compactCaption="EQ"
							guidedCaption={guidedBuildOpen ? "2 · EQ · 직선 Port 행" : undefined}
							guidedTarget={
								guidedBuildPrimaryTarget?.kind === "equipment-tool" &&
								guidedBuildPrimaryTarget.tool === "eq"
							}
							guidedActionId="tool:eq"
							guidedDescriptionId={
								guidedBuildPrimaryTarget?.kind === "equipment-tool" &&
								guidedBuildPrimaryTarget.tool === "eq"
									? "tilefab-guided-primary-target-description"
									: undefined
							}
							guidedSelected={guidedBuildCurrentSuggestedAction === "eq" && tool === "eq"}
							onClick={() => chooseGuidedEquipmentTool("eq")}
						>
							<Factory size={18} />
						</ToolButton>
					) : null}
					{!guidedBuildExperienceActive ||
					guidedBuildVisibleEquipmentToolIds.includes("stk") ||
					tool === "stk" ? (
						<ToolButton
							label="Stocker 포트 그룹 배치"
							active={tool === "stk"}
							disabled={staticFabExclusiveCommandActive}
							caption={!guidedBuildOpen ? "Stocker · 포트 선택" : undefined}
							captionDescription={
								!guidedBuildOpen ? "금색 ◇ 포트 · 선택 후 Stocker 생성" : undefined
							}
							compactCaption="Stocker"
							guidedCaption={guidedBuildOpen ? "3 · Stocker · 입출고 2개" : undefined}
							guidedTarget={
								guidedBuildPrimaryTarget?.kind === "equipment-tool" &&
								guidedBuildPrimaryTarget.tool === "stk"
							}
							guidedActionId="tool:stk"
							guidedDescriptionId={
								guidedBuildPrimaryTarget?.kind === "equipment-tool" &&
								guidedBuildPrimaryTarget.tool === "stk"
									? "tilefab-guided-primary-target-description"
									: undefined
							}
							guidedSelected={guidedBuildCurrentSuggestedAction === "stk" && tool === "stk"}
							onClick={() => chooseGuidedEquipmentTool("stk")}
						>
							<Warehouse size={18} />
						</ToolButton>
					) : null}
					{!guidedBuildExperienceActive || guidedBuildComplete || stationProposalReviewActive ? (
						<ToolButton
							label="Station proposal 가져오기"
							caption={!guidedBuildOpen ? "고급 가져오기" : undefined}
							captionDescription={!guidedBuildOpen ? "외부 Station proposal 검토" : undefined}
							compactCaption="IMPORT"
							active={stationProposalReviewActive}
							disabled={staticFabExclusiveCommandActive}
							onClick={(event) => void openStationProposalReview(event.currentTarget)}
						>
							<FileUp size={18} />
						</ToolButton>
					) : null}
				</>
			) : null}
			{editorActivity === "inspect" ? (
				<>
					<ToolButton
						label="구조 · FAB 내비게이터"
						caption="FAB 내비게이터"
						compactCaption="구조"
						captionDescription="문제 · 구조 · 장비"
						active={staticFabNavigatorOpen}
						disclosure
						disabled={
							!startupReady || projectBusy || modelSyncPending || staticFabExclusiveCommandActive
						}
						controls="tilefab-fab-navigator"
						expanded={staticFabNavigatorOpen}
						onClick={(event) => {
							if (staticFabNavigatorOpen) closeStaticFabNavigator();
							else chooseStaticFabNavigatorTab("map", event.currentTarget);
						}}
					>
						<MapIcon size={18} />
					</ToolButton>
					<ToolButton
						label="선택·편집 및 정보"
						caption="선택·편집"
						compactCaption="편집"
						captionDescription="Canvas에서 항목 선택"
						active={!staticFabNavigatorOpen && (tool === "inspect" || tool === "reshape")}
						disabled={staticFabExclusiveCommandActive || editorMutationWaitActive}
						guidedTarget={guidedBuildPrimaryTarget?.kind === "inspect-tool"}
						guidedActionId="tool:inspect"
						guidedDescriptionId={
							guidedBuildPrimaryTarget?.kind === "inspect-tool"
								? "tilefab-guided-primary-target-description"
								: undefined
						}
						onClick={() => chooseExplicitEditorTool("inspect")}
					>
						<MousePointer2 size={18} />
					</ToolButton>
					<ToolButton
						label="상황별 편집 명령"
						caption="상황별 편집"
						compactCaption="명령"
						captionDescription="선택 항목의 다음 작업"
						active={contextPaletteOpen}
						disabled={staticFabExclusiveCommandActive}
						keyShortcuts="ContextMenu Shift+F10"
						onClick={toggleContextPalette}
					>
						<Crosshair size={18} />
					</ToolButton>
				</>
			) : null}
		</fieldset>
	);
}

function ToolButton({
	label,
	active,
	disabled = false,
	tone = "default",
	controls,
	expanded,
	keyShortcuts,
	caption,
	captionDescription,
	compactCaption,
	guidedCaption,
	guidedTarget = false,
	guidedActionId,
	guidedSelected = false,
	guidedDescriptionId,
	disclosure = false,
	onClick,
	children,
}: {
	label: string;
	active: boolean;
	disabled?: boolean;
	tone?: "default" | "danger";
	controls?: string;
	expanded?: boolean;
	keyShortcuts?: string;
	caption?: string;
	captionDescription?: string;
	compactCaption?: string;
	guidedCaption?: string;
	guidedTarget?: boolean;
	guidedActionId?: string;
	guidedSelected?: boolean;
	guidedDescriptionId?: string;
	disclosure?: boolean;
	onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	children: React.ReactNode;
}): React.ReactElement {
	const visibleCaption = compactCaption ?? caption ?? guidedCaption;
	return (
		<button
			type="button"
			className="tilefab-tool-button"
			data-active={active}
			data-guided-action-id={guidedActionId}
			data-guided-target={guidedTarget || undefined}
			data-compact-caption={compactCaption}
			data-tone={tone}
			disabled={disabled}
			aria-label={label}
			aria-describedby={guidedDescriptionId}
			aria-pressed={disclosure ? undefined : active}
			aria-controls={controls}
			aria-expanded={expanded}
			aria-keyshortcuts={keyShortcuts}
			title={captionDescription ? `${label} · ${captionDescription}` : label}
			onClick={onClick}
		>
			<span className="tilefab-tool-button-icon" aria-hidden="true">
				{children}
			</span>
			{compactCaption ? (
				<small className="tilefab-tool-button-compact-caption" aria-hidden="true">
					{compactCaption}
				</small>
			) : null}
			{visibleCaption ? (
				<span className="tilefab-tool-button-caption">
					<strong>{visibleCaption}</strong>
					{guidedCaption && (guidedSelected || guidedTarget) ? (
						<small>{guidedSelected ? "선택됨" : "다음"}</small>
					) : null}
				</span>
			) : null}
		</button>
	);
}
