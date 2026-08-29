import { describe, expect, it } from "vitest";
import {
	createSyntheticFabAssemblyPlan,
	type SyntheticFabAssemblyConnectionRole,
	type SyntheticFabAssemblyLinkOperation,
	type SyntheticFabAssemblyPlan,
	type SyntheticFabAssemblyProcessTrunkOperation,
} from "./SyntheticFabAssemblyPlan";
import type { SyntheticFabLayoutGateway, SyntheticFabLayoutLoop } from "./SyntheticFabLayoutPlan";
import {
	buildSyntheticFabStarter,
	defaultSyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
} from "./SyntheticFabStarter";
import { SYNTHETIC_FAB_CARDINAL_SIDES } from "./SyntheticFabTopologySpec";

const SUPPORTED_BLOCK_COUNTS = [3, 4, 5, 6] as const;
const MINIMUM_BAY_COUNT = 50;
const MAXIMUM_BAY_COUNT = 100;
const BAY_PITCH_METERS = 20;
const LINK_CORRIDOR_MARGIN_METERS = 4;

interface CorridorBounds {
	readonly id: string;
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

type SyntheticFabAssemblyRoutedOperation =
	| SyntheticFabAssemblyProcessTrunkOperation
	| SyntheticFabAssemblyLinkOperation;

describe("Synthetic FAB topology/layout matrix", () => {
	it.each(
		SUPPORTED_BLOCK_COUNTS,
	)("keeps every 50-100 Bay profile deterministic and non-crossing with %i Process Blocks", (processBlockCount) => {
		for (
			let totalBayCount = MINIMUM_BAY_COUNT;
			totalBayCount <= MAXIMUM_BAY_COUNT;
			totalBayCount += 1
		) {
			const context = `${processBlockCount} blocks / ${totalBayCount} Bays`;
			const profile = { processBlockCount, totalBayCount };
			const plan = createSyntheticFabAssemblyPlan(profile, BAY_PITCH_METERS);
			const repeated = createSyntheticFabAssemblyPlan(profile, BAY_PITCH_METERS);

			expect(repeated.planFingerprint, context).toBe(plan.planFingerprint);
			expect(
				repeated.topology.wings.map((wing) => [wing.id, wing.bayCount]),
				context,
			).toEqual(plan.topology.wings.map((wing) => [wing.id, wing.bayCount]));
			expect(
				repeated.operations.map((operation) => operation.id),
				context,
			).toEqual(plan.operations.map((operation) => operation.id));

			expectDeterministicBayAllocation(plan, context);
			expectRequiredCirculationStructure(plan, context);

			const corridors = explicitLinkCorridors(plan);
			const crossings: string[] = [];
			for (let leftIndex = 0; leftIndex < corridors.length; leftIndex += 1) {
				const left = corridors[leftIndex] as CorridorBounds;
				for (let rightIndex = leftIndex + 1; rightIndex < corridors.length; rightIndex += 1) {
					const right = corridors[rightIndex] as CorridorBounds;
					if (corridorInteriorsOverlap(left, right)) crossings.push(`${left.id} x ${right.id}`);
				}
			}
			expect(crossings, context).toEqual([]);
		}
	});

	it.each([
		[3, 50, 20],
		[4, 60, 22],
		[5, 100, 24],
		[6, 100, 20],
	] as const)(
		"materializes %i Blocks / %i Bays / %i m pitch as one clearance-safe physical SCC",
		(processBlockCount, totalBayCount, bayPitchMeters) => {
			let request = defaultSyntheticFabStarterRequest("large-fab-60");
			request = setSyntheticFabStarterParameter(request, "processBlockCount", processBlockCount);
			request = setSyntheticFabStarterParameter(request, "bayCount", totalBayCount);
			request = setSyntheticFabStarterParameter(request, "bayPitchMeters", bayPitchMeters);
			const plan = createSyntheticFabAssemblyPlan(
				{ processBlockCount, totalBayCount },
				bayPitchMeters,
			);
			const build = buildSyntheticFabStarter(request);

			expect(build.planFingerprint).toBe(plan.planFingerprint);
			expect(build.summary).toMatchObject({
				bayCount: totalBayCount,
				zoneCount: processBlockCount * 4,
				openTerminals: 0,
				strongComponents: 1,
			});
			expect(build.physical.valid).toBe(true);
			expect(build.physical.diagnostics).toEqual([]);
			expect(build.physical.clearance.issues.count).toBe(0);
			const expectedPlacements = plan.operations
				.filter((operation) => operation.kind === "process-trunk")
				.flatMap((operation) => operation.bayPlacements);
			const materializedBays = build.steps.filter((step) => step.hierarchyRole === "process-bay");
			expect(materializedBays).toHaveLength(expectedPlacements.length);
			for (const [index, placement] of expectedPlacements.entries()) {
				expect(materializedBays[index]).toMatchObject({
					entityId: placement.id,
					anchor: placement.anchor,
					pose: placement.pose,
				});
			}
		},
		180_000,
	);
});

function expectDeterministicBayAllocation(plan: SyntheticFabAssemblyPlan, context: string): void {
	const orderedWings = [...plan.topology.wings].sort(
		(left, right) => left.row - right.row || left.column - right.column,
	);
	const wingCount = plan.topology.blocks * 4;
	const totalBayCount = orderedWings.reduce((total, wing) => total + wing.bayCount, 0);
	const baseBayCount = Math.floor(totalBayCount / wingCount);
	const remainder = totalBayCount % wingCount;

	expect(orderedWings, context).toHaveLength(wingCount);
	expect(
		orderedWings.map((wing, index) => wing.bayCount === baseBayCount + (index < remainder ? 1 : 0)),
		context,
	).not.toContain(false);

	const wingById = new Map(orderedWings.map((wing) => [wing.id, wing]));
	for (const row of plan.topology.processRows) {
		const west = wingById.get(row.leftWingId);
		const east = wingById.get(row.rightWingId);
		if (!west || !east) throw new Error(`${context}: missing Wing for ${row.id}`);
		expect(west.column, `${context} / ${row.id}`).toBe(0);
		expect(east.column, `${context} / ${row.id}`).toBe(1);
		expect(Math.abs(west.bayCount - east.bayCount), `${context} / ${row.id}`).toBeLessThanOrEqual(
			1,
		);
	}
}

function expectRequiredCirculationStructure(plan: SyntheticFabAssemblyPlan, context: string): void {
	const circuits = plan.operations.filter((operation) => operation.kind === "circuit");
	const links = assemblyLinks(plan);
	const expectedWingCount = plan.topology.blocks * 4;

	expect(
		circuits.map((operation) => operation.role),
		context,
	).toEqual(["outer-circulation", "wall-circuit", "interbay-spine"]);
	expect(plan.layout.wings, context).toHaveLength(expectedWingCount);
	expect(plan.layout.rows, context).toHaveLength(plan.topology.blocks * 2);
	expect(plan.layout.banks, context).toHaveLength(plan.topology.blocks * 2);
	expect(plan.layout.blocks, context).toHaveLength(plan.topology.blocks);
	expect(strictlyContains(plan.layout.outer, plan.layout.wallCircuit), context).toBe(true);
	expect(strictlyContains(plan.layout.wallCircuit, plan.layout.spine), context).toBe(true);
	for (const wing of plan.layout.wings) {
		expect(strictlyContains(plan.layout.wallCircuit, wing), `${context} / ${wing.id}`).toBe(true);
		const rowTrunk = links.filter(
			(link) => link.kind === "process-trunk" && link.wingId === wing.id,
		);
		expect(rowTrunk, `${context} / ${wing.id} process-row trunk`).toHaveLength(1);
		expect(rowTrunk[0]?.role, wing.id).toBe("process-trunk");
		expect(new Set([rowTrunk[0]?.sourceId, rowTrunk[0]?.targetId]), wing.id).toEqual(
			new Set([plan.layout.wallCircuit.id, plan.layout.spine.id]),
		);
	}

	const spineWallLinks = links.filter((link) => link.role === "spine-wall");
	expect(
		spineWallLinks.map((link) => `${link.sourceSide}:${link.targetSide}`),
		context,
	).toEqual(["north:north", "south:south"]);

	const wallOuterLinks = links.filter((link) => link.role === "wall-outer");
	expect(wallOuterLinks, context).toHaveLength(SYNTHETIC_FAB_CARDINAL_SIDES.length);
	expect(new Set(wallOuterLinks.map((link) => link.sourceSide)), context).toEqual(
		new Set(SYNTHETIC_FAB_CARDINAL_SIDES),
	);
	expect(
		wallOuterLinks.every(
			(link) =>
				link.sourceId === plan.layout.wallCircuit.id &&
				link.targetId === plan.layout.outer.id &&
				link.sourceSide === link.targetSide,
		),
		context,
	).toBe(true);

	expect(plan.operations, context).toHaveLength(9 + expectedWingCount);
}

function explicitLinkCorridors(plan: SyntheticFabAssemblyPlan): readonly CorridorBounds[] {
	const links = assemblyLinks(plan);
	const corridors: CorridorBounds[] = [];
	for (const row of plan.layout.rows) {
		corridors.push(
			rowLinkCorridor(
				requiredLink(links, "process-trunk", row.leftWing.id),
				row.corridor.westWallX,
				row.corridor.spineWestX,
				row.corridor.windowMinY,
				row.corridor.windowMaxY,
			),
			rowLinkCorridor(
				requiredLink(links, "process-trunk", row.rightWing.id),
				row.corridor.spineEastX,
				row.corridor.eastWallX,
				row.corridor.windowMinY,
				row.corridor.windowMaxY,
			),
		);
	}

	const loopById = new Map<string, SyntheticFabLayoutLoop>([
		[plan.layout.outer.id, plan.layout.outer],
		[plan.layout.wallCircuit.id, plan.layout.wallCircuit],
		[plan.layout.spine.id, plan.layout.spine],
	]);
	for (const gateway of [...plan.layout.spineWallGateways, ...plan.layout.wallOuterGateways]) {
		const source = loopById.get(gateway.sourceId);
		const target = loopById.get(gateway.targetId);
		if (!source || !target) throw new Error(`Missing loop for gateway ${gateway.id}`);
		corridors.push(gatewayCorridor(gateway, source, target, plan.topology.rowLinkWindowMeters));
	}
	return corridors;
}

function rowLinkCorridor(
	link: SyntheticFabAssemblyRoutedOperation,
	startX: number,
	endX: number,
	windowMinY: number,
	windowMaxY: number,
): CorridorBounds {
	if (link.row === null || link.center < windowMinY || link.center > windowMaxY) {
		throw new Error(`Link ${link.id} is outside its declared row corridor.`);
	}
	return expandedBounds(link.id, startX, windowMinY, endX, windowMaxY);
}

function gatewayCorridor(
	gateway: SyntheticFabLayoutGateway,
	source: SyntheticFabLayoutLoop,
	target: SyntheticFabLayoutLoop,
	windowMeters: number,
): CorridorBounds {
	const halfBefore = Math.floor(windowMeters / 2);
	const halfAfter = windowMeters - halfBefore;
	if (gateway.sourceSide === "north" || gateway.sourceSide === "south") {
		return expandedBounds(
			gateway.id,
			gateway.center - halfBefore,
			loopSideCoordinate(source, gateway.sourceSide),
			gateway.center + halfAfter,
			loopSideCoordinate(target, gateway.targetSide),
		);
	}
	return expandedBounds(
		gateway.id,
		loopSideCoordinate(source, gateway.sourceSide),
		gateway.center - halfBefore,
		loopSideCoordinate(target, gateway.targetSide),
		gateway.center + halfAfter,
	);
}

function loopSideCoordinate(
	loop: SyntheticFabLayoutLoop,
	side: SyntheticFabLayoutGateway["sourceSide"],
): number {
	switch (side) {
		case "north":
			return loop.origin.y;
		case "east":
			return loop.origin.x + loop.lengthMeters;
		case "south":
			return loop.origin.y + loop.depthMeters;
		case "west":
			return loop.origin.x;
	}
}

function expandedBounds(
	id: string,
	firstX: number,
	firstY: number,
	secondX: number,
	secondY: number,
): CorridorBounds {
	return {
		id,
		minX: Math.min(firstX, secondX) - LINK_CORRIDOR_MARGIN_METERS,
		minY: Math.min(firstY, secondY) - LINK_CORRIDOR_MARGIN_METERS,
		maxX: Math.max(firstX, secondX) + LINK_CORRIDOR_MARGIN_METERS,
		maxY: Math.max(firstY, secondY) + LINK_CORRIDOR_MARGIN_METERS,
	};
}

function corridorInteriorsOverlap(left: CorridorBounds, right: CorridorBounds): boolean {
	return (
		Math.max(left.minX, right.minX) < Math.min(left.maxX, right.maxX) &&
		Math.max(left.minY, right.minY) < Math.min(left.maxY, right.maxY)
	);
}

type LayoutRectangle = Pick<SyntheticFabLayoutLoop, "origin" | "lengthMeters" | "depthMeters">;

function strictlyContains(outer: LayoutRectangle, inner: LayoutRectangle): boolean {
	return (
		inner.origin.x > outer.origin.x &&
		inner.origin.y > outer.origin.y &&
		inner.origin.x + inner.lengthMeters < outer.origin.x + outer.lengthMeters &&
		inner.origin.y + inner.depthMeters < outer.origin.y + outer.depthMeters
	);
}

function assemblyLinks(
	plan: SyntheticFabAssemblyPlan,
): readonly SyntheticFabAssemblyRoutedOperation[] {
	return plan.operations.filter(
		(operation): operation is SyntheticFabAssemblyRoutedOperation =>
			operation.kind === "process-trunk" || operation.kind === "link",
	);
}

function requiredLink(
	links: readonly SyntheticFabAssemblyRoutedOperation[],
	role: SyntheticFabAssemblyConnectionRole | "process-trunk",
	sourceId: string,
): SyntheticFabAssemblyRoutedOperation {
	const matches = links.filter(
		(link) =>
			link.role === role &&
			(link.kind === "process-trunk" ? link.wingId : link.sourceId) === sourceId,
	);
	if (matches.length !== 1) {
		throw new Error(`Expected one ${role} link for ${sourceId}; received ${matches.length}.`);
	}
	return matches[0] as SyntheticFabAssemblyRoutedOperation;
}
