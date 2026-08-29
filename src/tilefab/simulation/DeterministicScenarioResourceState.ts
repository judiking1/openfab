import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "../compile/SimulationReadinessCertificate";
import {
	type SimulationScenarioAdmissionProgram,
	simulationScenarioAdmissionProgramError,
} from "../compile/SimulationScenarioAdmissionProgram";
import {
	SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE,
	type SimulationScenarioResourceRunConfiguration,
	simulationScenarioResourceRunConfigurationError,
} from "../compile/SimulationScenarioResourceRunConfiguration";
import {
	type SimulationScenarioRouteRequests,
	simulationScenarioRouteRequestsError,
} from "../compile/SimulationScenarioRouteRequests";
import {
	SIMULATION_SCENARIO_SERVICE_KIND_CODE,
	type SimulationScenarioServiceTiming,
	simulationScenarioServiceTimingError,
} from "../compile/SimulationScenarioServiceTiming";
import {
	type DeterministicScenarioPreparedSources,
	deterministicScenarioPreparedSourcesMatch,
} from "./DeterministicScenarioPreparedSources";
import {
	type DeterministicScenarioResourceEvent,
	DeterministicScenarioResourceEventLog,
} from "./DeterministicScenarioResourceEventLog";

export type { DeterministicScenarioResourceEvent } from "./DeterministicScenarioResourceEventLog";

export const DETERMINISTIC_SCENARIO_RESOURCE_EVENT_TIE_POLICY =
	"EQ_READY_THEN_GROUP_ROW_THEN_REQUEST_ROW_V1" as const;
export const DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE = Object.freeze({
	NOT_ARRIVED: 0,
	QUEUED: 1,
	ACTIVE: 2,
	READY: 3,
} as const);

export interface DeterministicScenarioEqServiceState {
	readonly requestRow: number;
	readonly phaseCode: number;
	readonly queuedAtMicroseconds: number | null;
	readonly startedAtMicroseconds: number | null;
	readonly readyAtMicroseconds: number | null;
}

export interface DeterministicScenarioStorageState {
	readonly resourceRow: number;
	readonly equipmentGroupId: number;
	readonly occupiedUnits: number;
	readonly reservedUnits: number;
	readonly capacityUnits: number;
	readonly highWaterMarkUnits: number;
}

export interface DeterministicScenarioResourceSummary {
	readonly eqDestinationRequestCount: number;
	readonly eqNotArrivedCount: number;
	readonly eqQueuedCount: number;
	readonly eqActiveCount: number;
	readonly eqReadyCount: number;
	readonly storageResourceCount: number;
	readonly storageOccupiedUnits: number;
	readonly storageReservedUnits: number;
}

interface EqWaitQueues {
	readonly offsets: Uint32Array;
	readonly requestRows: Uint32Array;
	readonly sizes: Uint32Array;
}

interface EqCompletion {
	readonly requestRow: number;
	readonly resourceRow: number;
	readonly readyAtMicroseconds: number;
}

const EMPTY_REQUEST_ROWS: readonly number[] = Object.freeze([]);

/**
 * Mutable run-local EQ/storage state. It owns no geometry and accepts only the exact prepared
 * resource contract. It is also the admission core's storage/resource gate.
 */
export class DeterministicScenarioResourceState {
	readonly eventTiePolicy = DETERMINISTIC_SCENARIO_RESOURCE_EVENT_TIE_POLICY;
	private readonly snapshot: PublishedSimulationReadinessSnapshot;
	private readonly routes: SimulationScenarioRouteRequests;
	private readonly admissionProgram: SimulationScenarioAdmissionProgram;
	private readonly serviceTiming: SimulationScenarioServiceTiming;
	private readonly configuration: SimulationScenarioResourceRunConfiguration;
	private readonly destinationStorageResourceRows: Int32Array;
	private readonly destinationEqResourceRows: Int32Array;
	private readonly storageDestinationRequestOffsets: Uint32Array;
	private readonly storageDestinationRequestRows: Uint32Array;
	private readonly storageDestinationWaiterSizes: Uint32Array;
	private readonly requestStorageDestinationWaitListed: Uint8Array;
	private readonly loadStorageResourceRows: Int32Array;
	private readonly requestStorageReservationRows: Int32Array;
	private readonly requestStorageReservationUsesSourceUnit: Uint8Array;
	private readonly storageOccupiedUnits: Uint32Array;
	private readonly storageReservedUnits: Uint32Array;
	private readonly eqActiveCounts: Uint32Array;
	private readonly eqServicePhaseCodes: Uint8Array;
	private readonly eqServicePhaseCounts = new Uint32Array(4);
	private readonly eqQueuedTimesMicroseconds: Float64Array;
	private readonly eqStartedTimesMicroseconds: Float64Array;
	private readonly eqReadyTimesMicroseconds: Float64Array;
	private readonly eqQueues: EqWaitQueues;
	private readonly eqCompletionHeap: EqCompletionHeap;
	private readonly events: DeterministicScenarioResourceEventLog;
	private timeMicroseconds = 0;
	private storageOccupiedUnitCount = 0;
	private storageReservedUnitCount = 0;
	private eqDestinationRequestCount = 0;

	constructor(
		snapshot: PublishedSimulationReadinessSnapshot,
		routes: SimulationScenarioRouteRequests,
		admissionProgram: SimulationScenarioAdmissionProgram,
		serviceTiming: SimulationScenarioServiceTiming,
		configuration: SimulationScenarioResourceRunConfiguration,
		preparedSources?: DeterministicScenarioPreparedSources,
	) {
		if (
			!preparedSources ||
			!deterministicScenarioPreparedSourcesMatch(preparedSources, {
				snapshot,
				routes,
				admissionProgram,
				serviceTiming,
				resourceRunConfiguration: configuration,
			})
		) {
			assertCompatibleSources(snapshot, routes, admissionProgram, serviceTiming, configuration);
		}
		this.snapshot = snapshot;
		this.routes = routes;
		this.admissionProgram = admissionProgram;
		this.serviceTiming = serviceTiming;
		this.configuration = configuration;
		this.events = new DeterministicScenarioResourceEventLog(routes.requestCount);
		this.destinationStorageResourceRows = compileDestinationResourceRows(
			serviceTiming,
			configuration.storageEquipmentGroupIds,
			false,
		);
		this.destinationEqResourceRows = compileDestinationResourceRows(
			serviceTiming,
			configuration.eqEquipmentGroupIds,
			true,
		);
		const storageDestinations = compileStorageDestinationRequests(
			this.destinationStorageResourceRows,
			configuration.storageResourceCount,
		);
		this.storageDestinationRequestOffsets = storageDestinations.offsets;
		this.storageDestinationRequestRows = storageDestinations.requestRows;
		this.storageDestinationWaiterSizes = new Uint32Array(configuration.storageResourceCount);
		this.requestStorageDestinationWaitListed = new Uint8Array(routes.requestCount);
		this.loadStorageResourceRows = configuration.initialLoadStorageResourceRows.slice();
		this.requestStorageReservationRows = new Int32Array(routes.requestCount).fill(-1);
		this.requestStorageReservationUsesSourceUnit = new Uint8Array(routes.requestCount);
		this.storageOccupiedUnits = configuration.storageInitialOccupiedUnits.slice();
		this.storageReservedUnits = new Uint32Array(configuration.storageResourceCount);
		this.eqActiveCounts = new Uint32Array(configuration.eqResourceCount);
		this.eqServicePhaseCodes = new Uint8Array(routes.requestCount);
		for (const resourceRow of this.destinationEqResourceRows) {
			if (resourceRow >= 0) this.eqDestinationRequestCount++;
		}
		this.eqQueues = compileEqWaitQueues(
			this.destinationEqResourceRows,
			configuration.eqResourceCount,
		);
		this.eqCompletionHeap = new EqCompletionHeap(
			eqCompletionCapacity(configuration, this.eqDestinationRequestCount),
		);
		this.eqServicePhaseCounts[DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.NOT_ARRIVED] =
			this.eqDestinationRequestCount;
		this.eqQueuedTimesMicroseconds = filledFloat64(routes.requestCount, -1);
		this.eqStartedTimesMicroseconds = filledFloat64(routes.requestCount, -1);
		this.eqReadyTimesMicroseconds = filledFloat64(routes.requestCount, -1);
		for (const occupied of this.storageOccupiedUnits) {
			this.storageOccupiedUnitCount += occupied;
		}
		if (!Number.isSafeInteger(this.storageOccupiedUnitCount)) {
			throw new RangeError("Scenario storage occupied-unit total is unsafe.");
		}
	}

	get currentTimeMicroseconds(): number {
		return this.timeMicroseconds;
	}

	get eventCount(): number {
		return this.events.eventCount;
	}

	get eqWaitQueueRetainedByteCapacity(): number {
		return (
			this.eqQueues.offsets.byteLength +
			this.eqQueues.requestRows.byteLength +
			this.eqQueues.sizes.byteLength
		);
	}

	get eqCompletionHeapRetainedByteCapacity(): number {
		return this.eqCompletionHeap.retainedByteCapacity;
	}

	get nextScheduledTransitionTimeMicroseconds(): number {
		return Math.min(this.eqCompletionHeap.peekReadyAtMicroseconds, this.nextEqServiceStartTime());
	}

	get allResourceWorkCompleted(): boolean {
		return (
			this.eqServicePhaseCounts[DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.READY] ===
				this.eqDestinationRequestCount && this.storageReservedUnitCount === 0
		);
	}

	resourceSummary(): Readonly<DeterministicScenarioResourceSummary> {
		return Object.freeze({
			eqDestinationRequestCount: this.eqDestinationRequestCount,
			eqNotArrivedCount: this.eqServicePhaseCounts[
				DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.NOT_ARRIVED
			] as number,
			eqQueuedCount: this.eqServicePhaseCounts[
				DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.QUEUED
			] as number,
			eqActiveCount: this.eqServicePhaseCounts[
				DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.ACTIVE
			] as number,
			eqReadyCount: this.eqServicePhaseCounts[
				DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.READY
			] as number,
			storageResourceCount: this.configuration.storageResourceCount,
			storageOccupiedUnits: this.storageOccupiedUnitCount,
			storageReservedUnits: this.storageReservedUnitCount,
		});
	}

	eventAt(index: number): DeterministicScenarioResourceEvent {
		return this.events.eventAt(index);
	}

	storageState(resourceRow: number): Readonly<DeterministicScenarioStorageState> {
		assertResourceRow(resourceRow, this.configuration.storageResourceCount, "storage");
		return Object.freeze({
			resourceRow,
			equipmentGroupId: this.configuration.storageEquipmentGroupIds[resourceRow] as number,
			occupiedUnits: this.storageOccupiedUnits[resourceRow] as number,
			reservedUnits: this.storageReservedUnits[resourceRow] as number,
			capacityUnits: this.configuration.storageCapacityUnits[resourceRow] as number,
			highWaterMarkUnits: this.configuration.storageHighWaterMarkUnits[resourceRow] as number,
		});
	}

	loadStorageResourceRow(loadRow: number): number | null {
		assertResourceRow(loadRow, this.admissionProgram.loadCount, "load");
		const resourceRow = this.loadStorageResourceRows[loadRow] as number;
		return resourceRow < 0 ? null : resourceRow;
	}

	destinationStorageReservationRow(requestRow: number): number | null {
		assertRequestRow(requestRow, this.routes.requestCount);
		const resourceRow = this.requestStorageReservationRows[requestRow] as number;
		return resourceRow < 0 ? null : resourceRow;
	}

	canReserveDestinationForAdmission(requestRow: number): boolean {
		assertRequestRow(requestRow, this.routes.requestCount);
		const resourceRow = this.destinationStorageResourceRows[requestRow] as number;
		if (resourceRow < 0) return true;
		if (this.requestStorageReservationRows[requestRow] === resourceRow) return true;
		if (this.requestStorageReservationRows[requestRow] >= 0) return false;
		const loadRow = this.admissionProgram.requestLoadRows[requestRow] as number;
		const reusesSourceUnit = this.loadStorageResourceRows[loadRow] === resourceRow;
		const projected =
			(this.storageOccupiedUnits[resourceRow] as number) +
			(this.storageReservedUnits[resourceRow] as number) +
			(reusesSourceUnit ? 0 : 1);
		return (
			projected <= (this.configuration.storageCapacityUnits[resourceRow] as number) &&
			projected <= (this.configuration.storageHighWaterMarkUnits[resourceRow] as number)
		);
	}

	destinationReservationBlocked(requestRow: number): void {
		assertRequestRow(requestRow, this.routes.requestCount);
		const resourceRow = this.destinationStorageResourceRows[requestRow] as number;
		if (
			resourceRow < 0 ||
			this.requestStorageReservationRows[requestRow] >= 0 ||
			this.requestStorageDestinationWaitListed[requestRow] === 1
		) {
			return;
		}
		pushStorageDestinationWaiter(
			this.storageDestinationRequestOffsets,
			this.storageDestinationRequestRows,
			this.storageDestinationWaiterSizes,
			resourceRow,
			requestRow,
		);
		this.requestStorageDestinationWaitListed[requestRow] = 1;
	}

	reserveDestinationForAdmission(requestRow: number, timeMicroseconds: number): boolean {
		assertRequestRow(requestRow, this.routes.requestCount);
		this.advanceBeforeMutation(timeMicroseconds);
		const resourceRow = this.destinationStorageResourceRows[requestRow] as number;
		if (resourceRow < 0) return true;
		if (this.requestStorageReservationRows[requestRow] === resourceRow) return true;
		if (!this.canReserveDestinationForAdmission(requestRow)) {
			this.destinationReservationBlocked(requestRow);
			return false;
		}
		this.requestStorageDestinationWaitListed[requestRow] = 0;
		this.events.assertCanAppendRequest(requestRow);
		this.requestStorageReservationRows[requestRow] = resourceRow;
		const loadRow = this.admissionProgram.requestLoadRows[requestRow] as number;
		if (this.loadStorageResourceRows[loadRow] === resourceRow) {
			this.requestStorageReservationUsesSourceUnit[requestRow] = 1;
		} else {
			this.storageReservedUnits[resourceRow] =
				(this.storageReservedUnits[resourceRow] as number) + 1;
			this.storageReservedUnitCount++;
		}
		this.appendEvent("STORAGE_DESTINATION_RESERVED", requestRow, resourceRow, timeMicroseconds);
		return true;
	}

	cancelDestinationReservation(requestRow: number, timeMicroseconds: number): void {
		assertRequestRow(requestRow, this.routes.requestCount);
		this.advanceBeforeMutation(timeMicroseconds);
		const resourceRow = this.requestStorageReservationRows[requestRow] as number;
		if (resourceRow < 0) return;
		this.events.assertCanAppendRequest(requestRow);
		if (this.requestStorageReservationUsesSourceUnit[requestRow] === 0) {
			this.decrementReserved(resourceRow);
		}
		this.requestStorageReservationRows[requestRow] = -1;
		this.requestStorageReservationUsesSourceUnit[requestRow] = 0;
		this.appendEvent(
			"STORAGE_DESTINATION_RESERVATION_CANCELLED",
			requestRow,
			resourceRow,
			timeMicroseconds,
		);
	}

	confirmSourcePickup(requestRow: number, timeMicroseconds: number): readonly number[] {
		assertRequestRow(requestRow, this.routes.requestCount);
		const loadRow = this.admissionProgram.requestLoadRows[requestRow] as number;
		const resourceRow = this.loadStorageResourceRows[loadRow] as number;
		if (resourceRow < 0) {
			this.advanceBeforeMutation(timeMicroseconds);
			return EMPTY_REQUEST_ROWS;
		}
		const expectedGroupId = this.snapshot.foundation.stations.equipmentGroupIds[
			this.routes.sourceStationRows[requestRow] as number
		] as number;
		if (this.configuration.storageEquipmentGroupIds[resourceRow] !== expectedGroupId) {
			throw new Error(`Scenario request row ${requestRow} source storage custody is inconsistent.`);
		}
		const occupied = this.storageOccupiedUnits[resourceRow] as number;
		if (occupied === 0) {
			throw new Error(`Scenario storage resource row ${resourceRow} occupancy would be negative.`);
		}
		this.advanceBeforeMutation(timeMicroseconds);
		this.events.assertCanAppendRequest(requestRow);
		this.storageOccupiedUnits[resourceRow] = occupied - 1;
		this.storageOccupiedUnitCount--;
		this.loadStorageResourceRows[loadRow] = -1;
		const convertsSourceUnit =
			this.requestStorageReservationRows[requestRow] === resourceRow &&
			this.requestStorageReservationUsesSourceUnit[requestRow] === 1;
		if (convertsSourceUnit) {
			this.requestStorageReservationUsesSourceUnit[requestRow] = 0;
			this.storageReservedUnits[resourceRow] =
				(this.storageReservedUnits[resourceRow] as number) + 1;
			this.storageReservedUnitCount++;
		}
		this.appendEvent("STORAGE_SOURCE_RELEASED", requestRow, resourceRow, timeMicroseconds);
		if (convertsSourceUnit) return EMPTY_REQUEST_ROWS;
		const waiter = this.takeStorageDestinationWaiter(resourceRow);
		return waiter < 0 ? EMPTY_REQUEST_ROWS : Object.freeze([waiter]);
	}

	confirmDestinationArrival(requestRow: number, timeMicroseconds: number): void {
		assertRequestRow(requestRow, this.routes.requestCount);
		const loadRow = this.admissionProgram.requestLoadRows[requestRow] as number;
		if (this.loadStorageResourceRows[loadRow] >= 0) {
			throw new Error(`Scenario request row ${requestRow} load still occupies source storage.`);
		}
		const storageResourceRow = this.destinationStorageResourceRows[requestRow] as number;
		if (storageResourceRow >= 0) {
			if (this.requestStorageReservationRows[requestRow] !== storageResourceRow) {
				throw new Error(
					`Scenario request row ${requestRow} has no destination storage reservation.`,
				);
			}
			this.advanceBeforeMutation(timeMicroseconds);
			this.events.assertCanAppendRequest(requestRow);
			this.decrementReserved(storageResourceRow);
			this.requestStorageReservationRows[requestRow] = -1;
			this.storageOccupiedUnits[storageResourceRow] =
				(this.storageOccupiedUnits[storageResourceRow] as number) + 1;
			this.storageOccupiedUnitCount++;
			this.loadStorageResourceRows[loadRow] = storageResourceRow;
			this.appendEvent(
				"STORAGE_DESTINATION_OCCUPIED",
				requestRow,
				storageResourceRow,
				timeMicroseconds,
			);
			return;
		}
		const eqResourceRow = this.destinationEqResourceRows[requestRow] as number;
		if (eqResourceRow < 0) {
			throw new Error(`Scenario request row ${requestRow} has no prepared destination resource.`);
		}
		if (
			this.eqServicePhaseCodes[requestRow] !== DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.NOT_ARRIVED
		) {
			throw new Error(`Scenario request row ${requestRow} EQ service already arrived.`);
		}
		this.advanceBeforeMutation(timeMicroseconds);
		this.events.assertCanAppendRequest(requestRow);
		this.transitionEqServicePhase(requestRow, DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.QUEUED);
		this.eqQueuedTimesMicroseconds[requestRow] = timeMicroseconds;
		pushEqWaiter(this.eqQueues, eqResourceRow, requestRow, this.eqQueuedTimesMicroseconds);
		this.appendEvent("EQ_SERVICE_QUEUED", requestRow, eqResourceRow, timeMicroseconds);
	}

	eqServiceState(requestRow: number): DeterministicScenarioEqServiceState {
		assertRequestRow(requestRow, this.routes.requestCount);
		const phaseCode = this.eqServicePhaseCodes[requestRow] as number;
		return Object.freeze({
			requestRow,
			phaseCode,
			queuedAtMicroseconds: optionalTime(this.eqQueuedTimesMicroseconds[requestRow] as number),
			startedAtMicroseconds: optionalTime(this.eqStartedTimesMicroseconds[requestRow] as number),
			readyAtMicroseconds: optionalTime(this.eqReadyTimesMicroseconds[requestRow] as number),
		});
	}

	advanceToTimeMicroseconds(targetTimeMicroseconds: number): number {
		assertMonotonicTime(targetTimeMicroseconds, this.timeMicroseconds);
		const eventStart = this.events.eventCount;
		while (true) {
			const nextTime = this.nextScheduledTransitionTimeMicroseconds;
			if (nextTime > targetTimeMicroseconds) break;
			if (nextTime < this.timeMicroseconds) {
				throw new Error("Scenario resource scheduler produced a backwards transition.");
			}
			this.timeMicroseconds = nextTime;
			this.completeEqServicesAtCurrentTime();
			this.startEqServicesAtCurrentTime();
		}
		this.timeMicroseconds = targetTimeMicroseconds;
		return this.events.eventCount - eventStart;
	}

	private advanceBeforeMutation(timeMicroseconds: number): void {
		assertMonotonicTime(timeMicroseconds, this.timeMicroseconds);
		if (timeMicroseconds > this.timeMicroseconds) this.advanceToTimeMicroseconds(timeMicroseconds);
	}

	private nextEqServiceStartTime(): number {
		let earliest = Number.POSITIVE_INFINITY;
		for (let resourceRow = 0; resourceRow < this.configuration.eqResourceCount; resourceRow++) {
			if (
				(this.eqActiveCounts[resourceRow] as number) >=
				(this.configuration.eqConcurrentCapacities[resourceRow] as number)
			) {
				continue;
			}
			const headRequestRow = peekEqWaiter(this.eqQueues, resourceRow);
			if (headRequestRow < 0) continue;
			const duration = this.serviceTiming.serviceDurationMicroseconds[headRequestRow] as number;
			const candidate = earliestEqStart(
				this.configuration,
				resourceRow,
				Math.max(this.timeMicroseconds, this.eqQueuedTimesMicroseconds[headRequestRow] as number),
				duration,
			);
			if (candidate < earliest) earliest = candidate;
		}
		return earliest;
	}

	private completeEqServicesAtCurrentTime(): void {
		while (this.eqCompletionHeap.peekReadyAtMicroseconds === this.timeMicroseconds) {
			this.events.assertCanAppendRequest(this.eqCompletionHeap.peekRequestRow);
			const completion = this.eqCompletionHeap.pop() as EqCompletion;
			const active = this.eqActiveCounts[completion.resourceRow] as number;
			if (active === 0) throw new Error("Scenario EQ active count would be negative.");
			this.eqActiveCounts[completion.resourceRow] = active - 1;
			this.transitionEqServicePhase(
				completion.requestRow,
				DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.READY,
			);
			this.eqReadyTimesMicroseconds[completion.requestRow] = completion.readyAtMicroseconds;
			this.appendEvent(
				"EQ_SERVICE_READY",
				completion.requestRow,
				completion.resourceRow,
				completion.readyAtMicroseconds,
			);
		}
	}

	private startEqServicesAtCurrentTime(): void {
		for (let resourceRow = 0; resourceRow < this.configuration.eqResourceCount; resourceRow++) {
			const capacity = this.configuration.eqConcurrentCapacities[resourceRow] as number;
			while ((this.eqActiveCounts[resourceRow] as number) < capacity) {
				const headRequestRow = peekEqWaiter(this.eqQueues, resourceRow);
				if (headRequestRow < 0) break;
				const duration = this.serviceTiming.serviceDurationMicroseconds[headRequestRow] as number;
				const start = earliestEqStart(
					this.configuration,
					resourceRow,
					Math.max(this.timeMicroseconds, this.eqQueuedTimesMicroseconds[headRequestRow] as number),
					duration,
				);
				if (start !== this.timeMicroseconds) break;
				const readyAt = start + duration;
				if (!Number.isSafeInteger(readyAt)) {
					throw new RangeError(`Scenario request row ${headRequestRow} EQ ready time is unsafe.`);
				}
				this.events.assertCanAppendRequest(headRequestRow);
				popExpectedEqWaiter(
					this.eqQueues,
					resourceRow,
					headRequestRow,
					this.eqQueuedTimesMicroseconds,
				);
				this.eqActiveCounts[resourceRow] = (this.eqActiveCounts[resourceRow] as number) + 1;
				this.transitionEqServicePhase(
					headRequestRow,
					DETERMINISTIC_SCENARIO_EQ_SERVICE_PHASE.ACTIVE,
				);
				this.eqStartedTimesMicroseconds[headRequestRow] = start;
				this.eqCompletionHeap.push({
					requestRow: headRequestRow,
					resourceRow,
					readyAtMicroseconds: readyAt,
				});
				this.appendEvent("EQ_SERVICE_STARTED", headRequestRow, resourceRow, start);
			}
		}
	}

	private decrementReserved(resourceRow: number): void {
		const reserved = this.storageReservedUnits[resourceRow] as number;
		if (reserved === 0) {
			throw new Error(
				`Scenario storage resource row ${resourceRow} reservation would be negative.`,
			);
		}
		if (this.storageReservedUnitCount === 0) {
			throw new Error("Scenario storage reservation total would be negative.");
		}
		this.storageReservedUnits[resourceRow] = reserved - 1;
		this.storageReservedUnitCount--;
	}

	private transitionEqServicePhase(requestRow: number, nextPhase: number): void {
		const previousPhase = this.eqServicePhaseCodes[requestRow] as number;
		const previousCount = this.eqServicePhaseCounts[previousPhase] as number;
		if (
			this.destinationEqResourceRows[requestRow] < 0 ||
			previousPhase === nextPhase ||
			previousCount === 0
		) {
			throw new Error(`Scenario request row ${requestRow} EQ phase accounting is inconsistent.`);
		}
		this.eqServicePhaseCodes[requestRow] = nextPhase;
		this.eqServicePhaseCounts[previousPhase] = previousCount - 1;
		this.eqServicePhaseCounts[nextPhase] = (this.eqServicePhaseCounts[nextPhase] as number) + 1;
	}

	private takeStorageDestinationWaiter(resourceRow: number): number {
		while (this.storageDestinationWaiterSizes[resourceRow] > 0) {
			const requestRow = popStorageDestinationWaiter(
				this.storageDestinationRequestOffsets,
				this.storageDestinationRequestRows,
				this.storageDestinationWaiterSizes,
				resourceRow,
			);
			if (this.requestStorageDestinationWaitListed[requestRow] === 0) continue;
			this.requestStorageDestinationWaitListed[requestRow] = 0;
			return requestRow;
		}
		return -1;
	}

	private appendEvent(
		type: DeterministicScenarioResourceEvent["type"],
		requestRow: number,
		resourceRow: number,
		timeMicroseconds: number,
	): void {
		this.events.append({
			type,
			timeMicroseconds,
			requestRow,
			loadRow: this.admissionProgram.requestLoadRows[requestRow] as number,
			resourceRow,
		});
	}
}

function assertCompatibleSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
	admissionProgram: SimulationScenarioAdmissionProgram,
	serviceTiming: SimulationScenarioServiceTiming,
	configuration: SimulationScenarioResourceRunConfiguration,
): void {
	const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
	if (snapshotError) throw new Error(`Published readiness snapshot is invalid: ${snapshotError}`);
	const routesError = simulationScenarioRouteRequestsError(routes);
	if (routesError) throw new Error(`Scenario route requests are invalid: ${routesError}`);
	const admissionError = simulationScenarioAdmissionProgramError(admissionProgram);
	if (admissionError) throw new Error(`Scenario admission program is invalid: ${admissionError}`);
	const timingError = simulationScenarioServiceTimingError(serviceTiming);
	if (timingError) throw new Error(`Scenario service timing is invalid: ${timingError}`);
	const configurationError = simulationScenarioResourceRunConfigurationError(configuration);
	if (configurationError) {
		throw new Error(`Scenario resource run configuration is invalid: ${configurationError}`);
	}
	if (
		routes.sourceCertificateFingerprint !== snapshot.certificate.fingerprint ||
		admissionProgram.sourceRouteRequestsFingerprint !== routes.fingerprint ||
		serviceTiming.sourceRouteRequestsFingerprint !== routes.fingerprint ||
		serviceTiming.sourceAdmissionProgramFingerprint !== admissionProgram.fingerprint ||
		configuration.sourceRouteRequestsFingerprint !== routes.fingerprint ||
		configuration.sourceAdmissionProgramFingerprint !== admissionProgram.fingerprint ||
		configuration.sourceServiceTimingFingerprint !== serviceTiming.fingerprint ||
		configuration.sourceCertificateFingerprint !== snapshot.certificate.fingerprint ||
		configuration.sourceEquipmentResourcesFingerprint !== snapshot.equipmentResources.fingerprint ||
		routes.requestCount !== admissionProgram.requestCount ||
		routes.requestCount !== serviceTiming.requestCount ||
		routes.requestCount !== configuration.requestCount ||
		admissionProgram.loadCount !== configuration.loadCount
	) {
		throw new Error("Scenario resource state sources are inconsistent.");
	}
}

function compileDestinationResourceRows(
	serviceTiming: SimulationScenarioServiceTiming,
	groupIds: Uint32Array,
	eq: boolean,
): Int32Array {
	const rowByGroupId = new Map([...groupIds].map((groupId, row) => [groupId, row]));
	const rows = new Int32Array(serviceTiming.requestCount).fill(-1);
	for (let requestRow = 0; requestRow < serviceTiming.requestCount; requestRow++) {
		const isEq =
			serviceTiming.serviceKindCodes[requestRow] ===
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS;
		if (isEq !== eq) continue;
		const groupId = serviceTiming.destinationEquipmentGroupIds[requestRow] as number;
		const resourceRow = rowByGroupId.get(groupId);
		if (resourceRow === undefined) {
			throw new Error(`Scenario destination group ${groupId} has no resource-state row.`);
		}
		rows[requestRow] = resourceRow;
	}
	return rows;
}

function compileStorageDestinationRequests(
	destinationResourceRows: Int32Array,
	resourceCount: number,
): Readonly<{ offsets: Uint32Array; requestRows: Uint32Array }> {
	const counts = new Uint32Array(resourceCount);
	for (const resourceRow of destinationResourceRows) {
		if (resourceRow >= 0) counts[resourceRow]++;
	}
	const offsets = new Uint32Array(resourceCount + 1);
	for (let resourceRow = 0; resourceRow < resourceCount; resourceRow++) {
		offsets[resourceRow + 1] = (offsets[resourceRow] as number) + (counts[resourceRow] as number);
	}
	return Object.freeze({
		offsets,
		requestRows: new Uint32Array(offsets[resourceCount] as number),
	});
}

function pushStorageDestinationWaiter(
	offsets: Uint32Array,
	requestRows: Uint32Array,
	sizes: Uint32Array,
	resourceRow: number,
	requestRow: number,
): void {
	const start = offsets[resourceRow] as number;
	const size = sizes[resourceRow] as number;
	const capacity = (offsets[resourceRow + 1] as number) - start;
	if (size >= capacity) {
		throw new Error(`Scenario storage row ${resourceRow} waiter capacity is exhausted.`);
	}
	let localRow = size;
	while (localRow > 0) {
		const parentLocalRow = Math.floor((localRow - 1) / 2);
		const parentRequestRow = requestRows[start + parentLocalRow] as number;
		if (parentRequestRow <= requestRow) break;
		requestRows[start + localRow] = parentRequestRow;
		localRow = parentLocalRow;
	}
	requestRows[start + localRow] = requestRow;
	sizes[resourceRow] = size + 1;
}

function popStorageDestinationWaiter(
	offsets: Uint32Array,
	requestRows: Uint32Array,
	sizes: Uint32Array,
	resourceRow: number,
): number {
	const start = offsets[resourceRow] as number;
	const size = sizes[resourceRow] as number;
	if (size === 0) throw new Error(`Scenario storage row ${resourceRow} has no waiting request.`);
	const firstRequestRow = requestRows[start] as number;
	const nextSize = size - 1;
	sizes[resourceRow] = nextSize;
	if (nextSize === 0) return firstRequestRow;
	const lastRequestRow = requestRows[start + nextSize] as number;
	let localRow = 0;
	while (true) {
		const leftLocalRow = localRow * 2 + 1;
		if (leftLocalRow >= nextSize) break;
		const rightLocalRow = leftLocalRow + 1;
		let childLocalRow = leftLocalRow;
		if (
			rightLocalRow < nextSize &&
			(requestRows[start + rightLocalRow] as number) < (requestRows[start + leftLocalRow] as number)
		) {
			childLocalRow = rightLocalRow;
		}
		const childRequestRow = requestRows[start + childLocalRow] as number;
		if (childRequestRow >= lastRequestRow) break;
		requestRows[start + localRow] = childRequestRow;
		localRow = childLocalRow;
	}
	requestRows[start + localRow] = lastRequestRow;
	return firstRequestRow;
}

function earliestEqStart(
	configuration: SimulationScenarioResourceRunConfiguration,
	resourceRow: number,
	earliestMicroseconds: number,
	durationMicroseconds: number,
): number {
	if (
		configuration.eqAvailabilityModeCodes[resourceRow] ===
		SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE.ALWAYS
	) {
		return earliestMicroseconds;
	}
	const windowStart = configuration.eqAvailabilityWindowOffsets[resourceRow] as number;
	const windowEnd = configuration.eqAvailabilityWindowOffsets[resourceRow + 1] as number;
	for (let windowRow = windowStart; windowRow < windowEnd; windowRow++) {
		const start = Math.max(
			earliestMicroseconds,
			configuration.eqAvailabilityWindowStartsMicroseconds[windowRow] as number,
		);
		const end = configuration.eqAvailabilityWindowEndsMicroseconds[windowRow] as number;
		if (start + durationMicroseconds <= end) return start;
	}
	return Number.POSITIVE_INFINITY;
}

function compileEqWaitQueues(
	destinationResourceRows: Int32Array,
	resourceCount: number,
): EqWaitQueues {
	const counts = new Uint32Array(resourceCount);
	for (const resourceRow of destinationResourceRows) {
		if (resourceRow >= 0) counts[resourceRow]++;
	}
	const offsets = new Uint32Array(resourceCount + 1);
	for (let resourceRow = 0; resourceRow < resourceCount; resourceRow++) {
		offsets[resourceRow + 1] = (offsets[resourceRow] as number) + (counts[resourceRow] as number);
	}
	return Object.freeze({
		offsets,
		requestRows: new Uint32Array(offsets[resourceCount] as number),
		sizes: new Uint32Array(resourceCount),
	});
}

function pushEqWaiter(
	queues: EqWaitQueues,
	resourceRow: number,
	requestRow: number,
	queuedTimesMicroseconds: Float64Array,
): void {
	const start = queues.offsets[resourceRow] as number;
	const size = queues.sizes[resourceRow] as number;
	const capacity = (queues.offsets[resourceRow + 1] as number) - start;
	if (size >= capacity) {
		throw new Error(`Scenario EQ row ${resourceRow} wait-queue capacity is exhausted.`);
	}
	let localRow = size;
	while (localRow > 0) {
		const parentLocalRow = Math.floor((localRow - 1) / 2);
		const parentRequestRow = queues.requestRows[start + parentLocalRow] as number;
		if (compareEqWaiters(parentRequestRow, requestRow, queuedTimesMicroseconds) <= 0) break;
		queues.requestRows[start + localRow] = parentRequestRow;
		localRow = parentLocalRow;
	}
	queues.requestRows[start + localRow] = requestRow;
	queues.sizes[resourceRow] = size + 1;
}

function peekEqWaiter(queues: EqWaitQueues, resourceRow: number): number {
	return queues.sizes[resourceRow] === 0
		? -1
		: (queues.requestRows[queues.offsets[resourceRow] as number] as number);
}

function popExpectedEqWaiter(
	queues: EqWaitQueues,
	resourceRow: number,
	expectedRequestRow: number,
	queuedTimesMicroseconds: Float64Array,
): void {
	const start = queues.offsets[resourceRow] as number;
	const size = queues.sizes[resourceRow] as number;
	if (size === 0 || queues.requestRows[start] !== expectedRequestRow) {
		throw new Error(
			`Scenario EQ row ${resourceRow} oldest waiter is not request ${expectedRequestRow}.`,
		);
	}
	const nextSize = size - 1;
	queues.sizes[resourceRow] = nextSize;
	if (nextSize === 0) return;
	const lastRequestRow = queues.requestRows[start + nextSize] as number;
	let localRow = 0;
	while (true) {
		const leftLocalRow = localRow * 2 + 1;
		if (leftLocalRow >= nextSize) break;
		const rightLocalRow = leftLocalRow + 1;
		let childLocalRow = leftLocalRow;
		if (
			rightLocalRow < nextSize &&
			compareEqWaiters(
				queues.requestRows[start + rightLocalRow] as number,
				queues.requestRows[start + leftLocalRow] as number,
				queuedTimesMicroseconds,
			) < 0
		) {
			childLocalRow = rightLocalRow;
		}
		const childRequestRow = queues.requestRows[start + childLocalRow] as number;
		if (compareEqWaiters(childRequestRow, lastRequestRow, queuedTimesMicroseconds) >= 0) break;
		queues.requestRows[start + localRow] = childRequestRow;
		localRow = childLocalRow;
	}
	queues.requestRows[start + localRow] = lastRequestRow;
}

function compareEqWaiters(
	leftRequestRow: number,
	rightRequestRow: number,
	queuedTimesMicroseconds: Float64Array,
): number {
	return (
		(queuedTimesMicroseconds[leftRequestRow] as number) -
			(queuedTimesMicroseconds[rightRequestRow] as number) || leftRequestRow - rightRequestRow
	);
}

function eqCompletionCapacity(
	configuration: SimulationScenarioResourceRunConfiguration,
	eqDestinationRequestCount: number,
): number {
	let totalConcurrentCapacity = 0;
	for (const capacity of configuration.eqConcurrentCapacities) {
		totalConcurrentCapacity += capacity;
		if (!Number.isSafeInteger(totalConcurrentCapacity)) {
			throw new RangeError("Scenario EQ concurrent-capacity total is unsafe.");
		}
	}
	return Math.min(eqDestinationRequestCount, totalConcurrentCapacity);
}

class EqCompletionHeap {
	private readonly requestRows: Uint32Array;
	private readonly resourceRows: Uint32Array;
	private readonly readyTimesMicroseconds: Float64Array;
	private size = 0;

	constructor(capacity: number) {
		this.requestRows = new Uint32Array(capacity);
		this.resourceRows = new Uint32Array(capacity);
		this.readyTimesMicroseconds = new Float64Array(capacity);
	}

	get retainedByteCapacity(): number {
		return (
			this.requestRows.byteLength +
			this.resourceRows.byteLength +
			this.readyTimesMicroseconds.byteLength
		);
	}

	get peekReadyAtMicroseconds(): number {
		return this.size === 0 ? Number.POSITIVE_INFINITY : (this.readyTimesMicroseconds[0] as number);
	}

	get peekRequestRow(): number {
		if (this.size === 0) throw new Error("Scenario EQ completion heap is empty.");
		return this.requestRows[0] as number;
	}

	push(value: EqCompletion): void {
		if (this.size >= this.requestRows.length) {
			throw new Error("Scenario EQ completion heap capacity is exhausted.");
		}
		let row = this.size++;
		while (row > 0) {
			const parentRow = (row - 1) >>> 1;
			if (
				compareEqCompletionValues(
					this.readyTimesMicroseconds[parentRow] as number,
					this.resourceRows[parentRow] as number,
					this.requestRows[parentRow] as number,
					value.readyAtMicroseconds,
					value.resourceRow,
					value.requestRow,
				) <= 0
			) {
				break;
			}
			this.copyRow(parentRow, row);
			row = parentRow;
		}
		this.writeRow(row, value);
	}

	pop(): EqCompletion | undefined {
		if (this.size === 0) return undefined;
		const first: EqCompletion = {
			requestRow: this.requestRows[0] as number,
			resourceRow: this.resourceRows[0] as number,
			readyAtMicroseconds: this.readyTimesMicroseconds[0] as number,
		};
		const lastRow = --this.size;
		if (lastRow === 0) return first;
		const last: EqCompletion = {
			requestRow: this.requestRows[lastRow] as number,
			resourceRow: this.resourceRows[lastRow] as number,
			readyAtMicroseconds: this.readyTimesMicroseconds[lastRow] as number,
		};
		let row = 0;
		while (true) {
			const leftRow = row * 2 + 1;
			if (leftRow >= this.size) break;
			const rightRow = leftRow + 1;
			let childRow = leftRow;
			if (rightRow < this.size && this.compareRows(rightRow, leftRow) < 0) {
				childRow = rightRow;
			}
			if (
				compareEqCompletionValues(
					this.readyTimesMicroseconds[childRow] as number,
					this.resourceRows[childRow] as number,
					this.requestRows[childRow] as number,
					last.readyAtMicroseconds,
					last.resourceRow,
					last.requestRow,
				) >= 0
			) {
				break;
			}
			this.copyRow(childRow, row);
			row = childRow;
		}
		this.writeRow(row, last);
		return first;
	}

	private compareRows(leftRow: number, rightRow: number): number {
		return compareEqCompletionValues(
			this.readyTimesMicroseconds[leftRow] as number,
			this.resourceRows[leftRow] as number,
			this.requestRows[leftRow] as number,
			this.readyTimesMicroseconds[rightRow] as number,
			this.resourceRows[rightRow] as number,
			this.requestRows[rightRow] as number,
		);
	}

	private copyRow(sourceRow: number, destinationRow: number): void {
		this.readyTimesMicroseconds[destinationRow] = this.readyTimesMicroseconds[sourceRow] as number;
		this.resourceRows[destinationRow] = this.resourceRows[sourceRow] as number;
		this.requestRows[destinationRow] = this.requestRows[sourceRow] as number;
	}

	private writeRow(row: number, value: EqCompletion): void {
		this.readyTimesMicroseconds[row] = value.readyAtMicroseconds;
		this.resourceRows[row] = value.resourceRow;
		this.requestRows[row] = value.requestRow;
	}
}

function compareEqCompletionValues(
	leftReadyAtMicroseconds: number,
	leftResourceRow: number,
	leftRequestRow: number,
	rightReadyAtMicroseconds: number,
	rightResourceRow: number,
	rightRequestRow: number,
): number {
	return (
		leftReadyAtMicroseconds - rightReadyAtMicroseconds ||
		leftResourceRow - rightResourceRow ||
		leftRequestRow - rightRequestRow
	);
}

function filledFloat64(length: number, value: number): Float64Array {
	const values = new Float64Array(length);
	values.fill(value);
	return values;
}

function optionalTime(value: number): number | null {
	return value < 0 ? null : value;
}

function assertRequestRow(requestRow: number, requestCount: number): void {
	assertResourceRow(requestRow, requestCount, "request");
}

function assertResourceRow(row: number, count: number, label: string): void {
	if (!Number.isSafeInteger(row) || row < 0 || row >= count) {
		throw new RangeError(`Scenario ${label} row ${row} is invalid.`);
	}
}

function assertMonotonicTime(timeMicroseconds: number, currentTimeMicroseconds: number): void {
	if (!Number.isSafeInteger(timeMicroseconds) || timeMicroseconds < currentTimeMicroseconds) {
		throw new RangeError("Scenario resource time must be a monotonic non-negative safe integer.");
	}
}
