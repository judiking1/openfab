import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { DeterministicResidentRuntimePublication } from "../simulation/DeterministicResidentRuntimePublisher";
import type { DeterministicScenarioRuntimePublication } from "../simulation/DeterministicScenarioRuntimePublisher";

export const LIVE_SIMULATION_RUNTIME_VIEW_POLICY =
	"BORROWED_READ_ONLY_BOUNDED_PUBLICATION_V1" as const;
export const RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY =
	"BORROWED_READ_ONLY_BOUNDED_RESIDENT_PUBLICATION_V1" as const;

/** Current unlaunched-token view-neutral input for 2D and derived 3D runtime rendering. */
export interface CurrentSimulationRuntimePresentation {
	readonly policy: typeof LIVE_SIMULATION_RUNTIME_VIEW_POLICY;
	readonly activeRunGeneration: number;
	readonly projectId: string;
	readonly sourceKind: "TRANSFER_PLAN" | "REPLAY_HISTORY";
	readonly readinessProfileId: string;
	readonly runIdentityFingerprint: string;
	/** Exact bounded moving-pose identity shared by every derived view without exposing coordinates. */
	readonly poseFingerprint: string;
	/**
	 * Borrowed from the active owner and read-only by contract. The publisher already owns buffers
	 * distinct from scheduler truth; view consumers must never transfer or mutate these columns.
	 */
	readonly publication: DeterministicScenarioRuntimePublication;
}

/** Separate resident home-return view-neutral input over the same read-only renderer contract. */
export interface ResidentSimulationRuntimePresentation {
	readonly policy: typeof RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY;
	readonly activeRunGeneration: number;
	readonly projectId: string;
	readonly sourceKind: "TRANSFER_PLAN" | "REPLAY_HISTORY";
	readonly readinessProfileId: string;
	readonly authorizationFingerprint: string;
	readonly certificateFingerprint: string;
	/** Exact bounded resident pose identity shared by every derived view. */
	readonly poseFingerprint: string;
	/** Borrowed read-only publication; consumers must never transfer or mutate its columns. */
	readonly publication: DeterministicResidentRuntimePublication;
}

export type SimulationRuntimePresentation =
	| CurrentSimulationRuntimePresentation
	| ResidentSimulationRuntimePresentation;

/**
 * Fingerprints only the canonical bounded pose prefix. Publication sequence, cadence, time, and KPI
 * rows are excluded so a changed value proves that the rendered moving-instance state changed.
 */
export function simulationRuntimePoseFingerprint(
	publication: DeterministicScenarioRuntimePublication,
): string | null {
	const count = publication.publishedPoseCount;
	if (
		!Number.isSafeInteger(count) ||
		count < 0 ||
		count > 8_192 ||
		typeof publication.runIdentityFingerprint !== "string" ||
		publication.runIdentityFingerprint.length === 0 ||
		typeof publication.poseOrderPolicy !== "string" ||
		publication.poseOrderPolicy.length === 0 ||
		typeof publication.posesTruncated !== "boolean"
	) {
		return null;
	}
	const columns: readonly ArrayBufferView[] = [
		publication.poseRequestRows,
		publication.poseVehicleTokenIds,
		publication.poseSourcePortIds,
		publication.poseDestinationPortIds,
		publication.posePathRows,
		publication.poseRouteDistancesMeters,
		publication.poseAnchorDistancesMeters,
		publication.posePathStationsMeters,
		publication.poseWorldXMeters,
		publication.poseWorldZMeters,
		publication.poseTangentX,
		publication.poseTangentZ,
		publication.poseYawRadians,
	];
	if (!validPoseColumns(columns, count)) return null;
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([publication.poseOrderPolicy, publication.runIdentityFingerprint]);
	checksum.addNumbers([count, publication.posesTruncated ? 1 : 0]);
	checksum.addViews(columns);
	return checksum.digest();
}

/** Fingerprints the resident vehicle-row pose prefix without cadence, KPI, or event state. */
export function simulationResidentRuntimePoseFingerprint(
	publication: DeterministicResidentRuntimePublication,
): string | null {
	const count = publication.publishedPoseCount;
	if (
		!Number.isSafeInteger(count) ||
		count < 0 ||
		count > 8_192 ||
		typeof publication.sourceAuthorizationFingerprint !== "string" ||
		publication.sourceAuthorizationFingerprint.length === 0 ||
		typeof publication.sourceCertificateFingerprint !== "string" ||
		publication.sourceCertificateFingerprint.length === 0 ||
		typeof publication.poseOrderPolicy !== "string" ||
		publication.poseOrderPolicy.length === 0 ||
		typeof publication.posesTruncated !== "boolean"
	) {
		return null;
	}
	const columns: readonly ArrayBufferView[] = [
		publication.poseVehicleRows,
		publication.poseRequestRows,
		publication.poseVehiclePhaseCodes,
		publication.poseLegIndices,
		publication.poseSourcePortIds,
		publication.poseDestinationPortIds,
		publication.posePathRows,
		publication.poseLegDistancesMeters,
		publication.poseLegAnchorDistancesMeters,
		publication.poseCycleDistancesMeters,
		publication.poseCycleAnchorDistancesMeters,
		publication.posePathStationsMeters,
		publication.poseWorldXMeters,
		publication.poseWorldZMeters,
		publication.poseTangentX,
		publication.poseTangentZ,
		publication.poseYawRadians,
	];
	if (!validResidentPoseColumns(columns, count)) return null;
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		publication.poseOrderPolicy,
		publication.sourceAuthorizationFingerprint,
		publication.sourceCertificateFingerprint,
	]);
	checksum.addNumbers([count, publication.posesTruncated ? 1 : 0]);
	checksum.addViews(columns);
	return checksum.digest();
}

/** Exact profile-specific identity check shared by renderer consumers. */
export function simulationRuntimePresentationMatchesPublication(
	presentation: SimulationRuntimePresentation,
): boolean {
	if (presentation.policy === LIVE_SIMULATION_RUNTIME_VIEW_POLICY) {
		return (
			presentation.publication.resourceExecutionPrepared &&
			presentation.publication.runIdentityFingerprint === presentation.runIdentityFingerprint
		);
	}
	return (
		presentation.publication.sourceAuthorizationFingerprint ===
			presentation.authorizationFingerprint &&
		presentation.publication.sourceCertificateFingerprint === presentation.certificateFingerprint
	);
}

/** Narrow external-store boundary consumed by lazy render surfaces. */
export interface SimulationRuntimePresentationStore {
	getSnapshot(): SimulationRuntimePresentation | null;
	subscribe(listener: () => void): () => void;
}

function validPoseColumns(columns: readonly ArrayBufferView[], count: number): boolean {
	if (
		columns.length !== 13 ||
		!columns.slice(0, 5).every((column) => column instanceof Uint32Array) ||
		!columns.slice(5).every((column) => column instanceof Float64Array)
	) {
		return false;
	}
	return columns.every((column) =>
		column instanceof Uint32Array || column instanceof Float64Array
			? column.length === count
			: false,
	);
}

function validResidentPoseColumns(columns: readonly ArrayBufferView[], count: number): boolean {
	if (
		columns.length !== 17 ||
		!(columns[0] instanceof Uint32Array) ||
		!(columns[1] instanceof Int32Array) ||
		!(columns[2] instanceof Uint8Array) ||
		!(columns[3] instanceof Int8Array) ||
		!columns.slice(4, 7).every((column) => column instanceof Uint32Array) ||
		!columns.slice(7).every((column) => column instanceof Float64Array)
	) {
		return false;
	}
	return columns.every(
		(column) => (column as unknown as { readonly length: number }).length === count,
	);
}
