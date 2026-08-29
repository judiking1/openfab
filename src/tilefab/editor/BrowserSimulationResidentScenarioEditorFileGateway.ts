import type { SimulationScenarioSourceKind } from "../compile/SimulationScenarioManifest";
import { chooseBrowserLocalScenarioFile } from "./BrowserLocalScenarioFileSelection";
import {
	decodeSimulationResidentScenarioEditorRunAssetFile,
	SIMULATION_RESIDENT_SCENARIO_EDITOR_MAX_FILE_BYTES,
	type SimulationResidentScenarioEditorRunAssetDraft,
} from "./SimulationResidentScenarioEditorRunAssetFile";

const RESIDENT_SCENARIO_FILE_TYPES = Object.freeze([
	Object.freeze({
		description: "OpenFab resident home-return scenario",
		accept: Object.freeze({
			"application/json": Object.freeze([".openfabresident", ".json"]),
		}),
	}),
]);
const RESIDENT_SCENARIO_INPUT_ACCEPT = ".openfabresident,.json,application/json";

export interface SimulationResidentScenarioEditorFileGateway {
	chooseOpen(
		expectedSourceKind: SimulationScenarioSourceKind,
		signal?: AbortSignal,
	): Promise<SimulationResidentScenarioEditorRunAssetDraft | null>;
}

export interface BrowserSimulationResidentScenarioEditorFileGatewayOptions {
	readonly forceFileInputFallback?: boolean;
}

/** Selects only the distinct public resident envelope and discards all browser file identity. */
export class BrowserSimulationResidentScenarioEditorFileGateway
	implements SimulationResidentScenarioEditorFileGateway
{
	private readonly forceFileInputFallback: boolean;

	constructor(options: BrowserSimulationResidentScenarioEditorFileGatewayOptions = {}) {
		this.forceFileInputFallback = options.forceFileInputFallback ?? false;
	}

	chooseOpen(
		expectedSourceKind: SimulationScenarioSourceKind,
		signal?: AbortSignal,
	): Promise<SimulationResidentScenarioEditorRunAssetDraft | null> {
		return chooseBrowserLocalScenarioFile(
			{
				fileTypes: RESIDENT_SCENARIO_FILE_TYPES,
				inputAccept: RESIDENT_SCENARIO_INPUT_ACCEPT,
				maximumByteLength: SIMULATION_RESIDENT_SCENARIO_EDITOR_MAX_FILE_BYTES,
				byteBudgetLabel: "16 MiB",
				decode: (bytes) =>
					decodeSimulationResidentScenarioEditorRunAssetFile(bytes, expectedSourceKind),
				forceFileInputFallback: this.forceFileInputFallback,
			},
			signal,
		);
	}
}
