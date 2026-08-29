import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
} from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import {
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
	type StaticFabBayFlowEditIntent,
} from "../core/StaticFabBayFlowEdit";
import { isIssuedStaticFabBayFlowEditPlan } from "../core/StaticFabBayFlowEditCertification";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
} from "../core/StaticFabOrganization";
import { captureRailMirrorSnapshot, type RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import {
	STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
	type StaticFabBayFlowEditWorkerRequest,
	type StaticFabBayFlowEditWorkerResponse,
} from "../worker/StaticFabBayFlowEditProtocol";
import {
	hydrateStaticFabBayFlowEditSession,
	prepareStaticFabBayFlowEditInSession,
	type StaticFabBayFlowEditRuntimeSession,
} from "../worker/StaticFabBayFlowEditRuntime";
import {
	StaticFabBayFlowEditBridge,
	type StaticFabBayFlowEditInput,
	type StaticFabBayFlowEditWorkerPort,
} from "./StaticFabBayFlowEditBridge";

const MINIMUM_TWIN_PROFILE = Object.freeze({
	...defaultOpenFabFabProfile(),
	layoutBlockCount: 1 as const,
	banksPerLayoutBlock: 1 as const,
	processLoopsPerBank: 12 as const,
	bayPackingPolicy: "TWIN" as const,
	processLoopLongAxisMeters: 36 as const,
	processLoopCenterPitchMeters: 12 as const,
});

type WorkerResponseTransform = (
	response: StaticFabBayFlowEditWorkerResponse,
	request: StaticFabBayFlowEditWorkerRequest,
) => unknown;

class InlineRuntimeWorker implements StaticFabBayFlowEditWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabBayFlowEditWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	readonly requests: StaticFabBayFlowEditWorkerRequest[] = [];
	readonly transferCounts: number[] = [];
	terminated = false;
	terminationCount = 0;
	private readonly queuedRequests: StaticFabBayFlowEditWorkerRequest[] = [];
	private readonly transform: WorkerResponseTransform;
	private readonly automatic: boolean;
	private session: StaticFabBayFlowEditRuntimeSession | null = null;

	constructor(transform: WorkerResponseTransform = (response) => response, automatic = true) {
		this.transform = transform;
		this.automatic = automatic;
	}

	postMessage(message: StaticFabBayFlowEditWorkerRequest, transfer: Transferable[] = []): void {
		this.transferCounts.push(transfer.length);
		const request = structuredClone(message, { transfer });
		this.requests.push(request);
		if (this.automatic) {
			queueMicrotask(() => this.dispatch(request));
		} else {
			this.queuedRequests.push(request);
		}
	}

	terminate(): void {
		this.terminated = true;
		this.terminationCount++;
	}

	deliverNext(
		forcedHandler?: (event: MessageEvent<StaticFabBayFlowEditWorkerResponse>) => void,
	): void {
		const request = this.queuedRequests.shift();
		if (!request) throw new Error("Expected a queued Bay flow edit Worker request.");
		this.dispatch(request, forcedHandler);
	}

	private dispatch(
		request: StaticFabBayFlowEditWorkerRequest,
		forcedHandler?: (event: MessageEvent<StaticFabBayFlowEditWorkerResponse>) => void,
	): void {
		if (this.terminated && !forcedHandler) return;
		const response = this.transform(this.responseFor(request), request);
		const handler = forcedHandler ?? this.onmessage;
		handler?.({
			data: structuredClone(response) as StaticFabBayFlowEditWorkerResponse,
		} as MessageEvent<StaticFabBayFlowEditWorkerResponse>);
	}

	private responseFor(
		request: StaticFabBayFlowEditWorkerRequest,
	): StaticFabBayFlowEditWorkerResponse {
		if (request.type === "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT") {
			const startedAt = performance.now();
			const session = hydrateStaticFabBayFlowEditSession(request.snapshot);
			this.session = session;
			return {
				type: "STATIC_FAB_BAY_FLOW_EDIT_HYDRATED",
				version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
				requestId: request.requestId,
				source: session.sourceIdentity,
				sourceEvidence: session.sourceEvidence,
				hydrationMilliseconds: Math.max(0, performance.now() - startedAt),
			};
		}
		if (!this.session) throw new Error("Expected the inline Worker to hydrate before prepare.");
		return {
			type: "STATIC_FAB_BAY_FLOW_EDIT_PREPARED",
			version: STATIC_FAB_BAY_FLOW_EDIT_PROTOCOL_VERSION,
			requestId: request.requestId,
			prepared: prepareStaticFabBayFlowEditInSession(request, this.session),
		};
	}
}

interface BridgeFixture {
	readonly document: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
	readonly bay: StaticFabOrganizationRecord;
	readonly snapshot: RailMirrorSnapshot;
	readonly input: StaticFabBayFlowEditInput;
	setPatchSequence(sequence: number): void;
	replaceOrganizationsIdentity(): void;
}

describe("StaticFabBayFlowEditBridge", () => {
	let composition: CertifiedOpenFabFabComposition;

	beforeAll(() => {
		composition = composeOpenFabFab(MINIMUM_TWIN_PROFILE);
	}, 120_000);

	it("hydrates once, sends only explicit bound intent next, adopts a deep clone, and consumes it once", async () => {
		const fixture = bridgeFixture(composition);
		const workers: InlineRuntimeWorker[] = [];
		const bridge = new StaticFabBayFlowEditBridge(() => {
			const worker = new InlineRuntimeWorker();
			workers.push(worker);
			return worker;
		});

		const result = await bridge.prepare(fixture.input);
		const worker = requireValue(workers[0], "Bay flow edit Worker");
		const plan = requireValue(result.plan, "adopted Bay flow edit plan");

		expect(result.certified).toBe(true);
		expect(isIssuedStaticFabBayFlowEditPlan(plan)).toBe(true);
		expect(result.validation.plan).not.toBe(plan);
		expect(result.validation.plan?.mutations).not.toBe(plan.mutations);
		expect(result.validation.plan?.review).not.toBe(plan.review);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.mutations)).toBe(true);
		expect(isIssuedStaticFabBayFlowEditPlan(structuredClone(plan))).toBe(false);

		expect(worker.requests.map((request) => request.type)).toEqual([
			"HYDRATE_STATIC_FAB_BAY_FLOW_EDIT",
			"PREPARE_STATIC_FAB_BAY_FLOW_EDIT",
		]);
		expect(worker.transferCounts[0]).toBeGreaterThan(0);
		expect(worker.transferCounts[1]).toBe(0);
		const prepareRequest = worker.requests[1];
		if (prepareRequest?.type !== "PREPARE_STATIC_FAB_BAY_FLOW_EDIT") {
			throw new Error("Expected one explicit Bay flow edit prepare request.");
		}
		expect("snapshot" in prepareRequest).toBe(false);
		expect(prepareRequest.intent).toEqual(fixture.input.intent);
		expect(prepareRequest.expectedSource).toMatchObject({
			revision: fixture.snapshot.revision,
			patchSequence: fixture.snapshot.sequence,
			checksum: fixture.snapshot.checksum,
		});
		expect(worker.terminated).toBe(true);
		expect(worker.terminationCount).toBe(1);

		await expect(bridge.prepare(fixture.input)).rejects.toThrow(/capture authority/i);
		expect(workers).toHaveLength(1);
		expect(fixture.document.commitStaticFabBayFlowEdit(plan)).toBe(true);
		expect(fixture.document.commitStaticFabBayFlowEdit(plan)).toBe(false);
		expect(isIssuedStaticFabBayFlowEditPlan(plan)).toBe(false);
	}, 120_000);

	it.each([
		[
			"protocol version",
			(response: StaticFabBayFlowEditWorkerResponse) =>
				response.type === "STATIC_FAB_BAY_FLOW_EDIT_HYDRATED"
					? { ...response, version: response.version + 1 }
					: response,
			/malformed envelope/i,
		],
		[
			"hydrated source identity",
			(response: StaticFabBayFlowEditWorkerResponse) =>
				response.type === "STATIC_FAB_BAY_FLOW_EDIT_HYDRATED"
					? {
							...response,
							source: { ...response.source, checksum: `${response.source.checksum}-forged` },
						}
					: response,
			/hydration|source/i,
		],
		[
			"syntactically valid but divergent prospective checksum",
			(response: StaticFabBayFlowEditWorkerResponse) =>
				corruptPreparedProspectiveChecksum(response),
			/divergent prospective checksum/i,
		],
		[
			"plan fingerprint",
			(response: StaticFabBayFlowEditWorkerResponse) => corruptPreparedPlanFingerprint(response),
			/malformed|fingerprint|ticket/i,
		],
		[
			"unexpected prepared authority field",
			(response: StaticFabBayFlowEditWorkerResponse) => addPreparedField(response),
			/malformed/i,
		],
		[
			"prepared request identity",
			(response: StaticFabBayFlowEditWorkerResponse) =>
				response.type === "STATIC_FAB_BAY_FLOW_EDIT_PREPARED"
					? { ...response, requestId: response.requestId + 1 }
					: response,
			/stale or malformed result/i,
		],
		[
			"source evidence drift across phases",
			(response: StaticFabBayFlowEditWorkerResponse) => driftPreparedSourceEvidence(response),
			/source evidence|topology evidence/i,
		],
	] as const)(
		"rejects malicious %s and terminates its Worker",
		async (_label, transform, error) => {
			const fixture = bridgeFixture(composition);
			const worker = new InlineRuntimeWorker(transform);
			const bridge = new StaticFabBayFlowEditBridge(() => worker);

			await expect(bridge.prepare(fixture.input)).rejects.toThrow(error);
			expect(worker.terminated).toBe(true);
			expect(worker.terminationCount).toBe(1);
		},
		120_000,
	);

	it("rejects stale state before capture, during hydration, and before adoption", async () => {
		const staleBeforeCapture = bridgeFixture(composition);
		staleBeforeCapture.setPatchSequence(staleBeforeCapture.document.getPatchSequence() + 1);
		let workerCreations = 0;
		const initialBridge = new StaticFabBayFlowEditBridge(() => {
			workerCreations++;
			return new InlineRuntimeWorker();
		});
		await expect(initialBridge.prepare(staleBeforeCapture.input)).rejects.toThrow(
			/stale before Worker planning/i,
		);
		expect(workerCreations).toBe(0);

		const staleDuringHydration = bridgeFixture(composition);
		const hydrationWorker = new InlineRuntimeWorker((response) => response, false);
		const hydrationBridge = new StaticFabBayFlowEditBridge(() => hydrationWorker);
		const hydrating = hydrationBridge.prepare(staleDuringHydration.input);
		staleDuringHydration.setPatchSequence(staleDuringHydration.document.getPatchSequence() + 1);
		hydrationWorker.deliverNext();
		await expect(hydrating).rejects.toThrow(/source changed during Worker hydration/i);
		expect(hydrationWorker.requests).toHaveLength(1);
		expect(hydrationWorker.terminated).toBe(true);

		const staleBeforeAdoption = bridgeFixture(composition);
		const adoptionWorker = new InlineRuntimeWorker((response) => response, false);
		const adoptionBridge = new StaticFabBayFlowEditBridge(() => adoptionWorker);
		const preparing = adoptionBridge.prepare(staleBeforeAdoption.input);
		adoptionWorker.deliverNext();
		expect(adoptionWorker.requests).toHaveLength(2);
		staleBeforeAdoption.replaceOrganizationsIdentity();
		adoptionWorker.deliverNext();
		await expect(preparing).rejects.toThrow(/source changed before plan adoption/i);
		expect(adoptionWorker.terminated).toBe(true);
		expect(staleBeforeAdoption.document.getPatchSequence()).toBe(0);
	}, 120_000);

	it("surfaces an initial live-state reader failure without creating a Worker", async () => {
		const fixture = bridgeFixture(composition);
		let workerCreations = 0;
		const bridge = new StaticFabBayFlowEditBridge(() => {
			workerCreations++;
			return new InlineRuntimeWorker();
		});

		await expect(
			bridge.prepare({
				...fixture.input,
				getCurrentState: () => {
					throw new Error("initial live-state reader exploded");
				},
			}),
		).rejects.toThrow(/initial live-state reader exploded/i);
		expect(workerCreations).toBe(0);
	}, 120_000);

	it.each([
		["hydration", 2, 1],
		["adoption", 3, 2],
	] as const)(
		"fails immediately when the live-state reader throws during %s",
		async (phase, throwOnRead, deliveries) => {
			const fixture = bridgeFixture(composition);
			const worker = new InlineRuntimeWorker((response) => response, false);
			const bridge = new StaticFabBayFlowEditBridge(() => worker, 60_000);
			const readCurrentState = fixture.input.getCurrentState;
			let reads = 0;
			const preparing = bridge.prepare({
				...fixture.input,
				getCurrentState: () => {
					reads++;
					if (reads === throwOnRead) throw new Error(`${phase} live-state reader exploded`);
					return readCurrentState();
				},
			});

			for (let index = 0; index < deliveries; index++) worker.deliverNext();

			await expect(preparing).rejects.toThrow(
				new RegExp(`${phase} live-state reader exploded`, "i"),
			);
			expect(reads).toBe(throwOnRead);
			expect(worker.terminated).toBe(true);
			expect(worker.terminationCount).toBe(1);
			expect(worker.onmessage).toBeNull();
		},
		120_000,
	);

	it("cancels eagerly, terminates once, and ignores a queued late response", async () => {
		const fixture = bridgeFixture(composition);
		const worker = new InlineRuntimeWorker((response) => response, false);
		const bridge = new StaticFabBayFlowEditBridge(() => worker);
		const preparing = bridge.prepare(fixture.input);
		const lateHandler = requireValue(worker.onmessage, "installed Worker message handler");

		bridge.cancel();
		await expect(preparing).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
		expect(worker.terminationCount).toBe(1);
		expect(worker.onmessage).toBeNull();

		worker.deliverNext(lateHandler);
		await Promise.resolve();
		expect(worker.requests).toHaveLength(1);
		expect(fixture.document.getPatchSequence()).toBe(0);
		expect(worker.terminationCount).toBe(1);
	}, 120_000);

	it("times out a silent Worker and revokes the disposable request", async () => {
		vi.useFakeTimers();
		try {
			const fixture = bridgeFixture(composition);
			const worker = new InlineRuntimeWorker((response) => response, false);
			const bridge = new StaticFabBayFlowEditBridge(() => worker, 25);
			const preparing = bridge.prepare(fixture.input);
			const rejection = expect(preparing).rejects.toThrow(/timed out after 25 ms/i);

			await vi.advanceTimersByTimeAsync(25);
			await rejection;
			expect(worker.terminated).toBe(true);
			expect(worker.terminationCount).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	}, 120_000);
});

function bridgeFixture(composition: CertifiedOpenFabFabComposition): BridgeFixture {
	const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
	const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
	const bay = requireValue(
		document.organizations.records.find((record) => roles.get(record.id) === "BAY"),
		"runtime-recognized Twin Bay",
	);
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
	).snapshot;
	const intent: StaticFabBayFlowEditIntent = Object.freeze({
		version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
		bayOrganizationId: bay.id,
		targetInternalFlowPattern: "co-rotating",
	});
	let livePatchSequence = document.getPatchSequence();
	let liveOrganizations: StaticFabOrganizationState = document.organizations;
	return {
		document,
		bay,
		snapshot,
		input: {
			intent,
			snapshot,
			getCurrentState: () => ({
				map: document.map,
				patchSequence: livePatchSequence,
				portEquipment: document.portEquipment,
				organizations: liveOrganizations,
			}),
		},
		setPatchSequence(sequence: number): void {
			livePatchSequence = sequence;
		},
		replaceOrganizationsIdentity(): void {
			liveOrganizations = Object.freeze({
				nextOrganizationId: document.organizations.nextOrganizationId,
				records: document.organizations.records,
			});
		},
	};
}

function corruptPreparedProspectiveChecksum(response: StaticFabBayFlowEditWorkerResponse): unknown {
	if (response.type !== "STATIC_FAB_BAY_FLOW_EDIT_PREPARED" || !response.prepared.ticket) {
		return response;
	}
	return {
		...response,
		prepared: {
			...response.prepared,
			ticket: {
				...response.prepared.ticket,
				prospectiveChecksum: differentRailChecksum(
					response.prepared.ticket.prospectiveChecksum,
					response.prepared.ticket.sourceChecksum,
				),
			},
		},
	};
}

function corruptPreparedPlanFingerprint(response: StaticFabBayFlowEditWorkerResponse): unknown {
	if (response.type !== "STATIC_FAB_BAY_FLOW_EDIT_PREPARED" || !response.prepared.ticket) {
		return response;
	}
	return {
		...response,
		prepared: {
			...response.prepared,
			ticket: {
				...response.prepared.ticket,
				planFingerprint: "00000000:00000000",
			},
		},
	};
}

function addPreparedField(response: StaticFabBayFlowEditWorkerResponse): unknown {
	if (response.type !== "STATIC_FAB_BAY_FLOW_EDIT_PREPARED") return response;
	return { ...response, prepared: { ...response.prepared, unexpectedAuthority: true } };
}

function driftPreparedSourceEvidence(response: StaticFabBayFlowEditWorkerResponse): unknown {
	if (response.type !== "STATIC_FAB_BAY_FLOW_EDIT_PREPARED" || !response.prepared.sourceEvidence) {
		return response;
	}
	return {
		...response,
		prepared: {
			...response.prepared,
			sourceEvidence: {
				...response.prepared.sourceEvidence,
				authoredCellCount: response.prepared.sourceEvidence.authoredCellCount + 1,
			},
		},
	};
}

function differentRailChecksum(value: string, forbidden: string): string {
	const finalCharacter = value.at(-1);
	for (const replacement of "0123456789abcdef") {
		if (replacement === finalCharacter) continue;
		const candidate = `${value.slice(0, -1)}${replacement}`;
		if (candidate !== forbidden) return candidate;
	}
	throw new Error("Expected another syntactically valid rail checksum.");
}

function requireValue<T>(value: T | null | undefined, label: string): T {
	if (value === null || value === undefined) throw new Error(`Expected ${label}.`);
	return value;
}
