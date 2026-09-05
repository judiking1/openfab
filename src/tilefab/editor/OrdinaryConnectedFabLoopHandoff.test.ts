import { describe, expect, it } from "vitest";
import type { StaticFabAssemblyConnectorPlan } from "../core/StaticFabAssemblyConnector";
import type {
	StaticFabOrganizationMutation,
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { deriveStaticFabOrganizationSemanticRoles } from "../core/StaticFabOrganization";
import {
	appliedConnectedFabEvidence,
	appliedConnectedFabEvidenceIsCurrent,
	connectedFabUndoProjectionExists,
	ordinaryConnectedFabBankPair,
	ordinaryConnectedFabLoopHandoff,
	ordinaryConnectedFabLoopHandoffLiveStatus,
	ordinaryConnectedFabReceiptBankPair,
} from "./OrdinaryConnectedFabLoopHandoff";

describe("appliedConnectedFabEvidence", () => {
	it("binds a create plan to its exact Fab, Bank pair, cursor delta, and direct-owned rail", () => {
		const before = state([...bankHierarchy(7, 1), ...bankHierarchy(14, 8)], 15);
		const fabAfter = record(15, "AREA", [], [edge(150)]);
		const plan = connectorPlan(before, fabAfter, true);
		const evidence = appliedConnectedFabEvidence(plan, before);

		expect(evidence).toEqual({
			fabOrganizationId: 15,
			connectedBayBankOrganizationIds: [7, 14],
			connectedBayBankParentOrganizationIdsBefore: [[], []],
			createdFab: true,
			addedFabRailEdgeKeys: ["150:0>151:0"],
		});
		if (!evidence) throw new Error("Expected create Fab evidence.");
		const after = state(
			[...bankHierarchy(7, 1, [15]), ...bankHierarchy(14, 8, [15]), fabAfter],
			16,
		);
		expect(appliedConnectedFabEvidenceIsCurrent(after, evidence)).toBe(true);
		expect(connectedFabUndoProjectionExists(before, evidence)).toBe(true);
		const semanticFab = semanticFabState([7, 14]);
		expect(
			ordinaryConnectedFabBankPair(
				semanticFab,
				deriveStaticFabOrganizationSemanticRoles(semanticFab),
				[15],
			),
		).toEqual([7, 14]);
	});

	it("accepts an existing Fab extension without consuming the allocator", () => {
		const fabBefore = record(15, "AREA", [], [edge(140)]);
		const before = state([...bankHierarchy(7, 1, [15]), ...bankHierarchy(14, 8), fabBefore], 20);
		const fabAfter = record(15, "AREA", [], [edge(140), edge(150)]);
		const evidence = appliedConnectedFabEvidence(connectorPlan(before, fabAfter, false), before);

		expect(evidence).toMatchObject({
			fabOrganizationId: 15,
			connectedBayBankOrganizationIds: [7, 14],
			connectedBayBankParentOrganizationIdsBefore: [[15], []],
			createdFab: false,
			addedFabRailEdgeKeys: ["150:0>151:0"],
		});
		if (!evidence) throw new Error("Expected extended Fab evidence.");
		expect(connectedFabUndoProjectionExists(before, evidence)).toBe(true);
		expect(
			appliedConnectedFabEvidenceIsCurrent(
				state([...bankHierarchy(7, 1, [15]), ...bankHierarchy(14, 8, [15]), fabAfter], 20),
				evidence,
			),
		).toBe(true);
	});

	it.each([
		["wrong role", { hierarchyRole: "BAY_TO_BANK" }],
		["wrong purpose", { purpose: "FAB_LOOP" }],
		["missing Fab mutation", { omitFabMutation: true }],
		["wrong source cursor", { nextOrganizationIdBefore: 99 }],
		["wrong create cursor", { nextOrganizationIdAfter: 15 }],
		["no added Fab rail", { noAddedFabRail: true }],
	] as const)("rejects %s", (_label, override) => {
		const before = state([...bankHierarchy(7, 1), ...bankHierarchy(14, 8)], 15);
		const plan = connectorPlan(before, record(15, "AREA", [], [edge(150)]), true, override);
		expect(appliedConnectedFabEvidence(plan, before)).toBeNull();
	});

	it("rejects stale ownership, parents, and ambiguous native-reopen Bank sets", () => {
		const evidence = Object.freeze({
			fabOrganizationId: 15,
			connectedBayBankOrganizationIds: Object.freeze([7, 14] as const),
			connectedBayBankParentOrganizationIdsBefore: Object.freeze([
				Object.freeze([]),
				Object.freeze([]),
			] as const),
			createdFab: true,
			addedFabRailEdgeKeys: Object.freeze(["150:0>151:0"]),
		});
		expect(
			appliedConnectedFabEvidenceIsCurrent(
				state(
					[
						record(7, "AREA", [15], [edge(150)]),
						record(14, "AREA", [15]),
						record(15, "AREA", [], [edge(150)]),
					],
					16,
				),
				evidence,
			),
		).toBe(false);
		expect(
			connectedFabUndoProjectionExists(
				state([record(7, "AREA", [99]), record(14, "AREA")], 16),
				evidence,
			),
		).toBe(false);
		const threeBanks = semanticFabState([7, 14, 21]);
		const roles = deriveStaticFabOrganizationSemanticRoles(threeBanks);
		expect(ordinaryConnectedFabBankPair(threeBanks, roles, [15])).toBeNull();
		expect(ordinaryConnectedFabBankPair(threeBanks, roles, [7])).toBeNull();
		expect(
			ordinaryConnectedFabReceiptBankPair(
				new Map(threeBanks.records.map((record) => [record.id, record])),
				roles,
				[15],
				evidence,
			),
		).toEqual([7, 14]);
		expect(
			ordinaryConnectedFabReceiptBankPair(
				new Map(threeBanks.records.map((record) => [record.id, record])),
				roles,
				[21],
				evidence,
			),
		).toBeNull();
	});

	it("keeps exact receipt validation practical with 100,000 unrelated organizations", () => {
		const unrelated = Array.from({ length: 100_000 }, (_, index) =>
			record(index + 1, "PROCESS_FAMILY"),
		);
		const left = 100_001;
		const right = 100_004;
		const fab = 100_007;
		const evidence = Object.freeze({
			fabOrganizationId: fab,
			connectedBayBankOrganizationIds: Object.freeze([left, right] as const),
			connectedBayBankParentOrganizationIdsBefore: Object.freeze([
				Object.freeze([]),
				Object.freeze([]),
			] as const),
			createdFab: true,
			addedFabRailEdgeKeys: Object.freeze([`${fab}:0>${fab + 1}:0`]),
		});
		const connected = state(
			[
				...unrelated,
				...bankHierarchy(left, 100_002, [fab]),
				...bankHierarchy(right, 100_005, [fab]),
				record(fab, "AREA", [], [edge(fab)]),
			],
			fab + 1,
		);
		const undone = state(
			[...unrelated, ...bankHierarchy(left, 100_002), ...bankHierarchy(right, 100_005)],
			fab + 1,
		);
		const semanticRoles = deriveStaticFabOrganizationSemanticRoles(connected);
		const recordsById = new Map(connected.records.map((record) => [record.id, record]));
		const receiptSelectionStartedAt = performance.now();
		const receiptPair = ordinaryConnectedFabReceiptBankPair(
			recordsById,
			semanticRoles,
			[fab],
			evidence,
		);
		const receiptSelectionMilliseconds = performance.now() - receiptSelectionStartedAt;
		expect(receiptPair).toEqual([left, right]);
		expect(receiptSelectionMilliseconds).toBeLessThan(60);
		const nativeSelectionStartedAt = performance.now();
		const nativePair = ordinaryConnectedFabBankPair(connected, semanticRoles, [fab]);
		const nativeSelectionMilliseconds = performance.now() - nativeSelectionStartedAt;
		expect(nativePair).toEqual([left, right]);
		expect(nativeSelectionMilliseconds).toBeLessThan(60);
		const startedAt = performance.now();
		expect(appliedConnectedFabEvidenceIsCurrent(connected, evidence)).toBe(true);
		expect(connectedFabUndoProjectionExists(undone, evidence)).toBe(true);
		expect(performance.now() - startedAt).toBeLessThan(2_000);
	}, 10_000);
});

const READY_HANDOFF = Object.freeze({
	selectedOrganizationIds: Object.freeze([15]),
	selectedFabOrganizationId: 15,
	connectedBayBankOrganizationIds: Object.freeze([7, 14] as const),
	fabLoopReviewReady: true,
	redoAvailable: false,
	guidedBuildActive: false,
	placementPending: false,
	exclusiveCommandActive: false,
	readyForReview: true,
});

describe("ordinaryConnectedFabLoopHandoff", () => {
	it("keeps launch and cancellation failures ahead of current/stale receipt guidance", () => {
		expect(
			ordinaryConnectedFabLoopHandoffLiveStatus(
				"Fab 외곽 순환 Worker 세션이 종료되었습니다 · 다시 시작하세요",
				"created",
			),
		).toBe("Fab 외곽 순환 Worker 세션이 종료되었습니다 · 다시 시작하세요");
		expect(ordinaryConnectedFabLoopHandoffLiveStatus(null, "created")).toContain("Fab 생성 완료");
		expect(ordinaryConnectedFabLoopHandoffLiveStatus(null, "extended")).toContain("Fab 확장 완료");
		expect(ordinaryConnectedFabLoopHandoffLiveStatus(null, null)).toContain("Fab 선택 완료");
	});

	it("offers one project-neutral FAB LOOP review continuation", () => {
		expect(ordinaryConnectedFabLoopHandoff(READY_HANDOFF)).toEqual({
			action: "review-recognized-fab-loop",
			label: "다음 · Fab 외곽 순환 검토",
			instruction: "두 Bay Bank 사이의 두 번째 왕복 경로를 검토",
			ariaLabel:
				"다음 · Fab 외곽 순환 검토. 선택한 Fab의 직속 Bay Bank 두 개를 대상으로 두 번째 외곽 왕복 경로 검토를 엽니다. Apply 전에는 프로젝트가 변경되지 않으며 Escape 또는 취소로 선택한 Fab으로 돌아올 수 있습니다",
			description:
				"선택한 Fab의 정확한 직속 Bay Bank 두 개로 기존 FAB LOOP 검토를 엽니다. Worker 추천과 검토만으로는 프로젝트가 변경되지 않습니다.",
		});
	});

	it.each([
		["without one exact selection", { selectedOrganizationIds: Object.freeze([7, 15]) }],
		["without a semantic Fab", { selectedFabOrganizationId: null }],
		["for another Fab", { selectedOrganizationIds: Object.freeze([16]) }],
		["without exactly two Banks", { connectedBayBankOrganizationIds: null }],
		["while FAB LOOP is unavailable", { fabLoopReviewReady: false }],
		["after Undo exposes Redo", { redoAvailable: true }],
		["inside Guided Build", { guidedBuildActive: true }],
		["while placement is pending", { placementPending: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while review is unavailable", { readyForReview: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryConnectedFabLoopHandoff({ ...READY_HANDOFF, ...override })).toBeNull();
	});

	it("restores review beside Redo only for an exact FAB_LOOP Undo receipt", () => {
		expect(
			ordinaryConnectedFabLoopHandoff({
				...READY_HANDOFF,
				redoAvailable: true,
				exactLoopUndoReceiptCurrent: true,
			}),
		).not.toBeNull();
	});
});

function connectorPlan(
	before: StaticFabOrganizationState,
	fabAfter: StaticFabOrganizationRecord,
	createdFab: boolean,
	override: Readonly<Record<string, unknown>> = {},
): StaticFabAssemblyConnectorPlan {
	const fabBefore = createdFab
		? null
		: (before.records.find((candidate) => candidate.id === fabAfter.id) ?? null);
	const mutations: StaticFabOrganizationMutation[] = [
		...(override.omitFabMutation
			? []
			: [Object.freeze({ id: fabAfter.id, before: fabBefore, after: fabAfter })]),
		...([7, 14] as const).flatMap((id) => {
			const source = before.records.find((candidate) => candidate.id === id);
			if (!source) throw new Error(`Missing Connector Bank ${id}.`);
			if (source.parentOrganizationIds?.includes(fabAfter.id)) return [];
			return [Object.freeze({ id, before: source, after: record(id, "AREA", [fabAfter.id]) })];
		}),
	];
	if (override.noAddedFabRail && fabBefore) {
		mutations[0] = Object.freeze({ id: fabAfter.id, before: fabBefore, after: fabBefore });
	} else if (override.noAddedFabRail) {
		mutations[0] = Object.freeze({ id: fabAfter.id, before: null, after: record(15, "AREA") });
	}
	return {
		valid: true,
		nextOrganizationIdBefore:
			(override.nextOrganizationIdBefore as number | undefined) ?? before.nextOrganizationId,
		nextOrganizationIdAfter:
			(override.nextOrganizationIdAfter as number | undefined) ??
			(createdFab ? before.nextOrganizationId + 1 : before.nextOrganizationId),
		organizationMutations: Object.freeze(mutations),
		assemblyConnector: {
			hierarchyRole: override.hierarchyRole ?? "BANK_TO_FAB",
			purpose: override.purpose ?? "HIERARCHY_LINK",
			fabOrganizationId: fabAfter.id,
			sourceOrganizationId: 7,
			targetOrganizationId: 14,
			createdFab,
		},
	} as unknown as StaticFabAssemblyConnectorPlan;
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

function semanticFabState(bankIds: readonly number[]): StaticFabOrganizationState {
	const descendants = bankIds.flatMap((bankId, index) => {
		const bayId = 100 + index * 2;
		return [record(bayId, "BAY", [bankId]), record(bayId + 1, "AISLE", [bayId])];
	});
	return state(
		[
			...bankIds.map((bankId) => record(bankId, "AREA", [15])),
			record(15, "AREA", [], [edge(150)]),
			...descendants,
		],
		200,
	);
}

function bankHierarchy(
	bankId: number,
	bayId: number,
	parentOrganizationIds: readonly number[] = [],
): readonly StaticFabOrganizationRecord[] {
	return Object.freeze([
		record(bankId, "AREA", parentOrganizationIds),
		record(bayId, "BAY", [bankId]),
		record(bayId + 1, "AISLE", [bayId]),
	]);
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

function edge(x: number) {
	return Object.freeze({
		from: Object.freeze({ x, y: 0 }),
		to: Object.freeze({ x: x + 1, y: 0 }),
	});
}
