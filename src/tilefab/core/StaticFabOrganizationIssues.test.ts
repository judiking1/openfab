import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "./EquipmentGroup";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex, type RailModuleOwnership } from "./RailModuleOwnership";
import type {
	StaticFabOrganizationKind,
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "./StaticFabOrganization";
import { staticFabOrganizationStateError } from "./StaticFabOrganization";
import { collectStaticFabOrganizationIssues } from "./StaticFabOrganizationIssues";

describe("StaticFabOrganizationIssues", () => {
	it("returns no issues for one exact canonical organization generation", () => {
		const fixture = straightFixture();
		const state = organizationState([
			organizationRecord(1, "AREA", "Production Area", fixture.modules[0] as RailModuleOwnership),
		]);

		expect(
			staticFabOrganizationStateError(fixture.document.map, emptyPortEquipmentState(), state),
		).toBeNull();
		expect(
			collectStaticFabOrganizationIssues(fixture.document.map, emptyPortEquipmentState(), state),
		).toEqual([]);
	});

	it("retains duplicate identity, name, ownership, cursor, records, and exact tokens", () => {
		const fixture = straightFixture();
		const module = fixture.modules[0] as RailModuleOwnership;
		const first = organizationRecord(3, "BAY", "Photo Bay", module);
		const second = organizationRecord(3, "BAY", "ＰＨＯＴＯ ＢＡＹ", module);
		const state = { nextOrganizationId: 3, records: [first, second] };

		const issues = collectStaticFabOrganizationIssues(
			fixture.document.map,
			emptyPortEquipmentState(),
			state,
		);
		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"NEXT_ORGANIZATION_ID_CURSOR_STALE",
				"ORGANIZATION_ID_DUPLICATE",
				"ORGANIZATION_NAME_DUPLICATE",
				"ORGANIZATION_SAME_KIND_OWNERSHIP_CONFLICT",
			]),
		);
		const duplicate = issues.find((issue) => issue.code === "ORGANIZATION_ID_DUPLICATE");
		expect(duplicate).toMatchObject({
			organizationIds: [3],
			organizationRecordIndexes: [0, 1],
		});
		const conflict = issues.find(
			(issue) => issue.code === "ORGANIZATION_SAME_KIND_OWNERSHIP_CONFLICT",
		);
		expect(conflict?.membershipTokens[0]).toMatch(/^rail:/);
		expect(conflict?.locations).toHaveLength(2);
		for (const location of issues.flatMap((issue) => issue.locations)) {
			expect(Object.values(location.bounds).every(Number.isFinite)).toBe(true);
		}
	});

	it("reports every missing member and a partial semantic module without throwing", () => {
		const fixture = straightFixture();
		const module = fixture.modules.find((candidate) => candidate.eraseEdges.length > 1);
		if (!module) throw new Error("Expected a synthetic multi-edge straight module.");
		const partial = organizationRecord(1, "AREA", "Partial Area", module, {
			railEdges: [module.eraseEdges[0] as (typeof module.eraseEdges)[number]],
			advancedSwitchIds: [999],
			equipmentGroupIds: [999],
		});
		const state = organizationState([partial]);

		const issues = collectStaticFabOrganizationIssues(
			fixture.document.map,
			emptyPortEquipmentState(),
			state,
		);
		const missing = issues.filter(
			(issue) =>
				issue.code === "ORGANIZATION_SWITCH_MEMBER_MISSING" ||
				issue.code === "ORGANIZATION_EQUIPMENT_MEMBER_MISSING",
		);
		expect(missing.flatMap((issue) => issue.membershipTokens)).toEqual(
			expect.arrayContaining(["switch:999", "equipment:999"]),
		);
		expect(
			issues.some(
				(issue) =>
					issue.code === "ORGANIZATION_MODULE_PARTIAL" &&
					issue.membershipTokens.some((token) => token.startsWith("module:")),
			),
		).toBe(true);
	});

	it("reports missing parent endpoints and every cyclic relationship component", () => {
		const fixture = straightFixture();
		const module = fixture.modules[0] as RailModuleOwnership;
		const records = [
			organizationRecord(1, "AREA", "Area", module, undefined, [2]),
			organizationRecord(2, "BAY", "Bay", module, undefined, [3]),
			organizationRecord(3, "AISLE", "Aisle", module, undefined, [1]),
			organizationRecord(4, "PROCESS_FAMILY", "Photo", module, undefined, [99]),
		];
		const issues = collectStaticFabOrganizationIssues(
			fixture.document.map,
			emptyPortEquipmentState(),
			organizationState(records),
		);

		const missingParent = issues.find((issue) => issue.code === "ORGANIZATION_PARENT_MISSING");
		expect(missingParent).toMatchObject({
			organizationIds: [4],
			organizationRecordIndexes: [3],
			parentOrganizationIds: [99],
		});
		const cycle = issues.find((issue) => issue.code === "ORGANIZATION_RELATIONSHIP_CYCLE");
		expect(cycle).toMatchObject({
			organizationIds: [1, 2, 3],
			organizationRecordIndexes: [0, 1, 2],
			parentOrganizationIds: [1, 2, 3],
		});
		expect(cycle?.locations.map((location) => location.relatedEntityId)).toEqual([2, 3, 1]);
	});

	it("keeps invalid-parent occurrences independent from cycle and orphan diagnostics", () => {
		const fixture = straightFixture();
		const module = fixture.modules[0] as RailModuleOwnership;
		const malformed = organizationRecord(1, "AREA", "Area", module, undefined, [1, 1, -4]);
		const issues = collectStaticFabOrganizationIssues(
			fixture.document.map,
			emptyPortEquipmentState(),
			organizationState([malformed]),
		);
		const invalidParents = issues.filter(
			(issue) => issue.code === "ORGANIZATION_PARENT_REFERENCE_INVALID",
		);
		expect(invalidParents.length).toBeGreaterThanOrEqual(3);
		expect(invalidParents.flatMap((issue) => issue.parentOrganizationIds)).toEqual(
			expect.arrayContaining([-4, 1]),
		);

		const ambiguousParentState = organizationState([
			organizationRecord(1, "AREA", "Child", module, undefined, [2]),
			organizationRecord(2, "BAY", "Parent A", module),
			organizationRecord(2, "AISLE", "Parent B", module),
		]);
		const ambiguousIssues = collectStaticFabOrganizationIssues(
			fixture.document.map,
			emptyPortEquipmentState(),
			ambiguousParentState,
		);
		expect(
			ambiguousIssues.find((issue) => issue.code === "ORGANIZATION_RELATIONSHIP_ORPHAN"),
		).toMatchObject({ organizationIds: [1, 2], organizationRecordIndexes: [0, 1, 2] });
	});

	it("reports malformed metadata and cursor values instead of throwing", () => {
		const fixture = straightFixture();
		const malformed = {
			id: 0,
			kind: "UNKNOWN",
			name: " bad ",
			properties: { description: " bad ", color: "ORANGE" },
			parentOrganizationIds: [],
			membership: { railEdges: [], advancedSwitchIds: [], equipmentGroupIds: [] },
		} as unknown as StaticFabOrganizationRecord;
		const state = {
			nextOrganizationId: 0,
			records: [malformed],
		} as StaticFabOrganizationState;

		expect(() =>
			collectStaticFabOrganizationIssues(fixture.document.map, emptyPortEquipmentState(), state),
		).not.toThrow();
		const issues = collectStaticFabOrganizationIssues(
			fixture.document.map,
			emptyPortEquipmentState(),
			state,
		);
		expect(issues.filter((issue) => issue.code === "ORGANIZATION_RECORD_INVALID")).toHaveLength(2);
		expect(issues.filter((issue) => issue.code === "ORGANIZATION_METADATA_INVALID")).toHaveLength(
			3,
		);
		expect(issues.map((issue) => issue.code)).toContain("NEXT_ORGANIZATION_ID_CURSOR_INVALID");
		expect(issues.map((issue) => issue.code)).toContain("ORGANIZATION_MEMBERSHIP_EMPTY");
	});

	it("identifies an equipment port route outside the owning organization's rail membership", () => {
		const fixture = straightFixture();
		const first = fixture.modules[0] as RailModuleOwnership;
		const last = fixture.modules.at(-1) as RailModuleOwnership;
		const routeEdge = last.eraseEdges[0] as (typeof last.eraseEdges)[number];
		const equipment: PortEquipmentState = {
			nextPortId: 2,
			nextEquipmentGroupId: 2,
			ports: [
				{
					id: 1,
					equipmentGroupId: 1,
					route: {
						kind: "CARDINAL_CELL",
						x: routeEdge.from.x,
						z: routeEdge.from.y,
						from: 0,
						to: directionBetweenCells(routeEdge),
					},
					stationMillimeters: 500,
					side: "LEFT",
					lateralOffsetMillimeters: 700,
					direction: "WITH_TRAVEL",
					portType: "OHB",
					barcode: null,
				},
			],
			equipmentGroups: [{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }],
		};
		const record = organizationRecord(1, "AREA", "Port Area", first, {
			railEdges: first.eraseEdges,
			advancedSwitchIds: [],
			equipmentGroupIds: [1],
		});

		const issues = collectStaticFabOrganizationIssues(
			fixture.document.map,
			equipment,
			organizationState([record]),
		);
		expect(
			issues.some(
				(issue) =>
					issue.code === "ORGANIZATION_PORT_ROUTE_UNSUPPORTED" &&
					issue.membershipTokens.includes("port:1"),
			),
		).toBe(true);
	});
});

function straightFixture(): {
	readonly document: RailDocument;
	readonly modules: readonly RailModuleOwnership[];
} {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 });
	if (!plan.valid || !document.commit(plan)) throw new Error(plan.reason);
	const modules = buildRailModuleOwnershipIndex(document.map).modules;
	if (modules.length < 2) throw new Error("Expected multiple synthetic straight modules.");
	return { document, modules };
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	return {
		nextOrganizationId: Math.max(1, ...records.map((record) => record.id + 1)),
		records,
	};
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationKind,
	name: string,
	module: RailModuleOwnership,
	membership: StaticFabOrganizationRecord["membership"] = {
		railEdges: module.eraseEdges,
		advancedSwitchIds: module.advancedSwitchId === null ? [] : [module.advancedSwitchId],
		equipmentGroupIds: [],
	},
	parentOrganizationIds: readonly number[] = [],
): StaticFabOrganizationRecord {
	return {
		id,
		kind,
		name,
		parentOrganizationIds,
		properties: { description: "", color: "TEAL" },
		membership,
	};
}

function directionBetweenCells(edge: RailModuleOwnership["eraseEdges"][number]): 1 | 2 | 4 | 8 {
	if (edge.to.x > edge.from.x) return 2;
	if (edge.to.x < edge.from.x) return 8;
	if (edge.to.y > edge.from.y) return 4;
	return 1;
}
