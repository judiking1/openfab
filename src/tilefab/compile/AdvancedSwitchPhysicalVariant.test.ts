import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	ADVANCED_SWITCH_SHARED_TRUNK_PROFILE,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "../core/railShape";
import { TileMap } from "../core/TileMap";
import {
	ADVANCED_SWITCH_NO_PORT,
	ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE,
	ADVANCED_SWITCH_SEGMENT_ROLE,
	advancedSwitchPhysicalSegmentKey,
	collectAdvancedSwitchOwnedSourcePaths,
	compileAdvancedSwitchPhysicalVariants,
} from "./AdvancedSwitchPhysicalVariant";
import { compilePhysicalPaths } from "./PhysicalPathCompiler";

const cases = (["A", "B", "C", "D"] as const).flatMap((profileClass) =>
	ALL_DIRECTIONS.flatMap((forward) => [
		{ profileClass, forward, lateral: leftOf(forward) },
		{ profileClass, forward, lateral: oppositeDirection(leftOf(forward)) },
	]),
);

describe("advanced switch synthetic physical variants", () => {
	it.each(
		cases,
	)("builds a continuous five-segment $profileClass subgraph facing $forward/$lateral", ({
		profileClass,
		forward,
		lateral,
	}) => {
		const record = fixture(profileClass, forward, lateral);
		const map = buildSwitchMap(record);
		const variants = compileAdvancedSwitchPhysicalVariants(map);
		expect(variants).toHaveLength(1);
		const segments = variants[0]?.segments ?? [];
		expect(segments).toHaveLength(5);
		expect(new Set(segments.map((segment) => segment.packedIdentity)).size).toBe(5);

		const inputs = segments.filter(
			(segment) => segment.identity.role === ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
		);
		const throat = segments.find(
			(segment) => segment.identity.role === ADVANCED_SWITCH_SEGMENT_ROLE.THROAT,
		);
		const outputs = segments.filter(
			(segment) => segment.identity.role === ADVANCED_SWITCH_SEGMENT_ROLE.OUTPUT,
		);
		expect(inputs).toHaveLength(2);
		expect(outputs).toHaveLength(2);
		expect(throat?.identity.portIndex).toBe(ADVANCED_SWITCH_NO_PORT);
		expect(throat?.geometry.length).toBeCloseTo(
			ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.clearTrunkMeters,
			6,
		);
		expect(segments.map((segment) => segment.catalogProfileCode)).toEqual([
			ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_LINEAR,
			profileClass === "A" || profileClass === "B"
				? ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_S
				: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.INPUT_RIGHT,
			ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.THROAT,
			ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_LINEAR,
			profileClass === "B" || profileClass === "D"
				? ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_S
				: ADVANCED_SWITCH_PHYSICAL_PROFILE_CODE.OUTPUT_RIGHT,
		]);
		for (const input of inputs) {
			expect(input.geometry.length).toBeGreaterThan(
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.mergeSharedLeadMeters,
			);
			expectEndpoint(input.geometry, "end", throat?.geometry, "start");
			expect(input.successors).toEqual([throat?.packedIdentity]);
			expectCatalogGeometry(input);
		}
		for (const output of outputs) {
			expect(output.geometry.length).toBeGreaterThan(
				ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.branchSharedLeadMeters,
			);
			expectEndpoint(throat?.geometry, "end", output.geometry, "start");
			expect(output.successors).toEqual([]);
			expectCatalogGeometry(output);
		}
		expect(throat?.successors).toEqual(outputs.map((segment) => segment.packedIdentity));
		const authoredGeometry = deriveAdvancedSwitchGeometry(record);
		const inputSweep = moveCell(
			moveCell(authoredGeometry.mergeAnchor, oppositeDirection(forward)),
			lateral,
		);
		const outputSweep = moveCell(moveCell(authoredGeometry.branchAnchor, forward), lateral);
		expect(hasCoverage(inputs[1], inputSweep)).toBe(profileClass === "A" || profileClass === "B");
		expect(hasCoverage(outputs[1], outputSweep)).toBe(profileClass === "B" || profileClass === "D");

		const raw = compilePhysicalPaths(map);
		const suppressed = collectAdvancedSwitchOwnedSourcePaths(variants, raw);
		const ownedKeys = new Set(
			deriveAdvancedSwitchGeometry(record).occupiedCells.map((cell) => `${cell.x}:${cell.y}`),
		);
		const expected = Array.from({ length: raw.pathCount }, (_, pathIndex) => pathIndex).filter(
			(pathIndex) =>
				ownedKeys.has(
					`${raw.cells[pathIndex * 2] as number}:${raw.cells[pathIndex * 2 + 1] as number}`,
				),
		);
		expect([...suppressed]).toEqual(expected);
	});

	it("packs profile class into the stable identity without collisions", () => {
		const keys = (["A", "B", "C", "D"] as const).map((profileClass) =>
			advancedSwitchPhysicalSegmentKey({
				switchId: 0x7fff_ffff,
				profileClass,
				role: ADVANCED_SWITCH_SEGMENT_ROLE.INPUT,
				portIndex: 0,
				segmentOrdinal: 0xffff,
			}),
		);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

function fixture(
	profileClass: AdvancedSwitchProfileClass,
	forward: Direction,
	lateral: Direction,
): AdvancedSwitchRecord {
	return {
		id: 17,
		profileClass,
		origin: { x: 11, y: -7 },
		forward,
		lateral,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
}

function buildSwitchMap(record: AdvancedSwitchRecord): TileMap {
	const map = new TileMap();
	for (const cell of deriveAdvancedSwitchGeometry(record).cellStates) {
		map.setEncoded(cell.x, cell.y, cell.encoded);
	}
	map.setAdvancedSwitch(record);
	return map;
}

function expectEndpoint(
	left: { positions: ArrayLike<number>; tangents: ArrayLike<number> } | undefined,
	leftEnd: "start" | "end",
	right: { positions: ArrayLike<number>; tangents: ArrayLike<number> } | undefined,
	rightEnd: "start" | "end",
): void {
	if (!left || !right) throw new Error("missing segment geometry");
	const leftPoint = leftEnd === "start" ? 0 : left.positions.length - 2;
	const rightPoint = rightEnd === "start" ? 0 : right.positions.length - 2;
	expect(left.positions[leftPoint]).toBeCloseTo(right.positions[rightPoint] as number, 6);
	expect(left.positions[leftPoint + 1]).toBeCloseTo(right.positions[rightPoint + 1] as number, 6);
	expect(left.tangents[leftPoint]).toBeCloseTo(right.tangents[rightPoint] as number, 6);
	expect(left.tangents[leftPoint + 1]).toBeCloseTo(right.tangents[rightPoint + 1] as number, 6);
}

function expectCatalogGeometry(
	segment: NonNullable<
		ReturnType<typeof compileAdvancedSwitchPhysicalVariants>[number]["segments"][number]
	>,
): void {
	const geometry = segment.geometry;
	const compound = segment.compoundGeometry;
	if (!compound) {
		expect(segment.catalogProfileId).toContain("LINEAR");
		return;
	}
	expect(["MAP_EXACT", "GRID_FIT"]).toContain(compound.fitKind);
	expect(compound.fitReasonMask === 0).toBe(compound.fitKind === "MAP_EXACT");
	expect(compound.nominalProfileIndex).toBeGreaterThanOrEqual(0);
	let integratedTurn = 0;
	for (let pointIndex = 1; pointIndex < geometry.distances.length; pointIndex++) {
		const previous = (pointIndex - 1) * 2;
		const current = pointIndex * 2;
		const cross =
			(geometry.tangents[previous] as number) * (geometry.tangents[current + 1] as number) -
			(geometry.tangents[previous + 1] as number) * (geometry.tangents[current] as number);
		const dot =
			(geometry.tangents[previous] as number) * (geometry.tangents[current] as number) +
			(geometry.tangents[previous + 1] as number) * (geometry.tangents[current + 1] as number);
		const angle = Math.abs(Math.atan2(cross, dot));
		if (angle < 1e-7) continue;
		const distance =
			(geometry.distances[pointIndex] as number) - (geometry.distances[pointIndex - 1] as number);
		expect(distance / angle).toBeCloseTo(compound.radiusMillimeters / 1_000, 5);
		integratedTurn += angle;
	}
	expect(integratedTurn).toBeCloseTo(
		((compound.type === "S_CURVE" ? 2 : 1) * compound.turnAngleTenths * Math.PI) / 1_800,
		5,
	);
}

function hasCoverage(
	segment: ReturnType<typeof compileAdvancedSwitchPhysicalVariants>[number]["segments"][number],
	cell: { x: number; y: number },
): boolean {
	return segment.coverage.some((covered) => covered.x === cell.x && covered.y === cell.y);
}

function leftOf(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_W;
	if (direction === DIR_E) return DIR_N;
	if (direction === DIR_S) return DIR_E;
	return DIR_S;
}
