interface OrdinaryRailPointerPreviewStatusInput {
	readonly guidedBuildExperienceActive: boolean;
	readonly pointerBuildDragActive: boolean;
	readonly routeModeActive: boolean;
	readonly placementSessionActive: boolean;
	readonly networkLinkPlan: boolean;
	readonly valid: boolean;
	readonly validationLevel: "exact" | "topology-only";
	readonly lengthMeters: number;
}

/**
 * Names the release action only for an ordinary direct-manipulation Smart Route drag.
 * Keyboard, click-to-click, Guided, macro, and topology-only previews keep their own commit cues.
 */
export function ordinaryRailPointerPreviewStatus(
	input: OrdinaryRailPointerPreviewStatusInput,
): string | null {
	if (
		input.guidedBuildExperienceActive ||
		!input.pointerBuildDragActive ||
		!input.routeModeActive ||
		input.placementSessionActive ||
		input.networkLinkPlan ||
		!input.valid ||
		input.validationLevel !== "exact"
	) {
		return null;
	}
	return `${input.lengthMeters} m · 놓아서 Rail 건설`;
}
