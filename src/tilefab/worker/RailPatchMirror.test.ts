import { describe, expect, it } from "vitest";
import { compilePhysicalPathMigration } from "../compile/PhysicalPathMigration";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import {
	PortEquipmentGroupSlotIndex,
	planPortEquipmentGroupEdit,
} from "../compile/PortEquipmentGroupEditPlanner";
import { planPortEquipmentMembershipEdit } from "../compile/PortEquipmentMembershipEditPlanner";
import {
	planEqRowPlacement,
	planOhbPlacement,
	planStkPlacement,
} from "../compile/PortPlacementPlanner";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
} from "../compile/PortSlotCompiler";
import { compilePortSlotPreparedArtifactCatalog } from "../compile/PortSlotPreparedArtifacts";
import { deriveAdvancedSwitchGeometry } from "../core/AdvancedSwitch";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { planMoveCorner } from "../core/edit";
import {
	checksumOperationalConfigurationState,
	emptyOperationalConfigurationState,
} from "../core/OperationalConfiguration";
import { createPortEquipmentMutationPlan } from "../core/PortEquipmentPlan";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction, planRailErase } from "../core/paint";
import { createRailAreaSelection } from "../core/RailAreaSelection";
import { initialRailAreaStampPose } from "../core/RailAreaStamp";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex, planRailModuleBulldoze } from "../core/RailModuleOwnership";
import { planRailModule } from "../core/RailModulePlanner";
import { DIR_E, DIR_N, DIR_S, DIR_W, moveCell } from "../core/railShape";
import {
	createStaticFabBlueprintTemplate,
	planStaticFabBlueprintPlacement,
} from "../core/StaticFabBlueprint";
import { planCreateStaticFabOrganizationFromSelection } from "../core/StaticFabOrganizationPlan";
import { createStaticFabSelection, planStaticFabSelectionErase } from "../core/StaticFabSelection";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot, checksumRailMap } from "./RailMirrorChecksum";
import { RailPatchMirror } from "./RailPatchMirror";
import { checksumRailPhysicalLayout } from "./RailPhysicalLayout";

describe("RailPatchMirror", () => {
	it("mirrors AREA metadata without recompiling physical rail geometry", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot,
		);
		document.subscribe((event) => mirror.applyPatch(event));
		const physicalBefore = mirror.getPhysicalPublication().current.buffers;
		const revisionBefore = document.map.getRevision();
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 7, y: 1 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		const plan = planCreateStaticFabOrganizationFromSelection(
			document.map,
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			document.organizations,
			selection,
			"Lithography Area",
		);

		expect(document.commitOrganization(plan)).toBe(true);
		expect(mirror.state).toMatchObject({
			revision: revisionBefore,
			organizations: 1,
			checksum: checksumRailMap(document.map, document.portEquipment, document.organizations),
		});
		expect(mirror.getPhysicalPublication().current.buffers).toBe(physicalBefore);
		expect(document.undo()).toBe(true);
		expect(mirror.state.organizations).toBe(0);
		expect(mirror.getPhysicalPublication().current.buffers).toBe(physicalBefore);
		expect(document.redo()).toBe(true);
		expect(mirror.state.organizations).toBe(1);
		expect(mirror.getPhysicalPublication().current.buffers).toBe(physicalBefore);
	});

	it("accepts an empty organization library whose monotonic ID cursor is advanced", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 7, y: 1 }),
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
			"Temporary Area",
		);
		expect(document.commitOrganization(create)).toBe(true);
		expect(document.organizations.nextOrganizationId).toBe(2);
		expect(document.undo()).toBe(true);
		expect(document.organizations).toMatchObject({ nextOrganizationId: 2, records: [] });

		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		const mirror = new RailPatchMirror();

		expect(mirror.sync(snapshot)).toMatchObject({
			organizations: 0,
			checksum: snapshot.checksum,
		});
	});

	it("keeps checksum parity through multi-organization undo and redo with a retained cursor", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot,
		);
		document.subscribe((event) => mirror.applyPatch(event));
		const commitOrganization = (name: string, kind: "AREA" | "BAY") => {
			const ownership = buildRailModuleOwnershipIndex(document.map);
			const selection = createStaticFabSelection(
				createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 7, y: 1 }),
				document.portEquipment,
				document.getPatchSequence(),
				[],
			);
			return document.commitOrganization(
				planCreateStaticFabOrganizationFromSelection(
					document.map,
					ownership,
					document.portEquipment,
					document.getPatchSequence(),
					document.organizations,
					selection,
					name,
					kind,
				),
			);
		};

		expect(commitOrganization("Area A", "AREA")).toBe(true);
		expect(commitOrganization("Bay B", "BAY")).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.redo()).toBe(true);
		expect(document.redo()).toBe(true);

		expect(mirror.state).toMatchObject({
			organizations: 2,
			checksum: checksumRailMap(document.map, document.portEquipment, document.organizations),
		});
		expect(document.organizations.nextOrganizationId).toBe(3);
	});

	it("mirrors one atomic rail and port-equipment blueprint patch", () => {
		const source = new RailDocument();
		for (const [from, to] of [
			[
				{ x: 0, y: 0 },
				{ x: 8, y: 0 },
			],
			[
				{ x: 8, y: 0 },
				{ x: 8, y: 6 },
			],
			[
				{ x: 8, y: 6 },
				{ x: 0, y: 6 },
			],
			[
				{ x: 0, y: 6 },
				{ x: 0, y: 0 },
			],
		] as const) {
			expect(source.commit(planRailConstruction(source.map, from, to))).toBe(true);
		}
		const port: PortRecord = {
			id: 1,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL",
			portType: "OHB",
			barcode: "OHB-1",
		};
		const equipment: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [port],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const document = RailDocument.fromLoadedMap(source.map, source.getPatchSequence(), equipment);
		const railSelection = createRailAreaSelection(
			buildRailModuleOwnershipIndex(document.map),
			{ x: -2, y: -2 },
			{ x: 10, y: 8 },
		);
		const template = createStaticFabBlueprintTemplate(
			createStaticFabSelection(
				railSelection,
				document.portEquipment,
				document.getPatchSequence(),
				[1],
			),
		);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		document.subscribe((event) => mirror.applyPatch(event));
		const plan = planStaticFabBlueprintPlacement(
			document.map,
			document.portEquipment,
			document.getPatchSequence(),
			template,
			{ x: 30, y: 20 },
			initialRailAreaStampPose(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commitStaticFab(plan)).toBe(true);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 2,
			equipmentGroups: 2,
		});

		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 1,
			equipmentGroups: 1,
		});
		expect(document.redo()).toBe(true);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 2,
			equipmentGroups: 2,
		});

		const placedIndex = buildRailModuleOwnershipIndex(document.map);
		const placedSelection = createStaticFabSelection(
			createRailAreaSelection(placedIndex, { x: 28, y: 18 }, { x: 40, y: 28 }),
			document.portEquipment,
			document.getPatchSequence(),
			[2],
		);
		const erasePlan = planStaticFabSelectionErase(
			document.map,
			placedIndex,
			document.portEquipment,
			document.getPatchSequence(),
			placedSelection,
		);
		expect(erasePlan.valid, erasePlan.reason).toBe(true);
		expect(document.commitStaticFab(erasePlan)).toBe(true);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 1,
			equipmentGroups: 1,
		});

		const equipmentOnlyIndex = buildRailModuleOwnershipIndex(document.map);
		const equipmentOnlySelection = createStaticFabSelection(
			createRailAreaSelection(equipmentOnlyIndex, { x: 500, y: 500 }, { x: 501, y: 501 }),
			document.portEquipment,
			document.getPatchSequence(),
			[1],
		);
		const physicalBeforeEquipmentErase = mirror.getPhysicalPublication().current.buffers;
		const revisionBeforeEquipmentErase = document.map.getRevision();
		const equipmentErasePlan = planStaticFabSelectionErase(
			document.map,
			equipmentOnlyIndex,
			document.portEquipment,
			document.getPatchSequence(),
			equipmentOnlySelection,
		);
		expect(equipmentErasePlan.valid, equipmentErasePlan.reason).toBe(true);
		expect(equipmentErasePlan.mutations).toEqual([]);
		expect(document.commitStaticFab(equipmentErasePlan)).toBe(true);
		expect(document.map.getRevision()).toBe(revisionBeforeEquipmentErase);
		expect(mirror.getPhysicalPublication().current.buffers).toBe(physicalBeforeEquipmentErase);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: revisionBeforeEquipmentErase,
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 0,
			equipmentGroups: 0,
		});
		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 1, equipmentGroups: 1 });
	});

	it("mirrors build, edit, erase, undo, redo and clear patches without a full resync", () => {
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const kinds: string[] = [];
		document.subscribe((event) => {
			kinds.push(event.kind);
			mirror.applyPatch(event);
		});
		const expectMirrored = (): void => {
			expect(mirror.state).toMatchObject({
				sequence: document.getPatchSequence(),
				revision: document.map.getRevision(),
				checksum: checksumRailMap(document.map),
				cells: document.map.size,
				edges: document.map.edgeCount,
				switches: document.map.advancedSwitchCount,
			});
			const publication = mirror.getPhysicalPublication();
			expect(publication.kind).toBe("delta");
			expect(publication.migration?.buffers).toMatchObject({
				toRevision: document.map.getRevision(),
				sourcePathCount: expect.any(Number),
			});
		};
		const build = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
			expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
			expectMirrored();
		};

		build({ x: 0, y: 0 }, { x: 10, y: 0 });
		build({ x: 10, y: 0 }, { x: 10, y: 8 });
		build({ x: 10, y: 8 }, { x: 0, y: 8 });
		build({ x: 0, y: 8 }, { x: 0, y: 0 });

		const edit = planMoveCorner(document.map, { x: 10, y: 0 }, { x: 12, y: -2 });
		expect(document.commit(edit)).toBe(true);
		expectMirrored();
		expect(document.undo()).toBe(true);
		expectMirrored();
		expect(document.redo()).toBe(true);
		expectMirrored();

		expect(document.clear()).toBe(true);
		expectMirrored();
		expect(document.undo()).toBe(true);
		expectMirrored();

		const erase = planRailErase(document.map, [{ x: 5, y: 0 }]);
		expect(document.commit(erase)).toBe(true);
		expectMirrored();
		expect(document.undo()).toBe(true);
		expectMirrored();
		expect(document.redo()).toBe(true);
		expectMirrored();

		expect(new Set(kinds)).toEqual(new Set(["build", "edit", "erase", "undo", "redo", "clear"]));
	});

	it("hydrates current logical sequence and revision from a typed snapshot", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: -4, y: -2 }, { x: 4, y: -2 }));
		document.undo();
		document.redo();
		const capture = captureRailMirrorSnapshot(document.map, document.getPatchSequence());
		const mirror = new RailPatchMirror();

		expect(mirror.sync(capture.snapshot)).toEqual({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map),
			cells: document.map.size,
			edges: document.map.edgeCount,
			switches: document.map.advancedSwitchCount,
			ports: 0,
			equipmentGroups: 0,
			organizations: 0,
			operationalConfigurationRevision: 0,
			operationalConfigurationFingerprint: checksumOperationalConfigurationState(
				emptyOperationalConfigurationState(),
			),
		});
		const publication = mirror.getPhysicalPublication();
		const physical = publication.current.buffers;
		const mainPhysical = compilePhysicalRail(document.map, document.map.getRevision());
		expect(physical.revision).toBe(document.map.getRevision());
		expect(physical.paths.revision).toBe(document.map.getRevision());
		expect(checksumRailPhysicalLayout(physical)).toBe(checksumRailPhysicalLayout(mainPhysical));
		expect(publication).toMatchObject({ kind: "reset", previous: null, migration: null });
	});

	it("mirrors a compound module as one ordinary build patch", () => {
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		document.subscribe((event) => mirror.applyPatch(event));
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);

		const module = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "wide");
		expect(module.valid, module.reason).toBe(true);
		expect(document.commit(module)).toBe(true);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map),
			cells: document.map.size,
			edges: document.map.edgeCount,
		});
		const publication = mirror.getPhysicalPublication();
		const physical = publication.current.buffers;
		expect(physical.compoundProfiles.count).toBe(1);
		expect(physical.pathIntervalRemap.count).toBeGreaterThan(physical.paths.pathCount);
		expect(publication.migration?.buffers).toMatchObject({
			toRevision: document.map.getRevision(),
			matchedRawPathCount: expect.any(Number),
		});
	});

	it("mirrors exact switch bulldoze while preserving connected boundary rails", () => {
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		document.subscribe((event) => mirror.applyPatch(event));
		const expectMirrored = (): void => {
			expect(mirror.state).toMatchObject({
				sequence: document.getPatchSequence(),
				revision: document.map.getRevision(),
				checksum: checksumRailMap(document.map),
				cells: document.map.size,
				edges: document.map.edgeCount,
				switches: document.map.advancedSwitchCount,
			});
			expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
				checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
			);
		};
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "D");
		expect(document.commit(switchPlan)).toBe(true);
		const record = document.map.getAdvancedSwitch(switchPlan.switchRecord?.id ?? -1);
		if (!record) throw new Error("expected advanced switch");
		const output = deriveAdvancedSwitchGeometry(record).outputs[0];
		const outputEnd = moveCell(
			moveCell(moveCell(output.cell, output.direction), output.direction),
			output.direction,
		);
		expect(document.commit(planRailConstruction(document.map, output.cell, outputEnd))).toBe(true);
		expectMirrored();
		const module = buildRailModuleOwnershipIndex(document.map).find(`SW-${record.id}`);
		if (!module) throw new Error("expected switch ownership");

		const erase = planRailModuleBulldoze(document.map, module);
		expect(erase.valid, erase.reason).toBe(true);
		expect(document.commit(erase)).toBe(true);
		expect(document.map.getRail(output.cell.x, output.cell.y).outgoing & output.direction).toBe(
			output.direction,
		);
		expectMirrored();
		expect(document.undo()).toBe(true);
		expectMirrored();
		expect(document.redo()).toBe(true);
		expectMirrored();
	});

	it("rolls back authored and physical publication when physical compilation fails", () => {
		let failCompilation = false;
		const observedMapRevisions: number[] = [];
		const mirror = new RailPatchMirror((map, revision) => {
			observedMapRevisions.push(map.getRevision());
			if (failCompilation) throw new Error("Injected physical compile failure");
			return compilePhysicalRail(map, revision);
		});
		const document = new RailDocument();
		mirror.sync(captureRailMirrorSnapshot(document.map, 0).snapshot);
		const patches: RailPatchEvent[] = [];
		document.subscribe((event) => patches.push(event));
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const patch = patches[0] as RailPatchEvent;
		const beforeState = mirror.state;
		const beforePublication = mirror.getPhysicalPublication();

		failCompilation = true;
		expect(() => mirror.applyPatch(patch)).toThrow("Injected physical compile failure");
		expect(mirror.state).toEqual(beforeState);
		expect(mirror.getPhysicalPublication()).toBe(beforePublication);

		failCompilation = false;
		expect(mirror.applyPatch(patch)).toMatchObject({
			sequence: patch.sequence,
			revision: patch.revision,
			checksum: checksumRailMap(document.map),
		});
		expect(mirror.getPhysicalPublication().current.buffers.revision).toBe(patch.revision);
		expect(observedMapRevisions.slice(-2)).toEqual([patch.revision, patch.revision]);
	});

	it("rolls back and retries when a compiler returns corrupted clearance buffers", () => {
		let corruptClearance = false;
		const mirror = new RailPatchMirror((map, revision) => {
			const layout = compilePhysicalRail(map, revision);
			if (corruptClearance && layout.clearance.envelopes.count > 0) {
				layout.clearance.envelopes.bounds[0] -= 0.01;
			}
			return layout;
		});
		const document = new RailDocument();
		mirror.sync(captureRailMirrorSnapshot(document.map, 0).snapshot);
		const patches: RailPatchEvent[] = [];
		document.subscribe((event) => patches.push(event));
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const patch = patches[0] as RailPatchEvent;
		const beforeState = mirror.state;
		const beforePublication = mirror.getPhysicalPublication();

		corruptClearance = true;
		expect(() => mirror.applyPatch(patch)).toThrow("bounds differ from derived physical geometry");
		expect(mirror.state).toEqual(beforeState);
		expect(mirror.getPhysicalPublication()).toBe(beforePublication);

		corruptClearance = false;
		expect(mirror.applyPatch(patch)).toMatchObject({
			sequence: patch.sequence,
			revision: patch.revision,
			checksum: checksumRailMap(document.map),
		});
	});

	it("rolls back authored and physical publication when migration compilation fails", () => {
		let failMigration = false;
		const mirror = new RailPatchMirror(compilePhysicalRail, (previous, next) => {
			if (failMigration) throw new Error("Injected migration compile failure");
			return compilePhysicalPathMigration(previous, next);
		});
		const document = new RailDocument();
		mirror.sync(captureRailMirrorSnapshot(document.map, 0).snapshot);
		const patches: RailPatchEvent[] = [];
		document.subscribe((event) => patches.push(event));
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const patch = patches[0] as RailPatchEvent;
		const beforeState = mirror.state;
		const beforePublication = mirror.getPhysicalPublication();

		failMigration = true;
		expect(() => mirror.applyPatch(patch)).toThrow("Injected migration compile failure");
		expect(mirror.state).toEqual(beforeState);
		expect(mirror.getPhysicalPublication()).toBe(beforePublication);

		failMigration = false;
		expect(mirror.applyPatch(patch).revision).toBe(patch.revision);
		expect(mirror.getPhysicalPublication().migration?.buffers).toMatchObject({
			fromRevision: patch.baseRevision,
			toRevision: patch.revision,
		});
	});

	it("retains exactly the current and immediately previous physical layouts", () => {
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, 0).snapshot);
		document.subscribe((event) => mirror.applyPatch(event));

		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const first = mirror.getPhysicalPublication();
		expect(first.kind).toBe("delta");
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 4, y: 4 })),
		).toBe(true);
		const second = mirror.getPhysicalPublication();

		expect(second.kind).toBe("delta");
		expect(second.previous).toBe(first.current);
		expect(second.current).not.toBe(first.current);
		expect(second.migration?.from).toBe(second.previous?.identity);
		expect(second.migration?.to).toBe(second.current.identity);
		expect(second.previous).not.toBe(first.previous);
	});

	it("publishes port-only commands without recompiling physical rail buffers", () => {
		let compileCount = 0;
		const mirror = new RailPatchMirror((map, revision) => {
			compileCount++;
			return compilePhysicalRail(map, revision);
		});
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		const compileCountBefore = compileCount;
		const beforePublication = mirror.getPhysicalPublication();
		let applied: ReturnType<RailPatchMirror["applyPatch"]> | null = null;
		document.subscribe((event) => {
			applied = mirror.applyPatch(event);
		});

		expect(document.commitPortEquipment(ohbPlan(document))).toBe(true);
		expect(compileCount).toBe(compileCountBefore);
		expect(applied).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 1,
			equipmentGroups: 1,
		});
		const publication = mirror.getPhysicalPublication();
		expect(publication.kind).toBe("static");
		expect(publication.previous).toBe(beforePublication.current);
		expect(publication.current.buffers).toBe(beforePublication.current.buffers);
		expect(publication.current.identity.fingerprint).toBe(
			beforePublication.current.identity.fingerprint,
		);
	});

	it("mirrors one atomic EQ group copy without recompiling physical rail buffers", () => {
		let compileCount = 0;
		const mirror = new RailPatchMirror((map, revision) => {
			compileCount++;
			return compilePhysicalRail(map, revision);
		});
		const document = new RailDocument();
		for (const [start, end] of [
			[
				{ x: 0, y: 0 },
				{ x: 15, y: 0 },
			],
			[
				{ x: 15, y: 0 },
				{ x: 15, y: 4 },
			],
			[
				{ x: 15, y: 4 },
				{ x: 0, y: 4 },
			],
			[
				{ x: 0, y: 4 },
				{ x: 0, y: 0 },
			],
		] as const) {
			expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
		}
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const placement = planEqRowPlacement(
			slots,
			[2, 3, 4].map((x) => portSlotRowAt(slots, x, 0)),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1_000,
			"PHOTO",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(placement)).toBe(true);
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		document.subscribe((event) => mirror.applyPatch(event));
		const compileCountBefore = compileCount;
		const beforePublication = mirror.getPhysicalPublication();
		const copy = planPortEquipmentGroupEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			1,
			portSlotRowAt(slots, 9, 0),
			"copy",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(copy.valid, copy.reason).toBe(true);
		expect(document.commitPortEquipment(copy)).toBe(true);
		expect(compileCount).toBe(compileCountBefore);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 6,
			equipmentGroups: 2,
		});
		expect(mirror.getPhysicalPublication().current.buffers).toBe(beforePublication.current.buffers);

		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 3, equipmentGroups: 1 });
		expect(document.redo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 6, equipmentGroups: 2 });
		expect(compileCount).toBe(compileCountBefore);

		const sourceRouteBeforeMove = document.portEquipment.ports[0]?.route;
		const move = planPortEquipmentGroupEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			1,
			portSlotRowAt(slots, 5, 0),
			"move",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(move.valid, move.reason).toBe(true);
		expect(move).toMatchObject({
			kind: "edit-port-equipment",
			portMutations: { length: 3 },
			groupEdit: { sourceEquipmentGroupId: 1, targetEquipmentGroupId: 1 },
		});
		expect(document.commitPortEquipment(move)).toBe(true);
		expect(mirror.state).toMatchObject({
			ports: 6,
			equipmentGroups: 2,
			checksum: checksumRailMap(document.map, document.portEquipment),
		});
		expect(mirror.getPhysicalPublication().current.buffers).toBe(beforePublication.current.buffers);
		expect(document.undo()).toBe(true);
		expect(document.portEquipment.ports[0]?.route).toEqual(sourceRouteBeforeMove);
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports[0]?.route).toEqual(move.portMutations[0]?.after?.route);
		expect(compileCount).toBe(compileCountBefore);
	});

	it("mirrors one atomic EQ membership edit with stable physical buffers and undo", () => {
		let compileCount = 0;
		const mirror = new RailPatchMirror((map, revision) => {
			compileCount++;
			return compilePhysicalRail(map, revision);
		});
		const document = new RailDocument();
		for (const [start, end] of [
			[
				{ x: 0, y: 0 },
				{ x: 14, y: 0 },
			],
			[
				{ x: 14, y: 0 },
				{ x: 14, y: 4 },
			],
			[
				{ x: 14, y: 4 },
				{ x: 0, y: 4 },
			],
			[
				{ x: 0, y: 4 },
				{ x: 0, y: 0 },
			],
		] as const) {
			expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
		}
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					[2, 3, 4].map((x) => portSlotRowAt(slots, x, 0)),
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					null,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		const compileCountBefore = compileCount;
		const beforePublication = mirror.getPhysicalPublication();
		document.subscribe((event) => mirror.applyPatch(event));

		const edit = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			[2, 3, 4, 5].map((x) => portSlotRowAt(slots, x, 0)),
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(edit.valid, edit.reason).toBe(true);
		expect(document.commitPortEquipment(edit)).toBe(true);
		expect(compileCount).toBe(compileCountBefore);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			ports: 4,
			equipmentGroups: 1,
			checksum: checksumRailMap(document.map, document.portEquipment),
		});
		expect(mirror.getPhysicalPublication().current.buffers).toBe(beforePublication.current.buffers);

		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 3, equipmentGroups: 1 });
		expect(document.redo()).toBe(true);
		expect(mirror.state).toMatchObject({
			ports: 4,
			checksum: checksumRailMap(document.map, document.portEquipment),
		});
		expect(compileCount).toBe(compileCountBefore);
	});

	it("mirrors one odd asymmetric FLEX STK command without recompiling physical rail", () => {
		let compileCount = 0;
		const mirror = new RailPatchMirror((map, revision) => {
			compileCount++;
			return compilePhysicalRail(map, revision);
		});
		const document = new RailDocument();
		for (const [start, end] of [
			[
				{ x: 0, y: 0 },
				{ x: 9, y: 0 },
			],
			[
				{ x: 9, y: 0 },
				{ x: 9, y: 3 },
			],
			[
				{ x: 9, y: 3 },
				{ x: 0, y: 3 },
			],
			[
				{ x: 0, y: 3 },
				{ x: 0, y: 0 },
			],
		] as const) {
			expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
		}
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const rows = [
			[2, 0],
			[4, 0],
			[6, 0],
			[5, 3],
			[2, 3],
		].map(([x, z]) => {
			for (let row = 0; row < slots.count; row++) {
				if (
					slots.routeXs[row] === x &&
					slots.routeZs[row] === z &&
					slots.statuses[row] === PORT_SLOT_STATUS.LEGAL
				) {
					return row;
				}
			}
			throw new Error(`expected FLEX STK mirror slot at ${x}:${z}`);
		});

		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		const compileCountBefore = compileCount;
		const beforePublication = mirror.getPhysicalPublication();
		document.subscribe((event) => mirror.applyPatch(event));
		const plan = planStkPlacement(
			slots,
			rows,
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(compileCount).toBe(compileCountBefore);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			checksum: checksumRailMap(document.map, document.portEquipment),
			ports: 5,
			equipmentGroups: 1,
		});
		const publication = mirror.getPhysicalPublication();
		expect(publication.kind).toBe("static");
		expect(publication.current.buffers).toBe(beforePublication.current.buffers);

		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 0, equipmentGroups: 0 });
		expect(document.redo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 5, equipmentGroups: 1 });
		expect(compileCount).toBe(compileCountBefore);

		const snapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot;
		const resetMirror = new RailPatchMirror();
		expect(resetMirror.sync(snapshot)).toMatchObject({ ports: 5, equipmentGroups: 1 });
		const invalidSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot;
		invalidSnapshot.portEquipment.ports.stationMillimeters[0] = 499;
		expect(() => new RailPatchMirror().sync(invalidSnapshot)).toThrow("500 mm cell-center station");
	});

	it("mirrors atomic FLEX STK move and copy commands with stable physical buffers", () => {
		let compileCount = 0;
		const mirror = new RailPatchMirror((map, revision) => {
			compileCount++;
			return compilePhysicalRail(map, revision);
		});
		const document = new RailDocument();
		for (const [start, end] of [
			[
				{ x: 0, y: 0 },
				{ x: 18, y: 0 },
			],
			[
				{ x: 18, y: 0 },
				{ x: 18, y: 4 },
			],
			[
				{ x: 18, y: 4 },
				{ x: 0, y: 4 },
			],
			[
				{ x: 0, y: 4 },
				{ x: 0, y: 0 },
			],
		] as const) {
			expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
		}
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const placement = planStkPlacement(
			slots,
			[portSlotRowAt(slots, 2, 0), portSlotRowAt(slots, 4, 0), portSlotRowAt(slots, 4, 4)],
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(placement.valid, placement.reason).toBe(true);
		expect(document.commitPortEquipment(placement)).toBe(true);
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		const compileCountBefore = compileCount;
		const beforePublication = mirror.getPhysicalPublication();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => {
			events.push(event);
			mirror.applyPatch(event);
		});
		const group = document.portEquipment.equipmentGroups[0];
		const anchorPortId = group?.portIds[0] as number;
		const move = planPortEquipmentGroupEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			group?.id as number,
			anchorPortId,
			portSlotRowAt(slots, 8, 0),
			"move",
			document.map.getRevision(),
			document.getPatchSequence(),
		);

		expect(move.valid, move.reason).toBe(true);
		expect(document.commitPortEquipment(move)).toBe(true);
		expect(events.at(-1)).toMatchObject({
			kind: "edit-port-equipment",
			portChanges: { length: 3 },
		});
		expect(mirror.state).toMatchObject({ ports: 3, equipmentGroups: 1 });
		expect(mirror.getPhysicalPublication().current.buffers).toBe(beforePublication.current.buffers);
		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 3, equipmentGroups: 1 });
		expect(document.redo()).toBe(true);
		expect(mirror.state.checksum).toBe(checksumRailMap(document.map, document.portEquipment));

		const copy = planPortEquipmentGroupEdit(
			document.map,
			slots,
			new PortEquipmentGroupSlotIndex(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			group?.id as number,
			anchorPortId,
			portSlotRowAt(slots, 13, 0),
			"copy",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(copy.valid, copy.reason).toBe(true);
		expect(copy.groupEdit).toMatchObject({
			sourceEquipmentGroupId: 1,
			targetEquipmentGroupId: 2,
			portTargets: { length: 3 },
		});
		expect(document.commitPortEquipment(copy)).toBe(true);
		expect(events.at(-1)).toMatchObject({
			kind: "place-stk",
			portChanges: { length: 3 },
			equipmentGroupChanges: { length: 1 },
		});
		expect(mirror.state).toMatchObject({
			ports: 6,
			equipmentGroups: 2,
			checksum: checksumRailMap(document.map, document.portEquipment),
		});
		expect(mirror.getPhysicalPublication().current.buffers).toBe(beforePublication.current.buffers);
		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 3, equipmentGroups: 1 });
		expect(document.redo()).toBe(true);
		expect(mirror.state).toMatchObject({ ports: 6, equipmentGroups: 2 });
		expect(compileCount).toBe(compileCountBefore);
	});

	it("rolls back a rail patch that would orphan an authored port", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(document.commitPortEquipment(ohbPlan(document))).toBe(true);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		const beforeState = mirror.state;
		const beforePublication = mirror.getPhysicalPublication();
		const revision = document.map.getRevision();
		const patch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: document.getPatchSequence() + 1,
			kind: "erase",
			baseRevision: revision,
			revision: revision + 1,
			changes: [{ x: 1, y: 0, before: document.map.getEncoded(1, 0), after: 0 }],
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
		};

		expect(() => mirror.applyPatch(patch)).toThrow(/Port equipment layout is invalid/);
		expect(mirror.state).toEqual(beforeState);
		expect(mirror.getPhysicalPublication()).toBe(beforePublication);
	});

	it("rejects malformed multi-port EQ patches even when reciprocal IDs are valid", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const before = mirror.state;
		const ports: PortRecord[] = [1, 2].map((id) => ({
			id,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x: id, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL",
			portType: "EQ",
			barcode: `EQ-1-P0${id}`,
		}));
		const patch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: document.getPatchSequence() + 1,
			kind: "place-eq",
			baseRevision: document.map.getRevision(),
			revision: document.map.getRevision(),
			changes: [],
			switchChanges: [],
			portChanges: ports.map((port) => ({ id: port.id, before: null, after: port })),
			equipmentGroupChanges: [
				{
					id: 1,
					before: null,
					after: {
						id: 1,
						kind: "EQ",
						pitchMillimeters: 1_000,
						recipe: null,
						portIds: [1, 2],
					},
				},
			],
		};

		expect(() => mirror.applyPatch(patch)).toThrow("zero-offset CENTER");
		expect(mirror.state).toEqual(before);
	});

	it("rejects a forged gapped STK template atomically", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 7, y: 0 })),
		).toBe(true);
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const before = mirror.state;
		const ports: PortRecord[] = [1, 2, 3, 5].map((x, index) => ({
			id: index + 1,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "STK",
			barcode: `STK-1-P0${index + 1}`,
		}));
		const patch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: document.getPatchSequence() + 1,
			kind: "place-stk",
			baseRevision: document.map.getRevision(),
			revision: document.map.getRevision(),
			changes: [],
			switchChanges: [],
			portChanges: ports.map((port) => ({ id: port.id, before: null, after: port })),
			equipmentGroupChanges: [
				{
					id: 1,
					before: null,
					after: { id: 1, kind: "STK", template: "FOUR_PORT", portIds: [1, 2, 3, 4] },
				},
			],
		};

		expect(() => mirror.applyPatch(patch)).toThrow("consecutive 1 m rail cells");
		expect(mirror.state).toEqual(before);
	});

	it("rejects a forged new CUSTOM STK while preserving legacy CUSTOM undo", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 6, y: 0 }))).toBe(
			true,
		);
		const port: PortRecord = {
			id: 1,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x: 2, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "STK",
			barcode: "STK-1-P01",
		};
		const group = { id: 1, kind: "STK" as const, template: "CUSTOM" as const, portIds: [1] };
		const forgedMirror = new RailPatchMirror();
		forgedMirror.sync(captureRailMirrorSnapshot(source.map, source.getPatchSequence()).snapshot);
		const before = forgedMirror.state;
		const forgedPatch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: source.getPatchSequence() + 1,
			kind: "place-stk",
			baseRevision: source.map.getRevision(),
			revision: source.map.getRevision(),
			changes: [],
			switchChanges: [],
			portChanges: [{ id: 1, before: null, after: port }],
			equipmentGroupChanges: [{ id: 1, before: null, after: group }],
		};
		expect(() => forgedMirror.applyPatch(forgedPatch)).toThrow("legacy load-only");
		expect(forgedMirror.state).toEqual(before);

		const legacyState: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [port],
			equipmentGroups: [group],
		};
		const document = RailDocument.fromLoadedMap(source.map, 0, legacyState);
		const legacyMirror = new RailPatchMirror();
		legacyMirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		const relocatedPort = { ...port, stationMillimeters: 600 };
		const forgedPortPatch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: 1,
			kind: "edit-port-equipment",
			baseRevision: document.map.getRevision(),
			revision: document.map.getRevision(),
			changes: [],
			switchChanges: [],
			portChanges: [{ id: port.id, before: port, after: relocatedPort }],
			equipmentGroupChanges: [],
		};
		expect(() => legacyMirror.applyPatch(forgedPortPatch)).toThrow("port 1 is legacy load-only");
		expect(legacyMirror.state).toMatchObject({ sequence: 0, ports: 1, equipmentGroups: 1 });
		expect(
			document.commitPortEquipment(
				createPortEquipmentMutationPlan(
					"edit-port-equipment",
					document.map.getRevision(),
					document.getPatchSequence(),
					forgedPortPatch.portChanges,
					[],
				),
			),
		).toBe(false);
		expect(document.portEquipment.ports[0]).toEqual(port);
		document.subscribe((event) => legacyMirror.applyPatch(event));
		expect(document.clear()).toBe(true);
		expect(document.undo()).toBe(true);
		expect(legacyMirror.state).toMatchObject({ ports: 1, equipmentGroups: 1 });
	});

	it("preserves a deleted CUSTOM baseline across Worker resync for exact undo", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 6, y: 0 }))).toBe(
			true,
		);
		const ports: PortRecord[] = [2, 4].map((x, index) => ({
			id: index + 1,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "STK",
			barcode: `LEGACY-STK-P0${index + 1}`,
		}));
		const legacyState: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			ports,
			equipmentGroups: [{ id: 1, kind: "STK", template: "CUSTOM", portIds: [1, 2] }],
		};
		const document = RailDocument.fromLoadedMap(source.map, 0, legacyState);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		const flexReplacement: PortEquipmentState = {
			...legacyState,
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] }],
		};
		expect(() =>
			mirror.sync(
				captureRailMirrorSnapshot(document.map, document.getPatchSequence(), flexReplacement)
					.snapshot,
			),
		).toThrow("legacy load-only");
		document.subscribe((event) => mirror.applyPatch(event));

		expect(document.clear()).toBe(true);
		expect(mirror.state).toMatchObject({ sequence: 1, ports: 0, equipmentGroups: 0 });
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
			document.captureRailMirrorHistoryLedger(),
		);
		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({ sequence: 2, ports: 2, equipmentGroups: 1 });
	});

	it("accepts FLEX ports on safe cells separated by a rail gap", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 })),
		).toBe(true);
		expect(document.commit(planRailErase(document.map, [{ x: 5, y: 0 }]))).toBe(true);
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const ports: PortRecord[] = [2, 8].map((x, index) => ({
			id: index + 1,
			equipmentGroupId: 1,
			route: { kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "STK",
			barcode: `STK-1-P0${index + 1}`,
		}));
		const patch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: document.getPatchSequence() + 1,
			kind: "place-stk",
			baseRevision: document.map.getRevision(),
			revision: document.map.getRevision(),
			changes: [],
			switchChanges: [],
			portChanges: ports.map((port) => ({ id: port.id, before: null, after: port })),
			equipmentGroupChanges: [
				{
					id: 1,
					before: null,
					after: { id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] },
				},
			],
		};

		expect(() => mirror.applyPatch(patch)).not.toThrow();
		expect(mirror.state).toMatchObject({ sequence: patch.sequence, ports: 2, equipmentGroups: 1 });
	});

	it("rejects a forged FLEX station in a compiled unsafe approach cell", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 6, y: 0 }, { x: 6, y: 4 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).STK.slots;
		const row = Array.from({ length: slots.count }, (_, index) => index).find(
			(index) => slots.statuses[index] === PORT_SLOT_STATUS.UNSAFE_APPROACH,
		);
		if (row === undefined) throw new Error("expected one unsafe STK approach slot");
		const port: PortRecord = {
			id: 1,
			equipmentGroupId: 1,
			route: {
				kind: "CARDINAL_CELL",
				x: slots.routeXs[row] as number,
				z: slots.routeZs[row] as number,
				from: slots.routeFromDirections[row] as typeof DIR_W,
				to: slots.routeToDirections[row] as typeof DIR_E,
			},
			stationMillimeters: slots.stationMillimeters[row] as number,
			side: "CENTER",
			lateralOffsetMillimeters: 0,
			direction: "WITH_TRAVEL",
			portType: "STK",
			barcode: "STK-1-P01",
		};
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const before = mirror.state;
		const patch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: document.getPatchSequence() + 1,
			kind: "place-stk",
			baseRevision: document.map.getRevision(),
			revision: document.map.getRevision(),
			changes: [],
			switchChanges: [],
			portChanges: [{ id: 1, before: null, after: port }],
			equipmentGroupChanges: [
				{
					id: 1,
					before: null,
					after: { id: 1, kind: "STK", template: "FLEX", portIds: [1] },
				},
			],
		};

		expect(() => mirror.applyPatch(patch)).toThrow("safe straight approach cell");
		expect(mirror.state).toEqual(before);
	});

	it("rejects a FLEX reservation around an existing side-mounted OHB atomically", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const catalog = compilePortSlotPreparedArtifactCatalog(physical);
		const ohbRow = Array.from({ length: catalog.OHB.slots.count }, (_, index) => index).find(
			(index) =>
				catalog.OHB.slots.routeXs[index] === 4 &&
				catalog.OHB.slots.sides[index] === 1 &&
				catalog.OHB.slots.statuses[index] === PORT_SLOT_STATUS.LEGAL,
		);
		if (ohbRow === undefined) throw new Error("expected side OHB slot at 4:0");
		const ohbPlan = planOhbPlacement(
			catalog.OHB.slots,
			ohbRow,
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "OHB"),
			document.portEquipment,
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(document.commitPortEquipment(ohbPlan)).toBe(true);

		const stkRows = [2, 6].map((x) => {
			const row = Array.from({ length: catalog.STK.slots.count }, (_, index) => index).find(
				(index) =>
					catalog.STK.slots.routeXs[index] === x &&
					catalog.STK.slots.routeZs[index] === 0 &&
					catalog.STK.slots.statuses[index] === PORT_SLOT_STATUS.LEGAL,
			);
			if (row === undefined) throw new Error(`expected STK slot at ${x}:0`);
			return row;
		});
		const ports = stkRows.map(
			(row, index): PortRecord => ({
				id: index + 2,
				equipmentGroupId: 2,
				route: {
					kind: "CARDINAL_CELL",
					x: catalog.STK.slots.routeXs[row] as number,
					z: catalog.STK.slots.routeZs[row] as number,
					from: catalog.STK.slots.routeFromDirections[row] as typeof DIR_W,
					to: catalog.STK.slots.routeToDirections[row] as typeof DIR_E,
				},
				stationMillimeters: catalog.STK.slots.stationMillimeters[row] as number,
				side: "CENTER",
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL",
				portType: "STK",
				barcode: `STK-2-P0${index + 1}`,
			}),
		);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(document.map, document.getPatchSequence(), document.portEquipment)
				.snapshot,
		);
		const patch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: document.getPatchSequence() + 1,
			kind: "place-stk",
			baseRevision: document.map.getRevision(),
			revision: document.map.getRevision(),
			changes: [],
			switchChanges: [],
			portChanges: ports.map((port) => ({ id: port.id, before: null, after: port })),
			equipmentGroupChanges: [
				{
					id: 2,
					before: null,
					after: { id: 2, kind: "STK", template: "FLEX", portIds: [2, 3] },
				},
			],
		};

		const before = mirror.state;
		expect(() => mirror.applyPatch(patch)).toThrow(
			"STK group 2 reservation crosses equipment group 1",
		);
		expect(mirror.state).toEqual(before);
	});

	it("rejects sequence and before-value mismatches without partial mutation", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 3, y: 0 }));
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const before = mirror.state;
		const revision = document.map.getRevision();
		const emptyPatch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: document.getPatchSequence() + 1,
			kind: "erase",
			baseRevision: revision,
			revision,
			changes: [],
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
		};
		expect(() => mirror.applyPatch(emptyPatch)).toThrow("at least one authored change");
		expect(mirror.state).toEqual(before);

		const sequenceGap: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: document.getPatchSequence() + 2,
			kind: "erase",
			baseRevision: revision,
			revision: revision + 1,
			changes: [{ x: 0, y: 0, before: document.map.getEncoded(0, 0), after: 0 }],
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
		};
		expect(() => mirror.applyPatch(sequenceGap)).toThrow("sequence gap");
		expect(mirror.state).toEqual(before);

		const wrongBefore: RailPatchEvent = {
			...sequenceGap,
			sequence: document.getPatchSequence() + 1,
			changes: [{ x: 0, y: 0, before: 0, after: encodeRailCell({ incoming: 0, outgoing: DIR_N }) }],
		};
		expect(() => mirror.applyPatch(wrongBefore)).toThrow("before-value mismatch");
		expect(mirror.state).toEqual(before);
	});

	it("rejects protected rail edits even when the patch creates an unrelated organization", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 9, y: 1 }),
			document.portEquipment,
			document.getPatchSequence(),
			[],
		);
		expect(
			document.commitOrganization(
				planCreateStaticFabOrganizationFromSelection(
					document.map,
					ownership,
					document.portEquipment,
					document.getPatchSequence(),
					document.organizations,
					selection,
					"Protected Area",
				),
			),
		).toBe(true);
		const protectedArea = document.organizations.records[0];
		if (!protectedArea) throw new Error("expected protected AREA fixture");
		const unaffectedEdge = protectedArea.membership.railEdges.find(
			(edge) => edge.from.x >= 5 || edge.to.x >= 5,
		);
		if (!unaffectedEdge) throw new Error("expected unaffected rail edge");
		const unrelatedBay = Object.freeze({
			id: 2,
			kind: "BAY" as const,
			name: "Unrelated Bay",
			membership: Object.freeze({
				railEdges: Object.freeze([unaffectedEdge]),
				advancedSwitchIds: Object.freeze([]),
				equipmentGroupIds: Object.freeze([]),
			}),
		});
		const erase = planRailErase(document.map, [{ x: 2, y: 0 }]);
		expect(erase.valid, erase.reason).toBe(true);
		const mirror = new RailPatchMirror();
		mirror.sync(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot,
		);
		const before = mirror.state;
		const publicationBefore = mirror.getPhysicalPublication();
		const patch: RailPatchEvent = {
			sequence: document.getPatchSequence() + 1,
			kind: "erase",
			baseRevision: erase.baseRevision,
			revision: erase.baseRevision + erase.mutations.length,
			changes: erase.mutations,
			switchChanges: erase.switchMutations,
			portChanges: [],
			equipmentGroupChanges: [],
			organizationChanges: [{ id: unrelatedBay.id, before: null, after: unrelatedBay }],
			organizationNextIdBefore: 2,
			organizationNextIdAfter: 3,
		};

		expect(() => mirror.applyPatch(patch)).toThrow("AREA-1");
		expect(mirror.state).toEqual(before);
		expect(mirror.getPhysicalPublication()).toBe(publicationBefore);

		const renamedArea = Object.freeze({ ...protectedArea, name: "Renamed Area" });
		expect(() =>
			mirror.applyPatch({
				...patch,
				organizationChanges: [{ id: protectedArea.id, before: protectedArea, after: renamedArea }],
				organizationNextIdAfter: 2,
			}),
		).toThrow("AREA-1");
		expect(mirror.state).toEqual(before);

		const unrelatedMembershipArea = Object.freeze({
			...protectedArea,
			membership: Object.freeze({
				...protectedArea.membership,
				railEdges: Object.freeze(protectedArea.membership.railEdges.slice(0, -1)),
			}),
		});
		expect(() =>
			mirror.applyPatch({
				...patch,
				organizationChanges: [
					{
						id: protectedArea.id,
						before: protectedArea,
						after: unrelatedMembershipArea,
					},
				],
				organizationNextIdAfter: 2,
			}),
		).toThrow("AREA-1");
		expect(mirror.state).toEqual(before);
		expect(mirror.getPhysicalPublication()).toBe(publicationBefore);
	});
});

function emptyOrganizationPatch(): Pick<
	RailPatchEvent,
	"organizationChanges" | "organizationNextIdBefore" | "organizationNextIdAfter"
> {
	return {
		organizationChanges: [],
		organizationNextIdBefore: 1,
		organizationNextIdAfter: 1,
	};
}

function portSlotRowAt(slots: CompiledPortSlots, x: number, z: number): number {
	for (let row = 0; row < slots.count; row++) {
		if (
			slots.routeXs[row] === x &&
			slots.routeZs[row] === z &&
			slots.statuses[row] === PORT_SLOT_STATUS.LEGAL
		) {
			return row;
		}
	}
	throw new Error(`expected ${slots.portType} slot at ${x}:${z}`);
}

function ohbPlan(document: RailDocument) {
	const port: PortRecord = {
		id: document.portEquipment.nextPortId,
		equipmentGroupId: document.portEquipment.nextEquipmentGroupId,
		route: { kind: "CARDINAL_CELL" as const, x: 1, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters: 500,
		side: "LEFT" as const,
		lateralOffsetMillimeters: 700,
		direction: "WITH_TRAVEL" as const,
		portType: "OHB" as const,
		barcode: "OHB-001",
	};
	const group = {
		id: port.equipmentGroupId,
		kind: "OHB" as const,
		template: "SINGLE" as const,
		portIds: [port.id],
	};
	return createPortEquipmentMutationPlan(
		"place-ohb",
		document.map.getRevision(),
		document.getPatchSequence(),
		[{ id: port.id, before: null, after: port }],
		[{ id: group.id, before: null, after: group }],
	);
}

describe("rail mirror checksum", () => {
	it("is stable across chunk insertion order and negative coordinates", () => {
		const cells = [
			[-40, -7, encodeRailCell({ incoming: DIR_S, outgoing: DIR_E })],
			[0, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E })],
			[65, 33, encodeRailCell({ incoming: DIR_N, outgoing: DIR_W })],
		] as const;
		const forward = new TileMap();
		const reverse = new TileMap();
		for (const [x, y, encoded] of cells) forward.setEncoded(x, y, encoded);
		for (const [x, y, encoded] of [...cells].reverse()) reverse.setEncoded(x, y, encoded);

		expect(checksumRailMap(forward)).toBe(checksumRailMap(reverse));
	});
});
