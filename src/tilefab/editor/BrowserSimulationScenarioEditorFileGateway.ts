import type { SimulationScenarioSourceKind } from "../compile/SimulationScenarioManifest";
import { chooseBrowserLocalScenarioFile } from "./BrowserLocalScenarioFileSelection";
import {
	decodeSimulationScenarioEditorRunAssetFile,
	SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES,
	type SimulationScenarioEditorRunAssetDraft,
} from "./SimulationScenarioEditorRunAssetFile";

const SCENARIO_FILE_TYPES = Object.freeze([
	Object.freeze({
		description: "OpenFab simulation scenario",
		accept: Object.freeze({
			"application/json": Object.freeze([".openfabscenario", ".json"]),
		}),
	}),
]);
const SCENARIO_INPUT_ACCEPT = ".openfabscenario,.json,application/json";

export interface SimulationScenarioEditorFileGateway {
	chooseOpen(
		expectedSourceKind: SimulationScenarioSourceKind,
		signal?: AbortSignal,
	): Promise<SimulationScenarioEditorRunAssetDraft | null>;
}

export interface BrowserSimulationScenarioEditorFileGatewayOptions {
	readonly forceFileInputFallback?: boolean;
}

/** Browser-only local file adapter. No file name, handle, path, or raw byte buffer escapes it. */
export class BrowserSimulationScenarioEditorFileGateway
	implements SimulationScenarioEditorFileGateway
{
	private readonly forceFileInputFallback: boolean;

	constructor(options: BrowserSimulationScenarioEditorFileGatewayOptions = {}) {
		this.forceFileInputFallback = options.forceFileInputFallback ?? false;
	}

	chooseOpen(
		expectedSourceKind: SimulationScenarioSourceKind,
		signal?: AbortSignal,
	): Promise<SimulationScenarioEditorRunAssetDraft | null> {
		return chooseBrowserLocalScenarioFile(
			{
				fileTypes: SCENARIO_FILE_TYPES,
				inputAccept: SCENARIO_INPUT_ACCEPT,
				maximumByteLength: SIMULATION_SCENARIO_EDITOR_MAX_FILE_BYTES,
				byteBudgetLabel: "16 MiB",
				decode: (bytes) => decodeSimulationScenarioEditorRunAssetFile(bytes, expectedSourceKind),
				forceFileInputFallback: this.forceFileInputFallback,
			},
			signal,
		);
	}
}
