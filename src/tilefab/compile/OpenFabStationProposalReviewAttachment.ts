import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	type CardinalPortRoute,
	PORT_DIRECTIONS,
	PORT_RECORD_MAX_OFFSET_MILLIMETERS,
	PORT_RECORD_MAX_STATION_MILLIMETERS,
	PORT_SIDES,
	PORT_TYPES,
	type PortSide,
	type PortType,
	portRouteIdentityError,
} from "../core/PortRecord";
import type { Direction } from "../core/railShape";
import { PATH_SOURCE_IDENTITY_KIND } from "./CompoundPhysicalPath";
import { PATH_KIND } from "./PhysicalPathCompiler";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";
import { metersToMillimeters, resolvePortAttachmentAtSourcePath } from "./PortAttachmentResolver";
import {
	OPENFAB_PORT_SLOT_POLICIES,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
} from "./PortSlotCompiler";
import {
	type PortSlotPreparedArtifacts,
	portSlotPreparedArtifactRowHasValidatedIdentity,
	portSlotPreparedArtifactsHaveExactSourceLayout,
} from "./PortSlotPreparedArtifacts";

/**
 * Exact rail attachment selected by a reviewer. Proposal metadata is intentionally absent: the
 * caller must review direction, identity, source position, and equipment grouping separately.
 */
export interface OpenFabStationProposalReviewAttachment {
	readonly portType: PortType;
	readonly route: CardinalPortRoute;
	readonly stationMillimeters: number;
	readonly side: PortSide;
	readonly lateralOffsetMillimeters: number;
}

export function openFabStationProposalReviewAttachmentFromSlot(
	layout: CompiledPhysicalLayout,
	artifacts: PortSlotPreparedArtifacts,
	availability: PortSlotAvailabilityIndex,
	portEquipment: PortEquipmentState,
	row: number,
): OpenFabStationProposalReviewAttachment {
	if (
		!portSlotPreparedArtifactsHaveExactSourceLayout(artifacts, layout) ||
		!availability.matchesLayout(layout)
	) {
		throw new Error("Port slot sources do not share the current physical-layout identity.");
	}
	const slots = artifacts.slots;
	if (!Number.isInteger(row) || row < 0 || row >= slots.count) {
		throw new RangeError(`Port slot row ${row} is outside the compiled slot buffer.`);
	}
	const attachment = canonicalAttachmentForValidatedRow(layout, artifacts, row);
	if (!availability.matchesState(portEquipment)) {
		throw new Error("Port slot availability is stale for the current port/equipment state.");
	}
	const currentAvailability = availability.statusFor(slots, row);
	if (currentAvailability.status !== PORT_SLOT_STATUS.LEGAL) {
		throw new Error(`Port slot row ${row} is not currently legal.`);
	}

	return attachment;
}

function canonicalAttachmentForValidatedRow(
	layout: CompiledPhysicalLayout,
	artifacts: PortSlotPreparedArtifacts,
	row: number,
): OpenFabStationProposalReviewAttachment {
	const slots = artifacts.slots;
	const portType = slots.portType;
	if (!PORT_TYPES.includes(portType)) {
		throw rowIntegrityError(row, "port type");
	}
	const policy = OPENFAB_PORT_SLOT_POLICIES[portType];
	const sideCount = policy.sides.length;
	const remap = layout.pathIntervalRemap;
	const sourcePathIndex = slots.sourcePathIndices[row] as number;
	if (
		sourcePathIndex < 0 ||
		sourcePathIndex >= remap.sourcePathCount ||
		(remap.sourceIdentityKinds[sourcePathIndex] as number) !==
			PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL ||
		(remap.sourcePathKinds[sourcePathIndex] as number) !== PATH_KIND.LINEAR ||
		(remap.sourcePathFromDirections[sourcePathIndex] as number) === 0 ||
		(remap.sourcePathToDirections[sourcePathIndex] as number) === 0
	) {
		throw rowIntegrityError(row, "source path");
	}
	const side = policy.sides[row % sideCount] as PortSide;
	const route: CardinalPortRoute = Object.freeze({
		kind: "CARDINAL_CELL",
		x: remap.sourcePathCells[sourcePathIndex * 2] as number,
		z: remap.sourcePathCells[sourcePathIndex * 2 + 1] as number,
		from: remap.sourcePathFromDirections[sourcePathIndex] as Direction,
		to: remap.sourcePathToDirections[sourcePathIndex] as Direction,
	});
	const stationMillimeters = metersToMillimeters(
		(remap.sourcePathCanonicalStarts[sourcePathIndex] as number) +
			(remap.sourcePathLengths[sourcePathIndex] as number) * 0.5,
	);
	const lateralOffsetMillimeters = side === "CENTER" ? 0 : policy.lateralOffsetMillimeters;

	assertExactRowValue(slots.sourcePathIndices[row] as number, sourcePathIndex, row, "source path");
	assertExactRowValue(
		slots.sourcePathOffsets[sourcePathIndex] as number,
		row - (row % sideCount),
		row,
		"source offset",
	);
	assertExactRowValue(slots.routeXs[row] as number, route.x, row, "route x");
	assertExactRowValue(slots.routeZs[row] as number, route.z, row, "route z");
	assertExactRowValue(slots.routeFromDirections[row] as number, route.from, row, "route from");
	assertExactRowValue(slots.routeToDirections[row] as number, route.to, row, "route to");
	assertExactRowValue(slots.stationMillimeters[row] as number, stationMillimeters, row, "station");
	assertExactRowValue(slots.sides[row] as number, PORT_SIDES.indexOf(side), row, "side");
	assertExactRowValue(
		slots.lateralOffsetMillimeters[row] as number,
		lateralOffsetMillimeters,
		row,
		"side offset",
	);
	assertExactRowValue(
		slots.directions[row] as number,
		PORT_DIRECTIONS.indexOf("WITH_TRAVEL"),
		row,
		"direction",
	);
	assertExactRowValue(
		slots.portTypes[row] as number,
		PORT_TYPES.indexOf(portType),
		row,
		"port type",
	);
	assertExactRowValue(slots.conflictingPortIds[row] as number, 0, row, "port conflict");
	if ((slots.statuses[row] as number) === PORT_SLOT_STATUS.LEGAL) {
		assertExactRowValue(slots.conflictingRailPathIndices[row] as number, -1, row, "rail conflict");
	}
	// Preserve the row-specific diagnostics above before the broader sealed proof checks remap and
	// final-path inputs that do not have a more useful field-level attachment error.
	if (!portSlotPreparedArtifactRowHasValidatedIdentity(artifacts, row)) {
		throw rowIntegrityError(row, "source identity or base status");
	}

	const resolution = resolvePortAttachmentAtSourcePath(
		layout,
		{
			route,
			stationMillimeters,
			side,
			lateralOffsetMillimeters,
			direction: "WITH_TRAVEL",
		},
		sourcePathIndex,
	);
	if (!resolution.ok) {
		assertExactRowValue(slots.finalPathIndices[row] as number, 0, row, "final path");
		assertZeroGeometry(slots, row);
	} else {
		assertExactRowValue(
			slots.finalPathIndices[row] as number,
			resolution.finalPathIndex,
			row,
			"final path",
		);
		assertFloat32RowValue(
			slots.railPositions[row * 2] as number,
			resolution.railXMeters,
			row,
			"rail x",
		);
		assertFloat32RowValue(
			slots.railPositions[row * 2 + 1] as number,
			resolution.railZMeters,
			row,
			"rail z",
		);
		assertFloat32RowValue(
			slots.worldPositions[row * 2] as number,
			resolution.worldXMeters,
			row,
			"world x",
		);
		assertFloat32RowValue(
			slots.worldPositions[row * 2 + 1] as number,
			resolution.worldZMeters,
			row,
			"world z",
		);
		assertFloat32RowValue(slots.tangents[row * 2] as number, resolution.tangentX, row, "tangent x");
		assertFloat32RowValue(
			slots.tangents[row * 2 + 1] as number,
			resolution.tangentZ,
			row,
			"tangent z",
		);
		assertFloat32RowValue(slots.yawRadians[row] as number, resolution.yawRadians, row, "yaw");
	}

	const routeError = portRouteIdentityError(route);
	if (routeError) throw new Error(`Port slot row ${row} has an invalid route: ${routeError}.`);
	if (
		!Number.isInteger(stationMillimeters) ||
		stationMillimeters < 0 ||
		stationMillimeters > PORT_RECORD_MAX_STATION_MILLIMETERS
	) {
		throw new Error(`Port slot row ${row} has an invalid station.`);
	}
	if (
		!Number.isInteger(lateralOffsetMillimeters) ||
		lateralOffsetMillimeters < 0 ||
		lateralOffsetMillimeters > PORT_RECORD_MAX_OFFSET_MILLIMETERS ||
		(side === "CENTER" ? lateralOffsetMillimeters !== 0 : lateralOffsetMillimeters === 0)
	) {
		throw new Error(`Port slot row ${row} has an invalid side offset.`);
	}

	return Object.freeze({
		portType,
		route,
		stationMillimeters,
		side,
		lateralOffsetMillimeters,
	});
}

function assertZeroGeometry(slots: PortSlotPreparedArtifacts["slots"], row: number): void {
	assertFloat32RowValue(slots.railPositions[row * 2] as number, 0, row, "rail x");
	assertFloat32RowValue(slots.railPositions[row * 2 + 1] as number, 0, row, "rail z");
	assertFloat32RowValue(slots.worldPositions[row * 2] as number, 0, row, "world x");
	assertFloat32RowValue(slots.worldPositions[row * 2 + 1] as number, 0, row, "world z");
	assertFloat32RowValue(slots.tangents[row * 2] as number, 0, row, "tangent x");
	assertFloat32RowValue(slots.tangents[row * 2 + 1] as number, 0, row, "tangent z");
	assertFloat32RowValue(slots.yawRadians[row] as number, 0, row, "yaw");
}

function assertFloat32RowValue(actual: number, expected: number, row: number, label: string): void {
	assertExactRowValue(actual, Math.fround(expected), row, label);
}

function assertExactRowValue(actual: number, expected: number, row: number, label: string): void {
	if (actual !== expected) throw rowIntegrityError(row, label);
}

function rowIntegrityError(row: number, label: string): Error {
	return new Error(
		`Port slot row ${row} ${label} no longer matches its validated physical layout.`,
	);
}
