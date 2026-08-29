export type ProjectMenuNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function nextProjectMenuIndex(input: {
	readonly key: string;
	readonly currentIndex: number;
	readonly itemCount: number;
}): number | null {
	if (!Number.isSafeInteger(input.itemCount) || input.itemCount <= 0) return null;
	if (input.key === "Home") return 0;
	if (input.key === "End") return input.itemCount - 1;
	if (input.key === "ArrowDown") {
		return input.currentIndex < 0 ? 0 : (input.currentIndex + 1) % input.itemCount;
	}
	if (input.key === "ArrowUp") {
		return input.currentIndex <= 0 ? input.itemCount - 1 : input.currentIndex - 1;
	}
	return null;
}
