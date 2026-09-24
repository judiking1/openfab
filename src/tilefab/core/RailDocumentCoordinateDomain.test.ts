import { describe, expect, it, vi } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { captureOpenFabProjectFromRailSnapshot } from "../project/OpenFabProject";
import { parseOpenFabProjectJson, serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import {
	hydrateRailMirrorSnapshotDiagnosticSource,
	hydrateRailMirrorSnapshotDocument,
} from "../worker/RailMirrorSnapshotDocument";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import {
	planRailConstruction,
	planRailErase,
	planRailPath,
	type RailConstructionPlan,
} from "./paint";
import { RAIL_COORDINATE_MAX_METERS as BOUND } from "./RailCoordinateDomain";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import { TileMap } from "./TileMap";

function boundaryDocument(): RailDocument {
	const document = new RailDocument();
	expect(
		document.commit(planRailConstruction(document.map, { x: BOUND - 8, y: 0 }, { x: BOUND, y: 0 })),
	).toBe(true);
	return document;
}

function unsupportedExtension(document: RailDocument): RailConstructionPlan {
	const local = new TileMap();
	local.setEncoded(0, 0, document.map.getEncoded(BOUND, 0));
	const plan = planRailConstruction(local, { x: 0, y: 0 }, { x: 1, y: 0 });
	expect(plan.valid).toBe(true);
	return {
		...plan,
		baseRevision: document.map.getRevision(),
		cells: plan.cells.map((cell) => ({ x: cell.x + BOUND, y: cell.y })),
		mutations: plan.mutations.map((change) => ({ ...change, x: change.x + BOUND })),
	};
}

function nativeJson(map: TileMap): string {
	return serializeOpenFabProject(
		captureOpenFabProjectFromRailSnapshot(captureRailMirrorSnapshot(map, 0).snapshot, {
			manifest: {
				id: "synthetic-coordinate-boundary",
				name: "Synthetic coordinate boundary",
				createdAt: "2026-09-25T00:00:00.000Z",
				updatedAt: "2026-09-25T00:00:00.000Z",
			},
		}),
	);
}

describe("supported coordinate domain at document and transport boundaries", () => {
	it("rejects unsupported endpoints before path allocation or map reads, and keeps a finite feedback anchor", () => {
		const map = new TileMap();
		const read = vi.spyOn(map, "getEncoded").mockImplementation(() => {
			throw new Error("unexpected source read");
		});
		for (const value of [BOUND + 1, -BOUND - 1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			const plan = planRailConstruction(map, { x: 0, y: 0 }, { x: value, y: 0 });
			expect(plan.valid).toBe(false);
			expect(plan.reason).toContain("지원 범위");
			expect(plan.mutations).toHaveLength(0);
			expect(plan.cells).toHaveLength(1);
			expect(
				plan.cells.every((cell) => Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y)),
			).toBe(true);
		}
		const route = planRailPath(map, [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: BOUND + 1, y: 0 },
		]);
		expect(route.valid).toBe(false);
		expect(route.mutations).toHaveLength(0);
		expect(read).not.toHaveBeenCalled();
	});
	it("refuses even a caller-supplied valid plan and preserves history, source and mirror before a legal edit", () => {
		const document = boundaryDocument();
		const source = document.map;
		const snapshot = captureRailMirrorSnapshot(source, document.getPatchSequence()).snapshot;
		const history = document.captureRailMirrorHistoryLedger();
		const mirror = new RailPatchMirror();
		mirror.sync(snapshot, history);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => {
			events.push(event);
			mirror.applyPatch(event);
		});
		const plan = unsupportedExtension(document);
		const evaluation = new RailDraftEvaluator().evaluate(source, compilePhysicalRail(source), plan);
		expect(evaluation.valid).toBe(false);
		expect(evaluation.failureCode).toBe("compile");
		expect(evaluation.reason).toContain("지원 범위");
		expect(document.commit(plan)).toBe(false);
		expect(document.getLastCommandError()).toContain("지원 범위");
		expect(document.map).toBe(source);
		expect(document.captureRailMirrorHistoryLedger()).toEqual(history);
		expect(document.getPatchSequence()).toBe(snapshot.sequence);
		expect(document.map.getRevision()).toBe(snapshot.revision);
		expect(checksumRailMap(source)).toBe(snapshot.checksum);
		expect(events).toHaveLength(0);
		expect(mirror.state.checksum).toBe(snapshot.checksum);
		expect(document.commit(planRailErase(source, [{ x: BOUND, y: 0 }]))).toBe(true);
		expect(document.undo()).toBe(true);
		const redoHistory = document.captureRailMirrorHistoryLedger();
		expect(document.commit(unsupportedExtension(document))).toBe(false);
		expect(document.captureRailMirrorHistoryLedger()).toEqual(redoHistory);
		expect(document.redo()).toBe(true);
		expect(
			document.commit(
				planRailConstruction(document.map, { x: BOUND - 1, y: 0 }, { x: BOUND, y: 0 }),
			),
		).toBe(true);
		expect(events).toHaveLength(4);
		expect(mirror.state.checksum).toBe(snapshot.checksum);
		expect(() =>
			compileRailStartup({ kind: "project-json", json: nativeJson(document.map) }),
		).not.toThrow();
	});
	it("rejects a crossing switch footprint before draft compilation and document publication", () => {
		const document = boundaryDocument();
		const plan = planAdvancedSwitch(document.map, { x: BOUND, y: 0 }, { x: BOUND, y: 3 }, "B");
		expect(plan.valid).toBe(true);
		const evaluator = new RailDraftEvaluator();
		const result = evaluator.evaluate(document.map, compilePhysicalRail(document.map), plan);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("지원 범위");
		expect(evaluator.getStats().draftCompiles).toBe(0);
		expect(document.commit(plan)).toBe(false);
		expect(document.getLastCommandError()).toContain("지원 범위");
		expect(document.map.advancedSwitchCount).toBe(0);
	});
	it("rolls back an unsupported Worker patch and refuses activation while retaining diagnostic/raw native transport", () => {
		const document = boundaryDocument();
		const compiler = vi.fn(compilePhysicalRail);
		const mirror = new RailPatchMirror(compiler);
		mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
		compiler.mockClear();
		const state = mirror.state,
			publication = mirror.getPhysicalPublication();
		const plan = unsupportedExtension(document);
		const forged: RailPatchEvent = {
			sequence: state.sequence + 1,
			kind: "build",
			baseRevision: state.revision,
			revision: state.revision + plan.mutations.length,
			changes: plan.mutations,
			switchChanges: [],
			portChanges: [],
			equipmentGroupChanges: [],
			organizationChanges: [],
			organizationNextIdBefore: 1,
			organizationNextIdAfter: 1,
			relationshipChanges: [],
			relationshipNextIdBefore: 1,
			relationshipNextIdAfter: 1,
		};
		expect(() => mirror.applyPatch(forged)).toThrow(/지원 범위/);
		expect(compiler).not.toHaveBeenCalled();
		expect(mirror.state).toEqual(state);
		expect(mirror.getPhysicalPublication()).toBe(publication);
		expect(mirror.captureSnapshot().checksum).toBe(state.checksum);
		const invalid = document.map.clone();
		invalid.applyAtomicMutations(plan.mutations, []);
		const snapshot = captureRailMirrorSnapshot(invalid, 0).snapshot;
		const raw = hydrateRailMirrorSnapshotDiagnosticSource(snapshot);
		expect(raw.map.getUnsupportedCoordinateSourceCount()).toBe(1);
		expect(checksumRailMap(raw.map)).toBe(snapshot.checksum);
		expect(() => hydrateRailMirrorSnapshotDocument(snapshot)).toThrow(/지원 범위/);
		expect(() => RailDocument.fromLoadedMap(invalid, 0)).toThrow(/지원 범위/);
		expect(() => mirror.sync(snapshot)).toThrow(/지원 범위/);
		expect(compiler).not.toHaveBeenCalled();
		const json = nativeJson(invalid);
		expect(
			parseOpenFabProjectJson(json).project.rail.cells.some((cell) => cell[0] === BOUND + 1),
		).toBe(true);
		expect(() => compileRailStartup({ kind: "project-json", json })).toThrow(/지원 범위/);
		expect(() => compileRailStartup({ kind: "snapshot", snapshot })).toThrow(/지원 범위/);
		expect(mirror.state).toEqual(state);
		document.subscribe((event) => mirror.applyPatch(event));
		expect(document.commit(planRailErase(document.map, [{ x: BOUND, y: 0 }]))).toBe(true);
		expect(mirror.state.sequence).toBe(state.sequence + 1);
		expect(mirror.state.checksum).toBe(checksumRailMap(document.map));
	});
});
