import { useEffect, useState } from "react";
import type { ProductionBayModulePanelProps } from "./ProductionBayModuleDialog";
import "./ProductionBayModuleDialog.css";

type Panel = typeof import("./ProductionBayModuleDialog").ProductionBayModulePanel;
let loadedPanel: Panel | null = null;

/** The placement session remains in the editor while its optional settings are loaded. */
export function DeferredProductionBayModulePanel(
	props: ProductionBayModulePanelProps,
): React.ReactElement {
	const [PanelComponent, setPanel] = useState<Panel | null>(() => loadedPanel);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (PanelComponent) return;
		let current = true;
		void import("./ProductionBayModuleDialog").then(
			(module) => {
				loadedPanel = module.ProductionBayModulePanel;
				if (current) setPanel(() => module.ProductionBayModulePanel);
			},
			() => {
				if (current) setFailed(true);
			},
		);
		return () => {
			current = false;
		};
	}, [PanelComponent]);
	if (PanelComponent) return <PanelComponent {...props} />;
	return (
		<section
			className="tilefab-production-bay-panel tilefab-production-bay-loading"
			aria-label="Bay 설정 불러오기"
			data-testid="production-bay-loading"
		>
			<p role="status" style={{ padding: "0 14px" }}>
				{failed
					? "Bay 설정을 불러오지 못했습니다. 현재 치수로 배치하거나 취소할 수 있습니다."
					: "Bay 설정을 불러오는 중입니다…"}
			</p>
			<footer>
				<button type="button" onClick={props.onCancel}>
					배치 취소
				</button>
				<button type="button" onClick={props.onClose}>
					현재 치수로 배치 계속
				</button>
			</footer>
		</section>
	);
}
