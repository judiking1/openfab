import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { portEquipmentGroupSlotIndexFor } from "../compile/PortEquipmentGroupEditPlanner";
import { planPortEquipmentMembershipEdit } from "../compile/PortEquipmentMembershipEditPlanner";
import { planEqRowPlacement, planStkPlacement } from "../compile/PortPlacementPlanner";
import { PORT_SLOT_STATUS, PortSlotAvailabilityIndex } from "../compile/PortSlotCompiler";
import {
	compilePortSlotPreparedArtifactCatalog,
	compilePortSlotPreparedArtifacts,
} from "../compile/PortSlotPreparedArtifacts";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	checksumOperationalConfiguration,
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { planRailConstruction, planRailPath } from "../core/paint";
import { createRailAreaSelection } from "../core/RailAreaSelection";
import type { RailAreaStampTemplate } from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "../core/RailModuleOwnership";
import {
	DIR_E,
	DIR_W,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "../core/railShape";
import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import type { StaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import { planCreateStaticFabOrganizationFromSelection } from "../core/StaticFabOrganizationPlan";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { type Cell, decodeRailCell, encodeRailCell, TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { hydrateStaticFabAssemblyRelationshipSnapshot } from "../worker/StaticFabAssemblyRelationshipSoA";
import { hydrateStaticFabOrganizationSnapshot } from "../worker/StaticFabOrganizationSoA";
import legacyOrganizationRecord from "./fixtures/legacy-organization-blueprint-v1.json";
import {
	createOpenFabRailAreaBlueprint,
	createOpenFabStaticFabBlueprint,
	createOpenFabStaticFabOrganizationBlueprint,
	OPENFAB_BLUEPRINT_MAX_EDGES_PER_RECORD,
	OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
	type OpenFabStaticFabBlueprintEquipmentGroup,
	type OpenFabStaticFabBlueprintPort,
} from "./OpenFabBlueprintLibrary";
import {
	captureOpenFabProject,
	createOpenFabProjectManifest,
	createPortEquipmentStateFromOpenFabProject,
	createRailSnapshotFromOpenFabProject,
	OPENFAB_PROJECT_KIND,
	OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER,
	type OpenFabProject,
	updateOpenFabProjectManifest,
} from "./OpenFabProject";
import {
	OpenFabProjectParseError,
	parseOpenFabProjectJson,
	parseOpenFabProjectValue,
	serializeOpenFabProject,
} from "./OpenFabProjectCodec";

describe("OpenFab project codec", () => {
	it("saves a valid project created on a clock ahead of the current host", () => {
		const sourceManifest = createOpenFabProjectManifest(
			"clock-ahead-project",
			"Future clock",
			"2099-01-01T00:00:00.000Z",
		);
		const source = captureOpenFabProject(new RailDocument(), { manifest: sourceManifest });
		const loaded = parseOpenFabProjectJson(serializeOpenFabProject(source)).project;
		const manifest = updateOpenFabProjectManifest(
			loaded.manifest,
			"2026-01-01T00:00:00.000Z",
			"Renamed while clock is behind",
		);
		const reopened = parseOpenFabProjectJson(
			serializeOpenFabProject({ ...loaded, manifest }),
		).project;

		expect(reopened.manifest).toEqual({
			...sourceManifest,
			name: "Renamed while clock is behind",
		});
		expect(reopened.rail).toEqual(source.rail);
		expect(source.manifest).toStrictEqual(sourceManifest);
	});

	it("keeps successive manifest updates monotonic across clock rollback and recovery", () => {
		const first = updateOpenFabProjectManifest(MANIFEST, "2026-07-19T00:00:00.000Z");
		const rollback = updateOpenFabProjectManifest(first, "2026-07-18T12:00:00.000Z");
		const equal = updateOpenFabProjectManifest(rollback, rollback.updatedAt);
		const recovered = updateOpenFabProjectManifest(equal, "2026-07-20T00:00:00.000Z");

		expect(rollback.updatedAt).toBe(first.updatedAt);
		expect(equal.updatedAt).toBe(first.updatedAt);
		expect(recovered.updatedAt).toBe("2026-07-20T00:00:00.000Z");
		expect(recovered.createdAt).toBe(MANIFEST.createdAt);
		expect(Object.isFrozen(recovered)).toBe(true);
	});

	it("does not hide malformed save timestamps behind a later valid manifest instant", () => {
		const source = captureOpenFabProject(new RailDocument(), { manifest: MANIFEST });
		for (const timestamp of [
			"",
			"2020-01-01",
			"2020-01-01T00:00:00Z",
			"2020-01-01T00:00:00.000+00:00",
			"2020-02-30T00:00:00.000Z",
			"not-a-date",
		]) {
			const manifest = updateOpenFabProjectManifest(MANIFEST, timestamp);
			expect(manifest.updatedAt).toBe(timestamp);
			expect(() => serializeOpenFabProject({ ...source, manifest })).toThrow(
				OpenFabProjectParseError,
			);
		}
	});

	it("round-trips reviewed non-geometric operational configuration in project v12", () => {
		const document = new RailDocument();
		const sourceSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		const operations = reviewOperationalConfiguration(
			{
				...emptyOperationalConfigurationState(),
				revision: 1,
				nextResidentHomeSlotId: 2,
				residentHomeSlots: [
					{ id: 1, vehicleId: "OHT-001", anchorPortId: 7, policy: "DEDICATED_HOME_RETURN" },
				],
				vehicleProfile: {
					id: "OPENFAB_TEST_OHT_V1",
					version: 1,
					bodyLengthMillimeters: 1_200,
					referenceToFrontMillimeters: 600,
					referenceToRearMillimeters: 600,
					bodyWidthMillimeters: 500,
					lateralSafetyMarginMillimeters: 50,
					frontSafetyMarginMillimeters: 200,
					rearSafetyMarginMillimeters: 200,
					maximumSpeedMillimetersPerSecond: 2_000,
					controlReactionMilliseconds: 100,
					minimumServiceDecelerationMillimetersPerSecondSquared: 1_000,
				},
			},
			{
				revision: document.map.getRevision(),
				authoredChecksum: sourceSnapshot.checksum,
			},
		);
		const project = captureOpenFabProject(document, { manifest: MANIFEST, operations });
		const serialized = serializeOpenFabProject(project);
		expect(serializeOpenFabProject(project, serialized.length)).toBe(serialized);
		expect(() => serializeOpenFabProject(project, serialized.length - 1)).toThrow(
			/serialization limit/,
		);
		const parsed = parseOpenFabProjectJson(serialized);

		expect(parsed.project.schemaVersion).toBe(12);
		expect(parsed.project.operations).toEqual(operations);
		expect(Object.isFrozen(parsed.project.operations)).toBe(true);
		expect(Object.isFrozen(parsed.project.operations.vehicleProfile)).toBe(true);
		expect(Object.isFrozen(parsed.project.operations.residentHomeSlots[0])).toBe(true);
		expect(serializeOpenFabProject(parsed.project)).toBe(serialized);

		const unknownField = mutableCopy(project);
		(unknownField.operations as Record<string, unknown>).runtimeWorker = true;
		expectProjectError(unknownField, "INVALID_FIELD", "$.operations.runtimeWorker");

		const hiddenHomeSource = mutableCopy(project);
		(
			(hiddenHomeSource.operations as { residentHomeSlots: Record<string, unknown>[] })
				.residentHomeSlots[0] as Record<string, unknown>
		).sourceRow = "must-not-cross";
		expectProjectError(
			hiddenHomeSource,
			"INVALID_FIELD",
			"$.operations.residentHomeSlots[0].sourceRow",
		);

		const inconsistentProfile = mutableCopy(project);
		const profile = (
			inconsistentProfile.operations as {
				vehicleProfile: { bodyLengthMillimeters: number };
			}
		).vehicleProfile;
		profile.bodyLengthMillimeters += 1;
		expectProjectError(inconsistentProfile, "INVALID_FIELD", "$.operations");
	});

	it("migrates a reviewed project v9 operational schema v1 without trusting a stale fingerprint", () => {
		const legacy = mutableCopy(captureOpenFabProject(new RailDocument(), { manifest: MANIFEST }));
		legacy.schemaVersion = 9;
		if (!legacy.blueprints) throw new Error("Legacy blueprint section missing");
		legacy.blueprints.schemaVersion = 3;
		delete legacy.relationships;
		const legacyFingerprint = new OrderedTypedChecksum();
		legacyFingerprint.addNumbers([1, 0, 3, 1, 1, 0, 2, 1, 0, 0, 0, 0, 0]);
		legacyFingerprint.addNumber(1);
		legacyFingerprint.addString("ETCH");
		legacyFingerprint.addNumber(2);
		legacyFingerprint.addString("METROLOGY");
		legacyFingerprint.addNumber(7);
		legacyFingerprint.addNumbers([1, 2]);
		legacy.operations = {
			schemaVersion: 1,
			revision: 0,
			nextEqCapabilityId: 3,
			nextStorageClassId: 1,
			nextStoragePolicyId: 1,
			stationCapabilities: [],
			eqCapabilities: [
				{ id: 2, key: "METROLOGY" },
				{ id: 1, key: "ETCH" },
			],
			eqGroupQualifications: [{ equipmentGroupId: 7, capabilityIds: [2, 1] }],
			eqPortQualificationOverrides: [],
			storageClasses: [],
			storagePolicies: [],
			storageGroups: [],
			vehicleProfile: null,
			review: {
				sourceRevision: 0,
				sourceAuthoredChecksum: "reviewed-v9-source",
				configurationFingerprint: legacyFingerprint.digest(),
			},
		};

		const migrated = parseOpenFabProjectValue(legacy);

		expect(migrated.migratedFromVersion).toBe(9);
		expect(migrated.project.schemaVersion).toBe(12);
		expect(migrated.project.operations).toMatchObject({
			schemaVersion: 2,
			nextResidentHomeSlotId: 1,
			residentHomeSlots: [],
			eqCapabilities: [
				{ id: 1, key: "ETCH" },
				{ id: 2, key: "METROLOGY" },
			],
			eqGroupQualifications: [{ equipmentGroupId: 7, capabilityIds: [1, 2] }],
			review: {
				sourceRevision: 0,
				sourceAuthoredChecksum: "reviewed-v9-source",
			},
		});
		expect(migrated.project.operations.review?.configurationFingerprint).toBe(
			checksumOperationalConfiguration(migrated.project.operations),
		);
		expect(migrated.project.operations.review?.configurationFingerprint).not.toBe(
			legacyFingerprint.digest(),
		);

		const stale = structuredClone(legacy);
		(
			stale.operations as { review: { configurationFingerprint: string } }
		).review.configurationFingerprint = "stale-v9-fingerprint";
		expectProjectError(stale, "INVALID_FIELD", "$.operations.review.configurationFingerprint");
	});

	it("upgrades root v10 once with an explicit empty relationship section and no inference", () => {
		const legacy = mutableCopy(captureOpenFabProject(new RailDocument(), { manifest: MANIFEST }));
		legacy.schemaVersion = 10;
		if (!legacy.blueprints) throw new Error("Legacy blueprint section missing");
		legacy.blueprints.schemaVersion = 3;
		delete legacy.relationships;

		const migrated = parseOpenFabProjectValue(legacy);

		expect(migrated.migratedFromVersion).toBe(10);
		expect(migrated.project.schemaVersion).toBe(12);
		expect(migrated.project.relationships).toEqual({
			schemaVersion: 1,
			nextRelationshipId: 1,
			records: [],
		});
		expect(Object.isFrozen(migrated.project.relationships)).toBe(true);
		expect(
			parseOpenFabProjectJson(serializeOpenFabProject(migrated.project)).migratedFromVersion,
		).toBeNull();
	});

	it("migrates native v11 blueprints while preserving nonempty authored relationships", () => {
		const current = captureOpenFabProject(relationshipPersistenceDocument(), {
			manifest: MANIFEST,
		});
		const legacy = {
			...current,
			schemaVersion: 11,
			blueprints: { schemaVersion: 3, records: [legacyOrganizationRecord.blueprint] },
		};
		const migrated = parseOpenFabProjectValue(legacy);
		expect(migrated.migratedFromVersion).toBe(11);
		expect(migrated.project.schemaVersion).toBe(12);
		expect(migrated.project.relationships).toEqual(current.relationships);
		const blueprint = migrated.project.blueprints.records[0];
		if (blueprint?.kind !== "STATIC_FAB_ORGANIZATION") throw new Error("Missing migrated bundle");
		expect(blueprint.bundle.relationships).toEqual({ nextRelationshipId: 1, records: [] });
		expect(
			parseOpenFabProjectJson(serializeOpenFabProject(migrated.project)).migratedFromVersion,
		).toBeNull();
		for (const schemaVersion of [10, 11]) {
			const source: Record<string, unknown> = { ...legacy };
			if (schemaVersion === 10) delete source.relationships;
			expectProjectError(
				{ ...source, schemaVersion, blueprints: migrated.project.blueprints },
				"INVALID_FIELD",
				"$.blueprints.schemaVersion",
			);
			expectProjectError(
				{ ...source, schemaVersion, blueprints: { schemaVersion: 3, records: [blueprint] } },
				"INVALID_FIELD",
				".bundle.relationships",
			);
		}
		expectProjectError(
			{ ...migrated.project, blueprints: legacy.blueprints },
			"INVALID_FIELD",
			"$.blueprints.schemaVersion",
		);
	});

	it("strictly validates the native v12 relationship envelope and bounded core shape", () => {
		const project = captureOpenFabProject(new RailDocument(), { manifest: MANIFEST });
		expect(project.relationships).toEqual({
			schemaVersion: 1,
			nextRelationshipId: 1,
			records: [],
		});

		const unknownField = mutableCopy(project);
		(unknownField.relationships as unknown as Record<string, unknown>).workerCache = [];
		expectProjectError(unknownField, "INVALID_FIELD", "$.relationships.workerCache");

		const invalidCursor = mutableCopy(project);
		if (!invalidCursor.relationships) throw new Error("Expected relationship section.");
		invalidCursor.relationships.nextRelationshipId = 0;
		expectProjectError(invalidCursor, "INVALID_RELATIONSHIP", "$.relationships");
	});

	it("round-trips a non-empty relationship through project v12 and the rail snapshot", () => {
		const document = relationshipPersistenceDocument();
		const project = captureOpenFabProject(document, { manifest: MANIFEST });
		const parsed = parseOpenFabProjectJson(serializeOpenFabProject(project));
		const snapshot = createRailSnapshotFromOpenFabProject(parsed.project);

		expect(parsed.migratedFromVersion).toBeNull();
		expect(parsed.project.relationships).toEqual(project.relationships);
		expect(hydrateStaticFabAssemblyRelationshipSnapshot(snapshot.relationships)).toEqual(
			document.relationships,
		);
		expect(snapshot.checksum).toBe(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot.checksum,
		);
	});

	it("migrates schema v8 into an explicit unresolved operational draft", () => {
		const legacy = mutableCopy(captureOpenFabProject(new RailDocument(), { manifest: MANIFEST }));
		legacy.schemaVersion = 8;
		if (!legacy.blueprints) throw new Error("Legacy blueprint section missing");
		legacy.blueprints.schemaVersion = 3;
		delete legacy.operations;
		delete legacy.relationships;

		const migrated = parseOpenFabProjectValue(legacy);

		expect(migrated.migratedFromVersion).toBe(8);
		expect(migrated.project.schemaVersion).toBe(12);
		expect(migrated.project.operations).toEqual(emptyOperationalConfigurationState());
		expect(
			parseOpenFabProjectJson(serializeOpenFabProject(migrated.project)).migratedFromVersion,
		).toBeNull();
	});

	it("round-trips persistent AREA membership and metadata through project v12 and Worker startup", () => {
		const source = new RailDocument();
		expect(source.commit(planRailConstruction(source.map, { x: 0, y: 0 }, { x: 5, y: 0 }))).toBe(
			true,
		);
		const ownership = buildRailModuleOwnershipIndex(source.map);
		const selection = createStaticFabSelection(
			createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 6, y: 1 }),
			source.portEquipment,
			source.getPatchSequence(),
			[],
		);
		const create = planCreateStaticFabOrganizationFromSelection(
			source.map,
			ownership,
			source.portEquipment,
			source.getPatchSequence(),
			source.organizations,
			selection,
			"Lithography Area",
		);
		expect(create.valid, create.reason).toBe(true);
		expect(source.commitOrganization(create)).toBe(true);
		const document = source;
		const project = captureOpenFabProject(document, { manifest: MANIFEST });
		const parsed = parseOpenFabProjectJson(serializeOpenFabProject(project));
		const snapshot = createRailSnapshotFromOpenFabProject(parsed.project);

		expect(project.schemaVersion).toBe(12);
		expect(parsed.migratedFromVersion).toBeNull();
		expect(parsed.project.areas).toEqual({
			schemaVersion: 2,
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA",
					name: "Lithography Area",
					parentOrganizationIds: [],
					properties: { description: "", color: "TEAL" },
					membership: {
						railEdges: [
							[0, 0, 1, 0],
							[1, 0, 2, 0],
							[2, 0, 3, 0],
							[3, 0, 4, 0],
							[4, 0, 5, 0],
						],
						advancedSwitchIds: [],
						equipmentGroupIds: [],
					},
				},
			],
		});
		expect(hydrateStaticFabOrganizationSnapshot(snapshot.organizations)).toEqual(
			document.organizations,
		);
		expect(snapshot.checksum).toBe(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot.checksum,
		);
	});

	it("persists an empty organization library without rewinding its allocated ID cursor", () => {
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
			"Temporary Area",
		);
		expect(document.commitOrganization(create)).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.organizations).toMatchObject({ nextOrganizationId: 2, records: [] });

		const parsed = parseOpenFabProjectJson(
			serializeOpenFabProject(captureOpenFabProject(document, { manifest: MANIFEST })),
		).project;
		const snapshot = createRailSnapshotFromOpenFabProject(parsed);

		expect(parsed.areas).toMatchObject({ nextOrganizationId: 2, records: [] });
		expect(hydrateStaticFabOrganizationSnapshot(snapshot.organizations)).toEqual({
			nextOrganizationId: 2,
			records: [],
		});
		expect(snapshot.checksum).toBe(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot.checksum,
		);
	});

	it("round-trips rail, ports, and equipment groups canonically", () => {
		const portEquipment = portEquipmentFixture();
		const document = withPortEquipment(createSwitchDocument(), portEquipment);
		const project = captureOpenFabProject(document, {
			manifest: MANIFEST,
			view: {
				center: [3.25, -7.5],
				zoomPixelsPerMeter: 38,
				quarterTurns: 1,
				railPresentation: "profiled",
			},
		});
		const serialized = serializeOpenFabProject(project);
		const parsed = parseOpenFabProjectJson(serialized);
		const savedAgain = serializeOpenFabProject(parsed.project);

		expect(parsed.migratedFromVersion).toBeNull();
		expect(savedAgain).toBe(serialized);
		expect(parsed.project).toEqual(project);
		expect(parsed.project.rail.revision).toBe(document.map.getRevision());
		expect(parsed.project.rail.patchSequence).toBe(document.getPatchSequence());
		expect(parsed.project.rail.nextAdvancedSwitchId).toBe(document.map.getAdvancedSwitchIdCursor());
		expect(parsed.project.rail.advancedSwitches).toHaveLength(1);
		expect(parsed.project.ports.records).toHaveLength(2);
		expect(parsed.project.equipment.records).toHaveLength(2);
		expect(createPortEquipmentStateFromOpenFabProject(parsed.project)).toEqual(
			createPortEquipmentStateFromOpenFabProject(project),
		);

		const beforeSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			portEquipment,
		).snapshot;
		const loadedSnapshot = createRailSnapshotFromOpenFabProject(parsed.project);
		const beforePayload = compileRailStartup({ kind: "snapshot", snapshot: beforeSnapshot });
		const loadedPayload = compileRailStartup({ kind: "snapshot", snapshot: loadedSnapshot });

		expect(loadedSnapshot.checksum).toBe(beforeSnapshot.checksum);
		expect(loadedPayload.authoredChecksum).toBe(beforePayload.authoredChecksum);
		expect(loadedPayload.physical.fingerprint).toBe(beforePayload.physical.fingerprint);
		expect(loadedPayload.readiness.fingerprint).toBe(beforePayload.readiness.fingerprint);
		expect(loadedPayload.snapshot.revision).toBe(beforePayload.snapshot.revision);
		expect(loadedPayload.snapshot.sequence).toBe(beforePayload.snapshot.sequence);
	});

	it("round-trips the fitted overview zoom required by a factory-scale map", () => {
		const project = captureOpenFabProject(new RailDocument(), {
			manifest: MANIFEST,
			view: {
				center: [240, 320],
				zoomPixelsPerMeter: OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER,
				quarterTurns: 0,
				railPresentation: "profiled",
			},
		});

		expect(parseOpenFabProjectJson(serializeOpenFabProject(project)).project.view).toEqual(
			project.view,
		);
		expect(() =>
			parseOpenFabProjectValue({
				...project,
				view: {
					...project.view,
					zoomPixelsPerMeter: OPENFAB_PROJECT_VIEW_MIN_ZOOM_PIXELS_PER_METER - 0.01,
				},
			}),
		).toThrowError(OpenFabProjectParseError);
	});

	it("round-trips a canonical multi-port STK with exact IDs, order, and static identity", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, "STK");
		const rows = [2, 3, 4, 5].map((x) => {
			const row = Array.from({ length: prepared.slots.count }, (_, index) => index).find(
				(index) =>
					(prepared.slots.routeXs[index] as number) === x &&
					(prepared.slots.routeZs[index] as number) === 0 &&
					(prepared.slots.statuses[index] as number) === PORT_SLOT_STATUS.LEGAL,
			);
			if (row === undefined) throw new Error(`expected STK persistence slot at ${x}:0`);
			return row;
		});
		const availability = new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK");
		const plan = planStkPlacement(
			prepared.slots,
			rows,
			availability,
			document.portEquipment,
			"FOUR_PORT",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(plan.valid).toBe(true);
		expect(document.commitPortEquipment(plan)).toBe(true);

		const project = captureOpenFabProject(document, { manifest: MANIFEST });
		const serialized = serializeOpenFabProject(project);
		const parsed = parseOpenFabProjectJson(serialized).project;
		const loadedState = createPortEquipmentStateFromOpenFabProject(parsed);
		const loadedSnapshot = createRailSnapshotFromOpenFabProject(parsed);
		const beforeSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot;

		expect(serializeOpenFabProject(parsed)).toBe(serialized);
		expect(loadedState).toEqual(document.portEquipment);
		expect(parsed.equipment.records).toEqual([
			{ id: 1, kind: "STK", template: "FOUR_PORT", portIds: [1, 2, 3, 4] },
		]);
		expect(parsed.ports.records.map((port) => port.barcode)).toEqual([
			"STK-1-P01",
			"STK-1-P02",
			"STK-1-P03",
			"STK-1-P04",
		]);
		expect(loadedSnapshot.checksum).toBe(beforeSnapshot.checksum);
		expect(loadedSnapshot.revision).toBe(beforeSnapshot.revision);
		expect(loadedSnapshot.sequence).toBe(beforeSnapshot.sequence);
	});

	it("round-trips edited EQ membership with retained IDs, sparse barcodes, and cursors", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 10, y: 0 })),
		).toBe(true);
		const physical = compilePhysicalRail(document.map);
		const slots = compilePortSlotPreparedArtifactCatalog(physical).EQ.slots;
		const rowAt = (x: number): number => {
			for (let row = 0; row < slots.count; row++) {
				if (
					slots.routeXs[row] === x &&
					slots.routeZs[row] === 0 &&
					slots.statuses[row] === PORT_SLOT_STATUS.LEGAL
				) {
					return row;
				}
			}
			throw new Error(`expected EQ persistence slot at ${x}:0`);
		};
		expect(
			document.commitPortEquipment(
				planEqRowPlacement(
					slots,
					[2, 3, 4].map(rowAt),
					new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
					document.portEquipment,
					1_000,
					"ETCH",
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		const edit = planPortEquipmentMembershipEdit(
			document.map,
			slots,
			portEquipmentGroupSlotIndexFor(slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "EQ"),
			document.portEquipment,
			1,
			[3, 4, 5].map(rowAt),
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(edit.valid, edit.reason).toBe(true);
		expect(document.commitPortEquipment(edit)).toBe(true);

		const serialized = serializeOpenFabProject(
			captureOpenFabProject(document, { manifest: MANIFEST }),
		);
		const parsed = parseOpenFabProjectJson(serialized).project;
		const loadedState = createPortEquipmentStateFromOpenFabProject(parsed);

		expect(serializeOpenFabProject(parsed)).toBe(serialized);
		expect(loadedState).toEqual(document.portEquipment);
		expect(loadedState).toMatchObject({
			nextPortId: 5,
			nextEquipmentGroupId: 2,
			equipmentGroups: [
				{
					id: 1,
					kind: "EQ",
					pitchMillimeters: 1_000,
					recipe: "ETCH",
					portIds: [2, 3, 4],
				},
			],
		});
		expect(loadedState.ports.map((port) => [port.id, port.barcode])).toEqual([
			[2, "EQ-1-P02"],
			[3, "EQ-1-P03"],
			[4, "EQ-1-PORT-4"],
		]);
	});

	it("round-trips edited asymmetric FLEX STK membership without changing static identity", () => {
		const document = createClosedStkLoopDocument();
		const physical = compilePhysicalRail(document.map);
		const prepared = compilePortSlotPreparedArtifacts(physical, "STK");
		const rowAt = (x: number, z: number): number => {
			const row = Array.from({ length: prepared.slots.count }, (_, index) => index).find(
				(index) =>
					(prepared.slots.routeXs[index] as number) === x &&
					(prepared.slots.routeZs[index] as number) === z &&
					(prepared.slots.statuses[index] as number) === PORT_SLOT_STATUS.LEGAL,
			);
			if (row === undefined) throw new Error(`expected FLEX STK persistence slot at ${x}:${z}`);
			return row;
		};
		const rows = [
			[6, 0],
			[2, 3],
			[2, 0],
			[5, 3],
			[4, 0],
		].map(([x, z]) => rowAt(x as number, z as number));
		const plan = planStkPlacement(
			prepared.slots,
			rows,
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			"FLEX",
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commitPortEquipment(plan)).toBe(true);
		const edit = planPortEquipmentMembershipEdit(
			document.map,
			prepared.slots,
			portEquipmentGroupSlotIndexFor(prepared.slots),
			new PortSlotAvailabilityIndex(physical, document.portEquipment, "STK"),
			document.portEquipment,
			1,
			[rowAt(2, 0), rowAt(6, 0), rowAt(7, 0), rowAt(6, 3), rowAt(5, 3), rowAt(2, 3)],
			document.map.getRevision(),
			document.getPatchSequence(),
		);
		expect(edit.valid, edit.reason).toBe(true);
		expect(edit.membershipEdit).toMatchObject({
			retainedPortIds: [1, 3, 4, 5],
			addedPortIds: [6, 7],
			removedPortIds: [2],
		});
		expect(document.commitPortEquipment(edit)).toBe(true);

		const beforeSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
		).snapshot;
		const capturedProject = captureOpenFabProject(document, { manifest: MANIFEST });
		const serialized = serializeOpenFabProject(capturedProject);
		const parsed = parseOpenFabProjectJson(serialized).project;
		const loadedState = createPortEquipmentStateFromOpenFabProject(parsed);
		const loadedSnapshot = createRailSnapshotFromOpenFabProject(parsed);
		const loadedPayload = compileRailStartup({ kind: "project-json", json: serialized });

		expect(serializeOpenFabProject(parsed)).toBe(serialized);
		expect(loadedState).toEqual(document.portEquipment);
		expect(parsed.equipment.records).toEqual([
			{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 3, 6, 7, 4, 5] },
		]);
		expect(parsed.ports.records).toHaveLength(6);
		expect(loadedState.nextPortId).toBe(8);
		expect(loadedState.nextEquipmentGroupId).toBe(2);
		expect(loadedState.ports.map((port) => [port.id, port.barcode])).toEqual([
			[1, "STK-1-P01"],
			[3, "STK-1-P03"],
			[4, "STK-1-P04"],
			[5, "STK-1-P05"],
			[6, "STK-1-PORT-6"],
			[7, "STK-1-PORT-7"],
		]);
		expect(
			loadedState.ports.map((port) =>
				port.route.kind === "CARDINAL_CELL" ? [port.route.x, port.route.z] : null,
			),
		).toEqual([
			[2, 0],
			[6, 0],
			[5, 3],
			[2, 3],
			[7, 0],
			[6, 3],
		]);
		expect(loadedSnapshot.checksum).toBe(beforeSnapshot.checksum);
		expect(loadedSnapshot.revision).toBe(beforeSnapshot.revision);
		expect(loadedSnapshot.sequence).toBe(beforeSnapshot.sequence);
		expect(loadedPayload.source).toMatchObject({
			kind: "project",
			schemaVersion: 12,
			migratedFromVersion: null,
		});

		const mislabeledVersionTwo = mutableCopy(capturedProject);
		mislabeledVersionTwo.schemaVersion = 2;
		delete mislabeledVersionTwo.operations;
		delete mislabeledVersionTwo.blueprints;
		delete mislabeledVersionTwo.relationships;
		mislabeledVersionTwo.areas = legacyReservedSection();
		expectProjectError(mislabeledVersionTwo, "INVALID_FIELD", "$.equipment.records[0].template");

		const unsortedVersionTwo = mutableCopy(capturedProject);
		unsortedVersionTwo.schemaVersion = 2;
		delete unsortedVersionTwo.operations;
		delete unsortedVersionTwo.blueprints;
		delete unsortedVersionTwo.relationships;
		unsortedVersionTwo.areas = legacyReservedSection();
		unsortedVersionTwo.equipment.records = [
			{ id: 99, kind: "OHB", template: "SINGLE", portIds: [999] },
			...(unsortedVersionTwo.equipment.records as unknown[]),
		];
		expectProjectError(unsortedVersionTwo, "INVALID_FIELD", "$.equipment.records[1].template");
	});

	it("migrates a schema-v2 legacy CUSTOM layout without applying FLEX restrictions", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 72, y: 0 })),
		).toBe(true);
		const legacyState: PortEquipmentState = {
			nextPortId: 3,
			nextEquipmentGroupId: 2,
			ports: [1, 70].map((x, index) => ({
				id: index + 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL" as const, x, z: 0, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "STK" as const,
				barcode: `LEGACY-STK-P0${index + 1}`,
			})),
			equipmentGroups: [{ id: 1, kind: "STK", template: "CUSTOM", portIds: [1, 2] }],
		};
		const legacyProject = mutableCopy(
			captureOpenFabProject(withPortEquipment(document, legacyState), { manifest: MANIFEST }),
		);
		legacyProject.schemaVersion = 2;
		delete legacyProject.operations;
		delete legacyProject.blueprints;
		delete legacyProject.relationships;
		legacyProject.areas = legacyReservedSection();

		const parsed = parseOpenFabProjectValue(legacyProject);
		const serialized = serializeOpenFabProject(parsed.project);
		const payload = compileRailStartup({
			kind: "project-json",
			json: JSON.stringify(legacyProject),
		});

		expect(parsed.migratedFromVersion).toBe(2);
		expect(parsed.project.schemaVersion).toBe(12);
		expect(parsed.project.equipment.records).toEqual([
			{ id: 1, kind: "STK", template: "CUSTOM", portIds: [1, 2] },
		]);
		expect(parseOpenFabProjectJson(serialized).migratedFromVersion).toBeNull();
		expect(payload.source).toMatchObject({ kind: "project", migratedFromVersion: 2 });
		expect(payload.snapshot.portEquipment.equipmentGroupIds).toEqual(new Int32Array([1]));
	});

	it("normalizes unordered authored arrays into one canonical byte representation", () => {
		const canonical = captureOpenFabProject(
			withPortEquipment(createSwitchDocument(), portEquipmentFixture()),
			{
				manifest: MANIFEST,
			},
		);
		const raw = mutableCopy(canonical);
		raw.rail.cells.reverse();
		raw.rail.advancedSwitches.reverse();
		raw.ports.records.reverse();
		raw.equipment.records.reverse();

		const normalized = parseOpenFabProjectValue(raw).project;
		expect(serializeOpenFabProject(normalized)).toBe(serializeOpenFabProject(canonical));
		for (let index = 1; index < normalized.rail.cells.length; index++) {
			const before = normalized.rail.cells[index - 1] as readonly number[];
			const after = normalized.rail.cells[index] as readonly number[];
			expect(before[0] < after[0] || (before[0] === after[0] && before[1] <= after[1])).toBe(true);
		}
	});

	it("migrates schema v3, v1, and the explicit development v0 shape into current sections", () => {
		const current = captureOpenFabProject(createSwitchDocument(), { manifest: MANIFEST });
		const v3 = mutableCopy(current);
		v3.schemaVersion = 3;
		delete v3.operations;
		delete v3.blueprints;
		delete v3.relationships;
		v3.areas = legacyReservedSection();
		const v3Result = parseOpenFabProjectValue(v3);
		expect(v3Result.migratedFromVersion).toBe(3);
		expect(v3Result.project.blueprints).toEqual({ schemaVersion: 4, records: [] });

		const v1Base = mutableCopy(current);
		delete v1Base.operations;
		delete v1Base.blueprints;
		delete v1Base.relationships;
		v1Base.areas = legacyReservedSection();
		const v1 = {
			...v1Base,
			schemaVersion: 1,
			ports: { schemaVersion: 0, records: [] },
			equipment: { schemaVersion: 0, records: [] },
		};
		const v1Result = parseOpenFabProjectValue(v1);
		expect(v1Result.migratedFromVersion).toBe(1);
		expect(v1Result.project.schemaVersion).toBe(12);
		expect(v1Result.project.ports).toEqual({ schemaVersion: 1, nextPortId: 1, records: [] });
		expect(v1Result.project.equipment).toEqual({
			schemaVersion: 1,
			nextEquipmentGroupId: 1,
			records: [],
		});

		const v0 = {
			kind: OPENFAB_PROJECT_KIND,
			schemaVersion: 0,
			manifest: current.manifest,
			rail: {
				revision: current.rail.revision,
				patchSequence: current.rail.patchSequence,
				nextAdvancedSwitchId: current.rail.nextAdvancedSwitchId,
				cells: current.rail.cells,
				advancedSwitches: current.rail.advancedSwitches,
			},
			view: null,
		};

		const result = parseOpenFabProjectValue(v0);
		expect(result.migratedFromVersion).toBe(0);
		expect(result.project.schemaVersion).toBe(12);
		expect(result.project.ports.records).toEqual([]);
		expect(result.project.equipment.records).toEqual([]);
		expect(result.project.areas.records).toEqual([]);
		expect(result.project.scenarios.records).toEqual([]);
		expect(result.project.rail.cells).toEqual(current.rail.cells);
	});

	it("round-trips a named rail-area blueprint library without render-only source identity", () => {
		const blueprint = createOpenFabRailAreaBlueprint(CLOSED_AREA_TEMPLATE, {
			id: "blueprint-bay-loop",
			name: "Bay loop",
			folder: "FAB/Bays",
			favorite: true,
			createdAt: MANIFEST.createdAt,
		});
		const project = captureOpenFabProject(createSwitchDocument(), {
			manifest: MANIFEST,
			blueprints: {
				schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
				records: [blueprint],
			},
		});
		const parsed = parseOpenFabProjectJson(serializeOpenFabProject(project)).project;

		expect(parsed.blueprints.records).toEqual([blueprint]);
		expect(parsed.blueprints.records[0]).not.toHaveProperty("sourceRevision");
		expect(parsed.blueprints.records[0]).not.toHaveProperty("sourceModuleKeys");
	});

	it("migrates schema-v4 rail-area blueprints into the v5 mixed blueprint section", () => {
		const blueprint = createOpenFabRailAreaBlueprint(CLOSED_AREA_TEMPLATE, {
			id: "blueprint-v4-loop",
			name: "V4 loop",
			createdAt: MANIFEST.createdAt,
		});
		const legacy = mutableCopy(
			captureOpenFabProject(new RailDocument(), {
				manifest: MANIFEST,
				blueprints: {
					schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
					records: [blueprint],
				},
			}),
		);
		legacy.schemaVersion = 4;
		delete legacy.operations;
		delete legacy.relationships;
		if (!legacy.blueprints) throw new Error("Expected persisted v4 blueprints.");
		legacy.blueprints.schemaVersion = 1;
		legacy.areas = legacyReservedSection();

		const migrated = parseOpenFabProjectValue(legacy);

		expect(migrated.migratedFromVersion).toBe(4);
		expect(migrated.project.schemaVersion).toBe(12);
		expect(migrated.project.blueprints).toEqual({ schemaVersion: 4, records: [blueprint] });
	});

	it("migrates the reserved v5 areas section into the current empty organization library", () => {
		const legacy = mutableCopy(
			captureOpenFabProject(new RailDocument(), {
				manifest: MANIFEST,
			}),
		);
		legacy.schemaVersion = 5;
		delete legacy.operations;
		delete legacy.relationships;
		if (!legacy.blueprints) throw new Error("Expected persisted v5 blueprints.");
		legacy.blueprints.schemaVersion = 2;
		legacy.areas = legacyReservedSection();

		const migrated = parseOpenFabProjectValue(legacy);

		expect(migrated.migratedFromVersion).toBe(5);
		expect(migrated.project.schemaVersion).toBe(12);
		expect(migrated.project.areas).toEqual({
			schemaVersion: 2,
			nextOrganizationId: 1,
			records: [],
		});
	});

	it("migrates v6 organization membership into explicit relationships and properties", () => {
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
			"Legacy Bay",
			"BAY",
		);
		expect(create.valid, create.reason).toBe(true);
		expect(document.commitOrganization(create)).toBe(true);

		const legacy = mutableCopy(captureOpenFabProject(document, { manifest: MANIFEST }));
		legacy.schemaVersion = 6;
		delete legacy.operations;
		delete legacy.relationships;
		if (!legacy.blueprints) throw new Error("Expected persisted v6 blueprints.");
		legacy.blueprints.schemaVersion = 2;
		legacy.areas.schemaVersion = 1;
		const versionSevenRecords = legacy.areas.records as Array<{
			id: number;
			kind: string;
			name: string;
			membership: unknown;
		}>;
		legacy.areas.records = versionSevenRecords.map((record) => ({
			id: record.id,
			kind: record.kind,
			name: record.name,
			membership: record.membership,
		})) as typeof legacy.areas.records;

		const migrated = parseOpenFabProjectValue(legacy);

		expect(migrated.migratedFromVersion).toBe(6);
		expect(migrated.project.schemaVersion).toBe(12);
		expect(migrated.project.areas).toMatchObject({ schemaVersion: 2, nextOrganizationId: 2 });
		expect(migrated.project.areas.records[0]).toMatchObject({
			kind: "BAY",
			name: "Legacy Bay",
			parentOrganizationIds: [],
			properties: { description: "", color: "TEAL" },
		});
	});

	it("round-trips and strictly validates portable mixed static FAB blueprints", () => {
		const blueprint = createOpenFabStaticFabBlueprint(STATIC_FAB_TEMPLATE, {
			id: "blueprint-photo-bay",
			name: "Photo bay",
			folder: "FAB/Photo",
			createdAt: MANIFEST.createdAt,
		});
		const project = captureOpenFabProject(new RailDocument(), {
			manifest: MANIFEST,
			blueprints: { schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION, records: [blueprint] },
		});
		const serialized = serializeOpenFabProject(project);
		const parsed = parseOpenFabProjectJson(serialized).project;

		expect(parsed.blueprints.records).toEqual([blueprint]);
		const restored = parsed.blueprints.records[0];
		expect(restored?.kind).toBe("STATIC_FAB");
		if (!restored || restored.kind !== "STATIC_FAB")
			throw new Error("Expected static FAB blueprint.");
		expect(restored.ports[0]).not.toHaveProperty("id");
		expect(restored.ports[0]).not.toHaveProperty("barcode");
		expect(serializeOpenFabProject(parsed)).toBe(serialized);

		const wrongStation = mutableCopy(project);
		const stationPort = (
			wrongStation.blueprints?.records[0] as { ports: Array<{ stationMillimeters: number }> }
		).ports[0];
		if (!stationPort) throw new Error("Expected mixed blueprint port.");
		stationPort.stationMillimeters = 400;
		expectProjectError(wrongStation, "INVALID_PORT_EQUIPMENT", ".stationMillimeters");

		const missingSupport = mutableCopy(project);
		const supportPort = (
			missingSupport.blueprints?.records[0] as { ports: Array<{ route: { cell: number[] } }> }
		).ports[1];
		if (!supportPort) throw new Error("Expected mixed blueprint support port.");
		supportPort.route.cell = [99, 99];
		expectProjectError(missingSupport, "INVALID_PORT_EQUIPMENT", "$.blueprints.records[0]");

		const duplicateOwnership = mutableCopy(project);
		const groups = (
			duplicateOwnership.blueprints?.records[0] as {
				equipmentGroups: Array<{ portIndices: number[] }>;
			}
		).equipmentGroups;
		if (!groups[1]) throw new Error("Expected EQ group.");
		groups[1].portIndices = [0, 1];
		expectProjectError(duplicateOwnership, "DUPLICATE_VALUE", ".portIndices");

		const duplicateSpacing = mutableCopy(project);
		const duplicateRecord = duplicateSpacing.blueprints?.records[0] as {
			ports: OpenFabStaticFabBlueprintPort[];
			equipmentGroups: OpenFabStaticFabBlueprintEquipmentGroup[];
		};
		const sourceOhb = duplicateRecord.ports[0];
		if (!sourceOhb) throw new Error("Expected portable OHB port.");
		const duplicatePortIndex = duplicateRecord.ports.length;
		const duplicateGroupIndex = duplicateRecord.equipmentGroups.length;
		duplicateRecord.ports.push({
			...sourceOhb,
			equipmentGroupIndex: duplicateGroupIndex,
			route: { ...sourceOhb.route, cell: [...sourceOhb.route.cell] },
		});
		duplicateRecord.equipmentGroups.push({
			kind: "OHB",
			template: "SINGLE",
			portIndices: [duplicatePortIndex],
		});
		expectProjectError(duplicateSpacing, "INVALID_PORT_EQUIPMENT", "$.blueprints.records[0]");
	});

	it("round-trips canonical organization blueprints and rejects unknown nested fields", () => {
		const blueprint = createOpenFabStaticFabOrganizationBlueprint(organizationBundleFixture(), {
			id: "blueprint-organization-row",
			name: "Organization row",
			folder: "FAB/Organization",
			favorite: true,
			createdAt: MANIFEST.createdAt,
		});
		const project = captureOpenFabProject(new RailDocument(), {
			manifest: MANIFEST,
			blueprints: {
				schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
				records: [blueprint],
			},
		});
		const serialized = serializeOpenFabProject(project);
		const parsed = parseOpenFabProjectJson(serialized);

		expect(parsed.project.schemaVersion).toBe(12);
		expect(parsed.project.blueprints.schemaVersion).toBe(4);
		expect(parsed.project.blueprints.records).toEqual([blueprint]);
		expect(parsed.project.blueprints.records[0]?.kind).toBe("STATIC_FAB_ORGANIZATION");
		expect(Object.isFrozen(parsed.project.blueprints.records[0])).toBe(true);
		expect(serializeOpenFabProject(parsed.project)).toBe(serialized);

		const unknownRecordField = mutableCopy(project);
		const mutableRecord = unknownRecordField.blueprints?.records[0] as Record<string, unknown>;
		mutableRecord.runtimeSelection = { revision: 99 };
		expectProjectError(unknownRecordField, "INVALID_FIELD", "$.blueprints.records[0]");

		const missingRecordField = mutableCopy(project);
		const incompleteRecord = missingRecordField.blueprints?.records[0] as Record<string, unknown>;
		delete incompleteRecord.bundle;
		expectProjectError(missingRecordField, "INVALID_FIELD", "$.blueprints.records[0]");

		const unknownBundleField = mutableCopy(project);
		const mutableBundle = (
			unknownBundleField.blueprints?.records[0] as {
				bundle: { organizations: Array<{ properties: Record<string, unknown> }> };
			}
		).bundle;
		const mutableOrganization = mutableBundle.organizations[0];
		if (!mutableOrganization) throw new Error("Expected an organization blueprint fixture.");
		mutableOrganization.properties.runtimeColor = "#fff";
		expectProjectError(unknownBundleField, "INVALID_ORGANIZATION", ".bundle");

		const missingBundleField = mutableCopy(project);
		const incompleteBundle = (
			missingBundleField.blueprints?.records[0] as {
				bundle: Record<string, unknown>;
			}
		).bundle;
		delete incompleteBundle.captureMode;
		expectProjectError(missingBundleField, "INVALID_ORGANIZATION", ".bundle");

		const mismatchedProjection = mutableCopy(project);
		const projectedRecord = mismatchedProjection.blueprints?.records[0] as {
			sourceModuleCount: number;
		};
		projectedRecord.sourceModuleCount += 1;
		expectProjectError(mismatchedProjection, "INVALID_ORGANIZATION", ".sourceModuleCount");
	});

	it("losslessly upgrades root v7 blueprint schema v2 projects to root v12 schema v4", () => {
		const records = [
			createOpenFabRailAreaBlueprint(CLOSED_AREA_TEMPLATE, {
				id: "blueprint-v7-rail",
				name: "V7 rail",
				createdAt: MANIFEST.createdAt,
			}),
			createOpenFabStaticFabBlueprint(STATIC_FAB_TEMPLATE, {
				id: "blueprint-v7-static",
				name: "V7 static FAB",
				createdAt: MANIFEST.createdAt,
			}),
		] as const;
		const legacy = mutableCopy(
			captureOpenFabProject(new RailDocument(), {
				manifest: MANIFEST,
				blueprints: {
					schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
					records,
				},
			}),
		);
		legacy.schemaVersion = 7;
		delete legacy.operations;
		delete legacy.relationships;
		if (!legacy.blueprints) throw new Error("Expected a v7 blueprint fixture.");
		legacy.blueprints.schemaVersion = 2;

		const upgraded = parseOpenFabProjectValue(legacy);
		const serialized = serializeOpenFabProject(upgraded.project);
		const reparsed = parseOpenFabProjectJson(serialized);

		expect(upgraded.migratedFromVersion).toBe(7);
		expect(upgraded.project.schemaVersion).toBe(12);
		expect(upgraded.project.blueprints.schemaVersion).toBe(4);
		expect(upgraded.project.blueprints.records).toEqual(records);
		expect(reparsed.migratedFromVersion).toBeNull();
		expect(reparsed.project.blueprints.records).toEqual(records);
	});

	it("accepts a closed directed branch-and-merge blueprint", () => {
		const blueprint = createOpenFabRailAreaBlueprint(CLOSED_BRANCH_MERGE_TEMPLATE, {
			id: "blueprint-branch-bypass",
			name: "Branch bypass",
			createdAt: MANIFEST.createdAt,
		});
		const project = captureOpenFabProject(new RailDocument(), {
			manifest: MANIFEST,
			blueprints: {
				schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
				records: [blueprint],
			},
		});

		expect(
			parseOpenFabProjectJson(serializeOpenFabProject(project)).project.blueprints.records,
		).toEqual([blueprint]);
	});

	it("round-trips an open one-dimensional rail blueprint", () => {
		const blueprint = createOpenFabRailAreaBlueprint(OPEN_STRAIGHT_TEMPLATE, {
			id: "blueprint-open-straight",
			name: "Open straight",
			createdAt: MANIFEST.createdAt,
		});
		const project = captureOpenFabProject(new RailDocument(), {
			manifest: MANIFEST,
			blueprints: {
				schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
				records: [blueprint],
			},
		});

		expect(
			parseOpenFabProjectJson(serializeOpenFabProject(project)).project.blueprints.records,
		).toEqual([blueprint]);
	});

	it("round-trips an open one-dimensional static FAB blueprint with equipment", () => {
		const blueprint = createOpenFabStaticFabBlueprint(OPEN_STATIC_FAB_TEMPLATE, {
			id: "blueprint-open-port-row",
			name: "Open port row",
			folder: "Process",
			createdAt: MANIFEST.createdAt,
		});
		const project = captureOpenFabProject(new RailDocument(), {
			manifest: MANIFEST,
			blueprints: {
				schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
				records: [blueprint],
			},
		});

		expect(
			parseOpenFabProjectJson(serializeOpenFabProject(project)).project.blueprints.records,
		).toEqual([blueprint]);
	});

	it("canonicalizes blueprint record and directed-edge order", () => {
		const earlier = createOpenFabRailAreaBlueprint(CLOSED_AREA_TEMPLATE, {
			id: "blueprint-a",
			name: "A loop",
			createdAt: MANIFEST.createdAt,
		});
		const later = createOpenFabRailAreaBlueprint(CLOSED_AREA_TEMPLATE, {
			id: "blueprint-z",
			name: "Z loop",
			createdAt: MANIFEST.createdAt,
		});
		const raw = mutableCopy(
			captureOpenFabProject(new RailDocument(), {
				manifest: MANIFEST,
				blueprints: {
					schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
					records: [later, earlier],
				},
			}),
		);
		for (const record of raw.blueprints?.records ?? []) {
			(record as { edges: unknown[] }).edges.reverse();
		}

		const parsed = parseOpenFabProjectValue(raw).project;
		const serialized = serializeOpenFabProject(parsed);

		expect(parsed.blueprints.records.map((record) => record.id)).toEqual([
			"blueprint-a",
			"blueprint-z",
		]);
		expect(serializeOpenFabProject(parseOpenFabProjectJson(serialized).project)).toBe(serialized);
		expect(parsed.blueprints.records[0]?.edges).toEqual(parsed.blueprints.records[1]?.edges);
	});

	it("rejects malformed bounds, duplicate labels, and oversized blueprint records", () => {
		const blueprint = createOpenFabRailAreaBlueprint(CLOSED_AREA_TEMPLATE, {
			id: "blueprint-validation",
			name: "Validation loop",
			folder: "Bays",
			createdAt: MANIFEST.createdAt,
		});
		const project = captureOpenFabProject(new RailDocument(), {
			manifest: MANIFEST,
			blueprints: {
				schemaVersion: OPENFAB_BLUEPRINT_SECTION_SCHEMA_VERSION,
				records: [blueprint],
			},
		});

		const open = mutableCopy(project);
		const openRecord = open.blueprints?.records[0] as { widthMeters: number };
		openRecord.widthMeters = 3;
		expectProjectError(open, "INVALID_RAIL", "$.blueprints.records[0].edges");

		const duplicateLabel = mutableCopy(project);
		const sourceRecord = duplicateLabel.blueprints?.records[0] as Record<string, unknown>;
		duplicateLabel.blueprints?.records.push({ ...sourceRecord, id: "blueprint-validation-2" });
		expectProjectError(duplicateLabel, "DUPLICATE_VALUE", "$.blueprints.records[1].name");

		const oversized = mutableCopy(project);
		const oversizedRecord = oversized.blueprints?.records[0] as { edges: unknown[] };
		oversizedRecord.edges = Array.from(
			{ length: OPENFAB_BLUEPRINT_MAX_EDGES_PER_RECORD + 1 },
			() => [0, 0, 1, 0],
		);
		expectProjectError(oversized, "LIMIT_EXCEEDED", "$.blueprints.records[0].edges");
	});

	it("rejects malformed, stale, duplicated, and non-reciprocal authored data", () => {
		const project = captureOpenFabProject(createSwitchDocument(), { manifest: MANIFEST });

		const stale = mutableCopy(project);
		stale.schemaVersion = 99;
		expectProjectError(stale, "UNSUPPORTED_VERSION", "$.schemaVersion");

		const unknown = mutableCopy(project) as MutableProject & { rendererCache?: unknown };
		unknown.rendererCache = {};
		expectProjectError(unknown, "INVALID_FIELD", "$.rendererCache");

		const duplicate = mutableCopy(project);
		duplicate.rail.cells.push([...duplicate.rail.cells[0]] as [number, number, number]);
		expectProjectError(duplicate, "DUPLICATE_VALUE", "$.rail.cells");

		const nonReciprocal = mutableCopy(project);
		nonReciprocal.rail.cells.shift();
		expectProjectError(nonReciprocal, "INVALID_RAIL", "$.rail.cells(");

		const broken = mutableCopy(project);
		broken.rail.cells[0][2] = 0x40;
		expectProjectError(broken, "INVALID_RAIL", "$.rail.cells(");

		const invalidCell = mutableCopy(project);
		invalidCell.rail.cells[0][2] = 0x22;
		expectProjectError(invalidCell, "INVALID_RAIL", "$.rail.cells[0]");

		const badSwitch = mutableCopy(project);
		badSwitch.rail.advancedSwitches[0].movementMask = 0b0001;
		expectProjectError(badSwitch, "INVALID_RAIL", "$.rail.advancedSwitches[0]");

		const overlappingSwitch = mutableCopy(project);
		const repeatedSwitch = {
			...overlappingSwitch.rail.advancedSwitches[0],
			origin: [...overlappingSwitch.rail.advancedSwitches[0].origin],
			id: overlappingSwitch.rail.nextAdvancedSwitchId,
		};
		overlappingSwitch.rail.nextAdvancedSwitchId++;
		overlappingSwitch.rail.advancedSwitches.push(repeatedSwitch);
		expectProjectError(overlappingSwitch, "INVALID_RAIL", "$.rail.advancedSwitches");

		const staleCursor = mutableCopy(project);
		staleCursor.rail.nextAdvancedSwitchId = 1;
		expectProjectError(staleCursor, "INVALID_FIELD", "$.rail.nextAdvancedSwitchId");

		const malformedPorts = mutableCopy(project);
		malformedPorts.ports.records.push({ id: "PORT-1" });
		expectProjectError(malformedPorts, "INVALID_FIELD", "$.ports.records");

		const malformedArea = mutableCopy(project);
		malformedArea.areas.records.push({ id: "AREA-1" });
		expectProjectError(malformedArea, "INVALID_FIELD", "$.areas.records[0]");
	});

	it("rejects duplicate IDs, orphan group references, and kind mismatches", () => {
		const project = captureOpenFabProject(
			withPortEquipment(createSwitchDocument(), portEquipmentFixture()),
			{
				manifest: MANIFEST,
			},
		);
		const duplicate = mutableCopy(project);
		duplicate.ports.records.push(structuredClone(duplicate.ports.records[0]));
		expectProjectError(duplicate, "DUPLICATE_VALUE", "$.ports.records");

		const orphan = mutableCopy(project);
		(orphan.equipment.records[0] as { portIds: number[] }).portIds = [999];
		expectProjectError(orphan, "INVALID_PORT_EQUIPMENT", "$.ports");

		const mismatch = mutableCopy(project);
		(mismatch.ports.records[0] as { portType: string }).portType = "EQ";
		expectProjectError(mismatch, "INVALID_PORT_EQUIPMENT", "$.ports");
	});

	it("rejects invalid JSON, timestamps, project ids, and oversized coordinate values", () => {
		expect(() => parseOpenFabProjectJson("{")).toThrowError(OpenFabProjectParseError);
		const project = captureOpenFabProject(createSwitchDocument(), { manifest: MANIFEST });

		const badTimestamp = mutableCopy(project);
		badTimestamp.manifest.updatedAt = "2026-07-18";
		expectProjectError(badTimestamp, "INVALID_FIELD", "$.manifest.updatedAt");

		const badId = mutableCopy(project);
		badId.manifest.id = "internal project path";
		expectProjectError(badId, "INVALID_FIELD", "$.manifest.id");

		const badCoordinate = mutableCopy(project);
		badCoordinate.rail.cells[0][0] = 0x80000000;
		expectProjectError(badCoordinate, "INVALID_FIELD", "$.rail.cells[0][0]");
	});
});

const ORIGIN: Cell = { x: 0, y: 0 };
const MANIFEST = Object.freeze({
	id: "openfab-project-001",
	name: "Long Bay 연구 맵",
	createdAt: "2026-07-18T00:00:00.000Z",
	updatedAt: "2026-07-18T01:02:03.004Z",
});

function createSwitchDocument(): RailDocument {
	const document = documentWithTerminal(DIR_E);
	const plan = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: 3 }, "C");
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`advanced switch fixture failed: ${plan.reason}`);
	}
	return document;
}

function documentWithTerminal(forward: Direction): RailDocument {
	const document = new RailDocument();
	const cells: Cell[] = [];
	let current = ORIGIN;
	for (let distance = 0; distance < 4; distance++) {
		cells.unshift(current);
		current = moveCell(current, oppositeDirection(forward));
	}
	const plan = planRailPath(document.map, cells);
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`terminal fixture failed: ${plan.reason}`);
	}
	return document;
}

function relationshipPersistenceDocument(): RailDocument {
	const map = new TileMap();
	for (const cells of [
		Array.from({ length: 9 }, (_, offset) => ({ x: offset - 3, y: 0 })),
		[
			{ x: 0, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
			{ x: 2, y: 0 },
		],
	]) {
		connectDirectedPath(map, cells);
	}
	const edge = (fromX: number, fromY: number, toX: number, toY: number): DirectedRailEdge => ({
		from: { x: fromX, y: fromY },
		to: { x: toX, y: toY },
	});
	const mainEdges = Array.from({ length: 8 }, (_, offset) => edge(offset - 3, 0, offset - 2, 0));
	const participantEdges = [edge(0, 0, 0, 1), edge(0, 1, 1, 1), edge(1, 1, 2, 1), edge(2, 1, 2, 0)];
	const membership = (railEdges: readonly DirectedRailEdge[]) => ({
		railEdges: [...railEdges].sort(compareDirectedRailEdges),
		advancedSwitchIds: [] as number[],
		equipmentGroupIds: [] as number[],
	});
	const organizations: StaticFabOrganizationState = {
		nextOrganizationId: 4,
		records: [
			{ id: 1, kind: "AREA", name: "Bank", membership: membership(mainEdges) },
			{
				id: 2,
				kind: "BAY",
				name: "Bay",
				parentOrganizationIds: [1],
				membership: membership(participantEdges),
			},
			{
				id: 3,
				kind: "AISLE",
				name: "Process Loop",
				parentOrganizationIds: [2],
				membership: membership(participantEdges),
			},
		],
	};
	const parentScoped = (railEdge: DirectedRailEdge) => ({
		edge: railEdge,
		scope: { kind: "PARENT_DIRECT" as const },
	});
	const participantScoped = (railEdge: DirectedRailEdge) => ({
		edge: railEdge,
		scope: {
			kind: "PARTICIPANT_EFFECTIVE" as const,
			participantIndex: 0 as const,
			directOwnerOrganizationIds: [2, 3],
		},
	});
	const witness = (
		incidence: "INCOMING" | "OUTGOING",
		scopedEdge: ReturnType<typeof parentScoped> | ReturnType<typeof participantScoped>,
	) => ({ incidence, binding: { kind: "WITNESS" as const, scopedEdge } });
	const relationships: StaticFabAssemblyRelationshipStateV1 = {
		nextRelationshipId: 2,
		records: [
			{
				id: 1,
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
				parentOrganizationId: 1,
				participantOrganizationIds: [2],
				managedChildOrganizationIds: [2],
				reviewPolicy: "AUTHORING_NON_DETACHABLE",
				connectionGroups: [
					{
						ordinal: 0,
						legs: [
							{
								ordinal: 0,
								directionRole: "CONTACT",
								exclusiveCutEdges: [],
								endpointSupports: [],
								seamContacts: [
									{
										role: "BRANCH",
										incidences: [
											witness("INCOMING", parentScoped(edge(-1, 0, 0, 0))),
											witness("OUTGOING", participantScoped(edge(0, 0, 0, 1))),
											witness("OUTGOING", parentScoped(edge(0, 0, 1, 0))),
										],
									},
									{
										role: "MERGE",
										incidences: [
											witness("INCOMING", parentScoped(edge(1, 0, 2, 0))),
											witness("INCOMING", participantScoped(edge(2, 1, 2, 0))),
											witness("OUTGOING", parentScoped(edge(2, 0, 3, 0))),
										],
									},
								],
							},
						],
					},
				],
			},
		],
	};
	return RailDocument.fromLoadedMap(map, 0, undefined, organizations, undefined, relationships);
}

function connectDirectedPath(map: TileMap, cells: readonly Cell[]): void {
	for (let index = 1; index < cells.length; index++) {
		const from = cells[index - 1] as Cell;
		const to = cells[index] as Cell;
		const direction = directionBetween(from, to);
		if (direction === null) throw new Error("relationship test path must be adjacent");
		const source = decodeRailCell(map.getEncoded(from.x, from.y));
		const target = decodeRailCell(map.getEncoded(to.x, to.y));
		map.setEncoded(
			from.x,
			from.y,
			encodeRailCell({ ...source, outgoing: source.outgoing | direction }),
		);
		map.setEncoded(
			to.x,
			to.y,
			encodeRailCell({ ...target, incoming: target.incoming | oppositeDirection(direction) }),
		);
	}
}

function withPortEquipment(
	document: RailDocument,
	portEquipment: PortEquipmentState,
): RailDocument {
	return RailDocument.fromLoadedMap(document.map, document.getPatchSequence(), portEquipment);
}

function createClosedStkLoopDocument(): RailDocument {
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
		const plan = planRailConstruction(document.map, start, end);
		if (!plan.valid || !document.commit(plan)) {
			throw new Error(`closed STK persistence fixture failed: ${plan.reason}`);
		}
	}
	return document;
}

function portEquipmentFixture(): PortEquipmentState {
	return {
		nextPortId: 3,
		nextEquipmentGroupId: 3,
		ports: [
			{
				id: 2,
				equipmentGroupId: 2,
				route: { kind: "CARDINAL_CELL", x: -1, z: 0, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "RIGHT",
				lateralOffsetMillimeters: 700,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: "OHB-002",
			},
			{
				id: 1,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL", x: -2, z: 0, from: DIR_W, to: DIR_E },
				stationMillimeters: 500,
				side: "LEFT",
				lateralOffsetMillimeters: 700,
				direction: "WITH_TRAVEL",
				portType: "OHB",
				barcode: "OHB-001",
			},
		],
		equipmentGroups: [
			{ id: 2, kind: "OHB", template: "SINGLE", portIds: [2] },
			{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
		],
	};
}

function expectProjectError(
	value: unknown,
	code: OpenFabProjectParseError["code"],
	pathFragment: string,
): void {
	try {
		parseOpenFabProjectValue(value);
		throw new Error("expected project parsing to fail");
	} catch (error) {
		expect(error).toBeInstanceOf(OpenFabProjectParseError);
		const projectError = error as OpenFabProjectParseError;
		expect(projectError.code).toBe(code);
		expect(projectError.path).toContain(pathFragment);
	}
}

interface MutableProject {
	kind: string;
	schemaVersion: number;
	manifest: {
		id: string;
		name: string;
		createdAt: string;
		updatedAt: string;
	};
	rail: {
		grammar: string;
		cellSizeMillimeters: number;
		cellEncoding: string;
		revision: number;
		patchSequence: number;
		nextAdvancedSwitchId: number;
		cells: number[][];
		advancedSwitches: Array<{
			id: number;
			profileClass: string;
			origin: number[];
			forward: string;
			lateral: string;
			movementMask: number;
		}>;
	};
	ports: { schemaVersion: number; nextPortId: number; records: unknown[] };
	equipment: { schemaVersion: number; nextEquipmentGroupId: number; records: unknown[] };
	operations?: unknown;
	blueprints?: { schemaVersion: number; records: unknown[] };
	areas: { schemaVersion: number; nextOrganizationId?: number; records: unknown[] };
	relationships?: { schemaVersion: number; nextRelationshipId: number; records: unknown[] };
	scenarios: { schemaVersion: number; records: unknown[] };
	view: unknown;
}

function legacyReservedSection(): MutableProject["areas"] {
	return { schemaVersion: 0, records: [] };
}

const CLOSED_AREA_TEMPLATE: RailAreaStampTemplate = Object.freeze({
	sourceRevision: 19,
	sourceModuleKeys: Object.freeze(["source-only-key"]),
	sourceModuleCount: 8,
	sourceEdgeCount: 8,
	sourceWidthMeters: 2,
	sourceHeightMeters: 2,
	edges: Object.freeze(
		[
			[0, 0, 1, 0],
			[1, 0, 2, 0],
			[2, 0, 2, 1],
			[2, 1, 2, 2],
			[2, 2, 1, 2],
			[1, 2, 0, 2],
			[0, 2, 0, 1],
			[0, 1, 0, 0],
		].map(([fromX, fromY, toX, toY]) =>
			Object.freeze({
				from: Object.freeze({ x: fromX as number, y: fromY as number }),
				to: Object.freeze({ x: toX as number, y: toY as number }),
			}),
		),
	),
});

const OPEN_STRAIGHT_TEMPLATE: RailAreaStampTemplate = railAreaTemplate(4, 0, [
	[0, 0, 1, 0],
	[1, 0, 2, 0],
	[2, 0, 3, 0],
	[3, 0, 4, 0],
]);

const CLOSED_BRANCH_MERGE_TEMPLATE: RailAreaStampTemplate = railAreaTemplate(6, 4, [
	[0, 0, 1, 0],
	[1, 0, 2, 0],
	[2, 0, 3, 0],
	[3, 0, 4, 0],
	[4, 0, 5, 0],
	[5, 0, 6, 0],
	[6, 0, 6, 1],
	[6, 1, 6, 2],
	[6, 2, 6, 3],
	[6, 3, 6, 4],
	[6, 4, 5, 4],
	[5, 4, 4, 4],
	[4, 4, 3, 4],
	[3, 4, 2, 4],
	[2, 4, 1, 4],
	[1, 4, 0, 4],
	[0, 4, 0, 3],
	[0, 3, 0, 2],
	[0, 2, 0, 1],
	[0, 1, 0, 0],
	[2, 0, 2, 1],
	[2, 1, 3, 1],
	[3, 1, 4, 1],
	[4, 1, 4, 0],
]);

const STATIC_FAB_TEMPLATE: StaticFabBlueprintTemplate = Object.freeze({
	rail: railAreaTemplate(6, 4, rectangleEdgeTuples(6, 4)),
	ports: Object.freeze([
		portablePort(0, 1, 0, DIR_W, DIR_E, "LEFT", 400, "WITH_TRAVEL", "OHB"),
		portablePort(1, 2, 0, DIR_W, DIR_E, "CENTER", 0, "WITH_TRAVEL", "EQ"),
		portablePort(1, 3, 0, DIR_W, DIR_E, "CENTER", 0, "WITH_TRAVEL", "EQ"),
		portablePort(2, 5, 4, DIR_E, DIR_W, "CENTER", 0, "WITH_TRAVEL", "STK"),
		portablePort(2, 4, 4, DIR_E, DIR_W, "CENTER", 0, "WITH_TRAVEL", "STK"),
		portablePort(2, 3, 4, DIR_E, DIR_W, "CENTER", 0, "WITH_TRAVEL", "STK"),
		portablePort(2, 2, 4, DIR_E, DIR_W, "CENTER", 0, "WITH_TRAVEL", "STK"),
	]),
	equipmentGroups: Object.freeze([
		Object.freeze({
			kind: "OHB" as const,
			template: "SINGLE" as const,
			portIndices: Object.freeze([0]),
		}),
		Object.freeze({
			kind: "EQ" as const,
			pitchMillimeters: 1_000,
			recipe: "PHOTO",
			portIndices: Object.freeze([1, 2]),
		}),
		Object.freeze({
			kind: "STK" as const,
			template: "FOUR_PORT" as const,
			portIndices: Object.freeze([3, 4, 5, 6]),
		}),
	]),
});

const OPEN_STATIC_FAB_TEMPLATE: StaticFabBlueprintTemplate = Object.freeze({
	rail: OPEN_STRAIGHT_TEMPLATE,
	ports: Object.freeze([
		portablePort(0, 1, 0, DIR_W, DIR_E, "LEFT", 400, "WITH_TRAVEL", "OHB"),
		portablePort(1, 2, 0, DIR_W, DIR_E, "CENTER", 0, "WITH_TRAVEL", "EQ"),
		portablePort(1, 3, 0, DIR_W, DIR_E, "CENTER", 0, "WITH_TRAVEL", "EQ"),
	]),
	equipmentGroups: Object.freeze([
		Object.freeze({
			kind: "OHB" as const,
			template: "SINGLE" as const,
			portIndices: Object.freeze([0]),
		}),
		Object.freeze({
			kind: "EQ" as const,
			pitchMillimeters: 1_000,
			recipe: "ETCH",
			portIndices: Object.freeze([1, 2]),
		}),
	]),
});

function railAreaTemplate(
	widthMeters: number,
	heightMeters: number,
	edges: readonly (readonly [number, number, number, number])[],
): RailAreaStampTemplate {
	return Object.freeze({
		sourceRevision: 1,
		sourceModuleKeys: Object.freeze(["fixture"]),
		sourceModuleCount: edges.length,
		sourceEdgeCount: edges.length,
		sourceWidthMeters: widthMeters,
		sourceHeightMeters: heightMeters,
		edges: Object.freeze(
			edges.map(([fromX, fromY, toX, toY]) =>
				Object.freeze({
					from: Object.freeze({ x: fromX, y: fromY }),
					to: Object.freeze({ x: toX, y: toY }),
				}),
			),
		),
	});
}

function portablePort(
	equipmentGroupIndex: number,
	x: number,
	z: number,
	from: Direction,
	to: Direction,
	side: "CENTER" | "LEFT" | "RIGHT",
	lateralOffsetMillimeters: number,
	direction: "WITH_TRAVEL" | "AGAINST_TRAVEL",
	portType: "OHB" | "EQ" | "STK",
) {
	return Object.freeze({
		equipmentGroupIndex,
		route: Object.freeze({ kind: "CARDINAL_CELL" as const, x, z, from, to }),
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters,
		direction,
		portType,
	});
}

function rectangleEdgeTuples(
	width: number,
	height: number,
): Array<readonly [number, number, number, number]> {
	const edges: Array<readonly [number, number, number, number]> = [];
	for (let x = 0; x < width; x++) edges.push([x, 0, x + 1, 0]);
	for (let z = 0; z < height; z++) edges.push([width, z, width, z + 1]);
	for (let x = width; x > 0; x--) edges.push([x, height, x - 1, height]);
	for (let z = height; z > 0; z--) edges.push([0, z, 0, z - 1]);
	return edges;
}

function organizationBundleFixture(): StaticFabOrganizationBundle {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 });
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Organization bundle fixture rail failed: ${plan.reason}`);
	}
	const edgeByKey = new Map(
		buildRailModuleOwnershipIndex(document.map).modules.flatMap((module) =>
			module.eraseEdges.map((edge) => [staticFabOrganizationEdgeKey(edge), edge] as const),
		),
	);
	const railEdges = Object.freeze([...edgeByKey.values()].sort(compareDirectedRailEdges));
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: 3,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "AREA" as const,
				name: "Portable Bay",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "Reusable process bay", color: "CYAN" as const }),
				membership: Object.freeze({
					railEdges,
					advancedSwitchIds: Object.freeze([]),
					equipmentGroupIds: Object.freeze([]),
				}),
			}),
			Object.freeze({
				id: 2,
				kind: "BAY" as const,
				name: "Nested Process Bay",
				parentOrganizationIds: Object.freeze([1]),
				properties: Object.freeze({ description: "Inherited bay", color: "AMBER" as const }),
				membership: Object.freeze({
					railEdges,
					advancedSwitchIds: Object.freeze([]),
					equipmentGroupIds: Object.freeze([]),
				}),
			}),
		]),
	});
	const captured = captureStaticFabOrganizationBundle(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		organizations,
		document.relationships,
		[1],
		"EFFECTIVE",
	);
	if (!captured.valid) throw new Error(`Organization bundle fixture failed: ${captured.reason}`);
	return captured.bundle;
}

function mutableCopy(project: OpenFabProject): MutableProject {
	return JSON.parse(JSON.stringify(project)) as MutableProject;
}
