import type { Cell } from "../core/TileMap";

/** OpenFab-owned synthetic dimensions; one fixed rail-only layout, without Bay ownership. */
export const SPINE_CROSSOVER_WAYPOINTS: readonly (readonly Cell[])[] = (() => {
	const point = (x: number, y: number): Cell => Object.freeze({ x, y });
	const routes: Cell[][] = [
		[point(0, 0), point(120, 0), point(120, 40), point(0, 40), point(0, 0)],
		// Connect the first gateway before drawing the opposite inner loop.
		[point(28, 0), point(28, 6)],
		[point(28, 6), point(6, 6), point(6, 34), point(114, 34), point(114, 6), point(28, 6)],
		[point(16, 6), point(16, 0)],
	];
	for (let index = 1; index < 3; index++) {
		const x = 16 + index * 32;
		routes.push([point(x, 6), point(x, 0)], [point(x + 12, 0), point(x + 12, 6)]);
	}
	for (let index = 0; index < 3; index++) {
		const x = 32 + index * 32;
		routes.push(
			[point(x, 0), point(x, -12), point(x + 8, -12), point(x + 8, 0)],
			[point(x + 8, 6), point(x + 8, 18), point(x, 18), point(x, 6)],
		);
	}
	return Object.freeze(routes.map((route) => Object.freeze(route)));
})();

export function spineCrossoverRailRoutes(): readonly (readonly Cell[])[] {
	return SPINE_CROSSOVER_WAYPOINTS.map((waypoints) => {
		const first = waypoints[0] as Cell;
		const cells: Cell[] = [first];
		let { x, y } = first;
		for (const end of waypoints.slice(1)) {
			const dx = Math.sign(end.x - x);
			const dy = Math.sign(end.y - y);
			while (x !== end.x || y !== end.y) {
				x += dx;
				y += dy;
				cells.push({ x, y });
			}
		}
		return cells;
	});
}
