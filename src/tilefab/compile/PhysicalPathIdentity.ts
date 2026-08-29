import type { CompiledPhysicalPaths } from "./PhysicalPathCompiler";

export const PHYSICAL_PATH_IDENTITY_WIDTH = 14;

/** Stable, ordering-independent identity for one compiled path's authored source. */
export function physicalPathIdentity(paths: CompiledPhysicalPaths, pathIndex: number): Int32Array {
	assertPathIndex(paths, pathIndex);
	const identity = new Int32Array(PHYSICAL_PATH_IDENTITY_WIDTH);
	for (let field = 0; field < identity.length; field++) {
		identity[field] = physicalPathIdentityFieldUnchecked(paths, pathIndex, field);
	}
	return identity;
}

export function comparePhysicalPathIdentity(
	paths: CompiledPhysicalPaths,
	leftPathIndex: number,
	rightPathIndex: number,
): number {
	assertPathIndex(paths, leftPathIndex);
	assertPathIndex(paths, rightPathIndex);
	for (let field = 0; field < PHYSICAL_PATH_IDENTITY_WIDTH; field++) {
		const difference =
			physicalPathIdentityFieldUnchecked(paths, leftPathIndex, field) -
			physicalPathIdentityFieldUnchecked(paths, rightPathIndex, field);
		if (difference !== 0) return difference;
	}
	return 0;
}

export function physicalPathIdentityKey(paths: CompiledPhysicalPaths, pathIndex: number): string {
	assertPathIndex(paths, pathIndex);
	let key = "";
	for (let field = 0; field < PHYSICAL_PATH_IDENTITY_WIDTH; field++) {
		if (field > 0) key += ":";
		key += physicalPathIdentityFieldUnchecked(paths, pathIndex, field).toString(16);
	}
	return key;
}

export function physicalPathIdentityField(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	field: number,
): number {
	assertPathIndex(paths, pathIndex);
	return physicalPathIdentityFieldUnchecked(paths, pathIndex, field);
}

function physicalPathIdentityFieldUnchecked(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	field: number,
): number {
	const cellOffset = pathIndex * 2;
	switch (field) {
		case 0:
			return paths.sourceKinds[pathIndex] as number;
		case 1:
			return paths.kinds[pathIndex] as number;
		case 2:
			return paths.cells[cellOffset] as number;
		case 3:
			return paths.cells[cellOffset + 1] as number;
		case 4:
			return paths.exitCells[cellOffset] as number;
		case 5:
			return paths.exitCells[cellOffset + 1] as number;
		case 6:
			return paths.fromDirections[pathIndex] as number;
		case 7:
			return paths.toDirections[pathIndex] as number;
		case 8:
			return paths.advancedSwitchIds[pathIndex] as number;
		case 9:
			return paths.advancedSwitchProfileClasses[pathIndex] as number;
		case 10:
			return paths.advancedSwitchSegmentRoles[pathIndex] as number;
		case 11:
			return paths.advancedSwitchSegmentPorts[pathIndex] as number;
		case 12:
			return paths.advancedSwitchSegmentOrdinals[pathIndex] as number;
		case 13:
			return paths.advancedSwitchCatalogProfiles[pathIndex] as number;
		default:
			throw new RangeError(`Physical path identity field ${field} is outside the identity width.`);
	}
}

function assertPathIndex(paths: CompiledPhysicalPaths, pathIndex: number): void {
	if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex >= paths.pathCount) {
		throw new RangeError(`Physical path index ${pathIndex} is outside the compiled layout.`);
	}
}
