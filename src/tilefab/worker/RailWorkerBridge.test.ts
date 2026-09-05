import { describe, expect, it, vi } from "vitest";
import {
	hydrateOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
} from "../compile/OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "../compile/OpenFabStationProposalCsvReader";
import {
	evaluateOpenFabStationProposalReview,
	finalizeOpenFabStationProposalReview,
	planReviewedOpenFabStationProposalBatch,
} from "../compile/OpenFabStationProposalReview";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { PortEquipmentGroupSlotIndex } from "../compile/PortEquipmentGroupEditPlanner";
import { planPortEquipmentMembershipEdit } from "../compile/PortEquipmentMembershipEditPlanner";
import { planEqRowPlacement } from "../compile/PortPlacementPlanner";
import { PortSlotAvailabilityIndex } from "../compile/PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "../compile/PortSlotPreparedArtifacts";
import { compileStaticFabHierarchyIndex } from "../compile/StaticFabHierarchy";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
} from "../compile/SyntheticFabStarter";
import { ADVANCED_SWITCH_ALL_MOVEMENTS, type AdvancedSwitchRecord } from "../core/AdvancedSwitch";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import {
	checksumOperationalConfigurationState,
	copyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import { validatePortEquipmentActivation } from "../core/PortEquipmentActivation";
import {
	createPortEquipmentMutationPlan,
	createPortEquipmentMutationPlanWithImmutableGraphCertificate,
} from "../core/PortEquipmentPlan";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import {
	createRailAreaSelection,
	createRailAreaSelectionFromOwnerships,
} from "../core/RailAreaSelection";
import {
	createRailAreaStampTemplate,
	initialRailAreaStampPose,
	rotateRailAreaStampPose,
} from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { issueReviewedPortEquipmentApply } from "../core/ReviewedPortEquipmentApplyCertification";
import { DIR_E, DIR_S, DIR_W } from "../core/railShape";
import { createStaticFabAssemblyRelationshipState } from "../core/StaticFabAssemblyRelationship";
import { createStaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";
import {
	compareDirectedRailEdges,
	copyStaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { validateStaticFabOrganizationActivation } from "../core/StaticFabOrganizationActivation";
import {
	planAssignStaticFabOrganizationFromSelection,
	planCreateStaticFabOrganizationFromSelection,
	planRemoveStaticFabOrganization,
	planRenameStaticFabOrganization,
	planUpdateStaticFabOrganizationDetails,
} from "../core/StaticFabOrganizationPlan";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { prepareBlueprintPlacement } from "./BlueprintPlacementRuntime";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	consumeRailMirrorSnapshotCaptureAuthority,
	RailChecksumAccumulator,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import { RailPatchMirror } from "./RailPatchMirror";
import { checksumRailPhysicalLayout, describeRailPhysicalPublication } from "./RailPhysicalLayout";
import { compileRailStartup } from "./RailStartupRuntime";
import {
	releaseValidatedRailStartupSnapshotForFullValidation,
	type ValidatedRailStartupSnapshotAuthority,
	validateAndHydrateRailStartupSnapshotCooperatively,
} from "./RailStartupSnapshotActivation";
import {
	adoptRailStartupTransportCooperatively,
	consumeRailStartupTransportAdoptionAuthority,
	type RailStartupTransportAdoptionAuthority,
} from "./RailStartupTransportContract";
import {
	createRailWorkerBridgeFromValidatedStartup,
	RailWorkerBridge,
	type RailWorkerBridgeState,
	type RailWorkerPort,
	railWorkerStateMatchesAuthoredReadyExpectation,
	railWorkerStateMatchesReadyExpectation,
} from "./RailWorkerBridge";
import {
	decodeRailPatchSoA,
	type MainToRailMirrorMessage,
	type RailMirrorToMainMessage,
	railMirrorSnapshotTransfers,
	staticFabOrganizationOutlineTransfers,
} from "./railMirrorProtocol";
import { STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS } from "./StaticFabOrganizationSoA";

describe("RailWorkerBridge", () => {
	it("ACKs operational configuration edit, undo, and redo through the live bridge", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const replacement = copyOperationalConfigurationState({
			...document.operationalConfiguration,
			stationCapabilities: [{ portId: 3, transferCapability: "DROPOFF_ONLY" }],
		});
		const plan = document.planOperationalConfigurationReplacement(replacement);
		if (!plan) throw new Error("Expected operational bridge plan fixture.");

		expect(document.commitOperationalConfiguration(plan)).toBe(true);
		const applied = await bridge.waitUntilReady(readyExpectation(document));
		expect(applied.operationalConfigurationRevision).toBe(1);
		expect(applied.operationalConfigurationFingerprint).toBe(
			checksumOperationalConfigurationState(document.operationalConfiguration),
		);
		expect(applied.physicalPublicationKind).toBe("static");

		expect(document.undo()).toBe(true);
		const undone = await bridge.waitUntilReady(readyExpectation(document));
		expect(undone.operationalConfigurationRevision).toBe(2);
		expect(document.redo()).toBe(true);
		const redone = await bridge.waitUntilReady(readyExpectation(document));
		expect(redone.operationalConfigurationRevision).toBe(3);
		expect(redone.operationalConfigurationFingerprint).toBe(
			checksumOperationalConfigurationState(document.operationalConfiguration),
		);

		const beforeReviewFingerprint = redone.operationalConfigurationFingerprint;
		const reviewPlan = document.planOperationalConfigurationReplacement(
			reviewOperationalConfiguration(document.operationalConfiguration, {
				revision: document.map.getRevision(),
				authoredChecksum: redone.checksum,
			}),
		);
		if (!reviewPlan) throw new Error("Expected operational review bridge plan fixture.");
		expect(document.commitOperationalConfiguration(reviewPlan)).toBe(true);
		const reviewed = await bridge.waitUntilReady(readyExpectation(document));
		expect(reviewed.operationalConfigurationRevision).toBe(3);
		expect(reviewed.operationalConfigurationFingerprint).not.toBe(beforeReviewFingerprint);
		expect(reviewed.operationalConfigurationFingerprint).toBe(
			checksumOperationalConfigurationState(document.operationalConfiguration),
		);
		expect(document.undo()).toBe(true);
		const reviewUndone = await bridge.waitUntilReady(readyExpectation(document));
		expect(reviewUndone.operationalConfigurationRevision).toBe(3);
		expect(reviewUndone.operationalConfigurationFingerprint).toBe(beforeReviewFingerprint);
		expect(states.at(-1)?.status).toBe("ready");
		bridge.dispose();
	});

	it("captures a fresh source-bound organization outline from the ready mirror", async () => {
		const semanticFixture = createSemanticOrganizationDocument();
		const document = semanticFixture.document;
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		const ready = await bridge.waitUntilReady(readyExpectation(document));

		const outline = await bridge.captureCurrentOrganizationOutline();
		expect(port.organizationOutlineCaptureCount).toBe(1);
		expect(port.organizationOutlineTransferCount).toBe(8);
		expect(outline).toMatchObject({
			sourceSequence: document.getPatchSequence(),
			sourceRevision: document.map.getRevision(),
			sourceChecksum: checksumRailMap(document.map, document.portEquipment, document.organizations),
			sourcePhysicalSequence: ready.physicalSequence,
			sourcePhysicalRevision: ready.physicalRevision,
			sourcePhysicalFingerprint: ready.physicalFingerprint,
			organizationCount: 3,
		});
		expect(Array.from({ length: 3 }, (_, row) => outline.readOrganizationRole(row))).toEqual([
			"FAB",
			"BAY_BANK",
			"BAY",
		]);
		const hitRows = new Int32Array(outline.organizationCount);
		expect(
			outline.queryPoint(semanticFixture.bayPoint.x, semanticFixture.bayPoint.z, hitRows),
		).toBe(1);
		expect(hitRows[0]).toBe(2);
		const second = await bridge.captureCurrentOrganizationOutline();
		expect(second).not.toBe(outline);
		expect(port.organizationOutlineCaptureCount).toBe(2);

		const rename = planRenameStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			3,
			"Renamed Production Bay",
		);
		expect(document.commitOrganization(rename)).toBe(true);
		const renamedReady = await bridge.waitUntilReady(readyExpectation(document));
		expect(renamedReady.physicalFingerprint).toBe(ready.physicalFingerprint);
		const renamed = await bridge.captureCurrentOrganizationOutline();
		expect(renamed.sourceSequence).toBe(outline.sourceSequence + 1);
		expect(renamed.sourceChecksum).not.toBe(outline.sourceChecksum);
		expect(renamed.sourcePhysicalFingerprint).toBe(outline.sourcePhysicalFingerprint);
		expect(renamed.organizationCount).toBe(3);
		expect(bridge.getState()).toMatchObject({ status: "ready", epoch: 1 });
		bridge.dispose();
	});

	it("rejects a malformed organization outline without replacing the healthy mirror", async () => {
		const document = new RailDocument();
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const worker = workers[0] as InProcessRailWorker;
		worker.corruptNextOrganizationOutlineCapture = true;

		await expect(bridge.captureCurrentOrganizationOutline()).rejects.toThrow(
			/stale|malformed|fingerprint/i,
		);
		expect(workers).toHaveLength(1);
		expect(worker.terminated).toBe(false);
		expect(bridge.getState()).toMatchObject({ status: "ready", epoch: 1 });
		await expect(bridge.captureCurrentOrganizationOutline()).resolves.toMatchObject({
			organizationCount: 0,
		});
		bridge.dispose();
	});

	it("abandons a cancelled outline while accepting the healthy late Worker response", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const controller = new AbortController();
		const pending = bridge.captureCurrentOrganizationOutline(controller.signal);
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		await flushWorkerMessages();
		expect(bridge.getState()).toMatchObject({ status: "ready", epoch: 1 });
		expect(port.terminated).toBe(false);
		await expect(bridge.captureCurrentOrganizationOutline()).resolves.toMatchObject({
			organizationCount: 0,
		});
		bridge.dispose();
	});

	it("replaces a Worker only when an outline request makes no progress through its watchdog", async () => {
		const document = new RailDocument();
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const blocked = workers[0] as InProcessRailWorker;
		blocked.blockNextOrganizationOutlineCapture = true;

		vi.useFakeTimers();
		try {
			const outcome = bridge.captureCurrentOrganizationOutline().then(
				() => null,
				(error: unknown) => error,
			);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(await outcome).toMatchObject({
				message: expect.stringMatching(/timed out/i),
			});
			const recovered = await bridge.waitUntilReady(readyExpectation(document));
			expect(recovered).toMatchObject({ status: "ready", epoch: 2 });
			expect(workers).toHaveLength(2);
			expect(blocked.terminated).toBe(true);
			await expect(bridge.captureCurrentOrganizationOutline()).resolves.toMatchObject({
				organizationCount: 0,
			});
		} finally {
			vi.useRealTimers();
		}
		bridge.dispose();
	});

	it("rejects a stale outline locally while the same Worker applies the following patch", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const pending = bridge.captureCurrentOrganizationOutline();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);

		await expect(pending).rejects.toThrow(/stale|changed/i);
		const ready = await bridge.waitUntilReady(readyExpectation(document));
		expect(ready).toMatchObject({ status: "ready", epoch: 1, sequence: 1 });
		expect(port.terminated).toBe(false);
		await expect(bridge.captureCurrentOrganizationOutline()).resolves.toMatchObject({
			sourceSequence: 1,
			sourceRevision: document.map.getRevision(),
		});
		bridge.dispose();
	});

	it("bounds outline work independently from snapshots and clears an abandoned watchdog on ACK", async () => {
		vi.useFakeTimers();
		try {
			const document = new RailDocument();
			const workers: InProcessRailWorker[] = [];
			const bridge = new RailWorkerBridge(
				document,
				() => undefined,
				() => {
					const worker = new InProcessRailWorker();
					workers.push(worker);
					return worker;
				},
			);
			await bridge.waitUntilReady(readyExpectation(document));
			const worker = workers[0] as InProcessRailWorker;
			worker.dropNextOrganizationOutlineResponse = true;
			const controller = new AbortController();
			const pendingOutline = bridge.captureCurrentOrganizationOutline(controller.signal);
			await expect(bridge.captureCurrentOrganizationOutline()).rejects.toThrow(/bounded capacity/i);
			await expect(bridge.captureCurrentSnapshot()).resolves.toMatchObject({
				sequence: 0,
			});

			controller.abort();
			await expect(pendingOutline).rejects.toMatchObject({
				name: "AbortError",
			});
			expect(
				document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
			).toBe(true);
			await bridge.waitUntilReady(readyExpectation(document));
			await vi.advanceTimersByTimeAsync(30_000);

			expect(workers).toHaveLength(1);
			expect(worker.terminated).toBe(false);
			expect(bridge.getState()).toMatchObject({
				status: "ready",
				epoch: 1,
				sequence: 1,
			});
			bridge.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("hands off one fresh source-bound snapshot from the ready authoritative mirror", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));

		const snapshot = await bridge.captureCurrentSnapshot();
		expect(port.snapshotCaptureCount).toBe(1);
		expect(snapshot).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		});
		expect(snapshot.xs).toBeInstanceOf(Int32Array);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(true);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(false);
		bridge.dispose();
	});

	it("binds the exact relationship cursor through sync state and snapshot handoff", async () => {
		const empty = new RailDocument();
		const relationships = createStaticFabAssemblyRelationshipState({
			nextRelationshipId: 7,
			records: [],
		});
		const document = RailDocument.fromLoadedMap(
			empty.map,
			empty.getPatchSequence(),
			empty.portEquipment,
			empty.organizations,
			empty.operationalConfiguration,
			relationships,
		);
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => new InProcessRailWorker(),
		);

		const ready = await bridge.waitUntilReady(readyExpectation(document));
		expect(ready).toMatchObject({
			targetAssemblyRelationships: 0,
			targetAssemblyRelationshipNextId: 7,
			assemblyRelationships: 0,
			assemblyRelationshipNextId: 7,
		});
		const snapshot = await bridge.captureCurrentSnapshot();
		expect(snapshot.relationships.nextRelationshipId).toBe(7);
		expect(
			consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			),
		).toBe(true);
		bridge.dispose();
	});

	it("revokes an aborted healthy capture without replacing its synchronized Worker", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const worker = workers[0] as InProcessRailWorker;
		const controller = new AbortController();

		vi.useFakeTimers();
		try {
			const aborted = bridge.captureCurrentSnapshot(controller.signal);
			controller.abort();
			await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
			await flushWorkerMessages();
			await vi.advanceTimersByTimeAsync(30_000);
			expect(bridge.getState()).toMatchObject({
				status: "ready",
				epoch: 1,
				simulationReady: false,
			});
			expect(workers).toHaveLength(1);
			expect(worker.terminated).toBe(false);
			await expect(bridge.captureCurrentSnapshot()).resolves.toMatchObject({
				sequence: document.getPatchSequence(),
				revision: document.map.getRevision(),
			});
		} finally {
			vi.useRealTimers();
		}
		bridge.dispose();
	});

	it("replaces an aborted blocked capture when its abandoned watchdog expires", async () => {
		const document = new RailDocument();
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const blockedWorker = workers[0] as InProcessRailWorker;
		blockedWorker.blockNextSnapshotCapture = true;
		const controller = new AbortController();

		vi.useFakeTimers();
		try {
			const aborted = bridge.captureCurrentSnapshot(controller.signal);
			await flushWorkerMessages();
			controller.abort();
			await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
			await vi.advanceTimersByTimeAsync(30_000);
			const recovered = await bridge.waitUntilReady(readyExpectation(document));
			expect(recovered).toMatchObject({
				status: "ready",
				epoch: 2,
				simulationReady: false,
			});
			expect(workers).toHaveLength(2);
			expect(blockedWorker.terminated).toBe(true);
		} finally {
			vi.useRealTimers();
		}
		bridge.dispose();
	});

	it("rejects a pending snapshot handoff when the bridge is disposed", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));

		const pending = bridge.captureCurrentSnapshot();
		bridge.dispose();

		await expect(pending).rejects.toThrow(/disposed/i);
		expect(port.terminated).toBe(true);
	});

	it("replaces a blocked mirror after snapshot timeout and retries on the new Worker", async () => {
		const document = new RailDocument();
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const blockedWorker = workers[0] as InProcessRailWorker;
		blockedWorker.blockNextSnapshotCapture = true;

		vi.useFakeTimers();
		try {
			const outcome = bridge.captureCurrentSnapshot().then(
				() => null,
				(error: unknown) => error,
			);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(await outcome).toMatchObject({
				message: expect.stringMatching(/timed out/i),
			});
			const recovered = await bridge.waitUntilReady(readyExpectation(document));
			expect(recovered).toMatchObject({
				status: "ready",
				epoch: 2,
				simulationReady: false,
			});
			expect(workers).toHaveLength(2);
			expect(blockedWorker.terminated).toBe(true);
			await expect(bridge.captureCurrentSnapshot()).resolves.toMatchObject({
				sequence: document.getPatchSequence(),
			});
		} finally {
			vi.useRealTimers();
		}

		bridge.dispose();
	});

	it("bounds concurrent captures and rejects every waiter when a blocked Worker is replaced", async () => {
		const document = new RailDocument();
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const blockedWorker = workers[0] as InProcessRailWorker;
		blockedWorker.blockNextSnapshotCapture = true;

		vi.useFakeTimers();
		try {
			const outcomes = Array.from({ length: 4 }, () =>
				bridge.captureCurrentSnapshot().then(
					() => null,
					(error: unknown) => error,
				),
			);
			await expect(bridge.captureCurrentSnapshot()).rejects.toThrow(/bounded capacity/i);
			await flushWorkerMessages();
			await vi.advanceTimersByTimeAsync(30_000);
			for (const outcome of await Promise.all(outcomes)) {
				expect(outcome).toMatchObject({
					message: expect.stringMatching(/timed out/i),
				});
			}
			const recovered = await bridge.waitUntilReady(readyExpectation(document));
			expect(recovered).toMatchObject({
				status: "ready",
				epoch: 2,
				simulationReady: false,
			});
			expect(workers).toHaveLength(2);
			expect(blockedWorker.terminated).toBe(true);
		} finally {
			vi.useRealTimers();
		}
		bridge.dispose();
	});

	it("replaces a blocked stale capture when its abandoned watchdog expires", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const blockedWorker = workers[0] as InProcessRailWorker;
		blockedWorker.blockNextSnapshotCapture = true;

		vi.useFakeTimers();
		try {
			const pending = bridge.captureCurrentSnapshot();
			await flushWorkerMessages();
			expect(
				document.commit(planRailConstruction(document.map, { x: 8, y: 0 }, { x: 12, y: 0 })),
			).toBe(true);
			await expect(pending).rejects.toThrow(/stale|changed/i);
			expect(bridge.getState()).toMatchObject({
				status: "syncing",
				simulationReady: false,
			});
			await vi.advanceTimersByTimeAsync(30_000);
			const recovered = await bridge.waitUntilReady(readyExpectation(document));
			expect(recovered).toMatchObject({
				status: "ready",
				epoch: 2,
				simulationReady: false,
			});
			expect(workers).toHaveLength(2);
			expect(blockedWorker.terminated).toBe(true);
		} finally {
			vi.useRealTimers();
		}
		bridge.dispose();
	});

	it("replaces and resynchronizes a mirror that diverges during authoritative capture", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const failedWorker = workers[0] as InProcessRailWorker;
		failedWorker.internalErrorNextSnapshotCapture = true;

		await expect(bridge.captureCurrentSnapshot()).rejects.toThrow(/diverged/i);
		const recovered = await bridge.waitUntilReady(readyExpectation(document));

		expect(recovered).toMatchObject({
			status: "ready",
			epoch: 2,
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			simulationReady: false,
		});
		expect(workers).toHaveLength(2);
		expect(failedWorker.terminated).toBe(true);
		bridge.dispose();
	});

	it("rejects a malformed active capture response and resynchronizes a replacement mirror", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const failedWorker = workers[0] as InProcessRailWorker;
		failedWorker.corruptNextSnapshotCapture = true;

		await expect(bridge.captureCurrentSnapshot()).rejects.toThrow(/stale|malformed/i);
		const recovered = await bridge.waitUntilReady(readyExpectation(document));

		expect(recovered).toMatchObject({
			status: "ready",
			epoch: 2,
			simulationReady: false,
		});
		expect(workers).toHaveLength(2);
		expect(failedWorker.terminated).toBe(true);
		bridge.dispose();
	});

	it("rejects nested malformed snapshot columns and replaces the active mirror", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const workers: InProcessRailWorker[] = [];
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => {
				const worker = new InProcessRailWorker();
				workers.push(worker);
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const failedWorker = workers[0] as InProcessRailWorker;
		failedWorker.corruptNestedSnapshotCapture = true;

		await expect(bridge.captureCurrentSnapshot()).rejects.toThrow(/stale|malformed/i);
		const recovered = await bridge.waitUntilReady(readyExpectation(document));

		expect(recovered).toMatchObject({
			status: "ready",
			epoch: 2,
			simulationReady: false,
		});
		expect(workers).toHaveLength(2);
		expect(failedWorker.terminated).toBe(true);
		bridge.dispose();
	});

	it("includes the organization ID cursor in authored checksum identity", () => {
		const document = new RailDocument();
		const initial = checksumRailMap(document.map, document.portEquipment, {
			nextOrganizationId: 1,
			records: [],
		});
		const advanced = checksumRailMap(document.map, document.portEquipment, {
			nextOrganizationId: 2,
			records: [],
		});

		expect(advanced).not.toBe(initial);
		expect(RailChecksumAccumulator.fromDigest(initial).organizationNextId).toBe(1);
		expect(RailChecksumAccumulator.fromDigest(advanced).organizationNextId).toBe(2);
	});

	it("sends AREA rename and removal without membership coordinates", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 24, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 25, y: 1 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		expect(
			document.commitOrganization(
				planCreateStaticFabOrganizationFromSelection(
					document.map,
					ownership,
					document.portEquipment,
					document.getPatchSequence(),
					document.organizations,
					selection,
					"Factory Area",
				),
			),
		).toBe(true);

		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const rename = planRenameStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			1,
			"North Factory Area",
		);
		expect(document.commitOrganization(rename)).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.lastOrganizationOperationCodes).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.RENAME,
		]);
		expect(port.lastOrganizationCoordinateCount).toBe(0);

		const remove = planRemoveStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			1,
		);
		expect(document.commitOrganization(remove)).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.lastOrganizationOperationCodes).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.REMOVE,
		]);
		expect(port.lastOrganizationCoordinateCount).toBe(0);
		bridge.dispose();
	});

	it("ACKs relationship and property edits as metadata-only patches through undo and redo", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 24, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		for (const [name, kind] of [
			["Factory Area", "AREA"],
			["Photo Bay", "BAY"],
		] as const) {
			const selection = createStaticFabSelection(
				createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 25, y: 1 }),
				document.portEquipment,
				document.getPatchSequence(),
				[],
			);
			const create = planCreateStaticFabOrganizationFromSelection(
				document.map,
				ownership,
				document.portEquipment,
				document.getPatchSequence(),
				document.organizations,
				selection,
				name,
				kind,
			);
			expect(create.valid, create.reason).toBe(true);
			expect(document.commitOrganization(create)).toBe(true);
		}

		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const physicalBefore = port.mirror.getPhysicalPublication().current.buffers;
		const membershipBefore = port.mirror.organizationState.records[1]?.membership;
		const update = planUpdateStaticFabOrganizationDetails(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			2,
			{
				parentOrganizationIds: [1],
				description: "Photo process production bay",
				color: "AMBER",
			},
		);
		expect(update.valid, update.reason).toBe(true);
		expect(document.commitOrganization(update)).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));

		expect(port.lastOrganizationOperationCodes).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.METADATA,
		]);
		expect(port.lastOrganizationCoordinateCount).toBe(0);
		expect(port.mirror.organizationState.records[1]).toMatchObject({
			parentOrganizationIds: [1],
			properties: {
				description: "Photo process production bay",
				color: "AMBER",
			},
		});
		expect(port.mirror.organizationState.records[1]?.membership).toBe(membershipBefore);
		expect(port.mirror.getPhysicalPublication().current.buffers).toBe(physicalBefore);

		expect(document.undo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.lastOrganizationOperationCodes).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.METADATA,
		]);
		expect(port.mirror.organizationState.records[1]?.parentOrganizationIds).toEqual([]);
		expect(document.redo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.mirror.organizationState.records[1]?.parentOrganizationIds).toEqual([1]);
		expect(port.syncCount).toBe(1);
		bridge.dispose();
	});

	it("transfers same-kind membership assignment through Worker ACK, undo, and redo", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 24, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const midpoint = Math.floor(ownership.modules.length / 2);
		const sourceModules = ownership.modules.slice(0, midpoint);
		const targetModules = ownership.modules.slice(midpoint);
		expect(sourceModules.length).toBeGreaterThan(0);
		expect(targetModules.length).toBeGreaterThan(0);
		const selectionFor = (modules: typeof sourceModules) =>
			createStaticFabSelection(
				createRailAreaSelectionFromOwnerships(ownership, modules, "fully-contained"),
				document.portEquipment,
				document.getPatchSequence(),
				[],
			);
		for (const [modules, name] of [
			[sourceModules, "Source Area"],
			[targetModules, "Target Area"],
		] as const) {
			const create = planCreateStaticFabOrganizationFromSelection(
				document.map,
				ownership,
				document.portEquipment,
				document.getPatchSequence(),
				document.organizations,
				selectionFor(modules),
				name,
			);
			expect(create.valid, create.reason).toBe(true);
			expect(document.commitOrganization(create)).toBe(true);
		}

		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const physicalBefore = port.mirror.getPhysicalPublication().current.buffers;
		const assign = planAssignStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			selectionFor(sourceModules),
			{
				kind: "AREA",
				organizationId: 2,
				name: "ignored",
				sourceOwners: [{ organizationId: 1, emptyDisposition: "remove" }],
			},
		);
		expect(assign.valid, assign.reason).toBe(true);
		expect(document.commitOrganization(assign)).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.lastOrganizationOperationCodes).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.REMOVE,
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA,
		]);
		expect(port.lastOrganizationCoordinateCount).toBeGreaterThan(0);
		expect(port.mirror.organizationState.records).toHaveLength(1);
		expect(port.mirror.organizationState.records[0]?.name).toBe("Target Area");
		expect(port.mirror.organizationState.records[0]?.membership).toBe(
			port.lastDecodedOrganizationAfterMemberships.get(2),
		);
		expect(port.mirror.getPhysicalPublication().current.buffers).toBe(physicalBefore);

		expect(document.undo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.lastOrganizationOperationCodes).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.FULL,
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA,
		]);
		expect(port.mirror.organizationState.records.map((record) => record.name)).toEqual([
			"Source Area",
			"Target Area",
		]);
		expect(port.mirror.getPhysicalPublication().current.buffers).toBe(physicalBefore);

		expect(document.redo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.lastOrganizationOperationCodes).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.REMOVE,
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.MEMBERSHIP_DELTA,
		]);
		expect(port.mirror.organizationState.records).toHaveLength(1);
		expect(port.mirror.getPhysicalPublication().current.buffers).toBe(physicalBefore);
		const assignedMembership = port.mirror.organizationState.records[0]?.membership;
		const rename = planRenameStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			2,
			"Merged Area",
		);
		expect(document.commitOrganization(rename)).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.lastOrganizationOperationCodes).toEqual([
			STATIC_FAB_ORGANIZATION_PATCH_OPERATIONS.RENAME,
		]);
		expect(port.lastOrganizationCoordinateCount).toBe(0);
		expect(port.mirror.organizationState.records[0]?.membership).toBe(assignedMembership);
		expect(port.syncCount).toBe(1);
		bridge.dispose();
	});

	it.each([
		["Process Bank", "process-bank", 0],
		["Process Block", "process-block", 1],
		["Whole FAB", "factory", 3],
	] as const)(
		"ACKs %s placement, undo, and redo as three typed patches",
		async (_scopeLabel, scope, quarterTurn) => {
			const source = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
			const sourceOwnership = buildRailModuleOwnershipIndex(source.document.map);
			const branch = compileStaticFabHierarchyIndex(source.document.map, sourceOwnership)
				.branches[0];
			if (!branch) throw new Error("expected generated Factory hierarchy");
			const hierarchyNode =
				scope === "process-bank"
					? branch.processBanks[0]
					: scope === "process-block"
						? branch.processBlocks[0]
						: branch.factory;
			if (!hierarchyNode) throw new Error(`expected generated ${scope}`);
			const railTemplate = createRailAreaStampTemplate(hierarchyNode.selection);
			let pose = initialRailAreaStampPose();
			for (let rotation = 0; rotation < quarterTurn; rotation++) {
				pose = rotateRailAreaStampPose(pose, 1);
			}
			const document = new RailDocument();
			const port = new InProcessRailWorker();
			const states: RailWorkerBridgeState[] = [];
			const bridge = new RailWorkerBridge(
				document,
				(state) => states.push(state),
				() => port,
			);
			await bridge.waitUntilReady(readyExpectation(document));

			const prepared = prepareBlueprintPlacement({
				type: "PREPARE_BLUEPRINT_PLACEMENT",
				requestId: 1,
				snapshot: captureRailMirrorSnapshot(
					document.map,
					document.getPatchSequence(),
					document.portEquipment,
				).snapshot,
				railTemplate,
				staticFabTemplate: null,
				anchor: { x: 1_000, y: 1_000 },
				pose,
			});
			expect(prepared.valid, prepared.reason).toBe(true);
			expect(document.commit(structuredClone(prepared).plan)).toBe(true);
			const committed = await bridge.waitUntilReady(readyExpectation(document));
			expect(committed.physicalFingerprint).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);
			expect(states.at(-1)).toMatchObject({
				status: "ready",
				simulationReady: false,
				sequence: 1,
				checksum: checksumRailMap(document.map, document.portEquipment),
			});

			expect(document.undo()).toBe(true);
			const undone = await bridge.waitUntilReady(readyExpectation(document));
			expect(undone.physicalFingerprint).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);
			expect(states.at(-1)).toMatchObject({
				status: "ready",
				simulationReady: false,
				sequence: 2,
				checksum: checksumRailMap(document.map, document.portEquipment),
			});

			expect(document.redo()).toBe(true);
			const redone = await bridge.waitUntilReady(readyExpectation(document));
			expect(redone.physicalFingerprint).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);
			expect(states.at(-1)).toMatchObject({
				status: "ready",
				simulationReady: false,
				sequence: 3,
				checksum: checksumRailMap(document.map, document.portEquipment),
			});
			expect(port.syncCount).toBe(1);
			bridge.dispose();
		},
		120_000,
	);

	it("ACKs one mixed rail and equipment blueprint as an atomic static command", async () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 8, y: 0 }))).toBe(
			true,
		);
		expect(source.commitPortEquipment(ohbPlan(source))).toBe(true);
		const sourceOwnership = buildRailModuleOwnershipIndex(source.map);
		const railSelection = createRailAreaSelection(
			sourceOwnership,
			{ x: 0, y: 0 },
			{ x: 8, y: 0 },
			"fully-contained",
		);
		const staticFabTemplate = createStaticFabBlueprintTemplate(
			createStaticFabSelection(railSelection, source.portEquipment, source.getPatchSequence(), [1]),
		);
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const prepared = prepareBlueprintPlacement({
			type: "PREPARE_BLUEPRINT_PLACEMENT",
			requestId: 1,
			snapshot: captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
			).snapshot,
			railTemplate: staticFabTemplate.rail,
			staticFabTemplate,
			anchor: { x: 100, y: 100 },
			pose: initialRailAreaStampPose(),
		});
		const staticPlan = structuredClone(prepared.plan);
		if (!("portMutations" in staticPlan)) throw new Error("expected static FAB mutation plan");

		expect(prepared.valid, prepared.reason).toBe(true);
		expect(document.commitStaticFab(staticPlan)).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			simulationReady: false,
			sequence: 1,
			ports: 1,
			equipmentGroups: 1,
		});

		expect(document.undo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			simulationReady: false,
			sequence: 2,
			ports: 0,
			equipmentGroups: 0,
		});

		expect(document.redo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			simulationReady: false,
			sequence: 3,
			ports: 1,
			equipmentGroups: 1,
		});
		expect(port.syncCount).toBe(1);
		bridge.dispose();
	});

	it("bootstraps the canonical large FAB sequence and mirrors its first authored patch", async () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const document = build.document;
		const bootstrapSequence = build.steps.length;
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot;
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
			snapshot,
		);
		await flushWorkerMessages();
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			simulationReady: false,
			sequence: bootstrapSequence,
		});

		expect(document.undo()).toBe(true);
		await flushWorkerMessages();
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			simulationReady: false,
			sequence: bootstrapSequence + 1,
			revision: document.map.getRevision(),
		});
		expect(port.syncCount).toBe(1);
		bridge.dispose();
	}, 60_000);

	it("uses a bootstrap snapshot directly and continues with the next patch sequence", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
			snapshot,
		);
		expect(port.initialSyncSnapshot).toBe(snapshot);
		await flushWorkerMessages();
		expect(states.at(-1)).toMatchObject({ status: "ready", sequence: 1 });

		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 4, y: 4 })),
		).toBe(true);
		await flushWorkerMessages();
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			sequence: 2,
			revision: document.map.getRevision(),
		});
		expect(port.syncCount).toBe(1);
		bridge.dispose();
	});

	it("acknowledges port-only commands as static publications without changing rail geometry", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await flushWorkerMessages();
		const before = states.at(-1);
		if (!before) throw new Error("expected initial Worker acknowledgement");
		const railRevision = document.map.getRevision();

		expect(document.commitPortEquipment(ohbPlan(document))).toBe(true);
		await flushWorkerMessages();

		expect(states.at(-1)).toMatchObject({
			status: "ready",
			simulationReady: false,
			sequence: document.getPatchSequence(),
			revision: railRevision,
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 1,
			equipmentGroups: 1,
			physicalPublicationKind: "static",
			physicalRevision: railRevision,
			physicalFingerprint: before.physicalFingerprint,
			previousPhysicalSequence: before.physicalSequence,
			previousPhysicalFingerprint: before.physicalFingerprint,
			migrationAvailable: false,
		});
		expect(port.typedPatchTransferCount).toBe(163);
		bridge.dispose();
	});

	it("spends a cooperatively prepared reviewed-Apply packet on the exact published event", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const worker = new InProcessRailWorker();
		const events: Parameters<Parameters<RailDocument["subscribe"]>[0]>[0][] = [];
		document.subscribe((event) => events.push(event));
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => worker,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		const plan = certifiedOhbPlan(document);
		const handle = issueReviewedPortEquipmentApply(
			plan,
			document.map,
			document.portEquipment,
			document.organizations,
			document.getPatchSequence(),
		);
		let preparedEvent: (typeof events)[number] | null = null;
		let checkpoints = 0;
		let tick = 0;

		const committed = await document.commitReviewedPortEquipmentCooperatively(handle, {
			checkpoint: async () => {
				checkpoints++;
			},
			now: () => ++tick,
			sliceMilliseconds: 1,
			preparePatch: async (event, checkpoint) => {
				preparedEvent = event;
				await bridge.prepareReviewedPortEquipmentPatchCooperatively(event, checkpoint, 1);
			},
		});

		expect(committed.committed).toBe(true);
		expect(committed.timings?.patchPreparationMilliseconds).toBeGreaterThanOrEqual(0);
		expect(events.at(-1)).toBe(preparedEvent);
		expect(checkpoints).toBeGreaterThan(0);
		const ready = await bridge.waitUntilReady(readyExpectation(document));
		expect(ready).toMatchObject({
			status: "ready",
			ports: 1,
			equipmentGroups: 1,
		});
		expect(worker.typedPatchTransferCount).toBe(163);
		expect(worker.syncCount).toBe(1);
		expect(worker.mirror.captureSnapshot()).toEqual(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot,
		);
		bridge.dispose();
	});

	it("mirrors one reviewed equipment batch through commit, undo, and redo without resync", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const port = new InProcessRailWorker();
		const events: Parameters<Parameters<RailDocument["subscribe"]>[0]>[0][] = [];
		document.subscribe((event) => events.push(event));
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		const baseline = await bridge.waitUntilReady(readyExpectation(document));
		const baselineMessageCount = port.messageCount;
		const plan = reviewedMixedBatchPlan(document);

		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commitPortEquipment(plan)).toBe(true);
		const committed = await bridge.waitUntilReady(readyExpectation(document));
		expect(committed).toMatchObject({
			status: "ready",
			simulationReady: false,
			ports: 2,
			equipmentGroups: 2,
			physicalFingerprint: baseline.physicalFingerprint,
		});
		expect(port.messageCount).toBe(baselineMessageCount + 1);
		expect(port.typedPatchTransferCount).toBe(163);
		expect(port.syncCount).toBe(1);
		expect(port.mirror.captureSnapshot()).toEqual(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot,
		);
		expect(events[0]).toMatchObject({ kind: "place-port-equipment-batch" });

		expect(document.undo()).toBe(true);
		const undone = await bridge.waitUntilReady(readyExpectation(document));
		expect(undone).toMatchObject({
			status: "ready",
			simulationReady: false,
			ports: 0,
			equipmentGroups: 0,
			physicalFingerprint: baseline.physicalFingerprint,
		});
		expect(events[1]).toMatchObject({
			kind: "undo",
			historyOriginKind: "place-port-equipment-batch",
		});
		expect(port.syncCount).toBe(1);
		expect(port.mirror.captureSnapshot()).toEqual(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot,
		);

		expect(document.redo()).toBe(true);
		const redone = await bridge.waitUntilReady(readyExpectation(document));
		expect(redone).toMatchObject({
			status: "ready",
			simulationReady: false,
			ports: 2,
			equipmentGroups: 2,
			physicalFingerprint: baseline.physicalFingerprint,
		});
		expect(events[2]).toMatchObject({
			kind: "redo",
			historyOriginKind: "place-port-equipment-batch",
		});
		expect(port.messageCount).toBe(baselineMessageCount + 3);
		expect(port.syncCount).toBe(1);
		expect(port.mirror.captureSnapshot()).toEqual(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot,
		);
		bridge.dispose();
	});

	it("preserves a retired high switch id cursor through bootstrap and the next patch", async () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: -4, y: 0 }, { x: 0, y: 0 }))).toBe(
			true,
		);
		const retired = {
			id: 17,
			profileClass: "A" as const,
			origin: { x: 100, y: 100 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		} satisfies AdvancedSwitchRecord;
		expect(source.map.setAdvancedSwitch(retired)).toBe(true);
		expect(source.map.deleteAdvancedSwitch(retired.id)).toBe(true);
		expect(source.map.getAdvancedSwitchIdCursor()).toBe(18);
		const snapshot = captureRailMirrorSnapshot(source.map, source.getPatchSequence()).snapshot;
		const document = RailDocument.fromLoadedMap(source.map.clone(), source.getPatchSequence());
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
			snapshot,
		);
		await flushWorkerMessages();

		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: -2 }, "A");
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.switchMutations?.[0]?.after?.id).toBe(18);
		expect(document.commit(plan)).toBe(true);
		await flushWorkerMessages();
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			sequence: source.getPatchSequence() + 1,
			switches: 1,
			physicalAdvancedSwitchCount: 1,
		});
		bridge.dispose();
	});

	it("rejects a bootstrap identity mismatch before creating a Worker", () => {
		const document = new RailDocument();
		const snapshot = captureRailMirrorSnapshot(document.map, 0).snapshot;
		let workerCreated = false;
		expect(
			() =>
				new RailWorkerBridge(
					document,
					() => undefined,
					() => {
						workerCreated = true;
						return new InProcessRailWorker();
					},
					{ ...snapshot, revision: 1 },
				),
		).toThrow("does not match");
		expect(workerCreated).toBe(false);
	});

	it("spends an exact validated startup authority without rescanning the source map", async () => {
		const { document, authority } = await createValidatedStartupSnapshotFixture(33);
		const railTraversal = vi.spyOn(document.map, "forEachRail");
		const port = new InProcessRailWorker();
		let bridge: RailWorkerBridge | null = null;
		try {
			bridge = createRailWorkerBridgeFromValidatedStartup(
				document,
				() => undefined,
				authority,
				undefined,
				() => port,
			);
			expect(railTraversal).not.toHaveBeenCalled();
		} finally {
			railTraversal.mockRestore();
		}
		if (!bridge) throw new Error("Expected the validated startup bridge.");
		await flushWorkerMessages();
		expect(bridge.getState()).toMatchObject({ status: "ready", cells: 33 });
		bridge.dispose();
	});

	it("does not let a foreign document spend an exact validated startup authority", async () => {
		const { document: source, authority } = await createValidatedStartupSnapshotFixture(5);
		const foreign = RailDocument.fromLoadedMap(source.map.clone(), source.getPatchSequence());
		let workerCreated = false;

		expect(() =>
			createRailWorkerBridgeFromValidatedStartup(
				foreign,
				() => undefined,
				authority,
				undefined,
				() => {
					workerCreated = true;
					return new InProcessRailWorker();
				},
			),
		).toThrow("lacks exact cooperative-validation provenance");
		expect(workerCreated).toBe(false);
	});

	it("rejects a fabricated startup validation authority", () => {
		const document = new RailDocument();
		expect(() =>
			createRailWorkerBridgeFromValidatedStartup(document, () => undefined, {
				token: Object.freeze({}),
			}),
		).toThrow("lacks exact cooperative-validation provenance");
	});

	it("spends transport adoption authority once when a Proxy alternates token reads", async () => {
		const adopted = await createAdoptedStartupTransportFixture(5);
		const realToken = adopted.authority.token;
		const decoyToken = Object.freeze({});
		let tokenReads = 0;
		const alternatingAuthority = new Proxy(
			{},
			{
				get(_target, property) {
					if (property === "token") {
						tokenReads++;
						return tokenReads === 1 ? realToken : decoyToken;
					}
					return undefined;
				},
			},
		) as RailStartupTransportAdoptionAuthority;

		expect(
			consumeRailStartupTransportAdoptionAuthority(
				alternatingAuthority,
				adopted.value,
				adopted.value.snapshot,
			),
		).toBe(true);
		expect(tokenReads).toBe(1);
		expect(
			consumeRailStartupTransportAdoptionAuthority(
				adopted.authority,
				adopted.value,
				adopted.value.snapshot,
			),
		).toBe(false);
	});

	it("isolates validated snapshot ownership before hostile checkpoints and return", async () => {
		const adopted = await createAdoptedStartupTransportFixture(5);
		const sourceSnapshot = adopted.value.snapshot;
		const expectedChecksum = sourceSnapshot.checksum;
		const expectedFirstCell = sourceSnapshot.encoded[0];
		let checkpoints = 0;
		const validated = await validateAndHydrateRailStartupSnapshotCooperatively(
			sourceSnapshot,
			adopted.value,
			adopted.authority,
			async () => {
				checkpoints++;
				expect(sourceSnapshot.encoded.byteLength).toBe(0);
				sourceSnapshot.encoded[0] = 0;
				sourceSnapshot.checksum = "00000000:00000000";
			},
			() => undefined,
			1,
		);
		expect(checkpoints).toBeGreaterThan(0);
		expect(sourceSnapshot.encoded.byteLength).toBe(0);
		sourceSnapshot.encoded[0] = 0xff;
		const privateSnapshot = releaseValidatedRailStartupSnapshotForFullValidation(
			validated.authority,
			validated.map,
			validated.portEquipment,
			validated.organizations,
			validated.relationships,
		);
		expect(privateSnapshot).not.toBeNull();
		expect(privateSnapshot?.encoded[0]).toBe(expectedFirstCell);
		expect(privateSnapshot?.checksum).toBe(expectedChecksum);
	});

	it("spends validated snapshot authority once when a Proxy alternates token reads", async () => {
		const validated = await createValidatedStartupSnapshotFixture(5);
		const realToken = validated.authority.token;
		const decoyToken = Object.freeze({});
		let tokenReads = 0;
		const alternatingAuthority = new Proxy(
			{},
			{
				get(_target, property) {
					if (property === "token") {
						tokenReads++;
						return tokenReads === 1 ? realToken : decoyToken;
					}
					return undefined;
				},
			},
		) as ValidatedRailStartupSnapshotAuthority;

		expect(
			releaseValidatedRailStartupSnapshotForFullValidation(
				alternatingAuthority,
				validated.document.map,
				validated.document.portEquipment,
				validated.document.organizations,
				validated.document.relationships,
			),
		).not.toBeNull();
		expect(tokenReads).toBe(1);
		expect(
			releaseValidatedRailStartupSnapshotForFullValidation(
				validated.authority,
				validated.document.map,
				validated.document.portEquipment,
				validated.document.organizations,
				validated.document.relationships,
			),
		).toBeNull();
	});

	it("rejects a validated startup authority after a pre-transfer revision ABA rollback", async () => {
		const { document, authority } = await createValidatedStartupSnapshotFixture(5);
		const port = new InProcessRailWorker();
		const originalGeneration = document.map.getMutationGeneration();
		const originalRevision = document.map.getRevision();

		expect(() =>
			createRailWorkerBridgeFromValidatedStartup(
				document,
				() => undefined,
				authority,
				undefined,
				() => {
					const mutation = { x: 100, y: 100, before: 0, after: 0x11 };
					const checkpoint = document.map.createMutationCheckpoint();
					expect(document.map.applyAtomicMutations([mutation], [])).toBe(true);
					document.map.rollbackAtomicMutations([mutation], [], checkpoint);
					expect(document.map.getRevision()).toBe(originalRevision);
					expect(document.map.getEncoded(100, 100)).toBe(0);
					return port;
				},
			),
		).toThrow("became stale before transfer");
		expect(document.map.getMutationGeneration()).toBeGreaterThan(originalGeneration);
		expect(port.messageCount).toBe(0);
		expect(port.terminated).toBe(true);
	});

	it("rechecks validated startup cancellation immediately before transfer", async () => {
		const { document, authority } = await createValidatedStartupSnapshotFixture(5);
		let cancelled = false;
		const port = new InProcessRailWorker();

		expect(() =>
			createRailWorkerBridgeFromValidatedStartup(
				document,
				(state) => {
					if (state.status === "syncing") cancelled = true;
				},
				authority,
				() => {
					if (cancelled) {
						throw new DOMException("Cancelled before startup transfer.", "AbortError");
					}
				},
				() => port,
			),
		).toThrow("Cancelled before startup transfer");
		expect(port.messageCount).toBe(0);
		expect(port.terminated).toBe(true);
	});

	it("rejects a same-revision bootstrap from a different document map", () => {
		const active = new RailDocument();
		const foreign = new RailDocument();
		expect(active.commit(planRailConstruction(active.map, { x: 0, y: 0 }, { x: 4, y: 0 }))).toBe(
			true,
		);
		expect(foreign.commit(planRailConstruction(foreign.map, { x: 0, y: 0 }, { x: 0, y: 4 }))).toBe(
			true,
		);
		expect(active.map.getRevision()).toBe(foreign.map.getRevision());
		const foreignSnapshot = captureRailMirrorSnapshot(
			foreign.map,
			foreign.getPatchSequence(),
		).snapshot;

		expect(
			() =>
				new RailWorkerBridge(
					active,
					() => undefined,
					() => new InProcessRailWorker(),
					foreignSnapshot,
				),
		).toThrow("active document identity");
	});

	it("rejects bootstrap buffers that do not match their checksum marker", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		snapshot.xs[0] = 99;
		expect(
			() =>
				new RailWorkerBridge(
					document,
					() => undefined,
					() => new InProcessRailWorker(),
					snapshot,
				),
		).toThrow("typed buffers");
	});

	it("rejects a bootstrap snapshot with a forged organization ID cursor", () => {
		const document = new RailDocument();
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		const forged: RailMirrorSnapshot = {
			...snapshot,
			organizations: {
				...snapshot.organizations,
				nextOrganizationId: snapshot.organizations.nextOrganizationId + 1,
			},
		};

		expect(
			() =>
				new RailWorkerBridge(
					document,
					() => undefined,
					() => new InProcessRailWorker(),
					forged,
				),
		).toThrow("typed buffers");
	});

	it("rejects bootstrap snapshots with forged port-equipment ID cursors", () => {
		const document = new RailDocument();
		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		const forgeries: readonly RailMirrorSnapshot[] = [
			{
				...snapshot,
				portEquipment: {
					...snapshot.portEquipment,
					nextPortId: snapshot.portEquipment.nextPortId + 1,
				},
			},
			{
				...snapshot,
				portEquipment: {
					...snapshot.portEquipment,
					nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId + 1,
				},
			},
		];

		for (const forged of forgeries) {
			expect(
				() =>
					new RailWorkerBridge(
						document,
						() => undefined,
						() => new InProcessRailWorker(),
						forged,
					),
			).toThrow("active document identity");
		}
	});

	it("does not ACK a patch whose organization cursor drifts without an organization mutation", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		port.corruptOrganizationCursorNextPatch = true;

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		await flushWorkerMessages(6);

		expect(
			states.some(
				(state) =>
					state.status === "desynced" && state.message?.includes("checksum mismatch") === true,
			),
		).toBe(true);
		expect(port.syncCount).toBe(2);
		bridge.dispose();
	});

	it("snapshot-recovers when an acknowledgement carries forged relationship identity", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		port.corruptAssemblyRelationshipIdentityNextPatch = true;

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		await flushWorkerMessages(6);

		expect(
			states.some(
				(state) => state.status === "desynced" && state.message?.includes("static entity identity"),
			),
		).toBe(true);
		expect(port.syncCount).toBe(2);
		bridge.dispose();
	});

	it("resolves the activation gate only for the expected authored and physical identity", async () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
			snapshot,
		);
		const expectedPhysicalFingerprint = checksumRailPhysicalLayout(
			compilePhysicalRail(document.map),
		);
		const expectation = {
			checksum: snapshot.checksum,
			physicalFingerprint: expectedPhysicalFingerprint,
			sequence: snapshot.sequence,
			revision: snapshot.revision,
		};
		const ready = await bridge.waitUntilReady(expectation);
		expect(ready).toMatchObject({
			status: "ready",
			checksum: snapshot.checksum,
		});
		expect(railWorkerStateMatchesReadyExpectation(ready, expectation)).toBe(true);
		for (const stale of [
			{ ...ready, targetChecksum: "forged-target" },
			{ ...ready, targetRevision: ready.targetRevision + 1 },
			{ ...ready, physicalSequence: ready.physicalSequence + 1 },
			{ ...ready, targetCells: ready.targetCells + 1 },
			{ ...ready, physicalValid: false },
		]) {
			expect(railWorkerStateMatchesReadyExpectation(stale, expectation)).toBe(false);
		}

		await expect(
			bridge.waitUntilReady({
				checksum: snapshot.checksum,
				physicalFingerprint: "deadbeef:00000000",
				sequence: snapshot.sequence,
				revision: snapshot.revision,
			}),
		).rejects.toThrow("does not match");
		bridge.dispose();
	});

	it("waits for one exact authored generation before its Worker-derived fingerprint is known", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const target = bridge.getState();
		expect(target).toMatchObject({
			status: "syncing",
			targetSequence: document.getPatchSequence(),
			targetRevision: document.map.getRevision(),
		});
		const expectation = {
			checksum: target.targetChecksum,
			sequence: target.targetSequence,
			revision: target.targetRevision,
		};
		const ready = await bridge.waitUntilAuthoredReady(expectation);

		expect(railWorkerStateMatchesAuthoredReadyExpectation(ready, expectation)).toBe(true);
		expect(ready.physicalFingerprint).not.toBe("");
		expect(
			railWorkerStateMatchesAuthoredReadyExpectation(
				{ ...ready, physicalFingerprint: "not-a-physical-fingerprint" },
				expectation,
			),
		).toBe(false);
		await expect(bridge.captureCurrentSnapshot()).resolves.toMatchObject(expectation);
		bridge.dispose();
	});

	it("rejects an authored-only readiness wait when a newer document generation wins", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const firstTarget = bridge.getState();
		const staleWait = bridge.waitUntilAuthoredReady({
			checksum: firstTarget.targetChecksum,
			sequence: firstTarget.targetSequence,
			revision: firstTarget.targetRevision,
		});
		expect(
			document.commit(planRailConstruction(document.map, { x: 12, y: 0 }, { x: 12, y: 12 })),
		).toBe(true);

		await expect(staleWait).rejects.toThrow(/authored identity/i);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.terminated).toBe(false);
		bridge.dispose();
	});

	it("cancels an authored-only readiness wait without replacing the healthy Worker", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const target = bridge.getState();
		const controller = new AbortController();
		const waiting = bridge.waitUntilAuthoredReady(
			{
				checksum: target.targetChecksum,
				sequence: target.targetSequence,
				revision: target.targetRevision,
			},
			controller.signal,
		);

		controller.abort();
		await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
		await bridge.waitUntilReady(readyExpectation(document));
		expect(port.terminated).toBe(false);
		bridge.dispose();
	});

	it("rejects the activation gate when mirror snapshot delivery fails", async () => {
		const document = new RailDocument();
		const port = new FailingRailWorker();
		const bridge = new RailWorkerBridge(
			document,
			() => undefined,
			() => port,
		);

		await expect(
			bridge.waitUntilReady({
				checksum: checksumRailMap(document.map),
				physicalFingerprint: checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
				sequence: 0,
				revision: 0,
			}),
		).rejects.toThrow("Injected mirror post failure");
		bridge.dispose();
		expect(port.terminated).toBe(true);
	});

	it("acknowledges patches and snapshot-recovers after a worker desync", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await flushWorkerMessages();
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			simulationReady: false,
			sequence: 0,
			revision: 0,
		});
		expect(port.typedSnapshotTransferCount).toBe(73);

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		await flushWorkerMessages();
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			sequence: 1,
			revision: document.map.getRevision(),
			physicalRevision: document.map.getRevision(),
			checksum: checksumRailMap(document.map),
		});
		const expectedPhysical = compilePhysicalRail(document.map);
		expect(states.at(-1)).toMatchObject({
			physicalPublicationKind: "delta",
			physicalSequence: 1,
			physicalFingerprint: checksumRailPhysicalLayout(expectedPhysical),
			physicalPathCount: expectedPhysical.paths.pathCount,
			physicalCompoundProfileCount: expectedPhysical.compoundProfiles.count,
			physicalClearanceEnvelopeCount: expectedPhysical.clearance.envelopes.count,
			physicalClearanceIssueCount: expectedPhysical.clearance.issues.count,
			physicalIntervalRemapCount: expectedPhysical.pathIntervalRemap.count,
			previousPhysicalSequence: 0,
			migrationAvailable: true,
			migrationFromSequence: 0,
			migrationToSequence: 1,
		});
		expect(port.physicalLayout.revision).toBe(document.map.getRevision());
		expect(port.typedPatchTransferCount).toBe(163);
		const stateCountBeforeDuplicate = states.length;
		port.replayLastAcknowledgement();
		await flushWorkerMessages();
		expect(states).toHaveLength(stateCountBeforeDuplicate);

		port.desyncNextPatch = true;
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 4, y: 4 })),
		).toBe(true);
		await flushWorkerMessages(6);
		expect(states.some((state) => state.status === "desynced")).toBe(true);
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			epoch: 2,
			physicalPublicationKind: "reset",
			sequence: 2,
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map),
			migrationAvailable: false,
		});
		expect(port.syncCount).toBe(2);

		const messagesBeforeDispose = port.messageCount;
		bridge.dispose();
		document.undo();
		await flushWorkerMessages();
		expect(port.messageCount).toBe(messagesBeforeDispose);
		expect(port.terminated).toBe(true);
	});

	it("replaces a terminal Worker when execution failure follows a queued desync recovery", async () => {
		const document = new RailDocument();
		const workers: InProcessRailWorker[] = [];
		const createWorker = (): InProcessRailWorker => {
			const worker = new InProcessRailWorker();
			workers.push(worker);
			return worker;
		};
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(document, (state) => states.push(state), createWorker);
		await bridge.waitUntilReady(readyExpectation(document));
		const failedWorker = workers[0] as InProcessRailWorker;
		failedWorker.desyncNextPatch = true;
		failedWorker.executionErrorAfterDesyncNextPatch = true;

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const recovered = await bridge.waitUntilReady(readyExpectation(document));

		expect(recovered).toMatchObject({
			status: "ready",
			epoch: 2,
			sequence: 1,
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map),
			simulationReady: false,
		});
		expect(workers).toHaveLength(2);
		expect(failedWorker.terminated).toBe(true);
		const recoveredWorker = workers[1] as InProcessRailWorker;
		expect(recoveredWorker.syncCount).toBe(1);
		expect(document.undo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(document.redo()).toBe(true);
		const redone = await bridge.waitUntilReady(readyExpectation(document));
		expect(redone).toMatchObject({
			status: "ready",
			sequence: 3,
			checksum: checksumRailMap(document.map),
		});
		bridge.dispose();
	});

	it("replaces a Worker after a direct execution error and preserves undo/redo continuity", async () => {
		const document = new RailDocument();
		const workers: InProcessRailWorker[] = [];
		const createWorker = (): InProcessRailWorker => {
			const worker = new InProcessRailWorker();
			workers.push(worker);
			return worker;
		};
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(document, (state) => states.push(state), createWorker);
		await bridge.waitUntilReady(readyExpectation(document));
		const failedWorker = workers[0] as InProcessRailWorker;

		failedWorker.emitExecutionError("Injected direct Worker execution failure");
		const recovered = await bridge.waitUntilReady(readyExpectation(document));

		expect(recovered).toMatchObject({
			status: "ready",
			epoch: 2,
			sequence: 0,
			checksum: checksumRailMap(document.map),
		});
		expect(workers).toHaveLength(2);
		expect(failedWorker.terminated).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(document.undo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(document.redo()).toBe(true);
		const redone = await bridge.waitUntilReady(readyExpectation(document));
		expect(redone).toMatchObject({
			status: "ready",
			sequence: 3,
			checksum: checksumRailMap(document.map),
		});
		bridge.dispose();
	});

	it("keeps a terminal error latched when replacement creation fails during queued recovery", async () => {
		const document = new RailDocument();
		const worker = new InProcessRailWorker();
		let creationCount = 0;
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => {
				creationCount++;
				if (creationCount > 1) throw new Error("Injected replacement creation failure");
				return worker;
			},
		);
		await bridge.waitUntilReady(readyExpectation(document));
		worker.desyncNextPatch = true;
		worker.executionErrorAfterDesyncNextPatch = true;

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		await flushWorkerMessages(6);

		expect(states.at(-1)).toMatchObject({
			status: "error",
			message: "Injected replacement creation failure",
		});
		await expect(bridge.waitUntilReady(readyExpectation(document))).rejects.toThrow(
			"Injected replacement creation failure",
		);
		await flushWorkerMessages(6);
		expect(states.at(-1)?.status).toBe("error");
		expect(creationCount).toBe(2);
		expect(worker.terminated).toBe(true);
		bridge.dispose();
	});

	it("snapshot-recovers when an acknowledgement carries a stale physical revision", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await flushWorkerMessages();
		port.corruptPhysicalRevisionNextPatch = true;

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		await flushWorkerMessages(6);

		expect(states.some((state) => state.status === "desynced")).toBe(true);
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			epoch: 2,
			sequence: 1,
			revision: document.map.getRevision(),
			physicalRevision: document.map.getRevision(),
		});
		expect(port.syncCount).toBe(2);
		bridge.dispose();
	});

	it("tracks authored and compiled advanced switch counts while keeping simulation gated", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await flushWorkerMessages();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		await flushWorkerMessages();
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: -2 }, "A");
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		await flushWorkerMessages();

		expect(states.at(-1)).toMatchObject({
			status: "ready",
			simulationReady: false,
			targetSwitches: 1,
			switches: 1,
			physicalAdvancedSwitchCount: 1,
		});
		expect(port.typedPatchTransferCount).toBe(163);
		bridge.dispose();
	});

	it.each([
		["future authored sequence", "corruptAuthoredSequenceNextPatch"],
		["authored revision", "corruptAuthoredRevisionNextPatch"],
		["physical sequence", "corruptPhysicalSequenceNextPatch"],
		["compiled switch count", "corruptPhysicalSwitchCountNextPatch"],
		["clearance envelope count", "corruptClearanceEnvelopeCountNextPatch"],
		["clearance issue count", "corruptClearanceIssueCountNextPatch"],
		["migration source identity", "corruptMigrationSourceNextPatch"],
		["migration source path count", "corruptMigrationSourceCountNextPatch"],
		["missing migration", "omitMigrationNextPatch"],
	] as const)("rejects an acknowledgement with the wrong %s", async (_label, corruption) => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await flushWorkerMessages();
		port[corruption] = true;

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		await flushWorkerMessages(6);

		expect(states.some((state) => state.status === "desynced")).toBe(true);
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			epoch: 2,
			sequence: 1,
			revision: document.map.getRevision(),
			physicalSequence: 1,
			physicalRevision: document.map.getRevision(),
		});
		bridge.dispose();
	});

	it("publishes only the latest revision after rapid contiguous patches", async () => {
		const document = new RailDocument();
		const port = new InProcessRailWorker();
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(
			document,
			(state) => states.push(state),
			() => port,
		);
		await flushWorkerMessages();

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 4, y: 4 })),
		).toBe(true);
		await flushWorkerMessages(8);

		expect(states.at(-1)).toMatchObject({
			status: "ready",
			targetSequence: 2,
			sequence: 2,
			revision: document.map.getRevision(),
			physicalSequence: 2,
			physicalRevision: document.map.getRevision(),
			checksum: checksumRailMap(document.map),
			migrationFromSequence: 1,
			migrationToSequence: 2,
		});
		expect(
			states.some(
				(state) =>
					state.status === "syncing" &&
					state.targetSequence === 2 &&
					state.sequence === 1 &&
					state.physicalSequence === 1,
			),
		).toBe(true);
		expect(port.syncCount).toBe(1);
		bridge.dispose();
	});

	it("does not erase continuity with snapshot recovery after an internal publication error", async () => {
		const document = new RailDocument();
		const workers: InProcessRailWorker[] = [];
		const createWorker = (): InProcessRailWorker => {
			const worker = new InProcessRailWorker();
			workers.push(worker);
			return worker;
		};
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(document, (state) => states.push(state), createWorker);
		await flushWorkerMessages();
		const failedWorker = workers[0] as InProcessRailWorker;
		failedWorker.internalErrorNextPatch = true;

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 4, y: 4 })),
		).toBe(true);
		await flushWorkerMessages();

		expect(states.some((state) => state.status === "desynced")).toBe(true);
		expect(states.at(-1)).toMatchObject({
			status: "ready",
			epoch: 2,
			targetSequence: 2,
			targetRevision: document.map.getRevision(),
			sequence: 2,
			revision: document.map.getRevision(),
			message: null,
		});
		expect(workers).toHaveLength(2);
		expect(failedWorker.terminated).toBe(true);
		const recoveredWorker = workers[1] as InProcessRailWorker;
		expect(recoveredWorker.syncCount).toBe(1);
		const messageCount = recoveredWorker.messageCount;
		expect(document.undo()).toBe(true);
		await bridge.waitUntilReady(readyExpectation(document));
		expect(recoveredWorker.messageCount).toBeGreaterThan(messageCount);
		expect(document.redo()).toBe(true);
		const redone = await bridge.waitUntilReady(readyExpectation(document));
		expect(redone).toMatchObject({
			status: "ready",
			sequence: 4,
			checksum: checksumRailMap(document.map),
		});
		bridge.dispose();
	});

	it("resynchronizes an accepted EQ membership edit after Worker publication rollback", async () => {
		const document = closedLoopDocument(14, 4);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const initialRows = [2, 3, 4].map((x) => portSlotRowAt(slots, x, 0));
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					initialRows,
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					null,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		const workers: InProcessRailWorker[] = [];
		const createWorker = (): InProcessRailWorker => {
			const worker = new InProcessRailWorker();
			workers.push(worker);
			return worker;
		};
		const states: RailWorkerBridgeState[] = [];
		const bridge = new RailWorkerBridge(document, (state) => states.push(state), createWorker);
		const initialReady = await bridge.waitUntilReady(readyExpectation(document));
		const physicalFingerprint = initialReady.physicalFingerprint;
		const edit = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			[...initialRows, portSlotRowAt(slots, 5, 0)],
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(edit.valid, edit.reason).toBe(true);
		const failedWorker = workers[0] as InProcessRailWorker;
		failedWorker.internalErrorNextPatch = true;

		expect(document.commitPortEquipment(edit)).toBe(true);
		const recovered = await bridge.waitUntilReady(readyExpectation(document));

		expect(states.some((state) => state.status === "desynced")).toBe(true);
		expect(recovered).toMatchObject({
			status: "ready",
			epoch: 2,
			sequence: document.getPatchSequence(),
			ports: 4,
			equipmentGroups: 1,
			checksum: checksumRailMap(document.map, document.portEquipment),
			physicalFingerprint,
			simulationReady: false,
		});
		expect(workers).toHaveLength(2);
		expect(failedWorker.terminated).toBe(true);
		expect((workers[1] as InProcessRailWorker).syncCount).toBe(1);
		expect(document.portEquipment.equipmentGroups[0]?.portIds).toHaveLength(4);

		expect(document.undo()).toBe(true);
		const undone = await bridge.waitUntilReady(readyExpectation(document));
		expect(undone).toMatchObject({
			status: "ready",
			ports: 3,
			physicalFingerprint,
		});
		expect(document.redo()).toBe(true);
		const redone = await bridge.waitUntilReady(readyExpectation(document));
		expect(redone).toMatchObject({
			status: "ready",
			ports: 4,
			physicalFingerprint,
			checksum: checksumRailMap(document.map, document.portEquipment),
		});
		bridge.dispose();
	});
});

async function createValidatedStartupSnapshotFixture(cellCount: number): Promise<
	Readonly<{
		document: RailDocument;
		authority: ValidatedRailStartupSnapshotAuthority;
	}>
> {
	const adopted = await createAdoptedStartupTransportFixture(cellCount);
	const snapshot = adopted.value.snapshot;
	const validated = await validateAndHydrateRailStartupSnapshotCooperatively(
		snapshot,
		adopted.value,
		adopted.authority,
		async () => undefined,
		() => undefined,
	);
	const ownership = buildRailModuleOwnershipIndex(validated.map);
	const portEquipmentActivation = await validatePortEquipmentActivation(
		validated.map,
		validated.portEquipment,
		async () => undefined,
	);
	const organizationActivation = await validateStaticFabOrganizationActivation(
		validated.map,
		validated.portEquipment,
		validated.organizations,
		ownership,
		async () => undefined,
	);
	const document = RailDocument.fromCooperativelyValidatedMap(
		validated.map,
		validated.sequence,
		validated.portEquipment,
		validated.organizations,
		portEquipmentActivation,
		organizationActivation,
		undefined,
		validated.relationships,
	);
	return Object.freeze({ document, authority: validated.authority });
}

async function createAdoptedStartupTransportFixture(cellCount: number) {
	const payload = compileRailStartup({ kind: "scale-probe", cellCount });
	return adoptRailStartupTransportCooperatively(
		{
			snapshot: payload.snapshot,
			analysis: payload.analysis.value,
			ownership: payload.ownership.value,
			physical: payload.physical.value,
			readiness: payload.readiness.value,
			renderArtifacts: payload.renderArtifacts.value,
			draftArtifacts: payload.draftArtifacts.value,
		},
		async () => undefined,
		() => undefined,
	);
}

class InProcessRailWorker implements RailWorkerPort {
	onmessage: ((event: MessageEvent<RailMirrorToMainMessage>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly mirror = new RailPatchMirror();
	desyncNextPatch = false;
	executionErrorAfterDesyncNextPatch = false;
	corruptAuthoredRevisionNextPatch = false;
	corruptAuthoredSequenceNextPatch = false;
	corruptPhysicalSequenceNextPatch = false;
	corruptPhysicalRevisionNextPatch = false;
	corruptPhysicalSwitchCountNextPatch = false;
	corruptClearanceEnvelopeCountNextPatch = false;
	corruptClearanceIssueCountNextPatch = false;
	corruptMigrationSourceNextPatch = false;
	corruptMigrationSourceCountNextPatch = false;
	corruptOrganizationCursorNextPatch = false;
	corruptAssemblyRelationshipIdentityNextPatch = false;
	omitMigrationNextPatch = false;
	internalErrorNextPatch = false;
	internalErrorNextSnapshotCapture = false;
	corruptNextSnapshotCapture = false;
	corruptNestedSnapshotCapture = false;
	dropNextSnapshotCapture = false;
	blockNextSnapshotCapture = false;
	blockNextOrganizationOutlineCapture = false;
	corruptNextOrganizationOutlineCapture = false;
	dropNextOrganizationOutlineResponse = false;
	terminalErrorLatched = false;
	terminated = false;
	syncCount = 0;
	messageCount = 0;
	typedPatchTransferCount = 0;
	typedSnapshotTransferCount = 0;
	snapshotCaptureCount = 0;
	organizationOutlineCaptureCount = 0;
	organizationOutlineTransferCount = 0;
	lastOrganizationOperationCodes: number[] = [];
	lastOrganizationCoordinateCount = 0;
	lastDecodedOrganizationAfterMemberships = new Map<number, object>();
	initialSyncSnapshot: RailMirrorSnapshot | null = null;
	private activeEpoch = 0;
	private lastAcknowledgement: RailMirrorToMainMessage | null = null;
	private blocked = false;

	get physicalLayout(): ReturnType<typeof compilePhysicalRail> {
		return this.mirror.getPhysicalPublication().current.buffers;
	}

	postMessage(message: MainToRailMirrorMessage, transfer: Transferable[] = []): void {
		if (this.blocked) return;
		this.messageCount++;
		if (message.type === "SYNC_RAIL") {
			this.initialSyncSnapshot ??= message.snapshot;
			this.typedSnapshotTransferCount = transfer.length;
			expect(message.snapshot.switchIds).toBeInstanceOf(Int32Array);
			expect(message.snapshot.switchRecords.origins).toBeInstanceOf(Int32Array);
		}
		if (message.type === "APPLY_RAIL_PATCH") {
			this.typedPatchTransferCount = transfer.length;
			expect(message.patch.xs).toBeInstanceOf(Int32Array);
			expect(message.patch.before).toBeInstanceOf(Uint8Array);
			expect(message.patch.switchIds).toBeInstanceOf(Int32Array);
			expect(message.patch.switchBeforePresent).toBeInstanceOf(Uint8Array);
			expect(message.patch.switchAfter.origins).toBeInstanceOf(Int32Array);
			expect(message.patch.portEquipment.portIds).toBeInstanceOf(Int32Array);
			expect(message.patch.portEquipment.equipmentGroupIds).toBeInstanceOf(Int32Array);
			this.lastOrganizationOperationCodes = Array.from(message.patch.organizations.operationCodes);
			this.lastOrganizationCoordinateCount =
				message.patch.organizations.before.railEdgeCoordinates.length +
				message.patch.organizations.after.railEdgeCoordinates.length +
				message.patch.organizations.removedMembership.railEdgeCoordinates.length +
				message.patch.organizations.addedMembership.railEdgeCoordinates.length;
		}
		const deliveredMessage = structuredClone(message, { transfer });
		queueMicrotask(() => {
			if (this.terminated || this.terminalErrorLatched || this.blocked) return;
			if (deliveredMessage.type === "SYNC_RAIL") {
				this.activeEpoch = deliveredMessage.epoch;
				this.syncCount++;
				const railState = this.mirror.sync(
					deliveredMessage.snapshot,
					deliveredMessage.historyLedger,
					deliveredMessage.operationalConfiguration,
				);
				this.emit({
					type: "RAIL_SYNCED",
					epoch: this.activeEpoch,
					...railState,
					...this.physicalState(),
				});
				return;
			}
			if (deliveredMessage.type === "CAPTURE_RAIL_SNAPSHOT") {
				if (this.blockNextSnapshotCapture) {
					this.blockNextSnapshotCapture = false;
					this.blocked = true;
					return;
				}
				if (this.dropNextSnapshotCapture) {
					this.dropNextSnapshotCapture = false;
					return;
				}
				if (this.internalErrorNextSnapshotCapture) {
					this.internalErrorNextSnapshotCapture = false;
					this.terminalErrorLatched = true;
					const state = this.mirror.state;
					this.emit({
						type: "RAIL_MIRROR_ERROR",
						epoch: deliveredMessage.epoch,
						sequence: state.sequence,
						revision: state.revision,
						message: "Injected authoritative snapshot mirror diverged",
					});
					return;
				}
				const state = this.mirror.state;
				if (
					deliveredMessage.epoch !== this.activeEpoch ||
					deliveredMessage.expectedSequence !== state.sequence ||
					deliveredMessage.expectedRevision !== state.revision ||
					deliveredMessage.expectedChecksum !== state.checksum ||
					deliveredMessage.expectedNextRelationshipId !== state.assemblyRelationshipNextId
				) {
					this.emit({
						type: "RAIL_SNAPSHOT_CAPTURE_FAILED",
						epoch: deliveredMessage.epoch,
						requestId: deliveredMessage.requestId,
						message: "Injected snapshot identity mismatch",
					});
					return;
				}
				this.snapshotCaptureCount++;
				const snapshot = this.mirror.captureSnapshot();
				const deliveredSnapshot = structuredClone(snapshot, {
					transfer: railMirrorSnapshotTransfers(snapshot),
				});
				if (this.corruptNextSnapshotCapture) {
					this.corruptNextSnapshotCapture = false;
					this.emit({
						type: "RAIL_SNAPSHOT_CAPTURED",
						epoch: deliveredMessage.epoch,
						requestId: deliveredMessage.requestId,
						snapshot: { ...deliveredSnapshot, checksum: "forged" },
					});
					return;
				}
				if (this.corruptNestedSnapshotCapture) {
					this.corruptNestedSnapshotCapture = false;
					this.emit({
						type: "RAIL_SNAPSHOT_CAPTURED",
						epoch: deliveredMessage.epoch,
						requestId: deliveredMessage.requestId,
						snapshot: {
							...deliveredSnapshot,
							switchRecords: {
								...deliveredSnapshot.switchRecords,
								origins: new Uint8Array(0) as unknown as Int32Array,
							},
						},
					});
					return;
				}
				this.emit({
					type: "RAIL_SNAPSHOT_CAPTURED",
					epoch: deliveredMessage.epoch,
					requestId: deliveredMessage.requestId,
					snapshot: deliveredSnapshot,
				});
				return;
			}
			if (deliveredMessage.type === "CAPTURE_STATIC_FAB_ORGANIZATION_OUTLINE") {
				if (this.blockNextOrganizationOutlineCapture) {
					this.blockNextOrganizationOutlineCapture = false;
					this.blocked = true;
					return;
				}
				const source = this.mirror.getOrganizationOutlineSourceIdentity();
				if (
					deliveredMessage.epoch !== this.activeEpoch ||
					deliveredMessage.expectedSequence !== source.sequence ||
					deliveredMessage.expectedRevision !== source.revision ||
					deliveredMessage.expectedChecksum !== source.checksum ||
					deliveredMessage.expectedNextAdvancedSwitchId !== source.nextAdvancedSwitchId ||
					deliveredMessage.expectedNextPortId !== source.nextPortId ||
					deliveredMessage.expectedNextEquipmentGroupId !== source.nextEquipmentGroupId ||
					deliveredMessage.expectedNextOrganizationId !== source.nextOrganizationId ||
					deliveredMessage.expectedPhysicalSequence !== source.physicalSequence ||
					deliveredMessage.expectedPhysicalRevision !== source.physicalRevision ||
					deliveredMessage.expectedPhysicalFingerprint !== source.physicalFingerprint
				) {
					this.emit({
						type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURE_FAILED",
						epoch: deliveredMessage.epoch,
						requestId: deliveredMessage.requestId,
						message: "Injected organization outline identity mismatch",
					});
					return;
				}
				this.organizationOutlineCaptureCount++;
				const outline = this.mirror.captureOrganizationOutline();
				if (this.dropNextOrganizationOutlineResponse) {
					this.dropNextOrganizationOutlineResponse = false;
					return;
				}
				const outlineTransfers = staticFabOrganizationOutlineTransfers(outline);
				this.organizationOutlineTransferCount = outlineTransfers.length;
				const deliveredOutline = structuredClone(outline, {
					transfer: outlineTransfers,
				});
				this.emit({
					type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED",
					epoch: deliveredMessage.epoch,
					requestId: deliveredMessage.requestId,
					outline: this.corruptNextOrganizationOutlineCapture
						? { ...deliveredOutline, fingerprint: "forged" }
						: deliveredOutline,
				});
				this.corruptNextOrganizationOutlineCapture = false;
				return;
			}
			if (this.desyncNextPatch) {
				this.desyncNextPatch = false;
				const state = this.mirror.state;
				this.emit({
					type: "RAIL_DESYNC",
					epoch: deliveredMessage.epoch,
					expectedSequence: state.sequence + 1,
					expectedRevision: state.revision,
					receivedSequence: deliveredMessage.patch.sequence,
					receivedBaseRevision: deliveredMessage.patch.baseRevision,
					message: "Injected desync",
				});
				if (this.executionErrorAfterDesyncNextPatch) {
					this.executionErrorAfterDesyncNextPatch = false;
					this.emitExecutionError("Injected execution failure after desync");
				}
				return;
			}
			if (this.internalErrorNextPatch) {
				this.internalErrorNextPatch = false;
				this.terminalErrorLatched = true;
				const state = this.mirror.state;
				this.emit({
					type: "RAIL_MIRROR_ERROR",
					epoch: deliveredMessage.epoch,
					sequence: state.sequence,
					revision: state.revision,
					message: "Injected physical publication failure",
				});
				return;
			}
			let railState: ReturnType<RailPatchMirror["applyPatch"]>;
			try {
				const decodedPatch = decodeRailPatchSoA(
					deliveredMessage.patch,
					this.mirror.organizationState,
				);
				this.lastDecodedOrganizationAfterMemberships = new Map(
					decodedPatch.organizationChanges.flatMap((change) =>
						change.after ? [[change.id, change.after.membership] as const] : [],
					),
				);
				railState = this.mirror.applyPatch(decodedPatch);
			} catch (error) {
				const state = this.mirror.state;
				this.emit({
					type: "RAIL_DESYNC",
					epoch: deliveredMessage.epoch,
					expectedSequence: state.sequence + 1,
					expectedRevision: state.revision,
					receivedSequence: deliveredMessage.patch.sequence,
					receivedBaseRevision: deliveredMessage.patch.baseRevision,
					message: error instanceof Error ? error.message : "Injected mirror failure",
				});
				return;
			}
			const physicalState = this.physicalState();
			let acknowledgedRail = this.corruptAuthoredRevisionNextPatch
				? { ...railState, revision: railState.revision + 1 }
				: railState;
			if (this.corruptAuthoredSequenceNextPatch) {
				acknowledgedRail = {
					...acknowledgedRail,
					sequence: railState.sequence + 1,
				};
			}
			if (this.corruptOrganizationCursorNextPatch) {
				const checksum = RailChecksumAccumulator.fromDigest(acknowledgedRail.checksum);
				checksum.setOrganizationNextId(checksum.organizationNextId + 1);
				acknowledgedRail = { ...acknowledgedRail, checksum: checksum.digest() };
			}
			if (this.corruptAssemblyRelationshipIdentityNextPatch) {
				acknowledgedRail = {
					...acknowledgedRail,
					assemblyRelationships: acknowledgedRail.assemblyRelationships + 1,
					assemblyRelationshipNextId: acknowledgedRail.assemblyRelationshipNextId + 1,
				};
			}
			let acknowledgedPhysical = this.corruptPhysicalRevisionNextPatch
				? {
						...physicalState,
						physicalRevision: physicalState.physicalRevision + 1,
					}
				: physicalState;
			if (this.corruptMigrationSourceNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					migrationFromFingerprint: "deadbeef:00000000",
				};
			}
			if (this.corruptMigrationSourceCountNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					migrationSourcePathCount: acknowledgedPhysical.migrationSourcePathCount + 1,
				};
			}
			if (this.omitMigrationNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					migrationAvailable: false,
				};
			}
			if (this.corruptAuthoredRevisionNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					physicalRevision: acknowledgedRail.revision,
				};
			}
			if (this.corruptPhysicalSequenceNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					physicalSequence: physicalState.physicalSequence + 1,
				};
			}
			if (this.corruptPhysicalSwitchCountNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					physicalValid: false,
					physicalAdvancedSwitchCount: acknowledgedPhysical.physicalAdvancedSwitchCount + 1,
				};
			}
			if (this.corruptClearanceEnvelopeCountNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					physicalClearanceEnvelopeCount: -1,
				};
			}
			if (this.corruptClearanceIssueCountNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					physicalClearanceIssueCount: 0.5,
				};
			}
			if (this.corruptAuthoredSequenceNextPatch) {
				acknowledgedPhysical = {
					...acknowledgedPhysical,
					physicalSequence: acknowledgedRail.sequence,
				};
			}
			this.corruptAuthoredRevisionNextPatch = false;
			this.corruptAuthoredSequenceNextPatch = false;
			this.corruptPhysicalSequenceNextPatch = false;
			this.corruptPhysicalRevisionNextPatch = false;
			this.corruptPhysicalSwitchCountNextPatch = false;
			this.corruptClearanceEnvelopeCountNextPatch = false;
			this.corruptClearanceIssueCountNextPatch = false;
			this.corruptMigrationSourceNextPatch = false;
			this.corruptMigrationSourceCountNextPatch = false;
			this.corruptOrganizationCursorNextPatch = false;
			this.corruptAssemblyRelationshipIdentityNextPatch = false;
			this.omitMigrationNextPatch = false;
			this.emit({
				type: "RAIL_PATCH_APPLIED",
				epoch: deliveredMessage.epoch,
				...acknowledgedRail,
				...acknowledgedPhysical,
			});
		});
	}

	terminate(): void {
		this.terminated = true;
	}

	emitExecutionError(message = "Injected Worker execution failure"): void {
		this.terminalErrorLatched = true;
		this.onerror?.({ message } as ErrorEvent);
	}

	replayLastAcknowledgement(): void {
		if (!this.lastAcknowledgement) return;
		queueMicrotask(() => this.emit(this.lastAcknowledgement as RailMirrorToMainMessage));
	}

	private emit(message: RailMirrorToMainMessage): void {
		if (message.type === "RAIL_SYNCED" || message.type === "RAIL_PATCH_APPLIED") {
			this.lastAcknowledgement = message;
		}
		this.onmessage?.(new MessageEvent("message", { data: message }));
	}

	private physicalState(): ReturnType<typeof describeRailPhysicalPublication> {
		return describeRailPhysicalPublication(this.mirror.getPhysicalPublication());
	}
}

class FailingRailWorker implements RailWorkerPort {
	onmessage: ((event: MessageEvent<RailMirrorToMainMessage>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminated = false;

	postMessage(): void {
		throw new Error("Injected mirror post failure");
	}

	terminate(): void {
		this.terminated = true;
	}
}

async function flushWorkerMessages(turns = 3): Promise<void> {
	for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

function createSemanticOrganizationDocument(): Readonly<{
	document: RailDocument;
	bayPoint: Readonly<{ x: number; z: number }>;
}> {
	const document = new RailDocument();
	const segments = [
		{
			start: { x: 0, y: 0 },
			end: { x: 12, y: 0 },
			min: { x: -1, y: -1 },
			max: { x: 13, y: 1 },
		},
		{
			start: { x: 12, y: 0 },
			end: { x: 12, y: 12 },
			min: { x: 11, y: -1 },
			max: { x: 13, y: 13 },
		},
		{
			start: { x: 12, y: 12 },
			end: { x: 24, y: 12 },
			min: { x: 11, y: 11 },
			max: { x: 25, y: 13 },
		},
		{
			start: { x: 24, y: 12 },
			end: { x: 24, y: 24 },
			min: { x: 23, y: 11 },
			max: { x: 25, y: 25 },
		},
	] as const;
	for (const segment of segments) {
		const plan = planRailConstruction(document.map, segment.start, segment.end);
		expect(
			document.commit(plan),
			`${segment.start.x},${segment.start.y}: ${plan.reason} / ${document.getLastCommandError()}`,
		).toBe(true);
	}
	const ownership = buildRailModuleOwnershipIndex(document.map);
	const modules = ownership.modules.filter((module) => module.eraseEdges.length > 0).slice(0, 4);
	if (modules.length !== 4) throw new Error("Semantic outline fixture needs four rail modules.");
	const membership = (module: (typeof modules)[number]) => ({
		railEdges: [...module.eraseEdges].sort(compareDirectedRailEdges),
		advancedSwitchIds: module.advancedSwitchId === null ? [] : [module.advancedSwitchId],
		equipmentGroupIds: [],
	});
	const organizations = copyStaticFabOrganizationState({
		nextOrganizationId: 5,
		records: [
			{
				id: 1,
				kind: "AREA",
				name: "Factory",
				membership: membership(modules[0] as (typeof modules)[number]),
			},
			{
				id: 2,
				kind: "AREA",
				name: "Bay Bank",
				parentOrganizationIds: [1],
				membership: membership(modules[1] as (typeof modules)[number]),
			},
			{
				id: 3,
				kind: "BAY",
				name: "Production Bay",
				parentOrganizationIds: [2],
				membership: membership(modules[2] as (typeof modules)[number]),
			},
			{
				id: 4,
				kind: "AISLE",
				name: "Process Loop",
				parentOrganizationIds: [3],
				membership: membership(modules[3] as (typeof modules)[number]),
			},
		],
	});
	const bayEdges = modules[2]?.eraseEdges ?? [];
	const bayMinX = Math.min(...bayEdges.flatMap((edge) => [edge.from.x, edge.to.x]));
	const bayMinZ = Math.min(...bayEdges.flatMap((edge) => [edge.from.y, edge.to.y]));
	const loaded = RailDocument.fromLoadedMap(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		organizations,
	);
	return Object.freeze({
		document: loaded,
		bayPoint: Object.freeze({ x: bayMinX + 0.5, z: bayMinZ + 0.5 }),
	});
}

function closedLoopDocument(width: number, depth: number): RailDocument {
	const document = new RailDocument();
	for (const [start, end] of [
		[
			{ x: 0, y: 0 },
			{ x: width, y: 0 },
		],
		[
			{ x: width, y: 0 },
			{ x: width, y: depth },
		],
		[
			{ x: width, y: depth },
			{ x: 0, y: depth },
		],
		[
			{ x: 0, y: depth },
			{ x: 0, y: 0 },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	}
	return document;
}

function portSlotRowAt(
	slots: ReturnType<typeof compilePortSlotPreparedArtifactCatalog>["EQ"]["slots"],
	x: number,
	z: number,
): number {
	for (let row = 0; row < slots.count; row++) {
		if (slots.routeXs[row] === x && slots.routeZs[row] === z) return row;
	}
	throw new Error(`Missing ${slots.portType} slot at ${x},${z}.`);
}

function readyExpectation(document: RailDocument) {
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
		document.relationships,
	).snapshot;
	return {
		checksum: snapshot.checksum,
		physicalFingerprint: checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
		sequence: snapshot.sequence,
		revision: snapshot.revision,
	};
}

function reviewedMixedBatchPlan(document: RailDocument) {
	const values: Partial<Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], string>>[] = [
		{
			identity_scope: "synthetic-worker-scope",
			port_key: "synthetic-worker-ohb-port",
			attachment_scope: "synthetic-rail-scope",
			attachment_alias: "synthetic-rail-alias",
			station_mm: "500",
			side: "LEFT",
			lateral_offset_mm: "700",
			direction: "WITH_TRAVEL",
			direction_evidence: "DECLARED",
			port_type: "OHB",
			physical_group_key: "synthetic-worker-ohb-group",
			physical_group_kind: "OHB",
			organization_alias: "synthetic-unassigned-organization",
		},
		{
			identity_scope: "synthetic-worker-scope",
			port_key: "synthetic-worker-stk-port",
			attachment_scope: "synthetic-rail-scope",
			attachment_alias: "synthetic-rail-alias",
			station_mm: "500",
			side: "CENTER",
			lateral_offset_mm: "0",
			direction: "WITH_TRAVEL",
			direction_evidence: "DECLARED",
			port_type: "STK",
			physical_group_key: "synthetic-worker-stk-group",
			physical_group_kind: "STK",
			organization_alias: "synthetic-unassigned-organization",
		},
	];
	const csv = `${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n${values
		.map((row) => OPENFAB_STATION_PROPOSAL_V1_HEADERS.map((header) => row[header] ?? "").join(","))
		.join("\n")}\n`;
	const parsed = parseOpenFabStationProposalCsv(new TextEncoder().encode(csv));
	if (!parsed.ok) throw new Error(`Synthetic station proposal failed: ${parsed.failure.code}`);
	const artifact = hydrateOpenFabStationProposalArtifact(parsed.artifact);
	const source = Object.freeze({
		map: document.map,
		portEquipment: document.portEquipment,
		organizations: document.organizations,
		patchSequence: document.getPatchSequence(),
	});
	const evaluation = evaluateOpenFabStationProposalReview(
		artifact,
		{
			rowDecisions: [
				{
					row: 0,
					disposition: "INCLUDE",
					identityAction: "CREATE_NEW",
					portType: "OHB",
					typeReview: "CONFIRM_DECLARED",
					attachmentReview: "USER_SELECTED_EXACT_ROUTE",
					route: { kind: "CARDINAL_CELL", x: 1, z: 0, from: DIR_W, to: DIR_E },
					stationMillimeters: 500,
					stationReview: "CONFIRM_DECLARED",
					side: "LEFT",
					lateralOffsetMillimeters: 700,
					sideOffsetReview: "CONFIRM_DECLARED",
					direction: "WITH_TRAVEL",
					directionReview: "CONFIRM_DECLARED",
					sourcePositionReview: "NOT_PROVIDED",
				},
				{
					row: 1,
					disposition: "INCLUDE",
					identityAction: "CREATE_NEW",
					portType: "STK",
					typeReview: "CONFIRM_DECLARED",
					attachmentReview: "USER_SELECTED_EXACT_ROUTE",
					route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
					stationMillimeters: 500,
					stationReview: "CONFIRM_DECLARED",
					side: "CENTER",
					lateralOffsetMillimeters: 0,
					sideOffsetReview: "CONFIRM_DECLARED",
					direction: "WITH_TRAVEL",
					directionReview: "CONFIRM_DECLARED",
					sourcePositionReview: "NOT_PROVIDED",
				},
			],
			groupDecisions: [
				{
					reviewGroupId: 1,
					kind: "OHB",
					template: "SINGLE",
					groupingReview: "CONFIRM_DECLARED",
					memberRows: [0],
				},
				{
					reviewGroupId: 2,
					kind: "STK",
					template: "FLEX",
					groupingReview: "CONFIRM_DECLARED",
					memberRows: [1],
				},
			],
			rejectedSourceRowsPolicy: "NOT_APPLICABLE",
			unknownColumnsPolicy: "NOT_APPLICABLE",
			organizationPolicy: "EXPLICIT_UNASSIGNED",
		},
		source,
	);
	if (evaluation.state !== "READY") throw new Error("Synthetic station review was not ready.");
	return planReviewedOpenFabStationProposalBatch(
		finalizeOpenFabStationProposalReview(evaluation),
		source,
	);
}

function certifiedOhbPlan(document: RailDocument) {
	const portId = document.portEquipment.nextPortId;
	const equipmentGroupId = document.portEquipment.nextEquipmentGroupId;
	const port = Object.freeze({
		id: portId,
		equipmentGroupId,
		route: Object.freeze({
			kind: "CARDINAL_CELL",
			x: 1,
			z: 0,
			from: DIR_W,
			to: DIR_E,
		}),
		stationMillimeters: 500,
		side: "LEFT",
		lateralOffsetMillimeters: 700,
		direction: "WITH_TRAVEL",
		portType: "OHB",
		barcode: "OHB-001",
	} satisfies PortRecord);
	const group = Object.freeze({
		id: equipmentGroupId,
		kind: "OHB" as const,
		template: "SINGLE" as const,
		portIds: Object.freeze([portId]),
	});
	return createPortEquipmentMutationPlanWithImmutableGraphCertificate(
		"place-ohb",
		document.map.getRevision(),
		document.getPatchSequence(),
		[Object.freeze({ id: portId, before: null, after: port })],
		[Object.freeze({ id: equipmentGroupId, before: null, after: group })],
	);
}

function ohbPlan(document: RailDocument) {
	const portId = document.portEquipment.nextPortId;
	const equipmentGroupId = document.portEquipment.nextEquipmentGroupId;
	const port: PortRecord = {
		id: portId,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", x: 1, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters: 500,
		side: "LEFT",
		lateralOffsetMillimeters: 700,
		direction: "WITH_TRAVEL",
		portType: "OHB",
		barcode: "OHB-001",
	};
	const group = {
		id: equipmentGroupId,
		kind: "OHB" as const,
		template: "SINGLE" as const,
		portIds: [portId],
	};
	return createPortEquipmentMutationPlan(
		"place-ohb",
		document.map.getRevision(),
		document.getPatchSequence(),
		[{ id: portId, before: null, after: port }],
		[{ id: equipmentGroupId, before: null, after: group }],
	);
}
