import type { AdvancedSwitchProfileClass, AdvancedSwitchRecord } from "./AdvancedSwitch";
import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import type { AdvancedSwitchRouteRole, PortDirection, PortSide, PortType } from "./PortRecord";
import {
	ALL_DIRECTIONS,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import type {
	StaticFabOrganizationColor,
	StaticFabOrganizationKind,
} from "./StaticFabOrganization";
import {
	prepareStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
	type StaticFabOrganizationBundleAdvancedSwitch,
	type StaticFabOrganizationBundlePort,
	type StaticFabOrganizationBundleQuarterTurns,
} from "./StaticFabOrganizationBundle";
import { type Cell, cellKey, decodeRailCell, encodeRailCell } from "./TileMap";

export const STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_KIND =
	"static-fab-organization-bundle-placement-preview" as const;
export const STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_ARTIFACT_KIND =
	"static-fab-organization-bundle-placement-preview-artifact" as const;
export const STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS = 16;
export const STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_SAMPLED_CELLS = 512;
/** Every sampled cell performs one encoded-rail read and one advanced-switch-claim read. */
export const STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_MAP_COLLISION_READS =
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_SAMPLED_CELLS * 2;
export const STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_REPORTED_CONFLICTS = 32;

const SIGNED_INT32_MIN = -0x8000_0000;
const SIGNED_INT32_MAX = 0x7fff_ffff;
const FOOTPRINT_ADVANCED_SWITCH_CLAIM = 1;

export interface StaticFabOrganizationBundlePlacementPreviewMapReader {
	getRevision(): number;
	getEncoded(x: number, y: number): number;
	getAdvancedSwitchOwningCell(x: number, y: number): AdvancedSwitchRecord | undefined;
}

export interface StaticFabOrganizationBundlePlacementPreviewBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface StaticFabOrganizationBundlePlacementPreviewRailEdge {
	readonly index: number;
	readonly fromX: number;
	readonly fromY: number;
	readonly toX: number;
	readonly toY: number;
}

export interface StaticFabOrganizationBundlePlacementPreviewFootprintCell {
	readonly index: number;
	readonly x: number;
	readonly y: number;
	/** Intended local rail state. Reserved-only advanced-switch cells contain zero. */
	readonly encoded: number;
	readonly advancedSwitchClaim: boolean;
}

export type StaticFabOrganizationBundlePlacementPreviewPortRoute =
	| Readonly<{
			kind: "CARDINAL_CELL";
			x: number;
			y: number;
			from: 0 | Direction;
			to: 0 | Direction;
	  }>
	| Readonly<{
			kind: "ADVANCED_SWITCH_SEGMENT";
			advancedSwitchIndex: number;
			profileClass: AdvancedSwitchProfileClass;
			role: AdvancedSwitchRouteRole;
			portIndex: 0 | 1 | null;
			segmentOrdinal: number;
	  }>;

export interface StaticFabOrganizationBundlePlacementPreviewPort {
	readonly index: number;
	readonly equipmentGroupIndex: number;
	readonly route: StaticFabOrganizationBundlePlacementPreviewPortRoute;
	readonly stationMillimeters: number;
	readonly side: PortSide;
	readonly lateralOffsetMillimeters: number;
	readonly direction: PortDirection;
	readonly portType: PortType;
	/** Local rail station used by the Canvas ghost. */
	readonly railX: number;
	readonly railY: number;
	/** Local station after the authored lateral offset. */
	readonly worldX: number;
	readonly worldY: number;
}

export interface StaticFabOrganizationBundlePlacementPreviewEquipmentGroup {
	readonly index: number;
	readonly order: number;
	readonly kind: PortType;
	readonly template: string;
	readonly portIndices: readonly number[];
	/** Discrete port-owned extents. Never infer one filled rectangle across unrelated FAB runs. */
	readonly sections: readonly StaticFabOrganizationBundlePlacementPreviewBounds[];
	readonly bounds: StaticFabOrganizationBundlePlacementPreviewBounds;
}

export interface StaticFabOrganizationBundlePlacementPreviewOrganizationSummary {
	readonly index: number;
	readonly root: boolean;
	readonly kind: StaticFabOrganizationKind;
	readonly name: string;
	readonly color: StaticFabOrganizationColor;
	readonly parentCount: number;
	readonly railEdgeCount: number;
	readonly advancedSwitchCount: number;
	readonly equipmentGroupCount: number;
}

/**
 * Local 16 m spatial index. Indices address the immutable readers on the parent artifact. An
 * adjacent edge may be listed in two chunks when it crosses a chunk boundary.
 */
export interface StaticFabOrganizationBundlePlacementPreviewChunk {
	readonly key: string;
	readonly chunkX: number;
	readonly chunkY: number;
	readonly bounds: StaticFabOrganizationBundlePlacementPreviewBounds;
	readonly railEdgeIndices: readonly number[];
	readonly footprintCellIndices: readonly number[];
	readonly portIndices: readonly number[];
	readonly equipmentGroupIndices: readonly number[];
}

/**
 * Prepared local presentation data. Typed-array SoA storage is intentionally private; frozen
 * readers and chunk indices expose geometry without leaking mutable ArrayBuffer views.
 */
export interface StaticFabOrganizationBundlePlacementPreviewArtifact {
	readonly kind: typeof STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_ARTIFACT_KIND;
	readonly preparedBundle: StaticFabOrganizationBundle;
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
	readonly widthMeters: number;
	readonly heightMeters: number;
	readonly bounds: StaticFabOrganizationBundlePlacementPreviewBounds;
	readonly sourceModuleCount: number;
	readonly railEdgeCount: number;
	readonly footprintCellCount: number;
	readonly advancedSwitchCount: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly organizationCount: number;
	readonly chunkCount: number;
	readonly chunks: readonly StaticFabOrganizationBundlePlacementPreviewChunk[];
	readonly organizations: readonly StaticFabOrganizationBundlePlacementPreviewOrganizationSummary[];
	readonly sampledFootprintCellIndices: readonly number[];
	readChunk(
		chunkX: number,
		chunkY: number,
	): StaticFabOrganizationBundlePlacementPreviewChunk | null;
	readRailEdge(index: number): StaticFabOrganizationBundlePlacementPreviewRailEdge;
	readFootprintCell(index: number): StaticFabOrganizationBundlePlacementPreviewFootprintCell;
	readPort(index: number): StaticFabOrganizationBundlePlacementPreviewPort;
	readEquipmentGroup(index: number): StaticFabOrganizationBundlePlacementPreviewEquipmentGroup;
}

export type PreparedStaticFabOrganizationBundlePlacementPreviewArtifactResult =
	| Readonly<{
			valid: true;
			artifact: StaticFabOrganizationBundlePlacementPreviewArtifact;
			reason: string;
	  }>
	| Readonly<{
			valid: false;
			artifact: null;
			reason: string;
	  }>;

export type StaticFabOrganizationBundlePlacementPreviewDisposition =
	| "candidate"
	| "sampled-collision";

/**
 * Deliberately not a RailConstructionPlan: it has no mutations, no `valid: true`, no exact proof,
 * and no build kind. A click must run the exact issued + Worker-certified placement pipeline.
 */
export interface StaticFabOrganizationBundlePlacementPreview {
	readonly kind: typeof STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_KIND;
	readonly planningLevel: "coarse-preview";
	readonly committable: false;
	readonly exactValidity: "unknown";
	readonly disposition: StaticFabOrganizationBundlePlacementPreviewDisposition;
	readonly baseRevision: number;
	readonly artifact: StaticFabOrganizationBundlePlacementPreviewArtifact;
	readonly anchor: Readonly<Cell>;
	readonly sampledFootprintCellIndices: readonly number[];
	readonly sampledCellCount: number;
	readonly mapCollisionReadCount: number;
	readonly sampledOccupiedCellCount: number;
	readonly sampledConflicts: readonly Readonly<Cell>[];
	readonly reason: string;
}

interface ArtifactSoA {
	readonly edgeFromX: Int32Array;
	readonly edgeFromY: Int32Array;
	readonly edgeToX: Int32Array;
	readonly edgeToY: Int32Array;
	readonly footprintX: Int32Array;
	readonly footprintY: Int32Array;
	readonly footprintEncoded: Uint8Array;
	readonly footprintFlags: Uint8Array;
	readonly ports: PortSoA;
	readonly equipmentGroups: readonly StaticFabOrganizationBundlePlacementPreviewEquipmentGroup[];
}

interface PortSoA {
	readonly equipmentGroupIndex: Uint16Array;
	readonly stationMillimeters: Uint32Array;
	readonly lateralOffsetMillimeters: Uint32Array;
	readonly railX: Float64Array;
	readonly railY: Float64Array;
	readonly worldX: Float64Array;
	readonly worldY: Float64Array;
	readonly routeX: Int32Array;
	readonly routeY: Int32Array;
	readonly routeFrom: Uint8Array;
	readonly routeTo: Uint8Array;
	readonly advancedSwitchIndex: Int32Array;
	readonly routeKinds: readonly StaticFabOrganizationBundlePlacementPreviewPortRoute["kind"][];
	readonly profileClasses: readonly (AdvancedSwitchProfileClass | null)[];
	readonly roles: readonly (
		| Extract<
				StaticFabOrganizationBundlePlacementPreviewPortRoute,
				{ kind: "ADVANCED_SWITCH_SEGMENT" }
		  >["role"]
		| null
	)[];
	readonly portIndices: readonly (0 | 1 | null)[];
	readonly segmentOrdinals: Int32Array;
	readonly sides: readonly PortSide[];
	readonly directions: readonly PortDirection[];
	readonly portTypes: readonly PortType[];
}

interface MutableFootprintState {
	x: number;
	y: number;
	encoded: number;
	flags: number;
}

interface MutableChunk {
	chunkX: number;
	chunkY: number;
	railEdgeIndices: Set<number>;
	footprintCellIndices: Set<number>;
	portIndices: Set<number>;
	equipmentGroupIndices: Set<number>;
}

const artifacts = new WeakSet<object>();
const previews = new WeakSet<object>();
const artifactSoA = new WeakMap<object, ArtifactSoA>();
const artifactsByBundle = new WeakMap<
	StaticFabOrganizationBundle,
	Map<StaticFabOrganizationBundleQuarterTurns, StaticFabOrganizationBundlePlacementPreviewArtifact>
>();

export function prepareStaticFabOrganizationBundlePlacementPreviewArtifact(
	bundleInput: unknown,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): PreparedStaticFabOrganizationBundlePlacementPreviewArtifactResult {
	if (!isQuarterTurns(quarterTurns)) {
		return Object.freeze({
			valid: false,
			artifact: null,
			reason: "조직 번들 미리보기 회전은 0, 90, 180, 270도만 지원합니다",
		});
	}
	const prepared = prepareStaticFabOrganizationBundle(bundleInput);
	if (!prepared.valid) {
		return Object.freeze({
			valid: false,
			artifact: null,
			reason: `조직 번들 미리보기를 준비할 수 없습니다 · ${prepared.reason}`,
		});
	}
	const cached = artifactsByBundle.get(prepared.bundle)?.get(quarterTurns);
	if (cached) {
		return Object.freeze({
			valid: true,
			artifact: cached,
			reason: "준비된 조직 번들 미리보기 artifact를 재사용했습니다",
		});
	}

	try {
		const artifact = buildArtifact(prepared.bundle, quarterTurns);
		let rotations = artifactsByBundle.get(prepared.bundle);
		if (!rotations) {
			rotations = new Map();
			artifactsByBundle.set(prepared.bundle, rotations);
		}
		rotations.set(quarterTurns, artifact);
		return Object.freeze({
			valid: true,
			artifact,
			reason: "조직 번들 미리보기 geometry를 검증하고 준비했습니다",
		});
	} catch (error) {
		return Object.freeze({
			valid: false,
			artifact: null,
			reason: `조직 번들 미리보기 geometry를 준비할 수 없습니다 · ${caughtMessage(error)}`,
		});
	}
}

export function isStaticFabOrganizationBundlePlacementPreviewArtifact(
	value: unknown,
): value is StaticFabOrganizationBundlePlacementPreviewArtifact {
	return typeof value === "object" && value !== null && artifacts.has(value);
}

/** Deterministic even coverage over a potentially factory-scale footprint. */
export function staticFabOrganizationBundlePlacementPreviewSampleIndices(
	footprintCellCount: number,
): readonly number[] {
	if (!Number.isSafeInteger(footprintCellCount) || footprintCellCount <= 0) {
		throw new RangeError("조직 번들 미리보기 footprint cell 수가 유효하지 않습니다");
	}
	const sampleCount = Math.min(
		footprintCellCount,
		STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_SAMPLED_CELLS,
	);
	if (sampleCount === 1) return Object.freeze([0]);
	return Object.freeze(
		Array.from({ length: sampleCount }, (_, index) =>
			Math.floor((index * (footprintCellCount - 1)) / (sampleCount - 1)),
		),
	);
}

export function planStaticFabOrganizationBundlePlacementPreview(
	map: StaticFabOrganizationBundlePlacementPreviewMapReader,
	artifact: StaticFabOrganizationBundlePlacementPreviewArtifact,
	anchor: Cell,
): StaticFabOrganizationBundlePlacementPreview {
	if (!isStaticFabOrganizationBundlePlacementPreviewArtifact(artifact)) {
		throw new TypeError("조직 번들 미리보기 artifact가 발급된 값이 아닙니다");
	}
	assertWorldBounds(anchor, artifact.bounds);
	const soa = requiredArtifactSoA(artifact);
	const sampledConflicts: Cell[] = [];
	let sampledOccupiedCellCount = 0;
	let mapCollisionReadCount = 0;
	for (const footprintIndex of artifact.sampledFootprintCellIndices) {
		const x = anchor.x + (soa.footprintX[footprintIndex] as number);
		const y = anchor.y + (soa.footprintY[footprintIndex] as number);
		const encoded = map.getEncoded(x, y);
		mapCollisionReadCount++;
		const switchOwner = map.getAdvancedSwitchOwningCell(x, y);
		mapCollisionReadCount++;
		if (encoded === 0 && switchOwner === undefined) continue;
		sampledOccupiedCellCount++;
		if (
			sampledConflicts.length <
			STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_REPORTED_CONFLICTS
		) {
			sampledConflicts.push(Object.freeze({ x, y }));
		}
	}
	if (
		mapCollisionReadCount > STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_MAX_MAP_COLLISION_READS
	) {
		throw new Error("조직 번들 미리보기 collision read 한계를 초과했습니다");
	}
	const disposition: StaticFabOrganizationBundlePlacementPreviewDisposition =
		sampledOccupiedCellCount === 0 ? "candidate" : "sampled-collision";
	const preview = Object.freeze({
		kind: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_KIND,
		planningLevel: "coarse-preview" as const,
		committable: false as const,
		exactValidity: "unknown" as const,
		disposition,
		baseRevision: map.getRevision(),
		artifact,
		anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
		sampledFootprintCellIndices: artifact.sampledFootprintCellIndices,
		sampledCellCount: artifact.sampledFootprintCellIndices.length,
		mapCollisionReadCount,
		sampledOccupiedCellCount,
		sampledConflicts: Object.freeze(sampledConflicts),
		reason:
			disposition === "candidate"
				? "조직 번들 배치 후보 · 클릭 시 전체 위상과 간섭을 정확히 검사합니다"
				: `표본 footprint에서 ${sampledOccupiedCellCount.toLocaleString()}개 충돌을 찾았습니다 · 다른 위치를 선택하세요`,
	} satisfies StaticFabOrganizationBundlePlacementPreview);
	previews.add(preview);
	return preview;
}

export function isStaticFabOrganizationBundlePlacementPreview(
	value: unknown,
): value is StaticFabOrganizationBundlePlacementPreview {
	return typeof value === "object" && value !== null && previews.has(value);
}

function buildArtifact(
	bundle: StaticFabOrganizationBundle,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): StaticFabOrganizationBundlePlacementPreviewArtifact {
	const edgeFromX = new Int32Array(bundle.railEdges.length);
	const edgeFromY = new Int32Array(bundle.railEdges.length);
	const edgeToX = new Int32Array(bundle.railEdges.length);
	const edgeToY = new Int32Array(bundle.railEdges.length);
	const footprintByKey = new Map<string, MutableFootprintState>();
	const stateAt = (x: number, y: number): MutableFootprintState => {
		const key = cellKey(x, y);
		const existing = footprintByKey.get(key);
		if (existing) return existing;
		const created = { x, y, encoded: 0, flags: 0 };
		footprintByKey.set(key, created);
		return created;
	};
	for (let index = 0; index < bundle.railEdges.length; index++) {
		const edge = bundle.railEdges[index];
		if (!edge) throw new Error(`레일 edge ${index}가 누락되었습니다`);
		const sourceDirection = directionBetween(edge.from, edge.to);
		if (sourceDirection === null) throw new Error(`레일 edge ${index}가 인접하지 않습니다`);
		const direction = rotatePreviewDirection(sourceDirection, quarterTurns) as Direction;
		const fromX = rotatePreviewX(edge.from.x, edge.from.y, quarterTurns);
		const fromY = rotatePreviewY(edge.from.x, edge.from.y, quarterTurns);
		const toX = rotatePreviewX(edge.to.x, edge.to.y, quarterTurns);
		const toY = rotatePreviewY(edge.to.x, edge.to.y, quarterTurns);
		edgeFromX[index] = fromX;
		edgeFromY[index] = fromY;
		edgeToX[index] = toX;
		edgeToY[index] = toY;
		const from = stateAt(fromX, fromY);
		const to = stateAt(toX, toY);
		const fromRail = decodeRailCell(from.encoded);
		const toRail = decodeRailCell(to.encoded);
		from.encoded = encodeRailCell({
			incoming: fromRail.incoming,
			outgoing: fromRail.outgoing | direction,
		});
		to.encoded = encodeRailCell({
			incoming: toRail.incoming | oppositeDirection(direction),
			outgoing: toRail.outgoing,
		});
	}
	const transformedAdvancedSwitches = transformPreviewAdvancedSwitches(
		bundle.advancedSwitches,
		quarterTurns,
	);
	for (let index = 0; index < transformedAdvancedSwitches.length; index++) {
		const record = transformedAdvancedSwitches[index];
		if (!record) throw new Error(`고급 스위치 ${index}가 누락되었습니다`);
		const geometry = deriveAdvancedSwitchGeometry({ id: index + 1, ...record });
		for (const cell of geometry.claimedCells) {
			stateAt(cell.x, cell.y).flags |= FOOTPRINT_ADVANCED_SWITCH_CLAIM;
		}
	}
	const footprint = [...footprintByKey.values()].sort(compareMutableCells);
	const footprintX = new Int32Array(footprint.length);
	const footprintY = new Int32Array(footprint.length);
	const footprintEncoded = new Uint8Array(footprint.length);
	const footprintFlags = new Uint8Array(footprint.length);
	for (let index = 0; index < footprint.length; index++) {
		const state = footprint[index] as MutableFootprintState;
		footprintX[index] = state.x;
		footprintY[index] = state.y;
		footprintEncoded[index] = state.encoded;
		footprintFlags[index] = state.flags;
	}

	const transformedPorts = transformPreviewPorts(bundle.ports, quarterTurns);
	const ports = buildPortSoA(transformedPorts, transformedAdvancedSwitches);
	const equipmentGroups = buildEquipmentGroups(bundle.equipmentGroups, ports);
	const rootOrganizationIndices = new Set(bundle.rootOrganizationIndices);
	const organizations = Object.freeze(
		bundle.organizations.map((organization, index) =>
			Object.freeze({
				index,
				root: rootOrganizationIndices.has(index),
				kind: organization.kind,
				name: organization.name,
				color: organization.properties.color,
				parentCount: organization.parentOrganizationIndices.length,
				railEdgeCount: organization.membership.railEdgeIndices.length,
				advancedSwitchCount: organization.membership.advancedSwitchIndices.length,
				equipmentGroupCount: organization.membership.equipmentGroupIndices.length,
			}),
		),
	);
	const bounds = artifactBounds(footprintX, footprintY, ports, equipmentGroups);
	const chunks = buildChunks(edgeFromX, edgeFromY, edgeToX, edgeToY, footprintX, footprintY, ports);
	const chunksByKey = new Map(chunks.map((chunk) => [chunk.key, chunk] as const));
	const sampledFootprintCellIndices = staticFabOrganizationBundlePlacementPreviewSampleIndices(
		footprint.length,
	);
	const soa: ArtifactSoA = Object.freeze({
		edgeFromX,
		edgeFromY,
		edgeToX,
		edgeToY,
		footprintX,
		footprintY,
		footprintEncoded,
		footprintFlags,
		ports,
		equipmentGroups,
	});

	const artifact = Object.freeze({
		kind: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_ARTIFACT_KIND,
		preparedBundle: bundle,
		quarterTurns,
		widthMeters: quarterTurns % 2 === 0 ? bundle.sourceWidthMeters : bundle.sourceHeightMeters,
		heightMeters: quarterTurns % 2 === 0 ? bundle.sourceHeightMeters : bundle.sourceWidthMeters,
		bounds,
		sourceModuleCount: bundle.sourceModuleCount,
		railEdgeCount: bundle.railEdges.length,
		footprintCellCount: footprint.length,
		advancedSwitchCount: bundle.advancedSwitches.length,
		portCount: bundle.ports.length,
		equipmentGroupCount: bundle.equipmentGroups.length,
		organizationCount: bundle.organizations.length,
		chunkCount: chunks.length,
		chunks,
		organizations,
		sampledFootprintCellIndices,
		readChunk(chunkX: number, chunkY: number) {
			if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkY)) {
				throw new RangeError("조직 번들 미리보기 chunk 좌표는 정수여야 합니다");
			}
			return chunksByKey.get(`${chunkX}:${chunkY}`) ?? null;
		},
		readRailEdge(index: number) {
			assertIndex(index, edgeFromX.length, "레일 edge");
			return Object.freeze({
				index,
				fromX: edgeFromX[index] as number,
				fromY: edgeFromY[index] as number,
				toX: edgeToX[index] as number,
				toY: edgeToY[index] as number,
			});
		},
		readFootprintCell(index: number) {
			assertIndex(index, footprintX.length, "footprint cell");
			return Object.freeze({
				index,
				x: footprintX[index] as number,
				y: footprintY[index] as number,
				encoded: footprintEncoded[index] as number,
				advancedSwitchClaim:
					((footprintFlags[index] as number) & FOOTPRINT_ADVANCED_SWITCH_CLAIM) !== 0,
			});
		},
		readPort(index: number) {
			return readPort(ports, index);
		},
		readEquipmentGroup(index: number) {
			assertIndex(index, equipmentGroups.length, "장비 그룹");
			return equipmentGroups[index] as StaticFabOrganizationBundlePlacementPreviewEquipmentGroup;
		},
	} satisfies StaticFabOrganizationBundlePlacementPreviewArtifact);
	artifactSoA.set(artifact, soa);
	artifacts.add(artifact);
	return artifact;
}

function transformPreviewAdvancedSwitches(
	records: readonly StaticFabOrganizationBundleAdvancedSwitch[],
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): readonly StaticFabOrganizationBundleAdvancedSwitch[] {
	if (quarterTurns === 0) return records;
	return records.map((record) => ({
		profileClass: record.profileClass,
		origin: {
			x: rotatePreviewX(record.origin.x, record.origin.y, quarterTurns),
			y: rotatePreviewY(record.origin.x, record.origin.y, quarterTurns),
		},
		forward: rotatePreviewDirection(record.forward, quarterTurns) as Direction,
		lateral: rotatePreviewDirection(record.lateral, quarterTurns) as Direction,
		movementMask: record.movementMask,
	}));
}

function transformPreviewPorts(
	ports: readonly StaticFabOrganizationBundlePort[],
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): readonly StaticFabOrganizationBundlePort[] {
	if (quarterTurns === 0) return ports;
	return ports.map((port) =>
		port.route.kind === "CARDINAL_CELL"
			? {
					...port,
					route: {
						kind: "CARDINAL_CELL" as const,
						x: rotatePreviewX(port.route.x, port.route.z, quarterTurns),
						z: rotatePreviewY(port.route.x, port.route.z, quarterTurns),
						from: rotatePreviewDirection(port.route.from, quarterTurns),
						to: rotatePreviewDirection(port.route.to, quarterTurns),
					},
				}
			: port,
	);
}

function rotatePreviewX(
	x: number,
	y: number,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): number {
	if (quarterTurns === 0) return x;
	if (quarterTurns === 1) return -y;
	if (quarterTurns === 2) return -x;
	return y;
}

function rotatePreviewY(
	x: number,
	y: number,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): number {
	if (quarterTurns === 0) return y;
	if (quarterTurns === 1) return x;
	if (quarterTurns === 2) return -y;
	return -x;
}

function rotatePreviewDirection(
	direction: 0 | Direction,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): 0 | Direction {
	if (direction === 0 || quarterTurns === 0) return direction;
	const moved = moveCell({ x: 0, y: 0 }, direction);
	const rotated = {
		x: rotatePreviewX(moved.x, moved.y, quarterTurns),
		y: rotatePreviewY(moved.x, moved.y, quarterTurns),
	};
	const result = directionBetween({ x: 0, y: 0 }, rotated);
	if (result === null || !ALL_DIRECTIONS.includes(result)) {
		throw new Error("조직 번들 미리보기 방향 회전에 실패했습니다");
	}
	return result;
}

function buildPortSoA(
	ports: readonly StaticFabOrganizationBundlePort[],
	advancedSwitches: readonly Readonly<{
		profileClass: AdvancedSwitchProfileClass;
		origin: Cell;
		forward: Direction;
		lateral: Direction;
		movementMask: number;
	}>[],
): PortSoA {
	const equipmentGroupIndex = new Uint16Array(ports.length);
	const stationMillimeters = new Uint32Array(ports.length);
	const lateralOffsetMillimeters = new Uint32Array(ports.length);
	const railX = new Float64Array(ports.length);
	const railY = new Float64Array(ports.length);
	const worldX = new Float64Array(ports.length);
	const worldY = new Float64Array(ports.length);
	const routeX = new Int32Array(ports.length);
	const routeY = new Int32Array(ports.length);
	const routeFrom = new Uint8Array(ports.length);
	const routeTo = new Uint8Array(ports.length);
	const advancedSwitchIndex = new Int32Array(ports.length);
	advancedSwitchIndex.fill(-1);
	const segmentOrdinals = new Int32Array(ports.length);
	const routeKinds: StaticFabOrganizationBundlePlacementPreviewPortRoute["kind"][] = [];
	const profileClasses: (AdvancedSwitchProfileClass | null)[] = [];
	const roles: PortSoA["roles"][number][] = [];
	const portIndices: (0 | 1 | null)[] = [];
	const sides: PortSide[] = [];
	const directions: PortDirection[] = [];
	const portTypes: PortType[] = [];
	for (let index = 0; index < ports.length; index++) {
		const port = ports[index];
		if (!port) throw new Error(`port ${index}가 누락되었습니다`);
		equipmentGroupIndex[index] = port.equipmentGroupIndex;
		stationMillimeters[index] = port.stationMillimeters;
		lateralOffsetMillimeters[index] = port.lateralOffsetMillimeters;
		routeKinds.push(port.route.kind);
		sides.push(port.side);
		directions.push(port.direction);
		portTypes.push(port.portType);
		const position = previewPortPosition(port, advancedSwitches);
		railX[index] = position.railX;
		railY[index] = position.railY;
		worldX[index] = position.worldX;
		worldY[index] = position.worldY;
		if (port.route.kind === "CARDINAL_CELL") {
			routeX[index] = port.route.x;
			routeY[index] = port.route.z;
			routeFrom[index] = port.route.from;
			routeTo[index] = port.route.to;
			profileClasses.push(null);
			roles.push(null);
			portIndices.push(null);
			segmentOrdinals[index] = 0;
		} else {
			const switchRecord = advancedSwitches[port.route.advancedSwitchIndex];
			if (!switchRecord) throw new Error(`port ${index}의 고급 스위치가 누락되었습니다`);
			routeX[index] = switchRecord.origin.x;
			routeY[index] = switchRecord.origin.y;
			advancedSwitchIndex[index] = port.route.advancedSwitchIndex;
			profileClasses.push(port.route.profileClass);
			roles.push(port.route.role);
			portIndices.push(port.route.portIndex);
			segmentOrdinals[index] = port.route.segmentOrdinal;
		}
	}
	return Object.freeze({
		equipmentGroupIndex,
		stationMillimeters,
		lateralOffsetMillimeters,
		railX,
		railY,
		worldX,
		worldY,
		routeX,
		routeY,
		routeFrom,
		routeTo,
		advancedSwitchIndex,
		routeKinds: Object.freeze(routeKinds),
		profileClasses: Object.freeze(profileClasses),
		roles: Object.freeze(roles),
		portIndices: Object.freeze(portIndices),
		segmentOrdinals,
		sides: Object.freeze(sides),
		directions: Object.freeze(directions),
		portTypes: Object.freeze(portTypes),
	});
}

function readPort(ports: PortSoA, index: number): StaticFabOrganizationBundlePlacementPreviewPort {
	assertIndex(index, ports.routeKinds.length, "port");
	const routeKind = ports.routeKinds[index];
	if (!routeKind) throw new Error(`port ${index} route가 누락되었습니다`);
	const route: StaticFabOrganizationBundlePlacementPreviewPortRoute =
		routeKind === "CARDINAL_CELL"
			? Object.freeze({
					kind: routeKind,
					x: ports.routeX[index] as number,
					y: ports.routeY[index] as number,
					from: ports.routeFrom[index] as 0 | Direction,
					to: ports.routeTo[index] as 0 | Direction,
				})
			: Object.freeze({
					kind: routeKind,
					advancedSwitchIndex: ports.advancedSwitchIndex[index] as number,
					profileClass: ports.profileClasses[index] as AdvancedSwitchProfileClass,
					role: ports.roles[index] as Extract<
						StaticFabOrganizationBundlePlacementPreviewPortRoute,
						{ kind: "ADVANCED_SWITCH_SEGMENT" }
					>["role"],
					portIndex: ports.portIndices[index] as 0 | 1 | null,
					segmentOrdinal: ports.segmentOrdinals[index] as number,
				});
	return Object.freeze({
		index,
		equipmentGroupIndex: ports.equipmentGroupIndex[index] as number,
		route,
		stationMillimeters: ports.stationMillimeters[index] as number,
		side: ports.sides[index] as PortSide,
		lateralOffsetMillimeters: ports.lateralOffsetMillimeters[index] as number,
		direction: ports.directions[index] as PortDirection,
		portType: ports.portTypes[index] as PortType,
		railX: ports.railX[index] as number,
		railY: ports.railY[index] as number,
		worldX: ports.worldX[index] as number,
		worldY: ports.worldY[index] as number,
	});
}

function buildEquipmentGroups(
	groups: StaticFabOrganizationBundle["equipmentGroups"],
	ports: PortSoA,
): readonly StaticFabOrganizationBundlePlacementPreviewEquipmentGroup[] {
	return Object.freeze(
		groups.map((group, index) => {
			let minX = Number.POSITIVE_INFINITY;
			let minY = Number.POSITIVE_INFINITY;
			let maxX = Number.NEGATIVE_INFINITY;
			let maxY = Number.NEGATIVE_INFINITY;
			const sections = group.portIndices.map((portIndex) => {
				const x = ports.worldX[portIndex] as number;
				const y = ports.worldY[portIndex] as number;
				return freezeBounds({ minX: x, minY: y, maxX: x, maxY: y });
			});
			for (const section of sections) {
				minX = Math.min(minX, section.minX);
				minY = Math.min(minY, section.minY);
				maxX = Math.max(maxX, section.maxX);
				maxY = Math.max(maxY, section.maxY);
			}
			if (!Number.isFinite(minX)) throw new Error(`장비 그룹 ${index}의 port가 비어 있습니다`);
			return Object.freeze({
				index,
				order: index,
				kind: group.kind,
				template: group.kind === "EQ" ? `EQ:${group.pitchMillimeters}` : group.template,
				portIndices: Object.freeze([...group.portIndices]),
				sections: Object.freeze(sections),
				bounds: freezeBounds({ minX, minY, maxX, maxY }),
			});
		}),
	);
}

function previewPortPosition(
	port: StaticFabOrganizationBundlePort,
	advancedSwitches: readonly Readonly<{
		profileClass: AdvancedSwitchProfileClass;
		origin: Cell;
		forward: Direction;
		lateral: Direction;
		movementMask: number;
	}>[],
): Readonly<{ railX: number; railY: number; worldX: number; worldY: number }> {
	if (port.route.kind === "ADVANCED_SWITCH_SEGMENT") {
		const record = advancedSwitches[port.route.advancedSwitchIndex];
		if (!record) throw new Error("port 고급 스위치 참조가 유효하지 않습니다");
		const geometry = deriveAdvancedSwitchGeometry({
			id: port.route.advancedSwitchIndex + 1,
			...record,
		});
		const boundary =
			port.route.role === "INPUT" && port.route.portIndex !== null
				? geometry.inputs[port.route.portIndex]
				: port.route.role === "OUTPUT" && port.route.portIndex !== null
					? geometry.outputs[port.route.portIndex]
					: null;
		const forward = directionVector(record.forward);
		let points: readonly Readonly<{ x: number; y: number }>[];
		if (port.route.role === "INPUT" && port.route.portIndex !== null && boundary) {
			const route =
				port.route.portIndex === 0
					? geometry.mainPath.slice(0, 4)
					: [...geometry.secondaryInputPath, geometry.sharedTrunkSupport];
			const outside = directionVector(boundary.direction);
			points = [
				{
					x: boundary.cell.x + 0.5 + outside.x * 0.5,
					y: boundary.cell.y + 0.5 + outside.y * 0.5,
				},
				...route.map(cellCenter),
			];
		} else if (port.route.role === "OUTPUT" && port.route.portIndex !== null && boundary) {
			const route =
				port.route.portIndex === 0
					? [geometry.sharedTrunkSupport, ...geometry.mainPath.slice(4)]
					: [geometry.sharedTrunkSupport, ...geometry.secondaryOutputPath];
			const outside = directionVector(boundary.direction);
			points = [
				...route.map(cellCenter),
				{
					x: boundary.cell.x + 0.5 + outside.x * 0.5,
					y: boundary.cell.y + 0.5 + outside.y * 0.5,
				},
			];
		} else {
			const center = cellCenter(geometry.sharedTrunkSupport);
			points = [
				{ x: center.x - forward.x * 0.5, y: center.y - forward.y * 0.5 },
				{ x: center.x + forward.x * 0.5, y: center.y + forward.y * 0.5 },
			];
		}
		return offsetPreviewPortSample(
			samplePreviewPolyline(points, port.stationMillimeters / 1_000),
			port,
		);
	}
	const center = { x: port.route.x + 0.5, y: port.route.z + 0.5 };
	const from = port.route.from === 0 ? null : directionVector(port.route.from);
	const to = port.route.to === 0 ? null : directionVector(port.route.to);
	if (!from && !to) throw new Error("cardinal port route가 비어 있습니다");
	const start = from ? { x: center.x + from.x * 0.5, y: center.y + from.y * 0.5 } : center;
	const end = to ? { x: center.x + to.x * 0.5, y: center.y + to.y * 0.5 } : center;
	const corner =
		from !== null &&
		to !== null &&
		port.route.to !== oppositeDirection(port.route.from as Direction);
	const pathLength = corner ? Math.PI * 0.25 : Math.hypot(end.x - start.x, end.y - start.y);
	if (pathLength <= Number.EPSILON) throw new Error("cardinal port route 길이가 0입니다");
	const amount = clamp(port.stationMillimeters / 1_000 / pathLength, 0, 1);
	let railX: number;
	let railY: number;
	let tangentX: number;
	let tangentY: number;
	if (corner && from && to) {
		const control = {
			x: center.x + (from.x + to.x) * 0.5,
			y: center.y + (from.y + to.y) * 0.5,
		};
		const inverse = 1 - amount;
		railX =
			inverse * inverse * start.x + 2 * inverse * amount * control.x + amount * amount * end.x;
		railY =
			inverse * inverse * start.y + 2 * inverse * amount * control.y + amount * amount * end.y;
		tangentX = 2 * inverse * (control.x - start.x) + 2 * amount * (end.x - control.x);
		tangentY = 2 * inverse * (control.y - start.y) + 2 * amount * (end.y - control.y);
	} else {
		railX = start.x + (end.x - start.x) * amount;
		railY = start.y + (end.y - start.y) * amount;
		tangentX = end.x - start.x;
		tangentY = end.y - start.y;
	}
	const tangentLength = Math.hypot(tangentX, tangentY);
	if (tangentLength <= Number.EPSILON) throw new Error("cardinal port tangent 길이가 0입니다");
	tangentX /= tangentLength;
	tangentY /= tangentLength;
	const offsetMeters =
		port.side === "CENTER"
			? 0
			: (port.side === "LEFT" ? 1 : -1) * (port.lateralOffsetMillimeters / 1_000);
	return Object.freeze({
		railX,
		railY,
		worldX: railX - tangentY * offsetMeters,
		worldY: railY + tangentX * offsetMeters,
	});
}

interface PreviewPolylineSample {
	readonly railX: number;
	readonly railY: number;
	readonly tangentX: number;
	readonly tangentY: number;
}

function samplePreviewPolyline(
	points: readonly Readonly<{ x: number; y: number }>[],
	stationMeters: number,
): PreviewPolylineSample {
	if (points.length < 2) throw new Error("port preview polyline은 두 점 이상이어야 합니다");
	const segments: Array<{
		readonly start: Readonly<{ x: number; y: number }>;
		readonly end: Readonly<{ x: number; y: number }>;
		readonly length: number;
	}> = [];
	let totalLength = 0;
	for (let index = 1; index < points.length; index++) {
		const start = points[index - 1] as Readonly<{ x: number; y: number }>;
		const end = points[index] as Readonly<{ x: number; y: number }>;
		const length = Math.hypot(end.x - start.x, end.y - start.y);
		if (length <= Number.EPSILON) continue;
		segments.push({ start, end, length });
		totalLength += length;
	}
	if (segments.length === 0) throw new Error("port preview polyline 길이가 0입니다");
	let remaining = clamp(stationMeters, 0, totalLength);
	for (const segment of segments) {
		if (remaining > segment.length) {
			remaining -= segment.length;
			continue;
		}
		const amount = segment.length <= Number.EPSILON ? 0 : remaining / segment.length;
		return Object.freeze({
			railX: segment.start.x + (segment.end.x - segment.start.x) * amount,
			railY: segment.start.y + (segment.end.y - segment.start.y) * amount,
			tangentX: (segment.end.x - segment.start.x) / segment.length,
			tangentY: (segment.end.y - segment.start.y) / segment.length,
		});
	}
	const last = segments.at(-1) as (typeof segments)[number];
	return Object.freeze({
		railX: last.end.x,
		railY: last.end.y,
		tangentX: (last.end.x - last.start.x) / last.length,
		tangentY: (last.end.y - last.start.y) / last.length,
	});
}

function offsetPreviewPortSample(
	sample: PreviewPolylineSample,
	port: Pick<StaticFabOrganizationBundlePort, "side" | "lateralOffsetMillimeters">,
): Readonly<{ railX: number; railY: number; worldX: number; worldY: number }> {
	const offsetMeters =
		port.side === "CENTER"
			? 0
			: (port.side === "LEFT" ? 1 : -1) * (port.lateralOffsetMillimeters / 1_000);
	return Object.freeze({
		railX: sample.railX,
		railY: sample.railY,
		worldX: sample.railX - sample.tangentY * offsetMeters,
		worldY: sample.railY + sample.tangentX * offsetMeters,
	});
}

function cellCenter(cell: Cell): Readonly<{ x: number; y: number }> {
	return Object.freeze({ x: cell.x + 0.5, y: cell.y + 0.5 });
}

function artifactBounds(
	footprintX: Int32Array,
	footprintY: Int32Array,
	ports: PortSoA,
	equipmentGroups: readonly StaticFabOrganizationBundlePlacementPreviewEquipmentGroup[],
): StaticFabOrganizationBundlePlacementPreviewBounds {
	if (footprintX.length === 0) throw new Error("조직 번들 footprint가 비어 있습니다");
	let minX = footprintX[0] as number;
	let minY = footprintY[0] as number;
	let maxX = minX;
	let maxY = minY;
	for (let index = 1; index < footprintX.length; index++) {
		minX = Math.min(minX, footprintX[index] as number);
		minY = Math.min(minY, footprintY[index] as number);
		maxX = Math.max(maxX, footprintX[index] as number);
		maxY = Math.max(maxY, footprintY[index] as number);
	}
	for (let index = 0; index < ports.worldX.length; index++) {
		minX = Math.min(minX, ports.worldX[index] as number);
		minY = Math.min(minY, ports.worldY[index] as number);
		maxX = Math.max(maxX, ports.worldX[index] as number);
		maxY = Math.max(maxY, ports.worldY[index] as number);
	}
	for (const group of equipmentGroups) {
		minX = Math.min(minX, group.bounds.minX);
		minY = Math.min(minY, group.bounds.minY);
		maxX = Math.max(maxX, group.bounds.maxX);
		maxY = Math.max(maxY, group.bounds.maxY);
	}
	return freezeBounds({ minX, minY, maxX, maxY });
}

function buildChunks(
	edgeFromX: Int32Array,
	edgeFromY: Int32Array,
	edgeToX: Int32Array,
	edgeToY: Int32Array,
	footprintX: Int32Array,
	footprintY: Int32Array,
	ports: PortSoA,
): readonly StaticFabOrganizationBundlePlacementPreviewChunk[] {
	const mutable = new Map<string, MutableChunk>();
	const chunkAt = (chunkX: number, chunkY: number): MutableChunk => {
		const key = `${chunkX}:${chunkY}`;
		const existing = mutable.get(key);
		if (existing) return existing;
		const created: MutableChunk = {
			chunkX,
			chunkY,
			railEdgeIndices: new Set(),
			footprintCellIndices: new Set(),
			portIndices: new Set(),
			equipmentGroupIndices: new Set(),
		};
		mutable.set(key, created);
		return created;
	};
	const addAt = (x: number, y: number, visit: (chunk: MutableChunk) => void): void => {
		visit(
			chunkAt(
				Math.floor(x / STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS),
				Math.floor(y / STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS),
			),
		);
	};
	for (let index = 0; index < edgeFromX.length; index++) {
		addAt(edgeFromX[index] as number, edgeFromY[index] as number, (chunk) =>
			chunk.railEdgeIndices.add(index),
		);
		addAt(edgeToX[index] as number, edgeToY[index] as number, (chunk) =>
			chunk.railEdgeIndices.add(index),
		);
	}
	for (let index = 0; index < footprintX.length; index++) {
		addAt(footprintX[index] as number, footprintY[index] as number, (chunk) =>
			chunk.footprintCellIndices.add(index),
		);
	}
	for (let index = 0; index < ports.worldX.length; index++) {
		addAt(ports.worldX[index] as number, ports.worldY[index] as number, (chunk) => {
			chunk.portIndices.add(index);
			chunk.equipmentGroupIndices.add(ports.equipmentGroupIndex[index] as number);
		});
	}
	return Object.freeze(
		[...mutable.values()]
			.sort((left, right) => left.chunkY - right.chunkY || left.chunkX - right.chunkX)
			.map((chunk) => {
				const minX = chunk.chunkX * STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS;
				const minY = chunk.chunkY * STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS;
				return Object.freeze({
					key: `${chunk.chunkX}:${chunk.chunkY}`,
					chunkX: chunk.chunkX,
					chunkY: chunk.chunkY,
					bounds: freezeBounds({
						minX,
						minY,
						maxX: minX + STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS,
						maxY: minY + STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREVIEW_CHUNK_METERS,
					}),
					railEdgeIndices: frozenSortedIndices(chunk.railEdgeIndices),
					footprintCellIndices: frozenSortedIndices(chunk.footprintCellIndices),
					portIndices: frozenSortedIndices(chunk.portIndices),
					equipmentGroupIndices: frozenSortedIndices(chunk.equipmentGroupIndices),
				});
			}),
	);
}

function assertWorldBounds(
	anchor: Cell,
	bounds: StaticFabOrganizationBundlePlacementPreviewBounds,
): void {
	if (!isInt32(anchor.x) || !isInt32(anchor.y)) {
		throw new RangeError("조직 번들 미리보기 anchor는 signed-int32 정수 셀이어야 합니다");
	}
	if (
		anchor.x + Math.floor(bounds.minX) < SIGNED_INT32_MIN ||
		anchor.y + Math.floor(bounds.minY) < SIGNED_INT32_MIN ||
		anchor.x + Math.ceil(bounds.maxX) > SIGNED_INT32_MAX ||
		anchor.y + Math.ceil(bounds.maxY) > SIGNED_INT32_MAX
	) {
		throw new RangeError("조직 번들 미리보기 world bounds가 signed-int32 범위를 벗어났습니다");
	}
}

function requiredArtifactSoA(
	artifact: StaticFabOrganizationBundlePlacementPreviewArtifact,
): ArtifactSoA {
	const soa = artifactSoA.get(artifact);
	if (!soa) throw new TypeError("조직 번들 미리보기 artifact storage를 찾을 수 없습니다");
	return soa;
}

function directionVector(direction: Direction): Readonly<Cell> {
	return moveCell({ x: 0, y: 0 }, direction);
}

function freezeBounds(
	bounds: StaticFabOrganizationBundlePlacementPreviewBounds,
): StaticFabOrganizationBundlePlacementPreviewBounds {
	return Object.freeze({
		minX: bounds.minX,
		minY: bounds.minY,
		maxX: bounds.maxX,
		maxY: bounds.maxY,
	});
}

function frozenSortedIndices(indices: ReadonlySet<number>): readonly number[] {
	return Object.freeze([...indices].sort((left, right) => left - right));
}

function compareMutableCells(left: MutableFootprintState, right: MutableFootprintState): number {
	return left.y - right.y || left.x - right.x;
}

function assertIndex(index: number, length: number, label: string): void {
	if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
		throw new RangeError(`${label} index ${index}가 유효하지 않습니다`);
	}
}

function isQuarterTurns(value: number): value is StaticFabOrganizationBundleQuarterTurns {
	return value === 0 || value === 1 || value === 2 || value === 3;
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= SIGNED_INT32_MIN && value <= SIGNED_INT32_MAX;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function caughtMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "unknown preview error";
}
