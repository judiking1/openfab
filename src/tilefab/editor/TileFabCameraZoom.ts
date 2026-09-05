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
