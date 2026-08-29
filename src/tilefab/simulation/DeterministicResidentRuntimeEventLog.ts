export const DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE = Object.freeze({
	REQUEST_RELEASED: 1,
	CYCLE_ADMITTED: 2,
	LOAD_PICKED_UP: 3,
	LOAD_DROPPED_OFF: 4,
	VEHICLE_RETURNED_HOME: 5,
} as const);
export type DeterministicResidentCoreEventType =
	keyof typeof DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE;

export const DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE = Object.freeze({
	STORAGE_DESTINATION_RESERVED: 1,
	STORAGE_SOURCE_RELEASED: 2,
	STORAGE_DESTINATION_OCCUPIED: 3,
	EQ_SERVICE_QUEUED: 4,
	EQ_SERVICE_STARTED: 5,
	EQ_SERVICE_READY: 6,
	STORAGE_SERVICE_STARTED: 7,
	STORAGE_SERVICE_READY: 8,
} as const);
export type DeterministicResidentResourceEventType =
	keyof typeof DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE;

export interface DeterministicResidentCoreEvent {
	readonly sequence: number;
	readonly timeMicroseconds: number;
	readonly type: DeterministicResidentCoreEventType;
	readonly requestRow: number;
}

export interface DeterministicResidentResourceEvent {
	readonly sequence: number;
	readonly timeMicroseconds: number;
	readonly type: DeterministicResidentResourceEventType;
	readonly requestRow: number;
	readonly resourceRow: number;
}

const CORE_EVENTS_PER_REQUEST = 5;
const RESOURCE_EVENTS_PER_REQUEST = 6;

/** Fixed-capacity, run-local semantic logs. Public consumers receive bounded copied tails only. */
export class DeterministicResidentRuntimeEventLog {
	private readonly requestCount: number;
	private readonly coreTimesMicroseconds: Float64Array;
	private readonly coreTypeCodes: Uint8Array;
	private readonly coreRequestRows: Uint32Array;
	private readonly resourceTimesMicroseconds: Float64Array;
	private readonly resourceTypeCodes: Uint8Array;
	private readonly resourceRequestRows: Uint32Array;
	private readonly resourceRows: Uint32Array;
	private coreWritten = 0;
	private resourceWritten = 0;

	constructor(requestCount: number) {
		if (!Number.isSafeInteger(requestCount) || requestCount < 0) {
			throw new RangeError("Resident event log request count is invalid.");
		}
		this.requestCount = requestCount;
		this.coreTimesMicroseconds = new Float64Array(requestCount * CORE_EVENTS_PER_REQUEST);
		this.coreTypeCodes = new Uint8Array(requestCount * CORE_EVENTS_PER_REQUEST);
		this.coreRequestRows = new Uint32Array(requestCount * CORE_EVENTS_PER_REQUEST);
		this.resourceTimesMicroseconds = new Float64Array(requestCount * RESOURCE_EVENTS_PER_REQUEST);
		this.resourceTypeCodes = new Uint8Array(requestCount * RESOURCE_EVENTS_PER_REQUEST);
		this.resourceRequestRows = new Uint32Array(requestCount * RESOURCE_EVENTS_PER_REQUEST);
		this.resourceRows = new Uint32Array(requestCount * RESOURCE_EVENTS_PER_REQUEST);
	}

	get coreEventCount(): number {
		return this.coreWritten;
	}

	get resourceEventCount(): number {
		return this.resourceWritten;
	}

	get ownedViews(): readonly ArrayBufferView[] {
		return [
			this.coreTimesMicroseconds,
			this.coreTypeCodes,
			this.coreRequestRows,
			this.resourceTimesMicroseconds,
			this.resourceTypeCodes,
			this.resourceRequestRows,
			this.resourceRows,
		];
	}

	appendCore(
		type: DeterministicResidentCoreEventType,
		requestRow: number,
		timeMicroseconds: number,
	): void {
		this.assertRequestAndTime(requestRow, timeMicroseconds);
		if (this.coreWritten >= this.coreTimesMicroseconds.length) {
			throw new Error("Resident core event log exceeded its fixed capacity.");
		}
		this.assertMonotonic(this.coreTimesMicroseconds, this.coreWritten, timeMicroseconds, "core");
		this.coreTimesMicroseconds[this.coreWritten] = timeMicroseconds;
		this.coreTypeCodes[this.coreWritten] = DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE[type];
		this.coreRequestRows[this.coreWritten] = requestRow;
		this.coreWritten++;
	}

	appendResource(
		type: DeterministicResidentResourceEventType,
		requestRow: number,
		resourceRow: number,
		timeMicroseconds: number,
	): void {
		this.assertRequestAndTime(requestRow, timeMicroseconds);
		if (!Number.isSafeInteger(resourceRow) || resourceRow < 0 || resourceRow > 0xffff_ffff) {
			throw new RangeError("Resident resource event row is invalid.");
		}
		if (this.resourceWritten >= this.resourceTimesMicroseconds.length) {
			throw new Error("Resident resource event log exceeded its fixed capacity.");
		}
		this.assertMonotonic(
			this.resourceTimesMicroseconds,
			this.resourceWritten,
			timeMicroseconds,
			"resource",
		);
		this.resourceTimesMicroseconds[this.resourceWritten] = timeMicroseconds;
		this.resourceTypeCodes[this.resourceWritten] = DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE[type];
		this.resourceRequestRows[this.resourceWritten] = requestRow;
		this.resourceRows[this.resourceWritten] = resourceRow;
		this.resourceWritten++;
	}

	coreEventAt(index: number): DeterministicResidentCoreEvent {
		assertEventIndex(index, this.coreWritten, "core");
		return Object.freeze({
			sequence: index + 1,
			timeMicroseconds: this.coreTimesMicroseconds[index] as number,
			type: eventTypeName(
				DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE,
				this.coreTypeCodes[index] as number,
				"core",
			),
			requestRow: this.coreRequestRows[index] as number,
		});
	}

	resourceEventAt(index: number): DeterministicResidentResourceEvent {
		assertEventIndex(index, this.resourceWritten, "resource");
		return Object.freeze({
			sequence: index + 1,
			timeMicroseconds: this.resourceTimesMicroseconds[index] as number,
			type: eventTypeName(
				DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE,
				this.resourceTypeCodes[index] as number,
				"resource",
			),
			requestRow: this.resourceRequestRows[index] as number,
			resourceRow: this.resourceRows[index] as number,
		});
	}

	private assertRequestAndTime(requestRow: number, timeMicroseconds: number): void {
		if (!Number.isInteger(requestRow) || requestRow < 0 || requestRow >= this.requestCount) {
			throw new RangeError("Resident event request row is invalid.");
		}
		if (!Number.isSafeInteger(timeMicroseconds) || timeMicroseconds < 0) {
			throw new RangeError("Resident event time is invalid.");
		}
	}

	private assertMonotonic(
		times: Float64Array,
		count: number,
		timeMicroseconds: number,
		label: string,
	): void {
		if (count > 0 && (times[count - 1] as number) > timeMicroseconds) {
			throw new Error(`Resident ${label} event time moved backwards.`);
		}
	}
}

function assertEventIndex(index: number, count: number, label: string): void {
	if (!Number.isInteger(index) || index < 0 || index >= count) {
		throw new RangeError(`Resident ${label} event index ${index} is outside ${count} events.`);
	}
}

function eventTypeName<T extends Record<string, number>>(
	types: T,
	code: number,
	label: string,
): keyof T {
	for (const [name, value] of Object.entries(types)) {
		if (value === code) return name;
	}
	throw new Error(`Unknown resident ${label} event code ${code}.`);
}
