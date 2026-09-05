import { describe, expect, it } from "vitest";
import { planRailConstruction } from "./paint";
import {
	planCatalogRailConstruction,
	RAIL_CONSTRUCTION_CATALOG,
	type RailConstructionGrammar,
	railConstructionApplicability,
	railConstructionCatalogItem,
} from "./RailConstructionCatalog";
import { RailDocument } from "./RailDocument";

describe("RailConstructionCatalog", () => {
	it("owns every Phase 1.3 modular grammar without duplicate catalog ids", () => {
		expect(Object.isFrozen(RAIL_CONSTRUCTION_CATALOG)).toBe(true);
		expect(new Set(RAIL_CONSTRUCTION_CATALOG.map((item) => item.id)).size).toBe(
			RAIL_CONSTRUCTION_CATALOG.length,
		);
		const grammar = new Set(
			RAIL_CONSTRUCTION_CATALOG.flatMap((item) => {
				expect(Object.isFrozen(item)).toBe(true);
				expect(Object.isFrozen(item.controls)).toBe(true);
				expect(Object.isFrozen(item.grammar)).toBe(true);
				return item.grammar;
			}),
		);
		expect(grammar).toEqual(
			new Set<RailConstructionGrammar>([
				"straight-1-5m",
				"r500-turn",
				"directed-branch",
				"directed-merge",
				"network-link",
				"u-turn",
				"shift",
				"advanced-switch",
			]),
		);
	});

	it("declares only the controls used by each planner", () => {
		expect(railConstructionCatalogItem("route").controls).toEqual(["bend"]);
		expect(railConstructionCatalogItem("network-link").controls).toEqual(["side"]);
		expect(railConstructionCatalogItem("u-turn").controls).toEqual(["span", "side"]);
		expect(railConstructionCatalogItem("shift").controls).toEqual(["span", "side"]);
		expect(railConstructionCatalogItem("advanced-switch").controls).toEqual([
			"switch-profile",
			"side",
		]);
	});

	it("reports open-terminal applicability independently from the UI", () => {
		const document = new RailDocument();
		expect(railConstructionApplicability(document.map, "route", null)).toMatchObject({
			state: "ready",
			ready: true,
		});
		expect(railConstructionApplicability(document.map, "network-link", null)).toMatchObject({
			state: "anchor-required",
			ready: false,
		});
		expect(railConstructionApplicability(document.map, "u-turn", null)).toMatchObject({
			state: "anchor-required",
			ready: false,
		});
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		expect(railConstructionApplicability(document.map, "route", null)).toMatchObject({
			state: "ready",
			ready: true,
			reason: "기존 열린 끝 또는 다른 빈 곳에서 새 경로를 시작할 수 있습니다",
		});
		expect(
			railConstructionApplicability(document.map, "advanced-switch", { x: 0, y: 0 }),
		).toMatchObject({ state: "ready", ready: true });
		expect(railConstructionApplicability(document.map, "shift", { x: -1, y: 0 })).toMatchObject({
			state: "invalid-anchor",
			ready: false,
		});
	});

	it("does not analyze an unrelated anchor merely to paint the Network Link catalog badge", () => {
		const unreadableMap = new Proxy(
			{},
			{
				get() {
					throw new Error("catalog applicability touched the rail map");
				},
			},
		) as Parameters<typeof railConstructionApplicability>[0];

		expect(
			railConstructionApplicability(unreadableMap, "network-link", { x: 4, y: 7 }, null),
		).toMatchObject({
			state: "invalid-anchor",
			ready: false,
		});
	});

	it("dispatches route, fixed compound, and advanced switch plans from one catalog boundary", () => {
		const empty = new RailDocument();
		const route = planCatalogRailConstruction(empty.map, { x: -3, y: 0 }, { x: 0, y: 0 }, "route", {
			bend: "auto",
			span: "compact",
			advancedSwitchProfile: "A",
		});
		expect(route.valid, route.reason).toBe(true);
		expect("moduleKind" in route).toBe(false);
		expect(empty.commit(route)).toBe(true);

		const uTurn = planCatalogRailConstruction(empty.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "u-turn", {
			bend: "auto",
			span: "wide",
			advancedSwitchProfile: "A",
		});
		expect(uTurn.valid, uTurn.reason).toBe(true);
		expect("moduleKind" in uTurn && uTurn.moduleKind).toBe("u-turn");

		const switchDocument = new RailDocument();
		expect(
			switchDocument.commit(
				planRailConstruction(switchDocument.map, { x: -3, y: 0 }, { x: 0, y: 0 }),
			),
		).toBe(true);
		const advancedSwitch = planCatalogRailConstruction(
			switchDocument.map,
			{ x: 0, y: 0 },
			{ x: 0, y: 3 },
			"advanced-switch",
			{ bend: "auto", span: "compact", advancedSwitchProfile: "C" },
		);
		expect(advancedSwitch.valid, advancedSwitch.reason).toBe(true);
		expect("moduleKind" in advancedSwitch && advancedSwitch.moduleKind).toBe("advanced-switch");
		expect("profileClass" in advancedSwitch && advancedSwitch.profileClass).toBe("C");
	});

	it("forwards a copied chirality default through the catalog boundary", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);

		const uTurn = planCatalogRailConstruction(
			document.map,
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			"u-turn",
			{
				bend: "auto",
				span: "compact",
				advancedSwitchProfile: "A",
				preferredSide: "left",
			},
		);

		expect(uTurn.valid, uTurn.reason).toBe(true);
		expect("side" in uTurn && uTurn.side).toBe("left");
	});

	it("keeps an explicit side command authoritative over pointer position", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);

		const plan = planCatalogRailConstruction(
			document.map,
			{ x: 0, y: 0 },
			{ x: 0, y: 3 },
			"u-turn",
			{
				bend: "auto",
				span: "compact",
				advancedSwitchProfile: "A",
				explicitSide: "left",
			},
		);

		expect(plan.valid, plan.reason).toBe(true);
		expect("side" in plan && plan.side).toBe("left");

		const advanced = planCatalogRailConstruction(
			document.map,
			{ x: 0, y: 0 },
			{ x: 0, y: 3 },
			"advanced-switch",
			{
				bend: "auto",
				span: "compact",
				advancedSwitchProfile: "B",
				explicitSide: "left",
			},
		);
		expect(advanced.valid, advanced.reason).toBe(true);
		expect("side" in advanced && advanced.side).toBe("left");
	});
});
