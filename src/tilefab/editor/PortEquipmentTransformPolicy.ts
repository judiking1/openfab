import type { EquipmentGroupRecord } from "../core/EquipmentGroup";

interface TransformCommandPresentation {
	readonly inspectorLabel: string;
	readonly inspectorTestId: string;
	readonly contextLabel: string;
}

interface PortEquipmentTransformPolicy {
	readonly editor: "single-port" | "group";
	readonly move: TransformCommandPresentation;
	readonly copy: TransformCommandPresentation;
}

const SINGLE_PORT_TRANSFORM = Object.freeze({
	editor: "single-port",
	move: Object.freeze({
		inspectorLabel: "위치 이동",
		inspectorTestId: "move-ohb-port",
		contextLabel: "포트 이동",
	}),
	copy: Object.freeze({
		inspectorLabel: "OHB 복제",
		inspectorTestId: "copy-ohb-port",
		contextLabel: "포트 복제",
	}),
} as const);

const GROUP_TRANSFORM = Object.freeze({
	editor: "group",
	move: Object.freeze({
		inspectorLabel: "장비 이동",
		inspectorTestId: "move-port-equipment-group",
		contextLabel: "그룹 전체 이동",
	}),
	copy: Object.freeze({
		inspectorLabel: "장비 복제",
		inspectorTestId: "copy-port-equipment-group",
		contextLabel: "그룹 전체 복제",
	}),
} as const);

const TRANSFORM_BY_KIND = Object.freeze({
	OHB: SINGLE_PORT_TRANSFORM,
	EQ: GROUP_TRANSFORM,
	STK: GROUP_TRANSFORM,
} satisfies Record<EquipmentGroupRecord["kind"], PortEquipmentTransformPolicy>);

/**
 * Route the existing move/copy commands; a new equipment kind requires an explicit entry.
 * This is presentation/routing, not permission: current selection, ownership, CUSTOM restrictions
 * and the chosen editor's live guards/planner must still decide whether the command can proceed.
 */
export function portEquipmentTransformPolicy(
	kind: EquipmentGroupRecord["kind"],
): PortEquipmentTransformPolicy {
	return TRANSFORM_BY_KIND[kind];
}
