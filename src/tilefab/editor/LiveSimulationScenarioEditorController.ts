import type { PublishedSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import {
	discardSimulationScenarioPreparedArtifactChainValidation,
	type SimulationScenarioPreparedArtifactChainValidation,
} from "../compile/SimulationScenarioPreparedArtifacts";
import type { SimulationScenarioResourceRunConfigurationInput } from "../compile/SimulationScenarioResourceRunConfiguration";
import {
	type CompileSimulationScenarioRunAuthorizationInput,
	compileSimulationScenarioRunAuthorizationFromValidatedPreparedSources,
	type SimulationScenarioRunAuthorization,
	simulationScenarioRunAuthorizationAdvanceValidatedPreparedSources,
	simulationScenarioRunAuthorizationMatchesValidatedPreparedSources,
} from "../compile/SimulationScenarioRunAuthorization";
import type { SimulationScenarioServiceTimingInput } from "../compile/SimulationScenarioServiceTiming";
import type { RailDocument } from "../core/RailDocument";
import type { PreparedSimulationScenarioArtifacts } from "../worker/SimulationScenarioPreparationWorkerProtocol";
import {
	LiveSimulationScenarioSession,
	type LiveSimulationScenarioSessionState,
} from "./LiveSimulationScenarioSession";
import {
	adaptSimulationScenarioEditorRunAsset,
	type SimulationScenarioEditorRunAsset,
	type SimulationScenarioEditorSource,
} from "./SimulationScenarioEditorSourceAdapter";

export interface LiveSimulationScenarioEditorSourceSummary {
	readonly sourceKind: SimulationScenarioEditorRunAsset["manifest"]["sourceKind"];
	readonly manifestFingerprint: string;
	readonly runAssetFingerprint: string;
	readonly inputRecordCount: number;
	readonly acceptedRecordCount: number;
	readonly rejectedRecordCount: number;
	readonly issuesTruncated: boolean;
}

export interface LiveSimulationScenarioRunAuthorizationSummary {
	readonly fingerprint: string;
	readonly preparationGeneration: number;
	readonly authorizationGeneration: number;
	readonly readinessProfileId: string;
	readonly limitations: readonly string[];
	readonly requestCount: number;
	readonly loadCount: number;
	readonly eqResourceCount: number;
	readonly storageResourceCount: number;
}

export interface ConsumedLiveSimulationScenarioRun {
	readonly authorization: SimulationScenarioRunAuthorization;
	readonly runAsset: SimulationScenarioEditorRunAsset;
	readonly prepared: PreparedSimulationScenarioArtifacts;
}

export interface LiveSimulationScenarioEditorControllerState {
	readonly projectId: string;
	readonly source: LiveSimulationScenarioEditorSourceSummary | null;
	readonly session: LiveSimulationScenarioSessionState;
	readonly authorization: LiveSimulationScenarioRunAuthorizationSummary | null;
}

/**
 * Binds one run-local source owner to the exact live RailDocument and project. The controller owns
 * no raw import records and has no persistence API. Every authored patch, project replacement,
 * source switch, explicit cancel, or disposal reaches the underlying session synchronously.
 */
export class LiveSimulationScenarioEditorController {
	private readonly session: LiveSimulationScenarioSession;
	private readonly listeners = new Set<() => void>();
	private projectId: string;
	private document: RailDocument;
	private runAsset: SimulationScenarioEditorRunAsset | null = null;
	private authorization: SimulationScenarioRunAuthorization | null = null;
	private authorizationGeneration = 0;
	private state: LiveSimulationScenarioEditorControllerState;
	private unsubscribeDocument: () => void;
	private unsubscribeSession: () => void;
	private disposed = false;

	constructor(
		projectId: string,
		document: RailDocument,
		session: LiveSimulationScenarioSession = new LiveSimulationScenarioSession(),
	) {
		assertProjectId(projectId);
		this.projectId = projectId;
		this.document = document;
		this.session = session;
		this.state = this.captureState();
		this.unsubscribeDocument = document.subscribe(() => this.invalidateAuthoredMutation());
		this.unsubscribeSession = session.subscribe(() => this.publish());
	}

	getState(): LiveSimulationScenarioEditorControllerState {
		return this.state;
	}

	selectedRunAsset(): SimulationScenarioEditorRunAsset | null {
		return this.runAsset;
	}

	subscribe(listener: () => void): () => void {
		this.assertActive();
		if (typeof listener !== "function") throw new TypeError("Scenario editor listener is invalid.");
		this.listeners.add(listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	prepare(
		snapshot: PublishedSimulationReadinessSnapshot,
		source: SimulationScenarioEditorSource,
		serviceTimingInput: SimulationScenarioServiceTimingInput,
		resourceRunInput: SimulationScenarioResourceRunConfigurationInput,
	): Promise<PreparedSimulationScenarioArtifacts> {
		this.assertActive();
		const nextAsset = adaptSimulationScenarioEditorRunAsset(
			snapshot,
			source,
			serviceTimingInput,
			resourceRunInput,
		);
		const sourceChanged =
			this.runAsset !== null && this.runAsset.fingerprint !== nextAsset.fingerprint;
		this.dropAuthorization();
		this.runAsset = nextAsset;
		if (sourceChanged) this.session.invalidate("SOURCE_SWITCH");
		return this.session.prepare(
			snapshot,
			nextAsset.manifest,
			nextAsset.serviceTimingInput,
			nextAsset.resourceRunInput,
		);
	}

	authorizeCurrentPrepared(
		snapshot: PublishedSimulationReadinessSnapshot,
	): SimulationScenarioRunAuthorization {
		this.assertActive();
		const runAsset = this.runAsset;
		const session = this.session.getState();
		if (!runAsset || session.phase !== "PREPARED") {
			throw new Error("A current PREPARED scenario is required before Run authorization.");
		}
		const validation = this.preparedArtifactValidationForCurrent(snapshot);
		if (!validation) {
			throw new Error("The prepared scenario no longer matches the exact current source.");
		}
		const prepared = validation.prepared;
		const nextGeneration = nextPositiveGeneration(this.authorizationGeneration);
		const authorization = compileSimulationScenarioRunAuthorizationFromValidatedPreparedSources(
			this.authorizationInput(snapshot, runAsset, prepared, session.generation, nextGeneration),
			validation,
		);
		this.authorizationGeneration = nextGeneration;
		this.authorization = authorization;
		this.publish();
		return authorization;
	}

	revokeRunAuthorization(): void {
		this.assertActive();
		if (!this.authorization) return;
		this.dropAuthorization();
		this.publish();
	}

	consumeAuthorizedRunForCurrent(
		snapshot: PublishedSimulationReadinessSnapshot,
	): ConsumedLiveSimulationScenarioRun | null {
		this.assertActive();
		const authorization = this.authorization;
		const runAsset = this.runAsset;
		const session = this.session.getState();
		if (!authorization || !runAsset || session.phase !== "PREPARED") return null;
		const validation = this.preparedArtifactValidationForCurrent(snapshot);
		if (!validation) {
			this.dropAuthorization();
			this.publish();
			return null;
		}
		const prepared = validation.prepared;
		const input = this.authorizationInput(
			snapshot,
			runAsset,
			prepared,
			session.generation,
			authorization.authorizationGeneration,
		);
		if (
			!simulationScenarioRunAuthorizationMatchesValidatedPreparedSources(
				authorization,
				input,
				validation,
			)
		) {
			this.dropAuthorization();
			this.publish();
			return null;
		}
		this.dropAuthorization();
		this.publish();
		return Object.freeze({ authorization, runAsset, prepared });
	}

	/**
	 * Internal active-owner boundary. The successor proof exists only during the synchronous adopter
	 * call and is revoked on every return or throw if the scheduler did not consume it.
	 */
	adoptAuthorizedRunForCurrent<T>(
		snapshot: PublishedSimulationReadinessSnapshot,
		adopter: (
			consumed: ConsumedLiveSimulationScenarioRun,
			validation: SimulationScenarioPreparedArtifactChainValidation,
		) => T,
	): T | null {
		this.assertActive();
		if (typeof adopter !== "function") {
			throw new TypeError("Simulation scenario immediate Run adopter is invalid.");
		}
		const authorization = this.authorization;
		const runAsset = this.runAsset;
		const session = this.session.getState();
		if (!authorization || !runAsset || session.phase !== "PREPARED") return null;
		const validation = this.preparedArtifactValidationForCurrent(snapshot);
		if (!validation) {
			this.dropAuthorization();
			this.publish();
			return null;
		}
		const prepared = validation.prepared;
		const input = this.authorizationInput(
			snapshot,
			runAsset,
			prepared,
			session.generation,
			authorization.authorizationGeneration,
		);
		const schedulerValidation = simulationScenarioRunAuthorizationAdvanceValidatedPreparedSources(
			authorization,
			input,
			validation,
		);
		if (!schedulerValidation) {
			this.dropAuthorization();
			this.publish();
			return null;
		}
		this.dropAuthorization();
		this.publish();
		const consumed = Object.freeze({ authorization, runAsset, prepared });
		try {
			return adopter(consumed, schedulerValidation);
		} finally {
			discardSimulationScenarioPreparedArtifactChainValidation(schedulerValidation);
		}
	}

	preparedArtifactsForCurrent(
		snapshot: PublishedSimulationReadinessSnapshot,
	): PreparedSimulationScenarioArtifacts | null {
		this.assertActive();
		const asset = this.runAsset;
		if (!asset) return null;
		return this.session.preparedArtifactsFor(
			snapshot,
			asset.manifest,
			asset.serviceTimingInput,
			asset.resourceRunInput,
		);
	}

	private preparedArtifactValidationForCurrent(
		snapshot: PublishedSimulationReadinessSnapshot,
	): SimulationScenarioPreparedArtifactChainValidation | null {
		const asset = this.runAsset;
		if (!asset) return null;
		return this.session.preparedArtifactValidationFor(
			snapshot,
			asset.manifest,
			asset.serviceTimingInput,
			asset.resourceRunInput,
		);
	}

	cancel(): void {
		this.assertActive();
		if (this.session.getState().phase === "IDLE") return;
		this.dropAuthorization();
		this.session.invalidate("EXPLICIT_CANCEL");
	}

	clearSource(): void {
		this.assertActive();
		if (!this.runAsset && this.session.getState().phase === "IDLE") return;
		this.dropAuthorization();
		this.runAsset = null;
		this.session.invalidate("SOURCE_SWITCH");
	}

	replaceProject(projectId: string, document: RailDocument): void {
		this.assertActive();
		assertProjectId(projectId);
		if (this.projectId === projectId && this.document === document) return;
		this.unsubscribeDocument();
		this.dropAuthorization();
		this.projectId = projectId;
		this.document = document;
		this.runAsset = null;
		this.unsubscribeDocument = document.subscribe(() => this.invalidateAuthoredMutation());
		this.session.invalidate("PROJECT_REPLACEMENT");
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeDocument();
		this.dropAuthorization();
		this.runAsset = null;
		this.session.dispose();
		this.unsubscribeSession();
		this.listeners.clear();
	}

	private invalidateAuthoredMutation(): void {
		if (this.disposed || !this.runAsset) return;
		const session = this.session.getState();
		if (session.phase === "INVALIDATED" && session.reason === "AUTHORED_MUTATION") {
			return;
		}
		this.dropAuthorization();
		this.session.invalidate("AUTHORED_MUTATION");
	}

	private captureState(): LiveSimulationScenarioEditorControllerState {
		const manifest = this.runAsset?.manifest;
		return Object.freeze({
			projectId: this.projectId,
			source:
				manifest && this.runAsset
					? Object.freeze({
							sourceKind: manifest.sourceKind,
							manifestFingerprint: manifest.fingerprint,
							runAssetFingerprint: this.runAsset.fingerprint,
							inputRecordCount: manifest.inputRecordCount,
							acceptedRecordCount: manifest.acceptedRecordCount,
							rejectedRecordCount: manifest.rejectedRecordCount,
							issuesTruncated: manifest.issuesTruncated,
						})
					: null,
			session: this.session.getState(),
			authorization: this.authorization
				? Object.freeze({
						fingerprint: this.authorization.fingerprint,
						preparationGeneration: this.authorization.preparationGeneration,
						authorizationGeneration: this.authorization.authorizationGeneration,
						readinessProfileId: this.authorization.sourceReadinessProfileId,
						limitations: this.authorization.limitations,
						requestCount: this.authorization.requestCount,
						loadCount: this.authorization.loadCount,
						eqResourceCount: this.authorization.eqResourceCount,
						storageResourceCount: this.authorization.storageResourceCount,
					})
				: null,
		});
	}

	private authorizationInput(
		snapshot: PublishedSimulationReadinessSnapshot,
		runAsset: SimulationScenarioEditorRunAsset,
		prepared: PreparedSimulationScenarioArtifacts,
		preparationGeneration: number,
		authorizationGeneration: number,
	): CompileSimulationScenarioRunAuthorizationInput {
		return Object.freeze({
			projectId: this.projectId,
			preparationGeneration,
			authorizationGeneration,
			runAssetFingerprint: runAsset.fingerprint,
			serviceTimingInputFingerprint: runAsset.serviceTimingInputFingerprint,
			resourceRunInputFingerprint: runAsset.resourceRunInputFingerprint,
			snapshot,
			manifest: runAsset.manifest,
			prepared,
		});
	}

	private dropAuthorization(): void {
		if (!this.authorization) return;
		this.authorization = null;
		this.authorizationGeneration = nextPositiveGeneration(this.authorizationGeneration);
	}

	private publish(): void {
		this.state = this.captureState();
		for (const listener of this.listeners) listener();
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Simulation scenario editor controller is disposed.");
	}
}

function assertProjectId(value: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
		throw new Error("Simulation scenario editor project identity is invalid.");
	}
}

function nextPositiveGeneration(current: number): number {
	return current === Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, current + 1);
}
