import {
	DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE,
	DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE,
	type DeterministicResidentCoreEventType,
	type DeterministicResidentResourceEventType,
} from "../simulation/DeterministicResidentRuntimeEventLog";
import {
	DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT,
	DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE,
	DETERMINISTIC_RESIDENT_RUNTIME_MAXIMUM_POSE_COUNT,
	DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE,
	type DeterministicResidentRuntimePublication,
} from "../simulation/DeterministicResidentRuntimePublisher";

export const SIMULATION_RESIDENT_RUNTIME_OUTCOME_PRESENTATION_POLICY =
	"FIXED_CODE_BOUNDED_RESIDENT_OUTCOMES_V1" as const;

export interface SimulationResidentRuntimeCoreEventPresentation {
	readonly sequence: number;
	readonly timeMicroseconds: number;
	readonly type: DeterministicResidentCoreEventType;
	readonly requestRow: number;
}

export interface SimulationResidentRuntimeResourceEventPresentation {
	readonly sequence: number;
	readonly timeMicroseconds: number;
	readonly type: DeterministicResidentResourceEventType;
	readonly requestRow: number;
	readonly resourceRow: number;
}

export interface SimulationResidentRuntimeOutcomePresentation {
	readonly policy: typeof SIMULATION_RESIDENT_RUNTIME_OUTCOME_PRESENTATION_POLICY;
	readonly publicationSequence: number;
	readonly sampledSimulationTimeMicroseconds: number;
	readonly terminal: boolean;
	readonly requests: Readonly<{
		total: number;
		waitingRelease: number;
		waitingPredecessor: number;
		waitingCycleLease: number;
		toPickup: number;
		toDropoff: number;
		returningHome: number;
		completed: number;
	}>;
	readonly service: Readonly<{
		notArrived: number;
		queued: number;
		active: number;
		ready: number;
	}>;
	readonly vehicles: Readonly<{
		total: number;
		idleAtHome: number;
		waitingCycle: number;
		moving: number;
	}>;
	readonly loadCount: number;
	readonly resources: Readonly<{
		nonHomeTrackOwned: number;
		switchConflictOwned: number;
		storageOccupied: number;
		storageReserved: number;
	}>;
	readonly poses: Readonly<{
		eligible: number;
		published: number;
		truncated: boolean;
	}>;
	readonly coreEvents: Readonly<{
		total: number;
		truncated: boolean;
		rows: readonly SimulationResidentRuntimeCoreEventPresentation[];
	}>;
	readonly resourceEvents: Readonly<{
		total: number;
		truncated: boolean;
		rows: readonly SimulationResidentRuntimeResourceEventPresentation[];
	}>;
}

const KPI_CODES = Uint8Array.from(Object.values(DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE));
const CORE_EVENT_TYPES = eventTypeNames(DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE);
const RESOURCE_EVENT_TYPES = eventTypeNames(DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE);

/** Projects fixed resident aggregates and copied eight-row event tails without retaining columns. */
export function simulationResidentRuntimeOutcomePresentation(
	publication: DeterministicResidentRuntimePublication,
): SimulationResidentRuntimeOutcomePresentation | null {
	if (
		(publication.triggerCode !== DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE &&
			publication.triggerCode !==
				DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL) ||
		!isPositiveSafeInteger(publication.sequence) ||
		!isNonNegativeSafeInteger(publication.sampledSimulationTimeMicroseconds) ||
		!(publication.kpiCodes instanceof Uint8Array) ||
		publication.kpiCodes.length !== KPI_CODES.length ||
		!(publication.kpiValues instanceof Float64Array) ||
		publication.kpiValues.length !== KPI_CODES.length ||
		!publication.kpiCodes.every((code, row) => code === KPI_CODES[row]) ||
		!publication.kpiValues.every(isNonNegativeSafeInteger) ||
		!isPositiveSafeInteger(publication.maximumPoseCount) ||
		publication.maximumPoseCount > DETERMINISTIC_RESIDENT_RUNTIME_MAXIMUM_POSE_COUNT ||
		!isNonNegativeSafeInteger(publication.eligiblePoseCount) ||
		!isNonNegativeSafeInteger(publication.publishedPoseCount) ||
		publication.publishedPoseCount !==
			Math.min(publication.eligiblePoseCount, publication.maximumPoseCount) ||
		publication.posesTruncated !== publication.eligiblePoseCount > publication.publishedPoseCount
	) {
		return null;
	}
	const values = publication.kpiValues;
	const requests = Object.freeze({
		total: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_TOTAL),
		waitingRelease: valueAt(
			values,
			DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_WAITING_RELEASE,
		),
		waitingPredecessor: valueAt(
			values,
			DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_WAITING_PREDECESSOR,
		),
		waitingCycleLease: valueAt(
			values,
			DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_WAITING_CYCLE_LEASE,
		),
		toPickup: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_TO_PICKUP),
		toDropoff: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_TO_DROPOFF),
		returningHome: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_RETURNING_HOME),
		completed: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_COMPLETED),
	});
	const service = Object.freeze({
		notArrived: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.SERVICE_NOT_ARRIVED),
		queued: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.SERVICE_QUEUED),
		active: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.SERVICE_ACTIVE),
		ready: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.SERVICE_READY),
	});
	const vehicles = Object.freeze({
		total: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.VEHICLE_TOTAL),
		idleAtHome: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.VEHICLE_IDLE_AT_HOME),
		waitingCycle: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.VEHICLE_WAITING_CYCLE),
		moving: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.VEHICLE_MOVING),
	});
	const resources = Object.freeze({
		nonHomeTrackOwned: valueAt(
			values,
			DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.NON_HOME_TRACK_OWNED,
		),
		switchConflictOwned: valueAt(
			values,
			DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.SWITCH_CONFLICT_OWNED,
		),
		storageOccupied: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.STORAGE_OCCUPIED),
		storageReserved: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.STORAGE_RESERVED),
	});
	const coreEvents = residentCoreEvents(publication, requests.total);
	const resourceEvents = residentResourceEvents(publication, requests.total);
	if (
		requests.waitingRelease +
			requests.waitingPredecessor +
			requests.waitingCycleLease +
			requests.toPickup +
			requests.toDropoff +
			requests.returningHome +
			requests.completed !==
			requests.total ||
		sumNumbers(service) !== requests.total ||
		vehicles.idleAtHome + vehicles.waitingCycle + vehicles.moving !== vehicles.total ||
		publication.eligiblePoseCount !== vehicles.total ||
		publication.coreEventCount !==
			valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.CORE_EVENT_COUNT) ||
		publication.resourceEventCount !==
			valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.RESOURCE_EVENT_COUNT) ||
		publication.coreEventCount > requests.total * 5 ||
		publication.resourceEventCount > requests.total * 6 ||
		!coreEvents ||
		!resourceEvents
	) {
		return null;
	}
	const terminal =
		publication.triggerCode === DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL;
	if (
		terminal &&
		(requests.completed !== requests.total ||
			service.ready !== requests.total ||
			vehicles.idleAtHome !== vehicles.total ||
			vehicles.moving !== 0 ||
			resources.nonHomeTrackOwned !== 0 ||
			resources.switchConflictOwned !== 0 ||
			resources.storageReserved !== 0)
	) {
		return null;
	}
	return Object.freeze({
		policy: SIMULATION_RESIDENT_RUNTIME_OUTCOME_PRESENTATION_POLICY,
		publicationSequence: publication.sequence,
		sampledSimulationTimeMicroseconds: publication.sampledSimulationTimeMicroseconds,
		terminal,
		requests,
		service,
		vehicles,
		loadCount: valueAt(values, DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.LOAD_TOTAL),
		resources,
		poses: Object.freeze({
			eligible: publication.eligiblePoseCount,
			published: publication.publishedPoseCount,
			truncated: publication.posesTruncated,
		}),
		coreEvents,
		resourceEvents,
	});
}

function residentCoreEvents(
	publication: DeterministicResidentRuntimePublication,
	requestCount: number,
): SimulationResidentRuntimeOutcomePresentation["coreEvents"] | null {
	if (
		!validEventTailHeader(
			publication.coreEventCount,
			publication.publishedCoreEventCount,
			publication.coreEventsTruncated,
		) ||
		!validEventColumns(
			publication.publishedCoreEventCount,
			publication.coreEventSequences,
			publication.coreEventTimesMicroseconds,
			publication.coreEventTypeCodes,
			publication.coreEventRequestRows,
			publication.sampledSimulationTimeMicroseconds,
			publication.coreEventCount,
			requestCount,
			CORE_EVENT_TYPES.length,
		)
	) {
		return null;
	}
	const rows = Array.from({ length: publication.publishedCoreEventCount }, (_, row) =>
		Object.freeze({
			sequence: publication.coreEventSequences[row] as number,
			timeMicroseconds: publication.coreEventTimesMicroseconds[row] as number,
			type: CORE_EVENT_TYPES[
				(publication.coreEventTypeCodes[row] as number) - 1
			] as DeterministicResidentCoreEventType,
			requestRow: publication.coreEventRequestRows[row] as number,
		}),
	);
	return Object.freeze({
		total: publication.coreEventCount,
		truncated: publication.coreEventsTruncated,
		rows: Object.freeze(rows),
	});
}

function residentResourceEvents(
	publication: DeterministicResidentRuntimePublication,
	requestCount: number,
): SimulationResidentRuntimeOutcomePresentation["resourceEvents"] | null {
	if (
		!validEventTailHeader(
			publication.resourceEventCount,
			publication.publishedResourceEventCount,
			publication.resourceEventsTruncated,
		) ||
		!validEventColumns(
			publication.publishedResourceEventCount,
			publication.resourceEventSequences,
			publication.resourceEventTimesMicroseconds,
			publication.resourceEventTypeCodes,
			publication.resourceEventRequestRows,
			publication.sampledSimulationTimeMicroseconds,
			publication.resourceEventCount,
			requestCount,
			RESOURCE_EVENT_TYPES.length,
		) ||
		!(publication.resourceEventResourceRows instanceof Uint32Array) ||
		publication.resourceEventResourceRows.length !== publication.publishedResourceEventCount
	) {
		return null;
	}
	const rows = Array.from({ length: publication.publishedResourceEventCount }, (_, row) =>
		Object.freeze({
			sequence: publication.resourceEventSequences[row] as number,
			timeMicroseconds: publication.resourceEventTimesMicroseconds[row] as number,
			type: RESOURCE_EVENT_TYPES[
				(publication.resourceEventTypeCodes[row] as number) - 1
			] as DeterministicResidentResourceEventType,
			requestRow: publication.resourceEventRequestRows[row] as number,
			resourceRow: publication.resourceEventResourceRows[row] as number,
		}),
	);
	return Object.freeze({
		total: publication.resourceEventCount,
		truncated: publication.resourceEventsTruncated,
		rows: Object.freeze(rows),
	});
}

function validEventTailHeader(total: number, published: number, truncated: boolean): boolean {
	return (
		isNonNegativeSafeInteger(total) &&
		isNonNegativeSafeInteger(published) &&
		published === Math.min(total, DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT) &&
		truncated === total > published
	);
}

function validEventColumns(
	count: number,
	sequences: Uint32Array,
	times: Float64Array,
	typeCodes: Uint8Array,
	requestRows: Uint32Array,
	sampledTime: number,
	total: number,
	requestCount: number,
	typeCount: number,
): boolean {
	if (
		!(sequences instanceof Uint32Array) ||
		!(times instanceof Float64Array) ||
		!(typeCodes instanceof Uint8Array) ||
		!(requestRows instanceof Uint32Array) ||
		[sequences, times, typeCodes, requestRows].some((column) => column.length !== count)
	) {
		return false;
	}
	for (let row = 0; row < count; row++) {
		if (
			(row === 0 && sequences[row] !== total - count + 1) ||
			(row > 0 && (sequences[row] as number) !== (sequences[row - 1] as number) + 1) ||
			!isNonNegativeSafeInteger(times[row] as number) ||
			(times[row] as number) > sampledTime ||
			(row > 0 && (times[row] as number) < (times[row - 1] as number)) ||
			(typeCodes[row] as number) < 1 ||
			(typeCodes[row] as number) > typeCount ||
			(requestRows[row] as number) >= requestCount
		) {
			return false;
		}
	}
	return count === 0 || sequences[count - 1] === total;
}

function eventTypeNames<T extends Record<string, number>>(types: T): readonly (keyof T)[] {
	return Object.freeze(
		Object.entries(types)
			.sort((left, right) => left[1] - right[1])
			.map(([name]) => name as keyof T),
	);
}

function valueAt(values: Float64Array, code: number): number {
	return values[code - 1] as number;
}

function sumNumbers(values: Readonly<Record<string, number>>): number {
	return Object.values(values).reduce((sum, value) => sum + value, 0);
}

function isPositiveSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}
