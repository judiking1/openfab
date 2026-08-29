import type { SimulationReadinessComponents } from "../compile/SimulationReadinessCertificate";
import type { SimulationResidentCycleResourceRunConfigurationInput } from "../compile/SimulationResidentCycleResourceRunConfiguration";
import type { SimulationResidentCycleServiceTimingInput } from "../compile/SimulationResidentCycleServiceTiming";
import type { PublishedSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import {
	discardSimulationResidentRunAuthorizationGrant,
	type IssueSimulationResidentRunAuthorizationInput,
	issueSimulationResidentRunAuthorization,
	type SimulationResidentRunAuthorization,
	type SimulationResidentRunAuthorizationGrant,
} from "../compile/SimulationResidentRunAuthorization";
import {
	checksumOperationalConfiguration,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import type { RailDocument } from "../core/RailDocument";
import type {
	DeterministicResidentActiveRunOwner,
	DeterministicResidentActiveRunOwnerState,
} from "../simulation/DeterministicResidentActiveRunOwner";
import type { DeterministicResidentSpeedMultiplier } from "../simulation/DeterministicResidentRuntimeState";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import {
	adaptSimulationResidentScenarioEditorRunAsset,
	type SimulationResidentScenarioEditorRunAsset,
	type SimulationResidentScenarioEditorSource,
} from "./SimulationResidentScenarioEditorSourceAdapter";
import type {
	SimulationResidentScenarioSession,
	SimulationResidentScenarioSessionState,
} from "./SimulationResidentScenarioSession";

export interface SimulationResidentEditorSourceSummary {
	readonly sourceKind: SimulationResidentScenarioEditorRunAsset["manifest"]["sourceKind"];
	readonly manifestFingerprint: string;
	readonly runAssetFingerprint: string;
	readonly inputRecordCount: number;
	readonly acceptedRecordCount: number;
	readonly rejectedRecordCount: number;
	readonly issuesTruncated: boolean;
}

export interface SimulationResidentAuthorizationSummary {
	readonly fingerprint: string;
	readonly preparationGeneration: number;
	readonly authorizationGeneration: number;
	readonly readinessProfileId: string;
	readonly requestCount: number;
	readonly loadCount: number;
	readonly vehicleCount: number;
	readonly eqResourceCount: number;
	readonly storageResourceCount: number;
}

export interface SimulationResidentScenarioEditorControllerState {
	readonly projectId: string;
	readonly source: SimulationResidentEditorSourceSummary | null;
	readonly session: SimulationResidentScenarioSessionState;
	readonly authorization: SimulationResidentAuthorizationSummary | null;
	readonly activeRun: DeterministicResidentActiveRunOwnerState;
}

export interface SimulationResidentEditorLiveSourceIdentity {
	readonly patchSequence: number;
	readonly revision: number;
	readonly authoredChecksum: string;
	readonly operationalConfigurationFingerprint: string;
}

export type SimulationResidentEditorLiveSourceReader = (
	document: RailDocument,
) => SimulationResidentEditorLiveSourceIdentity;

/** Binds resident preparation and single-run ownership to one exact live project/document. */
export class SimulationResidentScenarioEditorController {
	private readonly session: SimulationResidentScenarioSession;
	private readonly owner: DeterministicResidentActiveRunOwner;
	private readonly readLiveSource: SimulationResidentEditorLiveSourceReader;
	private readonly listeners = new Set<() => void>();
	private projectId: string;
	private document: RailDocument;
	private runAsset: SimulationResidentScenarioEditorRunAsset | null = null;
	private grant: SimulationResidentRunAuthorizationGrant | null = null;
	private authorizationInput: IssueSimulationResidentRunAuthorizationInput | null = null;
	private authorizationGeneration = 0;
	private pendingAuthorizationGeneration: number | null = null;
	private state: SimulationResidentScenarioEditorControllerState;
	private unsubscribeDocument: () => void;
	private readonly unsubscribeSession: () => void;
	private readonly unsubscribeOwner: () => void;
	private disposed = false;

	constructor(
		projectId: string,
		document: RailDocument,
		session: SimulationResidentScenarioSession,
		owner: DeterministicResidentActiveRunOwner,
		readLiveSource: SimulationResidentEditorLiveSourceReader = readRailDocumentLiveSource,
	) {
		assertProjectId(projectId);
		this.projectId = projectId;
		this.document = document;
		this.session = session;
		this.owner = owner;
		this.readLiveSource = readLiveSource;
		this.state = this.captureState();
		this.unsubscribeDocument = document.subscribe(() => this.invalidateAuthoredMutation());
		this.unsubscribeSession = session.subscribe(() => this.publish());
		this.unsubscribeOwner = owner.subscribe(() => this.publish());
	}

	getState(): SimulationResidentScenarioEditorControllerState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.assertActive();
		if (typeof listener !== "function") {
			throw new TypeError("Resident scenario editor listener is invalid.");
		}
		this.listeners.add(listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	prepare(
		components: SimulationReadinessComponents,
		operationalConfiguration: OperationalConfigurationState,
		source: SimulationResidentScenarioEditorSource,
		serviceTimingInput: SimulationResidentCycleServiceTimingInput,
		resourceRunInput: SimulationResidentCycleResourceRunConfigurationInput,
	): Promise<PublishedSimulationResidentReadinessSnapshot> {
		this.assertActive();
		this.assertCurrentDocumentSource(
			components,
			checksumOperationalConfiguration(operationalConfiguration),
		);
		const nextAsset = adaptSimulationResidentScenarioEditorRunAsset(
			components,
			operationalConfiguration,
			source,
			serviceTimingInput,
			resourceRunInput,
		);
		const sourceChanged =
			this.runAsset !== null && this.runAsset.fingerprint !== nextAsset.fingerprint;
		this.dropAuthorization();
		this.stopOwnerForSource("SOURCE_SWITCH");
		this.runAsset = nextAsset;
		if (sourceChanged) this.session.invalidate("SOURCE_SWITCH");
		return this.session.prepare(components, nextAsset);
	}

	async authorizeCurrentPrepared(
		components: SimulationReadinessComponents,
	): Promise<SimulationResidentRunAuthorization> {
		this.assertActive();
		const runAsset = this.runAsset;
		const sessionState = this.session.getState();
		if (!runAsset || sessionState.phase !== "PREPARED") {
			throw new Error("A current PREPARED resident scenario is required before authorization.");
		}
		const snapshot = this.session.preparedSnapshotFor(components, runAsset);
		if (!snapshot) throw new Error("The prepared resident scenario no longer matches its source.");
		this.assertCurrentDocumentSource(
			components,
			runAsset.parking.sourceOperationalConfigurationFingerprint,
		);
		const projectId = this.projectId;
		const preparationGeneration = sessionState.generation;
		this.dropAuthorization();
		const authorizationGeneration = nextPositiveGeneration(this.authorizationGeneration);
		this.authorizationGeneration = authorizationGeneration;
		this.pendingAuthorizationGeneration = authorizationGeneration;
		const input = Object.freeze({
			projectId,
			preparationGeneration,
			authorizationGeneration,
			runAssetFingerprint: runAsset.fingerprint,
			snapshot,
		});
		let grant: SimulationResidentRunAuthorizationGrant;
		try {
			grant = await issueSimulationResidentRunAuthorization(input);
		} catch (error) {
			if (this.pendingAuthorizationGeneration === authorizationGeneration) {
				this.pendingAuthorizationGeneration = null;
			}
			throw error;
		}
		if (
			this.disposed ||
			this.pendingAuthorizationGeneration !== authorizationGeneration ||
			this.projectId !== projectId ||
			this.runAsset !== runAsset ||
			this.session.getState().phase !== "PREPARED" ||
			this.session.getState().generation !== preparationGeneration ||
			this.session.preparedSnapshotFor(components, runAsset) !== snapshot ||
			!this.currentDocumentSourceMatches(
				components,
				runAsset.parking.sourceOperationalConfigurationFingerprint,
			)
		) {
			discardSimulationResidentRunAuthorizationGrant(grant);
			throw new Error("Resident authorization was cancelled by a newer editor lifecycle.");
		}
		this.pendingAuthorizationGeneration = null;
		this.grant = grant;
		this.authorizationInput = input;
		this.publish();
		return grant.authorization;
	}

	async start(
		speedMultiplier: DeterministicResidentSpeedMultiplier,
	): Promise<DeterministicResidentActiveRunOwnerState> {
		this.assertActive();
		const grant = this.grant;
		const input = this.authorizationInput;
		if (!grant || !input) {
			throw new Error("A current one-shot resident authorization is required before Start.");
		}
		this.grant = null;
		this.authorizationInput = null;
		this.publish();
		return this.owner.start(grant, input, speedMultiplier);
	}

	stop(): boolean {
		this.assertActive();
		return this.owner.stop();
	}

	setSpeedMultiplier(speedMultiplier: DeterministicResidentSpeedMultiplier): void {
		this.assertActive();
		this.owner.setSpeedMultiplier(speedMultiplier);
	}

	revokeAuthorization(): void {
		this.assertActive();
		if (!this.grant && this.pendingAuthorizationGeneration === null) return;
		this.dropAuthorization();
		this.publish();
	}

	cancel(): void {
		this.assertActive();
		if (!this.runAsset && this.session.getState().phase === "IDLE") return;
		this.dropAuthorization();
		this.stopOwnerForSource("EXPLICIT_CANCEL");
		this.session.invalidate("EXPLICIT_CANCEL");
	}

	clearSource(): void {
		this.assertActive();
		if (!this.runAsset && this.session.getState().phase === "IDLE") return;
		this.dropAuthorization();
		this.stopOwnerForSource("SOURCE_SWITCH");
		this.runAsset = null;
		this.session.invalidate("SOURCE_SWITCH");
	}

	replaceProject(projectId: string, document: RailDocument): void {
		this.assertActive();
		assertProjectId(projectId);
		if (this.projectId === projectId && this.document === document) return;
		this.unsubscribeDocument();
		this.dropAuthorization();
		this.stopOwnerForSource("PROJECT_REPLACEMENT");
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
		this.owner.dispose();
		this.session.dispose();
		this.unsubscribeOwner();
		this.unsubscribeSession();
		this.listeners.clear();
	}

	private invalidateAuthoredMutation(): void {
		if (this.disposed || !this.runAsset) return;
		const sessionState = this.session.getState();
		if (sessionState.phase === "INVALIDATED" && sessionState.reason === "AUTHORED_MUTATION") {
			return;
		}
		this.dropAuthorization();
		this.stopOwnerForSource("AUTHORED_MUTATION");
		this.session.invalidate("AUTHORED_MUTATION");
	}

	private stopOwnerForSource(
		reason: "AUTHORED_MUTATION" | "PROJECT_REPLACEMENT" | "SOURCE_SWITCH" | "EXPLICIT_CANCEL",
	): void {
		const phase = this.owner.getState().phase;
		if (phase === "ACTIVE" || phase === "STARTING") this.owner.invalidateSource(reason);
	}

	private dropAuthorization(): void {
		if (this.grant) discardSimulationResidentRunAuthorizationGrant(this.grant);
		this.grant = null;
		this.authorizationInput = null;
		this.pendingAuthorizationGeneration = null;
	}

	private captureState(): SimulationResidentScenarioEditorControllerState {
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
			authorization: this.grant ? authorizationSummary(this.grant.authorization) : null,
			activeRun: this.owner.getState(),
		});
	}

	private publish(): void {
		this.state = this.captureState();
		for (const listener of this.listeners) listener();
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Resident scenario editor controller is disposed.");
	}

	private assertCurrentDocumentSource(
		components: SimulationReadinessComponents,
		operationalConfigurationFingerprint: string,
	): void {
		const mismatch = this.currentDocumentSourceMismatch(
			components,
			operationalConfigurationFingerprint,
		);
		if (mismatch === null) return;
		throw new Error(
			`Resident scenario sources do not match the exact current project document (${mismatch}).`,
		);
	}

	private currentDocumentSourceMatches(
		components: SimulationReadinessComponents,
		operationalConfigurationFingerprint: string,
	): boolean {
		return (
			this.currentDocumentSourceMismatch(components, operationalConfigurationFingerprint) === null
		);
	}

	private currentDocumentSourceMismatch(
		components: SimulationReadinessComponents,
		operationalConfigurationFingerprint: string,
	): string | null {
		try {
			const current = this.readLiveSource(this.document);
			const source = components.foundation.source;
			if (liveSourceIdentityError(current) !== null) return "LIVE_SOURCE_INVALID";
			const mismatches: string[] = [];
			if (current.patchSequence !== source.patchSequence) mismatches.push("PATCH_SEQUENCE");
			if (current.revision !== source.revision) mismatches.push("REVISION");
			if (current.authoredChecksum !== source.authoredChecksum) {
				mismatches.push("AUTHORED_CHECKSUM");
			}
			if (current.operationalConfigurationFingerprint !== operationalConfigurationFingerprint) {
				mismatches.push("OPERATIONAL_CONFIGURATION");
			}
			return mismatches.length === 0 ? null : mismatches.join("+");
		} catch {
			return "LIVE_SOURCE_UNAVAILABLE";
		}
	}
}

function authorizationSummary(
	authorization: SimulationResidentRunAuthorization,
): SimulationResidentAuthorizationSummary {
	return Object.freeze({
		fingerprint: authorization.fingerprint,
		preparationGeneration: authorization.preparationGeneration,
		authorizationGeneration: authorization.authorizationGeneration,
		readinessProfileId: authorization.sourceReadinessProfileId,
		requestCount: authorization.requestCount,
		loadCount: authorization.loadCount,
		vehicleCount: authorization.vehicleCount,
		eqResourceCount: authorization.eqResourceCount,
		storageResourceCount: authorization.storageResourceCount,
	});
}

function nextPositiveGeneration(current: number): number {
	return current === Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, current + 1);
}

function assertProjectId(projectId: string): void {
	if (
		typeof projectId !== "string" ||
		projectId.length === 0 ||
		projectId.length > 128 ||
		!isPortableProjectId(projectId)
	) {
		throw new TypeError("Resident scenario project ID is invalid.");
	}
}

function isPortableProjectId(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		const alphaNumeric =
			(code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
		if (alphaNumeric) continue;
		if (index > 0 && (code === 46 || code === 47 || code === 58 || code === 95 || code === 45)) {
			continue;
		}
		return false;
	}
	return true;
}

function readRailDocumentLiveSource(
	document: RailDocument,
): SimulationResidentEditorLiveSourceIdentity {
	return Object.freeze({
		patchSequence: document.getPatchSequence(),
		revision: document.map.getRevision(),
		authoredChecksum: checksumRailMap(document.map, document.portEquipment, document.organizations),
		operationalConfigurationFingerprint: checksumOperationalConfiguration(
			document.operationalConfiguration,
		),
	});
}

function liveSourceIdentityError(value: unknown): string | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return "resident editor live source identity must be an object";
	}
	const source = value as Record<string, unknown>;
	const expectedKeys = [
		"patchSequence",
		"revision",
		"authoredChecksum",
		"operationalConfigurationFingerprint",
	];
	if (
		Object.keys(source).length !== expectedKeys.length ||
		!expectedKeys.every((key) => Object.hasOwn(source, key)) ||
		!Number.isSafeInteger(source.patchSequence) ||
		(source.patchSequence as number) < 0 ||
		!Number.isSafeInteger(source.revision) ||
		(source.revision as number) < 0 ||
		typeof source.authoredChecksum !== "string" ||
		source.authoredChecksum.length === 0 ||
		typeof source.operationalConfigurationFingerprint !== "string" ||
		source.operationalConfigurationFingerprint.length === 0
	) {
		return "resident editor live source identity is invalid";
	}
	return null;
}
