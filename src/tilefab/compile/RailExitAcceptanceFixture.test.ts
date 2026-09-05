import { describe, expect, it } from "vitest";
import { analyzeRailNetwork } from "../core/network";
import { buildRailModuleOwnershipIndex, planRailModuleBulldoze } from "../core/RailModuleOwnership";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	buildRailExitAcceptanceFixture,
	RAIL_EXIT_ACCEPTANCE_FIXTURE,
} from "./RailExitAcceptanceFixture";
import { createRailProjectReadiness } from "./RailProjectReadiness";

describe("RailExitAcceptanceFixture", () => {
	it("owns one immutable deterministic definition", () => {
		expect(RAIL_EXIT_ACCEPTANCE_FIXTURE).toMatchObject({
			version: 1,
			id: "OPENFAB_RAIL_EXIT_V1",
			bay: { templateId: "long-bay", aisleLengthMeters: 40, laneSpacingMeters: 12 },
			bypass: { templateId: "branch-bypass", trunkSpanMeters: 12, offsetMeters: 4 },
			reshapeSelected: { x: 0, y: 5 },
			reshapeTarget: { x: 3, y: 5 },
		});
		expect(Object.isFrozen(RAIL_EXIT_ACCEPTANCE_FIXTURE)).toBe(true);
		expect(Object.isFrozen(RAIL_EXIT_ACCEPTANCE_FIXTURE.bay)).toBe(true);
		expect(Object.isFrozen(RAIL_EXIT_ACCEPTANCE_FIXTURE.bypass)).toBe(true);
	});

	it("builds the same closed, clear and physically connected world every time", () => {
		const first = buildRailExitAcceptanceFixture();
		const second = buildRailExitAcceptanceFixture();
		const firstPhysical = compilePhysicalRail(first.document.map);
		const secondPhysical = compilePhysicalRail(second.document.map);
		const firstChecksum = checksumRailMap(first.document.map);
		const secondChecksum = checksumRailMap(second.document.map);
		const firstReadiness = createRailProjectReadiness(
			analyzeRailNetwork(first.document.map),
			firstPhysical,
			firstChecksum,
		);
		const secondReadiness = createRailProjectReadiness(
			analyzeRailNetwork(second.document.map),
			secondPhysical,
			secondChecksum,
		);

		expect(first.patches.map((patch) => patch.kind)).toEqual(["build", "build", "edit"]);
		expect(firstReadiness).toMatchObject({
			status: "ready",
			ready: true,
			summary: {
				closure: "closed",
				weakComponents: 1,
				strongComponents: 1,
				physicalStrongComponents: 1,
				openTerminals: 0,
				physicalOpenPaths: 0,
				clearanceIssues: 0,
			},
		});
		expect(firstChecksum).toBe(secondChecksum);
		expect(checksumRailPhysicalLayout(firstPhysical)).toBe(
			checksumRailPhysicalLayout(secondPhysical),
		);
		expect(firstReadiness.fingerprint).toBe(secondReadiness.fingerprint);
		expect({
			authored: firstChecksum,
			physical: checksumRailPhysicalLayout(firstPhysical),
			readiness: firstReadiness.fingerprint,
			cells: first.document.map.size,
			edges: first.document.map.edgeCount,
			paths: firstPhysical.paths.pathCount,
		}).toEqual({
			authored:
				"00000002:00000081:00000082:00000000:00000000:00000000:00000000:00000001:00000000:00000001:a939a593:0a0c27d3",
			physical: "4850a154:671d0662",
			readiness: "95fc18a1:04d22cf2",
			cells: 129,
			edges: 130,
			paths: 129,
		});

		const ownership = buildRailModuleOwnershipIndex(first.document.map);
		expect(ownership.modules.some((module) => module.kind === "u-turn")).toBe(true);
		expect(firstPhysical.pieces.some((piece) => piece.type === "CSC_CURVE_HOMO")).toBe(true);
		expect(ownership.modules.filter((module) => module.kind === "turnout")).toHaveLength(2);
		expect(firstPhysical.junctions.map((junction) => junction.type).sort()).toEqual([
			"BRANCH",
			"MERGE",
		]);
	});

	it("mirrors both public template commands with exact ACK identities", () => {
		const fixture = buildRailExitAcceptanceFixture();
		const mirror = new RailPatchMirror();
		let acknowledgement: ReturnType<RailPatchMirror["applyPatch"]> | null = null;
		for (const patch of fixture.patches) acknowledgement = mirror.applyPatch(patch);
		const mainPhysical = compilePhysicalRail(fixture.document.map);

		expect(acknowledgement).toMatchObject({
			sequence: fixture.document.getPatchSequence(),
			revision: fixture.document.map.getRevision(),
			checksum: checksumRailMap(fixture.document.map),
		});
		expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(mainPhysical),
		);
	});

	it("keeps template output editable through bulldoze, undo and redo", () => {
		const fixture = buildRailExitAcceptanceFixture();
		const document = fixture.document;
		const baselineChecksum = checksumRailMap(document.map);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const compound = ownership.modules.find((module) => module.kind === "u-turn");
		if (!compound) throw new Error("Expected one editable U-turn in the acceptance world.");

		const bulldoze = planRailModuleBulldoze(document.map, compound);
		expect(bulldoze.valid, bulldoze.reason).toBe(true);
		expect(document.commit(bulldoze)).toBe(true);
		expect(readinessFor(document).ready).toBe(false);
		expect(document.undo()).toBe(true);
		expect(checksumRailMap(document.map)).toBe(baselineChecksum);
		expect(readinessFor(document).ready).toBe(true);
		expect(document.redo()).toBe(true);
		expect(readinessFor(document).ready).toBe(false);
		expect(document.undo()).toBe(true);
		expect(checksumRailMap(document.map)).toBe(baselineChecksum);
	});

	it("undoes and redoes the deterministic ordinary reshape without changing its identity", () => {
		const fixture = buildRailExitAcceptanceFixture();
		const document = fixture.document;
		const reshapedChecksum = checksumRailMap(document.map);
		expect(readinessFor(document).ready).toBe(true);
		expect(document.undo()).toBe(true);
		expect(checksumRailMap(document.map)).not.toBe(reshapedChecksum);
		expect(readinessFor(document).ready).toBe(true);
		expect(document.redo()).toBe(true);
		expect(checksumRailMap(document.map)).toBe(reshapedChecksum);
		expect(readinessFor(document).ready).toBe(true);
	});
});

function readinessFor(document: ReturnType<typeof buildRailExitAcceptanceFixture>["document"]) {
	const physical = compilePhysicalRail(document.map);
	return createRailProjectReadiness(
		analyzeRailNetwork(document.map),
		physical,
		checksumRailMap(document.map),
	);
}
