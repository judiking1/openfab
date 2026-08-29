import { type AdvancedSwitchRecord, deriveAdvancedSwitchGeometry } from "../core/AdvancedSwitch";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { equipmentGroupBodyBounds } from "../core/PortEquipmentLayoutValidator";
import type { PortRecord } from "../core/PortRecord";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationSemanticRole,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
} from "../core/StaticFabOrganization";
import type { StaticFabOrganizationSelectionMode } from "../core/StaticFabOrganizationSelection";
import type { TileMap } from "../core/TileMap";
import { isTransferableTypedArray } from "../worker/TransferableTypedArray";
import {
	type CompiledPhysicalLayout,
	compiledPhysicalLayoutHasDifferentSource,
} from "./PhysicalRailCompiler";
import type { StaticFabOrganizationOverviewSourceIdentity } from "./StaticFabOrganizationOverview";

export const STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_KIND =
	"static-fab-organization-outline-index" as const;
export const STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_VERSION = 1 as const;
export const STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_SNAPSHOT_KIND =
	"static-fab-organization-outline-index-snapshot" as const;
export const STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_SNAPSHOT_VERSION = 1 as const;
export const STATIC_FAB_ORGANIZATION_OUTLINE_BVH_LEAF_CAPACITY = 4;
export const STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES = 64;

export const STATIC_FAB_ORGANIZATION_OUTLINE_ROLES = ["FAB", "BAY_BANK", "BAY"] as const;
export type StaticFabOrganizationOutlineRole =
	(typeof STATIC_FAB_ORGANIZATION_OUTLINE_ROLES)[number];
export type StaticFabOrganizationOutlineScope = StaticFabOrganizationSelectionMode;

const OUTLINE_BOUNDS_WIDTH = 4;
const OUTLINE_CHILD_WIDTH = 2;
const MAX_TYPED_ARRAY_ROWS = 0xffff_ffff;

/** Exact authored and physical publication identity certified by the synchronized Rail Worker. */
export interface StaticFabOrganizationOutlineIndexSourceIdentity
	extends StaticFabOrganizationOverviewSourceIdentity {
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly physicalSequence: number;
	readonly physicalRevision: number;
	readonly physicalFingerprint: string;
}

/** Mutable caller-owned world-space meter bounds used as an allocation-free read target. */
export interface StaticFabOrganizationOutlineBounds {
	minX: number;
	minZ: number;
	maxX: number;
	maxZ: number;
}

export interface StaticFabOrganizationOutlineBvhSnapshot {
	readonly rootNode: number;
	readonly bounds: Float64Array;
	/** Two rows per node. Leaves contain -1/-1. */
	readonly childNodes: Int32Array;
	/** Per-node CSR offsets. Internal nodes own an empty range. */
	readonly leafOrganizationOffsets: Uint32Array;
	readonly leafOrganizationRows: Uint32Array;
}

/**
 * Closure-free O(semantic organization count) Worker payload. DIRECT/EFFECTIVE bounds use a NaN
 * quartet for an empty extent. Only finite EFFECTIVE rows enter the packed BVH: Canvas selection
 * must not change because a hidden library panel changes its direct/effective display preference.
 */
export interface StaticFabOrganizationOutlineIndexSnapshot {
	readonly kind: typeof STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_SNAPSHOT_KIND;
	readonly version: typeof STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_SNAPSHOT_VERSION;
	readonly fingerprint: string;
	readonly sourceRevision: number;
	readonly sourceChecksum: string;
	readonly sourceSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly sourcePhysicalSequence: number;
	readonly sourcePhysicalRevision: number;
	readonly sourcePhysicalFingerprint: string;
	readonly organizationIds: Int32Array;
	readonly organizationRoles: Uint8Array;
	readonly directBounds: Float64Array;
	readonly effectiveBounds: Float64Array;
	readonly bvh: StaticFabOrganizationOutlineBvhSnapshot;
}

/** Immutable, owned query facade over a validated Worker snapshot. */
export interface StaticFabOrganizationOutlineIndex {
	readonly kind: typeof STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_KIND;
	readonly version: typeof STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_VERSION;
	readonly fingerprint: string;
	readonly sourceRevision: number;
	readonly sourceChecksum: string;
	readonly sourceSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly sourcePhysicalSequence: number;
	readonly sourcePhysicalRevision: number;
	readonly sourcePhysicalFingerprint: string;
	readonly organizationCount: number;
	readonly indexedOrganizationCount: number;
	readonly bvhNodeCount: number;
	/** Owned typed-column payload retained by this facade. Useful for bounded scale telemetry. */
	readonly byteLength: number;
	readOrganizationId(row: number): number;
	readOrganizationRole(row: number): StaticFabOrganizationOutlineRole;
	/** Return false for a null extent and leave target unchanged. */
	readOrganizationBounds(
		row: number,
		scope: StaticFabOrganizationOutlineScope,
		target: StaticFabOrganizationOutlineBounds,
	): boolean;
	/**
	 * Fill semantic rows whose EFFECTIVE bounds intersect bounds in deterministic packed-index order.
	 * targetRows must have organizationCount capacity so no hot-path growth or result sorting is
	 * necessary on the per-frame renderer path.
	 */
	queryBounds(bounds: StaticFabOrganizationOutlineBounds, targetRows: Int32Array): number;
	/**
	 * Fill at most 64 rows from the highest-priority semantic role whose EFFECTIVE bounds contain
	 * the point. Rows are ordered by smaller extent, then ID for deterministic bounded choosers.
	 */
	queryPoint(worldX: number, worldZ: number, targetRows: Int32Array): number;
	/** Return the first queryPoint candidate without allocating, or -1. */
	hitTest(worldX: number, worldZ: number): number;
}

interface MutableBvhNode {
	readonly bounds: StaticFabOrganizationOutlineBounds;
	left: number;
	right: number;
	organizations: number[] | null;
}

type BoundsRowState = "FINITE" | "NULL";

const outlineArtifacts = new WeakSet<object>();

export function isStaticFabOrganizationOutlineIndex(
	value: unknown,
): value is StaticFabOrganizationOutlineIndex {
	return typeof value === "object" && value !== null && outlineArtifacts.has(value);
}

/**
 * Worker fast path over state already validated by RailPatchMirror. The physical publication is
 * checked by its private in-process source binding, but this function deliberately neither hashes
 * nor scans it. Equipment bodies use the shared pure authored-layout AABB helper or a conservative
 * support-envelope pad for terminal/switch OHBs; no attachment or presentation compile occurs.
 */
export function deriveStaticFabOrganizationOutlineIndexSnapshotFromValidatedSource(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	source: StaticFabOrganizationOutlineIndexSourceIdentity,
	physical: CompiledPhysicalLayout,
): StaticFabOrganizationOutlineIndexSnapshot {
	assertSourceIdentity(source, map, portEquipment, organizations);
	if (
		physical.revision !== source.physicalRevision ||
		compiledPhysicalLayoutHasDifferentSource(physical, map)
	) {
		throw new Error("Static FAB organization outline physical source is stale or foreign.");
	}
	const startRevision = map.getRevision();
	const semanticRoles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const allDirectBounds = deriveDirectOrganizationBounds(map, portEquipment, organizations);
	const allEffectiveBounds = deriveEffectiveOrganizationBounds(organizations, allDirectBounds);
	assertSourceIdentity(source, map, portEquipment, organizations);
	if (map.getRevision() !== startRevision) {
		throw new Error("Static FAB source changed while its organization outline was being derived.");
	}

	const selectedRows = organizations.records
		.map((record, row) => ({ id: record.id, role: semanticRoles.get(record.id), row }))
		.filter(
			(
				candidate,
			): candidate is {
				readonly id: number;
				readonly role: StaticFabOrganizationOutlineRole;
				readonly row: number;
			} => isOutlineRole(candidate.role),
		)
		.sort((left, right) => left.id - right.id);
	assertTypedArrayRows(selectedRows.length, "organization rows");

	const organizationIds = new Int32Array(selectedRows.length);
	const organizationRoles = new Uint8Array(selectedRows.length);
	const directBounds = createNullBoundsColumns(selectedRows.length);
	const effectiveBounds = createNullBoundsColumns(selectedRows.length);
	for (let organizationRow = 0; organizationRow < selectedRows.length; organizationRow++) {
		const selected = selectedRows[organizationRow];
		if (!selected) throw new Error(`Missing organization outline row ${organizationRow}.`);
		organizationIds[organizationRow] = selected.id;
		organizationRoles[organizationRow] = roleCode(selected.role);
		copyBoundsRow(allDirectBounds, selected.row, directBounds, organizationRow);
		copyBoundsRow(allEffectiveBounds, selected.row, effectiveBounds, organizationRow);
	}
	const bvh = buildPackedBvh(effectiveBounds);
	const snapshotWithoutFingerprint = {
		kind: STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_SNAPSHOT_KIND,
		version: STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_SNAPSHOT_VERSION,
		sourceRevision: source.revision,
		sourceChecksum: source.checksum,
		sourceSequence: source.sequence,
		sourceNextAdvancedSwitchId: source.nextAdvancedSwitchId,
		sourceNextPortId: source.nextPortId,
		sourceNextEquipmentGroupId: source.nextEquipmentGroupId,
		sourceNextOrganizationId: source.nextOrganizationId,
		sourcePhysicalSequence: source.physicalSequence,
		sourcePhysicalRevision: source.physicalRevision,
		sourcePhysicalFingerprint: source.physicalFingerprint,
		organizationIds,
		organizationRoles,
		directBounds,
		effectiveBounds,
		bvh,
	} as const;
	return Object.freeze({
		...snapshotWithoutFingerprint,
		fingerprint: outlineSnapshotFingerprint(snapshotWithoutFingerprint),
	});
}

/** Exact transfer list containing only fresh full-buffer outline columns. */
export function collectStaticFabOrganizationOutlineIndexSnapshotTransferables(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
): ArrayBuffer[] {
	const buffers = [
		snapshot.organizationIds.buffer,
		snapshot.organizationRoles.buffer,
		snapshot.directBounds.buffer,
		snapshot.effectiveBounds.buffer,
		snapshot.bvh.bounds.buffer,
		snapshot.bvh.childNodes.buffer,
		snapshot.bvh.leafOrganizationOffsets.buffer,
		snapshot.bvh.leafOrganizationRows.buffer,
	];
	if (
		buffers.some((buffer) => !(buffer instanceof ArrayBuffer)) ||
		new Set(buffers).size !== buffers.length
	) {
		throw new Error("Static FAB organization outline snapshot buffers are not transferable.");
	}
	return buffers as ArrayBuffer[];
}

/** Validate a Worker payload, then retain only owned O(organization count) typed columns. */
export function hydrateStaticFabOrganizationOutlineIndexSnapshot(
	snapshot: unknown,
	expectedSource?: StaticFabOrganizationOutlineIndexSourceIdentity,
): StaticFabOrganizationOutlineIndex {
	validateOutlineSnapshot(snapshot, expectedSource);
	const owned = copyOutlineSnapshot(snapshot);
	const organizationCount = owned.organizationIds.length;
	const stack = new Int32Array(owned.bvh.childNodes.length / OUTLINE_CHILD_WIDTH);
	let queryActive = false;
	const beginQuery = (): void => {
		if (queryActive) throw new Error("Static FAB organization outline queries are not reentrant.");
		queryActive = true;
	};
	const finishQuery = (): void => {
		queryActive = false;
	};
	const artifact: StaticFabOrganizationOutlineIndex = Object.freeze({
		kind: STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_KIND,
		version: STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_VERSION,
		fingerprint: owned.fingerprint,
		sourceRevision: owned.sourceRevision,
		sourceChecksum: owned.sourceChecksum,
		sourceSequence: owned.sourceSequence,
		sourceNextAdvancedSwitchId: owned.sourceNextAdvancedSwitchId,
		sourceNextPortId: owned.sourceNextPortId,
		sourceNextEquipmentGroupId: owned.sourceNextEquipmentGroupId,
		sourceNextOrganizationId: owned.sourceNextOrganizationId,
		sourcePhysicalSequence: owned.sourcePhysicalSequence,
		sourcePhysicalRevision: owned.sourcePhysicalRevision,
		sourcePhysicalFingerprint: owned.sourcePhysicalFingerprint,
		organizationCount,
		indexedOrganizationCount: owned.bvh.leafOrganizationRows.length,
		bvhNodeCount: stack.length,
		byteLength:
			owned.organizationIds.byteLength +
			owned.organizationRoles.byteLength +
			owned.directBounds.byteLength +
			owned.effectiveBounds.byteLength +
			owned.bvh.bounds.byteLength +
			owned.bvh.childNodes.byteLength +
			owned.bvh.leafOrganizationOffsets.byteLength +
			owned.bvh.leafOrganizationRows.byteLength,
		readOrganizationId: (row: number): number => {
			assertRow(row, organizationCount, "organization");
			return owned.organizationIds[row] as number;
		},
		readOrganizationRole: (row: number): StaticFabOrganizationOutlineRole => {
			assertRow(row, organizationCount, "organization");
			return STATIC_FAB_ORGANIZATION_OUTLINE_ROLES[
				owned.organizationRoles[row] as number
			] as StaticFabOrganizationOutlineRole;
		},
		readOrganizationBounds: (
			row: number,
			scope: StaticFabOrganizationOutlineScope,
			target: StaticFabOrganizationOutlineBounds,
		): boolean => {
			assertRow(row, organizationCount, "organization");
			const columns = scopeBoundsColumns(owned, scope);
			if (boundsRowState(columns, row) === "NULL") return false;
			readBoundsInto(columns, row, target);
			return true;
		},
		queryBounds: (bounds: StaticFabOrganizationOutlineBounds, targetRows: Int32Array): number => {
			assertFiniteBounds(bounds, "query bounds");
			assertQueryTarget(targetRows, organizationCount);
			if (owned.bvh.rootNode < 0) return 0;
			beginQuery();
			try {
				return collectBvhBoundsRows(owned, stack, targetRows, bounds);
			} finally {
				finishQuery();
			}
		},
		queryPoint: (worldX: number, worldZ: number, targetRows: Int32Array): number => {
			assertQueryTarget(
				targetRows,
				Math.min(organizationCount, STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES),
			);
			if (!Number.isFinite(worldX) || !Number.isFinite(worldZ) || owned.bvh.rootNode < 0) {
				return 0;
			}
			beginQuery();
			try {
				const count = collectBvhPointRows(
					owned,
					stack,
					targetRows,
					worldX,
					worldZ,
					Math.min(organizationCount, STATIC_FAB_ORGANIZATION_OUTLINE_MAX_POINT_CANDIDATES),
				);
				heapSortRows(targetRows, count, owned);
				return count;
			} finally {
				finishQuery();
			}
		},
		hitTest: (worldX: number, worldZ: number): number => {
			if (!Number.isFinite(worldX) || !Number.isFinite(worldZ) || owned.bvh.rootNode < 0) {
				return -1;
			}
			beginQuery();
			try {
				return hitTestBvh(owned, stack, worldX, worldZ);
			} finally {
				finishQuery();
			}
		},
	});
	outlineArtifacts.add(artifact);
	return artifact;
}

function deriveDirectOrganizationBounds(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): Float64Array {
	const bounds = createNullBoundsColumns(organizations.records.length);
	const switchBounds = new Map<number, StaticFabOrganizationOutlineBounds>();
	const equipmentBounds = new Map<number, StaticFabOrganizationOutlineBounds>();
	for (let row = 0; row < organizations.records.length; row++) {
		const record = organizations.records[row];
		if (!record) throw new Error(`Missing organization source row ${row}.`);
		const mutable = emptyBounds();
		for (const edge of record.membership.railEdges) {
			includeBounds(mutable, {
				minX: Math.min(edge.from.x, edge.to.x),
				minZ: Math.min(edge.from.y, edge.to.y),
				maxX: Math.max(edge.from.x, edge.to.x) + 1,
				maxZ: Math.max(edge.from.y, edge.to.y) + 1,
			});
		}
		for (const switchId of record.membership.advancedSwitchIds) {
			const candidate = resolveAdvancedSwitchBounds(map, switchBounds, switchId);
			includeBounds(mutable, candidate);
		}
		for (const groupId of record.membership.equipmentGroupIds) {
			let candidate = equipmentBounds.get(groupId);
			if (!candidate) {
				candidate = resolveEquipmentGroupBounds(map, portEquipment, switchBounds, groupId);
				equipmentBounds.set(groupId, candidate);
			}
			includeBounds(mutable, candidate);
		}
		if (hasFiniteBounds(mutable)) writeBounds(bounds, row, mutable);
	}
	return bounds;
}

function resolveEquipmentGroupBounds(
	map: TileMap,
	portEquipment: PortEquipmentState,
	switchBounds: Map<number, StaticFabOrganizationOutlineBounds>,
	groupId: number,
): StaticFabOrganizationOutlineBounds {
	const group = findCanonicalRecordById(portEquipment.equipmentGroups, groupId);
	if (!group) throw new Error(`Missing organization outline equipment group ${groupId}.`);
	const portsById = new Map<number, PortRecord>();
	for (const portId of group.portIds) {
		const port = findCanonicalRecordById(portEquipment.ports, portId);
		if (!port) throw new Error(`Missing organization outline equipment port ${portId}.`);
		portsById.set(portId, port);
	}
	const bodyBounds = equipmentGroupBodyBounds(group, portsById);
	if (bodyBounds) return bodyBounds;
	if (group.kind !== "OHB" || group.portIds.length !== 1) {
		throw new Error(`Equipment group ${groupId} has no authored outline body bounds.`);
	}
	const port = portsById.get(group.portIds[0] as number);
	if (!port) throw new Error(`Missing organization outline equipment port for group ${groupId}.`);
	const padding = port.lateralOffsetMillimeters / 1_000 + 0.5;
	const supportBounds =
		port.route.kind === "CARDINAL_CELL"
			? {
					minX: port.route.x,
					minZ: port.route.z,
					maxX: port.route.x + 1,
					maxZ: port.route.z + 1,
				}
			: resolveAdvancedSwitchBounds(map, switchBounds, port.route.switchId);
	return expandBounds(supportBounds, padding);
}

function findCanonicalRecordById<T extends { readonly id: number }>(
	records: readonly T[],
	id: number,
): T | null {
	let low = 0;
	let high = records.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const candidate = records[middle];
		if (!candidate) return null;
		if (candidate.id === id) return candidate;
		if (candidate.id < id) low = middle + 1;
		else high = middle - 1;
	}
	return null;
}

function resolveAdvancedSwitchBounds(
	map: TileMap,
	cache: Map<number, StaticFabOrganizationOutlineBounds>,
	switchId: number,
): StaticFabOrganizationOutlineBounds {
	let candidate = cache.get(switchId);
	if (candidate) return candidate;
	const advancedSwitch = map.getAdvancedSwitch(switchId);
	if (!advancedSwitch) throw new Error(`Missing organization outline switch ${switchId}.`);
	candidate = advancedSwitchBounds(advancedSwitch);
	cache.set(switchId, candidate);
	return candidate;
}

function expandBounds(
	bounds: StaticFabOrganizationOutlineBounds,
	padding: number,
): StaticFabOrganizationOutlineBounds {
	return {
		minX: bounds.minX - padding,
		minZ: bounds.minZ - padding,
		maxX: bounds.maxX + padding,
		maxZ: bounds.maxZ + padding,
	};
}

function deriveEffectiveOrganizationBounds(
	organizations: StaticFabOrganizationState,
	directBounds: Float64Array,
): Float64Array {
	const count = organizations.records.length;
	const result = directBounds.slice();
	const rowById = new Map(organizations.records.map((record, row) => [record.id, row] as const));
	const children = Array.from({ length: count }, () => [] as number[]);
	const parents = Array.from({ length: count }, () => [] as number[]);
	const indegrees = new Uint32Array(count);
	for (let childRow = 0; childRow < count; childRow++) {
		const record = organizations.records[childRow];
		if (!record) throw new Error(`Missing organization relationship row ${childRow}.`);
		for (const parentId of staticFabOrganizationParentIds(record)) {
			const parentRow = rowById.get(parentId);
			if (parentRow === undefined) {
				throw new Error(`Organization ${record.id} references missing parent ${parentId}.`);
			}
			children[parentRow]?.push(childRow);
			parents[childRow]?.push(parentRow);
			indegrees[childRow] = (indegrees[childRow] as number) + 1;
		}
	}
	const topologicalRows: number[] = [];
	for (let row = 0; row < count; row++) {
		if ((indegrees[row] as number) === 0) topologicalRows.push(row);
	}
	for (let offset = 0; offset < topologicalRows.length; offset++) {
		const row = topologicalRows[offset] as number;
		for (const child of children[row] ?? []) {
			indegrees[child] = (indegrees[child] as number) - 1;
			if ((indegrees[child] as number) === 0) topologicalRows.push(child);
		}
	}
	if (topologicalRows.length !== count) {
		throw new Error("Static FAB organization outline DAG is cyclic.");
	}
	for (let index = topologicalRows.length - 1; index >= 0; index--) {
		const child = topologicalRows[index] as number;
		if (boundsRowState(result, child) === "NULL") continue;
		for (const parent of parents[child] ?? []) includeBoundsRow(result, parent, result, child);
	}
	return result;
}

function advancedSwitchBounds(record: AdvancedSwitchRecord): StaticFabOrganizationOutlineBounds {
	const mutable = emptyBounds();
	for (const cell of deriveAdvancedSwitchGeometry(record).claimedCells) {
		includeBounds(mutable, {
			minX: cell.x,
			minZ: cell.y,
			maxX: cell.x + 1,
			maxZ: cell.y + 1,
		});
	}
	if (!hasFiniteBounds(mutable)) {
		throw new Error(`Advanced switch ${record.id} has no outline extent.`);
	}
	return mutable;
}

function buildPackedBvh(effectiveBounds: Float64Array): StaticFabOrganizationOutlineBvhSnapshot {
	const organizationCount = effectiveBounds.length / OUTLINE_BOUNDS_WIDTH;
	const indexedRows: number[] = [];
	for (let row = 0; row < organizationCount; row++) {
		if (boundsRowState(effectiveBounds, row) === "FINITE") indexedRows.push(row);
	}
	if (indexedRows.length === 0) {
		return Object.freeze({
			rootNode: -1,
			bounds: new Float64Array(0),
			childNodes: new Int32Array(0),
			leafOrganizationOffsets: new Uint32Array([0]),
			leafOrganizationRows: new Uint32Array(0),
		});
	}
	const nodes: MutableBvhNode[] = [];
	const build = (rows: number[]): number => {
		const bounds = unionBoundsRows(effectiveBounds, rows);
		const nodeIndex = nodes.length;
		nodes.push({ bounds, left: -1, right: -1, organizations: null });
		if (rows.length <= STATIC_FAB_ORGANIZATION_OUTLINE_BVH_LEAF_CAPACITY) {
			rows.sort((left, right) => left - right);
			const node = nodes[nodeIndex];
			if (node) node.organizations = rows;
			return nodeIndex;
		}
		const spanX = bounds.maxX - bounds.minX;
		const spanZ = bounds.maxZ - bounds.minZ;
		const axisOffset = spanX >= spanZ ? 0 : 1;
		rows.sort((left, right) => {
			const difference =
				boundsCenter(effectiveBounds, left, axisOffset) -
				boundsCenter(effectiveBounds, right, axisOffset);
			return difference || left - right;
		});
		const split = rows.length >>> 1;
		const left = build(rows.slice(0, split));
		const right = build(rows.slice(split));
		const node = nodes[nodeIndex];
		if (!node) throw new Error(`Missing organization outline BVH node ${nodeIndex}.`);
		node.left = left;
		node.right = right;
		return nodeIndex;
	};
	const rootNode = build(indexedRows);
	assertTypedArrayRows(nodes.length, "BVH nodes");
	const bounds = new Float64Array(nodes.length * OUTLINE_BOUNDS_WIDTH);
	const childNodes = new Int32Array(nodes.length * OUTLINE_CHILD_WIDTH);
	childNodes.fill(-1);
	const leafOrganizationOffsets = new Uint32Array(nodes.length + 1);
	const leafOrganizationRows = new Uint32Array(indexedRows.length);
	let leafOffset = 0;
	for (let nodeRow = 0; nodeRow < nodes.length; nodeRow++) {
		const node = nodes[nodeRow];
		if (!node) throw new Error(`Missing organization outline BVH node ${nodeRow}.`);
		writeBounds(bounds, nodeRow, node.bounds);
		childNodes[nodeRow * 2] = node.left;
		childNodes[nodeRow * 2 + 1] = node.right;
		leafOrganizationOffsets[nodeRow] = leafOffset;
		for (const organization of node.organizations ?? []) {
			leafOrganizationRows[leafOffset++] = organization;
		}
	}
	leafOrganizationOffsets[nodes.length] = leafOffset;
	if (leafOffset !== indexedRows.length) {
		throw new Error("Organization outline BVH lost an organization row.");
	}
	return Object.freeze({
		rootNode,
		bounds,
		childNodes,
		leafOrganizationOffsets,
		leafOrganizationRows,
	});
}

function collectBvhBoundsRows(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
	stack: Int32Array,
	targetRows: Int32Array,
	bounds: StaticFabOrganizationOutlineBounds,
): number {
	let stackSize = 0;
	let count = 0;
	stack[stackSize++] = snapshot.bvh.rootNode;
	while (stackSize > 0) {
		const node = stack[--stackSize] as number;
		if (!boundsIntersect(snapshot.bvh.bounds, node, bounds)) continue;
		const left = snapshot.bvh.childNodes[node * 2] as number;
		if (left >= 0) {
			stack[stackSize++] = snapshot.bvh.childNodes[node * 2 + 1] as number;
			stack[stackSize++] = left;
			continue;
		}
		const start = snapshot.bvh.leafOrganizationOffsets[node] as number;
		const end = snapshot.bvh.leafOrganizationOffsets[node + 1] as number;
		for (let offset = start; offset < end; offset++) {
			const organization = snapshot.bvh.leafOrganizationRows[offset] as number;
			if (boundsIntersect(snapshot.effectiveBounds, organization, bounds)) {
				targetRows[count++] = organization;
			}
		}
	}
	return count;
}

function collectBvhPointRows(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
	stack: Int32Array,
	targetRows: Int32Array,
	worldX: number,
	worldZ: number,
	maximumCandidates: number,
): number {
	let stackSize = 0;
	let count = 0;
	let bestRole = -1;
	stack[stackSize++] = snapshot.bvh.rootNode;
	while (stackSize > 0) {
		const node = stack[--stackSize] as number;
		if (!boundsContainPoint(snapshot.bvh.bounds, node, worldX, worldZ)) continue;
		const left = snapshot.bvh.childNodes[node * 2] as number;
		if (left >= 0) {
			stack[stackSize++] = snapshot.bvh.childNodes[node * 2 + 1] as number;
			stack[stackSize++] = left;
			continue;
		}
		const start = snapshot.bvh.leafOrganizationOffsets[node] as number;
		const end = snapshot.bvh.leafOrganizationOffsets[node + 1] as number;
		for (let offset = start; offset < end; offset++) {
			const organization = snapshot.bvh.leafOrganizationRows[offset] as number;
			if (!boundsContainPoint(snapshot.effectiveBounds, organization, worldX, worldZ)) continue;
			const role = snapshot.organizationRoles[organization] as number;
			if (role < bestRole) continue;
			if (role > bestRole) {
				bestRole = role;
				count = 0;
			}
			if (count < maximumCandidates) {
				targetRows[count++] = organization;
				continue;
			}
			let worstIndex = 0;
			for (let candidateIndex = 1; candidateIndex < count; candidateIndex++) {
				if (
					compareHitRows(
						snapshot,
						targetRows[worstIndex] as number,
						targetRows[candidateIndex] as number,
					) < 0
				) {
					worstIndex = candidateIndex;
				}
			}
			if (compareHitRows(snapshot, organization, targetRows[worstIndex] as number) < 0) {
				targetRows[worstIndex] = organization;
			}
		}
	}
	return count;
}

function hitTestBvh(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
	stack: Int32Array,
	worldX: number,
	worldZ: number,
): number {
	let stackSize = 0;
	let best = -1;
	stack[stackSize++] = snapshot.bvh.rootNode;
	while (stackSize > 0) {
		const node = stack[--stackSize] as number;
		if (!boundsContainPoint(snapshot.bvh.bounds, node, worldX, worldZ)) continue;
		const left = snapshot.bvh.childNodes[node * 2] as number;
		if (left >= 0) {
			stack[stackSize++] = snapshot.bvh.childNodes[node * 2 + 1] as number;
			stack[stackSize++] = left;
			continue;
		}
		const start = snapshot.bvh.leafOrganizationOffsets[node] as number;
		const end = snapshot.bvh.leafOrganizationOffsets[node + 1] as number;
		for (let offset = start; offset < end; offset++) {
			const organization = snapshot.bvh.leafOrganizationRows[offset] as number;
			if (!boundsContainPoint(snapshot.effectiveBounds, organization, worldX, worldZ)) continue;
			if (best < 0 || compareHitRows(snapshot, organization, best) < 0) best = organization;
		}
	}
	return best;
}

function validateOutlineSnapshot(
	value: unknown,
	expectedSource?: StaticFabOrganizationOutlineIndexSourceIdentity,
): asserts value is StaticFabOrganizationOutlineIndexSnapshot {
	if (!isRecord(value)) throw new Error("Static FAB organization outline snapshot is malformed.");
	if (
		value.kind !== STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_SNAPSHOT_KIND ||
		value.version !== STATIC_FAB_ORGANIZATION_OUTLINE_INDEX_SNAPSHOT_VERSION
	) {
		throw new Error("Static FAB organization outline snapshot kind or version is invalid.");
	}
	const source = sourceIdentityFromSnapshot(value);
	assertSourceIdentityValue(source);
	if (expectedSource) assertExpectedSource(source, expectedSource);
	if (typeof value.fingerprint !== "string" || !/^sfoi1-[0-9a-f]{16}$/.test(value.fingerprint)) {
		throw new Error("Static FAB organization outline snapshot fingerprint is invalid.");
	}
	assertInt32Array(value.organizationIds, undefined, "organization IDs");
	assertStrictPositiveAscending(value.organizationIds, "organization IDs");
	const organizationCount = value.organizationIds.length;
	assertUint8Array(value.organizationRoles, organizationCount, "organization roles");
	for (let row = 0; row < organizationCount; row++) {
		if ((value.organizationRoles[row] as number) >= STATIC_FAB_ORGANIZATION_OUTLINE_ROLES.length) {
			throw new Error(`Static FAB organization outline role row ${row} is invalid.`);
		}
	}
	assertFloat64Array(value.directBounds, organizationCount * OUTLINE_BOUNDS_WIDTH, "direct bounds");
	assertFloat64Array(
		value.effectiveBounds,
		organizationCount * OUTLINE_BOUNDS_WIDTH,
		"effective bounds",
	);
	validateOrganizationBounds(value.directBounds, value.effectiveBounds, organizationCount);
	validateBvh(value.bvh, value.effectiveBounds, organizationCount);
	const snapshot = value as unknown as StaticFabOrganizationOutlineIndexSnapshot;
	if (snapshot.fingerprint !== outlineSnapshotFingerprint(snapshot)) {
		throw new Error("Static FAB organization outline snapshot fingerprint is invalid.");
	}
}

function validateOrganizationBounds(
	directBounds: Float64Array,
	effectiveBounds: Float64Array,
	organizationCount: number,
): void {
	for (let row = 0; row < organizationCount; row++) {
		const direct = validateOptionalBoundsRow(directBounds, row, "direct bounds");
		const effective = validateOptionalBoundsRow(effectiveBounds, row, "effective bounds");
		if (
			direct === "FINITE" &&
			(effective === "NULL" || !boundsContainBounds(effectiveBounds, row, directBounds, row))
		) {
			throw new Error(
				`Static FAB organization outline effective bounds row ${row} do not contain direct bounds.`,
			);
		}
	}
}

function validateBvh(
	value: unknown,
	effectiveBounds: Float64Array,
	organizationCount: number,
): asserts value is StaticFabOrganizationOutlineBvhSnapshot {
	if (!isRecord(value)) throw new Error("Static FAB organization outline BVH is malformed.");
	if (!Number.isInteger(value.rootNode)) {
		throw new Error("Static FAB organization outline BVH root is malformed.");
	}
	assertFloat64Array(value.bounds, undefined, "BVH bounds");
	if (value.bounds.length % OUTLINE_BOUNDS_WIDTH !== 0) {
		throw new Error("Static FAB organization outline BVH bounds are malformed.");
	}
	const nodeCount = value.bounds.length / OUTLINE_BOUNDS_WIDTH;
	assertInt32Array(value.childNodes, nodeCount * OUTLINE_CHILD_WIDTH, "BVH child nodes");
	assertUint32Array(value.leafOrganizationOffsets, nodeCount + 1, "BVH leaf offsets");
	assertUint32Array(value.leafOrganizationRows, undefined, "BVH leaf rows");
	for (let node = 0; node < nodeCount; node++) {
		if (validateOptionalBoundsRow(value.bounds, node, "BVH bounds") !== "FINITE") {
			throw new Error(`Static FAB organization outline BVH bounds row ${node} is null.`);
		}
	}
	let expectedIndexedCount = 0;
	for (let row = 0; row < organizationCount; row++) {
		if (boundsRowState(effectiveBounds, row) === "FINITE") expectedIndexedCount++;
	}
	if (value.leafOrganizationRows.length !== expectedIndexedCount) {
		throw new Error("Static FAB organization outline BVH indexed row count is invalid.");
	}
	if (expectedIndexedCount === 0) {
		if (
			value.rootNode !== -1 ||
			nodeCount !== 0 ||
			(value.leafOrganizationOffsets[0] as number) !== 0
		) {
			throw new Error("Static FAB organization outline empty BVH is malformed.");
		}
		return;
	}
	if (
		value.rootNode !== 0 ||
		nodeCount < 1 ||
		nodeCount > expectedIndexedCount * 2 - 1 ||
		(value.leafOrganizationOffsets[0] as number) !== 0 ||
		(value.leafOrganizationOffsets[nodeCount] as number) !== expectedIndexedCount
	) {
		throw new Error("Static FAB organization outline BVH boundary is malformed.");
	}
	const nodeVisits = new Uint8Array(nodeCount);
	const organizationVisits = new Uint8Array(organizationCount);
	const pending = new Uint32Array(nodeCount);
	let pendingCount = 1;
	pending[0] = 0;
	while (pendingCount > 0) {
		const node = pending[--pendingCount] as number;
		if ((nodeVisits[node] as number) !== 0) {
			throw new Error(`Static FAB organization outline BVH node ${node} is repeated.`);
		}
		nodeVisits[node] = 1;
		const start = value.leafOrganizationOffsets[node] as number;
		const end = value.leafOrganizationOffsets[node + 1] as number;
		if (end < start || end > expectedIndexedCount) {
			throw new Error(`Static FAB organization outline BVH leaf CSR row ${node} is malformed.`);
		}
		const left = value.childNodes[node * 2] as number;
		const right = value.childNodes[node * 2 + 1] as number;
		const leaf = left === -1 && right === -1;
		if (leaf) {
			if (end === start || end - start > STATIC_FAB_ORGANIZATION_OUTLINE_BVH_LEAF_CAPACITY) {
				throw new Error(`Static FAB organization outline BVH leaf ${node} is malformed.`);
			}
			const rows: number[] = [];
			for (let offset = start; offset < end; offset++) {
				const organization = value.leafOrganizationRows[offset] as number;
				if (
					organization >= organizationCount ||
					boundsRowState(effectiveBounds, organization) !== "FINITE" ||
					(organizationVisits[organization] as number) !== 0
				) {
					throw new Error(
						`Static FAB organization outline BVH organization row ${organization} is invalid.`,
					);
				}
				organizationVisits[organization] = 1;
				rows.push(organization);
			}
			assertBoundsEqual(
				value.bounds,
				node,
				unionBoundsRows(effectiveBounds, rows),
				`BVH leaf ${node}`,
			);
			continue;
		}
		if (
			left <= node ||
			right <= node ||
			left >= nodeCount ||
			right >= nodeCount ||
			left === right ||
			start !== end
		) {
			throw new Error(`Static FAB organization outline BVH branch ${node} is malformed.`);
		}
		pending[pendingCount++] = right;
		pending[pendingCount++] = left;
	}
	for (let node = 0; node < nodeCount; node++) {
		if ((nodeVisits[node] as number) === 0) {
			throw new Error("Static FAB organization outline BVH is incomplete.");
		}
	}
	for (let row = 0; row < organizationCount; row++) {
		const expected = boundsRowState(effectiveBounds, row) === "FINITE" ? 1 : 0;
		if ((organizationVisits[row] as number) !== expected) {
			throw new Error("Static FAB organization outline BVH is incomplete.");
		}
	}
	for (let node = nodeCount - 1; node >= 0; node--) {
		const left = value.childNodes[node * 2] as number;
		if (left < 0) continue;
		const right = value.childNodes[node * 2 + 1] as number;
		assertBoundsEqual(
			value.bounds,
			node,
			unionBounds(readBounds(value.bounds, left), readBounds(value.bounds, right)),
			`BVH branch ${node}`,
		);
	}
}

function copyOutlineSnapshot(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
): StaticFabOrganizationOutlineIndexSnapshot {
	return Object.freeze({
		kind: snapshot.kind,
		version: snapshot.version,
		fingerprint: snapshot.fingerprint,
		sourceRevision: snapshot.sourceRevision,
		sourceChecksum: snapshot.sourceChecksum,
		sourceSequence: snapshot.sourceSequence,
		sourceNextAdvancedSwitchId: snapshot.sourceNextAdvancedSwitchId,
		sourceNextPortId: snapshot.sourceNextPortId,
		sourceNextEquipmentGroupId: snapshot.sourceNextEquipmentGroupId,
		sourceNextOrganizationId: snapshot.sourceNextOrganizationId,
		sourcePhysicalSequence: snapshot.sourcePhysicalSequence,
		sourcePhysicalRevision: snapshot.sourcePhysicalRevision,
		sourcePhysicalFingerprint: snapshot.sourcePhysicalFingerprint,
		organizationIds: snapshot.organizationIds.slice(),
		organizationRoles: snapshot.organizationRoles.slice(),
		directBounds: snapshot.directBounds.slice(),
		effectiveBounds: snapshot.effectiveBounds.slice(),
		bvh: Object.freeze({
			rootNode: snapshot.bvh.rootNode,
			bounds: snapshot.bvh.bounds.slice(),
			childNodes: snapshot.bvh.childNodes.slice(),
			leafOrganizationOffsets: snapshot.bvh.leafOrganizationOffsets.slice(),
			leafOrganizationRows: snapshot.bvh.leafOrganizationRows.slice(),
		}),
	});
}

type FingerprintSource = Omit<StaticFabOrganizationOutlineIndexSnapshot, "fingerprint"> & {
	readonly fingerprint?: string;
};

function outlineSnapshotFingerprint(snapshot: FingerprintSource): string {
	const digest = new OutlineFingerprintBuilder();
	digest.addText("kind", snapshot.kind);
	digest.addText("version", `${snapshot.version}`);
	digest.addText("source.revision", `${snapshot.sourceRevision}`);
	digest.addText("source.checksum", snapshot.sourceChecksum);
	digest.addText("source.sequence", `${snapshot.sourceSequence}`);
	digest.addText("source.nextAdvancedSwitchId", `${snapshot.sourceNextAdvancedSwitchId}`);
	digest.addText("source.nextPortId", `${snapshot.sourceNextPortId}`);
	digest.addText("source.nextEquipmentGroupId", `${snapshot.sourceNextEquipmentGroupId}`);
	digest.addText("source.nextOrganizationId", `${snapshot.sourceNextOrganizationId}`);
	digest.addText("source.physicalSequence", `${snapshot.sourcePhysicalSequence}`);
	digest.addText("source.physicalRevision", `${snapshot.sourcePhysicalRevision}`);
	digest.addText("source.physicalFingerprint", snapshot.sourcePhysicalFingerprint);
	digest.addColumn("organizationIds", snapshot.organizationIds);
	digest.addColumn("organizationRoles", snapshot.organizationRoles);
	digest.addColumn("directBounds", snapshot.directBounds);
	digest.addColumn("effectiveBounds", snapshot.effectiveBounds);
	digest.addText("bvh.rootNode", `${snapshot.bvh.rootNode}`);
	digest.addColumn("bvh.bounds", snapshot.bvh.bounds);
	digest.addColumn("bvh.childNodes", snapshot.bvh.childNodes);
	digest.addColumn("bvh.leafOrganizationOffsets", snapshot.bvh.leafOrganizationOffsets);
	digest.addColumn("bvh.leafOrganizationRows", snapshot.bvh.leafOrganizationRows);
	return digest.finish();
}

class OutlineFingerprintBuilder {
	private primary = 0x811c_9dc5;
	private secondary = 0x9e37_79b9;

	addText(label: string, value: string): void {
		this.mixText(label);
		this.mixText(value);
	}

	addColumn(label: string, value: ArrayBufferView): void {
		this.mixText(label);
		this.mixText(value.constructor.name);
		this.mixUint32(value.byteLength);
		const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		for (const byte of bytes) this.mixByte(byte);
	}

	finish(): string {
		return `sfoi1-${this.primary.toString(16).padStart(8, "0")}${this.secondary
			.toString(16)
			.padStart(8, "0")}`;
	}

	private mixText(value: string): void {
		this.mixUint32(value.length);
		for (let index = 0; index < value.length; index++) {
			const code = value.charCodeAt(index);
			this.mixByte(code & 0xff);
			this.mixByte(code >>> 8);
		}
	}

	private mixUint32(value: number): void {
		this.mixByte(value & 0xff);
		this.mixByte((value >>> 8) & 0xff);
		this.mixByte((value >>> 16) & 0xff);
		this.mixByte((value >>> 24) & 0xff);
	}

	private mixByte(value: number): void {
		this.primary = Math.imul(this.primary ^ value, 0x0100_0193) >>> 0;
		this.secondary = Math.imul(this.secondary ^ (value ^ 0xa5), 0x0100_0193) >>> 0;
	}
}

function assertSourceIdentity(
	source: StaticFabOrganizationOutlineIndexSourceIdentity,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): void {
	assertSourceIdentityValue(source);
	if (
		source.revision !== map.getRevision() ||
		source.physicalRevision !== map.getRevision() ||
		source.nextAdvancedSwitchId !== map.getAdvancedSwitchIdCursor() ||
		source.nextPortId !== portEquipment.nextPortId ||
		source.nextEquipmentGroupId !== portEquipment.nextEquipmentGroupId ||
		source.nextOrganizationId !== organizations.nextOrganizationId
	) {
		throw new Error("Static FAB organization outline source identity is stale.");
	}
}

function assertSourceIdentityValue(
	source: unknown,
): asserts source is StaticFabOrganizationOutlineIndexSourceIdentity {
	if (!isRecord(source)) throw new Error("Static FAB organization outline source is malformed.");
	for (const field of ["revision", "sequence", "physicalSequence", "physicalRevision"] as const) {
		if (!Number.isSafeInteger(source[field]) || (source[field] as number) < 0) {
			throw new Error(`Static FAB organization outline source ${field} is invalid.`);
		}
	}
	for (const field of [
		"nextAdvancedSwitchId",
		"nextPortId",
		"nextEquipmentGroupId",
		"nextOrganizationId",
	] as const) {
		if (!Number.isSafeInteger(source[field]) || (source[field] as number) < 1) {
			throw new Error(`Static FAB organization outline source ${field} is invalid.`);
		}
	}
	if (source.physicalSequence !== source.sequence || source.physicalRevision !== source.revision) {
		throw new Error("Static FAB organization outline authored and physical identity diverged.");
	}
	if (
		typeof source.checksum !== "string" ||
		source.checksum.length === 0 ||
		source.checksum !== source.checksum.trim()
	) {
		throw new Error("Static FAB organization outline source checksum is invalid.");
	}
	if (
		typeof source.physicalFingerprint !== "string" ||
		!/^([0-9a-f]{8}):([0-9a-f]{8})$/.test(source.physicalFingerprint)
	) {
		throw new Error("Static FAB organization outline source physical fingerprint is invalid.");
	}
}

function sourceIdentityFromSnapshot(
	value: Record<string, unknown>,
): StaticFabOrganizationOutlineIndexSourceIdentity {
	return {
		revision: value.sourceRevision as number,
		checksum: value.sourceChecksum as string,
		sequence: value.sourceSequence as number,
		nextAdvancedSwitchId: value.sourceNextAdvancedSwitchId as number,
		nextPortId: value.sourceNextPortId as number,
		nextEquipmentGroupId: value.sourceNextEquipmentGroupId as number,
		nextOrganizationId: value.sourceNextOrganizationId as number,
		physicalSequence: value.sourcePhysicalSequence as number,
		physicalRevision: value.sourcePhysicalRevision as number,
		physicalFingerprint: value.sourcePhysicalFingerprint as string,
	};
}

function assertExpectedSource(
	actual: StaticFabOrganizationOutlineIndexSourceIdentity,
	expected: StaticFabOrganizationOutlineIndexSourceIdentity,
): void {
	assertSourceIdentityValue(expected);
	for (const field of [
		"revision",
		"checksum",
		"sequence",
		"nextAdvancedSwitchId",
		"nextPortId",
		"nextEquipmentGroupId",
		"nextOrganizationId",
		"physicalSequence",
		"physicalRevision",
		"physicalFingerprint",
	] as const) {
		if (actual[field] !== expected[field]) {
			throw new Error(`Static FAB organization outline source ${field} does not match expected.`);
		}
	}
}

function roleCode(role: StaticFabOrganizationOutlineRole): number {
	const code = STATIC_FAB_ORGANIZATION_OUTLINE_ROLES.indexOf(role);
	if (code < 0) throw new Error(`Unknown static FAB organization outline role ${role}.`);
	return code;
}

function isOutlineRole(
	role: StaticFabOrganizationSemanticRole | undefined,
): role is StaticFabOrganizationOutlineRole {
	return role === "FAB" || role === "BAY_BANK" || role === "BAY";
}

function scopeBoundsColumns(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
	scope: StaticFabOrganizationOutlineScope,
): Float64Array {
	if (scope === "DIRECT") return snapshot.directBounds;
	if (scope === "EFFECTIVE") return snapshot.effectiveBounds;
	throw new Error(`Unknown static FAB organization outline scope ${String(scope)}.`);
}

function createNullBoundsColumns(rowCount: number): Float64Array {
	const columns = new Float64Array(rowCount * OUTLINE_BOUNDS_WIDTH);
	columns.fill(Number.NaN);
	return columns;
}

function emptyBounds(): StaticFabOrganizationOutlineBounds {
	return {
		minX: Number.POSITIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		maxZ: Number.NEGATIVE_INFINITY,
	};
}

function hasFiniteBounds(bounds: StaticFabOrganizationOutlineBounds): boolean {
	return Number.isFinite(bounds.minX);
}

function includeBounds(
	target: StaticFabOrganizationOutlineBounds,
	bounds: StaticFabOrganizationOutlineBounds,
): void {
	assertFiniteBounds(bounds, "source bounds");
	target.minX = Math.min(target.minX, bounds.minX);
	target.minZ = Math.min(target.minZ, bounds.minZ);
	target.maxX = Math.max(target.maxX, bounds.maxX);
	target.maxZ = Math.max(target.maxZ, bounds.maxZ);
}

function includeBoundsRow(
	targetColumns: Float64Array,
	targetRow: number,
	sourceColumns: Float64Array,
	sourceRow: number,
): void {
	if (boundsRowState(sourceColumns, sourceRow) === "NULL") return;
	if (boundsRowState(targetColumns, targetRow) === "NULL") {
		copyBoundsRow(sourceColumns, sourceRow, targetColumns, targetRow);
		return;
	}
	const target = readBounds(targetColumns, targetRow);
	includeBounds(target, readBounds(sourceColumns, sourceRow));
	writeBounds(targetColumns, targetRow, target);
}

function writeBounds(
	columns: Float64Array,
	row: number,
	bounds: StaticFabOrganizationOutlineBounds,
): void {
	const offset = row * OUTLINE_BOUNDS_WIDTH;
	columns[offset] = bounds.minX;
	columns[offset + 1] = bounds.minZ;
	columns[offset + 2] = bounds.maxX;
	columns[offset + 3] = bounds.maxZ;
}

function copyBoundsRow(
	source: Float64Array,
	sourceRow: number,
	target: Float64Array,
	targetRow: number,
): void {
	const sourceOffset = sourceRow * OUTLINE_BOUNDS_WIDTH;
	const targetOffset = targetRow * OUTLINE_BOUNDS_WIDTH;
	for (let index = 0; index < OUTLINE_BOUNDS_WIDTH; index++) {
		target[targetOffset + index] = source[sourceOffset + index] as number;
	}
}

function readBounds(columns: Float64Array, row: number): StaticFabOrganizationOutlineBounds {
	const target = emptyBounds();
	readBoundsInto(columns, row, target);
	return target;
}

function readBoundsInto(
	columns: Float64Array,
	row: number,
	target: StaticFabOrganizationOutlineBounds,
): void {
	const offset = row * OUTLINE_BOUNDS_WIDTH;
	target.minX = columns[offset] as number;
	target.minZ = columns[offset + 1] as number;
	target.maxX = columns[offset + 2] as number;
	target.maxZ = columns[offset + 3] as number;
}

function boundsRowState(columns: Float64Array, row: number): BoundsRowState {
	return Number.isNaN(columns[row * OUTLINE_BOUNDS_WIDTH] as number) ? "NULL" : "FINITE";
}

function validateOptionalBoundsRow(
	columns: Float64Array,
	row: number,
	label: string,
): BoundsRowState {
	const bounds = readBounds(columns, row);
	const values = [bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ];
	if (values.every(Number.isNaN)) return "NULL";
	try {
		assertFiniteBounds(bounds, label);
	} catch {
		throw new Error(`Static FAB organization outline ${label} row ${row} is invalid.`);
	}
	return "FINITE";
}

function unionBounds(
	left: StaticFabOrganizationOutlineBounds,
	right: StaticFabOrganizationOutlineBounds,
): StaticFabOrganizationOutlineBounds {
	return {
		minX: Math.min(left.minX, right.minX),
		minZ: Math.min(left.minZ, right.minZ),
		maxX: Math.max(left.maxX, right.maxX),
		maxZ: Math.max(left.maxZ, right.maxZ),
	};
}

function unionBoundsRows(
	columns: Float64Array,
	rows: readonly number[],
): StaticFabOrganizationOutlineBounds {
	const mutable = emptyBounds();
	for (const row of rows) includeBounds(mutable, readBounds(columns, row));
	if (!hasFiniteBounds(mutable)) {
		throw new Error("Static FAB organization outline BVH node has no finite rows.");
	}
	return mutable;
}

function boundsCenter(columns: Float64Array, row: number, axisOffset: 0 | 1): number {
	const offset = row * OUTLINE_BOUNDS_WIDTH + axisOffset;
	return (columns[offset] as number) * 0.5 + (columns[offset + 2] as number) * 0.5;
}

function boundsIntersect(
	columns: Float64Array,
	row: number,
	bounds: StaticFabOrganizationOutlineBounds,
): boolean {
	const offset = row * OUTLINE_BOUNDS_WIDTH;
	return !(
		(columns[offset + 2] as number) < bounds.minX ||
		(columns[offset] as number) > bounds.maxX ||
		(columns[offset + 3] as number) < bounds.minZ ||
		(columns[offset + 1] as number) > bounds.maxZ
	);
}

function boundsContainPoint(columns: Float64Array, row: number, x: number, z: number): boolean {
	const offset = row * OUTLINE_BOUNDS_WIDTH;
	return (
		x >= (columns[offset] as number) &&
		x <= (columns[offset + 2] as number) &&
		z >= (columns[offset + 1] as number) &&
		z <= (columns[offset + 3] as number)
	);
}

function boundsContainBounds(
	outerColumns: Float64Array,
	outerRow: number,
	innerColumns: Float64Array,
	innerRow: number,
): boolean {
	const outer = outerRow * OUTLINE_BOUNDS_WIDTH;
	const inner = innerRow * OUTLINE_BOUNDS_WIDTH;
	return (
		(outerColumns[outer] as number) <= (innerColumns[inner] as number) &&
		(outerColumns[outer + 1] as number) <= (innerColumns[inner + 1] as number) &&
		(outerColumns[outer + 2] as number) >= (innerColumns[inner + 2] as number) &&
		(outerColumns[outer + 3] as number) >= (innerColumns[inner + 3] as number)
	);
}

function logarithmicBoundsArea(columns: Float64Array, row: number): number {
	const offset = row * OUTLINE_BOUNDS_WIDTH;
	const width = (columns[offset + 2] as number) - (columns[offset] as number);
	const height = (columns[offset + 3] as number) - (columns[offset + 1] as number);
	return width === 0 || height === 0
		? Number.NEGATIVE_INFINITY
		: Math.log(width) + Math.log(height);
}

function compareHitRows(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
	left: number,
	right: number,
): number {
	const roleDifference =
		(snapshot.organizationRoles[right] as number) - (snapshot.organizationRoles[left] as number);
	if (roleDifference !== 0) return roleDifference;
	const leftArea = logarithmicBoundsArea(snapshot.effectiveBounds, left);
	const rightArea = logarithmicBoundsArea(snapshot.effectiveBounds, right);
	if (leftArea < rightArea) return -1;
	if (leftArea > rightArea) return 1;
	return (snapshot.organizationIds[left] as number) - (snapshot.organizationIds[right] as number);
}

function heapSortRows(
	rows: Int32Array,
	count: number,
	snapshot?: StaticFabOrganizationOutlineIndexSnapshot,
): void {
	for (let root = (count >>> 1) - 1; root >= 0; root--) {
		siftDownRows(rows, root, count, snapshot);
	}
	for (let end = count - 1; end > 0; end--) {
		const first = rows[0] as number;
		rows[0] = rows[end] as number;
		rows[end] = first;
		siftDownRows(rows, 0, end, snapshot);
	}
}

function siftDownRows(
	rows: Int32Array,
	root: number,
	end: number,
	snapshot: StaticFabOrganizationOutlineIndexSnapshot | undefined,
): void {
	while (true) {
		const left = root * 2 + 1;
		if (left >= end) return;
		const right = left + 1;
		let largest = left;
		if (
			right < end &&
			compareOrderedRows(snapshot, rows[right] as number, rows[left] as number) > 0
		) {
			largest = right;
		}
		if (compareOrderedRows(snapshot, rows[largest] as number, rows[root] as number) <= 0) {
			return;
		}
		const current = rows[root] as number;
		rows[root] = rows[largest] as number;
		rows[largest] = current;
		root = largest;
	}
}

function compareOrderedRows(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot | undefined,
	left: number,
	right: number,
): number {
	return snapshot ? compareHitRows(snapshot, left, right) : left - right;
}

function assertBoundsEqual(
	columns: Float64Array,
	row: number,
	expected: StaticFabOrganizationOutlineBounds,
	label: string,
): void {
	const actual = readBounds(columns, row);
	if (
		actual.minX !== expected.minX ||
		actual.minZ !== expected.minZ ||
		actual.maxX !== expected.maxX ||
		actual.maxZ !== expected.maxZ
	) {
		throw new Error(`Static FAB organization outline ${label} bounds are invalid.`);
	}
}

function assertFiniteBounds(bounds: StaticFabOrganizationOutlineBounds, label: string): void {
	if (
		![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(Number.isFinite) ||
		bounds.minX > bounds.maxX ||
		bounds.minZ > bounds.maxZ
	) {
		throw new Error(`Static FAB organization outline ${label} are invalid.`);
	}
}

function assertQueryTarget(
	target: unknown,
	organizationCount: number,
): asserts target is Int32Array {
	if (!(target instanceof Int32Array) || target.length < organizationCount) {
		throw new RangeError(
			`Static FAB organization outline query target needs ${organizationCount} rows.`,
		);
	}
}

function assertRow(row: number, count: number, label: string): void {
	if (!Number.isInteger(row) || row < 0 || row >= count) {
		throw new RangeError(`Static FAB organization outline ${label} row ${row} is out of range.`);
	}
}

function assertTypedArrayRows(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TYPED_ARRAY_ROWS) {
		throw new Error(`Static FAB organization outline ${label} exceed typed-array capacity.`);
	}
}

function assertStrictPositiveAscending(ids: Int32Array, label: string): void {
	let previous = 0;
	for (let row = 0; row < ids.length; row++) {
		const id = ids[row] as number;
		if (id <= previous) {
			throw new Error(`Static FAB organization outline ${label} row ${row} is invalid.`);
		}
		previous = id;
	}
}

function assertInt32Array(
	value: unknown,
	length: number | undefined,
	label: string,
): asserts value is Int32Array {
	if (
		!isTransferableTypedArray(value, Int32Array) ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength ||
		(length !== undefined && value.length !== length)
	) {
		throw new Error(`Static FAB organization outline ${label} are malformed.`);
	}
}

function assertUint8Array(
	value: unknown,
	length: number,
	label: string,
): asserts value is Uint8Array {
	if (
		!isTransferableTypedArray(value, Uint8Array) ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength ||
		value.length !== length
	) {
		throw new Error(`Static FAB organization outline ${label} are malformed.`);
	}
}

function assertUint32Array(
	value: unknown,
	length: number | undefined,
	label: string,
): asserts value is Uint32Array {
	if (
		!isTransferableTypedArray(value, Uint32Array) ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength ||
		(length !== undefined && value.length !== length)
	) {
		throw new Error(`Static FAB organization outline ${label} are malformed.`);
	}
}

function assertFloat64Array(
	value: unknown,
	length: number | undefined,
	label: string,
): asserts value is Float64Array {
	if (
		!isTransferableTypedArray(value, Float64Array) ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength ||
		(length !== undefined && value.length !== length)
	) {
		throw new Error(`Static FAB organization outline ${label} are malformed.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
