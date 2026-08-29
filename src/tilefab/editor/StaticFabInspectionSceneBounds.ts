import type { CompiledPortEquipmentPresentation } from "../compile/PortEquipmentPresentation";
import type { StaticFabInspectionBounds3D } from "./StaticFabInspectionCamera";

type InspectionEquipmentBoundsSource = Pick<
	CompiledPortEquipmentPresentation,
	| "count"
	| "worldPositions"
	| "groupKinds"
	| "bodySectionCount"
	| "bodySectionGroupRows"
	| "bodySectionBounds"
>;

const EQUIPMENT_BODY_HEIGHT_METERS = Object.freeze([0.42, 2.3, 3.25] as const);
const EQUIPMENT_OPENING_CENTER_Y_METERS = Object.freeze([0, 1.45, 2.05] as const);
const EQUIPMENT_BODY_PICK_EXTRA_HEIGHT_METERS = 0.25;
const PORT_MARKER_HALF_EXTENT_METERS = 0.15;

export function staticFabInspectionEquipmentBodyHeight(kindRow: number): number {
	const height = EQUIPMENT_BODY_HEIGHT_METERS[kindRow];
	if (height === undefined) throw new RangeError("3D equipment kind row is out of range.");
	return height;
}

export function staticFabInspectionEquipmentBodyCenterY(
	kindRow: number,
	railTopElevationMeters: number,
): number {
	const height = staticFabInspectionEquipmentBodyHeight(kindRow);
	return kindRow === 0 ? railTopElevationMeters - 0.52 : height / 2;
}

export function staticFabInspectionEquipmentPickHeight(kindRow: number): number {
	return staticFabInspectionEquipmentBodyHeight(kindRow) + EQUIPMENT_BODY_PICK_EXTRA_HEIGHT_METERS;
}

export function staticFabInspectionEquipmentOpeningCenterY(
	kindRow: number,
	railTopElevationMeters: number,
): number {
	if (kindRow === 0) return railTopElevationMeters - 0.52;
	const centerY = EQUIPMENT_OPENING_CENTER_Y_METERS[kindRow];
	if (centerY === undefined) throw new RangeError("3D equipment kind row is out of range.");
	return centerY;
}

export function staticFabInspectionCombinedBounds(
	railBounds: StaticFabInspectionBounds3D,
	railTopElevationMeters: number,
	equipment: InspectionEquipmentBoundsSource,
): StaticFabInspectionBounds3D {
	let minX = railBounds.minX;
	let minY = railBounds.minY;
	let minZ = railBounds.minZ;
	let maxX = railBounds.maxX;
	let maxY = railBounds.maxY;
	let maxZ = railBounds.maxZ;

	for (let sectionRow = 0; sectionRow < equipment.bodySectionCount; sectionRow++) {
		const boundsOffset = sectionRow * 4;
		const groupRow = equipment.bodySectionGroupRows[sectionRow] as number;
		const kindRow = equipment.groupKinds[groupRow] as number;
		const height = staticFabInspectionEquipmentBodyHeight(kindRow);
		const centerY = staticFabInspectionEquipmentBodyCenterY(kindRow, railTopElevationMeters);
		minX = Math.min(minX, equipment.bodySectionBounds[boundsOffset] as number);
		minZ = Math.min(minZ, equipment.bodySectionBounds[boundsOffset + 1] as number);
		maxX = Math.max(maxX, equipment.bodySectionBounds[boundsOffset + 2] as number);
		maxZ = Math.max(maxZ, equipment.bodySectionBounds[boundsOffset + 3] as number);
		minY = Math.min(minY, centerY - height / 2);
		maxY = Math.max(maxY, centerY + height / 2);
	}

	const portCenterY = railTopElevationMeters - 0.34;
	for (let portRow = 0; portRow < equipment.count; portRow++) {
		const offset = portRow * 2;
		const x = equipment.worldPositions[offset] as number;
		const z = equipment.worldPositions[offset + 1] as number;
		minX = Math.min(minX, x - PORT_MARKER_HALF_EXTENT_METERS);
		minY = Math.min(minY, portCenterY - PORT_MARKER_HALF_EXTENT_METERS);
		minZ = Math.min(minZ, z - PORT_MARKER_HALF_EXTENT_METERS);
		maxX = Math.max(maxX, x + PORT_MARKER_HALF_EXTENT_METERS);
		maxY = Math.max(maxY, portCenterY + PORT_MARKER_HALF_EXTENT_METERS);
		maxZ = Math.max(maxZ, z + PORT_MARKER_HALF_EXTENT_METERS);
	}

	return Object.freeze({ minX, minY, minZ, maxX, maxY, maxZ });
}
