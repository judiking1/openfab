import { STK_MAXIMUM_PORT_COUNT } from "../core/EquipmentGroup";

interface ScreenPoint {
	readonly x: number;
	readonly y: number;
}

/** A camera-only translation; oversized groups follow the current Port instead of changing zoom. */
export function stkDraftFrameTranslation(
	selected: readonly ScreenPoint[],
	cursor: ScreenPoint,
	frame: Readonly<{ left: number; top: number; width: number; height: number }>,
	obstruction?: Readonly<{ left: number; top: number; width: number; height: number }>,
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
	const horizontalFits = right - left <= frame.width;
	const verticalFits = bottom - top <= frame.height;
	if (!horizontalFits || !verticalFits) {
		// A caption can exceed a short frame even while every selected diamond fits. Keep
		// the usable axis grouped and clamp the cursor ring on the constrained axis.
		let minimumX = cursor.x;
		let maximumX = cursor.x;
		let minimumY = cursor.y;
		let maximumY = cursor.y;
		for (const point of selected) {
			minimumX = Math.min(minimumX, point.x);
			maximumX = Math.max(maximumX, point.x);
			minimumY = Math.min(minimumY, point.y);
			maximumY = Math.max(maximumY, point.y);
		}
		if (
			frame.width < 56 ||
			frame.height < 56 ||
			maximumX - minimumX + 56 > frame.width ||
			(maximumY - minimumY + 56 > frame.height && (!obstruction || frame.height >= 80))
		)
			return null;
	}
	const horizontalCursorMargin = frame.width >= 128 ? 64 : 28;
	const minimumTranslationX = horizontalFits
		? frame.left - left
		: frame.left + horizontalCursorMargin - cursor.x;
	const maximumTranslationX = horizontalFits
		? frame.left + frame.width - right
		: frame.left + frame.width - horizontalCursorMargin - cursor.x;
	let translationX = Math.max(minimumTranslationX, Math.min(0, maximumTranslationX));
	const verticalCursorTopMargin = frame.height >= 80 ? 52 : 28;
	const translationY = verticalFits
		? Math.max(frame.top - top, Math.min(0, frame.top + frame.height - bottom))
		: Math.max(
				frame.top + verticalCursorTopMargin - cursor.y,
				Math.min(0, frame.top + frame.height - 28 - cursor.y),
			);
	if (
		obstruction &&
		cursor.y + translationY + 28 > obstruction.top &&
		cursor.y + translationY - 52 < obstruction.top + obstruction.height &&
		cursor.x + translationX + 64 > obstruction.left &&
		cursor.x + translationX - 64 < obstruction.left + obstruction.width
	) {
		const leftOfObstruction = obstruction.left - cursor.x - 64;
		const rightOfObstruction = obstruction.left + obstruction.width - cursor.x + 64;
		let alternatives = [leftOfObstruction, rightOfObstruction].filter(
			(candidate) => candidate >= minimumTranslationX && candidate <= maximumTranslationX,
		);
		if (alternatives.length === 0) {
			// A selected group can be too wide to fit beside the toolbar. Keep the
			// current Port caption readable even when other selected markers leave view.
			const cursorMinimumX = frame.left + horizontalCursorMargin - cursor.x;
			const cursorMaximumX = frame.left + frame.width - horizontalCursorMargin - cursor.x;
			alternatives = [leftOfObstruction, rightOfObstruction].filter(
				(candidate) => candidate >= cursorMinimumX && candidate <= cursorMaximumX,
			);
		}
		if (alternatives.length === 0) return null;
		translationX = alternatives.sort(
			(a, b) => Math.abs(a - translationX) - Math.abs(b - translationX),
		)[0] as number;
	}
	return { x: translationX, y: translationY };
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
