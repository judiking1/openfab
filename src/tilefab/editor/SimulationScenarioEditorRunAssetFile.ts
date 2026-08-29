import {
	SIMULATION_SCENARIO_MAX_INPUT_RECORDS,
	type SimulationScenarioSourceKind,
} from "../compile/SimulationScenarioManifest";
import type { SimulationScenarioResourceRunConfigurationInput } from "../compile/SimulationScenarioResourceRunConfiguration";
import type { SimulationScenarioServiceTimingInput } from "../compile/SimulationScenarioServiceTiming";
import type { SimulationScenarioEditorSource } from "./SimulationScenarioEditorSourceAdapter";

export const SIMULATION_SCENARIO_EDITOR_FILE_SCHEMA_VERSION = 1 as const;
export const SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES = 16 * 1_024 * 1_024;

const FILE_KEYS = Object.freeze([
	"schemaVersion",
	"source",
	"serviceTimingInput",
	"resourceRunInput",
] as const);
const SOURCE_KEYS = Object.freeze([
	"sourceKind",
	"manifestId",
	"mappingVersion",
	"records",
] as const);
const SERVICE_TIMING_KEYS = Object.freeze(["eqProcessTimings"] as const);
const EQ_TIMING_KEYS = Object.freeze([
	"sourceOrdinal",
	"capabilityId",
	"processingDurationMicroseconds",
] as const);
const RESOURCE_KEYS = Object.freeze(["eqResources", "initialStorageLoads"] as const);
const EQ_RESOURCE_KEYS = Object.freeze([
	"equipmentGroupId",
	"concurrentCapacity",
	"availabilityMode",
	"availabilityWindows",
] as const);
const AVAILABILITY_WINDOW_KEYS = Object.freeze(["startMicroseconds", "endMicroseconds"] as const);
const INITIAL_STORAGE_LOAD_KEYS = Object.freeze(["loadId", "equipmentGroupId"] as const);

export interface SimulationScenarioEditorRunAssetDraft {
	readonly schemaVersion: typeof SIMULATION_SCENARIO_EDITOR_FILE_SCHEMA_VERSION;
	readonly source: SimulationScenarioEditorSource;
	readonly serviceTimingInput: SimulationScenarioServiceTimingInput;
	readonly resourceRunInput: SimulationScenarioResourceRunConfigurationInput;
}

/**
 * Decodes a bounded, public OpenFab scenario envelope. The local file name and browser file handle
 * are intentionally absent from the result, and every configuration row is copied into the exact
 * public shape before the draft can reach the editor controller.
 */
export function decodeSimulationScenarioEditorRunAssetFile(
	bytes: ArrayBuffer,
	expectedSourceKind: SimulationScenarioSourceKind,
): SimulationScenarioEditorRunAssetDraft {
	assertByteLength(bytes.byteLength);
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("Scenario file is not valid UTF-8.");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		throw new Error("Scenario file is not valid JSON.");
	}
	return parseSimulationScenarioEditorRunAsset(parsed, expectedSourceKind);
}

export function parseSimulationScenarioEditorRunAsset(
	value: unknown,
	expectedSourceKind: SimulationScenarioSourceKind,
): SimulationScenarioEditorRunAssetDraft {
	if (!isRecordWithExactKeys(value, FILE_KEYS)) {
		throw new Error("Scenario file envelope contains missing or unexpected fields.");
	}
	if (value.schemaVersion !== SIMULATION_SCENARIO_EDITOR_FILE_SCHEMA_VERSION) {
		throw new Error("Scenario file schema version is unsupported.");
	}
	const source = parseSource(value.source, expectedSourceKind);
	const serviceTimingInput = parseServiceTimingInput(value.serviceTimingInput);
	const resourceRunInput = parseResourceRunInput(value.resourceRunInput);
	return Object.freeze({
		schemaVersion: SIMULATION_SCENARIO_EDITOR_FILE_SCHEMA_VERSION,
		source,
		serviceTimingInput,
		resourceRunInput,
	});
}

function parseSource(
	value: unknown,
	expectedSourceKind: SimulationScenarioSourceKind,
): SimulationScenarioEditorSource {
	if (!isRecordWithExactKeys(value, SOURCE_KEYS)) {
		throw new Error("Scenario source header contains missing or unexpected fields.");
	}
	if (value.sourceKind !== expectedSourceKind) {
		throw new Error(
			`Scenario source kind does not match the ${sourceKindLabel(expectedSourceKind)} workflow.`,
		);
	}
	if (!isPortableIdentity(value.manifestId)) {
		throw new Error("Scenario manifest identity is invalid.");
	}
	if (!Number.isSafeInteger(value.mappingVersion) || (value.mappingVersion as number) <= 0) {
		throw new Error("Scenario mapping version is invalid.");
	}
	if (!Array.isArray(value.records)) {
		throw new Error("Scenario source records must be an array.");
	}
	assertBoundedCount(value.records.length, "source records");
	const records = Object.freeze(
		value.records.map((record) => (isRecord(record) ? Object.freeze({ ...record }) : record)),
	);
	return Object.freeze({
		sourceKind: expectedSourceKind,
		manifestId: value.manifestId,
		mappingVersion: value.mappingVersion as number,
		records,
	});
}

function parseServiceTimingInput(value: unknown): SimulationScenarioServiceTimingInput {
	if (!isRecordWithExactKeys(value, SERVICE_TIMING_KEYS)) {
		throw new Error("Scenario service timing input is malformed.");
	}
	if (!Array.isArray(value.eqProcessTimings)) {
		throw new Error("Scenario EQ process timings must be an array.");
	}
	assertBoundedCount(value.eqProcessTimings.length, "EQ process timings");
	return Object.freeze({
		eqProcessTimings: Object.freeze(
			value.eqProcessTimings.map((record) => {
				if (!isRecordWithExactKeys(record, EQ_TIMING_KEYS)) {
					throw new Error("Scenario EQ process timing record is malformed.");
				}
				return Object.freeze({
					sourceOrdinal: requireNumber(record.sourceOrdinal, "source ordinal"),
					capabilityId: requireNumber(record.capabilityId, "capability ID"),
					processingDurationMicroseconds: requireNumber(
						record.processingDurationMicroseconds,
						"processing duration",
					),
				});
			}),
		),
	});
}

function parseResourceRunInput(value: unknown): SimulationScenarioResourceRunConfigurationInput {
	if (!isRecordWithExactKeys(value, RESOURCE_KEYS)) {
		throw new Error("Scenario resource run input is malformed.");
	}
	if (!Array.isArray(value.eqResources) || !Array.isArray(value.initialStorageLoads)) {
		throw new Error("Scenario resource run input arrays are invalid.");
	}
	assertBoundedCount(value.eqResources.length, "EQ resources");
	assertBoundedCount(value.initialStorageLoads.length, "initial storage loads");
	let availabilityWindowCount = 0;
	const eqResources = value.eqResources.map((resource) => {
		if (!isRecordWithExactKeys(resource, EQ_RESOURCE_KEYS)) {
			throw new Error("Scenario EQ resource record is malformed.");
		}
		if (!Array.isArray(resource.availabilityWindows)) {
			throw new Error("Scenario EQ availability windows must be an array.");
		}
		availabilityWindowCount += resource.availabilityWindows.length;
		assertBoundedCount(availabilityWindowCount, "EQ availability windows");
		const availabilityMode = resource.availabilityMode;
		if (availabilityMode !== "ALWAYS" && availabilityMode !== "WINDOWS") {
			throw new Error("Scenario EQ availability mode is invalid.");
		}
		return Object.freeze({
			equipmentGroupId: requireNumber(resource.equipmentGroupId, "equipment group ID"),
			concurrentCapacity: requireNumber(resource.concurrentCapacity, "concurrent capacity"),
			availabilityMode,
			availabilityWindows: Object.freeze(
				resource.availabilityWindows.map((window) => {
					if (!isRecordWithExactKeys(window, AVAILABILITY_WINDOW_KEYS)) {
						throw new Error("Scenario EQ availability window is malformed.");
					}
					return Object.freeze({
						startMicroseconds: requireNumber(window.startMicroseconds, "window start"),
						endMicroseconds: requireNumber(window.endMicroseconds, "window end"),
					});
				}),
			),
		});
	});
	const initialStorageLoads = value.initialStorageLoads.map((load) => {
		if (!isRecordWithExactKeys(load, INITIAL_STORAGE_LOAD_KEYS)) {
			throw new Error("Scenario initial storage load record is malformed.");
		}
		if (typeof load.loadId !== "string") {
			throw new Error("Scenario initial storage load identity is invalid.");
		}
		return Object.freeze({
			loadId: load.loadId,
			equipmentGroupId: requireNumber(load.equipmentGroupId, "storage equipment group ID"),
		});
	});
	return Object.freeze({
		eqResources: Object.freeze(eqResources),
		initialStorageLoads: Object.freeze(initialStorageLoads),
	});
}

function assertByteLength(byteLength: number): void {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new TypeError("Scenario file size must be a non-negative safe integer.");
	}
	if (byteLength > SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES) {
		throw new RangeError("Scenario file exceeds the 16 MiB byte budget.");
	}
}

function assertBoundedCount(count: number, label: string): void {
	if (!Number.isSafeInteger(count) || count < 0 || count > SIMULATION_SCENARIO_MAX_INPUT_RECORDS) {
		throw new RangeError(`Scenario ${label} exceed the public run-asset limit.`);
	}
}

function requireNumber(value: unknown, label: string): number {
	if (typeof value !== "number") throw new Error(`Scenario ${label} is invalid.`);
	return value;
}

function sourceKindLabel(kind: SimulationScenarioSourceKind): string {
	return kind === "TRANSFER_PLAN" ? "Transfer Plan" : "Replay History";
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
