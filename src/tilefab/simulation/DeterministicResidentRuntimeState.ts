import type { PublishedSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import {
	consumeSimulationResidentRunAuthorizationAdoption,
	type SimulationResidentRunAuthorization,
	type SimulationResidentRunAuthorizationAdoption,
	simulationResidentRunAuthorizationError,
} from "../compile/SimulationResidentRunAuthorization";
import { SIMULATION_SCENARIO_EQ_AVAILABILITY_MODE_CODE } from "../compile/SimulationScenarioResourceRunConfiguration";
import { SIMULATION_SCENARIO_SERVICE_KIND_CODE } from "../compile/SimulationScenarioServiceTiming";
import {
	type DeterministicResidentCoreEvent,
	type DeterministicResidentResourceEvent,
	DeterministicResidentRuntimeEventLog,
} from "./DeterministicResidentRuntimeEventLog";

export const DETERMINISTIC_RESIDENT_REQUEST_PHASE = Object.freeze({
	WAITING_RELEASE: 0,
	WAITING_PREDECESSOR: 1,
	WAITING_COMPLETE_CYCLE_LEASE: 2,
	TO_PICKUP: 3,
	TO_DROPOFF: 4,
	RETURNING_HOME: 5,
	COMPLETED: 6,
} as const);
export type DeterministicResidentRequestPhaseName =
	keyof typeof DETERMINISTIC_RESIDENT_REQUEST_PHASE;

export const DETERMINISTIC_RESIDENT_VEHICLE_PHASE = Object.freeze({
	IDLE_AT_HOME: 0,
	WAITING_FOR_COMPLETE_CYCLE: 1,
	TO_PICKUP: 2,
	TO_DROPOFF: 3,
	RETURNING_HOME: 4,
} as const);
export type DeterministicResidentVehiclePhaseName =
	keyof typeof DETERMINISTIC_RESIDENT_VEHICLE_PHASE;

export const DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE = Object.freeze({
	NOT_ARRIVED: 0,
	QUEUED: 1,
	ACTIVE: 2,
	READY: 3,
} as const);
export type DeterministicResidentDestinationServicePhaseName =
	keyof typeof DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE;

export const DETERMINISTIC_RESIDENT_SPEED_MULTIPLIERS = Object.freeze([
	1, 2, 4, 8, 16, 32, 64,
] as const);
export type DeterministicResidentSpeedMultiplier =
	(typeof DETERMINISTIC_RESIDENT_SPEED_MULTIPLIERS)[number];

export const DETERMINISTIC_RESIDENT_RUNTIME_DISPOSAL_REASONS = Object.freeze([
	"EXPLICIT_STOP",
	"SOURCE_INVALIDATED",
	"OWNER_DISPOSED",
	"RUNTIME_FAILURE",
] as const);
export type DeterministicResidentRuntimeDisposalReason =
	(typeof DETERMINISTIC_RESIDENT_RUNTIME_DISPOSAL_REASONS)[number];
export const DETERMINISTIC_RESIDENT_MOTION_POLICY =
	"THREE_LEG_CONSTANT_CERTIFIED_MAXIMUM_SPEED_V1" as const;
export const DETERMINISTIC_RESIDENT_TRANSITION_TIE_POLICY =
	"RELEASE_THEN_SERVICE_READY_START_THEN_LEG_COMPLETION_THEN_EQ_START_THEN_ADMISSION_RETRY_BY_REQUEST_ROW_V1" as const;

export const DETERMINISTIC_RESIDENT_RUNTIME_STATE_MAX_TYPED_BYTES = 128 * 1024 * 1024;

export interface DeterministicResidentRequestState {
	readonly requestRow: number;
	readonly phase: DeterministicResidentRequestPhaseName;
	readonly requestedAtMicroseconds: number;
	readonly loadRow: number;
	readonly vehicleRow: number;
}

export interface DeterministicResidentVehicleState {
	readonly vehicleRow: number;
	readonly phase: DeterministicResidentVehiclePhaseName;
	readonly homeSlotId: number;
	readonly homePortId: number;
	readonly currentRequestRow: number | null;
}

export type DeterministicResidentLoadCustody =
	| Readonly<{ kind: "STATION"; stationRow: number }>
	| Readonly<{ kind: "VEHICLE"; vehicleRow: number }>;

export interface DeterministicResidentStorageState {
	readonly resourceRow: number;
	readonly equipmentGroupId: number;
	readonly occupiedUnits: number;
	readonly reservedUnits: number;
	readonly capacityUnits: number;
	readonly highWaterMarkUnits: number;
}

export interface DeterministicResidentMotionState {
	readonly requestRow: number;
	readonly legIndex: 0 | 1 | 2 | null;
	readonly legDistanceMeters: number;
	readonly legAnchorDistanceMeters: number;
	readonly cycleDistanceMeters: number;
	readonly cycleAnchorDistanceMeters: number;
	readonly legStartedAtMicroseconds: number | null;
	readonly legCompletesAtMicroseconds: number | null;
}

export interface DeterministicResidentDestinationServiceState {
	readonly requestRow: number;
	readonly phase: DeterministicResidentDestinationServicePhaseName;
	readonly queuedAtMicroseconds: number | null;
	readonly startedAtMicroseconds: number | null;
	readonly readyAtMicroseconds: number | null;
}

export interface DeterministicResidentRuntimeSummary {
	readonly requestCount: number;
	readonly requestWaitingReleaseCount: number;
	readonly requestWaitingPredecessorCount: number;
	readonly requestWaitingCompleteCycleLeaseCount: number;
	readonly requestToPickupCount: number;
	readonly requestToDropoffCount: number;
	readonly requestReturningHomeCount: number;
	readonly requestCompletedCount: number;
	readonly destinationServiceNotArrivedCount: number;
	readonly destinationServiceQueuedCount: number;
	readonly destinationServiceActiveCount: number;
	readonly destinationServiceReadyCount: number;
	readonly vehicleCount: number;
	readonly vehicleIdleAtHomeCount: number;
	readonly vehicleWaitingForCompleteCycleCount: number;
	readonly vehicleMovingCount: number;
	readonly loadCount: number;
	readonly homeTrackResourceCount: number;
	readonly nonHomeOwnedTrackResourceCount: number;
	readonly ownedSwitchConflictResourceCount: number;
	readonly storageResourceCount: number;
	readonly storageOccupiedUnits: number;
	readonly storageReservedUnits: number;
	readonly typedByteLength: number;
}

const RESIDENT_RUNTIME_CONSTRUCTION: unique symbol = Symbol(
	"OpenFabDeterministicResidentRuntimeConstruction",
);

/**
 * Headless run-local state for the resident profile. Only the authorization adopter factory can
 * construct it. It deterministically releases canonical requests, moves their exact three-leg
 * cycles, and schedules destination service, but still performs no public presentation.
 */
export class DeterministicResidentRuntimeState {
	readonly motionPolicy = DETERMINISTIC_RESIDENT_MOTION_POLICY;
	readonly transitionTiePolicy = DETERMINISTIC_RESIDENT_TRANSITION_TIE_POLICY;
	readonly sourceAuthorizationFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly typedByteLength: number;
	private readonly snapshot: PublishedSimulationResidentReadinessSnapshot;
	private readonly requestPhaseCodes: Uint8Array;
	private readonly requestPhaseCounts = new Uint32Array(7);
	private readonly vehiclePhaseCodes: Uint8Array;
	private readonly vehiclePhaseCounts = new Uint32Array(5);
	private readonly vehicleCurrentRequestRows: Int32Array;
	private readonly loadStationRows: Uint32Array;
	private readonly loadVehicleRows: Int32Array;
	private readonly loadStorageResourceRows: Int32Array;
	private readonly destinationStorageResourceRows: Int32Array;
	private readonly requestStorageReservationRows: Int32Array;
	private readonly requestStorageReservationUsesSourceUnit: Uint8Array;
	private readonly destinationServicePhaseCodes: Uint8Array;
	private readonly destinationServicePhaseCounts = new Uint32Array(4);
	private readonly destinationServiceQueuedTimesMicroseconds: Float64Array;
	private readonly destinationServiceStartedTimesMicroseconds: Float64Array;
	private readonly destinationServiceReadyTimesMicroseconds: Float64Array;
	private readonly destinationEqResourceRows: Int32Array;
	private readonly eqActiveCounts: Uint32Array;
	private readonly eqWaitQueues: ResidentEqWaitQueues;
	private readonly serviceCompletionHeap: ResidentTimedRequestHeap;
	private readonly legTravelDurationsMicroseconds: Float64Array;
	private readonly requestLegStartedTimesMicroseconds: Float64Array;
	private readonly requestLegCompletionTimesMicroseconds: Float64Array;
	private readonly legCompletionHeap: ResidentTimedRequestHeap;
	private readonly leaseWaiterRows: Uint32Array;
	private readonly leaseWaiterFlags: Uint8Array;
	private readonly trackResourceOwnerVehicleRows: Int32Array;
	private readonly switchConflictOwnerVehicleRows: Int32Array;
	private readonly storageOccupiedUnits: Uint32Array;
	private readonly storageReservedUnits: Uint32Array;
	private readonly stationRowByPortId: ReadonlyMap<number, number>;
	private readonly events: DeterministicResidentRuntimeEventLog;
	private readonly homeTrackResourceCountValue: number;
	private releaseCursor = 0;
	private currentTime = 0;
	private leaseWaiterWriteCursor = 0;
	private completedRequestCountValue = 0;
	private readyDestinationServiceCountValue = 0;
	private nonHomeOwnedTrackResourceCountValue = 0;
	private ownedSwitchConflictResourceCountValue = 0;
	private disposalReasonValue: DeterministicResidentRuntimeDisposalReason | null = null;

	constructor(
		construction: typeof RESIDENT_RUNTIME_CONSTRUCTION,
		authorization: SimulationResidentRunAuthorization,
		snapshot: PublishedSimulationResidentReadinessSnapshot,
	) {
		if (construction !== RESIDENT_RUNTIME_CONSTRUCTION) {
			throw new Error("Resident runtime state requires consumed one-shot authorization.");
		}
		assertRuntimeSources(authorization, snapshot);
		assertRuntimeMemoryLimit(snapshot);
		this.sourceAuthorizationFingerprint = authorization.fingerprint;
		this.sourceCertificateFingerprint = snapshot.certificate.fingerprint;
		this.snapshot = snapshot;
		this.requestPhaseCodes = new Uint8Array(snapshot.routes.requestCount);
		this.requestPhaseCounts[DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_RELEASE] =
			snapshot.routes.requestCount;
		this.vehiclePhaseCodes = new Uint8Array(snapshot.parking.slotCount);
		this.vehiclePhaseCounts[DETERMINISTIC_RESIDENT_VEHICLE_PHASE.IDLE_AT_HOME] =
			snapshot.parking.slotCount;
		this.vehicleCurrentRequestRows = new Int32Array(snapshot.parking.slotCount).fill(-1);
		this.loadStationRows = snapshot.admissionProgram.initialCustodyStationRows.slice();
		this.loadVehicleRows = new Int32Array(snapshot.admissionProgram.loadCount).fill(-1);
		this.loadStorageResourceRows =
			snapshot.resourceRunConfiguration.initialLoadStorageResourceRows.slice();
		this.destinationStorageResourceRows = compileDestinationStorageResourceRows(snapshot);
		this.requestStorageReservationRows = new Int32Array(snapshot.routes.requestCount).fill(-1);
		this.requestStorageReservationUsesSourceUnit = new Uint8Array(snapshot.routes.requestCount);
		this.destinationServicePhaseCodes = new Uint8Array(snapshot.routes.requestCount);
		this.destinationServicePhaseCounts[
			DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.NOT_ARRIVED
		] = snapshot.routes.requestCount;
		this.destinationServiceQueuedTimesMicroseconds = filledFloat64(
			snapshot.routes.requestCount,
			-1,
		);
		this.destinationServiceStartedTimesMicroseconds = filledFloat64(
			snapshot.routes.requestCount,
			-1,
		);
		this.destinationServiceReadyTimesMicroseconds = filledFloat64(snapshot.routes.requestCount, -1);
		this.destinationEqResourceRows = compileDestinationEqResourceRows(snapshot);
		this.eqActiveCounts = new Uint32Array(snapshot.resourceRunConfiguration.eqResourceCount);
		this.eqWaitQueues = new ResidentEqWaitQueues(
			this.destinationEqResourceRows,
			snapshot.resourceRunConfiguration.eqResourceCount,
			this.destinationServiceQueuedTimesMicroseconds,
		);
		this.serviceCompletionHeap = new ResidentTimedRequestHeap(snapshot.routes.requestCount);
		this.legTravelDurationsMicroseconds = compileResidentLegTravelDurations(snapshot);
		this.requestLegStartedTimesMicroseconds = filledFloat64(snapshot.routes.requestCount, -1);
		this.requestLegCompletionTimesMicroseconds = filledFloat64(snapshot.routes.requestCount, -1);
		this.legCompletionHeap = new ResidentTimedRequestHeap(snapshot.routes.requestCount);
		this.leaseWaiterRows = new Uint32Array(snapshot.routes.requestCount);
		this.leaseWaiterFlags = new Uint8Array(snapshot.routes.requestCount);
		this.trackResourceOwnerVehicleRows = new Int32Array(
			snapshot.trackResources.trackResourceCount,
		).fill(-1);
		this.switchConflictOwnerVehicleRows = new Int32Array(
			snapshot.trackResources.switchConflictResourceCount,
		).fill(-1);
		this.storageOccupiedUnits =
			snapshot.resourceRunConfiguration.storageInitialOccupiedUnits.slice();
		this.storageReservedUnits = new Uint32Array(
			snapshot.resourceRunConfiguration.storageResourceCount,
		);
		this.stationRowByPortId = compileStationRowByPortId(snapshot);
		this.events = new DeterministicResidentRuntimeEventLog(snapshot.routes.requestCount);
		this.homeTrackResourceCountValue = this.initializeDedicatedHomeOwnership();
		this.typedByteLength = sumByteLengths(this.ownedViews());
		if (this.typedByteLength > DETERMINISTIC_RESIDENT_RUNTIME_STATE_MAX_TYPED_BYTES) {
			throw new Error("Resident runtime state exceeded its typed-memory limit after construction.");
		}
	}

	get requestCount(): number {
		return this.requestPhaseCodes.length;
	}

	get vehicleCount(): number {
		return this.vehiclePhaseCodes.length;
	}

	get loadCount(): number {
		return this.loadStationRows.length;
	}

	get currentTimeMicroseconds(): number {
		this.assertRuntimeActive();
		return this.currentTime;
	}

	get nextScheduledTransitionTimeMicroseconds(): number {
		this.assertRuntimeActive();
		const nextRelease =
			this.releaseCursor < this.requestCount
				? (this.snapshot.routes.requestedAtMicroseconds[this.releaseCursor] as number)
				: Number.POSITIVE_INFINITY;
		return Math.min(
			nextRelease,
			this.legCompletionHeap.peekTimeMicroseconds,
			this.serviceCompletionHeap.peekTimeMicroseconds,
			this.nextEqServiceStartTimeMicroseconds(),
		);
	}

	get completedRequestCount(): number {
		this.assertRuntimeActive();
		return this.completedRequestCountValue;
	}

	get readyDestinationServiceCount(): number {
		this.assertRuntimeActive();
		return this.readyDestinationServiceCountValue;
	}

	get allResidentWorkCompleted(): boolean {
		this.assertRuntimeActive();
		return (
			this.completedRequestCountValue === this.requestCount &&
			this.readyDestinationServiceCountValue === this.requestCount
		);
	}

	get coreEventCount(): number {
		this.assertRuntimeActive();
		return this.events.coreEventCount;
	}

	get resourceEventCount(): number {
		this.assertRuntimeActive();
		return this.events.resourceEventCount;
	}

	get disposed(): boolean {
		return this.disposalReasonValue !== null;
	}

	get disposalReason(): DeterministicResidentRuntimeDisposalReason | null {
		return this.disposalReasonValue;
	}

	dispose(reason: DeterministicResidentRuntimeDisposalReason): boolean {
		if (!DETERMINISTIC_RESIDENT_RUNTIME_DISPOSAL_REASONS.includes(reason)) {
			throw new RangeError("Resident runtime disposal reason is invalid.");
		}
		if (this.disposalReasonValue !== null) return false;
		this.disposalReasonValue = reason;
		return true;
	}

	/** Advances exact release and three-leg transport transitions; returns newly launched cycles. */
	advanceSimulationToTimeMicroseconds(targetTimeMicroseconds: number): number {
		this.assertRuntimeActive();
		if (
			!Number.isSafeInteger(targetTimeMicroseconds) ||
			targetTimeMicroseconds < this.currentTime
		) {
			throw new RangeError(
				"Resident runtime target time must be a monotonic non-negative safe integer.",
			);
		}
		try {
			return this.advanceSimulationToTimeMicrosecondsUnsafe(targetTimeMicroseconds);
		} catch (error) {
			this.dispose("RUNTIME_FAILURE");
			throw error;
		}
	}

	private advanceSimulationToTimeMicrosecondsUnsafe(targetTimeMicroseconds: number): number {
		let launched = 0;
		while (this.nextScheduledTransitionTimeMicroseconds <= targetTimeMicroseconds) {
			const transitionTime = this.nextScheduledTransitionTimeMicroseconds;
			this.currentTime = transitionTime;
			if (
				this.releaseCursor < this.requestCount &&
				this.snapshot.routes.requestedAtMicroseconds[this.releaseCursor] === transitionTime
			) {
				const start = this.releaseCursor;
				while (
					this.releaseCursor < this.requestCount &&
					this.snapshot.routes.requestedAtMicroseconds[this.releaseCursor] === transitionTime
				) {
					this.releaseCursor++;
				}
				for (let requestRow = start; requestRow < this.releaseCursor; requestRow++) {
					if (this.releaseRequest(requestRow)) launched++;
				}
			}
			const admissionCandidates = new Set<number>();
			while (this.serviceCompletionHeap.peekTimeMicroseconds === transitionTime) {
				const successor = this.completeScheduledService(this.serviceCompletionHeap.popRequestRow());
				if (successor >= 0) admissionCandidates.add(successor);
			}
			this.startEligibleEqServicesAtCurrentTime();
			let admissionResourceFreed = false;
			while (this.legCompletionHeap.peekTimeMicroseconds === transitionTime) {
				const requestRow = this.legCompletionHeap.popRequestRow();
				if (this.completeScheduledLeg(requestRow, admissionCandidates)) {
					admissionResourceFreed = true;
				}
			}
			this.startEligibleEqServicesAtCurrentTime();
			launched += this.retryAdmissions(admissionCandidates, admissionResourceFreed);
		}
		this.currentTime = targetTimeMicroseconds;
		return launched;
	}

	advanceByWallClockMicroseconds(
		wallClockMicroseconds: number,
		multiplier: DeterministicResidentSpeedMultiplier,
	): number {
		this.assertRuntimeActive();
		if (!Number.isSafeInteger(wallClockMicroseconds) || wallClockMicroseconds < 0) {
			throw new RangeError("Resident wall-clock advance must be a non-negative safe integer.");
		}
		if (!DETERMINISTIC_RESIDENT_SPEED_MULTIPLIERS.includes(multiplier)) {
			throw new RangeError(
				"Resident speed multiplier must be one of 1x, 2x, 4x, 8x, 16x, 32x, or 64x.",
			);
		}
		const simulationDelta = wallClockMicroseconds * multiplier;
		const target = this.currentTime + simulationDelta;
		if (!Number.isSafeInteger(simulationDelta) || !Number.isSafeInteger(target)) {
			throw new RangeError("Resident scaled simulation time exceeds the safe integer range.");
		}
		return this.advanceSimulationToTimeMicroseconds(target);
	}

	requestState(requestRow: number): DeterministicResidentRequestState {
		this.assertRuntimeActive();
		this.assertRequestRow(requestRow);
		return Object.freeze({
			requestRow,
			phase: requestPhaseName(this.requestPhaseCodes[requestRow] as number),
			requestedAtMicroseconds: this.snapshot.routes.requestedAtMicroseconds[requestRow] as number,
			loadRow: this.snapshot.admissionProgram.requestLoadRows[requestRow] as number,
			vehicleRow: this.snapshot.admissionProgram.requestVehicleRows[requestRow] as number,
		});
	}

	motionState(requestRow: number): DeterministicResidentMotionState {
		this.assertRuntimeActive();
		this.assertRequestRow(requestRow);
		const phaseCode = this.requestPhaseCodes[requestRow] as number;
		const legIndex = requestLegIndex(phaseCode);
		const startedAt = this.requestLegStartedTimesMicroseconds[requestRow] as number;
		const completesAt = this.requestLegCompletionTimesMicroseconds[requestRow] as number;
		const distances = requestLegDistances(this.snapshot, requestRow);
		const cycleDistanceMeters = distances[0] + distances[1] + distances[2];
		let legDistanceMeters = 0;
		let legAnchorDistanceMeters = 0;
		let cycleAnchorDistanceMeters = 0;
		if (legIndex !== null) {
			legDistanceMeters = distances[legIndex];
			const duration = completesAt - startedAt;
			const progress = Math.min(1, Math.max(0, (this.currentTime - startedAt) / duration));
			legAnchorDistanceMeters = legDistanceMeters * progress;
			for (let previousLeg = 0; previousLeg < legIndex; previousLeg++) {
				cycleAnchorDistanceMeters += distances[previousLeg] as number;
			}
			cycleAnchorDistanceMeters += legAnchorDistanceMeters;
		} else if (phaseCode === DETERMINISTIC_RESIDENT_REQUEST_PHASE.COMPLETED) {
			cycleAnchorDistanceMeters = cycleDistanceMeters;
		}
		return Object.freeze({
			requestRow,
			legIndex,
			legDistanceMeters,
			legAnchorDistanceMeters,
			cycleDistanceMeters,
			cycleAnchorDistanceMeters,
			legStartedAtMicroseconds: startedAt < 0 ? null : startedAt,
			legCompletesAtMicroseconds: completesAt < 0 ? null : completesAt,
		});
	}

	destinationServiceState(requestRow: number): DeterministicResidentDestinationServiceState {
		this.assertRuntimeActive();
		this.assertRequestRow(requestRow);
		const queuedAt = this.destinationServiceQueuedTimesMicroseconds[requestRow] as number;
		const startedAt = this.destinationServiceStartedTimesMicroseconds[requestRow] as number;
		const readyAt = this.destinationServiceReadyTimesMicroseconds[requestRow] as number;
		return Object.freeze({
			requestRow,
			phase: destinationServicePhaseName(this.destinationServicePhaseCodes[requestRow] as number),
			queuedAtMicroseconds: queuedAt < 0 ? null : queuedAt,
			startedAtMicroseconds: startedAt < 0 ? null : startedAt,
			readyAtMicroseconds: readyAt < 0 ? null : readyAt,
		});
	}

	coreEventAt(index: number): DeterministicResidentCoreEvent {
		this.assertRuntimeActive();
		return this.events.coreEventAt(index);
	}

	resourceEventAt(index: number): DeterministicResidentResourceEvent {
		this.assertRuntimeActive();
		return this.events.resourceEventAt(index);
	}

	vehicleState(vehicleRow: number): DeterministicResidentVehicleState {
		this.assertRuntimeActive();
		this.assertVehicleRow(vehicleRow);
		const currentRequestRow = this.vehicleCurrentRequestRows[vehicleRow] as number;
		return Object.freeze({
			vehicleRow,
			phase: vehiclePhaseName(this.vehiclePhaseCodes[vehicleRow] as number),
			homeSlotId: this.snapshot.parking.slotIds[vehicleRow] as number,
			homePortId: this.snapshot.parking.anchorPortIds[vehicleRow] as number,
			currentRequestRow: currentRequestRow < 0 ? null : currentRequestRow,
		});
	}

	loadCustody(loadRow: number): DeterministicResidentLoadCustody {
		this.assertRuntimeActive();
		this.assertLoadRow(loadRow);
		const vehicleRow = this.loadVehicleRows[loadRow] as number;
		return vehicleRow < 0
			? Object.freeze({ kind: "STATION", stationRow: this.loadStationRows[loadRow] as number })
			: Object.freeze({ kind: "VEHICLE", vehicleRow });
	}

	loadStorageResourceRow(loadRow: number): number | null {
		this.assertRuntimeActive();
		this.assertLoadRow(loadRow);
		const resourceRow = this.loadStorageResourceRows[loadRow] as number;
		return resourceRow < 0 ? null : resourceRow;
	}

	destinationStorageReservationRow(requestRow: number): number | null {
		this.assertRuntimeActive();
		this.assertRequestRow(requestRow);
		const resourceRow = this.requestStorageReservationRows[requestRow] as number;
		return resourceRow < 0 ? null : resourceRow;
	}

	trackResourceOwnerVehicleRow(resourceRow: number): number | null {
		this.assertRuntimeActive();
		assertRow(resourceRow, this.trackResourceOwnerVehicleRows.length, "track resource");
		const owner = this.trackResourceOwnerVehicleRows[resourceRow] as number;
		return owner < 0 ? null : owner;
	}

	switchConflictOwnerVehicleRow(resourceRow: number): number | null {
		this.assertRuntimeActive();
		assertRow(resourceRow, this.switchConflictOwnerVehicleRows.length, "switch conflict");
		const owner = this.switchConflictOwnerVehicleRows[resourceRow] as number;
		return owner < 0 ? null : owner;
	}

	storageState(resourceRow: number): DeterministicResidentStorageState {
		this.assertRuntimeActive();
		assertRow(resourceRow, this.storageOccupiedUnits.length, "storage resource");
		const configuration = this.snapshot.resourceRunConfiguration;
		return Object.freeze({
			resourceRow,
			equipmentGroupId: configuration.storageEquipmentGroupIds[resourceRow] as number,
			occupiedUnits: this.storageOccupiedUnits[resourceRow] as number,
			reservedUnits: this.storageReservedUnits[resourceRow] as number,
			capacityUnits: configuration.storageCapacityUnits[resourceRow] as number,
			highWaterMarkUnits: configuration.storageHighWaterMarkUnits[resourceRow] as number,
		});
	}

	runtimeSummary(): DeterministicResidentRuntimeSummary {
		this.assertRuntimeActive();
		let storageOccupiedUnits = 0;
		let storageReservedUnits = 0;
		for (const value of this.storageOccupiedUnits) storageOccupiedUnits += value;
		for (const value of this.storageReservedUnits) storageReservedUnits += value;
		return Object.freeze({
			requestCount: this.requestCount,
			requestWaitingReleaseCount: this.requestPhaseCount(
				DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_RELEASE,
			),
			requestWaitingPredecessorCount: this.requestPhaseCount(
				DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_PREDECESSOR,
			),
			requestWaitingCompleteCycleLeaseCount: this.requestPhaseCount(
				DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_COMPLETE_CYCLE_LEASE,
			),
			requestToPickupCount: this.requestPhaseCount(DETERMINISTIC_RESIDENT_REQUEST_PHASE.TO_PICKUP),
			requestToDropoffCount: this.requestPhaseCount(
				DETERMINISTIC_RESIDENT_REQUEST_PHASE.TO_DROPOFF,
			),
			requestReturningHomeCount: this.requestPhaseCount(
				DETERMINISTIC_RESIDENT_REQUEST_PHASE.RETURNING_HOME,
			),
			requestCompletedCount: this.requestPhaseCount(DETERMINISTIC_RESIDENT_REQUEST_PHASE.COMPLETED),
			destinationServiceNotArrivedCount: this.destinationServicePhaseCount(
				DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.NOT_ARRIVED,
			),
			destinationServiceQueuedCount: this.destinationServicePhaseCount(
				DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.QUEUED,
			),
			destinationServiceActiveCount: this.destinationServicePhaseCount(
				DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.ACTIVE,
			),
			destinationServiceReadyCount: this.destinationServicePhaseCount(
				DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.READY,
			),
			vehicleCount: this.vehicleCount,
			vehicleIdleAtHomeCount: this.vehiclePhaseCount(
				DETERMINISTIC_RESIDENT_VEHICLE_PHASE.IDLE_AT_HOME,
			),
			vehicleWaitingForCompleteCycleCount: this.vehiclePhaseCount(
				DETERMINISTIC_RESIDENT_VEHICLE_PHASE.WAITING_FOR_COMPLETE_CYCLE,
			),
			vehicleMovingCount:
				this.vehiclePhaseCount(DETERMINISTIC_RESIDENT_VEHICLE_PHASE.TO_PICKUP) +
				this.vehiclePhaseCount(DETERMINISTIC_RESIDENT_VEHICLE_PHASE.TO_DROPOFF) +
				this.vehiclePhaseCount(DETERMINISTIC_RESIDENT_VEHICLE_PHASE.RETURNING_HOME),
			loadCount: this.loadCount,
			homeTrackResourceCount: this.homeTrackResourceCountValue,
			nonHomeOwnedTrackResourceCount: this.nonHomeOwnedTrackResourceCountValue,
			ownedSwitchConflictResourceCount: this.ownedSwitchConflictResourceCountValue,
			storageResourceCount: this.storageOccupiedUnits.length,
			storageOccupiedUnits,
			storageReservedUnits,
			typedByteLength: this.typedByteLength,
		});
	}

	private initializeDedicatedHomeOwnership(): number {
		let count = 0;
		const { parking } = this.snapshot;
		for (let vehicleRow = 0; vehicleRow < parking.slotCount; vehicleRow++) {
			const start = parking.footprintTrackResourceOffsets[vehicleRow] as number;
			const end = parking.footprintTrackResourceOffsets[vehicleRow + 1] as number;
			for (let offset = start; offset < end; offset++) {
				const resourceRow = parking.footprintTrackResourceRows[offset] as number;
				if (
					resourceRow >= this.trackResourceOwnerVehicleRows.length ||
					this.trackResourceOwnerVehicleRows[resourceRow] !== -1
				) {
					throw new Error("Resident runtime home footprints are invalid or overlap.");
				}
				this.trackResourceOwnerVehicleRows[resourceRow] = vehicleRow;
				count++;
			}
		}
		return count;
	}

	private releaseRequest(requestRow: number): boolean {
		if (
			this.requestPhaseCodes[requestRow] !== DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_RELEASE
		) {
			throw new Error(`Resident request row ${requestRow} was released more than once.`);
		}
		this.events.appendCore("REQUEST_RELEASED", requestRow, this.currentTime);
		if (!this.requestDependenciesCompleted(requestRow)) {
			this.transitionRequestPhase(
				requestRow,
				DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_PREDECESSOR,
			);
			return false;
		}
		return this.prepareAndTryAdmission(requestRow);
	}

	private prepareAndTryAdmission(requestRow: number): boolean {
		this.transitionRequestPhase(
			requestRow,
			DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_COMPLETE_CYCLE_LEASE,
		);
		const vehicleRow = this.snapshot.admissionProgram.requestVehicleRows[requestRow] as number;
		if (this.vehiclePhaseCodes[vehicleRow] !== DETERMINISTIC_RESIDENT_VEHICLE_PHASE.IDLE_AT_HOME) {
			throw new Error(`Resident request row ${requestRow} vehicle is not idle at home.`);
		}
		this.transitionVehiclePhase(
			vehicleRow,
			DETERMINISTIC_RESIDENT_VEHICLE_PHASE.WAITING_FOR_COMPLETE_CYCLE,
		);
		if (this.tryAcquireCompleteCycle(requestRow, vehicleRow)) return true;
		this.registerLeaseWaiter(requestRow);
		return false;
	}

	private requestDependenciesCompleted(requestRow: number): boolean {
		const loadPredecessor = this.snapshot.admissionProgram.loadPredecessorRequestRows[
			requestRow
		] as number;
		const vehiclePredecessor = this.snapshot.admissionProgram.vehiclePredecessorRequestRows[
			requestRow
		] as number;
		return (
			(loadPredecessor < 0 ||
				this.destinationServicePhaseCodes[loadPredecessor] ===
					DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.READY) &&
			(vehiclePredecessor < 0 ||
				this.requestPhaseCodes[vehiclePredecessor] ===
					DETERMINISTIC_RESIDENT_REQUEST_PHASE.COMPLETED)
		);
	}

	private tryAcquireCompleteCycle(requestRow: number, vehicleRow: number): boolean {
		const claims = this.snapshot.leaseClaims;
		const trackStart = claims.nonHomeTrackResourceOffsets[requestRow] as number;
		const trackEnd = claims.nonHomeTrackResourceOffsets[requestRow + 1] as number;
		for (let offset = trackStart; offset < trackEnd; offset++) {
			const resourceRow = claims.nonHomeTrackResourceRows[offset] as number;
			if (this.trackResourceOwnerVehicleRows[resourceRow] !== -1) return false;
		}
		const switchStart = claims.switchConflictClaimOffsets[requestRow] as number;
		const switchEnd = claims.switchConflictClaimOffsets[requestRow + 1] as number;
		for (let offset = switchStart; offset < switchEnd; offset++) {
			const resourceRow = claims.switchConflictClaimRows[offset] as number;
			if (this.switchConflictOwnerVehicleRows[resourceRow] !== -1) return false;
		}
		if (!this.canReserveDestination(requestRow)) return false;

		for (let offset = trackStart; offset < trackEnd; offset++) {
			this.trackResourceOwnerVehicleRows[claims.nonHomeTrackResourceRows[offset] as number] =
				vehicleRow;
		}
		this.nonHomeOwnedTrackResourceCountValue += trackEnd - trackStart;
		for (let offset = switchStart; offset < switchEnd; offset++) {
			this.switchConflictOwnerVehicleRows[claims.switchConflictClaimRows[offset] as number] =
				vehicleRow;
		}
		this.ownedSwitchConflictResourceCountValue += switchEnd - switchStart;
		this.reserveDestination(requestRow);
		this.leaseWaiterFlags[requestRow] = 0;
		this.vehicleCurrentRequestRows[vehicleRow] = requestRow;
		this.transitionVehiclePhase(vehicleRow, DETERMINISTIC_RESIDENT_VEHICLE_PHASE.TO_PICKUP);
		this.transitionRequestPhase(requestRow, DETERMINISTIC_RESIDENT_REQUEST_PHASE.TO_PICKUP);
		this.scheduleLeg(requestRow, 0);
		this.events.appendCore("CYCLE_ADMITTED", requestRow, this.currentTime);
		return true;
	}

	private completeScheduledLeg(requestRow: number, admissionCandidates: Set<number>): boolean {
		const completionTime = this.requestLegCompletionTimesMicroseconds[requestRow] as number;
		if (completionTime !== this.currentTime) {
			throw new Error(`Resident request row ${requestRow} leg completion time is inconsistent.`);
		}
		switch (this.requestPhaseCodes[requestRow] as number) {
			case DETERMINISTIC_RESIDENT_REQUEST_PHASE.TO_PICKUP:
				return this.completePickupLeg(requestRow);
			case DETERMINISTIC_RESIDENT_REQUEST_PHASE.TO_DROPOFF:
				this.completeDropoffLeg(requestRow);
				return false;
			case DETERMINISTIC_RESIDENT_REQUEST_PHASE.RETURNING_HOME:
				this.completeHomeReturnLeg(requestRow);
				{
					const successor = this.snapshot.admissionProgram.vehicleSuccessorRequestRows[
						requestRow
					] as number;
					if (successor >= 0) admissionCandidates.add(successor);
				}
				return true;
			default:
				throw new Error(`Resident request row ${requestRow} has no completable transport leg.`);
		}
	}

	private completePickupLeg(requestRow: number): boolean {
		const vehicleRow = this.snapshot.admissionProgram.requestVehicleRows[requestRow] as number;
		const loadRow = this.snapshot.admissionProgram.requestLoadRows[requestRow] as number;
		const sourceStationRow = this.requireStationRow(
			this.snapshot.routes.pickupPortIds[requestRow] as number,
		);
		if (
			this.vehicleCurrentRequestRows[vehicleRow] !== requestRow ||
			this.vehiclePhaseCodes[vehicleRow] !== DETERMINISTIC_RESIDENT_VEHICLE_PHASE.TO_PICKUP ||
			this.loadVehicleRows[loadRow] !== -1 ||
			this.loadStationRows[loadRow] !== sourceStationRow
		) {
			throw new Error(`Resident request row ${requestRow} cannot take load custody at pickup.`);
		}
		const sourceStorageRow = this.loadStorageResourceRows[loadRow] as number;
		let storageCapacityFreed = false;
		if (sourceStorageRow >= 0) {
			const occupied = this.storageOccupiedUnits[sourceStorageRow] as number;
			if (occupied === 0) {
				throw new Error(`Resident storage row ${sourceStorageRow} occupancy would be negative.`);
			}
			this.storageOccupiedUnits[sourceStorageRow] = occupied - 1;
			this.loadStorageResourceRows[loadRow] = -1;
			this.events.appendResource(
				"STORAGE_SOURCE_RELEASED",
				requestRow,
				sourceStorageRow,
				this.currentTime,
			);
			if (
				this.requestStorageReservationRows[requestRow] === sourceStorageRow &&
				this.requestStorageReservationUsesSourceUnit[requestRow] === 1
			) {
				this.requestStorageReservationUsesSourceUnit[requestRow] = 0;
				this.storageReservedUnits[sourceStorageRow] =
					(this.storageReservedUnits[sourceStorageRow] as number) + 1;
			} else {
				storageCapacityFreed = true;
			}
		}
		this.loadVehicleRows[loadRow] = vehicleRow;
		this.events.appendCore("LOAD_PICKED_UP", requestRow, this.currentTime);
		this.transitionRequestPhase(requestRow, DETERMINISTIC_RESIDENT_REQUEST_PHASE.TO_DROPOFF);
		this.transitionVehiclePhase(vehicleRow, DETERMINISTIC_RESIDENT_VEHICLE_PHASE.TO_DROPOFF);
		this.scheduleLeg(requestRow, 1);
		return storageCapacityFreed;
	}

	private completeDropoffLeg(requestRow: number): void {
		const vehicleRow = this.snapshot.admissionProgram.requestVehicleRows[requestRow] as number;
		const loadRow = this.snapshot.admissionProgram.requestLoadRows[requestRow] as number;
		if (
			this.vehicleCurrentRequestRows[vehicleRow] !== requestRow ||
			this.vehiclePhaseCodes[vehicleRow] !== DETERMINISTIC_RESIDENT_VEHICLE_PHASE.TO_DROPOFF ||
			this.loadVehicleRows[loadRow] !== vehicleRow
		) {
			throw new Error(`Resident request row ${requestRow} cannot release load custody at dropoff.`);
		}
		const destinationStationRow = this.requireStationRow(
			this.snapshot.routes.dropoffPortIds[requestRow] as number,
		);
		const destinationStorageRow = this.destinationStorageResourceRows[requestRow] as number;
		if (destinationStorageRow >= 0) {
			if (
				this.requestStorageReservationRows[requestRow] !== destinationStorageRow ||
				(this.storageReservedUnits[destinationStorageRow] as number) === 0
			) {
				throw new Error(
					`Resident request row ${requestRow} has no consumable storage reservation.`,
				);
			}
			this.storageReservedUnits[destinationStorageRow] =
				(this.storageReservedUnits[destinationStorageRow] as number) - 1;
			this.storageOccupiedUnits[destinationStorageRow] =
				(this.storageOccupiedUnits[destinationStorageRow] as number) + 1;
			this.requestStorageReservationRows[requestRow] = -1;
			this.requestStorageReservationUsesSourceUnit[requestRow] = 0;
			this.loadStorageResourceRows[loadRow] = destinationStorageRow;
			this.events.appendResource(
				"STORAGE_DESTINATION_OCCUPIED",
				requestRow,
				destinationStorageRow,
				this.currentTime,
			);
		}
		this.loadVehicleRows[loadRow] = -1;
		this.loadStationRows[loadRow] = destinationStationRow;
		this.events.appendCore("LOAD_DROPPED_OFF", requestRow, this.currentTime);
		this.arriveDestinationService(requestRow);
		this.transitionRequestPhase(requestRow, DETERMINISTIC_RESIDENT_REQUEST_PHASE.RETURNING_HOME);
		this.transitionVehiclePhase(vehicleRow, DETERMINISTIC_RESIDENT_VEHICLE_PHASE.RETURNING_HOME);
		this.scheduleLeg(requestRow, 2);
	}

	private completeHomeReturnLeg(requestRow: number): void {
		const vehicleRow = this.snapshot.admissionProgram.requestVehicleRows[requestRow] as number;
		const loadRow = this.snapshot.admissionProgram.requestLoadRows[requestRow] as number;
		if (
			this.vehicleCurrentRequestRows[vehicleRow] !== requestRow ||
			this.vehiclePhaseCodes[vehicleRow] !== DETERMINISTIC_RESIDENT_VEHICLE_PHASE.RETURNING_HOME ||
			this.loadVehicleRows[loadRow] !== -1
		) {
			throw new Error(`Resident request row ${requestRow} cannot complete its home return.`);
		}
		this.releaseCompleteCycle(requestRow, vehicleRow);
		this.transitionRequestPhase(requestRow, DETERMINISTIC_RESIDENT_REQUEST_PHASE.COMPLETED);
		this.completedRequestCountValue++;
		this.transitionVehiclePhase(vehicleRow, DETERMINISTIC_RESIDENT_VEHICLE_PHASE.IDLE_AT_HOME);
		this.vehicleCurrentRequestRows[vehicleRow] = -1;
		this.events.appendCore("VEHICLE_RETURNED_HOME", requestRow, this.currentTime);
	}

	private arriveDestinationService(requestRow: number): void {
		if (
			this.destinationServicePhaseCodes[requestRow] !==
			DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.NOT_ARRIVED
		) {
			throw new Error(`Resident request row ${requestRow} destination service already arrived.`);
		}
		this.destinationServiceQueuedTimesMicroseconds[requestRow] = this.currentTime;
		const eqResourceRow = this.destinationEqResourceRows[requestRow] as number;
		if (eqResourceRow >= 0) {
			this.transitionDestinationServicePhase(
				requestRow,
				DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.QUEUED,
			);
			this.eqWaitQueues.push(eqResourceRow, requestRow);
			this.events.appendResource("EQ_SERVICE_QUEUED", requestRow, eqResourceRow, this.currentTime);
			return;
		}
		this.startDestinationService(requestRow);
	}

	private startDestinationService(requestRow: number): void {
		const phase = this.destinationServicePhaseCodes[requestRow] as number;
		if (
			phase !== DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.NOT_ARRIVED &&
			phase !== DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.QUEUED
		) {
			throw new Error(`Resident request row ${requestRow} destination service cannot start.`);
		}
		const duration = this.snapshot.serviceTiming.serviceDurationMicroseconds[requestRow] as number;
		const readyAt = this.currentTime + duration;
		if (!Number.isSafeInteger(readyAt)) {
			throw new RangeError(`Resident request row ${requestRow} service completion time is unsafe.`);
		}
		this.transitionDestinationServicePhase(
			requestRow,
			DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.ACTIVE,
		);
		this.destinationServiceStartedTimesMicroseconds[requestRow] = this.currentTime;
		this.serviceCompletionHeap.push(requestRow, readyAt);
		const eqResourceRow = this.destinationEqResourceRows[requestRow] as number;
		this.events.appendResource(
			eqResourceRow >= 0 ? "EQ_SERVICE_STARTED" : "STORAGE_SERVICE_STARTED",
			requestRow,
			eqResourceRow >= 0
				? eqResourceRow
				: (this.destinationStorageResourceRows[requestRow] as number),
			this.currentTime,
		);
	}

	private completeScheduledService(requestRow: number): number {
		if (
			this.destinationServicePhaseCodes[requestRow] !==
			DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.ACTIVE
		) {
			throw new Error(`Resident request row ${requestRow} has no active service to complete.`);
		}
		const expectedReadyAt =
			(this.destinationServiceStartedTimesMicroseconds[requestRow] as number) +
			(this.snapshot.serviceTiming.serviceDurationMicroseconds[requestRow] as number);
		if (expectedReadyAt !== this.currentTime) {
			throw new Error(
				`Resident request row ${requestRow} service completion time is inconsistent.`,
			);
		}
		const eqResourceRow = this.destinationEqResourceRows[requestRow] as number;
		if (eqResourceRow >= 0) {
			const active = this.eqActiveCounts[eqResourceRow] as number;
			if (active === 0) {
				throw new Error(
					`Resident EQ resource row ${eqResourceRow} active count would be negative.`,
				);
			}
			this.eqActiveCounts[eqResourceRow] = active - 1;
		}
		this.transitionDestinationServicePhase(
			requestRow,
			DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE.READY,
		);
		this.destinationServiceReadyTimesMicroseconds[requestRow] = this.currentTime;
		this.readyDestinationServiceCountValue++;
		this.events.appendResource(
			eqResourceRow >= 0 ? "EQ_SERVICE_READY" : "STORAGE_SERVICE_READY",
			requestRow,
			eqResourceRow >= 0
				? eqResourceRow
				: (this.destinationStorageResourceRows[requestRow] as number),
			this.currentTime,
		);
		return this.snapshot.admissionProgram.loadSuccessorRequestRows[requestRow] as number;
	}

	private startEligibleEqServicesAtCurrentTime(): void {
		const configuration = this.snapshot.resourceRunConfiguration;
		for (let resourceRow = 0; resourceRow < configuration.eqResourceCount; resourceRow++) {
			const capacity = configuration.eqConcurrentCapacities[resourceRow] as number;
			while (
				(this.eqActiveCounts[resourceRow] as number) < capacity &&
				this.eqWaitQueues.peekRequestRow(resourceRow) >= 0
			) {
				const requestRow = this.eqWaitQueues.peekRequestRow(resourceRow);
				const duration = this.snapshot.serviceTiming.serviceDurationMicroseconds[
					requestRow
				] as number;
				const earliest = earliestResidentEqStart(
					configuration,
					resourceRow,
					Math.max(
						this.currentTime,
						this.destinationServiceQueuedTimesMicroseconds[requestRow] as number,
					),
					duration,
				);
				if (earliest !== this.currentTime) break;
				if (this.eqWaitQueues.popRequestRow(resourceRow) !== requestRow) {
					throw new Error("Resident EQ wait queue head changed during service start.");
				}
				this.eqActiveCounts[resourceRow] = (this.eqActiveCounts[resourceRow] as number) + 1;
				this.startDestinationService(requestRow);
			}
		}
	}

	private nextEqServiceStartTimeMicroseconds(): number {
		const configuration = this.snapshot.resourceRunConfiguration;
		let earliest = Number.POSITIVE_INFINITY;
		for (let resourceRow = 0; resourceRow < configuration.eqResourceCount; resourceRow++) {
			if (
				(this.eqActiveCounts[resourceRow] as number) >=
				(configuration.eqConcurrentCapacities[resourceRow] as number)
			) {
				continue;
			}
			const requestRow = this.eqWaitQueues.peekRequestRow(resourceRow);
			if (requestRow < 0) continue;
			const duration = this.snapshot.serviceTiming.serviceDurationMicroseconds[
				requestRow
			] as number;
			const candidate = earliestResidentEqStart(
				configuration,
				resourceRow,
				Math.max(
					this.currentTime,
					this.destinationServiceQueuedTimesMicroseconds[requestRow] as number,
				),
				duration,
			);
			if (candidate < earliest) earliest = candidate;
		}
		return earliest;
	}

	private releaseCompleteCycle(requestRow: number, vehicleRow: number): void {
		const claims = this.snapshot.leaseClaims;
		for (
			let offset = claims.nonHomeTrackResourceOffsets[requestRow] as number;
			offset < (claims.nonHomeTrackResourceOffsets[requestRow + 1] as number);
			offset++
		) {
			const resourceRow = claims.nonHomeTrackResourceRows[offset] as number;
			if (this.trackResourceOwnerVehicleRows[resourceRow] !== vehicleRow) {
				throw new Error(`Resident request row ${requestRow} lost a track resource before home.`);
			}
			this.trackResourceOwnerVehicleRows[resourceRow] = -1;
		}
		this.nonHomeOwnedTrackResourceCountValue -=
			(claims.nonHomeTrackResourceOffsets[requestRow + 1] as number) -
			(claims.nonHomeTrackResourceOffsets[requestRow] as number);
		for (
			let offset = claims.switchConflictClaimOffsets[requestRow] as number;
			offset < (claims.switchConflictClaimOffsets[requestRow + 1] as number);
			offset++
		) {
			const resourceRow = claims.switchConflictClaimRows[offset] as number;
			if (this.switchConflictOwnerVehicleRows[resourceRow] !== vehicleRow) {
				throw new Error(`Resident request row ${requestRow} lost a switch resource before home.`);
			}
			this.switchConflictOwnerVehicleRows[resourceRow] = -1;
		}
		this.ownedSwitchConflictResourceCountValue -=
			(claims.switchConflictClaimOffsets[requestRow + 1] as number) -
			(claims.switchConflictClaimOffsets[requestRow] as number);
	}

	private scheduleLeg(requestRow: number, legIndex: 0 | 1 | 2): void {
		const duration = this.legTravelDurationsMicroseconds[requestRow * 3 + legIndex] as number;
		const completionTime = this.currentTime + duration;
		if (!Number.isSafeInteger(completionTime)) {
			throw new RangeError(`Resident request row ${requestRow} leg completion time is unsafe.`);
		}
		this.requestLegStartedTimesMicroseconds[requestRow] = this.currentTime;
		this.requestLegCompletionTimesMicroseconds[requestRow] = completionTime;
		this.legCompletionHeap.push(requestRow, completionTime);
	}

	private registerLeaseWaiter(requestRow: number): void {
		if (this.leaseWaiterFlags[requestRow] === 1) return;
		if (this.leaseWaiterWriteCursor >= this.leaseWaiterRows.length) {
			this.compactLeaseWaiters();
		}
		if (this.leaseWaiterWriteCursor >= this.leaseWaiterRows.length) {
			throw new Error("Resident complete-cycle waiter queue exceeded request capacity.");
		}
		this.leaseWaiterFlags[requestRow] = 1;
		this.leaseWaiterRows[this.leaseWaiterWriteCursor++] = requestRow;
	}

	private retryAdmissions(
		predecessorCandidates: ReadonlySet<number>,
		resourceFreed: boolean,
	): number {
		if (predecessorCandidates.size === 0 && !resourceFreed) return 0;
		const candidates = new Set(predecessorCandidates);
		if (resourceFreed) {
			for (let index = 0; index < this.leaseWaiterWriteCursor; index++) {
				const requestRow = this.leaseWaiterRows[index] as number;
				if (this.leaseWaiterFlags[requestRow] === 1) candidates.add(requestRow);
			}
		}
		let launched = 0;
		for (const requestRow of [...candidates].sort(compareNumbers)) {
			if (requestRow >= this.releaseCursor) continue;
			const phase = this.requestPhaseCodes[requestRow] as number;
			if (phase === DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_PREDECESSOR) {
				if (
					this.requestDependenciesCompleted(requestRow) &&
					this.prepareAndTryAdmission(requestRow)
				) {
					launched++;
				}
			} else if (phase === DETERMINISTIC_RESIDENT_REQUEST_PHASE.WAITING_COMPLETE_CYCLE_LEASE) {
				const vehicleRow = this.snapshot.admissionProgram.requestVehicleRows[requestRow] as number;
				if (this.tryAcquireCompleteCycle(requestRow, vehicleRow)) {
					launched++;
				} else {
					this.registerLeaseWaiter(requestRow);
				}
			}
		}
		if (resourceFreed) this.compactLeaseWaiters();
		return launched;
	}

	private compactLeaseWaiters(): void {
		let writeCursor = 0;
		for (let index = 0; index < this.leaseWaiterWriteCursor; index++) {
			const requestRow = this.leaseWaiterRows[index] as number;
			if (this.leaseWaiterFlags[requestRow] === 1) {
				this.leaseWaiterRows[writeCursor++] = requestRow;
			}
		}
		this.leaseWaiterWriteCursor = writeCursor;
	}

	private requireStationRow(portId: number): number {
		const stationRow = this.stationRowByPortId.get(portId);
		if (stationRow === undefined) {
			throw new Error(`Resident runtime port ${portId} has no station row.`);
		}
		return stationRow;
	}

	private canReserveDestination(requestRow: number): boolean {
		const resourceRow = this.destinationStorageResourceRows[requestRow] as number;
		if (resourceRow < 0) return true;
		const loadRow = this.snapshot.admissionProgram.requestLoadRows[requestRow] as number;
		const reusesSourceUnit = this.loadStorageResourceRows[loadRow] === resourceRow;
		const projected =
			(this.storageOccupiedUnits[resourceRow] as number) +
			(this.storageReservedUnits[resourceRow] as number) +
			(reusesSourceUnit ? 0 : 1);
		const configuration = this.snapshot.resourceRunConfiguration;
		return (
			projected <= (configuration.storageCapacityUnits[resourceRow] as number) &&
			projected <= (configuration.storageHighWaterMarkUnits[resourceRow] as number)
		);
	}

	private reserveDestination(requestRow: number): void {
		const resourceRow = this.destinationStorageResourceRows[requestRow] as number;
		if (resourceRow < 0) return;
		const loadRow = this.snapshot.admissionProgram.requestLoadRows[requestRow] as number;
		this.requestStorageReservationRows[requestRow] = resourceRow;
		this.events.appendResource(
			"STORAGE_DESTINATION_RESERVED",
			requestRow,
			resourceRow,
			this.currentTime,
		);
		if (this.loadStorageResourceRows[loadRow] === resourceRow) {
			this.requestStorageReservationUsesSourceUnit[requestRow] = 1;
			return;
		}
		this.storageReservedUnits[resourceRow] = (this.storageReservedUnits[resourceRow] as number) + 1;
	}

	private ownedViews(): readonly ArrayBufferView[] {
		return [
			this.requestPhaseCodes,
			this.requestPhaseCounts,
			this.vehiclePhaseCodes,
			this.vehiclePhaseCounts,
			this.vehicleCurrentRequestRows,
			this.loadStationRows,
			this.loadVehicleRows,
			this.loadStorageResourceRows,
			this.destinationStorageResourceRows,
			this.requestStorageReservationRows,
			this.requestStorageReservationUsesSourceUnit,
			this.destinationServicePhaseCodes,
			this.destinationServicePhaseCounts,
			this.destinationServiceQueuedTimesMicroseconds,
			this.destinationServiceStartedTimesMicroseconds,
			this.destinationServiceReadyTimesMicroseconds,
			this.destinationEqResourceRows,
			this.eqActiveCounts,
			...this.eqWaitQueues.ownedViews,
			...this.serviceCompletionHeap.ownedViews,
			this.legTravelDurationsMicroseconds,
			this.requestLegStartedTimesMicroseconds,
			this.requestLegCompletionTimesMicroseconds,
			...this.legCompletionHeap.ownedViews,
			this.leaseWaiterRows,
			this.leaseWaiterFlags,
			this.trackResourceOwnerVehicleRows,
			this.switchConflictOwnerVehicleRows,
			this.storageOccupiedUnits,
			this.storageReservedUnits,
			...this.events.ownedViews,
		];
	}

	private transitionRequestPhase(requestRow: number, nextPhase: number): void {
		transitionCountedCode(
			this.requestPhaseCodes,
			this.requestPhaseCounts,
			requestRow,
			nextPhase,
			"request",
		);
	}

	private transitionVehiclePhase(vehicleRow: number, nextPhase: number): void {
		transitionCountedCode(
			this.vehiclePhaseCodes,
			this.vehiclePhaseCounts,
			vehicleRow,
			nextPhase,
			"vehicle",
		);
	}

	private transitionDestinationServicePhase(requestRow: number, nextPhase: number): void {
		transitionCountedCode(
			this.destinationServicePhaseCodes,
			this.destinationServicePhaseCounts,
			requestRow,
			nextPhase,
			"destination service",
		);
	}

	private requestPhaseCount(phase: number): number {
		return this.requestPhaseCounts[phase] as number;
	}

	private vehiclePhaseCount(phase: number): number {
		return this.vehiclePhaseCounts[phase] as number;
	}

	private destinationServicePhaseCount(phase: number): number {
		return this.destinationServicePhaseCounts[phase] as number;
	}

	private assertRuntimeActive(): void {
		if (this.disposalReasonValue !== null) {
			throw new Error(`Resident runtime is disposed (${this.disposalReasonValue}).`);
		}
	}

	private assertRequestRow(requestRow: number): void {
		assertRow(requestRow, this.requestCount, "request");
	}

	private assertVehicleRow(vehicleRow: number): void {
		assertRow(vehicleRow, this.vehicleCount, "vehicle");
	}

	private assertLoadRow(loadRow: number): void {
		assertRow(loadRow, this.loadCount, "load");
	}
}

export function adoptDeterministicResidentRuntimeState(
	authorization: SimulationResidentRunAuthorization,
	snapshot: PublishedSimulationResidentReadinessSnapshot,
	adoption: SimulationResidentRunAuthorizationAdoption,
): DeterministicResidentRuntimeState {
	if (!consumeSimulationResidentRunAuthorizationAdoption(adoption, authorization, snapshot)) {
		throw new Error("Resident runtime adoption proof is stale, copied, reused, or mismatched.");
	}
	return new DeterministicResidentRuntimeState(
		RESIDENT_RUNTIME_CONSTRUCTION,
		authorization,
		snapshot,
	);
}

function assertRuntimeSources(
	authorization: SimulationResidentRunAuthorization,
	snapshot: PublishedSimulationResidentReadinessSnapshot,
): void {
	const authorizationError = simulationResidentRunAuthorizationError(authorization);
	if (authorizationError) {
		throw new Error(`Resident runtime authorization is invalid: ${authorizationError}`);
	}
	if (
		authorization.sourceCertificateFingerprint !== snapshot.certificate.fingerprint ||
		authorization.sourceFoundationFingerprint !== snapshot.foundation.fingerprint ||
		authorization.sourceParkingConfigurationFingerprint !== snapshot.parking.fingerprint ||
		authorization.sourceManifestFingerprint !== snapshot.manifest.fingerprint ||
		authorization.sourceRoutesFingerprint !== snapshot.routes.fingerprint ||
		authorization.sourceLeaseClaimsFingerprint !== snapshot.leaseClaims.fingerprint ||
		authorization.sourceAdmissionProgramFingerprint !== snapshot.admissionProgram.fingerprint ||
		authorization.sourceServiceTimingFingerprint !== snapshot.serviceTiming.fingerprint ||
		authorization.sourceResourceRunConfigurationFingerprint !==
			snapshot.resourceRunConfiguration.fingerprint ||
		authorization.requestCount !== snapshot.routes.requestCount ||
		authorization.loadCount !== snapshot.admissionProgram.loadCount ||
		authorization.vehicleCount !== snapshot.parking.slotCount ||
		authorization.eqResourceCount !== snapshot.resourceRunConfiguration.eqResourceCount ||
		authorization.storageResourceCount !== snapshot.resourceRunConfiguration.storageResourceCount
	) {
		throw new Error("Resident runtime sources do not match the consumed authorization.");
	}
	for (let requestRow = 1; requestRow < snapshot.routes.requestCount; requestRow++) {
		if (
			(snapshot.routes.requestedAtMicroseconds[requestRow] as number) <
			(snapshot.routes.requestedAtMicroseconds[requestRow - 1] as number)
		) {
			throw new Error("Resident runtime release times are not canonical and monotonic.");
		}
	}
}

function assertRuntimeMemoryLimit(snapshot: PublishedSimulationResidentReadinessSnapshot): void {
	const bytes =
		snapshot.routes.requestCount *
			(Uint8Array.BYTES_PER_ELEMENT * 4 +
				Int32Array.BYTES_PER_ELEMENT * 3 +
				Float64Array.BYTES_PER_ELEMENT * 10 +
				Uint32Array.BYTES_PER_ELEMENT * 4) +
		snapshot.routes.requestCount *
			(5 *
				(Float64Array.BYTES_PER_ELEMENT +
					Uint8Array.BYTES_PER_ELEMENT +
					Uint32Array.BYTES_PER_ELEMENT) +
				6 *
					(Float64Array.BYTES_PER_ELEMENT +
						Uint8Array.BYTES_PER_ELEMENT +
						Uint32Array.BYTES_PER_ELEMENT * 2)) +
		snapshot.parking.slotCount * (Uint8Array.BYTES_PER_ELEMENT + Int32Array.BYTES_PER_ELEMENT) +
		snapshot.admissionProgram.loadCount * Int32Array.BYTES_PER_ELEMENT * 3 +
		snapshot.trackResources.trackResourceCount * Int32Array.BYTES_PER_ELEMENT +
		snapshot.trackResources.switchConflictResourceCount * Int32Array.BYTES_PER_ELEMENT +
		(snapshot.resourceRunConfiguration.eqResourceCount * 3 + 1) * Uint32Array.BYTES_PER_ELEMENT +
		snapshot.resourceRunConfiguration.storageResourceCount * Uint32Array.BYTES_PER_ELEMENT * 2;
	const bytesWithPhaseCounters = bytes + (7 + 5 + 4) * Uint32Array.BYTES_PER_ELEMENT;
	if (
		!Number.isSafeInteger(bytesWithPhaseCounters) ||
		bytesWithPhaseCounters > DETERMINISTIC_RESIDENT_RUNTIME_STATE_MAX_TYPED_BYTES
	) {
		throw new RangeError("Resident runtime state exceeds its typed-memory limit.");
	}
}

function compileDestinationStorageResourceRows(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
): Int32Array {
	const configuration = snapshot.resourceRunConfiguration;
	const rowByGroupId = new Map<number, number>();
	for (let row = 0; row < configuration.storageResourceCount; row++) {
		rowByGroupId.set(configuration.storageEquipmentGroupIds[row] as number, row);
	}
	const rows = new Int32Array(snapshot.routes.requestCount).fill(-1);
	for (let requestRow = 0; requestRow < snapshot.routes.requestCount; requestRow++) {
		const kind = snapshot.serviceTiming.serviceKindCodes[requestRow] as number;
		const groupId = snapshot.serviceTiming.destinationEquipmentGroupIds[requestRow] as number;
		const resourceRow = rowByGroupId.get(groupId);
		if (kind === SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS) {
			if (resourceRow !== undefined) {
				throw new Error("Resident EQ destination unexpectedly resolves to a storage resource.");
			}
			continue;
		}
		if (resourceRow === undefined) {
			throw new Error("Resident storage destination has no exact runtime resource row.");
		}
		rows[requestRow] = resourceRow;
	}
	return rows;
}

function compileDestinationEqResourceRows(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
): Int32Array {
	const configuration = snapshot.resourceRunConfiguration;
	const rowByGroupId = new Map<number, number>();
	for (let row = 0; row < configuration.eqResourceCount; row++) {
		rowByGroupId.set(configuration.eqEquipmentGroupIds[row] as number, row);
	}
	const rows = new Int32Array(snapshot.routes.requestCount).fill(-1);
	for (let requestRow = 0; requestRow < snapshot.routes.requestCount; requestRow++) {
		if (
			snapshot.serviceTiming.serviceKindCodes[requestRow] !==
			SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS
		) {
			continue;
		}
		const groupId = snapshot.serviceTiming.destinationEquipmentGroupIds[requestRow] as number;
		const resourceRow = rowByGroupId.get(groupId);
		if (resourceRow === undefined) {
			throw new Error("Resident EQ destination has no exact runtime resource row.");
		}
		rows[requestRow] = resourceRow;
	}
	return rows;
}

function compileStationRowByPortId(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
): ReadonlyMap<number, number> {
	const rows = new Map<number, number>();
	for (let stationRow = 0; stationRow < snapshot.foundation.stations.count; stationRow++) {
		rows.set(snapshot.foundation.stations.ids[stationRow] as number, stationRow);
	}
	return rows;
}

function compileResidentLegTravelDurations(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
): Float64Array {
	const maximumSpeedMillimetersPerSecond =
		snapshot.occupancyPolicy.maximumSpeedMillimetersPerSecond;
	if (
		!Number.isSafeInteger(maximumSpeedMillimetersPerSecond) ||
		maximumSpeedMillimetersPerSecond <= 0
	) {
		throw new Error("Resident certified maximum vehicle speed is invalid.");
	}
	const durations = new Float64Array(snapshot.routes.requestCount * 3);
	for (let legRow = 0; legRow < durations.length; legRow++) {
		const distanceMicrometers = Math.ceil(
			(snapshot.routes.legDistancesMeters[legRow] as number) * 1_000_000,
		);
		const durationMicroseconds = Math.ceil(
			(distanceMicrometers * 1_000) / maximumSpeedMillimetersPerSecond,
		);
		if (!Number.isSafeInteger(durationMicroseconds) || durationMicroseconds <= 0) {
			throw new RangeError(`Resident leg row ${legRow} travel duration is invalid.`);
		}
		durations[legRow] = durationMicroseconds;
	}
	return durations;
}

function requestPhaseName(code: number): DeterministicResidentRequestPhaseName {
	return codeName(DETERMINISTIC_RESIDENT_REQUEST_PHASE, code, "resident request phase");
}

function requestLegIndex(code: number): 0 | 1 | 2 | null {
	if (code === DETERMINISTIC_RESIDENT_REQUEST_PHASE.TO_PICKUP) return 0;
	if (code === DETERMINISTIC_RESIDENT_REQUEST_PHASE.TO_DROPOFF) return 1;
	if (code === DETERMINISTIC_RESIDENT_REQUEST_PHASE.RETURNING_HOME) return 2;
	return null;
}

function requestLegDistances(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
	requestRow: number,
): [number, number, number] {
	const start = requestRow * 3;
	return [
		snapshot.routes.legDistancesMeters[start] as number,
		snapshot.routes.legDistancesMeters[start + 1] as number,
		snapshot.routes.legDistancesMeters[start + 2] as number,
	];
}

function vehiclePhaseName(code: number): DeterministicResidentVehiclePhaseName {
	return codeName(DETERMINISTIC_RESIDENT_VEHICLE_PHASE, code, "resident vehicle phase");
}

function destinationServicePhaseName(
	code: number,
): DeterministicResidentDestinationServicePhaseName {
	return codeName(
		DETERMINISTIC_RESIDENT_DESTINATION_SERVICE_PHASE,
		code,
		"resident destination service phase",
	);
}

function codeName<T extends Record<string, number>>(
	values: T,
	code: number,
	label: string,
): keyof T {
	for (const [name, value] of Object.entries(values)) {
		if (value === code) return name;
	}
	throw new Error(`Unknown ${label} code ${code}.`);
}

function assertRow(row: number, count: number, label: string): void {
	if (!Number.isInteger(row) || row < 0 || row >= count) {
		throw new RangeError(`Resident runtime ${label} row ${row} is outside ${count} rows.`);
	}
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((sum, view) => sum + view.byteLength, 0);
}

function transitionCountedCode(
	codes: Uint8Array,
	counts: Uint32Array,
	row: number,
	nextCode: number,
	label: string,
): void {
	const currentCode = codes[row] as number;
	if (currentCode === nextCode) {
		throw new Error(`Resident ${label} row ${row} repeated phase ${nextCode}.`);
	}
	const currentCount = counts[currentCode] as number;
	if (currentCount === 0 || nextCode < 0 || nextCode >= counts.length) {
		throw new Error(`Resident ${label} phase accounting is inconsistent.`);
	}
	counts[currentCode] = currentCount - 1;
	counts[nextCode] = (counts[nextCode] as number) + 1;
	codes[row] = nextCode;
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

function filledFloat64(length: number, value: number): Float64Array {
	return new Float64Array(length).fill(value);
}

function earliestResidentEqStart(
	configuration: PublishedSimulationResidentReadinessSnapshot["resourceRunConfiguration"],
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
	const startOffset = configuration.eqAvailabilityWindowOffsets[resourceRow] as number;
	const endOffset = configuration.eqAvailabilityWindowOffsets[resourceRow + 1] as number;
	for (let offset = startOffset; offset < endOffset; offset++) {
		const start = configuration.eqAvailabilityWindowStartsMicroseconds[offset] as number;
		const end = configuration.eqAvailabilityWindowEndsMicroseconds[offset] as number;
		const candidate = Math.max(earliestMicroseconds, start);
		if (
			Number.isSafeInteger(candidate + durationMicroseconds) &&
			candidate + durationMicroseconds <= end
		) {
			return candidate;
		}
	}
	return Number.POSITIVE_INFINITY;
}

class ResidentEqWaitQueues {
	private readonly offsets: Uint32Array;
	private readonly requestRows: Uint32Array;
	private readonly sizes: Uint32Array;
	private readonly queuedTimesMicroseconds: Float64Array;

	constructor(
		destinationEqResourceRows: Int32Array,
		resourceCount: number,
		queuedTimesMicroseconds: Float64Array,
	) {
		this.offsets = new Uint32Array(resourceCount + 1);
		for (const resourceRow of destinationEqResourceRows) {
			if (resourceRow >= 0) this.offsets[resourceRow + 1]++;
		}
		for (let resourceRow = 0; resourceRow < resourceCount; resourceRow++) {
			this.offsets[resourceRow + 1] =
				(this.offsets[resourceRow + 1] as number) + (this.offsets[resourceRow] as number);
		}
		this.requestRows = new Uint32Array(destinationEqResourceRows.length);
		this.sizes = new Uint32Array(resourceCount);
		this.queuedTimesMicroseconds = queuedTimesMicroseconds;
	}

	get ownedViews(): readonly ArrayBufferView[] {
		return [this.offsets, this.requestRows, this.sizes];
	}

	peekRequestRow(resourceRow: number): number {
		return (this.sizes[resourceRow] as number) === 0
			? -1
			: (this.requestRows[this.offsets[resourceRow] as number] as number);
	}

	push(resourceRow: number, requestRow: number): void {
		const start = this.offsets[resourceRow] as number;
		const capacity = (this.offsets[resourceRow + 1] as number) - start;
		const size = this.sizes[resourceRow] as number;
		if (size >= capacity) {
			throw new Error(`Resident EQ resource row ${resourceRow} wait queue exceeded capacity.`);
		}
		let localIndex = size;
		this.sizes[resourceRow] = size + 1;
		while (localIndex > 0) {
			const parent = Math.floor((localIndex - 1) / 2);
			const parentRow = this.requestRows[start + parent] as number;
			if (this.compare(parentRow, requestRow) <= 0) break;
			this.requestRows[start + localIndex] = parentRow;
			localIndex = parent;
		}
		this.requestRows[start + localIndex] = requestRow;
	}

	popRequestRow(resourceRow: number): number {
		const start = this.offsets[resourceRow] as number;
		const size = this.sizes[resourceRow] as number;
		if (size === 0) return -1;
		const first = this.requestRows[start] as number;
		const nextSize = size - 1;
		this.sizes[resourceRow] = nextSize;
		if (nextSize === 0) return first;
		const last = this.requestRows[start + nextSize] as number;
		let localIndex = 0;
		while (true) {
			const left = localIndex * 2 + 1;
			if (left >= nextSize) break;
			const right = left + 1;
			let child = left;
			if (
				right < nextSize &&
				this.compare(
					this.requestRows[start + right] as number,
					this.requestRows[start + left] as number,
				) < 0
			) {
				child = right;
			}
			const childRow = this.requestRows[start + child] as number;
			if (this.compare(childRow, last) >= 0) break;
			this.requestRows[start + localIndex] = childRow;
			localIndex = child;
		}
		this.requestRows[start + localIndex] = last;
		return first;
	}

	private compare(leftRequestRow: number, rightRequestRow: number): number {
		return (
			(this.queuedTimesMicroseconds[leftRequestRow] as number) -
				(this.queuedTimesMicroseconds[rightRequestRow] as number) ||
			leftRequestRow - rightRequestRow
		);
	}
}

class ResidentTimedRequestHeap {
	private readonly requestRows: Uint32Array;
	private readonly timesMicroseconds: Float64Array;
	private size = 0;

	constructor(capacity: number) {
		this.requestRows = new Uint32Array(capacity);
		this.timesMicroseconds = new Float64Array(capacity);
	}

	get ownedViews(): readonly ArrayBufferView[] {
		return [this.requestRows, this.timesMicroseconds];
	}

	get peekTimeMicroseconds(): number {
		return this.size === 0 ? Number.POSITIVE_INFINITY : (this.timesMicroseconds[0] as number);
	}

	push(requestRow: number, timeMicroseconds: number): void {
		if (this.size >= this.requestRows.length) {
			throw new Error("Resident leg completion heap exceeded its fixed request capacity.");
		}
		let index = this.size++;
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (
				compareResidentLegCompletions(
					this.timesMicroseconds[parent] as number,
					this.requestRows[parent] as number,
					timeMicroseconds,
					requestRow,
				) <= 0
			) {
				break;
			}
			this.timesMicroseconds[index] = this.timesMicroseconds[parent] as number;
			this.requestRows[index] = this.requestRows[parent] as number;
			index = parent;
		}
		this.timesMicroseconds[index] = timeMicroseconds;
		this.requestRows[index] = requestRow;
	}

	popRequestRow(): number {
		if (this.size === 0) throw new Error("Resident leg completion heap is empty.");
		const firstRequestRow = this.requestRows[0] as number;
		this.size--;
		if (this.size === 0) return firstRequestRow;
		const lastTime = this.timesMicroseconds[this.size] as number;
		const lastRequestRow = this.requestRows[this.size] as number;
		let index = 0;
		while (true) {
			const left = index * 2 + 1;
			if (left >= this.size) break;
			const right = left + 1;
			let child = left;
			if (
				right < this.size &&
				compareResidentLegCompletions(
					this.timesMicroseconds[right] as number,
					this.requestRows[right] as number,
					this.timesMicroseconds[left] as number,
					this.requestRows[left] as number,
				) < 0
			) {
				child = right;
			}
			if (
				compareResidentLegCompletions(
					this.timesMicroseconds[child] as number,
					this.requestRows[child] as number,
					lastTime,
					lastRequestRow,
				) >= 0
			) {
				break;
			}
			this.timesMicroseconds[index] = this.timesMicroseconds[child] as number;
			this.requestRows[index] = this.requestRows[child] as number;
			index = child;
		}
		this.timesMicroseconds[index] = lastTime;
		this.requestRows[index] = lastRequestRow;
		return firstRequestRow;
	}
}

function compareResidentLegCompletions(
	leftTime: number,
	leftRequestRow: number,
	rightTime: number,
	rightRequestRow: number,
): number {
	return leftTime - rightTime || leftRequestRow - rightRequestRow;
}
