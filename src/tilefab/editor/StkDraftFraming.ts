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
