import { describe, expect, it } from "vitest";
import { type AdvancedSwitchRecord, deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import { TileMap, type TileMapCellMutation } from "./TileMap";

function fixture(): TileMap {
	const map = TileMap.createHydrator();
	for (const [x, y] of [
		[-65, -33],
		[-1, 0],
		[32, 64],
		[96, 96],
	])
		map.addEncodedCell(x, y, 0x82);
	for (const entry of [record(10, 256), record(11, 320), record(12, 384)]) {
		for (const cell of deriveAdvancedSwitchGeometry(entry).cellStates)
			map.addEncodedCell(cell.x, cell.y, cell.encoded);
		map.addAdvancedSwitch(entry);
	}
	return map.finish(170, 40);
}
function record(id: number, x: number): AdvancedSwitchRecord {
	return { id, profileClass: "B", origin: { x, y: 0 }, forward: 2, lateral: 4, movementMask: 15 };
}
function requiredSwitch(source: TileMap, id: number): AdvancedSwitchRecord {
	const entry = source.getAdvancedSwitch(id);
	if (!entry) throw new Error(`Missing fixture switch ${id}`);
	return entry;
}
function packet(source: TileMap) {
	const additions = [record(42, 512), record(40, 576)];
	const removed = requiredSwitch(source, 12);
	return {
		cells: [
			{ x: -65, y: -33, before: 0x82, after: 0 },
			{ x: -1, y: 0, before: 0x82, after: 0x24 },
			{ x: 100, y: 100, before: 0, after: 0x82 },
			...deriveAdvancedSwitchGeometry(removed).cellStates.map((cell) => ({
				x: cell.x,
				y: cell.y,
				before: cell.encoded,
				after: 0,
			})),
			...additions.flatMap((entry) =>
				deriveAdvancedSwitchGeometry(entry).cellStates.map((cell) => ({
					x: cell.x,
					y: cell.y,
					before: 0,
					after: cell.encoded,
				})),
			),
		],
		switches: [
			{ id: 10, before: requiredSwitch(source, 10), after: record(10, 320) },
			{ id: 11, before: requiredSwitch(source, 11), after: record(11, 256) },
			{ id: 12, before: removed, after: null },
			...additions.map((after) => ({ id: after.id, before: null, after })),
		],
	};
}
function snapshot(map: TileMap) {
	const cells: number[][] = [];
	const switches: AdvancedSwitchRecord[] = [];
	map.forEachRail((x, y, _rail, value) => cells.push([x, y, value]));
	map.forEachAdvancedSwitch((entry) => switches.push(entry));
	cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	return {
		cells,
		switches,
		revision: map.getRevision(),
		generation: map.getMutationGeneration(),
		size: map.size,
		edges: map.edgeCount,
		cursor: map.getAdvancedSwitchIdCursor(),
	};
}
function drain(steps: Generator<void, TileMap>): TileMap {
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
	}
}

describe("unpublished general TileMap mutation preparation", () => {
	it("matches one atomic batch for removals, edits, additions and simultaneous existing-ID switch swaps", () => {
		const source = fixture();
		const before = snapshot(source);
		const changes = packet(source);
		const ordinary = source.clone();
		ordinary.applyAtomicMutations(changes.cells, changes.switches);
		const steps = source.createMutationCandidateSteps(changes.cells, changes.switches);
		let candidate: TileMap;
		let checkpoints = 0;
		for (;;) {
			const step = steps.next();
			expect(snapshot(source)).toEqual(before);
			if (step.done) {
				candidate = step.value;
				break;
			}
			checkpoints++;
		}
		expect(checkpoints).toBeGreaterThan(changes.cells.length + changes.switches.length);
		expect(snapshot(candidate)).toEqual(snapshot(ordinary));
		expect(candidate.getAdvancedSwitchIdCursor()).toBe(43);
		expect(candidate.getAdvancedSwitch(12)).toBeUndefined();
		for (const entry of [record(10, 320), record(11, 256), record(42, 512), record(40, 576)]) {
			for (const cell of deriveAdvancedSwitchGeometry(entry).claimedCells)
				expect(candidate.getAdvancedSwitchOwningCell(cell.x, cell.y)?.id).toBe(entry.id);
		}
		for (const cell of deriveAdvancedSwitchGeometry(record(12, 384)).claimedCells)
			expect(candidate.getAdvancedSwitchOwningCell(cell.x, cell.y)).toBeUndefined();
		candidate.setEncoded(32, 64, 0);
		expect(source.getEncoded(32, 64)).toBe(0x82);
		source.setEncoded(96, 96, 0x24);
		expect(candidate.getEncoded(96, 96)).toBe(0x82);
	});
	it("abandons every preparation checkpoint without changing the source", () => {
		const original = fixture();
		const changes = packet(original);
		let count = 0;
		const complete = original.createMutationCandidateSteps(changes.cells, changes.switches);
		while (!complete.next().done) count++;
		for (let stop = 0; stop <= count; stop++) {
			const source = fixture();
			const before = snapshot(source);
			const steps = source.createMutationCandidateSteps(changes.cells, changes.switches);
			for (let i = 0; i < stop; i++) expect(steps.next().done).toBe(false);
			steps.return(undefined as never);
			expect(snapshot(source)).toEqual(before);
		}
	});
	it("rejects source change and same-revision mutation/rollback ABA before or during preparation", () => {
		for (const advance of [false, true])
			for (const rollback of [false, true]) {
				const source = fixture();
				const changes = packet(source);
				const steps = source.createMutationCandidateSteps(changes.cells, changes.switches);
				if (advance) expect(steps.next().done).toBe(false);
				const checkpoint = source.createMutationCheckpoint();
				const change = { x: 5000, y: 5000, before: 0, after: 0x82 };
				source.applyAtomicMutations([change], []);
				if (rollback) source.rollbackAtomicMutations([change], [], checkpoint);
				const before = snapshot(source);
				expect(() => steps.next()).toThrow(/changed during cooperative/);
				expect(snapshot(source)).toEqual(before);
			}
	});
	it.each([
		{ x: 1000, y: 1000, before: 1, after: 0x82 },
		{ x: 1000, y: 1000, before: 0, after: 0 },
		{ x: 1000, y: 1000, before: 0, after: 256 },
		{ x: 1000.5, y: 1000, before: 0, after: 0x82 },
		{ x: 1000, y: Number.NaN, before: 0, after: 0x82 },
	])("rejects late invalid cells without publishing a partial candidate: %j", (invalid) => {
		const source = fixture();
		const before = snapshot(source);
		const changes = packet(source);
		expect(() =>
			drain(source.createMutationCandidateSteps([...changes.cells, invalid], changes.switches)),
		).toThrow();
		expect(snapshot(source)).toEqual(before);
	});
	it("rejects duplicate cell mutations including a plausible chained before value", () => {
		const source = fixture();
		const before = snapshot(source);
		const changes = packet(source);
		expect(() =>
			drain(
				source.createMutationCandidateSteps(
					[...changes.cells, { x: -1, y: 0, before: 0x24, after: 0x82 }],
					changes.switches,
				),
			),
		).toThrow(/Duplicate rail/);
		expect(snapshot(source)).toEqual(before);
	});
	it("rejects stale, empty, duplicate, ID-mismatched and overlapping switches", () => {
		for (const invalid of [
			{ id: 99, before: record(99, 1024), after: null },
			{ id: 99, before: null, after: null },
			{ id: 10, before: record(10, 256), after: record(10, 640) },
			{ id: 99, before: null, after: record(100, 1024) },
			{ id: 99, before: null, after: record(99, 512) },
		]) {
			const source = fixture();
			const before = snapshot(source);
			const changes = packet(source);
			expect(() =>
				drain(source.createMutationCandidateSteps(changes.cells, [...changes.switches, invalid])),
			).toThrow();
			expect(snapshot(source)).toEqual(before);
		}
	});
	it("keeps an empty batch at the same identity counters without modifying the source", () => {
		const source = fixture();
		const before = snapshot(source);
		const copy = drain(source.createMutationCandidateSteps([], []));
		expect(copy).not.toBe(source);
		expect(snapshot(copy)).toEqual(before);
		expect(snapshot(source)).toEqual(before);
	});
	it("rejects candidate generation exhaustion without exhausting the live source", () => {
		const source = fixture();
		(source as unknown as { mutationGeneration: number }).mutationGeneration =
			Number.MAX_SAFE_INTEGER - 1;
		const before = snapshot(source);
		const changes = packet(source);
		expect(() =>
			drain(source.createMutationCandidateSteps(changes.cells, changes.switches)),
		).toThrow(/generation is exhausted/);
		expect(snapshot(source)).toEqual(before);
	});
	it("yields while relocating 100k storage cells and preserves the original map", () => {
		const source = new TileMap();
		const changes: TileMapCellMutation[] = [];
		for (let x = 0; x < 100000; x++) {
			source.setEncoded(x, 0, 0x82);
			changes.push(
				{ x, y: 0, before: 0x82, after: 0 },
				{ x: x + 200000, y: 0, before: 0, after: 0x82 },
			);
		}
		const revision = source.getRevision();
		const steps = source.createMutationCandidateSteps(changes, []);
		let slices = 0;
		let maximumSlice = 0;
		let candidate: TileMap | undefined;
		for (;;) {
			const start = performance.now();
			let done = false;
			for (let i = 0; i < 128; i++) {
				const step = steps.next();
				if (step.done) {
					candidate = step.value;
					done = true;
					break;
				}
			}
			maximumSlice = Math.max(maximumSlice, performance.now() - start);
			slices++;
			if (done) break;
		}
		expect(slices).toBeGreaterThan(1000);
		expect(maximumSlice).toBeLessThan(50);
		expect(source.size).toBe(100000);
		expect(source.getRevision()).toBe(revision);
		expect(source.getEncoded(0, 0)).toBe(0x82);
		expect(source.getEncoded(200000, 0)).toBe(0);
		expect(candidate?.size).toBe(100000);
		expect(candidate?.getEncoded(0, 0)).toBe(0);
		expect(candidate?.getEncoded(299999, 0)).toBe(0x82);
		expect(candidate?.getRevision()).toBe(revision + 200000);
	});
});
