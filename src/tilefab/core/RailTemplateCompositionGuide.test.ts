import { describe, expect, it } from "vitest";
import { RailDocument } from "./RailDocument";
import {
	defaultRailTemplateParameters,
	instantiateRailTemplate,
	planRailTemplate,
	reverseRailTemplateFlow,
	setRailTemplateParameter,
	transformRailTemplateBlueprint,
} from "./RailTemplateCatalog";
import {
	deriveRailTemplateCompositionGuide,
	isRailTemplateCompositionGuideCurrent,
	type RailTemplateCompositionId,
	resolveRailTemplateCompositionSnap,
} from "./RailTemplateCompositionGuide";
import { ALL_DIRECTIONS, DIR_E, DIR_S, DIR_W, oppositeDirection } from "./railShape";
import { encodeRailCell, TileMap } from "./TileMap";

describe("RailTemplateCompositionGuide", () => {
	it("derives whole-route reuse and every maximal straight connector from immutable blueprints", () => {
		const long = instantiateRailTemplate("long-bay", defaultRailTemplateParameters("long-bay"));
		expect(long.compositionConnectors.map((connector) => connector.kind)).toEqual([
			"route-reuse",
			"shared-trunk",
			"shared-trunk",
			"shared-trunk",
			"shared-trunk",
		]);
		expect(
			long.compositionConnectors
				.filter((connector) => connector.kind === "shared-trunk")
				.map((connector) => connector.spanMeters),
		).toEqual([24, 6, 24, 6]);

		const shift = instantiateRailTemplate("shift-bay", defaultRailTemplateParameters("shift-bay"));
		expect(shift.compositionConnectors.filter((connector) => connector.kind === "route-reuse"))
			.toHaveLength(1);
		expect(shift.compositionConnectors.filter((connector) => connector.kind === "shared-trunk"))
			.toHaveLength(6);
		for (const connector of [...long.compositionConnectors, ...shift.compositionConnectors]) {
			expect(Object.isFrozen(connector)).toBe(true);
		}
	});

	it("transforms connector geometry through every rotation and reverses only authored travel", () => {
		const blueprint = instantiateRailTemplate(
			"long-bay",
			defaultRailTemplateParameters("long-bay"),
		);
		for (const forward of ALL_DIRECTIONS) {
			const pose = { forward, side: "right", flow: "forward" } as const;
			const forwardGeometry = transformRailTemplateBlueprint(blueprint, { x: 7, y: -3 }, pose);
			const reverseGeometry = transformRailTemplateBlueprint(
				blueprint,
				{ x: 7, y: -3 },
				reverseRailTemplateFlow(pose),
			);
			expect(reverseGeometry.occupiedCells).toEqual(forwardGeometry.occupiedCells);
			expect(reverseGeometry.compositionConnectors).toHaveLength(
				forwardGeometry.compositionConnectors.length,
			);
			for (let index = 0; index < forwardGeometry.compositionConnectors.length; index++) {
				const normal = forwardGeometry.compositionConnectors[index];
				const reversed = reverseGeometry.compositionConnectors[index];
				expect(reversed?.kind).toBe(normal?.kind);
				if (normal?.kind === "shared-trunk" && reversed?.kind === "shared-trunk") {
					expect(reversed.startCell).toEqual(normal.startCell);
					expect(reversed.endCell).toEqual(normal.endCell);
					expect(reversed.travelDirection).toBe(oppositeDirection(normal.travelDirection));
				}
			}
		}
	});

	it("snaps a closed Bay onto any compatible longer directed trunk", () => {
		const document = new RailDocument();
		const pose = { forward: DIR_E, side: "right", flow: "forward" } as const;
		const outer = planRailTemplate(
			document.map,
			"outer-loop",
			{ x: 0, y: 0 },
			pose,
			defaultRailTemplateParameters("outer-loop"),
		);
		expect(outer.valid, outer.reason).toBe(true);
		expect(document.commit(outer)).toBe(true);

		const parameters = defaultRailTemplateParameters("long-bay");
		const guide = deriveRailTemplateCompositionGuide(
			document.map,
			"long-bay",
			pose,
			parameters,
		);
		expect(guide.linearRunCount).toBe(4);
		expect(guide.intervals.length).toBeGreaterThanOrEqual(1);
		expect(guide.candidateAnchorCount).toBeGreaterThan(0);
		expect(isRailTemplateCompositionGuideCurrent(document.map, guide)).toBe(true);
		const interval = guide.intervals[0];
		if (!interval) throw new Error("Expected one shared-trunk interval.");
		const supportedTarget =
			interval.geometricDirection === DIR_E || interval.geometricDirection === DIR_S
				? interval.geometricDirection === DIR_E
					? { x: interval.runMinimumCoordinate + 1, y: interval.firstTargetStart.y }
					: { x: interval.firstTargetStart.x, y: interval.runMinimumCoordinate + 1 }
				: interval.geometricDirection === DIR_W
					? { x: interval.runMaximumCoordinate - 1, y: interval.firstTargetStart.y }
					: { x: interval.firstTargetStart.x, y: interval.runMaximumCoordinate - 1 };
		const snap = resolveRailTemplateCompositionSnap(
			guide,
			{ x: supportedTarget.x + 0.5, y: supportedTarget.y + 0.5 },
			1,
		);
		expect(snap).toMatchObject({ mode: "shared-trunk", connectorId: interval.connectorId });
		if (!snap) throw new Error("Expected one shared-trunk snap.");
		const composed = planRailTemplate(document.map, "long-bay", snap.anchor, pose, parameters);
		expect(composed.valid, composed.reason).toBe(true);
		expect(composed.newEdges).toBeGreaterThan(0);
	});

	it("snaps same-size closed loops through a partial same-direction shared trunk", () => {
		const document = new RailDocument();
		const pose = { forward: DIR_E, side: "right", flow: "forward" } as const;
		const parameters = defaultRailTemplateParameters("long-bay");
		expect(
			document.commit(planRailTemplate(document.map, "long-bay", { x: 0, y: 0 }, pose, parameters)),
		).toBe(true);

		const guide = deriveRailTemplateCompositionGuide(document.map, "long-bay", pose, parameters);
		const snap = resolveRailTemplateCompositionSnap(guide, { x: 4.5, y: 0.5 }, 0.6);
		expect(snap).toMatchObject({
			mode: "shared-trunk",
			anchor: { x: 4, y: 0 },
			overlapMeters: 19,
		});
		if (!snap) throw new Error("Expected a partial shared-trunk snap.");
		const composed = planRailTemplate(document.map, "long-bay", snap.anchor, pose, parameters);
		expect(composed.valid, composed.reason).toBe(true);
		expect(composed.newEdges).toBeGreaterThan(0);
	});

	it("prefers exact parent-route reuse when adding Paired Bay child topology", () => {
		const document = new RailDocument();
		const pose = { forward: DIR_E, side: "right", flow: "forward" } as const;
		const longParameters = defaultRailTemplateParameters("long-bay");
		expect(
			document.commit(
				planRailTemplate(document.map, "long-bay", { x: 0, y: 0 }, pose, longParameters),
			),
		).toBe(true);
		let pairedParameters = defaultRailTemplateParameters("paired-bay");
		pairedParameters = setRailTemplateParameter(
			"paired-bay",
			pairedParameters,
			"aisleLengthMeters",
			24,
		);
		pairedParameters = setRailTemplateParameter(
			"paired-bay",
			pairedParameters,
			"laneSpacingMeters",
			6,
		);
		const guide = deriveRailTemplateCompositionGuide(
			document.map,
			"paired-bay",
			pose,
			pairedParameters,
		);
		expect(guide.routeReuseTargets).toHaveLength(1);
		const target = guide.routeReuseTargets[0];
		if (!target) throw new Error("Expected one route-reuse target.");
		const snap = resolveRailTemplateCompositionSnap(
			guide,
			{ x: target.handleCell.x + 0.5, y: target.handleCell.y + 0.5 },
			1,
		);
		expect(snap).toMatchObject({ mode: "route-reuse", anchor: { x: 0, y: 0 } });
		if (!snap) throw new Error("Expected route reuse to win snap priority.");
		const paired = planRailTemplate(
			document.map,
			"paired-bay",
			snap.anchor,
			pose,
			pairedParameters,
		);
		expect(paired.valid, paired.reason).toBe(true);
		expect(paired.newEdges).toBeGreaterThan(0);
	});

	it("compresses a 50k directed trunk into one run and one interval", () => {
		const map = horizontalLine(-3, 49_996);
		const guide = deriveRailTemplateCompositionGuide(
			map,
			"long-bay",
			{ forward: DIR_E, side: "right", flow: "forward" },
			defaultRailTemplateParameters("long-bay"),
		);
		expect(guide.scannedRailCellCount).toBe(50_000);
		expect(guide.linearRunCount).toBe(1);
		expect(guide.intervals).toHaveLength(1);
		expect(guide.intervals[0]).toMatchObject({
			anchorCount: 50_014,
			spanMeters: 24,
			minimumOverlapMeters: 4,
		});
		expect(guide.routeReuseTargets).toHaveLength(0);
	});

	it("rejects non-composition ids and mismatched parameter unions", () => {
		const map = horizontalLine(0, 20);
		expect(() =>
			deriveRailTemplateCompositionGuide(
				map,
				"return-loop" as unknown as RailTemplateCompositionId,
				{ forward: DIR_E, side: "right" },
				defaultRailTemplateParameters("return-loop"),
			),
		).toThrow(/not a closed composition/);
		expect(() =>
			deriveRailTemplateCompositionGuide(
				map,
				"long-bay",
				{ forward: DIR_E, side: "right" },
				defaultRailTemplateParameters("outer-loop"),
			),
		).toThrow(/do not match/);
	});
});

function horizontalLine(minX: number, maxX: number): TileMap {
	const hydrator = TileMap.createHydrator();
	for (let x = minX; x <= maxX; x++) {
		hydrator.addEncodedCell(
			x,
			0,
			encodeRailCell({
				incoming: x === minX ? 0 : oppositeDirection(DIR_E),
				outgoing: x === maxX ? 0 : DIR_E,
			}),
		);
	}
	return hydrator.finish(1);
}
