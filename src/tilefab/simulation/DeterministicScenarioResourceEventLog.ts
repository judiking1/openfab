export const DETERMINISTIC_SCENARIO_RESOURCE_EVENT_MAXIMUM_PER_REQUEST = 5;

export const DETERMINISTIC_SCENARIO_RESOURCE_EVENT_TYPE_CODE = Object.freeze({
	STORAGE_DESTINATION_RESERVED: 0,
	STORAGE_DESTINATION_RESERVATION_CANCELLED: 1,
	STORAGE_SOURCE_RELEASED: 2,
	STORAGE_DESTINATION_OCCUPIED: 3,
	EQ_SERVICE_QUEUED: 4,
	EQ_SERVICE_STARTED: 5,
	EQ_SERVICE_READY: 6,
} as const);

export type DeterministicScenarioResourceEventType =
	keyof typeof DETERMINISTIC_SCENARIO_RESOURCE_EVENT_TYPE_CODE;

export type DeterministicScenarioResourceEvent = Readonly<{
	type: DeterministicScenarioResourceEventType;
	timeMicroseconds: number;
	requestRow: number;
	loadRow: number;
	resourceRow: number;
}>;

const EVENT_TYPES = Object.freeze([
	"STORAGE_DESTINATION_RESERVED",
	"STORAGE_DESTINATION_RESERVATION_CANCELLED",
	"STORAGE_SOURCE_RELEASED",
	"STORAGE_DESTINATION_OCCUPIED",
	"EQ_SERVICE_QUEUED",
	"EQ_SERVICE_STARTED",
	"EQ_SERVICE_READY",
] satisfies DeterministicScenarioResourceEventType[]);
const INITIAL_EVENT_CAPACITY = 64;

/**
 * Bounded growable SoA for the complete limited-profile resource event history. `eventAt` preserves
 * the former immutable value-object API without retaining one JavaScript object per event.
 */
export class DeterministicScenarioResourceEventLog {
	private readonly requestCount: number;
	private readonly maximumEventCount: number;
	private readonly requestEventCounts: Uint8Array;
	private typeCodes = new Uint8Array(0);
	private timesMicroseconds = new Float64Array(0);
	private requestRows = new Uint32Array(0);
	private loadRows = new Uint32Array(0);
	private resourceRows = new Uint32Array(0);
	private eventsWritten = 0;

	constructor(requestCount: number) {
		if (!Number.isSafeInteger(requestCount) || requestCount < 0) {
			throw new RangeError("Scenario resource event-log request count is invalid.");
		}
		const maximumEventCount =
			requestCount * DETERMINISTIC_SCENARIO_RESOURCE_EVENT_MAXIMUM_PER_REQUEST;
		if (!Number.isSafeInteger(maximumEventCount)) {
			throw new RangeError("Scenario resource event-log maximum count is unsafe.");
		}
		this.requestCount = requestCount;
		this.maximumEventCount = maximumEventCount;
		this.requestEventCounts = new Uint8Array(requestCount);
	}

	get eventCount(): number {
		return this.eventsWritten;
	}

	get retainedByteCapacity(): number {
		return (
			this.requestEventCounts.byteLength +
			this.typeCodes.byteLength +
			this.timesMicroseconds.byteLength +
			this.requestRows.byteLength +
			this.loadRows.byteLength +
			this.resourceRows.byteLength
		);
	}

	append(event: DeterministicScenarioResourceEvent): void {
		this.assertEventValues(event);
		this.assertCanAppendRequest(event.requestRow);
		this.ensureCapacity(this.eventsWritten + 1);
		const eventIndex = this.eventsWritten;
		this.typeCodes[eventIndex] = DETERMINISTIC_SCENARIO_RESOURCE_EVENT_TYPE_CODE[event.type];
		this.timesMicroseconds[eventIndex] = event.timeMicroseconds;
		this.requestRows[eventIndex] = event.requestRow;
		this.loadRows[eventIndex] = event.loadRow;
		this.resourceRows[eventIndex] = event.resourceRow;
		this.requestEventCounts[event.requestRow] =
			(this.requestEventCounts[event.requestRow] as number) + 1;
		this.eventsWritten++;
	}

	eventAt(index: number): DeterministicScenarioResourceEvent {
		if (!Number.isSafeInteger(index) || index < 0 || index >= this.eventsWritten) {
			throw new RangeError(`Scenario resource event index ${index} is invalid.`);
		}
		const type = EVENT_TYPES[this.typeCodes[index] as number];
		if (!type) throw new Error(`Scenario resource event ${index} has an invalid type code.`);
		return Object.freeze({
			type,
			timeMicroseconds: this.timesMicroseconds[index] as number,
			requestRow: this.requestRows[index] as number,
			loadRow: this.loadRows[index] as number,
			resourceRow: this.resourceRows[index] as number,
		});
	}

	assertCanAppendRequest(requestRow: number): void {
		if (!Number.isSafeInteger(requestRow) || requestRow < 0 || requestRow >= this.requestCount) {
			throw new RangeError(`Scenario resource event request row ${requestRow} is invalid.`);
		}
		if (
			(this.requestEventCounts[requestRow] as number) >=
			DETERMINISTIC_SCENARIO_RESOURCE_EVENT_MAXIMUM_PER_REQUEST
		) {
			throw new RangeError(`Scenario request row ${requestRow} exceeds the resource event budget.`);
		}
		if (this.eventsWritten >= this.maximumEventCount) {
			throw new RangeError("Scenario resource event log exceeds its bounded capacity.");
		}
	}

	private assertEventValues(event: DeterministicScenarioResourceEvent): void {
		if (
			typeof event !== "object" ||
			event === null ||
			!Object.hasOwn(DETERMINISTIC_SCENARIO_RESOURCE_EVENT_TYPE_CODE, event.type)
		) {
			throw new Error("Scenario resource event type is invalid.");
		}
		if (
			!Number.isSafeInteger(event.timeMicroseconds) ||
			event.timeMicroseconds < 0 ||
			!isUint32(event.requestRow) ||
			event.requestRow >= this.requestCount ||
			!isUint32(event.loadRow) ||
			!isUint32(event.resourceRow)
		) {
			throw new Error("Scenario resource event values are invalid.");
		}
	}

	private ensureCapacity(required: number): void {
		if (required <= this.typeCodes.length) return;
		let capacity = Math.min(INITIAL_EVENT_CAPACITY, this.maximumEventCount);
		if (this.typeCodes.length > 0) capacity = this.typeCodes.length;
		while (capacity < required) {
			capacity = Math.min(this.maximumEventCount, Math.max(required, capacity * 2));
		}
		this.typeCodes = grow(this.typeCodes, capacity);
		this.timesMicroseconds = grow(this.timesMicroseconds, capacity);
		this.requestRows = grow(this.requestRows, capacity);
		this.loadRows = grow(this.loadRows, capacity);
		this.resourceRows = grow(this.resourceRows, capacity);
	}
}

function grow<T extends Uint8Array | Uint32Array | Float64Array>(value: T, length: number): T {
	const next = new (value.constructor as { new (length: number): T })(length);
	next.set(value);
	return next;
}

function isUint32(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
}
