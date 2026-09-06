import type { ReactNode } from "react";
import type { PortType } from "../core/PortRecord";
import { observePortDockClearance } from "./observePortDockClearance";

interface EquipmentAuthoringWorkspaceProps {
	readonly portType: PortType;
	readonly intent: "place" | "move" | "copy";
	readonly heading: ReactNode;
	readonly exit: ReactNode;
	readonly selection: ReactNode;
	readonly settings?: ReactNode;
	readonly actions?: ReactNode;
	readonly continuation?: ReactNode;
	readonly optionalSettings?: ReactNode;
}

/** Presents the current canonical equipment draft; commands and validation stay with its owner. */
export function EquipmentAuthoringWorkspace({
	portType,
	intent,
	heading,
	exit,
	selection,
	settings,
	actions,
	continuation,
	optionalSettings,
}: EquipmentAuthoringWorkspaceProps): ReactNode {
	return (
		<section
			className="tilefab-buildbar tilefab-port-buildbar tilefab-equipment-workspace"
			ref={observePortDockClearance}
			data-port-type={portType}
			data-port-intent={intent}
			aria-label={`${portType === "STK" ? "Stocker" : portType} 장비 배치`}
		>
			<header className="tilefab-equipment-heading">
				<div className="tilefab-equipment-intro">
					{heading}
					<p>
						{intent === "move"
							? "선택한 장비를 새 Port 위치로 옮깁니다."
							: intent === "copy"
								? "선택한 장비를 새 Port 위치에 복제합니다."
								: portType === "OHB"
									? "Port 한 곳에 OHB 하나를 만듭니다."
									: portType === "EQ"
										? "직선의 여러 Port를 한 공정 장비에 연결합니다."
										: "선택한 Port를 하나의 Stocker로 묶습니다."}
					</p>
				</div>
				{exit}
			</header>
			<div className="tilefab-equipment-selection">{selection}</div>
			{settings ? <div className="tilefab-equipment-settings">{settings}</div> : null}
			{actions ? <div className="tilefab-equipment-actions">{actions}</div> : null}
			{continuation ? <div className="tilefab-equipment-next">{continuation}</div> : null}
			{optionalSettings ? (
				<details className="tilefab-equipment-options">
					<summary>추가 설정</summary>
					{optionalSettings}
				</details>
			) : null}
		</section>
	);
}
