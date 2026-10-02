import { describe, expect, it, vi } from "vitest";
import { RailDocument } from "../core/RailDocument";
import { createEmptyOpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import { createOpenFabProjectManifest } from "../project/OpenFabProject";
import { INITIAL_RAIL_WORKER_STATE } from "../worker/RailWorkerBridge";
import { captureOpenFabProjectSaveSource } from "./OpenFabProjectSaveSource";

function fixture() {
	const document = new RailDocument();
	const context = {
		manifest: createOpenFabProjectManifest("test-project", "Test FAB", "2026-10-02T00:00:00.000Z"),
		blueprints: createEmptyOpenFabProjectBlueprintSection(),
		blueprintGeneration: 0,
		projectGeneration: 0,
	};
	const state = {
		...INITIAL_RAIL_WORKER_STATE,
		targetSequence: document.getPatchSequence(),
		targetRevision: document.map.getRevision(),
	};
	let owned = true;
	const receipt = captureOpenFabProjectSaveSource(
		document,
		{ getState: () => state },
		{ ...context },
		() => context,
		() => owned,
	);
	return {
		document,
		context,
		state,
		receipt,
		replace: () => {
			owned = false;
		},
	};
}

describe("project saved-source receipt", () => {
	it("remains valid after save metadata and an unrelated mirror restart", () => {
		const f = fixture();
		f.context.manifest = { ...f.context.manifest, updatedAt: "2026-10-02T01:00:00.000Z" };
		f.state.epoch += 1;
		expect(f.receipt.isCurrent()).toBe(true);
		expect(f.receipt.isMirrorCurrent()).toBe(false);
	});
	it("pins the document without retaining operation ownership", () => {
		const f = fixture();
		f.replace();
		expect(f.receipt.isProjectCurrent()).toBe(false);
		expect(f.receipt.isCurrent()).toBe(false);
	});
	it("rejects rail rollback ABA despite identical revision and sequence", () => {
		const f = fixture();
		const checkpoint = f.document.map.createMutationCheckpoint();
		const mutation = { x: 100, y: 100, before: 0, after: 0x11 };
		f.document.map.applyAtomicMutations([mutation], []);
		f.document.map.rollbackAtomicMutations([mutation], [], checkpoint);
		expect(f.document.map.getRevision()).toBe(f.state.targetRevision);
		expect(f.document.getPatchSequence()).toBe(f.state.targetSequence);
		expect(f.receipt.isProjectCurrent()).toBe(true);
		expect(f.receipt.isCurrent()).toBe(false);
	});
	it("rejects blueprint A-to-B-to-A even when the same section object is restored", () => {
		const f = fixture();
		const initial = f.context.blueprints;
		f.context.blueprints = createEmptyOpenFabProjectBlueprintSection();
		f.context.blueprintGeneration += 1;
		f.context.blueprints = initial;
		f.context.blueprintGeneration += 1;
		expect(f.receipt.isProjectCurrent()).toBe(true);
		expect(f.receipt.isCurrent()).toBe(false);
	});
	it("rejects a replacement project even when identity and authored objects were reused", () => {
		const f = fixture();
		f.context.projectGeneration += 2;
		expect(f.receipt.isProjectCurrent()).toBe(false);
		expect(f.receipt.isCurrent()).toBe(false);
	});
	it.each(["id", "name", "createdAt"] as const)("rejects changed project %s", (key) => {
		const f = fixture();
		f.context.manifest = { ...f.context.manifest, [key]: "changed" };
		expect(f.receipt.isProjectCurrent()).toBe(false);
	});
	it.each([
		"portEquipment",
		"organizations",
		"relationships",
		"operationalConfiguration",
	] as const)("pins %s while close is pending", (key) => {
		const f = fixture();
		vi.spyOn(f.document, key, "get").mockReturnValue({ ...f.document[key] });
		expect(f.receipt.isProjectCurrent()).toBe(true);
		expect(f.receipt.isCurrent()).toBe(false);
	});
	it.each([
		"epoch",
		"targetSequence",
		"targetRevision",
	] as const)("rejects changed precommit mirror %s", (key) => {
		const f = fixture();
		f.state[key] += 1;
		expect(f.receipt.isMirrorCurrent()).toBe(false);
	});
});
