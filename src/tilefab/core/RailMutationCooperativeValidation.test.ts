import { describe, expect, it, vi } from "vitest";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import {
	planRailErase,
	planRailEraseSteps,
	type RailMapReader,
	type RailMutation,
	railMutationTopologyError,
	railMutationTopologyErrorSteps,
} from "./paint";
import { ALL_DIRECTIONS, DIR_E, DIR_N, DIR_S, DIR_W, oppositeDirection } from "./railShape";
import { cellKey, decodeRailCell, encodeRailCell, TileMap } from "./TileMap";
import {
	collectAffectedTurnoutFootprintSteps,
	collectAffectedTurnoutFootprints,
	collectTurnoutFootprints,
	type TurnoutFootprint,
	turnoutFootprintAt,
	validateTurnoutFootprints,
	validateTurnoutFootprintsSteps,
} from "./turnout";

describe("cooperative local rail preparation", () => {
	it("includes reciprocal neighbors in an interior erase and leaves the source untouched", () => {
		const map = straightMap(6);
		const generation = map.getMutationGeneration();
		const cells = [{ x: 2, y: 0 }];
		const plan = completeCooperativeSteps(planRailEraseSteps(map, cells));
		expect(plan).toEqual(planRailErase(map, cells));
		expect(plan).toMatchObject({ kind: "erase", baseRevision: 17, valid: true, cells });
		expect(plan.mutations).toEqual([
			{ x: 3, y: 0, before: 0x28, after: 0x20 },
			{ x: 1, y: 0, before: 0x28, after: 0x08 },
			{ x: 2, y: 0, before: 0x28, after: 0 },
		]);
		expect(map.getMutationGeneration()).toBe(generation);
		expect(map.getRevision()).toBe(17);
		expect(map.edgeCount).toBe(5);
		expect(map.getEncoded(2, 0)).toBe(0x28);
	});

	it("deduplicates overlapping erase cells and keeps the empty-plan diagnostic", () => {
		const map = straightMap(6);
		for (const cells of [
			[],
			[{ x: 100, y: 100 }],
			[
				{ x: 2, y: 0 },
				{ x: 3, y: 0 },
				{ x: 2, y: 0 },
			],
		]) {
			const plan = completeCooperativeSteps(planRailEraseSteps(map, cells));
			expect(plan).toEqual(planRailErase(map, cells));
			expect(new Set(plan.mutations.map(({ x, y }) => cellKey(x, y))).size).toBe(
				plan.mutations.length,
			);
			if (!plan.mutations.length)
				expect(plan).toMatchObject({ valid: false, reason: "철거할 레일이 없습니다" });
		}
	});

	it("retains classification before reciprocity before sidecar diagnostics", () => {
		const map = straightMap(6);
		const cases: { mutations: RailMutation[]; reason: string }[] = [
			{
				mutations: [{ x: 2, y: 0, before: 0x28, after: 0xff }],
				reason: "방향 토폴로지가 유효하지 않습니다",
			},
			{
				mutations: [{ x: 2, y: 0, before: 0x28, after: 0 }],
				reason: "연결이 이웃 셀과 일치하지 않습니다",
			},
			{
				mutations: [{ x: 2, y: 0, before: 0x28, after: 0x28 }],
				reason: "셀 before/after 값이 현재 맵과 일치하지 않습니다",
			},
		];
		for (const { mutations, reason } of cases) {
			const result = completeCooperativeSteps(railMutationTopologyErrorSteps(map, mutations));
			expect(result).toBe(railMutationTopologyError(map, mutations));
			expect(result).toContain(reason);
		}
	});

	it("checks candidate turnout leads even when the changed cell is two cells from its anchor", () => {
		const map = new TileMap();
		put(map, -2, 0, 0, DIR_E);
		put(map, -1, 0, DIR_W, DIR_E);
		put(map, 0, 0, DIR_W, DIR_E | DIR_S);
		put(map, 1, 0, DIR_W, DIR_E);
		put(map, 2, 0, DIR_W, 0);
		put(map, 0, 1, DIR_N, DIR_S);
		put(map, 0, 2, DIR_N, 0);
		const read = (x: number, y: number) => map.getRail(x, y);
		// The collector sees only the distance-two cell, without the erase's distance-one neighbor.
		expect(
			completeCooperativeSteps(collectAffectedTurnoutFootprintSteps(read, [{ x: 0, y: 2 }])).map(
				({ cell }) => cell,
			),
		).toEqual([{ x: 0, y: 0 }]);
		const plan = completeCooperativeSteps(planRailEraseSteps(map, [{ x: 0, y: 2 }]));
		expect(plan).toEqual(planRailErase(map, [{ x: 0, y: 2 }]));
		expect(plan.valid).toBe(false);
		expect(plan.reason).toContain("400 mm 대칭 리드");
		expect(plan.mutations).toContainEqual({ x: 0, y: 1, before: 0x41, after: 0x01 });
	});

	it("preserves canonical discovery and trim-before-overlap issue order", () => {
		const map = new TileMap();
		put(map, 0, 0, DIR_W, DIR_E | DIR_S);
		put(map, 0, 1, DIR_N | DIR_W, DIR_S);
		const changed = [
			{ x: 1, y: 1 },
			{ x: 0, y: 0 },
		];
		const read = (x: number, y: number) => map.getRail(x, y);
		const footprints = completeCooperativeSteps(
			collectAffectedTurnoutFootprintSteps(read, changed),
		);
		expect(footprints).toEqual(collectAffectedTurnoutFootprints(read, changed));
		expect(footprints.map(({ cell }) => cell)).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: 1 },
		]);
		const issues = completeCooperativeSteps(validateTurnoutFootprintsSteps(read, footprints));
		expect(issues).toEqual(validateTurnoutFootprints(read, footprints));
		expect(issues.map(({ code }) => code)).toEqual([
			"MISSING_STRAIGHT_LEAD",
			"MISSING_STRAIGHT_LEAD",
			"MISSING_STRAIGHT_LEAD",
			"MISSING_STRAIGHT_LEAD",
			"OVERLAPPING_FOOTPRINT",
		]);
	});

	it("preserves complete switch erase and exact overlap authority in every orientation and chirality", () => {
		for (const profileClass of ADVANCED_SWITCH_PROFILE_CLASSES)
			for (const forward of ALL_DIRECTIONS)
				for (const lateral of ALL_DIRECTIONS) {
					if (lateral === forward || lateral === oppositeDirection(forward)) continue;
					const record: AdvancedSwitchRecord = {
						id: 13,
						profileClass,
						origin: { x: -20, y: 30 },
						forward,
						lateral,
						movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
					};
					const geometry = deriveAdvancedSwitchGeometry(record);
					const hydrator = TileMap.createHydrator();
					for (const cell of geometry.cellStates)
						hydrator.addEncodedCell(cell.x, cell.y, cell.encoded);
					hydrator.addAdvancedSwitch(record);
					const map = hydrator.finish(17);
					const cells = [geometry.sharedTrunkSupport];
					const plan = completeCooperativeSteps(planRailEraseSteps(map, cells));
					expect(plan).toEqual(planRailErase(map, cells));
					expect(plan.valid, plan.reason).toBe(true);
					expect(plan.switchMutations).toEqual([{ id: record.id, before: record, after: null }]);
					const footprints = collectTurnoutFootprints(map);
					const read = (x: number, y: number) => map.getRail(x, y);
					expect(
						completeCooperativeSteps(validateTurnoutFootprintsSteps(read, footprints, [record])),
					).toEqual([]);
					expect(
						completeCooperativeSteps(validateTurnoutFootprintsSteps(read, footprints)),
					).toEqual([expect.objectContaining({ code: "OVERLAPPING_FOOTPRINT" })]);
				}
	});

	it("yields while sorting thousands of discovered turnouts and testing same-anchor switch candidates", () => {
		const count = 2_000;
		const read = (x: number, y: number) => ({
			incoming: x % 10 === 0 && y === 0 ? DIR_W : 0,
			outgoing: x % 10 === 0 && y === 0 ? DIR_E | DIR_S : 0,
		});
		const cells = Array.from({ length: count }, (_, index) => ({
			x: (count - index - 1) * 10,
			y: 0,
		}));
		let reads = 0,
			maxReads = 0,
			steps = 0,
			stepsAfterLastRead = 0;
		const iterator = collectAffectedTurnoutFootprintSteps((x, y) => {
			reads++;
			return read(x, y);
		}, cells);
		let footprints: TurnoutFootprint[] = [];
		const nativeSort = vi.spyOn(Array.prototype, "sort");
		let nativeRunSizes: number[] = [];
		try {
			for (;;) {
				reads = 0;
				const next = iterator.next();
				maxReads = Math.max(maxReads, reads);
				stepsAfterLastRead = reads > 0 ? 0 : stepsAfterLastRead + 1;
				steps++;
				if (next.done) {
					footprints = next.value;
					break;
				}
			}
		} finally {
			const contexts = nativeSort.mock.contexts.slice();
			nativeSort.mockRestore();
			nativeRunSizes = contexts.map((run) => {
				if (!Array.isArray(run)) throw new Error("Expected native array sort receiver.");
				return run.length;
			});
		}
		expect(maxReads).toBe(1);
		expect(steps).toBeGreaterThan(count * 25);
		// Materializing the result costs only count steps; these separately require sorting to yield.
		expect(stepsAfterLastRead).toBeGreaterThan(count * 2);
		expect(nativeRunSizes.length).toBeGreaterThan(0);
		expect(nativeRunSizes.every((size) => size <= 32)).toBe(true);
		expect(footprints).toHaveLength(count);
		expect(footprints[0]?.cell).toEqual({ x: 0, y: 0 });
		expect(footprints.at(-1)?.cell).toEqual({ x: (count - 1) * 10, y: 0 });
		const record: AdvancedSwitchRecord = {
			id: 1,
			profileClass: "B",
			origin: { x: 0, y: 0 },
			forward: DIR_E,
			lateral: DIR_S,
			movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
		};
		const geometry = deriveAdvancedSwitchGeometry(record);
		const encoded = new Map(
			geometry.cellStates.map((cell) => [cellKey(cell.x, cell.y), cell.encoded]),
		);
		const railRead = (x: number, y: number) => decodeRailCell(encoded.get(cellKey(x, y)) ?? 0);
		const pair = [geometry.mergeAnchor, geometry.branchAnchor].map((cell) => {
			const footprint = turnoutFootprintAt(cell, railRead(cell.x, cell.y));
			if (!footprint) throw new Error("Expected a switch turnout fixture.");
			return footprint;
		});
		const wrong: AdvancedSwitchRecord = { ...record, lateral: DIR_N };
		const candidates: AdvancedSwitchRecord[] = Array.from({ length: 2_000 }, (_, index) => ({
			...wrong,
			id: index + 2,
		}));
		candidates.push(record);
		const validation = validateTurnoutFootprintsSteps(railRead, pair, candidates);
		let checkpoints = 0;
		for (;;) {
			const next = validation.next();
			if (next.done) {
				expect(next.value).toEqual([]);
				break;
			}
			checkpoints++;
		}
		expect(checkpoints).toBeGreaterThan(candidates.length * 2);
	});

	it("prepares a real 100k-cell erase with bounded source reads per step and no source mutation", () => {
		const count = 100_000;
		const map = straightMap(count);
		const generation = map.getMutationGeneration();
		const cells = Array.from({ length: count }, (_, x) => ({ x, y: 0 }));
		const measured = instrument(map);
		const iterator = planRailEraseSteps(measured.reader, cells);
		let steps = 0,
			maximumReads = 0;
		for (;;) {
			measured.reset();
			const next = iterator.next();
			maximumReads = Math.max(maximumReads, measured.reads());
			steps++;
			if (!next.done) continue;
			expect(next.value).toMatchObject({ valid: true, baseRevision: 17, switchMutations: [] });
			expect(next.value.cells).toHaveLength(count);
			expect(next.value.mutations).toHaveLength(count);
			expect(next.value.mutations.every(({ after }) => after === 0)).toBe(true);
			break;
		}
		expect(maximumReads).toBeLessThanOrEqual(3);
		expect(steps).toBeGreaterThan(count * 30);
		expect(map.size).toBe(count);
		expect(map.edgeCount).toBe(count - 1);
		expect(map.getRevision()).toBe(17);
		expect(map.getMutationGeneration()).toBe(generation);
		expect(map.getEncoded(50_000, 0)).toBe(0x28);
	}, 60_000);

	it.each([
		["input collection", 128],
		["mutation assembly", 100_128],
		["candidate validation", 2_500_000],
	] as const)("lets the caller cancel during %s without issuing a plan or editing source", async (_phase, cancelAtOperations) => {
		const map = straightMap(100_000);
		const generation = map.getMutationGeneration();
		const task = createCooperativeTask(
			planRailEraseSteps(
				map,
				Array.from({ length: 100_000 }, (_, x) => ({ x, y: 0 })),
			),
		);
		const run = async () => {
			let operations = 0;
			while (!task.done) {
				operations += task.step(128);
				if (operations >= cancelAtOperations) throw new Error("caller cancelled");
				await Promise.resolve();
			}
			return task.finish();
		};
		await expect(run()).rejects.toThrow("caller cancelled");
		expect(task.done).toBe(false);
		expect(() => task.finish()).toThrow("not complete");
		expect(map.size).toBe(100_000);
		expect(map.edgeCount).toBe(99_999);
		expect(map.getRevision()).toBe(17);
		expect(map.getMutationGeneration()).toBe(generation);
	});
});

function straightMap(count: number): TileMap {
	const hydrator = TileMap.createHydrator();
	for (let x = 0; x < count; x++)
		hydrator.addEncodedCell(
			x,
			0,
			encodeRailCell({ incoming: x ? DIR_W : 0, outgoing: x < count - 1 ? DIR_E : 0 }),
		);
	return hydrator.finish(17);
}

function put(map: TileMap, x: number, y: number, incoming: number, outgoing: number): void {
	map.setEncoded(x, y, encodeRailCell({ incoming, outgoing }));
}

function instrument(map: TileMap) {
	let count = 0;
	const reader: RailMapReader = {
		edgeCount: map.edgeCount,
		getRevision: () => {
			count++;
			return map.getRevision();
		},
		getEncoded: (x, y) => {
			count++;
			return map.getEncoded(x, y);
		},
		getRail: (x, y) => {
			count++;
			return map.getRail(x, y);
		},
		hasRail: (x, y) => {
			count++;
			return map.hasRail(x, y);
		},
		getAdvancedSwitch: (id) => {
			count++;
			return map.getAdvancedSwitch(id);
		},
		getAdvancedSwitchOwningCell: (x, y) => {
			count++;
			return map.getAdvancedSwitchOwningCell(x, y);
		},
	};
	return {
		reader,
		reads: () => count,
		reset: () => {
			count = 0;
		},
	};
}
