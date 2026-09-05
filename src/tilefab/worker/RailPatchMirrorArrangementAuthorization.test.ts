import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import type { RailPatchEvent } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { DIR_E, DIR_W } from "../core/railShape";
import { STATIC_FAB_ARRANGEMENT_VERSION } from "../core/StaticFabArrangement";
import {
	STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
	type StaticFabArrangementCommandIntent,
	staticFabArrangementCommandFingerprint,
} from "../core/StaticFabArrangementCommand";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot, type RailMirrorSnapshot } from "./RailMirrorChecksum";
import { RailPatchMirror } from "./RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "./railMirrorProtocol";
import { STATIC_FAB_ARRANGEMENT_SESSION_VERSION } from "./StaticFabArrangementProtocol";
import {
	initializeStaticFabArrangementRuntimeSession,
	prepareStaticFabArrangementInSession,
} from "./StaticFabArrangementRuntime";

describe("RailPatchMirror arrangement organization authorization", () => {
	it("rejects relocation authority on a non-arrangement history kind", () => {
		const fixture = exactRelocationFixture();
		const mirror = synchronizedMirror(fixture.snapshot);
		const forged: RailPatchEvent = { ...fixture.event, kind: "edit" };

		expect(() => mirror.applyPatch(forged)).toThrow(
			"cannot carry organization relocation authority",
		);
		expect(mirror.state).toMatchObject({ sequence: 0, checksum: fixture.snapshot.checksum });
	});

	it.each([
		["duplicate", [1, 1]],
		["descending", [2, 1]],
		["zero", [0]],
		["fractional", [1.5]],
		["signed-int32 overflow", [0x8000_0000]],
	] as const)("rejects %s relocation authority IDs in the mirror", (_label, ids) => {
		const fixture = exactRelocationFixture();
		const mirror = synchronizedMirror(fixture.snapshot);
		const forged: RailPatchEvent = {
			...fixture.event,
			organizationImpactAuthorizations: ids,
		};

		expect(() => mirror.applyPatch(forged)).toThrow(
			"organization relocation authority is not canonical",
		);
		expect(mirror.state).toMatchObject({ sequence: 0, checksum: fixture.snapshot.checksum });
	});

	it.each([
		["duplicate", [1, 1]],
		["descending", [2, 1]],
		["non-positive", [0]],
	] as const)("rejects %s relocation authority IDs at the SoA boundary", (_label, ids) => {
		const fixture = exactRelocationFixture();
		const event: RailPatchEvent = {
			...fixture.event,
			organizationImpactAuthorizations: ids,
		};

		expect(() => encodeRailPatchEvent(event)).toThrow(
			/organization authorization|unique and ascending/,
		);

		const encoded = encodeRailPatchEvent(fixture.event).patch;
		encoded.organizationImpactAuthorizations = new Int32Array(ids);
		expect(() => decodeRailPatchSoA(encoded)).toThrow(
			/organization authorization|unique and ascending/,
		);
	});

	it("rejects an authorized organization ID that the relocation does not affect", () => {
		const fixture = exactRelocationFixture();
		const mirror = synchronizedMirror(fixture.snapshot);
		const before = mirror.state;
		const forged: RailPatchEvent = {
			...fixture.event,
			organizationImpactAuthorizations: [2],
		};

		expect(() => mirror.applyPatch(forged)).toThrow(
			"Organization relocation authorization 2 does not match this patch",
		);
		expect(mirror.state).toEqual(before);
		expect(mirror.applyPatch(fixture.event).checksum).toBe(fixture.prospectiveChecksum);
	});

	it("does not let exact relocation authority bypass rail before-state checks", () => {
		const fixture = exactRelocationFixture();
		const mirror = synchronizedMirror(fixture.snapshot);
		const before = mirror.state;
		const first = fixture.event.changes[0];
		if (!first) throw new Error("Expected the relocation fixture to contain rail mutations.");
		const forgedBefore = firstByteOtherThan(first.before, first.after);
		const forged: RailPatchEvent = {
			...fixture.event,
			changes: fixture.event.changes.map((change, index) =>
				index === 0 ? { ...change, before: forgedBefore } : change,
			),
		};

		expect(() => mirror.applyPatch(forged)).toThrow("before-value mismatch");
		expect(mirror.state).toEqual(before);
		expect(mirror.applyPatch(fixture.event).checksum).toBe(fixture.prospectiveChecksum);
	});

	it("rolls checksum and physical publication back when exact relocation compilation fails", () => {
		const fixture = exactRelocationFixture();
		const mirror = new RailPatchMirror((map, revision) => {
			if (revision === fixture.event.revision) {
				throw new Error("Injected arrangement physical compile failure");
			}
			return compilePhysicalRail(map, revision);
		});
		mirror.sync(fixture.snapshot);
		const beforeState = mirror.state;
		const beforePhysical = mirror.getPhysicalPublication();

		expect(() => mirror.applyPatch(fixture.event)).toThrow(
			"Injected arrangement physical compile failure",
		);
		expect(mirror.state).toEqual(beforeState);
		expect(mirror.state.checksum).toBe(fixture.snapshot.checksum);
		expect(mirror.getPhysicalPublication()).toBe(beforePhysical);
	});
});

interface ExactRelocationFixture {
	readonly snapshot: RailMirrorSnapshot;
	readonly event: RailPatchEvent;
	readonly prospectiveChecksum: string;
}

function exactRelocationFixture(): ExactRelocationFixture {
	const sourceMap = twoDisjointLines();
	const ownership = buildRailModuleOwnershipIndex(sourceMap);
	const components = ownershipComponents(ownership.modules);
	const movingModules = components[1];
	if (!movingModules) throw new Error("Expected a second arrangement component.");
	const equipment = oneOhbState(21, 10);
	const organizations = organizationState(movingModules);
	const capture = captureRailMirrorSnapshot(sourceMap, 0, equipment, organizations);
	const intent = arrangementIntent(components);
	const session = initializeStaticFabArrangementRuntimeSession(capture.snapshot).session;
	const prepared = prepareStaticFabArrangementInSession(session, {
		type: "PREPARE_STATIC_FAB_ARRANGEMENT",
		version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
		sessionId: 1,
		requestId: 1,
		ticketId: 1,
		intent,
		expectedIntentFingerprint: staticFabArrangementCommandFingerprint(intent),
	}).prepared;
	if (!prepared.valid || !prepared.plan || !prepared.ticket) {
		throw new Error(`Failed to prepare exact relocation fixture: ${prepared.reason}`);
	}
	const plan = prepared.plan;
	return {
		snapshot: capture.snapshot,
		prospectiveChecksum: prepared.ticket.prospectiveChecksum,
		event: Object.freeze({
			sequence: capture.snapshot.sequence + 1,
			kind: plan.kind,
			baseRevision: plan.baseRevision,
			revision: plan.baseRevision + plan.mutations.length + plan.switchMutations.length,
			changes: plan.mutations,
			switchChanges: plan.switchMutations,
			portChanges: plan.portMutations,
			equipmentGroupChanges: plan.equipmentGroupMutations,
			organizationChanges: plan.organizationMutations,
			organizationNextIdBefore: plan.nextOrganizationIdBefore,
			organizationNextIdAfter: plan.nextOrganizationIdAfter,
			relationshipChanges: [],
			relationshipNextIdBefore: 1,
			relationshipNextIdAfter: 1,
			organizationImpactAuthorizations: plan.organizationImpactAuthorizations,
		}),
	};
}

function synchronizedMirror(snapshot: RailMirrorSnapshot): RailPatchMirror {
	const mirror = new RailPatchMirror();
	mirror.sync(snapshot);
	return mirror;
}

function firstByteOtherThan(first: number, second: number): number {
	for (let candidate = 0; candidate <= 0xff; candidate++) {
		if (candidate !== first && candidate !== second) return candidate;
	}
	throw new Error("Unable to find a distinct byte.");
}

function arrangementIntent(
	components: readonly (readonly RailModuleOwnership[])[],
): StaticFabArrangementCommandIntent {
	return Object.freeze({
		version: STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
		arrangementVersion: STATIC_FAB_ARRANGEMENT_VERSION,
		axis: "Z",
		mode: "ALIGN_MIN",
		roots: Object.freeze(
			components.map((component) =>
				Object.freeze({
					kind: "STATIC_COMPONENT" as const,
					moduleKeys: Object.freeze(component.map((module) => module.key).sort()),
				}),
			),
		),
	});
}

function twoDisjointLines(): TileMap {
	const map = new TileMap();
	const first = planRailConstruction(new TileMap(), { x: 0, y: 0 }, { x: 8, y: 0 });
	const second = planRailConstruction(new TileMap(), { x: 20, y: 10 }, { x: 28, y: 10 });
	if (!first.valid || !second.valid) throw new Error("Failed to build arrangement fixture.");
	map.applyAtomicMutations([...first.mutations, ...second.mutations], []);
	return map;
}

function ownershipComponents(
	modules: readonly RailModuleOwnership[],
): readonly (readonly RailModuleOwnership[])[] {
	return [
		modules.filter((module) => module.footprintCells.some((cell) => cell.y === 0)),
		modules.filter((module) => module.footprintCells.some((cell) => cell.y === 10)),
	];
}

function oneOhbState(x: number, z: number): PortEquipmentState {
	return Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([
			Object.freeze({
				id: 1,
				equipmentGroupId: 1,
				route: Object.freeze({ kind: "CARDINAL_CELL" as const, x, z, from: DIR_W, to: DIR_E }),
				stationMillimeters: 500,
				side: "LEFT" as const,
				lateralOffsetMillimeters: 1_000,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: "OHB-STABLE",
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
}

function organizationState(modules: readonly RailModuleOwnership[]): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId: 2,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "BAY" as const,
				name: "Bay B",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "", color: "TEAL" as const }),
				membership: membership(modules),
			}),
		]),
	});
}

function membership(modules: readonly RailModuleOwnership[]): StaticFabOrganizationMembership {
	const edges = new Map<string, RailModuleOwnership["eraseEdges"][number]>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) {
			edges.set(`${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`, edge);
		}
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([1]),
	});
}
