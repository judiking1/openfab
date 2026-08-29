import { describe, expect, it } from "vitest";
import { analyzeRailNetwork } from "../core/network";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	initialRailTemplatePose,
	type LongBayTemplateParameters,
	planRailTemplate,
} from "../core/RailTemplateCatalog";
import { DIR_E } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { createRailScaleProbeDocument } from "../worker/RailStartupFixture";
import { PATH_KIND } from "./PhysicalPathCompiler";
import { physicalPathIdentity } from "./PhysicalPathIdentity";
import { type CompiledPhysicalLayout, compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	RAIL_CLEARANCE_ISSUE_CODE,
	RAIL_CLEARANCE_PATH_IDENTITY_WIDTH,
	RAIL_CLEARANCE_RELATION,
} from "./RailClearanceValidator";
import {
	checksumRailProjectReadiness,
	createRailProjectReadiness,
	rebindRailProjectReadinessAuthoredChecksum,
} from "./RailProjectReadiness";

describe("RailProjectReadiness", () => {
	it("reports an empty project without implying simulation readiness", () => {
		const map = new TileMap();
		const report = reportFor(map);

		expect(report).toMatchObject({
			status: "empty",
			ready: false,
			summary: {
				closure: "empty",
				strongComponents: 0,
				openTerminals: 0,
			},
		});
		expect(report.issues.map((issue) => issue.code)).toEqual(["EMPTY_PROJECT"]);
	});

	it("lists deterministic open terminals and every directed SCC", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -2, y: 1 }, { x: 2, y: 1 })),
		).toBe(true);

		const first = reportFor(document.map);
		const second = reportFor(document.map);
		expect(first).toMatchObject({
			status: "blocked",
			ready: false,
			summary: {
				closure: "open",
				weakComponents: 1,
				strongComponents: 5,
				openTerminals: 2,
			},
		});
		const openIssue = first.issues.find((issue) => issue.code === "OPEN_TERMINAL");
		expect(openIssue?.affectedCount).toBe(2);
		expect(openIssue?.cells).toEqual([
			{ x: -2, y: 1 },
			{ x: 2, y: 1 },
		]);
		expect(first.issues.some((issue) => issue.code === "MULTIPLE_STRONG_COMPONENTS")).toBe(true);
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.issues.map((issue) => issue.id)).toEqual(second.issues.map((issue) => issue.id));
	});

	it("accepts a deterministic closed Long Bay authored through the product planner", () => {
		const first = buildLongBay();
		const second = buildLongBay();
		const firstReport = reportFor(first.map);
		const secondReport = reportFor(second.map);

		expect(firstReport).toMatchObject({
			status: "ready",
			ready: true,
			summary: {
				closure: "closed",
				weakComponents: 1,
				strongComponents: 1,
				openTerminals: 0,
				unsupportedJunctions: 0,
				topologyErrors: 0,
				clearanceIssues: 0,
			},
		});
		expect(firstReport.issues).toEqual([]);
		expect(firstReport.fingerprint).toBe(secondReport.fingerprint);
	});

	it("rebinds static-world identity while preserving unchanged rail readiness buffers", () => {
		const document = buildLongBay();
		const original = reportFor(document.map);
		const nextChecksum = `${original.authoredChecksum.slice(0, -8)}12345678`;
		const rebound = rebindRailProjectReadinessAuthoredChecksum(original, nextChecksum);

		expect(rebound).not.toBe(original);
		expect(rebound.authoredChecksum).toBe(nextChecksum);
		expect(rebound.topologyFingerprint).toBe(original.topologyFingerprint);
		expect(rebound.fingerprint).not.toBe(original.fingerprint);
		expect(rebound.summary).toBe(original.summary);
		expect(rebound.locations).toBe(original.locations);
		expect(rebound.issues).toBe(original.issues);
		expect(checksumRailProjectReadiness(rebound)).toBe(rebound.fingerprint);
		expect(rebindRailProjectReadinessAuthoredChecksum(rebound, nextChecksum)).toBe(rebound);
		expect(Object.isFrozen(rebound)).toBe(true);
		expect(() =>
			checksumRailProjectReadiness({ ...rebound, topologyFingerprint: "corrupt" }),
		).toThrow(/topology fingerprint mismatch/i);
	});

	it("keeps disconnected closed systems blocked and locatable", () => {
		const first = buildLoop(0, 0);
		const second = buildLoop(30, 10);
		const hydrator = TileMap.createHydrator();
		first.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		second.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		const report = reportFor(hydrator.finish(1));

		expect(report.summary).toMatchObject({
			closure: "closed",
			weakComponents: 2,
			strongComponents: 2,
			openTerminals: 0,
		});
		const disconnected = report.issues.find((issue) => issue.code === "DISCONNECTED_NETWORK");
		expect(disconnected?.cells).toEqual([
			{ x: 0, y: 0 },
			{ x: 30, y: 10 },
		]);
	});

	it("reports one missing return connection instead of numbering every SCC on a one-way bridge", () => {
		const first = buildLoop(0, 0);
		const second = buildLoop(20, 0);
		const hydrator = TileMap.createHydrator();
		first.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		second.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		const document = RailDocument.fromLoadedMap(hydrator.finish(1), 0);
		expect(
			document.commit(planRailConstruction(document.map, { x: 8, y: 3 }, { x: 20, y: 3 })),
		).toBe(true);

		const report = reportFor(document.map);
		const issue = report.issues.find(
			(candidate) => candidate.code === "MULTIPLE_STRONG_COMPONENTS",
		);
		expect(report.summary).toMatchObject({ closure: "closed", weakComponents: 1 });
		expect(report.summary.strongComponents).toBeGreaterThan(2);
		expect(issue).toMatchObject({
			sourceCode: "ONE_WAY_CORRIDOR",
			affectedCount: 1,
		});
		expect(report.summary.minimumReturnLinks).toBe(1);
		expect(report.locations.oneWayCorridorOffsets).toEqual(new Uint32Array([0, 13]));
		expect(report.locations.oneWayCorridorBoundaries).toEqual(
			new Int32Array([8, 3, 9, 3, 19, 3, 20, 3]),
		);
		expect(issue?.cells).toHaveLength(4);
	});

	it("surfaces compiler topology diagnostics with authored focus cells", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		const report = reportFor(map);
		const topology = report.issues.filter((issue) => issue.code === "TOPOLOGY_ERROR");

		expect(report.ready).toBe(false);
		expect(report.summary.topologyErrors).toBeGreaterThan(0);
		expect(topology.length).toBe(report.summary.topologyErrors);
		expect(topology[0]?.cells).toContainEqual({ x: 0, y: 0 });
	});

	it("uses stable physical path identities for clearance issue navigation", () => {
		const document = buildLongBay();
		const analysis = analyzeRailNetwork(document.map);
		const physical = compilePhysicalRail(document.map);
		const conflicted = withSyntheticClearanceIssue(physical);
		const report = createRailProjectReadiness(analysis, conflicted, checksumRailMap(document.map));
		const issue = report.issues.find((candidate) => candidate.code === "CLEARANCE_CONFLICT");

		expect(report.ready).toBe(false);
		expect(report.summary.clearanceIssues).toBe(1);
		expect(issue?.sourceCode).toBe("BEAM_INTRUSION");
		expect(issue?.pathIdentities).toHaveLength(2);
		expect(issue?.pathIdentities[0]).toHaveLength(RAIL_CLEARANCE_PATH_IDENTITY_WIDTH);
	});

	it("provides stable target identities for invalid physical paths", () => {
		const document = buildLongBay();
		const analysis = analyzeRailNetwork(document.map);
		const physical = compilePhysicalRail(document.map);
		const kinds = physical.paths.kinds.slice();
		kinds[0] = PATH_KIND.INVALID;
		const invalid = {
			...physical,
			paths: { ...physical.paths, kinds },
		};
		const report = createRailProjectReadiness(analysis, invalid, checksumRailMap(document.map));
		const issue = report.issues.find((candidate) => candidate.code === "INVALID_PHYSICAL_PATH");

		expect(issue?.affectedCount).toBe(1);
		expect(issue?.cells).toHaveLength(1);
		expect(issue?.pathIdentities).toHaveLength(1);
		expect(issue?.pathIdentities[0]).toEqual(physicalPathIdentity(invalid.paths, 0));
	});

	it("blocks an authored closed loop when its compiled physical graph is missing", () => {
		const document = buildLongBay();
		const report = createRailProjectReadiness(
			analyzeRailNetwork(document.map),
			compilePhysicalRail(new TileMap()),
			checksumRailMap(document.map),
		);

		expect(report.ready).toBe(false);
		expect(report.summary).toMatchObject({
			closure: "closed",
			physicalPaths: 0,
			physicalStrongComponents: 0,
		});
		expect(report.issues.some((issue) => issue.code === "PHYSICAL_DISCONNECTED")).toBe(true);
	});

	it("blocks injected physical terminals and a split physical SCC", () => {
		const document = buildLongBay();
		const analysis = analyzeRailNetwork(document.map);
		const physical = compilePhysicalRail(document.map);
		const terminalReport = createRailProjectReadiness(
			analysis,
			{ ...physical, terminals: Object.freeze([{ x: 9, y: 9 }]) },
			checksumRailMap(document.map),
		);
		expect(terminalReport.ready).toBe(false);
		expect(terminalReport.summary.physicalTerminals).toBe(1);

		const first = buildLoop(0, 0);
		const second = buildLoop(30, 10);
		const hydrator = TileMap.createHydrator();
		first.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		second.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
		const splitPhysical = compilePhysicalRail(hydrator.finish(1));
		const splitReport = createRailProjectReadiness(
			analysis,
			splitPhysical,
			checksumRailMap(document.map),
		);
		expect(splitReport.ready).toBe(false);
		expect(splitReport.summary.physicalStrongComponents).toBe(2);
		expect(splitReport.issues.some((issue) => issue.code === "PHYSICAL_DISCONNECTED")).toBe(true);
	});

	it("keeps 50k-cell issue objects bounded while retaining complete typed locations", () => {
		const document = createRailScaleProbeDocument(50_000);
		const report = reportFor(document.map);
		const rebound = rebindRailProjectReadinessAuthoredChecksum(
			report,
			`${report.authoredChecksum.slice(0, -8)}abcdef01`,
		);

		expect(report.ready).toBe(false);
		expect(report.summary.strongComponents).toBe(50_000);
		expect(report.locations.strongComponentRepresentativeCells).toHaveLength(100_000);
		expect(report.issues.length).toBeLessThanOrEqual(6);
		for (const issue of report.issues) {
			expect(issue.cells.length).toBeLessThanOrEqual(16);
			expect(issue.pathIdentities.length).toBeLessThanOrEqual(16);
			expect(issue.id.length).toBeLessThan(96);
		}
		expect(rebound.locations).toBe(report.locations);
		expect(rebound.topologyFingerprint).toBe(report.topologyFingerprint);
	});
});

function reportFor(map: TileMap) {
	return createRailProjectReadiness(
		analyzeRailNetwork(map),
		compilePhysicalRail(map),
		checksumRailMap(map),
	);
}

function buildLongBay(): RailDocument {
	const document = new RailDocument();
	const parameters: LongBayTemplateParameters = Object.freeze({
		templateId: "long-bay",
		aisleLengthMeters: 16,
		laneSpacingMeters: 6,
		clearanceProfileId: "OPENFAB_COMPACT_AMHS_CLEARANCE_V1",
	});
	const plan = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		parameters,
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function buildLoop(x: number, y: number): RailDocument {
	const document = new RailDocument();
	for (const [from, to] of [
		[
			{ x, y },
			{ x: x + 8, y },
		],
		[
			{ x: x + 8, y },
			{ x: x + 8, y: y + 6 },
		],
		[
			{ x: x + 8, y: y + 6 },
			{ x, y: y + 6 },
		],
		[
			{ x, y: y + 6 },
			{ x, y },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, from, to))).toBe(true);
	}
	return document;
}

function withSyntheticClearanceIssue(physical: CompiledPhysicalLayout): CompiledPhysicalLayout {
	const firstPathIndex = 0;
	const secondPathIndex = Math.min(1, physical.paths.pathCount - 1);
	return {
		...physical,
		clearance: {
			...physical.clearance,
			issues: {
				count: 1,
				candidateEnvelopePairs: 1,
				testedEnvelopePairs: 1,
				codes: new Uint8Array([RAIL_CLEARANCE_ISSUE_CODE.BEAM_INTRUSION]),
				relations: new Uint8Array([RAIL_CLEARANCE_RELATION.UNRELATED]),
				firstPathIndices: new Uint32Array([firstPathIndex]),
				secondPathIndices: new Uint32Array([secondPathIndex]),
				firstPathIdentities: physicalPathIdentity(physical.paths, firstPathIndex),
				secondPathIdentities: physicalPathIdentity(physical.paths, secondPathIndex),
				firstEnvelopeIndices: new Uint32Array([0]),
				secondEnvelopeIndices: new Uint32Array([1]),
				firstStations: new Float32Array([0.5]),
				secondStations: new Float32Array([0.5]),
				contactPoints: new Float32Array([0.5, 0.5]),
				centerlineDistances: new Float32Array([0]),
				requiredClearances: new Float32Array([0.8]),
				penetrationDepths: new Float32Array([0.8]),
				cells: new Int32Array([0, 0, 1, 0]),
			},
		},
	};
}
