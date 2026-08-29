import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	collectOperationalConfigurationReadinessIssues,
	copyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import {
	type CompileSimulationEquipmentResourceConfigurationInput,
	compileSimulationEquipmentResourceConfiguration,
} from "./SimulationEquipmentResourceConfiguration";
import type { SimulationReadinessComponents } from "./SimulationReadinessCertificate";
import {
	SIMULATION_EQUIPMENT_GROUP_KIND_CODE,
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import { compileSimulationStationOperationalCapabilities } from "./SimulationStationOperationalCapabilities";
import { compileSimulationTrackOccupancyPolicy } from "./SimulationTrackOccupancyPolicy";
import { compileSimulationTrackResourceTopology } from "./SimulationTrackResourceTopology";

/**
 * Converts one explicitly reviewed project configuration into certificate inputs. It never supplies
 * policy defaults and still leaves independent publication to the one-shot readiness Worker.
 */
export function compileSimulationReadinessComponentsFromOperationalConfiguration(
	foundation: SimulationStaticWorldFoundation,
	portEquipment: PortEquipmentState,
	state: OperationalConfigurationState,
): SimulationReadinessComponents {
	const foundationError = simulationStaticWorldFoundationError(foundation);
	if (foundationError) {
		throw new Error(`Simulation static-world foundation is invalid: ${foundationError}`);
	}
	assertPhysicalEquipmentIdentity(foundation, portEquipment);
	const canonical = copyOperationalConfigurationState(state);
	const issues = collectOperationalConfigurationReadinessIssues(canonical, portEquipment, {
		revision: foundation.source.revision,
		authoredChecksum: foundation.source.authoredChecksum,
	});
	if (issues.length > 0) {
		throw new Error(
			`Operational configuration is not ready: ${issues.map((issue) => issue.code).join(", ")}.`,
		);
	}
	if (!canonical.vehicleProfile) {
		throw new Error("Operational configuration has no reviewed vehicle profile.");
	}

	const trackResources = compileSimulationTrackResourceTopology(foundation);
	const stationCapabilities = compileSimulationStationOperationalCapabilities(
		foundation,
		canonical.stationCapabilities,
	);
	const equipmentInput: CompileSimulationEquipmentResourceConfigurationInput = {
		eqCapabilities: canonical.eqCapabilities,
		eqGroupQualifications: canonical.eqGroupQualifications,
		eqPortQualificationOverrides: canonical.eqPortQualificationOverrides,
		storageClasses: canonical.storageClasses,
		storagePolicies: canonical.storagePolicies,
		storageGroups: canonical.storageGroups,
	};
	const equipmentResources = compileSimulationEquipmentResourceConfiguration(
		foundation,
		stationCapabilities,
		equipmentInput,
	);
	const occupancyPolicy = compileSimulationTrackOccupancyPolicy(
		foundation,
		trackResources,
		canonical.vehicleProfile,
	);
	return Object.freeze({
		foundation,
		trackResources,
		stationCapabilities,
		equipmentResources,
		occupancyPolicy,
	});
}

function assertPhysicalEquipmentIdentity(
	foundation: SimulationStaticWorldFoundation,
	portEquipment: PortEquipmentState,
): void {
	if (
		foundation.stations.count !== portEquipment.ports.length ||
		foundation.equipmentGroups.count !== portEquipment.equipmentGroups.length
	) {
		throw new Error("Operational configuration physical equipment source count does not match.");
	}
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port]));
	for (let stationRow = 0; stationRow < foundation.stations.count; stationRow++) {
		const portId = foundation.stations.ids[stationRow] as number;
		const port = portsById.get(portId);
		if (
			!port ||
			port.equipmentGroupId !== foundation.stations.equipmentGroupIds[stationRow] ||
			kindCode(port.portType) !== foundation.stations.typeCodes[stationRow]
		) {
			throw new Error(
				`Operational configuration physical station identity differs at port ${portId}.`,
			);
		}
	}
	const groupsById = new Map(portEquipment.equipmentGroups.map((group) => [group.id, group]));
	for (let groupRow = 0; groupRow < foundation.equipmentGroups.count; groupRow++) {
		const groupId = foundation.equipmentGroups.ids[groupRow] as number;
		const group = groupsById.get(groupId);
		if (!group || kindCode(group.kind) !== foundation.equipmentGroups.kindCodes[groupRow]) {
			throw new Error(
				`Operational configuration physical equipment-group identity differs at group ${groupId}.`,
			);
		}
		const start = foundation.equipmentGroups.portOffsets[groupRow] as number;
		const end = foundation.equipmentGroups.portOffsets[groupRow + 1] as number;
		if (end - start !== group.portIds.length) {
			throw new Error(
				`Operational configuration physical equipment-group membership differs at group ${groupId}.`,
			);
		}
		for (let memberRow = start; memberRow < end; memberRow++) {
			if (foundation.equipmentGroups.portIds[memberRow] !== group.portIds[memberRow - start]) {
				throw new Error(
					`Operational configuration physical equipment-group membership differs at group ${groupId}.`,
				);
			}
		}
	}
}

function kindCode(kind: "OHB" | "EQ" | "STK"): number {
	return SIMULATION_EQUIPMENT_GROUP_KIND_CODE[kind];
}
