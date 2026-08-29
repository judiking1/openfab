import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { createRailProjectReadiness } from "../compile/RailProjectReadiness";
import { checksumRailMap } from "../worker/RailMirrorChecksum";
import { RailPatchMirror } from "../worker/RailPatchMirror";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import { analyzeRailNetwork } from "./network";
import { planRailConstruction } from "./paint";
import { resolveRailClosureSnap } from "./RailClosureSnap";
import { RailDocument, type RailPatchEvent } from "./RailDocument";

describe("RailClosureSnap", () => {
	it("snaps a chained route to a nearby compatible source terminal", () => {
		const events: RailPatchEvent[] = [];
		const document = openHairpin(events);
		const mirror = new RailPatchMirror();
		for (const event of events) mirror.applyPatch(event);
		const before = document.map.edgeCount;
		const snap = resolveRailClosureSnap(document.map, { x: 0, y: 4 }, { x: 1.12, y: 0.52 }, "auto");

		expect(snap?.cell).toEqual({ x: 0, y: 0 });
		expect(snap?.distanceMeters).toBeLessThan(0.82);
		expect(snap?.plan.valid, snap?.plan.reason).toBe(true);
		expect(snap?.plan.cells.at(-1)).toEqual({ x: 0, y: 0 });
		if (!snap) throw new Error("Expected a compatible closure snap.");
		expect(document.commit(snap.plan)).toBe(true);
		const closureEvent = events[3];
		if (!closureEvent) throw new Error("Expected one closure patch event.");
		expect(mirror.applyPatch(closureEvent)).toMatchObject({
			sequence: 4,
			checksum: checksumRailMap(document.map),
		});
		expect(document.map.edgeCount).toBeGreaterThan(before);
		expect(readinessFor(document)).toMatchObject({
			ready: true,
			summary: { strongComponents: 1, physicalStrongComponents: 1, openTerminals: 0 },
		});
		expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
		);
		const closedChecksum = checksumRailMap(document.map);
		expect(document.undo()).toBe(true);
		const undoEvent = events[4];
		if (!undoEvent) throw new Error("Expected one closure undo event.");
		expect(mirror.applyPatch(undoEvent)).toMatchObject({
			sequence: 5,
			checksum: checksumRailMap(document.map),
		});
		expect(document.map.edgeCount).toBe(before);
		expect(readinessFor(document).ready).toBe(false);
		expect(document.redo()).toBe(true);
		const redoEvent = events[5];
		if (!redoEvent) throw new Error("Expected one closure redo event.");
		expect(mirror.applyPatch(redoEvent)).toMatchObject({ sequence: 6, checksum: closedChecksum });
		expect(document.map.getRail(0, 0).incoming).not.toBe(0);
		expect(readinessFor(document).ready).toBe(true);
		expect(checksumRailPhysicalLayout(mirror.getPhysicalPublication().current.buffers)).toBe(
			checksumRailPhysicalLayout(compilePhysicalRail(document.map)),
		);
	});

	it("does not snap beyond the bounded magnet radius", () => {
		const document = openHairpin();
		expect(
			resolveRailClosureSnap(document.map, { x: 0, y: 4 }, { x: 1.4, y: 0.5 }, "auto"),
		).toBeNull();
	});

	it("rejects a reverse overlap even when the source terminal is nearby", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);

		expect(
			resolveRailClosureSnap(document.map, { x: 5, y: 0 }, { x: 0.52, y: 0.51 }, "auto"),
		).toBeNull();
	});

	it("only activates from the current directed sink terminal", () => {
		const document = openHairpin();
		expect(
			resolveRailClosureSnap(document.map, { x: 3, y: 0 }, { x: 0.52, y: 0.51 }, "auto"),
		).toBeNull();
	});
});

function openHairpin(events?: RailPatchEvent[]): RailDocument {
	const document = new RailDocument();
	if (events) document.subscribe((event) => events.push(event));
	for (const [start, end] of [
		[
			{ x: 0, y: 0 },
			{ x: 6, y: 0 },
		],
		[
			{ x: 6, y: 0 },
			{ x: 6, y: 4 },
		],
		[
			{ x: 6, y: 4 },
			{ x: 0, y: 4 },
		],
	] as const) {
		expect(document.commit(planRailConstruction(document.map, start, end))).toBe(true);
	}
	return document;
}

function readinessFor(document: RailDocument) {
	return createRailProjectReadiness(
		analyzeRailNetwork(document.map),
		compilePhysicalRail(document.map),
		checksumRailMap(document.map),
	);
}
