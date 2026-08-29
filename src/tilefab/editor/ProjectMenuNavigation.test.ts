import { describe, expect, it } from "vitest";
import { nextProjectMenuIndex } from "./ProjectMenuNavigation";

describe("ProjectMenuNavigation", () => {
	it("enters from either direction and wraps through project actions", () => {
		expect(nextProjectMenuIndex({ key: "ArrowDown", currentIndex: -1, itemCount: 5 })).toBe(0);
		expect(nextProjectMenuIndex({ key: "ArrowUp", currentIndex: -1, itemCount: 5 })).toBe(4);
		expect(nextProjectMenuIndex({ key: "ArrowDown", currentIndex: 4, itemCount: 5 })).toBe(0);
		expect(nextProjectMenuIndex({ key: "ArrowUp", currentIndex: 0, itemCount: 5 })).toBe(4);
	});

	it("supports Home and End without claiming unrelated keys", () => {
		expect(nextProjectMenuIndex({ key: "Home", currentIndex: 3, itemCount: 5 })).toBe(0);
		expect(nextProjectMenuIndex({ key: "End", currentIndex: 1, itemCount: 5 })).toBe(4);
		expect(nextProjectMenuIndex({ key: "Tab", currentIndex: 1, itemCount: 5 })).toBeNull();
		expect(nextProjectMenuIndex({ key: "ArrowDown", currentIndex: -1, itemCount: 0 })).toBeNull();
	});
});
