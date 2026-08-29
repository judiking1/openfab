import type { AdvancedSwitchPortIndex, AdvancedSwitchProfileClass } from "./AdvancedSwitch";
import { ADVANCED_SWITCH_PROFILE_CLASSES } from "./AdvancedSwitch";
import { ALL_DIRECTIONS, type Direction } from "./railShape";

export const PORT_RECORD_MAX_ID = 0x7fff_ffff;
export const PORT_RECORD_MAX_OFFSET_MILLIMETERS = 100_000;
/** Serialization safety bound. Exact support-path bounds are enforced by compiled validation. */
export const PORT_RECORD_MAX_STATION_MILLIMETERS = 100_000;
export const PORT_RECORD_MAX_BARCODE_LENGTH = 128;
export const OPENFAB_MINIMUM_PORT_SPACING_MILLIMETERS = 600;

export const PORT_SIDES = ["CENTER", "LEFT", "RIGHT"] as const;
export type PortSide = (typeof PORT_SIDES)[number];

export const PORT_DIRECTIONS = ["WITH_TRAVEL", "AGAINST_TRAVEL"] as const;
export type PortDirection = (typeof PORT_DIRECTIONS)[number];

export const PORT_TYPES = ["OHB", "EQ", "STK"] as const;
export type PortType = (typeof PORT_TYPES)[number];

export const ADVANCED_SWITCH_ROUTE_ROLES = ["INPUT", "THROAT", "OUTPUT"] as const;
export type AdvancedSwitchRouteRole = (typeof ADVANCED_SWITCH_ROUTE_ROLES)[number];

export interface CardinalPortRoute {
	readonly kind: "CARDINAL_CELL";
	readonly x: number;
	readonly z: number;
	readonly from: 0 | Direction;
	readonly to: 0 | Direction;
}

export interface AdvancedSwitchPortRoute {
	readonly kind: "ADVANCED_SWITCH_SEGMENT";
	readonly switchId: number;
	readonly profileClass: AdvancedSwitchProfileClass;
	readonly role: AdvancedSwitchRouteRole;
	readonly portIndex: AdvancedSwitchPortIndex | null;
	readonly segmentOrdinal: number;
}

/** Ordering-independent identity of the authored raw route that owns a station. */
export type PortRouteIdentity = CardinalPortRoute | AdvancedSwitchPortRoute;

export interface PortRecord {
	readonly id: number;
	readonly equipmentGroupId: number;
	readonly route: PortRouteIdentity;
	/** Canonical physical station along the route family, stored as an exact integer millimeter. */
	readonly stationMillimeters: number;
	readonly side: PortSide;
	/** Unsigned rail-normal offset. LEFT/RIGHT supplies the sign; CENTER requires zero. */
	readonly lateralOffsetMillimeters: number;
	readonly direction: PortDirection;
	readonly portType: PortType;
	readonly barcode: string | null;
}

export interface PortMutation {
	readonly id: number;
	readonly before: PortRecord | null;
	readonly after: PortRecord | null;
}

export function portRecordError(record: PortRecord): string | null {
	if (!isPositiveRecordId(record.id)) return "port id must be a positive signed int32";
	if (!isPositiveRecordId(record.equipmentGroupId)) {
		return "port equipment group id must be a positive signed int32";
	}
	const routeError = portRouteIdentityError(record.route);
	if (routeError) return routeError;
	if (
		!Number.isInteger(record.stationMillimeters) ||
		record.stationMillimeters < 0 ||
		record.stationMillimeters > PORT_RECORD_MAX_STATION_MILLIMETERS
	) {
		return `port station must be an integer from 0 to ${PORT_RECORD_MAX_STATION_MILLIMETERS} millimeters`;
	}
	if (!PORT_SIDES.includes(record.side)) return "port side is invalid";
	if (
		!Number.isInteger(record.lateralOffsetMillimeters) ||
		record.lateralOffsetMillimeters < 0 ||
		record.lateralOffsetMillimeters > PORT_RECORD_MAX_OFFSET_MILLIMETERS
	) {
		return "port lateral offset must be an integer from 0 to 100000 millimeters";
	}
	if (
		(record.side === "CENTER" && record.lateralOffsetMillimeters !== 0) ||
		(record.side !== "CENTER" && record.lateralOffsetMillimeters === 0)
	) {
		return "center ports require zero offset and sided ports require a positive offset";
	}
	if (!PORT_DIRECTIONS.includes(record.direction)) return "port direction is invalid";
	if (!PORT_TYPES.includes(record.portType)) return "port type is invalid";
	if (
		record.barcode !== null &&
		!validPortableLabel(record.barcode, PORT_RECORD_MAX_BARCODE_LENGTH)
	) {
		return "port barcode must be a trimmed portable label up to 128 characters";
	}
	return null;
}

export function portRouteIdentityError(route: PortRouteIdentity): string | null {
	if (route.kind === "CARDINAL_CELL") {
		if (!isInt32(route.x) || !isInt32(route.z)) {
			return "cardinal port route coordinates must be signed int32 values";
		}
		if (!isRouteEnd(route.from) || !isRouteEnd(route.to)) {
			return "cardinal port route ends must be zero or cardinal directions";
		}
		if ((route.from === 0 && route.to === 0) || route.from === route.to) {
			return "cardinal port route must identify one directed non-degenerate route";
		}
		return null;
	}
	if (!isPositiveRecordId(route.switchId)) {
		return "advanced-switch port route id must be a positive signed int32";
	}
	if (!ADVANCED_SWITCH_PROFILE_CLASSES.includes(route.profileClass)) {
		return "advanced-switch port route profile class is invalid";
	}
	if (!ADVANCED_SWITCH_ROUTE_ROLES.includes(route.role)) {
		return "advanced-switch port route role is invalid";
	}
	if (
		(route.role === "THROAT" && route.portIndex !== null) ||
		(route.role !== "THROAT" && route.portIndex !== 0 && route.portIndex !== 1)
	) {
		return "only an advanced-switch throat route may omit its port index";
	}
	if (
		!Number.isInteger(route.segmentOrdinal) ||
		route.segmentOrdinal < 0 ||
		route.segmentOrdinal > 0xffff
	) {
		return "advanced-switch segment ordinal must fit uint16";
	}
	return null;
}

export function copyPortRecord(record: PortRecord): PortRecord {
	const route = copyPortRouteIdentity(record.route);
	const copy = {
		id: record.id,
		equipmentGroupId: record.equipmentGroupId,
		route,
		stationMillimeters: record.stationMillimeters,
		side: record.side,
		lateralOffsetMillimeters: record.lateralOffsetMillimeters,
		direction: record.direction,
		portType: record.portType,
		barcode: record.barcode,
	} satisfies PortRecord;
	const error = portRecordError(copy);
	if (error) throw new TypeError(error);
	return Object.freeze(copy);
}

export function copyPortRouteIdentity(route: PortRouteIdentity): PortRouteIdentity {
	const copy: PortRouteIdentity =
		route.kind === "CARDINAL_CELL"
			? {
					kind: "CARDINAL_CELL",
					x: route.x,
					z: route.z,
					from: route.from,
					to: route.to,
				}
			: {
					kind: "ADVANCED_SWITCH_SEGMENT",
					switchId: route.switchId,
					profileClass: route.profileClass,
					role: route.role,
					portIndex: route.portIndex,
					segmentOrdinal: route.segmentOrdinal,
				};
	const error = portRouteIdentityError(copy);
	if (error) throw new TypeError(error);
	return Object.freeze(copy);
}

export function portRouteIdentityEquals(
	left: PortRouteIdentity,
	right: PortRouteIdentity,
): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind === "CARDINAL_CELL" && right.kind === "CARDINAL_CELL") {
		return (
			left.x === right.x && left.z === right.z && left.from === right.from && left.to === right.to
		);
	}
	if (left.kind === "ADVANCED_SWITCH_SEGMENT" && right.kind === "ADVANCED_SWITCH_SEGMENT") {
		return (
			left.switchId === right.switchId &&
			left.profileClass === right.profileClass &&
			left.role === right.role &&
			left.portIndex === right.portIndex &&
			left.segmentOrdinal === right.segmentOrdinal
		);
	}
	return false;
}

export function portRecordEquals(
	left: PortRecord | null | undefined,
	right: PortRecord | null | undefined,
): boolean {
	if (!left || !right) return left == null && right == null;
	return (
		left.id === right.id &&
		left.equipmentGroupId === right.equipmentGroupId &&
		portRouteIdentityEquals(left.route, right.route) &&
		left.stationMillimeters === right.stationMillimeters &&
		left.side === right.side &&
		left.lateralOffsetMillimeters === right.lateralOffsetMillimeters &&
		left.direction === right.direction &&
		left.portType === right.portType &&
		left.barcode === right.barcode
	);
}

export function portRouteIdentityKey(route: PortRouteIdentity): string {
	if (route.kind === "CARDINAL_CELL") {
		return `C:${route.x}:${route.z}:${route.from}:${route.to}`;
	}
	return `A:${route.switchId}:${route.profileClass}:${route.role}:${route.portIndex ?? "-"}:${route.segmentOrdinal}`;
}

export function isPositiveRecordId(value: number): boolean {
	return Number.isInteger(value) && value > 0 && value <= PORT_RECORD_MAX_ID;
}

function isRouteEnd(value: number): value is 0 | Direction {
	return value === 0 || ALL_DIRECTIONS.includes(value as Direction);
}

function isInt32(value: number): boolean {
	return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}

function validPortableLabel(value: string, maximumLength: number): boolean {
	if (value.length === 0 || value.length > maximumLength || value !== value.trim()) {
		return false;
	}
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) {
			return false;
		}
	}
	return true;
}
