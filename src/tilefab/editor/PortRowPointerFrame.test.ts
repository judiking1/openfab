import { describe, expect, it } from "vitest";
import { decidePortRowPointerFrame } from "./PortRowPointerFrame";

describe("PortRowPointerFrame", () => {
	it("does no work for repeated active pointer moves inside one snapped slot", () => {
		expect(
			decidePortRowPointerFrame({
				moved: true,
				pointerDistancePixels: 30,
				currentRow: 7,
				hoverRow: 7,
				targetRow: 7,
			}),
		).toEqual({
			becameMoved: false,
			hoverChanged: false,
			targetChanged: false,
			targetLost: false,
			renderNeeded: false,
		});
	});

	it("requests one frame for a snap change, drag transition, or lost target", () => {
		expect(
			decidePortRowPointerFrame({
				moved: false,
				pointerDistancePixels: 3,
				currentRow: 7,
				hoverRow: 7,
				targetRow: 8,
			}),
		).toMatchObject({
			becameMoved: true,
			hoverChanged: true,
			targetChanged: true,
			renderNeeded: true,
		});
		expect(
			decidePortRowPointerFrame({
				moved: true,
				pointerDistancePixels: 30,
				currentRow: 8,
				hoverRow: 8,
				targetRow: null,
			}),
		).toMatchObject({ hoverChanged: true, targetLost: true, renderNeeded: true });
	});
});
