import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaticFabAssembleMenu, type StaticFabAssembleMenuProps } from "./StaticFabAssembleMenu";

function props(overrides: Partial<StaticFabAssembleMenuProps> = {}): StaticFabAssembleMenuProps {
	return {
		selectionCount: 0,
		selectedBayCount: 0,
		selectedBankCount: 0,
		connectorHierarchyRole: null,
		connectorPurpose: null,
		duplicateAvailability: {
			state: "blocked",
			reason: "Select a Fab, Bank, or Bay organization first.",
		},
		connectorAvailability: { state: "blocked", reason: "Select exactly two Bays." },
		disconnectAvailability: { state: "blocked", reason: "Select exactly one connected Bay." },
		deleteAvailability: { state: "blocked", reason: "Select exactly one semantic Bay." },
		editFlowAvailability: {
			state: "blocked",
			reason: "Select exactly one runtime-recognized Twin Bay.",
		},
		blueprintCount: 3,
		productionBayTriggerRef: undefined,
		advancedInitiallyOpen: false,
		onNewFab: vi.fn(),
		onAddBay: vi.fn(),
		onOpenBlueprints: vi.fn(),
		onBrowseOrganizations: vi.fn(),
		onSelectOnCanvas: vi.fn(),
		onDuplicateSelection: vi.fn(),
		onConnectSelectedBays: vi.fn(),
		onDisconnectSelectedBay: vi.fn(),
		onDeleteSelectedBay: vi.fn(),
		onEditSelectedBayFlow: vi.fn(),
		onOpenLegacyAssemblies: vi.fn(),
		renderAdvancedRailMotifs: () => <div data-testid="advanced-content">motifs</div>,
		...overrides,
	};
}

describe("StaticFabAssembleMenu", () => {
	it("shows the separate Fab Delete review entry only for one Fab", () => {
		const fabDelete: NonNullable<StaticFabAssembleMenuProps["fabDelete"]> = {
			availability: { state: "ready", reason: "최상위 FAB의 독점 삭제 범위를 검토합니다." },
			onDelete: vi.fn(),
		};
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu {...props({ selectionCount: 1, selectedFabCount: 1, fabDelete })} />,
		);
		expect(markup).toContain("FAB 삭제…");
		expect(markup).not.toMatch(/data-testid="assemble-delete-selected-fab"[^>]*disabled/);
		expect(markup).not.toContain('data-testid="assemble-delete-selected-bank"');
		for (const selection of [
			{ selectionCount: 0, selectedFabCount: 0 },
			{ selectionCount: 2, selectedFabCount: 1 },
			{ selectionCount: 1, selectedFabCount: 0, selectedBankCount: 1 },
		]) {
			expect(
				renderToStaticMarkup(<StaticFabAssembleMenu {...props({ ...selection, fabDelete })} />),
			).not.toContain('data-testid="assemble-delete-selected-fab"');
		}
	});
	it("keeps the Fab deletion refusal visible beside its disabled entry", () => {
		const reason = "최상위 FAB만 삭제할 수 있습니다.";
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 1,
					selectedFabCount: 1,
					fabDelete: { availability: { state: "blocked", reason }, onDelete: vi.fn() },
				})}
			/>,
		);
		expect(markup).toContain(reason);
		expect(markup).toMatch(
			/data-testid="assemble-delete-selected-fab"[^>]*aria-describedby="tilefab-assemble-fab-delete-status"[^>]*disabled/,
		);
	});

	it("leads with task-level FAB commands and keeps motifs in Advanced", () => {
		const markup = renderToStaticMarkup(<StaticFabAssembleMenu {...props()} />);
		expect(markup).toContain("새 FAB 만들기");
		expect(markup).toContain("Bay 추가");
		expect(markup).toContain("청사진 배치");
		expect(markup).toContain("구조 목록");
		expect(markup).toContain("캔버스에서 선택");
		expect(markup).not.toContain("선택한 Bay");
		expect(markup).not.toContain("Bay 연결 해제…");
		expect(markup).not.toContain("Bay 삭제…");
		expect(markup).toContain('data-testid="assemble-select-on-canvas"');
		expect(markup).toContain('data-testid="assemble-browse-organizations"');
		expect(markup).toContain("선택한 구조 복제");
		expect(markup).not.toMatch(/>DUPLICATE</);
		expect(markup).toContain("고급 레일 패턴");
		expect(markup).toMatch(/<details class="tilefab-assemble-advanced">/);
		expect(markup).not.toMatch(/<details class="tilefab-assemble-advanced"[^>]*open/);
		expect(markup).not.toContain('data-testid="advanced-content"');
	});

	it("does not show irrelevant Bay commands for a selected Bank", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu {...props({ selectionCount: 1, selectedBankCount: 1 })} />,
		);
		expect(markup).toContain("조직 1개 선택");
		expect(markup).not.toContain("선택한 Bay");
		expect(markup).not.toContain('data-testid="assemble-disconnect-selected-bay"');
		expect(markup).not.toContain('data-testid="assemble-delete-selected-bay"');
	});

	it("shows only Bank detach and its blocked reason for one Bank", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 1,
					selectedBankCount: 1,
					bankDetach: {
						availability: { state: "blocked", reason: "다른 Bank와 연결 관계를 공유합니다." },
						onDetach: vi.fn(),
					},
				})}
			/>,
		);
		expect(markup).toContain("선택한 Bank");
		expect(markup).toContain("다른 Bank와 연결 관계를 공유합니다.");
		expect(markup).toMatch(/data-testid="assemble-detach-selected-bank"[^>]*disabled/);
		expect(markup).not.toContain("Bank 삭제");
		expect(markup).not.toContain('data-testid="assemble-disconnect-selected-bay"');
	});

	it("hides Bank detach outside a single-Bank selection", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 2,
					selectedBankCount: 2,
					bankDetach: { availability: { state: "ready", reason: "분리 검토" }, onDetach: vi.fn() },
				})}
			/>,
		);
		expect(markup).not.toContain('data-testid="assemble-detach-selected-bank"');
	});
	it("offers a separate Bank delete review with its own refusal reason", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 1,
					selectedBankCount: 1,
					bankDetach: { availability: { state: "ready", reason: "분리 검토" }, onDetach: vi.fn() },
					bankDelete: {
						availability: {
							state: "blocked",
							reason: "삭제 범위 밖의 Port를 포함하는 장비입니다.",
						},
						onDelete: vi.fn(),
					},
				})}
			/>,
		);
		expect(markup).toContain("Bank 분리…");
		expect(markup).toContain("Bank 삭제…");
		expect(markup).toContain("삭제 범위 밖의 Port를 포함하는 장비입니다.");
		expect(markup).toMatch(/data-testid="assemble-delete-selected-bank"[^>]*disabled/);
		expect(markup).not.toMatch(/data-testid="assemble-detach-selected-bank"[^>]*disabled/);
	});
	it("shows Bank delete only for one Bank, including a standalone Bank", () => {
		const bankDelete: NonNullable<StaticFabAssembleMenuProps["bankDelete"]> = {
			availability: { state: "ready", reason: "독립 Bank 삭제 검토" },
			onDelete: vi.fn(),
		};
		const render = (selectionCount: number, selectedBankCount: number) =>
			renderToStaticMarkup(
				<StaticFabAssembleMenu {...props({ selectionCount, selectedBankCount, bankDelete })} />,
			);
		expect(render(1, 1)).toContain('data-testid="assemble-delete-selected-bank"');
		expect(render(1, 1)).not.toContain('data-testid="assemble-detach-selected-bank"');
		expect(render(1, 0)).not.toContain('data-testid="assemble-delete-selected-bank"');
		expect(render(2, 2)).not.toContain('data-testid="assemble-delete-selected-bank"');
	});

	it("shows one selected-Bay row with independent semantic command availability", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 1,
					selectedBayCount: 1,
					disconnectAvailability: {
						state: "ready",
						reason: "Disconnect this Bay from its Bank.",
					},
					deleteAvailability: {
						state: "blocked",
						reason: "A connector port depends on this Bay.",
					},
					editFlowAvailability: {
						state: "ready",
						reason: "Choose one explicit Twin Bay flow target.",
					},
				})}
			/>,
		);

		expect(markup).toContain("선택한 Bay");
		expect(markup).toMatch(/data-testid="assemble-disconnect-selected-bay"(?![^>]*disabled)/);
		expect(markup).toMatch(/data-testid="assemble-delete-selected-bay"[^>]*disabled/);
		expect(markup).toMatch(
			/data-testid="assemble-edit-selected-bay-alternating"[^>]*data-target-pattern="alternating"(?![^>]*disabled)/,
		);
		expect(markup).toMatch(
			/data-testid="assemble-edit-selected-bay-co-rotating"[^>]*data-target-pattern="co-rotating"(?![^>]*disabled)/,
		);
		expect(markup).not.toContain("TOGGLE");
		expect(markup).toContain('data-testid="assemble-edit-flow-status"');
		expect(markup).toContain('data-testid="assemble-disconnect-status"');
		expect(markup).toContain('data-testid="assemble-delete-status"');
		expect(markup).toContain("Disconnect this Bay from its Bank.");
		expect(markup).toContain("A connector port depends on this Bay.");
	});

	it("switches the reviewed connector action to CONNECT BANKS for Interbay", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 2,
					selectedBankCount: 2,
					connectorHierarchyRole: "BANK_TO_FAB",
					connectorAvailability: {
						state: "ready",
						reason: "Connect two Banks through one Fab Interbay.",
					},
				})}
			/>,
		);
		expect(markup).toContain("CONNECT BANKS");
		expect(markup).toContain("2/2 BANKS · 2 SELECTED");
		expect(markup).toContain('data-connector-role="BANK_TO_FAB"');
	});

	it("switches the same-Fab Bank action to ADD FAB LOOP", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 2,
					selectedBankCount: 2,
					connectorHierarchyRole: "BANK_TO_FAB",
					connectorPurpose: "FAB_LOOP",
					connectorAvailability: {
						state: "ready",
						reason: "Add a second resilient route to the existing Fab.",
					},
				})}
			/>,
		);
		expect(markup).toContain("ADD FAB LOOP");
		expect(markup).toContain('data-connector-purpose="FAB_LOOP"');
		expect(markup).not.toContain("CONNECT BANKS");
	});

	it("does not present an empty or partial motif as a certified Fab hierarchy", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu {...props({ advancedInitiallyOpen: true })} />,
		);
		expect(markup).toContain("레일 전용 조립");
		expect(markup).toContain("Fab·Bank·Bay 조직을 만들지 않습니다");
		expect(markup).not.toContain("CERTIFIED · PARAMETRIC");
		expect(markup).not.toContain("OPEN END");
	});

	it("enables selection actions only when their semantic preconditions are met", () => {
		const emptyMarkup = renderToStaticMarkup(<StaticFabAssembleMenu {...props()} />);
		expect(emptyMarkup).toMatch(/data-testid="assemble-duplicate-selection"[^>]*disabled/);
		expect(emptyMarkup).toMatch(
			/data-testid="assemble-duplicate-selection"[^>]*data-capture-mode="EFFECTIVE"/,
		);
		expect(emptyMarkup).toMatch(/data-testid="assemble-connect-selected-bays"[^>]*disabled/);

		const duplicateReadyMarkup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 1,
					selectedBayCount: 1,
					duplicateAvailability: {
						state: "ready",
						reason: "Duplicate the selected hierarchy.",
					},
				})}
			/>,
		);
		expect(duplicateReadyMarkup).not.toMatch(
			/data-testid="assemble-duplicate-selection"[^>]*disabled/,
		);
		expect(duplicateReadyMarkup).toMatch(
			/data-testid="assemble-connect-selected-bays"[^>]*disabled/,
		);

		const connectorReadyMarkup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 2,
					selectedBayCount: 2,
					connectorAvailability: { state: "ready", reason: "Two Bays selected." },
				})}
			/>,
		);
		expect(connectorReadyMarkup).toMatch(/data-testid="assemble-duplicate-selection"[^>]*disabled/);
		expect(connectorReadyMarkup).not.toMatch(
			/data-testid="assemble-connect-selected-bays"[^>]*disabled/,
		);
		expect(connectorReadyMarkup).toContain('data-ready="true"');
		expect(connectorReadyMarkup).toContain("2/2 BAYS · 2 SELECTED");
	});

	it("does not advertise a selected but blocked Connector as ready", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 2,
					selectedBayCount: 2,
					connectorAvailability: {
						state: "blocked",
						reason: "Wait for the Rail mirror Worker.",
					},
				})}
			/>,
		);
		expect(markup).toMatch(/data-testid="assemble-connect-selected-bays"[^>]*disabled/);
		expect(markup).toContain('data-ready="false"');
		expect(markup).toContain("Wait for the Rail mirror Worker.");
	});

	it("renders each blocked action reason visibly and binds it to its button", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 1,
					selectedBayCount: 1,
					duplicateAvailability: {
						state: "blocked",
						reason: "Finish organization edits before duplicating.",
					},
					connectorAvailability: {
						state: "blocked",
						reason: "Wait for the Rail mirror Worker.",
					},
					editFlowAvailability: {
						state: "blocked",
						reason: "Choose one runtime-recognized Twin Bay.",
					},
				})}
			/>,
		);
		expect(markup).toMatch(
			/data-testid="assemble-duplicate-selection"[^>]*aria-describedby="tilefab-assemble-duplicate-status"/,
		);
		expect(markup).toMatch(
			/data-testid="assemble-connect-selected-bays"[^>]*aria-describedby="tilefab-assemble-connector-status"/,
		);
		expect(markup).toContain('data-testid="assemble-duplicate-status"');
		expect(markup).toContain("Finish organization edits before duplicating.");
		expect(markup).toContain('data-testid="assemble-connector-status"');
		expect(markup).toContain("Wait for the Rail mirror Worker.");
		expect(markup).toMatch(
			/data-testid="assemble-edit-selected-bay-alternating"[^>]*aria-describedby="tilefab-assemble-edit-flow-status"[^>]*disabled/,
		);
		expect(markup).toMatch(
			/data-testid="assemble-edit-selected-bay-co-rotating"[^>]*aria-describedby="tilefab-assemble-edit-flow-status"[^>]*disabled/,
		);
		expect(markup).toContain("Choose one runtime-recognized Twin Bay.");
	});
});

describe("non-detachable Bank support guidance", () => {
	it("keeps both commands blocked and offers the existing New Fab route once", () => {
		const availability = {
			state: "blocked",
			reason: "이 구성의 Bank 연결은 개별 분리를 지원하지 않습니다",
			supportNotice: "non-detachable-bank",
		} as const;
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 1,
					selectedBankCount: 1,
					bankDetach: { availability, onDetach: vi.fn() },
					bankDelete: { availability, onDelete: vi.fn() },
				})}
			/>,
		);
		expect(markup).toMatch(/data-testid="assemble-detach-selected-bank"[^>]*disabled/);
		expect(markup).toMatch(/data-testid="assemble-delete-selected-bank"[^>]*disabled/);
		expect(markup.match(/data-testid="assemble-bank-editing-support"/g)).toHaveLength(1);
		expect(markup).toContain("Bank 단독 분리·삭제를 지원하지 않습니다");
		expect(markup).toContain("선택한 구조 복제");
		expect(markup).toContain("새 FAB의 기본 구성");
		expect(markup).toContain('data-testid="assemble-new-fab-for-bank-editing"');
	});
	it.each([
		"ready",
		"blocked",
	] as const)("adds no support notice for an unrelated %s state", (state) => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu
				{...props({
					selectionCount: 1,
					selectedBankCount: 1,
					bankDetach: {
						availability: { state, reason: "현재 문서 동기화 상태" },
						onDetach: vi.fn(),
					},
				})}
			/>,
		);
		expect(markup).not.toContain('data-testid="assemble-bank-editing-support"');
		expect(markup).not.toContain('data-testid="assemble-new-fab-for-bank-editing"');
	});
});
