import { EQUIPMENT_GROUP_KINDS, type PortEquipmentState } from "../core/EquipmentGroup";
import { PORT_TYPES } from "../core/PortRecord";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";
import {
	createPortAttachmentSourceIndex,
	type PortAttachmentSourceIndex,
	resolvePortAttachmentWithSourceIndex,
} from "./PortAttachmentResolver";
import { type StkBodySweep, StkBodySweepIndex } from "./StkBodySweep";

export const PORT_EQUIPMENT_GROUP_PRESENTATION_MODE = {
	PORTS_ONLY: 0,
	BODY: 1,
} as const;

export const PORT_EQUIPMENT_BODY_FACE_KIND = {
	WITH_SECTION_TANGENT: 0,
	AGAINST_SECTION_TANGENT: 1,
	UNKNOWN: 2,
} as const;

export interface CompiledPortEquipmentPresentation {
	readonly revision: number;
	readonly count: number;
	readonly portIds: Int32Array;
	readonly equipmentGroupIds: Int32Array;
	readonly portTypes: Uint8Array;
	readonly railPositions: Float32Array;
	readonly worldPositions: Float32Array;
	readonly tangents: Float32Array;
	readonly yawRadians: Float32Array;
	readonly barcodes: readonly (string | null)[];
	readonly equipmentGroupCount: number;
	readonly groupIds: Int32Array;
	readonly groupKinds: Uint8Array;
	/** Every authored group has at least one selectable derived footprint section. */
	readonly groupPresentationModes: Uint8Array;
	readonly groupPortOffsets: Uint32Array;
	readonly groupPortRows: Uint32Array;
	readonly groupCenters: Float32Array;
	readonly groupTangents: Float32Array;
	/** Along-track and cross-track half extents in meters. */
	readonly groupHalfExtents: Float32Array;
	/** World-space minX, minZ, maxX, maxZ for culling. */
	readonly groupBounds: Float32Array;
	/** Per-group CSR offsets into derived body sections. L-shaped STKs own multiple sections. */
	readonly groupBodySectionOffsets: Uint32Array;
	readonly bodySectionCount: number;
	readonly bodySectionGroupRows: Uint32Array;
	readonly bodySectionCenters: Float32Array;
	readonly bodySectionTangents: Float32Array;
	readonly bodySectionHalfExtents: Float32Array;
	readonly bodySectionBounds: Float32Array;
	/** Exact owning derived body section for every stable port row. */
	readonly portBodySectionRows: Uint32Array;
	/** CSR inverse of portBodySectionRows, ordered by stable port row. */
	readonly bodySectionPortOffsets: Uint32Array;
	readonly bodySectionPortRows: Uint32Array;
	/** Equipment-facing direction relative to the owning section tangent. */
	readonly portBodyFaceKinds: Uint8Array;
}

export interface PortEquipmentHit {
	readonly row: number;
	readonly portId: number;
	readonly equipmentGroupId: number;
	readonly distanceMeters: number;
}

export interface PortEquipmentBounds {
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

const PORT_EQUIPMENT_SPATIAL_CHUNK_METERS = 16;

/** Revision-bound derived index for committed port hover and selection. */
export class PortEquipmentSpatialIndex {
	private readonly presentation: CompiledPortEquipmentPresentation;
	private readonly chunks: ReadonlyMap<string, Uint32Array>;
	private readonly groupChunks: ReadonlyMap<string, Uint32Array>;
	private readonly candidates: number[] = [];
	private readonly groupCandidates: number[] = [];
	private readonly groupVisitStamps: Uint32Array;
	private groupVisitGeneration = 0;
	private readonly bodySectionVisitStamps: Uint32Array;
	private bodySectionVisitGeneration = 0;
	private readonly bodySectionPortMappingValid: boolean;

	constructor(presentation: CompiledPortEquipmentPresentation) {
		this.presentation = presentation;
		const mutable = new Map<string, number[]>();
		for (let row = 0; row < presentation.count; row++) {
			const x = presentation.worldPositions[row * 2] as number;
			const z = presentation.worldPositions[row * 2 + 1] as number;
			const key = spatialChunkKey(x, z);
			const rows = mutable.get(key);
			if (rows) rows.push(row);
			else mutable.set(key, [row]);
		}
		this.chunks = new Map(
			[...mutable.entries()].map(([key, rows]) => [key, Uint32Array.from(rows)] as const),
		);
		const mutableGroups = new Map<string, number[]>();
		for (let sectionRow = 0; sectionRow < presentation.bodySectionCount; sectionRow++) {
			const offset = sectionRow * 4;
			const minChunkX = Math.floor(
				(presentation.bodySectionBounds[offset] as number) / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS,
			);
			const minChunkZ = Math.floor(
				(presentation.bodySectionBounds[offset + 1] as number) /
					PORT_EQUIPMENT_SPATIAL_CHUNK_METERS,
			);
			const maxChunkX = Math.floor(
				(presentation.bodySectionBounds[offset + 2] as number) /
					PORT_EQUIPMENT_SPATIAL_CHUNK_METERS,
			);
			const maxChunkZ = Math.floor(
				(presentation.bodySectionBounds[offset + 3] as number) /
					PORT_EQUIPMENT_SPATIAL_CHUNK_METERS,
			);
			for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
				for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
					const key = `${chunkX}:${chunkZ}`;
					const rows = mutableGroups.get(key);
					if (rows) rows.push(sectionRow);
					else mutableGroups.set(key, [sectionRow]);
				}
			}
		}
		this.groupChunks = new Map(
			[...mutableGroups.entries()].map(([key, rows]) => [key, Uint32Array.from(rows)] as const),
		);
		this.groupVisitStamps = new Uint32Array(presentation.equipmentGroupCount);
		this.bodySectionVisitStamps = new Uint32Array(presentation.bodySectionCount);
		this.bodySectionPortMappingValid = hasValidPortEquipmentBodySectionMapping(presentation);
	}

	nearest(worldX: number, worldZ: number, radiusMeters: number): PortEquipmentHit | null {
		if (
			!Number.isFinite(worldX) ||
			!Number.isFinite(worldZ) ||
			!Number.isFinite(radiusMeters) ||
			radiusMeters <= 0
		) {
			return null;
		}
		this.candidates.length = 0;
		const minChunkX = Math.floor((worldX - radiusMeters) / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const maxChunkX = Math.floor((worldX + radiusMeters) / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const minChunkZ = Math.floor((worldZ - radiusMeters) / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const maxChunkZ = Math.floor((worldZ + radiusMeters) / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const rows = this.chunks.get(`${chunkX}:${chunkZ}`);
				if (!rows) continue;
				for (let index = 0; index < rows.length; index++) {
					this.candidates.push(rows[index] as number);
				}
			}
		}
		let nearestRow = -1;
		let nearestDistance = radiusMeters;
		for (const row of this.candidates) {
			const distance = Math.hypot(
				(this.presentation.worldPositions[row * 2] as number) - worldX,
				(this.presentation.worldPositions[row * 2 + 1] as number) - worldZ,
			);
			if (distance > nearestDistance) continue;
			if (
				distance === nearestDistance &&
				nearestRow >= 0 &&
				(this.presentation.portIds[row] as number) >
					(this.presentation.portIds[nearestRow] as number)
			) {
				continue;
			}
			nearestRow = row;
			nearestDistance = distance;
		}
		if (nearestRow < 0) return null;
		return Object.freeze({
			row: nearestRow,
			portId: this.presentation.portIds[nearestRow] as number,
			equipmentGroupId: this.presentation.equipmentGroupIds[nearestRow] as number,
			distanceMeters: nearestDistance,
		});
	}

	query(bounds: PortEquipmentBounds, target: number[] = []): number[] {
		target.length = 0;
		if (!hasFinitePortEquipmentBounds(bounds)) return target;
		const minChunkX = Math.floor(bounds.minX / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const maxChunkX = Math.floor(bounds.maxX / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const minChunkZ = Math.floor(bounds.minZ / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const maxChunkZ = Math.floor(bounds.maxZ / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const rows = this.chunks.get(`${chunkX}:${chunkZ}`);
				if (!rows) continue;
				for (const row of rows) {
					const worldX = this.presentation.worldPositions[row * 2] as number;
					const worldZ = this.presentation.worldPositions[row * 2 + 1] as number;
					if (
						worldX >= bounds.minX &&
						worldX <= bounds.maxX &&
						worldZ >= bounds.minZ &&
						worldZ <= bounds.maxZ
					) {
						target.push(row);
					}
				}
			}
		}
		return target;
	}

	/** Query derived equipment bodies independently from their member port points. */
	queryGroups(bounds: PortEquipmentBounds, target: number[] = []): number[] {
		target.length = 0;
		this.queryBodySections(bounds, this.groupCandidates);
		const generation = this.nextGroupVisitGeneration();
		for (const sectionRow of this.groupCandidates) {
			const groupRow = this.presentation.bodySectionGroupRows[sectionRow] as number;
			if ((this.groupVisitStamps[groupRow] as number) === generation) continue;
			this.groupVisitStamps[groupRow] = generation;
			target.push(groupRow);
		}
		target.sort((left, right) => left - right);
		return target;
	}

	/** Query individual derived body sections for culling and rendering. */
	queryBodySections(bounds: PortEquipmentBounds, target: number[] = []): number[] {
		target.length = 0;
		if (!hasFinitePortEquipmentBounds(bounds)) return target;
		const generation = this.nextBodySectionVisitGeneration();
		const minChunkX = Math.floor(bounds.minX / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const maxChunkX = Math.floor(bounds.maxX / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const minChunkZ = Math.floor(bounds.minZ / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		const maxChunkZ = Math.floor(bounds.maxZ / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS);
		for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const rows = this.groupChunks.get(`${chunkX}:${chunkZ}`);
				if (!rows) continue;
				for (const sectionRow of rows) {
					if ((this.bodySectionVisitStamps[sectionRow] as number) === generation) continue;
					this.bodySectionVisitStamps[sectionRow] = generation;
					if (bodySectionBoundsIntersect(this.presentation, sectionRow, bounds)) {
						target.push(sectionRow);
					}
				}
			}
		}
		target.sort((left, right) => left - right);
		return target;
	}

	/** Resolve a click on a derived group body to one stable representative member port. */
	groupAt(worldX: number, worldZ: number, paddingMeters = 0): PortEquipmentHit | null {
		if (
			!this.bodySectionPortMappingValid ||
			!Number.isFinite(worldX) ||
			!Number.isFinite(worldZ) ||
			!Number.isFinite(paddingMeters) ||
			paddingMeters < 0
		) {
			return null;
		}
		this.queryBodySections(
			{
				minX: worldX - paddingMeters,
				minZ: worldZ - paddingMeters,
				maxX: worldX + paddingMeters,
				maxZ: worldZ + paddingMeters,
			},
			this.groupCandidates,
		);
		let bestSectionRow = -1;
		let bestGroupRow = -1;
		let bestDistance = Number.POSITIVE_INFINITY;
		let bestArea = Number.POSITIVE_INFINITY;
		for (const sectionRow of this.groupCandidates) {
			const groupRow = this.presentation.bodySectionGroupRows[sectionRow] as number;
			const distance = distanceToPortEquipmentBodySection(
				this.presentation,
				sectionRow,
				worldX,
				worldZ,
			);
			if (distance > paddingMeters) continue;
			const halfExtentOffset = sectionRow * 2;
			const area =
				4 *
				(this.presentation.bodySectionHalfExtents[halfExtentOffset] as number) *
				(this.presentation.bodySectionHalfExtents[halfExtentOffset + 1] as number);
			const groupId = this.presentation.groupIds[groupRow] as number;
			const bestGroupId =
				bestGroupRow < 0
					? Number.POSITIVE_INFINITY
					: (this.presentation.groupIds[bestGroupRow] as number);
			if (
				distance > bestDistance ||
				(distance === bestDistance && area > bestArea) ||
				(distance === bestDistance && area === bestArea && groupId > bestGroupId) ||
				(distance === bestDistance &&
					area === bestArea &&
					groupId === bestGroupId &&
					bestSectionRow >= 0 &&
					sectionRow > bestSectionRow)
			) {
				continue;
			}
			bestSectionRow = sectionRow;
			bestGroupRow = groupRow;
			bestDistance = distance;
			bestArea = area;
		}
		if (bestGroupRow < 0 || bestSectionRow < 0) return null;
		const portRow = nearestPortEquipmentBodySectionPortRow(
			this.presentation,
			bestSectionRow,
			worldX,
			worldZ,
		);
		if (portRow === null) return null;
		return Object.freeze({
			row: portRow,
			portId: this.presentation.portIds[portRow] as number,
			equipmentGroupId: this.presentation.equipmentGroupIds[portRow] as number,
			distanceMeters: bestDistance,
		});
	}

	private nextGroupVisitGeneration(): number {
		this.groupVisitGeneration++;
		if (this.groupVisitGeneration === 0xffff_ffff) {
			this.groupVisitStamps.fill(0);
			this.groupVisitGeneration = 1;
		}
		return this.groupVisitGeneration;
	}

	private nextBodySectionVisitGeneration(): number {
		this.bodySectionVisitGeneration++;
		if (this.bodySectionVisitGeneration === 0xffff_ffff) {
			this.bodySectionVisitStamps.fill(0);
			this.bodySectionVisitGeneration = 1;
		}
		return this.bodySectionVisitGeneration;
	}
}

const PORT_EQUIPMENT_SPATIAL_INDEX_CACHE = new WeakMap<
	CompiledPortEquipmentPresentation,
	PortEquipmentSpatialIndex
>();

/** Share one immutable-presentation spatial index across the 2D and 3D consumers. */
export function portEquipmentSpatialIndexFor(
	presentation: CompiledPortEquipmentPresentation,
): PortEquipmentSpatialIndex {
	const cached = PORT_EQUIPMENT_SPATIAL_INDEX_CACHE.get(presentation);
	if (cached) return cached;
	const compiled = new PortEquipmentSpatialIndex(presentation);
	PORT_EQUIPMENT_SPATIAL_INDEX_CACHE.set(presentation, compiled);
	return compiled;
}

export function portEquipmentPresentationRow(
	presentation: CompiledPortEquipmentPresentation,
	portId: number,
): number | null {
	let low = 0;
	let high = presentation.count - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const candidate = presentation.portIds[middle] as number;
		if (candidate === portId) return middle;
		if (candidate < portId) low = middle + 1;
		else high = middle - 1;
	}
	return null;
}

export function equipmentGroupPresentationRow(
	presentation: CompiledPortEquipmentPresentation,
	equipmentGroupId: number,
): number | null {
	let low = 0;
	let high = presentation.equipmentGroupCount - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const candidate = presentation.groupIds[middle] as number;
		if (candidate === equipmentGroupId) return middle;
		if (candidate < equipmentGroupId) low = middle + 1;
		else high = middle - 1;
	}
	return null;
}

/** Resolve one body-section hit without re-inferring section membership from geometry. */
export function nearestPortEquipmentBodySectionPortRow(
	presentation: CompiledPortEquipmentPresentation,
	sectionRow: number,
	worldX: number,
	worldZ: number,
): number | null {
	if (
		!Number.isInteger(sectionRow) ||
		sectionRow < 0 ||
		sectionRow >= presentation.bodySectionCount ||
		!Number.isFinite(worldX) ||
		!Number.isFinite(worldZ)
	) {
		return null;
	}
	const start = presentation.bodySectionPortOffsets[sectionRow] as number | undefined;
	const end = presentation.bodySectionPortOffsets[sectionRow + 1] as number | undefined;
	const sectionGroupRow = presentation.bodySectionGroupRows[sectionRow] as number | undefined;
	const sectionGroupId =
		sectionGroupRow === undefined || sectionGroupRow >= presentation.equipmentGroupCount
			? undefined
			: presentation.groupIds[sectionGroupRow];
	if (
		start === undefined ||
		end === undefined ||
		start > end ||
		end > presentation.bodySectionPortRows.length ||
		presentation.portBodySectionRows.length !== presentation.count ||
		sectionGroupId === undefined
	) {
		return null;
	}
	let nearestRow = -1;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (let offset = start; offset < end; offset++) {
		const candidateRow = presentation.bodySectionPortRows[offset] as number | undefined;
		if (
			candidateRow === undefined ||
			candidateRow >= presentation.count ||
			(presentation.portBodySectionRows[candidateRow] as number) !== sectionRow ||
			(presentation.equipmentGroupIds[candidateRow] as number) !== sectionGroupId
		) {
			return null;
		}
		const distance = Math.hypot(
			(presentation.worldPositions[candidateRow * 2] as number) - worldX,
			(presentation.worldPositions[candidateRow * 2 + 1] as number) - worldZ,
		);
		const candidatePortId = presentation.portIds[candidateRow] as number;
		const nearestPortId =
			nearestRow < 0 ? Number.POSITIVE_INFINITY : (presentation.portIds[nearestRow] as number);
		if (
			distance < nearestDistance ||
			(distance === nearestDistance && candidatePortId < nearestPortId)
		) {
			nearestRow = candidateRow;
			nearestDistance = distance;
		}
	}
	return nearestRow < 0 ? null : nearestRow;
}

export function compilePortEquipmentPresentation(
	layout: CompiledPhysicalLayout,
	state: PortEquipmentState,
	attachmentSourceIndex?: PortAttachmentSourceIndex,
): CompiledPortEquipmentPresentation {
	const count = state.ports.length;
	let sourceIndex = attachmentSourceIndex ?? null;
	const portIds = new Int32Array(count);
	const equipmentGroupIds = new Int32Array(count);
	const portTypes = new Uint8Array(count);
	const railPositions = new Float32Array(count * 2);
	const worldPositions = new Float32Array(count * 2);
	const tangents = new Float32Array(count * 2);
	const yawRadians = new Float32Array(count);
	const barcodes = new Array<string | null>(count);
	const portRowById = new Map<number, number>();
	for (let row = 0; row < count; row++) {
		const port = state.ports[row];
		if (!port) throw new Error(`Missing port presentation row ${row}.`);
		sourceIndex ??= createPortAttachmentSourceIndex(layout);
		const resolution = resolvePortAttachmentWithSourceIndex(layout, port, sourceIndex);
		if (!resolution.ok) {
			throw new Error(
				`Port ${port.id} attachment is invalid (${resolution.code}): ${resolution.message}`,
			);
		}
		portIds[row] = port.id;
		equipmentGroupIds[row] = port.equipmentGroupId;
		portTypes[row] = PORT_TYPES.indexOf(port.portType);
		railPositions[row * 2] = resolution.railXMeters;
		railPositions[row * 2 + 1] = resolution.railZMeters;
		worldPositions[row * 2] = resolution.worldXMeters;
		worldPositions[row * 2 + 1] = resolution.worldZMeters;
		tangents[row * 2] = resolution.tangentX;
		tangents[row * 2 + 1] = resolution.tangentZ;
		yawRadians[row] = resolution.yawRadians;
		barcodes[row] = port.barcode;
		portRowById.set(port.id, row);
	}
	const equipmentGroupCount = state.equipmentGroups.length;
	const groupIds = new Int32Array(equipmentGroupCount);
	const groupKinds = new Uint8Array(equipmentGroupCount);
	const groupPresentationModes = new Uint8Array(equipmentGroupCount);
	const groupPortOffsets = new Uint32Array(equipmentGroupCount + 1);
	const groupPortRows = new Uint32Array(count);
	const groupCenters = new Float32Array(equipmentGroupCount * 2);
	const groupTangents = new Float32Array(equipmentGroupCount * 2);
	const groupHalfExtents = new Float32Array(equipmentGroupCount * 2);
	const groupBounds = new Float32Array(equipmentGroupCount * 4);
	const groupRowById = new Map<number, number>();
	let groupPortWrite = 0;
	for (let groupRow = 0; groupRow < equipmentGroupCount; groupRow++) {
		const group = state.equipmentGroups[groupRow];
		if (!group) throw new Error(`Missing equipment group presentation row ${groupRow}.`);
		groupPortOffsets[groupRow] = groupPortWrite;
		groupIds[groupRow] = group.id;
		groupRowById.set(group.id, groupRow);
		groupKinds[groupRow] = EQUIPMENT_GROUP_KINDS.indexOf(group.kind);
		groupPresentationModes[groupRow] = PORT_EQUIPMENT_GROUP_PRESENTATION_MODE.BODY;
		const rows: number[] = [];
		for (const portId of group.portIds) {
			const portRow = portRowById.get(portId);
			if (portRow === undefined) {
				throw new Error(
					`Equipment group ${group.id} references missing presentation port ${portId}.`,
				);
			}
			groupPortRows[groupPortWrite++] = portRow;
			rows.push(portRow);
		}
		writeGroupGeometry(
			groupRow,
			rows,
			worldPositions,
			tangents,
			groupCenters,
			groupTangents,
			groupHalfExtents,
			groupBounds,
		);
	}
	groupPortOffsets[equipmentGroupCount] = groupPortWrite;
	if (groupPortWrite !== count) throw new Error("Equipment group presentation ownership diverged.");
	const stkBodySweepIndex = new StkBodySweepIndex(layout, state, false);
	const stkSweepsByGroup = indexStkSweepsByGroup(stkBodySweepIndex.sweeps);
	const exactStkSweepGroupIds = new Set<number>();
	for (const group of state.equipmentGroups) {
		if (group.kind !== "STK") continue;
		const sweeps = stkSweepsByGroup.get(group.id) ?? [];
		if (
			sweeps.length > 0 &&
			group.portIds.every((portId) => {
				const portRow = portRowById.get(portId);
				const port = portRow === undefined ? undefined : state.ports[portRow];
				if (!port || port.route.kind !== "CARDINAL_CELL") return false;
				const runId = stkBodySweepIndex.runIdForPort({
					route: port.route,
					stationMillimeters: port.stationMillimeters,
				});
				return runId !== null && sweeps.some((sweep) => sweep.runId === runId);
			})
		) {
			exactStkSweepGroupIds.add(group.id);
		}
	}
	for (const group of state.equipmentGroups) {
		if (
			group.kind === "STK" &&
			group.template !== "CUSTOM" &&
			!exactStkSweepGroupIds.has(group.id)
		) {
			throw new Error(`STK group ${group.id} has no complete exact straight-run body mapping.`);
		}
	}
	let bodySectionCount = 0;
	for (const group of state.equipmentGroups) {
		bodySectionCount +=
			group.kind === "STK" && exactStkSweepGroupIds.has(group.id)
				? (stkSweepsByGroup.get(group.id)?.length ?? 0)
				: 1;
	}
	const groupBodySectionOffsets = new Uint32Array(equipmentGroupCount + 1);
	const bodySectionGroupRows = new Uint32Array(bodySectionCount);
	const bodySectionCenters = new Float32Array(bodySectionCount * 2);
	const bodySectionTangents = new Float32Array(bodySectionCount * 2);
	const bodySectionHalfExtents = new Float32Array(bodySectionCount * 2);
	const bodySectionBounds = new Float32Array(bodySectionCount * 4);
	let bodySectionWrite = 0;
	for (let groupRow = 0; groupRow < equipmentGroupCount; groupRow++) {
		groupBodySectionOffsets[groupRow] = bodySectionWrite;
		const group = state.equipmentGroups[groupRow];
		if (!group) throw new Error(`Missing equipment group body row ${groupRow}.`);
		if (group.kind === "STK" && exactStkSweepGroupIds.has(group.id)) {
			for (const sweep of stkSweepsByGroup.get(group.id) ?? []) {
				bodySectionGroupRows[bodySectionWrite] = groupRow;
				bodySectionCenters[bodySectionWrite * 2] = sweep.centerX;
				bodySectionCenters[bodySectionWrite * 2 + 1] = sweep.centerZ;
				bodySectionTangents[bodySectionWrite * 2] = sweep.tangentX;
				bodySectionTangents[bodySectionWrite * 2 + 1] = sweep.tangentZ;
				bodySectionHalfExtents[bodySectionWrite * 2] = sweep.halfLength;
				bodySectionHalfExtents[bodySectionWrite * 2 + 1] = sweep.halfWidth;
				bodySectionBounds[bodySectionWrite * 4] = sweep.minX;
				bodySectionBounds[bodySectionWrite * 4 + 1] = sweep.minZ;
				bodySectionBounds[bodySectionWrite * 4 + 2] = sweep.maxX;
				bodySectionBounds[bodySectionWrite * 4 + 3] = sweep.maxZ;
				bodySectionWrite++;
			}
			continue;
		}
		bodySectionGroupRows[bodySectionWrite] = groupRow;
		copyGroupGeometryToBodySection(
			groupRow,
			bodySectionWrite,
			groupCenters,
			groupTangents,
			groupHalfExtents,
			groupBounds,
			bodySectionCenters,
			bodySectionTangents,
			bodySectionHalfExtents,
			bodySectionBounds,
		);
		bodySectionWrite++;
	}
	groupBodySectionOffsets[equipmentGroupCount] = bodySectionWrite;
	if (bodySectionWrite !== bodySectionCount || groupRowById.size !== equipmentGroupCount) {
		throw new Error("Equipment group body-section ownership diverged.");
	}
	const portBodySectionRows = new Uint32Array(count);
	for (let portRow = 0; portRow < count; portRow++) {
		const port = state.ports[portRow];
		if (!port) throw new Error(`Missing port body-section row ${portRow}.`);
		const groupRow = groupRowById.get(port.equipmentGroupId);
		if (groupRow === undefined) {
			throw new Error(`Port ${port.id} references a missing presentation group.`);
		}
		const group = state.equipmentGroups[groupRow];
		if (!group) throw new Error(`Missing equipment group body row ${groupRow}.`);
		if (group.kind !== "STK" || !exactStkSweepGroupIds.has(group.id)) {
			portBodySectionRows[portRow] = groupBodySectionOffsets[groupRow] as number;
			continue;
		}
		if (port.route.kind !== "CARDINAL_CELL") throw new Error("Exact STK route narrowing failed.");
		const runId = stkBodySweepIndex.runIdForPort({
			route: port.route,
			stationMillimeters: port.stationMillimeters,
		});
		const sweeps = stkSweepsByGroup.get(group.id) ?? [];
		const localSectionRow =
			runId === null ? -1 : sweeps.findIndex((sweep) => sweep.runId === runId);
		if (localSectionRow < 0) {
			throw new Error(`STK port ${port.id} has no exact derived body section.`);
		}
		portBodySectionRows[portRow] = (groupBodySectionOffsets[groupRow] as number) + localSectionRow;
	}
	const bodySectionPortOffsets = new Uint32Array(bodySectionCount + 1);
	for (let portRow = 0; portRow < count; portRow++) {
		const sectionRow = portBodySectionRows[portRow] as number;
		if (sectionRow >= bodySectionCount) {
			throw new Error(`Port row ${portRow} maps outside the derived body-section table.`);
		}
		bodySectionPortOffsets[sectionRow + 1] = (bodySectionPortOffsets[sectionRow + 1] as number) + 1;
	}
	for (let sectionRow = 1; sectionRow <= bodySectionCount; sectionRow++) {
		bodySectionPortOffsets[sectionRow] =
			(bodySectionPortOffsets[sectionRow] as number) +
			(bodySectionPortOffsets[sectionRow - 1] as number);
	}
	const bodySectionPortRows = new Uint32Array(count);
	const bodySectionPortWrites = new Uint32Array(bodySectionPortOffsets);
	for (let portRow = 0; portRow < count; portRow++) {
		const sectionRow = portBodySectionRows[portRow] as number;
		bodySectionPortRows[bodySectionPortWrites[sectionRow] as number] = portRow;
		bodySectionPortWrites[sectionRow] = (bodySectionPortWrites[sectionRow] as number) + 1;
	}
	for (let sectionRow = 0; sectionRow < bodySectionCount; sectionRow++) {
		bodySectionPortRows
			.subarray(
				bodySectionPortOffsets[sectionRow] as number,
				bodySectionPortOffsets[sectionRow + 1] as number,
			)
			.sort((leftRow, rightRow) => (portIds[leftRow] as number) - (portIds[rightRow] as number));
	}
	const portBodyFaceKinds = new Uint8Array(count);
	for (let portRow = 0; portRow < count; portRow++) {
		const sectionRow = portBodySectionRows[portRow] as number;
		const normalX = Math.cos(yawRadians[portRow] as number);
		const normalZ = Math.sin(yawRadians[portRow] as number);
		const sectionTangentX = bodySectionTangents[sectionRow * 2] as number;
		const sectionTangentZ = bodySectionTangents[sectionRow * 2 + 1] as number;
		const alignment = normalX * sectionTangentX + normalZ * sectionTangentZ;
		portBodyFaceKinds[portRow] =
			Math.abs(Math.abs(alignment) - 1) > 1e-5
				? PORT_EQUIPMENT_BODY_FACE_KIND.UNKNOWN
				: alignment >= 0
					? PORT_EQUIPMENT_BODY_FACE_KIND.WITH_SECTION_TANGENT
					: PORT_EQUIPMENT_BODY_FACE_KIND.AGAINST_SECTION_TANGENT;
	}
	return Object.freeze({
		revision: layout.revision,
		count,
		portIds,
		equipmentGroupIds,
		portTypes,
		railPositions,
		worldPositions,
		tangents,
		yawRadians,
		barcodes: Object.freeze(barcodes),
		equipmentGroupCount,
		groupIds,
		groupKinds,
		groupPresentationModes,
		groupPortOffsets,
		groupPortRows,
		groupCenters,
		groupTangents,
		groupHalfExtents,
		groupBounds,
		groupBodySectionOffsets,
		bodySectionCount,
		bodySectionGroupRows,
		bodySectionCenters,
		bodySectionTangents,
		bodySectionHalfExtents,
		bodySectionBounds,
		portBodySectionRows,
		bodySectionPortOffsets,
		bodySectionPortRows,
		portBodyFaceKinds,
	});
}

function indexStkSweepsByGroup(
	sweeps: readonly StkBodySweep[],
): ReadonlyMap<number, readonly StkBodySweep[]> {
	const sweepsByGroup = new Map<number, StkBodySweep[]>();
	for (const sweep of sweeps) {
		const groupSweeps = sweepsByGroup.get(sweep.equipmentGroupId);
		if (groupSweeps) groupSweeps.push(sweep);
		else sweepsByGroup.set(sweep.equipmentGroupId, [sweep]);
	}
	return sweepsByGroup;
}

function copyGroupGeometryToBodySection(
	groupRow: number,
	sectionRow: number,
	groupCenters: Float32Array,
	groupTangents: Float32Array,
	groupHalfExtents: Float32Array,
	groupBounds: Float32Array,
	sectionCenters: Float32Array,
	sectionTangents: Float32Array,
	sectionHalfExtents: Float32Array,
	sectionBounds: Float32Array,
): void {
	sectionCenters.set(groupCenters.subarray(groupRow * 2, groupRow * 2 + 2), sectionRow * 2);
	sectionTangents.set(groupTangents.subarray(groupRow * 2, groupRow * 2 + 2), sectionRow * 2);
	sectionHalfExtents.set(groupHalfExtents.subarray(groupRow * 2, groupRow * 2 + 2), sectionRow * 2);
	sectionBounds.set(groupBounds.subarray(groupRow * 4, groupRow * 4 + 4), sectionRow * 4);
}

function writeGroupGeometry(
	groupRow: number,
	portRows: readonly number[],
	worldPositions: Float32Array,
	tangents: Float32Array,
	centers: Float32Array,
	groupTangents: Float32Array,
	halfExtents: Float32Array,
	bounds: Float32Array,
): void {
	const firstRow = portRows[0];
	if (firstRow === undefined) throw new Error(`Equipment group row ${groupRow} has no ports.`);
	const originX = worldPositions[firstRow * 2] as number;
	const originZ = worldPositions[firstRow * 2 + 1] as number;
	let tangentX = tangents[firstRow * 2] as number;
	let tangentZ = tangents[firstRow * 2 + 1] as number;
	const tangentLength = Math.hypot(tangentX, tangentZ);
	if (tangentLength <= 1e-6) throw new Error(`Equipment group row ${groupRow} tangent is invalid.`);
	tangentX /= tangentLength;
	tangentZ /= tangentLength;
	const normalX = -tangentZ;
	const normalZ = tangentX;
	let minAlong = Number.POSITIVE_INFINITY;
	let maxAlong = Number.NEGATIVE_INFINITY;
	let minAcross = Number.POSITIVE_INFINITY;
	let maxAcross = Number.NEGATIVE_INFINITY;
	for (const portRow of portRows) {
		const deltaX = (worldPositions[portRow * 2] as number) - originX;
		const deltaZ = (worldPositions[portRow * 2 + 1] as number) - originZ;
		const along = deltaX * tangentX + deltaZ * tangentZ;
		const across = deltaX * normalX + deltaZ * normalZ;
		minAlong = Math.min(minAlong, along);
		maxAlong = Math.max(maxAlong, along);
		minAcross = Math.min(minAcross, across);
		maxAcross = Math.max(maxAcross, across);
	}
	const centerAlong = (minAlong + maxAlong) * 0.5;
	const centerAcross = (minAcross + maxAcross) * 0.5;
	const centerX = originX + tangentX * centerAlong + normalX * centerAcross;
	const centerZ = originZ + tangentZ * centerAlong + normalZ * centerAcross;
	const halfLength = Math.max(0.34, (maxAlong - minAlong) * 0.5 + 0.5);
	const halfWidth = Math.max(0.28, (maxAcross - minAcross) * 0.5 + 0.45);
	centers[groupRow * 2] = centerX;
	centers[groupRow * 2 + 1] = centerZ;
	groupTangents[groupRow * 2] = tangentX;
	groupTangents[groupRow * 2 + 1] = tangentZ;
	halfExtents[groupRow * 2] = halfLength;
	halfExtents[groupRow * 2 + 1] = halfWidth;
	const extentX = Math.abs(tangentX) * halfLength + Math.abs(normalX) * halfWidth;
	const extentZ = Math.abs(tangentZ) * halfLength + Math.abs(normalZ) * halfWidth;
	bounds[groupRow * 4] = centerX - extentX;
	bounds[groupRow * 4 + 1] = centerZ - extentZ;
	bounds[groupRow * 4 + 2] = centerX + extentX;
	bounds[groupRow * 4 + 3] = centerZ + extentZ;
}

function spatialChunkKey(x: number, z: number): string {
	return `${Math.floor(x / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS)}:${Math.floor(z / PORT_EQUIPMENT_SPATIAL_CHUNK_METERS)}`;
}

function hasFinitePortEquipmentBounds(bounds: PortEquipmentBounds): boolean {
	return (
		Number.isFinite(bounds.minX) &&
		Number.isFinite(bounds.minZ) &&
		Number.isFinite(bounds.maxX) &&
		Number.isFinite(bounds.maxZ)
	);
}

function hasValidPortEquipmentBodySectionMapping(
	presentation: CompiledPortEquipmentPresentation,
): boolean {
	if (
		presentation.portBodySectionRows.length !== presentation.count ||
		presentation.bodySectionPortOffsets.length !== presentation.bodySectionCount + 1 ||
		presentation.bodySectionPortRows.length !== presentation.count ||
		presentation.bodySectionGroupRows.length !== presentation.bodySectionCount ||
		presentation.equipmentGroupIds.length !== presentation.count ||
		presentation.groupIds.length !== presentation.equipmentGroupCount ||
		(presentation.bodySectionPortOffsets[0] as number | undefined) !== 0 ||
		(presentation.bodySectionPortOffsets[presentation.bodySectionCount] as number | undefined) !==
			presentation.count
	) {
		return false;
	}
	const visitedPortRows = new Uint8Array(presentation.count);
	for (let sectionRow = 0; sectionRow < presentation.bodySectionCount; sectionRow++) {
		const start = presentation.bodySectionPortOffsets[sectionRow] as number;
		const end = presentation.bodySectionPortOffsets[sectionRow + 1] as number;
		const groupRow = presentation.bodySectionGroupRows[sectionRow] as number;
		if (start > end || end > presentation.count || groupRow >= presentation.equipmentGroupCount) {
			return false;
		}
		const groupId = presentation.groupIds[groupRow] as number;
		for (let offset = start; offset < end; offset++) {
			const portRow = presentation.bodySectionPortRows[offset] as number;
			if (
				portRow >= presentation.count ||
				visitedPortRows[portRow] !== 0 ||
				(presentation.portBodySectionRows[portRow] as number) !== sectionRow ||
				(presentation.equipmentGroupIds[portRow] as number) !== groupId
			) {
				return false;
			}
			visitedPortRows[portRow] = 1;
		}
	}
	return true;
}

function bodySectionBoundsIntersect(
	presentation: CompiledPortEquipmentPresentation,
	sectionRow: number,
	bounds: PortEquipmentBounds,
): boolean {
	const offset = sectionRow * 4;
	return !(
		(presentation.bodySectionBounds[offset + 2] as number) < bounds.minX ||
		(presentation.bodySectionBounds[offset] as number) > bounds.maxX ||
		(presentation.bodySectionBounds[offset + 3] as number) < bounds.minZ ||
		(presentation.bodySectionBounds[offset + 1] as number) > bounds.maxZ
	);
}

function distanceToPortEquipmentBodySection(
	presentation: CompiledPortEquipmentPresentation,
	sectionRow: number,
	worldX: number,
	worldZ: number,
): number {
	const offset = sectionRow * 2;
	const deltaX = worldX - (presentation.bodySectionCenters[offset] as number);
	const deltaZ = worldZ - (presentation.bodySectionCenters[offset + 1] as number);
	const tangentX = presentation.bodySectionTangents[offset] as number;
	const tangentZ = presentation.bodySectionTangents[offset + 1] as number;
	const outsideAlong = Math.max(
		0,
		Math.abs(deltaX * tangentX + deltaZ * tangentZ) -
			(presentation.bodySectionHalfExtents[offset] as number),
	);
	const outsideAcross = Math.max(
		0,
		Math.abs(-deltaX * tangentZ + deltaZ * tangentX) -
			(presentation.bodySectionHalfExtents[offset + 1] as number),
	);
	return Math.hypot(outsideAlong, outsideAcross);
}
