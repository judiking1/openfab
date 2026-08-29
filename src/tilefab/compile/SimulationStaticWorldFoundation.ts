import {
	collectPortEquipmentIntegrityIssues,
	type EquipmentGroupRecord,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { PortRecord } from "../core/PortRecord";
import type { CompiledAdvancedSwitches } from "./AdvancedSwitchCompiler";
import { validateCompiledAdvancedSwitches } from "./AdvancedSwitchCompiler";
import { compilePhysicalPathCanonicalOwnership } from "./PhysicalPathCanonicalOwnership";
import { buildPhysicalPathAdjacency } from "./PhysicalPathFlow";
import { PHYSICAL_PATH_IDENTITY_WIDTH, physicalPathIdentityField } from "./PhysicalPathIdentity";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";
import {
	createPortAttachmentSourceIndex,
	resolvePortAttachmentWithSourceIndex,
} from "./PortAttachmentResolver";
import type { CompiledRailEnvelopes } from "./RailClearanceCompiler";
import { checksumRailProjectReadiness, type RailProjectReadiness } from "./RailProjectReadiness";

export const SIMULATION_STATIC_WORLD_FOUNDATION_SCHEMA_VERSION = 2;

export const SIMULATION_FOUNDATION_MISSING_LAYERS = [
	"OCCUPANCY_POLICY",
	"PORT_OPERATIONAL_CAPABILITIES",
	"RESOURCE_CONFIGURATION",
	"EDIT_POLICY_CERTIFICATE",
	"WORKER_PUBLICATION",
] as const;

export type SimulationFoundationMissingLayer =
	(typeof SIMULATION_FOUNDATION_MISSING_LAYERS)[number];

export const SIMULATION_STATION_TYPE_CODE = Object.freeze({ OHB: 0, EQ: 1, STK: 2 } as const);
export const SIMULATION_STATION_GEOMETRIC_DIRECTION_CODE = Object.freeze({
	WITH_TRAVEL: 0,
	AGAINST_TRAVEL: 1,
} as const);
export const SIMULATION_STATION_SIDE_CODE = Object.freeze({
	CENTER: 0,
	LEFT: 1,
	RIGHT: 2,
} as const);
export const SIMULATION_EQUIPMENT_GROUP_KIND_CODE = SIMULATION_STATION_TYPE_CODE;
export const SIMULATION_EQUIPMENT_TEMPLATE_CODE = Object.freeze({
	OHB_SINGLE: 0,
	EQ: 1,
	STK_CUSTOM: 2,
	STK_FLEX: 3,
	STK_FOUR_PORT: 4,
	STK_SIX_PORT: 5,
	STK_BACK_TO_BACK: 6,
} as const);

export interface SimulationStaticWorldFoundationSource {
	readonly patchSequence: number;
	readonly revision: number;
	readonly authoredChecksum: string;
	readonly physicalFingerprint: string;
	readonly readinessFingerprint: string;
}

export interface SimulationStaticWorldPathGraph {
	readonly pathCount: number;
	readonly pointCount: number;
	readonly identities: Int32Array;
	readonly offsets: Uint32Array;
	readonly positions: Float32Array;
	readonly tangents: Float32Array;
	readonly distances: Float32Array;
	readonly lengths: Float32Array;
	readonly adjacencyOffsets: Uint32Array;
	readonly adjacencyTargets: Uint32Array;
	readonly sharedSegmentCount: number;
	readonly sharedSegmentOffsets: Uint32Array;
	readonly sharedSegmentIds: Uint32Array;
	readonly sharedSegmentStarts: Float32Array;
	readonly sharedSegmentEnds: Float32Array;
	/** Canonical geometry owner path for every shared-segment occurrence row. */
	readonly sharedOwnerPathRows: Uint32Array;
}

export interface SimulationStaticWorldStations {
	readonly count: number;
	readonly ids: Uint32Array;
	readonly equipmentGroupIds: Uint32Array;
	readonly typeCodes: Uint8Array;
	/** Geometric facing only. This is deliberately not an operational transfer capability. */
	readonly geometricDirectionCodes: Uint8Array;
	readonly sideCodes: Uint8Array;
	readonly canonicalStationsMillimeters: Uint32Array;
	readonly lateralOffsetsMillimeters: Uint32Array;
	readonly finalPathIndices: Uint32Array;
	readonly finalPathStationsMeters: Float32Array;
	readonly worldPositions: Float32Array;
	readonly tangents: Float32Array;
	readonly yawRadians: Float32Array;
	readonly barcodes: readonly (string | null)[];
}

export interface SimulationStaticWorldEquipmentGroups {
	readonly count: number;
	readonly ids: Uint32Array;
	readonly kindCodes: Uint8Array;
	readonly portOffsets: Uint32Array;
	readonly portIds: Uint32Array;
	readonly templateCodes: Uint8Array;
	readonly eqPitchMillimeters: Uint16Array;
	readonly eqRecipes: readonly (string | null)[];
}

export interface SimulationStaticWorldFoundation {
	readonly schemaVersion: typeof SIMULATION_STATIC_WORLD_FOUNDATION_SCHEMA_VERSION;
	/** This artifact is an input foundation, never an authorization to run vehicles. */
	readonly simulationReady: false;
	readonly missingLayers: readonly SimulationFoundationMissingLayer[];
	readonly source: SimulationStaticWorldFoundationSource;
	readonly paths: SimulationStaticWorldPathGraph;
	readonly switches: CompiledAdvancedSwitches;
	readonly stations: SimulationStaticWorldStations;
	readonly equipmentGroups: SimulationStaticWorldEquipmentGroups;
	/** Clearance capsules are motion-envelope precursors, not occupancy zones. */
	readonly motionEnvelopes: CompiledRailEnvelopes;
	readonly fingerprint: string;
	/** Sum of owned transferable typed-array bytes. */
	readonly byteLength: number;
}

export interface CompileSimulationStaticWorldFoundationInput {
	readonly patchSequence: number;
	readonly authoredChecksum: string;
	readonly physicalFingerprint: string;
	readonly readiness: RailProjectReadiness;
	readonly physical: CompiledPhysicalLayout;
	readonly portEquipment: PortEquipmentState;
}

export function compileSimulationStaticWorldFoundation(
	input: CompileSimulationStaticWorldFoundationInput,
): SimulationStaticWorldFoundation {
	assertSourceInput(input);
	const { physical } = input;
	const paths = compilePathGraph(physical);
	const switches = cloneCompiledAdvancedSwitches(physical.advancedSwitches);
	const stations = compileStations(physical, input.portEquipment);
	const equipmentGroups = compileEquipmentGroups(input.portEquipment.equipmentGroups);
	const motionEnvelopes = cloneRailEnvelopes(physical.clearance.envelopes);
	const foundationWithoutIdentity = {
		schemaVersion: SIMULATION_STATIC_WORLD_FOUNDATION_SCHEMA_VERSION,
		simulationReady: false,
		missingLayers: Object.freeze([...SIMULATION_FOUNDATION_MISSING_LAYERS]),
		source: Object.freeze({
			patchSequence: input.patchSequence,
			revision: physical.revision,
			authoredChecksum: input.authoredChecksum,
			physicalFingerprint: input.physicalFingerprint,
			readinessFingerprint: input.readiness.fingerprint,
		}),
		paths: Object.freeze(paths),
		switches: Object.freeze(switches),
		stations: Object.freeze(stations),
		equipmentGroups: Object.freeze(equipmentGroups),
		motionEnvelopes: Object.freeze(motionEnvelopes),
	} as const;
	const views = simulationStaticWorldFoundationViews(foundationWithoutIdentity);
	const foundation = {
		...foundationWithoutIdentity,
		fingerprint: checksumSimulationStaticWorldFoundation(foundationWithoutIdentity),
		byteLength: sumByteLengths(views),
	} satisfies SimulationStaticWorldFoundation;
	const error = simulationStaticWorldFoundationError(foundation);
	if (error) throw new Error(`Compiled simulation static-world foundation is invalid: ${error}`);
	return Object.freeze(foundation);
}

export function checksumSimulationStaticWorldFoundation(
	foundation: Omit<SimulationStaticWorldFoundation, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		foundation.schemaVersion,
		foundation.simulationReady ? 1 : 0,
		foundation.source.patchSequence,
		foundation.source.revision,
		foundation.paths.pathCount,
		foundation.paths.pointCount,
		foundation.paths.sharedSegmentCount,
		foundation.switches.count,
		foundation.stations.count,
		foundation.equipmentGroups.count,
		foundation.motionEnvelopes.profileVersion,
		foundation.motionEnvelopes.count,
	]);
	checksum.addStrings([
		...foundation.missingLayers,
		foundation.source.authoredChecksum,
		foundation.source.physicalFingerprint,
		foundation.source.readinessFingerprint,
		foundation.motionEnvelopes.profileId,
	]);
	checksum.addViews(simulationStaticWorldFoundationViews(foundation));
	checksum.addStrings(foundation.stations.barcodes.map((barcode) => barcode ?? ""));
	checksum.addStrings(foundation.equipmentGroups.eqRecipes.map((recipe) => recipe ?? ""));
	return checksum.digest();
}

export function simulationStaticWorldFoundationError(value: unknown): string | null {
	if (!isRecord(value)) return "foundation must be an object";
	if (value.schemaVersion !== SIMULATION_STATIC_WORLD_FOUNDATION_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationReady !== false) return "foundation cannot authorize simulation";
	if (!sameStrings(value.missingLayers, SIMULATION_FOUNDATION_MISSING_LAYERS)) {
		return "missing-layer declaration is invalid";
	}
	if (!isRecord(value.source)) return "source identity is invalid";
	if (!isNonNegativeSafeInteger(value.source.patchSequence)) return "patch sequence is invalid";
	if (!isNonNegativeSafeInteger(value.source.revision)) return "revision is invalid";
	if (
		!isNonEmptyString(value.source.authoredChecksum) ||
		!isNonEmptyString(value.source.physicalFingerprint) ||
		!isNonEmptyString(value.source.readinessFingerprint)
	) {
		return "source fingerprints are invalid";
	}
	if (!isPathGraph(value.paths)) return "path graph is invalid";
	if (!isSwitchSnapshot(value.switches, value.paths.pathCount)) return "switch snapshot is invalid";
	if (!isStationSnapshot(value.stations, value.paths.pathCount))
		return "station snapshot is invalid";
	if (!isEquipmentGroupSnapshot(value.equipmentGroups)) {
		return "equipment-group snapshot is invalid";
	}
	if (!isMotionEnvelopeSnapshot(value.motionEnvelopes, value.paths.pathCount)) {
		return "motion-envelope snapshot is invalid";
	}
	if (!isNonNegativeSafeInteger(value.byteLength) || !isNonEmptyString(value.fingerprint)) {
		return "foundation identity is invalid";
	}
	const foundation = value as unknown as SimulationStaticWorldFoundation;
	const views = simulationStaticWorldFoundationViews(foundation);
	if (!hasDistinctOwnedBuffers(views)) return "typed arrays must own distinct buffers";
	if (sumByteLengths(views) !== foundation.byteLength) return "byte length does not match buffers";
	try {
		if (checksumSimulationStaticWorldFoundation(foundation) !== foundation.fingerprint) {
			return "fingerprint does not match foundation contents";
		}
	} catch {
		return "foundation fingerprint cannot be computed";
	}
	return null;
}

export function isSimulationStaticWorldFoundation(
	value: unknown,
): value is SimulationStaticWorldFoundation {
	return simulationStaticWorldFoundationError(value) === null;
}

function assertSourceInput(input: CompileSimulationStaticWorldFoundationInput): void {
	if (!isNonNegativeSafeInteger(input.patchSequence)) {
		throw new Error("Simulation foundation patch sequence must be a non-negative safe integer.");
	}
	if (!isNonEmptyString(input.authoredChecksum) || !isNonEmptyString(input.physicalFingerprint)) {
		throw new Error("Simulation foundation source fingerprints must be non-empty strings.");
	}
	if (input.readiness.fingerprint !== checksumRailProjectReadiness(input.readiness)) {
		throw new Error("Simulation foundation readiness fingerprint is corrupt.");
	}
	if (!input.readiness.ready || input.readiness.status !== "ready") {
		throw new Error("Simulation foundation requires a rail project with static readiness.");
	}
	if (input.readiness.authoredChecksum !== input.authoredChecksum) {
		throw new Error("Simulation foundation authored checksum does not match rail readiness.");
	}
	if (input.physical.revision !== input.physical.paths.revision) {
		throw new Error("Simulation foundation physical revisions do not match.");
	}
	if (
		!input.physical.valid ||
		input.physical.diagnostics.length > 0 ||
		input.physical.terminals.length > 0 ||
		input.physical.clearance.issues.count > 0
	) {
		throw new Error("Simulation foundation requires a valid closed physical rail layout.");
	}
	if (input.readiness.summary.physicalPaths !== input.physical.paths.pathCount) {
		throw new Error("Simulation foundation path count does not match rail readiness.");
	}
	const switchIssues = validateCompiledAdvancedSwitches(
		input.physical.advancedSwitches,
		input.physical.paths,
		input.physical.pathIntervalRemap,
	);
	if (switchIssues.length > 0) {
		throw new Error(
			`Simulation foundation switch snapshot is invalid: ${switchIssues[0]?.message}`,
		);
	}
	const equipmentIssues = collectPortEquipmentIntegrityIssues(input.portEquipment);
	if (equipmentIssues.length > 0) {
		throw new Error(
			`Simulation foundation port/equipment state is invalid: ${equipmentIssues[0]?.message}`,
		);
	}
}

function compilePathGraph(physical: CompiledPhysicalLayout): SimulationStaticWorldPathGraph {
	const source = physical.paths;
	const identities = new Int32Array(source.pathCount * PHYSICAL_PATH_IDENTITY_WIDTH);
	for (let pathIndex = 0; pathIndex < source.pathCount; pathIndex++) {
		const rowOffset = pathIndex * PHYSICAL_PATH_IDENTITY_WIDTH;
		for (let field = 0; field < PHYSICAL_PATH_IDENTITY_WIDTH; field++) {
			identities[rowOffset + field] = physicalPathIdentityField(source, pathIndex, field);
		}
	}
	const adjacency = buildPhysicalPathAdjacency(source);
	const canonicalOwnership = compilePhysicalPathCanonicalOwnership(source);
	return {
		pathCount: source.pathCount,
		pointCount: source.pointCount,
		identities,
		offsets: source.offsets.slice(),
		positions: source.positions.slice(),
		tangents: source.tangents.slice(),
		distances: source.distances.slice(),
		lengths: source.lengths.slice(),
		adjacencyOffsets: adjacency.offsets.slice(),
		adjacencyTargets: adjacency.targets.slice(),
		sharedSegmentCount: source.sharedSegmentCount,
		sharedSegmentOffsets: source.sharedSegmentOffsets.slice(),
		sharedSegmentIds: source.sharedSegmentIds.slice(),
		sharedSegmentStarts: source.sharedSegmentStarts.slice(),
		sharedSegmentEnds: source.sharedSegmentEnds.slice(),
		sharedOwnerPathRows: canonicalOwnership.sharedOwnerPathRows.slice(),
	};
}

function compileStations(
	physical: CompiledPhysicalLayout,
	state: PortEquipmentState,
): SimulationStaticWorldStations {
	const ports = [...state.ports].sort((left, right) => left.id - right.id);
	const count = ports.length;
	const ids = new Uint32Array(count);
	const equipmentGroupIds = new Uint32Array(count);
	const typeCodes = new Uint8Array(count);
	const geometricDirectionCodes = new Uint8Array(count);
	const sideCodes = new Uint8Array(count);
	const canonicalStationsMillimeters = new Uint32Array(count);
	const lateralOffsetsMillimeters = new Uint32Array(count);
	const finalPathIndices = new Uint32Array(count);
	const finalPathStationsMeters = new Float32Array(count);
	const worldPositions = new Float32Array(count * 2);
	const tangents = new Float32Array(count * 2);
	const yawRadians = new Float32Array(count);
	const barcodes: (string | null)[] = [];
	const sourceIndex = createPortAttachmentSourceIndex(physical);
	for (let row = 0; row < count; row++) {
		const port = ports[row] as PortRecord;
		const resolved = resolvePortAttachmentWithSourceIndex(physical, port, sourceIndex);
		if (!resolved.ok) {
			throw new Error(
				`Simulation foundation port ${port.id} cannot be resolved: ${resolved.message}`,
			);
		}
		ids[row] = port.id;
		equipmentGroupIds[row] = port.equipmentGroupId;
		typeCodes[row] = encodePortType(port);
		geometricDirectionCodes[row] = SIMULATION_STATION_GEOMETRIC_DIRECTION_CODE[port.direction];
		sideCodes[row] = SIMULATION_STATION_SIDE_CODE[port.side];
		canonicalStationsMillimeters[row] = port.stationMillimeters;
		lateralOffsetsMillimeters[row] = port.lateralOffsetMillimeters;
		finalPathIndices[row] = resolved.finalPathIndex;
		finalPathStationsMeters[row] = resolved.finalPathStationMeters;
		worldPositions[row * 2] = resolved.worldXMeters;
		worldPositions[row * 2 + 1] = resolved.worldZMeters;
		tangents[row * 2] = resolved.tangentX;
		tangents[row * 2 + 1] = resolved.tangentZ;
		yawRadians[row] = resolved.yawRadians;
		barcodes.push(port.barcode);
	}
	return {
		count,
		ids,
		equipmentGroupIds,
		typeCodes,
		geometricDirectionCodes,
		sideCodes,
		canonicalStationsMillimeters,
		lateralOffsetsMillimeters,
		finalPathIndices,
		finalPathStationsMeters,
		worldPositions,
		tangents,
		yawRadians,
		barcodes: Object.freeze(barcodes),
	};
}

function compileEquipmentGroups(
	groups: readonly EquipmentGroupRecord[],
): SimulationStaticWorldEquipmentGroups {
	const sorted = [...groups].sort((left, right) => left.id - right.id);
	const ids = new Uint32Array(sorted.length);
	const kindCodes = new Uint8Array(sorted.length);
	const portOffsets = new Uint32Array(sorted.length + 1);
	const portIds: number[] = [];
	const templateCodes = new Uint8Array(sorted.length);
	const eqPitchMillimeters = new Uint16Array(sorted.length);
	const eqRecipes: (string | null)[] = [];
	for (let row = 0; row < sorted.length; row++) {
		const group = sorted[row] as EquipmentGroupRecord;
		ids[row] = group.id;
		kindCodes[row] = SIMULATION_EQUIPMENT_GROUP_KIND_CODE[group.kind];
		portOffsets[row] = portIds.length;
		portIds.push(...group.portIds);
		templateCodes[row] = encodeGroupTemplate(group);
		eqPitchMillimeters[row] = group.kind === "EQ" ? group.pitchMillimeters : 0;
		eqRecipes.push(group.kind === "EQ" ? group.recipe : null);
	}
	portOffsets[sorted.length] = portIds.length;
	return {
		count: sorted.length,
		ids,
		kindCodes,
		portOffsets,
		portIds: new Uint32Array(portIds),
		templateCodes,
		eqPitchMillimeters,
		eqRecipes: Object.freeze(eqRecipes),
	};
}

function cloneRailEnvelopes(source: CompiledRailEnvelopes): CompiledRailEnvelopes {
	return {
		profileId: source.profileId,
		profileVersion: source.profileVersion,
		count: source.count,
		pathOffsets: source.pathOffsets.slice(),
		pathIndices: source.pathIndices.slice(),
		pointIndices: source.pointIndices.slice(),
		stationStarts: source.stationStarts.slice(),
		stationEnds: source.stationEnds.slice(),
		startPoints: source.startPoints.slice(),
		endPoints: source.endPoints.slice(),
		bounds: source.bounds.slice(),
		beamRadiusMillimeters: source.beamRadiusMillimeters.slice(),
		ohtSweepRadiusMillimeters: source.ohtSweepRadiusMillimeters.slice(),
		installationRadiusMillimeters: source.installationRadiusMillimeters.slice(),
		approximationToleranceMillimeters: source.approximationToleranceMillimeters.slice(),
	};
}

function cloneCompiledAdvancedSwitches(source: CompiledAdvancedSwitches): CompiledAdvancedSwitches {
	return {
		count: source.count,
		ids: source.ids.slice(),
		profileClasses: source.profileClasses.slice(),
		origins: source.origins.slice(),
		forwardDirections: source.forwardDirections.slice(),
		lateralDirections: source.lateralDirections.slice(),
		movementMasks: source.movementMasks.slice(),
		portOffsets: source.portOffsets.slice(),
		portRoles: source.portRoles.slice(),
		portLocalIndices: source.portLocalIndices.slice(),
		portCells: source.portCells.slice(),
		portDirections: source.portDirections.slice(),
		portPathIndices: source.portPathIndices.slice(),
		portPathStations: source.portPathStations.slice(),
		movementOffsets: source.movementOffsets.slice(),
		movementInputIndices: source.movementInputIndices.slice(),
		movementOutputIndices: source.movementOutputIndices.slice(),
		movementPathOffsets: source.movementPathOffsets.slice(),
		movementPathIndices: source.movementPathIndices.slice(),
		movementPathStarts: source.movementPathStarts.slice(),
		movementPathEnds: source.movementPathEnds.slice(),
		movementConflictOffsets: source.movementConflictOffsets.slice(),
		movementConflictIntervalIndices: source.movementConflictIntervalIndices.slice(),
		claimedOffsets: source.claimedOffsets.slice(),
		claimedCells: source.claimedCells.slice(),
		reservedOffsets: source.reservedOffsets.slice(),
		reservedCells: source.reservedCells.slice(),
		mergeAnchors: source.mergeAnchors.slice(),
		branchAnchors: source.branchAnchors.slice(),
		sharedThroatCells: source.sharedThroatCells.slice(),
		sharedThroatLengthsMeters: source.sharedThroatLengthsMeters.slice(),
		sharedSupportLengthsMeters: source.sharedSupportLengthsMeters.slice(),
		mergeSharedLeadMeters: source.mergeSharedLeadMeters.slice(),
		clearTrunkMeters: source.clearTrunkMeters.slice(),
		branchSharedLeadMeters: source.branchSharedLeadMeters.slice(),
		conflictZoneIds: source.conflictZoneIds.slice(),
		conflictZoneLengthsMeters: source.conflictZoneLengthsMeters.slice(),
		conflictPathOffsets: source.conflictPathOffsets.slice(),
		conflictPathIndices: source.conflictPathIndices.slice(),
		conflictPathStarts: source.conflictPathStarts.slice(),
		conflictPathEnds: source.conflictPathEnds.slice(),
		conflictIntervalKinds: source.conflictIntervalKinds.slice(),
		conflictRouteIndices: source.conflictRouteIndices.slice(),
		conflictBounds: source.conflictBounds.slice(),
		bounds: source.bounds.slice(),
	};
}

function simulationStaticWorldFoundationViews(
	foundation: Omit<SimulationStaticWorldFoundation, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		...pathViews(foundation.paths),
		...advancedSwitchViews(foundation.switches),
		...stationViews(foundation.stations),
		...equipmentGroupViews(foundation.equipmentGroups),
		...envelopeViews(foundation.motionEnvelopes),
	];
}

function pathViews(paths: SimulationStaticWorldPathGraph): readonly ArrayBufferView[] {
	return [
		paths.identities,
		paths.offsets,
		paths.positions,
		paths.tangents,
		paths.distances,
		paths.lengths,
		paths.adjacencyOffsets,
		paths.adjacencyTargets,
		paths.sharedSegmentOffsets,
		paths.sharedSegmentIds,
		paths.sharedSegmentStarts,
		paths.sharedSegmentEnds,
		paths.sharedOwnerPathRows,
	];
}

function advancedSwitchViews(switches: CompiledAdvancedSwitches): readonly ArrayBufferView[] {
	return [
		switches.ids,
		switches.profileClasses,
		switches.origins,
		switches.forwardDirections,
		switches.lateralDirections,
		switches.movementMasks,
		switches.portOffsets,
		switches.portRoles,
		switches.portLocalIndices,
		switches.portCells,
		switches.portDirections,
		switches.portPathIndices,
		switches.portPathStations,
		switches.movementOffsets,
		switches.movementInputIndices,
		switches.movementOutputIndices,
		switches.movementPathOffsets,
		switches.movementPathIndices,
		switches.movementPathStarts,
		switches.movementPathEnds,
		switches.movementConflictOffsets,
		switches.movementConflictIntervalIndices,
		switches.claimedOffsets,
		switches.claimedCells,
		switches.reservedOffsets,
		switches.reservedCells,
		switches.mergeAnchors,
		switches.branchAnchors,
		switches.sharedThroatCells,
		switches.sharedThroatLengthsMeters,
		switches.sharedSupportLengthsMeters,
		switches.mergeSharedLeadMeters,
		switches.clearTrunkMeters,
		switches.branchSharedLeadMeters,
		switches.conflictZoneIds,
		switches.conflictZoneLengthsMeters,
		switches.conflictPathOffsets,
		switches.conflictPathIndices,
		switches.conflictPathStarts,
		switches.conflictPathEnds,
		switches.conflictIntervalKinds,
		switches.conflictRouteIndices,
		switches.conflictBounds,
		switches.bounds,
	];
}

function stationViews(stations: SimulationStaticWorldStations): readonly ArrayBufferView[] {
	return [
		stations.ids,
		stations.equipmentGroupIds,
		stations.typeCodes,
		stations.geometricDirectionCodes,
		stations.sideCodes,
		stations.canonicalStationsMillimeters,
		stations.lateralOffsetsMillimeters,
		stations.finalPathIndices,
		stations.finalPathStationsMeters,
		stations.worldPositions,
		stations.tangents,
		stations.yawRadians,
	];
}

function equipmentGroupViews(
	groups: SimulationStaticWorldEquipmentGroups,
): readonly ArrayBufferView[] {
	return [
		groups.ids,
		groups.kindCodes,
		groups.portOffsets,
		groups.portIds,
		groups.templateCodes,
		groups.eqPitchMillimeters,
	];
}

function envelopeViews(envelopes: CompiledRailEnvelopes): readonly ArrayBufferView[] {
	return [
		envelopes.pathOffsets,
		envelopes.pathIndices,
		envelopes.pointIndices,
		envelopes.stationStarts,
		envelopes.stationEnds,
		envelopes.startPoints,
		envelopes.endPoints,
		envelopes.bounds,
		envelopes.beamRadiusMillimeters,
		envelopes.ohtSweepRadiusMillimeters,
		envelopes.installationRadiusMillimeters,
		envelopes.approximationToleranceMillimeters,
	];
}

function isPathGraph(value: unknown): value is SimulationStaticWorldPathGraph {
	if (!isRecord(value)) return false;
	if (
		!isNonNegativeSafeInteger(value.pathCount) ||
		!isNonNegativeSafeInteger(value.pointCount) ||
		!isNonNegativeSafeInteger(value.sharedSegmentCount)
	) {
		return false;
	}
	const sharedOccurrenceCount =
		value.sharedSegmentIds instanceof Uint32Array ? value.sharedSegmentIds.length : -1;
	return (
		isInt32Array(value.identities, value.pathCount * PHYSICAL_PATH_IDENTITY_WIDTH) &&
		isUint32Array(value.offsets, value.pathCount + 1) &&
		isFloat32Array(value.positions, value.pointCount * 2) &&
		isFloat32Array(value.tangents, value.pointCount * 2) &&
		isFloat32Array(value.distances, value.pointCount) &&
		isFloat32Array(value.lengths, value.pathCount) &&
		isUint32Array(value.adjacencyOffsets, value.pathCount + 1) &&
		value.offsets[0] === 0 &&
		value.offsets[value.pathCount] === value.pointCount &&
		value.adjacencyOffsets[0] === 0 &&
		value.adjacencyOffsets[value.pathCount] ===
			(isUint32Array(value.adjacencyTargets) ? value.adjacencyTargets.length : -1) &&
		isUint32Array(value.adjacencyTargets) &&
		rowsWithin(value.adjacencyTargets, value.pathCount) &&
		isNonDecreasing(value.offsets) &&
		isNonDecreasing(value.adjacencyOffsets) &&
		isCsr(value.sharedSegmentOffsets, value.pathCount, sharedOccurrenceCount) &&
		isUint32Array(value.sharedSegmentIds, sharedOccurrenceCount) &&
		isFloat32Array(value.sharedSegmentStarts, sharedOccurrenceCount) &&
		isFloat32Array(value.sharedSegmentEnds, sharedOccurrenceCount) &&
		isUint32Array(value.sharedOwnerPathRows, sharedOccurrenceCount) &&
		rowsWithin(value.sharedOwnerPathRows, value.pathCount) &&
		allFinite(value.positions) &&
		allFinite(value.tangents) &&
		allFinite(value.distances) &&
		allFinite(value.lengths) &&
		allFinite(value.sharedSegmentStarts) &&
		allFinite(value.sharedSegmentEnds) &&
		validSharedIntervals(value as unknown as SimulationStaticWorldPathGraph) &&
		validSharedMetadata(value as unknown as SimulationStaticWorldPathGraph)
	);
}

function validSharedIntervals(paths: SimulationStaticWorldPathGraph): boolean {
	for (let pathRow = 0; pathRow < paths.pathCount; pathRow++) {
		const start = paths.sharedSegmentOffsets[pathRow] as number;
		const end = paths.sharedSegmentOffsets[pathRow + 1] as number;
		let priorEnd = 0;
		for (let row = start; row < end; row++) {
			const intervalStart = paths.sharedSegmentStarts[row] as number;
			const intervalEnd = paths.sharedSegmentEnds[row] as number;
			if (
				intervalStart < priorEnd - 1e-4 ||
				intervalEnd <= intervalStart ||
				intervalEnd > (paths.lengths[pathRow] as number) + 1e-4
			) {
				return false;
			}
			priorEnd = intervalEnd;
		}
	}
	return true;
}

function validSharedMetadata(paths: SimulationStaticWorldPathGraph): boolean {
	const shared = new Map<
		number,
		{
			canonicalPathRow: number;
			count: number;
			ownerPathRow: number;
			ownerOccurrencePresent: boolean;
		}
	>();
	for (let pathRow = 0; pathRow < paths.pathCount; pathRow++) {
		const start = paths.sharedSegmentOffsets[pathRow] as number;
		const end = paths.sharedSegmentOffsets[pathRow + 1] as number;
		const idsOnPath = new Set<number>();
		for (let row = start; row < end; row++) {
			const id = paths.sharedSegmentIds[row] as number;
			if (idsOnPath.has(id)) return false;
			idsOnPath.add(id);
			const ownerPathRow = paths.sharedOwnerPathRows[row] as number;
			const existing = shared.get(id);
			if (!existing) {
				shared.set(id, {
					canonicalPathRow: pathRow,
					count: 1,
					ownerPathRow,
					ownerOccurrencePresent: pathRow === ownerPathRow,
				});
				continue;
			}
			if (existing.ownerPathRow !== ownerPathRow) return false;
			if (compareFoundationPathIdentities(paths, pathRow, existing.canonicalPathRow) < 0) {
				existing.canonicalPathRow = pathRow;
			}
			existing.count += 1;
			existing.ownerOccurrencePresent ||= pathRow === ownerPathRow;
		}
	}
	if (shared.size !== paths.sharedSegmentCount) return false;
	for (const metadata of shared.values()) {
		if (
			metadata.count < 2 ||
			!metadata.ownerOccurrencePresent ||
			metadata.ownerPathRow !== metadata.canonicalPathRow
		) {
			return false;
		}
	}
	return true;
}

function compareFoundationPathIdentities(
	paths: SimulationStaticWorldPathGraph,
	leftPathRow: number,
	rightPathRow: number,
): number {
	const leftOffset = leftPathRow * PHYSICAL_PATH_IDENTITY_WIDTH;
	const rightOffset = rightPathRow * PHYSICAL_PATH_IDENTITY_WIDTH;
	for (let field = 0; field < PHYSICAL_PATH_IDENTITY_WIDTH; field++) {
		const difference =
			(paths.identities[leftOffset + field] as number) -
			(paths.identities[rightOffset + field] as number);
		if (difference !== 0) return difference;
	}
	return 0;
}

function isSwitchSnapshot(value: unknown, pathCount: number): value is CompiledAdvancedSwitches {
	if (!isRecord(value) || !isNonNegativeSafeInteger(value.count)) return false;
	const switches = value as unknown as CompiledAdvancedSwitches;
	const views = advancedSwitchViews(switches);
	if (!views.every(isTypedArray)) return false;
	const portCount = switches.portRoles.length;
	const movementCount = switches.movementInputIndices.length;
	const movementPathCount = switches.movementPathIndices.length;
	const movementConflictCount = switches.movementConflictIntervalIndices.length;
	const conflictPathCount = switches.conflictPathIndices.length;
	return (
		isUint32Array(switches.ids, switches.count) &&
		isUint8Array(switches.profileClasses, switches.count) &&
		isInt32Array(switches.origins, switches.count * 2) &&
		isUint8Array(switches.forwardDirections, switches.count) &&
		isUint8Array(switches.lateralDirections, switches.count) &&
		isUint8Array(switches.movementMasks, switches.count) &&
		isCsr(switches.portOffsets, switches.count, portCount) &&
		isUint8Array(switches.portRoles, portCount) &&
		isUint8Array(switches.portLocalIndices, portCount) &&
		isInt32Array(switches.portCells, portCount * 2) &&
		isUint8Array(switches.portDirections, portCount) &&
		isUint32Array(switches.portPathIndices, portCount) &&
		isFloat32Array(switches.portPathStations, portCount) &&
		isCsr(switches.movementOffsets, switches.count, movementCount) &&
		isUint8Array(switches.movementInputIndices, movementCount) &&
		isUint8Array(switches.movementOutputIndices, movementCount) &&
		isCsr(switches.movementPathOffsets, movementCount, movementPathCount) &&
		isUint32Array(switches.movementPathIndices, movementPathCount) &&
		isFloat32Array(switches.movementPathStarts, movementPathCount) &&
		isFloat32Array(switches.movementPathEnds, movementPathCount) &&
		isCsr(switches.movementConflictOffsets, movementCount, movementConflictCount) &&
		isUint32Array(switches.movementConflictIntervalIndices, movementConflictCount) &&
		isCsr(switches.claimedOffsets, switches.count, switches.claimedCells.length / 2) &&
		isInt32Array(switches.claimedCells, (switches.claimedOffsets[switches.count] as number) * 2) &&
		isCsr(switches.reservedOffsets, switches.count, switches.reservedCells.length / 2) &&
		isInt32Array(
			switches.reservedCells,
			(switches.reservedOffsets[switches.count] as number) * 2,
		) &&
		isInt32Array(switches.mergeAnchors, switches.count * 2) &&
		isInt32Array(switches.branchAnchors, switches.count * 2) &&
		isInt32Array(switches.sharedThroatCells, switches.count * 2) &&
		isFloat32Array(switches.sharedThroatLengthsMeters, switches.count) &&
		isFloat32Array(switches.sharedSupportLengthsMeters, switches.count) &&
		isFloat32Array(switches.mergeSharedLeadMeters, switches.count) &&
		isFloat32Array(switches.clearTrunkMeters, switches.count) &&
		isFloat32Array(switches.branchSharedLeadMeters, switches.count) &&
		isUint32Array(switches.conflictZoneIds, switches.count) &&
		isFloat32Array(switches.conflictZoneLengthsMeters, switches.count) &&
		isCsr(switches.conflictPathOffsets, switches.count, conflictPathCount) &&
		isUint32Array(switches.conflictPathIndices, conflictPathCount) &&
		isFloat32Array(switches.conflictPathStarts, conflictPathCount) &&
		isFloat32Array(switches.conflictPathEnds, conflictPathCount) &&
		isUint8Array(switches.conflictIntervalKinds, conflictPathCount) &&
		isUint8Array(switches.conflictRouteIndices, conflictPathCount) &&
		isFloat32Array(switches.conflictBounds, switches.count * 4) &&
		isFloat32Array(switches.bounds, switches.count * 4) &&
		rowsWithin(switches.portPathIndices, pathCount) &&
		rowsWithin(switches.movementPathIndices, pathCount) &&
		rowsWithin(switches.movementConflictIntervalIndices, conflictPathCount) &&
		rowsWithin(switches.conflictPathIndices, pathCount) &&
		allFinite(switches.portPathStations) &&
		allFinite(switches.movementPathStarts) &&
		allFinite(switches.movementPathEnds) &&
		allFinite(switches.conflictPathStarts) &&
		allFinite(switches.conflictPathEnds) &&
		allFinite(switches.conflictBounds) &&
		allFinite(switches.bounds)
	);
}

function isStationSnapshot(
	value: unknown,
	pathCount: number,
): value is SimulationStaticWorldStations {
	if (!isRecord(value) || !isNonNegativeSafeInteger(value.count)) return false;
	const count = value.count;
	return (
		isUint32Array(value.ids, count) &&
		isUint32Array(value.equipmentGroupIds, count) &&
		isUint8Array(value.typeCodes, count) &&
		isUint8Array(value.geometricDirectionCodes, count) &&
		isUint8Array(value.sideCodes, count) &&
		isUint32Array(value.canonicalStationsMillimeters, count) &&
		isUint32Array(value.lateralOffsetsMillimeters, count) &&
		isUint32Array(value.finalPathIndices, count) &&
		rowsWithin(value.finalPathIndices, pathCount) &&
		isFloat32Array(value.finalPathStationsMeters, count) &&
		isFloat32Array(value.worldPositions, count * 2) &&
		isFloat32Array(value.tangents, count * 2) &&
		isFloat32Array(value.yawRadians, count) &&
		Array.isArray(value.barcodes) &&
		value.barcodes.length === count &&
		value.barcodes.every((barcode) => barcode === null || typeof barcode === "string") &&
		allFinite(value.finalPathStationsMeters) &&
		allFinite(value.worldPositions) &&
		allFinite(value.tangents) &&
		allFinite(value.yawRadians)
	);
}

function isEquipmentGroupSnapshot(value: unknown): value is SimulationStaticWorldEquipmentGroups {
	if (!isRecord(value) || !isNonNegativeSafeInteger(value.count)) return false;
	const count = value.count;
	return (
		isUint32Array(value.ids, count) &&
		isUint8Array(value.kindCodes, count) &&
		isUint32Array(value.portOffsets, count + 1) &&
		isUint32Array(value.portIds) &&
		value.portOffsets[0] === 0 &&
		value.portOffsets[count] === value.portIds.length &&
		isNonDecreasing(value.portOffsets) &&
		isUint8Array(value.templateCodes, count) &&
		value.eqPitchMillimeters instanceof Uint16Array &&
		value.eqPitchMillimeters.length === count &&
		Array.isArray(value.eqRecipes) &&
		value.eqRecipes.length === count &&
		value.eqRecipes.every((recipe) => recipe === null || typeof recipe === "string")
	);
}

function isMotionEnvelopeSnapshot(
	value: unknown,
	pathCount: number,
): value is CompiledRailEnvelopes {
	if (
		!isRecord(value) ||
		!isNonEmptyString(value.profileId) ||
		!isNonNegativeSafeInteger(value.profileVersion) ||
		!isNonNegativeSafeInteger(value.count)
	) {
		return false;
	}
	const count = value.count;
	return (
		isUint32Array(value.pathOffsets, pathCount + 1) &&
		isUint32Array(value.pathIndices, count) &&
		rowsWithin(value.pathIndices, pathCount) &&
		isUint32Array(value.pointIndices, count) &&
		isFloat32Array(value.stationStarts, count) &&
		isFloat32Array(value.stationEnds, count) &&
		isFloat32Array(value.startPoints, count * 2) &&
		isFloat32Array(value.endPoints, count * 2) &&
		isFloat32Array(value.bounds, count * 4) &&
		value.beamRadiusMillimeters instanceof Uint16Array &&
		value.beamRadiusMillimeters.length === count &&
		value.ohtSweepRadiusMillimeters instanceof Uint16Array &&
		value.ohtSweepRadiusMillimeters.length === count &&
		value.installationRadiusMillimeters instanceof Uint16Array &&
		value.installationRadiusMillimeters.length === count &&
		value.approximationToleranceMillimeters instanceof Uint16Array &&
		value.approximationToleranceMillimeters.length === count &&
		value.pathOffsets[0] === 0 &&
		value.pathOffsets[pathCount] === count &&
		isNonDecreasing(value.pathOffsets) &&
		allFinite(value.stationStarts) &&
		allFinite(value.stationEnds) &&
		allFinite(value.startPoints) &&
		allFinite(value.endPoints) &&
		allFinite(value.bounds)
	);
}

function encodePortType(port: PortRecord): number {
	return SIMULATION_STATION_TYPE_CODE[port.portType];
}

function encodeGroupTemplate(group: EquipmentGroupRecord): number {
	if (group.kind === "OHB") return SIMULATION_EQUIPMENT_TEMPLATE_CODE.OHB_SINGLE;
	if (group.kind === "EQ") return SIMULATION_EQUIPMENT_TEMPLATE_CODE.EQ;
	return group.template === "CUSTOM"
		? SIMULATION_EQUIPMENT_TEMPLATE_CODE.STK_CUSTOM
		: group.template === "FLEX"
			? SIMULATION_EQUIPMENT_TEMPLATE_CODE.STK_FLEX
			: group.template === "FOUR_PORT"
				? SIMULATION_EQUIPMENT_TEMPLATE_CODE.STK_FOUR_PORT
				: group.template === "SIX_PORT"
					? SIMULATION_EQUIPMENT_TEMPLATE_CODE.STK_SIX_PORT
					: SIMULATION_EQUIPMENT_TEMPLATE_CODE.STK_BACK_TO_BACK;
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((sum, view) => sum + view.byteLength, 0);
}

function hasDistinctOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = new Set<ArrayBufferLike>();
	for (const view of views) {
		if (
			view.byteOffset !== 0 ||
			view.byteLength !== view.buffer.byteLength ||
			buffers.has(view.buffer)
		) {
			return false;
		}
		buffers.add(view.buffer);
	}
	return true;
}

function rowsWithin(values: Uint32Array, rowCount: number): boolean {
	for (const value of values) if (value >= rowCount) return false;
	return true;
}

function isCsr(offsets: unknown, rowCount: number, itemCount: number): offsets is Uint32Array {
	return (
		Number.isInteger(itemCount) &&
		itemCount >= 0 &&
		isUint32Array(offsets, rowCount + 1) &&
		offsets[0] === 0 &&
		offsets[rowCount] === itemCount &&
		isNonDecreasing(offsets)
	);
}

function isNonDecreasing(values: Uint32Array): boolean {
	for (let index = 1; index < values.length; index++) {
		if ((values[index] as number) < (values[index - 1] as number)) return false;
	}
	return true;
}

function allFinite(values: ArrayLike<number>): boolean {
	for (let index = 0; index < values.length; index++) {
		if (!Number.isFinite(values[index])) return false;
	}
	return true;
}

function isTypedArray(value: ArrayBufferView): boolean {
	return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function isUint32Array(value: unknown, length?: number): value is Uint32Array {
	return value instanceof Uint32Array && (length === undefined || value.length === length);
}

function isInt32Array(value: unknown, length?: number): value is Int32Array {
	return value instanceof Int32Array && (length === undefined || value.length === length);
}

function isUint8Array(value: unknown, length?: number): value is Uint8Array {
	return value instanceof Uint8Array && (length === undefined || value.length === length);
}

function isFloat32Array(value: unknown, length?: number): value is Float32Array {
	return value instanceof Float32Array && (length === undefined || value.length === length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((entry, index) => entry === expected[index])
	);
}
