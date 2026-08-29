import { describe, expect, it } from "vitest";
import {
	DETERMINISTIC_SCENARIO_RESOURCE_EVENT_MAXIMUM_PER_REQUEST,
	DeterministicScenarioResourceEventLog,
	type DeterministicScenarioResourceEventType,
} from "./DeterministicScenarioResourceEventLog";

const EVENT_TYPES: readonly DeterministicScenarioResourceEventType[] = [
	"STORAGE_DESTINATION_RESERVED",
	"STORAGE_DESTINATION_RESERVATION_CANCELLED",
	"STORAGE_SOURCE_RELEASED",
	"STORAGE_DESTINATION_OCCUPIED",
	"EQ_SERVICE_QUEUED",
	"EQ_SERVICE_STARTED",
	"EQ_SERVICE_READY",
];

describe("DeterministicScenarioResourceEventLog", () => {
	it("reconstructs immutable event values in exact append order", () => {
		const log = new DeterministicScenarioResourceEventLog(EVENT_TYPES.length);
		EVENT_TYPES.forEach((type, requestRow) => {
			log.append({
				type,
				timeMicroseconds: requestRow * 10,
				requestRow,
				loadRow: requestRow + 1,
				resourceRow: requestRow + 2,
			});
		});

		expect(log.eventCount).toBe(EVENT_TYPES.length);
		for (let index = 0; index < EVENT_TYPES.length; index++) {
			const event = log.eventAt(index);
			expect(event).toEqual({
				type: EVENT_TYPES[index],
				timeMicroseconds: index * 10,
				requestRow: index,
				loadRow: index + 1,
				resourceRow: index + 2,
			});
			expect(Object.isFrozen(event)).toBe(true);
		}
		expect(() => log.eventAt(EVENT_TYPES.length)).toThrow(/index/);
	});

	it("fails before writing a sixth event for one request", () => {
		const log = new DeterministicScenarioResourceEventLog(1);
		for (
			let index = 0;
			index < DETERMINISTIC_SCENARIO_RESOURCE_EVENT_MAXIMUM_PER_REQUEST;
			index++
		) {
			log.append(event(0, index));
		}
		const before = log.eventAt(log.eventCount - 1);

		expect(() => log.append(event(0, 99))).toThrow(/event budget/);
		expect(log.eventCount).toBe(DETERMINISTIC_SCENARIO_RESOURCE_EVENT_MAXIMUM_PER_REQUEST);
		expect(log.eventAt(log.eventCount - 1)).toEqual(before);
	});

	it("bounds retained 100k-request history to 10.6 MB of typed capacity", () => {
		const requestCount = 100_000;
		const log = new DeterministicScenarioResourceEventLog(requestCount);
		for (let requestRow = 0; requestRow < requestCount; requestRow++) {
			for (
				let eventIndex = 0;
				eventIndex < DETERMINISTIC_SCENARIO_RESOURCE_EVENT_MAXIMUM_PER_REQUEST;
				eventIndex++
			) {
				log.append(event(requestRow, eventIndex));
			}
		}

		expect(log.eventCount).toBe(500_000);
		expect(log.retainedByteCapacity).toBe(10_600_000);
		expect(log.eventAt(499_999)).toMatchObject({ requestRow: 99_999, timeMicroseconds: 4 });
	});

	it("rejects malformed construction and event values", () => {
		expect(() => new DeterministicScenarioResourceEventLog(-1)).toThrow(/request count/);
		const log = new DeterministicScenarioResourceEventLog(1);
		expect(() => log.append({ ...event(0, 0), timeMicroseconds: Number.NaN })).toThrow(
			/event values/,
		);
		expect(() => log.append({ ...event(0, 0), requestRow: 1 })).toThrow(/event values/);
		expect(() =>
			log.append({ ...event(0, 0), type: "UNKNOWN" as DeterministicScenarioResourceEventType }),
		).toThrow(/event type/);
	});
});

function event(requestRow: number, timeMicroseconds: number) {
	return {
		type: "STORAGE_DESTINATION_RESERVED" as const,
		timeMicroseconds,
		requestRow,
		loadRow: requestRow,
		resourceRow: requestRow,
	};
}
