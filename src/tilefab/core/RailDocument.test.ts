import { describe, expect, it } from "vitest";
import { planEraseEquipmentGroup } from "../compile/PortEquipmentEditPlanner";
import {
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "./OperationalConfiguration";
import { createPortEquipmentMutationPlan } from "./PortEquipmentPlan";
import type { PortRecord } from "./PortRecord";
import { planRailConstruction, planRailErase } from "./paint";
import {
	createRailAreaSelection,
	createRailAreaSelectionFromOwnerships,
} from "./RailAreaSelection";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex, planRailModuleBulldoze } from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "./RailTemplateCatalog";
import { DIR_E, DIR_W } from "./railShape";
import {
	planAssignStaticFabOrganizationFromSelection,
	planCreateStaticFabOrganizationFromSelection,
	planRemoveStaticFabOrganization,
	planRenameStaticFabOrganization,
} from "./StaticFabOrganizationPlan";
import { createStaticFabSelection } from "./StaticFabSelection";

describe("RailDocument", () => {
	it("commits operational configuration as one static-world patch with undo and redo", () => {
		const document = new RailDocument();
		const initialMap = document.map;
		const source = reviewOperationalConfiguration(document.operationalConfiguration, {
			revision: 0,
			authoredChecksum: "empty-document-source",
		});
		expect(document.commitOperationalConfiguration(requiredOperationalPlan(document, source))).toBe(
			true,
		);
		const replacement = copyOperationalConfigurationState({
			...document.operationalConfiguration,
			nextEqCapabilityId: 2,
			eqCapabilities: [{ id: 1, key: "PROCESS" }],
			review: null,
		});
		const events: Parameters<Parameters<RailDocument["subscribe"]>[0]>[0][] = [];
		document.subscribe((event) => events.push(event));

		expect(
			document.commitOperationalConfiguration(requiredOperationalPlan(document, replacement)),
		).toBe(true);
		expect(document.map).toBe(initialMap);
		expect(document.operationalConfiguration.revision).toBe(1);
		expect(document.operationalConfiguration.review).toBeNull();
		expect(events[0]).toMatchObject({
			kind: "edit-operational-configuration",
			baseRevision: 0,
			revision: 0,
			changes: [],
			operationalConfigurationPatch: {
				baseConfigurationRevision: 0,
				configurationRevision: 1,
				eqCapabilityChanges: [{ id: 1, before: null }],
			},
		});

		expect(document.undo()).toBe(true);
		expect(document.operationalConfiguration.revision).toBe(2);
		expect(document.operationalConfiguration.eqCapabilities).toEqual([]);
		expect(document.operationalConfiguration.nextEqCapabilityId).toBe(2);
		expect(events[1]).toMatchObject({
			kind: "undo",
			historyOriginKind: "edit-operational-configuration",
		});

		expect(document.redo()).toBe(true);
		expect(document.operationalConfiguration.revision).toBe(3);
		expect(document.operationalConfiguration.eqCapabilities).toEqual([{ id: 1, key: "PROCESS" }]);
		expect(events[2]).toMatchObject({
			kind: "redo",
			historyOriginKind: "edit-operational-configuration",
		});
	});

	it("clears operational state atomically and rejects stale operational plans", () => {
		const document = RailDocument.fromLoadedMap(
			new RailDocument().map,
			0,
			undefined,
			undefined,
			copyOperationalConfigurationState({
				...emptyOperationalConfigurationState(),
				stationCapabilities: [{ portId: 8, transferCapability: "BIDIRECTIONAL" }],
			}),
		);
		const replacement = copyOperationalConfigurationState({
			...document.operationalConfiguration,
			stationCapabilities: [{ portId: 8, transferCapability: "PICKUP_ONLY" }],
		});
		const stale = requiredOperationalPlan(document, replacement);
		const newer = copyOperationalConfigurationState({
			...document.operationalConfiguration,
			stationCapabilities: [{ portId: 8, transferCapability: "DROPOFF_ONLY" }],
		});
		expect(document.commitOperationalConfiguration(requiredOperationalPlan(document, newer))).toBe(
			true,
		);
		const beforeStale = document.operationalConfiguration;
		expect(document.commitOperationalConfiguration(stale)).toBe(false);
		expect(document.operationalConfiguration).toBe(beforeStale);

		expect(document.clear()).toBe(true);
		expect(document.operationalConfiguration.stationCapabilities).toEqual([]);
		expect(document.undo()).toBe(true);
		expect(document.operationalConfiguration.stationCapabilities).toEqual([
			{ portId: 8, transferCapability: "DROPOFF_ONLY" },
		]);
	});

	it("preserves immutable map generations across commit, undo, and redo", () => {
		const document = new RailDocument();
		const empty = document.map;
		const plan = planRailConstruction(empty, { x: 0, y: 0 }, { x: 5, y: 0 });

		expect(document.commit(plan)).toBe(true);
		const built = document.map;
		expect(built).not.toBe(empty);
		expect(empty.size).toBe(0);
		expect(built.size).toBe(6);

		expect(document.undo()).toBe(true);
		const undone = document.map;
		expect(undone).not.toBe(built);
		expect(undone.size).toBe(0);
		expect(built.size).toBe(6);

		expect(document.redo()).toBe(true);
		const redone = document.map;
		expect(redone).not.toBe(undone);
		expect(redone.size).toBe(6);
		expect(undone.size).toBe(0);
	});

	it("commits reciprocal port equipment as one undoable static-world command", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const railMap = document.map;
		const railRevision = railMap.getRevision();
		const events: Parameters<Parameters<RailDocument["subscribe"]>[0]>[0][] = [];
		document.subscribe((event) => events.push(event));

		expect(document.commitPortEquipment(ohbPlan(document))).toBe(true);
		expect(document.map).toBe(railMap);
		expect(document.map.getRevision()).toBe(railRevision);
		expect(document.portEquipment).toMatchObject({
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [{ id: 1, equipmentGroupId: 1, portType: "OHB" }],
			equipmentGroups: [{ id: 1, kind: "OHB", portIds: [1] }],
		});
		expect(events[0]).toMatchObject({
			kind: "place-ohb",
			baseRevision: railRevision,
			revision: railRevision,
			changes: [],
			switchChanges: [],
		});

		expect(document.undo()).toBe(true);
		expect(document.map).toBe(railMap);
		expect(document.portEquipment).toMatchObject({
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [],
			equipmentGroups: [],
		});
		expect(events[1]).toMatchObject({ kind: "undo", revision: railRevision });

		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(1);
		expect(events[2]).toMatchObject({ kind: "redo", revision: railRevision });

		expect(document.clear()).toBe(true);
		expect(document.map.size).toBe(0);
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.undo()).toBe(true);
		expect(document.map.size).toBe(5);
		expect(document.portEquipment.ports).toHaveLength(1);
	});

	it("rejects a partial port batch without changing document state", () => {
		const document = new RailDocument();
		const before = document.portEquipment;
		const plan = ohbPlan(document);
		const partial = createPortEquipmentMutationPlan(
			"place-ohb",
			plan.baseRevision,
			plan.basePatchSequence,
			plan.portMutations,
			[],
		);

		expect(document.commitPortEquipment(partial)).toBe(false);
		expect(document.portEquipment).toBe(before);
		expect(document.getPatchSequence()).toBe(0);
	});

	it("rejects rail commands that would orphan a committed port route", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(document.commitPortEquipment(ohbPlan(document))).toBe(true);
		const beforeMap = document.map;
		const beforeSequence = document.getPatchSequence();
		const erase = planRailErase(document.map, [{ x: 1, y: 0 }]);

		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(false);
		expect(document.map).toBe(beforeMap);
		expect(document.portEquipment.ports).toHaveLength(1);
		expect(document.getPatchSequence()).toBe(beforeSequence);
	});

	it("commits AREA metadata as an undoable static-world command and protects its membership", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const railMap = document.map;
		const revision = railMap.getRevision();
		const sequence = document.getPatchSequence();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 6, y: 1 }),
			document.portEquipment,
			sequence,
			[],
		);
		const plan = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			sequence,
			document.organizations,
			selection,
			"Photo Bay 01",
		);
		const events: Parameters<Parameters<RailDocument["subscribe"]>[0]>[0][] = [];
		document.subscribe((event) => events.push(event));

		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commitOrganization(plan)).toBe(true);
		expect(document.map).toBe(railMap);
		expect(document.map.getRevision()).toBe(revision);
		expect(document.getPatchSequence()).toBe(sequence + 1);
		expect(document.organizations).toMatchObject({
			nextOrganizationId: 2,
			records: [{ id: 1, kind: "AREA", name: "Photo Bay 01" }],
		});
		expect(events[0]).toMatchObject({
			kind: "create-static-fab-organization",
			baseRevision: revision,
			revision,
			changes: [],
			organizationNextIdBefore: 1,
			organizationNextIdAfter: 2,
			organizationChanges: [{ id: 1, before: null }],
		});

		const upstreamExtension = planRailConstruction(document.map, { x: -1, y: 0 }, { x: 0, y: 0 });
		expect(upstreamExtension.valid, upstreamExtension.reason).toBe(true);
		expect(document.commit(upstreamExtension)).toBe(false);
		expect(document.map).toBe(railMap);

		const erase = planRailErase(document.map, [{ x: 2, y: 0 }]);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(false);
		expect(document.map).toBe(railMap);

		expect(document.undo()).toBe(true);
		expect(document.organizations.records).toEqual([]);
		expect(document.organizations.nextOrganizationId).toBe(2);
		expect(document.redo()).toBe(true);
		expect(document.organizations.records).toHaveLength(1);
		expect(document.organizations.nextOrganizationId).toBe(2);

		expect(document.clear()).toBe(true);
		expect(document.map.size).toBe(0);
		expect(document.organizations.records).toEqual([]);
		expect(document.organizations.nextOrganizationId).toBe(2);
		expect(document.undo()).toBe(true);
		expect(document.map.size).toBeGreaterThan(0);
		expect(document.organizations.records).toHaveLength(1);
	});

	it("never reuses an organization ID after undoing its creation", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const firstOwnership = buildRailModuleOwnershipIndex(document.map);
		const firstSelection = createStaticFabSelection(
			createRailAreaSelection(firstOwnership, { x: -1, y: -1 }, { x: 6, y: 1 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const first = planCreateStaticFabOrganizationFromSelection(
			document.map,
			firstOwnership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			firstSelection,
			"Area 01",
		);
		expect(document.commitOrganization(first)).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(2);

		const secondOwnership = buildRailModuleOwnershipIndex(document.map);
		const secondSelection = createStaticFabSelection(
			createRailAreaSelection(secondOwnership, { x: -1, y: -1 }, { x: 6, y: 1 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const second = planCreateStaticFabOrganizationFromSelection(
			document.map,
			secondOwnership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			secondSelection,
			"Area 02",
		);

		expect(second.organizationMutations[0]?.id).toBe(2);
		expect(document.commitOrganization(second)).toBe(true);
		expect(document.organizations.records.map((record) => record.id)).toEqual([2]);
		expect(document.organizations.nextOrganizationId).toBe(3);
	});

	it("commits same-kind membership reassignment as one undoable Worker patch", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 6, y: 1 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const create = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			selection,
			"Area A",
		);
		expect(document.commitOrganization(create)).toBe(true);
		const currentSelection = createStaticFabSelection(
			createRailAreaSelection(
				buildRailModuleOwnershipIndex(document.map),
				{ x: -1, y: -1 },
				{ x: 6, y: 1 },
			),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const assign = planAssignStaticFabOrganizationFromSelection(
			document.map,
			buildRailModuleOwnershipIndex(document.map),
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			currentSelection,
			{
				kind: "AREA",
				organizationId: null,
				name: "Area B",
				sourceOwners: [{ organizationId: 1, emptyDisposition: "remove" }],
			},
		);
		const events: Parameters<Parameters<RailDocument["subscribe"]>[0]>[0][] = [];
		document.subscribe((event) => events.push(event));

		expect(assign.valid, assign.reason).toBe(true);
		expect(document.commitOrganization(assign)).toBe(true);
		expect(document.organizations.records).toMatchObject([{ id: 2, name: "Area B" }]);
		expect(events.at(-1)).toMatchObject({
			kind: "assign-static-fab-organization",
			changes: [],
			organizationChanges: [
				{ id: 1, after: null },
				{ id: 2, before: null },
			],
		});
		expect(document.undo()).toBe(true);
		expect(document.organizations.records).toMatchObject([{ id: 1, name: "Area A" }]);
		expect(document.redo()).toBe(true);
		expect(document.organizations.records).toMatchObject([{ id: 2, name: "Area B" }]);
	});

	it("rejects equipment edits that touch protected organization membership", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		expect(document.commitPortEquipment(ohbPlan(document))).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 6, y: 1 }),
			document.portEquipment,
			document.getPatchSequence(),
			[1],
		);
		const create = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			selection,
			"Protected equipment",
		);
		expect(create.valid, create.reason).toBe(true);
		expect(document.commitOrganization(create)).toBe(true);
		const erase = planEraseEquipmentGroup(
			document.portEquipment,
			1,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		const beforeEquipment = document.portEquipment;

		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commitPortEquipment(erase)).toBe(false);
		expect(document.portEquipment).toBe(beforeEquipment);
		expect(document.getLastCommandError()).toContain("Protected equipment");
	});

	it("rejects a structurally forged organization plan and freezes emitted patch envelopes", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 6, y: 1 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const issued = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			selection,
			"Area 01",
		);
		const forged = Object.freeze({ ...issued });
		expect(document.commitOrganization(forged)).toBe(false);
		expect(document.organizations.records).toHaveLength(0);

		type ObservedPatchEvent = Parameters<Parameters<RailDocument["subscribe"]>[0]>[0];
		let observed: ObservedPatchEvent | null = null;
		document.subscribe((event) => {
			observed = event;
		});
		expect(document.commitOrganization(issued)).toBe(true);
		expect(observed).not.toBeNull();
		expect(Object.isFrozen(observed)).toBe(true);
		expect(Object.isFrozen((observed as unknown as ObservedPatchEvent).organizationChanges)).toBe(
			true,
		);

		const rename = planRenameStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			1,
			"Area 02",
		);
		const staleRename = planRenameStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			1,
			"Stale Area",
		);
		expect(rename.valid).toBe(true);
		expect(document.commitOrganization(rename)).toBe(true);
		const renameEvent = observed as unknown as ObservedPatchEvent;
		const renameChange = renameEvent.organizationChanges[0];
		expect(Object.isFrozen(renameChange)).toBe(true);
		expect(renameChange?.before?.membership).toBe(renameChange?.after?.membership);
		expect(document.undo()).toBe(true);
		const undoChange = (observed as unknown as ObservedPatchEvent).organizationChanges[0];
		expect(undoChange?.before?.membership).toBe(undoChange?.after?.membership);
		expect(document.redo()).toBe(true);
		const redoChange = (observed as unknown as ObservedPatchEvent).organizationChanges[0];
		expect(redoChange?.before?.membership).toBe(redoChange?.after?.membership);
		expect(document.commitOrganization(staleRename)).toBe(false);
		expect(document.getLastCommandError()).toContain("편집 순서가 변경");
	});

	it("rejects an issued organization plan replayed into a different document", () => {
		const source = new RailDocument();
		const target = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 5, y: 0 }))).toBe(
			true,
		);
		expect(target.commit(planRailConstruction(target.map, { x: 0, y: 0 }, { x: 0, y: 5 }))).toBe(
			true,
		);
		expect(target.map.getRevision()).toBe(source.map.getRevision());
		expect(target.getPatchSequence()).toBe(source.getPatchSequence());
		expect(target.organizations.nextOrganizationId).toBe(source.organizations.nextOrganizationId);

		const ownership = buildRailModuleOwnershipIndex(source.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 6, y: 1 }),
			source.portEquipment,
			source.getPatchSequence(),
			[],
		);
		const foreignPlan = planCreateStaticFabOrganizationFromSelection(
			source.map,
			ownership,
			source.portEquipment,
			source.getPatchSequence(),
			source.organizations,
			selection,
			"Source Area",
		);

		expect(foreignPlan.valid, foreignPlan.reason).toBe(true);
		expect(target.commitOrganization(foreignPlan)).toBe(false);
		expect(target.getLastCommandError()).toContain("다른 문서");
		expect(target.organizations.records).toEqual([]);
		expect(target.getPatchSequence()).toBe(1);
	});

	it("replays multiple organization creations after their monotonic cursor has advanced", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const createOrganization = (name: string, kind: "AREA" | "BAY") => {
			const ownership = buildRailModuleOwnershipIndex(document.map);
			const selection = createStaticFabSelection(
				createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 6, y: 1 }),
				document.portEquipment,
				document.getPatchSequence(),
				[],
			);
			return planCreateStaticFabOrganizationFromSelection(
				document.map,
				ownership,
				document.portEquipment,
				document.getPatchSequence(),
				document.organizations,
				selection,
				name,
				kind,
			);
		};

		expect(document.commitOrganization(createOrganization("Area A", "AREA"))).toBe(true);
		expect(document.commitOrganization(createOrganization("Bay B", "BAY"))).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(3);
		expect(document.undo()).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.organizations).toMatchObject({ nextOrganizationId: 3, records: [] });

		expect(document.redo()).toBe(true);
		expect(document.organizations).toMatchObject({
			nextOrganizationId: 3,
			records: [{ id: 1, kind: "AREA", name: "Area A" }],
		});
		expect(document.redo()).toBe(true);
		expect(document.organizations).toMatchObject({
			nextOrganizationId: 3,
			records: [
				{ id: 1, kind: "AREA", name: "Area A" },
				{ id: 2, kind: "BAY", name: "Bay B" },
			],
		});
	});

	it("allows rail removal after the owning AREA metadata is explicitly removed", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const create = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			createStaticFabSelection(
				createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 6, y: 1 }),
				document.portEquipment,
				document.getPatchSequence(),
				[],
			),
			"Area to remove",
		);
		expect(document.commitOrganization(create)).toBe(true);
		const remove = planRemoveStaticFabOrganization(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			1,
		);
		expect(document.commitOrganization(remove)).toBe(true);
		expect(document.commit(planRailErase(document.map, [{ x: 2, y: 0 }]))).toBe(true);
	});

	it("allows an unrelated structural edit while preserving exact organization membership", () => {
		const document = new RailDocument();
		const build = planRailTemplate(
			document.map,
			"long-bay",
			{ x: 0, y: 0 },
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		expect(build.valid, build.reason).toBe(true);
		expect(document.commit(build)).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		expect(ownership.modules.length).toBeGreaterThan(3);
		const organizedModule = ownership.modules[0];
		const removableModule = ownership.modules.at(-1);
		if (!organizedModule || !removableModule) {
			throw new Error("Expected organized and unrelated removable modules.");
		}
		const selection = createStaticFabSelection(
			createRailAreaSelectionFromOwnerships(ownership, [organizedModule], "fully-contained"),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const create = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			selection,
			"Protected module",
		);
		expect(document.commitOrganization(create)).toBe(true);
		const editOwnership = buildRailModuleOwnershipIndex(document.map);
		const resolvedRemovable = editOwnership.modules.find(
			(module) => module.key === removableModule.key,
		);
		if (!resolvedRemovable) throw new Error("Expected unrelated removable module.");
		const erase = planRailModuleBulldoze(document.map, resolvedRemovable);

		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase), document.getLastCommandError() ?? erase.reason).toBe(true);
		expect(document.organizations.records).toMatchObject([{ id: 1, name: "Protected module" }]);
	});
});

function requiredOperationalPlan(
	document: RailDocument,
	replacement: Parameters<RailDocument["planOperationalConfigurationReplacement"]>[0],
): NonNullable<ReturnType<RailDocument["planOperationalConfigurationReplacement"]>> {
	const plan = document.planOperationalConfigurationReplacement(replacement);
	if (!plan) throw new Error("Expected a non-empty operational configuration plan fixture.");
	return plan;
}

function ohbPlan(document: RailDocument) {
	const port: PortRecord = {
		id: 1,
		equipmentGroupId: 1,
		route: { kind: "CARDINAL_CELL" as const, x: 1, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters: 500,
		side: "LEFT" as const,
		lateralOffsetMillimeters: 700,
		direction: "WITH_TRAVEL" as const,
		portType: "OHB" as const,
		barcode: "OHB-001",
	};
	const group = { id: 1, kind: "OHB" as const, template: "SINGLE" as const, portIds: [1] };
	return createPortEquipmentMutationPlan(
		"place-ohb",
		document.map.getRevision(),
		document.getPatchSequence(),
		[{ id: 1, before: null, after: port }],
		[{ id: 1, before: null, after: group }],
	);
}
