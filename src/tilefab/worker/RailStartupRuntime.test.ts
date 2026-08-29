import { describe, expect, it } from "vitest";
import {
	checksumPortSlotPreparedArtifactCatalog,
	portSlotPreparedArtifactsHaveExactSourceLayout,
} from "../compile/PortSlotPreparedArtifacts";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	emptyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import { RailDocument } from "../core/RailDocument";
import { createRailModuleOwnershipIndexHydrator } from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import { activateRailEditorStartup } from "../editor/RailEditorStartup";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { OpenFabProjectParseError, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { hydratePortEquipmentSnapshot } from "./PortEquipmentSoA";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";
import {
	checksumRailPhysicalLayout,
	validateRailPhysicalLayoutContract,
} from "./RailPhysicalLayout";
import { createRailScaleProbeDocument } from "./RailStartupFixture";
import { RAIL_STARTUP_SCHEMA_VERSION } from "./RailStartupProtocol";
import { compileRailStartup } from "./RailStartupRuntime";
import { checksumRailStartupPlainMetadataCooperatively } from "./RailStartupTransportContract";
import { collectTransferableBuffers } from "./TransferableBuffers";

describe("compileRailStartup", () => {
	it("publishes one revision-consistent authored and derived candidate", () => {
		let timestamp = 0;
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 25 }, () => ++timestamp);
		const ownershipHydrator = createRailModuleOwnershipIndexHydrator(payload.ownership.value);
		while (!ownershipHydrator.done) ownershipHydrator.step(3);
		const ownership = ownershipHydrator.finish();

		expect(payload.snapshot.encoded).toHaveLength(25);
		expect(payload.schemaVersion).toBe(RAIL_STARTUP_SCHEMA_VERSION);
		expect(payload.snapshot.sequence).toBe(1);
		expect(payload.snapshot.revision).toBe(25);
		expect(payload.analysis.value).toMatchObject({ status: "open", cells: 25, edges: 24 });
		expect(payload.readiness.value).toMatchObject({
			status: "blocked",
			ready: false,
			summary: { cells: 25, physicalPaths: 25, physicalStrongComponents: 25 },
		});
		expect(payload.readiness.fingerprint).toBe(payload.readiness.value.fingerprint);
		expect(payload.physical.value.revision).toBe(payload.snapshot.revision);
		expect(payload.physical.value.paths.pathCount).toBe(25);
		expect(payload.draftArtifacts.value.forwardAdjacency).toBe(
			payload.renderArtifacts.value.adjacency,
		);
		expect(payload.draftArtifacts.value.reverseAdjacency.offsets).toHaveLength(26);
		expect(ownership.revision).toBe(payload.snapshot.revision);
		expect(ownership.resolve({ x: 0, y: 0 }).status).toBe("resolved");
		expect(payload.timings.totalMilliseconds).toBeGreaterThan(0);
		expect(payload.timings.readinessMilliseconds).toBeGreaterThan(0);
	});

	it("recomputes the Worker plain metadata digest in bounded 10k checkpoints", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 10_000 });
		let checkpoints = 0;
		const fingerprint = await checksumRailStartupPlainMetadataCooperatively(
			payload.physical.value,
			payload.readiness.value,
			async () => {
				checkpoints++;
			},
		);

		expect(fingerprint).toBe(payload.plainMetadataFingerprint);
		expect(checkpoints).toBeGreaterThan(100);
	});

	it("can publish two disconnected scale roots without changing the requested cell budget", () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 25, rootCount: 2 });

		expect(payload.source).toEqual({ kind: "scale-probe", cellCount: 25, rootCount: 2 });
		expect(payload.snapshot).toMatchObject({ sequence: 1, revision: 25 });
		expect(payload.snapshot.encoded).toHaveLength(25);
		expect(payload.analysis.value).toMatchObject({
			status: "disconnected",
			cells: 25,
			edges: 23,
			components: 2,
			openEnds: 4,
		});
		expect(payload.physical.value.paths.pathCount).toBe(25);
	});

	it("can isolate two small arrangement roots beside one factory-scale source route", () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 25, rootCount: 3 });

		expect(payload.snapshot).toMatchObject({ sequence: 1, revision: 25 });
		expect(payload.analysis.value).toMatchObject({
			status: "disconnected",
			cells: 25,
			edges: 22,
			components: 3,
			openEnds: 6,
		});
		expect(payload.physical.value.paths.pathCount).toBe(25);
	});

	it("rejects an unsafe scale source before publishing a candidate", () => {
		expect(() => compileRailStartup({ kind: "scale-probe", cellCount: 1 })).toThrow(RangeError);
	});

	it("derives a revision-bound candidate from an authored snapshot source", () => {
		const document = createRailScaleProbeDocument(25);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const payload = compileRailStartup({ kind: "snapshot", snapshot });

		expect(payload.source).toEqual({
			kind: "snapshot",
			sequence: snapshot.sequence,
			revision: snapshot.revision,
			checksum: snapshot.checksum,
		});
		expect(payload.snapshot).not.toBe(snapshot);
		expect(payload.snapshot.checksum).toBe(snapshot.checksum);
		expect(payload.snapshot.sequence).toBe(snapshot.sequence);
		expect(payload.physical.value.paths.pathCount).toBe(25);
	});

	it("starts a newly-created native project directly from its certified typed snapshot", () => {
		const document = createRailScaleProbeDocument(25);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const payload = compileRailStartup({
			kind: "project-snapshot",
			snapshot,
			manifest: {
				id: "direct-project-001",
				name: "Direct project",
				createdAt: "2026-07-18T00:00:00.000Z",
				updatedAt: "2026-07-18T00:00:00.000Z",
			},
		});

		expect(payload.source).toMatchObject({
			kind: "project",
			manifest: { id: "direct-project-001", name: "Direct project" },
			view: null,
			blueprints: { schemaVersion: 3, records: [] },
			schemaVersion: 10,
			migratedFromVersion: null,
			checksum: snapshot.checksum,
		});
		expect(payload.authoredChecksum).toBe(snapshot.checksum);
		expect(payload.snapshot.checksum).toBe(snapshot.checksum);
	});

	it("rejects invalid metadata on the direct project snapshot boundary", () => {
		const document = createRailScaleProbeDocument(25);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;

		expect(() =>
			compileRailStartup({
				kind: "project-snapshot",
				snapshot,
				manifest: {
					id: "invalid id with spaces",
					name: "Direct project",
					createdAt: "2026-07-18T00:00:00.000Z",
					updatedAt: "2026-07-18T00:00:00.000Z",
				},
			}),
		).toThrow(OpenFabProjectParseError);
	});

	it("parses, compiles, and activates a native project with its static entities", async () => {
		const portEquipment = startupPortEquipmentFixture();
		const sourceDocument = createRailScaleProbeDocument(25);
		const document = RailDocument.fromLoadedMap(
			sourceDocument.map,
			sourceDocument.getPatchSequence(),
			portEquipment,
		);
		const operations = operationalConfigurationFixture();
		const json = serializeOpenFabProject(
			captureOpenFabProject(document, {
				manifest: {
					id: "worker-project-001",
					name: "Worker candidate",
					createdAt: "2026-07-18T00:00:00.000Z",
					updatedAt: "2026-07-18T00:00:00.000Z",
				},
				view: {
					center: [12, 0],
					zoomPixelsPerMeter: 38,
					quarterTurns: 0,
					railPresentation: "profiled",
				},
				operations,
			}),
		);
		const projectPayload = compileRailStartup({ kind: "project-json", json });
		const snapshotPayload = compileRailStartup({
			kind: "snapshot",
			snapshot: captureRailMirrorSnapshot(document.map, document.getPatchSequence(), portEquipment)
				.snapshot,
		});

		expect(projectPayload.source).toMatchObject({
			kind: "project",
			manifest: { id: "worker-project-001", name: "Worker candidate" },
			view: { center: [12, 0], quarterTurns: 0 },
			schemaVersion: 10,
			migratedFromVersion: null,
			blueprints: { schemaVersion: 3, records: [] },
			operations,
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
		});
		expect(projectPayload.schemaVersion).toBe(RAIL_STARTUP_SCHEMA_VERSION);
		expect(projectPayload.authoredChecksum).toBe(snapshotPayload.authoredChecksum);
		expect(projectPayload.physical.fingerprint).toBe(snapshotPayload.physical.fingerprint);
		expect(projectPayload.readiness.fingerprint).toBe(snapshotPayload.readiness.fingerprint);
		expect(hydratePortEquipmentSnapshot(projectPayload.snapshot.portEquipment)).toEqual(
			hydratePortEquipmentSnapshot(snapshotPayload.snapshot.portEquipment),
		);
		const activation = await activateRailEditorStartup(projectPayload, {
			now: () => performance.now(),
			yield: async () => undefined,
		});
		expect(activation.model.document.portEquipment).toEqual(portEquipment);
		expect(activation.model.operationalConfiguration).toEqual(operations);
		expect(Object.isFrozen(activation.model.operationalConfiguration)).toBe(true);
		expect(activation.model.document.operationalConfiguration).toBe(
			activation.model.operationalConfiguration,
		);
	});

	it("migrates a v4 project library before publishing v10 startup metadata", () => {
		const project = captureOpenFabProject(createRailScaleProbeDocument(25), {
			manifest: {
				id: "worker-project-v4",
				name: "Worker v4 migration",
				createdAt: "2026-07-18T00:00:00.000Z",
				updatedAt: "2026-07-18T00:00:00.000Z",
			},
		});
		const legacy = JSON.parse(serializeOpenFabProject(project)) as {
			schemaVersion: number;
			blueprints: { schemaVersion: number };
			areas: { schemaVersion: number; nextOrganizationId?: number; records: unknown[] };
			operations?: unknown;
		};
		legacy.schemaVersion = 4;
		delete legacy.operations;
		legacy.blueprints.schemaVersion = 1;
		legacy.areas = { schemaVersion: 0, records: [] };

		const payload = compileRailStartup({ kind: "project-json", json: JSON.stringify(legacy) });

		expect(payload.schemaVersion).toBe(RAIL_STARTUP_SCHEMA_VERSION);
		expect(payload.source).toMatchObject({
			kind: "project",
			schemaVersion: 10,
			migratedFromVersion: 4,
			blueprints: { schemaVersion: 3, records: [] },
		});
	});

	it("upgrades a v7 project and its v2 blueprint section through startup", () => {
		const project = captureOpenFabProject(createRailScaleProbeDocument(25), {
			manifest: {
				id: "worker-project-v7",
				name: "Worker v7 migration",
				createdAt: "2026-07-18T00:00:00.000Z",
				updatedAt: "2026-07-18T00:00:00.000Z",
			},
		});
		const legacy = JSON.parse(serializeOpenFabProject(project)) as {
			schemaVersion: number;
			blueprints: { schemaVersion: number };
			operations?: unknown;
		};
		legacy.schemaVersion = 7;
		delete legacy.operations;
		legacy.blueprints.schemaVersion = 2;

		const payload = compileRailStartup({ kind: "project-json", json: JSON.stringify(legacy) });

		expect(payload.source).toMatchObject({
			kind: "project",
			schemaVersion: 10,
			migratedFromVersion: 7,
			blueprints: { schemaVersion: 3, records: [] },
		});
	});

	it("rejects malformed project JSON before it can publish a startup candidate", () => {
		expect(() => compileRailStartup({ kind: "project-json", json: "{" })).toThrowError(
			OpenFabProjectParseError,
		);
	});

	it("rejects a project whose persisted port route no longer exists", () => {
		const sourceDocument = createRailScaleProbeDocument(25);
		const portEquipment = startupPortEquipmentFixture();
		const document = RailDocument.fromLoadedMap(
			sourceDocument.map,
			sourceDocument.getPatchSequence(),
			portEquipment,
		);
		const project = captureOpenFabProject(document, {
			manifest: {
				id: "broken-port-project",
				name: "Broken port",
				createdAt: "2026-07-18T00:00:00.000Z",
				updatedAt: "2026-07-18T00:00:00.000Z",
			},
		});
		const sourcePort = project.ports.records[0];
		if (!sourcePort) throw new Error("Expected startup port fixture.");
		const json = serializeOpenFabProject({
			...project,
			ports: {
				...project.ports,
				records: [
					{
						...sourcePort,
						route: { kind: "CARDINAL_CELL", cell: [999, 999], from: "E", to: "W" },
					},
				],
			},
		});

		expect(() => compileRailStartup({ kind: "project-json", json })).toThrow(
			"Port equipment layout is invalid",
		);
	});

	it("rejects a snapshot source whose typed content does not match its checksum", () => {
		const document = createRailScaleProbeDocument(25);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		snapshot.encoded[0] ^= 1;

		expect(() => compileRailStartup({ kind: "snapshot", snapshot })).toThrow(
			"Rail snapshot source checksum does not match its typed buffers",
		);
	});

	it("survives a real transferable payload round trip without losing typed contracts", async () => {
		const payload = compileRailStartup({ kind: "scale-probe", cellCount: 25 });
		const transfers = collectTransferableBuffers(payload);
		const independentlyDiscovered = discoverArrayBuffers(payload);
		expect(new Set(transfers).size).toBe(transfers.length);
		expect(new Set(transfers)).toEqual(independentlyDiscovered);

		const received = structuredClone(payload, { transfer: transfers });
		for (const buffer of independentlyDiscovered) expect(buffer.byteLength).toBe(0);
		expect(received.snapshot.xs).toBeInstanceOf(Int32Array);
		expect(received.snapshot.encoded).toBeInstanceOf(Uint8Array);
		expect(received.physical.value.paths.positions).toBeInstanceOf(Float32Array);
		expect(received.readiness.value.locations.openTerminalCells).toBeInstanceOf(Int32Array);
		expect(received.readiness.value.locations.physicalOpenPathIdentities).toBeInstanceOf(
			Int32Array,
		);
		expect(received.renderArtifacts.value.cellIndex.values).toBeInstanceOf(Uint32Array);
		expect(received.draftArtifacts.value.envelopeSpatialIndex.envelopeIndices).toBeInstanceOf(
			Uint32Array,
		);
		expect(
			Object.is(
				received.draftArtifacts.value.forwardAdjacency,
				received.renderArtifacts.value.adjacency,
			),
		).toBe(true);
		expect(received.draftArtifacts.value.reverseAdjacency.offsets).toBeInstanceOf(Uint32Array);
		expect(received.draftArtifacts.value.reverseAdjacency.targets).toBeInstanceOf(Uint32Array);
		for (const portType of ["OHB", "EQ", "STK"] as const) {
			expect(received.portSlotArtifacts.value[portType].slots.worldPositions).toBeInstanceOf(
				Float32Array,
			);
			expect(received.portSlotArtifacts.value[portType].spatialIndex.slotIndices).toBeInstanceOf(
				Uint32Array,
			);
		}
		validateRailPhysicalLayoutContract(received.physical.value);
		expect(checksumRailPhysicalLayout(received.physical.value)).toBe(received.physical.fingerprint);
		const deliveredPortSlotArtifacts = received.portSlotArtifacts.value;
		const deliveredPortSlotBuffers = collectTransferableBuffers(deliveredPortSlotArtifacts);
		const deliveredSnapshotBuffers = collectTransferableBuffers(received.snapshot);
		const deliveredDerivedBuffers = collectTransferableBuffers(
			received.analysis.value,
			received.ownership.value,
			received.physical.value,
			received.readiness.value,
			received.renderArtifacts.value,
			received.draftArtifacts.value,
		);
		const deliveredPhysical = received.physical.value;
		const deliveredReadiness = received.readiness.value;
		const deliveredRenderArtifacts = received.renderArtifacts.value;
		const deliveredDraftArtifacts = received.draftArtifacts.value;

		const activation = await activateRailEditorStartup(received, {
			now: () => performance.now(),
			yield: async () => undefined,
		});
		expect(activation.model.document.map.size).toBe(25);
		expect(Object.is(activation.model.physical, deliveredPhysical)).toBe(false);
		expect(Object.is(activation.model.readiness, deliveredReadiness)).toBe(false);
		expect(Object.is(activation.model.renderArtifacts, deliveredRenderArtifacts)).toBe(false);
		expect(Object.is(activation.model.draftArtifacts, deliveredDraftArtifacts)).toBe(false);
		expect(deliveredSnapshotBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(deliveredDerivedBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(activation.model.physical.paths.positions.byteLength).toBeGreaterThan(0);
		expect(
			Object.is(
				activation.model.draftArtifacts?.forwardAdjacency,
				activation.model.renderArtifacts?.adjacency,
			),
		).toBe(true);
		expect(activation.model.renderArtifacts?.presentation.source).toBe(
			activation.model.physical.paths,
		);
		expect(activation.model.draftArtifacts?.pathCellIndex).toBe(
			activation.model.renderArtifacts?.cellIndex,
		);
		expect(Object.is(activation.model.portSlotArtifacts, deliveredPortSlotArtifacts)).toBe(false);
		expect(deliveredPortSlotBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(
			checksumPortSlotPreparedArtifactCatalog(
				activation.model.portSlotArtifacts,
				received.physical.fingerprint,
			),
		).toBe(received.portSlotArtifacts.artifactFingerprint);
		for (const portType of ["OHB", "EQ", "STK"] as const) {
			expect(
				portSlotPreparedArtifactsHaveExactSourceLayout(
					activation.model.portSlotArtifacts[portType],
					activation.model.physical,
				),
			).toBe(true);
		}
		const evaluator = new RailDraftEvaluator();
		evaluator.prepare(activation.model.physical, activation.model.draftArtifacts ?? undefined);
		expect(evaluator.getStats()).toMatchObject({
			committedPreparedBindings: 1,
			committedAdjacencyBuilds: 0,
		});
	});
});

function discoverArrayBuffers(root: unknown): Set<ArrayBuffer> {
	const buffers = new Set<ArrayBuffer>();
	const visited = new WeakSet<object>();
	const stack: unknown[] = [root];
	while (stack.length > 0) {
		const value = stack.pop();
		if (value === null || typeof value !== "object") continue;
		if (value instanceof ArrayBuffer) {
			buffers.add(value);
			continue;
		}
		if (ArrayBuffer.isView(value)) {
			if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
			continue;
		}
		if (visited.has(value)) continue;
		visited.add(value);
		for (const key of Reflect.ownKeys(value)) {
			stack.push(Reflect.get(value, key));
		}
	}
	return buffers;
}

function startupPortEquipmentFixture(): PortEquipmentState {
	return {
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: [
			{
				id: 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL", x: 1, z: 0, from: DIR_E, to: DIR_W },
				stationMillimeters: 500,
				side: "LEFT",
				lateralOffsetMillimeters: 700,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: null,
			},
		],
		equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
	};
}

function operationalConfigurationFixture(): OperationalConfigurationState {
	return {
		...emptyOperationalConfigurationState(),
		revision: 1,
		vehicleProfile: {
			id: "OPENFAB_STARTUP_TEST_OHT_V1",
			version: 1,
			bodyLengthMillimeters: 1_200,
			referenceToFrontMillimeters: 600,
			referenceToRearMillimeters: 600,
			bodyWidthMillimeters: 500,
			lateralSafetyMarginMillimeters: 50,
			frontSafetyMarginMillimeters: 200,
			rearSafetyMarginMillimeters: 200,
			maximumSpeedMillimetersPerSecond: 2_000,
			controlReactionMilliseconds: 100,
			minimumServiceDecelerationMillimetersPerSecondSquared: 1_000,
		},
	};
}
