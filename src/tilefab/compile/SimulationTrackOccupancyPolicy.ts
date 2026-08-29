import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import {
	type SimulationTrackResourceTopology,
	simulationTrackResourceTopologyError,
} from "./SimulationTrackResourceTopology";

export const SIMULATION_TRACK_OCCUPANCY_POLICY_SCHEMA_VERSION = 1;

export const SIMULATION_TRACK_LEASE_SCOPE = "WHOLE_TRANSFER_ROUTE_WITH_CLEARANCE_V1" as const;
export const SIMULATION_TRACK_ACQUISITION_POLICY = "ATOMIC_ALL_OR_NONE_BEFORE_LAUNCH" as const;
export const SIMULATION_TRACK_FAIRNESS_POLICY = "OLDEST_CONFLICTING_TICKET_FIRST" as const;
export const SIMULATION_TRACK_DEADLOCK_POLICY = "WAITERS_HOLD_NO_ROUTE_RESOURCES" as const;
export const SIMULATION_TRACK_RELEASE_POLICY =
	"RELEASE_AFTER_REAR_EXTENSION_CLEARS_RESOURCE" as const;
export const SIMULATION_TRACK_SWITCH_POLICY = "INCLUDE_EXACT_MOVEMENT_CONFLICT_RESOURCE" as const;
export const SIMULATION_TRACK_ROUTE_MUTATION_POLICY = "IMMUTABLE_WHILE_LEASED" as const;

export interface SimulationVehicleReservationProfile {
	readonly id: string;
	readonly version: number;
	readonly bodyLengthMillimeters: number;
	readonly referenceToFrontMillimeters: number;
	readonly referenceToRearMillimeters: number;
	readonly bodyWidthMillimeters: number;
	readonly lateralSafetyMarginMillimeters: number;
	readonly frontSafetyMarginMillimeters: number;
	readonly rearSafetyMarginMillimeters: number;
	readonly maximumSpeedMillimetersPerSecond: number;
	readonly controlReactionMilliseconds: number;
	readonly minimumServiceDecelerationMillimetersPerSecondSquared: number;
}

export interface SimulationTrackOccupancyPolicy {
	readonly schemaVersion: typeof SIMULATION_TRACK_OCCUPANCY_POLICY_SCHEMA_VERSION;
	/** A certified policy is still not a complete simulation-readiness certificate. */
	readonly simulationReady: false;
	readonly sourceFoundationFingerprint: string;
	readonly sourceTrackResourceTopologyFingerprint: string;
	readonly clearanceProfileId: string;
	readonly clearanceProfileVersion: number;
	readonly vehicleProfileId: string;
	readonly vehicleProfileVersion: number;
	readonly bodyLengthMillimeters: number;
	readonly referenceToFrontMillimeters: number;
	readonly referenceToRearMillimeters: number;
	readonly bodyWidthMillimeters: number;
	readonly lateralSafetyMarginMillimeters: number;
	readonly frontSafetyMarginMillimeters: number;
	readonly rearSafetyMarginMillimeters: number;
	readonly maximumSpeedMillimetersPerSecond: number;
	readonly controlReactionMilliseconds: number;
	readonly minimumServiceDecelerationMillimetersPerSecondSquared: number;
	readonly reactionDistanceMillimeters: number;
	readonly brakingDistanceMillimeters: number;
	/** Route compilation extends past the anchor destination by this distance. */
	readonly frontLeaseExtensionMillimeters: number;
	/** A resource remains held until this distance behind the anchor has cleared it. */
	readonly rearLeaseExtensionMillimeters: number;
	/** Includes half body width, explicit lateral margin, and envelope approximation tolerance. */
	readonly lateralReservationRadiusMillimeters: number;
	readonly maximumClearanceApproximationToleranceMillimeters: number;
	readonly minimumCertifiedOhtSweepRadiusMillimeters: number;
	readonly trackResourceCount: number;
	readonly trackResourceLengthsMeters: Float32Array;
	/** Minimum across every path occurrence of the physical resource. */
	readonly trackResourceMinimumOhtSweepRadiusMillimeters: Uint16Array;
	readonly switchConflictResourceCount: number;
	readonly switchConflictResourceIds: Uint32Array;
	readonly leaseScope: typeof SIMULATION_TRACK_LEASE_SCOPE;
	readonly acquisitionPolicy: typeof SIMULATION_TRACK_ACQUISITION_POLICY;
	readonly fairnessPolicy: typeof SIMULATION_TRACK_FAIRNESS_POLICY;
	readonly deadlockPolicy: typeof SIMULATION_TRACK_DEADLOCK_POLICY;
	readonly releasePolicy: typeof SIMULATION_TRACK_RELEASE_POLICY;
	readonly switchPolicy: typeof SIMULATION_TRACK_SWITCH_POLICY;
	readonly routeMutationPolicy: typeof SIMULATION_TRACK_ROUTE_MUTATION_POLICY;
	readonly partialAcquisitionAllowed: false;
	readonly waitingRequestMayHoldRouteResources: false;
	readonly fingerprint: string;
	readonly byteLength: number;
}

const STATION_EPSILON_METERS = 1e-4;

/**
 * Certifies one explicit vehicle profile against every track-resource occurrence and publishes a
 * conservative deadlock-free whole-route lease contract. It does not allocate or move vehicles.
 */
export function compileSimulationTrackOccupancyPolicy(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
	vehicleProfile: SimulationVehicleReservationProfile,
): SimulationTrackOccupancyPolicy {
	assertCompatibleSources(foundation, topology);
	const normalizedProfile = normalizeVehicleProfile(vehicleProfile);
	const maximumClearanceApproximationToleranceMillimeters = maximumValue(
		foundation.motionEnvelopes.approximationToleranceMillimeters,
	);
	const derived = deriveVehicleReservationDistances(
		normalizedProfile,
		maximumClearanceApproximationToleranceMillimeters,
	);
	const resourceClearance = compileTrackResourceClearance(foundation, topology);
	if (
		resourceClearance.minimumCertifiedOhtSweepRadiusMillimeters > 0 &&
		derived.lateralReservationRadiusMillimeters >
			resourceClearance.minimumCertifiedOhtSweepRadiusMillimeters
	) {
		throw new Error(
			`Vehicle lateral reservation radius ${derived.lateralReservationRadiusMillimeters} mm exceeds the certified OHT sweep radius ${resourceClearance.minimumCertifiedOhtSweepRadiusMillimeters} mm.`,
		);
	}

	const policyWithoutIdentity = {
		schemaVersion: SIMULATION_TRACK_OCCUPANCY_POLICY_SCHEMA_VERSION,
		simulationReady: false,
		sourceFoundationFingerprint: foundation.fingerprint,
		sourceTrackResourceTopologyFingerprint: topology.fingerprint,
		clearanceProfileId: foundation.motionEnvelopes.profileId,
		clearanceProfileVersion: foundation.motionEnvelopes.profileVersion,
		vehicleProfileId: normalizedProfile.id,
		vehicleProfileVersion: normalizedProfile.version,
		bodyLengthMillimeters: normalizedProfile.bodyLengthMillimeters,
		referenceToFrontMillimeters: normalizedProfile.referenceToFrontMillimeters,
		referenceToRearMillimeters: normalizedProfile.referenceToRearMillimeters,
		bodyWidthMillimeters: normalizedProfile.bodyWidthMillimeters,
		lateralSafetyMarginMillimeters: normalizedProfile.lateralSafetyMarginMillimeters,
		frontSafetyMarginMillimeters: normalizedProfile.frontSafetyMarginMillimeters,
		rearSafetyMarginMillimeters: normalizedProfile.rearSafetyMarginMillimeters,
		maximumSpeedMillimetersPerSecond: normalizedProfile.maximumSpeedMillimetersPerSecond,
		controlReactionMilliseconds: normalizedProfile.controlReactionMilliseconds,
		minimumServiceDecelerationMillimetersPerSecondSquared:
			normalizedProfile.minimumServiceDecelerationMillimetersPerSecondSquared,
		...derived,
		maximumClearanceApproximationToleranceMillimeters,
		...resourceClearance,
		switchConflictResourceCount: topology.switchConflictResourceCount,
		switchConflictResourceIds: topology.switchConflictResourceIds.slice(),
		leaseScope: SIMULATION_TRACK_LEASE_SCOPE,
		acquisitionPolicy: SIMULATION_TRACK_ACQUISITION_POLICY,
		fairnessPolicy: SIMULATION_TRACK_FAIRNESS_POLICY,
		deadlockPolicy: SIMULATION_TRACK_DEADLOCK_POLICY,
		releasePolicy: SIMULATION_TRACK_RELEASE_POLICY,
		switchPolicy: SIMULATION_TRACK_SWITCH_POLICY,
		routeMutationPolicy: SIMULATION_TRACK_ROUTE_MUTATION_POLICY,
		partialAcquisitionAllowed: false,
		waitingRequestMayHoldRouteResources: false,
	} as const;
	const views = simulationTrackOccupancyPolicyViews(policyWithoutIdentity);
	const policy = Object.freeze({
		...policyWithoutIdentity,
		fingerprint: checksumSimulationTrackOccupancyPolicy(policyWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationTrackOccupancyPolicy;
	const error = simulationTrackOccupancyPolicyError(policy);
	if (error) throw new Error(`Compiled simulation track occupancy policy is invalid: ${error}`);
	return policy;
}

export function checksumSimulationTrackOccupancyPolicy(
	policy: Omit<SimulationTrackOccupancyPolicy, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		policy.schemaVersion,
		policy.simulationReady ? 1 : 0,
		policy.clearanceProfileVersion,
		policy.vehicleProfileVersion,
		policy.bodyLengthMillimeters,
		policy.referenceToFrontMillimeters,
		policy.referenceToRearMillimeters,
		policy.bodyWidthMillimeters,
		policy.lateralSafetyMarginMillimeters,
		policy.frontSafetyMarginMillimeters,
		policy.rearSafetyMarginMillimeters,
		policy.maximumSpeedMillimetersPerSecond,
		policy.controlReactionMilliseconds,
		policy.minimumServiceDecelerationMillimetersPerSecondSquared,
		policy.reactionDistanceMillimeters,
		policy.brakingDistanceMillimeters,
		policy.frontLeaseExtensionMillimeters,
		policy.rearLeaseExtensionMillimeters,
		policy.lateralReservationRadiusMillimeters,
		policy.maximumClearanceApproximationToleranceMillimeters,
		policy.minimumCertifiedOhtSweepRadiusMillimeters,
		policy.trackResourceCount,
		policy.switchConflictResourceCount,
		policy.partialAcquisitionAllowed ? 1 : 0,
		policy.waitingRequestMayHoldRouteResources ? 1 : 0,
	]);
	checksum.addStrings([
		policy.sourceFoundationFingerprint,
		policy.sourceTrackResourceTopologyFingerprint,
		policy.clearanceProfileId,
		policy.vehicleProfileId,
		policy.leaseScope,
		policy.acquisitionPolicy,
		policy.fairnessPolicy,
		policy.deadlockPolicy,
		policy.releasePolicy,
		policy.switchPolicy,
		policy.routeMutationPolicy,
	]);
	checksum.addViews(simulationTrackOccupancyPolicyViews(policy));
	return checksum.digest();
}

export function simulationTrackOccupancyPolicyError(value: unknown): string | null {
	if (!isRecord(value)) return "track occupancy policy must be an object";
	if (value.schemaVersion !== SIMULATION_TRACK_OCCUPANCY_POLICY_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationReady !== false) return "occupancy policy cannot authorize simulation";
	if (
		!isNonEmptyString(value.sourceFoundationFingerprint) ||
		!isNonEmptyString(value.sourceTrackResourceTopologyFingerprint) ||
		!isPortableId(value.clearanceProfileId) ||
		!isPortableId(value.vehicleProfileId)
	) {
		return "policy source or profile identity is invalid";
	}
	if (
		!isPositiveUint32(value.clearanceProfileVersion) ||
		!isPositiveUint32(value.vehicleProfileVersion) ||
		!isPositiveUint32(value.bodyLengthMillimeters) ||
		!isUint32(value.referenceToFrontMillimeters) ||
		!isUint32(value.referenceToRearMillimeters) ||
		(value.referenceToFrontMillimeters as number) + (value.referenceToRearMillimeters as number) !==
			(value.bodyLengthMillimeters as number) ||
		!isPositiveUint32(value.bodyWidthMillimeters) ||
		!isUint32(value.lateralSafetyMarginMillimeters) ||
		!isUint32(value.frontSafetyMarginMillimeters) ||
		!isUint32(value.rearSafetyMarginMillimeters) ||
		!isPositiveUint32(value.maximumSpeedMillimetersPerSecond) ||
		!isUint32(value.controlReactionMilliseconds) ||
		!isPositiveUint32(value.minimumServiceDecelerationMillimetersPerSecondSquared)
	) {
		return "vehicle reservation profile values are invalid";
	}
	if (!isUint16(value.maximumClearanceApproximationToleranceMillimeters)) {
		return "clearance approximation tolerance is invalid";
	}
	let expectedDerived: ReturnType<typeof deriveVehicleReservationDistances>;
	try {
		expectedDerived = deriveVehicleReservationDistances(
			{
				id: value.vehicleProfileId,
				version: value.vehicleProfileVersion,
				bodyLengthMillimeters: value.bodyLengthMillimeters,
				referenceToFrontMillimeters: value.referenceToFrontMillimeters,
				referenceToRearMillimeters: value.referenceToRearMillimeters,
				bodyWidthMillimeters: value.bodyWidthMillimeters,
				lateralSafetyMarginMillimeters: value.lateralSafetyMarginMillimeters,
				frontSafetyMarginMillimeters: value.frontSafetyMarginMillimeters,
				rearSafetyMarginMillimeters: value.rearSafetyMarginMillimeters,
				maximumSpeedMillimetersPerSecond: value.maximumSpeedMillimetersPerSecond,
				controlReactionMilliseconds: value.controlReactionMilliseconds,
				minimumServiceDecelerationMillimetersPerSecondSquared:
					value.minimumServiceDecelerationMillimetersPerSecondSquared,
			},
			value.maximumClearanceApproximationToleranceMillimeters,
		);
	} catch {
		return "derived vehicle reservation distances are outside the policy range";
	}
	if (
		value.reactionDistanceMillimeters !== expectedDerived.reactionDistanceMillimeters ||
		value.brakingDistanceMillimeters !== expectedDerived.brakingDistanceMillimeters ||
		value.frontLeaseExtensionMillimeters !== expectedDerived.frontLeaseExtensionMillimeters ||
		value.rearLeaseExtensionMillimeters !== expectedDerived.rearLeaseExtensionMillimeters ||
		value.lateralReservationRadiusMillimeters !==
			expectedDerived.lateralReservationRadiusMillimeters
	) {
		return "derived vehicle reservation distances are inconsistent";
	}
	if (
		!isNonNegativeSafeInteger(value.trackResourceCount) ||
		!isNonNegativeSafeInteger(value.switchConflictResourceCount) ||
		!isFloat32Array(value.trackResourceLengthsMeters, value.trackResourceCount) ||
		!isUint16Array(value.trackResourceMinimumOhtSweepRadiusMillimeters, value.trackResourceCount) ||
		!isUint32Array(value.switchConflictResourceIds, value.switchConflictResourceCount)
	) {
		return "occupancy resource columns are malformed";
	}
	if (
		value.leaseScope !== SIMULATION_TRACK_LEASE_SCOPE ||
		value.acquisitionPolicy !== SIMULATION_TRACK_ACQUISITION_POLICY ||
		value.fairnessPolicy !== SIMULATION_TRACK_FAIRNESS_POLICY ||
		value.deadlockPolicy !== SIMULATION_TRACK_DEADLOCK_POLICY ||
		value.releasePolicy !== SIMULATION_TRACK_RELEASE_POLICY ||
		value.switchPolicy !== SIMULATION_TRACK_SWITCH_POLICY ||
		value.routeMutationPolicy !== SIMULATION_TRACK_ROUTE_MUTATION_POLICY ||
		value.partialAcquisitionAllowed !== false ||
		value.waitingRequestMayHoldRouteResources !== false
	) {
		return "atomic lease protocol is invalid";
	}
	const policy = value as unknown as SimulationTrackOccupancyPolicy;
	if (!validResourceClearance(policy)) return "track-resource clearance certification is invalid";
	if (!validUniquePositiveIds(policy.switchConflictResourceIds)) {
		return "switch-conflict resource IDs must be positive and unique";
	}
	const views = simulationTrackOccupancyPolicyViews(policy);
	if (!hasDistinctOwnedBuffers(views)) return "typed arrays must own distinct buffers";
	if (!isNonNegativeSafeInteger(value.byteLength) || value.byteLength !== sumByteLengths(views)) {
		return "transfer byte length is invalid";
	}
	if (!isNonEmptyString(value.fingerprint)) return "fingerprint is invalid";
	try {
		if (checksumSimulationTrackOccupancyPolicy(policy) !== value.fingerprint) {
			return "fingerprint does not match track occupancy policy";
		}
	} catch {
		return "track occupancy policy fingerprint cannot be recomputed";
	}
	return null;
}

export function isSimulationTrackOccupancyPolicy(
	value: unknown,
): value is SimulationTrackOccupancyPolicy {
	return simulationTrackOccupancyPolicyError(value) === null;
}

function assertCompatibleSources(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
): void {
	const foundationError = simulationStaticWorldFoundationError(foundation);
	if (foundationError)
		throw new Error(`Simulation static-world foundation is invalid: ${foundationError}`);
	const topologyError = simulationTrackResourceTopologyError(topology);
	if (topologyError)
		throw new Error(`Simulation track-resource topology is invalid: ${topologyError}`);
	if (topology.sourceFoundationFingerprint !== foundation.fingerprint) {
		throw new Error(
			"Track-resource topology does not belong to the supplied static-world foundation.",
		);
	}
	if (
		topology.pathCount !== foundation.paths.pathCount ||
		!sameNumbers(topology.pathLengths, foundation.paths.lengths)
	) {
		throw new Error(
			"Track-resource topology does not preserve the supplied physical path identity.",
		);
	}
}

function normalizeVehicleProfile(
	profile: SimulationVehicleReservationProfile,
): SimulationVehicleReservationProfile {
	if (!isRecord(profile) || !isPortableId(profile.id)) {
		throw new Error("Vehicle reservation profile identity is invalid.");
	}
	if (!isPositiveUint32(profile.version)) {
		throw new Error("Vehicle reservation profile version is invalid.");
	}
	for (const [label, value, positive] of [
		["body length", profile.bodyLengthMillimeters, true],
		["reference-to-front", profile.referenceToFrontMillimeters, false],
		["reference-to-rear", profile.referenceToRearMillimeters, false],
		["body width", profile.bodyWidthMillimeters, true],
		["lateral safety margin", profile.lateralSafetyMarginMillimeters, false],
		["front safety margin", profile.frontSafetyMarginMillimeters, false],
		["rear safety margin", profile.rearSafetyMarginMillimeters, false],
		["maximum speed", profile.maximumSpeedMillimetersPerSecond, true],
		["control reaction", profile.controlReactionMilliseconds, false],
		[
			"minimum service deceleration",
			profile.minimumServiceDecelerationMillimetersPerSecondSquared,
			true,
		],
	] as const) {
		if (positive ? !isPositiveUint32(value) : !isUint32(value)) {
			throw new Error(`Vehicle reservation profile ${label} is invalid.`);
		}
	}
	if (
		profile.referenceToFrontMillimeters + profile.referenceToRearMillimeters !==
		profile.bodyLengthMillimeters
	) {
		throw new Error("Vehicle front and rear reference offsets must sum to body length.");
	}
	const normalized = Object.freeze({ ...profile });
	deriveVehicleReservationDistances(normalized, 0);
	return normalized;
}

function deriveVehicleReservationDistances(
	profile: SimulationVehicleReservationProfile,
	clearanceApproximationToleranceMillimeters: number,
): {
	readonly reactionDistanceMillimeters: number;
	readonly brakingDistanceMillimeters: number;
	readonly frontLeaseExtensionMillimeters: number;
	readonly rearLeaseExtensionMillimeters: number;
	readonly lateralReservationRadiusMillimeters: number;
} {
	const reactionDistanceMillimeters = Math.ceil(
		(profile.maximumSpeedMillimetersPerSecond * profile.controlReactionMilliseconds) / 1_000,
	);
	const brakingDistanceMillimeters = Math.ceil(
		(profile.maximumSpeedMillimetersPerSecond * profile.maximumSpeedMillimetersPerSecond) /
			(2 * profile.minimumServiceDecelerationMillimetersPerSecondSquared),
	);
	const frontLeaseExtensionMillimeters =
		profile.referenceToFrontMillimeters +
		profile.frontSafetyMarginMillimeters +
		reactionDistanceMillimeters +
		brakingDistanceMillimeters;
	const rearLeaseExtensionMillimeters =
		profile.referenceToRearMillimeters + profile.rearSafetyMarginMillimeters;
	const lateralReservationRadiusMillimeters =
		Math.ceil(profile.bodyWidthMillimeters / 2) +
		profile.lateralSafetyMarginMillimeters +
		clearanceApproximationToleranceMillimeters;
	for (const [label, value] of [
		["reaction distance", reactionDistanceMillimeters],
		["braking distance", brakingDistanceMillimeters],
		["front lease extension", frontLeaseExtensionMillimeters],
		["rear lease extension", rearLeaseExtensionMillimeters],
		["lateral reservation radius", lateralReservationRadiusMillimeters],
	] as const) {
		if (!isUint32(value)) throw new Error(`Vehicle ${label} exceeds the uint32 policy range.`);
	}
	return {
		reactionDistanceMillimeters,
		brakingDistanceMillimeters,
		frontLeaseExtensionMillimeters,
		rearLeaseExtensionMillimeters,
		lateralReservationRadiusMillimeters,
	};
}

function compileTrackResourceClearance(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
): Pick<
	SimulationTrackOccupancyPolicy,
	| "minimumCertifiedOhtSweepRadiusMillimeters"
	| "trackResourceCount"
	| "trackResourceLengthsMeters"
	| "trackResourceMinimumOhtSweepRadiusMillimeters"
> {
	const minimumSweepRadii = new Uint16Array(topology.trackResourceCount);
	minimumSweepRadii.fill(0xffff);
	const occurrenceCounts = new Uint32Array(topology.trackResourceCount);
	for (let pathRow = 0; pathRow < topology.pathCount; pathRow++) {
		const start = topology.pathResourceOffsets[pathRow] as number;
		const end = topology.pathResourceOffsets[pathRow + 1] as number;
		for (let occurrenceRow = start; occurrenceRow < end; occurrenceRow++) {
			const resourceRow = topology.pathResourceRows[occurrenceRow] as number;
			const sweepRadius = minimumSweepRadiusForPathInterval(
				foundation,
				pathRow,
				topology.pathResourceStarts[occurrenceRow] as number,
				topology.pathResourceEnds[occurrenceRow] as number,
			);
			minimumSweepRadii[resourceRow] = Math.min(
				minimumSweepRadii[resourceRow] as number,
				sweepRadius,
			);
			occurrenceCounts[resourceRow] = (occurrenceCounts[resourceRow] as number) + 1;
		}
	}
	let minimumCertifiedOhtSweepRadiusMillimeters = 0xffff;
	for (let resourceRow = 0; resourceRow < topology.trackResourceCount; resourceRow++) {
		if (occurrenceCounts[resourceRow] === 0) {
			throw new Error(`Track resource ${resourceRow} has no clearance-certified occurrence.`);
		}
		minimumCertifiedOhtSweepRadiusMillimeters = Math.min(
			minimumCertifiedOhtSweepRadiusMillimeters,
			minimumSweepRadii[resourceRow] as number,
		);
	}
	if (topology.trackResourceCount === 0) minimumCertifiedOhtSweepRadiusMillimeters = 0;
	const trackResourceLengthsMeters = new Float32Array(topology.trackResourceCount);
	for (let row = 0; row < topology.trackResourceCount; row++) {
		trackResourceLengthsMeters[row] =
			(topology.trackResourceEnds[row] as number) - (topology.trackResourceStarts[row] as number);
	}
	return {
		minimumCertifiedOhtSweepRadiusMillimeters,
		trackResourceCount: topology.trackResourceCount,
		trackResourceLengthsMeters,
		trackResourceMinimumOhtSweepRadiusMillimeters: minimumSweepRadii,
	};
}

function minimumSweepRadiusForPathInterval(
	foundation: SimulationStaticWorldFoundation,
	pathRow: number,
	intervalStart: number,
	intervalEnd: number,
): number {
	const envelopes = foundation.motionEnvelopes;
	const start = envelopes.pathOffsets[pathRow] as number;
	const end = envelopes.pathOffsets[pathRow + 1] as number;
	let cursor = intervalStart;
	let minimum = 0xffff;
	let found = false;
	for (let envelopeRow = start; envelopeRow < end; envelopeRow++) {
		const envelopeStart = envelopes.stationStarts[envelopeRow] as number;
		const envelopeEnd = envelopes.stationEnds[envelopeRow] as number;
		if (envelopeEnd <= intervalStart + STATION_EPSILON_METERS) continue;
		if (envelopeStart >= intervalEnd - STATION_EPSILON_METERS) break;
		if (envelopeStart > cursor + STATION_EPSILON_METERS) {
			throw new Error(`Clearance envelopes leave a gap on path ${pathRow}.`);
		}
		minimum = Math.min(minimum, envelopes.ohtSweepRadiusMillimeters[envelopeRow] as number);
		found = true;
		cursor = Math.max(cursor, Math.min(intervalEnd, envelopeEnd));
		if (cursor >= intervalEnd - STATION_EPSILON_METERS) break;
	}
	if (cursor < intervalEnd - STATION_EPSILON_METERS || !found) {
		throw new Error(`Track interval on path ${pathRow} is not covered by an OHT sweep envelope.`);
	}
	return minimum;
}

function validResourceClearance(policy: SimulationTrackOccupancyPolicy): boolean {
	let minimum = 0xffff;
	for (let row = 0; row < policy.trackResourceCount; row++) {
		const length = policy.trackResourceLengthsMeters[row] as number;
		const radius = policy.trackResourceMinimumOhtSweepRadiusMillimeters[row] as number;
		if (
			!Number.isFinite(length) ||
			length <= STATION_EPSILON_METERS ||
			length > 1 + STATION_EPSILON_METERS ||
			radius === 0 ||
			radius < policy.lateralReservationRadiusMillimeters
		) {
			return false;
		}
		minimum = Math.min(minimum, radius);
	}
	if (policy.trackResourceCount === 0) minimum = 0;
	return policy.minimumCertifiedOhtSweepRadiusMillimeters === minimum;
}

function simulationTrackOccupancyPolicyViews(
	policy: Omit<SimulationTrackOccupancyPolicy, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		policy.trackResourceLengthsMeters,
		policy.trackResourceMinimumOhtSweepRadiusMillimeters,
		policy.switchConflictResourceIds,
	];
}

function validUniquePositiveIds(values: Uint32Array): boolean {
	const seen = new Set<number>();
	for (const value of values) {
		if (value === 0 || value > 0x7fff_ffff || seen.has(value)) return false;
		seen.add(value);
	}
	return true;
}

function maximumValue(values: Uint16Array): number {
	let maximum = 0;
	for (const value of values) maximum = Math.max(maximum, value);
	return maximum;
}

function sameNumbers(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((sum, view) => sum + view.byteLength, 0);
}

function hasDistinctOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBufferLike>();
	for (const view of views) {
		if (
			view.byteOffset !== 0 ||
			view.byteLength !== view.buffer.byteLength ||
			buffers.has(view.buffer)
		) {
			return false;
		}
		buffers.add(view.buffer);
	}
	return true;
}

function isPortableId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 120 &&
		value === value.trim() &&
		!containsControlCharacter(value)
	);
}

function containsControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUint32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function isPositiveUint32(value: unknown): value is number {
	return isUint32(value) && value > 0;
}

function isUint16(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff;
}

function isFloat32Array(value: unknown, length?: number): value is Float32Array {
	return value instanceof Float32Array && (length === undefined || value.length === length);
}

function isUint16Array(value: unknown, length?: number): value is Uint16Array {
	return value instanceof Uint16Array && (length === undefined || value.length === length);
}

function isUint32Array(value: unknown, length?: number): value is Uint32Array {
	return value instanceof Uint32Array && (length === undefined || value.length === length);
}
