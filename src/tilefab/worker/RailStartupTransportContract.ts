import { PHYSICAL_PATH_IDENTITY_WIDTH } from "../compile/PhysicalPathIdentity";
import type { CompiledPhysicalLayout } from "../compile/PhysicalRailCompiler";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { RailStartupPayload } from "./RailStartupProtocol";

type ExactTypedArrayConstructor =
	| typeof Int8Array
	| typeof Uint8Array
	| typeof Int16Array
	| typeof Uint16Array
	| typeof Int32Array
	| typeof Uint32Array
	| typeof Float32Array
	| typeof Float64Array;

type ViewSchema = Readonly<Record<string, ExactTypedArrayConstructor>>;

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

const RAIL_STARTUP_PLAIN_METADATA_FINGERPRINT_VERSION = "rail-startup-plain-metadata-v2";
const RAIL_STARTUP_METADATA_CHECKPOINT_OPERATIONS = 16;
// The first four views are the authored xs/ys/encoded/switch-ID snapshot. Keep them atomic before
// the first possible yield, then checkpoint before adopting any derived view batch.
const RAIL_STARTUP_TRANSFER_VIEWS_PER_BATCH = 4;
const MAX_READINESS_ISSUES = 64;
const MAX_READINESS_ISSUE_SAMPLES = 16;
const PHYSICAL_PIECE_COUNT_KEYS = [
	"LINEAR",
	"LEFT_CURVE",
	"RIGHT_CURVE",
	"CCW_CURVE",
	"S_CURVE",
	"CSC_CURVE_HOMO",
	"CSC_CURVE_HETE",
] as const;
const PHYSICAL_PIECE_TYPES = new Set<string>(PHYSICAL_PIECE_COUNT_KEYS);
const READINESS_ISSUE_CODES = new Set<string>([
	"EMPTY_PROJECT",
	"OPEN_TERMINAL",
	"DISCONNECTED_NETWORK",
	"MULTIPLE_STRONG_COMPONENTS",
	"UNSUPPORTED_JUNCTION",
	"TOPOLOGY_ERROR",
	"INVALID_PHYSICAL_PATH",
	"PHYSICAL_TERMINAL",
	"PHYSICAL_OPEN_PATH",
	"PHYSICAL_DISCONNECTED",
	"CLEARANCE_CONFLICT",
]);

const PHYSICAL_PATH_VIEWS = {
	positions: Float32Array,
	tangents: Float32Array,
	distances: Float32Array,
	offsets: Uint32Array,
	kinds: Uint8Array,
	cells: Int32Array,
	exitCells: Int32Array,
	fromDirections: Uint8Array,
	toDirections: Uint8Array,
	lengths: Float32Array,
	bounds: Float32Array,
	startInsets: Float32Array,
	endInsets: Float32Array,
	startExtensions: Float32Array,
	endExtensions: Float32Array,
	coverageOffsets: Uint32Array,
	coverageCells: Int32Array,
	sharedSegmentOffsets: Uint32Array,
	sharedSegmentIds: Uint32Array,
	sharedSegmentStarts: Float32Array,
	sharedSegmentEnds: Float32Array,
	sourceKinds: Uint8Array,
	advancedSwitchIds: Uint32Array,
	advancedSwitchProfileClasses: Uint8Array,
	advancedSwitchSegmentRoles: Uint8Array,
	advancedSwitchSegmentPorts: Uint8Array,
	advancedSwitchSegmentOrdinals: Uint16Array,
	advancedSwitchCatalogProfiles: Uint8Array,
	explicitAdjacencyOffsets: Uint32Array,
	explicitAdjacencyTargets: Uint32Array,
} as const satisfies ViewSchema;

const COMPOUND_PROFILE_VIEWS = {
	pathIndices: Uint32Array,
	advancedSwitchIds: Uint32Array,
	types: Uint8Array,
	geometryKinds: Uint8Array,
	fitKinds: Uint8Array,
	nominalProfileIndices: Int16Array,
	lateralSideSigns: Int8Array,
	compiledRadiusMillimeters: Uint16Array,
	compiledTurnAngleTenths: Uint16Array,
	compiledLeadInMillimeters: Uint32Array,
	compiledLeadOutMillimeters: Uint32Array,
	compiledMiddleMillimeters: Uint32Array,
	compiledLengthMillimeters: Uint32Array,
	leadInResidualMillimeters: Int32Array,
	leadOutResidualMillimeters: Int32Array,
	middleResidualMillimeters: Int32Array,
	lengthResidualMillimeters: Int32Array,
	forwardFitDeltaMillimeters: Int32Array,
	lateralFitDeltaMillimeters: Int32Array,
	fitReasonMasks: Uint8Array,
	controlOffsets: Uint32Array,
	controlPoints: Float32Array,
	controlDistances: Float32Array,
	controlRoles: Uint8Array,
	memberOffsets: Uint32Array,
	memberPathIndices: Uint32Array,
} as const satisfies ViewSchema;

const PATH_INTERVAL_REMAP_VIEWS = {
	sourcePathCells: Int32Array,
	sourcePathKinds: Uint8Array,
	sourcePathFromDirections: Uint8Array,
	sourcePathToDirections: Uint8Array,
	sourceIdentityKinds: Uint8Array,
	sourceAdvancedSwitchIds: Uint32Array,
	sourceAdvancedSwitchProfileClasses: Uint8Array,
	sourceAdvancedSwitchRoles: Uint8Array,
	sourceAdvancedSwitchPorts: Uint8Array,
	sourceAdvancedSwitchSegmentOrdinals: Uint16Array,
	sourcePathCanonicalStarts: Float32Array,
	sourcePathLengths: Float32Array,
	sourcePathOffsets: Uint32Array,
	sourceStarts: Float32Array,
	sourceEnds: Float32Array,
	targetPathIndices: Uint32Array,
	targetStarts: Float32Array,
	targetEnds: Float32Array,
	mappingKinds: Uint8Array,
	projectionErrors: Float32Array,
} as const satisfies ViewSchema;

const TURNOUT_FOOTPRINT_VIEWS = {
	kinds: Uint8Array,
	anchors: Int32Array,
	leadInMillimeters: Uint16Array,
	leadOutMillimeters: Uint16Array,
	radiusMillimeters: Uint16Array,
	reservedOffsets: Uint32Array,
	reservedCells: Int32Array,
	pathOffsets: Uint32Array,
	pathIndices: Uint32Array,
	clearancePathOffsets: Uint32Array,
	clearancePathIndices: Uint32Array,
	clearancePathStarts: Float32Array,
	clearancePathEnds: Float32Array,
	bounds: Float32Array,
} as const satisfies ViewSchema;

const ADVANCED_SWITCH_VIEWS = {
	ids: Uint32Array,
	profileClasses: Uint8Array,
	origins: Int32Array,
	forwardDirections: Uint8Array,
	lateralDirections: Uint8Array,
	movementMasks: Uint8Array,
	portOffsets: Uint32Array,
	portRoles: Uint8Array,
	portLocalIndices: Uint8Array,
	portCells: Int32Array,
	portDirections: Uint8Array,
	portPathIndices: Uint32Array,
	portPathStations: Float32Array,
	movementOffsets: Uint32Array,
	movementInputIndices: Uint8Array,
	movementOutputIndices: Uint8Array,
	movementPathOffsets: Uint32Array,
	movementPathIndices: Uint32Array,
	movementPathStarts: Float32Array,
	movementPathEnds: Float32Array,
	movementConflictOffsets: Uint32Array,
	movementConflictIntervalIndices: Uint32Array,
	claimedOffsets: Uint32Array,
	claimedCells: Int32Array,
	reservedOffsets: Uint32Array,
	reservedCells: Int32Array,
	mergeAnchors: Int32Array,
	branchAnchors: Int32Array,
	sharedThroatCells: Int32Array,
	sharedThroatLengthsMeters: Float32Array,
	sharedSupportLengthsMeters: Float32Array,
	mergeSharedLeadMeters: Float32Array,
	clearTrunkMeters: Float32Array,
	branchSharedLeadMeters: Float32Array,
	conflictZoneIds: Uint32Array,
	conflictZoneLengthsMeters: Float32Array,
	conflictPathOffsets: Uint32Array,
	conflictPathIndices: Uint32Array,
	conflictPathStarts: Float32Array,
	conflictPathEnds: Float32Array,
	conflictIntervalKinds: Uint8Array,
	conflictRouteIndices: Uint8Array,
	conflictBounds: Float32Array,
	bounds: Float32Array,
} as const satisfies ViewSchema;

const CLEARANCE_ENVELOPE_VIEWS = {
	pathOffsets: Uint32Array,
	pathIndices: Uint32Array,
	pointIndices: Uint32Array,
	stationStarts: Float32Array,
	stationEnds: Float32Array,
	startPoints: Float32Array,
	endPoints: Float32Array,
	bounds: Float32Array,
	beamRadiusMillimeters: Uint16Array,
	ohtSweepRadiusMillimeters: Uint16Array,
	installationRadiusMillimeters: Uint16Array,
	approximationToleranceMillimeters: Uint16Array,
} as const satisfies ViewSchema;

const CLEARANCE_ISSUE_VIEWS = {
	codes: Uint8Array,
	relations: Uint8Array,
	firstPathIndices: Uint32Array,
	secondPathIndices: Uint32Array,
	firstPathIdentities: Int32Array,
	secondPathIdentities: Int32Array,
	firstEnvelopeIndices: Uint32Array,
	secondEnvelopeIndices: Uint32Array,
	firstStations: Float32Array,
	secondStations: Float32Array,
	contactPoints: Float32Array,
	centerlineDistances: Float32Array,
	requiredClearances: Float32Array,
	penetrationDepths: Float32Array,
	cells: Int32Array,
} as const satisfies ViewSchema;

const ANALYSIS_VIEWS = {
	openEndCells: Int32Array,
	unsafeJunctionCells: Int32Array,
	componentRepresentatives: Int32Array,
	strongComponentRepresentatives: Int32Array,
	oneWayCorridorOffsets: Uint32Array,
	oneWayCorridorCells: Int32Array,
	oneWayCorridorBoundaries: Int32Array,
} as const satisfies ViewSchema;

const OWNERSHIP_MODULE_VIEWS = {
	kinds: Uint8Array,
	advancedSwitchIds: Int32Array,
	catalogIds: Uint8Array,
	grammars: Uint8Array,
	forwards: Uint8Array,
	spans: Uint8Array,
	sides: Uint8Array,
	advancedSwitchProfiles: Uint8Array,
	lengthMeters: Float64Array,
	primaryOffsets: Uint32Array,
	primaryCells: Int32Array,
	footprintOffsets: Uint32Array,
	footprintCells: Int32Array,
	eraseOffsets: Uint32Array,
	eraseCells: Int32Array,
	boundaryOffsets: Uint32Array,
	boundaryRoles: Uint8Array,
	boundaryCells: Int32Array,
	boundaryDirections: Uint8Array,
} as const satisfies ViewSchema;

const OWNERSHIP_VIEWS = {
	candidateCells: Int32Array,
	candidateOffsets: Uint32Array,
	candidateModuleIndices: Uint32Array,
} as const satisfies ViewSchema;

const READINESS_LOCATION_VIEWS = {
	openTerminalCells: Int32Array,
	componentRepresentativeCells: Int32Array,
	strongComponentRepresentativeCells: Int32Array,
	oneWayCorridorOffsets: Uint32Array,
	oneWayCorridorCells: Int32Array,
	oneWayCorridorBoundaries: Int32Array,
	unsupportedJunctionCells: Int32Array,
	topologyErrorCells: Int32Array,
	physicalTerminalCells: Int32Array,
	physicalOpenPathIdentities: Int32Array,
	physicalStrongComponentPathIdentities: Int32Array,
	clearanceCells: Int32Array,
	clearancePathIdentities: Int32Array,
} as const satisfies ViewSchema;

const SWITCH_RECORD_VIEWS = {
	profileClasses: Uint8Array,
	origins: Int32Array,
	forwardDirections: Uint8Array,
	lateralDirections: Uint8Array,
	movementMasks: Uint8Array,
} as const satisfies ViewSchema;

const PORT_RECORD_VIEWS = {
	equipmentGroupIds: Int32Array,
	routeKinds: Uint8Array,
	routeXs: Int32Array,
	routeZs: Int32Array,
	routeFromDirections: Uint8Array,
	routeToDirections: Uint8Array,
	routeSwitchIds: Int32Array,
	routeProfileClasses: Uint8Array,
	routeRoles: Uint8Array,
	routePortIndices: Int8Array,
	routeSegmentOrdinals: Uint16Array,
	stationMillimeters: Int32Array,
	sides: Uint8Array,
	lateralOffsetMillimeters: Uint32Array,
	directions: Uint8Array,
	portTypes: Uint8Array,
} as const satisfies ViewSchema;

const EQUIPMENT_GROUP_VIEWS = {
	kinds: Uint8Array,
	portOffsets: Uint32Array,
	portIds: Int32Array,
	templates: Uint8Array,
	pitchMillimeters: Uint32Array,
} as const satisfies ViewSchema;

const ORGANIZATION_RECORD_VIEWS = {
	kinds: Uint8Array,
	parentOrganizationOffsets: Uint32Array,
	parentOrganizationIds: Int32Array,
	colors: Uint8Array,
	railEdgeOffsets: Uint32Array,
	railEdgeCoordinates: Int32Array,
	advancedSwitchOffsets: Uint32Array,
	advancedSwitchIds: Int32Array,
	equipmentGroupOffsets: Uint32Array,
	equipmentGroupIds: Int32Array,
} as const satisfies ViewSchema;

const RUN_VIEWS = {
	offsets: Uint32Array,
	pathIndices: Uint32Array,
	pathStarts: Float32Array,
	lengths: Float32Array,
	closed: Uint8Array,
	pathRunIndices: Uint32Array,
	pathRunStarts: Float32Array,
} as const satisfies ViewSchema;

const DECORATION_VIEWS = {
	pathOffsets: Uint32Array,
	ownerPathIndices: Uint32Array,
	runIndices: Uint32Array,
	pathStations: Float32Array,
	runStations: Float32Array,
	positions: Float32Array,
	tangents: Float32Array,
	kinds: Uint8Array,
	priorities: Uint8Array,
	stableIds: Uint32Array,
} as const satisfies ViewSchema;

const SPATIAL_INDEX_VIEWS = {
	chunkCoordinates: Int32Array,
	chunkOffsets: Uint32Array,
	pathIndices: Uint32Array,
} as const satisfies ViewSchema;

const ENVELOPE_SPATIAL_INDEX_VIEWS = {
	chunkCoordinates: Int32Array,
	chunkOffsets: Uint32Array,
	envelopeIndices: Uint32Array,
} as const satisfies ViewSchema;

const INT32_CSR_VIEWS = {
	keys: Int32Array,
	offsets: Uint32Array,
	values: Uint32Array,
} as const satisfies ViewSchema;

const ADJACENCY_VIEWS = {
	offsets: Uint32Array,
	targets: Uint32Array,
} as const satisfies ViewSchema;

const ASSEMBLY_RELATIONSHIP_RECORD_VIEWS = {
	hierarchyRoles: Uint8Array,
	purposes: Uint8Array,
	parentOrganizationIds: Int32Array,
	reviewPolicies: Uint8Array,
	participantOffsets: Uint32Array,
	participantOrganizationIds: Int32Array,
	managedChildOffsets: Uint32Array,
	managedChildOrganizationIds: Int32Array,
	connectionGroupOffsets: Uint32Array,
	groupLegOffsets: Uint32Array,
	legDirectionRoles: Uint8Array,
	legExclusiveCutEdgeOffsets: Uint32Array,
	exclusiveCutEdgeScopedIndexes: Uint32Array,
	legEndpointSupportOffsets: Uint32Array,
	endpointSupportScopedIndexes: Uint32Array,
	endpointAdjacentExclusiveCutEdgeIndexes: Uint32Array,
	endpointPositions: Uint8Array,
	legSeamContactOffsets: Uint32Array,
	seamRoles: Uint8Array,
	seamIncidenceOffsets: Uint32Array,
	incidenceDirections: Uint8Array,
	incidenceBindingKinds: Uint8Array,
	incidenceExclusiveCutEdgeIndexes: Uint32Array,
	incidenceWitnessScopedEdgeIndexes: Uint32Array,
	edgeCoordinates: Int32Array,
} as const satisfies ViewSchema;

const ASSEMBLY_RELATIONSHIP_SCOPED_EDGE_VIEWS = {
	edgeIndexes: Uint32Array,
	scopeKinds: Uint8Array,
	participantIndexes: Int8Array,
	directOwnerOffsets: Uint32Array,
	directOwnerOrganizationIds: Int32Array,
} as const satisfies ViewSchema;

interface CaptureState {
	readonly buffers: ArrayBuffer[];
	readonly views: ArrayBufferView[];
	readonly constructors: ExactTypedArrayConstructor[];
	readonly seenBuffers: Set<ArrayBuffer>;
}

export interface RailStartupTransport {
	readonly snapshot: RailStartupPayload["snapshot"];
	readonly analysis: RailStartupPayload["analysis"]["value"];
	readonly ownership: RailStartupPayload["ownership"]["value"];
	readonly physical: RailStartupPayload["physical"]["value"];
	readonly readiness: RailStartupPayload["readiness"]["value"];
	readonly renderArtifacts: RailStartupPayload["renderArtifacts"]["value"];
	readonly draftArtifacts: RailStartupPayload["draftArtifacts"]["value"];
}

/** Bearer token for one exact startup graph adopted through the strict transport contract. */
export interface RailStartupTransportAdoptionAuthority {
	readonly token: object;
}

export interface AdoptedRailStartupTransport<Transport extends RailStartupTransport> {
	readonly value: Transport;
	readonly authority: RailStartupTransportAdoptionAuthority;
}

interface RailStartupTransportAdoptionBinding {
	readonly transport: RailStartupTransport;
	readonly snapshot: RailStartupTransport["snapshot"];
	readonly xs: Int32Array;
	readonly ys: Int32Array;
	readonly encoded: Uint8Array;
	readonly switchIds: Int32Array;
	readonly switchRecords: RailStartupTransport["snapshot"]["switchRecords"];
	readonly portEquipment: RailStartupTransport["snapshot"]["portEquipment"];
	readonly organizations: RailStartupTransport["snapshot"]["organizations"];
	readonly relationships: RailStartupTransport["snapshot"]["relationships"];
}

const railStartupTransportAdoptionBindings = new WeakMap<
	object,
	RailStartupTransportAdoptionBinding
>();

/** Spend exact transport provenance once; copied wrappers cannot change the bound identities. */
export function consumeRailStartupTransportAdoptionAuthority(
	authority: RailStartupTransportAdoptionAuthority,
	transport: RailStartupTransport,
	snapshot: RailStartupTransport["snapshot"],
): boolean {
	const token = authority.token;
	const binding = railStartupTransportAdoptionBindings.get(token);
	railStartupTransportAdoptionBindings.delete(token);
	return (
		binding?.transport === transport &&
		binding.snapshot === snapshot &&
		transport.snapshot === snapshot &&
		binding.xs === snapshot.xs &&
		binding.ys === snapshot.ys &&
		binding.encoded === snapshot.encoded &&
		binding.switchIds === snapshot.switchIds &&
		binding.switchRecords === snapshot.switchRecords &&
		binding.portEquipment === snapshot.portEquipment &&
		binding.organizations === snapshot.organizations &&
		binding.relationships === snapshot.relationships
	);
}

/**
 * Supplemental Worker digest for mutable plain physical metadata and bounded readiness issue
 * details. Typed artifact fingerprints remain authoritative for bulk buffers; this digest closes
 * the cooperative-clone generation gap for metadata that those fingerprints intentionally omit.
 */
export function checksumRailStartupPlainMetadata(
	physical: CompiledPhysicalLayout,
	readiness: RailStartupPayload["readiness"]["value"],
): string {
	const checksum = new OrderedTypedChecksum();
	for (const _step of railStartupPlainMetadataChecksumSteps(checksum, physical, readiness)) {
		void _step;
	}
	return checksum.digest();
}

/** Main-thread variant of the Worker digest with a checkpoint for every bounded batch. */
export async function checksumRailStartupPlainMetadataCooperatively(
	physical: CompiledPhysicalLayout,
	readiness: RailStartupPayload["readiness"]["value"],
	checkpoint: () => Promise<void>,
): Promise<string> {
	const checksum = new OrderedTypedChecksum();
	let operations = 0;
	for (const _step of railStartupPlainMetadataChecksumSteps(checksum, physical, readiness)) {
		void _step;
		operations++;
		if (operations % RAIL_STARTUP_METADATA_CHECKPOINT_OPERATIONS === 0) {
			await checkpoint();
		}
	}
	await checkpoint();
	return checksum.digest();
}

function* railStartupPlainMetadataChecksumSteps(
	checksum: OrderedTypedChecksum,
	physical: CompiledPhysicalLayout,
	readiness: RailStartupPayload["readiness"]["value"],
): Generator<void> {
	checksum.addStrings([RAIL_STARTUP_PLAIN_METADATA_FINGERPRINT_VERSION]);
	yield;
	const physicalWithoutPieces: CompiledPhysicalLayout = {
		...physical,
		pieces: [],
	};
	yield* appendStartupMetadataGraph(checksum, physicalWithoutPieces, false, "physical metadata");
	yield* appendStartupPhysicalPieces(checksum, physical.pieces);
	yield* appendStartupMetadataGraph(checksum, readiness.issues, true, "readiness issues");
}

const STARTUP_PHYSICAL_PIECE_OPTIONAL_STRING_KEYS = [
	"geometryKind",
	"fitKind",
	"nominalProfileId",
	"turn",
	"role",
] as const;

const STARTUP_PHYSICAL_PIECE_OPTIONAL_NUMBER_KEYS = [
	"rotationDegrees",
	"leadInMillimeters",
	"leadOutMillimeters",
	"middleMillimeters",
	"nominalLengthMeters",
	"leadInResidualMillimeters",
	"leadOutResidualMillimeters",
	"middleResidualMillimeters",
	"lengthResidualMillimeters",
	"forwardFitDeltaMillimeters",
	"lateralFitDeltaMillimeters",
	"physicalPathIndex",
	"advancedSwitchId",
	"advancedSwitchProfileClass",
	"advancedSwitchSegmentRole",
	"advancedSwitchPortIndex",
	"advancedSwitchSegmentOrdinal",
] as const;

/**
 * The adopted physical graph is already a private exact-schema clone. Stream its factory-scale
 * piece table directly so fingerprinting cannot recreate one descriptor/frame graph per cell.
 */
function* appendStartupPhysicalPieces(
	checksum: OrderedTypedChecksum,
	pieces: CompiledPhysicalLayout["pieces"],
): Generator<void> {
	checksum.addCachedString("physical-pieces");
	checksum.addNumber(pieces.length);
	yield;
	for (const piece of pieces) {
		checksum.addString(piece.id);
		checksum.addCachedString(piece.type);
		checksum.addNumber(piece.cells.length);
		for (const cell of piece.cells) {
			checksum.addNumber(cell.x);
			checksum.addNumber(cell.y);
			yield;
		}
		checksum.addNumber(piece.from.x);
		checksum.addNumber(piece.from.y);
		checksum.addNumber(piece.to.x);
		checksum.addNumber(piece.to.y);
		checksum.addNumber(piece.lengthMeters);
		checksum.addNumber(piece.radiusMillimeters === null ? 0 : 1);
		if (piece.radiusMillimeters !== null) checksum.addNumber(piece.radiusMillimeters);
		for (const key of STARTUP_PHYSICAL_PIECE_OPTIONAL_STRING_KEYS) {
			const value = piece[key];
			checksum.addNumber(value === undefined ? 0 : 1);
			if (value !== undefined) checksum.addCachedString(value);
		}
		for (const key of STARTUP_PHYSICAL_PIECE_OPTIONAL_NUMBER_KEYS) {
			const value = piece[key];
			checksum.addNumber(value === undefined ? 0 : 1);
			if (value !== undefined) checksum.addNumber(value);
		}
		yield;
	}
}

interface StartupMetadataGraphValueFrame {
	readonly kind: "value";
	readonly value: unknown;
}

interface StartupMetadataGraphArrayFrame {
	readonly kind: "array";
	readonly value: unknown[];
	readonly length: number;
	index: number;
}

type StartupMetadataGraphFrame = StartupMetadataGraphValueFrame | StartupMetadataGraphArrayFrame;

/** Iterative traversal avoids making hostile metadata depth part of the JavaScript call stack. */
function* appendStartupMetadataGraph(
	checksum: OrderedTypedChecksum,
	root: unknown,
	includeTypedContents: boolean,
	rootLabel: string,
): Generator<void> {
	const stack: StartupMetadataGraphFrame[] = [{ kind: "value", value: root }];
	const objectIds = new WeakMap<object, number>();
	let nextObjectId = 0;
	while (stack.length > 0) {
		const frame = stack.pop() as StartupMetadataGraphFrame;
		if (frame.kind === "array") {
			if (frame.index >= frame.length) continue;
			const index = frame.index++;
			const descriptor = captureCanonicalDenseArrayElement(
				frame.value,
				index,
				`Rail startup ${rootLabel} array`,
			);
			stack.push(frame, { kind: "value", value: descriptor.value });
			yield;
			continue;
		}
		const { value } = frame;
		if (value === null) {
			checksum.addCachedStrings(["null"]);
			yield;
			continue;
		}
		if (typeof value === "undefined") {
			checksum.addCachedStrings(["undefined"]);
			yield;
			continue;
		}
		if (typeof value === "string") {
			checksum.addCachedStrings(["string", value]);
			yield;
			continue;
		}
		if (typeof value === "boolean") {
			checksum.addCachedStrings(["boolean"]);
			checksum.addNumber(value ? 1 : 0);
			yield;
			continue;
		}
		if (typeof value === "number") {
			if (!Number.isFinite(value)) {
				throw new Error(`Rail startup ${rootLabel} contains a non-finite number.`);
			}
			checksum.addCachedStrings(["number"]);
			checksum.addNumber(value);
			yield;
			continue;
		}
		if (typeof value !== "object") {
			throw new Error(`Rail startup ${rootLabel} contains unsupported metadata.`);
		}
		const previousObjectId = objectIds.get(value);
		if (previousObjectId !== undefined) {
			checksum.addCachedStrings(["reference"]);
			checksum.addNumber(previousObjectId);
			yield;
			continue;
		}
		const objectId = nextObjectId++;
		objectIds.set(value, objectId);
		if (ArrayBuffer.isView(value)) {
			const typedView = captureMetadataTypedViewShape(value, rootLabel);
			checksum.addCachedStrings(["typed-view"]);
			checksum.addNumbers([objectId, typedView.kind, typedView.elementCount, typedView.byteLength]);
			if (includeTypedContents) checksum.addViews([value]);
			yield;
			continue;
		}
		if (value instanceof ArrayBuffer) {
			throw new Error(`Rail startup ${rootLabel} contains a direct buffer reference.`);
		}
		if (Array.isArray(value)) {
			const arrayLength = captureCanonicalDenseArrayLength(
				value,
				`Rail startup ${rootLabel} array`,
			);
			checksum.addCachedStrings(["array"]);
			checksum.addNumbers([objectId, arrayLength]);
			yield;
			if (arrayLength > 0) stack.push({ kind: "array", value, length: arrayLength, index: 0 });
			continue;
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error(`Rail startup ${rootLabel} contains a non-plain record.`);
		}
		const keys = Reflect.ownKeys(value);
		if (keys.length > 1_024 || keys.some((key) => typeof key !== "string")) {
			throw new Error(`Rail startup ${rootLabel} record fields are invalid.`);
		}
		const stringKeys = (keys as string[]).sort();
		checksum.addCachedStrings(["record", ...stringKeys]);
		checksum.addNumbers([objectId, stringKeys.length]);
		yield;
		for (let index = stringKeys.length - 1; index >= 0; index--) {
			const key = stringKeys[index] as string;
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
				throw new Error(`Rail startup ${rootLabel}.${key} must be enumerable data.`);
			}
			stack.push({ kind: "value", value: descriptor.value });
		}
	}
}

interface MetadataTypedViewShape {
	readonly kind: number;
	readonly elementCount: number;
	readonly byteLength: number;
}

function captureMetadataTypedViewShape(
	view: ArrayBufferView,
	label: string,
): MetadataTypedViewShape {
	const prototype = Object.getPrototypeOf(view);
	const constructors = [
		Int8Array,
		Uint8Array,
		Int16Array,
		Uint16Array,
		Int32Array,
		Uint32Array,
		Float32Array,
		Float64Array,
	] as const;
	const kind = constructors.findIndex(
		(typedArrayConstructor) => prototype === typedArrayConstructor.prototype,
	);
	if (kind < 0 || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
		throw new Error(`Rail startup ${label} typed view is invalid.`);
	}
	let byteLength: unknown;
	try {
		byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, view, []);
	} catch {
		throw new Error(`Rail startup ${label} typed view is invalid.`);
	}
	const bytesPerElement = constructors[kind]?.BYTES_PER_ELEMENT;
	if (
		typeof byteLength !== "number" ||
		bytesPerElement === undefined ||
		byteLength % bytesPerElement !== 0
	) {
		throw new Error(`Rail startup ${label} typed view shape is invalid.`);
	}
	return {
		kind,
		elementCount: byteLength / bytesPerElement,
		byteLength,
	};
}

/** Fixed-schema capture only; the potentially large plain graph is cloned cooperatively. */
function captureRailStartupTypedOwnership(canonical: RailStartupTransport): CaptureState {
	const state: CaptureState = {
		buffers: [],
		views: [],
		constructors: [],
		seenBuffers: new Set(),
	};
	assertExactRecord(
		canonical,
		[
			"snapshot",
			"analysis",
			"ownership",
			"physical",
			"readiness",
			"renderArtifacts",
			"draftArtifacts",
		],
		"startup transport",
	);
	captureSnapshot(canonical.snapshot, state);
	captureRecordViews(
		canonical.analysis,
		[
			"status",
			"cells",
			"edges",
			"components",
			"openEnds",
			"curves",
			"junctions",
			"unsafeJunctions",
			"strongComponents",
			"stronglyConnected",
			"minimumReturnLinks",
		],
		ANALYSIS_VIEWS,
		"startup analysis",
		state,
	);
	captureOwnership(canonical.ownership, state);
	capturePhysical(canonical.physical, state);
	captureReadiness(canonical.readiness, state);
	captureRender(canonical.physical, canonical.renderArtifacts, state);
	captureDraft(canonical.renderArtifacts, canonical.draftArtifacts, state);
	return state;
}

interface StartupCloneAssignment {
	readonly target: Record<string, unknown> | unknown[];
	readonly key: string;
	readonly viewIndex: number;
}

interface StartupCloneState {
	readonly checkpoint: (force?: boolean) => Promise<void>;
	readonly checkCancelled: () => void;
	readonly knownViewIndices: WeakMap<ArrayBufferView, number>;
	readonly assignments: StartupCloneAssignment[];
	readonly clones: WeakMap<object, unknown>;
	nodeCount: number;
	stringCharacters: number;
	operations: number;
}

/**
 * Adopt startup ownership without cloning a potentially 100k-row plain-object graph in one task.
 * Fixed typed buffers are exact-schema checked and transferred together; the detached source graph
 * is then copied cooperatively so cross-artifact aliases can be reconstructed without a second map
 * model. The Worker metadata digest later binds that copied plain generation.
 */
export async function adoptRailStartupTransportCooperatively<
	Transport extends RailStartupTransport,
>(
	canonical: Transport,
	checkpoint: (force?: boolean) => Promise<void>,
	checkCancelled: () => void,
): Promise<AdoptedRailStartupTransport<Transport>> {
	const initial = captureRailStartupTypedOwnership(canonical);
	const snapshotAnchors = {
		sequence: canonical.snapshot.sequence,
		revision: canonical.snapshot.revision,
		nextAdvancedSwitchId: canonical.snapshot.nextAdvancedSwitchId,
		checksum: canonical.snapshot.checksum,
	};
	checkCancelled();
	const adoptedViews: ArrayBufferView[] = [];
	for (
		let start = 0;
		start < initial.views.length;
		start += RAIL_STARTUP_TRANSFER_VIEWS_PER_BATCH
	) {
		const end = Math.min(start + RAIL_STARTUP_TRANSFER_VIEWS_PER_BATCH, initial.views.length);
		let batchBuffers: ArrayBuffer[];
		try {
			batchBuffers = structuredClone(initial.buffers.slice(start, end), {
				transfer: initial.buffers.slice(start, end),
			});
		} catch {
			throw new Error("Rail startup derived buffer ownership could not be adopted.");
		}
		for (let index = 0; index < batchBuffers.length; index++) {
			const ViewConstructor = initial.constructors[start + index];
			const buffer = batchBuffers[index];
			if (!ViewConstructor || !buffer) {
				throw new Error("Rail startup adopted buffer count does not match its exact contract.");
			}
			adoptedViews.push(new ViewConstructor(buffer));
		}
		checkCancelled();
		await checkpoint();
	}
	checkCancelled();
	assertTransferredSourceViewsHaveNoCustomOwnProperties(initial.views);
	if (adoptedViews.length !== initial.views.length) {
		throw new Error("Rail startup adopted view count does not match its exact contract.");
	}
	const knownViewIndices = new WeakMap<ArrayBufferView, number>();
	for (let index = 0; index < initial.views.length; index++) {
		knownViewIndices.set(initial.views[index] as ArrayBufferView, index);
	}
	const state: StartupCloneState = {
		checkpoint,
		checkCancelled,
		knownViewIndices,
		assignments: [],
		clones: new WeakMap(),
		nodeCount: 0,
		stringCharacters: 0,
		operations: 0,
	};
	const holder: { root?: unknown } = {};
	await cloneStartupValueInto(canonical, holder, "root", state);
	const cloned = holder.root as Transport;
	Object.assign(cloned.snapshot, snapshotAnchors);
	await validatePhysicalMetadataCooperatively(cloned.physical, checkpoint, checkCancelled);
	checkCancelled();
	for (const assignment of state.assignments) {
		assignment.target[assignment.key as never] = adoptedViews[assignment.viewIndex] as never;
	}
	validateRailStartupTransportAliases(cloned);
	checkCancelled();
	const value = Object.freeze(cloned);
	const token = Object.freeze({});
	railStartupTransportAdoptionBindings.set(
		token,
		Object.freeze({
			transport: value,
			snapshot: value.snapshot,
			xs: value.snapshot.xs,
			ys: value.snapshot.ys,
			encoded: value.snapshot.encoded,
			switchIds: value.snapshot.switchIds,
			switchRecords: value.snapshot.switchRecords,
			portEquipment: value.snapshot.portEquipment,
			organizations: value.snapshot.organizations,
			relationships: value.snapshot.relationships,
		}),
	);
	return Object.freeze({ value, authority: Object.freeze({ token }) });
}

function validateRailStartupTransportAliases(transport: RailStartupTransport): void {
	if (transport.renderArtifacts.presentation.source !== transport.physical.paths) {
		throw new Error("Startup render presentation source identity changed during adoption.");
	}
	if (
		transport.draftArtifacts.forwardAdjacency !== transport.renderArtifacts.adjacency ||
		transport.draftArtifacts.pathCellIndex !== transport.renderArtifacts.cellIndex
	) {
		throw new Error("Startup draft artifact alias identity changed during adoption.");
	}
}

async function cloneStartupValueInto(
	value: unknown,
	target: Record<string, unknown> | unknown[],
	key: string,
	state: StartupCloneState,
): Promise<void> {
	if (typeof value === "string") {
		state.stringCharacters += value.length;
		if (state.stringCharacters > 64 * 1024 * 1024) {
			throw new Error("Startup transport string budget exceeded.");
		}
		target[key as never] = value as never;
		await checkpointStartupClone(state);
		return;
	}
	if (
		value === null ||
		typeof value === "undefined" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		target[key as never] = value as never;
		await checkpointStartupClone(state);
		return;
	}
	if (typeof value !== "object") {
		throw new Error("Startup transport contains unsupported data.");
	}
	if (ArrayBuffer.isView(value)) {
		const viewIndex = state.knownViewIndices.get(value);
		if (viewIndex === undefined) {
			throw new Error("Startup transport contains an unknown typed view.");
		}
		target[key as never] = undefined as never;
		state.assignments.push({ target, key, viewIndex });
		await checkpointStartupClone(state);
		return;
	}
	if (value instanceof ArrayBuffer) {
		throw new Error("Startup transport contains a direct buffer reference.");
	}
	const existing = state.clones.get(value);
	if (existing !== undefined) {
		target[key as never] = existing as never;
		await checkpointStartupClone(state);
		return;
	}
	state.nodeCount++;
	if (state.nodeCount > 4_000_000) {
		throw new Error("Startup transport graph budget exceeded.");
	}
	// Records and arrays are work too: an invalid 100k array of empty records must still yield.
	await checkpointStartupClone(state);
	if (Array.isArray(value)) {
		// Exact own-key capture is intentionally strict but indivisible for factory-scale arrays.
		// Start it on a fresh cooperative slice instead of adding it to preceding graph work.
		await state.checkpoint(true);
		const arrayLength = captureCanonicalDenseArrayLength(value, "Startup transport arrays");
		const clone: unknown[] = new Array(arrayLength);
		state.clones.set(value, clone);
		target[key as never] = clone as never;
		for (let index = 0; index < arrayLength; index++) {
			const descriptor = captureCanonicalDenseArrayElement(
				value,
				index,
				"Startup transport arrays",
			);
			await cloneStartupValueInto(descriptor.value, clone, String(index), state);
		}
		await state.checkpoint(true);
		if (captureCanonicalDenseArrayLength(value, "Startup transport arrays") !== arrayLength) {
			throw new Error("Startup transport arrays changed during cooperative adoption.");
		}
		return;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error("Startup transport contains a non-plain object.");
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length > 1_024 || keys.some((entryKey) => typeof entryKey !== "string")) {
		throw new Error("Startup transport record fields exceed the exact contract.");
	}
	const clone = (prototype === null ? Object.create(null) : {}) as Record<string, unknown>;
	state.clones.set(value, clone);
	target[key as never] = clone as never;
	for (const entryKey of keys as string[]) {
		const descriptor = Object.getOwnPropertyDescriptor(value, entryKey);
		if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
			throw new Error("Startup transport fields must be enumerable data properties.");
		}
		await cloneStartupValueInto(descriptor.value, clone, entryKey, state);
	}
}

async function checkpointStartupClone(state: StartupCloneState): Promise<void> {
	state.operations++;
	if (state.operations % 128 !== 0) return;
	state.checkCancelled();
	await state.checkpoint();
	state.checkCancelled();
}

function captureSnapshot(snapshot: RailStartupPayload["snapshot"], state: CaptureState): void {
	assertExactRecord(
		snapshot,
		[
			"sequence",
			"revision",
			"nextAdvancedSwitchId",
			"xs",
			"ys",
			"encoded",
			"switchIds",
			"switchRecords",
			"portEquipment",
			"organizations",
			"relationships",
			"checksum",
		],
		"startup snapshot",
	);
	for (const [key, expectedConstructor] of [
		["xs", Int32Array],
		["ys", Int32Array],
		["encoded", Uint8Array],
		["switchIds", Int32Array],
	] as const) {
		captureView(snapshot[key], expectedConstructor, `startup snapshot ${key}`, state);
	}
	captureRecordViews(snapshot.switchRecords, [], SWITCH_RECORD_VIEWS, "switch records", state);
	const equipment = snapshot.portEquipment;
	assertExactRecord(
		equipment,
		[
			"schemaVersion",
			"nextPortId",
			"nextEquipmentGroupId",
			"portIds",
			"ports",
			"equipmentGroupIds",
			"equipmentGroups",
		],
		"port equipment snapshot",
	);
	captureView(equipment.portIds, Int32Array, "port ids", state);
	captureView(equipment.equipmentGroupIds, Int32Array, "equipment group ids", state);
	captureRecordViews(equipment.ports, ["barcodes"], PORT_RECORD_VIEWS, "port records", state);
	captureRecordViews(
		equipment.equipmentGroups,
		["recipes"],
		EQUIPMENT_GROUP_VIEWS,
		"equipment groups",
		state,
	);
	const organizations = snapshot.organizations;
	assertExactRecord(
		organizations,
		["schemaVersion", "nextOrganizationId", "organizationIds", "records"],
		"organization snapshot",
	);
	captureView(organizations.organizationIds, Int32Array, "organization ids", state);
	captureRecordViews(
		organizations.records,
		["names", "descriptions"],
		ORGANIZATION_RECORD_VIEWS,
		"organization records",
		state,
	);
	const relationships = snapshot.relationships;
	assertExactRecord(
		relationships,
		["schemaVersion", "nextRelationshipId", "relationshipIds", "records"],
		"assembly relationship snapshot",
	);
	captureView(relationships.relationshipIds, Int32Array, "assembly relationship ids", state);
	captureRecordViews(
		relationships.records,
		["scopedEdges"],
		ASSEMBLY_RELATIONSHIP_RECORD_VIEWS,
		"assembly relationship records",
		state,
	);
	captureRecordViews(
		relationships.records.scopedEdges,
		[],
		ASSEMBLY_RELATIONSHIP_SCOPED_EDGE_VIEWS,
		"assembly relationship scoped edges",
		state,
	);
}

function captureOwnership(
	ownership: RailStartupPayload["ownership"]["value"],
	state: CaptureState,
): void {
	captureRecordViews(ownership, ["revision", "modules"], OWNERSHIP_VIEWS, "ownership", state);
	captureRecordViews(
		ownership.modules,
		["moduleCount", "keys"],
		OWNERSHIP_MODULE_VIEWS,
		"ownership modules",
		state,
	);
}

function capturePhysical(layout: CompiledPhysicalLayout, state: CaptureState): void {
	assertExactRecord(
		layout,
		[
			"revision",
			"paths",
			"compoundProfiles",
			"pathIntervalRemap",
			"pieces",
			"junctions",
			"turnoutFootprints",
			"advancedSwitches",
			"clearance",
			"terminals",
			"counts",
			"valid",
			"diagnostics",
		],
		"physical layout",
	);
	captureRecordViews(
		layout.paths,
		[
			"revision",
			"sharedSegmentCount",
			"totalLengthMeters",
			"totalRouteLengthMeters",
			"pathCount",
			"pointCount",
		],
		PHYSICAL_PATH_VIEWS,
		"physical paths",
		state,
	);
	captureRecordViews(
		layout.compoundProfiles,
		["count"],
		COMPOUND_PROFILE_VIEWS,
		"compound profiles",
		state,
	);
	captureRecordViews(
		layout.pathIntervalRemap,
		["count", "sourcePathCount"],
		PATH_INTERVAL_REMAP_VIEWS,
		"path interval remap",
		state,
	);
	captureRecordViews(
		layout.turnoutFootprints,
		["count"],
		TURNOUT_FOOTPRINT_VIEWS,
		"turnout footprints",
		state,
	);
	captureRecordViews(
		layout.advancedSwitches,
		["count"],
		ADVANCED_SWITCH_VIEWS,
		"advanced switches",
		state,
	);
	assertExactRecord(layout.clearance, ["envelopes", "issues"], "rail clearance");
	captureRecordViews(
		layout.clearance.envelopes,
		["profileId", "profileVersion", "count"],
		CLEARANCE_ENVELOPE_VIEWS,
		"rail clearance envelopes",
		state,
	);
	captureRecordViews(
		layout.clearance.issues,
		["count", "candidateEnvelopePairs", "testedEnvelopePairs"],
		CLEARANCE_ISSUE_VIEWS,
		"rail clearance issues",
		state,
	);
}

async function validatePhysicalMetadataCooperatively(
	layout: CompiledPhysicalLayout,
	checkpoint: () => Promise<void>,
	checkCancelled: () => void,
): Promise<void> {
	let operations = 0;
	const tick = async (): Promise<void> => {
		operations++;
		if (operations % 128 !== 0) return;
		checkCancelled();
		await checkpoint();
		checkCancelled();
	};
	assertExactRecord(layout.counts, PHYSICAL_PIECE_COUNT_KEYS, "physical piece counts");
	validatePhysicalPieceCounts(layout.counts);
	const pieceRequired = ["id", "type", "cells", "from", "to", "lengthMeters", "radiusMillimeters"];
	const pieceAllowed = [
		...pieceRequired,
		"geometryKind",
		"fitKind",
		"nominalProfileId",
		"rotationDegrees",
		"leadInMillimeters",
		"leadOutMillimeters",
		"middleMillimeters",
		"nominalLengthMeters",
		"leadInResidualMillimeters",
		"leadOutResidualMillimeters",
		"middleResidualMillimeters",
		"lengthResidualMillimeters",
		"forwardFitDeltaMillimeters",
		"lateralFitDeltaMillimeters",
		"turn",
		"role",
		"physicalPathIndex",
		"advancedSwitchId",
		"advancedSwitchProfileClass",
		"advancedSwitchSegmentRole",
		"advancedSwitchPortIndex",
		"advancedSwitchSegmentOrdinal",
	];
	for (let index = 0; index < layout.pieces.length; index++) {
		const piece = layout.pieces[index];
		assertRecordKeyContract(piece, pieceRequired, pieceAllowed, `physical piece ${index}`);
		validatePhysicalPieceScalarMetadata(piece, index);
		assertCell(piece.from, `physical piece ${index} from`);
		assertCell(piece.to, `physical piece ${index} to`);
		for (let cellIndex = 0; cellIndex < piece.cells.length; cellIndex++) {
			assertCell(piece.cells[cellIndex], `physical piece ${index} cell ${cellIndex}`);
			await tick();
		}
		await tick();
	}
	const junctionRequired = [
		"id",
		"type",
		"cell",
		"incoming",
		"outgoing",
		"through",
		"divergingSide",
		"tangentSide",
		"profileId",
		"leadInMillimeters",
		"leadOutMillimeters",
		"radiusMillimeters",
		"footprintCells",
		"trunkPathIndex",
		"divergePathIndex",
	];
	for (let index = 0; index < layout.junctions.length; index++) {
		const junction = layout.junctions[index];
		assertRecordKeyContract(
			junction,
			junctionRequired,
			[...junctionRequired, "advancedSwitchId"],
			`physical junction ${index}`,
		);
		assertCell(junction.cell, `physical junction ${index} cell`);
		assertExactRecord(
			junction.through,
			["incoming", "outgoing"],
			`physical junction ${index} route`,
		);
		for (let cellIndex = 0; cellIndex < junction.footprintCells.length; cellIndex++) {
			assertCell(
				junction.footprintCells[cellIndex],
				`physical junction ${index} footprint ${cellIndex}`,
			);
			await tick();
		}
		await tick();
	}
	for (let index = 0; index < layout.terminals.length; index++) {
		assertCell(layout.terminals[index], `physical terminal ${index}`);
		await tick();
	}
	const diagnosticRequired = ["code", "cell", "message"];
	for (let index = 0; index < layout.diagnostics.length; index++) {
		const diagnostic = layout.diagnostics[index];
		assertRecordKeyContract(
			diagnostic,
			diagnosticRequired,
			[...diagnosticRequired, "cells", "direction", "switchId", "inputIndex", "outputIndex"],
			`physical diagnostic ${index}`,
		);
		assertCell(diagnostic.cell, `physical diagnostic ${index} cell`);
		for (let cellIndex = 0; cellIndex < (diagnostic.cells?.length ?? 0); cellIndex++) {
			assertCell(diagnostic.cells?.[cellIndex], `physical diagnostic ${index} related cell`);
			await tick();
		}
		await tick();
	}
	checkCancelled();
	await checkpoint();
	checkCancelled();
}

function validatePhysicalPieceCounts(counts: CompiledPhysicalLayout["counts"]): void {
	for (const key of PHYSICAL_PIECE_COUNT_KEYS) {
		const count = counts[key];
		if (!Number.isSafeInteger(count) || count < 0) {
			throw new Error(`Physical piece count ${key} is invalid.`);
		}
	}
}

function validatePhysicalPieceScalarMetadata(
	piece: CompiledPhysicalLayout["pieces"][number],
	index: number,
): void {
	if (typeof piece.id !== "string" || !PHYSICAL_PIECE_TYPES.has(piece.type)) {
		throw new Error(`Physical piece ${index} identity metadata is invalid.`);
	}
	if (!Number.isFinite(piece.lengthMeters) || piece.lengthMeters < 0) {
		throw new Error(`Physical piece ${index} length is invalid.`);
	}
	if (
		piece.radiusMillimeters !== null &&
		(!Number.isFinite(piece.radiusMillimeters) || piece.radiusMillimeters < 0)
	) {
		throw new Error(`Physical piece ${index} radius is invalid.`);
	}
	for (const key of ["geometryKind", "fitKind", "nominalProfileId", "turn", "role"] as const) {
		const value = piece[key];
		if (value !== undefined && typeof value !== "string") {
			throw new Error(`Physical piece ${index} ${key} metadata is invalid.`);
		}
	}
	for (const key of [
		"rotationDegrees",
		"leadInMillimeters",
		"leadOutMillimeters",
		"middleMillimeters",
		"nominalLengthMeters",
		"leadInResidualMillimeters",
		"leadOutResidualMillimeters",
		"middleResidualMillimeters",
		"lengthResidualMillimeters",
		"forwardFitDeltaMillimeters",
		"lateralFitDeltaMillimeters",
		"physicalPathIndex",
		"advancedSwitchId",
		"advancedSwitchProfileClass",
		"advancedSwitchSegmentRole",
		"advancedSwitchPortIndex",
		"advancedSwitchSegmentOrdinal",
	] as const) {
		const value = piece[key];
		if (value !== undefined && !Number.isFinite(value)) {
			throw new Error(`Physical piece ${index} ${key} metadata is invalid.`);
		}
	}
}

function captureReadiness(
	readiness: RailStartupPayload["readiness"]["value"],
	state: CaptureState,
): void {
	assertExactRecord(
		readiness,
		[
			"version",
			"status",
			"ready",
			"authoredChecksum",
			"topologyFingerprint",
			"fingerprint",
			"summary",
			"locations",
			"issues",
		],
		"project readiness",
	);
	assertExactRecord(
		readiness.summary,
		[
			"cells",
			"edges",
			"physicalPaths",
			"closure",
			"weakComponents",
			"strongComponents",
			"minimumReturnLinks",
			"openTerminals",
			"junctions",
			"unsupportedJunctions",
			"topologyErrors",
			"physicalTerminals",
			"physicalOpenPaths",
			"physicalStrongComponents",
			"invalidPhysicalPaths",
			"clearanceIssues",
		],
		"project readiness summary",
	);
	captureRecordViews(
		readiness.locations,
		[],
		READINESS_LOCATION_VIEWS,
		"project readiness locations",
		state,
	);
	if (!Array.isArray(readiness.issues) || readiness.issues.length > MAX_READINESS_ISSUES) {
		throw new Error("Project readiness issue count exceeds the startup contract.");
	}
	for (let issueIndex = 0; issueIndex < readiness.issues.length; issueIndex++) {
		const issue = readiness.issues[issueIndex];
		assertExactRecord(
			issue,
			["id", "code", "sourceCode", "message", "affectedCount", "cells", "pathIdentities"],
			`project readiness issue ${issueIndex}`,
		);
		if (
			!READINESS_ISSUE_CODES.has(issue.code) ||
			!Array.isArray(issue.cells) ||
			issue.cells.length > MAX_READINESS_ISSUE_SAMPLES ||
			!Array.isArray(issue.pathIdentities) ||
			issue.pathIdentities.length > MAX_READINESS_ISSUE_SAMPLES
		) {
			throw new Error(`Project readiness issue ${issueIndex} detail shape is invalid.`);
		}
		for (let row = 0; row < issue.pathIdentities.length; row++) {
			const identity = issue.pathIdentities[row];
			captureView(
				identity,
				Int32Array,
				`project readiness issue ${issueIndex} path identity ${row}`,
				state,
			);
			if (
				captureMetadataTypedViewShape(
					identity,
					`project readiness issue ${issueIndex} path identity ${row}`,
				).elementCount !== PHYSICAL_PATH_IDENTITY_WIDTH
			) {
				throw new Error(
					`Project readiness issue ${issueIndex} path identity ${row} has invalid width.`,
				);
			}
		}
	}
}

function captureRender(
	physical: CompiledPhysicalLayout,
	render: RailStartupPayload["renderArtifacts"]["value"],
	state: CaptureState,
): void {
	assertExactRecord(
		render,
		[
			"revision",
			"pathCount",
			"presentation",
			"spatialIndex",
			"cellIndex",
			"adjacency",
			"decorationCounts",
		],
		"render artifacts",
	);
	assertExactRecord(
		render.presentation,
		["source", "profile", "pointNormals", "runs", "decorations", "maxLateralExtentMeters"],
		"rail presentation",
	);
	if (render.presentation.source !== physical.paths) {
		throw new Error("Startup render presentation source identity is invalid.");
	}
	assertExactRecord(
		render.presentation.profile,
		[
			"id",
			"version",
			"engineeringStatus",
			"constructionShadowWidthMeters",
			"bedWidthMeters",
			"beamCenterOffsetMeters",
			"beamWidthMeters",
			"beamHighlightWidthMeters",
			"slotWidthMeters",
			"jointIntervalMeters",
			"jointHalfSpanMeters",
			"supportIntervalMeters",
			"supportHalfSpanMeters",
			"supportJointExclusionMeters",
			"supportCurvatureProbeMeters",
			"supportMinimumTangentDot",
			"flowIntervalMeters",
			"flowHardwareExclusionMeters",
		],
		"rail presentation profile",
	);
	captureView(render.presentation.pointNormals, Float32Array, "presentation point normals", state);
	captureRecordViews(render.presentation.runs, ["count"], RUN_VIEWS, "presentation runs", state);
	captureRecordViews(
		render.presentation.decorations,
		["count"],
		DECORATION_VIEWS,
		"presentation decorations",
		state,
	);
	captureRecordViews(
		render.spatialIndex,
		["pathCount", "chunkSizeMeters"],
		SPATIAL_INDEX_VIEWS,
		"render spatial index",
		state,
	);
	captureRecordViews(render.cellIndex, ["keyWidth"], INT32_CSR_VIEWS, "render cell index", state);
	captureRecordViews(render.adjacency, [], ADJACENCY_VIEWS, "render adjacency", state);
	assertExactRecord(
		render.decorationCounts,
		["joints", "supports", "flowMarkers"],
		"render decoration counts",
	);
}

function captureDraft(
	render: RailStartupPayload["renderArtifacts"]["value"],
	draft: RailStartupPayload["draftArtifacts"]["value"],
	state: CaptureState,
): void {
	assertExactRecord(
		draft,
		[
			"revision",
			"pathCount",
			"envelopeCount",
			"envelopeSpatialIndex",
			"pathCellIndex",
			"pathSwitchIndex",
			"pathIdentityIndex",
			"forwardAdjacency",
			"reverseAdjacency",
		],
		"draft artifacts",
	);
	if (draft.forwardAdjacency !== render.adjacency || draft.pathCellIndex !== render.cellIndex) {
		throw new Error("Startup draft artifact alias identity is invalid.");
	}
	captureRecordViews(
		draft.envelopeSpatialIndex,
		["envelopeCount", "chunkSizeMeters"],
		ENVELOPE_SPATIAL_INDEX_VIEWS,
		"draft envelope spatial index",
		state,
	);
	captureRecordViews(
		draft.pathSwitchIndex,
		["keyWidth"],
		INT32_CSR_VIEWS,
		"draft switch index",
		state,
	);
	captureRecordViews(
		draft.pathIdentityIndex,
		["keyWidth"],
		INT32_CSR_VIEWS,
		"draft identity index",
		state,
	);
	captureRecordViews(draft.reverseAdjacency, [], ADJACENCY_VIEWS, "draft reverse adjacency", state);
}

function captureRecordViews(
	record: unknown,
	scalarKeys: readonly string[],
	viewSchema: ViewSchema,
	label: string,
	state: CaptureState,
): void {
	const viewKeys = Object.keys(viewSchema);
	assertExactRecord(record, [...scalarKeys, ...viewKeys], label);
	const source = record as Readonly<Record<string, unknown>>;
	for (const key of viewKeys) {
		captureView(
			source[key],
			viewSchema[key] as ExactTypedArrayConstructor,
			`${label} ${key}`,
			state,
		);
	}
}

function captureView(
	value: unknown,
	expected: ExactTypedArrayConstructor,
	label: string,
	state: CaptureState,
): void {
	if (
		!ArrayBuffer.isView(value) ||
		Object.getPrototypeOf(value) !== expected.prototype ||
		TYPED_ARRAY_BUFFER_GETTER === undefined ||
		TYPED_ARRAY_BYTE_OFFSET_GETTER === undefined ||
		TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined
	) {
		throw new Error(`${label} must use an exact ${expected.name}.`);
	}
	for (const key of ["buffer", "byteOffset", "byteLength", "length"] as const) {
		if (Object.getOwnPropertyDescriptor(value, key) !== undefined) {
			throw new Error(`${label} shadows typed-array ownership fields.`);
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
		throw new Error(`${label} typed-array ownership is invalid.`);
	}
	if (!(buffer instanceof ArrayBuffer) || ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) {
		throw new Error(`${label} must own one unique fixed full ArrayBuffer.`);
	}
	let bufferPrototype: object | null;
	let bufferOwnKeys: readonly PropertyKey[];
	try {
		bufferPrototype = Object.getPrototypeOf(buffer);
		bufferOwnKeys = Reflect.ownKeys(buffer);
	} catch {
		throw new Error(`${label} ArrayBuffer ownership is invalid.`);
	}
	if (bufferPrototype !== ArrayBuffer.prototype || bufferOwnKeys.length !== 0) {
		throw new Error(`${label} must own one exact property-free ArrayBuffer.`);
	}
	for (const key of ["byteLength", "resizable", "maxByteLength"] as const) {
		if (Object.getOwnPropertyDescriptor(buffer, key) !== undefined) {
			throw new Error(`${label} shadows ArrayBuffer ownership fields.`);
		}
	}
	let bufferByteLength: unknown;
	try {
		bufferByteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
	} catch {
		throw new Error(`${label} ArrayBuffer ownership is invalid.`);
	}
	if (
		!arrayBufferIsFixed(buffer) ||
		byteOffset !== 0 ||
		byteLength !== bufferByteLength ||
		state.seenBuffers.has(buffer)
	) {
		throw new Error(`${label} must own one unique fixed full ArrayBuffer.`);
	}
	state.seenBuffers.add(buffer);
	state.views.push(value);
	state.constructors.push(expected);
	state.buffers.push(buffer);
}

function captureCanonicalDenseArrayLength(value: unknown[], label: string): number {
	let prototype: object | null;
	let lengthDescriptor: PropertyDescriptor | undefined;
	try {
		prototype = Object.getPrototypeOf(value);
		lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	} catch {
		throw new Error(`${label} structure is invalid.`);
	}
	if (
		prototype !== Array.prototype ||
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		lengthDescriptor.value < 0 ||
		lengthDescriptor.value > 4_000_000
	) {
		throw new Error(`${label} does not match the exact contract.`);
	}
	let hasEnumerableInheritedField = false;
	try {
		for (
			let inherited = Array.prototype as object | null;
			inherited !== null;
			inherited = Object.getPrototypeOf(inherited)
		) {
			if (Object.keys(inherited).length !== 0) {
				hasEnumerableInheritedField = true;
				break;
			}
		}
	} catch {
		throw new Error(`${label} structure is invalid.`);
	}
	if (hasEnumerableInheritedField) {
		throw new Error(`${label} cannot inherit enumerable fields.`);
	}
	const length = lengthDescriptor.value as number;
	let ownKeyCount: number;
	try {
		ownKeyCount = Reflect.ownKeys(value).length;
	} catch {
		throw new Error(`${label} structure is invalid.`);
	}
	if (ownKeyCount !== length + 1) {
		throw new Error(`${label} cannot contain custom fields.`);
	}
	if (lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false) {
		throw new Error(`${label} length descriptor is not canonical.`);
	}
	return length;
}

function captureCanonicalDenseArrayElement(
	value: unknown[],
	index: number,
	label: string,
): PropertyDescriptor & { readonly value: unknown } {
	let descriptor: PropertyDescriptor | undefined;
	try {
		descriptor = Object.getOwnPropertyDescriptor(value, String(index));
	} catch {
		throw new Error(`${label} structure is invalid.`);
	}
	if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
		throw new Error(`${label} must contain dense canonical data.`);
	}
	return descriptor as PropertyDescriptor & { readonly value: unknown };
}

/**
 * Detachment removes every canonical integer-indexed own key without walking bulk elements.
 * Any key that remains is therefore a custom string, symbol, or non-enumerable property that a
 * structured clone would otherwise silently discard.
 */
function assertTransferredSourceViewsHaveNoCustomOwnProperties(
	views: readonly ArrayBufferView[],
): void {
	for (const view of views) {
		let ownKeyCount: number;
		try {
			ownKeyCount = Reflect.ownKeys(view).length;
		} catch {
			throw new Error("Rail startup typed-view structure is invalid.");
		}
		if (ownKeyCount !== 0) {
			throw new Error("Rail startup typed views cannot contain custom own properties.");
		}
	}
}

function assertExactRecord(value: unknown, expectedKeys: readonly string[], label: string): void {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be a plain record.`);
	}
	let prototype: object | null;
	let keys: readonly PropertyKey[];
	try {
		prototype = Object.getPrototypeOf(value);
		keys = Reflect.ownKeys(value);
	} catch {
		throw new Error(`${label} record structure is invalid.`);
	}
	if (
		(prototype !== Object.prototype && prototype !== null) ||
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
	) {
		throw new Error(`${label} fields do not match the startup contract.`);
	}
	for (const key of expectedKeys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
			throw new Error(`${label} field ${key} is not an enumerable data property.`);
		}
	}
}

function assertRecordKeyContract(
	value: unknown,
	requiredKeys: readonly string[],
	allowedKeys: readonly string[],
	label: string,
): void {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	const keys = Reflect.ownKeys(value);
	if (
		(prototype !== Object.prototype && prototype !== null) ||
		requiredKeys.some((key) => !keys.includes(key)) ||
		keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))
	) {
		throw new Error(`${label} fields do not match the startup contract.`);
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
			throw new Error(`${label} fields must be enumerable data properties.`);
		}
	}
}

function assertCell(value: unknown, label: string): void {
	assertExactRecord(value, ["x", "y"], label);
}

function arrayBufferIsFixed(buffer: ArrayBuffer): boolean {
	if (ARRAY_BUFFER_RESIZABLE_GETTER === undefined) return true;
	try {
		return Reflect.apply(ARRAY_BUFFER_RESIZABLE_GETTER, buffer, []) === false;
	} catch {
		return false;
	}
}
