import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { planRailConstruction } from "../core/paint";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
} from "../core/RailModuleOwnership";
import { STATIC_FAB_ARRANGEMENT_VERSION } from "../core/StaticFabArrangement";
import {
	STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
	type StaticFabArrangementRootReference,
} from "../core/StaticFabArrangementCommand";
import type {
	StaticFabOrganizationMembership,
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import { resolveStaticFabArrangementCommand } from "./StaticFabArrangementCommandResolver";

describe("StaticFabArrangementCommandResolver", () => {
	it("re-resolves one exact connected component from canonical module keys", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const [first] = ownershipComponents(ownership.modules);
		const inputKeys = first.map((module) => module.key).reverse();

		const result = resolveStaticFabArrangementCommand(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizationState([]),
			command([{ kind: "STATIC_COMPONENT", moduleKeys: inputKeys }]),
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.intent.roots[0]).toEqual({
			kind: "STATIC_COMPONENT",
			moduleKeys: [...inputKeys].sort(),
		});
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0]).toMatchObject({
			kind: "STATIC_COMPONENT",
			moduleKeys: [...inputKeys].sort(),
			bounds: { minX: 0, minZ: 0, maxXExclusive: 9, maxZExclusive: 1 },
		});
	});

	it("rejects an ownership index that became stale after the command was captured", () => {
		const map = disjointLinearMap();
		const staleOwnership = buildRailModuleOwnershipIndex(map);
		const [first] = ownershipComponents(staleOwnership.modules);
		const extension = planRailConstruction(map, { x: 8, y: 0 }, { x: 9, y: 0 });
		expect(extension.valid, extension.reason).toBe(true);
		map.applyAtomicMutations(extension.mutations, []);

		const result = resolveStaticFabArrangementCommand(
			map,
			staleOwnership,
			emptyPortEquipmentState(),
			0,
			organizationState([]),
			componentCommand(first),
		);

		expect(result).toMatchObject({ valid: false, code: "INVALID_SOURCE" });
		expect(result.reason).toContain("다시 선택");
	});

	it("rejects a missing module key and a reference spanning disconnected components", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const [first, second] = ownershipComponents(ownership.modules);

		const missing = resolveStaticFabArrangementCommand(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizationState([]),
			command([{ kind: "STATIC_COMPONENT", moduleKeys: ["missing-module-key"] }]),
		);
		const split = resolveStaticFabArrangementCommand(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizationState([]),
			command([
				{
					kind: "STATIC_COMPONENT",
					moduleKeys: [first[0]?.key, second[0]?.key].filter(
						(key): key is string => key !== undefined,
					),
				},
			]),
		);

		expect(missing).toMatchObject({ valid: false, code: "MISSING_ROOT" });
		expect(missing.reason).toContain("missing-module-key");
		expect(split).toMatchObject({ valid: false, code: "INVALID_SOURCE" });
		expect(split.reason).toContain("둘 이상의 연결 컴포넌트");
	});

	it("re-resolves current DIRECT organization membership by stable organization ID", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const [first, second] = ownershipComponents(ownership.modules);
		const reference = command([
			{ kind: "ORGANIZATION", organizationId: 1, selectionMode: "DIRECT" },
		]);

		const firstResult = resolveStaticFabArrangementCommand(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizationState([organization(1, "AREA", "Area", [], first)]),
			reference,
		);
		const movedMembershipResult = resolveStaticFabArrangementCommand(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizationState([organization(1, "AREA", "Area", [], second)]),
			reference,
		);

		expect(firstResult.valid, firstResult.reason).toBe(true);
		expect(movedMembershipResult.valid, movedMembershipResult.reason).toBe(true);
		if (!firstResult.valid || !movedMembershipResult.valid) return;
		expect(firstResult.roots[0]).toMatchObject({
			organizationRootIds: [1],
			organizationSelectionMode: "DIRECT",
			moduleKeys: first.map((module) => module.key).sort(),
		});
		expect(movedMembershipResult.roots[0]).toMatchObject({
			organizationRootIds: [1],
			organizationSelectionMode: "DIRECT",
			moduleKeys: second.map((module) => module.key).sort(),
		});
	});

	it("re-resolves EFFECTIVE descendants and rejects a removed organization root", () => {
		const map = disjointLinearMap();
		const ownership = buildRailModuleOwnershipIndex(map);
		const [first, second] = ownershipComponents(ownership.modules);
		const organizations = organizationState([
			organization(1, "AREA", "Factory", [], first),
			organization(2, "BAY", "Bay", [1], second),
		]);
		const effectiveCommand = command([
			{ kind: "ORGANIZATION", organizationId: 1, selectionMode: "EFFECTIVE" },
		]);

		const effective = resolveStaticFabArrangementCommand(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizations,
			effectiveCommand,
		);
		const missing = resolveStaticFabArrangementCommand(
			map,
			ownership,
			emptyPortEquipmentState(),
			0,
			organizationState([organization(2, "BAY", "Bay", [], second)]),
			effectiveCommand,
		);

		expect(effective.valid, effective.reason).toBe(true);
		if (effective.valid) {
			expect(effective.roots[0]).toMatchObject({
				organizationRootIds: [1],
				organizationSelectionMode: "EFFECTIVE",
				moduleKeys: ownership.modules.map((module) => module.key).sort(),
				bounds: { minX: 0, minZ: 0, maxXExclusive: 29, maxZExclusive: 1 },
			});
		}
		expect(missing).toMatchObject({ valid: false, code: "MISSING_ROOT" });
		expect(missing.reason).toContain("조직 1");
	});
});

function command(roots: readonly StaticFabArrangementRootReference[]) {
	return {
		version: STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
		arrangementVersion: STATIC_FAB_ARRANGEMENT_VERSION,
		axis: "X" as const,
		mode: "ALIGN_MIN" as const,
		roots,
	};
}

function componentCommand(modules: readonly RailModuleOwnership[]) {
	return command([{ kind: "STATIC_COMPONENT", moduleKeys: modules.map((module) => module.key) }]);
}

function disjointLinearMap(): TileMap {
	const map = new TileMap();
	const first = planRailConstruction(new TileMap(), { x: 0, y: 0 }, { x: 8, y: 0 });
	const second = planRailConstruction(new TileMap(), { x: 20, y: 0 }, { x: 28, y: 0 });
	if (!first.valid || !second.valid) throw new Error("failed to build arrangement command fixture");
	map.applyAtomicMutations([...first.mutations, ...second.mutations], []);
	return map;
}

function ownershipComponents(
	modules: readonly RailModuleOwnership[],
): readonly [readonly RailModuleOwnership[], readonly RailModuleOwnership[]] {
	return [
		modules.filter((module) => module.footprintCells.some((cell) => cell.x < 10)),
		modules.filter((module) => module.footprintCells.some((cell) => cell.x > 10)),
	];
}

function organization(
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
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: membership(modules),
	});
}

function membership(modules: readonly RailModuleOwnership[]): StaticFabOrganizationMembership {
	const edges = new Map<string, RailModuleOwnership["eraseEdges"][number]>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) {
			edges.set(`${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`, edge);
		}
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()]),
		advancedSwitchIds: Object.freeze([]),
		equipmentGroupIds: Object.freeze([]),
	});
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId:
			records.length === 0 ? 1 : Math.max(...records.map((record) => record.id)) + 1,
		records: Object.freeze([...records]),
	});
}
