import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { compilePhysicalPathCanonicalOwnership } from "./PhysicalPathCanonicalOwnership";
import { compilePhysicalRail } from "./PhysicalRailCompiler";

describe("compilePhysicalPathCanonicalOwnership", () => {
	it("assigns a branch turnout shared interval to one stable owner", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: 3 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const ownership = compilePhysicalPathCanonicalOwnership(paths);

		expect(ownership.sharedOccurrenceCount).toBeGreaterThan(1);
		for (let row = 0; row < paths.sharedSegmentIds.length; row++) {
			const sharedId = paths.sharedSegmentIds[row] as number;
			const owner = ownership.sharedOwnerPathRows[row] as number;
			for (let other = 0; other < paths.sharedSegmentIds.length; other++) {
				if ((paths.sharedSegmentIds[other] as number) === sharedId) {
					expect(ownership.sharedOwnerPathRows[other]).toBe(owner);
				}
			}
		}
		expect(ownership.totalOwnedLengthMeters).toBeCloseTo(paths.totalLengthMeters, 4);
		expect(ownedLength(ownership)).toBeCloseTo(paths.totalLengthMeters, 4);
	});

	it("keeps every full path interval when no geometry is shared", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const ownership = compilePhysicalPathCanonicalOwnership(paths);

		expect(ownership.sharedOccurrenceCount).toBe(0);
		expect(ownership.ownedIntervalStarts).toHaveLength(paths.pathCount);
		for (let pathRow = 0; pathRow < paths.pathCount; pathRow++) {
			const intervalRow = ownership.ownedIntervalOffsets[pathRow] as number;
			expect(ownership.ownedIntervalStarts[intervalRow]).toBe(0);
			expect(ownership.ownedIntervalEnds[intervalRow]).toBeCloseTo(
				paths.lengths[pathRow] as number,
			);
		}
	});

	it("rejects an interior geometry divergence inside a shared interval", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: 3 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const sharedId = paths.sharedSegmentIds[0] as number;
		const occurrences: Array<{ pathRow: number; start: number; end: number }> = [];
		for (let pathRow = 0; pathRow < paths.pathCount; pathRow++) {
			for (
				let row = paths.sharedSegmentOffsets[pathRow] as number;
				row < (paths.sharedSegmentOffsets[pathRow + 1] as number);
				row++
			) {
				if ((paths.sharedSegmentIds[row] as number) !== sharedId) continue;
				occurrences.push({
					pathRow,
					start: paths.sharedSegmentStarts[row] as number,
					end: paths.sharedSegmentEnds[row] as number,
				});
			}
		}
		expect(occurrences.length).toBeGreaterThan(1);
		const candidate = occurrences[1] as (typeof occurrences)[number];
		const targetStation = candidate.start + (candidate.end - candidate.start) * 0.25;
		let targetPoint = paths.offsets[candidate.pathRow] as number;
		let targetDistance = Number.POSITIVE_INFINITY;
		for (
			let row = paths.offsets[candidate.pathRow] as number;
			row < (paths.offsets[candidate.pathRow + 1] as number);
			row++
		) {
			const distance = Math.abs((paths.distances[row] as number) - targetStation);
			if (distance < targetDistance) {
				targetPoint = row;
				targetDistance = distance;
			}
		}
		const positions = new Float32Array(paths.positions);
		positions[targetPoint * 2 + 1] = (positions[targetPoint * 2 + 1] as number) + 0.1;

		expect(() => compilePhysicalPathCanonicalOwnership({ ...paths, positions })).toThrow(
			"inconsistent geometry",
		);
	});

	it("rejects duplicate and overlapping shared metadata", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 5, y: 0 })),
		).toBe(true);
		const paths = compilePhysicalRail(document.map).paths;
		const duplicate = {
			...paths,
			sharedSegmentOffsets: Uint32Array.of(0, 2, ...new Array(paths.pathCount - 1).fill(2)),
			sharedSegmentIds: Uint32Array.of(7, 7),
			sharedSegmentStarts: Float32Array.of(0, 0.1),
			sharedSegmentEnds: Float32Array.of(0.2, 0.3),
			sharedSegmentCount: 1,
			totalLengthMeters: paths.totalRouteLengthMeters - 0.2,
		};
		expect(() => compilePhysicalPathCanonicalOwnership(duplicate)).toThrow("repeats");

		const overlap = {
			...duplicate,
			sharedSegmentIds: Uint32Array.of(7, 8),
		};
		expect(() => compilePhysicalPathCanonicalOwnership(overlap)).toThrow("overlapping");
	});
});

function ownedLength(ownership: ReturnType<typeof compilePhysicalPathCanonicalOwnership>): number {
	let total = 0;
	for (let row = 0; row < ownership.ownedIntervalStarts.length; row++) {
		total +=
			(ownership.ownedIntervalEnds[row] as number) - (ownership.ownedIntervalStarts[row] as number);
	}
	return total;
}
