import type { Direction } from "../core/railShape";
import {
	type CompiledPathIntervalRemap,
	NO_PATH_INTERVAL_TARGET,
	PATH_INTERVAL_MAPPING_KIND,
	PATH_SOURCE_IDENTITY_KIND,
} from "./CompoundPhysicalPath";
import { PATH_KIND } from "./PhysicalPathCompiler";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";

export const NO_MIGRATION_TARGET_PATH = 0xffffffff;

export const PHYSICAL_PATH_MIGRATION_KIND = {
	IDENTITY: 0,
	TRANSLATION: 1,
	MONOTONIC_PROJECTION: 2,
	DELETED: 3,
	UNMAPPABLE: 4,
} as const;

export type PhysicalPathMigrationKind =
	(typeof PHYSICAL_PATH_MIGRATION_KIND)[keyof typeof PHYSICAL_PATH_MIGRATION_KIND];

type RouteEnd = 0 | Direction;
declare const rawCellRouteKeyBrand: unique symbol;
export type RawCellRouteKey = bigint & { readonly [rawCellRouteKeyBrand]: true };

export interface DecodedRawCellRouteKey {
	x: number;
	y: number;
	from: number;
	to: number;
}

export interface CompiledPhysicalPathMigration {
	fromRevision: number;
	toRevision: number;
	sourcePathCount: number;
	targetPathCount: number;
	count: number;
	matchedRawPathCount: number;
	sourcePathLengths: Float32Array;
	sourcePathOffsets: Uint32Array;
	sourceStarts: Float32Array;
	sourceEnds: Float32Array;
	targetPathIndices: Uint32Array;
	targetStarts: Float32Array;
	targetEnds: Float32Array;
	mappingKinds: Uint8Array;
	endpointErrors: Float32Array;
	mappedLengthMeters: number;
	unmappableLengthMeters: number;
	unmappableSourcePathCount: number;
}

interface MigrationCandidate {
	sourcePathIndex: number;
	sourceStart: number;
	sourceEnd: number;
	targetPathIndex: number;
	targetStart: number;
	targetEnd: number;
	mappingKind: PhysicalPathMigrationKind;
	endpointError: number;
}

const EPSILON = 1e-5;
const MAX_ROUTE_END = 0x0f;

/** Exact, collision-free identity for one directed raw route in an authored cell. */
export function rawCellRouteKey(
	x: number,
	y: number,
	from: RouteEnd,
	to: RouteEnd,
): RawCellRouteKey | null {
	if (!Number.isInteger(x) || x < -0x80000000 || x > 0x7fffffff) {
		throw new Error(`Raw route x coordinate ${x} is outside signed int32 range.`);
	}
	if (!Number.isInteger(y) || y < -0x80000000 || y > 0x7fffffff) {
		throw new Error(`Raw route y coordinate ${y} is outside signed int32 range.`);
	}
	if (!isRouteEnd(from)) {
		throw new Error(`Raw route entry ${from} is not a cardinal direction.`);
	}
	if (!isRouteEnd(to)) {
		throw new Error(`Raw route exit ${to} is not a cardinal direction.`);
	}
	if (from === 0 && to === 0) return null;
	const routeCode = (from << 4) | to;
	return ((BigInt(x >>> 0) << 40n) |
		(BigInt(y >>> 0) << 8n) |
		BigInt(routeCode)) as RawCellRouteKey;
}

export function decodeRawCellRouteKey(key: RawCellRouteKey): DecodedRawCellRouteKey {
	const x = Number((key >> 40n) & 0xffffffffn) | 0;
	const y = Number((key >> 8n) & 0xffffffffn) | 0;
	const routeCode = Number(key & 0xffn);
	return { x, y, from: routeCode >> 4, to: routeCode & MAX_ROUTE_END };
}

/** Compose previous raw-to-final and next raw-to-final maps through stable raw route identity. */
export function compilePhysicalPathMigration(
	previous: CompiledPhysicalLayout,
	next: CompiledPhysicalLayout,
): CompiledPhysicalPathMigration {
	validateRemap(previous);
	validateRemap(next);
	const previousRemap = previous.pathIntervalRemap;
	const nextRemap = next.pathIntervalRemap;
	const previousRawPathByKey = indexRawPaths(previousRemap);
	const nextRawPathByKey = indexRawPaths(nextRemap);
	const nextStraightPathByTerminalAlias = indexStraightTerminalAliases(nextRemap);
	const previousAdvancedPathIdentities = indexAdvancedSwitchPathIdentities(previous);
	const nextAdvancedPathIdentities = indexAdvancedSwitchPathIdentities(next);
	const nextAdvancedIdentities = new Set(nextAdvancedPathIdentities.values());
	const forcedUnmappableSourcePaths = new Set(
		[...previousAdvancedPathIdentities]
			.filter(([, identity]) => !nextAdvancedIdentities.has(identity))
			.map(([pathIndex]) => pathIndex),
	);
	const candidatesBySource = Array.from(
		{ length: previous.paths.pathCount },
		() => [] as MigrationCandidate[],
	);
	const matchedPreviousRawPaths = new Set<number>();
	const previousSyntheticPaths = indexSyntheticSourcePaths(previousRemap);
	const nextSyntheticPaths = indexSyntheticSourcePaths(nextRemap);

	for (const [key, previousRawPath] of previousRawPathByKey) {
		const nextRawPath = nextRawPathByKey.get(key);
		if (nextRawPath === undefined) continue;
		matchedPreviousRawPaths.add(previousRawPath);
		appendRawPathCandidates(
			candidatesBySource,
			previous,
			previousRawPath,
			next,
			nextRawPath,
			previousAdvancedPathIdentities,
			nextAdvancedPathIdentities,
		);
	}
	for (const [key, previousSyntheticPath] of previousSyntheticPaths) {
		const nextSyntheticPath = nextSyntheticPaths.get(key);
		if (nextSyntheticPath === undefined) continue;
		matchedPreviousRawPaths.add(previousSyntheticPath);
		appendRawPathCandidates(
			candidatesBySource,
			previous,
			previousSyntheticPath,
			next,
			nextSyntheticPath,
			previousAdvancedPathIdentities,
			nextAdvancedPathIdentities,
		);
	}
	for (const [key, previousRawPath] of previousRawPathByKey) {
		if (matchedPreviousRawPaths.has(previousRawPath)) continue;
		if (isTerminalRawPath(previousRemap, previousRawPath)) {
			const nextRawPath = nextStraightPathByTerminalAlias.get(key);
			if (nextRawPath === undefined) continue;
			matchedPreviousRawPaths.add(previousRawPath);
			appendRawPathCandidates(
				candidatesBySource,
				previous,
				previousRawPath,
				next,
				nextRawPath,
				previousAdvancedPathIdentities,
				nextAdvancedPathIdentities,
			);
			continue;
		}
		if (!isStraightRawPath(previousRemap, previousRawPath)) continue;
		for (const alias of straightTerminalAliasKeys(previousRemap, previousRawPath)) {
			const nextRawPath = nextRawPathByKey.get(alias);
			if (nextRawPath === undefined || !isTerminalRawPath(nextRemap, nextRawPath)) continue;
			matchedPreviousRawPaths.add(previousRawPath);
			appendRawPathCandidates(
				candidatesBySource,
				previous,
				previousRawPath,
				next,
				nextRawPath,
				previousAdvancedPathIdentities,
				nextAdvancedPathIdentities,
			);
		}
	}

	const migration = partitionMigration(
		previous,
		next,
		candidatesBySource,
		matchedPreviousRawPaths.size,
		forcedUnmappableSourcePaths,
	);
	validatePhysicalPathMigration(migration, previous, next);
	return migration;
}

export function emptyPhysicalPathMigration(revision: number): CompiledPhysicalPathMigration {
	return {
		fromRevision: revision,
		toRevision: revision,
		sourcePathCount: 0,
		targetPathCount: 0,
		count: 0,
		matchedRawPathCount: 0,
		sourcePathLengths: new Float32Array(),
		sourcePathOffsets: new Uint32Array(1),
		sourceStarts: new Float32Array(),
		sourceEnds: new Float32Array(),
		targetPathIndices: new Uint32Array(),
		targetStarts: new Float32Array(),
		targetEnds: new Float32Array(),
		mappingKinds: new Uint8Array(),
		endpointErrors: new Float32Array(),
		mappedLengthMeters: 0,
		unmappableLengthMeters: 0,
		unmappableSourcePathCount: 0,
	};
}

export function validatePhysicalPathMigration(
	migration: CompiledPhysicalPathMigration,
	previous?: CompiledPhysicalLayout,
	next?: CompiledPhysicalLayout,
): void {
	if (!Number.isSafeInteger(migration.fromRevision) || migration.fromRevision < 0) {
		throw new Error("Physical migration has an invalid source revision.");
	}
	if (!Number.isSafeInteger(migration.toRevision) || migration.toRevision < 0) {
		throw new Error("Physical migration has an invalid target revision.");
	}
	if (!Number.isSafeInteger(migration.sourcePathCount) || migration.sourcePathCount < 0) {
		throw new Error("Physical migration has an invalid source path count.");
	}
	if (!Number.isSafeInteger(migration.targetPathCount) || migration.targetPathCount < 0) {
		throw new Error("Physical migration has an invalid target path count.");
	}
	if (!Number.isSafeInteger(migration.count) || migration.count < 0) {
		throw new Error("Physical migration has an invalid row count.");
	}
	if (
		!Number.isSafeInteger(migration.matchedRawPathCount) ||
		migration.matchedRawPathCount < 0 ||
		!Number.isSafeInteger(migration.unmappableSourcePathCount) ||
		migration.unmappableSourcePathCount < 0 ||
		!Number.isFinite(migration.mappedLengthMeters) ||
		migration.mappedLengthMeters < 0 ||
		!Number.isFinite(migration.unmappableLengthMeters) ||
		migration.unmappableLengthMeters < 0
	) {
		throw new Error("Physical migration has invalid aggregate metrics.");
	}
	if (
		migration.sourcePathLengths.length !== migration.sourcePathCount ||
		migration.sourcePathOffsets.length !== migration.sourcePathCount + 1
	) {
		throw new Error("Physical migration source buffers do not match the source path count.");
	}
	const rowBuffers: readonly ArrayLike<number>[] = [
		migration.sourceStarts,
		migration.sourceEnds,
		migration.targetPathIndices,
		migration.targetStarts,
		migration.targetEnds,
		migration.mappingKinds,
		migration.endpointErrors,
	];
	if (rowBuffers.some((buffer) => buffer.length !== migration.count)) {
		throw new Error("Physical migration row buffers do not match the row count.");
	}
	if (previous) {
		if (
			migration.fromRevision !== previous.revision ||
			migration.sourcePathCount !== previous.paths.pathCount
		) {
			throw new Error("Physical migration does not identify its source layout.");
		}
		if (migration.matchedRawPathCount > previous.pathIntervalRemap.sourcePathCount) {
			throw new Error("Physical migration matched raw path count exceeds its source layout.");
		}
		for (let sourcePathIndex = 0; sourcePathIndex < migration.sourcePathCount; sourcePathIndex++) {
			if (
				Math.abs(
					(migration.sourcePathLengths[sourcePathIndex] as number) -
						(previous.paths.lengths[sourcePathIndex] as number),
				) > EPSILON
			) {
				throw new Error(
					`Physical migration source path ${sourcePathIndex} length does not match its source layout.`,
				);
			}
		}
	}
	if (next) {
		if (
			migration.toRevision !== next.revision ||
			migration.targetPathCount !== next.paths.pathCount
		) {
			throw new Error("Physical migration does not identify its target layout.");
		}
	}

	if (migration.sourcePathOffsets[0] !== 0) {
		throw new Error("Physical migration source offsets must begin at zero.");
	}
	let mappedLengthMeters = 0;
	let unmappableLengthMeters = 0;
	let unmappableSourcePathCount = 0;
	for (let sourcePathIndex = 0; sourcePathIndex < migration.sourcePathCount; sourcePathIndex++) {
		const sourceLength = migration.sourcePathLengths[sourcePathIndex] as number;
		if (!Number.isFinite(sourceLength) || sourceLength < 0) {
			throw new Error(`Physical migration source path ${sourcePathIndex} has invalid length.`);
		}
		const rowStart = migration.sourcePathOffsets[sourcePathIndex] as number;
		const rowEnd = migration.sourcePathOffsets[sourcePathIndex + 1] as number;
		if (rowStart > rowEnd || rowEnd > migration.count) {
			throw new Error(`Physical migration source path ${sourcePathIndex} has invalid offsets.`);
		}
		if (sourceLength <= EPSILON && rowStart !== rowEnd) {
			throw new Error(`Zero-length physical source path ${sourcePathIndex} owns migration rows.`);
		}
		let cursor = 0;
		let hasUnmappable = false;
		for (let row = rowStart; row < rowEnd; row++) {
			const sourceStart = migration.sourceStarts[row] as number;
			const sourceEnd = migration.sourceEnds[row] as number;
			const targetPathIndex = migration.targetPathIndices[row] as number;
			const targetStart = migration.targetStarts[row] as number;
			const targetEnd = migration.targetEnds[row] as number;
			const mappingKind = migration.mappingKinds[row] as number;
			const endpointError = migration.endpointErrors[row] as number;
			if (
				!Number.isFinite(sourceStart) ||
				!Number.isFinite(sourceEnd) ||
				!Number.isFinite(targetStart) ||
				!Number.isFinite(targetEnd) ||
				!Number.isFinite(endpointError) ||
				endpointError < 0
			) {
				throw new Error(`Physical migration row ${row} contains a non-finite station.`);
			}
			if (Math.abs(sourceStart - cursor) > EPSILON || sourceEnd <= sourceStart + EPSILON) {
				throw new Error(`Physical migration row ${row} breaks the source partition.`);
			}
			if (sourceEnd > sourceLength + EPSILON) {
				throw new Error(`Physical migration row ${row} exceeds its source path length.`);
			}
			const hasTarget = targetPathIndex !== NO_MIGRATION_TARGET_PATH;
			const noTargetKind =
				mappingKind === PHYSICAL_PATH_MIGRATION_KIND.DELETED ||
				mappingKind === PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE;
			if (hasTarget === noTargetKind) {
				throw new Error(`Physical migration row ${row} has inconsistent target semantics.`);
			}
			const span = sourceEnd - sourceStart;
			if (!hasTarget) {
				if (targetStart !== 0 || targetEnd !== 0) {
					throw new Error(`Targetless physical migration row ${row} has target stations.`);
				}
				unmappableLengthMeters += span;
				hasUnmappable = true;
			} else {
				if (
					targetPathIndex >= migration.targetPathCount ||
					targetStart < -EPSILON ||
					targetEnd <= targetStart + EPSILON
				) {
					throw new Error(`Physical migration row ${row} has an invalid target interval.`);
				}
				if (next && targetEnd > (next.paths.lengths[targetPathIndex] as number) + EPSILON) {
					throw new Error(`Physical migration row ${row} exceeds its target path length.`);
				}
				if (
					mappingKind !== PHYSICAL_PATH_MIGRATION_KIND.IDENTITY &&
					mappingKind !== PHYSICAL_PATH_MIGRATION_KIND.TRANSLATION &&
					mappingKind !== PHYSICAL_PATH_MIGRATION_KIND.MONOTONIC_PROJECTION
				) {
					throw new Error(`Physical migration row ${row} has an unknown mapping kind.`);
				}
				if (
					mappingKind === PHYSICAL_PATH_MIGRATION_KIND.IDENTITY &&
					(Math.abs(sourceStart - targetStart) > EPSILON ||
						Math.abs(sourceEnd - targetEnd) > EPSILON)
				) {
					throw new Error(`Physical migration row ${row} violates identity mapping semantics.`);
				}
				if (
					mappingKind === PHYSICAL_PATH_MIGRATION_KIND.TRANSLATION &&
					Math.abs(sourceEnd - sourceStart - (targetEnd - targetStart)) > EPSILON
				) {
					throw new Error(`Physical migration row ${row} violates translation semantics.`);
				}
				mappedLengthMeters += span;
			}
			cursor = sourceEnd;
		}
		if (sourceLength > EPSILON && Math.abs(cursor - sourceLength) > EPSILON) {
			throw new Error(
				`Physical migration source path ${sourcePathIndex} is not fully partitioned.`,
			);
		}
		if (hasUnmappable) unmappableSourcePathCount++;
	}
	if ((migration.sourcePathOffsets[migration.sourcePathCount] as number) !== migration.count) {
		throw new Error("Physical migration source offsets do not terminate at the row count.");
	}
	if (
		Math.abs(mappedLengthMeters - migration.mappedLengthMeters) > EPSILON ||
		Math.abs(unmappableLengthMeters - migration.unmappableLengthMeters) > EPSILON ||
		unmappableSourcePathCount !== migration.unmappableSourcePathCount
	) {
		throw new Error("Physical migration aggregate metrics do not match its rows.");
	}
}

function appendRawPathCandidates(
	candidatesBySource: MigrationCandidate[][],
	previous: CompiledPhysicalLayout,
	previousRawPath: number,
	next: CompiledPhysicalLayout,
	nextRawPath: number,
	previousAdvancedPathIdentities: ReadonlyMap<number, string>,
	nextAdvancedPathIdentities: ReadonlyMap<number, string>,
): void {
	const previousRemap = previous.pathIntervalRemap;
	const nextRemap = next.pathIntervalRemap;
	const previousCanonicalStart = previousRemap.sourcePathCanonicalStarts[previousRawPath] as number;
	const nextCanonicalStart = nextRemap.sourcePathCanonicalStarts[nextRawPath] as number;
	let previousRow = previousRemap.sourcePathOffsets[previousRawPath] as number;
	const previousEnd = previousRemap.sourcePathOffsets[previousRawPath + 1] as number;
	let nextRow = nextRemap.sourcePathOffsets[nextRawPath] as number;
	const nextEnd = nextRemap.sourcePathOffsets[nextRawPath + 1] as number;

	while (previousRow < previousEnd && nextRow < nextEnd) {
		const previousStartCanonical =
			previousCanonicalStart + (previousRemap.sourceStarts[previousRow] as number);
		const previousEndCanonical =
			previousCanonicalStart + (previousRemap.sourceEnds[previousRow] as number);
		const nextStartCanonical = nextCanonicalStart + (nextRemap.sourceStarts[nextRow] as number);
		const nextEndCanonical = nextCanonicalStart + (nextRemap.sourceEnds[nextRow] as number);
		const overlapStart = Math.max(previousStartCanonical, nextStartCanonical);
		const overlapEnd = Math.min(previousEndCanonical, nextEndCanonical);

		if (overlapEnd - overlapStart > EPSILON) {
			const sourceStart = mapRemapDistance(
				previousRemap,
				previousRow,
				overlapStart - previousCanonicalStart,
			);
			const sourceEnd = mapRemapDistance(
				previousRemap,
				previousRow,
				overlapEnd - previousCanonicalStart,
			);
			const sourcePathIndex = previousRemap.targetPathIndices[previousRow] as number;
			const previousKind = previousRemap.mappingKinds[previousRow] as number;
			const nextKind = nextRemap.mappingKinds[nextRow] as number;
			const endpointError =
				(previousRemap.projectionErrors[previousRow] as number) +
				(nextRemap.projectionErrors[nextRow] as number);
			if (
				previousKind === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE ||
				nextKind === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE
			) {
				candidatesBySource[sourcePathIndex]?.push(
					targetlessCandidate(
						sourcePathIndex,
						sourceStart,
						sourceEnd,
						PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE,
						endpointError,
					),
				);
			} else {
				const targetStart = mapRemapDistance(nextRemap, nextRow, overlapStart - nextCanonicalStart);
				const targetEnd = mapRemapDistance(nextRemap, nextRow, overlapEnd - nextCanonicalStart);
				const targetPathIndex = nextRemap.targetPathIndices[nextRow] as number;
				if (sourceEnd - sourceStart > EPSILON && targetEnd - targetStart > EPSILON) {
					const sourceIdentity = previousAdvancedPathIdentities.get(sourcePathIndex);
					const targetIdentity = nextAdvancedPathIdentities.get(targetPathIndex);
					if (sourceIdentity !== targetIdentity && (sourceIdentity || targetIdentity)) {
						candidatesBySource[sourcePathIndex]?.push(
							targetlessCandidate(
								sourcePathIndex,
								sourceStart,
								sourceEnd,
								PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE,
								endpointError,
							),
						);
					} else {
						candidatesBySource[sourcePathIndex]?.push({
							sourcePathIndex,
							sourceStart,
							sourceEnd,
							targetPathIndex,
							targetStart,
							targetEnd,
							mappingKind: classifyMapping(
								sourceStart,
								sourceEnd,
								targetStart,
								targetEnd,
								previousKind,
								nextKind,
							),
							endpointError,
						});
					}
				}
			}
		}

		if (previousEndCanonical <= nextEndCanonical + EPSILON) previousRow++;
		if (nextEndCanonical <= previousEndCanonical + EPSILON) nextRow++;
	}
}

function indexAdvancedSwitchPathIdentities(layout: CompiledPhysicalLayout): Map<number, string> {
	const identitiesByPath = new Map<number, string[]>();
	for (let switchIndex = 0; switchIndex < layout.advancedSwitches.count; switchIndex++) {
		const signature = advancedSwitchStructureSignature(layout, switchIndex);
		const ownedPaths = collectAdvancedSwitchOwnedPaths(layout, switchIndex);
		for (const pathIndex of ownedPaths) {
			const identities = identitiesByPath.get(pathIndex);
			if (identities) identities.push(signature);
			else identitiesByPath.set(pathIndex, [signature]);
		}
	}
	return new Map(
		[...identitiesByPath].map(([pathIndex, identities]) => [
			pathIndex,
			identities.sort().join("|"),
		]),
	);
}

function collectAdvancedSwitchOwnedPaths(
	layout: CompiledPhysicalLayout,
	switchIndex: number,
): Set<number> {
	const switches = layout.advancedSwitches;
	const result = new Set<number>();
	const portStart = switches.portOffsets[switchIndex] as number;
	const portEnd = switches.portOffsets[switchIndex + 1] as number;
	for (let row = portStart; row < portEnd; row++)
		result.add(switches.portPathIndices[row] as number);
	const movementStart = switches.movementOffsets[switchIndex] as number;
	const movementEnd = switches.movementOffsets[switchIndex + 1] as number;
	for (let movement = movementStart; movement < movementEnd; movement++) {
		const rowStart = switches.movementPathOffsets[movement] as number;
		const rowEnd = switches.movementPathOffsets[movement + 1] as number;
		for (let row = rowStart; row < rowEnd; row++) {
			result.add(switches.movementPathIndices[row] as number);
		}
	}
	const conflictStart = switches.conflictPathOffsets[switchIndex] as number;
	const conflictEnd = switches.conflictPathOffsets[switchIndex + 1] as number;
	for (let row = conflictStart; row < conflictEnd; row++) {
		result.add(switches.conflictPathIndices[row] as number);
	}
	const switchId = switches.ids[switchIndex] as number;
	for (let profile = 0; profile < layout.compoundProfiles.count; profile++) {
		if ((layout.compoundProfiles.advancedSwitchIds[profile] as number) === switchId) {
			result.add(layout.compoundProfiles.pathIndices[profile] as number);
		}
	}
	return result;
}

function advancedSwitchStructureSignature(
	layout: CompiledPhysicalLayout,
	switchIndex: number,
): string {
	const switches = layout.advancedSwitches;
	const tokens: string[] = ["advanced-switch-v3"];
	appendValues(tokens, switches.ids, switchIndex, switchIndex + 1);
	appendValues(tokens, switches.profileClasses, switchIndex, switchIndex + 1);
	appendValues(tokens, switches.origins, switchIndex * 2, switchIndex * 2 + 2);
	appendValues(tokens, switches.forwardDirections, switchIndex, switchIndex + 1);
	appendValues(tokens, switches.lateralDirections, switchIndex, switchIndex + 1);
	appendValues(tokens, switches.movementMasks, switchIndex, switchIndex + 1);
	appendValues(tokens, switches.mergeAnchors, switchIndex * 2, switchIndex * 2 + 2);
	appendValues(tokens, switches.branchAnchors, switchIndex * 2, switchIndex * 2 + 2);
	appendValues(tokens, switches.sharedThroatCells, switchIndex * 2, switchIndex * 2 + 2);
	for (const values of [
		switches.sharedThroatLengthsMeters,
		switches.sharedSupportLengthsMeters,
		switches.mergeSharedLeadMeters,
		switches.clearTrunkMeters,
		switches.branchSharedLeadMeters,
		switches.conflictZoneIds,
		switches.conflictZoneLengthsMeters,
	] as const) {
		appendValues(tokens, values, switchIndex, switchIndex + 1);
	}
	appendValues(tokens, switches.conflictBounds, switchIndex * 4, switchIndex * 4 + 4);
	appendValues(tokens, switches.bounds, switchIndex * 4, switchIndex * 4 + 4);

	const claimedStart = switches.claimedOffsets[switchIndex] as number;
	const claimedEnd = switches.claimedOffsets[switchIndex + 1] as number;
	appendValues(tokens, switches.claimedCells, claimedStart * 2, claimedEnd * 2);
	const reservedStart = switches.reservedOffsets[switchIndex] as number;
	const reservedEnd = switches.reservedOffsets[switchIndex + 1] as number;
	appendValues(tokens, switches.reservedCells, reservedStart * 2, reservedEnd * 2);

	const portStart = switches.portOffsets[switchIndex] as number;
	const portEnd = switches.portOffsets[switchIndex + 1] as number;
	for (let row = portStart; row < portEnd; row++) {
		appendValues(tokens, switches.portRoles, row, row + 1);
		appendValues(tokens, switches.portLocalIndices, row, row + 1);
		appendValues(tokens, switches.portCells, row * 2, row * 2 + 2);
		appendValues(tokens, switches.portDirections, row, row + 1);
		appendPortAuthoredSourceSignature(
			tokens,
			layout,
			switches.portCells[row * 2] as number,
			switches.portCells[row * 2 + 1] as number,
		);
		tokens.push(physicalPathSignature(layout, switches.portPathIndices[row] as number));
		appendValues(tokens, switches.portPathStations, row, row + 1);
	}

	const movementStart = switches.movementOffsets[switchIndex] as number;
	const movementEnd = switches.movementOffsets[switchIndex + 1] as number;
	for (let movement = movementStart; movement < movementEnd; movement++) {
		appendValues(tokens, switches.movementInputIndices, movement, movement + 1);
		appendValues(tokens, switches.movementOutputIndices, movement, movement + 1);
		const rowStart = switches.movementPathOffsets[movement] as number;
		const rowEnd = switches.movementPathOffsets[movement + 1] as number;
		for (let row = rowStart; row < rowEnd; row++) {
			tokens.push(physicalPathSignature(layout, switches.movementPathIndices[row] as number));
			appendValues(tokens, switches.movementPathStarts, row, row + 1);
			appendValues(tokens, switches.movementPathEnds, row, row + 1);
		}
		const referenceStart = switches.movementConflictOffsets[movement] as number;
		const referenceEnd = switches.movementConflictOffsets[movement + 1] as number;
		for (let row = referenceStart; row < referenceEnd; row++) {
			const conflictIndex = switches.movementConflictIntervalIndices[row] as number;
			appendConflictSignature(tokens, layout, conflictIndex);
		}
	}

	const conflictStart = switches.conflictPathOffsets[switchIndex] as number;
	const conflictEnd = switches.conflictPathOffsets[switchIndex + 1] as number;
	for (let row = conflictStart; row < conflictEnd; row++) {
		appendConflictSignature(tokens, layout, row);
	}

	const switchId = switches.ids[switchIndex] as number;
	for (let profile = 0; profile < layout.compoundProfiles.count; profile++) {
		if ((layout.compoundProfiles.advancedSwitchIds[profile] as number) !== switchId) continue;
		appendCompoundProfileSignature(tokens, layout, profile);
	}
	return tokens.join(";");
}

function appendPortAuthoredSourceSignature(
	tokens: string[],
	layout: CompiledPhysicalLayout,
	x: number,
	y: number,
): void {
	const remap = layout.pathIntervalRemap;
	const routes: string[] = [];
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		if (
			(remap.sourceIdentityKinds[sourcePathIndex] as number) !==
				PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL ||
			(remap.sourcePathCells[sourcePathIndex * 2] as number) !== x ||
			(remap.sourcePathCells[sourcePathIndex * 2 + 1] as number) !== y
		) {
			continue;
		}
		routes.push(
			[
				remap.sourcePathKinds[sourcePathIndex] as number,
				remap.sourcePathFromDirections[sourcePathIndex] as number,
				remap.sourcePathToDirections[sourcePathIndex] as number,
				numberToken(remap.sourcePathCanonicalStarts[sourcePathIndex] as number),
				numberToken(remap.sourcePathLengths[sourcePathIndex] as number),
			].join(":"),
		);
	}
	tokens.push(`port-source:${x}:${y}:${routes.sort().join("|")}`);
}

function appendConflictSignature(
	tokens: string[],
	layout: CompiledPhysicalLayout,
	conflictIndex: number,
): void {
	const switches = layout.advancedSwitches;
	tokens.push(physicalPathSignature(layout, switches.conflictPathIndices[conflictIndex] as number));
	for (const values of [
		switches.conflictPathStarts,
		switches.conflictPathEnds,
		switches.conflictIntervalKinds,
		switches.conflictRouteIndices,
	] as const) {
		appendValues(tokens, values, conflictIndex, conflictIndex + 1);
	}
}

function appendCompoundProfileSignature(
	tokens: string[],
	layout: CompiledPhysicalLayout,
	profileIndex: number,
): void {
	const profiles = layout.compoundProfiles;
	tokens.push(physicalPathSignature(layout, profiles.pathIndices[profileIndex] as number));
	for (const values of [
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
	] as const) {
		appendValues(tokens, values, profileIndex, profileIndex + 1);
	}
	const controlStart = profiles.controlOffsets[profileIndex] as number;
	const controlEnd = profiles.controlOffsets[profileIndex + 1] as number;
	appendValues(tokens, profiles.controlPoints, controlStart * 2, controlEnd * 2);
	appendValues(tokens, profiles.controlDistances, controlStart, controlEnd);
	appendValues(tokens, profiles.controlRoles, controlStart, controlEnd);
}

function physicalPathSignature(layout: CompiledPhysicalLayout, pathIndex: number): string {
	const paths = layout.paths;
	if (pathIndex < 0 || pathIndex >= paths.pathCount) return `invalid-path:${pathIndex}`;
	const tokens: string[] = ["path"];
	for (const values of [
		paths.kinds,
		paths.fromDirections,
		paths.toDirections,
		paths.lengths,
		paths.startInsets,
		paths.endInsets,
		paths.startExtensions,
		paths.endExtensions,
		paths.advancedSwitchCatalogProfiles,
	] as const) {
		appendValues(tokens, values, pathIndex, pathIndex + 1);
	}
	appendValues(tokens, paths.cells, pathIndex * 2, pathIndex * 2 + 2);
	appendValues(tokens, paths.exitCells, pathIndex * 2, pathIndex * 2 + 2);
	appendValues(tokens, paths.bounds, pathIndex * 4, pathIndex * 4 + 4);
	const pointStart = paths.offsets[pathIndex] as number;
	const pointEnd = paths.offsets[pathIndex + 1] as number;
	appendValues(tokens, paths.positions, pointStart * 2, pointEnd * 2);
	appendValues(tokens, paths.tangents, pointStart * 2, pointEnd * 2);
	appendValues(tokens, paths.distances, pointStart, pointEnd);
	const coverageStart = paths.coverageOffsets[pathIndex] as number;
	const coverageEnd = paths.coverageOffsets[pathIndex + 1] as number;
	appendValues(tokens, paths.coverageCells, coverageStart * 2, coverageEnd * 2);
	const sharedStart = paths.sharedSegmentOffsets[pathIndex] as number;
	const sharedEnd = paths.sharedSegmentOffsets[pathIndex + 1] as number;
	appendValues(tokens, paths.sharedSegmentStarts, sharedStart, sharedEnd);
	appendValues(tokens, paths.sharedSegmentEnds, sharedStart, sharedEnd);
	return tokens.join(",");
}

function appendValues(
	tokens: string[],
	values: ArrayLike<number>,
	start: number,
	end: number,
): void {
	tokens.push(`${end - start}[`);
	for (let index = start; index < end; index++) tokens.push(numberToken(values[index] as number));
	tokens.push("]");
}

function numberToken(value: number): string {
	return Number.isFinite(value) ? value.toPrecision(9) : String(value);
}

function partitionMigration(
	previous: CompiledPhysicalLayout,
	next: CompiledPhysicalLayout,
	candidatesBySource: MigrationCandidate[][],
	matchedRawPathCount: number,
	forcedUnmappableSourcePaths: ReadonlySet<number>,
): CompiledPhysicalPathMigration {
	const sourcePathOffsets = new Uint32Array(previous.paths.pathCount + 1);
	const sourceStarts: number[] = [];
	const sourceEnds: number[] = [];
	const targetPathIndices: number[] = [];
	const targetStarts: number[] = [];
	const targetEnds: number[] = [];
	const mappingKinds: number[] = [];
	const endpointErrors: number[] = [];
	let mappedLengthMeters = 0;
	let unmappableLengthMeters = 0;
	let unmappableSourcePathCount = 0;

	const append = (candidate: MigrationCandidate, pathRowStart: number): void => {
		const span = candidate.sourceEnd - candidate.sourceStart;
		if (span <= EPSILON) return;
		const previousRow = sourceStarts.length - 1;
		if (
			previousRow >= pathRowStart &&
			Math.abs((sourceEnds[previousRow] as number) - candidate.sourceStart) <= EPSILON &&
			(targetPathIndices[previousRow] as number) === candidate.targetPathIndex &&
			(mappingKinds[previousRow] as number) === candidate.mappingKind &&
			canMergeTargetInterval(
				previousRow,
				candidate,
				sourceStarts,
				sourceEnds,
				targetStarts,
				targetEnds,
			)
		) {
			sourceEnds[previousRow] = candidate.sourceEnd;
			if (candidate.targetPathIndex !== NO_MIGRATION_TARGET_PATH) {
				targetEnds[previousRow] = candidate.targetEnd;
			}
			endpointErrors[previousRow] = Math.max(
				endpointErrors[previousRow] as number,
				candidate.endpointError,
			);
		} else {
			sourceStarts.push(candidate.sourceStart);
			sourceEnds.push(candidate.sourceEnd);
			targetPathIndices.push(candidate.targetPathIndex);
			targetStarts.push(candidate.targetStart);
			targetEnds.push(candidate.targetEnd);
			mappingKinds.push(candidate.mappingKind);
			endpointErrors.push(candidate.endpointError);
		}
		if (candidate.targetPathIndex === NO_MIGRATION_TARGET_PATH) {
			unmappableLengthMeters += span;
		} else {
			mappedLengthMeters += span;
		}
	};

	for (let sourcePathIndex = 0; sourcePathIndex < previous.paths.pathCount; sourcePathIndex++) {
		const pathRowStart = sourceStarts.length;
		sourcePathOffsets[sourcePathIndex] = pathRowStart;
		const sourceLength = previous.paths.lengths[sourcePathIndex] as number;
		if (sourceLength <= EPSILON) continue;
		if (forcedUnmappableSourcePaths.has(sourcePathIndex)) {
			append(
				targetlessCandidate(
					sourcePathIndex,
					0,
					sourceLength,
					PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE,
				),
				pathRowStart,
			);
			unmappableSourcePathCount++;
			continue;
		}
		const candidates = candidatesBySource[sourcePathIndex] as MigrationCandidate[];
		candidates.sort(
			(left, right) =>
				left.sourceStart - right.sourceStart ||
				left.sourceEnd - right.sourceEnd ||
				left.targetPathIndex - right.targetPathIndex,
		);
		let cursor = 0;
		let hasUnmappable = false;
		for (const original of candidates) {
			const start = Math.max(0, original.sourceStart);
			const end = Math.min(sourceLength, original.sourceEnd);
			if (end <= start + EPSILON) continue;
			if (start < cursor - EPSILON) {
				throw new Error(`Physical migration candidates overlap on source path ${sourcePathIndex}.`);
			}
			if (start > cursor + EPSILON) {
				append(
					targetlessCandidate(sourcePathIndex, cursor, start, PHYSICAL_PATH_MIGRATION_KIND.DELETED),
					pathRowStart,
				);
				hasUnmappable = true;
				cursor = start;
			}
			const clipped = clipCandidate(original, Math.max(cursor, start), end);
			append(clipped, pathRowStart);
			if (clipped.targetPathIndex === NO_MIGRATION_TARGET_PATH) hasUnmappable = true;
			cursor = clipped.sourceEnd;
		}
		if (cursor < sourceLength - EPSILON) {
			append(
				targetlessCandidate(
					sourcePathIndex,
					cursor,
					sourceLength,
					PHYSICAL_PATH_MIGRATION_KIND.DELETED,
				),
				pathRowStart,
			);
			hasUnmappable = true;
		}
		if (hasUnmappable) unmappableSourcePathCount++;
	}
	sourcePathOffsets[previous.paths.pathCount] = sourceStarts.length;

	return {
		fromRevision: previous.revision,
		toRevision: next.revision,
		sourcePathCount: previous.paths.pathCount,
		targetPathCount: next.paths.pathCount,
		count: sourceStarts.length,
		matchedRawPathCount,
		sourcePathLengths: previous.paths.lengths.slice(),
		sourcePathOffsets,
		sourceStarts: new Float32Array(sourceStarts),
		sourceEnds: new Float32Array(sourceEnds),
		targetPathIndices: new Uint32Array(targetPathIndices),
		targetStarts: new Float32Array(targetStarts),
		targetEnds: new Float32Array(targetEnds),
		mappingKinds: new Uint8Array(mappingKinds),
		endpointErrors: new Float32Array(endpointErrors),
		mappedLengthMeters,
		unmappableLengthMeters,
		unmappableSourcePathCount,
	};
}

function validateRemap(layout: CompiledPhysicalLayout): void {
	const remap = layout.pathIntervalRemap;
	if (
		remap.sourcePathCells.length !== remap.sourcePathCount * 2 ||
		remap.sourcePathKinds.length !== remap.sourcePathCount ||
		remap.sourcePathFromDirections.length !== remap.sourcePathCount ||
		remap.sourcePathToDirections.length !== remap.sourcePathCount ||
		remap.sourceIdentityKinds.length !== remap.sourcePathCount ||
		remap.sourceAdvancedSwitchIds.length !== remap.sourcePathCount ||
		remap.sourceAdvancedSwitchProfileClasses.length !== remap.sourcePathCount ||
		remap.sourceAdvancedSwitchRoles.length !== remap.sourcePathCount ||
		remap.sourceAdvancedSwitchPorts.length !== remap.sourcePathCount ||
		remap.sourceAdvancedSwitchSegmentOrdinals.length !== remap.sourcePathCount ||
		remap.sourcePathCanonicalStarts.length !== remap.sourcePathCount ||
		remap.sourcePathLengths.length !== remap.sourcePathCount ||
		remap.sourcePathOffsets.length !== remap.sourcePathCount + 1
	) {
		throw new Error(`Physical layout revision ${layout.revision} has invalid raw path metadata.`);
	}
	if (
		remap.sourceStarts.length !== remap.count ||
		remap.sourceEnds.length !== remap.count ||
		remap.targetPathIndices.length !== remap.count ||
		remap.targetStarts.length !== remap.count ||
		remap.targetEnds.length !== remap.count ||
		remap.mappingKinds.length !== remap.count ||
		remap.projectionErrors.length !== remap.count
	) {
		throw new Error(`Physical layout revision ${layout.revision} has invalid remap buffers.`);
	}
	if (remap.sourcePathOffsets[0] !== 0) {
		throw new Error(`Physical layout revision ${layout.revision} has invalid remap offsets.`);
	}

	const targetIntervals = Array.from(
		{ length: layout.paths.pathCount },
		() => [] as Array<{ start: number; end: number }>,
	);
	for (let sourcePath = 0; sourcePath < remap.sourcePathCount; sourcePath++) {
		const sourceLength = remap.sourcePathLengths[sourcePath] as number;
		const canonicalStart = remap.sourcePathCanonicalStarts[sourcePath] as number;
		if (!Number.isFinite(sourceLength) || sourceLength < 0 || !Number.isFinite(canonicalStart)) {
			throw new Error(`Physical layout revision ${layout.revision} has invalid raw path stations.`);
		}
		const rowStart = remap.sourcePathOffsets[sourcePath] as number;
		const rowEnd = remap.sourcePathOffsets[sourcePath + 1] as number;
		if (rowStart > rowEnd || rowEnd > remap.count) {
			throw new Error(`Physical layout revision ${layout.revision} has invalid remap offsets.`);
		}
		if (sourceLength <= EPSILON && rowStart !== rowEnd) {
			throw new Error(
				`Physical layout revision ${layout.revision} assigns rows to zero-length raw path ${sourcePath}.`,
			);
		}
		let cursor = 0;
		for (let row = rowStart; row < rowEnd; row++) {
			const sourceStart = remap.sourceStarts[row] as number;
			const sourceEnd = remap.sourceEnds[row] as number;
			const targetPath = remap.targetPathIndices[row] as number;
			const targetStart = remap.targetStarts[row] as number;
			const targetEnd = remap.targetEnds[row] as number;
			const projectionError = remap.projectionErrors[row] as number;
			const mappingKind = remap.mappingKinds[row] as number;
			const targetSpan = targetEnd - targetStart;
			const targetless =
				mappingKind === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE &&
				targetPath === NO_PATH_INTERVAL_TARGET;
			if (
				!Number.isFinite(sourceStart) ||
				!Number.isFinite(sourceEnd) ||
				!Number.isFinite(targetStart) ||
				!Number.isFinite(targetEnd) ||
				!Number.isFinite(projectionError) ||
				projectionError < 0 ||
				mappingKind < PATH_INTERVAL_MAPPING_KIND.IDENTITY ||
				mappingKind > PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE ||
				(!targetless && targetPath >= layout.paths.pathCount) ||
				targetStart < -EPSILON ||
				(!targetless && targetEnd > (layout.paths.lengths[targetPath] as number) + EPSILON) ||
				(targetless && (Math.abs(targetStart) > EPSILON || Math.abs(targetEnd) > EPSILON)) ||
				targetSpan < -EPSILON ||
				(targetSpan <= EPSILON && mappingKind !== PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE) ||
				Math.abs(sourceStart - cursor) > EPSILON ||
				sourceEnd <= sourceStart + EPSILON
			) {
				throw new Error(
					`Physical layout revision ${layout.revision} has malformed remap row ${row}.`,
				);
			}
			cursor = sourceEnd;
			if (targetSpan > EPSILON) {
				targetIntervals[targetPath]?.push({ start: targetStart, end: targetEnd });
			}
		}
		if (sourceLength > EPSILON && Math.abs(cursor - sourceLength) > EPSILON) {
			throw new Error(
				`Physical layout revision ${layout.revision} does not partition raw path ${sourcePath}.`,
			);
		}
	}
	if ((remap.sourcePathOffsets[remap.sourcePathCount] as number) !== remap.count) {
		throw new Error(`Physical layout revision ${layout.revision} has unterminated remap offsets.`);
	}
	for (let targetPath = 0; targetPath < layout.paths.pathCount; targetPath++) {
		const targetLength = layout.paths.lengths[targetPath] as number;
		const intervals = targetIntervals[targetPath] as Array<{ start: number; end: number }>;
		if (!Number.isFinite(targetLength) || targetLength < 0) {
			throw new Error(`Physical layout revision ${layout.revision} has invalid final path length.`);
		}
		if (targetLength <= EPSILON && intervals.length > 0) {
			throw new Error(
				`Physical layout revision ${layout.revision} assigns rows to zero-length final path ${targetPath}.`,
			);
		}
		intervals.sort((left, right) => left.start - right.start || left.end - right.end);
		let cursor = 0;
		for (const interval of intervals) {
			if (Math.abs(interval.start - cursor) > EPSILON || interval.end <= interval.start + EPSILON) {
				throw new Error(
					`Physical layout revision ${layout.revision} does not uniquely cover final path ${targetPath}.`,
				);
			}
			cursor = interval.end;
		}
		if (targetLength > EPSILON && Math.abs(cursor - targetLength) > EPSILON) {
			throw new Error(
				`Physical layout revision ${layout.revision} does not cover final path ${targetPath}.`,
			);
		}
	}
}

function indexRawPaths(remap: CompiledPathIntervalRemap): Map<RawCellRouteKey, number> {
	const index = new Map<RawCellRouteKey, number>();
	for (let pathIndex = 0; pathIndex < remap.sourcePathCount; pathIndex++) {
		if (
			(remap.sourceIdentityKinds[pathIndex] as number) !== PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL
		) {
			continue;
		}
		const offset = pathIndex * 2;
		const key = rawCellRouteKey(
			remap.sourcePathCells[offset] as number,
			remap.sourcePathCells[offset + 1] as number,
			remap.sourcePathFromDirections[pathIndex] as RouteEnd,
			remap.sourcePathToDirections[pathIndex] as RouteEnd,
		);
		if (key === null) continue;
		if (index.has(key)) throw new Error(`Duplicate stable raw path key ${key.toString(16)}.`);
		index.set(key, pathIndex);
	}
	return index;
}

function indexSyntheticSourcePaths(remap: CompiledPathIntervalRemap): Map<string, number> {
	const index = new Map<string, number>();
	for (let pathIndex = 0; pathIndex < remap.sourcePathCount; pathIndex++) {
		if (
			(remap.sourceIdentityKinds[pathIndex] as number) !==
			PATH_SOURCE_IDENTITY_KIND.ADVANCED_SWITCH_SEGMENT
		) {
			continue;
		}
		const key = [
			remap.sourceAdvancedSwitchIds[pathIndex] as number,
			remap.sourceAdvancedSwitchProfileClasses[pathIndex] as number,
			remap.sourceAdvancedSwitchRoles[pathIndex] as number,
			remap.sourceAdvancedSwitchPorts[pathIndex] as number,
			remap.sourceAdvancedSwitchSegmentOrdinals[pathIndex] as number,
		].join(":");
		if (index.has(key)) throw new Error(`Duplicate synthetic path identity ${key}.`);
		index.set(key, pathIndex);
	}
	return index;
}

function indexStraightTerminalAliases(
	remap: CompiledPathIntervalRemap,
): Map<RawCellRouteKey, number> {
	const index = new Map<RawCellRouteKey, number>();
	for (let pathIndex = 0; pathIndex < remap.sourcePathCount; pathIndex++) {
		if (
			(remap.sourceIdentityKinds[pathIndex] as number) !== PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL
		) {
			continue;
		}
		if (!isStraightRawPath(remap, pathIndex)) continue;
		for (const key of straightTerminalAliasKeys(remap, pathIndex)) {
			if (index.has(key)) {
				throw new Error(`Duplicate straight terminal alias ${key.toString(16)}.`);
			}
			index.set(key, pathIndex);
		}
	}
	return index;
}

function straightTerminalAliasKeys(
	remap: CompiledPathIntervalRemap,
	pathIndex: number,
): readonly RawCellRouteKey[] {
	const offset = pathIndex * 2;
	const x = remap.sourcePathCells[offset] as number;
	const y = remap.sourcePathCells[offset + 1] as number;
	const from = remap.sourcePathFromDirections[pathIndex] as RouteEnd;
	const to = remap.sourcePathToDirections[pathIndex] as RouteEnd;
	const entry = rawCellRouteKey(x, y, from, 0);
	const exit = rawCellRouteKey(x, y, 0, to);
	return [entry, exit].filter((key): key is RawCellRouteKey => key !== null);
}

function isTerminalRawPath(remap: CompiledPathIntervalRemap, pathIndex: number): boolean {
	return (
		remap.sourcePathKinds[pathIndex] === PATH_KIND.TERMINAL &&
		(remap.sourcePathFromDirections[pathIndex] === 0) !==
			(remap.sourcePathToDirections[pathIndex] === 0)
	);
}

function isStraightRawPath(remap: CompiledPathIntervalRemap, pathIndex: number): boolean {
	const kind = remap.sourcePathKinds[pathIndex] as number;
	return (
		(kind === PATH_KIND.LINEAR || kind === PATH_KIND.TURNOUT_TRUNK) &&
		remap.sourcePathFromDirections[pathIndex] !== 0 &&
		remap.sourcePathToDirections[pathIndex] !== 0
	);
}

function mapRemapDistance(
	remap: CompiledPathIntervalRemap,
	row: number,
	sourceDistance: number,
): number {
	const sourceStart = remap.sourceStarts[row] as number;
	const sourceEnd = remap.sourceEnds[row] as number;
	const targetStart = remap.targetStarts[row] as number;
	const targetEnd = remap.targetEnds[row] as number;
	const span = sourceEnd - sourceStart;
	if (span <= EPSILON) return targetStart;
	const ratio = Math.min(1, Math.max(0, (sourceDistance - sourceStart) / span));
	return targetStart + (targetEnd - targetStart) * ratio;
}

function classifyMapping(
	sourceStart: number,
	sourceEnd: number,
	targetStart: number,
	targetEnd: number,
	previousKind: number,
	nextKind: number,
): PhysicalPathMigrationKind {
	if (
		previousKind === PATH_INTERVAL_MAPPING_KIND.MONOTONIC_PROJECTION ||
		nextKind === PATH_INTERVAL_MAPPING_KIND.MONOTONIC_PROJECTION
	) {
		return PHYSICAL_PATH_MIGRATION_KIND.MONOTONIC_PROJECTION;
	}
	if (
		Math.abs(sourceStart - targetStart) <= EPSILON &&
		Math.abs(sourceEnd - targetEnd) <= EPSILON
	) {
		return PHYSICAL_PATH_MIGRATION_KIND.IDENTITY;
	}
	if (Math.abs(sourceEnd - sourceStart - (targetEnd - targetStart)) <= EPSILON) {
		return PHYSICAL_PATH_MIGRATION_KIND.TRANSLATION;
	}
	return PHYSICAL_PATH_MIGRATION_KIND.MONOTONIC_PROJECTION;
}

function clipCandidate(
	candidate: MigrationCandidate,
	sourceStart: number,
	sourceEnd: number,
): MigrationCandidate {
	const sourceSpan = candidate.sourceEnd - candidate.sourceStart;
	const targetSpan = candidate.targetEnd - candidate.targetStart;
	const startRatio = sourceSpan <= EPSILON ? 0 : (sourceStart - candidate.sourceStart) / sourceSpan;
	const endRatio = sourceSpan <= EPSILON ? 1 : (sourceEnd - candidate.sourceStart) / sourceSpan;
	return {
		...candidate,
		sourceStart,
		sourceEnd,
		targetStart:
			candidate.targetPathIndex === NO_MIGRATION_TARGET_PATH
				? 0
				: candidate.targetStart + targetSpan * startRatio,
		targetEnd:
			candidate.targetPathIndex === NO_MIGRATION_TARGET_PATH
				? 0
				: candidate.targetStart + targetSpan * endRatio,
	};
}

function targetlessCandidate(
	sourcePathIndex: number,
	sourceStart: number,
	sourceEnd: number,
	mappingKind:
		| typeof PHYSICAL_PATH_MIGRATION_KIND.DELETED
		| typeof PHYSICAL_PATH_MIGRATION_KIND.UNMAPPABLE,
	endpointError = 0,
): MigrationCandidate {
	return {
		sourcePathIndex,
		sourceStart,
		sourceEnd,
		targetPathIndex: NO_MIGRATION_TARGET_PATH,
		targetStart: 0,
		targetEnd: 0,
		mappingKind,
		endpointError,
	};
}

function canMergeTargetInterval(
	previousRow: number,
	next: MigrationCandidate,
	sourceStarts: readonly number[],
	sourceEnds: readonly number[],
	targetStarts: readonly number[],
	targetEnds: readonly number[],
): boolean {
	if (next.targetPathIndex === NO_MIGRATION_TARGET_PATH) return true;
	if (Math.abs((targetEnds[previousRow] as number) - next.targetStart) > EPSILON) return false;
	const previousSourceSpan =
		(sourceEnds[previousRow] as number) - (sourceStarts[previousRow] as number);
	const nextSourceSpan = next.sourceEnd - next.sourceStart;
	if (previousSourceSpan <= EPSILON || nextSourceSpan <= EPSILON) return false;
	const previousSlope =
		((targetEnds[previousRow] as number) - (targetStarts[previousRow] as number)) /
		previousSourceSpan;
	const nextSlope = (next.targetEnd - next.targetStart) / nextSourceSpan;
	return Math.abs(previousSlope - nextSlope) <= EPSILON;
}

function isRouteEnd(value: number): value is RouteEnd {
	return value === 0 || value === 1 || value === 2 || value === 4 || value === 8;
}
