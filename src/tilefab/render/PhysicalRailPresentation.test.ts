import { describe, expect, it } from "vitest";
import { compilePhysicalPaths, PATH_KIND } from "../compile/PhysicalPathCompiler";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	compilePhysicalRailPresentation,
	OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE,
	RAIL_DECORATION_KIND,
	type RailPresentationProfile,
} from "./PhysicalRailPresentation";

describe("PhysicalRailPresentation", () => {
	it("derives typed normals, metric runs, and decorations from compiled paths only", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 3 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const presentation = compilePhysicalRailPresentation(paths);

		expect(presentation.source).toBe(paths);
		expect(presentation.profile.engineeringStatus).toBe("visual-construction-profile");
		expect(presentation.pointNormals).toBeInstanceOf(Float32Array);
		expect(presentation.pointNormals).toHaveLength(paths.pointCount * 2);
		expect(presentation.runs.pathRunIndices).toHaveLength(paths.pathCount);
		expect(presentation.decorations.pathOffsets).toHaveLength(paths.pathCount + 1);
		expect(presentation.decorations.positions).toHaveLength(presentation.decorations.count * 2);
		expect(presentation.decorations.stableIds).toHaveLength(presentation.decorations.count * 2);
	});

	it("places physical joints on five-meter run stations without one-meter cell dots", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 })),
		).toBe(true);
		const presentation = compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
		const metricStations = decorationStations(presentation, RAIL_DECORATION_KIND.METRIC_JOINT);

		expect(metricStations.some((station) => Math.abs(station - 5) < 0.001)).toBe(true);
		expect(metricStations.some((station) => Math.abs(station - 10) < 0.001)).toBe(true);
		expect(metricStations.some((station) => Math.abs(station - 1) < 0.001)).toBe(false);
	});

	it("keeps decoration ownership unique across shared turnout geometry", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: 3 })),
		).toBe(true);
		const presentation = compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
		const seen = new Set<string>();
		for (let index = 0; index < presentation.decorations.count; index++) {
			const kind = presentation.decorations.kinds[index] as number;
			const x = presentation.decorations.positions[index * 2] as number;
			const y = presentation.decorations.positions[index * 2 + 1] as number;
			const key = `${kind}:${x.toFixed(4)}:${y.toFixed(4)}`;
			expect(seen.has(key), key).toBe(false);
			seen.add(key);
		}
		for (let pathIndex = 0; pathIndex < presentation.source.pathCount; pathIndex++) {
			const kind = presentation.source.kinds[pathIndex] as number;
			if (kind !== PATH_KIND.TURNOUT_TRUNK && kind !== PATH_KIND.TURNOUT_DIVERGE) continue;
			const runIndex = presentation.runs.pathRunIndices[pathIndex] as number;
			expect(
				(presentation.runs.offsets[runIndex + 1] as number) -
					(presentation.runs.offsets[runIndex] as number),
			).toBe(1);
		}
	});

	it("keeps paired-beam spacing and tangent seams through chained curves", () => {
		const document = new RailDocument();
		for (const [from, to] of [
			[
				{ x: 0, y: 0 },
				{ x: 6, y: 0 },
			],
			[
				{ x: 6, y: 0 },
				{ x: 6, y: 4 },
			],
			[
				{ x: 6, y: 4 },
				{ x: 0, y: 4 },
			],
			[
				{ x: 0, y: 4 },
				{ x: 0, y: 0 },
			],
		] as const) {
			expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
		}
		const presentation = compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
		const offset = presentation.profile.beamCenterOffsetMeters;

		for (let pointIndex = 0; pointIndex < presentation.source.pointCount; pointIndex++) {
			const pointOffset = pointIndex * 2;
			const tangentX = presentation.source.tangents[pointOffset] as number;
			const tangentY = presentation.source.tangents[pointOffset + 1] as number;
			const normalX = presentation.pointNormals[pointOffset] as number;
			const normalY = presentation.pointNormals[pointOffset + 1] as number;
			expect(tangentX * normalX + tangentY * normalY).toBeCloseTo(0, 5);
			expect(Math.hypot(normalX, normalY)).toBeCloseTo(1, 5);
			expect(Math.hypot(normalX * offset * 2, normalY * offset * 2)).toBeCloseTo(offset * 2, 5);
		}

		let seamCount = 0;
		for (let runIndex = 0; runIndex < presentation.runs.count; runIndex++) {
			const start = presentation.runs.offsets[runIndex] as number;
			const end = presentation.runs.offsets[runIndex + 1] as number;
			for (let index = start + 1; index < end; index++) {
				expectBeamSeam(presentation, index - 1, index, offset);
				seamCount++;
			}
			if ((presentation.runs.closed[runIndex] as number) !== 0 && end - start > 1) {
				expectBeamSeam(presentation, end - 1, start, offset);
				seamCount++;
			}
		}
		expect(seamCount).toBeGreaterThan(3);
	});

	it("breaks advanced-switch movements into explicit hardware runs with visible flow", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 2, y: 0 })),
		).toBe(true);
		const plan = planAdvancedSwitch(document.map, { x: 2, y: 0 }, { x: 2, y: -2 }, "A");
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		const presentation = compilePhysicalRailPresentation(compilePhysicalRail(document.map).paths);
		let switchPathCount = 0;
		let compactFlowCount = 0;

		for (let pathIndex = 0; pathIndex < presentation.source.pathCount; pathIndex++) {
			if ((presentation.source.kinds[pathIndex] as number) !== PATH_KIND.ADVANCED_SWITCH_SEGMENT)
				continue;
			switchPathCount++;
			const runIndex = presentation.runs.pathRunIndices[pathIndex] as number;
			expect(
				(presentation.runs.offsets[runIndex + 1] as number) -
					(presentation.runs.offsets[runIndex] as number),
			).toBe(1);
			const decorationStart = presentation.decorations.pathOffsets[pathIndex] as number;
			const decorationEnd = presentation.decorations.pathOffsets[pathIndex + 1] as number;
			const kinds = [...presentation.decorations.kinds.slice(decorationStart, decorationEnd)];
			expect(kinds.some(isFlowKind)).toBe(true);
			compactFlowCount += kinds.filter((kind) => kind === RAIL_DECORATION_KIND.FLOW_COMPACT).length;
		}
		expect(switchPathCount).toBe(5);
		expect(
			compactFlowCount,
			"short switch legs use an explicit compact direction cue",
		).toBeGreaterThan(0);
		for (let index = 0; index < presentation.decorations.count; index++) {
			if ((presentation.decorations.kinds[index] as number) !== RAIL_DECORATION_KIND.FLOW) continue;
			expect(normalFlowHardwareClearance(presentation, index)).toBeGreaterThanOrEqual(
				presentation.profile.flowHardwareExclusionMeters - 0.001,
			);
		}
	});

	it("anchors a closed loop once and derives its seam from the actual last path", () => {
		const document = new RailDocument();
		for (const [from, to] of [
			[
				{ x: 0, y: 0 },
				{ x: 6, y: 0 },
			],
			[
				{ x: 6, y: 0 },
				{ x: 6, y: 4 },
			],
			[
				{ x: 6, y: 4 },
				{ x: 0, y: 4 },
			],
			[
				{ x: 0, y: 4 },
				{ x: 0, y: 0 },
			],
		] as const) {
			expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
		}
		const paths = compilePhysicalRail(document.map).paths;
		const first = compilePhysicalRailPresentation(paths);
		const second = compilePhysicalRailPresentation(paths);

		expect(first.runs.count).toBe(1);
		expect(first.runs.closed[0]).toBe(1);
		expect([...first.decorations.stableIds]).toEqual([...second.decorations.stableIds]);
		const zeroStationDecorations = [...first.decorations.runStations].filter(
			(station) => Math.abs(station) < 0.001,
		);
		expect(zeroStationDecorations).toHaveLength(1);
		expect(
			decorationStations(first, RAIL_DECORATION_KIND.FLOW),
			"every closed directed run needs a visible one-way cue",
		).not.toHaveLength(0);
	});

	it("rejects non-progressing or non-finite profile intervals before decoration loops", () => {
		const paths = compilePhysicalRail(new RailDocument().map).paths;
		for (const field of [
			"jointIntervalMeters",
			"supportIntervalMeters",
			"flowIntervalMeters",
		] as const) {
			for (const value of [0, -1, 0.009, Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY]) {
				const profile = {
					...OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE,
					[field]: value,
				} as RailPresentationProfile;
				expect(() => compilePhysicalRailPresentation(paths, profile), `${field}=${value}`).toThrow(
					RangeError,
				);
			}
		}
	});

	it("caps the total visual decoration budget before allocating a metric run", () => {
		const map = new TileMap();
		for (let x = 0; x <= 500; x++) {
			map.setEncoded(
				x,
				0,
				encodeRailCell({ incoming: x === 0 ? 0 : DIR_W, outgoing: x === 500 ? 0 : DIR_E }),
			);
		}
		const profile: RailPresentationProfile = {
			...OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE,
			jointIntervalMeters: 0.01,
			supportIntervalMeters: 0.01,
			flowIntervalMeters: 0.01,
			supportJointExclusionMeters: 0,
			flowHardwareExclusionMeters: 0,
		};

		expect(() => compilePhysicalRailPresentation(compilePhysicalPaths(map), profile)).toThrow(
			/total decoration count exceeds/,
		);
	});

	it("compiles thousands of disconnected closed runs without a quadratic cycle scan", () => {
		const template = new RailDocument();
		for (const [from, to] of [
			[
				{ x: 0, y: 0 },
				{ x: 2, y: 0 },
			],
			[
				{ x: 2, y: 0 },
				{ x: 2, y: 2 },
			],
			[
				{ x: 2, y: 2 },
				{ x: 0, y: 2 },
			],
			[
				{ x: 0, y: 2 },
				{ x: 0, y: 0 },
			],
		] as const) {
			expect(template.commit(planRailConstruction(template.map, from, to))).toBe(true);
		}
		const loopCount = 4_000;
		const map = new TileMap();
		for (let loop = 0; loop < loopCount; loop++) {
			template.map.forEachRail((x, y, _rail, encoded) => {
				map.setEncoded(x + loop * 5, y, encoded);
			});
		}
		const paths = compilePhysicalPaths(map);
		const startedAt = Date.now();
		const presentation = compilePhysicalRailPresentation(paths);
		const elapsedMilliseconds = Date.now() - startedAt;

		expect(presentation.runs.count).toBe(loopCount);
		expect([...presentation.runs.closed].every((closed) => closed === 1)).toBe(true);
		expect(elapsedMilliseconds).toBeLessThan(1_000);
	});

	it("uses one immutable versioned OpenFab presentation profile", () => {
		expect(Object.isFrozen(OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE)).toBe(true);
		expect(OPENFAB_CONSTRUCTION_PRESENTATION_PROFILE).toMatchObject({
			id: "openfab-construction-v1",
			version: 1,
			jointIntervalMeters: 5,
		});
	});

	it("keeps a 10,000-cell continuous run metric and avoids cell-boundary joints", () => {
		const map = new TileMap();
		for (let x = 0; x < 10_000; x++) {
			map.setEncoded(
				x,
				0,
				encodeRailCell({ incoming: x === 0 ? 0 : DIR_W, outgoing: x === 9_999 ? 0 : DIR_E }),
			);
		}
		const paths = compilePhysicalPaths(map);
		const startedAt = Date.now();
		const presentation = compilePhysicalRailPresentation(paths);
		const elapsedMilliseconds = Date.now() - startedAt;
		const metricJoints = decorationStations(presentation, RAIL_DECORATION_KIND.METRIC_JOINT);

		expect(presentation.runs.count).toBe(1);
		expect(presentation.runs.lengths[0]).toBeCloseTo(9_999);
		expect(metricJoints.length).toBeLessThan(2_100);
		expect(metricJoints.some((station) => Math.abs(station - 1) < 0.001)).toBe(false);
		expect(elapsedMilliseconds).toBeLessThan(1_000);
	});
});

function decorationStations(
	presentation: ReturnType<typeof compilePhysicalRailPresentation>,
	kind: number,
): number[] {
	const stations: number[] = [];
	for (let index = 0; index < presentation.decorations.count; index++) {
		if ((presentation.decorations.kinds[index] as number) === kind) {
			stations.push(presentation.decorations.runStations[index] as number);
		}
	}
	return stations;
}

function isFlowKind(kind: number): boolean {
	return kind === RAIL_DECORATION_KIND.FLOW || kind === RAIL_DECORATION_KIND.FLOW_COMPACT;
}

function normalFlowHardwareClearance(
	presentation: ReturnType<typeof compilePhysicalRailPresentation>,
	flowIndex: number,
): number {
	const runIndex = presentation.decorations.runIndices[flowIndex] as number;
	const flowStation = presentation.decorations.runStations[flowIndex] as number;
	let clearance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < presentation.decorations.count; index++) {
		if ((presentation.decorations.runIndices[index] as number) !== runIndex) continue;
		const kind = presentation.decorations.kinds[index] as number;
		if (kind > RAIL_DECORATION_KIND.SUPPORT || isFlowKind(kind)) continue;
		clearance = Math.min(
			clearance,
			Math.abs(flowStation - (presentation.decorations.runStations[index] as number)),
		);
	}
	return clearance;
}

function expectBeamSeam(
	presentation: ReturnType<typeof compilePhysicalRailPresentation>,
	fromRunOffset: number,
	toRunOffset: number,
	beamOffset: number,
): void {
	const fromPath = presentation.runs.pathIndices[fromRunOffset] as number;
	const toPath = presentation.runs.pathIndices[toRunOffset] as number;
	const fromPoint = (presentation.source.offsets[fromPath + 1] as number) - 1;
	const toPoint = presentation.source.offsets[toPath] as number;
	for (const side of [-1, 1]) {
		const fromOffset = fromPoint * 2;
		const toOffset = toPoint * 2;
		const fromX =
			(presentation.source.positions[fromOffset] as number) +
			(presentation.pointNormals[fromOffset] as number) * beamOffset * side;
		const fromY =
			(presentation.source.positions[fromOffset + 1] as number) +
			(presentation.pointNormals[fromOffset + 1] as number) * beamOffset * side;
		const toX =
			(presentation.source.positions[toOffset] as number) +
			(presentation.pointNormals[toOffset] as number) * beamOffset * side;
		const toY =
			(presentation.source.positions[toOffset + 1] as number) +
			(presentation.pointNormals[toOffset + 1] as number) * beamOffset * side;
		expect(Math.hypot(fromX - toX, fromY - toY)).toBeLessThan(0.003);
	}
}
