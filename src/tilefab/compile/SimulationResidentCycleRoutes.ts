import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type SimulationResidentFleetParkingConfiguration,
	simulationResidentFleetParkingConfigurationError,
	simulationResidentFleetParkingConfigurationMatchesSources,
} from "./SimulationResidentFleetParkingConfiguration";
import {
	type SimulationResidentReplayHistoryRecord,
	type SimulationResidentScenarioManifest,
	type SimulationResidentTransferPlanRecord,
	simulationResidentScenarioManifestError,
	simulationResidentScenarioManifestMatchesParkingConfiguration,
} from "./SimulationResidentScenarioManifest";
import {
	compileSimulationDirectedRouteCorridorFromValidatedSources,
	SIMULATION_SCENARIO_ROUTE_SELECTION_POLICY,
	type SimulationDirectedRouteCorridor,
	type SimulationScenarioRouteCompilationScheduler,
} from "./SimulationScenarioRouteRequests";
import {
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import {
	SIMULATION_STATION_TRANSFER_CAPABILITY_CODE,
	type SimulationStationOperationalCapabilities,
	simulationStationOperationalCapabilitiesError,
} from "./SimulationStationOperationalCapabilities";
import {
	type SimulationTrackOccupancyPolicy,
	simulationTrackOccupancyPolicyError,
} from "./SimulationTrackOccupancyPolicy";
import {
	type SimulationTrackResourceTopology,
	simulationTrackResourceTopologyError,
} from "./SimulationTrackResourceTopology";

export const SIMULATION_RESIDENT_CYCLE_ROUTES_SCHEMA_VERSION = 1 as const;
export const SIMULATION_RESIDENT_CYCLE_LEG_POLICY =
	"HOME_TO_PICKUP_THEN_DROPOFF_THEN_HOME_V1" as const;
export const SIMULATION_RESIDENT_HOME_BOUNDARY_POLICY =
	"OWNER_HOME_ONLY_AT_DEPARTURE_PREFIX_AND_RETURN_SUFFIX_V1" as const;
export const SIMULATION_RESIDENT_FOREIGN_HOME_POLICY =
	"NO_CYCLE_CORRIDOR_RESOURCE_INTERSECTS_FOREIGN_HOME_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_LEGS_PER_REQUEST = 3 as const;
export const SIMULATION_RESIDENT_CYCLE_MAX_TYPED_BYTES = 256 * 1024 * 1024;
export const SIMULATION_RESIDENT_CYCLE_ROUTE_MISSING_SAFETY_LAYERS = Object.freeze([
	"ATOMIC_COMPLETE_CYCLE_LEASE",
	"RESIDENT_READINESS_CERTIFICATE",
	"RESIDENT_RUN_AUTHORIZATION",
] as const);

const ROUTE_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingSafetyLayers",
	"routeSelectionPolicy",
	"cycleLegPolicy",
	"ownerHomeBoundaryPolicy",
	"foreignHomePolicy",
	"ownerHomeBoundaryProven",
	"foreignHomeNonInterferenceProven",
	"sourceKind",
	"sourceManifestFingerprint",
	"sourceParkingConfigurationFingerprint",
	"sourceFoundationFingerprint",
	"sourceTrackResourceTopologyFingerprint",
	"sourceOccupancyPolicyFingerprint",
	"sourceStationCapabilitiesFingerprint",
	"requestCount",
	"sourceOrdinals",
	"requestedAtMicroseconds",
	"homeSlotRows",
	"homeSlotIds",
	"homePortIds",
	"pickupPortIds",
	"dropoffPortIds",
	"legPathOffsets",
	"legPathRows",
	"legDistancesMeters",
	"legCorridorTrackResourceOffsets",
	"legCorridorTrackResourceRows",
	"cycleCorridorTrackResourceOffsets",
	"cycleCorridorTrackResourceRows",
	"fingerprint",
	"byteLength",
] as const);

export interface SimulationResidentCycleRoutes {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_CYCLE_ROUTES_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingSafetyLayers: typeof SIMULATION_RESIDENT_CYCLE_ROUTE_MISSING_SAFETY_LAYERS;
	readonly routeSelectionPolicy: typeof SIMULATION_SCENARIO_ROUTE_SELECTION_POLICY;
	readonly cycleLegPolicy: typeof SIMULATION_RESIDENT_CYCLE_LEG_POLICY;
	readonly ownerHomeBoundaryPolicy: typeof SIMULATION_RESIDENT_HOME_BOUNDARY_POLICY;
	readonly foreignHomePolicy: typeof SIMULATION_RESIDENT_FOREIGN_HOME_POLICY;
	readonly ownerHomeBoundaryProven: true;
	readonly foreignHomeNonInterferenceProven: true;
	readonly sourceKind: SimulationResidentScenarioManifest["sourceKind"];
	readonly sourceManifestFingerprint: string;
	readonly sourceParkingConfigurationFingerprint: string;
	readonly sourceFoundationFingerprint: string;
	readonly sourceTrackResourceTopologyFingerprint: string;
	readonly sourceOccupancyPolicyFingerprint: string;
	readonly sourceStationCapabilitiesFingerprint: string;
	readonly requestCount: number;
	readonly sourceOrdinals: Float64Array;
	readonly requestedAtMicroseconds: Float64Array;
	readonly homeSlotRows: Uint32Array;
	readonly homeSlotIds: Uint32Array;
	readonly homePortIds: Uint32Array;
	readonly pickupPortIds: Uint32Array;
	readonly dropoffPortIds: Uint32Array;
	/** Three rows per request: home-to-pickup, pickup-to-dropoff, dropoff-to-home. */
	readonly legPathOffsets: Uint32Array;
	readonly legPathRows: Uint32Array;
	readonly legDistancesMeters: Float64Array;
	readonly legCorridorTrackResourceOffsets: Uint32Array;
	readonly legCorridorTrackResourceRows: Uint32Array;
	/** Canonically sorted unique union of all three leg corridors for each request. */
	readonly cycleCorridorTrackResourceOffsets: Uint32Array;
	readonly cycleCorridorTrackResourceRows: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

export interface SimulationResidentCycleRouteCompilationOptions {
	readonly signal?: AbortSignal;
	readonly scheduler?: SimulationScenarioRouteCompilationScheduler;
	readonly checkpointVisitedPaths?: number;
	readonly checkpointRequests?: number;
}

export class SimulationResidentCycleRouteCompilationCancelledError extends Error {
	constructor() {
		super("Simulation resident cycle route compilation was cancelled.");
		this.name = "SimulationResidentCycleRouteCompilationCancelledError";
	}
}

export async function compileSimulationResidentCycleRoutes(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	stationCapabilities: SimulationStationOperationalCapabilities,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	options: SimulationResidentCycleRouteCompilationOptions = {},
): Promise<SimulationResidentCycleRoutes> {
	assertCompatibleSources(
		foundation,
		trackResources,
		occupancyPolicy,
		stationCapabilities,
		manifest,
		parking,
	);
	const checkpointVisitedPaths = options.checkpointVisitedPaths ?? 2_048;
	const checkpointRequests = options.checkpointRequests ?? 256;
	if (
		!isPositiveSafeInteger(checkpointVisitedPaths) ||
		!isPositiveSafeInteger(checkpointRequests)
	) {
		throw new RangeError(
			"Resident cycle route checkpoint intervals must be positive safe integers.",
		);
	}
	assertNotCancelled(options.signal);
	const scheduler = options.scheduler ?? IMMEDIATE_SCHEDULER;
	const stationRowByPortId = new Map<number, number>();
	for (let row = 0; row < stationCapabilities.stationCount; row++) {
		stationRowByPortId.set(stationCapabilities.portIds[row] as number, row);
	}
	const slotRowByVehicleId = new Map<string, number>();
	const homeFootprintBySlotRow = new Array<ReadonlySet<number>>(parking.slotCount);
	for (let slotRow = 0; slotRow < parking.slotCount; slotRow++) {
		slotRowByVehicleId.set(parking.vehicleIds[slotRow] as string, slotRow);
		homeFootprintBySlotRow[slotRow] = new Set(
			csrValues(parking.footprintTrackResourceOffsets, parking.footprintTrackResourceRows, slotRow),
		);
	}

	const requestCount = manifest.records.length;
	const legCount = requestCount * SIMULATION_RESIDENT_CYCLE_LEGS_PER_REQUEST;
	const sourceOrdinals = new Float64Array(requestCount);
	const requestedAtMicroseconds = new Float64Array(requestCount);
	const homeSlotRows = new Uint32Array(requestCount);
	const homeSlotIds = new Uint32Array(requestCount);
	const homePortIds = new Uint32Array(requestCount);
	const pickupPortIds = new Uint32Array(requestCount);
	const dropoffPortIds = new Uint32Array(requestCount);
	const legPathOffsets = new Uint32Array(legCount + 1);
	const legDistancesMeters = new Float64Array(legCount);
	const legCorridorTrackResourceOffsets = new Uint32Array(legCount + 1);
	const cycleCorridorTrackResourceOffsets = new Uint32Array(requestCount + 1);
	const legPathRows: number[] = [];
	const legCorridorTrackResourceRows: number[] = [];
	const cycleCorridorTrackResourceRows: number[] = [];
	const fixedByteLength = sumByteLengths([
		sourceOrdinals,
		requestedAtMicroseconds,
		homeSlotRows,
		homeSlotIds,
		homePortIds,
		pickupPortIds,
		dropoffPortIds,
		legPathOffsets,
		legDistancesMeters,
		legCorridorTrackResourceOffsets,
		cycleCorridorTrackResourceOffsets,
	]);
	if (fixedByteLength > SIMULATION_RESIDENT_CYCLE_MAX_TYPED_BYTES) {
		throw new RangeError("Resident cycle route fixed columns exceed the typed-memory limit.");
	}
	const maximumVariableRows = Math.floor(
		(SIMULATION_RESIDENT_CYCLE_MAX_TYPED_BYTES - fixedByteLength) / Uint32Array.BYTES_PER_ELEMENT,
	);
	const routeByStationPair = new Map<string, SimulationDirectedRouteCorridor>();

	for (let requestRow = 0; requestRow < requestCount; requestRow++) {
		assertNotCancelled(options.signal);
		if (requestRow > 0 && requestRow % checkpointRequests === 0) {
			await scheduler.yield();
			assertNotCancelled(options.signal);
		}
		const record = manifest.records[requestRow] as ResidentRecord;
		const slotRow = slotRowByVehicleId.get(record.vehicleId);
		if (slotRow === undefined) {
			throw new Error(`Resident request ${residentRecordId(manifest, record)} has no home slot.`);
		}
		const homePortId = parking.anchorPortIds[slotRow] as number;
		if (homePortId === record.sourcePortId || homePortId === record.destinationPortId) {
			throw new Error(
				`Resident request ${residentRecordId(manifest, record)} must keep its home port distinct from pickup and dropoff.`,
			);
		}
		const homeStationRow = parking.anchorStationRows[slotRow] as number;
		const pickupStationRow = stationRowByPortId.get(record.sourcePortId);
		const dropoffStationRow = stationRowByPortId.get(record.destinationPortId);
		if (pickupStationRow === undefined || dropoffStationRow === undefined) {
			throw new Error(
				`Resident request ${residentRecordId(manifest, record)} references a foreign service port.`,
			);
		}
		assertTransferCapability(stationCapabilities, pickupStationRow, true, manifest, record);
		assertTransferCapability(stationCapabilities, dropoffStationRow, false, manifest, record);
		const stationPairs = [
			[homeStationRow, pickupStationRow],
			[pickupStationRow, dropoffStationRow],
			[dropoffStationRow, homeStationRow],
		] as const;
		const requestRoutes: SimulationDirectedRouteCorridor[] = [];
		for (let leg = 0; leg < SIMULATION_RESIDENT_CYCLE_LEGS_PER_REQUEST; leg++) {
			const legRow = requestRow * SIMULATION_RESIDENT_CYCLE_LEGS_PER_REQUEST + leg;
			const [fromStationRow, toStationRow] = stationPairs[leg] as readonly [number, number];
			const cacheKey = `${fromStationRow}:${toStationRow}`;
			let route = routeByStationPair.get(cacheKey);
			if (!route) {
				route = await compileSimulationDirectedRouteCorridorFromValidatedSources(
					foundation,
					trackResources,
					fromStationRow,
					toStationRow,
					`${residentRecordId(manifest, record)} leg ${leg + 1}`,
					{
						scheduler,
						checkpointVisitedPaths,
						assertNotCancelled: () => assertNotCancelled(options.signal),
					},
				);
				routeByStationPair.set(cacheKey, route);
			}
			if (
				legPathRows.length +
					legCorridorTrackResourceRows.length +
					cycleCorridorTrackResourceRows.length +
					route.pathRows.length +
					route.corridorTrackResourceRows.length >
				maximumVariableRows
			) {
				throw new RangeError("Resident cycle route columns exceed the typed-memory limit.");
			}
			legPathOffsets[legRow] = legPathRows.length;
			legPathRows.push(...route.pathRows);
			legDistancesMeters[legRow] = route.distanceMeters;
			legCorridorTrackResourceOffsets[legRow] = legCorridorTrackResourceRows.length;
			legCorridorTrackResourceRows.push(...route.corridorTrackResourceRows);
			requestRoutes.push(route);
		}
		const ownerHomeFootprint = homeFootprintBySlotRow[slotRow] as ReadonlySet<number>;
		if (!ownerHomeAppearsOnlyAtCycleBoundary(requestRoutes, ownerHomeFootprint)) {
			throw new Error(
				`Resident request ${residentRecordId(manifest, record)} revisits its home footprint outside the departure/return boundary.`,
			);
		}
		assertForeignHomeNonInterference(
			requestRoutes,
			homeFootprintBySlotRow,
			slotRow,
			parking,
			residentRecordId(manifest, record),
		);
		const cycleRows = uniqueSortedCycleRows(requestRoutes);
		if (
			legPathRows.length +
				legCorridorTrackResourceRows.length +
				cycleCorridorTrackResourceRows.length +
				cycleRows.length >
			maximumVariableRows
		) {
			throw new RangeError("Resident cycle route columns exceed the typed-memory limit.");
		}
		cycleCorridorTrackResourceOffsets[requestRow] = cycleCorridorTrackResourceRows.length;
		cycleCorridorTrackResourceRows.push(...cycleRows);
		sourceOrdinals[requestRow] = record.sourceOrdinal;
		requestedAtMicroseconds[requestRow] = residentRecordTime(manifest, record);
		homeSlotRows[requestRow] = slotRow;
		homeSlotIds[requestRow] = parking.slotIds[slotRow] as number;
		homePortIds[requestRow] = homePortId;
		pickupPortIds[requestRow] = record.sourcePortId;
		dropoffPortIds[requestRow] = record.destinationPortId;
	}
	legPathOffsets[legCount] = legPathRows.length;
	legCorridorTrackResourceOffsets[legCount] = legCorridorTrackResourceRows.length;
	cycleCorridorTrackResourceOffsets[requestCount] = cycleCorridorTrackResourceRows.length;

	const routesWithoutIdentity = {
		schemaVersion: SIMULATION_RESIDENT_CYCLE_ROUTES_SCHEMA_VERSION,
		simulationRunnable: false,
		missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_ROUTE_MISSING_SAFETY_LAYERS,
		routeSelectionPolicy: SIMULATION_SCENARIO_ROUTE_SELECTION_POLICY,
		cycleLegPolicy: SIMULATION_RESIDENT_CYCLE_LEG_POLICY,
		ownerHomeBoundaryPolicy: SIMULATION_RESIDENT_HOME_BOUNDARY_POLICY,
		foreignHomePolicy: SIMULATION_RESIDENT_FOREIGN_HOME_POLICY,
		ownerHomeBoundaryProven: true,
		foreignHomeNonInterferenceProven: true,
		sourceKind: manifest.sourceKind,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceParkingConfigurationFingerprint: parking.fingerprint,
		sourceFoundationFingerprint: foundation.fingerprint,
		sourceTrackResourceTopologyFingerprint: trackResources.fingerprint,
		sourceOccupancyPolicyFingerprint: occupancyPolicy.fingerprint,
		sourceStationCapabilitiesFingerprint: stationCapabilities.fingerprint,
		requestCount,
		sourceOrdinals,
		requestedAtMicroseconds,
		homeSlotRows,
		homeSlotIds,
		homePortIds,
		pickupPortIds,
		dropoffPortIds,
		legPathOffsets,
		legPathRows: Uint32Array.from(legPathRows),
		legDistancesMeters,
		legCorridorTrackResourceOffsets,
		legCorridorTrackResourceRows: Uint32Array.from(legCorridorTrackResourceRows),
		cycleCorridorTrackResourceOffsets,
		cycleCorridorTrackResourceRows: Uint32Array.from(cycleCorridorTrackResourceRows),
	} as const;
	const views = simulationResidentCycleRouteViews(routesWithoutIdentity);
	const routes = Object.freeze({
		...routesWithoutIdentity,
		fingerprint: checksumSimulationResidentCycleRoutes(routesWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationResidentCycleRoutes;
	const error = simulationResidentCycleRoutesError(routes);
	if (error) throw new Error(`Compiled resident cycle routes are invalid: ${error}`);
	return routes;
}

export function checksumSimulationResidentCycleRoutes(
	routes: Omit<SimulationResidentCycleRoutes, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		routes.schemaVersion,
		routes.simulationRunnable ? 1 : 0,
		routes.ownerHomeBoundaryProven ? 1 : 0,
		routes.foreignHomeNonInterferenceProven ? 1 : 0,
		routes.requestCount,
	]);
	checksum.addStrings([
		...routes.missingSafetyLayers,
		routes.routeSelectionPolicy,
		routes.cycleLegPolicy,
		routes.ownerHomeBoundaryPolicy,
		routes.foreignHomePolicy,
		routes.sourceKind,
		routes.sourceManifestFingerprint,
		routes.sourceParkingConfigurationFingerprint,
		routes.sourceFoundationFingerprint,
		routes.sourceTrackResourceTopologyFingerprint,
		routes.sourceOccupancyPolicyFingerprint,
		routes.sourceStationCapabilitiesFingerprint,
	]);
	checksum.addViews(simulationResidentCycleRouteViews(routes));
	return checksum.digest();
}

export function simulationResidentCycleRoutesError(value: unknown): string | null {
	if (!isRecord(value)) return "resident cycle routes must be an object";
	if (!hasExactKeys(value, ROUTE_KEYS)) {
		return "resident cycle routes contain missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_RESIDENT_CYCLE_ROUTES_SCHEMA_VERSION ||
		value.simulationRunnable !== false ||
		!sameStrings(
			value.missingSafetyLayers,
			SIMULATION_RESIDENT_CYCLE_ROUTE_MISSING_SAFETY_LAYERS,
		) ||
		value.routeSelectionPolicy !== SIMULATION_SCENARIO_ROUTE_SELECTION_POLICY ||
		value.cycleLegPolicy !== SIMULATION_RESIDENT_CYCLE_LEG_POLICY ||
		value.ownerHomeBoundaryPolicy !== SIMULATION_RESIDENT_HOME_BOUNDARY_POLICY ||
		value.foreignHomePolicy !== SIMULATION_RESIDENT_FOREIGN_HOME_POLICY ||
		value.ownerHomeBoundaryProven !== true ||
		value.foreignHomeNonInterferenceProven !== true
	) {
		return "resident cycle route policy declaration is invalid";
	}
	if (
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY") ||
		!isNonEmptyString(value.sourceManifestFingerprint) ||
		!isNonEmptyString(value.sourceParkingConfigurationFingerprint) ||
		!isNonEmptyString(value.sourceFoundationFingerprint) ||
		!isNonEmptyString(value.sourceTrackResourceTopologyFingerprint) ||
		!isNonEmptyString(value.sourceOccupancyPolicyFingerprint) ||
		!isNonEmptyString(value.sourceStationCapabilitiesFingerprint) ||
		!isNonNegativeSafeInteger(value.requestCount) ||
		(value.requestCount as number) > 100_000
	) {
		return "resident cycle route source identity is invalid";
	}
	const requestCount = value.requestCount as number;
	const legCount = requestCount * SIMULATION_RESIDENT_CYCLE_LEGS_PER_REQUEST;
	const pathCount = value.legPathRows instanceof Uint32Array ? value.legPathRows.length : -1;
	const legResourceCount =
		value.legCorridorTrackResourceRows instanceof Uint32Array
			? value.legCorridorTrackResourceRows.length
			: -1;
	const cycleResourceCount =
		value.cycleCorridorTrackResourceRows instanceof Uint32Array
			? value.cycleCorridorTrackResourceRows.length
			: -1;
	if (
		!isFloat64Array(value.sourceOrdinals, requestCount) ||
		!isFloat64Array(value.requestedAtMicroseconds, requestCount) ||
		!isUint32Array(value.homeSlotRows, requestCount) ||
		!isUint32Array(value.homeSlotIds, requestCount) ||
		!isUint32Array(value.homePortIds, requestCount) ||
		!isUint32Array(value.pickupPortIds, requestCount) ||
		!isUint32Array(value.dropoffPortIds, requestCount) ||
		!isCsr(value.legPathOffsets, legCount, pathCount) ||
		!isUint32Array(value.legPathRows, pathCount) ||
		!isFloat64Array(value.legDistancesMeters, legCount) ||
		!isCsr(value.legCorridorTrackResourceOffsets, legCount, legResourceCount) ||
		!isUint32Array(value.legCorridorTrackResourceRows, legResourceCount) ||
		!isCsr(value.cycleCorridorTrackResourceOffsets, requestCount, cycleResourceCount) ||
		!isUint32Array(value.cycleCorridorTrackResourceRows, cycleResourceCount)
	) {
		return "resident cycle route columns are malformed";
	}
	const routes = value as unknown as SimulationResidentCycleRoutes;
	if (!hasIndependentOwnedBuffers(simulationResidentCycleRouteViews(routes))) {
		return "resident cycle route columns must own independent buffers";
	}
	const ordinals = new Set<number>();
	for (let row = 0; row < requestCount; row++) {
		const ordinal = routes.sourceOrdinals[row] as number;
		if (
			!isNonNegativeSafeInteger(ordinal) ||
			ordinals.has(ordinal) ||
			!isNonNegativeSafeInteger(routes.requestedAtMicroseconds[row]) ||
			routes.homeSlotIds[row] === 0 ||
			routes.homePortIds[row] === 0 ||
			routes.pickupPortIds[row] === 0 ||
			routes.dropoffPortIds[row] === 0 ||
			routes.homePortIds[row] === routes.pickupPortIds[row] ||
			routes.homePortIds[row] === routes.dropoffPortIds[row] ||
			routes.pickupPortIds[row] === routes.dropoffPortIds[row]
		) {
			return "resident cycle request identity is invalid";
		}
		ordinals.add(ordinal);
		const cycleStart = routes.cycleCorridorTrackResourceOffsets[row] as number;
		const cycleEnd = routes.cycleCorridorTrackResourceOffsets[row + 1] as number;
		if (
			cycleStart === cycleEnd ||
			!strictlyIncreasing(routes.cycleCorridorTrackResourceRows, cycleStart, cycleEnd)
		) {
			return "resident cycle resource union is empty or non-canonical";
		}
		if (!cycleUnionMatchesLegs(routes, row, cycleStart, cycleEnd)) {
			return "resident cycle resource union does not match its three legs";
		}
	}
	for (let legRow = 0; legRow < legCount; legRow++) {
		if (
			(routes.legPathOffsets[legRow + 1] as number) <= routes.legPathOffsets[legRow] ||
			(routes.legCorridorTrackResourceOffsets[legRow + 1] as number) <=
				routes.legCorridorTrackResourceOffsets[legRow] ||
			!Number.isFinite(routes.legDistancesMeters[legRow]) ||
			(routes.legDistancesMeters[legRow] as number) <= 0
		) {
			return "resident cycle leg is empty or has invalid distance";
		}
	}
	const views = simulationResidentCycleRouteViews(routes);
	const byteLength = sumByteLengths(views);
	if (
		!isNonNegativeSafeInteger(value.byteLength) ||
		value.byteLength !== byteLength ||
		byteLength > SIMULATION_RESIDENT_CYCLE_MAX_TYPED_BYTES
	) {
		return "resident cycle route typed-memory accounting is invalid";
	}
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationResidentCycleRoutes(routes) !== value.fingerprint
	) {
		return "resident cycle route fingerprint is invalid";
	}
	return null;
}

export async function simulationResidentCycleRoutesMatchSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	stationCapabilities: SimulationStationOperationalCapabilities,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
): Promise<boolean> {
	if (simulationResidentCycleRoutesError(routes)) return false;
	try {
		const rebuilt = await compileSimulationResidentCycleRoutes(
			foundation,
			trackResources,
			occupancyPolicy,
			stationCapabilities,
			manifest,
			parking,
		);
		return rebuilt.fingerprint === routes.fingerprint;
	} catch {
		return false;
	}
}

export function simulationResidentCycleRouteTransfers(
	routes: SimulationResidentCycleRoutes,
): readonly ArrayBuffer[] {
	const error = simulationResidentCycleRoutesError(routes);
	if (error) throw new Error(`Simulation resident cycle routes are invalid: ${error}`);
	return Object.freeze(
		simulationResidentCycleRouteViews(routes).map((view) => view.buffer as ArrayBuffer),
	);
}

function assertCompatibleSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	stationCapabilities: SimulationStationOperationalCapabilities,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
): void {
	for (const [label, error] of [
		["foundation", simulationStaticWorldFoundationError(foundation)],
		["track resources", simulationTrackResourceTopologyError(trackResources)],
		["occupancy policy", simulationTrackOccupancyPolicyError(occupancyPolicy)],
		["station capabilities", simulationStationOperationalCapabilitiesError(stationCapabilities)],
		["resident manifest", simulationResidentScenarioManifestError(manifest)],
		["resident parking", simulationResidentFleetParkingConfigurationError(parking)],
	] as const) {
		if (error) throw new Error(`Simulation resident ${label} is invalid: ${error}`);
	}
	if (
		trackResources.sourceFoundationFingerprint !== foundation.fingerprint ||
		occupancyPolicy.sourceFoundationFingerprint !== foundation.fingerprint ||
		occupancyPolicy.sourceTrackResourceTopologyFingerprint !== trackResources.fingerprint ||
		stationCapabilities.sourceFoundationFingerprint !== foundation.fingerprint
	) {
		throw new Error("Resident cycle route static inputs do not share one exact source.");
	}
	if (
		!simulationResidentFleetParkingConfigurationMatchesSources(
			foundation,
			trackResources,
			occupancyPolicy,
			parking,
		) ||
		!simulationResidentScenarioManifestMatchesParkingConfiguration(manifest, parking)
	) {
		throw new Error("Resident cycle route manifest and parking inputs do not match exact sources.");
	}
}

function assertTransferCapability(
	capabilities: SimulationStationOperationalCapabilities,
	stationRow: number,
	pickup: boolean,
	manifest: SimulationResidentScenarioManifest,
	record: ResidentRecord,
): void {
	const code = capabilities.transferCapabilityCodes[stationRow] as number;
	const allowed = pickup
		? code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.PICKUP_ONLY ||
			code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.BIDIRECTIONAL
		: code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.DROPOFF_ONLY ||
			code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.BIDIRECTIONAL;
	if (!allowed) {
		throw new Error(
			`Resident request ${residentRecordId(manifest, record)} uses a port without explicit ${pickup ? "pickup" : "dropoff"} capability.`,
		);
	}
}

function ownerHomeAppearsOnlyAtCycleBoundary(
	routes: readonly SimulationDirectedRouteCorridor[],
	ownerHomeFootprint: ReadonlySet<number>,
): boolean {
	const departure = routes[0]?.corridorTrackResourceRows ?? [];
	const transport = routes[1]?.corridorTrackResourceRows ?? [];
	const returning = routes[2]?.corridorTrackResourceRows ?? [];
	if (transport.some((row) => ownerHomeFootprint.has(row))) return false;
	let departurePrefix = 0;
	while (
		departurePrefix < departure.length &&
		ownerHomeFootprint.has(departure[departurePrefix] as number)
	) {
		departurePrefix++;
	}
	if (departurePrefix === 0 || containsAny(departure, ownerHomeFootprint, departurePrefix)) {
		return false;
	}
	let returnSuffix = returning.length;
	while (returnSuffix > 0 && ownerHomeFootprint.has(returning[returnSuffix - 1] as number)) {
		returnSuffix--;
	}
	return (
		returnSuffix < returning.length && !containsAny(returning, ownerHomeFootprint, 0, returnSuffix)
	);
}

function assertForeignHomeNonInterference(
	routes: readonly SimulationDirectedRouteCorridor[],
	homeFootprintBySlotRow: readonly ReadonlySet<number>[],
	ownerSlotRow: number,
	parking: SimulationResidentFleetParkingConfiguration,
	requestId: string,
): void {
	const cycleRows = new Set<number>();
	for (const route of routes) {
		for (const resourceRow of route.corridorTrackResourceRows) cycleRows.add(resourceRow);
	}
	for (let slotRow = 0; slotRow < homeFootprintBySlotRow.length; slotRow++) {
		if (slotRow === ownerSlotRow) continue;
		for (const resourceRow of homeFootprintBySlotRow[slotRow] as ReadonlySet<number>) {
			if (cycleRows.has(resourceRow)) {
				throw new Error(
					`Resident request ${requestId} intersects foreign home slot ${parking.slotIds[slotRow] as number}.`,
				);
			}
		}
	}
}

function uniqueSortedCycleRows(
	routes: readonly SimulationDirectedRouteCorridor[],
): readonly number[] {
	const rows = new Set<number>();
	for (const route of routes) {
		for (const resourceRow of route.corridorTrackResourceRows) rows.add(resourceRow);
	}
	return [...rows].sort((left, right) => left - right);
}

function containsAny(
	values: readonly number[],
	candidates: ReadonlySet<number>,
	start: number,
	end = values.length,
): boolean {
	for (let row = start; row < end; row++) {
		if (candidates.has(values[row] as number)) return true;
	}
	return false;
}

function cycleUnionMatchesLegs(
	routes: SimulationResidentCycleRoutes,
	requestRow: number,
	cycleStart: number,
	cycleEnd: number,
): boolean {
	const expected = new Set<number>();
	const firstLeg = requestRow * SIMULATION_RESIDENT_CYCLE_LEGS_PER_REQUEST;
	for (let leg = 0; leg < SIMULATION_RESIDENT_CYCLE_LEGS_PER_REQUEST; leg++) {
		const legRow = firstLeg + leg;
		const start = routes.legCorridorTrackResourceOffsets[legRow] as number;
		const end = routes.legCorridorTrackResourceOffsets[legRow + 1] as number;
		for (let row = start; row < end; row++) {
			expected.add(routes.legCorridorTrackResourceRows[row] as number);
		}
	}
	if (expected.size !== cycleEnd - cycleStart) return false;
	for (let row = cycleStart; row < cycleEnd; row++) {
		if (!expected.has(routes.cycleCorridorTrackResourceRows[row] as number)) return false;
	}
	return true;
}

type ResidentRecord = SimulationResidentTransferPlanRecord | SimulationResidentReplayHistoryRecord;

function residentRecordId(
	manifest: SimulationResidentScenarioManifest,
	record: ResidentRecord,
): string {
	return manifest.sourceKind === "TRANSFER_PLAN"
		? (record as SimulationResidentTransferPlanRecord).transferId
		: (record as SimulationResidentReplayHistoryRecord).historyEventId;
}

function residentRecordTime(
	manifest: SimulationResidentScenarioManifest,
	record: ResidentRecord,
): number {
	return manifest.sourceKind === "TRANSFER_PLAN"
		? (record as SimulationResidentTransferPlanRecord).releaseTimeMicroseconds
		: (record as SimulationResidentReplayHistoryRecord).observedTimeMicroseconds;
}

function csrValues(offsets: Uint32Array, values: Uint32Array, row: number): readonly number[] {
	return Array.from(values.subarray(offsets[row] as number, offsets[row + 1] as number));
}

function simulationResidentCycleRouteViews(
	routes: Omit<SimulationResidentCycleRoutes, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		routes.sourceOrdinals,
		routes.requestedAtMicroseconds,
		routes.homeSlotRows,
		routes.homeSlotIds,
		routes.homePortIds,
		routes.pickupPortIds,
		routes.dropoffPortIds,
		routes.legPathOffsets,
		routes.legPathRows,
		routes.legDistancesMeters,
		routes.legCorridorTrackResourceOffsets,
		routes.legCorridorTrackResourceRows,
		routes.cycleCorridorTrackResourceOffsets,
		routes.cycleCorridorTrackResourceRows,
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

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((total, view) => total + view.byteLength, 0);
}

function isCsr(value: unknown, domainCount: number, itemCount: number): value is Uint32Array {
	if (!(value instanceof Uint32Array) || value.length !== domainCount + 1 || value[0] !== 0) {
		return false;
	}
	for (let row = 1; row < value.length; row++) {
		if ((value[row] as number) < (value[row - 1] as number)) return false;
	}
	return value[domainCount] === itemCount;
}

function strictlyIncreasing(values: Uint32Array, start: number, end: number): boolean {
	for (let row = start + 1; row < end; row++) {
		if ((values[row] as number) <= (values[row - 1] as number)) return false;
	}
	return true;
}

function isFloat64Array(value: unknown, length: number): value is Float64Array {
	return value instanceof Float64Array && value.length === length;
}

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
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

const IMMEDIATE_SCHEDULER: SimulationScenarioRouteCompilationScheduler = Object.freeze({
	yield: () => Promise.resolve(),
});

function assertNotCancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new SimulationResidentCycleRouteCompilationCancelledError();
}
