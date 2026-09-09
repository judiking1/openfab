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
	]) {
		map.addEncodedCell(x, y, 0x82);
	}
	const existing = record(10, 256);
	for (const cell of deriveAdvancedSwitchGeometry(existing).cellStates) {
		map.addEncodedCell(cell.x, cell.y, cell.encoded);
	}
	map.addAdvancedSwitch(existing);
	return map.finish(170, 40);
}
function record(id: number, x: number): AdvancedSwitchRecord {
	return { id, profileClass: "B", origin: { x, y: 0 }, forward: 2, lateral: 4, movementMask: 15 };
}
function packet() {
	const records = [record(42, 512), record(40, 544), record(41, 576)];
	return {
		cells: [
			{ x: -64, y: -33, before: 0, after: 0x82 },
			...records.flatMap((entry) =>
				deriveAdvancedSwitchGeometry(entry).cellStates.map((cell) => ({
					x: cell.x,
					y: cell.y,
					before: 0,
					after: cell.encoded,
				})),
			),
		],
		switches: records.map((entry) => ({ id: entry.id, before: null, after: entry })),
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

describe("unpublished additive TileMap preparation", () => {
	it("matches one synchronous batch including all claims, out-of-order switch IDs and cursor generation", () => {
		const source = fixture();
		const before = snapshot(source);
		const additions = packet();
		const ordinary = source.clone();
		ordinary.applyAtomicMutations(additions.cells, additions.switches);
		const steps = source.createAdditionCandidateSteps(additions.cells, additions.switches);
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
		expect(checkpoints).toBeGreaterThan(additions.cells.length + additions.switches.length);
		expect(snapshot(candidate)).toEqual(snapshot(ordinary));
		for (const { after } of additions.switches) {
			for (const cell of deriveAdvancedSwitchGeometry(after).claimedCells) {
				expect(candidate.getAdvancedSwitchOwningCell(cell.x, cell.y)?.id).toBe(after.id);
			}
		}
		candidate.setEncoded(-64, -33, 0);
		expect(source.getEncoded(-64, -33)).toBe(0);
		source.setEncoded(-65, -33, 0x24);
		expect(candidate.getEncoded(-65, -33)).toBe(0x82);
		expect(ordinary.getEncoded(-65, -33)).toBe(0x82);
	});

	it("abandons preparation at every checkpoint without changing live source or its later clone", () => {
		const additions = packet();
		let count = 0;
		const completed = fixture().createAdditionCandidateSteps(additions.cells, additions.switches);
		while (!completed.next().done) count++;
		for (let stop = 0; stop <= count; stop++) {
			const source = fixture();
			const before = snapshot(source);
			const steps = source.createAdditionCandidateSteps(additions.cells, additions.switches);
			for (let index = 0; index < stop; index++) expect(steps.next().done).toBe(false);
			steps.return(undefined as never);
			expect(snapshot(source)).toEqual(before);
			const copy = source.clone();
			source.setEncoded(-65, -33, 0);
			expect(copy.getEncoded(-65, -33)).toBe(0x82);
		}
	});

	it("rejects a source change even before first resume and rejects mutation/rollback ABA", () => {
		for (const advanceFirst of [false, true]) {
			const source = fixture();
			const additions = packet();
			const steps = source.createAdditionCandidateSteps(additions.cells, additions.switches);
			if (advanceFirst) expect(steps.next().done).toBe(false);
			const revision = source.getRevision();
			const checkpoint = source.createMutationCheckpoint();
			const mutation = { x: -99, y: -99, before: 0, after: 0x82 };
			source.applyAtomicMutations([mutation], []);
			source.rollbackAtomicMutations([mutation], [], checkpoint);
			expect(source.getRevision()).toBe(revision);
			const afterRollback = snapshot(source);
			expect(() => steps.next()).toThrow(/changed during cooperative/);
			expect(snapshot(source)).toEqual(afterRollback);
		}
	});

	it.each([
		{ x: 1000, y: 1000, before: 1, after: 0x82 },
		{ x: 1000, y: 1000, before: 0, after: 0 },
		{ x: 1000, y: 1000, before: 0, after: 256 },
		{ x: 1000.5, y: 1000, before: 0, after: 0x82 },
		{ x: -65, y: -33, before: 0, after: 0x82 },
	])("rejects a late invalid/occupied cell without returning a partial candidate: %j", (invalid) => {
		const source = fixture();
		const before = snapshot(source);
		const additions = packet();
		expect(() =>
			drain(source.createAdditionCandidateSteps([...additions.cells, invalid], additions.switches)),
		).toThrow();
		expect(snapshot(source)).toEqual(before);
	});

	it("rejects duplicate new cells and late conflicting switch footprints", () => {
		const source = fixture();
		const before = snapshot(source);
		const additions = packet();
		expect(() =>
			drain(
				source.createAdditionCandidateSteps(
					[...additions.cells, additions.cells[0] as TileMapCellMutation],
					additions.switches,
				),
			),
		).toThrow();
		expect(() =>
			drain(
				source.createAdditionCandidateSteps(additions.cells, [
					...additions.switches,
					{ id: 43, before: null, after: record(43, 513) },
				]),
			),
		).toThrow();
		expect(snapshot(source)).toEqual(before);
	});

	it("rejects generation overflow on the private candidate without exhausting the source", () => {
		const source = fixture();
		(source as unknown as { mutationGeneration: number }).mutationGeneration =
			Number.MAX_SAFE_INTEGER - 1;
		const before = snapshot(source);
		const additions = packet();
		expect(() =>
			drain(source.createAdditionCandidateSteps(additions.cells, additions.switches)),
		).toThrow(/generation is exhausted/);
		expect(snapshot(source)).toEqual(before);
	});
});
