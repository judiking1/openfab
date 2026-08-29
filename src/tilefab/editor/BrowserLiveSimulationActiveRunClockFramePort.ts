import type { LiveSimulationActiveRunClockFramePort } from "./LiveSimulationActiveRunClock";

interface AnimationFrameTarget {
	requestAnimationFrame(callback: FrameRequestCallback): number;
	cancelAnimationFrame(handle: number): void;
}

interface VisibilityTarget {
	readonly visibilityState: DocumentVisibilityState;
	addEventListener(type: "visibilitychange", listener: () => void): void;
	removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Browser-only scheduling adapter; simulation semantics remain in the injected clock owner. */
export class BrowserLiveSimulationActiveRunClockFramePort
	implements LiveSimulationActiveRunClockFramePort
{
	private readonly animationFrames: AnimationFrameTarget;
	private readonly visibility: VisibilityTarget;

	constructor(
		animationFrames: AnimationFrameTarget = window,
		visibility: VisibilityTarget = document,
	) {
		this.animationFrames = animationFrames;
		this.visibility = visibility;
	}

	requestFrame(callback: (timestampMilliseconds: number) => void): number {
		return this.animationFrames.requestAnimationFrame(callback);
	}

	cancelFrame(handle: number): void {
		this.animationFrames.cancelAnimationFrame(handle);
	}

	isVisible(): boolean {
		return this.visibility.visibilityState === "visible";
	}

	subscribeVisibility(listener: () => void): () => void {
		this.visibility.addEventListener("visibilitychange", listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.visibility.removeEventListener("visibilitychange", listener);
		};
	}
}
