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
import { type CompiledPhysicalLayout, compilePhysicalRail } from "./PhysicalRailCompiler";
import { compilePortSlots, PORT_SLOT_STATUS, portSlotRecord } from "./PortSlotCompiler";
import { createRailProjectReadiness, type RailProjectReadiness } from "./RailProjectReadiness";
import {
	checksumSimulationStaticWorldFoundation,
	compileSimulationStaticWorldFoundation,
	isSimulationStaticWorldFoundation,
	SIMULATION_EQUIPMENT_TEMPLATE_CODE,
	SIMULATION_FOUNDATION_MISSING_LAYERS,
	SIMULATION_STATION_GEOMETRIC_DIRECTION_CODE,
	SIMULATION_STATION_TYPE_CODE,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";

describe("SimulationStaticWorldFoundation", () => {
	it("owns one deterministic static-world input without authorizing simulation", () => {
		const source = readySource(emptyPortEquipmentState());
		const first = compileSimulationStaticWorldFoundation(source);
		const second = compileSimulationStaticWorldFoundation(source);

		expect(first).toMatchObject({
			schemaVersion: 2,
			simulationReady: false,
			missingLayers: SIMULATION_FOUNDATION_MISSING_LAYERS,
			source: {
				patchSequence: source.patchSequence,
				revision: source.physical.revision,
				authoredChecksum: source.authoredChecksum,
				physicalFingerprint: source.physicalFingerprint,
				readinessFingerprint: source.readiness.fingerprint,
			},
		});
		expect(first.paths.pathCount).toBe(source.physical.paths.pathCount);
		expect(first.paths.pointCount).toBe(source.physical.paths.pointCount);
		expect(first.paths.adjacencyOffsets).toHaveLength(first.paths.pathCount + 1);
		expect(first.motionEnvelopes.count).toBe(source.physical.clearance.envelopes.count);
		expect(first.switches.count).toBe(source.physical.advancedSwitches.count);
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.byteLength).toBe(second.byteLength);
		expect(isSimulationStaticWorldFoundation(first)).toBe(true);
		expect(checksumSimulationStaticWorldFoundation(first)).toBe(first.fingerprint);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.source)).toBe(true);
	});

	it("resolves persistent ports and preserves group configuration without inventing capability", () => {
		const document = buildLongBay();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlots(physical, emptyPortEquipmentState(), "OHB");
		const legalRows = [...slots.statuses]
			.map((status, row) => ({ status, row }))
			.filter(({ status }) => status === PORT_SLOT_STATUS.LEGAL)
			.slice(0, 2)
			.map(({ row }) => row);
		expect(legalRows).toHaveLength(2);
		const state: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 3,
			ports: [
				portSlotRecord(slots, legalRows[1] as number, 2, 2, "OHB-002"),
				portSlotRecord(slots, legalRows[0] as number, 1, 1, "OHB-001"),
			],
			equipmentGroups: [
				{ id: 2, kind: "OHB", template: "SINGLE", portIds: [2] },
				{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			],
		};
		const foundation = compileSimulationStaticWorldFoundation(
			readySource(state, document, physical),
		);

		expect([...foundation.stations.ids]).toEqual([1, 2]);
		expect([...foundation.stations.equipmentGroupIds]).toEqual([1, 2]);
		expect([...foundation.stations.typeCodes]).toEqual([
			SIMULATION_STATION_TYPE_CODE.OHB,
			SIMULATION_STATION_TYPE_CODE.OHB,
		]);
		expect([...foundation.stations.geometricDirectionCodes]).toEqual([
			SIMULATION_STATION_GEOMETRIC_DIRECTION_CODE.WITH_TRAVEL,
			SIMULATION_STATION_GEOMETRIC_DIRECTION_CODE.WITH_TRAVEL,
		]);
		expect(foundation.stations.barcodes).toEqual(["OHB-001", "OHB-002"]);
		expect([...foundation.equipmentGroups.ids]).toEqual([1, 2]);
		expect([...foundation.equipmentGroups.portOffsets]).toEqual([0, 1, 2]);
		expect([...foundation.equipmentGroups.portIds]).toEqual([1, 2]);
		expect([...foundation.equipmentGroups.templateCodes]).toEqual([
			SIMULATION_EQUIPMENT_TEMPLATE_CODE.OHB_SINGLE,
			SIMULATION_EQUIPMENT_TEMPLATE_CODE.OHB_SINGLE,
		]);
		expect(foundation.missingLayers).toContain("PORT_OPERATIONAL_CAPABILITIES");
		expect(foundation.simulationReady).toBe(false);
	});

	it("owns buffers independently and detects post-publication corruption", () => {
		const source = readySource(emptyPortEquipmentState());
		const foundation = compileSimulationStaticWorldFoundation(source);

		expect(foundation.paths.positions.buffer).not.toBe(source.physical.paths.positions.buffer);
		expect(foundation.paths.sharedSegmentIds.buffer).not.toBe(
			source.physical.paths.sharedSegmentIds.buffer,
		);
		expect(foundation.switches.ids.buffer).not.toBe(source.physical.advancedSwitches.ids.buffer);
		expect(foundation.motionEnvelopes.bounds.buffer).not.toBe(
			source.physical.clearance.envelopes.bounds.buffer,
		);
		const before = foundation.paths.positions[0] as number;
		foundation.paths.positions[0] = before + 0.25;
		expect(simulationStaticWorldFoundationError(foundation)).toMatch(/fingerprint/i);
		foundation.paths.positions[0] = before;
		expect(simulationStaticWorldFoundationError(foundation)).toBeNull();
	});

	it("carries the canonical switch movement and conflict intervals without re-deriving behavior", () => {
		const document = buildClosedAdvancedSwitchWorld();
		const source = readySource(
			emptyPortEquipmentState(),
			document,
			compilePhysicalRail(document.map),
		);
		const foundation = compileSimulationStaticWorldFoundation(source);

		expect(source.physical.advancedSwitches.count).toBe(1);
		expect(foundation.switches.count).toBe(1);
		expect([...foundation.switches.ids]).toEqual([...source.physical.advancedSwitches.ids]);
		expect([...foundation.switches.movementOffsets]).toEqual([0, 4]);
		expect([...foundation.switches.movementInputIndices]).toEqual([0, 0, 1, 1]);
		expect([...foundation.switches.movementOutputIndices]).toEqual([0, 1, 0, 1]);
		expect(foundation.switches.movementPathIndices.length).toBeGreaterThan(4);
		expect(foundation.switches.movementConflictIntervalIndices.length).toBeGreaterThan(4);
		expect(foundation.switches.conflictPathIndices.length).toBeGreaterThan(0);
		expect(foundation.paths.sharedSegmentCount).toBeGreaterThan(0);
		expect(foundation.paths.sharedSegmentIds.length).toBeGreaterThan(1);
		expect(foundation.paths.sharedOwnerPathRows).toHaveLength(
			foundation.paths.sharedSegmentIds.length,
		);
		const sharedIds = new Set(foundation.paths.sharedSegmentIds);
		expect(sharedIds.size).toBe(foundation.paths.sharedSegmentCount);
		for (const sharedId of sharedIds) {
			const occurrenceRows = [...foundation.paths.sharedSegmentIds]
				.map((id, row) => ({ id, row }))
				.filter(({ id }) => id === sharedId)
				.map(({ row }) => row);
			expect(occurrenceRows.length).toBeGreaterThanOrEqual(2);
			expect(
				new Set(occurrenceRows.map((row) => foundation.paths.sharedOwnerPathRows[row])).size,
			).toBe(1);
		}
		expect(foundation.switches.movementPathStarts).toEqual(
			source.physical.advancedSwitches.movementPathStarts,
		);
		expect(foundation.switches.movementPathStarts.buffer).not.toBe(
			source.physical.advancedSwitches.movementPathStarts.buffer,
		);
		expect(foundation.simulationReady).toBe(false);
	});

	it("rejects inconsistent canonical ownership for a shared physical segment", () => {
		const document = buildClosedAdvancedSwitchWorld();
		const foundation = compileSimulationStaticWorldFoundation(
			readySource(emptyPortEquipmentState(), document, compilePhysicalRail(document.map)),
		);
		const row = foundation.paths.sharedOwnerPathRows.findIndex(
			(ownerPathRow) => ownerPathRow + 1 < foundation.paths.pathCount,
		);
		expect(row).toBeGreaterThanOrEqual(0);
		const before = foundation.paths.sharedOwnerPathRows[row] as number;
		foundation.paths.sharedOwnerPathRows[row] = before + 1;

		expect(simulationStaticWorldFoundationError(foundation)).toMatch(/path graph/i);
		foundation.paths.sharedOwnerPathRows[row] = before;
		expect(simulationStaticWorldFoundationError(foundation)).toBeNull();
	});

	it("fails closed on malformed transferable switch buffer types", () => {
		const foundation = compileSimulationStaticWorldFoundation(
			readySource(emptyPortEquipmentState()),
		);
		const malformed = {
			...foundation,
			switches: { ...foundation.switches, ids: new Uint8Array(foundation.switches.count) },
		};

		expect(simulationStaticWorldFoundationError(malformed)).toMatch(/switch snapshot/i);
	});

	it("rejects a static-readiness identity mismatch", () => {
		const source = readySource(emptyPortEquipmentState());

		expect(() =>
			compileSimulationStaticWorldFoundation({
				...source,
				authoredChecksum: `${source.authoredChecksum}:wrong`,
			}),
		).toThrow(/authored checksum does not match/i);
	});

	it("rejects projects that have not passed the static rail gate", () => {
		const document = new RailDocument();
		const physical = compilePhysicalRail(document.map);
		const state = emptyPortEquipmentState();
		const authoredChecksum = checksumRailMap(document.map, state);
		const readiness = createRailProjectReadiness(
			analyzeRailNetwork(document.map),
			physical,
			authoredChecksum,
		);

		expect(() =>
			compileSimulationStaticWorldFoundation({
				patchSequence: 0,
				authoredChecksum,
				physicalFingerprint: checksumRailPhysicalLayout(physical),
				readiness,
				physical,
				portEquipment: state,
			}),
		).toThrow(/static readiness/i);
	});

	it("rejects a reciprocal but physically unresolvable port attachment", () => {
		const document = buildLongBay();
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlots(physical, emptyPortEquipmentState(), "OHB");
		const row = [...slots.statuses].indexOf(PORT_SLOT_STATUS.LEGAL);
		const validPort = portSlotRecord(slots, row, 1, 1, "OHB-MISSING");
		if (validPort.route.kind !== "CARDINAL_CELL") {
			throw new Error("Expected a cardinal port-slot fixture.");
		}
		const state: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [
				{
					...validPort,
					route: { ...validPort.route, x: 1_000_000 },
				},
			],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};

		expect(() =>
			compileSimulationStaticWorldFoundation(readySource(state, document, physical)),
		).toThrow(/cannot be resolved/i);
	});
});

function readySource(
	portEquipment: PortEquipmentState,
	document: RailDocument = buildLongBay(),
	physical: CompiledPhysicalLayout = compilePhysicalRail(document.map),
): {
	readonly patchSequence: number;
	readonly authoredChecksum: string;
	readonly physicalFingerprint: string;
	readonly readiness: RailProjectReadiness;
	readonly physical: CompiledPhysicalLayout;
	readonly portEquipment: PortEquipmentState;
} {
	const authoredChecksum = checksumRailMap(document.map, portEquipment);
	const readiness = createRailProjectReadiness(
		analyzeRailNetwork(document.map),
		physical,
		authoredChecksum,
	);
	expect(readiness.ready).toBe(true);
	return {
		patchSequence: document.getPatchSequence(),
		authoredChecksum,
		physicalFingerprint: checksumRailPhysicalLayout(physical),
		readiness,
		physical,
		portEquipment,
	};
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
