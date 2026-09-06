import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { planOhbPlacement } from "./PortPlacementPlanner";
import { PORT_SLOT_STATUS, type PortSlotBounds, PortSlotSpatialIndex } from "./PortSlotCompiler";
import {
	compilePortSlotPreparedArtifactCatalog,
	createPreparedPortSlotAvailabilityIndex,
} from "./PortSlotPreparedArtifacts";
import { StkPlacementCandidateFilter } from "./StkPlacementCandidateFilter";

function fixture() {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 12, y: 0 }))).toBe(
		true,
	);
	const physical = compilePhysicalRail(document.map);
	const catalog = compilePortSlotPreparedArtifactCatalog(physical);
	const prepared = catalog.STK;
	const slots = prepared.slots;
	const index = new PortSlotSpatialIndex(slots, prepared.spatialIndex);
	const at = (x: number) => {
		const row = Array.from({ length: slots.count }, (_, row) => row).find(
			(row) => slots.routeXs[row] === x && slots.statuses[row] === PORT_SLOT_STATUS.LEGAL,
		);
		if (row === undefined) throw new Error(`Missing STK slot at ${x}`);
		return row;
	};
	const context = () => ({
		slots,
		availability: createPreparedPortSlotAvailabilityIndex(
			physical,
			prepared,
			document.portEquipment,
		),
		state: document.portEquipment,
		rows: [at(2)],
		template: "FLEX" as const,
		revision: document.map.getRevision(),
		sequence: document.getPatchSequence(),
		query: (bounds: PortSlotBounds, target: number[]) => index.query(bounds, target),
	});
	return { document, physical, catalog, at, context };
}

describe("StkPlacementCandidateFilter", () => {
	it("rejects a free endpoint when its Stocker span crosses existing equipment", () => {
		const { document, physical, catalog, at, context } = fixture();
		const ohb = catalog.OHB;
		const occupied = Array.from({ length: ohb.slots.count }, (_, row) => row).find(
			(row) => ohb.slots.routeXs[row] === 5 && ohb.slots.sides[row] === 1,
		);
		expect(occupied).toBeDefined();
		expect(
			document.commitPortEquipment(
				planOhbPlacement(
					ohb.slots,
					occupied as number,
					createPreparedPortSlotAvailabilityIndex(physical, ohb, document.portEquipment),
					document.portEquipment,
					document.map.getRevision(),
					document.getPatchSequence(),
				),
			),
		).toBe(true);
		const source = document.portEquipment;
		const sequence = document.getPatchSequence();
		const ctx = context();
		expect(ctx.availability.statusFor(ctx.slots, at(9)).status).toBe(PORT_SLOT_STATUS.LEGAL);
		const accepts = new StkPlacementCandidateFilter().forDraft(ctx);
		expect(accepts(at(9))).toBe(false);
		expect(accepts(at(3))).toBe(true);
		expect(accepts(at(2))).toBe(false);
		expect(document.portEquipment).toBe(source);
		expect(document.getPatchSequence()).toBe(sequence);
	});

	it("keeps camera-only advice stable but invalidates changed drafts and source bindings", () => {
		const { context, at } = fixture();
		const filter = new StkPlacementCandidateFilter();
		const ctx = context();
		const accepts = filter.forDraft(ctx);
		expect(accepts(at(3))).toBe(true);
		expect(filter.forDraft({ ...ctx, query: (bounds, target) => ctx.query(bounds, target) })).toBe(
			accepts,
		);
		const changedDraft = filter.forDraft({ ...ctx, rows: [at(3)] });
		expect(changedDraft).not.toBe(accepts);
		expect(changedDraft(at(3))).toBe(false);
		const stale = filter.forDraft({ ...ctx, revision: ctx.revision + 1 });
		expect(stale(at(3))).toBe(false);
		expect(filter.forDraft({ ...ctx, sequence: ctx.sequence + 1 })).not.toBe(stale);
		filter.clear();
		expect(filter.forDraft(ctx)).not.toBe(accepts);
	});

	it("allows valid partial preset selections without pretending they are complete", () => {
		const { context, at } = fixture();
		const accepts = new StkPlacementCandidateFilter().forDraft({
			...context(),
			template: "FOUR_PORT",
		});
		expect(accepts(at(3))).toBe(true);
		expect(accepts(at(2))).toBe(false);
	});
});
