import { afterEach, describe, expect, it, vi } from "vitest";
import { RailDocument } from "../core/RailDocument";
import type { SourceBoundCooperativeTask } from "../core/SourceBoundCooperativeTask";
import {
	createStaticFabAssemblyConnectorLaunchPreparation,
	type StaticFabAssemblyConnectorLaunchInput,
	type StaticFabAssemblyConnectorLaunchResult,
} from "../core/StaticFabAssemblyConnectorLaunch";
import { bay, loops, record, state } from "../core/StaticFabCheckRepair.test-fixtures";
import type { StaticFabCheckRepairTargetIndex } from "../core/StaticFabCheckRepairTargetIndex";
import * as targetIndexModule from "../core/StaticFabCheckRepairTargetIndex";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import * as organizationsModule from "../core/StaticFabOrganization";
import type { StaticFabOrganizationMetadataLookup } from "../core/StaticFabOrganizationMetadataLookup";
import {
	INITIAL_RAIL_WORKER_STATE,
	type RailWorkerBridgeHandle,
	type RailWorkerBridgeState,
} from "../worker/RailWorkerBridge";
import {
	StaticFabCheckRepairChooserController,
	type StaticFabCheckRepairChooserLaunch,
	type StaticFabCheckRepairChooserPorts,
	type StaticFabCheckRepairChooserView,
} from "./StaticFabCheckRepairChooserController";
import {
	captureStaticFabCheckRepairContinuation,
	type StaticFabCheckRepairCurrent,
	type StaticFabCheckRepairDomainCurrent,
	type StaticFabCheckRepairSource,
	staticFabCheckRepairCurrentIsExact,
	staticFabCheckRepairDomainIsExact,
} from "./StaticFabCheckRepairContinuation";
import {
	staticFabCheckRepairReturnMatchesProject,
	staticFabCheckRepairReturnOrigin,
} from "./StaticFabCheckRepairReturnOrigin";

afterEach(() => vi.restoreAllMocks());

function expectExplicitLookupRelease(lookup: StaticFabOrganizationMetadataLookup | null): void {
	expect(lookup).not.toBeNull();
	let failure: unknown;
	try {
		(lookup as StaticFabOrganizationMetadataLookup).claim();
	} catch (error) {
		failure = error;
	}
	// R5 checks released/failed before ownerClaimed and before its source callback.
	// A still-owned stale lookup would report LOOKUP_ALREADY_OWNED here, not self-revoke.
	expect(failure).toMatchObject({ code: "REVOKED" });
}

// Metadata/scheduling unit fixtures only. Organization getter + mirror port are test doubles;
// the synthetic organization edges are not installed into a physical map. No topology,
// Worker transport, authored patch, browser rendering or real UI acceptance is certified here.
function fixture(organizations: StaticFabOrganizationState = loops(3)) {
	const document = new RailDocument();
	// Freshness reads intentionally repeat per cooperative operation. This fixture needs
	// an exact getter, not millions of retained mock call records during 100k queries.
	Object.defineProperty(document, "organizations", {
		configurable: true,
		get: () => organizations,
	});
	const checksum = "synthetic-metadata-fixture-not-worker-authority";
	const model = Object.freeze({
		document,
		generation: 1,
		authoredChecksum: checksum,
		map: document.map,
		portEquipment: document.portEquipment,
		organizations,
		relationships: document.relationships,
		operationalConfiguration: document.operationalConfiguration,
	});
	const mirrorState: RailWorkerBridgeState = {
		...INITIAL_RAIL_WORKER_STATE,
		status: "ready",
		simulationReady: false,
		epoch: 1,
		sequence: 0,
		targetSequence: 0,
		revision: 0,
		targetRevision: 0,
		checksum,
		targetChecksum: checksum,
		cells: 0,
		targetCells: 0,
		edges: 0,
		targetEdges: 0,
		switches: 0,
		targetSwitches: 0,
		ports: document.portEquipment.ports.length,
		targetPorts: document.portEquipment.ports.length,
		equipmentGroups: document.portEquipment.equipmentGroups.length,
		targetEquipmentGroups: document.portEquipment.equipmentGroups.length,
		organizations: organizations.records.length,
		targetOrganizations: organizations.records.length,
		assemblyRelationships: document.relationships.records.length,
		targetAssemblyRelationships: document.relationships.records.length,
		assemblyRelationshipNextId: document.relationships.nextRelationshipId,
		targetAssemblyRelationshipNextId: document.relationships.nextRelationshipId,
		operationalConfigurationRevision: document.operationalConfiguration.revision,
		targetOperationalConfigurationRevision: document.operationalConfiguration.revision,
		operationalConfigurationFingerprint: "synthetic-operations",
		targetOperationalConfigurationFingerprint: "synthetic-operations",
	};
	let mirrorHook: (() => void) | null = null;
	const mirror = {
		getState: () => {
			mirrorHook?.();
			return mirrorState;
		},
	} as RailWorkerBridgeHandle;
	const source: StaticFabCheckRepairSource = {
		document,
		model,
		map: document.map,
		portEquipment: document.portEquipment,
		organizations,
		relationships: document.relationships,
		operationalConfiguration: document.operationalConfiguration,
		mirror,
		mirrorEpoch: 1,
		projectId: "synthetic-project",
		projectGeneration: 1,
		modelGeneration: 1,
		revision: document.map.getRevision(),
		mutationGeneration: document.map.getMutationGeneration(),
		sequence: document.getPatchSequence(),
		authoredChecksum: checksum,
		sourceKey: "checks-source-1",
		readinessFingerprint: "checks-readiness-1",
	};
	let current: StaticFabCheckRepairCurrent = {
		source,
		issueId: "synthetic-issue",
		issueCode: "DISCONNECTED",
		locationIndex: 0,
		projectIdle: true,
		modelSyncPending: false,
		checksCurrent: true,
	};
	const continuation = captureStaticFabCheckRepairContinuation(
		source,
		current.issueId,
		current.issueCode,
		0,
	);
	const pending: Array<() => void> = [];
	let checkpoints = 0;
	let clock = 0;
	let clockStep = 0;
	let clockReader: (() => number) | null = null;
	let nowHook: (() => void) | null = null;
	let readHook: (() => void) | null = null;
	let domainHook: (() => void) | null = null;
	let fullChecksReadable = true;
	let publishHook: ((view: StaticFabCheckRepairChooserView | null) => void) | null = null;
	let launchHook: (request: StaticFabCheckRepairChooserLaunch) => boolean = () => false;
	let prepareHook: (
		input: StaticFabAssemblyConnectorLaunchInput,
	) => SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult> =
		createStaticFabAssemblyConnectorLaunchPreparation;
	let domain: StaticFabCheckRepairDomainCurrent | null = null;
	const preparations: SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult>[] = [];
	const views: Array<StaticFabCheckRepairChooserView | null> = [];
	const launches: StaticFabCheckRepairChooserLaunch[] = [];
	const createCheckpoint = vi.fn(
		() => () =>
			new Promise<void>((resolve) => {
				checkpoints++;
				pending.push(resolve);
			}),
	);
	const ports: StaticFabCheckRepairChooserPorts = {
		readCurrent: () => {
			readHook?.();
			return fullChecksReadable ? current : null;
		},
		readDomainCurrent: () => {
			domainHook?.();
			return (
				domain ?? {
					source: current.source,
					projectIdle: current.projectIdle,
					modelSyncPending: current.modelSyncPending,
				}
			);
		},
		now: () => {
			nowHook?.();
			if (clockReader) return clockReader();
			clock += clockStep;
			return clock;
		},
		createCheckpoint,
		publish: (view) => {
			views.push(view);
			publishHook?.(view);
		},
		prepareConnector: (input) => {
			const task = prepareHook(input);
			preparations.push(task);
			return task;
		},
		launch: (request) => {
			launches.push(request);
			return launchHook(request);
		},
	};
	const controller = new StaticFabCheckRepairChooserController(ports);
	return {
		controller,
		ports,
		continuation,
		source,
		mirrorState,
		views,
		launches,
		preparations,
		createCheckpoint,
		get checkpoints() {
			return checkpoints;
		},
		get pending() {
			return pending.length;
		},
		get current() {
			return current;
		},
		setCurrent(value: StaticFabCheckRepairCurrent) {
			current = value;
		},
		setClockStep(value: number) {
			clockStep = value;
		},
		setClockReader(value: (() => number) | null) {
			clockReader = value;
		},
		setNowHook(value: (() => void) | null) {
			nowHook = value;
		},
		setReadHook(value: (() => void) | null) {
			readHook = value;
		},
		setDomainHook(value: (() => void) | null) {
			domainHook = value;
		},
		setMirrorHook(value: (() => void) | null) {
			mirrorHook = value;
		},
		setFullChecksReadable(value: boolean) {
			fullChecksReadable = value;
		},
		setDomain(value: StaticFabCheckRepairDomainCurrent | null) {
			domain = value;
		},
		setPrepareHook(value: typeof prepareHook) {
			prepareHook = value;
		},
		setPublishHook(value: ((view: StaticFabCheckRepairChooserView | null) => void) | null) {
			publishHook = value;
		},
		setLaunchHook(value: (request: StaticFabCheckRepairChooserLaunch) => boolean) {
			launchHook = value;
		},
		async oneTurn() {
			pending.shift()?.();
			// Controlled checkpoint resolution, not UI/macrotask evidence.
			for (let turn = 0; turn < 8; turn++) await Promise.resolve();
		},
		async settle<T>(promise: Promise<T>): Promise<T> {
			let done = false;
			let value: T | undefined;
			let failure: unknown;
			let failed = false;
			void promise.then(
				(result) => {
					value = result;
					done = true;
				},
				(error) => {
					failure = error;
					failed = true;
					done = true;
				},
			);
			for (let turns = 0; !done; turns++) {
				if (turns > 100_000) throw new Error("Proposed chooser fixture exceeded bounded turns.");
				await this.oneTurn();
			}
			if (failed) throw failure;
			return value as T;
		},
	};
}

describe("Checks chooser coordinator", () => {
	it("prepares metadata/options once and does not infer a target or duplicate selected matches", async () => {
		const f = fixture();
		const derive = vi.spyOn(organizationsModule, "deriveStaticFabOrganizationSemanticRoleSteps");
		try {
			const opening = f.controller.open(f.continuation, "loop");
			await f.controller.updateQuery({ searchText: "#3" });
			await f.settle(opening);
			expect(derive).toHaveBeenCalledTimes(1);
			expect(f.createCheckpoint).toHaveBeenCalledTimes(1);
			expect(f.controller.view).toMatchObject({
				phase: "ready",
				advice: { status: "choose" },
				page: { selected: [] },
			});
			expect(await f.settle(f.controller.launch())).toBe(false);
			await f.settle(f.controller.updateQuery({ searchText: "#3", selectedOrganizationIds: [1] }));
			expect(f.controller.view).toMatchObject({
				advice: { status: "ready", organizationId: 1 },
				page: { queryStatus: "exact-id-match" },
			});
			expect(f.controller.view?.page?.matches.map((option) => option.id)).toEqual([3]);
			await f.settle(f.controller.updateQuery({ searchText: "", selectedOrganizationIds: [1] }));
			expect(f.controller.view?.page?.matches.map((option) => option.id)).toEqual([2, 3]);
			expect(derive).toHaveBeenCalledTimes(1);
		} finally {
			f.controller.dispose();
		}
	});

	it("100k common-prefix/rare/absent search yields with a stationary clock; #ID stays bounded", async () => {
		const f = fixture(loops(100_000, `Shared visible prefix ${"Long ".repeat(14)}`));
		try {
			const opening = f.controller.open(f.continuation, "loop");
			expect(f.controller.view?.phase).toBe("preparing");
			expect(f.pending).toBe(1);
			await f.oneTurn();
			expect(f.controller.view?.phase).toBe("preparing");
			expect(f.pending).toBe(1); // Positive 128-operation slice cannot drain all records.
			await f.settle(opening);
			for (const searchText of ["absent synthetic name", "rare last"]) {
				const before = f.checkpoints;
				const querying = f.controller.updateQuery({ searchText });
				await f.oneTurn();
				expect(f.controller.view?.phase).toBe("querying");
				expect(f.pending).toBe(1);
				await f.settle(querying);
				expect(f.checkpoints - before).toBeGreaterThan(700);
				expect(f.controller.view?.page).toMatchObject({
					scannedRecordCount: 100_000,
					hasMore: false,
					selected: [],
				});
				expect(f.controller.view?.page?.matches.map((option) => option.id)).toEqual(
					searchText.startsWith("absent") ? [] : [100_000],
				);
			}
			const beforeId = f.checkpoints;
			await f.settle(f.controller.updateQuery({ searchText: "#100000" }));
			expect(f.checkpoints - beforeId).toBe(2);
			expect(f.controller.view?.page).toMatchObject({
				queryStatus: "exact-id-match",
				scannedRecordCount: 0,
				selected: [],
			});
			expect(f.controller.view?.page?.matches[0]?.id).toBe(100_000);
		} finally {
			f.controller.dispose();
		}
	}, 30_000); // Proposed synthetic allowance only; not a measured latency claim.

	it("checks 4ms after individual operations and yields without waiting for a 128-op batch", async () => {
		const f = fixture(loops(300));
		f.setClockStep(4);
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			expect(f.checkpoints).toBeGreaterThan(300);
		} finally {
			f.controller.dispose();
		}
	});

	it("rejects 10 → 13 → 12 clock reversal even while both samples stay below the slice's 4ms boundary", async () => {
		const f = fixture(loops(300));
		const samples = [10, 13, 12];
		const reads: number[] = [];
		f.setClockReader(() => {
			const value = samples.shift() ?? 12;
			reads.push(value);
			return value;
		});
		try {
			await expect(f.settle(f.controller.open(f.continuation, "loop"))).rejects.toMatchObject({
				code: "INVALID_CLOCK",
			});
			expect(reads).toEqual([10, 13, 12]);
			expect(13 - 10).toBeLessThan(4);
			expect(12 - 10).toBeLessThan(4);
			expect(f.controller.view).toBeNull();
			expect(f.views.filter((view) => view?.phase === "ready")).toEqual([]);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"checkpoint",
		"now",
		"read",
		"publish",
	] as const)("cancellation from %s callback prevents publication with now=0", async (boundary) => {
		const f = fixture(loops(300));
		const opening = f.controller.open(f.continuation, "loop");
		if (boundary === "checkpoint") {
			await f.oneTurn();
			expect(f.pending).toBe(1);
			f.controller.close();
		} else if (boundary === "now")
			f.setNowHook(() => {
				f.setNowHook(null);
				f.controller.close();
			});
		else if (boundary === "read")
			f.setReadHook(() => {
				f.setReadHook(null);
				f.controller.close();
			});
		else
			f.setPublishHook((view) => {
				if (view?.phase === "querying") {
					f.setPublishHook(null);
					f.controller.close();
				}
			});
		await f.settle(opening).catch(() => undefined);
		expect(f.controller.view).toBeNull();
		expect(f.views.filter((view) => view?.phase === "ready")).toEqual([]);
		f.controller.dispose();
	});

	it("old query cancellation/finally does not revoke the same open's replacement query", async () => {
		const f = fixture(loops(400));
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			const old = f.controller.updateQuery({ searchText: "absent" });
			await f.oneTurn();
			const replacement = f.controller.updateQuery({ searchText: "#400" });
			await f.settle(Promise.all([old, replacement]));
			expect(f.controller.view?.page).toMatchObject({
				queryStatus: "exact-id-match",
				scannedRecordCount: 0,
			});
			expect(f.controller.view?.page?.matches[0]?.id).toBe(400);
			expect(f.controller.view?.page?.selected[0]).toMatchObject({
				organizationId: 1,
				status: "available",
			});
		} finally {
			f.controller.dispose();
		}
	});

	it("selected slots exist before preparation and keep their names/#ID while a new page is pending", async () => {
		const f = fixture(loops(400));
		try {
			const opening = f.controller.open(f.continuation, "loop");
			await f.controller.updateQuery({ selectedOrganizationIds: [400] });
			expect(f.controller.view?.selectedSlots).toEqual([
				{ status: "pending", organizationId: 400 },
			]);
			await f.settle(opening);
			const selected = f.controller.view?.selectedSlots;
			expect(selected).toEqual([
				{
					status: "available",
					organizationId: 400,
					option: { id: 400, name: "Rare Last 400", role: "PROCESS_LOOP" },
				},
			]);
			const querying = f.controller.updateQuery({ searchText: "no such name" });
			expect(f.controller.view).toMatchObject({
				phase: "querying",
				page: null,
				selectedSlots: selected,
			});
			await f.settle(querying);
			expect(f.controller.view?.selectedSlots).toEqual(selected);
			expect(f.controller.view?.page?.matches).toEqual([]);
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [401] }));
			expect(f.controller.view?.selectedSlots).toEqual([
				{ status: "missing", organizationId: 401 },
			]);
			f.controller.close();
			expect(f.controller.view).toBeNull();
		} finally {
			f.controller.dispose();
		}
	});

	it("index finish handoff is adopted before a final source callback closes the open", async () => {
		const f = fixture();
		const create = targetIndexModule.createStaticFabCheckRepairTargetIndexPreparation;
		let issued: StaticFabCheckRepairTargetIndex | null = null;
		vi.spyOn(
			targetIndexModule,
			"createStaticFabCheckRepairTargetIndexPreparation",
		).mockImplementation((organizations, lookup) => {
			const inner = create(organizations, lookup);
			return Object.freeze({
				get done() {
					return inner.done;
				},
				step: (budget: number) => inner.step(budget),
				finish: () => {
					const index = inner.finish();
					issued = index;
					f.setReadHook(() => {
						f.setReadHook(null);
						f.controller.close();
					});
					return index;
				},
				cancel: () => inner.cancel(),
			});
		});
		try {
			await f.settle(f.controller.open(f.continuation, "loop")).catch(() => undefined);
			expect(f.controller.view).toBeNull();
			expect(issued).not.toBeNull();
			let finalReads = 0;
			f.setReadHook(() => {
				finalReads++;
			});
			let claimFailure: unknown;
			try {
				(issued as unknown as StaticFabCheckRepairTargetIndex).metadataLookup.claim();
			} catch (error) {
				claimFailure = error;
			}
			expect(claimFailure).toMatchObject({ code: "REVOKED" });
			expect(finalReads).toBe(0); // Direct terminal state before any source guard can self-revoke.
			expect(() =>
				(issued as unknown as StaticFabCheckRepairTargetIndex).resolveSelected(1),
			).toThrow();
			expect(f.views.filter((view) => view?.phase === "ready")).toEqual([]);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		false,
		true,
	])("a cancel callback's new open B supersedes outer A without allocation/publication (cleanup throws=%s)", async (cleanupThrows) => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		let replacement: Promise<void> | null = null;
		let oldLookup: StaticFabOrganizationMetadataLookup | null = null;
		let callbacks = 0;
		f.setPrepareHook((input) => {
			oldLookup = input.metadataLookup;
			const inner = createStaticFabAssemblyConnectorLaunchPreparation(input);
			return Object.freeze({
				get done() {
					return inner.done;
				},
				step: (budget: number) => inner.step(budget),
				finish: () => inner.finish(),
				cancel: () => {
					inner.cancel();
					if (++callbacks === 1) {
						replacement = f.controller.open(f.continuation, "connector");
						if (cleanupThrows) throw new Error("old cleanup failed after opening B");
					}
				},
			});
		});
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			const oldLaunch = f.controller.launch();
			await f.oneTurn();
			expect(f.preparations).toHaveLength(1);
			const before = f.views.length;
			await expect(f.settle(f.controller.open(f.continuation, "loop"))).rejects.toMatchObject({
				code: "CANCELLED",
			});
			expect(replacement).not.toBeNull();
			expect(f.views.slice(before).some((view) => view?.kind === "loop")).toBe(false);
			expectExplicitLookupRelease(oldLookup);
			expect(await f.settle(oldLaunch)).toBe(false);
			await f.settle(replacement as unknown as Promise<void>);
			expect(callbacks).toBe(1);
			expect(f.controller.view).toMatchObject({
				kind: "connector",
				phase: "ready",
				advice: { status: "choose" },
			});
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1, 4] }));
			f.setPrepareHook(createStaticFabAssemblyConnectorLaunchPreparation);
			f.setLaunchHook(() => true);
			expect(await f.settle(f.controller.launch())).toBe(true);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"close",
		"dispose",
	] as const)("%s from old cancel invalidates the pending outer opening sentinel", async (action) => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		let oldLookup: StaticFabOrganizationMetadataLookup | null = null;
		let callbacks = 0;
		f.setPrepareHook((input) => {
			oldLookup = input.metadataLookup;
			const inner = createStaticFabAssemblyConnectorLaunchPreparation(input);
			return Object.freeze({
				get done() {
					return inner.done;
				},
				step: (budget: number) => inner.step(budget),
				finish: () => inner.finish(),
				cancel: () => {
					inner.cancel();
					if (++callbacks !== 1) return;
					if (action === "close") f.controller.close();
					else f.controller.dispose();
				},
			});
		});
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			const oldLaunch = f.controller.launch();
			await f.oneTurn();
			const before = f.views.length;
			await expect(f.settle(f.controller.open(f.continuation, "loop"))).rejects.toMatchObject({
				code: "CANCELLED",
			});
			expect(f.controller.view).toBeNull();
			expect(f.views.slice(before).filter((view) => view !== null)).toEqual([]);
			expectExplicitLookupRelease(oldLookup);
			expect(await f.settle(oldLaunch)).toBe(false);
			expect(callbacks).toBe(1);
			if (action === "dispose")
				await expect(f.controller.open(f.continuation, "connector")).rejects.toMatchObject({
					code: "CANCELLED",
				});
			else {
				await f.settle(f.controller.open(f.continuation, "connector"));
				expect(f.controller.view?.phase).toBe("ready");
			}
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"open",
		"close",
		"primary source failure",
	] as const)("throwing cancel during %s still releases the old index and preserves the first error", async (action) => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		const cleanupFailure = new Error("first captured cleanup failure");
		const primaryFailure = new Error("earlier source reader failure");
		const publishFailure = new Error("later closed publication failure");
		let oldLookup: StaticFabOrganizationMetadataLookup | null = null;
		f.setPrepareHook((input) => {
			oldLookup = input.metadataLookup;
			const inner = createStaticFabAssemblyConnectorLaunchPreparation(input);
			return Object.freeze({
				get done() {
					return inner.done;
				},
				step: (budget: number) => inner.step(budget),
				finish: () => inner.finish(),
				cancel: () => {
					inner.cancel();
					throw cleanupFailure;
				},
			});
		});
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			const oldLaunch = f.controller.launch();
			await f.oneTurn();
			f.setPublishHook((view) => {
				if (view === null) throw publishFailure;
			});
			if (action === "open")
				await expect(f.settle(f.controller.open(f.continuation, "loop"))).rejects.toBe(
					cleanupFailure,
				);
			else if (action === "close") expect(() => f.controller.close()).toThrow(cleanupFailure);
			else {
				f.setReadHook(() => {
					f.setReadHook(null);
					throw primaryFailure;
				});
				await expect(f.controller.updateQuery({ searchText: "#1" })).rejects.toBe(primaryFailure);
			}
			expectExplicitLookupRelease(oldLookup);
			expect(f.controller.view).toBeNull();
			expect(await f.settle(oldLaunch)).toBe(false);
		} finally {
			f.setPublishHook(null);
			f.controller.dispose();
		}
	});

	it("same pair caller order remains visible independently from its sorted advisory connector result", async () => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 4] }));
			expect(f.controller.view?.selectedSlots.map((slot) => slot.organizationId)).toEqual([4, 4]);
			expect(f.controller.view?.advice?.status).toBe("blocked");
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			expect(f.controller.view?.selectedSlots.map((slot) => slot.organizationId)).toEqual([4, 1]);
			expect(f.controller.view?.advice).toMatchObject({ status: "ready", organizationIds: [1, 4] });
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [2, 1] }));
			expect(f.controller.view?.selectedSlots[0]).toEqual({
				status: "unsupported",
				organizationId: 2,
			});
		} finally {
			f.controller.dispose();
		}
	});

	it("query final publication can synchronously replace the open; old finally cannot hide/revoke it", async () => {
		const f = fixture();
		await f.settle(f.controller.open(f.continuation, "loop"));
		let replacement: Promise<void> | null = null;
		f.setPublishHook((view) => {
			if (view?.phase !== "ready") return;
			f.setPublishHook(null);
			replacement = f.controller.open(f.continuation, "loop");
		});
		await f.settle(f.controller.updateQuery({ searchText: "#2" }));
		expect(replacement).not.toBeNull();
		await f.settle(replacement as unknown as Promise<void>);
		expect(f.controller.view).toMatchObject({ phase: "ready", advice: { status: "choose" } });
		await f.settle(f.controller.updateQuery({ searchText: "#3" }));
		expect(f.controller.view?.page?.matches[0]?.id).toBe(3);
		f.controller.dispose();
	});

	it("source ABA with the same organization ref cannot revive an observed stale chooser", async () => {
		const f = fixture();
		await f.settle(f.controller.open(f.continuation, "loop"));
		const original = f.current;
		f.setCurrent({ ...original, source: { ...original.source, projectGeneration: 2 } });
		await expect(f.controller.updateQuery({ searchText: "#1" })).rejects.toMatchObject({
			code: "STALE_SOURCE",
		});
		expect(f.controller.view).toBeNull();
		f.setCurrent(original);
		await expect(f.controller.updateQuery({ searchText: "#1" })).rejects.toMatchObject({
			code: "CANCELLED",
		});
		await f.settle(f.controller.open(f.continuation, "loop"));
		expect(f.controller.view?.phase).toBe("ready");
		f.controller.dispose();
	});

	it.each([
		"refused",
		"throws",
	] as const)("%s launch retains explicit IDs; accepted launch consumes navigation once", async (failure) => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		await f.settle(f.controller.open(f.continuation, "connector"));
		const ids = [4, 1];
		await f.settle(f.controller.updateQuery({ selectedOrganizationIds: ids }));
		f.setLaunchHook((request) => {
			expect(request.isCurrent()).toBe(true);
			expect(request.kind).toBe("connector");
			if (failure === "throws") throw new Error("synthetic launcher refusal");
			return false;
		});
		expect(await f.settle(f.controller.launch())).toBe(false);
		expect(f.controller.view).toMatchObject({
			phase: "ready",
			query: { selectedOrganizationIds: [4, 1] },
			advice: { status: "ready", organizationIds: [1, 4] },
		});
		expect(ids).toEqual([4, 1]);
		f.setLaunchHook((request) => {
			expect(request.isCurrent()).toBe(true);
			return true;
		});
		expect(await f.settle(f.controller.launch())).toBe(true);
		expect(f.controller.view).toBeNull();
		expect(await f.settle(f.controller.launch())).toBe(false);
		expect(f.launches).toHaveLength(2);
		expect(f.launches.every((request) => request.isCurrent() === false)).toBe(true);
		for (const request of f.launches) expect(() => request.metadataLookup.record(1)).toThrow();
		f.controller.dispose();
	});

	it("active connector preparation yields with now=0; query replacement cancels only the old launch task", async () => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		const derive = vi.spyOn(organizationsModule, "deriveStaticFabOrganizationSemanticRoleSteps");
		let cancel = vi.fn();
		const stepArguments: number[] = [];
		f.setPrepareHook((input) => {
			const inner = createStaticFabAssemblyConnectorLaunchPreparation(input);
			cancel = vi.fn(() => inner.cancel());
			return Object.freeze({
				get done() {
					return inner.done;
				},
				step: (budget: number) => {
					stepArguments.push(budget);
					return inner.step(budget);
				},
				finish: () => inner.finish(),
				cancel,
			});
		});
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			const launching = f.controller.launch();
			await f.oneTurn(); // Actual prep created, waiting for its initial scheduling checkpoint.
			expect(f.preparations).toHaveLength(1);
			await f.oneTurn(); // Positive step slice, still yields before finish/admission.
			expect(stepArguments.length).toBeGreaterThan(0);
			expect(stepArguments.every((budget) => budget === 1)).toBe(true);
			expect(f.pending).toBeGreaterThan(0);
			expect(f.launches).toEqual([]);
			const replacement = f.controller.updateQuery({ searchText: "#4" });
			expect(cancel).toHaveBeenCalled();
			expect(await f.settle(launching)).toBe(false);
			await f.settle(replacement);
			expect(f.controller.view).toMatchObject({
				phase: "ready",
				query: { selectedOrganizationIds: [4, 1] },
				page: { queryStatus: "exact-id-selected" },
			});
			expect(f.controller.view?.selectedSlots.map((slot) => slot.organizationId)).toEqual([4, 1]);
			expect(derive).toHaveBeenCalledTimes(1);
			f.setLaunchHook(() => true);
			expect(await f.settle(f.controller.launch())).toBe(true);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"close",
		"source ABA",
	] as const)("%s during captured prep prevents admission and cannot revive the old token", async (action) => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			const launching = f.controller.launch();
			await f.oneTurn();
			expect(f.preparations).toHaveLength(1);
			const original = f.current;
			if (action === "close") f.controller.close();
			else f.setCurrent({ ...original, source: { ...original.source, projectGeneration: 2 } });
			expect(await f.settle(launching)).toBe(false);
			expect(f.controller.view).toBeNull();
			expect(f.launches).toEqual([]);
			f.setCurrent(original);
			expect(await f.settle(f.controller.launch())).toBe(false);
			await f.settle(f.controller.open(f.continuation, "connector"));
			expect(f.controller.view?.phase).toBe("ready");
		} finally {
			f.controller.dispose();
		}
	});

	it("completed preparation final callback may replace the query without old finally revoking its index", async () => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		let replacement: Promise<void> | null = null;
		f.setPrepareHook((input) => {
			const inner = createStaticFabAssemblyConnectorLaunchPreparation(input);
			return Object.freeze({
				get done() {
					return inner.done;
				},
				step: (budget: number) => inner.step(budget),
				finish: () => {
					const result = inner.finish();
					replacement = f.controller.updateQuery({ searchText: "#1" });
					return result;
				},
				cancel: () => inner.cancel(),
			});
		});
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(replacement).not.toBeNull();
			await f.settle(replacement as unknown as Promise<void>);
			expect(f.controller.view).toMatchObject({
				phase: "ready",
				query: { selectedOrganizationIds: [4, 1] },
				page: { queryStatus: "exact-id-selected" },
			});
			expect(f.launches).toEqual([]);
		} finally {
			f.controller.dispose();
		}
	});

	it("fresh failed prep retains IDs and its owned index for query and later retry", async () => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		const derive = vi.spyOn(organizationsModule, "deriveStaticFabOrganizationSemanticRoleSteps");
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			f.setPrepareHook(() => {
				throw new Error("synthetic preparation refusal");
			});
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(f.controller.view).toMatchObject({
				phase: "ready",
				launchStage: null,
				query: { selectedOrganizationIds: [4, 1] },
				reason: "synthetic preparation refusal",
			});
			await f.settle(f.controller.updateQuery({ searchText: "#4" }));
			expect(derive).toHaveBeenCalledTimes(1);
			f.setPrepareHook(createStaticFabAssemblyConnectorLaunchPreparation);
			f.setLaunchHook(() => true);
			expect(await f.settle(f.controller.launch())).toBe(true);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"cloned result",
		"foreign captured request",
	] as const)("%s refuses final admission without consuming a fresh chooser", async (caseName) => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		f.setPrepareHook((input) => {
			const inner = createStaticFabAssemblyConnectorLaunchPreparation(
				caseName === "foreign captured request" ? { ...input } : input,
			);
			return Object.freeze({
				get done() {
					return inner.done;
				},
				step: (budget: number) => inner.step(budget),
				finish: () => {
					const result = inner.finish();
					return caseName === "cloned result" ? Object.freeze({ ...result }) : result;
				},
				cancel: () => inner.cancel(),
			});
		});
		try {
			await f.settle(f.controller.open(f.continuation, "connector"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(f.controller.view).toMatchObject({
				phase: "ready",
				query: { selectedOrganizationIds: [4, 1] },
			});
			expect(f.launches).toEqual([]);
			await f.settle(f.controller.updateQuery({ searchText: "#4" }));
			expect(f.controller.view?.page?.queryStatus).toBe("exact-id-selected");
		} finally {
			f.controller.dispose();
		}
	});

	it("absent cooperative prep refuses the connector; there is no synchronous fallback", async () => {
		const f = fixture(state([...bay(1), ...bay(4)]));
		const controller = new StaticFabCheckRepairChooserController({
			readCurrent: f.ports.readCurrent,
			readDomainCurrent: f.ports.readDomainCurrent,
			now: f.ports.now,
			createCheckpoint: f.ports.createCheckpoint,
			publish: f.ports.publish,
			launch: f.ports.launch,
		});
		try {
			await f.settle(controller.open(f.continuation, "connector"));
			await f.settle(controller.updateQuery({ selectedOrganizationIds: [4, 1] }));
			expect(await f.settle(controller.launch())).toBe(false);
			expect(controller.view).toMatchObject({
				phase: "ready",
				query: { selectedOrganizationIds: [4, 1] },
			});
			expect(f.launches).toEqual([]);
		} finally {
			controller.dispose();
			f.controller.dispose();
		}
	});

	it.each([
		"false",
		"throw",
		"domain changed",
		"replacement",
	] as const)("%s admission rolls back its exact installed backend once", async (failure) => {
		const f = fixture();
		const cleanup = vi.fn();
		let replacement: Promise<void> | null = null;
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			f.setLaunchHook((request) => {
				request.registerRollback(cleanup);
				if (failure === "throw") throw new Error("Installed backend admission failed");
				if (failure === "domain changed")
					f.setDomain({
						source: { ...f.source, projectGeneration: 2 },
						projectIdle: true,
						modelSyncPending: false,
					});
				if (failure === "replacement") replacement = f.controller.open(f.continuation, "loop");
				return failure !== "false";
			});
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(cleanup).toHaveBeenCalledTimes(1);
			if (replacement) {
				await f.settle(replacement);
				expect(f.controller.view).toMatchObject({ phase: "ready", advice: { status: "choose" } });
			}
		} finally {
			f.controller.dispose();
		}
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("successful navigation releases rollback capability without cleaning the accepted backend", async () => {
		const f = fixture();
		const cleanup = vi.fn();
		let request: StaticFabCheckRepairChooserLaunch | null = null;
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			f.setLaunchHook((value) => {
				request = value;
				value.registerRollback(cleanup);
				return true;
			});
			expect(await f.settle(f.controller.launch())).toBe(true);
			expect(cleanup).not.toHaveBeenCalled();
			expect(() =>
				(request as unknown as StaticFabCheckRepairChooserLaunch).registerRollback(cleanup),
			).toThrow();
		} finally {
			f.controller.dispose();
		}
		expect(cleanup).not.toHaveBeenCalled();
	});

	it("true launcher may close its own Checks UI while exact domain identity still consumes once", async () => {
		const f = fixture();
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			f.setLaunchHook((request) => {
				expect(request.isCurrent()).toBe(true);
				f.setFullChecksReadable(false); // Owned UI closure, source/model/Worker unchanged.
				return true;
			});
			expect(await f.settle(f.controller.launch())).toBe(true);
			expect(f.controller.view).toBeNull();
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(f.launches).toHaveLength(1);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"true domain changed",
		"false Checks closed",
	] as const)("%s cannot use an accepted UI-only guard", async (caseName) => {
		const f = fixture();
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			f.setLaunchHook(() => {
				f.setFullChecksReadable(false);
				if (caseName === "true domain changed")
					f.setDomain({
						source: { ...f.source, projectGeneration: 2 },
						projectIdle: true,
						modelSyncPending: false,
					});
				return caseName === "true domain changed";
			});
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(f.controller.view).toBeNull();
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"map restored counts",
		"active model replacement",
		"close",
	] as const)("getState callback %s after true cannot accept the old domain", async (action) => {
		const f = fixture();
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			f.setLaunchHook(() => {
				f.setMirrorHook(() => {
					f.setMirrorHook(null);
					if (action === "map restored counts") {
						// Real internal Map mutation: cardinalities end at zero; rev/mutation change.
						// This source-lifetime fixture makes no authored/Worker grammar claim.
						f.source.map.setEncoded(0, 0, 1);
						f.source.map.setEncoded(0, 0, 0);
					} else if (action === "active model replacement") {
						f.setCurrent({
							...f.current,
							source: { ...f.current.source, model: { ...f.source.model } },
						});
					} else f.controller.close();
				});
				return true;
			});
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(f.controller.view).toBeNull();
			expect(f.launches).toHaveLength(1);
			expect(f.source.map.size).toBe(0);
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"mutation",
		"close",
	] as const)("bounded last domain reread %s refuses acceptance", async (action) => {
		const f = fixture();
		let reads = 0;
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			f.setLaunchHook(() => {
				f.setDomainHook(() => {
					if (++reads !== 2) return;
					if (action === "mutation") {
						f.source.map.setEncoded(0, 0, 1);
						f.source.map.setEncoded(0, 0, 0);
					} else f.controller.close();
				});
				return true;
			});
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(reads).toBe(2); // Never retry a foreign reader indefinitely.
			expect(f.controller.view).toBeNull();
		} finally {
			f.controller.dispose();
		}
	});

	it.each([
		"getState",
		"last Checks reader",
	] as const)("%s mutation at final pre-admission guard cannot start a session", async (boundary) => {
		const f = fixture();
		let reads = 0;
		const mutate = () => {
			f.source.map.setEncoded(0, 0, 1);
			f.source.map.setEncoded(0, 0, 0);
		};
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			f.setLaunchHook((request) => {
				if (boundary === "getState")
					f.setMirrorHook(() => {
						f.setMirrorHook(null);
						mutate();
					});
				else
					f.setReadHook(() => {
						if (++reads === 2) {
							f.setReadHook(null);
							mutate();
						}
					});
				expect(request.isCurrent()).toBe(false);
				return false; // Actual adapter must refuse before it changes UI/session binding.
			});
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(f.controller.view).toBeNull();
			expect(f.source.map.size).toBe(0);
		} finally {
			f.controller.dispose();
		}
	});

	it("replacement during launch success must not consume or clean replacement resources", async () => {
		const f = fixture();
		await f.settle(f.controller.open(f.continuation, "loop"));
		await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
		let replacement: Promise<void> | null = null;
		f.setLaunchHook(() => {
			replacement = f.controller.open(f.continuation, "loop");
			return true;
		});
		expect(await f.settle(f.controller.launch())).toBe(false);
		await f.settle(replacement as unknown as Promise<void>);
		await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [2] }));
		f.setLaunchHook(() => true);
		expect(await f.settle(f.controller.launch())).toBe(true);
		expect(f.launches).toHaveLength(2);
		f.controller.dispose();
	});

	it("accepted-domain reader replacement remains open after the old launch settles", async () => {
		const f = fixture();
		let replacement: Promise<void> | null = null;
		try {
			await f.settle(f.controller.open(f.continuation, "loop"));
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [1] }));
			f.setLaunchHook(() => true);
			f.setDomainHook(() => {
				f.setDomainHook(null);
				replacement = f.controller.open(f.continuation, "loop");
			});
			expect(await f.settle(f.controller.launch())).toBe(false);
			expect(replacement).not.toBeNull();
			await f.settle(replacement as unknown as Promise<void>);
			expect(f.controller.view).toMatchObject({ phase: "ready", advice: { status: "choose" } });
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [2] }));
			expect(await f.settle(f.controller.launch())).toBe(true);
			expect(f.launches).toHaveLength(2);
		} finally {
			f.controller.dispose();
		}
	});

	it("same IDs/mixed levels refuse canonically and same-Fab Bank pair keeps advisory FAB_LOOP", async () => {
		const organizations = state([
			record(60, "AREA"),
			record(30, "AREA", [60]),
			record(40, "AREA", [60]),
			...bay(1, [30]),
			...bay(4, [40]),
			record(70, "AISLE", [], true),
		]);
		const f = fixture(organizations);
		await f.settle(f.controller.open(f.continuation, "connector"));
		for (const ids of [
			[1, 1],
			[1, 30],
			[1, 70],
		]) {
			await f.settle(f.controller.updateQuery({ selectedOrganizationIds: ids }));
			expect(f.controller.view?.advice?.status).toBe("blocked");
			expect(await f.settle(f.controller.launch())).toBe(false);
		}
		await f.settle(f.controller.updateQuery({ selectedOrganizationIds: [40, 30] }));
		expect(f.controller.view?.advice).toMatchObject({
			status: "ready",
			organizationIds: [30, 40],
			purpose: "FAB_LOOP",
			hierarchyRole: "BANK_TO_FAB",
		});
		expect(f.launches).toEqual([]); // Advisory purpose is not a DISCONNECTED repair certificate.
		f.controller.dispose();
	});

	it("reader rejects mismatched contracts/generations/Checks/ready CRC and return origin uses project lifetime only", () => {
		const f = fixture();
		expect(staticFabCheckRepairCurrentIsExact(f.continuation, f.current)).toBe(true);
		expect(staticFabCheckRepairDomainIsExact(f.continuation, f.current)).toBe(true);
		const closedIssue = {
			...f.current,
			checksCurrent: false,
			issueId: "closed",
			source: {
				...f.source,
				sourceKey: "owned-Checks-closure",
				readinessFingerprint: "owned-Checks-closure",
			},
		};
		expect(staticFabCheckRepairCurrentIsExact(f.continuation, closedIssue)).toBe(false);
		expect(staticFabCheckRepairDomainIsExact(f.continuation, closedIssue)).toBe(true);
		const source = f.source;
		for (const field of [
			"projectGeneration",
			"modelGeneration",
			"revision",
			"mutationGeneration",
			"sequence",
			"mirrorEpoch",
		] as const) {
			expect(
				staticFabCheckRepairCurrentIsExact(f.continuation, {
					...f.current,
					source: { ...source, [field]: source[field] + 1 },
				}),
			).toBe(false);
			expect(
				staticFabCheckRepairDomainIsExact(f.continuation, {
					...f.current,
					source: { ...source, [field]: source[field] + 1 },
				}),
			).toBe(false);
		}
		for (const field of ["authoredChecksum", "sourceKey", "readinessFingerprint"] as const) {
			expect(
				staticFabCheckRepairCurrentIsExact(f.continuation, {
					...f.current,
					source: { ...source, [field]: "different" },
				}),
			).toBe(false);
		}
		for (const field of [
			"document",
			"model",
			"map",
			"portEquipment",
			"organizations",
			"relationships",
			"operationalConfiguration",
			"mirror",
		] as const) {
			expect(
				staticFabCheckRepairCurrentIsExact(f.continuation, {
					...f.current,
					source: { ...source, [field]: {} },
				} as StaticFabCheckRepairCurrent),
			).toBe(false);
		}
		for (const overrides of [
			{ issueId: "different" },
			{ issueCode: "different" },
			{ locationIndex: 1 },
			{ projectIdle: false },
			{ modelSyncPending: true },
			{ checksCurrent: false },
		])
			expect(
				staticFabCheckRepairCurrentIsExact(f.continuation, { ...f.current, ...overrides }),
			).toBe(false);
		f.mirrorState.targetChecksum = "wrong";
		expect(staticFabCheckRepairCurrentIsExact(f.continuation, f.current)).toBe(false);
		const origin = staticFabCheckRepairReturnOrigin(f.continuation);
		const afterRepair = { ...source, sequence: 500, authoredChecksum: "changed-by-repair" };
		expect(staticFabCheckRepairReturnMatchesProject(origin, afterRepair)).toBe(true);
		expect(
			staticFabCheckRepairReturnMatchesProject(origin, { ...source, projectGeneration: 2 }),
		).toBe(false);
		f.controller.dispose();
	});
});
