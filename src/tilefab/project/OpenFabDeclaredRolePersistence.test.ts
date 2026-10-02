import { describe, expect, it } from "vitest";
import { RailDocument } from "../core/RailDocument";
import { copyStaticFabOrganizationState } from "../core/StaticFabOrganization";
import { checksumLegacyOpenFabProject } from "../worker/RailLegacyProjectChecksum";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { createRailScaleProbeDocument } from "../worker/RailStartupFixture";
import { compileRailStartup } from "../worker/RailStartupRuntime";
import { hydrateStaticFabOrganizationSnapshot } from "../worker/StaticFabOrganizationSoA";
import legacyRecord from "./fixtures/legacy-organization-blueprint-v1.json";
import { createOpenFabStaticFabOrganizationBlueprint } from "./OpenFabBlueprintLibrary";
import { captureOpenFabProject } from "./OpenFabProject";
import { parseOpenFabProjectValue, serializeOpenFabProject } from "./OpenFabProjectCodec";
import {
	createOpenFabUserBlueprintRecord,
	parseOpenFabUserBlueprintRecord,
	serializeOpenFabUserBlueprintRecord,
} from "./OpenFabUserBlueprintLibrary";
import {
	createOpenFabUserBlueprintLibraryBundle,
	parseOpenFabUserBlueprintLibraryBundleJson,
	serializeOpenFabUserBlueprintLibraryBundle,
} from "./OpenFabUserBlueprintLibraryBundle";

const manifest = {
	id: "declared-loop-project",
	name: "Declared loop",
	createdAt: "2026-10-03T00:00:00.000Z",
	updatedAt: "2026-10-03T00:00:00.000Z",
};
function documentWithDeclaredRole(): RailDocument {
	const source = createRailScaleProbeDocument(25);
	const organizations = copyStaticFabOrganizationState({
		nextOrganizationId: 2,
		records: [
			{
				id: 1,
				kind: "AISLE",
				name: "Standalone",
				declaredSemanticRole: "PROCESS_LOOP",
				membership: {
					railEdges: Array.from({ length: 24 }, (_, x) => ({
						from: { x: x + 1, y: 0 },
						to: { x, y: 0 },
					})),
					advancedSwitchIds: [],
					equipmentGroupIds: [],
				},
			},
		],
	});
	return RailDocument.fromLoadedMap(
		source.map,
		source.getPatchSequence(),
		source.portEquipment,
		organizations,
	);
}

describe("declared process-loop persistence boundaries", () => {
	it("round-trips explicit intent through project JSON and typed Worker startup without requiring a closed loop", () => {
		const document = documentWithDeclaredRole();
		const project = captureOpenFabProject(document, { manifest });
		expect(project.schemaVersion).toBe(14);
		expect(project.areas.records[0]?.declaredSemanticRole).toBe("PROCESS_LOOP");
		const payload = compileRailStartup({
			kind: "project-json",
			json: serializeOpenFabProject(project),
		});
		expect(hydrateStaticFabOrganizationSnapshot(payload.snapshot.organizations)).toEqual(
			document.organizations,
		);
		expect(payload.authoredChecksum).toBe(
			captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
			).snapshot.checksum,
		);
		expect(payload.readiness.value.ready).toBe(false);
	});

	it("strictly separates native v13 input from required current nullable intent", () => {
		const current = captureOpenFabProject(documentWithDeclaredRole(), { manifest });
		const legacy = JSON.parse(serializeOpenFabProject(current));
		legacy.schemaVersion = 13;
		legacy.areas.schemaVersion = 2;
		legacy.blueprints.schemaVersion = 4;
		expect(() => parseOpenFabProjectValue(legacy)).toThrow(/declaredSemanticRole/);
		delete legacy.areas.records[0].declaredSemanticRole;
		const migrated = parseOpenFabProjectValue(legacy);
		expect(migrated.migratedFromVersion).toBe(13);
		expect(migrated.project.areas.records[0]?.declaredSemanticRole).toBeNull();
		const missingCurrent = JSON.parse(serializeOpenFabProject(current));
		delete missingCurrent.areas.records[0].declaredSemanticRole;
		expect(() => parseOpenFabProjectValue(missingCurrent)).toThrow(/declaredSemanticRole/);
	});

	it("preserves intent in portable organizations, individual blueprints and whole-library backups", () => {
		const old = parseOpenFabUserBlueprintRecord(legacyRecord);
		if (old.blueprint.kind !== "STATIC_FAB_ORGANIZATION")
			throw new Error("Missing organization fixture");
		const bundle = {
			...old.blueprint.bundle,
			organizations: old.blueprint.bundle.organizations.map((organization) =>
				organization.kind === "BAY"
					? {
							...organization,
							kind: "AISLE" as const,
							declaredSemanticRole: "PROCESS_LOOP" as const,
						}
					: organization,
			),
		};
		const blueprint = createOpenFabStaticFabOrganizationBlueprint(bundle, {
			id: "declared-blueprint",
			name: "Declared loop",
			createdAt: manifest.createdAt,
		});
		const record = createOpenFabUserBlueprintRecord(blueprint, {
			id: "declared-library-record",
			createdAt: manifest.createdAt,
		});
		expect(
			parseOpenFabUserBlueprintRecord(JSON.parse(serializeOpenFabUserBlueprintRecord(record))),
		).toEqual(record);
		const library = createOpenFabUserBlueprintLibraryBundle([record], manifest.createdAt);
		expect(
			parseOpenFabUserBlueprintLibraryBundleJson(
				serializeOpenFabUserBlueprintLibraryBundle(library),
			),
		).toEqual(library);
	});

	it("authenticates current and v13 recovery identities and rejects mismatches before returning a candidate", () => {
		const source = createRailScaleProbeDocument(25);
		const current = captureOpenFabProject(source, { manifest });
		const json = serializeOpenFabProject(current);
		const expected = captureRailMirrorSnapshot(source.map, source.getPatchSequence()).snapshot
			.checksum;
		expect(
			compileRailStartup({ kind: "project-json", json, expectedAuthoredChecksum: expected })
				.authoredChecksum,
		).toBe(expected);
		const legacy = JSON.parse(json);
		legacy.schemaVersion = 13;
		legacy.areas.schemaVersion = 2;
		legacy.blueprints.schemaVersion = 4;
		const historical = checksumLegacyOpenFabProject(
			13,
			source.map,
			source.portEquipment,
			source.organizations,
			source.relationships,
		);
		expect(
			compileRailStartup({
				kind: "project-json",
				json: JSON.stringify(legacy),
				expectedAuthoredChecksum: historical,
			}).authoredChecksum,
		).toBe(expected);
		for (const recovery of [
			{ json, checksum: historical },
			{ json: JSON.stringify(legacy), checksum: expected },
			{ json, checksum: expected.slice(0, -1) + (expected.endsWith("0") ? "1" : "0") },
		]) {
			expect(() =>
				compileRailStartup({
					kind: "project-json",
					json: recovery.json,
					expectedAuthoredChecksum: recovery.checksum,
				}),
			).toThrow(/무결성/);
		}
	});
});
