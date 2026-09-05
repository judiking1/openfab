import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { STATIC_FAB_ARRANGEMENT_VERSION } from "../core/StaticFabArrangement";
import { isIssuedStaticFabArrangementPlan } from "../core/StaticFabArrangementCertification";
import {
	STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
	type StaticFabArrangementCommandIntent,
} from "../core/StaticFabArrangementCommand";
import { emptyStaticFabOrganizationState } from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import {
	STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
	type StaticFabArrangementWorkerRequest,
	type StaticFabArrangementWorkerResponse,
} from "../worker/StaticFabArrangementProtocol";
import {
	initializeStaticFabArrangementRuntimeSession,
	prepareStaticFabArrangementInSession,
	type StaticFabArrangementRuntimeSession,
} from "../worker/StaticFabArrangementRuntime";
import {
	StaticFabArrangementBridge,
	type StaticFabArrangementLiveState,
	type StaticFabArrangementWorkerPort,
} from "./StaticFabArrangementBridge";

type ResponseTransform = (
	response: StaticFabArrangementWorkerResponse,
	request: StaticFabArrangementWorkerRequest,
) => StaticFabArrangementWorkerResponse;

class InlineSessionWorker implements StaticFabArrangementWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabArrangementWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	readonly requests: StaticFabArrangementWorkerRequest[] = [];
	readonly transferCounts: number[] = [];
	protected readonly pendingRequests: StaticFabArrangementWorkerRequest[] = [];
	private readonly transform: ResponseTransform;
	private readonly automatic: boolean;
	private runtime: StaticFabArrangementRuntimeSession | null = null;
	private sessionId = 0;

	constructor(transform: ResponseTransform = (response) => response, automatic = true) {
		this.transform = transform;
		this.automatic = automatic;
	}

	postMessage(message: StaticFabArrangementWorkerRequest, transfer: Transferable[] = []): void {
		const request = structuredClone(message, { transfer });
		this.requests.push(request);
		this.transferCounts.push(transfer.length);
		this.pendingRequests.push(request);
		if (this.automatic) queueMicrotask(() => this.deliverNext());
	}

	terminate(): void {
		this.terminated = true;
	}

	deliverNext(): void {
		if (this.terminated) return;
		const request = this.pendingRequests.shift();
		if (!request) return;
		let response: StaticFabArrangementWorkerResponse;
		if (request.type === "INITIALIZE_STATIC_FAB_ARRANGEMENT_SESSION") {
			const initialized = initializeStaticFabArrangementRuntimeSession(request.snapshot);
			this.runtime = initialized.session;
			this.sessionId = request.sessionId;
			response = {
				type: "STATIC_FAB_ARRANGEMENT_SESSION_READY",
				version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
				sessionId: request.sessionId,
				requestId: request.requestId,
				source: initialized.source,
				hydrationMilliseconds: initialized.hydrationMilliseconds,
				compilationMilliseconds: initialized.compilationMilliseconds,
			};
		} else {
			if (!this.runtime || request.sessionId !== this.sessionId) {
				throw new Error("Inline arrangement Worker session is unavailable.");
			}
			const result = prepareStaticFabArrangementInSession(this.runtime, request);
			response = {
				type: "STATIC_FAB_ARRANGEMENT_PREPARED",
				version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
				sessionId: request.sessionId,
				requestId: request.requestId,
				sourcePlanIndex: result.sourcePlanIndex,
				prepared: result.prepared,
			};
		}
		this.onmessage?.({
			data: structuredClone(this.transform(response, request)),
		} as MessageEvent<StaticFabArrangementWorkerResponse>);
	}

	deliverNextAsError(message = "stale option failed"): void {
		if (this.terminated) return;
		const request = this.pendingRequests.shift();
		if (!request) return;
		let sourcePlanIndex: number | null = null;
		if (request.type === "PREPARE_STATIC_FAB_ARRANGEMENT") {
			if (!this.runtime || request.sessionId !== this.sessionId) {
				throw new Error("Inline arrangement Worker session is unavailable.");
			}
			sourcePlanIndex = prepareStaticFabArrangementInSession(this.runtime, request).sourcePlanIndex;
		}
		this.onmessage?.({
			data: {
				type: "STATIC_FAB_ARRANGEMENT_ERROR",
				version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
				sessionId: request.sessionId,
				requestId: request.requestId,
				sourcePlanIndex,
				message,
			},
		} as MessageEvent<StaticFabArrangementWorkerResponse>);
	}
}

class ManualSessionWorker extends InlineSessionWorker {
	constructor(transform: ResponseTransform = (response) => response) {
		super(transform, false);
	}
}

class ThrowingPostWorker extends InlineSessionWorker {
	override postMessage(): void {
		throw new Error("post exploded");
	}
}

class ThrowingOptionPostWorker extends InlineSessionWorker {
	override postMessage(
		message: StaticFabArrangementWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		if (message.type === "PREPARE_STATIC_FAB_ARRANGEMENT") throw new Error("option exploded");
		super.postMessage(message, transfer);
	}
}

describe("StaticFabArrangementBridge", () => {
	it("hydrates one Worker source and certifies repeated option intents without retransferring it", async () => {
		const fixture = arrangementFixture();
		const worker = new InlineSessionWorker();
		const bridge = new StaticFabArrangementBridge(() => worker);
		startSession(bridge, fixture);

		const first = await bridge.prepare({ intent: fixture.intent });
		const second = await bridge.prepare({ intent: withMode(fixture.intent, "ALIGN_MAX") });

		expect(first.certified).toBe(true);
		expect(second.certified).toBe(true);
		expect(first.sourcePlanIndex).toBe(1);
		expect(second.sourcePlanIndex).toBe(2);
		expect(first.sessionHydrationMilliseconds).toBeGreaterThanOrEqual(0);
		expect(first.sessionCompilationMilliseconds).toBeGreaterThanOrEqual(0);
		expect(worker.requests.map((request) => request.type)).toEqual([
			"INITIALIZE_STATIC_FAB_ARRANGEMENT_SESSION",
			"PREPARE_STATIC_FAB_ARRANGEMENT",
			"PREPARE_STATIC_FAB_ARRANGEMENT",
		]);
		expect(worker.transferCounts[0]).toBeGreaterThan(0);
		expect(worker.transferCounts.slice(1)).toEqual([0, 0]);
		expect(worker.terminated).toBe(false);

		expect(second.plan).not.toBeNull();
		if (!second.plan) throw new Error("Expected an adopted arrangement plan.");
		expect(isIssuedStaticFabArrangementPlan(second.plan)).toBe(true);
		expect(fixture.document.commitStaticFabArrangement(second.plan)).toBe(true);
		expect(fixture.document.commitStaticFabArrangement(second.plan)).toBe(false);
		bridge.dispose();
		expect(worker.terminated).toBe(true);
	});

	it("independently rejects a forged prospective checksum and disposes the session", async () => {
		const fixture = arrangementFixture();
		const worker = new InlineSessionWorker((response) => {
			if (response.type !== "STATIC_FAB_ARRANGEMENT_PREPARED" || !response.prepared.ticket) {
				return response;
			}
			const checksum = response.prepared.ticket.prospectiveChecksum;
			return {
				...response,
				prepared: {
					...response.prepared,
					ticket: {
						...response.prepared.ticket,
						prospectiveChecksum: `${checksum[0] === "0" ? "1" : "0"}${checksum.slice(1)}`,
					},
				},
			};
		});
		const bridge = new StaticFabArrangementBridge(() => worker);
		startSession(bridge, fixture);

		await expect(bridge.prepare({ intent: fixture.intent })).rejects.toThrow(
			"prospective checksum",
		);
		expect(worker.terminated).toBe(true);
	});

	it("rejects malformed prepared data before adoption", async () => {
		const fixture = arrangementFixture();
		const worker = new InlineSessionWorker((response) =>
			response.type === "STATIC_FAB_ARRANGEMENT_PREPARED"
				? {
						...response,
						prepared: { ...response.prepared, conflictCount: 0.5 },
					}
				: response,
		);
		const bridge = new StaticFabArrangementBridge(() => worker);
		startSession(bridge, fixture);

		await expect(bridge.prepare({ intent: fixture.intent })).rejects.toThrow("malformed data");
		expect(worker.terminated).toBe(true);
	});

	it("rejects a READY response whose source identity does not match the transferred snapshot", async () => {
		const fixture = arrangementFixture();
		const worker = new InlineSessionWorker((response) =>
			response.type === "STATIC_FAB_ARRANGEMENT_SESSION_READY"
				? {
						...response,
						source: { ...response.source, checksum: `forged:${response.source.checksum}` },
					}
				: response,
		);
		const bridge = new StaticFabArrangementBridge(() => worker);
		startSession(bridge, fixture);

		await expect(bridge.prepare({ intent: fixture.intent })).rejects.toThrow(
			"malformed session data",
		);
		expect(worker.terminated).toBe(true);
	});

	it("rejects a prepared response whose source plan index skips the session sequence", async () => {
		const fixture = arrangementFixture();
		const worker = new InlineSessionWorker((response) =>
			response.type === "STATIC_FAB_ARRANGEMENT_PREPARED"
				? { ...response, sourcePlanIndex: response.sourcePlanIndex + 1 }
				: response,
		);
		const bridge = new StaticFabArrangementBridge(() => worker);
		startSession(bridge, fixture);

		await expect(bridge.prepare({ intent: fixture.intent })).rejects.toThrow(
			"stale or foreign result",
		);
		expect(worker.terminated).toBe(true);
	});

	it.each([
		"generation",
		"object identity",
	] as const)("disposes the source-bound session after live %s drift", async (drift) => {
		const fixture = arrangementFixture();
		const worker = new ManualSessionWorker();
		const bridge = new StaticFabArrangementBridge(() => worker);
		let replacementState: StaticFabArrangementLiveState | null = null;
		const getCurrentState = (): StaticFabArrangementLiveState =>
			replacementState ?? liveState(fixture.document);
		startSession(bridge, fixture, getCurrentState);
		worker.deliverNext();
		const planning = bridge.prepare({ intent: fixture.intent });

		if (drift === "generation") {
			expect(fixture.document.clear()).toBe(true);
		} else {
			const current = liveState(fixture.document);
			replacementState = {
				...current,
				organizations: Object.freeze({
					nextOrganizationId: current.organizations.nextOrganizationId,
					records: current.organizations.records,
				}),
			};
		}

		worker.deliverNext();
		await expect(planning).rejects.toThrow("source changed");
		expect(worker.terminated).toBe(true);
	});

	it("coalesces queued options and keeps one Worker until only the latest response is adopted", async () => {
		const fixture = arrangementFixture();
		const worker = new ManualSessionWorker();
		const bridge = new StaticFabArrangementBridge(() => worker);
		startSession(bridge, fixture);
		worker.deliverNext();

		const first = bridge.prepare({ intent: fixture.intent });
		const firstRejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
		const second = bridge.prepare({ intent: withMode(fixture.intent, "ALIGN_MAX") });
		const secondRejection = expect(second).rejects.toMatchObject({ name: "AbortError" });
		const latest = bridge.prepare({ intent: withMode(fixture.intent, "ALIGN_CENTER") });
		await firstRejection;
		await secondRejection;
		expect(worker.terminated).toBe(false);
		expect(worker.requests).toHaveLength(2);

		worker.deliverNext();
		expect(worker.terminated).toBe(false);
		expect(worker.requests).toHaveLength(3);
		worker.deliverNext();
		const prepared = await latest;
		expect(prepared.certified).toBe(true);
		expect(prepared.sourcePlanIndex).toBe(2);
		expect(worker.terminated).toBe(false);
	});

	it("treats an error from a cancelled in-flight option as stale and runs the latest option", async () => {
		const fixture = arrangementFixture();
		const worker = new ManualSessionWorker();
		const bridge = new StaticFabArrangementBridge(() => worker);
		startSession(bridge, fixture);
		worker.deliverNext();

		const first = bridge.prepare({ intent: fixture.intent });
		const firstRejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
		const latest = bridge.prepare({ intent: withMode(fixture.intent, "ALIGN_MAX") });
		await firstRejection;

		worker.deliverNextAsError();
		expect(worker.terminated).toBe(false);
		expect(worker.requests).toHaveLength(3);
		worker.deliverNext();

		await expect(latest).resolves.toMatchObject({ certified: true, sourcePlanIndex: 2 });
		expect(worker.terminated).toBe(false);
	});

	it("terminates a session when initialization or option posting fails", async () => {
		const fixture = arrangementFixture();
		const initializationWorker = new ThrowingPostWorker();
		const initializationBridge = new StaticFabArrangementBridge(() => initializationWorker);
		expect(() => startSession(initializationBridge, fixture)).toThrow("post exploded");
		expect(initializationWorker.terminated).toBe(true);

		const optionFixture = arrangementFixture();
		const optionWorker = new ThrowingOptionPostWorker();
		const optionBridge = new StaticFabArrangementBridge(() => optionWorker);
		startSession(optionBridge, optionFixture);
		await expect(optionBridge.prepare({ intent: optionFixture.intent })).rejects.toThrow(
			"option exploded",
		);
		expect(optionWorker.terminated).toBe(true);
	});

	it("times out initialization and rejects the queued option", async () => {
		const fixture = arrangementFixture();
		const worker = new ManualSessionWorker();
		const bridge = new StaticFabArrangementBridge(() => worker, 5);
		startSession(bridge, fixture);

		await expect(bridge.prepare({ intent: fixture.intent })).rejects.toThrow(
			"initialization timed out",
		);
		expect(worker.terminated).toBe(true);
	});

	it("times out one posted option and disposes its reusable source session", async () => {
		const fixture = arrangementFixture();
		const worker = new ManualSessionWorker();
		const bridge = new StaticFabArrangementBridge(() => worker, 5);
		startSession(bridge, fixture);
		worker.deliverNext();

		await expect(bridge.prepare({ intent: fixture.intent })).rejects.toThrow("option timed out");
		expect(worker.terminated).toBe(true);
	});

	it("disposes cleanly while initialization is pending", async () => {
		const fixture = arrangementFixture();
		const worker = new ManualSessionWorker();
		const bridge = new StaticFabArrangementBridge(() => worker);
		startSession(bridge, fixture);
		const planning = bridge.prepare({ intent: fixture.intent });

		bridge.dispose();

		await expect(planning).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminated).toBe(true);
		worker.deliverNext();
	});
});

interface ArrangementFixture {
	readonly document: RailDocument;
	readonly intent: StaticFabArrangementCommandIntent;
}

function arrangementFixture(): ArrangementFixture {
	const map = new TileMap();
	const first = planRailConstruction(new TileMap(), { x: 0, y: 0 }, { x: 8, y: 0 });
	const second = planRailConstruction(new TileMap(), { x: 20, y: 10 }, { x: 28, y: 10 });
	if (!first.valid || !second.valid) throw new Error("Failed to build arrangement fixture.");
	map.applyAtomicMutations([...first.mutations, ...second.mutations], []);
	const document = RailDocument.fromLoadedMap(
		map,
		0,
		emptyPortEquipmentState(),
		emptyStaticFabOrganizationState(),
	);
	const modules = buildRailModuleOwnershipIndex(document.map).modules;
	const components = [
		modules.filter((module) => moduleAtZ(module, 0)),
		modules.filter((module) => moduleAtZ(module, 10)),
	];
	return { document, intent: arrangementIntent(components) };
}

function arrangementIntent(
	components: readonly (readonly RailModuleOwnership[])[],
): StaticFabArrangementCommandIntent {
	return Object.freeze({
		version: STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
		arrangementVersion: STATIC_FAB_ARRANGEMENT_VERSION,
		axis: "Z",
		mode: "ALIGN_MIN",
		roots: Object.freeze(
			components.map((component) =>
				Object.freeze({
					kind: "STATIC_COMPONENT" as const,
					moduleKeys: Object.freeze(component.map((module) => module.key).sort()),
				}),
			),
		),
	});
}

function withMode(
	intent: StaticFabArrangementCommandIntent,
	mode: StaticFabArrangementCommandIntent["mode"],
): StaticFabArrangementCommandIntent {
	return Object.freeze({ ...intent, mode });
}

function moduleAtZ(module: RailModuleOwnership, z: number): boolean {
	return module.footprintCells.some((cell) => cell.y === z);
}

function startSession(
	bridge: StaticFabArrangementBridge,
	fixture: ArrangementFixture,
	getCurrentState: () => StaticFabArrangementLiveState = () => liveState(fixture.document),
): void {
	const current = getCurrentState();
	bridge.startSession({
		snapshot: captureRailMirrorSnapshot(
			current.map,
			current.patchSequence,
			current.portEquipment,
			current.organizations,
			current.relationships,
		).snapshot,
		getCurrentState,
	});
}

function liveState(document: RailDocument): StaticFabArrangementLiveState {
	return {
		map: document.map,
		patchSequence: document.getPatchSequence(),
		portEquipment: document.portEquipment,
		organizations: document.organizations,
		relationships: document.relationships,
	};
}
