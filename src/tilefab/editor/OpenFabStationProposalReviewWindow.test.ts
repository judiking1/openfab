import { describe, expect, it } from "vitest";
import {
	navigateOpenFabStationProposalReviewGrid,
	OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS,
	OPENFAB_STATION_PROPOSAL_REVIEW_MAX_WINDOW_ROWS,
	OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX,
	OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS,
	selectOpenFabStationProposalReviewWindow,
} from "./OpenFabStationProposalReviewWindow";

const ROW_HEIGHT = OPENFAB_STATION_PROPOSAL_REVIEW_ROW_HEIGHT_PIXELS;

describe("selectOpenFabStationProposalReviewWindow", () => {
	it("returns an empty bounded window for zero or invalid row counts", () => {
		for (const rowCount of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
			expect(
				selectOpenFabStationProposalReviewWindow({
					rowCount,
					scrollTop: 10_000,
					clientHeight: 440,
				}),
			).toMatchObject({
				rowCount: 0,
				scrollTop: 0,
				clientHeight: 0,
				startIndex: 0,
				endIndexExclusive: 0,
				renderedRowCount: 0,
				topSpacerPixels: 0,
				bottomSpacerPixels: 0,
			});
		}
	});

	it("selects the beginning of a 100k-row surface with fixed-height overscan", () => {
		const window = selectOpenFabStationProposalReviewWindow({
			rowCount: 100_000,
			scrollTop: 0,
			clientHeight: ROW_HEIGHT * 10,
		});

		expect(window).toMatchObject({
			rowCount: 100_000,
			visibleStartIndex: 0,
			visibleEndIndexExclusive: 10,
			startIndex: 0,
			endIndexExclusive: 18,
			renderedRowCount: 18,
			topSpacerPixels: 0,
			bottomSpacerPixels: (100_000 - 18) * ROW_HEIGHT,
		});
	});

	it("selects deterministic overscan around a middle viewport", () => {
		const firstVisibleIndex = 50_000;
		const window = selectOpenFabStationProposalReviewWindow({
			rowCount: 100_000,
			scrollTop: firstVisibleIndex * ROW_HEIGHT,
			clientHeight: ROW_HEIGHT * 10,
			overscanRows: 12,
		});

		expect(window).toMatchObject({
			visibleStartIndex: firstVisibleIndex,
			visibleEndIndexExclusive: firstVisibleIndex + 10,
			startIndex: firstVisibleIndex - 12,
			endIndexExclusive: firstVisibleIndex + 22,
			renderedRowCount: 34,
			topSpacerPixels: (firstVisibleIndex - 12) * ROW_HEIGHT,
		});
	});

	it("clamps excessive scroll to the end and keeps the last row rendered", () => {
		const window = selectOpenFabStationProposalReviewWindow({
			rowCount: 100_000,
			scrollTop: Number.POSITIVE_INFINITY,
			clientHeight: ROW_HEIGHT * 10,
		});

		expect(window.scrollTop).toBe((100_000 - 10) * ROW_HEIGHT);
		expect(window.visibleStartIndex).toBe(99_990);
		expect(window.visibleEndIndexExclusive).toBe(100_000);
		expect(window.endIndexExclusive).toBe(100_000);
		expect(window.renderedRowCount).toBe(18);
	});

	it("clamps NaN, negative, fractional, and excessive measurements", () => {
		const invalid = selectOpenFabStationProposalReviewWindow({
			rowCount: 12.9,
			scrollTop: Number.NaN,
			clientHeight: -100,
			overscanRows: -10,
		});
		expect(invalid).toMatchObject({
			rowCount: 12,
			scrollTop: 0,
			clientHeight: 0,
			overscanRows: 0,
			visibleStartIndex: 0,
			visibleEndIndexExclusive: 1,
			startIndex: 0,
			endIndexExclusive: 1,
		});

		const excessive = selectOpenFabStationProposalReviewWindow({
			rowCount: Number.POSITIVE_INFINITY,
			scrollTop: 9_999_999,
			clientHeight: Number.POSITIVE_INFINITY,
			overscanRows: Number.POSITIVE_INFINITY,
		});
		expect(excessive.rowCount).toBe(OPENFAB_STATION_PROPOSAL_REVIEW_MAX_WINDOW_ROWS);
		expect(excessive.clientHeight).toBe(excessive.totalHeightPixels);
		expect(excessive.scrollTop).toBe(0);
		expect(excessive.renderedRowCount).toBe(OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS);
	});

	it("never selects more than the 128-row DOM budget", () => {
		for (const request of [
			{ rowCount: 100_000, scrollTop: 0, clientHeight: ROW_HEIGHT * 10, overscanRows: 50_000 },
			{
				rowCount: 100_000,
				scrollTop: ROW_HEIGHT * 50_000,
				clientHeight: ROW_HEIGHT * 10_000,
				overscanRows: 100_000,
			},
			{
				rowCount: 100_000,
				scrollTop: Number.POSITIVE_INFINITY,
				clientHeight: ROW_HEIGHT * 10,
				overscanRows: Number.POSITIVE_INFINITY,
			},
		]) {
			const window = selectOpenFabStationProposalReviewWindow(request);
			expect(window.renderedRowCount).toBeLessThanOrEqual(
				OPENFAB_STATION_PROPOSAL_REVIEW_MAX_DOM_ROWS,
			);
			expect(window.endIndexExclusive - window.startIndex).toBe(window.renderedRowCount);
		}
	});
});

describe("navigateOpenFabStationProposalReviewGrid", () => {
	it("keeps an empty grid inactive for every navigation key", () => {
		for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
			expect(
				navigateOpenFabStationProposalReviewGrid({
					key,
					rowCount: 0,
					activeIndex: 50,
					scrollTop: 999,
					clientHeight: 440,
				}),
			).toMatchObject({
				handled: true,
				activeIndex: OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX,
				scrollTarget: 0,
			});
		}
	});

	it("moves by Arrow and scrolls only when the active row leaves the viewport", () => {
		const base = {
			rowCount: 100,
			scrollTop: 0,
			clientHeight: ROW_HEIGHT * 3,
		};
		expect(
			navigateOpenFabStationProposalReviewGrid({ ...base, key: "ArrowDown", activeIndex: 1 }),
		).toMatchObject({ activeIndex: 2, scrollTarget: 0 });
		expect(
			navigateOpenFabStationProposalReviewGrid({ ...base, key: "ArrowDown", activeIndex: 2 }),
		).toMatchObject({ activeIndex: 3, scrollTarget: ROW_HEIGHT });
		expect(
			navigateOpenFabStationProposalReviewGrid({
				...base,
				key: "ArrowUp",
				activeIndex: 3,
				scrollTop: ROW_HEIGHT * 3,
			}),
		).toMatchObject({ activeIndex: 2, scrollTarget: ROW_HEIGHT * 2 });
	});

	it("lands an inactive nonempty grid on an exact row without skipping or handling other keys", () => {
		const base = {
			rowCount: 100,
			activeIndex: OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX,
			scrollTop: ROW_HEIGHT * 50,
			clientHeight: ROW_HEIGHT * 3,
		};
		for (const key of ["ArrowUp", "ArrowDown", "Home", "PageUp", "PageDown"]) {
			expect(navigateOpenFabStationProposalReviewGrid({ ...base, key })).toMatchObject({
				handled: true,
				activeIndex: 0,
				scrollTarget: 0,
			});
		}
		expect(navigateOpenFabStationProposalReviewGrid({ ...base, key: "End" })).toMatchObject({
			handled: true,
			activeIndex: 99,
			scrollTarget: ROW_HEIGHT * 97,
		});
		expect(navigateOpenFabStationProposalReviewGrid({ ...base, key: "Enter" })).toMatchObject({
			handled: false,
			activeIndex: OPENFAB_STATION_PROPOSAL_REVIEW_NO_ACTIVE_INDEX,
			scrollTarget: ROW_HEIGHT * 50,
		});
	});

	it("moves Home and End to exact bounded scroll targets", () => {
		const base = {
			rowCount: 100_000,
			activeIndex: 50_000,
			scrollTop: ROW_HEIGHT * 50_000,
			clientHeight: ROW_HEIGHT * 10,
		};
		expect(navigateOpenFabStationProposalReviewGrid({ ...base, key: "Home" })).toMatchObject({
			activeIndex: 0,
			scrollTarget: 0,
		});
		expect(navigateOpenFabStationProposalReviewGrid({ ...base, key: "End" })).toMatchObject({
			activeIndex: 99_999,
			scrollTarget: (100_000 - 10) * ROW_HEIGHT,
		});
	});

	it("moves PageUp and PageDown by the fixed-height viewport capacity", () => {
		const base = {
			rowCount: 100,
			clientHeight: ROW_HEIGHT * 3,
		};
		expect(
			navigateOpenFabStationProposalReviewGrid({
				...base,
				key: "PageDown",
				activeIndex: 4,
				scrollTop: ROW_HEIGHT * 3,
			}),
		).toMatchObject({
			activeIndex: 7,
			scrollTarget: ROW_HEIGHT * 6,
			pageSizeRows: 3,
		});
		expect(
			navigateOpenFabStationProposalReviewGrid({
				...base,
				key: "PageUp",
				activeIndex: 4,
				scrollTop: ROW_HEIGHT * 3,
			}),
		).toMatchObject({
			activeIndex: 1,
			scrollTarget: 0,
			pageSizeRows: 3,
		});
	});

	it("clamps invalid and excessive keyboard state without handling unrelated keys", () => {
		const invalid = navigateOpenFabStationProposalReviewGrid({
			key: "Enter",
			rowCount: 10.8,
			activeIndex: Number.NaN,
			scrollTop: Number.NEGATIVE_INFINITY,
			clientHeight: -1,
		});
		expect(invalid).toEqual({
			handled: false,
			activeIndex: 0,
			scrollTarget: 0,
			pageSizeRows: 1,
		});

		const excessive = navigateOpenFabStationProposalReviewGrid({
			key: "End",
			rowCount: Number.POSITIVE_INFINITY,
			activeIndex: Number.POSITIVE_INFINITY,
			scrollTop: Number.POSITIVE_INFINITY,
			clientHeight: ROW_HEIGHT,
		});
		expect(excessive).toMatchObject({
			activeIndex: OPENFAB_STATION_PROPOSAL_REVIEW_MAX_WINDOW_ROWS - 1,
			scrollTarget: (OPENFAB_STATION_PROPOSAL_REVIEW_MAX_WINDOW_ROWS - 1) * ROW_HEIGHT,
		});
	});
});
