import {
	type PublishedSimulationReadinessSnapshot,
	publishedSimulationReadinessSnapshotError,
} from "../compile/SimulationReadinessCertificate";
import {
	type SimulationScenarioRouteRequests,
	simulationScenarioRouteRequestsError,
} from "../compile/SimulationScenarioRouteRequests";

export const DETERMINISTIC_SCENARIO_ROUTE_BOUNDARY_POLICY =
	"NEXT_PATH_AT_INTERIOR_BOUNDARY_V1" as const;

const ROUTE_DISTANCE_EPSILON_METERS = 1e-6;

export interface DeterministicScenarioWorldPose {
	readonly requestRow: number;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
	readonly routeDistanceMeters: number;
	readonly anchorDistanceMeters: number;
	readonly pathRow: number;
	readonly pathStationMeters: number;
	readonly worldXMeters: number;
	readonly worldZMeters: number;
	readonly tangentX: number;
	readonly tangentZ: number;
	readonly yawRadians: number;
}

/**
 * Samples immutable certified rail geometry from a route-relative anchor distance.
 * The result is FAB world space, never screen space, and is safe for both 2D and 3D consumers.
 */
export class DeterministicScenarioWorldPoseSampler {
	readonly routeBoundaryPolicy = DETERMINISTIC_SCENARIO_ROUTE_BOUNDARY_POLICY;
	private readonly snapshot: PublishedSimulationReadinessSnapshot;
	private readonly routes: SimulationScenarioRouteRequests;

	constructor(
		snapshot: PublishedSimulationReadinessSnapshot,
		routes: SimulationScenarioRouteRequests,
	) {
		const snapshotError = publishedSimulationReadinessSnapshotError(snapshot);
		if (snapshotError) throw new Error(`Published readiness snapshot is invalid: ${snapshotError}`);
		const routesError = simulationScenarioRouteRequestsError(routes);
		if (routesError) throw new Error(`Scenario route requests are invalid: ${routesError}`);
		if (
			routes.sourceCertificateFingerprint !== snapshot.certificate.fingerprint ||
			routes.sourceReadinessProfileId !== snapshot.certificate.readinessProfileId
		) {
			throw new Error("Scenario route requests do not match the world-pose snapshot.");
		}
		validateRouteCorridors(snapshot, routes);
		this.snapshot = snapshot;
		this.routes = routes;
	}

	sample(requestRow: number, anchorDistanceMeters: number): DeterministicScenarioWorldPose {
		assertRequestRow(requestRow, this.routes.requestCount);
		const routeDistanceMeters = this.routes.routeDistancesMeters[requestRow] as number;
		if (
			!Number.isFinite(anchorDistanceMeters) ||
			anchorDistanceMeters < 0 ||
			anchorDistanceMeters > routeDistanceMeters
		) {
			throw new RangeError(
				`Scenario request row ${requestRow} anchor distance must remain within its route.`,
			);
		}

		const sourceStationRow = this.routes.sourceStationRows[requestRow] as number;
		const destinationStationRow = this.routes.destinationStationRows[requestRow] as number;
		const sourceStation = this.snapshot.foundation.stations.finalPathStationsMeters[
			sourceStationRow
		] as number;
		const destinationStation = this.snapshot.foundation.stations.finalPathStationsMeters[
			destinationStationRow
		] as number;
		const pathStart = this.routes.routePathOffsets[requestRow] as number;
		const pathEnd = this.routes.routePathOffsets[requestRow + 1] as number;

		let pathRow: number;
		let pathStationMeters: number;
		if (anchorDistanceMeters === 0) {
			pathRow = this.routes.routePathRows[pathStart] as number;
			pathStationMeters = sourceStation;
		} else if (anchorDistanceMeters === routeDistanceMeters) {
			pathRow = this.routes.routePathRows[pathEnd - 1] as number;
			pathStationMeters = destinationStation;
		} else {
			const location = locateRouteAnchor(
				this.snapshot,
				this.routes,
				requestRow,
				anchorDistanceMeters,
			);
			pathRow = location.pathRow;
			pathStationMeters = location.pathStationMeters;
		}

		const sample = sampleFoundationPath(this.snapshot, pathRow, pathStationMeters);
		return Object.freeze({
			requestRow,
			sourcePortId: this.routes.sourcePortIds[requestRow] as number,
			destinationPortId: this.routes.destinationPortIds[requestRow] as number,
			routeDistanceMeters,
			anchorDistanceMeters,
			pathRow,
			pathStationMeters,
			worldXMeters: sample.worldXMeters,
			worldZMeters: sample.worldZMeters,
			tangentX: sample.tangentX,
			tangentZ: sample.tangentZ,
			yawRadians: Math.atan2(sample.tangentZ, sample.tangentX),
		});
	}
}

interface RouteLocation {
	readonly pathRow: number;
	readonly pathStationMeters: number;
}

interface FoundationPathSample {
	readonly worldXMeters: number;
	readonly worldZMeters: number;
	readonly tangentX: number;
	readonly tangentZ: number;
}

function validateRouteCorridors(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
): void {
	const stations = snapshot.foundation.stations;
	const paths = snapshot.foundation.paths;
	for (let requestRow = 0; requestRow < routes.requestCount; requestRow++) {
		const sourceStationRow = routes.sourceStationRows[requestRow] as number;
		const destinationStationRow = routes.destinationStationRows[requestRow] as number;
		if (
			sourceStationRow >= stations.count ||
			destinationStationRow >= stations.count ||
			stations.ids[sourceStationRow] !== routes.sourcePortIds[requestRow] ||
			stations.ids[destinationStationRow] !== routes.destinationPortIds[requestRow]
		) {
			throw new Error(`Scenario request row ${requestRow} station binding is invalid.`);
		}
		const pathStart = routes.routePathOffsets[requestRow] as number;
		const pathEnd = routes.routePathOffsets[requestRow + 1] as number;
		if (
			routes.routePathRows[pathStart] !== stations.finalPathIndices[sourceStationRow] ||
			routes.routePathRows[pathEnd - 1] !== stations.finalPathIndices[destinationStationRow]
		) {
			throw new Error(`Scenario request row ${requestRow} endpoint path binding is invalid.`);
		}
		for (let routeRow = pathStart; routeRow < pathEnd; routeRow++) {
			const pathRow = routes.routePathRows[routeRow] as number;
			if (pathRow >= paths.pathCount) {
				throw new Error(`Scenario request row ${requestRow} contains an invalid path row.`);
			}
			if (
				routeRow + 1 < pathEnd &&
				!hasDirectedAdjacency(snapshot, pathRow, routes.routePathRows[routeRow + 1] as number)
			) {
				throw new Error(`Scenario request row ${requestRow} path corridor is disconnected.`);
			}
		}
		const corridorDistance = routeCorridorDistance(snapshot, routes, requestRow);
		const declaredDistance = routes.routeDistancesMeters[requestRow] as number;
		const tolerance = ROUTE_DISTANCE_EPSILON_METERS * Math.max(1, declaredDistance);
		if (Math.abs(corridorDistance - declaredDistance) > tolerance) {
			throw new Error(`Scenario request row ${requestRow} route distance is inconsistent.`);
		}
	}
}

function routeCorridorDistance(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
	requestRow: number,
): number {
	const sourceStationRow = routes.sourceStationRows[requestRow] as number;
	const destinationStationRow = routes.destinationStationRows[requestRow] as number;
	const sourceStation = snapshot.foundation.stations.finalPathStationsMeters[
		sourceStationRow
	] as number;
	const destinationStation = snapshot.foundation.stations.finalPathStationsMeters[
		destinationStationRow
	] as number;
	const pathStart = routes.routePathOffsets[requestRow] as number;
	const pathEnd = routes.routePathOffsets[requestRow + 1] as number;
	let distance = 0;
	for (let routeRow = pathStart; routeRow < pathEnd; routeRow++) {
		const pathRow = routes.routePathRows[routeRow] as number;
		const segmentStart = routeRow === pathStart ? sourceStation : 0;
		const segmentEnd =
			routeRow === pathEnd - 1
				? destinationStation
				: (snapshot.foundation.paths.lengths[pathRow] as number);
		if (segmentEnd < segmentStart) {
			throw new Error(`Scenario request row ${requestRow} has a reversed path interval.`);
		}
		distance += segmentEnd - segmentStart;
	}
	return distance;
}

function locateRouteAnchor(
	snapshot: PublishedSimulationReadinessSnapshot,
	routes: SimulationScenarioRouteRequests,
	requestRow: number,
	anchorDistanceMeters: number,
): RouteLocation {
	const sourceStationRow = routes.sourceStationRows[requestRow] as number;
	const destinationStationRow = routes.destinationStationRows[requestRow] as number;
	const sourceStation = snapshot.foundation.stations.finalPathStationsMeters[
		sourceStationRow
	] as number;
	const destinationStation = snapshot.foundation.stations.finalPathStationsMeters[
		destinationStationRow
	] as number;
	const pathStart = routes.routePathOffsets[requestRow] as number;
	const pathEnd = routes.routePathOffsets[requestRow + 1] as number;
	let remaining = anchorDistanceMeters;
	for (let routeRow = pathStart; routeRow < pathEnd; routeRow++) {
		const pathRow = routes.routePathRows[routeRow] as number;
		const segmentStart = routeRow === pathStart ? sourceStation : 0;
		const segmentEnd =
			routeRow === pathEnd - 1
				? destinationStation
				: (snapshot.foundation.paths.lengths[pathRow] as number);
		const segmentLength = segmentEnd - segmentStart;
		const finalSegment = routeRow === pathEnd - 1;
		if (finalSegment || remaining < segmentLength - ROUTE_DISTANCE_EPSILON_METERS) {
			return Object.freeze({
				pathRow,
				pathStationMeters: Math.min(segmentEnd, segmentStart + Math.max(0, remaining)),
			});
		}
		remaining = Math.max(0, remaining - segmentLength);
	}
	throw new Error(`Scenario request row ${requestRow} anchor could not be located.`);
}

function sampleFoundationPath(
	snapshot: PublishedSimulationReadinessSnapshot,
	pathRow: number,
	pathStationMeters: number,
): FoundationPathSample {
	const paths = snapshot.foundation.paths;
	const pointStart = paths.offsets[pathRow] as number;
	const pointEnd = paths.offsets[pathRow + 1] as number;
	if (pointStart >= pointEnd) throw new Error(`Scenario path row ${pathRow} has no geometry.`);
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
	const worldXMeters = lerp(
		paths.positions[previous * 2] as number,
		paths.positions[next * 2] as number,
		amount,
	);
	const worldZMeters = lerp(
		paths.positions[previous * 2 + 1] as number,
		paths.positions[next * 2 + 1] as number,
		amount,
	);
	const rawTangentX = lerp(
		paths.tangents[previous * 2] as number,
		paths.tangents[next * 2] as number,
		amount,
	);
	const rawTangentZ = lerp(
		paths.tangents[previous * 2 + 1] as number,
		paths.tangents[next * 2 + 1] as number,
		amount,
	);
	return normalizedSample(worldXMeters, worldZMeters, rawTangentX, rawTangentZ, pathRow);
}

function pointSample(
	snapshot: PublishedSimulationReadinessSnapshot,
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
	const magnitude = Math.hypot(rawTangentX, rawTangentZ);
	if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
		throw new Error(`Scenario geometry row ${geometryRow} has no usable travel tangent.`);
	}
	return Object.freeze({
		worldXMeters,
		worldZMeters,
		tangentX: rawTangentX / magnitude,
		tangentZ: rawTangentZ / magnitude,
	});
}

function hasDirectedAdjacency(
	snapshot: PublishedSimulationReadinessSnapshot,
	fromPathRow: number,
	toPathRow: number,
): boolean {
	const paths = snapshot.foundation.paths;
	const start = paths.adjacencyOffsets[fromPathRow] as number;
	const end = paths.adjacencyOffsets[fromPathRow + 1] as number;
	for (let row = start; row < end; row++) {
		if (paths.adjacencyTargets[row] === toPathRow) return true;
	}
	return false;
}

function assertRequestRow(requestRow: number, requestCount: number): void {
	if (!Number.isSafeInteger(requestRow) || requestRow < 0 || requestRow >= requestCount) {
		throw new RangeError(`Scenario request row ${requestRow} is outside the prepared scenario.`);
	}
}

function lerp(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}
