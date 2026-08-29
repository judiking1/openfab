import { describe, expect, it } from "vitest";
import { ADVANCED_SWITCH_ALL_MOVEMENTS, deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import {
	PRODUCTION_BAY_MODULE_MINIMUM_GATEWAY_LENGTH_METERS,
	type ProductionBayBuildStepOwner,
	type ProductionBayModulePlan,
	type ProductionBayModuleRequest,
	planProductionBayModule,
} from "./ProductionBayModulePlanner";
import { recognizeProductionBayModule } from "./ProductionBayModuleRecognition";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
} from "./RailModuleOwnership";
import { planRailRouteBatch } from "./RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "./railShape";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import { encodeRailCell, TileMap } from "./TileMap";

describe("ProductionBayModuleRecognition", () => {
	it.each([
		"alternating",
		"co-rotating",
	] as const)("recognizes an exact %s Twin Bay without organization name, id, or record-order provenance", (internalFlowPattern) => {
		const fixture = productionBayFixture(request({ internalFlowPattern }));

		const result = recognizeProductionBayModule(
			fixture.map,
			fixture.organizations,
			fixture.bayOrganizationId,
		);

		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.recognition.plan.specification).toMatchObject({
			processLoopCount: 2,
			internalFlowPattern,
			gatewayLengthMeters: 1,
		});
		expect(result.recognition.processLoopOrganizationIdsByLoopId).toEqual({
			"process-loop-a": fixture.processLoopOrganizationIdsByLoopId["process-loop-a"],
			"process-loop-b": fixture.processLoopOrganizationIdsByLoopId["process-loop-b"],
		});
		expect(result.recognition.authoredDirectedEdgeKeys).toHaveLength(fixture.map.edgeCount);
		expect(result.recognition.authoredProjectionFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		expect(result.recognition.gatewayLengthMetersAliasDomain).toEqual({
			minimum: 1,
			maximum: 16,
		});
		expect(result.recognition.specificationAliasCount).toBe(16);
	});

	it("uses geometry to retain Process Loop identity for a reflected alternating Bay", () => {
		const fixture = productionBayFixture(
			request({
				internalFlowPattern: "alternating",
				pose: { forward: DIR_E, side: "left", flow: "forward" },
			}),
		);

		const result = recognizeProductionBayModule(
			fixture.map,
			fixture.organizations,
			fixture.bayOrganizationId,
		);

		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.recognition.plan.specification.pose.side).toBe("left");
		expect(result.recognition.processLoopOrganizationIdsByLoopId).toEqual(
			fixture.processLoopOrganizationIdsByLoopId,
		);
	});

	it("ignores unrelated detached rail and advanced-switch components while keeping the Bay exact", () => {
		const fixture = productionBayFixture(request({ internalFlowPattern: "co-rotating" }));
		addUnrelatedClosedLoop(fixture.map);
		addUnrelatedAdvancedSwitch(fixture.map);

		const result = recognizeProductionBayModule(
			fixture.map,
			fixture.organizations,
			fixture.bayOrganizationId,
		);

		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.recognition.authoredDirectedEdgeKeys).toHaveLength(fixture.plan.newEdges);
		expect(fixture.map.edgeCount).toBeGreaterThan(
			result.recognition.authoredDirectedEdgeKeys.length,
		);
	});

	it("rejects an unowned rail edge attached to the Bay component", () => {
		const fixture = productionBayFixture(request());
		const anchor = fixture.plan.outerLoop.origin;
		const anchorRail = fixture.map.getRail(anchor.x, anchor.y);
		fixture.map.setEncoded(
			anchor.x,
			anchor.y,
			encodeRailCell({ ...anchorRail, outgoing: anchorRail.outgoing | DIR_W }),
		);
		fixture.map.setEncoded(
			anchor.x - 1,
			anchor.y,
			encodeRailCell({ incoming: DIR_E, outgoing: 0 }),
		);

		const result = recognizeProductionBayModule(
			fixture.map,
			fixture.organizations,
			fixture.bayOrganizationId,
		);

		expect(result).toMatchObject({
			valid: false,
			issueCode: "INVALID_BAY_MEMBERSHIP",
		});
	});

	it("rejects a manually repartitioned rail even when the Bay effective edge union is unchanged", () => {
		const fixture = productionBayFixture(request());
		const organizations = moveOneProcessEdgeToBay(
			fixture.organizations,
			fixture.bayOrganizationId,
			fixture.processLoopOrganizationIdsByLoopId["process-loop-a"],
		);

		const result = recognizeProductionBayModule(
			fixture.map,
			organizations,
			fixture.bayOrganizationId,
		);

		expect(result).toMatchObject({
			valid: false,
			issueCode: "UNRECOGNIZED_BAY_GEOMETRY",
		});
	});

	it("rejects a detached Single Bay before planner matching", () => {
		const fixture = productionBayFixture(request({ processLoopCount: 1 }));

		const result = recognizeProductionBayModule(
			fixture.map,
			fixture.organizations,
			fixture.bayOrganizationId,
		);

		expect(result).toMatchObject({
			valid: false,
			issueCode: "NOT_DETACHED_TWIN_BAY",
		});
	});

	it.each(
		([DIR_N, DIR_E, DIR_S, DIR_W] as const).flatMap((forward) =>
			(["left", "right"] as const).flatMap((side) =>
				(["forward", "reverse"] as const).flatMap((flow) =>
					(["alternating", "co-rotating"] as const).map((internalFlowPattern) => ({
						forward,
						side,
						flow,
						internalFlowPattern,
					})),
				),
			),
		),
	)("keeps every valid gateway alias projection invariant for direction=$forward side=$side flow=$flow pattern=$internalFlowPattern", ({
		forward,
		side,
		flow,
		internalFlowPattern,
	}) => {
		const input = request({
			pose: { forward, side, flow },
			internalFlowPattern,
		});
		expectGatewayAliasesInvariant(input);
	});

	it.each([
		{
			outerLengthMeters: 9,
			shellMarginMeters: 3,
			outerDepthMeters: 21,
			processLoopGapMeters: 3,
		},
		{
			outerLengthMeters: 17,
			shellMarginMeters: 3,
			outerDepthMeters: 23,
			processLoopGapMeters: 5,
		},
		{
			outerLengthMeters: 40,
			shellMarginMeters: 4,
			outerDepthMeters: 25,
			processLoopGapMeters: 3,
		},
		{
			outerLengthMeters: 97,
			shellMarginMeters: 5,
			outerDepthMeters: 31,
			processLoopGapMeters: 5,
		},
	])("keeps the complete gateway alias domain invariant for $outerLengthMeters m length, $shellMarginMeters m shell, and $processLoopGapMeters m gap", (overrides) => {
		for (const internalFlowPattern of ["alternating", "co-rotating"] as const) {
			expectGatewayAliasesInvariant(request({ ...overrides, internalFlowPattern }));
		}
	});

	it("recognizes the full 2,000 m extent through a bounded alias-domain proof", () => {
		const maximalInput = request({
			outerLengthMeters: 2_000,
			gatewayLengthMeters: 996,
			internalFlowPattern: "co-rotating",
		});
		const boundaryProjection = semanticAuthoredProjection(
			planProductionBayModule({ ...maximalInput, gatewayLengthMeters: 1 }),
		);
		for (const gatewayLengthMeters of [498, 996]) {
			expect(
				semanticAuthoredProjection(
					planProductionBayModule({ ...maximalInput, gatewayLengthMeters }),
				),
			).toEqual(boundaryProjection);
		}
		const fixture = productionBayFixture(maximalInput);

		const result = recognizeProductionBayModule(
			fixture.map,
			fixture.organizations,
			fixture.bayOrganizationId,
		);

		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.recognition.gatewayLengthMetersAliasDomain).toEqual({
			minimum: 1,
			maximum: 996,
		});
		expect(result.recognition.specificationAliasCount).toBe(996);
	}, 10_000);
});

function semanticAuthoredProjection(plan: ProductionBayModulePlan): readonly string[] {
	return Object.freeze(
		plan.buildSteps
			.flatMap((step) =>
				step.route.slice(0, -1).map((from, index) => {
					const to = step.route[index + 1];
					if (!to) throw new Error(`Missing authored edge endpoint for ${step.id}.`);
					return `${step.owner}:${staticFabOrganizationEdgeKey({ from, to })}`;
				}),
			)
			.sort(),
	);
}

function expectGatewayAliasesInvariant(input: ProductionBayModuleRequest): void {
	const reference = semanticAuthoredProjection(
		planProductionBayModule({
			...input,
			gatewayLengthMeters: PRODUCTION_BAY_MODULE_MINIMUM_GATEWAY_LENGTH_METERS,
		}),
	);
	const processLoopLengthMeters = input.outerLengthMeters - input.shellMarginMeters * 2;
	const maximum = Math.floor((processLoopLengthMeters - 1) / 2);
	for (
		let gatewayLengthMeters = PRODUCTION_BAY_MODULE_MINIMUM_GATEWAY_LENGTH_METERS;
		gatewayLengthMeters <= maximum;
		gatewayLengthMeters++
	) {
		expect(
			semanticAuthoredProjection(planProductionBayModule({ ...input, gatewayLengthMeters })),
		).toEqual(reference);
	}
}

interface ProductionBayFixture {
	readonly map: TileMap;
	readonly plan: ProductionBayModulePlan;
	readonly organizations: StaticFabOrganizationState;
	readonly bayOrganizationId: number;
	readonly processLoopOrganizationIdsByLoopId: Readonly<
		Partial<Record<"process-loop-a" | "process-loop-b", number>>
	>;
}

function request(overrides: Partial<ProductionBayModuleRequest> = {}): ProductionBayModuleRequest {
	return {
		anchor: { x: -17, y: 23 },
		outerLengthMeters: 40,
		outerDepthMeters: 22,
		shellMarginMeters: 3,
		processLoopGapMeters: 4,
		gatewayLengthMeters: 6,
		processLoopCount: 2,
		internalFlowPattern: "alternating",
		pose: { forward: DIR_E, side: "right", flow: "forward" },
		...overrides,
	};
}

function productionBayFixture(input: ProductionBayModuleRequest): ProductionBayFixture {
	const plan = planProductionBayModule(input);
	const map = materializePlan(plan);
	const modulesByOwner = semanticModulesByOwner(map, plan);
	const bayOrganizationId = 41;
	const processLoopOrganizationIdsByLoopId = Object.freeze({
		"process-loop-a": 93,
		...(plan.processLoops.some((loop) => loop.id === "process-loop-b")
			? { "process-loop-b": 7 }
			: {}),
	});
	const records: StaticFabOrganizationRecord[] = [
		organizationRecord(
			bayOrganizationId,
			"BAY",
			"Arbitrary root label",
			[],
			modulesByOwner.get("BAY") ?? [],
		),
	];
	for (const loop of plan.processLoops) {
		if (loop.id !== "process-loop-a" && loop.id !== "process-loop-b") {
			throw new Error(`Unexpected fixture Process Loop id ${loop.id}.`);
		}
		const loopId = loop.id;
		const organizationId = processLoopOrganizationIdsByLoopId[loopId];
		if (organizationId === undefined) throw new Error(`Missing fixture id for ${loopId}.`);
		records.push(
			organizationRecord(
				organizationId,
				"AISLE",
				`Unrelated label ${organizationId}`,
				[bayOrganizationId],
				modulesByOwner.get(loopId) ?? [],
			),
		);
	}
	// Deliberately neither id-sorted nor semantic-order-sorted: recognition may use only the DAG.
	const shuffled = Object.freeze(
		records.length === 3
			? [
					records[1] as StaticFabOrganizationRecord,
					records[0] as StaticFabOrganizationRecord,
					records[2] as StaticFabOrganizationRecord,
				]
			: [...records].reverse(),
	);
	return Object.freeze({
		map,
		plan,
		organizations: Object.freeze({ nextOrganizationId: 100, records: shuffled }),
		bayOrganizationId,
		processLoopOrganizationIdsByLoopId,
	});
}

function materializePlan(plan: ProductionBayModulePlan): TileMap {
	const map = new TileMap();
	const construction = planRailRouteBatch(map, plan.buildRoutes, "free-closed-primary");
	if (!construction.valid) throw new Error(construction.reason);
	for (const mutation of construction.mutations) {
		map.setEncoded(mutation.x, mutation.y, mutation.after);
	}
	return map;
}

function addUnrelatedClosedLoop(target: TileMap): void {
	const route = planProductionBayModule(request({ anchor: { x: 1_000, y: 1_000 } })).outerLoop
		.cells;
	const isolated = new TileMap();
	const construction = planRailRouteBatch(isolated, [route], "free-closed-primary");
	if (!construction.valid) throw new Error(construction.reason);
	for (const mutation of construction.mutations) {
		if (target.getEncoded(mutation.x, mutation.y) !== 0) {
			throw new Error("Unrelated fixture component overlaps the Production Bay.");
		}
		target.setEncoded(mutation.x, mutation.y, mutation.after);
	}
}

function addUnrelatedAdvancedSwitch(target: TileMap): void {
	const record = Object.freeze({
		id: 701,
		profileClass: "A" as const,
		origin: Object.freeze({ x: 2_000, y: 2_000 }),
		forward: DIR_E,
		lateral: DIR_S,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	});
	const geometry = deriveAdvancedSwitchGeometry(record);
	for (const cell of geometry.cellStates) {
		if (target.getEncoded(cell.x, cell.y) !== 0) {
			throw new Error("Unrelated advanced-switch fixture overlaps existing rail.");
		}
		target.setEncoded(cell.x, cell.y, cell.encoded);
	}
	target.setAdvancedSwitch(record);
}

function semanticModulesByOwner(
	map: TileMap,
	plan: ProductionBayModulePlan,
): ReadonlyMap<ProductionBayBuildStepOwner, readonly RailModuleOwnership[]> {
	const semanticOwnerByEdge = new Map<string, ProductionBayBuildStepOwner>();
	for (const step of plan.buildSteps) {
		for (let index = 0; index < step.route.length - 1; index++) {
			const from = step.route[index];
			const to = step.route[index + 1];
			if (!from || !to) throw new Error(`Malformed fixture step ${step.id}.`);
			semanticOwnerByEdge.set(staticFabOrganizationEdgeKey({ from, to }), step.owner);
		}
	}
	const modulesByOwner = new Map<ProductionBayBuildStepOwner, RailModuleOwnership[]>();
	for (const module of buildRailModuleOwnershipIndex(map).modules) {
		const owners = new Set<ProductionBayBuildStepOwner>();
		for (const edge of module.eraseEdges) {
			const owner = semanticOwnerByEdge.get(staticFabOrganizationEdgeKey(edge));
			if (!owner) throw new Error(`Fixture module ${module.key} contains an unowned edge.`);
			owners.add(owner);
		}
		const owner = owners.has("BAY")
			? "BAY"
			: owners.size === 1
				? ([...owners][0] as ProductionBayBuildStepOwner)
				: null;
		if (!owner) throw new Error(`Fixture module ${module.key} crosses Process Loop owners.`);
		const owned = modulesByOwner.get(owner) ?? [];
		owned.push(module);
		modulesByOwner.set(owner, owned);
	}
	return modulesByOwner;
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	parentOrganizationIds: readonly number[],
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		membership: membershipFromModules(modules),
	});
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationMembership {
	const railEdges = new Map<string, DirectedRailEdge>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) railEdges.set(staticFabOrganizationEdgeKey(edge), edge);
	}
	return Object.freeze({
		railEdges: Object.freeze([...railEdges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([]),
	});
}

function moveOneProcessEdgeToBay(
	organizations: StaticFabOrganizationState,
	bayOrganizationId: number,
	processLoopOrganizationId: number | undefined,
): StaticFabOrganizationState {
	if (processLoopOrganizationId === undefined) throw new Error("Missing Process Loop fixture id.");
	const processLoop = organizations.records.find(
		(record) => record.id === processLoopOrganizationId,
	);
	const bay = organizations.records.find((record) => record.id === bayOrganizationId);
	if (!processLoop || !bay) throw new Error("Missing fixture organization.");
	const moved = processLoop.membership.railEdges.find(
		(edge) => edge.from.x > -10 && edge.from.x < 10,
	);
	if (!moved) throw new Error("Missing an interior Process Loop edge for manual repartitioning.");
	const movedKey = staticFabOrganizationEdgeKey(moved);
	const nextProcessMembership = Object.freeze({
		...processLoop.membership,
		railEdges: Object.freeze(
			processLoop.membership.railEdges.filter(
				(edge) => staticFabOrganizationEdgeKey(edge) !== movedKey,
			),
		),
	});
	const nextBayMembership = Object.freeze({
		...bay.membership,
		railEdges: Object.freeze([...bay.membership.railEdges, moved].sort(compareDirectedRailEdges)),
	});
	return Object.freeze({
		...organizations,
		records: Object.freeze(
			organizations.records.map((record) =>
				record.id === bay.id
					? Object.freeze({ ...record, membership: nextBayMembership })
					: record.id === processLoop.id
						? Object.freeze({ ...record, membership: nextProcessMembership })
						: record,
			),
		),
	});
}
