import {
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_GROUPS,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_ROWS,
} from "../compile/OpenFabStationProposalReviewEvaluationArtifact";

export const OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS = 44;
export const OPENFAB_STATION_PROPOSAL_REVIEW_DEFAULT_OVERSCAN_ROWS = 8;
export const OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS = 128;
export const OPENFAB_STATION_PROPOSAL_REVIEW_MAX_WINDOW_ROWS = Math.max(
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_ROWS,
	OPENFAB_STATION_PROPOSAL_REVIEW_EVALUATION_MAX_GROUPS,
);
export const OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX = -1;

export interface OpenFabStationProposalReviewWindowRequest {
	readonly rowCount: number;
	readonly scrollTop: number;
	readonly clientHeight: number;
	readonly overscanRows?: number;
}

/** A half-open, allocation-free row window suitable for one fixed-height spacer list. */
export interface OpenFabStationProposalReviewWindow {
	readonly rowCount: number;
	readonly rowHeightPixels: typeof OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS;
	readonly scrollTop: number;
	readonly clientHeight: number;
	readonly overscanRows: number;
	readonly totalHeightPixels: number;
	readonly maximumScrollTop: number;
	readonly visibleStartIndex: number;
	readonly visibleEndIndexExclusive: number;
	readonly startIndex: number;
	readonly endIndexExclusive: number;
	readonly renderedRowCount: number;
	readonly topSpacerPixels: number;
	readonly bottomSpacerPixels: number;
}

export type OpenFabStationProposalReviewGridKey =
	| "ArrowUp"
	| "ArrowDown"
	| "Home"
	| "End"
	| "PageUp"
	| "PageDown";

export interface OpenFabStationProposalReviewGridNavigationRequest {
	readonly key: string;
	readonly rowCount: number;
	readonly activeIndex: number;
	readonly scrollTop: number;
	readonly clientHeight: number;
}

export interface OpenFabStationProposalReviewGridNavigation {
	readonly handled: boolean;
	readonly activeIndex: number;
	readonly scrollTarget: number;
	readonly pageSizeRows: number;
}

/**
 * Select the bounded rows that may be materialized by the Review UI.
 *
 * The hard cap wins even for a malformed viewport taller than 128 rows. The returned visible range
 * still describes the normalized viewport, while the rendered range is always at most 128 rows.
 */
export function selectOpenFabStationProposalReviewWindow(
	request: OpenFabStationProposalReviewWindowRequest,
): OpenFabStationProposalReviewWindow {
	const rowCount = boundedInteger(
		request.rowCount,
		OPENFAB_STATION_PROPOSAL_REVIEW_MAX_WINDOW_ROWS,
	);
	const rowHeightPixels = OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS;
	const totalHeightPixels = rowCount * rowHeightPixels;
	const clientHeight = boundedPixels(request.clientHeight, totalHeightPixels);
	const maximumScrollTop = Math.max(0, totalHeightPixels - clientHeight);
	const scrollTop = boundedPixels(request.scrollTop, maximumScrollTop);
	const overscanRows =
		request.overscanRows === undefined
			? OPENFAB_STATION_PROPOSAL_REVIEW_DEFAULT_OVERSCAN_ROWS
			: boundedInteger(request.overscanRows, OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS);

	if (rowCount === 0) {
		return {
			rowCount,
			rowHeightPixels,
			scrollTop,
			clientHeight,
			overscanRows,
			totalHeightPixels,
			maximumScrollTop,
			visibleStartIndex: 0,
			visibleEndIndexExclusive: 0,
			startIndex: 0,
			endIndexExclusive: 0,
			renderedRowCount: 0,
			topSpacerPixels: 0,
			bottomSpacerPixels: 0,
		};
	}

	const visibleStartIndex = Math.min(rowCount - 1, Math.floor(scrollTop / rowHeightPixels));
	const visibleEndIndexExclusive = Math.min(
		rowCount,
		Math.max(visibleStartIndex + 1, Math.ceil((scrollTop + clientHeight) / rowHeightPixels)),
	);
	const desiredStartIndex = Math.max(0, visibleStartIndex - overscanRows);
	const desiredEndIndexExclusive = Math.min(rowCount, visibleEndIndexExclusive + overscanRows);

	let startIndex = desiredStartIndex;
	let endIndexExclusive = desiredEndIndexExclusive;
	if (desiredEndIndexExclusive - desiredStartIndex > OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS) {
		const visibleRowCount = visibleEndIndexExclusive - visibleStartIndex;
		if (visibleRowCount >= OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS) {
			startIndex = visibleStartIndex;
		} else {
			const spareRows = OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS - visibleRowCount;
			const centeredStartIndex = visibleStartIndex - Math.floor(spareRows / 2);
			const minimumStartIndex = Math.max(
				0,
				visibleEndIndexExclusive - OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS,
			);
			const maximumStartIndex = Math.min(
				visibleStartIndex,
				rowCount - OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS,
			);
			startIndex = clamp(centeredStartIndex, minimumStartIndex, maximumStartIndex);
		}
		endIndexExclusive = Math.min(
			rowCount,
			startIndex + OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS,
		);
	}

	const renderedRowCount = endIndexExclusive - startIndex;
	return {
		rowCount,
		rowHeightPixels,
		scrollTop,
		clientHeight,
		overscanRows,
		totalHeightPixels,
		maximumScrollTop,
		visibleStartIndex,
		visibleEndIndexExclusive,
		startIndex,
		endIndexExclusive,
		renderedRowCount,
		topSpacerPixels: startIndex * rowHeightPixels,
		bottomSpacerPixels: (rowCount - endIndexExclusive) * rowHeightPixels,
	};
}

/** Resolve row-grid navigation without reading DOM state or mutating a scroll container. */
export function navigateOpenFabStationProposalReviewGrid(
	request: OpenFabStationProposalReviewGridNavigationRequest,
): OpenFabStationProposalReviewGridNavigation {
	const rowCount = boundedInteger(
		request.rowCount,
		OPENFAB_STATION_PROPOSAL_REVIEW_MAX_WINDOW_ROWS,
	);
	const totalHeightPixels = rowCount * OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS;
	const clientHeight = boundedPixels(request.clientHeight, totalHeightPixels);
	const maximumScrollTop = Math.max(0, totalHeightPixels - clientHeight);
	const scrollTop = boundedPixels(request.scrollTop, maximumScrollTop);
	const pageSizeRows = Math.max(
		1,
		Math.floor(clientHeight / OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS),
	);
	const handled = isGridNavigationKey(request.key);

	if (rowCount === 0) {
		return {
			handled,
			activeIndex: OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX,
			scrollTarget: 0,
			pageSizeRows,
		};
	}

	const hasNoActiveIndex = request.activeIndex === OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX;
	const activeIndex = hasNoActiveIndex
		? OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX
		: boundedInteger(request.activeIndex, rowCount - 1);
	if (!handled) {
		return { handled, activeIndex, scrollTarget: scrollTop, pageSizeRows };
	}
	if (hasNoActiveIndex) {
		const nextActiveIndex = request.key === "End" ? rowCount - 1 : 0;
		const preferredScrollTop = request.key === "End" ? maximumScrollTop : 0;
		return {
			handled,
			activeIndex: nextActiveIndex,
			scrollTarget: scrollTopKeepingRowVisible(
				nextActiveIndex,
				preferredScrollTop,
				clientHeight,
				maximumScrollTop,
			),
			pageSizeRows,
		};
	}

	let nextActiveIndex = activeIndex;
	let preferredScrollTop = scrollTop;
	if (request.key === "ArrowUp") {
		nextActiveIndex = Math.max(0, activeIndex - 1);
	} else if (request.key === "ArrowDown") {
		nextActiveIndex = Math.min(rowCount - 1, activeIndex + 1);
	} else if (request.key === "Home") {
		nextActiveIndex = 0;
		preferredScrollTop = 0;
	} else if (request.key === "End") {
		nextActiveIndex = rowCount - 1;
		preferredScrollTop = maximumScrollTop;
	} else if (request.key === "PageUp") {
		nextActiveIndex = Math.max(0, activeIndex - pageSizeRows);
		preferredScrollTop = Math.max(
			0,
			scrollTop - pageSizeRows * OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS,
		);
	} else {
		nextActiveIndex = Math.min(rowCount - 1, activeIndex + pageSizeRows);
		preferredScrollTop = Math.min(
			maximumScrollTop,
			scrollTop + pageSizeRows * OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS,
		);
	}

	return {
		handled,
		activeIndex: nextActiveIndex,
		scrollTarget: scrollTopKeepingRowVisible(
			nextActiveIndex,
			preferredScrollTop,
			clientHeight,
			maximumScrollTop,
		),
		pageSizeRows,
	};
}

function scrollTopKeepingRowVisible(
	activeIndex: number,
	preferredScrollTop: number,
	clientHeight: number,
	maximumScrollTop: number,
): number {
	const rowTop = activeIndex * OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS;
	const rowBottom = rowTop + OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS;
	let scrollTarget = preferredScrollTop;
	if (rowTop < scrollTarget) {
		scrollTarget = rowTop;
	} else if (rowBottom > scrollTarget + clientHeight) {
		scrollTarget = rowBottom - clientHeight;
	}
	return clamp(scrollTarget, 0, maximumScrollTop);
}

function isGridNavigationKey(value: string): value is OpenFabStationProposalReviewGridKey {
	return (
		value === "ArrowUp" ||
		value === "ArrowDown" ||
		value === "Home" ||
		value === "End" ||
		value === "PageUp" ||
		value === "PageDown"
	);
}

function boundedInteger(value: number, maximum: number): number {
	if (value === Number.POSITIVE_INFINITY) return maximum;
	if (!Number.isFinite(value)) return 0;
	return clamp(Math.floor(value), 0, maximum);
}

function boundedPixels(value: number, maximum: number): number {
	if (value === Number.POSITIVE_INFINITY) return maximum;
	if (!Number.isFinite(value)) return 0;
	return clamp(value, 0, maximum);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
