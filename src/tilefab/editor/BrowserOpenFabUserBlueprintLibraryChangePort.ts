import type { OpenFabUserBlueprintLibraryChangePort } from "../project/OpenFabUserBlueprintLibrary";

const OPENFAB_USER_BLUEPRINT_LIBRARY_CHANNEL = "openfab-user-blueprint-library-v1";
const OPENFAB_USER_BLUEPRINT_LIBRARY_CHANGE_SCHEMA_VERSION = 1;
const OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_OBSERVED_SOURCES = 64;
const OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_SOURCE_ID_LENGTH = 128;

interface BrowserBroadcastChannel {
	postMessage(message: unknown): void;
	addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
	close(): void;
}

export type BrowserOpenFabUserBlueprintLibraryChannelFactory = (
	name: string,
) => BrowserBroadcastChannel | null;

export interface BrowserOpenFabUserBlueprintLibraryChangePortOptions {
	readonly channelFactory?: BrowserOpenFabUserBlueprintLibraryChannelFactory;
	readonly sourceId?: string;
}

interface OpenFabUserBlueprintLibraryChangeMessage {
	readonly schemaVersion: typeof OPENFAB_USER_BLUEPRINT_LIBRARY_CHANGE_SCHEMA_VERSION;
	readonly kind: "changed";
	readonly sourceId: string;
	readonly sequence: number;
}

export class BrowserOpenFabUserBlueprintLibraryChangePort
	implements OpenFabUserBlueprintLibraryChangePort
{
	readonly available: boolean;
	private readonly sourceId: string;
	private readonly channel: BrowserBroadcastChannel | null;
	private readonly listeners = new Set<() => void>();
	private readonly lastSequenceBySource = new Map<string, number>();
	private sequence = 0;
	private disposed = false;

	constructor(options: BrowserOpenFabUserBlueprintLibraryChangePortOptions = {}) {
		this.sourceId = normalizeSourceId(options.sourceId ?? createSourceId());
		this.channel = (options.channelFactory ?? createBrowserBroadcastChannel)(
			OPENFAB_USER_BLUEPRINT_LIBRARY_CHANNEL,
		);
		this.available = this.channel !== null;
		this.channel?.addEventListener("message", this.onMessage);
	}

	publishChange(): void {
		if (this.disposed || !this.channel) return;
		this.sequence += 1;
		const message: OpenFabUserBlueprintLibraryChangeMessage = Object.freeze({
			schemaVersion: OPENFAB_USER_BLUEPRINT_LIBRARY_CHANGE_SCHEMA_VERSION,
			kind: "changed",
			sourceId: this.sourceId,
			sequence: this.sequence,
		});
		this.channel.postMessage(message);
	}

	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => undefined;
		this.listeners.add(listener);
		let subscribed = true;
		return () => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.channel?.removeEventListener("message", this.onMessage);
		this.channel?.close();
		this.listeners.clear();
		this.lastSequenceBySource.clear();
	}

	private readonly onMessage = (event: MessageEvent<unknown>): void => {
		if (this.disposed) return;
		const message = parseChangeMessage(event.data);
		if (!message || message.sourceId === this.sourceId) return;
		const previousSequence = this.lastSequenceBySource.get(message.sourceId) ?? 0;
		if (message.sequence <= previousSequence) return;
		if (
			!this.lastSequenceBySource.has(message.sourceId) &&
			this.lastSequenceBySource.size >= OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_OBSERVED_SOURCES
		) {
			const oldestSource = this.lastSequenceBySource.keys().next().value;
			if (oldestSource !== undefined) this.lastSequenceBySource.delete(oldestSource);
		}
		this.lastSequenceBySource.delete(message.sourceId);
		this.lastSequenceBySource.set(message.sourceId, message.sequence);
		for (const listener of [...this.listeners]) listener();
	};
}

function createBrowserBroadcastChannel(name: string): BrowserBroadcastChannel | null {
	if (typeof BroadcastChannel !== "function") return null;
	try {
		return new BroadcastChannel(name);
	} catch {
		return null;
	}
}

function createSourceId(): string {
	const randomUuid = globalThis.crypto?.randomUUID?.();
	if (randomUuid) return randomUuid;
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSourceId(sourceId: string): string {
	if (
		sourceId.length === 0 ||
		sourceId.length > OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_SOURCE_ID_LENGTH
	) {
		throw new TypeError("Blueprint library change source id is invalid.");
	}
	return sourceId;
}

function parseChangeMessage(value: unknown): OpenFabUserBlueprintLibraryChangeMessage | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<OpenFabUserBlueprintLibraryChangeMessage>;
	if (
		candidate.schemaVersion !== OPENFAB_USER_BLUEPRINT_LIBRARY_CHANGE_SCHEMA_VERSION ||
		candidate.kind !== "changed" ||
		typeof candidate.sourceId !== "string" ||
		candidate.sourceId.length === 0 ||
		candidate.sourceId.length > OPENFAB_USER_BLUEPRINT_LIBRARY_MAX_SOURCE_ID_LENGTH ||
		!Number.isSafeInteger(candidate.sequence) ||
		(candidate.sequence ?? 0) <= 0
	) {
		return null;
	}
	return candidate as OpenFabUserBlueprintLibraryChangeMessage;
}
