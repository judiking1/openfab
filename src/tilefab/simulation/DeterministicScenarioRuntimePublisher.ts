import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type {
	DeterministicScenarioMotionScheduler,
	DeterministicScenarioRuntimeKpiState,
} from "./DeterministicScenarioMotionScheduler";

export const DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_SCHEMA_VERSION = 1 as const;
export const DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_CADENCE_POLICY =
	"SIMULATION_TIME_DUE_OR_TERMINAL_ONE_SNAPSHOT_PER_POLL_V1" as const;
export const DETERMINISTIC_SCENARIO_RUNTIME_POSE_ORDER_POLICY =
	"IN_TRANSIT_REQUEST_ROW_ASCENDING_V1" as const;
export const DETERMINISTIC_SCENARIO_RUNTIME_MINIMUM_CADENCE_MICROSECONDS = 1_000;
export const DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_CADENCE_MICROSECONDS = 60_000_000;
export const DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_POSE_COUNT = 8_192;
export const DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE = Object.freeze({
	CADENCE: 1,
	TERMINAL: 2,
} as const);
export const DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE = Object.freeze({
	REQUEST_TOTAL: 1,
	REQUEST_WAITING_RELEASE: 2,
	REQUEST_WAITING_DEPENDENCY: 3,
	REQUEST_WAITING_LEASE: 4,
	REQUEST_ADMITTED: 5,
	REQUEST_IN_TRANSIT: 6,
	REQUEST_COMPLETED: 7,
	DESTINATION_SERVICE_NOT_STARTED: 8,
	DESTINATION_SERVICE_IN_SERVICE: 9,
	DESTINATION_SERVICE_READY: 10,
	CORE_EVENT_COUNT: 11,
	RESOURCE_EVENT_COUNT: 12,
	EQ_DESTINATION_REQUEST_COUNT: 13,
	EQ_NOT_ARRIVED: 14,
	EQ_QUEUED: 15,
	EQ_ACTIVE: 16,
	EQ_READY: 17,
	STORAGE_RESOURCE_COUNT: 18,
	STORAGE_OCCUPIED_UNITS: 19,
	STORAGE_RESERVED_UNITS: 20,
} as const);

const RUNTIME_PUBLICATION_KEYS = Object.freeze([
	"schemaVersion",
	"cadencePolicy",
	"poseOrderPolicy",
	"sequence",
	"triggerCode",
	"sourceRouteRequestsFingerprint",
	"runIdentityFingerprint",
	"resourceExecutionPrepared",
	"cadenceMicroseconds",
	"maximumPoseCount",
	"scheduledPublicationTimeMicroseconds",
	"sampledSimulationTimeMicroseconds",
	"skippedCadenceCount",
	"eligiblePoseCount",
	"publishedPoseCount",
	"posesTruncated",
	"kpiCount",
	"poseRequestRows",
	"poseVehicleTokenIds",
	"poseSourcePortIds",
	"poseDestinationPortIds",
	"posePathRows",
	"poseRouteDistancesMeters",
	"poseAnchorDistancesMeters",
	"posePathStationsMeters",
	"poseWorldXMeters",
	"poseWorldZMeters",
	"poseTangentX",
	"poseTangentZ",
	"poseYawRadians",
	"kpiCodes",
	"kpiValues",
	"fingerprint",
	"byteLength",
] as const);
const RUNTIME_PUBLICATION_CONFIGURATION_KEYS = Object.freeze([
	"cadenceMicroseconds",
	"maximumPoseCount",
] as const);
const RUNTIME_KPI_CODES = Uint8Array.from(Object.values(DETERMINISTIC_SCENARIO_RUNTIME_KPI_CODE));

export interface DeterministicScenarioRuntimePublicationConfiguration {
	readonly cadenceMicroseconds: number;
	readonly maximumPoseCount: number;
}

export interface DeterministicScenarioRuntimePublication {
	readonly schemaVersion: typeof DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_SCHEMA_VERSION;
	readonly cadencePolicy: typeof DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_CADENCE_POLICY;
	readonly poseOrderPolicy: typeof DETERMINISTIC_SCENARIO_RUNTIME_POSE_ORDER_POLICY;
	readonly sequence: number;
	readonly triggerCode: number;
	readonly sourceRouteRequestsFingerprint: string;
	readonly runIdentityFingerprint: string;
	readonly resourceExecutionPrepared: boolean;
	readonly cadenceMicroseconds: number;
	readonly maximumPoseCount: number;
	readonly scheduledPublicationTimeMicroseconds: number;
	readonly sampledSimulationTimeMicroseconds: number;
	readonly skippedCadenceCount: number;
	readonly eligiblePoseCount: number;
	readonly publishedPoseCount: number;
	readonly posesTruncated: boolean;
	readonly kpiCount: number;
	readonly poseRequestRows: Uint32Array;
	readonly poseVehicleTokenIds: Uint32Array;
	readonly poseSourcePortIds: Uint32Array;
	readonly poseDestinationPortIds: Uint32Array;
	readonly posePathRows: Uint32Array;
	readonly poseRouteDistancesMeters: Float64Array;
	readonly poseAnchorDistancesMeters: Float64Array;
	readonly posePathStationsMeters: Float64Array;
	readonly poseWorldXMeters: Float64Array;
	readonly poseWorldZMeters: Float64Array;
	readonly poseTangentX: Float64Array;
	readonly poseTangentZ: Float64Array;
	readonly poseYawRadians: Float64Array;
	readonly kpiCodes: Uint8Array;
	readonly kpiValues: Float64Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

/**
 * Read-only simulation-time publication boundary. Polling never advances or mutates the scheduler;
 * it only copies a bounded canonical pose prefix and O(1) aggregate KPI counters.
 */
export class DeterministicScenarioRuntimePublisher {
	readonly cadencePolicy = DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_CADENCE_POLICY;
	readonly poseOrderPolicy = DETERMINISTIC_SCENARIO_RUNTIME_POSE_ORDER_POLICY;
	private readonly scheduler: DeterministicScenarioMotionScheduler;
	private readonly configuration: DeterministicScenarioRuntimePublicationConfiguration;
	private nextPublicationTimeMicroseconds = 0;
	private sequence = 0;
	private terminalPublished = false;

	constructor(
		scheduler: DeterministicScenarioMotionScheduler,
		configuration: DeterministicScenarioRuntimePublicationConfiguration,
	) {
		assertPublicationConfiguration(configuration);
		this.scheduler = scheduler;
		this.configuration = Object.freeze({ ...configuration });
	}

	get nextScheduledPublicationTimeMicroseconds(): number {
		return this.terminalPublished ? Number.POSITIVE_INFINITY : this.nextPublicationTimeMicroseconds;
	}

	publishIfDue(): DeterministicScenarioRuntimePublication | null {
		if (this.terminalPublished) return null;
		const sampledTime = this.scheduler.currentTimeMicroseconds;
		const terminal = this.scheduler.allScenarioWorkCompleted;
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
				throw new RangeError("Scenario runtime publication cadence exceeded safe integer time.");
			}
		}

		const publication = this.compilePublication(
			terminal
				? DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL
				: DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE,
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
	): DeterministicScenarioRuntimePublication {
		const kpis = this.scheduler.runtimeKpiState();
		const eligiblePoseCount = kpis.requestInTransitCount;
		const publishedPoseCount = Math.min(eligiblePoseCount, this.configuration.maximumPoseCount);
		const poses = createPoseColumns(publishedPoseCount);
		let poseRow = 0;
		for (
			let requestRow = 0;
			requestRow < this.scheduler.requestCount && poseRow < publishedPoseCount;
			requestRow++
		) {
			if (!this.scheduler.requestIsMoving(requestRow)) continue;
			const motion = this.scheduler.motionState(requestRow);
			const pose = this.scheduler.worldPose(requestRow);
			if (!motion.moving || motion.vehicleTokenId === null) {
				throw new Error(`Scenario request row ${requestRow} moving-pose state is inconsistent.`);
			}
			poses.requestRows[poseRow] = requestRow;
			poses.vehicleTokenIds[poseRow] = motion.vehicleTokenId;
			poses.sourcePortIds[poseRow] = pose.sourcePortId;
			poses.destinationPortIds[poseRow] = pose.destinationPortId;
			poses.pathRows[poseRow] = pose.pathRow;
			poses.routeDistancesMeters[poseRow] = pose.routeDistanceMeters;
			poses.anchorDistancesMeters[poseRow] = pose.anchorDistanceMeters;
			poses.pathStationsMeters[poseRow] = pose.pathStationMeters;
			poses.worldXMeters[poseRow] = pose.worldXMeters;
			poses.worldZMeters[poseRow] = pose.worldZMeters;
			poses.tangentX[poseRow] = pose.tangentX;
			poses.tangentZ[poseRow] = pose.tangentZ;
			poses.yawRadians[poseRow] = pose.yawRadians;
			poseRow++;
		}
		if (poseRow !== publishedPoseCount) {
			throw new Error("Scenario moving-pose count does not match runtime KPI accounting.");
		}

		const kpiCodes = RUNTIME_KPI_CODES.slice();
		const kpiValues = runtimeKpiValues(kpis);
		const sequence = this.sequence + 1;
		if (!Number.isSafeInteger(sequence)) {
			throw new RangeError("Scenario runtime publication sequence is unsafe.");
		}
		const partial = {
			schemaVersion: DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_SCHEMA_VERSION,
			cadencePolicy: DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_CADENCE_POLICY,
			poseOrderPolicy: DETERMINISTIC_SCENARIO_RUNTIME_POSE_ORDER_POLICY,
			sequence,
			triggerCode,
			sourceRouteRequestsFingerprint: this.scheduler.sourceRouteRequestsFingerprint,
			runIdentityFingerprint: this.scheduler.runIdentityFingerprint,
			resourceExecutionPrepared: this.scheduler.resourceExecutionPrepared,
			cadenceMicroseconds: this.configuration.cadenceMicroseconds,
			maximumPoseCount: this.configuration.maximumPoseCount,
			scheduledPublicationTimeMicroseconds,
			sampledSimulationTimeMicroseconds,
			skippedCadenceCount,
			eligiblePoseCount,
			publishedPoseCount,
			posesTruncated: eligiblePoseCount > publishedPoseCount,
			kpiCount: kpiCodes.length,
			poseRequestRows: poses.requestRows,
			poseVehicleTokenIds: poses.vehicleTokenIds,
			poseSourcePortIds: poses.sourcePortIds,
			poseDestinationPortIds: poses.destinationPortIds,
			posePathRows: poses.pathRows,
			poseRouteDistancesMeters: poses.routeDistancesMeters,
			poseAnchorDistancesMeters: poses.anchorDistancesMeters,
			posePathStationsMeters: poses.pathStationsMeters,
			poseWorldXMeters: poses.worldXMeters,
			poseWorldZMeters: poses.worldZMeters,
			poseTangentX: poses.tangentX,
			poseTangentZ: poses.tangentZ,
			poseYawRadians: poses.yawRadians,
			kpiCodes,
			kpiValues,
		};
		const views = runtimePublicationViews(partial);
		const publication = Object.freeze({
			...partial,
			fingerprint: checksumRuntimePublication(partial),
			byteLength: views.reduce((sum, view) => sum + view.byteLength, 0),
		});
		const error = deterministicScenarioRuntimePublicationError(publication);
		if (error) throw new Error(`Scenario runtime publication is invalid: ${error}`);
		this.sequence = sequence;
		return publication;
	}
}

export function deterministicScenarioRuntimePublicationError(value: unknown): string | null {
	if (!isRecord(value)) return "runtime publication must be an object";
	if (!hasExactKeys(value, RUNTIME_PUBLICATION_KEYS)) {
		return "runtime publication contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_SCHEMA_VERSION ||
		value.cadencePolicy !== DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_CADENCE_POLICY ||
		value.poseOrderPolicy !== DETERMINISTIC_SCENARIO_RUNTIME_POSE_ORDER_POLICY ||
		(value.triggerCode !== DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.CADENCE &&
			value.triggerCode !== DETERMINISTIC_SCENARIO_RUNTIME_PUBLICATION_TRIGGER_CODE.TERMINAL) ||
		!isPositiveSafeInteger(value.sequence) ||
		!isNonEmptyString(value.sourceRouteRequestsFingerprint) ||
		!isNonEmptyString(value.runIdentityFingerprint) ||
		typeof value.resourceExecutionPrepared !== "boolean"
	) {
		return "runtime publication identity or policy is invalid";
	}
	if (
		!validCadence(value.cadenceMicroseconds) ||
		!validMaximumPoseCount(value.maximumPoseCount) ||
		!isNonNegativeSafeInteger(value.scheduledPublicationTimeMicroseconds) ||
		!isNonNegativeSafeInteger(value.sampledSimulationTimeMicroseconds) ||
		(value.scheduledPublicationTimeMicroseconds as number) >
			(value.sampledSimulationTimeMicroseconds as number) ||
		!isNonNegativeSafeInteger(value.skippedCadenceCount) ||
		!isNonNegativeSafeInteger(value.eligiblePoseCount) ||
		!isNonNegativeSafeInteger(value.publishedPoseCount) ||
		(value.publishedPoseCount as number) > (value.maximumPoseCount as number) ||
		(value.publishedPoseCount as number) > (value.eligiblePoseCount as number) ||
		value.posesTruncated !==
			(value.eligiblePoseCount as number) > (value.publishedPoseCount as number) ||
		value.kpiCount !== RUNTIME_KPI_CODES.length
	) {
		return "runtime publication cadence or counts are invalid";
	}
	const poseCount = value.publishedPoseCount as number;
	if (
		!isUint32Array(value.poseRequestRows, poseCount) ||
		!isUint32Array(value.poseVehicleTokenIds, poseCount) ||
		!isUint32Array(value.poseSourcePortIds, poseCount) ||
		!isUint32Array(value.poseDestinationPortIds, poseCount) ||
		!isUint32Array(value.posePathRows, poseCount) ||
		!isFiniteFloat64Array(value.poseRouteDistancesMeters, poseCount) ||
		!isFiniteFloat64Array(value.poseAnchorDistancesMeters, poseCount) ||
		!isFiniteFloat64Array(value.posePathStationsMeters, poseCount) ||
		!isFiniteFloat64Array(value.poseWorldXMeters, poseCount) ||
		!isFiniteFloat64Array(value.poseWorldZMeters, poseCount) ||
		!isFiniteFloat64Array(value.poseTangentX, poseCount) ||
		!isFiniteFloat64Array(value.poseTangentZ, poseCount) ||
		!isFiniteFloat64Array(value.poseYawRadians, poseCount) ||
		!isUint8Array(value.kpiCodes, RUNTIME_KPI_CODES.length) ||
		!isFiniteNonNegativeIntegerFloat64Array(value.kpiValues, RUNTIME_KPI_CODES.length)
	) {
		return "runtime publication typed columns are malformed";
	}
	const publication = value as unknown as DeterministicScenarioRuntimePublication;
	if (
		!strictlyIncreasing(publication.poseRequestRows) ||
		!positiveValues(publication.poseVehicleTokenIds) ||
		!positiveValues(publication.poseSourcePortIds) ||
		!positiveValues(publication.poseDestinationPortIds) ||
		!validPoseDistances(publication) ||
		!sameUint8(publication.kpiCodes, RUNTIME_KPI_CODES) ||
		!validKpiRelationships(publication)
	) {
		return "runtime publication pose or KPI rows are inconsistent";
	}
	const views = runtimePublicationViews(publication);
	if (new Set(views.map((view) => view.buffer)).size !== views.length) {
		return "runtime publication typed buffers are not independently owned";
	}
	if (publication.byteLength !== views.reduce((sum, view) => sum + view.byteLength, 0)) {
		return "runtime publication byte length is invalid";
	}
	if (
		!isNonEmptyString(publication.fingerprint) ||
		checksumRuntimePublication(publication) !== publication.fingerprint
	) {
		return "runtime publication fingerprint is invalid";
	}
	return null;
}

export function deterministicScenarioRuntimePublicationTransfers(
	publication: DeterministicScenarioRuntimePublication,
): readonly ArrayBuffer[] {
	const error = deterministicScenarioRuntimePublicationError(publication);
	if (error) throw new Error(`Scenario runtime publication is invalid: ${error}`);
	return Object.freeze(
		runtimePublicationViews(publication).map((view) => {
			if (!(view.buffer instanceof ArrayBuffer)) {
				throw new Error("Scenario runtime publication contains a shared buffer.");
			}
			return view.buffer;
		}),
	);
}

function assertPublicationConfiguration(
	value: DeterministicScenarioRuntimePublicationConfiguration,
): void {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, RUNTIME_PUBLICATION_CONFIGURATION_KEYS) ||
		!validCadence(value.cadenceMicroseconds) ||
		!validMaximumPoseCount(value.maximumPoseCount)
	) {
		throw new Error(
			`Scenario runtime publication requires cadence ${DETERMINISTIC_SCENARIO_RUNTIME_MINIMUM_CADENCE_MICROSECONDS}-${DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_CADENCE_MICROSECONDS} microseconds and 1-${DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_POSE_COUNT} poses.`,
		);
	}
}

function createPoseColumns(length: number) {
	return {
		requestRows: new Uint32Array(length),
		vehicleTokenIds: new Uint32Array(length),
		sourcePortIds: new Uint32Array(length),
		destinationPortIds: new Uint32Array(length),
		pathRows: new Uint32Array(length),
		routeDistancesMeters: new Float64Array(length),
		anchorDistancesMeters: new Float64Array(length),
		pathStationsMeters: new Float64Array(length),
		worldXMeters: new Float64Array(length),
		worldZMeters: new Float64Array(length),
		tangentX: new Float64Array(length),
		tangentZ: new Float64Array(length),
		yawRadians: new Float64Array(length),
	};
}

function runtimeKpiValues(kpis: DeterministicScenarioRuntimeKpiState): Float64Array {
	return Float64Array.from([
		kpis.requestCount,
		kpis.requestWaitingReleaseCount,
		kpis.requestWaitingDependencyCount,
		kpis.requestWaitingLeaseCount,
		kpis.requestAdmittedCount,
		kpis.requestInTransitCount,
		kpis.requestCompletedCount,
		kpis.destinationServiceNotStartedCount,
		kpis.destinationServiceInServiceCount,
		kpis.destinationServiceReadyCount,
		kpis.coreEventCount,
		kpis.resourceEventCount,
		kpis.eqDestinationRequestCount,
		kpis.eqNotArrivedCount,
		kpis.eqQueuedCount,
		kpis.eqActiveCount,
		kpis.eqReadyCount,
		kpis.storageResourceCount,
		kpis.storageOccupiedUnits,
		kpis.storageReservedUnits,
	]);
}

type RuntimePublicationColumns = Pick<
	DeterministicScenarioRuntimePublication,
	| "poseRequestRows"
	| "poseVehicleTokenIds"
	| "poseSourcePortIds"
	| "poseDestinationPortIds"
	| "posePathRows"
	| "poseRouteDistancesMeters"
	| "poseAnchorDistancesMeters"
	| "posePathStationsMeters"
	| "poseWorldXMeters"
	| "poseWorldZMeters"
	| "poseTangentX"
	| "poseTangentZ"
	| "poseYawRadians"
	| "kpiCodes"
	| "kpiValues"
>;

function runtimePublicationViews(value: RuntimePublicationColumns): readonly ArrayBufferView[] {
	return [
		value.poseRequestRows,
		value.poseVehicleTokenIds,
		value.poseSourcePortIds,
		value.poseDestinationPortIds,
		value.posePathRows,
		value.poseRouteDistancesMeters,
		value.poseAnchorDistancesMeters,
		value.posePathStationsMeters,
		value.poseWorldXMeters,
		value.poseWorldZMeters,
		value.poseTangentX,
		value.poseTangentZ,
		value.poseYawRadians,
		value.kpiCodes,
		value.kpiValues,
	];
}

type RuntimePublicationChecksumSource = Omit<
	DeterministicScenarioRuntimePublication,
	"fingerprint" | "byteLength"
>;

function checksumRuntimePublication(value: RuntimePublicationChecksumSource): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		value.cadencePolicy,
		value.poseOrderPolicy,
		value.sourceRouteRequestsFingerprint,
		value.runIdentityFingerprint,
	]);
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
		value.resourceExecutionPrepared ? 1 : 0,
		value.kpiCount,
	]);
	checksum.addViews(runtimePublicationViews(value));
	return checksum.digest();
}

function validPoseDistances(publication: DeterministicScenarioRuntimePublication): boolean {
	for (let row = 0; row < publication.publishedPoseCount; row++) {
		const route = publication.poseRouteDistancesMeters[row] as number;
		const anchor = publication.poseAnchorDistancesMeters[row] as number;
		const tangentLength = Math.hypot(
			publication.poseTangentX[row] as number,
			publication.poseTangentZ[row] as number,
		);
		if (route <= 0 || anchor < 0 || anchor > route || Math.abs(tangentLength - 1) > 1e-9) {
			return false;
		}
	}
	return true;
}

function validKpiRelationships(publication: DeterministicScenarioRuntimePublication): boolean {
	const values = publication.kpiValues;
	const requestCount = values[0] as number;
	const requestPhaseTotal = sumFloat64(values, 1, 7);
	const destinationServiceTotal = sumFloat64(values, 7, 10);
	const eqDestinationCount = values[12] as number;
	const eqPhaseTotal = sumFloat64(values, 13, 17);
	return (
		requestPhaseTotal === requestCount &&
		destinationServiceTotal === requestCount &&
		eqPhaseTotal === eqDestinationCount &&
		publication.eligiblePoseCount === values[5] &&
		publication.poseRequestRows.every((requestRow) => requestRow < requestCount)
	);
}

function sumFloat64(values: Float64Array, start: number, end: number): number {
	let sum = 0;
	for (let row = start; row < end; row++) sum += values[row] as number;
	return sum;
}

function validCadence(value: unknown): boolean {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= DETERMINISTIC_SCENARIO_RUNTIME_MINIMUM_CADENCE_MICROSECONDS &&
		(value as number) <= DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_CADENCE_MICROSECONDS
	);
}

function validMaximumPoseCount(value: unknown): boolean {
	return (
		Number.isSafeInteger(value) &&
		(value as number) > 0 &&
		(value as number) <= DETERMINISTIC_SCENARIO_RUNTIME_MAXIMUM_POSE_COUNT
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isUint8Array(value: unknown, length: number): value is Uint8Array {
	return value instanceof Uint8Array && value.length === length;
}

function isFiniteFloat64Array(value: unknown, length: number): value is Float64Array {
	return value instanceof Float64Array && value.length === length && value.every(Number.isFinite);
}

function isFiniteNonNegativeIntegerFloat64Array(
	value: unknown,
	length: number,
): value is Float64Array {
	return (
		value instanceof Float64Array &&
		value.length === length &&
		value.every((item) => Number.isSafeInteger(item) && item >= 0)
	);
}

function strictlyIncreasing(values: Uint32Array): boolean {
	for (let row = 1; row < values.length; row++) {
		if ((values[row] as number) <= (values[row - 1] as number)) return false;
	}
	return true;
}

function positiveValues(values: Uint32Array): boolean {
	return values.every((value) => value > 0);
}

function sameUint8(left: Uint8Array, right: Uint8Array): boolean {
	return left.length === right.length && left.every((value, row) => value === right[row]);
}
