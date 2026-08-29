import type { SimulationReadinessComponents } from "../compile/SimulationReadinessCertificate";
import { simulationReadinessComponentsError } from "../compile/SimulationReadinessCertificate";
import {
	type PublishedSimulationResidentReadinessSnapshot,
	publishedSimulationResidentReadinessSnapshotError,
} from "../compile/SimulationResidentReadinessCertificate";
import type { SimulationResidentScenarioEditorRunAsset } from "./SimulationResidentScenarioEditorSourceAdapter";
import { simulationResidentScenarioEditorRunAssetError } from "./SimulationResidentScenarioEditorSourceAdapter";

export const SIMULATION_RESIDENT_SCENARIO_INVALIDATION_REASONS = Object.freeze([
	"AUTHORED_MUTATION",
	"PROJECT_REPLACEMENT",
	"SOURCE_SWITCH",
	"EXPLICIT_CANCEL",
	"UNMOUNT",
] as const);
export type SimulationResidentScenarioInvalidationReason =
	(typeof SIMULATION_RESIDENT_SCENARIO_INVALIDATION_REASONS)[number];

export interface SimulationResidentScenarioSourceIdentity {
	readonly sourceKind: SimulationResidentScenarioEditorRunAsset["manifest"]["sourceKind"];
	readonly runAssetFingerprint: string;
	readonly foundationFingerprint: string;
	readonly parkingFingerprint: string;
	readonly manifestFingerprint: string;
	readonly serviceTimingInputFingerprint: string;
	readonly resourceRunInputFingerprint: string;
}

export type SimulationResidentScenarioSessionState =
	| Readonly<{ phase: "IDLE"; generation: 0 }>
	| Readonly<{
			phase: "PREPARING";
			generation: number;
			source: SimulationResidentScenarioSourceIdentity;
	  }>
	| Readonly<{
			phase: "PREPARED";
			generation: number;
			source: SimulationResidentScenarioSourceIdentity;
			certificateFingerprint: string;
			requestCount: number;
			vehicleCount: number;
	  }>
	| Readonly<{
			phase: "FAILED";
			generation: number;
			source: SimulationResidentScenarioSourceIdentity;
			message: string;
	  }>
	| Readonly<{
			phase: "INVALIDATED";
			generation: number;
			reason: SimulationResidentScenarioInvalidationReason;
	  }>;

export interface SimulationResidentScenarioPreparationPort {
	prepare(
		components: SimulationReadinessComponents,
		runAsset: SimulationResidentScenarioEditorRunAsset,
		generation: number,
	): Promise<PublishedSimulationResidentReadinessSnapshot>;
	cancel(): void;
	dispose(): void;
}

const INITIAL_STATE: SimulationResidentScenarioSessionState = Object.freeze({
	phase: "IDLE",
	generation: 0,
});
const MAX_FAILURE_MESSAGE_LENGTH = 240;

/** Owns one prepared resident certificate privately and publishes bounded identity/count state. */
export class SimulationResidentScenarioSession {
	private readonly preparation: SimulationResidentScenarioPreparationPort;
	private readonly listeners = new Set<() => void>();
	private state: SimulationResidentScenarioSessionState = INITIAL_STATE;
	private preparedSnapshot: PublishedSimulationResidentReadinessSnapshot | null = null;
	private generation = 0;
	private disposed = false;

	constructor(preparation: SimulationResidentScenarioPreparationPort) {
		if (!preparation || typeof preparation.prepare !== "function") {
			throw new TypeError("Resident scenario preparation port is invalid.");
		}
		this.preparation = preparation;
	}

	getState(): SimulationResidentScenarioSessionState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.assertActive();
		if (typeof listener !== "function")
			throw new TypeError("Resident session listener is invalid.");
		this.listeners.add(listener);
		let subscribed = true;
		return (): void => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
		};
	}

	async prepare(
		components: SimulationReadinessComponents,
		runAsset: SimulationResidentScenarioEditorRunAsset,
	): Promise<PublishedSimulationResidentReadinessSnapshot> {
		this.assertActive();
		const source = residentScenarioSourceIdentity(components, runAsset);
		const generation = this.nextGeneration();
		this.preparation.cancel();
		this.preparedSnapshot = null;
		this.publish(Object.freeze({ phase: "PREPARING", generation, source }));
		try {
			const snapshot = await this.preparation.prepare(components, runAsset, generation);
			if (generation !== this.generation || this.disposed) throw cancelledError();
			const error = await publishedSimulationResidentReadinessSnapshotError(snapshot);
			if (error) throw new Error(`Prepared resident snapshot is invalid: ${error}`);
			if (!snapshotMatchesSource(snapshot, source)) {
				throw new Error("Prepared resident snapshot does not match the exact retained source.");
			}
			this.preparedSnapshot = snapshot;
			this.publish(
				Object.freeze({
					phase: "PREPARED",
					generation,
					source,
					certificateFingerprint: snapshot.certificate.fingerprint,
					requestCount: snapshot.certificate.requestCount,
					vehicleCount: snapshot.certificate.vehicleCount,
				}),
			);
			return snapshot;
		} catch (error) {
			if (generation !== this.generation || this.disposed) throw cancelledError();
			this.preparedSnapshot = null;
			const normalized = normalizeError(error);
			this.publish(
				Object.freeze({
					phase: "FAILED",
					generation,
					source,
					message: normalized.message.slice(0, MAX_FAILURE_MESSAGE_LENGTH),
				}),
			);
			throw normalized;
		}
	}

	preparedSnapshotFor(
		components: SimulationReadinessComponents,
		runAsset: SimulationResidentScenarioEditorRunAsset,
	): PublishedSimulationResidentReadinessSnapshot | null {
		if (this.state.phase !== "PREPARED" || !this.preparedSnapshot) return null;
		let source: SimulationResidentScenarioSourceIdentity;
		try {
			source = residentScenarioSourceIdentity(components, runAsset);
		} catch {
			return null;
		}
		return sameSource(this.state.source, source) &&
			snapshotMatchesSource(this.preparedSnapshot, source)
			? this.preparedSnapshot
			: null;
	}

	invalidate(reason: SimulationResidentScenarioInvalidationReason): void {
		this.assertActive();
		if (!SIMULATION_RESIDENT_SCENARIO_INVALIDATION_REASONS.includes(reason)) {
			throw new RangeError("Resident scenario invalidation reason is invalid.");
		}
		const generation = this.nextGeneration();
		this.preparation.cancel();
		this.preparedSnapshot = null;
		this.publish(Object.freeze({ phase: "INVALIDATED", generation, reason }));
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const generation = this.nextGeneration();
		this.preparation.cancel();
		this.preparation.dispose();
		this.preparedSnapshot = null;
		this.publish(Object.freeze({ phase: "INVALIDATED", generation, reason: "UNMOUNT" }));
		this.listeners.clear();
	}

	private nextGeneration(): number {
		this.generation =
			this.generation === Number.MAX_SAFE_INTEGER ? 1 : Math.max(1, this.generation + 1);
		return this.generation;
	}

	private publish(state: SimulationResidentScenarioSessionState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Resident scenario session is disposed.");
	}
}

export function residentScenarioSourceIdentity(
	components: SimulationReadinessComponents,
	runAsset: SimulationResidentScenarioEditorRunAsset,
): SimulationResidentScenarioSourceIdentity {
	const componentsError = simulationReadinessComponentsError(components);
	const assetError = simulationResidentScenarioEditorRunAssetError(runAsset);
	if (componentsError || assetError) {
		throw new Error(
			componentsError
				? `Resident scenario components are invalid: ${componentsError}`
				: `Resident scenario run asset is invalid: ${assetError}`,
		);
	}
	if (
		runAsset.parking.sourceFoundationFingerprint !== components.foundation.fingerprint ||
		runAsset.parking.sourceTrackResourceTopologyFingerprint !==
			components.trackResources.fingerprint ||
		runAsset.parking.sourceOccupancyPolicyFingerprint !== components.occupancyPolicy.fingerprint
	) {
		throw new Error("Resident scenario parking does not match the exact static components.");
	}
	return Object.freeze({
		sourceKind: runAsset.manifest.sourceKind,
		runAssetFingerprint: runAsset.fingerprint,
		foundationFingerprint: components.foundation.fingerprint,
		parkingFingerprint: runAsset.parking.fingerprint,
		manifestFingerprint: runAsset.manifest.fingerprint,
		serviceTimingInputFingerprint: runAsset.serviceTimingInputFingerprint,
		resourceRunInputFingerprint: runAsset.resourceRunInputFingerprint,
	});
}

function snapshotMatchesSource(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
	source: SimulationResidentScenarioSourceIdentity,
): boolean {
	return (
		snapshot.foundation.fingerprint === source.foundationFingerprint &&
		snapshot.parking.fingerprint === source.parkingFingerprint &&
		snapshot.manifest.fingerprint === source.manifestFingerprint &&
		snapshot.serviceTiming.sourceTimingInputFingerprint === source.serviceTimingInputFingerprint &&
		snapshot.resourceRunConfiguration.sourceResourceInputFingerprint ===
			source.resourceRunInputFingerprint &&
		snapshot.certificate.sourceKind === source.sourceKind
	);
}

function sameSource(
	left: SimulationResidentScenarioSourceIdentity,
	right: SimulationResidentScenarioSourceIdentity,
): boolean {
	return (
		left.sourceKind === right.sourceKind &&
		left.runAssetFingerprint === right.runAssetFingerprint &&
		left.foundationFingerprint === right.foundationFingerprint &&
		left.parkingFingerprint === right.parkingFingerprint &&
		left.manifestFingerprint === right.manifestFingerprint &&
		left.serviceTimingInputFingerprint === right.serviceTimingInputFingerprint &&
		left.resourceRunInputFingerprint === right.resourceRunInputFingerprint
	);
}

function cancelledError(): Error {
	return new Error("Resident scenario preparation was cancelled by a newer lifecycle generation.");
}

function normalizeError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}
