export interface PortRowPointerFrameInput {
	readonly moved: boolean;
	readonly pointerDistancePixels: number;
	readonly currentRow: number;
	readonly hoverRow: number | null;
	readonly targetRow: number | null;
}

export interface PortRowPointerFrameDecision {
	readonly becameMoved: boolean;
	readonly hoverChanged: boolean;
	readonly targetChanged: boolean;
	readonly targetLost: boolean;
	readonly renderNeeded: boolean;
}

/** Snap-state transition gate shared by active EQ/OHB pointer frames. */
export function decidePortRowPointerFrame(
	input: PortRowPointerFrameInput,
): PortRowPointerFrameDecision {
	const becameMoved = !input.moved && input.pointerDistancePixels >= 3;
	const hoverChanged = input.hoverRow !== input.targetRow;
	const targetChanged = input.targetRow !== null && input.targetRow !== input.currentRow;
	const targetLost = input.targetRow === null && input.currentRow !== -1;
	return Object.freeze({
		becameMoved,
		hoverChanged,
		targetChanged,
		targetLost,
		renderNeeded: becameMoved || hoverChanged || targetChanged || targetLost,
	});
}
