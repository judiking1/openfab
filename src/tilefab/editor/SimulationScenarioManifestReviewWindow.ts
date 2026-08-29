import type {
	SimulationReplayHistoryRecord,
	SimulationScenarioManifest,
	SimulationTransferPlanRecord,
} from "../compile/SimulationScenarioManifest";

export const SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE = 8;

export interface SimulationScenarioManifestReviewRow {
	readonly canonicalIndex: number;
	readonly sourceOrdinal: number;
	readonly recordId: string;
	readonly timeMicroseconds: number;
	readonly loadId: string;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
}

export interface SimulationScenarioManifestReviewWindow {
	readonly totalCount: number;
	readonly startIndex: number;
	readonly endIndexExclusive: number;
	readonly hasPrevious: boolean;
	readonly hasNext: boolean;
	readonly rows: readonly SimulationScenarioManifestReviewRow[];
}

/**
 * Materialize one fixed-size canonical review page without slicing or copying the complete
 * manifest. The manifest is already independently compiled before this UI-only view is requested.
 */
export function selectSimulationScenarioManifestReviewWindow(
	manifest: SimulationScenarioManifest,
	requestedStartIndex: number,
): SimulationScenarioManifestReviewWindow {
	const totalCount = manifest.records.length;
	const lastPageStart =
		totalCount === 0
			? 0
			: Math.floor((totalCount - 1) / SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE) *
				SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE;
	const normalizedStart = Number.isSafeInteger(requestedStartIndex)
		? Math.max(0, requestedStartIndex)
		: 0;
	const startIndex = Math.min(
		lastPageStart,
		Math.floor(normalizedStart / SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE) *
			SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE,
	);
	const endIndexExclusive = Math.min(
		totalCount,
		startIndex + SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE,
	);
	const rows: SimulationScenarioManifestReviewRow[] = [];
	for (let canonicalIndex = startIndex; canonicalIndex < endIndexExclusive; canonicalIndex++) {
		const record = manifest.records[canonicalIndex];
		if (!record) throw new Error(`Scenario review record ${canonicalIndex} is unavailable.`);
		rows.push(reviewRow(manifest.sourceKind, canonicalIndex, record));
	}
	return Object.freeze({
		totalCount,
		startIndex,
		endIndexExclusive,
		hasPrevious: startIndex > 0,
		hasNext: endIndexExclusive < totalCount,
		rows: Object.freeze(rows),
	});
}

function reviewRow(
	sourceKind: SimulationScenarioManifest["sourceKind"],
	canonicalIndex: number,
	record: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
): SimulationScenarioManifestReviewRow {
	const sourceSpecific =
		sourceKind === "TRANSFER_PLAN"
			? (record as SimulationTransferPlanRecord)
			: (record as SimulationReplayHistoryRecord);
	return Object.freeze({
		canonicalIndex,
		sourceOrdinal: sourceSpecific.sourceOrdinal,
		recordId:
			sourceKind === "TRANSFER_PLAN"
				? (sourceSpecific as SimulationTransferPlanRecord).transferId
				: (sourceSpecific as SimulationReplayHistoryRecord).historyEventId,
		timeMicroseconds:
			sourceKind === "TRANSFER_PLAN"
				? (sourceSpecific as SimulationTransferPlanRecord).releaseTimeMicroseconds
				: (sourceSpecific as SimulationReplayHistoryRecord).observedTimeMicroseconds,
		loadId: sourceSpecific.loadId,
		sourcePortId: sourceSpecific.sourcePortId,
		destinationPortId: sourceSpecific.destinationPortId,
	});
}
