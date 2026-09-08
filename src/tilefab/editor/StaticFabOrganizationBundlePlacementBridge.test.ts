import { describe, expect, it, vi } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "../core/RailTemplateCatalog";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import {
	isCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor,
	isIssuedStaticFabOrganizationBundlePlacementPlan,
} from "../core/StaticFabOrganizationBundlePlacement";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import type {
	StaticFabOrganizationBundlePlacementWorkerRequest,
	StaticFabOrganizationBundlePlacementWorkerResponse,
} from "../worker/StaticFabOrganizationBundlePlacementProtocol";
import { STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION } from "../worker/StaticFabOrganizationBundlePlacementProtocol";
import { prepareStaticFabOrganizationBundlePlacement } from "../worker/StaticFabOrganizationBundlePlacementRuntime";
import { encodeStaticFabOrganizationBundlePlacementTransport } from "../worker/StaticFabOrganizationBundlePlacementTransport";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import {
	StaticFabOrganizationBundlePlacementBridge,
	type StaticFabOrganizationBundlePlacementInput,
	type StaticFabOrganizationBundlePlacementWorkerPort,
} from "./StaticFabOrganizationBundlePlacementBridge";

class RuntimeWorker implements StaticFabOrganizationBundlePlacementWorkerPort {
	onmessage:
		| ((event: MessageEvent<StaticFabOrganizationBundlePlacementWorkerResponse>) => void)
		| null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	receivedRequest: StaticFabOrganizationBundlePlacementWorkerRequest | null = null;
	transferredBuffers = 0;
	protected pendingRequest: StaticFabOrganizationBundlePlacementWorkerRequest | null = null;

	postMessage(
		message: StaticFabOrganizationBundlePlacementWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.transferredBuffers = transfer.length;
		this.pendingRequest = structuredClone(message, { transfer });
		this.receivedRequest = this.pendingRequest;
		queueMicrotask(() => this.respond());
	}

	terminate(): void {
		this.terminated = true;
	}

	protected transformResponse(
		response: StaticFabOrganizationBundlePlacementWorkerResponse,
	): StaticFabOrganizationBundlePlacementWorkerResponse {
		return response;
	}

	protected respond(): void {
		if (this.terminated || !this.pendingRequest) return;
		const request = this.pendingRequest;
		const response = this.transformResponse({
			type: "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED",
			version: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION,
			requestId: request.requestId,
			payload: encodeStaticFabOrganizationBundlePlacementTransport(
				prepareStaticFabOrganizationBundlePlacement(request),
			),
		});
		this.onmessage?.({
			data: structuredClone(response, { transfer: collectTransferableBuffers(response) }),
		} as MessageEvent<StaticFabOrganizationBundlePlacementWorkerResponse>);
	}
}

class ManualRuntimeWorker extends RuntimeWorker {
	protected override respond(): void {}

	deliver(): void {
		super.respond();
	}
}

class SilentWorker implements StaticFabOrganizationBundlePlacementWorkerPort {
	onmessage:
		| ((event: MessageEvent<StaticFabOrganizationBundlePlacementWorkerResponse>) => void)
		| null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(): void {}

	terminate(): void {
		this.terminated = true;
	}
}

class CorruptedTicketWorker extends RuntimeWorker {
	private readonly field:
		| "sourceChecksum"
		| "bundleFingerprint"
		| "planFingerprint"
		| "prospectiveChecksum";
	constructor(
		field: "sourceChecksum" | "bundleFingerprint" | "planFingerprint" | "prospectiveChecksum",
	) {
		super();
		this.field = field;
	}
	protected override transformResponse(
		response: StaticFabOrganizationBundlePlacementWorkerResponse,
	): StaticFabOrganizationBundlePlacementWorkerResponse {
		const copy = structuredClone(response);
		if (
			copy.type === "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED" &&
			copy.payload.prepared.ticket
		) {
			const ticket = copy.payload.prepared.ticket;
			Object.assign(ticket, { [this.field]: `${ticket[this.field]}-corrupted` });
		}
		return copy;
	}
}

class CorruptedPlanWorker extends RuntimeWorker {
	protected override transformResponse(
		response: StaticFabOrganizationBundlePlacementWorkerResponse,
	): StaticFabOrganizationBundlePlacementWorkerResponse {
		const copy = structuredClone(response);
		if (
			copy.type === "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED" &&
			copy.payload.kind === "additions"
		) {
			const bytes = copy.payload.additions.encoded;
			bytes[0] = bytes[0] === 0x21 ? 0x48 : 0x21;
		}
		return copy;
	}
}

type ResponseCorruption =
	| "conflict-cap"
	| "fractional-count"
	| "invalid-rail-byte"
	| "out-of-range-cell"
	| "out-of-range-mutation"
	| "oversized-membership"
	| "invalid-offset"
	| "unsupported-version";
class MalformedPreparedWorker extends RuntimeWorker {
	private readonly corruption: ResponseCorruption;
	constructor(corruption: ResponseCorruption) {
		super();
		this.corruption = corruption;
	}
	protected override transformResponse(
		response: StaticFabOrganizationBundlePlacementWorkerResponse,
	): StaticFabOrganizationBundlePlacementWorkerResponse {
		const copy = structuredClone(response);
		if (this.corruption === "unsupported-version") {
			Object.assign(copy, { version: 999 });
			return copy;
		}
		if (copy.type !== "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED") return copy;
		const payload = copy.payload;
		if (this.corruption === "conflict-cap")
			Object.assign(payload.prepared, {
				conflictCells: Array.from({ length: 513 }, (_, x) => ({ x, y: 0 })),
			});
		else if (this.corruption === "fractional-count")
			Object.assign(payload.prepared, { conflictCount: 0.5 });
		else if (payload.kind === "additions") {
			const additions = payload.additions;
			if (this.corruption === "invalid-rail-byte") additions.encoded[0] = 0xff;
			else if (
				this.corruption === "out-of-range-cell" ||
				this.corruption === "out-of-range-mutation"
			) {
				// One coordinate table replaces both former plain cell/mutation arrays. Reject unrepresentable columns.
				const key = this.corruption === "out-of-range-cell" ? "xs" : "ys";
				const coordinates = Float64Array.from(additions[key]);
				coordinates[0] = 0x8000_0000;
				Object.assign(additions, { [key]: coordinates });
			} else if (this.corruption === "oversized-membership")
				Object.assign(additions.organizations.records, {
					railEdgeCoordinates: new Int32Array(4 * 65_536 * 4 + 4),
				});
			else if (this.corruption === "invalid-offset")
				additions.organizations.records.railEdgeOffsets[1] = 0xffff_ffff;
		}
		return copy;
	}
}

describe("StaticFabOrganizationBundlePlacementBridge", () => {
	it("keeps cancellation live after transport termination through the final admission yield", async () => {
		const baselineGate = admissionGate(Infinity);
		const baseline = placementInput();
		const baselineBridge = new StaticFabOrganizationBundlePlacementBridge(
			() => new RuntimeWorker(),
			30_000,
			baselineGate.scheduler,
		);
		expect((await baselineBridge.prepare(baseline.input)).certified).toBe(true);
		const checkpoints = baselineGate.calls();
		expect(checkpoints).toBeGreaterThan(10);
		for (const stopAt of [1, Math.floor(checkpoints / 2), checkpoints]) {
			const gate = admissionGate(stopAt);
			const { document, input } = placementInput();
			const worker = new RuntimeWorker();
			const bridge = new StaticFabOrganizationBundlePlacementBridge(
				() => worker,
				30_000,
				gate.scheduler,
			);
			const outcome = bridge.prepare(input).then(
				() => null,
				(error) => error as Error,
			);
			await gate.reached;
			expect(worker.terminated).toBe(true);
			bridge.cancel();
			expect(await outcome).toMatchObject({ name: "AbortError" });
			gate.resume();
			await Promise.resolve();
			expect(document.getPatchSequence()).toBe(0);
			bridge.dispose();
		}
	});

	it("times out during admission after its Worker has already terminated", async () => {
		const gate = admissionGate(1);
		const { document, input } = placementInput();
		const worker = new RuntimeWorker();
		vi.useFakeTimers();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => worker, 20, gate.scheduler);
		try {
			const outcome = bridge.prepare(input).then(
				() => null,
				(error) => error as Error,
			);
			await gate.reached;
			expect(worker.terminated).toBe(true);
			await vi.advanceTimersByTimeAsync(20);
			expect(await outcome).toMatchObject({ message: expect.stringContaining("timed out") });
			expect(document.getPatchSequence()).toBe(0);
		} finally {
			bridge.dispose();
			gate.resume();
			vi.useRealTimers();
		}
	});

	it("an abandoned admission and its late callback cannot cancel or settle a new request", async () => {
		const gate = admissionGate(1);
		const first = placementInput(),
			second = placementInput();
		const oldWorker = new ManualRuntimeWorker(),
			newWorker = new RuntimeWorker();
		let workers = 0;
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() => (workers++ === 0 ? oldWorker : newWorker),
			30_000,
			gate.scheduler,
		);
		const oldOutcome = bridge.prepare(first.input).then(
			() => null,
			(error) => error as Error,
		);
		const lateCallback = oldWorker.onmessage;
		oldWorker.deliver();
		await gate.reached;
		const newOutcome = bridge.prepare(second.input);
		expect(await oldOutcome).toMatchObject({ name: "AbortError" });
		lateCallback?.({
			data: {
				version: 999,
				requestId: oldWorker.receivedRequest?.requestId,
				type: "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_ERROR",
				message: "late obsolete error",
			},
		} as unknown as MessageEvent<StaticFabOrganizationBundlePlacementWorkerResponse>);
		gate.resume();
		const prepared = await newOutcome;
		expect(prepared.certified).toBe(true);
		if (!prepared.plan) throw new Error("Expected current plan");
		expect(second.document.commitStaticFabOrganizationBundle(prepared.plan)).toBe(true);
		expect(first.document.getPatchSequence()).toBe(0);
		bridge.dispose();
	});

	it("rejects a document edit made while owned response capture is suspended", async () => {
		const gate = admissionGate(2);
		const { document, input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() => new RuntimeWorker(),
			30_000,
			gate.scheduler,
		);
		const outcome = bridge.prepare(input).then(
			() => null,
			(error) => error as Error,
		);
		await gate.reached;
		expect(
			document.commit(planRailConstruction(document.map, { x: -10, y: -10 }, { x: -8, y: -10 })),
		).toBe(true);
		const expectedSequence = document.getPatchSequence();
		gate.resume();
		expect(await outcome).toMatchObject({
			message: expect.stringContaining("source changed during admission"),
		});
		expect(document.getPatchSequence()).toBe(expectedSequence);
		bridge.dispose();
	});

	it("rejects an intervening mutation even when rollback restores revision and checksum", async () => {
		const gate = admissionGate(2);
		const { document, input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() => new RuntimeWorker(),
			30_000,
			gate.scheduler,
		);
		const outcome = bridge.prepare(input).then(
			() => null,
			(error) => error as Error,
		);
		await gate.reached;
		const map = document.map;
		const originalGeneration = map.getMutationGeneration();
		const checkpoint = map.createMutationCheckpoint();
		const edit = planRailConstruction(map, { x: -10, y: -10 }, { x: -8, y: -10 });
		expect(map.applyAtomicMutations(edit.mutations, edit.switchMutations ?? [])).toBe(true);
		map.rollbackAtomicMutations(edit.mutations, edit.switchMutations ?? [], checkpoint);
		expect(map.getRevision()).toBe(input.snapshot.revision);
		expect(map.getMutationGeneration()).toBeGreaterThan(originalGeneration);
		expect(
			captureRailMirrorSnapshot(
				map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot.checksum,
		).toBe(input.snapshot.checksum);
		gate.resume();
		expect(await outcome).toMatchObject({
			message: expect.stringContaining("source changed during admission"),
		});
		expect(document.getPatchSequence()).toBe(0);
		bridge.dispose();
	});

	it("rejects a mismatched response protocol version", async () => {
		const { input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() => new MalformedPreparedWorker("unsupported-version"),
		);
		await expect(bridge.prepare(input)).rejects.toThrow("response version");
	});
	it("adopts only the Worker-planned clone through its one-shot source permit", async () => {
		const { document, input } = placementInput();
		const worker = new RuntimeWorker();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => worker);

		const prepared = await bridge.prepare(input);

		expect(prepared.validation.valid, prepared.validation.reason).toBe(true);
		expect(prepared.certified).toBe(true);
		expect(prepared.plan).not.toBeNull();
		expect(worker.receivedRequest?.type).toBe("PREPARE_STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT");
		expect(worker.receivedRequest).not.toHaveProperty("plan");
		expect(worker.receivedRequest?.anchor).toEqual(input.anchor);
		expect(worker.transferredBuffers).toBeGreaterThan(0);
		expect(worker.terminated).toBe(true);
		if (!prepared.plan) throw new Error("Expected an adopted Worker plan.");
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(prepared.plan)).toBe(true);
		expect(
			isCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
				prepared.plan,
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(true);
		expect(
			document.commitStaticFabOrganizationBundle(prepared.plan),
			document.getLastCommandError() ?? "Worker plan commit failed",
		).toBe(true);
		expect(document.commitStaticFabOrganizationBundle(prepared.plan)).toBe(false);
	});

	it("cancels the superseded permit and resolves only the latest Worker plan", async () => {
		const first = placementInput();
		const second = placementInput();
		const firstWorker = new SilentWorker();
		const secondWorker = new RuntimeWorker();
		let workerIndex = 0;
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() =>
				[firstWorker, secondWorker][
					workerIndex++
				] as StaticFabOrganizationBundlePlacementWorkerPort,
		);

		const firstPlanning = bridge.prepare(first.input);
		const secondPlanning = bridge.prepare(second.input);

		await expect(firstPlanning).rejects.toMatchObject({ name: "AbortError" });
		await expect(secondPlanning).resolves.toMatchObject({ certified: true });
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it("times out and revokes a Worker permit that never answers", async () => {
		const { input } = placementInput();
		const worker = new SilentWorker();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => worker, 1);

		await expect(bridge.prepare(input)).rejects.toThrow("timed out");
		expect(worker.terminated).toBe(true);
	});

	it.each([
		"switch",
		"port",
		"equipment",
		"organization",
	] as const)("rejects a checksum-equivalent stale %s ID cursor before Worker creation", async (cursor) => {
		const { input } = placementInput();
		const snapshot =
			cursor === "switch"
				? { ...input.snapshot, nextAdvancedSwitchId: input.snapshot.nextAdvancedSwitchId + 1 }
				: cursor === "port"
					? {
							...input.snapshot,
							portEquipment: {
								...input.snapshot.portEquipment,
								nextPortId: input.snapshot.portEquipment.nextPortId + 1,
							},
						}
					: cursor === "equipment"
						? {
								...input.snapshot,
								portEquipment: {
									...input.snapshot.portEquipment,
									nextEquipmentGroupId: input.snapshot.portEquipment.nextEquipmentGroupId + 1,
								},
							}
						: {
								...input.snapshot,
								organizations: {
									...input.snapshot.organizations,
									nextOrganizationId: input.snapshot.organizations.nextOrganizationId + 1,
								},
							};
		let workerCreated = false;
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => {
			workerCreated = true;
			return new RuntimeWorker();
		});

		await expect(bridge.prepare({ ...input, snapshot })).rejects.toThrow("stale");
		expect(workerCreated).toBe(false);
	});

	it("rejects a checksum-equivalent snapshot captured from another authored document", async () => {
		const { input } = placementInput();
		const decoyDocument = new RailDocument();
		const decoySnapshot = captureRailMirrorSnapshot(
			decoyDocument.map,
			decoyDocument.getPatchSequence(),
			decoyDocument.portEquipment,
			decoyDocument.organizations,
		).snapshot;
		let workerCreated = false;
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => {
			workerCreated = true;
			return new RuntimeWorker();
		});

		await expect(bridge.prepare({ ...input, snapshot: decoySnapshot })).rejects.toThrow(
			"not captured from the current authored generations",
		);
		expect(workerCreated).toBe(false);
	});

	it("does not adopt a valid Worker plan after the live document becomes stale", async () => {
		const { document, input } = placementInput();
		const worker = new ManualRuntimeWorker();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => worker);
		const planning = bridge.prepare(input);
		const edit = planRailConstruction(document.map, { x: -10, y: -10 }, { x: -8, y: -10 });
		expect(document.commit(edit)).toBe(true);

		worker.deliver();
		await expect(planning).rejects.toThrow("source changed during admission");
		expect(document.getPatchSequence()).toBe(1);
	});

	it("does not adopt when a source identity is replaced with checksum-equivalent data", async () => {
		const { input } = placementInput();
		const sourceState = input.getCurrentState();
		let currentState = sourceState;
		const worker = new ManualRuntimeWorker();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => worker);
		const planning = bridge.prepare({ ...input, getCurrentState: () => currentState });
		currentState = {
			...sourceState,
			organizations: Object.freeze({
				nextOrganizationId: sourceState.organizations.nextOrganizationId,
				records: sourceState.organizations.records,
			}),
		};

		worker.deliver();
		await expect(planning).rejects.toThrow("source changed during admission");
	});

	it.each([
		"sourceChecksum",
		"bundleFingerprint",
	] as const)("rejects a corrupted %s ticket before adoption", async (field) => {
		const { input } = placementInput();
		const worker = new CorruptedTicketWorker(field);
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => worker);

		await expect(bridge.prepare(input)).rejects.toThrow("corrupted one-shot ticket");
		expect(worker.terminated).toBe(true);
	});

	it("fails closed when a plan fingerprint is changed after Worker issuance", async () => {
		const { document, input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() => new CorruptedTicketWorker("planFingerprint"),
		);
		await expect(bridge.prepare(input)).rejects.toThrow("fingerprint");
		expect(document.getPatchSequence()).toBe(0);
	});

	it("rejects a plan whose mutations diverge from its ticket fingerprint", async () => {
		const { input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => new CorruptedPlanWorker());

		await expect(bridge.prepare(input)).rejects.toThrow("fingerprint");
	});

	it("rejects a ticket whose prospective checksum is forged", async () => {
		const { input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() => new CorruptedTicketWorker("prospectiveChecksum"),
		);

		await expect(bridge.prepare(input)).rejects.toThrow("prospective checksum");
	});

	it.each([
		"conflict-cap",
		"fractional-count",
		"invalid-rail-byte",
		"out-of-range-cell",
		"out-of-range-mutation",
		"oversized-membership",
		"invalid-offset",
	] as const)("rejects malformed Worker planning data (%s)", async (corruption) => {
		const { input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() => new MalformedPreparedWorker(corruption),
		);

		await expect(bridge.prepare(input)).rejects.toThrow("malformed planning data");
	});
});

function admissionGate(stopAt: number) {
	let count = 0,
		time = 0;
	let announce: () => void = () => {},
		release: () => void = () => {};
	const reached = new Promise<void>((resolve) => {
		announce = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	return {
		reached,
		resume: () => release(),
		calls: () => count,
		scheduler: {
			now: () => {
				time += 5;
				return time;
			},
			yield: async () => {
				if (++count === stopAt) {
					announce();
					await blocked;
				}
			},
		},
	};
}

function placementInput(): {
	document: RailDocument;
	input: StaticFabOrganizationBundlePlacementInput;
} {
	const document = new RailDocument();
	return {
		document,
		input: {
			bundle: sourceBundle(),
			anchor: Object.freeze({ x: 40, y: -20 }),
			quarterTurns: 0,
			snapshot: captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot,
			getCurrentState: () => ({
				map: document.map,
				patchSequence: document.getPatchSequence(),
				portEquipment: document.portEquipment,
				organizations: document.organizations,
				relationships: document.relationships,
			}),
		},
	};
}

function sourceBundle(): StaticFabOrganizationBundle {
	const source = new RailDocument();
	const plan = planRailTemplate(
		source.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	if (!plan.valid || !source.commit(plan)) throw new Error(plan.reason);
	const modules = buildRailModuleOwnershipIndex(source.map).modules;
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: 2,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "BAY" as const,
				name: "Bridge Proof Bay",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "", color: "CYAN" as const }),
				membership: membershipFromModules(modules),
			}),
		]),
	});
	const capture = captureStaticFabOrganizationBundle(
		source.map,
		source.portEquipment,
		source.getPatchSequence(),
		organizations,
		source.relationships,
		[1],
		"DIRECT",
	);
	if (!capture.valid) throw new Error(capture.reason);
	return capture.bundle;
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([]),
	});
}
