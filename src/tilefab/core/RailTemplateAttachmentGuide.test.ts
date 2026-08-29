import { describe, expect, it } from "vitest";
import type { AdvancedSwitchRecord } from "./AdvancedSwitch";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import {
	deriveRailTemplateAttachmentGuide,
	isRailTemplateAttachmentGuideCurrent,
	type RailTemplateAttachmentGuideInterval,
	type RailTemplateAttachmentGuideMap,
	type RailTemplateAttachmentId,
	type RailTemplateAttachmentParameters,
	resolveRailTemplateAttachmentSnap,
	resolveRailTemplateAttachmentSnaps,
	summarizeRailTemplateAttachmentGuide,
} from "./RailTemplateAttachmentGuide";
import {
	defaultRailTemplateParameters,
	planRailTemplate,
	setRailTemplateParameter,
} from "./RailTemplateCatalog";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_S,
	type Direction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, encodeRailCell, TileMap } from "./TileMap";

describe("RailTemplateAttachmentGuide", () => {
	it("compresses sparse straight-trunk anchors into revision-bound compatible and blocked intervals", () => {
		const document = directedTrunk(DIR_E, 24);
		const parameters = attachmentParameters("branch-bypass", 8, 4);
		const guide = deriveRailTemplateAttachmentGuide(
			document.map,
			"branch-bypass",
			{ forward: DIR_E, side: "right" },
			parameters,
		);

		expect(guide).toMatchObject({
			baseRevision: document.map.getRevision(),
			templateId: "branch-bypass",
			scannedRailCellCount: 28,
			candidateAnchorCount: 26,
			compatibleAnchorCount: 16,
			blockedAnchorCount: 10,
		});
		expect(guide.templateDefinitionFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(
			guide.intervals.map(({ startAnchor, endAnchor, anchorCount, status, reasonCode }) => ({
				startAnchor,
				endAnchor,
				anchorCount,
				status,
				reasonCode,
			})),
		).toEqual([
			{
				startAnchor: { x: -2, y: 0 },
				endAnchor: { x: -2, y: 0 },
				anchorCount: 1,
				status: "blocked",
				reasonCode: "insufficient-support",
			},
			{
				startAnchor: { x: -1, y: 0 },
				endAnchor: { x: 14, y: 0 },
				anchorCount: 16,
				status: "compatible",
				reasonCode: null,
			},
			{
				startAnchor: { x: 15, y: 0 },
				endAnchor: { x: 23, y: 0 },
				anchorCount: 9,
				status: "blocked",
				reasonCode: "insufficient-support",
			},
		]);
		expect(Object.isFrozen(guide)).toBe(true);
		expect(Object.isFrozen(guide.intervals)).toBe(true);
		expect(isRailTemplateAttachmentGuideCurrent(document.map, guide)).toBe(true);
		expect(summarizeRailTemplateAttachmentGuide(guide)).toEqual({
			readyAnchorCount: 16,
			blockedAnchorCount: 10,
			blockedByReason: {
				"wrong-direction": 0,
				"insufficient-support": 10,
				"advanced-switch": 0,
				overlap: 0,
				topology: 0,
			},
			dominantBlockReason: "insufficient-support",
		});

		for (const interval of guide.intervals) {
			for (const anchor of intervalAnchors(interval, DIR_E)) {
				const plan = planRailTemplate(
					document.map,
					"branch-bypass",
					anchor,
					guide.pose,
					parameters,
				);
				expect(plan.valid, `${anchor.x},${anchor.y}: ${plan.reason}`).toBe(
					interval.status === "compatible",
				);
			}
		}
	});

	it("respects span, rotation, and support cells for both attachable template families", () => {
		for (const forward of ALL_DIRECTIONS) {
			const document = directedTrunk(forward, 40);
			const short = deriveRailTemplateAttachmentGuide(
				document.map,
				"branch-bypass",
				{ forward, side: "left" },
				attachmentParameters("branch-bypass", 8, 3),
			);
			const long = deriveRailTemplateAttachmentGuide(
				document.map,
				"branch-bypass",
				{ forward, side: "left" },
				attachmentParameters("branch-bypass", 12, 3),
			);

			expect(short.compatibleAnchorCount, `short ${forward}`).toBe(32);
			expect(long.compatibleAnchorCount, `long ${forward}`).toBe(28);
			expect(short.intervals.some((interval) => interval.status === "compatible")).toBe(true);
			for (const interval of short.intervals) {
				for (const anchor of intervalAnchors(interval, forward)) {
					const plan = planRailTemplate(
						document.map,
						"branch-bypass",
						anchor,
						short.pose,
						short.parameters,
					);
					expect(plan.valid, `${forward}/${anchor.x},${anchor.y}: ${plan.reason}`).toBe(
						interval.status === "compatible",
					);
				}
			}
		}

		const outerbay = directedTrunk(DIR_S, 100);
		const outerbayGuide = deriveRailTemplateAttachmentGuide(
			outerbay.map,
			"outerbay-link",
			{ forward: DIR_S, side: "right" },
			attachmentParameters("outerbay-link", 24, 12),
		);
		expect(outerbayGuide.compatibleAnchorCount).toBe(76);
		expect(outerbayGuide.parameters).toMatchObject({
			templateId: "outerbay-link",
			trunkSpanMeters: 24,
			offsetMeters: 12,
		});
		for (const interval of outerbayGuide.intervals) {
			for (const anchor of intervalAnchors(interval, DIR_S)) {
				const plan = planRailTemplate(
					outerbay.map,
					"outerbay-link",
					anchor,
					outerbayGuide.pose,
					outerbayGuide.parameters,
				);
				expect(plan.valid, `${anchor.x},${anchor.y}: ${plan.reason}`).toBe(
					interval.status === "compatible",
				);
			}
		}
	});

	it("offers valid default Bay and Outerbay attachments on a default closed Long Bay", () => {
		for (const id of ["attached-return", "branch-bypass", "outerbay-link"] as const) {
			const document = new RailDocument();
			const parentPose = { forward: DIR_E, side: "right", flow: "forward" } as const;
			const attachmentPose = { forward: DIR_E, side: "left", flow: "forward" } as const;
			const parent = planRailTemplate(
				document.map,
				"long-bay",
				{ x: 0, y: 0 },
				parentPose,
				defaultRailTemplateParameters("long-bay"),
			);
			expect(parent.valid, `${id} parent: ${parent.reason}`).toBe(true);
			expect(document.commit(parent)).toBe(true);

			const parameters = defaultRailTemplateParameters(id) as RailTemplateAttachmentParameters;
			const guide = deriveRailTemplateAttachmentGuide(document.map, id, attachmentPose, parameters);
			expect(guide.compatibleAnchorCount, id).toBeGreaterThan(0);
			const compatible = guide.intervals.find((interval) => interval.status === "compatible");
			if (!compatible) throw new Error(`Expected one default ${id} attachment interval.`);
			const plan = planRailTemplate(
				document.map,
				id,
				compatible.startAnchor,
				attachmentPose,
				parameters,
			);
			expect(plan.valid, `${id}: ${plan.reason}`).toBe(true);
			expect(plan.newEdges).toBeGreaterThan(0);
		}
	});

	it("marks same-axis reverse flow and pattern-path occupancy with concise reasons", () => {
		const reverse = directedTrunk(oppositeDirection(DIR_E), 24);
		const reverseGuide = deriveRailTemplateAttachmentGuide(
			reverse.map,
			"branch-bypass",
			{ forward: DIR_E, side: "right" },
			attachmentParameters("branch-bypass", 8, 4),
		);
		expect(reverseGuide.intervals).toHaveLength(1);
		expect(reverseGuide.intervals[0]).toMatchObject({
			anchorCount: 26,
			status: "blocked",
			reasonCode: "wrong-direction",
			reason: "진행 방향 불일치",
		});
		expect(summarizeRailTemplateAttachmentGuide(reverseGuide).dominantBlockReason).toBe(
			"wrong-direction",
		);
		const flippedGuide = deriveRailTemplateAttachmentGuide(
			reverse.map,
			"branch-bypass",
			{ forward: DIR_E, side: "right", flow: "reverse" },
			attachmentParameters("branch-bypass", 8, 4),
		);
		expect(flippedGuide.compatibleAnchorCount).toBeGreaterThan(0);
		const flippedInterval = flippedGuide.intervals.find(
			(interval) => interval.status === "compatible",
		);
		expect(flippedInterval).toBeDefined();
		if (!flippedInterval) throw new Error("Expected a reverse-flow attachment interval.");
		const flippedPlan = planRailTemplate(
			reverse.map,
			"branch-bypass",
			flippedInterval.startAnchor,
			flippedGuide.pose,
			flippedGuide.parameters,
		);
		expect(flippedPlan.valid, flippedPlan.reason).toBe(true);

		const parallel = horizontalLines([-4, 0], -3, 24);
		const right = deriveRailTemplateAttachmentGuide(
			parallel,
			"branch-bypass",
			{ forward: DIR_E, side: "right" },
			attachmentParameters("branch-bypass", 8, 4),
		);
		const left = deriveRailTemplateAttachmentGuide(
			parallel,
			"branch-bypass",
			{ forward: DIR_E, side: "left" },
			attachmentParameters("branch-bypass", 8, 4),
		);

		expect(intervalAt(right, { x: 0, y: -4 })).toMatchObject({
			status: "blocked",
			reasonCode: "overlap",
			reason: "패턴 경로와 기존 레일 중첩",
		});
		expect(intervalAt(right, { x: 0, y: 0 })).toMatchObject({ status: "compatible" });
		expect(intervalAt(left, { x: 0, y: -4 })).toMatchObject({ status: "compatible" });
		expect(intervalAt(left, { x: 0, y: 0 })).toMatchObject({
			status: "blocked",
			reasonCode: "overlap",
		});
	});

	it("snaps to the nearest compatible anchor without expanding compressed intervals", () => {
		const document = directedTrunk(DIR_E, 40);
		const guide = deriveRailTemplateAttachmentGuide(
			document.map,
			"branch-bypass",
			{ forward: DIR_E, side: "right" },
			attachmentParameters("branch-bypass", 8, 4),
		);

		expect(resolveRailTemplateAttachmentSnap(guide, { x: 9.62, y: 1.1 }, 1)).toMatchObject({
			anchor: { x: 9, y: 0 },
		});
		expect(resolveRailTemplateAttachmentSnap(guide, { x: 9.62, y: 2.1 }, 1)).toBeNull();
		expect(
			resolveRailTemplateAttachmentSnaps(guide, { x: 9.5, y: 0.5 }, 2.1)
				.filter((snap) => snap.handleRole === "branch")
				.map((snap) => snap.anchor.x),
		).toEqual([9, 8, 10, 7, 11]);
	});

	it("accepts the advertised span plus four lead meters and focuses either attachment handle", () => {
		const exact = new RailDocument();
		expect(exact.commit(planRailConstruction(exact.map, { x: 0, y: 0 }, { x: 16, y: 0 }))).toBe(
			true,
		);
		const guide = deriveRailTemplateAttachmentGuide(
			exact.map,
			"branch-bypass",
			{ forward: DIR_E, side: "right" },
			attachmentParameters("branch-bypass", 12, 4),
		);

		expect(guide.compatibleAnchorCount).toBe(1);
		const branch = resolveRailTemplateAttachmentSnap(guide, { x: 2.5, y: 0.5 }, 0.25);
		expect(branch).toMatchObject({
			anchor: { x: 2, y: 0 },
			focusCell: { x: 2, y: 0 },
			handleRole: "branch",
		});
		const merge = resolveRailTemplateAttachmentSnap(guide, { x: 14.5, y: 0.5 }, 0.25);
		expect(merge).toMatchObject({
			anchor: { x: 2, y: 0 },
			focusCell: { x: 14, y: 0 },
			handleRole: "merge",
		});
		const plan = planRailTemplate(
			exact.map,
			"branch-bypass",
			merge?.anchor ?? { x: 0, y: 0 },
			guide.pose,
			guide.parameters,
		);
		expect(plan.valid, plan.reason).toBe(true);
	});

	it("excludes every anchor whose reserved support intersects an advanced switch claim", () => {
		const document = directedTrunk(DIR_E, 30);
		const claimed = withAdvancedSwitchClaim(document.map, { x: 10, y: 0 });
		const guide = deriveRailTemplateAttachmentGuide(
			claimed,
			"branch-bypass",
			{ forward: DIR_E, side: "right" },
			attachmentParameters("branch-bypass", 8, 4),
		);
		const switchInterval = guide.intervals.find(
			(interval) => interval.reasonCode === "advanced-switch",
		);

		expect(switchInterval).toMatchObject({
			startAnchor: { x: 1, y: 0 },
			endAnchor: { x: 11, y: 0 },
			anchorCount: 11,
			status: "blocked",
			reason: "고급 스위치 점유 구간",
		});
		expect(intervalAt(guide, { x: 0, y: 0 })).toMatchObject({ status: "compatible" });
		expect(intervalAt(guide, { x: 12, y: 0 })).toMatchObject({ status: "compatible" });
	});

	it("invalidates a guide after any authored revision and rejects non-attachment inputs", () => {
		const document = directedTrunk(DIR_E, 24);
		const parameters = attachmentParameters("branch-bypass", 8, 4);
		const guide = deriveRailTemplateAttachmentGuide(
			document.map,
			"branch-bypass",
			{ forward: DIR_E, side: "right" },
			parameters,
		);
		expect(isRailTemplateAttachmentGuideCurrent(document.map, guide)).toBe(true);

		expect(
			document.commit(planRailConstruction(document.map, { x: 24, y: 0 }, { x: 28, y: 0 })),
		).toBe(true);
		expect(isRailTemplateAttachmentGuideCurrent(document.map, guide)).toBe(false);

		expect(() =>
			deriveRailTemplateAttachmentGuide(
				document.map,
				"long-bay" as unknown as RailTemplateAttachmentId,
				{ forward: DIR_E, side: "right" },
				defaultRailTemplateParameters("long-bay") as unknown as RailTemplateAttachmentParameters,
			),
		).toThrow(/does not attach/);
		expect(() =>
			deriveRailTemplateAttachmentGuide(
				document.map,
				"branch-bypass",
				{ forward: DIR_E, side: "right" },
				attachmentParameters("outerbay-link", 24, 12),
			),
		).toThrow(/do not match/);
	});

	it("keeps a 50k-cell trunk compressed instead of publishing one guide object per cell", () => {
		const map = horizontalLines([0], -3, 49_996);
		const guide = deriveRailTemplateAttachmentGuide(
			map,
			"branch-bypass",
			{ forward: DIR_E, side: "right" },
			attachmentParameters("branch-bypass", 12, 4),
		);

		expect(guide.scannedRailCellCount).toBe(50_000);
		expect(guide.candidateAnchorCount).toBe(49_998);
		expect(guide.intervals.length).toBeLessThanOrEqual(3);
		expect(guide.intervals.reduce((total, interval) => total + interval.anchorCount, 0)).toBe(
			guide.candidateAnchorCount,
		);
	});
});

function attachmentParameters(
	templateId: RailTemplateAttachmentId,
	trunkSpanMeters: number,
	offsetMeters: number,
): RailTemplateAttachmentParameters {
	let parameters = defaultRailTemplateParameters(templateId);
	parameters = setRailTemplateParameter(templateId, parameters, "trunkSpanMeters", trunkSpanMeters);
	parameters = setRailTemplateParameter(templateId, parameters, "offsetMeters", offsetMeters);
	return parameters as RailTemplateAttachmentParameters;
}

function directedTrunk(forward: Direction, forwardLength: number): RailDocument {
	const document = new RailDocument();
	const anchor = { x: 0, y: 0 };
	const start = moveRepeated(anchor, oppositeDirection(forward), 3);
	const end = moveRepeated(anchor, forward, forwardLength);
	expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	return document;
}

function horizontalLines(ys: readonly number[], minX: number, maxX: number): TileMap {
	const hydrator = TileMap.createHydrator();
	for (const y of ys) {
		for (let x = minX; x <= maxX; x++) {
			hydrator.addEncodedCell(
				x,
				y,
				encodeRailCell({
					incoming: x === minX ? 0 : oppositeDirection(DIR_E),
					outgoing: x === maxX ? 0 : DIR_E,
				}),
			);
		}
	}
	return hydrator.finish(1);
}

function withAdvancedSwitchClaim(map: TileMap, claimedCell: Cell): RailTemplateAttachmentGuideMap {
	const switchRecord: AdvancedSwitchRecord = Object.freeze({
		id: 999,
		profileClass: "A",
		origin: Object.freeze({ ...claimedCell }),
		forward: DIR_E,
		lateral: DIR_S,
		movementMask: 0b1111,
	});
	return {
		get edgeCount() {
			return map.edgeCount;
		},
		getRevision: () => map.getRevision(),
		getEncoded: (x, y) => map.getEncoded(x, y),
		getRail: (x, y) => map.getRail(x, y),
		hasRail: (x, y) => map.hasRail(x, y),
		getAdvancedSwitch: (id) => (id === switchRecord.id ? switchRecord : map.getAdvancedSwitch(id)),
		getAdvancedSwitchOwningCell: (x, y) =>
			x === claimedCell.x && y === claimedCell.y
				? switchRecord
				: map.getAdvancedSwitchOwningCell(x, y),
		forEachRail: (visit) => map.forEachRail(visit),
	};
}

function intervalAt(
	guide: ReturnType<typeof deriveRailTemplateAttachmentGuide>,
	anchor: Cell,
): RailTemplateAttachmentGuideInterval | undefined {
	return guide.intervals.find((interval) =>
		intervalAnchors(interval, guide.pose.forward).some(
			(candidate) => candidate.x === anchor.x && candidate.y === anchor.y,
		),
	);
}

function intervalAnchors(
	interval: RailTemplateAttachmentGuideInterval,
	forward: Direction,
): Cell[] {
	const anchors: Cell[] = [];
	let cell = interval.startAnchor;
	for (let index = 0; index < interval.anchorCount; index++) {
		anchors.push(cell);
		cell = moveCell(cell, forward);
	}
	return anchors;
}

function moveRepeated(cell: Cell, direction: Direction, distance: number): Cell {
	let result = cell;
	for (let index = 0; index < distance; index++) result = moveCell(result, direction);
	return result;
}
