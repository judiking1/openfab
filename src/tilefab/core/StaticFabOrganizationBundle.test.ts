import { describe, expect, it } from "vitest";
import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import type { EquipmentGroupRecord, PortEquipmentState } from "./EquipmentGroup";
import type { CardinalPortRoute, PortRecord } from "./PortRecord";
import { planRailPath } from "./paint";
import { RailDocument } from "./RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type DirectedRailEdge,
	type RailModuleOwnership,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	planRailTemplate,
} from "./RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_W, type Direction, moveCell, oppositeDirection } from "./railShape";
import {
	compareDirectedRailEdges,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import {
	captureStaticFabOrganizationBundle,
	materializeStaticFabOrganizationBundle,
	prepareStaticFabOrganizationBundle,
	resolveStaticFabOrganizationBundleCaptureOwnership,
	type StaticFabOrganizationBundle,
	type StaticFabOrganizationBundleQuarterTurns,
	staticFabOrganizationBundleError,
	transformStaticFabOrganizationBundle,
} from "./StaticFabOrganizationBundle";
import { type Cell, encodeRailCell } from "./TileMap";

describe("StaticFabOrganizationBundle", () => {
	it("captures DIRECT multi-root bundles deterministically regardless of root input order", () => {
		const fixture = longBayFixture();
		const state = organizationState([
			organizationRecord(10, "AREA", "Factory Root", [], [fixture.modules[0]]),
			organizationRecord(20, "BAY", "Bay Root", [], [fixture.modules[1]]),
			organizationRecord(30, "AISLE", "Unselected Aisle", [], [fixture.modules[2]]),
		]);

		const reversed = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			state,
			[20, 10, 20],
			"DIRECT",
		);
		const canonical = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			state,
			[10, 20],
			"DIRECT",
		);

		expect(reversed.valid, reversed.reason).toBe(true);
		expect(canonical.valid, canonical.reason).toBe(true);
		if (!reversed.valid || !canonical.valid) return;
		expect(reversed.bundle).toEqual(canonical.bundle);
		expect(reversed.sourceBounds).toEqual(canonical.sourceBounds);
		expect(reversed.sourceBounds.maxX - reversed.sourceBounds.minX).toBe(
			reversed.bundle.sourceWidthMeters,
		);
		expect(reversed.sourceBounds.maxY - reversed.sourceBounds.minY).toBe(
			reversed.bundle.sourceHeightMeters,
		);
		expect(Object.isFrozen(reversed.sourceBounds)).toBe(true);
		expect(reversed.bundle.captureMode).toBe("DIRECT");
		expect(reversed.bundle.rootOrganizationIndices).toEqual([0, 1]);
		expect(reversed.bundle.organizations.map((record) => record.name)).toEqual([
			"Factory Root",
			"Bay Root",
		]);
	});

	it("reuses an exact source-bound ownership index without changing the portable bundle", () => {
		const fixture = longBayFixture();
		const state = organizationState([
			organizationRecord(10, "AREA", "Factory Root", [], [fixture.modules[0]]),
			organizationRecord(20, "BAY", "Bay Root", [10], [fixture.modules[1]]),
		]);
		const ordinary = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			state,
			[10],
			"EFFECTIVE",
		);
		const prepared = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			state,
			[10],
			"EFFECTIVE",
			buildRailModuleOwnershipIndex(fixture.document.map),
		);

		expect(ordinary.valid, ordinary.reason).toBe(true);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!ordinary.valid || !prepared.valid) return;
		expect(prepared.bundle).toEqual(ordinary.bundle);
		expect(prepared.sourceBounds).toEqual(ordinary.sourceBounds);
	});

	it("accepts only an ownership index bound to the exact map generation", () => {
		const fixture = longBayFixture();
		const matching = buildRailModuleOwnershipIndex(fixture.document.map);
		expect(resolveStaticFabOrganizationBundleCaptureOwnership(fixture.document.map, matching)).toBe(
			matching,
		);

		const foreign = buildRailModuleOwnershipIndex(longBayFixture().document.map);
		const rebuiltForeign = resolveStaticFabOrganizationBundleCaptureOwnership(
			fixture.document.map,
			foreign,
		);
		expect(rebuiltForeign).not.toBe(foreign);
		expect(railModuleOwnershipIndexMatchesMap(rebuiltForeign, fixture.document.map)).toBe(true);

		const stale = buildRailModuleOwnershipIndex(fixture.document.map);
		expect(
			fixture.document.map.setEncoded(
				10_000,
				10_000,
				encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }),
			),
		).toBe(true);
		const rebuiltStale = resolveStaticFabOrganizationBundleCaptureOwnership(
			fixture.document.map,
			stale,
		);
		expect(rebuiltStale).not.toBe(stale);
		expect(railModuleOwnershipIndexMatchesMap(rebuiltStale, fixture.document.map)).toBe(true);

		const aba = buildRailModuleOwnershipIndex(fixture.document.map);
		const checkpoint = fixture.document.map.createMutationCheckpoint();
		const before = fixture.document.map.getEncoded(20_000, 20_000);
		const after = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
		const mutation = Object.freeze({ x: 20_000, y: 20_000, before, after });
		const revisionBeforeAba = fixture.document.map.getRevision();
		expect(fixture.document.map.applyAtomicMutations([mutation], [])).toBe(true);
		fixture.document.map.rollbackAtomicMutations([mutation], [], checkpoint);
		expect(fixture.document.map.getRevision()).toBe(revisionBeforeAba);
		const rebuiltAba = resolveStaticFabOrganizationBundleCaptureOwnership(
			fixture.document.map,
			aba,
		);
		expect(rebuiltAba).not.toBe(aba);
		expect(railModuleOwnershipIndexMatchesMap(rebuiltAba, fixture.document.map)).toBe(true);
	});

	it("rejects an oversized root request before resolving or sorting organization IDs", () => {
		const fixture = longBayFixture();
		const result = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			organizationState([organizationRecord(10, "AREA", "Factory Root", [], [fixture.modules[0]])]),
			Array.from({ length: 1_025 }, (_, index) => index + 1),
			"DIRECT",
		);

		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.code).toBe("LIMIT_EXCEEDED");
		expect(result.reason).toContain("1,024");
	});

	it("captures shared descendants once in EFFECTIVE mode without flattening direct memberships", () => {
		const fixture = longBayFixture();
		const records = [
			organizationRecord(10, "AREA", "Factory", [], [fixture.modules[0]]),
			organizationRecord(20, "BAY", "Bay", [], [fixture.modules[1]]),
			organizationRecord(30, "AISLE", "Shared Aisle", [10, 20], [fixture.modules[2]]),
			organizationRecord(40, "PROCESS_FAMILY", "Photo", [30], [fixture.modules[3]]),
		] as const;
		const result = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			organizationState(records),
			[20, 10],
			"EFFECTIVE",
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.bundle.rootOrganizationIndices).toEqual([0, 1]);
		expect(result.bundle.organizations.map((record) => record.name)).toEqual([
			"Factory",
			"Bay",
			"Shared Aisle",
			"Photo",
		]);
		expect(result.bundle.organizations[2]?.parentOrganizationIndices).toEqual([0, 1]);
		expect(result.bundle.organizations[3]?.parentOrganizationIndices).toEqual([2]);
		expect(
			result.bundle.organizations.map((record) => record.membership.railEdgeIndices.length),
		).toEqual(records.map((record) => record.membership.railEdges.length));
		expect(
			new Set(result.bundle.organizations.flatMap((record) => record.membership.railEdgeIndices))
				.size,
		).toBe(result.bundle.railEdges.length);

		const oneRoot = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			organizationState(records),
			[10],
			"EFFECTIVE",
		);
		expect(oneRoot.valid, oneRoot.reason).toBe(true);
		if (!oneRoot.valid) return;
		expect(oneRoot.bundle.organizations.map((record) => record.name)).toEqual([
			"Factory",
			"Shared Aisle",
			"Photo",
		]);
		expect(oneRoot.bundle.organizations[1]?.parentOrganizationIndices).toEqual([0]);
		expect(oneRoot.bundle.organizations[2]?.parentOrganizationIndices).toEqual([1]);

		const unreachable = mutableBundle(result.bundle);
		unreachable.rootOrganizationIndices = [unreachable.organizations.length - 1];
		expect(staticFabOrganizationBundleError(unreachable)).toContain("도달할 수 없는 조직");
	});

	it("cuts external parents while preserving the selected organization as a portable root", () => {
		const fixture = longBayFixture();
		const state = organizationState([
			organizationRecord(10, "AREA", "Factory", [], [fixture.modules[0]]),
			organizationRecord(20, "BAY", "Bay", [10], [fixture.modules[1]]),
		]);

		const result = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			state,
			[20],
			"DIRECT",
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.bundle.organizations).toHaveLength(1);
		expect(result.bundle.organizations[0]?.name).toBe("Bay");
		expect(result.bundle.organizations[0]?.parentOrganizationIndices).toEqual([]);
		expect(result.bundle.rootOrganizationIndices).toEqual([0]);
	});

	it("rejects malformed local indices and organization-orphaned payload", () => {
		const bundle = captureSingleOrganizationBundle();
		const malformed = mutableBundle(bundle);
		malformed.rootOrganizationIndices = [malformed.organizations.length];
		expect(staticFabOrganizationBundleError(malformed)).toContain("루트 조직 local index");

		const orphaned = mutableBundle(bundle);
		const membership = orphaned.organizations[0]?.membership;
		if (!membership || membership.railEdgeIndices.length < 2) {
			throw new Error("Expected a multi-edge organization fixture.");
		}
		membership.railEdgeIndices = membership.railEdgeIndices.slice(0, -1);
		expect(staticFabOrganizationBundleError(orphaned)).toContain(
			"어떤 조직도 소유하지 않는 payload",
		);
	});

	it("treats deserialized input as untrusted and verifies reconstructed modules", () => {
		expect(() => staticFabOrganizationBundleError({ version: 1 })).not.toThrow();
		expect(staticFabOrganizationBundleError({ version: 1 })).toContain("최상위 필드");

		const forged = mutableBundle(captureSingleOrganizationBundle());
		expect(staticFabOrganizationBundleError(forged)).toBeNull();
		forged.sourceModuleCount++;
		expect(staticFabOrganizationBundleError(forged)).toContain("source 모듈 수");
		forged.sourceModuleCount--;
		expect(staticFabOrganizationBundleError(forged)).toBeNull();
	});

	it("rejects unknown fields at every portable JSON nesting boundary", () => {
		const topLevel = mutableBundle(captureSingleOrganizationBundle());
		(topLevel as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabOrganizationBundleError(topLevel)).toContain("최상위 필드");

		const edge = mutableBundle(captureSingleOrganizationBundle());
		(edge.railEdges[0] as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabOrganizationBundleError(edge)).toContain("레일 edge 필드");

		const properties = mutableBundle(captureSingleOrganizationBundle());
		(properties.organizations[0]?.properties as unknown as Record<string, unknown>).unexpected = {
			mutable: true,
		};
		expect(staticFabOrganizationBundleError(properties)).toContain("조직 0 필드");

		const equipment = mutableBundle(captureEquipmentOrganizationBundle());
		(equipment.ports[0]?.route as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabOrganizationBundleError(equipment)).toContain("port 0 필드");

		const group = mutableBundle(captureEquipmentOrganizationBundle());
		(group.equipmentGroups[0] as unknown as Record<string, unknown>).unexpected = true;
		expect(staticFabOrganizationBundleError(group)).toContain("장비 그룹 0 필드");
	});

	it("prepares deserialized bundles once as canonical deeply frozen graphs", () => {
		const source = mutableBundle(captureEquipmentOrganizationBundle());
		const sourceName = source.organizations[0]?.name;
		const prepared = prepareStaticFabOrganizationBundle(source);
		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;

		expect(prepared.bundle).not.toBe(source);
		expect(recursivelyFrozen(prepared.bundle)).toBe(true);
		source.rootOrganizationIndices[0] = 999;
		if (source.organizations[0]) source.organizations[0].name = "Mutated source";
		if (source.ports[0]?.route.kind === "CARDINAL_CELL") {
			source.ports[0].route.x = 999;
		}
		expect(prepared.bundle.rootOrganizationIndices).toEqual([0]);
		expect(prepared.bundle.organizations[0]?.name).toBe(sourceName);
		expect(prepareStaticFabOrganizationBundle(prepared.bundle)).toMatchObject({
			valid: true,
			bundle: prepared.bundle,
		});
	});

	it("rejects portable port stations beyond the serialization safety bound", () => {
		const bundle = mutableBundle(captureEquipmentOrganizationBundle());
		if (!bundle.ports[0]) throw new Error("Expected one portable port.");
		bundle.ports[0].stationMillimeters = 0x7fff_ffff;
		expect(staticFabOrganizationBundleError(bundle)).toContain("port station");
	});

	it("rotates around the portable origin and then translates for every quarter turn", () => {
		const bundle = captureSingleOrganizationBundle();
		const anchor = { x: 17, y: -9 };

		for (const quarterTurns of [0, 1, 2, 3] as const) {
			const materialized = materializeStaticFabOrganizationBundle(bundle, anchor, quarterTurns);
			expect(materialized.railEdges).toEqual(
				bundle.railEdges.map((edge) => ({
					from: transformCell(edge.from, anchor, quarterTurns),
					to: transformCell(edge.to, anchor, quarterTurns),
				})),
			);
			expect(materialized.widthMeters).toBe(
				quarterTurns % 2 === 0 ? bundle.sourceWidthMeters : bundle.sourceHeightMeters,
			);
			expect(materialized.heightMeters).toBe(
				quarterTurns % 2 === 0 ? bundle.sourceHeightMeters : bundle.sourceWidthMeters,
			);
			expect(materialized.anchor).toEqual(anchor);
			expect(materialized.organizations).toEqual(bundle.organizations);
			expect(materialized.organizations).not.toBe(bundle.organizations);
			expect(materialized.rootOrganizationIndices).not.toBe(bundle.rootOrganizationIndices);
			expect(recursivelyFrozen(materialized)).toBe(true);
		}
	});

	it("bakes placement rotation into portable coordinates and remaps organization edge ownership", () => {
		const bundle = captureSingleOrganizationBundle();
		for (const quarterTurns of [1, 2, 3] as const) {
			const anchor =
				quarterTurns === 1
					? { x: bundle.sourceHeightMeters, y: 0 }
					: quarterTurns === 2
						? { x: bundle.sourceWidthMeters, y: bundle.sourceHeightMeters }
						: { x: 0, y: bundle.sourceWidthMeters };
			const expected = materializeStaticFabOrganizationBundle(bundle, anchor, quarterTurns);
			const transformed = transformStaticFabOrganizationBundle(bundle, quarterTurns);
			const restored = materializeStaticFabOrganizationBundle(transformed, { x: 0, y: 0 }, 0);

			expect(prepareStaticFabOrganizationBundle(transformed)).toMatchObject({ valid: true });
			expect(restored.railEdges.map(edgeKey).sort()).toEqual(
				expected.railEdges.map(edgeKey).sort(),
			);
			expect(restored.advancedSwitches).toEqual(expected.advancedSwitches);
			expect(restored.ports).toEqual(expected.ports);
			expect(restored.widthMeters).toBe(expected.widthMeters);
			expect(restored.heightMeters).toBe(expected.heightMeters);
			for (let index = 0; index < restored.organizations.length; index++) {
				const restoredOrganization = restored.organizations[index];
				const expectedOrganization = expected.organizations[index];
				expect(restoredOrganization?.name).toBe(expectedOrganization?.name);
				expect(
					restoredOrganization?.membership.railEdgeIndices
						.map((edgeIndex) => edgeKey(restored.railEdges[edgeIndex] as DirectedRailEdge))
						.sort(),
				).toEqual(
					expectedOrganization?.membership.railEdgeIndices
						.map((edgeIndex) => edgeKey(expected.railEdges[edgeIndex] as DirectedRailEdge))
						.sort(),
				);
			}
		}
	});

	it("materializes an immutable graph that cannot be changed through source JSON aliases", () => {
		const source = mutableBundle(captureSingleOrganizationBundle());
		const materialized = materializeStaticFabOrganizationBundle(source, { x: 8, y: -3 }, 0);
		const originalName = materialized.organizations[0]?.name;
		const originalMembership = [
			...(materialized.organizations[0]?.membership.railEdgeIndices ?? []),
		];

		source.rootOrganizationIndices[0] = 999;
		if (source.organizations[0]) {
			source.organizations[0].name = "Mutated after materialization";
			source.organizations[0].membership.railEdgeIndices.length = 0;
		}

		expect(materialized.rootOrganizationIndices).toEqual([0]);
		expect(materialized.organizations[0]?.name).toBe(originalName);
		expect(materialized.organizations[0]?.membership.railEdgeIndices).toEqual(originalMembership);
		expect(recursivelyFrozen(materialized)).toBe(true);
	});

	it("captures an advanced switch atomically and rotates its derived route with the rail payload", () => {
		const fixture = advancedSwitchFixture();
		const result = captureStaticFabOrganizationBundle(
			fixture.document.map,
			fixture.document.portEquipment,
			fixture.document.getPatchSequence(),
			organizationState([organizationRecord(1, "AREA", "Switch Area", [], [fixture.switchModule])]),
			[1],
			"DIRECT",
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.bundle.advancedSwitches).toHaveLength(1);
		expect(result.bundle.organizations[0]?.membership.advancedSwitchIndices).toEqual([0]);
		expect(result.bundle.advancedSwitches[0]).not.toHaveProperty("id");

		const anchor = { x: 40, y: -12 };
		const materialized = materializeStaticFabOrganizationBundle(result.bundle, anchor, 1);
		const portable = result.bundle.advancedSwitches[0];
		const rotated = materialized.advancedSwitches[0];
		if (!portable || !rotated) throw new Error("Expected one portable advanced switch.");
		expect(rotated.origin).toEqual(transformCell(portable.origin, anchor, 1));
		expect(rotated.forward).toBe(rotateDirection(portable.forward, 1));
		expect(rotated.lateral).toBe(rotateDirection(portable.lateral, 1));

		const edgeKeys = new Set(materialized.railEdges.map(edgeKey));
		const geometry = deriveAdvancedSwitchGeometry({ id: 1, ...rotated });
		for (const route of geometry.routes) {
			for (let index = 1; index < route.length; index++) {
				expect(
					edgeKeys.has(
						edgeKey({
							from: route[index - 1] as Cell,
							to: route[index] as Cell,
						}),
					),
				).toBe(true);
			}
		}
	});

	it("captures complete OHB, EQ, and STK groups without runtime identities", () => {
		const fixture = longBayFixture();
		const equipment = mixedEquipmentState(fixture.document);
		const base = organizationRecord(1, "AREA", "Port-first Area", [], fixture.modules);
		const record: StaticFabOrganizationRecord = Object.freeze({
			...base,
			membership: Object.freeze({
				...base.membership,
				equipmentGroupIds: Object.freeze([1, 2, 3]),
			}),
		});
		const result = captureStaticFabOrganizationBundle(
			fixture.document.map,
			equipment,
			fixture.document.getPatchSequence(),
			organizationState([record]),
			[1],
			"DIRECT",
		);

		expect(result.valid, result.reason).toBe(true);
		if (!result.valid) return;
		expect(result.bundle.equipmentGroups.map((group) => group.kind)).toEqual(["OHB", "EQ", "STK"]);
		expect(result.bundle.ports).toHaveLength(7);
		expect(result.bundle.organizations[0]?.membership.equipmentGroupIndices).toEqual([0, 1, 2]);
		expect(JSON.stringify(result.bundle)).not.toMatch(/barcode|nextPortId|equipmentGroupId/);
		expect(staticFabOrganizationBundleError(result.bundle)).toBeNull();
		expect(recursivelyFrozen(result.bundle)).toBe(true);
	});
});

function longBayFixture(): {
	readonly document: RailDocument;
	readonly modules: readonly RailModuleOwnership[];
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
	const modules = [...buildRailModuleOwnershipIndex(document.map).modules].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
	if (modules.length < 4) throw new Error("Expected at least four Long Bay modules.");
	return { document, modules };
}

function captureSingleOrganizationBundle(): StaticFabOrganizationBundle {
	const fixture = longBayFixture();
	const result = captureStaticFabOrganizationBundle(
		fixture.document.map,
		fixture.document.portEquipment,
		fixture.document.getPatchSequence(),
		organizationState([organizationRecord(1, "AREA", "Factory", [], fixture.modules.slice(0, 2))]),
		[1],
		"DIRECT",
	);
	expect(result.valid, result.reason).toBe(true);
	if (!result.valid) throw new Error(result.reason);
	return result.bundle;
}

function captureEquipmentOrganizationBundle(): StaticFabOrganizationBundle {
	const fixture = longBayFixture();
	const equipment = mixedEquipmentState(fixture.document);
	const base = organizationRecord(1, "AREA", "Port-first Area", [], fixture.modules);
	const record: StaticFabOrganizationRecord = Object.freeze({
		...base,
		membership: Object.freeze({
			...base.membership,
			equipmentGroupIds: Object.freeze([1, 2, 3]),
		}),
	});
	const result = captureStaticFabOrganizationBundle(
		fixture.document.map,
		equipment,
		fixture.document.getPatchSequence(),
		organizationState([record]),
		[1],
		"DIRECT",
	);
	expect(result.valid, result.reason).toBe(true);
	if (!result.valid) throw new Error(result.reason);
	return result.bundle;
}

function advancedSwitchFixture(): {
	readonly document: RailDocument;
	readonly switchModule: RailModuleOwnership;
} {
	const document = new RailDocument();
	const origin = { x: 0, y: 0 };
	const cells: Cell[] = [];
	let current = origin;
	for (let distance = 0; distance < 4; distance++) {
		cells.unshift(current);
		current = moveCell(current, oppositeDirection(DIR_E));
	}
	const terminal = planRailPath(document.map, cells);
	if (!terminal.valid || !document.commit(terminal)) {
		throw new Error(`Failed to create switch terminal fixture: ${terminal.reason}`);
	}
	const switchPlan = planAdvancedSwitch(document.map, origin, { x: 0, y: 2 }, "C");
	if (!switchPlan.valid || !document.commit(switchPlan) || !switchPlan.switchRecord) {
		throw new Error(`Failed to create advanced switch fixture: ${switchPlan.reason}`);
	}
	const switchModule = buildRailModuleOwnershipIndex(document.map).modules.find(
		(module) => module.advancedSwitchId === switchPlan.switchRecord?.id,
	);
	if (!switchModule) throw new Error("Expected advanced-switch module ownership.");
	return { document, switchModule };
}

function organizationState(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	const maximumId = records.reduce((maximum, record) => Math.max(maximum, record.id), 0);
	return Object.freeze({
		nextOrganizationId: maximumId + 1,
		records: Object.freeze([...records].sort((left, right) => left.id - right.id)),
	});
}

function organizationRecord(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	name: string,
	parentOrganizationIds: readonly number[],
	modules: readonly (RailModuleOwnership | undefined)[],
): StaticFabOrganizationRecord {
	if (modules.some((module) => module === undefined)) {
		throw new Error(`Organization ${id} fixture references a missing rail module.`);
	}
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze(
			[...parentOrganizationIds].sort((left, right) => left - right),
		),
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: membershipFromModules(modules as readonly RailModuleOwnership[]),
	});
}

function membershipFromModules(
	modules: readonly RailModuleOwnership[],
): StaticFabOrganizationMembership {
	const edges = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	for (const module of modules) {
		for (const edge of module.eraseEdges) edges.set(edgeKey(edge), edge);
		if (module.advancedSwitchId !== null) switchIds.add(module.advancedSwitchId);
	}
	return Object.freeze({
		railEdges: Object.freeze([...edges.values()].sort(compareDirectedRailEdges)),
		advancedSwitchIds: Object.freeze([...switchIds].sort((left, right) => left - right)),
		equipmentGroupIds: Object.freeze([]),
	});
}

function mutableBundle(bundle: StaticFabOrganizationBundle): MutableBundle {
	return JSON.parse(JSON.stringify(bundle)) as MutableBundle;
}

type MutableBundle = DeepMutable<StaticFabOrganizationBundle>;

type DeepMutable<Value> = Value extends readonly (infer Item)[]
	? DeepMutable<Item>[]
	: Value extends object
		? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
		: Value;

function transformCell(
	cell: Cell,
	anchor: Cell,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): Cell {
	const rotated =
		quarterTurns === 0
			? cell
			: quarterTurns === 1
				? { x: -cell.y, y: cell.x }
				: quarterTurns === 2
					? { x: -cell.x, y: -cell.y }
					: { x: cell.y, y: -cell.x };
	return { x: rotated.x + anchor.x, y: rotated.y + anchor.y };
}

function rotateDirection(
	direction: Direction,
	quarterTurns: StaticFabOrganizationBundleQuarterTurns,
): Direction {
	const directionOrder = [1, 2, 4, 8] as const;
	const index = directionOrder.indexOf(direction);
	if (index < 0) throw new Error(`Unsupported direction ${direction}.`);
	return directionOrder[(index + quarterTurns) % directionOrder.length] as Direction;
}

function edgeKey(edge: DirectedRailEdge): string {
	return `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
}

function mixedEquipmentState(document: RailDocument): PortEquipmentState {
	const runs = straightRuns(document).filter((run) => run.length >= 4);
	const [ohbRun, eqRun, stkRun] = runs;
	if (!ohbRun || !eqRun || !stkRun) {
		throw new Error("Long Bay fixture needs three straight rail runs.");
	}
	const ports: PortRecord[] = [
		port(1, 1, ohbRun[0] as RouteCell, "OHB", "LEFT", 700),
		port(2, 2, eqRun[0] as RouteCell, "EQ", "CENTER", 0),
		port(3, 2, eqRun[1] as RouteCell, "EQ", "CENTER", 0),
		...stkRun.slice(0, 4).map((route, index) => port(index + 4, 3, route, "STK", "CENTER", 0)),
	];
	const equipmentGroups: EquipmentGroupRecord[] = [
		{ id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
		{
			id: 2,
			kind: "EQ",
			pitchMillimeters: 1_000,
			recipe: "PHOTO",
			portIds: [2, 3],
		},
		{ id: 3, kind: "STK", template: "FOUR_PORT", portIds: [4, 5, 6, 7] },
	];
	return {
		nextPortId: 40,
		nextEquipmentGroupId: 20,
		ports,
		equipmentGroups,
	};
}

interface RouteCell {
	readonly x: number;
	readonly z: number;
	readonly from: Direction;
	readonly to: Direction;
}

function straightRuns(document: RailDocument): RouteCell[][] {
	const routes = new Map<string, RouteCell>();
	document.map.forEachRail((x, z, rail) => {
		if (
			rail.incoming === 0 ||
			rail.outgoing === 0 ||
			(rail.incoming & (rail.incoming - 1)) !== 0 ||
			(rail.outgoing & (rail.outgoing - 1)) !== 0 ||
			rail.outgoing !== oppositeDirection(rail.incoming as Direction)
		) {
			return;
		}
		const from = rail.incoming as Direction;
		const to = rail.outgoing as Direction;
		routes.set(`${x}:${z}:${from}:${to}`, { x, z, from, to });
	});
	const visited = new Set<string>();
	const runs: RouteCell[][] = [];
	for (const route of routes.values()) {
		const key = `${route.x}:${route.z}:${route.from}:${route.to}`;
		if (visited.has(key)) continue;
		const backward = moveRouteCell(route, oppositeDirection(route.to));
		if (routes.has(`${backward.x}:${backward.z}:${route.from}:${route.to}`)) {
			continue;
		}
		const run: RouteCell[] = [];
		let current: RouteCell | undefined = route;
		while (current) {
			const currentKey = `${current.x}:${current.z}:${current.from}:${current.to}`;
			if (visited.has(currentKey)) break;
			visited.add(currentKey);
			run.push(current);
			const next = moveRouteCell(current, current.to);
			current = routes.get(`${next.x}:${next.z}:${current.from}:${current.to}`);
		}
		runs.push(run);
	}
	return runs.sort((left, right) => right.length - left.length);
}

function moveRouteCell(
	cell: Pick<RouteCell, "x" | "z">,
	direction: Direction,
): { x: number; z: number } {
	if (direction === DIR_E) return { x: cell.x + 1, z: cell.z };
	if (direction === DIR_W) return { x: cell.x - 1, z: cell.z };
	return direction === DIR_N ? { x: cell.x, z: cell.z - 1 } : { x: cell.x, z: cell.z + 1 };
}

function port(
	id: number,
	equipmentGroupId: number,
	route: RouteCell,
	portType: "OHB" | "EQ" | "STK",
	side: "LEFT" | "CENTER",
	lateralOffsetMillimeters: number,
): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", ...route } satisfies CardinalPortRoute,
		stationMillimeters: 500,
		side,
		lateralOffsetMillimeters,
		direction: "WITH_TRAVEL",
		portType,
		barcode: `${portType}-${id}`,
	};
}

function recursivelyFrozen(value: unknown, seen = new Set<object>()): boolean {
	if (value === null || typeof value !== "object") return true;
	if (seen.has(value)) return true;
	seen.add(value);
	if (!Object.isFrozen(value)) return false;
	return Object.values(value).every((entry) => recursivelyFrozen(entry, seen));
}
