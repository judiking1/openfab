import { describe, expect, it } from "vitest";
import { directionBetween } from "../core/railShape";
import type { StaticFabAssemblyConnectorPlan } from "../core/StaticFabAssemblyConnector";
import type {
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { createStaticFabOuterCirculationIndex } from "../core/StaticFabOuterCirculation";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	appliedResilientFabLoopEvidence,
	appliedResilientFabLoopEvidenceIsCurrent,
	ordinaryResilientFabChecksHandoff,
	ordinaryResilientFabLoopReceiptBankPair,
	resilientFabLoopUndoProjectionExists,
} from "./OrdinaryResilientFabChecksHandoff";

describe("AppliedResilientFabLoopEvidence", () => {
	it("binds one non-allocating FAB_LOOP to its exact rail and organization projections", () => {
		const fixture = loopFixture();
		const evidence = appliedResilientFabLoopEvidence(
			fixture.plan,
			fixture.beforeMap,
			fixture.beforeOrganizations,
		);
		expect(evidence).toMatchObject({
			fabOrganizationId: 15,
			connectedBayBankOrganizationIds: [7, 14],
			nextOrganizationId: 20,
		});
		if (!evidence) throw new Error("Expected exact FAB_LOOP evidence.");
		expect(evidence.addedOutboundRailEdges.length).toBeGreaterThan(0);
		expect(evidence.addedReturnRailEdges.length).toBeGreaterThan(0);
		expect(
			appliedResilientFabLoopEvidenceIsCurrent(
				fixture.afterMap,
				fixture.afterOrganizations,
				evidence,
			),
		).toBe(true);
		expect(
			resilientFabLoopUndoProjectionExists(
				fixture.beforeMap,
				fixture.beforeOrganizations,
				evidence,
			),
		).toBe(true);
		expect(
			ordinaryResilientFabLoopReceiptBankPair(
				new Map(fixture.beforeOrganizations.records.map((record) => [record.id, record])),
				[15],
				evidence,
			),
		).toEqual([7, 14]);
	});

	it("fails closed for stale cells, stale Fab ownership, allocator drift, and another selection", () => {
		const fixture = loopFixture();
		const evidence = appliedResilientFabLoopEvidence(
			fixture.plan,
			fixture.beforeMap,
			fixture.beforeOrganizations,
		);
		if (!evidence) throw new Error("Expected exact FAB_LOOP evidence.");
		expect(
			appliedResilientFabLoopEvidenceIsCurrent(
				fixture.beforeMap,
				fixture.afterOrganizations,
				evidence,
			),
		).toBe(false);
		expect(
			appliedResilientFabLoopEvidenceIsCurrent(
				fixture.afterMap,
				fixture.beforeOrganizations,
				evidence,
			),
		).toBe(false);
		expect(
			appliedResilientFabLoopEvidenceIsCurrent(
				fixture.afterMap,
				state(fixture.afterOrganizations.records, 21),
				evidence,
			),
		).toBe(false);
		expect(
			ordinaryResilientFabLoopReceiptBankPair(
				new Map(fixture.afterOrganizations.records.map((record) => [record.id, record])),
				[7],
				evidence,
			),
		).toBeNull();
	});

	it.each([
		["wrong purpose", { purpose: "HIERARCHY_LINK" }],
		["wrong role", { hierarchyRole: "BAY_TO_BANK" }],
		["created Fab", { createdFab: true }],
		["allocator consumption", { nextOrganizationIdAfter: 21 }],
		["empty rail patch", { emptyRailMutations: true }],
	] as const)("rejects %s", (_label, override) => {
		const fixture = loopFixture(override);
		expect(
			appliedResilientFabLoopEvidence(fixture.plan, fixture.beforeMap, fixture.beforeOrganizations),
		).toBeNull();
	});

	it("keeps exact projection validation bounded with 100,000 unrelated organizations", () => {
		const fixture = loopFixture();
		const unrelated = Array.from({ length: 100_000 }, (_, index) =>
			record(index + 100, "PROCESS_FAMILY"),
		);
		const beforeOrganizations = state(
			[...fixture.beforeOrganizations.records, ...unrelated],
			100_100,
		);
		const afterOrganizations = state(
			[...fixture.afterOrganizations.records, ...unrelated],
			100_100,
		);
		const plan = {
			...fixture.plan,
			nextOrganizationIdBefore: 100_100,
			nextOrganizationIdAfter: 100_100,
		} as StaticFabAssemblyConnectorPlan;
		const beforeIndex = createStaticFabOuterCirculationIndex(beforeOrganizations);
		const afterIndex = createStaticFabOuterCirculationIndex(afterOrganizations);
		const startedAt = performance.now();
		const evidence = appliedResilientFabLoopEvidence(
			plan,
			fixture.beforeMap,
			beforeOrganizations,
			beforeIndex,
		);
		if (!evidence) throw new Error("Expected large-map FAB_LOOP evidence.");
		expect(
			appliedResilientFabLoopEvidenceIsCurrent(
				fixture.afterMap,
				afterOrganizations,
				evidence,
				afterIndex,
			),
		).toBe(true);
		expect(performance.now() - startedAt).toBeLessThan(60);
	}, 10_000);

	it("keeps Apply receipt capture bounded when the selected Fab already owns 100,000 edges", () => {
		const fixture = loopFixture();
		const baseFab = fixture.beforeOrganizations.records.find((item) => item.id === 15);
		const plannedFab = fixture.plan.organizationMutations.find((item) => item.id === 15)?.after;
		if (!baseFab || !plannedFab) throw new Error("Expected the fixture Fab mutation.");
		const existingEdges = Array.from({ length: 100_000 }, (_, index) =>
			edge(index + 100, 10, index + 101, 10),
		);
		const largeFabBefore = record(
			15,
			"AREA",
			[],
			[...baseFab.membership.railEdges, ...existingEdges],
		);
		const largeFabAfter = record(
			15,
			"AREA",
			[],
			[...plannedFab.membership.railEdges, ...existingEdges],
		);
		const organizations = state(hierarchy(largeFabBefore), 20);
		const plan = {
			...fixture.plan,
			organizationMutations: Object.freeze([
				Object.freeze({ id: 15, before: largeFabBefore, after: largeFabAfter }),
			]),
		} as StaticFabAssemblyConnectorPlan;
		const index = createStaticFabOuterCirculationIndex(organizations);
		const startedAt = performance.now();
		expect(
			appliedResilientFabLoopEvidence(plan, fixture.beforeMap, organizations, index),
		).not.toBeNull();
		expect(performance.now() - startedAt).toBeLessThan(60);
	}, 10_000);

	it("fails closed instead of rebuilding when the supplied source index is stale", () => {
		const fixture = loopFixture();
		const staleIndex = createStaticFabOuterCirculationIndex(fixture.beforeOrganizations);
		const equivalentButNewSource = state(fixture.beforeOrganizations.records, 20);
		expect(
			appliedResilientFabLoopEvidence(
				fixture.plan,
				fixture.beforeMap,
				equivalentButNewSource,
				staleIndex,
			),
		).toBeNull();
	});
});

const READY_HANDOFF = Object.freeze({
	selectedOrganizationIds: Object.freeze([15]),
	selectedFabOrganizationId: 15,
	connectedBayBankOrganizationIds: Object.freeze([7, 14] as const),
	resilientFabLoopCurrent: true,
	exactDirectBankPair: true,
	redoAvailable: false,
	guidedBuildActive: false,
	placementPending: false,
	exclusiveCommandActive: false,
	readyForChecks: true,
});

describe("ordinaryResilientFabChecksHandoff", () => {
	it("offers one project-neutral CHECKS continuation", () => {
		expect(ordinaryResilientFabChecksHandoff(READY_HANDOFF)).toEqual({
			action: "open-static-fab-checks",
			label: "다음 · 정적 FAB 검사",
			instruction: "현재 프로젝트의 레일·포트·장비·조직 결과 확인",
			ariaLabel:
				"다음 · 정적 FAB 검사. 선택한 Fab의 두 Bay Bank 사이 외곽 순환을 포함한 현재 프로젝트 전체 검사를 엽니다. 검사를 여는 것만으로 프로젝트는 변경되지 않습니다",
			description:
				"선택한 Fab의 외곽 순환을 포함한 현재 프로젝트 전체 검사를 엽니다. 검사를 여는 것만으로 프로젝트는 변경되지 않습니다. Escape 또는 닫기로 선택한 Fab으로 돌아옵니다.",
		});
	});

	it.each([
		["without one exact selection", { selectedOrganizationIds: Object.freeze([7, 15]) }],
		["without a semantic Fab", { selectedFabOrganizationId: null }],
		["for another Fab", { selectedOrganizationIds: Object.freeze([16]) }],
		["without the exact Bank pair", { connectedBayBankOrganizationIds: null }],
		["without resilient circulation", { resilientFabLoopCurrent: false }],
		["when the pair is not the complete direct Bank set", { exactDirectBankPair: false }],
		["after Undo exposes Redo", { redoAvailable: true }],
		["inside Guided Build", { guidedBuildActive: true }],
		["while placement is pending", { placementPending: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while CHECKS is unavailable", { readyForChecks: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryResilientFabChecksHandoff({ ...READY_HANDOFF, ...override })).toBeNull();
	});
});

function loopFixture(override: Readonly<Record<string, unknown>> = {}) {
	const beforeMap = new TileMap();
	const firstOutboundCells = cells([
		[0, 0],
		[1, 0],
		[2, 0],
		[3, 0],
		[4, 0],
	]);
	const firstReturnCells = cells([
		[4, 0],
		[4, -1],
		[3, -1],
		[2, -1],
		[1, -1],
		[0, -1],
		[0, 0],
	]);
	const secondOutboundCells = cells([
		[0, 0],
		[0, 1],
		[1, 1],
		[2, 1],
		[3, 1],
		[4, 1],
		[4, 0],
	]);
	const secondReturnCells = cells([
		[4, 0],
		[5, 0],
		[5, 1],
		[5, 2],
		[4, 2],
		[3, 2],
		[2, 2],
		[1, 2],
		[0, 2],
		[-1, 2],
		[-1, 1],
		[-1, 0],
		[0, 0],
	]);
	const firstCirculation = [
		...edgesForCells(firstOutboundCells),
		...edgesForCells(firstReturnCells),
	];
	const secondCirculation = [
		...edgesForCells(secondOutboundCells),
		...edgesForCells(secondReturnCells),
	];
	const railMutations = Object.freeze(
		secondCirculation.map((edge) => {
			const outgoing = directionBetween(edge.from, edge.to);
			if (outgoing === null) throw new Error("Expected a cardinal test edge.");
			return Object.freeze({
				x: edge.from.x,
				y: edge.from.y,
				before: 0,
				after: encodeRailCell({ incoming: 0, outgoing }),
			});
		}),
	);
	const afterMap = beforeMap.clone();
	afterMap.applyAtomicMutations(railMutations, []);
	const fabBefore = record(15, "AREA", [], firstCirculation);
	const fabAfter = record(15, "AREA", [], [...firstCirculation, ...secondCirculation]);
	const hierarchyBefore = hierarchy(fabBefore);
	const hierarchyAfter = hierarchy(fabAfter);
	const beforeOrganizations = state(hierarchyBefore, 20);
	const afterOrganizations = state(hierarchyAfter, 20);
	const organizationMutations = Object.freeze([
		Object.freeze({ id: 15, before: fabBefore, after: fabAfter }),
	]);
	const plan = {
		valid: true,
		baseRevision: beforeMap.getRevision(),
		basePatchSequence: 10,
		mutations: override.emptyRailMutations ? Object.freeze([]) : railMutations,
		newEdges: override.emptyRailMutations ? 0 : railMutations.length,
		switchMutations: Object.freeze([]),
		organizationImpactAuthorizations: Object.freeze([15]),
		organizationMutations,
		nextOrganizationIdBefore: 20,
		nextOrganizationIdAfter: (override.nextOrganizationIdAfter as number | undefined) ?? 20,
		assemblyConnector: {
			hierarchyRole: override.hierarchyRole ?? "BANK_TO_FAB",
			purpose: override.purpose ?? "FAB_LOOP",
			fabOrganizationId: 15,
			sourceOrganizationId: 7,
			targetOrganizationId: 14,
			createdFab: override.createdFab ?? false,
			issueCode: null,
		},
		networkLink: {
			outboundCells: secondOutboundCells,
			returnCells: secondReturnCells,
		},
	} as unknown as StaticFabAssemblyConnectorPlan;
	return { beforeMap, afterMap, beforeOrganizations, afterOrganizations, plan };
}

function hierarchy(fab: StaticFabOrganizationRecord): readonly StaticFabOrganizationRecord[] {
	return Object.freeze(
		[
			record(7, "AREA", [15], [edge(0, 0, 1, 0)]),
			record(8, "BAY", [7]),
			record(9, "AISLE", [8]),
			record(14, "AREA", [15], [edge(4, 0, 4, -1)]),
			fab,
			record(16, "BAY", [14]),
			record(17, "AISLE", [16]),
		].sort((left, right) => left.id - right.id),
	);
}

function state(
	records: readonly StaticFabOrganizationRecord[],
	nextOrganizationId: number,
): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId,
		records: Object.freeze([...records].sort((left, right) => left.id - right.id)),
	});
}

function record(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	parentOrganizationIds: readonly number[] = [],
	railEdges: readonly ReturnType<typeof edge>[] = [],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name: `${kind}-${id}`,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		membership: Object.freeze({
			railEdges: Object.freeze([...railEdges]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}

function edge(fromX: number, fromY: number, toX: number, toY: number) {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}

function cells(points: readonly (readonly [number, number])[]) {
	return Object.freeze(points.map(([x, y]) => Object.freeze({ x, y })));
}

function edgesForCells(route: readonly Readonly<{ x: number; y: number }>[]) {
	return Object.freeze(
		route.slice(1).map((to, index) => {
			const from = route[index];
			if (!from) throw new Error("Expected route source.");
			return edge(from.x, from.y, to.x, to.y);
		}),
	);
}
