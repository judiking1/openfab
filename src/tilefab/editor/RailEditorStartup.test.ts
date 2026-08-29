import { describe, expect, it, vi } from "vitest";
import { openFabStationProposalReviewAttachmentFromSlot } from "../compile/OpenFabStationProposalReviewAttachment";
import { PORT_SLOT_STATUS, PortSlotAvailabilityIndex } from "../compile/PortSlotCompiler";
import { checksumPortSlotPreparedArtifactCatalog } from "../compile/PortSlotPreparedArtifacts";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { checksumRailDraftPreparedArtifacts } from "../compile/RailDraftPreparedArtifacts";
import {
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
} from "../core/OperationalConfiguration";
import { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	railModuleOwnershipIndexMatchesMap,
} from "../core/RailModuleOwnership";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { checksumPhysicalRailRenderArtifacts } from "../render/PhysicalRailRenderArtifacts";
import { captureRailMirrorSnapshot, type RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { createRailScaleProbeDocument } from "../worker/RailStartupFixture";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import {
	INITIAL_RAIL_WORKER_STATE,
	RailWorkerBridge,
	type RailWorkerBridgeHandle,
	type RailWorkerBridgeState,
	type RailWorkerReadyExpectation,
} from "../worker/RailWorkerBridge";
import { createStaticFabOrganizationSnapshot } from "../worker/StaticFabOrganizationSoA";
import {
	activateRailEditorStartup,
	hydrateStaticFabOrganizationsForStartup,
	prepareRailEditorStartupCandidate,
	type RailStartupScheduler,
} from "./RailEditorStartup";
import { RailStartupCancelledError } from "./RailStartupBridge";

describe("activateRailEditorStartup", () => {
	it("checkpoints within one 50k-edge AREA and hydrates its exact membership", async () => {
		const expected = largeAreaFixture(50_000);
		let checkpoints = 0;
		const organizations = await hydrateStaticFabOrganizationsForStartup(
			createStaticFabOrganizationSnapshot(expected),
			async () => {
				checkpoints++;
			},
		);

		expect(checkpoints).toBe(Math.ceil(50_001 / 128));
		expect(checkpoints).toBeGreaterThan(300);
		expect(organizations).toEqual(expected);
		expect(organizations.records[0]?.membership.railEdges).toHaveLength(50_000);
	});

	it("cooperatively hydrates one revision-consistent editable model", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 1_025 });
		const scheduler = new CountingScheduler();
		const activation = await activateRailEditorStartup(payload, scheduler, undefined, 0.5);

		expect(Reflect.ownKeys(activation)).toEqual(["model", "metrics"]);
		expect(Reflect.has(activation, "snapshot")).toBe(false);
		expect(activation.model.document.map.size).toBe(1_025);
		expect(activation.model.document.map.getRevision()).toBe(payload.snapshot.revision);
		expect(activation.model.document.getPatchSequence()).toBe(payload.snapshot.sequence);
		expect(activation.model.document.canUndo).toBe(false);
		expect(activation.model.ownership.revision).toBe(payload.snapshot.revision);
		expect(activation.model.physical.paths.pathCount).toBe(1_025);
		expect(activation.metrics.yieldCount).toBeGreaterThan(1);
		expect(scheduler.yields).toBe(activation.metrics.yieldCount);
	});

	it("reconstructs exact full-buffer typed views after startup ownership transfer", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 1_025 });
		const sourceEncoded = payload.snapshot.encoded;
		const sourcePositions = payload.physical.value.paths.positions;

		const activation = await activateRailEditorStartup(payload, new CountingScheduler());
		const positions = activation.model.physical.paths.positions;

		expect(activation.model.document.map.size).toBe(1_025);
		expect(sourceEncoded.byteLength).toBe(0);
		expect(sourcePositions.byteLength).toBe(0);
		expect(positions).toBeInstanceOf(Float32Array);
		expect(positions.byteOffset).toBe(0);
		expect(positions.byteLength).toBe(positions.buffer.byteLength);
	});

	it("publishes derived artifacts against an exact existing document without retaining the hydration map", async () => {
		const source = createRailScaleProbeDocument(1_025);
		const publicationDocument = RailDocument.fromLoadedMap(
			source.map.clone(),
			source.getPatchSequence(),
			source.portEquipment,
			source.organizations,
		);
		const payload = compileRailStartup({
			kind: "snapshot",
			snapshot: captureRailMirrorSnapshot(
				publicationDocument.map,
				publicationDocument.getPatchSequence(),
				publicationDocument.portEquipment,
				publicationDocument.organizations,
			).snapshot,
		});

		const activation = await activateRailEditorStartup(
			payload,
			new CountingScheduler(),
			undefined,
			0.5,
			publicationDocument,
		);

		expect(activation.model.document).toBe(publicationDocument);
		expect(activation.model.map).toBe(publicationDocument.map);
		expect(
			railModuleOwnershipIndexMatchesMap(activation.model.ownership, publicationDocument.map),
		).toBe(true);
	});

	it("preserves publication-document operations while re-deriving from a static mirror snapshot", async () => {
		const source = createRailScaleProbeDocument(12);
		const operations = copyOperationalConfigurationState({
			...emptyOperationalConfigurationState(),
			revision: 3,
			stationCapabilities: [{ portId: 7, transferCapability: "PICKUP_ONLY" }],
		});
		const publicationDocument = RailDocument.fromLoadedMap(
			source.map.clone(),
			source.getPatchSequence(),
			source.portEquipment,
			source.organizations,
			operations,
		);
		const payload = compileRailStartup({
			kind: "snapshot",
			snapshot: captureRailMirrorSnapshot(
				publicationDocument.map,
				publicationDocument.getPatchSequence(),
				publicationDocument.portEquipment,
				publicationDocument.organizations,
			).snapshot,
		});

		const activation = await activateRailEditorStartup(
			payload,
			new CountingScheduler(),
			undefined,
			0.5,
			publicationDocument,
		);

		expect(activation.model.document).toBe(publicationDocument);
		expect(activation.model.operationalConfiguration).toBe(
			publicationDocument.operationalConfiguration,
		);
		expect(activation.model.operationalConfiguration).toEqual(operations);
	});

	it("seals project operations before a cooperative scheduler can rewrite them", async () => {
		const source = createRailScaleProbeDocument(12);
		const payload = structuredClone(
			compileRailStartup({
				kind: "project-snapshot",
				snapshot: captureRailMirrorSnapshot(source.map, source.getPatchSequence()).snapshot,
				manifest: {
					id: "sealed-operation-source",
					name: "Sealed operation source",
					createdAt: "2026-08-26T00:00:00.000Z",
					updatedAt: "2026-08-26T00:00:00.000Z",
				},
			}),
		);
		if (payload.source.kind !== "project") throw new Error("Expected project startup source.");
		const mutableOperations = payload.source.operations as unknown as {
			stationCapabilities: Array<{
				portId: number;
				transferCapability: "PICKUP_ONLY";
			}>;
		};
		let attemptedMutation = false;
		const scheduler = new CountingScheduler(() => {
			if (attemptedMutation) return;
			attemptedMutation = true;
			mutableOperations.stationCapabilities.push({
				portId: 9,
				transferCapability: "PICKUP_ONLY",
			});
		});

		const activation = await activateRailEditorStartup(payload, scheduler, undefined, 0.000_001);

		expect(attemptedMutation).toBe(true);
		expect(payload.source.operations.stationCapabilities).toHaveLength(1);
		expect(activation.model.operationalConfiguration.stationCapabilities).toEqual([]);
	});

	it("rejects a same-revision publication document whose authored cells differ", async () => {
		const source = createRailScaleProbeDocument(12);
		const payload = compileRailStartup({
			kind: "snapshot",
			snapshot: captureRailMirrorSnapshot(
				source.map,
				source.getPatchSequence(),
				source.portEquipment,
				source.organizations,
			).snapshot,
		});
		const hydrator = TileMap.createHydrator();
		let changed = false;
		source.map.forEachRail((x, y, _rail, encoded) => {
			const after = !changed ? (encoded ^ 0x11) & 0xff || 1 : encoded;
			changed = true;
			hydrator.addEncodedCell(x, y, after);
		});
		const forgedMap = hydrator.finish(
			source.map.getRevision(),
			source.map.getAdvancedSwitchIdCursor(),
		);
		const forgedDocument = RailDocument.fromLoadedMap(
			forgedMap,
			source.getPatchSequence(),
			source.portEquipment,
			source.organizations,
		);

		await expect(
			activateRailEditorStartup(payload, new CountingScheduler(), undefined, 0.5, forgedDocument),
		).rejects.toThrow(/publication (?:document|map)/);
	});

	it("rebinds a cloned Worker slot catalog to the exact activated physical layout", async () => {
		const payload = structuredClone(compileRailStartup({ kind: "scale-probe", cellCount: 12 }));
		const activation = await activateRailEditorStartup(payload, new CountingScheduler());
		const { document, physical, portSlotArtifacts } = activation.model;
		const artifacts = portSlotArtifacts.OHB;
		const availability = new PortSlotAvailabilityIndex(physical, document.portEquipment, "OHB");
		const row = artifacts.slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		expect(row).toBeGreaterThanOrEqual(0);

		expect(
			openFabStationProposalReviewAttachmentFromSlot(
				physical,
				artifacts,
				availability,
				document.portEquipment,
				row,
			),
		).toMatchObject({ portType: "OHB" });
	});

	it("publishes a cooperatively validated organization generation without startup history", async () => {
		const source = createRailScaleProbeDocument(1_025);
		const ownership = buildRailModuleOwnershipIndex(source.map);
		const organizations = exactAreaState(ownership, "Main Production Area");
		const organized = RailDocument.fromLoadedMap(
			source.map.clone(),
			source.getPatchSequence(),
			source.portEquipment,
			organizations,
		);
		const snapshot = captureRailMirrorSnapshot(
			organized.map,
			organized.getPatchSequence(),
			organized.portEquipment,
			organized.organizations,
		).snapshot;
		const payload = compileRailStartup({ kind: "snapshot", snapshot });
		const scheduler = new CountingScheduler();

		const activation = await activateRailEditorStartup(payload, scheduler, undefined, 0.5);

		expect(activation.model.document.organizations).toEqual(organizations);
		expect(activation.model.document.organizations.records[0]?.membership.railEdges.length).toBe(
			1_024,
		);
		expect(activation.model.document.canUndo).toBe(false);
		expect(activation.model.document.canRedo).toBe(false);
		expect(scheduler.yields).toBeGreaterThan(10);
	});

	it("rejects a derived revision mismatch before hydration", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		await expect(
			activateRailEditorStartup(
				{
					...payload,
					ownership: {
						...payload.ownership,
						value: { ...payload.ownership.value, revision: payload.snapshot.revision + 1 },
					},
				},
				new CountingScheduler(),
			),
		).rejects.toThrow("revisions do not match");
	});

	it("rejects authored and physical cross-binding before publishing a model", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		await expect(
			activateRailEditorStartup(
				{
					...payload,
					analysis: {
						...payload.analysis,
						authoredChecksum: "00000000:00000000:00000000:00000000:00000000:00000000:00000000",
					},
				},
				new CountingScheduler(),
			),
		).rejects.toThrow("authored checksum");

		await expect(
			activateRailEditorStartup(
				{
					...payload,
					renderArtifacts: {
						...payload.renderArtifacts,
						physicalFingerprint: "00000000:00000000",
					},
				},
				new CountingScheduler(),
			),
		).rejects.toThrow("physical fingerprint");

		await expect(
			activateRailEditorStartup(
				{
					...payload,
					readiness: {
						...payload.readiness,
						physicalFingerprint: "00000000:00000000",
					},
				},
				new CountingScheduler(),
			),
		).rejects.toThrow("physical fingerprint");
	});

	it("rejects a startup source identity that does not match its typed snapshot", async () => {
		const scalePayload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const payload = compileRailStartup({ kind: "snapshot", snapshot: scalePayload.snapshot });
		if (payload.source.kind !== "snapshot") throw new Error("expected snapshot payload source");

		await expect(
			activateRailEditorStartup(
				{
					...payload,
					source: { ...payload.source, sequence: payload.source.sequence + 1 },
				},
				new CountingScheduler(),
			),
		).rejects.toThrow("source identity");
	});

	it("rejects tampered physical and prepared artifact buffers", async () => {
		const analysisPayload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		analysisPayload.analysis.value.cells++;
		await expect(
			activateRailEditorStartup(analysisPayload, new CountingScheduler()),
		).rejects.toThrow("analysis fingerprint mismatch");

		const ownershipPayload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		ownershipPayload.ownership.value.candidateCells[0] = 99;
		await expect(
			activateRailEditorStartup(ownershipPayload, new CountingScheduler()),
		).rejects.toThrow("ownership buffer fingerprint mismatch");

		const physicalPayload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		physicalPayload.physical.value.paths.positions[0] =
			(physicalPayload.physical.value.paths.positions[0] as number) + 0.25;
		await expect(
			activateRailEditorStartup(physicalPayload, new CountingScheduler()),
		).rejects.toThrow("differs from derived physical geometry");

		const readinessPayload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		readinessPayload.readiness.value.locations.openTerminalCells[0] = 99;
		await expect(
			activateRailEditorStartup(readinessPayload, new CountingScheduler()),
		).rejects.toThrow("readiness topology fingerprint mismatch");

		const artifactPayload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		artifactPayload.renderArtifacts.value.cellIndex.values[0] = 11;
		await expect(
			activateRailEditorStartup(artifactPayload, new CountingScheduler()),
		).rejects.toThrow("render artifact buffer fingerprint mismatch");

		const draftPayload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		draftPayload.draftArtifacts.value.envelopeSpatialIndex.envelopeIndices[0] = 11;
		await expect(activateRailEditorStartup(draftPayload, new CountingScheduler())).rejects.toThrow(
			"envelope spatial snapshot is not canonical",
		);

		const portSlotPayload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		portSlotPayload.portSlotArtifacts.value.EQ.slots.worldPositions[0] += 0.25;
		await expect(
			activateRailEditorStartup(portSlotPayload, new CountingScheduler()),
		).rejects.toThrow("port slot artifact catalog fingerprint mismatch");
	});

	it("stops cooperative activation when its signal is cancelled", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 1_025 });
		const controller = new AbortController();
		const scheduler = new CountingScheduler(() => controller.abort());

		await expect(
			activateRailEditorStartup(payload, scheduler, controller.signal, 0.5),
		).rejects.toBeInstanceOf(RailStartupCancelledError);
	});

	it("does not take startup buffer ownership when already cancelled", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const snapshotBuffer = payload.snapshot.encoded.buffer;
		const physicalBuffer = payload.physical.value.paths.positions.buffer;
		const slotBuffer = payload.portSlotArtifacts.value.OHB.slots.statuses.buffer;
		const controller = new AbortController();
		controller.abort();

		await expect(
			activateRailEditorStartup(payload, new CountingScheduler(), controller.signal),
		).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(snapshotBuffer.byteLength).toBeGreaterThan(0);
		expect(physicalBuffer.byteLength).toBeGreaterThan(0);
		expect(slotBuffer.byteLength).toBeGreaterThan(0);
	});

	it("rejects non-canonical startup typed views before taking any ownership", async () => {
		const cases: readonly {
			readonly label: string;
			readonly mutate: (payload: ReturnType<typeof compileRailStartup>) => void;
			readonly message: string;
		}[] = [
			{
				label: "wrong constructor",
				mutate: (payload) => {
					Object.assign(payload.physical.value.paths, {
						kinds: new Int8Array(payload.physical.value.paths.kinds),
					});
				},
				message: "exact Uint8Array",
			},
			{
				label: "shared backing store",
				mutate: (payload) => {
					const kinds = new Uint8Array(
						new SharedArrayBuffer(payload.physical.value.paths.kinds.length),
					);
					kinds.set(payload.physical.value.paths.kinds);
					Object.assign(payload.physical.value.paths, { kinds });
				},
				message: "unique fixed full ArrayBuffer",
			},
			{
				label: "partial view",
				mutate: (payload) => {
					const source = payload.physical.value.paths.kinds;
					const kinds = new Uint8Array(new ArrayBuffer(source.length + 1), 1, source.length);
					kinds.set(source);
					Object.assign(payload.physical.value.paths, { kinds });
				},
				message: "unique fixed full ArrayBuffer",
			},
		];

		for (const fixture of cases) {
			const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
			const snapshotBuffer = payload.snapshot.encoded.buffer;
			const physicalBuffer = payload.physical.value.paths.positions.buffer;
			const slotBuffer = payload.portSlotArtifacts.value.OHB.slots.statuses.buffer;
			fixture.mutate(payload);

			await expect(
				activateRailEditorStartup(payload, new CountingScheduler()),
				fixture.label,
			).rejects.toThrow(fixture.message);
			expect(snapshotBuffer.byteLength, fixture.label).toBeGreaterThan(0);
			expect(physicalBuffer.byteLength, fixture.label).toBeGreaterThan(0);
			expect(slotBuffer.byteLength, fixture.label).toBeGreaterThan(0);
		}
	});

	it("rejects custom typed-view own properties without leaking their names", async () => {
		const cases = [
			{
				label: "enumerable string",
				key: "PRIVATE_TYPED_VIEW_SENTINEL",
				enumerable: true,
			},
			{
				label: "non-enumerable string",
				key: "PRIVATE_HIDDEN_TYPED_VIEW_SENTINEL",
				enumerable: false,
			},
			{
				label: "symbol",
				key: Symbol("PRIVATE_SYMBOL_TYPED_VIEW_SENTINEL"),
				enumerable: false,
			},
		] as const;

		for (const fixture of cases) {
			const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
			const snapshotBuffer = payload.snapshot.encoded.buffer;
			const view = payload.physical.value.paths.kinds;
			const physicalBuffer = view.buffer;
			Object.defineProperty(view, fixture.key, {
				value: "must never appear in an error",
				enumerable: fixture.enumerable,
			});

			let rejection: unknown;
			try {
				await activateRailEditorStartup(payload, new CountingScheduler());
			} catch (error) {
				rejection = error;
			}

			expect(rejection, fixture.label).toBeInstanceOf(Error);
			const message = (rejection as Error).message;
			expect(message, fixture.label).toBe(
				"Rail startup typed views cannot contain custom own properties.",
			);
			expect(message, fixture.label).not.toContain("PRIVATE_");
			expect(snapshotBuffer.byteLength, fixture.label).toBe(0);
			expect(physicalBuffer.byteLength, fixture.label).toBe(0);
		}
	});

	it("rejects custom array graph fields after sealing startup typed ownership", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const snapshotBuffer = payload.snapshot.encoded.buffer;
		const physicalBuffer = payload.physical.value.paths.positions.buffer;
		Object.assign(payload.physical.value.pieces, {
			extra: { hidden: new Uint8Array(new SharedArrayBuffer(16)) },
		});

		await expect(activateRailEditorStartup(payload, new CountingScheduler())).rejects.toThrow(
			"arrays cannot contain custom fields",
		);
		expect(snapshotBuffer.byteLength).toBe(0);
		expect(physicalBuffer.byteLength).toBe(0);
	});

	it("rejects hidden and symbol array fields while accepting canonical array descriptors", async () => {
		const cases = [
			{
				label: "non-enumerable string",
				key: "PRIVATE_HIDDEN_ARRAY_SENTINEL",
			},
			{
				label: "symbol",
				key: Symbol("PRIVATE_SYMBOL_ARRAY_SENTINEL"),
			},
		] as const;

		for (const fixture of cases) {
			const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
			const snapshotBuffer = payload.snapshot.encoded.buffer;
			const physicalBuffer = payload.physical.value.paths.positions.buffer;
			Object.defineProperty(payload.physical.value.pieces, fixture.key, {
				value: "must never appear in an error",
				enumerable: false,
			});

			let rejection: unknown;
			try {
				await activateRailEditorStartup(payload, new CountingScheduler());
			} catch (error) {
				rejection = error;
			}

			expect(rejection, fixture.label).toBeInstanceOf(Error);
			const message = (rejection as Error).message;
			expect(message, fixture.label).toBe("Startup transport arrays cannot contain custom fields.");
			expect(message, fixture.label).not.toContain("PRIVATE_");
			expect(snapshotBuffer.byteLength, fixture.label).toBe(0);
			expect(physicalBuffer.byteLength, fixture.label).toBe(0);
		}
	});

	it("rechecks array own properties after reentrant element capture", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const snapshotBuffer = payload.snapshot.encoded.buffer;
		const pieces = payload.physical.value.pieces;
		let injected = false;
		Object.assign(payload.physical.value, {
			pieces: new Proxy(pieces, {
				getOwnPropertyDescriptor(target, key) {
					if (!injected && key === "0") {
						injected = true;
						Object.defineProperty(target, "PRIVATE_REENTRANT_ARRAY_SENTINEL", {
							value: "must never appear in an error",
							enumerable: false,
						});
					}
					return Reflect.getOwnPropertyDescriptor(target, key);
				},
			}),
		});

		let rejection: unknown;
		try {
			await activateRailEditorStartup(payload, new CountingScheduler());
		} catch (error) {
			rejection = error;
		}

		expect(injected).toBe(true);
		expect(rejection).toBeInstanceOf(Error);
		const message = (rejection as Error).message;
		expect(message).toBe("Startup transport arrays cannot contain custom fields.");
		expect(message).not.toContain("PRIVATE_");
		expect(snapshotBuffer.byteLength).toBe(0);
	});

	it("rechecks cancellation after exact capture and immediately before transfer", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const snapshotBuffer = payload.snapshot.encoded.buffer;
		const physicalBuffer = payload.physical.value.paths.positions.buffer;
		const controller = new AbortController();
		const clearance = payload.physical.value.clearance;
		Object.assign(payload.physical.value, {
			clearance: new Proxy(clearance, {
				ownKeys(target) {
					controller.abort();
					return Reflect.ownKeys(target);
				},
			}),
		});

		await expect(
			activateRailEditorStartup(payload, new CountingScheduler(), controller.signal),
		).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(snapshotBuffer.byteLength).toBeGreaterThan(0);
		expect(physicalBuffer.byteLength).toBeGreaterThan(0);
	});

	it("rejects custom and subclassed ArrayBuffers before startup ownership transfer", async () => {
		const custom = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const customBuffer = custom.snapshot.encoded.buffer;
		Object.defineProperty(customBuffer, "privateSentinel", {
			value: "must not survive transfer",
			enumerable: false,
		});
		await expect(activateRailEditorStartup(custom, new CountingScheduler())).rejects.toThrow(
			/exact property-free ArrayBuffer/,
		);
		expect(customBuffer.byteLength).toBeGreaterThan(0);

		class StartupArrayBufferSubclass extends ArrayBuffer {}
		const subclassed = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const sourceEncoded = subclassed.snapshot.encoded;
		const forgedEncoded = new Uint8Array(new StartupArrayBufferSubclass(sourceEncoded.byteLength));
		forgedEncoded.set(sourceEncoded);
		Object.assign(subclassed.snapshot, { encoded: forgedEncoded });
		await expect(activateRailEditorStartup(subclassed, new CountingScheduler())).rejects.toThrow(
			/exact property-free ArrayBuffer/,
		);
		expect(forgedEncoded.byteLength).toBeGreaterThan(0);
	});

	it("rejects a physical metadata generation rewritten across a cooperative yield", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		let mutated = false;
		const scheduler = new CountingScheduler(() => {
			if (mutated) return;
			mutated = true;
			payload.physical.value.pieces[0].id = "FORGED-AFTER-TRANSFER";
			Object.assign(payload.physical.value.counts, { LINEAR: 999 });
		});

		await expect(
			activateRailEditorStartup(payload, scheduler, undefined, 0.000_001),
		).rejects.toThrow("plain metadata fingerprint mismatch");
		expect(mutated).toBe(true);
	});

	it("rejects forged readiness issue details omitted from the topology fingerprint", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const issue = payload.readiness.value.issues.find(
			(candidate) => candidate.pathIdentities.length > 0,
		);
		if (!issue) throw new Error("Expected a readiness issue path identity fixture.");
		issue.pathIdentities[0][0] = 2_147_483_647;

		await expect(activateRailEditorStartup(payload, new CountingScheduler())).rejects.toThrow(
			"plain metadata fingerprint mismatch",
		);
	});

	it("revalidates cross-artifact aliases after reentrant exact capture", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const reverseAdjacency = payload.draftArtifacts.value.reverseAdjacency;
		const trappedReverseAdjacency = new Proxy(reverseAdjacency, {
			ownKeys(target) {
				Object.assign(payload.physical.value, {
					paths: { ...payload.physical.value.paths },
				});
				return Reflect.ownKeys(target);
			},
		});
		const draftValue = {
			...payload.draftArtifacts.value,
			reverseAdjacency: trappedReverseAdjacency,
		};

		await expect(
			activateRailEditorStartup(
				{
					...payload,
					draftArtifacts: { ...payload.draftArtifacts, value: draftValue },
				},
				new CountingScheduler(),
			),
		).rejects.toThrow("render presentation source identity changed during adoption");
	});

	it("leaves port slot buffers attached when capture reentrantly cancels before transfer", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const controller = new AbortController();
		const slotBuffer = payload.portSlotArtifacts.value.OHB.slots.statuses.buffer;
		const sourceCatalog = payload.portSlotArtifacts.value;
		const trappedCatalog = new Proxy(sourceCatalog, {
			ownKeys(target) {
				controller.abort();
				return Reflect.ownKeys(target);
			},
		});

		await expect(
			activateRailEditorStartup(
				{
					...payload,
					portSlotArtifacts: {
						...payload.portSlotArtifacts,
						value: trappedCatalog,
					},
				},
				new CountingScheduler(),
				controller.signal,
			),
		).rejects.toBeInstanceOf(RailStartupCancelledError);
		expect(slotBuffer.byteLength).toBeGreaterThan(0);
	});

	it("seals the authored snapshot before a cooperative scheduler can rewrite it", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const expectedChecksum = payload.snapshot.checksum;
		const expectedSequence = payload.snapshot.sequence;
		const sourceSnapshot = payload.snapshot as { checksum: string; sequence: number };
		const sourceEncoded = payload.snapshot.encoded;
		let attemptedMutation = false;
		const scheduler = new CountingScheduler(() => {
			if (attemptedMutation) return;
			attemptedMutation = true;
			expect(sourceEncoded.byteLength).toBe(0);
			sourceSnapshot.checksum = "00000000:00000000";
			sourceSnapshot.sequence += 1;
			sourceEncoded[0] = 0;
		});

		const activation = await activateRailEditorStartup(payload, scheduler, undefined, 0.000_001);

		expect(attemptedMutation).toBe(true);
		expect(activation.model.document.map.size).toBe(12);
		expect(activation.model.authoredChecksum).toBe(expectedChecksum);
		expect(activation.model.document.getPatchSequence()).toBe(expectedSequence);
	});

	it("rejects semantically forged port slots even with a matching recomputed fingerprint", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const eqSlots = payload.portSlotArtifacts.value.EQ.slots;
		eqSlots.sides[0] = 1;
		eqSlots.lateralOffsetMillimeters[0] = 700;
		const forged = {
			...payload,
			portSlotArtifacts: {
				...payload.portSlotArtifacts,
				artifactFingerprint: checksumPortSlotPreparedArtifactCatalog(
					payload.portSlotArtifacts.value,
					payload.physical.fingerprint,
				),
			},
		};

		await expect(activateRailEditorStartup(forged, new CountingScheduler())).rejects.toThrow(
			"side diverged",
		);
	});

	it("rejects forged draft CSR semantics even with matching recomputed fingerprints", async () => {
		const descendingOffsets = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const offsets = descendingOffsets.draftArtifacts.value.forwardAdjacency.offsets;
		const descendingIndex = offsets.findIndex(
			(_offset, index) => index > 0 && (offsets[index - 1] as number) > 0,
		);
		if (descendingIndex < 0) throw new Error("Expected a non-zero adjacency offset fixture.");
		offsets[descendingIndex] = (offsets[descendingIndex - 1] as number) - 1;
		await expect(
			activateRailEditorStartup(
				rebindAdjacencyFingerprints(descendingOffsets),
				new CountingScheduler(),
			),
		).rejects.toThrow(`offset ${descendingIndex} is not monotonic`);

		const outOfRangeTarget = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		outOfRangeTarget.draftArtifacts.value.forwardAdjacency.targets[0] =
			outOfRangeTarget.physical.value.paths.pathCount;
		await expect(
			activateRailEditorStartup(
				rebindAdjacencyFingerprints(outOfRangeTarget),
				new CountingScheduler(),
			),
		).rejects.toThrow("target 12 is out of range");

		const nonTransposeReverse = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const reverseTargets = nonTransposeReverse.draftArtifacts.value.reverseAdjacency.targets;
		reverseTargets[0] = ((reverseTargets[0] as number) + 1) % 12;
		await expect(
			activateRailEditorStartup(
				rebindAdjacencyFingerprints(nonTransposeReverse),
				new CountingScheduler(),
			),
		).rejects.toThrow("is not the transpose");

		const splitForward = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const splitDraftValue = {
			...splitForward.draftArtifacts.value,
			forwardAdjacency: {
				offsets: splitForward.renderArtifacts.value.adjacency.offsets.slice(),
				targets: splitForward.renderArtifacts.value.adjacency.targets.slice(),
			},
		};
		await expect(
			activateRailEditorStartup(
				{
					...splitForward,
					draftArtifacts: {
						...splitForward.draftArtifacts,
						value: splitDraftValue,
						artifactFingerprint: checksumRailDraftPreparedArtifacts(
							splitDraftValue,
							splitForward.physical.fingerprint,
						),
					},
				},
				new CountingScheduler(),
			),
		).rejects.toThrow("draft artifact alias identity is invalid");
	});

	it("keeps the old session active until the candidate mirror ACKs", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const mirror = new ControlledMirrorGate();
		let capturedMirrorSnapshot: RailMirrorSnapshot | null = null;
		let activeSession = "old";
		const railTraversal = vi.spyOn(TileMap.prototype, "forEachRail");
		try {
			const pending = prepareRailEditorStartupCandidate(
				payload,
				new CountingScheduler(),
				undefined,
				() => undefined,
				{
					createDraftEvaluator: () => new RailDraftEvaluator(),
					createMirrorBridge: (_document, _onState, snapshot) => {
						capturedMirrorSnapshot = snapshot;
						return mirror;
					},
				},
			);
			await mirror.waitStarted;
			expect(activeSession).toBe("old");
			expect(mirror.disposed).toBe(false);
			expect(payload.snapshot.encoded.byteLength).toBe(0);
			expect(railTraversal).not.toHaveBeenCalled();
			const capturedSnapshot = capturedMirrorSnapshot as RailMirrorSnapshot | null;
			if (capturedSnapshot === null) throw new Error("Expected the adopted candidate snapshot.");
			expect(capturedSnapshot.encoded.byteLength).toBeGreaterThan(0);
			expect(capturedSnapshot.checksum).toBe(payload.authoredChecksum);

			mirror.resolve(readyState(payload));
			const candidate = await pending;
			activeSession = "candidate";
			expect(activeSession).toBe("candidate");
			expect(candidate.mirrorBridge).toBe(mirror);
			expect(mirror.expectation).toMatchObject({
				checksum: payload.authoredChecksum,
				physicalFingerprint: payload.physical.fingerprint,
			});
		} finally {
			railTraversal.mockRestore();
		}
	});

	it("disposes a rejected candidate without replacing the old session", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		const mirror = new ControlledMirrorGate();
		const activeSession = { name: "old" };
		const pending = prepareRailEditorStartupCandidate(
			payload,
			new CountingScheduler(),
			undefined,
			() => undefined,
			{
				createDraftEvaluator: () => new RailDraftEvaluator(),
				createMirrorBridge: () => mirror,
			},
		);
		await mirror.waitStarted;
		mirror.reject(new Error("Injected candidate ACK failure"));

		await expect(pending).rejects.toThrow("Injected candidate ACK failure");
		expect(mirror.disposed).toBe(true);
		expect(activeSession).toEqual({ name: "old" });
	});

	it("keeps injected mirror factories on the full snapshot-validation fallback", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 12 });
		let workerCreated = false;

		await expect(
			prepareRailEditorStartupCandidate(
				payload,
				new CountingScheduler(),
				undefined,
				() => undefined,
				{
					createDraftEvaluator: () => new RailDraftEvaluator(),
					createMirrorBridge: (document, onState, snapshot) => {
						snapshot.encoded[0] ^= 1;
						return new RailWorkerBridge(
							document,
							onState,
							() => {
								workerCreated = true;
								throw new Error("A corrupted injected snapshot must not create a Worker.");
							},
							snapshot,
						);
					},
				},
			),
		).rejects.toThrow("typed buffers");
		expect(workerCreated).toBe(false);
	});
});

class ControlledMirrorGate implements RailWorkerBridgeHandle {
	private readonly ready: Promise<RailWorkerBridgeState>;
	private resolveReady!: (state: RailWorkerBridgeState) => void;
	private rejectReady!: (error: Error) => void;
	private resolveWaitStarted!: () => void;
	readonly waitStarted: Promise<void>;
	expectation: RailWorkerReadyExpectation | null = null;
	disposed = false;
	private state = INITIAL_RAIL_WORKER_STATE;

	constructor() {
		this.ready = new Promise((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		this.waitStarted = new Promise((resolve) => {
			this.resolveWaitStarted = resolve;
		});
	}

	getState(): RailWorkerBridgeState {
		return this.state;
	}

	captureCurrentSnapshot(): Promise<never> {
		return Promise.reject(new Error("Snapshot capture is not used by this startup test."));
	}

	captureCurrentOrganizationOutline(): Promise<never> {
		return Promise.reject(new Error("Organization outline is not used by this startup test."));
	}

	dispose(): void {
		this.disposed = true;
	}

	waitUntilAuthoredReady(): Promise<never> {
		return Promise.reject(new Error("Authored-only readiness is not used by this startup test."));
	}

	waitUntilReady(expectation: RailWorkerReadyExpectation): Promise<RailWorkerBridgeState> {
		this.expectation = expectation;
		this.resolveWaitStarted();
		return this.ready;
	}

	resolve(state: RailWorkerBridgeState): void {
		this.state = state;
		this.resolveReady(state);
	}

	reject(error: Error): void {
		this.rejectReady(error);
	}
}

function readyState(payload: ReturnType<typeof compileRailStartup>): RailWorkerBridgeState {
	return {
		...INITIAL_RAIL_WORKER_STATE,
		status: "ready",
		sequence: payload.snapshot.sequence,
		revision: payload.snapshot.revision,
		checksum: payload.authoredChecksum,
		physicalSequence: payload.snapshot.sequence,
		physicalRevision: payload.snapshot.revision,
		physicalFingerprint: payload.physical.fingerprint,
	};
}

function rebindAdjacencyFingerprints(
	payload: ReturnType<typeof compileRailStartup>,
): ReturnType<typeof compileRailStartup> {
	return {
		...payload,
		renderArtifacts: {
			...payload.renderArtifacts,
			artifactFingerprint: checksumPhysicalRailRenderArtifacts(
				payload.renderArtifacts.value,
				payload.physical.fingerprint,
			),
		},
		draftArtifacts: {
			...payload.draftArtifacts,
			artifactFingerprint: checksumRailDraftPreparedArtifacts(
				payload.draftArtifacts.value,
				payload.physical.fingerprint,
			),
		},
	};
}

class CountingScheduler implements RailStartupScheduler {
	private timestamp = 0;
	private readonly afterYield?: () => void;
	yields = 0;

	constructor(afterYield?: () => void) {
		this.afterYield = afterYield;
	}

	now(): number {
		this.timestamp += 0.1;
		return this.timestamp;
	}

	async yield(): Promise<void> {
		this.yields++;
		this.afterYield?.();
	}
}

function largeAreaFixture(edgeCount: number): StaticFabOrganizationState {
	return {
		nextOrganizationId: 2,
		records: [
			{
				id: 1,
				kind: "AREA",
				name: "50k Edge Area",
				parentOrganizationIds: [],
				properties: { description: "", color: "TEAL" },
				membership: {
					railEdges: Array.from({ length: edgeCount }, (_, x) => ({
						from: { x, y: 0 },
						to: { x: x + 1, y: 0 },
					})),
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			},
		],
	};
}

function exactAreaState(
	ownership: ReturnType<typeof buildRailModuleOwnershipIndex>,
	name: string,
): StaticFabOrganizationState {
	const edges = ownership.modules
		.flatMap((module) => module.eraseEdges)
		.sort(compareDirectedRailEdges);
	return {
		nextOrganizationId: 2,
		records: [
			{
				id: 1,
				kind: "AREA",
				name,
				parentOrganizationIds: [],
				properties: { description: "", color: "TEAL" },
				membership: {
					railEdges: edges,
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			},
		],
	};
}
