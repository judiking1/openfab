import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "../compile/SimulationReadinessCertificate";
import {
	compileSimulationReplayHistoryManifest,
	compileSimulationTransferPlanManifest,
	SIMULATION_SCENARIO_MAX_INPUT_RECORDS,
	SIMULATION_SCENARIO_MAX_REJECTION_ISSUES,
	type SimulationReplayHistoryManifest,
	type SimulationReplayHistoryRecord,
	type SimulationScenarioManifest,
	type SimulationScenarioRejectionIssue,
	type SimulationTransferPlanManifest,
	type SimulationTransferPlanRecord,
} from "../compile/SimulationScenarioManifest";
import {
	checksumSimulationScenarioResourceRunConfigurationInput,
	type SimulationScenarioResourceRunConfigurationInput,
} from "../compile/SimulationScenarioResourceRunConfiguration";
import {
	checksumSimulationScenarioServiceTimingInput,
	type SimulationScenarioServiceTimingInput,
} from "../compile/SimulationScenarioServiceTiming";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isPositiveRecordId } from "../core/PortRecord";

export const SIMULATION_SCENARIO_EDITOR_ADAPTER_ID = "OPENFAB_EDITOR_REVIEWED_SCENARIO_V1" as const;
export const SIMULATION_SCENARIO_EDITOR_ADAPTER_VERSION = 1 as const;
export const SIMULATION_SCENARIO_EDITOR_RUN_ASSET_SCHEMA_VERSION = 1 as const;

export const SIMULATION_SCENARIO_EDITOR_REJECTION_CODE = Object.freeze({
	MALFORMED_RECORD: "MALFORMED_RECORD",
	INVALID_RECORD_ID: "INVALID_RECORD_ID",
	INVALID_TIME: "INVALID_TIME",
	INVALID_LOAD_ID: "INVALID_LOAD_ID",
	UNKNOWN_SOURCE_PORT: "UNKNOWN_SOURCE_PORT",
	UNKNOWN_DESTINATION_PORT: "UNKNOWN_DESTINATION_PORT",
	SAME_SOURCE_DESTINATION: "SAME_SOURCE_DESTINATION",
	DUPLICATE_RECORD_ID: "DUPLICATE_RECORD_ID",
} as const);

type SimulationScenarioEditorRejectionCode =
	(typeof SIMULATION_SCENARIO_EDITOR_REJECTION_CODE)[keyof typeof SIMULATION_SCENARIO_EDITOR_REJECTION_CODE];

const REJECTION_MESSAGES: Readonly<Record<SimulationScenarioEditorRejectionCode, string>> =
	Object.freeze({
		MALFORMED_RECORD: "The reviewed row does not match the public OpenFab source schema.",
		INVALID_RECORD_ID: "The reviewed row has no portable record identity.",
		INVALID_TIME: "The reviewed row time must be a non-negative integer microsecond value.",
		INVALID_LOAD_ID: "The reviewed row has no portable load identity.",
		UNKNOWN_SOURCE_PORT: "The reviewed source port is not present in the exact certificate.",
		UNKNOWN_DESTINATION_PORT:
			"The reviewed destination port is not present in the exact certificate.",
		SAME_SOURCE_DESTINATION: "The reviewed source and destination ports must differ.",
		DUPLICATE_RECORD_ID: "The reviewed record identity is duplicated in this run asset.",
	});

const TRANSFER_PLAN_ROW_KEYS = Object.freeze([
	"transferId",
	"releaseTimeMicroseconds",
	"loadId",
	"sourcePortId",
	"destinationPortId",
] as const);
const REPLAY_HISTORY_ROW_KEYS = Object.freeze([
	"historyEventId",
	"observedTimeMicroseconds",
	"loadId",
	"sourcePortId",
	"destinationPortId",
] as const);
const EDITOR_SOURCE_KEYS = Object.freeze([
	"sourceKind",
	"manifestId",
	"mappingVersion",
	"records",
] as const);

export interface SimulationScenarioEditorSourceHeader {
	/** Public run-local identity. A file name or private source fingerprint must not be used. */
	readonly manifestId: string;
	readonly mappingVersion: number;
}

export interface SimulationTransferPlanEditorRow {
	readonly transferId: string;
	readonly releaseTimeMicroseconds: number;
	readonly loadId: string;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
}

export interface SimulationReplayHistoryEditorRow {
	readonly historyEventId: string;
	readonly observedTimeMicroseconds: number;
	readonly loadId: string;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
}

export interface SimulationTransferPlanEditorSource extends SimulationScenarioEditorSourceHeader {
	readonly sourceKind: "TRANSFER_PLAN";
	readonly records: readonly unknown[];
}

export interface SimulationReplayHistoryEditorSource extends SimulationScenarioEditorSourceHeader {
	readonly sourceKind: "REPLAY_HISTORY";
	readonly records: readonly unknown[];
}

export type SimulationScenarioEditorSource =
	| SimulationTransferPlanEditorSource
	| SimulationReplayHistoryEditorSource;

export interface SimulationScenarioEditorRunAsset {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_EDITOR_RUN_ASSET_SCHEMA_VERSION;
	readonly manifest: SimulationScenarioManifest;
	readonly serviceTimingInput: SimulationScenarioServiceTimingInput;
	readonly resourceRunInput: SimulationScenarioResourceRunConfigurationInput;
	readonly serviceTimingInputFingerprint: string;
	readonly resourceRunInputFingerprint: string;
	readonly fingerprint: string;
}

/**
 * Converts already reviewed public rows into a canonical run-local manifest. Raw imported rows,
 * file names, external aliases, private fingerprints, and unexpected fields never cross this
 * boundary. Rejections use fixed public-safe text and retain only the source ordinal.
 */
export function adaptSimulationScenarioEditorSource(
	snapshot: PublishedSimulationReadinessSnapshot,
	source: SimulationScenarioEditorSource,
): SimulationScenarioManifest {
	const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
	if (snapshotError) {
		throw new Error(`Published readiness snapshot is invalid: ${snapshotError}`);
	}
	if (
		!isRecordWithExactKeys(source, EDITOR_SOURCE_KEYS) ||
		(source.sourceKind !== "TRANSFER_PLAN" && source.sourceKind !== "REPLAY_HISTORY") ||
		!Array.isArray(source.records)
	) {
		throw new Error("Simulation scenario editor source is malformed.");
	}
	if (source.records.length > SIMULATION_SCENARIO_MAX_INPUT_RECORDS) {
		throw new Error("Simulation scenario editor source exceeds the public run-asset limit.");
	}
	const certifiedPortIds = new Set(snapshot.foundation.stations.ids);
	return source.sourceKind === "TRANSFER_PLAN"
		? adaptTransferPlan(certifiedPortIds, source)
		: adaptReplayHistory(certifiedPortIds, source);
}

/** Canonicalizes all public run-local inputs without retaining caller-owned arrays or records. */
export function adaptSimulationScenarioEditorRunAsset(
	snapshot: PublishedSimulationReadinessSnapshot,
	source: SimulationScenarioEditorSource,
	serviceTimingInput: SimulationScenarioServiceTimingInput,
	resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
): SimulationScenarioEditorRunAsset {
	const manifest = adaptSimulationScenarioEditorSource(snapshot, source);
	if (manifest.acceptedRecordCount === 0) {
		throw new Error("Simulation scenario editor source has no accepted records to prepare.");
	}
	const serviceTimingInputFingerprint = checksumSimulationScenarioServiceTimingInput(
		manifest,
		serviceTimingInput,
	);
	const resourceRunInputFingerprint = checksumSimulationScenarioResourceRunConfigurationInput(
		manifest,
		resourceRunInput,
	);
	const canonicalServiceTimingInput = copyServiceTimingInput(serviceTimingInput);
	const canonicalResourceRunInput = copyResourceRunInput(resourceRunInput);
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([SIMULATION_SCENARIO_EDITOR_RUN_ASSET_SCHEMA_VERSION]);
	checksum.addStrings([
		manifest.sourceKind,
		manifest.fingerprint,
		serviceTimingInputFingerprint,
		resourceRunInputFingerprint,
	]);
	return Object.freeze({
		schemaVersion: SIMULATION_SCENARIO_EDITOR_RUN_ASSET_SCHEMA_VERSION,
		manifest,
		serviceTimingInput: canonicalServiceTimingInput,
		resourceRunInput: canonicalResourceRunInput,
		serviceTimingInputFingerprint,
		resourceRunInputFingerprint,
		fingerprint: checksum.digest(),
	});
}

function adaptTransferPlan(
	certifiedPortIds: ReadonlySet<number>,
	source: SimulationTransferPlanEditorSource,
): SimulationTransferPlanManifest {
	const records: SimulationTransferPlanRecord[] = [];
	const issues: SimulationScenarioRejectionIssue[] = [];
	const recordIds = new Set<string>();
	let rejectedRecordCount = 0;
	for (let sourceOrdinal = 0; sourceOrdinal < source.records.length; sourceOrdinal++) {
		const candidate = source.records[sourceOrdinal];
		const code = transferPlanRowError(candidate, certifiedPortIds, recordIds);
		if (code) {
			rejectedRecordCount++;
			appendIssue(issues, sourceOrdinal, code);
			continue;
		}
		const row = candidate as unknown as SimulationTransferPlanEditorRow;
		recordIds.add(row.transferId);
		records.push(
			Object.freeze({
				sourceOrdinal,
				transferId: row.transferId,
				releaseTimeMicroseconds: row.releaseTimeMicroseconds,
				loadId: row.loadId,
				sourcePortId: row.sourcePortId,
				destinationPortId: row.destinationPortId,
			}),
		);
	}
	return compileSimulationTransferPlanManifest({
		...manifestHeader(source, rejectedRecordCount, issues),
		records,
	});
}

function adaptReplayHistory(
	certifiedPortIds: ReadonlySet<number>,
	source: SimulationReplayHistoryEditorSource,
): SimulationReplayHistoryManifest {
	const records: SimulationReplayHistoryRecord[] = [];
	const issues: SimulationScenarioRejectionIssue[] = [];
	const recordIds = new Set<string>();
	let rejectedRecordCount = 0;
	for (let sourceOrdinal = 0; sourceOrdinal < source.records.length; sourceOrdinal++) {
		const candidate = source.records[sourceOrdinal];
		const code = replayHistoryRowError(candidate, certifiedPortIds, recordIds);
		if (code) {
			rejectedRecordCount++;
			appendIssue(issues, sourceOrdinal, code);
			continue;
		}
		const row = candidate as unknown as SimulationReplayHistoryEditorRow;
		recordIds.add(row.historyEventId);
		records.push(
			Object.freeze({
				sourceOrdinal,
				historyEventId: row.historyEventId,
				observedTimeMicroseconds: row.observedTimeMicroseconds,
				loadId: row.loadId,
				sourcePortId: row.sourcePortId,
				destinationPortId: row.destinationPortId,
			}),
		);
	}
	return compileSimulationReplayHistoryManifest({
		...manifestHeader(source, rejectedRecordCount, issues),
		records,
	});
}

function transferPlanRowError(
	value: unknown,
	certifiedPortIds: ReadonlySet<number>,
	recordIds: ReadonlySet<string>,
): SimulationScenarioEditorRejectionCode | null {
	if (!isRecordWithExactKeys(value, TRANSFER_PLAN_ROW_KEYS)) return "MALFORMED_RECORD";
	return commonRowError(
		value.transferId,
		value.releaseTimeMicroseconds,
		value.loadId,
		value.sourcePortId,
		value.destinationPortId,
		certifiedPortIds,
		recordIds,
	);
}

function replayHistoryRowError(
	value: unknown,
	certifiedPortIds: ReadonlySet<number>,
	recordIds: ReadonlySet<string>,
): SimulationScenarioEditorRejectionCode | null {
	if (!isRecordWithExactKeys(value, REPLAY_HISTORY_ROW_KEYS)) return "MALFORMED_RECORD";
	return commonRowError(
		value.historyEventId,
		value.observedTimeMicroseconds,
		value.loadId,
		value.sourcePortId,
		value.destinationPortId,
		certifiedPortIds,
		recordIds,
	);
}

function commonRowError(
	recordId: unknown,
	timeMicroseconds: unknown,
	loadId: unknown,
	sourcePortId: unknown,
	destinationPortId: unknown,
	certifiedPortIds: ReadonlySet<number>,
	recordIds: ReadonlySet<string>,
): SimulationScenarioEditorRejectionCode | null {
	if (!isPortableIdentity(recordId)) return "INVALID_RECORD_ID";
	if (!Number.isSafeInteger(timeMicroseconds) || (timeMicroseconds as number) < 0) {
		return "INVALID_TIME";
	}
	if (!isPortableIdentity(loadId)) return "INVALID_LOAD_ID";
	if (
		!isPositiveRecordId(sourcePortId as number) ||
		!certifiedPortIds.has(sourcePortId as number)
	) {
		return "UNKNOWN_SOURCE_PORT";
	}
	if (
		!isPositiveRecordId(destinationPortId as number) ||
		!certifiedPortIds.has(destinationPortId as number)
	) {
		return "UNKNOWN_DESTINATION_PORT";
	}
	if (sourcePortId === destinationPortId) return "SAME_SOURCE_DESTINATION";
	if (recordIds.has(recordId)) return "DUPLICATE_RECORD_ID";
	return null;
}

function manifestHeader(
	source: SimulationScenarioEditorSource,
	rejectedRecordCount: number,
	issues: readonly SimulationScenarioRejectionIssue[],
) {
	return {
		manifestId: source.manifestId,
		adapterId: SIMULATION_SCENARIO_EDITOR_ADAPTER_ID,
		adapterVersion: SIMULATION_SCENARIO_EDITOR_ADAPTER_VERSION,
		mappingVersion: source.mappingVersion,
		inputRecordCount: source.records.length,
		rejectedRecordCount,
		rejectionIssues: Object.freeze([...issues]),
		issuesTruncated: rejectedRecordCount > SIMULATION_SCENARIO_MAX_REJECTION_ISSUES,
	};
}

function appendIssue(
	issues: SimulationScenarioRejectionIssue[],
	sourceOrdinal: number,
	code: SimulationScenarioEditorRejectionCode,
): void {
	if (issues.length >= SIMULATION_SCENARIO_MAX_REJECTION_ISSUES) return;
	issues.push(Object.freeze({ sourceOrdinal, code, message: REJECTION_MESSAGES[code] }));
}

function copyServiceTimingInput(
	input: SimulationScenarioServiceTimingInput,
): SimulationScenarioServiceTimingInput {
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
	input: SimulationScenarioResourceRunConfigurationInput,
): SimulationScenarioResourceRunConfigurationInput {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordWithExactKeys(
	value: unknown,
	expected: readonly string[],
): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
