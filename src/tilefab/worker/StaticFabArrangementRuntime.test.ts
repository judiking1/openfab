import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { compilePortEquipmentPresentation } from "../compile/PortEquipmentPresentation";
import {
	resolveStaticFabSelectionArrangementRoots,
	solveStaticFabArrangementFromRoots,
	staticFabArrangementCommandFromRoots,
} from "../compile/StaticFabArrangementRoots";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction, planRailPath } from "../core/paint";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	type StaticFabArrangementCommandIntent,
	staticFabArrangementCommandFingerprint,
} from "../core/StaticFabArrangementCommand";
import {
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { type Cell, TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot, checksumRailPatchResult } from "./RailMirrorChecksum";
import {
	type PrepareStaticFabArrangementRequest,
	STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
} from "./StaticFabArrangementProtocol";
import {
	initializeStaticFabArrangementRuntimeSession,
	prepareStaticFabArrangementInSession,
	type StaticFabArrangementClock,
} from "./StaticFabArrangementRuntime";

describe("StaticFabArrangementRuntime", () => {
	it("hydrates and compiles one immutable source for repeated option plans", () => {
		const fixture = lineFixture();
		const initialized = initializeStaticFabArrangementRuntimeSession(fixture.snapshot);
		const sourceMap = initialized.session.source.map;
		const sourceRevision = sourceMap.getRevision();
		const sourceSize = sourceMap.size;
		const first = prepareStaticFabArrangementInSession(
			initialized.session,
			sessionRequest(fixture.intent, 31),
		);
		const secondIntent = Object.freeze({ ...fixture.intent, mode: "ALIGN_MAX" as const });
		const second = prepareStaticFabArrangementInSession(
			initialized.session,
			sessionRequest(secondIntent, 32),
		);

		expect(first.prepared.valid, first.prepared.reason).toBe(true);
		expect(second.prepared.valid, second.prepared.reason).toBe(true);
		expect(first.sourcePlanIndex).toBe(1);
		expect(second.sourcePlanIndex).toBe(2);
		expect(initialized.session.source.map).toBe(sourceMap);
		expect(sourceMap.getRevision()).toBe(sourceRevision);
		expect(sourceMap.size).toBe(sourceSize);
		expect(initialized.session.preparedCount).toBe(2);
	});

	it("re-resolves portable roots and returns one exact non-mutating arrangement plan", () => {
		const fixture = lineFixture();
		const sourceRevision = fixture.map.getRevision();
		const sourceSize = fixture.map.size;
		let clock = 0;

		const result = prepareInFreshSession(fixture, 41, () => ++clock);

		expect(result.valid, result.reason).toBe(true);
		expect(result.failureCode).toBeNull();
		expect(result.conflictCells).toEqual([]);
		expect(result.conflictCount).toBe(0);
		expect(result.plan).toMatchObject({
			kind: "arrange-static-fab",
			valid: true,
			baseRevision: fixture.snapshot.revision,
			basePatchSequence: fixture.patchSequence,
			issueCode: null,
			arrangement: { axis: "Z", mode: "ALIGN_MIN", rootCount: 2 },
		});
		expect(result.plan?.mutations.length).toBeGreaterThan(0);
		expect(result.ticket).toMatchObject({
			ticketId: 41,
			validationLevel: "exact",
			sourceRevision: fixture.snapshot.revision,
			sourcePatchSequence: fixture.snapshot.sequence,
			sourceChecksum: fixture.snapshot.checksum,
			intentFingerprint: staticFabArrangementCommandFingerprint(fixture.intent),
		});
		if (!result.plan || !result.ticket) throw new Error("Expected an exact arrangement result.");
		expect(result.ticket.prospectiveChecksum).toBe(
			checksumRailPatchResult(fixture.snapshot.checksum, {
				changes: result.plan.mutations,
				switchChanges: result.plan.switchMutations,
				portChanges: result.plan.portMutations,
				equipmentGroupChanges: result.plan.equipmentGroupMutations,
				organizationChanges: result.plan.organizationMutations,
				organizationNextIdBefore: result.plan.nextOrganizationIdBefore,
				organizationNextIdAfter: result.plan.nextOrganizationIdAfter,
			}),
		);
		expect(result.planningMilliseconds).toBeGreaterThanOrEqual(0);
		expect(result.validationMilliseconds).toBeGreaterThanOrEqual(0);
		expect(fixture.map.getRevision()).toBe(sourceRevision);
		expect(fixture.map.size).toBe(sourceSize);
	});

	it("returns a compact non-committable target-collision rejection", () => {
		const fixture = collisionFixture();

		const result = prepareInFreshSession(fixture, 42);

		expect(result).toMatchObject({
			valid: false,
			failureCode: "plan",
			ticket: null,
			plan: {
				valid: false,
				issueCode: "TARGET_COLLISION",
				arrangement: null,
				mutations: [],
				switchMutations: [],
				portMutations: [],
				organizationMutations: [],
			},
		});
		expect(result.conflictCount).toBeGreaterThan(0);
		expect(result.conflictCells.length).toBeLessThanOrEqual(512);
	});

	it("does not reject an unrelated arrangement solely for pre-existing clearance debt", () => {
		const fixture = clearanceFixture();
		const sourceClearanceIssues = compilePhysicalRail(fixture.map).clearance.issues.count;
		expect(sourceClearanceIssues).toBeGreaterThan(0);

		const result = prepareInFreshSession(fixture, 43);

		expect(result.valid, result.reason).toBe(true);
		expect(result.failureCode).toBeNull();
		expect(result.ticket).not.toBeNull();
		if (!result.plan) throw new Error("Expected a clearance-isolated arrangement plan.");
		const prospective = fixture.map.clone();
		prospective.applyAtomicMutations(result.plan.mutations, result.plan.switchMutations);
		expect(compilePhysicalRail(prospective).clearance.issues.count).toBe(sourceClearanceIssues);
	});

	it("rejects stale root references against the exact Worker snapshot", () => {
		const fixture = lineFixture();
		fixture.map.clearAll();
		fixture.snapshot = captureRailMirrorSnapshot(
			fixture.map,
			fixture.patchSequence,
			fixture.portEquipment,
			fixture.organizations,
		).snapshot;

		const result = prepareInFreshSession(fixture, 44);

		expect(result).toMatchObject({
			valid: false,
			failureCode: "selection",
			plan: null,
			ticket: null,
		});
		expect(result.reason).toMatch(/찾을 수 없습니다|변경/);
	});

	it("uses the same equipment-inclusive root bounds as the UI resolver", () => {
		const fixture = equipmentBoundsFixture();
		const ownership = buildRailModuleOwnershipIndex(fixture.map);
		const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
		const selection = createStaticFabSelection(
			rail,
			fixture.portEquipment,
			fixture.patchSequence,
			[],
		);
		const presentation = compilePortEquipmentPresentation(
			compilePhysicalRail(fixture.map),
			fixture.portEquipment,
		);
		const uiResolution = resolveStaticFabSelectionArrangementRoots(
			fixture.map,
			ownership,
			fixture.portEquipment,
			fixture.patchSequence,
			selection,
			presentation,
		);
		expect(uiResolution.valid, uiResolution.reason).toBe(true);
		if (!uiResolution.valid) return;
		const uiArrangement = solveStaticFabArrangementFromRoots("Z", "ALIGN_MIN", uiResolution.roots);
		expect(uiArrangement.valid, uiArrangement.reason).toBe(true);

		const result = prepareInFreshSession(fixture, 45);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid || !result.plan?.arrangement || !uiArrangement.valid) return;
		expect(result.plan.arrangement.translations).toEqual(uiArrangement.translations);
	});
});

interface ArrangementFixture {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly patchSequence: number;
	readonly intent: StaticFabArrangementCommandIntent;
	snapshot: ReturnType<typeof captureRailMirrorSnapshot>["snapshot"];
}

function lineFixture(): ArrangementFixture {
	const map = new TileMap();
	addLine(map, { x: 0, y: 0 }, { x: 8, y: 0 });
	addLine(map, { x: 20, y: 10 }, { x: 28, y: 10 });
	return fixtureFromSelection(map, () => true);
}

function collisionFixture(): ArrangementFixture {
	const map = new TileMap();
	addLine(map, { x: 0, y: 0 }, { x: 8, y: 0 });
	addLine(map, { x: 20, y: 10 }, { x: 28, y: 10 });
	addLine(map, { x: 20, y: 0 }, { x: 28, y: 0 });
	return fixtureFromSelection(map, (module) =>
		module.footprintCells.some((cell) => (cell.y === 0 && cell.x < 10) || cell.y === 10),
	);
}

function clearanceFixture(): ArrangementFixture {
	const map = new TileMap();
	addPath(map, [
		{ x: 0, y: 0 },
		{ x: 1, y: 0 },
		{ x: 2, y: 0 },
		{ x: 3, y: 0 },
		{ x: 4, y: 0 },
		{ x: 4, y: 1 },
		{ x: 5, y: 1 },
		{ x: 6, y: 1 },
	]);
	const branch = planRailConstruction(map, { x: 3, y: 0 }, { x: 3, y: -3 });
	if (!branch.valid) throw new Error(branch.reason);
	map.applyAtomicMutations(branch.mutations, branch.switchMutations ?? []);
	addLine(map, { x: 100, y: 50 }, { x: 108, y: 50 });
	addLine(map, { x: 120, y: 60 }, { x: 128, y: 60 });
	return fixtureFromSelection(map, (module) => module.footprintCells.some((cell) => cell.x >= 90));
}

function equipmentBoundsFixture(): ArrangementFixture {
	const map = new TileMap();
	addLine(map, { x: 0, y: 0 }, { x: 8, y: 0 });
	addLine(map, { x: 20, y: 10 }, { x: 28, y: 10 });
	const portEquipment: PortEquipmentState = Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([
			Object.freeze({
				id: 1,
				equipmentGroupId: 1,
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: 21,
					z: 10,
					from: DIR_W,
					to: DIR_E,
				}),
				stationMillimeters: 500,
				side: "LEFT" as const,
				lateralOffsetMillimeters: 2_000,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: "OHB-BOUNDARY",
			}),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([1]),
			}),
		]),
	});
	return fixtureFromSelection(map, () => true, portEquipment);
}

function fixtureFromSelection(
	map: TileMap,
	include: (module: RailModuleOwnership) => boolean,
	portEquipment: PortEquipmentState = emptyPortEquipmentState(),
): ArrangementFixture {
	const organizations = emptyStaticFabOrganizationState();
	const patchSequence = 17;
	const ownership = buildRailModuleOwnershipIndex(map);
	const modules = ownership.modules.filter(include);
	const rail = createRailAreaSelectionFromOwnerships(ownership, modules, "fully-contained");
	const selection = createStaticFabSelection(rail, portEquipment, patchSequence, []);
	const resolution = resolveStaticFabSelectionArrangementRoots(
		map,
		ownership,
		portEquipment,
		patchSequence,
		selection,
	);
	if (!resolution.valid) throw new Error(resolution.reason);
	const intent = staticFabArrangementCommandFromRoots("Z", "ALIGN_MIN", resolution.roots);
	const snapshot = captureRailMirrorSnapshot(
		map,
		patchSequence,
		portEquipment,
		organizations,
	).snapshot;
	return { map, portEquipment, organizations, patchSequence, intent, snapshot };
}

function prepareInFreshSession(
	fixture: ArrangementFixture,
	ticketId: number,
	now?: StaticFabArrangementClock,
) {
	const initialized = initializeStaticFabArrangementRuntimeSession(fixture.snapshot, now);
	return prepareStaticFabArrangementInSession(
		initialized.session,
		sessionRequest(fixture.intent, ticketId),
		now,
	).prepared;
}

function sessionRequest(
	intent: ArrangementFixture["intent"],
	ticketId: number,
): PrepareStaticFabArrangementRequest {
	return {
		type: "PREPARE_STATIC_FAB_ARRANGEMENT",
		version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
		sessionId: 1,
		requestId: ticketId,
		ticketId,
		intent,
		expectedIntentFingerprint: staticFabArrangementCommandFingerprint(intent),
	};
}

function addLine(
	map: TileMap,
	start: Cell,
	end: Cell,
	preference: "auto" | "horizontal-first" | "vertical-first" = "auto",
): void {
	const plan = planRailConstruction(new TileMap(), start, end, preference);
	if (!plan.valid) throw new Error(plan.reason);
	map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? []);
}

function addPath(map: TileMap, cells: readonly Cell[]): void {
	const plan = planRailPath(new TileMap(), cells);
	if (!plan.valid) throw new Error(plan.reason);
	map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? []);
}
