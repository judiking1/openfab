export type OrdinaryEqAnchorEdgeDirection =
	| "left"
	| "right"
	| "top"
	| "bottom"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

export interface OrdinaryEqAnchorEdgePresentation {
	readonly x: number;
	readonly y: number;
	readonly direction: OrdinaryEqAnchorEdgeDirection;
	readonly label: string;
}

const RAW_HORIZONTAL_MARGIN = 34;
const RAW_TOP_MARGIN = 30;
const RAW_BOTTOM_MARGIN = 60;
const LOCATOR_HALF_WIDTH = 70;
const LOCATOR_HALF_HEIGHT = 22;
const ACTIVE_AVOID_WIDTH = 104;
const ACTIVE_AVOID_HEIGHT = 72;
const ACTIVE_AVOID_SHIFT = 84;

function clampIntoRange(value: number, minimum: number, maximum: number): number {
	if (minimum > maximum) return (minimum + maximum) / 2;
	return Math.min(maximum, Math.max(minimum, value));
}

function directionArrow(direction: OrdinaryEqAnchorEdgeDirection): string {
	switch (direction) {
		case "left":
			return "←";
		case "right":
			return "→";
		case "top":
			return "↑";
		case "bottom":
			return "↓";
		case "top-left":
			return "↖";
		case "top-right":
			return "↗";
		case "bottom-left":
			return "↙";
		case "bottom-right":
			return "↘";
	}
}

export function ordinaryEqAnchorEdgePresentation(
	input: Readonly<{
		anchor: Readonly<{ x: number; y: number }>;
		activeEnd: Readonly<{ x: number; y: number }>;
		frame: Readonly<{ left: number; top: number; width: number; height: number }>;
		distanceMeters: number;
	}>,
): OrdinaryEqAnchorEdgePresentation | null {
	const right = input.frame.left + input.frame.width;
	const bottom = input.frame.top + input.frame.height;
	const horizontal =
		input.anchor.x < input.frame.left + RAW_HORIZONTAL_MARGIN
			? "left"
			: input.anchor.x > right - RAW_HORIZONTAL_MARGIN
				? "right"
				: null;
	const vertical =
		input.anchor.y < input.frame.top + RAW_TOP_MARGIN
			? "top"
			: input.anchor.y > bottom - RAW_BOTTOM_MARGIN
				? "bottom"
				: null;
	if (!horizontal && !vertical) return null;

	const direction = (
		vertical && horizontal ? `${vertical}-${horizontal}` : (vertical ?? horizontal)
	) as OrdinaryEqAnchorEdgeDirection;
	const minimumX = input.frame.left + LOCATOR_HALF_WIDTH;
	const maximumX = right - LOCATOR_HALF_WIDTH;
	const minimumY = input.frame.top + LOCATOR_HALF_HEIGHT;
	const maximumY = bottom - LOCATOR_HALF_HEIGHT;
	let x = clampIntoRange(input.anchor.x, minimumX, maximumX);
	let y = clampIntoRange(input.anchor.y, minimumY, maximumY);

	if (
		Math.abs(x - input.activeEnd.x) < ACTIVE_AVOID_WIDTH &&
		Math.abs(y - input.activeEnd.y) < ACTIVE_AVOID_HEIGHT
	) {
		if (horizontal) {
			const above = clampIntoRange(input.activeEnd.y - ACTIVE_AVOID_SHIFT, minimumY, maximumY);
			const below = clampIntoRange(input.activeEnd.y + ACTIVE_AVOID_SHIFT, minimumY, maximumY);
			y =
				Math.abs(below - input.activeEnd.y) >= Math.abs(above - input.activeEnd.y) ? below : above;
		} else {
			const before = clampIntoRange(input.activeEnd.x - ACTIVE_AVOID_SHIFT, minimumX, maximumX);
			const after = clampIntoRange(input.activeEnd.x + ACTIVE_AVOID_SHIFT, minimumX, maximumX);
			x =
				Math.abs(after - input.activeEnd.x) >= Math.abs(before - input.activeEnd.x)
					? after
					: before;
		}
	}

	const distanceMeters = Math.max(0, Math.round(input.distanceMeters));
	return Object.freeze({
		x,
		y,
		direction,
		label: `${directionArrow(direction)} 1 시작 · ${distanceMeters.toLocaleString("ko-KR")} m`,
	});
}
