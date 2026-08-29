import { describe, expect, it } from "vitest";
import type { OpenFabStationProposalReviewDraft } from "../compile/OpenFabStationProposalReview";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	adoptOpenFabStationProposalReviewDraftSnapshot,
	adoptOpenFabStationProposalReviewDraftSnapshotCooperatively,
	collectOpenFabStationProposalReviewDraftSnapshotTransfers,
	decodeAdoptedOpenFabStationProposalReviewDraftSnapshot,
	decodeOpenFabStationProposalReviewDraftSnapshot,
	encodeOpenFabStationProposalReviewDraftCooperatively,
	OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT,
	OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_MAX_BYTES,
	type OpenFabStationProposalReviewDraftSnapshot,
	type OpenFabStationProposalReviewDraftSnapshotSource,
	openFabStationProposalReviewDraftSnapshotFingerprint,
	openFabStationProposalReviewDraftSnapshotShallowShapeError,
	openFabStationProposalReviewDraftSnapshotShapeError,
	releaseAdoptedOpenFabStationProposalReviewDraftSnapshotTransfer,
	releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer,
	sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively,
	validateOpenFabStationProposalReviewDraftSnapshot,
} from "./OpenFabStationProposalReviewDraftSoA";

const NOOP_OPTIONS = Object.freeze({ checkpoint: async () => {}, revision: () => 0 });
const NODE_PROCESS = (
	globalThis as typeof globalThis & {
		readonly process?: {
			readonly env: Readonly<Record<string, string | undefined>>;
			memoryUsage(): { readonly rss: number };
		};
	}
).process;
const RUN_DRAFT_SOA_SCALE = NODE_PROCESS?.env.OPENFAB_DRAFT_SOA_SCALE === "1";

function residentSetBytes(): number {
	if (!NODE_PROCESS) throw new Error("NODE_PROCESS_REQUIRED_FOR_SCALE_MEASUREMENT");
	return NODE_PROCESS.memoryUsage().rss;
}

describe("OpenFab station proposal review draft SoA", () => {
	it("round-trips mixed cardinal and advanced decisions with deterministic order-sensitive evidence", async () => {
		const draft = mixedDraft();
		const first = await encodeOpenFabStationProposalReviewDraftCooperatively(
			draft,
			4,
			NOOP_OPTIONS,
		);
		const second = await encodeOpenFabStationProposalReviewDraftCooperatively(
			draft,
			4,
			NOOP_OPTIONS,
		);

		expect(first).toMatchObject({
			proposalRowCount: 4,
			decisionCount: 4,
			groupCount: 2,
			membershipCount: 3,
			byteLength: 222,
		});
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(openFabStationProposalReviewDraftSnapshotFingerprint(first)).toBe(first.fingerprint);
		expect(openFabStationProposalReviewDraftSnapshotShapeError(first)).toBeNull();
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(first)).toEqual(draft);

		const reversedDraft: OpenFabStationProposalReviewDraft = {
			...draft,
			rowDecisions: [...draft.rowDecisions].reverse(),
		};
		const reversed = await encodeOpenFabStationProposalReviewDraftCooperatively(
			reversedDraft,
			4,
			NOOP_OPTIONS,
		);
		expect(reversed.fingerprint).not.toBe(first.fingerprint);
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(reversed).rowDecisions).toEqual(
			reversedDraft.rowDecisions,
		);
	});

	it("collects every exact owned buffer once and survives a real structured-clone transfer", async () => {
		const snapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(
			mixedDraft(),
			4,
			NOOP_OPTIONS,
		);
		const transfers = collectOpenFabStationProposalReviewDraftSnapshotTransfers(snapshot);
		expect(transfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT);
		expect(new Set(transfers).size).toBe(transfers.length);
		expect(transfers.reduce((total, buffer) => total + buffer.byteLength, 0)).toBe(
			snapshot.byteLength,
		);

		const delivered = structuredClone(snapshot, { transfer: transfers });
		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(() => validateOpenFabStationProposalReviewDraftSnapshot(delivered)).not.toThrow();
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(delivered)).toEqual(mixedDraft());
	});

	it("releases only the encoder's exact fresh snapshot identity once", async () => {
		const snapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(
			mixedDraft(),
			4,
			NOOP_OPTIONS,
		);
		const released = releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(snapshot);
		expect(released.snapshot).toBe(snapshot);
		expect(released.transfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT);
		expect(new Set(released.transfers).size).toBe(released.transfers.length);
		expect(() => releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(snapshot)).toThrow(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);

		const delivered = structuredClone(released.snapshot, { transfer: [...released.transfers] });
		expect(released.transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(delivered)).toEqual(mixedDraft());
		expect(() =>
			releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer({
				...delivered,
			}),
		).toThrow("SNAPSHOT_CONTRACT_MISMATCH");
	});

	it("privately adopts fresh copied columns into an equivalent one-shot snapshot without detaching persistent columns", async () => {
		const draft = mixedDraft();
		const persistent = await encodeOpenFabStationProposalReviewDraftCooperatively(
			draft,
			4,
			NOOP_OPTIONS,
		);
		const persistentBuffers = collectOpenFabStationProposalReviewDraftSnapshotTransfers(persistent);
		const persistentByteLengths = persistentBuffers.map((buffer) => buffer.byteLength);
		const source = freshSnapshotSource(persistent);
		const sourceBuffers = snapshotSourceBuffers(source);
		const sourceByteLengths = sourceBuffers.map((buffer) => buffer.byteLength);
		const sourceDecisionRows = source.decisionRows;
		const sourceGroupMemberRows = source.groupMemberRows;

		expect(sourceBuffers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT);
		expect(new Set(sourceBuffers).size).toBe(sourceBuffers.length);
		expect(sourceBuffers.every((buffer) => !new Set(persistentBuffers).has(buffer))).toBe(true);

		const sealed = await sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(
			source,
			NOOP_OPTIONS,
		);

		const sealedBuffers = collectOpenFabStationProposalReviewDraftSnapshotTransfers(sealed);
		expect(Object.is(sealed.decisionRows, sourceDecisionRows)).toBe(false);
		expect(Object.isExtensible(sealed.decisionRows)).toBe(false);
		expect(Object.is(sealed.groupMemberRows, sourceGroupMemberRows)).toBe(false);
		expect(sourceBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(sealedBuffers.map((buffer) => buffer.byteLength)).toEqual(sourceByteLengths);
		expect(sealed.fingerprint).toBe(persistent.fingerprint);
		expect(openFabStationProposalReviewDraftSnapshotFingerprint(sealed)).toBe(sealed.fingerprint);
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(sealed)).toBeNull();
		expect(openFabStationProposalReviewDraftSnapshotShapeError(sealed)).toBeNull();
		expect(() => validateOpenFabStationProposalReviewDraftSnapshot(sealed)).not.toThrow();
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(sealed)).toEqual(draft);
		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(source, NOOP_OPTIONS),
		).rejects.toThrow(/SNAPSHOT_(?:BUFFER_OWNERSHIP|TYPED_ARRAY)_MISMATCH/);

		const released = releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(sealed);
		expect(released.snapshot).toBe(sealed);
		expect(released.transfers).toEqual(sealedBuffers);
		expect(() => releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(sealed)).toThrow(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);
		const delivered = structuredClone(released.snapshot, {
			transfer: [...released.transfers],
		});

		expect(sealedBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(persistentBuffers.map((buffer) => buffer.byteLength)).toEqual(persistentByteLengths);
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(persistent)).toEqual(draft);
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(delivered)).toEqual(draft);
	});

	it("descriptor-captures an exact source and rejects accessors or extra keys without reading them", async () => {
		const persistent = await oneDecisionSnapshot();
		const accessorSource = freshSnapshotSource(persistent) as unknown as Record<string, unknown>;
		let accessorCalls = 0;
		Object.defineProperty(accessorSource, "decisionCount", {
			enumerable: true,
			configurable: true,
			get() {
				accessorCalls++;
				return 1;
			},
		});

		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(
				accessorSource as unknown as OpenFabStationProposalReviewDraftSnapshotSource,
				NOOP_OPTIONS,
			),
		).rejects.toThrow("INVALID_INPUT");
		expect(accessorCalls).toBe(0);

		const extraSource = Object.assign(freshSnapshotSource(persistent), { extra: true });
		const extraBuffers = snapshotSourceBuffers(extraSource);
		const extraBufferByteLengths = extraBuffers.map((buffer) => buffer.byteLength);
		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(
				extraSource as OpenFabStationProposalReviewDraftSnapshotSource,
				NOOP_OPTIONS,
			),
		).rejects.toThrow("INVALID_INPUT");
		expect(extraBuffers.map((buffer) => buffer.byteLength)).toEqual(extraBufferByteLengths);
	});

	it.each([
		["enumerable string", "visible-review-metadata", true],
		["hidden string", "hidden-review-metadata", false],
		["symbol", Symbol("review-metadata"), false],
	] as const)("rejects a %s own property on a source typed view after terminal transfer", async (_label, key, enumerable) => {
		const persistent = await oneDecisionSnapshot();
		const source = freshSnapshotSource(persistent);
		const sourceView = source.decisionRows;
		Object.defineProperty(sourceView, key, {
			value: "discarded by structured clone",
			enumerable,
			configurable: true,
		});

		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(source, NOOP_OPTIONS),
		).rejects.toThrow("SNAPSHOT_TYPED_ARRAY_MISMATCH");
		expect(sourceView.byteLength).toBe(0);
		expect(Reflect.ownKeys(sourceView)).toContain(key);
	});

	it.each([
		["enumerable string", "visible-buffer-metadata", true],
		["hidden string", "hidden-buffer-metadata", false],
		["symbol", Symbol("buffer-metadata"), false],
	] as const)("rejects a %s own property on a source backing ArrayBuffer before transfer", async (_label, key, enumerable) => {
		const persistent = await oneDecisionSnapshot();
		const source = freshSnapshotSource(persistent);
		const sourceBuffer = source.decisionRows.buffer;
		Object.defineProperty(sourceBuffer, key, {
			value: "discarded by structured clone",
			enumerable,
			configurable: true,
		});

		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(source, NOOP_OPTIONS),
		).rejects.toThrow("SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH");
		expect(sourceBuffer.byteLength).toBeGreaterThan(0);
	});

	it("rejects a source backing ArrayBuffer with a custom prototype before transfer", async () => {
		const persistent = await oneDecisionSnapshot();
		const source = freshSnapshotSource(persistent);
		const sourceBuffer = source.decisionRows.buffer;
		Object.setPrototypeOf(sourceBuffer, Object.create(ArrayBuffer.prototype));

		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(source, NOOP_OPTIONS),
		).rejects.toThrow("SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH");
		expect(source.decisionRows.byteLength).toBeGreaterThan(0);
	});

	it("rejects custom typed-view metadata at the snapshot adoption boundary", async () => {
		const source = cloneSnapshot(await oneDecisionSnapshot());
		const sourceView = source.decisionRows;
		Object.defineProperty(sourceView, "hidden-review-metadata", {
			value: true,
			enumerable: false,
			configurable: true,
		});

		await expect(
			adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(source, {
				checkpoint: async () => undefined,
			}),
		).rejects.toThrow("SNAPSHOT_TYPED_ARRAY_MISMATCH");
		expect(sourceView.byteLength).toBe(0);
	});

	it("rejects custom typed-view metadata before synchronous compatibility transfer collection", async () => {
		const source = cloneSnapshot(await oneDecisionSnapshot());
		const sourceView = source.decisionRows;
		Object.defineProperty(sourceView, Symbol("review-metadata"), {
			value: true,
			configurable: true,
		});

		expect(() => collectOpenFabStationProposalReviewDraftSnapshotTransfers(source)).toThrow(
			"SNAPSHOT_TYPED_ARRAY_MISMATCH",
		);
		expect(sourceView.byteLength).toBeGreaterThan(0);
	});

	it("observes descriptor-time cancellation before source sealing consumes ownership", async () => {
		const persistent = await oneDecisionSnapshot();
		const source = freshSnapshotSource(persistent);
		const sourceBuffers = snapshotSourceBuffers(source);
		const sourceByteLengths = sourceBuffers.map((buffer) => buffer.byteLength);
		const controller = new AbortController();
		let descriptorCount = 0;
		const cancellingSource = new Proxy(source, {
			getOwnPropertyDescriptor(target, key) {
				descriptorCount++;
				if (descriptorCount === 1) controller.abort();
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});

		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(cancellingSource, {
				checkpoint: async () => {},
				revision: () => 1,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED",
		});
		expect(descriptorCount).toBeGreaterThan(0);
		expect(sourceBuffers.map((buffer) => buffer.byteLength)).toEqual(sourceByteLengths);
	});

	it("rejects noncanonical values plus aliased and partial source buffers without minting authority", async () => {
		const persistent = await encodeOpenFabStationProposalReviewDraftCooperatively(
			mixedDraft(),
			4,
			NOOP_OPTIONS,
		);

		const invalidValue = mutableSnapshotSource(freshSnapshotSource(persistent));
		const invalidValueBuffers = snapshotSourceBuffers(invalidValue);
		invalidValue.decisionDispositions[0] = 255;
		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(invalidValue, NOOP_OPTIONS),
		).rejects.toThrow("SNAPSHOT_VALUE_MISMATCH");
		expect(invalidValueBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);

		const aliased = mutableSnapshotSource(freshSnapshotSource(persistent));
		aliased.rejectReasons = aliased.decisionDispositions;
		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(aliased, NOOP_OPTIONS),
		).rejects.toThrow("SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH");

		const partial = mutableSnapshotSource(freshSnapshotSource(persistent));
		partial.decisionRows = new Int32Array(
			new ArrayBuffer((partial.decisionCount + 1) * Int32Array.BYTES_PER_ELEMENT),
			Int32Array.BYTES_PER_ELEMENT,
			partial.decisionCount,
		);
		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(partial, NOOP_OPTIONS),
		).rejects.toThrow("SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH");
	});

	it("aborts source sealing when its monotonic revision changes across a checkpoint", async () => {
		const persistent = await encodeOpenFabStationProposalReviewDraftCooperatively(
			mixedDraft(),
			4,
			NOOP_OPTIONS,
		);
		const source = freshSnapshotSource(persistent);
		const sourceBuffers = snapshotSourceBuffers(source);
		const persistentBuffers = collectOpenFabStationProposalReviewDraftSnapshotTransfers(persistent);
		const persistentBufferByteLengths = persistentBuffers.map((buffer) => buffer.byteLength);
		let revision = 0;
		let checkpoints = 0;
		let clock = 0;

		await expect(
			sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(source, {
				checkpoint: async () => {
					checkpoints++;
					revision++;
				},
				revision: () => revision,
				now: () => (clock += 5),
				sliceMilliseconds: 4,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED",
		});
		expect(checkpoints).toBe(1);
		expect(sourceBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(persistentBuffers.map((buffer) => buffer.byteLength)).toEqual(
			persistentBufferByteLengths,
		);
	});

	it("transfers source ownership before a stable-revision cooperative checkpoint can mutate it", async () => {
		const persistent = await encodeOpenFabStationProposalReviewDraftCooperatively(
			mixedDraft(),
			4,
			NOOP_OPTIONS,
		);
		const source = freshSnapshotSource(persistent);
		const sourceBuffers = snapshotSourceBuffers(source);
		let clock = 0;
		let checkpointCount = 0;

		const sealed = await sealOpenFabStationProposalReviewDraftSnapshotSourceCooperatively(source, {
			checkpoint: async () => {
				checkpointCount += 1;
				source.decisionDispositions[0] = 255;
			},
			revision: () => 1,
			now: () => (clock += 5),
			sliceMilliseconds: 4,
		});

		expect(checkpointCount).toBeGreaterThan(0);
		expect(sourceBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(sealed)).toEqual(mixedDraft());
		releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(sealed);
	});

	it("adopts a private identity for Worker decode and releases transfer ownership once", async () => {
		const source = await encodeOpenFabStationProposalReviewDraftCooperatively(
			mixedDraft(),
			4,
			NOOP_OPTIONS,
		);
		const handle = adoptOpenFabStationProposalReviewDraftSnapshot(source);

		expect(source.decisionRows.byteLength).toBe(0);
		expect(() => releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(source)).toThrow(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);
		expect(handle).toMatchObject({
			kind: "adopted-openfab-station-proposal-review-draft-snapshot",
			decisionCount: 4,
			groupCount: 2,
		});
		expect(decodeAdoptedOpenFabStationProposalReviewDraftSnapshot(handle)).toEqual(mixedDraft());

		const released = releaseAdoptedOpenFabStationProposalReviewDraftSnapshotTransfer(handle);
		expect(released.transfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT);
		expect(() => decodeAdoptedOpenFabStationProposalReviewDraftSnapshot(handle)).toThrow(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);
		expect(() => releaseAdoptedOpenFabStationProposalReviewDraftSnapshotTransfer(handle)).toThrow(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);
	});

	it("terminally consumes exact fresh authority during cooperative adoption", async () => {
		const source = await oneDecisionSnapshot();
		const handle = await adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(source, {
			checkpoint: async () => {},
		});

		expect(source.decisionRows.byteLength).toBe(0);
		expect(() => releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(source)).toThrow(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);
		expect(decodeAdoptedOpenFabStationProposalReviewDraftSnapshot(handle)).toEqual({
			...emptyDraft(),
			rowDecisions: [{ row: 0, disposition: "REJECT", reason: "USER_EXCLUDED" }],
		});
		releaseAdoptedOpenFabStationProposalReviewDraftSnapshotTransfer(handle);
	});

	it("never releases a fresh identity whose shared buffers were detached through an alias", async () => {
		const source = await oneDecisionSnapshot();
		const alias = { ...source };
		const handle = adoptOpenFabStationProposalReviewDraftSnapshot(alias);

		expect(source.decisionRows.byteLength).toBe(0);
		expect(() => releaseEncodedOpenFabStationProposalReviewDraftSnapshotTransfer(source)).toThrow(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);
		expect(decodeAdoptedOpenFabStationProposalReviewDraftSnapshot(handle)).toMatchObject({
			rowDecisions: [{ row: 0, disposition: "REJECT", reason: "USER_EXCLUDED" }],
		});
		releaseAdoptedOpenFabStationProposalReviewDraftSnapshotTransfer(handle);
	});

	it("captures an outer identity once against alternating Proxy decode and transfer traps", async () => {
		const source = mutableSnapshot(await oneDecisionSnapshot());
		const rogueRows = new Int32Array([777]);
		let getTrapCalls = 0;
		const alternating = new Proxy(source, {
			get(target, key, receiver) {
				getTrapCalls++;
				if (key === "decisionCount") return 0x1_0000_0000;
				if (key === "decisionRows") return rogueRows;
				return Reflect.get(target, key, receiver);
			},
		});

		expect(decodeOpenFabStationProposalReviewDraftSnapshot(alternating)).toEqual(
			decodeOpenFabStationProposalReviewDraftSnapshot(source),
		);
		const transfers = collectOpenFabStationProposalReviewDraftSnapshotTransfers(alternating);
		expect(getTrapCalls).toBe(0);
		expect(transfers[0]).toBe(source.decisionRows.buffer);
		expect(transfers[0]).not.toBe(rogueRows.buffer);

		const descriptorSpoof = new Proxy(source, {
			getOwnPropertyDescriptor(target, key) {
				const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
				if (key !== "decisionCount" || !descriptor || !("value" in descriptor)) {
					return descriptor;
				}
				return { ...descriptor, value: 0x1_0000_0000 };
			},
		});
		expect(() => decodeOpenFabStationProposalReviewDraftSnapshot(descriptorSpoof)).toThrow(
			"SNAPSHOT_SCALAR_MISMATCH",
		);
		expect(() =>
			collectOpenFabStationProposalReviewDraftSnapshotTransfers(descriptorSpoof),
		).toThrow("SNAPSHOT_SCALAR_MISMATCH");
	});

	it("descriptor-captures fixed draft prefixes and nested records without invoking get traps", async () => {
		let getTrapCalls = 0;
		const firstDecisionTarget = {
			row: 0,
			disposition: "REJECT" as const,
			reason: "USER_EXCLUDED" as const,
		};
		const secondDecisionTarget = {
			row: 1,
			disposition: "INCLUDE" as const,
			identityAction: "CREATE_NEW" as const,
			portType: "EQ" as const,
			typeReview: "CONFIRM_DECLARED" as const,
			attachmentReview: "USER_SELECTED_EXACT_ROUTE" as const,
			route: new Proxy(
				{ kind: "CARDINAL_CELL" as const, x: 10, z: 0, from: DIR_W, to: DIR_E },
				{
					get(target, key, receiver) {
						getTrapCalls++;
						if (key === "x") return 999;
						return Reflect.get(target, key, receiver);
					},
				},
			),
			stationMillimeters: 500,
			stationReview: "CONFIRM_DECLARED" as const,
			side: "CENTER" as const,
			lateralOffsetMillimeters: 0,
			sideOffsetReview: "CONFIRM_DECLARED" as const,
			direction: "WITH_TRAVEL" as const,
			directionReview: "CONFIRM_DECLARED" as const,
			sourcePositionReview: "NOT_PROVIDED" as const,
		};
		const firstDecision = new Proxy(firstDecisionTarget, {
			get(target, key, receiver) {
				getTrapCalls++;
				if (key === "reason") return "UNSUPPORTED";
				return Reflect.get(target, key, receiver);
			},
		});
		const decisionTargets = [firstDecision, secondDecisionTarget];
		const rowDecisions = new Proxy(decisionTargets, {
			get(target, key, receiver) {
				getTrapCalls++;
				if (key === "0") secondDecisionTarget.stationMillimeters = 999;
				return Reflect.get(target, key, receiver);
			},
		});

		const memberTargets = [0];
		const memberRows = new Proxy(memberTargets, {
			get(target, key, receiver) {
				getTrapCalls++;
				if (key === "0") return 1;
				return Reflect.get(target, key, receiver);
			},
		});
		const groupTarget = {
			reviewGroupId: 7,
			kind: "OHB" as const,
			template: "SINGLE" as const,
			groupingReview: "CONFIRM_DECLARED" as const,
			memberRows,
		};
		const group = new Proxy(groupTarget, {
			get(target, key, receiver) {
				getTrapCalls++;
				if (key === "reviewGroupId") return 99;
				return Reflect.get(target, key, receiver);
			},
		});
		const groupTargets = [group];
		const groupDecisions = new Proxy(groupTargets, {
			get(target, key, receiver) {
				getTrapCalls++;
				return Reflect.get(target, key, receiver);
			},
		});
		const draftTarget: OpenFabStationProposalReviewDraft = {
			...emptyDraft(),
			rowDecisions: rowDecisions as OpenFabStationProposalReviewDraft["rowDecisions"],
			groupDecisions: groupDecisions as OpenFabStationProposalReviewDraft["groupDecisions"],
		};
		const draft = new Proxy(draftTarget, {
			get(target, key, receiver) {
				getTrapCalls++;
				return Reflect.get(target, key, receiver);
			},
		});

		const snapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(
			draft,
			2,
			NOOP_OPTIONS,
		);
		const decoded = decodeOpenFabStationProposalReviewDraftSnapshot(snapshot);
		expect(getTrapCalls).toBe(0);
		expect(decoded.rowDecisions[0]).toMatchObject({ reason: "USER_EXCLUDED" });
		expect(decoded.rowDecisions[1]).toMatchObject({
			stationMillimeters: 500,
			route: { x: 10 },
		});
		expect(decoded.groupDecisions[0]).toMatchObject({ reviewGroupId: 7, memberRows: [0] });
	});

	it("rejects array-index and nested accessors without invoking them", async () => {
		let indexGetterCalls = 0;
		const accessorRows: OpenFabStationProposalReviewDraft["rowDecisions"] = [];
		Object.defineProperty(accessorRows, "0", {
			enumerable: true,
			configurable: true,
			get() {
				indexGetterCalls++;
				return { row: 0, disposition: "REJECT", reason: "USER_EXCLUDED" };
			},
		});
		Object.defineProperty(accessorRows, "length", { value: 1 });
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(
				{ ...emptyDraft(), rowDecisions: accessorRows },
				1,
				NOOP_OPTIONS,
			),
		).rejects.toThrow("INVALID_INPUT");
		expect(indexGetterCalls).toBe(0);

		let nestedGetterCalls = 0;
		const nestedAccessor = {
			row: 0,
			disposition: "REJECT" as const,
			get reason(): "USER_EXCLUDED" {
				nestedGetterCalls++;
				return "USER_EXCLUDED";
			},
		};
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(
				{ ...emptyDraft(), rowDecisions: [nestedAccessor] },
				1,
				NOOP_OPTIONS,
			),
		).rejects.toThrow("INVALID_INPUT");
		expect(nestedGetterCalls).toBe(0);
	});

	it("preserves duplicate, missing, out-of-range, and boundary int32 row evidence", async () => {
		const draft: OpenFabStationProposalReviewDraft = {
			rowDecisions: [
				{ row: 0, disposition: "REJECT", reason: "USER_EXCLUDED" },
				{ row: 0, disposition: "REJECT", reason: "UNRESOLVED" },
				{ row: -0x8000_0000, disposition: "REJECT", reason: "UNSUPPORTED" },
				{ row: 0x7fff_ffff, disposition: "REJECT", reason: "USER_EXCLUDED" },
			],
			groupDecisions: [
				{
					reviewGroupId: 1,
					kind: "OHB",
					template: "SINGLE",
					groupingReview: "OVERRIDE",
					memberRows: [-1, 0, 0, 0x7fff_ffff],
				},
			],
			rejectedSourceRowsPolicy: "NOT_APPLICABLE",
			unknownColumnsPolicy: "NOT_APPLICABLE",
			organizationPolicy: "EXPLICIT_UNASSIGNED",
		};

		const snapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(
			draft,
			4,
			NOOP_OPTIONS,
		);
		expect(Array.from(snapshot.decisionRows)).toEqual([0, 0, -0x8000_0000, 0x7fff_ffff]);
		expect(Array.from(snapshot.groupMemberRows)).toEqual([-1, 0, 0, 0x7fff_ffff]);
		expect(decodeOpenFabStationProposalReviewDraftSnapshot(snapshot)).toEqual(draft);
	});

	it("rejects excess counts and membership before constructing an oversized snapshot", async () => {
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(emptyDraft(), 100_001, NOOP_OPTIONS),
		).rejects.toThrow("CAPACITY_EXCEEDED");
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(
				{
					...emptyDraft(),
					rowDecisions: [
						{ row: 0, disposition: "REJECT", reason: "USER_EXCLUDED" },
						{ row: 1, disposition: "REJECT", reason: "USER_EXCLUDED" },
					],
				},
				1,
				NOOP_OPTIONS,
			),
		).rejects.toThrow("CAPACITY_EXCEEDED");
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(
				{
					...emptyDraft(),
					groupDecisions: [
						{
							reviewGroupId: 1,
							kind: "OHB",
							template: "SINGLE",
							groupingReview: "OVERRIDE",
							memberRows: [0, 0],
						},
					],
				},
				1,
				NOOP_OPTIONS,
			),
		).rejects.toThrow("CAPACITY_EXCEEDED");
	});

	it("fails closed for extra/accessor keys and wrong typed-array kinds", async () => {
		const snapshot = await oneDecisionSnapshot();
		const extra = { ...cloneSnapshot(snapshot), extra: true };
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(extra)).toBe(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);

		const accessor = cloneSnapshot(snapshot) as unknown as Record<string, unknown>;
		Object.defineProperty(accessor, "fingerprint", {
			enumerable: true,
			configurable: true,
			get() {
				throw new Error("SECRET_ACCESSOR_TEXT");
			},
		});
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(accessor)).toBe(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);

		const nonEnumerable = cloneSnapshot(snapshot) as unknown as Record<string, unknown>;
		Object.defineProperty(nonEnumerable, "fingerprint", {
			value: snapshot.fingerprint,
			enumerable: false,
			configurable: true,
			writable: true,
		});
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(nonEnumerable)).toBe(
			"SNAPSHOT_CONTRACT_MISMATCH",
		);

		const wrongType = mutableSnapshot(snapshot);
		(wrongType as unknown as { decisionRows: unknown }).decisionRows = new Uint32Array([0]);
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(wrongType)).toBe(
			"SNAPSHOT_TYPED_ARRAY_MISMATCH",
		);
	});

	it("rejects shared, partial, aliased, detached, and wrong-length buffers", async () => {
		const snapshot = await oneDecisionSnapshot();
		if (typeof SharedArrayBuffer !== "undefined") {
			const shared = mutableSnapshot(snapshot);
			shared.decisionRows = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
			expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(shared)).toBe(
				"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
			);

			const decoy = mutableSnapshot(snapshot);
			const sharedView = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
			Object.defineProperty(sharedView, "buffer", {
				value: new ArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
			});
			decoy.decisionRows = sharedView;
			expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(decoy)).toBe(
				"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
			);
		}

		const sideEffect = mutableSnapshot(snapshot);
		let byteLengthReads = 0;
		const shadowedView = new Int32Array(1);
		Object.defineProperty(shadowedView, "byteLength", {
			get() {
				byteLengthReads++;
				return Int32Array.BYTES_PER_ELEMENT;
			},
		});
		sideEffect.decisionRows = shadowedView;
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(sideEffect)).toBe(
			"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
		);
		expect(byteLengthReads).toBe(0);

		class DerivedInt32Array extends Int32Array {}
		const derived = mutableSnapshot(snapshot);
		derived.decisionRows = new DerivedInt32Array(1);
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(derived)).toBe(
			"SNAPSHOT_TYPED_ARRAY_MISMATCH",
		);

		const partial = mutableSnapshot(snapshot);
		partial.decisionRows = new Int32Array(new ArrayBuffer(8), 4, 1);
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(partial)).toBe(
			"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
		);

		const aliased = mutableSnapshot(snapshot);
		aliased.rejectReasons = aliased.decisionDispositions;
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(aliased)).toBe(
			"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
		);

		const detached = mutableSnapshot(snapshot);
		structuredClone(detached.decisionRows.buffer, { transfer: [detached.decisionRows.buffer] });
		expect(detached.decisionRows.byteLength).toBe(0);
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(detached)).toBe(
			"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
		);

		const empty = mutableSnapshot(
			await encodeOpenFabStationProposalReviewDraftCooperatively(emptyDraft(), 0, NOOP_OPTIONS),
		);
		structuredClone(empty.decisionRows.buffer, { transfer: [empty.decisionRows.buffer] });
		expect(empty.decisionRows.byteLength).toBe(0);
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(empty)).toBe(
			"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
		);

		const wrongLength = mutableSnapshot(snapshot);
		wrongLength.decisionRows = new Int32Array(2);
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(wrongLength)).toBe(
			"SNAPSHOT_LENGTH_MISMATCH",
		);
	});

	it("rejects resizable ArrayBuffers even when an own property shadows the intrinsic state", async () => {
		const resizableGetter = Object.getOwnPropertyDescriptor(
			ArrayBuffer.prototype,
			"resizable",
		)?.get;
		if (resizableGetter === undefined) return;
		let buffer: ArrayBuffer;
		try {
			const ResizableArrayBuffer = ArrayBuffer as typeof ArrayBuffer & {
				new (byteLength: number, options: { maxByteLength: number }): ArrayBuffer;
			};
			buffer = new ResizableArrayBuffer(4, { maxByteLength: 8 });
		} catch {
			return;
		}
		if (Reflect.apply(resizableGetter, buffer, []) !== true) return;
		Object.defineProperty(buffer, "resizable", { value: false });

		const snapshot = mutableSnapshot(await oneDecisionSnapshot());
		snapshot.decisionRows = new Int32Array(buffer);
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(snapshot)).toBe(
			"SNAPSHOT_BUFFER_OWNERSHIP_MISMATCH",
		);
	});

	it("rejects noncanonical values, corrupt CSR, fingerprints, and declared over-budget payloads", async () => {
		const snapshot = await oneDecisionSnapshot();
		const invalidValue = mutableSnapshot(snapshot);
		invalidValue.decisionDispositions[0] = 255;
		expect(openFabStationProposalReviewDraftSnapshotShapeError(invalidValue)).toBe(
			"SNAPSHOT_VALUE_MISMATCH",
		);

		const mixed = mutableSnapshot(
			await encodeOpenFabStationProposalReviewDraftCooperatively(mixedDraft(), 4, NOOP_OPTIONS),
		);
		mixed.groupMemberOffsets[0] = 1;
		expect(openFabStationProposalReviewDraftSnapshotShapeError(mixed)).toBe(
			"SNAPSHOT_CSR_MISMATCH",
		);

		const fingerprint = mutableSnapshot(snapshot);
		fingerprint.fingerprint = "openfab-station-proposal-review-draft:v1:00000000:00000000";
		expect(openFabStationProposalReviewDraftSnapshotShapeError(fingerprint)).toBe(
			"SNAPSHOT_FINGERPRINT_MISMATCH",
		);

		const overBudget = mutableSnapshot(snapshot);
		overBudget.byteLength = OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_MAX_BYTES + 1;
		expect(openFabStationProposalReviewDraftSnapshotShallowShapeError(overBudget)).toBe(
			"BYTE_LIMIT_EXCEEDED",
		);
	});

	it("terminally consumes a shallow-valid noncanonical payload during cooperative adoption", async () => {
		const invalid = mutableSnapshot(await oneDecisionSnapshot());
		invalid.decisionDispositions[0] = 255;
		invalid.fingerprint = openFabStationProposalReviewDraftSnapshotFingerprint(invalid);

		await expect(
			adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(invalid, {
				checkpoint: async () => {},
			}),
		).rejects.toThrow("SNAPSHOT_VALUE_MISMATCH");
		expect(invalid.decisionRows.byteLength).toBe(0);
		expect(invalid.decisionDispositions.byteLength).toBe(0);
	});

	it("observes descriptor-time cancellation before cooperative adoption consumes ownership", async () => {
		const source = mutableSnapshot(await oneDecisionSnapshot());
		const controller = new AbortController();
		let descriptorCount = 0;
		const cancellingSource = new Proxy(source, {
			getOwnPropertyDescriptor(target, key) {
				descriptorCount++;
				if (descriptorCount === 1) controller.abort();
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});

		await expect(
			adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(cancellingSource, {
				checkpoint: async () => {},
				signal: controller.signal,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED",
		});
		expect(descriptorCount).toBeGreaterThan(0);
		expect(source.decisionRows.byteLength).toBe(Int32Array.BYTES_PER_ELEMENT);
	});

	it("normalizes hostile input failures without reflecting input text", async () => {
		const hostile = emptyDraft() as unknown as Record<string, unknown>;
		Object.defineProperty(hostile, "rowDecisions", {
			enumerable: true,
			get() {
				throw new Error("SECRET_ROW_IDENTIFIER");
			},
		});
		let error: unknown;
		try {
			await encodeOpenFabStationProposalReviewDraftCooperatively(
				hostile as unknown as OpenFabStationProposalReviewDraft,
				1,
				NOOP_OPTIONS,
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("INVALID_INPUT");
		expect((error as Error).message).not.toContain("SECRET");
	});

	it("cooperatively observes cancellation at the four-millisecond slice boundary", async () => {
		const controller = new AbortController();
		let checkpoints = 0;
		let clock = 0;
		const draft: OpenFabStationProposalReviewDraft = {
			...emptyDraft(),
			rowDecisions: Array.from({ length: 512 }, (_, row) => ({
				row,
				disposition: "REJECT" as const,
				reason: "USER_EXCLUDED" as const,
			})),
		};
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(draft, 512, {
				checkpoint: async () => {
					checkpoints++;
					controller.abort();
				},
				signal: controller.signal,
				revision: () => 0,
				now: () => (clock += 5),
				sliceMilliseconds: 4,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED",
		});
		expect(checkpoints).toBe(1);

		const alreadyAborted = new AbortController();
		alreadyAborted.abort();
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(emptyDraft(), 0, {
				checkpoint: async () => {},
				signal: alreadyAborted.signal,
				revision: () => 0,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("caps cooperative slices and redacts hostile checkpoint and signal errors", async () => {
		let internalError: unknown;
		try {
			await Reflect.apply(encodeOpenFabStationProposalReviewDraftCooperatively, null, [
				emptyDraft(),
				0,
				{ checkpoint: async () => {} },
			]);
		} catch (error) {
			internalError = error;
		}
		expect(internalError).toBeInstanceOf(Error);
		const forgedInternalError = Object.create(Object.getPrototypeOf(internalError)) as Error;
		Object.defineProperty(forgedInternalError, "message", {
			value: "SECRET_FORGED_INTERNAL_ERROR",
		});
		Object.defineProperty(forgedInternalError, "name", {
			get() {
				throw new Error("SECRET_FORGED_NAME");
			},
		});

		await expect(
			Reflect.apply(encodeOpenFabStationProposalReviewDraftCooperatively, null, [
				emptyDraft(),
				0,
				{ checkpoint: async () => {} },
			]),
		).rejects.toThrow("INVALID_COOPERATIVE_OPTIONS");
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(emptyDraft(), 0, {
				checkpoint: async () => {},
				revision: () => {
					throw forgedInternalError;
				},
			}),
		).rejects.toThrow("ENCODE_FAILED");
		await expect(
			adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(await oneDecisionSnapshot(), {
				checkpoint: async () => {},
				now: () => {
					throw forgedInternalError;
				},
			}),
		).rejects.toThrow("ADOPTION_FAILED");
		Object.defineProperty(internalError as Error, "message", {
			value: "SECRET_MUTATED_BRANDED_ERROR",
		});
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(emptyDraft(), 0, {
				checkpoint: async () => {},
				revision: () => {
					throw internalError;
				},
			}),
		).rejects.toThrow("INVALID_COOPERATIVE_OPTIONS");
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(emptyDraft(), 0, {
				checkpoint: async () => {},
				revision: () => 0,
				sliceMilliseconds: 4.001,
			}),
		).rejects.toThrow("INVALID_COOPERATIVE_OPTIONS");

		const secret = "SECRET_CHECKPOINT_NAME";
		const hostileError = new Error("SECRET_CHECKPOINT_MESSAGE");
		Object.defineProperty(hostileError, "name", {
			get() {
				throw new Error(secret);
			},
		});
		const decisions = Array.from({ length: 128 }, (_, row) => ({
			row,
			disposition: "REJECT" as const,
			reason: "USER_EXCLUDED" as const,
		}));
		let clock = 0;
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(
				{ ...emptyDraft(), rowDecisions: decisions },
				128,
				{
					checkpoint: async () => {
						throw hostileError;
					},
					now: () => (clock += 5),
					revision: () => 0,
				},
			),
		).rejects.toThrow("ENCODE_FAILED");

		await expect(
			adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(await oneDecisionSnapshot(), {
				checkpoint: async () => {
					throw hostileError;
				},
			}),
		).rejects.toThrow("ADOPTION_FAILED");
		let adoptionNowCalls = 0;
		await expect(
			adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(await oneDecisionSnapshot(), {
				checkpoint: async () => {},
				now: () => {
					adoptionNowCalls++;
					if (adoptionNowCalls === 3) throw hostileError;
					return 0;
				},
			}),
		).rejects.toThrow("ADOPTION_FAILED");
		expect(adoptionNowCalls).toBe(3);

		const fakeSignal = {} as AbortSignal;
		Object.defineProperty(fakeSignal, "aborted", {
			get() {
				throw new Error("SECRET_SIGNAL_GETTER");
			},
		});
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(emptyDraft(), 0, {
				checkpoint: async () => {},
				revision: () => 0,
				signal: fakeSignal,
			}),
		).rejects.toThrow("ENCODE_FAILED");

		const controller = new AbortController();
		clock = 0;
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(
				{ ...emptyDraft(), rowDecisions: decisions },
				128,
				{
					checkpoint: async () => {
						controller.abort();
						throw hostileError;
					},
					now: () => (clock += 5),
					revision: () => 0,
					signal: controller.signal,
				},
			),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED",
		});
	});

	it("aborts instead of publishing a hybrid when a future decision generation mutates", async () => {
		const rowDecisions: Array<{
			row: number;
			disposition: "REJECT";
			reason: "USER_EXCLUDED" | "UNRESOLVED" | "UNSUPPORTED";
		}> = Array.from({ length: 256 }, (_, row) => ({
			row,
			disposition: "REJECT" as const,
			reason: "USER_EXCLUDED" as const,
		}));
		const draft: OpenFabStationProposalReviewDraft = {
			...emptyDraft(),
			rowDecisions,
		};
		let checkpoints = 0;
		let clock = 0;
		let revision = 0;
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(draft, 256, {
				checkpoint: async () => {
					checkpoints++;
					if (checkpoints !== 1) return;
					rowDecisions[200].reason = "UNSUPPORTED";
					const mutableDraft = draft as MutableDraft;
					mutableDraft.rejectedSourceRowsPolicy = "ACKNOWLEDGE_DISCARDED";
					revision++;
				},
				now: () => (clock += 5),
				revision: () => revision,
				sliceMilliseconds: 4,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED",
		});

		expect(checkpoints).toBe(1);
	});

	it("aborts when group fields or member rows mutate across a cooperative checkpoint", async () => {
		const memberRows = Array.from({ length: 256 }, (_, row) => row);
		const group: {
			reviewGroupId: number;
			kind: "OHB";
			template: "SINGLE";
			groupingReview: "CONFIRM_DECLARED" | "OVERRIDE";
			memberRows: number[];
		} = {
			reviewGroupId: 7,
			kind: "OHB" as const,
			template: "SINGLE" as const,
			groupingReview: "CONFIRM_DECLARED" as const,
			memberRows,
		};
		const groupDecisions = [group];
		const draft: OpenFabStationProposalReviewDraft = {
			...emptyDraft(),
			groupDecisions,
		};
		let checkpoints = 0;
		let clock = 0;
		let revision = 0;
		await expect(
			encodeOpenFabStationProposalReviewDraftCooperatively(draft, 256, {
				checkpoint: async () => {
					checkpoints++;
					if (checkpoints !== 1) return;
					group.reviewGroupId = -1;
					group.groupingReview = "OVERRIDE";
					memberRows[200] = -1;
					memberRows.length = 100_000;
					revision++;
				},
				now: () => (clock += 5),
				revision: () => revision,
				sliceMilliseconds: 4,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED",
		});

		expect(checkpoints).toBe(1);
	});

	it("cooperatively adopts and cancels the D=G=M=100k boundary", async () => {
		const rowCount = 100_000;
		const source = await encodeOpenFabStationProposalReviewDraftCooperatively(
			maximumDraft(rowCount),
			rowCount,
			NOOP_OPTIONS,
		);
		const cancellationSource = structuredClone(source);
		let checkpoints = 0;
		let clock = 0;
		const handle = await adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(source, {
			checkpoint: async () => {
				checkpoints++;
			},
			now: () => ++clock,
			sliceMilliseconds: 1,
		});

		expect(checkpoints).toBeGreaterThan(2_000);
		expect(source.decisionRows.byteLength).toBe(0);
		expect(source.groupMemberRows.byteLength).toBe(0);
		const released = releaseAdoptedOpenFabStationProposalReviewDraftSnapshotTransfer(handle);
		expect(released.snapshot.byteLength).toBe(6_300_004);
		expect(released.transfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT);
		expect(released.transfers.reduce((total, buffer) => total + buffer.byteLength, 0)).toBe(
			6_300_004,
		);

		const controller = new AbortController();
		checkpoints = 0;
		clock = 0;
		await expect(
			adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(cancellationSource, {
				checkpoint: async () => {
					checkpoints++;
					if (checkpoints === 3) controller.abort();
				},
				now: () => ++clock,
				signal: controller.signal,
				sliceMilliseconds: 1,
			}),
		).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_ABORTED",
		});
		expect(checkpoints).toBe(3);
		expect(cancellationSource.decisionRows.byteLength).toBe(0);
	}, 20_000);

	it.runIf(RUN_DRAFT_SOA_SCALE)(
		"encodes the bounded D=G=M=100k transferable scale case",
		async () => {
			const rowCount = 100_000;
			const draft = maximumDraft(rowCount);
			let encodeCheckpoints = 0;
			const startedAt = performance.now();
			const snapshot = await encodeOpenFabStationProposalReviewDraftCooperatively(draft, rowCount, {
				checkpoint: async () => {
					encodeCheckpoints++;
				},
				revision: () => 0,
			});
			const encodeElapsedMilliseconds = performance.now() - startedAt;

			expect(snapshot).toMatchObject({
				decisionCount: rowCount,
				groupCount: rowCount,
				membershipCount: rowCount,
				byteLength: 6_300_004,
			});

			const adoptionSource = structuredClone(snapshot);
			const rssBeforeAdoption = residentSetBytes();
			let peakRss = rssBeforeAdoption;
			let adoptionCheckpoints = 0;
			let activeSliceStartedAt = performance.now();
			let maxActiveGapMilliseconds = 0;
			const adoptionStartedAt = activeSliceStartedAt;
			const handle = await adoptOpenFabStationProposalReviewDraftSnapshotCooperatively(
				adoptionSource,
				{
					checkpoint: async () => {
						const checkpointAt = performance.now();
						maxActiveGapMilliseconds = Math.max(
							maxActiveGapMilliseconds,
							checkpointAt - activeSliceStartedAt,
						);
						adoptionCheckpoints++;
						peakRss = Math.max(peakRss, residentSetBytes());
						await new Promise<void>((resolve) => setTimeout(resolve, 0));
						activeSliceStartedAt = performance.now();
					},
					sliceMilliseconds: 4,
				},
			);
			const adoptionFinishedAt = performance.now();
			maxActiveGapMilliseconds = Math.max(
				maxActiveGapMilliseconds,
				adoptionFinishedAt - activeSliceStartedAt,
			);
			peakRss = Math.max(peakRss, residentSetBytes());
			const released = releaseAdoptedOpenFabStationProposalReviewDraftSnapshotTransfer(handle);
			expect(adoptionCheckpoints).toBeGreaterThan(0);
			expect(adoptionSource.decisionRows.byteLength).toBe(0);
			expect(released.transfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT);
			expect(openFabStationProposalReviewDraftSnapshotShapeError(snapshot)).toBeNull();
			expect(collectOpenFabStationProposalReviewDraftSnapshotTransfers(snapshot)).toHaveLength(
				OPENFAB_STATION_PROPOSAL_REVIEW_DRAFT_BUFFER_COUNT,
			);
			console.info(
				JSON.stringify({
					encodeElapsedMilliseconds,
					encodeCheckpoints,
					adoptionElapsedMilliseconds: adoptionFinishedAt - adoptionStartedAt,
					adoptionCheckpoints,
					maxActiveGapMilliseconds,
					rssBeforeAdoption,
					peakRss,
					peakRssDeltaBytes: peakRss - rssBeforeAdoption,
					byteLength: snapshot.byteLength,
				}),
			);
		},
		30_000,
	);
});

function mixedDraft(): OpenFabStationProposalReviewDraft {
	return {
		rowDecisions: [
			{
				row: 0,
				disposition: "INCLUDE",
				identityAction: "CREATE_NEW",
				portType: "EQ",
				typeReview: "CONFIRM_DECLARED",
				attachmentReview: "USER_SELECTED_EXACT_ROUTE",
				route: { kind: "CARDINAL_CELL", x: 10, z: -2, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				stationReview: "CONFIRM_DECLARED",
				side: "CENTER",
				lateralOffsetMillimeters: 0,
				sideOffsetReview: "CONFIRM_DECLARED",
				direction: "WITH_TRAVEL",
				directionReview: "CONFIRM_DECLARED",
				sourcePositionReview: "NOT_PROVIDED",
			},
			{
				row: 1,
				disposition: "INCLUDE",
				identityAction: "CREATE_NEW",
				portType: "EQ",
				typeReview: "OVERRIDE",
				attachmentReview: "USER_SELECTED_EXACT_ROUTE",
				route: {
					kind: "ADVANCED_SWITCH_SEGMENT",
					switchId: 7,
					profileClass: "B",
					role: "OUTPUT",
					portIndex: 1,
					segmentOrdinal: 3,
				},
				stationMillimeters: 750,
				stationReview: "OVERRIDE",
				side: "RIGHT",
				lateralOffsetMillimeters: 600,
				sideOffsetReview: "OVERRIDE",
				direction: "AGAINST_TRAVEL",
				directionReview: "OVERRIDE",
				sourcePositionReview: "ACKNOWLEDGE_MISMATCH",
			},
			{ row: 2, disposition: "REJECT", reason: "USER_EXCLUDED" },
			{
				row: 3,
				disposition: "INCLUDE",
				identityAction: "CREATE_NEW",
				portType: "STK",
				typeReview: "CONFIRM_DECLARED",
				attachmentReview: "USER_SELECTED_EXACT_ROUTE",
				route: { kind: "CARDINAL_CELL", x: 12, z: -2, from: DIR_W, to: DIR_E },
				stationMillimeters: 250,
				stationReview: "CONFIRM_DECLARED",
				side: "LEFT",
				lateralOffsetMillimeters: 700,
				sideOffsetReview: "CONFIRM_DECLARED",
				direction: "WITH_TRAVEL",
				directionReview: "CONFIRM_HEURISTIC",
				sourcePositionReview: "CONFIRM_MATCH",
			},
		],
		groupDecisions: [
			{
				reviewGroupId: 9,
				kind: "EQ",
				pitchMillimeters: 1_000,
				recipe: null,
				groupingReview: "OVERRIDE",
				memberRows: [0, 1],
			},
			{
				reviewGroupId: 10,
				kind: "STK",
				template: "FLEX",
				groupingReview: "CONFIRM_DECLARED",
				memberRows: [3],
			},
		],
		rejectedSourceRowsPolicy: "ACKNOWLEDGE_DISCARDED",
		unknownColumnsPolicy: "ACKNOWLEDGE_IGNORED",
		organizationPolicy: "EXPLICIT_UNASSIGNED",
	};
}

function emptyDraft(): OpenFabStationProposalReviewDraft {
	return {
		rowDecisions: [],
		groupDecisions: [],
		rejectedSourceRowsPolicy: "NOT_APPLICABLE",
		unknownColumnsPolicy: "NOT_APPLICABLE",
		organizationPolicy: "EXPLICIT_UNASSIGNED",
	};
}

function maximumDraft(rowCount: number): OpenFabStationProposalReviewDraft {
	return {
		rowDecisions: Array.from({ length: rowCount }, (_, row) => ({
			row,
			disposition: "REJECT" as const,
			reason: "USER_EXCLUDED" as const,
		})),
		groupDecisions: Array.from({ length: rowCount }, (_, row) => ({
			reviewGroupId: row,
			kind: "OHB" as const,
			template: "SINGLE" as const,
			groupingReview: "CONFIRM_DECLARED" as const,
			memberRows: [row],
		})),
		rejectedSourceRowsPolicy: "NOT_APPLICABLE",
		unknownColumnsPolicy: "NOT_APPLICABLE",
		organizationPolicy: "EXPLICIT_UNASSIGNED",
	};
}

async function oneDecisionSnapshot(): Promise<OpenFabStationProposalReviewDraftSnapshot> {
	return encodeOpenFabStationProposalReviewDraftCooperatively(
		{
			...emptyDraft(),
			rowDecisions: [{ row: 0, disposition: "REJECT", reason: "USER_EXCLUDED" }],
		},
		1,
		NOOP_OPTIONS,
	);
}

type MutableSnapshot = {
	-readonly [Key in keyof OpenFabStationProposalReviewDraftSnapshot]: OpenFabStationProposalReviewDraftSnapshot[Key];
};

type MutableSnapshotSource = {
	-readonly [Key in keyof OpenFabStationProposalReviewDraftSnapshotSource]: OpenFabStationProposalReviewDraftSnapshotSource[Key];
};

type MutableDraft = {
	-readonly [Key in keyof OpenFabStationProposalReviewDraft]: OpenFabStationProposalReviewDraft[Key];
};

function cloneSnapshot(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): OpenFabStationProposalReviewDraftSnapshot {
	return structuredClone(snapshot);
}

function mutableSnapshot(snapshot: OpenFabStationProposalReviewDraftSnapshot): MutableSnapshot {
	return structuredClone(snapshot) as MutableSnapshot;
}

function freshSnapshotSource(
	snapshot: OpenFabStationProposalReviewDraftSnapshot,
): OpenFabStationProposalReviewDraftSnapshotSource {
	const copy = structuredClone(snapshot) as unknown as Record<string, unknown>;
	delete copy.kind;
	delete copy.version;
	delete copy.byteLength;
	delete copy.fingerprint;
	return copy as unknown as OpenFabStationProposalReviewDraftSnapshotSource;
}

function mutableSnapshotSource(
	source: OpenFabStationProposalReviewDraftSnapshotSource,
): MutableSnapshotSource {
	return source as MutableSnapshotSource;
}

function snapshotSourceBuffers(
	source: OpenFabStationProposalReviewDraftSnapshotSource,
): ArrayBuffer[] {
	return Object.values(source).flatMap((value) =>
		ArrayBuffer.isView(value) ? [value.buffer as ArrayBuffer] : [],
	);
}
