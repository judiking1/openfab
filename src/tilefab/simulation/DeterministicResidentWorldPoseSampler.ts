import type { PublishedSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import type {
	DeterministicResidentRuntimeState,
	DeterministicResidentVehiclePhaseName,
} from "./DeterministicResidentRuntimeState";

export const DETERMINISTIC_RESIDENT_ROUTE_BOUNDARY_POLICY =
	"NEXT_PATH_AT_INTERIOR_BOUNDARY_V1" as const;

const ROUTE_DISTANCE_EPSILON_METERS = 1e-6;

export interface DeterministicResidentWorldPose {
	readonly vehicleRow: number;
	readonly currentRequestRow: number | null;
	readonly vehiclePhase: DeterministicResidentVehiclePhaseName;
	readonly legIndex: 0 | 1 | 2 | null;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
	readonly legDistanceMeters: number;
	readonly legAnchorDistanceMeters: number;
	readonly cycleDistanceMeters: number;
	readonly cycleAnchorDistanceMeters: number;
	readonly pathRow: number;
	readonly pathStationMeters: number;
	readonly worldXMeters: number;
	readonly worldZMeters: number;
	readonly tangentX: number;
	readonly tangentZ: number;
	readonly yawRadians: number;
}

interface PathLocation {
	readonly pathRow: number;
	readonly pathStationMeters: number;
}

interface FoundationPathSample {
	readonly worldXMeters: number;
	readonly worldZMeters: number;
	readonly tangentX: number;
	readonly tangentZ: number;
}

/** Samples the exact resident runtime over the certified foundation geometry for 2D/3D consumers. */
export class DeterministicResidentWorldPoseSampler {
	readonly routeBoundaryPolicy = DETERMINISTIC_RESIDENT_ROUTE_BOUNDARY_POLICY;
	private readonly snapshot: PublishedSimulationResidentReadinessSnapshot;
	private readonly runtime: DeterministicResidentRuntimeState;
	private readonly stationRowByPortId: ReadonlyMap<number, number>;

	constructor(
		snapshot: PublishedSimulationResidentReadinessSnapshot,
		runtime: DeterministicResidentRuntimeState,
	) {
		if (
			runtime.sourceCertificateFingerprint !== snapshot.certificate.fingerprint ||
			runtime.requestCount !== snapshot.routes.requestCount ||
			runtime.vehicleCount !== snapshot.parking.slotCount
		) {
			throw new Error("Resident world-pose sources do not match the authorized runtime.");
		}
		this.snapshot = snapshot;
		this.runtime = runtime;
		this.stationRowByPortId = compileStationRows(snapshot);
	}

	sampleVehicle(vehicleRow: number): DeterministicResidentWorldPose {
		const vehicle = this.runtime.vehicleState(vehicleRow);
		if (vehicle.currentRequestRow === null) {
			return this.sampleIdleHome(vehicleRow, vehicle.phase, vehicle.homePortId);
		}
		const requestRow = vehicle.currentRequestRow;
		const motion = this.runtime.motionState(requestRow);
		if (motion.legIndex === null) {
			throw new Error(`Resident moving vehicle row ${vehicleRow} has no active route leg.`);
		}
		const endpoints = legEndpointPortIds(this.snapshot, requestRow, motion.legIndex);
		const location = locateLegAnchor(
			this.snapshot,
			this.stationRowByPortId,
			requestRow,
			motion.legIndex,
			endpoints.sourcePortId,
			endpoints.destinationPortId,
			motion.legDistanceMeters,
			motion.legAnchorDistanceMeters,
		);
		return this.pose(
			vehicleRow,
			requestRow,
			vehicle.phase,
			motion.legIndex,
			endpoints.sourcePortId,
			endpoints.destinationPortId,
			motion.legDistanceMeters,
			motion.legAnchorDistanceMeters,
			motion.cycleDistanceMeters,
			motion.cycleAnchorDistanceMeters,
			location,
		);
	}

	private sampleIdleHome(
		vehicleRow: number,
		vehiclePhase: DeterministicResidentVehiclePhaseName,
		homePortId: number,
	): DeterministicResidentWorldPose {
		const stationRow = requireStationRow(this.stationRowByPortId, homePortId);
		return this.pose(vehicleRow, null, vehiclePhase, null, homePortId, homePortId, 0, 0, 0, 0, {
			pathRow: this.snapshot.foundation.stations.finalPathIndices[stationRow] as number,
			pathStationMeters: this.snapshot.foundation.stations.finalPathStationsMeters[
				stationRow
			] as number,
		});
	}

	private pose(
		vehicleRow: number,
		currentRequestRow: number | null,
		vehiclePhase: DeterministicResidentVehiclePhaseName,
		legIndex: 0 | 1 | 2 | null,
		sourcePortId: number,
		destinationPortId: number,
		legDistanceMeters: number,
		legAnchorDistanceMeters: number,
		cycleDistanceMeters: number,
		cycleAnchorDistanceMeters: number,
		location: PathLocation,
	): DeterministicResidentWorldPose {
		const sample = sampleFoundationPath(
			this.snapshot,
			location.pathRow,
			location.pathStationMeters,
		);
		return Object.freeze({
			vehicleRow,
			currentRequestRow,
			vehiclePhase,
			legIndex,
			sourcePortId,
			destinationPortId,
			legDistanceMeters,
			legAnchorDistanceMeters,
			cycleDistanceMeters,
			cycleAnchorDistanceMeters,
			pathRow: location.pathRow,
			pathStationMeters: location.pathStationMeters,
			worldXMeters: sample.worldXMeters,
			worldZMeters: sample.worldZMeters,
			tangentX: sample.tangentX,
			tangentZ: sample.tangentZ,
			yawRadians: Math.atan2(sample.tangentZ, sample.tangentX),
		});
	}
}

function legEndpointPortIds(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
	requestRow: number,
	legIndex: 0 | 1 | 2,
): Readonly<{ sourcePortId: number; destinationPortId: number }> {
	const homePortId = snapshot.routes.homePortIds[requestRow] as number;
	const pickupPortId = snapshot.routes.pickupPortIds[requestRow] as number;
	const dropoffPortId = snapshot.routes.dropoffPortIds[requestRow] as number;
	if (legIndex === 0) return { sourcePortId: homePortId, destinationPortId: pickupPortId };
	if (legIndex === 1) return { sourcePortId: pickupPortId, destinationPortId: dropoffPortId };
	return { sourcePortId: dropoffPortId, destinationPortId: homePortId };
}

function locateLegAnchor(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
	stationRowByPortId: ReadonlyMap<number, number>,
	requestRow: number,
	legIndex: 0 | 1 | 2,
	sourcePortId: number,
	destinationPortId: number,
	legDistanceMeters: number,
	anchorDistanceMeters: number,
): PathLocation {
	if (
		!Number.isFinite(anchorDistanceMeters) ||
		anchorDistanceMeters < 0 ||
		anchorDistanceMeters > legDistanceMeters
	) {
		throw new RangeError(`Resident request row ${requestRow} anchor is outside its active leg.`);
	}
	const sourceStationRow = requireStationRow(stationRowByPortId, sourcePortId);
	const destinationStationRow = requireStationRow(stationRowByPortId, destinationPortId);
	const sourceStation = snapshot.foundation.stations.finalPathStationsMeters[
		sourceStationRow
	] as number;
	const destinationStation = snapshot.foundation.stations.finalPathStationsMeters[
		destinationStationRow
	] as number;
	const legRow = requestRow * 3 + legIndex;
	const pathStart = snapshot.routes.legPathOffsets[legRow] as number;
	const pathEnd = snapshot.routes.legPathOffsets[legRow + 1] as number;
	if (pathStart >= pathEnd) throw new Error(`Resident leg row ${legRow} contains no path rows.`);
	if (anchorDistanceMeters === 0) {
		return {
			pathRow: snapshot.routes.legPathRows[pathStart] as number,
			pathStationMeters: sourceStation,
		};
	}
	if (anchorDistanceMeters === legDistanceMeters) {
		return {
			pathRow: snapshot.routes.legPathRows[pathEnd - 1] as number,
			pathStationMeters: destinationStation,
		};
	}
	let remaining = anchorDistanceMeters;
	for (let pathOffset = pathStart; pathOffset < pathEnd; pathOffset++) {
		const pathRow = snapshot.routes.legPathRows[pathOffset] as number;
		const segmentStart = pathOffset === pathStart ? sourceStation : 0;
		const segmentEnd =
			pathOffset === pathEnd - 1
				? destinationStation
				: (snapshot.foundation.paths.lengths[pathRow] as number);
		const segmentLength = segmentEnd - segmentStart;
		if (segmentLength < 0) {
			throw new Error(`Resident request row ${requestRow} has a reversed path interval.`);
		}
		const finalSegment = pathOffset === pathEnd - 1;
		if (finalSegment || remaining < segmentLength - ROUTE_DISTANCE_EPSILON_METERS) {
			return {
				pathRow,
				pathStationMeters: Math.min(segmentEnd, segmentStart + Math.max(0, remaining)),
			};
		}
		remaining = Math.max(0, remaining - segmentLength);
	}
	throw new Error(`Resident request row ${requestRow} anchor could not be located.`);
}

function sampleFoundationPath(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
	pathRow: number,
	pathStationMeters: number,
): FoundationPathSample {
	const paths = snapshot.foundation.paths;
	if (!Number.isInteger(pathRow) || pathRow < 0 || pathRow >= paths.pathCount) {
		throw new RangeError(`Resident path row ${pathRow} is outside the certified foundation.`);
	}
	const pointStart = paths.offsets[pathRow] as number;
	const pointEnd = paths.offsets[pathRow + 1] as number;
	if (pointStart >= pointEnd) throw new Error(`Resident path row ${pathRow} has no geometry.`);
	const station = Math.max(0, Math.min(pathStationMeters, paths.lengths[pathRow] as number));
	if (pointEnd - pointStart === 1 || station <= (paths.distances[pointStart] as number)) {
		return pointSample(snapshot, pointStart);
	}
	if (station >= (paths.distances[pointEnd - 1] as number)) {
		return pointSample(snapshot, pointEnd - 1);
	}
	let low = pointStart + 1;
	let high = pointEnd - 1;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((paths.distances[middle] as number) < station) low = middle + 1;
		else high = middle;
	}
	const next = low;
	const previous = next - 1;
	const previousDistance = paths.distances[previous] as number;
	const nextDistance = paths.distances[next] as number;
	const amount =
		nextDistance === previousDistance
			? 0
			: (station - previousDistance) / (nextDistance - previousDistance);
	return normalizedSample(
		lerp(paths.positions[previous * 2] as number, paths.positions[next * 2] as number, amount),
		lerp(
			paths.positions[previous * 2 + 1] as number,
			paths.positions[next * 2 + 1] as number,
			amount,
		),
		lerp(paths.tangents[previous * 2] as number, paths.tangents[next * 2] as number, amount),
		lerp(
			paths.tangents[previous * 2 + 1] as number,
			paths.tangents[next * 2 + 1] as number,
			amount,
		),
		pathRow,
	);
}

function pointSample(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
	pointRow: number,
): FoundationPathSample {
	const paths = snapshot.foundation.paths;
	return normalizedSample(
		paths.positions[pointRow * 2] as number,
		paths.positions[pointRow * 2 + 1] as number,
		paths.tangents[pointRow * 2] as number,
		paths.tangents[pointRow * 2 + 1] as number,
		pointRow,
	);
}

function normalizedSample(
	worldXMeters: number,
	worldZMeters: number,
	rawTangentX: number,
	rawTangentZ: number,
	geometryRow: number,
): FoundationPathSample {
	const length = Math.hypot(rawTangentX, rawTangentZ);
	if (!Number.isFinite(length) || length <= 0) {
		throw new Error(`Resident geometry row ${geometryRow} has an invalid tangent.`);
	}
	return {
		worldXMeters,
		worldZMeters,
		tangentX: rawTangentX / length,
		tangentZ: rawTangentZ / length,
	};
}

function compileStationRows(
	snapshot: PublishedSimulationResidentReadinessSnapshot,
): ReadonlyMap<number, number> {
	const rows = new Map<number, number>();
	for (let stationRow = 0; stationRow < snapshot.foundation.stations.count; stationRow++) {
		rows.set(snapshot.foundation.stations.ids[stationRow] as number, stationRow);
	}
	return rows;
}

function requireStationRow(rows: ReadonlyMap<number, number>, portId: number): number {
	const stationRow = rows.get(portId);
	if (stationRow === undefined) throw new Error(`Resident port ${portId} has no station row.`);
	return stationRow;
}

function lerp(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}
