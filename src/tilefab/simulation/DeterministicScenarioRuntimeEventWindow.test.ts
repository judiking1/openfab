import { describe, expect, it } from "vitest";
import type {
	SimulationScenarioManifest,
	SimulationTransferPlanManifest,
} from "../compile/SimulationScenarioManifest";
import type { DeterministicScenarioEvent } from "./DeterministicScenarioAdmissionCore";
import type { DeterministicScenarioResourceEvent } from "./DeterministicScenarioResourceState";
import {
	DETERMINISTIC_SCENARIO_RUNTIME_EVENT_WINDOW_MAXIMUM_PER_STREAM,
	type DeterministicScenarioRuntimeEventSource,
	selectDeterministicScenarioRuntimeEventWindow,
} from "./DeterministicScenarioRuntimeEventWindow";

describe("selectDeterministicScenarioRuntimeEventWindow", () => {
	it("copies bounded independent tails without inventing cross-stream ordering", () => {
		const source = eventSource(9, 8);
		const window = selectDeterministicScenarioRuntimeEventWindow(source, manifest(9));

		expect(window).toMatchObject({
			sourceKind: "TRANSFER_PLAN",
			coreEventCount: 9,
			coreStartIndex: 3,
			resourceEventCount: 8,
			resourceStartIndex: 2,
		});
		expect(window.coreRows).toHaveLength(
			DETERMINISTIC_SCENARIO_RUNTIME_EVENT_WINDOW_MAXIMUM_PER_STREAM,
		);
		expect(window.resourceRows).toHaveLength(
			DETERMINISTIC_SCENARIO_RUNTIME_EVENT_WINDOW_MAXIMUM_PER_STREAM,
		);
		expect(window.coreRows[0]).toMatchObject({
			sequence: 4,
			recordId: "PLAN-3",
			loadId: "LOAD-3",
			sourcePortId: 4,
			destinationPortId: 5,
		});
		expect(window.resourceRows[0]).toMatchObject({
			sequence: 3,
			recordId: "PLAN-2",
			resourceRow: 2,
		});
		expect(Object.isFrozen(window)).toBe(true);
		expect(Object.isFrozen(window.coreRows[0])).toBe(true);
	});

	it("reads only the fixed tails and their exact manifest records at 100k scale", () => {
		const recordReads: number[] = [];
		const records = new Proxy({ length: 100_000 } as unknown as readonly never[], {
			get(target, property, receiver) {
				if (typeof property === "string" && /^\d+$/.test(property)) {
					const index = Number(property);
					recordReads.push(index);
					return planRecord(index);
				}
				return Reflect.get(target, property, receiver);
			},
		});
		const largeManifest = { ...manifest(0), records } as unknown as SimulationTransferPlanManifest;
		const source = eventSource(100_000, 100_000);

		const window = selectDeterministicScenarioRuntimeEventWindow(source, largeManifest);

		expect(window.coreRows).toHaveLength(6);
		expect(window.resourceRows).toHaveLength(6);
		expect(recordReads).toHaveLength(12);
		expect(recordReads.every((index) => index >= 99_994)).toBe(true);
	});

	it("fails closed on unavailable request rows and malformed counts", () => {
		const unavailable = eventSource(1, 0);
		expect(() => selectDeterministicScenarioRuntimeEventWindow(unavailable, manifest(0))).toThrow(
			/unavailable/,
		);
		const malformed = { ...eventSource(0, 0), eventCount: -1 };
		expect(() => selectDeterministicScenarioRuntimeEventWindow(malformed, manifest(0))).toThrow(
			/core event count/,
		);
	});
});

function eventSource(
	coreCount: number,
	resourceCount: number,
): DeterministicScenarioRuntimeEventSource {
	return {
		eventCount: coreCount,
		resourceEventCount: resourceCount,
		eventAt(index): DeterministicScenarioEvent {
			return {
				sequence: index + 1,
				timeMicroseconds: index * 10,
				type: "FOUP_PICKED_UP",
				requestRow: index,
				vehicleTokenId: index + 1,
				loadRow: index,
			};
		},
		resourceEventAt(index): DeterministicScenarioResourceEvent {
			return {
				type: "STORAGE_DESTINATION_OCCUPIED",
				timeMicroseconds: index * 10,
				requestRow: index,
				loadRow: index,
				resourceRow: index,
			};
		},
	};
}

function manifest(recordCount: number): SimulationScenarioManifest {
	return {
		schemaVersion: 1,
		sourceKind: "TRANSFER_PLAN",
		timeUnit: "MICROSECONDS",
		orderingPolicy: "TIME_THEN_SOURCE_ORDINAL_THEN_RECORD_ID_V1",
		manifestId: "PLAN-EVENTS",
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

function planRecord(index: number) {
	return {
		sourceOrdinal: index,
		transferId: `PLAN-${index}`,
		releaseTimeMicroseconds: index * 10,
		loadId: `LOAD-${index}`,
		sourcePortId: index + 1,
		destinationPortId: index + 2,
	};
}
