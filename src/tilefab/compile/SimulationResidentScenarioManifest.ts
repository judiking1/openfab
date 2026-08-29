import {
	checksumOperationalConfiguration,
	copyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID,
	type SimulationResidentFleetParkingConfiguration,
	simulationResidentFleetParkingConfigurationError,
} from "./SimulationResidentFleetParkingConfiguration";
import {
	compileSimulationReplayHistoryManifest,
	compileSimulationTransferPlanManifest,
	SIMULATION_SCENARIO_ORDERING_POLICY,
	SIMULATION_SCENARIO_TIME_UNIT,
	type SimulationReplayHistoryManifestInput,
	type SimulationReplayHistoryRecord,
	type SimulationScenarioRejectionIssue,
	type SimulationScenarioSourceKind,
	type SimulationTransferPlanManifestInput,
	type SimulationTransferPlanRecord,
} from "./SimulationScenarioManifest";

export const SIMULATION_RESIDENT_SCENARIO_MANIFEST_SCHEMA_VERSION = 2 as const;
export const SIMULATION_RESIDENT_SCENARIO_ASSIGNMENT_POLICY =
	"EXPLICIT_CONFIGURED_VEHICLE_ID_PER_RECORD_V1" as const;
export const SIMULATION_RESIDENT_SCENARIO_MISSING_SAFETY_LAYERS = Object.freeze([
	"COMPLETE_HOME_RETURN_CYCLE_ROUTES",
	"FOREIGN_HOME_NON_INTERFERENCE",
	"ATOMIC_COMPLETE_CYCLE_LEASE",
	"RESIDENT_READINESS_CERTIFICATE",
	"RESIDENT_RUN_AUTHORIZATION",
] as const);

const MANIFEST_KEYS = Object.freeze([
	"schemaVersion",
	"simulationRunnable",
	"missingSafetyLayers",
	"runtimeProfileId",
	"vehicleAssignmentPolicy",
	"sourceKind",
	"timeUnit",
	"orderingPolicy",
	"sourceOperationalConfigurationFingerprint",
	"sourceOperationalReviewRevision",
	"sourceOperationalReviewAuthoredChecksum",
	"manifestId",
	"adapterId",
	"adapterVersion",
	"mappingVersion",
	"inputRecordCount",
	"acceptedRecordCount",
	"rejectedRecordCount",
	"rejectionIssues",
	"issuesTruncated",
	"records",
	"fingerprint",
] as const);
const ISSUE_KEYS = Object.freeze(["sourceOrdinal", "code", "message"] as const);
const PLAN_RECORD_KEYS = Object.freeze([
	"sourceOrdinal",
	"transferId",
	"releaseTimeMicroseconds",
	"loadId",
	"vehicleId",
	"sourcePortId",
	"destinationPortId",
] as const);
const REPLAY_RECORD_KEYS = Object.freeze([
	"sourceOrdinal",
	"historyEventId",
	"observedTimeMicroseconds",
	"loadId",
	"vehicleId",
	"sourcePortId",
	"destinationPortId",
] as const);

export interface SimulationResidentTransferPlanRecord extends SimulationTransferPlanRecord {
	readonly vehicleId: string;
}

export interface SimulationResidentReplayHistoryRecord extends SimulationReplayHistoryRecord {
	readonly vehicleId: string;
}

type ResidentManifestInputBase = Omit<SimulationTransferPlanManifestInput, "records">;

export interface SimulationResidentTransferPlanManifestInput extends ResidentManifestInputBase {
	readonly records: readonly SimulationResidentTransferPlanRecord[];
}

export interface SimulationResidentReplayHistoryManifestInput extends ResidentManifestInputBase {
	readonly records: readonly SimulationResidentReplayHistoryRecord[];
}

interface SimulationResidentScenarioManifestBase {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_SCENARIO_MANIFEST_SCHEMA_VERSION;
	readonly simulationRunnable: false;
	readonly missingSafetyLayers: typeof SIMULATION_RESIDENT_SCENARIO_MISSING_SAFETY_LAYERS;
	readonly runtimeProfileId: typeof SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID;
	readonly vehicleAssignmentPolicy: typeof SIMULATION_RESIDENT_SCENARIO_ASSIGNMENT_POLICY;
	readonly timeUnit: typeof SIMULATION_SCENARIO_TIME_UNIT;
	readonly orderingPolicy: typeof SIMULATION_SCENARIO_ORDERING_POLICY;
	readonly sourceOperationalConfigurationFingerprint: string;
	readonly sourceOperationalReviewRevision: number;
	readonly sourceOperationalReviewAuthoredChecksum: string;
	readonly manifestId: string;
	readonly adapterId: string;
	readonly adapterVersion: number;
	readonly mappingVersion: number;
	readonly inputRecordCount: number;
	readonly acceptedRecordCount: number;
	readonly rejectedRecordCount: number;
	readonly rejectionIssues: readonly SimulationScenarioRejectionIssue[];
	readonly issuesTruncated: boolean;
	readonly fingerprint: string;
}

export interface SimulationResidentTransferPlanManifest
	extends SimulationResidentScenarioManifestBase {
	readonly sourceKind: "TRANSFER_PLAN";
	readonly records: readonly SimulationResidentTransferPlanRecord[];
}

export interface SimulationResidentReplayHistoryManifest
	extends SimulationResidentScenarioManifestBase {
	readonly sourceKind: "REPLAY_HISTORY";
	readonly records: readonly SimulationResidentReplayHistoryRecord[];
}

export type SimulationResidentScenarioManifest =
	| SimulationResidentTransferPlanManifest
	| SimulationResidentReplayHistoryManifest;

export function compileSimulationResidentTransferPlanManifest(
	operationalConfiguration: OperationalConfigurationState,
	input: SimulationResidentTransferPlanManifestInput,
): SimulationResidentTransferPlanManifest {
	return compileResidentManifest("TRANSFER_PLAN", operationalConfiguration, input);
}

export function compileSimulationResidentReplayHistoryManifest(
	operationalConfiguration: OperationalConfigurationState,
	input: SimulationResidentReplayHistoryManifestInput,
): SimulationResidentReplayHistoryManifest {
	return compileResidentManifest("REPLAY_HISTORY", operationalConfiguration, input);
}

export function checksumSimulationResidentScenarioManifest(
	manifest: Omit<SimulationResidentScenarioManifest, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		manifest.schemaVersion,
		manifest.simulationRunnable ? 1 : 0,
		manifest.sourceOperationalReviewRevision,
		manifest.adapterVersion,
		manifest.mappingVersion,
		manifest.inputRecordCount,
		manifest.acceptedRecordCount,
		manifest.rejectedRecordCount,
		manifest.issuesTruncated ? 1 : 0,
	]);
	checksum.addStrings([
		...manifest.missingSafetyLayers,
		manifest.runtimeProfileId,
		manifest.vehicleAssignmentPolicy,
		manifest.sourceKind,
		manifest.timeUnit,
		manifest.orderingPolicy,
		manifest.sourceOperationalConfigurationFingerprint,
		manifest.sourceOperationalReviewAuthoredChecksum,
		manifest.manifestId,
		manifest.adapterId,
	]);
	for (const issue of manifest.rejectionIssues) {
		checksum.addNumber(issue.sourceOrdinal);
		checksum.addStrings([issue.code, issue.message]);
	}
	for (const record of manifest.records) {
		checksum.addNumbers([
			record.sourceOrdinal,
			record.sourcePortId,
			record.destinationPortId,
			residentRecordTime(manifest.sourceKind, record),
		]);
		checksum.addStrings([
			residentRecordId(manifest.sourceKind, record),
			record.loadId,
			record.vehicleId,
		]);
	}
	return checksum.digest();
}

export function simulationResidentScenarioManifestError(value: unknown): string | null {
	if (!isRecord(value)) return "resident scenario manifest must be an object";
	if (!hasExactKeys(value, MANIFEST_KEYS)) {
		return "resident scenario manifest contains missing or unexpected fields";
	}
	if (value.sourceKind !== "TRANSFER_PLAN" && value.sourceKind !== "REPLAY_HISTORY") {
		return "resident scenario source kind is invalid";
	}
	if (
		value.schemaVersion !== SIMULATION_RESIDENT_SCENARIO_MANIFEST_SCHEMA_VERSION ||
		value.simulationRunnable !== false ||
		!sameStrings(value.missingSafetyLayers, SIMULATION_RESIDENT_SCENARIO_MISSING_SAFETY_LAYERS) ||
		value.runtimeProfileId !== SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID ||
		value.vehicleAssignmentPolicy !== SIMULATION_RESIDENT_SCENARIO_ASSIGNMENT_POLICY ||
		value.timeUnit !== SIMULATION_SCENARIO_TIME_UNIT ||
		value.orderingPolicy !== SIMULATION_SCENARIO_ORDERING_POLICY ||
		!isNonEmptyString(value.sourceOperationalConfigurationFingerprint) ||
		!isNonNegativeSafeInteger(value.sourceOperationalReviewRevision) ||
		!isNonEmptyString(value.sourceOperationalReviewAuthoredChecksum) ||
		!Array.isArray(value.records) ||
		!Array.isArray(value.rejectionIssues)
	) {
		return "resident scenario policy or source identity is invalid";
	}
	const expectedRecordKeys =
		value.sourceKind === "TRANSFER_PLAN" ? PLAN_RECORD_KEYS : REPLAY_RECORD_KEYS;
	if (
		value.records.some(
			(record) =>
				!isRecord(record) ||
				!hasExactKeys(record, expectedRecordKeys) ||
				!isPortableVehicleId(record.vehicleId),
		) ||
		value.rejectionIssues.some((issue) => !isRecord(issue) || !hasExactKeys(issue, ISSUE_KEYS))
	) {
		return "resident scenario records or rejection issues are invalid";
	}
	try {
		const canonicalV1 = compileVersionOneManifest(value.sourceKind, manifestInputFromValue(value));
		if (
			value.inputRecordCount !== canonicalV1.inputRecordCount ||
			value.acceptedRecordCount !== canonicalV1.acceptedRecordCount ||
			value.rejectedRecordCount !== canonicalV1.rejectedRecordCount ||
			value.issuesTruncated !== canonicalV1.issuesTruncated ||
			!sameIssues(value.rejectionIssues, canonicalV1.rejectionIssues) ||
			!sameResidentRecordOrder(value.sourceKind, value.records, canonicalV1.records)
		) {
			return "resident scenario counts, issues, or canonical record order are invalid";
		}
		if (
			!isNonEmptyString(value.fingerprint) ||
			checksumSimulationResidentScenarioManifest(
				value as unknown as SimulationResidentScenarioManifest,
			) !== value.fingerprint
		) {
			return "resident scenario fingerprint does not match its contents";
		}
	} catch (error) {
		return error instanceof Error ? error.message : "resident scenario manifest is invalid";
	}
	return null;
}

export function simulationResidentScenarioManifestMatchesOperationalConfiguration(
	manifest: SimulationResidentScenarioManifest,
	operationalConfiguration: OperationalConfigurationState,
): boolean {
	if (simulationResidentScenarioManifestError(manifest)) return false;
	try {
		const operational = reviewedOperationalConfiguration(operationalConfiguration);
		const vehicleIds = new Set(operational.residentHomeSlots.map((slot) => slot.vehicleId));
		return (
			manifest.sourceOperationalConfigurationFingerprint ===
				checksumOperationalConfiguration(operational) &&
			manifest.sourceOperationalReviewRevision === operational.review.sourceRevision &&
			manifest.sourceOperationalReviewAuthoredChecksum ===
				operational.review.sourceAuthoredChecksum &&
			manifest.records.every((record) => vehicleIds.has(record.vehicleId))
		);
	} catch {
		return false;
	}
}

export function simulationResidentScenarioManifestMatchesParkingConfiguration(
	manifest: SimulationResidentScenarioManifest,
	parkingConfiguration: SimulationResidentFleetParkingConfiguration,
): boolean {
	if (
		simulationResidentScenarioManifestError(manifest) ||
		simulationResidentFleetParkingConfigurationError(parkingConfiguration)
	) {
		return false;
	}
	const parkedVehicleIds = new Set(parkingConfiguration.vehicleIds);
	return (
		manifest.runtimeProfileId === parkingConfiguration.runtimeProfileId &&
		manifest.sourceOperationalConfigurationFingerprint ===
			parkingConfiguration.sourceOperationalConfigurationFingerprint &&
		manifest.sourceOperationalReviewRevision ===
			parkingConfiguration.sourceOperationalReviewRevision &&
		manifest.sourceOperationalReviewAuthoredChecksum ===
			parkingConfiguration.sourceOperationalReviewAuthoredChecksum &&
		manifest.records.every((record) => parkedVehicleIds.has(record.vehicleId))
	);
}

export function serializeSimulationResidentScenarioManifest(
	manifest: SimulationResidentScenarioManifest,
): string {
	const error = simulationResidentScenarioManifestError(manifest);
	if (error) throw new Error(`Simulation resident scenario manifest is invalid: ${error}`);
	return `${JSON.stringify(manifest)}\n`;
}

export function parseSimulationResidentScenarioManifest(
	json: string,
	operationalConfiguration: OperationalConfigurationState,
): SimulationResidentScenarioManifest {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		throw new Error("Simulation resident scenario manifest JSON is invalid.");
	}
	const error = simulationResidentScenarioManifestError(value);
	if (error) throw new Error(`Simulation resident scenario manifest is invalid: ${error}`);
	const manifest = value as SimulationResidentScenarioManifest;
	const input = residentInputFromManifest(manifest);
	const canonical =
		manifest.sourceKind === "TRANSFER_PLAN"
			? compileSimulationResidentTransferPlanManifest(operationalConfiguration, input)
			: compileSimulationResidentReplayHistoryManifest(operationalConfiguration, input);
	if (canonical.fingerprint !== manifest.fingerprint) {
		throw new Error(
			"Simulation resident scenario manifest does not match the reviewed operational configuration.",
		);
	}
	return canonical;
}

function compileResidentManifest(
	sourceKind: "TRANSFER_PLAN",
	operationalConfiguration: OperationalConfigurationState,
	input: SimulationResidentTransferPlanManifestInput,
): SimulationResidentTransferPlanManifest;
function compileResidentManifest(
	sourceKind: "REPLAY_HISTORY",
	operationalConfiguration: OperationalConfigurationState,
	input: SimulationResidentReplayHistoryManifestInput,
): SimulationResidentReplayHistoryManifest;
function compileResidentManifest(
	sourceKind: SimulationScenarioSourceKind,
	operationalConfiguration: OperationalConfigurationState,
	input: SimulationResidentTransferPlanManifestInput | SimulationResidentReplayHistoryManifestInput,
): SimulationResidentScenarioManifest {
	const operational = reviewedOperationalConfiguration(operationalConfiguration);
	const configuredVehicleIds = new Set(operational.residentHomeSlots.map((slot) => slot.vehicleId));
	const vehicleIdBySourceOrdinal = new Map<number, string>();
	const expectedRecordKeys = sourceKind === "TRANSFER_PLAN" ? PLAN_RECORD_KEYS : REPLAY_RECORD_KEYS;
	for (const record of input.records) {
		if (!isRecord(record) || !hasExactKeys(record, expectedRecordKeys)) {
			throw new Error("Resident scenario record contains missing or unexpected fields.");
		}
		if (!isPortableVehicleId(record.vehicleId)) {
			throw new Error("Resident scenario vehicle identity is invalid.");
		}
		if (!configuredVehicleIds.has(record.vehicleId)) {
			throw new Error(`Resident scenario vehicle ${record.vehicleId} has no reviewed home slot.`);
		}
		vehicleIdBySourceOrdinal.set(record.sourceOrdinal as number, record.vehicleId);
	}
	const canonicalV1 = compileVersionOneManifest(sourceKind, input);
	const records = canonicalV1.records.map((record) => {
		const vehicleId = vehicleIdBySourceOrdinal.get(record.sourceOrdinal);
		if (!vehicleId)
			throw new Error("Resident scenario vehicle assignment was lost during ordering.");
		return Object.freeze({ ...record, vehicleId });
	});
	const manifestWithoutIdentity = {
		schemaVersion: SIMULATION_RESIDENT_SCENARIO_MANIFEST_SCHEMA_VERSION,
		simulationRunnable: false,
		missingSafetyLayers: SIMULATION_RESIDENT_SCENARIO_MISSING_SAFETY_LAYERS,
		runtimeProfileId: SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID,
		vehicleAssignmentPolicy: SIMULATION_RESIDENT_SCENARIO_ASSIGNMENT_POLICY,
		sourceKind,
		timeUnit: SIMULATION_SCENARIO_TIME_UNIT,
		orderingPolicy: SIMULATION_SCENARIO_ORDERING_POLICY,
		sourceOperationalConfigurationFingerprint: checksumOperationalConfiguration(operational),
		sourceOperationalReviewRevision: operational.review.sourceRevision,
		sourceOperationalReviewAuthoredChecksum: operational.review.sourceAuthoredChecksum,
		manifestId: canonicalV1.manifestId,
		adapterId: canonicalV1.adapterId,
		adapterVersion: canonicalV1.adapterVersion,
		mappingVersion: canonicalV1.mappingVersion,
		inputRecordCount: canonicalV1.inputRecordCount,
		acceptedRecordCount: canonicalV1.acceptedRecordCount,
		rejectedRecordCount: canonicalV1.rejectedRecordCount,
		rejectionIssues: canonicalV1.rejectionIssues,
		issuesTruncated: canonicalV1.issuesTruncated,
		records: Object.freeze(records),
	} as Omit<SimulationResidentScenarioManifest, "fingerprint">;
	return Object.freeze({
		...manifestWithoutIdentity,
		fingerprint: checksumSimulationResidentScenarioManifest(manifestWithoutIdentity),
	}) as SimulationResidentScenarioManifest;
}

function reviewedOperationalConfiguration(
	state: OperationalConfigurationState,
): OperationalConfigurationState & {
	readonly review: NonNullable<OperationalConfigurationState["review"]>;
} {
	const operational = copyOperationalConfigurationState(state);
	if (!operational.review) {
		throw new Error("Resident scenario manifest requires reviewed operational configuration.");
	}
	return operational as OperationalConfigurationState & {
		readonly review: NonNullable<OperationalConfigurationState["review"]>;
	};
}

function compileVersionOneManifest(
	sourceKind: SimulationScenarioSourceKind,
	input:
		| SimulationResidentTransferPlanManifestInput
		| SimulationResidentReplayHistoryManifestInput
		| (SimulationTransferPlanManifestInput & SimulationReplayHistoryManifestInput),
) {
	const shared = {
		manifestId: input.manifestId,
		adapterId: input.adapterId,
		adapterVersion: input.adapterVersion,
		mappingVersion: input.mappingVersion,
		inputRecordCount: input.inputRecordCount,
		rejectedRecordCount: input.rejectedRecordCount,
		rejectionIssues: input.rejectionIssues,
		issuesTruncated: input.issuesTruncated,
	};
	return sourceKind === "TRANSFER_PLAN"
		? compileSimulationTransferPlanManifest({
				...shared,
				records: input.records.map((record) => stripResidentPlanRecord(record)),
			})
		: compileSimulationReplayHistoryManifest({
				...shared,
				records: input.records.map((record) => stripResidentReplayRecord(record)),
			});
}

function stripResidentPlanRecord(record: unknown): SimulationTransferPlanRecord {
	const value = record as SimulationResidentTransferPlanRecord;
	return {
		sourceOrdinal: value.sourceOrdinal,
		transferId: value.transferId,
		releaseTimeMicroseconds: value.releaseTimeMicroseconds,
		loadId: value.loadId,
		sourcePortId: value.sourcePortId,
		destinationPortId: value.destinationPortId,
	};
}

function stripResidentReplayRecord(record: unknown): SimulationReplayHistoryRecord {
	const value = record as SimulationResidentReplayHistoryRecord;
	return {
		sourceOrdinal: value.sourceOrdinal,
		historyEventId: value.historyEventId,
		observedTimeMicroseconds: value.observedTimeMicroseconds,
		loadId: value.loadId,
		sourcePortId: value.sourcePortId,
		destinationPortId: value.destinationPortId,
	};
}

function manifestInputFromValue(
	value: Record<string, unknown>,
): SimulationTransferPlanManifestInput & SimulationReplayHistoryManifestInput {
	return {
		manifestId: value.manifestId as string,
		adapterId: value.adapterId as string,
		adapterVersion: value.adapterVersion as number,
		mappingVersion: value.mappingVersion as number,
		inputRecordCount: value.inputRecordCount as number,
		rejectedRecordCount: value.rejectedRecordCount as number,
		rejectionIssues: value.rejectionIssues as SimulationScenarioRejectionIssue[],
		issuesTruncated: value.issuesTruncated as boolean,
		records: value.records as never,
	};
}

function residentInputFromManifest(
	manifest: SimulationResidentScenarioManifest,
): SimulationResidentTransferPlanManifestInput & SimulationResidentReplayHistoryManifestInput {
	return {
		manifestId: manifest.manifestId,
		adapterId: manifest.adapterId,
		adapterVersion: manifest.adapterVersion,
		mappingVersion: manifest.mappingVersion,
		inputRecordCount: manifest.inputRecordCount,
		rejectedRecordCount: manifest.rejectedRecordCount,
		rejectionIssues: manifest.rejectionIssues,
		issuesTruncated: manifest.issuesTruncated,
		records: manifest.records as never,
	};
}

function sameResidentRecordOrder(
	sourceKind: SimulationScenarioSourceKind,
	actual: readonly unknown[],
	canonical: readonly (SimulationTransferPlanRecord | SimulationReplayHistoryRecord)[],
): boolean {
	if (actual.length !== canonical.length) return false;
	return actual.every((candidate, row) => {
		if (!isRecord(candidate)) return false;
		const expected = canonical[row];
		return (
			expected !== undefined &&
			candidate.sourceOrdinal === expected.sourceOrdinal &&
			candidate.loadId === expected.loadId &&
			candidate.sourcePortId === expected.sourcePortId &&
			candidate.destinationPortId === expected.destinationPortId &&
			residentRecordId(sourceKind, candidate as never) ===
				residentRecordId(sourceKind, expected as never) &&
			residentRecordTime(sourceKind, candidate as never) ===
				residentRecordTime(sourceKind, expected as never)
		);
	});
}

function sameIssues(
	actual: readonly unknown[],
	canonical: readonly SimulationScenarioRejectionIssue[],
): boolean {
	return (
		actual.length === canonical.length &&
		actual.every((candidate, row) => {
			if (!isRecord(candidate)) return false;
			const expected = canonical[row];
			return (
				expected !== undefined &&
				candidate.sourceOrdinal === expected.sourceOrdinal &&
				candidate.code === expected.code &&
				candidate.message === expected.message
			);
		})
	);
}

function residentRecordId(
	sourceKind: SimulationScenarioSourceKind,
	record: SimulationResidentTransferPlanRecord | SimulationResidentReplayHistoryRecord,
): string {
	return sourceKind === "TRANSFER_PLAN"
		? (record as SimulationResidentTransferPlanRecord).transferId
		: (record as SimulationResidentReplayHistoryRecord).historyEventId;
}

function residentRecordTime(
	sourceKind: SimulationScenarioSourceKind,
	record: SimulationResidentTransferPlanRecord | SimulationResidentReplayHistoryRecord,
): number {
	return sourceKind === "TRANSFER_PLAN"
		? (record as SimulationResidentTransferPlanRecord).releaseTimeMicroseconds
		: (record as SimulationResidentReplayHistoryRecord).observedTimeMicroseconds;
}

function isPortableVehicleId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 128 &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
	);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
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
