import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "./SimulationReadinessCertificate";
import {
	type SimulationScenarioManifest,
	simulationScenarioManifestError,
} from "./SimulationScenarioManifest";
import {
	type SimulationScenarioRouteRequests,
	simulationScenarioRouteRequestsError,
	simulationScenarioRouteRequestsMatchSources,
	simulationScenarioRouteRequestsMatchValidatedSources,
} from "./SimulationScenarioRouteRequests";
import type { SimulationStaticWorldFoundation } from "./SimulationStaticWorldFoundation";
import {
	SIMULATION_TRACK_ACQUISITION_POLICY,
	SIMULATION_TRACK_DEADLOCK_POLICY,
	SIMULATION_TRACK_FAIRNESS_POLICY,
	SIMULATION_TRACK_LEASE_SCOPE,
	SIMULATION_TRACK_RELEASE_POLICY,
	SIMULATION_TRACK_ROUTE_MUTATION_POLICY,
	SIMULATION_TRACK_SWITCH_POLICY,
} from "./SimulationTrackOccupancyPolicy";
import type { SimulationTrackResourceTopology } from "./SimulationTrackResourceTopology";

export const SIMULATION_SCENARIO_LEASE_CLAIMS_SCHEMA_VERSION = 1 as const;
export const SIMULATION_SCENARIO_LEASE_EXTENSION_POLICY =
	"UNIQUE_DIRECTED_BOUNDARY_EXTENSION_OR_FAIL_CLOSED_V1" as const;
export const SIMULATION_SCENARIO_MAX_LEASE_CLAIM_TYPED_BYTES = 128 * 1024 * 1024;
export const SIMULATION_SCENARIO_LEASE_MISSING_RUNTIME_LAYERS = Object.freeze([
	"VEHICLE_TOKEN_ALLOCATION",
	"FOUP_CUSTODY",
] as const);

const STATION_EPSILON_METERS = 1e-4;
const SIMULATION_SCENARIO_LEASE_CLAIM_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingRuntimeLayers",
	"extensionPolicy",
	"leaseScope",
	"acquisitionPolicy",
	"fairnessPolicy",
	"deadlockPolicy",
	"releasePolicy",
	"switchPolicy",
	"routeMutationPolicy",
	"partialAcquisitionAllowed",
	"waitingRequestMayHoldRouteResources",
	"sourceKind",
	"sourceRouteRequestsFingerprint",
	"sourceCertificateFingerprint",
	"sourceTrackResourceTopologyFingerprint",
	"sourceOccupancyPolicyFingerprint",
	"runIdentityFingerprint",
	"frontLeaseExtensionMillimeters",
	"rearLeaseExtensionMillimeters",
	"requestCount",
	"routeLeaseLengthsMeters",
	"leaseTrackResourceOffsets",
	"leaseTrackResourceRows",
	"orderedTrackOccurrenceOffsets",
	"orderedTrackOccurrenceResourceRows",
	"orderedTrackOccurrenceStartsMeters",
	"orderedTrackOccurrenceEndsMeters",
	"movementClaimOffsets",
	"movementClaimRows",
	"switchConflictClaimOffsets",
	"switchConflictClaimRows",
	"fingerprint",
	"byteLength",
] as const);

/**
 * Immutable safety input for a later admission controller. Track rows are acquired together with
 * switch-conflict rows under the copied policy literals; this artifact does not perform admission.
 */
export interface SimulationScenarioLeaseClaims {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_LEASE_CLAIMS_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingRuntimeLayers: typeof SIMULATION_SCENARIO_LEASE_MISSING_RUNTIME_LAYERS;
	readonly extensionPolicy: typeof SIMULATION_SCENARIO_LEASE_EXTENSION_POLICY;
	readonly leaseScope: typeof SIMULATION_TRACK_LEASE_SCOPE;
	readonly acquisitionPolicy: typeof SIMULATION_TRACK_ACQUISITION_POLICY;
	readonly fairnessPolicy: typeof SIMULATION_TRACK_FAIRNESS_POLICY;
	readonly deadlockPolicy: typeof SIMULATION_TRACK_DEADLOCK_POLICY;
	readonly releasePolicy: typeof SIMULATION_TRACK_RELEASE_POLICY;
	readonly switchPolicy: typeof SIMULATION_TRACK_SWITCH_POLICY;
	readonly routeMutationPolicy: typeof SIMULATION_TRACK_ROUTE_MUTATION_POLICY;
	readonly partialAcquisitionAllowed: false;
	readonly waitingRequestMayHoldRouteResources: false;
	readonly sourceKind: SimulationScenarioManifest["sourceKind"];
	readonly sourceRouteRequestsFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly sourceTrackResourceTopologyFingerprint: string;
	readonly sourceOccupancyPolicyFingerprint: string;
	readonly runIdentityFingerprint: string;
	readonly frontLeaseExtensionMillimeters: number;
	readonly rearLeaseExtensionMillimeters: number;
	readonly requestCount: number;
	/** Source-to-destination distance plus both longitudinal extensions. */
	readonly routeLeaseLengthsMeters: Float64Array;
	/** Canonically sorted, unique track-resource rows acquired atomically per request. */
	readonly leaseTrackResourceOffsets: Uint32Array;
	readonly leaseTrackResourceRows: Uint32Array;
	/** Route-ordered occurrences used for rear-clear release timing; starts are source-relative. */
	readonly orderedTrackOccurrenceOffsets: Uint32Array;
	readonly orderedTrackOccurrenceResourceRows: Uint32Array;
	readonly orderedTrackOccurrenceStartsMeters: Float64Array;
	readonly orderedTrackOccurrenceEndsMeters: Float64Array;
	/** Exact selected rows in the certified advanced-switch movement topology. */
	readonly movementClaimOffsets: Uint32Array;
	readonly movementClaimRows: Uint32Array;
	/** Canonically sorted, unique switch-conflict rows acquired with the track bundle. */
	readonly switchConflictClaimOffsets: Uint32Array;
	readonly switchConflictClaimRows: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

export interface SimulationRoutePathInterval {
	readonly pathRow: number;
	readonly start: number;
	readonly end: number;
	readonly routeStart: number;
}

interface MutableRoutePathInterval {
	readonly pathRow: number;
	start: number;
	end: number;
}

interface LeaseBundleDraft {
	readonly routeLeaseLengthMeters: number;
	readonly leaseTrackResourceRows: readonly number[];
	readonly occurrenceResourceRows: readonly number[];
	readonly occurrenceStartsMeters: readonly number[];
	readonly occurrenceEndsMeters: readonly number[];
	readonly movementClaimRows: readonly number[];
	readonly switchConflictClaimRows: readonly number[];
}

export interface SimulationSwitchClaimIndex {
	readonly movementRowsByFirstPath: ReadonlyMap<number, readonly number[]>;
	readonly switchConflictRowsByTrackResource: ReadonlyMap<number, readonly number[]>;
}

interface LeaseCompileIndex extends SimulationSwitchClaimIndex {
	readonly incomingPathRows: readonly (readonly number[])[];
}

/**
 * Extends every accepted route by the certified vehicle clearances and compiles its atomic lease.
 * The caller should run this behind the disposable scenario-preparation Worker boundary.
 */
export function compileSimulationScenarioLeaseClaims(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
): SimulationScenarioLeaseClaims {
	assertCompatibleSources(snapshot, manifest, routes);
	const compileIndex = buildLeaseCompileIndex(snapshot);
	const routeBundles: LeaseBundleDraft[] = new Array(routes.requestCount);
	const bundleByStationPair = new Map<string, LeaseBundleDraft>();
	let leaseTrackResourceRowCount = 0;
	let occurrenceCount = 0;
	let movementClaimCount = 0;
	let switchConflictClaimCount = 0;

	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const key = `${routes.sourceStationRows[requestRow]}:${routes.destinationStationRows[requestRow]}`;
		let bundle = bundleByStationPair.get(key);
		if (!bundle) {
			bundle = compileLeaseBundle(snapshot, routes, requestRow, compileIndex);
			bundleByStationPair.set(key, bundle);
		}
		routeBundles[requestRow] = bundle;
		leaseTrackResourceRowCount += bundle.leaseTrackResourceRows.length;
		occurrenceCount += bundle.occurrenceResourceRows.length;
		movementClaimCount += bundle.movementClaimRows.length;
		switchConflictClaimCount += bundle.switchConflictClaimRows.length;
		assertLeaseTypedMemoryLimit(
			routes.requestCount,
			leaseTrackResourceRowCount,
			occurrenceCount,
			movementClaimCount,
			switchConflictClaimCount,
		);
	}

	const routeLeaseLengthsMeters = new Float64Array(routes.requestCount);
	const leaseTrackResourceOffsets = new Uint32Array(routes.requestCount + 1);
	const leaseTrackResourceRows = new Uint32Array(leaseTrackResourceRowCount);
	const orderedTrackOccurrenceOffsets = new Uint32Array(routes.requestCount + 1);
	const orderedTrackOccurrenceResourceRows = new Uint32Array(occurrenceCount);
	const orderedTrackOccurrenceStartsMeters = new Float64Array(occurrenceCount);
	const orderedTrackOccurrenceEndsMeters = new Float64Array(occurrenceCount);
	const movementClaimOffsets = new Uint32Array(routes.requestCount + 1);
	const movementClaimRows = new Uint32Array(movementClaimCount);
	const switchConflictClaimOffsets = new Uint32Array(routes.requestCount + 1);
	const switchConflictClaimRows = new Uint32Array(switchConflictClaimCount);
	let leaseCursor = 0;
	let occurrenceCursor = 0;
	let movementCursor = 0;
	let switchCursor = 0;
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const bundle = routeBundles[requestRow] as LeaseBundleDraft;
		routeLeaseLengthsMeters[requestRow] = bundle.routeLeaseLengthMeters;
		leaseTrackResourceOffsets[requestRow] = leaseCursor;
		leaseTrackResourceRows.set(bundle.leaseTrackResourceRows, leaseCursor);
		leaseCursor += bundle.leaseTrackResourceRows.length;
		orderedTrackOccurrenceOffsets[requestRow] = occurrenceCursor;
		orderedTrackOccurrenceResourceRows.set(bundle.occurrenceResourceRows, occurrenceCursor);
		orderedTrackOccurrenceStartsMeters.set(bundle.occurrenceStartsMeters, occurrenceCursor);
		orderedTrackOccurrenceEndsMeters.set(bundle.occurrenceEndsMeters, occurrenceCursor);
		occurrenceCursor += bundle.occurrenceResourceRows.length;
		movementClaimOffsets[requestRow] = movementCursor;
		movementClaimRows.set(bundle.movementClaimRows, movementCursor);
		movementCursor += bundle.movementClaimRows.length;
		switchConflictClaimOffsets[requestRow] = switchCursor;
		switchConflictClaimRows.set(bundle.switchConflictClaimRows, switchCursor);
		switchCursor += bundle.switchConflictClaimRows.length;
	}
	leaseTrackResourceOffsets[routes.requestCount] = leaseCursor;
	orderedTrackOccurrenceOffsets[routes.requestCount] = occurrenceCursor;
	movementClaimOffsets[routes.requestCount] = movementCursor;
	switchConflictClaimOffsets[routes.requestCount] = switchCursor;

	const policy = snapshot.occupancyPolicy;
	const claimsWithoutIdentity = {
		schemaVersion: SIMULATION_SCENARIO_LEASE_CLAIMS_SCHEMA_VERSION,
		simulationRunnable: false,
		missingRuntimeLayers: SIMULATION_SCENARIO_LEASE_MISSING_RUNTIME_LAYERS,
		extensionPolicy: SIMULATION_SCENARIO_LEASE_EXTENSION_POLICY,
		leaseScope: policy.leaseScope,
		acquisitionPolicy: policy.acquisitionPolicy,
		fairnessPolicy: policy.fairnessPolicy,
		deadlockPolicy: policy.deadlockPolicy,
		releasePolicy: policy.releasePolicy,
		switchPolicy: policy.switchPolicy,
		routeMutationPolicy: policy.routeMutationPolicy,
		partialAcquisitionAllowed: policy.partialAcquisitionAllowed,
		waitingRequestMayHoldRouteResources: policy.waitingRequestMayHoldRouteResources,
		sourceKind: routes.sourceKind,
		sourceRouteRequestsFingerprint: routes.fingerprint,
		sourceCertificateFingerprint: snapshot.certificate.fingerprint,
		sourceTrackResourceTopologyFingerprint: snapshot.trackResources.fingerprint,
		sourceOccupancyPolicyFingerprint: policy.fingerprint,
		runIdentityFingerprint: routes.runIdentityFingerprint,
		frontLeaseExtensionMillimeters: policy.frontLeaseExtensionMillimeters,
		rearLeaseExtensionMillimeters: policy.rearLeaseExtensionMillimeters,
		requestCount: routes.requestCount,
		routeLeaseLengthsMeters,
		leaseTrackResourceOffsets,
		leaseTrackResourceRows,
		orderedTrackOccurrenceOffsets,
		orderedTrackOccurrenceResourceRows,
		orderedTrackOccurrenceStartsMeters,
		orderedTrackOccurrenceEndsMeters,
		movementClaimOffsets,
		movementClaimRows,
		switchConflictClaimOffsets,
		switchConflictClaimRows,
	} as const;
	const views = simulationScenarioLeaseClaimViews(claimsWithoutIdentity);
	const claims = Object.freeze({
		...claimsWithoutIdentity,
		fingerprint: checksumSimulationScenarioLeaseClaims(claimsWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationScenarioLeaseClaims;
	const error = simulationScenarioLeaseClaimsError(claims);
	if (error) throw new Error(`Compiled scenario lease claims are invalid: ${error}`);
	return claims;
}

export function checksumSimulationScenarioLeaseClaims(
	claims: Omit<SimulationScenarioLeaseClaims, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		claims.schemaVersion,
		claims.simulationRunnable ? 1 : 0,
		claims.partialAcquisitionAllowed ? 1 : 0,
		claims.waitingRequestMayHoldRouteResources ? 1 : 0,
		claims.frontLeaseExtensionMillimeters,
		claims.rearLeaseExtensionMillimeters,
		claims.requestCount,
	]);
	checksum.addStrings([
		...claims.missingRuntimeLayers,
		claims.extensionPolicy,
		claims.leaseScope,
		claims.acquisitionPolicy,
		claims.fairnessPolicy,
		claims.deadlockPolicy,
		claims.releasePolicy,
		claims.switchPolicy,
		claims.routeMutationPolicy,
		claims.sourceKind,
		claims.sourceRouteRequestsFingerprint,
		claims.sourceCertificateFingerprint,
		claims.sourceTrackResourceTopologyFingerprint,
		claims.sourceOccupancyPolicyFingerprint,
		claims.runIdentityFingerprint,
	]);
	checksum.addViews(simulationScenarioLeaseClaimViews(claims));
	return checksum.digest();
}

export function simulationScenarioLeaseClaimsError(value: unknown): string | null {
	if (!isRecord(value)) return "scenario lease claims must be an object";
	if (!hasExactKeys(value, SIMULATION_SCENARIO_LEASE_CLAIM_KEYS)) {
		return "scenario lease claims contain missing or unexpected fields";
	}
	if (value.schemaVersion !== SIMULATION_SCENARIO_LEASE_CLAIMS_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationRunnable !== false) return "lease claims cannot authorize a run";
	if (
		!Array.isArray(value.missingRuntimeLayers) ||
		value.missingRuntimeLayers.join("|") !==
			SIMULATION_SCENARIO_LEASE_MISSING_RUNTIME_LAYERS.join("|")
	) {
		return "missing runtime layers are invalid";
	}
	if (
		value.extensionPolicy !== SIMULATION_SCENARIO_LEASE_EXTENSION_POLICY ||
		value.leaseScope !== SIMULATION_TRACK_LEASE_SCOPE ||
		value.acquisitionPolicy !== SIMULATION_TRACK_ACQUISITION_POLICY ||
		value.fairnessPolicy !== SIMULATION_TRACK_FAIRNESS_POLICY ||
		value.deadlockPolicy !== SIMULATION_TRACK_DEADLOCK_POLICY ||
		value.releasePolicy !== SIMULATION_TRACK_RELEASE_POLICY ||
		value.switchPolicy !== SIMULATION_TRACK_SWITCH_POLICY ||
		value.routeMutationPolicy !== SIMULATION_TRACK_ROUTE_MUTATION_POLICY ||
		value.partialAcquisitionAllowed !== false ||
		value.waitingRequestMayHoldRouteResources !== false
	) {
		return "atomic lease protocol is invalid";
	}
	if (
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY") ||
		!isNonEmptyString(value.sourceRouteRequestsFingerprint) ||
		!isNonEmptyString(value.sourceCertificateFingerprint) ||
		!isNonEmptyString(value.sourceTrackResourceTopologyFingerprint) ||
		!isNonEmptyString(value.sourceOccupancyPolicyFingerprint) ||
		!isNonEmptyString(value.runIdentityFingerprint) ||
		!isUint32(value.frontLeaseExtensionMillimeters) ||
		!isUint32(value.rearLeaseExtensionMillimeters) ||
		!isNonNegativeSafeInteger(value.requestCount)
	) {
		return "lease source identity or extension is invalid";
	}
	const requestCount = value.requestCount as number;
	const leaseRowCount =
		value.leaseTrackResourceRows instanceof Uint32Array ? value.leaseTrackResourceRows.length : -1;
	const occurrenceCount =
		value.orderedTrackOccurrenceResourceRows instanceof Uint32Array
			? value.orderedTrackOccurrenceResourceRows.length
			: -1;
	const movementCount =
		value.movementClaimRows instanceof Uint32Array ? value.movementClaimRows.length : -1;
	const switchCount =
		value.switchConflictClaimRows instanceof Uint32Array
			? value.switchConflictClaimRows.length
			: -1;
	if (
		!isFloat64Array(value.routeLeaseLengthsMeters, requestCount) ||
		!isCsr(value.leaseTrackResourceOffsets, requestCount, leaseRowCount) ||
		!isUint32Array(value.leaseTrackResourceRows, leaseRowCount) ||
		!isCsr(value.orderedTrackOccurrenceOffsets, requestCount, occurrenceCount) ||
		!isUint32Array(value.orderedTrackOccurrenceResourceRows, occurrenceCount) ||
		!isFloat64Array(value.orderedTrackOccurrenceStartsMeters, occurrenceCount) ||
		!isFloat64Array(value.orderedTrackOccurrenceEndsMeters, occurrenceCount) ||
		!isCsr(value.movementClaimOffsets, requestCount, movementCount) ||
		!isUint32Array(value.movementClaimRows, movementCount) ||
		!isCsr(value.switchConflictClaimOffsets, requestCount, switchCount) ||
		!isUint32Array(value.switchConflictClaimRows, switchCount)
	) {
		return "lease claim columns are malformed";
	}
	const claims = value as unknown as SimulationScenarioLeaseClaims;
	if (!validPerRequestClaims(claims)) return "per-request lease claims are invalid";
	const views = simulationScenarioLeaseClaimViews(claims);
	if (!hasIndependentOwnedBuffers(views)) {
		return "lease claim columns are not independently transferable";
	}
	const byteLength = sumByteLengths(views);
	if (
		value.byteLength !== byteLength ||
		byteLength > SIMULATION_SCENARIO_MAX_LEASE_CLAIM_TYPED_BYTES
	) {
		return "lease claim typed-memory accounting is invalid";
	}
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationScenarioLeaseClaims(claims) !== value.fingerprint
	) {
		return "lease claim fingerprint is invalid";
	}
	return null;
}

export function simulationScenarioLeaseClaimsMatchSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	claims: SimulationScenarioLeaseClaims,
): boolean {
	return (
		publishedSimulationReadinessSnapshotError(snapshot) === null &&
		simulationScenarioManifestError(manifest) === null &&
		simulationScenarioRouteRequestsError(routes) === null &&
		simulationScenarioLeaseClaimsError(claims) === null &&
		simulationScenarioRouteRequestsMatchValidatedSources(snapshot, manifest, routes) &&
		simulationScenarioLeaseClaimsMatchValidatedSources(snapshot, routes, claims)
	);
}

/** Checks exact source binding after each supplied artifact has passed its own error validator. */
export function simulationScenarioLeaseClaimsMatchValidatedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
	claims: SimulationScenarioLeaseClaims,
): boolean {
	return (
		claims.sourceKind === routes.sourceKind &&
		claims.sourceRouteRequestsFingerprint === routes.fingerprint &&
		claims.sourceCertificateFingerprint === snapshot.certificate.fingerprint &&
		claims.sourceTrackResourceTopologyFingerprint === snapshot.trackResources.fingerprint &&
		claims.sourceOccupancyPolicyFingerprint === snapshot.occupancyPolicy.fingerprint &&
		claims.runIdentityFingerprint === routes.runIdentityFingerprint &&
		claims.frontLeaseExtensionMillimeters ===
			snapshot.occupancyPolicy.frontLeaseExtensionMillimeters &&
		claims.rearLeaseExtensionMillimeters ===
			snapshot.occupancyPolicy.rearLeaseExtensionMillimeters &&
		claims.requestCount === routes.requestCount &&
		claimsRowsWithinCertifiedDomains(snapshot, claims) &&
		claimsMatchRoutesAndTopology(snapshot, routes, claims)
	);
}

export function simulationScenarioLeaseClaimTransfers(
	claims: SimulationScenarioLeaseClaims,
): readonly ArrayBuffer[] {
	const error = simulationScenarioLeaseClaimsError(claims);
	if (error) throw new Error(`Simulation scenario lease claims are invalid: ${error}`);
	return simulationScenarioLeaseClaimViews(claims).map((view) => view.buffer as ArrayBuffer);
}

function compileLeaseBundle(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
	requestRow: number,
	compileIndex: LeaseCompileIndex,
): LeaseBundleDraft {
	const intervals = routePathIntervals(snapshot, routes, requestRow, compileIndex.incomingPathRows);
	const occurrenceResourceRows: number[] = [];
	const occurrenceStartsMeters: number[] = [];
	const occurrenceEndsMeters: number[] = [];
	const uniqueTrackRows = new Set<number>();
	for (const interval of intervals) {
		appendTrackOccurrences(
			snapshot,
			interval,
			occurrenceResourceRows,
			occurrenceStartsMeters,
			occurrenceEndsMeters,
			uniqueTrackRows,
		);
	}
	const movementClaims = compileSimulationSelectedMovementClaimsFromValidatedSources(
		snapshot.foundation,
		snapshot.trackResources,
		intervals,
		uniqueTrackRows,
		compileIndex,
	);
	const switchConflictClaimRows = [
		...new Set(
			movementClaims.map(
				(claim) =>
					snapshot.trackResources.movementConflictResourceRows[claim.movementRow] as number,
			),
		),
	].sort((left, right) => left - right);
	assertSimulationTouchedSwitchesClaimed(
		uniqueTrackRows,
		switchConflictClaimRows,
		compileIndex.switchConflictRowsByTrackResource,
	);
	const front = snapshot.occupancyPolicy.frontLeaseExtensionMillimeters / 1_000;
	const rear = snapshot.occupancyPolicy.rearLeaseExtensionMillimeters / 1_000;
	return Object.freeze({
		routeLeaseLengthMeters: routes.routeDistancesMeters[requestRow] + front + rear,
		leaseTrackResourceRows: Object.freeze([...uniqueTrackRows].sort((left, right) => left - right)),
		occurrenceResourceRows: Object.freeze(occurrenceResourceRows),
		occurrenceStartsMeters: Object.freeze(occurrenceStartsMeters),
		occurrenceEndsMeters: Object.freeze(occurrenceEndsMeters),
		movementClaimRows: Object.freeze(movementClaims.map((claim) => claim.movementRow)),
		switchConflictClaimRows: Object.freeze(switchConflictClaimRows),
	});
}

function routePathIntervals(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
	requestRow: number,
	incomingPathRows: readonly (readonly number[])[],
): readonly SimulationRoutePathInterval[] {
	const pathStart = routes.routePathOffsets[requestRow] as number;
	const pathEnd = routes.routePathOffsets[requestRow + 1] as number;
	const sourceStationRow = routes.sourceStationRows[requestRow] as number;
	const destinationStationRow = routes.destinationStationRows[requestRow] as number;
	const sourceStation = snapshot.foundation.stations.finalPathStationsMeters[
		sourceStationRow
	] as number;
	const destinationStation = snapshot.foundation.stations.finalPathStationsMeters[
		destinationStationRow
	] as number;
	const rear = snapshot.occupancyPolicy.rearLeaseExtensionMillimeters / 1_000;
	const front = snapshot.occupancyPolicy.frontLeaseExtensionMillimeters / 1_000;
	const drafts: MutableRoutePathInterval[] = [];
	for (let routeRow = pathStart; routeRow < pathEnd; routeRow++) {
		const pathRow = routes.routePathRows[routeRow] as number;
		drafts.push({
			pathRow,
			start: routeRow === pathStart ? sourceStation : 0,
			end:
				routeRow === pathEnd - 1
					? destinationStation
					: (snapshot.foundation.paths.lengths[pathRow] as number),
		});
	}
	extendRouteBackward(snapshot, drafts, rear, requestRow, incomingPathRows);
	extendRouteForward(snapshot, drafts, front, requestRow);
	const intervals: SimulationRoutePathInterval[] = [];
	let routeCursor = -rear;
	for (const draft of drafts) {
		if (draft.end <= draft.start + STATION_EPSILON_METERS) {
			throw new Error(`Scenario request row ${requestRow} has an empty extended path interval.`);
		}
		intervals.push(
			Object.freeze({
				pathRow: draft.pathRow,
				start: draft.start,
				end: draft.end,
				routeStart: routeCursor,
			}),
		);
		routeCursor += draft.end - draft.start;
	}
	const expectedEnd = (routes.routeDistancesMeters[requestRow] as number) + front;
	if (Math.abs(routeCursor - expectedEnd) > STATION_EPSILON_METERS) {
		throw new Error(`Scenario request row ${requestRow} lease extension changed route distance.`);
	}
	return Object.freeze(intervals);
}

function extendRouteBackward(
	snapshot: PublishedSimulationReadinessSnapshot,
	intervals: MutableRoutePathInterval[],
	distanceMeters: number,
	requestRow: number,
	incomingPathRows: readonly (readonly number[])[],
): void {
	let remaining = distanceMeters;
	while (remaining > STATION_EPSILON_METERS) {
		const first = intervals[0] as MutableRoutePathInterval;
		const available = first.start;
		if (available > STATION_EPSILON_METERS) {
			const extension = Math.min(available, remaining);
			first.start -= extension;
			remaining -= extension;
			continue;
		}
		const predecessors = incomingPathRows[first.pathRow] as readonly number[];
		if (predecessors.length !== 1) {
			throw new Error(
				`Scenario request row ${requestRow} needs an explicit predecessor path for its rear lease extension; found ${predecessors.length}.`,
			);
		}
		const pathRow = predecessors[0] as number;
		const pathLength = snapshot.foundation.paths.lengths[pathRow] as number;
		const extension = Math.min(pathLength, remaining);
		intervals.unshift({ pathRow, start: pathLength - extension, end: pathLength });
		remaining -= extension;
	}
}

function extendRouteForward(
	snapshot: PublishedSimulationReadinessSnapshot,
	intervals: MutableRoutePathInterval[],
	distanceMeters: number,
	requestRow: number,
): void {
	let remaining = distanceMeters;
	while (remaining > STATION_EPSILON_METERS) {
		const last = intervals[intervals.length - 1] as MutableRoutePathInterval;
		const pathLength = snapshot.foundation.paths.lengths[last.pathRow] as number;
		const available = pathLength - last.end;
		if (available > STATION_EPSILON_METERS) {
			const extension = Math.min(available, remaining);
			last.end += extension;
			remaining -= extension;
			continue;
		}
		const adjacencyStart = snapshot.foundation.paths.adjacencyOffsets[last.pathRow] as number;
		const adjacencyEnd = snapshot.foundation.paths.adjacencyOffsets[last.pathRow + 1] as number;
		if (adjacencyEnd - adjacencyStart !== 1) {
			throw new Error(
				`Scenario request row ${requestRow} needs an explicit continuation path for its front lease extension; found ${adjacencyEnd - adjacencyStart}.`,
			);
		}
		const pathRow = snapshot.foundation.paths.adjacencyTargets[adjacencyStart] as number;
		const extension = Math.min(snapshot.foundation.paths.lengths[pathRow] as number, remaining);
		intervals.push({ pathRow, start: 0, end: extension });
		remaining -= extension;
	}
}

function buildLeaseCompileIndex(snapshot: PublishedSimulationReadinessSnapshot): LeaseCompileIndex {
	const incoming: number[][] = Array.from(
		{ length: snapshot.foundation.paths.pathCount },
		() => [],
	);
	for (let pathRow = 0; pathRow < snapshot.foundation.paths.pathCount; pathRow++) {
		const start = snapshot.foundation.paths.adjacencyOffsets[pathRow] as number;
		const end = snapshot.foundation.paths.adjacencyOffsets[pathRow + 1] as number;
		for (let row = start; row < end; row++) {
			incoming[snapshot.foundation.paths.adjacencyTargets[row] as number]?.push(pathRow);
		}
	}
	const switchIndex = buildSimulationSwitchClaimIndexFromValidatedSources(
		snapshot.foundation,
		snapshot.trackResources,
	);
	return Object.freeze({
		incomingPathRows: Object.freeze(incoming.map((rows) => Object.freeze(rows))),
		...switchIndex,
	});
}

/** Shared switch-selection index; callers must independently validate and bind both sources. */
export function buildSimulationSwitchClaimIndexFromValidatedSources(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
): SimulationSwitchClaimIndex {
	if (topology.sourceFoundationFingerprint !== foundation.fingerprint) {
		throw new Error("Switch-claim sources do not share one foundation fingerprint.");
	}
	const movementRowsByFirstPath = new Map<number, number[]>();
	const switches = foundation.switches;
	for (let movementRow = 0; movementRow < topology.movementCount; movementRow++) {
		const intervalStart = switches.movementPathOffsets[movementRow] as number;
		const firstPath = switches.movementPathIndices[intervalStart] as number;
		const rows = movementRowsByFirstPath.get(firstPath) ?? [];
		rows.push(movementRow);
		movementRowsByFirstPath.set(firstPath, rows);
	}
	const switchConflictRowsByTrackResource = new Map<number, Set<number>>();
	for (let switchRow = 0; switchRow < topology.switchConflictResourceCount; switchRow++) {
		const intervalStart = topology.conflictIntervalOffsets[switchRow] as number;
		const intervalEnd = topology.conflictIntervalOffsets[switchRow + 1] as number;
		for (let intervalRow = intervalStart; intervalRow < intervalEnd; intervalRow++) {
			const trackStart = topology.conflictTrackResourceOffsets[intervalRow] as number;
			const trackEnd = topology.conflictTrackResourceOffsets[intervalRow + 1] as number;
			for (let row = trackStart; row < trackEnd; row++) {
				const trackResourceRow = topology.conflictTrackResourceRows[row] as number;
				const switchRows = switchConflictRowsByTrackResource.get(trackResourceRow) ?? new Set();
				switchRows.add(switchRow);
				switchConflictRowsByTrackResource.set(trackResourceRow, switchRows);
			}
		}
	}
	return Object.freeze({
		movementRowsByFirstPath: new Map(
			[...movementRowsByFirstPath].map(([pathRow, rows]) => [pathRow, Object.freeze(rows)]),
		),
		switchConflictRowsByTrackResource: new Map(
			[...switchConflictRowsByTrackResource].map(([trackRow, switchRows]) => [
				trackRow,
				Object.freeze([...switchRows].sort((left, right) => left - right)),
			]),
		),
	});
}

function appendTrackOccurrences(
	snapshot: PublishedSimulationReadinessSnapshot,
	interval: SimulationRoutePathInterval,
	resourceRows: number[],
	starts: number[],
	ends: number[],
	uniqueTrackRows: Set<number>,
): void {
	const topology = snapshot.trackResources;
	const pathStart = topology.pathResourceOffsets[interval.pathRow] as number;
	const pathEnd = topology.pathResourceOffsets[interval.pathRow + 1] as number;
	let cursor = interval.start;
	for (let occurrenceRow = pathStart; occurrenceRow < pathEnd; occurrenceRow++) {
		const resourceStart = topology.pathResourceStarts[occurrenceRow] as number;
		const resourceEnd = topology.pathResourceEnds[occurrenceRow] as number;
		const start = Math.max(interval.start, resourceStart);
		const end = Math.min(interval.end, resourceEnd);
		if (end <= start) continue;
		if (start > cursor + STATION_EPSILON_METERS) {
			throw new Error(`Track resources leave a gap on extended path ${interval.pathRow}.`);
		}
		const resourceRow = topology.pathResourceRows[occurrenceRow] as number;
		resourceRows.push(resourceRow);
		starts.push(interval.routeStart + (start - interval.start));
		ends.push(interval.routeStart + (end - interval.start));
		uniqueTrackRows.add(resourceRow);
		cursor = Math.max(cursor, end);
	}
	if (cursor < interval.end - STATION_EPSILON_METERS) {
		throw new Error(`Track resources do not cover extended path ${interval.pathRow}.`);
	}
}

export interface SimulationSelectedMovementClaim {
	readonly movementRow: number;
	readonly routeStart: number;
	readonly routePathPosition: number;
}

export function compileSimulationSelectedMovementClaimsFromValidatedSources(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
	intervals: readonly SimulationRoutePathInterval[],
	leaseTrackRows: ReadonlySet<number>,
	index: SimulationSwitchClaimIndex,
): readonly SimulationSelectedMovementClaim[] {
	if (topology.sourceFoundationFingerprint !== foundation.fingerprint) {
		throw new Error("Selected-movement sources do not share one foundation fingerprint.");
	}
	const switches = foundation.switches;
	const claims: SimulationSelectedMovementClaim[] = [];
	const claimedAtPosition = new Set<string>();
	for (let routePosition = 0; routePosition < intervals.length; routePosition++) {
		const interval = intervals[routePosition] as SimulationRoutePathInterval;
		for (const movementRow of index.movementRowsByFirstPath.get(interval.pathRow) ?? []) {
			const movementStart = switches.movementPathOffsets[movementRow] as number;
			const movementEnd = switches.movementPathOffsets[movementRow + 1] as number;
			if (movementEnd - movementStart > intervals.length - routePosition) continue;
			let matches = true;
			for (
				let movementPosition = movementStart;
				movementPosition < movementEnd;
				movementPosition++
			) {
				const routeInterval = intervals[
					routePosition + movementPosition - movementStart
				] as SimulationRoutePathInterval;
				if (
					routeInterval.pathRow !== switches.movementPathIndices[movementPosition] ||
					(switches.movementPathStarts[movementPosition] as number) <
						routeInterval.start - STATION_EPSILON_METERS ||
					(switches.movementPathEnds[movementPosition] as number) >
						routeInterval.end + STATION_EPSILON_METERS
				) {
					matches = false;
					break;
				}
			}
			if (!matches) continue;
			const conflictRow = topology.movementConflictResourceRows[movementRow] as number;
			const positionKey = `${conflictRow}:${routePosition}`;
			if (claimedAtPosition.has(positionKey)) {
				throw new Error(
					`Route position ${routePosition} ambiguously selects multiple movements for switch-conflict row ${conflictRow}.`,
				);
			}
			assertMovementConflictTrackCoverage(topology, movementRow, leaseTrackRows);
			claimedAtPosition.add(positionKey);
			claims.push(
				Object.freeze({
					movementRow,
					routeStart:
						interval.routeStart +
						((switches.movementPathStarts[movementStart] as number) - interval.start),
					routePathPosition: routePosition,
				}),
			);
		}
	}
	claims.sort(
		(left, right) =>
			left.routeStart - right.routeStart ||
			left.routePathPosition - right.routePathPosition ||
			left.movementRow - right.movementRow,
	);
	return Object.freeze(claims);
}

function assertMovementConflictTrackCoverage(
	topology: PublishedSimulationReadinessSnapshot["trackResources"],
	movementRow: number,
	leaseTrackRows: ReadonlySet<number>,
): void {
	const referenceStart = topology.movementConflictIntervalOffsets[movementRow] as number;
	const referenceEnd = topology.movementConflictIntervalOffsets[movementRow + 1] as number;
	for (let referenceRow = referenceStart; referenceRow < referenceEnd; referenceRow++) {
		const conflictIntervalRow = topology.movementConflictIntervalRows[referenceRow] as number;
		const trackStart = topology.conflictTrackResourceOffsets[conflictIntervalRow] as number;
		const trackEnd = topology.conflictTrackResourceOffsets[conflictIntervalRow + 1] as number;
		for (let trackReference = trackStart; trackReference < trackEnd; trackReference++) {
			const trackRow = topology.conflictTrackResourceRows[trackReference] as number;
			if (!leaseTrackRows.has(trackRow)) {
				throw new Error(
					`Selected movement ${movementRow} is not fully covered by its extended track lease.`,
				);
			}
		}
	}
}

export function assertSimulationTouchedSwitchesClaimed(
	leaseTrackRows: ReadonlySet<number>,
	claimedSwitchRows: readonly number[],
	switchRowsByTrackResource: ReadonlyMap<number, readonly number[]>,
): void {
	const claimed = new Set(claimedSwitchRows);
	for (const trackRow of leaseTrackRows) {
		for (const switchRow of switchRowsByTrackResource.get(trackRow) ?? []) {
			if (claimed.has(switchRow)) continue;
			throw new Error(
				`Extended route touches switch-conflict row ${switchRow} without one exact movement claim.`,
			);
		}
	}
}

function assertCompatibleSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
): void {
	const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
	if (snapshotError) throw new Error(`Published readiness snapshot is invalid: ${snapshotError}`);
	const manifestError = simulationScenarioManifestError(manifest);
	if (manifestError) throw new Error(`Simulation scenario manifest is invalid: ${manifestError}`);
	const routeError = simulationScenarioRouteRequestsError(routes);
	if (routeError) throw new Error(`Simulation scenario route requests are invalid: ${routeError}`);
	if (!simulationScenarioRouteRequestsMatchSources(snapshot, manifest, routes)) {
		throw new Error(
			"Scenario route requests do not belong to the supplied manifest and certificate.",
		);
	}
}

function validPerRequestClaims(claims: SimulationScenarioLeaseClaims): boolean {
	const rear = claims.rearLeaseExtensionMillimeters / 1_000;
	for (let requestRow = 0; requestRow < claims.requestCount; requestRow++) {
		const leaseLength = claims.routeLeaseLengthsMeters[requestRow] as number;
		if (!Number.isFinite(leaseLength) || leaseLength <= STATION_EPSILON_METERS) return false;
		const leaseStart = claims.leaseTrackResourceOffsets[requestRow] as number;
		const leaseEnd = claims.leaseTrackResourceOffsets[requestRow + 1] as number;
		if (
			leaseStart === leaseEnd ||
			!strictlyIncreasing(claims.leaseTrackResourceRows, leaseStart, leaseEnd)
		) {
			return false;
		}
		const resources = new Set<number>();
		for (let row = leaseStart; row < leaseEnd; row++) {
			resources.add(claims.leaseTrackResourceRows[row] as number);
		}
		const occurrenceStart = claims.orderedTrackOccurrenceOffsets[requestRow] as number;
		const occurrenceEnd = claims.orderedTrackOccurrenceOffsets[requestRow + 1] as number;
		if (occurrenceStart === occurrenceEnd) return false;
		let cursor = -rear;
		const observedResources = new Set<number>();
		for (let row = occurrenceStart; row < occurrenceEnd; row++) {
			const resourceRow = claims.orderedTrackOccurrenceResourceRows[row] as number;
			const start = claims.orderedTrackOccurrenceStartsMeters[row] as number;
			const end = claims.orderedTrackOccurrenceEndsMeters[row] as number;
			if (
				!resources.has(resourceRow) ||
				!Number.isFinite(start) ||
				!Number.isFinite(end) ||
				Math.abs(start - cursor) > STATION_EPSILON_METERS ||
				end <= start ||
				end > leaseLength - rear + STATION_EPSILON_METERS
			) {
				return false;
			}
			observedResources.add(resourceRow);
			cursor = end;
		}
		if (
			Math.abs(cursor - (leaseLength - rear)) > STATION_EPSILON_METERS ||
			observedResources.size !== resources.size
		) {
			return false;
		}
		const switchStart = claims.switchConflictClaimOffsets[requestRow] as number;
		const switchEnd = claims.switchConflictClaimOffsets[requestRow + 1] as number;
		if (!strictlyIncreasing(claims.switchConflictClaimRows, switchStart, switchEnd)) return false;
	}
	return true;
}

function claimsRowsWithinCertifiedDomains(
	snapshot: PublishedSimulationReadinessSnapshot,
	claims: SimulationScenarioLeaseClaims,
): boolean {
	for (const row of claims.leaseTrackResourceRows) {
		if (row >= snapshot.trackResources.trackResourceCount) return false;
	}
	for (const row of claims.orderedTrackOccurrenceResourceRows) {
		if (row >= snapshot.trackResources.trackResourceCount) return false;
	}
	for (const row of claims.movementClaimRows) {
		if (row >= snapshot.trackResources.movementCount) return false;
	}
	for (const row of claims.switchConflictClaimRows) {
		if (row >= snapshot.trackResources.switchConflictResourceCount) return false;
	}
	return true;
}

function claimsMatchRoutesAndTopology(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
	claims: SimulationScenarioLeaseClaims,
): boolean {
	const topology = snapshot.trackResources;
	const front = claims.frontLeaseExtensionMillimeters / 1_000;
	const rear = claims.rearLeaseExtensionMillimeters / 1_000;
	for (let requestRow = 0; requestRow < claims.requestCount; requestRow++) {
		if (
			Math.abs(
				(claims.routeLeaseLengthsMeters[requestRow] as number) -
					((routes.routeDistancesMeters[requestRow] as number) + front + rear),
			) > STATION_EPSILON_METERS
		) {
			return false;
		}
		const leaseRows = new Set<number>();
		const leaseStart = claims.leaseTrackResourceOffsets[requestRow] as number;
		const leaseEnd = claims.leaseTrackResourceOffsets[requestRow + 1] as number;
		for (let row = leaseStart; row < leaseEnd; row++) {
			leaseRows.add(claims.leaseTrackResourceRows[row] as number);
		}
		const corridorStart = routes.corridorTrackResourceOffsets[requestRow] as number;
		const corridorEnd = routes.corridorTrackResourceOffsets[requestRow + 1] as number;
		for (let row = corridorStart; row < corridorEnd; row++) {
			if (!leaseRows.has(routes.corridorTrackResourceRows[row] as number)) return false;
		}
		const expectedSwitchRows = new Set<number>();
		const movementStart = claims.movementClaimOffsets[requestRow] as number;
		const movementEnd = claims.movementClaimOffsets[requestRow + 1] as number;
		for (let row = movementStart; row < movementEnd; row++) {
			const movementRow = claims.movementClaimRows[row] as number;
			expectedSwitchRows.add(topology.movementConflictResourceRows[movementRow] as number);
			const referenceStart = topology.movementConflictIntervalOffsets[movementRow] as number;
			const referenceEnd = topology.movementConflictIntervalOffsets[movementRow + 1] as number;
			for (let referenceRow = referenceStart; referenceRow < referenceEnd; referenceRow++) {
				const conflictIntervalRow = topology.movementConflictIntervalRows[referenceRow] as number;
				const trackStart = topology.conflictTrackResourceOffsets[conflictIntervalRow] as number;
				const trackEnd = topology.conflictTrackResourceOffsets[conflictIntervalRow + 1] as number;
				for (let trackReference = trackStart; trackReference < trackEnd; trackReference++) {
					if (!leaseRows.has(topology.conflictTrackResourceRows[trackReference] as number)) {
						return false;
					}
				}
			}
		}
		const switchStart = claims.switchConflictClaimOffsets[requestRow] as number;
		const switchEnd = claims.switchConflictClaimOffsets[requestRow + 1] as number;
		if (switchEnd - switchStart !== expectedSwitchRows.size) return false;
		for (let row = switchStart; row < switchEnd; row++) {
			if (!expectedSwitchRows.has(claims.switchConflictClaimRows[row] as number)) return false;
		}
	}
	return true;
}

function assertLeaseTypedMemoryLimit(
	requestCount: number,
	leaseRowCount: number,
	occurrenceCount: number,
	movementCount: number,
	switchCount: number,
): void {
	const bytes =
		requestCount * Float64Array.BYTES_PER_ELEMENT +
		(requestCount + 1) * Uint32Array.BYTES_PER_ELEMENT * 4 +
		leaseRowCount * Uint32Array.BYTES_PER_ELEMENT +
		occurrenceCount * (Uint32Array.BYTES_PER_ELEMENT + Float64Array.BYTES_PER_ELEMENT * 2) +
		movementCount * Uint32Array.BYTES_PER_ELEMENT +
		switchCount * Uint32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(bytes) || bytes > SIMULATION_SCENARIO_MAX_LEASE_CLAIM_TYPED_BYTES) {
		throw new RangeError("Scenario lease claims exceed the typed-memory limit.");
	}
}

function simulationScenarioLeaseClaimViews(
	claims: Omit<SimulationScenarioLeaseClaims, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		claims.routeLeaseLengthsMeters,
		claims.leaseTrackResourceOffsets,
		claims.leaseTrackResourceRows,
		claims.orderedTrackOccurrenceOffsets,
		claims.orderedTrackOccurrenceResourceRows,
		claims.orderedTrackOccurrenceStartsMeters,
		claims.orderedTrackOccurrenceEndsMeters,
		claims.movementClaimOffsets,
		claims.movementClaimRows,
		claims.switchConflictClaimOffsets,
		claims.switchConflictClaimRows,
	];
}

function strictlyIncreasing(values: Uint32Array, start: number, end: number): boolean {
	for (let row = start + 1; row < end; row++) {
		if ((values[row] as number) <= (values[row - 1] as number)) return false;
	}
	return true;
}

function isCsr(value: unknown, rowCount: number, itemCount: number): value is Uint32Array {
	if (!isUint32Array(value, rowCount + 1) || value[0] !== 0 || value[rowCount] !== itemCount) {
		return false;
	}
	for (let row = 1; row < value.length; row++) {
		if ((value[row] as number) < (value[row - 1] as number)) return false;
	}
	return true;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasIndependentOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBufferLike>();
	for (const view of views) {
		if (
			view.byteOffset !== 0 ||
			view.byteLength !== view.buffer.byteLength ||
			buffers.has(view.buffer)
		) {
			return false;
		}
		buffers.add(view.buffer);
	}
	return true;
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((total, view) => total + view.byteLength, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUint32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function isUint32Array(value: unknown, length?: number): value is Uint32Array {
	return value instanceof Uint32Array && (length === undefined || value.length === length);
}

function isFloat64Array(value: unknown, length?: number): value is Float64Array {
	return value instanceof Float64Array && (length === undefined || value.length === length);
}
