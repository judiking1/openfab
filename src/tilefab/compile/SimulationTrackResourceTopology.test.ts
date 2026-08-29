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
import { compilePortSlots, PORT_SLOT_STATUS, portSlotRecord } from "./PortSlotCompiler";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import {
	compileSimulationStaticWorldFoundation,
	type SimulationStaticWorldFoundation,
} from "./SimulationStaticWorldFoundation";
import {
	checksumSimulationTrackResourceTopology,
	compileSimulationTrackResourceTopology,
	isSimulationTrackResourceTopology,
	SIMULATION_TRACK_RESOURCE_KIND,
	SIMULATION_TRACK_RESOURCE_MAXIMUM_LENGTH_METERS,
	simulationTrackResourceTopologyError,
} from "./SimulationTrackResourceTopology";
import { buildSyntheticFabStarter, defaultSyntheticFabStarterRequest } from "./SyntheticFabStarter";

describe("SimulationTrackResourceTopology", () => {
	it("partitions every directed path without opening the simulation gate", () => {
		const foundation = readyFoundation(buildLongBay(), emptyPortEquipmentState());
		const first = compileSimulationTrackResourceTopology(foundation);
		const second = compileSimulationTrackResourceTopology(foundation);

		expect(first).toMatchObject({
			simulationReady: false,
			sourceFoundationFingerprint: foundation.fingerprint,
			pathCount: foundation.paths.pathCount,
			switchConflictResourceCount: 0,
			movementCount: 0,
		});
		expect(first.trackResourceCount).toBeGreaterThan(0);
		expect([...first.trackResourceKinds]).toEqual(
			expect.arrayContaining([SIMULATION_TRACK_RESOURCE_KIND.UNIQUE_PATH]),
		);
		for (let row = 0; row < first.trackResourceCount; row++) {
			expect(
				(first.trackResourceEnds[row] as number) - (first.trackResourceStarts[row] as number),
			).toBeLessThanOrEqual(SIMULATION_TRACK_RESOURCE_MAXIMUM_LENGTH_METERS + 1e-4);
		}
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.byteLength).toBe(second.byteLength);
		expect(checksumSimulationTrackResourceTopology(first)).toBe(first.fingerprint);
		expect(isSimulationTrackResourceTopology(first)).toBe(true);
	});

	it("aliases shared physical rail and overlays one exclusive resource on every switch movement", () => {
		const foundation = readyFoundation(buildClosedAdvancedSwitchWorld(), emptyPortEquipmentState());
		const topology = compileSimulationTrackResourceTopology(foundation);

		expect(topology.switchConflictResourceCount).toBe(1);
		expect([...topology.switchConflictResourceIds]).toEqual([...foundation.switches.ids]);
		expect(topology.pathLengths.buffer).not.toBe(foundation.paths.lengths.buffer);
		expect(topology.conflictPathRows.buffer).not.toBe(
			foundation.switches.conflictPathIndices.buffer,
		);
		expect(topology.movementCount).toBe(4);
		expect([...topology.movementConflictResourceRows]).toEqual([0, 0, 0, 0]);
		expect([...topology.movementSwitchIds]).toEqual([1, 1, 1, 1]);
		expect([...topology.conflictIntervalOffsets]).toEqual([0, 5]);
		for (let movementRow = 0; movementRow < topology.movementCount; movementRow++) {
			const start = topology.movementConflictIntervalOffsets[movementRow] as number;
			const end = topology.movementConflictIntervalOffsets[movementRow + 1] as number;
			expect(end - start).toBe(3);
		}

		const sharedRows = [...topology.trackResourceKinds]
			.map((kind, row) => ({ kind, row }))
			.filter(({ kind }) => kind === SIMULATION_TRACK_RESOURCE_KIND.SHARED_PHYSICAL)
			.map(({ row }) => row);
		expect(sharedRows.length).toBeGreaterThan(0);
		for (const resourceRow of sharedRows) {
			expect(
				[...topology.pathResourceRows].filter((row) => row === resourceRow).length,
			).toBeGreaterThanOrEqual(2);
		}
		expect(conflictTrackRows(topology, 0)).toEqual(conflictTrackRows(topology, 1));
		expect(conflictTrackRows(topology, 3)).toEqual(conflictTrackRows(topology, 4));
		expect(conflictTrackRows(topology, 2)).toHaveLength(1);
		expect(topology.simulationReady).toBe(false);
	});

	it("uses a resolved station as a deterministic path-resource boundary", () => {
		const document = buildLongBay();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlots(physical, emptyPortEquipmentState(), "OHB");
		const legalRow = [...slots.statuses].indexOf(PORT_SLOT_STATUS.LEGAL);
		expect(legalRow).toBeGreaterThanOrEqual(0);
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [portSlotRecord(slots, legalRow, 1, 1, "OHB-TRACK-BOUNDARY")],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const foundation = readyFoundation(document, state);
		const topology = compileSimulationTrackResourceTopology(foundation);
		const pathRow = foundation.stations.finalPathIndices[0] as number;
		const station = foundation.stations.finalPathStationsMeters[0] as number;
		const start = topology.pathResourceOffsets[pathRow] as number;
		const end = topology.pathResourceOffsets[pathRow + 1] as number;

		expect(
			[
				...topology.pathResourceStarts.slice(start, end),
				...topology.pathResourceEnds.slice(start, end),
			].some((boundary) => Math.abs(boundary - station) <= 1e-4),
		).toBe(true);
	});

	it("fails closed when exact conflict-to-track ownership is corrupted", () => {
		const topology = compileSimulationTrackResourceTopology(
			readyFoundation(buildClosedAdvancedSwitchWorld(), emptyPortEquipmentState()),
		);
		const before = topology.conflictTrackResourceRows[0] as number;
		topology.conflictTrackResourceRows[0] = (before + 1) % topology.trackResourceCount;

		expect(simulationTrackResourceTopologyError(topology)).toMatch(/switch-conflict topology/i);
		topology.conflictTrackResourceRows[0] = before;
		expect(simulationTrackResourceTopologyError(topology)).toBeNull();

		const kindBefore = topology.conflictIntervalKinds[0] as number;
		topology.conflictIntervalKinds[0] = 255;
		expect(simulationTrackResourceTopologyError(topology)).toMatch(/switch-conflict topology/i);
		topology.conflictIntervalKinds[0] = kindBefore;
		expect(simulationTrackResourceTopologyError(topology)).toBeNull();
	});

	it("detects post-publication track-resource mutation through its complete fingerprint", () => {
		const topology = compileSimulationTrackResourceTopology(
			readyFoundation(buildLongBay(), emptyPortEquipmentState()),
		);
		const before = topology.trackResourceSharedSegmentIds[0] as number;
		topology.trackResourceSharedSegmentIds[0] = before + 1;

		expect(simulationTrackResourceTopologyError(topology)).toMatch(/fingerprint/i);
		topology.trackResourceSharedSegmentIds[0] = before;
		expect(simulationTrackResourceTopologyError(topology)).toBeNull();
	});

	it("keeps the public 60-Bay topology in bounded transferable columns", () => {
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

		expect(build.summary.railCells).toBe(9_896);
		expect(topology.pathCount).toBe(build.summary.physicalPaths);
		expect(topology.pathResourceRows.length).toBeGreaterThanOrEqual(topology.pathCount);
		expect(topology.trackResourceCount).toBeLessThanOrEqual(topology.pathResourceRows.length);
		expect(topology.byteLength).toBeLessThan(32 * 1024 * 1024);
		expect(isSimulationTrackResourceTopology(topology)).toBe(true);
		expect(topology.simulationReady).toBe(false);
	});
});

function conflictTrackRows(
	topology: ReturnType<typeof compileSimulationTrackResourceTopology>,
	intervalRow: number,
): number[] {
	const start = topology.conflictTrackResourceOffsets[intervalRow] as number;
	const end = topology.conflictTrackResourceOffsets[intervalRow + 1] as number;
	return [...topology.conflictTrackResourceRows.slice(start, end)];
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
