import {
	OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
	type PortSide,
	type PortType,
} from "./PortRecord";

export interface PortSlotPolicy {
	readonly portType: PortType;
	readonly sides: readonly PortSide[];
	readonly lateralOffsetMillimeters: number;
	readonly footprintRadiusMillimeters: number;
	readonly minimumPortSpacingMillimeters: number;
}

export const OPENFAB_PORT_SLOT_POLICIES: Readonly<Record<PortType, PortSlotPolicy>> = Object.freeze(
	{
		OHB: Object.freeze({
			portType: "OHB",
			sides: Object.freeze(["LEFT", "RIGHT"] as const),
			lateralOffsetMillimeters: 700,
			footprintRadiusMillimeters: 150,
			minimumPortSpacingMillimeters: OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
		}),
		EQ: Object.freeze({
			portType: "EQ",
			sides: Object.freeze(["CENTER"] as const),
			lateralOffsetMillimeters: 0,
			footprintRadiusMillimeters: 150,
			minimumPortSpacingMillimeters: OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
		}),
		STK: Object.freeze({
			portType: "STK",
			sides: Object.freeze(["CENTER"] as const),
			lateralOffsetMillimeters: 0,
			footprintRadiusMillimeters: 180,
			minimumPortSpacingMillimeters: OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS,
		}),
	},
);

// Certified 100k-linear-path boundary plus bounded headroom for one maximum-gap Bay connector.
export const PORT_SLOT_MAX_ROWS = 204_096;

export function assertPortSlotRowBudget(count: number): void {
	if (!Number.isSafeInteger(count) || count < 0 || count > PORT_SLOT_MAX_ROWS) {
		throw new Error(
			`장비 배치 위치가 ${count.toLocaleString("en-US")}개로 현재 지원 한도 ${PORT_SLOT_MAX_ROWS.toLocaleString("en-US")}개를 넘습니다. 레일 수를 줄이거나 별도 프로젝트에 배치하세요.`,
		);
	}
}

export function assertRailGeometryBudget(count: number, maximum = PORT_SLOT_MAX_ROWS): void {
	if (!Number.isSafeInteger(count) || count < 0 || count > maximum) {
		throw new Error(
			"레일 계산 규모가 현재 지원 한도를 넘습니다. 레일 수를 줄이거나 별도 프로젝트에 배치하세요.",
		);
	}
}
