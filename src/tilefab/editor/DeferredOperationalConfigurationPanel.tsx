import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OperationalConfigurationPanelProps } from "./OperationalConfigurationPanel";
import "./DeferredOperationalConfigurationPanel.css";

type Panel = typeof import("./OperationalConfigurationPanel").OperationalConfigurationPanel;
let loadedPanel: Panel | null = null;

/** Load the optional operational editor only after its capability-gated command opens it. */
export function DeferredOperationalConfigurationPanel(
	props: OperationalConfigurationPanelProps,
): React.ReactElement {
	const [PanelComponent, setPanel] = useState<Panel | null>(() => loadedPanel);
	const [failed, setFailed] = useState(false);
	const closeRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (PanelComponent) return;
		let current = true;
		void import("./OperationalConfigurationPanel").then(
			(module) => {
				loadedPanel = module.OperationalConfigurationPanel;
				if (current) setPanel(() => module.OperationalConfigurationPanel);
			},
			() => {
				if (current) setFailed(true);
			},
		);
		return () => {
			current = false;
		};
	}, [PanelComponent]);
	useLayoutEffect(() => {
		if (!PanelComponent) closeRef.current?.focus();
	}, [PanelComponent]);
	if (PanelComponent) return <PanelComponent {...props} />;
	return (
		<div className="tilefab-operational-loading-backdrop">
			<section
				className="tilefab-operational-loading"
				role="dialog"
				aria-modal="true"
				aria-labelledby="tilefab-operational-loading-title"
				aria-describedby="tilefab-operational-loading-status"
				data-testid="operational-configuration-loading"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						props.onClose();
					} else if (event.key === "Tab") {
						event.preventDefault();
						closeRef.current?.focus();
					}
				}}
			>
				<h2 id="tilefab-operational-loading-title">운영 설정</h2>
				<p id="tilefab-operational-loading-status" role="status">
					{failed
						? "운영 설정을 불러오지 못했습니다. 닫고 편집을 계속할 수 있습니다. 저장 후 새로고침하여 다시 열어 주세요."
						: "운영 설정을 불러오는 중입니다…"}
				</p>
				<button ref={closeRef} type="button" aria-label="운영 설정 닫기" onClick={props.onClose}>
					닫기
				</button>
			</section>
		</div>
	);
}
