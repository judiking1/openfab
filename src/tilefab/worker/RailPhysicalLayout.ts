import {
	ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND,
	ADVANCED_SWITCH_PORT_ROLE,
	type CompiledAdvancedSwitches,
	NO_ADVANCED_SWITCH_PATH,
	validateCompiledAdvancedSwitches,
} from "../compile/AdvancedSwitchCompiler";
import {
	ADVANCED_SWITCH_NO_PORT,
	ADVANCED_SWITCH_SEGMENT_ROLE,
	type AdvancedSwitchPhysicalSegment,
	advancedSwitchPhysicalProfile,
	compileAdvancedSwitchPhysicalVariant,
} from "../compile/AdvancedSwitchPhysicalVariant";
import {
	COMPOUND_CONTROL_ROLE,
	COMPOUND_GEOMETRY_KIND,
	COMPOUND_PROFILE_FIT,
	COMPOUND_PROFILE_TYPE,
	NO_PATH_INTERVAL_TARGET,
	PATH_INTERVAL_MAPPING_KIND,
	PATH_SOURCE_IDENTITY_KIND,
} from "../compile/CompoundPhysicalPath";
import { OPENFAB_COMPOUND_PROFILE_CATALOG } from "../compile/OpenFabCompoundGeometry";
import {
	type CompiledPhysicalPaths,
	NO_ADVANCED_SWITCH_CATALOG_PROFILE,
	NO_ADVANCED_SWITCH_PROFILE_CLASS,
	NO_ADVANCED_SWITCH_SEGMENT_ORDINAL,
	NO_ADVANCED_SWITCH_SEGMENT_PORT,
	NO_ADVANCED_SWITCH_SEGMENT_ROLE,
	PATH_KIND,
	PHYSICAL_PATH_SOURCE_KIND,
	samplePhysicalPath,
} from "../compile/PhysicalPathCompiler";
import {
	assertCanonicalPhysicalPathSeamCardinality,
	physicalPathDirectedSeamKey,
} from "../compile/PhysicalPathFlow";
import {
	type CompiledPhysicalPathMigration,
	PHYSICAL_PATH_MIGRATION_KIND,
	validatePhysicalPathMigration,
} from "../compile/PhysicalPathMigration";
import type { CompiledJunction, CompiledPhysicalLayout } from "../compile/PhysicalRailCompiler";
import {
	DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
	railEnvelopeChunkCoordinateIsCanonical,
} from "../compile/RailClearanceCompiler";
import { resolveRailClearanceProfile } from "../compile/RailClearanceProfile";
import {
	closestEnvelopeSegments,
	compileRailClearance,
	RAIL_CLEARANCE_ISSUE_CODE,
	RAIL_CLEARANCE_PATH_IDENTITY_WIDTH,
	RAIL_CLEARANCE_RELATION,
	railClearancePathIdentity,
} from "../compile/RailClearanceValidator";
import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	ADVANCED_SWITCH_SHARED_TRUNK_PROFILE,
	type AdvancedSwitchRecord,
	advancedSwitchAllowsMovement,
	advancedSwitchRecordError,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "../core/railShape";
import { cellKey } from "../core/TileMap";
import { TURNOUT_KIND } from "../core/turnout";

export interface RailPhysicalLayoutIdentity {
	sequence: number;
	revision: number;
	fingerprint: string;
}

export interface WorkerOwnedRailLayout {
	identity: RailPhysicalLayoutIdentity;
	buffers: CompiledPhysicalLayout;
}

export interface WorkerOwnedRailMigration {
	from: RailPhysicalLayoutIdentity;
	to: RailPhysicalLayoutIdentity;
	fingerprint: string;
	buffers: CompiledPhysicalPathMigration;
}

export type RailPhysicalPublication =
	| {
			kind: "reset";
			previous: null;
			current: WorkerOwnedRailLayout;
			migration: null;
	  }
	| {
			kind: "delta";
			previous: WorkerOwnedRailLayout;
			current: WorkerOwnedRailLayout;
			migration: WorkerOwnedRailMigration;
	  }
	| {
			kind: "static";
			previous: WorkerOwnedRailLayout;
			current: WorkerOwnedRailLayout;
			migration: null;
	  };

export interface RailPhysicalLayoutState {
	physicalPublicationKind: RailPhysicalPublication["kind"];
	physicalSequence: number;
	physicalRevision: number;
	physicalFingerprint: string;
	physicalPathCount: number;
	physicalPointCount: number;
	physicalCompoundProfileCount: number;
	physicalClearanceEnvelopeCount: number;
	physicalClearanceIssueCount: number;
	physicalIntervalRemapCount: number;
	physicalJunctionCount: number;
	physicalAdvancedSwitchCount: number;
	physicalValid: boolean;
	physicalDiagnosticCount: number;
	previousPhysicalAvailable: boolean;
	previousPhysicalSequence: number;
	previousPhysicalRevision: number;
	previousPhysicalFingerprint: string;
	migrationAvailable: boolean;
	migrationFromSequence: number;
	migrationFromRevision: number;
	migrationFromFingerprint: string;
	migrationToSequence: number;
	migrationToRevision: number;
	migrationToFingerprint: string;
	migrationFingerprint: string;
	migrationSourcePathCount: number;
	migrationTargetPathCount: number;
	migrationRowCount: number;
	migrationMatchedRawPathCount: number;
	migrationUnmappableSourcePathCount: number;
	migrationIdentityRowCount: number;
	migrationTranslationRowCount: number;
	migrationProjectionRowCount: number;
	migrationDeletedRowCount: number;
	migrationUnmappableRowCount: number;
	migrationMaxEndpointErrorMeters: number;
	migrationMappedLengthMeters: number;
	migrationUnmappableLengthMeters: number;
}

export const EMPTY_RAIL_PHYSICAL_LAYOUT_STATE: RailPhysicalLayoutState = {
	physicalPublicationKind: "reset",
	physicalSequence: 0,
	physicalRevision: 0,
	physicalFingerprint: "00000000:00000000",
	physicalPathCount: 0,
	physicalPointCount: 0,
	physicalCompoundProfileCount: 0,
	physicalClearanceEnvelopeCount: 0,
	physicalClearanceIssueCount: 0,
	physicalIntervalRemapCount: 0,
	physicalJunctionCount: 0,
	physicalAdvancedSwitchCount: 0,
	physicalValid: true,
	physicalDiagnosticCount: 0,
	previousPhysicalAvailable: false,
	previousPhysicalSequence: 0,
	previousPhysicalRevision: 0,
	previousPhysicalFingerprint: "00000000:00000000",
	migrationAvailable: false,
	migrationFromSequence: 0,
	migrationFromRevision: 0,
	migrationFromFingerprint: "00000000:00000000",
	migrationToSequence: 0,
	migrationToRevision: 0,
	migrationToFingerprint: "00000000:00000000",
	migrationFingerprint: "00000000:00000000",
	migrationSourcePathCount: 0,
	migrationTargetPathCount: 0,
	migrationRowCount: 0,
	migrationMatchedRawPathCount: 0,
	migrationUnmappableSourcePathCount: 0,
	migrationIdentityRowCount: 0,
	migrationTranslationRowCount: 0,
	migrationProjectionRowCount: 0,
	migrationDeletedRowCount: 0,
	migrationUnmappableRowCount: 0,
	migrationMaxEndpointErrorMeters: 0,
	migrationMappedLengthMeters: 0,
	migrationUnmappableLengthMeters: 0,
};

export function createRailPhysicalResetPublication(
	layout: CompiledPhysicalLayout,
	sequence: number,
): Extract<RailPhysicalPublication, { kind: "reset" }> {
	return {
		kind: "reset",
		previous: null,
		current: ownRailPhysicalLayout(layout, sequence),
		migration: null,
	};
}

export function createRailPhysicalDeltaPublication(
	previous: WorkerOwnedRailLayout,
	currentLayout: CompiledPhysicalLayout,
	currentSequence: number,
	migration: CompiledPhysicalPathMigration,
): Extract<RailPhysicalPublication, { kind: "delta" }> {
	if (currentSequence !== previous.identity.sequence + 1) {
		throw new Error(
			`Physical publication sequence gap: expected ${previous.identity.sequence + 1}, received ${currentSequence}.`,
		);
	}
	if (
		previous.identity.revision !== previous.buffers.revision ||
		previous.identity.fingerprint !== checksumRailPhysicalLayout(previous.buffers)
	) {
		throw new Error(
			"Previous physical layout identity no longer matches its worker-owned buffers.",
		);
	}
	const current = ownRailPhysicalLayout(currentLayout, currentSequence);
	validatePhysicalPathMigration(migration, previous.buffers, current.buffers);
	const ownedMigration: WorkerOwnedRailMigration = {
		from: previous.identity,
		to: current.identity,
		fingerprint: checksumPhysicalPathMigration(migration, previous.identity, current.identity),
		buffers: migration,
	};
	return {
		kind: "delta",
		previous,
		current,
		migration: ownedMigration,
	};
}

/** Advance static-world sequence while reusing byte-identical rail geometry. */
export function createRailPhysicalStaticPublication(
	previous: WorkerOwnedRailLayout,
	currentSequence: number,
): Extract<RailPhysicalPublication, { kind: "static" }> {
	if (currentSequence !== previous.identity.sequence + 1) {
		throw new Error(
			`Static physical publication sequence gap: expected ${previous.identity.sequence + 1}, received ${currentSequence}.`,
		);
	}
	if (
		previous.identity.revision !== previous.buffers.revision ||
		previous.identity.fingerprint !== checksumRailPhysicalLayout(previous.buffers)
	) {
		throw new Error(
			"Static physical publication source no longer matches its worker-owned buffers.",
		);
	}
	return {
		kind: "static",
		previous,
		current: {
			identity: Object.freeze({ ...previous.identity, sequence: currentSequence }),
			buffers: previous.buffers,
		},
		migration: null,
	};
}

/** Compact acknowledgement for an atomic worker-owned physical publication. */
export function describeRailPhysicalPublication(
	publication: RailPhysicalPublication,
): RailPhysicalLayoutState {
	const layout = publication.current.buffers;
	const current = publication.current.identity;
	const previous = publication.previous?.identity ?? null;
	const migration = publication.migration;
	const migrationCounts = countMigrationKinds(migration?.buffers ?? null);
	return {
		physicalPublicationKind: publication.kind,
		physicalSequence: current.sequence,
		physicalRevision: current.revision,
		physicalFingerprint: current.fingerprint,
		physicalPathCount: layout.paths.pathCount,
		physicalPointCount: layout.paths.pointCount,
		physicalCompoundProfileCount: layout.compoundProfiles.count,
		physicalClearanceEnvelopeCount: layout.clearance.envelopes.count,
		physicalClearanceIssueCount: layout.clearance.issues.count,
		physicalIntervalRemapCount: layout.pathIntervalRemap.count,
		physicalJunctionCount: layout.junctions.length,
		physicalAdvancedSwitchCount: layout.advancedSwitches.count,
		physicalValid: layout.valid,
		physicalDiagnosticCount: layout.diagnostics.length,
		previousPhysicalAvailable: previous !== null,
		previousPhysicalSequence: previous?.sequence ?? 0,
		previousPhysicalRevision: previous?.revision ?? 0,
		previousPhysicalFingerprint: previous?.fingerprint ?? "00000000:00000000",
		migrationAvailable: migration !== null,
		migrationFromSequence: migration?.from.sequence ?? current.sequence,
		migrationFromRevision: migration?.from.revision ?? current.revision,
		migrationFromFingerprint: migration?.from.fingerprint ?? current.fingerprint,
		migrationToSequence: migration?.to.sequence ?? current.sequence,
		migrationToRevision: migration?.to.revision ?? current.revision,
		migrationToFingerprint: migration?.to.fingerprint ?? current.fingerprint,
		migrationFingerprint: migration?.fingerprint ?? "00000000:00000000",
		migrationSourcePathCount: migration?.buffers.sourcePathCount ?? 0,
		migrationTargetPathCount: migration?.buffers.targetPathCount ?? 0,
		migrationRowCount: migration?.buffers.count ?? 0,
		migrationMatchedRawPathCount: migration?.buffers.matchedRawPathCount ?? 0,
		migrationUnmappableSourcePathCount: migration?.buffers.unmappableSourcePathCount ?? 0,
		migrationIdentityRowCount: migrationCounts.identity,
		migrationTranslationRowCount: migrationCounts.translation,
		migrationProjectionRowCount: migrationCounts.projection,
		migrationDeletedRowCount: migrationCounts.deleted,
		migrationUnmappableRowCount: migrationCounts.unmappable,
		migrationMaxEndpointErrorMeters: migrationCounts.maxEndpointError,
		migrationMappedLengthMeters: migration?.buffers.mappedLengthMeters ?? 0,
		migrationUnmappableLengthMeters: migration?.buffers.unmappableLengthMeters ?? 0,
	};
}

function ownRailPhysicalLayout(
	layout: CompiledPhysicalLayout,
	sequence: number,
): WorkerOwnedRailLayout {
	if (!Number.isSafeInteger(sequence) || sequence < 0) {
		throw new Error(`Physical layout sequence ${sequence} must be a non-negative integer.`);
	}
	validateRailPhysicalLayoutContract(layout);
	return {
		identity: {
			sequence,
			revision: layout.revision,
			fingerprint: checksumRailPhysicalLayout(layout),
		},
		buffers: layout,
	};
}

/** Reject malformed synthetic graph buffers before the worker takes ownership. */
export function validateRailPhysicalLayoutContract(layout: CompiledPhysicalLayout): void {
	for (const _step of validateRailPhysicalLayoutCoreSteps(layout, false)) void _step;
	validateRailClearanceContract(layout);
}

const COOPERATIVE_ADVANCED_SWITCH_VALIDATION = Symbol("cooperative-advanced-switch-validation");
const IGNORE_COOPERATIVE_VALIDATION_PHASE = (): void => undefined;

/**
 * Main-thread semantic verification of an adopted physical layout. The same core contract as the
 * synchronous Worker validator is consumed in bounded slices, while clearance derivation is
 * reconstructed incrementally instead of invoking the synchronous compiler.
 */
export async function validateRailPhysicalLayoutContractCooperatively(
	layout: CompiledPhysicalLayout,
	checkpoint: () => Promise<void>,
	setPhase: (phase: string) => void = IGNORE_COOPERATIVE_VALIDATION_PHASE,
): Promise<void> {
	setPhase("core");
	let operations = 0;
	for (const step of validateRailPhysicalLayoutCoreSteps(layout, true)) {
		if (step === COOPERATIVE_ADVANCED_SWITCH_VALIDATION) {
			setPhase("advanced-switch");
			await validateRailAdvancedSwitchContractCooperatively(layout, checkpoint);
			setPhase("core-remainder");
		}
		operations++;
		if ((operations & 15) === 0) await checkpoint();
	}
	await checkpoint();
	await validateRailClearanceContractCooperatively(layout, checkpoint, setPhase);
}

function* validateRailPhysicalLayoutCoreSteps(
	layout: CompiledPhysicalLayout,
	cooperativeAdvancedSwitches: boolean,
): Generator<unknown> {
	const paths = layout.paths;
	const pathSized: readonly [string, ArrayLike<number>][] = [
		["kinds", paths.kinds],
		["fromDirections", paths.fromDirections],
		["toDirections", paths.toDirections],
		["lengths", paths.lengths],
		["startInsets", paths.startInsets],
		["endInsets", paths.endInsets],
		["startExtensions", paths.startExtensions],
		["endExtensions", paths.endExtensions],
		["sourceKinds", paths.sourceKinds],
		["advancedSwitchIds", paths.advancedSwitchIds],
		["advancedSwitchProfileClasses", paths.advancedSwitchProfileClasses],
		["advancedSwitchSegmentRoles", paths.advancedSwitchSegmentRoles],
		["advancedSwitchSegmentPorts", paths.advancedSwitchSegmentPorts],
		["advancedSwitchSegmentOrdinals", paths.advancedSwitchSegmentOrdinals],
		["advancedSwitchCatalogProfiles", paths.advancedSwitchCatalogProfiles],
	];
	for (const [name, values] of pathSized) {
		if (values.length !== paths.pathCount) {
			throw new Error(`Physical path ${name} length must equal pathCount.`);
		}
		yield;
	}
	if (
		paths.cells.length !== paths.pathCount * 2 ||
		paths.exitCells.length !== paths.pathCount * 2 ||
		paths.bounds.length !== paths.pathCount * 4 ||
		paths.offsets.length !== paths.pathCount + 1 ||
		paths.coverageOffsets.length !== paths.pathCount + 1 ||
		paths.sharedSegmentOffsets.length !== paths.pathCount + 1 ||
		paths.explicitAdjacencyOffsets.length !== paths.pathCount + 1 ||
		paths.positions.length !== paths.pointCount * 2 ||
		paths.tangents.length !== paths.pointCount * 2 ||
		paths.distances.length !== paths.pointCount
	) {
		throw new Error("Physical path CSR or point buffers are malformed.");
	}
	yield* validateOffsetSteps(paths.offsets, paths.pathCount, paths.pointCount, "path point");
	yield* validateOffsetSteps(
		paths.coverageOffsets,
		paths.pathCount,
		paths.coverageCells.length / 2,
		"path coverage",
	);
	yield* validateOffsetSteps(
		paths.sharedSegmentOffsets,
		paths.pathCount,
		paths.sharedSegmentIds.length,
		"shared segment",
	);
	yield* validateOffsetSteps(
		paths.explicitAdjacencyOffsets,
		paths.pathCount,
		paths.explicitAdjacencyTargets.length,
		"explicit adjacency",
	);
	if (
		paths.sharedSegmentStarts.length !== paths.sharedSegmentIds.length ||
		paths.sharedSegmentEnds.length !== paths.sharedSegmentIds.length
	) {
		throw new Error("Shared physical segment buffers are malformed.");
	}
	yield* validatePathAggregateSteps(paths);

	const finalSynthetic = new Map<string, number>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		yield;
		for (
			let row = paths.explicitAdjacencyOffsets[pathIndex] as number;
			row < (paths.explicitAdjacencyOffsets[pathIndex + 1] as number);
			row++
		) {
			yield;
			if ((paths.explicitAdjacencyTargets[row] as number) >= paths.pathCount) {
				throw new Error(`Physical path ${pathIndex} has an invalid explicit successor.`);
			}
		}
		const sourceKind = paths.sourceKinds[pathIndex] as number;
		if (sourceKind === PHYSICAL_PATH_SOURCE_KIND.CARDINAL_CELL) {
			if (
				(paths.explicitAdjacencyOffsets[pathIndex] as number) !==
				(paths.explicitAdjacencyOffsets[pathIndex + 1] as number)
			) {
				throw new Error(`Cardinal physical path ${pathIndex} carries explicit adjacency.`);
			}
			if (
				(paths.advancedSwitchIds[pathIndex] as number) !== 0 ||
				(paths.advancedSwitchProfileClasses[pathIndex] as number) !==
					NO_ADVANCED_SWITCH_PROFILE_CLASS ||
				(paths.advancedSwitchSegmentRoles[pathIndex] as number) !==
					NO_ADVANCED_SWITCH_SEGMENT_ROLE ||
				(paths.advancedSwitchSegmentPorts[pathIndex] as number) !==
					NO_ADVANCED_SWITCH_SEGMENT_PORT ||
				(paths.advancedSwitchSegmentOrdinals[pathIndex] as number) !==
					NO_ADVANCED_SWITCH_SEGMENT_ORDINAL ||
				(paths.advancedSwitchCatalogProfiles[pathIndex] as number) !==
					NO_ADVANCED_SWITCH_CATALOG_PROFILE
			) {
				throw new Error(`Cardinal physical path ${pathIndex} carries synthetic identity.`);
			}
			continue;
		}
		if (
			sourceKind !== PHYSICAL_PATH_SOURCE_KIND.ADVANCED_SWITCH_SEGMENT ||
			(paths.kinds[pathIndex] as number) !== PATH_KIND.ADVANCED_SWITCH_SEGMENT
		) {
			throw new Error(`Physical path ${pathIndex} has an invalid source kind.`);
		}
		const key = syntheticPathIdentityKey(
			paths.advancedSwitchIds[pathIndex] as number,
			paths.advancedSwitchProfileClasses[pathIndex] as number,
			paths.advancedSwitchSegmentRoles[pathIndex] as number,
			paths.advancedSwitchSegmentPorts[pathIndex] as number,
			paths.advancedSwitchSegmentOrdinals[pathIndex] as number,
		);
		if (finalSynthetic.has(key)) throw new Error(`Duplicate final synthetic path identity ${key}.`);
		finalSynthetic.set(key, pathIndex);
	}

	const remap = layout.pathIntervalRemap;
	const remapSized: readonly [string, ArrayLike<number>][] = [
		["sourcePathKinds", remap.sourcePathKinds],
		["sourcePathFromDirections", remap.sourcePathFromDirections],
		["sourcePathToDirections", remap.sourcePathToDirections],
		["sourceIdentityKinds", remap.sourceIdentityKinds],
		["sourceAdvancedSwitchIds", remap.sourceAdvancedSwitchIds],
		["sourceAdvancedSwitchProfileClasses", remap.sourceAdvancedSwitchProfileClasses],
		["sourceAdvancedSwitchRoles", remap.sourceAdvancedSwitchRoles],
		["sourceAdvancedSwitchPorts", remap.sourceAdvancedSwitchPorts],
		["sourceAdvancedSwitchSegmentOrdinals", remap.sourceAdvancedSwitchSegmentOrdinals],
		["sourcePathCanonicalStarts", remap.sourcePathCanonicalStarts],
		["sourcePathLengths", remap.sourcePathLengths],
	];
	for (const [name, values] of remapSized) {
		if (values.length !== remap.sourcePathCount) {
			throw new Error(`Physical remap ${name} length must equal sourcePathCount.`);
		}
		yield;
	}
	if (
		remap.sourcePathCells.length !== remap.sourcePathCount * 2 ||
		remap.sourcePathOffsets.length !== remap.sourcePathCount + 1
	) {
		throw new Error("Physical remap source identity buffers are malformed.");
	}
	const remapRowSized: readonly [string, ArrayLike<number>][] = [
		["sourceStarts", remap.sourceStarts],
		["sourceEnds", remap.sourceEnds],
		["targetPathIndices", remap.targetPathIndices],
		["targetStarts", remap.targetStarts],
		["targetEnds", remap.targetEnds],
		["mappingKinds", remap.mappingKinds],
		["projectionErrors", remap.projectionErrors],
	];
	for (const [name, values] of remapRowSized) {
		if (values.length !== remap.count) {
			throw new Error(`Physical remap ${name} length must equal count.`);
		}
		yield;
	}
	yield* validateOffsetSteps(
		remap.sourcePathOffsets,
		remap.sourcePathCount,
		remap.count,
		"path remap",
	);
	const remapSynthetic = new Map<string, number>();
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		yield;
		const identityKind = remap.sourceIdentityKinds[sourcePathIndex] as number;
		if (identityKind === PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL) {
			if (
				(remap.sourceAdvancedSwitchIds[sourcePathIndex] as number) !== 0 ||
				(remap.sourceAdvancedSwitchProfileClasses[sourcePathIndex] as number) !==
					NO_ADVANCED_SWITCH_PROFILE_CLASS ||
				(remap.sourceAdvancedSwitchRoles[sourcePathIndex] as number) !==
					NO_ADVANCED_SWITCH_SEGMENT_ROLE ||
				(remap.sourceAdvancedSwitchPorts[sourcePathIndex] as number) !==
					NO_ADVANCED_SWITCH_SEGMENT_PORT ||
				(remap.sourceAdvancedSwitchSegmentOrdinals[sourcePathIndex] as number) !==
					NO_ADVANCED_SWITCH_SEGMENT_ORDINAL
			) {
				throw new Error(`Cardinal remap source ${sourcePathIndex} carries synthetic identity.`);
			}
			continue;
		}
		if (identityKind !== PATH_SOURCE_IDENTITY_KIND.ADVANCED_SWITCH_SEGMENT) {
			throw new Error(`Physical remap source ${sourcePathIndex} has an invalid identity kind.`);
		}
		const key = syntheticPathIdentityKey(
			remap.sourceAdvancedSwitchIds[sourcePathIndex] as number,
			remap.sourceAdvancedSwitchProfileClasses[sourcePathIndex] as number,
			remap.sourceAdvancedSwitchRoles[sourcePathIndex] as number,
			remap.sourceAdvancedSwitchPorts[sourcePathIndex] as number,
			remap.sourceAdvancedSwitchSegmentOrdinals[sourcePathIndex] as number,
		);
		if (remapSynthetic.has(key)) throw new Error(`Duplicate remap synthetic identity ${key}.`);
		remapSynthetic.set(key, sourcePathIndex);
		const rowStart = remap.sourcePathOffsets[sourcePathIndex] as number;
		const rowEnd = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
		const target = finalSynthetic.get(key);
		if (
			target === undefined ||
			rowEnd - rowStart !== 1 ||
			(remap.mappingKinds[rowStart] as number) !== PATH_INTERVAL_MAPPING_KIND.IDENTITY ||
			(remap.targetPathIndices[rowStart] as number) !== target ||
			Math.abs(remap.sourceStarts[rowStart] as number) > 1e-6 ||
			Math.abs(remap.targetStarts[rowStart] as number) > 1e-6 ||
			Math.abs(
				(remap.sourceEnds[rowStart] as number) -
					(remap.sourcePathLengths[sourcePathIndex] as number),
			) > 1e-6 ||
			Math.abs((remap.targetEnds[rowStart] as number) - (paths.lengths[target] as number)) > 1e-6
		) {
			throw new Error(`Synthetic remap identity ${key} is not a full identity mapping.`);
		}
	}
	if (remapSynthetic.size !== finalSynthetic.size) {
		throw new Error("Final and remap synthetic identity sets differ.");
	}
	const profileByPath = yield* validateCompoundProfileContractSteps(layout);
	yield* validateExpectedSyntheticGeometrySteps(
		layout,
		finalSynthetic,
		remapSynthetic,
		profileByPath,
	);
	for (let row = 0; row < remap.count; row++) {
		yield;
		const target = remap.targetPathIndices[row] as number;
		const kind = remap.mappingKinds[row] as number;
		const sourceStart = remap.sourceStarts[row] as number;
		const sourceEnd = remap.sourceEnds[row] as number;
		const targetStart = remap.targetStarts[row] as number;
		const targetEnd = remap.targetEnds[row] as number;
		const projectionError = remap.projectionErrors[row] as number;
		if (
			!Number.isFinite(sourceStart) ||
			!Number.isFinite(sourceEnd) ||
			!Number.isFinite(targetStart) ||
			!Number.isFinite(targetEnd) ||
			!Number.isFinite(projectionError) ||
			sourceStart < 0 ||
			sourceEnd < sourceStart ||
			targetStart < 0 ||
			targetEnd < targetStart ||
			projectionError < 0 ||
			kind < PATH_INTERVAL_MAPPING_KIND.IDENTITY ||
			kind > PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE
		) {
			throw new Error(`Physical remap row ${row} has invalid interval metadata.`);
		}
		if (target === NO_PATH_INTERVAL_TARGET && kind !== PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE) {
			throw new Error(`Physical remap row ${row} has inconsistent targetless ownership.`);
		}
		if (
			(target === NO_PATH_INTERVAL_TARGET && (targetStart !== 0 || targetEnd !== 0)) ||
			(target !== NO_PATH_INTERVAL_TARGET &&
				(target >= paths.pathCount || targetEnd > (paths.lengths[target] as number) + 1e-6))
		) {
			throw new Error(`Physical remap row ${row} has an invalid target interval.`);
		}
	}
	yield;
	if (cooperativeAdvancedSwitches) {
		yield COOPERATIVE_ADVANCED_SWITCH_VALIDATION;
	} else {
		const switchIssues = validateCompiledAdvancedSwitches(layout.advancedSwitches, paths, remap);
		if (switchIssues.length > 0) {
			throw new Error(
				`Compiled advanced-switch buffers are malformed: ${switchIssues[0]?.message}`,
			);
		}
		yield;
	}
	yield* validateTurnoutFootprintContractSteps(layout);
}

/**
 * Startup-only validation of the advanced-switch sidecar. Unlike the compiler-facing validator,
 * every input-sized traversal yields progress so a large adopted project cannot monopolize the
 * main thread before cancellation and generation checks run again.
 */
export async function validateRailAdvancedSwitchContractCooperatively(
	layout: CompiledPhysicalLayout,
	checkpoint: () => Promise<void>,
): Promise<void> {
	if (advancedSwitchValidationFitsOneBoundedSlice(layout)) {
		const issues = validateCompiledAdvancedSwitches(
			layout.advancedSwitches,
			layout.paths,
			layout.pathIntervalRemap,
		);
		if (issues.length > 0) {
			throwMalformedAdvancedSwitch(issues[0]?.message ?? "unknown advanced-switch corruption");
		}
		await checkpoint();
		return;
	}
	let operations = 0;
	for (const _step of validateRailAdvancedSwitchContractSteps(layout)) {
		void _step;
		operations++;
		if ((operations & 15) === 0) await checkpoint();
	}
	await checkpoint();
}

function advancedSwitchValidationFitsOneBoundedSlice(layout: CompiledPhysicalLayout): boolean {
	const switches = layout.advancedSwitches;
	if (switches.count === 0) return true;
	const paths = layout.paths;
	const remap = layout.pathIntervalRemap;
	const linearWork =
		switches.count +
		paths.pathCount +
		paths.pointCount +
		paths.explicitAdjacencyTargets.length +
		paths.coverageCells.length / 2 +
		remap.sourcePathCount +
		remap.count +
		switches.portRoles.length +
		switches.movementInputIndices.length +
		switches.movementPathIndices.length +
		switches.movementConflictIntervalIndices.length +
		switches.claimedCells.length / 2 +
		switches.reservedCells.length / 2 +
		switches.conflictPathIndices.length;
	return (
		linearWork <= 2_048 &&
		paths.pathCount * paths.pathCount <= 65_536 &&
		switches.count * remap.sourcePathCount <= 16_384
	);
}

interface CooperativeAdvancedSwitchAdjacency {
	readonly offsets: Uint32Array;
	readonly targets: readonly number[];
}

function* validateRailAdvancedSwitchContractSteps(layout: CompiledPhysicalLayout): Generator<void> {
	const compiled = layout.advancedSwitches;
	const paths = layout.paths;
	const fixedLengths: readonly [string, ArrayLike<number>, number][] = [
		["ids", compiled.ids, compiled.count],
		["profileClasses", compiled.profileClasses, compiled.count],
		["origins", compiled.origins, compiled.count * 2],
		["forwardDirections", compiled.forwardDirections, compiled.count],
		["lateralDirections", compiled.lateralDirections, compiled.count],
		["movementMasks", compiled.movementMasks, compiled.count],
		["mergeAnchors", compiled.mergeAnchors, compiled.count * 2],
		["branchAnchors", compiled.branchAnchors, compiled.count * 2],
		["sharedThroatCells", compiled.sharedThroatCells, compiled.count * 2],
		["sharedThroatLengthsMeters", compiled.sharedThroatLengthsMeters, compiled.count],
		["sharedSupportLengthsMeters", compiled.sharedSupportLengthsMeters, compiled.count],
		["mergeSharedLeadMeters", compiled.mergeSharedLeadMeters, compiled.count],
		["clearTrunkMeters", compiled.clearTrunkMeters, compiled.count],
		["branchSharedLeadMeters", compiled.branchSharedLeadMeters, compiled.count],
		["conflictZoneIds", compiled.conflictZoneIds, compiled.count],
		["conflictZoneLengthsMeters", compiled.conflictZoneLengthsMeters, compiled.count],
		["conflictBounds", compiled.conflictBounds, compiled.count * 4],
		["bounds", compiled.bounds, compiled.count * 4],
	];
	for (const [name, values, expected] of fixedLengths) {
		if (values.length !== expected) {
			throwMalformedAdvancedSwitch(`${name} length ${values.length} must equal ${expected}`);
		}
		yield;
	}
	if (!Number.isInteger(compiled.count) || compiled.count < 0) {
		throwMalformedAdvancedSwitch("count must be a non-negative integer");
	}

	yield* validateAdvancedSwitchCsrSteps(
		compiled.portOffsets,
		compiled.count,
		compiled.portRoles.length,
		"portOffsets",
	);
	yield* validateAdvancedSwitchCsrSteps(
		compiled.movementOffsets,
		compiled.count,
		compiled.movementInputIndices.length,
		"movementOffsets",
	);
	yield* validateAdvancedSwitchCsrSteps(
		compiled.claimedOffsets,
		compiled.count,
		compiled.claimedCells.length / 2,
		"claimedOffsets",
	);
	yield* validateAdvancedSwitchCsrSteps(
		compiled.reservedOffsets,
		compiled.count,
		compiled.reservedCells.length / 2,
		"reservedOffsets",
	);
	yield* validateAdvancedSwitchCsrSteps(
		compiled.conflictPathOffsets,
		compiled.count,
		compiled.conflictPathIndices.length,
		"conflictPathOffsets",
	);
	const movementCount = compiled.movementInputIndices.length;
	yield* validateAdvancedSwitchCsrSteps(
		compiled.movementPathOffsets,
		movementCount,
		compiled.movementPathIndices.length,
		"movementPathOffsets",
	);
	yield* validateAdvancedSwitchCsrSteps(
		compiled.movementConflictOffsets,
		movementCount,
		compiled.movementConflictIntervalIndices.length,
		"movementConflictOffsets",
	);

	for (const [name, length] of [
		["portLocalIndices", compiled.portLocalIndices.length],
		["portDirections", compiled.portDirections.length],
		["portPathIndices", compiled.portPathIndices.length],
		["portPathStations", compiled.portPathStations.length],
	] as const) {
		if (length !== compiled.portRoles.length) {
			throwMalformedAdvancedSwitch(`${name} must match port row count`);
		}
		yield;
	}
	if (compiled.portCells.length !== compiled.portRoles.length * 2) {
		throwMalformedAdvancedSwitch("portCells must contain one x/y pair per port");
	}
	yield;
	if (compiled.movementOutputIndices.length !== movementCount) {
		throwMalformedAdvancedSwitch("movement input/output row counts must match");
	}
	yield;
	for (const [name, length] of [
		["movementPathStarts", compiled.movementPathStarts.length],
		["movementPathEnds", compiled.movementPathEnds.length],
	] as const) {
		if (length !== compiled.movementPathIndices.length) {
			throwMalformedAdvancedSwitch(`${name} must match movement path interval rows`);
		}
		yield;
	}
	for (const [name, length] of [
		["conflictPathStarts", compiled.conflictPathStarts.length],
		["conflictPathEnds", compiled.conflictPathEnds.length],
		["conflictIntervalKinds", compiled.conflictIntervalKinds.length],
		["conflictRouteIndices", compiled.conflictRouteIndices.length],
	] as const) {
		if (length !== compiled.conflictPathIndices.length) {
			throwMalformedAdvancedSwitch(`${name} must match conflict interval rows`);
		}
		yield;
	}
	if (compiled.claimedCells.length % 2 !== 0 || compiled.reservedCells.length % 2 !== 0) {
		throwMalformedAdvancedSwitch("claimed/reserved cell arrays must contain x/y pairs");
	}
	yield;
	if (compiled.count === 0) return;

	const adjacency = yield* buildAdvancedSwitchAdjacencySteps(paths);
	const globallyClaimed = new Map<string, number>();
	for (let switchIndex = 0; switchIndex < compiled.count; switchIndex++) {
		yield;
		if (compiled.conflictZoneIds[switchIndex] !== compiled.ids[switchIndex]) {
			throwMalformedAdvancedSwitch("conflict zone identity must match switch id");
		}
		if (
			!advancedSwitchApproximately(
				compiled.sharedSupportLengthsMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.supportLengthMeters,
			) ||
			!advancedSwitchApproximately(
				compiled.conflictZoneLengthsMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.supportLengthMeters,
			)
		) {
			throwMalformedAdvancedSwitch("switch hardware zone must own 1.0 m");
		}
		if (
			!advancedSwitchApproximately(
				compiled.mergeSharedLeadMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
			) ||
			!advancedSwitchApproximately(
				compiled.clearTrunkMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
			) ||
			!advancedSwitchApproximately(
				compiled.branchSharedLeadMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
			) ||
			!advancedSwitchApproximately(
				compiled.sharedThroatLengthsMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
			)
		) {
			throwMalformedAdvancedSwitch(
				"switch throat metadata must retain the OpenFab 400 mm + 200 mm + 400 mm dimensions",
			);
		}

		yield* validateAdvancedSwitchPortsSteps(compiled, paths, switchIndex);
		yield* validateAdvancedSwitchMovementsSteps(compiled, paths, adjacency, switchIndex);
		yield* validateAdvancedSwitchConflictsSteps(compiled, paths, switchIndex);
		yield* validateAdvancedSwitchFootprintSteps(compiled, switchIndex, globallyClaimed);
	}

	yield* validateAdvancedSwitchSemanticSteps(layout, adjacency);
}

function* validateAdvancedSwitchCsrSteps(
	offsets: ArrayLike<number>,
	rowCount: number,
	terminal: number,
	name: string,
): Generator<void> {
	if (offsets.length !== rowCount + 1) {
		throwMalformedAdvancedSwitch(`${name} must contain ${rowCount + 1} offsets`);
	}
	let previous = -1;
	for (let index = 0; index < offsets.length; index++) {
		yield;
		const value = offsets[index] as number;
		if (!Number.isInteger(value) || value < 0 || value < previous) {
			throwMalformedAdvancedSwitch(`${name} must be finite, integer, and monotonic`);
		}
		previous = value;
	}
	if ((offsets[0] as number) !== 0 || (offsets[offsets.length - 1] as number) !== terminal) {
		throwMalformedAdvancedSwitch(`${name} must start at zero and terminate at ${terminal}`);
	}
}

function* buildAdvancedSwitchAdjacencySteps(
	paths: CompiledPhysicalPaths,
): Generator<void, CooperativeAdvancedSwitchAdjacency> {
	const byEntry = new Map<string, number[]>();
	const exitCardinality = new Map<string, number>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		yield;
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		const from = paths.fromDirections[pathIndex] as number;
		const cellOffset = pathIndex * 2;
		if (from !== 0) {
			const key = physicalPathDirectedSeamKey(
				paths.cells[cellOffset] as number,
				paths.cells[cellOffset + 1] as number,
				from,
			);
			const entries = byEntry.get(key);
			assertCanonicalPhysicalPathSeamCardinality((entries?.length ?? 0) + 1);
			if (entries) entries.push(pathIndex);
			else byEntry.set(key, [pathIndex]);
		}
		const to = paths.toDirections[pathIndex] as number;
		if (to !== 0) {
			const next = moveCell(
				{
					x: paths.exitCells[cellOffset] as number,
					y: paths.exitCells[cellOffset + 1] as number,
				},
				to as Direction,
			);
			const key = physicalPathDirectedSeamKey(next.x, next.y, oppositeDirection(to as Direction));
			const cardinality = (exitCardinality.get(key) ?? 0) + 1;
			assertCanonicalPhysicalPathSeamCardinality(cardinality);
			exitCardinality.set(key, cardinality);
		}
	}

	const offsets = new Uint32Array(paths.pathCount + 1);
	const flatTargets: number[] = [];
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		yield;
		offsets[pathIndex] = flatTargets.length;
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		const targets = new Set<number>();
		const to = paths.toDirections[pathIndex] as number;
		if (to !== 0) {
			const cellOffset = pathIndex * 2;
			const next = moveCell(
				{
					x: paths.exitCells[cellOffset] as number,
					y: paths.exitCells[cellOffset + 1] as number,
				},
				to as Direction,
			);
			const candidates = byEntry.get(
				physicalPathDirectedSeamKey(next.x, next.y, oppositeDirection(to as Direction)),
			);
			for (const candidate of candidates ?? []) {
				targets.add(candidate);
				yield;
			}
		}
		const explicitStart = paths.explicitAdjacencyOffsets[pathIndex] as number;
		const explicitEnd = paths.explicitAdjacencyOffsets[pathIndex + 1] as number;
		for (let row = explicitStart; row < explicitEnd; row++) {
			yield;
			const target = paths.explicitAdjacencyTargets[row] as number;
			if (target < paths.pathCount && (paths.kinds[target] as number) !== PATH_KIND.INVALID) {
				targets.add(target);
			}
		}
		const ordered: number[] = [];
		for (const target of targets) {
			ordered.push(target);
			yield;
		}
		yield* sortAdvancedSwitchNumbersSteps(ordered);
		for (const target of ordered) {
			flatTargets.push(target);
			yield;
		}
	}
	offsets[paths.pathCount] = flatTargets.length;
	return { offsets, targets: flatTargets };
}

function* sortAdvancedSwitchNumbersSteps(values: number[]): Generator<void> {
	if (values.length < 2) return;
	let source = values;
	let target = new Array<number>(values.length);
	for (let width = 1; width < values.length; width *= 2) {
		for (let start = 0; start < values.length; start += width * 2) {
			const middle = Math.min(start + width, values.length);
			const end = Math.min(start + width * 2, values.length);
			let left = start;
			let right = middle;
			for (let index = start; index < end; index++) {
				target[index] =
					right >= end || (left < middle && (source[left] as number) <= (source[right] as number))
						? (source[left++] as number)
						: (source[right++] as number);
				yield;
			}
		}
		[source, target] = [target, source];
	}
	for (let index = 0; index < values.length; index++) {
		values[index] = source[index] as number;
		yield;
	}
}

function* validateAdvancedSwitchPortsSteps(
	compiled: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	switchIndex: number,
): Generator<void> {
	const start = compiled.portOffsets[switchIndex] as number;
	const end = compiled.portOffsets[switchIndex + 1] as number;
	if (end - start !== 4) {
		throwMalformedAdvancedSwitch("each advanced switch must publish exactly four ports");
	}
	const expectedRoles = [
		ADVANCED_SWITCH_PORT_ROLE.INPUT,
		ADVANCED_SWITCH_PORT_ROLE.INPUT,
		ADVANCED_SWITCH_PORT_ROLE.OUTPUT,
		ADVANCED_SWITCH_PORT_ROLE.OUTPUT,
	];
	const expectedLocalIndices = [0, 1, 0, 1];
	for (let local = 0; local < 4; local++) {
		yield;
		const row = start + local;
		if (
			compiled.portRoles[row] !== expectedRoles[local] ||
			compiled.portLocalIndices[row] !== expectedLocalIndices[local]
		) {
			throwMalformedAdvancedSwitch(
				"port roles/local indices must use input0,input1,output0,output1 order",
			);
		}
		validateAdvancedSwitchPathStation(
			paths,
			compiled.portPathIndices[row] as number,
			compiled.portPathStations[row] as number,
			"port",
		);
	}
}

function* validateAdvancedSwitchMovementsSteps(
	compiled: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	adjacency: CooperativeAdvancedSwitchAdjacency,
	switchIndex: number,
): Generator<void> {
	const movementStart = compiled.movementOffsets[switchIndex] as number;
	const movementEnd = compiled.movementOffsets[switchIndex + 1] as number;
	const expected = new Set<string>();
	for (const inputIndex of [0, 1] as const) {
		for (const outputIndex of [0, 1] as const) {
			if (
				((compiled.movementMasks[switchIndex] as number) &
					(1 << (inputIndex * 2 + outputIndex))) !==
				0
			) {
				expected.add(`${inputIndex}:${outputIndex}`);
			}
		}
	}
	const actual = new Set<string>();
	for (let movementIndex = movementStart; movementIndex < movementEnd; movementIndex++) {
		yield;
		const inputIndex = compiled.movementInputIndices[movementIndex] as number;
		const outputIndex = compiled.movementOutputIndices[movementIndex] as number;
		const identity = `${inputIndex}:${outputIndex}`;
		if (!expected.has(identity) || actual.has(identity)) {
			throwMalformedAdvancedSwitch(`movement ${identity} is unauthorized or duplicated`);
		}
		actual.add(identity);
		const intervalStart = compiled.movementPathOffsets[movementIndex] as number;
		const intervalEnd = compiled.movementPathOffsets[movementIndex + 1] as number;
		if (intervalStart >= intervalEnd) {
			throwMalformedAdvancedSwitch(`movement ${identity} must contain a path interval sequence`);
		}
		for (let row = intervalStart; row < intervalEnd; row++) {
			yield;
			const pathIndex = compiled.movementPathIndices[row] as number;
			const start = compiled.movementPathStarts[row] as number;
			const end = compiled.movementPathEnds[row] as number;
			if (!validateAdvancedSwitchPathInterval(paths, pathIndex, start, end)) {
				throwMalformedAdvancedSwitch(`movement ${identity} has an invalid final-path interval`);
			}
			if (
				row + 1 < intervalEnd &&
				!(yield* advancedSwitchPathsAreAdjacentSteps(
					adjacency,
					pathIndex,
					compiled.movementPathIndices[row + 1] as number,
				))
			) {
				throwMalformedAdvancedSwitch(`movement ${identity} contains disconnected path rows`);
			}
		}
		const portStart = compiled.portOffsets[switchIndex] as number;
		const inputPort = portStart + inputIndex;
		const outputPort = portStart + 2 + outputIndex;
		const firstRow = intervalStart;
		const lastRow = intervalEnd - 1;
		if (
			compiled.movementPathIndices[firstRow] !== compiled.portPathIndices[inputPort] ||
			!advancedSwitchApproximately(
				compiled.movementPathStarts[firstRow] as number,
				compiled.portPathStations[inputPort] as number,
			)
		) {
			throwMalformedAdvancedSwitch(
				`movement ${identity} does not start at its exact input port station`,
			);
		}
		if (
			compiled.movementPathIndices[lastRow] !== compiled.portPathIndices[outputPort] ||
			!advancedSwitchApproximately(
				compiled.movementPathEnds[lastRow] as number,
				compiled.portPathStations[outputPort] as number,
			)
		) {
			throwMalformedAdvancedSwitch(
				`movement ${identity} does not end at its exact output port station`,
			);
		}
		yield* validateAdvancedSwitchMovementConflictSteps(
			compiled,
			switchIndex,
			movementIndex,
			inputIndex,
			outputIndex,
		);
	}
	if (actual.size !== expected.size || [...expected].some((identity) => !actual.has(identity))) {
		throwMalformedAdvancedSwitch("movement rows must exactly match the explicit movement mask");
	}
	if (expected.size !== 4) {
		throwMalformedAdvancedSwitch("K2,2 switches must authorize exactly four movements");
	}
}

function* validateAdvancedSwitchMovementConflictSteps(
	compiled: CompiledAdvancedSwitches,
	switchIndex: number,
	movementIndex: number,
	inputIndex: number,
	outputIndex: number,
): Generator<void> {
	const conflictStart = compiled.conflictPathOffsets[switchIndex] as number;
	const conflictEnd = compiled.conflictPathOffsets[switchIndex + 1] as number;
	const referenceStart = compiled.movementConflictOffsets[movementIndex] as number;
	const referenceEnd = compiled.movementConflictOffsets[movementIndex + 1] as number;
	const seen = new Set<number>();
	let mergeLength = 0;
	let centerLength = 0;
	let branchLength = 0;
	for (let row = referenceStart; row < referenceEnd; row++) {
		yield;
		const conflictIndex = compiled.movementConflictIntervalIndices[row] as number;
		if (
			!Number.isInteger(conflictIndex) ||
			conflictIndex < conflictStart ||
			conflictIndex >= conflictEnd ||
			seen.has(conflictIndex)
		) {
			throwMalformedAdvancedSwitch("movement conflict references must be unique and switch-local");
		}
		seen.add(conflictIndex);
		if (
			!(yield* advancedSwitchMovementContainsConflictSteps(compiled, movementIndex, conflictIndex))
		) {
			throwMalformedAdvancedSwitch(
				"movement path intervals must physically contain every referenced conflict interval",
			);
		}
		const length =
			(compiled.conflictPathEnds[conflictIndex] as number) -
			(compiled.conflictPathStarts[conflictIndex] as number);
		const kind = compiled.conflictIntervalKinds[conflictIndex] as number;
		const route = compiled.conflictRouteIndices[conflictIndex] as number;
		if (kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED) {
			if (route !== inputIndex) {
				throwMalformedAdvancedSwitch("movement references the wrong merge alternative");
			}
			mergeLength += length;
		} else if (kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT) {
			centerLength += length;
		} else if (kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED) {
			if (route !== outputIndex) {
				throwMalformedAdvancedSwitch("movement references the wrong branch alternative");
			}
			branchLength += length;
		} else {
			throwMalformedAdvancedSwitch("movement references an unknown conflict interval kind");
		}
	}
	if (
		!advancedSwitchApproximately(
			mergeLength,
			ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
		) ||
		!advancedSwitchApproximately(
			centerLength,
			ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
		) ||
		!advancedSwitchApproximately(
			branchLength,
			ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
		)
	) {
		throwMalformedAdvancedSwitch("movement must own 400 mm + 200 mm + 400 mm conflict intervals");
	}
}

function* advancedSwitchMovementContainsConflictSteps(
	compiled: CompiledAdvancedSwitches,
	movementIndex: number,
	conflictIndex: number,
): Generator<void, boolean> {
	const conflictPathIndex = compiled.conflictPathIndices[conflictIndex] as number;
	const conflictStart = compiled.conflictPathStarts[conflictIndex] as number;
	const conflictEnd = compiled.conflictPathEnds[conflictIndex] as number;
	const movementStart = compiled.movementPathOffsets[movementIndex] as number;
	const movementEnd = compiled.movementPathOffsets[movementIndex + 1] as number;
	for (let row = movementStart; row < movementEnd; row++) {
		yield;
		if (compiled.movementPathIndices[row] !== conflictPathIndex) continue;
		if (
			(compiled.movementPathStarts[row] as number) <= conflictStart + 1e-4 &&
			(compiled.movementPathEnds[row] as number) + 1e-4 >= conflictEnd
		) {
			return true;
		}
	}
	return false;
}

function* validateAdvancedSwitchConflictsSteps(
	compiled: CompiledAdvancedSwitches,
	paths: CompiledPhysicalPaths,
	switchIndex: number,
): Generator<void> {
	const start = compiled.conflictPathOffsets[switchIndex] as number;
	const end = compiled.conflictPathOffsets[switchIndex + 1] as number;
	const lengths = new Map<string, number>();
	for (let row = start; row < end; row++) {
		yield;
		const pathIndex = compiled.conflictPathIndices[row] as number;
		const intervalStart = compiled.conflictPathStarts[row] as number;
		const intervalEnd = compiled.conflictPathEnds[row] as number;
		if (!validateAdvancedSwitchPathInterval(paths, pathIndex, intervalStart, intervalEnd)) {
			throwMalformedAdvancedSwitch("conflict ownership contains an invalid final-path interval");
		}
		const kind = compiled.conflictIntervalKinds[row] as number;
		const route = compiled.conflictRouteIndices[row] as number;
		if (kind < 0 || kind > ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED) {
			throwMalformedAdvancedSwitch("conflict interval kind is invalid");
		}
		if (
			route > 1 ||
			(kind === ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT && route !== 0)
		) {
			throwMalformedAdvancedSwitch("conflict route alternative is invalid");
		}
		const key = `${kind}:${route}`;
		lengths.set(key, (lengths.get(key) ?? 0) + intervalEnd - intervalStart);
	}
	for (const route of [0, 1]) {
		yield;
		if (
			!advancedSwitchApproximately(
				lengths.get(`${ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED}:${route}`) ?? 0,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
			) ||
			!advancedSwitchApproximately(
				lengths.get(`${ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED}:${route}`) ?? 0,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
			)
		) {
			throwMalformedAdvancedSwitch(
				`conflict alternative ${route} must own both 400 mm shared leads`,
			);
		}
	}
	if (
		!advancedSwitchApproximately(
			lengths.get(`${ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT}:0`) ?? 0,
			ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
		)
	) {
		throwMalformedAdvancedSwitch("conflict zone must own the common 200 mm center throat");
	}
}

function* validateAdvancedSwitchFootprintSteps(
	compiled: CompiledAdvancedSwitches,
	switchIndex: number,
	globallyClaimed: Map<string, number>,
): Generator<void> {
	const claimedStart = compiled.claimedOffsets[switchIndex] as number;
	const claimedEnd = compiled.claimedOffsets[switchIndex + 1] as number;
	const reservedStart = compiled.reservedOffsets[switchIndex] as number;
	const reservedEnd = compiled.reservedOffsets[switchIndex + 1] as number;
	const claimed = new Set<string>();
	for (let row = claimedStart; row < claimedEnd; row++) {
		yield;
		const x = compiled.claimedCells[row * 2] as number;
		const y = compiled.claimedCells[row * 2 + 1] as number;
		if (!Number.isInteger(x) || !Number.isInteger(y)) {
			throwMalformedAdvancedSwitch("claimed cells must use integer coordinates");
		}
		const key = cellKey(x, y);
		if (claimed.has(key)) {
			throwMalformedAdvancedSwitch("claimed cells must be unique");
		}
		claimed.add(key);
		const previousOwner = globallyClaimed.get(key);
		if (previousOwner !== undefined && previousOwner !== switchIndex) {
			throwMalformedAdvancedSwitch("advanced switch claimed footprints may not overlap");
		}
		globallyClaimed.set(key, switchIndex);
	}
	const reserved = new Set<string>();
	for (let row = reservedStart; row < reservedEnd; row++) {
		yield;
		const x = compiled.reservedCells[row * 2] as number;
		const y = compiled.reservedCells[row * 2 + 1] as number;
		const key = cellKey(x, y);
		if (!Number.isInteger(x) || !Number.isInteger(y) || !claimed.has(key) || reserved.has(key)) {
			throwMalformedAdvancedSwitch(
				"reserved cells must be unique integer members of the claimed footprint",
			);
		}
		reserved.add(key);
	}
}

function* advancedSwitchPathsAreAdjacentSteps(
	adjacency: CooperativeAdvancedSwitchAdjacency,
	from: number,
	to: number,
): Generator<void, boolean> {
	if (from < 0 || from + 1 >= adjacency.offsets.length) return false;
	const start = adjacency.offsets[from] as number;
	const end = adjacency.offsets[from + 1] as number;
	for (let row = start; row < end; row++) {
		yield;
		if ((adjacency.targets[row] as number) === to) return true;
	}
	return false;
}

function validateAdvancedSwitchPathStation(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	station: number,
	label: string,
): void {
	if (
		!Number.isInteger(pathIndex) ||
		pathIndex < 0 ||
		pathIndex >= paths.pathCount ||
		!Number.isFinite(station) ||
		station < -1e-4 ||
		station > (paths.lengths[pathIndex] as number) + 1e-4
	) {
		throwMalformedAdvancedSwitch(`${label} path index/station is outside the physical layout`);
	}
}

function validateAdvancedSwitchPathInterval(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	start: number,
	end: number,
): boolean {
	return (
		Number.isInteger(pathIndex) &&
		pathIndex >= 0 &&
		pathIndex < paths.pathCount &&
		Number.isFinite(start) &&
		Number.isFinite(end) &&
		start >= -1e-4 &&
		end + 1e-4 >= start &&
		end <= (paths.lengths[pathIndex] as number) + 1e-4
	);
}

function advancedSwitchApproximately(left: number, right: number): boolean {
	return Number.isFinite(left) && Math.abs(left - right) <= 1e-4;
}

function throwMalformedAdvancedSwitch(message: string): never {
	throw new Error(`Compiled advanced-switch buffers are malformed: ${message}`);
}

interface AdvancedSwitchSemanticIndexes {
	readonly rawPathsByCell: ReadonlyMap<string, readonly number[]>;
	readonly finalPathsByCoverageCell: ReadonlyMap<string, readonly number[]>;
	readonly syntheticSourceByPort: ReadonlyMap<string, number>;
}

interface ExpectedAdvancedSwitchPort {
	readonly role: "input" | "output";
	readonly index: 0 | 1;
	readonly cell: { readonly x: number; readonly y: number };
	readonly direction: Direction;
	readonly pathIndex: number;
	readonly station: number;
}

interface ExpectedAdvancedSwitchInterval {
	readonly pathIndex: number;
	readonly start: number;
	readonly end: number;
	readonly kind: number;
	readonly route: number;
}

interface ExpectedAdvancedSwitchConflictRows {
	readonly merge: readonly [readonly number[], readonly number[]];
	readonly center: readonly number[];
	readonly branch: readonly [readonly number[], readonly number[]];
	readonly intervals: readonly ExpectedAdvancedSwitchInterval[];
}

function* validateAdvancedSwitchSemanticSteps(
	layout: CompiledPhysicalLayout,
	adjacency: CooperativeAdvancedSwitchAdjacency,
): Generator<void> {
	const compiled = layout.advancedSwitches;
	const paths = layout.paths;
	const remap = layout.pathIntervalRemap;
	const indexes = yield* buildAdvancedSwitchSemanticIndexesSteps(paths, remap);
	const ids = new Set<number>();
	let previousSwitchId = 0;
	let expectedPortCursor = 0;
	let expectedMovementCursor = 0;
	let expectedMovementPathCursor = 0;
	let expectedMovementConflictCursor = 0;
	let expectedClaimedCursor = 0;
	let expectedReservedCursor = 0;
	let expectedConflictCursor = 0;

	for (let switchIndex = 0; switchIndex < compiled.count; switchIndex++) {
		yield;
		const profileClass =
			ADVANCED_SWITCH_PROFILE_CLASSES[compiled.profileClasses[switchIndex] as number];
		const record: AdvancedSwitchRecord | null = profileClass
			? {
					id: compiled.ids[switchIndex] as number,
					profileClass,
					origin: {
						x: compiled.origins[switchIndex * 2] as number,
						y: compiled.origins[switchIndex * 2 + 1] as number,
					},
					forward: compiled.forwardDirections[switchIndex] as AdvancedSwitchRecord["forward"],
					lateral: compiled.lateralDirections[switchIndex] as AdvancedSwitchRecord["lateral"],
					movementMask: compiled.movementMasks[switchIndex] as number,
				}
			: null;
		const recordError = record ? advancedSwitchRecordError(record) : "unknown profile class code";
		if (!record || recordError || ids.has(record.id)) {
			throwMalformedAdvancedSwitch(
				recordError ?? `advanced switch id ${record?.id ?? 0} is duplicated`,
			);
		}
		ids.add(record.id);
		if (record.id <= previousSwitchId) {
			throwAdvancedSwitchSemanticField("ids", "INVALID_IDENTITY");
		}
		previousSwitchId = record.id;
		const geometry = deriveAdvancedSwitchGeometry(record);
		if (
			(compiled.mergeAnchors[switchIndex * 2] as number) !== geometry.mergeAnchor.x ||
			(compiled.mergeAnchors[switchIndex * 2 + 1] as number) !== geometry.mergeAnchor.y
		) {
			throwAdvancedSwitchSemanticField("mergeAnchors", "INVALID_IDENTITY");
		}
		if (
			(compiled.branchAnchors[switchIndex * 2] as number) !== geometry.branchAnchor.x ||
			(compiled.branchAnchors[switchIndex * 2 + 1] as number) !== geometry.branchAnchor.y
		) {
			throwAdvancedSwitchSemanticField("branchAnchors", "INVALID_IDENTITY");
		}
		if (
			(compiled.sharedThroatCells[switchIndex * 2] as number) !== geometry.sharedTrunkSupport.x ||
			(compiled.sharedThroatCells[switchIndex * 2 + 1] as number) !== geometry.sharedTrunkSupport.y
		) {
			throwAdvancedSwitchSemanticField("sharedThroatCells", "INVALID_IDENTITY");
		}

		if ((compiled.portOffsets[switchIndex] as number) !== expectedPortCursor) {
			throwAdvancedSwitchSemanticField("portOffsets", "INVALID_PORT");
		}
		const resolvedPorts: ExpectedAdvancedSwitchPort[] = [];
		for (const port of geometry.ports) {
			const resolved = yield* resolveExpectedAdvancedSwitchPortSteps(
				record.id,
				port.role,
				port.index,
				paths,
				remap,
				indexes.syntheticSourceByPort,
			);
			const expected: ExpectedAdvancedSwitchPort = { ...port, ...resolved };
			resolvedPorts.push(expected);
			const row = expectedPortCursor++;
			const expectedRole =
				port.role === "input" ? ADVANCED_SWITCH_PORT_ROLE.INPUT : ADVANCED_SWITCH_PORT_ROLE.OUTPUT;
			if ((compiled.portRoles[row] as number) !== expectedRole) {
				throwAdvancedSwitchSemanticField("portRoles", "INVALID_PORT");
			}
			if ((compiled.portLocalIndices[row] as number) !== port.index) {
				throwAdvancedSwitchSemanticField("portLocalIndices", "INVALID_PORT");
			}
			if (
				(compiled.portCells[row * 2] as number) !== port.cell.x ||
				(compiled.portCells[row * 2 + 1] as number) !== port.cell.y
			) {
				throwAdvancedSwitchSemanticField("portCells", "INVALID_PORT");
			}
			if ((compiled.portDirections[row] as number) !== port.direction) {
				throwAdvancedSwitchSemanticField("portDirections", "INVALID_PORT");
			}
			if ((compiled.portPathIndices[row] as number) !== expected.pathIndex) {
				throwAdvancedSwitchSemanticField("portPathIndices", "INVALID_PORT");
			}
			if (
				!advancedSwitchSemanticNumberEqual(
					compiled.portPathStations[row] as number,
					expected.station,
				)
			) {
				throwAdvancedSwitchSemanticField("portPathStations", "INVALID_PORT");
			}
			yield;
		}
		if ((compiled.portOffsets[switchIndex + 1] as number) !== expectedPortCursor) {
			throwAdvancedSwitchSemanticField("portOffsets", "INVALID_PORT");
		}

		if ((compiled.claimedOffsets[switchIndex] as number) !== expectedClaimedCursor) {
			throwAdvancedSwitchSemanticField("claimedOffsets", "INVALID_FOOTPRINT");
		}
		for (const cell of geometry.claimedCells) {
			if (
				(compiled.claimedCells[expectedClaimedCursor * 2] as number) !== cell.x ||
				(compiled.claimedCells[expectedClaimedCursor * 2 + 1] as number) !== cell.y
			) {
				throwAdvancedSwitchSemanticField("claimedCells", "INVALID_FOOTPRINT");
			}
			expectedClaimedCursor++;
			yield;
		}
		if ((compiled.claimedOffsets[switchIndex + 1] as number) !== expectedClaimedCursor) {
			throwAdvancedSwitchSemanticField("claimedOffsets", "INVALID_FOOTPRINT");
		}

		if ((compiled.reservedOffsets[switchIndex] as number) !== expectedReservedCursor) {
			throwAdvancedSwitchSemanticField("reservedOffsets", "INVALID_FOOTPRINT");
		}
		for (const cell of geometry.reservedCells) {
			if (
				(compiled.reservedCells[expectedReservedCursor * 2] as number) !== cell.x ||
				(compiled.reservedCells[expectedReservedCursor * 2 + 1] as number) !== cell.y
			) {
				throwAdvancedSwitchSemanticField("reservedCells", "INVALID_FOOTPRINT");
			}
			expectedReservedCursor++;
			yield;
		}
		if ((compiled.reservedOffsets[switchIndex + 1] as number) !== expectedReservedCursor) {
			throwAdvancedSwitchSemanticField("reservedOffsets", "INVALID_FOOTPRINT");
		}

		if ((compiled.conflictPathOffsets[switchIndex] as number) !== expectedConflictCursor) {
			throwAdvancedSwitchSemanticField("conflictPathOffsets", "INVALID_CONFLICT_OWNERSHIP");
		}
		const switchConflictStart = expectedConflictCursor;
		const expectedConflicts = yield* deriveExpectedAdvancedSwitchConflictsSteps(
			record.id,
			paths,
			remap,
			indexes.syntheticSourceByPort,
			expectedConflictCursor,
		);
		for (const interval of expectedConflicts.intervals) {
			const row = expectedConflictCursor++;
			if ((compiled.conflictPathIndices[row] as number) !== interval.pathIndex) {
				throwAdvancedSwitchSemanticField("conflictPathIndices", "INVALID_CONFLICT_OWNERSHIP");
			}
			if (
				!advancedSwitchSemanticNumberEqual(
					compiled.conflictPathStarts[row] as number,
					interval.start,
				)
			) {
				throwAdvancedSwitchSemanticField("conflictPathStarts", "INVALID_CONFLICT_OWNERSHIP");
			}
			if (
				!advancedSwitchSemanticNumberEqual(compiled.conflictPathEnds[row] as number, interval.end)
			) {
				throwAdvancedSwitchSemanticField("conflictPathEnds", "INVALID_CONFLICT_OWNERSHIP");
			}
			if ((compiled.conflictIntervalKinds[row] as number) !== interval.kind) {
				throwAdvancedSwitchSemanticField("conflictIntervalKinds", "INVALID_CONFLICT_OWNERSHIP");
			}
			if ((compiled.conflictRouteIndices[row] as number) !== interval.route) {
				throwAdvancedSwitchSemanticField("conflictRouteIndices", "INVALID_CONFLICT_OWNERSHIP");
			}
			yield;
		}
		if ((compiled.conflictPathOffsets[switchIndex + 1] as number) !== expectedConflictCursor) {
			throwAdvancedSwitchSemanticField("conflictPathOffsets", "INVALID_CONFLICT_OWNERSHIP");
		}
		const expectedCenterLength = expectedConflicts.center.reduce((total, row) => {
			const interval = expectedConflicts.intervals[row - switchConflictStart];
			return total + (interval ? interval.end - interval.start : 0);
		}, 0);
		for (const [field, actual, expected] of [
			[
				"sharedThroatLengthsMeters",
				compiled.sharedThroatLengthsMeters[switchIndex] as number,
				expectedCenterLength,
			],
			[
				"sharedSupportLengthsMeters",
				compiled.sharedSupportLengthsMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.supportLengthMeters,
			],
			[
				"mergeSharedLeadMeters",
				compiled.mergeSharedLeadMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
			],
			[
				"clearTrunkMeters",
				compiled.clearTrunkMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
			],
			[
				"branchSharedLeadMeters",
				compiled.branchSharedLeadMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
			],
			[
				"conflictZoneLengthsMeters",
				compiled.conflictZoneLengthsMeters[switchIndex] as number,
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.supportLengthMeters,
			],
		] as const) {
			if (!advancedSwitchSemanticNumberEqual(actual, expected)) {
				throwAdvancedSwitchSemanticField(field, "INVALID_CONFLICT_OWNERSHIP");
			}
			yield;
		}
		if ((compiled.conflictZoneIds[switchIndex] as number) !== record.id) {
			throwAdvancedSwitchSemanticField("conflictZoneIds", "INVALID_CONFLICT_OWNERSHIP");
		}
		yield;

		const expectedConflictBounds = yield* deriveAdvancedSwitchIntervalBoundsSteps(
			paths,
			expectedConflicts.intervals,
			geometry.sharedTrunkSupport,
		);
		validateAdvancedSwitchBoundsField(
			compiled.conflictBounds,
			switchIndex,
			expectedConflictBounds,
			"conflictBounds",
		);

		const allowedPaths = yield* collectExpectedAdvancedSwitchAllowedPathsSteps(
			geometry.claimedCells,
			resolvedPorts,
			paths,
			remap,
			indexes,
		);
		if ((compiled.movementOffsets[switchIndex] as number) !== expectedMovementCursor) {
			throwAdvancedSwitchSemanticField("movementOffsets", "INVALID_MOVEMENT");
		}
		const expectedMovementIntervals: ExpectedAdvancedSwitchInterval[] = [];
		for (const inputIndex of [0, 1] as const) {
			for (const outputIndex of [0, 1] as const) {
				if (!advancedSwitchAllowsMovement(record, inputIndex, outputIndex)) continue;
				const movementIndex = expectedMovementCursor++;
				if ((compiled.movementInputIndices[movementIndex] as number) !== inputIndex) {
					throwAdvancedSwitchSemanticField("movementInputIndices", "INVALID_MOVEMENT");
				}
				if ((compiled.movementOutputIndices[movementIndex] as number) !== outputIndex) {
					throwAdvancedSwitchSemanticField("movementOutputIndices", "INVALID_MOVEMENT");
				}
				if (
					(compiled.movementPathOffsets[movementIndex] as number) !== expectedMovementPathCursor
				) {
					throwAdvancedSwitchSemanticField("movementPathOffsets", "INVALID_MOVEMENT");
				}
				const input = resolvedPorts[inputIndex] as ExpectedAdvancedSwitchPort;
				const output = resolvedPorts[2 + outputIndex] as ExpectedAdvancedSwitchPort;
				const sequence = yield* findExpectedAdvancedSwitchPathSequenceSteps(
					input.pathIndex,
					output.pathIndex,
					allowedPaths,
					adjacency,
				);
				if (!sequence) {
					throwMalformedAdvancedSwitch(
						"compiled switch records cannot reproduce a coherent layout: MISSING_ADVANCED_SWITCH_MOVEMENT",
					);
				}
				for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex++) {
					const pathIndex = sequence[sequenceIndex] as number;
					const pathLength = paths.lengths[pathIndex] as number;
					const start = sequenceIndex === 0 ? input.station : 0;
					const end = sequenceIndex === sequence.length - 1 ? output.station : pathLength;
					const interval: ExpectedAdvancedSwitchInterval = {
						pathIndex,
						start: Math.max(0, Math.min(pathLength, start)),
						end: Math.max(Math.max(0, Math.min(pathLength, start)), Math.min(pathLength, end)),
						kind: 0,
						route: 0,
					};
					const row = expectedMovementPathCursor++;
					if ((compiled.movementPathIndices[row] as number) !== interval.pathIndex) {
						throwAdvancedSwitchSemanticField("movementPathIndices", "INVALID_MOVEMENT");
					}
					if (
						!advancedSwitchSemanticNumberEqual(
							compiled.movementPathStarts[row] as number,
							interval.start,
						)
					) {
						throwAdvancedSwitchSemanticField("movementPathStarts", "INVALID_MOVEMENT");
					}
					if (
						!advancedSwitchSemanticNumberEqual(
							compiled.movementPathEnds[row] as number,
							interval.end,
						)
					) {
						throwAdvancedSwitchSemanticField("movementPathEnds", "INVALID_MOVEMENT");
					}
					expectedMovementIntervals.push(interval);
					yield;
				}
				if (
					(compiled.movementPathOffsets[movementIndex + 1] as number) !== expectedMovementPathCursor
				) {
					throwAdvancedSwitchSemanticField("movementPathOffsets", "INVALID_MOVEMENT");
				}

				if (
					(compiled.movementConflictOffsets[movementIndex] as number) !==
					expectedMovementConflictCursor
				) {
					throwAdvancedSwitchSemanticField("movementConflictOffsets", "INVALID_CONFLICT_OWNERSHIP");
				}
				for (const conflictIndex of [
					...expectedConflicts.merge[inputIndex],
					...expectedConflicts.center,
					...expectedConflicts.branch[outputIndex],
				]) {
					if (
						(compiled.movementConflictIntervalIndices[expectedMovementConflictCursor] as number) !==
						conflictIndex
					) {
						throwAdvancedSwitchSemanticField(
							"movementConflictIntervalIndices",
							"INVALID_CONFLICT_OWNERSHIP",
						);
					}
					expectedMovementConflictCursor++;
					yield;
				}
				if (
					(compiled.movementConflictOffsets[movementIndex + 1] as number) !==
					expectedMovementConflictCursor
				) {
					throwAdvancedSwitchSemanticField("movementConflictOffsets", "INVALID_CONFLICT_OWNERSHIP");
				}
			}
		}
		if ((compiled.movementOffsets[switchIndex + 1] as number) !== expectedMovementCursor) {
			throwAdvancedSwitchSemanticField("movementOffsets", "INVALID_MOVEMENT");
		}
		const expectedMovementBounds = yield* deriveAdvancedSwitchIntervalBoundsSteps(
			paths,
			expectedMovementIntervals,
			record.origin,
		);
		validateAdvancedSwitchBoundsField(
			compiled.bounds,
			switchIndex,
			expectedMovementBounds,
			"bounds",
		);
	}
}

function* buildAdvancedSwitchSemanticIndexesSteps(
	paths: CompiledPhysicalPaths,
	remap: CompiledPhysicalLayout["pathIntervalRemap"],
): Generator<void, AdvancedSwitchSemanticIndexes> {
	const rawPathsByCell = new Map<string, number[]>();
	const syntheticSourceByPort = new Map<string, number>();
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		yield;
		const cellOffset = sourcePathIndex * 2;
		const key = cellKey(
			remap.sourcePathCells[cellOffset] as number,
			remap.sourcePathCells[cellOffset + 1] as number,
		);
		const pathsAtCell = rawPathsByCell.get(key);
		if (pathsAtCell) pathsAtCell.push(sourcePathIndex);
		else rawPathsByCell.set(key, [sourcePathIndex]);
		if ((remap.sourceAdvancedSwitchSegmentOrdinals[sourcePathIndex] as number) !== 0) continue;
		const syntheticKey = advancedSwitchSyntheticSourcePortKey(
			remap.sourceAdvancedSwitchIds[sourcePathIndex] as number,
			remap.sourceAdvancedSwitchRoles[sourcePathIndex] as number,
			remap.sourceAdvancedSwitchPorts[sourcePathIndex] as number,
		);
		const previous = syntheticSourceByPort.get(syntheticKey);
		syntheticSourceByPort.set(syntheticKey, previous === undefined ? sourcePathIndex : -1);
	}

	const finalPathsByCoverageCell = new Map<string, number[]>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		yield;
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		const start = paths.coverageOffsets[pathIndex] as number;
		const end = paths.coverageOffsets[pathIndex + 1] as number;
		for (let coverageIndex = start; coverageIndex < end; coverageIndex++) {
			yield;
			const offset = coverageIndex * 2;
			const key = cellKey(
				paths.coverageCells[offset] as number,
				paths.coverageCells[offset + 1] as number,
			);
			const pathIndices = finalPathsByCoverageCell.get(key);
			if (pathIndices) pathIndices.push(pathIndex);
			else finalPathsByCoverageCell.set(key, [pathIndex]);
		}
	}
	return { rawPathsByCell, finalPathsByCoverageCell, syntheticSourceByPort };
}

function* resolveExpectedAdvancedSwitchPortSteps(
	switchId: number,
	role: "input" | "output",
	portIndex: 0 | 1,
	paths: CompiledPhysicalPaths,
	remap: CompiledPhysicalLayout["pathIntervalRemap"],
	syntheticSourceByPort: ReadonlyMap<string, number>,
): Generator<void, { pathIndex: number; station: number }> {
	const segmentRole =
		role === "input" ? ADVANCED_SWITCH_SEGMENT_ROLE.INPUT : ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT;
	const sourcePathIndex =
		syntheticSourceByPort.get(
			advancedSwitchSyntheticSourcePortKey(switchId, segmentRole, portIndex),
		) ?? -1;
	if (sourcePathIndex < 0) return { pathIndex: NO_ADVANCED_SWITCH_PATH, station: Number.NaN };
	const sourceStation = role === "input" ? 0 : (remap.sourcePathLengths[sourcePathIndex] as number);
	const mapped = yield* mapExpectedAdvancedSwitchStationSteps(
		remap,
		sourcePathIndex,
		sourceStation,
		role === "output",
	);
	if (
		!mapped ||
		mapped.pathIndex >= paths.pathCount ||
		(paths.kinds[mapped.pathIndex] as number) === PATH_KIND.INVALID
	) {
		return { pathIndex: NO_ADVANCED_SWITCH_PATH, station: Number.NaN };
	}
	return mapped;
}

function* mapExpectedAdvancedSwitchStationSteps(
	remap: CompiledPhysicalLayout["pathIntervalRemap"],
	sourcePathIndex: number,
	sourceStation: number,
	preferEnd: boolean,
): Generator<void, { pathIndex: number; station: number } | null> {
	const rowStart = remap.sourcePathOffsets[sourcePathIndex] as number;
	const rowEnd = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
	for (let ordinal = 0; ordinal < rowEnd - rowStart; ordinal++) {
		yield;
		const row = preferEnd ? rowEnd - 1 - ordinal : rowStart + ordinal;
		if ((remap.mappingKinds[row] as number) === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE) continue;
		const sourceStart = remap.sourceStarts[row] as number;
		const sourceEnd = remap.sourceEnds[row] as number;
		if (sourceStation < sourceStart - 1e-4 || sourceStation > sourceEnd + 1e-4) continue;
		const amount =
			sourceEnd - sourceStart <= 1e-4
				? 0
				: Math.max(0, Math.min(1, (sourceStation - sourceStart) / (sourceEnd - sourceStart)));
		const targetStart = remap.targetStarts[row] as number;
		const targetEnd = remap.targetEnds[row] as number;
		return {
			pathIndex: remap.targetPathIndices[row] as number,
			station: targetStart + (targetEnd - targetStart) * amount,
		};
	}
	return null;
}

function* deriveExpectedAdvancedSwitchConflictsSteps(
	switchId: number,
	paths: CompiledPhysicalPaths,
	remap: CompiledPhysicalLayout["pathIntervalRemap"],
	syntheticSourceByPort: ReadonlyMap<string, number>,
	globalStart: number,
): Generator<void, ExpectedAdvancedSwitchConflictRows> {
	const intervals: ExpectedAdvancedSwitchInterval[] = [];
	const append = function* (
		role: number,
		port: number,
		edge: "start" | "end" | "all",
		lengthMeters: number,
		kind: number,
		route: number,
	): Generator<void, number[]> {
		const indices: number[] = [];
		const sourcePathIndex =
			syntheticSourceByPort.get(advancedSwitchSyntheticSourcePortKey(switchId, role, port)) ?? -1;
		if (sourcePathIndex < 0 || sourcePathIndex >= remap.sourcePathCount) return indices;
		const sourceLength = remap.sourcePathLengths[sourcePathIndex] as number;
		const sourceStart = edge === "end" ? Math.max(0, sourceLength - lengthMeters) : 0;
		const sourceEnd = edge === "start" ? Math.min(sourceLength, lengthMeters) : sourceLength;
		const rowStart = remap.sourcePathOffsets[sourcePathIndex] as number;
		const rowEnd = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
		for (let row = rowStart; row < rowEnd; row++) {
			yield;
			if ((remap.mappingKinds[row] as number) === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE) continue;
			const rowSourceStart = remap.sourceStarts[row] as number;
			const rowSourceEnd = remap.sourceEnds[row] as number;
			const overlapStart = Math.max(sourceStart, rowSourceStart);
			const overlapEnd = Math.min(sourceEnd, rowSourceEnd);
			if (overlapEnd - overlapStart <= 1e-4) continue;
			const rowLength = rowSourceEnd - rowSourceStart;
			if (rowLength <= 1e-4) continue;
			const targetStart = remap.targetStarts[row] as number;
			const targetEnd = remap.targetEnds[row] as number;
			const mappedStart =
				targetStart + (targetEnd - targetStart) * ((overlapStart - rowSourceStart) / rowLength);
			const mappedEnd =
				targetStart + (targetEnd - targetStart) * ((overlapEnd - rowSourceStart) / rowLength);
			const pathIndex = remap.targetPathIndices[row] as number;
			if (
				mappedEnd - mappedStart <= 1e-4 ||
				pathIndex >= paths.pathCount ||
				(paths.kinds[pathIndex] as number) === PATH_KIND.INVALID
			) {
				continue;
			}
			indices.push(globalStart + intervals.length);
			intervals.push({ pathIndex, start: mappedStart, end: mappedEnd, kind, route });
		}
		return indices;
	};
	const merge0 = yield* append(
		ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
		0,
		"end",
		ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
		ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED,
		0,
	);
	const merge1 = yield* append(
		ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
		1,
		"end",
		ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
		ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.MERGE_SHARED,
		1,
	);
	const center = yield* append(
		ADVANCED_SWITCH_SEGMENT_ROLE.THROAT,
		ADVANCED_SWITCH_NO_PORT,
		"all",
		ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
		ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.CENTER_THROAT,
		0,
	);
	const branch0 = yield* append(
		ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT,
		0,
		"start",
		ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
		ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED,
		0,
	);
	const branch1 = yield* append(
		ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT,
		1,
		"start",
		ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
		ADVANCED_SWITCH_CONFLICT_INTERVAL_KIND.BRANCH_SHARED,
		1,
	);
	return {
		merge: [merge0, merge1],
		center,
		branch: [branch0, branch1],
		intervals,
	};
}

function* collectExpectedAdvancedSwitchAllowedPathsSteps(
	claimedCells: readonly { readonly x: number; readonly y: number }[],
	ports: readonly ExpectedAdvancedSwitchPort[],
	paths: CompiledPhysicalPaths,
	remap: CompiledPhysicalLayout["pathIntervalRemap"],
	indexes: AdvancedSwitchSemanticIndexes,
): Generator<void, ReadonlySet<number>> {
	const result = new Set<number>();
	for (const cell of claimedCells) {
		yield;
		const key = cellKey(cell.x, cell.y);
		for (const sourcePathIndex of indexes.rawPathsByCell.get(key) ?? []) {
			const rowStart = remap.sourcePathOffsets[sourcePathIndex] as number;
			const rowEnd = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
			for (let row = rowStart; row < rowEnd; row++) {
				yield;
				if ((remap.mappingKinds[row] as number) === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE) {
					continue;
				}
				const target = remap.targetPathIndices[row] as number;
				if (target < paths.pathCount && (paths.kinds[target] as number) !== PATH_KIND.INVALID) {
					result.add(target);
				}
			}
		}
		for (const pathIndex of indexes.finalPathsByCoverageCell.get(key) ?? []) {
			result.add(pathIndex);
			yield;
		}
	}
	for (const port of ports) {
		if (port.pathIndex !== NO_ADVANCED_SWITCH_PATH) result.add(port.pathIndex);
		yield;
	}
	return result;
}

function* findExpectedAdvancedSwitchPathSequenceSteps(
	startPath: number,
	endPath: number,
	allowedPaths: ReadonlySet<number>,
	adjacency: CooperativeAdvancedSwitchAdjacency,
): Generator<void, number[] | null> {
	if (!allowedPaths.has(startPath) || !allowedPaths.has(endPath)) return null;
	const parents = new Map<number, number>([[startPath, -1]]);
	const queue = [startPath];
	for (let cursor = 0; cursor < queue.length; cursor++) {
		yield;
		const pathIndex = queue[cursor] as number;
		if (pathIndex === endPath) break;
		const start = adjacency.offsets[pathIndex] as number;
		const end = adjacency.offsets[pathIndex + 1] as number;
		for (let index = start; index < end; index++) {
			yield;
			const target = adjacency.targets[index] as number;
			if (!allowedPaths.has(target) || parents.has(target)) continue;
			parents.set(target, pathIndex);
			queue.push(target);
		}
	}
	if (!parents.has(endPath)) return null;
	const reversed: number[] = [];
	for (let current = endPath; current >= 0; current = parents.get(current) as number) {
		reversed.push(current);
		yield;
	}
	const result = new Array<number>(reversed.length);
	for (let index = 0; index < reversed.length; index++) {
		result[index] = reversed[reversed.length - 1 - index] as number;
		yield;
	}
	return result;
}

function* deriveAdvancedSwitchIntervalBoundsSteps(
	paths: CompiledPhysicalPaths,
	intervals: readonly ExpectedAdvancedSwitchInterval[],
	fallbackCell: { readonly x: number; readonly y: number },
): Generator<void, readonly [number, number, number, number]> {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const include = (x: number, y: number): void => {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	};
	for (const interval of intervals) {
		yield;
		const startSample = samplePhysicalPath(paths, interval.pathIndex, interval.start);
		const endSample = samplePhysicalPath(paths, interval.pathIndex, interval.end);
		if (startSample) include(startSample.x, startSample.y);
		const pointStart = paths.offsets[interval.pathIndex] as number;
		const pointEnd = paths.offsets[interval.pathIndex + 1] as number;
		for (let pointIndex = pointStart; pointIndex < pointEnd; pointIndex++) {
			yield;
			const station = paths.distances[pointIndex] as number;
			if (station <= interval.start || station >= interval.end) continue;
			include(
				paths.positions[pointIndex * 2] as number,
				paths.positions[pointIndex * 2 + 1] as number,
			);
		}
		if (endSample) include(endSample.x, endSample.y);
	}
	if (intervals.length === 0 || !Number.isFinite(minX)) {
		minX = fallbackCell.x + 0.5;
		minY = fallbackCell.y + 0.5;
		maxX = minX;
		maxY = minY;
	}
	return [minX, minY, maxX, maxY];
}

function validateAdvancedSwitchBoundsField(
	actual: Float32Array,
	switchIndex: number,
	expected: readonly [number, number, number, number],
	field: "conflictBounds" | "bounds",
): void {
	for (let axis = 0; axis < 4; axis++) {
		if (
			!advancedSwitchSemanticNumberEqual(
				actual[switchIndex * 4 + axis] as number,
				expected[axis] as number,
			)
		) {
			throwAdvancedSwitchSemanticField(field, "INVALID_BOUNDS");
		}
	}
}

function advancedSwitchSyntheticSourcePortKey(
	switchId: number,
	role: number,
	port: number,
): string {
	return `${switchId}:${role}:${port}`;
}

function advancedSwitchSemanticNumberEqual(actual: number, expected: number): boolean {
	const compiledExpected = Math.fround(expected);
	return Number.isFinite(actual) && Math.abs(actual - compiledExpected) <= 1e-6;
}

function throwAdvancedSwitchSemanticField(field: string, _code: string): never {
	void _code;
	throwMalformedAdvancedSwitch(`${field} does not match the geometry derived from switch records`);
}

interface CooperativeTurnoutEndpointIndex {
	readonly pathByRequest: ReadonlyMap<string, number>;
}

interface CooperativeTurnoutClearanceInterval {
	readonly pathIndex: number;
	readonly start: number;
	readonly end: number;
}

function turnoutEndpointKey(x: number, y: number, direction: number): string {
	return `${cellKey(x, y)}:${direction}`;
}

function turnoutEndpointRequestKey(
	kind: "entry" | "outgoing",
	x: number,
	y: number,
	direction: number,
): string {
	return `${kind}:${turnoutEndpointKey(x, y, direction)}`;
}

/** Index only turnout-requested seams, retaining the first matching path in canonical path order. */
function* buildTurnoutEndpointIndexSteps(
	paths: CompiledPhysicalPaths,
	junctions: readonly CompiledJunction[],
): Generator<void, CooperativeTurnoutEndpointIndex> {
	const pathByRequest = new Map<string, number>();
	for (const junction of junctions) {
		yield;
		for (const [pathIndex, port] of [
			[junction.trunkPathIndex, "incoming"],
			[junction.trunkPathIndex, "outgoing"],
			[junction.divergePathIndex, junction.type === "BRANCH" ? "outgoing" : "incoming"],
		] as const) {
			const request = turnoutConnectedPathRequestKey(paths, pathIndex, port);
			if (request !== null && !pathByRequest.has(request)) pathByRequest.set(request, -1);
		}
	}
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		yield;
		if ((paths.kinds[pathIndex] as number) === PATH_KIND.INVALID) continue;
		const cellOffset = pathIndex * 2;
		const from = paths.fromDirections[pathIndex] as number;
		if (from !== 0) {
			const key = turnoutEndpointRequestKey(
				"entry",
				paths.cells[cellOffset] as number,
				paths.cells[cellOffset + 1] as number,
				from,
			);
			if (pathByRequest.get(key) === -1) pathByRequest.set(key, pathIndex);
		}

		const to = paths.toDirections[pathIndex] as number;
		if (to === 0) continue;
		const next = moveCell(
			{
				x: paths.exitCells[cellOffset] as number,
				y: paths.exitCells[cellOffset + 1] as number,
			},
			to as Direction,
		);
		const key = turnoutEndpointRequestKey(
			"outgoing",
			next.x,
			next.y,
			oppositeDirection(to as Direction),
		);
		if (pathByRequest.get(key) === -1) pathByRequest.set(key, pathIndex);
	}
	return { pathByRequest };
}

function deriveIndexedTurnoutClearancePathIntervals(
	junction: CompiledJunction,
	paths: CompiledPhysicalPaths,
	index: CooperativeTurnoutEndpointIndex,
): readonly CooperativeTurnoutClearanceInterval[] {
	const intervals: CooperativeTurnoutClearanceInterval[] = [];
	appendIndexedTurnoutFullPath(intervals, paths, junction.trunkPathIndex);
	appendIndexedTurnoutFullPath(intervals, paths, junction.divergePathIndex);
	appendIndexedTurnoutConnectedPort(intervals, paths, index, junction.trunkPathIndex, "incoming");
	appendIndexedTurnoutConnectedPort(intervals, paths, index, junction.trunkPathIndex, "outgoing");
	appendIndexedTurnoutConnectedPort(
		intervals,
		paths,
		index,
		junction.divergePathIndex,
		junction.type === "BRANCH" ? "outgoing" : "incoming",
	);
	intervals.sort(
		(left, right) =>
			left.pathIndex - right.pathIndex || left.start - right.start || left.end - right.end,
	);
	return intervals.filter(
		(interval, intervalIndex) =>
			intervalIndex === 0 ||
			interval.pathIndex !== intervals[intervalIndex - 1]?.pathIndex ||
			interval.start !== intervals[intervalIndex - 1]?.start ||
			interval.end !== intervals[intervalIndex - 1]?.end,
	);
}

function appendIndexedTurnoutFullPath(
	target: CooperativeTurnoutClearanceInterval[],
	paths: CompiledPhysicalPaths,
	pathIndex: number,
): void {
	if (pathIndex < 0 || pathIndex >= paths.pathCount) return;
	target.push({ pathIndex, start: 0, end: paths.lengths[pathIndex] as number });
}

function appendIndexedTurnoutConnectedPort(
	target: CooperativeTurnoutClearanceInterval[],
	paths: CompiledPhysicalPaths,
	index: CooperativeTurnoutEndpointIndex,
	corePathIndex: number,
	port: "incoming" | "outgoing",
): void {
	const pathIndex = findIndexedTurnoutConnectedPath(paths, index, corePathIndex, port);
	if (pathIndex < 0) return;
	const station = port === "outgoing" ? 0 : (paths.lengths[pathIndex] as number);
	target.push({ pathIndex, start: station, end: station });
}

function findIndexedTurnoutConnectedPath(
	paths: CompiledPhysicalPaths,
	index: CooperativeTurnoutEndpointIndex,
	corePathIndex: number,
	port: "incoming" | "outgoing",
): number {
	const request = turnoutConnectedPathRequestKey(paths, corePathIndex, port);
	return request === null ? -1 : (index.pathByRequest.get(request) ?? -1);
}

function turnoutConnectedPathRequestKey(
	paths: CompiledPhysicalPaths,
	corePathIndex: number,
	port: "incoming" | "outgoing",
): string | null {
	if (
		corePathIndex < 0 ||
		corePathIndex >= paths.pathCount ||
		(paths.kinds[corePathIndex] as number) === PATH_KIND.INVALID
	) {
		return null;
	}
	const cellOffset = corePathIndex * 2;
	if (port === "incoming") {
		const from = paths.fromDirections[corePathIndex] as number;
		return from === 0
			? null
			: turnoutEndpointRequestKey(
					"outgoing",
					paths.cells[cellOffset] as number,
					paths.cells[cellOffset + 1] as number,
					from,
				);
	}
	const to = paths.toDirections[corePathIndex] as number;
	if (to === 0) return null;
	const next = moveCell(
		{
			x: paths.exitCells[cellOffset] as number,
			y: paths.exitCells[cellOffset + 1] as number,
		},
		to as Direction,
	);
	return turnoutEndpointRequestKey("entry", next.x, next.y, oppositeDirection(to as Direction));
}

function* validateTurnoutFootprintContractSteps(layout: CompiledPhysicalLayout): Generator<void> {
	const turnouts = layout.turnoutFootprints;
	if (!Number.isSafeInteger(turnouts.count) || turnouts.count < 0) {
		throw new Error("Compiled turnout footprint count is invalid.");
	}
	const fixedRows: readonly [string, ArrayLike<number>, number][] = [
		["kinds", turnouts.kinds, turnouts.count],
		["anchors", turnouts.anchors, turnouts.count * 2],
		["leadInMillimeters", turnouts.leadInMillimeters, turnouts.count],
		["leadOutMillimeters", turnouts.leadOutMillimeters, turnouts.count],
		["radiusMillimeters", turnouts.radiusMillimeters, turnouts.count],
		["bounds", turnouts.bounds, turnouts.count * 4],
	];
	for (const [name, values, expected] of fixedRows) {
		if (values.length !== expected) {
			throw new Error(`Compiled turnout footprint ${name} length must equal ${expected}.`);
		}
		yield;
	}
	if (
		turnouts.reservedCells.length % 2 !== 0 ||
		turnouts.reservedOffsets.length !== turnouts.count + 1 ||
		turnouts.pathOffsets.length !== turnouts.count + 1 ||
		turnouts.clearancePathOffsets.length !== turnouts.count + 1 ||
		turnouts.clearancePathStarts.length !== turnouts.clearancePathIndices.length ||
		turnouts.clearancePathEnds.length !== turnouts.clearancePathIndices.length
	) {
		throw new Error("Compiled turnout footprint CSR buffers are malformed.");
	}
	yield* validateOffsetSteps(
		turnouts.reservedOffsets,
		turnouts.count,
		turnouts.reservedCells.length / 2,
		"turnout reserved cell",
	);
	yield* validateOffsetSteps(
		turnouts.pathOffsets,
		turnouts.count,
		turnouts.pathIndices.length,
		"turnout path",
	);
	yield* validateOffsetSteps(
		turnouts.clearancePathOffsets,
		turnouts.count,
		turnouts.clearancePathIndices.length,
		"turnout clearance path",
	);
	if (turnouts.count !== layout.junctions.length) {
		throw new Error("Compiled turnout footprint count differs from compiled junction ownership.");
	}
	const junctionByAnchor = new Map<string, (typeof layout.junctions)[number]>();
	for (const junction of layout.junctions) {
		junctionByAnchor.set(`${junction.cell.x}:${junction.cell.y}`, junction);
		yield;
	}
	if (junctionByAnchor.size !== layout.junctions.length) {
		throw new Error("Compiled junction anchors are not unique.");
	}
	let endpointIndex: CooperativeTurnoutEndpointIndex | null = null;
	for (let turnoutIndex = 0; turnoutIndex < turnouts.count; turnoutIndex++) {
		yield;
		const anchorX = turnouts.anchors[turnoutIndex * 2] as number;
		const anchorY = turnouts.anchors[turnoutIndex * 2 + 1] as number;
		const junction = junctionByAnchor.get(`${anchorX}:${anchorY}`);
		const expectedKind = junction?.type === "BRANCH" ? TURNOUT_KIND.BRANCH : TURNOUT_KIND.MERGE;
		if (
			!junction ||
			(turnouts.kinds[turnoutIndex] as number) !== expectedKind ||
			(turnouts.leadInMillimeters[turnoutIndex] as number) !== junction.leadInMillimeters ||
			(turnouts.leadOutMillimeters[turnoutIndex] as number) !== junction.leadOutMillimeters ||
			(turnouts.radiusMillimeters[turnoutIndex] as number) !== junction.radiusMillimeters
		) {
			throw new Error(`Compiled turnout footprint ${turnoutIndex} differs from its junction.`);
		}
		const reservedStart = turnouts.reservedOffsets[turnoutIndex] as number;
		const reservedEnd = turnouts.reservedOffsets[turnoutIndex + 1] as number;
		if (reservedEnd - reservedStart !== junction.footprintCells.length) {
			throw new Error(`Compiled turnout footprint ${turnoutIndex} has invalid reserved ownership.`);
		}
		for (let cellOffset = 0; cellOffset < junction.footprintCells.length; cellOffset++) {
			yield;
			const cell = junction.footprintCells[cellOffset];
			const row = reservedStart + cellOffset;
			if (
				!cell ||
				(turnouts.reservedCells[row * 2] as number) !== cell.x ||
				(turnouts.reservedCells[row * 2 + 1] as number) !== cell.y
			) {
				throw new Error(
					`Compiled turnout footprint ${turnoutIndex} has invalid reserved ownership.`,
				);
			}
		}
		const expectedPaths = [junction.trunkPathIndex, junction.divergePathIndex].filter(
			(pathIndex) => pathIndex >= 0 && pathIndex < layout.paths.pathCount,
		);
		const pathStart = turnouts.pathOffsets[turnoutIndex] as number;
		const pathEnd = turnouts.pathOffsets[turnoutIndex + 1] as number;
		if (
			pathEnd - pathStart !== expectedPaths.length ||
			expectedPaths.some(
				(pathIndex, offset) => (turnouts.pathIndices[pathStart + offset] as number) !== pathIndex,
			)
		) {
			throw new Error(
				`Compiled turnout footprint ${turnoutIndex} path ownership differs from its junction.`,
			);
		}
		if (!endpointIndex) {
			endpointIndex = yield* buildTurnoutEndpointIndexSteps(layout.paths, layout.junctions);
		}
		const expectedClearancePaths = deriveIndexedTurnoutClearancePathIntervals(
			junction,
			layout.paths,
			endpointIndex,
		);
		const clearancePathStart = turnouts.clearancePathOffsets[turnoutIndex] as number;
		const clearancePathEnd = turnouts.clearancePathOffsets[turnoutIndex + 1] as number;
		if (clearancePathEnd - clearancePathStart !== expectedClearancePaths.length) {
			throw new Error(
				`Compiled turnout footprint ${turnoutIndex} clearance ownership differs from its junction.`,
			);
		}
		for (let offset = 0; offset < expectedClearancePaths.length; offset++) {
			yield;
			const expected = expectedClearancePaths[offset];
			const row = clearancePathStart + offset;
			if (
				!expected ||
				(turnouts.clearancePathIndices[row] as number) !== expected.pathIndex ||
				!nearlyEqual(turnouts.clearancePathStarts[row] as number, expected.start) ||
				!nearlyEqual(turnouts.clearancePathEnds[row] as number, expected.end)
			) {
				throw new Error(
					`Compiled turnout footprint ${turnoutIndex} clearance ownership differs from its junction.`,
				);
			}
		}
		let minX = anchorX + 0.5;
		let minY = anchorY + 0.5;
		let maxX = minX;
		let maxY = minY;
		if (expectedPaths.length > 0) {
			minX = Number.POSITIVE_INFINITY;
			minY = Number.POSITIVE_INFINITY;
			maxX = Number.NEGATIVE_INFINITY;
			maxY = Number.NEGATIVE_INFINITY;
			for (const pathIndex of expectedPaths) {
				yield;
				minX = Math.min(minX, layout.paths.bounds[pathIndex * 4] as number);
				minY = Math.min(minY, layout.paths.bounds[pathIndex * 4 + 1] as number);
				maxX = Math.max(maxX, layout.paths.bounds[pathIndex * 4 + 2] as number);
				maxY = Math.max(maxY, layout.paths.bounds[pathIndex * 4 + 3] as number);
			}
		}
		for (const [axis, expected] of [minX, minY, maxX, maxY].entries()) {
			yield;
			if (!nearlyEqual(turnouts.bounds[turnoutIndex * 4 + axis] as number, expected)) {
				throw new Error(`Compiled turnout footprint ${turnoutIndex} bounds differ from its paths.`);
			}
		}
	}
}

function validateRailClearanceContract(layout: CompiledPhysicalLayout): void {
	const clearance = layout.clearance;
	if (!clearance) throw new Error("Compiled rail clearance buffers are missing.");
	const envelopes = clearance.envelopes;
	const issues = clearance.issues;
	const profile = resolveRailClearanceProfile(envelopes.profileId);
	if (!profile || profile.version !== envelopes.profileVersion) {
		throw new Error("Compiled rail clearance profile is not an exact OpenFab catalog version.");
	}
	if (!Number.isSafeInteger(envelopes.count) || envelopes.count < 0) {
		throw new Error("Compiled rail clearance envelope count is invalid.");
	}
	if (envelopes.pathOffsets.length !== layout.paths.pathCount + 1) {
		throw new Error("Compiled rail clearance path offsets are malformed.");
	}
	validateOffsets(
		envelopes.pathOffsets,
		layout.paths.pathCount,
		envelopes.count,
		"rail clearance envelope",
	);
	const envelopeRows: readonly [string, ArrayLike<number>][] = [
		["pathIndices", envelopes.pathIndices],
		["pointIndices", envelopes.pointIndices],
		["stationStarts", envelopes.stationStarts],
		["stationEnds", envelopes.stationEnds],
		["beamRadiusMillimeters", envelopes.beamRadiusMillimeters],
		["ohtSweepRadiusMillimeters", envelopes.ohtSweepRadiusMillimeters],
		["installationRadiusMillimeters", envelopes.installationRadiusMillimeters],
		["approximationToleranceMillimeters", envelopes.approximationToleranceMillimeters],
	];
	for (const [name, values] of envelopeRows) {
		if (values.length !== envelopes.count) {
			throw new Error(`Compiled rail clearance envelope ${name} length must equal count.`);
		}
	}
	if (
		envelopes.startPoints.length !== envelopes.count * 2 ||
		envelopes.endPoints.length !== envelopes.count * 2 ||
		envelopes.bounds.length !== envelopes.count * 4
	) {
		throw new Error("Compiled rail clearance envelope point or bound buffers are malformed.");
	}
	for (let envelopeIndex = 0; envelopeIndex < envelopes.count; envelopeIndex++) {
		const pathIndex = envelopes.pathIndices[envelopeIndex] as number;
		const pointIndex = envelopes.pointIndices[envelopeIndex] as number;
		if (
			pathIndex >= layout.paths.pathCount ||
			pointIndex < (layout.paths.offsets[pathIndex] as number) ||
			pointIndex + 1 >= (layout.paths.offsets[pathIndex + 1] as number)
		) {
			throw new Error(`Compiled rail clearance envelope ${envelopeIndex} has invalid ownership.`);
		}
		const stationStart = envelopes.stationStarts[envelopeIndex] as number;
		const stationEnd = envelopes.stationEnds[envelopeIndex] as number;
		const pathLength = layout.paths.lengths[pathIndex] as number;
		const values = [
			stationStart,
			stationEnd,
			envelopes.startPoints[envelopeIndex * 2] as number,
			envelopes.startPoints[envelopeIndex * 2 + 1] as number,
			envelopes.endPoints[envelopeIndex * 2] as number,
			envelopes.endPoints[envelopeIndex * 2 + 1] as number,
			envelopes.bounds[envelopeIndex * 4] as number,
			envelopes.bounds[envelopeIndex * 4 + 1] as number,
			envelopes.bounds[envelopeIndex * 4 + 2] as number,
			envelopes.bounds[envelopeIndex * 4 + 3] as number,
		];
		if (
			values.some((value) => !Number.isFinite(value)) ||
			stationStart < 0 ||
			stationEnd <= stationStart ||
			stationEnd > pathLength + 1e-5 ||
			(envelopes.beamRadiusMillimeters[envelopeIndex] as number) !==
				profile.beamRadiusMillimeters ||
			(envelopes.ohtSweepRadiusMillimeters[envelopeIndex] as number) !==
				profile.ohtSweepRadiusMillimeters ||
			(envelopes.installationRadiusMillimeters[envelopeIndex] as number) !==
				profile.installationRadiusMillimeters ||
			(envelopes.approximationToleranceMillimeters[envelopeIndex] as number) !==
				profile.approximationToleranceMillimeters
		) {
			throw new Error(`Compiled rail clearance envelope ${envelopeIndex} is malformed.`);
		}
	}

	if (
		!Number.isSafeInteger(issues.count) ||
		issues.count < 0 ||
		!Number.isSafeInteger(issues.candidateEnvelopePairs) ||
		issues.candidateEnvelopePairs < 0 ||
		!Number.isSafeInteger(issues.testedEnvelopePairs) ||
		issues.testedEnvelopePairs < 0 ||
		issues.testedEnvelopePairs > issues.candidateEnvelopePairs ||
		issues.count > issues.testedEnvelopePairs
	) {
		throw new Error("Compiled rail clearance issue counters are malformed.");
	}
	const issueRows: readonly [string, ArrayLike<number>][] = [
		["codes", issues.codes],
		["relations", issues.relations],
		["firstPathIndices", issues.firstPathIndices],
		["secondPathIndices", issues.secondPathIndices],
		["firstEnvelopeIndices", issues.firstEnvelopeIndices],
		["secondEnvelopeIndices", issues.secondEnvelopeIndices],
		["firstStations", issues.firstStations],
		["secondStations", issues.secondStations],
		["centerlineDistances", issues.centerlineDistances],
		["requiredClearances", issues.requiredClearances],
		["penetrationDepths", issues.penetrationDepths],
	];
	for (const [name, values] of issueRows) {
		if (values.length !== issues.count) {
			throw new Error(`Compiled rail clearance issue ${name} length must equal count.`);
		}
	}
	if (
		issues.contactPoints.length !== issues.count * 2 ||
		issues.cells.length !== issues.count * 4 ||
		issues.firstPathIdentities.length !== issues.count * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH ||
		issues.secondPathIdentities.length !== issues.count * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH
	) {
		throw new Error(
			"Compiled rail clearance issue contact, identity, or cell buffers are malformed.",
		);
	}
	for (let issueIndex = 0; issueIndex < issues.count; issueIndex++) {
		const firstPathIndex = issues.firstPathIndices[issueIndex] as number;
		const secondPathIndex = issues.secondPathIndices[issueIndex] as number;
		const firstEnvelopeIndex = issues.firstEnvelopeIndices[issueIndex] as number;
		const secondEnvelopeIndex = issues.secondEnvelopeIndices[issueIndex] as number;
		const code = issues.codes[issueIndex] as number;
		const numericValues = [
			issues.firstStations[issueIndex] as number,
			issues.secondStations[issueIndex] as number,
			issues.contactPoints[issueIndex * 2] as number,
			issues.contactPoints[issueIndex * 2 + 1] as number,
			issues.centerlineDistances[issueIndex] as number,
			issues.requiredClearances[issueIndex] as number,
			issues.penetrationDepths[issueIndex] as number,
		];
		if (
			code < RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION ||
			code > RAIL_CLEARANCE_ISSUE_CODE.INSTALLATION_CLEARANCE ||
			(issues.relations[issueIndex] as number) !== RAIL_CLEARANCE_RELATION.UNRELATED ||
			firstPathIndex >= secondPathIndex ||
			secondPathIndex >= layout.paths.pathCount ||
			firstEnvelopeIndex >= envelopes.count ||
			secondEnvelopeIndex >= envelopes.count ||
			(envelopes.pathIndices[firstEnvelopeIndex] as number) !== firstPathIndex ||
			(envelopes.pathIndices[secondEnvelopeIndex] as number) !== secondPathIndex ||
			numericValues.some((value) => !Number.isFinite(value)) ||
			(issues.centerlineDistances[issueIndex] as number) < 0 ||
			(issues.requiredClearances[issueIndex] as number) <= 0 ||
			(issues.penetrationDepths[issueIndex] as number) <= 0
		) {
			throw new Error(`Compiled rail clearance issue ${issueIndex} is malformed.`);
		}
	}

	const expected = compileRailClearance(
		layout.paths,
		layout.turnoutFootprints,
		layout.advancedSwitches,
		profile,
	);
	if (
		expected.envelopes.profileId !== envelopes.profileId ||
		expected.envelopes.profileVersion !== envelopes.profileVersion ||
		expected.envelopes.count !== envelopes.count ||
		expected.issues.count !== issues.count ||
		expected.issues.candidateEnvelopePairs !== issues.candidateEnvelopePairs ||
		expected.issues.testedEnvelopePairs !== issues.testedEnvelopePairs
	) {
		throw new Error("Compiled rail clearance metadata differs from derived physical geometry.");
	}
	const derivedViews: readonly [string, ArrayBufferView, ArrayBufferView][] = [
		["path offsets", envelopes.pathOffsets, expected.envelopes.pathOffsets],
		["path indices", envelopes.pathIndices, expected.envelopes.pathIndices],
		["point indices", envelopes.pointIndices, expected.envelopes.pointIndices],
		["station starts", envelopes.stationStarts, expected.envelopes.stationStarts],
		["station ends", envelopes.stationEnds, expected.envelopes.stationEnds],
		["start points", envelopes.startPoints, expected.envelopes.startPoints],
		["end points", envelopes.endPoints, expected.envelopes.endPoints],
		["bounds", envelopes.bounds, expected.envelopes.bounds],
		["beam radii", envelopes.beamRadiusMillimeters, expected.envelopes.beamRadiusMillimeters],
		[
			"OHT sweep radii",
			envelopes.ohtSweepRadiusMillimeters,
			expected.envelopes.ohtSweepRadiusMillimeters,
		],
		[
			"installation radii",
			envelopes.installationRadiusMillimeters,
			expected.envelopes.installationRadiusMillimeters,
		],
		[
			"approximation tolerances",
			envelopes.approximationToleranceMillimeters,
			expected.envelopes.approximationToleranceMillimeters,
		],
		["issue codes", issues.codes, expected.issues.codes],
		["issue relations", issues.relations, expected.issues.relations],
		["first issue paths", issues.firstPathIndices, expected.issues.firstPathIndices],
		["second issue paths", issues.secondPathIndices, expected.issues.secondPathIndices],
		[
			"first issue path identities",
			issues.firstPathIdentities,
			expected.issues.firstPathIdentities,
		],
		[
			"second issue path identities",
			issues.secondPathIdentities,
			expected.issues.secondPathIdentities,
		],
		["first issue envelopes", issues.firstEnvelopeIndices, expected.issues.firstEnvelopeIndices],
		["second issue envelopes", issues.secondEnvelopeIndices, expected.issues.secondEnvelopeIndices],
		["first issue stations", issues.firstStations, expected.issues.firstStations],
		["second issue stations", issues.secondStations, expected.issues.secondStations],
		["issue contacts", issues.contactPoints, expected.issues.contactPoints],
		["issue distances", issues.centerlineDistances, expected.issues.centerlineDistances],
		["issue clearances", issues.requiredClearances, expected.issues.requiredClearances],
		["issue penetrations", issues.penetrationDepths, expected.issues.penetrationDepths],
		["issue cells", issues.cells, expected.issues.cells],
	];
	for (const [name, actual, derived] of derivedViews) {
		if (!equalTypedViews(actual, derived)) {
			throw new Error(`Compiled rail clearance ${name} differ from derived physical geometry.`);
		}
	}
}

const COOPERATIVE_VALIDATION_SLICE_OPERATIONS = 16;
const COOPERATIVE_SEAM_RADIX_SLICE_OPERATIONS = 128;
const CLEARANCE_MIN_SEGMENT_LENGTH_METERS = 1e-7;
const CLEARANCE_DISTANCE_EPSILON = 1e-8;

type CooperativePhysicalSeamKind = "entry" | "exit";

interface CooperativeClearanceAdjacencyEntryMatches {
	readonly sortedEntryPathIndices: Uint32Array;
	readonly entryStartPlusOneByExitPath: Uint32Array;
	readonly entryCountByExitPath: Uint8Array;
}

interface CooperativeValidationClock {
	operations: number;
	readonly checkpoint: () => Promise<void>;
}

interface CooperativeClearanceInterval {
	readonly owner: number;
	readonly start: number;
	readonly end: number;
}

interface CooperativeClearanceRelationshipContext {
	readonly adjacency: {
		readonly offsets: Uint32Array;
		readonly targets: Uint32Array;
	};
	readonly turnoutIntervalsByPath: ReadonlyMap<number, readonly CooperativeClearanceInterval[]>;
	readonly switchConflictIntervalsByPath: ReadonlyMap<
		number,
		readonly CooperativeClearanceInterval[]
	>;
	readonly switchModuleIntervalsByPath: ReadonlyMap<
		number,
		readonly CooperativeClearanceInterval[]
	>;
}

interface CooperativePendingClearanceIssue {
	code: number;
	relation: number;
	firstPathIndex: number;
	secondPathIndex: number;
	firstEnvelopeIndex: number;
	secondEnvelopeIndex: number;
	firstStation: number;
	secondStation: number;
	contactX: number;
	contactY: number;
	centerlineDistance: number;
	requiredClearance: number;
	penetrationDepth: number;
	firstCellX: number;
	firstCellY: number;
	secondCellX: number;
	secondCellY: number;
}

async function validateRailClearanceContractCooperatively(
	layout: CompiledPhysicalLayout,
	checkpoint: () => Promise<void>,
	setPhase: (phase: string) => void,
): Promise<void> {
	const clock: CooperativeValidationClock = { operations: 0, checkpoint };
	setPhase("clearance-offsets");
	const clearance = layout.clearance;
	if (!clearance) throw new Error("Compiled rail clearance buffers are missing.");
	const envelopes = clearance.envelopes;
	const issues = clearance.issues;
	const profile = resolveRailClearanceProfile(envelopes.profileId);
	if (!profile || profile.version !== envelopes.profileVersion) {
		throw new Error("Compiled rail clearance profile is not an exact OpenFab catalog version.");
	}
	if (!Number.isSafeInteger(envelopes.count) || envelopes.count < 0) {
		throw new Error("Compiled rail clearance envelope count is invalid.");
	}
	if (envelopes.pathOffsets.length !== layout.paths.pathCount + 1) {
		throw new Error("Compiled rail clearance path offsets are malformed.");
	}
	await validateOffsetsCooperatively(
		envelopes.pathOffsets,
		layout.paths.pathCount,
		envelopes.count,
		"rail clearance envelope",
		clock,
	);
	const envelopeRows: readonly [string, ArrayLike<number>][] = [
		["pathIndices", envelopes.pathIndices],
		["pointIndices", envelopes.pointIndices],
		["stationStarts", envelopes.stationStarts],
		["stationEnds", envelopes.stationEnds],
		["beamRadiusMillimeters", envelopes.beamRadiusMillimeters],
		["ohtSweepRadiusMillimeters", envelopes.ohtSweepRadiusMillimeters],
		["installationRadiusMillimeters", envelopes.installationRadiusMillimeters],
		["approximationToleranceMillimeters", envelopes.approximationToleranceMillimeters],
	];
	for (const [name, values] of envelopeRows) {
		if (values.length !== envelopes.count) {
			throw new Error(`Compiled rail clearance envelope ${name} length must equal count.`);
		}
	}
	if (
		envelopes.startPoints.length !== envelopes.count * 2 ||
		envelopes.endPoints.length !== envelopes.count * 2 ||
		envelopes.bounds.length !== envelopes.count * 4
	) {
		throw new Error("Compiled rail clearance envelope point or bound buffers are malformed.");
	}

	const paths = layout.paths;
	const boundsRadiusMeters =
		(profile.installationRadiusMillimeters + profile.approximationToleranceMillimeters) / 1_000;
	setPhase("clearance-envelopes");
	let expectedEnvelopeIndex = 0;
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if ((envelopes.pathOffsets[pathIndex] as number) !== expectedEnvelopeIndex) {
			throw new Error(
				"Compiled rail clearance path offsets differ from derived physical geometry.",
			);
		}
		const pointStart = paths.offsets[pathIndex] as number;
		const pointEnd = paths.offsets[pathIndex + 1] as number;
		for (let pointIndex = pointStart; pointIndex < pointEnd - 1; pointIndex++) {
			const stationStart = paths.distances[pointIndex] as number;
			const stationEnd = paths.distances[pointIndex + 1] as number;
			if (!Number.isFinite(stationStart) || !Number.isFinite(stationEnd)) {
				throw new Error(`Physical path ${pathIndex} has non-finite clearance stations.`);
			}
			if (stationEnd < stationStart) {
				throw new Error(`Physical path ${pathIndex} has decreasing clearance stations.`);
			}
			const x0 = paths.positions[pointIndex * 2] as number;
			const y0 = paths.positions[pointIndex * 2 + 1] as number;
			const x1 = paths.positions[(pointIndex + 1) * 2] as number;
			const y1 = paths.positions[(pointIndex + 1) * 2 + 1] as number;
			if (![x0, y0, x1, y1].every(Number.isFinite)) {
				throw new Error(`Physical path ${pathIndex} has non-finite clearance geometry.`);
			}
			const stationSpan = stationEnd - stationStart;
			const geometricSpan = Math.hypot(x1 - x0, y1 - y0);
			if (stationSpan <= CLEARANCE_MIN_SEGMENT_LENGTH_METERS) {
				if (geometricSpan <= CLEARANCE_MIN_SEGMENT_LENGTH_METERS) {
					if (advanceCooperativeValidationClock(clock)) await checkpoint();
					continue;
				}
				throw new Error(
					`Physical path ${pathIndex} has nonzero geometry with zero clearance station span.`,
				);
			}
			if (geometricSpan <= CLEARANCE_MIN_SEGMENT_LENGTH_METERS) {
				throw new Error(
					`Physical path ${pathIndex} has zero geometry with a positive clearance station span.`,
				);
			}
			assertCanonicalClearanceEnvelope(
				layout,
				expectedEnvelopeIndex,
				pathIndex,
				pointIndex,
				stationStart,
				stationEnd,
				x0,
				y0,
				x1,
				y1,
				boundsRadiusMeters,
				profile,
			);
			expectedEnvelopeIndex++;
			if (advanceCooperativeValidationClock(clock)) await checkpoint();
		}
		if (advanceCooperativeValidationClock(clock)) await checkpoint();
	}
	if (
		expectedEnvelopeIndex !== envelopes.count ||
		(envelopes.pathOffsets[paths.pathCount] as number) !== expectedEnvelopeIndex
	) {
		throw new Error("Compiled rail clearance metadata differs from derived physical geometry.");
	}

	validateClearanceIssueShape(layout);
	const context = await createClearanceRelationshipContextCooperatively(layout, clock, setPhase);
	const expected = await deriveClearanceIssuesCooperatively(layout, context, clock, setPhase);
	if (
		expected.candidateEnvelopePairs !== issues.candidateEnvelopePairs ||
		expected.testedEnvelopePairs !== issues.testedEnvelopePairs ||
		expected.rowCount !== issues.count
	) {
		throw new Error("Compiled rail clearance metadata differs from derived physical geometry.");
	}
	await checkpoint();
}

function assertCanonicalClearanceEnvelope(
	layout: CompiledPhysicalLayout,
	envelopeIndex: number,
	pathIndex: number,
	pointIndex: number,
	stationStart: number,
	stationEnd: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	boundsRadiusMeters: number,
	profile: NonNullable<ReturnType<typeof resolveRailClearanceProfile>>,
): void {
	const envelopes = layout.clearance.envelopes;
	if (
		envelopeIndex >= envelopes.count ||
		(envelopes.pathIndices[envelopeIndex] as number) !== pathIndex ||
		(envelopes.pointIndices[envelopeIndex] as number) !== pointIndex ||
		!sameFloat32(envelopes.stationStarts[envelopeIndex] as number, stationStart) ||
		!sameFloat32(envelopes.stationEnds[envelopeIndex] as number, stationEnd) ||
		!sameFloat32(envelopes.startPoints[envelopeIndex * 2] as number, x0) ||
		!sameFloat32(envelopes.startPoints[envelopeIndex * 2 + 1] as number, y0) ||
		!sameFloat32(envelopes.endPoints[envelopeIndex * 2] as number, x1) ||
		!sameFloat32(envelopes.endPoints[envelopeIndex * 2 + 1] as number, y1) ||
		!sameFloat32(
			envelopes.bounds[envelopeIndex * 4] as number,
			Math.min(x0, x1) - boundsRadiusMeters,
		) ||
		!sameFloat32(
			envelopes.bounds[envelopeIndex * 4 + 1] as number,
			Math.min(y0, y1) - boundsRadiusMeters,
		) ||
		!sameFloat32(
			envelopes.bounds[envelopeIndex * 4 + 2] as number,
			Math.max(x0, x1) + boundsRadiusMeters,
		) ||
		!sameFloat32(
			envelopes.bounds[envelopeIndex * 4 + 3] as number,
			Math.max(y0, y1) + boundsRadiusMeters,
		) ||
		(envelopes.beamRadiusMillimeters[envelopeIndex] as number) !== profile.beamRadiusMillimeters ||
		(envelopes.ohtSweepRadiusMillimeters[envelopeIndex] as number) !==
			profile.ohtSweepRadiusMillimeters ||
		(envelopes.installationRadiusMillimeters[envelopeIndex] as number) !==
			profile.installationRadiusMillimeters ||
		(envelopes.approximationToleranceMillimeters[envelopeIndex] as number) !==
			profile.approximationToleranceMillimeters
	) {
		throw new Error(
			`Compiled rail clearance envelope ${envelopeIndex} differs from derived physical geometry.`,
		);
	}
	const boundsOffset = envelopeIndex * 4;
	for (let axis = 0; axis < 4; axis++) {
		const chunkCoordinate = Math.floor(
			(envelopes.bounds[boundsOffset + axis] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		if (!railEnvelopeChunkCoordinateIsCanonical(chunkCoordinate)) {
			throw new Error("Rail envelope spatial chunk coordinates exceed signed int32 capacity.");
		}
	}
}

function validateClearanceIssueShape(layout: CompiledPhysicalLayout): void {
	const issues = layout.clearance.issues;
	if (
		!Number.isSafeInteger(issues.count) ||
		issues.count < 0 ||
		!Number.isSafeInteger(issues.candidateEnvelopePairs) ||
		issues.candidateEnvelopePairs < 0 ||
		!Number.isSafeInteger(issues.testedEnvelopePairs) ||
		issues.testedEnvelopePairs < 0 ||
		issues.testedEnvelopePairs > issues.candidateEnvelopePairs ||
		issues.count > issues.testedEnvelopePairs
	) {
		throw new Error("Compiled rail clearance issue counters are malformed.");
	}
	const issueRows: readonly [string, ArrayLike<number>][] = [
		["codes", issues.codes],
		["relations", issues.relations],
		["firstPathIndices", issues.firstPathIndices],
		["secondPathIndices", issues.secondPathIndices],
		["firstEnvelopeIndices", issues.firstEnvelopeIndices],
		["secondEnvelopeIndices", issues.secondEnvelopeIndices],
		["firstStations", issues.firstStations],
		["secondStations", issues.secondStations],
		["centerlineDistances", issues.centerlineDistances],
		["requiredClearances", issues.requiredClearances],
		["penetrationDepths", issues.penetrationDepths],
	];
	for (const [name, values] of issueRows) {
		if (values.length !== issues.count) {
			throw new Error(`Compiled rail clearance issue ${name} length must equal count.`);
		}
	}
	if (
		issues.contactPoints.length !== issues.count * 2 ||
		issues.cells.length !== issues.count * 4 ||
		issues.firstPathIdentities.length !== issues.count * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH ||
		issues.secondPathIdentities.length !== issues.count * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH
	) {
		throw new Error(
			"Compiled rail clearance issue contact, identity, or cell buffers are malformed.",
		);
	}
}

async function createClearanceRelationshipContextCooperatively(
	layout: CompiledPhysicalLayout,
	clock: CooperativeValidationClock,
	setPhase: (phase: string) => void,
): Promise<CooperativeClearanceRelationshipContext> {
	const paths = layout.paths;
	const adjacency = await createClearanceAdjacencyCooperatively(paths, clock, setPhase);

	const turnoutIntervalsByPath = new Map<number, CooperativeClearanceInterval[]>();
	const turnouts = layout.turnoutFootprints;
	setPhase("clearance-ownership-intervals");
	for (let owner = 0; owner < turnouts.count; owner++) {
		await appendClearanceIntervalsCooperatively(
			paths.pathCount,
			turnoutIntervalsByPath,
			owner,
			turnouts.clearancePathOffsets[owner] as number,
			turnouts.clearancePathOffsets[owner + 1] as number,
			turnouts.clearancePathIndices,
			turnouts.clearancePathStarts,
			turnouts.clearancePathEnds,
			clock,
		);
	}
	const switchConflictIntervalsByPath = new Map<number, CooperativeClearanceInterval[]>();
	const switchModuleIntervalsByPath = new Map<number, CooperativeClearanceInterval[]>();
	const switches = layout.advancedSwitches;
	for (let owner = 0; owner < switches.count; owner++) {
		const movementStart = switches.movementOffsets[owner] as number;
		const movementEnd = switches.movementOffsets[owner + 1] as number;
		for (let movement = movementStart; movement < movementEnd; movement++) {
			await appendClearanceIntervalsCooperatively(
				paths.pathCount,
				switchModuleIntervalsByPath,
				owner,
				switches.movementPathOffsets[movement] as number,
				switches.movementPathOffsets[movement + 1] as number,
				switches.movementPathIndices,
				switches.movementPathStarts,
				switches.movementPathEnds,
				clock,
			);
		}
		await appendClearanceIntervalsCooperatively(
			paths.pathCount,
			switchConflictIntervalsByPath,
			owner,
			switches.conflictPathOffsets[owner] as number,
			switches.conflictPathOffsets[owner + 1] as number,
			switches.conflictPathIndices,
			switches.conflictPathStarts,
			switches.conflictPathEnds,
			clock,
		);
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	return {
		adjacency,
		turnoutIntervalsByPath,
		switchConflictIntervalsByPath,
		switchModuleIntervalsByPath,
	};
}

async function createClearanceAdjacencyCooperatively(
	paths: CompiledPhysicalPaths,
	clock: CooperativeValidationClock,
	setPhase: (phase: string) => void,
): Promise<CooperativeClearanceRelationshipContext["adjacency"]> {
	const entryPathIndices = new Uint32Array(paths.pathCount);
	const exitPathIndices = new Uint32Array(paths.pathCount);
	let entryCount = 0;
	let exitCount = 0;
	setPhase("clearance-adjacency-entry-index");
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if ((paths.kinds[pathIndex] as number) !== PATH_KIND.INVALID) {
			if ((paths.fromDirections[pathIndex] as number) !== 0) {
				entryPathIndices[entryCount++] = pathIndex;
			}
			if ((paths.toDirections[pathIndex] as number) !== 0) {
				exitPathIndices[exitCount++] = pathIndex;
			}
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	const sortedEntryPathIndices = await sortPhysicalSeamsCooperatively(
		paths,
		entryPathIndices,
		entryCount,
		"entry",
		clock,
	);
	await validatePhysicalSeamCardinalityCooperatively(
		paths,
		sortedEntryPathIndices,
		entryCount,
		"entry",
		clock,
	);

	setPhase("clearance-adjacency-exit-index");
	const sortedExitPathIndices = await sortPhysicalSeamsCooperatively(
		paths,
		exitPathIndices,
		exitCount,
		"exit",
		clock,
	);
	await validatePhysicalSeamCardinalityCooperatively(
		paths,
		sortedExitPathIndices,
		exitCount,
		"exit",
		clock,
	);

	setPhase("clearance-adjacency-match");
	const matches = await matchClearanceAdjacencyEntriesCooperatively(
		paths,
		sortedEntryPathIndices,
		entryCount,
		sortedExitPathIndices,
		exitCount,
		clock,
	);
	const adjacencyOffsets = new Uint32Array(paths.pathCount + 1);
	let adjacencyTargetCount = 0;
	const countScratchTargets = new Set<number>();
	setPhase("clearance-adjacency-count");
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		adjacencyOffsets[pathIndex] = adjacencyTargetCount;
		if ((paths.kinds[pathIndex] as number) !== PATH_KIND.INVALID) {
			const explicitStart = paths.explicitAdjacencyOffsets[pathIndex] as number;
			const explicitEnd = paths.explicitAdjacencyOffsets[pathIndex + 1] as number;
			if (explicitStart === explicitEnd) {
				adjacencyTargetCount += matches.entryCountByExitPath[pathIndex] as number;
			} else {
				const targets = await collectExplicitClearanceAdjacencyTargetsCooperatively(
					paths,
					matches,
					pathIndex,
					clock,
					countScratchTargets,
				);
				adjacencyTargetCount += targets.size;
			}
			if (!Number.isSafeInteger(adjacencyTargetCount) || adjacencyTargetCount > 0xffff_ffff) {
				throw new Error("Compiled rail clearance adjacency exceeds uint32 capacity.");
			}
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	adjacencyOffsets[paths.pathCount] = adjacencyTargetCount;
	// This exact-size allocation is the only native O(E) step; population below remains cancellable.
	await clock.checkpoint();
	const adjacencyTargets = new Uint32Array(adjacencyTargetCount);
	const populateScratchTargets = new Set<number>();
	const orderedScratchTargets: number[] = [];
	setPhase("clearance-adjacency-populate");
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		if ((paths.kinds[pathIndex] as number) !== PATH_KIND.INVALID) {
			const explicitStart = paths.explicitAdjacencyOffsets[pathIndex] as number;
			const explicitEnd = paths.explicitAdjacencyOffsets[pathIndex + 1] as number;
			let write = adjacencyOffsets[pathIndex] as number;
			if (explicitStart === explicitEnd) {
				const entryCountForPath = matches.entryCountByExitPath[pathIndex] as number;
				const entryStart = (matches.entryStartPlusOneByExitPath[pathIndex] as number) - 1;
				for (let index = 0; index < entryCountForPath; index++) {
					adjacencyTargets[write++] = matches.sortedEntryPathIndices[entryStart + index] as number;
					if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
				}
			} else {
				const targets = await collectExplicitClearanceAdjacencyTargetsCooperatively(
					paths,
					matches,
					pathIndex,
					clock,
					populateScratchTargets,
				);
				orderedScratchTargets.length = 0;
				for (const target of targets) {
					orderedScratchTargets.push(target);
					if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
				}
				targets.clear();
				await cooperativeStableSort(orderedScratchTargets, (left, right) => left - right, clock);
				for (const target of orderedScratchTargets) {
					adjacencyTargets[write++] = target;
					if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
				}
			}
			if (write !== (adjacencyOffsets[pathIndex + 1] as number)) {
				throw new Error("Compiled rail clearance adjacency changed during cooperative validation.");
			}
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	return { offsets: adjacencyOffsets, targets: adjacencyTargets };
}

async function sortPhysicalSeamsCooperatively(
	paths: CompiledPhysicalPaths,
	pathIndices: Uint32Array,
	count: number,
	kind: CooperativePhysicalSeamKind,
	clock: CooperativeValidationClock,
): Promise<Uint32Array> {
	let source: Uint32Array = pathIndices;
	let target: Uint32Array = new Uint32Array(pathIndices.length);
	const buckets = new Uint32Array(256);
	for (let pass = 0; pass < 11; pass++) {
		buckets.fill(0);
		for (let index = 0; index < count; index++) {
			const pathIndex = source[index] as number;
			const bucket = physicalSeamRadixByte(paths, pathIndex, kind, pass);
			buckets[bucket] = (buckets[bucket] as number) + 1;
			if (
				(index & (COOPERATIVE_SEAM_RADIX_SLICE_OPERATIONS - 1)) ===
				COOPERATIVE_SEAM_RADIX_SLICE_OPERATIONS - 1
			) {
				await clock.checkpoint();
			}
		}
		let cursor = 0;
		for (let bucket = 0; bucket < buckets.length; bucket++) {
			const bucketCount = buckets[bucket] as number;
			buckets[bucket] = cursor;
			cursor += bucketCount;
		}
		await clock.checkpoint();
		for (let index = 0; index < count; index++) {
			const pathIndex = source[index] as number;
			const bucket = physicalSeamRadixByte(paths, pathIndex, kind, pass);
			const write = buckets[bucket] as number;
			target[write] = pathIndex;
			buckets[bucket] = write + 1;
			if (
				(index & (COOPERATIVE_SEAM_RADIX_SLICE_OPERATIONS - 1)) ===
				COOPERATIVE_SEAM_RADIX_SLICE_OPERATIONS - 1
			) {
				await clock.checkpoint();
			}
		}
		await clock.checkpoint();
		[source, target] = [target, source];
	}
	return source;
}

function physicalSeamRadixByte(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	kind: CooperativePhysicalSeamKind,
	pass: number,
): number {
	if (pass === 0) return physicalSeamDirection(paths, pathIndex, kind);
	const coordinatePass = pass - 1;
	const axis = coordinatePass < 5 ? "y" : "x";
	const byte = coordinatePass % 5;
	const coordinate = physicalSeamCoordinate(paths, pathIndex, kind, axis);
	const normalized = coordinate + 0x8000_0001;
	return Math.floor(normalized / 2 ** (byte * 8)) & 0xff;
}

function physicalSeamCoordinate(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	kind: CooperativePhysicalSeamKind,
	axis: "x" | "y",
): number {
	const offset = pathIndex * 2;
	if (kind === "entry") return paths.cells[offset + (axis === "y" ? 1 : 0)] as number;
	const direction = paths.toDirections[pathIndex] as number;
	const coordinate = paths.exitCells[offset + (axis === "y" ? 1 : 0)] as number;
	if (axis === "x") {
		if (direction === DIR_E) return coordinate + 1;
		if (direction === DIR_W) return coordinate - 1;
	} else {
		if (direction === DIR_S) return coordinate + 1;
		if (direction === DIR_N) return coordinate - 1;
	}
	return coordinate;
}

function physicalSeamDirection(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	kind: CooperativePhysicalSeamKind,
): number {
	if (kind === "entry") return paths.fromDirections[pathIndex] as number;
	return oppositeDirection(paths.toDirections[pathIndex] as Direction);
}

function comparePhysicalSeams(
	paths: CompiledPhysicalPaths,
	leftPathIndex: number,
	leftKind: CooperativePhysicalSeamKind,
	rightPathIndex: number,
	rightKind: CooperativePhysicalSeamKind,
): number {
	const leftX = physicalSeamCoordinate(paths, leftPathIndex, leftKind, "x");
	const rightX = physicalSeamCoordinate(paths, rightPathIndex, rightKind, "x");
	if (leftX !== rightX) return leftX < rightX ? -1 : 1;
	const leftY = physicalSeamCoordinate(paths, leftPathIndex, leftKind, "y");
	const rightY = physicalSeamCoordinate(paths, rightPathIndex, rightKind, "y");
	if (leftY !== rightY) return leftY < rightY ? -1 : 1;
	const leftDirection = physicalSeamDirection(paths, leftPathIndex, leftKind);
	const rightDirection = physicalSeamDirection(paths, rightPathIndex, rightKind);
	return leftDirection === rightDirection ? 0 : leftDirection < rightDirection ? -1 : 1;
}

async function validatePhysicalSeamCardinalityCooperatively(
	paths: CompiledPhysicalPaths,
	sortedPathIndices: Uint32Array,
	count: number,
	kind: CooperativePhysicalSeamKind,
	clock: CooperativeValidationClock,
): Promise<void> {
	for (let start = 0; start < count; ) {
		let end = start + 1;
		while (
			end < count &&
			comparePhysicalSeams(
				paths,
				sortedPathIndices[start] as number,
				kind,
				sortedPathIndices[end] as number,
				kind,
			) === 0
		) {
			end++;
			if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
		}
		assertCanonicalPhysicalPathSeamCardinality(end - start);
		start = end;
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
}

async function matchClearanceAdjacencyEntriesCooperatively(
	paths: CompiledPhysicalPaths,
	sortedEntryPathIndices: Uint32Array,
	entryCount: number,
	sortedExitPathIndices: Uint32Array,
	exitCount: number,
	clock: CooperativeValidationClock,
): Promise<CooperativeClearanceAdjacencyEntryMatches> {
	const entryStartPlusOneByExitPath = new Uint32Array(paths.pathCount);
	const entryCountByExitPath = new Uint8Array(paths.pathCount);
	let entryCursor = 0;
	let exitCursor = 0;
	while (entryCursor < entryCount && exitCursor < exitCount) {
		const comparison = comparePhysicalSeams(
			paths,
			sortedEntryPathIndices[entryCursor] as number,
			"entry",
			sortedExitPathIndices[exitCursor] as number,
			"exit",
		);
		if (comparison < 0) {
			entryCursor++;
		} else if (comparison > 0) {
			exitCursor++;
		} else {
			let entryEnd = entryCursor + 1;
			while (
				entryEnd < entryCount &&
				comparePhysicalSeams(
					paths,
					sortedEntryPathIndices[entryCursor] as number,
					"entry",
					sortedEntryPathIndices[entryEnd] as number,
					"entry",
				) === 0
			) {
				entryEnd++;
				if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
			}
			let exitEnd = exitCursor + 1;
			while (
				exitEnd < exitCount &&
				comparePhysicalSeams(
					paths,
					sortedExitPathIndices[exitCursor] as number,
					"exit",
					sortedExitPathIndices[exitEnd] as number,
					"exit",
				) === 0
			) {
				exitEnd++;
				if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
			}
			for (let index = exitCursor; index < exitEnd; index++) {
				const pathIndex = sortedExitPathIndices[index] as number;
				entryStartPlusOneByExitPath[pathIndex] = entryCursor + 1;
				entryCountByExitPath[pathIndex] = entryEnd - entryCursor;
				if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
			}
			entryCursor = entryEnd;
			exitCursor = exitEnd;
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	return { sortedEntryPathIndices, entryStartPlusOneByExitPath, entryCountByExitPath };
}

async function collectExplicitClearanceAdjacencyTargetsCooperatively(
	paths: CompiledPhysicalPaths,
	matches: CooperativeClearanceAdjacencyEntryMatches,
	pathIndex: number,
	clock: CooperativeValidationClock,
	targets: Set<number>,
): Promise<Set<number>> {
	targets.clear();
	const entryCount = matches.entryCountByExitPath[pathIndex] as number;
	const entryStart = (matches.entryStartPlusOneByExitPath[pathIndex] as number) - 1;
	for (let index = 0; index < entryCount; index++) {
		targets.add(matches.sortedEntryPathIndices[entryStart + index] as number);
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	const explicitStart = paths.explicitAdjacencyOffsets[pathIndex] as number;
	const explicitEnd = paths.explicitAdjacencyOffsets[pathIndex + 1] as number;
	for (let row = explicitStart; row < explicitEnd; row++) {
		const target = paths.explicitAdjacencyTargets[row] as number;
		if (target < paths.pathCount && (paths.kinds[target] as number) !== PATH_KIND.INVALID) {
			targets.add(target);
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	return targets;
}

async function appendClearanceIntervalsCooperatively(
	pathCount: number,
	target: Map<number, CooperativeClearanceInterval[]>,
	owner: number,
	start: number,
	end: number,
	pathIndices: Uint32Array,
	pathStarts: Float32Array,
	pathEnds: Float32Array,
	clock: CooperativeValidationClock,
): Promise<void> {
	for (let row = start; row < end; row++) {
		const pathIndex = pathIndices[row] as number;
		if (pathIndex < pathCount) {
			const interval = {
				owner,
				start: pathStarts[row] as number,
				end: pathEnds[row] as number,
			};
			const intervals = target.get(pathIndex);
			if (intervals) intervals.push(interval);
			else target.set(pathIndex, [interval]);
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
}

async function classifyClearanceRelationshipCooperatively(
	paths: CompiledPhysicalLayout["paths"],
	context: CooperativeClearanceRelationshipContext,
	firstPathIndex: number,
	firstStation: number,
	secondPathIndex: number,
	secondStation: number,
	continuationWindowMeters: number,
	clock: CooperativeValidationClock,
): Promise<number> {
	if (firstPathIndex === secondPathIndex) return RAIL_CLEARANCE_RELATION.SAME_PATH;
	if (
		await shareClearanceIntervalOwnershipCooperatively(
			context.switchConflictIntervalsByPath,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
			clock,
		)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_CONFLICT;
	}
	if (
		await sharePhysicalHardwareCooperatively(
			paths,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
			clock,
		)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_CONFLICT;
	}
	if (
		await shareClearanceIntervalOwnershipCooperatively(
			context.switchModuleIntervalsByPath,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
			clock,
		)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_MODULE;
	}
	if (
		await shareClearanceIntervalOwnershipCooperatively(
			context.turnoutIntervalsByPath,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
			clock,
		)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_MODULE;
	}
	if (
		await shareCompoundModuleSupportCooperatively(paths, firstPathIndex, secondPathIndex, clock)
	) {
		return RAIL_CLEARANCE_RELATION.AUTHORIZED_MODULE;
	}
	if (
		(await continuationRouteFitsCooperatively(
			paths,
			context,
			firstPathIndex,
			firstStation,
			secondPathIndex,
			secondStation,
			continuationWindowMeters,
			clock,
		)) ||
		(await continuationRouteFitsCooperatively(
			paths,
			context,
			secondPathIndex,
			secondStation,
			firstPathIndex,
			firstStation,
			continuationWindowMeters,
			clock,
		))
	) {
		return RAIL_CLEARANCE_RELATION.CONTINUATION;
	}
	return RAIL_CLEARANCE_RELATION.UNRELATED;
}

async function shareClearanceIntervalOwnershipCooperatively(
	intervalsByPath: ReadonlyMap<number, readonly CooperativeClearanceInterval[]>,
	firstPathIndex: number,
	firstStation: number,
	secondPathIndex: number,
	secondStation: number,
	clock: CooperativeValidationClock,
): Promise<boolean> {
	const firstIntervals = intervalsByPath.get(firstPathIndex);
	const secondIntervals = intervalsByPath.get(secondPathIndex);
	if (!firstIntervals || !secondIntervals) return false;
	for (const first of firstIntervals) {
		if (!stationInClearanceInterval(first.start, first.end, firstStation)) continue;
		for (const second of secondIntervals) {
			if (
				first.owner === second.owner &&
				stationInClearanceInterval(second.start, second.end, secondStation)
			) {
				return true;
			}
			if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
		}
	}
	return false;
}

async function sharePhysicalHardwareCooperatively(
	paths: CompiledPhysicalLayout["paths"],
	firstPathIndex: number,
	firstStation: number,
	secondPathIndex: number,
	secondStation: number,
	clock: CooperativeValidationClock,
): Promise<boolean> {
	const firstStart = paths.sharedSegmentOffsets[firstPathIndex] as number;
	const firstEnd = paths.sharedSegmentOffsets[firstPathIndex + 1] as number;
	const secondStart = paths.sharedSegmentOffsets[secondPathIndex] as number;
	const secondEnd = paths.sharedSegmentOffsets[secondPathIndex + 1] as number;
	for (let firstRow = firstStart; firstRow < firstEnd; firstRow++) {
		if (
			!stationInClearanceInterval(
				paths.sharedSegmentStarts[firstRow] as number,
				paths.sharedSegmentEnds[firstRow] as number,
				firstStation,
			)
		) {
			continue;
		}
		for (let secondRow = secondStart; secondRow < secondEnd; secondRow++) {
			if (
				paths.sharedSegmentIds[firstRow] === paths.sharedSegmentIds[secondRow] &&
				stationInClearanceInterval(
					paths.sharedSegmentStarts[secondRow] as number,
					paths.sharedSegmentEnds[secondRow] as number,
					secondStation,
				)
			) {
				return true;
			}
			if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
		}
	}
	return false;
}

async function shareCompoundModuleSupportCooperatively(
	paths: CompiledPhysicalLayout["paths"],
	firstPathIndex: number,
	secondPathIndex: number,
	clock: CooperativeValidationClock,
): Promise<boolean> {
	const firstCompound = isOrdinaryCompoundPathKind(paths.kinds[firstPathIndex] as number);
	const secondCompound = isOrdinaryCompoundPathKind(paths.kinds[secondPathIndex] as number);
	if (firstCompound === secondCompound) return false;
	const compoundPathIndex = firstCompound ? firstPathIndex : secondPathIndex;
	const supportPathIndex = firstCompound ? secondPathIndex : firstPathIndex;
	const supportKind = paths.kinds[supportPathIndex] as number;
	if (supportKind !== PATH_KIND.LINEAR && supportKind !== PATH_KIND.TERMINAL) return false;
	const supportCells = new Set<string>();
	const supportStart = paths.coverageOffsets[supportPathIndex] as number;
	const supportEnd = paths.coverageOffsets[supportPathIndex + 1] as number;
	for (let row = supportStart; row < supportEnd; row++) {
		supportCells.add(
			`${paths.coverageCells[row * 2] as number},${paths.coverageCells[row * 2 + 1] as number}`,
		);
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	const compoundStart = paths.coverageOffsets[compoundPathIndex] as number;
	const compoundEnd = paths.coverageOffsets[compoundPathIndex + 1] as number;
	for (let row = compoundStart; row < compoundEnd; row++) {
		if (
			supportCells.has(
				`${paths.coverageCells[row * 2] as number},${paths.coverageCells[row * 2 + 1] as number}`,
			)
		) {
			return true;
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	return false;
}

async function continuationRouteFitsCooperatively(
	paths: CompiledPhysicalLayout["paths"],
	context: CooperativeClearanceRelationshipContext,
	fromPathIndex: number,
	fromStation: number,
	toPathIndex: number,
	toStation: number,
	maxRouteDistanceMeters: number,
	clock: CooperativeValidationClock,
): Promise<boolean> {
	const limit = Math.max(0.002, maxRouteDistanceMeters);
	const initialDistance = Math.max(0, (paths.lengths[fromPathIndex] as number) - fromStation);
	if (initialDistance > limit + 0.002) return false;
	const best = new Map<number, number>();
	const queue: Array<{ pathIndex: number; distanceToStart: number }> = [];
	await enqueueClearanceContinuationTargets(
		paths,
		context,
		fromPathIndex,
		initialDistance,
		best,
		queue,
		clock,
	);
	while (queue.length > 0) {
		let nearestIndex = 0;
		for (let index = 1; index < queue.length; index++) {
			if (
				(queue[index] as { distanceToStart: number }).distanceToStart <
				(queue[nearestIndex] as { distanceToStart: number }).distanceToStart
			) {
				nearestIndex = index;
			}
			if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
		}
		const current = queue[nearestIndex] as { pathIndex: number; distanceToStart: number };
		const tail = queue.pop() as { pathIndex: number; distanceToStart: number };
		if (nearestIndex < queue.length) queue[nearestIndex] = tail;
		if (current.pathIndex === toPathIndex) {
			return current.distanceToStart + Math.max(0, toStation) <= limit + 0.002;
		}
		const distanceToEnd = current.distanceToStart + (paths.lengths[current.pathIndex] as number);
		if (distanceToEnd <= limit + 0.002) {
			await enqueueClearanceContinuationTargets(
				paths,
				context,
				current.pathIndex,
				distanceToEnd,
				best,
				queue,
				clock,
			);
		}
	}
	return false;
}

async function enqueueClearanceContinuationTargets(
	paths: CompiledPhysicalLayout["paths"],
	context: CooperativeClearanceRelationshipContext,
	pathIndex: number,
	distanceToEnd: number,
	best: Map<number, number>,
	queue: Array<{ pathIndex: number; distanceToStart: number }>,
	clock: CooperativeValidationClock,
): Promise<void> {
	const start = context.adjacency.offsets[pathIndex] as number;
	const end = context.adjacency.offsets[pathIndex + 1] as number;
	for (let row = start; row < end; row++) {
		const target = context.adjacency.targets[row] as number;
		if (clearanceContinuationGeometryMatches(paths, pathIndex, target)) {
			const previous = best.get(target);
			if (previous === undefined || previous > distanceToEnd) {
				best.set(target, distanceToEnd);
				queue.push({ pathIndex: target, distanceToStart: distanceToEnd });
			}
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
}

function clearanceContinuationGeometryMatches(
	paths: CompiledPhysicalLayout["paths"],
	fromPathIndex: number,
	toPathIndex: number,
): boolean {
	const fromPoint = (paths.offsets[fromPathIndex + 1] as number) - 1;
	const toPoint = paths.offsets[toPathIndex] as number;
	if (fromPoint < (paths.offsets[fromPathIndex] as number) || toPoint >= paths.pointCount) {
		return false;
	}
	const endpointDistance = Math.hypot(
		(paths.positions[fromPoint * 2] as number) - (paths.positions[toPoint * 2] as number),
		(paths.positions[fromPoint * 2 + 1] as number) - (paths.positions[toPoint * 2 + 1] as number),
	);
	if (!Number.isFinite(endpointDistance) || endpointDistance > 0.002) return false;
	const fromTangentX = paths.tangents[fromPoint * 2] as number;
	const fromTangentY = paths.tangents[fromPoint * 2 + 1] as number;
	const toTangentX = paths.tangents[toPoint * 2] as number;
	const toTangentY = paths.tangents[toPoint * 2 + 1] as number;
	const fromLength = Math.hypot(fromTangentX, fromTangentY);
	const toLength = Math.hypot(toTangentX, toTangentY);
	if (
		!Number.isFinite(fromLength) ||
		!Number.isFinite(toLength) ||
		fromLength <= CLEARANCE_DISTANCE_EPSILON ||
		toLength <= CLEARANCE_DISTANCE_EPSILON
	) {
		return false;
	}
	const normalizedDot =
		(fromTangentX * toTangentX + fromTangentY * toTangentY) / (fromLength * toLength);
	return Number.isFinite(normalizedDot) && normalizedDot >= 1 - 1e-5;
}

function stationInClearanceInterval(start: number, end: number, station: number): boolean {
	return station >= start - 0.002 && station <= end + 0.002;
}

function isOrdinaryCompoundPathKind(kind: number): boolean {
	return (
		kind === PATH_KIND.COMPOUND_CCW ||
		kind === PATH_KIND.COMPOUND_S ||
		kind === PATH_KIND.COMPOUND_CSC_HOMO ||
		kind === PATH_KIND.COMPOUND_CSC_HETE ||
		kind === PATH_KIND.COMPOUND_RIGHT
	);
}

async function deriveClearanceIssuesCooperatively(
	layout: CompiledPhysicalLayout,
	context: CooperativeClearanceRelationshipContext,
	clock: CooperativeValidationClock,
	setPhase: (phase: string) => void,
): Promise<{
	readonly rowCount: number;
	readonly candidateEnvelopePairs: number;
	readonly testedEnvelopePairs: number;
}> {
	const envelopes = layout.clearance.envelopes;
	const publishedIssues = layout.clearance.issues;
	const chunks = new Map<string, number[]>();
	setPhase("clearance-issue-spatial-index");
	for (let envelopeIndex = 0; envelopeIndex < envelopes.count; envelopeIndex++) {
		const offset = envelopeIndex * 4;
		const minChunkX = Math.floor(
			(envelopes.bounds[offset] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		const minChunkY = Math.floor(
			(envelopes.bounds[offset + 1] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		const maxChunkX = Math.floor(
			(envelopes.bounds[offset + 2] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		const maxChunkY = Math.floor(
			(envelopes.bounds[offset + 3] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const key = clearanceChunkKey(chunkX, chunkY);
				const bucket = chunks.get(key);
				if (bucket) bucket.push(envelopeIndex);
				else chunks.set(key, [envelopeIndex]);
				if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
			}
		}
	}

	const stamps = new Uint32Array(envelopes.count);
	let queryStamp = 0;
	let candidateEnvelopePairs = 0;
	let testedEnvelopePairs = 0;
	let issueIndex = 0;
	let currentFirstPathIndex = -1;
	const candidateSecondPathIndices = new Set<number>();
	const flushCurrentFirstPath = async (): Promise<void> => {
		if (currentFirstPathIndex < 0) return;
		const orderedSecondPathIndices: number[] = [];
		for (const secondPathIndex of candidateSecondPathIndices) {
			orderedSecondPathIndices.push(secondPathIndex);
			if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
		}
		candidateSecondPathIndices.clear();
		await cooperativeStableSort(orderedSecondPathIndices, (left, right) => left - right, clock);
		for (const secondPathIndex of orderedSecondPathIndices) {
			issueIndex = await validateClearancePathPairIssuesCooperatively(
				layout,
				context,
				currentFirstPathIndex,
				secondPathIndex,
				issueIndex,
				clock,
			);
		}
	};
	setPhase("clearance-issue-validation");
	for (let firstEnvelopeIndex = 0; firstEnvelopeIndex < envelopes.count; firstEnvelopeIndex++) {
		const firstPathIndex = envelopes.pathIndices[firstEnvelopeIndex] as number;
		if (firstPathIndex !== currentFirstPathIndex) {
			await flushCurrentFirstPath();
			currentFirstPathIndex = firstPathIndex;
		}
		queryStamp++;
		const candidates: number[] = [];
		const boundsOffset = firstEnvelopeIndex * 4;
		const minChunkX = Math.floor(
			(envelopes.bounds[boundsOffset] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		const minChunkY = Math.floor(
			(envelopes.bounds[boundsOffset + 1] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		const maxChunkX = Math.floor(
			(envelopes.bounds[boundsOffset + 2] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		const maxChunkY = Math.floor(
			(envelopes.bounds[boundsOffset + 3] as number) / DEFAULT_ENVELOPE_CHUNK_SIZE_METERS,
		);
		for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				for (const candidate of chunks.get(clearanceChunkKey(chunkX, chunkY)) ?? []) {
					if ((stamps[candidate] as number) === queryStamp) continue;
					stamps[candidate] = queryStamp;
					if (clearanceEnvelopesIntersect(envelopes, candidate, boundsOffset)) {
						candidates.push(candidate);
					}
					if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
				}
			}
		}
		await cooperativeStableSort(candidates, (left, right) => left - right, clock);
		for (const secondEnvelopeIndex of candidates) {
			if (secondEnvelopeIndex <= firstEnvelopeIndex) continue;
			candidateEnvelopePairs++;
			if (candidateEnvelopePairs > publishedIssues.candidateEnvelopePairs) {
				throw new Error("Compiled rail clearance metadata differs from derived physical geometry.");
			}
			const secondPathIndex = envelopes.pathIndices[secondEnvelopeIndex] as number;
			if (firstPathIndex === secondPathIndex) continue;
			testedEnvelopePairs++;
			if (testedEnvelopePairs > publishedIssues.testedEnvelopePairs) {
				throw new Error("Compiled rail clearance metadata differs from derived physical geometry.");
			}
			candidateSecondPathIndices.add(secondPathIndex);
			if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
		}
	}
	await flushCurrentFirstPath();
	return { rowCount: issueIndex, candidateEnvelopePairs, testedEnvelopePairs };
}

interface CooperativeClearanceIssueRegion {
	readonly id: number;
	parent: CooperativeClearanceIssueRegion | null;
	best: CooperativePendingClearanceIssue;
}

interface CooperativeClearanceIssueRegionStream {
	previousRow: Map<number, CooperativeClearanceIssueRegion>;
	currentRow: Map<number, CooperativeClearanceIssueRegion>;
	readonly completed: CooperativePendingClearanceIssue[];
	nextRegionId: number;
	readonly maximumCompletedRows: number;
}

async function validateClearancePathPairIssuesCooperatively(
	layout: CompiledPhysicalLayout,
	context: CooperativeClearanceRelationshipContext,
	firstPathIndex: number,
	secondPathIndex: number,
	issueIndex: number,
	clock: CooperativeValidationClock,
): Promise<number> {
	const envelopes = layout.clearance.envelopes;
	const stream: CooperativeClearanceIssueRegionStream = {
		previousRow: new Map(),
		currentRow: new Map(),
		completed: [],
		nextRegionId: 0,
		maximumCompletedRows: layout.clearance.issues.count - issueIndex,
	};
	const firstStart = envelopes.pathOffsets[firstPathIndex] as number;
	const firstEnd = envelopes.pathOffsets[firstPathIndex + 1] as number;
	const secondStart = envelopes.pathOffsets[secondPathIndex] as number;
	const secondEnd = envelopes.pathOffsets[secondPathIndex + 1] as number;
	for (let firstEnvelopeIndex = firstStart; firstEnvelopeIndex < firstEnd; firstEnvelopeIndex++) {
		const firstBoundsOffset = firstEnvelopeIndex * 4;
		for (
			let secondEnvelopeIndex = secondStart;
			secondEnvelopeIndex < secondEnd;
			secondEnvelopeIndex++
		) {
			if (!clearanceEnvelopesIntersect(envelopes, secondEnvelopeIndex, firstBoundsOffset)) {
				if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
				continue;
			}
			const issue = await deriveClearancePairIssueCooperatively(
				layout,
				context,
				firstPathIndex,
				secondPathIndex,
				firstEnvelopeIndex,
				secondEnvelopeIndex,
				clock,
			);
			if (issue) appendCooperativeClearanceIssueRegion(stream, issue);
			if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
		}
		await finishCooperativeClearanceIssueRegionRow(stream, clock);
	}
	await finishCooperativeClearanceIssueRegionRow(stream, clock);
	await cooperativeStableSort(stream.completed, compareCooperativeClearanceIssues, clock);
	for (const expected of stream.completed) {
		if (issueIndex >= layout.clearance.issues.count) {
			throw new Error("Compiled rail clearance metadata differs from derived physical geometry.");
		}
		assertCanonicalClearanceIssue(layout, issueIndex, expected);
		issueIndex++;
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	return issueIndex;
}

async function deriveClearancePairIssueCooperatively(
	layout: CompiledPhysicalLayout,
	context: CooperativeClearanceRelationshipContext,
	firstPathIndex: number,
	secondPathIndex: number,
	firstEnvelopeIndex: number,
	secondEnvelopeIndex: number,
	clock: CooperativeValidationClock,
): Promise<CooperativePendingClearanceIssue | null> {
	const envelopes = layout.clearance.envelopes;
	const closest = closestEnvelopeSegments(envelopes, firstEnvelopeIndex, secondEnvelopeIndex);
	const tolerance =
		((envelopes.approximationToleranceMillimeters[firstEnvelopeIndex] as number) +
			(envelopes.approximationToleranceMillimeters[secondEnvelopeIndex] as number)) /
		1_000;
	const installationClearance =
		((envelopes.installationRadiusMillimeters[firstEnvelopeIndex] as number) +
			(envelopes.installationRadiusMillimeters[secondEnvelopeIndex] as number)) /
			1_000 +
		tolerance;
	if (closest.distance + CLEARANCE_DISTANCE_EPSILON >= installationClearance) return null;
	const firstStation = interpolateClearanceStation(
		envelopes.stationStarts[firstEnvelopeIndex] as number,
		envelopes.stationEnds[firstEnvelopeIndex] as number,
		closest.firstAmount,
	);
	const secondStation = interpolateClearanceStation(
		envelopes.stationStarts[secondEnvelopeIndex] as number,
		envelopes.stationEnds[secondEnvelopeIndex] as number,
		closest.secondAmount,
	);
	const relation = await classifyClearanceRelationshipCooperatively(
		layout.paths,
		context,
		firstPathIndex,
		firstStation,
		secondPathIndex,
		secondStation,
		installationClearance,
		clock,
	);
	if (relation !== RAIL_CLEARANCE_RELATION.UNRELATED) return null;
	const beamClearance =
		((envelopes.beamRadiusMillimeters[firstEnvelopeIndex] as number) +
			(envelopes.beamRadiusMillimeters[secondEnvelopeIndex] as number)) /
			1_000 +
		tolerance;
	const ohtClearance =
		((envelopes.ohtSweepRadiusMillimeters[firstEnvelopeIndex] as number) +
			(envelopes.ohtSweepRadiusMillimeters[secondEnvelopeIndex] as number)) /
			1_000 +
		tolerance;
	const code =
		closest.distance < beamClearance
			? RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION
			: closest.distance < ohtClearance
				? RAIL_CLEARANCE_ISSUE_CODE.OHT_SWEEP_INTRUSION
				: RAIL_CLEARANCE_ISSUE_CODE.INSTALLATION_CLEARANCE;
	const requiredClearance =
		code === RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION
			? beamClearance
			: code === RAIL_CLEARANCE_ISSUE_CODE.OHT_SWEEP_INTRUSION
				? ohtClearance
				: installationClearance;
	return normalizeCooperativeClearanceIssue({
		code,
		relation,
		firstPathIndex,
		secondPathIndex,
		firstEnvelopeIndex,
		secondEnvelopeIndex,
		firstStation,
		secondStation,
		contactX: (closest.firstX + closest.secondX) / 2,
		contactY: (closest.firstY + closest.secondY) / 2,
		centerlineDistance: closest.distance,
		requiredClearance,
		penetrationDepth: requiredClearance - closest.distance,
		firstCellX: Math.floor(closest.firstX),
		firstCellY: Math.floor(closest.firstY),
		secondCellX: Math.floor(closest.secondX),
		secondCellY: Math.floor(closest.secondY),
	});
}

function appendCooperativeClearanceIssueRegion(
	stream: CooperativeClearanceIssueRegionStream,
	issue: CooperativePendingClearanceIssue,
): void {
	const region: CooperativeClearanceIssueRegion = {
		id: stream.nextRegionId++,
		parent: null,
		best: issue,
	};
	let root = region;
	for (const neighbor of [
		stream.currentRow.get(issue.secondEnvelopeIndex - 1),
		stream.previousRow.get(issue.secondEnvelopeIndex - 1),
		stream.previousRow.get(issue.secondEnvelopeIndex),
		stream.previousRow.get(issue.secondEnvelopeIndex + 1),
	]) {
		if (neighbor) root = unionCooperativeClearanceIssueRegions(root, neighbor);
	}
	stream.currentRow.set(issue.secondEnvelopeIndex, root);
}

async function finishCooperativeClearanceIssueRegionRow(
	stream: CooperativeClearanceIssueRegionStream,
	clock: CooperativeValidationClock,
): Promise<void> {
	const currentRoots = new Set<CooperativeClearanceIssueRegion>();
	for (const region of stream.currentRow.values()) {
		currentRoots.add(findCooperativeClearanceIssueRegion(region));
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	const previousRoots = new Set<CooperativeClearanceIssueRegion>();
	for (const region of stream.previousRow.values()) {
		previousRoots.add(findCooperativeClearanceIssueRegion(region));
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	for (const region of previousRoots) {
		if (currentRoots.has(region)) continue;
		if (stream.completed.length >= stream.maximumCompletedRows) {
			throw new Error("Compiled rail clearance metadata differs from derived physical geometry.");
		}
		stream.completed.push(region.best);
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
	stream.previousRow = stream.currentRow;
	stream.currentRow = new Map();
}

function findCooperativeClearanceIssueRegion(
	region: CooperativeClearanceIssueRegion,
): CooperativeClearanceIssueRegion {
	let root = region;
	while (root.parent) root = root.parent;
	let cursor = region;
	while (cursor.parent && cursor.parent !== root) {
		const next = cursor.parent;
		cursor.parent = root;
		cursor = next;
	}
	return root;
}

function unionCooperativeClearanceIssueRegions(
	left: CooperativeClearanceIssueRegion,
	right: CooperativeClearanceIssueRegion,
): CooperativeClearanceIssueRegion {
	const leftRoot = findCooperativeClearanceIssueRegion(left);
	const rightRoot = findCooperativeClearanceIssueRegion(right);
	if (leftRoot === rightRoot) return leftRoot;
	const root = leftRoot.id < rightRoot.id ? leftRoot : rightRoot;
	const child = root === leftRoot ? rightRoot : leftRoot;
	child.parent = root;
	if (compareCooperativeIssueDepth(child.best, root.best) < 0) root.best = child.best;
	return root;
}

async function cooperativeStableSort<T>(
	values: T[],
	compare: (left: T, right: T) => number,
	clock: CooperativeValidationClock,
): Promise<void> {
	if (values.length < 2) return;
	await clock.checkpoint();
	let source = values;
	let target = new Array<T>(values.length);
	for (let width = 1; width < values.length; width *= 2) {
		for (let start = 0; start < values.length; start += width * 2) {
			const middle = Math.min(start + width, values.length);
			const end = Math.min(start + width * 2, values.length);
			let left = start;
			let right = middle;
			for (let write = start; write < end; write++) {
				if (
					right >= end ||
					(left < middle && compare(source[left] as T, source[right] as T) <= 0)
				) {
					target[write] = source[left++] as T;
				} else {
					target[write] = source[right++] as T;
				}
				if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
			}
		}
		const previousSource = source;
		source = target;
		target = previousSource;
	}
	if (source !== values) {
		for (let index = 0; index < values.length; index++) {
			values[index] = source[index] as T;
			if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
		}
	}
}

function assertCanonicalClearanceIssue(
	layout: CompiledPhysicalLayout,
	issueIndex: number,
	expected: CooperativePendingClearanceIssue,
): void {
	const issues = layout.clearance.issues;
	const firstIdentity = railClearancePathIdentity(layout.paths, expected.firstPathIndex);
	const secondIdentity = railClearancePathIdentity(layout.paths, expected.secondPathIndex);
	if (
		(issues.codes[issueIndex] as number) !== expected.code ||
		(issues.relations[issueIndex] as number) !== expected.relation ||
		(issues.firstPathIndices[issueIndex] as number) !== expected.firstPathIndex ||
		(issues.secondPathIndices[issueIndex] as number) !== expected.secondPathIndex ||
		(issues.firstEnvelopeIndices[issueIndex] as number) !== expected.firstEnvelopeIndex ||
		(issues.secondEnvelopeIndices[issueIndex] as number) !== expected.secondEnvelopeIndex ||
		!sameFloat32(issues.firstStations[issueIndex] as number, expected.firstStation) ||
		!sameFloat32(issues.secondStations[issueIndex] as number, expected.secondStation) ||
		!sameFloat32(issues.contactPoints[issueIndex * 2] as number, expected.contactX) ||
		!sameFloat32(issues.contactPoints[issueIndex * 2 + 1] as number, expected.contactY) ||
		!sameFloat32(issues.centerlineDistances[issueIndex] as number, expected.centerlineDistance) ||
		!sameFloat32(issues.requiredClearances[issueIndex] as number, expected.requiredClearance) ||
		!sameFloat32(issues.penetrationDepths[issueIndex] as number, expected.penetrationDepth) ||
		(issues.cells[issueIndex * 4] as number) !== expected.firstCellX ||
		(issues.cells[issueIndex * 4 + 1] as number) !== expected.firstCellY ||
		(issues.cells[issueIndex * 4 + 2] as number) !== expected.secondCellX ||
		(issues.cells[issueIndex * 4 + 3] as number) !== expected.secondCellY
	) {
		throw new Error(
			`Compiled rail clearance issue ${issueIndex} differs from derived physical geometry.`,
		);
	}
	const identityOffset = issueIndex * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH;
	for (let axis = 0; axis < RAIL_CLEARANCE_PATH_IDENTITY_WIDTH; axis++) {
		if (
			(issues.firstPathIdentities[identityOffset + axis] as number) !==
				(firstIdentity[axis] as number) ||
			(issues.secondPathIdentities[identityOffset + axis] as number) !==
				(secondIdentity[axis] as number)
		) {
			throw new Error(
				`Compiled rail clearance issue ${issueIndex} differs from derived physical geometry.`,
			);
		}
	}
}

function normalizeCooperativeClearanceIssue(
	issue: CooperativePendingClearanceIssue,
): CooperativePendingClearanceIssue {
	if (issue.firstPathIndex < issue.secondPathIndex) return issue;
	return {
		...issue,
		firstPathIndex: issue.secondPathIndex,
		secondPathIndex: issue.firstPathIndex,
		firstEnvelopeIndex: issue.secondEnvelopeIndex,
		secondEnvelopeIndex: issue.firstEnvelopeIndex,
		firstStation: issue.secondStation,
		secondStation: issue.firstStation,
		firstCellX: issue.secondCellX,
		firstCellY: issue.secondCellY,
		secondCellX: issue.firstCellX,
		secondCellY: issue.firstCellY,
	};
}

function compareCooperativeClearanceIssues(
	left: CooperativePendingClearanceIssue,
	right: CooperativePendingClearanceIssue,
): number {
	return (
		left.firstPathIndex - right.firstPathIndex ||
		left.secondPathIndex - right.secondPathIndex ||
		left.firstStation - right.firstStation ||
		left.secondStation - right.secondStation ||
		left.code - right.code
	);
}

function compareCooperativeIssueDepth(
	left: CooperativePendingClearanceIssue,
	right: CooperativePendingClearanceIssue,
): number {
	return (
		left.centerlineDistance - right.centerlineDistance ||
		left.firstEnvelopeIndex - right.firstEnvelopeIndex ||
		left.secondEnvelopeIndex - right.secondEnvelopeIndex
	);
}

function clearanceEnvelopesIntersect(
	envelopes: CompiledPhysicalLayout["clearance"]["envelopes"],
	envelopeIndex: number,
	queryBoundsOffset: number,
): boolean {
	const offset = envelopeIndex * 4;
	return !(
		(envelopes.bounds[offset + 2] as number) < (envelopes.bounds[queryBoundsOffset] as number) ||
		(envelopes.bounds[offset] as number) > (envelopes.bounds[queryBoundsOffset + 2] as number) ||
		(envelopes.bounds[offset + 3] as number) <
			(envelopes.bounds[queryBoundsOffset + 1] as number) ||
		(envelopes.bounds[offset + 1] as number) > (envelopes.bounds[queryBoundsOffset + 3] as number)
	);
}

async function validateOffsetsCooperatively(
	offsets: Uint32Array,
	rowCount: number,
	valueCount: number,
	label: string,
	clock: CooperativeValidationClock,
): Promise<void> {
	if (offsets[0] !== 0 || (offsets[rowCount] as number) !== valueCount) {
		throw new Error(`${label} offsets do not terminate at their value count.`);
	}
	for (let row = 0; row < rowCount; row++) {
		if ((offsets[row] as number) > (offsets[row + 1] as number)) {
			throw new Error(`${label} offsets are not monotonic.`);
		}
		if (advanceCooperativeValidationClock(clock)) await clock.checkpoint();
	}
}

function advanceCooperativeValidationClock(clock: CooperativeValidationClock): boolean {
	clock.operations++;
	return clock.operations % COOPERATIVE_VALIDATION_SLICE_OPERATIONS === 0;
}

function sameFloat32(actual: number, expected: number): boolean {
	return Object.is(actual, Math.fround(expected));
}

function interpolateClearanceStation(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}

function clearanceChunkKey(x: number, y: number): string {
	return `${x}:${y}`;
}

function equalTypedViews(left: ArrayBufferView, right: ArrayBufferView): boolean {
	if (left.constructor !== right.constructor || left.byteLength !== right.byteLength) return false;
	const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
	const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
	for (let index = 0; index < leftBytes.length; index++) {
		if (leftBytes[index] !== rightBytes[index]) return false;
	}
	return true;
}

function* validateCompoundProfileContractSteps(
	layout: CompiledPhysicalLayout,
): Generator<void, ReadonlyMap<number, number>> {
	const profiles = layout.compoundProfiles;
	const fixedRows: readonly [string, ArrayLike<number>][] = [
		["pathIndices", profiles.pathIndices],
		["advancedSwitchIds", profiles.advancedSwitchIds],
		["types", profiles.types],
		["geometryKinds", profiles.geometryKinds],
		["fitKinds", profiles.fitKinds],
		["nominalProfileIndices", profiles.nominalProfileIndices],
		["lateralSideSigns", profiles.lateralSideSigns],
		["compiledRadiusMillimeters", profiles.compiledRadiusMillimeters],
		["compiledTurnAngleTenths", profiles.compiledTurnAngleTenths],
		["compiledLeadInMillimeters", profiles.compiledLeadInMillimeters],
		["compiledLeadOutMillimeters", profiles.compiledLeadOutMillimeters],
		["compiledMiddleMillimeters", profiles.compiledMiddleMillimeters],
		["compiledLengthMillimeters", profiles.compiledLengthMillimeters],
		["leadInResidualMillimeters", profiles.leadInResidualMillimeters],
		["leadOutResidualMillimeters", profiles.leadOutResidualMillimeters],
		["middleResidualMillimeters", profiles.middleResidualMillimeters],
		["lengthResidualMillimeters", profiles.lengthResidualMillimeters],
		["forwardFitDeltaMillimeters", profiles.forwardFitDeltaMillimeters],
		["lateralFitDeltaMillimeters", profiles.lateralFitDeltaMillimeters],
		["fitReasonMasks", profiles.fitReasonMasks],
	];
	for (const [name, values] of fixedRows) {
		if (values.length !== profiles.count) {
			throw new Error(`Compound profile ${name} length must equal count.`);
		}
		yield;
	}
	if (
		profiles.controlOffsets.length !== profiles.count + 1 ||
		profiles.memberOffsets.length !== profiles.count + 1 ||
		profiles.controlPoints.length % 2 !== 0 ||
		profiles.controlDistances.length !== profiles.controlPoints.length / 2 ||
		profiles.controlRoles.length !== profiles.controlPoints.length / 2
	) {
		throw new Error("Compound profile CSR or control buffers are malformed.");
	}
	yield* validateOffsetSteps(
		profiles.controlOffsets,
		profiles.count,
		profiles.controlPoints.length / 2,
		"compound control",
	);
	yield* validateOffsetSteps(
		profiles.memberOffsets,
		profiles.count,
		profiles.memberPathIndices.length,
		"compound member",
	);

	const profileByPath = new Map<number, number>();
	for (let profileIndex = 0; profileIndex < profiles.count; profileIndex++) {
		yield;
		const pathIndex = profiles.pathIndices[profileIndex] as number;
		if (pathIndex >= layout.paths.pathCount || profileByPath.has(pathIndex)) {
			throw new Error(`Compound profile ${profileIndex} has an invalid or duplicate path.`);
		}
		profileByPath.set(pathIndex, profileIndex);
		const type = profiles.types[profileIndex] as number;
		const geometryKind = profiles.geometryKinds[profileIndex] as number;
		const fitKind = profiles.fitKinds[profileIndex] as number;
		const nominalProfileIndex = profiles.nominalProfileIndices[profileIndex] as number;
		if (
			type < COMPOUND_PROFILE_TYPE.CCW_CURVE ||
			type > COMPOUND_PROFILE_TYPE.RIGHT_CURVE ||
			(geometryKind !== COMPOUND_GEOMETRY_KIND.BASELINE_STITCHED &&
				geometryKind !== COMPOUND_GEOMETRY_KIND.OPENFAB_PARAMETRIC) ||
			(fitKind !== COMPOUND_PROFILE_FIT.NOT_APPLICABLE &&
				fitKind !== COMPOUND_PROFILE_FIT.MAP_EXACT &&
				fitKind !== COMPOUND_PROFILE_FIT.GRID_FIT) ||
			nominalProfileIndex < -1 ||
			nominalProfileIndex >= OPENFAB_COMPOUND_PROFILE_CATALOG.length
		) {
			yield;
			throw new Error(`Compound profile ${profileIndex} has invalid catalog metadata.`);
		}
		if (
			(profiles.advancedSwitchIds[profileIndex] as number) !==
			(layout.paths.advancedSwitchIds[pathIndex] as number)
		) {
			throw new Error(`Compound profile ${profileIndex} has mismatched path ownership.`);
		}
		for (
			let member = profiles.memberOffsets[profileIndex] as number;
			member < (profiles.memberOffsets[profileIndex + 1] as number);
			member++
		) {
			yield;
			if (
				(profiles.memberPathIndices[member] as number) >= layout.pathIntervalRemap.sourcePathCount
			) {
				throw new Error(`Compound profile ${profileIndex} has an invalid source member.`);
			}
		}
	}
	return profileByPath;
}

function validateExpectedSyntheticProfile(
	layout: CompiledPhysicalLayout,
	segment: AdvancedSwitchPhysicalSegment,
	pathIndex: number,
	sourcePathIndex: number,
	profileByPath: ReadonlyMap<number, number>,
	key: string,
): void {
	const profileIndex = profileByPath.get(pathIndex);
	const geometry = segment.compoundGeometry;
	if (!geometry) {
		if (profileIndex !== undefined) {
			throw new Error(`Synthetic linear path ${key} unexpectedly owns a compound profile.`);
		}
		return;
	}
	if (profileIndex === undefined) {
		throw new Error(`Synthetic compound profile is missing for ${key}.`);
	}
	const profiles = layout.compoundProfiles;
	const nominal = OPENFAB_COMPOUND_PROFILE_CATALOG[geometry.nominalProfileIndex];
	const expectedType =
		geometry.type === "S_CURVE" ? COMPOUND_PROFILE_TYPE.S_CURVE : COMPOUND_PROFILE_TYPE.RIGHT_CURVE;
	const expectedFit =
		geometry.fitKind === "MAP_EXACT"
			? COMPOUND_PROFILE_FIT.MAP_EXACT
			: COMPOUND_PROFILE_FIT.GRID_FIT;
	if (
		!nominal ||
		nominal.id !== segment.catalogProfileId ||
		(profiles.advancedSwitchIds[profileIndex] as number) !== segment.identity.switchId ||
		(profiles.types[profileIndex] as number) !== expectedType ||
		(profiles.geometryKinds[profileIndex] as number) !==
			COMPOUND_GEOMETRY_KIND.OPENFAB_PARAMETRIC ||
		(profiles.fitKinds[profileIndex] as number) !== expectedFit ||
		(profiles.nominalProfileIndices[profileIndex] as number) !== geometry.nominalProfileIndex ||
		(profiles.lateralSideSigns[profileIndex] as number) !== geometry.lateralSideSign ||
		(profiles.compiledRadiusMillimeters[profileIndex] as number) !== geometry.radiusMillimeters ||
		(profiles.compiledTurnAngleTenths[profileIndex] as number) !== geometry.turnAngleTenths ||
		(profiles.compiledLeadInMillimeters[profileIndex] as number) !== geometry.leadInMillimeters ||
		(profiles.compiledLeadOutMillimeters[profileIndex] as number) !== geometry.leadOutMillimeters ||
		(profiles.compiledMiddleMillimeters[profileIndex] as number) !== geometry.middleMillimeters ||
		(profiles.compiledLengthMillimeters[profileIndex] as number) !==
			geometry.compiledLengthMillimeters ||
		(profiles.leadInResidualMillimeters[profileIndex] as number) !==
			geometry.leadInResidualMillimeters ||
		(profiles.leadOutResidualMillimeters[profileIndex] as number) !==
			geometry.leadOutResidualMillimeters ||
		(profiles.middleResidualMillimeters[profileIndex] as number) !==
			geometry.middleResidualMillimeters ||
		(profiles.lengthResidualMillimeters[profileIndex] as number) !==
			geometry.lengthResidualMillimeters ||
		(profiles.forwardFitDeltaMillimeters[profileIndex] as number) !==
			geometry.forwardFitDeltaMillimeters ||
		(profiles.lateralFitDeltaMillimeters[profileIndex] as number) !==
			geometry.lateralFitDeltaMillimeters ||
		(profiles.fitReasonMasks[profileIndex] as number) !== geometry.fitReasonMask
	) {
		throw new Error(`Synthetic compound profile differs for ${key}.`);
	}

	const memberStart = profiles.memberOffsets[profileIndex] as number;
	const memberEnd = profiles.memberOffsets[profileIndex + 1] as number;
	if (
		memberEnd - memberStart !== 1 ||
		(profiles.memberPathIndices[memberStart] as number) !== sourcePathIndex
	) {
		throw new Error(`Synthetic compound profile differs for ${key}.`);
	}
	const expectedRoles =
		geometry.type === "RIGHT_CURVE"
			? [
					COMPOUND_CONTROL_ROLE.START,
					COMPOUND_CONTROL_ROLE.TMP_FROM,
					COMPOUND_CONTROL_ROLE.TMP_TO,
					COMPOUND_CONTROL_ROLE.END,
				]
			: [
					COMPOUND_CONTROL_ROLE.START,
					COMPOUND_CONTROL_ROLE.TMP_FROM,
					COMPOUND_CONTROL_ROLE.ARC_1_END,
					COMPOUND_CONTROL_ROLE.ARC_2_START,
					COMPOUND_CONTROL_ROLE.TMP_TO,
					COMPOUND_CONTROL_ROLE.END,
				];
	const controlStart = profiles.controlOffsets[profileIndex] as number;
	const controlEnd = profiles.controlOffsets[profileIndex + 1] as number;
	if (controlEnd - controlStart !== expectedRoles.length) {
		throw new Error(`Synthetic compound controls differ for ${key}.`);
	}
	for (let control = 0; control < expectedRoles.length; control++) {
		const row = controlStart + control;
		if (
			(profiles.controlRoles[row] as number) !== expectedRoles[control] ||
			!nearlyEqual(
				profiles.controlPoints[row * 2] as number,
				geometry.controlPoints[control * 2] as number,
			) ||
			!nearlyEqual(
				profiles.controlPoints[row * 2 + 1] as number,
				geometry.controlPoints[control * 2 + 1] as number,
			) ||
			!nearlyEqual(
				profiles.controlDistances[row] as number,
				geometry.controlDistances[control] as number,
			)
		) {
			throw new Error(`Synthetic compound controls differ for ${key}.`);
		}
	}
}

function* validateExpectedSyntheticGeometrySteps(
	layout: CompiledPhysicalLayout,
	finalSynthetic: ReadonlyMap<string, number>,
	remapSynthetic: ReadonlyMap<string, number>,
	profileByPath: ReadonlyMap<number, number>,
): Generator<void> {
	const paths = layout.paths;
	const remap = layout.pathIntervalRemap;
	const switches = layout.advancedSwitches;
	const expectedSynthetic = new Set<string>();
	const sharedOwnerById = new Map<number, string>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		yield;
		if ((paths.sourceKinds[pathIndex] as number) !== PHYSICAL_PATH_SOURCE_KIND.CARDINAL_CELL)
			continue;
		for (
			let row = paths.sharedSegmentOffsets[pathIndex] as number;
			row < (paths.sharedSegmentOffsets[pathIndex + 1] as number);
			row++
		) {
			yield;
			const id = paths.sharedSegmentIds[row] as number;
			sharedOwnerById.set(id, `cardinal:${id}`);
		}
	}
	for (let switchIndex = 0; switchIndex < switches.count; switchIndex++) {
		yield;
		const profileClass =
			ADVANCED_SWITCH_PROFILE_CLASSES[switches.profileClasses[switchIndex] as number];
		if (!profileClass)
			throw new Error("Compiled switch profile class cannot derive physical geometry.");
		const record: AdvancedSwitchRecord = {
			id: switches.ids[switchIndex] as number,
			profileClass,
			origin: {
				x: switches.origins[switchIndex * 2] as number,
				y: switches.origins[switchIndex * 2 + 1] as number,
			},
			forward: switches.forwardDirections[switchIndex] as AdvancedSwitchRecord["forward"],
			lateral: switches.lateralDirections[switchIndex] as AdvancedSwitchRecord["lateral"],
			movementMask: switches.movementMasks[switchIndex] as number,
		};
		const variant = compileAdvancedSwitchPhysicalVariant(record);
		const sharedIdByRole = new Map<number, number>();
		const pathByPackedIdentity = new Map(
			variant.segments.map((segment) => [
				segment.packedIdentity,
				finalSynthetic.get(
					syntheticPathIdentityKey(
						segment.identity.switchId,
						ADVANCED_SWITCH_PROFILE_CLASSES.indexOf(segment.identity.profileClass),
						segment.identity.role,
						segment.identity.portIndex,
						segment.identity.segmentOrdinal,
					),
				),
			]),
		);
		for (const segment of variant.segments) {
			yield;
			const key = syntheticPathIdentityKey(
				segment.identity.switchId,
				ADVANCED_SWITCH_PROFILE_CLASSES.indexOf(segment.identity.profileClass),
				segment.identity.role,
				segment.identity.portIndex,
				segment.identity.segmentOrdinal,
			);
			if (expectedSynthetic.has(key)) {
				throw new Error(`Compiled switch ownership duplicates synthetic path ${key}.`);
			}
			expectedSynthetic.add(key);
			const pathIndex = finalSynthetic.get(key);
			if (pathIndex === undefined) throw new Error(`Expected synthetic path ${key} is missing.`);
			const sourcePathIndex = remapSynthetic.get(key);
			if (
				sourcePathIndex === undefined ||
				(remap.sourcePathKinds[sourcePathIndex] as number) !== PATH_KIND.ADVANCED_SWITCH_SEGMENT ||
				(remap.sourcePathCells[sourcePathIndex * 2] as number) !== segment.entryCell.x ||
				(remap.sourcePathCells[sourcePathIndex * 2 + 1] as number) !== segment.entryCell.y ||
				(remap.sourcePathFromDirections[sourcePathIndex] as number) !== segment.fromDirection ||
				(remap.sourcePathToDirections[sourcePathIndex] as number) !== segment.toDirection ||
				!nearlyEqual(remap.sourcePathCanonicalStarts[sourcePathIndex] as number, 0) ||
				!nearlyEqual(remap.sourcePathLengths[sourcePathIndex] as number, segment.geometry.length)
			) {
				throw new Error(`Synthetic remap source metadata differs for ${key}.`);
			}
			validateExpectedSyntheticProfile(
				layout,
				segment,
				pathIndex,
				sourcePathIndex,
				profileByPath,
				key,
			);
			const pointStart = paths.offsets[pathIndex] as number;
			const pointEnd = paths.offsets[pathIndex + 1] as number;
			if (
				(paths.cells[pathIndex * 2] as number) !== segment.entryCell.x ||
				(paths.cells[pathIndex * 2 + 1] as number) !== segment.entryCell.y ||
				(paths.exitCells[pathIndex * 2] as number) !== segment.exitCell.x ||
				(paths.exitCells[pathIndex * 2 + 1] as number) !== segment.exitCell.y ||
				(paths.fromDirections[pathIndex] as number) !== segment.fromDirection ||
				(paths.toDirections[pathIndex] as number) !== segment.toDirection ||
				!nearlyEqual(paths.startInsets[pathIndex] as number, 0) ||
				!nearlyEqual(paths.endInsets[pathIndex] as number, 0) ||
				!nearlyEqual(paths.startExtensions[pathIndex] as number, 0) ||
				!nearlyEqual(paths.endExtensions[pathIndex] as number, 0) ||
				(paths.advancedSwitchCatalogProfiles[pathIndex] as number) !== segment.catalogProfileCode ||
				advancedSwitchPhysicalProfile(paths.advancedSwitchCatalogProfiles[pathIndex] as number)
					.id !== segment.catalogProfileId ||
				pointEnd - pointStart !== segment.geometry.distances.length ||
				!nearlyEqual(paths.lengths[pathIndex] as number, segment.geometry.length)
			) {
				throw new Error(`Synthetic physical geometry metadata differs for ${key}.`);
			}
			for (let axis = 0; axis < 4; axis++) {
				yield;
				if (
					!equalsEncodedFloat32(
						paths.bounds[pathIndex * 4 + axis] as number,
						segment.geometry.bounds[axis] as number,
					)
				) {
					throw new Error(`Synthetic physical bounds differ for ${key}.`);
				}
			}
			const coverageStart = paths.coverageOffsets[pathIndex] as number;
			const coverageEnd = paths.coverageOffsets[pathIndex + 1] as number;
			const actualCoverage = new Set<string>();
			for (let row = coverageStart; row < coverageEnd; row++) {
				yield;
				actualCoverage.add(
					`${paths.coverageCells[row * 2] as number}:${paths.coverageCells[row * 2 + 1] as number}`,
				);
			}
			const expectedCoverage = new Set(segment.coverage.map((cell) => `${cell.x}:${cell.y}`));
			if (
				actualCoverage.size !== expectedCoverage.size ||
				[...expectedCoverage].some((cell) => !actualCoverage.has(cell))
			) {
				throw new Error(`Synthetic physical coverage differs for ${key}.`);
			}
			const sharedStart = paths.sharedSegmentOffsets[pathIndex] as number;
			const sharedEnd = paths.sharedSegmentOffsets[pathIndex + 1] as number;
			const expectedSharedRows = segment.sharedEdge === null ? 0 : 1;
			if (sharedEnd - sharedStart !== expectedSharedRows) {
				throw new Error(`Synthetic shared ownership differs for ${key}.`);
			}
			if (segment.sharedEdge !== null) {
				const actualSharedId = paths.sharedSegmentIds[sharedStart] as number;
				const sharedOwner = `switch:${segment.identity.switchId}:${segment.identity.role}`;
				const existingOwner = sharedOwnerById.get(actualSharedId);
				if (existingOwner !== undefined && existingOwner !== sharedOwner) {
					throw new Error(
						`Synthetic shared hardware identity ${actualSharedId} is reused by unrelated owners.`,
					);
				}
				sharedOwnerById.set(actualSharedId, sharedOwner);
				const expectedSharedId = sharedIdByRole.get(segment.identity.role);
				if (expectedSharedId === undefined) {
					sharedIdByRole.set(segment.identity.role, actualSharedId);
				} else if (actualSharedId !== expectedSharedId) {
					throw new Error(`Synthetic shared identity differs for ${key}.`);
				}
				const expectedStart =
					segment.sharedEdge === "start" ? 0 : segment.geometry.length - segment.sharedLengthMeters;
				if (
					!nearlyEqual(paths.sharedSegmentStarts[sharedStart] as number, expectedStart) ||
					!nearlyEqual(
						paths.sharedSegmentEnds[sharedStart] as number,
						expectedStart + segment.sharedLengthMeters,
					)
				) {
					throw new Error(`Synthetic shared stations differ for ${key}.`);
				}
			}
			for (let point = 0; point < segment.geometry.distances.length; point++) {
				yield;
				if (
					!equalsEncodedFloat32(
						paths.positions[(pointStart + point) * 2] as number,
						segment.geometry.positions[point * 2] as number,
					) ||
					!equalsEncodedFloat32(
						paths.positions[(pointStart + point) * 2 + 1] as number,
						segment.geometry.positions[point * 2 + 1] as number,
					) ||
					!nearlyEqual(
						paths.tangents[(pointStart + point) * 2] as number,
						segment.geometry.tangents[point * 2] as number,
					) ||
					!nearlyEqual(
						paths.tangents[(pointStart + point) * 2 + 1] as number,
						segment.geometry.tangents[point * 2 + 1] as number,
					) ||
					!nearlyEqual(
						paths.distances[pointStart + point] as number,
						segment.geometry.distances[point] as number,
					)
				) {
					throw new Error(`Synthetic physical geometry samples differ for ${key}.`);
				}
			}
			const expectedSuccessors = segment.successors.map(
				(successor) => pathByPackedIdentity.get(successor) ?? NO_PATH_INTERVAL_TARGET,
			);
			const actualStart = paths.explicitAdjacencyOffsets[pathIndex] as number;
			const actualEnd = paths.explicitAdjacencyOffsets[pathIndex + 1] as number;
			if (
				expectedSuccessors.includes(NO_PATH_INTERVAL_TARGET) ||
				actualEnd - actualStart !== expectedSuccessors.length
			) {
				throw new Error(`Synthetic physical adjacency differs for ${key}.`);
			}
			const actualSuccessors: number[] = [];
			for (let row = actualStart; row < actualEnd; row++) {
				actualSuccessors.push(paths.explicitAdjacencyTargets[row] as number);
				yield;
			}
			yield* sortAdvancedSwitchNumbersSteps(actualSuccessors);
			yield* sortAdvancedSwitchNumbersSteps(expectedSuccessors);
			if (actualSuccessors.some((target, index) => target !== expectedSuccessors[index])) {
				throw new Error(`Synthetic physical adjacency differs for ${key}.`);
			}
		}
		const inputSharedId = sharedIdByRole.get(ADVANCED_SWITCH_SEGMENT_ROLE.INPUT);
		const outputSharedId = sharedIdByRole.get(ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT);
		if (
			sharedIdByRole.size !== 2 ||
			inputSharedId === undefined ||
			outputSharedId === undefined ||
			inputSharedId === outputSharedId
		) {
			throw new Error(`Advanced switch ${record.id} has invalid shared hardware identities.`);
		}
	}
	if (expectedSynthetic.size !== finalSynthetic.size) {
		throw new Error("Compiled switch ownership and synthetic identity sets differ.");
	}
	for (const key of finalSynthetic.keys()) {
		if (!expectedSynthetic.has(key)) {
			throw new Error("Compiled switch ownership and synthetic identity sets differ.");
		}
		yield;
	}
	for (const key of remapSynthetic.keys()) {
		if (!expectedSynthetic.has(key)) {
			throw new Error("Compiled switch ownership and synthetic identity sets differ.");
		}
		yield;
	}
}

function* validatePathAggregateSteps(paths: CompiledPhysicalLayout["paths"]): Generator<void> {
	const sharedUsage = new Map<number, { count: number; length: number }>();
	let totalRouteLengthMeters = 0;
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		yield;
		const pathLength = paths.lengths[pathIndex] as number;
		if (!Number.isFinite(pathLength) || pathLength < 0) {
			throw new Error(`Physical path ${pathIndex} has an invalid length.`);
		}
		totalRouteLengthMeters += pathLength;
		for (
			let row = paths.sharedSegmentOffsets[pathIndex] as number;
			row < (paths.sharedSegmentOffsets[pathIndex + 1] as number);
			row++
		) {
			yield;
			const start = paths.sharedSegmentStarts[row] as number;
			const end = paths.sharedSegmentEnds[row] as number;
			if (
				!Number.isFinite(start) ||
				!Number.isFinite(end) ||
				start < 0 ||
				end <= start ||
				end > pathLength + 1e-5
			) {
				throw new Error(`Shared physical segment row ${row} has invalid stations.`);
			}
			const id = paths.sharedSegmentIds[row] as number;
			const previous = sharedUsage.get(id);
			sharedUsage.set(id, {
				count: (previous?.count ?? 0) + 1,
				length: Math.max(previous?.length ?? 0, end - start),
			});
		}
	}
	let duplicatedLengthMeters = 0;
	for (const shared of sharedUsage.values()) {
		yield;
		duplicatedLengthMeters += shared.length * Math.max(0, shared.count - 1);
	}
	const totalLengthMeters = totalRouteLengthMeters - duplicatedLengthMeters;
	const tolerance = Math.max(1e-4, paths.pathCount * 1e-6);
	if (
		!Number.isInteger(paths.sharedSegmentCount) ||
		paths.sharedSegmentCount < 0 ||
		!Number.isFinite(paths.totalRouteLengthMeters) ||
		!Number.isFinite(paths.totalLengthMeters) ||
		paths.sharedSegmentCount !== sharedUsage.size ||
		Math.abs(paths.totalRouteLengthMeters - totalRouteLengthMeters) > tolerance ||
		Math.abs(paths.totalLengthMeters - totalLengthMeters) > tolerance
	) {
		throw new Error("Physical path aggregate metadata differs from its typed buffers.");
	}
}

function nearlyEqual(left: number, right: number): boolean {
	return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-5;
}

/** Compare the canonical wire representation, whose ULP grows with world coordinates. */
function equalsEncodedFloat32(actual: number, derived: number): boolean {
	return Number.isFinite(actual) && Number.isFinite(derived) && actual === Math.fround(derived);
}

function validateOffsets(
	offsets: Uint32Array,
	rowCount: number,
	valueCount: number,
	label: string,
): void {
	if (offsets[0] !== 0 || (offsets[rowCount] as number) !== valueCount) {
		throw new Error(`${label} offsets do not terminate at their value count.`);
	}
	for (let row = 0; row < rowCount; row++) {
		if ((offsets[row] as number) > (offsets[row + 1] as number)) {
			throw new Error(`${label} offsets are not monotonic.`);
		}
	}
}

function* validateOffsetSteps(
	offsets: Uint32Array,
	rowCount: number,
	valueCount: number,
	label: string,
): Generator<void> {
	if (offsets[0] !== 0 || (offsets[rowCount] as number) !== valueCount) {
		throw new Error(`${label} offsets do not terminate at their value count.`);
	}
	for (let row = 0; row < rowCount; row++) {
		if ((offsets[row] as number) > (offsets[row + 1] as number)) {
			throw new Error(`${label} offsets are not monotonic.`);
		}
		yield;
	}
}

function syntheticPathIdentityKey(
	switchId: number,
	profileClass: number,
	role: number,
	port: number,
	ordinal: number,
): string {
	const validRole =
		role === ADVANCED_SWITCH_SEGMENT_ROLE.INPUT ||
		role === ADVANCED_SWITCH_SEGMENT_ROLE.THROAT ||
		role === ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT;
	const validPort =
		role === ADVANCED_SWITCH_SEGMENT_ROLE.THROAT
			? port === ADVANCED_SWITCH_NO_PORT
			: port === 0 || port === 1;
	if (
		!Number.isInteger(switchId) ||
		switchId <= 0 ||
		profileClass < 0 ||
		profileClass > 3 ||
		!validRole ||
		!validPort ||
		ordinal < 0 ||
		ordinal >= NO_ADVANCED_SWITCH_SEGMENT_ORDINAL
	) {
		throw new Error("Synthetic physical path identity is malformed.");
	}
	return `${switchId}:${profileClass}:${role}:${port}:${ordinal}`;
}

function countMigrationKinds(migration: CompiledPhysicalPathMigration | null): {
	identity: number;
	translation: number;
	projection: number;
	deleted: number;
	unmappable: number;
	maxEndpointError: number;
} {
	const counts = {
		identity: 0,
		translation: 0,
		projection: 0,
		deleted: 0,
		unmappable: 0,
		maxEndpointError: 0,
	};
	if (!migration) return counts;
	for (let row = 0; row < migration.count; row++) {
		const kind = migration.mappingKinds[row] as number;
		if (kind === PHYSICAL_PATH_MIGRATION_KIND.IDENTITY) counts.identity++;
		else if (kind === PHYSICAL_PATH_MIGRATION_KIND.TRANSLATION) counts.translation++;
		else if (kind === PHYSICAL_PATH_MIGRATION_KIND.MONOTONIC_PROJECTION) counts.projection++;
		else if (kind === PHYSICAL_PATH_MIGRATION_KIND.DELETED) counts.deleted++;
		else if (kind === PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE) counts.unmappable++;
		counts.maxEndpointError = Math.max(
			counts.maxEndpointError,
			migration.endpointErrors[row] as number,
		);
	}
	return counts;
}

/** Ordered fingerprint of the worker simulation contract, excluding editor-only piece labels. */
export function checksumRailPhysicalLayout(layout: CompiledPhysicalLayout): string {
	const { checksum, views } = createRailPhysicalLayoutChecksum(layout);
	checksum.addViews(views);
	finishRailPhysicalLayoutChecksum(checksum, layout);
	return checksum.digest();
}

/** Main-thread verification variant that yields while hashing large transferred buffers. */
export async function checksumRailPhysicalLayoutCooperatively(
	layout: CompiledPhysicalLayout,
	checkpoint: () => Promise<void>,
): Promise<string> {
	const { checksum, views } = createRailPhysicalLayoutChecksum(layout);
	await checksum.addViewsCooperatively(views, checkpoint);
	await finishRailPhysicalLayoutChecksumCooperatively(checksum, layout, checkpoint);
	await checkpoint();
	return checksum.digest();
}

function createRailPhysicalLayoutChecksum(layout: CompiledPhysicalLayout): {
	readonly checksum: OrderedTypedChecksum;
	readonly views: readonly ArrayBufferView[];
} {
	const checksum = new OrderedTypedChecksum();
	const paths = layout.paths;
	const profiles = layout.compoundProfiles;
	const remap = layout.pathIntervalRemap;
	const turnouts = layout.turnoutFootprints;
	const advancedSwitches = layout.advancedSwitches;
	const clearanceEnvelopes = layout.clearance.envelopes;
	const clearanceIssues = layout.clearance.issues;

	checksum.addNumbers([
		layout.revision,
		layout.valid ? 1 : 0,
		layout.diagnostics.length,
		paths.pathCount,
		paths.pointCount,
		paths.sharedSegmentCount,
		paths.totalLengthMeters,
		paths.totalRouteLengthMeters,
		profiles.count,
		remap.count,
		remap.sourcePathCount,
		turnouts.count,
		advancedSwitches.count,
		clearanceEnvelopes.profileVersion,
		clearanceEnvelopes.count,
		clearanceIssues.count,
		clearanceIssues.candidateEnvelopePairs,
		clearanceIssues.testedEnvelopePairs,
		layout.junctions.length,
		layout.terminals.length,
	]);
	checksum.addStrings([clearanceEnvelopes.profileId]);

	const views = [
		paths.positions,
		paths.tangents,
		paths.distances,
		paths.offsets,
		paths.kinds,
		paths.cells,
		paths.exitCells,
		paths.fromDirections,
		paths.toDirections,
		paths.lengths,
		paths.bounds,
		paths.startInsets,
		paths.endInsets,
		paths.startExtensions,
		paths.endExtensions,
		paths.coverageOffsets,
		paths.coverageCells,
		paths.sharedSegmentOffsets,
		paths.sharedSegmentIds,
		paths.sharedSegmentStarts,
		paths.sharedSegmentEnds,
		paths.sourceKinds,
		paths.advancedSwitchIds,
		paths.advancedSwitchProfileClasses,
		paths.advancedSwitchSegmentRoles,
		paths.advancedSwitchSegmentPorts,
		paths.advancedSwitchSegmentOrdinals,
		paths.advancedSwitchCatalogProfiles,
		paths.explicitAdjacencyOffsets,
		paths.explicitAdjacencyTargets,
		profiles.pathIndices,
		profiles.advancedSwitchIds,
		profiles.types,
		profiles.geometryKinds,
		profiles.fitKinds,
		profiles.nominalProfileIndices,
		profiles.lateralSideSigns,
		profiles.compiledRadiusMillimeters,
		profiles.compiledTurnAngleTenths,
		profiles.compiledLeadInMillimeters,
		profiles.compiledLeadOutMillimeters,
		profiles.compiledMiddleMillimeters,
		profiles.compiledLengthMillimeters,
		profiles.leadInResidualMillimeters,
		profiles.leadOutResidualMillimeters,
		profiles.middleResidualMillimeters,
		profiles.lengthResidualMillimeters,
		profiles.forwardFitDeltaMillimeters,
		profiles.lateralFitDeltaMillimeters,
		profiles.fitReasonMasks,
		profiles.controlOffsets,
		profiles.controlPoints,
		profiles.controlDistances,
		profiles.controlRoles,
		profiles.memberOffsets,
		profiles.memberPathIndices,
		remap.sourcePathCells,
		remap.sourcePathKinds,
		remap.sourcePathFromDirections,
		remap.sourcePathToDirections,
		remap.sourceIdentityKinds,
		remap.sourceAdvancedSwitchIds,
		remap.sourceAdvancedSwitchProfileClasses,
		remap.sourceAdvancedSwitchRoles,
		remap.sourceAdvancedSwitchPorts,
		remap.sourceAdvancedSwitchSegmentOrdinals,
		remap.sourcePathCanonicalStarts,
		remap.sourcePathLengths,
		remap.sourcePathOffsets,
		remap.sourceStarts,
		remap.sourceEnds,
		remap.targetPathIndices,
		remap.targetStarts,
		remap.targetEnds,
		remap.mappingKinds,
		remap.projectionErrors,
		turnouts.kinds,
		turnouts.anchors,
		turnouts.leadInMillimeters,
		turnouts.leadOutMillimeters,
		turnouts.radiusMillimeters,
		turnouts.reservedOffsets,
		turnouts.reservedCells,
		turnouts.pathOffsets,
		turnouts.pathIndices,
		turnouts.clearancePathOffsets,
		turnouts.clearancePathIndices,
		turnouts.clearancePathStarts,
		turnouts.clearancePathEnds,
		turnouts.bounds,
		advancedSwitches.ids,
		advancedSwitches.profileClasses,
		advancedSwitches.origins,
		advancedSwitches.forwardDirections,
		advancedSwitches.lateralDirections,
		advancedSwitches.movementMasks,
		advancedSwitches.portOffsets,
		advancedSwitches.portRoles,
		advancedSwitches.portLocalIndices,
		advancedSwitches.portCells,
		advancedSwitches.portDirections,
		advancedSwitches.portPathIndices,
		advancedSwitches.portPathStations,
		advancedSwitches.movementOffsets,
		advancedSwitches.movementInputIndices,
		advancedSwitches.movementOutputIndices,
		advancedSwitches.movementPathOffsets,
		advancedSwitches.movementPathIndices,
		advancedSwitches.movementPathStarts,
		advancedSwitches.movementPathEnds,
		advancedSwitches.movementConflictOffsets,
		advancedSwitches.movementConflictIntervalIndices,
		advancedSwitches.claimedOffsets,
		advancedSwitches.claimedCells,
		advancedSwitches.reservedOffsets,
		advancedSwitches.reservedCells,
		advancedSwitches.mergeAnchors,
		advancedSwitches.branchAnchors,
		advancedSwitches.sharedThroatCells,
		advancedSwitches.sharedThroatLengthsMeters,
		advancedSwitches.sharedSupportLengthsMeters,
		advancedSwitches.mergeSharedLeadMeters,
		advancedSwitches.clearTrunkMeters,
		advancedSwitches.branchSharedLeadMeters,
		advancedSwitches.conflictZoneIds,
		advancedSwitches.conflictZoneLengthsMeters,
		advancedSwitches.conflictPathOffsets,
		advancedSwitches.conflictPathIndices,
		advancedSwitches.conflictPathStarts,
		advancedSwitches.conflictPathEnds,
		advancedSwitches.conflictIntervalKinds,
		advancedSwitches.conflictRouteIndices,
		advancedSwitches.conflictBounds,
		advancedSwitches.bounds,
		clearanceEnvelopes.pathOffsets,
		clearanceEnvelopes.pathIndices,
		clearanceEnvelopes.pointIndices,
		clearanceEnvelopes.stationStarts,
		clearanceEnvelopes.stationEnds,
		clearanceEnvelopes.startPoints,
		clearanceEnvelopes.endPoints,
		clearanceEnvelopes.bounds,
		clearanceEnvelopes.beamRadiusMillimeters,
		clearanceEnvelopes.ohtSweepRadiusMillimeters,
		clearanceEnvelopes.installationRadiusMillimeters,
		clearanceEnvelopes.approximationToleranceMillimeters,
		clearanceIssues.codes,
		clearanceIssues.relations,
		clearanceIssues.firstPathIndices,
		clearanceIssues.secondPathIndices,
		clearanceIssues.firstPathIdentities,
		clearanceIssues.secondPathIdentities,
		clearanceIssues.firstEnvelopeIndices,
		clearanceIssues.secondEnvelopeIndices,
		clearanceIssues.firstStations,
		clearanceIssues.secondStations,
		clearanceIssues.contactPoints,
		clearanceIssues.centerlineDistances,
		clearanceIssues.requiredClearances,
		clearanceIssues.penetrationDepths,
		clearanceIssues.cells,
	] satisfies readonly ArrayBufferView[];
	return { checksum, views };
}

function finishRailPhysicalLayoutChecksum(
	checksum: OrderedTypedChecksum,
	layout: CompiledPhysicalLayout,
): void {
	for (const junction of layout.junctions) {
		addRailPhysicalJunctionChecksum(checksum, junction);
	}
	for (const terminal of layout.terminals) checksum.addNumbers([terminal.x, terminal.y]);
}

async function finishRailPhysicalLayoutChecksumCooperatively(
	checksum: OrderedTypedChecksum,
	layout: CompiledPhysicalLayout,
	checkpoint: () => Promise<void>,
): Promise<void> {
	let rows = 0;
	for (const junction of layout.junctions) {
		addRailPhysicalJunctionChecksum(checksum, junction);
		rows++;
		if ((rows & 127) === 0) await checkpoint();
	}
	for (const terminal of layout.terminals) {
		checksum.addNumbers([terminal.x, terminal.y]);
		rows++;
		if ((rows & 127) === 0) await checkpoint();
	}
}

function addRailPhysicalJunctionChecksum(
	checksum: OrderedTypedChecksum,
	junction: CompiledJunction,
): void {
	checksum.addNumbers([
		junction.type === "BRANCH" ? 1 : 2,
		junction.cell.x,
		junction.cell.y,
		junction.incoming,
		junction.outgoing,
		junction.through.incoming,
		junction.through.outgoing,
		junction.divergingSide,
		junction.tangentSide,
		junction.leadInMillimeters,
		junction.leadOutMillimeters,
		junction.radiusMillimeters,
		junction.trunkPathIndex,
		junction.divergePathIndex,
		junction.advancedSwitchId ?? 0,
	]);
}

export function checksumPhysicalPathMigration(
	migration: CompiledPhysicalPathMigration,
	from: RailPhysicalLayoutIdentity,
	to: RailPhysicalLayoutIdentity,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		from.sequence,
		from.revision,
		to.sequence,
		to.revision,
		migration.fromRevision,
		migration.toRevision,
		migration.sourcePathCount,
		migration.targetPathCount,
		migration.count,
		migration.matchedRawPathCount,
		migration.mappedLengthMeters,
		migration.unmappableLengthMeters,
		migration.unmappableSourcePathCount,
	]);
	checksum.addStrings([from.fingerprint, to.fingerprint]);
	checksum.addViews([
		migration.sourcePathLengths,
		migration.sourcePathOffsets,
		migration.sourceStarts,
		migration.sourceEnds,
		migration.targetPathIndices,
		migration.targetStarts,
		migration.targetEnds,
		migration.mappingKinds,
		migration.endpointErrors,
	]);
	return checksum.digest();
}
