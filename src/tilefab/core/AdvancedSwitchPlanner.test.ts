import { describe, expect, it } from "vitest";
import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "./AdvancedSwitch";
import { planAdvancedSwitch, planAdvancedSwitchReshape } from "./AdvancedSwitchPlanner";
import { planRailErase, planRailPath } from "./paint";
import { RailDocument, type RailPatchEvent } from "./RailDocument";
import {
	ALL_DIRECTIONS,
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "./railShape";
import { type Cell, cellKey, encodeRailCell, TileMap } from "./TileMap";

describe("advanced switch planning", () => {
	it("uses copied chirality for neutral intent and lets explicit pointer intent override it", () => {
		const document = documentWithTerminal(DIR_E);
		const copied = planAdvancedSwitch(document.map, ORIGIN, ORIGIN, "A", "left");
		const overridden = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: 3 }, "A", "left");

		expect(copied.valid, copied.reason).toBe(true);
		expect(copied.side).toBe("left");
		expect(overridden.valid, overridden.reason).toBe(true);
		expect(overridden.side).toBe("right");
	});

	it("plans A-D in every rotation and chirality as one atomic command", () => {
		for (const profileClass of ADVANCED_SWITCH_PROFILE_CLASSES) {
			for (const forward of ALL_DIRECTIONS) {
				for (const lateral of [leftOf(forward), oppositeDirection(leftOf(forward))]) {
					const document = documentWithTerminal(forward);
					const plan = planAdvancedSwitch(
						document.map,
						ORIGIN,
						moveCell(ORIGIN, lateral),
						profileClass,
					);
					expect(plan.valid, plan.reason).toBe(true);
					expect(plan.switchMutations).toHaveLength(1);
					expect(plan.switchRecord?.forward).toBe(forward);
					expect(plan.switchRecord?.lateral).toBe(lateral);
					expect(document.commit(plan)).toBe(true);
					expect(document.map.advancedSwitchCount).toBe(1);
				}
			}
		}
	});

	it("keeps build, erase, undo, redo, and clear atomic with one stable switch id", () => {
		const document = documentWithTerminal(DIR_E);
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));
		const plan = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: 3 }, "A");
		expect(plan.valid, plan.reason).toBe(true);
		const baseRevision = document.map.getRevision();
		expect(document.commit(plan)).toBe(true);
		const switchRecord = plan.switchRecord;
		expect(switchRecord).not.toBeNull();
		if (!switchRecord) throw new Error("expected a planned switch");
		expect(document.map.getRevision()).toBe(
			baseRevision + plan.mutations.length + plan.switchMutations.length,
		);
		expect(events.at(-1)?.switchChanges[0]?.after?.id).toBe(switchRecord.id);

		expect(document.undo()).toBe(true);
		expect(document.map.getAdvancedSwitch(switchRecord.id)).toBeUndefined();
		expect(document.redo()).toBe(true);
		expect(document.map.getAdvancedSwitch(switchRecord.id)).toEqual(switchRecord);

		const geometry = deriveAdvancedSwitchGeometry(switchRecord);
		const erase = planRailErase(document.map, [geometry.sharedTrunkSupport]);
		expect(erase.valid, erase.reason).toBe(true);
		expect(erase.switchMutations).toEqual([
			{ id: switchRecord.id, before: switchRecord, after: null },
		]);
		expect(new Set(erase.cells.map((cell) => cellKey(cell.x, cell.y)))).toEqual(
			new Set(geometry.occupiedCells.map((cell) => cellKey(cell.x, cell.y))),
		);
		expect(document.commit(erase)).toBe(true);
		expect(document.map.getAdvancedSwitch(switchRecord.id)).toBeUndefined();
		expect(document.undo()).toBe(true);
		expect(document.map.getAdvancedSwitch(switchRecord.id)).toEqual(switchRecord);

		expect(document.clear()).toBe(true);
		expect(document.map.size).toBe(0);
		expect(document.map.advancedSwitchCount).toBe(0);
		expect(document.undo()).toBe(true);
		expect(document.map.getAdvancedSwitch(switchRecord.id)).toEqual(switchRecord);
	});

	it("allows continuation at a declared output but rejects edits through owned interior cells", () => {
		const document = documentWithTerminal(DIR_E);
		const switchPlan = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: -2 }, "D");
		expect(document.commit(switchPlan)).toBe(true);
		const switchRecord = switchPlan.switchRecord;
		if (!switchRecord) throw new Error("expected a planned switch");
		const geometry = deriveAdvancedSwitchGeometry(switchRecord);

		const output = geometry.outputs[0];
		const continuation = planRailPath(document.map, [
			output.cell,
			moveCell(output.cell, output.direction),
			moveCell(moveCell(output.cell, output.direction), output.direction),
		]);
		expect(continuation.valid, continuation.reason).toBe(true);
		expect(document.commit(continuation)).toBe(true);

		const corruptingRoute = planRailPath(document.map, [
			geometry.sharedTrunkSupport,
			moveCell(geometry.sharedTrunkSupport, switchRecord.lateral),
		]);
		expect(corruptingRoute.valid).toBe(false);
		expect(corruptingRoute.reason).toContain("boundary port");

		const firstExternal = moveCell(output.cell, output.direction);
		const secondExternal = moveCell(firstExternal, output.direction);
		const eraseExtension = planRailErase(document.map, [firstExternal, secondExternal]);
		expect(eraseExtension.valid, eraseExtension.reason).toBe(true);
		expect(eraseExtension.switchMutations).toEqual([]);
		expect(document.commit(eraseExtension)).toBe(true);
		expect(document.map.getAdvancedSwitch(switchRecord.id)).toEqual(switchRecord);
	});

	it("reshapes profile and chirality atomically without changing the stable id", () => {
		const document = documentWithTerminal(DIR_E);
		const build = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: 2 }, "A");
		expect(document.commit(build)).toBe(true);
		const before = build.switchRecord;
		if (!before) throw new Error("expected a planned switch");
		const beforeGeometry = deriveAdvancedSwitchGeometry(before);

		const reshape = planAdvancedSwitchReshape(document.map, before.id, "D", "left");
		expect(reshape.valid, reshape.reason).toBe(true);
		expect(reshape.switchRecord).toMatchObject({
			id: before.id,
			profileClass: "D",
			lateral: DIR_N,
		});
		expect(document.commit(reshape)).toBe(true);
		expect(document.map.advancedSwitchCount).toBe(1);
		expect(document.map.getAdvancedSwitch(before.id)).toEqual(reshape.switchRecord);
		const after = reshape.switchRecord;
		if (!after) throw new Error("expected a reshaped switch");
		const afterGeometry = deriveAdvancedSwitchGeometry(after);
		const afterClaims = new Set(afterGeometry.claimedCells.map((cell) => cellKey(cell.x, cell.y)));
		for (const cell of beforeGeometry.claimedCells) {
			if (!afterClaims.has(cellKey(cell.x, cell.y))) {
				expect(document.map.getEncoded(cell.x, cell.y)).toBe(0);
				expect(document.map.getAdvancedSwitchOwningCell(cell.x, cell.y)).toBeUndefined();
			}
		}

		expect(document.undo()).toBe(true);
		expect(document.map.getAdvancedSwitch(before.id)).toEqual(before);
		for (const cell of beforeGeometry.claimedCells) {
			expect(document.map.getAdvancedSwitchOwningCell(cell.x, cell.y)?.id).toBe(before.id);
		}
		expect(document.redo()).toBe(true);
		expect(document.map.getAdvancedSwitch(before.id)).toEqual(reshape.switchRecord);
	});

	it("requires a disappearing boundary port to be disconnected before reshape", () => {
		const document = documentWithTerminal(DIR_E);
		const build = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: 2 }, "A");
		expect(document.commit(build)).toBe(true);
		const switchRecord = build.switchRecord;
		if (!switchRecord) throw new Error("expected a planned switch");
		const output = deriveAdvancedSwitchGeometry(switchRecord).outputs[1];
		const extension = planRailPath(document.map, [
			output.cell,
			moveCell(output.cell, output.direction),
		]);
		expect(extension.valid, extension.reason).toBe(true);
		expect(document.commit(extension)).toBe(true);

		const reshape = planAdvancedSwitchReshape(document.map, switchRecord.id, "B");
		expect(reshape.valid).toBe(false);
		expect(reshape.reason).toContain("boundary port");
		expect(document.commit(reshape)).toBe(false);
		expect(document.map.getAdvancedSwitch(switchRecord.id)).toEqual(switchRecord);
	});

	it("reports exact footprint conflicts before commit", () => {
		const document = documentWithTerminal(DIR_E);
		const clean = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: 2 }, "B");
		const blockedCell = clean.cells.find((cell) => cell.x === 1 && cell.y === 0);
		expect(blockedCell).toBeDefined();
		if (!blockedCell) throw new Error("expected an interior footprint cell");
		document.map.setEncoded(
			blockedCell.x,
			blockedCell.y,
			encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }),
		);

		const blocked = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: 2 }, "B");
		expect(blocked.valid).toBe(false);
		expect(blocked.conflicts).toContainEqual(blockedCell);
		expect(blocked.reason).toContain("footprint");
	});

	it("rejects ordinary rail in swept-only cells for build and reshape", () => {
		const buildDocument = documentWithTerminal(DIR_E);
		const clean = planAdvancedSwitch(buildDocument.map, ORIGIN, { x: 0, y: 2 }, "A");
		const cleanRecord = clean.switchRecord;
		if (!cleanRecord) throw new Error("expected a planned switch");
		const cleanGeometry = deriveAdvancedSwitchGeometry(cleanRecord);
		const occupied = new Set(cleanGeometry.occupiedCells.map((cell) => cellKey(cell.x, cell.y)));
		const sweptOnly = cleanGeometry.claimedCells.find(
			(cell) => !occupied.has(cellKey(cell.x, cell.y)),
		);
		if (!sweptOnly) throw new Error("expected a swept-only reservation cell");
		buildDocument.map.setEncoded(
			sweptOnly.x,
			sweptOnly.y,
			encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }),
		);
		const blockedBuild = planAdvancedSwitch(buildDocument.map, ORIGIN, { x: 0, y: 2 }, "A");
		expect(blockedBuild.valid).toBe(false);
		expect(blockedBuild.conflicts).toContainEqual(sweptOnly);
		expect(buildDocument.commit(blockedBuild)).toBe(false);

		const reshapeDocument = documentWithTerminal(DIR_E);
		const initial = planAdvancedSwitch(reshapeDocument.map, ORIGIN, { x: 0, y: 2 }, "C");
		expect(reshapeDocument.commit(initial)).toBe(true);
		const initialRecord = initial.switchRecord;
		if (!initialRecord) throw new Error("expected an initial switch");
		reshapeDocument.map.setEncoded(
			sweptOnly.x,
			sweptOnly.y,
			encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }),
		);
		const blockedReshape = planAdvancedSwitchReshape(reshapeDocument.map, initialRecord.id, "A");
		expect(blockedReshape.valid).toBe(false);
		expect(blockedReshape.conflicts).toContainEqual(sweptOnly);
		expect(reshapeDocument.commit(blockedReshape)).toBe(false);
		expect(reshapeDocument.map.getAdvancedSwitch(initialRecord.id)).toEqual(initialRecord);
	});

	it("copies history inputs and retains undo after an atomic preflight failure", () => {
		const document = documentWithTerminal(DIR_E);
		const plan = planAdvancedSwitch(document.map, ORIGIN, { x: 0, y: 2 }, "A");
		const switchRecord = plan.switchRecord;
		if (!switchRecord) throw new Error("expected a planned switch");
		expect(document.commit(plan)).toBe(true);
		const originalCell = plan.mutations[0];
		if (!originalCell) throw new Error("expected a switch cell mutation");
		(originalCell as { after: number }).after = 0;
		(switchRecord as { profileClass: string }).profileClass = "D";

		expect(document.map.deleteAdvancedSwitch(switchRecord.id)).toBe(true);
		const revisionBeforeFailure = document.map.getRevision();
		const encodedBeforeFailure = document.map.getEncoded(originalCell.x, originalCell.y);
		expect(document.undo()).toBe(false);
		expect(document.canUndo).toBe(true);
		expect(document.canRedo).toBe(false);
		expect(document.map.getRevision()).toBe(revisionBeforeFailure);
		expect(document.map.getEncoded(originalCell.x, originalCell.y)).toBe(encodedBeforeFailure);

		const storedRecord = { ...switchRecord, profileClass: "A" as const, origin: { x: 0, y: 0 } };
		expect(document.map.setAdvancedSwitch(storedRecord)).toBe(true);
		expect(document.undo()).toBe(true);
		expect(document.map.getAdvancedSwitch(storedRecord.id)).toBeUndefined();
	});

	it("keeps preview reads local on a 50k-cell map", () => {
		const map = new CountingTileMap();
		map.setEncoded(-3, 0, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		map.setEncoded(-2, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(-1, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
		map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_W, outgoing: 0 }));
		for (let index = 0; index < 50_000; index++) {
			map.setEncoded(1_000 + index, 1_000, encodeRailCell({ incoming: 0, outgoing: DIR_E }));
		}
		map.resetReadCount();

		const plan = planAdvancedSwitch(map, ORIGIN, { x: 0, y: 2 }, "C");
		expect(plan.valid, plan.reason).toBe(true);
		expect(map.readCount).toBeLessThan(5_000);
	});
});

const ORIGIN: Cell = { x: 0, y: 0 };

function documentWithTerminal(forward: Direction): RailDocument {
	const document = new RailDocument();
	const cells: Cell[] = [];
	let current = ORIGIN;
	for (let distance = 0; distance < 4; distance++) {
		cells.unshift(current);
		current = moveCell(current, oppositeDirection(forward));
	}
	const plan = planRailPath(document.map, cells);
	if (!plan.valid || !document.commit(plan))
		throw new Error(`terminal fixture failed: ${plan.reason}`);
	return document;
}

function leftOf(direction: Direction): Direction {
	if (direction === DIR_N) return DIR_W;
	if (direction === DIR_E) return DIR_N;
	if (direction === DIR_S) return DIR_E;
	return DIR_S;
}

class CountingTileMap extends TileMap {
	readCount = 0;

	override getEncoded(x: number, y: number): number {
		this.readCount++;
		return super.getEncoded(x, y);
	}

	override getAdvancedSwitchOwningCell(x: number, y: number): AdvancedSwitchRecord | undefined {
		this.readCount++;
		return super.getAdvancedSwitchOwningCell(x, y);
	}

	resetReadCount(): void {
		this.readCount = 0;
	}
}
