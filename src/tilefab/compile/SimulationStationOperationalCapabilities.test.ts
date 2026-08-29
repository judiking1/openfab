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
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { compilePortSlots, PORT_SLOT_STATUS, portSlotRecord } from "./PortSlotCompiler";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import {
	compileSimulationStaticWorldFoundation,
	type SimulationStaticWorldFoundation,
} from "./SimulationStaticWorldFoundation";
import {
	checksumSimulationStationOperationalCapabilities,
	compileSimulationStationOperationalCapabilities,
	isSimulationStationOperationalCapabilities,
	SIMULATION_STATION_TRANSFER_CAPABILITY_CODE,
	simulationStationOperationalCapabilitiesError,
} from "./SimulationStationOperationalCapabilities";

describe("SimulationStationOperationalCapabilities", () => {
	it("compiles explicit pickup/dropoff candidates without reading geometric direction", () => {
		const foundation = foundationWithEqGroup();
		expect(new Set(foundation.stations.geometricDirectionCodes).size).toBe(1);
		const capabilities = compileSimulationStationOperationalCapabilities(foundation, [
			{ portId: 2, transferCapability: "BIDIRECTIONAL" },
			{ portId: 1, transferCapability: "PICKUP_ONLY" },
		]);

		expect(capabilities).toMatchObject({
			simulationReady: false,
			sourceFoundationFingerprint: foundation.fingerprint,
			stationCount: 2,
			equipmentGroupCount: 1,
		});
		expect([...capabilities.portIds]).toEqual([1, 2]);
		expect([...capabilities.transferCapabilityCodes]).toEqual([
			SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.PICKUP_ONLY,
			SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.BIDIRECTIONAL,
		]);
		expect([...capabilities.pickupStationRows]).toEqual([0, 1]);
		expect([...capabilities.dropoffStationRows]).toEqual([1]);
		expect([...capabilities.groupMemberOffsets]).toEqual([0, 2]);
		expect([...capabilities.groupMemberStationRows]).toEqual([1, 0]);
		expect([...capabilities.groupPickupStationRows]).toEqual([1, 0]);
		expect([...capabilities.groupDropoffStationRows]).toEqual([1]);
		expect(capabilities.portIds.buffer).not.toBe(foundation.stations.ids.buffer);
		expect(checksumSimulationStationOperationalCapabilities(capabilities)).toBe(
			capabilities.fingerprint,
		);
		expect(isSimulationStationOperationalCapabilities(capabilities)).toBe(true);
	});

	it("requires one explicit record for every persistent port", () => {
		const foundation = foundationWithEqGroup();

		expect(() =>
			compileSimulationStationOperationalCapabilities(foundation, [
				{ portId: 1, transferCapability: "PICKUP_ONLY" },
			]),
		).toThrow(/every persistent port exactly once/i);
		expect(() =>
			compileSimulationStationOperationalCapabilities(foundation, [
				{ portId: 1, transferCapability: "PICKUP_ONLY" },
				{ portId: 1, transferCapability: "DROPOFF_ONLY" },
			]),
		).toThrow(/repeats port 1/i);
		expect(() =>
			compileSimulationStationOperationalCapabilities(foundation, [
				{ portId: 1, transferCapability: "PICKUP_ONLY" },
				{ portId: 99, transferCapability: "DROPOFF_ONLY" },
			]),
		).toThrow(/missing for port 2/i);
	});

	it("accepts an explicitly empty capability layer for a project with no ports", () => {
		const foundation = readyFoundation(emptyPortEquipmentState());
		const capabilities = compileSimulationStationOperationalCapabilities(foundation, []);

		expect(capabilities.stationCount).toBe(0);
		expect(capabilities.equipmentGroupCount).toBe(0);
		expect(capabilities.pickupStationRows).toHaveLength(0);
		expect(capabilities.dropoffStationRows).toHaveLength(0);
		expect(simulationStationOperationalCapabilitiesError(capabilities)).toBeNull();
		expect(capabilities.simulationReady).toBe(false);
	});

	it("fails closed when a group candidate no longer matches explicit station roles", () => {
		const capabilities = compileSimulationStationOperationalCapabilities(foundationWithEqGroup(), [
			{ portId: 1, transferCapability: "PICKUP_ONLY" },
			{ portId: 2, transferCapability: "DROPOFF_ONLY" },
		]);
		const before = capabilities.groupPickupStationRows[0] as number;
		capabilities.groupPickupStationRows[0] = 1;

		expect(simulationStationOperationalCapabilitiesError(capabilities)).toMatch(
			/equipment-group candidate indexes/i,
		);
		capabilities.groupPickupStationRows[0] = before;
		expect(simulationStationOperationalCapabilitiesError(capabilities)).toBeNull();
	});

	it("detects post-publication capability mutation through its fingerprint", () => {
		const capabilities = compileSimulationStationOperationalCapabilities(foundationWithEqGroup(), [
			{ portId: 1, transferCapability: "BIDIRECTIONAL" },
			{ portId: 2, transferCapability: "BIDIRECTIONAL" },
		]);
		const before = capabilities.groupKindCodes[0] as number;
		capabilities.groupKindCodes[0] = (before + 1) % 3;

		expect(simulationStationOperationalCapabilitiesError(capabilities)).toMatch(/fingerprint/i);
		capabilities.groupKindCodes[0] = before;
		expect(simulationStationOperationalCapabilitiesError(capabilities)).toBeNull();
	});
});

function foundationWithEqGroup(): SimulationStaticWorldFoundation {
	const document = buildLongBay();
	const physical = compilePhysicalRail(document.map);
	const slots = compilePortSlots(physical, emptyPortEquipmentState(), "EQ");
	const legalRows = [...slots.statuses]
		.map((status, row) => ({ row, status }))
		.filter(({ status }) => status === PORT_SLOT_STATUS.LEGAL)
		.slice(0, 2)
		.map(({ row }) => row);
	expect(legalRows).toHaveLength(2);
	const state: PortEquipmentState = {
		nextPortId: 3,
		nextEquipmentGroupId: 2,
		ports: [
			{
				...portSlotRecord(slots, legalRows[0] as number, 1, 1, "EQ-PORT-1"),
				direction: "WITH_TRAVEL",
			},
			{
				...portSlotRecord(slots, legalRows[1] as number, 2, 1, "EQ-PORT-2"),
				direction: "WITH_TRAVEL",
			},
		],
		equipmentGroups: [
			{
				id: 1,
				kind: "EQ",
				pitchMillimeters: 1_000,
				recipe: null,
				portIds: [2, 1],
			},
		],
	};
	return readyFoundation(state, document, physical);
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
