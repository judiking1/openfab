import { describe, expect, it } from "vitest";
import legacyRecord from "./fixtures/legacy-organization-blueprint-v1.json";
import legacyLibrary from "./fixtures/legacy-organization-library-v1.json";
import {
	parseOpenFabUserBlueprintRecord,
	serializeLegacyOpenFabUserBlueprintRecord,
	serializeOpenFabUserBlueprintRecord,
} from "./OpenFabUserBlueprintLibrary";
import {
	parseOpenFabUserBlueprintLibraryBundleJson,
	parseOpenFabUserBlueprintLibraryBundleValue,
	serializeOpenFabUserBlueprintLibraryBundle,
} from "./OpenFabUserBlueprintLibraryBundle";

// Fixed synthetic fixture produced by the original e8f8b94 envelope1/record1/bundle1 codec.
// Its historical fingerprint was recorded before the migration implementation existed.
describe("portable relationship legacy compatibility", () => {
	it("authenticates the historical fingerprint before emitting a current library", () => {
		expect(legacyLibrary.fingerprint).toBe("ofubl1-741951fc:ceb23dd6");
		const migrated = parseOpenFabUserBlueprintLibraryBundleValue(legacyLibrary);
		expect(migrated.schemaVersion).toBe(2);
		expect(migrated.fingerprint).toMatch(/^ofubl2-/);
		expect(migrated.records).toHaveLength(1);
		const record = migrated.records[0];
		expect(record?.schemaVersion).toBe(2);
		if (record?.blueprint.kind !== "STATIC_FAB_ORGANIZATION")
			throw new Error("Organization fixture lost");
		expect(record.blueprint.bundle.version).toBe(2);
		expect(record.blueprint.bundle.relationships).toEqual({ nextRelationshipId: 1, records: [] });
		expect(record.blueprint.bundle.organizations).toHaveLength(2);
		expect(record.blueprint.bundle.equipmentGroups).toHaveLength(1);
		expect(Object.isFrozen(record.blueprint.bundle.relationships.records)).toBe(true);
		expect(
			parseOpenFabUserBlueprintLibraryBundleJson(
				serializeOpenFabUserBlueprintLibraryBundle(migrated),
			),
		).toEqual(migrated);
	});

	it("imports an old individual record and retains its canonical historical projection", () => {
		const migrated = parseOpenFabUserBlueprintRecord(legacyRecord);
		expect(migrated.schemaVersion).toBe(2);
		expect(JSON.parse(serializeLegacyOpenFabUserBlueprintRecord(legacyRecord))).toEqual(
			legacyRecord,
		);
		expect(
			parseOpenFabUserBlueprintRecord(JSON.parse(serializeOpenFabUserBlueprintRecord(migrated))),
		).toEqual(migrated);
		expect(() => serializeLegacyOpenFabUserBlueprintRecord(migrated)).toThrow(
			/legacy record version/,
		);
	});

	it("rejects a tampered old backup despite successful record migration", () => {
		const tampered = structuredClone(legacyLibrary);
		const record = tampered.records[0];
		if (!record) throw new Error("Historical synthetic record is missing");
		record.blueprint.name = "Tampered synthetic Bay";
		expect(() => parseOpenFabUserBlueprintLibraryBundleValue(tampered)).toThrow(/fingerprint/);
	});

	it("rejects future relationship fields and future nested versions in legacy envelopes", () => {
		for (const bundle of [
			{ ...legacyRecord.blueprint.bundle, relationships: { nextRelationshipId: 1, records: [] } },
			{
				...legacyRecord.blueprint.bundle,
				version: 2,
				relationships: { nextRelationshipId: 1, records: [] },
			},
		]) {
			const record = { ...legacyRecord, blueprint: { ...legacyRecord.blueprint, bundle } };
			expect(() => parseOpenFabUserBlueprintRecord(record)).toThrow();
			expect(() =>
				parseOpenFabUserBlueprintLibraryBundleValue({ ...legacyLibrary, records: [record] }),
			).toThrow();
		}
	});

	it("requires every record version to match its library envelope", () => {
		const migrated = parseOpenFabUserBlueprintLibraryBundleValue(legacyLibrary);
		expect(() =>
			parseOpenFabUserBlueprintLibraryBundleValue({ ...legacyLibrary, records: migrated.records }),
		).toThrow(/record version/);
		expect(() =>
			parseOpenFabUserBlueprintLibraryBundleValue({ ...migrated, records: legacyLibrary.records }),
		).toThrow(/record version/);
	});
});
