import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "../compile/SimulationReadinessCertificate";
import {
	compileSimulationScenarioAdmissionProgram,
	simulationScenarioAdmissionProgramMatchesValidatedSources,
	simulationScenarioAdmissionProgramTransfers,
} from "../compile/SimulationScenarioAdmissionProgram";
import {
	compileSimulationScenarioLeaseClaims,
	simulationScenarioLeaseClaimsMatchValidatedSources,
	simulationScenarioLeaseClaimTransfers,
} from "../compile/SimulationScenarioLeaseClaims";
import {
	SIMULATION_SCENARIO_SOURCE_KINDS,
	type SimulationScenarioManifest,
	type SimulationScenarioSourceKind,
	simulationScenarioManifestError,
} from "../compile/SimulationScenarioManifest";
import {
	checksumSimulationScenarioResourceRunConfigurationInput,
	compileSimulationScenarioResourceRunConfiguration,
	type SimulationScenarioResourceRunConfigurationInput,
	simulationScenarioResourceRunConfigurationMatchesValidatedSources,
	simulationScenarioResourceRunConfigurationTransfers,
} from "../compile/SimulationScenarioResourceRunConfiguration";
import {
	compileSimulationScenarioRouteRequests,
	SimulationScenarioRouteCompilationCancelledError,
	type SimulationScenarioRouteCompilationOptions,
	simulationScenarioRouteRequestsMatchValidatedSources,
	simulationScenarioRouteRequestTransfers,
} from "../compile/SimulationScenarioRouteRequests";
import {
	checksumSimulationScenarioServiceTimingInput,
	compileSimulationScenarioServiceTiming,
	type SimulationScenarioServiceTimingInput,
	simulationScenarioServiceTimingMatchesValidatedSources,
	simulationScenarioServiceTimingTransfers,
} from "../compile/SimulationScenarioServiceTiming";
import {
	SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationScenarioPreparationWorkerErrorCode,
	type SimulationScenarioPreparationWorkerResponse,
} from "./SimulationScenarioPreparationWorkerProtocol";

const MAX_ERROR_MESSAGE_LENGTH = 240;
const REQUEST_KEYS = Object.freeze([
	"type",
	"protocolVersion",
	"requestId",
	"generation",
	"sourceKind",
	"snapshot",
	"manifest",
	"serviceTimingInput",
	"resourceRunInput",
] as const);

export async function prepareSimulationScenarioWorkerRequest(
	value: unknown,
	options: SimulationScenarioRouteCompilationOptions = {},
): Promise<SimulationScenarioPreparationWorkerResponse> {
	const correlation = requestCorrelation(value);
	if (!isRecord(value) || !validRequestEnvelope(value)) {
		return rejected(
			correlation,
			"MALFORMED_REQUEST",
			"Scenario preparation Worker request is malformed.",
		);
	}
	const snapshotError = publishedSimulationReadinessSnapshotError(value.snapshot);
	if (snapshotError) return rejected(correlation, "INVALID_SNAPSHOT", snapshotError);
	const manifestError = simulationScenarioManifestError(value.manifest);
	if (manifestError) return rejected(correlation, "INVALID_MANIFEST", manifestError);
	const manifest = value.manifest;
	if (value.sourceKind !== manifest.sourceKind) {
		return rejected(
			correlation,
			"SOURCE_KIND_MISMATCH",
			"Scenario source kind does not match the canonical manifest.",
		);
	}
	try {
		// These artifacts are created and consumed inside this uninterrupted Worker request. Their
		// compilers already validated every input and emitted canonical checksummed columns, so this
		// same-call audit checks cross-source semantics and exact input fingerprints without repeating
		// whole-artifact checksum walks. The receiving Bridge independently performs full validation
		// after structured-clone transfer before any artifact can be adopted.
		const routes = await compileSimulationScenarioRouteRequests(value.snapshot, manifest, options);
		if (!simulationScenarioRouteRequestsMatchValidatedSources(value.snapshot, manifest, routes)) {
			return rejected(
				correlation,
				"SOURCE_BINDING_MISMATCH",
				"Prepared routes do not match the exact scenario sources.",
			);
		}
		const leaseClaims = compileSimulationScenarioLeaseClaims(value.snapshot, manifest, routes);
		if (!simulationScenarioLeaseClaimsMatchValidatedSources(value.snapshot, routes, leaseClaims)) {
			return rejected(
				correlation,
				"SOURCE_BINDING_MISMATCH",
				"Prepared lease claims do not match the exact scenario sources.",
			);
		}
		const admissionProgram = compileSimulationScenarioAdmissionProgram(
			value.snapshot,
			manifest,
			routes,
			leaseClaims,
		);
		if (
			!simulationScenarioAdmissionProgramMatchesValidatedSources(
				value.snapshot,
				manifest,
				routes,
				leaseClaims,
				admissionProgram,
			)
		) {
			return rejected(
				correlation,
				"SOURCE_BINDING_MISMATCH",
				"Prepared admission program does not match the exact scenario sources.",
			);
		}
		const serviceTiming = compileSimulationScenarioServiceTiming(
			value.snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			value.serviceTimingInput,
		);
		if (
			!simulationScenarioServiceTimingMatchesValidatedSources(
				value.snapshot,
				manifest,
				routes,
				leaseClaims,
				admissionProgram,
				serviceTiming,
			) ||
			serviceTiming.sourceTimingInputFingerprint !==
				checksumSimulationScenarioServiceTimingInput(manifest, value.serviceTimingInput)
		) {
			return rejected(
				correlation,
				"SOURCE_BINDING_MISMATCH",
				"Prepared service timing does not match the exact scenario sources.",
			);
		}
		const resourceRunConfiguration = compileSimulationScenarioResourceRunConfiguration(
			value.snapshot,
			manifest,
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
			value.resourceRunInput,
		);
		if (
			!simulationScenarioResourceRunConfigurationMatchesValidatedSources(
				value.snapshot,
				manifest,
				routes,
				leaseClaims,
				admissionProgram,
				serviceTiming,
				resourceRunConfiguration,
			) ||
			resourceRunConfiguration.sourceResourceInputFingerprint !==
				checksumSimulationScenarioResourceRunConfigurationInput(manifest, value.resourceRunInput)
		) {
			return rejected(
				correlation,
				"SOURCE_BINDING_MISMATCH",
				"Prepared resource run configuration does not match the exact scenario sources.",
			);
		}
		return Object.freeze({
			type: "SIMULATION_SCENARIO_PREPARED" as const,
			protocolVersion: SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
			requestId: correlation.requestId,
			generation: correlation.generation,
			sourceKind: manifest.sourceKind,
			routes,
			leaseClaims,
			admissionProgram,
			serviceTiming,
			resourceRunConfiguration,
		});
	} catch (error) {
		return rejected(correlation, classifyPreparationError(error), errorMessage(error));
	}
}

export function collectSimulationScenarioPreparationResponseTransferBuffers(
	response: SimulationScenarioPreparationWorkerResponse,
): readonly ArrayBuffer[] {
	return response.type === "SIMULATION_SCENARIO_PREPARED"
		? [
				...simulationScenarioRouteRequestTransfers(response.routes),
				...simulationScenarioLeaseClaimTransfers(response.leaseClaims),
				...simulationScenarioAdmissionProgramTransfers(response.admissionProgram),
				...simulationScenarioServiceTimingTransfers(response.serviceTiming),
				...simulationScenarioResourceRunConfigurationTransfers(response.resourceRunConfiguration),
			]
		: [];
}

function validRequestEnvelope(value: Record<string, unknown>): value is {
	readonly type: "PREPARE_SIMULATION_SCENARIO";
	readonly protocolVersion: typeof SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION;
	readonly requestId: number;
	readonly generation: number;
	readonly sourceKind: SimulationScenarioSourceKind;
	readonly snapshot: PublishedSimulationReadinessSnapshot;
	readonly manifest: SimulationScenarioManifest;
	readonly serviceTimingInput: SimulationScenarioServiceTimingInput;
	readonly resourceRunInput: SimulationScenarioResourceRunConfigurationInput;
} {
	return (
		hasExactKeys(value, REQUEST_KEYS) &&
		value.type === "PREPARE_SIMULATION_SCENARIO" &&
		value.protocolVersion === SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION &&
		isPositiveSafeInteger(value.requestId) &&
		isNonNegativeSafeInteger(value.generation) &&
		isSourceKind(value.sourceKind) &&
		isRecord(value.snapshot) &&
		isRecord(value.manifest) &&
		isRecord(value.serviceTimingInput) &&
		isRecord(value.resourceRunInput)
	);
}

function requestCorrelation(value: unknown): {
	readonly requestId: number;
	readonly generation: number;
	readonly sourceKind: SimulationScenarioSourceKind | "UNKNOWN";
} {
	if (!isRecord(value)) return { requestId: 0, generation: 0, sourceKind: "UNKNOWN" };
	return {
		requestId: isPositiveSafeInteger(value.requestId) ? value.requestId : 0,
		generation: isNonNegativeSafeInteger(value.generation) ? value.generation : 0,
		sourceKind: isSourceKind(value.sourceKind) ? value.sourceKind : "UNKNOWN",
	};
}

function rejected(
	correlation: ReturnType<typeof requestCorrelation>,
	code: SimulationScenarioPreparationWorkerErrorCode,
	message: string,
): SimulationScenarioPreparationWorkerResponse {
	return Object.freeze({
		type: "SIMULATION_SCENARIO_PREPARATION_REJECTED" as const,
		protocolVersion: SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
		requestId: correlation.requestId,
		generation: correlation.generation,
		sourceKind: correlation.sourceKind,
		code,
		message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
	});
}

function classifyPreparationError(error: unknown): SimulationScenarioPreparationWorkerErrorCode {
	if (error instanceof SimulationScenarioRouteCompilationCancelledError) {
		return "PREPARATION_CANCELLED";
	}
	if (error instanceof RangeError && /lease claims/i.test(error.message)) {
		return "LEASE_LIMIT_EXCEEDED";
	}
	if (error instanceof RangeError && error.message.includes("limit")) {
		return "ROUTE_LIMIT_EXCEEDED";
	}
	if (
		error instanceof Error &&
		/does not continue from its previous destination port/i.test(error.message)
	) {
		return "CUSTODY_CHAIN_REJECTED";
	}
	if (
		error instanceof Error &&
		/(resource run|EQ resource|EQ concurrent|EQ availability|initial storage|storage inventory|storage-resident|named loads)/i.test(
			error.message,
		)
	) {
		return "RESOURCE_RUN_CONFIGURATION_REJECTED";
	}
	if (
		error instanceof Error &&
		/(service timing|process timing|process duration|qualified at its destination|storage destination|certified policy)/i.test(
			error.message,
		)
	) {
		return "SERVICE_TIMING_REJECTED";
	}
	if (
		error instanceof Error &&
		(/explicit (predecessor|continuation)/i.test(error.message) ||
			/switch-conflict|movement/i.test(error.message) ||
			/extended path|lease extension/i.test(error.message))
	) {
		return "LEASE_REJECTED";
	}
	if (
		error instanceof Error &&
		(/outside the certificate/i.test(error.message) ||
			/explicit (pickup|dropoff) capability/i.test(error.message) ||
			/no directed route/i.test(error.message))
	) {
		return "ROUTE_REJECTED";
	}
	return "INTERNAL_FAILURE";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Scenario preparation failed internally.";
}

function isSourceKind(value: unknown): value is SimulationScenarioSourceKind {
	return (
		typeof value === "string" &&
		SIMULATION_SCENARIO_SOURCE_KINDS.includes(value as SimulationScenarioSourceKind)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}
