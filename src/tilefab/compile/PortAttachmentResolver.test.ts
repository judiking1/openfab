import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import type { PortRecord, PortRouteIdentity } from "../core/PortRecord";
import { planRailPath } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, type Direction, moveCell, oppositeDirection } from "../core/railShape";
import type { Cell } from "../core/TileMap";
import {
	ADVANCED_SWITCH_NO_PORT,
	ADVANCED_SWITCH_SEGMENT_ROLE,
} from "./AdvancedSwitchPhysicalVariant";
import {
	NO_PATH_INTERVAL_TARGET,
	PATH_INTERVAL_MAPPING_KIND,
	PATH_SOURCE_IDENTITY_KIND,
} from "./CompoundPhysicalPath";
import { type CompiledPhysicalLayout, compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	createPortAttachmentSourceIndex,
	metersToMillimeters,
	PORT_ATTACHMENT_FAILURE,
	type PortAttachmentSourceIndex,
	resolvePortAttachment,
	resolvePortAttachmentWithSourceIndex,
} from "./PortAttachmentResolver";

describe("PortAttachmentResolver", () => {
	it("resolves canonical millimeters through the raw-to-final remap and applies rail-normal side", () => {
		const layout = straightLayout();
		const sourcePathIndex = cardinalSourceAt(layout, 2, 0);
		const route = routeFromSource(layout, sourcePathIndex);
		const stationMillimeters = sourceMidpointMillimeters(layout, sourcePathIndex);
		const center = resolvePortAttachment(
			layout,
			portAttachment(route, stationMillimeters, "CENTER", 0, "WITH_TRAVEL"),
		);
		const left = resolvePortAttachment(
			layout,
			portAttachment(route, stationMillimeters, "LEFT", 1_000, "WITH_TRAVEL"),
		);

		expect(center.ok).toBe(true);
		expect(left.ok).toBe(true);
		if (!center.ok || !left.ok) return;
		expect(left.sourcePathIndex).toBe(sourcePathIndex);
		expect(left.finalPathIndex).toBe(center.finalPathIndex);
		expect(
			Math.hypot(left.worldXMeters - center.worldXMeters, left.worldZMeters - center.worldZMeters),
		).toBeCloseTo(1, 5);
		expect(left.canonicalStationMillimeters).toBe(stationMillimeters);
	});

	it("derives opposite-facing yaw without reversing the directed rail attachment", () => {
		const layout = straightLayout();
		const sourcePathIndex = cardinalSourceAt(layout, 2, 0);
		const route = routeFromSource(layout, sourcePathIndex);
		const station = sourceMidpointMillimeters(layout, sourcePathIndex);
		const withTravel = resolvePortAttachment(
			layout,
			portAttachment(route, station, "CENTER", 0, "WITH_TRAVEL"),
		);
		const againstTravel = resolvePortAttachment(
			layout,
			portAttachment(route, station, "CENTER", 0, "AGAINST_TRAVEL"),
		);

		expect(withTravel.ok).toBe(true);
		expect(againstTravel.ok).toBe(true);
		if (!withTravel.ok || !againstTravel.ok) return;
		const yawDelta = Math.abs(withTravel.yawRadians - againstTravel.yawRadians);
		expect(Math.abs(yawDelta - Math.PI) < 1e-8 || Math.abs(yawDelta - Math.PI * 2) < 1e-8).toBe(
			true,
		);
		expect(againstTravel.finalPathIndex).toBe(withTravel.finalPathIndex);
	});

	it("rejects missing routes, stations outside their canonical interval, and unmappable support", () => {
		const layout = straightLayout();
		const sourcePathIndex = cardinalSourceAt(layout, 2, 0);
		const route = routeFromSource(layout, sourcePathIndex);
		const station = sourceMidpointMillimeters(layout, sourcePathIndex);

		const missing = resolvePortAttachment(
			layout,
			portAttachment({ ...route, x: 999_999 }, station, "CENTER", 0, "WITH_TRAVEL"),
		);
		expect(missing).toMatchObject({ ok: false, code: PORT_ATTACHMENT_FAILURE.SOURCE_NOT_FOUND });

		const outside = resolvePortAttachment(
			layout,
			portAttachment(route, station + 10_000, "CENTER", 0, "WITH_TRAVEL"),
		);
		expect(outside).toMatchObject({
			ok: false,
			code: PORT_ATTACHMENT_FAILURE.STATION_OUT_OF_RANGE,
		});

		const unmappableLayout = makeSourceUnmappable(layout, sourcePathIndex);
		const unmappable = resolvePortAttachment(
			unmappableLayout,
			portAttachment(route, station, "CENTER", 0, "WITH_TRAVEL"),
		);
		expect(unmappable).toMatchObject({
			ok: false,
			code: PORT_ATTACHMENT_FAILURE.UNMAPPABLE_INTERVAL,
		});
	});

	it("resolves the exact stable identity of a synthetic advanced-switch segment", () => {
		const layout = advancedSwitchLayout();
		const remap = layout.pathIntervalRemap;
		const sourcePathIndex = Array.from({ length: remap.sourcePathCount }, (_, index) => index).find(
			(index) =>
				(remap.sourceIdentityKinds[index] as number) ===
				PATH_SOURCE_IDENTITY_KIND.ADVANCED_SWITCH_SEGMENT,
		);
		expect(sourcePathIndex).toBeDefined();
		if (sourcePathIndex === undefined) return;
		const route = advancedRouteFromSource(layout, sourcePathIndex);
		const station = sourceMidpointMillimeters(layout, sourcePathIndex);
		const resolved = resolvePortAttachment(
			layout,
			portAttachment(route, station, "CENTER", 0, "WITH_TRAVEL"),
		);

		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.sourcePathIndex).toBe(sourcePathIndex);
		expect(Number.isFinite(resolved.worldXMeters)).toBe(true);
		expect(Number.isFinite(resolved.yawRadians)).toBe(true);
	});

	it("reuses one immutable route index without changing resolution or ambiguity diagnostics", () => {
		const layout = straightLayout();
		const sourcePathIndex = cardinalSourceAt(layout, 2, 0);
		const route = routeFromSource(layout, sourcePathIndex);
		const port = portAttachment(
			route,
			sourceMidpointMillimeters(layout, sourcePathIndex),
			"LEFT",
			1_000,
			"WITH_TRAVEL",
		);
		const index = createPortAttachmentSourceIndex(layout);

		expect(resolvePortAttachmentWithSourceIndex(layout, port, index)).toEqual(
			resolvePortAttachment(layout, port),
		);
		expect(
			resolvePortAttachmentWithSourceIndex(layout, port, {
				sourcePathCount: index.sourcePathCount,
				sourceRemap: index.sourceRemap,
				rows: () => null,
			}),
		).toMatchObject({ ok: false, code: PORT_ATTACHMENT_FAILURE.SOURCE_NOT_FOUND });
		const ambiguousIndex: PortAttachmentSourceIndex = {
			sourcePathCount: index.sourcePathCount,
			sourceRemap: index.sourceRemap,
			rows: () => Int32Array.of(sourcePathIndex, sourcePathIndex),
		};
		expect(resolvePortAttachmentWithSourceIndex(layout, port, ambiguousIndex)).toMatchObject({
			ok: false,
			code: PORT_ATTACHMENT_FAILURE.SOURCE_AMBIGUOUS,
		});
		expect(
			resolvePortAttachmentWithSourceIndex(layout, port, {
				sourcePathCount: index.sourcePathCount + 1,
				sourceRemap: index.sourceRemap,
				rows: index.rows,
			}),
		).toMatchObject({ ok: false, code: PORT_ATTACHMENT_FAILURE.SOURCE_NOT_FOUND });
		const foreignIndex = createPortAttachmentSourceIndex(straightLayout());
		expect(resolvePortAttachmentWithSourceIndex(layout, port, foreignIndex)).toMatchObject({
			ok: false,
			code: PORT_ATTACHMENT_FAILURE.SOURCE_NOT_FOUND,
		});
	});
});

function straightLayout(): CompiledPhysicalLayout {
	const document = new RailDocument();
	const cells = Array.from({ length: 5 }, (_, x) => ({ x, y: 0 }));
	const plan = planRailPath(document.map, cells);
	if (!plan.valid || !document.commit(plan))
		throw new Error(`straight fixture failed: ${plan.reason}`);
	return compilePhysicalRail(document.map);
}

function advancedSwitchLayout(): CompiledPhysicalLayout {
	const document = documentWithTerminal(DIR_E);
	const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
	if (!plan.valid || !document.commit(plan))
		throw new Error(`switch fixture failed: ${plan.reason}`);
	return compilePhysicalRail(document.map);
}

function documentWithTerminal(forward: Direction): RailDocument {
	const document = new RailDocument();
	const cells: Cell[] = [];
	let current = { x: 0, y: 0 };
	for (let distance = 0; distance < 4; distance++) {
		cells.unshift(current);
		current = moveCell(current, oppositeDirection(forward));
	}
	const plan = planRailPath(document.map, cells);
	if (!plan.valid || !document.commit(plan))
		throw new Error(`terminal fixture failed: ${plan.reason}`);
	return document;
}

function cardinalSourceAt(layout: CompiledPhysicalLayout, x: number, z: number): number {
	const remap = layout.pathIntervalRemap;
	for (let index = 0; index < remap.sourcePathCount; index++) {
		if (
			(remap.sourceIdentityKinds[index] as number) === PATH_SOURCE_IDENTITY_KIND.CARDINAL_CELL &&
			(remap.sourcePathCells[index * 2] as number) === x &&
			(remap.sourcePathCells[index * 2 + 1] as number) === z
		) {
			return index;
		}
	}
	throw new Error(`missing cardinal source ${x},${z}`);
}

function routeFromSource(
	layout: CompiledPhysicalLayout,
	index: number,
): PortRouteIdentity & { kind: "CARDINAL_CELL" } {
	const remap = layout.pathIntervalRemap;
	return {
		kind: "CARDINAL_CELL",
		x: remap.sourcePathCells[index * 2] as number,
		z: remap.sourcePathCells[index * 2 + 1] as number,
		from: remap.sourcePathFromDirections[index] as 0 | Direction,
		to: remap.sourcePathToDirections[index] as 0 | Direction,
	};
}

function advancedRouteFromSource(
	layout: CompiledPhysicalLayout,
	index: number,
): PortRouteIdentity & { kind: "ADVANCED_SWITCH_SEGMENT" } {
	const remap = layout.pathIntervalRemap;
	const profileCode = remap.sourceAdvancedSwitchProfileClasses[index] as number;
	const profileClass = (["A", "B", "C", "D"] as const)[profileCode];
	if (!profileClass) throw new Error(`invalid profile code ${profileCode}`);
	const roleCode = remap.sourceAdvancedSwitchRoles[index] as number;
	const role =
		roleCode === ADVANCED_SWITCH_SEGMENT_ROLE.INPUT
			? "INPUT"
			: roleCode === ADVANCED_SWITCH_SEGMENT_ROLE.THROAT
				? "THROAT"
				: "OUTPUT";
	const rawPort = remap.sourceAdvancedSwitchPorts[index] as number;
	return {
		kind: "ADVANCED_SWITCH_SEGMENT",
		switchId: remap.sourceAdvancedSwitchIds[index] as number,
		profileClass,
		role,
		portIndex: rawPort === ADVANCED_SWITCH_NO_PORT ? null : (rawPort as 0 | 1),
		segmentOrdinal: remap.sourceAdvancedSwitchSegmentOrdinals[index] as number,
	};
}

function sourceMidpointMillimeters(layout: CompiledPhysicalLayout, index: number): number {
	const remap = layout.pathIntervalRemap;
	return metersToMillimeters(
		(remap.sourcePathCanonicalStarts[index] as number) +
			(remap.sourcePathLengths[index] as number) * 0.5,
	);
}

function portAttachment(
	route: PortRouteIdentity,
	stationMillimeters: number,
	side: PortRecord["side"],
	lateralOffsetMillimeters: number,
	direction: PortRecord["direction"],
): Pick<
	PortRecord,
	"route" | "stationMillimeters" | "side" | "lateralOffsetMillimeters" | "direction"
> {
	return { route, stationMillimeters, side, lateralOffsetMillimeters, direction };
}

function makeSourceUnmappable(
	layout: CompiledPhysicalLayout,
	sourcePathIndex: number,
): CompiledPhysicalLayout {
	const remap = layout.pathIntervalRemap;
	const mappingKinds = remap.mappingKinds.slice();
	const targetPathIndices = remap.targetPathIndices.slice();
	const start = remap.sourcePathOffsets[sourcePathIndex] as number;
	const end = remap.sourcePathOffsets[sourcePathIndex + 1] as number;
	for (let row = start; row < end; row++) {
		mappingKinds[row] = PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE;
		targetPathIndices[row] = NO_PATH_INTERVAL_TARGET;
	}
	return {
		...layout,
		pathIntervalRemap: { ...remap, mappingKinds, targetPathIndices },
	};
}
