import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type SimulationResidentCycleRoutes,
	simulationResidentCycleRoutesError,
} from "./SimulationResidentCycleRoutes";
import {
	SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY,
	type SimulationResidentFleetParkingConfiguration,
	simulationResidentFleetParkingConfigurationError,
	simulationResidentFleetParkingConfigurationMatchesSources,
} from "./SimulationResidentFleetParkingConfiguration";
import {
	assertSimulationTouchedSwitchesClaimed,
	buildSimulationSwitchClaimIndexFromValidatedSources,
	compileSimulationSelectedMovementClaimsFromValidatedSources,
	type SimulationRoutePathInterval,
} from "./SimulationScenarioLeaseClaims";
import {
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import {
	SIMULATION_TRACK_FAIRNESS_POLICY,
	SIMULATION_TRACK_ROUTE_MUTATION_POLICY,
	SIMULATION_TRACK_SWITCH_POLICY,
	type SimulationTrackOccupancyPolicy,
	simulationTrackOccupancyPolicyError,
} from "./SimulationTrackOccupancyPolicy";
import {
	type SimulationTrackResourceTopology,
	simulationTrackResourceTopologyError,
} from "./SimulationTrackResourceTopology";

export const SIMULATION_RESIDENT_CYCLE_LEASE_CLAIMS_SCHEMA_VERSION = 1 as const;
export const SIMULATION_RESIDENT_CYCLE_LEASE_SCOPE =
	"COMPLETE_HOME_RETURN_CYCLE_NON_HOME_BUNDLE_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_HOME_OWNERSHIP_POLICY =
	"DEDICATED_HOME_FOOTPRINT_RETAINED_THROUGHOUT_CYCLE_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_ACQUISITION_POLICY =
	"ATOMIC_ALL_OR_NONE_BEFORE_HOME_DEPARTURE_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_RELEASE_POLICY =
	"RELEASE_NON_HOME_BUNDLE_AFTER_FULL_HOME_FOOTPRINT_RETURN_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_LEASE_MAX_TYPED_BYTES = 128 * 1024 * 1024;
export const SIMULATION_RESIDENT_CYCLE_LEASE_MISSING_SAFETY_LAYERS = Object.freeze([
	"RESIDENT_READINESS_CERTIFICATE",
	"RESIDENT_RUN_AUTHORIZATION",
] as const);

const CLAIM_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingSafetyLayers",
	"leaseScope",
	"homeOwnershipPolicy",
	"acquisitionPolicy",
	"releasePolicy",
	"deadlockPolicy",
	"fairnessPolicy",
	"switchPolicy",
	"routeMutationPolicy",
	"partialAcquisitionAllowed",
	"waitingCycleMayHoldNonHomeResources",
	"dedicatedHomeHeldThroughoutCycle",
	"foreignHomeNonInterferenceRequired",
	"completeCycleBundleAcquiredAtomically",
	"sourceRoutesFingerprint",
	"sourceParkingConfigurationFingerprint",
	"sourceFoundationFingerprint",
	"sourceTrackResourceTopologyFingerprint",
	"sourceOccupancyPolicyFingerprint",
	"requestCount",
	"homeSlotRows",
	"homeSlotIds",
	"nonHomeTrackResourceOffsets",
	"nonHomeTrackResourceRows",
	"movementClaimOffsets",
	"movementClaimRows",
	"switchConflictClaimOffsets",
	"switchConflictClaimRows",
	"fingerprint",
	"byteLength",
] as const);

export interface SimulationResidentCycleLeaseClaims {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_CYCLE_LEASE_CLAIMS_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingSafetyLayers: typeof SIMULATION_RESIDENT_CYCLE_LEASE_MISSING_SAFETY_LAYERS;
	readonly leaseScope: typeof SIMULATION_RESIDENT_CYCLE_LEASE_SCOPE;
	readonly homeOwnershipPolicy: typeof SIMULATION_RESIDENT_CYCLE_HOME_OWNERSHIP_POLICY;
	readonly acquisitionPolicy: typeof SIMULATION_RESIDENT_CYCLE_ACQUISITION_POLICY;
	readonly releasePolicy: typeof SIMULATION_RESIDENT_CYCLE_RELEASE_POLICY;
	readonly deadlockPolicy: typeof SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY;
	readonly fairnessPolicy: typeof SIMULATION_TRACK_FAIRNESS_POLICY;
	readonly switchPolicy: typeof SIMULATION_TRACK_SWITCH_POLICY;
	readonly routeMutationPolicy: typeof SIMULATION_TRACK_ROUTE_MUTATION_POLICY;
	readonly partialAcquisitionAllowed: false;
	readonly waitingCycleMayHoldNonHomeResources: false;
	readonly dedicatedHomeHeldThroughoutCycle: true;
	readonly foreignHomeNonInterferenceRequired: true;
	readonly completeCycleBundleAcquiredAtomically: true;
	readonly sourceRoutesFingerprint: string;
	readonly sourceParkingConfigurationFingerprint: string;
	readonly sourceFoundationFingerprint: string;
	readonly sourceTrackResourceTopologyFingerprint: string;
	readonly sourceOccupancyPolicyFingerprint: string;
	readonly requestCount: number;
	readonly homeSlotRows: Uint32Array;
	readonly homeSlotIds: Uint32Array;
	/** Sorted unique cycle resources excluding the already owned dedicated home footprint. */
	readonly nonHomeTrackResourceOffsets: Uint32Array;
	readonly nonHomeTrackResourceRows: Uint32Array;
	/** Exact selected switch movements in deterministic cycle traversal order. */
	readonly movementClaimOffsets: Uint32Array;
	readonly movementClaimRows: Uint32Array;
	/** Sorted unique switch-conflict rows acquired with the non-home track bundle. */
	readonly switchConflictClaimOffsets: Uint32Array;
	readonly switchConflictClaimRows: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

interface CycleLeaseBundle {
	readonly nonHomeTrackRows: readonly number[];
	readonly movementRows: readonly number[];
	readonly switchConflictRows: readonly number[];
}

export function compileSimulationResidentCycleLeaseClaims(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
): SimulationResidentCycleLeaseClaims {
	assertCompatibleSources(foundation, trackResources, occupancyPolicy, parking, routes);
	const switchIndex = buildSimulationSwitchClaimIndexFromValidatedSources(
		foundation,
		trackResources,
	);
	const stationRowByPortId = new Map<number, number>();
	for (let row = 0; row < foundation.stations.count; row++) {
		stationRowByPortId.set(foundation.stations.ids[row] as number, row);
	}
	const bundleByRouteKey = new Map<string, CycleLeaseBundle>();
	const bundles = new Array<CycleLeaseBundle>(routes.requestCount);
	let nonHomeTrackCount = 0;
	let movementCount = 0;
	let switchConflictCount = 0;
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const key = `${routes.homeSlotRows[requestRow]}:${routes.pickupPortIds[requestRow]}:${routes.dropoffPortIds[requestRow]}`;
		let bundle = bundleByRouteKey.get(key);
		if (!bundle) {
			bundle = compileCycleLeaseBundle(
				foundation,
				trackResources,
				parking,
				routes,
				requestRow,
				stationRowByPortId,
				switchIndex,
			);
			bundleByRouteKey.set(key, bundle);
		}
		bundles[requestRow] = bundle;
		nonHomeTrackCount += bundle.nonHomeTrackRows.length;
		movementCount += bundle.movementRows.length;
		switchConflictCount += bundle.switchConflictRows.length;
		assertTypedMemoryLimit(
			routes.requestCount,
			nonHomeTrackCount,
			movementCount,
			switchConflictCount,
		);
	}

	const homeSlotRows = routes.homeSlotRows.slice();
	const homeSlotIds = routes.homeSlotIds.slice();
	const nonHomeTrackResourceOffsets = new Uint32Array(routes.requestCount + 1);
	const nonHomeTrackResourceRows = new Uint32Array(nonHomeTrackCount);
	const movementClaimOffsets = new Uint32Array(routes.requestCount + 1);
	const movementClaimRows = new Uint32Array(movementCount);
	const switchConflictClaimOffsets = new Uint32Array(routes.requestCount + 1);
	const switchConflictClaimRows = new Uint32Array(switchConflictCount);
	let trackCursor = 0;
	let movementCursor = 0;
	let switchCursor = 0;
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const bundle = bundles[requestRow] as CycleLeaseBundle;
		nonHomeTrackResourceOffsets[requestRow] = trackCursor;
		nonHomeTrackResourceRows.set(bundle.nonHomeTrackRows, trackCursor);
		trackCursor += bundle.nonHomeTrackRows.length;
		movementClaimOffsets[requestRow] = movementCursor;
		movementClaimRows.set(bundle.movementRows, movementCursor);
		movementCursor += bundle.movementRows.length;
		switchConflictClaimOffsets[requestRow] = switchCursor;
		switchConflictClaimRows.set(bundle.switchConflictRows, switchCursor);
		switchCursor += bundle.switchConflictRows.length;
	}
	nonHomeTrackResourceOffsets[routes.requestCount] = trackCursor;
	movementClaimOffsets[routes.requestCount] = movementCursor;
	switchConflictClaimOffsets[routes.requestCount] = switchCursor;

	const claimsWithoutIdentity = {
		schemaVersion: SIMULATION_RESIDENT_CYCLE_LEASE_CLAIMS_SCHEMA_VERSION,
		simulationRunnable: false,
		missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_LEASE_MISSING_SAFETY_LAYERS,
		leaseScope: SIMULATION_RESIDENT_CYCLE_LEASE_SCOPE,
		homeOwnershipPolicy: SIMULATION_RESIDENT_CYCLE_HOME_OWNERSHIP_POLICY,
		acquisitionPolicy: SIMULATION_RESIDENT_CYCLE_ACQUISITION_POLICY,
		releasePolicy: SIMULATION_RESIDENT_CYCLE_RELEASE_POLICY,
		deadlockPolicy: SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY,
		fairnessPolicy: occupancyPolicy.fairnessPolicy,
		switchPolicy: occupancyPolicy.switchPolicy,
		routeMutationPolicy: occupancyPolicy.routeMutationPolicy,
		partialAcquisitionAllowed: false,
		waitingCycleMayHoldNonHomeResources: false,
		dedicatedHomeHeldThroughoutCycle: true,
		foreignHomeNonInterferenceRequired: true,
		completeCycleBundleAcquiredAtomically: true,
		sourceRoutesFingerprint: routes.fingerprint,
		sourceParkingConfigurationFingerprint: parking.fingerprint,
		sourceFoundationFingerprint: foundation.fingerprint,
		sourceTrackResourceTopologyFingerprint: trackResources.fingerprint,
		sourceOccupancyPolicyFingerprint: occupancyPolicy.fingerprint,
		requestCount: routes.requestCount,
		homeSlotRows,
		homeSlotIds,
		nonHomeTrackResourceOffsets,
		nonHomeTrackResourceRows,
		movementClaimOffsets,
		movementClaimRows,
		switchConflictClaimOffsets,
		switchConflictClaimRows,
	} as const;
	const views = simulationResidentCycleLeaseClaimViews(claimsWithoutIdentity);
	const claims = Object.freeze({
		...claimsWithoutIdentity,
		fingerprint: checksumSimulationResidentCycleLeaseClaims(claimsWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationResidentCycleLeaseClaims;
	const error = simulationResidentCycleLeaseClaimsError(claims);
	if (error) throw new Error(`Compiled resident cycle lease claims are invalid: ${error}`);
	return claims;
}

export function checksumSimulationResidentCycleLeaseClaims(
	claims: Omit<SimulationResidentCycleLeaseClaims, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		claims.schemaVersion,
		claims.simulationRunnable ? 1 : 0,
		claims.partialAcquisitionAllowed ? 1 : 0,
		claims.waitingCycleMayHoldNonHomeResources ? 1 : 0,
		claims.dedicatedHomeHeldThroughoutCycle ? 1 : 0,
		claims.foreignHomeNonInterferenceRequired ? 1 : 0,
		claims.completeCycleBundleAcquiredAtomically ? 1 : 0,
		claims.requestCount,
	]);
	checksum.addStrings([
		...claims.missingSafetyLayers,
		claims.leaseScope,
		claims.homeOwnershipPolicy,
		claims.acquisitionPolicy,
		claims.releasePolicy,
		claims.deadlockPolicy,
		claims.fairnessPolicy,
		claims.switchPolicy,
		claims.routeMutationPolicy,
		claims.sourceRoutesFingerprint,
		claims.sourceParkingConfigurationFingerprint,
		claims.sourceFoundationFingerprint,
		claims.sourceTrackResourceTopologyFingerprint,
		claims.sourceOccupancyPolicyFingerprint,
	]);
	checksum.addViews(simulationResidentCycleLeaseClaimViews(claims));
	return checksum.digest();
}

export function simulationResidentCycleLeaseClaimsError(value: unknown): string | null {
	if (!isRecord(value)) return "resident cycle lease claims must be an object";
	if (!hasExactKeys(value, CLAIM_KEYS)) {
		return "resident cycle lease claims contain missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_RESIDENT_CYCLE_LEASE_CLAIMS_SCHEMA_VERSION ||
		value.simulationRunnable !== false ||
		!sameStrings(
			value.missingSafetyLayers,
			SIMULATION_RESIDENT_CYCLE_LEASE_MISSING_SAFETY_LAYERS,
		) ||
		value.leaseScope !== SIMULATION_RESIDENT_CYCLE_LEASE_SCOPE ||
		value.homeOwnershipPolicy !== SIMULATION_RESIDENT_CYCLE_HOME_OWNERSHIP_POLICY ||
		value.acquisitionPolicy !== SIMULATION_RESIDENT_CYCLE_ACQUISITION_POLICY ||
		value.releasePolicy !== SIMULATION_RESIDENT_CYCLE_RELEASE_POLICY ||
		value.deadlockPolicy !== SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY ||
		value.fairnessPolicy !== SIMULATION_TRACK_FAIRNESS_POLICY ||
		value.switchPolicy !== SIMULATION_TRACK_SWITCH_POLICY ||
		value.routeMutationPolicy !== SIMULATION_TRACK_ROUTE_MUTATION_POLICY ||
		value.partialAcquisitionAllowed !== false ||
		value.waitingCycleMayHoldNonHomeResources !== false ||
		value.dedicatedHomeHeldThroughoutCycle !== true ||
		value.foreignHomeNonInterferenceRequired !== true ||
		value.completeCycleBundleAcquiredAtomically !== true
	) {
		return "resident cycle atomic lease policy is invalid";
	}
	if (
		!isNonEmptyString(value.sourceRoutesFingerprint) ||
		!isNonEmptyString(value.sourceParkingConfigurationFingerprint) ||
		!isNonEmptyString(value.sourceFoundationFingerprint) ||
		!isNonEmptyString(value.sourceTrackResourceTopologyFingerprint) ||
		!isNonEmptyString(value.sourceOccupancyPolicyFingerprint) ||
		!isNonNegativeSafeInteger(value.requestCount) ||
		(value.requestCount as number) > 100_000
	) {
		return "resident cycle lease source identity is invalid";
	}
	const requestCount = value.requestCount as number;
	const trackCount =
		value.nonHomeTrackResourceRows instanceof Uint32Array
			? value.nonHomeTrackResourceRows.length
			: -1;
	const movementCount =
		value.movementClaimRows instanceof Uint32Array ? value.movementClaimRows.length : -1;
	const switchCount =
		value.switchConflictClaimRows instanceof Uint32Array
			? value.switchConflictClaimRows.length
			: -1;
	if (
		!isUint32Array(value.homeSlotRows, requestCount) ||
		!isUint32Array(value.homeSlotIds, requestCount) ||
		!isCsr(value.nonHomeTrackResourceOffsets, requestCount, trackCount) ||
		!isUint32Array(value.nonHomeTrackResourceRows, trackCount) ||
		!isCsr(value.movementClaimOffsets, requestCount, movementCount) ||
		!isUint32Array(value.movementClaimRows, movementCount) ||
		!isCsr(value.switchConflictClaimOffsets, requestCount, switchCount) ||
		!isUint32Array(value.switchConflictClaimRows, switchCount)
	) {
		return "resident cycle lease columns are malformed";
	}
	const claims = value as unknown as SimulationResidentCycleLeaseClaims;
	if (!hasIndependentOwnedBuffers(simulationResidentCycleLeaseClaimViews(claims))) {
		return "resident cycle lease columns must own independent buffers";
	}
	for (let requestRow = 0; requestRow < requestCount; requestRow++) {
		if (claims.homeSlotIds[requestRow] === 0) return "resident cycle home slot ID is invalid";
		const trackStart = claims.nonHomeTrackResourceOffsets[requestRow] as number;
		const trackEnd = claims.nonHomeTrackResourceOffsets[requestRow + 1] as number;
		const switchStart = claims.switchConflictClaimOffsets[requestRow] as number;
		const switchEnd = claims.switchConflictClaimOffsets[requestRow + 1] as number;
		if (
			trackStart === trackEnd ||
			!strictlyIncreasing(claims.nonHomeTrackResourceRows, trackStart, trackEnd) ||
			!strictlyIncreasing(claims.switchConflictClaimRows, switchStart, switchEnd)
		) {
			return "resident cycle lease bundles are empty or non-canonical";
		}
	}
	const views = simulationResidentCycleLeaseClaimViews(claims);
	const byteLength = sumByteLengths(views);
	if (
		!isNonNegativeSafeInteger(value.byteLength) ||
		value.byteLength !== byteLength ||
		byteLength > SIMULATION_RESIDENT_CYCLE_LEASE_MAX_TYPED_BYTES
	) {
		return "resident cycle lease typed-memory accounting is invalid";
	}
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationResidentCycleLeaseClaims(claims) !== value.fingerprint
	) {
		return "resident cycle lease fingerprint is invalid";
	}
	return null;
}

export function simulationResidentCycleLeaseClaimsMatchSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	claims: SimulationResidentCycleLeaseClaims,
): boolean {
	if (simulationResidentCycleLeaseClaimsError(claims)) return false;
	try {
		const rebuilt = compileSimulationResidentCycleLeaseClaims(
			foundation,
			trackResources,
			occupancyPolicy,
			parking,
			routes,
		);
		return rebuilt.fingerprint === claims.fingerprint;
	} catch {
		return false;
	}
}

export function simulationResidentCycleLeaseClaimTransfers(
	claims: SimulationResidentCycleLeaseClaims,
): readonly ArrayBuffer[] {
	const error = simulationResidentCycleLeaseClaimsError(claims);
	if (error) throw new Error(`Simulation resident cycle lease claims are invalid: ${error}`);
	return Object.freeze(
		simulationResidentCycleLeaseClaimViews(claims).map((view) => view.buffer as ArrayBuffer),
	);
}

function compileCycleLeaseBundle(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	requestRow: number,
	stationRowByPortId: ReadonlyMap<number, number>,
	switchIndex: ReturnType<typeof buildSimulationSwitchClaimIndexFromValidatedSources>,
): CycleLeaseBundle {
	const slotRow = routes.homeSlotRows[requestRow] as number;
	const homeTrackRows = new Set(
		csrValues(parking.footprintTrackResourceOffsets, parking.footprintTrackResourceRows, slotRow),
	);
	const cycleTrackRows = new Set(
		csrValues(
			routes.cycleCorridorTrackResourceOffsets,
			routes.cycleCorridorTrackResourceRows,
			requestRow,
		),
	);
	const nonHomeTrackRows = [...cycleTrackRows]
		.filter((row) => !homeTrackRows.has(row))
		.sort((left, right) => left - right);
	if (nonHomeTrackRows.length === 0) {
		throw new Error(`Resident request row ${requestRow} has no non-home cycle resource.`);
	}
	const movementRows: number[] = [];
	let cycleDistance = 0;
	for (let leg = 0; leg < 3; leg++) {
		const intervals = cycleLegIntervals(
			foundation,
			routes,
			requestRow,
			leg,
			stationRowByPortId,
			cycleDistance,
		);
		for (const interval of intervals) cycleDistance += interval.end - interval.start;
		const movements = compileSimulationSelectedMovementClaimsFromValidatedSources(
			foundation,
			trackResources,
			intervals,
			cycleTrackRows,
			switchIndex,
		);
		movementRows.push(...movements.map((movement) => movement.movementRow));
	}
	const switchConflictRows = [
		...new Set(
			movementRows.map(
				(movementRow) => trackResources.movementConflictResourceRows[movementRow] as number,
			),
		),
	].sort((left, right) => left - right);
	assertSimulationTouchedSwitchesClaimed(
		cycleTrackRows,
		switchConflictRows,
		switchIndex.switchConflictRowsByTrackResource,
	);
	return Object.freeze({
		nonHomeTrackRows: Object.freeze(nonHomeTrackRows),
		movementRows: Object.freeze(movementRows),
		switchConflictRows: Object.freeze(switchConflictRows),
	});
}

function cycleLegIntervals(
	foundation: SimulationStaticWorldFoundation,
	routes: SimulationResidentCycleRoutes,
	requestRow: number,
	leg: number,
	stationRowByPortId: ReadonlyMap<number, number>,
	routeStart: number,
): readonly SimulationRoutePathInterval[] {
	const homePortId = routes.homePortIds[requestRow] as number;
	const pickupPortId = routes.pickupPortIds[requestRow] as number;
	const dropoffPortId = routes.dropoffPortIds[requestRow] as number;
	const portPairs = [
		[homePortId, pickupPortId],
		[pickupPortId, dropoffPortId],
		[dropoffPortId, homePortId],
	] as const;
	const [sourcePortId, destinationPortId] = portPairs[leg] as readonly [number, number];
	const sourceStationRow = stationRowByPortId.get(sourcePortId);
	const destinationStationRow = stationRowByPortId.get(destinationPortId);
	if (sourceStationRow === undefined || destinationStationRow === undefined) {
		throw new Error(`Resident request row ${requestRow} lease leg has a foreign port.`);
	}
	const sourceStation = foundation.stations.finalPathStationsMeters[sourceStationRow] as number;
	const destinationStation = foundation.stations.finalPathStationsMeters[
		destinationStationRow
	] as number;
	const legRow = requestRow * 3 + leg;
	const pathStart = routes.legPathOffsets[legRow] as number;
	const pathEnd = routes.legPathOffsets[legRow + 1] as number;
	const intervals: SimulationRoutePathInterval[] = [];
	let cursor = routeStart;
	for (let pathPosition = pathStart; pathPosition < pathEnd; pathPosition++) {
		const pathRow = routes.legPathRows[pathPosition] as number;
		const start = pathPosition === pathStart ? sourceStation : 0;
		const end =
			pathPosition === pathEnd - 1
				? destinationStation
				: (foundation.paths.lengths[pathRow] as number);
		if (end <= start) {
			throw new Error(`Resident request row ${requestRow} lease leg has an empty path interval.`);
		}
		intervals.push(Object.freeze({ pathRow, start, end, routeStart: cursor }));
		cursor += end - start;
	}
	return Object.freeze(intervals);
}

function assertCompatibleSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
): void {
	for (const [label, error] of [
		["foundation", simulationStaticWorldFoundationError(foundation)],
		["track resources", simulationTrackResourceTopologyError(trackResources)],
		["occupancy policy", simulationTrackOccupancyPolicyError(occupancyPolicy)],
		["parking", simulationResidentFleetParkingConfigurationError(parking)],
		["routes", simulationResidentCycleRoutesError(routes)],
	] as const) {
		if (error) throw new Error(`Simulation resident cycle lease ${label} is invalid: ${error}`);
	}
	if (
		trackResources.sourceFoundationFingerprint !== foundation.fingerprint ||
		occupancyPolicy.sourceFoundationFingerprint !== foundation.fingerprint ||
		occupancyPolicy.sourceTrackResourceTopologyFingerprint !== trackResources.fingerprint ||
		routes.sourceFoundationFingerprint !== foundation.fingerprint ||
		routes.sourceTrackResourceTopologyFingerprint !== trackResources.fingerprint ||
		routes.sourceOccupancyPolicyFingerprint !== occupancyPolicy.fingerprint ||
		routes.sourceParkingConfigurationFingerprint !== parking.fingerprint ||
		!simulationResidentFleetParkingConfigurationMatchesSources(
			foundation,
			trackResources,
			occupancyPolicy,
			parking,
		)
	) {
		throw new Error("Resident cycle lease inputs do not share one exact source chain.");
	}
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const slotRow = routes.homeSlotRows[requestRow] as number;
		if (
			slotRow >= parking.slotCount ||
			routes.homeSlotIds[requestRow] !== parking.slotIds[slotRow] ||
			routes.homePortIds[requestRow] !== parking.anchorPortIds[slotRow]
		) {
			throw new Error("Resident cycle lease route home identity does not match parking.");
		}
	}
}

function assertTypedMemoryLimit(
	requestCount: number,
	trackCount: number,
	movementCount: number,
	switchCount: number,
): void {
	const bytes =
		requestCount * Uint32Array.BYTES_PER_ELEMENT * 2 +
		(requestCount + 1) * Uint32Array.BYTES_PER_ELEMENT * 3 +
		(trackCount + movementCount + switchCount) * Uint32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(bytes) || bytes > SIMULATION_RESIDENT_CYCLE_LEASE_MAX_TYPED_BYTES) {
		throw new RangeError("Resident cycle lease claims exceed the typed-memory limit.");
	}
}

function simulationResidentCycleLeaseClaimViews(
	claims: Omit<SimulationResidentCycleLeaseClaims, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		claims.homeSlotRows,
		claims.homeSlotIds,
		claims.nonHomeTrackResourceOffsets,
		claims.nonHomeTrackResourceRows,
		claims.movementClaimOffsets,
		claims.movementClaimRows,
		claims.switchConflictClaimOffsets,
		claims.switchConflictClaimRows,
	];
}

function csrValues(offsets: Uint32Array, values: Uint32Array, row: number): readonly number[] {
	return Array.from(values.subarray(offsets[row] as number, offsets[row + 1] as number));
}

function hasIndependentOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBuffer>();
	for (const view of views) {
		if (
			!(view.buffer instanceof ArrayBuffer) ||
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

function strictlyIncreasing(values: Uint32Array, start: number, end: number): boolean {
	for (let row = start + 1; row < end; row++) {
		if ((values[row] as number) <= (values[row - 1] as number)) return false;
	}
	return true;
}

function isCsr(value: unknown, rowCount: number, itemCount: number): value is Uint32Array {
	if (!(value instanceof Uint32Array) || value.length !== rowCount + 1 || value[0] !== 0) {
		return false;
	}
	for (let row = 1; row < value.length; row++) {
		if ((value[row] as number) < (value[row - 1] as number)) return false;
	}
	return value[rowCount] === itemCount;
}

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
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
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((candidate, row) => candidate === expected[row])
	);
}
