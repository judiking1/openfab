import { describe, expect, it } from "vitest";
import { ordinaryRailPointerPreviewStatus } from "./OrdinaryRailPointerPreviewStatus";

const ordinaryDirectDrag = Object.freeze({
	guidedBuildExperienceActive: false,
	pointerBuildDragActive: true,
	routeModeActive: true,
	placementSessionActive: false,
	networkLinkPlan: false,
	valid: true,
	validationLevel: "exact" as const,
	lengthMeters: 8,
});

describe("OrdinaryRailPointerPreviewStatus", () => {
	it("names mouse release as the direct Smart Route commit action", () => {
		expect(ordinaryRailPointerPreviewStatus(ordinaryDirectDrag)).toBe("8 m · 놓아서 Rail 건설");
	});

	it.each([
		["Guided or resumable Guided experience", { guidedBuildExperienceActive: true }],
		["keyboard or hover preview", { pointerBuildDragActive: false }],
		["non-route catalog mode", { routeModeActive: false }],
		["template or placement session", { placementSessionActive: true }],
		["closed-loop Network Link plan", { networkLinkPlan: true }],
		["invalid route", { valid: false }],
		["topology-only macro preview", { validationLevel: "topology-only" as const }],
	])("leaves %s to its existing presentation", (_label, override) => {
		expect(
			ordinaryRailPointerPreviewStatus({
				...ordinaryDirectDrag,
				...override,
			}),
		).toBeNull();
	});
});
