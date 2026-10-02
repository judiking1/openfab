import { describe, expect, it } from "vitest";
import { planAdvancedSwitch } from "./AdvancedSwitchPlanner";
import { emptyPortEquipmentState } from "./EquipmentGroup";
import { planRailConstruction } from "./paint";
import { createRailAreaSelectionFromOwnerships } from "./RailAreaSelection";
import { RailDocument } from "./RailDocument";
import { buildRailModuleOwnershipIndex } from "./RailModuleOwnership";
import { DIR_E, DIR_W } from "./railShape";
import {
	copyStaticFabOrganizationState,
	emptyStaticFabOrganizationState,
	STATIC_FAB_ORGANIZATION_KINDS,
	type StaticFabOrganizationState,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	createStaticFabProcessLoopRailCandidatePreparation,
	type StaticFabProcessLoopRailCandidateSource,
	staticFabProcessLoopRailCandidateMatchesSource,
} from "./StaticFabProcessLoopRailCandidate";
import type { StaticFabSelection } from "./StaticFabSelection";
import { encodeRailCell, TileMap } from "./TileMap";

describe("StaticFabProcessLoopRailCandidate", () => {
	it("prepares immutable exact directed membership without mutating the source", () => {
		const source = lineSource();
		const revision = source.map.getRevision();
		const result = complete(source);
		expect(result.valid).toBe(true);
		if (!result.valid) throw new Error(result.error.code);
		expect(result.candidate.membership).toEqual({
			railEdges: [
				{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
				{ from: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
			],
			advancedSwitchIds: [],
			equipmentGroupIds: [],
		});
		expect(Object.isFrozen(result.candidate.membership.railEdges[0]?.from)).toBe(true);
		expect(Object.isFrozen(result.candidate.membership.railEdges)).toBe(true);
		expect(source.map.getRevision()).toBe(revision);
		expect(source.organizations.records).toHaveLength(0);
		expect(staticFabProcessLoopRailCandidateMatchesSource(result.candidate, source)).toBe(true);
		expect(
			staticFabProcessLoopRailCandidateMatchesSource(structuredClone(result.candidate), source),
		).toBe(false);
	});

	it("does not certify closure: an open rail is only a candidate", () => {
		const result = complete(lineSource());
		expect(result.valid).toBe(true);
		if (result.valid) expect(result.candidate).not.toHaveProperty("topologyValid");
	});

	it.each(STATIC_FAB_ORGANIZATION_KINDS)("rejects exact stored overlap with %s", (kind) => {
		const source = lineSource();
		const edges = source.selection.rail.ownerships[0]?.eraseEdges ?? [];
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind,
					name: "Existing owner",
					membership: { railEdges: edges, advancedSwitchIds: [], equipmentGroupIds: [] },
				},
			],
		});
		expect(complete({ ...source, organizations })).toMatchObject({
			valid: false,
			error: {
				code: "STORED_MEMBERSHIP_OVERLAP",
				organizationId: 1,
				organizationKind: kind,
				reference: { kind: "DIRECTED_EDGE" },
			},
		});
	});

	it("allows a map-valid neighboring owner sharing a boundary cell", () => {
		const source = lineSource(11);
		const first = source.ownership.modules[0],
			neighbor = source.ownership.modules[1];
		if (!first || !neighbor) throw new Error("missing genuine neighboring modules");
		const rail = createRailAreaSelectionFromOwnerships(source.ownership, [first]);
		const selection = Object.freeze({ ...source.selection, rail });
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA",
					name: "Neighbor owner",
					membership: {
						railEdges: neighbor.eraseEdges,
						advancedSwitchIds: [],
						equipmentGroupIds: [],
					},
				},
			],
		});
		expect(
			staticFabOrganizationStateError(source.map, emptyPortEquipmentState(), organizations),
		).toBeNull();
		expect(
			first.footprintCells.some((cell) =>
				neighbor.footprintCells.some((other) => cell.x === other.x && cell.y === other.y),
			),
		).toBe(true);
		expect(complete({ ...source, selection, organizations }).valid).toBe(true);
	});

	it("compares directed stored-reference keys without claiming layout validation", () => {
		const source = lineSource();
		// Opposite directions cannot coexist on the same physical rail in a valid source map.
		// This canonical-shape fixture isolates exact-key comparison, not map validation.
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA",
					name: "Reverse query only",
					membership: {
						railEdges: [{ from: { x: 1, y: 0 }, to: { x: 0, y: 0 } }],
						advancedSwitchIds: [],
						equipmentGroupIds: [],
					},
				},
			],
		});
		expect(
			staticFabOrganizationStateError(source.map, emptyPortEquipmentState(), organizations),
		).not.toBeNull();
		expect(complete({ ...source, organizations }).valid).toBe(true);
	});

	it("does not impose global cross-kind exclusivity on unrelated existing owners", () => {
		const source = lineSource(16);
		const first = source.ownership.modules[0],
			neighbor = source.ownership.modules[1];
		if (!first || !neighbor) throw new Error("missing genuine modules");
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 3,
			records: ["AREA", "BAY"].map((kind, index) => ({
				id: index + 1,
				kind: kind as "AREA" | "BAY",
				name: `Existing ${kind}`,
				membership: {
					railEdges: neighbor.eraseEdges,
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			})),
		});
		expect(
			staticFabOrganizationStateError(source.map, emptyPortEquipmentState(), organizations),
		).toBeNull();
		const rail = createRailAreaSelectionFromOwnerships(source.ownership, [first]);
		expect(
			complete({
				...source,
				organizations,
				selection: Object.freeze({ ...source.selection, rail }),
			}).valid,
		).toBe(true);
	});

	it("canonically orders genuine modules selected in reverse without adding other rails", () => {
		const source = lineSource(21);
		const modules = [source.ownership.modules[2], source.ownership.modules[0]];
		if (modules.some((module) => !module)) throw new Error("missing genuine modules");
		const selection = Object.freeze({
			...source.selection,
			rail: Object.freeze({
				...source.selection.rail,
				ownerships: Object.freeze(modules as NonNullable<(typeof modules)[number]>[]),
			}),
		});
		const result = complete({ ...source, selection });
		if (!result.valid) throw new Error(result.error.code);
		expect(result.candidate.moduleKeys).toEqual(modules.map((module) => module?.key).sort());
		expect(result.candidate.membership.railEdges).toHaveLength(10);
		expect(result.candidate.membership.railEdges.map((edge) => edge.from.x)).toEqual([
			0, 1, 2, 3, 4, 10, 11, 12, 13, 14,
		]);
	});

	it("preserves exact advanced-switch identity and rejects switch-only stored overlap", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
		expect(plan.valid, plan.reason).toBe(true);
		expect(document.commit(plan)).toBe(true);
		if (!plan.switchRecord) throw new Error("missing switch record");
		const ownership = buildRailModuleOwnershipIndex(document.map);
		const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
		const source = Object.freeze({
			map: document.map,
			ownership,
			organizations: emptyStaticFabOrganizationState(),
			patchSequence: document.getPatchSequence(),
			selection: Object.freeze({
				baseRevision: document.map.getRevision(),
				basePatchSequence: document.getPatchSequence(),
				rail,
				equipmentGroups: Object.freeze([]),
			}),
		});
		const result = complete(source);
		if (!result.valid) throw new Error(result.error.code);
		expect(result.candidate.membership.advancedSwitchIds).toEqual([plan.switchRecord.id]);
		for (const kind of STATIC_FAB_ORGANIZATION_KINDS) {
			const organizations = copyStaticFabOrganizationState({
				nextOrganizationId: 2,
				records: [
					{
						id: 1,
						kind,
						name: "Switch reference owner",
						membership: {
							railEdges: [],
							advancedSwitchIds: [plan.switchRecord.id],
							equipmentGroupIds: [],
						},
					},
				],
			});
			expect(complete({ ...source, organizations })).toMatchObject({
				valid: false,
				error: {
					code: "STORED_MEMBERSHIP_OVERLAP",
					organizationKind: kind,
					reference: { kind: "ADVANCED_SWITCH", id: plan.switchRecord.id },
				},
			});
		}
	});

	it("projects four selected switch joins while preserving serializable module membership", () => {
		const source = switchSource();
		const result = complete(source);
		if (!result.valid) throw new Error(result.error.code);
		const footprintEdges = source.ownership.modules.flatMap((module) => module.eraseEdges);
		expect(result.candidate.membership.railEdges).toHaveLength(footprintEdges.length);
		expect(result.candidate.topologyMembership.railEdges).toHaveLength(source.map.edgeCount);
		expect(result.candidate.topologyMembership.railEdges.length - footprintEdges.length).toBe(4);
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AISLE",
					declaredSemanticRole: "PROCESS_LOOP",
					name: "Explicit draft",
					membership: result.candidate.membership,
				},
			],
		});
		expect(
			staticFabOrganizationStateError(source.map, emptyPortEquipmentState(), organizations),
		).toBeNull();
		const switchModule = source.ownership.find("SW-1");
		if (!switchModule) throw new Error("missing switch module");
		for (const ownerships of [
			[switchModule],
			source.ownership.modules.filter((module) => module !== switchModule),
		]) {
			const rail = createRailAreaSelectionFromOwnerships(source.ownership, ownerships);
			const partial = complete({
				...source,
				selection: Object.freeze({ ...source.selection, rail }),
			});
			if (!partial.valid) throw new Error(partial.error.code);
			expect(partial.candidate.membership.railEdges).toHaveLength(
				ownerships.reduce((count, module) => count + module.eraseEdges.length, 0),
			);
			expect(partial.candidate.topologyMembership.railEdges).toEqual(
				partial.candidate.membership.railEdges,
			);
		}
	});

	it("checks stored ownership of switch joins even though erase footprints omit them", () => {
		const source = switchSource();
		const join = { from: { x: -1, y: 0 }, to: { x: 0, y: 0 } };
		expect(source.ownership.modules.flatMap((module) => module.eraseEdges)).not.toContainEqual(
			join,
		);
		const organizations = copyStaticFabOrganizationState({
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "AREA",
					name: "Join owner",
					membership: {
						railEdges: [join],
						advancedSwitchIds: [],
						equipmentGroupIds: [],
					},
				},
			],
		});
		// A bare join is not a serializable whole-module organization membership. This canonical
		// shape fixture tests exact overlap refusal; it does not establish valid source activation.
		expect(
			staticFabOrganizationStateError(source.map, emptyPortEquipmentState(), organizations),
		).not.toBeNull();
		expect(complete({ ...source, organizations })).toMatchObject({
			valid: false,
			error: {
				code: "STORED_MEMBERSHIP_OVERLAP",
				organizationId: 1,
				reference: { kind: "DIRECTED_EDGE", edge: join },
			},
		});
	});

	it("rejects empty and equipment-bearing selections before preparing rail references", () => {
		const source = lineSource();
		const emptyRail = Object.freeze({ ...source.selection.rail, ownerships: Object.freeze([]) });
		expect(
			complete({ ...source, selection: Object.freeze({ ...source.selection, rail: emptyRail }) }),
		).toMatchObject({ valid: false, error: { code: "EMPTY_SELECTION" } });
		const equipment = Object.freeze({
			group: { id: 7, kind: "OHB" as const, template: "SINGLE" as const, portIds: [] },
			ports: [],
		});
		expect(
			complete({
				...source,
				selection: Object.freeze({
					...source.selection,
					equipmentGroups: Object.freeze([equipment]),
				}),
			}),
		).toMatchObject({ valid: false, error: { code: "EQUIPMENT_SELECTED", count: 1 } });
	});

	it("rejects copied or duplicated module references", () => {
		const source = lineSource();
		const module = source.selection.rail.ownerships[0];
		if (!module) throw new Error("missing module");
		for (const ownerships of [
			[Object.freeze({ ...module, eraseEdges: module.eraseEdges.slice(0, 1) })],
			[module, module],
		]) {
			const selection = Object.freeze({
				...source.selection,
				rail: Object.freeze({ ...source.selection.rail, ownerships: Object.freeze(ownerships) }),
			});
			expect(complete({ ...source, selection })).toMatchObject({
				valid: false,
				error: { code: "INVALID_MODULE" },
			});
		}
	});

	it("rejects revision/sequence mismatches and a foreign same-revision ownership index", () => {
		const source = lineSource();
		for (const selection of [
			Object.freeze({ ...source.selection, baseRevision: source.selection.baseRevision + 1 }),
			Object.freeze({ ...source.selection, basePatchSequence: source.patchSequence + 1 }),
			Object.freeze({
				...source.selection,
				rail: Object.freeze({
					...source.selection.rail,
					revision: source.selection.rail.revision + 1,
				}),
			}),
		])
			expect(complete({ ...source, selection })).toMatchObject({
				valid: false,
				error: { code: "STALE_SOURCE" },
			});
		const foreign = lineSource();
		expect(complete({ ...source, ownership: foreign.ownership })).toMatchObject({
			valid: false,
			error: { code: "STALE_SOURCE" },
		});
	});

	it("revokes retained candidates on cancellation and caller generation loss", () => {
		const source = lineSource();
		let current = true;
		const task = createStaticFabProcessLoopRailCandidatePreparation(source, () => current);
		while (!task.done) task.step(8);
		const result = task.finish();
		if (!result.valid) throw new Error(result.error.code);
		current = false;
		expect(staticFabProcessLoopRailCandidateMatchesSource(result.candidate, source)).toBe(false);
		expect(task.finish()).toMatchObject({ valid: false, error: { code: "STALE_SOURCE" } });
		const cancel = createStaticFabProcessLoopRailCandidatePreparation(source, () => true);
		while (!cancel.done) cancel.step(8);
		const previous = cancel.finish();
		if (!previous.valid) throw new Error(previous.error.code);
		cancel.cancel();
		expect(staticFabProcessLoopRailCandidateMatchesSource(previous.candidate, source)).toBe(false);
		expect(cancel.finish()).toMatchObject({ valid: false, error: { code: "CANCELLED" } });
	});

	it.each([
		"done",
		"finish",
		"step",
	] as const)("latches stale preparation when first observed through %s", (observe) => {
		const source = lineSource(21);
		let current = true;
		const task = createStaticFabProcessLoopRailCandidatePreparation(source, () => current);
		task.step(1);
		current = false;
		if (observe === "done") expect(task.done).toBe(true);
		else if (observe === "finish")
			expect(task.finish()).toMatchObject({ valid: false, error: { code: "STALE_SOURCE" } });
		else expect(task.step(1)).toBe(0);
		current = true;
		expect(task.done).toBe(true);
		expect(task.step(128)).toBe(0);
		expect(task.finish()).toMatchObject({ valid: false, error: { code: "STALE_SOURCE" } });
	});

	it("rejects a port-only sequence change even when map and organizations remain identical", () => {
		const source = lineSource();
		let liveSequence = source.patchSequence;
		const task = createStaticFabProcessLoopRailCandidatePreparation(
			source,
			() => liveSequence === source.patchSequence,
		);
		while (!task.done) task.step(8);
		const result = task.finish();
		if (!result.valid) throw new Error(result.error.code);
		liveSequence++;
		expect(staticFabProcessLoopRailCandidateMatchesSource(result.candidate, source)).toBe(false);
		liveSequence--;
		expect(staticFabProcessLoopRailCandidateMatchesSource(result.candidate, source)).toBe(false);
	});

	it("rejects an in-place source mutation after work begins", () => {
		const source = lineSource();
		const task = createStaticFabProcessLoopRailCandidatePreparation(source, () => true);
		task.step(1);
		source.map.setEncoded(10, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		expect(task.step(8)).toBe(0);
		expect(task.finish()).toMatchObject({ valid: false, error: { code: "STALE_SOURCE" } });
	});

	it("schedules a genuine 100k-cell candidate and discards partial work on cancellation", () => {
		const source = lineSource(100_000);
		const cancel = createStaticFabProcessLoopRailCandidatePreparation(source, () => true);
		cancel.step(16);
		cancel.cancel();
		expect(cancel.finish()).toMatchObject({ valid: false, error: { code: "CANCELLED" } });
		const task = createStaticFabProcessLoopRailCandidatePreparation(source, () => true);
		let slices = 0;
		while (!task.done) {
			expect(task.step(128)).toBeLessThanOrEqual(128);
			slices++;
		}
		const result = task.finish();
		if (!result.valid) throw new Error(result.error.code);
		expect(source.map.size).toBe(100_000);
		expect(result.candidate.membership.railEdges).toHaveLength(99_999);
		expect(slices).toBeGreaterThan(1000);
	}, 30_000);
});

function switchSource(): StaticFabProcessLoopRailCandidateSource {
	const document = new RailDocument();
	const input = planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 });
	expect(document.commit(input), input.reason).toBe(true);
	const switchPlan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "C");
	expect(document.commit(switchPlan), switchPlan.reason).toBe(true);
	for (const [from, to] of [
		[
			{ x: 6, y: 0 },
			{ x: 10, y: 0 },
		],
		[
			{ x: 4, y: 3 },
			{ x: 4, y: 7 },
		],
		[
			{ x: 2, y: 7 },
			{ x: 2, y: 3 },
		],
	] as const) {
		const plan = planRailConstruction(document.map, from, to);
		expect(document.commit(plan), plan.reason).toBe(true);
	}
	const ownership = buildRailModuleOwnershipIndex(document.map);
	const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
	return Object.freeze({
		map: document.map,
		ownership,
		organizations: document.organizations,
		patchSequence: document.getPatchSequence(),
		selection: Object.freeze({
			baseRevision: document.map.getRevision(),
			basePatchSequence: document.getPatchSequence(),
			rail,
			equipmentGroups: Object.freeze([]),
		}),
	});
}

function lineSource(
	length = 3,
	organizations: StaticFabOrganizationState = emptyStaticFabOrganizationState(),
): StaticFabProcessLoopRailCandidateSource {
	const map = new TileMap();
	for (let x = 0; x < length; x++)
		map.setEncoded(
			x,
			0,
			encodeRailCell({ incoming: x === 0 ? 0 : DIR_W, outgoing: x === length - 1 ? 0 : DIR_E }),
		);
	const ownership = buildRailModuleOwnershipIndex(map);
	const rail = createRailAreaSelectionFromOwnerships(ownership, ownership.modules);
	const selection: StaticFabSelection = Object.freeze({
		baseRevision: map.getRevision(),
		basePatchSequence: 4,
		rail,
		equipmentGroups: Object.freeze([]),
	});
	return Object.freeze({ map, ownership, organizations, patchSequence: 4, selection });
}

function complete(source: StaticFabProcessLoopRailCandidateSource) {
	const task = createStaticFabProcessLoopRailCandidatePreparation(source, () => true);
	while (!task.done) task.step(16);
	return task.finish();
}
