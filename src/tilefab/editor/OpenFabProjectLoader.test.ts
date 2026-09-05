import { describe, expect, it } from "vitest";
import { emptyOperationalConfigurationState } from "../core/OperationalConfiguration";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { createRailScaleProbeDocument } from "../worker/RailStartupFixture";
import type { RailStartupPayload } from "../worker/RailStartupProtocol";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { INITIAL_RAIL_WORKER_STATE, type RailWorkerBridgeHandle } from "../worker/RailWorkerBridge";
import { OpenFabProjectLoader, type OpenFabProjectStartupPort } from "./OpenFabProjectLoader";
import type { RailEditorStartupCandidate } from "./RailEditorStartup";
import { RailStartupCancelledError } from "./RailStartupBridge";

describe("OpenFabProjectLoader", () => {
	it("returns a private verified candidate with project metadata", async () => {
		const payload = projectPayload("project-a");
		const mirror = new DisposableMirror();
		const loader = new OpenFabProjectLoader({
			createStartupPort: () => new ImmediateStartupPort(payload),
			prepareCandidate: async () => candidateFor(payload, mirror),
		});

		const prepared = await loader.prepare("project json", () => undefined);
		expect(prepared.metadata).toMatchObject({
			kind: "project",
			manifest: { id: "project-a" },
		});
		expect(prepared.candidate.mirrorBridge).toBe(mirror);
		expect(mirror.disposed).toBe(false);
		loader.dispose();
		expect(mirror.disposed).toBe(false);
	});

	it("prepares a new project from a typed snapshot source without JSON", async () => {
		const document = createRailScaleProbeDocument(12);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const payload = compileRailStartup({
			kind: "project-snapshot",
			snapshot: structuredClone(snapshot),
			manifest: {
				id: "direct-loader-001",
				name: "Direct loader",
				createdAt: "2026-07-18T00:00:00.000Z",
				updatedAt: "2026-07-18T00:00:00.000Z",
			},
		});
		const port = new RecordingStartupPort(payload);
		const loader = new OpenFabProjectLoader({
			createStartupPort: () => port,
			prepareCandidate: async () => candidateFor(payload, new DisposableMirror()),
		});
		const manifest = {
			id: "direct-loader-001",
			name: "Direct loader",
			createdAt: "2026-07-18T00:00:00.000Z",
			updatedAt: "2026-07-18T00:00:00.000Z",
		};

		const prepared = await loader.prepareSnapshot(snapshot, manifest, () => undefined);

		expect(port.source).toMatchObject({
			kind: "project-snapshot",
			manifest: { id: "direct-loader-001" },
		});
		expect(prepared.metadata).toMatchObject({
			kind: "project",
			manifest: { id: "direct-loader-001" },
			migratedFromVersion: null,
		});
	});

	it("cancels an older request and lets only the latest candidate return", async () => {
		const ports: ControlledStartupPort[] = [];
		const loader = new OpenFabProjectLoader({
			createStartupPort: () => {
				const port = new ControlledStartupPort();
				ports.push(port);
				return port;
			},
			prepareCandidate: async (payload) => candidateFor(payload, new DisposableMirror()),
		});
		const first = loader.prepare("first", () => undefined);
		const firstRejected = expect(first).rejects.toBeInstanceOf(RailStartupCancelledError);
		const second = loader.prepare("second", () => undefined);

		expect(ports[0]?.disposed).toBe(true);
		ports[1]?.resolve(projectPayload("project-b"));
		await firstRejected;
		await expect(second).resolves.toMatchObject({
			metadata: { manifest: { id: "project-b" } },
		});
	});

	it("disposes a candidate when cancellation wins during final preparation", async () => {
		const payload = projectPayload("project-a");
		const mirror = new DisposableMirror();
		let releaseCandidate!: () => void;
		let markCandidateStarted!: () => void;
		const candidateGate = new Promise<void>((resolve) => {
			releaseCandidate = resolve;
		});
		const candidateStarted = new Promise<void>((resolve) => {
			markCandidateStarted = resolve;
		});
		const loader = new OpenFabProjectLoader({
			createStartupPort: () => new ImmediateStartupPort(payload),
			prepareCandidate: async () => {
				markCandidateStarted();
				await candidateGate;
				return candidateFor(payload, mirror);
			},
		});
		const pending = loader.prepare("project json", () => undefined);
		await candidateStarted;
		loader.cancel();
		releaseCandidate();

		await expect(pending).rejects.toBeInstanceOf(RailStartupCancelledError);
		await Promise.resolve();
		expect(mirror.disposed).toBe(true);
	});

	it("leaves the active editor outside the loader untouched on parse failure", async () => {
		const activeSession = { id: "existing", cells: 42 };
		const loader = new OpenFabProjectLoader({
			createStartupPort: () => new RejectingStartupPort(new Error("malformed project")),
			prepareCandidate: async () => {
				throw new Error("candidate preparation must not run");
			},
		});

		await expect(loader.prepare("bad", () => undefined)).rejects.toThrow("malformed project");
		expect(activeSession).toEqual({ id: "existing", cells: 42 });
	});
});

function projectPayload(id: string): RailStartupPayload {
	const document = createRailScaleProbeDocument(12);
	const json = serializeOpenFabProject(
		captureOpenFabProject(document, {
			manifest: {
				id,
				name: id,
				createdAt: "2026-07-18T00:00:00.000Z",
				updatedAt: "2026-07-18T00:00:00.000Z",
			},
		}),
	);
	return compileRailStartup({ kind: "project-json", json });
}

function candidateFor(
	payload: RailStartupPayload,
	mirrorBridge: RailWorkerBridgeHandle,
): RailEditorStartupCandidate {
	const document = createRailScaleProbeDocument(12);
	return {
		activation: {
			model: {
				document,
				operationalConfiguration:
					payload.source.kind === "project"
						? payload.source.operations
						: emptyOperationalConfigurationState(),
				map: document.map,
				portEquipment: document.portEquipment,
				organizations: document.organizations,
				relationships: document.relationships,
				authoredChecksum: payload.authoredChecksum,
				ownership: {} as RailEditorStartupCandidate["activation"]["model"]["ownership"],
				analysis: payload.analysis.value,
				physical: payload.physical.value,
				readiness: payload.readiness.value,
				renderArtifacts: payload.renderArtifacts.value,
				draftArtifacts: payload.draftArtifacts.value,
				portSlotArtifacts: payload.portSlotArtifacts.value,
			},
			metrics: {
				elapsedMilliseconds: 0,
				maxSliceMilliseconds: 0,
				maxSlicePhase: "synthetic-test",
				yieldCount: 0,
			},
		},
		draftEvaluator: {} as RailEditorStartupCandidate["draftEvaluator"],
		mirrorBridge,
		workerState: {
			...INITIAL_RAIL_WORKER_STATE,
			status: "ready",
			checksum: payload.authoredChecksum,
			physicalFingerprint: payload.physical.fingerprint,
		},
	};
}

class DisposableMirror implements RailWorkerBridgeHandle {
	disposed = false;

	getState() {
		return INITIAL_RAIL_WORKER_STATE;
	}

	captureCurrentSnapshot(): Promise<never> {
		return Promise.reject(new Error("Snapshot capture is not used by this loader test."));
	}

	captureCurrentOrganizationOutline(): Promise<never> {
		return Promise.reject(new Error("Organization outline is not used by this loader test."));
	}

	dispose(): void {
		this.disposed = true;
	}

	waitUntilAuthoredReady() {
		return Promise.resolve(INITIAL_RAIL_WORKER_STATE);
	}

	waitUntilReady() {
		return Promise.resolve(INITIAL_RAIL_WORKER_STATE);
	}
}

class ImmediateStartupPort implements OpenFabProjectStartupPort {
	private readonly payload: RailStartupPayload;

	constructor(payload: RailStartupPayload) {
		this.payload = payload;
	}

	load(_source: Parameters<OpenFabProjectStartupPort["load"]>[0]): Promise<RailStartupPayload> {
		void _source;
		return Promise.resolve(this.payload);
	}

	dispose(): void {}
}

class RecordingStartupPort extends ImmediateStartupPort {
	source: Parameters<OpenFabProjectStartupPort["load"]>[0] | null = null;

	override load(
		source: Parameters<OpenFabProjectStartupPort["load"]>[0],
	): Promise<RailStartupPayload> {
		this.source = source;
		return super.load(source);
	}
}

class ControlledStartupPort implements OpenFabProjectStartupPort {
	private readonly promise: Promise<RailStartupPayload>;
	private resolvePromise!: (payload: RailStartupPayload) => void;
	disposed = false;

	constructor() {
		this.promise = new Promise((resolve) => {
			this.resolvePromise = resolve;
		});
	}

	load(): Promise<RailStartupPayload> {
		return this.promise;
	}

	dispose(): void {
		this.disposed = true;
	}

	resolve(payload: RailStartupPayload): void {
		this.resolvePromise(payload);
	}
}

class RejectingStartupPort implements OpenFabProjectStartupPort {
	private readonly error: Error;

	constructor(error: Error) {
		this.error = error;
	}

	load(): Promise<RailStartupPayload> {
		return Promise.reject(this.error);
	}

	dispose(): void {}
}
