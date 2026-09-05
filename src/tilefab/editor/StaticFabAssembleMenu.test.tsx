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
	it("leads with task-level FAB commands and keeps motifs in Advanced", () => {
		const markup = renderToStaticMarkup(<StaticFabAssembleMenu {...props()} />);
		expect(markup).toContain("NEW FAB");
		expect(markup).toContain("ADD BAY");
		expect(markup).toContain("PLACE BLUEPRINT");
		expect(markup).toContain("BROWSE ORGANIZATIONS");
		expect(markup).toContain("SELECT ON CANVAS");
		expect(markup).not.toContain("SELECTED BAY");
		expect(markup).not.toContain("DISCONNECT BAY…");
		expect(markup).not.toContain("DELETE BAY…");
		expect(markup).toContain('data-testid="assemble-select-on-canvas"');
		expect(markup).toContain('data-testid="assemble-browse-organizations"');
		expect(markup).toContain("DUPLICATE ORGANIZATION");
		expect(markup).not.toMatch(/>DUPLICATE</);
		expect(markup).toContain("ADVANCED RAIL MOTIFS");
		expect(markup).toMatch(/<details class="tilefab-assemble-advanced">/);
		expect(markup).not.toMatch(/<details class="tilefab-assemble-advanced"[^>]*open/);
		expect(markup).not.toContain('data-testid="advanced-content"');
	});

	it("does not show irrelevant Bay commands for a selected Bank", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssembleMenu {...props({ selectionCount: 1, selectedBankCount: 1 })} />,
		);
		expect(markup).toContain("1 ORGANIZATION");
		expect(markup).not.toContain("SELECTED BAY");
		expect(markup).not.toContain('data-testid="assemble-disconnect-selected-bay"');
		expect(markup).not.toContain('data-testid="assemble-delete-selected-bay"');
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

		expect(markup).toContain("SELECTED BAY");
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
		expect(markup).toContain("RAIL-ONLY ASSEMBLIES");
		expect(markup).toContain("do not create a complete Fab, Bank, or Bay organization");
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
