import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "./SimulationReadinessCertificate";
import {
	SIMULATION_SCENARIO_MAX_INPUT_RECORDS,
	type SimulationReplayHistoryRecord,
	type SimulationScenarioManifest,
	type SimulationTransferPlanRecord,
	simulationScenarioManifestError,
	simulationScenarioRecordId,
	simulationScenarioRecordTimeMicroseconds,
} from "./SimulationScenarioManifest";
import type { SimulationStaticWorldFoundation } from "./SimulationStaticWorldFoundation";
import { SIMULATION_STATION_TRANSFER_CAPABILITY_CODE } from "./SimulationStationOperationalCapabilities";
import type { SimulationTrackResourceTopology } from "./SimulationTrackResourceTopology";

export const SIMULATION_SCENARIO_ROUTE_REQUESTS_SCHEMA_VERSION = 1 as const;
export const SIMULATION_SCENARIO_ROUTE_SELECTION_POLICY =
	"SHORTEST_DIRECTED_DISTANCE_THEN_HOPS_THEN_PATH_ROW_V1" as const;
export const SIMULATION_SCENARIO_MAX_ROUTE_TYPED_BYTES = 128 * 1024 * 1024;
export const SIMULATION_SCENARIO_ROUTE_MISSING_RUNTIME_LAYERS = Object.freeze([
	"EXTENDED_ROUTE_LEASE",
	"SWITCH_MOVEMENT_CLAIMS",
	"VEHICLE_TOKEN_ALLOCATION",
	"FOUP_CUSTODY",
] as const);

const SIMULATION_SCENARIO_ROUTE_REQUEST_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingRuntimeLayers",
	"routeSelectionPolicy",
	"sourceKind",
	"sourceManifestFingerprint",
	"sourceCertificateFingerprint",
	"sourceReadinessProfileId",
	"runIdentityFingerprint",
	"requestCount",
	"sourceOrdinals",
	"requestedAtMicroseconds",
	"sourcePortIds",
	"destinationPortIds",
	"sourceStationRows",
	"destinationStationRows",
	"routePathOffsets",
	"routePathRows",
	"routeDistancesMeters",
	"corridorTrackResourceOffsets",
	"corridorTrackResourceRows",
	"fingerprint",
	"byteLength",
] as const);

export interface SimulationScenarioRouteRequests {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_ROUTE_REQUESTS_SCHEMA_VERSION;
	/** Route requests are immutable run inputs, not a runnable vehicle simulation. */
	readonly simulationRunnable: false;
	readonly missingRuntimeLayers: typeof SIMULATION_SCENARIO_ROUTE_MISSING_RUNTIME_LAYERS;
	readonly routeSelectionPolicy: typeof SIMULATION_SCENARIO_ROUTE_SELECTION_POLICY;
	readonly sourceKind: SimulationScenarioManifest["sourceKind"];
	readonly sourceManifestFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly sourceReadinessProfileId: string;
	readonly runIdentityFingerprint: string;
	readonly requestCount: number;
	/** Rows remain aligned with the canonical manifest; string identities stay in that manifest. */
	readonly sourceOrdinals: Float64Array;
	readonly requestedAtMicroseconds: Float64Array;
	readonly sourcePortIds: Uint32Array;
	readonly destinationPortIds: Uint32Array;
	readonly sourceStationRows: Uint32Array;
	readonly destinationStationRows: Uint32Array;
	readonly routePathOffsets: Uint32Array;
	readonly routePathRows: Uint32Array;
	readonly routeDistancesMeters: Float64Array;
	/** Ordered path-occurrence resources for the anchor corridor; not the extended lease bundle. */
	readonly corridorTrackResourceOffsets: Uint32Array;
	readonly corridorTrackResourceRows: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

export interface SimulationScenarioRouteCompilationScheduler {
	yield(): Promise<void>;
}

export interface SimulationScenarioRouteCompilationOptions {
	readonly signal?: AbortSignal;
	readonly scheduler?: SimulationScenarioRouteCompilationScheduler;
	readonly checkpointVisitedPaths?: number;
	readonly checkpointRequests?: number;
}

export interface SimulationDirectedRouteCorridor {
	readonly pathRows: readonly number[];
	readonly distanceMeters: number;
	readonly corridorTrackResourceRows: readonly number[];
}

export interface SimulationDirectedRouteCompilationContext {
	readonly scheduler: SimulationScenarioRouteCompilationScheduler;
	readonly checkpointVisitedPaths: number;
	readonly assertNotCancelled: () => void;
}

export class SimulationScenarioRouteCompilationCancelledError extends Error {
	constructor() {
		super("Simulation scenario route compilation was cancelled.");
		this.name = "SimulationScenarioRouteCompilationCancelledError";
	}
}

export async function compileSimulationScenarioRouteRequests(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	options: SimulationScenarioRouteCompilationOptions = {},
): Promise<SimulationScenarioRouteRequests> {
	const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
	if (snapshotError) throw new Error(`Published readiness snapshot is invalid: ${snapshotError}`);
	const manifestError = simulationScenarioManifestError(manifest);
	if (manifestError) throw new Error(`Simulation scenario manifest is invalid: ${manifestError}`);
	const checkpointVisitedPaths = options.checkpointVisitedPaths ?? 2_048;
	const checkpointRequests = options.checkpointRequests ?? 256;
	if (
		!Number.isSafeInteger(checkpointVisitedPaths) ||
		checkpointVisitedPaths <= 0 ||
		!Number.isSafeInteger(checkpointRequests) ||
		checkpointRequests <= 0
	) {
		throw new RangeError("Scenario route checkpoint intervals must be positive safe integers.");
	}
	assertNotCancelled(options.signal);
	const scheduler = options.scheduler ?? IMMEDIATE_SCHEDULER;
	const stationRowByPortId = stationRowsByPortId(snapshot);
	const routeByStationPair = new Map<string, SimulationDirectedRouteCorridor>();
	const sourceOrdinals = new Float64Array(manifest.records.length);
	const requestedAtMicroseconds = new Float64Array(manifest.records.length);
	const sourcePortIds = new Uint32Array(manifest.records.length);
	const destinationPortIds = new Uint32Array(manifest.records.length);
	const sourceStationRows = new Uint32Array(manifest.records.length);
	const destinationStationRows = new Uint32Array(manifest.records.length);
	const routePathOffsets = new Uint32Array(manifest.records.length + 1);
	const routePathRows: number[] = [];
	const routeDistancesMeters = new Float64Array(manifest.records.length);
	const corridorTrackResourceOffsets = new Uint32Array(manifest.records.length + 1);
	const corridorTrackResourceRows: number[] = [];
	const fixedTypedByteLength =
		sourceOrdinals.byteLength +
		requestedAtMicroseconds.byteLength +
		sourcePortIds.byteLength +
		destinationPortIds.byteLength +
		sourceStationRows.byteLength +
		destinationStationRows.byteLength +
		routePathOffsets.byteLength +
		routeDistancesMeters.byteLength +
		corridorTrackResourceOffsets.byteLength;
	const maximumVariableRows = Math.floor(
		(SIMULATION_SCENARIO_MAX_ROUTE_TYPED_BYTES - fixedTypedByteLength) /
			Uint32Array.BYTES_PER_ELEMENT,
	);
	if (maximumVariableRows < 0) {
		throw new RangeError("Scenario route fixed columns exceed the typed-memory limit.");
	}

	for (let requestRow = 0; requestRow < manifest.records.length; requestRow++) {
		assertNotCancelled(options.signal);
		if (requestRow > 0 && requestRow % checkpointRequests === 0) {
			await scheduler.yield();
			assertNotCancelled(options.signal);
		}
		const record = manifest.records[requestRow] as
			| SimulationTransferPlanRecord
			| SimulationReplayHistoryRecord;
		const requestId = simulationScenarioRecordId(manifest, record);
		const sourceStationRow = stationRowByPortId.get(record.sourcePortId);
		const destinationStationRow = stationRowByPortId.get(record.destinationPortId);
		if (sourceStationRow === undefined || destinationStationRow === undefined) {
			throw new Error(`Scenario request ${requestId} references a port outside the certificate.`);
		}
		assertStationCapability(snapshot, sourceStationRow, true, requestId);
		assertStationCapability(snapshot, destinationStationRow, false, requestId);
		const routeKey = `${sourceStationRow}:${destinationStationRow}`;
		let route = routeByStationPair.get(routeKey);
		if (!route) {
			route = await compileSimulationDirectedRouteCorridorFromValidatedSources(
				snapshot.foundation,
				snapshot.trackResources,
				sourceStationRow,
				destinationStationRow,
				requestId,
				{
					scheduler,
					checkpointVisitedPaths,
					assertNotCancelled: () => assertNotCancelled(options.signal),
				},
			);
			routeByStationPair.set(routeKey, route);
		}
		if (
			routePathRows.length +
				corridorTrackResourceRows.length +
				route.pathRows.length +
				route.corridorTrackResourceRows.length >
			maximumVariableRows
		) {
			throw new RangeError("Scenario route columns exceed the typed-memory limit.");
		}
		sourceOrdinals[requestRow] = record.sourceOrdinal;
		requestedAtMicroseconds[requestRow] = simulationScenarioRecordTimeMicroseconds(
			manifest,
			record,
		);
		sourcePortIds[requestRow] = record.sourcePortId;
		destinationPortIds[requestRow] = record.destinationPortId;
		sourceStationRows[requestRow] = sourceStationRow;
		destinationStationRows[requestRow] = destinationStationRow;
		routePathOffsets[requestRow] = routePathRows.length;
		for (const pathRow of route.pathRows) routePathRows.push(pathRow);
		routeDistancesMeters[requestRow] = route.distanceMeters;
		corridorTrackResourceOffsets[requestRow] = corridorTrackResourceRows.length;
		for (const resourceRow of route.corridorTrackResourceRows) {
			corridorTrackResourceRows.push(resourceRow);
		}
	}
	routePathOffsets[manifest.records.length] = routePathRows.length;
	corridorTrackResourceOffsets[manifest.records.length] = corridorTrackResourceRows.length;
	const runIdentityFingerprint = checksumSimulationScenarioRunIdentity(snapshot, manifest);
	const requestsWithoutIdentity = {
		schemaVersion: SIMULATION_SCENARIO_ROUTE_REQUESTS_SCHEMA_VERSION,
		simulationRunnable: false,
		missingRuntimeLayers: SIMULATION_SCENARIO_ROUTE_MISSING_RUNTIME_LAYERS,
		routeSelectionPolicy: SIMULATION_SCENARIO_ROUTE_SELECTION_POLICY,
		sourceKind: manifest.sourceKind,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceCertificateFingerprint: snapshot.certificate.fingerprint,
		sourceReadinessProfileId: snapshot.certificate.readinessProfileId,
		runIdentityFingerprint,
		requestCount: manifest.records.length,
		sourceOrdinals,
		requestedAtMicroseconds,
		sourcePortIds,
		destinationPortIds,
		sourceStationRows,
		destinationStationRows,
		routePathOffsets,
		routePathRows: Uint32Array.from(routePathRows),
		routeDistancesMeters,
		corridorTrackResourceOffsets,
		corridorTrackResourceRows: Uint32Array.from(corridorTrackResourceRows),
	} as const;
	const views = simulationScenarioRouteRequestViews(requestsWithoutIdentity);
	const requests = Object.freeze({
		...requestsWithoutIdentity,
		fingerprint: checksumSimulationScenarioRouteRequests(requestsWithoutIdentity),
		byteLength: views.reduce((total, view) => total + view.byteLength, 0),
	}) satisfies SimulationScenarioRouteRequests;
	const error = simulationScenarioRouteRequestsError(requests);
	if (error) throw new Error(`Compiled scenario route requests are invalid: ${error}`);
	return requests;
}

export function checksumSimulationScenarioRunIdentity(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		manifest.sourceKind,
		manifest.fingerprint,
		snapshot.certificate.fingerprint,
		snapshot.certificate.readinessProfileId,
		snapshot.certificate.activeRunEditPolicy,
	]);
	return checksum.digest();
}

export function simulationScenarioRouteRequestsMatchSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	requests: SimulationScenarioRouteRequests,
): boolean {
	return (
		publishedSimulationReadinessSnapshotError(snapshot) === null &&
		simulationScenarioManifestError(manifest) === null &&
		simulationScenarioRouteRequestsError(requests) === null &&
		simulationScenarioRouteRequestsMatchValidatedSources(snapshot, manifest, requests)
	);
}

/** Checks exact source binding after each supplied artifact has passed its own error validator. */
export function simulationScenarioRouteRequestsMatchValidatedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	requests: SimulationScenarioRouteRequests,
): boolean {
	return (
		requests.sourceKind === manifest.sourceKind &&
		requests.sourceManifestFingerprint === manifest.fingerprint &&
		requests.sourceCertificateFingerprint === snapshot.certificate.fingerprint &&
		requests.sourceReadinessProfileId === snapshot.certificate.readinessProfileId &&
		requests.runIdentityFingerprint === checksumSimulationScenarioRunIdentity(snapshot, manifest) &&
		requests.requestCount === manifest.records.length &&
		manifest.records.every((record, row) =>
			requestRowMatchesManifestRecord(snapshot, requests, manifest, record, row),
		) &&
		routeRowsMatchSnapshot(snapshot, requests)
	);
}

export function simulationScenarioRouteRequestTransfers(
	requests: SimulationScenarioRouteRequests,
): readonly ArrayBuffer[] {
	const error = simulationScenarioRouteRequestsError(requests);
	if (error) throw new Error(`Simulation scenario route requests are invalid: ${error}`);
	return simulationScenarioRouteRequestViews(requests).map((view) => view.buffer as ArrayBuffer);
}

export function checksumSimulationScenarioRouteRequests(
	requests: Omit<SimulationScenarioRouteRequests, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		requests.schemaVersion,
		requests.simulationRunnable ? 1 : 0,
		requests.requestCount,
	]);
	checksum.addStrings([
		requests.sourceKind,
		requests.routeSelectionPolicy,
		...requests.missingRuntimeLayers,
		requests.sourceManifestFingerprint,
		requests.sourceCertificateFingerprint,
		requests.sourceReadinessProfileId,
		requests.runIdentityFingerprint,
	]);
	checksum.addViews(simulationScenarioRouteRequestViews(requests));
	return checksum.digest();
}

export function simulationScenarioRouteRequestsError(value: unknown): string | null {
	if (!isRecord(value)) return "scenario route requests must be an object";
	if (!hasExactKeys(value, SIMULATION_SCENARIO_ROUTE_REQUEST_KEYS)) {
		return "scenario route requests contain missing or unexpected fields";
	}
	if (value.schemaVersion !== SIMULATION_SCENARIO_ROUTE_REQUESTS_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationRunnable !== false) return "route requests cannot authorize a run";
	if (
		!Array.isArray(value.missingRuntimeLayers) ||
		value.missingRuntimeLayers.join("|") !==
			SIMULATION_SCENARIO_ROUTE_MISSING_RUNTIME_LAYERS.join("|")
	) {
		return "missing runtime layers are invalid";
	}
	if (
		value.routeSelectionPolicy !== SIMULATION_SCENARIO_ROUTE_SELECTION_POLICY ||
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY") ||
		!isNonEmptyString(value.sourceManifestFingerprint) ||
		!isNonEmptyString(value.sourceCertificateFingerprint) ||
		!isNonEmptyString(value.sourceReadinessProfileId) ||
		!isNonEmptyString(value.runIdentityFingerprint) ||
		!Number.isSafeInteger(value.requestCount) ||
		(value.requestCount as number) < 0 ||
		(value.requestCount as number) > SIMULATION_SCENARIO_MAX_INPUT_RECORDS
	) {
		return "route request source identity is invalid";
	}
	const count = value.requestCount as number;
	const pathCount = value.routePathRows instanceof Uint32Array ? value.routePathRows.length : -1;
	const resourceCount =
		value.corridorTrackResourceRows instanceof Uint32Array
			? value.corridorTrackResourceRows.length
			: -1;
	if (
		!isFloat64Array(value.sourceOrdinals, count) ||
		!isFloat64Array(value.requestedAtMicroseconds, count) ||
		!isUint32Array(value.sourcePortIds, count) ||
		!isUint32Array(value.destinationPortIds, count) ||
		!isUint32Array(value.sourceStationRows, count) ||
		!isUint32Array(value.destinationStationRows, count) ||
		!isCsr(value.routePathOffsets, count, pathCount) ||
		!isUint32Array(value.routePathRows, pathCount) ||
		!isFloat64Array(value.routeDistancesMeters, count) ||
		!isCsr(value.corridorTrackResourceOffsets, count, resourceCount) ||
		!isUint32Array(value.corridorTrackResourceRows, resourceCount)
	) {
		return "route request columns are malformed";
	}
	const requests = value as unknown as SimulationScenarioRouteRequests;
	if (!hasIndependentOwnedBuffers(simulationScenarioRouteRequestViews(requests))) {
		return "route request columns are not independently transferable";
	}
	const sourceOrdinals = new Set<number>();
	for (let row = 0; row < count; row++) {
		const sourceOrdinal = requests.sourceOrdinals[row] as number;
		if (
			!Number.isSafeInteger(sourceOrdinal) ||
			sourceOrdinal < 0 ||
			sourceOrdinals.has(sourceOrdinal) ||
			!Number.isSafeInteger(requests.requestedAtMicroseconds[row]) ||
			(requests.requestedAtMicroseconds[row] as number) < 0 ||
			requests.sourcePortIds[row] === 0 ||
			requests.destinationPortIds[row] === 0 ||
			!Number.isFinite(requests.routeDistancesMeters[row]) ||
			(requests.routeDistancesMeters[row] as number) <= 0
		) {
			return "route request time, ordinal, port identity, or distance is invalid";
		}
		sourceOrdinals.add(sourceOrdinal);
		if ((requests.routePathOffsets[row + 1] as number) <= requests.routePathOffsets[row]) {
			return "route request path corridor is empty";
		}
	}
	const expectedBytes = simulationScenarioRouteRequestViews(requests).reduce(
		(total, view) => total + view.byteLength,
		0,
	);
	if (value.byteLength !== expectedBytes) return "route request byte length is invalid";
	if (expectedBytes > SIMULATION_SCENARIO_MAX_ROUTE_TYPED_BYTES) {
		return "route request typed-memory limit is exceeded";
	}
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationScenarioRouteRequests(requests) !== value.fingerprint
	) {
		return "route request fingerprint is invalid";
	}
	return null;
}

/** Shared deterministic corridor primitive; callers must validate and bind both supplied sources. */
export async function compileSimulationDirectedRouteCorridorFromValidatedSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	sourceStationRow: number,
	destinationStationRow: number,
	requestId: string,
	context: SimulationDirectedRouteCompilationContext,
): Promise<SimulationDirectedRouteCorridor> {
	if (
		trackResources.sourceFoundationFingerprint !== foundation.fingerprint ||
		!Number.isSafeInteger(sourceStationRow) ||
		sourceStationRow < 0 ||
		sourceStationRow >= foundation.stations.count ||
		!Number.isSafeInteger(destinationStationRow) ||
		destinationStationRow < 0 ||
		destinationStationRow >= foundation.stations.count ||
		!Number.isSafeInteger(context.checkpointVisitedPaths) ||
		context.checkpointVisitedPaths <= 0
	) {
		throw new Error(`Route request ${requestId} has invalid validated-source inputs.`);
	}
	context.assertNotCancelled();
	const paths = foundation.paths;
	const stations = foundation.stations;
	const sourcePath = stations.finalPathIndices[sourceStationRow] as number;
	const destinationPath = stations.finalPathIndices[destinationStationRow] as number;
	const sourceStation = stations.finalPathStationsMeters[sourceStationRow] as number;
	const destinationStation = stations.finalPathStationsMeters[destinationStationRow] as number;
	if (sourcePath === destinationPath && destinationStation > sourceStation) {
		const pathRows = Object.freeze([sourcePath]);
		return Object.freeze({
			pathRows,
			distanceMeters: destinationStation - sourceStation,
			corridorTrackResourceRows: corridorTrackResources(
				foundation,
				trackResources,
				pathRows,
				sourceStationRow,
				destinationStationRow,
			),
		});
	}
	const distances = new Float64Array(paths.pathCount);
	distances.fill(Number.POSITIVE_INFINITY);
	const hops = new Uint32Array(paths.pathCount);
	hops.fill(0xffff_ffff);
	const predecessors = new Int32Array(paths.pathCount);
	predecessors.fill(-2);
	const heap = new PathHeap();
	const sourceEndDistance = (paths.lengths[sourcePath] as number) - sourceStation;
	const adjacencyStart = paths.adjacencyOffsets[sourcePath] as number;
	const adjacencyEnd = paths.adjacencyOffsets[sourcePath + 1] as number;
	for (let row = adjacencyStart; row < adjacencyEnd; row++) {
		const successor = paths.adjacencyTargets[row] as number;
		if (
			betterPathState(sourceEndDistance, 1, sourcePath, successor, distances, hops, predecessors)
		) {
			distances[successor] = sourceEndDistance;
			hops[successor] = 1;
			predecessors[successor] = -1;
			heap.push({ pathRow: successor, distance: sourceEndDistance, hops: 1 });
		}
	}
	let visitedPaths = 0;
	while (heap.size > 0) {
		context.assertNotCancelled();
		const current = heap.pop() as PathHeapItem;
		if (current.distance !== distances[current.pathRow] || current.hops !== hops[current.pathRow]) {
			continue;
		}
		visitedPaths++;
		if (visitedPaths % context.checkpointVisitedPaths === 0) {
			await context.scheduler.yield();
			context.assertNotCancelled();
		}
		if (current.pathRow === destinationPath) {
			const pathRows = Object.freeze(
				reconstructPathRows(sourcePath, destinationPath, predecessors),
			);
			return Object.freeze({
				pathRows,
				distanceMeters: current.distance + destinationStation,
				corridorTrackResourceRows: corridorTrackResources(
					foundation,
					trackResources,
					pathRows,
					sourceStationRow,
					destinationStationRow,
				),
			});
		}
		const nextDistance = current.distance + (paths.lengths[current.pathRow] as number);
		const start = paths.adjacencyOffsets[current.pathRow] as number;
		const end = paths.adjacencyOffsets[current.pathRow + 1] as number;
		for (let row = start; row < end; row++) {
			const successor = paths.adjacencyTargets[row] as number;
			const nextHops = current.hops + 1;
			if (
				betterPathState(
					nextDistance,
					nextHops,
					current.pathRow,
					successor,
					distances,
					hops,
					predecessors,
				)
			) {
				distances[successor] = nextDistance;
				hops[successor] = nextHops;
				predecessors[successor] = current.pathRow;
				heap.push({ pathRow: successor, distance: nextDistance, hops: nextHops });
			}
		}
	}
	throw new Error(`Route request ${requestId} has no directed route between its ports.`);
}

function betterPathState(
	distance: number,
	hopCount: number,
	predecessor: number,
	pathRow: number,
	distances: Float64Array,
	hops: Uint32Array,
	predecessors: Int32Array,
): boolean {
	const knownDistance = distances[pathRow] as number;
	if (distance < knownDistance) return true;
	if (distance > knownDistance) return false;
	const knownHops = hops[pathRow] as number;
	if (hopCount < knownHops) return true;
	if (hopCount > knownHops) return false;
	return predecessor < (predecessors[pathRow] as number);
}

function reconstructPathRows(
	sourcePath: number,
	destinationPath: number,
	predecessors: Int32Array,
): number[] {
	const reversed: number[] = [];
	let current = destinationPath;
	while (current >= 0) {
		reversed.push(current);
		current = predecessors[current] as number;
	}
	reversed.reverse();
	return [sourcePath, ...reversed];
}

function corridorTrackResources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	pathRows: readonly number[],
	sourceStationRow: number,
	destinationStationRow: number,
): readonly number[] {
	const output: number[] = [];
	const sourceStation = foundation.stations.finalPathStationsMeters[sourceStationRow] as number;
	const destinationStation = foundation.stations.finalPathStationsMeters[
		destinationStationRow
	] as number;
	for (let routeRow = 0; routeRow < pathRows.length; routeRow++) {
		const pathRow = pathRows[routeRow] as number;
		const corridorStart = routeRow === 0 ? sourceStation : 0;
		const corridorEnd =
			routeRow === pathRows.length - 1
				? destinationStation
				: (foundation.paths.lengths[pathRow] as number);
		const start = trackResources.pathResourceOffsets[pathRow] as number;
		const end = trackResources.pathResourceOffsets[pathRow + 1] as number;
		for (let row = start; row < end; row++) {
			const resourceStart = trackResources.pathResourceStarts[row] as number;
			const resourceEnd = trackResources.pathResourceEnds[row] as number;
			if (resourceEnd > corridorStart && resourceStart < corridorEnd) {
				output.push(trackResources.pathResourceRows[row] as number);
			}
		}
	}
	return Object.freeze(output);
}

function stationRowsByPortId(snapshot: PublishedSimulationReadinessSnapshot): Map<number, number> {
	const rows = new Map<number, number>();
	for (let row = 0; row < snapshot.stationCapabilities.stationCount; row++) {
		rows.set(snapshot.stationCapabilities.portIds[row] as number, row);
	}
	return rows;
}

function assertStationCapability(
	snapshot: PublishedSimulationReadinessSnapshot,
	stationRow: number,
	pickup: boolean,
	requestId: string,
): void {
	const code = snapshot.stationCapabilities.transferCapabilityCodes[stationRow] as number;
	const allowed = pickup
		? code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.PICKUP_ONLY ||
			code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.BIDIRECTIONAL
		: code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.DROPOFF_ONLY ||
			code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.BIDIRECTIONAL;
	if (!allowed) {
		throw new Error(
			`Scenario request ${requestId} uses a port without explicit ${pickup ? "pickup" : "dropoff"} capability.`,
		);
	}
}

function simulationScenarioRouteRequestViews(
	requests: Omit<SimulationScenarioRouteRequests, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		requests.sourceOrdinals,
		requests.requestedAtMicroseconds,
		requests.sourcePortIds,
		requests.destinationPortIds,
		requests.sourceStationRows,
		requests.destinationStationRows,
		requests.routePathOffsets,
		requests.routePathRows,
		requests.routeDistancesMeters,
		requests.corridorTrackResourceOffsets,
		requests.corridorTrackResourceRows,
	];
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

function requestRowMatchesManifestRecord(
	snapshot: PublishedSimulationReadinessSnapshot,
	requests: SimulationScenarioRouteRequests,
	manifest: SimulationScenarioManifest,
	record: SimulationTransferPlanRecord | SimulationReplayHistoryRecord,
	row: number,
): boolean {
	const sourceStationRow = requests.sourceStationRows[row] as number;
	const destinationStationRow = requests.destinationStationRows[row] as number;
	const pathStart = requests.routePathOffsets[row] as number;
	const pathEnd = requests.routePathOffsets[row + 1] as number;
	return (
		requests.sourceOrdinals[row] === record.sourceOrdinal &&
		requests.requestedAtMicroseconds[row] ===
			simulationScenarioRecordTimeMicroseconds(manifest, record) &&
		requests.sourcePortIds[row] === record.sourcePortId &&
		requests.destinationPortIds[row] === record.destinationPortId &&
		sourceStationRow < snapshot.stationCapabilities.stationCount &&
		destinationStationRow < snapshot.stationCapabilities.stationCount &&
		snapshot.stationCapabilities.portIds[sourceStationRow] === record.sourcePortId &&
		snapshot.stationCapabilities.portIds[destinationStationRow] === record.destinationPortId &&
		requests.routePathRows[pathStart] ===
			snapshot.foundation.stations.finalPathIndices[sourceStationRow] &&
		requests.routePathRows[pathEnd - 1] ===
			snapshot.foundation.stations.finalPathIndices[destinationStationRow]
	);
}

function routeRowsMatchSnapshot(
	snapshot: PublishedSimulationReadinessSnapshot,
	requests: SimulationScenarioRouteRequests,
): boolean {
	for (const pathRow of requests.routePathRows) {
		if (pathRow >= snapshot.foundation.paths.pathCount) return false;
	}
	for (const resourceRow of requests.corridorTrackResourceRows) {
		if (resourceRow >= snapshot.trackResources.trackResourceCount) return false;
	}
	return true;
}

interface PathHeapItem {
	readonly pathRow: number;
	readonly distance: number;
	readonly hops: number;
}

class PathHeap {
	private readonly items: PathHeapItem[] = [];

	get size(): number {
		return this.items.length;
	}

	push(item: PathHeapItem): void {
		this.items.push(item);
		let index = this.items.length - 1;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (compareHeapItems(this.items[parent] as PathHeapItem, item) <= 0) break;
			this.items[index] = this.items[parent] as PathHeapItem;
			index = parent;
		}
		this.items[index] = item;
	}

	pop(): PathHeapItem | undefined {
		const first = this.items[0];
		const last = this.items.pop();
		if (!first || !last || this.items.length === 0) return first;
		let index = 0;
		while (true) {
			const left = index * 2 + 1;
			if (left >= this.items.length) break;
			const right = left + 1;
			const child =
				right < this.items.length &&
				compareHeapItems(this.items[right] as PathHeapItem, this.items[left] as PathHeapItem) < 0
					? right
					: left;
			if (compareHeapItems(last, this.items[child] as PathHeapItem) <= 0) break;
			this.items[index] = this.items[child] as PathHeapItem;
			index = child;
		}
		this.items[index] = last;
		return first;
	}
}

function compareHeapItems(left: PathHeapItem, right: PathHeapItem): number {
	return left.distance - right.distance || left.hops - right.hops || left.pathRow - right.pathRow;
}

const IMMEDIATE_SCHEDULER: SimulationScenarioRouteCompilationScheduler = Object.freeze({
	yield: () => Promise.resolve(),
});

function assertNotCancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new SimulationScenarioRouteCompilationCancelledError();
}

function isFloat64Array(value: unknown, length: number): value is Float64Array {
	return value instanceof Float64Array && value.length === length;
}

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isCsr(value: unknown, domainCount: number, itemCount: number): value is Uint32Array {
	if (!(value instanceof Uint32Array) || value.length !== domainCount + 1 || value[0] !== 0) {
		return false;
	}
	if (value[domainCount] !== itemCount) return false;
	for (let row = 1; row < value.length; row++) {
		if ((value[row] as number) < (value[row - 1] as number)) return false;
	}
	return true;
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
