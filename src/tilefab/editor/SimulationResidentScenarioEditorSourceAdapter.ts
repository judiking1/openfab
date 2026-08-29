import type { SimulationReadinessComponents } from "../compile/SimulationReadinessCertificate";
import { simulationReadinessComponentsError } from "../compile/SimulationReadinessCertificate";
import {
	checksumSimulationResidentCycleResourceRunConfigurationInput,
	type SimulationResidentCycleResourceRunConfigurationInput,
} from "../compile/SimulationResidentCycleResourceRunConfiguration";
import {
	checksumSimulationResidentCycleServiceTimingInput,
	type SimulationResidentCycleServiceTimingInput,
} from "../compile/SimulationResidentCycleServiceTiming";
import {
	compileSimulationResidentFleetParkingConfiguration,
	type SimulationResidentFleetParkingConfiguration,
	simulationResidentFleetParkingConfigurationError,
} from "../compile/SimulationResidentFleetParkingConfiguration";
import {
	compileSimulationResidentReplayHistoryManifest,
	compileSimulationResidentTransferPlanManifest,
	type SimulationResidentReplayHistoryRecord,
	type SimulationResidentScenarioManifest,
	type SimulationResidentTransferPlanRecord,
	simulationResidentScenarioManifestError,
} from "../compile/SimulationResidentScenarioManifest";
import {
	SIMULATION_SCENARIO_MAX_INPUT_RECORDS,
	SIMULATION_SCENARIO_MAX_REJECTION_ISSUES,
	type SimulationScenarioRejectionIssue,
} from "../compile/SimulationScenarioManifest";
import {
	checksumOperationalConfiguration,
	copyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isPositiveRecordId } from "../core/PortRecord";

export const SIMULATION_RESIDENT_EDITOR_ADAPTER_ID =
	"OPENFAB_EDITOR_REVIEWED_RESIDENT_SCENARIO_V1" as const;
export const SIMULATION_RESIDENT_EDITOR_ADAPTER_VERSION = 1 as const;
export const SIMULATION_RESIDENT_EDITOR_RUN_ASSET_SCHEMA_VERSION = 1 as const;

export const SIMULATION_RESIDENT_EDITOR_REJECTION_CODE = Object.freeze({
	MALFORMED_RECORD: "MALFORMED_RECORD",
	INVALID_RECORD_ID: "INVALID_RECORD_ID",
	INVALID_TIME: "INVALID_TIME",
	INVALID_LOAD_ID: "INVALID_LOAD_ID",
	INVALID_VEHICLE_ID: "INVALID_VEHICLE_ID",
	UNKNOWN_VEHICLE: "UNKNOWN_VEHICLE",
	UNKNOWN_SOURCE_PORT: "UNKNOWN_SOURCE_PORT",
	UNKNOWN_DESTINATION_PORT: "UNKNOWN_DESTINATION_PORT",
	SAME_SOURCE_DESTINATION: "SAME_SOURCE_DESTINATION",
	DUPLICATE_RECORD_ID: "DUPLICATE_RECORD_ID",
} as const);
type SimulationResidentEditorRejectionCode =
	(typeof SIMULATION_RESIDENT_EDITOR_REJECTION_CODE)[keyof typeof SIMULATION_RESIDENT_EDITOR_REJECTION_CODE];

const REJECTION_MESSAGES: Readonly<Record<SimulationResidentEditorRejectionCode, string>> =
	Object.freeze({
		MALFORMED_RECORD: "The reviewed resident row does not match the public OpenFab schema.",
		INVALID_RECORD_ID: "The reviewed resident row has no portable record identity.",
		INVALID_TIME:
			"The reviewed resident row time must be a non-negative integer microsecond value.",
		INVALID_LOAD_ID: "The reviewed resident row has no portable load identity.",
		INVALID_VEHICLE_ID: "The reviewed resident row has no portable vehicle identity.",
		UNKNOWN_VEHICLE: "The reviewed resident row vehicle has no configured home slot.",
		UNKNOWN_SOURCE_PORT: "The reviewed source port is not present in the exact OpenFab foundation.",
		UNKNOWN_DESTINATION_PORT:
			"The reviewed destination port is not present in the exact OpenFab foundation.",
		SAME_SOURCE_DESTINATION: "The reviewed source and destination ports must differ.",
		DUPLICATE_RECORD_ID: "The reviewed resident record identity is duplicated.",
	});

const SOURCE_KEYS = Object.freeze(["sourceKind", "manifestId", "mappingVersion", "records"]);
const PLAN_ROW_KEYS = Object.freeze([
	"transferId",
	"releaseTimeMicroseconds",
	"loadId",
	"vehicleId",
	"sourcePortId",
	"destinationPortId",
]);
const HISTORY_ROW_KEYS = Object.freeze([
	"historyEventId",
	"observedTimeMicroseconds",
	"loadId",
	"vehicleId",
	"sourcePortId",
	"destinationPortId",
]);
const RUN_ASSET_KEYS = Object.freeze([
	"schemaVersion",
	"parking",
	"manifest",
	"serviceTimingInput",
	"resourceRunInput",
	"serviceTimingInputFingerprint",
	"resourceRunInputFingerprint",
	"fingerprint",
]);

export interface SimulationResidentScenarioEditorSourceHeader {
	readonly manifestId: string;
	readonly mappingVersion: number;
}

export interface SimulationResidentTransferPlanEditorRow {
	readonly transferId: string;
	readonly releaseTimeMicroseconds: number;
	readonly loadId: string;
	readonly vehicleId: string;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
}

export interface SimulationResidentReplayHistoryEditorRow {
	readonly historyEventId: string;
	readonly observedTimeMicroseconds: number;
	readonly loadId: string;
	readonly vehicleId: string;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
}

export interface SimulationResidentTransferPlanEditorSource
	extends SimulationResidentScenarioEditorSourceHeader {
	readonly sourceKind: "TRANSFER_PLAN";
	readonly records: readonly unknown[];
}

export interface SimulationResidentReplayHistoryEditorSource
	extends SimulationResidentScenarioEditorSourceHeader {
	readonly sourceKind: "REPLAY_HISTORY";
	readonly records: readonly unknown[];
}

export type SimulationResidentScenarioEditorSource =
	| SimulationResidentTransferPlanEditorSource
	| SimulationResidentReplayHistoryEditorSource;

export interface SimulationResidentScenarioEditorRunAsset {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_EDITOR_RUN_ASSET_SCHEMA_VERSION;
	readonly parking: SimulationResidentFleetParkingConfiguration;
	readonly manifest: SimulationResidentScenarioManifest;
	readonly serviceTimingInput: SimulationResidentCycleServiceTimingInput;
	readonly resourceRunInput: SimulationResidentCycleResourceRunConfigurationInput;
	readonly serviceTimingInputFingerprint: string;
	readonly resourceRunInputFingerprint: string;
	readonly fingerprint: string;
}

/** Canonicalizes reviewed resident rows against exact OpenFab ports and reviewed home slots. */
export function adaptSimulationResidentScenarioEditorRunAsset(
	components: SimulationReadinessComponents,
	operationalConfiguration: OperationalConfigurationState,
	source: SimulationResidentScenarioEditorSource,
	serviceTimingInput: SimulationResidentCycleServiceTimingInput,
	resourceRunInput: SimulationResidentCycleResourceRunConfigurationInput,
): SimulationResidentScenarioEditorRunAsset {
	const componentsError = simulationReadinessComponentsError(components);
	if (componentsError)
		throw new Error(`Resident editor components are invalid: ${componentsError}`);
	if (
		!isRecordWithExactKeys(source, SOURCE_KEYS) ||
		(source.sourceKind !== "TRANSFER_PLAN" && source.sourceKind !== "REPLAY_HISTORY") ||
		!Array.isArray(source.records)
	) {
		throw new Error("Resident scenario editor source is malformed.");
	}
	if (source.records.length > SIMULATION_SCENARIO_MAX_INPUT_RECORDS) {
		throw new RangeError("Resident scenario editor source exceeds the run-asset row limit.");
	}
	const operational = copyOperationalConfigurationState(operationalConfiguration);
	const parking = compileSimulationResidentFleetParkingConfiguration(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		operational,
	);
	const manifest = adaptManifest(components, operational, parking, source);
	if (manifest.acceptedRecordCount === 0) {
		throw new Error("Resident scenario editor source has no accepted records to prepare.");
	}
	const serviceTimingInputFingerprint = checksumSimulationResidentCycleServiceTimingInput(
		manifest,
		serviceTimingInput,
	);
	const resourceRunInputFingerprint = checksumSimulationResidentCycleResourceRunConfigurationInput(
		manifest,
		resourceRunInput,
	);
	const canonicalServiceTimingInput = copyServiceTimingInput(serviceTimingInput);
	const canonicalResourceRunInput = copyResourceRunInput(resourceRunInput);
	const partial = {
		schemaVersion: SIMULATION_RESIDENT_EDITOR_RUN_ASSET_SCHEMA_VERSION,
		parking,
		manifest,
		serviceTimingInput: canonicalServiceTimingInput,
		resourceRunInput: canonicalResourceRunInput,
		serviceTimingInputFingerprint,
		resourceRunInputFingerprint,
	} as const;
	const asset = Object.freeze({
		...partial,
		fingerprint: checksumSimulationResidentScenarioEditorRunAsset(partial),
	}) satisfies SimulationResidentScenarioEditorRunAsset;
	const error = simulationResidentScenarioEditorRunAssetError(asset);
	if (error) throw new Error(`Compiled resident editor run asset is invalid: ${error}`);
	return asset;
}

export function simulationResidentScenarioEditorRunAssetError(value: unknown): string | null {
	if (!isRecordWithExactKeys(value, RUN_ASSET_KEYS)) {
		return "resident editor run asset contains missing or unexpected fields";
	}
	if (value.schemaVersion !== SIMULATION_RESIDENT_EDITOR_RUN_ASSET_SCHEMA_VERSION) {
		return "resident editor run asset schema version is invalid";
	}
	const parkingError = simulationResidentFleetParkingConfigurationError(value.parking);
	const manifestError = simulationResidentScenarioManifestError(value.manifest);
	if (parkingError || manifestError) {
		return parkingError
			? `resident editor parking is invalid: ${parkingError}`
			: `resident editor manifest is invalid: ${manifestError}`;
	}
	const asset = value as unknown as SimulationResidentScenarioEditorRunAsset;
	if (
		asset.parking.sourceOperationalConfigurationFingerprint !==
			asset.manifest.sourceOperationalConfigurationFingerprint ||
		asset.parking.sourceOperationalReviewRevision !==
			asset.manifest.sourceOperationalReviewRevision ||
		asset.parking.sourceOperationalReviewAuthoredChecksum !==
			asset.manifest.sourceOperationalReviewAuthoredChecksum
	) {
		return "resident editor parking and manifest sources do not match";
	}
	try {
		if (
			checksumSimulationResidentCycleServiceTimingInput(
				asset.manifest,
				asset.serviceTimingInput,
			) !== asset.serviceTimingInputFingerprint ||
			checksumSimulationResidentCycleResourceRunConfigurationInput(
				asset.manifest,
				asset.resourceRunInput,
			) !== asset.resourceRunInputFingerprint ||
			checksumSimulationResidentScenarioEditorRunAsset(asset) !== asset.fingerprint
		) {
			return "resident editor run asset fingerprint does not match its exact inputs";
		}
	} catch {
		return "resident editor run asset input fingerprints cannot be recomputed";
	}
	return null;
}

function adaptManifest(
	components: SimulationReadinessComponents,
	operational: OperationalConfigurationState,
	parking: SimulationResidentFleetParkingConfiguration,
	source: SimulationResidentScenarioEditorSource,
): SimulationResidentScenarioManifest {
	if (
		parking.sourceOperationalConfigurationFingerprint !==
		checksumOperationalConfiguration(operational)
	) {
		throw new Error("Resident parking does not match the reviewed operational configuration.");
	}
	const portIds = new Set(components.foundation.stations.ids);
	const vehicleIds = new Set(parking.vehicleIds);
	const accepted: Array<
		SimulationResidentTransferPlanRecord | SimulationResidentReplayHistoryRecord
	> = [];
	const issues: SimulationScenarioRejectionIssue[] = [];
	const recordIds = new Set<string>();
	let rejectedRecordCount = 0;
	for (let sourceOrdinal = 0; sourceOrdinal < source.records.length; sourceOrdinal++) {
		const candidate = source.records[sourceOrdinal];
		const code = rowError(candidate, source.sourceKind, portIds, vehicleIds, recordIds);
		if (code) {
			rejectedRecordCount++;
			appendIssue(issues, sourceOrdinal, code);
			continue;
		}
		const row = candidate as Record<string, string | number>;
		const recordId =
			source.sourceKind === "TRANSFER_PLAN"
				? (row.transferId as string)
				: (row.historyEventId as string);
		recordIds.add(recordId);
		accepted.push(
			Object.freeze(
				source.sourceKind === "TRANSFER_PLAN"
					? {
							sourceOrdinal,
							transferId: recordId,
							releaseTimeMicroseconds: row.releaseTimeMicroseconds as number,
							loadId: row.loadId as string,
							vehicleId: row.vehicleId as string,
							sourcePortId: row.sourcePortId as number,
							destinationPortId: row.destinationPortId as number,
						}
					: {
							sourceOrdinal,
							historyEventId: recordId,
							observedTimeMicroseconds: row.observedTimeMicroseconds as number,
							loadId: row.loadId as string,
							vehicleId: row.vehicleId as string,
							sourcePortId: row.sourcePortId as number,
							destinationPortId: row.destinationPortId as number,
						},
			),
		);
	}
	const header = {
		manifestId: source.manifestId,
		adapterId: SIMULATION_RESIDENT_EDITOR_ADAPTER_ID,
		adapterVersion: SIMULATION_RESIDENT_EDITOR_ADAPTER_VERSION,
		mappingVersion: source.mappingVersion,
		inputRecordCount: source.records.length,
		rejectedRecordCount,
		rejectionIssues: Object.freeze(issues),
		issuesTruncated: rejectedRecordCount > SIMULATION_SCENARIO_MAX_REJECTION_ISSUES,
	};
	return source.sourceKind === "TRANSFER_PLAN"
		? compileSimulationResidentTransferPlanManifest(operational, {
				...header,
				records: accepted as readonly SimulationResidentTransferPlanRecord[],
			})
		: compileSimulationResidentReplayHistoryManifest(operational, {
				...header,
				records: accepted as readonly SimulationResidentReplayHistoryRecord[],
			});
}

function rowError(
	value: unknown,
	kind: SimulationResidentScenarioEditorSource["sourceKind"],
	portIds: ReadonlySet<number>,
	vehicleIds: ReadonlySet<string>,
	recordIds: ReadonlySet<string>,
): SimulationResidentEditorRejectionCode | null {
	const expectedKeys = kind === "TRANSFER_PLAN" ? PLAN_ROW_KEYS : HISTORY_ROW_KEYS;
	if (!isRecordWithExactKeys(value, expectedKeys)) return "MALFORMED_RECORD";
	const recordId = kind === "TRANSFER_PLAN" ? value.transferId : value.historyEventId;
	const time =
		kind === "TRANSFER_PLAN" ? value.releaseTimeMicroseconds : value.observedTimeMicroseconds;
	if (!isPortableIdentity(recordId)) return "INVALID_RECORD_ID";
	if (!Number.isSafeInteger(time) || (time as number) < 0) return "INVALID_TIME";
	if (!isPortableIdentity(value.loadId)) return "INVALID_LOAD_ID";
	if (!isPortableIdentity(value.vehicleId)) return "INVALID_VEHICLE_ID";
	if (!vehicleIds.has(value.vehicleId)) return "UNKNOWN_VEHICLE";
	const sourcePortId = value.sourcePortId;
	const destinationPortId = value.destinationPortId;
	if (
		typeof sourcePortId !== "number" ||
		!isPositiveRecordId(sourcePortId) ||
		!portIds.has(sourcePortId)
	) {
		return "UNKNOWN_SOURCE_PORT";
	}
	if (
		typeof destinationPortId !== "number" ||
		!isPositiveRecordId(destinationPortId) ||
		!portIds.has(destinationPortId)
	) {
		return "UNKNOWN_DESTINATION_PORT";
	}
	if (sourcePortId === destinationPortId) return "SAME_SOURCE_DESTINATION";
	if (recordIds.has(recordId)) return "DUPLICATE_RECORD_ID";
	return null;
}

function appendIssue(
	issues: SimulationScenarioRejectionIssue[],
	sourceOrdinal: number,
	code: SimulationResidentEditorRejectionCode,
): void {
	if (issues.length >= SIMULATION_SCENARIO_MAX_REJECTION_ISSUES) return;
	issues.push(Object.freeze({ sourceOrdinal, code, message: REJECTION_MESSAGES[code] }));
}

export function checksumSimulationResidentScenarioEditorRunAsset(
	asset: Omit<SimulationResidentScenarioEditorRunAsset, "fingerprint">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumber(asset.schemaVersion);
	checksum.addStrings([
		asset.parking.fingerprint,
		asset.manifest.fingerprint,
		asset.serviceTimingInputFingerprint,
		asset.resourceRunInputFingerprint,
	]);
	return checksum.digest();
}

function copyServiceTimingInput(
	input: SimulationResidentCycleServiceTimingInput,
): SimulationResidentCycleServiceTimingInput {
	return Object.freeze({
		eqProcessTimings: Object.freeze(
			input.eqProcessTimings.map((record) =>
				Object.freeze({
					sourceOrdinal: record.sourceOrdinal,
					capabilityId: record.capabilityId,
					processingDurationMicroseconds: record.processingDurationMicroseconds,
				}),
			),
		),
	});
}

function copyResourceRunInput(
	input: SimulationResidentCycleResourceRunConfigurationInput,
): SimulationResidentCycleResourceRunConfigurationInput {
	return Object.freeze({
		eqResources: Object.freeze(
			input.eqResources.map((resource) =>
				Object.freeze({
					equipmentGroupId: resource.equipmentGroupId,
					concurrentCapacity: resource.concurrentCapacity,
					availabilityMode: resource.availabilityMode,
					availabilityWindows: Object.freeze(
						resource.availabilityWindows.map((window) =>
							Object.freeze({
								startMicroseconds: window.startMicroseconds,
								endMicroseconds: window.endMicroseconds,
							}),
						),
					),
				}),
			),
		),
		initialStorageLoads: Object.freeze(
			input.initialStorageLoads.map((load) =>
				Object.freeze({ loadId: load.loadId, equipmentGroupId: load.equipmentGroupId }),
			),
		),
	});
}

function isPortableIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 128 &&
		/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
	);
}

function isRecordWithExactKeys(
	value: unknown,
	expectedKeys: readonly string[],
): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	return (
		keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key))
	);
}
