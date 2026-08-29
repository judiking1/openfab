import { describe, expect, it } from "vitest";
import type {
	SimulationReplayHistoryManifest,
	SimulationTransferPlanManifest,
} from "../compile/SimulationScenarioManifest";
import {
	SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE,
	selectSimulationScenarioManifestReviewWindow,
} from "./SimulationScenarioManifestReviewWindow";

describe("selectSimulationScenarioManifestReviewWindow", () => {
	it("materializes bounded canonical Transfer Plan pages", () => {
		const manifest = transferPlanManifest(19);
		const first = selectSimulationScenarioManifestReviewWindow(manifest, 0);
		expect(first).toMatchObject({
			totalCount: 19,
			startIndex: 0,
			endIndexExclusive: 8,
			hasPrevious: false,
			hasNext: true,
		});
		expect(first.rows).toHaveLength(SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE);
		expect(first.rows[0]).toEqual({
			canonicalIndex: 0,
			sourceOrdinal: 0,
			recordId: "PLAN-0",
			timeMicroseconds: 100,
			loadId: "LOAD-0",
			sourcePortId: 1,
			destinationPortId: 2,
		});

		const last = selectSimulationScenarioManifestReviewWindow(manifest, 999_999);
		expect(last).toMatchObject({
			startIndex: 16,
			endIndexExclusive: 19,
			hasPrevious: true,
			hasNext: false,
		});
		expect(last.rows.map((row) => row.recordId)).toEqual(["PLAN-16", "PLAN-17", "PLAN-18"]);
	});

	it("uses observed History time and clamps invalid starts", () => {
		const manifest = replayHistoryManifest(2);
		for (const requestedStart of [-50, Number.NaN, Number.POSITIVE_INFINITY]) {
			const window = selectSimulationScenarioManifestReviewWindow(manifest, requestedStart);
			expect(window.startIndex).toBe(0);
			expect(window.rows[0]).toMatchObject({
				recordId: "HISTORY-0",
				timeMicroseconds: 700,
			});
		}
	});

	it("reads at most one page from a 100k-record manifest", () => {
		const targetStart = 72_000;
		const records = Array.from({ length: 100_000 }, (_, index) => planRecord(index));
		let indexedReads = 0;
		const observedRecords = new Proxy(records, {
			get(target, property, receiver) {
				if (typeof property === "string" && /^\d+$/.test(property)) indexedReads++;
				return Reflect.get(target, property, receiver);
			},
		});
		const manifest = {
			...transferPlanManifest(0),
			inputRecordCount: records.length,
			acceptedRecordCount: records.length,
			records: observedRecords,
		} as unknown as SimulationTransferPlanManifest;

		const window = selectSimulationScenarioManifestReviewWindow(manifest, targetStart);

		expect(window.rows).toHaveLength(SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE);
		expect(window.rows[0]?.canonicalIndex).toBe(targetStart);
		expect(indexedReads).toBe(SIMULATION_SCENARIO_MANIFEST_REVIEW_PAGE_SIZE);
		expect(Object.isFrozen(window.rows)).toBe(true);
	});

	it("returns a frozen empty window", () => {
		const window = selectSimulationScenarioManifestReviewWindow(transferPlanManifest(0), 80);
		expect(window).toMatchObject({
			totalCount: 0,
			startIndex: 0,
			endIndexExclusive: 0,
			hasPrevious: false,
			hasNext: false,
			rows: [],
		});
		expect(Object.isFrozen(window)).toBe(true);
	});
});

function transferPlanManifest(recordCount: number): SimulationTransferPlanManifest {
	return {
		schemaVersion: 1,
		sourceKind: "TRANSFER_PLAN",
		timeUnit: "MICROSECONDS",
		orderingPolicy: "TIME_THEN_SOURCE_ORDINAL_THEN_RECORD_ID_V1",
		manifestId: "PLAN-REVIEW",
		adapterId: "TEST",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: recordCount,
		acceptedRecordCount: recordCount,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records: Array.from({ length: recordCount }, (_, index) => planRecord(index)),
		fingerprint: "manifest",
	};
}

function replayHistoryManifest(recordCount: number): SimulationReplayHistoryManifest {
	return {
		...transferPlanManifest(0),
		sourceKind: "REPLAY_HISTORY",
		manifestId: "HISTORY-REVIEW",
		inputRecordCount: recordCount,
		acceptedRecordCount: recordCount,
		records: Array.from({ length: recordCount }, (_, index) => ({
			sourceOrdinal: index,
			historyEventId: `HISTORY-${index}`,
			observedTimeMicroseconds: index * 1_000 + 700,
			loadId: `LOAD-${index}`,
			sourcePortId: index + 1,
			destinationPortId: index + 2,
		})),
	} as SimulationReplayHistoryManifest;
}

function planRecord(index: number) {
	return {
		sourceOrdinal: index,
		transferId: `PLAN-${index}`,
		releaseTimeMicroseconds: index * 1_000 + 100,
		loadId: `LOAD-${index}`,
		sourcePortId: index + 1,
		destinationPortId: index + 2,
	};
}
