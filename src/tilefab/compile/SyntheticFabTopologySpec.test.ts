import { describe, expect, it } from "vitest";
import {
	assertSyntheticFabTopologySpec,
	createSyntheticFabTopologySpec,
	LARGE_FAB_60_TOPOLOGY_SPEC,
	resizeSyntheticFabTopologyBayCount,
	SYNTHETIC_FAB_CARDINAL_SIDES,
	type SyntheticFabTopologySpec,
	syntheticFabTopologyBayCount,
} from "./SyntheticFabTopologySpec";

const SUPPORTED_FACTORY_PROFILES = [
	[3, 50],
	[3, 60],
	[3, 100],
	[4, 50],
	[4, 60],
	[4, 100],
	[5, 50],
	[5, 60],
	[5, 100],
	[6, 50],
	[6, 60],
	[6, 100],
] as const;

describe("SyntheticFabTopologySpec", () => {
	it("defines one shared wall circuit between the central spine and four-sided outer circulation", () => {
		const spec = LARGE_FAB_60_TOPOLOGY_SPEC;

		expect(() => assertSyntheticFabTopologySpec(spec)).not.toThrow();
		expect(spec.version).toBe(7);
		expect(spec.wallCircuit).toEqual({
			id: "FAB-INNER-WALL-CIRCUIT",
			label: "SHARED INNER BAY-WALL CIRCUIT",
		});
		expect(spec.processBlocks).toHaveLength(3);
		expect(spec.processBanks).toHaveLength(6);
		expect(spec.processRows).toHaveLength(6);
		expect(spec.wings).toHaveLength(12);
		expect(syntheticFabTopologyBayCount(spec)).toBe(60);
		expect(new Set(spec.wings.map((wing) => wing.id)).size).toBe(12);
		expect(new Set(spec.wings.map((wing) => `${wing.row}:${wing.column}`)).size).toBe(12);
		expect(new Set(spec.processBanks.map((bank) => `${bank.block}:${bank.column}`)).size).toBe(6);
		expect(spec.processBlocks.map((block) => [block.upperRow, block.lowerRow])).toEqual([
			[0, 1],
			[2, 3],
			[4, 5],
		]);

		for (const row of spec.processRows) {
			const leftWing = spec.wings.find((wing) => wing.id === row.leftWingId);
			const rightWing = spec.wings.find((wing) => wing.id === row.rightWingId);
			expect(leftWing).toMatchObject({ row: row.row, column: 0 });
			expect(rightWing).toMatchObject({ row: row.row, column: 1 });
		}

		expect(spec.spineWallLinks.map((link) => `${link.sourceSide}:${link.targetSide}`)).toEqual([
			"north:north",
			"south:south",
		]);
		expect(
			spec.spineWallLinks.every(
				(link) =>
					link.sourceSpineId === spec.spineId && link.targetWallCircuitId === spec.wallCircuit.id,
			),
		).toBe(true);
		expect(spec.wallOuterLinks.map((link) => `${link.sourceSide}:${link.outerSide}`)).toEqual([
			"north:north",
			"east:east",
			"south:south",
			"west:west",
		]);
		expect(
			spec.wallOuterLinks.every((link) => link.sourceWallCircuitId === spec.wallCircuit.id),
		).toBe(true);
	});

	it.each(
		SUPPORTED_FACTORY_PROFILES,
	)("composes %i Process Blocks and %i Bays from the V7 process-row grammar", (processBlockCount, totalBayCount) => {
		const spec = createSyntheticFabTopologySpec({ processBlockCount, totalBayCount });

		expect(spec.version).toBe(7);
		expect(spec.blocks).toBe(processBlockCount);
		expect(spec.rows).toBe(processBlockCount * 2);
		expect(spec.wings).toHaveLength(processBlockCount * 4);
		expect(spec.processRows).toHaveLength(processBlockCount * 2);
		expect(spec.processBanks).toHaveLength(processBlockCount * 2);
		expect(spec.processBlocks).toHaveLength(processBlockCount);
		expect(spec.spineWallLinks).toHaveLength(2);
		expect(spec.wallOuterLinks).toHaveLength(4);
		expect(new Set(spec.wallOuterLinks.map((link) => link.sourceSide))).toEqual(
			new Set(SYNTHETIC_FAB_CARDINAL_SIDES),
		);
		expect(syntheticFabTopologyBayCount(spec)).toBe(totalBayCount);
		expect(new Set(spec.wings.map((wing) => wing.id)).size).toBe(spec.wings.length);

		const bays = spec.wings.flatMap((wing) => wing.bays);
		expect(bays).toHaveLength(totalBayCount);
		expect(new Set(bays.map((bay) => bay.id)).size).toBe(totalBayCount);
		for (const wing of spec.wings) {
			expect(wing.bayCount).toBeGreaterThanOrEqual(2);
			expect(wing.bayCount).toBeLessThanOrEqual(10);
			expect(wing.bays.map((bay) => bay.index)).toEqual(
				Array.from({ length: wing.bayCount }, (_, index) => index),
			);
		}
		expect(() => assertSyntheticFabTopologySpec(spec)).not.toThrow();
	});

	it("uses safe, side-specific placement grammar for all four wall-to-outer gateways", () => {
		const spec = LARGE_FAB_60_TOPOLOGY_SPEC;
		const bySide = new Map(spec.wallOuterLinks.map((link) => [link.sourceSide, link]));

		for (const side of ["north", "south"] as const) {
			const link = bySide.get(side);
			expect(link?.placement.kind).toBe("CENTER_OFFSET");
			if (link?.placement.kind !== "CENTER_OFFSET") continue;
			expect(Math.abs(link.placement.offsetMeters)).toBeGreaterThanOrEqual(
				spec.spineWidthMeters + spec.rowLinkWindowMeters,
			);
		}
		for (const side of ["east", "west"] as const) {
			const link = bySide.get(side);
			expect(link?.placement.kind).toBe("BLOCK_GAP");
			if (link?.placement.kind !== "BLOCK_GAP") continue;
			expect(link.placement.gapAfterBlock).toBeGreaterThanOrEqual(0);
			expect(link.placement.gapAfterBlock).toBeLessThan(spec.blocks - 1);
		}
		const blockGaps = spec.wallOuterLinks.flatMap((link) =>
			link.placement.kind === "BLOCK_GAP" ? [link.placement.gapAfterBlock] : [],
		);
		expect(new Set(blockGaps).size).toBe(2);
	});

	it("rejects factory profiles outside the supported Block and Bay ranges", () => {
		expect(() =>
			createSyntheticFabTopologySpec({ processBlockCount: 2, totalBayCount: 60 }),
		).toThrow(/3-6/);
		expect(() =>
			createSyntheticFabTopologySpec({ processBlockCount: 7, totalBayCount: 60 }),
		).toThrow(/3-6/);
		expect(() =>
			createSyntheticFabTopologySpec({ processBlockCount: 3, totalBayCount: 49 }),
		).toThrow(/50-100/);
		expect(() =>
			createSyntheticFabTopologySpec({ processBlockCount: 3, totalBayCount: 101 }),
		).toThrow(/50-100/);
	});

	it("rejects externally supplied topology specs outside the aggregate 50-100 Bay contract", () => {
		const minimum = createSyntheticFabTopologySpec({ processBlockCount: 3, totalBayCount: 50 });
		const firstMinimumWing = minimum.wings[0];
		if (!firstMinimumWing) throw new Error("Expected a synthetic FAB Wing.");
		const belowMinimum: SyntheticFabTopologySpec = {
			...minimum,
			wings: Object.freeze([
				{
					...firstMinimumWing,
					bayCount: firstMinimumWing.bayCount - 1,
					bays: Object.freeze(firstMinimumWing.bays.slice(0, -1)),
				},
				...minimum.wings.slice(1),
			]),
		};
		const maximum = createSyntheticFabTopologySpec({ processBlockCount: 3, totalBayCount: 100 });
		const firstMaximumWing = maximum.wings[0];
		if (!firstMaximumWing) throw new Error("Expected a synthetic FAB Wing.");
		const aboveMaximum: SyntheticFabTopologySpec = {
			...maximum,
			wings: Object.freeze([
				{
					...firstMaximumWing,
					bayCount: firstMaximumWing.bayCount + 1,
					bays: Object.freeze([
						...firstMaximumWing.bays,
						{
							id: `${firstMaximumWing.id}-BAY-EXTRA`,
							label: `${firstMaximumWing.label} BAY EXTRA`,
							index: firstMaximumWing.bayCount,
						},
					]),
				},
				...maximum.wings.slice(1),
			]),
		};

		expect(() => assertSyntheticFabTopologySpec(belowMinimum)).toThrow(/50-100/);
		expect(() => assertSyntheticFabTopologySpec(aboveMaximum)).toThrow(/50-100/);
	});

	it("rejects duplicate Wing, row, and Bay identities before rail is authored", () => {
		const duplicateWing: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			wings: Object.freeze([
				LARGE_FAB_60_TOPOLOGY_SPEC.wings[0],
				{ ...LARGE_FAB_60_TOPOLOGY_SPEC.wings[1], row: 0, column: 0 },
				...LARGE_FAB_60_TOPOLOGY_SPEC.wings.slice(2),
			]),
		};
		const duplicateRow: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			processRows: Object.freeze([
				LARGE_FAB_60_TOPOLOGY_SPEC.processRows[0],
				{ ...LARGE_FAB_60_TOPOLOGY_SPEC.processRows[1], row: 0 },
				...LARGE_FAB_60_TOPOLOGY_SPEC.processRows.slice(2),
			]),
		};
		const firstWing = LARGE_FAB_60_TOPOLOGY_SPEC.wings[0];
		const secondWing = LARGE_FAB_60_TOPOLOGY_SPEC.wings[1];
		if (!firstWing || !secondWing || !firstWing.bays[0]) {
			throw new Error("Expected synthetic FAB Wing Bays.");
		}
		const duplicateBay: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			wings: Object.freeze([
				firstWing,
				{
					...secondWing,
					bays: Object.freeze([{ ...firstWing.bays[0], index: 0 }, ...secondWing.bays.slice(1)]),
				},
				...LARGE_FAB_60_TOPOLOGY_SPEC.wings.slice(2),
			]),
		};

		expect(() => assertSyntheticFabTopologySpec(duplicateWing)).toThrow(/중복.*Wing 위치/);
		expect(() => assertSyntheticFabTopologySpec(duplicateRow)).toThrow(/중복.*process row 위치/);
		expect(() => assertSyntheticFabTopologySpec(duplicateBay)).toThrow(/중복.*Bay id/);
	});

	it("requires Process Rows to cover every Wing exactly once", () => {
		const missing: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			processRows: Object.freeze(LARGE_FAB_60_TOPOLOGY_SPEC.processRows.slice(1)),
		};
		const first = LARGE_FAB_60_TOPOLOGY_SPEC.processRows[0];
		if (!first) throw new Error("Expected a synthetic FAB process row.");
		const duplicate: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			processRows: Object.freeze([
				{ ...first, rightWingId: first.leftWingId },
				...LARGE_FAB_60_TOPOLOGY_SPEC.processRows.slice(1),
			]),
		};

		expect(() => assertSyntheticFabTopologySpec(missing)).toThrow(/process row 수/);
		expect(() => assertSyntheticFabTopologySpec(duplicate)).toThrow(/좌우 Wing 위치/);
	});

	it("requires exactly the north and south spine-to-wall gateways", () => {
		const links = LARGE_FAB_60_TOPOLOGY_SPEC.spineWallLinks;
		const north = links[0];
		const south = links[1];
		if (!north || !south) throw new Error("Expected synthetic FAB spine/wall links.");
		const missing: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			spineWallLinks: Object.freeze(links.slice(1)),
		};
		const duplicateSide: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			spineWallLinks: Object.freeze([
				north,
				{ ...south, sourceSide: "north", targetSide: "north" },
			]),
		};
		const mismatchedSide: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			spineWallLinks: Object.freeze([north, { ...south, targetSide: "north" }]),
		};
		const wrongWall: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			spineWallLinks: Object.freeze([north, { ...south, targetWallCircuitId: "MISSING-WALL" }]),
		};

		expect(() => assertSyntheticFabTopologySpec(missing)).toThrow(/north\/south wall gateway/);
		expect(() => assertSyntheticFabTopologySpec(duplicateSide)).toThrow(/gateway 면이 중복/);
		expect(() => assertSyntheticFabTopologySpec(mismatchedSide)).toThrow(/같은 north\/south 면/);
		expect(() => assertSyntheticFabTopologySpec(wrongWall)).toThrow(/wall circuit id/);
	});

	it("requires one safe wall-to-outer gateway on every cardinal side", () => {
		const links = LARGE_FAB_60_TOPOLOGY_SPEC.wallOuterLinks;
		const north = links.find((link) => link.sourceSide === "north");
		const east = links.find((link) => link.sourceSide === "east");
		const west = links.find((link) => link.sourceSide === "west");
		if (!north || !east || !west) throw new Error("Expected four synthetic FAB wall gateways.");
		const missing: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			wallOuterLinks: Object.freeze(links.slice(1)),
		};
		const duplicateSide: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			wallOuterLinks: Object.freeze([
				north,
				{ ...east, sourceSide: "north", outerSide: "north" },
				...links.slice(2),
			]),
		};
		const unsafeCenter: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			wallOuterLinks: Object.freeze(
				links.map((link) =>
					link === north
						? { ...link, placement: Object.freeze({ kind: "CENTER_OFFSET", offsetMeters: 0 }) }
						: link,
				),
			),
		};
		const outOfBoundsCenter: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			wallOuterLinks: Object.freeze(
				links.map((link) =>
					link === north
						? {
								...link,
								placement: Object.freeze({
									kind: "CENTER_OFFSET",
									offsetMeters: 1_000_000,
								}),
							}
						: link,
				),
			),
		};
		const invalidGap: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			wallOuterLinks: Object.freeze(
				links.map((link) =>
					link === west
						? { ...link, placement: Object.freeze({ kind: "BLOCK_GAP", gapAfterBlock: -1 }) }
						: link,
				),
			),
		};
		const wrongWall: SyntheticFabTopologySpec = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			wallOuterLinks: Object.freeze(
				links.map((link) =>
					link === east ? { ...link, sourceWallCircuitId: "MISSING-WALL" } : link,
				),
			),
		};

		expect(() => assertSyntheticFabTopologySpec(missing)).toThrow(/north\/east\/south\/west/);
		expect(() => assertSyntheticFabTopologySpec(duplicateSide)).toThrow(/면이 중복/);
		expect(() => assertSyntheticFabTopologySpec(unsafeCenter)).toThrow(/center offset/);
		expect(() => assertSyntheticFabTopologySpec(outOfBoundsCenter)).toThrow(/window.*직선 구간/);
		expect(() => assertSyntheticFabTopologySpec(invalidGap)).toThrow(/block gap/);
		expect(() => assertSyntheticFabTopologySpec(wrongWall)).toThrow(/wall circuit id/);
	});

	it("requires the complete gateway window to fit the spine straight segment", () => {
		expect(() =>
			assertSyntheticFabTopologySpec({
				...LARGE_FAB_60_TOPOLOGY_SPEC,
				rowLinkWindowMeters: 40,
			}),
		).toThrow(/spine의 사용 가능한 직선 구간/);
	});

	it("rejects authored gaps that the exact network-link planner cannot generate", () => {
		for (const override of [
			{ spineGapMeters: 121 },
			{ wallCircuitWingGapMeters: 121 },
			{ wallCircuitSpineEndGapMeters: 121 },
			{ outerMarginMeters: 121 },
		]) {
			expect(() =>
				assertSyntheticFabTopologySpec({ ...LARGE_FAB_60_TOPOLOGY_SPEC, ...override }),
			).toThrow(/120 m 이하/);
		}
	});

	it.each([
		50, 60, 61, 72, 73, 84, 85, 96, 97, 100,
	])("distributes %i Bays without changing the V7 circulation grammar", (targetBayCount) => {
		const resized = resizeSyntheticFabTopologyBayCount(LARGE_FAB_60_TOPOLOGY_SPEC, targetBayCount);

		expect(syntheticFabTopologyBayCount(resized)).toBe(targetBayCount);
		expect(resized.processBlocks).toBe(LARGE_FAB_60_TOPOLOGY_SPEC.processBlocks);
		expect(resized.processBanks).toBe(LARGE_FAB_60_TOPOLOGY_SPEC.processBanks);
		expect(resized.wallCircuit).toBe(LARGE_FAB_60_TOPOLOGY_SPEC.wallCircuit);
		expect(resized.spineWallLinks).toBe(LARGE_FAB_60_TOPOLOGY_SPEC.spineWallLinks);
		expect(resized.wallOuterLinks).toBe(LARGE_FAB_60_TOPOLOGY_SPEC.wallOuterLinks);
		for (const row of resized.processRows) {
			const left = resized.wings.find((wing) => wing.id === row.leftWingId);
			const right = resized.wings.find((wing) => wing.id === row.rightWingId);
			expect(Math.abs((left?.bayCount ?? 0) - (right?.bayCount ?? 0))).toBeLessThanOrEqual(1);
		}
		expect(() => assertSyntheticFabTopologySpec(resized)).not.toThrow();
	});

	it("rejects large-factory Bay totals outside the public 50-100 range", () => {
		expect(() => resizeSyntheticFabTopologyBayCount(LARGE_FAB_60_TOPOLOGY_SPEC, 49)).toThrow(
			/50-100/,
		);
		expect(() => resizeSyntheticFabTopologyBayCount(LARGE_FAB_60_TOPOLOGY_SPEC, 101)).toThrow(
			/50-100/,
		);
	});

	it.each([
		["spine width", { spineWidthMeters: 0 }],
		["spine gap", { spineGapMeters: 0 }],
		["spine end margin", { spineEndMarginMeters: 11 }],
		["row link window", { rowLinkWindowMeters: 10 }],
		["within-block pitch", { withinBlockRowPitchMeters: 39 }],
		["process block pitch", { processBlockPitchMeters: 141 }],
		["wall Wing gap", { wallCircuitWingGapMeters: 7 }],
		["wall spine gap", { wallCircuitSpineEndGapMeters: 7 }],
		["outer margin", { outerMarginMeters: 11.5 }],
	] as const)("rejects an invalid %s before exact generation", (_label, override) => {
		const invalid = {
			...LARGE_FAB_60_TOPOLOGY_SPEC,
			...override,
		} as SyntheticFabTopologySpec;

		expect(() => assertSyntheticFabTopologySpec(invalid)).toThrow(/이상의 정수/);
	});
});
