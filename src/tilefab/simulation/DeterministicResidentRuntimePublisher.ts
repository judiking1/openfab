import type { PublishedSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE,
	DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE,
} from "./DeterministicResidentRuntimeEventLog";
import type { DeterministicResidentRuntimeState } from "./DeterministicResidentRuntimeState";
import { DeterministicResidentWorldPoseSampler } from "./DeterministicResidentWorldPoseSampler";

export const DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_SCHEMA_VERSION = 1 as const;
export const DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_CADENCE_POLICY =
	"SIMULATION_TIME_DUE_OR_TERMINAL_ONE_SNAPSHOT_PER_POLL_V1" as const;
export const DETERMINISTIC_RESIDENT_RUNTIME_POSE_ORDER_POLICY =
	"PERSISTED_HOME_SLOT_VEHICLE_ROW_ASCENDING_V1" as const;
export const DETERMINISTIC_RESIDENT_RUNTIME_MINIMUM_CADENCE_MICROSECONDS = 1_000;
export const DETERMINISTIC_RESIDENT_RUNTIME_MAXIMUM_CADENCE_MICROSECONDS = 60_000_000;
export const DETERMINISTIC_RESIDENT_RUNTIME_MAXIMUM_POSE_COUNT = 8_192;
export const DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT = 8;
export const DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE = Object.freeze({
	CADENCE: 1,
	TERMINAL: 2,
} as const);
export const DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE = Object.freeze({
	REQUEST_TOTAL: 1,
	REQUEST_WAITING_RELEASE: 2,
	REQUEST_WAITING_PREDECESSOR: 3,
	REQUEST_WAITING_CYCLE_LEASE: 4,
	REQUEST_TO_PICKUP: 5,
	REQUEST_TO_DROPOFF: 6,
	REQUEST_RETURNING_HOME: 7,
	REQUEST_COMPLETED: 8,
	SERVICE_NOT_ARRIVED: 9,
	SERVICE_QUEUED: 10,
	SERVICE_ACTIVE: 11,
	SERVICE_READY: 12,
	VEHICLE_TOTAL: 13,
	VEHICLE_IDLE_AT_HOME: 14,
	VEHICLE_WAITING_CYCLE: 15,
	VEHICLE_MOVING: 16,
	LOAD_TOTAL: 17,
	NON_HOME_TRACK_OWNED: 18,
	SWITCH_CONFLICT_OWNED: 19,
	STORAGE_OCCUPIED: 20,
	STORAGE_RESERVED: 21,
	CORE_EVENT_COUNT: 22,
	RESOURCE_EVENT_COUNT: 23,
} as const);

const KPI_CODES = Uint8Array.from(Object.values(DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE));
const CONFIGURATION_KEYS = Object.freeze(["cadenceMicroseconds", "maximumPoseCount"] as const);
const PUBLICATION_KEYS = Object.freeze([
	"schemaVersion",
	"cadencePolicy",
	"poseOrderPolicy",
	"sequence",
	"triggerCode",
	"sourceAuthorizationFingerprint",
	"sourceCertificateFingerprint",
	"cadenceMicroseconds",
	"maximumPoseCount",
	"scheduledPublicationTimeMicroseconds",
	"sampledSimulationTimeMicroseconds",
	"skippedCadenceCount",
	"eligiblePoseCount",
	"publishedPoseCount",
	"posesTruncated",
	"poseVehicleRows",
	"poseRequestRows",
	"poseVehiclePhaseCodes",
	"poseLegIndices",
	"poseSourcePortIds",
	"poseDestinationPortIds",
	"posePathRows",
	"poseLegDistancesMeters",
	"poseLegAnchorDistancesMeters",
	"poseCycleDistancesMeters",
	"poseCycleAnchorDistancesMeters",
	"posePathStationsMeters",
	"poseWorldXMeters",
	"poseWorldZMeters",
	"poseTangentX",
	"poseTangentZ",
	"poseYawRadians",
	"kpiCodes",
	"kpiValues",
	"coreEventCount",
	"publishedCoreEventCount",
	"coreEventsTruncated",
	"coreEventSequences",
	"coreEventTimesMicroseconds",
	"coreEventTypeCodes",
	"coreEventRequestRows",
	"resourceEventCount",
	"publishedResourceEventCount",
	"resourceEventsTruncated",
	"resourceEventSequences",
	"resourceEventTimesMicroseconds",
	"resourceEventTypeCodes",
	"resourceEventRequestRows",
	"resourceEventResourceRows",
	"fingerprint",
	"byteLength",
] as const);

export interface DeterministicResidentRuntimePublicationConfiguration {
	readonly cadenceMicroseconds: number;
	readonly maximumPoseCount: number;
}

export interface DeterministicResidentRuntimePublication {
	readonly schemaVersion: typeof DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_SCHEMA_VERSION;
	readonly cadencePolicy: typeof DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_CADENCE_POLICY;
	readonly poseOrderPolicy: typeof DETERMINISTIC_RESIDENT_RUNTIME_POSE_ORDER_POLICY;
	readonly sequence: number;
	readonly triggerCode: number;
	readonly sourceAuthorizationFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly cadenceMicroseconds: number;
	readonly maximumPoseCount: number;
	readonly scheduledPublicationTimeMicroseconds: number;
	readonly sampledSimulationTimeMicroseconds: number;
	readonly skippedCadenceCount: number;
	readonly eligiblePoseCount: number;
	readonly publishedPoseCount: number;
	readonly posesTruncated: boolean;
	readonly poseVehicleRows: Uint32Array;
	readonly poseRequestRows: Int32Array;
	readonly poseVehiclePhaseCodes: Uint8Array;
	readonly poseLegIndices: Int8Array;
	readonly poseSourcePortIds: Uint32Array;
	readonly poseDestinationPortIds: Uint32Array;
	readonly posePathRows: Uint32Array;
	readonly poseLegDistancesMeters: Float64Array;
	readonly poseLegAnchorDistancesMeters: Float64Array;
	readonly poseCycleDistancesMeters: Float64Array;
	readonly poseCycleAnchorDistancesMeters: Float64Array;
	readonly posePathStationsMeters: Float64Array;
	readonly poseWorldXMeters: Float64Array;
	readonly poseWorldZMeters: Float64Array;
	readonly poseTangentX: Float64Array;
	readonly poseTangentZ: Float64Array;
	readonly poseYawRadians: Float64Array;
	readonly kpiCodes: Uint8Array;
	readonly kpiValues: Float64Array;
	readonly coreEventCount: number;
	readonly publishedCoreEventCount: number;
	readonly coreEventsTruncated: boolean;
	readonly coreEventSequences: Uint32Array;
	readonly coreEventTimesMicroseconds: Float64Array;
	readonly coreEventTypeCodes: Uint8Array;
	readonly coreEventRequestRows: Uint32Array;
	readonly resourceEventCount: number;
	readonly publishedResourceEventCount: number;
	readonly resourceEventsTruncated: boolean;
	readonly resourceEventSequences: Uint32Array;
	readonly resourceEventTimesMicroseconds: Float64Array;
	readonly resourceEventTypeCodes: Uint8Array;
	readonly resourceEventRequestRows: Uint32Array;
	readonly resourceEventResourceRows: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

/** Read-only, bounded, one-way resident pose/KPI/event-tail publication boundary. */
export class DeterministicResidentRuntimePublisher {
	readonly cadencePolicy = DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_CADENCE_POLICY;
	readonly poseOrderPolicy = DETERMINISTIC_RESIDENT_RUNTIME_POSE_ORDER_POLICY;
	private readonly runtime: DeterministicResidentRuntimeState;
	private readonly poseSampler: DeterministicResidentWorldPoseSampler;
	private readonly configuration: DeterministicResidentRuntimePublicationConfiguration;
	private nextPublicationTimeMicroseconds = 0;
	private sequence = 0;
	private terminalPublished = false;

	constructor(
		snapshot: PublishedSimulationResidentReadinessSnapshot,
		runtime: DeterministicResidentRuntimeState,
		configuration: DeterministicResidentRuntimePublicationConfiguration,
	) {
		assertConfiguration(configuration);
		this.runtime = runtime;
		this.poseSampler = new DeterministicResidentWorldPoseSampler(snapshot, runtime);
		this.configuration = Object.freeze({ ...configuration });
	}

	get nextScheduledPublicationTimeMicroseconds(): number {
		return this.terminalPublished ? Number.POSITIVE_INFINITY : this.nextPublicationTimeMicroseconds;
	}

	publishIfDue(): DeterministicResidentRuntimePublication | null {
		if (this.terminalPublished) return null;
		const sampledTime = this.runtime.currentTimeMicroseconds;
		const terminal = this.runtime.allResidentWorkCompleted;
		const cadenceDue = sampledTime >= this.nextPublicationTimeMicroseconds;
		if (!cadenceDue && !terminal) return null;
		let scheduledTime = sampledTime;
		let skippedCadenceCount = 0;
		if (cadenceDue) {
			scheduledTime = this.nextPublicationTimeMicroseconds;
			skippedCadenceCount = Math.floor(
				(sampledTime - scheduledTime) / this.configuration.cadenceMicroseconds,
			);
			this.nextPublicationTimeMicroseconds =
				scheduledTime + (skippedCadenceCount + 1) * this.configuration.cadenceMicroseconds;
			if (!Number.isSafeInteger(this.nextPublicationTimeMicroseconds)) {
				throw new RangeError("Resident publication cadence exceeded safe integer time.");
			}
		}
		const publication = this.compilePublication(
			terminal
				? DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL
				: DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
			scheduledTime,
			sampledTime,
			skippedCadenceCount,
		);
		if (terminal) this.terminalPublished = true;
		return publication;
	}

	private compilePublication(
		triggerCode: number,
		scheduledPublicationTimeMicroseconds: number,
		sampledSimulationTimeMicroseconds: number,
		skippedCadenceCount: number,
	): DeterministicResidentRuntimePublication {
		const eligiblePoseCount = this.runtime.vehicleCount;
		const publishedPoseCount = Math.min(eligiblePoseCount, this.configuration.maximumPoseCount);
		const poses = createPoseColumns(publishedPoseCount);
		for (let vehicleRow = 0; vehicleRow < publishedPoseCount; vehicleRow++) {
			const pose = this.poseSampler.sampleVehicle(vehicleRow);
			poses.vehicleRows[vehicleRow] = vehicleRow;
			poses.requestRows[vehicleRow] = pose.currentRequestRow ?? -1;
			poses.vehiclePhaseCodes[vehicleRow] = vehiclePhaseCode(pose.vehiclePhase);
			poses.legIndices[vehicleRow] = pose.legIndex ?? -1;
			poses.sourcePortIds[vehicleRow] = pose.sourcePortId;
			poses.destinationPortIds[vehicleRow] = pose.destinationPortId;
			poses.pathRows[vehicleRow] = pose.pathRow;
			poses.legDistancesMeters[vehicleRow] = pose.legDistanceMeters;
			poses.legAnchorDistancesMeters[vehicleRow] = pose.legAnchorDistanceMeters;
			poses.cycleDistancesMeters[vehicleRow] = pose.cycleDistanceMeters;
			poses.cycleAnchorDistancesMeters[vehicleRow] = pose.cycleAnchorDistanceMeters;
			poses.pathStationsMeters[vehicleRow] = pose.pathStationMeters;
			poses.worldXMeters[vehicleRow] = pose.worldXMeters;
			poses.worldZMeters[vehicleRow] = pose.worldZMeters;
			poses.tangentX[vehicleRow] = pose.tangentX;
			poses.tangentZ[vehicleRow] = pose.tangentZ;
			poses.yawRadians[vehicleRow] = pose.yawRadians;
		}
		const summary = this.runtime.runtimeSummary();
		const kpiCodes = KPI_CODES.slice();
		const kpiValues = Float64Array.from([
			summary.requestCount,
			summary.requestWaitingReleaseCount,
			summary.requestWaitingPredecessorCount,
			summary.requestWaitingCompleteCycleLeaseCount,
			summary.requestToPickupCount,
			summary.requestToDropoffCount,
			summary.requestReturningHomeCount,
			summary.requestCompletedCount,
			summary.destinationServiceNotArrivedCount,
			summary.destinationServiceQueuedCount,
			summary.destinationServiceActiveCount,
			summary.destinationServiceReadyCount,
			summary.vehicleCount,
			summary.vehicleIdleAtHomeCount,
			summary.vehicleWaitingForCompleteCycleCount,
			summary.vehicleMovingCount,
			summary.loadCount,
			summary.nonHomeOwnedTrackResourceCount,
			summary.ownedSwitchConflictResourceCount,
			summary.storageOccupiedUnits,
			summary.storageReservedUnits,
			this.runtime.coreEventCount,
			this.runtime.resourceEventCount,
		]);
		const coreEvents = copyCoreEventTail(this.runtime);
		const resourceEvents = copyResourceEventTail(this.runtime);
		const sequence = this.sequence + 1;
		if (!Number.isSafeInteger(sequence))
			throw new RangeError("Resident publication sequence is unsafe.");
		const partial = {
			schemaVersion: DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_SCHEMA_VERSION,
			cadencePolicy: DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_CADENCE_POLICY,
			poseOrderPolicy: DETERMINISTIC_RESIDENT_RUNTIME_POSE_ORDER_POLICY,
			sequence,
			triggerCode,
			sourceAuthorizationFingerprint: this.runtime.sourceAuthorizationFingerprint,
			sourceCertificateFingerprint: this.runtime.sourceCertificateFingerprint,
			cadenceMicroseconds: this.configuration.cadenceMicroseconds,
			maximumPoseCount: this.configuration.maximumPoseCount,
			scheduledPublicationTimeMicroseconds,
			sampledSimulationTimeMicroseconds,
			skippedCadenceCount,
			eligiblePoseCount,
			publishedPoseCount,
			posesTruncated: eligiblePoseCount > publishedPoseCount,
			poseVehicleRows: poses.vehicleRows,
			poseRequestRows: poses.requestRows,
			poseVehiclePhaseCodes: poses.vehiclePhaseCodes,
			poseLegIndices: poses.legIndices,
			poseSourcePortIds: poses.sourcePortIds,
			poseDestinationPortIds: poses.destinationPortIds,
			posePathRows: poses.pathRows,
			poseLegDistancesMeters: poses.legDistancesMeters,
			poseLegAnchorDistancesMeters: poses.legAnchorDistancesMeters,
			poseCycleDistancesMeters: poses.cycleDistancesMeters,
			poseCycleAnchorDistancesMeters: poses.cycleAnchorDistancesMeters,
			posePathStationsMeters: poses.pathStationsMeters,
			poseWorldXMeters: poses.worldXMeters,
			poseWorldZMeters: poses.worldZMeters,
			poseTangentX: poses.tangentX,
			poseTangentZ: poses.tangentZ,
			poseYawRadians: poses.yawRadians,
			kpiCodes,
			kpiValues,
			coreEventCount: this.runtime.coreEventCount,
			publishedCoreEventCount: coreEvents.sequences.length,
			coreEventsTruncated: this.runtime.coreEventCount > coreEvents.sequences.length,
			coreEventSequences: coreEvents.sequences,
			coreEventTimesMicroseconds: coreEvents.timesMicroseconds,
			coreEventTypeCodes: coreEvents.typeCodes,
			coreEventRequestRows: coreEvents.requestRows,
			resourceEventCount: this.runtime.resourceEventCount,
			publishedResourceEventCount: resourceEvents.sequences.length,
			resourceEventsTruncated: this.runtime.resourceEventCount > resourceEvents.sequences.length,
			resourceEventSequences: resourceEvents.sequences,
			resourceEventTimesMicroseconds: resourceEvents.timesMicroseconds,
			resourceEventTypeCodes: resourceEvents.typeCodes,
			resourceEventRequestRows: resourceEvents.requestRows,
			resourceEventResourceRows: resourceEvents.resourceRows,
		};
		const views = publicationViews(partial);
		const publication = Object.freeze({
			...partial,
			fingerprint: checksumPublication(partial),
			byteLength: sumByteLengths(views),
		});
		const error = deterministicResidentRuntimePublicationError(publication);
		if (error) throw new Error(`Resident runtime publication is invalid: ${error}`);
		this.sequence = sequence;
		return publication;
	}
}

export function deterministicResidentRuntimePublicationError(value: unknown): string | null {
	if (!isRecord(value)) return "resident runtime publication must be an object";
	if (!hasExactKeys(value, PUBLICATION_KEYS)) {
		return "resident runtime publication contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_SCHEMA_VERSION ||
		value.cadencePolicy !== DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_CADENCE_POLICY ||
		value.poseOrderPolicy !== DETERMINISTIC_RESIDENT_RUNTIME_POSE_ORDER_POLICY ||
		(value.triggerCode !== DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE &&
			value.triggerCode !== DETERMINISTIC_RESIDENT_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL) ||
		!isPositiveSafeInteger(value.sequence) ||
		!isNonEmptyString(value.sourceAuthorizationFingerprint) ||
		!isNonEmptyString(value.sourceCertificateFingerprint) ||
		!validConfigurationValues(value.cadenceMicroseconds, value.maximumPoseCount)
	) {
		return "resident runtime publication identity or policy is invalid";
	}
	if (
		!isNonNegativeSafeInteger(value.scheduledPublicationTimeMicroseconds) ||
		!isNonNegativeSafeInteger(value.sampledSimulationTimeMicroseconds) ||
		(value.scheduledPublicationTimeMicroseconds as number) >
			(value.sampledSimulationTimeMicroseconds as number) ||
		!isNonNegativeSafeInteger(value.skippedCadenceCount) ||
		!isNonNegativeSafeInteger(value.eligiblePoseCount) ||
		!isNonNegativeSafeInteger(value.publishedPoseCount) ||
		(value.publishedPoseCount as number) > (value.maximumPoseCount as number) ||
		(value.publishedPoseCount as number) > (value.eligiblePoseCount as number) ||
		(value.publishedPoseCount as number) !==
			Math.min(value.eligiblePoseCount as number, value.maximumPoseCount as number) ||
		value.posesTruncated !==
			(value.eligiblePoseCount as number) > (value.publishedPoseCount as number)
	) {
		return "resident runtime publication cadence or pose counts are invalid";
	}
	const poseCount = value.publishedPoseCount as number;
	if (!validPoseColumns(value, poseCount)) return "resident runtime pose columns are malformed";
	if (
		!isUint8Array(value.kpiCodes, KPI_CODES.length) ||
		!isFiniteNonNegativeIntegerFloat64Array(value.kpiValues, KPI_CODES.length) ||
		!sameNumbers(value.kpiCodes as Uint8Array, KPI_CODES)
	) {
		return "resident runtime KPI columns are malformed";
	}
	if (!validEventColumns(value, "core") || !validEventColumns(value, "resource")) {
		return "resident runtime event-tail columns are malformed";
	}
	const publication = value as unknown as DeterministicResidentRuntimePublication;
	if (!validPublicationRelationships(publication)) {
		return "resident runtime pose, KPI, or event relationships are inconsistent";
	}
	const views = publicationViews(publication);
	if (
		new Set(views.map((view) => view.buffer)).size !== views.length ||
		!isNonNegativeSafeInteger(value.byteLength) ||
		value.byteLength !== sumByteLengths(views) ||
		!isNonEmptyString(value.fingerprint) ||
		value.fingerprint !== checksumPublication(publication)
	) {
		return "resident runtime publication accounting or fingerprint is invalid";
	}
	return null;
}

function createPoseColumns(count: number) {
	return {
		vehicleRows: new Uint32Array(count),
		requestRows: new Int32Array(count).fill(-1),
		vehiclePhaseCodes: new Uint8Array(count),
		legIndices: new Int8Array(count).fill(-1),
		sourcePortIds: new Uint32Array(count),
		destinationPortIds: new Uint32Array(count),
		pathRows: new Uint32Array(count),
		legDistancesMeters: new Float64Array(count),
		legAnchorDistancesMeters: new Float64Array(count),
		cycleDistancesMeters: new Float64Array(count),
		cycleAnchorDistancesMeters: new Float64Array(count),
		pathStationsMeters: new Float64Array(count),
		worldXMeters: new Float64Array(count),
		worldZMeters: new Float64Array(count),
		tangentX: new Float64Array(count),
		tangentZ: new Float64Array(count),
		yawRadians: new Float64Array(count),
	};
}

function copyCoreEventTail(runtime: DeterministicResidentRuntimeState) {
	const count = Math.min(runtime.coreEventCount, DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT);
	const start = runtime.coreEventCount - count;
	const sequences = new Uint32Array(count);
	const timesMicroseconds = new Float64Array(count);
	const typeCodes = new Uint8Array(count);
	const requestRows = new Uint32Array(count);
	for (let row = 0; row < count; row++) {
		const event = runtime.coreEventAt(start + row);
		sequences[row] = event.sequence;
		timesMicroseconds[row] = event.timeMicroseconds;
		typeCodes[row] = DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE[event.type];
		requestRows[row] = event.requestRow;
	}
	return { sequences, timesMicroseconds, typeCodes, requestRows };
}

function copyResourceEventTail(runtime: DeterministicResidentRuntimeState) {
	const count = Math.min(
		runtime.resourceEventCount,
		DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT,
	);
	const start = runtime.resourceEventCount - count;
	const sequences = new Uint32Array(count);
	const timesMicroseconds = new Float64Array(count);
	const typeCodes = new Uint8Array(count);
	const requestRows = new Uint32Array(count);
	const resourceRows = new Uint32Array(count);
	for (let row = 0; row < count; row++) {
		const event = runtime.resourceEventAt(start + row);
		sequences[row] = event.sequence;
		timesMicroseconds[row] = event.timeMicroseconds;
		typeCodes[row] = DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE[event.type];
		requestRows[row] = event.requestRow;
		resourceRows[row] = event.resourceRow;
	}
	return { sequences, timesMicroseconds, typeCodes, requestRows, resourceRows };
}

function publicationViews(
	value: Omit<DeterministicResidentRuntimePublication, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		value.poseVehicleRows,
		value.poseRequestRows,
		value.poseVehiclePhaseCodes,
		value.poseLegIndices,
		value.poseSourcePortIds,
		value.poseDestinationPortIds,
		value.posePathRows,
		value.poseLegDistancesMeters,
		value.poseLegAnchorDistancesMeters,
		value.poseCycleDistancesMeters,
		value.poseCycleAnchorDistancesMeters,
		value.posePathStationsMeters,
		value.poseWorldXMeters,
		value.poseWorldZMeters,
		value.poseTangentX,
		value.poseTangentZ,
		value.poseYawRadians,
		value.kpiCodes,
		value.kpiValues,
		value.coreEventSequences,
		value.coreEventTimesMicroseconds,
		value.coreEventTypeCodes,
		value.coreEventRequestRows,
		value.resourceEventSequences,
		value.resourceEventTimesMicroseconds,
		value.resourceEventTypeCodes,
		value.resourceEventRequestRows,
		value.resourceEventResourceRows,
	];
}

function checksumPublication(
	value: Omit<DeterministicResidentRuntimePublication, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		value.schemaVersion,
		value.sequence,
		value.triggerCode,
		value.cadenceMicroseconds,
		value.maximumPoseCount,
		value.scheduledPublicationTimeMicroseconds,
		value.sampledSimulationTimeMicroseconds,
		value.skippedCadenceCount,
		value.eligiblePoseCount,
		value.publishedPoseCount,
		value.posesTruncated ? 1 : 0,
		value.coreEventCount,
		value.publishedCoreEventCount,
		value.coreEventsTruncated ? 1 : 0,
		value.resourceEventCount,
		value.publishedResourceEventCount,
		value.resourceEventsTruncated ? 1 : 0,
	]);
	checksum.addStrings([
		value.cadencePolicy,
		value.poseOrderPolicy,
		value.sourceAuthorizationFingerprint,
		value.sourceCertificateFingerprint,
	]);
	checksum.addViews(publicationViews(value));
	return checksum.digest();
}

function validPoseColumns(value: Record<string, unknown>, count: number): boolean {
	if (
		!(
			isUint32Array(value.poseVehicleRows, count) &&
			isInt32Array(value.poseRequestRows, count) &&
			isUint8Array(value.poseVehiclePhaseCodes, count) &&
			isInt8Array(value.poseLegIndices, count) &&
			isUint32Array(value.poseSourcePortIds, count) &&
			isUint32Array(value.poseDestinationPortIds, count) &&
			isUint32Array(value.posePathRows, count) &&
			[
				value.poseLegDistancesMeters,
				value.poseLegAnchorDistancesMeters,
				value.poseCycleDistancesMeters,
				value.poseCycleAnchorDistancesMeters,
				value.posePathStationsMeters,
				value.poseWorldXMeters,
				value.poseWorldZMeters,
				value.poseTangentX,
				value.poseTangentZ,
				value.poseYawRadians,
			].every((column) => isFiniteFloat64Array(column, count)) &&
			strictlyIncreasingFromZero(value.poseVehicleRows as Uint32Array)
		)
	) {
		return false;
	}
	const requestRows = value.poseRequestRows as Int32Array;
	const phases = value.poseVehiclePhaseCodes as Uint8Array;
	const legs = value.poseLegIndices as Int8Array;
	const sourcePortIds = value.poseSourcePortIds as Uint32Array;
	const destinationPortIds = value.poseDestinationPortIds as Uint32Array;
	const legDistances = value.poseLegDistancesMeters as Float64Array;
	const legAnchors = value.poseLegAnchorDistancesMeters as Float64Array;
	const cycleDistances = value.poseCycleDistancesMeters as Float64Array;
	const cycleAnchors = value.poseCycleAnchorDistancesMeters as Float64Array;
	const pathStations = value.posePathStationsMeters as Float64Array;
	const tangentX = value.poseTangentX as Float64Array;
	const tangentZ = value.poseTangentZ as Float64Array;
	const yaw = value.poseYawRadians as Float64Array;
	for (let row = 0; row < count; row++) {
		const phase = phases[row] as number;
		const leg = legs[row] as number;
		const requestRow = requestRows[row] as number;
		const moving = phase >= 2 && phase <= 4;
		const tangentLength = Math.hypot(tangentX[row] as number, tangentZ[row] as number);
		const yawDelta = wrappedAngleDelta(
			yaw[row] as number,
			Math.atan2(tangentZ[row] as number, tangentX[row] as number),
		);
		if (
			phase < 0 ||
			phase > 4 ||
			(moving ? requestRow < 0 || leg !== phase - 2 : requestRow !== -1 || leg !== -1) ||
			(sourcePortIds[row] as number) === 0 ||
			(destinationPortIds[row] as number) === 0 ||
			(moving && (legDistances[row] as number) <= 0) ||
			(legAnchors[row] as number) < 0 ||
			(legAnchors[row] as number) > (legDistances[row] as number) ||
			(cycleAnchors[row] as number) < 0 ||
			(cycleAnchors[row] as number) > (cycleDistances[row] as number) ||
			(pathStations[row] as number) < 0 ||
			Math.abs(tangentLength - 1) > 1e-9 ||
			Math.abs(yawDelta) > 1e-9
		) {
			return false;
		}
	}
	return true;
}

function validEventColumns(value: Record<string, unknown>, kind: "core" | "resource"): boolean {
	const total = value[`${kind}EventCount`];
	const published = value[`published${kind === "core" ? "Core" : "Resource"}EventCount`];
	const truncated = value[`${kind}EventsTruncated`];
	if (
		!isNonNegativeSafeInteger(total) ||
		!isNonNegativeSafeInteger(published) ||
		(published as number) > DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT ||
		(published as number) > (total as number) ||
		(published as number) !==
			Math.min(total as number, DETERMINISTIC_RESIDENT_RUNTIME_EVENT_TAIL_COUNT) ||
		truncated !== (total as number) > (published as number)
	) {
		return false;
	}
	const count = published as number;
	const prefix = kind === "core" ? "coreEvent" : "resourceEvent";
	const sequences = value[`${prefix}Sequences`] as Uint32Array;
	const times = value[`${prefix}TimesMicroseconds`] as Float64Array;
	const typeCodes = value[`${prefix}TypeCodes`] as Uint8Array;
	const expectedFirstSequence = (total as number) - count + 1;
	return (
		isUint32Array(value[`${prefix}Sequences`], count) &&
		isFiniteFloat64Array(value[`${prefix}TimesMicroseconds`], count) &&
		isUint8Array(value[`${prefix}TypeCodes`], count) &&
		isUint32Array(value[`${prefix}RequestRows`], count) &&
		(kind === "core" || isUint32Array(value.resourceEventResourceRows, count)) &&
		strictlyIncreasing(sequences) &&
		validEventTimes(times) &&
		validEventTypeCodes(typeCodes, kind) &&
		(count === 0 ||
			(sequences[0] === expectedFirstSequence && sequences[count - 1] === (total as number)))
	);
}

function vehiclePhaseCode(phase: string): number {
	const codes = {
		IDLE_AT_HOME: 0,
		WAITING_FOR_COMPLETE_CYCLE: 1,
		TO_PICKUP: 2,
		TO_DROPOFF: 3,
		RETURNING_HOME: 4,
	} as const;
	const code = codes[phase as keyof typeof codes];
	if (code === undefined) throw new Error(`Unknown resident vehicle phase ${phase}.`);
	return code;
}

export function deterministicResidentRuntimePublicationConfigurationError(
	configuration: unknown,
): string | null {
	if (!isRecord(configuration) || !hasExactKeys(configuration, CONFIGURATION_KEYS)) {
		return "resident runtime publication configuration contains missing or unexpected fields";
	}
	if (
		!validConfigurationValues(configuration.cadenceMicroseconds, configuration.maximumPoseCount)
	) {
		return "resident runtime publication configuration cadence or pose bound is invalid";
	}
	return null;
}

function assertConfiguration(configuration: DeterministicResidentRuntimePublicationConfiguration) {
	const error = deterministicResidentRuntimePublicationConfigurationError(configuration);
	if (error) {
		throw new RangeError("Resident runtime publication configuration is invalid.");
	}
}

function validPublicationRelationships(
	publication: DeterministicResidentRuntimePublication,
): boolean {
	const values = publication.kpiValues;
	const requestCount = values[DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.REQUEST_TOTAL - 1] as number;
	const vehicleCount = values[DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.VEHICLE_TOTAL - 1] as number;
	const requestPhaseTotal = sumFloat64(values, 1, 8);
	const servicePhaseTotal = sumFloat64(values, 8, 12);
	const vehiclePhaseTotal = sumFloat64(values, 13, 16);
	if (
		requestPhaseTotal !== requestCount ||
		servicePhaseTotal !== requestCount ||
		vehiclePhaseTotal !== vehicleCount ||
		publication.eligiblePoseCount !== vehicleCount ||
		publication.coreEventCount !==
			(values[DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.CORE_EVENT_COUNT - 1] as number) ||
		publication.resourceEventCount !==
			(values[DETERMINISTIC_RESIDENT_RUNTIME_KPI_CODE.RESOURCE_EVENT_COUNT - 1] as number) ||
		publication.coreEventCount > requestCount * 5 ||
		publication.resourceEventCount > requestCount * 6
	) {
		return false;
	}
	for (const requestRow of publication.poseRequestRows) {
		if (requestRow >= requestCount) return false;
	}
	return (
		validPublishedEventRows(publication, "core", requestCount) &&
		validPublishedEventRows(publication, "resource", requestCount)
	);
}

function validPublishedEventRows(
	publication: DeterministicResidentRuntimePublication,
	kind: "core" | "resource",
	requestCount: number,
): boolean {
	const times =
		kind === "core"
			? publication.coreEventTimesMicroseconds
			: publication.resourceEventTimesMicroseconds;
	const requestRows =
		kind === "core" ? publication.coreEventRequestRows : publication.resourceEventRequestRows;
	for (let row = 0; row < times.length; row++) {
		if (
			(times[row] as number) > publication.sampledSimulationTimeMicroseconds ||
			(requestRows[row] as number) >= requestCount
		) {
			return false;
		}
	}
	return true;
}

function validEventTimes(times: Float64Array): boolean {
	for (let row = 0; row < times.length; row++) {
		if (
			!Number.isSafeInteger(times[row]) ||
			(times[row] as number) < 0 ||
			(row > 0 && (times[row] as number) < (times[row - 1] as number))
		) {
			return false;
		}
	}
	return true;
}

function validEventTypeCodes(typeCodes: Uint8Array, kind: "core" | "resource"): boolean {
	const maximum =
		kind === "core"
			? Object.keys(DETERMINISTIC_RESIDENT_CORE_EVENT_TYPE).length
			: Object.keys(DETERMINISTIC_RESIDENT_RESOURCE_EVENT_TYPE).length;
	return typeCodes.every((code) => code >= 1 && code <= maximum);
}

function sumFloat64(values: Float64Array, start: number, end: number): number {
	let sum = 0;
	for (let row = start; row < end; row++) sum += values[row] as number;
	return sum;
}

function wrappedAngleDelta(left: number, right: number): number {
	return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

function validConfigurationValues(cadence: unknown, maximumPoseCount: unknown): boolean {
	return (
		isPositiveSafeInteger(cadence) &&
		(cadence as number) >= DETERMINISTIC_RESIDENT_RUNTIME_MINIMUM_CADENCE_MICROSECONDS &&
		(cadence as number) <= DETERMINISTIC_RESIDENT_RUNTIME_MAXIMUM_CADENCE_MICROSECONDS &&
		isPositiveSafeInteger(maximumPoseCount) &&
		(maximumPoseCount as number) <= DETERMINISTIC_RESIDENT_RUNTIME_MAXIMUM_POSE_COUNT
	);
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((sum, view) => sum + view.byteLength, 0);
}

function sameNumbers(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
	return true;
}

function strictlyIncreasing(values: Uint32Array): boolean {
	for (let index = 1; index < values.length; index++) {
		if ((values[index] as number) <= (values[index - 1] as number)) return false;
	}
	return true;
}

function strictlyIncreasingFromZero(values: Uint32Array): boolean {
	for (let index = 0; index < values.length; index++) if (values[index] !== index) return false;
	return true;
}

function isFiniteNonNegativeIntegerFloat64Array(value: unknown, length: number): boolean {
	return (
		isFiniteFloat64Array(value, length) &&
		[...(value as Float64Array)].every((entry) => Number.isSafeInteger(entry) && entry >= 0)
	);
}

function isFiniteFloat64Array(value: unknown, length: number): value is Float64Array {
	return (
		value instanceof Float64Array && value.length === length && [...value].every(Number.isFinite)
	);
}

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isInt32Array(value: unknown, length: number): value is Int32Array {
	return value instanceof Int32Array && value.length === length;
}

function isUint8Array(value: unknown, length: number): value is Uint8Array {
	return value instanceof Uint8Array && value.length === length;
}

function isInt8Array(value: unknown, length: number): value is Int8Array {
	return value instanceof Int8Array && value.length === length;
}

function isPositiveSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
