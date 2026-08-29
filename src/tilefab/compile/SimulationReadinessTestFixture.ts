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
import { compilePortSlots, PORT_SLOT_STATUS, portSlotRecord } from "./PortSlotCompiler";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import {
	type CompileSimulationEquipmentResourceConfigurationInput,
	compileSimulationEquipmentResourceConfiguration,
	type SimulationEqGroupQualificationRecord,
	type SimulationStorageGroupConfigurationRecord,
} from "./SimulationEquipmentResourceConfiguration";
import type { SimulationReadinessComponents } from "./SimulationReadinessCertificate";
import {
	compileSimulationStaticWorldFoundation,
	SIMULATION_EQUIPMENT_GROUP_KIND_CODE,
	type SimulationStaticWorldFoundation,
} from "./SimulationStaticWorldFoundation";
import {
	compileSimulationStationOperationalCapabilities,
	type SimulationStationOperationalCapabilityRecord,
} from "./SimulationStationOperationalCapabilities";
import {
	compileSimulationTrackOccupancyPolicy,
	type SimulationVehicleReservationProfile,
} from "./SimulationTrackOccupancyPolicy";
import { compileSimulationTrackResourceTopology } from "./SimulationTrackResourceTopology";

export function buildSimulationReadinessTestComponents(
	foundation: SimulationStaticWorldFoundation = buildSimulationReadinessTestFoundation(),
	stationRecords: readonly SimulationStationOperationalCapabilityRecord[] = [
		...foundation.stations.ids,
	].map((portId) => ({
		portId,
		transferCapability: "BIDIRECTIONAL" as const,
	})),
	vehicleProfile: SimulationVehicleReservationProfile = simulationReadinessTestVehicleProfile(),
	storageMinimumDwellMilliseconds = 0,
	storageInitialOccupiedUnits = 0,
): SimulationReadinessComponents {
	const trackResources = compileSimulationTrackResourceTopology(foundation);
	const stationCapabilities = compileSimulationStationOperationalCapabilities(
		foundation,
		stationRecords,
	);
	const equipmentResources = compileSimulationEquipmentResourceConfiguration(
		foundation,
		stationCapabilities,
		genericEquipmentResourceInput(
			foundation,
			storageMinimumDwellMilliseconds,
			storageInitialOccupiedUnits,
		),
	);
	const occupancyPolicy = compileSimulationTrackOccupancyPolicy(
		foundation,
		trackResources,
		vehicleProfile,
	);
	return Object.freeze({
		foundation,
		trackResources,
		stationCapabilities,
		equipmentResources,
		occupancyPolicy,
	});
}

export function buildSimulationReadinessTestComponentsWithMixedPorts(
	storageMinimumDwellMilliseconds = 1_500,
	storageInitialOccupiedUnits = 0,
): SimulationReadinessComponents {
	const document = buildSimulationReadinessLongBay();
	const physical = compilePhysicalRail(document.map);
	const specs = [
		{ id: 1, groupId: 1, type: "OHB" as const, legalIndex: 0 },
		{ id: 2, groupId: 2, type: "EQ" as const, legalIndex: 2 },
		{ id: 3, groupId: 2, type: "EQ" as const, legalIndex: 4 },
		{ id: 4, groupId: 3, type: "STK" as const, legalIndex: 6 },
		{ id: 5, groupId: 3, type: "STK" as const, legalIndex: 8 },
	];
	const ports = specs.map((spec) => {
		const slots = compilePortSlots(physical, emptyPortEquipmentState(), spec.type);
		const legalRows = [...slots.statuses]
			.map((status, row) => ({ row, status }))
			.filter(({ status }) => status === PORT_SLOT_STATUS.LEGAL)
			.map(({ row }) => row);
		const slotRow = legalRows[spec.legalIndex];
		if (slotRow === undefined) throw new Error(`Mixed fixture has no legal ${spec.type} slot.`);
		return portSlotRecord(slots, slotRow, spec.id, spec.groupId, `OPENFAB-MIXED-PORT-${spec.id}`);
	});
	const portEquipment: PortEquipmentState = {
		nextPortId: 6,
		nextEquipmentGroupId: 4,
		ports,
		equipmentGroups: [
			{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			{ id: 2, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [2, 3] },
			{ id: 3, kind: "STK", template: "FLEX", portIds: [4, 5] },
		],
	};
	const foundation = buildSimulationReadinessTestFoundation(document, portEquipment);
	return buildSimulationReadinessTestComponents(
		foundation,
		[...foundation.stations.ids].map((portId) => ({
			portId,
			transferCapability: "BIDIRECTIONAL" as const,
		})),
		simulationReadinessTestVehicleProfile(),
		storageMinimumDwellMilliseconds,
		storageInitialOccupiedUnits,
	);
}

export function buildSimulationReadinessTestComponentsWithEqPorts(
	anchorX = 0,
	stationRecords?: readonly SimulationStationOperationalCapabilityRecord[],
): SimulationReadinessComponents {
	const document = buildSimulationReadinessLongBay(anchorX);
	const physical = compilePhysicalRail(document.map);
	const slots = compilePortSlots(physical, emptyPortEquipmentState(), "EQ");
	const legalRows = [...slots.statuses]
		.map((status, row) => ({ row, status }))
		.filter(({ status }) => status === PORT_SLOT_STATUS.LEGAL)
		.map(({ row }) => row);
	if (legalRows.length < 2) throw new Error("Readiness route fixture requires two legal EQ ports.");
	const firstRow = legalRows[0] as number;
	const secondRow = legalRows[Math.floor(legalRows.length / 2)] as number;
	const portEquipment: PortEquipmentState = {
		nextPortId: 3,
		nextEquipmentGroupId: 2,
		ports: [
			portSlotRecord(slots, firstRow, 1, 1, "OPENFAB-ROUTE-PORT-1"),
			portSlotRecord(slots, secondRow, 2, 1, "OPENFAB-ROUTE-PORT-2"),
		],
		equipmentGroups: [
			{
				id: 1,
				kind: "EQ",
				pitchMillimeters: 1_000,
				recipe: null,
				portIds: [1, 2],
			},
		],
	};
	return buildSimulationReadinessTestComponents(
		buildSimulationReadinessTestFoundation(document, portEquipment),
		stationRecords,
	);
}

export function buildSimulationReadinessTestComponentsWithEvenlySpacedEqPorts(
	portCount = 8,
): SimulationReadinessComponents {
	if (!Number.isInteger(portCount) || portCount < 2) {
		throw new RangeError("Readiness fixture EQ port count must be at least two.");
	}
	const document = buildSimulationReadinessLongBay();
	const physical = compilePhysicalRail(document.map);
	const slots = compilePortSlots(physical, emptyPortEquipmentState(), "EQ");
	const legalRows = [...slots.statuses]
		.map((status, row) => ({ row, status }))
		.filter(({ status }) => status === PORT_SLOT_STATUS.LEGAL)
		.map(({ row }) => row);
	if (legalRows.length < portCount) {
		throw new Error(`Readiness route fixture has fewer than ${portCount} legal EQ ports.`);
	}
	const selectedRows = Array.from({ length: portCount }, (_, index) => {
		return legalRows[Math.floor((index * legalRows.length) / portCount)] as number;
	});
	const portIds = selectedRows.map((_, index) => index + 1);
	const portEquipment: PortEquipmentState = {
		nextPortId: portCount + 1,
		nextEquipmentGroupId: 2,
		ports: selectedRows.map((row, index) =>
			portSlotRecord(slots, row, index + 1, 1, `OPENFAB-RUNTIME-PORT-${index + 1}`),
		),
		equipmentGroups: [
			{
				id: 1,
				kind: "EQ",
				pitchMillimeters: 1_000,
				recipe: null,
				portIds,
			},
		],
	};
	return buildSimulationReadinessTestComponents(
		buildSimulationReadinessTestFoundation(document, portEquipment),
	);
}

export function buildSimulationReadinessTestComponentsWithAdvancedSwitchEqPorts(): SimulationReadinessComponents {
	const document = buildSimulationReadinessAdvancedSwitchWorld();
	const physical = compilePhysicalRail(document.map);
	const slots = compilePortSlots(physical, emptyPortEquipmentState(), "EQ");
	const legalRows = [...slots.statuses]
		.map((status, row) => ({ row, status }))
		.filter(({ status }) => status === PORT_SLOT_STATUS.LEGAL)
		.map(({ row }) => row);
	if (legalRows.length < 2) {
		throw new Error("Advanced-switch readiness fixture requires two legal EQ ports.");
	}
	legalRows.sort(
		(left, right) =>
			(slots.worldPositions[left * 2 + 1] as number) -
			(slots.worldPositions[right * 2 + 1] as number),
	);
	const negativeLoopRow = legalRows[0] as number;
	const positiveLoopRow = legalRows[legalRows.length - 1] as number;
	const portEquipment: PortEquipmentState = {
		nextPortId: 3,
		nextEquipmentGroupId: 2,
		ports: [
			portSlotRecord(slots, negativeLoopRow, 1, 1, "OPENFAB-SWITCH-PORT-1"),
			portSlotRecord(slots, positiveLoopRow, 2, 1, "OPENFAB-SWITCH-PORT-2"),
		],
		equipmentGroups: [
			{
				id: 1,
				kind: "EQ",
				pitchMillimeters: 1_000,
				recipe: null,
				portIds: [1, 2],
			},
		],
	};
	return buildSimulationReadinessTestComponents(
		buildSimulationReadinessTestFoundation(document, portEquipment),
	);
}

export function buildSimulationReadinessTestFoundation(
	document: RailDocument = buildSimulationReadinessLongBay(),
	portEquipment: PortEquipmentState = emptyPortEquipmentState(),
): SimulationStaticWorldFoundation {
	const physical = compilePhysicalRail(document.map);
	const authoredChecksum = checksumRailMap(document.map, portEquipment);
	const readiness = createRailProjectReadiness(
		analyzeRailNetwork(document.map),
		physical,
		authoredChecksum,
	);
	if (!readiness.ready)
		throw new Error(`Readiness test fixture is not statically ready: ${readiness.status}`);
	return compileSimulationStaticWorldFoundation({
		patchSequence: document.getPatchSequence(),
		authoredChecksum,
		physicalFingerprint: checksumRailPhysicalLayout(physical),
		readiness,
		physical,
		portEquipment,
	});
}

export function buildSimulationReadinessLongBay(anchorX = 0): RailDocument {
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
		{ x: anchorX, y: 0 },
		initialRailTemplatePose(),
		parameters,
	);
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Readiness Long Bay fixture failed: ${plan.reason}`);
	}
	return document;
}

export function buildSimulationReadinessAdvancedSwitchWorld(): RailDocument {
	const record: AdvancedSwitchRecord = {
		id: 1,
		profileClass: "C",
		origin: { x: 0, y: 0 },
		forward: DIR_E,
		lateral: DIR_S,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
	const map = new TileMap();
	for (const cell of deriveAdvancedSwitchGeometry(record).cellStates) {
		map.setEncoded(cell.x, cell.y, cell.encoded);
	}
	if (!map.setAdvancedSwitch(record)) {
		throw new Error("Advanced-switch readiness fixture record failed.");
	}
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
			throw new Error(`Advanced-switch readiness return fixture failed: ${plan.reason}`);
		}
	}
	return RailDocument.fromLoadedMap(map, segments.length + 1);
}

export function simulationReadinessTestVehicleProfile(): SimulationVehicleReservationProfile {
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

function genericEquipmentResourceInput(
	foundation: SimulationStaticWorldFoundation,
	storageMinimumDwellMilliseconds = 0,
	storageInitialOccupiedUnits = 0,
): CompileSimulationEquipmentResourceConfigurationInput {
	if (!Number.isSafeInteger(storageInitialOccupiedUnits) || storageInitialOccupiedUnits < 0) {
		throw new RangeError("Readiness fixture storage initial occupancy must be non-negative.");
	}
	const eqGroupQualifications: SimulationEqGroupQualificationRecord[] = [];
	const storageGroups: SimulationStorageGroupConfigurationRecord[] = [];
	for (let groupRow = 0; groupRow < foundation.equipmentGroups.count; groupRow++) {
		const equipmentGroupId = foundation.equipmentGroups.ids[groupRow] as number;
		if (
			foundation.equipmentGroups.kindCodes[groupRow] === SIMULATION_EQUIPMENT_GROUP_KIND_CODE.EQ
		) {
			eqGroupQualifications.push({ equipmentGroupId, capabilityIds: [1] });
			continue;
		}
		const portStart = foundation.equipmentGroups.portOffsets[groupRow] as number;
		const portEnd = foundation.equipmentGroups.portOffsets[groupRow + 1] as number;
		const capacityUnits = Math.max(1, (portEnd - portStart) * 4);
		storageGroups.push({
			equipmentGroupId,
			policyId: 1,
			capacityUnits,
			initialOccupiedUnits: Math.min(storageInitialOccupiedUnits, capacityUnits),
			highWaterMarkUnits: capacityUnits,
		});
	}
	return {
		eqCapabilities: eqGroupQualifications.length > 0 ? [{ id: 1, key: "GENERIC_PROCESS" }] : [],
		eqGroupQualifications,
		eqPortQualificationOverrides: [],
		storageClasses: storageGroups.length > 0 ? [{ id: 1, key: "GENERIC_STORAGE" }] : [],
		storagePolicies:
			storageGroups.length > 0
				? [
						{
							id: 1,
							key: "GENERIC_STORAGE_POLICY",
							storageClassId: 1,
							priorityRank: 0,
							minimumDwellMilliseconds: storageMinimumDwellMilliseconds,
						},
					]
				: [],
		storageGroups,
	};
}
