import { describe, expect, it } from "vitest";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import { STATIC_FAB_ARRANGEMENT_SESSION_VERSION } from "../worker/StaticFabArrangementProtocol";
import {
	initializeStaticFabArrangementRuntimeSession,
	prepareStaticFabArrangementInSession,
} from "../worker/StaticFabArrangementRuntime";
import type { PortEquipmentState } from "./EquipmentGroup";
import { planRailConstruction } from "./paint";
import type { RailPatchEvent } from "./RailDocument";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex, type RailModuleOwnership } from "./RailModuleOwnership";
import { DIR_E, DIR_W } from "./railShape";
import { STATIC_FAB_ARRANGEMENT_VERSION } from "./StaticFabArrangement";
import {
	adoptStaticFabArrangementWorkerPlan,
	issueStaticFabArrangementPermit,
} from "./StaticFabArrangementCertification";
import {
	STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
	type StaticFabArrangementCommandIntent,
	staticFabArrangementCommandFingerprint,
} from "./StaticFabArrangementCommand";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import { TileMap } from "./TileMap";

describe("RailDocument static FAB arrangement", () => {
	it("commits, mirrors, undoes, and redoes a certified existing-ID relocation atomically", () => {
		const sourceMap = twoDisjointLines();
		const ownership = buildRailModuleOwnershipIndex(sourceMap);
		const components = ownershipComponents(ownership.modules);
		const equipment = oneOhbState(21, 10);
		const organizations = organizationState(components[1] as readonly RailModuleOwnership[]);
		const document = RailDocument.fromLoadedMap(sourceMap, 0, equipment, organizations);
		const intent = arrangementIntent(components);
		const capture = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		);
		const mirror = new RailPatchMirror();
		mirror.sync(capture.snapshot);
		const permit = issueStaticFabArrangementPermit(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			intent,
			capture.snapshot.checksum,
		);
		const arrangementSession = initializeStaticFabArrangementRuntimeSession(
			capture.snapshot,
		).session;
		const prepared = prepareStaticFabArrangementInSession(arrangementSession, {
			type: "PREPARE_STATIC_FAB_ARRANGEMENT",
			version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
			sessionId: 1,
			requestId: 1,
			ticketId: permit.ticketId,
			intent,
			expectedIntentFingerprint: staticFabArrangementCommandFingerprint(intent),
		}).prepared;
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid || !prepared.plan || !prepared.ticket) return;
		const certified = adoptStaticFabArrangementWorkerPlan(
			permit,
			prepared.ticket,
			prepared.plan,
			prepared.ticket.prospectiveChecksum,
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			intent,
		);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));

		expect(document.commitStaticFabArrangement(certified)).toBe(true);
		expect(document.getPatchSequence()).toBe(1);
		expect(document.portEquipment.ports[0]).toMatchObject({
			id: 1,
			equipmentGroupId: 1,
			barcode: "OHB-STABLE",
			route: { kind: "CARDINAL_CELL", x: 21, z: 0 },
		});
		expect(document.portEquipment.equipmentGroups[0]).toMatchObject({ id: 1, portIds: [1] });
		expect(
			document.organizations.records[0]?.membership.railEdges.every(
				(edge) => edge.from.y === 0 && edge.to.y === 0,
			),
		).toBe(true);
		expect(events[0]).toMatchObject({
			kind: "arrange-static-fab",
			organizationImpactAuthorizations: [1],
		});
		const arrangedPatch = roundTripPatch(events[0] as RailPatchEvent);
		expect(arrangedPatch.organizationImpactAuthorizations).toEqual([1]);
		expect(mirror.applyPatch(arrangedPatch).checksum).toBe(
			checksumRailMap(document.map, document.portEquipment, document.organizations),
		);

		expect(document.undo()).toBe(true);
		expect(document.portEquipment.ports[0]).toMatchObject({
			route: { kind: "CARDINAL_CELL", x: 21, z: 10 },
		});
		expect(events[1]).toMatchObject({ kind: "undo", organizationImpactAuthorizations: [1] });
		expect(mirror.applyPatch(roundTripPatch(events[1] as RailPatchEvent)).checksum).toBe(
			checksumRailMap(document.map, document.portEquipment, document.organizations),
		);

		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports[0]).toMatchObject({
			route: { kind: "CARDINAL_CELL", x: 21, z: 0 },
		});
		expect(events[2]).toMatchObject({ kind: "redo", organizationImpactAuthorizations: [1] });
		expect(mirror.applyPatch(roundTripPatch(events[2] as RailPatchEvent)).checksum).toBe(
			checksumRailMap(document.map, document.portEquipment, document.organizations),
		);
	});
});

function roundTripPatch(event: RailPatchEvent): RailPatchEvent {
	return decodeRailPatchSoA(encodeRailPatchEvent(event).patch);
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
	if (!first.valid || !second.valid) throw new Error("failed to build arrangement fixture");
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
