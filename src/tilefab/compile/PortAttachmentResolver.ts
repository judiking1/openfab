import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchProfileClass,
} from "../core/AdvancedSwitch";
import {
	type PortRecord,
	type PortRouteIdentity,
	type PortSide,
	portRouteIdentityKey,
} from "../core/PortRecord";
import {
	ADVANCED_SWITCH_NO_PORT,
	ADVANCED_SWITCH_PROFILE_CLASS_CODE,
	ADVANCED_SWITCH_SEGMENT_ROLE,
} from "./AdvancedSwitchPhysicalVariant";
import {
	type CompiledPathIntervalRemap,
	NO_PATH_INTERVAL_TARGET,
	PATH_INTERVAL_MAPPING_KIND,
	PATH_SOURCE_IDENTITY_KIND,
} from "./CompoundPhysicalPath";
import { PATH_KIND, samplePhysicalPath } from "./PhysicalPathCompiler";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";

export const PORT_ATTACHMENT_FAILURE = {
	INVALID_STATION: "INVALID_STATION",
	SOURCE_NOT_FOUND: "SOURCE_NOT_FOUND",
	SOURCE_AMBIGUOUS: "SOURCE_AMBIGUOUS",
	STATION_OUT_OF_RANGE: "STATION_OUT_OF_RANGE",
	UNMAPPABLE_INTERVAL: "UNMAPPABLE_INTERVAL",
	TARGET_PATH_INVALID: "TARGET_PATH_INVALID",
	TARGET_AMBIGUOUS: "TARGET_AMBIGUOUS",
	SAMPLE_FAILED: "SAMPLE_FAILED",
} as const;

export type PortAttachmentFailureCode =
	(typeof PORT_ATTACHMENT_FAILURE)[keyof typeof PORT_ATTACHMENT_FAILURE];

export interface PortAttachmentFailure {
	readonly ok: false;
	readonly code: PortAttachmentFailureCode;
	readonly message: string;
}

export interface ResolvedPortAttachment {
	readonly ok: true;
	readonly sourcePathIndex: number;
	readonly finalPathIndex: number;
	readonly canonicalStationMillimeters: number;
	readonly finalPathStationMeters: number;
	readonly railXMeters: number;
	readonly railZMeters: number;
	readonly worldXMeters: number;
	readonly worldZMeters: number;
	readonly tangentX: number;
	readonly tangentZ: number;
	readonly yawRadians: number;
}

export type PortAttachmentResolution = ResolvedPortAttachment | PortAttachmentFailure;

/** Immutable O(1) route lookup for project-wide attachment validation. */
export interface PortAttachmentSourceIndex {
	readonly sourcePathCount: number;
	readonly sourceRemap: CompiledPathIntervalRemap;
	rows(route: PortRouteIdentity): Int32Array | null;
}

const sourceIndexLayoutIdentities = new WeakMap<object, object>();
const layoutIdentities = new WeakMap<object, object>();

function exactLayoutIdentity(layout: CompiledPhysicalLayout): object {
	const existing = layoutIdentities.get(layout);
	if (existing) return existing;
	const identity = Object.freeze({});
	layoutIdentities.set(layout, identity);
	return identity;
}

interface MappedStation {
	readonly pathIndex: number;
	readonly station: number;
}

const STATION_EPSILON_METERS = 1e-5;
const SAMPLE_EPSILON_METERS = 1e-5;

/** Resolve persisted raw-route identity and canonical millimeters into current physical geometry. */
export function resolvePortAttachment(
	layout: CompiledPhysicalLayout,
	port: Pick<
		PortRecord,
		"route" | "stationMillimeters" | "side" | "lateralOffsetMillimeters" | "direction"
	>,
): PortAttachmentResolution {
	if (!isInt32(port.stationMillimeters)) {
		return failure(
			PORT_ATTACHMENT_FAILURE.INVALID_STATION,
			"Port station must be a signed int32 millimeter value.",
		);
	}
	const sourceIndices = findSourcePathIndices(layout.pathIntervalRemap, port.route);
	if (sourceIndices.length === 0) {
		return failure(
			PORT_ATTACHMENT_FAILURE.SOURCE_NOT_FOUND,
			"The attached directed raw route does not exist in the compiled layout.",
		);
	}
	if (sourceIndices.length > 1) {
		return failure(
			PORT_ATTACHMENT_FAILURE.SOURCE_AMBIGUOUS,
			"The attached directed raw route resolves to more than one source path.",
		);
	}
	const sourcePathIndex = sourceIndices[0] as number;
	return resolvePortAttachmentAtSourcePath(layout, port, sourcePathIndex);
}

/** Build one route-to-source index instead of scanning every physical source path per port. */
export function createPortAttachmentSourceIndex(
	layout: CompiledPhysicalLayout,
): PortAttachmentSourceIndex {
	const mutable = new Map<string, number[]>();
	for (let index = 0; index < layout.pathIntervalRemap.sourcePathCount; index++) {
		const key = sourcePathIdentityKey(layout.pathIntervalRemap, index);
		const rows = mutable.get(key);
		if (rows) rows.push(index);
		else mutable.set(key, [index]);
	}
	const rowsByKey = new Map(
		[...mutable].map(([key, rows]) => [key, Int32Array.from(rows)] as const),
	);
	const index = Object.freeze({
		sourcePathCount: layout.pathIntervalRemap.sourcePathCount,
		sourceRemap: layout.pathIntervalRemap,
		rows: (route: PortRouteIdentity): Int32Array | null =>
			rowsByKey.get(portRouteIdentityKey(route)) ?? null,
	});
	sourceIndexLayoutIdentities.set(index, exactLayoutIdentity(layout));
	return index;
}

/** Exact runtime provenance for source indexes reused by capability-producing compilers. */
export function portAttachmentSourceIndexMatchesLayout(
	index: PortAttachmentSourceIndex,
	layout: CompiledPhysicalLayout,
): boolean {
	const layoutIdentity = layoutIdentities.get(layout);
	return layoutIdentity !== undefined && sourceIndexLayoutIdentities.get(index) === layoutIdentity;
}

/** Resolve with a project-wide O(1) source index while preserving ambiguity diagnostics. */
export function resolvePortAttachmentWithSourceIndex(
	layout: CompiledPhysicalLayout,
	port: Pick<
		PortRecord,
		"route" | "stationMillimeters" | "side" | "lateralOffsetMillimeters" | "direction"
	>,
	index: PortAttachmentSourceIndex,
): PortAttachmentResolution {
	if (
		index.sourceRemap !== layout.pathIntervalRemap ||
		index.sourcePathCount !== layout.pathIntervalRemap.sourcePathCount
	) {
		return failure(
			PORT_ATTACHMENT_FAILURE.SOURCE_NOT_FOUND,
			"The port attachment source index does not match the compiled layout.",
		);
	}
	const rows = index.rows(port.route);
	if (!rows || rows.length === 0) {
		return failure(
			PORT_ATTACHMENT_FAILURE.SOURCE_NOT_FOUND,
			"The attached directed raw route does not exist in the compiled layout.",
		);
	}
	if (rows.length > 1) {
		return failure(
			PORT_ATTACHMENT_FAILURE.SOURCE_AMBIGUOUS,
			"The attached directed raw route resolves to more than one source path.",
		);
	}
	return resolvePortAttachmentAtSourcePath(layout, port, rows[0] as number);
}

/** O(1) resolver for compiler-owned candidates that already know their raw source row. */
export function resolvePortAttachmentAtSourcePath(
	layout: CompiledPhysicalLayout,
	port: Pick<
		PortRecord,
		"route" | "stationMillimeters" | "side" | "lateralOffsetMillimeters" | "direction"
	>,
	sourcePathIndex: number,
): PortAttachmentResolution {
	if (!isInt32(port.stationMillimeters)) {
		return failure(
			PORT_ATTACHMENT_FAILURE.INVALID_STATION,
			"Port station must be a signed int32 millimeter value.",
		);
	}
	const remap = layout.pathIntervalRemap;
	if (
		!Number.isInteger(sourcePathIndex) ||
		sourcePathIndex < 0 ||
		sourcePathIndex >= remap.sourcePathCount ||
		!sourcePathMatches(remap, sourcePathIndex, port.route)
	) {
		return failure(
			PORT_ATTACHMENT_FAILURE.SOURCE_NOT_FOUND,
			"The attached directed raw route does not match the supplied source path.",
		);
	}
	const canonicalStationMeters = millimetersToMeters(port.stationMillimeters);
	const canonicalStart = remap.sourcePathCanonicalStarts[sourcePathIndex] as number;
	const sourceLength = remap.sourcePathLengths[sourcePathIndex] as number;
	const sourceStation = canonicalStationMeters - canonicalStart;
	if (
		!Number.isFinite(canonicalStart) ||
		!Number.isFinite(sourceLength) ||
		sourceLength < 0 ||
		sourceStation < -STATION_EPSILON_METERS ||
		sourceStation > sourceLength + STATION_EPSILON_METERS
	) {
		return failure(
			PORT_ATTACHMENT_FAILURE.STATION_OUT_OF_RANGE,
			"The canonical station is outside its attached raw route interval.",
		);
	}
	const mapped = mapSourceStation(remap, sourcePathIndex, clamp(sourceStation, 0, sourceLength));
	if (mapped.kind === "UNMAPPABLE") {
		return failure(
			PORT_ATTACHMENT_FAILURE.UNMAPPABLE_INTERVAL,
			"The canonical station lies in physical support geometry with no final path mapping.",
		);
	}
	if (mapped.kind === "AMBIGUOUS") {
		return failure(
			PORT_ATTACHMENT_FAILURE.TARGET_AMBIGUOUS,
			"The canonical station maps to more than one final physical path.",
		);
	}
	if (mapped.kind === "MISSING") {
		return failure(
			PORT_ATTACHMENT_FAILURE.TARGET_PATH_INVALID,
			"The canonical station has no valid final physical path mapping.",
		);
	}
	if (
		mapped.value.pathIndex < 0 ||
		mapped.value.pathIndex >= layout.paths.pathCount ||
		(layout.paths.kinds[mapped.value.pathIndex] as number) === PATH_KIND.INVALID
	) {
		return failure(
			PORT_ATTACHMENT_FAILURE.TARGET_PATH_INVALID,
			"The canonical station maps to an invalid final physical path.",
		);
	}
	const sample = samplePhysicalPath(layout.paths, mapped.value.pathIndex, mapped.value.station);
	if (!sample) {
		return failure(
			PORT_ATTACHMENT_FAILURE.SAMPLE_FAILED,
			"The final physical path could not be sampled at the mapped station.",
		);
	}
	const offsetMeters = signedOffsetMeters(port.side, port.lateralOffsetMillimeters);
	const yaw = normalizeRadians(
		Math.atan2(sample.tangentY, sample.tangentX) +
			(port.direction === "AGAINST_TRAVEL" ? Math.PI : 0),
	);
	return Object.freeze({
		ok: true,
		sourcePathIndex,
		finalPathIndex: mapped.value.pathIndex,
		canonicalStationMillimeters: port.stationMillimeters,
		finalPathStationMeters: mapped.value.station,
		railXMeters: sample.x,
		railZMeters: sample.y,
		worldXMeters: sample.x - sample.tangentY * offsetMeters,
		worldZMeters: sample.y + sample.tangentX * offsetMeters,
		tangentX: sample.tangentX,
		tangentZ: sample.tangentY,
		yawRadians: yaw,
	});
}

export function findSourcePathIndices(
	remap: CompiledPathIntervalRemap,
	route: PortRouteIdentity,
): readonly number[] {
	const matches: number[] = [];
	for (let index = 0; index < remap.sourcePathCount; index++) {
		if (sourcePathMatches(remap, index, route)) matches.push(index);
	}
	return matches;
}

export function millimetersToMeters(value: number): number {
	if (!Number.isInteger(value)) throw new TypeError("Millimeter values must be integers.");
	return value / 1_000;
}

export function metersToMillimeters(value: number): number {
	if (!Number.isFinite(value)) throw new TypeError("Meter values must be finite.");
	const millimeters = Math.round(value * 1_000);
	if (!Number.isSafeInteger(millimeters))
		throw new RangeError("Meter value exceeds exact millimeters.");
	return millimeters;
}

function sourcePathMatches(
	remap: CompiledPathIntervalRemap,
	index: number,
	route: PortRouteIdentity,
): boolean {
	if (route.kind === "CARDINAL_CELL") {
		const offset = index * 2;
		return (
			(remap.sourceIdentityKinds[index] as number) === PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL &&
			(remap.sourcePathCells[offset] as number) === route.x &&
			(remap.sourcePathCells[offset + 1] as number) === route.z &&
			(remap.sourcePathFromDirections[index] as number) === route.from &&
			(remap.sourcePathToDirections[index] as number) === route.to
		);
	}
	return (
		(remap.sourceIdentityKinds[index] as number) ===
			PATH_SOURCE_IDENTITY_KIND.ADVANCED_SWITCH_SEGMENT &&
		(remap.sourceAdvancedSwitchIds[index] as number) === route.switchId &&
		(remap.sourceAdvancedSwitchProfileClasses[index] as number) ===
			ADVANCED_SWITCH_PROFILE_CLASS_CODE[route.profileClass] &&
		(remap.sourceAdvancedSwitchRoles[index] as number) === roleCode(route.role) &&
		(remap.sourceAdvancedSwitchPorts[index] as number) ===
			(route.portIndex === null ? ADVANCED_SWITCH_NO_PORT : route.portIndex) &&
		(remap.sourceAdvancedSwitchSegmentOrdinals[index] as number) === route.segmentOrdinal
	);
}

function sourcePathIdentityKey(remap: CompiledPathIntervalRemap, index: number): string {
	if ((remap.sourceIdentityKinds[index] as number) === PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL) {
		const offset = index * 2;
		return `C:${remap.sourcePathCells[offset]}:${remap.sourcePathCells[offset + 1]}:${remap.sourcePathFromDirections[index]}:${remap.sourcePathToDirections[index]}`;
	}
	const profileClass = ADVANCED_SWITCH_PROFILE_CLASSES[
		remap.sourceAdvancedSwitchProfileClasses[index] as number
	] as AdvancedSwitchProfileClass | undefined;
	if (!profileClass) throw new Error(`Physical source path ${index} has an invalid profile class.`);
	const role = roleName(remap.sourceAdvancedSwitchRoles[index] as number);
	const port = remap.sourceAdvancedSwitchPorts[index] as number;
	return `A:${remap.sourceAdvancedSwitchIds[index]}:${profileClass}:${role}:${port === ADVANCED_SWITCH_NO_PORT ? "-" : port}:${remap.sourceAdvancedSwitchSegmentOrdinals[index]}`;
}

function mapSourceStation(
	remap: CompiledPathIntervalRemap,
	sourcePathIndex: number,
	sourceStation: number,
):
	| { readonly kind: "MAPPED"; readonly value: MappedStation }
	| { readonly kind: "MISSING" }
	| { readonly kind: "UNMAPPABLE" }
	| { readonly kind: "AMBIGUOUS" } {
	const rowStart = remap.sourcePathOffsets[sourcePathIndex] as number;
	const rowEnd = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
	const candidates: MappedStation[] = [];
	let intersectsUnmappable = false;
	for (let row = rowStart; row < rowEnd; row++) {
		const sourceStart = remap.sourceStarts[row] as number;
		const sourceEnd = remap.sourceEnds[row] as number;
		if (
			sourceStation < sourceStart - STATION_EPSILON_METERS ||
			sourceStation > sourceEnd + STATION_EPSILON_METERS
		) {
			continue;
		}
		if (
			(remap.mappingKinds[row] as number) === PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE ||
			(remap.targetPathIndices[row] as number) === NO_PATH_INTERVAL_TARGET
		) {
			intersectsUnmappable = true;
			continue;
		}
		const span = sourceEnd - sourceStart;
		const amount =
			span <= STATION_EPSILON_METERS ? 0 : clamp((sourceStation - sourceStart) / span, 0, 1);
		const targetStart = remap.targetStarts[row] as number;
		const targetEnd = remap.targetEnds[row] as number;
		const candidate = {
			pathIndex: remap.targetPathIndices[row] as number,
			station: targetStart + (targetEnd - targetStart) * amount,
		};
		if (!candidates.some((existing) => sameMappedStation(existing, candidate))) {
			candidates.push(candidate);
		}
	}
	if (candidates.length > 1) return { kind: "AMBIGUOUS" };
	if (candidates.length === 1) return { kind: "MAPPED", value: candidates[0] as MappedStation };
	return { kind: intersectsUnmappable ? "UNMAPPABLE" : "MISSING" };
}

function sameMappedStation(left: MappedStation, right: MappedStation): boolean {
	return (
		left.pathIndex === right.pathIndex &&
		Math.abs(left.station - right.station) <= SAMPLE_EPSILON_METERS
	);
}

function signedOffsetMeters(side: PortSide, offsetMillimeters: number): number {
	if (side === "CENTER") return 0;
	const magnitude = millimetersToMeters(offsetMillimeters);
	return side === "LEFT" ? magnitude : -magnitude;
}

function roleCode(role: "INPUT" | "THROAT" | "OUTPUT"): number {
	if (role === "INPUT") return ADVANCED_SWITCH_SEGMENT_ROLE.INPUT;
	if (role === "THROAT") return ADVANCED_SWITCH_SEGMENT_ROLE.THROAT;
	return ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT;
}

function roleName(role: number): "INPUT" | "THROAT" | "OUTPUT" {
	if (role === ADVANCED_SWITCH_SEGMENT_ROLE.INPUT) return "INPUT";
	if (role === ADVANCED_SWITCH_SEGMENT_ROLE.THROAT) return "THROAT";
	if (role === ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT) return "OUTPUT";
	throw new Error(`Physical source path has invalid advanced-switch role ${role}.`);
}

function normalizeRadians(value: number): number {
	let result = value % (Math.PI * 2);
	if (result <= -Math.PI) result += Math.PI * 2;
	if (result > Math.PI) result -= Math.PI * 2;
	return result;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}

function failure(code: PortAttachmentFailureCode, message: string): PortAttachmentFailure {
	return Object.freeze({ ok: false, code, message });
}
