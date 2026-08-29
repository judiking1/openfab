import type { PublishedSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import type { SimulationScenarioAdmissionProgram } from "../compile/SimulationScenarioAdmissionProgram";
import type { SimulationScenarioLeaseClaims } from "../compile/SimulationScenarioLeaseClaims";
import type { SimulationScenarioManifest } from "../compile/SimulationScenarioManifest";
import type { SimulationScenarioPreparedArtifactChainValidation } from "../compile/SimulationScenarioPreparedArtifacts";
import type { SimulationScenarioResourceRunConfiguration } from "../compile/SimulationScenarioResourceRunConfiguration";
import type { SimulationScenarioRouteRequests } from "../compile/SimulationScenarioRouteRequests";
import {
	SIMULATION_SCENARIO_SERVICE_KIND_CODE,
	type SimulationScenarioServiceTiming,
} from "../compile/SimulationScenarioServiceTiming";
import {
	DeterministicScenarioAdmissionCore,
	type DeterministicScenarioDestinationServiceState,
	type DeterministicScenarioEvent,
	type DeterministicScenarioLoadCustody,
	type DeterministicScenarioRequestState,
} from "./DeterministicScenarioAdmissionCore";
import {
	adoptDeterministicScenarioPreparedSources,
	deterministicScenarioPreparedSourcesMatch,
	validateDeterministicScenarioPreparedSources,
} from "./DeterministicScenarioPreparedSources";
import {
	type DeterministicScenarioEqServiceState,
	type DeterministicScenarioResourceEvent,
	DeterministicScenarioResourceState,
	type DeterministicScenarioStorageState,
} from "./DeterministicScenarioResourceState";
import {
	type DeterministicScenarioWorldPose,
	DeterministicScenarioWorldPoseSampler,
} from "./DeterministicScenarioWorldPoseSampler";

export const DETERMINISTIC_SCENARIO_MOTION_POLICY =
	"CONSTANT_CERTIFIED_MAXIMUM_SPEED_ZERO_TRANSFER_DWELL_V1" as const;
export const DETERMINISTIC_SCENARIO_EVENT_TIE_POLICY =
	"CORE_RELEASE_READY_THEN_RESOURCE_READY_START_THEN_COMPLETION_BATCH_BY_REQUEST_ROW_V3" as const;
export const DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS = Object.freeze([
	1, 2, 4, 8, 16, 32, 64,
] as const);
export type DeterministicScenarioSpeedMultiplier =
	(typeof DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS)[number];

interface ScheduledCompletion {
	readonly requestRow: number;
	readonly timeMicroseconds: number;
}

export interface DeterministicScenarioMotionState {
	readonly requestRow: number;
	readonly vehicleTokenId: number | null;
	readonly moving: boolean;
	readonly anchorDistanceMeters: number;
	readonly routeDistanceMeters: number;
	readonly pickupTimeMicroseconds: number | null;
	readonly scheduledCompletionTimeMicroseconds: number | null;
}

export interface DeterministicScenarioRuntimeKpiState {
	readonly requestCount: number;
	readonly requestWaitingReleaseCount: number;
	readonly requestWaitingDependencyCount: number;
	readonly requestWaitingLeaseCount: number;
	readonly requestAdmittedCount: number;
	readonly requestInTransitCount: number;
	readonly requestCompletedCount: number;
	readonly destinationServiceNotStartedCount: number;
	readonly destinationServiceInServiceCount: number;
	readonly destinationServiceReadyCount: number;
	readonly coreEventCount: number;
	readonly resourceEventCount: number;
	readonly eqDestinationRequestCount: number;
	readonly eqNotArrivedCount: number;
	readonly eqQueuedCount: number;
	readonly eqActiveCount: number;
	readonly eqReadyCount: number;
	readonly storageResourceCount: number;
	readonly storageOccupiedUnits: number;
	readonly storageReservedUnits: number;
}

/**
 * Automatically converts admission into zero-dwell pickup and constant-speed terminal completion.
 * Wall-clock multiplier changes only how far simulation time advances, never semantic event time.
 */
export class DeterministicScenarioMotionScheduler {
	readonly motionPolicy = DETERMINISTIC_SCENARIO_MOTION_POLICY;
	readonly eventTiePolicy = DETERMINISTIC_SCENARIO_EVENT_TIE_POLICY;
	private readonly routes: SimulationScenarioRouteRequests;
	private readonly core: DeterministicScenarioAdmissionCore;
	private readonly serviceTiming: SimulationScenarioServiceTiming | null;
	private readonly resourceState: DeterministicScenarioResourceState | null;
	private readonly worldPoseSampler: DeterministicScenarioWorldPoseSampler;
	private readonly travelDurationMicroseconds: Float64Array;
	private readonly pickupTimesMicroseconds: Float64Array;
	private readonly completionTimesMicroseconds: Float64Array;
	private readonly completionHeap = new CompletionHeap();
	private eventScanCursor = 0;
	private resourceEventScanCursor = 0;

	constructor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		routes: SimulationScenarioRouteRequests,
		leaseClaims: SimulationScenarioLeaseClaims,
		admissionProgram: SimulationScenarioAdmissionProgram,
		serviceTiming?: SimulationScenarioServiceTiming,
		resourceRunConfiguration?: SimulationScenarioResourceRunConfiguration,
		preparedArtifactValidation?: SimulationScenarioPreparedArtifactChainValidation,
	) {
		const preparedSources = preparedArtifactValidation
			? adoptDeterministicScenarioPreparedSources(snapshot, manifest, preparedArtifactValidation)
			: validateDeterministicScenarioPreparedSources(
					snapshot,
					manifest,
					routes,
					leaseClaims,
					admissionProgram,
					serviceTiming,
					resourceRunConfiguration,
				);
		if (
			!deterministicScenarioPreparedSourcesMatch(preparedSources, {
				snapshot,
				manifest,
				routes,
				leaseClaims,
				admissionProgram,
				serviceTiming,
				resourceRunConfiguration,
			}) ||
			preparedSources.manifest !== manifest ||
			preparedSources.leaseClaims !== leaseClaims ||
			preparedSources.serviceTiming !== serviceTiming ||
			preparedSources.resourceRunConfiguration !== resourceRunConfiguration
		) {
			throw new Error("Scenario prepared-source adoption does not match scheduler inputs.");
		}
		this.routes = routes;
		this.serviceTiming = serviceTiming ?? null;
		this.resourceState =
			serviceTiming && resourceRunConfiguration
				? new DeterministicScenarioResourceState(
						snapshot,
						routes,
						admissionProgram,
						serviceTiming,
						resourceRunConfiguration,
						preparedSources,
					)
				: null;
		this.worldPoseSampler = new DeterministicScenarioWorldPoseSampler(snapshot, routes);
		this.core = new DeterministicScenarioAdmissionCore(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			this.resourceState ?? undefined,
			preparedSources,
		);
		this.travelDurationMicroseconds = compileTravelDurations(
			routes,
			snapshot.occupancyPolicy.maximumSpeedMillimetersPerSecond,
		);
		this.pickupTimesMicroseconds = new Float64Array(routes.requestCount);
		this.pickupTimesMicroseconds.fill(-1);
		this.completionTimesMicroseconds = new Float64Array(routes.requestCount);
		this.completionTimesMicroseconds.fill(-1);
	}

	get currentTimeMicroseconds(): number {
		return this.core.currentTimeMicroseconds;
	}

	get requestCount(): number {
		return this.routes.requestCount;
	}

	get sourceRouteRequestsFingerprint(): string {
		return this.routes.fingerprint;
	}

	get runIdentityFingerprint(): string {
		return this.routes.runIdentityFingerprint;
	}

	get resourceExecutionPrepared(): boolean {
		return this.resourceState !== null;
	}

	get eventCount(): number {
		return this.core.eventCount;
	}

	get completedRequestCount(): number {
		return this.core.completedRequestCount;
	}

	get allRequestsCompleted(): boolean {
		return this.core.allRequestsCompleted;
	}

	get allDestinationServicesReady(): boolean {
		return this.core.allDestinationServicesReady;
	}

	get allScenarioWorkCompleted(): boolean {
		return (
			this.allRequestsCompleted &&
			this.allDestinationServicesReady &&
			(this.resourceState?.allResourceWorkCompleted ?? true)
		);
	}

	get resourceEventCount(): number {
		return this.resourceState?.eventCount ?? 0;
	}

	advanceSimulationToTimeMicroseconds(targetTimeMicroseconds: number): number {
		assertTargetTime(targetTimeMicroseconds, this.currentTimeMicroseconds);
		const eventStart = this.eventCount;
		while (true) {
			const nextCoreTransition = this.core.nextScheduledTransitionTimeMicroseconds;
			const nextCompletion =
				this.completionHeap.peek()?.timeMicroseconds ?? Number.POSITIVE_INFINITY;
			const nextResourceTransition =
				this.resourceState?.nextScheduledTransitionTimeMicroseconds ?? Number.POSITIVE_INFINITY;
			const nextEventTime = Math.min(nextCoreTransition, nextResourceTransition, nextCompletion);
			if (nextEventTime > targetTimeMicroseconds) break;
			this.core.advanceToTimeMicroseconds(nextEventTime);
			this.pickUpNewAdmissions();
			this.advanceResourcesToTime(nextEventTime);
			this.pickUpNewAdmissions();
			while (this.completionHeap.peek()?.timeMicroseconds === nextEventTime) {
				const completion = this.completionHeap.pop() as ScheduledCompletion;
				if (this.resourceState && this.serviceTiming) {
					this.core.completeTransferWithDeferredDestinationService(
						completion.requestRow,
						completion.timeMicroseconds,
					);
					if (
						this.serviceTiming.serviceKindCodes[completion.requestRow] !==
						SIMULATION_SCENARIO_SERVICE_KIND_CODE.EQ_PROCESS
					) {
						this.core.startDeferredDestinationService(
							completion.requestRow,
							completion.timeMicroseconds,
							this.serviceTiming.serviceDurationMicroseconds[completion.requestRow] as number,
						);
					}
				} else {
					this.core.completeTransfer(
						completion.requestRow,
						completion.timeMicroseconds,
						this.serviceTiming?.serviceDurationMicroseconds[completion.requestRow],
					);
				}
				this.completionTimesMicroseconds[completion.requestRow] = completion.timeMicroseconds;
				this.pickUpNewAdmissions();
			}
			this.advanceResourcesToTime(nextEventTime);
			this.pickUpNewAdmissions();
		}
		this.core.advanceToTimeMicroseconds(targetTimeMicroseconds);
		this.pickUpNewAdmissions();
		this.advanceResourcesToTime(targetTimeMicroseconds);
		this.pickUpNewAdmissions();
		return this.eventCount - eventStart;
	}

	advanceByWallClockMicroseconds(
		wallClockMicroseconds: number,
		multiplier: DeterministicScenarioSpeedMultiplier,
	): number {
		if (!Number.isSafeInteger(wallClockMicroseconds) || wallClockMicroseconds < 0) {
			throw new RangeError(
				"Wall-clock advance must be a non-negative safe integer in microseconds.",
			);
		}
		if (!DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS.includes(multiplier)) {
			throw new RangeError(
				"Scenario speed multiplier must be one of 1x, 2x, 4x, 8x, 16x, 32x, or 64x.",
			);
		}
		const simulationDelta = wallClockMicroseconds * multiplier;
		const target = this.currentTimeMicroseconds + simulationDelta;
		if (!Number.isSafeInteger(simulationDelta) || !Number.isSafeInteger(target)) {
			throw new RangeError("Scaled simulation time exceeds the safe integer range.");
		}
		return this.advanceSimulationToTimeMicroseconds(target);
	}

	requestState(requestRow: number): DeterministicScenarioRequestState {
		return this.core.requestState(requestRow);
	}

	loadCustody(loadRow: number): DeterministicScenarioLoadCustody {
		return this.core.loadCustody(loadRow);
	}

	eventAt(index: number): DeterministicScenarioEvent {
		return this.core.eventAt(index);
	}

	destinationServiceState(requestRow: number): DeterministicScenarioDestinationServiceState {
		return this.core.destinationServiceState(requestRow);
	}

	resourceEventAt(index: number): DeterministicScenarioResourceEvent {
		return this.requireResourceState().eventAt(index);
	}

	storageState(resourceRow: number): Readonly<DeterministicScenarioStorageState> {
		return this.requireResourceState().storageState(resourceRow);
	}

	destinationStorageReservationRow(requestRow: number): number | null {
		return this.requireResourceState().destinationStorageReservationRow(requestRow);
	}

	loadStorageResourceRow(loadRow: number): number | null {
		return this.requireResourceState().loadStorageResourceRow(loadRow);
	}

	eqServiceState(requestRow: number): DeterministicScenarioEqServiceState {
		return this.requireResourceState().eqServiceState(requestRow);
	}

	requestIsMoving(requestRow: number): boolean {
		return this.core.requestIsInTransit(requestRow);
	}

	runtimeKpiState(): Readonly<DeterministicScenarioRuntimeKpiState> {
		const resources = this.resourceState?.resourceSummary();
		return Object.freeze({
			requestCount: this.routes.requestCount,
			requestWaitingReleaseCount: this.core.requestPhaseCount("WAITING_RELEASE"),
			requestWaitingDependencyCount: this.core.requestPhaseCount("WAITING_DEPENDENCY"),
			requestWaitingLeaseCount: this.core.requestPhaseCount("WAITING_LEASE"),
			requestAdmittedCount: this.core.requestPhaseCount("ADMITTED"),
			requestInTransitCount: this.core.requestPhaseCount("IN_TRANSIT"),
			requestCompletedCount: this.core.requestPhaseCount("COMPLETED"),
			destinationServiceNotStartedCount: this.core.destinationServicePhaseCount("NOT_STARTED"),
			destinationServiceInServiceCount: this.core.destinationServicePhaseCount("IN_SERVICE"),
			destinationServiceReadyCount: this.core.destinationServicePhaseCount("READY"),
			coreEventCount: this.core.eventCount,
			resourceEventCount: this.resourceState?.eventCount ?? 0,
			eqDestinationRequestCount: resources?.eqDestinationRequestCount ?? 0,
			eqNotArrivedCount: resources?.eqNotArrivedCount ?? 0,
			eqQueuedCount: resources?.eqQueuedCount ?? 0,
			eqActiveCount: resources?.eqActiveCount ?? 0,
			eqReadyCount: resources?.eqReadyCount ?? 0,
			storageResourceCount: resources?.storageResourceCount ?? 0,
			storageOccupiedUnits: resources?.storageOccupiedUnits ?? 0,
			storageReservedUnits: resources?.storageReservedUnits ?? 0,
		});
	}

	motionState(requestRow: number): DeterministicScenarioMotionState {
		const request = this.core.requestState(requestRow);
		const routeDistanceMeters = this.routes.routeDistancesMeters[requestRow] as number;
		const pickupTime = this.pickupTimesMicroseconds[requestRow] as number;
		const completionTime = this.completionTimesMicroseconds[requestRow] as number;
		const scheduledCompletion =
			completionTime >= 0 ? completionTime : this.scheduledCompletionTimeForRequest(requestRow);
		const moving = request.phase === "IN_TRANSIT";
		let anchorDistanceMeters = 0;
		if (request.phase === "COMPLETED") anchorDistanceMeters = routeDistanceMeters;
		else if (moving && pickupTime >= 0 && scheduledCompletion !== null) {
			const elapsed = this.currentTimeMicroseconds - pickupTime;
			const duration = scheduledCompletion - pickupTime;
			anchorDistanceMeters = routeDistanceMeters * Math.min(1, Math.max(0, elapsed / duration));
		}
		return Object.freeze({
			requestRow,
			vehicleTokenId: request.activeVehicleTokenId,
			moving,
			anchorDistanceMeters,
			routeDistanceMeters,
			pickupTimeMicroseconds: pickupTime < 0 ? null : pickupTime,
			scheduledCompletionTimeMicroseconds: scheduledCompletion,
		});
	}

	worldPose(requestRow: number): DeterministicScenarioWorldPose {
		const motion = this.motionState(requestRow);
		return this.worldPoseSampler.sample(requestRow, motion.anchorDistanceMeters);
	}

	private pickUpNewAdmissions(): void {
		while (this.eventScanCursor < this.core.eventCount) {
			const event = this.core.eventAt(this.eventScanCursor++);
			if (event.type !== "VEHICLE_TOKEN_ADMITTED") continue;
			const pickup = this.core.confirmPickup(event.requestRow, event.timeMicroseconds);
			this.pickupTimesMicroseconds[event.requestRow] = pickup.timeMicroseconds;
			const completionTime =
				pickup.timeMicroseconds + (this.travelDurationMicroseconds[event.requestRow] as number);
			if (!Number.isSafeInteger(completionTime)) {
				throw new RangeError(`Scenario request row ${event.requestRow} completion time is unsafe.`);
			}
			this.completionHeap.push({ requestRow: event.requestRow, timeMicroseconds: completionTime });
		}
	}

	private advanceResourcesToTime(timeMicroseconds: number): void {
		if (!this.resourceState || !this.serviceTiming) return;
		this.resourceState.advanceToTimeMicroseconds(timeMicroseconds);
		while (this.resourceEventScanCursor < this.resourceState.eventCount) {
			const event = this.resourceState.eventAt(this.resourceEventScanCursor++);
			if (event.type !== "EQ_SERVICE_STARTED") continue;
			this.core.startDeferredDestinationService(
				event.requestRow,
				event.timeMicroseconds,
				this.serviceTiming.serviceDurationMicroseconds[event.requestRow] as number,
			);
		}
	}

	private requireResourceState(): DeterministicScenarioResourceState {
		if (!this.resourceState) {
			throw new Error("Scenario motion scheduler has no prepared resource state.");
		}
		return this.resourceState;
	}

	private scheduledCompletionTimeForRequest(requestRow: number): number | null {
		const pickupTime = this.pickupTimesMicroseconds[requestRow] as number;
		return pickupTime < 0
			? null
			: pickupTime + (this.travelDurationMicroseconds[requestRow] as number);
	}
}

function compileTravelDurations(
	routes: SimulationScenarioRouteRequests,
	maximumSpeedMillimetersPerSecond: number,
): Float64Array {
	if (
		!Number.isSafeInteger(maximumSpeedMillimetersPerSecond) ||
		maximumSpeedMillimetersPerSecond <= 0
	) {
		throw new Error("Certified maximum vehicle speed is invalid.");
	}
	const durations = new Float64Array(routes.requestCount);
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const distanceMicrometers = Math.ceil(
			(routes.routeDistancesMeters[requestRow] as number) * 1_000_000,
		);
		const durationMicroseconds = Math.ceil(
			(distanceMicrometers * 1_000) / maximumSpeedMillimetersPerSecond,
		);
		if (!Number.isSafeInteger(durationMicroseconds) || durationMicroseconds <= 0) {
			throw new RangeError(`Scenario request row ${requestRow} travel duration is invalid.`);
		}
		durations[requestRow] = durationMicroseconds;
	}
	return durations;
}

class CompletionHeap {
	private readonly values: ScheduledCompletion[] = [];

	peek(): ScheduledCompletion | undefined {
		return this.values[0];
	}

	push(value: ScheduledCompletion): void {
		this.values.push(value);
		let index = this.values.length - 1;
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (compareCompletions(this.values[parent] as ScheduledCompletion, value) <= 0) break;
			this.values[index] = this.values[parent] as ScheduledCompletion;
			index = parent;
		}
		this.values[index] = value;
	}

	pop(): ScheduledCompletion | undefined {
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
				compareCompletions(
					this.values[right] as ScheduledCompletion,
					this.values[left] as ScheduledCompletion,
				) < 0
			) {
				child = right;
			}
			if (compareCompletions(this.values[child] as ScheduledCompletion, last) >= 0) break;
			this.values[index] = this.values[child] as ScheduledCompletion;
			index = child;
		}
		this.values[index] = last;
		return first;
	}
}

function compareCompletions(left: ScheduledCompletion, right: ScheduledCompletion): number {
	return left.timeMicroseconds - right.timeMicroseconds || left.requestRow - right.requestRow;
}

function assertTargetTime(value: number, current: number): void {
	if (!Number.isSafeInteger(value) || value < current) {
		throw new RangeError("Simulation target time must be a monotonic non-negative safe integer.");
	}
}
