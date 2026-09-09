/** A readable metric interval measured in CSS pixels by the existing 2D camera. */
export interface TileFabMapScale {
	readonly meters: number;
	readonly pixels: number;
}

export function tileFabMapScale(pixelsPerMeter: number): TileFabMapScale | null {
	if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) return null;
	const maximumMeters = 80 / pixelsPerMeter;
	const magnitude = 10 ** Math.floor(Math.log10(maximumMeters));
	if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
	const normalized = maximumMeters / magnitude;
	const interval = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
	const meters = Number((interval * magnitude).toPrecision(12));
	const pixels = meters * pixelsPerMeter;
	return Number.isFinite(pixels) && pixels > 0 ? { meters, pixels } : null;
}
