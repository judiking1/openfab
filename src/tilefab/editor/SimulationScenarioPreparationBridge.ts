import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "../compile/SimulationReadinessCertificate";
import { simulationScenarioAdmissionProgramTransfers } from "../compile/SimulationScenarioAdmissionProgram";
import { simulationScenarioLeaseClaimTransfers } from "../compile/SimulationScenarioLeaseClaims";
import {
	type SimulationScenarioManifest,
	simulationScenarioManifestError,
} from "../compile/SimulationScenarioManifest";
import { simulationScenarioPreparedArtifactChainMatchesSources } from "../compile/SimulationScenarioPreparedArtifacts";
import {
	checksumSimulationScenarioResourceRunConfigurationInput,
	type SimulationScenarioResourceRunConfigurationInput,
	simulationScenarioResourceRunConfigurationTransfers,
} from "../compile/SimulationScenarioResourceRunConfiguration";
import {
	type SimulationScenarioRouteRequests,
	simulationScenarioRouteRequestTransfers,
} from "../compile/SimulationScenarioRouteRequests";
import {
	checksumSimulationScenarioServiceTimingInput,
	type SimulationScenarioServiceTimingInput,
	simulationScenarioServiceTimingTransfers,
} from "../compile/SimulationScenarioServiceTiming";
import {
	type PreparedSimulationScenarioArtifacts,
	SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
	type SimulationScenarioPreparationWorkerRequest,
	type SimulationScenarioPreparationWorkerResponse,
} from "../worker/SimulationScenarioPreparationWorkerProtocol";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface SimulationScenarioPreparationWorkerPort {
	onmessage: ((event: MessageEvent<SimulationScenarioPreparationWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: SimulationScenarioPreparationWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

const ADOPTED_PREPARED_ARTIFACTS = new WeakSet<PreparedSimulationScenarioArtifacts>();

/** True only for a frozen bundle this realm's Bridge just validated and adopted. */
export function simulationScenarioPreparationBridgeAdoptedArtifacts(
	value: PreparedSimulationScenarioArtifacts,
): boolean {
	return ADOPTED_PREPARED_ARTIFACTS.has(value);
}

/** Adopts one exact Worker-owned route, lease, custody, timing, and resource-input bundle. */
export class SimulationScenarioPreparationBridge {
	private readonly createWorker: () => SimulationScenarioPreparationWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: SimulationScenarioPreparationWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private abortSignal: AbortSignal | null = null;
	private abortListener: (() => void) | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => SimulationScenarioPreparationWorkerPort = () =>
			new Worker(new URL("../worker/simulationScenarioPreparationWorker.ts", import.meta.url), {
				type: "module",
			}) as SimulationScenarioPreparationWorkerPort,
		timeoutMilliseconds = 60_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
		generation: number,
		signal?: AbortSignal,
	): Promise<PreparedSimulationScenarioArtifacts> {
		this.cancel();
		if (signal?.aborted) return Promise.reject(cancelledError());
		if (!Number.isSafeInteger(generation) || generation < 0) {
			return Promise.reject(new RangeError("Simulation scenario generation must be non-negative."));
		}
		const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
		if (snapshotError) {
			return Promise.reject(new Error(`Published readiness snapshot is invalid: ${snapshotError}`));
		}
		const manifestError = simulationScenarioManifestError(manifest);
		if (manifestError) {
			return Promise.reject(new Error(`Simulation scenario manifest is invalid: ${manifestError}`));
		}
		try {
			checksumSimulationScenarioServiceTimingInput(manifest, serviceTimingInput);
			checksumSimulationScenarioResourceRunConfigurationInput(manifest, resourceRunInput);
		} catch (error) {
			return Promise.reject(normalizeError(error, "Scenario run input is invalid."));
		}
		let ownedSnapshot: PublishedSimulationReadinessSnapshot;
		try {
			ownedSnapshot = structuredClone(snapshot);
		} catch (error) {
			return Promise.reject(normalizeError(error, "Simulation scenario source capture failed."));
		}
		const requestId = this.issueRequestId();
		const request: SimulationScenarioPreparationWorkerRequest = {
			type: "PREPARE_SIMULATION_SCENARIO",
			protocolVersion: SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION,
			requestId,
			generation,
			sourceKind: manifest.sourceKind,
			snapshot: ownedSnapshot,
			manifest,
			serviceTimingInput,
			resourceRunInput,
		};
		return new Promise((resolve, reject) => {
			let worker: SimulationScenarioPreparationWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				reject(normalizeError(error, "Simulation scenario preparation Worker creation failed."));
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
				if (
					!isRecord(response) ||
					response.protocolVersion !== SIMULATION_SCENARIO_PREPARATION_WORKER_PROTOCOL_VERSION ||
					response.requestId !== requestId ||
					response.generation !== generation ||
					response.sourceKind !== manifest.sourceKind
				) {
					fail(
						new Error(
							"Simulation scenario preparation Worker returned a stale or mismatched response.",
						),
					);
					return;
				}
				if (response.type === "SIMULATION_SCENARIO_PREPARATION_REJECTED") {
					fail(
						new Error(
							response.message || `Simulation scenario preparation rejected: ${response.code}.`,
						),
					);
					return;
				}
				if (
					response.type !== "SIMULATION_SCENARIO_PREPARED" ||
					!simulationScenarioPreparedArtifactChainMatchesSources(
						snapshot,
						manifest,
						serviceTimingInput,
						resourceRunInput,
						response,
					) ||
					!preparedArtifactBuffersAreDistinct(
						response.routes,
						response.leaseClaims,
						response.admissionProgram,
						response.serviceTiming,
						response.resourceRunConfiguration,
					)
				) {
					fail(
						new Error(
							"Simulation scenario preparation Worker returned incomplete safety artifacts or different sources.",
						),
					);
					return;
				}
				if (this.worker !== worker) return;
				const prepared = Object.freeze({
					routes: response.routes,
					leaseClaims: response.leaseClaims,
					admissionProgram: response.admissionProgram,
					serviceTiming: response.serviceTiming,
					resourceRunConfiguration: response.resourceRunConfiguration,
				}) satisfies PreparedSimulationScenarioArtifacts;
				ADOPTED_PREPARED_ARTIFACTS.add(prepared);
				this.reject = null;
				this.releaseWorker();
				resolve(prepared);
			};
			worker.onerror = (event) =>
				fail(new Error(event.message || "Simulation scenario preparation Worker failed."));
			worker.onmessageerror = () =>
				fail(new Error("Simulation scenario preparation Worker returned an unreadable response."));
			this.timeout = setTimeout(
				() =>
					fail(
						new Error(
							`Simulation scenario preparation Worker timed out after ${this.timeoutMilliseconds} ms.`,
						),
					),
				this.timeoutMilliseconds,
			);
			if (signal) {
				this.abortSignal = signal;
				this.abortListener = () => this.cancel();
				signal.addEventListener("abort", this.abortListener, { once: true });
			}
			try {
				worker.postMessage(request, collectTransferableBuffers(ownedSnapshot));
			} catch (error) {
				fail(normalizeError(error, "Simulation scenario preparation Worker post failed."));
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
		if (this.abortSignal && this.abortListener) {
			this.abortSignal.removeEventListener("abort", this.abortListener);
		}
		this.abortSignal = null;
		this.abortListener = null;
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.onmessageerror = null;
			this.worker.terminate();
		}
		this.worker = null;
	}
}

function preparedArtifactBuffersAreDistinct(
	routes: SimulationScenarioRouteRequests,
	leaseClaims: Parameters<typeof simulationScenarioLeaseClaimTransfers>[0],
	admissionProgram: Parameters<typeof simulationScenarioAdmissionProgramTransfers>[0],
	serviceTiming: Parameters<typeof simulationScenarioServiceTimingTransfers>[0],
	resourceRunConfiguration: Parameters<
		typeof simulationScenarioResourceRunConfigurationTransfers
	>[0],
): boolean {
	const buffers = [
		...simulationScenarioRouteRequestTransfers(routes),
		...simulationScenarioLeaseClaimTransfers(leaseClaims),
		...simulationScenarioAdmissionProgramTransfers(admissionProgram),
		...simulationScenarioServiceTimingTransfers(serviceTiming),
		...simulationScenarioResourceRunConfigurationTransfers(resourceRunConfiguration),
	];
	return new Set(buffers).size === buffers.length;
}

function cancelledError(): Error {
	return new DOMException("Simulation scenario preparation was cancelled.", "AbortError");
}

function normalizeError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
