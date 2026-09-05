import { describe, expect, it } from "vitest";
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
import { prepareStaticFabOrganizationBundlePlacement } from "../worker/StaticFabOrganizationBundlePlacementRuntime";
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
			requestId: request.requestId,
			prepared: prepareStaticFabOrganizationBundlePlacement(request),
		});
		this.onmessage?.({
			data: structuredClone(response),
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
		if (
			response.type !== "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED" ||
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
					[this.field]: `${response.prepared.ticket[this.field]}-corrupted`,
				},
			},
		};
	}
}

class CorruptedPlanWorker extends RuntimeWorker {
	protected override transformResponse(
		response: StaticFabOrganizationBundlePlacementWorkerResponse,
	): StaticFabOrganizationBundlePlacementWorkerResponse {
		if (
			response.type !== "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED" ||
			!response.prepared.plan
		) {
			return response;
		}
		const plan = structuredClone(response.prepared.plan);
		const mutation = plan.mutations[0];
		if (!mutation) throw new Error("Expected a Worker rail mutation.");
		mutation.after = mutation.after === 0x21 ? 0x48 : 0x21;
		return { ...response, prepared: { ...response.prepared, plan } };
	}
}

class MalformedPreparedWorker extends RuntimeWorker {
	private readonly corruption:
		| "conflict-cap"
		| "fractional-count"
		| "invalid-rail-byte"
		| "out-of-range-cell"
		| "out-of-range-mutation"
		| "oversized-membership";

	constructor(
		corruption:
			| "conflict-cap"
			| "fractional-count"
			| "invalid-rail-byte"
			| "out-of-range-cell"
			| "out-of-range-mutation"
			| "oversized-membership",
	) {
		super();
		this.corruption = corruption;
	}

	protected override transformResponse(
		response: StaticFabOrganizationBundlePlacementWorkerResponse,
	): StaticFabOrganizationBundlePlacementWorkerResponse {
		if (response.type !== "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED") {
			return response;
		}
		if (this.corruption === "conflict-cap") {
			return {
				...response,
				prepared: {
					...response.prepared,
					conflictCells: Array.from({ length: 513 }, (_, x) => ({ x, y: 0 })),
				},
			};
		}
		if (this.corruption === "fractional-count") {
			return {
				...response,
				prepared: { ...response.prepared, conflictCount: 0.5 },
			};
		}
		if (!response.prepared.plan) return response;
		const plan = structuredClone(response.prepared.plan);
		if (this.corruption === "invalid-rail-byte") {
			const firstMutation = plan.mutations[0];
			if (!firstMutation) throw new Error("Expected a Worker rail mutation.");
			return {
				...response,
				prepared: {
					...response.prepared,
					plan: {
						...plan,
						mutations: [{ ...firstMutation, after: 0xff }, ...plan.mutations.slice(1)],
					},
				},
			};
		}
		if (this.corruption === "out-of-range-mutation") {
			const firstMutation = plan.mutations[0];
			if (!firstMutation) throw new Error("Expected a Worker rail mutation.");
			return {
				...response,
				prepared: {
					...response.prepared,
					plan: {
						...plan,
						mutations: [{ ...firstMutation, x: 0x8000_0000 }, ...plan.mutations.slice(1)],
					},
				},
			};
		}
		if (this.corruption === "oversized-membership") {
			const firstOrganization = plan.organizationMutations[0];
			const firstEdge = firstOrganization?.after?.membership.railEdges[0];
			if (!firstOrganization?.after || !firstEdge) {
				throw new Error("Expected a Worker organization membership.");
			}
			return {
				...response,
				prepared: {
					...response.prepared,
					plan: {
						...plan,
						organizationMutations: [
							{
								...firstOrganization,
								after: {
									...firstOrganization.after,
									membership: {
										...firstOrganization.after.membership,
										railEdges: Array.from({ length: 20_001 }, () => firstEdge),
									},
								},
							},
							...plan.organizationMutations.slice(1),
						],
					},
				},
			};
		}
		const firstCell = plan.cells[0];
		if (!firstCell) throw new Error("Expected a Worker rail cell.");
		return {
			...response,
			prepared: {
				...response.prepared,
				plan: {
					...plan,
					cells: [{ ...firstCell, x: 0x8000_0000 }, ...plan.cells.slice(1)],
				},
			},
		};
	}
}

describe("StaticFabOrganizationBundlePlacementBridge", () => {
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
		const prepared = await planning;

		expect(prepared.validation.valid, prepared.validation.reason).toBe(true);
		expect(prepared.certified).toBe(false);
		if (!prepared.plan) throw new Error("Expected the rejected Worker plan.");
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(prepared.plan)).toBe(false);
		expect(document.commitStaticFabOrganizationBundle(prepared.plan)).toBe(false);
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
		const prepared = await planning;

		expect(prepared.validation.valid, prepared.validation.reason).toBe(true);
		expect(prepared.certified).toBe(false);
		if (!prepared.plan) throw new Error("Expected the rejected Worker plan.");
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(prepared.plan)).toBe(false);
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
		const prepared = await bridge.prepare(input);
		expect(prepared.validation.valid).toBe(true);
		expect(prepared.certified).toBe(false);
		if (!prepared.plan) throw new Error("Expected a rejected Worker plan.");
		expect(isIssuedStaticFabOrganizationBundlePlacementPlan(prepared.plan)).toBe(false);
		expect(document.commitStaticFabOrganizationBundle(prepared.plan)).toBe(false);
	});

	it("rejects a plan whose mutations diverge from its prospective checksum", async () => {
		const { input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(() => new CorruptedPlanWorker());

		await expect(bridge.prepare(input)).rejects.toThrow("prospective checksum");
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
	] as const)("rejects malformed Worker planning data (%s)", async (corruption) => {
		const { input } = placementInput();
		const bridge = new StaticFabOrganizationBundlePlacementBridge(
			() => new MalformedPreparedWorker(corruption),
		);

		await expect(bridge.prepare(input)).rejects.toThrow("malformed planning data");
	});
});

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
