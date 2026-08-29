import {
	type SimulationReadinessComponents,
	simulationReadinessComponentsError,
} from "../compile/SimulationReadinessCertificate";
import { simulationResidentCycleAdmissionProgramTransfers } from "../compile/SimulationResidentCycleAdmissionProgram";
import { simulationResidentCycleLeaseClaimTransfers } from "../compile/SimulationResidentCycleLeaseClaims";
import { simulationResidentCycleResourceRunConfigurationTransfers } from "../compile/SimulationResidentCycleResourceRunConfiguration";
import { simulationResidentCycleRouteTransfers } from "../compile/SimulationResidentCycleRoutes";
import { simulationResidentCycleServiceTimingTransfers } from "../compile/SimulationResidentCycleServiceTiming";
import {
	type PublishedSimulationResidentReadinessSnapshot,
	simulationResidentReadinessCertificateMatchesSources,
	simulationResidentReadinessSourcesError,
} from "../compile/SimulationResidentReadinessCertificate";
import {
	SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationResidentScenarioPreparationWorkerRequest,
	type SimulationResidentScenarioPreparationWorkerResponse,
	simulationResidentScenarioPreparationWorkerResponseError,
} from "../worker/SimulationResidentScenarioPreparationWorkerProtocol";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import type { SimulationResidentScenarioEditorRunAsset } from "./SimulationResidentScenarioEditorSourceAdapter";
import { simulationResidentScenarioEditorRunAssetError } from "./SimulationResidentScenarioEditorSourceAdapter";
import type { SimulationResidentScenarioPreparationPort } from "./SimulationResidentScenarioSession";

export interface SimulationResidentScenarioPreparationWorkerPort {
	onmessage:
		| ((event: MessageEvent<SimulationResidentScenarioPreparationWorkerResponse>) => void)
		| null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(
		message: SimulationResidentScenarioPreparationWorkerRequest,
		transfer?: Transferable[],
	): void;
	terminate(): void;
}

/** Transfers owned source copies to one disposable Worker and adopts only exact derived artifacts. */
export class SimulationResidentScenarioPreparationBridge
	implements SimulationResidentScenarioPreparationPort
{
	private readonly createWorker: () => SimulationResidentScenarioPreparationWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: SimulationResidentScenarioPreparationWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => SimulationResidentScenarioPreparationWorkerPort = () =>
			new Worker(
				new URL("../worker/simulationResidentScenarioPreparationWorker.ts", import.meta.url),
				{ type: "module" },
			) as SimulationResidentScenarioPreparationWorkerPort,
		timeoutMilliseconds = 120_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(
		components: SimulationReadinessComponents,
		runAsset: SimulationResidentScenarioEditorRunAsset,
		generation: number,
	): Promise<PublishedSimulationResidentReadinessSnapshot> {
		this.cancel();
		const assetError = simulationResidentScenarioEditorRunAssetError(runAsset);
		if (assetError) {
			return Promise.reject(new Error(`Resident preparation run asset is invalid: ${assetError}`));
		}
		const canonicalComponents = exactReadinessComponents(components);
		const componentError = simulationReadinessComponentsError(canonicalComponents);
		if (componentError) {
			return Promise.reject(
				new Error(`Resident preparation static components are invalid: ${componentError}`),
			);
		}
		if (!Number.isSafeInteger(generation) || generation < 0) {
			return Promise.reject(new RangeError("Resident preparation generation is invalid."));
		}
		let owned: Omit<
			SimulationResidentScenarioPreparationWorkerRequest,
			"type" | "protocolVersion" | "requestId" | "generation"
		>;
		try {
			owned = structuredClone({
				runAssetFingerprint: runAsset.fingerprint,
				serviceTimingInputFingerprint: runAsset.serviceTimingInputFingerprint,
				resourceRunInputFingerprint: runAsset.resourceRunInputFingerprint,
				components: canonicalComponents,
				parking: runAsset.parking,
				manifest: runAsset.manifest,
				serviceTimingInput: runAsset.serviceTimingInput,
				resourceRunInput: runAsset.resourceRunInput,
			});
		} catch (error) {
			return Promise.reject(normalizeError(error, "Resident preparation source capture failed."));
		}
		const requestId = this.issueRequestId();
		const request: SimulationResidentScenarioPreparationWorkerRequest = {
			type: "PREPARE_SIMULATION_RESIDENT_SCENARIO",
			protocolVersion: SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
			requestId,
			generation,
			...owned,
		};
		return new Promise((resolve, reject) => {
			let worker: SimulationResidentScenarioPreparationWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				reject(normalizeError(error, "Resident preparation Worker creation failed."));
				return;
			}
			this.worker = worker;
			this.reject = reject;
			const fail = (error: Error): void => {
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				reject(error);
			};
			worker.onmessage = (event) => {
				const response = event.data;
				const responseError = simulationResidentScenarioPreparationWorkerResponseError(response);
				if (responseError) {
					fail(new Error(`Resident preparation Worker response is invalid: ${responseError}`));
					return;
				}
				if (
					response.requestId !== requestId ||
					response.generation !== generation ||
					response.protocolVersion !==
						SIMULATION_RESIDENT_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION
				) {
					fail(new Error("Resident preparation Worker returned stale correlation."));
					return;
				}
				if (response.type === "SIMULATION_RESIDENT_SCENARIO_PREPARATION_REJECTED") {
					fail(new Error(response.message || `Resident preparation rejected: ${response.code}.`));
					return;
				}
				if (response.runAssetFingerprint !== runAsset.fingerprint) {
					fail(new Error("Resident preparation Worker returned a foreign run asset."));
					return;
				}
				const sources = {
					...canonicalComponents,
					parking: runAsset.parking,
					manifest: runAsset.manifest,
					routes: response.routes,
					leaseClaims: response.leaseClaims,
					admissionProgram: response.admissionProgram,
					serviceTiming: response.serviceTiming,
					resourceRunConfiguration: response.resourceRunConfiguration,
				};
				const sourceError = simulationResidentReadinessSourcesError(sources);
				if (
					sourceError ||
					!simulationResidentReadinessCertificateMatchesSources(response.certificate, sources) ||
					!derivedArtifactBuffersAreDistinct(response)
				) {
					fail(
						new Error(
							sourceError
								? `Resident preparation sources are invalid: ${sourceError}`
								: "Resident preparation certificate is detached or aliases derived artifacts.",
						),
					);
					return;
				}
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				resolve(Object.freeze({ ...sources, certificate: response.certificate }));
			};
			worker.onerror = (event) =>
				fail(new Error(event.message || "Resident preparation Worker failed."));
			worker.onmessageerror = () =>
				fail(new Error("Resident preparation Worker response could not be decoded."));
			this.timeout = setTimeout(
				() =>
					fail(
						new Error(
							`Resident preparation Worker timed out after ${this.timeoutMilliseconds} ms.`,
						),
					),
				this.timeoutMilliseconds,
			);
			try {
				worker.postMessage(request, collectTransferableBuffers(owned));
			} catch (error) {
				fail(normalizeError(error, "Resident preparation Worker post failed."));
			}
		});
	}

	cancel(): void {
		const reject = this.reject;
		this.reject = null;
		this.releaseWorker();
		reject?.(cancelledError());
	}

	dispose(): void {
		this.cancel();
	}

	private issueRequestId(): number {
		const requestId = this.nextRequestId;
		this.nextRequestId = requestId === Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
		return requestId;
	}

	private releaseWorker(): void {
		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = null;
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.onmessageerror = null;
			this.worker.terminate();
		}
		this.worker = null;
	}
}

function exactReadinessComponents(
	components: SimulationReadinessComponents,
): SimulationReadinessComponents {
	return Object.freeze({
		foundation: components.foundation,
		trackResources: components.trackResources,
		stationCapabilities: components.stationCapabilities,
		equipmentResources: components.equipmentResources,
		occupancyPolicy: components.occupancyPolicy,
	});
}

function cancelledError(): Error {
	return new DOMException("Resident scenario preparation was cancelled.", "AbortError");
}

function normalizeError(value: unknown, fallback: string): Error {
	return value instanceof Error ? value : new Error(fallback);
}

function derivedArtifactBuffersAreDistinct(
	response: Extract<
		SimulationResidentScenarioPreparationWorkerResponse,
		{ readonly type: "SIMULATION_RESIDENT_SCENARIO_PREPARED" }
	>,
): boolean {
	const buffers = [
		...simulationResidentCycleRouteTransfers(response.routes),
		...simulationResidentCycleLeaseClaimTransfers(response.leaseClaims),
		...simulationResidentCycleAdmissionProgramTransfers(response.admissionProgram),
		...simulationResidentCycleServiceTimingTransfers(response.serviceTiming),
		...simulationResidentCycleResourceRunConfigurationTransfers(response.resourceRunConfiguration),
	];
	return new Set(buffers).size === buffers.length;
}
