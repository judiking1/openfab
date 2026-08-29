import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import type { PortEquipmentState } from "./EquipmentGroup";
import { planRailConstruction } from "./paint";
import {
	createRailAreaSelection,
	createRailAreaSelectionFromOwnerships,
} from "./RailAreaSelection";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "./RailTemplateCatalog";
import type { Direction } from "./railShape";
import {
	applyStaticFabOrganizationMutations,
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
	isCanonicalStaticFabOrganizationState,
	replaceStaticFabOrganizationRecordMembership,
	resolveStaticFabOrganizationCoverage,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationStateError,
	staticFabOrganizationStateShapeError,
} from "./StaticFabOrganization";
import {
	planAssignStaticFabOrganizationFromSelection,
	planCreateStaticFabOrganizationFromSelection,
	planRemoveStaticFabOrganization,
	planRenameStaticFabOrganization,
	planUpdateStaticFabOrganizationDetails,
	staticFabOrganizationAssignmentSourcesForSelection,
	staticFabOrganizationConflictsForSelection,
} from "./StaticFabOrganizationPlan";
import { resolveStaticFabOrganizationSelection } from "./StaticFabOrganizationSelection";
import { createStaticFabSelection } from "./StaticFabSelection";

describe("StaticFabOrganization", () => {
	it("derives Process Loop, Bay, Bay Bank, and Fab roles only from the persisted DAG", () => {
		const membership = Object.freeze({
			railEdges: Object.freeze([]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		});
		const state = {
			nextOrganizationId: 7,
			records: [
				{ id: 1, kind: "AREA" as const, name: "Root", membership },
				{
					id: 2,
					kind: "AREA" as const,
					name: "Section",
					parentOrganizationIds: [1],
					membership,
				},
				{
					id: 3,
					kind: "BAY" as const,
					name: "Unit",
					parentOrganizationIds: [2],
					membership,
				},
				{
					id: 4,
					kind: "AISLE" as const,
					name: "Path A",
					parentOrganizationIds: [3],
					membership,
				},
				{
					id: 5,
					kind: "AISLE" as const,
					name: "Path B",
					parentOrganizationIds: [3],
					membership,
				},
				{ id: 6, kind: "AREA" as const, name: "Unrelated", membership },
			],
		};

		expect([...deriveStaticFabOrganizationSemanticRoles(state).entries()]).toEqual([
			[4, "PROCESS_LOOP"],
			[5, "PROCESS_LOOP"],
			[3, "BAY"],
			[2, "BAY_BANK"],
			[1, "FAB"],
		]);
	});

	it("persists a multi-parent DAG and properties while deriving inherited coverage", () => {
		const document = longBayDocument();
		const create = (name: string, kind: "AREA" | "BAY" | "PROCESS_FAMILY") => {
			const ownership = buildRailModuleOwnershipIndex(document.map);
			const plan = planCreateStaticFabOrganizationFromSelection(
				document.map,
				ownership,
				document.portEquipment,
				document.getPatchSequence(),
				document.organizations,
				wholeSelection(document),
				name,
				kind,
			);
			expect(plan.valid, plan.reason).toBe(true);
			expect(document.commitOrganization(plan)).toBe(true);
			return plan.organizationMutations[0]?.after?.id as number;
		};
		const areaId = create("North Area", "AREA");
		const processId = create("Photo Process", "PROCESS_FAMILY");
		const bayId = create("Photo Bay", "BAY");
		const membershipBefore = document.organizations.records.find(
			(record) => record.id === bayId,
		)?.membership;
		const update = planUpdateStaticFabOrganizationDetails(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			bayId,
			{
				parentOrganizationIds: [areaId, processId].sort((a, b) => a - b),
				description: "Lithography production Bay",
				color: "VIOLET",
			},
		);
		expect(update.valid, update.reason).toBe(true);
		expect(document.commitOrganization(update)).toBe(true);
		const bay = document.organizations.records.find((record) => record.id === bayId);
		expect(bay?.membership).toBe(membershipBefore);
		expect(bay && staticFabOrganizationParentIds(bay)).toEqual([areaId, processId]);
		expect(bay && staticFabOrganizationProperties(bay)).toEqual({
			description: "Lithography production Bay",
			color: "VIOLET",
		});

		const areaCoverage = resolveStaticFabOrganizationCoverage(document.organizations, areaId);
		expect(areaCoverage?.descendantOrganizationIds).toEqual([bayId]);
		expect(areaCoverage?.inherited.railEdges.length).toBeGreaterThan(0);
		expect(areaCoverage?.effective.railEdges).toHaveLength(
			areaCoverage?.direct.railEdges.length ?? 0,
		);

		const cycle = planUpdateStaticFabOrganizationDetails(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			areaId,
			{ parentOrganizationIds: [bayId], description: "", color: "TEAL" },
		);
		expect(cycle.valid).toBe(false);
		expect(cycle.reason).toContain("순환");
		const removeParent = planRemoveStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			areaId,
		);
		expect(removeParent.valid).toBe(false);
		expect(removeParent.reason).toContain("부모 조직");

		expect(document.undo()).toBe(true);
		const restored = document.organizations.records.find((record) => record.id === bayId);
		expect(restored && staticFabOrganizationParentIds(restored)).toEqual([]);
		expect(document.redo()).toBe(true);
		const redone = document.organizations.records.find((record) => record.id === bayId);
		expect(redone).toBeDefined();
		expect(redone && staticFabOrganizationParentIds(redone)).toEqual([areaId, processId]);
	});
	it("captures canonical stable membership from one exact static FAB selection", () => {
		const document = longBayDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -20, y: -20 }, { x: 80, y: 80 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const empty = emptyStaticFabOrganizationState();

		const plan = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			empty,
			selection,
			"Photo Bay 01",
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.organizationMutations).toHaveLength(1);
		const record = plan.organizationMutations[0]?.after;
		expect(record?.id).toBe(1);
		expect(record?.kind).toBe("AREA");
		expect(record?.membership.railEdges.length).toBeGreaterThan(0);
		expect(record?.membership.advancedSwitchIds).toEqual([]);
		const state = applyStaticFabOrganizationMutations(
			empty,
			plan.organizationMutations,
			plan.nextOrganizationIdAfter,
		);
		expect(state.nextOrganizationId).toBe(2);
		expect(isCanonicalStaticFabOrganizationState(state)).toBe(true);
		expect(staticFabOrganizationStateError(document.map, document.portEquipment, state)).toBeNull();
	});

	it("keeps trusted mutations canonical and rejects an alternating record accessor", () => {
		const membership = Object.freeze({
			railEdges: Object.freeze([
				Object.freeze({
					from: Object.freeze({ x: 0, y: 0 }),
					to: Object.freeze({ x: 1, y: 0 }),
				}),
			]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		});
		const record = Object.freeze({ id: 1, kind: "AREA" as const, name: "Area", membership });
		const canonical = applyStaticFabOrganizationMutations(
			emptyStaticFabOrganizationState(),
			[Object.freeze({ id: 1, before: null, after: record })],
			2,
			true,
		);
		expect(isCanonicalStaticFabOrganizationState(canonical)).toBe(true);

		let idReads = 0;
		const hostile = Object.freeze({
			get id(): number {
				idReads++;
				return idReads === 1 ? 1 : Number.NaN;
			},
			kind: "AREA" as const,
			name: "Accessor Area",
			membership,
		});
		expect(() =>
			applyStaticFabOrganizationMutations(
				emptyStaticFabOrganizationState(),
				[Object.freeze({ id: 1, before: null, after: hostile })],
				2,
				true,
			),
		).toThrow(/ID/);
		expect(idReads).toBe(2);
	});

	it("copies mutable metadata before branding a replacement membership canonical", () => {
		const parentOrganizationIds = [2];
		const properties = { description: "Original", color: "TEAL" as const };
		const record = {
			id: 1,
			kind: "AREA" as const,
			name: "Area",
			parentOrganizationIds,
			properties,
			membership: {
				railEdges: [],
				advancedSwitchIds: [],
				equipmentGroupIds: [],
			},
		};
		const canonicalMembership = applyStaticFabOrganizationMutations(
			emptyStaticFabOrganizationState(),
			[
				{
					id: 1,
					before: null,
					after: {
						...record,
						parentOrganizationIds: [],
						membership: {
							railEdges: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }],
							advancedSwitchIds: [],
							equipmentGroupIds: [],
						},
					},
				},
			],
			2,
		).records[0]?.membership;
		if (!canonicalMembership) throw new Error("Expected canonical membership fixture.");

		const replaced = replaceStaticFabOrganizationRecordMembership(record, canonicalMembership);
		parentOrganizationIds[0] = 3;
		properties.description = "Mutated";

		expect(replaced.parentOrganizationIds).toEqual([2]);
		expect(replaced.properties).toEqual({ description: "Original", color: "TEAL" });
		expect(Object.isFrozen(replaced.parentOrganizationIds)).toBe(true);
		expect(Object.isFrozen(replaced.properties)).toBe(true);
	});

	it("rejects a stale selection even when its rail ownership still looks reusable", () => {
		const document = longBayDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -20, y: -20 }, { x: 80, y: 80 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);

		const plan = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence() + 1,
			emptyStaticFabOrganizationState(),
			selection,
			"Stale Area",
		);

		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("다시 선택");
	});

	it("rejects normalized duplicate names and same-kind membership overlap", () => {
		const document = longBayDocument();
		const source = planCreateStaticFabOrganizationFromSelection(
			document.map,
			buildRailModuleOwnershipIndex(document.map),
			document.portEquipment,
			document.getPatchSequence(),
			emptyStaticFabOrganizationState(),
			wholeSelection(document),
			"Bay A",
		).organizationMutations[0]?.after;
		if (!source) throw new Error("Expected one canonical organization record.");
		const duplicateName = {
			nextOrganizationId: 3,
			records: [
				source,
				{
					...source,
					id: 2,
					name: "ＢＡＹ Ａ",
					membership: { railEdges: [], advancedSwitchIds: [], equipmentGroupIds: [1] },
				},
			],
		};
		expect(staticFabOrganizationStateShapeError(duplicateName)).toContain("중복");

		const overlap = {
			...duplicateName,
			records: [source, { ...source, id: 2, name: "Bay B" }],
		};
		expect(
			staticFabOrganizationStateError(document.map, document.portEquipment, overlap),
		).toContain("함께 소유");
	});

	it("rejects noncanonical duplicate membership at the core boundary", () => {
		const document = longBayDocument();
		const edge = wholeSelection(document).rail.ownerships[0]?.eraseEdges[0];
		if (!edge) throw new Error("Expected one authored rail edge.");
		expect(() =>
			applyStaticFabOrganizationMutations(
				emptyStaticFabOrganizationState(),
				[
					{
						id: 1,
						before: null,
						after: {
							id: 1,
							kind: "AREA",
							name: "Malformed",
							membership: {
								railEdges: [edge, edge],
								advancedSwitchIds: [],
								equipmentGroupIds: [],
							},
						},
					},
				],
				2,
			),
		).toThrow(/canonical/);
	});

	it("requires stored rail membership to be an exact union of current modules", () => {
		const document = longBayDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const module = ownership.modules.find((candidate) => candidate.eraseEdges.length > 1);
		if (!module) throw new Error("Expected one multi-edge semantic module.");
		const partialEdge = module.eraseEdges[0];
		if (!partialEdge) throw new Error("Expected a multi-edge module member.");
		const state = {
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA" as const,
					name: "Partial module",
					membership: {
						railEdges: [partialEdge],
						advancedSwitchIds: [],
						equipmentGroupIds: [],
					},
				},
			],
		};

		expect(staticFabOrganizationStateError(document.map, document.portEquipment, state)).toContain(
			"전체를 포함",
		);
	});

	it("rejects switch identity without the switch module rail edges", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "D");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(document.commit(switchPlan)).toBe(true);
		const switchId = switchPlan.switchRecord?.id;
		if (!switchId) throw new Error("Expected one advanced switch record.");
		const state = {
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA" as const,
					name: "Switch identity only",
					membership: {
						railEdges: [],
						advancedSwitchIds: [switchId],
						equipmentGroupIds: [],
					},
				},
			],
		};

		expect(staticFabOrganizationStateError(document.map, document.portEquipment, state)).toContain(
			"전체를 포함",
		);
	});

	it("rejects an equipment group whose port route is outside organization rail membership", () => {
		const document = longBayDocument();
		const route = firstRegularRoute(document);
		const equipment: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [
				{
					id: 1,
					equipmentGroupId: 1,
					route: { kind: "CARDINAL_CELL", ...route },
					stationMillimeters: 500,
					side: "LEFT",
					lateralOffsetMillimeters: 700,
					direction: "WITH_TRAVEL",
					portType: "OHB",
					barcode: null,
				},
			],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const state = {
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA" as const,
					name: "Ports without rail",
					membership: {
						railEdges: [],
						advancedSwitchIds: [],
						equipmentGroupIds: [1],
					},
				},
			],
		};

		expect(staticFabOrganizationStateError(document.map, equipment, state)).toContain(
			"완전히 포함",
		);
	});

	it("plans rename and metadata-only removal without changing the ID cursor", () => {
		const document = longBayDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const create = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			emptyStaticFabOrganizationState(),
			wholeSelection(document),
			"Area 01",
		);
		let state = applyStaticFabOrganizationMutations(
			emptyStaticFabOrganizationState(),
			create.organizationMutations,
			create.nextOrganizationIdAfter,
		);

		const rename = planRenameStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			1,
			"Area 01A",
		);
		expect(rename.valid, rename.reason).toBe(true);
		state = applyStaticFabOrganizationMutations(
			state,
			rename.organizationMutations,
			rename.nextOrganizationIdAfter,
		);
		expect(state.records[0]?.name).toBe("Area 01A");
		expect(state.nextOrganizationId).toBe(2);

		const remove = planRemoveStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			1,
		);
		expect(remove.valid, remove.reason).toBe(true);
		state = applyStaticFabOrganizationMutations(
			state,
			remove.organizationMutations,
			remove.nextOrganizationIdAfter,
		);
		expect(state.records).toEqual([]);
		expect(state.nextOrganizationId).toBe(2);
	});

	it("atomically claims same-kind membership while preserving cross-kind hierarchy", () => {
		const document = longBayDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		expect(ownership.modules.length).toBeGreaterThan(2);
		const claimedModule = ownership.modules[1];
		if (!claimedModule) throw new Error("Expected a claimable semantic module.");
		const all = selectionFromModules(document, ownership.modules);
		const claimed = selectionFromModules(document, [claimedModule]);
		let state = emptyStaticFabOrganizationState();
		const area = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			all,
			"Factory Area",
			"AREA",
		);
		state = applyStaticFabOrganizationMutations(
			state,
			area.organizationMutations,
			area.nextOrganizationIdAfter,
		);
		const bay = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			all,
			"Photo Bay",
			"BAY",
		);
		state = applyStaticFabOrganizationMutations(
			state,
			bay.organizationMutations,
			bay.nextOrganizationIdAfter,
		);

		expect(staticFabOrganizationConflictsForSelection(state, claimed, "AREA")).toEqual([
			state.records[0],
		]);
		expect(
			staticFabOrganizationAssignmentSourcesForSelection(state, claimed, "AREA", null, [1]),
		).toEqual([{ record: state.records[0], empties: false }]);
		expect(
			staticFabOrganizationAssignmentSourcesForSelection(state, claimed, "AREA", null, []),
		).toEqual([]);
		expect(staticFabOrganizationConflictsForSelection(state, claimed, "AISLE")).toEqual([]);
		const assign = planAssignStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			claimed,
			{
				kind: "AREA",
				organizationId: null,
				name: "Utility Area",
				sourceOwners: [{ organizationId: 1, emptyDisposition: "reject" }],
			},
		);

		expect(assign.valid, assign.reason).toBe(true);
		expect(assign.organizationMutations.map((mutation) => mutation.id)).toEqual([1, 3]);
		state = applyStaticFabOrganizationMutations(
			state,
			assign.organizationMutations,
			assign.nextOrganizationIdAfter,
		);
		expect(state.records.map((record) => [record.id, record.kind, record.name])).toEqual([
			[1, "AREA", "Factory Area"],
			[2, "BAY", "Photo Bay"],
			[3, "AREA", "Utility Area"],
		]);
		expect(state.records[0]?.membership.railEdges).toHaveLength(
			all.rail.ownerships.reduce((count, module) => count + module.eraseEdges.length, 0) -
				claimedModule.eraseEdges.length,
		);
		expect(state.records[1]?.membership.railEdges).toHaveLength(
			all.rail.ownerships.reduce((count, module) => count + module.eraseEdges.length, 0),
		);
		expect(staticFabOrganizationStateError(document.map, document.portEquipment, state)).toBeNull();
	});

	it("merges a selection into an existing target and removes an emptied source record", () => {
		const document = longBayDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		expect(ownership.modules.length).toBeGreaterThan(2);
		const firstModule = ownership.modules[0];
		const secondModule = ownership.modules[1];
		if (!firstModule || !secondModule) {
			throw new Error("Expected two assignable semantic modules.");
		}
		const sourceModules = [firstModule, secondModule];
		let state = emptyStaticFabOrganizationState();
		for (const [index, name] of ["Area A", "Area B"].entries()) {
			const sourceModule = sourceModules[index];
			if (!sourceModule) throw new Error("Expected source module for organization fixture.");
			const selection = selectionFromModules(document, [sourceModule]);
			const create = planCreateStaticFabOrganizationFromSelection(
				document.map,
				ownership,
				document.portEquipment,
				document.getPatchSequence(),
				state,
				selection,
				name,
			);
			state = applyStaticFabOrganizationMutations(
				state,
				create.organizationMutations,
				create.nextOrganizationIdAfter,
			);
		}
		const targetDetails = planUpdateStaticFabOrganizationDetails(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			2,
			{
				parentOrganizationIds: [],
				description: "Retain this target metadata",
				color: "BLUE",
			},
		);
		expect(targetDetails.valid, targetDetails.reason).toBe(true);
		state = applyStaticFabOrganizationMutations(
			state,
			targetDetails.organizationMutations,
			targetDetails.nextOrganizationIdAfter,
		);
		const sourceSelection = selectionFromModules(document, [firstModule]);
		const unacknowledged = planAssignStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			sourceSelection,
			{
				kind: "AREA",
				organizationId: 2,
				name: "ignored",
				sourceOwners: [],
			},
		);
		expect(unacknowledged.valid).toBe(false);
		expect(unacknowledged.reason).toContain("충돌 조직");
		const retainedEmptySource = planAssignStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			sourceSelection,
			{
				kind: "AREA",
				organizationId: 2,
				name: "ignored",
				sourceOwners: [{ organizationId: 1, emptyDisposition: "reject" }],
			},
		);
		expect(retainedEmptySource.valid).toBe(false);
		expect(retainedEmptySource.reason).toContain("빈 원본 조직 제거");
		const assign = planAssignStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			state,
			sourceSelection,
			{
				kind: "AREA",
				organizationId: 2,
				name: "ignored",
				sourceOwners: [{ organizationId: 1, emptyDisposition: "remove" }],
			},
		);

		expect(assign.valid, assign.reason).toBe(true);
		expect(assign.organizationMutations).toMatchObject([
			{ id: 1, after: null },
			{ id: 2, after: { name: "Area B" } },
		]);
		state = applyStaticFabOrganizationMutations(
			state,
			assign.organizationMutations,
			assign.nextOrganizationIdAfter,
		);
		expect(state.records).toHaveLength(1);
		expect(state.records[0]?.membership.railEdges).toHaveLength(
			firstModule.eraseEdges.length + secondModule.eraseEdges.length,
		);
		expect(state.records[0] && staticFabOrganizationProperties(state.records[0])).toEqual({
			description: "Retain this target metadata",
			color: "BLUE",
		});
		expect(state.nextOrganizationId).toBe(3);
	});

	it("resolves persistent membership back into the exact current editor selection", () => {
		const document = longBayDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const source = wholeSelection(document);
		const create = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			emptyStaticFabOrganizationState(),
			source,
			"Photo Area",
		);
		const record = create.organizationMutations[0]?.after;
		if (!record) throw new Error("Expected organization record.");

		const resolved = resolveStaticFabOrganizationSelection(
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			record,
		);

		expect(resolved.valid, resolved.reason).toBe(true);
		if (!resolved.valid) throw new Error(resolved.reason);
		expect(resolved.selection.rail.ownerships.map((module) => module.key).sort()).toEqual(
			source.rail.ownerships.map((module) => module.key).sort(),
		);
		expect(resolved.selection.equipmentGroups).toEqual(source.equipmentGroups);
	});

	it("refuses to approximate organization membership after an ownership mismatch", () => {
		const document = longBayDocument();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const edge = wholeSelection(document).rail.ownerships[0]?.eraseEdges[0];
		if (!edge) throw new Error("Expected organization edge.");
		const record = {
			id: 1,
			kind: "AREA" as const,
			name: "Partial module",
			membership: {
				railEdges: [edge, { from: { x: 999, y: 999 }, to: { x: 1_000, y: 999 } }],
				advancedSwitchIds: [],
				equipmentGroupIds: [],
			},
		};

		const resolved = resolveStaticFabOrganizationSelection(
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			record,
		);

		expect(resolved.valid).toBe(false);
		expect(resolved.reason).toContain("정확히 복원");
	});
});

function longBayDocument(): RailDocument {
	const document = new RailDocument();
	const plan = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function selectionFromModules(
	document: RailDocument,
	modules: readonly ReturnType<typeof buildRailModuleOwnershipIndex>["modules"][number][],
) {
	const ownership = buildRailModuleOwnershipIndex(document.map);
	return createStaticFabSelection(
		createRailAreaSelectionFromOwnerships(ownership, modules, "fully-contained"),
		document.portEquipment,
		document.getPatchSequence(),
		[],
	);
}

function wholeSelection(document: RailDocument) {
	const ownership = buildRailModuleOwnershipIndex(document.map);
	return createStaticFabSelection(
		createRailAreaSelection(ownership, { x: -20, y: -20 }, { x: 80, y: 80 }),
		document.portEquipment,
		document.getPatchSequence(),
		[],
	);
}

function firstRegularRoute(document: RailDocument): {
	readonly x: number;
	readonly z: number;
	readonly from: Direction;
	readonly to: Direction;
} {
	let result: { x: number; z: number; from: Direction; to: Direction } | null = null;
	document.map.forEachRail((x, z, rail) => {
		if (result || rail.incoming === 0 || rail.outgoing === 0) return;
		if ((rail.incoming & (rail.incoming - 1)) !== 0 || (rail.outgoing & (rail.outgoing - 1)) !== 0)
			return;
		result = { x, z, from: rail.incoming as Direction, to: rail.outgoing as Direction };
	});
	if (!result) throw new Error("Expected one regular authored route.");
	return result;
}
