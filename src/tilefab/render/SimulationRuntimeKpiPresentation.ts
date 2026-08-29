import {
	DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE,
	DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_POSE_COUNT,
	DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE,
	type DeterministicScenarioRuntimePublication,
} from "../simulation/DeterministicScenarioRuntimePublisher";

export const SIMULATION_RUNTIME_KPI_PRESENTATION_POLICY =
	"FIXED_CODE_BOUNDED_AGGREGATES_V1" as const;

export interface SimulationRuntimeKpiPresentation {
	readonly policy: typeof SIMULATION_RUNTIME_KPI_PRESENTATION_POLICY;
	readonly publicationSequence: number;
	readonly sampledSimulationTimeMicroseconds: number;
	readonly terminal: boolean;
	readonly requests: Readonly<{
		total: number;
		waitingRelease: number;
		waitingDependency: number;
		waitingLease: number;
		admitted: number;
		inTransit: number;
		completed: number;
		queued: number;
	}>;
	readonly destinationService: Readonly<{
		notStarted: number;
		inService: number;
		ready: number;
	}>;
	readonly events: Readonly<{
		core: number;
		resource: number;
	}>;
	readonly eq: Readonly<{
		destinationRequests: number;
		notArrived: number;
		queued: number;
		active: number;
		ready: number;
	}>;
	readonly storage: Readonly<{
		resourceCount: number;
		occupiedUnits: number;
		reservedUnits: number;
	}>;
	readonly poses: Readonly<{
		eligible: number;
		published: number;
		truncated: boolean;
	}>;
}

const KPI_CODES = Uint8Array.from(Object.values(DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE));

/**
 * Projects the publisher's fixed aggregate row into named read-only facts. This intentionally does
 * not scan pose columns or re-check the publication checksum on the render path.
 */
export function simulationRuntimeKpiPresentation(
	publication: DeterministicScenarioRuntimePublication,
): SimulationRuntimeKpiPresentation | null {
	if (
		!publication.resourceExecutionPrepared ||
		(publication.triggerCode !== DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE &&
			publication.triggerCode !==
				DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL) ||
		publication.kpiCount !== KPI_CODES.length ||
		!(publication.kpiCodes instanceof Uint8Array) ||
		publication.kpiCodes.length !== KPI_CODES.length ||
		!(publication.kpiValues instanceof Float64Array) ||
		publication.kpiValues.length !== KPI_CODES.length ||
		!publication.kpiCodes.every((code, row) => code === KPI_CODES[row]) ||
		!publication.kpiValues.every(isNonNegativeSafeInteger) ||
		!Number.isSafeInteger(publication.sequence) ||
		publication.sequence <= 0 ||
		!Number.isSafeInteger(publication.sampledSimulationTimeMicroseconds) ||
		publication.sampledSimulationTimeMicroseconds < 0 ||
		!Number.isSafeInteger(publication.eligiblePoseCount) ||
		publication.eligiblePoseCount < 0 ||
		!Number.isSafeInteger(publication.maximumPoseCount) ||
		publication.maximumPoseCount <= 0 ||
		publication.maximumPoseCount > DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_POSE_COUNT ||
		!Number.isSafeInteger(publication.publishedPoseCount) ||
		publication.publishedPoseCount < 0 ||
		publication.publishedPoseCount > publication.eligiblePoseCount ||
		publication.publishedPoseCount > publication.maximumPoseCount ||
		publication.posesTruncated !== publication.eligiblePoseCount > publication.publishedPoseCount
	) {
		return null;
	}

	const values = publication.kpiValues;
	const requests = Object.freeze({
		total: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_TOTAL),
		waitingRelease: valueAt(
			values,
			DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_WAITING_RELEASE,
		),
		waitingDependency: valueAt(
			values,
			DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_WAITING_DEPENDENCY,
		),
		waitingLease: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_WAITING_LEASE),
		admitted: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_ADMITTED),
		inTransit: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_IN_TRANSIT),
		completed: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.REQUEST_COMPLETED),
		queued: 0,
	});
	const requestQueued = requests.waitingDependency + requests.waitingLease + requests.admitted;
	const namedRequests = Object.freeze({ ...requests, queued: requestQueued });
	const destinationService = Object.freeze({
		notStarted: valueAt(
			values,
			DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.DESTINATION_SERVICE_NOT_STARTED,
		),
		inService: valueAt(
			values,
			DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.DESTINATION_SERVICE_IN_SERVICE,
		),
		ready: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.DESTINATION_SERVICE_READY),
	});
	const events = Object.freeze({
		core: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.CORE_EVENT_COUNT),
		resource: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.RESOURCE_EVENT_COUNT),
	});
	const eq = Object.freeze({
		destinationRequests: valueAt(
			values,
			DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.EQ_DESTINATION_REQUEST_COUNT,
		),
		notArrived: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.EQ_NOT_ARRIVED),
		queued: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.EQ_QUEUED),
		active: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.EQ_ACTIVE),
		ready: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.EQ_READY),
	});
	const storage = Object.freeze({
		resourceCount: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.STORAGE_RESOURCE_COUNT),
		occupiedUnits: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.STORAGE_OCCUPIED_UNITS),
		reservedUnits: valueAt(values, DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE.STORAGE_RESERVED_UNITS),
	});
	if (
		sumRequestPhases(namedRequests) !== namedRequests.total ||
		destinationService.notStarted + destinationService.inService + destinationService.ready !==
			namedRequests.total ||
		eq.notArrived + eq.queued + eq.active + eq.ready !== eq.destinationRequests ||
		publication.eligiblePoseCount !== namedRequests.inTransit
	) {
		return null;
	}
	const terminal =
		publication.triggerCode === DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL;
	if (
		terminal &&
		(namedRequests.completed !== namedRequests.total ||
			destinationService.ready !== namedRequests.total ||
			namedRequests.inTransit !== 0)
	) {
		return null;
	}
	return Object.freeze({
		policy: SIMULATION_RUNTIME_KPI_PRESENTATION_POLICY,
		publicationSequence: publication.sequence,
		sampledSimulationTimeMicroseconds: publication.sampledSimulationTimeMicroseconds,
		terminal,
		requests: namedRequests,
		destinationService,
		events,
		eq,
		storage,
		poses: Object.freeze({
			eligible: publication.eligiblePoseCount,
			published: publication.publishedPoseCount,
			truncated: publication.posesTruncated,
		}),
	});
}

function valueAt(values: Float64Array, code: number): number {
	return values[code - 1] as number;
}

function sumRequestPhases(requests: SimulationRuntimeKpiPresentation["requests"]): number {
	return (
		requests.waitingRelease +
		requests.waitingDependency +
		requests.waitingLease +
		requests.admitted +
		requests.inTransit +
		requests.completed
	);
}

function isNonNegativeSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}
