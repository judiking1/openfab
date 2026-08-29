import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "./SimulationReadinessCertificate";
import {
	type SimulationScenarioLeaseClaims,
	simulationScenarioLeaseClaimsError,
	simulationScenarioLeaseClaimsMatchValidatedSources,
} from "./SimulationScenarioLeaseClaims";
import {
	type SimulationScenarioManifest,
	simulationScenarioManifestError,
} from "./SimulationScenarioManifest";
import {
	type SimulationScenarioRouteRequests,
	simulationScenarioRouteRequestsError,
	simulationScenarioRouteRequestsMatchValidatedSources,
} from "./SimulationScenarioRouteRequests";

export const SIMULATION_SCENARIO_ADMISSION_PROGRAM_SCHEMA_VERSION = 1 as const;
export const SIMULATION_SCENARIO_LOAD_ORDERING_POLICY = "LOAD_ID_ASCENDING_V1" as const;
export const SIMULATION_SCENARIO_LOAD_CHAIN_POLICY =
	"PREVIOUS_DESTINATION_MUST_EQUAL_NEXT_SOURCE_V1" as const;
export const SIMULATION_SCENARIO_VEHICLE_TOKEN_POLICY =
	"UNLAUNCHED_ONE_TOKEN_PER_REQUEST_AFTER_ATOMIC_LEASE_V1" as const;
export const SIMULATION_SCENARIO_ADMISSION_MISSING_RUNTIME_LAYERS = Object.freeze([
	"MOTION_TIMELINE",
	"TERMINAL_EVENT_EXECUTION",
	"SPEED_INVARIANCE_PROOF",
] as const);

const PROGRAM_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingRuntimeLayers",
	"loadOrderingPolicy",
	"loadChainPolicy",
	"vehicleTokenPolicy",
	"sourceKind",
	"sourceManifestFingerprint",
	"sourceRouteRequestsFingerprint",
	"sourceLeaseClaimsFingerprint",
	"sourceCertificateFingerprint",
	"runIdentityFingerprint",
	"requestCount",
	"loadCount",
	"stationCount",
	"requestVehicleTokenIds",
	"requestLoadRows",
	"predecessorRequestRows",
	"successorRequestRows",
	"initialCustodyStationRows",
	"fingerprint",
	"byteLength",
] as const);

export interface SimulationScenarioAdmissionProgram {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_ADMISSION_PROGRAM_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingRuntimeLayers: typeof SIMULATION_SCENARIO_ADMISSION_MISSING_RUNTIME_LAYERS;
	readonly loadOrderingPolicy: typeof SIMULATION_SCENARIO_LOAD_ORDERING_POLICY;
	readonly loadChainPolicy: typeof SIMULATION_SCENARIO_LOAD_CHAIN_POLICY;
	readonly vehicleTokenPolicy: typeof SIMULATION_SCENARIO_VEHICLE_TOKEN_POLICY;
	readonly sourceKind: SimulationScenarioManifest["sourceKind"];
	readonly sourceManifestFingerprint: string;
	readonly sourceRouteRequestsFingerprint: string;
	readonly sourceLeaseClaimsFingerprint: string;
	readonly sourceCertificateFingerprint: string;
	readonly runIdentityFingerprint: string;
	readonly requestCount: number;
	readonly loadCount: number;
	readonly stationCount: number;
	/** Stable run-local identities; zero remains the inactive-token sentinel in mutable state. */
	readonly requestVehicleTokenIds: Uint32Array;
	/** Load strings remain in the manifest; rows follow LOAD_ID_ASCENDING_V1. */
	readonly requestLoadRows: Uint32Array;
	/** Minus one marks the first transfer in one load's custody chain. */
	readonly predecessorRequestRows: Int32Array;
	/** Minus one marks the last transfer in one load's custody chain. */
	readonly successorRequestRows: Int32Array;
	readonly initialCustodyStationRows: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

export function compileSimulationScenarioAdmissionProgram(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
): SimulationScenarioAdmissionProgram {
	assertCompatibleSources(snapshot, manifest, routes, leaseClaims);
	const loadIds = [...new Set(manifest.records.map((record) => record.loadId))].sort(
		compareStrings,
	);
	const loadRowById = new Map(loadIds.map((loadId, loadRow) => [loadId, loadRow]));
	const requestVehicleTokenIds = new Uint32Array(routes.requestCount);
	const requestLoadRows = new Uint32Array(routes.requestCount);
	const predecessorRequestRows = new Int32Array(routes.requestCount).fill(-1);
	const successorRequestRows = new Int32Array(routes.requestCount).fill(-1);
	const initialCustodyStationRows = new Uint32Array(loadIds.length);
	const previousRequestByLoadRow = new Int32Array(loadIds.length).fill(-1);
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const record = manifest.records[requestRow];
		if (!record)
			throw new Error(`Scenario request row ${requestRow} is missing its manifest record.`);
		const loadRow = loadRowById.get(record.loadId);
		if (loadRow === undefined)
			throw new Error(`Scenario load ${record.loadId} has no canonical row.`);
		requestVehicleTokenIds[requestRow] = requestRow + 1;
		requestLoadRows[requestRow] = loadRow;
		const predecessor = previousRequestByLoadRow[loadRow] as number;
		if (predecessor < 0) {
			initialCustodyStationRows[loadRow] = routes.sourceStationRows[requestRow] as number;
		} else {
			if (routes.destinationPortIds[predecessor] !== routes.sourcePortIds[requestRow]) {
				throw new Error(
					`Scenario load ${record.loadId} does not continue from its previous destination port.`,
				);
			}
			predecessorRequestRows[requestRow] = predecessor;
			successorRequestRows[predecessor] = requestRow;
		}
		previousRequestByLoadRow[loadRow] = requestRow;
	}
	const programWithoutIdentity = {
		schemaVersion: SIMULATION_SCENARIO_ADMISSION_PROGRAM_SCHEMA_VERSION,
		simulationRunnable: false,
		missingRuntimeLayers: SIMULATION_SCENARIO_ADMISSION_MISSING_RUNTIME_LAYERS,
		loadOrderingPolicy: SIMULATION_SCENARIO_LOAD_ORDERING_POLICY,
		loadChainPolicy: SIMULATION_SCENARIO_LOAD_CHAIN_POLICY,
		vehicleTokenPolicy: SIMULATION_SCENARIO_VEHICLE_TOKEN_POLICY,
		sourceKind: manifest.sourceKind,
		sourceManifestFingerprint: manifest.fingerprint,
		sourceRouteRequestsFingerprint: routes.fingerprint,
		sourceLeaseClaimsFingerprint: leaseClaims.fingerprint,
		sourceCertificateFingerprint: snapshot.certificate.fingerprint,
		runIdentityFingerprint: routes.runIdentityFingerprint,
		requestCount: routes.requestCount,
		loadCount: loadIds.length,
		stationCount: snapshot.foundation.stations.count,
		requestVehicleTokenIds,
		requestLoadRows,
		predecessorRequestRows,
		successorRequestRows,
		initialCustodyStationRows,
	} as const;
	const views = simulationScenarioAdmissionProgramViews(programWithoutIdentity);
	const program = Object.freeze({
		...programWithoutIdentity,
		fingerprint: checksumSimulationScenarioAdmissionProgram(programWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationScenarioAdmissionProgram;
	const error = simulationScenarioAdmissionProgramError(program);
	if (error) throw new Error(`Compiled scenario admission program is invalid: ${error}`);
	return program;
}

export function checksumSimulationScenarioAdmissionProgram(
	program: Omit<SimulationScenarioAdmissionProgram, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		program.schemaVersion,
		program.simulationRunnable ? 1 : 0,
		program.requestCount,
		program.loadCount,
		program.stationCount,
	]);
	checksum.addStrings([
		...program.missingRuntimeLayers,
		program.loadOrderingPolicy,
		program.loadChainPolicy,
		program.vehicleTokenPolicy,
		program.sourceKind,
		program.sourceManifestFingerprint,
		program.sourceRouteRequestsFingerprint,
		program.sourceLeaseClaimsFingerprint,
		program.sourceCertificateFingerprint,
		program.runIdentityFingerprint,
	]);
	checksum.addViews(simulationScenarioAdmissionProgramViews(program));
	return checksum.digest();
}

export function simulationScenarioAdmissionProgramError(value: unknown): string | null {
	if (!isRecord(value)) return "scenario admission program must be an object";
	if (!hasExactKeys(value, PROGRAM_KEYS)) {
		return "scenario admission program contains missing or unexpected fields";
	}
	if (value.schemaVersion !== SIMULATION_SCENARIO_ADMISSION_PROGRAM_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationRunnable !== false) return "admission program cannot authorize a run";
	if (
		!Array.isArray(value.missingRuntimeLayers) ||
		value.missingRuntimeLayers.join("|") !==
			SIMULATION_SCENARIO_ADMISSION_MISSING_RUNTIME_LAYERS.join("|")
	) {
		return "missing runtime layers are invalid";
	}
	if (
		value.loadOrderingPolicy !== SIMULATION_SCENARIO_LOAD_ORDERING_POLICY ||
		value.loadChainPolicy !== SIMULATION_SCENARIO_LOAD_CHAIN_POLICY ||
		value.vehicleTokenPolicy !== SIMULATION_SCENARIO_VEHICLE_TOKEN_POLICY ||
		(value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY") ||
		!isNonEmptyString(value.sourceManifestFingerprint) ||
		!isNonEmptyString(value.sourceRouteRequestsFingerprint) ||
		!isNonEmptyString(value.sourceLeaseClaimsFingerprint) ||
		!isNonEmptyString(value.sourceCertificateFingerprint) ||
		!isNonEmptyString(value.runIdentityFingerprint) ||
		!isNonNegativeSafeInteger(value.requestCount) ||
		!isNonNegativeSafeInteger(value.loadCount) ||
		!isNonNegativeSafeInteger(value.stationCount) ||
		(value.loadCount as number) > (value.requestCount as number)
	) {
		return "admission source identity or counts are invalid";
	}
	const requestCount = value.requestCount as number;
	const loadCount = value.loadCount as number;
	if (
		!isUint32Array(value.requestVehicleTokenIds, requestCount) ||
		!isUint32Array(value.requestLoadRows, requestCount) ||
		!isInt32Array(value.predecessorRequestRows, requestCount) ||
		!isInt32Array(value.successorRequestRows, requestCount) ||
		!isUint32Array(value.initialCustodyStationRows, loadCount)
	) {
		return "admission program columns are malformed";
	}
	const program = value as unknown as SimulationScenarioAdmissionProgram;
	if (
		!validRequestChains(program) ||
		!rowsWithin(program.initialCustodyStationRows, program.stationCount)
	) {
		return "vehicle token or load custody chains are invalid";
	}
	const views = simulationScenarioAdmissionProgramViews(program);
	if (!hasIndependentOwnedBuffers(views)) {
		return "admission program columns are not independently transferable";
	}
	const byteLength = sumByteLengths(views);
	if (value.byteLength !== byteLength) return "admission program byte length is invalid";
	if (
		!isNonEmptyString(value.fingerprint) ||
		checksumSimulationScenarioAdmissionProgram(program) !== value.fingerprint
	) {
		return "admission program fingerprint is invalid";
	}
	return null;
}

export function simulationScenarioAdmissionProgramMatchesSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	program: SimulationScenarioAdmissionProgram,
): boolean {
	if (
		publishedSimulationReadinessSnapshotError(snapshot) !== null ||
		simulationScenarioManifestError(manifest) !== null ||
		simulationScenarioRouteRequestsError(routes) !== null ||
		simulationScenarioLeaseClaimsError(leaseClaims) !== null ||
		simulationScenarioAdmissionProgramError(program) !== null ||
		!simulationScenarioRouteRequestsMatchValidatedSources(snapshot, manifest, routes) ||
		!simulationScenarioLeaseClaimsMatchValidatedSources(snapshot, routes, leaseClaims) ||
		!simulationScenarioAdmissionProgramMatchesValidatedSources(
			snapshot,
			manifest,
			routes,
			leaseClaims,
			program,
		)
	) {
		return false;
	}
	return true;
}

/** Checks exact source binding after each supplied artifact has passed its own error validator. */
export function simulationScenarioAdmissionProgramMatchesValidatedSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
	program: SimulationScenarioAdmissionProgram,
): boolean {
	if (
		program.sourceKind !== manifest.sourceKind ||
		program.sourceManifestFingerprint !== manifest.fingerprint ||
		program.sourceRouteRequestsFingerprint !== routes.fingerprint ||
		program.sourceLeaseClaimsFingerprint !== leaseClaims.fingerprint ||
		program.sourceCertificateFingerprint !== snapshot.certificate.fingerprint ||
		program.runIdentityFingerprint !== routes.runIdentityFingerprint ||
		program.requestCount !== routes.requestCount ||
		program.stationCount !== snapshot.foundation.stations.count
	) {
		return false;
	}
	const loadIds = [...new Set(manifest.records.map((record) => record.loadId))].sort(
		compareStrings,
	);
	if (program.loadCount !== loadIds.length) return false;
	const loadRows = new Map(loadIds.map((loadId, row) => [loadId, row]));
	const previousByLoadRow = new Int32Array(loadIds.length).fill(-1);
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const record = manifest.records[requestRow];
		if (!record) return false;
		const loadRow = loadRows.get(record.loadId);
		if (loadRow === undefined || program.requestLoadRows[requestRow] !== loadRow) return false;
		const predecessor = previousByLoadRow[loadRow] as number;
		if (
			program.requestVehicleTokenIds[requestRow] !== requestRow + 1 ||
			program.predecessorRequestRows[requestRow] !== predecessor ||
			(predecessor >= 0 &&
				routes.destinationPortIds[predecessor] !== routes.sourcePortIds[requestRow]) ||
			(predecessor < 0
				? program.initialCustodyStationRows[loadRow] !== routes.sourceStationRows[requestRow]
				: program.successorRequestRows[predecessor] !== requestRow)
		) {
			return false;
		}
		previousByLoadRow[loadRow] = requestRow;
	}
	return true;
}

export function simulationScenarioAdmissionProgramTransfers(
	program: SimulationScenarioAdmissionProgram,
): readonly ArrayBuffer[] {
	const error = simulationScenarioAdmissionProgramError(program);
	if (error) throw new Error(`Simulation scenario admission program is invalid: ${error}`);
	return simulationScenarioAdmissionProgramViews(program).map((view) => view.buffer as ArrayBuffer);
}

function assertCompatibleSources(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	routes: SimulationScenarioRouteRequests,
	leaseClaims: SimulationScenarioLeaseClaims,
): void {
	const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
	if (snapshotError) throw new Error(`Published readiness snapshot is invalid: ${snapshotError}`);
	const manifestError = simulationScenarioManifestError(manifest);
	if (manifestError) throw new Error(`Simulation scenario manifest is invalid: ${manifestError}`);
	if (
		simulationScenarioRouteRequestsError(routes) !== null ||
		!simulationScenarioRouteRequestsMatchValidatedSources(snapshot, manifest, routes)
	) {
		throw new Error("Scenario routes do not belong to the supplied manifest and certificate.");
	}
	if (
		simulationScenarioLeaseClaimsError(leaseClaims) !== null ||
		!simulationScenarioLeaseClaimsMatchValidatedSources(snapshot, routes, leaseClaims)
	) {
		throw new Error("Scenario lease claims do not belong to the supplied routes and certificate.");
	}
}

function validRequestChains(program: SimulationScenarioAdmissionProgram): boolean {
	const loadHasFirstRequest = new Uint8Array(program.loadCount);
	for (let requestRow = 0; requestRow < program.requestCount; requestRow++) {
		const loadRow = program.requestLoadRows[requestRow] as number;
		const predecessor = program.predecessorRequestRows[requestRow] as number;
		const successor = program.successorRequestRows[requestRow] as number;
		if (
			program.requestVehicleTokenIds[requestRow] !== requestRow + 1 ||
			loadRow >= program.loadCount ||
			predecessor >= requestRow ||
			predecessor < -1
		) {
			return false;
		}
		if (successor !== -1 && (successor <= requestRow || successor >= program.requestCount)) {
			return false;
		}
		if (predecessor === -1) {
			if (loadHasFirstRequest[loadRow] !== 0) return false;
			loadHasFirstRequest[loadRow] = 1;
		} else if (
			program.requestLoadRows[predecessor] !== loadRow ||
			program.successorRequestRows[predecessor] !== requestRow
		) {
			return false;
		}
		if (successor !== -1) {
			if (
				program.requestLoadRows[successor] !== loadRow ||
				program.predecessorRequestRows[successor] !== requestRow
			) {
				return false;
			}
		}
	}
	for (const present of loadHasFirstRequest) if (present !== 1) return false;
	return true;
}

function simulationScenarioAdmissionProgramViews(
	program: Omit<SimulationScenarioAdmissionProgram, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		program.requestVehicleTokenIds,
		program.requestLoadRows,
		program.predecessorRequestRows,
		program.successorRequestRows,
		program.initialCustodyStationRows,
	];
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function rowsWithin(rows: Uint32Array, rowCount: number): boolean {
	for (const row of rows) if (row >= rowCount) return false;
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

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isInt32Array(value: unknown, length: number): value is Int32Array {
	return value instanceof Int32Array && value.length === length;
}
