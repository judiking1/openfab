import { describe, expect, it } from "vitest";
import { STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS } from "../core/StaticFabOrganizationSelection";
import {
	applyStaticFabOrganizationCanvasSelectionClick,
	applyStaticFabOrganizationMultiSelectionClick,
	createStaticFabOrganizationMultiSelection,
	pruneStaticFabOrganizationMultiSelection,
} from "./StaticFabOrganizationMultiSelection";

describe("StaticFabOrganizationMultiSelection", () => {
	it("creates a canonical, immutable state", () => {
		const selected = [7, 2, 7, 4];
		const state = createStaticFabOrganizationMultiSelection(selected, 7, 2);

		expect(state).toEqual({
			selectedOrganizationIds: [2, 4, 7],
			focusedOrganizationId: 7,
			anchorOrganizationId: 2,
		});
		expect(Object.isFrozen(state)).toBe(true);
		expect(Object.isFrozen(state.selectedOrganizationIds)).toBe(true);
		expect(selected).toEqual([7, 2, 7, 4]);
	});

	it("plain click replaces selection and establishes focus and anchor", () => {
		const previous = createStaticFabOrganizationMultiSelection([2, 4], 4, 2);
		const result = click(previous, 9, [2, 4, 9]);

		expect(result).toMatchObject({
			accepted: true,
			changed: true,
			reason: "PLAIN_REPLACED",
			state: {
				selectedOrganizationIds: [9],
				focusedOrganizationId: 9,
				anchorOrganizationId: 9,
			},
		});
		expect(previous.selectedOrganizationIds).toEqual([2, 4]);
	});

	it("primary click toggles membership while retaining clicked focus identity", () => {
		const initial = createStaticFabOrganizationMultiSelection([2, 4], 2, 2);
		const added = click(initial, 7, [2, 4, 7], { primaryModifier: true });
		const removed = click(added.state, 7, [2, 4, 7], { primaryModifier: true });

		expect(added).toMatchObject({
			accepted: true,
			reason: "PRIMARY_ADDED",
			state: {
				selectedOrganizationIds: [2, 4, 7],
				focusedOrganizationId: 7,
				anchorOrganizationId: 7,
			},
		});
		expect(removed).toMatchObject({
			accepted: true,
			reason: "PRIMARY_REMOVED",
			state: {
				selectedOrganizationIds: [2, 4],
				focusedOrganizationId: 7,
				anchorOrganizationId: 7,
			},
		});
	});

	it("Shift replaces with the inclusive visible-order range and keeps the anchor", () => {
		const initial = createStaticFabOrganizationMultiSelection([10], 10, 10);
		const result = click(initial, 20, [50, 10, 40, 20, 30], { shiftModifier: true });

		expect(result).toMatchObject({
			accepted: true,
			reason: "RANGE_REPLACED",
			state: {
				selectedOrganizationIds: [10, 20, 40],
				focusedOrganizationId: 20,
				anchorOrganizationId: 10,
			},
		});
	});

	it("primary+Shift adds a visible range without duplicating shared IDs", () => {
		const initial = createStaticFabOrganizationMultiSelection([5, 30], 30, 30);
		const result = click(initial, 10, [5, 10, 20, 20, 30, 40], {
			primaryModifier: true,
			shiftModifier: true,
		});

		expect(result).toMatchObject({
			accepted: true,
			reason: "RANGE_ADDED",
			state: {
				selectedOrganizationIds: [5, 10, 20, 30],
				focusedOrganizationId: 10,
				anchorOrganizationId: 30,
			},
		});
	});

	it("uses a first Shift click as a deterministic singleton anchor", () => {
		const result = click(createStaticFabOrganizationMultiSelection([4]), 8, [4, 8, 12], {
			primaryModifier: true,
			shiftModifier: true,
		});

		expect(result.state).toEqual({
			selectedOrganizationIds: [4, 8],
			focusedOrganizationId: 8,
			anchorOrganizationId: 8,
		});
		expect(result.reason).toBe("RANGE_ADDED");
	});

	it("adds only the spatial Canvas hit on Shift without inventing a list range", () => {
		const initial = createStaticFabOrganizationMultiSelection([10, 40], 40, 10);
		const added = applyStaticFabOrganizationCanvasSelectionClick(initial, {
			organizationId: 25,
			primaryModifier: false,
			shiftModifier: true,
		});
		const retained = applyStaticFabOrganizationCanvasSelectionClick(added.state, {
			organizationId: 25,
			primaryModifier: true,
			shiftModifier: true,
		});

		expect(added).toMatchObject({
			accepted: true,
			reason: "SPATIAL_ADDED",
			state: {
				selectedOrganizationIds: [10, 25, 40],
				focusedOrganizationId: 25,
				anchorOrganizationId: 25,
			},
		});
		expect(retained.state.selectedOrganizationIds).toEqual([10, 25, 40]);
	});

	it("uses plain replace and primary toggle for Canvas hits", () => {
		const initial = createStaticFabOrganizationMultiSelection([2, 4], 4, 2);
		const replaced = applyStaticFabOrganizationCanvasSelectionClick(initial, {
			organizationId: 7,
			primaryModifier: false,
			shiftModifier: false,
		});
		const removed = applyStaticFabOrganizationCanvasSelectionClick(replaced.state, {
			organizationId: 7,
			primaryModifier: true,
			shiftModifier: false,
		});

		expect(replaced).toMatchObject({
			reason: "PLAIN_REPLACED",
			state: { selectedOrganizationIds: [7] },
		});
		expect(removed).toMatchObject({
			reason: "PRIMARY_REMOVED",
			state: { selectedOrganizationIds: [] },
		});
	});

	it("rejects invisible targets and filtered-out anchors atomically", () => {
		const initial = createStaticFabOrganizationMultiSelection([2, 4], 4, 2);
		const missingTarget = click(initial, 9, [2, 4]);
		const missingAnchor = click(initial, 9, [4, 9], { shiftModifier: true });

		expect(missingTarget).toMatchObject({
			accepted: false,
			changed: false,
			reason: "TARGET_NOT_VISIBLE",
		});
		expect(missingTarget.state).toBe(initial);
		expect(missingAnchor).toMatchObject({
			accepted: false,
			changed: false,
			reason: "ANCHOR_NOT_VISIBLE",
		});
		expect(missingAnchor.state).toBe(initial);
	});

	it("enforces the shared core root bound for toggles and ranges", () => {
		const maximumIds = Array.from(
			{ length: STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS },
			(_, index) => index + 1,
		);
		const maximum = createStaticFabOrganizationMultiSelection(maximumIds, 1, 1);
		const toggleOverflow = click(
			maximum,
			STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS + 1,
			[STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS + 1],
			{ primaryModifier: true },
		);
		const rangeOverflow = click(
			createStaticFabOrganizationMultiSelection([1], 1, 1),
			STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS + 1,
			[...maximumIds, STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS + 1],
			{ shiftModifier: true },
		);

		expect(toggleOverflow.reason).toBe("SELECTION_LIMIT_EXCEEDED");
		expect(toggleOverflow.state).toBe(maximum);
		expect(rangeOverflow.reason).toBe("SELECTION_LIMIT_EXCEEDED");
		expect(rangeOverflow.accepted).toBe(false);
		expect(() =>
			createStaticFabOrganizationMultiSelection([
				...maximumIds,
				STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS + 1,
			]),
		).toThrow(RangeError);
	});

	it("prunes deleted selections, focus, and anchor while preserving live identities", () => {
		const initial = createStaticFabOrganizationMultiSelection([2, 4, 7], 4, 7);
		const pruned = pruneStaticFabOrganizationMultiSelection(initial, [2, 7, 9]);
		const unchanged = pruneStaticFabOrganizationMultiSelection(pruned.state, [2, 7, 9]);

		expect(pruned).toMatchObject({
			accepted: true,
			changed: true,
			reason: "STALE_IDENTITIES_PRUNED",
			state: {
				selectedOrganizationIds: [2, 7],
				focusedOrganizationId: null,
				anchorOrganizationId: 7,
			},
		});
		expect(unchanged).toMatchObject({ accepted: true, changed: false, reason: "UNCHANGED" });
		expect(unchanged.state).toBe(pruned.state);
	});

	it("rejects invalid organization identities before producing state", () => {
		expect(() => createStaticFabOrganizationMultiSelection([0])).toThrow(TypeError);
		expect(() => createStaticFabOrganizationMultiSelection([Number.NaN])).toThrow(TypeError);
		expect(() => click(createStaticFabOrganizationMultiSelection(), -1, [-1])).toThrow(TypeError);
	});
});

function click(
	state: ReturnType<typeof createStaticFabOrganizationMultiSelection>,
	organizationId: number,
	visibleOrganizationIds: readonly number[],
	modifiers: Readonly<{
		primaryModifier?: boolean;
		shiftModifier?: boolean;
	}> = {},
) {
	return applyStaticFabOrganizationMultiSelectionClick(state, {
		organizationId,
		visibleOrganizationIds,
		primaryModifier: modifiers.primaryModifier ?? false,
		shiftModifier: modifiers.shiftModifier ?? false,
	});
}
