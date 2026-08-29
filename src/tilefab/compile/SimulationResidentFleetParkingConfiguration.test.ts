import { describe, expect, it } from "vitest";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import {
	buildSimulationReadinessTestComponents,
	buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts,
	buildSimulationReadinessTestComponentsWithEqPorts,
	buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts,
	simulationReadinessTestVehicleProfile,
} from "./SimulationReadinessTestFixture";
import {
	checksumSimulationResidentFleetParkingConfiguration,
	compileSimulationResidentFleetParkingConfiguration,
	SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY,
	SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY,
	SIMULATION_RESIDENT_FLEET_PARKING_MISSING_SAFETY_LAYERS,
	SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID,
	type SimulationResidentFleetHomeSlotInput,
	simulationResidentFleetParkingConfigurationError,
	simulationResidentFleetParkingConfigurationMatchesOperationalConfiguration,
	simulationResidentFleetParkingConfigurationMatchesSources,
	simulationResidentFleetParkingConfigurationTransfers,
} from "./SimulationResidentFleetParkingConfiguration";

describe("SimulationResidentFleetParkingConfiguration", () => {
	it("publishes a valid non-runnable empty configuration for the separate profile", () => {
		const components = buildSimulationReadinessTestComponentsWithEqPorts();
		const operational = parkingOperational(components, []);
		const configuration = compileSimulationResidentFleetParkingConfiguration(
			components.foundation,
			components.trackResources,
			components.occupancyPolicy,
			operational,
		);

		expect(configuration).toMatchObject({
			simulationReady: false,
			runtimeProfileId: SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID,
			missingSafetyLayers: SIMULATION_RESIDENT_FLEET_PARKING_MISSING_SAFETY_LAYERS,
			homeSlotPolicy: SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY,
			deadlockPolicy: SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY,
			parkingSlotCapacity: 1,
			homeSlotFootprintsPairwiseDisjoint: true,
			slotCount: 0,
		});
		expect([...configuration.footprintTrackResourceOffsets]).toEqual([0]);
		expect([...configuration.orderedOccurrenceOffsets]).toEqual([0]);
		expect(simulationResidentFleetParkingConfigurationError(configuration)).toBeNull();
		expect(checksumSimulationResidentFleetParkingConfiguration(configuration)).toBe(
			configuration.fingerprint,
		);
		expect(
			simulationResidentFleetParkingConfigurationMatchesOperationalConfiguration(
				configuration,
				operational,
			),
		).toBe(true);
		expect(
			simulationResidentFleetParkingConfigurationMatchesOperationalConfiguration(
				configuration,
				reviewOperationalConfiguration(
					{ ...operational, review: null, nextResidentHomeSlotId: 2 },
					{
						revision: components.foundation.source.revision,
						authoredChecksum: components.foundation.source.authoredChecksum,
					},
				),
			),
		).toBe(false);
		expect(
			simulationResidentFleetParkingConfigurationMatchesOperationalConfiguration(
				configuration,
				reviewOperationalConfiguration(
					{ ...operational, review: null },
					{
						revision: components.foundation.source.revision + 1,
						authoredChecksum: components.foundation.source.authoredChecksum,
					},
				),
			),
		).toBe(false);
	});

	it("resolves stable port anchors, extends certified footprints, and canonicalizes slots", () => {
		const components = buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8);
		const configuration = compileParking(components, [slot(9, "OHT-9", 5), slot(3, "OHT-3", 1)]);

		expect([...configuration.slotIds]).toEqual([3, 9]);
		expect(configuration.vehicleIds).toEqual(["OHT-3", "OHT-9"]);
		expect([...configuration.anchorPortIds]).toEqual([1, 5]);
		expect(configuration.frontLeaseExtensionMillimeters).toBe(
			components.occupancyPolicy.frontLeaseExtensionMillimeters,
		);
		expect(configuration.rearLeaseExtensionMillimeters).toBe(
			components.occupancyPolicy.rearLeaseExtensionMillimeters,
		);
		for (let row = 0; row < configuration.slotCount; row++) {
			const occurrenceStart = configuration.orderedOccurrenceOffsets[row] as number;
			const occurrenceEnd = configuration.orderedOccurrenceOffsets[row + 1] as number;
			expect(configuration.orderedOccurrenceStartsMeters[occurrenceStart]).toBeCloseTo(
				-components.occupancyPolicy.rearLeaseExtensionMillimeters / 1_000,
				8,
			);
			expect(configuration.orderedOccurrenceEndsMeters[occurrenceEnd - 1]).toBeCloseTo(
				components.occupancyPolicy.frontLeaseExtensionMillimeters / 1_000,
				8,
			);
		}
		const firstRows = csrRows(
			configuration.footprintTrackResourceOffsets,
			configuration.footprintTrackResourceRows,
			0,
		);
		const secondRows = csrRows(
			configuration.footprintTrackResourceOffsets,
			configuration.footprintTrackResourceRows,
			1,
		);
		expect(firstRows.length).toBeGreaterThan(0);
		expect(secondRows.length).toBeGreaterThan(0);
		expect(firstRows.some((resourceRow) => secondRows.includes(resourceRow))).toBe(false);
		expect(
			simulationResidentFleetParkingConfigurationMatchesSources(
				components.foundation,
				components.trackResources,
				components.occupancyPolicy,
				configuration,
			),
		).toBe(true);
	});

	it("rejects overlapping slots, duplicate identities, foreign ports, and oversized input", () => {
		const components = buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(16);

		expect(() => compileParking(components, [slot(1, "OHT-1", 1), slot(2, "OHT-2", 2)])).toThrow(
			/overlap on physical track resource/i,
		);
		expect(() => compileParking(components, [slot(1, "OHT-1", 1), slot(2, "OHT-1", 8)])).toThrow(
			/resident .*vehicle ID is duplicated/i,
		);
		expect(() => compileParking(components, [slot(1, "OHT-1", 999)])).toThrow(
			/foreign anchor port/i,
		);
		expect(() =>
			compileParking(
				components,
				Array.from({ length: 8_193 }, (_, row) => slot(row + 1, `OHT-${row + 1}`, 1)),
			),
		).toThrow(/count exceeds|bounded profile limit/i);
	});

	it("requires an exact-source operational review before compiling persisted home slots", () => {
		const components = buildSimulationReadinessTestComponentsWithEqPorts();
		const draft = emptyOperationalConfigurationState();
		expect(() =>
			compileSimulationResidentFleetParkingConfiguration(
				components.foundation,
				components.trackResources,
				components.occupancyPolicy,
				draft,
			),
		).toThrow(/explicitly reviewed/i);
		const foreignReview = reviewOperationalConfiguration(draft, {
			revision: components.foundation.source.revision + 1,
			authoredChecksum: components.foundation.source.authoredChecksum,
		});
		expect(() =>
			compileSimulationResidentFleetParkingConfiguration(
				components.foundation,
				components.trackResources,
				components.occupancyPolicy,
				foreignReview,
			),
		).toThrow(/exact static source/i);
	});

	it("fails closed when a stationary footprint needs an ambiguous switch boundary", () => {
		const foundation = buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts().foundation;
		const components = buildSimulationReadinessTestComponents(foundation, undefined, {
			...simulationReadinessTestVehicleProfile(),
			frontSafetyMarginMillimeters: 100_000,
		});

		expect(() => compileParking(components, [slot(1, "OHT-SWITCH", 1)])).toThrow(
			/explicit continuation|advanced-switch conflict/i,
		);
	});

	it("rejects mutation and source drift and survives an owned transfer", () => {
		const components = buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(8);
		const configuration = compileParking(components, [slot(1, "OHT-1", 1)]);
		const foreign = buildSimulationReadinessTestComponentsWithEqPorts(40);

		expect(
			simulationResidentFleetParkingConfigurationError({
				...configuration,
				rawStationRow: "must-not-cross",
			}),
		).toMatch(/unexpected fields/i);
		expect(
			simulationResidentFleetParkingConfigurationMatchesSources(
				foreign.foundation,
				foreign.trackResources,
				foreign.occupancyPolicy,
				configuration,
			),
		).toBe(false);
		configuration.orderedOccurrenceEndsMeters[0] =
			(configuration.orderedOccurrenceEndsMeters[0] as number) + 0.01;
		expect(simulationResidentFleetParkingConfigurationError(configuration)).toMatch(
			/footprint|fingerprint/i,
		);

		const transferable = compileParking(components, [slot(1, "OHT-1", 1)]);
		const transfers = simulationResidentFleetParkingConfigurationTransfers(transferable);
		const transferred = structuredClone(transferable, { transfer: [...transfers] });
		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(simulationResidentFleetParkingConfigurationError(transferred)).toBeNull();
		expect(
			simulationResidentFleetParkingConfigurationMatchesSources(
				components.foundation,
				components.trackResources,
				components.occupancyPolicy,
				transferred,
			),
		).toBe(true);
	});
});

function slot(
	slotId: number,
	vehicleId: string,
	anchorPortId: number,
): SimulationResidentFleetHomeSlotInput {
	return {
		slotId,
		vehicleId,
		anchorPortId,
		policy: SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY,
	};
}

function compileParking(
	components: ReturnType<typeof buildSimulationReadinessTestComponents>,
	inputs: readonly SimulationResidentFleetHomeSlotInput[],
) {
	const operational = parkingOperational(components, inputs);
	return compileSimulationResidentFleetParkingConfiguration(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		operational,
	);
}

function parkingOperational(
	components: ReturnType<typeof buildSimulationReadinessTestComponents>,
	inputs: readonly SimulationResidentFleetHomeSlotInput[],
) {
	const residentHomeSlots = inputs.map((input) => ({
		id: input.slotId,
		vehicleId: input.vehicleId,
		anchorPortId: input.anchorPortId,
		policy: input.policy,
	}));
	return reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId:
				residentHomeSlots.reduce((maximum, slot) => Math.max(maximum, slot.id), 0) + 1,
			residentHomeSlots,
		},
		{
			revision: components.foundation.source.revision,
			authoredChecksum: components.foundation.source.authoredChecksum,
		},
	);
}

function csrRows(offsets: Uint32Array, rows: Uint32Array, row: number): number[] {
	return [...rows.slice(offsets[row], offsets[row + 1])];
}
