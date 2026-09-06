/** A display-only tolerance in CSS pixels; compiled paths and hit testing stay exact. */
export const OVERVIEW_RAIL_POINT_TOLERANCE_PIXELS = 0.2;

export function overviewRailPointDistanceSquared(zoom: number): number {
	if (!Number.isFinite(zoom) || zoom <= 0 || zoom >= 6) return 0;
	return (OVERVIEW_RAIL_POINT_TOLERANCE_PIXELS / zoom) ** 2;
}

/**
 * Skip only points within the tolerance of the last emitted point. Each omitted
 * segment stays in that disk; the final connection deviates by at most its radius.
 * Always retain the endpoint, and advance monotonically without allocating a copy.
 */
export function nextPhysicalRailOverviewPoint(
	positions: Float32Array,
	current: number,
	end: number,
	minimumDistanceSquared: number,
): number {
	let next = current + 1;
	if (minimumDistanceSquared <= 0) return next;
	const x = positions[current * 2] as number;
	const y = positions[current * 2 + 1] as number;
	while (next < end - 1) {
		const dx = (positions[next * 2] as number) - x;
		const dy = (positions[next * 2 + 1] as number) - y;
		if (dx * dx + dy * dy >= minimumDistanceSquared) break;
		next++;
	}
	return next;
}
