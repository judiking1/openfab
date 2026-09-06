import { useEffect, useState } from "react";
import type { GuidedBuildPanelProps } from "./GuidedBuildPanel";

type Panel = typeof import("./GuidedBuildPanel").GuidedBuildPanel;
let loadedPanel: Panel | null = null;

/** Only the optional Guide surface is deferred; authored state and commands stay in the editor. */
export function DeferredGuidedBuildPanel(props: GuidedBuildPanelProps): React.ReactElement {
	const [PanelComponent, setPanel] = useState<Panel | null>(() => loadedPanel);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (PanelComponent) return;
		let current = true;
		void import("./GuidedBuildPanel").then(
			(module) => {
				loadedPanel = module.GuidedBuildPanel;
				if (current) setPanel(() => module.GuidedBuildPanel);
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
		<aside
			className="tilefab-guided-build-panel"
			aria-label="Guide 불러오기"
			data-testid="guided-build-loading"
		>
			<header>
				<strong>Guided Build</strong>
			</header>
			<div className="tilefab-guided-build-mission">
				<p role="status">
					{failed
						? "Guide를 불러오지 못했습니다. 편집은 계속할 수 있습니다. 프로젝트를 저장한 뒤 새로고침하여 Guide를 다시 열어 주세요."
						: "Guide를 불러오는 중입니다…"}
				</p>
				<div className="tilefab-guided-build-actions">
					<button type="button" onClick={props.onExit}>
						닫고 편집 계속
					</button>
				</div>
			</div>
		</aside>
	);
}
