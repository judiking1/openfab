import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	initialRailTemplatePose,
	type LongBayTemplateParameters,
	planRailTemplate,
} from "../core/RailTemplateCatalog";
import { DIR_E, DIR_S } from "../core/railShape";
import { TileMap } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import {
	compileSimulationStaticWorldFoundation,
	type SimulationStaticWorldFoundation,
} from "./SimulationStaticWorldFoundation";
import {
	checksumSimulationTrackOccupancyPolicy,
	compileSimulationTrackOccupancyPolicy,
	isSimulationTrackOccupancyPolicy,
	SIMULATION_TRACK_ACQUISITION_POLICY,
	SIMULATION_TRACK_DEADLOCK_POLICY,
	SIMULATION_TRACK_FAIRNESS_POLICY,
	SIMULATION_TRACK_LEASE_SCOPE,
	SIMULATION_TRACK_RELEASE_POLICY,
	SIMULATION_TRACK_ROUTE_MUTATION_POLICY,
	SIMULATION_TRACK_SWITCH_POLICY,
	type SimulationVehicleReservationProfile,
	simulationTrackOccupancyPolicyError,
} from "./SimulationTrackOccupancyPolicy";
import { compileSimulationTrackResourceTopology } from "./SimulationTrackResourceTopology";
import { buildSyntheticFabStarter, defaultSyntheticFabStarterRequest } from "./SyntheticFabStarter";

describe("SimulationTrackOccupancyPolicy", () => {
	it("certifies explicit footprint, braking, and every resource against OHT sweep clearance", () => {
		const foundation = readyFoundation(buildLongBay(), emptyPortEquipmentState());
		const topology = compileSimulationTrackResourceTopology(foundation);
		const policy = compileSimulationTrackOccupancyPolicy(
			foundation,
			topology,
			validVehicleProfile(),
		);

		expect(policy).toMatchObject({
			simulationReady: false,
			sourceFoundationFingerprint: foundation.fingerprint,
			sourceTrackResourceTopologyFingerprint: topology.fingerprint,
			clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
			clearanceProfileVersion: 1,
			vehicleProfileId: "OPENFAB_GENERIC_OHT_RESERVATION_V1",
			reactionDistanceMillimeters: 200,
			brakingDistanceMillimeters: 2_000,
			frontLeaseExtensionMillimeters: 3_000,
			rearLeaseExtensionMillimeters: 800,
			lateralReservationRadiusMillimeters: 310,
			maximumClearanceApproximationToleranceMillimeters: 10,
			minimumCertifiedOhtSweepRadiusMillimeters: 350,
			trackResourceCount: topology.trackResourceCount,
		});
		expect(new Set(policy.trackResourceMinimumOhtSweepRadiusMillimeters)).toEqual(new Set([350]));
		for (const length of policy.trackResourceLengthsMeters) {
			expect(length).toBeGreaterThan(0);
			expect(length).toBeLessThanOrEqual(1 + 1e-4);
		}
		expect(policy.trackResourceLengthsMeters.buffer).not.toBe(topology.trackResourceStarts.buffer);
		expect(checksumSimulationTrackOccupancyPolicy(policy)).toBe(policy.fingerprint);
		expect(isSimulationTrackOccupancyPolicy(policy)).toBe(true);
	});

	it("publishes the exact atomic, fair, and no-hold-while-waiting protocol", () => {
		const foundation = readyFoundation(buildLongBay(), emptyPortEquipmentState());
		const policy = compileSimulationTrackOccupancyPolicy(
			foundation,
			compileSimulationTrackResourceTopology(foundation),
			validVehicleProfile(),
		);

		expect(policy).toMatchObject({
			leaseScope: SIMULATION_TRACK_LEASE_SCOPE,
			acquisitionPolicy: SIMULATION_TRACK_ACQUISITION_POLICY,
			fairnessPolicy: SIMULATION_TRACK_FAIRNESS_POLICY,
			deadlockPolicy: SIMULATION_TRACK_DEADLOCK_POLICY,
			releasePolicy: SIMULATION_TRACK_RELEASE_POLICY,
			switchPolicy: SIMULATION_TRACK_SWITCH_POLICY,
			routeMutationPolicy: SIMULATION_TRACK_ROUTE_MUTATION_POLICY,
			partialAcquisitionAllowed: false,
			waitingRequestMayHoldRouteResources: false,
		});
		for (const field of [
			policy.acquisitionPolicy,
			policy.fairnessPolicy,
			policy.deadlockPolicy,
			policy.releasePolicy,
			policy.routeMutationPolicy,
		]) {
			expect(field.length).toBeGreaterThan(0);
		}
	});

	it("includes the exact advanced-switch conflict namespace in the whole-route lease contract", () => {
		const foundation = readyFoundation(buildClosedAdvancedSwitchWorld(), emptyPortEquipmentState());
		const topology = compileSimulationTrackResourceTopology(foundation);
		const policy = compileSimulationTrackOccupancyPolicy(
			foundation,
			topology,
			validVehicleProfile(),
		);

		expect(topology.switchConflictResourceCount).toBe(1);
		expect(policy.switchConflictResourceCount).toBe(1);
		expect([...policy.switchConflictResourceIds]).toEqual([...topology.switchConflictResourceIds]);
		expect(policy.switchConflictResourceIds.buffer).not.toBe(
			topology.switchConflictResourceIds.buffer,
		);
		expect(policy.switchPolicy).toBe("INCLUDE_EXACT_MOVEMENT_CONFLICT_RESOURCE");
	});

	it("rejects a profile that does not fit the certified lateral sweep or reference geometry", () => {
		const foundation = readyFoundation(buildLongBay(), emptyPortEquipmentState());
		const topology = compileSimulationTrackResourceTopology(foundation);

		expect(() =>
			compileSimulationTrackOccupancyPolicy(foundation, topology, {
				...validVehicleProfile(),
				bodyWidthMillimeters: 600,
			}),
		).toThrow(/exceeds the certified OHT sweep radius/i);
		expect(() =>
			compileSimulationTrackOccupancyPolicy(foundation, topology, {
				...validVehicleProfile(),
				referenceToFrontMillimeters: 700,
			}),
		).toThrow(/offsets must sum to body length/i);

		const policy = compileSimulationTrackOccupancyPolicy(
			foundation,
			topology,
			validVehicleProfile(),
		);
		const oversizedDerivedDistance = {
			...policy,
			maximumSpeedMillimetersPerSecond: 0xffff_ffff,
			controlReactionMilliseconds: 0xffff_ffff,
			minimumServiceDecelerationMillimetersPerSecondSquared: 1,
		};
		expect(() => simulationTrackOccupancyPolicyError(oversizedDerivedDistance)).not.toThrow();
		expect(simulationTrackOccupancyPolicyError(oversizedDerivedDistance)).toMatch(
			/outside the policy range/i,
		);
	});

	it("rejects a valid topology paired with a different foundation generation", () => {
		const longBayFoundation = readyFoundation(buildLongBay(), emptyPortEquipmentState());
		const switchFoundation = readyFoundation(
			buildClosedAdvancedSwitchWorld(),
			emptyPortEquipmentState(),
		);
		const switchTopology = compileSimulationTrackResourceTopology(switchFoundation);

		expect(() =>
			compileSimulationTrackOccupancyPolicy(
				longBayFoundation,
				switchTopology,
				validVehicleProfile(),
			),
		).toThrow(/does not belong to the supplied static-world foundation/i);
	});

	it("fails closed on clearance corruption and fingerprint-covered valid-looking mutation", () => {
		const foundation = readyFoundation(buildLongBay(), emptyPortEquipmentState());
		const policy = compileSimulationTrackOccupancyPolicy(
			foundation,
			compileSimulationTrackResourceTopology(foundation),
			validVehicleProfile(),
		);
		const beforeRadius = policy.trackResourceMinimumOhtSweepRadiusMillimeters[0] as number;
		policy.trackResourceMinimumOhtSweepRadiusMillimeters[0] = 309;
		expect(simulationTrackOccupancyPolicyError(policy)).toMatch(/clearance certification/i);
		policy.trackResourceMinimumOhtSweepRadiusMillimeters[0] = beforeRadius;

		const beforeLength = policy.trackResourceLengthsMeters[0] as number;
		policy.trackResourceLengthsMeters[0] = beforeLength * 0.9;
		expect(simulationTrackOccupancyPolicyError(policy)).toMatch(/fingerprint/i);
		policy.trackResourceLengthsMeters[0] = beforeLength;
		expect(simulationTrackOccupancyPolicyError(policy)).toBeNull();
	});

	it("keeps public-safe 60-Bay clearance certification in bounded transferable columns", () => {
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const readiness = createRailProjectReadiness(
			build.analysis,
			build.physical,
			build.authoredChecksum,
		);
		expect(readiness.ready).toBe(true);
		const foundation = compileSimulationStaticWorldFoundation({
			patchSequence: build.document.getPatchSequence(),
			authoredChecksum: build.authoredChecksum,
			physicalFingerprint: build.physicalFingerprint,
			readiness,
			physical: build.physical,
			portEquipment: build.document.portEquipment,
		});
		const topology = compileSimulationTrackResourceTopology(foundation);
		const policy = compileSimulationTrackOccupancyPolicy(
			foundation,
			topology,
			validVehicleProfile(),
		);

		expect(build.summary.railCells).toBe(9_896);
		expect(policy.trackResourceCount).toBe(topology.trackResourceCount);
		expect(policy.byteLength).toBeLessThan(8 * 1024 * 1024);
		expect(isSimulationTrackOccupancyPolicy(policy)).toBe(true);
		expect(policy.simulationReady).toBe(false);
	});
});

function validVehicleProfile(): SimulationVehicleReservationProfile {
	return {
		id: "OPENFAB_GENERIC_OHT_RESERVATION_V1",
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
	};
}

function readyFoundation(
	document: RailDocument,
	portEquipment: PortEquipmentState,
): SimulationStaticWorldFoundation {
	const physical = compilePhysicalRail(document.map);
	const authoredChecksum = checksumRailMap(document.map, portEquipment);
	const readiness = createRailProjectReadiness(
		analyzeRailNetwork(document.map),
		physical,
		authoredChecksum,
	);
	expect(readiness.ready).toBe(true);
	return compileSimulationStaticWorldFoundation({
		patchSequence: document.getPatchSequence(),
		authoredChecksum,
		physicalFingerprint: checksumRailPhysicalLayout(physical),
		readiness,
		physical,
		portEquipment,
	});
}

function buildLongBay(): RailDocument {
	const document = new RailDocument();
	const parameters: LongBayTemplateParameters = Object.freeze({
		templateId: "long-bay",
		aisleLengthMeters: 16,
		laneSpacingMeters: 6,
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
	});
	const plan = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		parameters,
	);
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Long Bay fixture failed: ${plan.reason}`);
	}
	return document;
}

function buildClosedAdvancedSwitchWorld(): RailDocument {
	const record: AdvancedSwitchRecord = {
		id: 1,
		profileClass: "C" as const,
		origin: { x: 0, y: 0 },
		forward: DIR_E,
		lateral: DIR_S,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
	const map = new TileMap();
	for (const cell of deriveAdvancedSwitchGeometry(record).cellStates) {
		map.setEncoded(cell.x, cell.y, cell.encoded);
	}
	if (!map.setAdvancedSwitch(record)) throw new Error("Advanced-switch fixture record failed.");
	const segments = [
		[
			{ x: 6, y: 0 },
			{ x: 8, y: 0 },
		],
		[
			{ x: 8, y: 0 },
			{ x: 8, y: -8 },
		],
		[
			{ x: 8, y: -8 },
			{ x: -2, y: -8 },
		],
		[
			{ x: -2, y: -8 },
			{ x: -2, y: 0 },
		],
		[
			{ x: -2, y: 0 },
			{ x: 0, y: 0 },
		],
		[
			{ x: 4, y: 3 },
			{ x: 4, y: 10 },
		],
		[
			{ x: 4, y: 10 },
			{ x: 2, y: 10 },
		],
		[
			{ x: 2, y: 10 },
			{ x: 2, y: 3 },
		],
	] as const;
	for (const [from, to] of segments) {
		const plan = planRailConstruction(map, from, to);
		if (!plan.valid || !map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? [])) {
			throw new Error(`Advanced-switch return fixture failed: ${plan.reason}`);
		}
	}
	return RailDocument.fromLoadedMap(map, segments.length + 1);
}
