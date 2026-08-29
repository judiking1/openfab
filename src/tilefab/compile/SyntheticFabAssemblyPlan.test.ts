import { describe, expect, it } from "vitest";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import { syntheticFabStarterSchematicFromAssemblyPlan } from "../render/SyntheticFabStarterSchematic";
import {
	createSyntheticFabAssemblyPlan,
	fingerprintSyntheticFabAssemblyPlan,
	SYNTHETIC_FAB_ASSEMBLY_PLAN_VERSION,
	type SyntheticFabAssemblyLinkOperation,
} from "./SyntheticFabAssemblyPlan";
import { buildSyntheticFabStarter, defaultSyntheticFabStarterRequest } from "./SyntheticFabStarter";

describe("SyntheticFabAssemblyPlan", () => {
	it.each([
		[50, 3, 20],
		[50, 6, 24],
		[60, 3, 20],
		[60, 6, 24],
		[100, 3, 24],
		[100, 6, 20],
		[100, 6, 24],
	] as const)("is deterministic for %i Bays, %i Blocks, and %i m pitch", (totalBayCount, processBlockCount, bayPitchMeters) => {
		const profile = { totalBayCount, processBlockCount };
		const first = createSyntheticFabAssemblyPlan(profile, bayPitchMeters);
		const second = createSyntheticFabAssemblyPlan(profile, bayPitchMeters);

		expect(first.version).toBe(SYNTHETIC_FAB_ASSEMBLY_PLAN_VERSION);
		expect(first.planFingerprint).toBe(second.planFingerprint);
		expect(first.operations).toEqual(second.operations);
		expect(first.topology.wings.reduce((sum, wing) => sum + wing.bayCount, 0)).toBe(totalBayCount);
		expect(first.operations.map((operation) => operation.id)).toEqual(
			second.operations.map((operation) => operation.id),
		);
	});

	it("orders three circulation circuits, process-row trunks, and cardinal links", () => {
		const plan = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const operations = plan.operations;
		const ids = operations.map((operation) => operation.id);

		expect(ids).toHaveLength(new Set(ids).size);
		expect(
			operations
				.slice(0, 3)
				.map((operation) => (operation.kind === "circuit" ? operation.role : operation.kind)),
		).toEqual(["outer-circulation", "wall-circuit", "interbay-spine"]);
		expect(operations.filter((operation) => operation.kind === "process-trunk")).toHaveLength(12);
		expect(
			operations.filter(
				(operation) => operation.kind === "process-trunk" && operation.role === "process-trunk",
			),
		).toHaveLength(12);
		expect(operations.filter((operation) => operation.kind === "link")).toHaveLength(6);
		expect(
			operations.filter(
				(operation) => operation.kind === "link" && operation.role === "spine-wall",
			),
		).toHaveLength(2);
		expect(
			operations.filter(
				(operation) => operation.kind === "link" && operation.role === "wall-outer",
			),
		).toHaveLength(4);
	});

	it("materializes deterministic, serializable run and corridor contracts for every link", () => {
		const plan = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const links = plan.operations.filter(
			(
				operation,
			): operation is Extract<
				(typeof plan.operations)[number],
				{ kind: "process-trunk" | "link" }
			> => operation.kind === "process-trunk" || operation.kind === "link",
		);
		const runIds = new Set<string>();

		expect(links).toHaveLength(18);
		for (const link of links) {
			expect(link.sourceRun.ownerId, link.id).toBe(link.sourceId);
			expect(link.targetRun.ownerId, link.id).toBe(link.targetId);
			expect(link.sourceRun.side, link.id).toBe(link.sourceSide);
			expect(link.targetRun.side, link.id).toBe(link.targetSide);
			expect(Object.isFrozen(link.sourceRun), link.id).toBe(true);
			expect(Object.isFrozen(link.sourceRun.anchor), link.id).toBe(true);
			expect(Object.isFrozen(link.targetRun), link.id).toBe(true);
			expect(Object.isFrozen(link.targetRun.anchor), link.id).toBe(true);
			expect(Object.isFrozen(link.corridor), link.id).toBe(true);
			expectRunContract(link.sourceRun, link.id);
			expectRunContract(link.targetRun, link.id);
			expectCorridorContainsRun(link.corridor, link.sourceRun, link.id);
			expectCorridorContainsRun(link.corridor, link.targetRun, link.id);
			if (link.kind === "process-trunk") {
				expect(Object.isFrozen(link.exactJunctions), link.id).toBe(true);
				for (const junction of Object.values(link.exactJunctions)) {
					expect(Object.isFrozen(junction), link.id).toBe(true);
				}
				expectJunctionOnRun(link.exactJunctions.sourceDeparture, link.sourceRun, link.id);
				expectJunctionOnRun(link.exactJunctions.sourceArrival, link.sourceRun, link.id);
				expectJunctionOnRun(link.exactJunctions.targetArrival, link.targetRun, link.id);
				expectJunctionOnRun(link.exactJunctions.targetDeparture, link.targetRun, link.id);
				expect(link.exactJunctions.sourceDeparture.y, link.id).toBe(
					link.exactJunctions.targetArrival.y,
				);
				expect(link.exactJunctions.sourceArrival.y, link.id).toBe(
					link.exactJunctions.targetDeparture.y,
				);
				expect(
					Math.abs(link.exactJunctions.sourceDeparture.y - link.exactJunctions.sourceArrival.y),
					link.id,
				).toBe(8);
			}
			runIds.add(link.sourceRun.id);
			runIds.add(link.targetRun.id);
		}
		expect(runIds.size).toBe(links.length * 2);

		const restored = JSON.parse(JSON.stringify(plan)) as typeof plan;
		expect(restored.operations).toEqual(plan.operations);
		expect(fingerprintSyntheticFabAssemblyPlan(restored)).toBe(plan.planFingerprint);
	});

	it("drives both schematic and exact materialization from the same operation stream", () => {
		const plan = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const schematic = syntheticFabStarterSchematicFromAssemblyPlan(plan);
		const build = buildSyntheticFabStarter(defaultSyntheticFabStarterRequest("large-fab-60"));
		const plannedEntityIds = plan.operations.flatMap((operation) =>
			operation.kind === "circuit"
				? [operation.id]
				: operation.kind === "process-trunk"
					? operation.wing.profile.bays.map((bay) => bay.id)
					: [],
		);
		const materializedEntityIds = build.steps
			.filter((step) => step.kind === "template")
			.map((step) => step.entityId);
		const plannedConnectionIds = plan.operations
			.filter((operation) => operation.kind === "process-trunk" || operation.kind === "link")
			.map((operation) => operation.id);
		const materializedConnectionIds = build.steps
			.filter((step) => step.kind === "network-link")
			.map((step) => step.connectionId);

		expect(schematic.planFingerprint).toBe(plan.planFingerprint);
		expect(build.planFingerprint).toBe(plan.planFingerprint);
		expect(materializedEntityIds).toEqual(plannedEntityIds);
		expect(materializedConnectionIds).toEqual(plannedConnectionIds);
		expect(build.summary.openTerminals).toBe(0);
		expect(build.summary.strongComponents).toBe(1);
	}, 30_000);

	it("changes its fingerprint when scale or pitch changes", () => {
		const base = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const variants = [
			createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 61 }, 20),
			createSyntheticFabAssemblyPlan({ processBlockCount: 4, totalBayCount: 60 }, 20),
			createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 21),
		];

		expect(new Set(variants.map((variant) => variant.planFingerprint))).toHaveLength(3);
		for (const variant of variants) expect(variant.planFingerprint).not.toBe(base.planFingerprint);
	});

	it("keeps shared circuit, trunk, and Bay identities stable while factory capacity grows", () => {
		const plans = [50, 60, 100].map((totalBayCount) =>
			createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount }, 20),
		);
		const operationIds = plans.map((plan) => plan.operations.map((operation) => operation.id));
		expect(operationIds[1]).toEqual(operationIds[0]);
		expect(operationIds[2]).toEqual(operationIds[0]);

		const smallest = plans[0];
		if (!smallest) throw new Error("Expected the 50 Bay plan.");
		for (const smallWing of smallest.layout.wings) {
			for (const larger of plans.slice(1)) {
				const largeWing = larger.layout.wings.find((wing) => wing.id === smallWing.id);
				if (!largeWing) throw new Error(`Missing stable Wing ${smallWing.id}.`);
				expect(
					largeWing.bays.slice(0, smallWing.bays.length).map((bay) => bay.id),
					smallWing.id,
				).toEqual(smallWing.bays.map((bay) => bay.id));
			}
		}
	});

	it("keeps existing semantic identities stable when Process Blocks are appended", () => {
		const compact = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const expanded = createSyntheticFabAssemblyPlan(
			{ processBlockCount: 6, totalBayCount: 60 },
			20,
		);
		const expandedOperationIds = new Set(expanded.operations.map((operation) => operation.id));
		for (const operation of compact.operations) {
			expect(expandedOperationIds, operation.id).toContain(operation.id);
		}
		for (const compactWing of compact.layout.wings) {
			const expandedWing = expanded.layout.wings.find((wing) => wing.id === compactWing.id);
			if (!expandedWing) throw new Error(`Missing stable Wing ${compactWing.id}.`);
			const sharedBayCount = Math.min(compactWing.bays.length, expandedWing.bays.length);
			expect(
				expandedWing.bays.slice(0, sharedBayCount).map((bay) => bay.id),
				compactWing.id,
			).toEqual(compactWing.bays.slice(0, sharedBayCount).map((bay) => bay.id));
		}
		expect(
			expanded.layout.blocks.slice(0, compact.layout.blocks.length).map((block) => block.id),
		).toEqual(compact.layout.blocks.map((block) => block.id));
	});

	it("fingerprints process-trunk identity and link-window inputs used by exact materialization", () => {
		const plan = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const firstTrunkIndex = plan.operations.findIndex(
			(operation) => operation.kind === "process-trunk",
		);
		if (firstTrunkIndex < 0) throw new Error("Expected a process trunk operation.");
		const changedIdentityOperations = plan.operations.map((operation, index) =>
			index === firstTrunkIndex && operation.kind === "process-trunk"
				? { ...operation, rowId: `${operation.rowId}:changed` }
				: operation,
		);

		expect(
			fingerprintSyntheticFabAssemblyPlan({ ...plan, operations: changedIdentityOperations }),
		).not.toBe(plan.planFingerprint);
		expect(
			fingerprintSyntheticFabAssemblyPlan({
				...plan,
				topology: {
					...plan.topology,
					rowLinkWindowMeters: plan.topology.rowLinkWindowMeters + 2,
				},
			}),
		).not.toBe(plan.planFingerprint);
		const firstTrunk = plan.operations[firstTrunkIndex];
		if (firstTrunk?.kind !== "process-trunk") throw new Error("Expected a process trunk.");
		const changedJunctionOperations = plan.operations.map((operation, index) =>
			index === firstTrunkIndex && operation.kind === "process-trunk"
				? {
						...operation,
						exactJunctions: {
							...operation.exactJunctions,
							sourceDeparture: {
								...operation.exactJunctions.sourceDeparture,
								y: operation.exactJunctions.sourceDeparture.y + 1,
							},
						},
					}
				: operation,
		);
		expect(
			fingerprintSyntheticFabAssemblyPlan({ ...plan, operations: changedJunctionOperations }),
		).not.toBe(plan.planFingerprint);
	});

	it("fingerprints explicit link run identity, orientation, and corridor bounds", () => {
		const plan = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const firstLinkIndex = plan.operations.findIndex((operation) => operation.kind === "link");
		const firstLink = plan.operations[firstLinkIndex];
		if (firstLinkIndex < 0 || firstLink?.kind !== "link") {
			throw new Error("Expected a link operation.");
		}
		const variants: readonly SyntheticFabAssemblyLinkOperation[] = [
			{
				...firstLink,
				sourceRun: { ...firstLink.sourceRun, id: `${firstLink.sourceRun.id}:changed` },
			},
			{
				...firstLink,
				sourceRun: {
					...firstLink.sourceRun,
					flowDirection: firstLink.sourceRun.flowDirection === DIR_E ? DIR_W : DIR_E,
				},
			},
			{
				...firstLink,
				corridor: { ...firstLink.corridor, maxX: firstLink.corridor.maxX + 1 },
			},
		];

		for (const variant of variants) {
			const operations = plan.operations.map((operation, index) =>
				index === firstLinkIndex ? variant : operation,
			);
			expect(fingerprintSyntheticFabAssemblyPlan({ ...plan, operations })).not.toBe(
				plan.planFingerprint,
			);
		}
	});

	it("canonicalizes semantic collections independently of their source array order", () => {
		const plan = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const reordered = {
			...plan,
			topology: {
				...plan.topology,
				wings: [...plan.topology.wings].reverse(),
				processRows: [...plan.topology.processRows].reverse(),
				processBanks: [...plan.topology.processBanks].reverse(),
				processBlocks: [...plan.topology.processBlocks].reverse(),
				spineWallLinks: [...plan.topology.spineWallLinks].reverse(),
				wallOuterLinks: [...plan.topology.wallOuterLinks].reverse(),
			},
			layout: {
				...plan.layout,
				wings: [...plan.layout.wings].reverse(),
				rows: [...plan.layout.rows].reverse(),
				banks: [...plan.layout.banks].reverse(),
				blocks: [...plan.layout.blocks].reverse(),
				spineWallGateways: [...plan.layout.spineWallGateways].reverse(),
				wallOuterGateways: [...plan.layout.wallOuterGateways].reverse(),
			},
		};

		expect(fingerprintSyntheticFabAssemblyPlan(reordered)).toBe(plan.planFingerprint);
	});

	it("fingerprints topology Row, Bank, and Block metadata and membership", () => {
		const plan = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const [firstRow, secondRow] = plan.topology.processRows;
		const [firstBank, secondBank] = plan.topology.processBanks;
		const [firstBlock, secondBlock] = plan.topology.processBlocks;
		if (!(firstRow && secondRow && firstBank && secondBank && firstBlock && secondBlock)) {
			throw new Error("Expected multiple topology rows, banks, and blocks.");
		}
		const variants = [
			{
				...plan,
				topology: {
					...plan.topology,
					processRows: [
						{ ...firstRow, label: `${firstRow.label} CHANGED` },
						...plan.topology.processRows.slice(1),
					],
				},
			},
			{
				...plan,
				topology: {
					...plan.topology,
					processRows: [
						{ ...firstRow, leftWingId: secondRow.leftWingId },
						...plan.topology.processRows.slice(1),
					],
				},
			},
			{
				...plan,
				topology: {
					...plan.topology,
					processBanks: [
						{ ...firstBank, label: `${firstBank.label} CHANGED` },
						...plan.topology.processBanks.slice(1),
					],
				},
			},
			{
				...plan,
				topology: {
					...plan.topology,
					processBanks: [
						{ ...firstBank, upperWingId: secondBank.upperWingId },
						...plan.topology.processBanks.slice(1),
					],
				},
			},
			{
				...plan,
				topology: {
					...plan.topology,
					processBlocks: [
						{ ...firstBlock, label: `${firstBlock.label} CHANGED` },
						...plan.topology.processBlocks.slice(1),
					],
				},
			},
			{
				...plan,
				topology: {
					...plan.topology,
					processBlocks: [
						{ ...firstBlock, rightBankId: secondBlock.rightBankId },
						...plan.topology.processBlocks.slice(1),
					],
				},
			},
		];

		for (const variant of variants) {
			expect(fingerprintSyntheticFabAssemblyPlan(variant)).not.toBe(plan.planFingerprint);
		}
	});

	it("fingerprints layout Row, Bank, Block, corridor, and Gateway identity", () => {
		const plan = createSyntheticFabAssemblyPlan({ processBlockCount: 3, totalBayCount: 60 }, 20);
		const [firstRow, secondRow] = plan.layout.rows;
		const [firstBank, secondBank] = plan.layout.banks;
		const [firstBlock, secondBlock] = plan.layout.blocks;
		const [firstGateway, secondGateway] = plan.layout.wallOuterGateways;
		if (!(firstRow && secondRow && firstBank && secondBank && firstBlock && secondBlock)) {
			throw new Error("Expected multiple layout rows, banks, and blocks.");
		}
		if (!(firstGateway && secondGateway)) {
			throw new Error("Expected multiple layout gateways.");
		}
		const variants = [
			{
				...plan,
				layout: {
					...plan.layout,
					rows: [{ ...firstRow, label: `${firstRow.label} CHANGED` }, ...plan.layout.rows.slice(1)],
				},
			},
			{
				...plan,
				layout: {
					...plan.layout,
					rows: [
						{
							...firstRow,
							corridor: {
								...firstRow.corridor,
								windowMaxY: firstRow.corridor.windowMaxY + 1,
							},
						},
						...plan.layout.rows.slice(1),
					],
				},
			},
			{
				...plan,
				layout: {
					...plan.layout,
					banks: [{ ...firstBank, lowerWing: secondBank.lowerWing }, ...plan.layout.banks.slice(1)],
				},
			},
			{
				...plan,
				layout: {
					...plan.layout,
					blocks: [
						{ ...firstBlock, upperRow: secondBlock.upperRow },
						...plan.layout.blocks.slice(1),
					],
				},
			},
			{
				...plan,
				layout: {
					...plan.layout,
					wallOuterGateways: [
						{ ...firstGateway, targetId: `${firstGateway.targetId}-CHANGED` },
						...plan.layout.wallOuterGateways.slice(1),
					],
				},
			},
			{
				...plan,
				layout: {
					...plan.layout,
					wallOuterGateways: [
						{ ...firstGateway, center: firstGateway.center + 1 },
						...plan.layout.wallOuterGateways.slice(1),
					],
				},
			},
		];

		for (const variant of variants) {
			expect(fingerprintSyntheticFabAssemblyPlan(variant)).not.toBe(plan.planFingerprint);
		}
	});
});

function expectRunContract(
	run: Extract<
		ReturnType<typeof createSyntheticFabAssemblyPlan>["operations"][number],
		{ readonly sourceRun: unknown }
	>["sourceRun"],
	label: string,
): void {
	const expectedAxis = run.side === "north" || run.side === "south" ? "x" : "y";
	expect(run.id, label).toBe(
		`${run.ownerId}:${run.side}:${run.axis}:${run.fixedCoordinate}:${run.minimum}:${run.maximum}`,
	);
	expect(run.axis, label).toBe(expectedAxis);
	expect(run.minimum, label).toBeLessThanOrEqual(run.maximum);
	expect(new Set([DIR_N, DIR_E, DIR_S, DIR_W]).has(run.flowDirection), label).toBe(true);
	if (run.axis === "x") {
		expect(run.anchor, label).toEqual({
			x: Math.floor((run.minimum + run.maximum) / 2),
			y: run.fixedCoordinate,
		});
	} else {
		expect(run.anchor, label).toEqual({
			x: run.fixedCoordinate,
			y: Math.floor((run.minimum + run.maximum) / 2),
		});
	}
}

function expectJunctionOnRun(
	cell: { readonly x: number; readonly y: number },
	run: Extract<
		ReturnType<typeof createSyntheticFabAssemblyPlan>["operations"][number],
		{ readonly sourceRun: unknown }
	>["sourceRun"],
	label: string,
): void {
	const variable = run.axis === "x" ? cell.x : cell.y;
	const fixed = run.axis === "x" ? cell.y : cell.x;
	expect(fixed, label).toBe(run.fixedCoordinate);
	expect(variable, label).toBeGreaterThanOrEqual(run.minimum);
	expect(variable, label).toBeLessThanOrEqual(run.maximum);
}

function expectCorridorContainsRun(
	corridor: Extract<
		ReturnType<typeof createSyntheticFabAssemblyPlan>["operations"][number],
		{ readonly sourceRun: unknown }
	>["corridor"],
	run: Extract<
		ReturnType<typeof createSyntheticFabAssemblyPlan>["operations"][number],
		{ readonly sourceRun: unknown }
	>["sourceRun"],
	label: string,
): void {
	const minimumPoint =
		run.axis === "x"
			? { x: run.minimum, y: run.fixedCoordinate }
			: { x: run.fixedCoordinate, y: run.minimum };
	const maximumPoint =
		run.axis === "x"
			? { x: run.maximum, y: run.fixedCoordinate }
			: { x: run.fixedCoordinate, y: run.maximum };
	for (const point of [minimumPoint, maximumPoint, run.anchor]) {
		expect(point.x, label).toBeGreaterThanOrEqual(corridor.minX);
		expect(point.x, label).toBeLessThanOrEqual(corridor.maxX);
		expect(point.y, label).toBeGreaterThanOrEqual(corridor.minY);
		expect(point.y, label).toBeLessThanOrEqual(corridor.maxY);
	}
}
