import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { planRailModule } from "../core/RailModulePlanner";
import type { Cell } from "../core/TileMap";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import {
	resolveOwnershipConstructionCopyPreset,
	resolveRailConstructionCopyPreset,
} from "./RailConstructionPresetResolver";

describe("RailConstructionPresetResolver", () => {
	it.each([
		["u-turn", "compact", "CCW_CURVE"],
		["u-turn", "wide", "CSC_CURVE_HOMO"],
		["shift", "compact", "S_CURVE"],
		["shift", "wide", "CSC_CURVE_HETE"],
	] as const)("resolves %s %s compounds from compiled geometry", (moduleKind, span, pieceType) => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const plan = planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, moduleKind, span);
		expect(document.commit(plan)).toBe(true);
		const piece = compilePhysicalRail(document.map).pieces.find((item) => item.type === pieceType);

		const preset = resolveRailConstructionCopyPreset({ piece: piece ?? null });

		expect(preset).toMatchObject({
			catalogId: moduleKind,
			source: "physical-piece",
			grammar: moduleKind,
			span,
			side: plan.side,
			advancedSwitchProfile: null,
		});
		expect(preset?.sourceCells).toEqual(piece?.cells);
		expect(Object.isFrozen(preset)).toBe(true);
		expect(Object.isFrozen(preset?.sourceCells)).toBe(true);
	});

	it("resolves linear, curve, and tangent-junction selections to Smart Route grammar", () => {
		const straightDocument = new RailDocument();
		expect(
			straightDocument.commit(
				planRailConstruction(straightDocument.map, { x: 0, y: 0 }, { x: 5, y: 0 }),
			),
		).toBe(true);
		const straight = compilePhysicalRail(straightDocument.map).pieces.find(
			(piece) => piece.type === "LINEAR",
		);
		expect(resolveRailConstructionCopyPreset({ piece: straight ?? null })).toMatchObject({
			catalogId: "route",
			grammar: "straight-1-5m",
		});

		const cornerDocument = new RailDocument();
		expect(
			cornerDocument.commit(
				planRailConstruction(cornerDocument.map, { x: 0, y: 0 }, { x: 3, y: 3 }),
			),
		).toBe(true);
		const corner = compilePhysicalRail(cornerDocument.map).pieces.find(
			(piece) => piece.type === "LEFT_CURVE" || piece.type === "RIGHT_CURVE",
		);
		expect(resolveRailConstructionCopyPreset({ piece: corner ?? null })).toMatchObject({
			catalogId: "route",
			grammar: "r500-turn",
			side: corner?.turn,
		});

		const junctionDocument = new RailDocument();
		expect(
			junctionDocument.commit(
				planRailConstruction(junctionDocument.map, { x: 0, y: 0 }, { x: 6, y: 0 }),
			),
		).toBe(true);
		expect(
			junctionDocument.commit(
				planRailConstruction(junctionDocument.map, { x: 3, y: 0 }, { x: 3, y: 3 }),
			),
		).toBe(true);
		const junction = compilePhysicalRail(junctionDocument.map).junctions[0];
		expect(
			resolveRailConstructionCopyPreset({ piece: null, junction: junction ?? null }),
		).toMatchObject({
			catalogId: "route",
			grammar: "directed-branch",
			source: "junction",
		});
	});

	it("preserves advanced-switch class, chirality, and claimed footprint", () => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(document.commit(plan)).toBe(true);
		const record = document.map.getAdvancedSwitch(plan.switchRecord?.id ?? -1);
		if (!record) throw new Error("expected committed switch");

		const preset = resolveRailConstructionCopyPreset({ piece: null, advancedSwitch: record });

		expect(preset).toMatchObject({
			catalogId: "advanced-switch",
			grammar: "advanced-switch",
			advancedSwitchProfile: "C",
			side: plan.side,
			sourceId: `SW-${record.id}`,
		});
		expect(preset?.sourceCells.length).toBeGreaterThan(4);
	});

	it("does not reinterpret an isolated advanced-switch leg as ordinary route geometry", () => {
		const document = documentEndingAt({ x: -3, y: 0 });
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "A");
		expect(document.commit(plan)).toBe(true);
		const piece = compilePhysicalRail(document.map).pieces.find(
			(item) => (item.advancedSwitchId ?? 0) !== 0,
		);

		expect(resolveRailConstructionCopyPreset({ piece: piece ?? null })).toBeNull();
	});

	it("maps authored semantic ownership directly to a catalog copy preset", () => {
		const document = documentEndingAt({ x: -3, y: 0 });
		expect(
			document.commit(
				planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "wide"),
			),
		).toBe(true);
		const module = buildRailModuleOwnershipIndex(document.map).modules.find(
			(candidate) => candidate.kind === "shift",
		);
		if (!module) throw new Error("expected semantic shift module");

		const preset = resolveOwnershipConstructionCopyPreset(module);

		expect(preset).toMatchObject({
			catalogId: "shift",
			grammar: "shift",
			span: "wide",
			side: module.construction.side,
			sourceId: module.key,
		});
		expect(preset.sourceCells).toEqual(module.footprintCells);
	});
});

function documentEndingAt(from: Cell): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, from, { x: 0, y: 0 });
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}
