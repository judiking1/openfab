import {
	ChevronRight,
	Copy,
	Factory,
	FolderOpen,
	LayoutTemplate,
	LibraryBig,
	Link2,
	Network,
	RefreshCw,
	Trash2,
	Unlink,
} from "lucide-react";
import { type ReactNode, type Ref, useState } from "react";
import type { ProductionBayInternalFlowPattern } from "../core/ProductionBayModulePlanner";
import type {
	StaticFabAssemblyConnectorHierarchyRole,
	StaticFabAssemblyConnectorPurpose,
} from "../core/StaticFabAssemblyConnector";
import "./StaticFabSemanticBayMutationDialog.css";

export const STATIC_FAB_ASSEMBLE_DUPLICATE_CAPTURE_MODE = "EFFECTIVE" as const;

export interface StaticFabAssembleMenuProps {
	readonly selectionCount: number;
	readonly selectedBayCount: number;
	readonly selectedBankCount: number;
	readonly connectorHierarchyRole: StaticFabAssemblyConnectorHierarchyRole | null;
	readonly connectorPurpose: StaticFabAssemblyConnectorPurpose | null;
	readonly duplicateAvailability: StaticFabAssembleActionAvailability;
	readonly connectorAvailability: StaticFabAssembleActionAvailability;
	readonly disconnectAvailability: StaticFabAssembleActionAvailability;
	readonly deleteAvailability: StaticFabAssembleActionAvailability;
	readonly editFlowAvailability: StaticFabAssembleActionAvailability;
	readonly blueprintCount: number;
	readonly productionBayTriggerRef?: Ref<HTMLButtonElement>;
	readonly advancedInitiallyOpen?: boolean;
	readonly onNewFab: () => void;
	readonly onAddBay: () => void;
	readonly onOpenBlueprints: () => void;
	readonly onBrowseOrganizations: () => void;
	readonly onSelectOnCanvas: () => void;
	readonly onDuplicateSelection: () => void;
	readonly onConnectSelectedBays: () => void;
	readonly onDisconnectSelectedBay: (launcher: HTMLButtonElement) => void;
	readonly onDeleteSelectedBay: (launcher: HTMLButtonElement) => void;
	readonly onEditSelectedBayFlow: (
		target: ProductionBayInternalFlowPattern,
		launcher: HTMLButtonElement,
	) => void;
	readonly onOpenLegacyAssemblies: () => void;
	readonly renderAdvancedRailMotifs: () => ReactNode;
}

export interface StaticFabAssembleActionAvailability {
	readonly state: "ready" | "blocked";
	readonly reason: string;
}

export function StaticFabAssembleMenu({
	selectionCount,
	selectedBayCount,
	selectedBankCount,
	connectorHierarchyRole,
	connectorPurpose,
	duplicateAvailability,
	connectorAvailability,
	disconnectAvailability,
	deleteAvailability,
	editFlowAvailability,
	blueprintCount,
	productionBayTriggerRef,
	advancedInitiallyOpen = false,
	onNewFab,
	onAddBay,
	onOpenBlueprints,
	onBrowseOrganizations,
	onSelectOnCanvas,
	onDuplicateSelection,
	onConnectSelectedBays,
	onDisconnectSelectedBay,
	onDeleteSelectedBay,
	onEditSelectedBayFlow,
	onOpenLegacyAssemblies,
	renderAdvancedRailMotifs,
}: StaticFabAssembleMenuProps): React.ReactElement {
	const [advancedOpen, setAdvancedOpen] = useState(advancedInitiallyOpen);

	return (
		<section className="tilefab-assemble-menu" data-testid="static-fab-assemble-menu">
			<ol className="tilefab-assemble-hierarchy" aria-label="OpenFab FAB hierarchy">
				<li>FAB</li>
				<li>BANK</li>
				<li>BAY</li>
				<li>PROCESS LOOP</li>
			</ol>

			<button
				type="button"
				className="tilefab-assemble-primary"
				data-testid="fab-preset-browser"
				onClick={onNewFab}
			>
				<span className="tilefab-assemble-action-icon">
					<Factory size={24} />
				</span>
				<span>
					<small>START A PROJECT</small>
					<strong>NEW FAB</strong>
					<em>Generate banks, Bay circulation, gateways, and a closed directed network.</em>
				</span>
				<ChevronRight size={18} />
			</button>

			<section className="tilefab-assemble-section" aria-labelledby="tilefab-assemble-add-title">
				<header>
					<span>
						<LayoutTemplate size={14} />
						<strong id="tilefab-assemble-add-title">ADD TO CURRENT FAB</strong>
					</span>
					<small>Semantic assemblies first</small>
				</header>
				<div className="tilefab-assemble-action-grid">
					<button
						type="button"
						data-testid="production-bay-module-browser"
						ref={productionBayTriggerRef}
						onClick={onAddBay}
					>
						<span className="tilefab-assemble-action-icon">
							<Network size={20} />
						</span>
						<span>
							<strong>ADD BAY</strong>
							<small>Single or Twin Process Loop</small>
						</span>
					</button>
					<button type="button" data-testid="assemble-open-blueprints" onClick={onOpenBlueprints}>
						<span className="tilefab-assemble-action-icon">
							<LibraryBig size={20} />
						</span>
						<span>
							<strong>PLACE BLUEPRINT</strong>
							<small>{blueprintCount.toLocaleString()} saved and reusable</small>
						</span>
					</button>
				</div>
			</section>

			<section
				className="tilefab-assemble-section tilefab-assemble-selection"
				aria-labelledby="tilefab-assemble-selection-title"
				data-selection-count={selectionCount}
			>
				<header>
					<span>
						<FolderOpen size={14} />
						<strong id="tilefab-assemble-selection-title">SELECTION</strong>
					</span>
					<small>
						{selectionCount === 0
							? "Choose a Fab, Bank, or Bay"
							: `${selectionCount.toLocaleString()} ORGANIZATION${selectionCount === 1 ? "" : "S"}`}
					</small>
				</header>
				<div className="tilefab-assemble-selection-actions">
					<button
						type="button"
						data-testid="assemble-browse-organizations"
						onClick={onBrowseOrganizations}
					>
						<LibraryBig size={16} /> BROWSE ORGANIZATIONS
					</button>
					<button type="button" data-testid="assemble-select-on-canvas" onClick={onSelectOnCanvas}>
						<FolderOpen size={16} /> SELECT ON CANVAS
					</button>
					<button
						type="button"
						data-testid="assemble-duplicate-selection"
						data-capture-mode={STATIC_FAB_ASSEMBLE_DUPLICATE_CAPTURE_MODE}
						aria-describedby="tilefab-assemble-duplicate-status"
						disabled={duplicateAvailability.state !== "ready"}
						onClick={onDuplicateSelection}
						title={duplicateAvailability.reason}
					>
						<Copy size={16} /> DUPLICATE
					</button>
					<button
						type="button"
						className="tilefab-assemble-connect"
						data-testid="assemble-connect-selected-bays"
						data-connector-role={connectorHierarchyRole ?? "unavailable"}
						data-connector-purpose={connectorPurpose ?? "unavailable"}
						aria-keyshortcuts="J"
						aria-describedby="tilefab-assemble-connector-status"
						disabled={connectorAvailability.state !== "ready"}
						onClick={onConnectSelectedBays}
						title={connectorAvailability.reason}
					>
						<Link2 size={16} />{" "}
						{connectorPurpose === "FAB_LOOP"
							? "ADD FAB LOOP"
							: connectorHierarchyRole === "BANK_TO_FAB"
								? "CONNECT BANKS"
								: "CONNECT BAYS"}
					</button>
				</div>
				<div className="tilefab-assemble-availability" aria-live="polite">
					<p
						id="tilefab-assemble-duplicate-status"
						data-testid="assemble-duplicate-status"
						data-ready={duplicateAvailability.state === "ready"}
					>
						<span>DUPLICATE</span>
						{duplicateAvailability.reason}
					</p>
					<p
						id="tilefab-assemble-connector-status"
						data-testid="assemble-connector-status"
						data-ready={connectorAvailability.state === "ready"}
					>
						<span>
							{connectorHierarchyRole === "BANK_TO_FAB"
								? `${selectedBankCount}/2 BANKS`
								: `${selectedBayCount}/2 BAYS`}{" "}
							· {selectionCount} SELECTED
						</span>
						{connectorAvailability.reason}
					</p>
				</div>
				<section className="tilefab-assemble-semantic-bay" aria-label="Selected Bay commands">
					<header>
						<span>SELECTED BAY</span>
						<small className="tilefab-assemble-semantic-bay-header-detail">
							{selectedBayCount === 1 ? "Semantic Bay actions" : "Select exactly one Bay"}
						</small>
					</header>
					<div className="tilefab-assemble-semantic-bay-actions">
						<button
							type="button"
							data-testid="assemble-edit-selected-bay-alternating"
							data-target-pattern="alternating"
							aria-describedby="tilefab-assemble-edit-flow-status"
							disabled={editFlowAvailability.state !== "ready"}
							title={editFlowAvailability.reason}
							onClick={(event) => onEditSelectedBayFlow("alternating", event.currentTarget)}
						>
							<RefreshCw size={15} /> SET ALTERNATING…
						</button>
						<button
							type="button"
							data-testid="assemble-edit-selected-bay-co-rotating"
							data-target-pattern="co-rotating"
							aria-describedby="tilefab-assemble-edit-flow-status"
							disabled={editFlowAvailability.state !== "ready"}
							title={editFlowAvailability.reason}
							onClick={(event) => onEditSelectedBayFlow("co-rotating", event.currentTarget)}
						>
							<RefreshCw size={15} /> SET CO-ROTATING…
						</button>
						<button
							type="button"
							data-testid="assemble-disconnect-selected-bay"
							aria-describedby="tilefab-assemble-disconnect-status"
							disabled={disconnectAvailability.state !== "ready"}
							title={disconnectAvailability.reason}
							onClick={(event) => onDisconnectSelectedBay(event.currentTarget)}
						>
							<Unlink size={15} /> DISCONNECT BAY…
						</button>
						<button
							type="button"
							data-testid="assemble-delete-selected-bay"
							aria-describedby="tilefab-assemble-delete-status"
							disabled={deleteAvailability.state !== "ready"}
							title={deleteAvailability.reason}
							onClick={(event) => onDeleteSelectedBay(event.currentTarget)}
						>
							<Trash2 size={15} /> DELETE BAY…
						</button>
					</div>
					<div className="tilefab-assemble-semantic-bay-statuses" aria-live="polite">
						<p
							id="tilefab-assemble-edit-flow-status"
							data-testid="assemble-edit-flow-status"
							data-ready={editFlowAvailability.state === "ready"}
						>
							<span>FLOW TARGET</span>
							{editFlowAvailability.reason}
						</p>
						<p
							id="tilefab-assemble-disconnect-status"
							data-testid="assemble-disconnect-status"
							data-ready={disconnectAvailability.state === "ready"}
						>
							<span>DISCONNECT</span>
							{disconnectAvailability.reason}
						</p>
						<p
							id="tilefab-assemble-delete-status"
							data-testid="assemble-delete-status"
							data-ready={deleteAvailability.state === "ready"}
						>
							<span>DELETE</span>
							{deleteAvailability.reason}
						</p>
					</div>
				</section>
			</section>

			<details
				className="tilefab-assemble-advanced"
				open={advancedOpen}
				onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
			>
				<summary>
					<span>
						<LayoutTemplate size={15} />
						<strong>ADVANCED RAIL MOTIFS</strong>
						<small>Independent closed rail stamps</small>
					</span>
					<ChevronRight size={16} />
				</summary>
				{advancedOpen ? (
					<div className="tilefab-assemble-advanced-body">
						<p data-testid="contextual-rail-tool-guidance">
							Closed motifs start here and do not create a complete Fab, Bank, or Bay organization.
							Select a straight rail or open terminal on Canvas to reveal Return, Bypass, and
							terminal repair commands.
						</p>
						<button
							type="button"
							className="tilefab-assemble-legacy"
							data-testid="synthetic-fab-pattern-browser"
							onClick={onOpenLegacyAssemblies}
						>
							<span className="tilefab-assemble-action-icon">
								<LayoutTemplate size={18} />
							</span>
							<span>
								<strong>RAIL-ONLY ASSEMBLIES</strong>
								<small>Compatibility tools for reusable area stamps</small>
							</span>
							<ChevronRight size={16} />
						</button>
						{renderAdvancedRailMotifs()}
					</div>
				) : null}
			</details>
		</section>
	);
}
