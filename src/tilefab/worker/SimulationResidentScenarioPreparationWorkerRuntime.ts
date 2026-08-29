import { compileSimulationResidentCycleAdmissionProgram } from "../compile/SimulationResidentCycleAdmissionProgram";
import { compileSimulationResidentCycleLeaseClaims } from "../compile/SimulationResidentCycleLeaseClaims";
import {
	checksumSimulationResidentCycleResourceRunConfigurationInput,
	compileSimulationResidentCycleResourceRunConfiguration,
} from "../compile/SimulationResidentCycleResourceRunConfiguration";
import { compileSimulationResidentCycleRoutes } from "../compile/SimulationResidentCycleRoutes";
import {
	checksumSimulationResidentCycleServiceTimingInput,
	compileSimulationResidentCycleServiceTiming,
} from "../compile/SimulationResidentCycleServiceTiming";
import { publishSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import {
	SIMULATION_RESIDENT_EDITOR_RUN_ASSET_SCHEMA_VERSION,
	simulationResidentScenarioEditorRunAssetError,
} from "../editor/SimulationResidentScenarioEditorSourceAdapter";
import {
	type PrepareSimulationResidentScenarioWorkerRequest,
	SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationResidentScenarioPreparationWorkerErrorCode,
	type SimulationResidentScenarioPreparationWorkerResponse,
	simulationResidentScenarioPreparationWorkerRequestError,
} from "./SimulationResidentScenarioPreparationWorkerProtocol";

const MAX_ERROR_MESSAGE_LENGTH = 240;

export async function prepareSimulationResidentScenarioWorkerRequest(
	value: unknown,
): Promise<SimulationResidentScenarioPreparationWorkerResponse> {
	const correlation = requestCorrelation(value);
	const error = simulationResidentScenarioPreparationWorkerRequestError(value);
	if (error) {
		return rejected(
			correlation,
			error.includes("envelope") || error.includes("must be an object")
				? "MALFORMED_REQUEST"
				: "INVALID_SOURCE",
			error,
		);
	}
	const request = value as PrepareSimulationResidentScenarioWorkerRequest;
	try {
		return await prepareValidatedRequest(request);
	} catch (caught) {
		return rejected(
			correlation,
			"PREPARATION_FAILED",
			caught instanceof Error ? caught.message : "Resident scenario preparation failed.",
		);
	}
}

async function prepareValidatedRequest(
	request: PrepareSimulationResidentScenarioWorkerRequest,
): Promise<SimulationResidentScenarioPreparationWorkerResponse> {
	const { components, parking, manifest } = request;
	const runAssetError = simulationResidentScenarioEditorRunAssetError({
		schemaVersion: SIMULATION_RESIDENT_EDITOR_RUN_ASSET_SCHEMA_VERSION,
		parking,
		manifest,
		serviceTimingInput: request.serviceTimingInput,
		resourceRunInput: request.resourceRunInput,
		serviceTimingInputFingerprint: request.serviceTimingInputFingerprint,
		resourceRunInputFingerprint: request.resourceRunInputFingerprint,
		fingerprint: request.runAssetFingerprint,
	});
	if (runAssetError) {
		throw new Error(`Resident preparation run asset is invalid: ${runAssetError}`);
	}
	if (
		parking.sourceFoundationFingerprint !== components.foundation.fingerprint ||
		parking.sourceTrackResourceTopologyFingerprint !== components.trackResources.fingerprint ||
		parking.sourceOccupancyPolicyFingerprint !== components.occupancyPolicy.fingerprint ||
		parking.sourceOperationalConfigurationFingerprint !==
			manifest.sourceOperationalConfigurationFingerprint ||
		parking.sourceOperationalReviewRevision !== manifest.sourceOperationalReviewRevision ||
		parking.sourceOperationalReviewAuthoredChecksum !==
			manifest.sourceOperationalReviewAuthoredChecksum
	) {
		throw new Error(
			"Resident preparation sources do not share one exact static and operational identity.",
		);
	}
	if (
		checksumSimulationResidentCycleServiceTimingInput(manifest, request.serviceTimingInput) !==
			request.serviceTimingInputFingerprint ||
		checksumSimulationResidentCycleResourceRunConfigurationInput(
			manifest,
			request.resourceRunInput,
		) !== request.resourceRunInputFingerprint
	) {
		throw new Error("Resident preparation explicit input fingerprint does not match.");
	}
	const routes = await compileSimulationResidentCycleRoutes(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.stationCapabilities,
		manifest,
		parking,
	);
	const leaseClaims = compileSimulationResidentCycleLeaseClaims(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		parking,
		routes,
	);
	const admissionProgram = compileSimulationResidentCycleAdmissionProgram(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		manifest,
		parking,
		routes,
		leaseClaims,
	);
	const serviceTiming = compileSimulationResidentCycleServiceTiming(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		request.serviceTimingInput,
	);
	const resourceRunConfiguration = compileSimulationResidentCycleResourceRunConfiguration(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		request.resourceRunInput,
	);
	const published = await publishSimulationResidentReadinessSnapshot({
		...components,
		parking,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourceRunConfiguration,
	});
	return Object.freeze({
		type: "SIMULATION_RESIDENT_SCENARIO_PREPARED" as const,
		protocolVersion: SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
		requestId: request.requestId,
		generation: request.generation,
		runAssetFingerprint: request.runAssetFingerprint,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourceRunConfiguration,
		certificate: published.certificate,
	});
}

function requestCorrelation(value: unknown): {
	readonly requestId: number;
	readonly generation: number;
} {
	if (!isRecord(value)) return { requestId: 0, generation: 0 };
	return {
		requestId: isPositiveSafeInteger(value.requestId) ? (value.requestId as number) : 0,
		generation: isNonNegativeSafeInteger(value.generation) ? (value.generation as number) : 0,
	};
}

function rejected(
	correlation: { readonly requestId: number; readonly generation: number },
	code: SimulationResidentScenarioPreparationWorkerErrorCode,
	message: string,
): SimulationResidentScenarioPreparationWorkerResponse {
	return Object.freeze({
		type: "SIMULATION_RESIDENT_SCENARIO_PREPARATION_REJECTED" as const,
		protocolVersion: SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
		requestId: correlation.requestId,
		generation: correlation.generation,
		code,
		message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}
