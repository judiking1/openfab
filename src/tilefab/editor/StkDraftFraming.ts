import { STK_MAXIMUM_PORT_COUNT } from "../core/EquipmentGroup";

interface ScreenPoint {
	readonly x: number;
	readonly y: number;
}

/** A camera-only translation; oversized drafts keep the existing cursor-follow behavior. */
export function stkDraftFrameTranslation(
	selected: readonly ScreenPoint[],
	cursor: ScreenPoint,
	frame: Readonly<{ left: number; top: number; width: number; height: number }>,
): ScreenPoint | null {
	if (selected.length === 0) return null;
	// The active target has a caption above it; selected diamonds only need their marker margin.
	let left = cursor.x - 64;
	let right = cursor.x + 64;
	let top = cursor.y - 52;
	let bottom = cursor.y + 28;
	for (const point of selected) {
		left = Math.min(left, point.x - 28);
		right = Math.max(right, point.x + 28);
		top = Math.min(top, point.y - 28);
		bottom = Math.max(bottom, point.y + 28);
	}
	if (right - left > frame.width || bottom - top > frame.height) return null;
	return {
		x: Math.max(frame.left - left, Math.min(0, frame.left + frame.width - right)),
		y: Math.max(frame.top - top, Math.min(0, frame.top + frame.height - bottom)),
	};
}

interface SelectionFrame {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** Choose a clear rectangle around camera controls instead of reserving their entire row. */
export function stkDraftSelectionFit(
	points: readonly ScreenPoint[],
	currentSelectedIndex: number,
	frame: SelectionFrame,
	zoomBounds: Readonly<{ minimum: number; maximum: number }>,
	obstruction?: SelectionFrame,
): Readonly<{ zoom: number; offsetX: number; offsetY: number }> | null {
	if (
		!obstruction ||
		obstruction.left >= frame.left + frame.width ||
		obstruction.left + obstruction.width <= frame.left ||
		obstruction.top >= frame.top + frame.height ||
		obstruction.top + obstruction.height <= frame.top
	) {
		return fitStkSelectionInFrame(points, currentSelectedIndex, frame, zoomBounds);
	}
	const below = Math.max(frame.top, obstruction.top + obstruction.height);
	const right = Math.max(frame.left, obstruction.left + obstruction.width);
	const candidates = [
		{ ...frame, top: below, height: frame.top + frame.height - below },
		{ ...frame, width: Math.min(frame.width, obstruction.left - frame.left) },
		{ ...frame, left: right, width: frame.left + frame.width - right },
		{ ...frame, height: Math.min(frame.height, obstruction.top - frame.top) },
	];
	let best: ReturnType<typeof fitStkSelectionInFrame> = null;
	let bestArea = -1;
	for (const candidate of candidates) {
		const fit = fitStkSelectionInFrame(points, currentSelectedIndex, candidate, zoomBounds);
		const area = candidate.width * candidate.height;
		if (fit && (!best || fit.zoom > best.zoom || (fit.zoom === best.zoom && area > bestArea))) {
			best = fit;
			bestArea = area;
		}
	}
	return best;
}

// Points are world coordinates after applying the current quarter-turn rotation, before zoom/offset.
function fitStkSelectionInFrame(
	points: readonly Readonly<{ x: number; y: number }>[],
	currentSelectedIndex: number,
	frame: Readonly<{ left: number; top: number; width: number; height: number }>,
	zoomBounds: Readonly<{ minimum: number; maximum: number }>,
): Readonly<{ zoom: number; offsetX: number; offsetY: number }> | null {
	if (
		!points.length ||
		points.length > STK_MAXIMUM_PORT_COUNT ||
		!Number.isFinite(frame.left) ||
		!Number.isFinite(frame.top) ||
		!(frame.width > 0) ||
		!(frame.height > 0) ||
		!Number.isFinite(frame.width) ||
		!Number.isFinite(frame.height) ||
		!(zoomBounds.minimum > 0) ||
		!Number.isFinite(zoomBounds.maximum) ||
		zoomBounds.maximum < zoomBounds.minimum
	)
		return null;
	const padding = points.map((point, index) => ({
		point,
		left: index === currentSelectedIndex ? 64 : 28,
		right: index === currentSelectedIndex ? 64 : 28,
		top: index === currentSelectedIndex ? 52 : 28,
		bottom: 28,
	}));
	let zoom = zoomBounds.maximum;
	for (const a of padding) {
		if (
			!Number.isFinite(a.point.x) ||
			!Number.isFinite(a.point.y) ||
			a.left + a.right > frame.width ||
			a.top + a.bottom > frame.height
		)
			return null;
		for (const b of padding) {
			const dx = a.point.x - b.point.x,
				dy = a.point.y - b.point.y;
			if (dx > 0) zoom = Math.min(zoom, (frame.width - a.right - b.left) / dx);
			if (dy > 0) zoom = Math.min(zoom, (frame.height - a.bottom - b.top) / dy);
		}
	}
	if (zoom < zoomBounds.minimum) return null;
	const left = Math.min(...padding.map(({ point, left }) => point.x * zoom - left));
	const right = Math.max(...padding.map(({ point, right }) => point.x * zoom + right));
	const top = Math.min(...padding.map(({ point, top }) => point.y * zoom - top));
	const bottom = Math.max(...padding.map(({ point, bottom }) => point.y * zoom + bottom));
	return {
		zoom,
		offsetX: frame.left + (frame.width - (right - left)) / 2 - left,
		offsetY: frame.top + (frame.height - (bottom - top)) / 2 - top,
	};
}
