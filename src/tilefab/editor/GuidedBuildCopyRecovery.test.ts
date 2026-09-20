import { describe, expect, it, vi } from "vitest";
import { DIR_E, DIR_W } from "../core/railShape";
import type { StaticFabBlueprintTemplate } from "../core/StaticFabBlueprint";
import {
	captureGuidedBuildCopySource,
	completeGuidedBuildCopy,
	type GuidedBuildCopyRecoveryContext,
	GuidedBuildCopyUndo,
	guidedBuildCopyRecoveryPhase,
} from "./GuidedBuildCopyRecovery";

function selection(eqPorts = 3): StaticFabBlueprintTemplate {
	return {
		rail: {
			sourceRevision: 1,
			sourceModuleCount: 15,
			sourceEdgeCount: 15,
			sourceModuleKeys: Array.from({ length: 15 }, (_, x) => String(x)),
			sourceWidthMeters: 15,
			sourceHeightMeters: 0,
			edges: Array.from({ length: 15 }, (_, x) => ({ from: { x, y: 0 }, to: { x: x + 1, y: 0 } })),
		},
		equipmentGroups: [
			{ kind: "OHB", template: "SINGLE", portIndices: [0] },
			{
				kind: "EQ",
				recipe: null,
				pitchMillimeters: 1000,
				portIndices: Array.from({ length: eqPorts }, (_, index) => index + 1),
			},
			{ kind: "STK", template: "FLEX", portIndices: [eqPorts + 1, eqPorts + 2] },
		],
		ports: (
			["OHB", ...Array.from({ length: eqPorts }, () => "EQ" as const), "STK", "STK"] as const
		).map((portType, x) => ({
			equipmentGroupIndex: x === 0 ? 0 : x <= eqPorts ? 1 : 2,
			portType,
			route: { kind: "CARDINAL_CELL", x, z: 0, from: DIR_W, to: DIR_E },
			stationMillimeters: 500,
			side: "RIGHT",
			lateralOffsetMillimeters: 1000,
			direction: "WITH_TRAVEL",
		})),
	};
}

const source = { document: {}, patchSequence: 7, checksum: "original" };
const receipt = completeGuidedBuildCopy(source, { ...source, patchSequence: 8 });
if (!receipt) throw new Error("Expected one committed copy receipt");
const live: GuidedBuildCopyRecoveryContext = {
	document: source.document,
	patchSequence: 8,
	checksum: "copy",
	settled: true,
	reuseComplete: false,
	canUndo: true,
	commandsAvailable: true,
};

describe("GuidedBuildCopyRecovery", () => {
	it("captures only the current reuse exercise and its actual equipped selection", () => {
		const context = {
			guided: true,
			missionId: "reuse-loop",
			origin: "selection-copy",
			settled: true,
			template: selection(),
		};
		expect(captureGuidedBuildCopySource(source, context)).toEqual(source);
		expect(captureGuidedBuildCopySource(source, { ...context, template: selection(2) })).toEqual(
			source,
		);
		expect(captureGuidedBuildCopySource(source, { ...context, template: selection(1) })).toBeNull();
		for (const change of [
			{ guided: false },
			{ missionId: "ports" },
			{ origin: "recent" },
			{ settled: false },
			{ template: undefined },
		]) {
			expect(captureGuidedBuildCopySource(source, { ...context, ...change })).toBeNull();
		}
		for (const kind of ["OHB", "EQ", "STK"]) {
			const template = selection();
			expect(
				captureGuidedBuildCopySource(source, {
					...context,
					template: {
						...template,
						equipmentGroups: template.equipmentGroups.filter((group) => group.kind !== kind),
					},
				}),
			).toBeNull();
		}
		const template = selection();
		expect(
			captureGuidedBuildCopySource(source, {
				...context,
				template: { ...template, ports: template.ports.slice(0, 5) },
			}),
		).toBeNull();
	});

	it("binds exactly one successful sequence advance in the same document", () => {
		expect(completeGuidedBuildCopy(source, source)).toBeNull();
		expect(completeGuidedBuildCopy(source, { ...source, patchSequence: 9 })).toBeNull();
		expect(completeGuidedBuildCopy(source, { document: {}, patchSequence: 8 })).toBeNull();
		expect(completeGuidedBuildCopy(null, live)).toBeNull();
		expect(Object.isFrozen(receipt)).toBe(true);
	});

	it("waits for current model/mirror evidence and leaves a separate copy on its normal path", () => {
		expect(guidedBuildCopyRecoveryPhase(receipt, { ...live, settled: false })).toBe("waiting");
		expect(guidedBuildCopyRecoveryPhase(receipt, live)).toBe("choice");
		expect(guidedBuildCopyRecoveryPhase(receipt, { ...live, reuseComplete: true })).toBeNull();
	});

	it("revokes authority after intervening edits, Undo/Redo ABA or document replacement", async () => {
		const controller = new GuidedBuildCopyUndo();
		const undo = vi.fn(async () => true);
		for (const changed of [
			{ ...live, patchSequence: 9 },
			{ ...live, patchSequence: 10 },
			{ ...live, document: {} },
		]) {
			expect(guidedBuildCopyRecoveryPhase(receipt, changed)).toBeNull();
			expect(await controller.retry(receipt, () => changed, undo)).toBe("unavailable");
		}
		expect(undo).not.toHaveBeenCalled();
	});

	it("claims an async retry once and checks the resulting source before reporting restoration", async () => {
		const controller = new GuidedBuildCopyUndo();
		let current = live;
		let finish: (value: boolean) => void = () => {};
		const undo = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					finish = resolve;
				}),
		);
		const first = controller.retry(receipt, () => current, undo);
		expect(await controller.retry(receipt, () => current, undo)).toBe("unavailable");
		expect(undo).toHaveBeenCalledTimes(1);
		current = { ...live, patchSequence: 9, checksum: source.checksum };
		finish(true);
		expect(await first).toBe("restored");
	});

	it("releases refused or failed attempts so the user can retry without losing the receipt", async () => {
		const controller = new GuidedBuildCopyUndo();
		expect(
			await controller.retry(
				receipt,
				() => live,
				async () => false,
			),
		).toBe("refused");
		await expect(
			controller.retry(
				receipt,
				() => live,
				async () => {
					throw new Error("busy");
				},
			),
		).rejects.toThrow("busy");
		expect(
			await controller.retry(
				receipt,
				() => live,
				async () => false,
			),
		).toBe("refused");
	});

	it("rejects unavailable commands and suppresses stale post-await restoration", async () => {
		const controller = new GuidedBuildCopyUndo();
		const undo = vi.fn(async () => true);
		for (const changed of [
			{ ...live, canUndo: false },
			{ ...live, commandsAvailable: false },
			{ ...live, settled: false },
		]) {
			expect(await controller.retry(receipt, () => changed, undo)).toBe("unavailable");
		}
		expect(undo).not.toHaveBeenCalled();
		for (const changed of [
			{ ...live, document: {}, patchSequence: 9 },
			{ ...live, patchSequence: 10 },
			{ ...live, patchSequence: 9, checksum: "different" },
		]) {
			let current = live;
			expect(
				await controller.retry(
					receipt,
					() => current,
					async () => {
						current = changed;
						return true;
					},
				),
			).toBe("stale");
		}
	});
});
