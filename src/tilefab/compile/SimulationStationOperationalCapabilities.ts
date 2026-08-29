import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { isPositiveRecordId } from "../core/PortRecord";
import {
	type SimulationStaticWorldFoundation,
	simulationStaticWorldFoundationError,
} from "./SimulationStaticWorldFoundation";

export const SIMULATION_STATION_OPERATIONAL_CAPABILITIES_SCHEMA_VERSION = 1;

export const SIMULATION_STATION_TRANSFER_CAPABILITIES = [
	"PICKUP_ONLY",
	"DROPOFF_ONLY",
	"BIDIRECTIONAL",
] as const;

export type SimulationStationTransferCapability =
	(typeof SIMULATION_STATION_TRANSFER_CAPABILITIES)[number];

export const SIMULATION_STATION_TRANSFER_CAPABILITY_CODE = {
	PICKUP_ONLY: 0,
	DROPOFF_ONLY: 1,
	BIDIRECTIONAL: 2,
} as const;

export interface SimulationStationOperationalCapabilityRecord {
	readonly portId: number;
	readonly transferCapability: SimulationStationTransferCapability;
}

export interface SimulationStationOperationalCapabilities {
	readonly schemaVersion: typeof SIMULATION_STATION_OPERATIONAL_CAPABILITIES_SCHEMA_VERSION;
	/** Capabilities are one readiness layer, never complete simulation authorization. */
	readonly simulationReady: false;
	readonly sourceFoundationFingerprint: string;
	readonly stationCount: number;
	readonly portIds: Uint32Array;
	readonly equipmentGroupIds: Uint32Array;
	readonly transferCapabilityCodes: Uint8Array;
	readonly pickupStationRows: Uint32Array;
	readonly dropoffStationRows: Uint32Array;
	readonly equipmentGroupCount: number;
	readonly groupIds: Uint32Array;
	readonly groupKindCodes: Uint8Array;
	readonly groupMemberOffsets: Uint32Array;
	readonly groupMemberStationRows: Uint32Array;
	readonly groupPickupOffsets: Uint32Array;
	readonly groupPickupStationRows: Uint32Array;
	readonly groupDropoffOffsets: Uint32Array;
	readonly groupDropoffStationRows: Uint32Array;
	readonly fingerprint: string;
	readonly byteLength: number;
}

/**
 * Compiles explicit per-port transfer roles into stable station/group candidate indexes.
 * Geometric facing, equipment kind, barcode, group membership, and row order never infer a role.
 */
export function compileSimulationStationOperationalCapabilities(
	foundation: SimulationStaticWorldFoundation,
	records: readonly SimulationStationOperationalCapabilityRecord[],
): SimulationStationOperationalCapabilities {
	const foundationError = simulationStaticWorldFoundationError(foundation);
	if (foundationError) {
		throw new Error(`Simulation static-world foundation is invalid: ${foundationError}`);
	}
	const capabilityByPortId = new Map<number, SimulationStationTransferCapability>();
	for (const record of records) {
		const error = simulationStationOperationalCapabilityRecordError(record);
		if (error) throw new Error(`Station operational capability is invalid: ${error}`);
		if (capabilityByPortId.has(record.portId)) {
			throw new Error(`Station operational capability repeats port ${record.portId}.`);
		}
		capabilityByPortId.set(record.portId, record.transferCapability);
	}
	if (capabilityByPortId.size !== foundation.stations.count) {
		throw new Error(
			"Station operational capabilities must configure every persistent port exactly once.",
		);
	}

	const transferCapabilityCodes = new Uint8Array(foundation.stations.count);
	const pickupStationRows: number[] = [];
	const dropoffStationRows: number[] = [];
	const stationRowByPortId = new Map<number, number>();
	for (let stationRow = 0; stationRow < foundation.stations.count; stationRow++) {
		const portId = foundation.stations.ids[stationRow] as number;
		const capability = capabilityByPortId.get(portId);
		if (!capability) {
			throw new Error(`Station operational capability is missing for port ${portId}.`);
		}
		stationRowByPortId.set(portId, stationRow);
		const code = encodeTransferCapability(capability);
		transferCapabilityCodes[stationRow] = code;
		if (allowsPickup(code)) pickupStationRows.push(stationRow);
		if (allowsDropoff(code)) dropoffStationRows.push(stationRow);
		capabilityByPortId.delete(portId);
	}
	if (capabilityByPortId.size > 0) {
		throw new Error(
			`Station operational capability references foreign port ${capabilityByPortId.keys().next().value}.`,
		);
	}

	const groupPickupOffsets = new Uint32Array(foundation.equipmentGroups.count + 1);
	const groupMemberOffsets = new Uint32Array(foundation.equipmentGroups.count + 1);
	const groupMemberStationRows: number[] = [];
	const groupPickupStationRows: number[] = [];
	const groupDropoffOffsets = new Uint32Array(foundation.equipmentGroups.count + 1);
	const groupDropoffStationRows: number[] = [];
	for (let groupRow = 0; groupRow < foundation.equipmentGroups.count; groupRow++) {
		groupMemberOffsets[groupRow] = groupMemberStationRows.length;
		groupPickupOffsets[groupRow] = groupPickupStationRows.length;
		groupDropoffOffsets[groupRow] = groupDropoffStationRows.length;
		const start = foundation.equipmentGroups.portOffsets[groupRow] as number;
		const end = foundation.equipmentGroups.portOffsets[groupRow + 1] as number;
		for (let row = start; row < end; row++) {
			const portId = foundation.equipmentGroups.portIds[row] as number;
			const stationRow = stationRowByPortId.get(portId);
			if (stationRow === undefined) {
				throw new Error(`Equipment group references missing station port ${portId}.`);
			}
			groupMemberStationRows.push(stationRow);
			const code = transferCapabilityCodes[stationRow] as number;
			if (allowsPickup(code)) groupPickupStationRows.push(stationRow);
			if (allowsDropoff(code)) groupDropoffStationRows.push(stationRow);
		}
	}
	groupMemberOffsets[foundation.equipmentGroups.count] = groupMemberStationRows.length;
	groupPickupOffsets[foundation.equipmentGroups.count] = groupPickupStationRows.length;
	groupDropoffOffsets[foundation.equipmentGroups.count] = groupDropoffStationRows.length;

	const capabilitiesWithoutIdentity = {
		schemaVersion: SIMULATION_STATION_OPERATIONAL_CAPABILITIES_SCHEMA_VERSION,
		simulationReady: false,
		sourceFoundationFingerprint: foundation.fingerprint,
		stationCount: foundation.stations.count,
		portIds: foundation.stations.ids.slice(),
		equipmentGroupIds: foundation.stations.equipmentGroupIds.slice(),
		transferCapabilityCodes,
		pickupStationRows: Uint32Array.from(pickupStationRows),
		dropoffStationRows: Uint32Array.from(dropoffStationRows),
		equipmentGroupCount: foundation.equipmentGroups.count,
		groupIds: foundation.equipmentGroups.ids.slice(),
		groupKindCodes: foundation.equipmentGroups.kindCodes.slice(),
		groupMemberOffsets,
		groupMemberStationRows: Uint32Array.from(groupMemberStationRows),
		groupPickupOffsets,
		groupPickupStationRows: Uint32Array.from(groupPickupStationRows),
		groupDropoffOffsets,
		groupDropoffStationRows: Uint32Array.from(groupDropoffStationRows),
	} as const;
	const views = simulationStationOperationalCapabilitiesViews(capabilitiesWithoutIdentity);
	const capabilities = Object.freeze({
		...capabilitiesWithoutIdentity,
		fingerprint: checksumSimulationStationOperationalCapabilities(capabilitiesWithoutIdentity),
		byteLength: sumByteLengths(views),
	}) satisfies SimulationStationOperationalCapabilities;
	const error = simulationStationOperationalCapabilitiesError(capabilities);
	if (error) throw new Error(`Compiled station operational capabilities are invalid: ${error}`);
	return capabilities;
}

export function simulationStationOperationalCapabilityRecordError(record: unknown): string | null {
	if (!isRecord(record)) return "record must be an object";
	if (!isPositiveRecordId(record.portId as number)) {
		return "port ID must be a positive signed int32";
	}
	if (
		typeof record.transferCapability !== "string" ||
		!SIMULATION_STATION_TRANSFER_CAPABILITIES.includes(
			record.transferCapability as SimulationStationTransferCapability,
		)
	) {
		return "transfer capability is invalid";
	}
	return null;
}

export function checksumSimulationStationOperationalCapabilities(
	capabilities: Omit<SimulationStationOperationalCapabilities, "fingerprint" | "byteLength">,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addNumbers([
		capabilities.schemaVersion,
		capabilities.simulationReady ? 1 : 0,
		capabilities.stationCount,
		capabilities.equipmentGroupCount,
	]);
	checksum.addStrings([capabilities.sourceFoundationFingerprint]);
	checksum.addViews(simulationStationOperationalCapabilitiesViews(capabilities));
	return checksum.digest();
}

export function simulationStationOperationalCapabilitiesError(value: unknown): string | null {
	if (!isRecord(value)) return "station operational capabilities must be an object";
	if (value.schemaVersion !== SIMULATION_STATION_OPERATIONAL_CAPABILITIES_SCHEMA_VERSION) {
		return "schema version is invalid";
	}
	if (value.simulationReady !== false) return "station capabilities cannot authorize simulation";
	if (!isNonEmptyString(value.sourceFoundationFingerprint)) {
		return "source foundation fingerprint is invalid";
	}
	if (
		!isNonNegativeSafeInteger(value.stationCount) ||
		!isNonNegativeSafeInteger(value.equipmentGroupCount)
	) {
		return "station or equipment-group count is invalid";
	}
	const pickupCount =
		value.pickupStationRows instanceof Uint32Array ? value.pickupStationRows.length : -1;
	const dropoffCount =
		value.dropoffStationRows instanceof Uint32Array ? value.dropoffStationRows.length : -1;
	const groupPickupCount =
		value.groupPickupStationRows instanceof Uint32Array ? value.groupPickupStationRows.length : -1;
	const groupDropoffCount =
		value.groupDropoffStationRows instanceof Uint32Array
			? value.groupDropoffStationRows.length
			: -1;
	const groupMemberCount =
		value.groupMemberStationRows instanceof Uint32Array ? value.groupMemberStationRows.length : -1;
	if (
		!isUint32Array(value.portIds, value.stationCount) ||
		!isUint32Array(value.equipmentGroupIds, value.stationCount) ||
		!isUint8Array(value.transferCapabilityCodes, value.stationCount) ||
		!isUint32Array(value.pickupStationRows, pickupCount) ||
		!isUint32Array(value.dropoffStationRows, dropoffCount) ||
		!isUint32Array(value.groupIds, value.equipmentGroupCount) ||
		!isUint8Array(value.groupKindCodes, value.equipmentGroupCount) ||
		!isCsr(value.groupMemberOffsets, value.equipmentGroupCount, groupMemberCount) ||
		!isUint32Array(value.groupMemberStationRows, groupMemberCount) ||
		!isCsr(value.groupPickupOffsets, value.equipmentGroupCount, groupPickupCount) ||
		!isUint32Array(value.groupPickupStationRows, groupPickupCount) ||
		!isCsr(value.groupDropoffOffsets, value.equipmentGroupCount, groupDropoffCount) ||
		!isUint32Array(value.groupDropoffStationRows, groupDropoffCount)
	) {
		return "station capability columns are malformed";
	}
	const capabilities = value as unknown as SimulationStationOperationalCapabilities;
	if (!rowsWithin(capabilities.pickupStationRows, capabilities.stationCount)) {
		return "pickup station row is outside the station domain";
	}
	if (!rowsWithin(capabilities.dropoffStationRows, capabilities.stationCount)) {
		return "dropoff station row is outside the station domain";
	}
	if (!rowsWithin(capabilities.groupPickupStationRows, capabilities.stationCount)) {
		return "group pickup station row is outside the station domain";
	}
	if (!rowsWithin(capabilities.groupMemberStationRows, capabilities.stationCount)) {
		return "group member station row is outside the station domain";
	}
	if (!rowsWithin(capabilities.groupDropoffStationRows, capabilities.stationCount)) {
		return "group dropoff station row is outside the station domain";
	}
	if (
		!validUniquePositiveIds(capabilities.portIds) ||
		!validUniquePositiveIds(capabilities.groupIds)
	) {
		return "port and group IDs must be positive and unique";
	}
	if (!validStationCandidateIndexes(capabilities)) {
		return "station candidate indexes do not match explicit transfer capabilities";
	}
	if (!validGroupCandidateIndexes(capabilities)) {
		return "equipment-group candidate indexes do not match station membership";
	}
	const views = simulationStationOperationalCapabilitiesViews(capabilities);
	if (!hasDistinctOwnedBuffers(views)) return "typed arrays must own distinct buffers";
	if (!isNonNegativeSafeInteger(value.byteLength) || value.byteLength !== sumByteLengths(views)) {
		return "transfer byte length is invalid";
	}
	if (!isNonEmptyString(value.fingerprint)) return "fingerprint is invalid";
	try {
		if (
			checksumSimulationStationOperationalCapabilities(capabilities) !== capabilities.fingerprint
		) {
			return "fingerprint does not match station capability content";
		}
	} catch {
		return "station capability fingerprint cannot be recomputed";
	}
	return null;
}

export function isSimulationStationOperationalCapabilities(
	value: unknown,
): value is SimulationStationOperationalCapabilities {
	return simulationStationOperationalCapabilitiesError(value) === null;
}

function validStationCandidateIndexes(
	capabilities: SimulationStationOperationalCapabilities,
): boolean {
	const expectedPickup: number[] = [];
	const expectedDropoff: number[] = [];
	for (let stationRow = 0; stationRow < capabilities.stationCount; stationRow++) {
		const code = capabilities.transferCapabilityCodes[stationRow] as number;
		if (!validTransferCapabilityCode(code)) return false;
		if (allowsPickup(code)) expectedPickup.push(stationRow);
		if (allowsDropoff(code)) expectedDropoff.push(stationRow);
	}
	return (
		sameNumbers(capabilities.pickupStationRows, expectedPickup) &&
		sameNumbers(capabilities.dropoffStationRows, expectedDropoff)
	);
}

function validGroupCandidateIndexes(
	capabilities: SimulationStationOperationalCapabilities,
): boolean {
	const groupRowById = new Map<number, number>();
	for (let groupRow = 0; groupRow < capabilities.equipmentGroupCount; groupRow++) {
		const kindCode = capabilities.groupKindCodes[groupRow] as number;
		if (kindCode > 2) return false;
		groupRowById.set(capabilities.groupIds[groupRow] as number, groupRow);
	}
	const expectedPickup: number[][] = Array.from(
		{ length: capabilities.equipmentGroupCount },
		() => [],
	);
	const expectedDropoff: number[][] = Array.from(
		{ length: capabilities.equipmentGroupCount },
		() => [],
	);
	const seenStationRows = new Set<number>();
	for (let groupRow = 0; groupRow < capabilities.equipmentGroupCount; groupRow++) {
		const memberStart = capabilities.groupMemberOffsets[groupRow] as number;
		const memberEnd = capabilities.groupMemberOffsets[groupRow + 1] as number;
		for (let row = memberStart; row < memberEnd; row++) {
			const stationRow = capabilities.groupMemberStationRows[row] as number;
			if (
				seenStationRows.has(stationRow) ||
				groupRowById.get(capabilities.equipmentGroupIds[stationRow] as number) !== groupRow
			) {
				return false;
			}
			seenStationRows.add(stationRow);
			const code = capabilities.transferCapabilityCodes[stationRow] as number;
			if (allowsPickup(code)) expectedPickup[groupRow]?.push(stationRow);
			if (allowsDropoff(code)) expectedDropoff[groupRow]?.push(stationRow);
		}
		const pickupStart = capabilities.groupPickupOffsets[groupRow] as number;
		const pickupEnd = capabilities.groupPickupOffsets[groupRow + 1] as number;
		const dropoffStart = capabilities.groupDropoffOffsets[groupRow] as number;
		const dropoffEnd = capabilities.groupDropoffOffsets[groupRow + 1] as number;
		if (
			!sameNumbers(
				capabilities.groupPickupStationRows.subarray(pickupStart, pickupEnd),
				expectedPickup[groupRow] ?? [],
			) ||
			!sameNumbers(
				capabilities.groupDropoffStationRows.subarray(dropoffStart, dropoffEnd),
				expectedDropoff[groupRow] ?? [],
			)
		) {
			return false;
		}
	}
	return seenStationRows.size === capabilities.stationCount;
}

function simulationStationOperationalCapabilitiesViews(
	capabilities: Omit<SimulationStationOperationalCapabilities, "fingerprint" | "byteLength">,
): readonly ArrayBufferView[] {
	return [
		capabilities.portIds,
		capabilities.equipmentGroupIds,
		capabilities.transferCapabilityCodes,
		capabilities.pickupStationRows,
		capabilities.dropoffStationRows,
		capabilities.groupIds,
		capabilities.groupKindCodes,
		capabilities.groupMemberOffsets,
		capabilities.groupMemberStationRows,
		capabilities.groupPickupOffsets,
		capabilities.groupPickupStationRows,
		capabilities.groupDropoffOffsets,
		capabilities.groupDropoffStationRows,
	];
}

function encodeTransferCapability(capability: SimulationStationTransferCapability): number {
	return SIMULATION_STATION_TRANSFER_CAPABILITY_CODE[capability];
}

function validTransferCapabilityCode(code: number): boolean {
	return (
		code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.PICKUP_ONLY ||
		code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.DROPOFF_ONLY ||
		code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.BIDIRECTIONAL
	);
}

function allowsPickup(code: number): boolean {
	return (
		code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.PICKUP_ONLY ||
		code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.BIDIRECTIONAL
	);
}

function allowsDropoff(code: number): boolean {
	return (
		code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.DROPOFF_ONLY ||
		code === SIMULATION_STATION_TRANSFER_CAPABILITY_CODE.BIDIRECTIONAL
	);
}

function validUniquePositiveIds(values: Uint32Array): boolean {
	const seen = new Set<number>();
	for (const value of values) {
		if (!isPositiveRecordId(value) || seen.has(value)) return false;
		seen.add(value);
	}
	return true;
}

function sameNumbers(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUint32Array(value: unknown, length?: number): value is Uint32Array {
	return value instanceof Uint32Array && (length === undefined || value.length === length);
}

function isUint8Array(value: unknown, length?: number): value is Uint8Array {
	return value instanceof Uint8Array && (length === undefined || value.length === length);
}
