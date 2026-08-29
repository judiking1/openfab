import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import type { SimulationReadinessComponents } from "./SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponentsWithMixedPorts } from "./SimulationReadinessTestFixture";
import { compileSimulationResidentCycleAdmissionProgram } from "./SimulationResidentCycleAdmissionProgram";
import { compileSimulationResidentCycleLeaseClaims } from "./SimulationResidentCycleLeaseClaims";
import {
	compileSimulationResidentCycleResourceRunConfiguration,
	type SimulationResidentCycleResourceRunConfigurationInput,
} from "./SimulationResidentCycleResourceRunConfiguration";
import { compileSimulationResidentCycleRoutes } from "./SimulationResidentCycleRoutes";
import {
	compileSimulationResidentCycleServiceTiming,
	type SimulationResidentCycleServiceTimingInput,
} from "./SimulationResidentCycleServiceTiming";
import { compileSimulationResidentFleetParkingConfiguration } from "./SimulationResidentFleetParkingConfiguration";
import type { SimulationResidentReadinessSources } from "./SimulationResidentReadinessCertificate";
import {
	compileSimulationResidentTransferPlanManifest,
	type SimulationResidentTransferPlanRecord,
} from "./SimulationResidentScenarioManifest";

export interface SimulationResidentReadinessTestFixtureInput {
	readonly components?: SimulationReadinessComponents;
	readonly homePortId?: number;
	readonly records?: readonly SimulationResidentTransferPlanRecord[];
	readonly timingInput?: SimulationResidentCycleServiceTimingInput;
	readonly resourceInput?: SimulationResidentCycleResourceRunConfigurationInput;
}

export async function buildSimulationResidentReadinessTestSources(
	input: SimulationResidentReadinessTestFixtureInput = {},
): Promise<SimulationResidentReadinessSources> {
	const components =
		input.components ?? buildSimulationReadinessTestComponentsWithMixedPorts(1_500, 1);
	const homePortId = input.homePortId ?? 3;
	const records = input.records ?? [residentReadinessTestRecord(0, "LOAD-A", 1, 2)];
	const timingInput =
		input.timingInput ??
		({
			eqProcessTimings: [
				{
					sourceOrdinal: 0,
					capabilityId: 1,
					processingDurationMicroseconds: 2_000_000,
				},
			],
		} satisfies SimulationResidentCycleServiceTimingInput);
	const resourceInput =
		input.resourceInput ??
		({
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 2,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
		} satisfies SimulationResidentCycleResourceRunConfigurationInput);
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: 2,
			residentHomeSlots: [
				{
					id: 1,
					vehicleId: "OHT-001",
					anchorPortId: homePortId,
					policy: "DEDICATED_HOME_RETURN",
				},
			],
		},
		{
			revision: components.foundation.source.revision,
			authoredChecksum: components.foundation.source.authoredChecksum,
		},
	);
	const parking = compileSimulationResidentFleetParkingConfiguration(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		operational,
	);
	const manifest = compileSimulationResidentTransferPlanManifest(operational, {
		manifestId: "OPENFAB-RESIDENT-READINESS-TEST-1",
		adapterId: "OPENFAB_RESIDENT_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: records.length,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records,
	});
	const routes = await compileSimulationResidentCycleRoutes(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.stationCapabilities,
		manifest,
		parking,
	);
	const leaseClaims = compileSimulationResidentCycleLeaseClaims(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		parking,
		routes,
	);
	const admissionProgram = compileSimulationResidentCycleAdmissionProgram(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		manifest,
		parking,
		routes,
		leaseClaims,
	);
	const serviceTiming = compileSimulationResidentCycleServiceTiming(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		timingInput,
	);
	const resourceRunConfiguration = compileSimulationResidentCycleResourceRunConfiguration(
		components.foundation,
		components.trackResources,
		components.occupancyPolicy,
		components.equipmentResources,
		manifest,
		parking,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourceInput,
	);
	return Object.freeze({
		...components,
		parking,
		manifest,
		routes,
		leaseClaims,
		admissionProgram,
		serviceTiming,
		resourceRunConfiguration,
	});
}

export function residentReadinessTestRecord(
	sourceOrdinal: number,
	loadId: string,
	sourcePortId: number,
	destinationPortId: number,
): SimulationResidentTransferPlanRecord {
	return {
		transferId: `TRANSFER-${sourceOrdinal}`,
		sourceOrdinal,
		releaseTimeMicroseconds: sourceOrdinal,
		loadId,
		vehicleId: "OHT-001",
		sourcePortId,
		destinationPortId,
	};
}
