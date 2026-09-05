import { beforeAll, describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import {
	type ProductionBayBuildStepOwner,
	type ProductionBayModulePlan,
	planProductionBayModule,
} from "../core/ProductionBayModulePlanner";
import type { RailPatchEvent } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { planRailRouteBatch } from "../core/RailTemplateCatalog";
import { DIR_E, directionBetween, oppositeDirection } from "../core/railShape";
import {
	planStaticFabBayFlowEditWithProspectiveState,
	STATIC_FAB_BAY_FLOW_EDIT_KIND,
	STATIC_FAB_BAY_FLOW_EDIT_VERSION,
} from "../core/StaticFabBayFlowEdit";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "../core/StaticFabOrganization";
import { decodeRailCell, encodeRailCell, TileMap } from "../core/TileMap";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import { RailPatchMirror } from "./RailPatchMirror";

describe("RailPatchMirror Bay flow edit authorization", () => {
	let fixture: BayFlowEditFixture;

	beforeAll(() => {
		fixture = bayFlowEditFixture();
	});

	it("accepts the exact existing-ID Bay subtree replacement and its undo/redo patches", () => {
		const mirror = synchronizedMirror(fixture.snapshot);
		expect(fixture.event.organizationImpactAuthorizations?.length).toBeGreaterThan(0);

		expect(mirror.applyPatch(fixture.event).checksum).toBe(fixture.prospectiveChecksum);
		const undo = reverseEvent(fixture.event, "undo", 2, fixture.event.revision);
		expect(mirror.applyPatch(undo).checksum).toBe(fixture.snapshot.checksum);
		const redo = reverseEvent(undo, "redo", 3, undo.revision);
		expect(mirror.applyPatch(redo).checksum).toBe(fixture.prospectiveChecksum);
	});

	it("derives undo/redo authorization from its exact mirrored history ledger", () => {
		const mirror = synchronizedMirror(fixture.snapshot);
		mirror.applyPatch(fixture.event);
		const exactUndo = reverseEvent(fixture.event, "undo", 2, fixture.event.revision);
		const missingOrigin = { ...exactUndo } as RailPatchEvent & {
			historyOriginKind?: RailPatchEvent["historyOriginKind"];
		};
		delete missingOrigin.historyOriginKind;
		expect(() => mirror.applyPatch(missingOrigin)).toThrow("must carry a canonical history origin");

		const forgedOrigin: RailPatchEvent = { ...exactUndo, historyOriginKind: "edit" };
		expect(() => mirror.applyPatch(forgedOrigin)).toThrow("history origin mismatch");

		const forgedDelta: RailPatchEvent = {
			...exactUndo,
			changes: exactUndo.changes.map((change, index) =>
				index === 0 ? { ...change, after: change.after ^ 1 } : change,
			),
		};
		expect(() => mirror.applyPatch(forgedDelta)).toThrow(
			"does not exactly match its mirrored history transition",
		);
		const forgedMembership: RailPatchEvent = {
			...exactUndo,
			organizationChanges: exactUndo.organizationChanges.map((change, index) =>
				index === 0 && change.after
					? {
							...change,
							after: {
								...change.after,
								membership: {
									...change.after.membership,
									railEdges: change.after.membership.railEdges.slice(1),
								},
							},
						}
					: change,
			),
		};
		expect(() => mirror.applyPatch(forgedMembership)).toThrow(
			"does not exactly match its mirrored history transition",
		);

		const forgedCursor: RailPatchEvent = {
			...exactUndo,
			organizationNextIdAfter: exactUndo.organizationNextIdAfter + 1,
		};
		expect(() => mirror.applyPatch(forgedCursor)).toThrow(
			"cannot change the monotonic organization ID cursor",
		);
	});

	it("rejects unknown authored kinds and history origin fields on non-history patches", () => {
		const unknownKind = { ...fixture.event, kind: "forged-kind" } as unknown as RailPatchEvent;
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(unknownKind)).toThrow(
			"not a canonical history origin kind",
		);
		const forgedOrigin: RailPatchEvent = {
			...fixture.event,
			historyOriginKind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(forgedOrigin)).toThrow(
			"Only undo/redo patches may carry a history origin kind",
		);
	});

	it("requires nonempty rail and organization changes", () => {
		const noRail: RailPatchEvent = {
			...fixture.event,
			revision: fixture.event.baseRevision,
			changes: [],
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(noRail)).toThrow(
			"must change both authored rail and organizations",
		);
		const noOrganizations: RailPatchEvent = {
			...fixture.event,
			organizationChanges: [],
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(noOrganizations)).toThrow(
			"must change both authored rail and organizations",
		);
	});

	it.each([
		"switchChanges",
		"portChanges",
		"equipmentGroupChanges",
	] as const)("rejects %s in the dedicated flow-edit patch", (field) => {
		const forged = {
			...fixture.event,
			[field]: [{} as never],
		} as RailPatchEvent;
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(forged)).toThrow(
			"cannot change switches, ports, or equipment groups",
		);
	});

	it("preserves the organization cursor and updates existing records only", () => {
		const movedCursor: RailPatchEvent = {
			...fixture.event,
			organizationNextIdAfter: fixture.event.organizationNextIdAfter + 1,
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(movedCursor)).toThrow(
			"cannot change the organization ID cursor",
		);

		const first = requiredFirstOrganizationChange(fixture.event);
		const deleted: RailPatchEvent = {
			...fixture.event,
			organizationChanges: fixture.event.organizationChanges.map((change, index) =>
				index === 0 ? { ...change, after: null } : change,
			),
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(deleted)).toThrow(
			"existing organization records only",
		);

		const created: RailPatchEvent = {
			...fixture.event,
			organizationChanges: fixture.event.organizationChanges.map((change, index) =>
				index === 0 ? { ...change, before: null, after: first.after } : change,
			),
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(created)).toThrow(
			"existing organization records only",
		);
	});

	it.each([
		["record id", (record: StaticFabOrganizationRecord) => ({ ...record, id: record.id + 1_000 })],
		[
			"kind",
			(record: StaticFabOrganizationRecord) => ({
				...record,
				kind: record.kind === "BAY" ? ("AISLE" as const) : ("BAY" as const),
			}),
		],
		[
			"name",
			(record: StaticFabOrganizationRecord) => ({ ...record, name: `${record.name} forged` }),
		],
		[
			"parents",
			(record: StaticFabOrganizationRecord) => ({
				...record,
				parentOrganizationIds: [...staticFabOrganizationParentIds(record), 999],
			}),
		],
		[
			"properties",
			(record: StaticFabOrganizationRecord) => ({
				...record,
				properties: { ...staticFabOrganizationProperties(record), color: "ROSE" as const },
			}),
		],
		[
			"advanced-switch membership",
			(record: StaticFabOrganizationRecord) => ({
				...record,
				membership: { ...record.membership, advancedSwitchIds: [999] },
			}),
		],
		[
			"equipment membership",
			(record: StaticFabOrganizationRecord) => ({
				...record,
				membership: { ...record.membership, equipmentGroupIds: [999] },
			}),
		],
	] as const)("rejects changed organization %s", (_label, mutate) => {
		const forged = mutateFirstOrganizationAfter(fixture.event, mutate);
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(forged)).toThrow(
			/identity|hierarchy|metadata|sidecar/,
		);
	});

	it("requires every organization mutation to change rail membership", () => {
		const first = requiredFirstOrganizationChange(fixture.event);
		if (!first.before || !first.after) throw new Error("Expected an existing record mutation.");
		const forged = mutateFirstOrganizationAfter(fixture.event, (record) => ({
			...record,
			membership: first.before?.membership as StaticFabOrganizationMembership,
		}));
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(forged)).toThrow(
			"must change rail membership",
		);
	});

	it("rejects organization membership changes outside the selected Bay subtree", () => {
		const external = fixture.organizations.records.find(
			(record) => record.id === fixture.externalOrganizationId,
		);
		if (!external || external.membership.railEdges.length < 2) {
			throw new Error("Expected an external organization fixture.");
		}
		const forged: RailPatchEvent = {
			...fixture.event,
			organizationChanges: [
				...fixture.event.organizationChanges,
				{
					id: external.id,
					before: external,
					after: {
						...external,
						membership: {
							...external.membership,
							railEdges: external.membership.railEdges.slice(1),
						},
					},
				},
			].sort((left, right) => left.id - right.id),
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(forged)).toThrow(
			"one unambiguous semantic Bay subtree",
		);
	});

	it("rejects relocation authority outside the changed Bay subtree", () => {
		const forged: RailPatchEvent = {
			...fixture.event,
			organizationImpactAuthorizations: [
				...(fixture.event.organizationImpactAuthorizations ?? []),
				fixture.externalOrganizationId,
			].sort((left, right) => left - right),
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(forged)).toThrow(
			"is outside its changed Bay subtree",
		);
	});

	it("requires the exact subtree membership-union directed-edge delta", () => {
		const forgedEdge = Object.freeze({
			from: Object.freeze({ x: 50_000, y: 50_000 }),
			to: Object.freeze({ x: 50_001, y: 50_000 }),
		});
		const forged = mutateFirstOrganizationAfter(fixture.event, (record) => ({
			...record,
			membership: {
				...record.membership,
				railEdges: [...record.membership.railEdges, forgedEdge].sort(compareDirectedRailEdges),
			},
		}));
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(forged)).toThrow(
			"must exactly match its Bay subtree membership-union delta",
		);
	});

	it("rejects a changed directed edge owned outside the selected Bay subtree", () => {
		const externalRemoval = removeDirectedEdgeMutations(fixture.map, fixture.externalEdge);
		const forged: RailPatchEvent = {
			...fixture.event,
			revision: fixture.event.revision + externalRemoval.length,
			changes: [...fixture.event.changes, ...externalRemoval],
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(forged)).toThrow(
			"changes external directed edge",
		);
	});

	it("keeps canonical relocation-authority and sequence guards active", () => {
		const organizationId = fixture.event.organizationImpactAuthorizations?.[0];
		if (!organizationId) throw new Error("Expected Bay flow relocation authority.");
		const duplicateAuthority: RailPatchEvent = {
			...fixture.event,
			organizationImpactAuthorizations: [organizationId, organizationId],
		};
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(duplicateAuthority)).toThrow(
			"organization relocation authority is not canonical",
		);

		const sequenceGap: RailPatchEvent = { ...fixture.event, sequence: 2 };
		expect(() => synchronizedMirror(fixture.snapshot).applyPatch(sequenceGap)).toThrow(
			"Rail patch sequence gap",
		);
	});
});

interface BayFlowEditFixture {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly snapshot: RailMirrorSnapshot;
	readonly event: RailPatchEvent;
	readonly prospectiveChecksum: string;
	readonly externalOrganizationId: number;
	readonly externalEdge: DirectedRailEdge;
}

function bayFlowEditFixture(): BayFlowEditFixture {
	const sourcePlan = planProductionBayModule({
		anchor: { x: -17, y: 23 },
		outerLengthMeters: 40,
		outerDepthMeters: 22,
		shellMarginMeters: 3,
		processLoopGapMeters: 4,
		gatewayLengthMeters: 6,
		processLoopCount: 2,
		internalFlowPattern: "alternating",
		pose: { forward: DIR_E, side: "right", flow: "forward" },
	});
	const map = materializePlan(sourcePlan);
	const modulesByOwner = semanticModulesByOwner(map, sourcePlan);
	const bayOrganizationId = 10;
	const processLoopAId = 11;
	const processLoopBId = 12;
	const externalOrganizationId = 20;
	const bayRecords: StaticFabOrganizationRecord[] = [
		organizationRecord(
			bayOrganizationId,
			"BAY",
			"Fixture Bay",
			[],
			modulesByOwner.get("BAY") ?? [],
		),
		organizationRecord(
			processLoopAId,
			"AISLE",
			"Fixture Process Loop A",
			[bayOrganizationId],
			modulesByOwner.get("process-loop-a") ?? [],
		),
		organizationRecord(
			processLoopBId,
			"AISLE",
			"Fixture Process Loop B",
			[bayOrganizationId],
			modulesByOwner.get("process-loop-b") ?? [],
		),
	];

	const externalPlan = planProductionBayModule({
		...sourcePlan.specification,
		anchor: { x: 1_000, y: 1_000 },
	});
	const externalBuild = planRailRouteBatch(
		map,
		[externalPlan.outerLoop.cells],
		"free-closed-primary",
	);
	if (!externalBuild.valid) throw new Error(externalBuild.reason);
	for (const mutation of externalBuild.mutations) {
		map.setEncoded(mutation.x, mutation.y, mutation.after);
	}
	const externalModules = buildRailModuleOwnershipIndex(map).modules.filter((module) =>
		module.eraseEdges.every((edge) => edge.from.x > 500 && edge.to.x > 500),
	);
	const externalRecord = organizationRecord(
		externalOrganizationId,
		"AREA",
		"External Fixture Area",
		[],
		externalModules,
	);
	const externalEdge = externalRecord.membership.railEdges[0];
	if (!externalEdge) throw new Error("Expected an external directed edge.");
	const organizations = Object.freeze({
		nextOrganizationId: 21,
		records: Object.freeze([...bayRecords, externalRecord]),
	}) satisfies StaticFabOrganizationState;
	const portEquipment = emptyPortEquipmentState();
	const snapshot = captureRailMirrorSnapshot(map, 0, portEquipment, organizations).snapshot;
	const planned = planStaticFabBayFlowEditWithProspectiveState(
		map,
		portEquipment,
		0,
		organizations,
		{
			version: STATIC_FAB_BAY_FLOW_EDIT_VERSION,
			bayOrganizationId,
			targetInternalFlowPattern: "co-rotating",
		},
	);
	if (!planned.plan.valid || !planned.prospectiveState) throw new Error(planned.plan.reason);
	const plan = planned.plan;
	const event = Object.freeze({
		sequence: 1,
		kind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
		baseRevision: plan.baseRevision,
		revision: plan.baseRevision + plan.mutations.length,
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
	}) satisfies RailPatchEvent;
	return Object.freeze({
		map,
		portEquipment,
		organizations,
		snapshot,
		event,
		prospectiveChecksum: checksumRailMap(
			planned.prospectiveState.map,
			planned.prospectiveState.portEquipment,
			planned.prospectiveState.organizations,
		),
		externalOrganizationId,
		externalEdge,
	});
}

function materializePlan(plan: ProductionBayModulePlan): TileMap {
	const map = new TileMap();
	const construction = planRailRouteBatch(map, plan.buildRoutes, "free-closed-primary");
	if (!construction.valid) throw new Error(construction.reason);
	for (const mutation of construction.mutations) {
		map.setEncoded(mutation.x, mutation.y, mutation.after);
	}
	return map;
}

function semanticModulesByOwner(
	map: TileMap,
	plan: ProductionBayModulePlan,
): ReadonlyMap<ProductionBayBuildStepOwner, readonly RailModuleOwnership[]> {
	const semanticOwnerByEdge = new Map<string, ProductionBayBuildStepOwner>();
	for (const step of plan.buildSteps) {
		for (let index = 0; index < step.route.length - 1; index += 1) {
			const from = step.route[index];
			const to = step.route[index + 1];
			if (!from || !to) throw new Error(`Malformed fixture step ${step.id}.`);
			semanticOwnerByEdge.set(staticFabOrganizationEdgeKey({ from, to }), step.owner);
		}
	}
	const modulesByOwner = new Map<ProductionBayBuildStepOwner, RailModuleOwnership[]>();
	for (const module of buildRailModuleOwnershipIndex(map).modules) {
		const owners = new Set<ProductionBayBuildStepOwner>();
		for (const edge of module.eraseEdges) {
			const owner = semanticOwnerByEdge.get(staticFabOrganizationEdgeKey(edge));
			if (!owner) throw new Error(`Fixture module ${module.key} contains an unowned edge.`);
			owners.add(owner);
		}
		const owner = owners.has("BAY")
			? "BAY"
			: owners.size === 1
				? ([...owners][0] as ProductionBayBuildStepOwner)
				: null;
		if (!owner) throw new Error(`Fixture module ${module.key} crosses Process Loop owners.`);
		const owned = modulesByOwner.get(owner) ?? [];
		owned.push(module);
		modulesByOwner.set(owner, owned);
	}
	return modulesByOwner;
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	parentOrganizationIds: readonly number[],
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		membership: membershipFromModules(modules),
	});
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationMembership {
	const railEdges = new Map<string, DirectedRailEdge>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) railEdges.set(staticFabOrganizationEdgeKey(edge), edge);
	}
	return Object.freeze({
		railEdges: Object.freeze([...railEdges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([]),
	});
}

function mutateFirstOrganizationAfter(
	event: RailPatchEvent,
	mutate: (record: StaticFabOrganizationRecord) => StaticFabOrganizationRecord,
): RailPatchEvent {
	return {
		...event,
		organizationChanges: event.organizationChanges.map((change, index) =>
			index === 0 && change.after ? { ...change, after: mutate(change.after) } : change,
		),
	};
}

function requiredFirstOrganizationChange(event: RailPatchEvent) {
	const first = event.organizationChanges[0];
	if (!first) throw new Error("Expected one Bay flow organization mutation.");
	return first;
}

function removeDirectedEdgeMutations(map: TileMap, edge: DirectedRailEdge) {
	const direction = directionBetween(edge.from, edge.to);
	if (direction === null) throw new Error("External fixture edge is not adjacent.");
	const opposite = oppositeDirection(direction);
	const fromBefore = map.getEncoded(edge.from.x, edge.from.y);
	const toBefore = map.getEncoded(edge.to.x, edge.to.y);
	const from = decodeRailCell(fromBefore);
	const to = decodeRailCell(toBefore);
	return [
		{
			x: edge.from.x,
			y: edge.from.y,
			before: fromBefore,
			after: encodeRailCell({ ...from, outgoing: from.outgoing & ~direction }),
		},
		{
			x: edge.to.x,
			y: edge.to.y,
			before: toBefore,
			after: encodeRailCell({ ...to, incoming: to.incoming & ~opposite }),
		},
	] as const;
}

function reverseEvent(
	event: RailPatchEvent,
	kind: "undo" | "redo",
	sequence: number,
	baseRevision: number,
): RailPatchEvent {
	return Object.freeze({
		sequence,
		kind,
		baseRevision,
		revision: baseRevision + event.changes.length + event.switchChanges.length,
		changes: event.changes.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		})),
		switchChanges: event.switchChanges.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		})),
		portChanges: event.portChanges.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		})),
		equipmentGroupChanges: event.equipmentGroupChanges.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		})),
		organizationChanges: event.organizationChanges.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		})),
		organizationNextIdBefore: event.organizationNextIdAfter,
		organizationNextIdAfter: event.organizationNextIdBefore,
		relationshipChanges: event.relationshipChanges.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		})),
		relationshipNextIdBefore: event.relationshipNextIdAfter,
		relationshipNextIdAfter: event.relationshipNextIdBefore,
		organizationImpactAuthorizations: event.organizationImpactAuthorizations,
		historyOriginKind: STATIC_FAB_BAY_FLOW_EDIT_KIND,
	});
}

function synchronizedMirror(snapshot: RailMirrorSnapshot): RailPatchMirror {
	const mirror = new RailPatchMirror();
	mirror.sync(snapshot);
	return mirror;
}
