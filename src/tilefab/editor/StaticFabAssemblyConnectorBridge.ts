import type { PortEquipmentState } from "../core/EquipmentGroup";
import type {
	StaticFabAssemblyConnectorIntent,
	StaticFabAssemblyConnectorPlan,
} from "../core/StaticFabAssemblyConnector";
import {
	adoptStaticFabAssemblyConnectorWorkerPlan,
	issueStaticFabAssemblyConnectorPermit,
	revokeStaticFabAssemblyConnectorPermit,
	type StaticFabAssemblyConnectorPermit,
	staticFabAssemblyConnectorIntentFingerprint,
} from "../core/StaticFabAssemblyConnectorCertification";
import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
import {
	checksumRailPatchResult,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import {
	type PreparedStaticFabAssemblyConnector,
	STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
	type StaticFabAssemblyConnectorHydratedResponse,
	type StaticFabAssemblyConnectorWorkerRequest,
	type StaticFabAssemblyConnectorWorkerResponse,
} from "../worker/StaticFabAssemblyConnectorProtocol";
import { staticFabAssemblyConnectorPreparedShapeError } from "../worker/StaticFabAssemblyConnectorResponseValidator";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabAssemblyConnectorWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabAssemblyConnectorWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabAssemblyConnectorWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabAssemblyConnectorLiveState {
	readonly map: TileMap;
	readonly patchSequence: number;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
}

export interface StaticFabAssemblyConnectorBindingInput {
	readonly snapshot: RailMirrorSnapshot;
	readonly getCurrentState: () => StaticFabAssemblyConnectorLiveState;
}

export interface StaticFabAssemblyConnectorInput {
	readonly intent: StaticFabAssemblyConnectorIntent;
}

export interface ValidatedStaticFabAssemblyConnector {
	readonly plan: StaticFabAssemblyConnectorPlan | null;
	readonly validation: PreparedStaticFabAssemblyConnector;
	readonly certified: boolean;
	readonly workerRoundTripMilliseconds: number;
	readonly responseValidationMilliseconds: number;
	readonly adoptionMilliseconds: number;
}

interface StaticFabAssemblyConnectorSourceIdentity {
	readonly revision: number;
	readonly sequence: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
}

interface StaticFabAssemblyConnectorBinding {
	readonly identity: StaticFabAssemblyConnectorSourceIdentity;
	readonly source: StaticFabAssemblyConnectorLiveState;
	readonly getCurrentState: () => StaticFabAssemblyConnectorLiveState;
}

interface ActiveStaticFabAssemblyConnectorRequest {
	readonly requestId: number;
	readonly permit: StaticFabAssemblyConnectorPermit;
	readonly intent: StaticFabAssemblyConnectorIntent;
	readonly intentFingerprint: string;
	readonly source: StaticFabAssemblyConnectorLiveState;
	readonly requestStartedAt: number;
	readonly resolve: (value: ValidatedStaticFabAssemblyConnector) => void;
	readonly reject: (error: Error) => void;
}

interface QueuedStaticFabAssemblyConnectorRequest {
	readonly input: StaticFabAssemblyConnectorInput;
	readonly resolve: (value: ValidatedStaticFabAssemblyConnector) => void;
	readonly reject: (error: Error) => void;
}

/** Persistent, revision-bound and latest-request-wins Assembly Connector Worker adapter. */
export class StaticFabAssemblyConnectorBridge {
	private readonly createWorker: () => StaticFabAssemblyConnectorWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabAssemblyConnectorWorkerPort | null = null;
	private binding: StaticFabAssemblyConnectorBinding | null = null;
	private hydrationPromise: Promise<number> | null = null;
	private terminalError: Error | null = null;
	private hydrated = false;
	private hydrationRequestId: number | null = null;
	private hydrationResolve: ((milliseconds: number) => void) | null = null;
	private hydrationReject: ((error: Error) => void) | null = null;
	private active: ActiveStaticFabAssemblyConnectorRequest | null = null;
	private queued: QueuedStaticFabAssemblyConnectorRequest | null = null;
	private inFlightRequestId: number | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => StaticFabAssemblyConnectorWorkerPort = () =>
			new Worker(new URL("../worker/staticFabAssemblyConnectorWorker.ts", import.meta.url), {
				type: "module",
			}) as StaticFabAssemblyConnectorWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	initialize(input: StaticFabAssemblyConnectorBindingInput): Promise<number> {
		if (this.hydrationPromise) {
			return Promise.reject(new Error("Assembly Connector Worker is already initialized."));
		}
		const source = input.getCurrentState();
		const snapshot = input.snapshot;
		if (!snapshotMatchesLiveState(snapshot, source)) {
			return Promise.reject(
				new Error("Assembly Connector snapshot is stale before Worker planning."),
			);
		}
		if (
			!consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				source.map,
				source.patchSequence,
				source.portEquipment,
				source.organizations,
				source.relationships,
			)
		) {
			return Promise.reject(
				new Error(
					"Assembly Connector snapshot was not captured from the current authored generations.",
				),
			);
		}
		const identity = snapshotIdentity(snapshot);
		this.terminalError = null;
		this.hydrated = false;
		this.binding = Object.freeze({ identity, source, getCurrentState: input.getCurrentState });
		const requestId = this.nextRequestId++;
		const request: StaticFabAssemblyConnectorWorkerRequest = {
			type: "HYDRATE_STATIC_FAB_ASSEMBLY_CONNECTOR",
			version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
			requestId,
			snapshot,
		};

		let worker: StaticFabAssemblyConnectorWorkerPort;
		try {
			worker = this.createWorker();
		} catch (error) {
			this.binding = null;
			return Promise.reject(workerError(error, "Assembly Connector Worker creation failed."));
		}
		this.worker = worker;
		this.installWorkerHandlers(worker);
		this.hydrationRequestId = requestId;
		this.hydrationPromise = new Promise<number>((resolve, reject) => {
			this.hydrationResolve = resolve;
			this.hydrationReject = reject;
		});
		this.armTimeout(() => {
			this.failWorker(
				new Error(`Assembly Connector Worker timed out after ${this.timeoutMilliseconds} ms.`),
			);
		});
		try {
			worker.postMessage(request, collectTransferableBuffers(snapshot));
		} catch (error) {
			this.failWorker(workerError(error, "Assembly Connector Worker hydration failed."));
		}
		return this.hydrationPromise;
	}

	prepare(input: StaticFabAssemblyConnectorInput): Promise<ValidatedStaticFabAssemblyConnector> {
		const hydration = this.hydrationPromise;
		if (!hydration) {
			return Promise.reject(
				this.terminalError ?? new Error("Assembly Connector Worker is not initialized."),
			);
		}
		if (!this.hydrated) {
			return hydration.then(() => {
				if (!this.hydrated) {
					throw this.terminalError ?? new Error("Assembly Connector Worker session has ended.");
				}
				return this.prepare(input);
			});
		}
		if (!this.binding || !this.worker) {
			return Promise.reject(new Error("Assembly Connector Worker session has ended."));
		}
		return new Promise((resolve, reject) => {
			if (this.inFlightRequestId !== null) {
				this.supersedeActivePromise();
				this.rejectQueued(
					new DOMException("Assembly Connector planning superseded.", "AbortError"),
				);
				this.queued = Object.freeze({ input, resolve, reject });
				return;
			}
			this.dispatchPrepare(input, resolve, reject);
		});
	}

	cancel(): void {
		this.dispose();
	}

	dispose(): void {
		this.clearTimeout();
		this.supersedeActivePromise();
		this.rejectQueued(new DOMException("Assembly Connector planning cancelled.", "AbortError"));
		this.inFlightRequestId = null;
		this.hydrationReject?.(
			new DOMException("Assembly Connector hydration cancelled.", "AbortError"),
		);
		this.hydrationResolve = null;
		this.hydrationReject = null;
		this.hydrationRequestId = null;
		this.hydrated = false;
		this.terminalError = new DOMException("Assembly Connector session cancelled.", "AbortError");
		this.binding = null;
		const worker = this.worker;
		this.worker = null;
		if (!worker) return;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}

	private revokePermit(permit: StaticFabAssemblyConnectorPermit): void {
		revokeStaticFabAssemblyConnectorPermit(permit);
	}

	private installWorkerHandlers(worker: StaticFabAssemblyConnectorWorkerPort): void {
		worker.onmessage = (event) => this.handleWorkerMessage(event.data as unknown);
		worker.onerror = (event) => this.failWorker(new Error(event.message));
		worker.onmessageerror = () =>
			this.failWorker(new Error("Assembly Connector Worker returned an unreadable response."));
	}

	private handleWorkerMessage(response: unknown): void {
		if (
			!isRecord(response) ||
			response.version !== STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION ||
			!Number.isSafeInteger(response.requestId)
		) {
			this.failWorker(new Error("Assembly Connector Worker returned a malformed response."));
			return;
		}
		const requestId = response.requestId as number;
		if (response.type === "STATIC_FAB_ASSEMBLY_CONNECTOR_HYDRATED") {
			this.acceptHydration(response as unknown as StaticFabAssemblyConnectorHydratedResponse);
			return;
		}
		if (response.type === "STATIC_FAB_ASSEMBLY_CONNECTOR_ERROR") {
			const error = new Error(
				typeof response.message === "string"
					? response.message
					: "Assembly Connector Worker returned a malformed error.",
			);
			if (requestId === this.hydrationRequestId) this.failWorker(error);
			else if (requestId === this.inFlightRequestId) {
				const active = this.completeInFlightRequest(requestId);
				if (active) {
					this.revokePermit(active.permit);
					active.reject(error);
				}
				this.dispatchQueued();
			}
			return;
		}
		if (response.type !== "STATIC_FAB_ASSEMBLY_CONNECTOR_PREPARED") return;
		if (requestId !== this.inFlightRequestId) return;
		const active = this.completeInFlightRequest(requestId);
		if (active) this.acceptPrepared(response.prepared, active);
		this.dispatchQueued();
	}

	private acceptHydration(response: StaticFabAssemblyConnectorHydratedResponse): void {
		if (response.requestId !== this.hydrationRequestId) return;
		const binding = this.binding;
		if (!binding || hydratedResponseError(response, binding.identity)) {
			this.failWorker(new Error("Assembly Connector Worker hydrated a divergent generation."));
			return;
		}
		this.clearTimeout();
		this.hydrationRequestId = null;
		this.hydrated = true;
		const resolve = this.hydrationResolve;
		this.hydrationResolve = null;
		this.hydrationReject = null;
		resolve?.(response.hydrationMilliseconds);
	}

	private acceptPrepared(
		preparedValue: unknown,
		active: ActiveStaticFabAssemblyConnectorRequest,
	): void {
		const binding = this.binding;
		if (!binding) {
			this.revokePermit(active.permit);
			active.reject(new Error("Assembly Connector Worker session has ended."));
			return;
		}
		const workerRoundTripMilliseconds = performance.now() - active.requestStartedAt;
		const responseValidationStartedAt = performance.now();
		const validation = validatePreparedResponse(
			preparedValue,
			active.permit.ticketId,
			binding.identity,
			active.intentFingerprint,
		);
		if (validation instanceof Error) {
			this.revokePermit(active.permit);
			active.reject(validation);
			this.failWorker(validation);
			return;
		}
		const accepted = preparedValue as PreparedStaticFabAssemblyConnector;
		const responseValidationMilliseconds = performance.now() - responseValidationStartedAt;
		const live = binding.getCurrentState();
		const liveUnchanged = bindingMatchesLiveState(binding, live);
		let adoptedPlan: StaticFabAssemblyConnectorPlan | null = null;
		const adoptionStartedAt = performance.now();
		if (
			accepted.valid &&
			accepted.plan &&
			accepted.ticket &&
			validation.prospectiveChecksum !== null &&
			liveUnchanged
		) {
			try {
				adoptedPlan = adoptStaticFabAssemblyConnectorWorkerPlan(
					active.permit,
					accepted.ticket,
					accepted.plan,
					validation.prospectiveChecksum,
					live.map,
					live.portEquipment,
					live.patchSequence,
					live.organizations,
					active.intent,
				);
			} catch (error) {
				active.reject(workerError(error, "Assembly Connector plan adoption failed."));
				return;
			}
		} else {
			this.revokePermit(active.permit);
		}
		active.resolve(
			Object.freeze({
				plan: adoptedPlan ?? accepted.plan,
				validation: accepted,
				certified: adoptedPlan !== null,
				workerRoundTripMilliseconds,
				responseValidationMilliseconds,
				adoptionMilliseconds: performance.now() - adoptionStartedAt,
			}),
		);
	}

	private supersedeActivePromise(): void {
		const active = this.active;
		if (!active) return;
		this.active = null;
		this.revokePermit(active.permit);
		active.reject(new DOMException("Assembly Connector planning superseded.", "AbortError"));
	}

	private completeInFlightRequest(
		requestId: number,
	): ActiveStaticFabAssemblyConnectorRequest | null {
		if (this.inFlightRequestId !== requestId) return null;
		this.inFlightRequestId = null;
		this.clearTimeout();
		const active = this.active;
		if (!active || active.requestId !== requestId) return null;
		this.active = null;
		return active;
	}

	private dispatchPrepare(
		input: StaticFabAssemblyConnectorInput,
		resolve: (value: ValidatedStaticFabAssemblyConnector) => void,
		reject: (error: Error) => void,
	): void {
		const binding = this.binding;
		const worker = this.worker;
		if (!binding || !worker || !this.hydrated) {
			reject(this.terminalError ?? new Error("Assembly Connector Worker session has ended."));
			return;
		}
		const source = binding.getCurrentState();
		if (!bindingMatchesLiveState(binding, source)) {
			reject(new Error("Assembly Connector authored generation changed before Worker planning."));
			return;
		}
		const intentFingerprint = staticFabAssemblyConnectorIntentFingerprint(input.intent);
		const permit = issueStaticFabAssemblyConnectorPermit(
			source.map,
			source.portEquipment,
			source.patchSequence,
			source.organizations,
			input.intent,
			binding.identity.checksum,
		);
		const requestId = this.nextRequestId++;
		const identity = binding.identity;
		const request: StaticFabAssemblyConnectorWorkerRequest = {
			type: "PREPARE_STATIC_FAB_ASSEMBLY_CONNECTOR",
			version: STATIC_FAB_ASSEMBLY_CONNECTOR_PROTOCOL_VERSION,
			requestId,
			ticketId: permit.ticketId,
			intent: input.intent,
			expectedIntentFingerprint: intentFingerprint,
			expectedSourceRevision: identity.revision,
			expectedSourcePatchSequence: identity.sequence,
			expectedSourceChecksum: identity.checksum,
			expectedSourceNextAdvancedSwitchId: identity.nextAdvancedSwitchId,
			expectedSourceNextPortId: identity.nextPortId,
			expectedSourceNextEquipmentGroupId: identity.nextEquipmentGroupId,
			expectedSourceNextOrganizationId: identity.nextOrganizationId,
		};
		this.inFlightRequestId = requestId;
		this.active = Object.freeze({
			requestId,
			permit,
			intent: input.intent,
			intentFingerprint,
			source,
			requestStartedAt: performance.now(),
			resolve,
			reject,
		});
		this.armTimeout(() => {
			if (this.inFlightRequestId !== requestId) return;
			this.failWorker(
				new Error(`Assembly Connector Worker timed out after ${this.timeoutMilliseconds} ms.`),
			);
		});
		try {
			worker.postMessage(request);
		} catch (error) {
			this.failWorker(workerError(error, "Assembly Connector Worker post failed."));
		}
	}

	private dispatchQueued(): void {
		if (this.inFlightRequestId !== null) return;
		const queued = this.queued;
		if (!queued) return;
		this.queued = null;
		this.dispatchPrepare(queued.input, queued.resolve, queued.reject);
	}

	private rejectQueued(error: Error): void {
		const queued = this.queued;
		this.queued = null;
		queued?.reject(error);
	}

	private armTimeout(callback: () => void): void {
		this.clearTimeout();
		this.timeout = setTimeout(callback, this.timeoutMilliseconds);
	}

	private clearTimeout(): void {
		if (this.timeout !== null) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
	}

	private failWorker(error: Error): void {
		this.clearTimeout();
		this.inFlightRequestId = null;
		const active = this.active;
		this.active = null;
		if (active) {
			this.revokePermit(active.permit);
			active.reject(error);
		}
		this.rejectQueued(error);
		this.hydrationReject?.(error);
		this.hydrationResolve = null;
		this.hydrationReject = null;
		this.hydrationRequestId = null;
		this.hydrated = false;
		this.terminalError = error;
		this.binding = null;
		const worker = this.worker;
		this.worker = null;
		if (!worker) return;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}
}

function validatePreparedResponse(
	value: unknown,
	expectedTicketId: number,
	source: StaticFabAssemblyConnectorSourceIdentity,
	expectedIntentFingerprint: string,
): Error | Readonly<{ prospectiveChecksum: string | null }> {
	const shapeError = staticFabAssemblyConnectorPreparedShapeError(value);
	if (shapeError) {
		return new Error(`Assembly Connector Worker returned malformed planning data: ${shapeError}.`);
	}
	const prepared = value as PreparedStaticFabAssemblyConnector;
	if (!prepared.valid) return Object.freeze({ prospectiveChecksum: null });
	const ticket = prepared.ticket;
	const plan = prepared.plan;
	if (!ticket || !plan) return new Error("Assembly Connector Worker omitted its exact result.");
	if (
		ticket.ticketId !== expectedTicketId ||
		ticket.sourceRevision !== source.revision ||
		ticket.sourcePatchSequence !== source.sequence ||
		ticket.sourceChecksum !== source.checksum ||
		ticket.sourceNextAdvancedSwitchId !== source.nextAdvancedSwitchId ||
		ticket.sourceNextPortId !== source.nextPortId ||
		ticket.sourceNextEquipmentGroupId !== source.nextEquipmentGroupId ||
		ticket.sourceNextOrganizationId !== source.nextOrganizationId ||
		ticket.intentFingerprint !== expectedIntentFingerprint
	) {
		return new Error("Assembly Connector Worker returned a corrupted one-shot ticket.");
	}
	let prospectiveChecksum: string;
	try {
		prospectiveChecksum = checksumRailPatchResult(source.checksum, {
			changes: plan.mutations,
			switchChanges: plan.switchMutations ?? [],
			portChanges: [],
			equipmentGroupChanges: [],
			organizationChanges: plan.organizationMutations,
			organizationNextIdBefore: plan.nextOrganizationIdBefore,
			organizationNextIdAfter: plan.nextOrganizationIdAfter,
		});
	} catch {
		return new Error("Assembly Connector Worker returned a malformed atomic patch.");
	}
	if (ticket.prospectiveChecksum !== prospectiveChecksum) {
		return new Error("Assembly Connector Worker returned a divergent prospective checksum.");
	}
	return Object.freeze({ prospectiveChecksum });
}

function snapshotMatchesLiveState(
	snapshot: RailMirrorSnapshot,
	live: StaticFabAssemblyConnectorLiveState,
): boolean {
	return (
		live.map.getRevision() === snapshot.revision &&
		live.patchSequence === snapshot.sequence &&
		live.map.getAdvancedSwitchIdCursor() === snapshot.nextAdvancedSwitchId &&
		live.portEquipment.nextPortId === snapshot.portEquipment.nextPortId &&
		live.portEquipment.nextEquipmentGroupId === snapshot.portEquipment.nextEquipmentGroupId &&
		live.organizations.nextOrganizationId === snapshot.organizations.nextOrganizationId &&
		live.relationships.nextRelationshipId === snapshot.relationships.nextRelationshipId
	);
}

function snapshotIdentity(snapshot: RailMirrorSnapshot): StaticFabAssemblyConnectorSourceIdentity {
	return Object.freeze({
		revision: snapshot.revision,
		sequence: snapshot.sequence,
		checksum: snapshot.checksum,
		nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
		nextPortId: snapshot.portEquipment.nextPortId,
		nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: snapshot.organizations.nextOrganizationId,
	});
}

function bindingMatchesLiveState(
	binding: StaticFabAssemblyConnectorBinding,
	live: StaticFabAssemblyConnectorLiveState,
): boolean {
	return (
		live.map === binding.source.map &&
		live.portEquipment === binding.source.portEquipment &&
		live.organizations === binding.source.organizations &&
		live.relationships === binding.source.relationships &&
		live.map.getRevision() === binding.identity.revision &&
		live.patchSequence === binding.identity.sequence &&
		live.map.getAdvancedSwitchIdCursor() === binding.identity.nextAdvancedSwitchId &&
		live.portEquipment.nextPortId === binding.identity.nextPortId &&
		live.portEquipment.nextEquipmentGroupId === binding.identity.nextEquipmentGroupId &&
		live.organizations.nextOrganizationId === binding.identity.nextOrganizationId
	);
}

function hydratedResponseError(
	response: StaticFabAssemblyConnectorHydratedResponse,
	identity: StaticFabAssemblyConnectorSourceIdentity,
): boolean {
	return (
		response.sourceRevision !== identity.revision ||
		response.sourcePatchSequence !== identity.sequence ||
		response.sourceChecksum !== identity.checksum ||
		response.sourceNextAdvancedSwitchId !== identity.nextAdvancedSwitchId ||
		response.sourceNextPortId !== identity.nextPortId ||
		response.sourceNextEquipmentGroupId !== identity.nextEquipmentGroupId ||
		response.sourceNextOrganizationId !== identity.nextOrganizationId ||
		!Number.isFinite(response.hydrationMilliseconds) ||
		response.hydrationMilliseconds < 0
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function workerError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}
