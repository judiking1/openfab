import { describe, expect, it } from "vitest";
import { deriveAdvancedSwitchGeometry } from "../core/AdvancedSwitch";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { analyzeRailNetwork } from "../core/network";
import { planRailConstruction, planRailPath } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import type { DirectedRailEdge } from "../core/RailModuleOwnership";
import { ALL_DIRECTIONS, moveCell } from "../core/railShape";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import { type Cell, TileMap } from "../core/TileMap";
import {
	evaluateStaticFabProcessLoopTopology,
	projectStaticFabProcessLoopRail,
} from "./StaticFabProcessLoopTopology";

describe("StaticFabProcessLoopTopology", () => {
	it("reports a closed candidate with compact evidence and no authoring authority", () => {
		const document = loopDocument();
		const revision = document.map.getRevision();
		const generation = document.map.getMutationGeneration();
		const before = mapRows(document.map);
		const result = evaluateStaticFabProcessLoopTopology(document.map, membership(document.map));
		expect(result).toMatchObject({
			valid: true,
			authoringAuthority: "NONE",
			evidence: {
				authoredComponents: 1,
				authoredStrongComponents: 1,
				authoredOpenEnds: 0,
				physicalStrongComponents: 1,
				physicalOpenPaths: 0,
				physicalClearanceIssues: 0,
			},
		});
		expect(Object.isFrozen(result.evidence)).toBe(true);
		expect(
			Object.values(result.evidence).every(
				(value) => typeof value === "number" || typeof value === "boolean",
			),
		).toBe(true);
		expect(document.map.getRevision()).toBe(revision);
		expect(document.map.getMutationGeneration()).toBe(generation);
		expect(mapRows(document.map)).toEqual(before);
	});

	it("certifies only selected candidate topology while other source rails remain open", () => {
		const document = loopDocument();
		const selected = membership(document.map);
		buildPath(document, [
			{ x: 100, y: 100 },
			{ x: 110, y: 100 },
		]);
		expect(analyzeRailNetwork(document.map).openEnds).toBe(2);
		expect(evaluateStaticFabProcessLoopTopology(document.map, selected).valid).toBe(true);
	});

	it("leaves unselected outgoing/incoming bits out of shared source cells", () => {
		const document = new RailDocument();
		buildPath(document, [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		]);
		buildPath(document, [
			{ x: 5, y: 0 },
			{ x: 5, y: 5 },
		]);
		const railEdges = Array.from({ length: 10 }, (_, x) => ({
			from: { x, y: 0 },
			to: { x: x + 1, y: 0 },
		}));
		const selected = canonicalMembership(railEdges);
		const projected = projectStaticFabProcessLoopRail(document.map, selected);
		expect(projected.size).toBe(11);
		expect(projected.edgeCount).toBe(10);
		expect(projected.hasRail(5, 1)).toBe(false);
		expect(projected.getRail(5, 0)).not.toEqual(document.map.getRail(5, 0));
		expect(analyzeRailNetwork(projected)).toMatchObject({ junctions: 0, openEnds: 2 });
		expect(evaluateStaticFabProcessLoopTopology(document.map, selected).valid).toBe(false);
	});

	it("requires closure even when an open rail compiles valid physical geometry", () => {
		const document = new RailDocument();
		buildPath(document, [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		]);
		expect(
			evaluateStaticFabProcessLoopTopology(document.map, membership(document.map)),
		).toMatchObject({
			valid: false,
			evidence: {
				authoredOpenEnds: 2,
				authoredClosed: false,
				physicalValid: true,
				physicalClosed: false,
			},
		});
	});

	it("rejects empty membership without granting authority", () => {
		expect(
			evaluateStaticFabProcessLoopTopology(loopDocument().map, canonicalMembership([])),
		).toMatchObject({
			valid: false,
			authoringAuthority: "NONE",
			evidence: {
				authoredCells: 0,
				authoredClosed: false,
				physicalPaths: 0,
				physicalClosed: false,
			},
		});
	});

	it("rejects an authored closed network whose turnout loses physical clearance", () => {
		const document = new RailDocument();
		const main = planRailPath(document.map, [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 3, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 1 },
			{ x: 5, y: 1 },
			{ x: 6, y: 1 },
		]);
		expect(document.commit(main), main.reason).toBe(true);
		buildPath(document, [
			{ x: 6, y: 1 },
			{ x: 20, y: 1 },
			{ x: 20, y: 20 },
			{ x: -20, y: 20 },
			{ x: -20, y: 0 },
			{ x: 0, y: 0 },
		]);
		buildPath(document, [
			{ x: 3, y: 0 },
			{ x: 3, y: -10 },
			{ x: -10, y: -10 },
			{ x: -10, y: 0 },
		]);
		const result = evaluateStaticFabProcessLoopTopology(document.map, membership(document.map));
		expect(result.evidence.authoredClosed).toBe(true);
		expect(result.evidence.physicalClearanceIssues).toBeGreaterThan(0);
		expect(result.evidence.physicalClosed).toBe(false);
		expect(result.valid).toBe(false);
		expect(result.authoringAuthority).toBe("NONE");
	});

	it("rejects disconnected closed loops with no open ends", () => {
		const document = loopDocument();
		addLoop(document, 50, 0);
		expect(
			evaluateStaticFabProcessLoopTopology(document.map, membership(document.map)),
		).toMatchObject({
			valid: false,
			evidence: {
				authoredComponents: 2,
				authoredStrongComponents: 2,
				authoredOpenEnds: 0,
				physicalValid: true,
				physicalStrongComponents: 2,
				physicalClosed: false,
			},
		});
	});

	it("rejects a one-way bridge between loops despite weak closure", () => {
		const document = loopDocument();
		addLoop(document, 50, 0);
		buildPath(document, [
			{ x: 30, y: 10 },
			{ x: 50, y: 10 },
		]);
		const result = evaluateStaticFabProcessLoopTopology(document.map, membership(document.map));
		expect(result.valid).toBe(false);
		expect(result.evidence.authoredComponents).toBe(1);
		expect(result.evidence.authoredOpenEnds).toBe(0);
		expect(result.evidence.authoredStrongComponents).toBeGreaterThan(1);
	});

	it("accepts a supported branch/merge within one strongly connected candidate", () => {
		const document = loopDocument();
		buildPath(document, [
			{ x: 10, y: 0 },
			{ x: 10, y: -10 },
			{ x: 20, y: -10 },
			{ x: 20, y: 0 },
		]);
		expect(analyzeRailNetwork(document.map)).toMatchObject({
			junctions: 2,
			strongComponents: 1,
			openEnds: 0,
		});
		expect(evaluateStaticFabProcessLoopTopology(document.map, membership(document.map)).valid).toBe(
			true,
		);
	});

	it("preserves sparse switch IDs, source cursor and only selected switch metadata", () => {
		const document = new RailDocument();
		buildPath(document, [
			{ x: -4, y: 0 },
			{ x: 0, y: 0 },
		]);
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(document.commit(plan), plan.reason).toBe(true);
		if (!plan.switchRecord) throw new Error("missing synthetic switch");
		const hydrator = TileMap.createHydrator();
		document.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		hydrator.addAdvancedSwitch({ ...plan.switchRecord, id: 73 });
		const source = hydrator.finish(document.map.getRevision(), 100);
		const selected = membership(source);
		const projected = projectStaticFabProcessLoopRail(source, selected);
		expect(projected.getAdvancedSwitch(73)).toEqual(source.getAdvancedSwitch(73));
		expect(projected.getAdvancedSwitch(1)).toBeUndefined();
		expect(projected.getAdvancedSwitchIdCursor()).toBe(100);
		expect(projected.getRevision()).toBe(source.getRevision());
		expect(() => projectStaticFabProcessLoopRail(source, canonicalMembership([], [73]))).toThrow(
			/footprint/,
		);
		expect(() => projectStaticFabProcessLoopRail(source, canonicalMembership([], [74]))).toThrow(
			/absent/,
		);
		expect(() =>
			projectStaticFabProcessLoopRail(source, { ...selected, advancedSwitchIds: [73, 73] }),
		).toThrow(/ascending/);
	});

	it("accepts an actual closed advanced-switch network and excludes an unrelated switch", () => {
		const document = new RailDocument();
		buildPath(document, [
			{ x: -20, y: 0 },
			{ x: 0, y: 0 },
		]);
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(document.commit(plan), plan.reason).toBe(true);
		if (!plan.switchRecord) throw new Error("missing synthetic switch");
		const geometry = deriveAdvancedSwitchGeometry(plan.switchRecord);
		buildPath(document, [
			geometry.outputs[0].cell,
			{ x: 20, y: 0 },
			{ x: 20, y: -20 },
			{ x: -20, y: -20 },
			{ x: -20, y: 0 },
		]);
		buildPath(document, [
			geometry.outputs[1].cell,
			{ x: 4, y: 20 },
			{ x: -10, y: 20 },
			{ x: -10, y: 10 },
			{ x: 2, y: 10 },
			geometry.inputs[1].cell,
		]);
		const selected = membership(document.map);
		const closed = evaluateStaticFabProcessLoopTopology(document.map, selected);
		expect(closed.valid, JSON.stringify(closed.evidence)).toBe(true);
		expect(closed).toMatchObject({
			valid: true,
			evidence: { authoredClosed: true, physicalClosed: true },
		});
		buildPath(document, [
			{ x: 100, y: 0 },
			{ x: 104, y: 0 },
		]);
		const other = planAdvancedSwitch(document.map, { x: 104, y: 0 }, { x: 104, y: 3 }, "A");
		expect(document.commit(other), other.reason).toBe(true);
		expect(document.map.advancedSwitchCount).toBe(2);
		const projected = projectStaticFabProcessLoopRail(document.map, selected);
		expect(projected.advancedSwitchCount).toBe(1);
		expect(projected.getAdvancedSwitch(plan.switchRecord.id)).toEqual(plan.switchRecord);
		expect(projected.getAdvancedSwitch(other.switchRecord?.id ?? -1)).toBeUndefined();
		expect(projected.getAdvancedSwitchIdCursor()).toBe(document.map.getAdvancedSwitchIdCursor());
		expect(evaluateStaticFabProcessLoopTopology(document.map, selected).valid).toBe(true);
	});

	it("rejects malformed, absent and noncanonical membership without changing source", () => {
		const document = loopDocument();
		const selected = membership(document.map);
		const edge = selected.railEdges[0];
		if (!edge) throw new Error("missing edge");
		const before = mapRows(document.map);
		for (const candidate of [
			{ ...selected, railEdges: [edge, edge] },
			{ ...selected, railEdges: [...selected.railEdges].reverse() },
			{ ...selected, railEdges: [{ from: { x: 100, y: 100 }, to: { x: 101, y: 100 } }] },
			{ ...selected, railEdges: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] },
			{ ...selected, railEdges: [{ from: { x: 130049, y: 0 }, to: { x: 130050, y: 0 } }] },
			{ ...selected, equipmentGroupIds: [1] },
		])
			expect(() => projectStaticFabProcessLoopRail(document.map, candidate)).toThrow();
		expect(mapRows(document.map)).toEqual(before);
	});
});

function loopDocument(): RailDocument {
	const document = new RailDocument();
	addLoop(document, 0, 0);
	return document;
}

function addLoop(document: RailDocument, x: number, y: number): void {
	buildPath(document, [
		{ x, y },
		{ x: x + 30, y },
		{ x: x + 30, y: y + 20 },
		{ x, y: y + 20 },
		{ x, y },
	]);
}

function buildPath(document: RailDocument, points: readonly Cell[]): void {
	for (let i = 1; i < points.length; i++) {
		const plan = planRailConstruction(document.map, points[i - 1] as Cell, points[i] as Cell);
		expect(document.commit(plan), plan.reason).toBe(true);
	}
}

function membership(map: TileMap): StaticFabOrganizationMembership {
	const edges: DirectedRailEdge[] = [];
	map.forEachRail((x, y, rail) => {
		for (const direction of ALL_DIRECTIONS) {
			if ((rail.outgoing & direction) !== 0)
				edges.push({ from: { x, y }, to: moveCell({ x, y }, direction) });
		}
	});
	const switches: number[] = [];
	map.forEachAdvancedSwitch((record) => switches.push(record.id));
	return canonicalMembership(edges, switches);
}

function canonicalMembership(
	edges: readonly DirectedRailEdge[],
	switches: readonly number[] = [],
): StaticFabOrganizationMembership {
	const unique = new Map(edges.map((edge) => [staticFabOrganizationEdgeKey(edge), edge]));
	return Object.freeze({
		railEdges: Object.freeze([...unique.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...new Set(switches)].sort((a, b) => a - b)),
		equipmentGroupIds: Object.freeze([]),
	});
}

function mapRows(map: TileMap): number[][] {
	const rows: number[][] = [];
	map.forEachRail((x, y, _rail, encoded) => rows.push([x, y, encoded]));
	return rows.sort(
		(a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number),
	);
}
