import {
	checksumOperationalConfiguration,
	copyOperationalConfigurationState,
	OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT,
	OPERATIONAL_RESIDENT_HOME_SLOT_POLICY,
	type OperationalConfigurationState,
	type OperationalResidentHomeSlotRecord,
} from "../core/OperationalConfiguration";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";
import {
	type SimulationTrackOccupancyPolicy,
	simulationTrackOccupancyPolicyError,
} from "./SimulationTrackOccupancyPolicy";
import {
	type SimulationTrackResourceTopology,
	simulationTrackResourceTopologyError,
} from "./SimulationTrackResourceTopology";

export const SIMULATION_RESIDENT_FLEET_PARKING_CONFIGURATION_SCHEMA_VERSION = 2 as const;
export const SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID =
	"OPENFAB_EXPLICIT_HOME_RETURN_RESIDENT_FLEET_READINESS_V1" as const;
export const SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY = OPERATIONAL_RESIDENT_HOME_SLOT_POLICY;
export const SIMULATION_RESIDENT_FLEET_ANCHOR_POLICY =
	"EXPLICIT_REVIEWED_STABLE_PORT_ID_ONLY_V1" as const;
export const SIMULATION_RESIDENT_FLEET_FOOTPRINT_POLICY =
	"CERTIFIED_REAR_TO_FRONT_AT_ANCHOR_V1" as const;
export const SIMULATION_RESIDENT_FLEET_EXTENSION_POLICY =
	"UNIQUE_DIRECTED_BOUNDARY_EXTENSION_OR_FAIL_CLOSED_V1" as const;
export const SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY =
	"DEDICATED_HOME_NON_INTERFERENCE_AND_ATOMIC_COMPLETE_CYCLE_V1" as const;
export const SIMULATION_RESIDENT_FLEET_MAXIMUM_HOME_SLOTS = OPERATIONAL_RESIDENT_HOME_SLOT_LIMIT;
export const SIMULATION_RESIDENT_FLEET_MAXIMUM_TYPED_BYTES = 16 * 1024 * 1024;
export const SIMULATION_RESIDENT_FLEET_PARKING_MISSING_SAFETY_LAYERS = Object.freeze([
	"EXPLICIT_VEHICLE_SCENARIO_ASSIGNMENT",
	"COMPLETE_HOME_RETURN_CYCLE_ROUTES",
	"FOREIGN_HOME_NON_INTERFERENCE",
	"ATOMIC_COMPLETE_CYCLE_LEASE",
	"RESIDENT_READINESS_CERTIFICATE",
	"RESIDENT_RUN_AUTHORIZATION",
] as const);

const MAXIMUM_FOOTPRINT_PATH_INTERVALS_PER_SLOT = 4_096;
const STATION_EPSILON_METERS = 1e-4;
const CONFIGURATION_KEYS = Object.freeze([
	"schemaVersion",
	"simulationReady",
	"missingSafetyLayers",
	"runtimeProfileId",
	"homeSlotPolicy",
	"anchorPolicy",
	"stationaryFootprintPolicy",
	"extensionPolicy",
	"deadlockPolicy",
	"parkingSlotCapacity",
	"homeSlotFootprintsPairwiseDisjoint",
	"sourceFoundationFingerprint",
	"sourceTrackResourceTopologyFingerprint",
	"sourceOccupancyPolicyFingerprint",
	"sourceOperationalConfigurationFingerprint",
	"sourceOperationalReviewRevision",
	"sourceOperationalReviewAuthoredChecksum",
	"frontLeaseExtensionMillimeters",
	"rearLeaseExtensionMillimeters",
	"slotCount",
	"slotIds",
	"vehicleIds",
	"anchorPortIds",
	"anchorStationRows",
	"anchorPathRows",
	"anchorPathStationsMeters",
	"footprintTrackResourceOffsets",
	"footprintTrackResourceRows",
	"orderedOccurrenceOffsets",
	"orderedOccurrenceResourceRows",
	"orderedOccurrenceStartsMeters",
	"orderedOccurrenceEndsMeters",
	"fingerprint",
	"byteLength",
] as const);

export interface SimulationResidentFleetHomeSlotInput {
	readonly slotId: number;
	readonly vehicleId: OperationalResidentHomeSlotRecord["vehicleId"];
	readonly anchorPortId: OperationalResidentHomeSlotRecord["anchorPortId"];
	readonly policy: OperationalResidentHomeSlotRecord["policy"];
}

/**
 * Exact-source, non-runnable parking evidence for the first future resident-fleet profile.
 * Vehicle assignment, cycle routes, authorization, and execution remain separate gates.
 */
export interface SimulationResidentFleetParkingConfiguration {
	readonly schemaVersion: typeof SIMULATION_RESIDENT_FLEET_PARKING_CONFIGURATION_SCHEMA_VERSION;
	readonly simulationReady: false;
	readonly missingSafetyLayers: typeof SIMULATION_RESIDENT_FLEET_PARKING_MISSING_SAFETY_LAYERS;
	readonly runtimeProfileId: typeof SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID;
	readonly homeSlotPolicy: typeof SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY;
	readonly anchorPolicy: typeof SIMULATION_RESIDENT_FLEET_ANCHOR_POLICY;
	readonly stationaryFootprintPolicy: typeof SIMULATION_RESIDENT_FLEET_FOOTPRINT_POLICY;
	readonly extensionPolicy: typeof SIMULATION_RESIDENT_FLEET_EXTENSION_POLICY;
	readonly deadlockPolicy: typeof SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY;
	readonly parkingSlotCapacity: 1;
	readonly homeSlotFootprintsPairwiseDisjoint: true;
	readonly sourceFoundationFingerprint: string;
	readonly sourceTrackResourceTopologyFingerprint: string;
	readonly sourceOccupancyPolicyFingerprint: string;
	readonly sourceOperationalConfigurationFingerprint: string;
	readonly sourceOperationalReviewRevision: number;
	readonly sourceOperationalReviewAuthoredChecksum: string;
	readonly frontLeaseExtensionMillimeters: number;
	readonly rearLeaseExtensionMillimeters: number;
	readonly slotCount: number;
	/** Canonical row order is ascending slot ID. */
	readonly slotIds: Uint32Array;
	readonly vehicleIds: readonly string[];
	readonly anchorPortIds: Uint32Array;
	readonly anchorStationRows: Uint32Array;
	readonly anchorPathRows: Uint32Array;
	readonly anchorPathStationsMeters: Float64Array;
	/** Canonically sorted, unique physical-resource bundle for every stationary footprint. */
	readonly footprintTrackResourceOffsets: Uint32Array;
	readonly footprintTrackResourceRows: Uint32Array;
	/** Directed occurrence order from rear extent through anchor to front extent. */
	readonly orderedOccurrenceOffsets: Uint32Array;
	readonly orderedOccurrenceResourceRows: Uint32Array;
	readonly orderedOccurrenceStartsMeters: Float64Array;
	readonly orderedOccurrenceEndsMeters: Float64Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

interface MutablePathInterval {
	readonly pathRow: number;
	start: number;
	end: number;
}

interface PathInterval extends MutablePathInterval {
	readonly routeStart: number;
}

interface SlotDraft {
	readonly slotId: number;
	readonly vehicleId: string;
	readonly anchorPortId: number;
	readonly anchorStationRow: number;
	readonly anchorPathRow: number;
	readonly anchorPathStationMeters: number;
	readonly footprintTrackResourceRows: readonly number[];
	readonly occurrenceResourceRows: readonly number[];
	readonly occurrenceStartsMeters: readonly number[];
	readonly occurrenceEndsMeters: readonly number[];
}

export function compileSimulationResidentFleetParkingConfiguration(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	operationalConfiguration: OperationalConfigurationState,
): SimulationResidentFleetParkingConfiguration {
	const operational = copyOperationalConfigurationState(operationalConfiguration);
	if (operational.review === null) {
		throw new Error(
			"Resident fleet parking requires an explicitly reviewed operational configuration.",
		);
	}
	if (
		operational.review.sourceRevision !== foundation.source.revision ||
		operational.review.sourceAuthoredChecksum !== foundation.source.authoredChecksum
	) {
		throw new Error(
			"Resident fleet parking operational review does not match the exact static source.",
		);
	}
	return compileResidentFleetParkingInputs(
		foundation,
		topology,
		occupancyPolicy,
		operational.residentHomeSlots.map((slot) => ({
			slotId: slot.id,
			vehicleId: slot.vehicleId,
			anchorPortId: slot.anchorPortId,
			policy: slot.policy,
		})),
		checksumOperationalConfiguration(operational),
		operational.review.sourceRevision,
		operational.review.sourceAuthoredChecksum,
	);
}

function compileResidentFleetParkingInputs(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	inputs: readonly SimulationResidentFleetHomeSlotInput[],
	sourceOperationalConfigurationFingerprint: string,
	sourceOperationalReviewRevision: number,
	sourceOperationalReviewAuthoredChecksum: string,
): SimulationResidentFleetParkingConfiguration {
	assertCompatibleSources(foundation, topology, occupancyPolicy);
	const normalizedInputs = normalizeInputs(inputs);
	const stationRowByPortId = new Map<number, number>();
	for (let row = 0; row < foundation.stations.count; row++) {
		stationRowByPortId.set(foundation.stations.ids[row] as number, row);
	}
	const incomingPathRows = buildIncomingPathRows(foundation);
	const switchTrackRows = new Set<number>(topology.conflictTrackResourceRows);
	const occupiedBySlotId = new Map<number, number>();
	const drafts: SlotDraft[] = [];
	let footprintResourceCount = 0;
	let occurrenceCount = 0;
	for (const input of normalizedInputs) {
		const stationRow = stationRowByPortId.get(input.anchorPortId);
		if (stationRow === undefined) {
			throw new Error(
				`Resident home slot ${input.slotId} names foreign anchor port ${input.anchorPortId}.`,
			);
		}
		const draft = compileSlotDraft(
			foundation,
			topology,
			occupancyPolicy,
			input,
			stationRow,
			incomingPathRows,
			switchTrackRows,
		);
		for (const resourceRow of draft.footprintTrackResourceRows) {
			const ownerSlotId = occupiedBySlotId.get(resourceRow);
			if (ownerSlotId !== undefined) {
				throw new Error(
					`Resident home slots ${ownerSlotId} and ${input.slotId} overlap on physical track resource ${resourceRow}.`,
				);
			}
			occupiedBySlotId.set(resourceRow, input.slotId);
		}
		drafts.push(draft);
		footprintResourceCount += draft.footprintTrackResourceRows.length;
		occurrenceCount += draft.occurrenceResourceRows.length;
		assertTypedMemoryLimit(drafts.length, footprintResourceCount, occurrenceCount);
	}

	const slotCount = drafts.length;
	const slotIds = new Uint32Array(slotCount);
	const vehicleIds = new Array<string>(slotCount);
	const anchorPortIds = new Uint32Array(slotCount);
	const anchorStationRows = new Uint32Array(slotCount);
	const anchorPathRows = new Uint32Array(slotCount);
	const anchorPathStationsMeters = new Float64Array(slotCount);
	const footprintTrackResourceOffsets = new Uint32Array(slotCount + 1);
	const footprintTrackResourceRows = new Uint32Array(footprintResourceCount);
	const orderedOccurrenceOffsets = new Uint32Array(slotCount + 1);
	const orderedOccurrenceResourceRows = new Uint32Array(occurrenceCount);
	const orderedOccurrenceStartsMeters = new Float64Array(occurrenceCount);
	const orderedOccurrenceEndsMeters = new Float64Array(occurrenceCount);
	let footprintCursor = 0;
	let occurrenceCursor = 0;
	for (let row = 0; row < slotCount; row++) {
		const draft = drafts[row] as SlotDraft;
		slotIds[row] = draft.slotId;
		vehicleIds[row] = draft.vehicleId;
		anchorPortIds[row] = draft.anchorPortId;
		anchorStationRows[row] = draft.anchorStationRow;
		anchorPathRows[row] = draft.anchorPathRow;
		anchorPathStationsMeters[row] = draft.anchorPathStationMeters;
		footprintTrackResourceOffsets[row] = footprintCursor;
		footprintTrackResourceRows.set(draft.footprintTrackResourceRows, footprintCursor);
		footprintCursor += draft.footprintTrackResourceRows.length;
		orderedOccurrenceOffsets[row] = occurrenceCursor;
		orderedOccurrenceResourceRows.set(draft.occurrenceResourceRows, occurrenceCursor);
		orderedOccurrenceStartsMeters.set(draft.occurrenceStartsMeters, occurrenceCursor);
		orderedOccurrenceEndsMeters.set(draft.occurrenceEndsMeters, occurrenceCursor);
		occurrenceCursor += draft.occurrenceResourceRows.length;
	}
	footprintTrackResourceOffsets[slotCount] = footprintCursor;
	orderedOccurrenceOffsets[slotCount] = occurrenceCursor;

	const configurationWithoutIdentity = {
		schemaVersion: SIMULATION_RESIDENT_FLEET_PARKING_CONFIGURATION_SCHEMA_VERSION,
		simulationReady: false,
		missingSafetyLayers: SIMULATION_RESIDENT_FLEET_PARKING_MISSING_SAFETY_LAYERS,
		runtimeProfileId: SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID,
		homeSlotPolicy: SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY,
		anchorPolicy: SIMULATION_RESIDENT_FLEET_ANCHOR_POLICY,
		stationaryFootprintPolicy: SIMULATION_RESIDENT_FLEET_FOOTPRINT_POLICY,
		extensionPolicy: SIMULATION_RESIDENT_FLEET_EXTENSION_POLICY,
		deadlockPolicy: SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY,
		parkingSlotCapacity: 1,
		homeSlotFootprintsPairwiseDisjoint: true,
		sourceFoundationFingerprint: foundation.fingerprint,
		sourceTrackResourceTopologyFingerprint: topology.fingerprint,
		sourceOccupancyPolicyFingerprint: occupancyPolicy.fingerprint,
		sourceOperationalConfigurationFingerprint,
		sourceOperationalReviewRevision,
		sourceOperationalReviewAuthoredChecksum,
		frontLeaseExtensionMillimeters: occupancyPolicy.frontLeaseExtensionMillimeters,
		rearLeaseExtensionMillimeters: occupancyPolicy.rearLeaseExtensionMillimeters,
		slotCount,
		slotIds,
		vehicleIds: Object.freeze(vehicleIds),
		anchorPortIds,
		anchorStationRows,
		anchorPathRows,
		anchorPathStationsMeters,
		footprintTrackResourceOffsets,
		footprintTrackResourceRows,
		orderedOccurrenceOffsets,
		orderedOccurrenceResourceRows,
		orderedOccurrenceStartsMeters,
		orderedOccurrenceEndsMeters,
	} as const;
	const views = simulationResidentFleetParkingConfigurationViews(configurationWithoutIdentity);
	const configuration = Object.freeze({
		...configurationWithoutIdentity,
		fingerprint: checksumSimulationResidentFleetParkingConfiguration(configurationWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationResidentFleetParkingConfiguration;
	const error = simulationResidentFleetParkingConfigurationError(configuration);
	if (error) throw new Error(`Compiled resident fleet parking configuration is invalid: ${error}`);
	return configuration;
}

export function checksumSimulationResidentFleetParkingConfiguration(
	configuration: Omit<SimulationResidentFleetParkingConfiguration, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		configuration.schemaVersion,
		configuration.simulationReady ? 1 : 0,
		configuration.parkingSlotCapacity,
		configuration.homeSlotFootprintsPairwiseDisjoint ? 1 : 0,
		configuration.sourceOperationalReviewRevision,
		configuration.frontLeaseExtensionMillimeters,
		configuration.rearLeaseExtensionMillimeters,
		configuration.slotCount,
	]);
	checksum.addStrings([
		...configuration.missingSafetyLayers,
		configuration.runtimeProfileId,
		configuration.homeSlotPolicy,
		configuration.anchorPolicy,
		configuration.stationaryFootprintPolicy,
		configuration.extensionPolicy,
		configuration.deadlockPolicy,
		configuration.sourceFoundationFingerprint,
		configuration.sourceTrackResourceTopologyFingerprint,
		configuration.sourceOccupancyPolicyFingerprint,
		configuration.sourceOperationalConfigurationFingerprint,
		configuration.sourceOperationalReviewAuthoredChecksum,
		...configuration.vehicleIds,
	]);
	checksum.addViews(simulationResidentFleetParkingConfigurationViews(configuration));
	return checksum.digest();
}

export function simulationResidentFleetParkingConfigurationError(value: unknown): string | null {
	if (!isRecord(value)) return "resident fleet parking configuration must be an object";
	if (!hasExactKeys(value, CONFIGURATION_KEYS)) {
		return "resident fleet parking configuration has unexpected fields";
	}
	if (value.schemaVersion !== SIMULATION_RESIDENT_FLEET_PARKING_CONFIGURATION_SCHEMA_VERSION) {
		return "resident fleet parking configuration schema version is invalid";
	}
	if (value.simulationReady !== false) return "parking configuration cannot authorize simulation";
	if (
		!sameStrings(
			value.missingSafetyLayers,
			SIMULATION_RESIDENT_FLEET_PARKING_MISSING_SAFETY_LAYERS,
		) ||
		value.runtimeProfileId !== SIMULATION_RESIDENT_FLEET_RUNTIME_PROFILE_ID ||
		value.homeSlotPolicy !== SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY ||
		value.anchorPolicy !== SIMULATION_RESIDENT_FLEET_ANCHOR_POLICY ||
		value.stationaryFootprintPolicy !== SIMULATION_RESIDENT_FLEET_FOOTPRINT_POLICY ||
		value.extensionPolicy !== SIMULATION_RESIDENT_FLEET_EXTENSION_POLICY ||
		value.deadlockPolicy !== SIMULATION_RESIDENT_FLEET_DEADLOCK_POLICY ||
		value.parkingSlotCapacity !== 1 ||
		value.homeSlotFootprintsPairwiseDisjoint !== true
	) {
		return "resident fleet parking policy declaration is invalid";
	}
	if (
		!isNonEmptyString(value.sourceFoundationFingerprint) ||
		!isNonEmptyString(value.sourceTrackResourceTopologyFingerprint) ||
		!isNonEmptyString(value.sourceOccupancyPolicyFingerprint) ||
		!isNonEmptyString(value.sourceOperationalConfigurationFingerprint) ||
		!isNonNegativeSafeInteger(value.sourceOperationalReviewRevision) ||
		!isNonEmptyString(value.sourceOperationalReviewAuthoredChecksum) ||
		!isUint32(value.frontLeaseExtensionMillimeters) ||
		!isUint32(value.rearLeaseExtensionMillimeters)
	) {
		return "resident fleet parking source or footprint identity is invalid";
	}
	if (
		!isNonNegativeSafeInteger(value.slotCount) ||
		(value.slotCount as number) > SIMULATION_RESIDENT_FLEET_MAXIMUM_HOME_SLOTS
	) {
		return "resident fleet parking slot count is invalid";
	}
	const slotCount = value.slotCount as number;
	if (
		!isUint32Array(value.slotIds, slotCount) ||
		!isUint32Array(value.anchorPortIds, slotCount) ||
		!isUint32Array(value.anchorStationRows, slotCount) ||
		!isUint32Array(value.anchorPathRows, slotCount) ||
		!isFloat64Array(value.anchorPathStationsMeters, slotCount) ||
		!Array.isArray(value.vehicleIds) ||
		value.vehicleIds.length !== slotCount
	) {
		return "resident fleet parking slot columns are malformed";
	}
	if (!strictlyIncreasingPositive(value.slotIds)) {
		return "resident fleet parking slot IDs must be positive and canonical";
	}
	if (!uniquePositive(value.anchorPortIds)) {
		return "resident fleet anchor port IDs must be positive and unique";
	}
	const vehicleIds = value.vehicleIds as readonly unknown[];
	if (!uniquePortableVehicleIds(vehicleIds)) {
		return "resident fleet vehicle IDs must be portable and unique";
	}
	for (const station of value.anchorPathStationsMeters) {
		if (!Number.isFinite(station) || station < 0) {
			return "resident fleet anchor path stations are invalid";
		}
	}
	if (
		!(value.footprintTrackResourceRows instanceof Uint32Array) ||
		!isCsr(
			value.footprintTrackResourceOffsets,
			slotCount,
			value.footprintTrackResourceRows.length,
		) ||
		!(value.orderedOccurrenceResourceRows instanceof Uint32Array) ||
		!isCsr(value.orderedOccurrenceOffsets, slotCount, value.orderedOccurrenceResourceRows.length) ||
		!isFloat64Array(
			value.orderedOccurrenceStartsMeters,
			value.orderedOccurrenceResourceRows.length,
		) ||
		!isFloat64Array(value.orderedOccurrenceEndsMeters, value.orderedOccurrenceResourceRows.length)
	) {
		return "resident fleet parking footprint columns are malformed";
	}
	const configuration = value as unknown as SimulationResidentFleetParkingConfiguration;
	if (!validFootprintRows(configuration)) {
		return "resident fleet parking footprint rows are inconsistent or overlap";
	}
	const views = simulationResidentFleetParkingConfigurationViews(configuration);
	if (!hasDistinctOwnedBuffers(views)) return "resident fleet parking buffers must be distinct";
	if (
		!isNonNegativeSafeInteger(value.byteLength) ||
		value.byteLength !== sumByteLengths(views) ||
		value.byteLength > SIMULATION_RESIDENT_FLEET_MAXIMUM_TYPED_BYTES
	) {
		return "resident fleet parking typed byte length is invalid";
	}
	if (!isNonEmptyString(value.fingerprint)) return "resident fleet parking fingerprint is invalid";
	try {
		if (checksumSimulationResidentFleetParkingConfiguration(configuration) !== value.fingerprint) {
			return "fingerprint does not match resident fleet parking contents";
		}
	} catch {
		return "resident fleet parking fingerprint cannot be recomputed";
	}
	return null;
}

export function isSimulationResidentFleetParkingConfiguration(
	value: unknown,
): value is SimulationResidentFleetParkingConfiguration {
	return simulationResidentFleetParkingConfigurationError(value) === null;
}

export function simulationResidentFleetParkingConfigurationMatchesSources(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	configuration: SimulationResidentFleetParkingConfiguration,
): boolean {
	if (simulationResidentFleetParkingConfigurationError(configuration)) return false;
	try {
		assertCompatibleSources(foundation, topology, occupancyPolicy);
		if (
			configuration.sourceFoundationFingerprint !== foundation.fingerprint ||
			configuration.sourceTrackResourceTopologyFingerprint !== topology.fingerprint ||
			configuration.sourceOccupancyPolicyFingerprint !== occupancyPolicy.fingerprint ||
			configuration.sourceOperationalReviewRevision !== foundation.source.revision ||
			configuration.sourceOperationalReviewAuthoredChecksum !==
				foundation.source.authoredChecksum ||
			configuration.frontLeaseExtensionMillimeters !==
				occupancyPolicy.frontLeaseExtensionMillimeters ||
			configuration.rearLeaseExtensionMillimeters !== occupancyPolicy.rearLeaseExtensionMillimeters
		) {
			return false;
		}
		const rebuilt = compileResidentFleetParkingInputs(
			foundation,
			topology,
			occupancyPolicy,
			Array.from({ length: configuration.slotCount }, (_, row) => ({
				slotId: configuration.slotIds[row] as number,
				vehicleId: configuration.vehicleIds[row] as string,
				anchorPortId: configuration.anchorPortIds[row] as number,
				policy: SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY,
			})),
			configuration.sourceOperationalConfigurationFingerprint,
			configuration.sourceOperationalReviewRevision,
			configuration.sourceOperationalReviewAuthoredChecksum,
		);
		return rebuilt.fingerprint === configuration.fingerprint;
	} catch {
		return false;
	}
}

export function simulationResidentFleetParkingConfigurationMatchesOperationalConfiguration(
	configuration: SimulationResidentFleetParkingConfiguration,
	operationalConfiguration: OperationalConfigurationState,
): boolean {
	if (simulationResidentFleetParkingConfigurationError(configuration)) return false;
	try {
		const operational = copyOperationalConfigurationState(operationalConfiguration);
		return (
			operational.review !== null &&
			configuration.sourceOperationalConfigurationFingerprint ===
				checksumOperationalConfiguration(operational) &&
			configuration.sourceOperationalReviewRevision === operational.review.sourceRevision &&
			configuration.sourceOperationalReviewAuthoredChecksum ===
				operational.review.sourceAuthoredChecksum &&
			configuration.slotCount === operational.residentHomeSlots.length &&
			operational.residentHomeSlots.every(
				(slot, row) =>
					configuration.slotIds[row] === slot.id &&
					configuration.vehicleIds[row] === slot.vehicleId &&
					configuration.anchorPortIds[row] === slot.anchorPortId,
			)
		);
	} catch {
		return false;
	}
}

export function simulationResidentFleetParkingConfigurationTransfers(
	configuration: SimulationResidentFleetParkingConfiguration,
): readonly ArrayBuffer[] {
	const error = simulationResidentFleetParkingConfigurationError(configuration);
	if (error) throw new Error(`Resident fleet parking configuration is invalid: ${error}`);
	return Object.freeze(
		simulationResidentFleetParkingConfigurationViews(configuration).map(
			(view) => view.buffer as ArrayBuffer,
		),
	);
}

function normalizeInputs(
	inputs: readonly SimulationResidentFleetHomeSlotInput[],
): readonly SimulationResidentFleetHomeSlotInput[] {
	if (!Array.isArray(inputs)) throw new TypeError("Resident home slots must be an array.");
	if (inputs.length > SIMULATION_RESIDENT_FLEET_MAXIMUM_HOME_SLOTS) {
		throw new RangeError("Resident home slots exceed the bounded profile limit.");
	}
	const seenSlotIds = new Set<number>();
	const seenVehicleIds = new Set<string>();
	const seenAnchorPortIds = new Set<number>();
	const normalized = inputs.map((input, row) => {
		if (
			!isRecord(input) ||
			!hasExactKeys(input, ["slotId", "vehicleId", "anchorPortId", "policy"])
		) {
			throw new TypeError(`Resident home slot row ${row} is malformed.`);
		}
		if (!isPositiveRecordId(input.slotId)) {
			throw new TypeError(`Resident home slot row ${row} has an invalid slot ID.`);
		}
		if (!isPortableVehicleId(input.vehicleId)) {
			throw new TypeError(`Resident home slot row ${row} has an invalid vehicle ID.`);
		}
		if (!isPositiveRecordId(input.anchorPortId)) {
			throw new TypeError(`Resident home slot row ${row} has an invalid anchor port ID.`);
		}
		if (input.policy !== SIMULATION_RESIDENT_FLEET_HOME_SLOT_POLICY) {
			throw new TypeError(`Resident home slot row ${row} has an unsupported parking policy.`);
		}
		if (seenSlotIds.has(input.slotId))
			throw new Error(`Duplicate resident home slot ID ${input.slotId}.`);
		if (seenVehicleIds.has(input.vehicleId)) {
			throw new Error(`Duplicate resident vehicle ID ${input.vehicleId}.`);
		}
		if (seenAnchorPortIds.has(input.anchorPortId)) {
			throw new Error(`Duplicate resident home anchor port ${input.anchorPortId}.`);
		}
		seenSlotIds.add(input.slotId);
		seenVehicleIds.add(input.vehicleId);
		seenAnchorPortIds.add(input.anchorPortId);
		return Object.freeze({
			slotId: input.slotId,
			vehicleId: input.vehicleId,
			anchorPortId: input.anchorPortId,
			policy: input.policy,
		});
	});
	normalized.sort((left, right) => left.slotId - right.slotId);
	return Object.freeze(normalized);
}

function compileSlotDraft(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
	input: SimulationResidentFleetHomeSlotInput,
	stationRow: number,
	incomingPathRows: readonly (readonly number[])[],
	switchTrackRows: ReadonlySet<number>,
): SlotDraft {
	const anchorPathRow = foundation.stations.finalPathIndices[stationRow] as number;
	const anchorPathStationMeters = foundation.stations.finalPathStationsMeters[stationRow] as number;
	const intervals = stationaryFootprintIntervals(
		foundation,
		anchorPathRow,
		anchorPathStationMeters,
		occupancyPolicy.rearLeaseExtensionMillimeters / 1_000,
		occupancyPolicy.frontLeaseExtensionMillimeters / 1_000,
		input.slotId,
		incomingPathRows,
	);
	const occurrenceResourceRows: number[] = [];
	const occurrenceStartsMeters: number[] = [];
	const occurrenceEndsMeters: number[] = [];
	const uniqueResourceRows = new Set<number>();
	for (const interval of intervals) {
		appendTrackOccurrences(
			topology,
			interval,
			occurrenceResourceRows,
			occurrenceStartsMeters,
			occurrenceEndsMeters,
			uniqueResourceRows,
		);
	}
	for (const resourceRow of uniqueResourceRows) {
		if (switchTrackRows.has(resourceRow)) {
			throw new Error(
				`Resident home slot ${input.slotId} touches advanced-switch conflict track resource ${resourceRow}.`,
			);
		}
	}
	return Object.freeze({
		slotId: input.slotId,
		vehicleId: input.vehicleId,
		anchorPortId: input.anchorPortId,
		anchorStationRow: stationRow,
		anchorPathRow,
		anchorPathStationMeters,
		footprintTrackResourceRows: Object.freeze(
			[...uniqueResourceRows].sort((left, right) => left - right),
		),
		occurrenceResourceRows: Object.freeze(occurrenceResourceRows),
		occurrenceStartsMeters: Object.freeze(occurrenceStartsMeters),
		occurrenceEndsMeters: Object.freeze(occurrenceEndsMeters),
	});
}

function stationaryFootprintIntervals(
	foundation: SimulationStaticWorldFoundation,
	anchorPathRow: number,
	anchorStationMeters: number,
	rearMeters: number,
	frontMeters: number,
	slotId: number,
	incomingPathRows: readonly (readonly number[])[],
): readonly PathInterval[] {
	const pathLength = foundation.paths.lengths[anchorPathRow] as number;
	if (
		!Number.isFinite(anchorStationMeters) ||
		anchorStationMeters < -STATION_EPSILON_METERS ||
		anchorStationMeters > pathLength + STATION_EPSILON_METERS
	) {
		throw new Error(`Resident home slot ${slotId} anchor station is outside its directed path.`);
	}
	const drafts: MutablePathInterval[] = [
		{
			pathRow: anchorPathRow,
			start: Math.max(0, Math.min(pathLength, anchorStationMeters)),
			end: Math.max(0, Math.min(pathLength, anchorStationMeters)),
		},
	];
	extendBackward(foundation, drafts, rearMeters, slotId, incomingPathRows);
	extendForward(foundation, drafts, frontMeters, slotId);
	const intervals: PathInterval[] = [];
	let routeCursor = -rearMeters;
	for (const draft of drafts) {
		if (draft.end <= draft.start + STATION_EPSILON_METERS) {
			throw new Error(`Resident home slot ${slotId} has an empty stationary footprint interval.`);
		}
		intervals.push(
			Object.freeze({
				pathRow: draft.pathRow,
				start: draft.start,
				end: draft.end,
				routeStart: routeCursor,
			}),
		);
		routeCursor += draft.end - draft.start;
	}
	if (Math.abs(routeCursor - frontMeters) > STATION_EPSILON_METERS) {
		throw new Error(`Resident home slot ${slotId} footprint extension changed certified length.`);
	}
	return Object.freeze(intervals);
}

function extendBackward(
	foundation: SimulationStaticWorldFoundation,
	intervals: MutablePathInterval[],
	distanceMeters: number,
	slotId: number,
	incomingPathRows: readonly (readonly number[])[],
): void {
	let remaining = distanceMeters;
	while (remaining > STATION_EPSILON_METERS) {
		assertIntervalBudget(intervals.length, slotId);
		const first = intervals[0] as MutablePathInterval;
		const available = first.start;
		if (available > STATION_EPSILON_METERS) {
			const extension = Math.min(available, remaining);
			first.start -= extension;
			remaining -= extension;
			continue;
		}
		const predecessors = incomingPathRows[first.pathRow] as readonly number[];
		if (predecessors.length !== 1) {
			throw new Error(
				`Resident home slot ${slotId} needs one explicit predecessor for its rear footprint; found ${predecessors.length}.`,
			);
		}
		const pathRow = predecessors[0] as number;
		const pathLength = foundation.paths.lengths[pathRow] as number;
		const extension = Math.min(pathLength, remaining);
		intervals.unshift({ pathRow, start: pathLength - extension, end: pathLength });
		remaining -= extension;
	}
}

function extendForward(
	foundation: SimulationStaticWorldFoundation,
	intervals: MutablePathInterval[],
	distanceMeters: number,
	slotId: number,
): void {
	let remaining = distanceMeters;
	while (remaining > STATION_EPSILON_METERS) {
		assertIntervalBudget(intervals.length, slotId);
		const last = intervals[intervals.length - 1] as MutablePathInterval;
		const pathLength = foundation.paths.lengths[last.pathRow] as number;
		const available = pathLength - last.end;
		if (available > STATION_EPSILON_METERS) {
			const extension = Math.min(available, remaining);
			last.end += extension;
			remaining -= extension;
			continue;
		}
		const start = foundation.paths.adjacencyOffsets[last.pathRow] as number;
		const end = foundation.paths.adjacencyOffsets[last.pathRow + 1] as number;
		if (end - start !== 1) {
			throw new Error(
				`Resident home slot ${slotId} needs one explicit continuation for its front footprint; found ${end - start}.`,
			);
		}
		const pathRow = foundation.paths.adjacencyTargets[start] as number;
		const extension = Math.min(foundation.paths.lengths[pathRow] as number, remaining);
		intervals.push({ pathRow, start: 0, end: extension });
		remaining -= extension;
	}
}

function appendTrackOccurrences(
	topology: SimulationTrackResourceTopology,
	interval: PathInterval,
	resourceRows: number[],
	starts: number[],
	ends: number[],
	uniqueRows: Set<number>,
): void {
	const pathStart = topology.pathResourceOffsets[interval.pathRow] as number;
	const pathEnd = topology.pathResourceOffsets[interval.pathRow + 1] as number;
	let cursor = interval.start;
	for (let row = pathStart; row < pathEnd; row++) {
		const resourceStart = topology.pathResourceStarts[row] as number;
		const resourceEnd = topology.pathResourceEnds[row] as number;
		const start = Math.max(interval.start, resourceStart);
		const end = Math.min(interval.end, resourceEnd);
		if (end <= start) continue;
		if (start > cursor + STATION_EPSILON_METERS) {
			throw new Error(
				`Track resources leave a gap on resident footprint path ${interval.pathRow}.`,
			);
		}
		const resourceRow = topology.pathResourceRows[row] as number;
		resourceRows.push(resourceRow);
		starts.push(interval.routeStart + (start - interval.start));
		ends.push(interval.routeStart + (end - interval.start));
		uniqueRows.add(resourceRow);
		cursor = Math.max(cursor, end);
	}
	if (cursor < interval.end - STATION_EPSILON_METERS) {
		throw new Error(`Track resources do not cover resident footprint path ${interval.pathRow}.`);
	}
}

function buildIncomingPathRows(
	foundation: SimulationStaticWorldFoundation,
): readonly (readonly number[])[] {
	const incoming: number[][] = Array.from({ length: foundation.paths.pathCount }, () => []);
	for (let pathRow = 0; pathRow < foundation.paths.pathCount; pathRow++) {
		const start = foundation.paths.adjacencyOffsets[pathRow] as number;
		const end = foundation.paths.adjacencyOffsets[pathRow + 1] as number;
		for (let row = start; row < end; row++) {
			incoming[foundation.paths.adjacencyTargets[row] as number]?.push(pathRow);
		}
	}
	return Object.freeze(incoming.map((rows) => Object.freeze(rows)));
}

function assertCompatibleSources(
	foundation: SimulationStaticWorldFoundation,
	topology: SimulationTrackResourceTopology,
	occupancyPolicy: SimulationTrackOccupancyPolicy,
): void {
	const foundationError = simulationStaticWorldFoundationError(foundation);
	if (foundationError)
		throw new Error(`Simulation static-world foundation is invalid: ${foundationError}`);
	const topologyError = simulationTrackResourceTopologyError(topology);
	if (topologyError)
		throw new Error(`Simulation track-resource topology is invalid: ${topologyError}`);
	const occupancyError = simulationTrackOccupancyPolicyError(occupancyPolicy);
	if (occupancyError)
		throw new Error(`Simulation track occupancy policy is invalid: ${occupancyError}`);
	if (
		topology.sourceFoundationFingerprint !== foundation.fingerprint ||
		occupancyPolicy.sourceFoundationFingerprint !== foundation.fingerprint ||
		occupancyPolicy.sourceTrackResourceTopologyFingerprint !== topology.fingerprint
	) {
		throw new Error("Resident fleet parking inputs do not belong to one exact static source.");
	}
}

function validFootprintRows(configuration: SimulationResidentFleetParkingConfiguration): boolean {
	const globallyOccupied = new Set<number>();
	const rearMeters = configuration.rearLeaseExtensionMillimeters / 1_000;
	const frontMeters = configuration.frontLeaseExtensionMillimeters / 1_000;
	for (let slotRow = 0; slotRow < configuration.slotCount; slotRow++) {
		const footprintStart = configuration.footprintTrackResourceOffsets[slotRow] as number;
		const footprintEnd = configuration.footprintTrackResourceOffsets[slotRow + 1] as number;
		if (
			footprintStart === footprintEnd ||
			!strictlyIncreasing(configuration.footprintTrackResourceRows, footprintStart, footprintEnd)
		) {
			return false;
		}
		const expectedRows = new Set<number>();
		for (let row = footprintStart; row < footprintEnd; row++) {
			const resourceRow = configuration.footprintTrackResourceRows[row] as number;
			if (globallyOccupied.has(resourceRow)) return false;
			globallyOccupied.add(resourceRow);
			expectedRows.add(resourceRow);
		}
		const occurrenceStart = configuration.orderedOccurrenceOffsets[slotRow] as number;
		const occurrenceEnd = configuration.orderedOccurrenceOffsets[slotRow + 1] as number;
		if (occurrenceStart === occurrenceEnd) return false;
		let cursor = -rearMeters;
		const observedRows = new Set<number>();
		for (let row = occurrenceStart; row < occurrenceEnd; row++) {
			const resourceRow = configuration.orderedOccurrenceResourceRows[row] as number;
			const start = configuration.orderedOccurrenceStartsMeters[row] as number;
			const end = configuration.orderedOccurrenceEndsMeters[row] as number;
			if (
				!expectedRows.has(resourceRow) ||
				!Number.isFinite(start) ||
				!Number.isFinite(end) ||
				Math.abs(start - cursor) > STATION_EPSILON_METERS ||
				end <= start
			) {
				return false;
			}
			observedRows.add(resourceRow);
			cursor = end;
		}
		if (
			Math.abs(cursor - frontMeters) > STATION_EPSILON_METERS ||
			observedRows.size !== expectedRows.size
		) {
			return false;
		}
	}
	return true;
}

function simulationResidentFleetParkingConfigurationViews(
	configuration: Omit<SimulationResidentFleetParkingConfiguration, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		configuration.slotIds,
		configuration.anchorPortIds,
		configuration.anchorStationRows,
		configuration.anchorPathRows,
		configuration.anchorPathStationsMeters,
		configuration.footprintTrackResourceOffsets,
		configuration.footprintTrackResourceRows,
		configuration.orderedOccurrenceOffsets,
		configuration.orderedOccurrenceResourceRows,
		configuration.orderedOccurrenceStartsMeters,
		configuration.orderedOccurrenceEndsMeters,
	];
}

function assertTypedMemoryLimit(
	slotCount: number,
	footprintResourceCount: number,
	occurrenceCount: number,
): void {
	const bytes =
		slotCount * (Uint32Array.BYTES_PER_ELEMENT * 4 + Float64Array.BYTES_PER_ELEMENT) +
		(slotCount + 1) * Uint32Array.BYTES_PER_ELEMENT * 2 +
		footprintResourceCount * Uint32Array.BYTES_PER_ELEMENT +
		occurrenceCount * (Uint32Array.BYTES_PER_ELEMENT + Float64Array.BYTES_PER_ELEMENT * 2);
	if (!Number.isSafeInteger(bytes) || bytes > SIMULATION_RESIDENT_FLEET_MAXIMUM_TYPED_BYTES) {
		throw new RangeError("Resident fleet parking configuration exceeds the typed-memory limit.");
	}
}

function assertIntervalBudget(intervalCount: number, slotId: number): void {
	if (intervalCount >= MAXIMUM_FOOTPRINT_PATH_INTERVALS_PER_SLOT) {
		throw new RangeError(`Resident home slot ${slotId} exceeds the path-extension work limit.`);
	}
}

function isPortableVehicleId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 128 &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
	);
}

function uniquePortableVehicleIds(values: readonly unknown[]): values is readonly string[] {
	const seen = new Set<string>();
	for (const value of values) {
		if (!isPortableVehicleId(value) || seen.has(value)) return false;
		seen.add(value);
	}
	return true;
}

function isPositiveRecordId(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}

function isUint32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((entry, row) => entry === expected[row])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, row) => key === expected[row]);
}

function isUint32Array(value: unknown, length: number): value is Uint32Array {
	return value instanceof Uint32Array && value.length === length;
}

function isFloat64Array(value: unknown, length: number): value is Float64Array {
	return value instanceof Float64Array && value.length === length;
}

function isCsr(value: unknown, rowCount: number, itemCount: number): value is Uint32Array {
	if (!isUint32Array(value, rowCount + 1) || value[0] !== 0 || value[rowCount] !== itemCount) {
		return false;
	}
	for (let row = 1; row < value.length; row++) {
		if ((value[row] as number) < (value[row - 1] as number)) return false;
	}
	return true;
}

function strictlyIncreasing(values: Uint32Array, start: number, end: number): boolean {
	for (let row = start + 1; row < end; row++) {
		if ((values[row] as number) <= (values[row - 1] as number)) return false;
	}
	return true;
}

function strictlyIncreasingPositive(values: Uint32Array): boolean {
	if (values.length > 0 && !isPositiveRecordId(values[0])) return false;
	return strictlyIncreasing(values, 0, values.length);
}

function uniquePositive(values: Uint32Array): boolean {
	const seen = new Set<number>();
	for (const value of values) {
		if (!isPositiveRecordId(value) || seen.has(value)) return false;
		seen.add(value);
	}
	return true;
}

function hasDistinctOwnedBuffers(views: readonly ArrayBufferView[]): boolean {
	const buffers = views.map((view) => view.buffer);
	return (
		views.every(
			(view) =>
				view.buffer instanceof ArrayBuffer &&
				view.byteOffset === 0 &&
				view.byteLength === view.buffer.byteLength,
		) && new Set(buffers).size === buffers.length
	);
}

function sumByteLengths(views: readonly ArrayBufferView[]): number {
	return views.reduce((sum, view) => sum + view.byteLength, 0);
}
