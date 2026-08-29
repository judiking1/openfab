import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import { RailDocument } from "../core/RailDocument";
import {
	initialRailTemplatePose,
	type LongBayTemplateParameters,
	planRailTemplate,
} from "../core/RailTemplateCatalog";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { type CompiledPhysicalLayout, compilePhysicalRail } from "./PhysicalRailCompiler";
import { compilePortSlots, PORT_SLOT_STATUS, portSlotRecord } from "./PortSlotCompiler";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import {
	type CompileSimulationEquipmentResourceConfigurationInput,
	checksumSimulationEquipmentResourceConfiguration,
	compileSimulationEquipmentResourceConfiguration,
	isSimulationEquipmentResourceConfiguration,
	SIMULATION_EQ_QUALIFICATION_SOURCE_CODE,
	simulationEquipmentResourceConfigurationError,
} from "./SimulationEquipmentResourceConfiguration";
import {
	compileSimulationStaticWorldFoundation,
	type SimulationStaticWorldFoundation,
} from "./SimulationStaticWorldFoundation";
import {
	compileSimulationStationOperationalCapabilities,
	type SimulationStationOperationalCapabilities,
} from "./SimulationStationOperationalCapabilities";

describe("SimulationEquipmentResourceConfiguration", () => {
	it("compiles stable EQ overrides and OHB/STK resource policy without changing physical groups", () => {
		const sources = mixedSources();
		const first = compileSimulationEquipmentResourceConfiguration(
			sources.foundation,
			sources.stationCapabilities,
			validInput(),
		);
		const reordered = compileSimulationEquipmentResourceConfiguration(
			sources.foundation,
			sources.stationCapabilities,
			reorderedValidInput(),
		);

		expect(first).toMatchObject({
			simulationReady: false,
			stationCount: 5,
			equipmentGroupCount: 3,
			eqCapabilityCount: 2,
			storageClassCount: 2,
			storagePolicyCount: 2,
		});
		expect([...first.groupIds]).toEqual([1, 2, 3]);
		expect([...first.eqCapabilityIds]).toEqual([10, 20]);
		expect(first.eqCapabilityKeys).toEqual(["CLEAN", "ETCH"]);
		expect([...first.eqGroupCapabilityOffsets]).toEqual([0, 0, 1, 1]);
		expect([...first.eqGroupCapabilityIds]).toEqual([20]);
		expect([...first.eqStationCapabilityOffsets]).toEqual([0, 0, 1, 2, 2, 2]);
		expect([...first.eqStationCapabilityIds]).toEqual([20, 10]);
		expect([...first.eqQualificationSourceCodes]).toEqual([
			SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.NOT_EQ,
			SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.GROUP_DEFAULT,
			SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.PORT_OVERRIDE,
			SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.NOT_EQ,
			SIMULATION_EQ_QUALIFICATION_SOURCE_CODE.NOT_EQ,
		]);
		expect([...first.storageClassIds]).toEqual([5, 6]);
		expect([...first.storagePolicyIds]).toEqual([7, 8]);
		expect([...first.storageGroupPolicyIds]).toEqual([7, 0, 8]);
		expect([...first.storageGroupCapacityUnits]).toEqual([12, 0, 40]);
		expect([...first.storageGroupInitialOccupiedUnits]).toEqual([4, 0, 3]);
		expect([...first.storageGroupHighWaterMarkUnits]).toEqual([10, 0, 32]);
		expect(first.fingerprint).toBe(reordered.fingerprint);
		expect(first.portIds.buffer).not.toBe(sources.foundation.stations.ids.buffer);
		expect(first.groupIds.buffer).not.toBe(sources.foundation.equipmentGroups.ids.buffer);
		expect(checksumSimulationEquipmentResourceConfiguration(first)).toBe(first.fingerprint);
		expect(isSimulationEquipmentResourceConfiguration(first)).toBe(true);
	});

	it("requires exact physical-group coverage and EQ-only port overrides", () => {
		const sources = mixedSources();
		const missingEq = validInput();
		expect(() =>
			compileSimulationEquipmentResourceConfiguration(
				sources.foundation,
				sources.stationCapabilities,
				{ ...missingEq, eqGroupQualifications: [] },
			),
		).toThrow(/every physical EQ group/i);

		const wrongStorageGroup = validInput();
		expect(() =>
			compileSimulationEquipmentResourceConfiguration(
				sources.foundation,
				sources.stationCapabilities,
				{
					...wrongStorageGroup,
					storageGroups: [
						...wrongStorageGroup.storageGroups,
						{
							equipmentGroupId: 2,
							policyId: 7,
							capacityUnits: 1,
							initialOccupiedUnits: 0,
							highWaterMarkUnits: 1,
						},
					],
				},
			),
		).toThrow(/EQ or foreign group 2/i);

		const wrongPort = validInput();
		expect(() =>
			compileSimulationEquipmentResourceConfiguration(
				sources.foundation,
				sources.stationCapabilities,
				{
					...wrongPort,
					eqPortQualificationOverrides: [{ portId: 1, capabilityIds: [10] }],
				},
			),
		).toThrow(/non-EQ or foreign port 1/i);
	});

	it("rejects unknown logical IDs and impossible storage bounds", () => {
		const sources = mixedSources();
		const unknownCapability = validInput();
		expect(() =>
			compileSimulationEquipmentResourceConfiguration(
				sources.foundation,
				sources.stationCapabilities,
				{
					...unknownCapability,
					eqGroupQualifications: [{ equipmentGroupId: 2, capabilityIds: [99] }],
				},
			),
		).toThrow(/capability reference 99 is unknown/i);

		const badCapacity = validInput();
		expect(() =>
			compileSimulationEquipmentResourceConfiguration(
				sources.foundation,
				sources.stationCapabilities,
				{
					...badCapacity,
					storageGroups: [
						{ ...badCapacity.storageGroups[0], highWaterMarkUnits: 41 },
						badCapacity.storageGroups[1],
					],
				},
			),
		).toThrow(/high-water mark exceeds capacity/i);
	});

	it("fails closed when compiled qualifications or storage bounds become inconsistent", () => {
		const sources = mixedSources();
		const configuration = compileSimulationEquipmentResourceConfiguration(
			sources.foundation,
			sources.stationCapabilities,
			validInput(),
		);
		const beforeCapability = configuration.eqStationCapabilityIds[0] as number;
		configuration.eqStationCapabilityIds[0] = 10;
		expect(simulationEquipmentResourceConfigurationError(configuration)).toMatch(
			/effective EQ station qualifications/i,
		);
		configuration.eqStationCapabilityIds[0] = beforeCapability;

		const beforeCapacity = configuration.storageGroupCapacityUnits[0] as number;
		configuration.storageGroupCapacityUnits[0] = 2;
		expect(simulationEquipmentResourceConfigurationError(configuration)).toMatch(
			/physical-group resource rows/i,
		);
		configuration.storageGroupCapacityUnits[0] = beforeCapacity;
		expect(simulationEquipmentResourceConfigurationError(configuration)).toBeNull();
	});

	it("detects valid-looking post-publication mutation through the complete fingerprint", () => {
		const sources = mixedSources();
		const configuration = compileSimulationEquipmentResourceConfiguration(
			sources.foundation,
			sources.stationCapabilities,
			validInput(),
		);
		const before = configuration.storagePolicyPriorityRanks[0] as number;
		configuration.storagePolicyPriorityRanks[0] = before + 1;

		expect(simulationEquipmentResourceConfigurationError(configuration)).toMatch(/fingerprint/i);
		configuration.storagePolicyPriorityRanks[0] = before;
		expect(simulationEquipmentResourceConfigurationError(configuration)).toBeNull();
	});

	it("accepts an explicit empty configuration for a foundation without equipment", () => {
		const foundation = readyFoundation(emptyPortEquipmentState());
		const stationCapabilities = compileSimulationStationOperationalCapabilities(foundation, []);
		const configuration = compileSimulationEquipmentResourceConfiguration(
			foundation,
			stationCapabilities,
			emptyInput(),
		);

		expect(configuration.stationCount).toBe(0);
		expect(configuration.equipmentGroupCount).toBe(0);
		expect(configuration.byteLength).toBe(8);
		expect(simulationEquipmentResourceConfigurationError(configuration)).toBeNull();
		expect(configuration.simulationReady).toBe(false);
	});
});

function validInput(): CompileSimulationEquipmentResourceConfigurationInput {
	return {
		eqCapabilities: [
			{ id: 20, key: "ETCH" },
			{ id: 10, key: "CLEAN" },
		],
		eqGroupQualifications: [{ equipmentGroupId: 2, capabilityIds: [20] }],
		eqPortQualificationOverrides: [{ portId: 3, capabilityIds: [10] }],
		storageClasses: [
			{ id: 6, key: "RETICLE" },
			{ id: 5, key: "BUFFER" },
		],
		storagePolicies: [
			{
				id: 8,
				key: "RETICLE_PRIORITY",
				storageClassId: 6,
				priorityRank: 0,
				minimumDwellMilliseconds: 0,
			},
			{
				id: 7,
				key: "BUFFER_STANDARD",
				storageClassId: 5,
				priorityRank: 2,
				minimumDwellMilliseconds: 1_500,
			},
		],
		storageGroups: [
			{
				equipmentGroupId: 3,
				policyId: 8,
				capacityUnits: 40,
				initialOccupiedUnits: 3,
				highWaterMarkUnits: 32,
			},
			{
				equipmentGroupId: 1,
				policyId: 7,
				capacityUnits: 12,
				initialOccupiedUnits: 4,
				highWaterMarkUnits: 10,
			},
		],
	};
}

function reorderedValidInput(): CompileSimulationEquipmentResourceConfigurationInput {
	const input = validInput();
	return {
		...input,
		eqCapabilities: [...input.eqCapabilities].reverse(),
		eqGroupQualifications: [...input.eqGroupQualifications].reverse(),
		eqPortQualificationOverrides: [...input.eqPortQualificationOverrides].reverse(),
		storageClasses: [...input.storageClasses].reverse(),
		storagePolicies: [...input.storagePolicies].reverse(),
		storageGroups: [...input.storageGroups].reverse(),
	};
}

function emptyInput(): CompileSimulationEquipmentResourceConfigurationInput {
	return {
		eqCapabilities: [],
		eqGroupQualifications: [],
		eqPortQualificationOverrides: [],
		storageClasses: [],
		storagePolicies: [],
		storageGroups: [],
	};
}

function mixedSources(): {
	readonly foundation: SimulationStaticWorldFoundation;
	readonly stationCapabilities: SimulationStationOperationalCapabilities;
} {
	const document = buildLongBay();
	const physical = compilePhysicalRail(document.map);
	const state = mixedPortEquipment(physical);
	const foundation = readyFoundation(state, document, physical);
	const stationCapabilities = compileSimulationStationOperationalCapabilities(foundation, [
		{ portId: 5, transferCapability: "BIDIRECTIONAL" },
		{ portId: 3, transferCapability: "DROPOFF_ONLY" },
		{ portId: 1, transferCapability: "BIDIRECTIONAL" },
		{ portId: 4, transferCapability: "PICKUP_ONLY" },
		{ portId: 2, transferCapability: "PICKUP_ONLY" },
	]);
	return { foundation, stationCapabilities };
}

function mixedPortEquipment(physical: CompiledPhysicalLayout): PortEquipmentState {
	const portSpecs = [
		{ id: 1, groupId: 1, type: "OHB" as const, legalIndex: 0 },
		{ id: 2, groupId: 2, type: "EQ" as const, legalIndex: 2 },
		{ id: 3, groupId: 2, type: "EQ" as const, legalIndex: 4 },
		{ id: 4, groupId: 3, type: "STK" as const, legalIndex: 6 },
		{ id: 5, groupId: 3, type: "STK" as const, legalIndex: 8 },
	];
	const ports = portSpecs.map((spec) => {
		const slots = compilePortSlots(physical, emptyPortEquipmentState(), spec.type);
		const legalRows = [...slots.statuses]
			.map((status, row) => ({ row, status }))
			.filter(({ status }) => status === PORT_SLOT_STATUS.LEGAL)
			.map(({ row }) => row);
		const row = legalRows[spec.legalIndex];
		if (row === undefined) throw new Error(`Missing legal ${spec.type} test slot.`);
		return portSlotRecord(slots, row, spec.id, spec.groupId, `${spec.type}-PORT-${spec.id}`);
	});
	return {
		nextPortId: 6,
		nextEquipmentGroupId: 4,
		ports,
		equipmentGroups: [
			{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			{ id: 2, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [2, 3] },
			{ id: 3, kind: "STK", template: "FLEX", portIds: [4, 5] },
		],
	};
}

function readyFoundation(
	portEquipment: PortEquipmentState,
	document: RailDocument = buildLongBay(),
	physical = compilePhysicalRail(document.map),
): SimulationStaticWorldFoundation {
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
