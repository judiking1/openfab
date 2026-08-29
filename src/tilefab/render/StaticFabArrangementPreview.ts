import {
	STATIC_FAB_ARRANGEMENT_MAX_ROOTS,
	type StaticFabArrangementBounds,
	type StaticFabArrangementRoot,
	type StaticFabArrangementTranslation,
} from "../core/StaticFabArrangement";
import type { StaticFabArrangementPlan } from "../core/StaticFabArrangementPlan";
import { type Cell, cellKey } from "../core/TileMap";

export const STATIC_FAB_ARRANGEMENT_PREVIEW_ARTIFACT_KIND =
	"static-fab-arrangement-preview-artifact" as const;
export const STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS = 16;
export const STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_REPORTED_CONFLICTS = 128;
export const STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_EXACT_TARGET_CELLS = 20_000;

export type StaticFabArrangementPreviewPhase = "planning" | "certified" | "rejected";

export interface StaticFabArrangementPreviewRoot {
	readonly index: number;
	readonly key: string;
	readonly sourceBounds: StaticFabArrangementBounds;
	readonly targetBounds: StaticFabArrangementBounds;
	readonly deltaX: number;
	readonly deltaZ: number;
}

export interface StaticFabArrangementPreviewFootprintRoot {
	readonly key: string;
	readonly ownerships: readonly {
		readonly footprintCells: readonly Readonly<Cell>[];
	}[];
	readonly equipmentGroupIds?: readonly number[];
}

/** Minimal derived equipment geometry needed to preview a rigid FAB translation. */
export interface StaticFabArrangementPreviewEquipmentPresentation {
	readonly groupIds: Int32Array;
	readonly groupPortOffsets: Uint32Array;
	readonly groupPortRows: Uint32Array;
	readonly worldPositions: Float32Array;
	readonly groupBodySectionOffsets: Uint32Array;
	readonly bodySectionCenters: Float32Array;
	readonly bodySectionTangents: Float32Array;
	readonly bodySectionHalfExtents: Float32Array;
	readonly bodySectionBounds: Float32Array;
}

export interface StaticFabArrangementPreviewPortPoint {
	readonly x: number;
	readonly z: number;
}

export interface StaticFabArrangementPreviewEquipmentSection {
	readonly centerX: number;
	readonly centerZ: number;
	readonly tangentX: number;
	readonly tangentZ: number;
	readonly halfLength: number;
	readonly halfWidth: number;
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

export interface PreparedStaticFabArrangementTargetPreview {
	readonly cells: readonly Cell[] | undefined;
	readonly ports: readonly StaticFabArrangementPreviewPortPoint[];
	readonly equipmentSections: readonly StaticFabArrangementPreviewEquipmentSection[];
	readonly omitted: boolean;
}

/** Compact apply-only identity; renderer previews never retain this complete coordinate set. */
export interface StaticFabArrangementSelectionIdentity {
	readonly cellCount: number;
	has(x: number, z: number): boolean;
}

export const EMPTY_STATIC_FAB_ARRANGEMENT_TARGET_PREVIEW: PreparedStaticFabArrangementTargetPreview =
	Object.freeze({
		cells: undefined,
		ports: Object.freeze([]),
		equipmentSections: Object.freeze([]),
		omitted: false,
	});

/** Target and conflict rows are contiguous in the artifact's private typed arrays. */
export interface StaticFabArrangementPreviewChunk {
	readonly chunkX: number;
	readonly chunkZ: number;
	readonly minX: number;
	readonly minZ: number;
	readonly maxXExclusive: number;
	readonly maxZExclusive: number;
	readonly targetCellStart: number;
	readonly targetCellCount: number;
	readonly conflictStart: number;
	readonly conflictCount: number;
}

/** Sparse center-point index for translated ports and derived equipment sections. */
export interface StaticFabArrangementPreviewPresentationChunk {
	readonly chunkX: number;
	readonly chunkZ: number;
	readonly portIndexStart: number;
	readonly portIndexCount: number;
	readonly equipmentSectionIndexStart: number;
	readonly equipmentSectionIndexCount: number;
}

/**
 * Immutable presentation data prepared outside the render loop. Typed arrays stay private so a
 * renderer can read large exact plans without exposing mutable ArrayBuffer views.
 */
export interface StaticFabArrangementPreviewArtifact {
	readonly kind: typeof STATIC_FAB_ARRANGEMENT_PREVIEW_ARTIFACT_KIND;
	readonly phase: StaticFabArrangementPreviewPhase;
	readonly reason: string;
	readonly roots: readonly StaticFabArrangementPreviewRoot[];
	readonly rootCount: number;
	readonly hasExactTargetCells: boolean;
	readonly targetCellsOmitted: boolean;
	readonly targetCellCount: number;
	readonly targetPortCount: number;
	readonly targetEquipmentSectionCount: number;
	readonly reportedConflictCount: number;
	readonly totalConflictCount: number;
	readonly conflictsTruncated: boolean;
	readonly chunks: readonly StaticFabArrangementPreviewChunk[];
	readonly chunkCount: number;
	readChunk(chunkX: number, chunkZ: number): StaticFabArrangementPreviewChunk | null;
	readonly presentationChunks: readonly StaticFabArrangementPreviewPresentationChunk[];
	readonly presentationChunkCount: number;
	readonly equipmentSectionQueryMarginMeters: number;
	readPresentationChunk(
		chunkX: number,
		chunkZ: number,
	): StaticFabArrangementPreviewPresentationChunk | null;
	presentationPortIndex(index: number): number;
	presentationEquipmentSectionIndex(index: number): number;
	targetCellX(index: number): number;
	targetCellZ(index: number): number;
	targetPortX(index: number): number;
	targetPortZ(index: number): number;
	targetEquipmentSectionCenterX(index: number): number;
	targetEquipmentSectionCenterZ(index: number): number;
	targetEquipmentSectionTangentX(index: number): number;
	targetEquipmentSectionTangentZ(index: number): number;
	targetEquipmentSectionHalfLength(index: number): number;
	targetEquipmentSectionHalfWidth(index: number): number;
	targetEquipmentSectionMinX(index: number): number;
	targetEquipmentSectionMinZ(index: number): number;
	targetEquipmentSectionMaxX(index: number): number;
	targetEquipmentSectionMaxZ(index: number): number;
	conflictX(index: number): number;
	conflictZ(index: number): number;
}

export interface CreateStaticFabArrangementPreviewArtifactInput {
	readonly phase: StaticFabArrangementPreviewPhase;
	readonly roots: readonly StaticFabArrangementRoot[];
	/** Uses `plan.arrangement.translations` when omitted. */
	readonly translations?: readonly StaticFabArrangementTranslation[];
	/** A certified valid plan supplies identity and rejected plans supply conflicts. */
	readonly plan?: StaticFabArrangementPlan | null;
	/** Complete translated rail footprint, prepared outside the render loop. */
	readonly exactTargetCells?: readonly Readonly<Cell>[];
	/** Exact translated authored port points and derived equipment body sections. */
	readonly targetPorts?: readonly StaticFabArrangementPreviewPortPoint[];
	readonly targetEquipmentSections?: readonly StaticFabArrangementPreviewEquipmentSection[];
	/** Set when a large target intentionally falls back to bounds-only rendering. */
	readonly targetCellsOmitted?: boolean;
	readonly conflicts?: readonly Readonly<Cell>[];
	readonly reason?: string;
}

interface MutablePreviewChunk {
	readonly chunkX: number;
	readonly chunkZ: number;
	readonly targetCells: Cell[];
	readonly conflicts: Cell[];
}

interface MutablePresentationChunk {
	readonly chunkX: number;
	readonly chunkZ: number;
	readonly portIndexes: number[];
	readonly equipmentSectionIndexes: number[];
}

/** Prepare the complete translated rail footprint once, with a bounds-only large-FAB fallback. */
export function prepareStaticFabArrangementTargetPreview(
	roots: readonly StaticFabArrangementPreviewFootprintRoot[],
	translations: readonly StaticFabArrangementTranslation[],
	equipmentPresentation: StaticFabArrangementPreviewEquipmentPresentation | null = null,
): PreparedStaticFabArrangementTargetPreview {
	if (roots.length === 0 || translations.length !== roots.length) {
		return EMPTY_STATIC_FAB_ARRANGEMENT_TARGET_PREVIEW;
	}
	const translationByKey = new Map(
		translations.map((translation) => [translation.key, translation]),
	);
	let exactCellKeys: Set<string> | null = new Set<string>();
	let cells: Cell[] | null = [];
	const ports: StaticFabArrangementPreviewPortPoint[] = [];
	const equipmentSections: StaticFabArrangementPreviewEquipmentSection[] = [];
	const groupRowById = new Map<number, number>();
	if (equipmentPresentation) {
		for (let row = 0; row < equipmentPresentation.groupIds.length; row++) {
			groupRowById.set(equipmentPresentation.groupIds[row] as number, row);
		}
	}
	const visitedPortRows = new Set<number>();
	const visitedBodySectionRows = new Set<number>();
	for (const root of roots) {
		const translation = translationByKey.get(root.key);
		if (!translation) return EMPTY_STATIC_FAB_ARRANGEMENT_TARGET_PREVIEW;
		for (const ownership of root.ownerships) {
			for (const source of ownership.footprintCells) {
				const x = source.x + translation.deltaX;
				const y = source.y + translation.deltaZ;
				if (!isInt32(x) || !isInt32(y)) {
					throw new Error("Static FAB arrangement target footprint is invalid");
				}
				if (!exactCellKeys || !cells) continue;
				const key = cellKey(x, y);
				if (exactCellKeys.has(key)) continue;
				if (cells.length >= STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_EXACT_TARGET_CELLS) {
					exactCellKeys = null;
					cells = null;
				} else {
					exactCellKeys.add(key);
					cells.push(Object.freeze({ x, y }));
				}
			}
		}
		if (!equipmentPresentation) continue;
		for (const groupId of root.equipmentGroupIds ?? []) {
			const groupRow = groupRowById.get(groupId);
			if (groupRow === undefined) return EMPTY_STATIC_FAB_ARRANGEMENT_TARGET_PREVIEW;
			const portStart = equipmentPresentation.groupPortOffsets[groupRow] as number;
			const portEnd = equipmentPresentation.groupPortOffsets[groupRow + 1] as number;
			for (let offset = portStart; offset < portEnd; offset++) {
				const portRow = equipmentPresentation.groupPortRows[offset] as number;
				if (visitedPortRows.has(portRow)) continue;
				visitedPortRows.add(portRow);
				ports.push(
					freezePortPoint(
						(equipmentPresentation.worldPositions[portRow * 2] as number) + translation.deltaX,
						(equipmentPresentation.worldPositions[portRow * 2 + 1] as number) + translation.deltaZ,
					),
				);
			}
			const sectionStart = equipmentPresentation.groupBodySectionOffsets[groupRow] as number;
			const sectionEnd = equipmentPresentation.groupBodySectionOffsets[groupRow + 1] as number;
			for (let sectionRow = sectionStart; sectionRow < sectionEnd; sectionRow++) {
				if (visitedBodySectionRows.has(sectionRow)) continue;
				visitedBodySectionRows.add(sectionRow);
				equipmentSections.push(
					freezeEquipmentSection(equipmentPresentation, sectionRow, translation),
				);
			}
		}
	}
	const omitted = cells === null;
	return Object.freeze({
		cells: cells ? Object.freeze(cells) : undefined,
		ports: Object.freeze(ports),
		equipmentSections: Object.freeze(equipmentSections),
		omitted,
	});
}

/** Build full translated selection membership only at apply time using packed uint64 coordinates. */
export function prepareStaticFabArrangementSelectionIdentity(
	roots: readonly StaticFabArrangementPreviewFootprintRoot[],
	translations: readonly StaticFabArrangementTranslation[],
): StaticFabArrangementSelectionIdentity | null {
	if (roots.length === 0 || translations.length !== roots.length) return null;
	const translationByKey = new Map(
		translations.map((translation) => [translation.key, translation]),
	);
	let coordinateCount = 0;
	for (const root of roots) {
		if (!translationByKey.has(root.key)) return null;
		for (const ownership of root.ownerships) {
			coordinateCount += ownership.footprintCells.length;
			if (!Number.isSafeInteger(coordinateCount) || coordinateCount > 0x7fff_ffff) {
				throw new Error("Static FAB arrangement selection identity is too large");
			}
		}
	}
	if (coordinateCount === 0) return null;
	const packed = new BigUint64Array(coordinateCount);
	let offset = 0;
	for (const root of roots) {
		const translation = translationByKey.get(root.key);
		if (!translation) return null;
		for (const ownership of root.ownerships) {
			for (const source of ownership.footprintCells) {
				const x = source.x + translation.deltaX;
				const z = source.y + translation.deltaZ;
				if (!isInt32(x) || !isInt32(z)) {
					throw new Error("Static FAB arrangement selection identity is invalid");
				}
				packed[offset++] = packCellCoordinate(x, z);
			}
		}
	}
	packed.sort();
	let uniqueCount = 0;
	for (let index = 0; index < packed.length; index++) {
		const key = packed[index] as bigint;
		if (uniqueCount > 0 && packed[uniqueCount - 1] === key) continue;
		packed[uniqueCount++] = key;
	}
	const keys = uniqueCount === packed.length ? packed : packed.slice(0, uniqueCount);
	return Object.freeze({
		cellCount: uniqueCount,
		has: (x: number, z: number) => packedCellCoordinateIncludes(keys, x, z),
	});
}

/**
 * Prepare one stable renderer artifact. This is intentionally not a committable model and never
 * mutates or retains caller-owned geometry.
 */
export function createStaticFabArrangementPreviewArtifact(
	input: CreateStaticFabArrangementPreviewArtifactInput,
): StaticFabArrangementPreviewArtifact {
	if (!isPhase(input.phase)) throw new Error("Static FAB arrangement preview phase is invalid");
	if (input.roots.length === 0 || input.roots.length > STATIC_FAB_ARRANGEMENT_MAX_ROOTS) {
		throw new Error(
			`Static FAB arrangement preview requires 1-${STATIC_FAB_ARRANGEMENT_MAX_ROOTS} roots`,
		);
	}
	if (input.phase === "certified" && (!input.plan?.valid || !input.plan.arrangement)) {
		throw new Error("Certified Static FAB arrangement preview requires a valid exact plan");
	}
	if (input.plan?.valid && !input.plan.arrangement) {
		throw new Error("Valid Static FAB arrangement preview plan is missing arrangement metadata");
	}

	const planTranslations = input.plan?.valid ? input.plan.arrangement?.translations : undefined;
	if (
		planTranslations &&
		input.translations &&
		!sameTranslationSet(planTranslations, input.translations)
	) {
		throw new Error("Certified Static FAB arrangement preview translations diverge from its plan");
	}
	const translations = planTranslations ?? input.translations ?? [];
	if (
		input.plan?.valid &&
		(input.plan.arrangement?.rootCount !== input.roots.length ||
			translations.length !== input.roots.length)
	) {
		throw new Error("Exact Static FAB arrangement preview plan does not match the selected roots");
	}
	const translationByKey = validateTranslations(input.roots, translations);
	const roots = freezePreviewRoots(input.roots, translationByKey);
	const exactTargetCells = collectExactTargetCells(input.exactTargetCells);
	const targetPorts = collectTargetPorts(input.targetPorts ?? []);
	const targetEquipmentSections = collectTargetEquipmentSections(
		input.targetEquipmentSections ?? [],
	);
	const conflicts = collectConflicts(input.plan?.conflicts ?? [], input.conflicts ?? []);
	const storage = buildChunkStorage(exactTargetCells.cells, conflicts.reported);
	const presentationStorage = buildPresentationChunkStorage(targetPorts, targetEquipmentSections);
	const reason =
		input.reason ??
		input.plan?.reason ??
		(input.phase === "planning"
			? "Static FAB arrangement is being planned"
			: input.phase === "certified"
				? "Static FAB arrangement is certified"
				: "Static FAB arrangement was rejected");

	return Object.freeze({
		kind: STATIC_FAB_ARRANGEMENT_PREVIEW_ARTIFACT_KIND,
		phase: input.phase,
		reason,
		roots,
		rootCount: roots.length,
		hasExactTargetCells: exactTargetCells.provided && !exactTargetCells.omitted,
		targetCellsOmitted: input.targetCellsOmitted === true || exactTargetCells.omitted,
		targetCellCount: storage.targetX.length,
		targetPortCount: targetPorts.x.length,
		targetEquipmentSectionCount: targetEquipmentSections.centerX.length,
		reportedConflictCount: storage.conflictX.length,
		totalConflictCount: conflicts.total,
		conflictsTruncated: conflicts.total > storage.conflictX.length,
		chunks: storage.chunks,
		chunkCount: storage.chunks.length,
		readChunk: (chunkX: number, chunkZ: number) =>
			storage.chunkRows.get(chunkZ)?.get(chunkX) ?? null,
		presentationChunks: presentationStorage.chunks,
		presentationChunkCount: presentationStorage.chunks.length,
		equipmentSectionQueryMarginMeters: presentationStorage.equipmentSectionQueryMarginMeters,
		readPresentationChunk: (chunkX: number, chunkZ: number) =>
			presentationStorage.chunkRows.get(chunkZ)?.get(chunkX) ?? null,
		presentationPortIndex: (index: number) =>
			readCoordinate(presentationStorage.portIndexes, index, "presentation port"),
		presentationEquipmentSectionIndex: (index: number) =>
			readCoordinate(
				presentationStorage.equipmentSectionIndexes,
				index,
				"presentation equipment section",
			),
		targetCellX: (index: number) => readCoordinate(storage.targetX, index, "target cell"),
		targetCellZ: (index: number) => readCoordinate(storage.targetZ, index, "target cell"),
		targetPortX: (index: number) => readCoordinate(targetPorts.x, index, "target port"),
		targetPortZ: (index: number) => readCoordinate(targetPorts.z, index, "target port"),
		targetEquipmentSectionCenterX: (index: number) =>
			readCoordinate(targetEquipmentSections.centerX, index, "target equipment section"),
		targetEquipmentSectionCenterZ: (index: number) =>
			readCoordinate(targetEquipmentSections.centerZ, index, "target equipment section"),
		targetEquipmentSectionTangentX: (index: number) =>
			readCoordinate(targetEquipmentSections.tangentX, index, "target equipment section"),
		targetEquipmentSectionTangentZ: (index: number) =>
			readCoordinate(targetEquipmentSections.tangentZ, index, "target equipment section"),
		targetEquipmentSectionHalfLength: (index: number) =>
			readCoordinate(targetEquipmentSections.halfLength, index, "target equipment section"),
		targetEquipmentSectionHalfWidth: (index: number) =>
			readCoordinate(targetEquipmentSections.halfWidth, index, "target equipment section"),
		targetEquipmentSectionMinX: (index: number) =>
			readCoordinate(targetEquipmentSections.minX, index, "target equipment section"),
		targetEquipmentSectionMinZ: (index: number) =>
			readCoordinate(targetEquipmentSections.minZ, index, "target equipment section"),
		targetEquipmentSectionMaxX: (index: number) =>
			readCoordinate(targetEquipmentSections.maxX, index, "target equipment section"),
		targetEquipmentSectionMaxZ: (index: number) =>
			readCoordinate(targetEquipmentSections.maxZ, index, "target equipment section"),
		conflictX: (index: number) => readCoordinate(storage.conflictX, index, "conflict"),
		conflictZ: (index: number) => readCoordinate(storage.conflictZ, index, "conflict"),
	});
}

function validateTranslations(
	roots: readonly StaticFabArrangementRoot[],
	translations: readonly StaticFabArrangementTranslation[],
): ReadonlyMap<string, StaticFabArrangementTranslation> {
	if (translations.length !== 0 && translations.length !== roots.length) {
		throw new Error("Static FAB arrangement preview translations must cover every root");
	}
	const rootByKey = new Map<string, StaticFabArrangementRoot>();
	for (const root of roots) {
		if (rootByKey.has(root.key))
			throw new Error(`Duplicate arrangement preview root '${root.key}'`);
		if (!validBounds(root.bounds)) {
			throw new Error(`Arrangement preview root '${root.key}' has invalid bounds`);
		}
		rootByKey.set(root.key, root);
	}

	const byKey = new Map<string, StaticFabArrangementTranslation>();
	for (const translation of translations) {
		const root = rootByKey.get(translation.key);
		if (!root || byKey.has(translation.key)) {
			throw new Error(
				`Arrangement preview translation '${translation.key}' is unknown or duplicated`,
			);
		}
		if (
			!isInt32(translation.deltaX) ||
			!isInt32(translation.deltaZ) ||
			!sameBounds(root.bounds, translation.before) ||
			!validBounds(translation.after) ||
			!translatedBoundsMatch(translation)
		) {
			throw new Error(`Arrangement preview translation '${translation.key}' is inconsistent`);
		}
		byKey.set(translation.key, translation);
	}
	return byKey;
}

function freezePreviewRoots(
	roots: readonly StaticFabArrangementRoot[],
	translationByKey: ReadonlyMap<string, StaticFabArrangementTranslation>,
): readonly StaticFabArrangementPreviewRoot[] {
	return Object.freeze(
		roots.map((root, index) => {
			const translation = translationByKey.get(root.key);
			const sourceBounds = freezeBounds(root.bounds);
			const targetBounds = translation ? freezeBounds(translation.after) : sourceBounds;
			return Object.freeze({
				index,
				key: root.key,
				sourceBounds,
				targetBounds,
				deltaX: translation?.deltaX ?? 0,
				deltaZ: translation?.deltaZ ?? 0,
			});
		}),
	);
}

function collectExactTargetCells(
	cells: readonly Readonly<Cell>[] | undefined,
): Readonly<{ cells: readonly Cell[]; provided: boolean; omitted: boolean }> {
	if (!cells) return Object.freeze({ cells: Object.freeze([]), provided: false, omitted: false });
	if (cells.length > STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_EXACT_TARGET_CELLS) {
		return Object.freeze({ cells: Object.freeze([]), provided: true, omitted: true });
	}
	const byKey = new Map<string, Cell>();
	for (const cell of cells) {
		addCell(byKey, cell.x, cell.y, "exact target");
	}
	return Object.freeze({
		cells: Object.freeze([...byKey.values()]),
		provided: true,
		omitted: false,
	});
}

function collectTargetPorts(
	ports: readonly StaticFabArrangementPreviewPortPoint[],
): Readonly<{ x: Float64Array; z: Float64Array }> {
	const x = new Float64Array(ports.length);
	const z = new Float64Array(ports.length);
	for (let index = 0; index < ports.length; index++) {
		const port = ports[index];
		if (!port || !Number.isFinite(port.x) || !Number.isFinite(port.z)) {
			throw new Error("Static FAB arrangement target port is invalid");
		}
		x[index] = port.x;
		z[index] = port.z;
	}
	return Object.freeze({ x, z });
}

function collectTargetEquipmentSections(
	sections: readonly StaticFabArrangementPreviewEquipmentSection[],
): Readonly<{
	centerX: Float64Array;
	centerZ: Float64Array;
	tangentX: Float64Array;
	tangentZ: Float64Array;
	halfLength: Float64Array;
	halfWidth: Float64Array;
	minX: Float64Array;
	minZ: Float64Array;
	maxX: Float64Array;
	maxZ: Float64Array;
}> {
	const centerX = new Float64Array(sections.length);
	const centerZ = new Float64Array(sections.length);
	const tangentX = new Float64Array(sections.length);
	const tangentZ = new Float64Array(sections.length);
	const halfLength = new Float64Array(sections.length);
	const halfWidth = new Float64Array(sections.length);
	const minX = new Float64Array(sections.length);
	const minZ = new Float64Array(sections.length);
	const maxX = new Float64Array(sections.length);
	const maxZ = new Float64Array(sections.length);
	for (let index = 0; index < sections.length; index++) {
		const section = sections[index];
		if (!section || !validEquipmentSection(section)) {
			throw new Error("Static FAB arrangement target equipment section is invalid");
		}
		centerX[index] = section.centerX;
		centerZ[index] = section.centerZ;
		tangentX[index] = section.tangentX;
		tangentZ[index] = section.tangentZ;
		halfLength[index] = section.halfLength;
		halfWidth[index] = section.halfWidth;
		minX[index] = section.minX;
		minZ[index] = section.minZ;
		maxX[index] = section.maxX;
		maxZ[index] = section.maxZ;
	}
	return Object.freeze({
		centerX,
		centerZ,
		tangentX,
		tangentZ,
		halfLength,
		halfWidth,
		minX,
		minZ,
		maxX,
		maxZ,
	});
}

function collectConflicts(
	planConflicts: readonly Readonly<Cell>[],
	additionalConflicts: readonly Readonly<Cell>[],
): Readonly<{ total: number; reported: readonly Cell[] }> {
	const keys = new Set<string>();
	const reported: Cell[] = [];
	const collect = (cells: readonly Readonly<Cell>[]): void => {
		for (const cell of cells) {
			if (!isInt32(cell.x) || !isInt32(cell.y)) {
				throw new Error("Static FAB arrangement preview conflict coordinate is invalid");
			}
			const key = cellKey(cell.x, cell.y);
			if (keys.has(key)) continue;
			keys.add(key);
			if (reported.length < STATIC_FAB_ARRANGEMENT_PREVIEW_MAX_REPORTED_CONFLICTS) {
				reported.push({ x: cell.x, y: cell.y });
			}
		}
	};
	collect(planConflicts);
	collect(additionalConflicts);
	return Object.freeze({ total: keys.size, reported: Object.freeze(reported) });
}

function buildChunkStorage(targetCells: readonly Cell[], conflicts: readonly Cell[]) {
	const mutableByKey = new Map<string, MutablePreviewChunk>();
	const mutableChunk = (x: number, z: number): MutablePreviewChunk => {
		const chunkX = Math.floor(x / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS);
		const chunkZ = Math.floor(z / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS);
		const key = `${chunkX}:${chunkZ}`;
		let chunk = mutableByKey.get(key);
		if (!chunk) {
			chunk = { chunkX, chunkZ, targetCells: [], conflicts: [] };
			mutableByKey.set(key, chunk);
		}
		return chunk;
	};
	for (const cell of targetCells) mutableChunk(cell.x, cell.y).targetCells.push(cell);
	for (const cell of conflicts) mutableChunk(cell.x, cell.y).conflicts.push(cell);

	const mutableChunks = [...mutableByKey.values()].sort(compareMutableChunks);
	const targetX = new Int32Array(targetCells.length);
	const targetZ = new Int32Array(targetCells.length);
	const conflictX = new Int32Array(conflicts.length);
	const conflictZ = new Int32Array(conflicts.length);
	const chunks: StaticFabArrangementPreviewChunk[] = [];
	const chunkRows = new Map<number, Map<number, StaticFabArrangementPreviewChunk>>();
	let targetOffset = 0;
	let conflictOffset = 0;
	for (const mutable of mutableChunks) {
		mutable.targetCells.sort(compareCells);
		mutable.conflicts.sort(compareCells);
		const targetCellStart = targetOffset;
		for (const cell of mutable.targetCells) {
			targetX[targetOffset] = cell.x;
			targetZ[targetOffset] = cell.y;
			targetOffset++;
		}
		const conflictStart = conflictOffset;
		for (const cell of mutable.conflicts) {
			conflictX[conflictOffset] = cell.x;
			conflictZ[conflictOffset] = cell.y;
			conflictOffset++;
		}
		const minX = mutable.chunkX * STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS;
		const minZ = mutable.chunkZ * STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS;
		const chunk = Object.freeze({
			chunkX: mutable.chunkX,
			chunkZ: mutable.chunkZ,
			minX,
			minZ,
			maxXExclusive: minX + STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
			maxZExclusive: minZ + STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS,
			targetCellStart,
			targetCellCount: targetOffset - targetCellStart,
			conflictStart,
			conflictCount: conflictOffset - conflictStart,
		});
		chunks.push(chunk);
		let row = chunkRows.get(chunk.chunkZ);
		if (!row) {
			row = new Map();
			chunkRows.set(chunk.chunkZ, row);
		}
		row.set(chunk.chunkX, chunk);
	}

	return Object.freeze({
		targetX,
		targetZ,
		conflictX,
		conflictZ,
		chunks: Object.freeze(chunks),
		chunkRows,
	});
}

function buildPresentationChunkStorage(
	ports: Readonly<{ x: Float64Array; z: Float64Array }>,
	sections: Readonly<{
		centerX: Float64Array;
		centerZ: Float64Array;
		minX: Float64Array;
		minZ: Float64Array;
		maxX: Float64Array;
		maxZ: Float64Array;
	}>,
) {
	const mutableByKey = new Map<string, MutablePresentationChunk>();
	const mutableChunk = (x: number, z: number): MutablePresentationChunk => {
		const chunkX = Math.floor(x / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS);
		const chunkZ = Math.floor(z / STATIC_FAB_ARRANGEMENT_PREVIEW_CHUNK_METERS);
		const key = `${chunkX}:${chunkZ}`;
		let chunk = mutableByKey.get(key);
		if (!chunk) {
			chunk = { chunkX, chunkZ, portIndexes: [], equipmentSectionIndexes: [] };
			mutableByKey.set(key, chunk);
		}
		return chunk;
	};
	for (let index = 0; index < ports.x.length; index++) {
		mutableChunk(ports.x[index] as number, ports.z[index] as number).portIndexes.push(index);
	}
	let equipmentSectionQueryMarginMeters = 0;
	for (let index = 0; index < sections.centerX.length; index++) {
		const centerX = sections.centerX[index] as number;
		const centerZ = sections.centerZ[index] as number;
		mutableChunk(centerX, centerZ).equipmentSectionIndexes.push(index);
		equipmentSectionQueryMarginMeters = Math.max(
			equipmentSectionQueryMarginMeters,
			Math.abs((sections.minX[index] as number) - centerX),
			Math.abs((sections.maxX[index] as number) - centerX),
			Math.abs((sections.minZ[index] as number) - centerZ),
			Math.abs((sections.maxZ[index] as number) - centerZ),
		);
	}

	const mutableChunks = [...mutableByKey.values()].sort(
		(left, right) => left.chunkZ - right.chunkZ || left.chunkX - right.chunkX,
	);
	const portIndexes = new Uint32Array(ports.x.length);
	const equipmentSectionIndexes = new Uint32Array(sections.centerX.length);
	const chunks: StaticFabArrangementPreviewPresentationChunk[] = [];
	const chunkRows = new Map<number, Map<number, StaticFabArrangementPreviewPresentationChunk>>();
	let portOffset = 0;
	let equipmentSectionOffset = 0;
	for (const mutable of mutableChunks) {
		mutable.portIndexes.sort((left, right) => left - right);
		mutable.equipmentSectionIndexes.sort((left, right) => left - right);
		const portIndexStart = portOffset;
		for (const index of mutable.portIndexes) portIndexes[portOffset++] = index;
		const equipmentSectionIndexStart = equipmentSectionOffset;
		for (const index of mutable.equipmentSectionIndexes) {
			equipmentSectionIndexes[equipmentSectionOffset++] = index;
		}
		const chunk = Object.freeze({
			chunkX: mutable.chunkX,
			chunkZ: mutable.chunkZ,
			portIndexStart,
			portIndexCount: portOffset - portIndexStart,
			equipmentSectionIndexStart,
			equipmentSectionIndexCount: equipmentSectionOffset - equipmentSectionIndexStart,
		});
		chunks.push(chunk);
		let row = chunkRows.get(chunk.chunkZ);
		if (!row) {
			row = new Map();
			chunkRows.set(chunk.chunkZ, row);
		}
		row.set(chunk.chunkX, chunk);
	}
	return Object.freeze({
		portIndexes,
		equipmentSectionIndexes,
		chunks: Object.freeze(chunks),
		chunkRows,
		equipmentSectionQueryMarginMeters,
	});
}

function addCell(byKey: Map<string, Cell>, x: number, y: number, label: string): void {
	if (!isInt32(x) || !isInt32(y)) throw new Error(`Static FAB arrangement ${label} is invalid`);
	const key = cellKey(x, y);
	if (!byKey.has(key)) byKey.set(key, { x, y });
}

function readCoordinate(values: ArrayLike<number>, index: number, label: string): number {
	if (!Number.isInteger(index) || index < 0 || index >= values.length) {
		throw new RangeError(`Static FAB arrangement preview ${label} index is out of bounds`);
	}
	return values[index] as number;
}

function packCellCoordinate(x: number, z: number): bigint {
	return (BigInt(x >>> 0) << 32n) | BigInt(z >>> 0);
}

function packedCellCoordinateIncludes(keys: BigUint64Array, x: number, z: number): boolean {
	if (!isInt32(x) || !isInt32(z)) return false;
	const target = packCellCoordinate(x, z);
	let low = 0;
	let high = keys.length;
	while (low < high) {
		const middle = low + ((high - low) >> 1);
		const candidate = keys[middle] as bigint;
		if (candidate < target) low = middle + 1;
		else high = middle;
	}
	return low < keys.length && keys[low] === target;
}

function freezePortPoint(x: number, z: number): StaticFabArrangementPreviewPortPoint {
	if (!Number.isFinite(x) || !Number.isFinite(z)) {
		throw new Error("Static FAB arrangement source port is invalid");
	}
	return Object.freeze({ x, z });
}

function freezeEquipmentSection(
	presentation: StaticFabArrangementPreviewEquipmentPresentation,
	row: number,
	translation: StaticFabArrangementTranslation,
): StaticFabArrangementPreviewEquipmentSection {
	const sectionOffset = row * 2;
	const boundsOffset = row * 4;
	const section = {
		centerX: (presentation.bodySectionCenters[sectionOffset] as number) + translation.deltaX,
		centerZ: (presentation.bodySectionCenters[sectionOffset + 1] as number) + translation.deltaZ,
		tangentX: presentation.bodySectionTangents[sectionOffset] as number,
		tangentZ: presentation.bodySectionTangents[sectionOffset + 1] as number,
		halfLength: presentation.bodySectionHalfExtents[sectionOffset] as number,
		halfWidth: presentation.bodySectionHalfExtents[sectionOffset + 1] as number,
		minX: (presentation.bodySectionBounds[boundsOffset] as number) + translation.deltaX,
		minZ: (presentation.bodySectionBounds[boundsOffset + 1] as number) + translation.deltaZ,
		maxX: (presentation.bodySectionBounds[boundsOffset + 2] as number) + translation.deltaX,
		maxZ: (presentation.bodySectionBounds[boundsOffset + 3] as number) + translation.deltaZ,
	};
	if (!validEquipmentSection(section)) {
		throw new Error("Static FAB arrangement source equipment section is invalid");
	}
	return Object.freeze(section);
}

function validEquipmentSection(section: StaticFabArrangementPreviewEquipmentSection): boolean {
	return (
		Number.isFinite(section.centerX) &&
		Number.isFinite(section.centerZ) &&
		Number.isFinite(section.tangentX) &&
		Number.isFinite(section.tangentZ) &&
		Math.hypot(section.tangentX, section.tangentZ) > 0.5 &&
		Number.isFinite(section.halfLength) &&
		section.halfLength > 0 &&
		Number.isFinite(section.halfWidth) &&
		section.halfWidth > 0 &&
		Number.isFinite(section.minX) &&
		Number.isFinite(section.minZ) &&
		Number.isFinite(section.maxX) &&
		Number.isFinite(section.maxZ) &&
		section.maxX >= section.minX &&
		section.maxZ >= section.minZ
	);
}

function compareMutableChunks(left: MutablePreviewChunk, right: MutablePreviewChunk): number {
	return left.chunkZ - right.chunkZ || left.chunkX - right.chunkX;
}

function compareCells(left: Cell, right: Cell): number {
	return left.y - right.y || left.x - right.x;
}

function freezeBounds(bounds: StaticFabArrangementBounds): StaticFabArrangementBounds {
	return Object.freeze({
		minX: bounds.minX,
		minZ: bounds.minZ,
		maxXExclusive: bounds.maxXExclusive,
		maxZExclusive: bounds.maxZExclusive,
	});
}

function validBounds(bounds: StaticFabArrangementBounds): boolean {
	return (
		isInt32(bounds.minX) &&
		isInt32(bounds.minZ) &&
		isInt32(bounds.maxXExclusive) &&
		isInt32(bounds.maxZExclusive) &&
		bounds.maxXExclusive > bounds.minX &&
		bounds.maxZExclusive > bounds.minZ
	);
}

function sameBounds(left: StaticFabArrangementBounds, right: StaticFabArrangementBounds): boolean {
	return (
		left.minX === right.minX &&
		left.minZ === right.minZ &&
		left.maxXExclusive === right.maxXExclusive &&
		left.maxZExclusive === right.maxZExclusive
	);
}

function sameTranslationSet(
	left: readonly StaticFabArrangementTranslation[],
	right: readonly StaticFabArrangementTranslation[],
): boolean {
	if (left.length !== right.length) return false;
	const rightByKey = new Map(right.map((translation) => [translation.key, translation]));
	if (rightByKey.size !== right.length) return false;
	for (const translation of left) {
		const candidate = rightByKey.get(translation.key);
		if (
			!candidate ||
			translation.deltaX !== candidate.deltaX ||
			translation.deltaZ !== candidate.deltaZ ||
			!sameBounds(translation.before, candidate.before) ||
			!sameBounds(translation.after, candidate.after)
		) {
			return false;
		}
	}
	return true;
}

function translatedBoundsMatch(translation: StaticFabArrangementTranslation): boolean {
	return (
		translation.after.minX === translation.before.minX + translation.deltaX &&
		translation.after.minZ === translation.before.minZ + translation.deltaZ &&
		translation.after.maxXExclusive === translation.before.maxXExclusive + translation.deltaX &&
		translation.after.maxZExclusive === translation.before.maxZExclusive + translation.deltaZ
	);
}

function isPhase(value: unknown): value is StaticFabArrangementPreviewPhase {
	return value === "planning" || value === "certified" || value === "rejected";
}

function isInt32(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= -0x8000_0000 &&
		value <= 0x7fff_ffff
	);
}
