import { afterEach, describe, expect, it, vi } from "vitest";
import {
	staticFabAssemblyConnectorHierarchyEligibility,
	staticFabAssemblyConnectorHierarchyEligibilityFromLookup,
	staticFabAssemblyInterbayConnectorHierarchyEligibility,
	staticFabAssemblyInterbayConnectorHierarchyEligibilityFromLookup,
} from "./StaticFabAssemblyConnector";
import { bay, expectCode, lookup, record, state } from "./StaticFabCheckRepair.test-fixtures";
import {
	resolveStaticFabCheckConnectorRepairTarget,
	resolveStaticFabCheckLoopRepairTarget,
} from "./StaticFabCheckRepairTargets";
import * as organizationsModule from "./StaticFabOrganization";
import {
	copyStaticFabOrganizationState,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import type { StaticFabOrganizationMetadataLookup } from "./StaticFabOrganizationMetadataLookup";

const differentBanks =
	"서로 다른 두 Bay Bank의 Bay를 직접 합칠 수 없습니다 · Bank/FAB connector인 CONNECT BANKS를 사용하세요";
const differentFabs =
	"서로 다른 두 Fab의 Bank를 직접 합칠 수 없습니다 · Fab-to-Fab bridge는 아직 지원하지 않습니다";
const pairCases = [
	{
		name: "detached Bays",
		records: [...bay(1), ...bay(4)],
		ids: [1, 4],
		role: "BAY",
		purpose: "HIERARCHY_LINK",
		reasons: ["새 Bay Bank를 생성합니다", "새 Bay Bank를 생성합니다"],
	},
	{
		name: "attached and detached Bay",
		records: [record(30, "AREA"), ...bay(1, [30]), ...bay(4)],
		ids: [1, 4],
		role: "BAY",
		purpose: "HIERARCHY_LINK",
		reasons: ["기존 Bay Bank에 독립 Bay를 연결합니다", "독립 Bay를 기존 Bay Bank에 연결합니다"],
	},
	{
		name: "same Bank Bays",
		records: [record(30, "AREA"), ...bay(1, [30]), ...bay(4, [30])],
		ids: [1, 4],
		role: "BAY",
		purpose: "HIERARCHY_LINK",
		reasons: ["기존 Bay Bank connector를 확장합니다", "기존 Bay Bank connector를 확장합니다"],
	},
	{
		name: "different Banks",
		records: [record(30, "AREA"), record(40, "AREA"), ...bay(1, [30]), ...bay(4, [40])],
		ids: [1, 4],
		role: "BAY",
		issue: "DIFFERENT_BANKS",
		reasons: [differentBanks, differentBanks],
	},
	{
		name: "detached Banks",
		records: [record(30, "AREA"), record(40, "AREA"), ...bay(1, [30]), ...bay(4, [40])],
		ids: [30, 40],
		role: "BAY_BANK",
		purpose: "HIERARCHY_LINK",
		reasons: ["새 Fab를 생성합니다", "새 Fab를 생성합니다"],
	},
	{
		name: "attached and detached Bank",
		records: [
			record(60, "AREA"),
			record(30, "AREA", [60]),
			record(40, "AREA"),
			...bay(1, [30]),
			...bay(4, [40]),
		],
		ids: [30, 40],
		role: "BAY_BANK",
		purpose: "HIERARCHY_LINK",
		reasons: ["기존 Fab에 독립 Bay Bank를 연결합니다", "독립 Bay Bank를 기존 Fab에 연결합니다"],
	},
	{
		name: "same Fab Banks",
		records: [
			record(60, "AREA"),
			record(30, "AREA", [60]),
			record(40, "AREA", [60]),
			...bay(1, [30]),
			...bay(4, [40]),
		],
		ids: [30, 40],
		role: "BAY_BANK",
		purpose: "FAB_LOOP",
		reasons: ["기존 Fab connector를 확장합니다", "기존 Fab connector를 확장합니다"],
	},
	{
		name: "different Fabs",
		records: [
			record(60, "AREA"),
			record(70, "AREA"),
			record(30, "AREA", [60]),
			record(40, "AREA", [70]),
			...bay(1, [30]),
			...bay(4, [40]),
		],
		ids: [30, 40],
		role: "BAY_BANK",
		issue: "DIFFERENT_FABS",
		reasons: [differentFabs, differentFabs],
	},
	{
		name: "conflicting nonsemantic parents",
		records: [
			record(60, "PROCESS_FAMILY"),
			record(70, "PROCESS_FAMILY"),
			...bay(1, [60]),
			...bay(4, [70]),
		],
		ids: [1, 4],
		role: "BAY",
		issue: "HIERARCHY_INVALID",
		reasons: [
			"서로 다른 상위 계층에 속한 Bay는 하나의 Bay Bank로 묶을 수 없습니다",
			"서로 다른 상위 계층에 속한 Bay는 하나의 Bay Bank로 묶을 수 없습니다",
		],
	},
	{
		name: "multiple semantic parents never collapse to an inferred parent",
		records: [record(30, "AREA"), record(40, "AREA"), ...bay(1, [30, 40]), ...bay(4, [30, 40])],
		ids: [1, 4],
		role: "BAY",
		issue: "DIFFERENT_BANKS",
		reasons: [differentBanks, differentBanks],
	},
	{
		name: "shared Bank upstream mismatch",
		records: [
			record(60, "PROCESS_FAMILY"),
			record(70, "PROCESS_FAMILY"),
			record(30, "AREA", [60]),
			...bay(1, [30, 70]),
			...bay(4, [30]),
		],
		ids: [1, 4],
		role: "BAY",
		issue: "HIERARCHY_INVALID",
		reasons: [
			"Bay의 상위 계층이 공유 Bay Bank의 상위 계층과 다릅니다",
			"Bay의 상위 계층이 공유 Bay Bank의 상위 계층과 다릅니다",
		],
	},
	{
		name: "attached-detached Bank upstream mismatch",
		records: [
			record(60, "PROCESS_FAMILY"),
			record(70, "PROCESS_FAMILY"),
			record(30, "AREA", [60]),
			...bay(1, [30, 70]),
			...bay(4),
		],
		ids: [1, 4],
		role: "BAY",
		issue: "HIERARCHY_INVALID",
		reasons: [
			"Bay의 상위 계층이 선택한 Bay Bank의 상위 계층과 다릅니다",
			"Bay의 상위 계층이 선택한 Bay Bank의 상위 계층과 다릅니다",
		],
	},
	{
		name: "shared Fab upstream mismatch",
		records: [
			record(80, "PROCESS_FAMILY"),
			record(90, "PROCESS_FAMILY"),
			record(60, "AREA", [80]),
			record(30, "AREA", [60, 90]),
			record(40, "AREA", [60]),
			...bay(1, [30]),
			...bay(4, [40]),
		],
		ids: [30, 40],
		role: "BAY_BANK",
		issue: "HIERARCHY_INVALID",
		reasons: [
			"Bay Bank의 상위 계층이 공유 Fab의 상위 계층과 다릅니다",
			"Bay Bank의 상위 계층이 공유 Fab의 상위 계층과 다릅니다",
		],
	},
	{
		name: "attached-detached Fab upstream mismatch",
		records: [
			record(80, "PROCESS_FAMILY"),
			record(90, "PROCESS_FAMILY"),
			record(60, "AREA", [80]),
			record(30, "AREA", [60, 90]),
			record(40, "AREA"),
			...bay(1, [30]),
			...bay(4, [40]),
		],
		ids: [30, 40],
		role: "BAY_BANK",
		issue: "HIERARCHY_INVALID",
		reasons: [
			"Bay Bank의 상위 계층이 선택한 Fab의 상위 계층과 다릅니다",
			"Bay Bank의 상위 계층이 선택한 Fab의 상위 계층과 다릅니다",
		],
	},
] as const;

afterEach(() => vi.restoreAllMocks());

describe("issued indexed hierarchy", () => {
	for (const example of pairCases) {
		it(`preserves exact reason/purpose and legacy parity in both orders: ${example.name}`, () => {
			const organizations = state(example.records);
			const metadata = lookup(organizations);
			const before = JSON.stringify(organizations);
			for (const reverse of [false, true]) {
				const left = example.ids[reverse ? 1 : 0];
				const right = example.ids[reverse ? 0 : 1];
				const actual =
					example.role === "BAY"
						? staticFabAssemblyConnectorHierarchyEligibilityFromLookup(
								organizations,
								metadata,
								left,
								right,
							)
						: staticFabAssemblyInterbayConnectorHierarchyEligibilityFromLookup(
								organizations,
								metadata,
								left,
								right,
							);
				const legacy =
					example.role === "BAY"
						? staticFabAssemblyConnectorHierarchyEligibility(organizations, left, right)
						: staticFabAssemblyInterbayConnectorHierarchyEligibility(organizations, left, right);
				expect(actual).toEqual(legacy);
				expect(actual.reason).toBe(example.reasons[reverse ? 1 : 0]);
				if ("issue" in example)
					expect(actual).toMatchObject({ valid: false, issueCode: example.issue });
				else
					expect(actual).toMatchObject({ valid: true, issueCode: null, purpose: example.purpose });
			}
			expect(JSON.stringify(organizations)).toBe(before);
		});
	}

	it("preserves missing/same-ID/mixed-level rejection and raw legacy metadata behavior", () => {
		const organizations = state([record(30, "AREA"), ...bay(1, [30]), ...bay(4)]);
		const metadata = lookup(organizations);
		for (const [left, right, issue] of [
			[1, 1, "SAME_ORGANIZATION"],
			[1, 99, "MISSING_ORGANIZATION"],
			[99, 99, "MISSING_ORGANIZATION"],
			[1, 30, "UNSUPPORTED_ORGANIZATION"],
		] as const) {
			const actual = staticFabAssemblyConnectorHierarchyEligibilityFromLookup(
				organizations,
				metadata,
				left,
				right,
			);
			expect(actual).toEqual(
				staticFabAssemblyConnectorHierarchyEligibility(organizations, left, right),
			);
			expect(actual).toMatchObject({ valid: false, issueCode: issue });
		}
		const raw = { ...organizations, records: [...organizations.records] };
		expect(staticFabAssemblyConnectorHierarchyEligibility(raw, 1, 4)).toEqual(
			staticFabAssemblyConnectorHierarchyEligibility(organizations, 1, 4),
		);
		expect(staticFabAssemblyConnectorHierarchyEligibility(raw, 1, 99)).toMatchObject({
			valid: false,
			issueCode: "MISSING_ORGANIZATION",
			reason: "선택한 Production Bay 조직을 찾을 수 없습니다",
		});
	});

	it("preserves raw legacy refusal/throw priority before semantic derivation", () => {
		const source = record(1, "BAY");
		const semanticFailure = new Error("synthetic raw semantic parent failure");
		Object.defineProperty(source, "parentOrganizationIds", {
			get() {
				throw semanticFailure;
			},
		});
		const raw: StaticFabOrganizationState = {
			nextOrganizationId: 5,
			records: [source, record(4, "BAY")],
		};
		expect(staticFabAssemblyConnectorHierarchyEligibility(raw, 1, 99)).toEqual({
			valid: false,
			issueCode: "MISSING_ORGANIZATION",
			reason: "선택한 Production Bay 조직을 찾을 수 없습니다",
		});
		expect(staticFabAssemblyConnectorHierarchyEligibility(raw, 1, 1)).toEqual({
			valid: false,
			issueCode: "SAME_ORGANIZATION",
			reason: "서로 다른 두 Production Bay를 선택하세요",
		});
		expect(() => staticFabAssemblyConnectorHierarchyEligibility(raw, 1, 4)).toThrow(
			semanticFailure,
		);
		// This raw legacy-only fixture is never eligible for shared canonical issuance.
	});

	it("checks an explicit foreign reference and issued provenance, without caller Map/function certification", () => {
		const organizations = state([...bay(1), ...bay(4)]);
		const metadata = lookup(organizations);
		const foreign = copyStaticFabOrganizationState(organizations);
		expectCode(
			() => staticFabAssemblyConnectorHierarchyEligibilityFromLookup(foreign, metadata, 1, 4),
			"FOREIGN_SOURCE",
		);
		const forged = {
			...metadata,
			record: vi.fn(),
			semanticRole: vi.fn(),
		} as StaticFabOrganizationMetadataLookup;
		expectCode(
			() => staticFabAssemblyConnectorHierarchyEligibilityFromLookup(organizations, forged, 1, 4),
			"UNISSUED_LOOKUP",
		);
		expect(forged.record).not.toHaveBeenCalled();
		expect(forged.semanticRole).not.toHaveBeenCalled();
		metadata.revoke();
		expectCode(
			() => staticFabAssemblyConnectorHierarchyEligibilityFromLookup(organizations, metadata, 1, 4),
			"REVOKED",
		);
	});

	it("reuses one semantic derivation for repeated explicit Checks pair and Loop resolutions", () => {
		const organizations = state([...bay(1), ...bay(4), record(10, "AISLE", [], true)]);
		const derive = vi.spyOn(organizationsModule, "deriveStaticFabOrganizationSemanticRoleSteps");
		const metadata = lookup(organizations);
		for (const ids of [[], [1], [1, 4, 10]])
			expect(resolveStaticFabCheckConnectorRepairTarget(organizations, metadata, ids).status).toBe(
				"choose",
			);
		expect(resolveStaticFabCheckLoopRepairTarget(organizations, metadata, null).status).toBe(
			"choose",
		);
		expect(resolveStaticFabCheckLoopRepairTarget(organizations, metadata, 10)).toMatchObject({
			status: "ready",
			organizationId: 10,
		});
		expect(resolveStaticFabCheckLoopRepairTarget(organizations, metadata, 2).status).toBe(
			"blocked",
		);
		expect(
			resolveStaticFabCheckConnectorRepairTarget(organizations, metadata, [1, 1]),
		).toMatchObject({ status: "blocked", issueCode: "SAME_ORGANIZATION" });
		expect(
			resolveStaticFabCheckConnectorRepairTarget(organizations, metadata, [1, 99]),
		).toMatchObject({ status: "blocked", issueCode: "MISSING_ORGANIZATION" });
		for (const ids of [
			[1, 4],
			[4, 1],
		]) {
			const before = [...ids];
			expect(
				resolveStaticFabCheckConnectorRepairTarget(organizations, metadata, ids),
			).toMatchObject({
				status: "ready",
				organizationIds: [1, 4],
				hierarchyRole: "BAY_TO_BANK",
				purpose: "HIERARCHY_LINK",
			});
			expect(ids).toEqual(before);
		}
		expect(derive).toHaveBeenCalledTimes(1);
	});

	it("owns the explicit pair before callbacks and cancels at the final source check without publication", () => {
		const organizations = state([...bay(1), ...bay(4)]);
		const ids = [4, 1];
		let active = false;
		let calls = 0;
		let cancelAt = 0;
		const metadata: StaticFabOrganizationMetadataLookup = lookup(
			organizations,
			(source: StaticFabOrganizationState) => {
				if (active) {
					calls++;
					ids[0] = 99;
					if (calls === cancelAt) metadata.revoke();
				}
				return source === organizations;
			},
		);
		active = true;
		expect(resolveStaticFabCheckConnectorRepairTarget(organizations, metadata, ids)).toMatchObject({
			status: "ready",
			organizationIds: [1, 4],
		});
		cancelAt = calls;
		calls = 0;
		ids[0] = 4;
		let published: unknown;
		expectCode(() => {
			published = resolveStaticFabCheckConnectorRepairTarget(organizations, metadata, ids);
		}, "REVOKED");
		expect(published).toBeUndefined();
	});

	it("uses bounded parent lookups at the canonical 32-parent limit", () => {
		const parents = Array.from({ length: 32 }, (_, index) => index + 100);
		const organizations = state([
			...bay(1, parents),
			...bay(4, parents),
			...parents.map((id) => record(id, "PROCESS_FAMILY")),
		]);
		let checks = 0;
		const metadata = lookup(organizations, () => {
			checks++;
			return true;
		});
		checks = 0;
		expect(
			staticFabAssemblyConnectorHierarchyEligibilityFromLookup(organizations, metadata, 1, 4),
		).toMatchObject({ valid: true, purpose: "HIERARCHY_LINK", reason: "새 Bay Bank를 생성합니다" });
		expect(checks).toBeLessThanOrEqual(512);
	});
});
