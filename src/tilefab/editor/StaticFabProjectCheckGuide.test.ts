import { describe, expect, it } from "vitest";
import type {
	StaticFabProjectCheckIssue,
	StaticFabProjectChecks,
} from "../compile/StaticFabProjectChecks";
import {
	staticFabOrganizationIssueDetailTab,
	staticFabProjectCheckGuide,
	staticFabProjectCheckOrganizationTarget,
	staticFabProjectChecksHaveAmbiguousOrganizationIdentity,
	staticFabProjectChecksHaveAmbiguousPortEquipmentIdentity,
} from "./StaticFabProjectCheckGuide";

describe("StaticFabProjectCheckGuide", () => {
	it("turns typed port spacing checks into a concrete two-port edit", () => {
		const guide = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "PORT_EQUIPMENT_LAYOUT",
				domain: "port",
				sourceCode: "PORT_SPACING",
				detail: "ports 4 and 9 are closer than 600 mm",
				affectedCount: 2,
			}),
		);

		expect(guide).toMatchObject({
			title: "SEPARATE CONFLICTING PORTS",
			metric: "2 LAYOUT FAULTS",
			technicalLabel: "EQUIPMENT LAYOUT · PORT_SPACING",
		});
		expect(guide.action).toContain("OHB는 개별 포트");
		expect(guide.action).toContain("EQ/STK는 그룹 전체 이동");
	});

	it("does not offer unavailable single-port movement for missing EQ or STK routes", () => {
		const guide = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "PORT_EQUIPMENT_LAYOUT",
				domain: "port",
				sourceCode: "PORT_ROUTE_MISSING",
				detail: "port 8 route is missing",
			}),
		);

		expect(guide.action).toContain("OHB는 유효한 레일 slot으로 이동");
		expect(guide.action).toContain("EQ/STK는 그룹 전체");
	});

	it("directs an EQ grammar fault to the existing equipment editor", () => {
		const guide = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "PORT_EQUIPMENT_LAYOUT",
				domain: "equipment",
				sourceCode: "EQ_PORT_PITCH_ORDER",
				detail: "equipment group 7: EQ port pitch order is invalid",
			}),
		);

		expect(guide.title).toBe("REBUILD EQ PORT ROW");
		expect(guide.action).toContain("OPEN EQUIPMENT INSPECTOR");
	});

	it("directs EQ and STK body overlap to reservation separation", () => {
		const guide = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "PORT_EQUIPMENT_LAYOUT",
				domain: "equipment",
				sourceCode: "EQ_STK_BODY_OVERLAP",
				detail: "equipment groups 3 and 8 overlap",
			}),
		);

		expect(guide.title).toBe("SEPARATE EQUIPMENT RESERVATIONS");
		expect(guide.action).toContain("EQ 본체와 STK 예약 범위");
	});

	it("describes FLEX STK repair per straight run instead of requiring one global lane", () => {
		const guide = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "PORT_EQUIPMENT_LAYOUT",
				domain: "equipment",
				sourceCode: "STK_PORT_ORDER",
				detail: "equipment group 9 has noncanonical order",
			}),
		);

		expect(guide.action).toContain("각 직선 run");
		expect(guide.action).not.toContain("같은 연속 직선");
	});

	it("keeps integrity repair fail-closed while naming the exact typed fault", () => {
		const guide = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "PORT_EQUIPMENT_INTEGRITY",
				domain: "equipment",
				sourceCode: "PORT_GROUP_POINTER_MISMATCH",
				detail: "port 3 does not point back to equipment group 2",
			}),
		);

		expect(guide.title).toBe("RESTORE RECIPROCAL PORT OWNERSHIP");
		expect(guide.technicalLabel).toContain("PORT_GROUP_POINTER_MISMATCH");
		expect(guide.action).toContain("자동 복구하지 않습니다");
	});

	it("uses the selected occurrence detail without multiplying issue cards", () => {
		const guide = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "PORT_EQUIPMENT_LAYOUT",
				domain: "port",
				sourceCode: "PORT_ROUTE_MISSING",
				detail: "port 1 route is missing",
				affectedCount: 10_000,
			}),
			"port 9,999 route is missing",
		);

		expect(guide.metric).toBe("10,000 LAYOUT FAULTS");
		expect(guide.summary).toBe("port 9,999 route is missing");
	});

	it("fails closed for every inspector target while any identity is duplicated", () => {
		const duplicate = issue({
			code: "PORT_EQUIPMENT_INTEGRITY",
			domain: "port",
			sourceCode: "PORT_ID_DUPLICATE",
			detail: "port ID 7 is duplicated",
		});
		const secondary = issue({
			code: "PORT_EQUIPMENT_LAYOUT",
			domain: "port",
			sourceCode: "PORT_ROUTE_MISSING",
			detail: "port 7 route is missing",
		});

		expect(
			staticFabProjectChecksHaveAmbiguousPortEquipmentIdentity({
				issues: [secondary, duplicate],
			}),
		).toBe(true);
		expect(staticFabProjectChecksHaveAmbiguousPortEquipmentIdentity({ issues: [secondary] })).toBe(
			false,
		);
	});

	it("maps organization relationship and ownership faults to concrete editor work", () => {
		const relation = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "ORGANIZATION_INTEGRITY",
				domain: "organization",
				sourceCode: "ORGANIZATION_RELATIONSHIP_CYCLE",
				detail: "organizations 2 and 7 form a cycle",
			}),
		);
		const ownership = staticFabProjectCheckGuide(
			{} as StaticFabProjectChecks,
			issue({
				code: "ORGANIZATION_INTEGRITY",
				domain: "organization",
				sourceCode: "ORGANIZATION_SAME_KIND_OWNERSHIP_CONFLICT",
				detail: "BAY organizations share rail:0:0>1:0",
			}),
		);

		expect(relation.title).toBe("REPAIR ORGANIZATION RELATIONS");
		expect(relation.action).toContain("RELATIONS");
		expect(ownership.title).toBe("SEPARATE DIRECT OWNERSHIP");
		expect(ownership.action).toContain("정확한 token");
		expect(staticFabOrganizationIssueDetailTab("ORGANIZATION_PARENT_MISSING")).toBe("relations");
		expect(staticFabOrganizationIssueDetailTab("ORGANIZATION_METADATA_INVALID")).toBe("properties");
		expect(staticFabOrganizationIssueDetailTab("ORGANIZATION_MODULE_PARTIAL")).toBe("overview");
	});

	it("resolves organizations only through an exact unique record index", () => {
		const record = Object.freeze({
			id: 7,
			kind: "BAY" as const,
			name: "Photo Bay",
			parentOrganizationIds: Object.freeze([]),
			properties: Object.freeze({ description: "", color: "CYAN" as const }),
			membership: Object.freeze({
				railEdges: Object.freeze([]),
				advancedSwitchIds: Object.freeze([]),
				equipmentGroupIds: Object.freeze([]),
			}),
		});
		const organizations = Object.freeze({
			nextOrganizationId: 8,
			records: Object.freeze([record]),
		});
		const location = Object.freeze({
			bounds: Object.freeze({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }),
			kind: "organization" as const,
			entityId: 7,
			recordIndex: 0,
			occurrenceIndex: 0,
			detail: "",
			relatedKind: null,
			relatedEntityId: 0,
			relatedRecordIndex: -1,
			token: "record:0",
			measuredValue: null,
			requiredValue: null,
			measurementUnit: "none" as const,
			measurementRelation: "none" as const,
		});
		const cleanChecks = { issues: [] };
		const duplicateChecks = {
			issues: [
				issue({
					code: "ORGANIZATION_INTEGRITY",
					domain: "organization",
					sourceCode: "ORGANIZATION_ID_DUPLICATE",
					detail: "organization id 7 is duplicated",
				}),
			],
		};

		expect(staticFabProjectCheckOrganizationTarget(cleanChecks, location, organizations)).toBe(
			record,
		);
		expect(
			staticFabProjectCheckOrganizationTarget(
				cleanChecks,
				{ ...location, recordIndex: 1 },
				organizations,
			),
		).toBeNull();
		expect(staticFabProjectChecksHaveAmbiguousOrganizationIdentity(duplicateChecks)).toBe(true);
		expect(
			staticFabProjectCheckOrganizationTarget(duplicateChecks, location, organizations),
		).toBeNull();
	});
});

function issue(
	overrides: Partial<StaticFabProjectCheckIssue> &
		Pick<StaticFabProjectCheckIssue, "code" | "domain" | "sourceCode" | "detail">,
): StaticFabProjectCheckIssue {
	return Object.freeze({
		id: `test:${overrides.code}:${overrides.sourceCode}`,
		role: "primary",
		affectedCount: 1,
		occurrenceOffset: 0,
		locationOffset: 0,
		locationCount: 1,
		...overrides,
	});
}
