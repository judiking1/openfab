import type { StaticFabProcessLoopTopologyResult } from "../compile/StaticFabProcessLoopTopology";
import type { RailDocument } from "../core/RailDocument";
import {
	type StaticFabProcessLoopRailCandidate,
	type StaticFabProcessLoopRailCandidateSource,
	staticFabProcessLoopRailCandidateMatchesSource,
} from "../core/StaticFabProcessLoopRailCandidate";
import type {
	StaticFabProcessLoopRegistrationRequest,
	StaticFabProcessLoopRegistrationValidation,
} from "../core/StaticFabProcessLoopRegistration";
import type { RailWorkerBridgeState } from "../worker/RailWorkerBridge";
import { railWorkerStateMatchesSnapshotReadyExpectation } from "../worker/RailWorkerSnapshotReadiness";
import {
	createStaticFabProcessLoopTopologyPacking,
	type StaticFabProcessLoopTopologyPacking,
	staticFabProcessLoopTopologyTransfers,
} from "../worker/StaticFabProcessLoopTopologyColumns";
import {
	hasExactProcessLoopFields,
	STATIC_FAB_PROCESS_LOOP_TOPOLOGY_MAX_ERROR_LENGTH,
	STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION,
	type StaticFabProcessLoopTopologySourceIdentity,
	type StaticFabProcessLoopTopologyWorkerRequest,
	type StaticFabProcessLoopTopologyWorkerResponse,
	staticFabProcessLoopTopologySourceIdentitiesEqual,
	staticFabProcessLoopTopologySourceIdentityIsValid,
} from "../worker/StaticFabProcessLoopTopologyProtocol";
import { readStaticFabProcessLoopTopologyResult } from "../worker/StaticFabProcessLoopTopologyResponse";

export interface StaticFabProcessLoopTopologyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabProcessLoopTopologyWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: StaticFabProcessLoopTopologyWorkerRequest, transfer: Transferable[]): void;
	terminate(): void;
}

export interface StaticFabProcessLoopTopologyInput {
	readonly document: RailDocument;
	readonly source: StaticFabProcessLoopRailCandidateSource;
	readonly candidate: StaticFabProcessLoopRailCandidate;
	/** Must include current document and selection identity, beyond equal scalar counters. */
	readonly getCurrentSource: () => StaticFabProcessLoopRailCandidateSource;
	readonly isCurrent: () => boolean;
	readonly getMirrorState: () => RailWorkerBridgeState;
	readonly checkpoint: () => Promise<void>;
	readonly signal: AbortSignal;
}

interface PendingTopology {
	readonly retainForRegistration: boolean;
	readonly input: StaticFabProcessLoopTopologyInput;
	readonly requestId: number;
	readonly guard: () => void;
	readonly source: StaticFabProcessLoopTopologySourceIdentity;
	readonly fingerprint: string;
	readonly edgeCount: number;
	readonly switchCount: number;
	readonly resolve: (result: StaticFabProcessLoopTopologyResult) => void;
	readonly reject: (error: Error) => void;
}

/** Disposable candidate-only check. Returned facts have no registration or mutation authority. */
export class StaticFabProcessLoopTopologyBridge {
	private readonly createWorker: () => StaticFabProcessLoopTopologyWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabProcessLoopTopologyWorkerPort | null = null;
	private packing: StaticFabProcessLoopTopologyPacking | null = null;
	private pending: PendingTopology | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private removeAbort: (() => void) | null = null;
	private requestGeneration = 0;
	private nextRequestId = 1;
	private registrationRequest: StaticFabProcessLoopRegistrationRequest | null = null;
	private readonly resultBindings = new WeakMap<object, PendingTopology>();

	constructor(
		createWorker: () => StaticFabProcessLoopTopologyWorkerPort = () =>
			new Worker(new URL("../worker/staticFabProcessLoopTopologyWorker.ts", import.meta.url), {
				type: "module",
			}) as StaticFabProcessLoopTopologyWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	async check(
		input: StaticFabProcessLoopTopologyInput,
	): Promise<StaticFabProcessLoopTopologyResult> {
		return this.checkWithBinding(input, false);
	}

	private async checkWithBinding(
		input: StaticFabProcessLoopTopologyInput,
		retainForRegistration: boolean,
		registrationRequest: StaticFabProcessLoopRegistrationRequest | null = null,
	): Promise<StaticFabProcessLoopTopologyResult> {
		this.cancel();
		this.registrationRequest = registrationRequest;
		const generation = this.requestGeneration;
		const { document, source, candidate } = input;
		const map = document.map;
		const mapGeneration = map.getMutationGeneration();
		const ports = document.portEquipment;
		const organizations = document.organizations;
		const relationships = document.relationships;
		const operations = document.operationalConfiguration;
		const initial = input.getMirrorState();
		const identity: StaticFabProcessLoopTopologySourceIdentity = Object.freeze({
			revision: map.getRevision(),
			patchSequence: document.getPatchSequence(),
			epoch: initial.epoch,
			checksum: initial.targetChecksum,
			nextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
			nextPortId: ports.nextPortId,
			nextEquipmentGroupId: ports.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
			nextRelationshipId: relationships.nextRelationshipId,
		});
		const guard = (): void => {
			if (
				this.requestGeneration !== generation ||
				input.signal.aborted ||
				!input.isCurrent() ||
				document.map !== map ||
				source.map !== map ||
				source.organizations !== organizations ||
				source.patchSequence !== identity.patchSequence ||
				map.getMutationGeneration() !== mapGeneration ||
				map.getRevision() !== identity.revision ||
				document.getPatchSequence() !== identity.patchSequence ||
				map.getAdvancedSwitchIdCursor() !== identity.nextAdvancedSwitchId ||
				document.portEquipment !== ports ||
				document.organizations !== organizations ||
				document.relationships !== relationships ||
				document.operationalConfiguration !== operations ||
				!staticFabProcessLoopRailCandidateMatchesSource(candidate, input.getCurrentSource())
			)
				throw cancelledError();
			const mirror = input.getMirrorState();
			if (
				mirror.epoch !== identity.epoch ||
				!railWorkerStateMatchesSnapshotReadyExpectation(mirror, {
					revision: identity.revision,
					sequence: identity.patchSequence,
					checksum: identity.checksum,
				}) ||
				mirror.cells !== map.size ||
				mirror.edges !== map.edgeCount ||
				mirror.switches !== map.advancedSwitchCount ||
				mirror.ports !== ports.ports.length ||
				mirror.equipmentGroups !== ports.equipmentGroups.length ||
				mirror.organizations !== organizations.records.length ||
				mirror.assemblyRelationships !== relationships.records.length ||
				mirror.assemblyRelationshipNextId !== relationships.nextRelationshipId
			)
				throw new Error(
					"Process Loop topology requires the same ready authored mirror generation.",
				);
		};
		try {
			if (!staticFabProcessLoopTopologySourceIdentityIsValid(identity))
				throw new Error("Process Loop source identity is invalid.");
			guard();
			const packing = createStaticFabProcessLoopTopologyPacking(source, candidate, () => {
				guard();
				return true;
			});
			this.packing = packing;
			const abort = (): void => {
				if (this.requestGeneration === generation) this.cancel();
			};
			input.signal.addEventListener("abort", abort, { once: true });
			this.removeAbort = () => input.signal.removeEventListener("abort", abort);
			while (!packing.done) {
				packing.step(128);
				await input.checkpoint();
				guard();
			}
			const packed = packing.finish();
			this.packing = null;
			guard();
			if (!Number.isSafeInteger(this.nextRequestId))
				throw new Error("Process Loop topology request IDs are exhausted.");
			const requestId = this.nextRequestId++;
			const edgeCount = packed.columns.edgeCells.length / 4;
			const switchCount = packed.columns.switchIds.length;
			const worker = this.createWorker();
			this.worker = worker;
			return await new Promise((resolve, reject) => {
				this.pending = {
					retainForRegistration,
					input,
					requestId,
					guard,
					source: identity,
					fingerprint: packed.fingerprint,
					edgeCount,
					switchCount,
					resolve,
					reject,
				};
				const ownsRequest = (): boolean =>
					this.worker === worker && this.requestGeneration === generation;
				worker.onmessage = (event) => {
					if (ownsRequest()) this.receive(event.data);
				};
				worker.onerror = () => {
					if (ownsRequest()) this.fail(new Error("Process Loop topology Worker failed."));
				};
				worker.onmessageerror = () => {
					if (ownsRequest())
						this.fail(new Error("Process Loop topology Worker returned unreadable data."));
				};
				this.timeout = setTimeout(() => {
					if (ownsRequest()) this.fail(new Error("Process Loop topology Worker timed out."));
				}, this.timeoutMilliseconds);
				try {
					guard();
					worker.postMessage(
						{
							type: "CHECK_STATIC_FAB_PROCESS_LOOP_TOPOLOGY",
							version: STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION,
							requestId,
							source: identity,
							fingerprint: packed.fingerprint,
							columns: packed.columns,
						},
						staticFabProcessLoopTopologyTransfers(packed.columns),
					);
				} catch (error) {
					this.fail(asError(error));
				}
			});
		} catch (error) {
			if (this.requestGeneration === generation) this.cancel();
			throw asError(error);
		}
	}

	/** Trusted adapter for a core-owned pending request; no raw result can enter this boundary. */
	async validateRegistrationRequest(
		request: StaticFabProcessLoopRegistrationRequest,
		input: StaticFabProcessLoopTopologyInput,
	): Promise<StaticFabProcessLoopRegistrationValidation> {
		if (
			request.document !== input.document ||
			request.candidate !== input.candidate ||
			!staticFabProcessLoopRailCandidateMatchesSource(request.candidate, request.source) ||
			!staticFabProcessLoopRailCandidateMatchesSource(request.candidate, input.source) ||
			request.sourceChecksum !== input.getMirrorState().targetChecksum ||
			request.mirrorEpoch !== input.getMirrorState().epoch
		)
			throw new Error("Loop registration request does not match the topology adapter source.");
		const result = await this.checkWithBinding(input, true, request);
		const binding = this.resultBindings.get(result);
		if (
			!binding ||
			binding.input !== input ||
			binding.source.checksum !== request.sourceChecksum ||
			binding.source.epoch !== request.mirrorEpoch
		)
			throw new Error("Loop registration lacks the exact owned topology response.");
		this.resultBindings.delete(result);
		binding.guard();
		return Object.freeze({ request, candidateFingerprint: binding.fingerprint, result });
	}

	/** A revoked old preparation must never cancel a replacement request on this reusable bridge. */
	cancelRegistrationRequest(request: StaticFabProcessLoopRegistrationRequest): void {
		if (this.registrationRequest === request) this.cancel();
	}

	cancel(): void {
		this.requestGeneration++;
		const pending = this.pending;
		this.pending = null;
		this.release();
		pending?.reject(cancelledError());
	}

	dispose(): void {
		this.cancel();
	}

	private receive(response: unknown): void {
		const pending = this.pending;
		if (!pending) return;
		try {
			pending.guard();
			if (
				hasExactProcessLoopFields(response, ["type", "version", "requestId", "message"]) &&
				response.type === "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_ERROR" &&
				response.version === STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION &&
				response.requestId === pending.requestId &&
				typeof response.message === "string" &&
				response.message.length > 0 &&
				response.message.length <= STATIC_FAB_PROCESS_LOOP_TOPOLOGY_MAX_ERROR_LENGTH
			)
				throw new Error(response.message);
			if (
				!hasExactProcessLoopFields(response, [
					"type",
					"version",
					"requestId",
					"source",
					"fingerprint",
					"result",
				]) ||
				response.type !== "STATIC_FAB_PROCESS_LOOP_TOPOLOGY_CHECKED" ||
				response.version !== STATIC_FAB_PROCESS_LOOP_TOPOLOGY_PROTOCOL_VERSION ||
				response.requestId !== pending.requestId ||
				response.fingerprint !== pending.fingerprint ||
				!staticFabProcessLoopTopologySourceIdentityIsValid(response.source) ||
				!staticFabProcessLoopTopologySourceIdentitiesEqual(response.source, pending.source)
			)
				throw new Error(
					"Process Loop topology Worker returned an unrelated or malformed response.",
				);
			const result = readStaticFabProcessLoopTopologyResult(
				response.result,
				pending.edgeCount,
				pending.switchCount,
			);
			pending.guard();
			if (pending.retainForRegistration) this.resultBindings.set(result, pending);
			this.pending = null;
			this.release();
			pending.resolve(result);
		} catch (error) {
			this.fail(asError(error));
		}
	}

	private fail(error: Error): void {
		const pending = this.pending;
		this.pending = null;
		this.release();
		pending?.reject(error);
	}

	private release(): void {
		this.registrationRequest = null;
		this.packing?.cancel();
		this.packing = null;
		this.removeAbort?.();
		this.removeAbort = null;
		if (this.timeout !== null) clearTimeout(this.timeout);
		this.timeout = null;
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.onmessageerror = null;
			this.worker.terminate();
			this.worker = null;
		}
	}
}

function cancelledError(): Error {
	const error = new Error("Process Loop topology request was cancelled or became stale.");
	error.name = "AbortError";
	return error;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error("Process Loop topology request failed.");
}
