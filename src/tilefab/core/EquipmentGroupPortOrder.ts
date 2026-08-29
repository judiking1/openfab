import type { EquipmentGroupRecord, StkEquipmentTemplate } from "./EquipmentGroup";
import type { PortRecord } from "./PortRecord";
import { moveCell } from "./railShape";
import { analyzeStkPortLayout } from "./StkPortLayout";

export type EquipmentGroupPortOrderDescriptor =
	| Readonly<{ kind: "OHB" }>
	| Readonly<{ kind: "EQ" }>
	| Readonly<{ kind: "STK"; template: StkEquipmentTemplate }>;

/** Canonical reciprocal order shared by direct edits, blueprints, validation, and serialization. */
export function canonicalEquipmentGroupPortIds(
	descriptor: EquipmentGroupPortOrderDescriptor,
	portIds: readonly number[],
	ports: readonly PortRecord[],
): readonly number[] {
	const portById = new Map(ports.map((port) => [port.id, port] as const));
	if (descriptor.kind === "OHB") return Object.freeze([...portIds]);
	if (descriptor.kind === "EQ") {
		const first = portById.get(portIds[0] as number);
		if (!first || first.route.kind !== "CARDINAL_CELL" || first.route.to === 0) {
			throw new Error("EQ first port route is not a directed cardinal route.");
		}
		const travel = moveCell({ x: 0, y: 0 }, first.route.to);
		return Object.freeze(
			[...portIds].sort((leftId, rightId) => {
				const left = portById.get(leftId);
				const right = portById.get(rightId);
				if (
					!left ||
					!right ||
					left.route.kind !== "CARDINAL_CELL" ||
					right.route.kind !== "CARDINAL_CELL"
				) {
					throw new Error("EQ port route is not a cardinal route.");
				}
				return (
					left.route.x * travel.x +
						left.route.z * travel.y -
						(right.route.x * travel.x + right.route.z * travel.y) || left.id - right.id
				);
			}),
		);
	}
	const analysis = analyzeStkPortLayout(
		portIds.map((portId) => {
			const port = portById.get(portId);
			if (!port || port.route.kind !== "CARDINAL_CELL") {
				throw new Error("STK port route is not a cardinal route.");
			}
			return {
				id: port.id,
				x: port.route.x,
				z: port.route.z,
				from: port.route.from,
				to: port.route.to,
				side: port.side,
				lateralOffsetMillimeters: port.lateralOffsetMillimeters,
				direction: port.direction,
			};
		}),
		descriptor.template,
	);
	if (!analysis.valid) throw new Error(analysis.reason);
	return Object.freeze([...analysis.orderedIds]);
}

export function equipmentGroupPortBarcode(
	kind: EquipmentGroupRecord["kind"],
	equipmentGroupId: number,
	portId: number,
	portIndex: number,
): string {
	if (kind === "OHB") return `OHB-${portId}`;
	return `${kind}-${equipmentGroupId}-P${String(portIndex + 1).padStart(2, "0")}`;
}

export function copyEquipmentGroupWithPortIds(
	source: EquipmentGroupRecord,
	id: number,
	portIds: readonly number[],
): EquipmentGroupRecord {
	const frozenPortIds = Object.freeze([...portIds]);
	if (source.kind === "OHB") {
		return Object.freeze({ id, kind: "OHB", template: source.template, portIds: frozenPortIds });
	}
	if (source.kind === "EQ") {
		return Object.freeze({
			id,
			kind: "EQ",
			pitchMillimeters: source.pitchMillimeters,
			recipe: source.recipe,
			portIds: frozenPortIds,
		});
	}
	return Object.freeze({
		id,
		kind: "STK",
		template: source.template,
		portIds: frozenPortIds,
	});
}
