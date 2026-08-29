import { ALL_DIRECTIONS, type Direction, moveCell, oppositeDirection } from "../core/railShape";
import { type Cell, cellKey } from "../core/TileMap";
import {
	type CompoundRailEntry,
	type CompoundRailPattern,
	type CompoundRailPatternType,
	type CompoundSourceType,
	collectCompoundRailPatterns,
} from "./CompoundRailPattern";
import {
	buildOpenFabCompoundGeometry,
	type CompoundFitKind,
	type OpenFabCompoundGeometry,
} from "./OpenFabCompoundGeometry";
import {
	type CompiledPhysicalPaths,
	NO_ADVANCED_SWITCH_CATALOG_PROFILE,
	NO_ADVANCED_SWITCH_PROFILE_CLASS,
	NO_ADVANCED_SWITCH_SEGMENT_ORDINAL,
	NO_ADVANCED_SWITCH_SEGMENT_PORT,
	NO_ADVANCED_SWITCH_SEGMENT_ROLE,
	PATH_KIND,
	type PhysicalPathKind,
	samplePhysicalPath,
} from "./PhysicalPathCompiler";

export const COMPOUND_PROFILE_TYPE = {
	CCW_CURVE: 0,
	S_CURVE: 1,
	CSC_CURVE_HOMO: 2,
	CSC_CURVE_HETE: 3,
	RIGHT_CURVE: 4,
} as const;

export const COMPOUND_GEOMETRY_KIND = {
	BASELINE_STITCHED: 0,
	OPENFAB_PARAMETRIC: 1,
} as const;

export const COMPOUND_PROFILE_FIT = {
	NOT_APPLICABLE: 0,
	MAP_EXACT: 1,
	GRID_FIT: 2,
} as const;

export const COMPOUND_CONTROL_ROLE = {
	START: 0,
	TMP_FROM: 1,
	ARC_1_END: 2,
	ARC_2_START: 3,
	TMP_TO: 4,
	END: 5,
} as const;

export const PATH_INTERVAL_MAPPING_KIND = {
	IDENTITY: 0,
	TRANSLATION: 1,
	MONOTONIC_PROJECTION: 2,
	UNMAPPABLE: 3,
} as const;

export const PATH_SOURCE_IDENTITY_KIND = {
	CARDINAL_CELL: 0,
	ADVANCED_SWITCH_SEGMENT: 1,
} as const;

export const NO_PATH_INTERVAL_TARGET = 0xffff_ffff;

export interface CompiledCompoundProfiles {
	count: number;
	pathIndices: Uint32Array;
	/** Zero for ordinary compounds, otherwise the owning advanced-switch identity. */
	advancedSwitchIds: Uint32Array;
	types: Uint8Array;
	geometryKinds: Uint8Array;
	fitKinds: Uint8Array;
	nominalProfileIndices: Int16Array;
	lateralSideSigns: Int8Array;
	compiledRadiusMillimeters: Uint16Array;
	compiledTurnAngleTenths: Uint16Array;
	compiledLeadInMillimeters: Uint32Array;
	compiledLeadOutMillimeters: Uint32Array;
	compiledMiddleMillimeters: Uint32Array;
	compiledLengthMillimeters: Uint32Array;
	leadInResidualMillimeters: Int32Array;
	leadOutResidualMillimeters: Int32Array;
	middleResidualMillimeters: Int32Array;
	lengthResidualMillimeters: Int32Array;
	forwardFitDeltaMillimeters: Int32Array;
	lateralFitDeltaMillimeters: Int32Array;
	fitReasonMasks: Uint8Array;
	controlOffsets: Uint32Array;
	controlPoints: Float32Array;
	controlDistances: Float32Array;
	controlRoles: Uint8Array;
	memberOffsets: Uint32Array;
	memberPathIndices: Uint32Array;
}

export interface CompiledPathIntervalRemap {
	count: number;
	sourcePathCount: number;
	/** Raw path metadata. Stable identity is cell + directed route; kind is diagnostic only. */
	sourcePathCells: Int32Array;
	sourcePathKinds: Uint8Array;
	sourcePathFromDirections: Uint8Array;
	sourcePathToDirections: Uint8Array;
	/** Stable source union. Cardinal rows use sentinel switch identity columns. */
	sourceIdentityKinds: Uint8Array;
	sourceAdvancedSwitchIds: Uint32Array;
	sourceAdvancedSwitchProfileClasses: Uint8Array;
	sourceAdvancedSwitchRoles: Uint8Array;
	sourceAdvancedSwitchPorts: Uint8Array;
	sourceAdvancedSwitchSegmentOrdinals: Uint16Array;
	/** Canonical station for raw local station zero, including terminal half-cell ownership. */
	sourcePathCanonicalStarts: Float32Array;
	sourcePathLengths: Float32Array;
	sourcePathOffsets: Uint32Array;
	sourceStarts: Float32Array;
	sourceEnds: Float32Array;
	targetPathIndices: Uint32Array;
	targetStarts: Float32Array;
	targetEnds: Float32Array;
	mappingKinds: Uint8Array;
	projectionErrors: Float32Array;
}

export interface StitchedPhysicalPaths {
	paths: CompiledPhysicalPaths;
	profiles: CompiledCompoundProfiles;
	primaryTargetPathIndices: Uint32Array;
	intervalRemap: CompiledPathIntervalRemap;
	mergedPathCount: number;
}

export interface ExplicitCompoundPathGroup {
	type: CompoundRailPatternType;
	members: readonly number[];
	from: Cell;
	to: Cell;
	turn: "left" | "right";
	/** Present only when the authored boundary admits the named physical profile exactly. */
	geometry?: OpenFabCompoundGeometry;
	advancedSwitchId: number;
	/** Conservative authored cells owned by the physical centerline and switch hardware. */
	extraCoverage?: readonly Cell[];
	/** Preserve a shared hardware interval at the beginning/end of the compiled profile. */
	lockedStartMeters?: number;
	lockedEndMeters?: number;
}

interface MergeGroup {
	pattern: CompoundRailPattern;
	members: readonly number[];
	anchor: number;
	explicit?: ExplicitCompoundPathGroup;
}

interface PathGeometry {
	positions: ArrayLike<number>;
	tangents: ArrayLike<number>;
	distances: ArrayLike<number>;
	length: number;
	bounds: readonly [number, number, number, number];
}

interface SupportTrim {
	start: number;
	end: number;
}

interface ExplicitGroupMapping {
	targetStarts: readonly number[];
	targetEnds: readonly number[];
	projectionErrors: readonly number[];
	mapStation(memberOffset: number, sourceStation: number): number;
}

interface ResolvedCompoundFit {
	geometry: OpenFabCompoundGeometry;
	supportCells: readonly Cell[];
	predecessorPathIndex: number;
	successorPathIndex: number;
}

const SUPPORT_EPSILON = 1e-6;
const MAX_REMAP_PROJECTION_ERROR_METERS = 0.25;

/** Detect strict compound grammar directly from regular compiled cell paths. */
export function detectCompoundPhysicalPathPatterns(
	paths: CompiledPhysicalPaths,
): CompoundRailPattern[] {
	const index = new Map<string, CompoundRailEntry>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const kind = paths.kinds[pathIndex] as number;
		if (kind !== PATH_KIND.LINEAR && kind !== PATH_KIND.CURVE) continue;
		const offset = pathIndex * 2;
		const cell = {
			x: paths.cells[offset] as number,
			y: paths.cells[offset + 1] as number,
		};
		const incoming = paths.fromDirections[pathIndex] as number;
		const outgoing = paths.toDirections[pathIndex] as number;
		const type = sourceType(kind, incoming, outgoing);
		if (!type) continue;
		index.set(cellKey(cell.x, cell.y), {
			cell,
			rail: { incoming, outgoing },
			type,
		});
	}
	return collectCompoundRailPatterns(index);
}

export function stitchDetectedCompoundPhysicalPaths(
	paths: CompiledPhysicalPaths,
): StitchedPhysicalPaths {
	return stitchCompoundPhysicalPaths(paths, detectCompoundPhysicalPathPatterns(paths));
}

/** Merge each detected multi-cell pattern into one metric path and return an exact index remap. */
export function stitchCompoundPhysicalPaths(
	source: CompiledPhysicalPaths,
	patterns: readonly CompoundRailPattern[],
	explicitGroups: readonly ExplicitCompoundPathGroup[] = [],
): StitchedPhysicalPaths {
	const pathByCell = regularPathIndexByCell(source);
	const claimed = new Set<number>();
	const groups: MergeGroup[] = [];
	for (const explicit of explicitGroups) {
		const members = [...explicit.members];
		if (
			members.length === 0 ||
			members.some(
				(pathIndex) => pathIndex < 0 || pathIndex >= source.pathCount || claimed.has(pathIndex),
			) ||
			new Set(members).size !== members.length ||
			!baselineMembersAreContinuous(source, members)
		) {
			continue;
		}
		for (const pathIndex of members) claimed.add(pathIndex);
		groups.push({
			pattern: {
				type: explicit.type,
				cells: members.map((pathIndex) => ({
					x: source.cells[pathIndex * 2] as number,
					y: source.cells[pathIndex * 2 + 1] as number,
				})),
				from: explicit.from,
				to: explicit.to,
				fromDirection: source.toDirections[members[0] as number] as Direction,
				toDirection: source.toDirections[members.at(-1) as number] as Direction,
				turn: explicit.turn,
			},
			members,
			anchor: Math.min(...members),
			explicit,
		});
	}
	for (const pattern of patterns) {
		const members = pattern.cells.map((cell) => pathByCell.get(cellKey(cell.x, cell.y)) ?? -1);
		if (
			members.some((pathIndex) => pathIndex < 0 || claimed.has(pathIndex)) ||
			new Set(members).size !== members.length ||
			!baselineMembersAreContinuous(source, members)
		) {
			continue;
		}
		for (const pathIndex of members) claimed.add(pathIndex);
		groups.push({ pattern, members, anchor: Math.min(...members) });
	}

	const primaryTargetPathIndices = new Uint32Array(source.pathCount);
	if (groups.length === 0) {
		for (let pathIndex = 0; pathIndex < source.pathCount; pathIndex++) {
			primaryTargetPathIndices[pathIndex] = pathIndex;
		}
		return {
			paths: source,
			profiles: emptyCompoundProfiles(),
			primaryTargetPathIndices,
			intervalRemap: identityIntervalRemap(source),
			mergedPathCount: 0,
		};
	}

	const groupByMember = new Map<number, MergeGroup>();
	for (const group of groups) {
		for (const member of group.members) groupByMember.set(member, group);
	}
	const pathsByCell = pathIndicesByCell(source);
	const fitByGroup = new Map<MergeGroup, ResolvedCompoundFit>();
	const supportTrims = new Map<number, SupportTrim>();
	for (const group of groups) {
		if (group.explicit) continue;
		const fit = resolveCompoundFit(source, pathsByCell, group);
		if (!fit) continue;
		if (groupByMember.has(fit.predecessorPathIndex) || groupByMember.has(fit.successorPathIndex)) {
			continue;
		}
		fitByGroup.set(group, fit);
		addSupportTrim(supportTrims, fit.predecessorPathIndex, 0, 0.5);
		addSupportTrim(supportTrims, fit.successorPathIndex, 0.5, 0);
	}
	const explicitMappingByGroup = new Map<MergeGroup, ExplicitGroupMapping>();
	for (const group of groups) {
		const explicit = group.explicit;
		const geometry = explicit?.geometry;
		if (!explicit || !geometry) continue;
		const mapping = createExplicitGroupMapping(source, group.members, { ...explicit, geometry });
		if (
			mapping.projectionErrors.every(
				(error) => Number.isFinite(error) && error <= MAX_REMAP_PROJECTION_ERROR_METERS,
			) &&
			mapping.targetStarts.every(
				(start, index) => (mapping.targetEnds[index] as number) - start > SUPPORT_EPSILON,
			)
		) {
			explicitMappingByGroup.set(group, mapping);
		}
	}

	const positions: number[] = [];
	const tangents: number[] = [];
	const distances: number[] = [];
	const offsets: number[] = [];
	const kinds: number[] = [];
	const cells: number[] = [];
	const exitCells: number[] = [];
	const fromDirections: number[] = [];
	const toDirections: number[] = [];
	const lengths: number[] = [];
	const bounds: number[] = [];
	const startInsets: number[] = [];
	const endInsets: number[] = [];
	const startExtensions: number[] = [];
	const endExtensions: number[] = [];
	const coverageOffsets: number[] = [];
	const coverageCells: number[] = [];
	const sharedSegmentOffsets: number[] = [];
	const sharedSegmentIds: number[] = [];
	const sharedSegmentStarts: number[] = [];
	const sharedSegmentEnds: number[] = [];
	const profilePathIndices: number[] = [];
	const profileAdvancedSwitchIds: number[] = [];
	const profileTypes: number[] = [];
	const profileGeometryKinds: number[] = [];
	const profileFitKinds: number[] = [];
	const profileNominalProfileIndices: number[] = [];
	const profileLateralSideSigns: number[] = [];
	const profileCompiledRadiusMillimeters: number[] = [];
	const profileCompiledTurnAngleTenths: number[] = [];
	const profileCompiledLeadInMillimeters: number[] = [];
	const profileCompiledLeadOutMillimeters: number[] = [];
	const profileCompiledMiddleMillimeters: number[] = [];
	const profileCompiledLengthMillimeters: number[] = [];
	const profileLeadInResidualMillimeters: number[] = [];
	const profileLeadOutResidualMillimeters: number[] = [];
	const profileMiddleResidualMillimeters: number[] = [];
	const profileLengthResidualMillimeters: number[] = [];
	const profileForwardFitDeltaMillimeters: number[] = [];
	const profileLateralFitDeltaMillimeters: number[] = [];
	const profileFitReasonMasks: number[] = [];
	const profileControlOffsets: number[] = [];
	const profileControlPoints: number[] = [];
	const profileControlDistances: number[] = [];
	const profileControlRoles: number[] = [];
	const profileMemberOffsets: number[] = [];
	const profileMemberPathIndices: number[] = [];
	const remapSourcePathIndices: number[] = [];
	const remapSourceStarts: number[] = [];
	const remapSourceEnds: number[] = [];
	const remapTargetPathIndices: number[] = [];
	const remapTargetStarts: number[] = [];
	const remapTargetEnds: number[] = [];
	const remapMappingKinds: number[] = [];
	const remapProjectionErrors: number[] = [];
	const sharedUsage = new Map<number, { lengthMeters: number; count: number }>();
	let totalRouteLengthMeters = 0;
	const appendIntervalRemap = (
		sourcePathIndex: number,
		sourceStart: number,
		sourceEnd: number,
		targetPathIndex: number,
		targetStart: number,
		targetEnd: number,
		mappingKind: number = PATH_INTERVAL_MAPPING_KIND.IDENTITY,
		projectionError = 0,
	): void => {
		if (sourceEnd - sourceStart <= SUPPORT_EPSILON) return;
		remapSourcePathIndices.push(sourcePathIndex);
		remapSourceStarts.push(sourceStart);
		remapSourceEnds.push(sourceEnd);
		remapTargetPathIndices.push(targetPathIndex);
		remapTargetStarts.push(targetStart);
		remapTargetEnds.push(targetEnd);
		remapMappingKinds.push(
			mappingKind === PATH_INTERVAL_MAPPING_KIND.MONOTONIC_PROJECTION &&
				(projectionError > MAX_REMAP_PROJECTION_ERROR_METERS ||
					targetEnd - targetStart <= SUPPORT_EPSILON)
				? PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE
				: targetEnd + SUPPORT_EPSILON < targetStart
					? PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE
					: mappingKind,
		);
		remapProjectionErrors.push(projectionError);
	};

	const appendPath = (
		members: readonly number[],
		kind: PhysicalPathKind,
		entry: Cell,
		exit: Cell,
		options: {
			geometry?: PathGeometry;
			extraCoverage?: readonly Cell[];
			trim?: SupportTrim;
			memberStationMapper?: (memberOffset: number, sourceStation: number) => number;
		} = {},
	): number => {
		const outputIndex = kinds.length;
		offsets.push(distances.length);
		coverageOffsets.push(coverageCells.length / 2);
		sharedSegmentOffsets.push(sharedSegmentIds.length);
		kinds.push(kind);
		cells.push(entry.x, entry.y);
		exitCells.push(exit.x, exit.y);
		const first = members[0] as number;
		const last = members.at(-1) as number;
		fromDirections.push(source.fromDirections[first] as number);
		toDirections.push(source.toDirections[last] as number);
		startInsets.push((source.startInsets[first] as number) + (options.trim?.start ?? 0));
		endInsets.push((source.endInsets[last] as number) + (options.trim?.end ?? 0));
		startExtensions.push(source.startExtensions[first] as number);
		endExtensions.push(source.endExtensions[last] as number);

		let cumulativeLength = 0;
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		const memberOrigins: number[] = [];
		if (options.geometry) {
			for (let index = 0; index < options.geometry.distances.length; index++) {
				positions.push(
					options.geometry.positions[index * 2] as number,
					options.geometry.positions[index * 2 + 1] as number,
				);
				tangents.push(
					options.geometry.tangents[index * 2] as number,
					options.geometry.tangents[index * 2 + 1] as number,
				);
				distances.push(options.geometry.distances[index] as number);
			}
			cumulativeLength = options.geometry.length;
			[minX, minY, maxX, maxY] = options.geometry.bounds;
			for (let memberOffset = 0; memberOffset < members.length; memberOffset++) {
				memberOrigins[memberOffset] = 0;
			}
		} else {
			for (let memberOffset = 0; memberOffset < members.length; memberOffset++) {
				memberOrigins[memberOffset] = cumulativeLength;
				const member = members[memberOffset] as number;
				const pointStart = source.offsets[member] as number;
				const pointEnd = source.offsets[member + 1] as number;
				for (let pointIndex = pointStart; pointIndex < pointEnd; pointIndex++) {
					const sourceOffset = pointIndex * 2;
					const x = source.positions[sourceOffset] as number;
					const y = source.positions[sourceOffset + 1] as number;
					const isSharedBoundary =
						memberOffset > 0 &&
						pointIndex === pointStart &&
						positions.length >= 2 &&
						Math.abs((positions.at(-2) as number) - x) < 1e-6 &&
						Math.abs((positions.at(-1) as number) - y) < 1e-6;
					if (isSharedBoundary) continue;
					positions.push(x, y);
					tangents.push(
						source.tangents[sourceOffset] as number,
						source.tangents[sourceOffset + 1] as number,
					);
					distances.push(cumulativeLength + (source.distances[pointIndex] as number));
				}

				const boundsOffset = member * 4;
				minX = Math.min(minX, source.bounds[boundsOffset] as number);
				minY = Math.min(minY, source.bounds[boundsOffset + 1] as number);
				maxX = Math.max(maxX, source.bounds[boundsOffset + 2] as number);
				maxY = Math.max(maxY, source.bounds[boundsOffset + 3] as number);
				cumulativeLength += source.lengths[member] as number;
			}
		}

		const covered = new Set<string>();
		for (let memberOffset = 0; memberOffset < members.length; memberOffset++) {
			const member = members[memberOffset] as number;
			const coverageStart = source.coverageOffsets[member] as number;
			const coverageEnd = source.coverageOffsets[member + 1] as number;
			for (let coverageIndex = coverageStart; coverageIndex < coverageEnd; coverageIndex++) {
				const coverageOffset = coverageIndex * 2;
				const x = source.coverageCells[coverageOffset] as number;
				const y = source.coverageCells[coverageOffset + 1] as number;
				const key = cellKey(x, y);
				if (covered.has(key)) continue;
				covered.add(key);
				coverageCells.push(x, y);
			}

			const sharedStart = source.sharedSegmentOffsets[member] as number;
			const sharedEnd = source.sharedSegmentOffsets[member + 1] as number;
			for (let sharedIndex = sharedStart; sharedIndex < sharedEnd; sharedIndex++) {
				const id = source.sharedSegmentIds[sharedIndex] as number;
				const sourceStart = source.sharedSegmentStarts[sharedIndex] as number;
				const sourceEnd = source.sharedSegmentEnds[sharedIndex] as number;
				const origin = memberOrigins[memberOffset] as number;
				const start = options.memberStationMapper
					? options.memberStationMapper(memberOffset, sourceStart)
					: origin + sourceStart;
				const end = options.memberStationMapper
					? options.memberStationMapper(memberOffset, sourceEnd)
					: origin + sourceEnd;
				sharedSegmentIds.push(id);
				sharedSegmentStarts.push(start);
				sharedSegmentEnds.push(end);
				const usage = sharedUsage.get(id);
				sharedUsage.set(id, {
					lengthMeters: Math.max(usage?.lengthMeters ?? 0, end - start),
					count: (usage?.count ?? 0) + 1,
				});
			}
		}
		for (const cell of options.extraCoverage ?? []) {
			const key = cellKey(cell.x, cell.y);
			if (covered.has(key)) continue;
			covered.add(key);
			coverageCells.push(cell.x, cell.y);
		}

		lengths.push(cumulativeLength);
		bounds.push(minX, minY, maxX, maxY);
		totalRouteLengthMeters += cumulativeLength;
		return outputIndex;
	};
	const appendProfile = (
		pathIndex: number,
		type: CompoundRailPatternType,
		turn: "left" | "right",
		members: readonly number[],
		geometry?: OpenFabCompoundGeometry,
		advancedSwitchId = 0,
	): void => {
		profilePathIndices.push(pathIndex);
		profileAdvancedSwitchIds.push(advancedSwitchId);
		profileTypes.push(compoundProfileType(type));
		profileGeometryKinds.push(
			geometry
				? COMPOUND_GEOMETRY_KIND.OPENFAB_PARAMETRIC
				: COMPOUND_GEOMETRY_KIND.BASELINE_STITCHED,
		);
		profileFitKinds.push(
			geometry ? compoundFitKind(geometry.fitKind) : COMPOUND_PROFILE_FIT.NOT_APPLICABLE,
		);
		profileNominalProfileIndices.push(geometry?.nominalProfileIndex ?? -1);
		profileLateralSideSigns.push(geometry?.lateralSideSign ?? (turn === "left" ? -1 : 1));
		profileCompiledRadiusMillimeters.push(geometry?.radiusMillimeters ?? 0);
		profileCompiledTurnAngleTenths.push(geometry?.turnAngleTenths ?? 0);
		profileCompiledLeadInMillimeters.push(geometry?.leadInMillimeters ?? 0);
		profileCompiledLeadOutMillimeters.push(geometry?.leadOutMillimeters ?? 0);
		profileCompiledMiddleMillimeters.push(geometry?.middleMillimeters ?? 0);
		profileCompiledLengthMillimeters.push(
			geometry?.compiledLengthMillimeters ?? Math.round((lengths[pathIndex] as number) * 1_000),
		);
		profileLeadInResidualMillimeters.push(geometry?.leadInResidualMillimeters ?? 0);
		profileLeadOutResidualMillimeters.push(geometry?.leadOutResidualMillimeters ?? 0);
		profileMiddleResidualMillimeters.push(geometry?.middleResidualMillimeters ?? 0);
		profileLengthResidualMillimeters.push(geometry?.lengthResidualMillimeters ?? 0);
		profileForwardFitDeltaMillimeters.push(geometry?.forwardFitDeltaMillimeters ?? 0);
		profileLateralFitDeltaMillimeters.push(geometry?.lateralFitDeltaMillimeters ?? 0);
		profileFitReasonMasks.push(geometry?.fitReasonMask ?? 0);
		profileControlOffsets.push(profileControlPoints.length / 2);
		if (geometry) {
			profileControlPoints.push(...geometry.controlPoints);
			profileControlDistances.push(...geometry.controlDistances);
			profileControlRoles.push(...compoundControlRoles(type));
		}
		profileMemberOffsets.push(profileMemberPathIndices.length);
		profileMemberPathIndices.push(...members);
	};
	const appendCompoundRemaps = (
		group: MergeGroup,
		targetPathIndex: number,
		fit?: ResolvedCompoundFit,
	): void => {
		if (!fit) {
			let targetStart = 0;
			for (const member of group.members) {
				const memberLength = source.lengths[member] as number;
				appendIntervalRemap(
					member,
					0,
					memberLength,
					targetPathIndex,
					targetStart,
					targetStart + memberLength,
					PATH_INTERVAL_MAPPING_KIND.TRANSLATION,
				);
				targetStart += memberLength;
			}
			return;
		}

		const predecessorLength = source.lengths[fit.predecessorPathIndex] as number;
		const intervals = [
			{
				pathIndex: fit.predecessorPathIndex,
				start: Math.max(0, predecessorLength - 0.5),
				end: predecessorLength,
			},
			...group.members.map((member) => ({
				pathIndex: member,
				start: 0,
				end: source.lengths[member] as number,
			})),
			{
				pathIndex: fit.successorPathIndex,
				start: 0,
				end: Math.min(0.5, source.lengths[fit.successorPathIndex] as number),
			},
		];
		const projected = projectIntervalChain(source, intervals, fit.geometry);
		for (let index = 0; index < intervals.length; index++) {
			const interval = intervals[index] as (typeof intervals)[number];
			const targetStart = projected.stations[index] as number;
			const targetEnd = projected.stations[index + 1] as number;
			const projectionError = Math.max(
				projected.errors[index] as number,
				projected.errors[index + 1] as number,
			);
			appendIntervalRemap(
				interval.pathIndex,
				interval.start,
				interval.end,
				targetPathIndex,
				targetStart,
				targetEnd,
				projectionError <= MAX_REMAP_PROJECTION_ERROR_METERS &&
					targetEnd - targetStart > SUPPORT_EPSILON
					? PATH_INTERVAL_MAPPING_KIND.MONOTONIC_PROJECTION
					: PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE,
				projectionError,
			);
		}
	};
	const appendExplicitRemaps = (
		group: MergeGroup,
		targetPathIndex: number,
		mapping: ExplicitGroupMapping,
	): void => {
		const explicit = group.explicit as ExplicitCompoundPathGroup;
		for (let memberOffset = 0; memberOffset < group.members.length; memberOffset++) {
			const member = group.members[memberOffset] as number;
			const memberLength = source.lengths[member] as number;
			const splits = [0, memberLength];
			if (memberOffset === 0 && explicit.lockedStartMeters) {
				splits.splice(1, 0, Math.min(memberLength, explicit.lockedStartMeters));
			}
			if (memberOffset === group.members.length - 1 && explicit.lockedEndMeters) {
				splits.splice(splits.length - 1, 0, Math.max(0, memberLength - explicit.lockedEndMeters));
			}
			for (let splitIndex = 0; splitIndex < splits.length - 1; splitIndex++) {
				const sourceStart = splits[splitIndex] as number;
				const sourceEnd = splits[splitIndex + 1] as number;
				if (sourceEnd - sourceStart <= SUPPORT_EPSILON) continue;
				appendIntervalRemap(
					member,
					sourceStart,
					sourceEnd,
					targetPathIndex,
					mapping.mapStation(memberOffset, sourceStart),
					mapping.mapStation(memberOffset, sourceEnd),
					PATH_INTERVAL_MAPPING_KIND.MONOTONIC_PROJECTION,
					mapping.projectionErrors[memberOffset] as number,
				);
			}
		}
	};

	for (let pathIndex = 0; pathIndex < source.pathCount; pathIndex++) {
		const group = groupByMember.get(pathIndex);
		if (group) {
			if (pathIndex !== group.anchor) continue;
			const fit = fitByGroup.get(group);
			const explicitMapping = explicitMappingByGroup.get(group);
			const geometry = group.explicit
				? explicitMapping
					? group.explicit.geometry
					: undefined
				: fit?.geometry;
			const nextIndex = appendPath(
				group.members,
				compoundPathKind(group.pattern.type),
				group.pattern.from,
				group.pattern.to,
				{
					...(geometry ? { geometry } : {}),
					...(group.explicit?.extraCoverage
						? { extraCoverage: group.explicit.extraCoverage }
						: fit
							? { extraCoverage: fit.supportCells }
							: {}),
					...(explicitMapping ? { memberStationMapper: explicitMapping.mapStation } : {}),
				},
			);
			appendProfile(
				nextIndex,
				group.pattern.type,
				group.pattern.turn,
				group.members,
				geometry,
				group.explicit?.advancedSwitchId,
			);
			if (explicitMapping) appendExplicitRemaps(group, nextIndex, explicitMapping);
			else appendCompoundRemaps(group, nextIndex, fit);
			for (const member of group.members) primaryTargetPathIndices[member] = nextIndex;
			continue;
		}

		const offset = pathIndex * 2;
		const trim = supportTrims.get(pathIndex);
		const nextIndex = appendPath(
			[pathIndex],
			source.kinds[pathIndex] as PhysicalPathKind,
			{ x: source.cells[offset] as number, y: source.cells[offset + 1] as number },
			{ x: source.exitCells[offset] as number, y: source.exitCells[offset + 1] as number },
			trim ? { geometry: slicePhysicalPath(source, pathIndex, trim), trim } : undefined,
		);
		primaryTargetPathIndices[pathIndex] = nextIndex;
		const sourceLength = source.lengths[pathIndex] as number;
		const sourceStart = Math.min(sourceLength, Math.max(0, trim?.start ?? 0));
		const sourceEnd = Math.max(sourceStart, sourceLength - Math.max(0, trim?.end ?? 0));
		appendIntervalRemap(
			pathIndex,
			sourceStart,
			sourceEnd,
			nextIndex,
			0,
			sourceEnd - sourceStart,
			sourceStart === 0
				? PATH_INTERVAL_MAPPING_KIND.IDENTITY
				: PATH_INTERVAL_MAPPING_KIND.TRANSLATION,
		);
	}

	offsets.push(distances.length);
	coverageOffsets.push(coverageCells.length / 2);
	sharedSegmentOffsets.push(sharedSegmentIds.length);
	profileControlOffsets.push(profileControlPoints.length / 2);
	profileMemberOffsets.push(profileMemberPathIndices.length);
	let duplicatedSharedLengthMeters = 0;
	for (const shared of sharedUsage.values()) {
		duplicatedSharedLengthMeters += shared.lengthMeters * Math.max(0, shared.count - 1);
	}

	const paths: CompiledPhysicalPaths = {
		revision: source.revision,
		positions: new Float32Array(positions),
		tangents: new Float32Array(tangents),
		distances: new Float32Array(distances),
		offsets: new Uint32Array(offsets),
		kinds: new Uint8Array(kinds),
		cells: new Int32Array(cells),
		exitCells: new Int32Array(exitCells),
		fromDirections: new Uint8Array(fromDirections),
		toDirections: new Uint8Array(toDirections),
		lengths: new Float32Array(lengths),
		bounds: new Float32Array(bounds),
		startInsets: new Float32Array(startInsets),
		endInsets: new Float32Array(endInsets),
		startExtensions: new Float32Array(startExtensions),
		endExtensions: new Float32Array(endExtensions),
		coverageOffsets: new Uint32Array(coverageOffsets),
		coverageCells: new Int32Array(coverageCells),
		sharedSegmentOffsets: new Uint32Array(sharedSegmentOffsets),
		sharedSegmentIds: new Uint32Array(sharedSegmentIds),
		sharedSegmentStarts: new Float32Array(sharedSegmentStarts),
		sharedSegmentEnds: new Float32Array(sharedSegmentEnds),
		sourceKinds: new Uint8Array(kinds.length),
		advancedSwitchIds: new Uint32Array(kinds.length),
		advancedSwitchProfileClasses: filledUint8(kinds.length, NO_ADVANCED_SWITCH_PROFILE_CLASS),
		advancedSwitchSegmentRoles: filledUint8(kinds.length, NO_ADVANCED_SWITCH_SEGMENT_ROLE),
		advancedSwitchSegmentPorts: filledUint8(kinds.length, NO_ADVANCED_SWITCH_SEGMENT_PORT),
		advancedSwitchSegmentOrdinals: filledUint16(kinds.length, NO_ADVANCED_SWITCH_SEGMENT_ORDINAL),
		advancedSwitchCatalogProfiles: filledUint8(kinds.length, NO_ADVANCED_SWITCH_CATALOG_PROFILE),
		explicitAdjacencyOffsets: new Uint32Array(kinds.length + 1),
		explicitAdjacencyTargets: new Uint32Array(),
		sharedSegmentCount: sharedUsage.size,
		totalLengthMeters: totalRouteLengthMeters - duplicatedSharedLengthMeters,
		totalRouteLengthMeters,
		pathCount: kinds.length,
		pointCount: distances.length,
	};
	const profiles: CompiledCompoundProfiles = {
		count: profilePathIndices.length,
		pathIndices: new Uint32Array(profilePathIndices),
		advancedSwitchIds: new Uint32Array(profileAdvancedSwitchIds),
		types: new Uint8Array(profileTypes),
		geometryKinds: new Uint8Array(profileGeometryKinds),
		fitKinds: new Uint8Array(profileFitKinds),
		nominalProfileIndices: new Int16Array(profileNominalProfileIndices),
		lateralSideSigns: new Int8Array(profileLateralSideSigns),
		compiledRadiusMillimeters: new Uint16Array(profileCompiledRadiusMillimeters),
		compiledTurnAngleTenths: new Uint16Array(profileCompiledTurnAngleTenths),
		compiledLeadInMillimeters: new Uint32Array(profileCompiledLeadInMillimeters),
		compiledLeadOutMillimeters: new Uint32Array(profileCompiledLeadOutMillimeters),
		compiledMiddleMillimeters: new Uint32Array(profileCompiledMiddleMillimeters),
		compiledLengthMillimeters: new Uint32Array(profileCompiledLengthMillimeters),
		leadInResidualMillimeters: new Int32Array(profileLeadInResidualMillimeters),
		leadOutResidualMillimeters: new Int32Array(profileLeadOutResidualMillimeters),
		middleResidualMillimeters: new Int32Array(profileMiddleResidualMillimeters),
		lengthResidualMillimeters: new Int32Array(profileLengthResidualMillimeters),
		forwardFitDeltaMillimeters: new Int32Array(profileForwardFitDeltaMillimeters),
		lateralFitDeltaMillimeters: new Int32Array(profileLateralFitDeltaMillimeters),
		fitReasonMasks: new Uint8Array(profileFitReasonMasks),
		controlOffsets: new Uint32Array(profileControlOffsets),
		controlPoints: new Float32Array(profileControlPoints),
		controlDistances: new Float32Array(profileControlDistances),
		controlRoles: new Uint8Array(profileControlRoles),
		memberOffsets: new Uint32Array(profileMemberOffsets),
		memberPathIndices: new Uint32Array(profileMemberPathIndices),
	};
	const intervalRemap = compileIntervalRemap(
		source,
		primaryTargetPathIndices,
		remapSourcePathIndices,
		remapSourceStarts,
		remapSourceEnds,
		remapTargetPathIndices,
		remapTargetStarts,
		remapTargetEnds,
		remapMappingKinds,
		remapProjectionErrors,
	);
	return {
		paths,
		profiles,
		primaryTargetPathIndices,
		intervalRemap,
		mergedPathCount: groups.length,
	};
}

function regularPathIndexByCell(paths: CompiledPhysicalPaths): Map<string, number> {
	const index = new Map<string, number>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const kind = paths.kinds[pathIndex] as number;
		if (kind !== PATH_KIND.LINEAR && kind !== PATH_KIND.CURVE) continue;
		const offset = pathIndex * 2;
		index.set(cellKey(paths.cells[offset] as number, paths.cells[offset + 1] as number), pathIndex);
	}
	return index;
}

function baselineMembersAreContinuous(
	paths: CompiledPhysicalPaths,
	members: readonly number[],
): boolean {
	for (let index = 1; index < members.length; index++) {
		const previous = members[index - 1] as number;
		const next = members[index] as number;
		const previousEnd = samplePhysicalPath(paths, previous, paths.lengths[previous] as number);
		const nextStart = samplePhysicalPath(paths, next, 0);
		if (!previousEnd || !nextStart) return false;
		if (Math.hypot(previousEnd.x - nextStart.x, previousEnd.y - nextStart.y) > 1e-5) {
			return false;
		}
		if (
			previousEnd.tangentX * nextStart.tangentX + previousEnd.tangentY * nextStart.tangentY <
			1 - 1e-5
		) {
			return false;
		}
	}
	return true;
}

function pathIndicesByCell(paths: CompiledPhysicalPaths): Map<string, number[]> {
	const index = new Map<string, number[]>();
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const offset = pathIndex * 2;
		const key = cellKey(paths.cells[offset] as number, paths.cells[offset + 1] as number);
		const indices = index.get(key);
		if (indices) indices.push(pathIndex);
		else index.set(key, [pathIndex]);
	}
	return index;
}

function resolveCompoundFit(
	paths: CompiledPhysicalPaths,
	pathsByCell: ReadonlyMap<string, readonly number[]>,
	group: MergeGroup,
): ResolvedCompoundFit | null {
	const predecessorCell = moveCell(
		group.pattern.from,
		oppositeDirection(group.pattern.fromDirection),
	);
	const successorCell = moveCell(group.pattern.to, group.pattern.toDirection);
	const predecessorPathIndex = findSupportPath(
		paths,
		pathsByCell.get(cellKey(predecessorCell.x, predecessorCell.y)) ?? [],
		"to",
		group.pattern.fromDirection,
	);
	const successorPathIndex = findSupportPath(
		paths,
		pathsByCell.get(cellKey(successorCell.x, successorCell.y)) ?? [],
		"from",
		oppositeDirection(group.pattern.toDirection),
	);
	if (
		predecessorPathIndex < 0 ||
		successorPathIndex < 0 ||
		predecessorPathIndex === successorPathIndex ||
		group.members.includes(predecessorPathIndex) ||
		group.members.includes(successorPathIndex)
	) {
		return null;
	}
	if (!canOwnHalfCell(paths, predecessorPathIndex, "end")) return null;
	if (!canOwnHalfCell(paths, successorPathIndex, "start")) return null;

	const start = { x: predecessorCell.x + 0.5, y: predecessorCell.y + 0.5 };
	const end = { x: successorCell.x + 0.5, y: successorCell.y + 0.5 };
	const startTangent = directionVector(group.pattern.fromDirection);
	const endTangent = directionVector(group.pattern.toDirection);
	const geometry = buildOpenFabCompoundGeometry(
		group.pattern.type,
		start,
		end,
		startTangent,
		endTangent,
	);
	if (!geometry) return null;
	return {
		geometry,
		supportCells: [predecessorCell, successorCell],
		predecessorPathIndex,
		successorPathIndex,
	};
}

function findSupportPath(
	paths: CompiledPhysicalPaths,
	candidates: readonly number[],
	edge: "from" | "to",
	direction: Direction,
): number {
	let match = -1;
	for (const pathIndex of candidates) {
		const kind = paths.kinds[pathIndex] as number;
		if (kind !== PATH_KIND.LINEAR && kind !== PATH_KIND.TERMINAL) continue;
		const actual =
			edge === "from"
				? (paths.fromDirections[pathIndex] as number)
				: (paths.toDirections[pathIndex] as number);
		if (actual !== direction) continue;
		if (match >= 0) return -1;
		match = pathIndex;
	}
	return match;
}

function canOwnHalfCell(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	edge: "start" | "end",
): boolean {
	if (
		(paths.sharedSegmentOffsets[pathIndex] as number) !== paths.sharedSegmentOffsets[pathIndex + 1]
	) {
		return false;
	}
	if (
		(paths.startExtensions[pathIndex] as number) !== 0 ||
		(paths.endExtensions[pathIndex] as number) !== 0
	) {
		return false;
	}
	const length = paths.lengths[pathIndex] as number;
	if (length + SUPPORT_EPSILON < 0.5) return false;
	const distance = edge === "start" ? 0.5 : length - 0.5;
	const sample = samplePhysicalPath(paths, pathIndex, distance);
	if (!sample) return false;
	const offset = pathIndex * 2;
	const center = {
		x: (paths.cells[offset] as number) + 0.5,
		y: (paths.cells[offset + 1] as number) + 0.5,
	};
	return Math.hypot(sample.x - center.x, sample.y - center.y) < 1e-5;
}

function addSupportTrim(
	trims: Map<number, SupportTrim>,
	pathIndex: number,
	start: number,
	end: number,
): void {
	const trim = trims.get(pathIndex) ?? { start: 0, end: 0 };
	trim.start = Math.max(trim.start, start);
	trim.end = Math.max(trim.end, end);
	trims.set(pathIndex, trim);
}

function slicePhysicalPath(
	paths: CompiledPhysicalPaths,
	pathIndex: number,
	trim: SupportTrim,
): PathGeometry {
	const length = paths.lengths[pathIndex] as number;
	const startDistance = Math.min(length, Math.max(0, trim.start));
	const endDistance = Math.max(startDistance, length - Math.max(0, trim.end));
	const start = samplePhysicalPath(paths, pathIndex, startDistance);
	if (!start) return sourcePathGeometry(paths, pathIndex);
	const positions = [start.x, start.y];
	const tangents = [start.tangentX, start.tangentY];
	const distances = [0];
	const pointStart = paths.offsets[pathIndex] as number;
	const pointEnd = paths.offsets[pathIndex + 1] as number;
	for (let pointIndex = pointStart + 1; pointIndex < pointEnd - 1; pointIndex++) {
		const distance = paths.distances[pointIndex] as number;
		if (distance <= startDistance || distance >= endDistance) continue;
		positions.push(
			paths.positions[pointIndex * 2] as number,
			paths.positions[pointIndex * 2 + 1] as number,
		);
		tangents.push(
			paths.tangents[pointIndex * 2] as number,
			paths.tangents[pointIndex * 2 + 1] as number,
		);
		distances.push(distance - startDistance);
	}
	if (endDistance > startDistance) {
		const end = samplePhysicalPath(paths, pathIndex, endDistance) as NonNullable<
			ReturnType<typeof samplePhysicalPath>
		>;
		positions.push(end.x, end.y);
		tangents.push(end.tangentX, end.tangentY);
		distances.push(endDistance - startDistance);
	}
	return {
		positions,
		tangents,
		distances,
		length: endDistance - startDistance,
		bounds: boundsOf(positions),
	};
}

function sourcePathGeometry(paths: CompiledPhysicalPaths, pathIndex: number): PathGeometry {
	const start = paths.offsets[pathIndex] as number;
	const end = paths.offsets[pathIndex + 1] as number;
	return {
		positions: paths.positions.slice(start * 2, end * 2),
		tangents: paths.tangents.slice(start * 2, end * 2),
		distances: paths.distances.slice(start, end),
		length: paths.lengths[pathIndex] as number,
		bounds: [
			paths.bounds[pathIndex * 4] as number,
			paths.bounds[pathIndex * 4 + 1] as number,
			paths.bounds[pathIndex * 4 + 2] as number,
			paths.bounds[pathIndex * 4 + 3] as number,
		],
	};
}

function boundsOf(positions: readonly number[]): [number, number, number, number] {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < positions.length; index += 2) {
		minX = Math.min(minX, positions[index] as number);
		minY = Math.min(minY, positions[index + 1] as number);
		maxX = Math.max(maxX, positions[index] as number);
		maxY = Math.max(maxY, positions[index + 1] as number);
	}
	return [minX, minY, maxX, maxY];
}

function projectPointToGeometry(
	geometry: PathGeometry,
	x: number,
	y: number,
): { station: number; error: number } {
	let bestDistanceSquared = Number.POSITIVE_INFINITY;
	let bestStation = 0;
	for (let pointIndex = 1; pointIndex < geometry.distances.length; pointIndex++) {
		const startOffset = (pointIndex - 1) * 2;
		const endOffset = pointIndex * 2;
		const startX = geometry.positions[startOffset] as number;
		const startY = geometry.positions[startOffset + 1] as number;
		const deltaX = (geometry.positions[endOffset] as number) - startX;
		const deltaY = (geometry.positions[endOffset + 1] as number) - startY;
		const lengthSquared = deltaX * deltaX + deltaY * deltaY;
		const amount =
			lengthSquared <= SUPPORT_EPSILON
				? 0
				: Math.max(0, Math.min(1, ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared));
		const projectedX = startX + deltaX * amount;
		const projectedY = startY + deltaY * amount;
		const distanceSquared = (x - projectedX) ** 2 + (y - projectedY) ** 2;
		if (distanceSquared >= bestDistanceSquared) continue;
		bestDistanceSquared = distanceSquared;
		bestStation =
			(geometry.distances[pointIndex - 1] as number) +
			((geometry.distances[pointIndex] as number) -
				(geometry.distances[pointIndex - 1] as number)) *
				amount;
	}
	return { station: bestStation, error: Math.sqrt(bestDistanceSquared) };
}

function projectIntervalChain(
	paths: CompiledPhysicalPaths,
	intervals: readonly { pathIndex: number; start: number; end: number }[],
	geometry: PathGeometry,
): { stations: number[]; errors: number[] } {
	const samples: { x: number; y: number }[] = [];
	const first = intervals[0];
	if (!first) return { stations: [], errors: [] };
	const firstSample = samplePhysicalPath(paths, first.pathIndex, first.start);
	if (!firstSample) return { stations: [], errors: [] };
	samples.push(firstSample);
	for (const interval of intervals) {
		const end = samplePhysicalPath(paths, interval.pathIndex, interval.end);
		if (!end) return { stations: [], errors: [] };
		samples.push(end);
	}

	const projections = samples.map((sample) => projectPointToGeometry(geometry, sample.x, sample.y));
	const stations = projections.map((projection) =>
		Math.max(0, Math.min(geometry.length, projection.station)),
	);
	stations[0] = 0;
	stations[stations.length - 1] = geometry.length;
	for (let index = 1; index < stations.length; index++) {
		stations[index] = Math.max(stations[index - 1] as number, stations[index] as number);
	}
	for (let index = stations.length - 2; index >= 0; index--) {
		stations[index] = Math.min(stations[index] as number, stations[index + 1] as number);
	}
	return { stations, errors: projections.map((projection) => projection.error) };
}

function createExplicitGroupMapping(
	paths: CompiledPhysicalPaths,
	members: readonly number[],
	explicit: ExplicitCompoundPathGroup & { geometry: OpenFabCompoundGeometry },
): ExplicitGroupMapping {
	const intervals = members.map((pathIndex) => ({
		pathIndex,
		start: 0,
		end: paths.lengths[pathIndex] as number,
	}));
	const projected = projectIntervalChain(paths, intervals, explicit.geometry);
	const boundaries = projected.stations.slice();
	boundaries[0] = 0;
	boundaries[boundaries.length - 1] = explicit.geometry.length;
	if (boundaries.length > 2 && explicit.lockedStartMeters) {
		boundaries[1] = Math.max(boundaries[1] as number, explicit.lockedStartMeters);
	}
	if (boundaries.length > 2 && explicit.lockedEndMeters) {
		boundaries[boundaries.length - 2] = Math.min(
			boundaries[boundaries.length - 2] as number,
			explicit.geometry.length - explicit.lockedEndMeters,
		);
	}
	for (let index = 1; index < boundaries.length; index++) {
		boundaries[index] = Math.max(boundaries[index - 1] as number, boundaries[index] as number);
	}
	for (let index = boundaries.length - 2; index >= 0; index--) {
		boundaries[index] = Math.min(boundaries[index] as number, boundaries[index + 1] as number);
	}
	const targetStarts = boundaries.slice(0, -1);
	const targetEnds = boundaries.slice(1);
	const projectionErrors = members.map((_, index) =>
		Math.max(projected.errors[index] ?? 0, projected.errors[index + 1] ?? 0),
	);
	const mapStation = (memberOffset: number, sourceStation: number): number => {
		const memberLength = paths.lengths[members[memberOffset] as number] as number;
		const targetStart = targetStarts[memberOffset] as number;
		const targetEnd = targetEnds[memberOffset] as number;
		if (memberLength <= SUPPORT_EPSILON) return targetStart;
		if (memberOffset === 0 && explicit.lockedStartMeters) {
			const lock = Math.min(memberLength, explicit.lockedStartMeters);
			if (sourceStation <= lock || memberLength - lock <= SUPPORT_EPSILON) {
				return Math.max(0, sourceStation);
			}
			return (
				lock +
				(targetEnd - lock) *
					Math.max(0, Math.min(1, (sourceStation - lock) / (memberLength - lock)))
			);
		}
		if (memberOffset === members.length - 1 && explicit.lockedEndMeters) {
			const lock = Math.min(memberLength, explicit.lockedEndMeters);
			const sourceSplit = memberLength - lock;
			const targetSplit = explicit.geometry.length - lock;
			if (sourceStation >= sourceSplit || sourceSplit <= SUPPORT_EPSILON) {
				return targetSplit + Math.max(0, sourceStation - sourceSplit);
			}
			return (
				targetStart +
				(targetSplit - targetStart) * Math.max(0, Math.min(1, sourceStation / sourceSplit))
			);
		}
		return (
			targetStart +
			(targetEnd - targetStart) * Math.max(0, Math.min(1, sourceStation / memberLength))
		);
	};
	return { targetStarts, targetEnds, projectionErrors, mapStation };
}

function compoundProfileType(type: CompoundRailPatternType): number {
	if (type === "RIGHT_CURVE") return COMPOUND_PROFILE_TYPE.RIGHT_CURVE;
	if (type === "CCW_CURVE") return COMPOUND_PROFILE_TYPE.CCW_CURVE;
	if (type === "S_CURVE") return COMPOUND_PROFILE_TYPE.S_CURVE;
	if (type === "CSC_CURVE_HOMO") return COMPOUND_PROFILE_TYPE.CSC_CURVE_HOMO;
	return COMPOUND_PROFILE_TYPE.CSC_CURVE_HETE;
}

function compoundFitKind(kind: CompoundFitKind): number {
	return kind === "MAP_EXACT" ? COMPOUND_PROFILE_FIT.MAP_EXACT : COMPOUND_PROFILE_FIT.GRID_FIT;
}

function compoundControlRoles(type: CompoundRailPatternType): readonly number[] {
	if (type === "RIGHT_CURVE" || type === "CCW_CURVE") {
		return [
			COMPOUND_CONTROL_ROLE.START,
			COMPOUND_CONTROL_ROLE.TMP_FROM,
			COMPOUND_CONTROL_ROLE.TMP_TO,
			COMPOUND_CONTROL_ROLE.END,
		];
	}
	return [
		COMPOUND_CONTROL_ROLE.START,
		COMPOUND_CONTROL_ROLE.TMP_FROM,
		COMPOUND_CONTROL_ROLE.ARC_1_END,
		COMPOUND_CONTROL_ROLE.ARC_2_START,
		COMPOUND_CONTROL_ROLE.TMP_TO,
		COMPOUND_CONTROL_ROLE.END,
	];
}

function emptyCompoundProfiles(): CompiledCompoundProfiles {
	return {
		count: 0,
		pathIndices: new Uint32Array(),
		advancedSwitchIds: new Uint32Array(),
		types: new Uint8Array(),
		geometryKinds: new Uint8Array(),
		fitKinds: new Uint8Array(),
		nominalProfileIndices: new Int16Array(),
		lateralSideSigns: new Int8Array(),
		compiledRadiusMillimeters: new Uint16Array(),
		compiledTurnAngleTenths: new Uint16Array(),
		compiledLeadInMillimeters: new Uint32Array(),
		compiledLeadOutMillimeters: new Uint32Array(),
		compiledMiddleMillimeters: new Uint32Array(),
		compiledLengthMillimeters: new Uint32Array(),
		leadInResidualMillimeters: new Int32Array(),
		leadOutResidualMillimeters: new Int32Array(),
		middleResidualMillimeters: new Int32Array(),
		lengthResidualMillimeters: new Int32Array(),
		forwardFitDeltaMillimeters: new Int32Array(),
		lateralFitDeltaMillimeters: new Int32Array(),
		fitReasonMasks: new Uint8Array(),
		controlOffsets: new Uint32Array(1),
		controlPoints: new Float32Array(),
		controlDistances: new Float32Array(),
		controlRoles: new Uint8Array(),
		memberOffsets: new Uint32Array(1),
		memberPathIndices: new Uint32Array(),
	};
}

function identityIntervalRemap(paths: CompiledPhysicalPaths): CompiledPathIntervalRemap {
	const sourcePathOffsets = new Uint32Array(paths.pathCount + 1);
	const sourceEnds: number[] = [];
	const targetPathIndices: number[] = [];
	const targetEnds: number[] = [];
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		sourcePathOffsets[pathIndex] = sourceEnds.length;
		const pathLength = paths.lengths[pathIndex] as number;
		if (pathLength <= SUPPORT_EPSILON) continue;
		sourceEnds.push(pathLength);
		targetPathIndices.push(pathIndex);
		targetEnds.push(pathLength);
	}
	sourcePathOffsets[paths.pathCount] = sourceEnds.length;
	return {
		count: sourceEnds.length,
		...copySourcePathMetadata(paths),
		sourcePathOffsets,
		sourceStarts: new Float32Array(sourceEnds.length),
		sourceEnds: new Float32Array(sourceEnds),
		targetPathIndices: new Uint32Array(targetPathIndices),
		targetStarts: new Float32Array(sourceEnds.length),
		targetEnds: new Float32Array(targetEnds),
		mappingKinds: new Uint8Array(sourceEnds.length),
		projectionErrors: new Float32Array(sourceEnds.length),
	};
}

function compileIntervalRemap(
	paths: CompiledPhysicalPaths,
	primaryTargetPathIndices: Uint32Array,
	sourcePathIndices: readonly number[],
	sourceStarts: readonly number[],
	sourceEnds: readonly number[],
	targetPathIndices: readonly number[],
	targetStarts: readonly number[],
	targetEnds: readonly number[],
	mappingKinds: readonly number[],
	projectionErrors: readonly number[],
): CompiledPathIntervalRemap {
	const rowsBySource = Array.from({ length: paths.pathCount }, () => [] as number[]);
	for (let index = 0; index < sourcePathIndices.length; index++) {
		rowsBySource[sourcePathIndices[index] as number]?.push(index);
	}
	for (const rows of rowsBySource) {
		rows.sort(
			(left, right) =>
				(sourceStarts[left] as number) - (sourceStarts[right] as number) ||
				(sourceEnds[left] as number) - (sourceEnds[right] as number),
		);
	}
	const offsets = new Uint32Array(paths.pathCount + 1);
	const orderedSourceStarts: number[] = [];
	const orderedSourceEnds: number[] = [];
	const orderedTargetPathIndices: number[] = [];
	const orderedTargetStarts: number[] = [];
	const orderedTargetEnds: number[] = [];
	const orderedMappingKinds: number[] = [];
	const orderedProjectionErrors: number[] = [];
	const append = (
		sourceStart: number,
		sourceEnd: number,
		targetPathIndex: number,
		targetStart: number,
		targetEnd: number,
		mappingKind: number,
		projectionError: number,
	): void => {
		if (sourceEnd - sourceStart <= SUPPORT_EPSILON) return;
		orderedSourceStarts.push(sourceStart);
		orderedSourceEnds.push(sourceEnd);
		orderedTargetPathIndices.push(targetPathIndex);
		orderedTargetStarts.push(targetStart);
		orderedTargetEnds.push(targetEnd);
		orderedMappingKinds.push(mappingKind);
		orderedProjectionErrors.push(projectionError);
	};
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		offsets[pathIndex] = orderedSourceStarts.length;
		const pathLength = paths.lengths[pathIndex] as number;
		if (pathLength <= SUPPORT_EPSILON) continue;
		const rows = rowsBySource[pathIndex] as number[];
		let cursor = 0;
		let fallbackTargetPath = primaryTargetPathIndices[pathIndex] as number;
		let fallbackTargetStation = 0;
		for (const row of rows) {
			const sourceStart = sourceStarts[row] as number;
			const sourceEnd = sourceEnds[row] as number;
			if (sourceStart < cursor - SUPPORT_EPSILON) {
				throw new Error(`Source remap rows overlap on raw path ${pathIndex}.`);
			}
			if (sourceStart > cursor + SUPPORT_EPSILON) {
				append(
					cursor,
					sourceStart,
					fallbackTargetPath,
					fallbackTargetStation,
					fallbackTargetStation,
					PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE,
					0,
				);
			}
			append(
				sourceStart,
				sourceEnd,
				targetPathIndices[row] as number,
				targetStarts[row] as number,
				targetEnds[row] as number,
				mappingKinds[row] as number,
				projectionErrors[row] as number,
			);
			cursor = sourceEnd;
			fallbackTargetPath = targetPathIndices[row] as number;
			fallbackTargetStation = targetEnds[row] as number;
		}
		if (cursor < pathLength - SUPPORT_EPSILON) {
			append(
				cursor,
				pathLength,
				fallbackTargetPath,
				fallbackTargetStation,
				fallbackTargetStation,
				PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE,
				0,
			);
		}
	}
	offsets[paths.pathCount] = orderedSourceStarts.length;
	return {
		count: orderedSourceStarts.length,
		...copySourcePathMetadata(paths),
		sourcePathOffsets: offsets,
		sourceStarts: new Float32Array(orderedSourceStarts),
		sourceEnds: new Float32Array(orderedSourceEnds),
		targetPathIndices: new Uint32Array(orderedTargetPathIndices),
		targetStarts: new Float32Array(orderedTargetStarts),
		targetEnds: new Float32Array(orderedTargetEnds),
		mappingKinds: new Uint8Array(orderedMappingKinds),
		projectionErrors: new Float32Array(orderedProjectionErrors),
	};
}

function copySourcePathMetadata(
	paths: CompiledPhysicalPaths,
): Pick<
	CompiledPathIntervalRemap,
	| "sourcePathCount"
	| "sourcePathCells"
	| "sourcePathKinds"
	| "sourcePathFromDirections"
	| "sourcePathToDirections"
	| "sourceIdentityKinds"
	| "sourceAdvancedSwitchIds"
	| "sourceAdvancedSwitchProfileClasses"
	| "sourceAdvancedSwitchRoles"
	| "sourceAdvancedSwitchPorts"
	| "sourceAdvancedSwitchSegmentOrdinals"
	| "sourcePathCanonicalStarts"
	| "sourcePathLengths"
> {
	const sourcePathCanonicalStarts = new Float32Array(paths.pathCount);
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		const outgoingTerminalOffset =
			paths.kinds[pathIndex] === PATH_KIND.TERMINAL &&
			paths.fromDirections[pathIndex] === 0 &&
			paths.toDirections[pathIndex] !== 0
				? 0.5
				: 0;
		sourcePathCanonicalStarts[pathIndex] =
			(paths.startInsets[pathIndex] as number) -
			(paths.startExtensions[pathIndex] as number) +
			outgoingTerminalOffset;
	}
	return {
		sourcePathCount: paths.pathCount,
		sourcePathCells: paths.cells.slice(),
		sourcePathKinds: paths.kinds.slice(),
		sourcePathFromDirections: paths.fromDirections.slice(),
		sourcePathToDirections: paths.toDirections.slice(),
		sourceIdentityKinds: new Uint8Array(paths.pathCount),
		sourceAdvancedSwitchIds: new Uint32Array(paths.pathCount),
		sourceAdvancedSwitchProfileClasses: filledUint8(
			paths.pathCount,
			NO_ADVANCED_SWITCH_PROFILE_CLASS,
		),
		sourceAdvancedSwitchRoles: filledUint8(paths.pathCount, NO_ADVANCED_SWITCH_SEGMENT_ROLE),
		sourceAdvancedSwitchPorts: filledUint8(paths.pathCount, NO_ADVANCED_SWITCH_SEGMENT_PORT),
		sourceAdvancedSwitchSegmentOrdinals: filledUint16(
			paths.pathCount,
			NO_ADVANCED_SWITCH_SEGMENT_ORDINAL,
		),
		sourcePathCanonicalStarts,
		sourcePathLengths: paths.lengths.slice(),
	};
}

function filledUint8(length: number, value: number): Uint8Array {
	const result = new Uint8Array(length);
	result.fill(value);
	return result;
}

function filledUint16(length: number, value: number): Uint16Array {
	const result = new Uint16Array(length);
	result.fill(value);
	return result;
}

function sourceType(kind: number, incoming: number, outgoing: number): CompoundSourceType | null {
	if (kind === PATH_KIND.LINEAR) return "LINEAR";
	const incomingSide = asDirection(incoming);
	const outgoingSide = asDirection(outgoing);
	if (!incomingSide || !outgoingSide) return null;
	const incomingTravel = directionVector(oppositeDirection(incomingSide));
	const outgoingTravel = directionVector(outgoingSide);
	const cross = incomingTravel.x * outgoingTravel.y - incomingTravel.y * outgoingTravel.x;
	if (cross > 0) return "RIGHT_CURVE";
	if (cross < 0) return "LEFT_CURVE";
	return null;
}

function compoundPathKind(type: CompoundRailPatternType): PhysicalPathKind {
	if (type === "RIGHT_CURVE") return PATH_KIND.COMPOUND_RIGHT;
	if (type === "CCW_CURVE") return PATH_KIND.COMPOUND_CCW;
	if (type === "S_CURVE") return PATH_KIND.COMPOUND_S;
	if (type === "CSC_CURVE_HOMO") return PATH_KIND.COMPOUND_CSC_HOMO;
	return PATH_KIND.COMPOUND_CSC_HETE;
}

function asDirection(value: number): Direction | null {
	return ALL_DIRECTIONS.find((direction) => direction === value) ?? null;
}

function directionVector(direction: Direction): { x: number; y: number } {
	if (direction === 1) return { x: 0, y: -1 };
	if (direction === 2) return { x: 1, y: 0 };
	if (direction === 4) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}
