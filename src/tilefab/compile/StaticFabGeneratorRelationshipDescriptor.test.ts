import { describe, expect, it } from "vitest";
import { createProductionFabAssemblyPlan } from "./ProductionFabAssemblyPlan";
import {
	createStaticFabGeneratorRelationshipDescriptor,
	resolveStaticFabGeneratorRelationships,
} from "./StaticFabGeneratorRelationshipDescriptor";

const declaration = () =>
	createProductionFabAssemblyPlan({
		bayCount: 60,
		bankCount: 3,
		bayPitchMeters: 112,
	}).relationships;

describe("StaticFabGeneratorRelationshipDescriptor", () => {
	it("resolves every nested witness by seed key even when runtime IDs have another order", () => {
		const descriptor = declaration();
		const ids = new Map(descriptor.organizationKeys.map((key, index) => [key, 40 - index * 3]));
		const resolved = resolveStaticFabGeneratorRelationships(descriptor, ids);
		expect(resolved.nextRelationshipId).toBe(4);
		for (const [index, record] of resolved.records.entries()) {
			const participant = 37 - index * 3;
			expect(record.parentOrganizationId).toBe(40);
			expect(record.participantOrganizationIds).toEqual([participant]);
			expect(record.managedChildOrganizationIds).toEqual([participant]);
			const leg = record.connectionGroups[0]?.legs[0];
			expect(leg?.exclusiveCutEdges).toEqual([]);
			const scopes = leg?.seamContacts.flatMap((seam) =>
				seam.incidences.flatMap((item) =>
					item.binding.kind === "WITNESS" ? [item.binding.scopedEdge.scope] : [],
				),
			);
			expect(scopes?.filter((scope) => scope.kind === "PARENT_DIRECT")).toHaveLength(4);
			expect(scopes?.filter((scope) => scope.kind !== "PARENT_DIRECT")).toEqual([
				{
					kind: "PARTICIPANT_EFFECTIVE",
					participantIndex: 0,
					directOwnerOrganizationIds: [participant],
				},
				{
					kind: "PARTICIPANT_EFFECTIVE",
					participantIndex: 0,
					directOwnerOrganizationIds: [participant],
				},
			]);
		}
	});

	it("rejects missing keys and cross-record aliasing", () => {
		const descriptor = declaration();
		const ids = new Map(descriptor.organizationKeys.map((key, index) => [key, index + 1]));
		ids.delete("BAY-BANK-03");
		expect(() => resolveStaticFabGeneratorRelationships(descriptor, ids)).toThrow(/no valid ID/);
		ids.set("BAY-BANK-03", 2);
		expect(() => resolveStaticFabGeneratorRelationships(descriptor, ids)).toThrow(/alias/);
	});

	it("rejects forged declarations and undeclared nested owner references", () => {
		const descriptor = declaration();
		expect(() => resolveStaticFabGeneratorRelationships({ ...descriptor }, new Map())).toThrow(
			/untrusted/,
		);
		const records = structuredClone(descriptor.relationships.records);
		const incidence = records[0]?.connectionGroups[0]?.legs[0]?.seamContacts[0]?.incidences[1];
		if (
			incidence?.binding.kind !== "WITNESS" ||
			incidence.binding.scopedEdge.scope.kind === "PARENT_DIRECT"
		)
			throw new Error("expected participant witness");
		(incidence.binding.scopedEdge.scope.directOwnerOrganizationIds as number[])[0] = 999;
		expect(() =>
			createStaticFabGeneratorRelationshipDescriptor(descriptor.organizationKeys, records),
		).toThrow(/조직 999/);
	});

	it.each([
		["same", "same"],
		[""],
		[" leading"],
		["line\nbreak"],
		["x".repeat(161)],
	])("rejects invalid seed key table %j", (...keys) => {
		expect(() => createStaticFabGeneratorRelationshipDescriptor(keys, [])).toThrow(/seed keys/);
	});

	it("binds key identity and exact edge coordinates into a deeply immutable fingerprint", () => {
		const descriptor = declaration();
		const keys = [...descriptor.organizationKeys];
		const records = structuredClone(descriptor.relationships.records);
		const copied = createStaticFabGeneratorRelationshipDescriptor(keys, records);
		expect(copied.fingerprint).toBe(descriptor.fingerprint);
		keys[0] = "ANOTHER-FAB";
		expect(createStaticFabGeneratorRelationshipDescriptor(keys, records).fingerprint).not.toBe(
			copied.fingerprint,
		);
		for (const record of records)
			for (const group of record.connectionGroups)
				for (const leg of group.legs)
					for (const seam of leg.seamContacts)
						for (const incidence of seam.incidences) {
							if (incidence.binding.kind !== "WITNESS") throw new Error("expected witness");
							const edge = incidence.binding.scopedEdge.edge;
							(edge.from as { x: number }).x += 1;
							(edge.to as { x: number }).x += 1;
						}
		expect(
			createStaticFabGeneratorRelationshipDescriptor(descriptor.organizationKeys, records)
				.fingerprint,
		).not.toBe(copied.fingerprint);
		expect(copied).toEqual(descriptor);
		expect(
			Object.isFrozen(copied.relationships.records[0]?.connectionGroups[0]?.legs[0]?.seamContacts),
		).toBe(true);
	});
});
