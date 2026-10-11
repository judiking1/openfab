import { describe, expect, it } from "vitest";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { planRailRouteBatch } from "../core/RailTemplateCatalog";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import { analyzePhysicalPathTopology } from "./PhysicalPathTopology";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { RailDraftEvaluator } from "./RailDraftEvaluator";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import { spineCrossoverRailRoutes } from "./SpineCrossoverRailPreset";
import {
	deriveStaticFabProjectChecksSnapshot,
	hydrateStaticFabProjectChecksSnapshot,
} from "./StaticFabProjectChecks";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
	normalizeSyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
} from "./SyntheticFabStarter";

describe("fixed synthetic spine crossover rail preset", () => {
	it("has exact closed physical topology and truthful rail-only catalog metrics", () => {
		const request = defaultSyntheticFabStarterRequest("spine-crossover");
		const build = buildSyntheticFabStarter(request);
		expect(build.summary).toMatchObject({
			railCells: 808,
			directedEdges: 820,
			physicalPaths: 832,
			junctions: 24,
			openTerminals: 0,
			strongComponents: 1,
			bayCount: 0,
			zoneCount: 0,
		});
		expect(analyzePhysicalPathTopology(build.physical.paths).strongComponents).toBe(1);
		const document = build.document;
		const readiness = createRailProjectReadiness(
			build.analysis,
			build.physical,
			build.authoredChecksum,
		);
		const source = {
			revision: document.map.getRevision(),
			sequence: document.getPatchSequence(),
			checksum: build.authoredChecksum,
			nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
			nextPortId: document.portEquipment.nextPortId,
			nextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
			nextOrganizationId: document.organizations.nextOrganizationId,
		};
		const checks = hydrateStaticFabProjectChecksSnapshot(
			deriveStaticFabProjectChecksSnapshot(
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
				build.physical,
				readiness,
				source,
			),
			source,
			readiness.fingerprint,
		);
		expect(checks.ready).toBe(true);
		expect(checks.issues).toEqual([]);
		expect(checks.summary).toMatchObject({ organizationCount: 0, equipmentGroupCount: 0 });
		expect(() => setSyntheticFabStarterParameter(request, "bayCount", 4)).toThrow();
		expect(
			normalizeSyntheticFabStarterRequest({
				...request,
				parameters: { ...request.parameters, bayCount: 4 },
			}),
		).toEqual(request);
	});

	it.each([
		0, 90,
	])("commits %i-degree geometry in one typed patch and restores exact Undo/Redo", (rotation) => {
		const document = new RailDocument();
		const mirror = new RailPatchMirror();
		mirror.sync(captureRailMirrorSnapshot(document.map, 0).snapshot);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => {
			events.push(event);
			mirror.applyPatch(decodeRailPatchSoA(encodeRailPatchEvent(event).patch));
		});
		const routes = spineCrossoverRailRoutes().map((route) =>
			route.map(({ x, y }) => (rotation === 90 ? { x: -y, y: x } : { x, y })),
		);
		const plan = planRailRouteBatch(document.map, routes, "free-closed-primary");
		const evaluation = new RailDraftEvaluator().evaluate(
			document.map,
			compilePhysicalRail(document.map),
			plan,
		);
		expect(evaluation.valid, evaluation.reason).toBe(true);
		expect(document.commit(evaluation.plan)).toBe(true);
		expect(events).toHaveLength(1);
		const checksum = () =>
			checksumRailMap(
				document.map,
				document.portEquipment,
				document.organizations,
				document.relationships,
			);
		const saved = checksum();
		expect(mirror.state.checksum).toBe(saved);
		expect(document.undo()).toBe(true);
		expect(document.map.size).toBe(0);
		expect(mirror.state.checksum).toBe(checksum());
		expect(document.redo()).toBe(true);
		expect(checksum()).toBe(saved);
		expect(mirror.state.checksum).toBe(saved);
		expect(events).toHaveLength(3);
		const project = captureOpenFabProject(document, {
			manifest: {
				id: "synthetic-spine-crossover",
				name: "Synthetic crossover",
				createdAt: "2026-10-11T00:00:00.000Z",
				updatedAt: "2026-10-11T00:00:00.000Z",
			},
		});
		expect(parseOpenFabProjectJson(serializeOpenFabProject(project)).project).toEqual(project);
	});
});
