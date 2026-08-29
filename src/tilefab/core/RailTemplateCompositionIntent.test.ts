import { describe, expect, it, vi } from "vitest";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
	type RailTemplateParameters,
	type RailTemplatePose,
	setRailTemplateParameter,
} from "./RailTemplateCatalog";
import {
	deriveRailTemplateCompositionIntentIndex,
	isRailTemplateCompositionIntentIndexCurrent,
	resolveRailTemplateCompositionFocus,
	resolveRailTemplateCompositionIntentFromIndex,
} from "./RailTemplateCompositionIntent";
import {
	AUTO_RAIL_TEMPLATE_POSE_LOCK,
	LOCKED_RAIL_TEMPLATE_POSE,
	lockRailTemplatePoseAxis,
} from "./RailTemplatePoseSearch";
import { DIR_S } from "./railShape";

describe("RailTemplateCompositionIntent", () => {
	it("indexes every pose over one map scan and resolves a legal rotated composition", () => {
		const parentPose = Object.freeze({
			forward: DIR_S,
			side: "left",
			flow: "reverse",
		}) satisfies RailTemplatePose;
		const document = longBay(parentPose);
		const forEachRail = vi.spyOn(document.map, "forEachRail");
		const parameters = pairedParametersForParent();
		const index = deriveRailTemplateCompositionIntentIndex(
			document.map,
			"paired-bay",
			initialRailTemplatePose(),
			parameters,
		);
		expect(index.entries).toHaveLength(16);
		expect(index.scannedRailCellCount).toBeGreaterThan(0);
		expect(forEachRail).toHaveBeenCalledTimes(1);

		const reusable = index.entries.find((entry) => entry.guide.routeReuseTargets.length > 0);
		const target = reusable?.guide.routeReuseTargets[0];
		if (!reusable || !target) throw new Error("Expected a rotated route-reuse candidate.");
		const resolved = resolveRailTemplateCompositionFocus(
			document.map,
			index,
			{ x: target.handleCell.x + 0.5, y: target.handleCell.y + 0.5 },
			1,
		);
		expect(resolved?.focusSnap?.distanceMeters).toBe(0);
		if (!resolved?.focusSnap) throw new Error("Expected a focused composition snap.");
		const plan = planRailTemplate(
			document.map,
			"paired-bay",
			resolved.focusSnap.anchor,
			resolved.pose,
			parameters,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.newEdges).toBeGreaterThan(0);
		expect(forEachRail).toHaveBeenCalledTimes(1);
	});

	it("prunes composition entries by independent pose locks", () => {
		const document = longBay(initialRailTemplatePose());
		const parameters = defaultRailTemplateParameters("long-bay");
		const preferred = initialRailTemplatePose();
		const sideLocked = deriveRailTemplateCompositionIntentIndex(
			document.map,
			"long-bay",
			preferred,
			parameters,
			lockRailTemplatePoseAxis(AUTO_RAIL_TEMPLATE_POSE_LOCK, "side"),
		);
		expect(sideLocked.entries).toHaveLength(8);
		expect(sideLocked.entries.every((entry) => entry.pose.side === preferred.side)).toBe(true);

		const fullyLocked = deriveRailTemplateCompositionIntentIndex(
			document.map,
			"long-bay",
			preferred,
			parameters,
			LOCKED_RAIL_TEMPLATE_POSE,
		);
		expect(fullyLocked.entries).toHaveLength(1);
		expect(fullyLocked.entries[0]?.pose).toEqual(preferred);
	});

	it("skips an overlapping nearest anchor and resolves the next legal composition anchor", () => {
		const document = longBay(initialRailTemplatePose());
		const parameters = defaultRailTemplateParameters("long-bay");
		const index = deriveRailTemplateCompositionIntentIndex(
			document.map,
			"long-bay",
			initialRailTemplatePose(),
			parameters,
		);

		const resolved = resolveRailTemplateCompositionFocus(
			document.map,
			index,
			{ x: 24.5, y: 0.5 },
			2.25,
		);
		expect(resolved?.focusSnap).not.toBeNull();
		if (!resolved?.focusSnap) throw new Error("Expected a legal neighboring composition anchor.");
		const plan = planRailTemplate(
			document.map,
			"long-bay",
			resolved.focusSnap.anchor,
			resolved.pose,
			parameters,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.newEdges).toBeGreaterThan(0);
	});

	it("returns unavailable on an empty map and rejects a stale index at the app boundary", () => {
		const document = new RailDocument();
		const index = deriveRailTemplateCompositionIntentIndex(
			document.map,
			"long-bay",
			initialRailTemplatePose(),
			defaultRailTemplateParameters("long-bay"),
		);
		expect(resolveRailTemplateCompositionIntentFromIndex(document.map, index)).toEqual({
			status: "unavailable",
			baseRevision: document.map.getRevision(),
			pose: null,
			guide: null,
			focusSnap: null,
		});
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		expect(isRailTemplateCompositionIntentIndexCurrent(document.map, index)).toBe(false);
		expect(resolveRailTemplateCompositionIntentFromIndex(document.map, index).status).toBe(
			"unavailable",
		);
	});
});

function longBay(pose: RailTemplatePose): RailDocument {
	const document = new RailDocument();
	const plan = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		pose,
		defaultRailTemplateParameters("long-bay"),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function pairedParametersForParent(): RailTemplateParameters {
	let parameters = defaultRailTemplateParameters("paired-bay");
	parameters = setRailTemplateParameter("paired-bay", parameters, "aisleLengthMeters", 24);
	parameters = setRailTemplateParameter("paired-bay", parameters, "laneSpacingMeters", 6);
	return parameters;
}
