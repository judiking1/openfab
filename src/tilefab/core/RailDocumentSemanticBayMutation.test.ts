import { beforeAll, describe, expect, it } from "vitest";
import {
	type CertifiedOpenFabFabComposition,
	composeOpenFabFab,
} from "../compile/OpenFabFabComposer";
import { defaultOpenFabFabProfile } from "../compile/OpenFabFabProfile";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "../worker/RailMirrorSnapshotDocument";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import { STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION } from "../worker/StaticFabSemanticBayMutationProtocol";
import { prepareStaticFabSemanticBayMutation } from "../worker/StaticFabSemanticBayMutationRuntime";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import type { PortEquipmentState } from "./EquipmentGroup";
import { planRailPath, type RailConstructionPlan } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "./RailModuleOwnership";
import {
	compareDirectedRailEdges,
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
} from "./StaticFabOrganization";
import {
	STATIC_FAB_SEMANTIC_BAY_DELETE_KIND,
	STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
	STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
	type StaticFabSemanticBayMutationAction,
	type StaticFabSemanticBayMutationIntent,
	type StaticFabSemanticBayMutationPlan,
} from "./StaticFabSemanticBayMutation";
import {
	adoptStaticFabSemanticBayMutationWorkerPlan,
	issueStaticFabSemanticBayMutationPermit,
	staticFabSemanticBayMutationIntentFingerprint,
} from "./StaticFabSemanticBayMutationCertification";
import type { Cell, TileMap } from "./TileMap";

describe("RailDocument semantic Bay mutation", () => {
	let composition: CertifiedOpenFabFabComposition;

	beforeAll(() => {
		composition = composeOpenFabFab(defaultOpenFabFabProfile());
	});

	it.each([
		["DISCONNECT", STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND],
		["DELETE", STATIC_FAB_SEMANTIC_BAY_DELETE_KIND],
	] as const)(
		"commits, mirrors, undoes, and redoes one certified %s atomically",
		(action, expectedKind) => {
			const fixture = certifiedFixture(composition, action);
			const { document, mirror, plan, sourceChecksum, prospectiveChecksum, bayId } = fixture;
			const events: RailPatchEvent[] = [];
			document.subscribe((event) => events.push(event));

			// A semantic plan cannot leak through the generic rail-only command boundary.
			expect(document.commit(plan as unknown as RailConstructionPlan)).toBe(false);
			expect(document.getPatchSequence()).toBe(0);
			expect(document.commitStaticFabSemanticBayMutation(plan)).toBe(true);
			expect(events).toHaveLength(1);
			expect(document.canUndo).toBe(true);
			expect(document.canRedo).toBe(false);
			expect(events[0]).toMatchObject({ sequence: 1, kind: expectedKind });
			expect(eventDeletedOrganizationIds(events[0] as RailPatchEvent)).toEqual(
				plan.review.removedOrganizationIds,
			);
			expect(
				intersection(
					eventDeletedOrganizationIds(events[0] as RailPatchEvent),
					events[0]?.organizationImpactAuthorizations ?? [],
				),
			).toEqual([]);
			expect(mirror.applyPatch(roundTripPatch(events[0] as RailPatchEvent)).checksum).toBe(
				prospectiveChecksum,
			);
			expect(checksumRailMap(document.map, document.portEquipment, document.organizations)).toBe(
				prospectiveChecksum,
			);
			const committedBay = document.organizations.records.find((record) => record.id === bayId);
			if (action === "DISCONNECT") {
				if (!committedBay) throw new Error("Disconnect unexpectedly removed the selected Bay.");
				expect(staticFabOrganizationParentIds(committedBay)).toEqual([]);
			} else {
				expect(committedBay).toBeUndefined();
			}

			expect(document.undo()).toBe(true);
			expect(events).toHaveLength(2);
			expect(document.canUndo).toBe(false);
			expect(document.canRedo).toBe(true);
			expect(events[1]).toMatchObject({ sequence: 2, kind: "undo" });
			expect(
				intersection(
					eventDeletedOrganizationIds(events[1] as RailPatchEvent),
					events[1]?.organizationImpactAuthorizations ?? [],
				),
			).toEqual([]);
			expect(mirror.applyPatch(roundTripPatch(events[1] as RailPatchEvent)).checksum).toBe(
				sourceChecksum,
			);
			expect(document.organizations.records.some((record) => record.id === bayId)).toBe(true);

			expect(document.redo()).toBe(true);
			expect(events).toHaveLength(3);
			expect(document.canUndo).toBe(true);
			expect(document.canRedo).toBe(false);
			expect(events[2]).toMatchObject({ sequence: 3, kind: "redo" });
			expect(
				intersection(
					eventDeletedOrganizationIds(events[2] as RailPatchEvent),
					events[2]?.organizationImpactAuthorizations ?? [],
				),
			).toEqual([]);
			expect(mirror.applyPatch(roundTripPatch(events[2] as RailPatchEvent)).checksum).toBe(
				prospectiveChecksum,
			);
			expect(document.commitStaticFabSemanticBayMutation(plan)).toBe(false);
		},
		30_000,
	);

	it("deletes one Bay-owned advanced switch and its port-equipment dependency through mirror history", () => {
		const fixture = certifiedOwnedDependencyDeleteFixture();
		const {
			document,
			mirror,
			plan,
			sourceChecksum,
			prospectiveChecksum,
			bayId,
			processLoopId,
			retainedOrganizationId,
			switchId,
			portId,
			equipmentGroupId,
			retainedCells,
		} = fixture;
		expect(plan.review).toMatchObject({
			action: "DELETE",
			bayOrganizationId: bayId,
			bankOrganizationId: null,
			removedOrganizationIds: [bayId, processLoopId],
			advancedSwitchCount: 1,
			equipmentGroupCount: 1,
			equipmentGroupIds: [equipmentGroupId],
			portCount: 1,
			portIds: [portId],
		});
		expect(plan.switchMutations).toHaveLength(1);
		expect(plan.switchMutations[0]).toMatchObject({ id: switchId, after: null });
		expect(plan.portMutations).toEqual([
			{ id: portId, before: document.portEquipment.ports[0], after: null },
		]);
		expect(plan.equipmentGroupMutations).toEqual([
			{
				id: equipmentGroupId,
				before: document.portEquipment.equipmentGroups[0],
				after: null,
			},
		]);
		expect(new Set(plan.mutations.map((mutation) => `${mutation.x}:${mutation.y}`))).toHaveLength(
			plan.mutations.length,
		);
		expect(new Set(plan.switchMutations.map((mutation) => mutation.id))).toHaveLength(
			plan.switchMutations.length,
		);
		const retainedRecord = document.organizations.records.find(
			(record) => record.id === retainedOrganizationId,
		);
		if (!retainedRecord) throw new Error("Expected the retained synthetic organization.");
		const retainedDirectedEdgeCount = retainedRecord.membership.railEdges.length;
		const sourceDirectedEdgeCount = document.map.edgeCount;
		// The switch owns 88 internal edges; its four external seams are deleted only because their
		// exact neighboring modules belong to this Bay. The separate retained circuit stays intact.
		expect(sourceDirectedEdgeCount - retainedDirectedEdgeCount).toBe(
			plan.review.bayDirectedEdgeCount + 4,
		);
		const retainedCellKeys = new Set(retainedCells.map((cell) => `${cell.x}:${cell.y}`));
		expect(
			plan.mutations.some((mutation) => retainedCellKeys.has(`${mutation.x}:${mutation.y}`)),
		).toBe(false);

		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		expect(document.commitStaticFabSemanticBayMutation(plan)).toBe(true);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			sequence: 1,
			kind: STATIC_FAB_SEMANTIC_BAY_DELETE_KIND,
			switchChanges: [{ id: switchId, after: null }],
			portChanges: [{ id: portId, after: null }],
			equipmentGroupChanges: [{ id: equipmentGroupId, after: null }],
		});
		expect(mirror.applyPatch(roundTripPatch(events[0] as RailPatchEvent)).checksum).toBe(
			prospectiveChecksum,
		);
		expect(checksumRailMap(document.map, document.portEquipment, document.organizations)).toBe(
			prospectiveChecksum,
		);
		expect(document.map.getAdvancedSwitch(switchId)).toBeUndefined();
		expect(document.map.edgeCount).toBe(retainedDirectedEdgeCount);
		expect(document.portEquipment).toMatchObject({ ports: [], equipmentGroups: [] });
		expect(document.organizations.records.map((record) => record.id)).toEqual([
			retainedOrganizationId,
		]);
		expectRetainedCells(document.map, retainedCells);

		expect(document.undo()).toBe(true);
		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			sequence: 2,
			kind: "undo",
			switchChanges: [{ id: switchId, before: null }],
			portChanges: [{ id: portId, before: null }],
			equipmentGroupChanges: [{ id: equipmentGroupId, before: null }],
		});
		expect(mirror.applyPatch(roundTripPatch(events[1] as RailPatchEvent)).checksum).toBe(
			sourceChecksum,
		);
		expect(checksumRailMap(document.map, document.portEquipment, document.organizations)).toBe(
			sourceChecksum,
		);
		expect(document.map.getAdvancedSwitch(switchId)?.profileClass).toBe("B");
		expect(document.map.edgeCount).toBe(sourceDirectedEdgeCount);
		expect(document.portEquipment.ports.map((port) => port.id)).toEqual([portId]);
		expect(document.portEquipment.equipmentGroups.map((group) => group.id)).toEqual([
			equipmentGroupId,
		]);
		expect(document.organizations.records.map((record) => record.id)).toEqual([
			bayId,
			processLoopId,
			retainedOrganizationId,
		]);
		expectRetainedCells(document.map, retainedCells);

		expect(document.redo()).toBe(true);
		expect(events).toHaveLength(3);
		expect(events[2]).toMatchObject({
			sequence: 3,
			kind: "redo",
			switchChanges: [{ id: switchId, after: null }],
			portChanges: [{ id: portId, after: null }],
			equipmentGroupChanges: [{ id: equipmentGroupId, after: null }],
		});
		expect(mirror.applyPatch(roundTripPatch(events[2] as RailPatchEvent)).checksum).toBe(
			prospectiveChecksum,
		);
		expect(checksumRailMap(document.map, document.portEquipment, document.organizations)).toBe(
			prospectiveChecksum,
		);
		expect(document.map.getAdvancedSwitch(switchId)).toBeUndefined();
		expect(document.map.edgeCount).toBe(retainedDirectedEdgeCount);
		expect(document.portEquipment).toMatchObject({ ports: [], equipmentGroups: [] });
		expect(document.organizations.records.map((record) => record.id)).toEqual([
			retainedOrganizationId,
		]);
		expectRetainedCells(document.map, retainedCells);
	}, 30_000);

	it("rejects deleted-organization authority and action-kind forgery in the mirror without drift", () => {
		const fixture = certifiedFixture(composition, "DELETE");
		const events: RailPatchEvent[] = [];
		fixture.document.subscribe((event) => events.push(event));
		expect(fixture.document.commitStaticFabSemanticBayMutation(fixture.plan)).toBe(true);
		const event = events[0];
		if (!event) throw new Error("Expected one semantic Bay delete event.");
		const deletedIds = eventDeletedOrganizationIds(event);
		const deletedId = deletedIds[0];
		if (!deletedId) throw new Error("Expected the Bay delete event to remove organizations.");

		const forgedAuthority: RailPatchEvent = {
			...event,
			organizationImpactAuthorizations: [
				...(event.organizationImpactAuthorizations ?? []),
				deletedId,
			].sort((left, right) => left - right),
		};
		const authorityMirror = synchronizedMirror(composition);
		const authorityBefore = authorityMirror.state;
		expect(() => authorityMirror.applyPatch(forgedAuthority)).toThrow(
			"cannot carry relocation authority",
		);
		expect(authorityMirror.state).toEqual(authorityBefore);

		const forgedKind: RailPatchEvent = {
			...event,
			kind: STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
		};
		const kindMirror = synchronizedMirror(composition);
		const kindBefore = kindMirror.state;
		expect(() => kindMirror.applyPatch(forgedKind)).toThrow(
			"Bay disconnect must preserve Bay organizations",
		);
		expect(kindMirror.state).toEqual(kindBefore);
	});

	it("rejects a semantic patch that adds rail bits before mutating mirror state", () => {
		const fixture = certifiedFixture(composition, "DISCONNECT");
		const events: RailPatchEvent[] = [];
		fixture.document.subscribe((event) => events.push(event));
		expect(fixture.document.commitStaticFabSemanticBayMutation(fixture.plan)).toBe(true);
		const event = events[0];
		const first = event?.changes[0];
		if (!event || !first) throw new Error("Expected one semantic Bay disconnect rail mutation.");
		const addedBit = firstUnsetByteBit(first.before);
		const forged: RailPatchEvent = {
			...event,
			changes: Object.freeze([
				Object.freeze({ ...first, after: first.before | addedBit }),
				...event.changes.slice(1),
			]),
		};
		const mirror = synchronizedMirror(composition);
		const before = mirror.state;
		expect(() => mirror.applyPatch(forged)).toThrow("may only remove authored rail bits");
		expect(mirror.state).toEqual(before);
	});
});

interface CertifiedFixture {
	readonly document: RailDocument;
	readonly mirror: RailPatchMirror;
	readonly plan: StaticFabSemanticBayMutationPlan;
	readonly sourceChecksum: string;
	readonly prospectiveChecksum: string;
	readonly bayId: number;
}

function certifiedFixture(
	composition: CertifiedOpenFabFabComposition,
	action: StaticFabSemanticBayMutationAction,
): CertifiedFixture {
	const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
	const roles = deriveStaticFabOrganizationSemanticRoles(document.organizations);
	const bay = document.organizations.records.find((record) => roles.get(record.id) === "BAY");
	if (!bay) throw new Error("Expected a runtime-recognized Bay in the default Fab fixture.");
	const capture = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
	);
	const intent: StaticFabSemanticBayMutationIntent = Object.freeze({
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
		action,
		bayOrganizationId: bay.id,
	});
	const permit = issueStaticFabSemanticBayMutationPermit(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
		capture.snapshot.checksum,
	);
	const prepared = prepareStaticFabSemanticBayMutation({
		type: "PREPARE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
		requestId: 1,
		ticketId: permit.ticketId,
		intent,
		expectedIntentFingerprint: staticFabSemanticBayMutationIntentFingerprint(intent),
		snapshot: capture.snapshot,
	});
	if (!prepared.valid || !prepared.plan || !prepared.ticket) {
		throw new Error(`Failed to certify semantic Bay ${action}: ${prepared.reason}`);
	}
	const plan = adoptStaticFabSemanticBayMutationWorkerPlan(
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
	const mirror = new RailPatchMirror();
	mirror.sync(capture.snapshot);
	return Object.freeze({
		document,
		mirror,
		plan,
		sourceChecksum: capture.snapshot.checksum,
		prospectiveChecksum: prepared.ticket.prospectiveChecksum,
		bayId: bay.id,
	});
}

interface RetainedCellSnapshot extends Cell {
	readonly encoded: number;
}

interface CertifiedOwnedDependencyDeleteFixture extends CertifiedFixture {
	readonly processLoopId: number;
	readonly retainedOrganizationId: number;
	readonly switchId: number;
	readonly portId: number;
	readonly equipmentGroupId: number;
	readonly retainedCells: readonly RetainedCellSnapshot[];
}

function certifiedOwnedDependencyDeleteFixture(): CertifiedOwnedDependencyDeleteFixture {
	const authored = new RailDocument();
	commitRailPathThrough(authored, [
		{ x: -5, y: 0 },
		{ x: 0, y: 0 },
	]);
	const switchPlan = planAdvancedSwitch(authored.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "B");
	if (!switchPlan.valid || !authored.commit(switchPlan) || !switchPlan.switchRecord) {
		throw new Error(`Failed to create synthetic Bay switch: ${switchPlan.reason}`);
	}
	commitRailPathThrough(authored, [
		{ x: 6, y: 0 },
		{ x: 11, y: 0 },
		{ x: 11, y: -5 },
		{ x: -5, y: -5 },
		{ x: -5, y: 0 },
	]);
	commitRailPathThrough(authored, [
		{ x: 6, y: 2 },
		{ x: 13, y: 2 },
		{ x: 13, y: 8 },
		{ x: -5, y: 8 },
		{ x: -5, y: 2 },
		{ x: 0, y: 2 },
	]);
	const retainedAuthored = new RailDocument();
	commitRailPathThrough(retainedAuthored, [
		{ x: 40, y: 0 },
		{ x: 60, y: 0 },
		{ x: 60, y: 15 },
		{ x: 40, y: 15 },
		{ x: 40, y: 0 },
	]);
	retainedAuthored.map.forEachRail((x, y, _rail, encoded) => {
		if (!authored.map.setEncoded(x, y, encoded)) {
			throw new Error(`Failed to merge retained synthetic rail cell ${x}:${y}.`);
		}
	});

	const switchId = switchPlan.switchRecord.id;
	const modules = buildRailModuleOwnershipIndex(authored.map).modules;
	const retainedModules = modules.filter((module) =>
		module.footprintCells.every((cell) => cell.x >= 40),
	);
	const bayModules = modules.filter((module) => !retainedModules.includes(module));
	const switchModule = bayModules.find((module) => module.advancedSwitchId === switchId);
	if (!switchModule) throw new Error("Expected one Bay-owned advanced-switch module.");
	const processLoopModules = bayModules.filter((module) => module !== switchModule);
	if (processLoopModules.length === 0 || retainedModules.length === 0) {
		throw new Error("Synthetic organization fixture did not resolve both closed components.");
	}

	const bayId = 1;
	const processLoopId = 2;
	const retainedOrganizationId = 3;
	const portId = 1;
	const equipmentGroupId = 1;
	const portEquipment = Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([
			Object.freeze({
				id: portId,
				equipmentGroupId,
				route: Object.freeze({
					kind: "ADVANCED_SWITCH_SEGMENT" as const,
					switchId,
					profileClass: "B" as const,
					role: "INPUT" as const,
					portIndex: 0 as const,
					segmentOrdinal: 0,
				}),
				stationMillimeters: 500,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: "SYNTHETIC-SWITCH-PORT",
			}),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: equipmentGroupId,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([portId]),
			}),
		]),
	}) satisfies PortEquipmentState;
	const retainedMembership = membershipFromModules(retainedModules, []);
	const organizations = Object.freeze({
		nextOrganizationId: 4,
		records: Object.freeze([
			Object.freeze({
				id: bayId,
				kind: "BAY" as const,
				name: "Synthetic Detached Switch Bay",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "", color: "TEAL" as const }),
				membership: membershipFromModules([switchModule], [equipmentGroupId]),
			}),
			Object.freeze({
				id: processLoopId,
				kind: "AISLE" as const,
				name: "Synthetic Process Loop",
				parentOrganizationIds: Object.freeze([bayId]),
				properties: Object.freeze({ description: "", color: "BLUE" as const }),
				membership: membershipFromModules(processLoopModules, []),
			}),
			Object.freeze({
				id: retainedOrganizationId,
				kind: "AREA" as const,
				name: "Retained Synthetic Circuit",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "", color: "GRAY" as const }),
				membership: retainedMembership,
			}),
		]),
	}) satisfies StaticFabOrganizationState;
	const document = RailDocument.fromLoadedMap(
		authored.map.clone(),
		0,
		portEquipment,
		organizations,
	);
	const retainedCells = captureMembershipCells(document.map, retainedMembership);
	const capture = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
	);
	const intent: StaticFabSemanticBayMutationIntent = Object.freeze({
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_VERSION,
		action: "DELETE",
		bayOrganizationId: bayId,
	});
	const permit = issueStaticFabSemanticBayMutationPermit(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		document.organizations,
		intent,
		capture.snapshot.checksum,
	);
	const prepared = prepareStaticFabSemanticBayMutation({
		type: "PREPARE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
		version: STATIC_FAB_SEMANTIC_BAY_MUTATION_PROTOCOL_VERSION,
		requestId: 1,
		ticketId: permit.ticketId,
		intent,
		expectedIntentFingerprint: staticFabSemanticBayMutationIntentFingerprint(intent),
		snapshot: capture.snapshot,
	});
	if (!prepared.valid || !prepared.plan || !prepared.ticket) {
		throw new Error(`Failed to certify switch-owning semantic Bay Delete: ${prepared.reason}`);
	}
	const plan = adoptStaticFabSemanticBayMutationWorkerPlan(
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
	const mirror = new RailPatchMirror();
	mirror.sync(capture.snapshot);
	return Object.freeze({
		document,
		mirror,
		plan,
		sourceChecksum: capture.snapshot.checksum,
		prospectiveChecksum: prepared.ticket.prospectiveChecksum,
		bayId,
		processLoopId,
		retainedOrganizationId,
		switchId,
		portId,
		equipmentGroupId,
		retainedCells,
	});
}

function commitRailPathThrough(document: RailDocument, waypoints: readonly Cell[]): void {
	const plan = planRailPath(document.map, expandOrthogonalWaypoints(waypoints));
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Failed to create synthetic closed rail: ${plan.reason}`);
	}
}

function expandOrthogonalWaypoints(waypoints: readonly Cell[]): readonly Cell[] {
	const first = waypoints[0];
	if (!first) throw new Error("Synthetic rail path requires at least one waypoint.");
	const cells: Cell[] = [Object.freeze({ ...first })];
	for (let index = 1; index < waypoints.length; index += 1) {
		const from = waypoints[index - 1] as Cell;
		const to = waypoints[index] as Cell;
		if (from.x !== to.x && from.y !== to.y) {
			throw new Error("Synthetic rail waypoints must be orthogonal.");
		}
		const stepX = Math.sign(to.x - from.x);
		const stepY = Math.sign(to.y - from.y);
		let x = from.x;
		let y = from.y;
		while (x !== to.x || y !== to.y) {
			x += stepX;
			y += stepY;
			cells.push(Object.freeze({ x, y }));
		}
	}
	return Object.freeze(cells);
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
	equipmentGroupIds: readonly number[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) edges.set(staticFabOrganizationEdgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([...equipmentGroupIds].sort((left, right) => left - right)),
	});
}

function captureMembershipCells(
	map: TileMap,
	membership: StaticFabOrganizationMembership,
): readonly RetainedCellSnapshot[] {
	const cells = new Map<string, Cell>();
	for (const edge of membership.railEdges) {
		cells.set(`${edge.from.x}:${edge.from.y}`, edge.from);
		cells.set(`${edge.to.x}:${edge.to.y}`, edge.to);
	}
	return Object.freeze(
		[...cells.values()]
			.sort((left, right) => left.y - right.y || left.x - right.x)
			.map((cell) => Object.freeze({ ...cell, encoded: map.getEncoded(cell.x, cell.y) })),
	);
}

function expectRetainedCells(map: TileMap, expected: readonly RetainedCellSnapshot[]): void {
	for (const cell of expected) expect(map.getEncoded(cell.x, cell.y)).toBe(cell.encoded);
}

function synchronizedMirror(composition: CertifiedOpenFabFabComposition): RailPatchMirror {
	const document = hydrateRailMirrorSnapshotDocument(composition.roundTrippedSnapshot);
	const snapshot = captureRailMirrorSnapshot(
		document.map,
		document.getPatchSequence(),
		document.portEquipment,
		document.organizations,
	).snapshot;
	const mirror = new RailPatchMirror();
	mirror.sync(snapshot);
	return mirror;
}

function roundTripPatch(event: RailPatchEvent): RailPatchEvent {
	return decodeRailPatchSoA(encodeRailPatchEvent(event).patch);
}

function eventDeletedOrganizationIds(event: RailPatchEvent): number[] {
	return event.organizationChanges
		.filter((change) => change.before !== null && change.after === null)
		.map((change) => change.id)
		.sort((left, right) => left - right);
}

function intersection(left: readonly number[], right: readonly number[]): number[] {
	const rightSet = new Set(right);
	return left.filter((value) => rightSet.has(value));
}

function firstUnsetByteBit(value: number): number {
	for (let bit = 1; bit <= 0x80; bit <<= 1) {
		if ((value & bit) === 0) return bit;
	}
	throw new Error("Expected an encoded rail cell with at least one unset bit.");
}
