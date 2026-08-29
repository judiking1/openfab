import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { compilePortSlots, PORT_SLOT_STATUS, portSlotRecord } from "../compile/PortSlotCompiler";
import { compileSimulationEquipmentResourceConfiguration } from "../compile/SimulationEquipmentResourceConfiguration";
import {
	buildSimulationReadinessTestFoundation,
	simulationReadinessTestVehicleProfile,
} from "../compile/SimulationReadinessTestFixture";
import { compileSimulationResidentCycleAdmissionProgram } from "../compile/SimulationResidentCycleAdmissionProgram";
import { compileSimulationResidentCycleLeaseClaims } from "../compile/SimulationResidentCycleLeaseClaims";
import { compileSimulationResidentCycleResourceRunConfiguration } from "../compile/SimulationResidentCycleResourceRunConfiguration";
import { compileSimulationResidentCycleRoutes } from "../compile/SimulationResidentCycleRoutes";
import { compileSimulationResidentCycleServiceTiming } from "../compile/SimulationResidentCycleServiceTiming";
import { compileSimulationResidentFleetParkingConfiguration } from "../compile/SimulationResidentFleetParkingConfiguration";
import { publishSimulationResidentReadinessSnapshot } from "../compile/SimulationResidentReadinessCertificate";
import {
	consumeSimulationResidentRunAuthorization,
	type IssueSimulationResidentRunAuthorizationInput,
	issueSimulationResidentRunAuthorization,
} from "../compile/SimulationResidentRunAuthorization";
import { compileSimulationResidentTransferPlanManifest } from "../compile/SimulationResidentScenarioManifest";
import { compileSimulationStationOperationalCapabilities } from "../compile/SimulationStationOperationalCapabilities";
import { compileSimulationTrackOccupancyPolicy } from "../compile/SimulationTrackOccupancyPolicy";
import { compileSimulationTrackResourceTopology } from "../compile/SimulationTrackResourceTopology";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
} from "../compile/SyntheticFabStarter";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import {
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import {
	adoptDeterministicResidentRuntimeState,
	type DeterministicResidentRuntimeState,
} from "./DeterministicResidentRuntimeState";

describe("DeterministicResidentRuntimeState public contention", () => {
	it("atomically hands one shared complete-cycle bundle between two reviewed homes", async () => {
		const sources = await buildPublicContentionSources();
		expect(sources.parking.vehicleIds).toEqual([
			"PUBLIC-RESIDENT-OHT-ALPHA",
			"PUBLIC-RESIDENT-OHT-BETA",
		]);
		expect([...sources.parking.anchorPortIds]).toEqual([6, 7]);
		expect([...sources.routes.homePortIds]).toEqual([6, 7]);
		const firstClaims = claimRows(sources.leaseClaims, 0);
		const secondClaims = claimRows(sources.leaseClaims, 1);
		const sharedClaims = firstClaims.filter((row) => secondClaims.includes(row));
		expect(sharedClaims.length).toBeGreaterThan(1_000);

		const { runtime, input } = await adoptRuntime(sources);
		expect(runtime.advanceSimulationToTimeMicroseconds(0)).toBe(1);
		expect(runtime.requestState(0).phase).toBe("TO_PICKUP");
		expect(runtime.requestState(1).phase).toBe("WAITING_COMPLETE_CYCLE_LEASE");
		expect(runtime.vehicleState(0).phase).toBe("TO_PICKUP");
		expect(runtime.vehicleState(1).phase).toBe("WAITING_FOR_COMPLETE_CYCLE");
		expect(runtime.runtimeSummary()).toMatchObject({
			requestWaitingCompleteCycleLeaseCount: 1,
			vehicleWaitingForCompleteCycleCount: 1,
			vehicleMovingCount: 1,
		});
		for (const row of firstClaims) expect(runtime.trackResourceOwnerVehicleRow(row)).toBe(0);
		for (const row of secondClaims) {
			expect(runtime.trackResourceOwnerVehicleRow(row)).not.toBe(1);
		}

		const firstHomeReturn = cycleDuration(input, 0);
		expect(runtime.advanceSimulationToTimeMicroseconds(firstHomeReturn)).toBe(1);
		expect(runtime.requestState(0).phase).toBe("COMPLETED");
		expect(runtime.requestState(1).phase).toBe("TO_PICKUP");
		expect(runtime.vehicleState(0).phase).toBe("IDLE_AT_HOME");
		expect(runtime.vehicleState(1).phase).toBe("TO_PICKUP");
		for (const row of secondClaims) expect(runtime.trackResourceOwnerVehicleRow(row)).toBe(1);
		for (const row of firstClaims) {
			expect(runtime.trackResourceOwnerVehicleRow(row)).not.toBe(0);
		}

		const terminalTime = firstHomeReturn + cycleDuration(input, 1);
		runtime.advanceSimulationToTimeMicroseconds(terminalTime);
		expect(runtime.requestState(1).phase).toBe("COMPLETED");
		expect(runtime.vehicleState(0)).toMatchObject({ phase: "IDLE_AT_HOME", homePortId: 6 });
		expect(runtime.vehicleState(1)).toMatchObject({ phase: "IDLE_AT_HOME", homePortId: 7 });
		expect(runtime.runtimeSummary()).toMatchObject({
			requestCompletedCount: 2,
			vehicleIdleAtHomeCount: 2,
			vehicleMovingCount: 0,
			nonHomeOwnedTrackResourceCount: 0,
			ownedSwitchConflictResourceCount: 0,
			storageOccupiedUnits: 2,
			storageReservedUnits: 0,
		});
	}, 60_000);
});

async function buildPublicContentionSources() {
	const { components, portIds } = buildPublicComponents();
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: 3,
			residentHomeSlots: [
				{
					id: 1,
					vehicleId: "PUBLIC-RESIDENT-OHT-ALPHA",
					anchorPortId: portIds.homeA,
					policy: "DEDICATED_HOME_RETURN",
				},
				{
					id: 2,
					vehicleId: "PUBLIC-RESIDENT-OHT-BETA",
					anchorPortId: portIds.homeB,
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
		manifestId: "OPENFAB-PUBLIC-RESIDENT-CONTENTION",
		adapterId: "OPENFAB_RESIDENT_NORMALIZED_INPUT_V1",
		adapterVersion: 1,
		mappingVersion: 1,
		inputRecordCount: 2,
		rejectedRecordCount: 0,
		rejectionIssues: [],
		issuesTruncated: false,
		records: [
			{
				transferId: "PUBLIC-RESIDENT-ALPHA-CYCLE",
				sourceOrdinal: 0,
				releaseTimeMicroseconds: 0,
				loadId: "PUBLIC-RESIDENT-LOAD-ALPHA",
				vehicleId: "PUBLIC-RESIDENT-OHT-ALPHA",
				sourcePortId: portIds.source,
				destinationPortId: portIds.destination,
			},
			{
				transferId: "PUBLIC-RESIDENT-BETA-CYCLE",
				sourceOrdinal: 1,
				releaseTimeMicroseconds: 0,
				loadId: "PUBLIC-RESIDENT-LOAD-BETA",
				vehicleId: "PUBLIC-RESIDENT-OHT-BETA",
				sourcePortId: portIds.source,
				destinationPortId: portIds.destination,
			},
		],
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
		{ eqProcessTimings: [] },
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
		{
			eqResources: [],
			initialStorageLoads: [
				{ loadId: "PUBLIC-RESIDENT-LOAD-ALPHA", equipmentGroupId: 1 },
				{ loadId: "PUBLIC-RESIDENT-LOAD-BETA", equipmentGroupId: 1 },
			],
		},
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

async function adoptRuntime(
	sources: Awaited<ReturnType<typeof buildPublicContentionSources>>,
): Promise<{
	readonly runtime: DeterministicResidentRuntimeState;
	readonly input: IssueSimulationResidentRunAuthorizationInput;
}> {
	const snapshot = await publishSimulationResidentReadinessSnapshot(sources);
	const input: IssueSimulationResidentRunAuthorizationInput = {
		projectId: "OPENFAB-PUBLIC-RESIDENT-CONTENTION",
		preparationGeneration: 1,
		authorizationGeneration: 1,
		runAssetFingerprint: "openfab-public-resident-contention-run-asset",
		snapshot,
	};
	const grant = await issueSimulationResidentRunAuthorization(input);
	const runtime = await consumeSimulationResidentRunAuthorization(
		grant,
		input,
		(authorization, exactSnapshot, adoption) =>
			adoptDeterministicResidentRuntimeState(authorization, exactSnapshot, adoption),
	);
	if (!runtime) throw new Error("Expected public resident contention runtime adoption.");
	return { runtime, input };
}

function claimRows(
	claims: ReturnType<typeof compileSimulationResidentCycleLeaseClaims>,
	requestRow: number,
): number[] {
	return [
		...claims.nonHomeTrackResourceRows.subarray(
			claims.nonHomeTrackResourceOffsets[requestRow] as number,
			claims.nonHomeTrackResourceOffsets[requestRow + 1] as number,
		),
	];
}

function cycleDuration(input: IssueSimulationResidentRunAuthorizationInput, requestRow: number) {
	const speed = input.snapshot.occupancyPolicy.maximumSpeedMillimetersPerSecond;
	let total = 0;
	for (let legIndex = 0; legIndex < 3; legIndex++) {
		const distance = input.snapshot.routes.legDistancesMeters[requestRow * 3 + legIndex] as number;
		total += Math.ceil((Math.ceil(distance * 1_000_000) * 1_000) / speed);
	}
	return total;
}

function buildPublicComponents() {
	const document = buildSyntheticFabStarter(
		defaultSyntheticFabStarterRequest("parallel-hall-fab-12"),
	).document;
	const physical = compilePhysicalRail(document.map);
	let state = emptyPortEquipmentState();
	const ohbSlots = compilePortSlots(physical, state, "OHB");
	const ohbRows = legalRows(ohbSlots);
	const firstOhbRow = ohbRows[Math.floor(ohbRows.length * 0.25)] as number;
	const first = point(ohbSlots, firstOhbRow);
	const secondOhbRow = ohbRows.reduce((best, row) => {
		const current = point(ohbSlots, row);
		return distanceSquared(current, first) > distanceSquared(point(ohbSlots, best), first)
			? row
			: best;
	}, ohbRows[0] as number);
	state = {
		nextPortId: 3,
		nextEquipmentGroupId: 3,
		ports: [
			portSlotRecord(ohbSlots, firstOhbRow, 1, 1, "PUBLIC-OHB-1"),
			portSlotRecord(ohbSlots, secondOhbRow, 2, 2, "PUBLIC-OHB-2"),
		],
		equipmentGroups: [
			{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			{ id: 2, kind: "OHB", template: "SINGLE", portIds: [2] },
		],
	};
	const eqSlots = compilePortSlots(physical, state, "EQ");
	const run = straightRuns(eqSlots)[0];
	if (!run) throw new Error("No public EQ run.");
	const start = Math.floor((run.length - 3) / 2);
	const eqRows = run.slice(start, start + 3);
	state = {
		nextPortId: 6,
		nextEquipmentGroupId: 4,
		ports: [
			...state.ports,
			...eqRows.map((row, index) =>
				portSlotRecord(eqSlots, row, 3 + index, 3, `PUBLIC-EQ-${index + 1}`),
			),
		],
		equipmentGroups: [
			...state.equipmentGroups,
			{ id: 3, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [3, 4, 5] },
		],
	};
	const stkSlots = compilePortSlots(physical, state, "STK");
	const stkRows = separatedPerpendicularPair(stkSlots);
	state = {
		nextPortId: 8,
		nextEquipmentGroupId: 5,
		ports: [
			...state.ports,
			...stkRows.map((row, index) =>
				portSlotRecord(stkSlots, row, 6 + index, 4, `PUBLIC-STK-${index + 1}`),
			),
		],
		equipmentGroups: [
			...state.equipmentGroups,
			{ id: 4, kind: "STK", template: "FLEX", portIds: [6, 7] },
		],
	};
	const foundation = buildSimulationReadinessTestFoundation(document, state);
	const trackResources = compileSimulationTrackResourceTopology(foundation);
	const stationCapabilities = compileSimulationStationOperationalCapabilities(
		foundation,
		[...foundation.stations.ids].map((portId) => ({
			portId,
			transferCapability: "BIDIRECTIONAL" as const,
		})),
	);
	const equipmentResources = compileSimulationEquipmentResourceConfiguration(
		foundation,
		stationCapabilities,
		{
			eqCapabilities: [{ id: 1, key: "PUBLIC_PROCESS" }],
			eqGroupQualifications: [{ equipmentGroupId: 3, capabilityIds: [1] }],
			eqPortQualificationOverrides: [],
			storageClasses: [{ id: 1, key: "PUBLIC_BUFFER" }],
			storagePolicies: [
				{
					id: 1,
					key: "PUBLIC_FIFO",
					storageClassId: 1,
					priorityRank: 0,
					minimumDwellMilliseconds: 0,
				},
			],
			storageGroups: [
				{
					equipmentGroupId: 1,
					policyId: 1,
					capacityUnits: 4,
					initialOccupiedUnits: 2,
					highWaterMarkUnits: 3,
				},
				{
					equipmentGroupId: 2,
					policyId: 1,
					capacityUnits: 4,
					initialOccupiedUnits: 0,
					highWaterMarkUnits: 3,
				},
				{
					equipmentGroupId: 4,
					policyId: 1,
					capacityUnits: 4,
					initialOccupiedUnits: 0,
					highWaterMarkUnits: 3,
				},
			],
		},
	);
	const occupancyPolicy = compileSimulationTrackOccupancyPolicy(
		foundation,
		trackResources,
		simulationReadinessTestVehicleProfile(),
	);
	return {
		components: Object.freeze({
			foundation,
			trackResources,
			stationCapabilities,
			equipmentResources,
			occupancyPolicy,
		}),
		portIds: { source: 1, destination: 2, homeA: 6, homeB: 7 },
	};
}

type Slots = ReturnType<typeof compilePortSlots>;

function legalRows(slots: Slots): number[] {
	return [...slots.statuses].flatMap((status, row) =>
		status === PORT_SLOT_STATUS.LEGAL ? [row] : [],
	);
}

function point(slots: Slots, row: number) {
	return {
		x: slots.worldPositions[row * 2] as number,
		y: slots.worldPositions[row * 2 + 1] as number,
	};
}

function distanceSquared(left: { x: number; y: number }, right: { x: number; y: number }) {
	return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function straightRuns(slots: Slots): number[][] {
	const lines = new Map<string, { row: number; moving: number }[]>();
	for (const row of legalRows(slots)) {
		const { x, y } = point(slots, row);
		const tangentX = slots.tangents[row * 2] as number;
		const tangentY = slots.tangents[row * 2 + 1] as number;
		const orientation = Math.abs(tangentX) > 0.9 ? "H" : Math.abs(tangentY) > 0.9 ? "V" : null;
		if (!orientation) continue;
		const moving = orientation === "H" ? x : y;
		const fixed = orientation === "H" ? y : x;
		const sign = orientation === "H" ? Math.sign(tangentX) : Math.sign(tangentY);
		const key = `${orientation}:${Math.round(fixed * 1_000)}:${sign}`;
		const line = lines.get(key) ?? [];
		line.push({ row, moving });
		lines.set(key, line);
	}
	const runs: number[][] = [];
	for (const line of lines.values()) {
		line.sort((left, right) => left.moving - right.moving);
		let run: { row: number; moving: number }[] = [];
		for (const item of line) {
			if (run.length > 0 && Math.abs(item.moving - (run.at(-1)?.moving ?? 0) - 1) > 0.01) {
				if (run.length >= 3) runs.push(run.map(({ row }) => row));
				run = [];
			}
			run.push(item);
		}
		if (run.length >= 3) runs.push(run.map(({ row }) => row));
	}
	return runs.sort((left, right) => right.length - left.length);
}

function separatedPerpendicularPair(slots: Slots): [number, number] {
	const candidates = legalRows(slots).flatMap((row) => {
		const tangentX = slots.tangents[row * 2] as number;
		const tangentY = slots.tangents[row * 2 + 1] as number;
		const orientation = Math.abs(tangentX) > 0.9 ? "H" : Math.abs(tangentY) > 0.9 ? "V" : null;
		return orientation ? [{ row, orientation, ...point(slots, row) }] : [];
	});
	let selected: { horizontal: number; vertical: number; distance: number } | null = null;
	for (const horizontal of candidates) {
		if (horizontal.orientation !== "H") continue;
		for (const vertical of candidates) {
			if (vertical.orientation !== "V") continue;
			const distance = Math.sqrt(distanceSquared(horizontal, vertical));
			if (distance < 120 || (selected && distance >= selected.distance)) continue;
			selected = { horizontal: horizontal.row, vertical: vertical.row, distance };
		}
	}
	if (!selected) throw new Error("No public STK pair.");
	return [selected.horizontal, selected.vertical];
}
