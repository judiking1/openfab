import type { OpenFabProjectManifest } from "../project/OpenFabProject";
import type { RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import type { RailStartupPayload, RailStartupSource } from "../worker/RailStartupProtocol";
import {
	createBrowserRailStartupScheduler,
	prepareRailEditorStartupCandidate,
	type RailEditorStartupCandidate,
} from "./RailEditorStartup";
import { RailStartupBridge, RailStartupCancelledError } from "./RailStartupBridge";

export type RailProjectStartupMetadata = Extract<
	RailStartupPayload["source"],
	{ readonly kind: "project" }
>;

export interface PreparedOpenFabProjectLoad {
	readonly payload: RailStartupPayload;
	readonly metadata: RailProjectStartupMetadata;
	readonly candidate: RailEditorStartupCandidate;
}

export interface OpenFabProjectStartupPort {
	load(
		source: Extract<RailStartupSource, { readonly kind: "project-json" | "project-snapshot" }>,
	): Promise<RailStartupPayload>;
	dispose(): void;
}

export interface OpenFabProjectLoaderDependencies {
	readonly createStartupPort: () => OpenFabProjectStartupPort;
	readonly prepareCandidate: typeof prepareRailEditorStartupCandidate;
}

const DEFAULT_DEPENDENCIES: OpenFabProjectLoaderDependencies = {
	createStartupPort: () => new RailStartupBridge(),
	prepareCandidate: prepareRailEditorStartupCandidate,
};

interface ActiveProjectLoad {
	readonly id: number;
	readonly startupPort: OpenFabProjectStartupPort;
	readonly controller: AbortController;
}

/** Latest-wins project loader. A returned candidate remains private until its caller promotes it. */
export class OpenFabProjectLoader {
	private readonly dependencies: OpenFabProjectLoaderDependencies;
	private active: ActiveProjectLoad | null = null;
	private nextRequestId = 1;
	private disposed = false;

	constructor(dependencies: OpenFabProjectLoaderDependencies = DEFAULT_DEPENDENCIES) {
		this.dependencies = dependencies;
	}

	async prepare(
		json: string,
		onMirrorState: Parameters<typeof prepareRailEditorStartupCandidate>[3],
	): Promise<PreparedOpenFabProjectLoad> {
		return this.prepareSource({ kind: "project-json", json }, onMirrorState);
	}

	async prepareSnapshot(
		snapshot: RailMirrorSnapshot,
		manifest: OpenFabProjectManifest,
		onMirrorState: Parameters<typeof prepareRailEditorStartupCandidate>[3],
	): Promise<PreparedOpenFabProjectLoad> {
		return this.prepareSource({ kind: "project-snapshot", snapshot, manifest }, onMirrorState);
	}

	private async prepareSource(
		source: Extract<RailStartupSource, { readonly kind: "project-json" | "project-snapshot" }>,
		onMirrorState: Parameters<typeof prepareRailEditorStartupCandidate>[3],
	): Promise<PreparedOpenFabProjectLoad> {
		if (this.disposed) throw new RailStartupCancelledError();
		this.cancel();
		const active: ActiveProjectLoad = {
			id: this.nextRequestId++,
			startupPort: this.dependencies.createStartupPort(),
			controller: new AbortController(),
		};
		this.active = active;
		let candidate: RailEditorStartupCandidate | null = null;
		try {
			const payload = await raceWithAbort(
				active.startupPort.load(source),
				active.controller.signal,
			);
			this.assertActive(active);
			if (payload.source.kind !== "project") {
				throw new Error("Native project startup returned non-project metadata.");
			}
			const candidatePromise = this.dependencies.prepareCandidate(
				payload,
				createBrowserRailStartupScheduler(),
				active.controller.signal,
				onMirrorState,
			);
			void candidatePromise.then(
				(prepared) => {
					if (this.disposed || active.controller.signal.aborted || this.active?.id !== active.id) {
						prepared.mirrorBridge.dispose();
					}
				},
				() => undefined,
			);
			candidate = await raceWithAbort(candidatePromise, active.controller.signal);
			this.assertActive(active);
			this.active = null;
			active.startupPort.dispose();
			return Object.freeze({ payload, metadata: payload.source, candidate });
		} catch (error) {
			const wasCancelled =
				this.disposed ||
				active.controller.signal.aborted ||
				this.active?.id !== active.id ||
				error instanceof RailStartupCancelledError ||
				(error instanceof DOMException && error.name === "AbortError");
			if (this.active?.id === active.id) this.active = null;
			active.controller.abort();
			active.startupPort.dispose();
			candidate?.mirrorBridge.dispose();
			if (wasCancelled) {
				throw new RailStartupCancelledError();
			}
			throw error;
		}
	}

	cancel(): void {
		const active = this.active;
		if (!active) return;
		this.active = null;
		active.controller.abort();
		active.startupPort.dispose();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancel();
	}

	private assertActive(active: ActiveProjectLoad): void {
		if (this.disposed || this.active?.id !== active.id || active.controller.signal.aborted) {
			throw new RailStartupCancelledError();
		}
	}
}

function raceWithAbort<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
	if (signal.aborted) return Promise.reject(new RailStartupCancelledError());
	return new Promise<Value>((resolve, reject) => {
		const cancel = (): void => reject(new RailStartupCancelledError());
		signal.addEventListener("abort", cancel, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", cancel);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", cancel);
				reject(error);
			},
		);
	});
}
