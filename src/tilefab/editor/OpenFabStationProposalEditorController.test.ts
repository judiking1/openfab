import { describe, expect, it, vi } from "vitest";
import { hydrateOpenFabStationProposalReadResult } from "../compile/OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "../compile/OpenFabStationProposalCsvReader";
import type {
	MeasuredRailDocumentReviewedPortEquipmentCommit,
	RailDocument,
} from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import type { OpenFabStationProposalReviewWorkerRequest } from "../worker/OpenFabStationProposalReviewWorkerProtocol";
import {
	collectOpenFabStationProposalReviewWorkerResponseTransfers,
	OpenFabStationProposalReviewWorkerSession,
} from "../worker/OpenFabStationProposalReviewWorkerRuntime";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { createRailScaleProbeDocument } from "../worker/RailStartupFixture";
import { INITIAL_RAIL_WORKER_STATE } from "../worker/RailWorkerBridge";
import {
	OpenFabStationProposalEditorController,
	type OpenFabStationProposalEditorEnvironment,
	type OpenFabStationProposalReviewUiState,
} from "./OpenFabStationProposalEditorController";
import {
	OpenFabStationProposalReviewBridge,
	type OpenFabStationProposalReviewBridgeEvaluation,
	type OpenFabStationProposalReviewWorkerPort,
} from "./OpenFabStationProposalReviewBridge";

// Genuine Worker protocol/runtime and Apply authority; only delivery and commit completion are held.
class RuntimeWorker implements OpenFabStationProposalReviewWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	private readonly session = new OpenFabStationProposalReviewWorkerSession();
	terminated = false;
	postMessage(
		message: OpenFabStationProposalReviewWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		const delivered = structuredClone(message, { transfer });
		void this.session
			.receive(delivered)
			.then((response) => {
				if (this.terminated) return;
				const buffers = collectOpenFabStationProposalReviewWorkerResponseTransfers(response);
				this.onmessage?.({
					data: structuredClone(response, { transfer: buffers }),
				} as MessageEvent<unknown>);
			})
			.catch(() => this.onerror?.({ message: "Synthetic review Worker failed" } as ErrorEvent));
	}
	emitError(): void {
		this.onerror?.({ message: "Synthetic review Worker failed" } as ErrorEvent);
	}
	emitMessageError(): void {
		this.onmessageerror?.({ data: null } as MessageEvent<unknown>);
	}
	terminate(): void {
		this.terminated = true;
		this.session.terminate();
	}
}

describe("OpenFabStationProposalEditorController terminal completion", () => {
	it.each([
		"native",
		"decode",
	] as const)("clears READY after an idle %s fault, retains the draft, and permits fresh evaluation", async (fault) => {
		const fixture = await reviewFixture();
		try {
			await ready(fixture);
			const original = fixture.view.current;
			if (!original) throw new Error("Expected a READY review");
			const summary = original.session.getSummary();
			const worker = fixture.workers[0];
			if (!worker) throw new Error("Expected a live READY Worker");
			const retiredError = worker.onerror;
			const retiredDecode = worker.onmessageerror;
			if (fault === "native") worker.emitError();
			else worker.emitMessageError();
			expect(fixture.view.current).toMatchObject({ phase: "reviewing", evaluation: null });
			expect(fixture.view.current?.error).toBe(
				fault === "native"
					? "Station proposal review Worker failed."
					: "Station proposal review Worker response was unreadable.",
			);
			expect(fixture.view.current?.session).toBe(original.session);
			expect(original.session.getSummary()).toEqual(summary);
			expect(worker.terminated).toBe(true);
			expect(sourceReceipt(fixture.document)).toEqual(fixture.before);
			const recovered = deferred<void>();
			const publish = fixture.publish.getMockImplementation();
			fixture.publish.mockImplementation((next) => {
				publish?.(next);
				if (next?.phase === "ready") recovered.resolve();
			});
			fixture.commands.evaluateStationProposalReview();
			await recovered.promise;
			expect(fixture.view.current?.evaluation?.canApply).toBe(true);
			expect(fixture.workers).toHaveLength(2);
			const publications = fixture.publish.mock.calls.length;
			const statuses = fixture.status.mock.calls.length;
			retiredError?.({ message: "Retired synthetic fault" } as ErrorEvent);
			retiredDecode?.({ data: null } as MessageEvent<unknown>);
			await settleCompletionMicrotasks();
			expect(fixture.publish).toHaveBeenCalledTimes(publications);
			expect(fixture.status).toHaveBeenCalledTimes(statuses);
			expect(sourceReceipt(fixture.document)).toEqual(fixture.before);
		} finally {
			fixture.owner.dispose();
		}
	});

	it("does not publish a fault status after failure publication reentrantly disposes the owner", async () => {
		const fixture = await reviewFixture();
		try {
			await ready(fixture);
			const publish = fixture.publish.getMockImplementation();
			fixture.publish.mockImplementation((next) => {
				publish?.(next);
				if (next?.phase === "reviewing" && next.error) fixture.owner.dispose();
			});
			const statuses = fixture.status.mock.calls.length;
			fixture.workers[0]?.emitError();
			await settleCompletionMicrotasks();
			expect(fixture.status).toHaveBeenCalledTimes(statuses);
			expect(sourceReceipt(fixture.document)).toEqual(fixture.before);
		} finally {
			fixture.owner.dispose();
		}
	});

	it("suppresses resolved READY when its idle Worker faults before the success microtask", async () => {
		const fixture = await reviewFixture();
		try {
			fixture.commands.evaluateStationProposalReview();
			const result = await fixture.evaluated.promise;
			fixture.workers[0]?.emitError();
			fixture.releaseEvaluation.resolve(result);
			await settleCompletionMicrotasks();
			expect(fixture.view.current).toMatchObject({
				phase: "reviewing",
				evaluation: null,
				error: "Station proposal review Worker failed.",
			});
			expect(fixture.publish.mock.calls.some(([view]) => view?.phase === "ready")).toBe(false);
			expect(fixture.status.mock.calls.some(([message]) => message.includes("READY"))).toBe(false);
			expect(sourceReceipt(fixture.document)).toEqual(fixture.before);
		} finally {
			fixture.owner.dispose();
		}
	});

	it("keeps the failure status when publishing READY reentrantly faults the Worker", async () => {
		const fixture = await reviewFixture();
		try {
			const publish = fixture.publish.getMockImplementation();
			fixture.publish.mockImplementation((next) => {
				publish?.(next);
				if (next?.phase === "ready") fixture.workers[0]?.emitError();
			});
			await ready(fixture);
			await settleCompletionMicrotasks();
			expect(fixture.view.current).toMatchObject({
				phase: "reviewing",
				evaluation: null,
				error: "Station proposal review Worker failed.",
			});
			expect(fixture.status.mock.calls.at(-1)?.[0]).toBe("Station proposal review Worker failed.");
			expect(fixture.status.mock.calls.some(([message]) => message.includes("READY"))).toBe(false);
			expect(sourceReceipt(fixture.document)).toEqual(fixture.before);
		} finally {
			fixture.owner.dispose();
		}
	});

	it.each([
		"cancel",
		"dispose",
		"model replacement",
	] as const)("suppresses idle READY fault UI after %s", async (finish) => {
		const fixture = await reviewFixture();
		try {
			await ready(fixture);
			const fault = fixture.workers[0]?.onerror;
			if (finish === "cancel") fixture.commands.cancelStationProposalReview("Cancelled");
			else if (finish === "dispose") fixture.owner.dispose();
			else fixture.editorModelRef.current = { ...fixture.editorModelRef.current, generation: 2 };
			const publications = fixture.publish.mock.calls.length;
			const statuses = fixture.status.mock.calls.length;
			fault?.({ message: "Retired synthetic fault" } as ErrorEvent);
			await settleCompletionMicrotasks();
			expect(fixture.publish).toHaveBeenCalledTimes(publications);
			expect(fixture.status).toHaveBeenCalledTimes(statuses);
			expect(sourceReceipt(fixture.document)).toEqual(fixture.before);
		} finally {
			fixture.owner.dispose();
		}
	});

	it("does not publish READY when a resolved evaluation is disposed before its success microtask", async () => {
		const fixture = await reviewFixture();
		try {
			fixture.commands.evaluateStationProposalReview();
			const result = await fixture.evaluated.promise;
			fixture.releaseEvaluation.resolve(result);
			fixture.owner.dispose();
			await settleCompletionMicrotasks();
			expect(fixture.publish.mock.calls.some(([view]) => view?.phase === "ready")).toBe(false);
			expect(fixture.view.current?.phase).toBe("evaluating");
			expect(fixture.status.mock.calls.some(([message]) => message.includes("READY"))).toBe(false);
			expect(sourceReceipt(fixture.document)).toEqual(fixture.before);
		} finally {
			fixture.owner.dispose();
		}
	});

	it("cancel preserves the document and suppresses a late resolved evaluation", async () => {
		const fixture = await reviewFixture();
		try {
			fixture.commands.evaluateStationProposalReview();
			const result = await fixture.evaluated.promise;
			fixture.commands.cancelStationProposalReview("Cancelled");
			const publications = fixture.publish.mock.calls.length;
			const statuses = fixture.status.mock.calls.length;
			fixture.releaseEvaluation.resolve(result);
			await settleCompletionMicrotasks();
			expect(fixture.view.current).toBeNull();
			expect(fixture.publish).toHaveBeenCalledTimes(publications);
			expect(fixture.status).toHaveBeenCalledTimes(statuses);
			expect(sourceReceipt(fixture.document)).toEqual(fixture.before);
		} finally {
			fixture.owner.dispose();
		}
	});

	it("retains an atomic Apply completed before disposal without late UI telemetry or synchronization", async () => {
		const fixture = await reviewFixture();
		try {
			await ready(fixture);
			const held = holdCommittedResult(fixture.document);
			fixture.commands.applyStationProposalReview();
			const result = await held.committed.promise;
			expect(result.committed).toBe(true);
			const committedSource = sourceReceipt(fixture.document);
			expect(committedSource.sequence).toBe(fixture.before.sequence + 1);
			expect(fixture.document.portEquipment.ports).toHaveLength(1);
			fixture.owner.dispose();
			const publications = fixture.publish.mock.calls.length;
			const statuses = fixture.status.mock.calls.length;
			held.release.resolve(result);
			await settleCompletionMicrotasks();
			expect(fixture.recordApplied).not.toHaveBeenCalled();
			expect(fixture.syncModelUi).not.toHaveBeenCalled();
			expect(fixture.publish).toHaveBeenCalledTimes(publications);
			expect(fixture.status).toHaveBeenCalledTimes(statuses);
			expect(sourceReceipt(fixture.document)).toEqual(committedSource);
			expect(held.commit).toHaveBeenCalledTimes(1);
		} finally {
			fixture.owner.dispose();
			vi.restoreAllMocks();
		}
	});

	it("publishes one Apply success after an accepted commit despite retired Worker faults", async () => {
		const fixture = await reviewFixture();
		try {
			await ready(fixture);
			const retiredError = fixture.workers[0]?.onerror;
			const retiredDecode = fixture.workers[0]?.onmessageerror;
			const held = holdCommittedResult(fixture.document);
			fixture.commands.applyStationProposalReview();
			const result = await held.committed.promise;
			expect(result.committed).toBe(true);
			expect(fixture.document.getPatchSequence()).toBe(fixture.before.sequence + 1);
			const committedSource = sourceReceipt(fixture.document);
			const publications = fixture.publish.mock.calls.length;
			const statuses = fixture.status.mock.calls.length;
			retiredError?.({ message: "Retired synthetic fault" } as ErrorEvent);
			retiredDecode?.({ data: null } as MessageEvent<unknown>);
			expect(fixture.publish).toHaveBeenCalledTimes(publications);
			expect(fixture.status).toHaveBeenCalledTimes(statuses);
			expect(fixture.view.current?.phase).toBe("applying");
			expect(sourceReceipt(fixture.document)).toEqual(committedSource);
			held.release.resolve(result);
			await settleCompletionMicrotasks();
			expect(fixture.recordApplied).toHaveBeenCalledTimes(1);
			expect(fixture.syncModelUi).toHaveBeenCalledTimes(1);
			expect(fixture.view.current).toBeNull();
			expect(held.commit).toHaveBeenCalledTimes(1);
		} finally {
			fixture.owner.dispose();
			vi.restoreAllMocks();
		}
	});
});

async function reviewFixture() {
	const document = createRailScaleProbeDocument(4);
	const before = sourceReceipt(document);
	const view = { current: null as OpenFabStationProposalReviewUiState | null };
	const evaluated = deferred<OpenFabStationProposalReviewBridgeEvaluation>();
	const releaseEvaluation = deferred<OpenFabStationProposalReviewBridgeEvaluation>();
	const publishedReady = deferred<void>();
	const workers: RuntimeWorker[] = [];
	let holdFirstEvaluation = true;
	const owner = new OpenFabStationProposalEditorController(view, {
		reader: {
			read: async (source) =>
				hydrateOpenFabStationProposalReadResult(
					parseOpenFabStationProposalCsv(new Uint8Array(source)),
				),
			cancel: vi.fn(),
			dispose: vi.fn(),
		},
		createReviewBridge: (onReadyInvalidated) => {
			const bridge = new OpenFabStationProposalReviewBridge(
				() => {
					const worker = new RuntimeWorker();
					workers.push(worker);
					return worker;
				},
				30_000,
				async () => {},
				() => 0,
				1,
				onReadyInvalidated,
			);
			return {
				evaluate: async (input, signal) => {
					const evaluation = await bridge.evaluate(input, signal);
					if (!holdFirstEvaluation) return evaluation;
					holdFirstEvaluation = false;
					evaluated.resolve(evaluation);
					return releaseEvaluation.promise;
				},
				apply: bridge.apply.bind(bridge),
				dispose: bridge.dispose.bind(bridge),
			};
		},
	});
	const publish = vi.fn((next: OpenFabStationProposalReviewUiState | null) => {
		// Exclusive-command consumers see the new ref before the React publication callback.
		expect(view.current).toBe(next);
		if (next?.phase === "ready") publishedReady.resolve();
	});
	const status = vi.fn<(message: string) => void>();
	const recordApplied = vi.fn<OpenFabStationProposalEditorEnvironment["recordApplied"]>();
	const syncModelUi = vi.fn<OpenFabStationProposalEditorEnvironment["syncModelUi"]>();
	const editorModelRef = { current: { document, map: document.map, generation: 1 } };
	const commands = owner.bind({
		editorModelRef,
		modelSyncPendingRef: { current: false },
		projectOperationControllerRef: { current: null },
		workerBridgeDocumentRef: { current: document },
		workerBridgeRef: {
			current: {
				getState: () => ({ ...INITIAL_RAIL_WORKER_STATE, status: "ready" }),
				captureCurrentSnapshot: async () =>
					captureRailMirrorSnapshot(
						document.map,
						document.getPatchSequence(),
						document.portEquipment,
						document.organizations,
						document.relationships,
					).snapshot,
			},
		},
		startupState: { status: "ready" },
		projectSession: { operation: "idle" },
		stationProposalFileGateway: {
			chooseOpen: async () => {
				const csv =
					"identity_scope,port_key,attachment_scope,attachment_alias,station_mm,side,lateral_offset_mm,direction,direction_evidence,port_type,physical_group_key,physical_group_kind,organization_alias,source_x_mm,source_z_mm\nPUBLIC_TEST,PUBLIC_OHB_1,PUBLIC_RAIL,PUBLIC_ROUTE_1,500,LEFT,700,WITH_TRAVEL,DECLARED,OHB,PUBLIC_GROUP_1,OHB,,,";
				return {
					displayName: "public-test.csv",
					bytes: new TextEncoder().encode(csv).buffer as ArrayBuffer,
				};
			},
		},
		blockStaticFabExclusiveCommand: () => false,
		setStationProposalReviewState: publish,
		setStatus: status,
		rememberLauncher: vi.fn(),
		prepareReviewUi: vi.fn(),
		onCancel: vi.fn(),
		activateStationProposalReviewPortTool: vi.fn(),
		updateEditorActivity: vi.fn(),
		scheduleRender: vi.fn(),
		checkpoint: async () => {},
		performanceNow: () => 0,
		recordApplied,
		syncModelUi,
	});
	await commands.openStationProposalReview({} as HTMLButtonElement);
	const review = view.current;
	if (!review) throw new Error("Synthetic proposal did not open");
	const rail = document.map.getRail(1, 0);
	if (rail.incoming !== DIR_E || rail.outgoing !== DIR_W)
		throw new Error("Unexpected synthetic directed rail");
	const session = review.session;
	session.dispatch({
		type: "INCLUDE_ROW",
		decision: {
			row: 0,
			disposition: "INCLUDE",
			identityAction: "CREATE_NEW",
			portType: "OHB",
			typeReview: "CONFIRM_DECLARED",
			attachmentReview: "USER_SELECTED_EXACT_ROUTE",
			route: { kind: "CARDINAL_CELL", x: 1, z: 0, from: DIR_E, to: DIR_W },
			stationMillimeters: 500,
			stationReview: "CONFIRM_DECLARED",
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			sideOffsetReview: "CONFIRM_DECLARED",
			direction: "WITH_TRAVEL",
			directionReview: "CONFIRM_DECLARED",
			sourcePositionReview: "NOT_PROVIDED",
		},
	});
	session.dispatch({ type: "CREATE_GROUP", reviewGroupId: 1, kind: "OHB" });
	session.dispatch({ type: "SET_GROUP_MEMBERS", reviewGroupId: 1, memberRows: [0] });
	session.dispatch({
		type: "SET_GROUP_REVIEW",
		reviewGroupId: 1,
		groupingReview: "CONFIRM_DECLARED",
	});
	session.dispatch({ type: "SET_REJECTED_SOURCE_ROWS_POLICY", policy: "NOT_APPLICABLE" });
	session.dispatch({ type: "SET_UNKNOWN_COLUMNS_POLICY", policy: "NOT_APPLICABLE" });
	session.dispatch({ type: "SET_ORGANIZATION_POLICY", policy: "EXPLICIT_UNASSIGNED" });
	expect(session.getSummary().captureReady).toBe(true);
	return {
		document,
		before,
		view,
		owner,
		commands,
		workers,
		editorModelRef,
		evaluated,
		releaseEvaluation,
		publishedReady,
		publish,
		status,
		recordApplied,
		syncModelUi,
	};
}

async function ready(fixture: Awaited<ReturnType<typeof reviewFixture>>): Promise<void> {
	fixture.commands.evaluateStationProposalReview();
	const result = await fixture.evaluated.promise;
	expect(result.canApply).toBe(true);
	fixture.releaseEvaluation.resolve(result);
	await fixture.publishedReady.promise;
}

function holdCommittedResult(document: RailDocument) {
	const committed = deferred<MeasuredRailDocumentReviewedPortEquipmentCommit>();
	const release = deferred<MeasuredRailDocumentReviewedPortEquipmentCommit>();
	const original = document.commitReviewedPortEquipmentCooperatively.bind(document);
	const commit = vi
		.spyOn(document, "commitReviewedPortEquipmentCooperatively")
		.mockImplementation(async (apply, options) => {
			const result = await original(apply, options);
			committed.resolve(result);
			return release.promise;
		});
	return { committed, release, commit };
}

function sourceReceipt(document: RailDocument) {
	return {
		map: document.map,
		ports: document.portEquipment,
		organizations: document.organizations,
		relationships: document.relationships,
		operations: document.operationalConfiguration,
		revision: document.map.getRevision(),
		sequence: document.getPatchSequence(),
		checksum: checksumRailMap(
			document.map,
			document.portEquipment,
			document.organizations,
			document.relationships,
		),
		history: document.captureRailMirrorHistoryLedger(),
	};
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function settleCompletionMicrotasks(): Promise<void> {
	// Only controlled Promise continuations remain; no timer or wall-clock performance assertion.
	for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}
