import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { DIR_E, DIR_S } from "../core/railShape";
import { TileMap } from "../core/TileMap";
import {
	type CompiledPhysicalPaths,
	NO_ADVANCED_SWITCH_CATALOG_PROFILE,
	NO_ADVANCED_SWITCH_PROFILE_CLASS,
	NO_ADVANCED_SWITCH_SEGMENT_ORDINAL,
	NO_ADVANCED_SWITCH_SEGMENT_PORT,
	NO_ADVANCED_SWITCH_SEGMENT_ROLE,
	PATH_KIND,
	PHYSICAL_PATH_SOURCE_KIND,
} from "./PhysicalPathCompiler";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	classifyRailClearanceRelationship,
	closestLineSegments,
	compileRailClearance,
	createRailClearanceRelationshipContext,
	RAIL_CLEARANCE_ISSUE_CODE,
	RAIL_CLEARANCE_PATH_IDENTITY_WIDTH,
	RAIL_CLEARANCE_RELATION,
	type RailClearanceSwitchOwnership,
	type RailClearanceTurnoutOwnership,
	railClearanceIssueMessage,
} from "./RailClearanceValidator";

type Line = readonly [number, number, number, number];

interface LinePathOptions {
	readonly adjacency?: readonly (readonly [number, number])[];
	readonly advancedSwitchIds?: readonly number[];
	readonly shared?: Readonly<Record<number, readonly SharedRow[]>>;
}

interface SharedRow {
	readonly id: number;
	readonly start: number;
	readonly end: number;
}

const EMPTY_TURNOUT_OWNERSHIP: RailClearanceTurnoutOwnership = {
	count: 0,
	clearancePathOffsets: new Uint32Array([0]),
	clearancePathIndices: new Uint32Array(),
	clearancePathStarts: new Float32Array(),
	clearancePathEnds: new Float32Array(),
};

describe("RailClearanceValidator", () => {
	it("computes exact closest points for crossing, parallel, and degenerate segments", () => {
		const crossing = closestLineSegments(-1, 0, 1, 0, 0, -1, 0, 1);
		expect(crossing.distance).toBeCloseTo(0, 9);
		expect(crossing.firstAmount).toBeCloseTo(0.5, 9);
		expect(crossing.secondAmount).toBeCloseTo(0.5, 9);

		const parallel = closestLineSegments(0, 0, 2, 0, 0, 1, 2, 1);
		expect(parallel.distance).toBeCloseTo(1, 9);

		const point = closestLineSegments(0, 0, 0, 0, 1, 0, 2, 0);
		expect(point.distance).toBeCloseTo(1, 9);
	});

	it("reports one deterministic beam intrusion for unrelated orthogonal paths", () => {
		const paths = makeLinePaths([
			[-1, 0, 1, 0],
			[0, -1, 0, 1],
		]);
		const clearance = compileRailClearance(paths, EMPTY_TURNOUT_OWNERSHIP);

		expect(clearance.issues.count).toBe(1);
		expect(clearance.issues.codes[0]).toBe(RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION);
		expect(clearance.issues.relations[0]).toBe(RAIL_CLEARANCE_RELATION.UNRELATED);
		expect(clearance.issues.firstPathIndices[0]).toBe(0);
		expect(clearance.issues.secondPathIndices[0]).toBe(1);
		expect(clearance.issues.centerlineDistances[0]).toBeCloseTo(0, 6);
		expect(clearance.issues.requiredClearances[0]).toBeCloseTo(0.22, 6);
		expect(clearance.issues.penetrationDepths[0]).toBeCloseTo(0.22, 6);
		expect(clearance.issues.contactPoints).toEqual(new Float32Array([0, 0]));
	});

	it("distinguishes installation proximity from a legal one-meter parallel lane", () => {
		const near = compileRailClearance(
			makeLinePaths([
				[0, 0, 2, 0],
				[0, 0.8, 2, 0.8],
			]),
			EMPTY_TURNOUT_OWNERSHIP,
		);
		expect(near.issues.count).toBe(1);
		expect(near.issues.codes[0]).toBe(RAIL_CLEARANCE_ISSUE_CODE.INSTALLATION_CLEARANCE);
		expect(near.issues.requiredClearances[0]).toBeCloseTo(0.92, 6);

		const legal = compileRailClearance(
			makeLinePaths([
				[0, 0, 2, 0],
				[0, 1, 2, 1],
			]),
			EMPTY_TURNOUT_OWNERSHIP,
		);
		expect(legal.issues.count).toBe(0);
	});

	it("allows a directed continuation only at its shared endpoint", () => {
		const paths = makeLinePaths(
			[
				[0, 0, 1, 0],
				[1, 0, 2, 0],
			],
			{ adjacency: [[0, 1]] },
		);
		const context = createRailClearanceRelationshipContext(paths, EMPTY_TURNOUT_OWNERSHIP);

		expect(classifyRailClearanceRelationship(paths, context, 0, 1, 1, 0)).toBe(
			RAIL_CLEARANCE_RELATION.CONTINUATION,
		);
		expect(compileRailClearance(paths, EMPTY_TURNOUT_OWNERSHIP).issues.count).toBe(0);

		const foldedBack = makeLinePaths(
			[
				[0, 0, 2, 0],
				[2, 0, 0.2, 0.1],
			],
			{ adjacency: [[0, 1]] },
		);
		expect(compileRailClearance(foldedBack, EMPTY_TURNOUT_OWNERSHIP).issues.count).toBe(1);

		const disconnected = makeLinePaths(
			[
				[0, 0, 1, 0],
				[1.5, 0, 2.5, 0],
			],
			{ adjacency: [[0, 1]] },
		);
		expect(compileRailClearance(disconnected, EMPTY_TURNOUT_OWNERSHIP).issues.count).toBe(1);
	});

	it("authorizes only explicit shared, turnout, and switch-conflict ownership", () => {
		const crossingLines: Line[] = [
			[-1, 0, 1, 0],
			[0, -1, 0, 1],
		];
		const shared = makeLinePaths(crossingLines, {
			shared: {
				0: [{ id: 9, start: 0.9, end: 1.1 }],
				1: [{ id: 9, start: 0.9, end: 1.1 }],
			},
		});
		expect(compileRailClearance(shared, EMPTY_TURNOUT_OWNERSHIP).issues.count).toBe(0);
		const sharedContext = createRailClearanceRelationshipContext(shared, EMPTY_TURNOUT_OWNERSHIP);
		expect(classifyRailClearanceRelationship(shared, sharedContext, 0, 1, 1, 1)).toBe(
			RAIL_CLEARANCE_RELATION.AUTHORIZED_CONFLICT,
		);

		const turnoutOwnership: RailClearanceTurnoutOwnership = {
			count: 1,
			clearancePathOffsets: new Uint32Array([0, 2]),
			clearancePathIndices: new Uint32Array([0, 1]),
			clearancePathStarts: new Float32Array([0.9, 0.9]),
			clearancePathEnds: new Float32Array([1.1, 1.1]),
		};
		const turnoutPaths = makeLinePaths(crossingLines);
		expect(compileRailClearance(turnoutPaths, turnoutOwnership).issues.count).toBe(0);
		const turnoutContext = createRailClearanceRelationshipContext(turnoutPaths, turnoutOwnership);
		expect(classifyRailClearanceRelationship(turnoutPaths, turnoutContext, 0, 1, 1, 1)).toBe(
			RAIL_CLEARANCE_RELATION.AUTHORIZED_MODULE,
		);
		const turnoutAwayFromCrossing: RailClearanceTurnoutOwnership = {
			...turnoutOwnership,
			clearancePathStarts: new Float32Array([0, 0]),
			clearancePathEnds: new Float32Array([0.2, 0.2]),
		};
		expect(
			compileRailClearance(makeLinePaths(crossingLines), turnoutAwayFromCrossing).issues.count,
		).toBe(1);

		const advanced = makeLinePaths(crossingLines, { advancedSwitchIds: [17, 17] });
		expect(compileRailClearance(advanced, EMPTY_TURNOUT_OWNERSHIP).issues.count).toBe(1);
		const switchConflict: RailClearanceSwitchOwnership = {
			count: 1,
			movementOffsets: new Uint32Array([0, 1]),
			movementPathOffsets: new Uint32Array([0, 2]),
			movementPathIndices: new Uint32Array([0, 1]),
			movementPathStarts: new Float32Array([0.9, 0.9]),
			movementPathEnds: new Float32Array([1.1, 1.1]),
			conflictPathOffsets: new Uint32Array([0, 2]),
			conflictPathIndices: new Uint32Array([0, 1]),
			conflictPathStarts: new Float32Array([0.9, 0.9]),
			conflictPathEnds: new Float32Array([1.1, 1.1]),
		};
		expect(
			compileRailClearance(advanced, EMPTY_TURNOUT_OWNERSHIP, switchConflict).issues.count,
		).toBe(0);
		const conflictContext = createRailClearanceRelationshipContext(
			advanced,
			EMPTY_TURNOUT_OWNERSHIP,
			switchConflict,
		);
		expect(classifyRailClearanceRelationship(advanced, conflictContext, 0, 1, 1, 1)).toBe(
			RAIL_CLEARANCE_RELATION.AUTHORIZED_CONFLICT,
		);
		const moduleOnly: RailClearanceSwitchOwnership = {
			...switchConflict,
			conflictPathStarts: new Float32Array([0, 0]),
			conflictPathEnds: new Float32Array([0.2, 0.2]),
		};
		const moduleContext = createRailClearanceRelationshipContext(
			advanced,
			EMPTY_TURNOUT_OWNERSHIP,
			moduleOnly,
		);
		expect(classifyRailClearanceRelationship(advanced, moduleContext, 0, 1, 1, 1)).toBe(
			RAIL_CLEARANCE_RELATION.AUTHORIZED_MODULE,
		);
		expect(compileRailClearance(advanced, EMPTY_TURNOUT_OWNERSHIP, moduleOnly).issues.count).toBe(
			0,
		);
		const conflictAwayFromCrossing: RailClearanceSwitchOwnership = {
			...switchConflict,
			movementPathStarts: new Float32Array([0, 0]),
			movementPathEnds: new Float32Array([0.2, 0.2]),
			conflictPathStarts: new Float32Array([0, 0]),
			conflictPathEnds: new Float32Array([0.2, 0.2]),
		};
		expect(
			compileRailClearance(advanced, EMPTY_TURNOUT_OWNERSHIP, conflictAwayFromCrossing).issues
				.count,
		).toBe(1);
	});

	it("keeps distance and severity invariant under quarter-turn and negative translation", () => {
		const base = compileRailClearance(
			makeLinePaths([
				[-1, 0, 1, 0],
				[0, -1, 0, 1],
			]),
			EMPTY_TURNOUT_OWNERSHIP,
		);
		const transformed = compileRailClearance(
			makeLinePaths([
				[-8, -14, -8, -12],
				[-9, -13, -7, -13],
			]),
			EMPTY_TURNOUT_OWNERSHIP,
		);

		expect(transformed.issues.codes).toEqual(base.issues.codes);
		expect(transformed.issues.centerlineDistances).toEqual(base.issues.centerlineDistances);
		expect(transformed.issues.penetrationDepths).toEqual(base.issues.penetrationDepths);
	});

	it("retains stable identities, contact cells, and disconnected conflict regions", () => {
		const polylines = [
			[
				[-3, 0],
				[3, 0],
			],
			[
				[-2, -2],
				[-2, 1],
				[2, 1],
				[2, -2],
			],
		] as const;
		const forward = compileRailClearance(makePolylinePaths(polylines), EMPTY_TURNOUT_OWNERSHIP);
		const reversed = compileRailClearance(
			makePolylinePaths([polylines[1], polylines[0]]),
			EMPTY_TURNOUT_OWNERSHIP,
		);

		expect(forward.issues.count).toBe(2);
		expect([...forward.issues.cells]).toEqual([-2, 0, -2, 0, 2, 0, 2, 0]);
		expect(stableIssueIdentities(forward.issues)).toEqual(stableIssueIdentities(reversed.issues));
		for (const code of Object.values(RAIL_CLEARANCE_ISSUE_CODE)) {
			expect(railClearanceIssueMessage(code)).toMatch(/unrelated rail path/);
		}
	});

	it("accepts the exact dual-S advanced-switch physical graph without self-conflicts", () => {
		const record: AdvancedSwitchRecord = {
			id: 17,
			profileClass: "B",
			origin: { x: -12, y: -9 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		};
		const map = new TileMap();
		for (const cell of deriveAdvancedSwitchGeometry(record).cellStates) {
			map.setEncoded(cell.x, cell.y, cell.encoded);
		}
		map.setAdvancedSwitch(record);
		const layout = compilePhysicalRail(map);
		const clearance = compileRailClearance(
			layout.paths,
			layout.turnoutFootprints,
			layout.advancedSwitches,
		);

		expect(clearance.envelopes.count).toBeGreaterThan(layout.paths.pathCount);
		expect(clearance.issues.count).toBe(0);
	});
});

function makeLinePaths(
	lines: readonly Line[],
	options: LinePathOptions = {},
): CompiledPhysicalPaths {
	const pathCount = lines.length;
	const positions = new Float32Array(pathCount * 4);
	const tangents = new Float32Array(pathCount * 4);
	const distances = new Float32Array(pathCount * 2);
	const offsets = new Uint32Array(pathCount + 1);
	const lengths = new Float32Array(pathCount);
	const bounds = new Float32Array(pathCount * 4);
	const cells = new Int32Array(pathCount * 2);
	const exitCells = new Int32Array(pathCount * 2);
	const coverageOffsets = new Uint32Array(pathCount + 1);
	const coverageCells = new Int32Array(pathCount * 2);
	for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
		const [x0, y0, x1, y1] = lines[pathIndex] as Line;
		const dx = x1 - x0;
		const dy = y1 - y0;
		const length = Math.hypot(dx, dy);
		positions.set([x0, y0, x1, y1], pathIndex * 4);
		tangents.set([dx / length, dy / length, dx / length, dy / length], pathIndex * 4);
		distances.set([0, length], pathIndex * 2);
		offsets[pathIndex] = pathIndex * 2;
		lengths[pathIndex] = length;
		bounds.set(
			[Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
			pathIndex * 4,
		);
		cells.set([Math.floor(x0), Math.floor(y0)], pathIndex * 2);
		exitCells.set([Math.floor(x1), Math.floor(y1)], pathIndex * 2);
		coverageOffsets[pathIndex] = pathIndex;
		coverageCells.set([Math.floor(x0), Math.floor(y0)], pathIndex * 2);
	}
	offsets[pathCount] = pathCount * 2;
	coverageOffsets[pathCount] = pathCount;

	const sharedSegmentOffsets = new Uint32Array(pathCount + 1);
	const sharedIds: number[] = [];
	const sharedStarts: number[] = [];
	const sharedEnds: number[] = [];
	const sharedUsage = new Map<number, { count: number; length: number }>();
	for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
		sharedSegmentOffsets[pathIndex] = sharedIds.length;
		for (const shared of options.shared?.[pathIndex] ?? []) {
			sharedIds.push(shared.id);
			sharedStarts.push(shared.start);
			sharedEnds.push(shared.end);
			const previous = sharedUsage.get(shared.id);
			sharedUsage.set(shared.id, {
				count: (previous?.count ?? 0) + 1,
				length: Math.max(previous?.length ?? 0, shared.end - shared.start),
			});
		}
	}
	sharedSegmentOffsets[pathCount] = sharedIds.length;

	const adjacencyRows = Array.from({ length: pathCount }, () => [] as number[]);
	for (const [from, to] of options.adjacency ?? []) adjacencyRows[from]?.push(to);
	const explicitAdjacencyOffsets = new Uint32Array(pathCount + 1);
	const adjacencyTargets: number[] = [];
	for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
		explicitAdjacencyOffsets[pathIndex] = adjacencyTargets.length;
		adjacencyTargets.push(...(adjacencyRows[pathIndex] as number[]));
	}
	explicitAdjacencyOffsets[pathCount] = adjacencyTargets.length;

	let duplicatedLengthMeters = 0;
	for (const shared of sharedUsage.values()) {
		duplicatedLengthMeters += shared.length * Math.max(0, shared.count - 1);
	}
	const totalRouteLengthMeters = [...lengths].reduce((sum, length) => sum + length, 0);
	const advancedSwitchIds = options.advancedSwitchIds
		? new Uint32Array(options.advancedSwitchIds)
		: new Uint32Array(pathCount);
	return {
		revision: 0,
		positions,
		tangents,
		distances,
		offsets,
		kinds: new Uint8Array(Array(pathCount).fill(PATH_KIND.LINEAR)),
		cells,
		exitCells,
		fromDirections: new Uint8Array(pathCount),
		toDirections: new Uint8Array(pathCount),
		lengths,
		bounds,
		startInsets: new Float32Array(pathCount),
		endInsets: new Float32Array(pathCount),
		startExtensions: new Float32Array(pathCount),
		endExtensions: new Float32Array(pathCount),
		coverageOffsets,
		coverageCells,
		sharedSegmentOffsets,
		sharedSegmentIds: new Uint32Array(sharedIds),
		sharedSegmentStarts: new Float32Array(sharedStarts),
		sharedSegmentEnds: new Float32Array(sharedEnds),
		sourceKinds: new Uint8Array(
			Array.from({ length: pathCount }, (_, pathIndex) =>
				advancedSwitchIds[pathIndex] === 0
					? PHYSICAL_PATH_SOURCE_KIND.CARDINAL_CELL
					: PHYSICAL_PATH_SOURCE_KIND.ADVANCED_SWITCH_SEGMENT,
			),
		),
		advancedSwitchIds,
		advancedSwitchProfileClasses: filledUint8(pathCount, NO_ADVANCED_SWITCH_PROFILE_CLASS),
		advancedSwitchSegmentRoles: filledUint8(pathCount, NO_ADVANCED_SWITCH_SEGMENT_ROLE),
		advancedSwitchSegmentPorts: filledUint8(pathCount, NO_ADVANCED_SWITCH_SEGMENT_PORT),
		advancedSwitchSegmentOrdinals: filledUint16(pathCount, NO_ADVANCED_SWITCH_SEGMENT_ORDINAL),
		advancedSwitchCatalogProfiles: filledUint8(pathCount, NO_ADVANCED_SWITCH_CATALOG_PROFILE),
		explicitAdjacencyOffsets,
		explicitAdjacencyTargets: new Uint32Array(adjacencyTargets),
		sharedSegmentCount: sharedUsage.size,
		totalLengthMeters: totalRouteLengthMeters - duplicatedLengthMeters,
		totalRouteLengthMeters,
		pathCount,
		pointCount: pathCount * 2,
	};
}

function makePolylinePaths(
	polylines: readonly (readonly (readonly [number, number])[])[],
): CompiledPhysicalPaths {
	const base = makeLinePaths(
		polylines.map((points) => {
			const first = points[0] as readonly [number, number];
			const last = points.at(-1) as readonly [number, number];
			return [first[0], first[1], last[0], last[1]];
		}),
	);
	const pointCount = polylines.reduce((sum, points) => sum + points.length, 0);
	const positions = new Float32Array(pointCount * 2);
	const tangents = new Float32Array(pointCount * 2);
	const distances = new Float32Array(pointCount);
	const offsets = new Uint32Array(polylines.length + 1);
	const lengths = new Float32Array(polylines.length);
	const bounds = new Float32Array(polylines.length * 4);
	const cells = new Int32Array(polylines.length * 2);
	const exitCells = new Int32Array(polylines.length * 2);
	const coverageOffsets = new Uint32Array(polylines.length + 1);
	const coverage: number[] = [];
	let pointOffset = 0;
	for (let pathIndex = 0; pathIndex < polylines.length; pathIndex++) {
		const points = polylines[pathIndex] as readonly (readonly [number, number])[];
		offsets[pathIndex] = pointOffset;
		coverageOffsets[pathIndex] = coverage.length / 2;
		let distance = 0;
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (let localIndex = 0; localIndex < points.length; localIndex++) {
			const point = points[localIndex] as readonly [number, number];
			if (localIndex > 0) {
				const previous = points[localIndex - 1] as readonly [number, number];
				distance += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
			}
			const next = (points[localIndex + 1] ?? points[localIndex - 1]) as readonly [number, number];
			const tangentOrigin = points[localIndex + 1]
				? point
				: (points[localIndex - 1] as readonly [number, number]);
			const tangentLength = Math.hypot(next[0] - tangentOrigin[0], next[1] - tangentOrigin[1]);
			const globalIndex = pointOffset + localIndex;
			positions.set(point, globalIndex * 2);
			tangents.set(
				[
					(next[0] - tangentOrigin[0]) / tangentLength,
					(next[1] - tangentOrigin[1]) / tangentLength,
				],
				globalIndex * 2,
			);
			distances[globalIndex] = distance;
			minX = Math.min(minX, point[0]);
			minY = Math.min(minY, point[1]);
			maxX = Math.max(maxX, point[0]);
			maxY = Math.max(maxY, point[1]);
			coverage.push(Math.floor(point[0]), Math.floor(point[1]));
		}
		const first = points[0] as readonly [number, number];
		const last = points.at(-1) as readonly [number, number];
		lengths[pathIndex] = distance;
		bounds.set([minX, minY, maxX, maxY], pathIndex * 4);
		cells.set([Math.floor(first[0]), Math.floor(first[1])], pathIndex * 2);
		exitCells.set([Math.floor(last[0]), Math.floor(last[1])], pathIndex * 2);
		pointOffset += points.length;
	}
	offsets[polylines.length] = pointOffset;
	coverageOffsets[polylines.length] = coverage.length / 2;
	const totalLengthMeters = [...lengths].reduce((sum, length) => sum + length, 0);
	return {
		...base,
		positions,
		tangents,
		distances,
		offsets,
		lengths,
		bounds,
		cells,
		exitCells,
		coverageOffsets,
		coverageCells: new Int32Array(coverage),
		totalLengthMeters,
		totalRouteLengthMeters: totalLengthMeters,
		pointCount,
	};
}

function stableIssueIdentities(issues: {
	readonly count: number;
	readonly firstPathIdentities: Int32Array;
	readonly secondPathIdentities: Int32Array;
}): string[] {
	const result: string[] = [];
	for (let issueIndex = 0; issueIndex < issues.count; issueIndex++) {
		const start = issueIndex * RAIL_CLEARANCE_PATH_IDENTITY_WIDTH;
		const end = start + RAIL_CLEARANCE_PATH_IDENTITY_WIDTH;
		const pair = [
			[...issues.firstPathIdentities.slice(start, end)].join(":"),
			[...issues.secondPathIdentities.slice(start, end)].join(":"),
		].sort();
		result.push(pair.join("|"));
	}
	return result.sort();
}

function filledUint8(length: number, value: number): Uint8Array {
	const result = new Uint8Array(length);
	result.fill(value);
	return result;
}

function filledUint16(length: number, value: number): Uint16Array {
	const result = new Uint16Array(length);
	result.fill(value);
	return result;
}
