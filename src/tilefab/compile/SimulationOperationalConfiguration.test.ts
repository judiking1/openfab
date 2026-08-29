import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import { compileSimulationReadinessComponentsFromOperationalConfiguration } from "./SimulationOperationalConfiguration";
import { simulationReadinessComponentsError } from "./SimulationReadinessCertificate";
import {
	buildSimulationReadinessTestFoundation,
	simulationReadinessTestVehicleProfile,
} from "./SimulationReadinessTestFixture";

describe("SimulationOperationalConfiguration", () => {
	it("compiles only an explicit review matching the exact static source", () => {
		const foundation = buildSimulationReadinessTestFoundation();
		const draft = {
			...emptyOperationalConfigurationState(),
			revision: 1,
			vehicleProfile: simulationReadinessTestVehicleProfile(),
		};
		const reviewed = reviewOperationalConfiguration(draft, {
			revision: foundation.source.revision,
			authoredChecksum: foundation.source.authoredChecksum,
		});

		const components = compileSimulationReadinessComponentsFromOperationalConfiguration(
			foundation,
			emptyPortEquipmentState(),
			reviewed,
		);

		expect(simulationReadinessComponentsError(components)).toBeNull();
		expect(components.stationCapabilities.stationCount).toBe(0);
		expect(components.equipmentResources.eqCapabilityCount).toBe(0);
		expect(components.occupancyPolicy.vehicleProfileId).toBe(
			simulationReadinessTestVehicleProfile().id,
		);
	});

	it("fails closed for unresolved or source-stale configuration", () => {
		const foundation = buildSimulationReadinessTestFoundation();
		expect(() =>
			compileSimulationReadinessComponentsFromOperationalConfiguration(
				foundation,
				emptyPortEquipmentState(),
				emptyOperationalConfigurationState(),
			),
		).toThrow(/VEHICLE_PROFILE_MISSING, REVIEW_REQUIRED/);

		const reviewed = reviewOperationalConfiguration(
			{
				...emptyOperationalConfigurationState(),
				vehicleProfile: simulationReadinessTestVehicleProfile(),
			},
			{
				revision: foundation.source.revision + 1,
				authoredChecksum: foundation.source.authoredChecksum,
			},
		);
		expect(() =>
			compileSimulationReadinessComponentsFromOperationalConfiguration(
				foundation,
				emptyPortEquipmentState(),
				reviewed,
			),
		).toThrow(/REVIEW_SOURCE_MISMATCH/);
	});

	it("rejects a different physical equipment source before compiling policy", () => {
		const foundation = buildSimulationReadinessTestFoundation();
		const foreign = {
			...emptyPortEquipmentState(),
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [
				{
					id: 1,
					equipmentGroupId: 1,
					route: { kind: "CARDINAL_CELL" as const, x: 0, z: 0, from: 1 as const, to: 2 as const },
					stationMillimeters: 0,
					side: "CENTER" as const,
					lateralOffsetMillimeters: 0,
					direction: "WITH_TRAVEL" as const,
					portType: "OHB" as const,
					barcode: null,
				},
			],
			equipmentGroups: [{ id: 1, kind: "OHB" as const, template: "SINGLE" as const, portIds: [1] }],
		};

		expect(() =>
			compileSimulationReadinessComponentsFromOperationalConfiguration(
				foundation,
				foreign,
				emptyOperationalConfigurationState(),
			),
		).toThrow(/source count does not match/);
	});
});
