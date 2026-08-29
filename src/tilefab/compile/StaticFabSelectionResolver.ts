import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { RailAreaSelection, RailAreaSelectionBounds } from "../core/RailAreaSelection";
import { moveCell, type Direction } from "../core/railShape";
import type { CompiledPortEquipmentPresentation } from "./PortEquipmentPresentation";

export interface StaticFabEquipmentGroupSelectionResolution {
	readonly completeGroupIds: readonly number[];
	readonly partialGroupIds: readonly number[];
}

/** Resolve complete equipment groups intersecting an inclusive cell-area marquee. */
export function resolveStaticFabEquipmentGroupsInBounds(
	presentation: CompiledPortEquipmentPresentation | null,
	bounds: RailAreaSelectionBounds,
): readonly number[] {
	if (!presentation || presentation.equipmentGroupCount === 0) return Object.freeze([]);
	const worldBounds = {
		minX: bounds.minX,
		minZ: bounds.minY,
		maxX: bounds.maxX + 1,
		maxZ: bounds.maxY + 1,
	};
	const selected = new Set<number>();
	for (let groupRow = 0; groupRow < presentation.equipmentGroupCount; groupRow++) {
		const sectionStart = presentation.groupBodySectionOffsets[groupRow] as number;
		const sectionEnd = presentation.groupBodySectionOffsets[groupRow + 1] as number;
		let intersects = false;
		for (let sectionRow = sectionStart; sectionRow < sectionEnd; sectionRow++) {
			const offset = sectionRow * 4;
			if (
				(presentation.bodySectionBounds[offset] as number) < worldBounds.maxX &&
				(presentation.bodySectionBounds[offset + 2] as number) > worldBounds.minX &&
				(presentation.bodySectionBounds[offset + 1] as number) < worldBounds.maxZ &&
				(presentation.bodySectionBounds[offset + 3] as number) > worldBounds.minZ
			) {
				intersects = true;
				break;
			}
		}
		if (!intersects) {
			const portStart = presentation.groupPortOffsets[groupRow] as number;
			const portEnd = presentation.groupPortOffsets[groupRow + 1] as number;
			for (let index = portStart; index < portEnd; index++) {
				const portRow = presentation.groupPortRows[index] as number;
				const x = presentation.worldPositions[portRow * 2] as number;
				const z = presentation.worldPositions[portRow * 2 + 1] as number;
				if (
					x >= worldBounds.minX &&
					x < worldBounds.maxX &&
					z >= worldBounds.minZ &&
					z < worldBounds.maxZ
				) {
					intersects = true;
					break;
				}
			}
		}
		if (intersects) selected.add(presentation.groupIds[groupRow] as number);
	}
	return Object.freeze([...selected].sort((left, right) => left - right));
}

/**
 * Resolve equipment against exact selected rail ownership instead of its rectangular envelope.
 *
 * A complete group is returned only when every member port's authored route is supported by the
 * selected rail. Boundary-spanning groups remain explicit partials and are never silently copied.
 */
export function resolveStaticFabEquipmentGroupsForRailSelection(
	state: PortEquipmentState,
	selection: RailAreaSelection,
): StaticFabEquipmentGroupSelectionResolution {
	const selectedEdges = new Set<string>();
	const selectedSwitchIds = new Set<number>();
	for (const ownership of selection.ownerships) {
		for (const edge of ownership.eraseEdges) selectedEdges.add(edgeKey(edge.from, edge.to));
		if (ownership.advancedSwitchId !== null) selectedSwitchIds.add(ownership.advancedSwitchId);
	}
	const portsById = new Map(state.ports.map((port) => [port.id, port]));
	const completeGroupIds: number[] = [];
	const partialGroupIds: number[] = [];
	for (const group of state.equipmentGroups) {
		let supported = 0;
		for (const portId of group.portIds) {
			const port = portsById.get(portId);
			if (port && portRouteSupported(port.route, selectedEdges, selectedSwitchIds)) supported++;
		}
		if (supported === group.portIds.length) completeGroupIds.push(group.id);
		else if (supported > 0) partialGroupIds.push(group.id);
	}
	return Object.freeze({
		completeGroupIds: Object.freeze(completeGroupIds.sort((left, right) => left - right)),
		partialGroupIds: Object.freeze(partialGroupIds.sort((left, right) => left - right)),
	});
}

function portRouteSupported(
	route: PortEquipmentState["ports"][number]["route"],
	selectedEdges: ReadonlySet<string>,
	selectedSwitchIds: ReadonlySet<number>,
): boolean {
	if (route.kind === "ADVANCED_SWITCH_SEGMENT") return selectedSwitchIds.has(route.switchId);
	const cell = { x: route.x, y: route.z };
	if (route.from !== 0) {
		const source = moveCell(cell, route.from as Direction);
		if (!selectedEdges.has(edgeKey(source, cell))) return false;
	}
	if (route.to !== 0) {
		const target = moveCell(cell, route.to as Direction);
		if (!selectedEdges.has(edgeKey(cell, target))) return false;
	}
	return true;
}

function edgeKey(
	from: Readonly<{ x: number; y: number }>,
	to: Readonly<{ x: number; y: number }>,
): string {
	return `${from.x}:${from.y}>${to.x}:${to.y}`;
}
