import type { PortEquipmentState } from "../core/EquipmentGroup";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { PORT_DIRECTIONS, PORT_SIDES, PORT_TYPES, type PortType } from "../core/PortRecord";
import type { Direction } from "../core/railShape";
import { PATH_SOURCE_IDENTITY_KIND } from "./CompoundPhysicalPath";
import { PATH_KIND } from "./PhysicalPathCompiler";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";
import { metersToMillimeters, resolvePortAttachmentAtSourcePath } from "./PortAttachmentResolver";
import type { PortEquipmentResolvedPositionCapability } from "./PortEquipmentResolvedPositions";
import {
	type CompiledPortSlots,
	compileBasePortSlots,
	compilePortSlotExclusionMask,
	compilePortSlotExclusionMaskCooperatively,
	compilePortSlotSpatialIndex,
	OPENFAB_PORT_SLOT_POLICIES,
	PORT_SLOT_MAX_ROWS,
	PORT_SLOT_SPATIAL_CHUNK_METERS,
	PORT_SLOT_STATUS,
	PortSlotAvailabilityIndex,
	type PortSlotAvailabilityResult,
	PortSlotRailClearanceIndex,
	type PortSlotSpatialIndexSnapshot,
	preparePortSlotSpatialIndexCooperatively,
	validatePortSlotSpatialIndex,
} from "./PortSlotCompiler";
import type { RailEnvelopeSpatialIndexSnapshot } from "./RailClearanceCompiler";

export interface PortSlotPreparedArtifacts {
	readonly revision: number;
	readonly portType: PortType;
	readonly slotCount: number;
	readonly slots: CompiledPortSlots;
	readonly spatialIndex: PortSlotSpatialIndexSnapshot;
}

export interface PortSlotPreparedArtifactCatalog {
	readonly OHB: PortSlotPreparedArtifacts;
	readonly EQ: PortSlotPreparedArtifacts;
	readonly STK: PortSlotPreparedArtifacts;
}

/** Live occupancy queries whose row inputs are bound to one validated prepared artifact. */
export interface PreparedPortSlotAvailabilityIndex extends PortSlotAvailabilityIndex {
	readonly kind: "prepared-port-slot-availability-index";
	matchesPreparedArtifacts(artifacts: PortSlotPreparedArtifacts): boolean;
}

const sourceLayoutsByPreparedArtifacts = new WeakMap<object, CompiledPhysicalLayout>();
interface ValidatedPortSlotRowIntegrity {
	readonly sourcePathIndices: Uint32Array;
	readonly statuses: Uint8Array;
	readonly conflictingPortIds: Int32Array;
	readonly conflictingRailPathIndices: Int32Array;
	readonly physicalSourceRows: ValidatedPhysicalSourceRows;
}

const validatedRowsByPreparedArtifacts = new WeakMap<object, ValidatedPortSlotRowIntegrity>();
interface ValidatedPhysicalSourceRows {
	readonly remap: CompiledPhysicalLayout["pathIntervalRemap"];
	readonly sourcePathCount: number;
	readonly sourcePathCells: Int32Array;
	readonly sourcePathKinds: Uint8Array;
	readonly sourcePathFromDirections: Uint8Array;
	readonly sourcePathToDirections: Uint8Array;
	readonly sourceIdentityKinds: Uint8Array;
	readonly sourcePathCanonicalStarts: Float32Array;
	readonly sourcePathLengths: Float32Array;
	readonly sourcePathOffsets: Uint32Array;
	readonly sourceStarts: Float32Array;
	readonly sourceEnds: Float32Array;
	readonly targetPathIndices: Uint32Array;
	readonly targetStarts: Float32Array;
	readonly targetEnds: Float32Array;
	readonly mappingKinds: Uint8Array;
	readonly paths: CompiledPhysicalLayout["paths"];
	readonly pathPositions: Float32Array;
	readonly pathTangents: Float32Array;
	readonly pathDistances: Float32Array;
	readonly pathOffsets: Uint32Array;
	readonly pathKinds: Uint8Array;
	readonly pathLengths: Float32Array;
	readonly validatedSourcePathCells: Int32Array;
	readonly validatedSourcePathKinds: Uint8Array;
	readonly validatedSourcePathFromDirections: Uint8Array;
	readonly validatedSourcePathToDirections: Uint8Array;
	readonly validatedSourceIdentityKinds: Uint8Array;
	readonly validatedSourcePathCanonicalStarts: Float32Array;
	readonly validatedSourcePathLengths: Float32Array;
	readonly validatedSourcePathOffsets: Uint32Array;
	readonly validatedSourceStarts: Float32Array;
	readonly validatedSourceEnds: Float32Array;
	readonly validatedTargetPathIndices: Uint32Array;
	readonly validatedTargetStarts: Float32Array;
	readonly validatedTargetEnds: Float32Array;
	readonly validatedMappingKinds: Uint8Array;
}

type CapturedPhysicalSourceRows = Omit<
	ValidatedPhysicalSourceRows,
	| "validatedSourcePathCells"
	| "validatedSourcePathKinds"
	| "validatedSourcePathFromDirections"
	| "validatedSourcePathToDirections"
	| "validatedSourceIdentityKinds"
	| "validatedSourcePathCanonicalStarts"
	| "validatedSourcePathLengths"
	| "validatedSourcePathOffsets"
	| "validatedSourceStarts"
	| "validatedSourceEnds"
	| "validatedTargetPathIndices"
	| "validatedTargetStarts"
	| "validatedTargetEnds"
	| "validatedMappingKinds"
>;

const ARRAY_BUFFER_SLICE = ArrayBuffer.prototype.slice;
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"resizable",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"byteLength",
)?.get;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"buffer",
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"byteOffset",
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"byteLength",
)?.get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"length",
)?.get;
const PORT_SLOT_CATALOG_KEYS = Object.freeze(["OHB", "EQ", "STK"] as const);
const PORT_SLOT_ARTIFACT_KEYS = Object.freeze([
	"revision",
	"portType",
	"slotCount",
	"slots",
	"spatialIndex",
] as const);
const PORT_SLOT_SLOT_KEYS = Object.freeze([
	"revision",
	"portType",
	"count",
	"legalCount",
	"sourcePathOffsets",
	"sourcePathIndices",
	"finalPathIndices",
	"routeXs",
	"routeZs",
	"routeFromDirections",
	"routeToDirections",
	"stationMillimeters",
	"sides",
	"lateralOffsetMillimeters",
	"directions",
	"portTypes",
	"railPositions",
	"worldPositions",
	"tangents",
	"yawRadians",
	"statuses",
	"conflictingPortIds",
	"conflictingRailPathIndices",
] as const);
const PORT_SLOT_SPATIAL_KEYS = Object.freeze([
	"slotCount",
	"chunkSizeMeters",
	"chunkCoordinates",
	"chunkOffsets",
	"slotIndices",
] as const);
const PORT_SLOT_VIEW_CONSTRUCTORS = Object.freeze({
	sourcePathOffsets: Uint32Array,
	sourcePathIndices: Uint32Array,
	finalPathIndices: Uint32Array,
	routeXs: Int32Array,
	routeZs: Int32Array,
	routeFromDirections: Uint8Array,
	routeToDirections: Uint8Array,
	stationMillimeters: Int32Array,
	sides: Uint8Array,
	lateralOffsetMillimeters: Uint16Array,
	directions: Uint8Array,
	portTypes: Uint8Array,
	railPositions: Float32Array,
	worldPositions: Float32Array,
	tangents: Float32Array,
	yawRadians: Float32Array,
	statuses: Uint8Array,
	conflictingPortIds: Int32Array,
	conflictingRailPathIndices: Int32Array,
});
const PORT_SLOT_SPATIAL_VIEW_CONSTRUCTORS = Object.freeze({
	chunkCoordinates: Int32Array,
	chunkOffsets: Uint32Array,
	slotIndices: Uint32Array,
});
const INVALID_PREPARED_PORT_SLOT_AVAILABILITY = Object.freeze({
	status: PORT_SLOT_STATUS.ATTACHMENT_INVALID,
	conflictingPortId: 0,
	conflictingEquipmentGroupId: 0,
}) satisfies PortSlotAvailabilityResult;

class BoundPreparedPortSlotAvailabilityIndex
	extends PortSlotAvailabilityIndex
	implements PreparedPortSlotAvailabilityIndex
{
	readonly kind = "prepared-port-slot-availability-index" as const;
	private readonly artifacts: PortSlotPreparedArtifacts;

	constructor(
		layout: CompiledPhysicalLayout,
		state: PortEquipmentState,
		artifacts: PortSlotPreparedArtifacts,
		resolvedPositions?: PortEquipmentResolvedPositionCapability,
	) {
		super(layout, state, artifacts.portType, resolvedPositions);
		this.artifacts = artifacts;
	}

	matchesPreparedArtifacts(artifacts: PortSlotPreparedArtifacts): boolean {
		return this.artifacts === artifacts;
	}

	override statusFor(
		slots: CompiledPortSlots,
		row: number,
		ignoredPortId = 0,
		ignoredEquipmentGroupId = 0,
	): PortSlotAvailabilityResult {
		if (!Number.isInteger(row) || row < 0 || row >= this.artifacts.slotCount) {
			throw new RangeError(`Port slot row ${row} is outside the compiled slot buffer.`);
		}
		if (
			slots !== this.artifacts.slots ||
			!portSlotPreparedArtifactRowHasValidatedAvailabilityInputs(this.artifacts, row)
		) {
			return INVALID_PREPARED_PORT_SLOT_AVAILABILITY;
		}
		return super.statusFor(slots, row, ignoredPortId, ignoredEquipmentGroupId);
	}

	override conflictingEquipmentGroupForStkRows(
		slots: CompiledPortSlots,
		rows: readonly number[],
		ignoredEquipmentGroupId = 0,
	): number {
		if (slots !== this.artifacts.slots) {
			throw new Error("STK body availability is not bound to these prepared port slots.");
		}
		for (const row of rows) {
			if (!Number.isInteger(row) || row < 0 || row >= this.artifacts.slotCount) {
				throw new RangeError(`Port slot row ${row} is outside the compiled slot buffer.`);
			}
			if (!portSlotPreparedArtifactRowHasValidatedAvailabilityInputs(this.artifacts, row)) {
				throw new Error(
					`Prepared port slot row ${row} availability inputs changed after validation.`,
				);
			}
		}
		return super.conflictingEquipmentGroupForStkRows(slots, rows, ignoredEquipmentGroupId);
	}
}

/** Worker-prepared immutable slot geometry; live port occupancy is a separate derived index. */
export function compilePortSlotPreparedArtifacts(
	layout: CompiledPhysicalLayout,
	portType: PortType = "OHB",
): PortSlotPreparedArtifacts {
	return compilePortSlotPreparedArtifactsWithPhysicalProof(
		layout,
		portType,
		validatedPhysicalSourceRows(layout),
	);
}

function compilePortSlotPreparedArtifactsWithPhysicalProof(
	layout: CompiledPhysicalLayout,
	portType: PortType,
	physicalSourceRows: ValidatedPhysicalSourceRows,
): PortSlotPreparedArtifacts {
	const slots = compileBasePortSlots(layout, portType);
	const artifacts = Object.freeze({
		revision: layout.revision,
		portType,
		slotCount: slots.count,
		slots,
		spatialIndex: compilePortSlotSpatialIndex(slots),
	});
	validatePortSlotPreparedArtifacts(layout, artifacts);
	sealValidatedRows(artifacts, physicalSourceRows);
	sourceLayoutsByPreparedArtifacts.set(artifacts, layout);
	return artifacts;
}

export function portSlotPreparedArtifactsHaveExactSourceLayout(
	artifacts: PortSlotPreparedArtifacts,
	layout: CompiledPhysicalLayout,
): boolean {
	return sourceLayoutsByPreparedArtifacts.get(artifacts) === layout;
}

/**
 * Bind dynamic occupancy to one exact prepared catalog without changing the raw compiler index used
 * by synchronous compile and synthetic workflows.
 */
export function createPreparedPortSlotAvailabilityIndex(
	layout: CompiledPhysicalLayout,
	artifacts: PortSlotPreparedArtifacts,
	state: PortEquipmentState,
	resolvedPositions?: PortEquipmentResolvedPositionCapability,
): PreparedPortSlotAvailabilityIndex {
	if (!portSlotPreparedArtifactsHaveExactSourceLayout(artifacts, layout)) {
		throw new Error("Prepared port slot availability does not share the physical-layout identity.");
	}
	return new BoundPreparedPortSlotAvailabilityIndex(layout, state, artifacts, resolvedPositions);
}

/**
 * Detect post-validation mutation of one prepared row's source identity/base status or the exact
 * physical source row it was validated against. Attachment callers still recompute all remaining
 * row geometry from that same layout.
 */
export function portSlotPreparedArtifactRowHasValidatedIdentity(
	artifacts: PortSlotPreparedArtifacts,
	row: number,
): boolean {
	return portSlotPreparedArtifactRowHasValidatedAvailabilityInputs(artifacts, row);
}

/** Bounded local check for every mutable prepared-row/remap/path input consumed by live UI. */
export function portSlotPreparedArtifactRowHasValidatedAvailabilityInputs(
	artifacts: PortSlotPreparedArtifacts,
	row: number,
): boolean {
	const validated = validatedRowsByPreparedArtifacts.get(artifacts);
	const layout = sourceLayoutsByPreparedArtifacts.get(artifacts);
	const slots = artifacts.slots;
	if (
		validated === undefined ||
		layout === undefined ||
		!Number.isInteger(row) ||
		row < 0 ||
		row >= slots.count
	) {
		return false;
	}
	if (
		validated.sourcePathIndices.length !== slots.count ||
		validated.statuses.length !== slots.count ||
		validated.conflictingPortIds.length !== slots.count ||
		validated.conflictingRailPathIndices.length !== slots.count ||
		!PORT_TYPES.includes(artifacts.portType) ||
		slots.portType !== artifacts.portType
	) {
		return false;
	}
	const sourcePathIndex = validated.sourcePathIndices[row] as number;
	if (
		sourcePathIndex !== (slots.sourcePathIndices[row] as number) ||
		!physicalSourceRowMatchesValidation(layout, validated.physicalSourceRows, sourcePathIndex)
	) {
		return false;
	}
	const proof = validated.physicalSourceRows;
	const sourceCellOffset = sourcePathIndex * 2;
	const worldOffset = row * 2;
	const policy = OPENFAB_PORT_SLOT_POLICIES[artifacts.portType];
	const expectedSide = policy.sides[row % policy.sides.length];
	const expectedSideCode = PORT_SIDES.indexOf(expectedSide);
	const expectedLateralOffsetMillimeters =
		expectedSide === "CENTER" ? 0 : policy.lateralOffsetMillimeters;
	const expectedDirectionCode = PORT_DIRECTIONS.indexOf("WITH_TRAVEL");
	const expectedPortTypeCode = PORT_TYPES.indexOf(artifacts.portType);
	const expectedStationMillimeters = metersToMillimeters(
		(proof.validatedSourcePathCanonicalStarts[sourcePathIndex] as number) +
			(proof.validatedSourcePathLengths[sourcePathIndex] as number) * 0.5,
	);
	const rowValuesMatch =
		(validated.statuses[row] as number) === (slots.statuses[row] as number) &&
		(validated.conflictingPortIds[row] as number) === (slots.conflictingPortIds[row] as number) &&
		(validated.conflictingRailPathIndices[row] as number) ===
			(slots.conflictingRailPathIndices[row] as number) &&
		(proof.validatedSourcePathCells[sourceCellOffset] as number) ===
			(slots.routeXs[row] as number) &&
		(proof.validatedSourcePathCells[sourceCellOffset + 1] as number) ===
			(slots.routeZs[row] as number) &&
		(proof.validatedSourcePathFromDirections[sourcePathIndex] as number) ===
			(slots.routeFromDirections[row] as number) &&
		(proof.validatedSourcePathToDirections[sourcePathIndex] as number) ===
			(slots.routeToDirections[row] as number) &&
		expectedStationMillimeters === (slots.stationMillimeters[row] as number) &&
		expectedSideCode === (slots.sides[row] as number) &&
		expectedLateralOffsetMillimeters === (slots.lateralOffsetMillimeters[row] as number) &&
		expectedDirectionCode === (slots.directions[row] as number) &&
		expectedPortTypeCode === (slots.portTypes[row] as number);
	if (!rowValuesMatch) return false;
	const resolution = resolvePortAttachmentAtSourcePath(
		layout,
		{
			route: {
				kind: "CARDINAL_CELL",
				x: proof.validatedSourcePathCells[sourceCellOffset] as number,
				z: proof.validatedSourcePathCells[sourceCellOffset + 1] as number,
				from: proof.validatedSourcePathFromDirections[sourcePathIndex] as Direction,
				to: proof.validatedSourcePathToDirections[sourcePathIndex] as Direction,
			},
			stationMillimeters: expectedStationMillimeters,
			side: expectedSide,
			lateralOffsetMillimeters: expectedLateralOffsetMillimeters,
			direction: "WITH_TRAVEL",
		},
		sourcePathIndex,
	);
	if (!resolution.ok) {
		return (
			(slots.finalPathIndices[row] as number) === 0 &&
			Object.is(slots.railPositions[worldOffset], 0) &&
			Object.is(slots.railPositions[worldOffset + 1], 0) &&
			Object.is(slots.worldPositions[worldOffset], 0) &&
			Object.is(slots.worldPositions[worldOffset + 1], 0) &&
			Object.is(slots.tangents[worldOffset], 0) &&
			Object.is(slots.tangents[worldOffset + 1], 0) &&
			Object.is(slots.yawRadians[row], 0)
		);
	}
	return (
		resolution.finalPathIndex === (slots.finalPathIndices[row] as number) &&
		Object.is(Math.fround(resolution.railXMeters), slots.railPositions[worldOffset]) &&
		Object.is(Math.fround(resolution.railZMeters), slots.railPositions[worldOffset + 1]) &&
		Object.is(Math.fround(resolution.worldXMeters), slots.worldPositions[worldOffset]) &&
		Object.is(Math.fround(resolution.worldZMeters), slots.worldPositions[worldOffset + 1]) &&
		Object.is(Math.fround(resolution.tangentX), slots.tangents[worldOffset]) &&
		Object.is(Math.fround(resolution.tangentZ), slots.tangents[worldOffset + 1]) &&
		Object.is(Math.fround(resolution.yawRadians), slots.yawRadians[row])
	);
}

/** Startup/derivation Worker output for every static equipment authoring tool. */
export function compilePortSlotPreparedArtifactCatalog(
	layout: CompiledPhysicalLayout,
): PortSlotPreparedArtifactCatalog {
	const physicalSourceRows = validatedPhysicalSourceRows(layout);
	const catalog = Object.freeze({
		OHB: compilePortSlotPreparedArtifactsWithPhysicalProof(layout, "OHB", physicalSourceRows),
		EQ: compilePortSlotPreparedArtifactsWithPhysicalProof(layout, "EQ", physicalSourceRows),
		STK: compilePortSlotPreparedArtifactsWithPhysicalProof(layout, "STK", physicalSourceRows),
	});
	validatePortSlotPreparedArtifactCatalog(layout, catalog);
	return catalog;
}

export function portSlotPreparedArtifactsMatch(
	layout: CompiledPhysicalLayout,
	artifacts: PortSlotPreparedArtifacts,
): boolean {
	return (
		artifacts.revision === layout.revision &&
		artifacts.portType === artifacts.slots.portType &&
		artifacts.slotCount === artifacts.slots.count &&
		artifacts.slots.revision === layout.revision &&
		artifacts.slots.sourcePathOffsets.length === layout.pathIntervalRemap.sourcePathCount + 1 &&
		artifacts.spatialIndex.slotCount === artifacts.slotCount
	);
}

export function validatePortSlotPreparedArtifacts(
	layout: CompiledPhysicalLayout,
	artifacts: PortSlotPreparedArtifacts,
): void {
	if (!portSlotPreparedArtifactsMatch(layout, artifacts)) {
		throw new Error("Prepared port slot artifacts do not match the physical layout.");
	}
	for (const _step of portSlotSemanticValidationSteps(layout, artifacts)) {
		void _step;
		// Exhaust the bounded semantic validator synchronously at trusted compile boundaries.
	}
	validatePortSlotSpatialIndex(artifacts.slots, artifacts.spatialIndex);
}

/**
 * Terminally adopt one exact Worker catalog, then fingerprint, semantically validate, and bind its
 * private identity before returning it. Checkpoint callbacks never receive the adopted buffers.
 */
export async function adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
	layout: CompiledPhysicalLayout,
	source: PortSlotPreparedArtifactCatalog,
	physicalFingerprint: string,
	expectedArtifactFingerprint: string,
	checkpoint: () => Promise<void>,
	checkCancelled: () => void,
	preparedEnvelopeSpatialIndex?: RailEnvelopeSpatialIndexSnapshot,
): Promise<PortSlotPreparedArtifactCatalog> {
	checkCancelled();
	const catalog = adoptExactPortSlotPreparedArtifactCatalog(layout, source, checkCancelled);
	checkCancelled();
	const cooperativeCheckpoint = async (): Promise<void> => {
		checkCancelled();
		await checkpoint();
		checkCancelled();
	};
	const physicalSourceRows = await validatedPhysicalSourceRowsCooperatively(
		layout,
		cooperativeCheckpoint,
	);
	const fingerprint = await checksumPortSlotPreparedArtifactCatalogCooperatively(
		catalog,
		physicalFingerprint,
		cooperativeCheckpoint,
	);
	checkCancelled();
	if (fingerprint !== expectedArtifactFingerprint) {
		throw new Error("Prepared port slot artifact catalog fingerprint mismatch.");
	}
	const exclusionMask = await compilePortSlotExclusionMaskCooperatively(
		layout,
		cooperativeCheckpoint,
	);
	checkCancelled();
	const railClearance = preparedEnvelopeSpatialIndex
		? await PortSlotRailClearanceIndex.fromSnapshotCooperatively(
				layout,
				preparedEnvelopeSpatialIndex,
				cooperativeCheckpoint,
			)
		: new PortSlotRailClearanceIndex(layout);
	checkCancelled();
	for (const portType of PORT_TYPES) {
		let rowsSinceCheckpoint = 0;
		for (const _step of portSlotSemanticValidationSteps(
			layout,
			catalog[portType],
			exclusionMask,
			railClearance,
		)) {
			void _step;
			rowsSinceCheckpoint++;
			if ((rowsSinceCheckpoint & 15) === 0) await cooperativeCheckpoint();
		}
		await preparePortSlotSpatialIndexCooperatively(
			catalog[portType].slots,
			catalog[portType].spatialIndex,
			cooperativeCheckpoint,
		);
	}
	let validatedPhysicalRowCount = 0;
	for (const _step of validatedPhysicalSourceRowSteps(layout, physicalSourceRows)) {
		void _step;
		validatedPhysicalRowCount++;
		if (
			(validatedPhysicalRowCount & 15) === 0 &&
			validatedPhysicalRowCount < physicalSourceRows.sourcePathCount
		) {
			await cooperativeCheckpoint();
		}
	}
	checkCancelled();
	for (const portType of PORT_TYPES) {
		const artifacts = catalog[portType];
		const existingLayout = sourceLayoutsByPreparedArtifacts.get(artifacts);
		if (existingLayout !== undefined && existingLayout !== layout) {
			throw new Error("Prepared port slot artifacts already belong to another physical layout.");
		}
	}
	for (const portType of PORT_TYPES) {
		checkCancelled();
		await sealValidatedRowsCooperatively(
			catalog[portType],
			physicalSourceRows,
			cooperativeCheckpoint,
		);
		sourceLayoutsByPreparedArtifacts.set(catalog[portType], layout);
	}
	checkCancelled();
	return catalog;
}

function sealValidatedRows(
	artifacts: PortSlotPreparedArtifacts,
	physicalSourceRows: ValidatedPhysicalSourceRows,
): void {
	validatedRowsByPreparedArtifacts.set(
		artifacts,
		Object.freeze({
			sourcePathIndices: copyExactProofView(artifacts.slots.sourcePathIndices),
			statuses: copyExactProofView(artifacts.slots.statuses),
			conflictingPortIds: copyExactProofView(artifacts.slots.conflictingPortIds),
			conflictingRailPathIndices: copyExactProofView(artifacts.slots.conflictingRailPathIndices),
			physicalSourceRows,
		}),
	);
}

async function sealValidatedRowsCooperatively(
	artifacts: PortSlotPreparedArtifacts,
	physicalSourceRows: ValidatedPhysicalSourceRows,
	checkpoint: () => Promise<void>,
): Promise<void> {
	const slots = artifacts.slots;
	const proof = Object.freeze({
		sourcePathIndices: await copyExactProofViewCooperatively(slots.sourcePathIndices, checkpoint),
		statuses: await copyExactProofViewCooperatively(slots.statuses, checkpoint),
		conflictingPortIds: await copyExactProofViewCooperatively(slots.conflictingPortIds, checkpoint),
		conflictingRailPathIndices: await copyExactProofViewCooperatively(
			slots.conflictingRailPathIndices,
			checkpoint,
		),
		physicalSourceRows,
	});
	validatedRowsByPreparedArtifacts.set(artifacts, proof);
}

/**
 * One exact, layout-scoped copy of only the source-row columns read while creating an attachment.
 * All three equipment catalogs share it, so 100,000 source paths retain about 2 MiB rather than a
 * second copy of the full physical layout or one proof per slot/catalog.
 */
function validatedPhysicalSourceRows(layout: CompiledPhysicalLayout): ValidatedPhysicalSourceRows {
	const captured = capturePhysicalSourceRows(layout);
	const proof = Object.freeze({
		...captured,
		validatedSourcePathCells: copyExactProofView(captured.sourcePathCells),
		validatedSourcePathKinds: copyExactProofView(captured.sourcePathKinds),
		validatedSourcePathFromDirections: copyExactProofView(captured.sourcePathFromDirections),
		validatedSourcePathToDirections: copyExactProofView(captured.sourcePathToDirections),
		validatedSourceIdentityKinds: copyExactProofView(captured.sourceIdentityKinds),
		validatedSourcePathCanonicalStarts: copyExactProofView(captured.sourcePathCanonicalStarts),
		validatedSourcePathLengths: copyExactProofView(captured.sourcePathLengths),
		validatedSourcePathOffsets: copyExactProofView(captured.sourcePathOffsets),
		validatedSourceStarts: copyExactProofView(captured.sourceStarts),
		validatedSourceEnds: copyExactProofView(captured.sourceEnds),
		validatedTargetPathIndices: copyExactProofView(captured.targetPathIndices),
		validatedTargetStarts: copyExactProofView(captured.targetStarts),
		validatedTargetEnds: copyExactProofView(captured.targetEnds),
		validatedMappingKinds: copyExactProofView(captured.mappingKinds),
	});
	return proof;
}

async function validatedPhysicalSourceRowsCooperatively(
	layout: CompiledPhysicalLayout,
	checkpoint: () => Promise<void>,
): Promise<ValidatedPhysicalSourceRows> {
	const captured = capturePhysicalSourceRows(layout);
	const proof = Object.freeze({
		...captured,
		validatedSourcePathCells: await copyExactProofViewCooperatively(
			captured.sourcePathCells,
			checkpoint,
		),
		validatedSourcePathKinds: await copyExactProofViewCooperatively(
			captured.sourcePathKinds,
			checkpoint,
		),
		validatedSourcePathFromDirections: await copyExactProofViewCooperatively(
			captured.sourcePathFromDirections,
			checkpoint,
		),
		validatedSourcePathToDirections: await copyExactProofViewCooperatively(
			captured.sourcePathToDirections,
			checkpoint,
		),
		validatedSourceIdentityKinds: await copyExactProofViewCooperatively(
			captured.sourceIdentityKinds,
			checkpoint,
		),
		validatedSourcePathCanonicalStarts: await copyExactProofViewCooperatively(
			captured.sourcePathCanonicalStarts,
			checkpoint,
		),
		validatedSourcePathLengths: await copyExactProofViewCooperatively(
			captured.sourcePathLengths,
			checkpoint,
		),
		validatedSourcePathOffsets: await copyExactProofViewCooperatively(
			captured.sourcePathOffsets,
			checkpoint,
		),
		validatedSourceStarts: await copyExactProofViewCooperatively(captured.sourceStarts, checkpoint),
		validatedSourceEnds: await copyExactProofViewCooperatively(captured.sourceEnds, checkpoint),
		validatedTargetPathIndices: await copyExactProofViewCooperatively(
			captured.targetPathIndices,
			checkpoint,
		),
		validatedTargetStarts: await copyExactProofViewCooperatively(captured.targetStarts, checkpoint),
		validatedTargetEnds: await copyExactProofViewCooperatively(captured.targetEnds, checkpoint),
		validatedMappingKinds: await copyExactProofViewCooperatively(captured.mappingKinds, checkpoint),
	});
	return proof;
}

function capturePhysicalSourceRows(layout: CompiledPhysicalLayout): CapturedPhysicalSourceRows {
	const remap = exactOwnDataValue(
		layout,
		"pathIntervalRemap",
		"physical layout remap",
	) as CompiledPhysicalLayout["pathIntervalRemap"];
	const sourcePathCount = exactOwnDataValue(remap, "sourcePathCount", "physical source path count");
	if (
		!Number.isSafeInteger(sourcePathCount) ||
		(sourcePathCount as number) < 0 ||
		(sourcePathCount as number) > PORT_SLOT_MAX_ROWS
	) {
		throw new Error("Prepared port slot physical source row proof is invalid.");
	}
	const count = sourcePathCount as number;
	const sourcePathCells = exactPhysicalProofView<Int32Array>(
		remap,
		"sourcePathCells",
		Int32Array.prototype,
		count * 2,
	);
	const sourcePathKinds = exactPhysicalProofView<Uint8Array>(
		remap,
		"sourcePathKinds",
		Uint8Array.prototype,
		count,
	);
	const sourcePathFromDirections = exactPhysicalProofView<Uint8Array>(
		remap,
		"sourcePathFromDirections",
		Uint8Array.prototype,
		count,
	);
	const sourcePathToDirections = exactPhysicalProofView<Uint8Array>(
		remap,
		"sourcePathToDirections",
		Uint8Array.prototype,
		count,
	);
	const sourceIdentityKinds = exactPhysicalProofView<Uint8Array>(
		remap,
		"sourceIdentityKinds",
		Uint8Array.prototype,
		count,
	);
	const sourcePathCanonicalStarts = exactPhysicalProofView<Float32Array>(
		remap,
		"sourcePathCanonicalStarts",
		Float32Array.prototype,
		count,
	);
	const sourcePathLengths = exactPhysicalProofView<Float32Array>(
		remap,
		"sourcePathLengths",
		Float32Array.prototype,
		count,
	);
	const intervalCount = exactOwnDataValue(remap, "count", "physical interval count");
	if (
		!Number.isSafeInteger(intervalCount) ||
		(intervalCount as number) < 0 ||
		(intervalCount as number) > PORT_SLOT_MAX_ROWS * 8
	) {
		throw new Error("Prepared port slot physical interval proof is invalid.");
	}
	const mappingCount = intervalCount as number;
	const sourcePathOffsets = exactPhysicalProofView<Uint32Array>(
		remap,
		"sourcePathOffsets",
		Uint32Array.prototype,
		count + 1,
	);
	const sourceStarts = exactPhysicalProofView<Float32Array>(
		remap,
		"sourceStarts",
		Float32Array.prototype,
		mappingCount,
	);
	const sourceEnds = exactPhysicalProofView<Float32Array>(
		remap,
		"sourceEnds",
		Float32Array.prototype,
		mappingCount,
	);
	const targetPathIndices = exactPhysicalProofView<Uint32Array>(
		remap,
		"targetPathIndices",
		Uint32Array.prototype,
		mappingCount,
	);
	const targetStarts = exactPhysicalProofView<Float32Array>(
		remap,
		"targetStarts",
		Float32Array.prototype,
		mappingCount,
	);
	const targetEnds = exactPhysicalProofView<Float32Array>(
		remap,
		"targetEnds",
		Float32Array.prototype,
		mappingCount,
	);
	const mappingKinds = exactPhysicalProofView<Uint8Array>(
		remap,
		"mappingKinds",
		Uint8Array.prototype,
		mappingCount,
	);
	const paths = exactOwnDataValue(
		layout,
		"paths",
		"physical final paths",
	) as CompiledPhysicalLayout["paths"];
	const pathCount = exactOwnDataValue(paths, "pathCount", "physical final path count");
	const pointCount = exactOwnDataValue(paths, "pointCount", "physical final point count");
	if (
		!Number.isSafeInteger(pathCount) ||
		(pathCount as number) < 0 ||
		(pathCount as number) > PORT_SLOT_MAX_ROWS ||
		!Number.isSafeInteger(pointCount) ||
		(pointCount as number) < 0 ||
		(pointCount as number) > PORT_SLOT_MAX_ROWS * 64
	) {
		throw new Error("Prepared port slot final path proof is invalid.");
	}
	const finalPathCount = pathCount as number;
	const finalPointCount = pointCount as number;
	const pathPositions = exactPhysicalProofView<Float32Array>(
		paths,
		"positions",
		Float32Array.prototype,
		finalPointCount * 2,
	);
	const pathTangents = exactPhysicalProofView<Float32Array>(
		paths,
		"tangents",
		Float32Array.prototype,
		finalPointCount * 2,
	);
	const pathDistances = exactPhysicalProofView<Float32Array>(
		paths,
		"distances",
		Float32Array.prototype,
		finalPointCount,
	);
	const pathOffsets = exactPhysicalProofView<Uint32Array>(
		paths,
		"offsets",
		Uint32Array.prototype,
		finalPathCount + 1,
	);
	const pathKinds = exactPhysicalProofView<Uint8Array>(
		paths,
		"kinds",
		Uint8Array.prototype,
		finalPathCount,
	);
	const pathLengths = exactPhysicalProofView<Float32Array>(
		paths,
		"lengths",
		Float32Array.prototype,
		finalPathCount,
	);
	return Object.freeze({
		remap,
		sourcePathCount: count,
		sourcePathCells,
		sourcePathKinds,
		sourcePathFromDirections,
		sourcePathToDirections,
		sourceIdentityKinds,
		sourcePathCanonicalStarts,
		sourcePathLengths,
		sourcePathOffsets,
		sourceStarts,
		sourceEnds,
		targetPathIndices,
		targetStarts,
		targetEnds,
		mappingKinds,
		paths,
		pathPositions,
		pathTangents,
		pathDistances,
		pathOffsets,
		pathKinds,
		pathLengths,
	});
}

function exactOwnDataValue(value: object, key: string, label: string): unknown {
	let descriptor: PropertyDescriptor | undefined;
	try {
		descriptor = Object.getOwnPropertyDescriptor(value, key);
	} catch {
		throw new Error(`Prepared port slot ${label} is invalid.`);
	}
	if (descriptor === undefined || !("value" in descriptor)) {
		throw new Error(`Prepared port slot ${label} is invalid.`);
	}
	return descriptor.value;
}

function exactPhysicalProofView<View extends Int32Array | Uint32Array | Uint8Array | Float32Array>(
	record: object,
	key: string,
	expectedPrototype: object,
	expectedLength: number,
): View {
	const value = exactOwnDataValue(record, key, `physical ${key}`);
	if (
		!ArrayBuffer.isView(value) ||
		Object.getPrototypeOf(value) !== expectedPrototype ||
		capturedTypedArrayLength(value, `physical ${key}`) !== expectedLength
	) {
		throw new Error(`Prepared port slot physical ${key} is invalid.`);
	}
	return value as View;
}

interface IntrinsicPortSlotTypedArrayState {
	readonly buffer: ArrayBufferLike;
	readonly byteOffset: number;
	readonly byteLength: number;
}

function intrinsicPortSlotTypedArrayState(value: object): IntrinsicPortSlotTypedArrayState | null {
	if (
		TYPED_ARRAY_BUFFER_GETTER === undefined ||
		TYPED_ARRAY_BYTE_OFFSET_GETTER === undefined ||
		TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined
	) {
		return null;
	}
	try {
		const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
		const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []);
		const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
		if (
			typeof buffer !== "object" ||
			buffer === null ||
			!Number.isSafeInteger(byteOffset) ||
			byteOffset < 0 ||
			!Number.isSafeInteger(byteLength) ||
			byteLength < 0
		) {
			return null;
		}
		return { buffer, byteOffset, byteLength };
	} catch {
		return null;
	}
}

function copyExactProofView<
	View extends Int32Array | Uint32Array | Uint16Array | Uint8Array | Float32Array,
>(view: View): View {
	const state = intrinsicPortSlotTypedArrayState(view);
	if (state === null || !(state.buffer instanceof ArrayBuffer)) {
		throw new Error("Prepared port slot private row proof ownership is invalid.");
	}
	let buffer: ArrayBuffer;
	try {
		buffer = Reflect.apply(ARRAY_BUFFER_SLICE, state.buffer, [
			state.byteOffset,
			state.byteOffset + state.byteLength,
		]);
	} catch {
		throw new Error("Prepared port slot private row proof ownership is invalid.");
	}
	const prototype = Object.getPrototypeOf(view);
	if (prototype === Int32Array.prototype) return new Int32Array(buffer) as View;
	if (prototype === Uint32Array.prototype) return new Uint32Array(buffer) as View;
	if (prototype === Uint16Array.prototype) return new Uint16Array(buffer) as View;
	if (prototype === Uint8Array.prototype) return new Uint8Array(buffer) as View;
	if (prototype === Float32Array.prototype) return new Float32Array(buffer) as View;
	throw new Error("Prepared port slot private row proof type is invalid.");
}

async function copyExactProofViewCooperatively<
	View extends Int32Array | Uint32Array | Uint16Array | Uint8Array | Float32Array,
>(view: View, checkpoint: () => Promise<void>): Promise<View> {
	const copy = copyExactProofView(view);
	await checkpoint();
	return copy;
}

function* validatedPhysicalSourceRowSteps(
	layout: CompiledPhysicalLayout,
	proof: ValidatedPhysicalSourceRows,
): Generator<void> {
	if (!physicalSourceProofHasExactIdentities(layout, proof)) {
		throw new Error("Prepared port slot physical source proof identity changed after validation.");
	}
	for (let sourcePathIndex = 0; sourcePathIndex < proof.sourcePathCount; sourcePathIndex++) {
		if (!physicalSourceRowValuesMatchValidation(proof, sourcePathIndex)) {
			throw new Error(
				`Prepared port slot physical source row ${sourcePathIndex} changed after validation.`,
			);
		}
		yield;
	}
}

function physicalSourceRowMatchesValidation(
	layout: CompiledPhysicalLayout,
	proof: ValidatedPhysicalSourceRows,
	sourcePathIndex: number,
): boolean {
	return (
		physicalSourceProofHasExactIdentities(layout, proof) &&
		physicalSourceRowValuesMatchValidation(proof, sourcePathIndex)
	);
}

function physicalSourceProofHasExactIdentities(
	layout: CompiledPhysicalLayout,
	proof: ValidatedPhysicalSourceRows,
): boolean {
	try {
		return (
			exactOwnDataValue(layout, "pathIntervalRemap", "physical layout remap") === proof.remap &&
			exactOwnDataValue(layout, "paths", "physical final paths") === proof.paths &&
			exactOwnDataValue(proof.remap, "sourcePathCount", "physical source path count") ===
				proof.sourcePathCount &&
			exactOwnDataValue(proof.remap, "count", "physical interval count") ===
				proof.sourceStarts.length &&
			exactOwnDataValue(proof.remap, "sourcePathCells", "physical sourcePathCells") ===
				proof.sourcePathCells &&
			exactOwnDataValue(proof.remap, "sourcePathKinds", "physical sourcePathKinds") ===
				proof.sourcePathKinds &&
			exactOwnDataValue(
				proof.remap,
				"sourcePathFromDirections",
				"physical sourcePathFromDirections",
			) === proof.sourcePathFromDirections &&
			exactOwnDataValue(
				proof.remap,
				"sourcePathToDirections",
				"physical sourcePathToDirections",
			) === proof.sourcePathToDirections &&
			exactOwnDataValue(proof.remap, "sourceIdentityKinds", "physical sourceIdentityKinds") ===
				proof.sourceIdentityKinds &&
			exactOwnDataValue(
				proof.remap,
				"sourcePathCanonicalStarts",
				"physical sourcePathCanonicalStarts",
			) === proof.sourcePathCanonicalStarts &&
			exactOwnDataValue(proof.remap, "sourcePathLengths", "physical sourcePathLengths") ===
				proof.sourcePathLengths &&
			exactOwnDataValue(proof.remap, "sourcePathOffsets", "physical sourcePathOffsets") ===
				proof.sourcePathOffsets &&
			exactOwnDataValue(proof.remap, "sourceStarts", "physical sourceStarts") ===
				proof.sourceStarts &&
			exactOwnDataValue(proof.remap, "sourceEnds", "physical sourceEnds") === proof.sourceEnds &&
			exactOwnDataValue(proof.remap, "targetPathIndices", "physical targetPathIndices") ===
				proof.targetPathIndices &&
			exactOwnDataValue(proof.remap, "targetStarts", "physical targetStarts") ===
				proof.targetStarts &&
			exactOwnDataValue(proof.remap, "targetEnds", "physical targetEnds") === proof.targetEnds &&
			exactOwnDataValue(proof.remap, "mappingKinds", "physical mappingKinds") ===
				proof.mappingKinds &&
			exactOwnDataValue(proof.paths, "positions", "physical path positions") ===
				proof.pathPositions &&
			exactOwnDataValue(proof.paths, "tangents", "physical path tangents") === proof.pathTangents &&
			exactOwnDataValue(proof.paths, "distances", "physical path distances") ===
				proof.pathDistances &&
			exactOwnDataValue(proof.paths, "offsets", "physical path offsets") === proof.pathOffsets &&
			exactOwnDataValue(proof.paths, "kinds", "physical path kinds") === proof.pathKinds &&
			exactOwnDataValue(proof.paths, "lengths", "physical path lengths") === proof.pathLengths &&
			exactOwnDataValue(proof.paths, "pathCount", "physical final path count") ===
				proof.pathKinds.length &&
			exactOwnDataValue(proof.paths, "pointCount", "physical final point count") ===
				proof.pathDistances.length
		);
	} catch {
		return false;
	}
}

function physicalSourceRowValuesMatchValidation(
	proof: ValidatedPhysicalSourceRows,
	sourcePathIndex: number,
): boolean {
	if (
		!Number.isInteger(sourcePathIndex) ||
		sourcePathIndex < 0 ||
		sourcePathIndex >= proof.sourcePathCount
	) {
		return false;
	}
	const cellOffset = sourcePathIndex * 2;
	if (
		!(
			(proof.sourcePathCells[cellOffset] as number) ===
				(proof.validatedSourcePathCells[cellOffset] as number) &&
			(proof.sourcePathCells[cellOffset + 1] as number) ===
				(proof.validatedSourcePathCells[cellOffset + 1] as number) &&
			(proof.sourcePathKinds[sourcePathIndex] as number) ===
				(proof.validatedSourcePathKinds[sourcePathIndex] as number) &&
			(proof.sourcePathFromDirections[sourcePathIndex] as number) ===
				(proof.validatedSourcePathFromDirections[sourcePathIndex] as number) &&
			(proof.sourcePathToDirections[sourcePathIndex] as number) ===
				(proof.validatedSourcePathToDirections[sourcePathIndex] as number) &&
			(proof.sourceIdentityKinds[sourcePathIndex] as number) ===
				(proof.validatedSourceIdentityKinds[sourcePathIndex] as number) &&
			Object.is(
				proof.sourcePathCanonicalStarts[sourcePathIndex] as number,
				proof.validatedSourcePathCanonicalStarts[sourcePathIndex] as number,
			) &&
			Object.is(
				proof.sourcePathLengths[sourcePathIndex] as number,
				proof.validatedSourcePathLengths[sourcePathIndex] as number,
			)
		)
	) {
		return false;
	}
	const start = proof.sourcePathOffsets[sourcePathIndex] as number;
	const end = proof.sourcePathOffsets[sourcePathIndex + 1] as number;
	if (
		start !== (proof.validatedSourcePathOffsets[sourcePathIndex] as number) ||
		end !== (proof.validatedSourcePathOffsets[sourcePathIndex + 1] as number) ||
		start > end ||
		end > proof.sourceStarts.length
	) {
		return false;
	}
	for (let row = start; row < end; row++) {
		if (
			!Object.is(proof.sourceStarts[row], proof.validatedSourceStarts[row]) ||
			!Object.is(proof.sourceEnds[row], proof.validatedSourceEnds[row]) ||
			proof.targetPathIndices[row] !== proof.validatedTargetPathIndices[row] ||
			!Object.is(proof.targetStarts[row], proof.validatedTargetStarts[row]) ||
			!Object.is(proof.targetEnds[row], proof.validatedTargetEnds[row]) ||
			proof.mappingKinds[row] !== proof.validatedMappingKinds[row]
		) {
			return false;
		}
	}
	return true;
}

export function portSlotPreparedArtifactCatalogMatch(
	layout: CompiledPhysicalLayout,
	catalog: PortSlotPreparedArtifactCatalog,
): boolean {
	return PORT_TYPES.every(
		(portType) =>
			catalog[portType].portType === portType &&
			portSlotPreparedArtifactsMatch(layout, catalog[portType]),
	);
}

export function validatePortSlotPreparedArtifactCatalog(
	layout: CompiledPhysicalLayout,
	catalog: PortSlotPreparedArtifactCatalog,
): void {
	if (!portSlotPreparedArtifactCatalogMatch(layout, catalog)) {
		throw new Error("Prepared port slot artifact catalog does not match the physical layout.");
	}
	for (const portType of PORT_TYPES) {
		validatePortSlotPreparedArtifacts(layout, catalog[portType]);
	}
}

export function checksumPortSlotPreparedArtifacts(
	artifacts: PortSlotPreparedArtifacts,
	physicalFingerprint: string,
): string {
	const { checksum, views } = createPortSlotArtifactChecksum(artifacts, physicalFingerprint);
	checksum.addViews(views);
	return checksum.digest();
}

export async function checksumPortSlotPreparedArtifactsCooperatively(
	artifacts: PortSlotPreparedArtifacts,
	physicalFingerprint: string,
	checkpoint: () => Promise<void>,
): Promise<string> {
	const { checksum, views } = createPortSlotArtifactChecksum(artifacts, physicalFingerprint);
	await checksum.addViewsCooperatively(views, checkpoint);
	return checksum.digest();
}

export function checksumPortSlotPreparedArtifactCatalog(
	catalog: PortSlotPreparedArtifactCatalog,
	physicalFingerprint: string,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([PORT_TYPES.length]);
	checksum.addStrings([
		physicalFingerprint,
		...PORT_TYPES.map((portType) =>
			checksumPortSlotPreparedArtifacts(catalog[portType], physicalFingerprint),
		),
	]);
	return checksum.digest();
}

export async function checksumPortSlotPreparedArtifactCatalogCooperatively(
	catalog: PortSlotPreparedArtifactCatalog,
	physicalFingerprint: string,
	checkpoint: () => Promise<void>,
): Promise<string> {
	const artifactFingerprints: string[] = [];
	for (const portType of PORT_TYPES) {
		artifactFingerprints.push(
			await checksumPortSlotPreparedArtifactsCooperatively(
				catalog[portType],
				physicalFingerprint,
				checkpoint,
			),
		);
	}
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([PORT_TYPES.length]);
	checksum.addStrings([physicalFingerprint, ...artifactFingerprints]);
	return checksum.digest();
}

function createPortSlotArtifactChecksum(
	artifacts: PortSlotPreparedArtifacts,
	physicalFingerprint: string,
): {
	readonly checksum: OrderedTypedChecksum;
	readonly views: readonly ArrayBufferView[];
} {
	const { slots, spatialIndex } = artifacts;
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		artifacts.revision,
		PORT_TYPES.indexOf(artifacts.portType),
		artifacts.slotCount,
		slots.revision,
		PORT_TYPES.indexOf(slots.portType),
		slots.count,
		slots.legalCount,
		spatialIndex.slotCount,
		spatialIndex.chunkSizeMeters,
	]);
	checksum.addStrings([physicalFingerprint]);
	return {
		checksum,
		views: portSlotArtifactViews(artifacts),
	};
}

function portSlotArtifactViews(artifacts: PortSlotPreparedArtifacts): readonly ArrayBufferView[] {
	const { slots, spatialIndex } = artifacts;
	return [
		slots.sourcePathOffsets,
		slots.sourcePathIndices,
		slots.finalPathIndices,
		slots.routeXs,
		slots.routeZs,
		slots.routeFromDirections,
		slots.routeToDirections,
		slots.stationMillimeters,
		slots.sides,
		slots.lateralOffsetMillimeters,
		slots.directions,
		slots.portTypes,
		slots.railPositions,
		slots.worldPositions,
		slots.tangents,
		slots.yawRadians,
		slots.statuses,
		slots.conflictingPortIds,
		slots.conflictingRailPathIndices,
		spatialIndex.chunkCoordinates,
		spatialIndex.chunkOffsets,
		spatialIndex.slotIndices,
	];
}

function adoptExactPortSlotPreparedArtifactCatalog(
	layout: CompiledPhysicalLayout,
	source: PortSlotPreparedArtifactCatalog,
	checkCancelled: () => void,
): PortSlotPreparedArtifactCatalog {
	const sourceCatalog = captureExactOwnDataRecord(source, PORT_SLOT_CATALOG_KEYS, "catalog");
	const buffers: ArrayBuffer[] = [];
	const seenBuffers = new Set<ArrayBuffer>();
	const sourceViews: ArrayBufferView[] = [];
	const canonicalCatalog = {} as Record<PortType, PortSlotPreparedArtifacts>;
	for (const portType of PORT_TYPES) {
		const sourceArtifacts = captureExactOwnDataRecord(
			sourceCatalog[portType],
			PORT_SLOT_ARTIFACT_KEYS,
			`${portType} artifacts`,
		);
		const sourceSlots = captureExactOwnDataRecord(
			sourceArtifacts.slots,
			PORT_SLOT_SLOT_KEYS,
			`${portType} slots`,
		);
		const sourceSpatialIndex = captureExactOwnDataRecord(
			sourceArtifacts.spatialIndex,
			PORT_SLOT_SPATIAL_KEYS,
			`${portType} spatial index`,
		);
		const revision = captureNonNegativeSafeInteger(
			sourceArtifacts.revision,
			`${portType} artifact revision`,
		);
		const slotCount = captureBoundedSlotCount(
			sourceArtifacts.slotCount,
			`${portType} artifact slot count`,
		);
		const slotsRevision = captureNonNegativeSafeInteger(
			sourceSlots.revision,
			`${portType} slot revision`,
		);
		const count = captureBoundedSlotCount(sourceSlots.count, `${portType} slot count`);
		const legalCount = captureBoundedSlotCount(
			sourceSlots.legalCount,
			`${portType} legal slot count`,
		);
		const spatialSlotCount = captureBoundedSlotCount(
			sourceSpatialIndex.slotCount,
			`${portType} spatial slot count`,
		);
		const chunkSizeMeters = capturePositiveSafeInteger(
			sourceSpatialIndex.chunkSizeMeters,
			`${portType} spatial chunk size`,
		);
		if (
			revision !== layout.revision ||
			slotsRevision !== layout.revision ||
			sourceArtifacts.portType !== portType ||
			sourceSlots.portType !== portType ||
			slotCount !== count ||
			spatialSlotCount !== count ||
			legalCount > count ||
			chunkSizeMeters !== PORT_SLOT_SPATIAL_CHUNK_METERS
		) {
			throw new Error("Prepared port slot artifact catalog does not match the physical layout.");
		}
		const capturedSlotViews: Record<string, ArrayBufferView> = {};
		for (const key of Object.keys(PORT_SLOT_VIEW_CONSTRUCTORS) as Array<
			keyof typeof PORT_SLOT_VIEW_CONSTRUCTORS
		>) {
			capturedSlotViews[key] = captureExactPortSlotTypedArray(
				sourceSlots[key],
				PORT_SLOT_VIEW_CONSTRUCTORS[key].prototype,
				seenBuffers,
				buffers,
				sourceViews,
				`${portType} ${key}`,
			);
		}
		for (const key of Object.keys(PORT_SLOT_VIEW_CONSTRUCTORS) as Array<
			keyof typeof PORT_SLOT_VIEW_CONSTRUCTORS
		>) {
			const expectedLength =
				key === "sourcePathOffsets"
					? layout.pathIntervalRemap.sourcePathCount + 1
					: count *
						(key === "railPositions" || key === "worldPositions" || key === "tangents" ? 2 : 1);
			assertCapturedTypedArrayLength(capturedSlotViews[key], expectedLength, `${portType} ${key}`);
		}
		const capturedSpatialViews: Record<string, ArrayBufferView> = {};
		for (const key of Object.keys(PORT_SLOT_SPATIAL_VIEW_CONSTRUCTORS) as Array<
			keyof typeof PORT_SLOT_SPATIAL_VIEW_CONSTRUCTORS
		>) {
			capturedSpatialViews[key] = captureExactPortSlotTypedArray(
				sourceSpatialIndex[key],
				PORT_SLOT_SPATIAL_VIEW_CONSTRUCTORS[key].prototype,
				seenBuffers,
				buffers,
				sourceViews,
				`${portType} spatial ${key}`,
			);
		}
		const chunkCoordinateLength = capturedTypedArrayLength(
			capturedSpatialViews.chunkCoordinates,
			`${portType} spatial chunkCoordinates`,
		);
		if ((chunkCoordinateLength & 1) !== 0 || chunkCoordinateLength > count * 2) {
			throw new Error(`Prepared port slot ${portType} spatial index shape is invalid.`);
		}
		const chunkCount = chunkCoordinateLength / 2;
		assertCapturedTypedArrayLength(
			capturedSpatialViews.chunkOffsets,
			chunkCount + 1,
			`${portType} spatial chunkOffsets`,
		);
		assertCapturedTypedArrayLength(
			capturedSpatialViews.slotIndices,
			count,
			`${portType} spatial slotIndices`,
		);
		const slots = Object.freeze({
			revision: slotsRevision,
			portType,
			count,
			legalCount,
			...capturedSlotViews,
		}) as unknown as CompiledPortSlots;
		const spatialIndex = Object.freeze({
			slotCount: spatialSlotCount,
			chunkSizeMeters,
			...capturedSpatialViews,
		}) as unknown as PortSlotSpatialIndexSnapshot;
		canonicalCatalog[portType] = Object.freeze({
			revision,
			portType,
			slotCount,
			slots,
			spatialIndex,
		});
	}
	checkCancelled();
	let adopted: PortSlotPreparedArtifactCatalog;
	try {
		adopted = structuredClone(canonicalCatalog, { transfer: buffers });
	} catch {
		throw new Error("Prepared port slot artifact ownership could not be adopted.");
	}
	checkCancelled();
	assertTransferredPortSlotViewsHaveNoCustomOwnProperties(sourceViews);
	for (const portType of PORT_TYPES) {
		for (const view of portSlotArtifactViews(adopted[portType])) {
			try {
				Object.preventExtensions(view);
			} catch {
				throw new Error("Prepared port slot adopted typed-array shape is invalid.");
			}
			if (Object.isExtensible(view)) {
				throw new Error("Prepared port slot adopted typed-array shape is invalid.");
			}
		}
		Object.freeze(adopted[portType].slots);
		Object.freeze(adopted[portType].spatialIndex);
		Object.freeze(adopted[portType]);
	}
	const frozen = Object.freeze(adopted);
	if (!portSlotPreparedArtifactCatalogMatch(layout, frozen)) {
		throw new Error("Adopted port slot artifact catalog does not match the physical layout.");
	}
	return frozen;
}

function captureExactOwnDataRecord(
	value: unknown,
	expectedKeys: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Prepared port slot ${label} schema is invalid.`);
	}
	let prototype: object | null;
	let keys: readonly PropertyKey[];
	try {
		prototype = Object.getPrototypeOf(value);
		keys = Reflect.ownKeys(value);
	} catch {
		throw new Error(`Prepared port slot ${label} schema is invalid.`);
	}
	if (
		(prototype !== Object.prototype && prototype !== null) ||
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
	) {
		throw new Error(`Prepared port slot ${label} schema is invalid.`);
	}
	const captured: Record<string, unknown> = {};
	for (const key of expectedKeys) {
		let descriptor: PropertyDescriptor | undefined;
		try {
			descriptor = Object.getOwnPropertyDescriptor(value, key);
		} catch {
			throw new Error(`Prepared port slot ${label} schema is invalid.`);
		}
		if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
			throw new Error(`Prepared port slot ${label} schema is invalid.`);
		}
		captured[key] = descriptor.value;
	}
	return captured;
}

function captureExactPortSlotTypedArray(
	value: unknown,
	expectedPrototype: object,
	seenBuffers: Set<ArrayBuffer>,
	buffers: ArrayBuffer[],
	sourceViews: ArrayBufferView[],
	label: string,
): ArrayBufferView {
	if (
		!ArrayBuffer.isView(value) ||
		Object.getPrototypeOf(value) !== expectedPrototype ||
		TYPED_ARRAY_BUFFER_GETTER === undefined ||
		TYPED_ARRAY_BYTE_OFFSET_GETTER === undefined ||
		TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
		TYPED_ARRAY_LENGTH_GETTER === undefined
	) {
		throw new Error(`Prepared port slot ${label} typed array is invalid.`);
	}
	for (const key of ["buffer", "byteOffset", "byteLength", "length"] as const) {
		if (Object.getOwnPropertyDescriptor(value, key) !== undefined) {
			throw new Error(`Prepared port slot ${label} typed array is invalid.`);
		}
	}
	let buffer: unknown;
	let byteOffset: unknown;
	let byteLength: unknown;
	try {
		buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
		byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []);
		byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
	} catch {
		throw new Error(`Prepared port slot ${label} typed array is invalid.`);
	}
	if (!(buffer instanceof ArrayBuffer) || ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) {
		throw new Error("Prepared port slot artifact buffer ownership is invalid.");
	}
	try {
		if (
			Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
			Reflect.ownKeys(buffer).length !== 0
		) {
			throw new Error("invalid buffer shape");
		}
	} catch {
		throw new Error("Prepared port slot artifact buffer ownership is invalid.");
	}
	let bufferByteLength: unknown;
	try {
		bufferByteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
	} catch {
		throw new Error("Prepared port slot artifact buffer ownership is invalid.");
	}
	if (
		!arrayBufferIsFixed(buffer) ||
		byteOffset !== 0 ||
		byteLength !== bufferByteLength ||
		seenBuffers.has(buffer)
	) {
		throw new Error("Prepared port slot artifact buffer ownership is invalid.");
	}
	seenBuffers.add(buffer);
	buffers.push(buffer);
	sourceViews.push(value);
	return value;
}

/** Detached typed arrays retain only custom own fields, never canonical integer-index keys. */
function assertTransferredPortSlotViewsHaveNoCustomOwnProperties(
	views: readonly ArrayBufferView[],
): void {
	try {
		if (views.some((view) => Reflect.ownKeys(view).length !== 0)) {
			throw new Error("custom view field");
		}
	} catch {
		throw new Error("Prepared port slot typed arrays cannot contain custom own properties.");
	}
}

function capturedTypedArrayLength(value: ArrayBufferView, label: string): number {
	if (TYPED_ARRAY_LENGTH_GETTER === undefined) {
		throw new Error(`Prepared port slot ${label} typed array is invalid.`);
	}
	try {
		const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []);
		if (!Number.isSafeInteger(length) || length < 0) throw new Error("invalid length");
		return length;
	} catch {
		throw new Error(`Prepared port slot ${label} typed array is invalid.`);
	}
}

function assertCapturedTypedArrayLength(
	value: ArrayBufferView,
	expected: number,
	label: string,
): void {
	if (capturedTypedArrayLength(value, label) !== expected) {
		throw new Error(`Prepared port slot ${label} length diverged.`);
	}
}

function captureNonNegativeSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(`Prepared port slot ${label} is invalid.`);
	}
	return value as number;
}

function capturePositiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new Error(`Prepared port slot ${label} is invalid.`);
	}
	return value as number;
}

function captureBoundedSlotCount(value: unknown, label: string): number {
	const count = captureNonNegativeSafeInteger(value, label);
	if (count > PORT_SLOT_MAX_ROWS) {
		throw new Error(`Prepared port slot ${label} exceeds the supported row limit.`);
	}
	return count;
}

function arrayBufferIsFixed(buffer: ArrayBuffer): boolean {
	if (ARRAY_BUFFER_RESIZABLE_GETTER === undefined) return true;
	try {
		return Reflect.apply(ARRAY_BUFFER_RESIZABLE_GETTER, buffer, []) === false;
	} catch {
		return false;
	}
}

function* portSlotSemanticValidationSteps(
	layout: CompiledPhysicalLayout,
	artifacts: PortSlotPreparedArtifacts,
	preparedExclusionMask?: Uint8Array,
	preparedRailClearance?: PortSlotRailClearanceIndex,
): Generator<void> {
	const slots = artifacts.slots;
	const remap = layout.pathIntervalRemap;
	const count = slots.count;
	assertLength(slots.sourcePathOffsets, remap.sourcePathCount + 1, "source path offsets");
	for (const [value, multiplier, label] of [
		[slots.sourcePathIndices, 1, "source path indices"],
		[slots.finalPathIndices, 1, "final path indices"],
		[slots.routeXs, 1, "route x coordinates"],
		[slots.routeZs, 1, "route z coordinates"],
		[slots.routeFromDirections, 1, "route from directions"],
		[slots.routeToDirections, 1, "route to directions"],
		[slots.stationMillimeters, 1, "stations"],
		[slots.sides, 1, "sides"],
		[slots.lateralOffsetMillimeters, 1, "lateral offsets"],
		[slots.directions, 1, "directions"],
		[slots.portTypes, 1, "port types"],
		[slots.railPositions, 2, "rail positions"],
		[slots.worldPositions, 2, "world positions"],
		[slots.tangents, 2, "tangents"],
		[slots.yawRadians, 1, "yaw values"],
		[slots.statuses, 1, "statuses"],
		[slots.conflictingPortIds, 1, "conflicting port ids"],
		[slots.conflictingRailPathIndices, 1, "conflicting rail path indices"],
	] as const) {
		assertLength(value, count * multiplier, label);
	}
	const policy = OPENFAB_PORT_SLOT_POLICIES[artifacts.portType];
	const exclusionMask = preparedExclusionMask ?? compilePortSlotExclusionMask(layout);
	const railClearance = preparedRailClearance ?? new PortSlotRailClearanceIndex(layout);
	assertLength(exclusionMask, remap.sourcePathCount, "exclusion mask");
	let writeRow = 0;
	let legalCount = 0;
	for (let sourcePathIndex = 0; sourcePathIndex < remap.sourcePathCount; sourcePathIndex++) {
		if ((slots.sourcePathOffsets[sourcePathIndex] as number) !== writeRow) {
			throw new Error(
				`Prepared ${artifacts.portType} slot source offset ${sourcePathIndex} diverged.`,
			);
		}
		if (!isCardinalLinearSource(layout, sourcePathIndex)) continue;
		const x = remap.sourcePathCells[sourcePathIndex * 2] as number;
		const z = remap.sourcePathCells[sourcePathIndex * 2 + 1] as number;
		const from = remap.sourcePathFromDirections[sourcePathIndex] as Direction;
		const to = remap.sourcePathToDirections[sourcePathIndex] as Direction;
		const stationMillimeters = metersToMillimeters(
			(remap.sourcePathCanonicalStarts[sourcePathIndex] as number) +
				(remap.sourcePathLengths[sourcePathIndex] as number) * 0.5,
		);
		for (const side of policy.sides) {
			const row = writeRow++;
			if ((slots.sourcePathIndices[row] as number) !== sourcePathIndex) {
				throw new Error(`Prepared ${artifacts.portType} slot row ${row} source path diverged.`);
			}
			assertRowValue(slots.routeXs[row] as number, x, row, "route x");
			assertRowValue(slots.routeZs[row] as number, z, row, "route z");
			assertRowValue(slots.routeFromDirections[row] as number, from, row, "route from");
			assertRowValue(slots.routeToDirections[row] as number, to, row, "route to");
			assertRowValue(slots.stationMillimeters[row] as number, stationMillimeters, row, "station");
			assertRowValue(slots.sides[row] as number, PORT_SIDES.indexOf(side), row, "side");
			const lateralOffsetMillimeters = side === "CENTER" ? 0 : policy.lateralOffsetMillimeters;
			assertRowValue(
				slots.lateralOffsetMillimeters[row] as number,
				lateralOffsetMillimeters,
				row,
				"lateral offset",
			);
			assertRowValue(
				slots.directions[row] as number,
				PORT_DIRECTIONS.indexOf("WITH_TRAVEL"),
				row,
				"direction",
			);
			assertRowValue(
				slots.portTypes[row] as number,
				PORT_TYPES.indexOf(artifacts.portType),
				row,
				"port type",
			);
			const resolution = resolvePortAttachmentAtSourcePath(
				layout,
				{
					route: { kind: "CARDINAL_CELL", x, z, from, to },
					stationMillimeters,
					side,
					lateralOffsetMillimeters,
					direction: "WITH_TRAVEL",
				},
				sourcePathIndex,
			);
			const status = slots.statuses[row] as number;
			if (
				status !== PORT_SLOT_STATUS.LEGAL &&
				status !== PORT_SLOT_STATUS.LAYOUT_INVALID &&
				status !== PORT_SLOT_STATUS.UNSAFE_APPROACH &&
				status !== PORT_SLOT_STATUS.ATTACHMENT_INVALID &&
				status !== PORT_SLOT_STATUS.RAIL_CLEARANCE_CONFLICT
			) {
				throw new Error(`Prepared ${artifacts.portType} slot row ${row} has a dynamic status.`);
			}
			if ((slots.conflictingPortIds[row] as number) !== 0) {
				throw new Error(
					`Prepared ${artifacts.portType} slot row ${row} has a dynamic port conflict.`,
				);
			}
			const fixedStatus = !layout.valid
				? PORT_SLOT_STATUS.LAYOUT_INVALID
				: (exclusionMask[sourcePathIndex] as number) !== 0
					? PORT_SLOT_STATUS.UNSAFE_APPROACH
					: !resolution.ok
						? PORT_SLOT_STATUS.ATTACHMENT_INVALID
						: null;
			if (fixedStatus !== null && status !== fixedStatus) {
				throw new Error(`Prepared ${artifacts.portType} slot row ${row} base status diverged.`);
			}
			if (!resolution.ok) {
				assertRowValue(slots.finalPathIndices[row] as number, 0, row, "final path");
			} else {
				assertRowValue(
					slots.finalPathIndices[row] as number,
					resolution.finalPathIndex,
					row,
					"final path",
				);
				assertFloat32(
					slots.railPositions[row * 2] as number,
					resolution.railXMeters,
					row,
					"rail x",
				);
				assertFloat32(
					slots.railPositions[row * 2 + 1] as number,
					resolution.railZMeters,
					row,
					"rail z",
				);
				assertFloat32(
					slots.worldPositions[row * 2] as number,
					resolution.worldXMeters,
					row,
					"world x",
				);
				assertFloat32(
					slots.worldPositions[row * 2 + 1] as number,
					resolution.worldZMeters,
					row,
					"world z",
				);
				assertFloat32(slots.tangents[row * 2] as number, resolution.tangentX, row, "tangent x");
				assertFloat32(slots.tangents[row * 2 + 1] as number, resolution.tangentZ, row, "tangent z");
				assertFloat32(slots.yawRadians[row] as number, resolution.yawRadians, row, "yaw");
			}
			const expectedRailConflict =
				fixedStatus === null && resolution.ok
					? railClearance.conflictingPathIndex(resolution, side, policy.footprintRadiusMillimeters)
					: -1;
			const expectedStatus =
				fixedStatus ??
				(expectedRailConflict === -1
					? PORT_SLOT_STATUS.LEGAL
					: PORT_SLOT_STATUS.RAIL_CLEARANCE_CONFLICT);
			if (status !== expectedStatus) {
				throw new Error(
					`Prepared ${artifacts.portType} slot row ${row} clearance status diverged.`,
				);
			}
			assertRowValue(
				slots.conflictingRailPathIndices[row] as number,
				expectedRailConflict,
				row,
				"rail conflict",
			);
			if (status === PORT_SLOT_STATUS.LEGAL) legalCount++;
			yield;
		}
	}
	assertRowValue(
		slots.sourcePathOffsets[remap.sourcePathCount] as number,
		writeRow,
		remap.sourcePathCount,
		"final source offset",
	);
	if (writeRow !== count || legalCount !== slots.legalCount) {
		throw new Error(`Prepared ${artifacts.portType} slot row or legal count diverged.`);
	}
}

function isCardinalLinearSource(layout: CompiledPhysicalLayout, sourcePathIndex: number): boolean {
	const remap = layout.pathIntervalRemap;
	return (
		(remap.sourceIdentityKinds[sourcePathIndex] as number) ===
			PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL &&
		(remap.sourcePathKinds[sourcePathIndex] as number) === PATH_KIND.LINEAR &&
		(remap.sourcePathFromDirections[sourcePathIndex] as number) !== 0 &&
		(remap.sourcePathToDirections[sourcePathIndex] as number) !== 0
	);
}

function assertLength(
	value: ArrayBufferView & { readonly length: number },
	expected: number,
	label: string,
): void {
	if (value.length !== expected) throw new Error(`Prepared port slot ${label} length diverged.`);
}

function assertRowValue(actual: number, expected: number, row: number, label: string): void {
	if (actual !== expected) throw new Error(`Prepared port slot row ${row} ${label} diverged.`);
}

function assertFloat32(actual: number, expected: number, row: number, label: string): void {
	if (actual !== Math.fround(expected)) {
		throw new Error(`Prepared port slot row ${row} ${label} diverged.`);
	}
}
