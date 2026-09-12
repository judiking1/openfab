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
							? "입출고 지점(포트)을 골라 장비 전체를 옮깁니다."
							: intent === "copy"
								? "입출고 지점(포트)을 골라 장비 전체를 복제합니다."
								: portType === "OHB"
									? "입출고 지점(포트) 한 곳을 고르면 OHB가 생성됩니다."
									: portType === "EQ"
										? "같은 직선의 입출고 지점(포트)에서 시작과 끝을 고르면 EQ가 생성됩니다."
										: "입출고 지점(포트)을 고른 뒤 ‘Stocker 생성’을 누르세요."}
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
