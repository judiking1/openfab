import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type SimulationResidentCycleLeaseClaims,
	simulationResidentCycleLeaseClaimsError,
	simulationResidentCycleLeaseClaimsMatchSources,
} from "./SimulationResidentCycleLeaseClaims";
import {
	type SimulationResidentCycleRoutes,
	simulationResidentCycleRoutesError,
} from "./SimulationResidentCycleRoutes";
import {
	type SimulationResidentFleetParkingConfiguration,
	simulationResidentFleetParkingConfigurationError,
} from "./SimulationResidentFleetParkingConfiguration";
import {
	type SimulationResidentScenarioManifest,
	simulationResidentScenarioManifestError,
	simulationResidentScenarioManifestMatchesParkingConfiguration,
} from "./SimulationResidentScenarioManifest";
import {
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import type { SimulationTrackOccupancyPolicy } from "./SimulationTrackOccupancyPolicy";
import type { SimulationTrackResourceTopology } from "./SimulationTrackResourceTopology";

export const SIMULATION_RESIDENT_CYCLE_ADMISSION_PROGRAM_SCHEMA_VERSION = 1 as const;
export const SIMULATION_RESIDENT_LOAD_ORDERING_POLICY = "LOAD_ID_ASCENDING_V1" as const;
export const SIMULATION_RESIDENT_LOAD_CHAIN_POLICY =
	"PREVIOUS_DESTINATION_MUST_EQUAL_NEXT_SOURCE_V1" as const;
export const SIMULATION_RESIDENT_VEHICLE_ORDERING_POLICY =
	"PERSISTED_HOME_SLOT_ROW_ASCENDING_V1" as const;
export const SIMULATION_RESIDENT_VEHICLE_CHAIN_POLICY =
	"NEXT_ASSIGNED_REQUEST_WAITS_FOR_FULL_PREDECESSOR_HOME_RETURN_V1" as const;
export const SIMULATION_RESIDENT_CYCLE_ADMISSION_MAX_TYPED_BYTES = 32 * 1024 * 1024;
export const SIMULATION_RESIDENT_CYCLE_ADMISSION_MISSING_SAFETY_LAYERS = Object.freeze([
	"EXACT_SERVICE_TIMING",
	"EXACT_EQ_STORAGE_RUN_CONFIGURATION",
	"RESIDENT_READINESS_CERTIFICATE",
	"RESIDENT_RUN_AUTHORIZATION",
] as const);

const PROGRAM_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingSafetyLayers",
	"loadOrderingPolicy",
	"loadChainPolicy",
	"vehicleOrderingPolicy",
	"vehicleChainPolicy",
	"sourceKind",
	"sourceManifestFingerprint",
	"sourceRoutesFingerprint",
	"sourceLeaseClaimsFingerprint",
	"sourceParkingConfigurationFingerprint",
	"sourceFoundationFingerprint",
	"requestCount",
	"loadCount",
	"vehicleCount",
	"stationCount",
	"requestLoadRows",
	"loadPredecessorRequestRows",
	"loadSuccessorRequestRows",
	"initialCustodyStationRows",
	"requestVehicleRows",
	"vehiclePredecessorRequestRows",
	"vehicleSuccessorRequestRows",
	"vehicleHomeSlotIds",
	"fingerprint",
	"byteLength",
] as const);

export interface SimulationResidentCycleAdmissionProgram {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_CYCLE_ADMISSION_PROGRAM_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingSafetyLayers: typeof SIMULATION_RESIDENT_CYCLE_ADMISSION_MISSING_SAFETY_LAYERS;
	readonly loadOrderingPolicy: typeof SIMULATION_RESIDENT_LOAD_ORDERING_POLICY;
	readonly loadChainPolicy: typeof SIMULATION_RESIDENT_LOAD_CHAIN_POLICY;
	readonly vehicleOrderingPolicy: typeof SIMULATION_RESIDENT_VEHICLE_ORDERING_POLICY;
	readonly vehicleChainPolicy: typeof SIMULATION_RESIDENT_VEHICLE_CHAIN_POLICY;
	readonly sourceKind: SimulationResidentScenarioManifest["sourceKind"];
	readonly sourceManifestFingerprint: string;
	readonly sourceRoutesFingerprint: string;
	readonly sourceLeaseClaimsFingerprint: string;
	readonly sourceParkingConfigurationFingerprint: string;
	readonly sourceFoundationFingerprint: string;
	readonly requestCount: number;
	readonly loadCount: number;
	readonly vehicleCount: number;
	readonly stationCount: number;
	/** Load strings remain in the manifest; rows follow LOAD_ID_ASCENDING_V1. */
	readonly requestLoadRows: Uint32Array;
	readonly loadPredecessorRequestRows: Int32Array;
	readonly loadSuccessorRequestRows: Int32Array;
	readonly initialCustodyStationRows: Uint32Array;
	/** Vehicle strings remain in manifest/parking; rows follow canonical parking slot order. */
	readonly requestVehicleRows: Uint32Array;
	readonly vehiclePredecessorRequestRows: Int32Array;
	readonly vehicleSuccessorRequestRows: Int32Array;
	readonly vehicleHomeSlotIds: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

export function compileSimulationResidentCycleAdmissionProgram(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
): SimulationResidentCycleAdmissionProgram {
	assertCompatibleSources(
		foundation,
		trackResources,
		occupancyPolicy,
		manifest,
		parking,
		routes,
		leaseClaims,
	);
	const loadIds = [...new Set(manifest.records.map((record) => record.loadId))].sort(
		compareStrings,
	);
	assertTypedMemoryLimit(manifest.records.length, loadIds.length, parking.slotCount);
	const loadRowById = new Map(loadIds.map((loadId, row) => [loadId, row]));
	const stationRowByPortId = new Map<number, number>();
	for (let row = 0; row < foundation.stations.count; row++) {
		stationRowByPortId.set(foundation.stations.ids[row] as number, row);
	}
	const requestCount = routes.requestCount;
	const requestLoadRows = new Uint32Array(requestCount);
	const loadPredecessorRequestRows = new Int32Array(requestCount).fill(-1);
	const loadSuccessorRequestRows = new Int32Array(requestCount).fill(-1);
	const initialCustodyStationRows = new Uint32Array(loadIds.length);
	const requestVehicleRows = routes.homeSlotRows.slice();
	const vehiclePredecessorRequestRows = new Int32Array(requestCount).fill(-1);
	const vehicleSuccessorRequestRows = new Int32Array(requestCount).fill(-1);
	const vehicleHomeSlotIds = parking.slotIds.slice();
	const previousRequestByLoadRow = new Int32Array(loadIds.length).fill(-1);
	const previousRequestByVehicleRow = new Int32Array(parking.slotCount).fill(-1);

	for (let requestRow = 0; requestRow < requestCount; requestRow++) {
		const record = manifest.records[requestRow];
		if (!record) throw new Error(`Resident request row ${requestRow} has no manifest record.`);
		const loadRow = loadRowById.get(record.loadId);
		if (loadRow === undefined) {
			throw new Error(`Resident load ${record.loadId} has no canonical row.`);
		}
		requestLoadRows[requestRow] = loadRow;
		const previousLoadRequest = previousRequestByLoadRow[loadRow] as number;
		if (previousLoadRequest < 0) {
			const stationRow = stationRowByPortId.get(record.sourcePortId);
			if (stationRow === undefined) {
				throw new Error(`Resident load ${record.loadId} starts at a foreign pickup port.`);
			}
			initialCustodyStationRows[loadRow] = stationRow;
		} else {
			if (manifest.records[previousLoadRequest]?.destinationPortId !== record.sourcePortId) {
				throw new Error(
					`Resident load ${record.loadId} does not continue from its previous destination port.`,
				);
			}
			loadPredecessorRequestRows[requestRow] = previousLoadRequest;
			loadSuccessorRequestRows[previousLoadRequest] = requestRow;
		}
		previousRequestByLoadRow[loadRow] = requestRow;

		const vehicleRow = requestVehicleRows[requestRow] as number;
		if (vehicleRow >= parking.slotCount || parking.vehicleIds[vehicleRow] !== record.vehicleId) {
			throw new Error(`Resident request row ${requestRow} vehicle does not match its home slot.`);
		}
		const previousVehicleRequest = previousRequestByVehicleRow[vehicleRow] as number;
		if (previousVehicleRequest >= 0) {
			vehiclePredecessorRequestRows[requestRow] = previousVehicleRequest;
			vehicleSuccessorRequestRows[previousVehicleRequest] = requestRow;
		}
		previousRequestByVehicleRow[vehicleRow] = requestRow;
	}

	const programWithoutIdentity = {
		schemaVersion: SIMULATION_RESIDENT_CYCLE_ADMISSION_PROGRAM_SCHEMA_VERSION,
		simulationRunnable: false,
		missingSafetyLayers: SIMULATION_RESIDENT_CYCLE_ADMISSION_MISSING_SAFETY_LAYERS,
		loadOrderingPolicy: SIMULATION_RESIDENT_LOAD_ORDERING_POLICY,
		loadChainPolicy: SIMULATION_RESIDENT_LOAD_CHAIN_POLICY,
		vehicleOrderingPolicy: SIMULATION_RESIDENT_VEHICLE_ORDERING_POLICY,
		vehicleChainPolicy: SIMULATION_RESIDENT_VEHICLE_CHAIN_POLICY,
		sourceKind: manifest.sourceKind,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceRoutesFingerprint: routes.fingerprint,
		sourceLeaseClaimsFingerprint: leaseClaims.fingerprint,
		sourceParkingConfigurationFingerprint: parking.fingerprint,
		sourceFoundationFingerprint: foundation.fingerprint,
		requestCount,
		loadCount: loadIds.length,
		vehicleCount: parking.slotCount,
		stationCount: foundation.stations.count,
		requestLoadRows,
		loadPredecessorRequestRows,
		loadSuccessorRequestRows,
		initialCustodyStationRows,
		requestVehicleRows,
		vehiclePredecessorRequestRows,
		vehicleSuccessorRequestRows,
		vehicleHomeSlotIds,
	} as const;
	const views = simulationResidentCycleAdmissionProgramViews(programWithoutIdentity);
	const program = Object.freeze({
		...programWithoutIdentity,
		fingerprint: checksumSimulationResidentCycleAdmissionProgram(programWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationResidentCycleAdmissionProgram;
	const error = simulationResidentCycleAdmissionProgramError(program);
	if (error) throw new Error(`Compiled resident cycle admission program is invalid: ${error}`);
	return program;
}

export function checksumSimulationResidentCycleAdmissionProgram(
	program: Omit<SimulationResidentCycleAdmissionProgram, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		program.schemaVersion,
		program.simulationRunnable ? 1 : 0,
		program.requestCount,
		program.loadCount,
		program.vehicleCount,
		program.stationCount,
	]);
	checksum.addStrings([
		...program.missingSafetyLayers,
		program.loadOrderingPolicy,
		program.loadChainPolicy,
		program.vehicleOrderingPolicy,
		program.vehicleChainPolicy,
		program.sourceKind,
		program.sourceManifestFingerprint,
		program.sourceRoutesFingerprint,
		program.sourceLeaseClaimsFingerprint,
		program.sourceParkingConfigurationFingerprint,
		program.sourceFoundationFingerprint,
	]);
	checksum.addViews(simulationResidentCycleAdmissionProgramViews(program));
	return checksum.digest();
}

export function simulationResidentCycleAdmissionProgramError(value: unknown): string | null {
	if (!isRecord(value)) return "resident cycle admission program must be an object";
	if (!hasExactKeys(value, PROGRAM_KEYS)) {
		return "resident cycle admission program contains missing or unexpected fields";
	}
	if (
		value.schemaVersion !== SIMULATION_RESIDENT_CYCLE_ADMISSION_PROGRAM_SCHEMA_VERSION ||
		value.simulationRunnable !== false ||
		!sameStrings(
			value.missingSafetyLayers,
			SIMULATION_RESIDENT_CYCLE_ADMISSION_MISSING_SAFETY_LAYERS,
		) ||
		value.loadOrderingPolicy !== SIMULATION_RESIDENT_LOAD_ORDERING_POLICY ||
		value.loadChainPolicy !== SIMULATION_RESIDENT_LOAD_CHAIN_POLICY ||
		value.vehicleOrderingPolicy !== SIMULATION_RESIDENT_VEHICLE_ORDERING_POLICY ||
		value.vehicleChainPolicy !== SIMULATION_RESIDENT_VEHICLE_CHAIN_POLICY
	) {
		return "resident cycle admission policy is invalid";
	}
	if (
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY") ||
		!isNonEmptyString(value.sourceManifestFingerprint) ||
		!isNonEmptyString(value.sourceRoutesFingerprint) ||
		!isNonEmptyString(value.sourceLeaseClaimsFingerprint) ||
		!isNonEmptyString(value.sourceParkingConfigurationFingerprint) ||
		!isNonEmptyString(value.sourceFoundationFingerprint) ||
		!isNonNegativeSafeInteger(value.requestCount) ||
		!isNonNegativeSafeInteger(value.loadCount) ||
		!isNonNegativeSafeInteger(value.vehicleCount) ||
		!isNonNegativeSafeInteger(value.stationCount) ||
		(value.loadCount as number) > (value.requestCount as number)
	) {
		return "resident cycle admission source identity or counts are invalid";
	}
	const requestCount = value.requestCount as number;
	const loadCount = value.loadCount as number;
	const vehicleCount = value.vehicleCount as number;
	if (
		!isUint32Array(value.requestLoadRows, requestCount) ||
		!isInt32Array(value.loadPredecessorRequestRows, requestCount) ||
		!isInt32Array(value.loadSuccessorRequestRows, requestCount) ||
		!isUint32Array(value.initialCustodyStationRows, loadCount) ||
		!isUint32Array(value.requestVehicleRows, requestCount) ||
		!isInt32Array(value.vehiclePredecessorRequestRows, requestCount) ||
		!isInt32Array(value.vehicleSuccessorRequestRows, requestCount) ||
		!isUint32Array(value.vehicleHomeSlotIds, vehicleCount)
	) {
		return "resident cycle admission columns are malformed";
	}
	const program = value as unknown as SimulationResidentCycleAdmissionProgram;
	if (
		!validChains(
			program.requestLoadRows,
			program.loadPredecessorRequestRows,
			program.loadSuccessorRequestRows,
			program.loadCount,
			true,
		) ||
		!validChains(
			program.requestVehicleRows,
			program.vehiclePredecessorRequestRows,
			program.vehicleSuccessorRequestRows,
			program.vehicleCount,
			false,
		) ||
		!rowsWithin(program.initialCustodyStationRows, program.stationCount) ||
		!strictlyIncreasingPositive(program.vehicleHomeSlotIds)
	) {
		return "resident load custody or vehicle chains are invalid";
	}
	const views = simulationResidentCycleAdmissionProgramViews(program);
	if (!hasIndependentOwnedBuffers(views)) {
		return "resident cycle admission columns must own independent buffers";
	}
	const byteLength = sumByteLengths(views);
	if (
		!isNonNegativeSafeInteger(value.byteLength) ||
		value.byteLength !== byteLength ||
		byteLength > SIMULATION_RESIDENT_CYCLE_ADMISSION_MAX_TYPED_BYTES
	) {
		return "resident cycle admission typed-memory accounting is invalid";
	}
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationResidentCycleAdmissionProgram(program) !== value.fingerprint
	) {
		return "resident cycle admission fingerprint is invalid";
	}
	return null;
}

export function simulationResidentCycleAdmissionProgramMatchesSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
	program: SimulationResidentCycleAdmissionProgram,
): boolean {
	if (simulationResidentCycleAdmissionProgramError(program)) return false;
	try {
		const rebuilt = compileSimulationResidentCycleAdmissionProgram(
			foundation,
			trackResources,
			occupancyPolicy,
			manifest,
			parking,
			routes,
			leaseClaims,
		);
		return rebuilt.fingerprint === program.fingerprint;
	} catch {
		return false;
	}
}

/** Checks exact semantic row binding after every supplied artifact passed its own validator. */
export function simulationResidentCycleAdmissionProgramMatchesValidatedSources(
	foundation: SimulationStaticWorldFoundation,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
	program: SimulationResidentCycleAdmissionProgram,
): boolean {
	if (
		program.sourceKind !== manifest.sourceKind ||
		program.sourceManifestFingerprint !== manifest.fingerprint ||
		program.sourceRoutesFingerprint !== routes.fingerprint ||
		program.sourceLeaseClaimsFingerprint !== leaseClaims.fingerprint ||
		program.sourceParkingConfigurationFingerprint !== parking.fingerprint ||
		program.sourceFoundationFingerprint !== foundation.fingerprint ||
		program.requestCount !== routes.requestCount ||
		program.vehicleCount !== parking.slotCount ||
		program.stationCount !== foundation.stations.count ||
		!sameNumbers(program.vehicleHomeSlotIds, parking.slotIds)
	) {
		return false;
	}
	const loadIds = [...new Set(manifest.records.map((record) => record.loadId))].sort(
		compareStrings,
	);
	if (program.loadCount !== loadIds.length) return false;
	const loadRowById = new Map(loadIds.map((loadId, row) => [loadId, row]));
	const stationRowByPortId = new Map<number, number>();
	for (let row = 0; row < foundation.stations.count; row++) {
		stationRowByPortId.set(foundation.stations.ids[row] as number, row);
	}
	const previousRequestByLoadRow = new Int32Array(loadIds.length).fill(-1);
	const previousRequestByVehicleRow = new Int32Array(parking.slotCount).fill(-1);
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const record = manifest.records[requestRow];
		if (!record) return false;
		const loadRow = loadRowById.get(record.loadId);
		const vehicleRow = routes.homeSlotRows[requestRow] as number;
		if (
			loadRow === undefined ||
			program.requestLoadRows[requestRow] !== loadRow ||
			program.requestVehicleRows[requestRow] !== vehicleRow ||
			vehicleRow >= parking.slotCount ||
			parking.vehicleIds[vehicleRow] !== record.vehicleId
		) {
			return false;
		}
		const previousLoadRequest = previousRequestByLoadRow[loadRow] as number;
		if (program.loadPredecessorRequestRows[requestRow] !== previousLoadRequest) return false;
		if (previousLoadRequest < 0) {
			if (
				program.initialCustodyStationRows[loadRow] !== stationRowByPortId.get(record.sourcePortId)
			) {
				return false;
			}
		} else if (
			manifest.records[previousLoadRequest]?.destinationPortId !== record.sourcePortId ||
			program.loadSuccessorRequestRows[previousLoadRequest] !== requestRow
		) {
			return false;
		}
		previousRequestByLoadRow[loadRow] = requestRow;

		const previousVehicleRequest = previousRequestByVehicleRow[vehicleRow] as number;
		if (program.vehiclePredecessorRequestRows[requestRow] !== previousVehicleRequest) return false;
		if (
			previousVehicleRequest >= 0 &&
			program.vehicleSuccessorRequestRows[previousVehicleRequest] !== requestRow
		) {
			return false;
		}
		previousRequestByVehicleRow[vehicleRow] = requestRow;
	}
	for (const lastRequest of previousRequestByLoadRow) {
		if (lastRequest >= 0 && program.loadSuccessorRequestRows[lastRequest] !== -1) return false;
	}
	for (const lastRequest of previousRequestByVehicleRow) {
		if (lastRequest >= 0 && program.vehicleSuccessorRequestRows[lastRequest] !== -1) return false;
	}
	return true;
}

export function simulationResidentCycleAdmissionProgramTransfers(
	program: SimulationResidentCycleAdmissionProgram,
): readonly ArrayBuffer[] {
	const error = simulationResidentCycleAdmissionProgramError(program);
	if (error) throw new Error(`Simulation resident cycle admission program is invalid: ${error}`);
	return Object.freeze(
		simulationResidentCycleAdmissionProgramViews(program).map((view) => view.buffer as ArrayBuffer),
	);
}

function assertCompatibleSources(
	foundation: SimulationStaticWorldFoundation,
	trackResources: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	manifest: SimulationResidentScenarioManifest,
	parking: SimulationResidentFleetParkingConfiguration,
	routes: SimulationResidentCycleRoutes,
	leaseClaims: SimulationResidentCycleLeaseClaims,
): void {
	for (const [label, error] of [
		["foundation", simulationStaticWorldFoundationError(foundation)],
		["manifest", simulationResidentScenarioManifestError(manifest)],
		["parking", simulationResidentFleetParkingConfigurationError(parking)],
		["routes", simulationResidentCycleRoutesError(routes)],
		["lease claims", simulationResidentCycleLeaseClaimsError(leaseClaims)],
	] as const) {
		if (error) throw new Error(`Simulation resident admission ${label} is invalid: ${error}`);
	}
	if (
		!simulationResidentScenarioManifestMatchesParkingConfiguration(manifest, parking) ||
		routes.sourceManifestFingerprint !== manifest.fingerprint ||
		routes.sourceParkingConfigurationFingerprint !== parking.fingerprint ||
		routes.sourceFoundationFingerprint !== foundation.fingerprint ||
		routes.requestCount !== manifest.records.length ||
		leaseClaims.sourceRoutesFingerprint !== routes.fingerprint ||
		leaseClaims.sourceParkingConfigurationFingerprint !== parking.fingerprint ||
		!simulationResidentCycleLeaseClaimsMatchSources(
			foundation,
			trackResources,
			occupancyPolicy,
			parking,
			routes,
			leaseClaims,
		)
	) {
		throw new Error("Resident cycle admission inputs do not share one exact source chain.");
	}
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const record = manifest.records[requestRow];
		if (
			!record ||
			routes.sourceOrdinals[requestRow] !== record.sourceOrdinal ||
			routes.pickupPortIds[requestRow] !== record.sourcePortId ||
			routes.dropoffPortIds[requestRow] !== record.destinationPortId
		) {
			throw new Error("Resident cycle admission routes do not align with manifest records.");
		}
	}
}

function validChains(
	requestOwnerRows: Uint32Array,
	predecessorRows: Int32Array,
	successorRows: Int32Array,
	ownerCount: number,
	requireEveryOwner: boolean,
): boolean {
	const ownerHasFirst = new Uint8Array(ownerCount);
	for (let requestRow = 0; requestRow < requestOwnerRows.length; requestRow++) {
		const ownerRow = requestOwnerRows[requestRow] as number;
		const predecessor = predecessorRows[requestRow] as number;
		const successor = successorRows[requestRow] as number;
		if (
			ownerRow >= ownerCount ||
			predecessor >= requestRow ||
			predecessor < -1 ||
			(successor !== -1 && (successor <= requestRow || successor >= requestOwnerRows.length))
		) {
			return false;
		}
		if (predecessor === -1) {
			if (ownerHasFirst[ownerRow] !== 0) return false;
			ownerHasFirst[ownerRow] = 1;
		} else if (
			requestOwnerRows[predecessor] !== ownerRow ||
			successorRows[predecessor] !== requestRow
		) {
			return false;
		}
		if (
			successor !== -1 &&
			(requestOwnerRows[successor] !== ownerRow || predecessorRows[successor] !== requestRow)
		) {
			return false;
		}
	}
	return !requireEveryOwner || ownerHasFirst.every((present) => present === 1);
}

function simulationResidentCycleAdmissionProgramViews(
	program: Omit<SimulationResidentCycleAdmissionProgram, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		program.requestLoadRows,
		program.loadPredecessorRequestRows,
		program.loadSuccessorRequestRows,
		program.initialCustodyStationRows,
		program.requestVehicleRows,
		program.vehiclePredecessorRequestRows,
		program.vehicleSuccessorRequestRows,
		program.vehicleHomeSlotIds,
	];
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sameNumbers(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
	if (left.length !== right.length) return false;
	for (let row = 0; row < left.length; row++) {
		if (left[row] !== right[row]) return false;
	}
	return true;
}

function rowsWithin(rows: Uint32Array, rowCount: number): boolean {
	for (const row of rows) if (row >= rowCount) return false;
	return true;
}

function strictlyIncreasingPositive(values: Uint32Array): boolean {
	for (let row = 0; row < values.length; row++) {
		if (values[row] === 0 || (row > 0 && (values[row] as number) <= (values[row - 1] as number))) {
			return false;
		}
	}
	return true;
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

function assertTypedMemoryLimit(
	requestCount: number,
	loadCount: number,
	vehicleCount: number,
): void {
	const bytes = Uint32Array.BYTES_PER_ELEMENT * (requestCount * 6 + loadCount + vehicleCount);
	if (!Number.isSafeInteger(bytes) || bytes > SIMULATION_RESIDENT_CYCLE_ADMISSION_MAX_TYPED_BYTES) {
		throw new Error("Resident cycle admission program exceeds its typed-memory limit.");
	}
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isInt32Array(value: unknown, length: number): value is Int32Array {
	return value instanceof Int32Array && value.length === length;
}
