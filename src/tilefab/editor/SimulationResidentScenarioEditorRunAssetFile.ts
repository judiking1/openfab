import type { SimulationResidentCycleResourceRunConfigurationInput } from "../compile/SimulationResidentCycleResourceRunConfiguration";
import type { SimulationResidentCycleServiceTimingInput } from "../compile/SimulationResidentCycleServiceTiming";
import type { SimulationScenarioSourceKind } from "../compile/SimulationScenarioManifest";
import type { SimulationResidentScenarioEditorSource } from "./SimulationResidentScenarioEditorSourceAdapter";
import {
	parseSimulationScenarioEditorRunAsset,
	SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES,
} from "./SimulationScenarioEditorRunAssetFile";

export const SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_SCHEMA_VERSION = 1 as const;
export const SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID =
	"OPENFAB_RESIDENT_HOME_RETURN_SCENARIO_FILE_V1" as const;
export const SIMULATION_RESIDENT_SCENARIO_EDITOR_MAX_FILE_BYTES =
	SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES;

const FILE_KEYS = Object.freeze([
	"schemaVersion",
	"profileId",
	"source",
	"serviceTimingInput",
	"resourceRunInput",
] as const);

export interface SimulationResidentScenarioEditorRunAssetDraft {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_SCHEMA_VERSION;
	readonly profileId: typeof SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID;
	readonly source: SimulationResidentScenarioEditorSource;
	readonly serviceTimingInput: SimulationResidentCycleServiceTimingInput;
	readonly resourceRunInput: SimulationResidentCycleResourceRunConfigurationInput;
}

/** Decodes the distinct public resident envelope without retaining file identity or raw bytes. */
export function decodeSimulationResidentScenarioEditorRunAssetFile(
	bytes: ArrayBuffer,
	expectedSourceKind: SimulationScenarioSourceKind,
): SimulationResidentScenarioEditorRunAssetDraft {
	assertByteLength(bytes.byteLength);
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("Resident scenario file is not valid UTF-8.");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		throw new Error("Resident scenario file is not valid JSON.");
	}
	return parseSimulationResidentScenarioEditorRunAsset(parsed, expectedSourceKind);
}

export function parseSimulationResidentScenarioEditorRunAsset(
	value: unknown,
	expectedSourceKind: SimulationScenarioSourceKind,
): SimulationResidentScenarioEditorRunAssetDraft {
	if (!isRecordWithExactKeys(value, FILE_KEYS)) {
		throw new Error("Resident scenario envelope contains missing or unexpected fields.");
	}
	if (value.schemaVersion !== SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_SCHEMA_VERSION) {
		throw new Error("Resident scenario file schema version is unsupported.");
	}
	if (value.profileId !== SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID) {
		throw new Error("Resident scenario file profile is unsupported.");
	}
	const shared = parseSimulationScenarioEditorRunAsset(
		{
			schemaVersion: value.schemaVersion,
			source: value.source,
			serviceTimingInput: value.serviceTimingInput,
			resourceRunInput: value.resourceRunInput,
		},
		expectedSourceKind,
	);
	return Object.freeze({
		schemaVersion: SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_SCHEMA_VERSION,
		profileId: SIMULATION_RESIDENT_SCENARIO_EDITOR_FILE_PROFILE_ID,
		source: shared.source as SimulationResidentScenarioEditorSource,
		serviceTimingInput: shared.serviceTimingInput,
		resourceRunInput: shared.resourceRunInput,
	});
}

function assertByteLength(byteLength: number): void {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new TypeError("Resident scenario file size must be a non-negative safe integer.");
	}
	if (byteLength > SIMULATION_RESIDENT_SCENARIO_EDITOR_MAX_FILE_BYTES) {
		throw new RangeError("Resident scenario file exceeds the 16 MiB byte budget.");
	}
}

function isRecordWithExactKeys(
	value: unknown,
	expected: readonly string[],
): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
