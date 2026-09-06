import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { buildRailModuleOwnershipIndex, type DirectedRailEdge } from "../core/RailModuleOwnership";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "../core/StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import {
	organizationBundleOutsideMapPlacementAnchors,
	StaticFabOrganizationBundlePlacementSession,
} from "./StaticFabOrganizationBundlePlacementSession";

describe("StaticFabOrganizationBundlePlacementSession", () => {
	it("prepares an untrusted bundle once and exposes immutable placement metadata", () => {
		const untrusted = mutableBundleFixture();
		const session = new StaticFabOrganizationBundlePlacementSession(untrusted, {
			label: "Process Bay",
			origin: "library",
		});

		expect(session.bundle).not.toBe(untrusted);
		expect(Object.isFrozen(session)).toBe(true);
		expect(Object.isFrozen(session.bundle)).toBe(true);
		expect(Object.isFrozen(session.bundle.railEdges)).toBe(true);
		expect(Object.isFrozen(session.summary)).toBe(true);
		expect(session.quarterTurns).toBe(0);
		expect(session.rotationDegrees).toBe(0);
		expect(session.bounds).toEqual({
			minX: 0,
			minY: 0,
			maxX: session.bundle.sourceWidthMeters,
			maxY: session.bundle.sourceHeightMeters,
		});
		expect(Object.isFrozen(session.bounds)).toBe(true);
		expect(session.widthMeters).toBe(session.bundle.sourceWidthMeters);
		expect(session.heightMeters).toBe(session.bundle.sourceHeightMeters);
		expect(session.summary).toEqual({
			label: "Process Bay",
			origin: "library",
			captureMode: "DIRECT",
			quarterTurns: 0,
			rotationDegrees: 0,
			widthMeters: session.bundle.sourceWidthMeters,
			heightMeters: session.bundle.sourceHeightMeters,
			sourceModuleCount: session.bundle.sourceModuleCount,
			railEdgeCount: session.bundle.railEdges.length,
			advancedSwitchCount: 0,
			portCount: 0,
			equipmentGroupCount: 0,
			organizationCount: 1,
			rootOrganizationCount: 1,
		});
		expect("reverseFlow" in session).toBe(false);
		expect("id" in session.summary).toBe(false);
	});

	it("rotates only by one quarter turn, wraps, and preserves the canonical bundle", () => {
		const initial = new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
			label: "Reusable Bay",
			origin: "selection-copy",
			sourceRootOrganizationIds: [19],
		});
		const clockwise = initial.rotate(1);
		const upsideDown = clockwise.rotate(1);
		const restored = clockwise.rotate(-1);
		const counterClockwise = initial.rotate(-1);

		expect(clockwise).not.toBe(initial);
		expect(initial.quarterTurns).toBe(0);
		expect(clockwise.quarterTurns).toBe(1);
		expect(clockwise.rotationDegrees).toBe(90);
		expect(clockwise.widthMeters).toBe(initial.heightMeters);
		expect(clockwise.heightMeters).toBe(initial.widthMeters);
		expect(clockwise.bounds).toEqual({
			minX: -initial.heightMeters,
			minY: 0,
			maxX: 0,
			maxY: initial.widthMeters,
		});
		expect(upsideDown.bounds).toEqual({
			minX: -initial.widthMeters,
			minY: -initial.heightMeters,
			maxX: 0,
			maxY: 0,
		});
		expect(counterClockwise.bounds).toEqual({
			minX: 0,
			minY: -initial.widthMeters,
			maxX: initial.heightMeters,
			maxY: 0,
		});
		expect(restored.quarterTurns).toBe(0);
		expect(counterClockwise.quarterTurns).toBe(3);
		expect(counterClockwise.rotationDegrees).toBe(270);
		expect(clockwise.bundle).toBe(initial.bundle);
		expect(restored.bundle).toBe(initial.bundle);
		expect(counterClockwise.bundle).toBe(initial.bundle);
		expect(clockwise.label).toBe(initial.label);
		expect(clockwise.origin).toBe(initial.origin);
		expect(clockwise.sourceRootOrganizationIds).toEqual([19]);
		expect(Object.isFrozen(clockwise.sourceRootOrganizationIds)).toBe(true);
	});

	it("derives an integer bundle origin that keeps every rotation centered on the pointer", () => {
		const initial = new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
			label: "Centered Bay",
			origin: "fab-preset",
		});
		const pointer = Object.freeze({ x: 40, y: -12 });

		for (const session of [
			initial,
			initial.rotate(1),
			initial.rotate(1).rotate(1),
			initial.rotate(-1),
		]) {
			const anchor = session.anchorAtPointerCell(pointer);
			const centerXTwice = anchor.x * 2 + session.bounds.minX + session.bounds.maxX + 1;
			const centerYTwice = anchor.y * 2 + session.bounds.minY + session.bounds.maxY + 1;

			expect(Math.abs(centerXTwice - (pointer.x * 2 + 1))).toBeLessThanOrEqual(1);
			expect(Math.abs(centerYTwice - (pointer.y * 2 + 1))).toBeLessThanOrEqual(1);
			expect(Object.isFrozen(anchor)).toBe(true);
		}
	});

	it("primes immediate copies beside their source and snaps only nearby matching center axes", () => {
		const session = new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
			label: "Aligned Bay Copy",
			origin: "selection-copy",
			sourceBounds: { minX: 10, minY: -20, maxX: 15, maxY: -20 },
			sourceRootOrganizationIds: [7],
		});

		expect(session.sourceBounds).toEqual({ minX: 10, minY: -20, maxX: 15, maxY: -20 });
		expect(Object.isFrozen(session.sourceBounds)).toBe(true);
		expect(session.sourceRootOrganizationIds).toEqual([7]);
		expect(Object.isFrozen(session.sourceRootOrganizationIds)).toBe(true);
		const [right, left, below, above] = session.adjacentPlacementAnchors();
		expect(right).toEqual({ x: 24, y: -20 });
		expect(left).toEqual({ x: -4, y: -20 });
		expect(below).toEqual({ x: 10, y: -11 });
		expect(above).toEqual({ x: 10, y: -29 });

		const pointer = session.pointerCellAtAnchor(right as Readonly<{ x: number; y: number }>);
		expect(session.anchorAtPointerCell(pointer)).toEqual(right);
		expect(session.alignmentAtAnchor(right as Readonly<{ x: number; y: number }>)).toMatchObject({
			centerX: false,
			centerY: true,
		});

		const nearSourceColumn = session.anchorAtPointerCell({ x: 14, y: 20 });
		expect(nearSourceColumn.x).toBe(10);
		expect(session.alignmentAtAnchor(nearSourceColumn).centerX).toBe(true);
		const outsideMagnet = session.anchorAtPointerCell({ x: 15, y: 20 });
		expect(outsideMagnet.x).toBe(13);
		expect(session.alignmentAtAnchor(outsideMagnet).centerX).toBe(false);

		const rotated = session.rotate(1);
		expect(rotated.sourceBounds).toEqual(session.sourceBounds);
		expect(rotated.sourceRootOrganizationIds).toEqual(session.sourceRootOrganizationIds);
	});

	it("offers four frozen, gapped candidates outside a non-empty map for source-free presets", () => {
		const placementBounds = { minX: -2, minY: -1, maxX: 8, maxY: 5 };
		const candidates = organizationBundleOutsideMapPlacementAnchors(
			{ minX: -10, minY: 20, maxX: 30, maxY: 60 },
			placementBounds,
		);

		expect(candidates).toEqual([
			{ x: 41, y: 38 },
			{ x: -27, y: 38 },
			{ x: 7, y: 70 },
			{ x: 7, y: 6 },
		]);
		expect(Object.isFrozen(candidates)).toBe(true);
		expect(candidates.every(Object.isFrozen)).toBe(true);
		expect(organizationBundleOutsideMapPlacementAnchors(null, placementBounds)).toEqual([]);
		expect(
			organizationBundleOutsideMapPlacementAnchors(
				{ minX: 0, minY: 0, maxX: 0, maxY: 0 },
				placementBounds,
				-1,
			),
		).toEqual([]);
	});

	it("rejects invalid untrusted bundles, orientations, labels, and rotation deltas", () => {
		expect(
			() =>
				new StaticFabOrganizationBundlePlacementSession(
					{ version: 1 },
					{
						label: "Invalid",
						origin: "recent",
					},
				),
		).toThrow(/Invalid static FAB organization bundle/);
		expect(
			() =>
				new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
					label: " ",
					origin: "recent",
				}),
		).toThrow(/label must not be empty/);
		expect(
			() =>
				new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
					label: "Invalid rotation",
					origin: "recent",
					quarterTurns: 4 as 0,
				}),
		).toThrow(/0, 1, 2, or 3/);
		expect(
			() =>
				new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
					label: "Invalid source bounds",
					origin: "selection-copy",
					sourceBounds: { minX: 2, minY: 0, maxX: 1, maxY: 1 },
				}),
		).toThrow(/source bounds/);
		expect(
			() =>
				new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
					label: "Invalid source roots",
					origin: "selection-copy",
					sourceRootOrganizationIds: [1, 1],
				}),
		).toThrow(/source root IDs/);
		expect(
			() =>
				new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
					label: "Invalid source root",
					origin: "selection-copy",
					sourceRootOrganizationIds: [0],
				}),
		).toThrow(/source root IDs/);

		const session = new StaticFabOrganizationBundlePlacementSession(mutableBundleFixture(), {
			label: "Valid",
			origin: "recent",
		});
		expect(() => session.rotate(0 as 1)).toThrow(/-1 or 1/);
	});
});

function mutableBundleFixture(): StaticFabOrganizationBundle {
	return JSON.parse(JSON.stringify(capturedBundleFixture())) as StaticFabOrganizationBundle;
}

function capturedBundleFixture(): StaticFabOrganizationBundle {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 });
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Organization bundle session fixture failed: ${plan.reason}`);
	}
	const edgeByKey = new Map<string, DirectedRailEdge>();
	for (const module of buildRailModuleOwnershipIndex(document.map).modules) {
		for (const edge of module.eraseEdges) {
			edgeByKey.set(staticFabOrganizationEdgeKey(edge), edge);
		}
	}
	const railEdges = Object.freeze([...edgeByKey.values()].sort(compareDirectedRailEdges));
	const organizations: StaticFabOrganizationState = Object.freeze({
		nextOrganizationId: 2,
		records: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "BAY" as const,
				name: "Process Bay",
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "Portable test bay", color: "CYAN" as const }),
				membership: Object.freeze({
					railEdges,
					advancedSwitchIds: Object.freeze([]),
					equipmentGroupIds: Object.freeze([]),
				}),
			}),
		]),
	});
	const captured = captureStaticFabOrganizationBundle(
		document.map,
		document.portEquipment,
		document.getPatchSequence(),
		organizations,
		document.relationships,
		[1],
		"DIRECT",
	);
	if (!captured.valid) throw new Error(`Organization bundle capture failed: ${captured.reason}`);
	return captured.bundle;
}
