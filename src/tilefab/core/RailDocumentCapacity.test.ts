import { expect, it, vi } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { assertPortSlotCapacity } from "../compile/PortSlotCompiler";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import { captureOpenFabProject } from "../project/OpenFabProject";
import { serializeOpenFabProject } from "../project/OpenFabProjectCodec";
import { captureRailMirrorSnapshot, checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { PORT_SLOT_MAX_ROWS } from "./PortSlotPolicy";
import { planRailConstruction, planRailErase } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import { railSourceCounts } from "./RailSourceCapacity";

function projectJson(document: RailDocument): string {
	return serializeOpenFabProject(
		captureOpenFabProject(document, {
			manifest: {
				id: "synthetic-capacity-boundary",
				name: "Synthetic capacity boundary",
				createdAt: "2026-09-24T15:00:00.000Z",
				updatedAt: "2026-09-24T15:00:00.000Z",
			},
			view: {
				center: [0, 0],
				zoomPixelsPerMeter: 38,
				quarterTurns: 0,
				railPresentation: "profiled",
			},
		}),
	);
}

function boundaryDocument(): RailDocument {
	const document = new RailDocument();
	expect(
		document.commit(
			planRailConstruction(document.map, { x: 0, y: 0 }, { x: PORT_SLOT_MAX_ROWS / 2 + 1, y: 0 }),
		),
	).toBe(true);
	return document;
}

it("refuses a one-cell extension before preview/publication and preserves native reopen, history and mirror", () => {
	const document = boundaryDocument();
	const source = document.map;
	const layout = compilePhysicalRail(source);
	expect(layout.valid).toBe(true);
	expect(() => assertPortSlotCapacity(layout)).not.toThrow();
	expect(() =>
		compileRailStartup({ kind: "project-json", json: projectJson(document) }),
	).not.toThrow();
	const end = PORT_SLOT_MAX_ROWS / 2 + 1;
	const snapshot = captureRailMirrorSnapshot(source, document.getPatchSequence()).snapshot;
	const history = document.captureRailMirrorHistoryLedger();
	const mirror = new RailPatchMirror();
	mirror.sync(snapshot, history);
	const beforeMirror = mirror.state;
	const beforePhysical = mirror.getPhysicalPublication();
	const events: RailPatchEvent[] = [];
	document.subscribe((event) => {
		events.push(event);
		mirror.applyPatch(event);
	});
	const plan = planRailConstruction(source, { x: end, y: 0 }, { x: end + 1, y: 0 });
	expect(plan.valid).toBe(true);
	const evaluation = new RailDraftEvaluator().evaluate(source, layout, plan);
	expect(evaluation.valid).toBe(false);
	expect(evaluation.failureCode).toBe("compile");
	expect(evaluation.reason).toContain("204,098");
	expect(document.commit(plan)).toBe(false);
	expect(document.getLastCommandError()).toContain("204,098");
	expect(document.map).toBe(source);
	expect(document.map.getRevision()).toBe(snapshot.revision);
	expect(checksumRailMap(document.map)).toBe(snapshot.checksum);
	expect(document.getPatchSequence()).toBe(snapshot.sequence);
	expect(document.captureRailMirrorHistoryLedger()).toEqual(history);
	expect(document.canUndo).toBe(true);
	expect(document.canRedo).toBe(false);
	expect(events).toHaveLength(0);
	expect(mirror.state).toEqual(beforeMirror);
	expect(mirror.getPhysicalPublication()).toBe(beforePhysical);
	// Removing the terminal frees one LINEAR row pair; undo/redo restore exact capacity safely.
	expect(document.commit(planRailErase(document.map, [{ x: end, y: 0 }]))).toBe(true);
	const reduced = checksumRailMap(document.map);
	expect(document.undo()).toBe(true);
	expect(checksumRailMap(document.map)).toBe(snapshot.checksum);
	const redoHistory = document.captureRailMirrorHistoryLedger();
	expect(
		document.commit(planRailConstruction(document.map, { x: end, y: 0 }, { x: end + 1, y: 0 })),
	).toBe(false);
	expect(document.captureRailMirrorHistoryLedger()).toEqual(redoHistory);
	expect(document.redo()).toBe(true);
	expect(checksumRailMap(document.map)).toBe(reduced);
	expect(
		document.commit(planRailConstruction(document.map, { x: end - 1, y: 0 }, { x: end, y: 0 })),
	).toBe(true);
	expect(checksumRailMap(document.map)).toBe(snapshot.checksum);
	expect(mirror.state.checksum).toBe(snapshot.checksum);
	expect(events).toHaveLength(4);
	expect(() =>
		compileRailStartup({ kind: "project-json", json: projectJson(document) }),
	).not.toThrow();
});

it("rejects an over-capacity Worker patch/snapshot, rolls back counts and accepts the next legal patch", () => {
	const document = boundaryDocument();
	const end = PORT_SLOT_MAX_ROWS / 2 + 1;
	const compiler = vi.fn(compilePhysicalRail);
	const mirror = new RailPatchMirror(compiler);
	mirror.sync(captureRailMirrorSnapshot(document.map, document.getPatchSequence()).snapshot);
	compiler.mockClear();
	const state = mirror.state;
	const publication = mirror.getPhysicalPublication();
	const plan = planRailConstruction(document.map, { x: end, y: 0 }, { x: end + 1, y: 0 });
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
	expect(() => mirror.applyPatch(forged)).toThrow(/204,098/);
	expect(compiler).not.toHaveBeenCalled();
	expect(mirror.state).toEqual(state);
	expect(mirror.getPhysicalPublication()).toBe(publication);
	expect(mirror.captureSnapshot().checksum).toBe(state.checksum);
	const invalid = document.map.clone();
	invalid.applyAtomicMutations(plan.mutations, []);
	expect(railSourceCounts(invalid).cardinalLinearSources).toBe(PORT_SLOT_MAX_ROWS / 2 + 1);
	expect(() => RailDocument.fromLoadedMap(invalid, 0)).toThrow(/204,098/);
	expect(() =>
		mirror.sync(captureRailMirrorSnapshot(invalid, state.sequence + 1).snapshot),
	).toThrow(/204,098/);
	expect(compiler).not.toHaveBeenCalled();
	expect(mirror.state).toEqual(state);
	document.subscribe((event) => mirror.applyPatch(event));
	expect(document.commit(planRailErase(document.map, [{ x: end, y: 0 }]))).toBe(true);
	expect(
		document.commit(planRailConstruction(document.map, { x: end - 1, y: 0 }, { x: end, y: 0 })),
	).toBe(true);
	expect(mirror.state.checksum).toBe(state.checksum);
	expect(mirror.state.sequence).toBe(state.sequence + 2);
});
