import { describe, expect, it } from "vitest";
import type { StaticFabAssemblyConnectorPlan } from "../core/StaticFabAssemblyConnector";
import type {
	StaticFabOrganizationMutation,
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import {
	appliedConnectedBayBankEvidence,
	appliedConnectedBayBankEvidenceIsCurrent,
	connectedBayBankUndoProjectionExists,
	ordinaryConnectedBayBankDuplicateHandoff,
} from "./OrdinaryConnectedBayBankDuplicateHandoff";

describe("appliedConnectedBayBankEvidence", () => {
	it("binds a create plan to its exact Bank, Bay pair, cursor delta, and added rail", () => {
		const before = state([record(1, "BAY"), record(4, "BAY")], 7);
		const afterBank = record(7, "AREA", [], [edge(70)]);
		const plan = connectorPlan(before, afterBank, true);
		const evidence = appliedConnectedBayBankEvidence(plan, before);

		expect(evidence).toEqual({
			bankOrganizationId: 7,
			connectedTwinBayOrganizationIds: [1, 4],
			connectedTwinBayParentOrganizationIdsBefore: [[], []],
			createdBank: true,
			addedBankRailEdgeKeys: ["70:0>71:0"],
		});
		if (!evidence) throw new Error("Expected create Connector evidence.");
		const after = state([record(1, "BAY", [7]), record(4, "BAY", [7]), afterBank], 8);
		expect(appliedConnectedBayBankEvidenceIsCurrent(after, evidence)).toBe(true);
		expect(connectedBayBankUndoProjectionExists(before, evidence)).toBe(true);
	});

	it("accepts bounded same-parent and attached/detached extend evidence", () => {
		for (const targetParents of [[7], []] as const) {
			const bankBefore = record(7, "AREA", [], [edge(60)]);
			const before = state([record(1, "BAY", [7]), record(4, "BAY", targetParents), bankBefore], 9);
			const bankAfter = record(7, "AREA", [], [edge(60), edge(70)]);
			const plan = connectorPlan(before, bankAfter, false);
			const evidence = appliedConnectedBayBankEvidence(plan, before);

			expect(evidence).toMatchObject({
				bankOrganizationId: 7,
				connectedTwinBayOrganizationIds: [1, 4],
				connectedTwinBayParentOrganizationIdsBefore: [[7], targetParents],
				createdBank: false,
				addedBankRailEdgeKeys: ["70:0>71:0"],
			});
			if (!evidence) throw new Error("Expected extend Connector evidence.");
			expect(connectedBayBankUndoProjectionExists(before, evidence)).toBe(true);
			expect(
				connectedBayBankUndoProjectionExists(
					state([record(1, "BAY", [7]), record(4, "BAY", targetParents), bankAfter], 9),
					evidence,
				),
			).toBe(false);
		}
	});

	it.each([
		["wrong role", { hierarchyRole: "BANK_TO_FAB" }],
		["wrong purpose", { purpose: "FAB_LOOP" }],
		["missing Bank mutation", { omitBankMutation: true }],
		["wrong create cursor", { nextOrganizationIdAfter: 7 }],
		["no added Bank rail", { noAddedBankRail: true }],
	] as const)("rejects %s", (_label, override) => {
		const before = state([record(1, "BAY"), record(4, "BAY")], 7);
		const plan = connectorPlan(before, record(7, "AREA", [], [edge(70)]), true, override);
		expect(appliedConnectedBayBankEvidence(plan, before)).toBeNull();
	});

	it("keeps exact receipt projection linear with 100,000 unrelated organizations", () => {
		const unrelated = Array.from({ length: 100_000 }, (_, index) =>
			record(index + 1, "PROCESS_FAMILY"),
		);
		const sourceId = 100_001;
		const targetId = 100_002;
		const bankId = 100_003;
		const evidence = Object.freeze({
			bankOrganizationId: bankId,
			connectedTwinBayOrganizationIds: Object.freeze([sourceId, targetId] as const),
			connectedTwinBayParentOrganizationIdsBefore: Object.freeze([
				Object.freeze([]),
				Object.freeze([]),
			] as const),
			createdBank: true,
			addedBankRailEdgeKeys: Object.freeze(["100003:0>100004:0"]),
		});
		const connected = state(
			[
				...unrelated,
				record(sourceId, "BAY", [bankId]),
				record(targetId, "BAY", [bankId]),
				record(bankId, "AREA", [], [edge(bankId)]),
			],
			bankId + 1,
		);
		const undone = state(
			[...unrelated, record(sourceId, "BAY"), record(targetId, "BAY")],
			bankId + 1,
		);
		const startedAt = performance.now();
		expect(appliedConnectedBayBankEvidenceIsCurrent(connected, evidence)).toBe(true);
		expect(connectedBayBankUndoProjectionExists(undone, evidence)).toBe(true);
		expect(performance.now() - startedAt).toBeLessThan(2_000);
	}, 10_000);
});

const READY_CONTEXT = Object.freeze({
	selectedOrganizationIds: Object.freeze([7]),
	selectedBayBankOrganizationId: 7,
	duplicateReady: true,
	redoAvailable: false,
	guidedBuildActive: false,
	organizationBundleActive: false,
	placementPending: false,
	exclusiveCommandActive: false,
	readyForMutation: true,
});

describe("ordinaryConnectedBayBankDuplicateHandoff", () => {
	it("offers exactly one existing EFFECTIVE duplicate continuation", () => {
		expect(ordinaryConnectedBayBankDuplicateHandoff(READY_CONTEXT)).toEqual({
			action: "duplicate-recognized-bay-bank",
			label: "다음 · Bay Bank 전체 복제",
			instruction: "하위 Bay·Process Loop·연결 구조까지 함께 복제",
			ariaLabel:
				"다음 · Bay Bank 전체 복제. 선택한 Bay Bank와 모든 하위 Bay, Process Loop, Rail, Port, 장비를 함께 복제할 위치 선택을 시작합니다. 배치 전에는 프로젝트가 변경되지 않으며 Escape, 오른쪽 클릭, 또는 배치 취소로 돌아올 수 있습니다",
			description:
				"선택한 Bay Bank와 모든 하위 Bay, Process Loop, Rail, Port, 장비를 함께 복제할 위치를 고릅니다. 위치를 확정하기 전에는 프로젝트가 변경되지 않습니다.",
		});
	});

	it.each([
		["without one exact selection", { selectedOrganizationIds: Object.freeze([1, 7]) }],
		["without a semantic Bank", { selectedBayBankOrganizationId: null }],
		["for another Bank", { selectedOrganizationIds: Object.freeze([8]) }],
		["while Duplicate is blocked", { duplicateReady: false }],
		["after Undo exposes Redo", { redoAvailable: true }],
		["inside Guided Build", { guidedBuildActive: true }],
		["during placement", { organizationBundleActive: true }],
		["while placement is pending", { placementPending: true }],
		["during an exclusive command", { exclusiveCommandActive: true }],
		["while mutation is unavailable", { readyForMutation: false }],
	] as const)("stays absent %s", (_label, override) => {
		expect(ordinaryConnectedBayBankDuplicateHandoff({ ...READY_CONTEXT, ...override })).toBeNull();
	});
});

function connectorPlan(
	before: StaticFabOrganizationState,
	bankAfter: StaticFabOrganizationRecord,
	createdBank: boolean,
	override: Readonly<Record<string, unknown>> = {},
): StaticFabAssemblyConnectorPlan {
	const bankBefore = createdBank
		? null
		: (before.records.find((candidate) => candidate.id === bankAfter.id) ?? null);
	const mutations: StaticFabOrganizationMutation[] = [
		...(override.omitBankMutation
			? []
			: [Object.freeze({ id: bankAfter.id, before: bankBefore, after: bankAfter })]),
		...([1, 4] as const).flatMap((id) => {
			const source = before.records.find((candidate) => candidate.id === id);
			if (!source) throw new Error(`Missing Connector source organization ${id}.`);
			if (source.parentOrganizationIds?.includes(bankAfter.id)) return [];
			return [
				Object.freeze({
					id,
					before: source,
					after: record(id, "BAY", [bankAfter.id]),
				}),
			];
		}),
	];
	if (override.noAddedBankRail && bankBefore) {
		mutations[0] = Object.freeze({ id: bankAfter.id, before: bankBefore, after: bankBefore });
	} else if (override.noAddedBankRail) {
		mutations[0] = Object.freeze({ id: bankAfter.id, before: null, after: record(7, "AREA") });
	}
	return {
		valid: true,
		nextOrganizationIdBefore: before.nextOrganizationId,
		nextOrganizationIdAfter:
			(override.nextOrganizationIdAfter as number | undefined) ??
			(createdBank ? before.nextOrganizationId + 1 : before.nextOrganizationId),
		organizationMutations: Object.freeze(mutations),
		assemblyConnector: {
			hierarchyRole: override.hierarchyRole ?? "BAY_TO_BANK",
			purpose: override.purpose ?? "HIERARCHY_LINK",
			bankOrganizationId: bankAfter.id,
			sourceOrganizationId: 1,
			targetOrganizationId: 4,
			createdBank,
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
