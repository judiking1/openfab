import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "../compile/SimulationReadinessCertificate";
import {
	type SimulationScenarioManifest,
	type SimulationScenarioSourceKind,
	simulationScenarioManifestError,
} from "../compile/SimulationScenarioManifest";
import {
	type SimulationScenarioPreparedArtifactChainValidation,
	simulationScenarioPreparedArtifactChainMatchesSources,
	validateRetainedSimulationScenarioPreparedArtifactChainSources,
} from "../compile/SimulationScenarioPreparedArtifacts";
import {
	checksumSimulationScenarioResourceRunConfigurationInput,
	type SimulationScenarioResourceRunConfigurationInput,
} from "../compile/SimulationScenarioResourceRunConfiguration";
import { checksumSimulationScenarioRunIdentity } from "../compile/SimulationScenarioRouteRequests";
import {
	checksumSimulationScenarioServiceTimingInput,
	type SimulationScenarioServiceTimingInput,
} from "../compile/SimulationScenarioServiceTiming";
import type { PreparedSimulationScenarioArtifacts } from "../worker/SimulationScenarioPreparationWorkerProtocol";
import {
	SimulationScenarioPreparationBridge,
	simulationScenarioPreparationBridgeAdoptedArtifacts,
} from "./SimulationScenarioPreparationBridge";

export const LIVE_SIMULATION_SCENARIO_INVALIDATION_REASONS = Object.freeze([
	"AUTHORED_MUTATION",
	"PROJECT_REPLACEMENT",
	"SOURCE_SWITCH",
	"EXPLICIT_CANCEL",
	"UNMOUNT",
] as const);
export type LiveSimulationScenarioInvalidationReason =
	(typeof LIVE_SIMULATION_SCENARIO_INVALIDATION_REASONS)[number];

export interface LiveSimulationScenarioSourceIdentity {
	readonly sourceKind: SimulationScenarioSourceKind;
	readonly manifestFingerprint: string;
	readonly certificateFingerprint: string;
	readonly readinessProfileId: string;
	readonly runIdentityFingerprint: string;
	readonly serviceTimingInputFingerprint: string;
	readonly resourceRunInputFingerprint: string;
}

export type LiveSimulationScenarioSessionState =
	| Readonly<{ phase: "IDLE"; generation: 0 }>
	| Readonly<{
			phase: "PREPARING";
			generation: number;
			source: LiveSimulationScenarioSourceIdentity;
	  }>
	| Readonly<{
			phase: "PREPARED";
			generation: number;
			source: LiveSimulationScenarioSourceIdentity;
			prepared: PreparedSimulationScenarioArtifacts;
	  }>
	| Readonly<{
			phase: "FAILED";
			generation: number;
			source: LiveSimulationScenarioSourceIdentity;
			message: string;
	  }>
	| Readonly<{
			phase: "INVALIDATED";
			generation: number;
			reason: LiveSimulationScenarioInvalidationReason;
	  }>;

export interface LiveSimulationScenarioPreparationPort {
	prepare(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
		generation: number,
	): Promise<PreparedSimulationScenarioArtifacts>;
	cancel(): void;
	dispose(): void;
}

const INITIAL_STATE: LiveSimulationScenarioSessionState = Object.freeze({
	phase: "IDLE",
	generation: 0,
});
const MAX_FAILURE_MESSAGE_LENGTH = 240;

/** Owns all non-runnable prepared artifacts and drops them on every invalidation boundary. */
export class LiveSimulationScenarioSession {
	private readonly preparation: LiveSimulationScenarioPreparationPort;
	private readonly listeners = new Set<() => void>();
	private generation = 0;
	private state: LiveSimulationScenarioSessionState = INITIAL_STATE;
	private disposed = false;

	constructor(
		preparation: LiveSimulationScenarioPreparationPort = new SimulationScenarioPreparationBridge(),
	) {
		this.preparation = preparation;
	}

	getState(): LiveSimulationScenarioSessionState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		if (this.disposed) throw new Error("Simulation scenario session is disposed.");
		if (typeof listener !== "function")
			throw new TypeError("Scenario session listener is invalid.");
		this.listeners.add(listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	async prepare(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): Promise<PreparedSimulationScenarioArtifacts> {
		this.assertActive();
		const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
		const manifestError = simulationScenarioManifestError(manifest);
		if (snapshotError || manifestError) {
			this.invalidate("SOURCE_SWITCH");
			throw new Error(
				snapshotError
					? `Published readiness snapshot is invalid: ${snapshotError}`
					: `Simulation scenario manifest is invalid: ${manifestError}`,
			);
		}
		let source: LiveSimulationScenarioSourceIdentity;
		try {
			source = scenarioSourceIdentity(snapshot, manifest, serviceTimingInput, resourceRunInput);
		} catch (error) {
			this.invalidate("SOURCE_SWITCH");
			throw normalizeError(error);
		}
		const generation = this.nextGeneration();
		this.preparation.cancel();
		this.publish(Object.freeze({ phase: "PREPARING", generation, source }));
		try {
			const prepared = await this.preparation.prepare(
				snapshot,
				manifest,
				serviceTimingInput,
				resourceRunInput,
				generation,
			);
			if (generation !== this.generation || this.disposed) throw cancelledError();
			if (
				!simulationScenarioPreparationBridgeAdoptedArtifacts(prepared) &&
				!simulationScenarioPreparedArtifactChainMatchesSources(
					snapshot,
					manifest,
					serviceTimingInput,
					resourceRunInput,
					prepared,
				)
			) {
				throw new Error(
					"Prepared scenario safety artifacts do not match the retained live sources.",
				);
			}
			if (!Object.isFrozen(prepared)) Object.freeze(prepared);
			this.publish(Object.freeze({ phase: "PREPARED", generation, source, prepared }));
			return prepared;
		} catch (error) {
			if (generation !== this.generation || this.disposed) throw cancelledError();
			const normalized = normalizeError(error);
			this.publish(
				Object.freeze({
					phase: "FAILED",
					generation,
					source,
					message: normalized.message.slice(0, MAX_FAILURE_MESSAGE_LENGTH),
				}),
			);
			throw normalized;
		}
	}

	invalidate(reason: LiveSimulationScenarioInvalidationReason): void {
		this.assertActive();
		if (!LIVE_SIMULATION_SCENARIO_INVALIDATION_REASONS.includes(reason)) {
			throw new TypeError("Simulation scenario invalidation reason is invalid.");
		}
		const generation = this.nextGeneration();
		this.preparation.cancel();
		this.publish(Object.freeze({ phase: "INVALIDATED", generation, reason }));
	}

	preparedRoutesFor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): PreparedSimulationScenarioArtifacts["routes"] | null {
		return (
			this.preparedArtifactsFor(snapshot, manifest, serviceTimingInput, resourceRunInput)?.routes ??
			null
		);
	}

	preparedLeaseClaimsFor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): PreparedSimulationScenarioArtifacts["leaseClaims"] | null {
		return (
			this.preparedArtifactsFor(snapshot, manifest, serviceTimingInput, resourceRunInput)
				?.leaseClaims ?? null
		);
	}

	preparedAdmissionProgramFor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): PreparedSimulationScenarioArtifacts["admissionProgram"] | null {
		return (
			this.preparedArtifactsFor(snapshot, manifest, serviceTimingInput, resourceRunInput)
				?.admissionProgram ?? null
		);
	}

	preparedServiceTimingFor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): PreparedSimulationScenarioArtifacts["serviceTiming"] | null {
		return (
			this.preparedArtifactsFor(snapshot, manifest, serviceTimingInput, resourceRunInput)
				?.serviceTiming ?? null
		);
	}

	preparedResourceRunConfigurationFor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): PreparedSimulationScenarioArtifacts["resourceRunConfiguration"] | null {
		return (
			this.preparedArtifactsFor(snapshot, manifest, serviceTimingInput, resourceRunInput)
				?.resourceRunConfiguration ?? null
		);
	}

	preparedArtifactsFor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): PreparedSimulationScenarioArtifacts | null {
		return (
			this.preparedArtifactValidationFor(snapshot, manifest, serviceTimingInput, resourceRunInput)
				?.prepared ?? null
		);
	}

	/** Returns one-use proof after rechecking mutable retained buffers against exact live inputs. */
	preparedArtifactValidationFor(
		snapshot: PublishedSimulationReadinessSnapshot,
		manifest: SimulationScenarioManifest,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): SimulationScenarioPreparedArtifactChainValidation | null {
		if (this.state.phase !== "PREPARED") return null;
		let source: LiveSimulationScenarioSourceIdentity;
		try {
			source = scenarioSourceIdentity(snapshot, manifest, serviceTimingInput, resourceRunInput);
		} catch {
			return null;
		}
		if (!sameScenarioSourceIdentity(this.state.source, source)) {
			return null;
		}
		return validateRetainedSimulationScenarioPreparedArtifactChainSources(
			snapshot,
			manifest,
			serviceTimingInput,
			resourceRunInput,
			this.state.prepared,
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const generation = this.nextGeneration();
		this.preparation.cancel();
		this.preparation.dispose();
		this.publish(Object.freeze({ phase: "INVALIDATED", generation, reason: "UNMOUNT" }));
		this.listeners.clear();
	}

	private nextGeneration(): number {
		this.generation =
			this.generation === Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, this.generation + 1);
		return this.generation;
	}

	private publish(state: LiveSimulationScenarioSessionState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Simulation scenario session is disposed.");
	}
}

export function scenarioSourceIdentity(
	snapshot: PublishedSimulationReadinessSnapshot,
	manifest: SimulationScenarioManifest,
	serviceTimingInput: SimulationScenarioServiceTimingInput,
	resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
): LiveSimulationScenarioSourceIdentity {
	return Object.freeze({
		sourceKind: manifest.sourceKind,
		manifestFingerprint: manifest.fingerprint,
		certificateFingerprint: snapshot.certificate.fingerprint,
		readinessProfileId: snapshot.certificate.readinessProfileId,
		runIdentityFingerprint: checksumSimulationScenarioRunIdentity(snapshot, manifest),
		serviceTimingInputFingerprint: checksumSimulationScenarioServiceTimingInput(
			manifest,
			serviceTimingInput,
		),
		resourceRunInputFingerprint: checksumSimulationScenarioResourceRunConfigurationInput(
			manifest,
			resourceRunInput,
		),
	});
}

function sameScenarioSourceIdentity(
	left: LiveSimulationScenarioSourceIdentity,
	right: LiveSimulationScenarioSourceIdentity,
): boolean {
	return (
		left.sourceKind === right.sourceKind &&
		left.manifestFingerprint === right.manifestFingerprint &&
		left.certificateFingerprint === right.certificateFingerprint &&
		left.readinessProfileId === right.readinessProfileId &&
		left.runIdentityFingerprint === right.runIdentityFingerprint &&
		left.serviceTimingInputFingerprint === right.serviceTimingInputFingerprint &&
		left.resourceRunInputFingerprint === right.resourceRunInputFingerprint
	);
}

function cancelledError(): Error {
	return new DOMException("Simulation scenario preparation was invalidated.", "AbortError");
}

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error("Simulation scenario preparation failed.");
}
