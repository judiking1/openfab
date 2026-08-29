import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { createRailAreaSelection } from "../core/RailAreaSelection";
import {
	createRailAreaStampTemplate,
	initialRailAreaStampPose,
	planRailAreaStamp,
	rotateRailAreaStampPose,
} from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { DIR_E, DIR_N } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { analyzeGuidedBuildRailReuse } from "./GuidedBuildRailReuseEvidence";

describe("analyzeGuidedBuildRailReuse", () => {
	it("recognizes translated copies from canonical authored rail", () => {
		const document = new RailDocument();
		buildLoopAt(document, 0, 0, 8, 6);
		duplicateWholeMap(document, { x: 30, y: 12 }, 0);

		expect(analyzeGuidedBuildRailReuse(document.map)).toEqual({
			weakComponentCount: 2,
			networkLinkSupportedComponentCount: 0,
			repeatedComponentKindCount: 1,
			repeatedComponentCopyCount: 2,
		});
	});

	it("treats a rotated legal copy as the same reusable structure", () => {
		const document = new RailDocument();
		buildLoopAt(document, 0, 0, 8, 6);
		duplicateWholeMap(document, { x: 30, y: 12 }, 1);

		expect(analyzeGuidedBuildRailReuse(document.map).repeatedComponentCopyCount).toBe(2);
	});

	it("does not confuse two different closed component shapes with reuse", () => {
		const map = combineIndependentLoops([
			{ x: 0, y: 0, width: 8, height: 6 },
			{ x: 30, y: 12, width: 12, height: 6 },
		]);

		expect(analyzeGuidedBuildRailReuse(map)).toEqual({
			weakComponentCount: 2,
			networkLinkSupportedComponentCount: 0,
			repeatedComponentKindCount: 0,
			repeatedComponentCopyCount: 0,
		});
	});

	it("does not merge adjacent cells without reciprocal directed adjacency", () => {
		const map = new TileMap();
		map.setEncoded(0, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		map.setEncoded(1, 0, encodeRailCell({ incoming: DIR_N, outgoing: 0 }));

		expect(analyzeGuidedBuildRailReuse(map)).toEqual({
			weakComponentCount: 2,
			networkLinkSupportedComponentCount: 0,
			repeatedComponentKindCount: 0,
			repeatedComponentCopyCount: 0,
		});
	});

	it("recognizes the exact straight-run support needed by a later two-way network link", () => {
		const document = new RailDocument();
		buildLoopAt(document, 0, 0, 15, 7);

		expect(analyzeGuidedBuildRailReuse(document.map)).toEqual({
			weakComponentCount: 1,
			networkLinkSupportedComponentCount: 1,
			repeatedComponentKindCount: 0,
			repeatedComponentCopyCount: 0,
		});
	});
});

function duplicateWholeMap(
	document: RailDocument,
	anchor: Readonly<{ x: number; y: number }>,
	quarterTurns: 0 | 1,
): void {
	const ownership = buildRailModuleOwnershipIndex(document.map);
	const selection = createRailAreaSelection(ownership, { x: -1, y: -1 }, { x: 20, y: 20 });
	const template = createRailAreaStampTemplate(selection);
	const pose =
		quarterTurns === 0
			? initialRailAreaStampPose()
			: rotateRailAreaStampPose(initialRailAreaStampPose(), 1);
	const plan = planRailAreaStamp(document.map, template, anchor, pose);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
}

function combineIndependentLoops(
	loops: readonly Readonly<{
		x: number;
		y: number;
		width: number;
		height: number;
	}>[],
): TileMap {
	const hydrator = TileMap.createHydrator();
	for (const loop of loops) {
		const document = new RailDocument();
		buildLoopAt(document, loop.x, loop.y, loop.width, loop.height);
		document.map.forEachRail((x, y, _rail, encoded) => hydrator.addEncodedCell(x, y, encoded));
	}
	return hydrator.finish(1);
}

function buildLoopAt(
	document: RailDocument,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	for (const [from, to] of [
		[
			{ x, y },
			{ x: x + width, y },
		],
		[
			{ x: x + width, y },
			{ x: x + width, y: y + height },
		],
		[
			{ x: x + width, y: y + height },
			{ x, y: y + height },
		],
		[
			{ x, y: y + height },
			{ x, y },
		],
	] as const) {
		const plan = planRailConstruction(document.map, from, to);
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
	}
}
