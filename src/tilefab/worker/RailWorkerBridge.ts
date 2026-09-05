import {
	hydrateStaticFabOrganizationOutlineIndexSnapshot,
	type StaticFabOrganizationOutlineIndex,
	type StaticFabOrganizationOutlineIndexSourceIdentity,
} from "../compile/StaticFabOrganizationOutlineIndex";
import {
	checksumOperationalConfigurationState,
	emptyOperationalConfigurationState,
} from "../core/OperationalConfiguration";
import type { RailDocument, RailPatchEvent } from "../core/RailDocument";
import {
	adoptRailMirrorSnapshotCaptureHandoff,
	captureRailMirrorSnapshot,
	checksumRailMap,
	checksumRailMirrorSnapshot,
	issueRailMirrorSnapshotCaptureHandoff,
	RailChecksumAccumulator,
	type RailMirrorSnapshot,
	type RailMirrorSnapshotCaptureHandoff,
	revokeRailMirrorSnapshotCaptureHandoff,
} from "./RailMirrorChecksum";
import {
	EMPTY_RAIL_PHYSICAL_LAYOUT_STATE,
	type RailPhysicalLayoutState,
	type RailPhysicalPublication,
} from "./RailPhysicalLayout";
import {
	releaseValidatedRailStartupSnapshotForFullValidation,
	type ValidatedRailStartupSnapshotAuthority,
} from "./RailStartupSnapshotActivation";
import {
	type EncodedRailPatch,
	encodeRailPatchEvent,
	encodeReviewedPortEquipmentRailPatchEventCooperatively,
	type MainToRailMirrorMessage,
	type RailMirrorToMainMessage,
	railMirrorSnapshotTransfers,
} from "./railMirrorProtocol";

export type RailWorkerBridgeStatus = "idle" | "syncing" | "ready" | "desynced" | "error";

export interface RailWorkerBridgeState extends RailPhysicalLayoutState {
	status: RailWorkerBridgeStatus;
	/** Remains false until a same-worker OHT consumer applies every published migration. */
	simulationReady: boolean;
	epoch: number;
	targetSequence: number;
	targetRevision: number;
	targetChecksum: string;
	targetCells: number;
	targetEdges: number;
	targetSwitches: number;
	targetPorts: number;
	targetEquipmentGroups: number;
	targetOrganizations: number;
	targetAssemblyRelationships: number;
	targetAssemblyRelationshipNextId: number;
	targetOperationalConfigurationRevision: number;
	targetOperationalConfigurationFingerprint: string;
	/** Latest authored state actually published by the worker. */
	sequence: number;
	revision: number;
	checksum: string;
	cells: number;
	edges: number;
	switches: number;
	ports: number;
	equipmentGroups: number;
	organizations: number;
	assemblyRelationships: number;
	assemblyRelationshipNextId: number;
	operationalConfigurationRevision: number;
	operationalConfigurationFingerprint: string;
	message: string | null;
}

export const INITIAL_RAIL_WORKER_STATE: RailWorkerBridgeState = {
	...EMPTY_RAIL_PHYSICAL_LAYOUT_STATE,
	status: "idle",
	simulationReady: false,
	epoch: 0,
	targetSequence: 0,
	targetRevision: 0,
	targetChecksum:
		"00000002:00000000:00000000:00000000:00000000:00000000:00000000:00000001:00000000:00000001:00000000:00000000",
	targetCells: 0,
	targetEdges: 0,
	targetSwitches: 0,
	targetPorts: 0,
	targetEquipmentGroups: 0,
	targetOrganizations: 0,
	targetAssemblyRelationships: 0,
	targetAssemblyRelationshipNextId: 1,
	targetOperationalConfigurationRevision: 0,
	targetOperationalConfigurationFingerprint: checksumOperationalConfigurationState(
		emptyOperationalConfigurationState(),
	),
	sequence: 0,
	revision: 0,
	checksum:
		"00000002:00000000:00000000:00000000:00000000:00000000:00000000:00000001:00000000:00000001:00000000:00000000",
	cells: 0,
	edges: 0,
	switches: 0,
	ports: 0,
	equipmentGroups: 0,
	organizations: 0,
	assemblyRelationships: 0,
	assemblyRelationshipNextId: 1,
	operationalConfigurationRevision: 0,
	operationalConfigurationFingerprint: checksumOperationalConfigurationState(
		emptyOperationalConfigurationState(),
	),
	message: null,
};

export interface RailWorkerPort {
	onmessage: ((event: MessageEvent<RailMirrorToMainMessage>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(message: MainToRailMirrorMessage, transfer?: Transferable[]): void;
	terminate(): void;
}

const MAX_AUTOMATIC_RESYNCS = 2;
const MAX_PENDING_RAIL_ACKNOWLEDGEMENTS = 2_048;
const MAX_PENDING_SNAPSHOT_CAPTURES = 4;
const RAIL_SNAPSHOT_CAPTURE_TIMEOUT_MILLISECONDS = 30_000;
const MAX_PENDING_ORGANIZATION_OUTLINE_CAPTURES = 2;
const ORGANIZATION_OUTLINE_CAPTURE_TIMEOUT_MILLISECONDS = 30_000;

interface ExpectedRailAcknowledgement {
	checksum: string;
	baseSequence: number;
	baseRevision: number;
	revision: number;
	switches: number;
	ports: number;
	equipmentGroups: number;
	organizations: number;
	assemblyRelationships: number;
	assemblyRelationshipNextId: number;
	operationalConfigurationRevision: number;
	operationalConfigurationFingerprint: string;
	physicalPublicationKind: RailPhysicalPublication["kind"];
}

export interface RailWorkerReadyExpectation {
	readonly checksum: string;
	readonly physicalFingerprint: string;
	readonly sequence: number;
	readonly revision: number;
}

export interface RailWorkerAuthoredReadyExpectation {
	readonly checksum: string;
	readonly sequence: number;
	readonly revision: number;
}

export interface RailWorkerBridgeHandle {
	getState(): RailWorkerBridgeState;
	prepareReviewedPortEquipmentPatchCooperatively?(
		event: RailPatchEvent,
		checkpoint: () => Promise<void>,
		operationBudget?: number,
	): Promise<void>;
	captureCurrentSnapshot(signal?: AbortSignal): Promise<RailMirrorSnapshot>;
	captureCurrentOrganizationOutline(
		signal?: AbortSignal,
	): Promise<StaticFabOrganizationOutlineIndex>;
	dispose(): void;
	waitUntilAuthoredReady(
		expectation: RailWorkerAuthoredReadyExpectation,
		signal?: AbortSignal,
	): Promise<RailWorkerBridgeState>;
	waitUntilReady(
		expectation: RailWorkerReadyExpectation,
		signal?: AbortSignal,
	): Promise<RailWorkerBridgeState>;
}

interface RailWorkerReadyWaiter {
	readonly expectation: RailWorkerReadyExpectation | RailWorkerAuthoredReadyExpectation;
	readonly requireExactPhysicalFingerprint: boolean;
	readonly resolve: (state: RailWorkerBridgeState) => void;
	readonly reject: (error: Error) => void;
	readonly signal?: AbortSignal;
	readonly abortListener?: () => void;
}

interface RailWorkerSnapshotCaptureWaiter {
	readonly requestId: number;
	readonly epoch: number;
	readonly sequence: number;
	readonly revision: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly nextRelationshipId: number;
	readonly map: RailDocument["map"];
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly handoff: RailMirrorSnapshotCaptureHandoff;
	readonly resolve: (snapshot: RailMirrorSnapshot) => void;
	readonly reject: (error: Error) => void;
	readonly signal?: AbortSignal;
	readonly abortListener?: () => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

interface RailWorkerAbandonedSnapshotCapture {
	readonly requestId: number;
	readonly epoch: number;
	readonly timeout: ReturnType<typeof setTimeout>;
}

interface RailWorkerOrganizationOutlineCaptureWaiter {
	readonly requestId: number;
	readonly epoch: number;
	readonly source: StaticFabOrganizationOutlineIndexSourceIdentity;
	readonly map: RailDocument["map"];
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly resolve: (outline: StaticFabOrganizationOutlineIndex) => void;
	readonly reject: (error: Error) => void;
	readonly signal?: AbortSignal;
	readonly abortListener?: () => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

interface RailWorkerAbandonedOrganizationOutlineCapture {
	readonly requestId: number;
	readonly epoch: number;
	readonly timeout: ReturnType<typeof setTimeout>;
}

interface RailWorkerInitialSnapshotBinding {
	readonly document: RailDocument;
	readonly map: RailDocument["map"];
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly operationalConfiguration: RailDocument["operationalConfiguration"];
	readonly operationalConfigurationFingerprint: string;
	readonly snapshot: RailMirrorSnapshot;
	readonly xs: Int32Array;
	readonly ys: Int32Array;
	readonly encoded: Uint8Array;
	readonly switchIds: Int32Array;
	readonly switchRecords: RailMirrorSnapshot["switchRecords"];
	readonly portEquipmentSnapshot: RailMirrorSnapshot["portEquipment"];
	readonly organizationSnapshot: RailMirrorSnapshot["organizations"];
	readonly relationshipSnapshot: RailMirrorSnapshot["relationships"];
	readonly transferables: readonly Transferable[];
	readonly sequence: number;
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly nextRelationshipId: number;
	readonly cellCount: number;
	readonly edgeCount: number;
	readonly switchCount: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly organizationCount: number;
	readonly relationshipCount: number;
	readonly checkCancelled?: () => void;
}

interface RailWorkerInitialSnapshotValidation {
	readonly checksum: RailChecksumAccumulator;
	readonly binding: RailWorkerInitialSnapshotBinding;
}

interface PreparedReviewedPortEquipmentPatch {
	readonly epoch: number;
	readonly baseSequence: number;
	readonly encoded: EncodedRailPatch;
	readonly expectedChecksum: RailChecksumAccumulator;
}

/** Module-private registry; only the exact snapshot object can spend its entry once. */
const cooperativelyValidatedInitialSnapshotAuthorities = new WeakMap<
	RailMirrorSnapshot,
	RailWorkerInitialSnapshotBinding
>();

function armCooperativelyValidatedRailWorkerInitialSnapshot(
	document: RailDocument,
	snapshot: RailMirrorSnapshot,
	checkCancelled?: () => void,
): void {
	checkCancelled?.();
	if (cooperativelyValidatedInitialSnapshotAuthorities.has(snapshot)) {
		throw new Error("Validated initial rail Worker snapshot authority is already armed.");
	}
	const binding = captureInitialSnapshotBinding(document, snapshot, checkCancelled);
	const mismatch = initialSnapshotBindingMismatch(binding, document, binding.transferables);
	if (mismatch) {
		throw new Error(`Validated initial rail Worker snapshot cannot be armed: ${mismatch}`);
	}
	cooperativelyValidatedInitialSnapshotAuthorities.set(snapshot, binding);
}

function revokeCooperativelyValidatedRailWorkerInitialSnapshot(snapshot: RailMirrorSnapshot): void {
	cooperativelyValidatedInitialSnapshotAuthorities.delete(snapshot);
}

/** Build the default Bridge without ever exposing the private validated snapshot to its caller. */
export function createRailWorkerBridgeFromValidatedStartup(
	document: RailDocument,
	onState: (state: RailWorkerBridgeState) => void,
	authority: ValidatedRailStartupSnapshotAuthority,
	checkCancelled?: () => void,
	createWorker?: () => RailWorkerPort,
): RailWorkerBridge {
	checkCancelled?.();
	const snapshot = releaseValidatedRailStartupSnapshotForFullValidation(
		authority,
		document.map,
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
	if (!snapshot) {
		throw new Error(
			"Validated initial rail Worker snapshot lacks exact cooperative-validation provenance.",
		);
	}
	armCooperativelyValidatedRailWorkerInitialSnapshot(document, snapshot, checkCancelled);
	try {
		return new RailWorkerBridge(document, onState, createWorker, snapshot);
	} finally {
		revokeCooperativelyValidatedRailWorkerInitialSnapshot(snapshot);
	}
}

/** Main-thread owner of ordered rail patch delivery and worker checksum acknowledgements. */
export class RailWorkerBridge implements RailWorkerBridgeHandle {
	private readonly document: RailDocument;
	private worker: RailWorkerPort;
	private readonly createWorker: () => RailWorkerPort;
	private readonly onState: (state: RailWorkerBridgeState) => void;
	private readonly unsubscribe: () => void;
	private state = INITIAL_RAIL_WORKER_STATE;
	private expectedChecksum = new RailChecksumAccumulator();
	private expectedBySequence = new Map<number, ExpectedRailAcknowledgement>();
	private latestSentSequence = 0;
	private latestAcknowledgedSequence = -1;
	private epoch = 0;
	private automaticResyncs = 0;
	private disposed = false;
	private readonly readyWaiters = new Set<RailWorkerReadyWaiter>();
	private readonly snapshotCaptureWaiters = new Map<number, RailWorkerSnapshotCaptureWaiter>();
	private readonly abandonedSnapshotCaptures = new Map<
		number,
		RailWorkerAbandonedSnapshotCapture
	>();
	private nextSnapshotCaptureRequestId = 1;
	private readonly organizationOutlineCaptureWaiters = new Map<
		number,
		RailWorkerOrganizationOutlineCaptureWaiter
	>();
	private readonly abandonedOrganizationOutlineCaptures = new Map<
		number,
		RailWorkerAbandonedOrganizationOutlineCapture
	>();
	private nextOrganizationOutlineCaptureRequestId = 1;
	private preparedReviewedPortEquipmentPatches = new WeakMap<
		RailPatchEvent,
		PreparedReviewedPortEquipmentPatch
	>();

	constructor(
		document: RailDocument,
		onState: (state: RailWorkerBridgeState) => void,
		createWorker: () => RailWorkerPort = () =>
			new Worker(new URL("./railMirrorWorker.ts", import.meta.url), {
				type: "module",
			}) as RailWorkerPort,
		initialSnapshot?: RailMirrorSnapshot,
	) {
		const initialSnapshotValidation = assertInitialSnapshotIdentity(document, initialSnapshot);
		this.document = document;
		this.onState = onState;
		this.createWorker = createWorker;
		this.worker = this.createWorker();
		this.bindWorker(this.worker);
		this.unsubscribe = document.subscribe((event) => this.forwardPatch(event));
		try {
			this.syncCurrentDocument(initialSnapshot, initialSnapshotValidation);
		} catch (error) {
			this.disposed = true;
			this.unsubscribe();
			this.worker.onmessage = null;
			this.worker.onerror = null;
			try {
				this.worker.terminate();
			} catch {
				// Preserve the identity/cancellation failure that made the bootstrap unsafe.
			}
			throw error;
		}
	}

	getState(): RailWorkerBridgeState {
		return this.state;
	}

	/** Prepare one exact unpublished reviewed-Apply packet without advancing bridge state. */
	async prepareReviewedPortEquipmentPatchCooperatively(
		event: RailPatchEvent,
		checkpoint: () => Promise<void>,
		operationBudget = 128,
	): Promise<void> {
		if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
			throw new RangeError("Rail Worker patch preparation operation budget must be positive.");
		}
		if (
			this.disposed ||
			this.state.status === "error" ||
			event.sequence !== this.latestSentSequence + 1
		) {
			return;
		}
		const epoch = this.epoch;
		const baseSequence = this.latestSentSequence;
		const encoded = await encodeReviewedPortEquipmentRailPatchEventCooperatively(
			event,
			checkpoint,
			operationBudget,
			{ compactOrganizations: true },
		);
		if (!this.patchPreparationSourceIsCurrent(epoch, baseSequence, event)) return;
		const expectedChecksum = this.expectedChecksum.clone();
		expectedChecksum.applyOrganizationNextId(
			event.organizationNextIdBefore,
			event.organizationNextIdAfter,
		);
		expectedChecksum.applyAssemblyRelationshipNextId(
			event.relationshipNextIdBefore,
			event.relationshipNextIdAfter,
		);
		let operations = 0;
		const consumeOperation = async (): Promise<void> => {
			operations++;
			if (operations < operationBudget) return;
			operations = 0;
			await checkpoint();
		};
		for (const change of event.portChanges) {
			expectedChecksum.applyPortMutation(change);
			await consumeOperation();
		}
		for (const change of event.equipmentGroupChanges) {
			expectedChecksum.applyEquipmentGroupMutation(change);
			await consumeOperation();
		}
		await checkpoint();
		if (!this.patchPreparationSourceIsCurrent(epoch, baseSequence, event)) return;
		this.preparedReviewedPortEquipmentPatches.set(
			event,
			Object.freeze({ epoch, baseSequence, encoded, expectedChecksum }),
		);
	}

	captureCurrentOrganizationOutline(
		signal?: AbortSignal,
	): Promise<StaticFabOrganizationOutlineIndex> {
		if (this.disposed) {
			return Promise.reject(new Error("Rail worker bridge is already disposed."));
		}
		if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
		if (
			this.organizationOutlineCaptureWaiters.size > 0 ||
			this.organizationOutlineCaptureWaiters.size +
				this.abandonedOrganizationOutlineCaptures.size >=
				MAX_PENDING_ORGANIZATION_OUTLINE_CAPTURES
		) {
			return Promise.reject(
				new Error("Static FAB organization outline queue exceeded its bounded capacity."),
			);
		}
		const sourceError = this.currentOrganizationOutlineSourceError();
		if (sourceError) return Promise.reject(new Error(sourceError));

		const map = this.document.map;
		const portEquipment = this.document.portEquipment;
		const organizations = this.document.organizations;
		const source: StaticFabOrganizationOutlineIndexSourceIdentity = Object.freeze({
			sequence: this.document.getPatchSequence(),
			revision: map.getRevision(),
			checksum: this.expectedChecksum.digest(),
			nextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			nextPortId: portEquipment.nextPortId,
			nextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
			physicalSequence: this.state.physicalSequence,
			physicalRevision: this.state.physicalRevision,
			physicalFingerprint: this.state.physicalFingerprint,
		});
		const requestId = this.nextOrganizationOutlineCaptureRequestId++;
		return new Promise((resolve, reject) => {
			const abortListener = signal
				? () => {
						const waiter = this.organizationOutlineCaptureWaiters.get(requestId);
						if (!waiter || waiter.epoch !== this.epoch) return;
						this.abandonOrganizationOutlineCapture(
							requestId,
							new DOMException("Static FAB organization outline capture cancelled.", "AbortError"),
						);
					}
				: undefined;
			const timeout = setTimeout(() => {
				const pending =
					this.organizationOutlineCaptureWaiters.get(requestId) ??
					this.abandonedOrganizationOutlineCaptures.get(requestId);
				if (!pending || pending.epoch !== this.epoch) return;
				this.recover(
					`Static FAB organization outline capture timed out after ${ORGANIZATION_OUTLINE_CAPTURE_TIMEOUT_MILLISECONDS} ms.`,
					true,
				);
			}, ORGANIZATION_OUTLINE_CAPTURE_TIMEOUT_MILLISECONDS);
			this.organizationOutlineCaptureWaiters.set(
				requestId,
				Object.freeze({
					requestId,
					epoch: this.epoch,
					source,
					map,
					portEquipment,
					organizations,
					resolve,
					reject,
					signal,
					abortListener,
					timeout,
				}),
			);
			signal?.addEventListener("abort", abortListener as EventListener, {
				once: true,
			});
			if (signal?.aborted) {
				abortListener?.();
				return;
			}
			this.post({
				type: "CAPTURE_STATIC_FAB_ORGANIZATION_OUTLINE",
				epoch: this.epoch,
				requestId,
				expectedSequence: source.sequence,
				expectedRevision: source.revision,
				expectedChecksum: source.checksum,
				expectedNextAdvancedSwitchId: source.nextAdvancedSwitchId,
				expectedNextPortId: source.nextPortId,
				expectedNextEquipmentGroupId: source.nextEquipmentGroupId,
				expectedNextOrganizationId: source.nextOrganizationId,
				expectedPhysicalSequence: source.physicalSequence,
				expectedPhysicalRevision: source.physicalRevision,
				expectedPhysicalFingerprint: source.physicalFingerprint,
			});
		});
	}

	captureCurrentSnapshot(signal?: AbortSignal): Promise<RailMirrorSnapshot> {
		if (this.disposed) {
			return Promise.reject(new Error("Rail worker bridge is already disposed."));
		}
		if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
		if (
			this.snapshotCaptureWaiters.size + this.abandonedSnapshotCaptures.size >=
			MAX_PENDING_SNAPSHOT_CAPTURES
		) {
			return Promise.reject(
				new Error("Rail snapshot capture queue exceeded its bounded capacity."),
			);
		}
		const sourceError = this.currentSnapshotSourceError();
		if (sourceError) return Promise.reject(new Error(sourceError));

		const map = this.document.map;
		const portEquipment = this.document.portEquipment;
		const organizations = this.document.organizations;
		const relationships = this.document.relationships;
		const sequence = this.document.getPatchSequence();
		const revision = map.getRevision();
		const checksum = this.expectedChecksum.digest();
		let handoff: RailMirrorSnapshotCaptureHandoff;
		try {
			handoff = issueRailMirrorSnapshotCaptureHandoff(
				map,
				sequence,
				portEquipment,
				organizations,
				relationships,
				checksum,
			);
		} catch (error) {
			return Promise.reject(new Error(errorMessage(error)));
		}

		const requestId = this.nextSnapshotCaptureRequestId++;
		return new Promise((resolve, reject) => {
			const abortListener = signal
				? () => {
						const waiter = this.snapshotCaptureWaiters.get(requestId);
						if (!waiter || waiter.epoch !== this.epoch) return;
						this.abandonSnapshotCapture(
							requestId,
							new DOMException("Rail snapshot capture cancelled.", "AbortError"),
						);
					}
				: undefined;
			const timeout = setTimeout(() => {
				const pending =
					this.snapshotCaptureWaiters.get(requestId) ??
					this.abandonedSnapshotCaptures.get(requestId);
				if (!pending || pending.epoch !== this.epoch) return;
				const message = `Rail snapshot capture timed out after ${RAIL_SNAPSHOT_CAPTURE_TIMEOUT_MILLISECONDS} ms.`;
				this.recover(message, true);
			}, RAIL_SNAPSHOT_CAPTURE_TIMEOUT_MILLISECONDS);
			this.snapshotCaptureWaiters.set(
				requestId,
				Object.freeze({
					requestId,
					epoch: this.epoch,
					sequence,
					revision,
					checksum,
					nextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
					nextPortId: portEquipment.nextPortId,
					nextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
					nextOrganizationId: organizations.nextOrganizationId,
					nextRelationshipId: relationships.nextRelationshipId,
					map,
					portEquipment,
					organizations,
					relationships,
					handoff,
					resolve,
					reject,
					signal,
					abortListener,
					timeout,
				}),
			);
			signal?.addEventListener("abort", abortListener as EventListener, {
				once: true,
			});
			if (signal?.aborted) {
				abortListener?.();
				return;
			}
			this.post({
				type: "CAPTURE_RAIL_SNAPSHOT",
				epoch: this.epoch,
				requestId,
				expectedSequence: sequence,
				expectedRevision: revision,
				expectedChecksum: checksum,
				expectedNextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
				expectedNextPortId: portEquipment.nextPortId,
				expectedNextEquipmentGroupId: portEquipment.nextEquipmentGroupId,
				expectedNextOrganizationId: organizations.nextOrganizationId,
				expectedNextRelationshipId: relationships.nextRelationshipId,
			});
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.preparedReviewedPortEquipmentPatches = new WeakMap();
		this.unsubscribe();
		this.worker.onmessage = null;
		this.worker.onerror = null;
		this.worker.terminate();
		this.rejectSnapshotCaptures(
			new Error("Rail worker bridge was disposed before snapshot capture."),
		);
		this.clearAbandonedSnapshotCaptures();
		this.rejectOrganizationOutlineCaptures(
			new Error("Rail worker bridge was disposed before organization outline capture."),
		);
		this.clearAbandonedOrganizationOutlineCaptures();
		this.rejectReadyWaiters(new Error("Rail worker bridge was disposed before synchronization."));
	}

	waitUntilReady(
		expectation: RailWorkerReadyExpectation,
		signal?: AbortSignal,
	): Promise<RailWorkerBridgeState> {
		return this.waitForReady(expectation, true, signal);
	}

	waitUntilAuthoredReady(
		expectation: RailWorkerAuthoredReadyExpectation,
		signal?: AbortSignal,
	): Promise<RailWorkerBridgeState> {
		return this.waitForReady(expectation, false, signal);
	}

	private waitForReady(
		expectation: RailWorkerReadyExpectation | RailWorkerAuthoredReadyExpectation,
		requireExactPhysicalFingerprint: boolean,
		signal?: AbortSignal,
	): Promise<RailWorkerBridgeState> {
		if (this.disposed) {
			return Promise.reject(new Error("Rail worker bridge is already disposed."));
		}
		if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
		const immediate = requireExactPhysicalFingerprint
			? readyExpectationError(this.state, expectation as RailWorkerReadyExpectation)
			: authoredReadyExpectationError(
					this.state,
					expectation as RailWorkerAuthoredReadyExpectation,
				);
		if (this.state.status === "ready") {
			return immediate ? Promise.reject(new Error(immediate)) : Promise.resolve(this.state);
		}
		if (this.state.status === "error") {
			return Promise.reject(new Error(this.state.message ?? "Rail worker synchronization failed."));
		}
		return new Promise((resolve, reject) => {
			const abortListener = signal
				? () => {
						this.readyWaiters.delete(waiter);
						reject(new DOMException("Aborted", "AbortError"));
					}
				: undefined;
			const waiter: RailWorkerReadyWaiter = {
				expectation,
				requireExactPhysicalFingerprint,
				resolve,
				reject,
				signal,
				abortListener,
			};
			this.readyWaiters.add(waiter);
			signal?.addEventListener("abort", abortListener as EventListener, {
				once: true,
			});
			if (signal?.aborted) abortListener?.();
		});
	}

	private syncCurrentDocument(
		initialSnapshot?: RailMirrorSnapshot,
		initialSnapshotValidation?: RailWorkerInitialSnapshotValidation,
	): void {
		if (this.disposed || this.state.status === "error") return;
		this.preparedReviewedPortEquipmentPatches = new WeakMap();
		const capture = initialSnapshot
			? {
					snapshot: initialSnapshot,
					checksum:
						initialSnapshotValidation?.checksum ??
						RailChecksumAccumulator.fromDigest(initialSnapshot.checksum),
				}
			: captureRailMirrorSnapshot(
					this.document.map,
					this.document.getPatchSequence(),
					this.document.portEquipment,
					this.document.organizations,
					this.document.relationships,
				);
		this.epoch++;
		this.expectedChecksum = capture.checksum;
		this.latestSentSequence = capture.snapshot.sequence;
		this.latestAcknowledgedSequence = capture.snapshot.sequence - 1;
		this.expectedBySequence.clear();
		const operationalConfigurationFingerprint = checksumOperationalConfigurationState(
			this.document.operationalConfiguration,
		);
		this.expectedBySequence.set(capture.snapshot.sequence, {
			checksum: capture.snapshot.checksum,
			baseSequence: capture.snapshot.sequence,
			baseRevision: capture.snapshot.revision,
			revision: capture.snapshot.revision,
			switches: capture.checksum.switchCount,
			ports: capture.checksum.portCount,
			equipmentGroups: capture.checksum.equipmentGroupCount,
			organizations: capture.checksum.organizationCount,
			assemblyRelationships: capture.checksum.assemblyRelationshipCount,
			assemblyRelationshipNextId: capture.checksum.assemblyRelationshipNextId,
			operationalConfigurationRevision: this.document.operationalConfiguration.revision,
			operationalConfigurationFingerprint,
			physicalPublicationKind: "reset",
		});
		this.update({
			...this.state,
			status: "syncing",
			epoch: this.epoch,
			targetSequence: capture.snapshot.sequence,
			targetRevision: capture.snapshot.revision,
			targetChecksum: capture.snapshot.checksum,
			targetCells: capture.checksum.cellCount,
			targetEdges: capture.checksum.edgeCount,
			targetSwitches: capture.checksum.switchCount,
			targetPorts: capture.checksum.portCount,
			targetEquipmentGroups: capture.checksum.equipmentGroupCount,
			targetOrganizations: capture.checksum.organizationCount,
			targetAssemblyRelationships: capture.checksum.assemblyRelationshipCount,
			targetAssemblyRelationshipNextId: capture.checksum.assemblyRelationshipNextId,
			targetOperationalConfigurationRevision: this.document.operationalConfiguration.revision,
			targetOperationalConfigurationFingerprint: operationalConfigurationFingerprint,
			message: null,
		});
		const message: MainToRailMirrorMessage = {
			type: "SYNC_RAIL",
			epoch: this.epoch,
			snapshot: capture.snapshot,
			operationalConfiguration: this.document.operationalConfiguration,
			historyLedger: this.document.captureRailMirrorHistoryLedger(),
		};
		const transfers = railMirrorSnapshotTransfers(capture.snapshot);
		if (initialSnapshotValidation) {
			assertInitialSnapshotStillCurrent(
				initialSnapshotValidation.binding,
				this.document,
				transfers,
			);
		}
		this.post(message, transfers);
	}

	private forwardPatch(patch: RailPatchEvent): void {
		if (this.disposed) return;
		if (this.state.status === "error") return;
		this.abandonOrganizationOutlineCaptures(
			new Error(
				"Static FAB organization outline capture became stale because the authored document changed.",
			),
		);
		this.abandonSnapshotCaptures(
			new Error("Rail snapshot capture became stale because the authored document changed."),
		);
		try {
			if (patch.sequence !== this.latestSentSequence + 1) {
				this.recover(
					`Main patch sequence gap: expected ${this.latestSentSequence + 1}, received ${patch.sequence}.`,
				);
				return;
			}
			const prepared = this.preparedReviewedPortEquipmentPatches.get(patch);
			this.preparedReviewedPortEquipmentPatches.delete(patch);
			let encoded: EncodedRailPatch;
			if (
				prepared &&
				prepared.epoch === this.epoch &&
				prepared.baseSequence === this.latestSentSequence
			) {
				encoded = prepared.encoded;
				this.expectedChecksum = prepared.expectedChecksum;
			} else {
				this.expectedChecksum.applyOrganizationNextId(
					patch.organizationNextIdBefore,
					patch.organizationNextIdAfter,
				);
				this.expectedChecksum.applyAssemblyRelationshipNextId(
					patch.relationshipNextIdBefore,
					patch.relationshipNextIdAfter,
				);
				encoded = encodeRailPatchEvent(patch, { compactOrganizations: true });
				for (const change of patch.changes) this.expectedChecksum.applyMutation(change);
				for (const change of patch.switchChanges) {
					this.expectedChecksum.applySwitchMutation(change);
				}
				for (const change of patch.portChanges) {
					this.expectedChecksum.applyPortMutation(change);
				}
				for (const change of patch.equipmentGroupChanges) {
					this.expectedChecksum.applyEquipmentGroupMutation(change);
				}
				for (const change of patch.organizationChanges) {
					this.expectedChecksum.applyOrganizationMutation(change);
				}
				for (const change of patch.relationshipChanges) {
					this.expectedChecksum.applyAssemblyRelationshipMutation(change);
				}
			}
			this.latestSentSequence = patch.sequence;
			const checksum = this.expectedChecksum.digest();
			const operationalConfigurationFingerprint = checksumOperationalConfigurationState(
				this.document.operationalConfiguration,
			);
			this.expectedBySequence.set(patch.sequence, {
				checksum,
				baseSequence: patch.sequence - 1,
				baseRevision: patch.baseRevision,
				revision: patch.revision,
				switches: this.expectedChecksum.switchCount,
				ports: this.expectedChecksum.portCount,
				equipmentGroups: this.expectedChecksum.equipmentGroupCount,
				organizations: this.expectedChecksum.organizationCount,
				assemblyRelationships: this.expectedChecksum.assemblyRelationshipCount,
				assemblyRelationshipNextId: this.expectedChecksum.assemblyRelationshipNextId,
				operationalConfigurationRevision: this.document.operationalConfiguration.revision,
				operationalConfigurationFingerprint,
				physicalPublicationKind:
					patch.changes.length > 0 || patch.switchChanges.length > 0 ? "delta" : "static",
			});
			if (this.expectedBySequence.size > MAX_PENDING_RAIL_ACKNOWLEDGEMENTS) {
				this.recover("Rail worker acknowledgement queue exceeded its bounded capacity.");
				return;
			}
			this.update({
				...this.state,
				status: "syncing",
				targetSequence: patch.sequence,
				targetRevision: patch.revision,
				targetChecksum: checksum,
				targetCells: this.expectedChecksum.cellCount,
				targetEdges: this.expectedChecksum.edgeCount,
				targetSwitches: this.expectedChecksum.switchCount,
				targetPorts: this.expectedChecksum.portCount,
				targetEquipmentGroups: this.expectedChecksum.equipmentGroupCount,
				targetOrganizations: this.expectedChecksum.organizationCount,
				targetAssemblyRelationships: this.expectedChecksum.assemblyRelationshipCount,
				targetAssemblyRelationshipNextId: this.expectedChecksum.assemblyRelationshipNextId,
				targetOperationalConfigurationRevision: this.document.operationalConfiguration.revision,
				targetOperationalConfigurationFingerprint: operationalConfigurationFingerprint,
				message: null,
			});
			this.post(
				{ type: "APPLY_RAIL_PATCH", epoch: this.epoch, patch: encoded.patch },
				encoded.transfer,
			);
		} catch (error) {
			this.update({
				...this.state,
				status: "error",
				message: errorMessage(error),
			});
		}
	}

	private patchPreparationSourceIsCurrent(
		epoch: number,
		baseSequence: number,
		event: RailPatchEvent,
	): boolean {
		return (
			!this.disposed &&
			(this.state.status === "ready" || this.state.status === "syncing") &&
			this.epoch === epoch &&
			this.latestSentSequence === baseSequence &&
			event.sequence === baseSequence + 1
		);
	}

	private handleMessage(message: RailMirrorToMainMessage): void {
		if (this.disposed || message.epoch !== this.epoch) return;
		if (this.state.status === "error") return;
		if (
			message.type === "RAIL_SNAPSHOT_CAPTURED" ||
			message.type === "RAIL_SNAPSHOT_CAPTURE_FAILED"
		) {
			this.handleSnapshotCaptureMessage(message);
			return;
		}
		if (
			message.type === "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED" ||
			message.type === "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURE_FAILED"
		) {
			this.handleOrganizationOutlineCaptureMessage(message);
			return;
		}
		if (message.type === "RAIL_DESYNC") {
			this.recover(message.message);
			return;
		}
		if (message.type === "RAIL_MIRROR_ERROR") {
			this.recover(message.message, true);
			return;
		}

		if (message.sequence <= this.latestAcknowledgedSequence) return;
		if (message.sequence !== this.latestAcknowledgedSequence + 1) {
			this.recover(
				`Rail worker acknowledgement gap: expected ${this.latestAcknowledgedSequence + 1}, received ${message.sequence}.`,
			);
			return;
		}
		if (message.sequence > this.latestSentSequence) {
			this.recover(
				`Rail worker acknowledged future sequence ${message.sequence}; latest sent is ${this.latestSentSequence}.`,
			);
			return;
		}
		const expected = this.expectedBySequence.get(message.sequence);
		if (!expected || expected.checksum !== message.checksum) {
			this.recover(
				`Rail worker checksum mismatch at sequence ${message.sequence}: expected ${expected?.checksum ?? "missing"}, received ${message.checksum}.`,
			);
			return;
		}
		if (message.revision !== expected.revision) {
			this.recover(
				`Rail worker revision mismatch at sequence ${message.sequence}: expected ${expected.revision}, received ${message.revision}.`,
			);
			return;
		}
		if (
			message.operationalConfigurationRevision !== expected.operationalConfigurationRevision ||
			message.operationalConfigurationFingerprint !== expected.operationalConfigurationFingerprint
		) {
			this.recover(
				`Rail worker operational configuration mismatch at sequence ${message.sequence}.`,
			);
			return;
		}
		const physicalStateError = validatePhysicalState(message, expected, this.state);
		if (physicalStateError) {
			this.recover(physicalStateError);
			return;
		}
		// Worker messages are FIFO. A valid rail acknowledgement proves that every earlier abandoned
		// read-only outline request completed, even if its response was intentionally ignored.
		this.clearAbandonedOrganizationOutlineCaptures();
		for (const sequence of this.expectedBySequence.keys()) {
			if (sequence <= message.sequence) this.expectedBySequence.delete(sequence);
		}
		this.latestAcknowledgedSequence = message.sequence;
		const ready = message.sequence === this.latestSentSequence;
		if (ready) this.automaticResyncs = 0;
		const acknowledgement = acknowledgementPayload(message);
		this.update({
			...this.state,
			...acknowledgement,
			status: ready ? "ready" : "syncing",
			message: null,
		});
	}

	private handleSnapshotCaptureMessage(
		message: Extract<
			RailMirrorToMainMessage,
			{ type: "RAIL_SNAPSHOT_CAPTURED" | "RAIL_SNAPSHOT_CAPTURE_FAILED" }
		>,
	): void {
		const waiter = this.snapshotCaptureWaiters.get(message.requestId);
		if (!waiter) {
			const abandoned = this.abandonedSnapshotCaptures.get(message.requestId);
			if (!abandoned) return;
			this.abandonedSnapshotCaptures.delete(message.requestId);
			clearTimeout(abandoned.timeout);
			if (message.type === "RAIL_SNAPSHOT_CAPTURE_FAILED") {
				this.recover(`Abandoned rail snapshot capture failed: ${message.message}`, true);
			}
			return;
		}
		if (message.type === "RAIL_SNAPSHOT_CAPTURE_FAILED") {
			this.rejectSnapshotCapture(message.requestId, new Error(message.message));
			this.recover(`Authoritative rail snapshot capture failed: ${message.message}`, true);
			return;
		}
		let accepted = false;
		try {
			accepted =
				this.snapshotCaptureWaiterIsCurrent(waiter) &&
				message.snapshot.sequence === waiter.sequence &&
				message.snapshot.revision === waiter.revision &&
				message.snapshot.checksum === waiter.checksum &&
				message.snapshot.nextAdvancedSwitchId === waiter.nextAdvancedSwitchId &&
				message.snapshot.portEquipment.nextPortId === waiter.nextPortId &&
				message.snapshot.portEquipment.nextEquipmentGroupId === waiter.nextEquipmentGroupId &&
				message.snapshot.organizations.nextOrganizationId === waiter.nextOrganizationId &&
				message.snapshot.relationships.nextRelationshipId === waiter.nextRelationshipId &&
				adoptRailMirrorSnapshotCaptureHandoff(waiter.handoff, message.snapshot);
		} catch {
			accepted = false;
		}
		if (!accepted) {
			this.rejectSnapshotCapture(
				message.requestId,
				new Error("Rail mirror returned a stale or malformed authored snapshot handoff."),
			);
			this.recover("Rail mirror returned a stale or malformed authored snapshot handoff.", true);
			return;
		}
		this.snapshotCaptureWaiters.delete(message.requestId);
		clearTimeout(waiter.timeout);
		waiter.signal?.removeEventListener("abort", waiter.abortListener as EventListener);
		waiter.resolve(message.snapshot);
	}

	private handleOrganizationOutlineCaptureMessage(
		message: Extract<
			RailMirrorToMainMessage,
			{
				type:
					| "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED"
					| "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURE_FAILED";
			}
		>,
	): void {
		const waiter = this.organizationOutlineCaptureWaiters.get(message.requestId);
		if (!waiter) {
			const abandoned = this.abandonedOrganizationOutlineCaptures.get(message.requestId);
			if (!abandoned) return;
			this.abandonedOrganizationOutlineCaptures.delete(message.requestId);
			clearTimeout(abandoned.timeout);
			return;
		}
		if (message.type === "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURE_FAILED") {
			this.rejectOrganizationOutlineCapture(message.requestId, new Error(message.message));
			return;
		}
		let outline: StaticFabOrganizationOutlineIndex | null = null;
		try {
			if (!this.organizationOutlineCaptureWaiterIsCurrent(waiter)) {
				throw new Error("Static FAB organization outline source is no longer current.");
			}
			outline = hydrateStaticFabOrganizationOutlineIndexSnapshot(message.outline, waiter.source);
		} catch (error) {
			this.rejectOrganizationOutlineCapture(
				message.requestId,
				new Error(
					`Rail mirror returned a stale or malformed organization outline: ${errorMessage(error)}`,
				),
			);
			return;
		}
		this.organizationOutlineCaptureWaiters.delete(message.requestId);
		clearTimeout(waiter.timeout);
		waiter.signal?.removeEventListener("abort", waiter.abortListener as EventListener);
		waiter.resolve(outline);
	}

	private currentSnapshotSourceError(): string | null {
		const state = this.state;
		const document = this.document;
		const checksum = this.expectedChecksum.digest();
		if (state.status !== "ready") return "Rail worker must be ready before snapshot capture.";
		if (state.simulationReady !== false) {
			return "Rail worker snapshot capture cannot change the simulation readiness gate.";
		}
		if (
			state.epoch !== this.epoch ||
			state.sequence !== document.getPatchSequence() ||
			state.targetSequence !== document.getPatchSequence() ||
			state.revision !== document.map.getRevision() ||
			state.targetRevision !== document.map.getRevision() ||
			state.checksum !== checksum ||
			state.targetChecksum !== checksum ||
			state.assemblyRelationships !== document.relationships.records.length ||
			state.targetAssemblyRelationships !== document.relationships.records.length ||
			state.assemblyRelationshipNextId !== document.relationships.nextRelationshipId ||
			state.targetAssemblyRelationshipNextId !== document.relationships.nextRelationshipId
		) {
			return "Rail worker does not match the current authored document identity.";
		}
		return null;
	}

	private currentOrganizationOutlineSourceError(): string | null {
		const sourceError = this.currentSnapshotSourceError();
		if (sourceError) return sourceError;
		const state = this.state;
		if (
			state.physicalSequence !== state.sequence ||
			state.physicalRevision !== state.revision ||
			!state.physicalFingerprint
		) {
			return "Rail worker physical identity is not ready for organization outline capture.";
		}
		return null;
	}

	private snapshotCaptureWaiterIsCurrent(waiter: RailWorkerSnapshotCaptureWaiter): boolean {
		return (
			waiter.epoch === this.epoch &&
			this.currentSnapshotSourceError() === null &&
			this.document.map === waiter.map &&
			this.document.portEquipment === waiter.portEquipment &&
			this.document.organizations === waiter.organizations &&
			this.document.relationships === waiter.relationships &&
			this.document.getPatchSequence() === waiter.sequence &&
			this.document.map.getRevision() === waiter.revision &&
			this.document.map.getAdvancedSwitchIdCursor() === waiter.nextAdvancedSwitchId &&
			this.document.portEquipment.nextPortId === waiter.nextPortId &&
			this.document.portEquipment.nextEquipmentGroupId === waiter.nextEquipmentGroupId &&
			this.document.organizations.nextOrganizationId === waiter.nextOrganizationId &&
			this.document.relationships.nextRelationshipId === waiter.nextRelationshipId &&
			this.expectedChecksum.digest() === waiter.checksum
		);
	}

	private organizationOutlineCaptureWaiterIsCurrent(
		waiter: RailWorkerOrganizationOutlineCaptureWaiter,
	): boolean {
		const source = waiter.source;
		return (
			waiter.epoch === this.epoch &&
			this.currentOrganizationOutlineSourceError() === null &&
			this.document.map === waiter.map &&
			this.document.portEquipment === waiter.portEquipment &&
			this.document.organizations === waiter.organizations &&
			this.document.getPatchSequence() === source.sequence &&
			this.document.map.getRevision() === source.revision &&
			this.document.map.getAdvancedSwitchIdCursor() === source.nextAdvancedSwitchId &&
			this.document.portEquipment.nextPortId === source.nextPortId &&
			this.document.portEquipment.nextEquipmentGroupId === source.nextEquipmentGroupId &&
			this.document.organizations.nextOrganizationId === source.nextOrganizationId &&
			this.expectedChecksum.digest() === source.checksum &&
			this.state.physicalSequence === source.physicalSequence &&
			this.state.physicalRevision === source.physicalRevision &&
			this.state.physicalFingerprint === source.physicalFingerprint
		);
	}

	private rejectSnapshotCapture(requestId: number, error: Error): void {
		const waiter = this.snapshotCaptureWaiters.get(requestId);
		if (!waiter) return;
		this.snapshotCaptureWaiters.delete(requestId);
		clearTimeout(waiter.timeout);
		waiter.signal?.removeEventListener("abort", waiter.abortListener as EventListener);
		revokeRailMirrorSnapshotCaptureHandoff(waiter.handoff);
		waiter.reject(error);
	}

	private abandonSnapshotCapture(requestId: number, error: Error): void {
		const waiter = this.snapshotCaptureWaiters.get(requestId);
		if (!waiter) return;
		this.snapshotCaptureWaiters.delete(requestId);
		waiter.signal?.removeEventListener("abort", waiter.abortListener as EventListener);
		revokeRailMirrorSnapshotCaptureHandoff(waiter.handoff);
		this.abandonedSnapshotCaptures.set(
			requestId,
			Object.freeze({
				requestId,
				epoch: waiter.epoch,
				timeout: waiter.timeout,
			}),
		);
		waiter.reject(error);
	}

	private abandonSnapshotCaptures(error: Error): void {
		for (const requestId of [...this.snapshotCaptureWaiters.keys()]) {
			this.abandonSnapshotCapture(requestId, error);
		}
	}

	private rejectSnapshotCaptures(error: Error): void {
		for (const requestId of [...this.snapshotCaptureWaiters.keys()]) {
			this.rejectSnapshotCapture(requestId, error);
		}
	}

	private clearAbandonedSnapshotCaptures(): void {
		for (const abandoned of this.abandonedSnapshotCaptures.values()) {
			clearTimeout(abandoned.timeout);
		}
		this.abandonedSnapshotCaptures.clear();
	}

	private rejectOrganizationOutlineCapture(requestId: number, error: Error): void {
		const waiter = this.organizationOutlineCaptureWaiters.get(requestId);
		if (!waiter) return;
		this.organizationOutlineCaptureWaiters.delete(requestId);
		clearTimeout(waiter.timeout);
		waiter.signal?.removeEventListener("abort", waiter.abortListener as EventListener);
		waiter.reject(error);
	}

	private abandonOrganizationOutlineCapture(requestId: number, error: Error): void {
		const waiter = this.organizationOutlineCaptureWaiters.get(requestId);
		if (!waiter) return;
		this.organizationOutlineCaptureWaiters.delete(requestId);
		waiter.signal?.removeEventListener("abort", waiter.abortListener as EventListener);
		this.abandonedOrganizationOutlineCaptures.set(
			requestId,
			Object.freeze({
				requestId,
				epoch: waiter.epoch,
				timeout: waiter.timeout,
			}),
		);
		waiter.reject(error);
	}

	private abandonOrganizationOutlineCaptures(error: Error): void {
		for (const requestId of [...this.organizationOutlineCaptureWaiters.keys()]) {
			this.abandonOrganizationOutlineCapture(requestId, error);
		}
	}

	private rejectOrganizationOutlineCaptures(error: Error): void {
		for (const requestId of [...this.organizationOutlineCaptureWaiters.keys()]) {
			this.rejectOrganizationOutlineCapture(requestId, error);
		}
	}

	private clearAbandonedOrganizationOutlineCaptures(): void {
		for (const abandoned of this.abandonedOrganizationOutlineCaptures.values()) {
			clearTimeout(abandoned.timeout);
		}
		this.abandonedOrganizationOutlineCaptures.clear();
	}

	private recover(message: string, replaceTerminalWorker = false): void {
		if (this.disposed) return;
		if (this.state.status === "error") return;
		this.preparedReviewedPortEquipmentPatches = new WeakMap();
		this.rejectSnapshotCaptures(new Error(`Rail snapshot capture failed: ${message}`));
		this.clearAbandonedSnapshotCaptures();
		this.rejectOrganizationOutlineCaptures(
			new Error(`Static FAB organization outline capture failed: ${message}`),
		);
		this.clearAbandonedOrganizationOutlineCaptures();
		if (this.state.status === "desynced") {
			if (!replaceTerminalWorker) return;
			try {
				this.replaceWorker();
			} catch (error) {
				this.update({
					...this.state,
					status: "error",
					message: errorMessage(error),
				});
			}
			return;
		}
		if (this.automaticResyncs >= MAX_AUTOMATIC_RESYNCS) {
			this.update({ ...this.state, status: "error", message });
			return;
		}
		this.automaticResyncs++;
		this.update({ ...this.state, status: "desynced", message });
		if (replaceTerminalWorker) {
			try {
				this.replaceWorker();
			} catch (error) {
				this.update({
					...this.state,
					status: "error",
					message: errorMessage(error),
				});
				return;
			}
		}
		queueMicrotask(() => this.syncCurrentDocument());
	}

	private bindWorker(worker: RailWorkerPort): void {
		worker.onmessage = (event: MessageEvent<RailMirrorToMainMessage>) => {
			this.handleMessage(event.data);
		};
		worker.onerror = (event) => {
			this.recover(event.message || "Rail worker execution failed.", true);
		};
	}

	private replaceWorker(): void {
		const previous = this.worker;
		previous.onmessage = null;
		previous.onerror = null;
		previous.terminate();
		const replacement = this.createWorker();
		this.worker = replacement;
		this.bindWorker(replacement);
	}

	private post(message: MainToRailMirrorMessage, transfer: Transferable[] = []): void {
		try {
			this.worker.postMessage(message, transfer);
		} catch (error) {
			this.update({
				...this.state,
				status: "error",
				message: errorMessage(error),
			});
		}
	}

	private update(state: RailWorkerBridgeState): void {
		this.state = state;
		this.onState(state);
		if (state.status === "ready") this.resolveReadyWaiters(state);
		else if (state.status === "error") {
			const error = new Error(state.message ?? "Rail worker synchronization failed.");
			this.rejectSnapshotCaptures(error);
			this.clearAbandonedSnapshotCaptures();
			this.rejectOrganizationOutlineCaptures(error);
			this.clearAbandonedOrganizationOutlineCaptures();
			this.rejectReadyWaiters(error);
		}
	}

	private resolveReadyWaiters(state: RailWorkerBridgeState): void {
		for (const waiter of this.readyWaiters) {
			this.readyWaiters.delete(waiter);
			waiter.signal?.removeEventListener("abort", waiter.abortListener as EventListener);
			const error = waiter.requireExactPhysicalFingerprint
				? readyExpectationError(state, waiter.expectation as RailWorkerReadyExpectation)
				: authoredReadyExpectationError(
						state,
						waiter.expectation as RailWorkerAuthoredReadyExpectation,
					);
			if (error) waiter.reject(new Error(error));
			else waiter.resolve(state);
		}
	}

	private rejectReadyWaiters(error: Error): void {
		for (const waiter of this.readyWaiters) {
			this.readyWaiters.delete(waiter);
			waiter.signal?.removeEventListener("abort", waiter.abortListener as EventListener);
			waiter.reject(error);
		}
	}
}

function assertInitialSnapshotIdentity(
	document: RailDocument,
	snapshot: RailMirrorSnapshot | undefined,
): RailWorkerInitialSnapshotValidation | undefined {
	if (!snapshot) return undefined;
	const authority = cooperativelyValidatedInitialSnapshotAuthorities.get(snapshot);
	cooperativelyValidatedInitialSnapshotAuthorities.delete(snapshot);
	if (authority) {
		authority.checkCancelled?.();
		const mismatch = initialSnapshotBindingMismatch(
			authority,
			document,
			railMirrorSnapshotTransfers(snapshot),
		);
		if (mismatch) {
			throw new Error(`Validated initial rail Worker snapshot authority is stale: ${mismatch}`);
		}
		return Object.freeze({
			checksum: RailChecksumAccumulator.fromDigest(authority.checksum),
			binding: authority,
		});
	}
	const actualSnapshotChecksum = checksumRailMirrorSnapshot(snapshot);
	if (actualSnapshotChecksum !== snapshot.checksum) {
		throw new Error("Initial rail Worker snapshot checksum does not match its typed buffers.");
	}
	const documentChecksum = checksumRailMap(
		document.map,
		document.portEquipment,
		document.organizations,
		document.relationships,
	);
	if (
		snapshot.sequence !== document.getPatchSequence() ||
		snapshot.revision !== document.map.getRevision() ||
		snapshot.nextAdvancedSwitchId !== document.map.getAdvancedSwitchIdCursor() ||
		snapshot.portEquipment.nextPortId !== document.portEquipment.nextPortId ||
		snapshot.portEquipment.nextEquipmentGroupId !== document.portEquipment.nextEquipmentGroupId ||
		snapshot.organizations.nextOrganizationId !== document.organizations.nextOrganizationId ||
		snapshot.relationships.nextRelationshipId !== document.relationships.nextRelationshipId ||
		snapshot.checksum !== documentChecksum
	) {
		throw new Error("Initial rail Worker snapshot does not match the active document identity.");
	}
	const binding = captureInitialSnapshotBinding(document, snapshot);
	const mismatch = initialSnapshotBindingMismatch(binding, document, binding.transferables);
	if (mismatch) {
		throw new Error(
			`Initial rail Worker snapshot does not match the active document identity: ${mismatch}`,
		);
	}
	return Object.freeze({
		checksum: RailChecksumAccumulator.fromDigest(snapshot.checksum),
		binding,
	});
}

function captureInitialSnapshotBinding(
	document: RailDocument,
	snapshot: RailMirrorSnapshot,
	checkCancelled?: () => void,
): RailWorkerInitialSnapshotBinding {
	const checksum = RailChecksumAccumulator.fromDigest(snapshot.checksum);
	return Object.freeze({
		document,
		map: document.map,
		portEquipment: document.portEquipment,
		organizations: document.organizations,
		relationships: document.relationships,
		operationalConfiguration: document.operationalConfiguration,
		operationalConfigurationFingerprint: checksumOperationalConfigurationState(
			document.operationalConfiguration,
		),
		snapshot,
		xs: snapshot.xs,
		ys: snapshot.ys,
		encoded: snapshot.encoded,
		switchIds: snapshot.switchIds,
		switchRecords: snapshot.switchRecords,
		portEquipmentSnapshot: snapshot.portEquipment,
		organizationSnapshot: snapshot.organizations,
		relationshipSnapshot: snapshot.relationships,
		transferables: Object.freeze(railMirrorSnapshotTransfers(snapshot)),
		sequence: document.getPatchSequence(),
		revision: document.map.getRevision(),
		mutationGeneration: document.map.getMutationGeneration(),
		checksum: snapshot.checksum,
		nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
		nextPortId: document.portEquipment.nextPortId,
		nextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: document.organizations.nextOrganizationId,
		nextRelationshipId: document.relationships.nextRelationshipId,
		cellCount: checksum.cellCount,
		edgeCount: checksum.edgeCount,
		switchCount: checksum.switchCount,
		portCount: checksum.portCount,
		equipmentGroupCount: checksum.equipmentGroupCount,
		organizationCount: checksum.organizationCount,
		relationshipCount: checksum.assemblyRelationshipCount,
		checkCancelled,
	});
}

function assertInitialSnapshotStillCurrent(
	binding: RailWorkerInitialSnapshotBinding,
	document: RailDocument,
	transferables: readonly Transferable[],
): void {
	binding.checkCancelled?.();
	const mismatch = initialSnapshotBindingMismatch(binding, document, transferables);
	if (mismatch) {
		throw new Error(`Initial rail Worker snapshot became stale before transfer: ${mismatch}`);
	}
}

function initialSnapshotBindingMismatch(
	binding: RailWorkerInitialSnapshotBinding,
	document: RailDocument,
	transferables: readonly Transferable[],
): string | null {
	const { snapshot } = binding;
	if (
		document !== binding.document ||
		document.map !== binding.map ||
		document.portEquipment !== binding.portEquipment ||
		document.organizations !== binding.organizations ||
		document.relationships !== binding.relationships ||
		document.operationalConfiguration !== binding.operationalConfiguration
	) {
		return "the active document generation changed";
	}
	if (
		snapshot !== binding.snapshot ||
		snapshot.xs !== binding.xs ||
		snapshot.ys !== binding.ys ||
		snapshot.encoded !== binding.encoded ||
		snapshot.switchIds !== binding.switchIds ||
		snapshot.switchRecords !== binding.switchRecords ||
		snapshot.portEquipment !== binding.portEquipmentSnapshot ||
		snapshot.organizations !== binding.organizationSnapshot ||
		snapshot.relationships !== binding.relationshipSnapshot
	) {
		return "the exact snapshot view identity changed";
	}
	if (!sameTransferableIdentities(transferables, binding.transferables)) {
		return "the exact snapshot transfer identity changed";
	}
	if (
		document.getPatchSequence() !== binding.sequence ||
		binding.map.getRevision() !== binding.revision ||
		binding.map.getMutationGeneration() !== binding.mutationGeneration ||
		binding.map.getAdvancedSwitchIdCursor() !== binding.nextAdvancedSwitchId ||
		snapshot.sequence !== binding.sequence ||
		snapshot.revision !== binding.revision ||
		snapshot.nextAdvancedSwitchId !== binding.nextAdvancedSwitchId ||
		snapshot.checksum !== binding.checksum ||
		snapshot.portEquipment.nextPortId !== binding.nextPortId ||
		snapshot.portEquipment.nextEquipmentGroupId !== binding.nextEquipmentGroupId ||
		snapshot.organizations.nextOrganizationId !== binding.nextOrganizationId ||
		snapshot.relationships.nextRelationshipId !== binding.nextRelationshipId ||
		binding.portEquipment.nextPortId !== binding.nextPortId ||
		binding.portEquipment.nextEquipmentGroupId !== binding.nextEquipmentGroupId ||
		binding.organizations.nextOrganizationId !== binding.nextOrganizationId ||
		binding.relationships.nextRelationshipId !== binding.nextRelationshipId
	) {
		return "the authored scalar identity changed";
	}
	if (
		checksumOperationalConfigurationState(binding.operationalConfiguration) !==
		binding.operationalConfigurationFingerprint
	) {
		return "the operational configuration identity changed";
	}
	if (
		binding.map.size !== binding.cellCount ||
		binding.map.edgeCount !== binding.edgeCount ||
		binding.map.advancedSwitchCount !== binding.switchCount ||
		binding.portEquipment.ports.length !== binding.portCount ||
		binding.portEquipment.equipmentGroups.length !== binding.equipmentGroupCount ||
		binding.organizations.records.length !== binding.organizationCount ||
		binding.relationships.records.length !== binding.relationshipCount ||
		snapshot.xs.length !== binding.cellCount ||
		snapshot.ys.length !== binding.cellCount ||
		snapshot.encoded.length !== binding.cellCount ||
		snapshot.switchIds.length !== binding.switchCount ||
		snapshot.portEquipment.portIds.length !== binding.portCount ||
		snapshot.portEquipment.equipmentGroupIds.length !== binding.equipmentGroupCount ||
		snapshot.organizations.organizationIds.length !== binding.organizationCount ||
		snapshot.relationships.relationshipIds.length !== binding.relationshipCount
	) {
		return "the checksum counters do not match the exact source and snapshot";
	}
	return null;
}

function sameTransferableIdentities(
	current: readonly Transferable[],
	expected: readonly Transferable[],
): boolean {
	return (
		current.length === expected.length &&
		current.every((transferable, index) => transferable === expected[index])
	);
}

function readyExpectationError(
	state: RailWorkerBridgeState,
	expectation: RailWorkerReadyExpectation,
): string | null {
	if (state.status !== "ready") return null;
	if (!railWorkerStateMatchesReadyExpectation(state, expectation)) {
		return "Rail worker acknowledgement does not match the candidate authored and physical identity.";
	}
	return null;
}

function authoredReadyExpectationError(
	state: RailWorkerBridgeState,
	expectation: RailWorkerAuthoredReadyExpectation,
): string | null {
	if (state.status !== "ready") return null;
	if (!railWorkerStateMatchesAuthoredReadyExpectation(state, expectation)) {
		return "Rail worker acknowledgement does not match the candidate authored identity.";
	}
	return null;
}

export function railWorkerStateMatchesAuthoredReadyExpectation(
	state: RailWorkerBridgeState,
	expectation: RailWorkerAuthoredReadyExpectation,
): boolean {
	return (
		state.status === "ready" &&
		state.simulationReady === false &&
		state.targetSequence === expectation.sequence &&
		state.targetRevision === expectation.revision &&
		state.targetChecksum === expectation.checksum &&
		state.sequence === expectation.sequence &&
		state.revision === expectation.revision &&
		state.checksum === expectation.checksum &&
		state.targetCells === state.cells &&
		state.targetEdges === state.edges &&
		state.targetSwitches === state.switches &&
		state.targetPorts === state.ports &&
		state.targetEquipmentGroups === state.equipmentGroups &&
		state.targetOrganizations === state.organizations &&
		state.targetAssemblyRelationships === state.assemblyRelationships &&
		state.targetAssemblyRelationshipNextId === state.assemblyRelationshipNextId &&
		state.targetOperationalConfigurationRevision === state.operationalConfigurationRevision &&
		state.targetOperationalConfigurationFingerprint === state.operationalConfigurationFingerprint &&
		state.physicalSequence === expectation.sequence &&
		state.physicalRevision === expectation.revision &&
		isPhysicalFingerprint(state.physicalFingerprint) &&
		state.physicalValid
	);
}

export function railWorkerStateMatchesReadyExpectation(
	state: RailWorkerBridgeState,
	expectation: RailWorkerReadyExpectation,
): boolean {
	return (
		railWorkerStateMatchesAuthoredReadyExpectation(state, expectation) &&
		state.physicalFingerprint === expectation.physicalFingerprint
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown rail worker bridge error.";
}

function acknowledgementPayload(
	message: Extract<RailMirrorToMainMessage, { type: "RAIL_SYNCED" | "RAIL_PATCH_APPLIED" }>,
): Omit<typeof message, "type"> {
	const payload: Partial<typeof message> = { ...message };
	delete payload.type;
	return payload as Omit<typeof message, "type">;
}

function validatePhysicalState(
	message: Extract<RailMirrorToMainMessage, { type: "RAIL_SYNCED" | "RAIL_PATCH_APPLIED" }>,
	expected: ExpectedRailAcknowledgement,
	previousState: RailWorkerBridgeState,
): string | null {
	if (message.physicalSequence !== message.sequence) {
		return `Rail worker physical sequence ${message.physicalSequence} does not match authored sequence ${message.sequence}.`;
	}
	if (message.physicalRevision !== expected.revision) {
		return `Rail worker physical revision ${message.physicalRevision} does not match expected revision ${expected.revision}.`;
	}
	if (message.switches !== expected.switches) {
		return `Rail worker advanced switch count ${message.switches} does not match expected count ${expected.switches}.`;
	}
	if (
		message.ports !== expected.ports ||
		message.equipmentGroups !== expected.equipmentGroups ||
		message.organizations !== expected.organizations ||
		message.assemblyRelationships !== expected.assemblyRelationships ||
		message.assemblyRelationshipNextId !== expected.assemblyRelationshipNextId
	) {
		return `Rail worker static entity identity ${message.ports}/${message.equipmentGroups}/${message.organizations}/${message.assemblyRelationships}@${message.assemblyRelationshipNextId} does not match expected ${expected.ports}/${expected.equipmentGroups}/${expected.organizations}/${expected.assemblyRelationships}@${expected.assemblyRelationshipNextId}.`;
	}
	const counters = [
		message.physicalPathCount,
		message.physicalPointCount,
		message.physicalCompoundProfileCount,
		message.physicalClearanceEnvelopeCount,
		message.physicalClearanceIssueCount,
		message.physicalIntervalRemapCount,
		message.physicalJunctionCount,
		message.physicalAdvancedSwitchCount,
		message.physicalDiagnosticCount,
		message.migrationSourcePathCount,
		message.migrationTargetPathCount,
		message.migrationRowCount,
		message.migrationMatchedRawPathCount,
		message.migrationUnmappableSourcePathCount,
		message.migrationIdentityRowCount,
		message.migrationTranslationRowCount,
		message.migrationProjectionRowCount,
		message.migrationDeletedRowCount,
		message.migrationUnmappableRowCount,
	];
	if (counters.some((value) => !Number.isSafeInteger(value) || value < 0)) {
		return "Rail worker returned invalid physical layout counters.";
	}
	if (message.physicalAdvancedSwitchCount !== message.switches) {
		return `Rail worker compiled switch count ${message.physicalAdvancedSwitchCount} does not match authored count ${message.switches}.`;
	}
	if (!/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(message.physicalFingerprint)) {
		return `Rail worker returned invalid physical fingerprint ${message.physicalFingerprint}.`;
	}
	if (expected.physicalPublicationKind === "delta") {
		if (message.physicalPublicationKind !== "delta" || !message.previousPhysicalAvailable) {
			return "Rail worker did not publish the required previous/current physical pair.";
		}
		if (!message.migrationAvailable) return "Rail worker omitted the required physical migration.";
		if (
			message.previousPhysicalSequence !== expected.baseSequence ||
			message.previousPhysicalRevision !== expected.baseRevision ||
			message.migrationFromSequence !== expected.baseSequence ||
			message.migrationFromRevision !== expected.baseRevision ||
			message.migrationToSequence !== message.sequence ||
			message.migrationToRevision !== expected.revision
		) {
			return `Rail worker migration identity mismatch: expected ${expected.baseSequence}/${expected.baseRevision}->${message.sequence}/${expected.revision}.`;
		}
		if (
			previousState.physicalSequence !== expected.baseSequence ||
			previousState.physicalRevision !== expected.baseRevision ||
			message.previousPhysicalFingerprint !== previousState.physicalFingerprint ||
			message.migrationFromFingerprint !== message.previousPhysicalFingerprint ||
			message.migrationToFingerprint !== message.physicalFingerprint
		) {
			return "Rail worker migration does not bind the acknowledged physical layout pair.";
		}
		if (
			!isPhysicalFingerprint(message.previousPhysicalFingerprint) ||
			!isPhysicalFingerprint(message.migrationFromFingerprint) ||
			!isPhysicalFingerprint(message.migrationToFingerprint) ||
			message.migrationSourcePathCount !== previousState.physicalPathCount ||
			message.migrationTargetPathCount !== message.physicalPathCount ||
			message.migrationUnmappableSourcePathCount > message.migrationSourcePathCount
		) {
			return "Rail worker returned invalid migration layout metadata.";
		}
		if (!/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(message.migrationFingerprint)) {
			return `Rail worker returned invalid migration fingerprint ${message.migrationFingerprint}.`;
		}
	} else if (expected.physicalPublicationKind === "reset") {
		if (
			message.physicalPublicationKind !== "reset" ||
			message.previousPhysicalAvailable ||
			message.previousPhysicalSequence !== 0 ||
			message.previousPhysicalRevision !== 0 ||
			message.previousPhysicalFingerprint !== "00000000:00000000"
		) {
			return "Rail worker attached previous physical state to a snapshot acknowledgement.";
		}
		if (!hasEmptyMigrationState(message, expected.revision)) {
			return "Rail worker attached migration state to a snapshot acknowledgement.";
		}
	} else {
		if (
			message.physicalPublicationKind !== "static" ||
			!message.previousPhysicalAvailable ||
			message.previousPhysicalSequence !== expected.baseSequence ||
			message.previousPhysicalRevision !== expected.baseRevision ||
			previousState.physicalSequence !== expected.baseSequence ||
			previousState.physicalRevision !== expected.baseRevision ||
			message.previousPhysicalFingerprint !== previousState.physicalFingerprint
		) {
			return "Rail worker static publication does not bind the previous physical layout.";
		}
		if (expected.baseRevision !== expected.revision) {
			return "Static-world patch unexpectedly changed the physical rail revision.";
		}
		if (!hasSamePhysicalLayout(message, previousState)) {
			return "Rail worker recompiled or changed physical rail buffers for a static-world patch.";
		}
		if (!hasEmptyMigrationState(message, expected.revision)) {
			return "Rail worker attached migration state to a static-world acknowledgement.";
		}
	}
	if (
		message.migrationIdentityRowCount +
			message.migrationTranslationRowCount +
			message.migrationProjectionRowCount +
			message.migrationDeletedRowCount +
			message.migrationUnmappableRowCount !==
		message.migrationRowCount
	) {
		return "Rail worker migration row-kind totals do not match its row count.";
	}
	if (
		!Number.isFinite(message.migrationMappedLengthMeters) ||
		message.migrationMappedLengthMeters < 0 ||
		!Number.isFinite(message.migrationUnmappableLengthMeters) ||
		message.migrationUnmappableLengthMeters < 0 ||
		!Number.isFinite(message.migrationMaxEndpointErrorMeters) ||
		message.migrationMaxEndpointErrorMeters < 0
	) {
		return "Rail worker returned invalid migration length totals.";
	}
	return null;
}

function hasEmptyMigrationState(
	message: Extract<RailMirrorToMainMessage, { type: "RAIL_SYNCED" | "RAIL_PATCH_APPLIED" }>,
	revision: number,
): boolean {
	return (
		!message.migrationAvailable &&
		message.migrationFromSequence === message.sequence &&
		message.migrationFromRevision === revision &&
		message.migrationFromFingerprint === message.physicalFingerprint &&
		message.migrationToSequence === message.sequence &&
		message.migrationToRevision === revision &&
		message.migrationToFingerprint === message.physicalFingerprint &&
		message.migrationFingerprint === "00000000:00000000" &&
		message.migrationRowCount === 0 &&
		message.migrationSourcePathCount === 0 &&
		message.migrationTargetPathCount === 0 &&
		message.migrationMatchedRawPathCount === 0 &&
		message.migrationUnmappableSourcePathCount === 0 &&
		message.migrationMappedLengthMeters === 0 &&
		message.migrationUnmappableLengthMeters === 0 &&
		message.migrationMaxEndpointErrorMeters === 0
	);
}

function hasSamePhysicalLayout(
	message: Extract<RailMirrorToMainMessage, { type: "RAIL_SYNCED" | "RAIL_PATCH_APPLIED" }>,
	previous: RailWorkerBridgeState,
): boolean {
	return (
		message.physicalFingerprint === previous.physicalFingerprint &&
		message.physicalPathCount === previous.physicalPathCount &&
		message.physicalPointCount === previous.physicalPointCount &&
		message.physicalCompoundProfileCount === previous.physicalCompoundProfileCount &&
		message.physicalClearanceEnvelopeCount === previous.physicalClearanceEnvelopeCount &&
		message.physicalClearanceIssueCount === previous.physicalClearanceIssueCount &&
		message.physicalIntervalRemapCount === previous.physicalIntervalRemapCount &&
		message.physicalJunctionCount === previous.physicalJunctionCount &&
		message.physicalAdvancedSwitchCount === previous.physicalAdvancedSwitchCount &&
		message.physicalValid === previous.physicalValid &&
		message.physicalDiagnosticCount === previous.physicalDiagnosticCount
	);
}

function isPhysicalFingerprint(value: string): boolean {
	return /^[0-9a-f]{8}:[0-9a-f]{8}$/.test(value);
}
