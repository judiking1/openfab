import { beforeAll, describe, expect, it } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
} from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
} from "../core/StaticFabOrganization";
import {
	STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
	type StaticFabSemanticBayMutationAction,
	type StaticFabSemanticBayMutationIntent,
} from "../core/StaticFabSemanticBayMutation";
import { isIssuedStaticFabSemanticBayMutationPlan } from "../core/StaticFabSemanticBayMutationCertification";
import { captureRailMirrorSnapshot, type RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import {
	STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
	type StaticFabSemanticBayMutationWorkerRequest,
	type StaticFabSemanticBayMutationWorkerResponse,
} from "../worker/StaticFabSemanticBayMutationProtocol";
import {
	hydrateStaticFabSemanticBayMutationSession,
	prepareStaticFabSemanticBayMutationInSession,
	type StaticFabSemanticBayMutationRuntimeSession,
} from "../worker/StaticFabSemanticBayMutationRuntime";
import {
	StaticFabSemanticBayMutationBridge,
	type StaticFabSemanticBayMutationInput,
	type StaticFabSemanticBayMutationWorkerPort,
} from "./StaticFabSemanticBayMutationBridge";

type WorkerResponseTransform = (
	response: StaticFabSemanticBayMutationWorkerResponse,
	request: StaticFabSemanticBayMutationWorkerRequest,
) => unknown;

class InlineRuntimeWorker implements StaticFabSemanticBayMutationWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabSemanticBayMutationWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	readonly requests: StaticFabSemanticBayMutationWorkerRequest[] = [];
	readonly transferCounts: number[] = [];
	terminated = false;
	terminationCount = 0;
	private readonly queuedRequests: StaticFabSemanticBayMutationWorkerRequest[] = [];
	private readonly transform: WorkerResponseTransform;
	private readonly automatic: boolean;
	private session: StaticFabSemanticBayMutationRuntimeSession | null = null;

	constructor(transform: WorkerResponseTransform = (response) => response, automatic = true) {
		this.transform = transform;
		this.automatic = automatic;
	}

	postMessage(
		message: StaticFabSemanticBayMutationWorkerRequest,
		transfer: Transferable[] = [],
	): void {
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
		forcedHandler?: (event: MessageEvent<StaticFabSemanticBayMutationWorkerResponse>) => void,
	): void {
		const request = this.queuedRequests.shift();
		if (!request) throw new Error("Expected a queued semantic Bay Worker request.");
		this.dispatch(request, forcedHandler);
	}

	private dispatch(
		request: StaticFabSemanticBayMutationWorkerRequest,
		forcedHandler?: (event: MessageEvent<StaticFabSemanticBayMutationWorkerResponse>) => void,
	): void {
		if (this.terminated && !forcedHandler) return;
		const response = this.transform(this.responseFor(request), request);
		const handler = forcedHandler ?? this.onmessage;
		handler?.({
			data: structuredClone(response) as StaticFabSemanticBayMutationWorkerResponse,
		} as MessageEvent<StaticFabSemanticBayMutationWorkerResponse>);
	}

	private responseFor(
		request: StaticFabSemanticBayMutationWorkerRequest,
	): StaticFabSemanticBayMutationWorkerResponse {
		if (request.type === "HYDRATE_STATIC_FAB_SEMANTIC_BAY_MUTATION") {
			const startedAt = performance.now();
			const session = hydrateStaticFabSemanticBayMutationSession(request.snapshot);
			this.session = session;
			return {
				type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_HYDRATED",
				version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
				requestId: request.requestId,
				source: session.sourceIdentity,
				sourceEvidence: session.sourceEvidence,
				hydrationMilliseconds: Math.max(0, performance.now() - startedAt),
			};
		}
		if (!this.session) throw new Error("Expected the inline Worker to be hydrated first.");
		return {
			type: "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED",
			version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
			requestId: request.requestId,
			prepared: prepareStaticFabSemanticBayMutationInSession(request, this.session),
		};
	}
}

interface BridgeFixture {
	readonly document: ReturnType<typeof hydrateRailMirrorSnapshotDocument>;
	readonly bay: StaticFabOrganizationRecord;
	readonly snapshot: RailMirrorSnapshot;
	readonly input: StaticFabSemanticBayMutationInput;
	setPatchSequence(sequence: number): void;
}

describe("StaticFabSemanticBayMutationBridge", () => {
	let composition: CertifiedOpenFabFabComposition;

	beforeAll(() => {
		composition = composeOpenFabFab(defaultOpenFabFabProfile());
	}, 120_000);

	it("transfers only the hydrate snapshot, adopts one certified plan, commits it once, and terminates", async () => {
		const fixture = bridgeFixture(composition, "DELETE");
		const workers: InlineRuntimeWorker[] = [];
		const bridge = new StaticFabSemanticBayMutationBridge(() => {
			const worker = new InlineRuntimeWorker();
			workers.push(worker);
			return worker;
		});

		const result = await bridge.prepare(fixture.input);
		const worker = requireValue(workers[0], "semantic Bay Worker");
		const plan = requireValue(result.plan, "adopted semantic Bay plan");

		expect(result.certified).toBe(true);
		expect(isIssuedStaticFabSemanticBayMutationPlan(plan)).toBe(true);
		expect(result.validation.plan).not.toBe(plan);
		expect(isIssuedStaticFabSemanticBayMutationPlan(structuredClone(plan))).toBe(false);
		expect(worker.requests.map((request) => request.type)).toEqual([
			"HYDRATE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
			"PREPARE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
		]);
		expect(worker.transferCounts[0]).toBeGreaterThan(0);
		expect(worker.transferCounts[1]).toBe(0);
		expect("snapshot" in (worker.requests[1] as object)).toBe(false);
		expect(worker.terminated).toBe(true);
		expect(worker.terminationCount).toBe(1);

		await expect(bridge.prepare(fixture.input)).rejects.toThrow(/capture authority/i);
		expect(workers).toHaveLength(1);

		expect(fixture.document.commitStaticFabSemanticBayMutation(plan)).toBe(true);
		expect(fixture.document.commitStaticFabSemanticBayMutation(plan)).toBe(false);
		expect(isIssuedStaticFabSemanticBayMutationPlan(plan)).toBe(false);
	}, 120_000);

	it.each([
		[
			"hydrated source identity",
			(response: StaticFabSemanticBayMutationWorkerResponse) =>
				response.type === "STATIC_FAB_SEMANTIC_BAY_MUTATION_HYDRATED"
					? {
							...response,
							source: { ...response.source, checksum: `${response.source.checksum}-forged` },
						}
					: response,
			/source|hydration/i,
		],
		[
			"prospective checksum",
			(response: StaticFabSemanticBayMutationWorkerResponse) =>
				corruptPreparedTicket(response, "prospectiveChecksum"),
			/prospective checksum/i,
		],
		[
			"source checksum ticket",
			(response: StaticFabSemanticBayMutationWorkerResponse) =>
				corruptPreparedTicket(response, "sourceChecksum"),
			/corrupted one-shot ticket/i,
		],
		[
			"ticket id",
			(response: StaticFabSemanticBayMutationWorkerResponse) => {
				if (
					response.type !== "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED" ||
					!response.prepared.ticket
				) {
					return response;
				}
				return {
					...response,
					prepared: {
						...response.prepared,
						ticket: {
							...response.prepared.ticket,
							ticketId: response.prepared.ticket.ticketId + 1,
						},
					},
				};
			},
			/corrupted one-shot ticket/i,
		],
		[
			"plan fingerprint",
			(response: StaticFabSemanticBayMutationWorkerResponse) =>
				corruptPreparedTicket(response, "planFingerprint"),
			/fingerprint diverged/i,
		],
	] as const)(
		"rejects a forged %s and terminates its Worker",
		async (_label, transform, error) => {
			const fixture = bridgeFixture(composition, "DELETE");
			const worker = new InlineRuntimeWorker(transform);
			const bridge = new StaticFabSemanticBayMutationBridge(() => worker);

			await expect(bridge.prepare(fixture.input)).rejects.toThrow(error);
			expect(worker.terminated).toBe(true);
			expect(worker.terminationCount).toBe(1);
		},
		120_000,
	);

	it("rejects malformed prepared fields and source-evidence drift between protocol phases", async () => {
		for (const transform of [addPreparedField, driftPreparedSourceEvidence]) {
			const fixture = bridgeFixture(composition, "DISCONNECT");
			const worker = new InlineRuntimeWorker(transform);
			const bridge = new StaticFabSemanticBayMutationBridge(() => worker);

			await expect(bridge.prepare(fixture.input)).rejects.toThrow(/malformed|source evidence/i);
			expect(worker.terminated).toBe(true);
		}
	}, 120_000);

	it("rejects a live generation change before adoption and consumes the pending permit", async () => {
		const fixture = bridgeFixture(composition, "DELETE");
		const worker = new InlineRuntimeWorker((response) => response, false);
		const bridge = new StaticFabSemanticBayMutationBridge(() => worker);
		const preparing = bridge.prepare(fixture.input);

		expect(worker.requests).toHaveLength(1);
		worker.deliverNext();
		expect(worker.requests).toHaveLength(2);
		fixture.setPatchSequence(fixture.document.getPatchSequence() + 1);
		worker.deliverNext();

		await expect(preparing).rejects.toThrow(/source changed before plan adoption/i);
		expect(worker.terminated).toBe(true);
		expect(fixture.document.getPatchSequence()).toBe(0);
	}, 120_000);

	it("cancels eagerly, terminates once, and ignores a queued late Worker response", async () => {
		const fixture = bridgeFixture(composition, "DELETE");
		const worker = new InlineRuntimeWorker((response) => response, false);
		const bridge = new StaticFabSemanticBayMutationBridge(() => worker);
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
});

function bridgeFixture(
	composition: CertifiedOpenFabFabComposition,
	action: StaticFabSemanticBayMutationAction,
): BridgeFixture {
	const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
	const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
	const bay = requireValue(
		document.organizations.records.find((record) => roles.get(record.id) === "BAY"),
		"default runtime-recognized Bay",
	);
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	).snapshot;
	const intent: StaticFabSemanticBayMutationIntent = Object.freeze({
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
		action,
		bayOrganizationId: bay.id,
	});
	let livePatchSequence = document.getPatchSequence();
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
				organizations: document.organizations,
				relationships: document.relationships,
			}),
		},
		setPatchSequence(sequence: number): void {
			livePatchSequence = sequence;
		},
	};
}

function corruptPreparedTicket(
	response: StaticFabSemanticBayMutationWorkerResponse,
	field: "sourceChecksum" | "prospectiveChecksum" | "planFingerprint",
): unknown {
	if (response.type !== "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED" || !response.prepared.ticket) {
		return response;
	}
	return {
		...response,
		prepared: {
			...response.prepared,
			ticket: {
				...response.prepared.ticket,
				[field]: `${response.prepared.ticket[field]}-forged`,
			},
		},
	};
}

function addPreparedField(response: StaticFabSemanticBayMutationWorkerResponse): unknown {
	if (response.type !== "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED") return response;
	return { ...response, prepared: { ...response.prepared, unexpectedAuthority: true } };
}

function driftPreparedSourceEvidence(
	response: StaticFabSemanticBayMutationWorkerResponse,
): unknown {
	if (
		response.type !== "STATIC_FAB_SEMANTIC_BAY_MUTATION_PREPARED" ||
		!response.prepared.sourceEvidence
	) {
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

function requireValue<T>(value: T | null | undefined, label: string): T {
	if (value === null || value === undefined) throw new Error(`Expected ${label}.`);
	return value;
}
