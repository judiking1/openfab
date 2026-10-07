import type { ReactNode } from "react";
import type { PortType } from "../core/PortRecord";
import { observePortDockClearance } from "./observePortDockClearance";

interface EquipmentAuthoringWorkspaceProps {
	readonly portType: PortType;
	readonly intent: "place" | "move" | "copy";
	readonly heading: ReactNode;
	readonly exit: ReactNode;
	readonly exitInActions?: boolean;
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
	exitInActions = false,
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
				<div className="tilefab-equipment-intro">{heading}</div>
				{exitInActions ? null : exit}
			</header>
			<div className="tilefab-equipment-scroll-content">
				<div className="tilefab-equipment-selection">{selection}</div>
				{settings ? <div className="tilefab-equipment-settings">{settings}</div> : null}
				{continuation ? <div className="tilefab-equipment-next">{continuation}</div> : null}
				{optionalSettings ? (
					<details className="tilefab-equipment-options">
						<summary>추가 설정</summary>
						{optionalSettings}
					</details>
				) : null}
			</div>
			{actions ? (
				<div className="tilefab-equipment-actions">
					{exitInActions ? exit : null}
					{actions}
				</div>
			) : null}
		</section>
	);
}
