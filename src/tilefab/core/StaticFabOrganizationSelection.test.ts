import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { planRailConstruction } from "./paint";
import { RailDocument } from "./RailDocument";
import {
	buildRailModuleOwnershipIndex,
	createRailModuleOwnershipIndexHydrator,
	type RailModuleOwnership,
	type RailModuleOwnershipIndex,
	type RailRouteHint,
} from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "./RailTemplateCatalog";
import {
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import {
	resolveStaticFabOrganizationSelection,
	resolveStaticFabOrganizationSelectionFromState,
	resolveStaticFabOrganizationSelectionsFromState,
	STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS,
	type StaticFabOrganizationSelectionResolution,
} from "./StaticFabOrganizationSelection";
import type { Cell } from "./TileMap";

describe("StaticFabOrganizationSelection", () => {
	it("keeps DIRECT as the default for both record and state resolution", () => {
		const fixture = organizationSelectionFixture();
		const recordResolution = resolveStaticFabOrganizationSelection(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state.records[0] as StaticFabOrganizationRecord,
		);
		const stateResolution = resolveStaticFabOrganizationSelectionFromState(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state,
			1,
		);

		expect(recordResolution.valid, recordResolution.reason).toBe(true);
		expect(stateResolution.valid, stateResolution.reason).toBe(true);
		if (!recordResolution.valid || !stateResolution.valid) return;
		expect(recordResolution.selection.rail.ownerships).toHaveLength(2);
		expect(moduleKeys(stateResolution)).toEqual(moduleKeys(recordResolution));
	});

	it("restores membership from local cell candidates without enumerating factory-wide modules", () => {
		const fixture = organizationSelectionFixture();
		const record = fixture.state.records[0] as StaticFabOrganizationRecord;
		let candidateQueries = 0;
		const boundedIndex: RailModuleOwnershipIndex = Object.freeze({
			revision: fixture.ownership.revision,
			get modules(): readonly RailModuleOwnership[] {
				throw new Error("Organization selection must not enumerate every ownership module.");
			},
			candidates: (cell: Cell) => {
				candidateQueries++;
				return fixture.ownership.candidates(cell);
			},
			resolve: (cell: Cell, routeHint?: RailRouteHint) =>
				fixture.ownership.resolve(cell, routeHint),
			find: (key: string) => fixture.ownership.find(key),
			captureSnapshot: () => fixture.ownership.captureSnapshot(),
		});

		const resolution = resolveStaticFabOrganizationSelection(
			boundedIndex,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			record,
		);

		expect(resolution.valid, resolution.reason).toBe(true);
		expect(candidateQueries).toBe(record.membership.railEdges.length * 2);
	});

	it("matches exhaustive membership semantics for built and hydrated indexes across module subsets", () => {
		const fixture = organizationSelectionFixture();
		const hydrator = createRailModuleOwnershipIndexHydrator(fixture.ownership.captureSnapshot());
		while (!hydrator.done) hydrator.step(2);
		const indexes = [fixture.ownership, hydrator.finish()] as const;
		const propertyModules = fixture.modules.slice(0, Math.min(6, fixture.modules.length));

		for (const index of indexes) {
			for (const module of index.modules) {
				for (const edge of module.eraseEdges) {
					const candidates = [...index.candidates(edge.from), ...index.candidates(edge.to)];
					expect(
						candidates.some((candidate) => candidate.key === module.key),
						`Missing endpoint candidate for ${module.key}`,
					).toBe(true);
				}
			}
			for (let mask = 1; mask < 1 << propertyModules.length; mask++) {
				const selected = propertyModules.filter((_, index) => (mask & (1 << index)) !== 0);
				const membership = membershipFromModules(selected);
				const expectedKeys = exhaustiveMembershipModuleKeys(index, membership);
				const resolution = resolveStaticFabOrganizationSelection(
					index,
					fixture.document.portEquipment,
					fixture.document.getPatchSequence(),
					organizationRecord(99, "AREA", `Subset ${mask}`, [], selected),
				);
				expect(resolution.valid, `subset ${mask}: ${resolution.reason}`).toBe(
					expectedKeys !== null,
				);
				if (resolution.valid && expectedKeys) expect(moduleKeys(resolution)).toEqual(expectedKeys);
			}
		}
	});

	it("restores an advanced-switch module from its exact edge and switch membership", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(document.commit(switchPlan)).toBe(true);
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const switchModule = ownership.modules.find((module) => module.advancedSwitchId !== null);
		if (!switchModule) throw new Error("Expected an advanced-switch ownership module.");

		const resolution = resolveStaticFabOrganizationSelection(
			ownership,
			document.portEquipment,
			document.getPatchSequence(),
			organizationRecord(1, "AREA", "Switch", [], [switchModule]),
		);

		expect(resolution.valid, resolution.reason).toBe(true);
		if (resolution.valid) expect(moduleKeys(resolution)).toEqual([switchModule.key]);
	});

	it("resolves a multi-parent DAG effectively without duplicating shared descendants", () => {
		const fixture = organizationSelectionFixture();
		const direct = resolveStaticFabOrganizationSelectionFromState(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state,
			1,
			"DIRECT",
		);
		const effective = resolveStaticFabOrganizationSelectionFromState(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state,
			1,
			"EFFECTIVE",
		);

		expect(direct.valid, direct.reason).toBe(true);
		expect(effective.valid, effective.reason).toBe(true);
		if (!direct.valid || !effective.valid) return;
		expect(direct.selection.rail.ownerships).toHaveLength(2);
		expect(effective.selection.rail.ownerships).toHaveLength(4);
		expect(new Set(moduleKeys(effective))).toHaveLength(4);
		expect(moduleKeys(effective)).toEqual(
			fixture.modules
				.slice(0, 4)
				.map((module) => module.key)
				.sort(),
		);
		expect(effective.reason).toContain("하위 조직");
	});

	it("resolves DIRECT multi-root membership deterministically regardless of root order", () => {
		const fixture = organizationSelectionFixture();
		const reversedWithDuplicate = resolveStaticFabOrganizationSelectionsFromState(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state,
			[3, 2, 3],
			"DIRECT",
		);
		const canonical = resolveStaticFabOrganizationSelectionsFromState(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state,
			[2, 3],
			"DIRECT",
		);

		expect(reversedWithDuplicate.valid, reversedWithDuplicate.reason).toBe(true);
		expect(canonical.valid, canonical.reason).toBe(true);
		if (!reversedWithDuplicate.valid || !canonical.valid) return;
		expect(moduleKeys(reversedWithDuplicate)).toEqual(moduleKeys(canonical));
		expect(moduleKeys(canonical)).toEqual(
			fixture.modules
				.slice(1, 3)
				.map((module) => module.key)
				.sort(),
		);
		expect(reversedWithDuplicate.reason).toContain("2개 조직");
	});

	it("resolves EFFECTIVE multi-root membership once across shared multi-parent descendants", () => {
		const fixture = organizationSelectionFixture();
		const reversedWithDuplicate = resolveStaticFabOrganizationSelectionsFromState(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state,
			[3, 2, 2],
			"EFFECTIVE",
		);
		const canonical = resolveStaticFabOrganizationSelectionsFromState(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state,
			[2, 3],
			"EFFECTIVE",
		);

		expect(reversedWithDuplicate.valid, reversedWithDuplicate.reason).toBe(true);
		expect(canonical.valid, canonical.reason).toBe(true);
		if (!reversedWithDuplicate.valid || !canonical.valid) return;
		expect(moduleKeys(reversedWithDuplicate)).toEqual(moduleKeys(canonical));
		expect(moduleKeys(canonical)).toEqual(
			fixture.modules
				.slice(1, 4)
				.map((module) => module.key)
				.sort(),
		);
		expect(new Set(moduleKeys(canonical))).toHaveLength(3);
		expect(canonical.reason).toContain("2개 조직과 하위 조직");
	});

	it("rejects empty, partially missing, and over-limit root sets without partial selection", () => {
		const fixture = organizationSelectionFixture();
		const resolve = (organizationIds: readonly number[]) =>
			resolveStaticFabOrganizationSelectionsFromState(
				fixture.ownership,
				fixture.document.portEquipment,
				fixture.document.getPatchSequence(),
				fixture.state,
				organizationIds,
				"EFFECTIVE",
			);

		const empty = resolve([]);
		const partiallyMissing = resolve([1, 99]);
		const overLimit = resolve(
			Array.from(
				{ length: STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS + 1 },
				(_, index) => index + 1,
			),
		);
		const duplicateFlood = resolve(
			Array.from({ length: STATIC_FAB_ORGANIZATION_SELECTION_MAX_ROOTS + 1 }, () => 1),
		);

		expect(empty.valid).toBe(false);
		expect(empty.selection).toBeNull();
		expect(empty.reason).toContain("하나 이상");
		expect(partiallyMissing.valid).toBe(false);
		expect(partiallyMissing.selection).toBeNull();
		expect(partiallyMissing.reason).toContain("조직 99");
		expect(overLimit.valid).toBe(false);
		expect(overLimit.selection).toBeNull();
		expect(overLimit.reason).toContain("최대");
		expect(duplicateFlood.valid).toBe(false);
		expect(duplicateFlood.selection).toBeNull();
		expect(duplicateFlood.reason).toContain("최대");
	});

	it("fails safely when the requested organization is no longer present", () => {
		const fixture = organizationSelectionFixture();
		const missing = resolveStaticFabOrganizationSelectionFromState(
			fixture.ownership,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			fixture.state,
			99,
			"EFFECTIVE",
		);

		expect(missing.valid).toBe(false);
		expect(missing.selection).toBeNull();
		expect(missing.reason).toContain("조직 99");
		expect(missing.reason).toContain("찾을 수 없습니다");
	});
});

function organizationSelectionFixture(): {
	readonly document: RailDocument;
	readonly ownership: ReturnType<typeof buildRailModuleOwnershipIndex>;
	readonly modules: readonly RailModuleOwnership[];
	readonly state: StaticFabOrganizationState;
} {
	const document = new RailDocument();
	const plan = planRailTemplate(
		document.map,
		"long-bay",
		{ x: 0, y: 0 },
		initialRailTemplatePose(),
		defaultRailTemplateParameters("long-bay"),
	);
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	const ownership = buildRailModuleOwnershipIndex(document.map);
	const modules = [...ownership.modules].sort((left, right) => left.key.localeCompare(right.key));
	expect(modules.length).toBeGreaterThanOrEqual(4);
	const records = [
		organizationRecord(1, "AREA", "Factory", [], modules.slice(0, 2)),
		organizationRecord(2, "BAY", "Bay A", [1], modules.slice(1, 2)),
		organizationRecord(3, "AISLE", "Aisle A", [1], modules.slice(2, 3)),
		organizationRecord(4, "PROCESS_FAMILY", "Photo", [2, 3], modules.slice(2, 4)),
	] as const;
	return {
		document,
		ownership,
		modules,
		state: Object.freeze({ nextOrganizationId: 5, records: Object.freeze(records) }),
	};
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
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: membershipFromModules(modules),
	});
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, RailModuleOwnership["eraseEdges"][number]>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) {
			edges.set(`${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`, edge);
		}
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()]),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([]),
	});
}

function moduleKeys(
	resolution: Extract<StaticFabOrganizationSelectionResolution, { readonly valid: true }>,
): string[] {
	return resolution.selection.rail.ownerships.map((module) => module.key).sort();
}

function exhaustiveMembershipModuleKeys(
	ownership: RailModuleOwnershipIndex,
	membership: StaticFabOrganizationMembership,
): string[] | null {
	const targetEdges = new Set(membership.railEdges.map(staticFabOrganizationEdgeKey));
	const targetSwitches = new Set(membership.advancedSwitchIds);
	const selected = ownership.modules.filter((module) => {
		const touchesEdge = module.eraseEdges.some((edge) =>
			targetEdges.has(staticFabOrganizationEdgeKey(edge)),
		);
		const touchesSwitch =
			module.advancedSwitchId !== null && targetSwitches.has(module.advancedSwitchId);
		return (
			(touchesEdge || touchesSwitch) &&
			module.eraseEdges.every((edge) => targetEdges.has(staticFabOrganizationEdgeKey(edge))) &&
			(module.advancedSwitchId === null || targetSwitches.has(module.advancedSwitchId))
		);
	});
	if (selected.length === 0) return null;
	const resolvedEdges = new Set<string>();
	const resolvedSwitches = new Set<number>();
	for (const module of selected) {
		for (const edge of module.eraseEdges) resolvedEdges.add(staticFabOrganizationEdgeKey(edge));
		if (module.advancedSwitchId !== null) resolvedSwitches.add(module.advancedSwitchId);
	}
	if (!sameSet(targetEdges, resolvedEdges) || !sameSet(targetSwitches, resolvedSwitches))
		return null;
	return selected.map((module) => module.key).sort();
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
	return left.size === right.size && [...left].every((value) => right.has(value));
}
