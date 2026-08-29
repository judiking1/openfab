import { STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS } from "../core/StaticFabOrganizationSelection";

export interface StaticFabOrganizationMultiSelectionState {
	readonly selectedOrganizationIds: readonly number[];
	readonly focusedOrganizationId: number | null;
	readonly anchorOrganizationId: number | null;
}

export interface StaticFabOrganizationMultiSelectionClick {
	readonly organizationId: number;
	/** Current visual order after filtering and sorting. Duplicate IDs use their first position. */
	readonly visibleOrganizationIds: readonly number[];
	readonly primaryModifier: boolean;
	readonly shiftModifier: boolean;
}

export interface StaticFabOrganizationCanvasSelectionClick {
	readonly organizationId: number;
	readonly primaryModifier: boolean;
	/** Canvas Shift-click is a spatial add, never a list-order range. */
	readonly shiftModifier: boolean;
}

export type StaticFabOrganizationMultiSelectionReason =
	| "PLAIN_REPLACED"
	| "PRIMARY_ADDED"
	| "PRIMARY_REMOVED"
	| "RANGE_REPLACED"
	| "RANGE_ADDED"
	| "SPATIAL_ADDED"
	| "TARGET_NOT_VISIBLE"
	| "ANCHOR_NOT_VISIBLE"
	| "SELECTION_LIMIT_EXCEEDED"
	| "STALE_IDENTITIES_PRUNED"
	| "UNCHANGED";

export interface StaticFabOrganizationMultiSelectionResult {
	readonly accepted: boolean;
	readonly changed: boolean;
	readonly reason: StaticFabOrganizationMultiSelectionReason;
	readonly state: StaticFabOrganizationMultiSelectionState;
}

export const EMPTY_STATIC_FAB_ORGANIZATION_MULTI_SELECTION =
	createStaticFabOrganizationMultiSelection();

/** Create one canonical, immutable list-selection state from trusted editor identities. */
export function createStaticFabOrganizationMultiSelection(
	selectedOrganizationIds: readonly number[] = [],
	focusedOrganizationId: number | null = null,
	anchorOrganizationId: number | null = null,
): StaticFabOrganizationMultiSelectionState {
	if (selectedOrganizationIds.length > STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS) {
		throw new RangeError(selectionLimitReason());
	}
	assertOrganizationIds(selectedOrganizationIds, "selected organization IDs");
	assertNullableOrganizationId(focusedOrganizationId, "focused organization ID");
	assertNullableOrganizationId(anchorOrganizationId, "anchor organization ID");
	return freezeState(
		canonicalIds(selectedOrganizationIds),
		focusedOrganizationId,
		anchorOrganizationId,
	);
}

/**
 * Apply desktop-style list selection without depending on React or platform keyboard APIs.
 * The caller maps Ctrl/Command to primaryModifier and supplies the current visible row order.
 */
export function applyStaticFabOrganizationMultiSelectionClick(
	state: StaticFabOrganizationMultiSelectionState,
	click: StaticFabOrganizationMultiSelectionClick,
): StaticFabOrganizationMultiSelectionResult {
	assertCanonicalState(state);
	assertOrganizationId(click.organizationId, "clicked organization ID");
	assertOrganizationIds(click.visibleOrganizationIds, "visible organization IDs");

	const visibleIds = uniqueIdsInOriginalOrder(click.visibleOrganizationIds);
	const targetIndex = visibleIds.indexOf(click.organizationId);
	if (targetIndex < 0) return rejected(state, "TARGET_NOT_VISIBLE");

	if (click.shiftModifier) {
		if (state.anchorOrganizationId === null) {
			const selectedOrganizationIds = click.primaryModifier
				? canonicalIds([...state.selectedOrganizationIds, click.organizationId])
				: Object.freeze([click.organizationId]);
			if (selectedOrganizationIds.length > STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS) {
				return rejected(state, "SELECTION_LIMIT_EXCEEDED");
			}
			return applied(
				state,
				freezeState(selectedOrganizationIds, click.organizationId, click.organizationId),
				click.primaryModifier ? "RANGE_ADDED" : "RANGE_REPLACED",
			);
		}
		const anchorIndex = visibleIds.indexOf(state.anchorOrganizationId);
		if (anchorIndex < 0) return rejected(state, "ANCHOR_NOT_VISIBLE");
		const rangeIds = visibleIds.slice(
			Math.min(anchorIndex, targetIndex),
			Math.max(anchorIndex, targetIndex) + 1,
		);
		const selectedOrganizationIds = click.primaryModifier
			? canonicalIds([...state.selectedOrganizationIds, ...rangeIds])
			: canonicalIds(rangeIds);
		if (selectedOrganizationIds.length > STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS) {
			return rejected(state, "SELECTION_LIMIT_EXCEEDED");
		}
		return applied(
			state,
			freezeState(selectedOrganizationIds, click.organizationId, state.anchorOrganizationId),
			click.primaryModifier ? "RANGE_ADDED" : "RANGE_REPLACED",
		);
	}

	if (click.primaryModifier) {
		const alreadySelected = state.selectedOrganizationIds.includes(click.organizationId);
		if (
			!alreadySelected &&
			state.selectedOrganizationIds.length >= STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS
		) {
			return rejected(state, "SELECTION_LIMIT_EXCEEDED");
		}
		const selectedOrganizationIds = alreadySelected
			? state.selectedOrganizationIds.filter((id) => id !== click.organizationId)
			: canonicalIds([...state.selectedOrganizationIds, click.organizationId]);
		return applied(
			state,
			freezeState(selectedOrganizationIds, click.organizationId, click.organizationId),
			alreadySelected ? "PRIMARY_REMOVED" : "PRIMARY_ADDED",
		);
	}

	return applied(
		state,
		freezeState([click.organizationId], click.organizationId, click.organizationId),
		"PLAIN_REPLACED",
	);
}

/**
 * Apply Canvas selection semantics without inventing a visual row order. Shift adds the one spatial
 * hit, while Command/Ctrl toggles it; plain click replaces the roots.
 */
export function applyStaticFabOrganizationCanvasSelectionClick(
	state: StaticFabOrganizationMultiSelectionState,
	click: StaticFabOrganizationCanvasSelectionClick,
): StaticFabOrganizationMultiSelectionResult {
	assertCanonicalState(state);
	assertOrganizationId(click.organizationId, "clicked organization ID");
	if (!click.shiftModifier) {
		return applyStaticFabOrganizationMultiSelectionClick(state, {
			organizationId: click.organizationId,
			visibleOrganizationIds: [...state.selectedOrganizationIds, click.organizationId],
			primaryModifier: click.primaryModifier,
			shiftModifier: false,
		});
	}
	const alreadySelected = state.selectedOrganizationIds.includes(click.organizationId);
	if (
		!alreadySelected &&
		state.selectedOrganizationIds.length >= STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS
	) {
		return rejected(state, "SELECTION_LIMIT_EXCEEDED");
	}
	const selectedOrganizationIds = alreadySelected
		? state.selectedOrganizationIds
		: canonicalIds([...state.selectedOrganizationIds, click.organizationId]);
	return applied(
		state,
		freezeState(selectedOrganizationIds, click.organizationId, click.organizationId),
		"SPATIAL_ADDED",
	);
}

/** Remove deleted identities while preserving focus and anchor identities that still exist. */
export function pruneStaticFabOrganizationMultiSelection(
	state: StaticFabOrganizationMultiSelectionState,
	currentOrganizationIds: readonly number[],
): StaticFabOrganizationMultiSelectionResult {
	assertCanonicalState(state);
	assertOrganizationIds(currentOrganizationIds, "current organization IDs");
	const currentIds = new Set(currentOrganizationIds);
	const selectedOrganizationIds = state.selectedOrganizationIds.filter((id) => currentIds.has(id));
	const focusedOrganizationId = existingIdentity(state.focusedOrganizationId, currentIds);
	const anchorOrganizationId = existingIdentity(state.anchorOrganizationId, currentIds);
	const next = freezeState(selectedOrganizationIds, focusedOrganizationId, anchorOrganizationId);
	if (statesEqual(state, next)) return unchanged(state);
	return applied(state, next, "STALE_IDENTITIES_PRUNED");
}

function canonicalIds(ids: readonly number[]): readonly number[] {
	return Object.freeze([...new Set(ids)].sort((left, right) => left - right));
}

function uniqueIdsInOriginalOrder(ids: readonly number[]): readonly number[] {
	return [...new Set(ids)];
}

function existingIdentity(id: number | null, currentIds: ReadonlySet<number>): number | null {
	return id !== null && currentIds.has(id) ? id : null;
}

function freezeState(
	selectedOrganizationIds: readonly number[],
	focusedOrganizationId: number | null,
	anchorOrganizationId: number | null,
): StaticFabOrganizationMultiSelectionState {
	return Object.freeze({
		selectedOrganizationIds: Object.freeze([...selectedOrganizationIds]),
		focusedOrganizationId,
		anchorOrganizationId,
	});
}

function applied(
	previous: StaticFabOrganizationMultiSelectionState,
	state: StaticFabOrganizationMultiSelectionState,
	reason: StaticFabOrganizationMultiSelectionReason,
): StaticFabOrganizationMultiSelectionResult {
	return Object.freeze({ accepted: true, changed: !statesEqual(previous, state), reason, state });
}

function rejected(
	state: StaticFabOrganizationMultiSelectionState,
	reason: StaticFabOrganizationMultiSelectionReason,
): StaticFabOrganizationMultiSelectionResult {
	return Object.freeze({ accepted: false, changed: false, reason, state });
}

function unchanged(
	state: StaticFabOrganizationMultiSelectionState,
): StaticFabOrganizationMultiSelectionResult {
	return Object.freeze({ accepted: true, changed: false, reason: "UNCHANGED", state });
}

function statesEqual(
	left: StaticFabOrganizationMultiSelectionState,
	right: StaticFabOrganizationMultiSelectionState,
): boolean {
	return (
		left.focusedOrganizationId === right.focusedOrganizationId &&
		left.anchorOrganizationId === right.anchorOrganizationId &&
		left.selectedOrganizationIds.length === right.selectedOrganizationIds.length &&
		left.selectedOrganizationIds.every((id, index) => id === right.selectedOrganizationIds[index])
	);
}

function assertCanonicalState(state: StaticFabOrganizationMultiSelectionState): void {
	if (state.selectedOrganizationIds.length > STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS) {
		throw new RangeError(selectionLimitReason());
	}
	assertOrganizationIds(state.selectedOrganizationIds, "selected organization IDs");
	for (let index = 1; index < state.selectedOrganizationIds.length; index++) {
		if (
			(state.selectedOrganizationIds[index - 1] as number) >=
			(state.selectedOrganizationIds[index] as number)
		) {
			throw new TypeError("selected organization IDs must be unique and ascending");
		}
	}
	assertNullableOrganizationId(state.focusedOrganizationId, "focused organization ID");
	assertNullableOrganizationId(state.anchorOrganizationId, "anchor organization ID");
}

function assertOrganizationIds(ids: readonly number[], label: string): void {
	for (const id of ids) assertOrganizationId(id, label);
}

function assertNullableOrganizationId(id: number | null, label: string): void {
	if (id !== null) assertOrganizationId(id, label);
}

function assertOrganizationId(id: number, label: string): void {
	if (!Number.isSafeInteger(id) || id <= 0) {
		throw new TypeError(`${label} must contain only positive safe integers`);
	}
}

function selectionLimitReason(): string {
	return `organization selection cannot exceed ${STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS.toLocaleString()} roots`;
}
