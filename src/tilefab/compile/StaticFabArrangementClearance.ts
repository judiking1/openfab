import type { Cell } from "../core/TileMap";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";

/** Return authored reference cells for clearance conflicts introduced by one prospective layout. */
export function additionalStaticFabArrangementClearanceCells(
	before: CompiledPhysicalLayout,
	after: CompiledPhysicalLayout,
): readonly Cell[] {
	const existing = clearanceIssueKeys(before);
	const cells = new Map<string, Cell>();
	const issues = after.clearance.issues;
	for (let row = 0; row < issues.count; row++) {
		if (existing.has(clearanceIssueKey(issues, row))) continue;
		for (let offset = 0; offset < 2; offset++) {
			const x = issues.cells[row * 4 + offset * 2] as number;
			const y = issues.cells[row * 4 + offset * 2 + 1] as number;
			cells.set(`${x}:${y}`, Object.freeze({ x, y }));
		}
	}
	return Object.freeze(
		[...cells.values()].sort((left, right) => left.y - right.y || left.x - right.x),
	);
}

function clearanceIssueKeys(layout: CompiledPhysicalLayout): Set<string> {
	const keys = new Set<string>();
	for (let row = 0; row < layout.clearance.issues.count; row++) {
		keys.add(clearanceIssueKey(layout.clearance.issues, row));
	}
	return keys;
}

function clearanceIssueKey(
	issues: CompiledPhysicalLayout["clearance"]["issues"],
	row: number,
): string {
	const firstX = issues.cells[row * 4] as number;
	const firstY = issues.cells[row * 4 + 1] as number;
	const secondX = issues.cells[row * 4 + 2] as number;
	const secondY = issues.cells[row * 4 + 3] as number;
	const first = `${firstX}:${firstY}`;
	const second = `${secondX}:${secondY}`;
	return `${issues.codes[row]}:${first < second ? `${first}|${second}` : `${second}|${first}`}`;
}
