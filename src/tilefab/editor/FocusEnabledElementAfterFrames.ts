export interface EnabledFocusableElement {
	readonly disabled: boolean;
	focus(options?: FocusOptions): void;
}

export interface FocusFrameScheduler {
	request(callback: () => void): void;
}

const BROWSER_FOCUS_FRAME_SCHEDULER: FocusFrameScheduler = Object.freeze({
	request(callback: () => void) {
		globalThis.requestAnimationFrame(callback);
	},
});

/**
 * Restores focus after React has committed an enabled control, without polling beyond a small,
 * deterministic frame budget.
 */
export function focusEnabledElementAfterFrames(
	resolveElement: () => EnabledFocusableElement | null,
	remainingFrames = 4,
	scheduler: FocusFrameScheduler = BROWSER_FOCUS_FRAME_SCHEDULER,
): void {
	if (!Number.isSafeInteger(remainingFrames) || remainingFrames < 1) {
		throw new RangeError("Focus restoration requires a positive frame budget.");
	}
	scheduler.request(() => {
		const element = resolveElement();
		if (element && !element.disabled) {
			element.focus({ preventScroll: true });
			return;
		}
		if (remainingFrames > 1) {
			focusEnabledElementAfterFrames(resolveElement, remainingFrames - 1, scheduler);
		}
	});
}
