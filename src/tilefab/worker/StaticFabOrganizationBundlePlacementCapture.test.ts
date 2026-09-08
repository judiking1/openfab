import { describe, expect, it } from "vitest";
import { createAdvancedSwitchRecordFields } from "./AdvancedSwitchSoA";
import { createPortEquipmentSnapshot } from "./PortEquipmentSoA";
import { createStaticFabAssemblyRelationshipSnapshot } from "./StaticFabAssemblyRelationshipSoA";
import { createStaticFabOrganizationBundlePlacementCapture } from "./StaticFabOrganizationBundlePlacementCapture";
import { STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS } from "./StaticFabOrganizationBundlePlacementResponseValidator";
import type { StaticFabOrganizationBundlePlacementAdditions } from "./StaticFabOrganizationBundlePlacementTransport";
import { createStaticFabOrganizationSnapshot } from "./StaticFabOrganizationSoA";

describe("placement addition capture", () => {
	it("captures all column references before its first step and owns the completed bytes", () => {
		const input = fixture();
		const expected = structuredClone(input);
		const task = createStaticFabOrganizationBundlePlacementCapture(input);
		expect(() => task.finish()).toThrow("not complete");
		Object.assign(input, { xs: new Int32Array([99]), organizations: null, relationships: null });
		let operations = 0;
		while (!task.done) operations += task.step(1);
		expect(operations).toBeGreaterThan(50);
		const owned = task.finish();
		expect(owned).toEqual(expected);
		expect(Object.isFrozen(owned.organizations.records.names)).toBe(true);
		owned.xs[0] = 42;
		expect(expected.xs[0]).toBe(0);
	});

	it.each([
		["wrong type", () => new Float64Array(1)],
		["shared buffer", () => new Int32Array(new SharedArrayBuffer(4))],
		["partial buffer", () => new Int32Array(new ArrayBuffer(8), 4, 1)],
		["oversized column", () => new Int32Array(STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS + 1)],
	])("rejects %s in preflight before a capture task exists", (_name, column) => {
		expect(() =>
			createStaticFabOrganizationBundlePlacementCapture({ ...fixture(), xs: column() }),
		).toThrow("column type or length bounds");
	});

	it("rejects aliases across different domains, including empty buffers", () => {
		const input = fixture();
		Object.assign(input.relationships, { relationshipIds: input.portEquipment.portIds });
		expect(() => createStaticFabOrganizationBundlePlacementCapture(input)).toThrow("aliases");
	});

	it("detects a detached wide column at a later chunk and cannot finish a failed capture", () => {
		const input = fixture(2_049);
		const task = createStaticFabOrganizationBundlePlacementCapture(input);
		expect(task.step(3)).toBe(3); // allocation, then first 1,024 values, then suspend before the next chunk
		structuredClone(input.xs, { transfer: [input.xs.buffer] });
		expect(() => task.step(1)).toThrow("buffer changed");
		expect(() => task.finish()).toThrow("buffer changed");
	});

	it("bounds individual text and rejects late text mutation before ownership is published", () => {
		const input = fixture();
		const task = createStaticFabOrganizationBundlePlacementCapture(input);
		Object.assign(input.organizations.records.names, { 0: "x".repeat(121) });
		expect(() => {
			while (!task.done) task.step(1);
		}).toThrow("text bounds");
		expect(() => task.finish()).toThrow("text bounds");
	});

	it("copies organization membership before its later hydrator can read it", () => {
		const input = fixture();
		const task = createStaticFabOrganizationBundlePlacementCapture(input);
		while (!task.done) task.step(7);
		const owned = task.finish();
		input.organizations.records.railEdgeCoordinates.fill(99);
		expect([...owned.organizations.records.railEdgeCoordinates]).toEqual([0, 0, 1, 0]);
	});
});

function fixture(cells = 1): StaticFabOrganizationBundlePlacementAdditions {
	// Capture tests deliberately exercise byte ownership, not placement/topology certification.
	return structuredClone({
		xs: Int32Array.from({ length: cells }, (_, index) => index),
		ys: new Int32Array(cells),
		encoded: new Uint8Array(cells).fill(1),
		switchIds: new Int32Array(),
		switches: createAdvancedSwitchRecordFields(0),
		portEquipment: createPortEquipmentSnapshot({
			nextPortId: 1,
			nextEquipmentGroupId: 1,
			ports: [],
			equipmentGroups: [],
		}),
		organizations: createStaticFabOrganizationSnapshot({
			nextOrganizationId: 2,
			records: [
				{
					id: 1,
					kind: "BAY",
					name: "Synthetic capture",
					membership: {
						railEdges: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }],
						advancedSwitchIds: [],
						equipmentGroupIds: [],
					},
				},
			],
		}),
		relationships: createStaticFabAssemblyRelationshipSnapshot({
			nextRelationshipId: 1,
			records: [],
		}),
	});
}
