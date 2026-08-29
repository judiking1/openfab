import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import {
	copyPortEquipmentState,
	EQUIPMENT_GROUP_KINDS,
	type EquipmentGroupKind,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import { PORT_TYPES, type PortType } from "../core/PortRecord";
import { ALL_DIRECTIONS, type Direction, moveCell } from "../core/railShape";
import {
	STATIC_FAB_ORGANIZATION_COLORS,
	STATIC_FAB_ORGANIZATION_KINDS,
	type StaticFabOrganizationColor,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationStateError,
} from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";
import { isTransferableTypedArray } from "../worker/TransferableTypedArray";
import {
	type CompiledPhysicalLayout,
	compiledPhysicalLayoutHasDifferentSource,
	compilePhysicalRail,
} from "./PhysicalRailCompiler";
import type { PortAttachmentSourceIndex } from "./PortAttachmentResolver";
import {
	type CompiledPortEquipmentPresentation,
	compilePortEquipmentPresentation,
} from "./PortEquipmentPresentation";

export const STATIC_FAB_ORGANIZATION_OVERVIEW_VERSION = 2;
export const STATIC_FAB_ORGANIZATION_OVERVIEW_KIND = "static-fab-organization-overview" as const;
export const STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_VERSION = 2;
export const STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_KIND =
	"static-fab-organization-overview-snapshot" as const;

/**
 * A minimap never needs one retained point per authored rail cell. The overview keeps every cell
 * up to this bound, then takes a canonical fixed-stride sample that includes both end ranks.
 */
export const STATIC_FAB_ORGANIZATION_OVERVIEW_RAIL_SILHOUETTE_MAX_CELLS = 8_192;

const MAX_TYPED_ARRAY_ROWS = 0xffff_ffff;
const OVERVIEW_BOUNDS_ROW_COUNT = 5;
const OVERVIEW_COUNTS_WIDTH = 5;

export interface StaticFabOrganizationOverviewSourceIdentity {
	readonly revision: number;
	readonly checksum: string;
	readonly sequence: number;
}

/** World-space meter bounds. Maximum values are inclusive geometry extents, not cell indices. */
export interface StaticFabOrganizationOverviewBounds {
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

export interface StaticFabOrganizationOverviewCounts {
	readonly organizationCount: number;
	readonly railEdgeCount: number;
	readonly advancedSwitchCount: number;
	readonly equipmentGroupCount: number;
	readonly portCount: number;
}

export interface StaticFabOrganizationOverviewCoverage {
	readonly bounds: StaticFabOrganizationOverviewBounds | null;
	readonly counts: StaticFabOrganizationOverviewCounts;
}

export interface StaticFabOrganizationOverviewOrganization {
	readonly id: number;
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	readonly description: string;
	readonly color: StaticFabOrganizationColor;
	readonly parentOrganizationIds: readonly number[];
	readonly direct: StaticFabOrganizationOverviewCoverage;
	readonly effective: StaticFabOrganizationOverviewCoverage;
}

export interface StaticFabOrganizationOverviewRailEdge {
	readonly index: number;
	readonly fromX: number;
	readonly fromZ: number;
	readonly toX: number;
	readonly toZ: number;
	readonly bounds: StaticFabOrganizationOverviewBounds;
}

export interface StaticFabOrganizationOverviewAdvancedSwitch {
	readonly index: number;
	readonly id: number;
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly originX: number;
	readonly originZ: number;
	readonly forward: Direction;
	readonly lateral: Direction;
	readonly bounds: StaticFabOrganizationOverviewBounds;
}

export interface StaticFabOrganizationOverviewPort {
	readonly index: number;
	readonly id: number;
	readonly equipmentGroupId: number;
	readonly portType: PortType;
	readonly worldX: number;
	readonly worldZ: number;
	readonly bounds: StaticFabOrganizationOverviewBounds;
}

export interface StaticFabOrganizationOverviewEquipmentGroup {
	readonly index: number;
	readonly id: number;
	readonly kind: EquipmentGroupKind;
	readonly portCount: number;
	readonly bodySectionOffset: number;
	readonly bodySectionCount: number;
	readonly bounds: StaticFabOrganizationOverviewBounds;
}

export interface StaticFabOrganizationOverviewEquipmentBodySection {
	readonly index: number;
	readonly equipmentGroupIndex: number;
	readonly bounds: StaticFabOrganizationOverviewBounds;
}

export interface StaticFabOrganizationOverviewRailSilhouetteCell {
	readonly index: number;
	readonly x: number;
	readonly z: number;
}

/**
 * Immutable facade over private Int32Array x/z columns. `forEachCell` is the allocation-free
 * minimap path; copy methods intentionally detach mutable typed arrays from the artifact.
 */
export interface StaticFabOrganizationOverviewRailSilhouette {
	readonly sourceCellCount: number;
	readonly sampleCount: number;
	readonly sampleCap: typeof STATIC_FAB_ORGANIZATION_OVERVIEW_RAIL_SILHOUETTE_MAX_CELLS;
	readonly sampleStride: number;
	readX(index: number): number;
	readZ(index: number): number;
	readCell(index: number): StaticFabOrganizationOverviewRailSilhouetteCell;
	forEachCell(visit: (x: number, z: number, index: number) => void): void;
	copyXs(): Int32Array;
	copyZs(): Int32Array;
}

/**
 * Read-only, revision-bound overview. It is neither persisted nor accepted by any edit command.
 * All geometry readers address private typed columns captured during this one rebuild.
 */
export interface StaticFabOrganizationOverview {
	readonly kind: typeof STATIC_FAB_ORGANIZATION_OVERVIEW_KIND;
	readonly version: typeof STATIC_FAB_ORGANIZATION_OVERVIEW_VERSION;
	readonly fingerprint: string;
	readonly sourceRevision: number;
	readonly sourceChecksum: string;
	readonly sourceSequence: number;
	readonly bounds: StaticFabOrganizationOverviewBounds | null;
	readonly railBounds: StaticFabOrganizationOverviewBounds | null;
	readonly advancedSwitchBounds: StaticFabOrganizationOverviewBounds | null;
	readonly portBounds: StaticFabOrganizationOverviewBounds | null;
	readonly equipmentBounds: StaticFabOrganizationOverviewBounds | null;
	readonly counts: StaticFabOrganizationOverviewCounts;
	readonly railSilhouette: StaticFabOrganizationOverviewRailSilhouette;
	readonly equipmentBodySectionCount: number;
	readonly organizations: readonly StaticFabOrganizationOverviewOrganization[];
	readRailEdge(index: number): StaticFabOrganizationOverviewRailEdge;
	readAdvancedSwitch(index: number): StaticFabOrganizationOverviewAdvancedSwitch;
	readPort(index: number): StaticFabOrganizationOverviewPort;
	readEquipmentGroup(index: number): StaticFabOrganizationOverviewEquipmentGroup;
	readEquipmentBodySection(index: number): StaticFabOrganizationOverviewEquipmentBodySection;
}

export interface StaticFabOrganizationOverviewRailSilhouetteSnapshot {
	readonly sourceCellCount: number;
	readonly sampleStride: number;
	readonly xs: Int32Array;
	readonly zs: Int32Array;
}

export interface StaticFabOrganizationOverviewRailEdgeSnapshot {
	readonly fromXs: Int32Array;
	readonly fromZs: Int32Array;
	readonly toXs: Int32Array;
	readonly toZs: Int32Array;
}

export interface StaticFabOrganizationOverviewAdvancedSwitchSnapshot {
	readonly ids: Int32Array;
	readonly originXs: Int32Array;
	readonly originZs: Int32Array;
	readonly forwards: Uint8Array;
	readonly laterals: Uint8Array;
	readonly profileClasses: Uint8Array;
	readonly bounds: Float64Array;
}

export interface StaticFabOrganizationOverviewPortSnapshot {
	readonly ids: Int32Array;
	readonly equipmentGroupIds: Int32Array;
	readonly portTypes: Uint8Array;
	readonly worldPositions: Float64Array;
}

export interface StaticFabOrganizationOverviewEquipmentSnapshot {
	readonly ids: Int32Array;
	readonly kinds: Uint8Array;
	readonly portCounts: Uint32Array;
	readonly bodySectionOffsets: Uint32Array;
	readonly bounds: Float64Array;
	readonly bodySectionGroupRows: Uint32Array;
	readonly bodySectionBounds: Float64Array;
}

export interface StaticFabOrganizationOverviewOrganizationSnapshot {
	readonly ids: Int32Array;
	readonly kinds: Uint8Array;
	readonly names: readonly string[];
	readonly descriptions: readonly string[];
	readonly colors: Uint8Array;
	readonly parentOffsets: Uint32Array;
	readonly parentIds: Int32Array;
	readonly directBounds: Float64Array;
	readonly directCounts: Uint32Array;
	readonly effectiveBounds: Float64Array;
	readonly effectiveCounts: Uint32Array;
}

/**
 * Structured-clone-safe ownership snapshot produced by the overview Worker. It deliberately has no
 * readers or closures; all large numeric columns are transferable typed arrays.
 */
export interface StaticFabOrganizationOverviewSnapshot {
	readonly kind: typeof STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_KIND;
	readonly version: typeof STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_VERSION;
	readonly fingerprint: string;
	readonly sourceRevision: number;
	readonly sourceChecksum: string;
	readonly sourceSequence: number;
	/** Five rows: all, rail, advanced switch, port, equipment. NaN rows encode null bounds. */
	readonly bounds: Float64Array;
	/** One row in StaticFabOrganizationOverviewCounts field order. */
	readonly counts: Uint32Array;
	readonly railSilhouette: StaticFabOrganizationOverviewRailSilhouetteSnapshot;
	readonly railEdges: StaticFabOrganizationOverviewRailEdgeSnapshot;
	readonly advancedSwitches: StaticFabOrganizationOverviewAdvancedSwitchSnapshot;
	readonly ports: StaticFabOrganizationOverviewPortSnapshot;
	readonly equipment: StaticFabOrganizationOverviewEquipmentSnapshot;
	readonly organizations: StaticFabOrganizationOverviewOrganizationSnapshot;
}

interface RailEdgeColumns {
	readonly fromXs: Int32Array;
	readonly fromZs: Int32Array;
	readonly toXs: Int32Array;
	readonly toZs: Int32Array;
}

interface AdvancedSwitchColumns {
	readonly ids: Int32Array;
	readonly originXs: Int32Array;
	readonly originZs: Int32Array;
	readonly forwards: Uint8Array;
	readonly laterals: Uint8Array;
	readonly profileClasses: readonly AdvancedSwitchProfileClass[];
	readonly bounds: Float64Array;
}

interface PortColumns {
	readonly ids: Int32Array;
	readonly equipmentGroupIds: Int32Array;
	readonly portTypes: readonly PortType[];
	readonly worldPositions: Float64Array;
}

interface EquipmentColumns {
	readonly ids: Int32Array;
	readonly kinds: readonly EquipmentGroupKind[];
	readonly portCounts: Uint32Array;
	readonly bodySectionOffsets: Uint32Array;
	readonly bounds: Float64Array;
	readonly bodySectionGroupRows: Uint32Array;
	readonly bodySectionBounds: Float64Array;
}

interface OverviewEntityIndex {
	readonly edgeRowsByKey: ReadonlyMap<string, number>;
	readonly switchRowsById: ReadonlyMap<number, number>;
	readonly equipmentRowsById: ReadonlyMap<number, number>;
	readonly edges: RailEdgeColumns;
	readonly switches: AdvancedSwitchColumns;
	readonly ports: PortColumns;
	readonly equipment: EquipmentColumns;
	readonly presentation: CompiledPortEquipmentPresentation;
}

interface MutableBounds {
	minX: number;
	minZ: number;
	maxX: number;
	maxZ: number;
}

const overviewArtifacts = new WeakSet<object>();

export function isStaticFabOrganizationOverview(
	value: unknown,
): value is StaticFabOrganizationOverview {
	return typeof value === "object" && value !== null && overviewArtifacts.has(value);
}

/** Compile one immutable overview from the complete canonical static-FAB source generation. */
export function compileStaticFabOrganizationOverview(
	map: TileMap,
	portEquipmentInput: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	source: StaticFabOrganizationOverviewSourceIdentity,
): StaticFabOrganizationOverview {
	return hydrateStaticFabOrganizationOverviewSnapshot(
		deriveStaticFabOrganizationOverviewSnapshot(map, portEquipmentInput, organizations, source),
		source,
	);
}

/** Exact derivation entry point. Production invokes this only inside the disposable Worker. */
export function deriveStaticFabOrganizationOverviewSnapshot(
	map: TileMap,
	portEquipmentInput: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	source: StaticFabOrganizationOverviewSourceIdentity,
): StaticFabOrganizationOverviewSnapshot {
	assertSourceIdentity(map, source);
	assertPortEquipmentLayout(map, portEquipmentInput);
	const portEquipment = copyPortEquipmentState(portEquipmentInput);
	const organizationError = staticFabOrganizationStateError(map, portEquipment, organizations);
	if (organizationError) {
		throw new Error(`Static FAB organization overview source is invalid: ${organizationError}.`);
	}

	const physical = compilePhysicalRail(map, source.revision);
	if (!physical.valid) {
		const first = physical.diagnostics[0];
		throw new Error(
			`Static FAB organization overview rail source is invalid${
				first ? ` (${first.code} at ${first.cell.x},${first.cell.y}): ${first.message}` : "."
			}`,
		);
	}
	return deriveStaticFabOrganizationOverviewSnapshotFromValidatedSource(
		map,
		portEquipment,
		organizations,
		source,
		physical,
	);
}

/**
 * Worker-only fast path after the exact source has already passed project checks. The supplied
 * physical layout is revision-bound and shared with CHECKS so a 50k FAB is not compiled twice.
 */
export function deriveStaticFabOrganizationOverviewSnapshotFromValidatedSource(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	source: StaticFabOrganizationOverviewSourceIdentity,
	physical: CompiledPhysicalLayout,
	attachmentSourceIndex?: PortAttachmentSourceIndex,
): StaticFabOrganizationOverviewSnapshot {
	assertSourceIdentity(map, source);
	if (
		physical.revision !== source.revision ||
		!physical.valid ||
		compiledPhysicalLayoutHasDifferentSource(physical, map)
	) {
		throw new Error("Static FAB organization overview physical source is stale or invalid.");
	}
	const presentation = compilePortEquipmentPresentation(
		physical,
		portEquipment,
		attachmentSourceIndex,
	);
	if (map.getRevision() !== source.revision) {
		throw new Error("Static FAB source changed while its organization overview was being derived.");
	}

	const canonicalCells = collectCanonicalRailCells(map);
	const railSilhouette = createRailSilhouetteSnapshot(canonicalCells.xs, canonicalCells.zs);
	const edges = collectCanonicalRailEdges(map);
	const switches = collectAdvancedSwitchColumns(map);
	const ports = collectPortColumns(presentation, portEquipment);
	const equipment = collectEquipmentColumns(presentation, portEquipment);
	const needsMembershipIndex = organizations.records.length > 0;
	const entityIndex: OverviewEntityIndex = {
		edgeRowsByKey: needsMembershipIndex ? indexRailEdges(edges) : new Map(),
		switchRowsById: needsMembershipIndex ? indexIds(switches.ids) : new Map(),
		equipmentRowsById: needsMembershipIndex ? indexIds(equipment.ids) : new Map(),
		edges,
		switches,
		ports,
		equipment,
		presentation,
	};
	const organizationSummaries = compileOrganizationSummaries(organizations, entityIndex);

	const railBounds = boundsOfAllRailEdges(edges);
	const advancedSwitchBounds = boundsOfColumns(switches.bounds);
	const portBounds = boundsOfPoints(ports.worldPositions);
	const equipmentBounds =
		boundsOfColumns(equipment.bodySectionBounds) ?? boundsOfColumns(equipment.bounds);
	const bounds = unionFrozenBounds([railBounds, advancedSwitchBounds, portBounds, equipmentBounds]);
	const counts = freezeCounts({
		organizationCount: organizations.records.length,
		railEdgeCount: edges.fromXs.length,
		advancedSwitchCount: switches.ids.length,
		equipmentGroupCount: equipment.ids.length,
		portCount: ports.ids.length,
	});
	const boundsColumns = new Float64Array(OVERVIEW_BOUNDS_ROW_COUNT * 4);
	writeOptionalBounds(boundsColumns, 0, bounds);
	writeOptionalBounds(boundsColumns, 1, railBounds);
	writeOptionalBounds(boundsColumns, 2, advancedSwitchBounds);
	writeOptionalBounds(boundsColumns, 3, portBounds);
	writeOptionalBounds(boundsColumns, 4, equipmentBounds);
	const countColumns = new Uint32Array(OVERVIEW_COUNTS_WIDTH);
	writeCounts(countColumns, 0, counts);
	const advancedSwitchSnapshot = captureAdvancedSwitchSnapshot(switches);
	const portSnapshot = capturePortSnapshot(ports);
	const equipmentSnapshot = captureEquipmentSnapshot(equipment);
	const organizationSnapshot = captureOrganizationSnapshot(organizationSummaries);
	const fingerprint = staticFabOrganizationOverviewSnapshotFingerprint(
		source,
		boundsColumns,
		countColumns,
		railSilhouette,
		edges,
		advancedSwitchSnapshot,
		portSnapshot,
		equipmentSnapshot,
		organizationSnapshot,
	);

	return Object.freeze({
		kind: STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_KIND,
		version: STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_VERSION,
		fingerprint,
		sourceRevision: source.revision,
		sourceChecksum: source.checksum,
		sourceSequence: source.sequence,
		bounds: boundsColumns,
		counts: countColumns,
		railSilhouette,
		railEdges: edges,
		advancedSwitches: advancedSwitchSnapshot,
		ports: portSnapshot,
		equipment: equipmentSnapshot,
		organizations: organizationSnapshot,
	});
}

/**
 * Validate a Worker-delivered snapshot and rebuild the read-only facade over an owned copy. The
 * caller may release or mutate its delivered payload after this function returns without changing
 * the hydrated artifact.
 */
export function hydrateStaticFabOrganizationOverviewSnapshot(
	snapshot: unknown,
	expectedSource?: StaticFabOrganizationOverviewSourceIdentity,
): StaticFabOrganizationOverview {
	validateOverviewSnapshot(snapshot, expectedSource);
	const ownedSnapshot = copyStaticFabOrganizationOverviewSnapshot(snapshot);
	const edges = ownedSnapshot.railEdges;
	const switches = hydrateAdvancedSwitchColumns(ownedSnapshot.advancedSwitches);
	const ports = hydratePortColumns(ownedSnapshot.ports);
	const equipment = hydrateEquipmentColumns(ownedSnapshot.equipment);
	const organizations = hydrateOrganizationSummaries(ownedSnapshot.organizations);
	const counts = readCounts(ownedSnapshot.counts, 0);
	const artifact: StaticFabOrganizationOverview = Object.freeze({
		kind: STATIC_FAB_ORGANIZATION_OVERVIEW_KIND,
		version: STATIC_FAB_ORGANIZATION_OVERVIEW_VERSION,
		fingerprint: ownedSnapshot.fingerprint,
		sourceRevision: ownedSnapshot.sourceRevision,
		sourceChecksum: ownedSnapshot.sourceChecksum,
		sourceSequence: ownedSnapshot.sourceSequence,
		bounds: readOptionalBounds(ownedSnapshot.bounds, 0),
		railBounds: readOptionalBounds(ownedSnapshot.bounds, 1),
		advancedSwitchBounds: readOptionalBounds(ownedSnapshot.bounds, 2),
		portBounds: readOptionalBounds(ownedSnapshot.bounds, 3),
		equipmentBounds: readOptionalBounds(ownedSnapshot.bounds, 4),
		counts,
		railSilhouette: hydrateRailSilhouette(ownedSnapshot.railSilhouette),
		equipmentBodySectionCount: equipment.bodySectionGroupRows.length,
		organizations,
		readRailEdge: (index: number) => readRailEdge(edges, index),
		readAdvancedSwitch: (index: number) => readAdvancedSwitch(switches, index),
		readPort: (index: number) => readPort(ports, index),
		readEquipmentGroup: (index: number) => readEquipmentGroup(equipment, index),
		readEquipmentBodySection: (index: number) => readEquipmentBodySection(equipment, index),
	});
	overviewArtifacts.add(artifact);
	return artifact;
}

function copyStaticFabOrganizationOverviewSnapshot(
	snapshot: StaticFabOrganizationOverviewSnapshot,
): StaticFabOrganizationOverviewSnapshot {
	return Object.freeze({
		kind: snapshot.kind,
		version: snapshot.version,
		fingerprint: snapshot.fingerprint,
		sourceRevision: snapshot.sourceRevision,
		sourceChecksum: snapshot.sourceChecksum,
		sourceSequence: snapshot.sourceSequence,
		bounds: snapshot.bounds.slice(),
		counts: snapshot.counts.slice(),
		railSilhouette: Object.freeze({
			sourceCellCount: snapshot.railSilhouette.sourceCellCount,
			sampleStride: snapshot.railSilhouette.sampleStride,
			xs: snapshot.railSilhouette.xs.slice(),
			zs: snapshot.railSilhouette.zs.slice(),
		}),
		railEdges: Object.freeze({
			fromXs: snapshot.railEdges.fromXs.slice(),
			fromZs: snapshot.railEdges.fromZs.slice(),
			toXs: snapshot.railEdges.toXs.slice(),
			toZs: snapshot.railEdges.toZs.slice(),
		}),
		advancedSwitches: Object.freeze({
			ids: snapshot.advancedSwitches.ids.slice(),
			originXs: snapshot.advancedSwitches.originXs.slice(),
			originZs: snapshot.advancedSwitches.originZs.slice(),
			forwards: snapshot.advancedSwitches.forwards.slice(),
			laterals: snapshot.advancedSwitches.laterals.slice(),
			profileClasses: snapshot.advancedSwitches.profileClasses.slice(),
			bounds: snapshot.advancedSwitches.bounds.slice(),
		}),
		ports: Object.freeze({
			ids: snapshot.ports.ids.slice(),
			equipmentGroupIds: snapshot.ports.equipmentGroupIds.slice(),
			portTypes: snapshot.ports.portTypes.slice(),
			worldPositions: snapshot.ports.worldPositions.slice(),
		}),
		equipment: Object.freeze({
			ids: snapshot.equipment.ids.slice(),
			kinds: snapshot.equipment.kinds.slice(),
			portCounts: snapshot.equipment.portCounts.slice(),
			bodySectionOffsets: snapshot.equipment.bodySectionOffsets.slice(),
			bounds: snapshot.equipment.bounds.slice(),
			bodySectionGroupRows: snapshot.equipment.bodySectionGroupRows.slice(),
			bodySectionBounds: snapshot.equipment.bodySectionBounds.slice(),
		}),
		organizations: Object.freeze({
			ids: snapshot.organizations.ids.slice(),
			kinds: snapshot.organizations.kinds.slice(),
			names: Object.freeze([...snapshot.organizations.names]),
			descriptions: Object.freeze([...snapshot.organizations.descriptions]),
			colors: snapshot.organizations.colors.slice(),
			parentOffsets: snapshot.organizations.parentOffsets.slice(),
			parentIds: snapshot.organizations.parentIds.slice(),
			directBounds: snapshot.organizations.directBounds.slice(),
			directCounts: snapshot.organizations.directCounts.slice(),
			effectiveBounds: snapshot.organizations.effectiveBounds.slice(),
			effectiveCounts: snapshot.organizations.effectiveCounts.slice(),
		}),
	});
}

function captureAdvancedSwitchSnapshot(
	columns: AdvancedSwitchColumns,
): StaticFabOrganizationOverviewAdvancedSwitchSnapshot {
	return Object.freeze({
		ids: columns.ids,
		originXs: columns.originXs,
		originZs: columns.originZs,
		forwards: columns.forwards,
		laterals: columns.laterals,
		profileClasses: encodeStringEnums(
			columns.profileClasses,
			ADVANCED_SWITCH_PROFILE_CLASSES,
			"advanced-switch profile",
		),
		bounds: columns.bounds,
	});
}

function capturePortSnapshot(columns: PortColumns): StaticFabOrganizationOverviewPortSnapshot {
	return Object.freeze({
		ids: columns.ids,
		equipmentGroupIds: columns.equipmentGroupIds,
		portTypes: encodeStringEnums(columns.portTypes, PORT_TYPES, "port type"),
		worldPositions: columns.worldPositions,
	});
}

function captureEquipmentSnapshot(
	columns: EquipmentColumns,
): StaticFabOrganizationOverviewEquipmentSnapshot {
	return Object.freeze({
		ids: columns.ids,
		kinds: encodeStringEnums(columns.kinds, EQUIPMENT_GROUP_KINDS, "equipment kind"),
		portCounts: columns.portCounts,
		bodySectionOffsets: columns.bodySectionOffsets,
		bounds: columns.bounds,
		bodySectionGroupRows: columns.bodySectionGroupRows,
		bodySectionBounds: columns.bodySectionBounds,
	});
}

function captureOrganizationSnapshot(
	summaries: readonly StaticFabOrganizationOverviewOrganization[],
): StaticFabOrganizationOverviewOrganizationSnapshot {
	assertTypedArrayRows(summaries.length, "organization overview summaries");
	let parentCount = 0;
	for (const summary of summaries) {
		parentCount += summary.parentOrganizationIds.length;
		assertTypedArrayRows(parentCount, "organization overview parent IDs");
	}
	const ids = new Int32Array(summaries.length);
	const kinds = new Uint8Array(summaries.length);
	const names: string[] = [];
	const descriptions: string[] = [];
	const colors = new Uint8Array(summaries.length);
	const parentOffsets = new Uint32Array(summaries.length + 1);
	const parentIds = new Int32Array(parentCount);
	const directBounds = new Float64Array(summaries.length * 4);
	const directCounts = new Uint32Array(summaries.length * OVERVIEW_COUNTS_WIDTH);
	const effectiveBounds = new Float64Array(summaries.length * 4);
	const effectiveCounts = new Uint32Array(summaries.length * OVERVIEW_COUNTS_WIDTH);
	let parentOffset = 0;
	for (let row = 0; row < summaries.length; row++) {
		const summary = summaries[row] as StaticFabOrganizationOverviewOrganization;
		ids[row] = summary.id;
		kinds[row] = encodeStringEnum(summary.kind, STATIC_FAB_ORGANIZATION_KINDS, "organization kind");
		names.push(summary.name);
		descriptions.push(summary.description);
		colors[row] = encodeStringEnum(
			summary.color,
			STATIC_FAB_ORGANIZATION_COLORS,
			"organization color",
		);
		parentOffsets[row] = parentOffset;
		for (const parentId of summary.parentOrganizationIds) parentIds[parentOffset++] = parentId;
		writeOptionalBounds(directBounds, row, summary.direct.bounds);
		writeCounts(directCounts, row, summary.direct.counts);
		writeOptionalBounds(effectiveBounds, row, summary.effective.bounds);
		writeCounts(effectiveCounts, row, summary.effective.counts);
	}
	parentOffsets[summaries.length] = parentOffset;
	return Object.freeze({
		ids,
		kinds,
		names: Object.freeze(names),
		descriptions: Object.freeze(descriptions),
		colors,
		parentOffsets,
		parentIds,
		directBounds,
		directCounts,
		effectiveBounds,
		effectiveCounts,
	});
}

function hydrateAdvancedSwitchColumns(
	snapshot: StaticFabOrganizationOverviewAdvancedSwitchSnapshot,
): AdvancedSwitchColumns {
	return Object.freeze({
		ids: snapshot.ids,
		originXs: snapshot.originXs,
		originZs: snapshot.originZs,
		forwards: snapshot.forwards,
		laterals: snapshot.laterals,
		profileClasses: Object.freeze(
			decodeStringEnums(
				snapshot.profileClasses,
				ADVANCED_SWITCH_PROFILE_CLASSES,
				"advanced-switch profile",
			),
		),
		bounds: snapshot.bounds,
	});
}

function hydratePortColumns(snapshot: StaticFabOrganizationOverviewPortSnapshot): PortColumns {
	return Object.freeze({
		ids: snapshot.ids,
		equipmentGroupIds: snapshot.equipmentGroupIds,
		portTypes: Object.freeze(decodeStringEnums(snapshot.portTypes, PORT_TYPES, "port type")),
		worldPositions: snapshot.worldPositions,
	});
}

function hydrateEquipmentColumns(
	snapshot: StaticFabOrganizationOverviewEquipmentSnapshot,
): EquipmentColumns {
	return Object.freeze({
		ids: snapshot.ids,
		kinds: Object.freeze(
			decodeStringEnums(snapshot.kinds, EQUIPMENT_GROUP_KINDS, "equipment kind"),
		),
		portCounts: snapshot.portCounts,
		bodySectionOffsets: snapshot.bodySectionOffsets,
		bounds: snapshot.bounds,
		bodySectionGroupRows: snapshot.bodySectionGroupRows,
		bodySectionBounds: snapshot.bodySectionBounds,
	});
}

function hydrateOrganizationSummaries(
	snapshot: StaticFabOrganizationOverviewOrganizationSnapshot,
): readonly StaticFabOrganizationOverviewOrganization[] {
	return Object.freeze(
		Array.from({ length: snapshot.ids.length }, (_, row) => {
			const parentStart = snapshot.parentOffsets[row] as number;
			const parentEnd = snapshot.parentOffsets[row + 1] as number;
			return Object.freeze({
				id: snapshot.ids[row] as number,
				kind: STATIC_FAB_ORGANIZATION_KINDS[
					snapshot.kinds[row] as number
				] as StaticFabOrganizationKind,
				name: snapshot.names[row] as string,
				description: snapshot.descriptions[row] as string,
				color: STATIC_FAB_ORGANIZATION_COLORS[
					snapshot.colors[row] as number
				] as StaticFabOrganizationColor,
				parentOrganizationIds: Object.freeze(
					Array.from(snapshot.parentIds.subarray(parentStart, parentEnd)),
				),
				direct: Object.freeze({
					bounds: readOptionalBounds(snapshot.directBounds, row),
					counts: readCounts(snapshot.directCounts, row),
				}),
				effective: Object.freeze({
					bounds: readOptionalBounds(snapshot.effectiveBounds, row),
					counts: readCounts(snapshot.effectiveCounts, row),
				}),
			});
		}),
	);
}

function encodeStringEnums<Value extends string>(
	values: readonly Value[],
	allowed: readonly Value[],
	label: string,
): Uint8Array {
	return Uint8Array.from(values, (value) => encodeStringEnum(value, allowed, label));
}

function encodeStringEnum<Value extends string>(
	value: Value,
	allowed: readonly Value[],
	label: string,
): number {
	const code = allowed.indexOf(value);
	if (code < 0 || code > 0xff) throw new Error(`Unknown ${label} ${value}.`);
	return code;
}

function decodeStringEnums<Value extends string>(
	codes: Uint8Array,
	allowed: readonly Value[],
	label: string,
): Value[] {
	return Array.from(codes, (code) => {
		const value = allowed[code];
		if (value === undefined)
			throw new Error(`Static FAB overview ${label} code ${code} is invalid.`);
		return value;
	});
}

type OverviewFingerprintColumn = Int32Array | Uint8Array | Uint32Array | Float64Array;

/** Compact structural digest for one exact Worker payload. It is an integrity check, not a secret. */
class OverviewSnapshotFingerprintBuilder {
	private primary = 0x811c_9dc5;
	private secondary = 0x9e37_79b9;

	addText(label: string, value: string): void {
		this.mixText(label);
		this.mixText(value);
	}

	addColumn(label: string, value: OverviewFingerprintColumn): void {
		this.mixText(label);
		this.mixText(value.constructor.name);
		this.mixUint32(value.length);
		const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		for (let index = 0; index < bytes.length; index++) this.mixByte(bytes[index] as number);
	}

	addStrings(label: string, values: readonly string[]): void {
		this.mixText(label);
		this.mixUint32(values.length);
		for (const value of values) this.mixText(value);
	}

	finish(): string {
		return `sfo1-${this.primary.toString(16).padStart(8, "0")}${this.secondary
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

function staticFabOrganizationOverviewSnapshotFingerprint(
	source: StaticFabOrganizationOverviewSourceIdentity,
	bounds: Float64Array,
	counts: Uint32Array,
	railSilhouette: StaticFabOrganizationOverviewRailSilhouetteSnapshot,
	railEdges: StaticFabOrganizationOverviewRailEdgeSnapshot,
	advancedSwitches: StaticFabOrganizationOverviewAdvancedSwitchSnapshot,
	ports: StaticFabOrganizationOverviewPortSnapshot,
	equipment: StaticFabOrganizationOverviewEquipmentSnapshot,
	organizations: StaticFabOrganizationOverviewOrganizationSnapshot,
): string {
	const digest = new OverviewSnapshotFingerprintBuilder();
	digest.addText("kind", STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_KIND);
	digest.addText("version", `${STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_VERSION}`);
	digest.addText("source.revision", `${source.revision}`);
	digest.addText("source.checksum", source.checksum);
	digest.addText("source.sequence", `${source.sequence}`);
	digest.addColumn("bounds", bounds);
	digest.addColumn("counts", counts);
	digest.addText("railSilhouette.sourceCellCount", `${railSilhouette.sourceCellCount}`);
	digest.addText("railSilhouette.sampleStride", `${railSilhouette.sampleStride}`);
	digest.addColumn("railSilhouette.xs", railSilhouette.xs);
	digest.addColumn("railSilhouette.zs", railSilhouette.zs);
	digest.addColumn("railEdges.fromXs", railEdges.fromXs);
	digest.addColumn("railEdges.fromZs", railEdges.fromZs);
	digest.addColumn("railEdges.toXs", railEdges.toXs);
	digest.addColumn("railEdges.toZs", railEdges.toZs);
	digest.addColumn("advancedSwitches.ids", advancedSwitches.ids);
	digest.addColumn("advancedSwitches.originXs", advancedSwitches.originXs);
	digest.addColumn("advancedSwitches.originZs", advancedSwitches.originZs);
	digest.addColumn("advancedSwitches.forwards", advancedSwitches.forwards);
	digest.addColumn("advancedSwitches.laterals", advancedSwitches.laterals);
	digest.addColumn("advancedSwitches.profileClasses", advancedSwitches.profileClasses);
	digest.addColumn("advancedSwitches.bounds", advancedSwitches.bounds);
	digest.addColumn("ports.ids", ports.ids);
	digest.addColumn("ports.equipmentGroupIds", ports.equipmentGroupIds);
	digest.addColumn("ports.portTypes", ports.portTypes);
	digest.addColumn("ports.worldPositions", ports.worldPositions);
	digest.addColumn("equipment.ids", equipment.ids);
	digest.addColumn("equipment.kinds", equipment.kinds);
	digest.addColumn("equipment.portCounts", equipment.portCounts);
	digest.addColumn("equipment.bodySectionOffsets", equipment.bodySectionOffsets);
	digest.addColumn("equipment.bounds", equipment.bounds);
	digest.addColumn("equipment.bodySectionGroupRows", equipment.bodySectionGroupRows);
	digest.addColumn("equipment.bodySectionBounds", equipment.bodySectionBounds);
	digest.addColumn("organizations.ids", organizations.ids);
	digest.addColumn("organizations.kinds", organizations.kinds);
	digest.addStrings("organizations.names", organizations.names);
	digest.addStrings("organizations.descriptions", organizations.descriptions);
	digest.addColumn("organizations.colors", organizations.colors);
	digest.addColumn("organizations.parentOffsets", organizations.parentOffsets);
	digest.addColumn("organizations.parentIds", organizations.parentIds);
	digest.addColumn("organizations.directBounds", organizations.directBounds);
	digest.addColumn("organizations.directCounts", organizations.directCounts);
	digest.addColumn("organizations.effectiveBounds", organizations.effectiveBounds);
	digest.addColumn("organizations.effectiveCounts", organizations.effectiveCounts);
	return digest.finish();
}

function validateOverviewSnapshot(
	value: unknown,
	expectedSource?: StaticFabOrganizationOverviewSourceIdentity,
): asserts value is StaticFabOrganizationOverviewSnapshot {
	if (!isRecord(value)) throw new Error("Static FAB organization overview snapshot is malformed.");
	if (
		value.kind !== STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_KIND ||
		value.version !== STATIC_FAB_ORGANIZATION_OVERVIEW_SNAPSHOT_VERSION
	) {
		throw new Error("Static FAB organization overview snapshot kind or version is invalid.");
	}
	const source = {
		revision: value.sourceRevision,
		checksum: value.sourceChecksum,
		sequence: value.sourceSequence,
	};
	assertSourceIdentityValue(source);
	if (typeof value.fingerprint !== "string" || !/^sfo1-[0-9a-f]{16}$/.test(value.fingerprint)) {
		throw new Error("Static FAB organization overview snapshot fingerprint is invalid.");
	}
	if (expectedSource) {
		assertSourceIdentityValue(expectedSource);
		if (source.revision !== expectedSource.revision) {
			throw new Error(
				`Static FAB organization overview source revision ${source.revision} does not match expected ${expectedSource.revision}.`,
			);
		}
		if (source.checksum !== expectedSource.checksum) {
			throw new Error(
				"Static FAB organization overview source checksum does not match expected identity.",
			);
		}
		if (source.sequence !== expectedSource.sequence) {
			throw new Error(
				`Static FAB organization overview source sequence ${source.sequence} does not match expected ${expectedSource.sequence}.`,
			);
		}
	}

	assertFloat64Array(value.bounds, OVERVIEW_BOUNDS_ROW_COUNT * 4, "overview bounds");
	validateBoundsColumns(value.bounds, OVERVIEW_BOUNDS_ROW_COUNT, "overview bounds", true);
	assertUint32Array(value.counts, OVERVIEW_COUNTS_WIDTH, "overview counts");
	const counts = readCounts(value.counts, 0);

	if (!isRecord(value.railSilhouette)) {
		throw new Error("Static FAB organization overview rail silhouette is malformed.");
	}
	const silhouette = value.railSilhouette;
	assertNonNegativeSafeInteger(silhouette.sourceCellCount, "rail silhouette source count");
	assertNonNegativeSafeInteger(silhouette.sampleStride, "rail silhouette sample stride");
	assertInt32Array(silhouette.xs, undefined, "rail silhouette x columns");
	assertInt32Array(silhouette.zs, silhouette.xs.length, "rail silhouette z columns");
	const expectedStride =
		silhouette.sourceCellCount === 0
			? 0
			: Math.max(
					1,
					Math.ceil(
						silhouette.sourceCellCount / STATIC_FAB_ORGANIZATION_OVERVIEW_RAIL_SILHOUETTE_MAX_CELLS,
					),
				);
	const expectedSampleCount =
		expectedStride === 0 ? 0 : Math.ceil(silhouette.sourceCellCount / expectedStride);
	if (
		silhouette.sampleStride !== expectedStride ||
		silhouette.xs.length !== expectedSampleCount ||
		silhouette.xs.length > STATIC_FAB_ORGANIZATION_OVERVIEW_RAIL_SILHOUETTE_MAX_CELLS
	) {
		throw new Error("Static FAB organization overview rail silhouette sampling is malformed.");
	}

	if (!isRecord(value.railEdges)) {
		throw new Error("Static FAB organization overview rail-edge columns are malformed.");
	}
	assertInt32Array(value.railEdges.fromXs, counts.railEdgeCount, "rail-edge from x columns");
	assertInt32Array(value.railEdges.fromZs, counts.railEdgeCount, "rail-edge from z columns");
	assertInt32Array(value.railEdges.toXs, counts.railEdgeCount, "rail-edge to x columns");
	assertInt32Array(value.railEdges.toZs, counts.railEdgeCount, "rail-edge to z columns");

	if (!isRecord(value.advancedSwitches)) {
		throw new Error("Static FAB organization overview switch columns are malformed.");
	}
	const switches = value.advancedSwitches;
	assertInt32Array(switches.ids, counts.advancedSwitchCount, "switch IDs");
	assertPositiveUniqueIds(switches.ids, "switch IDs");
	assertInt32Array(switches.originXs, counts.advancedSwitchCount, "switch origin x columns");
	assertInt32Array(switches.originZs, counts.advancedSwitchCount, "switch origin z columns");
	assertUint8Array(switches.forwards, counts.advancedSwitchCount, "switch forward columns");
	assertUint8Array(switches.laterals, counts.advancedSwitchCount, "switch lateral columns");
	assertUint8Array(switches.profileClasses, counts.advancedSwitchCount, "switch profile columns");
	for (let row = 0; row < counts.advancedSwitchCount; row++) {
		if (!ALL_DIRECTIONS.includes(switches.forwards[row] as Direction)) {
			throw new Error(`Static FAB organization overview switch forward row ${row} is invalid.`);
		}
		if (!ALL_DIRECTIONS.includes(switches.laterals[row] as Direction)) {
			throw new Error(`Static FAB organization overview switch lateral row ${row} is invalid.`);
		}
		if ((switches.profileClasses[row] as number) >= ADVANCED_SWITCH_PROFILE_CLASSES.length) {
			throw new Error(`Static FAB organization overview switch profile row ${row} is invalid.`);
		}
	}
	assertFloat64Array(switches.bounds, counts.advancedSwitchCount * 4, "switch bounds");
	validateBoundsColumns(switches.bounds, counts.advancedSwitchCount, "switch bounds", false);

	if (!isRecord(value.ports)) {
		throw new Error("Static FAB organization overview port columns are malformed.");
	}
	const ports = value.ports;
	assertInt32Array(ports.ids, counts.portCount, "port IDs");
	assertPositiveUniqueIds(ports.ids, "port IDs");
	assertInt32Array(ports.equipmentGroupIds, counts.portCount, "port equipment IDs");
	assertUint8Array(ports.portTypes, counts.portCount, "port type columns");
	for (let row = 0; row < ports.portTypes.length; row++) {
		if ((ports.portTypes[row] as number) >= PORT_TYPES.length) {
			throw new Error(`Static FAB organization overview port type row ${row} is invalid.`);
		}
	}
	assertFloat64Array(ports.worldPositions, counts.portCount * 2, "port positions");
	assertFiniteColumns(ports.worldPositions, "port positions");

	if (!isRecord(value.equipment)) {
		throw new Error("Static FAB organization overview equipment columns are malformed.");
	}
	const equipment = value.equipment;
	assertInt32Array(equipment.ids, counts.equipmentGroupCount, "equipment IDs");
	assertPositiveUniqueIds(equipment.ids, "equipment IDs");
	assertUint8Array(equipment.kinds, counts.equipmentGroupCount, "equipment kind columns");
	for (let row = 0; row < equipment.kinds.length; row++) {
		if ((equipment.kinds[row] as number) >= EQUIPMENT_GROUP_KINDS.length) {
			throw new Error(`Static FAB organization overview equipment kind row ${row} is invalid.`);
		}
	}
	assertUint32Array(equipment.portCounts, counts.equipmentGroupCount, "equipment port counts");
	assertUint32Array(
		equipment.bodySectionOffsets,
		counts.equipmentGroupCount + 1,
		"equipment body offsets",
	);
	assertUint32Array(equipment.bodySectionGroupRows, undefined, "equipment body group rows");
	assertMonotonicOffsets(
		equipment.bodySectionOffsets,
		equipment.bodySectionGroupRows,
		"equipment body offsets",
	);
	assertFloat64Array(equipment.bounds, counts.equipmentGroupCount * 4, "equipment bounds");
	validateBoundsColumns(equipment.bounds, counts.equipmentGroupCount, "equipment bounds", false);
	for (let row = 0; row < equipment.bodySectionGroupRows.length; row++) {
		if ((equipment.bodySectionGroupRows[row] as number) >= counts.equipmentGroupCount) {
			throw new Error(`Static FAB organization overview equipment body row ${row} is invalid.`);
		}
	}
	assertFloat64Array(
		equipment.bodySectionBounds,
		equipment.bodySectionGroupRows.length * 4,
		"equipment body bounds",
	);
	validateBoundsColumns(
		equipment.bodySectionBounds,
		equipment.bodySectionGroupRows.length,
		"equipment body bounds",
		false,
	);

	validateOrganizationSnapshot(value.organizations, counts);
	const validatedSnapshot = value as unknown as StaticFabOrganizationOverviewSnapshot;
	const expectedFingerprint = staticFabOrganizationOverviewSnapshotFingerprint(
		source,
		validatedSnapshot.bounds,
		validatedSnapshot.counts,
		validatedSnapshot.railSilhouette,
		validatedSnapshot.railEdges,
		validatedSnapshot.advancedSwitches,
		validatedSnapshot.ports,
		validatedSnapshot.equipment,
		validatedSnapshot.organizations,
	);
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error("Static FAB organization overview snapshot fingerprint is invalid.");
	}
}

function validateOrganizationSnapshot(
	value: unknown,
	globalCounts: StaticFabOrganizationOverviewCounts,
): asserts value is StaticFabOrganizationOverviewOrganizationSnapshot {
	if (!isRecord(value)) {
		throw new Error("Static FAB organization overview organization columns are malformed.");
	}
	const count = globalCounts.organizationCount;
	assertInt32Array(value.ids, count, "organization IDs");
	assertPositiveUniqueIds(value.ids, "organization IDs");
	assertUint8Array(value.kinds, count, "organization kind columns");
	assertStringArray(value.names, count, "organization names", true);
	assertStringArray(value.descriptions, count, "organization descriptions", false);
	assertUint8Array(value.colors, count, "organization color columns");
	for (let row = 0; row < count; row++) {
		if ((value.kinds[row] as number) >= STATIC_FAB_ORGANIZATION_KINDS.length) {
			throw new Error(`Static FAB organization overview kind row ${row} is invalid.`);
		}
		if ((value.colors[row] as number) >= STATIC_FAB_ORGANIZATION_COLORS.length) {
			throw new Error(`Static FAB organization overview color row ${row} is invalid.`);
		}
	}
	assertUint32Array(value.parentOffsets, count + 1, "organization parent offsets");
	assertInt32Array(value.parentIds, undefined, "organization parent IDs");
	assertMonotonicOffsets(value.parentOffsets, value.parentIds, "organization parent offsets");
	const organizationIds = new Set(value.ids);
	for (let row = 0; row < value.parentIds.length; row++) {
		if (!organizationIds.has(value.parentIds[row] as number)) {
			throw new Error(`Static FAB organization overview parent row ${row} is missing.`);
		}
	}
	assertFloat64Array(value.directBounds, count * 4, "organization direct bounds");
	validateBoundsColumns(value.directBounds, count, "organization direct bounds", true);
	assertUint32Array(
		value.directCounts,
		count * OVERVIEW_COUNTS_WIDTH,
		"organization direct counts",
	);
	assertFloat64Array(value.effectiveBounds, count * 4, "organization effective bounds");
	validateBoundsColumns(value.effectiveBounds, count, "organization effective bounds", true);
	assertUint32Array(
		value.effectiveCounts,
		count * OVERVIEW_COUNTS_WIDTH,
		"organization effective counts",
	);
	for (let row = 0; row < count; row++) {
		assertCoverageCounts(readCounts(value.directCounts, row), globalCounts, row, "direct");
		assertCoverageCounts(readCounts(value.effectiveCounts, row), globalCounts, row, "effective");
	}
}

function assertCoverageCounts(
	counts: StaticFabOrganizationOverviewCounts,
	globalCounts: StaticFabOrganizationOverviewCounts,
	row: number,
	label: string,
): void {
	for (const key of [
		"organizationCount",
		"railEdgeCount",
		"advancedSwitchCount",
		"equipmentGroupCount",
		"portCount",
	] as const) {
		if (counts[key] > globalCounts[key]) {
			throw new Error(`Static FAB organization overview ${label} count row ${row} is invalid.`);
		}
	}
}

function assertSourceIdentity(
	map: TileMap,
	source: StaticFabOrganizationOverviewSourceIdentity,
): void {
	assertSourceIdentityValue(source);
	if (source.revision !== map.getRevision()) {
		throw new Error(
			`Static FAB organization overview revision ${source.revision} does not match map revision ${map.getRevision()}.`,
		);
	}
}

function assertSourceIdentityValue(
	source: unknown,
): asserts source is StaticFabOrganizationOverviewSourceIdentity {
	if (
		!isRecord(source) ||
		!Number.isSafeInteger(source.revision) ||
		(source.revision as number) < 0
	) {
		throw new Error(
			"Static FAB organization overview revision must be a non-negative safe integer.",
		);
	}
	if (!Number.isSafeInteger(source.sequence) || (source.sequence as number) < 0) {
		throw new Error(
			"Static FAB organization overview sequence must be a non-negative safe integer.",
		);
	}
	if (
		typeof source.checksum !== "string" ||
		source.checksum.length === 0 ||
		source.checksum !== source.checksum.trim()
	) {
		throw new Error(
			"Static FAB organization overview checksum must be a non-empty trimmed string.",
		);
	}
}

function assertInt32Array(
	value: unknown,
	length: number | undefined,
	label: string,
): asserts value is Int32Array {
	if (
		!isTransferableTypedArray(value, Int32Array) ||
		(length !== undefined && value.length !== length)
	) {
		throw new Error(`Static FAB organization overview ${label} are malformed.`);
	}
}

function assertUint8Array(
	value: unknown,
	length: number,
	label: string,
): asserts value is Uint8Array {
	if (!isTransferableTypedArray(value, Uint8Array) || value.length !== length) {
		throw new Error(`Static FAB organization overview ${label} are malformed.`);
	}
}

function assertUint32Array(
	value: unknown,
	length: number | undefined,
	label: string,
): asserts value is Uint32Array {
	if (
		!isTransferableTypedArray(value, Uint32Array) ||
		(length !== undefined && value.length !== length)
	) {
		throw new Error(`Static FAB organization overview ${label} are malformed.`);
	}
}

function assertFloat64Array(
	value: unknown,
	length: number,
	label: string,
): asserts value is Float64Array {
	if (!isTransferableTypedArray(value, Float64Array) || value.length !== length) {
		throw new Error(`Static FAB organization overview ${label} are malformed.`);
	}
}

function assertStringArray(
	value: unknown,
	length: number,
	label: string,
	requirePortableName: boolean,
): asserts value is string[] {
	if (!Array.isArray(value) || value.length !== length) {
		throw new Error(`Static FAB organization overview ${label} are malformed.`);
	}
	for (let row = 0; row < value.length; row++) {
		const text = value[row];
		if (
			typeof text !== "string" ||
			(requirePortableName && (text.length === 0 || text !== text.trim()))
		) {
			throw new Error(`Static FAB organization overview ${label} row ${row} is invalid.`);
		}
	}
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(`Static FAB organization overview ${label} is invalid.`);
	}
}

function assertFiniteColumns(columns: Float64Array, label: string): void {
	for (let index = 0; index < columns.length; index++) {
		if (!Number.isFinite(columns[index])) {
			throw new Error(`Static FAB organization overview ${label} row ${index} is non-finite.`);
		}
	}
}

function assertPositiveUniqueIds(ids: Int32Array, label: string): void {
	const seen = new Set<number>();
	for (let row = 0; row < ids.length; row++) {
		const id = ids[row] as number;
		if (id <= 0 || seen.has(id)) {
			throw new Error(`Static FAB organization overview ${label} row ${row} is invalid.`);
		}
		seen.add(id);
	}
}

function assertMonotonicOffsets(
	offsets: Uint32Array,
	values: ArrayLike<unknown>,
	label: string,
): void {
	if ((offsets[0] as number) !== 0 || (offsets[offsets.length - 1] as number) !== values.length) {
		throw new Error(`Static FAB organization overview ${label} boundary is malformed.`);
	}
	for (let row = 1; row < offsets.length; row++) {
		if ((offsets[row] as number) < (offsets[row - 1] as number)) {
			throw new Error(`Static FAB organization overview ${label} are not monotonic.`);
		}
	}
}

function validateBoundsColumns(
	columns: Float64Array,
	rowCount: number,
	label: string,
	allowNull: boolean,
): void {
	for (let row = 0; row < rowCount; row++) {
		const offset = row * 4;
		const values = [
			columns[offset] as number,
			columns[offset + 1] as number,
			columns[offset + 2] as number,
			columns[offset + 3] as number,
		];
		const nullRow = values.every(Number.isNaN);
		if (nullRow && allowNull) continue;
		if (
			values.some((entry) => !Number.isFinite(entry)) ||
			(values[0] as number) > (values[2] as number) ||
			(values[1] as number) > (values[3] as number)
		) {
			throw new Error(`Static FAB organization overview ${label} row ${row} is invalid.`);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function collectCanonicalRailCells(map: TileMap): Readonly<{ xs: Int32Array; zs: Int32Array }> {
	assertTypedArrayRows(map.size, "rail silhouette source cells");
	const xs = new Int32Array(map.size);
	const zs = new Int32Array(map.size);
	let row = 0;
	map.forEachRail((x, z) => {
		assertInt32(x, "rail x");
		assertInt32(z, "rail z");
		xs[row] = x;
		zs[row] = z;
		row++;
	});
	if (row !== map.size) throw new Error("Rail silhouette source cell count diverged from TileMap.");
	return sortCoordinateColumns(xs, zs);
}

function collectCanonicalRailEdges(map: TileMap): RailEdgeColumns {
	assertTypedArrayRows(map.edgeCount, "rail edges");
	const fromXs = new Int32Array(map.edgeCount);
	const fromZs = new Int32Array(map.edgeCount);
	const toXs = new Int32Array(map.edgeCount);
	const toZs = new Int32Array(map.edgeCount);
	let row = 0;
	map.forEachRail((x, z, rail) => {
		for (const direction of ALL_DIRECTIONS) {
			if ((rail.outgoing & direction) === 0) continue;
			if (row >= map.edgeCount)
				throw new Error("TileMap edge count is smaller than authored rail.");
			const target = moveCell({ x, y: z }, direction);
			assertInt32(target.x, "rail edge target x");
			assertInt32(target.y, "rail edge target z");
			fromXs[row] = x;
			fromZs[row] = z;
			toXs[row] = target.x;
			toZs[row] = target.y;
			row++;
		}
	});
	if (row !== map.edgeCount) throw new Error("TileMap edge count diverged from authored rail.");
	const order = sortedRowOrder(map.edgeCount, (left, right) =>
		compareEdgeRows(fromXs, fromZs, toXs, toZs, left, right),
	);
	return Object.freeze({
		fromXs: reorderInt32(fromXs, order),
		fromZs: reorderInt32(fromZs, order),
		toXs: reorderInt32(toXs, order),
		toZs: reorderInt32(toZs, order),
	});
}

function collectAdvancedSwitchColumns(map: TileMap): AdvancedSwitchColumns {
	assertTypedArrayRows(map.advancedSwitchCount, "advanced switches");
	const ids = new Int32Array(map.advancedSwitchCount);
	const originXs = new Int32Array(map.advancedSwitchCount);
	const originZs = new Int32Array(map.advancedSwitchCount);
	const forwards = new Uint8Array(map.advancedSwitchCount);
	const laterals = new Uint8Array(map.advancedSwitchCount);
	const profileClasses: AdvancedSwitchProfileClass[] = [];
	const bounds = new Float64Array(map.advancedSwitchCount * 4);
	let row = 0;
	map.forEachAdvancedSwitch((record) => {
		ids[row] = record.id;
		originXs[row] = record.origin.x;
		originZs[row] = record.origin.y;
		forwards[row] = record.forward;
		laterals[row] = record.lateral;
		profileClasses.push(record.profileClass);
		writeBounds(bounds, row, advancedSwitchWorldBounds(record));
		row++;
	});
	if (row !== map.advancedSwitchCount) {
		throw new Error("Advanced-switch count diverged from TileMap.");
	}
	return Object.freeze({
		ids,
		originXs,
		originZs,
		forwards,
		laterals,
		profileClasses: Object.freeze(profileClasses),
		bounds,
	});
}

function collectPortColumns(
	presentation: CompiledPortEquipmentPresentation,
	state: PortEquipmentState,
): PortColumns {
	const ids = Int32Array.from(presentation.portIds);
	const equipmentGroupIds = Int32Array.from(presentation.equipmentGroupIds);
	const worldPositions = new Float64Array(presentation.worldPositions.length);
	worldPositions.set(presentation.worldPositions);
	const portTypes = state.ports.map((port) => port.portType);
	if (portTypes.length !== ids.length)
		throw new Error("Port presentation count diverged from source.");
	return Object.freeze({
		ids,
		equipmentGroupIds,
		portTypes: Object.freeze(portTypes),
		worldPositions,
	});
}

function collectEquipmentColumns(
	presentation: CompiledPortEquipmentPresentation,
	state: PortEquipmentState,
): EquipmentColumns {
	const ids = Int32Array.from(presentation.groupIds);
	const kinds = state.equipmentGroups.map((group) => group.kind);
	const portCounts = Uint32Array.from(state.equipmentGroups, (group) => group.portIds.length);
	const bodySectionOffsets = Uint32Array.from(presentation.groupBodySectionOffsets);
	const bounds = new Float64Array(presentation.groupBounds.length);
	bounds.set(presentation.groupBounds);
	const bodySectionGroupRows = Uint32Array.from(presentation.bodySectionGroupRows);
	const bodySectionBounds = new Float64Array(presentation.bodySectionBounds.length);
	bodySectionBounds.set(presentation.bodySectionBounds);
	if (kinds.length !== ids.length || bodySectionOffsets.length !== ids.length + 1) {
		throw new Error("Equipment presentation count diverged from source.");
	}
	return Object.freeze({
		ids,
		kinds: Object.freeze(kinds),
		portCounts,
		bodySectionOffsets,
		bounds,
		bodySectionGroupRows,
		bodySectionBounds,
	});
}

function compileOrganizationSummaries(
	state: StaticFabOrganizationState,
	entities: OverviewEntityIndex,
): readonly StaticFabOrganizationOverviewOrganization[] {
	const records = state.records;
	if (records.length === 0) return Object.freeze([]);
	assertTypedArrayRows(records.length, "organizations");
	const rowById = new Map(records.map((record, row) => [record.id, row] as const));
	const childrenByRow = Array.from({ length: records.length }, () => [] as number[]);
	for (let childRow = 0; childRow < records.length; childRow++) {
		const record = records[childRow];
		if (!record) throw new Error(`Missing organization row ${childRow}.`);
		for (const parentId of staticFabOrganizationParentIds(record)) {
			const parentRow = rowById.get(parentId);
			if (parentRow === undefined) {
				throw new Error(`Organization ${record.id} references missing parent ${parentId}.`);
			}
			childrenByRow[parentRow]?.push(childRow);
		}
	}

	const organizationStamps = new Uint32Array(records.length);
	const edgeStamps = new Uint32Array(entities.edges.fromXs.length);
	const switchStamps = new Uint32Array(entities.switches.ids.length);
	const equipmentStamps = new Uint32Array(entities.equipment.ids.length);
	const pending: number[] = [];
	let generation = 0;
	const coverage = (rootRow: number, includeDescendants: boolean) => {
		generation++;
		if (generation >= 0xffff_ffff) {
			organizationStamps.fill(0);
			edgeStamps.fill(0);
			switchStamps.fill(0);
			equipmentStamps.fill(0);
			generation = 1;
		}
		pending.length = 0;
		pending.push(rootRow);
		const mutable = emptyMutableBounds();
		let organizationCount = 0;
		let railEdgeCount = 0;
		let advancedSwitchCount = 0;
		let equipmentGroupCount = 0;
		let portCount = 0;
		for (let offset = 0; offset < pending.length; offset++) {
			const row = pending[offset] as number;
			if ((organizationStamps[row] as number) === generation) continue;
			organizationStamps[row] = generation;
			organizationCount++;
			const record = records[row];
			if (!record) throw new Error(`Missing organization coverage row ${row}.`);
			for (const edge of record.membership.railEdges) {
				const edgeRow = entities.edgeRowsByKey.get(staticFabOrganizationEdgeKey(edge));
				if (edgeRow === undefined)
					throw new Error(`Missing organization rail edge for ${record.id}.`);
				if ((edgeStamps[edgeRow] as number) === generation) continue;
				edgeStamps[edgeRow] = generation;
				railEdgeCount++;
				includeRailEdgeBounds(mutable, entities.edges, edgeRow);
			}
			for (const switchId of record.membership.advancedSwitchIds) {
				const switchRow = entities.switchRowsById.get(switchId);
				if (switchRow === undefined) throw new Error(`Missing organization switch ${switchId}.`);
				if ((switchStamps[switchRow] as number) === generation) continue;
				switchStamps[switchRow] = generation;
				advancedSwitchCount++;
				includeBoundsRow(mutable, entities.switches.bounds, switchRow);
			}
			for (const groupId of record.membership.equipmentGroupIds) {
				const groupRow = entities.equipmentRowsById.get(groupId);
				if (groupRow === undefined) throw new Error(`Missing organization equipment ${groupId}.`);
				if ((equipmentStamps[groupRow] as number) === generation) continue;
				equipmentStamps[groupRow] = generation;
				equipmentGroupCount++;
				portCount += entities.equipment.portCounts[groupRow] as number;
				includeEquipmentGroupExtents(mutable, entities, groupRow);
			}
			if (includeDescendants) pending.push(...(childrenByRow[row] ?? []));
		}
		return freezeCoverage(mutable, {
			organizationCount,
			railEdgeCount,
			advancedSwitchCount,
			equipmentGroupCount,
			portCount,
		});
	};

	return Object.freeze(
		records.map((record, row) => {
			const properties = staticFabOrganizationProperties(record);
			return Object.freeze({
				id: record.id,
				kind: record.kind,
				name: record.name,
				description: properties.description,
				color: properties.color,
				parentOrganizationIds: Object.freeze([...staticFabOrganizationParentIds(record)]),
				direct: coverage(row, false),
				effective: coverage(row, true),
			});
		}),
	);
}

function includeEquipmentGroupExtents(
	target: MutableBounds,
	entities: OverviewEntityIndex,
	groupRow: number,
): void {
	const sectionStart = entities.equipment.bodySectionOffsets[groupRow] as number;
	const sectionEnd = entities.equipment.bodySectionOffsets[groupRow + 1] as number;
	if (sectionStart === sectionEnd) includeBoundsRow(target, entities.equipment.bounds, groupRow);
	else {
		for (let sectionRow = sectionStart; sectionRow < sectionEnd; sectionRow++) {
			includeBoundsRow(target, entities.equipment.bodySectionBounds, sectionRow);
		}
	}
	const portStart = entities.presentation.groupPortOffsets[groupRow] as number;
	const portEnd = entities.presentation.groupPortOffsets[groupRow + 1] as number;
	for (let offset = portStart; offset < portEnd; offset++) {
		const portRow = entities.presentation.groupPortRows[offset] as number;
		includePoint(
			target,
			entities.ports.worldPositions[portRow * 2] as number,
			entities.ports.worldPositions[portRow * 2 + 1] as number,
		);
	}
}

function createRailSilhouetteSnapshot(
	canonicalXs: Int32Array,
	canonicalZs: Int32Array,
): StaticFabOrganizationOverviewRailSilhouetteSnapshot {
	const sourceCellCount = canonicalXs.length;
	const sampleStride =
		sourceCellCount === 0
			? 0
			: Math.max(
					1,
					Math.ceil(sourceCellCount / STATIC_FAB_ORGANIZATION_OVERVIEW_RAIL_SILHOUETTE_MAX_CELLS),
				);
	const sampleCount = sampleStride === 0 ? 0 : Math.ceil(sourceCellCount / sampleStride);
	const xs = new Int32Array(sampleCount);
	const zs = new Int32Array(sampleCount);
	for (let index = 0; index < sampleCount; index++) {
		const sourceIndex =
			index === sampleCount - 1
				? sourceCellCount - 1
				: Math.min(index * sampleStride, sourceCellCount - 1);
		xs[index] = canonicalXs[sourceIndex] as number;
		zs[index] = canonicalZs[sourceIndex] as number;
	}
	return Object.freeze({
		sourceCellCount,
		sampleStride,
		xs,
		zs,
	});
}

function hydrateRailSilhouette(
	snapshot: StaticFabOrganizationOverviewRailSilhouetteSnapshot,
): StaticFabOrganizationOverviewRailSilhouette {
	const { xs, zs, sourceCellCount, sampleStride } = snapshot;
	const sampleCount = xs.length;
	const readX = (index: number): number => {
		assertRow(index, sampleCount, "rail silhouette cell");
		return xs[index] as number;
	};
	const readZ = (index: number): number => {
		assertRow(index, sampleCount, "rail silhouette cell");
		return zs[index] as number;
	};
	return Object.freeze({
		sourceCellCount,
		sampleCount,
		sampleCap: STATIC_FAB_ORGANIZATION_OVERVIEW_RAIL_SILHOUETTE_MAX_CELLS,
		sampleStride,
		readX,
		readZ,
		readCell: (index: number) => Object.freeze({ index, x: readX(index), z: readZ(index) }),
		forEachCell: (visit: (x: number, z: number, index: number) => void) => {
			for (let index = 0; index < sampleCount; index++) {
				visit(xs[index] as number, zs[index] as number, index);
			}
		},
		copyXs: () => xs.slice(),
		copyZs: () => zs.slice(),
	});
}

function readRailEdge(
	columns: RailEdgeColumns,
	index: number,
): StaticFabOrganizationOverviewRailEdge {
	assertRow(index, columns.fromXs.length, "rail edge");
	const fromX = columns.fromXs[index] as number;
	const fromZ = columns.fromZs[index] as number;
	const toX = columns.toXs[index] as number;
	const toZ = columns.toZs[index] as number;
	return Object.freeze({
		index,
		fromX,
		fromZ,
		toX,
		toZ,
		bounds: railEdgeWorldBounds(fromX, fromZ, toX, toZ),
	});
}

function readAdvancedSwitch(
	columns: AdvancedSwitchColumns,
	index: number,
): StaticFabOrganizationOverviewAdvancedSwitch {
	assertRow(index, columns.ids.length, "advanced switch");
	return Object.freeze({
		index,
		id: columns.ids[index] as number,
		profileClass: columns.profileClasses[index] as AdvancedSwitchProfileClass,
		originX: columns.originXs[index] as number,
		originZ: columns.originZs[index] as number,
		forward: columns.forwards[index] as Direction,
		lateral: columns.laterals[index] as Direction,
		bounds: readBounds(columns.bounds, index),
	});
}

function readPort(columns: PortColumns, index: number): StaticFabOrganizationOverviewPort {
	assertRow(index, columns.ids.length, "port");
	const worldX = columns.worldPositions[index * 2] as number;
	const worldZ = columns.worldPositions[index * 2 + 1] as number;
	return Object.freeze({
		index,
		id: columns.ids[index] as number,
		equipmentGroupId: columns.equipmentGroupIds[index] as number,
		portType: columns.portTypes[index] as PortType,
		worldX,
		worldZ,
		bounds: freezeBounds({ minX: worldX, minZ: worldZ, maxX: worldX, maxZ: worldZ }),
	});
}

function readEquipmentGroup(
	columns: EquipmentColumns,
	index: number,
): StaticFabOrganizationOverviewEquipmentGroup {
	assertRow(index, columns.ids.length, "equipment group");
	const bodySectionOffset = columns.bodySectionOffsets[index] as number;
	const bodySectionEnd = columns.bodySectionOffsets[index + 1] as number;
	return Object.freeze({
		index,
		id: columns.ids[index] as number,
		kind: columns.kinds[index] as EquipmentGroupKind,
		portCount: columns.portCounts[index] as number,
		bodySectionOffset,
		bodySectionCount: bodySectionEnd - bodySectionOffset,
		bounds: readBounds(columns.bounds, index),
	});
}

function readEquipmentBodySection(
	columns: EquipmentColumns,
	index: number,
): StaticFabOrganizationOverviewEquipmentBodySection {
	assertRow(index, columns.bodySectionGroupRows.length, "equipment body section");
	return Object.freeze({
		index,
		equipmentGroupIndex: columns.bodySectionGroupRows[index] as number,
		bounds: readBounds(columns.bodySectionBounds, index),
	});
}

function indexRailEdges(columns: RailEdgeColumns): ReadonlyMap<string, number> {
	const result = new Map<string, number>();
	for (let row = 0; row < columns.fromXs.length; row++) {
		result.set(
			`${columns.fromXs[row]}:${columns.fromZs[row]}>${columns.toXs[row]}:${columns.toZs[row]}`,
			row,
		);
	}
	return result;
}

function indexIds(ids: Int32Array): ReadonlyMap<number, number> {
	const result = new Map<number, number>();
	for (let row = 0; row < ids.length; row++) result.set(ids[row] as number, row);
	return result;
}

function advancedSwitchWorldBounds(
	record: AdvancedSwitchRecord,
): StaticFabOrganizationOverviewBounds {
	const mutable = emptyMutableBounds();
	for (const cell of deriveAdvancedSwitchGeometry(record).claimedCells)
		includeCell(mutable, cell.x, cell.y);
	return freezeRequiredBounds(mutable, `advanced switch ${record.id}`);
}

function boundsOfAllRailEdges(
	columns: RailEdgeColumns,
): StaticFabOrganizationOverviewBounds | null {
	const mutable = emptyMutableBounds();
	for (let row = 0; row < columns.fromXs.length; row++)
		includeRailEdgeBounds(mutable, columns, row);
	return freezeOptionalBounds(mutable);
}

function boundsOfColumns(columns: Float64Array): StaticFabOrganizationOverviewBounds | null {
	if (columns.length % 4 !== 0) throw new Error("Overview bounds columns are malformed.");
	const mutable = emptyMutableBounds();
	for (let row = 0; row < columns.length / 4; row++) includeBoundsRow(mutable, columns, row);
	return freezeOptionalBounds(mutable);
}

function boundsOfPoints(columns: Float64Array): StaticFabOrganizationOverviewBounds | null {
	if (columns.length % 2 !== 0) throw new Error("Overview point columns are malformed.");
	const mutable = emptyMutableBounds();
	for (let row = 0; row < columns.length / 2; row++) {
		includePoint(mutable, columns[row * 2] as number, columns[row * 2 + 1] as number);
	}
	return freezeOptionalBounds(mutable);
}

function railEdgeWorldBounds(
	fromX: number,
	fromZ: number,
	toX: number,
	toZ: number,
): StaticFabOrganizationOverviewBounds {
	return freezeBounds({
		minX: Math.min(fromX, toX),
		minZ: Math.min(fromZ, toZ),
		maxX: Math.max(fromX, toX) + 1,
		maxZ: Math.max(fromZ, toZ) + 1,
	});
}

function includeRailEdgeBounds(target: MutableBounds, columns: RailEdgeColumns, row: number): void {
	includeBounds(
		target,
		railEdgeWorldBounds(
			columns.fromXs[row] as number,
			columns.fromZs[row] as number,
			columns.toXs[row] as number,
			columns.toZs[row] as number,
		),
	);
}

function includeCell(target: MutableBounds, x: number, z: number): void {
	includeBounds(target, { minX: x, minZ: z, maxX: x + 1, maxZ: z + 1 });
}

function includePoint(target: MutableBounds, x: number, z: number): void {
	includeBounds(target, { minX: x, minZ: z, maxX: x, maxZ: z });
}

function includeBoundsRow(target: MutableBounds, columns: Float64Array, row: number): void {
	const offset = row * 4;
	includeBounds(target, {
		minX: columns[offset] as number,
		minZ: columns[offset + 1] as number,
		maxX: columns[offset + 2] as number,
		maxZ: columns[offset + 3] as number,
	});
}

function includeBounds(target: MutableBounds, bounds: StaticFabOrganizationOverviewBounds): void {
	if (![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(Number.isFinite)) {
		throw new Error("Static FAB overview encountered non-finite world bounds.");
	}
	target.minX = Math.min(target.minX, bounds.minX);
	target.minZ = Math.min(target.minZ, bounds.minZ);
	target.maxX = Math.max(target.maxX, bounds.maxX);
	target.maxZ = Math.max(target.maxZ, bounds.maxZ);
}

function emptyMutableBounds(): MutableBounds {
	return {
		minX: Number.POSITIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		maxZ: Number.NEGATIVE_INFINITY,
	};
}

function freezeCoverage(
	bounds: MutableBounds,
	counts: StaticFabOrganizationOverviewCounts,
): StaticFabOrganizationOverviewCoverage {
	return Object.freeze({ bounds: freezeOptionalBounds(bounds), counts: freezeCounts(counts) });
}

function freezeCounts(
	counts: StaticFabOrganizationOverviewCounts,
): StaticFabOrganizationOverviewCounts {
	return Object.freeze({ ...counts });
}

function freezeOptionalBounds(bounds: MutableBounds): StaticFabOrganizationOverviewBounds | null {
	return Number.isFinite(bounds.minX) ? freezeBounds(bounds) : null;
}

function freezeRequiredBounds(
	bounds: MutableBounds,
	label: string,
): StaticFabOrganizationOverviewBounds {
	const result = freezeOptionalBounds(bounds);
	if (!result) throw new Error(`${label} has no derived world extent.`);
	return result;
}

function freezeBounds(bounds: MutableBounds): StaticFabOrganizationOverviewBounds {
	if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) {
		throw new Error("Static FAB overview bounds are inverted.");
	}
	return Object.freeze({
		minX: bounds.minX,
		minZ: bounds.minZ,
		maxX: bounds.maxX,
		maxZ: bounds.maxZ,
	});
}

function unionFrozenBounds(
	bounds: readonly (StaticFabOrganizationOverviewBounds | null)[],
): StaticFabOrganizationOverviewBounds | null {
	const mutable = emptyMutableBounds();
	for (const candidate of bounds) if (candidate) includeBounds(mutable, candidate);
	return freezeOptionalBounds(mutable);
}

function writeBounds(
	target: Float64Array,
	row: number,
	bounds: StaticFabOrganizationOverviewBounds,
): void {
	const offset = row * 4;
	target[offset] = bounds.minX;
	target[offset + 1] = bounds.minZ;
	target[offset + 2] = bounds.maxX;
	target[offset + 3] = bounds.maxZ;
}

function writeOptionalBounds(
	target: Float64Array,
	row: number,
	bounds: StaticFabOrganizationOverviewBounds | null,
): void {
	if (bounds) {
		writeBounds(target, row, bounds);
		return;
	}
	target.fill(Number.NaN, row * 4, row * 4 + 4);
}

function readBounds(columns: Float64Array, row: number): StaticFabOrganizationOverviewBounds {
	return freezeBounds({
		minX: columns[row * 4] as number,
		minZ: columns[row * 4 + 1] as number,
		maxX: columns[row * 4 + 2] as number,
		maxZ: columns[row * 4 + 3] as number,
	});
}

function readOptionalBounds(
	columns: Float64Array,
	row: number,
): StaticFabOrganizationOverviewBounds | null {
	return Number.isNaN(columns[row * 4] as number) ? null : readBounds(columns, row);
}

function writeCounts(
	target: Uint32Array,
	row: number,
	counts: StaticFabOrganizationOverviewCounts,
): void {
	const offset = row * OVERVIEW_COUNTS_WIDTH;
	target[offset] = counts.organizationCount;
	target[offset + 1] = counts.railEdgeCount;
	target[offset + 2] = counts.advancedSwitchCount;
	target[offset + 3] = counts.equipmentGroupCount;
	target[offset + 4] = counts.portCount;
}

function readCounts(columns: Uint32Array, row: number): StaticFabOrganizationOverviewCounts {
	const offset = row * OVERVIEW_COUNTS_WIDTH;
	return freezeCounts({
		organizationCount: columns[offset] as number,
		railEdgeCount: columns[offset + 1] as number,
		advancedSwitchCount: columns[offset + 2] as number,
		equipmentGroupCount: columns[offset + 3] as number,
		portCount: columns[offset + 4] as number,
	});
}

function sortCoordinateColumns(
	xs: Int32Array,
	zs: Int32Array,
): Readonly<{ xs: Int32Array; zs: Int32Array }> {
	const order = sortedRowOrder(
		xs.length,
		(left, right) =>
			(xs[left] as number) - (xs[right] as number) || (zs[left] as number) - (zs[right] as number),
	);
	return Object.freeze({ xs: reorderInt32(xs, order), zs: reorderInt32(zs, order) });
}

function sortedRowOrder(
	count: number,
	compare: (left: number, right: number) => number,
): Uint32Array {
	assertTypedArrayRows(count, "sorted overview rows");
	const order = Uint32Array.from({ length: count }, (_, index) => index);
	order.sort(compare);
	return order;
}

function reorderInt32(source: Int32Array, order: Uint32Array): Int32Array {
	const result = new Int32Array(source.length);
	for (let row = 0; row < order.length; row++) result[row] = source[order[row] as number] as number;
	return result;
}

function compareEdgeRows(
	fromXs: Int32Array,
	fromZs: Int32Array,
	toXs: Int32Array,
	toZs: Int32Array,
	left: number,
	right: number,
): number {
	return (
		(fromXs[left] as number) - (fromXs[right] as number) ||
		(fromZs[left] as number) - (fromZs[right] as number) ||
		(toXs[left] as number) - (toXs[right] as number) ||
		(toZs[left] as number) - (toZs[right] as number)
	);
}

function assertTypedArrayRows(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TYPED_ARRAY_ROWS) {
		throw new Error(`${label} count is outside the bounded typed-array contract.`);
	}
}

function assertInt32(value: number, label: string): void {
	if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
		throw new Error(`${label} ${value} is outside signed int32.`);
	}
}

function assertRow(index: number, count: number, label: string): void {
	if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
		throw new RangeError(`${label} index ${index} is outside 0..${Math.max(0, count - 1)}.`);
	}
}
