import { describe, expect, it } from "vitest";
import {
	type HydratedOpenFabStationProposalArtifact,
	hydrateOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_MAX_TOTAL_SECONDARY_ALIASES,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
} from "../compile/OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "../compile/OpenFabStationProposalCsvReader";
import {
	evaluateOpenFabStationProposalReview,
	finalizeOpenFabStationProposalReview,
	type OpenFabStationProposalReviewEvaluation,
	type OpenFabStationProposalReviewSource,
	planReviewedOpenFabStationProposalBatch,
} from "../compile/OpenFabStationProposalReview";
import type { CardinalPortRoute } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	OpenFabStationProposalBridge,
	type OpenFabStationProposalWorkerPort,
} from "../editor/OpenFabStationProposalBridge";
import {
	OpenFabStationProposalReviewBridge,
	type OpenFabStationProposalReviewWorkerPort,
} from "../editor/OpenFabStationProposalReviewBridge";
import { createOpenFabStationProposalReviewSession } from "../editor/OpenFabStationProposalReviewSession";
import { OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES } from "../project/OpenFabStationProposalPorts";
import type {
	OpenFabStationProposalWorkerRequest,
	OpenFabStationProposalWorkerResponse,
} from "./OpenFabStationProposalProtocol";
import {
	collectOpenFabStationProposalReviewDraftSnapshotTransfers,
	revokeEncodedOpenFabStationProposalReviewDraftSnapshot,
} from "./OpenFabStationProposalReviewDraftSoA";
import type {
	OpenFabStationProposalReviewWorkerRequest,
	OpenFabStationProposalReviewWorkerResponse,
} from "./OpenFabStationProposalReviewWorkerProtocol";
import {
	collectOpenFabStationProposalReviewWorkerResponseTransfers,
	OpenFabStationProposalReviewWorkerSession,
} from "./OpenFabStationProposalReviewWorkerRuntime";
import {
	collectOpenFabStationProposalResponseTransfers,
	runOpenFabStationProposalWorkerRequest,
} from "./OpenFabStationProposalRuntime";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";
import { RailWorkerBridge, type RailWorkerPort } from "./RailWorkerBridge";
import type { MainToRailMirrorMessage, RailMirrorToMainMessage } from "./railMirrorProtocol";

const SCALE_ROW_COUNT = 100_000;
const MIXED_SCALE_GROUP_COUNT = (SCALE_ROW_COUNT / 4) * 3;
const MIXED_SCALE_MAX_RSS_KIB = 3 * 1024 * 1024;
const RUN_REVIEWED_APPLY_SCALE =
	(globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
		.process?.env?.OPENFAB_REVIEWED_APPLY_SCALE === "1";

class ScaleRuntimeWorker implements OpenFabStationProposalWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;
	requestTransferCount = 0;
	requestSourceDetached = false;
	responseTransferBytes = 0;
	responseSnapshotDetached = false;

	postMessage(message: OpenFabStationProposalWorkerRequest, transfer: Transferable[] = []): void {
		this.requestTransferCount = transfer.length;
		const delivered = structuredClone(message, { transfer });
		this.requestSourceDetached = message.source.byteLength === 0;
		queueMicrotask(() => this.respond(delivered));
	}

	terminate(): void {
		this.terminated = true;
	}

	private respond(request: OpenFabStationProposalWorkerRequest): void {
		if (this.terminated) return;
		const response = runOpenFabStationProposalWorkerRequest(request);
		const transfers = collectOpenFabStationProposalResponseTransfers(response);
		this.responseTransferBytes = transfers.reduce((total, buffer) => total + buffer.byteLength, 0);
		const delivered = structuredClone(response, { transfer: transfers });
		this.responseSnapshotDetached = transfers.every((buffer) => buffer.byteLength === 0);
		this.onmessage?.({ data: delivered } as MessageEvent<OpenFabStationProposalWorkerResponse>);
	}
}

class ScaleReviewRuntimeWorker implements OpenFabStationProposalReviewWorkerPort {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	private readonly session = new OpenFabStationProposalReviewWorkerSession();
	terminated = false;
	onPlanResponse: (() => void) | null = null;

	postMessage(
		message: OpenFabStationProposalReviewWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => {
			void this.respond(delivered).catch(() => {
				this.onerror?.({ message: "PUBLIC_SYNTHETIC_SCALE_WORKER_FAILURE" } as ErrorEvent);
			});
		});
	}

	terminate(): void {
		this.terminated = true;
		this.session.terminate();
	}

	private async respond(request: OpenFabStationProposalReviewWorkerRequest): Promise<void> {
		if (this.terminated) return;
		const response = await this.session.receive(request);
		const transfers = collectOpenFabStationProposalReviewWorkerResponseTransfers(response);
		const delivered = structuredClone(response, { transfer: [...transfers] });
		if (response.type === "OPENFAB_STATION_PROPOSAL_REVIEW_PLAN_PREPARED") {
			this.onPlanResponse?.();
		}
		this.onmessage?.({
			data: delivered,
		} as MessageEvent<OpenFabStationProposalReviewWorkerResponse>);
	}
}

class ScaleRailWorkerPatchSink implements RailWorkerPort {
	onmessage: ((event: MessageEvent<RailMirrorToMainMessage>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminated = false;
	syncPostCount = 0;
	patchPostCount = 0;
	patchTransferBytes = 0;
	patchPortCount = 0;
	patchEquipmentGroupCount = 0;

	postMessage(message: MainToRailMirrorMessage, transfer: Transferable[] = []): void {
		if (message.type === "SYNC_RAIL") {
			this.syncPostCount += 1;
			return;
		}
		if (message.type !== "APPLY_RAIL_PATCH") return;
		this.patchPostCount += 1;
		this.patchTransferBytes = transfer.reduce<number>(
			(total, transferable) =>
				total + (transferable instanceof ArrayBuffer ? transferable.byteLength : 0),
			0,
		);
		this.patchPortCount = message.patch.portEquipment.portIds.length;
		this.patchEquipmentGroupCount = message.patch.portEquipment.equipmentGroupIds.length;
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("OpenFab station proposal serialized scale gate", () => {
	it("accepts the exact aggregate secondary-alias budget without unbounded lookup state", () => {
		const aliasesPerRow = 16;
		const rowCount = OPENFAB_STATION_PROPOSAL_MAX_TOTAL_SECONDARY_ALIASES / aliasesPerRow;
		const result = parseOpenFabStationProposalCsv(aliasScaleSource(rowCount, aliasesPerRow));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact.rowCount).toBe(rowCount);
		expect(result.artifact.secondaryAliasStringIndices.length).toBe(
			OPENFAB_STATION_PROPOSAL_MAX_TOTAL_SECONDARY_ALIASES,
		);
	}, 15_000);

	it("reads, transfers, and cooperatively adopts the exact 100k-row bound", async () => {
		const source = scaleSource(SCALE_ROW_COUNT);
		const sourceByteLength = source.byteLength;
		const worker = new ScaleRuntimeWorker();
		let checkpointCount = 0;
		let maxWorkSliceMilliseconds = 0;
		let sliceStartedAt = 0;
		let hydrationNowCalls = 0;
		const hydrationNow = (): number => {
			const value = performance.now();
			if (hydrationNowCalls++ === 0) sliceStartedAt = value;
			return value;
		};
		const bridge = new OpenFabStationProposalBridge(
			() => worker,
			30_000,
			async () => {
				const checkpointAt = performance.now();
				maxWorkSliceMilliseconds = Math.max(
					maxWorkSliceMilliseconds,
					checkpointAt - sliceStartedAt,
				);
				checkpointCount++;
				await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
				sliceStartedAt = performance.now();
			},
			hydrationNow,
			4,
		);
		const startedAt = performance.now();

		const result = await bridge.read(source, 1);
		const elapsedMilliseconds = performance.now() - startedAt;

		expect(sourceByteLength).toBeLessThanOrEqual(OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES);
		expect(source.byteLength).toBe(0);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact.rowCount).toBe(SCALE_ROW_COUNT);
		expect(result.artifact.readRow(SCALE_ROW_COUNT - 1).portKey).toBe("PORT-99999");
		expect(worker.requestTransferCount).toBe(1);
		expect(worker.requestSourceDetached).toBe(true);
		expect(worker.responseTransferBytes).toBeLessThan(OPENFAB_STATION_PROPOSAL_MAX_FILE_BYTES);
		expect(worker.responseSnapshotDetached).toBe(true);
		expect(worker.terminated).toBe(true);
		expect(checkpointCount).toBeGreaterThan(0);
		expect(checkpointCount).toBeLessThan(1_000);
		expect(maxWorkSliceMilliseconds).toBeLessThan(50);
		expect(elapsedMilliseconds).toBeLessThan(15_000);
	}, 30_000);

	it("captures and privately seals exact 100k decisions, groups, and memberships", async () => {
		const parsed = parseOpenFabStationProposalCsv(new Uint8Array(scaleSource(SCALE_ROW_COUNT)));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const proposal = hydrateOpenFabStationProposalArtifact(parsed.artifact);
		const session = createOpenFabStationProposalReviewSession(proposal);
		session.dispatch({
			type: "SET_REJECTED_SOURCE_ROWS_POLICY",
			policy: "NOT_APPLICABLE",
		});
		session.dispatch({ type: "SET_UNKNOWN_COLUMNS_POLICY", policy: "NOT_APPLICABLE" });
		session.dispatch({ type: "SET_ORGANIZATION_POLICY", policy: "EXPLICIT_UNASSIGNED" });
		for (let row = 0; row < SCALE_ROW_COUNT; row += 1) {
			const proposed = proposal.readRow(row);
			session.dispatch({
				type: "INCLUDE_ROW",
				decision: {
					row,
					disposition: "INCLUDE",
					identityAction: "CREATE_NEW",
					portType: "OHB",
					typeReview: "CONFIRM_DECLARED",
					attachmentReview: "USER_SELECTED_EXACT_ROUTE",
					route: { kind: "CARDINAL_CELL", x: row, z: 0, from: DIR_W, to: DIR_E },
					stationMillimeters: proposed.stationMillimeters,
					stationReview: "CONFIRM_DECLARED",
					side: "LEFT",
					lateralOffsetMillimeters: 700,
					sideOffsetReview: "CONFIRM_DECLARED",
					direction: "WITH_TRAVEL",
					directionReview: "OVERRIDE",
					sourcePositionReview: "NOT_PROVIDED",
				},
			});
			const reviewGroupId = row + 1;
			session.dispatch({ type: "CREATE_GROUP", reviewGroupId, kind: "OHB" });
			session.dispatch({ type: "SET_GROUP_MEMBERS", reviewGroupId, memberRows: [row] });
			session.dispatch({
				type: "SET_GROUP_REVIEW",
				reviewGroupId,
				groupingReview: "OVERRIDE",
			});
		}
		expect(session.getSummary()).toMatchObject({
			revision: SCALE_ROW_COUNT * 4 + 4,
			decidedRowCount: SCALE_ROW_COUNT,
			includedRowCount: SCALE_ROW_COUNT,
			activeGroupCount: SCALE_ROW_COUNT,
			membershipCount: SCALE_ROW_COUNT,
			captureReady: true,
		});

		let checkpointCount = 0;
		let taskYieldCount = 0;
		let sliceStartedAt = performance.now();
		let maxWorkSliceMilliseconds = 0;
		const snapshot = await session.captureDraftSnapshotCooperatively({
			checkpoint: () => {
				checkpointCount += 1;
				maxWorkSliceMilliseconds = Math.max(
					maxWorkSliceMilliseconds,
					performance.now() - sliceStartedAt,
				);
				return new Promise<void>((resolve) => {
					setTimeout(() => {
						taskYieldCount += 1;
						sliceStartedAt = performance.now();
						resolve();
					}, 0);
				});
			},
			revision: () => 1,
			operationsPerCheckpoint: 512,
			now: () => performance.now(),
			sliceMilliseconds: 4,
		});
		maxWorkSliceMilliseconds = Math.max(
			maxWorkSliceMilliseconds,
			performance.now() - sliceStartedAt,
		);
		const transfers = collectOpenFabStationProposalReviewDraftSnapshotTransfers(snapshot);

		expect(snapshot).toMatchObject({
			proposalRowCount: SCALE_ROW_COUNT,
			decisionCount: SCALE_ROW_COUNT,
			groupCount: SCALE_ROW_COUNT,
			membershipCount: SCALE_ROW_COUNT,
			byteLength: 6_300_004,
		});
		expect(snapshot.decisionRows[0]).toBe(0);
		expect(snapshot.decisionRows[SCALE_ROW_COUNT - 1]).toBe(SCALE_ROW_COUNT - 1);
		expect(snapshot.groupReviewIds[0]).toBe(1);
		expect(snapshot.groupReviewIds[SCALE_ROW_COUNT - 1]).toBe(SCALE_ROW_COUNT);
		expect(snapshot.groupMemberOffsets[0]).toBe(0);
		expect(snapshot.groupMemberOffsets[SCALE_ROW_COUNT]).toBe(SCALE_ROW_COUNT);
		expect(snapshot.groupMemberRows[0]).toBe(0);
		expect(snapshot.groupMemberRows[SCALE_ROW_COUNT - 1]).toBe(SCALE_ROW_COUNT - 1);
		expect(transfers).toHaveLength(32);
		expect(new Set(transfers).size).toBe(transfers.length);
		expect(checkpointCount).toBeGreaterThan(0);
		expect(taskYieldCount).toBe(checkpointCount);
		expect(maxWorkSliceMilliseconds).toBeLessThan(50);
		expect(session.readRowWindow(SCALE_ROW_COUNT - 1, 1).items[0]).toMatchObject({
			row: SCALE_ROW_COUNT - 1,
			decision: { disposition: "INCLUDE", portType: "OHB" },
			reviewGroupId: SCALE_ROW_COUNT,
		});
		expect(session.readGroupWindow(SCALE_ROW_COUNT - 1, 1).items[0]).toMatchObject({
			reviewGroupId: SCALE_ROW_COUNT,
			kind: "OHB",
			groupingReview: "OVERRIDE",
			memberCount: 1,
		});
		revokeEncodedOpenFabStationProposalReviewDraftSnapshot(snapshot);
		expect(currentProcessMaxRssKib()).toBeLessThan(MIXED_SCALE_MAX_RSS_KIB);
	}, 60_000);

	it.skipIf(!RUN_REVIEWED_APPLY_SCALE)(
		"measures the exact secure 100k Review Apply materialization and atomic commit stages",
		async () => {
			const parsed = parseOpenFabStationProposalCsv(mixedScaleSource(SCALE_ROW_COUNT));
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) return;
			const proposal = hydrateOpenFabStationProposalArtifact(parsed.artifact);
			const document = mixedScaleDocument(SCALE_ROW_COUNT);
			const session = createMixedScaleReviewSession(proposal);
			expect(session.getSummary()).toMatchObject({
				captureReady: true,
				includedRowCount: SCALE_ROW_COUNT,
				activeGroupCount: MIXED_SCALE_GROUP_COUNT,
				membershipCount: SCALE_ROW_COUNT,
			});
			const snapshotStartedAt = performance.now();
			const snapshot = captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot;
			const snapshotMilliseconds = performance.now() - snapshotStartedAt;
			const worker = new ScaleReviewRuntimeWorker();
			let checkpoints = 0;
			let measureMainApplySlices = false;
			let applySliceStartedAt = 0;
			let mainApplyMaxActiveSliceMilliseconds = 0;
			worker.onPlanResponse = () => {
				measureMainApplySlices = true;
				applySliceStartedAt = performance.now();
			};
			const bridge = new OpenFabStationProposalReviewBridge(
				() => worker,
				120_000,
				async () => {
					if (measureMainApplySlices) {
						mainApplyMaxActiveSliceMilliseconds = Math.max(
							mainApplyMaxActiveSliceMilliseconds,
							performance.now() - applySliceStartedAt,
						);
					}
					checkpoints++;
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
					if (measureMainApplySlices) applySliceStartedAt = performance.now();
				},
				() => performance.now(),
				4,
			);
			const evaluationStartedAt = performance.now();
			const evaluation = await bridge.evaluate({
				document,
				proposal,
				draftSession: session,
				snapshot,
				generation: 1,
				getGeneration: () => 1,
			});
			const evaluationMilliseconds = performance.now() - evaluationStartedAt;
			expect(evaluation).toMatchObject({
				canApply: true,
				preview: {
					state: "READY",
					includedPortCount: SCALE_ROW_COUNT,
					equipmentGroupCount: MIXED_SCALE_GROUP_COUNT,
				},
			});
			const applyStartedAt = performance.now();
			const prepared = await bridge.apply(evaluation);
			mainApplyMaxActiveSliceMilliseconds = Math.max(
				mainApplyMaxActiveSliceMilliseconds,
				performance.now() - applySliceStartedAt,
			);
			measureMainApplySlices = false;
			const applyMilliseconds = performance.now() - applyStartedAt;
			expect(prepared.apply).toMatchObject({
				kind: "reviewed-port-equipment-apply",
				planKind: "place-port-equipment-batch",
				portCount: SCALE_ROW_COUNT,
				equipmentGroupCount: MIXED_SCALE_GROUP_COUNT,
			});
			expect(prepared.materialization.totalMilliseconds).toBeGreaterThan(0);
			const railWorker = new ScaleRailWorkerPatchSink();
			const railWorkerBridgeStartedAt = performance.now();
			const railWorkerBridge = new RailWorkerBridge(
				document,
				() => undefined,
				() => railWorker,
			);
			const railWorkerBridgeInitializationMilliseconds =
				performance.now() - railWorkerBridgeStartedAt;
			expect(railWorker.syncPostCount).toBe(1);
			let commitCheckpointCount = 0;
			let commitSliceStartedAt = performance.now();
			let commitMaxActiveSliceMilliseconds = 0;
			const commitStartedAt = performance.now();
			const commitResult = await document.commitReviewedPortEquipmentCooperatively(prepared.apply, {
				checkpoint: async () => {
					commitMaxActiveSliceMilliseconds = Math.max(
						commitMaxActiveSliceMilliseconds,
						performance.now() - commitSliceStartedAt,
					);
					commitCheckpointCount++;
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
					commitSliceStartedAt = performance.now();
				},
				now: () => performance.now(),
				sliceMilliseconds: 4,
				preparePatch: (event, checkpoint) =>
					railWorkerBridge.prepareReviewedPortEquipmentPatchCooperatively(event, checkpoint),
			});
			commitMaxActiveSliceMilliseconds = Math.max(
				commitMaxActiveSliceMilliseconds,
				performance.now() - commitSliceStartedAt,
			);
			expect(commitResult.committed).toBe(true);
			expect(commitResult.timings).not.toBeNull();
			const commitMilliseconds = performance.now() - commitStartedAt;
			railWorkerBridge.dispose();
			expect(document.portEquipment).toMatchObject({
				ports: { length: SCALE_ROW_COUNT },
				equipmentGroups: { length: MIXED_SCALE_GROUP_COUNT },
			});
			expect(document.getPatchSequence()).toBe(1);
			expect(worker.terminated).toBe(true);
			expect(railWorker).toMatchObject({
				terminated: true,
				patchPostCount: 1,
				patchPortCount: SCALE_ROW_COUNT,
				patchEquipmentGroupCount: MIXED_SCALE_GROUP_COUNT,
			});
			expect(railWorker.patchTransferBytes).toBeGreaterThan(0);
			expect(checkpoints).toBeGreaterThan(0);
			expect(commitCheckpointCount).toBeGreaterThan(0);
			expect(commitCheckpointCount).toBeLessThan(1_000);
			expect(commitResult.timings?.patchPreparationMilliseconds).toBeGreaterThan(0);
			expect(commitResult.timings?.patchPublicationMilliseconds).toBeLessThan(8);
			// The no-await state/history/typed-patch publication remains inside the final active
			// slice.
			expect(commitMaxActiveSliceMilliseconds).toBeLessThan(20);
			expect(currentProcessMaxRssKib()).toBeLessThan(5 * 1024 * 1024);
			console.info(
				JSON.stringify({
					snapshotMilliseconds,
					evaluationMilliseconds,
					applyMilliseconds,
					workerRoundTripMilliseconds: prepared.workerRoundTripMilliseconds,
					adoptionMilliseconds: prepared.adoptionMilliseconds,
					materialization: prepared.materialization,
					mainApplyMaxActiveSliceMilliseconds,
					railWorkerBridgeInitializationMilliseconds,
					railWorkerPatchTransferBytes: railWorker.patchTransferBytes,
					commitMilliseconds,
					commitMaxActiveSliceMilliseconds,
					commitCheckpointCount,
					commit: commitResult.timings,
					checkpoints,
					maxRssKib: currentProcessMaxRssKib(),
				}),
			);
		},
		240_000,
	);

	it("reviews 100k exclusions and commits a valid 100k mixed batch within bounded time and RSS", () => {
		const totalStartedAt = performance.now();
		const parsed = parseOpenFabStationProposalCsv(mixedScaleSource(SCALE_ROW_COUNT));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const artifact = hydrateOpenFabStationProposalArtifact(parsed.artifact);
		const exclusionDocument = new RailDocument();
		expect(
			exclusionDocument.commit(
				planRailConstruction(exclusionDocument.map, { x: 0, y: 0 }, { x: 4, y: 0 }),
			),
		).toBe(true);
		const exclusionSource = Object.freeze({
			map: exclusionDocument.map,
			portEquipment: exclusionDocument.portEquipment,
			organizations: exclusionDocument.organizations,
			patchSequence: exclusionDocument.getPatchSequence(),
		});

		const excludedStartedAt = performance.now();
		const excluded = evaluateScaleExclusions(artifact, exclusionSource);
		const excludedMilliseconds = performance.now() - excludedStartedAt;
		expect(excluded.evaluation).toMatchObject({
			state: "NO_CHANGES",
			proposalRowCount: SCALE_ROW_COUNT,
			includedPortCount: 0,
			rejectedPortCount: SCALE_ROW_COUNT,
		});
		expect(excluded.readCount()).toBe(SCALE_ROW_COUNT);
		expect(excludedMilliseconds).toBeLessThan(15_000);

		const document = mixedScaleDocument(SCALE_ROW_COUNT);
		const source = Object.freeze({
			map: document.map,
			portEquipment: document.portEquipment,
			organizations: document.organizations,
			patchSequence: document.getPatchSequence(),
		});
		const reviewStartedAt = performance.now();
		const reviewed = evaluateScaleMixedPlacement(artifact, source);
		const reviewMilliseconds = performance.now() - reviewStartedAt;
		expect(reviewed.evaluation).toMatchObject({
			state: "READY",
			proposalRowCount: SCALE_ROW_COUNT,
			includedPortCount: SCALE_ROW_COUNT,
			equipmentGroupCount: MIXED_SCALE_GROUP_COUNT,
		});
		expect(reviewed.readCount()).toBe(SCALE_ROW_COUNT);
		expect(reviewMilliseconds).toBeLessThan(30_000);

		const planStartedAt = performance.now();
		const plan = planReviewedOpenFabStationProposalBatch(
			finalizeOpenFabStationProposalReview(reviewed.evaluation),
			source,
		);
		const planMilliseconds = performance.now() - planStartedAt;
		expect(plan).toMatchObject({
			valid: true,
			kind: "place-port-equipment-batch",
			portMutations: { length: SCALE_ROW_COUNT },
			equipmentGroupMutations: { length: MIXED_SCALE_GROUP_COUNT },
		});
		expect(planMilliseconds).toBeLessThan(5_000);

		const commitStartedAt = performance.now();
		expect(document.commitPortEquipment(plan)).toBe(true);
		const commitMilliseconds = performance.now() - commitStartedAt;
		expect(document.portEquipment).toMatchObject({
			nextPortId: SCALE_ROW_COUNT + 1,
			nextEquipmentGroupId: MIXED_SCALE_GROUP_COUNT + 1,
			ports: { length: SCALE_ROW_COUNT },
			equipmentGroups: { length: MIXED_SCALE_GROUP_COUNT },
		});
		expect(document.getPatchSequence()).toBe(1);
		expect(commitMilliseconds).toBeLessThan(30_000);
		expect(performance.now() - totalStartedAt).toBeLessThan(75_000);
		expect(currentProcessMaxRssKib()).toBeLessThan(MIXED_SCALE_MAX_RSS_KIB);
	}, 120_000);
});

function createMixedScaleReviewSession(proposal: HydratedOpenFabStationProposalArtifact) {
	const session = createOpenFabStationProposalReviewSession(proposal);
	session.dispatch({
		type: "SET_REJECTED_SOURCE_ROWS_POLICY",
		policy: "NOT_APPLICABLE",
	});
	session.dispatch({ type: "SET_UNKNOWN_COLUMNS_POLICY", policy: "NOT_APPLICABLE" });
	session.dispatch({ type: "SET_ORGANIZATION_POLICY", policy: "EXPLICIT_UNASSIGNED" });
	for (let row = 0; row < proposal.rowCount; row++) {
		const kind = mixedScalePortKind(row);
		session.dispatch({
			type: "INCLUDE_ROW",
			decision: {
				row,
				disposition: "INCLUDE",
				identityAction: "CREATE_NEW",
				portType: kind,
				typeReview: "CONFIRM_DECLARED",
				attachmentReview: "USER_SELECTED_EXACT_ROUTE",
				route: {
					kind: "CARDINAL_CELL",
					x: mixedScalePortX(row),
					z: 0,
					from: DIR_W,
					to: DIR_E,
				},
				stationMillimeters: 500,
				stationReview: "CONFIRM_DECLARED",
				side: kind === "OHB" ? "LEFT" : "CENTER",
				lateralOffsetMillimeters: kind === "OHB" ? 700 : 0,
				sideOffsetReview: "CONFIRM_DECLARED",
				direction: "WITH_TRAVEL",
				directionReview: "CONFIRM_DECLARED",
				sourcePositionReview: "NOT_PROVIDED",
			},
		});
		if (row % 4 !== 3) continue;
		const firstRow = row - 3;
		const reviewGroupId = Math.floor(row / 4) * 3 + 1;
		session.dispatch({ type: "CREATE_GROUP", reviewGroupId, kind: "EQ" });
		session.dispatch({
			type: "SET_GROUP_MEMBERS",
			reviewGroupId,
			memberRows: [firstRow, firstRow + 1],
		});
		session.dispatch({ type: "SET_EQ_PITCH", reviewGroupId, pitchMillimeters: 1_000 });
		session.dispatch({ type: "SET_GROUP_REVIEW", reviewGroupId, groupingReview: "OVERRIDE" });
		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: reviewGroupId + 1, kind: "STK" });
		session.dispatch({
			type: "SET_GROUP_MEMBERS",
			reviewGroupId: reviewGroupId + 1,
			memberRows: [firstRow + 2],
		});
		session.dispatch({
			type: "SET_STK_TEMPLATE",
			reviewGroupId: reviewGroupId + 1,
			template: "FLEX",
		});
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: reviewGroupId + 1,
			groupingReview: "OVERRIDE",
		});
		session.dispatch({ type: "CREATE_GROUP", reviewGroupId: reviewGroupId + 2, kind: "OHB" });
		session.dispatch({
			type: "SET_GROUP_MEMBERS",
			reviewGroupId: reviewGroupId + 2,
			memberRows: [firstRow + 3],
		});
		session.dispatch({
			type: "SET_GROUP_REVIEW",
			reviewGroupId: reviewGroupId + 2,
			groupingReview: "OVERRIDE",
		});
	}
	return session;
}

function evaluateScaleExclusions(
	artifact: HydratedOpenFabStationProposalArtifact,
	source: OpenFabStationProposalReviewSource,
): { readonly evaluation: OpenFabStationProposalReviewEvaluation; readCount(): number } {
	let reads = 0;
	const counted = Object.freeze({
		...artifact,
		readRow(row: number) {
			reads++;
			return artifact.readRow(row);
		},
	});
	const evaluation = evaluateOpenFabStationProposalReview(
		counted,
		{
			rowDecisions: Array.from({ length: artifact.rowCount }, (_, row) => ({
				row,
				disposition: "REJECT" as const,
				reason: "USER_EXCLUDED" as const,
			})),
			groupDecisions: [],
			rejectedSourceRowsPolicy: "NOT_APPLICABLE",
			unknownColumnsPolicy: "NOT_APPLICABLE",
			organizationPolicy: "EXPLICIT_UNASSIGNED",
		},
		source,
	);
	return Object.freeze({ evaluation, readCount: () => reads });
}

function evaluateScaleMixedPlacement(
	artifact: HydratedOpenFabStationProposalArtifact,
	source: OpenFabStationProposalReviewSource,
): { readonly evaluation: OpenFabStationProposalReviewEvaluation; readCount(): number } {
	let reads = 0;
	const counted = Object.freeze({
		...artifact,
		readRow(row: number) {
			reads++;
			return artifact.readRow(row);
		},
	});
	const rowDecisions = Array.from({ length: artifact.rowCount }, (_, row) => {
		const kind = mixedScalePortKind(row);
		return {
			row,
			disposition: "INCLUDE" as const,
			identityAction: "CREATE_NEW" as const,
			portType: kind,
			typeReview: "CONFIRM_DECLARED" as const,
			attachmentReview: "USER_SELECTED_EXACT_ROUTE" as const,
			route: {
				kind: "CARDINAL_CELL",
				x: mixedScalePortX(row),
				z: 0,
				from: DIR_W,
				to: DIR_E,
			} as CardinalPortRoute,
			stationMillimeters: 500,
			stationReview: "CONFIRM_DECLARED" as const,
			side: kind === "OHB" ? ("LEFT" as const) : ("CENTER" as const),
			lateralOffsetMillimeters: kind === "OHB" ? 700 : 0,
			sideOffsetReview: "CONFIRM_DECLARED" as const,
			direction: "WITH_TRAVEL" as const,
			directionReview: "CONFIRM_DECLARED" as const,
			sourcePositionReview: "NOT_PROVIDED" as const,
		};
	});
	const groupDecisions = Array.from({ length: artifact.rowCount / 4 }, (_, pattern) => {
		const row = pattern * 4;
		const reviewGroupId = pattern * 3 + 1;
		return [
			{
				reviewGroupId,
				kind: "EQ" as const,
				pitchMillimeters: 1_000,
				recipe: null,
				groupingReview: "OVERRIDE" as const,
				memberRows: [row, row + 1],
			},
			{
				reviewGroupId: reviewGroupId + 1,
				kind: "STK" as const,
				template: "FLEX" as const,
				groupingReview: "OVERRIDE" as const,
				memberRows: [row + 2],
			},
			{
				reviewGroupId: reviewGroupId + 2,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				groupingReview: "OVERRIDE" as const,
				memberRows: [row + 3],
			},
		];
	}).flat();
	const evaluation = evaluateOpenFabStationProposalReview(
		counted,
		{
			rowDecisions,
			groupDecisions,
			rejectedSourceRowsPolicy: "NOT_APPLICABLE",
			unknownColumnsPolicy: "NOT_APPLICABLE",
			organizationPolicy: "EXPLICIT_UNASSIGNED",
		},
		source,
	);
	return Object.freeze({ evaluation, readCount: () => reads });
}

function mixedScaleDocument(rowCount: number): RailDocument {
	const cellCount = (rowCount / 4) * 8;
	const hydrator = TileMap.createHydrator();
	for (let x = 0; x < cellCount; x++) {
		hydrator.addEncodedCell(
			x,
			0,
			encodeRailCell({
				incoming: x === 0 ? 0 : DIR_W,
				outgoing: x === cellCount - 1 ? 0 : DIR_E,
			}),
		);
	}
	return RailDocument.fromLoadedMap(hydrator.finish(1), 0);
}

function mixedScalePortKind(row: number): "EQ" | "STK" | "OHB" {
	const offset = row % 4;
	return offset < 2 ? "EQ" : offset === 2 ? "STK" : "OHB";
}

function mixedScalePortX(row: number): number {
	const base = Math.floor(row / 4) * 8;
	return base + ([1, 2, 4, 6] as const)[row % 4];
}

function currentProcessMaxRssKib(): number {
	const runtimeProcess = (
		globalThis as unknown as {
			readonly process?: { resourceUsage?(): unknown };
		}
	).process;
	const usage = runtimeProcess?.resourceUsage?.();
	if (typeof usage !== "object" || usage === null || !("maxRSS" in usage)) {
		throw new Error("Node resource usage is unavailable in the serialized scale runtime.");
	}
	const maxRSS = usage.maxRSS;
	if (typeof maxRSS !== "number" || !Number.isFinite(maxRSS) || maxRSS < 0) {
		throw new Error("Node maxRSS is invalid in the serialized scale runtime.");
	}
	return maxRSS;
}

function scaleSource(rowCount: number): ArrayBuffer {
	const rows = Array.from({ length: rowCount }, (_, row) =>
		OPENFAB_STATION_PROPOSAL_V1_HEADERS.map((header) => {
			switch (header) {
				case "identity_scope":
					return "synthetic-scope";
				case "port_key":
					return `PORT-${row}`;
				case "attachment_scope":
					return "rail-scope";
				case "attachment_alias":
					return "RAIL-A";
				case "station_mm":
					return String(row);
				case "side":
					return "LEFT";
				case "lateral_offset_mm":
					return "700";
				case "direction":
					return "UNKNOWN";
				case "direction_evidence":
					return "UNKNOWN";
				case "port_type":
					return "OHB";
				default:
					return "";
			}
		}).join(","),
	);
	return new TextEncoder().encode(
		`${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n${rows.join("\n")}\n`,
	).buffer;
}

function mixedScaleSource(rowCount: number): Uint8Array {
	const rows = Array.from({ length: rowCount }, (_, row) => {
		const kind = mixedScalePortKind(row);
		return OPENFAB_STATION_PROPOSAL_V1_HEADERS.map((header) => {
			switch (header) {
				case "identity_scope":
					return "synthetic-mixed-scope";
				case "port_key":
					return `MIXED-${String(row).padStart(6, "0")}`;
				case "attachment_scope":
					return "synthetic-mixed-rail";
				case "attachment_alias":
					return "SYNTHETIC-STRAIGHT";
				case "station_mm":
					return "500";
				case "side":
					return kind === "OHB" ? "LEFT" : "CENTER";
				case "lateral_offset_mm":
					return kind === "OHB" ? "700" : "0";
				case "direction":
					return "WITH_TRAVEL";
				case "direction_evidence":
					return "DECLARED";
				case "port_type":
					return kind;
				default:
					return "";
			}
		}).join(",");
	});
	return new TextEncoder().encode(
		`${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n${rows.join("\n")}\n`,
	);
}

function aliasScaleSource(rowCount: number, aliasesPerRow: number): Uint8Array {
	const headers = [
		"identity_scope",
		"port_key",
		"secondary_aliases",
		"attachment_scope",
		"attachment_alias",
		"station_mm",
		"side",
		"lateral_offset_mm",
		"direction",
		"direction_evidence",
		"port_type",
	] as const;
	const rows = Array.from({ length: rowCount }, (_, row) => {
		const aliases = Array.from(
			{ length: aliasesPerRow },
			(_, alias) => `ALIAS-${row}-${alias}`,
		).join("|");
		return `synthetic-scope,PORT-${row},${aliases},rail-scope,RAIL-A,${row},CENTER,0,UNKNOWN,UNKNOWN,OHB`;
	});
	return new TextEncoder().encode(`${headers.join(",")}\n${rows.join("\n")}\n`);
}
