import { isValidElement, type KeyboardEvent, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { checksumOperationalConfigurationState } from "../core/OperationalConfiguration";
import { planRailConstruction, planRailErase } from "../core/paint";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { recognizeRailPattern } from "../core/RailPatternRecognition";
import { planRailPatternResize } from "../core/RailPatternResizePlanner";
import { setRailTemplateParameter } from "../core/RailTemplateCatalog";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { TileMap } from "../core/TileMap";
import {
	captureRailMirrorSnapshot,
	checksumRailPatchResultCooperatively,
} from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import {
	INITIAL_RAIL_WORKER_STATE,
	type RailWorkerBridgeHandle,
	type RailWorkerBridgeState,
} from "../worker/RailWorkerBridge";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import type {
	StaticFabProcessLoopTopologyWorkerRequest,
	StaticFabProcessLoopTopologyWorkerResponse,
} from "../worker/StaticFabProcessLoopTopologyProtocol";
import { checkStaticFabProcessLoopTopologyInWorker } from "../worker/StaticFabProcessLoopTopologyRuntime";
import {
	StandaloneProcessLoopAuthoringController,
	type StandaloneProcessLoopAuthoringResult,
	type StandaloneProcessLoopAuthoringSource,
} from "./StandaloneProcessLoopAuthoringController";
import { StandaloneProcessLoopRegistrationForm } from "./StandaloneProcessLoopAuthoringPanel";
import {
	StaticFabProcessLoopTopologyBridge,
	type StaticFabProcessLoopTopologyWorkerPort,
} from "./StaticFabProcessLoopTopologyBridge";

describe("standalone Loop editor command lifetime", () => {
	it.each([
		{ isComposing: true, keyCode: 13 },
		{ isComposing: false, keyCode: 229 },
	])("keeps IME confirmation separate from Loop registration: %j", (nativeEvent) => {
		const onRegister = vi.fn();
		const form = StandaloneProcessLoopRegistrationForm({
			name: "공정 루프",
			busy: false,
			selectionAvailable: true,
			onNameChange: vi.fn(),
			onRegister,
		});
		const inputs: ReactElement<{ onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void }>[] =
			[];
		const visit = (node: unknown): void => {
			if (Array.isArray(node)) node.forEach(visit);
			else if (isValidElement<{ children?: unknown }>(node)) {
				if (node.type === "input") inputs.push(node as (typeof inputs)[number]);
				else visit(node.props.children);
			}
		};
		visit(form);
		expect(inputs).toHaveLength(1);
		const preventDefault = vi.fn();
		const event = {
			key: "Enter",
			nativeEvent,
			preventDefault,
		} as unknown as KeyboardEvent<HTMLInputElement>;
		inputs[0].props.onKeyDown(event);
		expect(onRegister).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
		inputs[0].props.onKeyDown({
			...event,
			nativeEvent: { isComposing: false, keyCode: 13 },
		} as KeyboardEvent<HTMLInputElement>);
		expect(onRegister).toHaveBeenCalledOnce();
		expect(preventDefault).toHaveBeenCalledOnce();
	});

	it("registers, opens, replays and closes the same synthetic owner through typed mirror events", async () => {
		const f = fixture();
		try {
			const registration = await f.controller.register("User Loop", () => true);
			expect(registration.commit.committed).toBe(true);
			expect(registration.organizationId).toBe(1);
			f.refresh();
			const before = f.document.organizations.records[0];
			expect(before).toMatchObject({
				id: 1,
				declaredSemanticRole: "PROCESS_LOOP",
				parentOrganizationIds: [],
			});
			const repair = await f.repair();
			expect(repair.commit.committed).toBe(true);
			f.refresh();
			expect(f.document.map.getEncoded(18, 20)).toBe(0);
			expect(f.document.organizations.records[0]?.id).toBe(1);
			expect((await f.controller.replay("undo", () => true)).commit.committed).toBe(true);
			f.refresh();
			expect(f.document.organizations.records[0]).toEqual(before);
			expect((await f.controller.replay("redo", () => true)).commit.committed).toBe(true);
			f.refresh();
			expect(f.events).toHaveLength(4);
			expect(f.mirror.state.sequence).toBe(f.document.getPatchSequence());
			expect(f.controller.busy).toBe(false);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		false,
		true,
	])("resizes a registered Loop atomically or rejects a changed draft intent (%s)", async (changeIntent) => {
		const f = fixture(15, 10);
		try {
			expect((await f.controller.register("Resize Loop", () => true)).commit.committed).toBe(true);
			f.refresh();
			const selection = createRailAreaSelectionFromOwnerships(
				f.source.ownership,
				f.source.ownership.modules,
			);
			const candidate = recognizeRailPattern(selection).candidates.find(
				(value) => value.templateId === "long-bay",
			);
			if (!candidate) throw new Error("Expected a recognized synthetic Loop.");
			const plan = planRailPatternResize(
				f.document.map,
				f.document.portEquipment,
				selection,
				candidate,
				setRailTemplateParameter(
					candidate.templateId,
					candidate.parameters,
					"aisleLengthMeters",
					16,
				),
			);
			expect(plan.valid, plan.reason).toBe(true);
			expect(plan.patternResize).toMatchObject({ beforeEdgeCount: 50, afterEdgeCount: 52 });
			const beforeOwner = f.document.organizations.records[0];
			const beforeMap = f.document.map;
			const equipment = f.document.portEquipment;
			const relationships = f.document.relationships;
			const beforeMirror = f.mirror.state;
			let intentCurrent = true;
			if (changeIntent)
				f.setCheckpointHook(() => {
					intentCurrent = false;
				});
			const repair = f.controller.repair(1, plan.mutations, [], () => intentCurrent);
			if (changeIntent) {
				await expect(repair).rejects.toThrow();
				expect(f.document.map).toBe(beforeMap);
				expect(f.document.organizations.records[0]).toBe(beforeOwner);
				expect(f.mirror.state).toEqual(beforeMirror);
				expect(f.events).toHaveLength(1);
				return;
			}
			expect((await repair).commit.committed).toBe(true);
			f.refresh();
			const resizedOwner = f.document.organizations.records[0];
			expect(resizedOwner).toEqual({
				...beforeOwner,
				membership: { ...beforeOwner?.membership, railEdges: resizedOwner?.membership.railEdges },
			});
			expect(resizedOwner?.membership.railEdges).toHaveLength(52);
			expect(f.document.portEquipment).toBe(equipment);
			expect(f.document.relationships).toBe(relationships);
			expect(f.events).toHaveLength(2);
			expect(f.mirror.state.edges).toBe(52);
			expect(f.mirror.organizationState).toEqual(f.document.organizations);
			const resizedChecksum = f.mirror.state.checksum;
			expect((await f.controller.replay("undo", () => true)).commit.committed).toBe(true);
			f.refresh();
			expect(f.document.organizations.records[0]).toEqual(beforeOwner);
			expect(f.mirror.state.checksum).toBe(beforeMirror.checksum);
			expect(f.mirror.state.edges).toBe(50);
			expect((await f.controller.replay("redo", () => true)).commit.committed).toBe(true);
			f.refresh();
			expect(f.document.organizations.records[0]).toEqual(resizedOwner);
			expect(f.mirror.state.checksum).toBe(resizedChecksum);
			expect(f.mirror.state.edges).toBe(52);
			expect(f.mirror.organizationState).toEqual(f.document.organizations);
			expect(f.mirror.state.sequence).toBe(f.document.getPatchSequence());
			expect(f.events).toHaveLength(4);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"registration",
		"repair",
	] as const)("yields before a fast %s replay and rejects cancelled or replaced preparation", async (kind) => {
		for (const action of ["cancel", "dispose", "replace"] as const) {
			const f = fixture(30, 20, () => 0);
			try {
				expect((await f.controller.register("User Loop", () => true)).commit.committed).toBe(true);
				f.refresh();
				if (kind === "repair") {
					expect((await f.repair()).commit.committed).toBe(true);
					f.refresh();
				}
				const sequence = f.document.getPatchSequence();
				const source = f.document.map;
				const organizations = f.document.organizations;
				const events = f.events.length;
				const replacement: { promise: Promise<StandaloneProcessLoopAuthoringResult> | null } = {
					promise: null,
				};
				let checkpoints = 0;
				f.setCheckpointHook(() => {
					checkpoints++;
					f.setCheckpointHook(() => undefined);
					expect(f.controller.busy).toBe(true);
					expect(f.document.map).toBe(source);
					expect(f.document.organizations).toBe(organizations);
					expect(f.document.getPatchSequence()).toBe(sequence);
					expect(f.events).toHaveLength(events);
					if (action === "dispose") f.controller.dispose();
					else f.controller.cancel();
					if (action === "replace") replacement.promise = f.controller.replay("undo", () => true);
				});
				await expect(f.controller.replay("undo", () => true)).rejects.toThrow();
				expect(checkpoints).toBe(1);
				if (replacement.promise) {
					expect((await replacement.promise).commit.committed).toBe(true);
					expect(f.document.getPatchSequence()).toBe(sequence + 1);
					expect(f.events).toHaveLength(events + 1);
				} else {
					expect(f.document.map).toBe(source);
					expect(f.document.organizations).toBe(organizations);
					expect(f.document.getPatchSequence()).toBe(sequence);
					expect(f.events).toHaveLength(events);
					expect(
						kind === "repair"
							? f.document.canReplayStaticFabProcessLoopRepair("undo")
							: f.document.canReplayStaticFabProcessLoopRegistration("undo"),
					).toBe(true);
				}
			} finally {
				f.controller.dispose();
			}
		}
	});

	it.each([
		"registration",
		"repair",
	] as const)("refuses cancel, dispose and replacement during the final %s replay lease", async (kind) => {
		for (const action of ["cancel", "dispose", "replace"] as const) {
			const f = fixture();
			try {
				expect((await f.controller.register("User Loop", () => true)).commit.committed).toBe(true);
				f.refresh();
				if (kind === "repair") {
					expect((await f.repair()).commit.committed).toBe(true);
					f.refresh();
				}
				const sequence = f.document.getPatchSequence();
				const sourceMap = f.document.map;
				const sourceOrganizations = f.document.organizations;
				const events = f.events.length;
				const replacement: { promise: Promise<StandaloneProcessLoopAuthoringResult> | null } = {
					promise: null,
				};
				f.setFinalLeaseHook(() => {
					if (action === "dispose") f.controller.dispose();
					else f.controller.cancel();
					if (action === "replace") replacement.promise = f.controller.replay("undo", () => true);
				});
				const cancelled = await f.controller.replay("undo", () => true);
				expect(cancelled.commit.committed).toBe(false);
				if (replacement.promise) {
					expect((await replacement.promise).commit.committed).toBe(true);
					expect(f.document.getPatchSequence()).toBe(sequence + 1);
					expect(f.events).toHaveLength(events + 1);
				} else {
					expect(f.document.map).toBe(sourceMap);
					expect(f.document.organizations).toBe(sourceOrganizations);
					expect(f.document.getPatchSequence()).toBe(sequence);
					expect(f.events).toHaveLength(events);
					expect(
						kind === "repair"
							? f.document.canReplayStaticFabProcessLoopRepair("undo")
							: f.document.canReplayStaticFabProcessLoopRegistration("undo"),
					).toBe(true);
				}
			} finally {
				f.controller.dispose();
			}
		}
	});

	it("preserves committed truth when a downstream observer fails", async () => {
		const f = fixture();
		try {
			f.document.subscribe(() => {
				throw new Error("observer failed");
			});
			const result = await f.controller.register("User Loop", () => true);
			expect(result.commit).toMatchObject({ committed: true, publicationError: "observer failed" });
			expect(f.document.organizations.records[0]?.id).toBe(1);
			expect(f.controller.busy).toBe(false);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"cancel",
		"dispose",
		"replace",
	] as const)("refuses %s during the second mutable capture batch", async (action) => {
		const f = fixture(300, 200);
		try {
			expect((await f.controller.register("User Loop", () => true)).commit.committed).toBe(true);
			f.refresh();
			const plan = planRailErase(
				f.document.map,
				Array.from({ length: 270 }, (_, index) => ({ x: index + 10, y: 0 })),
			);
			expect(plan.valid).toBe(true);
			expect(plan.mutations.length).toBeGreaterThan(256);
			const sourceMap = f.document.map;
			const sourceOwner = f.document.organizations;
			const sequence = f.document.getPatchSequence();
			const events = f.events.length;
			let checkpoints = 0;
			const replacement: { promise: Promise<StandaloneProcessLoopAuthoringResult> | null } = {
				promise: null,
			};
			f.setCheckpointHook(() => {
				if (++checkpoints !== 2) return;
				if (action === "dispose") f.controller.dispose();
				else f.controller.cancel();
				expect(f.document.map).toBe(sourceMap);
				expect(f.document.organizations).toBe(sourceOwner);
				expect(f.document.getPatchSequence()).toBe(sequence);
				expect(f.events).toHaveLength(events);
				if (action === "replace") {
					const fresh = planRailErase(f.document.map, [{ x: 18, y: 200 }]);
					expect(fresh.valid).toBe(true);
					replacement.promise = f.controller.repair(
						1,
						fresh.mutations,
						fresh.switchMutations,
						() => true,
					);
				}
			});
			await expect(
				f.controller.repair(1, plan.mutations, plan.switchMutations, () => true),
			).rejects.toThrow(/변경|취소/);
			if (replacement.promise) {
				expect((await replacement.promise).commit.committed).toBe(true);
				expect(f.events).toHaveLength(events + 1);
				expect(f.document.getPatchSequence()).toBe(sequence + 1);
				expect(f.document.map.getEncoded(18, 200)).toBe(0);
			} else {
				expect(f.document.map).toBe(sourceMap);
				expect(f.document.organizations).toBe(sourceOwner);
				expect(f.events).toHaveLength(events);
				expect(f.document.getPatchSequence()).toBe(sequence);
			}
			expect(f.controller.busy).toBe(false);
		} finally {
			f.controller.dispose();
		}
	});

	it("isolates captured scalar intent while leaving the caller's completed mutable draft editable", async () => {
		const f = fixture(300, 200);
		try {
			expect((await f.controller.register("User Loop", () => true)).commit.committed).toBe(true);
			f.refresh();
			const plan = planRailErase(
				f.document.map,
				Array.from({ length: 270 }, (_, index) => ({ x: index + 10, y: 0 })),
			);
			expect(plan.valid).toBe(true);
			expect(plan.mutations.length).toBeGreaterThan(256);
			expect(plan.mutations.length).toBeLessThanOrEqual(384);
			const mutations = [...plan.mutations];
			const expected = mutations.map((entry) => ({ ...entry }));
			const first = mutations[0];
			if (!first) throw new Error("missing ordinary draft mutation");
			let checkpoints = 0;
			f.setCheckpointHook(() => {
				if (++checkpoints !== 4) return;
				expect(Object.isFrozen(mutations)).toBe(false);
				expect(Object.isFrozen(first)).toBe(false);
				first.after = first.before;
				mutations.push({ ...first });
			});
			expect(
				(await f.controller.repair(1, mutations, plan.switchMutations, () => true)).commit
					.committed,
			).toBe(true);
			for (const entry of expected)
				expect(f.document.map.getEncoded(entry.x, entry.y)).toBe(entry.after);
			expect(first.after).toBe(first.before);
			expect(mutations).toHaveLength(expected.length + 1);
			expect(f.events).toHaveLength(2);
			expect(f.mirror.state.sequence).toBe(f.document.getPatchSequence());
		} finally {
			f.controller.dispose();
		}
	});

	it("cancels an in-flight candidate and permits a fresh registration without an old completion clearing it", async () => {
		const f = fixture();
		try {
			const abandoned = f.controller.register("Abandoned", () => true);
			const rejected = expect(abandoned).rejects.toThrow(/변경|취소/);
			f.controller.cancel();
			const replacement = f.controller.register("Replacement", () => true);
			await rejected;
			expect((await replacement).commit.committed).toBe(true);
			expect(f.document.organizations.records).toHaveLength(1);
			expect(f.document.organizations.records[0]?.name).toBe("Replacement");
			expect(f.events).toHaveLength(1);
			expect(f.controller.busy).toBe(false);
		} finally {
			f.controller.dispose();
		}
	});

	it("refuses changed name intent and permits a fresh request without touching the old selection", async () => {
		const f = fixture();
		try {
			const selection = f.source.selection;
			await expect(f.controller.register("User Loop", () => false)).rejects.toThrow(/변경/);
			expect(f.source.selection).toBe(selection);
			expect(f.document.organizations.records).toHaveLength(0);
			expect((await f.controller.register("Replacement", () => true)).commit.committed).toBe(true);
		} finally {
			f.controller.dispose();
		}
	});
});

class InlineTopology implements StaticFabProcessLoopTopologyWorkerPort {
	onmessage: ((event: MessageEvent<StaticFabProcessLoopTopologyWorkerResponse>) => void) | null =
		null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	postMessage(request: StaticFabProcessLoopTopologyWorkerRequest, transfer: Transferable[]): void {
		const owned = structuredClone(request, { transfer });
		queueMicrotask(() =>
			this.onmessage?.({
				data: structuredClone(checkStaticFabProcessLoopTopologyInWorker(owned)),
			} as MessageEvent<StaticFabProcessLoopTopologyWorkerResponse>),
		);
	}
	terminate(): void {
		this.onmessage = null;
	}
}

function fixture(width = 30, height = 20, now?: () => number) {
	const map = new TileMap();
	const corners = [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
		{ x: 0, y: 0 },
	];
	for (let i = 0; i < 4; i++) {
		const from = corners[i],
			to = corners[i + 1];
		if (!from || !to) throw new Error("missing synthetic corner");
		const plan = planRailConstruction(map, from, to);
		if (!plan.valid) throw new Error(plan.reason);
		map.applyAtomicMutations(plan.mutations, []);
	}
	const document = RailDocument.fromLoadedMap(map, 0);
	const mirror = new RailPatchMirror();
	mirror.sync(
		captureRailMirrorSnapshot(
			document.map,
			0,
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot,
	);
	const events: RailPatchEvent[] = [];
	document.subscribe((event) => {
		const encoded = encodeRailPatchEvent(event);
		const owned = structuredClone(encoded.patch, { transfer: encoded.transfer });
		mirror.applyPatch(decodeRailPatchSoA(owned, mirror.organizationState));
		events.push(event);
	});
	let finalLeaseHook: (() => void) | null = null;
	const state = (): RailWorkerBridgeState => {
		const info = mirror.state;
		const operationFingerprint = checksumOperationalConfigurationState(
			document.operationalConfiguration,
		);
		return {
			...INITIAL_RAIL_WORKER_STATE,
			status: "ready",
			epoch: 1,
			simulationReady: false,
			targetChecksum: info.checksum,
			checksum: info.checksum,
			targetRevision: info.revision,
			revision: info.revision,
			targetSequence: info.sequence,
			sequence: info.sequence,
			targetCells: info.cells,
			cells: info.cells,
			targetEdges: info.edges,
			edges: info.edges,
			targetSwitches: info.switches,
			switches: info.switches,
			targetPorts: document.portEquipment.ports.length,
			ports: document.portEquipment.ports.length,
			targetEquipmentGroups: document.portEquipment.equipmentGroups.length,
			equipmentGroups: document.portEquipment.equipmentGroups.length,
			targetOrganizations: mirror.organizationState.records.length,
			organizations: mirror.organizationState.records.length,
			targetAssemblyRelationships: mirror.relationshipState.records.length,
			assemblyRelationships: mirror.relationshipState.records.length,
			targetAssemblyRelationshipNextId: mirror.relationshipState.nextRelationshipId,
			assemblyRelationshipNextId: mirror.relationshipState.nextRelationshipId,
			targetOperationalConfigurationRevision: document.operationalConfiguration.revision,
			operationalConfigurationRevision: document.operationalConfiguration.revision,
			targetOperationalConfigurationFingerprint: operationFingerprint,
			operationalConfigurationFingerprint: operationFingerprint,
		};
	};
	const prepare = async (
		event: RailPatchEvent,
		expected: string,
		checkpoint: () => Promise<void>,
	) => {
		expect(
			await checksumRailPatchResultCooperatively(mirror.state.checksum, event, checkpoint),
		).toBe(expected);
		return {
			isCurrent: () => {
				const hook = finalLeaseHook;
				finalLeaseHook = null;
				hook?.();
				return true;
			},
		};
	};
	const bridge = {
		getState: state,
		prepareProcessLoopRegistrationPatchCooperatively: prepare,
		prepareProcessLoopRepairPatchCooperatively: prepare,
	} as unknown as RailWorkerBridgeHandle;
	let ownership = buildRailModuleOwnershipIndex(document.map);
	let source: StandaloneProcessLoopAuthoringSource = {
		document,
		modelGeneration: 1,
		ownership,
		selection: createStaticFabSelection(
			createRailAreaSelectionFromOwnerships(ownership, ownership.modules),
			document.portEquipment,
			0,
			[],
		),
		mirror: bridge,
		projectIdle: true,
	};
	let time = 0;
	let checkpointHook: (() => void) | null = null;
	const controller = new StandaloneProcessLoopAuthoringController({
		readSource: () => source,
		createCheckpoint: () => async () => {
			checkpointHook?.();
		},
		now: now ?? (() => (time += 5)),
		topology: new StaticFabProcessLoopTopologyBridge(() => new InlineTopology()),
	});
	return {
		document,
		mirror,
		events,
		controller,
		get source() {
			return source;
		},
		setCheckpointHook(hook: () => void) {
			checkpointHook = hook;
		},
		refresh() {
			ownership = buildRailModuleOwnershipIndex(document.map);
			source = { ...source, ownership, modelGeneration: source.modelGeneration + 1 };
		},
		repair() {
			const plan = planRailErase(document.map, [{ x: 18, y: 20 }]);
			if (!plan.valid) throw new Error(plan.reason);
			return controller.repair(1, plan.mutations, plan.switchMutations, () => true);
		},
		setFinalLeaseHook(hook: () => void) {
			finalLeaseHook = hook;
		},
	};
}
