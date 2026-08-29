import { describe, expect, it, vi } from "vitest";
import {
	hydrateOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
	type OpenFabStationProposalArtifact,
} from "../compile/OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "../compile/OpenFabStationProposalCsvReader";
import type { OpenFabStationProposalReviewDraft } from "../compile/OpenFabStationProposalReview";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import * as DraftSoA from "../worker/OpenFabStationProposalReviewDraftSoA";
import {
	OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalReviewWorkerErrorCode,
	type OpenFabStationProposalReviewWorkerRequest,
	type OpenFabStationProposalReviewWorkerResponse,
	openFabStationProposalReviewWorkerErrorMessage,
} from "../worker/OpenFabStationProposalReviewWorkerProtocol";
import {
	collectOpenFabStationProposalReviewWorkerResponseTransfers,
	OpenFabStationProposalReviewWorkerSession,
} from "../worker/OpenFabStationProposalReviewWorkerRuntime";
import {
	captureRailMirrorSnapshot,
	consumeRailMirrorSnapshotCaptureAuthority,
} from "../worker/RailMirrorChecksum";
import {
	OpenFabStationProposalReviewBridge,
	type OpenFabStationProposalReviewBridgeEvaluation,
	type OpenFabStationProposalReviewBridgeInput,
	OpenFabStationProposalReviewCancelledError,
	type OpenFabStationProposalReviewWorkerPort,
} from "./OpenFabStationProposalReviewBridge";
import {
	createOpenFabStationProposalReviewSession,
	type OpenFabStationProposalReviewSession,
} from "./OpenFabStationProposalReviewSession";

const GENERATION = 17;
const REDACTION_SENTINEL = "PUBLIC_SYNTHETIC_HOSTILE_DIAGNOSTIC";

class ControlledRuntimeWorker implements OpenFabStationProposalReviewWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	readonly session = new OpenFabStationProposalReviewWorkerSession();
	readonly requests: OpenFabStationProposalReviewWorkerRequest[] = [];
	readonly requestTransferBatches: Array<readonly ArrayBuffer[]> = [];
	readonly requestTransfersDetached: boolean[] = [];
	readonly responseTransferBatches: Array<readonly ArrayBuffer[]> = [];
	readonly responseTransfersDetached: boolean[] = [];
	terminated = false;
	planResponseDelivered = false;
	private readonly automatic: boolean;
	private readonly transformDelivered: (value: unknown) => unknown;
	private markRequestPosted!: () => void;
	readonly requestPosted = new Promise<void>((resolve) => {
		this.markRequestPosted = resolve;
	});

	constructor(
		automatic = false,
		transformDelivered: (value: unknown) => unknown = (value) => value,
	) {
		this.automatic = automatic;
		this.transformDelivered = transformDelivered;
	}

	postMessage(
		message: OpenFabStationProposalReviewWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		const buffers = requireArrayBuffers(transfer);
		this.requestTransferBatches.push(Object.freeze([...buffers]));
		const delivered = structuredClone(message, { transfer });
		this.requestTransfersDetached.push(buffers.every((buffer) => buffer.byteLength === 0));
		this.requests.push(delivered);
		this.markRequestPosted();
		if (this.automatic) {
			const requestIndex = this.requests.length - 1;
			queueMicrotask(() => {
				void this.respond(requestIndex).catch(() => {
					this.onerror?.({ message: REDACTION_SENTINEL } as ErrorEvent);
				});
			});
		}
	}

	async runtimeResponse(requestIndex = this.requests.length - 1) {
		const request = this.requests[requestIndex];
		if (!request) throw new Error("Expected a posted synthetic station review request.");
		return this.session.receive(request);
	}

	async respond(requestIndex = this.requests.length - 1): Promise<void> {
		if (this.terminated) return;
		this.emitResponse(await this.runtimeResponse(requestIndex));
	}

	emitResponse(response: OpenFabStationProposalReviewWorkerResponse): void {
		if (this.terminated) return;
		const transfers = requireArrayBuffers(
			collectOpenFabStationProposalReviewWorkerResponseTransfers(response),
		);
		this.responseTransferBatches.push(Object.freeze([...transfers]));
		const delivered = structuredClone(response, { transfer: [...transfers] });
		this.responseTransfersDetached.push(transfers.every((buffer) => buffer.byteLength === 0));
		if (delivered.type === "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED") {
			this.planResponseDelivered = true;
		}
		this.onmessage?.({ data: this.transformDelivered(delivered) } as MessageEvent<unknown>);
	}

	emitRaw(value: unknown): void {
		this.onmessage?.({ data: value } as MessageEvent<unknown>);
	}

	emitError(): void {
		this.onerror?.({ message: REDACTION_SENTINEL } as ErrorEvent);
	}

	emitMessageError(): void {
		this.onmessageerror?.({ data: REDACTION_SENTINEL } as MessageEvent<unknown>);
	}

	terminate(): void {
		this.terminated = true;
		this.session.terminate();
	}
}

class PostFailureWorker extends ControlledRuntimeWorker {
	override postMessage(
		message: OpenFabStationProposalReviewWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		super.postMessage(message, transfer);
		throw new Error(REDACTION_SENTINEL);
	}
}

class ReentrantHandlerFailureWorker implements OpenFabStationProposalReviewWorkerPort {
	private messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
	private errorHandler: ((event: ErrorEvent) => void) | null = null;
	private messageErrorHandler: ((event: MessageEvent<unknown>) => void) | null = null;
	private reported = false;
	postCount = 0;
	terminated = false;

	get onmessage(): ((event: MessageEvent<unknown>) => void) | null {
		return this.messageHandler;
	}

	set onmessage(handler: ((event: MessageEvent<unknown>) => void) | null) {
		this.messageHandler = handler;
	}

	get onerror(): ((event: ErrorEvent) => void) | null {
		return this.errorHandler;
	}

	set onerror(handler: ((event: ErrorEvent) => void) | null) {
		this.errorHandler = handler;
		if (handler && !this.reported) {
			this.reported = true;
			handler({ message: REDACTION_SENTINEL } as ErrorEvent);
		}
	}

	get onmessageerror(): ((event: MessageEvent<unknown>) => void) | null {
		return this.messageErrorHandler;
	}

	set onmessageerror(handler: ((event: MessageEvent<unknown>) => void) | null) {
		this.messageErrorHandler = handler;
	}

	postMessage(): void {
		this.postCount++;
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("OpenFabStationProposalReviewBridge", () => {
	it("keeps READY Worker-owned, returns one opaque Apply, and never commits implicitly", async () => {
		const fixture = reviewFixture("READY");
		const worker = new ControlledRuntimeWorker(true);
		const postPlanTerminationObservations: boolean[] = [];
		let tick = 0;
		const now = (): number => {
			if (worker.planResponseDelivered) {
				postPlanTerminationObservations.push(worker.terminated);
			}
			return ++tick;
		};
		const bridge = testBridge(() => worker, 30_000, now);
		const commitSpy = vi.spyOn(fixture.document, "commitReviewedPortEquipment");

		const evaluation = await bridge.evaluate(fixture.input);

		expect(evaluation).toMatchObject({
			kind: "openfab-station-proposal-review-bridge-evaluation",
			generation: GENERATION,
			canApply: true,
			preview: { state: "READY", includedPortCount: 1, equipmentGroupCount: 1 },
		});
		expect(worker.terminated).toBe(false);
		expect(fixture.document.portEquipment.ports).toHaveLength(0);
		expect(commitSpy).not.toHaveBeenCalled();
		await expect(bridge.apply({ ...evaluation })).rejects.toThrow(/not ready for Apply/i);

		const prepared = await bridge.apply(evaluation);

		expect(prepared).toMatchObject({
			kind: "prepared-openfab-station-proposal-review-apply",
			generation: GENERATION,
			evaluationRequestId: evaluation.evaluationRequestId,
			apply: {
				kind: "reviewed-port-equipment-apply",
				planKind: "place-ohb",
				portCount: 1,
				equipmentGroupCount: 1,
			},
		});
		expect(Object.keys(prepared.apply)).toEqual([
			"kind",
			"planKind",
			"portCount",
			"equipmentGroupCount",
		]);
		expect(prepared.adoptionMilliseconds).toBeGreaterThan(0);
		const materializationStages = [
			prepared.materialization.authorityValidationMilliseconds,
			prepared.materialization.mutationReconstructionMilliseconds,
			prepared.materialization.planValidationMilliseconds,
			prepared.materialization.prospectiveStateMilliseconds,
			prepared.materialization.layoutValidationMilliseconds,
			prepared.materialization.checksumValidationMilliseconds,
			prepared.materialization.applyIssuanceMilliseconds,
		];
		expect(materializationStages.every((value) => value > 0)).toBe(true);
		expect(prepared.materialization.totalMilliseconds).toBeGreaterThanOrEqual(
			materializationStages.reduce((total, value) => total + value, 0),
		);
		expect(prepared.adoptionAndMaterializationMilliseconds).toBe(
			prepared.adoptionMilliseconds + prepared.materialization.totalMilliseconds,
		);
		expect(postPlanTerminationObservations.length).toBeGreaterThan(0);
		expect(postPlanTerminationObservations.every(Boolean)).toBe(true);
		expect(worker.terminated).toBe(true);
		expect(fixture.document.portEquipment.ports).toHaveLength(0);
		expect(commitSpy).not.toHaveBeenCalled();
		expect(fixture.document.commitReviewedPortEquipment({ ...prepared.apply })).toBe(false);
		expect(fixture.document.commitReviewedPortEquipment(prepared.apply)).toBe(true);
		expect(fixture.document.portEquipment.ports).toHaveLength(1);
		expect(fixture.document.commitReviewedPortEquipment(prepared.apply)).toBe(false);
		expect(fixture.document.undo()).toBe(true);
		expect(fixture.document.portEquipment.ports).toHaveLength(0);
		expect(fixture.document.redo()).toBe(true);
		expect(fixture.document.portEquipment.ports).toHaveLength(1);
	});

	it("consumes a fresh Draft snapshot without object re-encoding and preserves READY explicit Apply", async () => {
		const objectFixture = reviewFixture("READY");
		const objectWorker = new ControlledRuntimeWorker(true);
		const objectBridge = testBridge(() => objectWorker);
		await expect(objectBridge.evaluate(objectFixture.input)).resolves.toMatchObject({
			canApply: true,
			preview: { state: "READY" },
		});
		const objectDraftTransfers = objectWorker.requestTransferBatches[0] ?? [];
		expect(objectDraftTransfers).toHaveLength(95);
		objectBridge.cancel();

		const fixture = await snapshotReviewFixture();
		const worker = new ControlledRuntimeWorker(true);
		const bridge = testBridge(() => worker);
		const commitSpy = vi.spyOn(fixture.document, "commitReviewedPortEquipment");
		const objectEncoderSpy = vi.spyOn(
			DraftSoA,
			"encodeOpenFabStationProposalReviewDraftCooperatively",
		);

		try {
			const evaluation = await bridge.evaluate(fixture.input);

			expect(Object.hasOwn(fixture.input, "draft")).toBe(false);
			expect(objectEncoderSpy).not.toHaveBeenCalled();
			expect(evaluation).toMatchObject({
				kind: "openfab-station-proposal-review-bridge-evaluation",
				generation: GENERATION,
				canApply: true,
				preview: { state: "READY", includedPortCount: 1, equipmentGroupCount: 1 },
			});
			expect(worker.requestTransferBatches).toHaveLength(1);
			const snapshotDraftTransfers = worker.requestTransferBatches[0] ?? [];
			expect(snapshotDraftTransfers).toHaveLength(objectDraftTransfers.length);
			expect(snapshotDraftTransfers).toHaveLength(95);
			expect(new Set(snapshotDraftTransfers).size).toBe(snapshotDraftTransfers.length);
			expect(worker.requestTransfersDetached).toEqual([true]);
			expect(fixture.draftSnapshot.decisionRows.byteLength).toBe(0);
			expect(fixture.document.portEquipment.ports).toHaveLength(0);
			expect(commitSpy).not.toHaveBeenCalled();
			await expect(bridge.apply({ ...evaluation })).rejects.toThrow(/not ready for Apply/i);

			const prepared = await bridge.apply(evaluation);

			expect(prepared).toMatchObject({
				kind: "prepared-openfab-station-proposal-review-apply",
				generation: GENERATION,
				apply: {
					kind: "reviewed-port-equipment-apply",
					planKind: "place-ohb",
					portCount: 1,
					equipmentGroupCount: 1,
				},
			});
			expect(worker.requestTransferBatches).toHaveLength(2);
			expect(worker.requestTransferBatches[1]).toHaveLength(0);
			expect(fixture.document.portEquipment.ports).toHaveLength(0);
			expect(commitSpy).not.toHaveBeenCalled();
			expect(fixture.document.commitReviewedPortEquipment(prepared.apply)).toBe(true);
			expect(fixture.document.portEquipment.ports).toHaveLength(1);
		} finally {
			objectEncoderSpy.mockRestore();
		}
	});

	it("captures a genuine typed review session inside the Bridge and preserves explicit Apply", async () => {
		const fixture = reviewFixture("READY");
		const session = readyReviewSession(fixture.input.proposal);
		const worker = new ControlledRuntimeWorker(true);
		const bridge = testBridge(() => worker);
		const objectEncoderSpy = vi.spyOn(
			DraftSoA,
			"encodeOpenFabStationProposalReviewDraftCooperatively",
		);
		const input: OpenFabStationProposalReviewBridgeInput = Object.freeze({
			document: fixture.input.document,
			proposal: fixture.input.proposal,
			draftSession: session,
			snapshot: fixture.input.snapshot,
			generation: fixture.input.generation,
			getGeneration: fixture.input.getGeneration,
		});

		try {
			const evaluation = await bridge.evaluate(input);

			expect(objectEncoderSpy).not.toHaveBeenCalled();
			expect(evaluation).toMatchObject({
				canApply: true,
				preview: { state: "READY", includedPortCount: 1, equipmentGroupCount: 1 },
			});
			expect(worker.requestTransferBatches[0]).toHaveLength(95);
			expect(session.readRowWindow(0, 1).items[0]).toMatchObject({
				row: 0,
				reviewGroupId: 1,
				decision: { disposition: "INCLUDE" },
			});
			expect(fixture.document.portEquipment.ports).toHaveLength(0);

			const prepared = await bridge.apply(evaluation);

			expect(fixture.document.portEquipment.ports).toHaveLength(0);
			expect(fixture.document.commitReviewedPortEquipment(prepared.apply)).toBe(true);
			expect(fixture.document.portEquipment.ports).toHaveLength(1);
		} finally {
			objectEncoderSpy.mockRestore();
		}
	});

	it("rejects a session mutation triggered while final Apply timing is coerced", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const session = readyReviewSession(fixture.input.proposal);
		const worker = new ControlledRuntimeWorker(true);
		let tick = 0;
		let trappedAdoptionStart = false;
		let mutated = false;
		const trappedTime = {
			valueOf(): number {
				if (!mutated) {
					mutated = true;
					session.dispatch({
						type: "SET_ORGANIZATION_POLICY",
						policy: "EXPLICIT_UNASSIGNED",
					});
				}
				return tick;
			},
		};
		const now = (): number => {
			tick++;
			if (worker.planResponseDelivered && !trappedAdoptionStart) {
				trappedAdoptionStart = true;
				return trappedTime as unknown as number;
			}
			return tick;
		};
		const bridge = testBridge(() => worker, 30_000, now);
		const input: OpenFabStationProposalReviewBridgeInput = Object.freeze({
			document: fixture.input.document,
			proposal: fixture.input.proposal,
			draftSession: session,
			snapshot: fixture.input.snapshot,
			generation: fixture.input.generation,
			getGeneration: fixture.input.getGeneration,
		});
		const evaluation = await bridge.evaluate(input);

		await expect(bridge.apply(evaluation)).rejects.toBeInstanceOf(
			OpenFabStationProposalReviewCancelledError,
		);
		expect(trappedAdoptionStart).toBe(true);
		expect(mutated).toBe(true);
		expect(worker.terminated).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("revokes an Apply issued while ticket materialization reentrantly stales the session", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const session = readyReviewSession(fixture.input.proposal);
		let trapped = false;
		const worker = new ControlledRuntimeWorker(true, (value) => {
			if (
				typeof value !== "object" ||
				value === null ||
				!("type" in value) ||
				value.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED" ||
				!("ticket" in value)
			) {
				return value;
			}
			const response = value as OpenFabStationProposalReviewWorkerResponse & {
				readonly ticket: object;
			};
			const ticket = new Proxy(response.ticket, {
				getOwnPropertyDescriptor(target, key) {
					if (!trapped) {
						trapped = true;
						session.dispatch({
							type: "SET_ORGANIZATION_POLICY",
							policy: "EXPLICIT_UNASSIGNED",
						});
					}
					return Reflect.getOwnPropertyDescriptor(target, key);
				},
			});
			return { ...response, ticket };
		});
		const bridge = testBridge(() => worker);
		const input: OpenFabStationProposalReviewBridgeInput = Object.freeze({
			document: fixture.input.document,
			proposal: fixture.input.proposal,
			draftSession: session,
			snapshot: fixture.input.snapshot,
			generation: fixture.input.generation,
			getGeneration: fixture.input.getGeneration,
		});
		const evaluation = await bridge.evaluate(input);

		await expect(bridge.apply(evaluation)).rejects.toBeInstanceOf(
			OpenFabStationProposalReviewCancelledError,
		);
		expect(trapped).toBe(true);
		expect(worker.terminated).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("terminates a newly created Worker when its factory mutates the review session", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const session = readyReviewSession(fixture.input.proposal);
		const worker = new ControlledRuntimeWorker();
		const bridge = testBridge(() => {
			session.dispatch({
				type: "SET_ORGANIZATION_POLICY",
				policy: "EXPLICIT_UNASSIGNED",
			});
			return worker;
		});
		const input: OpenFabStationProposalReviewBridgeInput = Object.freeze({
			document: fixture.input.document,
			proposal: fixture.input.proposal,
			draftSession: session,
			snapshot: fixture.input.snapshot,
			generation: fixture.input.generation,
			getGeneration: fixture.input.getGeneration,
		});

		await expect(bridge.evaluate(input)).rejects.toBeInstanceOf(
			OpenFabStationProposalReviewCancelledError,
		);
		expect(worker.requests).toHaveLength(0);
		expect(worker.terminated).toBe(true);
		expect(worker.session.isTerminal()).toBe(true);
		expectRailAuthorityRevoked(fixture);
		expectDocumentIdentity(fixture.document, before);
	});

	it("binds a typed review session to its exact proposal and live session revision", async () => {
		const sourceFixture = reviewFixture("READY");
		const foreignFixture = reviewFixture("READY");
		const sourceSession = readyReviewSession(sourceFixture.input.proposal);
		const foreignBridge = testBridge(() => new ControlledRuntimeWorker());
		const foreignInput: OpenFabStationProposalReviewBridgeInput = Object.freeze({
			document: foreignFixture.input.document,
			proposal: foreignFixture.input.proposal,
			draftSession: sourceSession,
			snapshot: foreignFixture.input.snapshot,
			generation: foreignFixture.input.generation,
			getGeneration: foreignFixture.input.getGeneration,
		});

		await expect(foreignBridge.evaluate(foreignInput)).rejects.toThrow(
			"Station proposal review session source is invalid.",
		);
		expectRailAuthorityRevoked(foreignFixture);

		const liveFixture = reviewFixture("READY");
		const liveSession = readyReviewSession(liveFixture.input.proposal);
		const liveWorker = new ControlledRuntimeWorker(true);
		const liveBridge = testBridge(() => liveWorker);
		const liveInput: OpenFabStationProposalReviewBridgeInput = Object.freeze({
			document: liveFixture.input.document,
			proposal: liveFixture.input.proposal,
			draftSession: liveSession,
			snapshot: liveFixture.input.snapshot,
			generation: liveFixture.input.generation,
			getGeneration: liveFixture.input.getGeneration,
		});
		const evaluation = await liveBridge.evaluate(liveInput);
		liveSession.dispatch({
			type: "SET_ORGANIZATION_POLICY",
			policy: "EXPLICIT_UNASSIGNED",
		});

		await expect(liveBridge.apply(evaluation)).rejects.toThrow(/stale before Apply/i);
		expect(liveWorker.terminated).toBe(true);
		expect(liveFixture.document.portEquipment.ports).toHaveLength(0);
	});

	it("transfers one globally unique input graph and independently owned response buffers", async () => {
		const worker = new ControlledRuntimeWorker(true);
		const bridge = testBridge(() => worker);
		const evaluation = await bridge.evaluate(reviewFixture("READY").input);
		await bridge.apply(evaluation);

		expect(worker.requestTransferBatches).toHaveLength(2);
		const evaluationInputs = worker.requestTransferBatches[0] ?? [];
		expect(evaluationInputs.length).toBeGreaterThan(0);
		expect(new Set(evaluationInputs).size).toBe(evaluationInputs.length);
		expect(worker.requestTransferBatches[1]).toHaveLength(0);
		expect(worker.requestTransfersDetached).toEqual([true, true]);
		expect(worker.responseTransferBatches).toHaveLength(2);
		for (const responseBuffers of worker.responseTransferBatches) {
			expect(responseBuffers.length).toBeGreaterThan(0);
			expect(new Set(responseBuffers).size).toBe(responseBuffers.length);
		}
		expect(worker.responseTransfersDetached).toEqual([true, true]);
	});

	it("returns BLOCKED without Apply authority and closes the disposable Worker", async () => {
		const fixture = reviewFixture("BLOCKED");
		const worker = new ControlledRuntimeWorker(true);
		const bridge = testBridge(() => worker);

		const evaluation = await bridge.evaluate(fixture.input);

		expect(evaluation).toMatchObject({
			canApply: false,
			preview: { state: "BLOCKED", reviewFingerprint: null },
		});
		expect(worker.terminated).toBe(true);
		expect(worker.onmessage).toBeNull();
		expect(fixture.document.portEquipment.ports).toHaveLength(0);
		await expect(bridge.apply(evaluation)).rejects.toThrow(/not ready for Apply/i);
	});

	it("is latest-wins and ignores a late response from the cancelled generation", async () => {
		const firstWorker = new ControlledRuntimeWorker();
		const secondWorker = new ControlledRuntimeWorker(true);
		let workerIndex = 0;
		const bridge = testBridge(
			() => [firstWorker, secondWorker][workerIndex++] as OpenFabStationProposalReviewWorkerPort,
		);
		const firstFixture = reviewFixture("READY", GENERATION);
		const secondFixture = reviewFixture("READY", GENERATION + 1);
		const firstPending = bridge.evaluate(firstFixture.input);
		await waitForRequest(firstWorker);
		const staleHandler = firstWorker.onmessage;
		const staleResponse = await firstWorker.runtimeResponse();

		const secondPending = bridge.evaluate(secondFixture.input);
		staleHandler?.({ data: staleResponse } as MessageEvent<unknown>);

		await expect(firstPending).rejects.toBeInstanceOf(OpenFabStationProposalReviewCancelledError);
		await expect(secondPending).resolves.toMatchObject({
			generation: GENERATION + 1,
			canApply: true,
		});
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(false);
		bridge.cancel();
		expect(secondWorker.terminated).toBe(true);
	});

	it("cancels explicitly and rejects Apply after the live generation changes", async () => {
		const cancelledFixture = reviewFixture("READY");
		const cancelledWorker = new ControlledRuntimeWorker();
		const cancelledBridge = testBridge(() => cancelledWorker);
		const cancelledPending = cancelledBridge.evaluate(cancelledFixture.input);
		await waitForRequest(cancelledWorker);
		const lateHandler = cancelledWorker.onmessage;
		const lateResponse = await cancelledWorker.runtimeResponse();

		cancelledBridge.cancel();
		lateHandler?.({ data: lateResponse } as MessageEvent<unknown>);

		await expect(cancelledPending).rejects.toBeInstanceOf(
			OpenFabStationProposalReviewCancelledError,
		);
		expect(cancelledWorker.terminated).toBe(true);
		expect(cancelledFixture.document.portEquipment.ports).toHaveLength(0);

		const staleFixture = reviewFixture("READY");
		const staleWorker = new ControlledRuntimeWorker(true);
		const staleBridge = testBridge(() => staleWorker);
		const evaluation = await staleBridge.evaluate(staleFixture.input);
		staleFixture.setGeneration(GENERATION + 1);

		await expect(staleBridge.apply(evaluation)).rejects.toThrow(/stale before Apply/i);
		expect(staleWorker.terminated).toBe(true);
		expect(staleFixture.document.portEquipment.ports).toHaveLength(0);
	});

	it.each([
		"disposed",
		"initially aborted",
		"stale generation",
	] as const)("terminally revokes fresh snapshot inputs when evaluation is %s", async (scenario) => {
		const fixture = await snapshotReviewFixture();
		let workerCreated = false;
		const bridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});
		let signal: AbortSignal | undefined;
		if (scenario === "disposed") bridge.dispose();
		if (scenario === "initially aborted") {
			const controller = new AbortController();
			controller.abort();
			signal = controller.signal;
		}
		if (scenario === "stale generation") fixture.setGeneration(GENERATION + 1);

		const error = await bridge.evaluate(fixture.input, signal).catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(Error);
		expect(workerCreated).toBe(false);
		expectSnapshotReviewAuthoritiesRevoked(fixture);
	});

	it("rejects dual-or-neither Draft inputs and revokes every authority actually supplied", async () => {
		const dualFixture = await snapshotReviewFixture();
		let workerCreated = false;
		const dualBridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});
		const dualInput = Object.freeze({
			...dualFixture.input,
			draft: readyDraft(),
		}) as unknown as OpenFabStationProposalReviewBridgeInput;

		await expect(dualBridge.evaluate(dualInput)).rejects.toThrow(/input is invalid/i);
		expect(workerCreated).toBe(false);
		expectSnapshotReviewAuthoritiesRevoked(dualFixture);

		const neitherFixture = reviewFixture("READY");
		const neitherBridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});
		const neitherInput = Object.freeze({
			document: neitherFixture.document,
			proposal: neitherFixture.input.proposal,
			snapshot: neitherFixture.input.snapshot,
			generation: neitherFixture.input.generation,
			getGeneration: neitherFixture.input.getGeneration,
		}) as OpenFabStationProposalReviewBridgeInput;

		await expect(neitherBridge.evaluate(neitherInput)).rejects.toThrow(/input is invalid/i);
		expect(workerCreated).toBe(false);
		expectRailAuthorityRevoked(neitherFixture);
	});

	it("descriptor-captures the exact input without invoking accessors and revokes data authorities", async () => {
		const fixture = await snapshotReviewFixture();
		let generationGetterCalls = 0;
		let workerCreated = false;
		const bridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});
		const hostileInput = { ...fixture.input } as Record<string, unknown>;
		Object.defineProperty(hostileInput, "generation", {
			enumerable: true,
			configurable: true,
			get() {
				generationGetterCalls += 1;
				throw new Error("external getter text");
			},
		});

		await expect(
			bridge.evaluate(hostileInput as unknown as OpenFabStationProposalReviewBridgeInput),
		).rejects.toThrow("Station proposal review input is invalid.");

		expect(generationGetterCalls).toBe(0);
		expect(workerCreated).toBe(false);
		expectSnapshotReviewAuthoritiesRevoked(fixture);
	});

	it("rejects symbol-keyed input while still revoking captured data authorities", async () => {
		const fixture = await snapshotReviewFixture();
		const bridge = testBridge(() => new ControlledRuntimeWorker());
		const input = {
			...fixture.input,
			[Symbol("synthetic-extra")]: true,
		} as OpenFabStationProposalReviewBridgeInput;

		await expect(bridge.evaluate(input)).rejects.toThrow(
			"Station proposal review input is invalid.",
		);
		expectSnapshotReviewAuthoritiesRevoked(fixture);
	});

	it("continues descriptor cleanup after one input descriptor trap throws", async () => {
		const fixture = await snapshotReviewFixture();
		const bridge = testBridge(() => new ControlledRuntimeWorker());
		let threw = false;
		const input = new Proxy(fixture.input, {
			getOwnPropertyDescriptor(target, key) {
				if (key === "document" && !threw) {
					threw = true;
					throw new Error("external descriptor text");
				}
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});

		await expect(bridge.evaluate(input)).rejects.toThrow(
			"Station proposal review input is invalid.",
		);
		expect(threw).toBe(true);
		expectSnapshotReviewAuthoritiesRevoked(fixture);
	});

	it.each([
		"snapshot",
		"draftSnapshot",
	] as const)("terminally revokes authorities when the %s descriptor trap throws once", async (trappedKey) => {
		const fixture = await snapshotReviewFixture();
		const bridge = testBridge(() => new ControlledRuntimeWorker());
		let descriptorCalls = 0;
		const input = new Proxy(fixture.input, {
			getOwnPropertyDescriptor(target, key) {
				if (key === trappedKey) {
					descriptorCalls++;
					if (descriptorCalls === 1) throw new Error(REDACTION_SENTINEL);
				}
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});

		await expect(bridge.evaluate(input)).rejects.toThrow(
			"Station proposal review input is invalid.",
		);
		expect(descriptorCalls).toBeGreaterThanOrEqual(2);
		expectSnapshotReviewAuthoritiesRevoked(fixture);
	});

	it.each([
		"getPrototypeOf",
		"ownKeys",
	] as const)("revokes Rail authority when the input %s structural trap throws", async (trap) => {
		const fixture = reviewFixture("READY");
		const session = readyReviewSession(fixture.input.proposal);
		let workerCreated = false;
		const bridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});
		const target: OpenFabStationProposalReviewBridgeInput = Object.freeze({
			document: fixture.input.document,
			proposal: fixture.input.proposal,
			draftSession: session,
			snapshot: fixture.input.snapshot,
			generation: fixture.input.generation,
			getGeneration: fixture.input.getGeneration,
		});
		const input = new Proxy(target, {
			getPrototypeOf(current) {
				if (trap === "getPrototypeOf") throw new Error(REDACTION_SENTINEL);
				return Reflect.getPrototypeOf(current);
			},
			ownKeys(current) {
				if (trap === "ownKeys") throw new Error(REDACTION_SENTINEL);
				return Reflect.ownKeys(current);
			},
		});

		await expect(bridge.evaluate(input)).rejects.toThrow(
			"Station proposal review input is invalid.",
		);
		expect(workerCreated).toBe(false);
		expectRailAuthorityRevoked(fixture);
	});

	it("keeps a reentrant latest evaluation started by an input descriptor trap", async () => {
		const firstFixture = reviewFixture("READY", GENERATION);
		const secondFixture = reviewFixture("READY", GENERATION + 1);
		const secondWorker = new ControlledRuntimeWorker(true);
		let secondPending: Promise<OpenFabStationProposalReviewBridgeEvaluation> | undefined;
		let reentered = false;
		const bridge = testBridge(() => secondWorker);
		const firstInput = new Proxy(firstFixture.input, {
			ownKeys(target) {
				if (!reentered) {
					reentered = true;
					secondPending = bridge.evaluate(secondFixture.input);
				}
				return Reflect.ownKeys(target);
			},
		});

		const firstPending = bridge.evaluate(firstInput);

		await expect(firstPending).rejects.toBeInstanceOf(OpenFabStationProposalReviewCancelledError);
		if (!secondPending) throw new Error("Expected a reentrant latest evaluation.");
		await expect(secondPending).resolves.toMatchObject({
			generation: GENERATION + 1,
			canApply: true,
		});
		expect(secondWorker.requests).toHaveLength(1);
		expectRailAuthorityRevoked(firstFixture);
	});

	it("keeps a reentrant latest evaluation started while the consumed snapshot checks the live map", async () => {
		const firstFixture = reviewFixture("READY", GENERATION);
		const secondFixture = reviewFixture("READY", GENERATION + 1);
		const firstWorker = new ControlledRuntimeWorker(true);
		const secondWorker = new ControlledRuntimeWorker(true);
		let workerIndex = 0;
		let reentered = false;
		let secondPending: Promise<OpenFabStationProposalReviewBridgeEvaluation> | undefined;
		const bridge = testBridge(() => {
			const worker = [firstWorker, secondWorker][workerIndex++];
			if (!worker) throw new Error("Unexpected synthetic Worker creation.");
			return worker;
		});
		const firstMap = firstFixture.document.map;
		const originalGetRevision = firstMap.getRevision;
		Object.defineProperty(firstMap, "getRevision", {
			value(): number {
				if (!reentered) {
					reentered = true;
					secondPending = bridge.evaluate(secondFixture.input);
				}
				return Reflect.apply(originalGetRevision, firstMap, []);
			},
		});

		const firstPending = bridge.evaluate(firstFixture.input);

		await expect(firstPending).rejects.toBeInstanceOf(OpenFabStationProposalReviewCancelledError);
		if (!secondPending) throw new Error("Expected a reentrant latest evaluation.");
		await expect(secondPending).resolves.toMatchObject({
			generation: GENERATION + 1,
			canApply: true,
		});
		expect(firstWorker.requests).toHaveLength(0);
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.requests).toHaveLength(1);
		expect(secondWorker.terminated).toBe(false);
		expectRailAuthorityRevoked(firstFixture);
		bridge.cancel();
		expect(secondWorker.terminated).toBe(true);
	});

	it.each([
		["non-object", () => null],
		[
			"foreign correlation",
			(response: OpenFabStationProposalReviewWorkerResponse) => ({
				...response,
				requestId: response.requestId + 100,
			}),
		],
		[
			"extra field",
			(response: OpenFabStationProposalReviewWorkerResponse) => ({
				...response,
				unexpected: true,
			}),
		],
	] as const)("rejects a %s evaluation response", async (_name, mutate) => {
		const fixture = reviewFixture("READY");
		const worker = new ControlledRuntimeWorker();
		const bridge = testBridge(() => worker);
		const pending = bridge.evaluate(fixture.input);
		await waitForRequest(worker);
		const response = await worker.runtimeResponse();

		worker.emitRaw(mutate(response));

		await expect(pending).rejects.toThrow(/invalid|fields|correlation|own-data/i);
		expect(worker.terminated).toBe(true);
		expect(fixture.document.portEquipment.ports).toHaveLength(0);
	});

	it.each([
		"foreign correlation",
		"extra field",
	] as const)("rejects an Apply-phase plan response with %s", async (mode) => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ControlledRuntimeWorker();
		const bridge = testBridge(() => worker);
		const evaluationPending = bridge.evaluate(fixture.input);
		await waitForRequest(worker);
		await worker.respond(0);
		const evaluation = await evaluationPending;
		const applyPending = bridge.apply(evaluation);
		expect(worker.requests).toHaveLength(2);
		const response = await worker.runtimeResponse(1);
		if (response.type !== "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED") {
			throw new Error("Expected a synthetic reviewed plan response.");
		}

		worker.emitRaw(
			mode === "foreign correlation"
				? { ...response, requestId: response.requestId + 1 }
				: { ...response, unexpected: true },
		);

		await expect(applyPending).rejects.toThrow(/correlation|fields|invalid/i);
		expect(worker.terminated).toBe(true);
		expect(worker.session.isTerminal()).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("accepts only fixed Worker errors and never exposes an injected diagnostic", async () => {
		const malformedFixture = reviewFixture("READY");
		const malformedWorker = new ControlledRuntimeWorker();
		const malformedBridge = testBridge(() => malformedWorker);
		const malformedPending = malformedBridge.evaluate(malformedFixture.input);
		await waitForRequest(malformedWorker);
		const malformedRequest = requiredRequest(malformedWorker);
		malformedWorker.emitRaw({
			...fixedErrorResponse(malformedRequest, "INTERNAL_FAILURE"),
			message: REDACTION_SENTINEL,
		});

		const malformedError = await malformedPending.catch((error: unknown) => error);
		expect(malformedError).toBeInstanceOf(Error);
		expect((malformedError as Error).message).toMatch(/response is invalid|malformed/i);
		expect((malformedError as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(malformedWorker.terminated).toBe(true);

		const fixedFixture = reviewFixture("READY");
		const fixedWorker = new ControlledRuntimeWorker();
		const fixedBridge = testBridge(() => fixedWorker);
		const fixedPending = fixedBridge.evaluate(fixedFixture.input);
		await waitForRequest(fixedWorker);
		fixedWorker.emitRaw(fixedErrorResponse(requiredRequest(fixedWorker), "INTERNAL_FAILURE"));

		await expect(fixedPending).rejects.toThrow(
			openFabStationProposalReviewWorkerErrorMessage("INTERNAL_FAILURE"),
		);
		expect(fixedWorker.terminated).toBe(true);
	});

	it("terminates on post, native, decode, and timeout failures", async () => {
		const postFixture = reviewFixture("READY");
		const postWorker = new PostFailureWorker();
		const postError = await testBridge(() => postWorker)
			.evaluate(postFixture.input)
			.catch((error: unknown) => error);
		expect(postError).toBeInstanceOf(Error);
		expect((postError as Error).message).toBe(
			"Station proposal review request could not be posted.",
		);
		expect((postError as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(postWorker.requestTransfersDetached).toEqual([true]);
		expect(postWorker.terminated).toBe(true);

		const nativeWorker = new ControlledRuntimeWorker();
		const nativePending = testBridge(() => nativeWorker).evaluate(reviewFixture("READY").input);
		await waitForRequest(nativeWorker);
		nativeWorker.emitError();
		const nativeError = await nativePending.catch((error: unknown) => error);
		expect((nativeError as Error).message).toBe("Station proposal review Worker failed.");
		expect((nativeError as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(nativeWorker.terminated).toBe(true);

		const decodeWorker = new ControlledRuntimeWorker();
		const decodePending = testBridge(() => decodeWorker).evaluate(reviewFixture("READY").input);
		await waitForRequest(decodeWorker);
		decodeWorker.emitMessageError();
		const decodeError = await decodePending.catch((error: unknown) => error);
		expect((decodeError as Error).message).toBe(
			"Station proposal review Worker response was unreadable.",
		);
		expect((decodeError as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(decodeWorker.terminated).toBe(true);

		vi.useFakeTimers();
		try {
			const timeoutWorker = new ControlledRuntimeWorker();
			const timed = testBridge(() => timeoutWorker, 25).evaluate(reviewFixture("READY").input);
			await waitForRequest(timeoutWorker);
			const expectation = expect(timed).rejects.toThrow(/timed out after 25 ms/i);
			await vi.advanceTimersByTimeAsync(25);
			await expectation;
			expect(timeoutWorker.terminated).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports a fixed constructor failure and leaves the document unchanged", async () => {
		const fixture = reviewFixture("READY");
		const bridge = testBridge(() => {
			throw new Error(REDACTION_SENTINEL);
		});

		const error = await bridge.evaluate(fixture.input).catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("Station proposal review Worker could not be created.");
		expect((error as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(fixture.input.snapshot.xs.byteLength).toBeGreaterThan(0);
		expect(fixture.document.portEquipment.ports).toHaveLength(0);
	});

	it("terminally cleans up when the first post-permit clock read throws", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ControlledRuntimeWorker();
		let workerCreated = false;
		let tick = 0;
		const now = (): number => {
			if (workerCreated) throw new Error("PUBLIC_SYNTHETIC_POST_PERMIT_CLOCK_FAILURE");
			return ++tick;
		};
		const bridge = testBridge(
			() => {
				workerCreated = true;
				return worker;
			},
			30_000,
			now,
		);

		const pending = bridge.evaluate(fixture.input);

		const error = await pending.catch((failure: unknown) => failure);
		expect((error as Error).message).toBe("Station proposal review session could not be started.");
		expect((error as Error).message).not.toContain("POST_PERMIT_CLOCK_FAILURE");
		expect(worker.requests).toHaveLength(0);
		expect(worker.terminated).toBe(true);
		expect(worker.session.isTerminal()).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("rechecks an external abort triggered by the post-permit clock before posting", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ControlledRuntimeWorker();
		const controller = new AbortController();
		let workerCreated = false;
		let tick = 0;
		const now = (): number => {
			if (workerCreated && !controller.signal.aborted) controller.abort();
			return ++tick;
		};
		const bridge = testBridge(
			() => {
				workerCreated = true;
				return worker;
			},
			30_000,
			now,
		);

		const error = await bridge
			.evaluate(fixture.input, controller.signal)
			.catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(OpenFabStationProposalReviewCancelledError);
		expect((error as Error).name).toBe("AbortError");
		expect(worker.requests).toHaveLength(0);
		expect(worker.terminated).toBe(true);
		expect(worker.session.isTerminal()).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("turns a READY Apply generation-reader throw into a terminal Promise rejection", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ControlledRuntimeWorker(true);
		let generationReadThrows = false;
		const input = Object.freeze({
			...fixture.input,
			getGeneration: (): number => {
				if (generationReadThrows) {
					throw new Error("PUBLIC_SYNTHETIC_APPLY_GENERATION_FAILURE");
				}
				return GENERATION;
			},
		});
		const bridge = testBridge(() => worker);
		const evaluation = await bridge.evaluate(input);
		expect(worker.session.isReady()).toBe(true);
		generationReadThrows = true;

		let pending: Promise<unknown> | undefined;
		expect(() => {
			pending = bridge.apply(evaluation);
		}).not.toThrow();
		const error = await pending?.catch((failure: unknown) => failure);
		expect((error as Error).message).toBe(
			"Station proposal review generation could not be read before Apply.",
		);
		expect((error as Error).message).not.toContain("APPLY_GENERATION_FAILURE");
		expect(worker.requests).toHaveLength(1);
		expect(worker.terminated).toBe(true);
		expect(worker.session.isTerminal()).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("terminally rejects when the post-authorization Apply clock read throws", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ControlledRuntimeWorker(true);
		let applyClockThrows = false;
		let tick = 0;
		const now = (): number => {
			if (applyClockThrows) {
				throw new Error("PUBLIC_SYNTHETIC_POST_AUTHORIZE_CLOCK_FAILURE");
			}
			return ++tick;
		};
		const bridge = testBridge(() => worker, 30_000, now);
		const evaluation = await bridge.evaluate(fixture.input);
		expect(worker.session.isReady()).toBe(true);
		applyClockThrows = true;

		let pending: Promise<unknown> | undefined;
		expect(() => {
			pending = bridge.apply(evaluation);
		}).not.toThrow();
		const error = await pending?.catch((failure: unknown) => failure);
		expect((error as Error).message).toBe(
			"Station proposal review Apply session could not be started.",
		);
		expect((error as Error).message).not.toContain("POST_AUTHORIZE_CLOCK_FAILURE");
		expect(worker.requests).toHaveLength(1);
		expect(worker.terminated).toBe(true);
		expect(worker.session.isTerminal()).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("rechecks an external abort triggered by the post-authorization Apply clock", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ControlledRuntimeWorker(true);
		const controller = new AbortController();
		let abortOnClock = false;
		let tick = 0;
		const now = (): number => {
			if (abortOnClock && !controller.signal.aborted) controller.abort();
			return ++tick;
		};
		const bridge = testBridge(() => worker, 30_000, now);
		const evaluation = await bridge.evaluate(fixture.input, controller.signal);
		expect(worker.session.isReady()).toBe(true);
		abortOnClock = true;

		let pending: Promise<unknown> | undefined;
		expect(() => {
			pending = bridge.apply(evaluation);
		}).not.toThrow();
		const error = await pending?.catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(OpenFabStationProposalReviewCancelledError);
		expect((error as Error).name).toBe("AbortError");
		expect(worker.requests).toHaveLength(1);
		expect(worker.terminated).toBe(true);
		expect(worker.session.isTerminal()).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("terminally cleans preparation when signal listener registration throws", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		let workerCreated = false;
		const hostileSignal = {
			aborted: false,
			addEventListener(): void {
				throw new Error(REDACTION_SENTINEL);
			},
			removeEventListener(): void {
				throw new Error(REDACTION_SENTINEL);
			},
		} as unknown as AbortSignal;
		const bridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});

		const error = await bridge
			.evaluate(fixture.input, hostileSignal)
			.catch((failure: unknown) => failure);

		expect((error as Error).message).toBe(
			"Station proposal review cancellation could not be observed.",
		);
		expect((error as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(workerCreated).toBe(false);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				fixture.input.snapshot,
				fixture.document.map,
				fixture.document.getPatchSequence(),
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(false);
		expectDocumentIdentity(fixture.document, before);
	});

	it("revokes the snapshot when the initial cancellation-state getter throws", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		let workerCreated = false;
		const hostileSignal = {
			get aborted(): boolean {
				throw new Error(REDACTION_SENTINEL);
			},
		} as unknown as AbortSignal;
		const bridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});

		const error = await bridge
			.evaluate(fixture.input, hostileSignal)
			.catch((failure: unknown) => failure);

		expect((error as Error).message).toBe(
			"Station proposal review cancellation state could not be read.",
		);
		expect((error as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(workerCreated).toBe(false);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				fixture.input.snapshot,
				fixture.document.map,
				fixture.document.getPatchSequence(),
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(false);
		expectDocumentIdentity(fixture.document, before);
	});

	it("does not resume when an initial cancellation-state getter disposes the bridge", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		let workerCreated = false;
		const bridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});
		const hostileSignal = {
			get aborted(): boolean {
				bridge.dispose();
				return false;
			},
		} as unknown as AbortSignal;

		const error = await bridge
			.evaluate(fixture.input, hostileSignal)
			.catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(OpenFabStationProposalReviewCancelledError);
		expect(workerCreated).toBe(false);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				fixture.input.snapshot,
				fixture.document.map,
				fixture.document.getPatchSequence(),
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(false);
		expectDocumentIdentity(fixture.document, before);
	});

	it("turns hostile Apply cancellation-state getters into terminal Promise rejections", async () => {
		const precheckFixture = reviewFixture("READY");
		const precheckBefore = captureDocumentIdentity(precheckFixture.document);
		const precheckWorker = new ControlledRuntimeWorker(true);
		const precheckBridge = testBridge(() => precheckWorker);
		const precheckEvaluation = await precheckBridge.evaluate(precheckFixture.input);
		const precheckSignal = {
			get aborted(): boolean {
				throw new Error(REDACTION_SENTINEL);
			},
		} as unknown as AbortSignal;

		let precheckPending: Promise<unknown> | undefined;
		expect(() => {
			precheckPending = precheckBridge.apply(precheckEvaluation, precheckSignal);
		}).not.toThrow();
		const precheckError = await precheckPending?.catch((failure: unknown) => failure);
		expect((precheckError as Error).message).toBe(
			"Station proposal review Apply cancellation state could not be read.",
		);
		expect((precheckError as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(precheckWorker.requests).toHaveLength(1);
		expect(precheckWorker.terminated).toBe(true);
		expectDocumentIdentity(precheckFixture.document, precheckBefore);

		const postAddFixture = reviewFixture("READY");
		const postAddBefore = captureDocumentIdentity(postAddFixture.document);
		const postAddWorker = new ControlledRuntimeWorker(true);
		const postAddBridge = testBridge(() => postAddWorker);
		const postAddEvaluation = await postAddBridge.evaluate(postAddFixture.input);
		let abortedReads = 0;
		const postAddSignal = {
			get aborted(): boolean {
				abortedReads++;
				if (abortedReads > 1) throw new Error(REDACTION_SENTINEL);
				return false;
			},
			addEventListener(): void {},
			removeEventListener(): void {},
		} as unknown as AbortSignal;

		let postAddPending: Promise<unknown> | undefined;
		expect(() => {
			postAddPending = postAddBridge.apply(postAddEvaluation, postAddSignal);
		}).not.toThrow();
		const postAddError = await postAddPending?.catch((failure: unknown) => failure);
		expect((postAddError as Error).message).toBe(
			"Station proposal review Apply cancellation could not be observed.",
		);
		expect((postAddError as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(postAddWorker.requests).toHaveLength(1);
		expect(postAddWorker.terminated).toBe(true);
		expectDocumentIdentity(postAddFixture.document, postAddBefore);
	});

	it("settles Apply when signal registration invokes the abort listener reentrantly", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ControlledRuntimeWorker(true);
		const bridge = testBridge(() => worker);
		const evaluation = await bridge.evaluate(fixture.input);
		const hostileSignal = {
			aborted: false,
			addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
				if (typeof listener === "function") listener(new Event("abort"));
				else listener.handleEvent(new Event("abort"));
			},
			removeEventListener(): void {},
		} as unknown as AbortSignal;

		let pending: Promise<unknown> | undefined;
		expect(() => {
			pending = bridge.apply(evaluation, hostileSignal);
		}).not.toThrow();
		const error = await pending?.catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(OpenFabStationProposalReviewCancelledError);
		expect(worker.requests).toHaveLength(1);
		expect(worker.terminated).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("ignores hostile signal listener removal after a complete Apply", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ControlledRuntimeWorker(true);
		let addCalls = 0;
		let removeCalls = 0;
		const hostileSignal = {
			aborted: false,
			addEventListener(): void {
				addCalls++;
			},
			removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
				removeCalls++;
				if (typeof listener === "function") listener(new Event("abort"));
				else listener.handleEvent(new Event("abort"));
				throw new Error(REDACTION_SENTINEL);
			},
		} as unknown as AbortSignal;
		const bridge = testBridge(() => worker);

		const evaluation = await bridge.evaluate(fixture.input, hostileSignal);
		const prepared = await bridge.apply(evaluation, hostileSignal);

		expect(prepared.apply.kind).toBe("reviewed-port-equipment-apply");
		expect(addCalls).toBe(2);
		expect(removeCalls).toBe(2);
		expect(worker.terminated).toBe(true);
		expectDocumentIdentity(fixture.document, before);
	});

	it("redacts a generation-reader failure during cooperative preparation", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		let reads = 0;
		let workerCreated = false;
		const input = Object.freeze({
			...fixture.input,
			getGeneration: (): number => {
				reads++;
				if (reads > 1) throw new Error(REDACTION_SENTINEL);
				return GENERATION;
			},
		});
		const bridge = testBridge(() => {
			workerCreated = true;
			return new ControlledRuntimeWorker();
		});

		const error = await bridge.evaluate(input).catch((failure: unknown) => failure);

		expect((error as Error).message).toBe(
			"Station proposal review generation could not be read during preparation.",
		);
		expect((error as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(workerCreated).toBe(false);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				fixture.input.snapshot,
				fixture.document.map,
				fixture.document.getPatchSequence(),
				fixture.document.portEquipment,
				fixture.document.organizations,
			),
		).toBe(false);
		expectDocumentIdentity(fixture.document, before);
	});

	it("does not hang when a Worker handler setter fails reentrantly", async () => {
		const fixture = reviewFixture("READY");
		const before = captureDocumentIdentity(fixture.document);
		const worker = new ReentrantHandlerFailureWorker();
		const bridge = testBridge(() => worker);

		const error = await bridge.evaluate(fixture.input).catch((failure: unknown) => failure);

		expect((error as Error).message).toBe("Station proposal review session could not be started.");
		expect((error as Error).message).not.toContain(REDACTION_SENTINEL);
		expect(worker.postCount).toBe(0);
		expect(worker.terminated).toBe(true);
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
		expectDocumentIdentity(fixture.document, before);
	});

	it("keeps the reentrant latest evaluation when the post-permit clock starts it", async () => {
		const firstFixture = reviewFixture("READY", GENERATION);
		const secondFixture = reviewFixture("READY", GENERATION + 1);
		const firstBefore = captureDocumentIdentity(firstFixture.document);
		const secondBefore = captureDocumentIdentity(secondFixture.document);
		const firstWorker = new ControlledRuntimeWorker(true);
		const secondWorker = new ControlledRuntimeWorker(true);
		let workerIndex = 0;
		let firstWorkerCreated = false;
		let reentered = false;
		let tick = 0;
		let secondPending: Promise<OpenFabStationProposalReviewBridgeEvaluation> | undefined;
		const now = (): number => {
			if (firstWorkerCreated && !reentered) {
				reentered = true;
				secondPending = bridge.evaluate(secondFixture.input);
			}
			return ++tick;
		};
		const bridge = testBridge(
			() => {
				const worker = [firstWorker, secondWorker][workerIndex++];
				if (!worker) throw new Error("Unexpected synthetic Worker creation.");
				if (worker === firstWorker) firstWorkerCreated = true;
				return worker;
			},
			30_000,
			now,
		);

		const firstPending = bridge.evaluate(firstFixture.input);

		await expect(firstPending).rejects.toBeInstanceOf(OpenFabStationProposalReviewCancelledError);
		if (!secondPending) throw new Error("Expected a reentrant latest evaluation.");
		await expect(secondPending).resolves.toMatchObject({
			generation: GENERATION + 1,
			canApply: true,
		});
		expect(firstWorker.requests).toHaveLength(0);
		expect(firstWorker.terminated).toBe(true);
		expect(firstWorker.session.isTerminal()).toBe(true);
		expect(secondWorker.requests).toHaveLength(1);
		expect(secondWorker.terminated).toBe(false);
		expectDocumentIdentity(firstFixture.document, firstBefore);
		expectDocumentIdentity(secondFixture.document, secondBefore);
		bridge.cancel();
		expect(secondWorker.terminated).toBe(true);
	});
});

function testBridge(
	createWorker: () => OpenFabStationProposalReviewWorkerPort,
	timeoutMilliseconds = 30_000,
	now: () => number = steppingClock(),
): OpenFabStationProposalReviewBridge {
	return new OpenFabStationProposalReviewBridge(
		createWorker,
		timeoutMilliseconds,
		async () => {},
		now,
		1,
	);
}

interface SnapshotReviewFixture {
	readonly document: RailDocument;
	readonly input: OpenFabStationProposalReviewBridgeInput;
	readonly draftSnapshot: DraftSoA.OpenFabStationProposalReviewDraftSnapshot;
	readonly setGeneration: (generation: number) => void;
}

async function snapshotReviewFixture(
	initialGeneration = GENERATION,
): Promise<SnapshotReviewFixture> {
	const fixture = reviewFixture("READY", initialGeneration);
	const draftSnapshot = await DraftSoA.encodeOpenFabStationProposalReviewDraftCooperatively(
		readyDraft(),
		fixture.input.proposal.rowCount,
		{
			checkpoint: async () => {},
			revision: () => initialGeneration,
			now: () => 0,
			sliceMilliseconds: 1,
		},
	);
	return {
		document: fixture.document,
		draftSnapshot,
		input: Object.freeze({
			document: fixture.document,
			proposal: fixture.input.proposal,
			draftSnapshot,
			snapshot: fixture.input.snapshot,
			generation: fixture.input.generation,
			getGeneration: fixture.input.getGeneration,
		}),
		setGeneration: fixture.setGeneration,
	};
}

function readyReviewSession(
	proposal: OpenFabStationProposalReviewBridgeInput["proposal"],
): OpenFabStationProposalReviewSession {
	const session = createOpenFabStationProposalReviewSession(proposal);
	const draft = readyDraft();
	for (const decision of draft.rowDecisions) {
		if (decision.disposition !== "INCLUDE") throw new Error("Expected an include-only fixture.");
		session.dispatch({ type: "INCLUDE_ROW", decision });
	}
	for (const group of draft.groupDecisions) {
		session.dispatch({
			type: "CREATE_GROUP",
			reviewGroupId: group.reviewGroupId,
			kind: group.kind,
		});
		session.dispatch({
			type: "SET_GROUP_MEMBERS",
			reviewGroupId: group.reviewGroupId,
			memberRows: group.memberRows,
		});
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: group.reviewGroupId,
			groupingReview: group.groupingReview,
		});
	}
	session.dispatch({
		type: "SET_REJECTED_SOURCE_ROWS_POLICY",
		policy: draft.rejectedSourceRowsPolicy,
	});
	session.dispatch({ type: "SET_UNKNOWN_COLUMNS_POLICY", policy: draft.unknownColumnsPolicy });
	session.dispatch({ type: "SET_ORGANIZATION_POLICY", policy: draft.organizationPolicy });
	return session;
}

function expectSnapshotReviewAuthoritiesRevoked(fixture: SnapshotReviewFixture): void {
	expectRailAuthorityRevoked(fixture);
	expect(fixture.draftSnapshot.decisionRows.byteLength).toBeGreaterThan(0);
	expect(() =>
		DraftSoA.releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(fixture.draftSnapshot),
	).toThrow("SNAPSHOT_CONTRACT_MISMATCH");
}

function expectRailAuthorityRevoked(fixture: {
	readonly document: RailDocument;
	readonly input: OpenFabStationProposalReviewBridgeInput;
}): void {
	expect(
		consumeRailMirrorSnapshotCaptureAuthority(
			fixture.input.snapshot,
			fixture.document.map,
			fixture.document.getPatchSequence(),
			fixture.document.portEquipment,
			fixture.document.organizations,
		),
	).toBe(false);
}

function reviewFixture(
	mode: "READY" | "BLOCKED",
	initialGeneration = GENERATION,
): {
	readonly document: RailDocument;
	readonly input: OpenFabStationProposalReviewBridgeInput;
	readonly setGeneration: (generation: number) => void;
} {
	const document = straightDocument();
	const proposal = hydrateOpenFabStationProposalArtifact(syntheticProposalArtifact());
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
	).snapshot;
	let generation = initialGeneration;
	return {
		document,
		input: Object.freeze({
			document,
			proposal,
			draft: mode === "READY" ? readyDraft() : blockedDraft(),
			snapshot,
			generation: initialGeneration,
			getGeneration: () => generation,
		}),
		setGeneration(nextGeneration: number): void {
			generation = nextGeneration;
		},
	};
}

function straightDocument(): RailDocument {
	const seed = new RailDocument();
	const construction = planRailConstruction(seed.map, { x: 0, y: 0 }, { x: 4, y: 0 });
	if (!seed.commit(construction)) throw new Error("Synthetic straight rail could not be built.");
	return RailDocument.fromLoadedMap(seed.map, 7);
}

function readyDraft(): OpenFabStationProposalReviewDraft {
	return Object.freeze({
		rowDecisions: Object.freeze([
			Object.freeze({
				row: 0,
				disposition: "INCLUDE" as const,
				identityAction: "CREATE_NEW" as const,
				portType: "OHB" as const,
				typeReview: "CONFIRM_DECLARED" as const,
				attachmentReview: "USER_SELECTED_EXACT_ROUTE" as const,
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: 1,
					z: 0,
					from: DIR_W,
					to: DIR_E,
				}),
				stationMillimeters: 500,
				stationReview: "CONFIRM_DECLARED" as const,
				side: "LEFT" as const,
				lateralOffsetMillimeters: 700,
				sideOffsetReview: "CONFIRM_DECLARED" as const,
				direction: "WITH_TRAVEL" as const,
				directionReview: "CONFIRM_DECLARED" as const,
				sourcePositionReview: "NOT_PROVIDED" as const,
			}),
		]),
		groupDecisions: Object.freeze([
			Object.freeze({
				reviewGroupId: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				groupingReview: "CONFIRM_DECLARED" as const,
				memberRows: Object.freeze([0]),
			}),
		]),
		rejectedSourceRowsPolicy: "NOT_APPLICABLE" as const,
		unknownColumnsPolicy: "NOT_APPLICABLE" as const,
		organizationPolicy: "EXPLICIT_UNASSIGNED" as const,
	});
}

function blockedDraft(): OpenFabStationProposalReviewDraft {
	return Object.freeze({
		rowDecisions: Object.freeze([]),
		groupDecisions: Object.freeze([]),
		rejectedSourceRowsPolicy: "NOT_APPLICABLE" as const,
		unknownColumnsPolicy: "NOT_APPLICABLE" as const,
		organizationPolicy: "EXPLICIT_UNASSIGNED" as const,
	});
}

function syntheticProposalArtifact(): OpenFabStationProposalArtifact {
	const row: Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], string> = {
		identity_scope: "PUBLIC_SYNTHETIC_SCOPE",
		port_key: "PUBLIC_SYNTHETIC_OHB_1",
		secondary_aliases: "",
		attachment_scope: "PUBLIC_SYNTHETIC_RAIL_SCOPE",
		attachment_alias: "PUBLIC_SYNTHETIC_ROUTE_1",
		station_mm: "500",
		side: "LEFT",
		lateral_offset_mm: "700",
		direction: "WITH_TRAVEL",
		direction_evidence: "DECLARED",
		port_type: "OHB",
		physical_group_key: "PUBLIC_SYNTHETIC_OHB_GROUP_1",
		physical_group_kind: "OHB",
		organization_alias: "",
		source_x_mm: "",
		source_z_mm: "",
	};
	const csv = `${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n${OPENFAB_STATION_PROPOSAL_V1_HEADERS.map((header) => row[header]).join(",")}`;
	const parsed = parseOpenFabStationProposalCsv(new TextEncoder().encode(csv));
	if (!parsed.ok) throw new Error(`Synthetic proposal failed: ${parsed.failure.code}`);
	return parsed.artifact;
}

function requiredRequest(
	worker: ControlledRuntimeWorker,
): OpenFabStationProposalReviewWorkerRequest {
	const request = worker.requests[0];
	if (!request) throw new Error("Expected a posted synthetic station review request.");
	return request;
}

function fixedErrorResponse(
	request: OpenFabStationProposalReviewWorkerRequest,
	code: OpenFabStationProposalReviewWorkerErrorCode,
): OpenFabStationProposalReviewWorkerResponse {
	return Object.freeze({
		type: "OPENFAB_STATION_PROPOSAL_REVIEW_ERROR" as const,
		protocolVersion: OPENFAB_STATION_PROPOSAL_REVIEW_WORKER_PROTOCOL_VERSION,
		requestId: request.requestId,
		generation: request.generation,
		ticketId: request.ticketId,
		code,
		message: openFabStationProposalReviewWorkerErrorMessage(code),
	});
}

function requireArrayBuffers(transfers: readonly Transferable[]): ArrayBuffer[] {
	return transfers.map((transfer) => {
		if (!(transfer instanceof ArrayBuffer)) {
			throw new Error("Synthetic station review unexpectedly exposed a non-buffer transfer.");
		}
		return transfer;
	});
}

async function waitForRequest(worker: ControlledRuntimeWorker): Promise<void> {
	await worker.requestPosted;
	if (worker.requests.length === 0) {
		throw new Error("Synthetic station review Worker did not receive its request.");
	}
}

function steppingClock(): () => number {
	let tick = 0;
	return () => ++tick;
}

interface DocumentIdentity {
	readonly map: RailDocument["map"];
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly revision: number;
	readonly patchSequence: number;
	readonly advancedSwitchCursor: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly organizationCount: number;
}

function captureDocumentIdentity(document: RailDocument): DocumentIdentity {
	return Object.freeze({
		map: document.map,
		portEquipment: document.portEquipment,
		organizations: document.organizations,
		revision: document.map.getRevision(),
		patchSequence: document.getPatchSequence(),
		advancedSwitchCursor: document.map.getAdvancedSwitchIdCursor(),
		nextPortId: document.portEquipment.nextPortId,
		nextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: document.organizations.nextOrganizationId,
		portCount: document.portEquipment.ports.length,
		equipmentGroupCount: document.portEquipment.equipmentGroups.length,
		organizationCount: document.organizations.records.length,
	});
}

function expectDocumentIdentity(document: RailDocument, expected: DocumentIdentity): void {
	expect(captureDocumentIdentity(document)).toEqual(expected);
}
