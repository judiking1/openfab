import type { Camera } from "../render/TileRenderer";

export interface TileFabCameraZoomBounds {
	readonly minimum: number;
	readonly maximum: number;
}

/** Keeps the world point under the screen anchor fixed while changing the 2D camera zoom. */
export function applyTileFabCameraZoom(
	camera: Camera,
	factor: number,
	anchor: Readonly<{ x: number; y: number }>,
	bounds: TileFabCameraZoomBounds,
): boolean {
	if (
		!Number.isFinite(factor) ||
		factor <= 0 ||
		!Number.isFinite(anchor.x) ||
		!Number.isFinite(anchor.y) ||
		!Number.isFinite(camera.zoom) ||
		camera.zoom <= 0 ||
		!Number.isFinite(bounds.minimum) ||
		!Number.isFinite(bounds.maximum) ||
		bounds.minimum <= 0 ||
		bounds.maximum < bounds.minimum
	) {
		return false;
	}
	const scaledZoom = camera.zoom * factor;
	const nextZoom =
		scaledZoom < camera.zoom
			? camera.zoom <= bounds.minimum
				? camera.zoom
				: Math.max(bounds.minimum, scaledZoom)
			: Math.min(bounds.maximum, scaledZoom);
	if (nextZoom === camera.zoom) return false;
	camera.offsetX = anchor.x - ((anchor.x - camera.offsetX) / camera.zoom) * nextZoom;
	camera.offsetY = anchor.y - ((anchor.y - camera.offsetY) / camera.zoom) * nextZoom;
	camera.zoom = nextZoom;
	return true;
}

/** Fit into the unobstructed frame with 12px for strokes/markers, even far below 1px/m. */
export function fitTileFabCameraZoom(
	bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
	frame: Readonly<{ width: number; height: number }>,
	rotation: Camera["rotation"],
	paddingMeters: number,
	extentAdjustment: 0 | 1,
	zoomBounds: TileFabCameraZoomBounds,
): number {
	const worldSpanX = Math.max(1, bounds.maxX - bounds.minX + extentAdjustment + paddingMeters * 2);
	const worldSpanY = Math.max(1, bounds.maxY - bounds.minY + extentAdjustment + paddingMeters * 2);
	const spanX = rotation % 2 === 0 ? worldSpanX : worldSpanY;
	const spanY = rotation % 2 === 0 ? worldSpanY : worldSpanX;
	return Math.min(
		zoomBounds.maximum,
		Math.max(
			zoomBounds.minimum,
			Math.min(Math.max(1, frame.width - 24) / spanX, Math.max(1, frame.height - 24) / spanY),
		),
	);
}
