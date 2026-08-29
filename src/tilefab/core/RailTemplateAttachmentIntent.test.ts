import { describe, expect, it, vi } from "vitest";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import type { RailTemplateAttachmentParameters } from "./RailTemplateAttachmentGuide";
import {
	deriveRailTemplateAttachmentIntentIndex,
	type ResolvedRailTemplateAttachmentIntent,
	resolveRailTemplateAttachmentFocus,
	resolveRailTemplateAttachmentIntent,
	resolveRailTemplateAttachmentIntentFromIndex,
} from "./RailTemplateAttachmentIntent";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
	type RailTemplatePose,
	railTemplateTravelDirection,
} from "./RailTemplateCatalog";
import {
	AUTO_RAIL_TEMPLATE_POSE_LOCK,
	LOCKED_RAIL_TEMPLATE_POSE,
	lockRailTemplatePoseAxis,
} from "./RailTemplatePoseSearch";
import { DIR_E, DIR_S, DIR_W, type Direction, moveCell, oppositeDirection } from "./railShape";
import { TileMap } from "./TileMap";

describe("RailTemplateAttachmentIntent", () => {
	it("discovers a valid default Outerbay pose on a default Long Bay", () => {
		const document = defaultLongBay();
		const resolution = resolveRailTemplateAttachmentIntent(
			document.map,
			"outerbay-link",
			initialRailTemplatePose(),
			attachmentParameters("outerbay-link"),
		);
		const resolved = requireResolved(resolution);

		expect(resolved).toMatchObject({
			baseRevision: document.map.getRevision(),
			pose: { forward: DIR_E, side: "left", flow: "forward" },
			focusSnap: null,
		});
		expect(resolved.guide.pose).toBe(resolved.pose);
		expect(resolved.guide.compatibleAnchorCount).toBeGreaterThan(0);
		const interval = resolved.guide.intervals.find(({ status }) => status === "compatible");
		if (!interval) throw new Error("Expected a compatible default Outerbay interval.");
		const plan = planRailTemplate(
			document.map,
			"outerbay-link",
			interval.startAnchor,
			resolved.pose,
			resolved.guide.parameters,
		);
		expect(plan.valid, plan.reason).toBe(true);
	});

	it("uses focus proximity to choose the top or bottom Long Bay trunk", () => {
		const document = defaultLongBay();
		const parameters = attachmentParameters("outerbay-link");
		const preferredPose = initialRailTemplatePose();
		const top = requireResolved(
			resolveRailTemplateAttachmentIntent(
				document.map,
				"outerbay-link",
				preferredPose,
				parameters,
				{
					x: 12.5,
					y: 0.5,
				},
			),
		);
		const bottom = requireResolved(
			resolveRailTemplateAttachmentIntent(
				document.map,
				"outerbay-link",
				preferredPose,
				parameters,
				{
					x: 12.5,
					y: 6.5,
				},
			),
		);

		expect(top.pose).toMatchObject({ side: "left", flow: "forward" });
		expect(top.focusSnap?.anchor.y).toBe(0);
		expect(bottom.pose).toMatchObject({ side: "right", flow: "reverse" });
		expect(bottom.focusSnap?.anchor.y).toBe(6);
	});

	it("uses the closest focused axis even when the preferred axis has distant candidates", () => {
		const document = defaultOuterLoop();
		const resolution = requireResolved(
			resolveRailTemplateAttachmentIntent(
				document.map,
				"attached-return",
				initialRailTemplatePose(),
				attachmentParameters("attached-return"),
				{ x: 80.5, y: 12.5 },
			),
		);

		expect(railTemplateTravelDirection(resolution.pose)).toBe(DIR_S);
		expect(resolution.focusSnap?.anchor.x).toBe(80);
		expect(resolution.focusSnap?.distanceMeters).toBe(0);
	});

	it("reuses indexed interval guides across pointer focuses without rescanning the map", () => {
		const document = defaultOuterLoop();
		const forEachRail = vi.spyOn(document.map, "forEachRail");
		const index = deriveRailTemplateAttachmentIntentIndex(
			document.map,
			"attached-return",
			initialRailTemplatePose(),
			attachmentParameters("attached-return"),
		);
		const scanCount = forEachRail.mock.calls.length;
		expect(scanCount).toBe(1);

		const right = resolveRailTemplateAttachmentFocus(index, { x: 80.5, y: 12.5 }, 2.25);
		const top = resolveRailTemplateAttachmentFocus(index, { x: 20.5, y: 0.5 }, 2.25);
		const fallback = requireResolved(resolveRailTemplateAttachmentIntentFromIndex(index));

		expect(right?.focusSnap?.anchor.x).toBe(80);
		expect(railTemplateTravelDirection(right?.pose ?? initialRailTemplatePose())).toBe(DIR_S);
		expect(top?.focusSnap?.anchor.y).toBe(0);
		expect(fallback.guide.compatibleAnchorCount).toBeGreaterThan(0);
		expect(forEachRail).toHaveBeenCalledTimes(scanCount);
		expect(Object.isFrozen(index)).toBe(true);
		expect(Object.isFrozen(index.entries)).toBe(true);
	});

	it("does not resolve an indexed focus outside the active snap radius", () => {
		const document = defaultOuterLoop();
		const index = deriveRailTemplateAttachmentIntentIndex(
			document.map,
			"attached-return",
			initialRailTemplatePose(),
			attachmentParameters("attached-return"),
		);

		expect(resolveRailTemplateAttachmentFocus(index, { x: 40.5, y: 40.5 }, 0.5)).toBeNull();
	});

	it("skips a rejected nearest placement and returns the next focused attachment candidate", () => {
		const document = directedTrunk(DIR_E, 30);
		const index = deriveRailTemplateAttachmentIntentIndex(
			document.map,
			"branch-bypass",
			initialRailTemplatePose(),
			attachmentParameters("branch-bypass"),
		);
		const visited: number[] = [];
		const resolution = resolveRailTemplateAttachmentFocus(
			index,
			{ x: 10.5, y: 0.5 },
			2,
			(candidate) => {
				const x = candidate.focusSnap?.anchor.x ?? Number.NaN;
				visited.push(x);
				return candidate.focusSnap?.handleRole === "branch" && x === 9;
			},
		);

		expect(visited[0]).toBe(10);
		expect(visited.at(-1)).toBe(9);
		expect(resolution?.focusSnap?.anchor).toEqual({ x: 9, y: 0 });
	});

	it("reverses flow without rotating geometry when the trunk runs backward", () => {
		const document = directedTrunk(DIR_W, 30);
		const resolution = requireResolved(
			resolveRailTemplateAttachmentIntent(
				document.map,
				"branch-bypass",
				initialRailTemplatePose(),
				attachmentParameters("branch-bypass"),
			),
		);

		expect(resolution.pose).toEqual({ forward: DIR_E, side: "right", flow: "reverse" });
		expect(resolution.guide.compatibleAnchorCount).toBeGreaterThan(0);
	});

	it("falls back to the nearest quarter-turn when the current axis has no guide", () => {
		const document = directedTrunk(DIR_S, 30);
		const resolution = requireResolved(
			resolveRailTemplateAttachmentIntent(
				document.map,
				"branch-bypass",
				initialRailTemplatePose(),
				attachmentParameters("branch-bypass"),
			),
		);

		expect(resolution.pose).toEqual({ forward: DIR_S, side: "right", flow: "forward" });
		expect(resolution.guide.candidateAnchorCount).toBeGreaterThan(0);
	});

	it("returns explicit null fields at the captured revision when no pose is compatible", () => {
		const map = new TileMap();
		const resolution = resolveRailTemplateAttachmentIntent(
			map,
			"branch-bypass",
			initialRailTemplatePose(),
			attachmentParameters("branch-bypass"),
			{ x: 0.5, y: 0.5 },
		);

		expect(resolution).toEqual({
			status: "unavailable",
			baseRevision: map.getRevision(),
			pose: null,
			guide: null,
			focusSnap: null,
		});
		expect(Object.isFrozen(resolution)).toBe(true);
	});

	it("does not mutate inputs and freezes the selected pose, guide, intervals, and snap", () => {
		const document = directedTrunk(DIR_E, 30);
		const preferredPose: RailTemplatePose = {
			forward: DIR_E,
			side: "left",
			flow: "reverse",
		};
		const parameters = {
			...attachmentParameters("branch-bypass"),
		};
		const poseBefore = { ...preferredPose };
		const parametersBefore = { ...parameters };
		const resolution = requireResolved(
			resolveRailTemplateAttachmentIntent(
				document.map,
				"branch-bypass",
				preferredPose,
				parameters,
				{ x: 10.5, y: 0.5 },
			),
		);

		expect(preferredPose).toEqual(poseBefore);
		expect(parameters).toEqual(parametersBefore);
		expect(resolution.pose).not.toBe(preferredPose);
		expect(Object.isFrozen(resolution)).toBe(true);
		expect(Object.isFrozen(resolution.pose)).toBe(true);
		expect(Object.isFrozen(resolution.guide)).toBe(true);
		expect(Object.isFrozen(resolution.guide.parameters)).toBe(true);
		expect(Object.isFrozen(resolution.guide.intervals)).toBe(true);
		expect(resolution.guide.intervals.every(Object.isFrozen)).toBe(true);
		expect(Object.isFrozen(resolution.focusSnap)).toBe(true);
		expect(Object.isFrozen(resolution.focusSnap?.anchor)).toBe(true);
	});

	it("searches only the explicitly unlocked attachment pose axes", () => {
		const document = directedTrunk(DIR_E, 30);
		const preferred = initialRailTemplatePose();
		const parameters = attachmentParameters("branch-bypass");
		const sideLocked = deriveRailTemplateAttachmentIntentIndex(
			document.map,
			"branch-bypass",
			preferred,
			parameters,
			lockRailTemplatePoseAxis(AUTO_RAIL_TEMPLATE_POSE_LOCK, "side"),
		);
		expect(sideLocked.entries).toHaveLength(8);
		expect(sideLocked.entries.every((entry) => entry.pose.side === preferred.side)).toBe(true);

		const fullyLocked = deriveRailTemplateAttachmentIntentIndex(
			document.map,
			"branch-bypass",
			preferred,
			parameters,
			LOCKED_RAIL_TEMPLATE_POSE,
		);
		expect(fullyLocked.entries).toHaveLength(1);
		expect(fullyLocked.entries[0]?.pose).toEqual(preferred);
	});
});

function defaultLongBay(): RailDocument {
	const document = new RailDocument();
	const plan = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function defaultOuterLoop(): RailDocument {
	const document = new RailDocument();
	const plan = planRailTemplate(
		document.map,
		"outer-loop",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("outer-loop"),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return document;
}

function directedTrunk(forward: Direction, forwardLength: number): RailDocument {
	const document = new RailDocument();
	const anchor = { x: 0, y: 0 };
	const start = moveRepeated(anchor, oppositeDirection(forward), 3);
	const end = moveRepeated(anchor, forward, forwardLength);
	expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	return document;
}

function moveRepeated(
	cell: Readonly<{ x: number; y: number }>,
	direction: Direction,
	distance: number,
): { x: number; y: number } {
	let result = cell;
	for (let index = 0; index < distance; index++) result = moveCell(result, direction);
	return result;
}

function attachmentParameters(
	templateId: RailTemplateAttachmentParameters["templateId"],
): RailTemplateAttachmentParameters {
	return defaultRailTemplateParameters(templateId) as RailTemplateAttachmentParameters;
}

function requireResolved(
	resolution: ReturnType<typeof resolveRailTemplateAttachmentIntent>,
): ResolvedRailTemplateAttachmentIntent {
	if (resolution.status !== "resolved") throw new Error("Expected a resolved attachment intent.");
	return resolution;
}
