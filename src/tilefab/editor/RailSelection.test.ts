import { describe, expect, it } from "vitest";
import {
	getStraightOffsetSource,
	planMoveCorner,
	planMoveEndpoint,
	planOffsetStraight,
} from "../core/edit";
import { planRailConstruction } from "../core/paint";
import { classifyRailCell } from "../core/RailCellClassification";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	type RailModuleOwnership,
	resolveRailModuleOwnership,
} from "../core/RailModuleOwnership";
import type { Cell } from "../core/TileMap";
import { collectTurnoutFootprints } from "../core/turnout";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import {
	type RailReshapeKind,
	ReshapeSelectionHistory,
	resolveRailSelectionOwnership,
} from "./RailSelection";

describe("resolveRailSelectionOwnership", () => {
	it("clears a turnout selection when undo removes its semantic identity", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 6, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: 3, y: 3 })),
		).toBe(true);
		const footprint = collectTurnoutFootprints(document.map)[0];
		if (!footprint) throw new Error("expected turnout");
		const selected = resolveRailModuleOwnership(
			buildRailModuleOwnershipIndex(document.map),
			footprint.cell,
			{
				incoming: footprint.curveFrom,
				outgoing: footprint.curveTo,
				role: "turnout-diverge",
			},
		);
		if (selected.status !== "resolved") throw new Error(selected.reason);

		expect(document.undo()).toBe(true);
		const afterUndo = buildRailModuleOwnershipIndex(document.map);
		expect(
			resolveRailSelectionOwnership(afterUndo, footprint.cell, selected.module.key),
		).toBeNull();
		expect(resolveRailSelectionOwnership(afterUndo, footprint.cell, null)?.kind).toBe("straight");
	});
});

const original = { x: 12, y: 8 };
const moved = { x: 17, y: 10 };
const movedAgain = { x: 20, y: 10 };

function reshapeFixture(reversed = false, observe = (event: RailPatchEvent) => event) {
	const document = new RailDocument();
	const segments = [
		[
			{ x: 2, y: -2 },
			{ x: 12, y: -2 },
		],
		[{ x: 12, y: -2 }, original],
	] as const;
	for (const [from, to] of reversed ? [...segments].reverse() : segments)
		expect(
			document.commit(
				planRailConstruction(document.map, reversed ? to : from, reversed ? from : to),
			),
		).toBe(true);
	const history = new ReshapeSelectionHistory();
	const events: RailPatchEvent[] = [];
	document.subscribe((event) => {
		events.push(event);
		history.observePatch(document, observe(event));
	});
	let selected: { cell: Cell; module: RailModuleOwnership } | null = null;
	const index = () => buildRailModuleOwnershipIndex(document.map);
	const select = (cell: Cell | null) => {
		const ownership = index();
		const resolved = cell ? ownership.resolve(cell) : null;
		selected = cell && resolved?.status === "resolved" ? { cell, module: resolved.module } : null;
		history.select(
			document,
			document.map,
			ownership,
			selected?.cell ?? null,
			selected?.module.key ?? null,
		);
	};
	const publish = () => {
		const ownership = index();
		const projection = history.publish(document, document.map, ownership);
		if (projection === "clear") selected = null;
		else if (projection) selected = projection;
		else if (selected) {
			const module = document.map.hasRail(selected.cell.x, selected.cell.y)
				? resolveRailSelectionOwnership(ownership, selected.cell, selected.module.key)
				: null;
			selected = module ? { cell: selected.cell, module } : null;
		}
		history.select(
			document,
			document.map,
			ownership,
			selected?.cell ?? null,
			selected?.module.key ?? null,
		);
		return projection;
	};
	const commitMove = (target = moved, publishNow = true, kind: RailReshapeKind = "endpoint") => {
		if (!selected) throw new Error("Select a reshape source first");
		const plan =
			kind === "corner"
				? planMoveCorner(document.map, selected.cell, target)
				: kind === "straight"
					? planOffsetStraight(document.map, selected.cell, target)
					: planMoveEndpoint(document.map, selected.cell, target);
		expect(plan.valid, plan.reason).toBe(true);
		history.prepareMove(document, target, kind);
		try {
			expect(document.commit(plan)).toBe(true);
		} finally {
			history.finishMove();
		}
		if (publishNow) publish();
	};
	const replay = (direction: "undo" | "redo") => {
		expect(document[direction]()).toBe(true);
		publish();
	};
	select(original);
	return {
		document,
		history,
		events,
		index,
		select,
		publish,
		commitMove,
		replay,
		selection: () => selected,
		identity: () => (selected ? { cell: selected.cell, moduleKey: selected.module.key } : null),
	};
}

describe("endpoint selection history", () => {
	it.each([
		false,
		true,
	])("follows the endpoint through Apply/Undo/Redo in reversed flow %s without adding authored changes", (reversed) => {
		const f = reshapeFixture(reversed);
		const checksum = checksumRailMap(f.document.map);
		const sequence = f.document.getPatchSequence();
		const historyLength = f.document.captureRailMirrorHistoryLedger().undo.length;
		f.commitMove();
		const applied = checksumRailMap(f.document.map);
		expect(f.selection()?.cell).toEqual(moved);
		expect(f.document.captureRailMirrorHistoryLedger().undo).toHaveLength(historyLength + 1);
		for (let repeat = 0; repeat < 2; repeat++) {
			f.replay("undo");
			expect(f.selection()?.cell).toEqual(original);
			expect(checksumRailMap(f.document.map)).toBe(checksum);
			f.replay("redo");
			expect(f.selection()?.cell).toEqual(moved);
			expect(checksumRailMap(f.document.map)).toBe(applied);
		}
		expect(classifyRailCell(f.document.map.getRail(original.x, original.y))).toBe("LINEAR");
		expect(f.events.map((event) => event.kind)).toEqual(["edit", "undo", "redo", "undo", "redo"]);
		expect(f.document.getPatchSequence()).toBe(sequence + 5);
	});

	it.each([
		null,
		{ x: 7, y: -2 },
	])("honors user selection %j before replay and does not revive the receipt", (cell) => {
		const f = reshapeFixture();
		f.commitMove();
		f.select(cell);
		const selected = f.identity();
		f.replay("undo");
		expect(f.identity()).toEqual(selected);
		f.replay("redo");
		expect(f.identity()).toEqual(selected);
		// Selecting the endpoint again cannot revive a receipt abandoned by an explicit selection change.
		f.select(moved);
		f.replay("undo");
		expect(f.selection()).toBeNull();
	});

	it("supports the latest of two consecutive moves and clears unsupported older endpoint context", () => {
		const f = reshapeFixture();
		f.commitMove();
		f.commitMove(movedAgain);
		f.replay("undo");
		expect(f.selection()?.cell).toEqual(moved);
		f.replay("redo");
		expect(f.selection()?.cell).toEqual(movedAgain);
		f.replay("undo");
		f.replay("undo");
		expect(f.selection()).toBeNull();
		f.select(original);
		f.replay("redo");
		// The original module still exists, but its old endpoint cell is now an internal straight.
		expect(classifyRailCell(f.document.map.getRail(original.x, original.y))).toBe("LINEAR");
		expect(f.selection()).toBeNull();
		f.replay("redo");
		expect(f.selection()).toBeNull();
	});

	it("drops the latest receipt when a new edit replaces the redo branch", () => {
		const f = reshapeFixture();
		f.commitMove();
		f.replay("undo");
		expect(
			f.document.commit(planRailConstruction(f.document.map, { x: 30, y: 0 }, { x: 35, y: 0 })),
		).toBe(true);
		f.publish();
		expect(f.document.canRedo).toBe(false);
		expect(f.document.redo()).toBe(false);
		f.replay("undo");
		f.replay("redo");
		expect(f.selection()?.cell).toEqual(original);
	});

	it("does not create a receipt for cancelled, failed or stale Apply", () => {
		const f = reshapeFixture();
		f.commitMove();
		const sequence = f.document.getPatchSequence();
		f.history.prepareMove(f.document, movedAgain);
		f.history.finishMove();
		f.history.prepareMove(f.document, moved);
		expect(f.document.commit(planMoveEndpoint(f.document.map, moved, moved))).toBe(false);
		f.history.finishMove();
		expect(f.document.getPatchSequence()).toBe(sequence);
		f.replay("undo");
		expect(f.selection()?.cell).toEqual(original);
		const stale = planMoveEndpoint(f.document.map, original, moved);
		expect(
			f.document.commit(planRailConstruction(f.document.map, { x: 30, y: 0 }, { x: 35, y: 0 })),
		).toBe(true);
		f.publish();
		f.history.prepareMove(f.document, moved);
		expect(f.document.commit(stale)).toBe(false);
		f.history.finishMove();
		expect(f.history.awaitingMovePublication).toBe(false);
	});

	it.each([
		null,
		{ x: 7, y: -2 },
	])("preserves selection %j changed before delayed publication", (cell) => {
		const f = reshapeFixture();
		f.commitMove(moved, false);
		f.select(cell);
		const selected = f.identity();
		expect(f.publish()).toBeNull();
		expect(f.identity()).toEqual(selected);
		f.replay("undo");
		expect(f.identity()).toEqual(selected);
	});

	it("does not carry a pending selection into another document with matching coordinates", () => {
		const f = reshapeFixture();
		f.commitMove(moved, false);
		const other = reshapeFixture();
		expect(f.history.publish(other.document, other.document.map, other.index())).toBeNull();
		f.history.reset();
		f.select(null);
		f.replay("undo");
		expect(f.selection()).toBeNull();
	});

	it("fails closed when publication has stale, missing or ambiguous ownership", () => {
		for (const kind of ["stale", "missing", "ambiguous"] as const) {
			const f = reshapeFixture();
			const staleIndex = f.index();
			f.commitMove(moved, false);
			const current = f.index();
			const index =
				kind === "stale"
					? staleIndex
					: kind === "missing"
						? { ...current, find: () => null }
						: {
								...current,
								resolve: () => ({
									status: "ambiguous" as const,
									candidates: [],
									reason: "Ambiguous fixture",
								}),
							};
			expect(f.history.publish(f.document, f.document.map, index)).toBe("clear");
			expect(f.history.awaitingMovePublication).toBe(false);
		}
	});

	it("rejects a replay with the right sequence but a different command transition", () => {
		const f = reshapeFixture(false, (event) =>
			event.kind === "undo" ? { ...event, changes: [] } : event,
		);
		f.commitMove();
		f.replay("undo");
		expect(f.selection()).toBeNull();
	});

	it("never selects a deleted endpoint after a later authored erase", () => {
		const f = reshapeFixture();
		f.commitMove();
		expect(f.document.clear()).toBe(true);
		f.publish();
		expect(f.selection()).toBeNull();
		f.replay("undo");
		expect(f.selection()).toBeNull();
	});
});

const reshapeCases = [
	{ kind: "corner", source: { x: 12, y: -2 }, target: { x: 14, y: -4 }, pointer: { x: 14, y: -4 } },
	{ kind: "straight", source: { x: 7, y: -2 }, target: { x: 7, y: -5 }, pointer: { x: 9, y: -5 } },
	{ kind: "straight", source: { x: 12, y: 3 }, target: { x: 15, y: 3 }, pointer: { x: 15, y: 5 } },
] as const;

describe("corner and straight selection history", () => {
	it.each(reshapeCases)("follows exact $kind anchor $source with both flows and repeated replay", ({
		kind,
		source,
		target,
		pointer,
	}) => {
		for (const reversed of [false, true]) {
			const f = reshapeFixture(reversed);
			f.select(source);
			const before = f.identity();
			const checksum = checksumRailMap(f.document.map);
			const sequence = f.document.getPatchSequence();
			const length = f.document.captureRailMirrorHistoryLedger().undo.length;
			f.commitMove(pointer, true, kind);
			expect(f.selection()?.cell).toEqual(target);
			const after = f.identity();
			const applied = checksumRailMap(f.document.map);
			expect(f.document.captureRailMirrorHistoryLedger().undo).toHaveLength(length + 1);
			if (kind === "straight")
				expect(getStraightOffsetSource(f.document.map, target).allowed).toBe(false);
			for (let repeat = 0; repeat < 2; repeat++) {
				f.replay("undo");
				expect(f.identity()).toEqual(before);
				expect(checksumRailMap(f.document.map)).toBe(checksum);
				f.replay("redo");
				expect(f.identity()).toEqual(after);
				expect(checksumRailMap(f.document.map)).toBe(applied);
			}
			expect(f.document.getPatchSequence()).toBe(sequence + 5);
		}
	});

	it.each(
		reshapeCases,
	)("preserves another selection and deselection for $kind $source, including delayed publication", ({
		kind,
		source,
		pointer,
	}) => {
		for (const cell of [null, { x: 3, y: -2 }]) {
			for (const publishNow of [true, false]) {
				const f = reshapeFixture();
				f.select(source);
				f.commitMove(pointer, publishNow, kind);
				f.select(cell);
				const selected = f.identity();
				if (!publishNow) expect(f.publish()).toBeNull();
				f.replay("undo");
				expect(f.identity()).toEqual(selected);
				f.replay("redo");
				expect(f.identity()).toEqual(selected);
				f.select(
					kind === "corner" ? { x: 14, y: -4 } : source.x === 7 ? { x: 7, y: -5 } : { x: 15, y: 3 },
				);
				f.replay("undo");
				expect(f.selection()).toBeNull();
			}
		}
	});

	it.each(
		reshapeCases,
	)("requires matching $kind intent and honors a selection made during Undo publication", ({
		kind,
		source,
		pointer,
	}) => {
		const f = reshapeFixture();
		f.select(source);
		f.history.prepareMove(f.document, pointer, "endpoint");
		const plan =
			kind === "corner"
				? planMoveCorner(f.document.map, source, pointer)
				: planOffsetStraight(f.document.map, source, pointer);
		expect(f.document.commit(plan)).toBe(true);
		f.history.finishMove();
		expect(f.history.awaitingMovePublication).toBe(false);
		f.publish();
		f.replay("undo");
		f.select(source);
		f.commitMove(pointer, true, kind);
		expect(f.document.undo()).toBe(true);
		f.select({ x: 3, y: -2 });
		const other = f.identity();
		expect(f.publish()).toBeNull();
		expect(f.identity()).toEqual(other);
	});

	it("replaces a corner receipt with the second corner move and safely abandons older history", () => {
		const f = reshapeFixture();
		f.select({ x: 12, y: -2 });
		f.commitMove({ x: 14, y: -4 }, true, "corner");
		f.commitMove({ x: 16, y: -6 }, true, "corner");
		f.replay("undo");
		expect(f.selection()?.cell).toEqual({ x: 14, y: -4 });
		f.replay("redo");
		expect(f.selection()?.cell).toEqual({ x: 16, y: -6 });
		f.replay("undo");
		f.replay("undo");
		expect(f.selection()).toBeNull();
		f.replay("redo");
		expect(f.selection()).toBeNull();
	});

	it.each([
		"corner",
		"straight",
	] as const)("keeps only the latest straight after a preceding $kind move", (firstKind) => {
		const f = reshapeFixture();
		expect(
			f.document.commit(planRailConstruction(f.document.map, original, { x: 12, y: 20 })),
		).toBe(true);
		f.publish();
		f.select(firstKind === "corner" ? { x: 12, y: -2 } : { x: 7, y: -2 });
		f.commitMove(firstKind === "corner" ? { x: 14, y: -4 } : { x: 7, y: -5 }, true, firstKind);
		f.select({ x: 12, y: 10 });
		f.commitMove({ x: 15, y: 10 }, true, "straight");
		f.replay("undo");
		expect(f.selection()?.cell).toEqual({ x: 12, y: 10 });
		f.replay("redo");
		expect(f.selection()?.cell).toEqual({ x: 15, y: 10 });
		f.replay("undo");
		f.replay("undo");
		// Unrelated exact anchors may survive; older commands never restore their moved targets.
		expect(f.selection()?.cell ?? null).not.toEqual({ x: 14, y: -4 });
		expect(f.selection()?.cell ?? null).not.toEqual({ x: 7, y: -5 });
	});

	it.each(
		reshapeCases,
	)("invalidates $kind $source on branch replacement or document replacement", ({
		kind,
		source,
		pointer,
	}) => {
		const f = reshapeFixture();
		f.select(source);
		f.commitMove(pointer, true, kind);
		f.replay("undo");
		const sourceSelection = f.identity();
		expect(
			f.document.commit(planRailConstruction(f.document.map, { x: 30, y: 0 }, { x: 35, y: 0 })),
		).toBe(true);
		f.publish();
		expect(f.document.canRedo).toBe(false);
		expect(f.document.redo()).toBe(false);
		f.replay("undo");
		f.replay("redo");
		expect(f.identity()).toEqual(sourceSelection);
		const pending = reshapeFixture();
		pending.select(source);
		pending.commitMove(pointer, false, kind);
		const other = reshapeFixture();
		expect(pending.history.publish(other.document, other.document.map, other.index())).toBeNull();
		pending.history.reset();
		pending.select(null);
		pending.replay("undo");
		expect(pending.selection()).toBeNull();
	});

	it.each(reshapeCases)("does not create a $kind receipt on rejected or cancelled Apply", ({
		kind,
		source,
		pointer,
	}) => {
		const f = reshapeFixture();
		f.select(source);
		const before = f.identity();
		const sequence = f.document.getPatchSequence();
		f.history.prepareMove(f.document, pointer, kind);
		f.history.finishMove();
		f.history.prepareMove(f.document, source, kind);
		const plan =
			kind === "corner"
				? planMoveCorner(f.document.map, source, source)
				: planOffsetStraight(f.document.map, source, source);
		expect(f.document.commit(plan)).toBe(false);
		f.history.finishMove();
		expect(f.identity()).toEqual(before);
		expect(f.document.getPatchSequence()).toBe(sequence);
		expect(f.history.awaitingMovePublication).toBe(false);
		f.commitMove(pointer, true, kind);
		f.history.prepareMove(f.document, { x: 100, y: 100 }, kind);
		f.history.finishMove();
		f.replay("undo");
		expect(f.identity()).toEqual(before);
	});

	it.each(
		reshapeCases,
	)("fails closed for stale or ambiguous $kind target publication and wrong replay", ({
		kind,
		source,
		pointer,
	}) => {
		for (const invalid of ["stale", "ambiguous", "wrong-transition"] as const) {
			const f = reshapeFixture(false, (event) =>
				invalid === "wrong-transition" && event.kind === "undo" ? { ...event, changes: [] } : event,
			);
			f.select(source);
			const staleIndex = f.index();
			f.commitMove(pointer, invalid === "wrong-transition", kind);
			if (invalid === "wrong-transition") {
				f.replay("undo");
				expect(f.selection()).toBeNull();
			} else {
				const index =
					invalid === "stale"
						? staleIndex
						: {
								...f.index(),
								resolve: () => ({
									status: "ambiguous" as const,
									candidates: [],
									reason: "Ambiguous fixture",
								}),
							};
				expect(f.history.publish(f.document, f.document.map, index)).toBe("clear");
			}
		}
	});
});
