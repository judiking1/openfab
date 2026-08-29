import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "../compile/SimulationReadinessCertificate";
import {
	type SimulationScenarioAdmissionProgram,
	simulationScenarioAdmissionProgramMatchesSources,
} from "../compile/SimulationScenarioAdmissionProgram";
import {
	type SimulationScenarioLeaseClaims,
	simulationScenarioLeaseClaimsMatchSources,
} from "../compile/SimulationScenarioLeaseClaims";
import {
	type SimulationScenarioManifest,
	simulationScenarioManifestError,
} from "../compile/SimulationScenarioManifest";
import {
	type SimulationScenarioRouteRequests,
	simulationScenarioRouteRequestsMatchSources,
} from "../compile/SimulationScenarioRouteRequests";
import {
	type DeterministicScenarioPreparedSources,
	deterministicScenarioPreparedSourcesMatch,
} from "./DeterministicScenarioPreparedSources";

export const DETERMINISTIC_SCENARIO_REQUEST_PHASE = Object.freeze({
	WAITING_RELEASE: 0,
	WAITING_DEPENDENCY: 1,
	WAITING_LEASE: 2,
	ADMITTED: 3,
	IN_TRANSIT: 4,
	COMPLETED: 5,
} as const);

export type DeterministicScenarioRequestPhaseName =
	keyof typeof DETERMINISTIC_SCENARIO_REQUEST_PHASE;

export const DETERMINISTIC_SCENARIO_EVENT_TYPE = Object.freeze({
	VEHICLE_TOKEN_ADMITTED: 0,
	FOUP_PICKED_UP: 1,
	TRANSFER_COMPLETED: 2,
	DESTINATION_SERVICE_STARTED: 3,
	DESTINATION_SERVICE_READY: 4,
} as const);

export type DeterministicScenarioEventTypeName = keyof typeof DETERMINISTIC_SCENARIO_EVENT_TYPE;

export const DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE = Object.freeze({
	NOT_STARTED: 0,
	IN_SERVICE: 1,
	READY: 2,
} as const);
export type DeterministicScenarioDestinationServicePhaseName =
	keyof typeof DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE;

export interface DeterministicScenarioEvent {
	readonly sequence: number;
	readonly timeMicroseconds: number;
	readonly type: DeterministicScenarioEventTypeName;
	readonly requestRow: number;
	readonly vehicleTokenId: number;
	readonly loadRow: number;
}

export interface DeterministicScenarioRequestState {
	readonly requestRow: number;
	readonly phase: DeterministicScenarioRequestPhaseName;
	readonly requestedAtMicroseconds: number;
	readonly sourceStationRow: number;
	readonly destinationStationRow: number;
	readonly loadRow: number;
	readonly activeVehicleTokenId: number | null;
}

export interface DeterministicScenarioDestinationServiceState {
	readonly requestRow: number;
	readonly phase: DeterministicScenarioDestinationServicePhaseName;
	readonly startedAtMicroseconds: number | null;
	readonly readyAtMicroseconds: number | null;
}

export type DeterministicScenarioLoadCustody =
	| Readonly<{ kind: "STATION"; stationRow: number }>
	| Readonly<{ kind: "VEHICLE_TOKEN"; vehicleTokenId: number }>;

/**
 * Run-local resource hooks joined to route admission and custody mutations. Implementations must
 * fail before mutating when a transition is invalid.
 */
export interface DeterministicScenarioAdmissionResourceGate {
	canReserveDestinationForAdmission(requestRow: number): boolean;
	destinationReservationBlocked?(requestRow: number): void;
	reserveDestinationForAdmission(requestRow: number, timeMicroseconds: number): boolean;
	confirmSourcePickup(requestRow: number, timeMicroseconds: number): readonly number[];
	confirmDestinationArrival(requestRow: number, timeMicroseconds: number): void;
}

interface ResourceWaiterHeaps {
	readonly offsets: Uint32Array;
	readonly requestRows: Uint32Array;
	readonly sizes: Uint32Array;
}

interface ScheduledServiceReady {
	readonly requestRow: number;
	readonly timeMicroseconds: number;
}

/**
 * Renderer-independent admission and custody state for the unlaunched-token readiness profile.
 * Motion is external: callers must explicitly confirm pickup and terminal completion in time order.
 */
export class DeterministicScenarioAdmissionCore {
	private readonly routes: SimulationScenarioRouteRequests;
	private readonly claims: SimulationScenarioLeaseClaims;
	private readonly program: SimulationScenarioAdmissionProgram;
	private readonly requestPhases: Uint8Array;
	private readonly requestPhaseCounts = new Uint32Array(6);
	private readonly activeVehicleTokenIds: Uint32Array;
	private readonly loadStationRows: Int32Array;
	private readonly loadVehicleTokenIds: Uint32Array;
	private readonly trackResourceOwnerRows: Int32Array;
	private readonly switchConflictOwnerRows: Int32Array;
	private readonly trackWaiters: ResourceWaiterHeaps;
	private readonly switchWaiters: ResourceWaiterHeaps;
	private readonly eventTimesMicroseconds: Float64Array;
	private readonly eventTypeCodes: Uint8Array;
	private readonly eventRequestRows: Uint32Array;
	private readonly destinationServicePhaseCodes: Uint8Array;
	private readonly destinationServicePhaseCounts = new Uint32Array(3);
	private readonly destinationServiceStartedTimesMicroseconds: Float64Array;
	private readonly destinationServiceReadyTimesMicroseconds: Float64Array;
	private readonly serviceReadyHeap = new ServiceReadyHeap();
	private readonly resourceGate: DeterministicScenarioAdmissionResourceGate | null;
	private releaseCursor = 0;
	private currentTime = 0;
	private eventsWritten = 0;
	private completedRequests = 0;
	private readyDestinationServices = 0;

	constructor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		routes: SimulationScenarioRouteRequests,
		claims: SimulationScenarioLeaseClaims,
		program: SimulationScenarioAdmissionProgram,
		resourceGate?: DeterministicScenarioAdmissionResourceGate,
		preparedSources?: DeterministicScenarioPreparedSources,
	) {
		if (
			!preparedSources ||
			!deterministicScenarioPreparedSourcesMatch(preparedSources, {
				snapshot,
				manifest,
				routes,
				leaseClaims: claims,
				admissionProgram: program,
			})
		) {
			assertCompatibleSources(snapshot, manifest, routes, claims, program);
		}
		this.routes = routes;
		this.claims = claims;
		this.program = program;
		this.resourceGate = resourceGate ?? null;
		this.requestPhases = new Uint8Array(program.requestCount);
		this.requestPhases.fill(DETERMINISTIC_SCENARIO_REQUEST_PHASE.WAITING_RELEASE);
		this.requestPhaseCounts[DETERMINISTIC_SCENARIO_REQUEST_PHASE.WAITING_RELEASE] =
			program.requestCount;
		this.activeVehicleTokenIds = new Uint32Array(program.requestCount);
		this.loadStationRows = Int32Array.from(program.initialCustodyStationRows);
		this.loadVehicleTokenIds = new Uint32Array(program.loadCount);
		this.trackResourceOwnerRows = new Int32Array(snapshot.trackResources.trackResourceCount).fill(
			-1,
		);
		this.switchConflictOwnerRows = new Int32Array(
			snapshot.trackResources.switchConflictResourceCount,
		).fill(-1);
		this.trackWaiters = compileResourceWaiterHeaps(
			snapshot.trackResources.trackResourceCount,
			claims.leaseTrackResourceRows,
		);
		this.switchWaiters = compileResourceWaiterHeaps(
			snapshot.trackResources.switchConflictResourceCount,
			claims.switchConflictClaimRows,
		);
		const eventCapacity = program.requestCount * 5;
		this.eventTimesMicroseconds = new Float64Array(eventCapacity);
		this.eventTypeCodes = new Uint8Array(eventCapacity);
		this.eventRequestRows = new Uint32Array(eventCapacity);
		this.destinationServicePhaseCodes = new Uint8Array(program.requestCount);
		this.destinationServicePhaseCounts[
			DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE.NOT_STARTED
		] = program.requestCount;
		this.destinationServiceStartedTimesMicroseconds = new Float64Array(program.requestCount);
		this.destinationServiceStartedTimesMicroseconds.fill(-1);
		this.destinationServiceReadyTimesMicroseconds = new Float64Array(program.requestCount);
		this.destinationServiceReadyTimesMicroseconds.fill(-1);
	}

	get currentTimeMicroseconds(): number {
		return this.currentTime;
	}

	get eventCount(): number {
		return this.eventsWritten;
	}

	get completedRequestCount(): number {
		return this.completedRequests;
	}

	get allRequestsCompleted(): boolean {
		return this.completedRequests === this.program.requestCount;
	}

	get allDestinationServicesReady(): boolean {
		return this.readyDestinationServices === this.program.requestCount;
	}

	get nextScheduledTransitionTimeMicroseconds(): number {
		return Math.min(this.nextReleaseTime(), this.nextServiceReadyTime());
	}

	requestPhaseCount(phase: DeterministicScenarioRequestPhaseName): number {
		return this.requestPhaseCounts[DETERMINISTIC_SCENARIO_REQUEST_PHASE[phase]] as number;
	}

	destinationServicePhaseCount(phase: DeterministicScenarioDestinationServicePhaseName): number {
		return this.destinationServicePhaseCounts[
			DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE[phase]
		] as number;
	}

	requestIsInTransit(requestRow: number): boolean {
		this.assertRequestRow(requestRow);
		return this.requestPhases[requestRow] === DETERMINISTIC_SCENARIO_REQUEST_PHASE.IN_TRANSIT;
	}

	advanceToTimeMicroseconds(targetTimeMicroseconds: number): number {
		assertMonotonicTime(targetTimeMicroseconds, this.currentTime);
		const eventStart = this.eventsWritten;
		while (this.nextScheduledTransitionTimeMicroseconds <= targetTimeMicroseconds) {
			const transitionTime = this.nextScheduledTransitionTimeMicroseconds;
			this.currentTime = transitionTime;
			this.releaseRequestsAtTime(transitionTime);
			this.completeDestinationServicesAtTime(transitionTime);
		}
		this.currentTime = targetTimeMicroseconds;
		return this.eventsWritten - eventStart;
	}

	confirmPickup(requestRow: number, atTimeMicroseconds: number): DeterministicScenarioEvent {
		this.assertRequestRow(requestRow);
		this.advanceToTimeMicroseconds(atTimeMicroseconds);
		if (this.requestPhases[requestRow] !== DETERMINISTIC_SCENARIO_REQUEST_PHASE.ADMITTED) {
			throw new Error(
				`Scenario request row ${requestRow} has no admitted vehicle token to pick up.`,
			);
		}
		const loadRow = this.program.requestLoadRows[requestRow] as number;
		const sourceStationRow = this.routes.sourceStationRows[requestRow] as number;
		const tokenId = this.activeVehicleTokenIds[requestRow] as number;
		if (
			tokenId !== this.program.requestVehicleTokenIds[requestRow] ||
			this.loadStationRows[loadRow] !== sourceStationRow ||
			this.loadVehicleTokenIds[loadRow] !== 0
		) {
			throw new Error(`Scenario request row ${requestRow} cannot take FOUP custody at its source.`);
		}
		const resourceCandidates =
			this.resourceGate?.confirmSourcePickup(requestRow, atTimeMicroseconds) ?? [];
		this.loadStationRows[loadRow] = -1;
		this.loadVehicleTokenIds[loadRow] = tokenId;
		this.transitionRequestPhase(requestRow, DETERMINISTIC_SCENARIO_REQUEST_PHASE.IN_TRANSIT);
		const event = this.appendEvent("FOUP_PICKED_UP", requestRow);
		this.tryAdmissionCandidates(resourceCandidates);
		return event;
	}

	completeTransfer(
		requestRow: number,
		atTimeMicroseconds: number,
		destinationServiceDurationMicroseconds?: number,
	): DeterministicScenarioEvent {
		if (this.resourceGate) {
			throw new Error(
				"Resource-gated scenario transfers require deferred destination-service completion.",
			);
		}
		return this.completeTransferInternal(
			requestRow,
			atTimeMicroseconds,
			destinationServiceDurationMicroseconds,
			false,
		);
	}

	completeTransferWithDeferredDestinationService(
		requestRow: number,
		atTimeMicroseconds: number,
	): DeterministicScenarioEvent {
		if (!this.resourceGate) {
			throw new Error("Deferred destination service requires a scenario resource gate.");
		}
		return this.completeTransferInternal(requestRow, atTimeMicroseconds, undefined, true);
	}

	startDeferredDestinationService(
		requestRow: number,
		atTimeMicroseconds: number,
		durationMicroseconds: number,
	): void {
		this.assertRequestRow(requestRow);
		if (!Number.isSafeInteger(durationMicroseconds) || durationMicroseconds < 0) {
			throw new RangeError("Destination service duration must be a non-negative safe integer.");
		}
		this.advanceToTimeMicroseconds(atTimeMicroseconds);
		if (this.requestPhases[requestRow] !== DETERMINISTIC_SCENARIO_REQUEST_PHASE.COMPLETED) {
			throw new Error(`Scenario request row ${requestRow} transfer is not completed.`);
		}
		this.startDestinationService(requestRow, durationMicroseconds);
		const candidates = new Set<number>();
		this.addReadySuccessorCandidate(requestRow, candidates);
		this.tryAdmissionCandidates(candidates);
	}

	private completeTransferInternal(
		requestRow: number,
		atTimeMicroseconds: number,
		destinationServiceDurationMicroseconds: number | undefined,
		deferDestinationService: boolean,
	): DeterministicScenarioEvent {
		this.assertRequestRow(requestRow);
		if (
			destinationServiceDurationMicroseconds !== undefined &&
			(!Number.isSafeInteger(destinationServiceDurationMicroseconds) ||
				destinationServiceDurationMicroseconds < 0)
		) {
			throw new RangeError("Destination service duration must be a non-negative safe integer.");
		}
		this.advanceToTimeMicroseconds(atTimeMicroseconds);
		if (this.requestPhases[requestRow] !== DETERMINISTIC_SCENARIO_REQUEST_PHASE.IN_TRANSIT) {
			throw new Error(`Scenario request row ${requestRow} is not in transit.`);
		}
		const loadRow = this.program.requestLoadRows[requestRow] as number;
		const tokenId = this.program.requestVehicleTokenIds[requestRow] as number;
		if (
			this.activeVehicleTokenIds[requestRow] !== tokenId ||
			this.loadVehicleTokenIds[loadRow] !== tokenId ||
			this.loadStationRows[loadRow] !== -1
		) {
			throw new Error(`Scenario request row ${requestRow} has inconsistent FOUP custody.`);
		}
		this.resourceGate?.confirmDestinationArrival(requestRow, atTimeMicroseconds);
		this.loadVehicleTokenIds[loadRow] = 0;
		this.loadStationRows[loadRow] = this.routes.destinationStationRows[requestRow] as number;
		this.activeVehicleTokenIds[requestRow] = 0;
		this.transitionRequestPhase(requestRow, DETERMINISTIC_SCENARIO_REQUEST_PHASE.COMPLETED);
		this.completedRequests++;
		const event = this.appendEvent("TRANSFER_COMPLETED", requestRow);
		if (deferDestinationService) {
			// The resource scheduler starts service after batching equal-time arrivals.
		} else if (destinationServiceDurationMicroseconds === undefined) {
			this.markDestinationServiceReadyWithoutEvents(requestRow);
		} else {
			this.startDestinationService(requestRow, destinationServiceDurationMicroseconds);
		}
		const candidates = new Set<number>();
		this.releaseLease(requestRow, candidates);
		this.addReadySuccessorCandidate(requestRow, candidates);
		this.tryAdmissionCandidates(candidates);
		return event;
	}

	requestState(requestRow: number): DeterministicScenarioRequestState {
		this.assertRequestRow(requestRow);
		return Object.freeze({
			requestRow,
			phase: requestPhaseName(this.requestPhases[requestRow] as number),
			requestedAtMicroseconds: this.routes.requestedAtMicroseconds[requestRow] as number,
			sourceStationRow: this.routes.sourceStationRows[requestRow] as number,
			destinationStationRow: this.routes.destinationStationRows[requestRow] as number,
			loadRow: this.program.requestLoadRows[requestRow] as number,
			activeVehicleTokenId: (this.activeVehicleTokenIds[requestRow] as number) || null,
		});
	}

	destinationServiceState(requestRow: number): DeterministicScenarioDestinationServiceState {
		this.assertRequestRow(requestRow);
		const startedAt = this.destinationServiceStartedTimesMicroseconds[requestRow] as number;
		const readyAt = this.destinationServiceReadyTimesMicroseconds[requestRow] as number;
		return Object.freeze({
			requestRow,
			phase: destinationServicePhaseName(this.destinationServicePhaseCodes[requestRow] as number),
			startedAtMicroseconds: startedAt < 0 ? null : startedAt,
			readyAtMicroseconds: readyAt < 0 ? null : readyAt,
		});
	}

	loadCustody(loadRow: number): DeterministicScenarioLoadCustody {
		if (!Number.isInteger(loadRow) || loadRow < 0 || loadRow >= this.program.loadCount) {
			throw new RangeError(`Scenario load row ${loadRow} is outside the admission program.`);
		}
		const vehicleTokenId = this.loadVehicleTokenIds[loadRow] as number;
		return vehicleTokenId === 0
			? Object.freeze({ kind: "STATION", stationRow: this.loadStationRows[loadRow] as number })
			: Object.freeze({ kind: "VEHICLE_TOKEN", vehicleTokenId });
	}

	eventAt(index: number): DeterministicScenarioEvent {
		if (!Number.isInteger(index) || index < 0 || index >= this.eventsWritten) {
			throw new RangeError(`Scenario event index ${index} is outside the event log.`);
		}
		const requestRow = this.eventRequestRows[index] as number;
		return Object.freeze({
			sequence: index + 1,
			timeMicroseconds: this.eventTimesMicroseconds[index] as number,
			type: eventTypeName(this.eventTypeCodes[index] as number),
			requestRow,
			vehicleTokenId: this.program.requestVehicleTokenIds[requestRow] as number,
			loadRow: this.program.requestLoadRows[requestRow] as number,
		});
	}

	trackResourceOwnerRequestRow(resourceRow: number): number | null {
		return ownerRow(this.trackResourceOwnerRows, resourceRow, "track resource");
	}

	switchConflictOwnerRequestRow(resourceRow: number): number | null {
		return ownerRow(this.switchConflictOwnerRows, resourceRow, "switch-conflict resource");
	}

	private nextReleaseTime(): number {
		return this.releaseCursor < this.routes.requestCount
			? (this.routes.requestedAtMicroseconds[this.releaseCursor] as number)
			: Number.POSITIVE_INFINITY;
	}

	private nextServiceReadyTime(): number {
		return this.serviceReadyHeap.peek()?.timeMicroseconds ?? Number.POSITIVE_INFINITY;
	}

	private releaseRequestsAtTime(timeMicroseconds: number): void {
		while (this.nextReleaseTime() === timeMicroseconds) {
			const requestRow = this.releaseCursor++;
			if (this.predecessorServiceReady(requestRow)) {
				this.enqueueForLease(requestRow);
				this.tryAdmit(requestRow);
			} else {
				this.transitionRequestPhase(
					requestRow,
					DETERMINISTIC_SCENARIO_REQUEST_PHASE.WAITING_DEPENDENCY,
				);
			}
		}
	}

	private completeDestinationServicesAtTime(timeMicroseconds: number): void {
		const candidates = new Set<number>();
		while (this.serviceReadyHeap.peek()?.timeMicroseconds === timeMicroseconds) {
			const scheduled = this.serviceReadyHeap.pop() as ScheduledServiceReady;
			if (
				this.destinationServicePhaseCodes[scheduled.requestRow] !==
					DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE.IN_SERVICE ||
				this.destinationServiceReadyTimesMicroseconds[scheduled.requestRow] !== timeMicroseconds
			) {
				throw new Error(
					`Scenario request row ${scheduled.requestRow} has a stale destination-service event.`,
				);
			}
			this.markDestinationServiceReady(scheduled.requestRow, true);
			this.addReadySuccessorCandidate(scheduled.requestRow, candidates);
		}
		for (const candidate of [...candidates].sort((left, right) => left - right)) {
			this.tryAdmit(candidate);
		}
	}

	private predecessorServiceReady(requestRow: number): boolean {
		const predecessor = this.program.predecessorRequestRows[requestRow] as number;
		return (
			predecessor < 0 ||
			(this.requestPhases[predecessor] === DETERMINISTIC_SCENARIO_REQUEST_PHASE.COMPLETED &&
				this.destinationServicePhaseCodes[predecessor] ===
					DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE.READY)
		);
	}

	private startDestinationService(requestRow: number, durationMicroseconds: number): void {
		if (
			this.destinationServicePhaseCodes[requestRow] !==
			DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE.NOT_STARTED
		) {
			throw new Error(`Scenario request row ${requestRow} destination service started twice.`);
		}
		const readyAtMicroseconds = this.currentTime + durationMicroseconds;
		if (!Number.isSafeInteger(readyAtMicroseconds)) {
			throw new RangeError(`Scenario request row ${requestRow} service-ready time is unsafe.`);
		}
		this.transitionDestinationServicePhase(
			requestRow,
			DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE.IN_SERVICE,
		);
		this.destinationServiceStartedTimesMicroseconds[requestRow] = this.currentTime;
		this.destinationServiceReadyTimesMicroseconds[requestRow] = readyAtMicroseconds;
		this.appendEvent("DESTINATION_SERVICE_STARTED", requestRow);
		if (durationMicroseconds === 0) {
			this.markDestinationServiceReady(requestRow, true);
			return;
		}
		this.serviceReadyHeap.push({ requestRow, timeMicroseconds: readyAtMicroseconds });
	}

	private markDestinationServiceReadyWithoutEvents(requestRow: number): void {
		this.destinationServiceReadyTimesMicroseconds[requestRow] = this.currentTime;
		this.markDestinationServiceReady(requestRow, false);
	}

	private markDestinationServiceReady(requestRow: number, appendEvent: boolean): void {
		if (
			this.destinationServicePhaseCodes[requestRow] ===
			DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE.READY
		) {
			throw new Error(`Scenario request row ${requestRow} destination service completed twice.`);
		}
		this.transitionDestinationServicePhase(
			requestRow,
			DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE.READY,
		);
		this.readyDestinationServices++;
		if (appendEvent) this.appendEvent("DESTINATION_SERVICE_READY", requestRow);
	}

	private addReadySuccessorCandidate(requestRow: number, candidates: Set<number>): void {
		if (
			this.destinationServicePhaseCodes[requestRow] !==
			DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE.READY
		) {
			return;
		}
		const successor = this.program.successorRequestRows[requestRow] as number;
		if (
			successor >= 0 &&
			(this.routes.requestedAtMicroseconds[successor] as number) <= this.currentTime &&
			this.requestPhases[successor] === DETERMINISTIC_SCENARIO_REQUEST_PHASE.WAITING_DEPENDENCY
		) {
			this.enqueueForLease(successor);
			candidates.add(successor);
		}
	}

	private enqueueForLease(requestRow: number): void {
		if (
			this.requestPhases[requestRow] !== DETERMINISTIC_SCENARIO_REQUEST_PHASE.WAITING_RELEASE &&
			this.requestPhases[requestRow] !== DETERMINISTIC_SCENARIO_REQUEST_PHASE.WAITING_DEPENDENCY
		) {
			throw new Error(`Scenario request row ${requestRow} cannot enter the lease queue twice.`);
		}
		const loadRow = this.program.requestLoadRows[requestRow] as number;
		if (
			this.loadVehicleTokenIds[loadRow] !== 0 ||
			this.loadStationRows[loadRow] !== this.routes.sourceStationRows[requestRow]
		) {
			throw new Error(`Scenario request row ${requestRow} does not own its source-station FOUP.`);
		}
		this.transitionRequestPhase(requestRow, DETERMINISTIC_SCENARIO_REQUEST_PHASE.WAITING_LEASE);
		forEachRequestResource(
			this.claims.leaseTrackResourceOffsets,
			this.claims.leaseTrackResourceRows,
			requestRow,
			(resourceRow) => pushResourceWaiter(this.trackWaiters, resourceRow, requestRow),
		);
		forEachRequestResource(
			this.claims.switchConflictClaimOffsets,
			this.claims.switchConflictClaimRows,
			requestRow,
			(resourceRow) => pushResourceWaiter(this.switchWaiters, resourceRow, requestRow),
		);
	}

	private tryAdmit(requestRow: number): boolean {
		if (this.requestPhases[requestRow] !== DETERMINISTIC_SCENARIO_REQUEST_PHASE.WAITING_LEASE) {
			return false;
		}
		if (
			requestResourceSome(
				this.claims.leaseTrackResourceOffsets,
				this.claims.leaseTrackResourceRows,
				requestRow,
				(resourceRow) =>
					this.trackResourceOwnerRows[resourceRow] !== -1 ||
					peekResourceWaiter(this.trackWaiters, resourceRow) !== requestRow,
			) ||
			requestResourceSome(
				this.claims.switchConflictClaimOffsets,
				this.claims.switchConflictClaimRows,
				requestRow,
				(resourceRow) =>
					this.switchConflictOwnerRows[resourceRow] !== -1 ||
					peekResourceWaiter(this.switchWaiters, resourceRow) !== requestRow,
			)
		) {
			return false;
		}
		if (this.resourceGate) {
			if (!this.resourceGate.canReserveDestinationForAdmission(requestRow)) {
				this.resourceGate.destinationReservationBlocked?.(requestRow);
				return false;
			}
			if (!this.resourceGate.reserveDestinationForAdmission(requestRow, this.currentTime))
				return false;
		}
		forEachRequestResource(
			this.claims.leaseTrackResourceOffsets,
			this.claims.leaseTrackResourceRows,
			requestRow,
			(resourceRow) => {
				this.trackResourceOwnerRows[resourceRow] = requestRow;
			},
		);
		forEachRequestResource(
			this.claims.switchConflictClaimOffsets,
			this.claims.switchConflictClaimRows,
			requestRow,
			(resourceRow) => {
				this.switchConflictOwnerRows[resourceRow] = requestRow;
			},
		);
		this.removeAdmittedWaiter(requestRow);
		this.transitionRequestPhase(requestRow, DETERMINISTIC_SCENARIO_REQUEST_PHASE.ADMITTED);
		this.activeVehicleTokenIds[requestRow] = this.program.requestVehicleTokenIds[
			requestRow
		] as number;
		this.appendEvent("VEHICLE_TOKEN_ADMITTED", requestRow);
		return true;
	}

	private tryAdmissionCandidates(candidates: Iterable<number>): void {
		for (const candidate of [...new Set(candidates)].sort((left, right) => left - right)) {
			this.tryAdmit(candidate);
		}
	}

	private transitionRequestPhase(requestRow: number, nextPhase: number): void {
		const previousPhase = this.requestPhases[requestRow] as number;
		const previousCount = this.requestPhaseCounts[previousPhase] as number;
		if (previousPhase === nextPhase || previousCount === 0) {
			throw new Error(`Scenario request row ${requestRow} phase accounting is inconsistent.`);
		}
		this.requestPhases[requestRow] = nextPhase;
		this.requestPhaseCounts[previousPhase] = previousCount - 1;
		this.requestPhaseCounts[nextPhase] = (this.requestPhaseCounts[nextPhase] as number) + 1;
	}

	private transitionDestinationServicePhase(requestRow: number, nextPhase: number): void {
		const previousPhase = this.destinationServicePhaseCodes[requestRow] as number;
		const previousCount = this.destinationServicePhaseCounts[previousPhase] as number;
		if (previousPhase === nextPhase || previousCount === 0) {
			throw new Error(
				`Scenario request row ${requestRow} destination-service accounting is inconsistent.`,
			);
		}
		this.destinationServicePhaseCodes[requestRow] = nextPhase;
		this.destinationServicePhaseCounts[previousPhase] = previousCount - 1;
		this.destinationServicePhaseCounts[nextPhase] =
			(this.destinationServicePhaseCounts[nextPhase] as number) + 1;
	}

	private releaseLease(requestRow: number, candidates: Set<number>): void {
		forEachRequestResource(
			this.claims.leaseTrackResourceOffsets,
			this.claims.leaseTrackResourceRows,
			requestRow,
			(resourceRow) => {
				if (this.trackResourceOwnerRows[resourceRow] !== requestRow) {
					throw new Error(`Scenario request row ${requestRow} lost track resource ${resourceRow}.`);
				}
				this.trackResourceOwnerRows[resourceRow] = -1;
				const waiter = peekResourceWaiter(this.trackWaiters, resourceRow);
				if (waiter >= 0) candidates.add(waiter);
			},
		);
		forEachRequestResource(
			this.claims.switchConflictClaimOffsets,
			this.claims.switchConflictClaimRows,
			requestRow,
			(resourceRow) => {
				if (this.switchConflictOwnerRows[resourceRow] !== requestRow) {
					throw new Error(
						`Scenario request row ${requestRow} lost switch-conflict resource ${resourceRow}.`,
					);
				}
				this.switchConflictOwnerRows[resourceRow] = -1;
				const waiter = peekResourceWaiter(this.switchWaiters, resourceRow);
				if (waiter >= 0) candidates.add(waiter);
			},
		);
	}

	private removeAdmittedWaiter(requestRow: number): void {
		forEachRequestResource(
			this.claims.leaseTrackResourceOffsets,
			this.claims.leaseTrackResourceRows,
			requestRow,
			(resourceRow) => popExpectedResourceWaiter(this.trackWaiters, resourceRow, requestRow),
		);
		forEachRequestResource(
			this.claims.switchConflictClaimOffsets,
			this.claims.switchConflictClaimRows,
			requestRow,
			(resourceRow) => popExpectedResourceWaiter(this.switchWaiters, resourceRow, requestRow),
		);
	}

	private appendEvent(
		type: DeterministicScenarioEventTypeName,
		requestRow: number,
	): DeterministicScenarioEvent {
		if (this.eventsWritten >= this.eventTypeCodes.length) {
			throw new Error("Scenario event capacity is exhausted.");
		}
		const index = this.eventsWritten++;
		this.eventTimesMicroseconds[index] = this.currentTime;
		this.eventTypeCodes[index] = DETERMINISTIC_SCENARIO_EVENT_TYPE[type];
		this.eventRequestRows[index] = requestRow;
		return this.eventAt(index);
	}

	private assertRequestRow(requestRow: number): void {
		if (
			!Number.isInteger(requestRow) ||
			requestRow < 0 ||
			requestRow >= this.program.requestCount
		) {
			throw new RangeError(`Scenario request row ${requestRow} is outside the admission program.`);
		}
	}
}

function assertCompatibleSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	claims: SimulationScenarioLeaseClaims,
	program: SimulationScenarioAdmissionProgram,
): void {
	const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
	if (snapshotError) throw new Error(`Published readiness snapshot is invalid: ${snapshotError}`);
	const manifestError = simulationScenarioManifestError(manifest);
	if (manifestError) throw new Error(`Simulation scenario manifest is invalid: ${manifestError}`);
	if (!simulationScenarioRouteRequestsMatchSources(snapshot, manifest, routes)) {
		throw new Error("Scenario routes do not belong to the supplied runtime sources.");
	}
	if (!simulationScenarioLeaseClaimsMatchSources(snapshot, manifest, routes, claims)) {
		throw new Error("Scenario lease claims do not belong to the supplied runtime sources.");
	}
	if (
		!simulationScenarioAdmissionProgramMatchesSources(snapshot, manifest, routes, claims, program)
	) {
		throw new Error("Scenario admission program does not belong to the supplied runtime sources.");
	}
}

function compileResourceWaiterHeaps(
	resourceCount: number,
	requestResourceRows: Uint32Array,
): ResourceWaiterHeaps {
	const counts = new Uint32Array(resourceCount);
	for (const resourceRow of requestResourceRows) counts[resourceRow]++;
	const offsets = new Uint32Array(resourceCount + 1);
	for (let resourceRow = 0; resourceRow < resourceCount; resourceRow++) {
		offsets[resourceRow + 1] = (offsets[resourceRow] as number) + (counts[resourceRow] as number);
	}
	return Object.freeze({
		offsets,
		requestRows: new Uint32Array(requestResourceRows.length),
		sizes: new Uint32Array(resourceCount),
	});
}

function pushResourceWaiter(
	heaps: ResourceWaiterHeaps,
	resourceRow: number,
	requestRow: number,
): void {
	const start = heaps.offsets[resourceRow] as number;
	const capacity = (heaps.offsets[resourceRow + 1] as number) - start;
	const size = heaps.sizes[resourceRow] as number;
	if (size >= capacity) {
		throw new Error(`Scenario resource row ${resourceRow} waiter capacity is exhausted.`);
	}
	let localRow = size;
	while (localRow > 0) {
		const parentLocalRow = Math.floor((localRow - 1) / 2);
		const parentRow = heaps.requestRows[start + parentLocalRow] as number;
		if (parentRow <= requestRow) break;
		heaps.requestRows[start + localRow] = parentRow;
		localRow = parentLocalRow;
	}
	heaps.requestRows[start + localRow] = requestRow;
	heaps.sizes[resourceRow] = size + 1;
}

function peekResourceWaiter(heaps: ResourceWaiterHeaps, resourceRow: number): number {
	return heaps.sizes[resourceRow] === 0
		? -1
		: (heaps.requestRows[heaps.offsets[resourceRow] as number] as number);
}

function popExpectedResourceWaiter(
	heaps: ResourceWaiterHeaps,
	resourceRow: number,
	expectedRequestRow: number,
): void {
	const start = heaps.offsets[resourceRow] as number;
	const size = heaps.sizes[resourceRow] as number;
	if (size === 0 || heaps.requestRows[start] !== expectedRequestRow) {
		throw new Error(
			`Scenario resource row ${resourceRow} oldest waiter is not request ${expectedRequestRow}.`,
		);
	}
	const nextSize = size - 1;
	heaps.sizes[resourceRow] = nextSize;
	if (nextSize === 0) return;
	const lastRequestRow = heaps.requestRows[start + nextSize] as number;
	let localRow = 0;
	while (true) {
		const leftLocalRow = localRow * 2 + 1;
		if (leftLocalRow >= nextSize) break;
		const rightLocalRow = leftLocalRow + 1;
		let childLocalRow = leftLocalRow;
		if (
			rightLocalRow < nextSize &&
			(heaps.requestRows[start + rightLocalRow] as number) <
				(heaps.requestRows[start + leftLocalRow] as number)
		) {
			childLocalRow = rightLocalRow;
		}
		const childRequestRow = heaps.requestRows[start + childLocalRow] as number;
		if (childRequestRow >= lastRequestRow) break;
		heaps.requestRows[start + localRow] = childRequestRow;
		localRow = childLocalRow;
	}
	heaps.requestRows[start + localRow] = lastRequestRow;
}

function forEachRequestResource(
	offsets: Uint32Array,
	rows: Uint32Array,
	requestRow: number,
	visit: (resourceRow: number) => void,
): void {
	const start = offsets[requestRow] as number;
	const end = offsets[requestRow + 1] as number;
	for (let row = start; row < end; row++) visit(rows[row] as number);
}

function requestResourceSome(
	offsets: Uint32Array,
	rows: Uint32Array,
	requestRow: number,
	predicate: (resourceRow: number) => boolean,
): boolean {
	const start = offsets[requestRow] as number;
	const end = offsets[requestRow + 1] as number;
	for (let row = start; row < end; row++) {
		if (predicate(rows[row] as number)) return true;
	}
	return false;
}

function ownerRow(values: Int32Array, row: number, label: string): number | null {
	if (!Number.isInteger(row) || row < 0 || row >= values.length) {
		throw new RangeError(`Scenario ${label} row ${row} is outside the runtime domain.`);
	}
	const owner = values[row] as number;
	return owner < 0 ? null : owner;
}

class ServiceReadyHeap {
	private readonly values: ScheduledServiceReady[] = [];

	peek(): ScheduledServiceReady | undefined {
		return this.values[0];
	}

	push(value: ScheduledServiceReady): void {
		this.values.push(value);
		let index = this.values.length - 1;
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (compareServiceReady(this.values[parent] as ScheduledServiceReady, value) <= 0) break;
			this.values[index] = this.values[parent] as ScheduledServiceReady;
			index = parent;
		}
		this.values[index] = value;
	}

	pop(): ScheduledServiceReady | undefined {
		const first = this.values[0];
		const last = this.values.pop();
		if (!first || !last || this.values.length === 0) return first;
		let index = 0;
		while (true) {
			const left = index * 2 + 1;
			if (left >= this.values.length) break;
			const right = left + 1;
			let child = left;
			if (
				right < this.values.length &&
				compareServiceReady(
					this.values[right] as ScheduledServiceReady,
					this.values[left] as ScheduledServiceReady,
				) < 0
			) {
				child = right;
			}
			if (compareServiceReady(this.values[child] as ScheduledServiceReady, last) >= 0) break;
			this.values[index] = this.values[child] as ScheduledServiceReady;
			index = child;
		}
		this.values[index] = last;
		return first;
	}
}

function compareServiceReady(left: ScheduledServiceReady, right: ScheduledServiceReady): number {
	return left.timeMicroseconds - right.timeMicroseconds || left.requestRow - right.requestRow;
}

function assertMonotonicTime(value: number, current: number): void {
	if (!Number.isSafeInteger(value) || value < current) {
		throw new RangeError("Scenario time must be a monotonic non-negative safe integer.");
	}
}

function requestPhaseName(code: number): DeterministicScenarioRequestPhaseName {
	for (const [name, value] of Object.entries(DETERMINISTIC_SCENARIO_REQUEST_PHASE)) {
		if (value === code) return name as DeterministicScenarioRequestPhaseName;
	}
	throw new Error(`Unknown scenario request phase ${code}.`);
}

function destinationServicePhaseName(
	code: number,
): DeterministicScenarioDestinationServicePhaseName {
	for (const [name, value] of Object.entries(DETERMINISTIC_SCENARIO_DESTINATION_SERVICE_PHASE)) {
		if (value === code) return name as DeterministicScenarioDestinationServicePhaseName;
	}
	throw new Error(`Unknown destination service phase ${code}.`);
}

function eventTypeName(code: number): DeterministicScenarioEventTypeName {
	for (const [name, value] of Object.entries(DETERMINISTIC_SCENARIO_EVENT_TYPE)) {
		if (value === code) return name as DeterministicScenarioEventTypeName;
	}
	throw new Error(`Unknown scenario event type ${code}.`);
}
