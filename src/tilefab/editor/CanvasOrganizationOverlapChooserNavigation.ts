export type CanvasOrganizationOverlapNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export type CanvasOrganizationOverlapFocusTarget = "active-option" | "close";

export function nextCanvasOrganizationOverlapFocusTarget(
	current: CanvasOrganizationOverlapFocusTarget,
): CanvasOrganizationOverlapFocusTarget {
	return current === "active-option" ? "close" : "active-option";
}

export function nextCanvasOrganizationOverlapIndex(input: {
	readonly currentIndex: number;
	readonly itemCount: number;
	readonly key: CanvasOrganizationOverlapNavigationKey;
}): number | null {
	if (!Number.isSafeInteger(input.itemCount) || input.itemCount <= 0) return null;
	const currentIndex = Math.min(
		input.itemCount - 1,
		Math.max(0, Number.isSafeInteger(input.currentIndex) ? input.currentIndex : 0),
	);
	if (input.key === "Home") return 0;
	if (input.key === "End") return input.itemCount - 1;
	if (input.key === "ArrowDown") return Math.min(input.itemCount - 1, currentIndex + 1);
	return Math.max(0, currentIndex - 1);
}
