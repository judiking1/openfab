import {
	RAIL_ASSEMBLY_CONNECTOR_SCALE_PROBE_CELLS,
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_CELLS,
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_ROOT_COUNT,
	RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_CELLS,
} from "../worker/RailStartupProtocol";

export const RAIL_SCALE_PROBE_COUNTS = [
	10_000,
	50_000,
	RAIL_ASSEMBLY_CONNECTOR_SCALE_PROBE_CELLS,
	RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_CELLS,
	RAIL_BAY_FLOW_EDIT_SCALE_PROBE_CELLS,
] as const;

export const RAIL_EQUIPMENT_SCALE_PROBE_PORT_COUNT = 50_000;

export function parseRailScaleProbeCellCount(search: string): number {
	const parameters = new URLSearchParams(search);
	const value = Number(parameters.get("scaleFixture"));
	if (
		value === RAIL_ASSEMBLY_CONNECTOR_SCALE_PROBE_CELLS &&
		Number(parameters.get("scaleRoots")) !== 4
	) {
		return 0;
	}
	if (
		value === RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_CELLS &&
		Number(parameters.get("scaleRoots")) !== 2
	) {
		return 0;
	}
	if (
		value === RAIL_BAY_FLOW_EDIT_SCALE_PROBE_CELLS &&
		Number(parameters.get("scaleRoots")) !== RAIL_BAY_FLOW_EDIT_SCALE_PROBE_ROOT_COUNT
	) {
		return 0;
	}
	return RAIL_SCALE_PROBE_COUNTS.includes(value as (typeof RAIL_SCALE_PROBE_COUNTS)[number])
		? value
		: 0;
}

export function parseRailScaleProbeRootCount(search: string): 1 | 2 | 3 | 4 {
	const parameters = new URLSearchParams(search);
	const value = Number(parameters.get("scaleRoots"));
	if (
		value === 4 &&
		Number(parameters.get("scaleFixture")) === RAIL_ASSEMBLY_CONNECTOR_SCALE_PROBE_CELLS
	) {
		return 4;
	}
	return value === 2 || value === 3 ? value : 1;
}

export function parseRailEquipmentScaleProbePortCount(search: string): number {
	const parameters = new URLSearchParams(search);
	return Number(parameters.get("scaleFixture")) === RAIL_EQUIPMENT_SCALE_PROBE_PORT_COUNT &&
		Number(parameters.get("equipmentPorts")) === RAIL_EQUIPMENT_SCALE_PROBE_PORT_COUNT &&
		(parameters.get("scaleRoots") === null || Number(parameters.get("scaleRoots")) === 1)
		? RAIL_EQUIPMENT_SCALE_PROBE_PORT_COUNT
		: 0;
}
