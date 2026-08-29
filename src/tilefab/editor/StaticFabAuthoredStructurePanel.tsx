import { LibraryBig, Network } from "lucide-react";

export interface StaticFabAuthoredStructurePanelProps {
	readonly organizationCount: number;
	readonly onAddProductionBay: () => void;
	readonly onBrowseOrganizations: () => void;
}

/**
 * Routes an ad-hoc rail selection toward persisted FAB semantics.
 *
 * Geometry-derived Wing/Row/Bank suggestions deliberately do not appear here: Bay and Bank
 * identity comes from the authored organization DAG and the ordinary Assembly commands.
 */
export function StaticFabAuthoredStructurePanel({
	organizationCount,
	onAddProductionBay,
	onBrowseOrganizations,
}: StaticFabAuthoredStructurePanelProps): React.ReactElement {
	return (
		<section
			className="tilefab-authored-structure"
			aria-labelledby="tilefab-authored-structure-title"
			data-testid="static-fab-authored-structure"
		>
			<header>
				<span>
					<Network size={14} aria-hidden="true" />
					<strong id="tilefab-authored-structure-title">AUTHORED FAB STRUCTURE</strong>
				</span>
				<small>NO SHAPE GUESSING</small>
			</header>
			<ol aria-label="Persisted OpenFab hierarchy">
				<li>FAB</li>
				<li>BANK</li>
				<li>BAY</li>
				<li>PROCESS LOOP</li>
			</ol>
			<p>
				Bay와 Bank는 저장된 관계와 정확한 멤버십으로만 만듭니다. 현재 레일 형상을 의미 계층으로 자동
				승격하지 않습니다.
			</p>
			<div>
				<button type="button" data-testid="area-add-production-bay" onClick={onAddProductionBay}>
					<Network size={15} aria-hidden="true" /> ADD PRODUCTION BAY
				</button>
				<button
					type="button"
					data-testid="area-browse-organizations"
					onClick={onBrowseOrganizations}
				>
					<LibraryBig size={15} aria-hidden="true" /> BROWSE AUTHORED
					<small>{organizationCount.toLocaleString()}</small>
				</button>
			</div>
			<footer>두 Bay를 선택한 뒤 Assemble → Connect Bays로 Bank 관계를 만듭니다.</footer>
		</section>
	);
}
