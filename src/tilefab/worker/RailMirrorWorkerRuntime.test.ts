import { describe, expect, it } from "vitest";
import { compilePhysicalPathMigration } from "../compile/PhysicalPathMigration";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { emptyOperationalConfigurationState } from "../core/OperationalConfiguration";
import { planRailConstruction } from "../core/paint";
import { createRailAreaSelection } from "../core/RailAreaSelection";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	planCreateStaticFabOrganizationFromSelection,
	planRenameStaticFabOrganization,
} from "../core/StaticFabOrganizationPlan";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { captureRailMirrorSnapshot } from "./RailMirrorChecksum";
import { RailMirrorWorkerRuntime } from "./RailMirrorWorkerRuntime";
import { RailPatchMirror } from "./RailPatchMirror";
import { encodeRailPatchEvent } from "./railMirrorProtocol";

describe("RailMirrorWorkerRuntime", () => {
	it("re-acknowledges exact sync duplicates and drops stale snapshots without recompiling", () => {
		let compileCount = 0;
		const mirror = new RailPatchMirror((map, revision) => {
			compileCount++;
			return compilePhysicalRail(map, revision);
		});
		const runtime = new RailMirrorWorkerRuntime(mirror);
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const snapshot = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		const first = runtime.handle({
			type: "SYNC_RAIL",
			epoch: 1,
			snapshot,
			operationalConfiguration: emptyOperationalConfigurationState(),
		});
		const publication = runtime.physicalPublication;
		const compiledAfterFirstSync = compileCount;

		expect(first).toMatchObject({ type: "RAIL_SYNCED", epoch: 1, sequence: 1 });
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 1,
				snapshot,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toMatchObject({
			type: "RAIL_SYNCED",
			epoch: 1,
			sequence: 1,
		});
		expect(compileCount).toBe(compiledAfterFirstSync);
		expect(runtime.physicalPublication).toBe(publication);

		const staleDocument = new RailDocument();
		const stale = captureRailMirrorSnapshot(staleDocument.map, 0).snapshot;
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 1,
				snapshot: stale,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toBeNull();
		expect(compileCount).toBe(compiledAfterFirstSync);
	});

	it("latches a failed snapshot without replacing the active epoch or publication", () => {
		let failCompilation = false;
		let compileCount = 0;
		const mirror = new RailPatchMirror((map, revision) => {
			compileCount++;
			if (failCompilation) throw new Error("Injected sync compile failure");
			return compilePhysicalRail(map, revision);
		});
		const runtime = new RailMirrorWorkerRuntime(mirror);
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const firstSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
		).snapshot;
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 1,
				snapshot: firstSnapshot,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toMatchObject({
			type: "RAIL_SYNCED",
			epoch: 1,
		});
		const publication = runtime.physicalPublication;
		const patches: RailPatchEvent[] = [];
		document.subscribe((event) => patches.push(event));
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 4, y: 4 })),
		).toBe(true);

		failCompilation = true;
		const failedSnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
		).snapshot;
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 2,
				snapshot: failedSnapshot,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toMatchObject({
			type: "RAIL_MIRROR_ERROR",
			epoch: 2,
			sequence: 1,
		});
		expect(runtime.activeEpoch).toBe(1);
		expect(runtime.physicalPublication).toBe(publication);
		const stateAfterFailure = runtime.mirrorState;
		const compileCountAfterFailure = compileCount;

		failCompilation = false;
		const encodedPatch = encodeRailPatchEvent(patches[0] as RailPatchEvent).patch;
		expect(runtime.handle({ type: "APPLY_RAIL_PATCH", epoch: 1, patch: encodedPatch })).toBeNull();
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 3,
				snapshot: failedSnapshot,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toBeNull();
		expect(compileCount).toBe(compileCountAfterFailure);
		expect(runtime.activeEpoch).toBe(1);
		expect(runtime.mirrorState).toEqual(stateAfterFailure);
		expect(runtime.physicalPublication).toBe(publication);
	});

	it("exports a fresh transferable snapshot only for the exact synchronized identity", () => {
		const runtime = new RailMirrorWorkerRuntime();
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 })),
		).toBe(true);
		const source = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 3,
				snapshot: source,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toMatchObject({
			type: "RAIL_SYNCED",
			epoch: 3,
		});
		const publication = runtime.physicalPublication;
		const request = {
			type: "CAPTURE_RAIL_SNAPSHOT" as const,
			epoch: 3,
			requestId: 17,
			expectedSequence: source.sequence,
			expectedRevision: source.revision,
			expectedChecksum: source.checksum,
			expectedNextAdvancedSwitchId: source.nextAdvancedSwitchId,
			expectedNextPortId: source.portEquipment.nextPortId,
			expectedNextEquipmentGroupId: source.portEquipment.nextEquipmentGroupId,
			expectedNextOrganizationId: source.organizations.nextOrganizationId,
		};
		const response = runtime.handle(request);
		expect(response).toMatchObject({
			type: "RAIL_SNAPSHOT_CAPTURED",
			epoch: 3,
			requestId: 17,
			snapshot: {
				sequence: source.sequence,
				revision: source.revision,
				checksum: source.checksum,
			},
		});
		expect(response?.type === "RAIL_SNAPSHOT_CAPTURED" ? response.snapshot : null).not.toBe(source);
		expect(runtime.physicalPublication).toBe(publication);

		expect(runtime.handle({ ...request, requestId: 18, expectedChecksum: "forged" })).toMatchObject(
			{
				type: "RAIL_SNAPSHOT_CAPTURE_FAILED",
				requestId: 18,
			},
		);
		expect(runtime.physicalPublication).toBe(publication);
		expect(runtime.handle({ ...request, requestId: 19 })).toMatchObject({
			type: "RAIL_SNAPSHOT_CAPTURED",
			requestId: 19,
		});

		expect(
			runtime.handle({
				...request,
				requestId: 20,
				expectedNextPortId: request.expectedNextPortId + 1,
			}),
		).toMatchObject({
			type: "RAIL_MIRROR_ERROR",
			epoch: 3,
			message: "Rail snapshot capture cursors do not match the requested authored identity.",
		});
		expect(runtime.handle({ ...request, requestId: 21 })).toBeNull();
		expect(runtime.physicalPublication).toBe(publication);
	});

	it("exports an O(organization) outline without recompiling or changing the mirror", () => {
		let compileCount = 0;
		const mirror = new RailPatchMirror((map, revision) => {
			compileCount++;
			return compilePhysicalRail(map, revision);
		});
		const runtime = new RailMirrorWorkerRuntime(mirror);
		const document = createDocumentWithArea("Area A");
		const source = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot;
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 5,
				snapshot: source,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toMatchObject({
			type: "RAIL_SYNCED",
			epoch: 5,
		});
		const publication = runtime.physicalPublication;
		const physical = publication.current.identity;
		const compiledAfterSync = compileCount;
		const request = {
			type: "CAPTURE_STATIC_FAB_ORGANIZATION_OUTLINE" as const,
			epoch: 5,
			requestId: 41,
			expectedSequence: source.sequence,
			expectedRevision: source.revision,
			expectedChecksum: source.checksum,
			expectedNextAdvancedSwitchId: source.nextAdvancedSwitchId,
			expectedNextPortId: source.portEquipment.nextPortId,
			expectedNextEquipmentGroupId: source.portEquipment.nextEquipmentGroupId,
			expectedNextOrganizationId: source.organizations.nextOrganizationId,
			expectedPhysicalSequence: physical.sequence,
			expectedPhysicalRevision: physical.revision,
			expectedPhysicalFingerprint: physical.fingerprint,
		};

		const response = runtime.handle(request);
		expect(response).toMatchObject({
			type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED",
			epoch: 5,
			requestId: 41,
			outline: {
				sourceSequence: source.sequence,
				sourceRevision: source.revision,
				sourceChecksum: source.checksum,
				sourcePhysicalFingerprint: physical.fingerprint,
			},
		});
		expect(
			response?.type === "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED"
				? response.outline.organizationIds.length
				: -1,
		).toBe(0);
		expect(compileCount).toBe(compiledAfterSync);
		expect(runtime.physicalPublication).toBe(publication);

		expect(
			runtime.handle({
				...request,
				requestId: 42,
				expectedNextOrganizationId: request.expectedNextOrganizationId + 1,
			}),
		).toMatchObject({
			type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURE_FAILED",
			requestId: 42,
		});
		expect(runtime.handle({ ...request, requestId: 43 })).toMatchObject({
			type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED",
			requestId: 43,
		});
		expect(runtime.physicalPublication).toBe(publication);
	});

	it("latches migration publication failures against patch retries and snapshots", () => {
		let failMigration = false;
		let physicalCompileCount = 0;
		let migrationCompileCount = 0;
		const mirror = new RailPatchMirror(
			(map, revision) => {
				physicalCompileCount++;
				return compilePhysicalRail(map, revision);
			},
			(previous, next) => {
				migrationCompileCount++;
				if (failMigration) throw new Error("Injected migration compile failure");
				return compilePhysicalPathMigration(previous, next);
			},
		);
		const runtime = new RailMirrorWorkerRuntime(mirror);
		const document = new RailDocument();
		const initial = captureRailMirrorSnapshot(document.map, 0).snapshot;
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 1,
				snapshot: initial,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toMatchObject({
			type: "RAIL_SYNCED",
		});
		const patches: RailPatchEvent[] = [];
		document.subscribe((event) => patches.push(event));
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const publication = runtime.physicalPublication;

		failMigration = true;
		const patch = encodeRailPatchEvent(patches[0] as RailPatchEvent).patch;
		expect(runtime.handle({ type: "APPLY_RAIL_PATCH", epoch: 1, patch })).toMatchObject({
			type: "RAIL_MIRROR_ERROR",
			epoch: 1,
			sequence: 0,
			message: "Injected migration compile failure",
		});
		expect(runtime.physicalPublication).toBe(publication);
		expect(runtime.mirrorState.sequence).toBe(0);
		const stateAfterFailure = runtime.mirrorState;
		const physicalCompileCountAfterFailure = physicalCompileCount;
		const migrationCompileCountAfterFailure = migrationCompileCount;

		failMigration = false;
		expect(runtime.handle({ type: "APPLY_RAIL_PATCH", epoch: 1, patch })).toBeNull();
		const recoverySnapshot = captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
		).snapshot;
		expect(
			runtime.handle({
				type: "SYNC_RAIL",
				epoch: 2,
				snapshot: recoverySnapshot,
				operationalConfiguration: emptyOperationalConfigurationState(),
			}),
		).toBeNull();
		expect(physicalCompileCount).toBe(physicalCompileCountAfterFailure);
		expect(migrationCompileCount).toBe(migrationCompileCountAfterFailure);
		expect(runtime.mirrorState).toEqual(stateAfterFailure);
		expect(runtime.physicalPublication).toBe(publication);
	});

	it("reports stale organization before-values as recoverable desync and accepts a valid retry", () => {
		const document = createDocumentWithArea("Area A");
		const runtime = new RailMirrorWorkerRuntime();
		expect(runtime.handle(syncMessage(document, 1))).toMatchObject({
			type: "RAIL_SYNCED",
			epoch: 1,
		});
		const publication = runtime.physicalPublication;
		const before = runtime.mirrorState;
		const rename = capturePatch(document, () =>
			document.commitOrganization(
				planRenameStaticFabOrganization(
					document.map,
					document.portEquipment,
					document.getPatchSequence(),
					document.organizations,
					1,
					"Area B",
				),
			),
		);
		const stale = encodeRailPatchEvent(rename).patch;
		(stale.organizations.before.names as string[])[0] = "Stale Area";

		expect(runtime.handle({ type: "APPLY_RAIL_PATCH", epoch: 1, patch: stale })).toMatchObject({
			type: "RAIL_DESYNC",
			epoch: 1,
			expectedSequence: before.sequence + 1,
			expectedRevision: before.revision,
			message: expect.stringContaining("before"),
		});
		expect(runtime.mirrorState).toEqual(before);
		expect(runtime.physicalPublication).toBe(publication);

		const valid = encodeRailPatchEvent(rename).patch;
		expect(runtime.handle({ type: "APPLY_RAIL_PATCH", epoch: 1, patch: valid })).toMatchObject({
			type: "RAIL_PATCH_APPLIED",
			epoch: 1,
			sequence: rename.sequence,
			organizations: 1,
		});
	});

	it("reports a stale organization cursor as recoverable desync and accepts reset plus a valid patch", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		const runtime = new RailMirrorWorkerRuntime();
		expect(runtime.handle(syncMessage(document, 1))).toMatchObject({ type: "RAIL_SYNCED" });
		const publication = runtime.physicalPublication;
		const before = runtime.mirrorState;
		const create = capturePatch(document, () => commitArea(document, "Area A"));
		const encoded = encodeRailPatchEvent(create).patch;
		const stale = {
			...encoded,
			organizations: {
				...encoded.organizations,
				nextOrganizationIdBefore: 2,
			},
		};

		expect(runtime.handle({ type: "APPLY_RAIL_PATCH", epoch: 1, patch: stale })).toMatchObject({
			type: "RAIL_DESYNC",
			epoch: 1,
			expectedSequence: before.sequence + 1,
			expectedRevision: before.revision,
			message: "Organization ID cursor mismatch: expected 1, received 2.",
		});
		expect(runtime.mirrorState).toEqual(before);
		expect(runtime.physicalPublication).toBe(publication);

		expect(runtime.handle(syncMessage(document, 2))).toMatchObject({
			type: "RAIL_SYNCED",
			epoch: 2,
			sequence: create.sequence,
			organizations: 1,
		});
		const rename = capturePatch(document, () =>
			document.commitOrganization(
				planRenameStaticFabOrganization(
					document.map,
					document.portEquipment,
					document.getPatchSequence(),
					document.organizations,
					1,
					"Area B",
				),
			),
		);
		expect(
			runtime.handle({
				type: "APPLY_RAIL_PATCH",
				epoch: 2,
				patch: encodeRailPatchEvent(rename).patch,
			}),
		).toMatchObject({
			type: "RAIL_PATCH_APPLIED",
			epoch: 2,
			sequence: rename.sequence,
			organizations: 1,
		});
	});
});

function createDocumentWithArea(name: string): RailDocument {
	const document = new RailDocument();
	if (!document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 }))) {
		throw new Error("Failed to build runtime test rail.");
	}
	if (!commitArea(document, name)) throw new Error("Failed to create runtime test AREA.");
	return document;
}

function commitArea(document: RailDocument, name: string): boolean {
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
		),
	);
}

function capturePatch(document: RailDocument, commit: () => boolean): RailPatchEvent {
	let captured: RailPatchEvent | null = null;
	const unsubscribe = document.subscribe((event) => {
		captured = event;
	});
	const committed = commit();
	unsubscribe();
	if (!committed || captured === null) throw new Error("Failed to capture runtime test patch.");
	return captured;
}

function syncMessage(
	document: RailDocument,
	epoch: number,
): Extract<Parameters<RailMirrorWorkerRuntime["handle"]>[0], { type: "SYNC_RAIL" }> {
	return {
		type: "SYNC_RAIL",
		epoch,
		snapshot: captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		).snapshot,
		operationalConfiguration: document.operationalConfiguration,
	};
}
