import { describe, expect, it } from "vitest";
import {
	type BlueprintPlacementOrigin,
	blueprintPlacementAnchorAtWorldCenter,
	blueprintPlacementCapturesRecent,
	blueprintPlacementCompactIdentity,
	blueprintPlacementLifecycle,
	blueprintPlacementSource,
	blueprintPlacementStatusPrefix,
	blueprintPlacementUsesSingleCommitByDefault,
	blueprintPlacementWorldCenterAtAnchor,
	moduleStampUsesSingleCommit,
	rotateBlueprintPlacementAroundStableCenter,
	shouldRetainPlacementGhostOnPointerLeave,
} from "./BlueprintCommandLoop";

describe("BlueprintCommandLoop", () => {
	it("keeps placement origin distinct from the visual source family", () => {
		const blueprintOrigins: readonly BlueprintPlacementOrigin[] = [
			"selection-copy",
			"recent",
			"library",
			"favorite",
		];
		for (const origin of blueprintOrigins) {
			expect(blueprintPlacementSource(origin)).toBe("blueprint");
		}
		expect(blueprintPlacementSource("assembly-pattern")).toBe("assembly-pattern");
	});

	it("presents each reusable asset origin without conflating it with Recent", () => {
		expect(blueprintPlacementStatusPrefix("selection-copy")).toBe("");
		expect(blueprintPlacementStatusPrefix("recent")).toContain("최근");
		expect(blueprintPlacementStatusPrefix("library")).toContain("내 청사진");
		expect(blueprintPlacementStatusPrefix("favorite")).toContain("즐겨찾기");
		expect(blueprintPlacementStatusPrefix("assembly-pattern")).toContain("FAB ASSEMBLY");
	});

	it("allows only an explicit selection copy to replace Recent", () => {
		expect(blueprintPlacementCapturesRecent("selection-copy")).toBe(true);
		for (const origin of ["recent", "library", "favorite", "assembly-pattern"] as const) {
			expect(blueprintPlacementCapturesRecent(origin)).toBe(false);
		}
	});

	it("makes a full FAB preset one-shot unless the placement gesture explicitly asks to repeat", () => {
		expect(blueprintPlacementUsesSingleCommitByDefault("fab-preset")).toBe(true);
		for (const origin of [
			"selection-copy",
			"recent",
			"library",
			"favorite",
			"assembly-pattern",
		] as const) {
			expect(blueprintPlacementUsesSingleCommitByDefault(origin)).toBe(false);
		}
	});

	it("derives one truthful preset lifecycle before and after an explicit repeat commit", () => {
		expect(blueprintPlacementLifecycle("fab-preset", 0)).toEqual({
			mode: "single",
			exitIsCancellation: true,
			modeLabel: "1회 배치 · Shift+클릭 시 계속",
			primaryActionLabel: "여기에 1회 배치",
		});
		expect(blueprintPlacementLifecycle("fab-preset", 1)).toEqual({
			mode: "repeat",
			exitIsCancellation: false,
			modeLabel: "반복 배치 중",
			primaryActionLabel: "여기에 배치",
		});
		expect(blueprintPlacementLifecycle("recent", 0)).toEqual({
			mode: "repeat",
			exitIsCancellation: true,
			modeLabel: "반복 배치 중",
			primaryActionLabel: "여기에 배치",
		});
		expect(blueprintPlacementLifecycle("recent", 1).exitIsCancellation).toBe(false);
	});

	it("labels module stamps by whether the ghost actually survives a commit", () => {
		expect(moduleStampUsesSingleCommit("single")).toBe(true);
		expect(moduleStampUsesSingleCommit("choose-output")).toBe(true);
		expect(moduleStampUsesSingleCommit("from-output")).toBe(false);
		expect(moduleStampUsesSingleCommit("compatible-anchor")).toBe(false);
	});

	it("keeps the held object identity and exact static FAB counts visible in compact placement", () => {
		expect(
			blueprintPlacementCompactIdentity({
				origin: "selection-copy",
				sourceModuleCount: 17,
				equipmentGroupCount: 3,
				portCount: 6,
			}),
		).toBe("COPY 17 RAIL · 3 GROUPS · 6 PORTS");
		expect(
			blueprintPlacementCompactIdentity({
				origin: "assembly-pattern",
				sourceModuleCount: 97,
				equipmentGroupCount: 0,
				portCount: 0,
			}),
		).toBe("ASSEMBLY 97 RAIL");
	});

	it("retains active placement ghosts while the pointer uses editor chrome", () => {
		expect(
			shouldRetainPlacementGhostOnPointerLeave({
				areaStampActive: true,
				moduleStampActive: false,
				templatePlacementActive: false,
			}),
		).toBe(true);
		expect(
			shouldRetainPlacementGhostOnPointerLeave({
				areaStampActive: false,
				moduleStampActive: true,
				templatePlacementActive: false,
			}),
		).toBe(true);
		expect(
			shouldRetainPlacementGhostOnPointerLeave({
				areaStampActive: false,
				moduleStampActive: false,
				templatePlacementActive: true,
			}),
		).toBe(true);
		expect(
			shouldRetainPlacementGhostOnPointerLeave({
				areaStampActive: false,
				moduleStampActive: false,
				templatePlacementActive: false,
			}),
		).toBe(false);
	});

	it("centers an exact cell footprint around the requested visible world point", () => {
		expect(
			blueprintPlacementAnchorAtWorldCenter(
				{ minX: 0, minY: 0, maxX: 48, maxY: 10 },
				{ x: 100.5, y: 60.5 },
			),
		).toEqual({ x: 76, y: 55 });
	});

	it("round-trips a centered anchor to the same geometric world point", () => {
		const bounds = { minX: -12, minY: 3, maxX: 47, maxY: 84 };
		const pointer = { x: 126, y: -36 };
		const anchor = blueprintPlacementAnchorAtWorldCenter(bounds, pointer);

		expect(blueprintPlacementWorldCenterAtAnchor(bounds, anchor)).toEqual(pointer);
	});

	it("keeps odd-even footprint rotation reversible around one half-cell pivot", () => {
		const horizontal = { minX: 0, minY: 0, maxX: 4, maxY: 3 };
		const vertical = { minX: -3, minY: 0, maxX: 0, maxY: 4 };
		const initialAnchor = { x: 10, y: 20 };
		const clockwise = rotateBlueprintPlacementAroundStableCenter({
			currentAnchor: initialAnchor,
			currentBounds: horizontal,
			currentQuarterTurns: 0,
			nextBounds: vertical,
			nextQuarterTurns: 1,
			previousPivot: null,
		});
		const restored = rotateBlueprintPlacementAroundStableCenter({
			currentAnchor: clockwise.anchor,
			currentBounds: vertical,
			currentQuarterTurns: 1,
			nextBounds: horizontal,
			nextQuarterTurns: 0,
			previousPivot: clockwise.pivot,
		});

		expect(restored.anchor).toEqual(initialAnchor);
		expect(restored.pivot.centerXTwice).toBe(clockwise.pivot.centerXTwice);
		expect(restored.pivot.centerYTwice).toBe(clockwise.pivot.centerYTwice);
	});
});
