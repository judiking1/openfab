import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE,
	ADVANCED_SWITCH_SEGMENT_ROLE,
} from "../compile/AdvancedSwitchPhysicalVariant";
import {
	PATH_INTERVAL_MAPPING_KIND,
	PATH_SOURCE_IDENTITY_KIND,
} from "../compile/CompoundPhysicalPath";
import { PATH_KIND, PHYSICAL_PATH_SOURCE_KIND } from "../compile/PhysicalPathCompiler";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { planAdvancedSwitch, planAdvancedSwitchReshape } from "../core/AdvancedSwitchPlanner";
import { planRailConstruction } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { DIR_E, DIR_N } from "../core/railShape";
import { TileMap } from "../core/TileMap";
import { createAdvancedSwitchRecordFields, writeAdvancedSwitchRecord } from "./AdvancedSwitchSoA";
import {
	captureRailMirrorSnapshot,
	checksumRailMap,
	RailChecksumAccumulator,
} from "./RailMirrorChecksum";
import { RailPatchMirror } from "./RailPatchMirror";
import {
	checksumRailPhysicalLayout,
	createRailPhysicalResetPublication,
} from "./RailPhysicalLayout";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "./railMirrorProtocol";

describe("advanced switch worker mirror", () => {
	it("mirrors add, delete, undo, redo, clear, and snapshot hydration with stable identity", () => {
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, 0).snapshot);
		document.subscribe((event) => mirror.applyPatch(event));

		buildFeeder(document);
		const record = buildSwitch(document);
		expect(mirror.state).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: checksumRailMap(document.map),
			switches: 1,
		});
		expect(mirror.getPhysicalPublication().current.buffers.advancedSwitches).toMatchObject({
			count: 1,
			ids: new Uint32Array([record.id]),
		});

		expect(document.undo()).toBe(true);
		expect(mirror.state.switches).toBe(0);
		expect(document.redo()).toBe(true);
		expect(mirror.state.switches).toBe(1);
		expect(document.map.getAdvancedSwitch(record.id)).toEqual(record);

		expect(document.clear()).toBe(true);
		expect(mirror.state).toMatchObject({ cells: 0, edges: 0, switches: 0 });
		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({
			checksum: checksumRailMap(document.map),
			switches: 1,
		});

		const capture = captureRailMirrorSnapshot(document.map, document.getPatchSequence());
		const hydrated = new RailPatchMirror();
		expect(hydrated.sync(capture.snapshot)).toMatchObject({
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			checksum: capture.snapshot.checksum,
			switches: 1,
		});
		expect(checksumRailPhysicalLayout(hydrated.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers),
		);
	});

	it("includes switch identity and metadata in the deterministic authored checksum", () => {
		const first = makeSwitch(1, 0, 0, "A");
		const second = makeSwitch(2, 100, 0, "D");
		const forward = new TileMap();
		const reverse = new TileMap();
		forward.setAdvancedSwitch(first);
		forward.setAdvancedSwitch(second);
		reverse.setAdvancedSwitch(second);
		reverse.setAdvancedSwitch(first);

		expect(checksumRailMap(forward)).toBe(checksumRailMap(reverse));
		expect(checksumRailMap(forward)).not.toBe(checksumRailMap(new TileMap()));

		const changed = new TileMap();
		changed.setAdvancedSwitch({ ...first, profileClass: "B" });
		changed.setAdvancedSwitch(second);
		expect(checksumRailMap(changed)).not.toBe(checksumRailMap(forward));
	});

	it("round-trips fixed typed switch patch buffers and rejects malformed presence payloads", () => {
		const record = makeSwitch(17, -12, 34, "C");
		const event = switchOnlyEvent({ id: record.id, before: null, after: record });
		const encoded = encodeRailPatchEvent(event);
		expect(encoded.transfer).toHaveLength(100);
		expect(encoded.patch.switchIds).toBeInstanceOf(Int32Array);
		expect(encoded.patch.switchAfter.origins).toBeInstanceOf(Int32Array);
		const delivered = structuredClone(encoded.patch, { transfer: encoded.transfer });
		expect(encoded.patch.switchIds.byteLength).toBe(0);
		expect(decodeRailPatchSoA(delivered).switchChanges).toEqual(event.switchChanges);

		const invalidMask = encodeRailPatchEvent(event).patch;
		invalidMask.switchAfter.movementMasks[0] = 3;
		expect(() => decodeRailPatchSoA(invalidMask)).toThrow("all four K2,2 movements");

		const invalidPresence = encodeRailPatchEvent(event).patch;
		invalidPresence.switchAfterPresent[0] = 2;
		expect(() => decodeRailPatchSoA(invalidPresence)).toThrow("presence 2 is not 0 or 1");

		const deletion = encodeRailPatchEvent(
			switchOnlyEvent({ id: record.id, before: record, after: null }),
		).patch;
		deletion.switchAfter.origins[0] = 1;
		expect(() => decodeRailPatchSoA(deletion)).toThrow("absent advanced switch payload");

		expect(() =>
			encodeRailPatchEvent(
				switchOnlyEvent({ id: record.id, before: null, after: { ...record, id: record.id + 1 } }),
			),
		).toThrow("record id does not match");
		expect(() =>
			encodeRailPatchEvent(
				switchOnlyEvent({
					id: record.id,
					before: null,
					after: { ...record, origin: { x: 0x80000000, y: 0 } },
				}),
			),
		).toThrow("outside the signed 32-bit worker contract");
	});

	it("rejects malformed, duplicate, overlapping, and topologically corrupt snapshots", () => {
		const document = new RailDocument();
		buildFeeder(document);
		buildSwitch(document);
		const malformed = captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot;
		malformed.switchRecords.profileClasses[0] = 9;
		expect(() => new RailPatchMirror().sync(malformed)).toThrow("profile class 9 is invalid");

		const duplicateRecord = makeSwitch(1, 0, 0, "A");
		expect(() =>
			new RailPatchMirror().sync(snapshotWithSwitches([duplicateRecord, duplicateRecord])),
		).toThrow("duplicate advanced switch id 1");

		const overlapping = makeSwitch(2, 0, 0, "A");
		expect(() =>
			new RailPatchMirror().sync(snapshotWithSwitches([duplicateRecord, overlapping])),
		).toThrow("overlaps switch 1");

		const missingRail = new TileMap();
		missingRail.setAdvancedSwitch(duplicateRecord);
		expect(() =>
			new RailPatchMirror().sync(captureRailMirrorSnapshot(missingRail, 0).snapshot),
		).toThrow("topology is invalid");
	});

	it("rejects duplicate IDs, overlapping claims, and metadata before mismatches atomically", () => {
		const document = new RailDocument();
		buildFeeder(document);
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: -2 }, "A");
		expect(plan.valid, plan.reason).toBe(true);
		const record = plan.switchRecord as AdvancedSwitchRecord;
		const before = mirror.state;

		const duplicatePatch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: before.sequence + 1,
			kind: "build",
			baseRevision: before.revision,
			revision: before.revision + plan.mutations.length + 2,
			changes: plan.mutations,
			portChanges: [],
			equipmentGroupChanges: [],
			switchChanges: [
				{ id: record.id, before: null, after: record },
				{ id: record.id, before: null, after: record },
			],
		};
		expect(() => mirror.applyPatch(duplicatePatch)).toThrow("more than once");
		expect(mirror.state).toEqual(before);

		const overlappingRecord = { ...record, id: record.id + 1 };
		const overlapPatch: RailPatchEvent = {
			...duplicatePatch,
			switchChanges: [
				{ id: record.id, before: null, after: record },
				{ id: overlappingRecord.id, before: null, after: overlappingRecord },
			],
		};
		expect(() => mirror.applyPatch(overlapPatch)).toThrow("CLAIM_CONFLICT");
		expect(mirror.state).toEqual(before);

		const mismatchPatch: RailPatchEvent = {
			...emptyOrganizationPatch(),
			sequence: before.sequence + 1,
			kind: "erase",
			baseRevision: before.revision,
			revision: before.revision + 1,
			changes: [],
			portChanges: [],
			equipmentGroupChanges: [],
			switchChanges: [{ id: record.id, before: record, after: null }],
		};
		expect(() => mirror.applyPatch(mismatchPatch)).toThrow("before-value mismatch");
		expect(mirror.state).toEqual(before);
	});

	it("rolls back switch cells, claims, checksum, and physical publication after compile failure", () => {
		let failSwitchCompilation = false;
		const mirror = new RailPatchMirror((map, revision) => {
			if (failSwitchCompilation && map.advancedSwitchCount > 0) {
				throw new Error("Injected advanced switch compile failure");
			}
			return compilePhysicalRail(map, revision);
		});
		const document = new RailDocument();
		buildFeeder(document);
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const patches: RailPatchEvent[] = [];
		document.subscribe((event) => patches.push(event));
		buildSwitch(document);
		const patch = patches.at(-1) as RailPatchEvent;
		const beforeState = mirror.state;
		const beforePublication = mirror.getPhysicalPublication();

		failSwitchCompilation = true;
		expect(() => mirror.applyPatch(patch)).toThrow("Injected advanced switch compile failure");
		expect(mirror.state).toEqual(beforeState);
		expect(mirror.getPhysicalPublication()).toBe(beforePublication);

		failSwitchCompilation = false;
		expect(mirror.applyPatch(patch)).toMatchObject({
			checksum: checksumRailMap(document.map),
			switches: 1,
		});
		expect(mirror.getPhysicalPublication().current.buffers.advancedSwitches.count).toBe(1);
	});

	it("rolls back and retries a same-id replacement after compilation fails", () => {
		let failReplacement = false;
		const mirror = new RailPatchMirror((map, revision) => {
			let replacementPresent = false;
			map.forEachAdvancedSwitch((record) => {
				if (record.profileClass === "D") replacementPresent = true;
			});
			if (failReplacement && replacementPresent) {
				throw new Error("Injected advanced switch replacement failure");
			}
			return compilePhysicalRail(map, revision);
		});
		const document = new RailDocument();
		buildFeeder(document);
		const original = buildSwitch(document);
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		const patches: RailPatchEvent[] = [];
		document.subscribe((event) => patches.push(event));
		const reshape = planAdvancedSwitchReshape(document.map, original.id, "D", "right");
		expect(reshape.valid, reshape.reason).toBe(true);
		expect(document.commit(reshape)).toBe(true);
		const encoded = encodeRailPatchEvent(patches.at(-1) as RailPatchEvent);
		const replacementPatch = decodeRailPatchSoA(
			structuredClone(encoded.patch, { transfer: encoded.transfer }),
		);
		const beforeState = mirror.state;
		const beforePublication = mirror.getPhysicalPublication();

		failReplacement = true;
		expect(() => mirror.applyPatch(replacementPatch)).toThrow(
			"Injected advanced switch replacement failure",
		);
		expect(mirror.state).toEqual(beforeState);
		expect(mirror.getPhysicalPublication()).toBe(beforePublication);

		failReplacement = false;
		expect(mirror.applyPatch(replacementPatch)).toMatchObject({
			switches: 1,
			checksum: checksumRailMap(document.map),
		});
		expect(mirror.getPhysicalPublication().current.buffers.advancedSwitches.ids).toEqual(
			new Uint32Array([original.id]),
		);
	});

	it("includes compiled advanced switch buffers in physical telemetry and fingerprint", () => {
		const document = new RailDocument();
		buildFeeder(document);
		buildSwitch(document);
		const layout = compilePhysicalRail(document.map);
		expect(layout.advancedSwitches.count).toBe(1);
		const baseline = checksumRailPhysicalLayout(layout);
		const movementMask = layout.advancedSwitches.movementMasks[0] as number;
		layout.advancedSwitches.movementMasks[0] = 0;
		expect(checksumRailPhysicalLayout(layout)).not.toBe(baseline);
		layout.advancedSwitches.movementMasks[0] = movementMask;

		const addedContractViews = [
			["path source kind", layout.paths.sourceKinds],
			["path switch owner", layout.paths.advancedSwitchIds],
			["path switch class", layout.paths.advancedSwitchProfileClasses],
			["path switch role", layout.paths.advancedSwitchSegmentRoles],
			["path switch port", layout.paths.advancedSwitchSegmentPorts],
			["path switch ordinal", layout.paths.advancedSwitchSegmentOrdinals],
			["path switch catalog profile", layout.paths.advancedSwitchCatalogProfiles],
			["explicit adjacency", layout.paths.explicitAdjacencyTargets],
			["remap source kind", layout.pathIntervalRemap.sourceIdentityKinds],
			["remap switch owner", layout.pathIntervalRemap.sourceAdvancedSwitchIds],
			["port station", layout.advancedSwitches.portPathStations],
			["movement start", layout.advancedSwitches.movementPathStarts],
			["movement end", layout.advancedSwitches.movementPathEnds],
			["movement conflict offset", layout.advancedSwitches.movementConflictOffsets],
			["movement conflict row", layout.advancedSwitches.movementConflictIntervalIndices],
			["conflict zone length", layout.advancedSwitches.conflictZoneLengthsMeters],
			["conflict path start", layout.advancedSwitches.conflictPathStarts],
			["conflict path end", layout.advancedSwitches.conflictPathEnds],
			["conflict interval kind", layout.advancedSwitches.conflictIntervalKinds],
			["conflict route", layout.advancedSwitches.conflictRouteIndices],
		] as const;
		for (const [name, view] of addedContractViews) {
			expect(view.length, name).toBeGreaterThan(0);
			const before = view[0] as number;
			view[0] = before + (view instanceof Float32Array ? 0.001 : 1);
			expect(checksumRailPhysicalLayout(layout), name).not.toBe(baseline);
			view[0] = before;
			expect(checksumRailPhysicalLayout(layout), `${name} restore`).toBe(baseline);
		}
	});

	it("rejects malformed synthetic identity, adjacency, and remap buffers before ownership", () => {
		const document = new RailDocument();
		buildFeeder(document);
		buildSwitch(document);
		const baseline = compilePhysicalRail(document.map);
		const syntheticPath = [...baseline.paths.advancedSwitchIds].findIndex((id) => id > 0);
		const syntheticProfile = [...baseline.compoundProfiles.advancedSwitchIds].findIndex(
			(id) => id > 0,
		);
		expect(syntheticPath).toBeGreaterThanOrEqual(0);
		expect(syntheticProfile).toBeGreaterThanOrEqual(0);

		const invalidRole = structuredClone(baseline);
		invalidRole.paths.advancedSwitchSegmentRoles[syntheticPath] = 9;
		expect(() => createRailPhysicalResetPublication(invalidRole, 1)).toThrow(
			"Synthetic physical path identity is malformed",
		);

		const invalidAdjacency = structuredClone(baseline);
		invalidAdjacency.paths.explicitAdjacencyTargets[0] = invalidAdjacency.paths.pathCount;
		expect(() => createRailPhysicalResetPublication(invalidAdjacency, 1)).toThrow(
			"invalid explicit successor",
		);

		const invalidGeometry = structuredClone(baseline);
		const pointStart = invalidGeometry.paths.offsets[syntheticPath] as number;
		invalidGeometry.paths.positions[pointStart * 2] += 0.1;
		expect(() => createRailPhysicalResetPublication(invalidGeometry, 1)).toThrow(
			"geometry samples differ",
		);

		const invalidRemap = structuredClone(baseline);
		const syntheticSource = [...invalidRemap.pathIntervalRemap.sourceAdvancedSwitchIds].findIndex(
			(id) => id > 0,
		);
		invalidRemap.pathIntervalRemap.sourceAdvancedSwitchIds[syntheticSource]++;
		expect(() => createRailPhysicalResetPublication(invalidRemap, 1)).toThrow(
			"not a full identity mapping",
		);

		const invalidRemapLength = structuredClone(baseline);
		invalidRemapLength.pathIntervalRemap.sourceStarts =
			invalidRemapLength.pathIntervalRemap.sourceStarts.slice(1);
		expect(() => createRailPhysicalResetPublication(invalidRemapLength, 1)).toThrow(
			"sourceStarts length must equal count",
		);

		const invalidRemapTarget = structuredClone(baseline);
		invalidRemapTarget.pathIntervalRemap.targetPathIndices[0] = baseline.paths.pathCount;
		expect(() => createRailPhysicalResetPublication(invalidRemapTarget, 1)).toThrow(
			"invalid target interval",
		);

		const invalidRemapIdentityKind = structuredClone(baseline);
		invalidRemapIdentityKind.pathIntervalRemap.sourceIdentityKinds[0] = 7;
		expect(() => createRailPhysicalResetPublication(invalidRemapIdentityKind, 1)).toThrow(
			"invalid identity kind",
		);

		const invalidCardinalAdjacency = structuredClone(baseline);
		const cardinalPath = invalidCardinalAdjacency.paths.sourceKinds.indexOf(0);
		expect(cardinalPath).toBeGreaterThanOrEqual(0);
		const insertAt = invalidCardinalAdjacency.paths.explicitAdjacencyOffsets[
			cardinalPath
		] as number;
		const previousTargets = invalidCardinalAdjacency.paths.explicitAdjacencyTargets;
		const injectedTargets = new Uint32Array(previousTargets.length + 1);
		injectedTargets.set(previousTargets.slice(0, insertAt));
		injectedTargets[insertAt] = cardinalPath;
		injectedTargets.set(previousTargets.slice(insertAt), insertAt + 1);
		invalidCardinalAdjacency.paths.explicitAdjacencyTargets = injectedTargets;
		for (
			let pathOffset = cardinalPath + 1;
			pathOffset < invalidCardinalAdjacency.paths.explicitAdjacencyOffsets.length;
			pathOffset++
		) {
			invalidCardinalAdjacency.paths.explicitAdjacencyOffsets[pathOffset]++;
		}
		expect(() => createRailPhysicalResetPublication(invalidCardinalAdjacency, 1)).toThrow(
			"Cardinal physical path",
		);

		const invalidSyntheticCanonicalStation = structuredClone(baseline);
		invalidSyntheticCanonicalStation.pathIntervalRemap.sourcePathCanonicalStarts[syntheticSource] =
			0.1;
		expect(() => createRailPhysicalResetPublication(invalidSyntheticCanonicalStation, 1)).toThrow(
			"Synthetic remap source metadata differs",
		);

		const invalidProfileRadius = structuredClone(baseline);
		invalidProfileRadius.compoundProfiles.compiledRadiusMillimeters[syntheticProfile]++;
		expect(() => createRailPhysicalResetPublication(invalidProfileRadius, 1)).toThrow(
			"Synthetic compound profile differs",
		);

		const invalidProfileMember = structuredClone(baseline);
		const memberRow = invalidProfileMember.compoundProfiles.memberOffsets[
			syntheticProfile
		] as number;
		invalidProfileMember.compoundProfiles.memberPathIndices[memberRow] = 0;
		expect(() => createRailPhysicalResetPublication(invalidProfileMember, 1)).toThrow(
			"Synthetic compound profile differs",
		);

		const invalidInset = structuredClone(baseline);
		invalidInset.paths.startInsets[syntheticPath] = 0.1;
		expect(() => createRailPhysicalResetPublication(invalidInset, 1)).toThrow(
			"Synthetic physical geometry metadata differs",
		);

		const invalidAggregate = structuredClone(baseline);
		invalidAggregate.paths.totalRouteLengthMeters += 1;
		expect(() => createRailPhysicalResetPublication(invalidAggregate, 1)).toThrow(
			"aggregate metadata differs",
		);

		const invalidAggregateNaN = structuredClone(baseline);
		invalidAggregateNaN.paths.totalLengthMeters = Number.NaN;
		expect(() => createRailPhysicalResetPublication(invalidAggregateNaN, 1)).toThrow(
			"aggregate metadata differs",
		);

		const invalidSharedIdentity = structuredClone(baseline);
		const inputPaths = [...invalidSharedIdentity.paths.advancedSwitchSegmentRoles]
			.map((role, pathIndex) => ({ role, pathIndex }))
			.filter(({ role }) => role === ADVANCED_SWITCH_SEGMENT_ROLE.INPUT)
			.map(({ pathIndex }) => pathIndex);
		expect(inputPaths).toHaveLength(2);
		const changedSharedRow = invalidSharedIdentity.paths.sharedSegmentOffsets[
			inputPaths[1] as number
		] as number;
		const changedSharedLength =
			(invalidSharedIdentity.paths.sharedSegmentEnds[changedSharedRow] as number) -
			(invalidSharedIdentity.paths.sharedSegmentStarts[changedSharedRow] as number);
		invalidSharedIdentity.paths.sharedSegmentIds[changedSharedRow] =
			Math.max(...invalidSharedIdentity.paths.sharedSegmentIds) + 1;
		invalidSharedIdentity.paths.sharedSegmentCount++;
		invalidSharedIdentity.paths.totalLengthMeters += changedSharedLength;
		expect(() => createRailPhysicalResetPublication(invalidSharedIdentity, 1)).toThrow(
			"Synthetic shared identity differs",
		);

		const reusedAcrossSwitches = compilePhysicalRail(
			buildDirectSwitchMap([makeSwitch(1, 0, 0, "A"), makeSwitch(2, 30, 0, "A")]),
		);
		const firstInputPath = [...reusedAcrossSwitches.paths.advancedSwitchIds].findIndex(
			(switchId, pathIndex) =>
				switchId === 1 &&
				reusedAcrossSwitches.paths.advancedSwitchSegmentRoles[pathIndex] ===
					ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
		);
		const secondInputPaths = [...reusedAcrossSwitches.paths.advancedSwitchIds]
			.map((switchId, pathIndex) => ({ switchId, pathIndex }))
			.filter(
				({ switchId, pathIndex }) =>
					switchId === 2 &&
					reusedAcrossSwitches.paths.advancedSwitchSegmentRoles[pathIndex] ===
						ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
			)
			.map(({ pathIndex }) => pathIndex);
		expect(firstInputPath).toBeGreaterThanOrEqual(0);
		expect(secondInputPaths).toHaveLength(2);
		const reusedSharedId = reusedAcrossSwitches.paths.sharedSegmentIds[
			reusedAcrossSwitches.paths.sharedSegmentOffsets[firstInputPath] as number
		] as number;
		for (const pathIndex of secondInputPaths) {
			const row = reusedAcrossSwitches.paths.sharedSegmentOffsets[pathIndex] as number;
			reusedAcrossSwitches.paths.sharedSegmentIds[row] = reusedSharedId;
		}
		recomputePathAggregates(reusedAcrossSwitches.paths);
		expect(() => createRailPhysicalResetPublication(reusedAcrossSwitches, 1)).toThrow(
			"reused by unrelated owners",
		);

		const extraSynthetic = structuredClone(baseline);
		const compoundPaths = new Set(extraSynthetic.compoundProfiles.pathIndices);
		let extraPath = -1;
		let extraSource = -1;
		for (let pathIndex = 0; pathIndex < extraSynthetic.paths.pathCount; pathIndex++) {
			if (
				(extraSynthetic.paths.sourceKinds[pathIndex] as number) !==
					PHYSICAL_PATH_SOURCE_KIND.CARDINAL_CELL ||
				compoundPaths.has(pathIndex) ||
				(extraSynthetic.paths.explicitAdjacencyOffsets[pathIndex] as number) !==
					(extraSynthetic.paths.explicitAdjacencyOffsets[pathIndex + 1] as number)
			) {
				continue;
			}
			for (
				let sourcePathIndex = 0;
				sourcePathIndex < extraSynthetic.pathIntervalRemap.sourcePathCount;
				sourcePathIndex++
			) {
				const row = extraSynthetic.pathIntervalRemap.sourcePathOffsets[sourcePathIndex] as number;
				if (
					(extraSynthetic.pathIntervalRemap.sourceIdentityKinds[sourcePathIndex] as number) ===
						PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL &&
					(extraSynthetic.pathIntervalRemap.sourcePathOffsets[sourcePathIndex + 1] as number) ===
						row + 1 &&
					(extraSynthetic.pathIntervalRemap.mappingKinds[row] as number) ===
						PATH_INTERVAL_MAPPING_KIND.IDENTITY &&
					(extraSynthetic.pathIntervalRemap.targetPathIndices[row] as number) === pathIndex &&
					(extraSynthetic.pathIntervalRemap.sourcePathCanonicalStarts[
						sourcePathIndex
					] as number) === 0
				) {
					extraPath = pathIndex;
					extraSource = sourcePathIndex;
					break;
				}
			}
			if (extraPath >= 0) break;
		}
		expect(extraPath).toBeGreaterThanOrEqual(0);
		expect(extraSource).toBeGreaterThanOrEqual(0);
		const unownedSwitchId = (baseline.advancedSwitches.ids[0] as number) + 1_000;
		extraSynthetic.paths.sourceKinds[extraPath] = PHYSICAL_PATH_SOURCE_KIND.ADVANCED_SWITCH_SEGMENT;
		extraSynthetic.paths.kinds[extraPath] = PATH_KIND.ADVANCED_SWITCH_SEGMENT;
		extraSynthetic.paths.advancedSwitchIds[extraPath] = unownedSwitchId;
		extraSynthetic.paths.advancedSwitchProfileClasses[extraPath] = 0;
		extraSynthetic.paths.advancedSwitchSegmentRoles[extraPath] = ADVANCED_SWITCH_SEGMENT_ROLE.INPUT;
		extraSynthetic.paths.advancedSwitchSegmentPorts[extraPath] = 0;
		extraSynthetic.paths.advancedSwitchSegmentOrdinals[extraPath] = 0;
		extraSynthetic.paths.advancedSwitchCatalogProfiles[extraPath] =
			ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_LINEAR;
		extraSynthetic.pathIntervalRemap.sourceIdentityKinds[extraSource] =
			PATH_SOURCE_IDENTITY_KIND.ADVANCED_SWITCH_SEGMENT;
		extraSynthetic.pathIntervalRemap.sourcePathKinds[extraSource] =
			PATH_KIND.ADVANCED_SWITCH_SEGMENT;
		extraSynthetic.pathIntervalRemap.sourceAdvancedSwitchIds[extraSource] = unownedSwitchId;
		extraSynthetic.pathIntervalRemap.sourceAdvancedSwitchProfileClasses[extraSource] = 0;
		extraSynthetic.pathIntervalRemap.sourceAdvancedSwitchRoles[extraSource] =
			ADVANCED_SWITCH_SEGMENT_ROLE.INPUT;
		extraSynthetic.pathIntervalRemap.sourceAdvancedSwitchPorts[extraSource] = 0;
		extraSynthetic.pathIntervalRemap.sourceAdvancedSwitchSegmentOrdinals[extraSource] = 0;
		expect(() => createRailPhysicalResetPublication(extraSynthetic, 1)).toThrow(
			"switch ownership and synthetic identity sets differ",
		);
	});

	it("mirrors same-id footprint replacement and restores exact switch state through undo and redo", () => {
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, 0).snapshot);
		const typedEvents: RailPatchEvent[] = [];
		document.subscribe((event) => {
			const encoded = encodeRailPatchEvent(event);
			const transferred = structuredClone(encoded.patch, { transfer: encoded.transfer });
			const decoded = decodeRailPatchSoA(transferred);
			typedEvents.push(decoded);
			mirror.applyPatch(decoded);
		});

		buildFeeder(document);
		const original = buildSwitch(document);
		const originalChecksum = mirror.state.checksum;
		const originalFingerprint = mirror.getPhysicalPublication().current.identity.fingerprint;
		const originalBuffers = structuredClone(
			mirror.getPhysicalPublication().current.buffers.advancedSwitches,
		);

		const reshape = planAdvancedSwitchReshape(document.map, original.id, "D", "right");
		expect(reshape.valid, reshape.reason).toBe(true);
		expect(document.commit(reshape)).toBe(true);
		const replacementEvent = typedEvents.at(-1) as RailPatchEvent;
		expect(replacementEvent.switchChanges).toHaveLength(1);
		expect(replacementEvent.switchChanges[0]).toMatchObject({
			id: original.id,
			before: { id: original.id, profileClass: "A" },
			after: { id: original.id, profileClass: "D" },
		});
		expect(mirror.state.switches).toBe(1);
		expect(document.map.getAdvancedSwitch(original.id)).toEqual(reshape.switchRecord);
		const replacementChecksum = mirror.state.checksum;
		const replacementFingerprint = mirror.getPhysicalPublication().current.identity.fingerprint;
		const replacementBuffers = structuredClone(
			mirror.getPhysicalPublication().current.buffers.advancedSwitches,
		);
		expect(replacementChecksum).not.toBe(originalChecksum);
		expect(replacementFingerprint).not.toBe(originalFingerprint);
		expect(replacementBuffers.ids).toEqual(new Uint32Array([original.id]));

		expect(document.undo()).toBe(true);
		expect(mirror.state).toMatchObject({ switches: 1, checksum: originalChecksum });
		expect(document.map.getAdvancedSwitch(original.id)).toEqual(original);
		expect(mirror.getPhysicalPublication().current.buffers.advancedSwitches).toEqual(
			originalBuffers,
		);

		expect(document.redo()).toBe(true);
		expect(mirror.state).toMatchObject({ switches: 1, checksum: replacementChecksum });
		expect(document.map.getAdvancedSwitch(original.id)).toEqual(reshape.switchRecord);
		expect(mirror.getPhysicalPublication().current.buffers.advancedSwitches).toEqual(
			replacementBuffers,
		);
	});
});

function buildFeeder(document: RailDocument): void {
	expect(document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 }))).toBe(
		true,
	);
}

function buildSwitch(document: RailDocument): AdvancedSwitchRecord {
	const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: -2 }, "A");
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return plan.switchRecord as AdvancedSwitchRecord;
}

function makeSwitch(
	id: number,
	x: number,
	y: number,
	profileClass: AdvancedSwitchRecord["profileClass"],
): AdvancedSwitchRecord {
	return {
		id,
		profileClass,
		origin: { x, y },
		forward: DIR_E,
		lateral: DIR_N,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
}

function switchOnlyEvent(change: RailPatchEvent["switchChanges"][number]): RailPatchEvent {
	return {
		...emptyOrganizationPatch(),
		sequence: 1,
		kind: change.after ? "build" : "erase",
		baseRevision: 0,
		revision: 1,
		changes: [],
		switchChanges: [change],
		portChanges: [],
		equipmentGroupChanges: [],
	};
}

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

function snapshotWithSwitches(records: readonly AdvancedSwitchRecord[]) {
	const snapshot = captureRailMirrorSnapshot(new TileMap(), 0).snapshot;
	const switchIds = new Int32Array(records.length);
	const switchRecords = createAdvancedSwitchRecordFields(records.length);
	const checksum = new RailChecksumAccumulator();
	for (let index = 0; index < records.length; index++) {
		const record = records[index] as AdvancedSwitchRecord;
		switchIds[index] = record.id;
		writeAdvancedSwitchRecord(switchRecords, index, record);
		checksum.addSwitch(record);
	}
	return { ...snapshot, switchIds, switchRecords, checksum: checksum.digest() };
}

function buildDirectSwitchMap(records: readonly AdvancedSwitchRecord[]): TileMap {
	const map = new TileMap();
	for (const record of records) {
		for (const cell of deriveAdvancedSwitchGeometry(record).cellStates) {
			map.setEncoded(cell.x, cell.y, cell.encoded);
		}
		map.setAdvancedSwitch(record);
	}
	return map;
}

function recomputePathAggregates(paths: ReturnType<typeof compilePhysicalRail>["paths"]): void {
	let totalRouteLengthMeters = 0;
	for (const length of paths.lengths) totalRouteLengthMeters += length;
	const usage = new Map<number, { count: number; length: number }>();
	for (let row = 0; row < paths.sharedSegmentIds.length; row++) {
		const id = paths.sharedSegmentIds[row] as number;
		const length =
			(paths.sharedSegmentEnds[row] as number) - (paths.sharedSegmentStarts[row] as number);
		const previous = usage.get(id);
		usage.set(id, {
			count: (previous?.count ?? 0) + 1,
			length: Math.max(previous?.length ?? 0, length),
		});
	}
	let duplicatedLengthMeters = 0;
	for (const shared of usage.values()) {
		duplicatedLengthMeters += shared.length * Math.max(0, shared.count - 1);
	}
	paths.sharedSegmentCount = usage.size;
	paths.totalRouteLengthMeters = totalRouteLengthMeters;
	paths.totalLengthMeters = totalRouteLengthMeters - duplicatedLengthMeters;
}
